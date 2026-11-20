// ============================================
// WORKS OF THE AGES — great works that span generations
// ============================================
// A cathedral, a university, a great bridge, a royal canal, city walls, a
// castle keep, a great harbour: civic works of 20-60 years, raised by many
// hands and many purses over several reigns. (Not Patronage's Great Works —
// those are one House's private wonder of a few years: systems/patronage.js.)
//
//   FOUNDED in a settlement by the player's House, a rival House, a noble
//     House, the church, the burghers, a guild or the crown. The founder makes
//     the first pledge. A type's `years` is its length at full funding;
//     funding sets the pace (data/greatWorks.json).
//   BUILT in stages, week by week: stone, timber, iron, glass, books bought
//     from the site's market and its nearest towns at the going price (at most
//     a share of a stock a week: a short market slows the work and its price
//     climbs; a good they lack is carted from the far towns at a haulage
//     markup, else a substitute stands in: config `substitutes`), and
//     townsfolk hired at the site's land wage (`settlement.
//     ageWorkHands`, counted by systems/labour.js). Winter halves an outdoor
//     stage.
//   FUNDED by pledges: each funder pays its weekly pledge for its term, in
//     turn with the others; its share of all that was paid is recorded and,
//     when the work is finished, carved over the door (Prestige and renown
//     for the player's House by its share). Pledges belong to the House, not
//     the person: an heir inherits them, their honour — and the shame of
//     breaking one (missing `missedLimit` weeks running, or withdrawing
//     before the term is out).
//   FINISHED, it changes the world for good — read by other systems:
//     cathedral   the realm's piety rises (kingdom.religion.piety), pilgrims
//                 bring coin from the realm's towns, folk move to the town
//                 (migration pull: settlement.ageWorksFx.pull → systems/migration.js)
//     university  the town's and the realm's letters (ageWorksFx.letters →
//                 systems/literacy.js target), scholars draw folk (pull), the
//                 heirs of a House that carved its name there or lives in the
//                 realm learn faster (educationFor → systems/upbringing.js)
//     bridge      the road out of town over the river bridged and made at
//                 least a road (world/transport.js segments: trade links read it)
//     canal       a canal to the paired town (world.transport.canals)
//     walls/keep  siege defence (ageWorksFx.defense → world/townEras.js
//                 wallDefense); walls make the town's walls stone (its street map)
//     harbour     sea hauls from the port cheaper (world.transport.harbours[k].mult)
//   It marks the town's history (TownMemory 'greatwork': its pride), the
//   Timeline of the Realm, the House's chronicle (the Annals, the Chronicle).
//   ABANDONED, unfunded for years it decays, and after `ruinAfterYears` it is
//   a ruin: the town keeps a grudge against those who broke their pledges
//   (TownMemory 'grudge': the town's mood, the House's standing, and it will
//   not let them found another work there), and anyone may resume it.
//   NPC actors found and fund works on their own, monthly.
//
// Coin: every coin moves purse to purse — a funder's (the player's purse,
// a rival House's gold, a landholder's purse in world.estates, a guild's
// treasury, the crown's chests booked as 'works') into the site town's purse
// (its sellers and hands); the town then pays the other towns that sold it
// stone. Nothing is held in escrow and nothing is struck: the coin census
// closes (src/__tests__/greatWorks.test.js).
//
// Deterministic: rolls are hashes of the world seed and the day (no shared
// RNG drawn). Processed once a week (`tickDays`); NPC turns monthly.
// State: world.ageWorks (saved by systems/saveLoad.js); settlement.ageWorksFx
// and settlement.ageWorkHands travel with the tiles.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Transport } from '../world/transport.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { TownEras } from '../world/townEras.js';
import { TownMarks } from '../world/townMarks.js';
import { Barter } from '../world/barter.js';
import { MoneySupply } from '../world/moneySupply.js';
import { PublicWorks } from './publicWorks.js';
import { House } from './house.js';
import { TownMemory } from './townMemory.js';
import { RealmTimeline } from './realmTimeline.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = v => Utils.cents(v);
const _key = (q, r) => `${q},${r}`;
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _DPY = () => _num(Seasons.DAYS_PER_YEAR, 120);
const TYPE_RANK = { hamlet: 0, camp: 0, village: 1, town: 2, city: 3, capital: 4 };
const LIVE = new Set(['building', 'stalled']);

/** A well-mixed hash of a string (FNV-1a with a murmur finish) → uint32. */
function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return h >>> 0;
}

/** A deterministic roll in [0, 1) from the world seed and the parts (no shared RNG drawn). */
function _roll(world, ...parts) {
    const p = world && world.generationParams;
    const seed = p && p.seed != null ? p.seed : 0;
    return _hash(`${seed}|ageWorks|${parts.join('|')}`) / 4294967296;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _town(world, q, r) {
    const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
    return t && t.settlement ? t.settlement : null;
}

function _views(world) {
    const out = [];
    const vs = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
    for (const v of vs) {
        if (!v || !Number.isFinite(v.q)) continue;
        const s = _town(world, v.q, v.r) || v;
        if (!s || s.ruined || s.destroyed) continue;
        out.push({ q: v.q, r: v.r, s });
    }
    return out;
}

function _basePrice(goodId) {
    const gd = DataLoader._gamedata;
    const G = gd && gd.playerEconomy && gd.playerEconomy.GOODS;
    const g = G && G[String(goodId).toUpperCase()];
    return g && g.basePrice > 0 ? g.basePrice : 5;
}

function _price(town, g) {
    const sc = town && SettlementMarket.tracks(g) ? SettlementMarket.scarcity(town, g) : 1;
    return _basePrice(g) * _num(sc, 1);
}

function _year(world) {
    return Math.floor(_num(world && world.year, _num(world && world.baseYear, 853)));
}

/** "a cathedral", "an abbey", "city walls" (a plural name takes no article). */
function _a(name) {
    const n = String(name || '');
    if (/[^s]s$/i.test(n)) return n;
    // ("a university", "a eulogy": a vowel that sounds as "you" takes "a")
    return `${/^[aeiou]/i.test(n) && !/^(uni|use|usu|eu|one)/i.test(n) ? 'an' : 'a'} ${n}`;
}

/** A work's title mid-sentence: "The Cathedral of X" → "the Cathedral of X"; a bare name gains "the". */
function _the(name) {
    const n = String(name || '');
    return /^the\s/i.test(n) ? `the ${n.slice(4)}` : `the ${n}`;
}

function _fill(t, o) {
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (o[k] != null ? o[k] : m));
}

