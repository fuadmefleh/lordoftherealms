// ============================================
// RIVAL AGENTS — rival Houses buy people in the player's towns
// ============================================
// A rival House (house.rivals, systems/house.js) with a hot enough feud — the
// hotter while it stands in a league against the player (systems/
// coalitions.js) — recruits a named townsperson (systems/townsfolk.js
// settlement.folk) in one of the player's towns, and keeps them on:
//
//   INFORMANT   sells word of the player's plans: every few weeks the rival
//               acts on it — a plot (Schemes.hatch) that strikes sooner than
//               usual — and while an informant sits unturned, that rival's
//               plots are half as likely to come to light
//               (Schemes.revealChance); a league the rival is sworn to grows
//               bolder for it.
//   SABOTEUR    near the player's properties or works: fires and broken
//               tools (property.sabotagedDays; the player's works in the town
//               lose repair, SettlementMarket works cond).
//   OFFICIAL    in a town the player holds: skims the collections and holds
//               up the permits (settlement.holding.bribed → Holdings.computeFx
//               skim and buildSpeed, read by Taxation and the works queue).
//
// The town talks — men in a rival's colours asking questions (the 'rivalMen'
// annal, heard in the town's news). Suspicion of each agent gathers week by
// week: a spymaster, idle spies, counter-espionage posted near the town, the
// player in town, the player knowing the person (they have spoken), the trail
// a sabotage or a sold leak leaves, and the player's own inquiries (inquire: gold, in town).
// At full suspicion the agent is known by name, and the player can TURN them
// (gold: the rival's plots come to light, the bribe ends, a league the rival
// is sworn to loses heart week by week) or EXPOSE them (driven out of town,
// the realm's thanks, the rival shamed and angrier, the league weaker).
//
// Townsfolk rule: never Utils.random here. The weekly tick runs on its own
// stream (world seed + day) and the picks are hashes, so the shared RNG
// sequence is untouched. State on player.rivalAgents (saved).
// Content: data/coalitions.json → agents.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { House } from './house.js';
import { Townsfolk } from './townsfolk.js';
import { Schemes } from './schemes.js';
import { Holdings } from './holdings.js';
import { Ledger } from './ledger.js';
import { Taxation } from './marketDynamics.js';
import { Coalitions } from './coalitions.js';
import { RivalHouses } from './rivalHouses.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);

