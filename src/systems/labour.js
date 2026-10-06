// ============================================
// LABOUR — the daily labour tick, migration and refugees
// ============================================
// Drives world/townLabour.js (classes, hands, wages, welfare of each town)
// from the world and player state that layer may not read:
//
//   - On each town's market day (after MarketDynamics.updatePrices) its
//     labour turn runs: the danger it stands in (the player's siege or a
//     siege of a holding, a recent conquest, a realm at war with a linked
//     neighbour's, outlaw lairs and raiders near, fire and flood damage),
//     the land it can work (its fertility), the cost of living, the
//     player's taxes where the player rules, and the hands the works and
//     the player's properties hire there.
//   - The player's properties hire from the nearest town (property.hire:
//     its wage against the base wage and how far it can staff them — read
//     by PlayerEconomy's upkeep and production).
//   - Weekly: refugees flee towns in danger or famine for safer linked
//     neighbours (and go home when it passes), each class drifts along the
//     trade links toward the town where it fares better (a town the player
//     rules with land to spare draws settlers), artisans pinched by prices
//     may strike, and a thriving town that draws people booms. The news goes
//     on world.labour.history for the heralds (systems/heralds.js) and the
//     counsel; the tavern hears of it (systems/chatter.js).
//
// Deterministic: draws no RNG (strikes roll a hash of the town and the day).
// Tuned in data/labour.json; state is on each settlement.labour (saved with
// its tile) and world.labour (saved by systems/saveLoad.js).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour, STRATA } from '../world/townLabour.js';
import { MarketDynamics, Taxation } from './marketDynamics.js';
import { OutlawLairs } from './outlawLairs.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _key = (q, r) => `${q},${r}`;
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const RANK = { village: 0, town: 1, city: 2, capital: 3 };

/** A deterministic draw in [0, 1) for `key` (no RNG stream is touched). */
function _roll(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 100000) / 100000;
}