export const GreatWorks = {
    /** A work's name with its article, for a line: "a cathedral", "city walls". */
    withArticle(name) { return _a(name); },


    // ── Data ──────────────────────────────────────────────

    config() {
        const gd = DataLoader._gamedata;
        return _obj(gd && gd.greatWorks) || { enabled: false, types: {} };
    },

    types() {
        return _obj(GreatWorks.config().types) || {};
    },

    type(id) {
        return GreatWorks.types()[id] || null;
    },

    enabled() {
        return GreatWorks.config().enabled !== false && Object.keys(GreatWorks.types()).length > 0;
    },

    // ── State ─────────────────────────────────────────────

    state(world) {
        if (!world) return null;
        let st = _obj(world.ageWorks);
        if (!st || st.v !== 1) st = world.ageWorks = { v: 1, seq: 1, works: [], ticks: 0, lastTick: null, fxTowns: [], log: [] };
        if (!Array.isArray(st.works)) st.works = [];
        if (!Array.isArray(st.fxTowns)) st.fxTowns = [];
        if (!Array.isArray(st.log)) st.log = [];
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.ageWorks);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.ageWorks = _obj(saved) && saved.v === 1 ? JSON.parse(JSON.stringify(saved)) : null;
    },

    works(world, filter = null) {
        const st = _obj(world && world.ageWorks);
        const list = st && Array.isArray(st.works) ? st.works : [];
        return filter ? list.filter(filter) : list.slice();
    },

    work(world, id) {
        return GreatWorks.works(world).find(w => w.id === id) || null;
    },

    // ── Sums ──────────────────────────────────────────────

    /** Weeks a type takes at full funding. */
    totalWeeks(T) {
        return Math.max(1, _num(T && T.years, 30) * _DPY() / 7);
    },

    /** Goods the whole work wants: { good: units }. */
    goodsOf(T) {
        const out = {};
        for (const st of (T && T.stages) || []) for (const [g, n] of Object.entries(st.goods || {})) out[g] = _num(out[g]) + _num(n);
        return out;
    },

    /**
     * The estimate: { goods, wages, total, weekly } (weekly = at full funding). Goods at
     * the site's going price, never under base nor over estimateCap times it (a dear
     * market at the founding is not the price of forty years), else at base prices.
     */
    estimate(T, site = null) {
        const capX = Math.max(1, _num(GreatWorks.config().estimateCap, 1));
        let goods = 0;
        for (const [g, n] of Object.entries(GreatWorks.goodsOf(T))) {
            const b = _basePrice(g);
            const p = site && site.market && SettlementMarket.tracks(g) ? Math.max(b, Math.min(b * capX, _price(site, g))) : b;
            goods += _num(n) * p;
        }
        const weeks = GreatWorks.totalWeeks(T);
        const wages = _num(T && T.hands, 8) * PublicWorks._wage(site) * 7 * weeks;
        const total = Math.round(goods + wages);
        return { goods: Math.round(goods), wages: Math.round(wages), total, weekly: _r2(total / weeks) };
    },

    /** The stage index a share of the work stands in. */
    stageAt(T, prog) {
        const S = (T && T.stages) || [];
        let acc = 0;
        for (let i = 0; i < S.length; i++) {
            acc += _num(S[i].share);
            if (prog < acc - 1e-9) return i;
        }
        return Math.max(0, S.length - 1);
    },

    /** Where the stage ends (share of the whole). */
    stageEnd(T, i) {
        let acc = 0;
        for (let j = 0; j <= i && j < T.stages.length; j++) acc += _num(T.stages[j].share);
        return Math.min(1, acc);
    },

    /** Paid in by everyone. */
    paidTotal(w) {
        return (w.funders || []).reduce((s, f) => s + _num(f.paid), 0);
    },

    /** The weekly pledges now standing. */
    pledged(w) {
        return (w.funders || []).filter(f => f.status === 'active').reduce((s, f) => s + _num(f.weekly), 0);
    },

    /** Years at the pace now pledged (null: none pledged). */
    yearsLeft(w) {
        const T = GreatWorks.type(w.type);
        const p = GreatWorks.pledged(w);
        if (!T || !(p > 0)) return null;
        const pace = Math.min(_num(GreatWorks.config().maxPace, 1.6), p / Math.max(0.01, w.full));
        return Math.ceil((1 - w.prog) * _num(T.years, 30) / Math.max(0.01, pace));
    },

    /** How many works may be live at once in the world: a share of its towns, at most maxLive. */
    cap(world, towns = null) {
        const C = GreatWorks.config();
        const n = towns != null ? towns : _views(world).length;
        return n ? Math.min(_num(C.maxLive, 14), Math.max(1, Math.floor(n / Math.max(1, _num(C.townsPerWork, 7))))) : 0;
    },

    // ── Where a work may rise ─────────────────────────────

    /** The unbridged river road out of a town (a segment), or null. */
    _riverRoad(world, s) {
        let best = null;
        for (const seg of Transport.segmentsOf(world, s.q, s.r)) {
            if (!seg || !seg.rivers || !seg.rivers.length) continue;
            const ss = Transport.segState(world, seg);
            if (ss.x === 'bridge') continue;
            if (!best || seg.rivers.length > best.rivers.length) best = seg;
        }
        return best;
    },

    /** The best town to cut a canal to from `s`: { pk, other } or null. */
    _canalPartner(world, s) {
        const st = Transport.state(world);
        const ak = _key(s.q, s.r);
        let best = null, bestV = 0;
        for (const v of _views(world)) {
            if (v.s === s || v.s.kingdom !== s.kingdom) continue;
            const d = Hex.wrappingDistance(s.q, s.r, v.q, v.r, world.width);
            if (d < 3 || d > 10) continue;
            const bk = _key(v.q, v.r);
            const pk = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
            if (st.canals[pk]) continue;
            const val = _num(s.population) * _num(v.s.population);
            if (val <= bestV) continue;
            if (PublicWorks._target(world, 'canal', pk).reason) continue;
            best = { pk, other: v.s }; bestV = val;
        }
        return best;
    },

    /**
     * May a work of `typeId` be founded at settlement `s`? → { ok, reason,
     * target, other } (target: the river road's key, the canal's pair).
     */
    siteCheck(world, s, typeId) {
        const T = GreatWorks.type(typeId);
        if (!T) return { ok: false, reason: 'Unknown work.' };
        if (!s) return { ok: false, reason: 'There is no town here.' };
        const rank = TYPE_RANK[s.type] != null ? TYPE_RANK[s.type] : 1;
        if (rank < _num(TYPE_RANK[T.minType], 1)) return { ok: false, reason: `Only a ${T.minType} or greater can raise ${_a(T.name.toLowerCase())}.` };
        const here = GreatWorks.works(world, w => w.q === s.q && w.r === s.r);
        if (here.some(w => LIVE.has(w.status))) return { ok: false, reason: 'A great work is already rising here.' };
        if (here.some(w => w.type === typeId && w.status === 'done')) return { ok: false, reason: `${s.name} has its ${T.name.toLowerCase()}.` };
        if (here.some(w => w.type === typeId && w.status === 'ruin')) return { ok: false, reason: `The ruin of the old ${T.name.toLowerCase()} stands here: resume it instead.` };
        const out = { ok: true, reason: '', target: null, other: null };
        if (T.requires === 'river') {
            const seg = GreatWorks._riverRoad(world, s);
            if (!seg) return { ok: false, reason: 'No road out of town crosses an unbridged river.' };
            out.target = seg.key;
        } else if (T.requires === 'port') {
            if (!KingdomNavy.isPortTile(world, s.q, s.r)) return { ok: false, reason: `${s.name} is no port.` };
        } else if (T.requires === 'canal') {
            const p = GreatWorks._canalPartner(world, s);
            if (!p) return { ok: false, reason: 'No town of the realm lies where a canal could be cut to it.' };
            out.target = p.pk; out.other = p.other;
        }
        if (T.effects && T.effects.walls) {
            const e = TownEras.state(s);
            if (e && e.walls && e.walls.kind === 'stone') return { ok: false, reason: `${s.name} is already walled in stone.` };
        }
        return out;
    },

    // ── Funders' purses ───────────────────────────────────

    /** A funder's kind as the types' weights name it. */
    _weightKey(f) {
        if (f.kind === 'holder') return f.sub === 'town' ? 'burghers' : f.sub;
        return f.kind;
    },

    /**
     * A funder's purse now: { have, take(a) → coin moved } or null when it
     * cannot be asked (the player away between lives, a House gone).
     */
    _purse(world, player, f) {
        if (f.kind === 'player') {
            if (!player || !player.house || player.house.id !== f.house) return null;
            return {
                have: Math.max(0, _num(Barter.coinOf(player))),
                take(a) {
                    const c0 = Math.max(0, _num(Barter.coinOf(player)));
                    player.gold = _r2(_num(player.gold) - a);
                    Ledger.record(player, 'greatWorks', -a);
                    return _r2(c0 - Math.max(0, _num(Barter.coinOf(player))));
                },
            };
        }
        if (f.kind === 'rival') {
            const h = player && player.house && _obj(player.house.rivals) ? player.house.rivals[f.ref] : null;
            if (!player) return null;
            if (!h || h.extinct) return { have: 0, take: () => 0 };
            return { have: Math.max(0, _num(h.gold)), take(a) { h.gold = _r2(_num(h.gold) - a); return a; } };
        }
        if (f.kind === 'holder') {
            const est = _obj(world && world.estates);
            const h = est && _obj(est.holders) ? est.holders[f.ref] : null;
            if (!h) return { have: 0, take: () => 0 };
            return { have: Math.max(0, _num(h.purse)), take(a) { h.purse = _r2(_num(h.purse) - a); return a; } };
        }
        if (f.kind === 'guild') {
            const s = _town(world, f.q, f.r);
            const g = s && _obj(s.guilds) ? s.guilds[f.ref] : null;
            if (!g) return { have: 0, take: () => 0 };
            return { have: Math.max(0, _num(g.treasury)), take(a) { g.treasury = _r2(_num(g.treasury) - a); return a; } };
        }
        if (f.kind === 'crown') {
            const k = _kingdom(world, f.ref);
            if (!k || k.isAlive === false) return { have: 0, take: () => 0 };
            const N = GreatWorks.config().npc || {};
            // (a crown at war keeps a war chest first: its works wait, and may be left to stall)
            const floor = _num(N.crownFloor, 1500) + (Array.isArray(k.wars) && k.wars.length ? _num(N.crownWarChest, 0) : 0);
            return {
                have: Math.max(0, _num(k.treasury) - floor),
                take(a) { k.treasury = _r2(_num(k.treasury) - a); CrownBooks.note(k, 'works', a); return a; },
            };
        }
        return { have: 0, take: () => 0 };
    },

    /** Everyone who could fund a work at `s` now: [{ kind, sub, ref, key, name, have, q, r, house }]. */
    actors(world, player, s, ctx = null) {
        const out = [];
        if (!world || !s) return out;
        const kid = s.kingdom;
        const k = _kingdom(world, kid);
        if (k && k.isAlive !== false) {
            const p = GreatWorks._purse(world, player, { kind: 'crown', ref: k.id });
            out.push({ kind: 'crown', sub: null, ref: k.id, key: `crown:${k.id}`, name: `the Crown of ${k.name}`, have: p.have });
        }
        const holders = ctx && ctx.holders ? (ctx.holders.get(kid) || []) : GreatWorks._holdersOf(world, kid);
        for (const h of holders) {
            if (h.kind === 'town' && !String(h.id).startsWith(`town:${s.q}:${s.r}`)) continue;
            out.push({ kind: 'holder', sub: h.kind, ref: h.id, key: `holder:${h.id}`, name: h.name || 'a landholder', have: Math.max(0, _num(h.purse)) });
        }
        if (_obj(s.guilds)) {
            for (const [gid, g] of Object.entries(s.guilds)) {
                if (!g) continue;
                out.push({ kind: 'guild', sub: null, ref: gid, key: `guild:${s.q},${s.r}:${gid}`, name: g.name || 'the guild', have: Math.max(0, _num(g.treasury)), q: s.q, r: s.r });
            }
        }
        const rivals = player && player.house && _obj(player.house.rivals);
        if (rivals) {
            for (const [rk, h] of Object.entries(rivals)) {
                if (!h || h.extinct || String(h.kingdomId != null ? h.kingdomId : rk) !== String(kid)) continue;
                out.push({ kind: 'rival', sub: null, ref: rk, key: `rival:${rk}`, name: h.name || 'a rival House', have: Math.max(0, _num(h.gold)) });
            }
        }
        return out;
    },

    _holdersOf(world, kid) {
        const est = _obj(world && world.estates);
        if (!est || !_obj(est.holders)) return [];
        return Object.values(est.holders).filter(h => h && String(h.kid) === String(kid) && ['noble', 'church', 'town'].includes(h.kind) && _num(h.purse) > 0);
    },

    // ── The day ───────────────────────────────────────────

    /** Once every `tickDays`: the works build, the finished bless, NPCs found and pledge (monthly). → { notices } */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || typeof world.getTile !== 'function' || !GreatWorks.enabled()) return out;
        const C = GreatWorks.config();
        const day = _day(world);
        const every = Math.max(1, _num(C.tickDays, 7));
        if (day % every !== 0) return out;
        const st = GreatWorks.state(world);
        if (st.lastTick === day) return out;
        st.lastTick = day;
        st.ticks = _num(st.ticks) + 1;
        const ctx = { day, player, realmTowns: null };
        for (const w of st.works) {
            if (!w) continue;
            if (LIVE.has(w.status)) GreatWorks._build(world, player, w, day, out);
            else if (w.status === 'done') GreatWorks._bless(world, w, ctx);
        }
        if (st.ticks % Math.max(1, _num(C.monthTicks, 4)) === 0 || !st.fxReady) {
            GreatWorks._npcMonth(world, player, day, out);
            GreatWorks.refreshFx(world);
            st.fxReady = true;
        }
        return out;
    },

    /** A funder's pledge comes due: the term run out, the House changed hands. */
    _sweepFunders(world, player, w, day, out) {
        for (const f of w.funders) {
            if (f.status !== 'active') continue;
            if (f.until != null && day >= f.until) {
                f.status = 'done';
                f.ended = day;
                if (f.kind === 'player' && player) out.notices.push({ icon: '🤝', title: 'Pledge Fulfilled', text: `Your House's pledge to ${_the(w.name)} is paid in full. Its name will stand among the builders.`, type: 'success' });
            } else if (f.kind === 'player' && player && player.house && player.house.id !== f.house) {
                // (a new life of another House: the old line's pledge lapses — not this House's shame)
                f.status = 'lapsed';
                f.ended = day;
            }
        }
    },

    _build(world, player, w, day, out) {
        const C = GreatWorks.config();
        const T = GreatWorks.type(w.type);
        const site = _town(world, w.q, w.r);
        if (!T || !site) {
            // (the town is gone: so is the work)
            w.status = 'ruin';
            w.ruinDay = day;
            site && (site.ageWorkHands = 0);
            return;
        }
        GreatWorks._sweepFunders(world, player, w, day, out);
        const P = C.pledge || {};
        const avail = [];
        let A = 0;
        for (const f of w.funders) {
            if (f.status !== 'active') continue;
            const p = GreatWorks._purse(world, player, f);
            if (!p) continue;
            const a = Math.min(_num(f.weekly), Utils.centsDown(p.have));
            if (a < _num(f.weekly) * 0.5) {
                f.missed = _num(f.missed) + 1;
                if (f.missed >= _num(P.missedLimit, 6)) { GreatWorks._break(world, player, w, f, day, out, 'missed'); continue; }
            } else f.missed = 0;
            if (a > 0) { avail.push({ f, p, a }); A += a; }
        }
        A = _r2(A);
        if (!(A >= Math.max(0.01, w.full * _num(C.minWeekShare, 0.05)))) {
            GreatWorks._unfunded(world, player, w, site, day, out);
            return;
        }
        w.stallFrom = null;
        w.status = 'building';
        const si = GreatWorks.stageAt(T, w.prog);
        const stage = T.stages[si];
        const winter = Seasons.seasonOf(day) === 'Winter' && stage.outdoor;
        const pace = Math.min(_num(C.maxPace, 1.6), A / Math.max(0.01, w.full)) * (winter ? _num(C.winterPace, 0.5) : 1);
        let ds = Math.min(pace / GreatWorks.totalWeeks(T), Math.max(0, GreatWorks.stageEnd(T, si) - w.prog) + 1e-9);
        const store = w.store || (w.store = {});
        const wage = PublicWorks._wage(site) * _num(T.hands, 8) * 7;
        const plan = (d) => {
            const dStage = d / Math.max(1e-9, _num(stage.share, 1));
            let cost = wage * pace;
            const need = {};
            for (const [g, n] of Object.entries(stage.goods || {})) {
                need[g] = Math.max(0, dStage * _num(n) - _num(store[g]));
                cost += need[g] * _price(site, g);
            }
            return { dStage, need, cost };
        };
        let pl = plan(ds);
        let wageWeek = wage * pace;
        if (pl.cost > A) {
            const sc = A / pl.cost;
            ds *= sc; wageWeek *= sc;
            pl = plan(ds);
        }
        // Buy: the site's market first, then the nearest towns that keep the good; a good
        // they cannot supply is carted from the far towns (supplyFarRange), its price plus
        // the carters' haulPerHex a hex (paid to the selling town, whose carters they are);
        // still short, a substitute stands in (substitutes: iron cramps → tools, sawn planks →
        // timber, books → parchment for the copyists), at its own price
        const bills = new Map();
        const share = Math.max(0.01, _num(C.drawShare, 0.25));
        let budget = A - wageWeek;
        const buy = (g, want, towns) => {
            let got0 = 0;
            for (const { town, mult } of towns) {
                if (!(want - got0 > 0.001) || !(budget > 0.01)) break;
                const price = _price(town, g) * mult;
                // (in lots of at least a twentieth of a unit: the rest waits in the yard for next week)
                const take = Math.min(Math.max(want - got0, 0.05), SettlementMarket.stock(town, g) * share, budget / Math.max(0.01, price));
                if (!(take > 0.01)) continue;
                const got = SettlementMarket.take(town, g, take);
                if (!(got > 0)) continue;
                const bill = got * price;
                bills.set(town, _num(bills.get(town)) + bill);
                budget -= bill;
                got0 += got;
            }
            return got0;
        };
        const near = [{ town: site, mult: 1 }, ...GreatWorks._supply(world, w).map(town => ({ town, mult: 1 }))];
        let far = null;
        const SUB = _obj(C.substitutes) || {};
        for (const [g, n0] of Object.entries(pl.need)) {
            let want = n0;
            if (!(want > 0.001) || !SettlementMarket.tracks(g)) continue;
            let got = buy(g, want, near);
            if (want - got > 0.001) {
                far = far || GreatWorks._farSupply(world, w);
                got += buy(g, want - got, far);
            }
            store[g] = _num(store[g]) + got;
            want -= got;
            for (const [alt, per] of Object.entries(_obj(SUB[g]) || {})) {
                if (!(want > 0.001) || !(per > 0) || !SettlementMarket.tracks(alt)) continue;
                const altGot = buy(alt, want * per, near);
                if (!(altGot > 0)) continue;
                store[g] = _num(store[g]) + altGot / per;
                want -= altGot / per;
                w.subs = _obj(w.subs) || {};
                w.subs[alt] = _r2(_num(w.subs[alt]) + altGot);
            }
        }
        // What the materials allow
        let f = 1, short = null;
        for (const [g, n] of Object.entries(stage.goods || {})) {
            const want = pl.dStage * _num(n);
            if (want > 0.001 && _num(store[g]) / want < f) { f = _num(store[g]) / want; short = g; }
        }
        f = Math.max(0, Math.min(1, f));
        // (what held the week back: the panel's "waiting on iron")
        w.matF = Math.round(f * 100) / 100;
        w.short = f < 0.95 ? short : null;
        for (const [g, n] of Object.entries(stage.goods || {})) {
            store[g] = Math.max(0, _num(store[g]) - pl.dStage * f * _num(n));
            if (store[g] < 0.001) delete store[g];
        }
        // The hands: paid for the week they worked (less when the stone ran short)
        const wages = wageWeek * Math.max(0.3, f);
        let goodsBill = 0;
        for (const v of bills.values()) goodsBill += v;
        const due = Math.min(A, _r2(goodsBill + wages));
        // The funders pay in turn, each its share of the week's due, into the site's purse
        let drawn = 0;
        avail.forEach((x, i) => {
            let part = i === avail.length - 1 ? _r2(due - drawn) : Utils.centsDown(due * x.a / A);
            part = Math.max(0, Math.min(part, x.a));
            if (!(part > 0)) return;
            const moved = x.p.take(part);
            if (moved > 0) GreatWorks._payTown(world, site, moved);
            x.f.paid = _r2(_num(x.f.paid) + part);
            x.f.last = day;
            drawn = _r2(drawn + part);
        });
        // ...and the site pays the other towns for their stone
        for (const [town, bill] of bills) {
            if (town === site) continue;
            const got = Economy.drawTown(site, _r2(bill));
            if (got > 0) GreatWorks._payTown(world, town, got);
        }
        w.spent = _r2(_num(w.spent) + drawn);
        const before = si;
        w.prog = Math.min(1, w.prog + ds * f);
        w.lastWork = day;
        site.ageWorkHands = Math.round(_num(T.hands, 8) * Math.min(2, pace) * Math.max(0.3, f));
        w.hands = site.ageWorkHands;
        if (w.prog >= 1 - 1e-6) { GreatWorks._complete(world, player, w, site, day, out); return; }
        const now = GreatWorks.stageAt(T, w.prog);
        if (now > before) GreatWorks._stageDone(world, player, w, T, before, day, out);
    },

    /** Coin into a town's purse; a town keeping none: the nearest that does (else booked lost). */
    _payTown(world, town, amount) {
        const a = _r2(amount);
        if (!(a > 0)) return;
        if (town && Economy.townPurse(town) != null && Economy.payTown(town, a)) return;
        if (town && !town.inKind && !town.economy && _num(town.population) > 0) {
            Economy.initSettlement(town);
            town.economy.gold = 0;
            if (Economy.payTown(town, a)) return;
        }
        if (town && Economy.payNearest(world, town.q, town.r, a)) return;
        // (no town anywhere keeps coin: it is lost to the books)
        MoneySupply.leak(world, -a, 'greatWorks');
    },

    /** The nearest towns that sell to the site (cached on the work). */
    _supply(world, w) {
        const C = GreatWorks.config();
        if (!Array.isArray(w.supply)) {
            const n = Math.max(0, _num(C.supplyTowns, 2));
            const range = _num(C.supplyRange, 9);
            w.supply = _views(world)
                .filter(v => !(v.q === w.q && v.r === w.r))
                .map(v => ({ q: v.q, r: v.r, d: Hex.wrappingDistance(w.q, w.r, v.q, v.r, world.width) }))
                .filter(v => v.d <= range)
                .sort((a, b) => a.d - b.d || a.q - b.q || a.r - b.r)
                .slice(0, n).map(v => [v.q, v.r]);
        }
        return w.supply.map(([q, r]) => _town(world, q, r)).filter(Boolean);
    },

    /** The far towns that cart a short good to the site: [{ town, mult }], their price plus haulage by distance (cached on the work). */
    _farSupply(world, w) {
        const C = GreatWorks.config();
        const n = Math.max(0, _num(C.supplyFarTowns, 0));
        if (!(n > 0)) return [];
        if (!Array.isArray(w.far)) {
            const range = _num(C.supplyFarRange, 24);
            const nearSet = new Set((Array.isArray(w.supply) ? w.supply : []).map(([q, r]) => _key(q, r)));
            w.far = _views(world)
                .filter(v => !(v.q === w.q && v.r === w.r) && !nearSet.has(_key(v.q, v.r)))
                .map(v => ({ q: v.q, r: v.r, d: Hex.wrappingDistance(w.q, w.r, v.q, v.r, world.width) }))
                .filter(v => v.d <= range)
                .sort((a, b) => a.d - b.d || a.q - b.q || a.r - b.r)
                .slice(0, n).map(v => [v.q, v.r, v.d]);
        }
        const hp = _num(C.haulPerHex, 0.02);
        return w.far.map(([q, r, d]) => ({ town: _town(world, q, r), mult: 1 + hp * d })).filter(x => x.town);
    },

    _unfunded(world, player, w, site, day, out) {
        const C = GreatWorks.config();
        const S = C.stall || {};
        const Y = _DPY();
        site.ageWorkHands = 0;
        w.hands = 0;
        if (w.status !== 'stalled') {
            w.status = 'stalled';
            w.stallFrom = day;
            if (GreatWorks._playerFunds(w, player) || GreatWorks._near(world, player, w)) out.notices.push({ icon: '🚧', title: 'Great Work Stalled', text: `Work on ${_the(w.name)} has stopped: no one is paying for it. Pledge to it from Works of the Ages.`, type: 'warning' });
        }
        if (w.stallFrom == null) w.stallFrom = day;
        const years = (day - w.stallFrom) / Y;
        if (years >= _num(S.decayAfterYears, 2)) {
            // Weather and thieves: the stone carted off, the scaffolding rots
            const T = GreatWorks.type(w.type);
            w.prog = Math.max(0, w.prog * (1 - _num(S.decayPerYear, 0.04) * 7 / Y));
            for (const g of Object.keys(w.store || {})) { w.store[g] *= 0.95; if (w.store[g] < 0.01) delete w.store[g]; }
            if (T) w.stage = GreatWorks.stageAt(T, w.prog);
        }
        if (years >= _num(S.ruinAfterYears, 8)) GreatWorks._ruin(world, player, w, site, day, out);
    },

    // ── Honour and shame ──────────────────────────────────

    _shame(player, amount, reason, day) {
        const house = player && player.house;
        if (!house) return 0;
        const loss = Math.min(Math.max(0, _num(house.prestige)), Math.max(0, amount));
        if (loss > 0) {
            house.prestige -= loss;
            House._logPrestige(house, day, -loss, reason);
        }
        return loss;
    },

    _break(world, player, w, f, day, out, why) {
        const H = GreatWorks.config().honour || {};
        f.status = 'broken';
        f.ended = day;
        f.why = why;
        if (!Array.isArray(w.broken)) w.broken = [];
        w.broken.push({ key: f.key, name: f.name, kind: f.kind, house: f.house || null, day });
        GreatWorks._log(world, day, `${f.name} broke its pledge to ${_the(w.name)}.`);
        if (f.kind === 'player' && player && player.house) {
            const lost = GreatWorks._shame(player, _num(H.brokenShame, 25), `broke a pledge: ${w.name}`, day);
            House._chronicle(player.house, world, `${player.house.name} broke its pledge to ${_the(w.name)} at ${w.town}.`, ['greatWork', 'betrayal']);
            player.house.stats = player.house.stats || {};
            player.house.stats.pledgesBroken = _num(player.house.stats.pledgesBroken) + 1;
            out.notices.push({ icon: '💔', title: 'A Pledge Broken', text: `${why === 'withdrew' ? 'You withdraw' : 'Your House could not pay'} its pledge to ${_the(w.name)}. ${w.town} will remember it${lost > 0 ? ` (−${Math.round(lost)} Prestige)` : ''}.`, type: 'error' });
        }
    },

    _ruin(world, player, w, site, day, out) {
        const C = GreatWorks.config();
        const H = C.honour || {};
        const Y = _DPY();
        w.status = 'ruin';
        w.ruinDay = day;
        w.stallFrom = null;
        // Who left it to fall: those who broke their pledges to it in its last years, else its founder
        const since = day - (_num(C.stall && C.stall.ruinAfterYears, 8) + 12) * Y;
        let by = (w.broken || []).filter(b => b.day >= since);
        if (!by.length && w.founder) by = [{ key: w.founder.key, name: w.founder.name, kind: w.founder.kind, house: w.founder.house || null }];
        const seen = new Set();
        by = by.filter(b => (seen.has(b.key) ? false : (seen.add(b.key), true)));
        const byPlayer = by.some(b => b.kind === 'player');
        w.abandonedBy = by.map(b => ({ key: b.key, name: b.name, kind: b.kind, house: b.house || null }));
        try {
            TownMemory.mark(site, 'grudge', {
                work: w.name, wid: w.id, wt: w.type, by: by.map(b => b.name).join(', '),
                keys: by.map(b => b.key), houses: by.map(b => b.house).filter(Boolean),
                byPlayer, mood: _num(H.grudgeMood, -3), years: _num(H.grudgeYears, 60),
            }, world);
        } catch (e) { /* the town keeps no memory */ }
        GreatWorks._timeline(world, day, w, `The ${w.name} was left a ruin.`, 3);
        GreatWorks._log(world, day, `The ${w.name} has fallen to ruin${by.length ? `; ${w.town} blames ${by.map(b => b.name).join(', ')}` : ''}.`);
        if (byPlayer && player && player.house) {
            const lost = GreatWorks._shame(player, _num(H.abandonShame, 35), `abandoned: ${w.name}`, day);
            House._chronicle(player.house, world, `The ${w.name} at ${w.town}, abandoned by ${player.house.name}, fell to ruin.`, ['greatWork', 'betrayal']);
            out.notices.push({ icon: '🏚️', title: 'A Work Fallen to Ruin', text: `The ${w.name} is a ruin, and ${w.town} lays it at your House's door${lost > 0 ? ` (−${Math.round(lost)} Prestige)` : ''}. Anyone may still take it up again.`, type: 'error' });
        } else if (GreatWorks._near(world, player, w)) {
            out.notices.push({ icon: '🏚️', title: 'A Work Fallen to Ruin', text: `The half-built ${w.name} has been left to ruin. It could still be resumed.`, type: 'info' });
        }
    },

    _stageDone(world, player, w, T, i, day, out) {
        const H = GreatWorks.config().honour || {};
        const stage = T.stages[i];
        GreatWorks._log(world, day, `${stage.name}: done at ${_the(w.name)}.`);
        if (GreatWorks._playerFunds(w, player)) {
            House.award(player.house, _num(H.stagePrestige, 4), `${w.name}: ${stage.name}`, day);
            House._chronicle(player.house, world, `At ${w.town}, the ${stage.name.toLowerCase()} of ${_the(w.name)} were finished, paid for in part by ${player.house.name}.`, ['greatWork', 'patronage']);
            out.notices.push({ icon: T.icon || '🏗️', title: `${w.name}`, text: `${stage.name}: finished. ${T.stages[i + 1] ? `Now: ${T.stages[i + 1].name.toLowerCase()}.` : ''}`, type: 'success' });
        }
    },

    _complete(world, player, w, site, day, out) {
        const C = GreatWorks.config();
        const H = C.honour || {};
        const T = GreatWorks.type(w.type);
        w.status = 'done';
        w.done = day;
        w.prog = 1;
        w.store = {};
        site.ageWorkHands = 0;
        w.hands = 0;
        for (const f of w.funders) if (f.status === 'active') { f.status = 'done'; f.ended = day; }
        const total = GreatWorks.paidTotal(w);
        const min = _num(H.carveMinShare, 0.03);
        w.carved = w.funders
            .map(f => ({ key: f.key, name: f.name, kind: f.kind, house: f.house || null, share: total > 0 ? _num(f.paid) / total : 0, paid: _num(f.paid) }))
            .filter(c => c.share >= min || (w.founder && c.key === w.founder.key))
            .sort((a, b) => b.share - a.share);
        GreatWorks._applyWorld(world, w, site, day);
        const names = w.carved.slice(0, 4).map(c => c.name);
        try { TownMemory.mark(site, 'greatwork', { work: w.name, wid: w.id, wt: w.type, carved: names.join(', '), houses: w.carved.filter(c => c.kind === 'player' && c.house).map(c => c.house), pride: _num(H.pride, 3) }, world); } catch (e) { /* no memory */ }
        GreatWorks._timeline(world, day, w, `The ${w.name} was finished after ${Math.round((day - w.founded) / _DPY())} years.`, 7);
        GreatWorks._log(world, day, `The ${w.name} stands finished${names.length ? `; carved over its door: ${names.join(', ')}` : ''}.`);
        // The player's House: its name on the stone, by its share
        const mine = player && player.house ? w.carved.find(c => c.kind === 'player' && c.house === player.house.id) : null;
        if (mine) {
            const pr = Math.round(_num(T && T.prestige, 60) * (0.25 + mine.share) * _num(H.prestigeBase, 60) / 60);
            House.award(player.house, pr, `great work: ${w.name}`, day);
            player.house.stats = player.house.stats || {};
            player.house.stats.greatWork = _num(player.house.stats.greatWork) + 1;
            player.house.stats.ageWorks = _num(player.house.stats.ageWorks) + 1;
            player.renown = _num(player.renown) + Math.round(pr * _num(H.renownPerPrestige, 0.2));
            House._chronicle(player.house, world, `The ${w.name} at ${w.town} was completed after ${Math.round((day - w.founded) / _DPY())} years; the name of ${player.house.name} is carved over its door among its builders (${Math.round(mine.share * 100)}% of the cost).`, ['greatWork', 'patronage']);
            out.notices.push({ icon: (T && T.icon) || '🏛️', title: 'A Work of the Ages Completed!', text: `The ${w.name} stands finished. ${player.house.name}'s name is carved over its door (${Math.round(mine.share * 100)}% of its cost; +${pr} Prestige).`, type: 'success' });
        } else if (GreatWorks._near(world, player, w)) {
            out.notices.push({ icon: (T && T.icon) || '🏛️', title: 'A Work of the Ages Completed', text: `After ${Math.round((day - w.founded) / _DPY())} years ${_the(w.name)} stands finished${names.length ? `, raised by ${names.join(', ')}` : ''}.`, type: 'info' });
        }
    },

    // ── What a finished work changes ──────────────────────

    _applyWorld(world, w, site, day) {
        const T = GreatWorks.type(w.type);
        const E = (T && T.effects) || {};
        if (E.walls) {
            const st = TownEras.ensure(world, site);
            if (st) st.walls = { kind: E.walls, year: _year(world), great: w.id };
        }
        if (E.bridge && w.target) {
            const seg = Transport.segment(world, w.target);
            if (seg) {
                const s0 = Transport.segState(world, seg);
                const fields = { x: 'bridge', c: 100, cl: null };
                if (s0.t === 'track') fields.t = 'road';
                const s = Transport.setSegment(world, seg, fields);
                if (s) { delete s.wash; s.great = w.id; }
                Transport.record(world, { kind: 'bridge_built', seg, day, own: false, work: w.id });
            }
        }
        if (E.canal && w.target) {
            const st = Transport.state(world);
            st.canals[w.target] = { id: w.id, owner: 'greatWork', toll: false, day };
            Transport.record(world, { kind: 'canal_opened', place: w.town, other: w.other || 'the town', q: w.q, r: w.r, day, kingdomId: site.kingdom, own: false, work: w.id });
        }
        if (Number.isFinite(E.seaHaul)) {
            const st = Transport.state(world);
            const k = _key(w.q, w.r);
            const h = _obj(st.harbours[k]) || { id: w.id, owner: 'greatWork', day };
            h.great = w.id;
            h.mult = E.seaHaul;
            st.harbours[k] = h;
            Transport.record(world, { kind: 'harbour_built', place: w.town, other: '', q: w.q, r: w.r, day, kingdomId: site.kingdom, own: false, work: w.id });
        }
    },

    /** The finished works' standing effects on the towns (settlement.ageWorksFx), rebuilt monthly. */
    refreshFx(world) {
        const st = GreatWorks.state(world);
        if (!st) return;
        for (const [q, r] of st.fxTowns) { const s = _town(world, q, r); if (s) delete s.ageWorksFx; }
        st.fxTowns = [];
        const done = st.works.filter(w => w && w.status === 'done');
        if (!done.length) return;
        const touch = (s, q, r) => {
            if (!s.ageWorksFx) { s.ageWorksFx = {}; st.fxTowns.push([q, r]); }
            return s.ageWorksFx;
        };
        let byRealm = null;
        for (const w of done) {
            const T = GreatWorks.type(w.type);
            const s = _town(world, w.q, w.r);
            if (!T || !s) continue;
            const E = T.effects || {};
            const fx = touch(s, w.q, w.r);
            for (const k of ['defense', 'letters', 'pull']) if (Number.isFinite(E[k])) fx[k] = _r2(_num(fx[k]) + E[k]);
            if (Number.isFinite(E.realmLetters) && s.kingdom != null) {
                if (!byRealm) {
                    byRealm = new Map();
                    for (const v of _views(world)) { if (!byRealm.has(v.s.kingdom)) byRealm.set(v.s.kingdom, []); byRealm.get(v.s.kingdom).push(v); }
                }
                for (const v of byRealm.get(s.kingdom) || []) {
                    if (v.s === s) continue;
                    const f2 = touch(v.s, v.q, v.r);
                    f2.letters = _r2(Math.max(_num(f2.letters), E.realmLetters));
                }
            }
        }
    },

    /** A finished cathedral's week: the realm's piety, the pilgrims' coin. */
    _bless(world, w, ctx) {
        const T = GreatWorks.type(w.type);
        const E = (T && T.effects) || {};
        if (!(E.piety > 0) && !(E.pilgrims > 0)) return;
        const s = _town(world, w.q, w.r);
        if (!s) return;
        const k = _kingdom(world, s.kingdom);
        if (k && _obj(k.religion) && Number.isFinite(k.religion.piety) && E.piety > 0) {
            const cap = _num(E.pietyCap, 85);
            if (k.religion.piety < cap) k.religion.piety = Math.min(cap, k.religion.piety + E.piety);
        }
        if (E.pilgrims > 0 && s.kingdom != null) {
            if (!ctx.realmTowns) {
                ctx.realmTowns = new Map();
                for (const v of _views(world)) { if (!ctx.realmTowns.has(v.s.kingdom)) ctx.realmTowns.set(v.s.kingdom, []); ctx.realmTowns.get(v.s.kingdom).push(v.s); }
            }
            const towns = (ctx.realmTowns.get(s.kingdom) || []).filter(t => t !== s && Economy.townPurse(t) != null);
            const want = _r2(E.pilgrims * Math.max(0.5, Math.min(3, Math.sqrt(Math.max(1, _num(s.population)) / 2000))));
            const res = Economy.drawTowns(towns.map(t => ({ settlement: t, weight: Math.max(1, _num(t.population)) })), want, 0.002);
            if (res.paid > 0) {
                GreatWorks._payTown(world, s, res.paid);
                w.pilgrims = _r2(_num(w.pilgrims) + res.paid);
            }
        }
    },

    /** Heirs' learning from universities: one the House carved its name on, or one in the realm it lives in. */
    educationFor(player, world) {
        if (!player || !world) return 0;
        const hid = player.house && player.house.id;
        let kid = player.kingdomId;
        if (kid == null) { const t = _town(world, player.q, player.r); kid = t ? t.kingdom : null; }
        let best = 0;
        for (const w of GreatWorks.works(world, x => x.status === 'done')) {
            const T = GreatWorks.type(w.type);
            const e = _num(T && T.effects && T.effects.education);
            if (!(e > 0)) continue;
            const carved = hid && (w.carved || []).some(c => c.kind === 'player' && c.house === hid);
            const s = carved ? null : _town(world, w.q, w.r);
            if (carved || (s && kid != null && String(s.kingdom) === String(kid))) best = Math.max(best, e);
        }
        return best;
    },

    // ── NPC actors ────────────────────────────────────────

    _npcMonth(world, player, day, out) {
        const C = GreatWorks.config();
        const N = C.npc || {};
        const st = GreatWorks.state(world);
        const holders = new Map();
        const est = _obj(world.estates);
        if (est && _obj(est.holders)) {
            for (const h of Object.values(est.holders)) {
                if (!h || !['noble', 'church', 'town'].includes(h.kind) || !(_num(h.purse) > 0)) continue;
                const k = String(h.kid);
                if (!holders.has(k)) holders.set(k, []);
                holders.get(k).push(h);
            }
        }
        const committed = new Map();
        for (const w of st.works) for (const f of (w && LIVE.has(w.status) ? w.funders : [])) if (f.status === 'active') committed.set(f.key, _num(committed.get(f.key)) + _num(f.weekly));
        const ctx = { holders: { get: (kid) => holders.get(String(kid)) || [] }, committed };
        // 1. Pledges for works short of funds; ruins taken up again
        for (const w of st.works) {
            if (!w) continue;
            if (LIVE.has(w.status)) GreatWorks._npcPledge(world, player, w, day, ctx, out);
            else if (w.status === 'ruin' && _roll(world, 'resume', w.id, day) < _num(N.resumeChance, 0.08)) GreatWorks._npcResume(world, player, w, day, ctx, out);
        }
        // 2. New works: one realm at a time, under the world's cap and the realm's
        const views = _views(world);
        const liveWorks = st.works.filter(w => w && LIVE.has(w.status));
        const cap = GreatWorks.cap(world, views.length);
        const perRealm = Math.max(1, _num(C.perRealm, 2));
        const byRealm = new Map();
        for (const w of liveWorks) byRealm.set(String(w.kid), _num(byRealm.get(String(w.kid))) + 1);
        let room = cap - liveWorks.length;
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false) continue;
            if (_roll(world, 'found', k.id, day) >= _num(N.foundChance, 0.05)) continue;
            if (_num(byRealm.get(String(k.id))) >= perRealm) continue;
            // (a realm that would found one finds the world's cap full: counted, the probe reads it)
            if (!(room > 0)) { st.capHits = _num(st.capHits) + 1; continue; }
            if (GreatWorks._npcFound(world, player, k, views, day, ctx, out)) room--;
        }
    },

    /** What an actor would pledge a week to a work (0: not worth it). */
    _offer(w, a, T, ctx = null) {
        const N = GreatWorks.config().npc || {};
        // (what it has pledged to other works already counts against what it can spare)
        const committed = ctx && ctx.committed ? _num(ctx.committed.get(a.key)) : 0;
        const share = a.kind === 'crown' ? _num(N.crownShare, 0.0025) : a.kind === 'guild' ? _num(N.guildShare, 0.006) : a.kind === 'rival' ? _num(N.rivalShare, 0.004) : _num(N.holderShare, 0.004);
        const min = a.kind === 'crown' ? 0 : a.kind === 'guild' ? _num(N.guildMinTreasury, 250) : a.kind === 'rival' ? _num(N.rivalMinGold, 400) : _num(N.holderMinPurse, 600);
        if (a.have < min) return 0;
        const gap = Math.max(0, w.full * 1.05 - GreatWorks.pledged(w));
        const v = Math.min(gap, a.have * share - committed, w.full);
        return v >= Math.max(1, w.full * 0.04) ? Utils.centsDown(v) : 0;
    },

    /** What the town's other backers would pledge a week to a work of type T (its weights > 0), but `skip`. */
    _backing(world, player, s, T, shell, ctx, skip = null) {
        let sum = 0;
        for (const a of GreatWorks.actors(world, player, s, ctx)) {
            if (a.key === skip || !(_num((T.funders || {})[GreatWorks._weightKey(a)]) > 0)) continue;
            sum += GreatWorks._offer(shell, a, T, ctx);
        }
        return sum;
    },

    _addFunder(world, w, a, weekly, years, day, house = null) {
        const Y = _DPY();
        const f = {
            key: a.key, kind: a.kind, sub: a.sub || null, ref: a.ref, name: a.name, q: a.q, r: a.r,
            weekly: _r2(weekly), from: day, until: years > 0 ? day + Math.round(years * Y) : null,
            paid: 0, missed: 0, status: 'active', house,
        };
        const old = w.funders.find(x => x.key === a.key && x.status === 'active');
        if (old) { old.weekly = f.weekly; old.until = f.until; return old; }
        // (a funder who honoured an old pledge may pledge again: the record keeps the sum)
        const done = w.funders.find(x => x.key === a.key && x.status === 'done');
        if (done) { Object.assign(done, { weekly: f.weekly, from: day, until: f.until, missed: 0, status: 'active', ended: null }); return done; }
        w.funders.push(f);
        return f;
    },

    _npcPledge(world, player, w, day, ctx, out) {
        const N = GreatWorks.config().npc || {};
        const P = GreatWorks.config().pledge || {};
        const T = GreatWorks.type(w.type);
        const s = _town(world, w.q, w.r);
        if (!T || !s) return;
        // Those already pledged and grown richer pledge more (never past what the work can use)
        if (GreatWorks.pledged(w) < w.full) {
            const now = new Map(GreatWorks.actors(world, player, s, ctx).map(a => [a.key, a]));
            for (const f of w.funders) {
                if (f.status !== 'active' || f.kind === 'player' || !now.has(f.key)) continue;
                const offer = GreatWorks._offer(w, now.get(f.key), T, ctx) + _num(f.weekly);
                if (offer < _num(f.weekly) * _num(N.raiseAt, 1.3)) continue;
                const was = _num(f.weekly);
                f.weekly = _r2(Math.min(offer, was + Math.max(0, w.full * 1.05 - GreatWorks.pledged(w))));
                if (ctx.committed) ctx.committed.set(f.key, _num(ctx.committed.get(f.key)) + f.weekly - was);
            }
        }
        if (GreatWorks.pledged(w) >= w.full) return;
        if (w.funders.filter(f => f.status === 'active').length >= _num(N.maxFunders, 6)) return;
        const shamed = new Set((w.broken || []).map(b => b.key));
        const cands = GreatWorks.actors(world, player, s, ctx).filter(a => !shamed.has(a.key) && !w.funders.some(f => f.key === a.key && f.status === 'active'));
        let total = 0;
        const pool = [];
        for (const a of cands) {
            const wt = _num((T.funders || {})[GreatWorks._weightKey(a)]);
            const offer = wt > 0 ? GreatWorks._offer(w, a, T, ctx) : 0;
            if (offer > 0) { pool.push({ a, wt, offer }); total += wt; }
        }
        if (!pool.length) return;
        let x = _roll(world, 'pledge', w.id, day) * total;
        let pick = pool[pool.length - 1];
        for (const p of pool) { x -= p.wt; if (x <= 0) { pick = p; break; } }
        const [lo, hi] = Array.isArray(P.npcTermYears) ? P.npcTermYears : [6, 18];
        const years = Math.round(lo + (hi - lo) * _roll(world, 'term', w.id, pick.a.key, day));
        GreatWorks._addFunder(world, w, pick.a, pick.offer, years, day);
        ctx.committed && ctx.committed.set(pick.a.key, _num(ctx.committed.get(pick.a.key)) + pick.offer);
        GreatWorks._log(world, day, `${pick.a.name} pledged ${Utils.formatGold(pick.offer)}g a week to ${_the(w.name)} for ${years} years.`);
        if (w.status === 'stalled' && GreatWorks._near(world, player, w)) out.notices.push({ icon: '🤝', title: 'A Work Taken Up', text: `${pick.a.name} pledges to the stalled ${w.name}: work may begin again.`, type: 'info' });
    },

    _npcResume(world, player, w, day, ctx, out) {
        const T = GreatWorks.type(w.type);
        const s = _town(world, w.q, w.r);
        if (!T || !s) return;
        if (GreatWorks.works(world, x => x.q === w.q && x.r === w.r && LIVE.has(x.status)).length) return;
        const shamed = new Set((w.broken || []).map(b => b.key).concat((w.abandonedBy || []).map(b => b.key)));
        const need = w.full * _num(GreatWorks.config().pledge && GreatWorks.config().pledge.founderMinShare, 0.1);
        for (const kind of T.founders || []) {
            const a = GreatWorks.actors(world, player, s, ctx).find(x => GreatWorks._weightKey(x) === kind && !shamed.has(x.key) && GreatWorks._offer(w, x, T, ctx) >= need);
            if (!a) continue;
            const offer = GreatWorks._offer(w, a, T, ctx);
            GreatWorks.resume(world, null, w.id, { actor: a, weekly: offer, years: 12 });
            ctx.committed && ctx.committed.set(a.key, _num(ctx.committed.get(a.key)) + offer);
            if (GreatWorks._near(world, player, w)) out.notices.push({ icon: '🏗️', title: 'A Ruin Taken Up', text: `${a.name} takes up the ruined ${w.name} again.`, type: 'info' });
            return;
        }
    },

    _npcFound(world, player, k, views, day, ctx, out) {
        const P = GreatWorks.config().pledge || {};
        const types = Object.keys(GreatWorks.types());
        if (!types.length) return false;
        const towns = views.filter(v => v.s.kingdom === k.id).sort((a, b) => _num(b.s.population) - _num(a.s.population)).slice(0, 4);
        if (!towns.length) return false;
        const start = Math.floor(_roll(world, 'type', k.id, day) * types.length);
        // (the kinds the realm and the world have fewest of are tried first, so the
        // cheap ones — walls — don't crowd out the rest; the roll breaks ties)
        const have = {};
        for (const w of GreatWorks.works(world)) {
            const wk = _town(world, w.q, w.r);
            have[w.type] = _num(have[w.type]) + 1 + (wk && wk.kingdom === k.id ? 2 : 0);
        }
        const order = types.map((id, i) => ({ id, n: _num(have[id]), o: (i - start + types.length) % types.length }))
            .sort((a, b) => a.n - b.n || a.o - b.o).map(t => t.id);
        for (let i = 0; i < order.length; i++) {
            const id = order[i];
            const T = GreatWorks.type(id);
            for (const v of towns) {
                const chk = GreatWorks.siteCheck(world, v.s, id);
                if (!chk.ok) continue;
                const est = GreatWorks.estimate(T, v.s);
                const need = est.weekly * _num(P.founderMinShare, 0.1);
                const shell = { full: est.weekly, funders: [] };
                for (const kind of T.founders || []) {
                    const a = GreatWorks.actors(world, player, v.s, ctx).find(x => GreatWorks._weightKey(x) === kind && GreatWorks._offer(shell, x, T, ctx) >= need);
                    if (!a) continue;
                    const offer = GreatWorks._offer(shell, a, T, ctx);
                    // (no one founds what the town's backers together could not keep going: the
                    // founder's pledge and what the others would offer must come to foundFunding of full pace)
                    if (GreatWorks._backing(world, player, v.s, T, shell, ctx, a.key) + offer < est.weekly * _num(P.foundFunding, 0)) continue;
                    const res = GreatWorks.found(world, null, v.s, id, { actor: a, weekly: offer, years: _num(P.founderYears, 0) });
                    if (res.success) {
                        ctx.committed && ctx.committed.set(a.key, _num(ctx.committed.get(a.key)) + offer);
                        if (GreatWorks._near(world, player, res.work)) out.notices.push({ icon: T.icon || '🏗️', title: 'A Great Work Begun', text: `${a.name} lays the first stone of ${_the(res.work.name)}. It will take a generation or more.`, type: 'info' });
                        return true;
                    }
                }
            }
        }
        return false;
    },

    // ── Founding, pledging, withdrawing, resuming ─────────

    /** The player's House as a funder. */
    _playerActor(player) {
        const h = player && player.house;
        return { kind: 'player', sub: null, ref: 'player', key: `player:${h ? h.id : 'house'}`, name: h ? h.name : 'Your House', have: Math.max(0, _num(Barter.coinOf(player))), house: h ? h.id : null };
    },

    /** Does the town hold a grudge against this House (a work it let fall to ruin)? */
    grudgeAgainst(world, s, houseId) {
        if (!s || !houseId) return null;
        const H = GreatWorks.config().honour || {};
        const day = _day(world);
        const Y = _DPY();
        return TownMarks.marks(s, 'grudge').find(m => Array.isArray(m.houses) && m.houses.includes(houseId) && day - _num(m.d) < _num(m.years, _num(H.grudgeYears, 60)) * Y) || null;
    },

    /**
     * Found a work at `s`. The founder pledges `weekly` for `years` (0: until
     * done). opts: { actor } for an NPC; else the player's House pays.
     * → { success, message, work }
     */
    found(world, player, s, typeId, opts = {}) {
        const C = GreatWorks.config();
        const P = C.pledge || {};
        const T = GreatWorks.type(typeId);
        const chk = GreatWorks.siteCheck(world, s, typeId);
        if (!chk.ok) return { success: false, message: chk.reason };
        const est = GreatWorks.estimate(T, s);
        const a = opts.actor || (player ? GreatWorks._playerActor(player) : null);
        if (!a) return { success: false, message: 'No one to found it.' };
        const weekly = _r2(_num(opts.weekly));
        if (weekly < est.weekly * _num(P.founderMinShare, 0.1)) return { success: false, message: `A founder must pledge at least ${Utils.formatGold(Math.ceil(est.weekly * _num(P.founderMinShare, 0.1)))}g a week.` };
        if (a.kind === 'player') {
            if (!player.house) return { success: false, message: 'You have no House to found it in the name of.' };
            if (GreatWorks.grudgeAgainst(world, s, player.house.id)) return { success: false, message: `${s.name} remembers the work your House let fall to ruin: its council will not let you found another.` };
            const mine = GreatWorks.works(world, w => LIVE.has(w.status) && w.funders.some(f => f.kind === 'player' && f.status === 'active' && f.house === player.house.id)).length;
            if (mine >= _num(P.maxPlayer, 4)) return { success: false, message: `Your House is pledged to ${mine} works already.` };
            if (a.have < weekly) return { success: false, message: `You cannot meet the first week's ${Utils.formatGold(weekly)}g.` };
        }
        const st = GreatWorks.state(world);
        const day = _day(world);
        const other = chk.other ? chk.other.name : null;
        const w = {
            id: `aw${st.seq++}`, type: typeId, name: _fill(T.title || `The ${T.name} of {town}`, { town: s.name, other: other || 'its neighbour' }),
            q: s.q, r: s.r, town: s.name, kid: s.kingdom != null ? s.kingdom : null, target: chk.target, other,
            founded: day, founder: { key: a.key, name: a.name, kind: a.kind, house: a.house || null },
            status: 'building', prog: 0, est: est.total, full: est.weekly, spent: 0,
            funders: [], store: {}, broken: [], stallFrom: null, done: null,
        };
        GreatWorks._addFunder(world, w, a, weekly, _num(opts.years), day, a.house || null);
        st.works.push(w);
        GreatWorks._log(world, day, `${a.name} founded ${_the(w.name)}.`);
        GreatWorks._timeline(world, day, w, `${a.name} founded ${_the(w.name)}.`, 4);
        if (a.kind === 'player') House._chronicle(player.house, world, `${player.house.name} laid the first stone of ${_the(w.name)} at ${s.name}, a work for generations.`, ['greatWork', 'patronage']);
        return { success: true, message: `The first stone of ${_the(w.name)} is laid. At full funding it will take ${T.years} years.`, work: w };
    },

    /** The player's House pledges (or raises its pledge) to a work. → { success, message } */
    pledge(world, player, workId, weekly, years = 0) {
        const w = GreatWorks.work(world, workId);
        if (!w || !(LIVE.has(w.status) || w.status === 'ruin')) return { success: false, message: 'No such work rising.' };
        if (!player || !player.house) return { success: false, message: 'You have no House to pledge in the name of.' };
        if (w.status === 'ruin') return GreatWorks.resume(world, player, workId, { weekly, years });
        const a = GreatWorks._playerActor(player);
        const amt = _r2(_num(weekly));
        if (!(amt > 0)) return { success: false, message: 'Pledge something.' };
        const old = w.funders.find(f => f.key === a.key && f.status === 'active');
        if (old && amt <= old.weekly) return { success: false, message: `You already pledge ${Utils.formatGold(old.weekly)}g a week; a pledge may be raised, not cut.` };
        const P = GreatWorks.config().pledge || {};
        const mine = GreatWorks.works(world, x => LIVE.has(x.status) && x.funders.some(f => f.kind === 'player' && f.status === 'active' && f.house === player.house.id)).length;
        if (!old && mine >= _num(P.maxPlayer, 4)) return { success: false, message: `Your House is pledged to ${mine} works already.` };
        if (a.have < amt) return { success: false, message: `You cannot meet even the first week's ${Utils.formatGold(amt)}g.` };
        GreatWorks._addFunder(world, w, a, amt, _num(years), _day(world), player.house.id);
        GreatWorks._log(world, _day(world), `${a.name} pledged ${Utils.formatGold(amt)}g a week to ${_the(w.name)}.`);
        if (!old) House._chronicle(player.house, world, `${player.house.name} pledged to the building of ${_the(w.name)} at ${w.town}.`, ['greatWork', 'patronage']);
        return { success: true, message: `${player.house.name} pledges ${Utils.formatGold(amt)}g a week to ${_the(w.name)}${years > 0 ? ` for ${years} years` : ' until it is finished'}.` };
    },

    /** Withdraw the player's pledge: honourable once its term is out, a broken pledge before. */
    withdraw(world, player, workId) {
        const w = GreatWorks.work(world, workId);
        const key = player && player.house ? `player:${player.house.id}` : null;
        const f = w && key ? w.funders.find(x => x.key === key && x.status === 'active') : null;
        if (!f) return { success: false, message: 'Your House has no pledge standing there.' };
        const out = { notices: [] };
        GreatWorks._break(world, player, w, f, _day(world), out, 'withdrew');
        return { success: true, message: out.notices.length ? out.notices[0].text : `You withdraw from ${_the(w.name)}.` };
    },

    /** Take up a stalled work or a ruin. opts: { actor } for an NPC, else the player's House; weekly, years. */
    resume(world, player, workId, opts = {}) {
        const w = GreatWorks.work(world, workId);
        if (!w || !(w.status === 'ruin' || w.status === 'stalled')) return { success: false, message: 'There is nothing to take up.' };
        const s = _town(world, w.q, w.r);
        if (!s) return { success: false, message: 'The town is gone.' };
        if (w.status === 'ruin' && GreatWorks.works(world, x => x.q === w.q && x.r === w.r && LIVE.has(x.status)).length) return { success: false, message: 'Another work is rising here now.' };
        const a = opts.actor || (player ? GreatWorks._playerActor(player) : null);
        if (!a) return { success: false, message: 'No one to take it up.' };
        const weekly = _r2(_num(opts.weekly));
        const need = w.full * _num(GreatWorks.config().pledge && GreatWorks.config().pledge.founderMinShare, 0.1);
        if (weekly < need) return { success: false, message: `Taking it up wants a pledge of at least ${Utils.formatGold(Math.ceil(need))}g a week.` };
        if (a.kind === 'player') {
            if (!player.house) return { success: false, message: 'You have no House.' };
            if (a.have < weekly) return { success: false, message: `You cannot meet the first week's ${Utils.formatGold(weekly)}g.` };
        }
        const day = _day(world);
        GreatWorks._addFunder(world, w, a, weekly, _num(opts.years), day, a.house || null);
        const wasRuin = w.status === 'ruin';
        w.status = 'building';
        w.stallFrom = null;
        w.resumed = (w.resumed || []).concat([{ key: a.key, name: a.name, day }]);
        GreatWorks._log(world, day, `${a.name} took up the ${wasRuin ? 'ruined ' : ''}${w.name}.`);
        if (wasRuin) GreatWorks._timeline(world, day, w, `${a.name} took up the ruined ${w.name}.`, 3);
        if (a.kind === 'player') House._chronicle(player.house, world, `${player.house.name} took up the ${wasRuin ? 'ruined ' : 'stalled '}${w.name} at ${w.town}.`, ['greatWork', 'patronage']);
        return { success: true, message: `${a.name} takes up ${_the(w.name)}, ${Math.round(w.prog * 100)}% built.` };
    },

    // ── Reading ───────────────────────────────────────────

    _playerFunds(w, player) {
        const hid = player && player.house && player.house.id;
        return !!(hid && w.funders.some(f => f.kind === 'player' && f.house === hid && f.status === 'active'));
    },

    _near(world, player, w) {
        if (!player || !Number.isFinite(player.q)) return false;
        return Hex.wrappingDistance(player.q, player.r, w.q, w.r, world.width) <= _num(GreatWorks.config().nearRange, 14);
    },

    /** One work as the panel shows it. */
    describe(world, player, w) {
        const T = GreatWorks.type(w.type) || {};
        const si = GreatWorks.stageAt(T, w.prog);
        const total = GreatWorks.paidTotal(w);
        const hid = player && player.house && player.house.id;
        return {
            id: w.id, name: w.name, icon: T.icon || '🏛️', type: w.type, typeName: T.name, town: w.town, status: w.status,
            prog: w.prog, stage: (T.stages || [])[si] ? T.stages[si].name : '', stageNo: si + 1, stages: (T.stages || []).length,
            years: Math.round((_day(world) - w.founded) / _DPY()), yearsLeft: GreatWorks.yearsLeft(w), full: w.full, pledged: GreatWorks.pledged(w),
            spent: w.spent, est: w.est, founder: w.founder, done: w.done, carved: w.carved || null,
            dist: player && Number.isFinite(player.q) ? Hex.wrappingDistance(player.q, player.r, w.q, w.r, world.width) : null,
            funders: w.funders.map(f => ({ ...f, share: total > 0 ? _num(f.paid) / total : 0, mine: f.kind === 'player' && f.house === hid })),
            mine: w.funders.find(f => f.kind === 'player' && f.house === hid && f.status === 'active') || null,
            broken: w.broken || [], abandonedBy: w.abandonedBy || [], blurb: T.blurb || '', short: w.short || null,
        };
    },

    /** Works near the player (and every one their House has a hand in), nearest first. */
    nearby(world, player) {
        const R = _num(GreatWorks.config().nearRange, 14);
        const hid = player && player.house && player.house.id;
        return GreatWorks.works(world)
            .map(w => GreatWorks.describe(world, player, w))
            .filter(d => (d.dist != null && d.dist <= R) || (hid && d.funders.some(f => f.mine)))
            .sort((a, b) => _num(a.dist, 999) - _num(b.dist, 999));
    },

    /** What could be founded at `s`: [{ id, name, icon, ok, reason, est, years, blurb }]. */
    options(world, s) {
        return Object.entries(GreatWorks.types()).map(([id, T]) => {
            const chk = GreatWorks.siteCheck(world, s, id);
            return { id, name: T.name, icon: T.icon || '🏛️', ok: chk.ok, reason: chk.reason, est: GreatWorks.estimate(T, s), years: T.years, blurb: T.blurb || '' };
        });
    },

    // ── Records ───────────────────────────────────────────

    _log(world, day, text) {
        const st = GreatWorks.state(world);
        st.log.push({ day, text });
        if (st.log.length > 80) st.log.splice(0, st.log.length - 80);
    },

    _timeline(world, day, w, text, weight) {
        try {
            const st = RealmTimeline.state(world);
            if (st && Array.isArray(st.events)) RealmTimeline._event(st, day, 'work', w.q, w.r, text, weight);
        } catch (e) { /* no timeline */ }
    },
};