function _roll(key) {
    // hashStr moves by 1 when the last character does: mix it, so next day's roll is a new one
    let h = Utils.hashStr(String(key)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return (h % 100000) / 100000;
}

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

const DEFAULTS = {
    enabled: true, cadence: 7, offset: 5, minFeud: 25, maxPerRival: 2, maxTotal: 5,
    recruitChance: 0.35, coalitionBoost: 1.5, vendettaBoost: 1.25,
    kinds: {
        informant: { icon: '👂', label: 'Informant', roles: ['merchant', 'traveler', 'villager', 'priest'], leakEvery: 21, leakResolve: 3, leadDays: 4, revealCut: 0.5, deed: "sold word of {house}'s plans" },
        saboteur: { icon: '🔥', label: 'Saboteur', roles: ['blacksmith_npc', 'farmer', 'villager'], chance: 0.35, propertyDays: 8, worksShare: 0.2, radius: 3, trace: 10, deed: 'set fires among the works of {house}' },
        official: { icon: '💰', label: 'Bribed official', roles: ['guard', 'merchant', 'priest'], skim: 0.15, buildDrag: 0.25, deed: "took bribes to hinder {house}'s rule" },
    },
    suspicion: { base: 4, spymaster: 6, perIdleSpy: 3, counter: 12, present: 15, acquainted: 8, afterAct: 10, known: 100 },
    inquiry: { gold: 25, suspicion: 35 },
    turnBase: 80, turnPerFeud: 2, turnedReport: 120, exposeFeud: 5, exposeReputation: 4,
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

let _cfg = null;
let _cfgSrc;

export const RivalAgents = {

    DEFAULTS,

    config() {
        const g = DataLoader._gamedata;
        const src = g && _obj(g.coalitions) ? g.coalitions.agents : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    kind(id) {
        return RivalAgents.config().kinds[id] || DEFAULTS.kinds.informant;
    },

    // ──────────── STATE ────────────

    _blank() {
        return { agents: [], nextId: 1, log: [], stats: { recruited: 0, exposed: 0, turned: 0, sabotaged: 0, leaks: 0, inquiries: 0 } };
    },

    state(player) {
        if (!player) return null;
        if (!_obj(player.rivalAgents)) player.rivalAgents = RivalAgents._blank();
        const st = player.rivalAgents;
        if (!Array.isArray(st.agents)) st.agents = [];
        if (!Array.isArray(st.log)) st.log = [];
        if (!Number.isFinite(st.nextId)) st.nextId = 1;
        st.stats = { ...RivalAgents._blank().stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && player.rivalAgents ? JSON.parse(JSON.stringify(player.rivalAgents)) : null;
    },

    loadState(player) {
        if (player) RivalAgents.state(player);
    },

    /** Every agent working against the player (known or not — the UI shows only the known). */
    list(player) {
        return player && player.rivalAgents && Array.isArray(player.rivalAgents.agents) ? player.rivalAgents.agents : [];
    },

    /** Agents the player has found out (and not yet dealt with). */
    known(player) {
        return RivalAgents.list(player).filter(a => a.known);
    },

    /** An unturned informant of this rival is at work (Schemes.revealChance reads it). */
    informing(player, rivalId) {
        return RivalAgents.list(player).some(a => a.rivalId === rivalId && a.kind === 'informant' && !a.turned);
    },

    /** What the agent was bought to do, in the data's words (kinds.*.deed: "{house}" the player's House). */
    deed(player, a) {
        const K = RivalAgents.kind(a && a.kind);
        const house = (player && player.house && player.house.name) || 'your House';
        return typeof K.deed === 'string' && K.deed ? K.deed.replace(/\{house\}/g, house) : null;
    },

    /**
     * The record of the rival agents' work against the player, for the
     * Threats panel: every count in state.stats, and the turned agents with
     * the days they have served (from a.turnedDay).
     */
    tally(player, world) {
        const st = RivalAgents.state(player);
        if (!st) return null;
        const day = _day(world);
        const turned = RivalAgents.list(player).filter(a => a.turned)
            .map(a => ({ id: a.id, name: a.name, rivalName: a.rivalName, days: Number.isFinite(a.turnedDay) ? Math.max(0, day - a.turnedDay) : null }));
        const s = st.stats;
        const parts = [`${s.recruited} bought`, `${s.leaks} leak${s.leaks === 1 ? '' : 's'}`, `${s.sabotaged} sabotage${s.sabotaged === 1 ? '' : 's'}`,
            `${s.exposed} exposed`, `${s.turned} turned`, `${s.inquiries} inquir${s.inquiries === 1 ? 'y' : 'ies'}`];
        return { ...s, serving: turned, text: parts.join(' · ') };
    },

    _log(st, day, text) {
        st.log.unshift({ day, text });
        if (st.log.length > 20) st.log.length = 20;
    },

    // ──────────── THE PLAYER'S TOWNS ────────────

    /**
     * The town at (q, r) with a roster of at least three, or null. `lazy`: a
     * town no one has walked through yet (no roster at all) counts too, as
     * { folk: null } — recruit() seeds its roster (Townsfolk.seed) only when
     * it is the town picked, so agents reach towns the player never entered.
     */
    _folkAt(world, q, r, lazy = false) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        const s = tile && tile.settlement;
        if (!s) return null;
        const folk = s.folk;
        if (lazy && !_obj(folk)) return { s, folk: null, q, r };
        if (!folk || !Array.isArray(folk.people) || Townsfolk.residents(folk).length < 3) return null;
        return { s, folk, q, r };
    },

    /** The nearest rostered (or, lazy, not yet rostered) town to (q, r) within `radius` hexes, or null. */
    _nearestFolk(world, q, r, radius, lazy = false) {
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        let best = null;
        for (const s of views) {
            if (!s) continue;
            const folk = s.folk;
            const unseeded = lazy && !_obj(folk) && Number.isFinite(s.q);
            if (!unseeded && (!folk || !Array.isArray(folk.people) || Townsfolk.residents(folk).length < 3)) continue;
            const tq = unseeded ? s.q : folk.q;
            const tr = unseeded ? s.r : folk.r;
            const d = Hex.wrappingDistance(q, r, tq, tr, world.width || 0);
            if (d <= radius && (!best || d < best.d)) best = { s, folk: unseeded ? null : folk, q: tq, r: tr, d };
        }
        return best;
    },

    /**
     * Towns where a rival could buy someone: { key: { s, folk, q, r, kinds: Set,
     * holding } } — the player's holdings (informant, official, saboteur), towns
     * near their properties and works (informant, saboteur), and the seat of a
     * crown they rule (informant). Towns not yet rostered are offered too
     * (folk: null) unless opts.lazy === false.
     */
    towns(player, world, opts = {}) {
        const lazy = opts.lazy !== false;
        const out = {};
        const R = _num(RivalAgents.kind('saboteur').radius, 3);
        const add = (t, kinds, holding = false) => {
            if (!t) return;
            const key = `${t.q},${t.r}`;
            const e = out[key] || (out[key] = { ...t, kinds: new Set(), holding: false });
            for (const k of kinds) e.kinds.add(k);
            if (holding) e.holding = true;
        };
        for (const ref of Taxation.getPlayerSettlements(player, world)) add(RivalAgents._folkAt(world, ref.q, ref.r, lazy), ['informant', 'official'], true);
        for (const ref of player.properties || []) add(RivalAgents._nearestFolk(world, ref.q, ref.r, R, lazy), ['informant', 'saboteur']);
        const mp = _obj(player.merchantPrince);
        for (const inv of (mp && Array.isArray(mp.investments) ? mp.investments : [])) add(RivalAgents._folkAt(world, inv.q, inv.r, lazy), ['informant', 'saboteur']);
        const realm = (world.kingdoms || []).find(k => k && k.isAlive && k.crown && k.crown.playerRuled);
        if (realm && realm.capital) add(RivalAgents._folkAt(world, realm.capital.q, realm.capital.r, lazy), ['informant']);
        return out;
    },

    // ──────────── THE WEEK ────────────

    _rng(world) {
        return Utils.seededRandom((Utils.hashStr(`${_seed(world)}:rivalAgents:${_day(world)}`) >>> 0) % 233279 + 1);
    },

    /** The daily hook (weekly on cadence). Returns { notices }. */
    processDay(world, player) {
        const out = { notices: [] };
        const C = RivalAgents.config();
        if (!world || !player || C.enabled === false || !player.house || player.interregnum) return out;
        const day = _day(world);
        if (day <= 0 || (day + _num(C.offset)) % Math.max(1, _num(C.cadence, 7)) !== 0) return out;
        // Its own stream: schemes hatched on an informant's word pick their targets from it, not the shared one
        Utils.withRng(RivalAgents._rng(world), () => RivalAgents._week(world, player, out));
        return out;
    },

    _week(world, player, out) {
        const C = RivalAgents.config();
        const st = RivalAgents.state(player);
        const day = _day(world);
        const rivals = (player.house && player.house.rivals) || {};

        // The gone: died, moved away, driven out — or their master's House fell
        for (const a of st.agents.slice()) {
            const f = RivalAgents._person(world, a);
            if (!f || !Townsfolk.isHere(f.person) || !rivals[a.rivalId]) RivalAgents._remove(player, world, a);
        }
        // A bribe no living agent stands behind (an older life's, a lost save's) is lifted
        for (const ref of Taxation.getPlayerSettlements(player, world)) {
            const h = ref.settlement && ref.settlement.holding;
            if (h && h.bribed && !st.agents.some(a => a.id === h.bribed.agentId && a.kind === 'official' && !a.turned)) {
                delete h.bribed;
                Holdings.refresh(ref.settlement);
            }
        }

        for (const a of st.agents.slice()) {
            if (a.turned) {
                // A turned agent feeds their master false word and their master's plots to you
                RivalAgents._report(player, world, a);
                Coalitions.onAgent(player, world, a.rivalId, 'turned');
                continue;
            }
            RivalAgents._act(player, world, a, out);
            RivalAgents._suspect(player, world, a, out);
        }

        // Recruitment: one new face a week at most
        if (st.agents.length >= _num(C.maxTotal, 5)) return;
        const towns = RivalAgents.towns(player, world);
        if (!Object.keys(towns).length) return;
        const candidates = Object.values(rivals)
            // (a House under a truce with the player sends no new agents: systems/rivalAudience.js blood price)
            .filter(r => r && !RivalHouses.inTruce(r, world) && _num(r.feud) >= _num(C.minFeud) && st.agents.filter(a => a.rivalId === r.kingdomId).length < _num(C.maxPerRival, 2))
            .sort((a, b) => _num(b.feud) - _num(a.feud));
        for (const r of candidates) {
            // Sworn into a league, or owed blood (a vendetta rival, systems/coalitions.js), a House spends more freely
            const boost = (Coalitions.isMember(player, r.kingdomId) ? _num(C.coalitionBoost, 1.5) : 1) * (r.vendetta ? _num(C.vendettaBoost, 1.25) : 1);
            const chance = Math.min(0.95, _num(C.recruitChance) * (_num(r.feud) / 100) * boost);
            if (_roll(`ra-recruit:${_seed(world)}:${r.kingdomId}:${day}`) >= chance) continue;
            const a = RivalAgents.recruit(player, world, r.kingdomId);
            if (a) break;
        }
    },

    /** The live roster and person behind an agent, or null. */
    _person(world, a) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(a.q, a.r) : null;
        const folk = tile && tile.settlement && tile.settlement.folk;
        const person = folk ? Townsfolk.get(folk, a.pid) : null;
        return person ? { folk, person, settlement: tile.settlement } : null;
    },

    /**
     * A rival House buys someone in one of the player's towns. kind / town
     * ("q,r") may be forced; otherwise the kind is picked from what the towns
     * offer (an official where the player holds the town, a saboteur by their
     * works) and the town by hash. Returns the agent, or null.
     */
    recruit(player, world, rivalId, opts = {}) {
        const st = RivalAgents.state(player);
        const rival = player.house && player.house.rivals ? player.house.rivals[rivalId] : null;
        if (!st || !rival) return null;
        const day = _day(world);
        const towns = RivalAgents.towns(player, world);
        const taken = new Set(st.agents.map(a => `${a.q},${a.r}:${a.pid}`));
        const bribedHere = new Set(st.agents.filter(a => a.kind === 'official').map(a => `${a.q},${a.r}`));
        // What can be bought where
        const options = [];
        for (const [key, t] of Object.entries(towns)) {
            if (opts.town && opts.town !== key) continue;
            for (const kind of t.kinds) {
                if (opts.kind && opts.kind !== kind) continue;
                if (kind === 'official' && bribedHere.has(key)) continue;
                options.push({ key, t, kind, w: kind === 'official' ? 3 : kind === 'saboteur' ? 2 : 1 });
            }
        }
        if (!options.length) return null;
        const total = options.reduce((s, o) => s + o.w, 0);
        let x = _roll(`ra-pick:${_seed(world)}:${rivalId}:${day}:${st.nextId}`) * total;
        let pick = options[options.length - 1];
        for (const o of options) { x -= o.w; if (x < 0) { pick = o; break; } }
        const K = RivalAgents.kind(pick.kind);
        // A town the player never walked through: its people are reckoned now (no shared RNG)
        if (!pick.t.folk) pick.t.folk = Townsfolk.seed(pick.t.s, world, { q: pick.t.q, r: pick.t.r });
        if (!pick.t.folk || Townsfolk.residents(pick.t.folk).length < 3) return null;
        let person = Schemes._castPerson(pick.t.folk, world, K.roles, `${_seed(world)}|agent${st.nextId}|${day}|${rivalId}`);
        if (person && taken.has(`${pick.t.q},${pick.t.r}:${person.id}`)) {
            const pool = Townsfolk.residents(pick.t.folk).filter(p => !taken.has(`${pick.t.q},${pick.t.r}:${p.id}`) && !p.rnpc && !p.wedHouse
                && Townsfolk.age(p, day) >= 17 && p.role !== 'child' && p.role !== 'noble');
            person = pool.length ? pool[Math.floor(_roll(`ra-alt:${st.nextId}:${day}`) * pool.length) % pool.length] : null;
        }
        if (!person) return null;
        const a = {
            id: st.nextId++, rivalId, rivalName: rival.name, kind: pick.kind,
            q: pick.t.q, r: pick.t.r, pid: person.id, name: Townsfolk.name(person), role: Townsfolk.roleTitle(person),
            town: pick.t.s.name || 'the town', day, suspicion: 0, known: false, turned: false, lastAct: day, acts: 0,
        };
        st.agents.push(a);
        st.stats.recruited++;
        // The town talks: men in the rival's colours asking questions (heard in the town's news)
        Townsfolk.record(pick.t.folk, world, day, { k: 'rivalMen', x: `${rival.name}|${player.house.name}` });
        if (a.kind === 'official') RivalAgents._bribe(world, a, true);
        return a;
    },

    /** Put (or take) an official's bribe on the holding: its skim and drag are read by Holdings.computeFx. */
    _bribe(world, a, on) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(a.q, a.r) : null;
        const s = tile && tile.settlement;
        if (!s) return;
        const h = Holdings.ensure(s);
        if (on) {
            const K = RivalAgents.kind('official');
            h.bribed = { skim: _num(K.skim), buildDrag: _num(K.buildDrag), agentId: a.id };
        } else if (h.bribed && h.bribed.agentId === a.id) {
            delete h.bribed;
        } else return;
        Holdings.refresh(s);
    },

    _remove(player, world, a) {
        const st = RivalAgents.state(player);
        st.agents = st.agents.filter(x => x !== a);
        if (a.kind === 'official') RivalAgents._bribe(world, a, false);
    },

    /** What an unturned agent does this week. */
    _act(player, world, a, out) {
        const st = RivalAgents.state(player);
        const K = RivalAgents.kind(a.kind);
        const day = _day(world);
        const rival = player.house.rivals[a.rivalId];
        const f = RivalAgents._person(world, a);
        if (a.kind === 'informant') {
            if (day - _num(a.lastAct) < _num(K.leakEvery, 21)) return;
            a.lastAct = day;
            a.acts++;
            st.stats.leaks++;
            // Selling word leaves a trail, as a fire does (suspicion.afterAct)
            a.suspicion = _num(a.suspicion) + _num(RivalAgents.config().suspicion.afterAct);
            Coalitions.onAgent(player, world, a.rivalId, 'leak');
            // The rival moves on what it was told: a plot that strikes sooner than usual
            const house = player.house;
            if (!Array.isArray(house.schemes) || house.schemes.length >= Schemes.CONFIG.maxActive) return;
            if (house.schemes.some(s => s.rivalId === a.rivalId)) return;
            // A truce holds: no plots from them. And a plot costs the House its plotCost, as any other
            if (!rival || RivalHouses.inTruce(rival, world)) return;
            const plotCost = _num(RivalHouses.config().plotCost, 150);
            if (typeof rival.gold === 'number' && rival.gold < plotCost) return;
            const options = Schemes.eligibleTypes(player, world, _num(rival && rival.feud));
            if (!options.length) return;
            const type = options[Math.floor(_roll(`ra-leak:${a.id}:${day}`) * options.length) % options.length];
            const scheme = Schemes.hatch(player, world, rival, type);
            if (scheme) {
                if (typeof rival.gold === 'number') rival.gold -= plotCost;
                rival.lastPlotDay = day;
                if (rival.stats) rival.stats.plotsPaid = _num(rival.stats.plotsPaid) + 1;
                scheme.dueDay = Math.min(scheme.dueDay, day + _num(K.leadDays, 4));
                if (f) Townsfolk.note(f.person, day, 'plotted', null, a.rivalName);
            }
            return;
        }
        if (a.kind === 'saboteur') {
            if (_roll(`ra-sab:${a.id}:${day}`) >= _num(K.chance, 0.35)) return;
            const R = _num(K.radius, 3);
            const targets = [];
            for (const ref of player.properties || []) {
                if (Hex.wrappingDistance(ref.q, ref.r, a.q, a.r, world.width || 0) > R) continue;
                const tile = world.getTile(ref.q, ref.r);
                const prop = tile && Array.isArray(tile.playerProperties) ? tile.playerProperties.find(p => p && p.type === ref.type)
                    : (tile && tile.playerProperty && tile.playerProperty.type === ref.type ? tile.playerProperty : null);
                if (prop && !prop.underConstruction) targets.push({ kind: 'property', ref, prop });
            }
            const s = f && f.settlement;
            const works = s && s.market && s.market.works ? s.market.works : null;
            if (works) for (const [id, w] of Object.entries(works)) if (w && w.owner === 'player' && _num(w.cond, 1) > 0.05) targets.push({ kind: 'works', id, w });
            if (!targets.length) return;
            const t = targets[Math.floor(_roll(`ra-sabt:${a.id}:${day}`) * targets.length) % targets.length];
            let text;
            if (t.kind === 'property') {
                t.prop.sabotagedDays = Math.max(_num(t.prop.sabotagedDays), _num(K.propertyDays, 8));
                text = `Fire and broken tools at your ${String(t.ref.type).replace(/_/g, ' ')} near ${a.town}: it stands idle for ${_num(K.propertyDays, 8)} days.`;
            } else {
                const before = _num(t.w.cond, 1);
                t.w.cond = Math.round(Math.max(0, before * (1 - _num(K.worksShare, 0.2))) * 100) / 100;
                const rc = SettlementMarket.recipe ? SettlementMarket.recipe(t.id) : null;
                text = `Someone wrecked the gear of your ${(rc && rc.name) || t.id.replace(/_/g, ' ')} in ${a.town}: repair ${Math.round(before * 100)}% → ${Math.round(t.w.cond * 100)}%.`;
            }
            a.lastAct = day;
            a.acts++;
            a.suspicion = _num(a.suspicion) + _num(K.trace, 10);
            st.stats.sabotaged++;
            if (f) Townsfolk.note(f.person, day, 'plotted', null, a.rivalName);
            out.notices.push({ icon: '🔥', title: `Sabotage in ${a.town}`, text: a.known ? `${text} It was ${a.name}, ${a.rivalName}'s creature.` : `${text} No one saw who.`, type: 'warning' });
            return;
        }
        // An official's skim and drag stand on the holding (Holdings.computeFx); keep the bribe on
        if (a.kind === 'official') {
            const tile = world.getTile(a.q, a.r);
            const h = tile && tile.settlement && tile.settlement.holding;
            if (!h || !h.bribed || h.bribed.agentId !== a.id) RivalAgents._bribe(world, a, true);
        }
    },

    /** The week's gathering suspicion of one agent; at the mark they are known by name. */
    _suspect(player, world, a, out) {
        if (a.known) return;
        const S = RivalAgents.config().suspicion;
        const house = player.house;
        let s = _num(S.base);
        if (house.roles && house.roles.spymaster) s += _num(S.spymaster);
        const spies = (player.espionage && player.espionage.spies) || [];
        s += spies.filter(x => x && x.status === 'idle').length * _num(S.perIdleSpy);
        const counter = Schemes.counterStations(player);
        const radius = Schemes.counterEspionageEffects().counterRadius;
        if (counter.some(c => Hex.distance(c.q, c.r, a.q, a.r) <= radius)) s += _num(S.counter);
        if (Number.isFinite(player.q) && Hex.wrappingDistance(player.q, player.r, a.q, a.r, world.width || 0) <= 1) s += _num(S.present);
        const f = RivalAgents._person(world, a);
        if (f && f.person.mem && _num(f.person.mem.timesSpoken) > 0) s += _num(S.acquainted);
        a.suspicion = _num(a.suspicion) + s;
        if (a.suspicion >= _num(S.known, 100)) RivalAgents._reveal(player, world, a, out);
    },

    _reveal(player, world, a, out) {
        if (a.known) return;
        const day = _day(world);
        a.known = true;
        a.knownDay = day;
        const K = RivalAgents.kind(a.kind);
        RivalAgents._log(RivalAgents.state(player), day, `${a.name}, ${a.role} of ${a.town}, found to be ${a.rivalName}'s ${K.label.toLowerCase()}.`);
        const deed = a.acts > 0 || a.kind === 'official' ? RivalAgents.deed(player, a) : null;
        if (out) out.notices.push({ icon: K.icon || '🕵️', title: 'An Agent Unmasked', text: `${a.name}, ${a.role} of ${a.town}, is in the pay of ${a.rivalName} (${K.label.toLowerCase()})${deed ? `, and has ${deed}` : ''}. Turn or expose them from Dynasty → Threats.`, type: 'warning' });
    },

    /** A turned agent's weekly report: the rival's plots come to light (house.informants, read by Schemes.revealChance). */
    _report(player, world, a) {
        const house = player.house;
        if (!_obj(house.informants)) house.informants = {};
        const C = RivalAgents.config();
        house.informants[a.rivalId] = { name: a.name, town: a.town, q: a.q, r: a.r, pid: a.pid, untilDay: _day(world) + _num(C.turnedReport, 120) };
    },

    // ──────────── THE PLAYER'S MOVES ────────────

    /** Ask around town (the player must be there): gold, and suspicion of whoever here is in a rival's pay. */
    inquire(player, world, q, r) {
        const C = RivalAgents.config();
        const day = _day(world);
        const t = RivalAgents._folkAt(world, q, r, true);
        if (t && !t.folk) t.folk = Townsfolk.seed(t.s, world, { q, r });
        if (!t || !t.folk || Townsfolk.residents(t.folk).length < 3) return { success: false, reason: 'There is no one here you know well enough to ask.' };
        if (!Number.isFinite(player.q) || Hex.wrappingDistance(player.q, player.r, q, r, world.width || 0) > 0) return { success: false, reason: 'You must be in the town to ask around.' };
        const st = RivalAgents.state(player);
        if (st.lastInquiry && st.lastInquiry.day === day && st.lastInquiry.key === `${q},${r}`) return { success: false, reason: 'You have already asked around here today.' };
        const cost = _num(C.inquiry.gold, 25);
        if (_num(player.gold) < cost) return { success: false, reason: `Loosening tongues costs ${cost} gold.` };
        player.gold = _num(player.gold) - cost;
        Ledger.record(player, 'rivalAgents', -cost);
        st.lastInquiry = { day, key: `${q},${r}` };
        st.stats.inquiries++;
        const here = st.agents.filter(a => a.q === q && a.r === r && !a.known && !a.turned);
        const out = { notices: [] };
        let warmer = 0;
        for (const a of here) {
            a.suspicion = _num(a.suspicion) + _num(C.inquiry.suspicion, 35);
            warmer++;
            if (a.suspicion >= _num(C.suspicion.known, 100)) RivalAgents._reveal(player, world, a, out);
        }
        const named = out.notices.length;
        const text = named ? out.notices.map(n => n.text).join(' ')
            : warmer ? `Your coin buys hints, not names: someone in ${t.s.name} has been talking to strangers. Keep asking.`
                : `You spend ${cost} gold on ale and questions in ${t.s.name}. No one here is in a rival's pay, as far as anyone knows.`;
        return { success: true, cost, text, named, warmer };
    },

    turnCost(player, a) {
        const C = RivalAgents.config();
        const rival = player.house && player.house.rivals ? player.house.rivals[a.rivalId] : null;
        return Math.round(_num(C.turnBase) + _num(C.turnPerFeud) * _num(rival && rival.feud));
    },

    _find(player, id) {
        return RivalAgents.list(player).find(a => a.id === id) || null;
    },

    /** Pay a known agent to serve you instead: their bribe ends and they inform on their master. */
    turn(player, world, id) {
        const a = RivalAgents._find(player, id);
        if (!a || !a.known) return { success: false, reason: 'No such agent is known to you.' };
        if (a.turned) return { success: false, reason: `${a.name} already serves you.` };
        const f = RivalAgents._person(world, a);
        if (!f || !Townsfolk.isHere(f.person)) return { success: false, reason: `${a.name} is gone from ${a.town}.` };
        const cost = RivalAgents.turnCost(player, a);
        if (_num(player.gold) < cost) return { success: false, reason: `${a.name} wants ${cost} gold.` };
        player.gold = _num(player.gold) - cost;
        Ledger.record(player, 'rivalAgents', -cost);
        const day = _day(world);
        a.turned = true;
        a.turnedDay = day;
        if (a.kind === 'official') RivalAgents._bribe(world, a, false);
        RivalAgents._report(player, world, a);
        Coalitions.onAgent(player, world, a.rivalId, 'turned');
        if (!f.person.mem) f.person.mem = { timesSpoken: 0, disposition: 50 };
        f.person.mem.disposition = Math.min(100, _num(f.person.mem.disposition, 50) + 15);
        Townsfolk.note(f.person, day, 'informant', null, a.rivalName);
        const st = RivalAgents.state(player);
        st.stats.turned++;
        RivalAgents._log(st, day, `${a.name} of ${a.town} turned against ${a.rivalName}.`);
        House._chronicle(player.house, world, `${a.name} of ${a.town} turns against ${a.rivalName} for ${player.house.name}'s coin.`, ['rival', 'agent']);
        return { success: true, cost, text: `${cost} gold, and ${a.name} is yours. ${a.kind === 'official' ? 'The skimming stops and the permits move again. ' : ''}They will feed ${a.rivalName} false word and tell you of its plots.` };
    },

    /** Name a known agent before the town: driven out, the rival shamed. */
    expose(player, world, id) {
        const a = RivalAgents._find(player, id);
        if (!a || !a.known) return { success: false, reason: 'No such agent is known to you.' };
        const C = RivalAgents.config();
        const day = _day(world);
        const f = RivalAgents._person(world, a);
        if (f && Townsfolk.isHere(f.person)) {
            const { folk, person, settlement } = f;
            if (!person.mem) person.mem = { timesSpoken: 0, disposition: 50 };
            person.mem.disposition = 0;
            person.mem.grudge = true;
            for (const kid of [person.spouse, ...(person.parents || []), ...(person.kids || [])]) {
                const k = kid != null ? Townsfolk.get(folk, kid) : null;
                if (k && k.mem) k.mem.disposition = Math.max(0, _num(k.mem.disposition, 50) - 20);
            }
            Townsfolk.exile(folk, person, day, `exile, for serving ${a.rivalName}`);
            Townsfolk.record(folk, world, day, { k: 'exiled', a: person.id, x: `for serving ${a.rivalName}` });
            if (settlement && settlement.kingdom) {
                if (!player.reputation) player.reputation = {};
                player.reputation[settlement.kingdom] = _num(player.reputation[settlement.kingdom]) + _num(C.exposeReputation, 4);
            }
        }
        House.accrueRivalFeud(player, world, a.rivalId, _num(C.exposeFeud, 5), 'agent exposed');
        const hit = Coalitions.onAgent(player, world, a.rivalId, 'exposed');
        RivalAgents._remove(player, world, a);
        const st = RivalAgents.state(player);
        st.stats.exposed++;
        RivalAgents._log(st, day, `${a.name} of ${a.town} exposed as ${a.rivalName}'s agent and driven out.`);
        const deed = RivalAgents.deed(player, a);
        House._chronicle(player.house, world, `${player.house.name} unmasks ${a.name} of ${a.town} as an agent of ${a.rivalName}${deed && (a.acts > 0 || a.kind === 'official') ? `, who ${deed}` : ''}.`, ['rival', 'agent']);
        return { success: true, text: `You name ${a.name} ${a.rivalName}'s creature before all ${a.town}, and they are driven out.${a.kind === 'official' ? ' The skimming stops.' : ''} ${a.rivalName} is shamed — and angrier.${hit ? ' The league it is sworn to is shaken.' : ''}` };
    },
};