export const Labour = {
    // ── State ─────────────────────────────────────────────

    /** World-level record: { history: [...news], lastDay, week }. */
    state(world) {
        if (!world) return null;
        let st = world.labour;
        if (!_obj(st)) st = world.labour = { history: [], lastDay: null };
        if (!Array.isArray(st.history)) st.history = [];
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.labour);
        return st ? { history: st.history.slice(), lastDay: st.lastDay } : null;
    },

    /** After a load: the news record (older saves: none), and every town's labour derived from its people. */
    restore(saved, world) {
        if (!world) return;
        world.labour = { history: [], lastDay: null };
        if (_obj(saved)) {
            if (Array.isArray(saved.history)) world.labour.history = saved.history.filter(h => h && h.key);
            if (Number.isFinite(saved.lastDay)) world.labour.lastDay = saved.lastDay;
        }
    },

    /** Give every settlement a labour record (old saves derive it from the population). */
    backfill(world) {
        if (!world || typeof world.getSettlementViews !== 'function') return;
        for (const s of world.getSettlementViews()) TownLabour.ensure(s);
    },

    /** A record for the heralds and the counsel ({ key, kind, day, ... }); null when already kept. */
    record(world, entry) {
        const st = Labour.state(world);
        if (!st || st.history.some(h => h.key === entry.key)) return null;
        const h = { day: _num(world.day), ...entry };
        st.history.push(h);
        const cap = _num(TownLabour.config().news.cap, 30);
        if (st.history.length > cap) st.history.splice(0, st.history.length - cap);
        return h;
    },

    // ── Danger ────────────────────────────────────────────

    /** What the day's danger reads once: sieges, lairs, raiders, towns on a front, kingdoms by id. */
    _dangerCtx(world, player, links) {
        const besieged = MarketDynamics._besieged(player);
        const lairs = player ? OutlawLairs.active(player).filter(l => Number.isFinite(l.q)) : [];
        const raiders = (world.units || []).filter(u => u && !u.destroyed && u.type === 'raider');
        const kingdoms = new Map((world.kingdoms || []).map(k => [k.id, k]));
        const border = new Set();
        for (const l of links) {
            const ka = l.a && kingdoms.get(l.a.kingdom), kb = l.b && kingdoms.get(l.b.kingdom);
            if (!ka || !kb || ka === kb) continue;
            if ((Array.isArray(ka.wars) && ka.wars.includes(kb.id)) || (Array.isArray(kb.wars) && kb.wars.includes(ka.id))) {
                border.add(l.a);
                border.add(l.b);
            }
        }
        return { besieged, lairs, raiders, border };
    },

    /** How unsafe a town is (0..1): siege, conquest, front, lairs, raiders, damage. */
    danger(world, s, dctx, day) {
        const D = TownLabour.config().danger;
        const lab = s.labour;
        let d = 0;
        if (dctx.besieged.has(_key(s.q, s.r))) d += _num(D.siege, 1);
        if (lab && Number.isFinite(lab.conq)) {
            const since = day - lab.conq;
            const days = Math.max(1, _num(D.conquestDays, 30));
            if (since >= 0 && since <= days) d += _num(D.conquest) * (1 - since / days);
        }
        if (dctx.border.has(s)) d += _num(D.border);
        if (dctx.lairs.length) {
            let ld = 0;
            for (const l of dctx.lairs) {
                if (Math.abs(l.r - s.r) > D.lairRadius) continue;
                if (Hex.wrappingDistance(l.q, l.r, s.q, s.r, world.width) <= D.lairRadius) ld += _num(D.lair);
            }
            d += Math.min(_num(D.lairMax, 0.3), ld);
        }
        for (const u of dctx.raiders) {
            if (Math.abs(u.r - s.r) > D.raiderRadius) continue;
            if (Hex.wrappingDistance(u.q, u.r, s.q, s.r, world.width) <= D.raiderRadius) { d += _num(D.raider); break; }
        }
        d += _clamp(_num(s.damage), 0, 1) * _num(D.damage);
        return _clamp(d, 0, 1);
    },

    /** Danger or famine: what drives people out (0..1). */
    distress(s, danger) {
        const f = SettlementMarket.foodShortage(s);
        const dearth = SettlementMarket.config().shortage.dearth;
        return Math.max(danger, f >= dearth ? Math.min(1, f * 1.5) : 0);
    },

    /** The staples' price against their base (the cost of living), from the town's stock. */
    costOfLiving(s) {
        const m = s && s.market;
        if (!m || !m.stock) return 1;
        const C = SettlementMarket.config();
        const sh = SettlementMarket._shape(s);
        let sum = 0, n = 0;
        for (const id of TownLabour.config().wages.staples || []) {
            const i = C.idx[id];
            if (i === undefined || !sh.usedA[i]) continue;
            sum += SettlementMarket.curve(_num(m.stock[id]) / sh.targetA[i], true);
            n++;
        }
        return n ? sum / n : 1;
    },

    // ── The player's hands ────────────────────────────────

    _propDef(type) {
        const P = DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.PROPERTY_TYPES;
        if (!P) return null;
        return P[String(type).toUpperCase()] || Object.values(P).find(d => d && d.id === type) || null;
    },

    /** The town a property at (q, r) hires from: the nearest settlement within the radius, or null. */
    _hireTown(world, views, q, r) {
        const R = _num(TownLabour.config().properties.radius, 3);
        let best = null, bestD = Infinity;
        for (const s of views) {
            if (Math.abs(s.r - r) > R) continue;
            const d = Hex.wrappingDistance(s.q, s.r, q, r, world.width);
            if (d <= R && d < bestD) { best = s; bestD = d; }
        }
        return best;
    },

    /**
     * The player's properties: where each hires (property.hire, re-sought
     * every 30 days) and how many hands. → Map 'q,r' → { land, craft } of hands.
     */
    _propertyHands(world, player, views, day) {
        const out = new Map();
        if (!player || !Array.isArray(player.properties) || !player.properties.length) return out;
        const C = TownLabour.config();
        for (const ref of player.properties) {
            const tile = world.getTile(ref.q, ref.r);
            const prop = tile && Array.isArray(tile.playerProperties) ? tile.playerProperties.find(p => p && p.type === ref.type) : null;
            if (!prop) continue;
            let hire = _obj(prop.hire);
            if (!hire || !Number.isFinite(hire.at) || day - hire.at >= 30 || day < hire.at) {
                const town = Labour._hireTown(world, views, ref.q, ref.r);
                if (!town) { delete prop.hire; continue; }
                const def = Labour._propDef(prop.type);
                const sector = TownLabour.craftProperty(def && def.category) ? 'craft' : 'land';
                hire = prop.hire = { q: town.q, r: town.r, town: town.name, sector, at: day, hands: 0, wage: 0, ratio: 1, fill: 1 };
            }
            const ts = world.getTile(hire.q, hire.r);
            const town = ts && ts.settlement;
            if (!town) { delete prop.hire; continue; }
            const base = TownLabour.baseWage(town.type, hire.sector);
            const upkeep = _num(prop.upkeep) * Math.max(1, _num(prop.level, 1));
            const hands = prop.underConstruction ? 0 : upkeep * _num(C.properties.wageShare, 0.5) / Math.max(0.05, base);
            hire.hands = Math.round(hands * 10) / 10;
            const k = _key(hire.q, hire.r);
            const h = out.get(k) || { land: 0, craft: 0 };
            h[hire.sector] += hands;
            out.set(k, h);
        }
        return out;
    },

    /** Today's wage and staffing on each property's hire record (after the towns' turns). */
    _refreshHires(world, player) {
        for (const ref of (player && player.properties) || []) {
            const tile = world.getTile(ref.q, ref.r);
            const prop = tile && Array.isArray(tile.playerProperties) ? tile.playerProperties.find(p => p && p.type === ref.type) : null;
            const hire = prop && _obj(prop.hire);
            if (!hire) continue;
            const ts = world.getTile(hire.q, hire.r);
            const lab = ts && ts.settlement && ts.settlement.labour;
            if (!lab || !lab.wage) continue;
            const base = TownLabour.baseWage(ts.settlement.type, hire.sector);
            hire.wage = _num(lab.wage[hire.sector], base);
            hire.ratio = Math.round(hire.wage / Math.max(0.01, base) * 1000) / 1000;
            const f = TownLabour.factors(ts.settlement, world.day);
            hire.fill = Math.round((hire.sector === 'craft' ? f.craft : f.land) * 1000) / 1000;
        }
    },

    // ── The day ───────────────────────────────────────────

    /**
     * The labour day (after MarketDynamics.updatePrices, before the works
     * pay out): each town whose market took its turn today takes its
     * labour turn; weekly, migration, refugees, strikes and booms.
     * → { notices: [{ icon, title, text, type }], news: [...] }
     */
    processDay(world, player = null) {
        const out = { notices: [], news: [] };
        if (!world || typeof world.getTile !== 'function') return out;
        const st = Labour.state(world);
        const day = _num(world.day);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        const cache = MarketDynamics._cache(world);
        const links = (cache.links && cache.links.list) || [];
        const k = SettlementMarket.tickDays();
        const dctx = Labour._dangerCtx(world, player, links);
        const ruled = new Set();
        let taxRate = null;
        if (player) {
            for (const ref of Taxation.getPlayerSettlements(player, world)) ruled.add(_key(ref.q, ref.r));
            const pol = Taxation.TAX_RATES[String(player.taxRate || 'moderate').toUpperCase()];
            taxRate = pol ? pol.rate : null;
        }
        const propHands = Labour._propertyHands(world, player, views, day);
        const lives = [];
        for (const v of views) {
            const tile = world.getTile(v.q, v.r);
            const s = tile && tile.settlement;
            if (!s) continue;
            const lab = TownLabour.ensure(s);
            // A town taken by another crown: its people fear the new masters for a while
            const kid = s.kingdom || null;
            if (lab.k !== kid) {
                if (lab.k && kid) lab.conq = day;
                lab.k = kid;
            }
            lives.push(s);
            const m = s.market;
            if (!m || m.day !== day) continue;
            const key = _key(v.q, v.r);
            const hands = { land: 0, craft: 0 };
            const ph = propHands.get(key);
            if (ph) { hands.land += ph.land; hands.craft += ph.craft; }
            for (const id in m.works || {}) hands.craft += TownLabour.worksHands(id, m.works[id] && m.works[id].lvl);
            const land = MarketDynamics._land(world, cache, tile, day);
            TownLabour.update(s, {
                day, k, fertility: land ? land.fertility : 1,
                danger: Labour.danger(world, s, dctx, day),
                taxRate: ruled.has(key) ? taxRate : null,
                col: Labour.costOfLiving(s),
                hands,
            });
        }
        Labour._refreshHires(world, player);
        const M = TownLabour.config().migration;
        const every = Math.max(1, Math.floor(_num(M.every, 7)));
        if (day % every === 3 % every) Labour._week(world, player, lives, links, dctx, ruled, day, out);
        return out;
    },

    /** The week's movement of people: refugees out and home, migration, strikes, booms. */
    _week(world, player, lives, links, dctx, ruled, day, out) {
        const C = TownLabour.config();
        const Rf = C.refugees, M = C.migration, S = C.strikes;
        const minPop = _num(M.minPop, 60);
        const at = new Map(lives.map(s => [_key(s.q, s.r), s]));
        const danger = new Map();
        const distress = new Map();
        for (const s of lives) {
            const d = Labour.danger(world, s, dctx, day);
            danger.set(s, d);
            distress.set(s, Labour.distress(s, d));
            const lab = s.labour;
            lab.moved = { in: 0, out: 0 };
            lab.refugees = Math.round(_num(lab.refugees) * _num(Rf.decay, 0.85));
        }
        const partners = new Map();
        for (const l of links) {
            if (at.get(_key(l.a.q, l.a.r)) !== l.a || at.get(_key(l.b.q, l.b.r)) !== l.b || l.a === l.b) continue;
            (partners.get(l.a) || partners.set(l.a, []).get(l.a)).push(l.b);
            (partners.get(l.b) || partners.set(l.b, []).get(l.b)).push(l.a);
        }
        const why = (s) => {
            if (dctx.besieged.has(_key(s.q, s.r))) return 'siege';
            const lab = s.labour;
            if (lab && Number.isFinite(lab.conq) && day - lab.conq <= _num(C.danger.conquestDays, 30)) return 'conquest';
            if (dctx.border.has(s)) return 'war';
            if (SettlementMarket.inDearth(s)) return 'famine';
            return 'danger';
        };

        // Refugees: out of danger and famine, toward the safest neighbours
        for (const s of lives) {
            const ds = distress.get(s);
            if (!(ds >= _num(Rf.from, 0.25))) continue;
            const pop = _num(s.population);
            const n = Math.floor(pop * Math.min(_num(Rf.maxShare, 0.05), _num(Rf.rate, 0.03) * ds));
            if (n < 1 || pop - n < minPop) continue;
            const safe = (partners.get(s) || []).filter(t => distress.get(t) < _num(Rf.safe, 0.2));
            if (!safe.length) continue;
            const wts = safe.map(t => Math.sqrt(Math.max(1, _num(t.population))) * Math.max(0.05, TownLabour.welfare(t)));
            const wsum = wts.reduce((a, b) => a + b, 0);
            let moved = 0, best = null, bestN = 0;
            safe.forEach((t, i) => {
                const share = Math.floor(n * wts[i] / wsum);
                const got = TownLabour.moveMix(s, t, share, minPop);
                if (!(got > 0)) return;
                moved += got;
                const lt = t.labour;
                lt.refugees = _num(lt.refugees) + got;
                lt.moved.in += got;
                const fk = _key(s.q, s.r);
                lt.from = _obj(lt.from) || {};
                lt.from[fk] = _num(lt.from[fk]) + got;
                Labour._trimFrom(lt, _num(Rf.keep, 4));
                if (got > bestN) { best = t; bestN = got; }
            });
            if (!(moved > 0)) continue;
            s.labour.moved.out += moved;
            if (moved >= _num(Rf.newsMin, 40)) {
                const cause = why(s);
                const h = Labour.record(world, {
                    key: `refugees:${_key(s.q, s.r)}:${Math.floor(day / 7)}`, kind: 'refugees', place: s.name, to: best ? best.name : 'the neighbours',
                    q: s.q, r: s.r, toQ: best ? best.q : null, toR: best ? best.r : null, n: moved, why: cause, kingdomId: s.kingdom || null,
                });
                if (h) out.news.push(h);
                const intoOwn = best && ruled.has(_key(best.q, best.r));
                const fromOwn = ruled.has(_key(s.q, s.r));
                if (player && (intoOwn || fromOwn)) {
                    out.notices.push(fromOwn
                        ? { icon: '🧳', title: 'Your People Flee', text: `${moved} of the people of ${s.name} have fled the ${cause === 'famine' ? 'hunger' : cause} for safer towns.`, type: 'warning' }
                        : { icon: '🧳', title: 'Refugees Arrive', text: `${bestN} refugees from ${s.name} crowd into ${best.name}, fleeing the ${cause === 'famine' ? 'hunger' : cause}. They need bread and work.`, type: 'info' });
                }
            }
        }

        // Refugees go home once it is safe again
        for (const s of lives) {
            const from = _obj(s.labour.from);
            if (!from) continue;
            for (const [fk, n] of Object.entries(from)) {
                const home = at.get(fk);
                if (!home) { delete from[fk]; continue; }
                if (distress.get(home) >= _num(Rf.safe, 0.2)) continue;
                const back = Math.ceil(_num(n) * _num(Rf.returnShare, 0.25));
                const got = back > 0 ? TownLabour.moveMix(s, home, back, minPop) : 0;
                const left = _num(n) - Math.max(got, back);
                if (left >= 3) from[fk] = left; else delete from[fk];
                if (got > 0) { s.labour.moved.out += got; home.labour.moved.in += got; }
            }
        }

        // Migration: each class drifts toward the town where it fares better
        const budget = new Map();
        const pull = (t) => {
            if (!ruled.has(_key(t.q, t.r))) return 0;
            const lab = t.labour;
            return lab && _num(lab.idle && lab.idle.land) < 0.03 ? _num(M.colonyPull) : 0;
        };
        for (const l of links) {
            const a = l.a, b = l.b;
            if (at.get(_key(a.q, a.r)) !== a || at.get(_key(b.q, b.r)) !== b || a === b) continue;
            const la = a.labour, lb = b.labour;
            if (!la || !lb || !la.wel || !lb.wel) continue;
            const pa = pull(a), pb = pull(b);
            for (const s of STRATA) {
                const gap = (_num(lb.wel[s]) + pb) - (_num(la.wel[s]) + pa);
                if (Math.abs(gap) <= _num(M.threshold, 0.05)) continue;
                const [from, to] = gap > 0 ? [a, b] : [b, a];
                if (distress.get(to) >= _num(Rf.safe, 0.2)) continue;
                const popF = _num(from.population);
                if (popF <= minPop) continue;
                const left = budget.has(from) ? budget.get(from) : Math.floor(popF * _num(M.maxShare, 0.01));
                if (left < 1) continue;
                const mob = _num(C.strata[s] && C.strata[s].mobility, 1);
                const want = Math.floor(popF * from.labour.sh[s] * _num(M.rate, 0.06) * (Math.abs(gap) - _num(M.threshold, 0.05)) * mob);
                const n = Math.min(left, want);
                if (n < 1) continue;
                const got = TownLabour.moveStratum(from, to, s, n, minPop);
                if (!(got > 0)) continue;
                budget.set(from, left - got);
                from.labour.moved.out += got;
                to.labour.moved.in += got;
            }
        }

        // Strikes and booms
        for (const s of lives) {
            const lab = s.labour;
            const key = _key(s.q, s.r);
            if ((RANK[s.type] || 0) >= (RANK[S.minType] || 1) && !TownLabour.striking(s, day) && day - _num(lab.lastStrike, -1e9) >= _num(S.gap, 45)) {
                const wel = _num(lab.wel.artisans, 1);
                // (the real wage is only worked out for artisans badly off)
                const real = () => {
                    const base = TownLabour.baseWage(s.type, 'craft') * Labour.costOfLiving(s);
                    return _num(lab.wage.craft, base) / Math.max(0.01, base);
                };
                const p = (_num(S.below, 0.4) - wel) * _num(S.chance, 2.5);
                if (wel < _num(S.below, 0.4) && real() < _num(S.wageBelow, 0.85) && _roll(`strike:${key}:${day}`) < p) {
                    lab.strike = day + Math.max(1, _num(S.days, 7));
                    lab.lastStrike = day;
                    const h = Labour.record(world, { key: `strike:${key}:${day}`, kind: 'strike', place: s.name, q: s.q, r: s.r, kingdomId: s.kingdom || null, days: _num(S.days, 7) });
                    if (h) out.news.push(h);
                    const works = s.market && s.market.works && Object.values(s.market.works).some(w => w && w.owner === 'player');
                    if (player && (works || ruled.has(key))) {
                        out.notices.push({ icon: '✊', title: 'Strike', text: `The artisans of ${s.name} have downed tools: bread costs more than their wages buy. The trades${works ? ' and your works' : ''} stand idle for ${_num(S.days, 7)} days.`, type: 'warning' });
                    }
                }
            }
            if (lab.all >= _num(S.boomAt, 0.72) && lab.moved.in > lab.moved.out && lab.moved.in >= 10 && _num(s.population) >= 500
                && day - _num(lab.lastBoom, -1e9) >= _num(S.boomGap, 60)) {
                lab.lastBoom = day;
                const h = Labour.record(world, { key: `boom:${key}:${day}`, kind: 'boom', place: s.name, q: s.q, r: s.r, kingdomId: s.kingdom || null, n: lab.moved.in });
                if (h) out.news.push(h);
            }
        }
    },

    /** Keep the `keep` largest homelands a town's refugees remember. */
    _trimFrom(lab, keep) {
        const e = Object.entries(lab.from || {});
        if (e.length <= keep) return;
        e.sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1));
        lab.from = Object.fromEntries(e.slice(0, keep));
    },

    // ── Readers ───────────────────────────────────────────

    /** The player's works short of hands (craft fill below `below`): [{ inv, settlement, fill }]. */
    worksShortHands(player, world, below = 0.85) {
        const out = [];
        const st = player && _obj(player.merchantPrince);
        for (const inv of (st && Array.isArray(st.investments)) ? st.investments : []) {
            const t = world && typeof world.getTile === 'function' ? world.getTile(inv.q, inv.r) : null;
            const s = t && t.settlement;
            if (!s || !s.labour) continue;
            const f = TownLabour.factors(s, world.day).craft;
            if (f < below) out.push({ inv, settlement: s, fill: f, strike: TownLabour.striking(s, world.day) });
        }
        return out;
    },

    /** Recent labour news within `days` (newest first). */
    recent(world, days = 30) {
        const st = world && _obj(world.labour);
        const day = _num(world && world.day);
        return (st && Array.isArray(st.history) ? st.history : []).filter(h => day - _num(h.day) <= days).slice().reverse();
    },
};
