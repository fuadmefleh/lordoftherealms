// ============================================
// NIGHT STREETS — the town after dark: curfews, smugglers' landings, the thieves' market
// ============================================
// The domain half of the night-time underworld on the street map (the map
// half is ui/innerMapNight.js, the scenes ui/actionMenu/nightScenes.js):
//
//   DARK      — darkness cuts how far folk see a deed on the street
//               (systems/nightSight.js, read by StreetCrime.selectWitnesses
//               and container thefts); a light carried cuts nothing.
//               player.nightStreets.lightOut: the lantern shuttered (L).
//   CURFEW    — a realm's curfew law (Laws 'curfew') or a town's own
//               ordinance (settlement.ordinances.curfew; else a hash of the
//               town) shuts the streets from the bell to dawn. A guard who
//               sees you out stops you: answerChallenge talk / bribe / flee /
//               submit. Fines into the town's purse (Underworld._fine: the
//               realm's punishment law), bribes into the guard's purse,
//               the cells through Underworld._arrest, heat through
//               Underworld.recordCrime ('curfew').
//   LANDINGS  — some nights (a hash of the town and the night) one of the
//               town's gangs lands contraband at a quiet shore: goods bought
//               over the border out of a foreign market (Gangs._source, that
//               town's purse paid). joinLanding: a cut of the load in your
//               pack (untaxed contraband) at the risk of a raid;
//               informLanding: the load seized onto the town's market, a
//               reward from the town's purse, the gang's grudge; robLanding:
//               the whole load (hot) or a beating.
//   NIGHT MARKET — after dark in a back alley the gangs sell their stash
//               cheaply (coin into the gang's purse, goods out of its stash;
//               goods still cooling at the fence come hot) and their fence
//               buys yours (Underworld.sellToFence). Only the guild's
//               contacts and hands, and a gang's own, get in.
//
// State: player.nightStreets (saved, systems/saveLoad.js). Rolls on
// Utils.random; which nights a landing comes is a hash (no RNG). Explicit
// params, no globals. Data: data/nightStreets.json.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Underworld } from './underworld.js';
import { Gangs } from './gangs.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';
import { SocialSkills } from './socialSkills.js';
import { StreetCrime } from './streetCrime.js';
import { NightSight } from './nightSight.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _key = (q, r) => `${q},${r}`;

function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _range(arr, f, d) {
    const [lo, hi] = Array.isArray(arr) && arr.length === 2 ? arr : d;
    return Math.floor(lo + f * (hi - lo + 1 - 1e-9));
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _label(id) {
    return String(id || '').replace(/_/g, ' ');
}

/** Within [from, to) on the clock, the span running past midnight when from > to. */
function _inHours(hour, span) {
    if (!span) return false;
    const h = ((_num(hour, 12) % 24) + 24) % 24;
    const from = _num(span.from, 21), to = _num(span.to, 5);
    return from > to ? (h >= from || h < to) : (h >= from && h < to);
}

const DEFAULTS = {
    dark: { minDarkness: 0.25, maxSightCut: 4, litSpotRadius: 11, darkSpotRadius: 7 },
    curfew: {
        hours: { from: 21, to: 5 }, townHours: { from: 22, to: 5 }, townShare: 0.15,
        extraWatchShare: 0.5, patrolShare: 0.8, graceHours: 1.5, walkUpSeconds: 30, walkSpeedMult: 1.4,
        fine: { village: 8, town: 15, city: 25, capital: 40 }, repeatFineMult: 1.5,
        talk: { base: 0.45, charisma: 0.04, talkPerk: 0.012, heatDrag: 0.004, repeatDrag: 0.15, lodger: 0.15 },
        bribe: { costMult: 1.2, odds: 0.7, heatDrag: 0.003 },
        flee: { heatCaught: 6 },
        jailIfBroke: true,
        heat: { fined: 1, fled: 3, bribeRefused: 2 },
    },
    landings: {
        chance: 0.3, minGangPurse: 30, hours: { from: 22, to: 4 }, units: [4, 9], crew: [2, 4], cutShare: 0.3,
        joinAP: 1, joinHours: 2, raidBase: 0.06, raidPerCrackdown: 0.004, boughtCaptainMult: 0.3,
        informReward: 0.35, informCrackdown: 8,
        rob: { base: 0.47, strength: 0.03, agility: 0.02, perCrew: 0.06, beating: [10, 25], purseShare: 0.3 },
        grudgeDays: 60, approachRadius: 3,
    },
    market: { hours: { from: 21, to: 4 }, stashPrice: 0.6, fencedPrice: 0.45, maxWares: 10, approachRadius: 2, alleyTypes: ['warehouse', 'house'], fences: ['Hooded fence'] },
    barks: {},
    text: {},
};

export const NightStreets = {
    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.nightStreets) || {};
        const out = { ...DEFAULTS };
        for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        return out;
    },

    _c(section) {
        return NightStreets.config()[section] || {};
    },

    line(pool, key) {
        const list = (NightStreets._c('barks')[pool]) || [];
        return list.length ? list[Math.floor(_frac(key) * list.length) % list.length] : null;
    },

    text(id, vars = {}) {
        return _fill(NightStreets._c('text')[id] || '', vars);
    },

    // ──────────── STATE ────────────

    ensure(player) {
        if (!player) return null;
        let st = player.nightStreets;
        if (!_obj(st)) st = player.nightStreets = {};
        if (typeof st.lightOut !== 'boolean') st.lightOut = false;
        if (!_obj(st.grudge)) st.grudge = {};
        if (!_obj(st.stops)) st.stops = {};
        if (!_obj(st.landings)) st.landings = {};
        if (!Array.isArray(st.log)) st.log = [];
        st.stats = { stops: 0, fines: 0, bribes: 0, fled: 0, jailed: 0, joined: 0, informed: 0, robbed: 0, bought: 0, ...(_obj(st.stats) || {}) };
        return st;
    },

    _log(player, world, text) {
        const st = NightStreets.ensure(player);
        st.log.unshift({ day: _num(world && world.day), text });
        if (st.log.length > 20) st.log.length = 20;
    },

    // ──────────── THE DARK ────────────

    /** Does the player carry a light (not shuttered)? */
    lit(player) {
        return !(player && player.nightStreets && player.nightStreets.lightOut);
    },

    /** Shutter or light your lantern (L on the street map). → the new state: true = lit. */
    toggleLight(player) {
        const st = NightStreets.ensure(player);
        st.lightOut = !st.lightOut;
        return !st.lightOut;
    },

    /** Hand the street map's darkness to NightSight (the witness rules read it). */
    setAmbient(darkness, lit) {
        const D = NightStreets._c('dark');
        NightSight.set(darkness, lit, D.maxSightCut, D.minDarkness);
    },

    /** How far a guard sees you out after curfew: far with a light, near in the dark. */
    spotRadius(darkness, lit) {
        const D = NightStreets._c('dark');
        if (lit) return _num(D.litSpotRadius, 11);
        return Math.max(2, _num(D.darkSpotRadius, 7) - NightSight.cutFor(darkness, false, D.maxSightCut, D.minDarkness));
    },

    // ──────────── CURFEW ────────────

    /** A town's own curfew (its ordinance, else its old custom: a hash of the town). */
    localCurfew(settlement) {
        if (!settlement) return false;
        const set = settlement.ordinances && settlement.ordinances.curfew;
        if (set === 'curfew' || set === true) return true;
        if (set === 'none' || set === false) return false;
        const C = NightStreets._c('curfew');
        return _frac(`${settlement.name || ''}|${settlement.q},${settlement.r}|curfew`) < _num(C.townShare, 0.15);
    },

    /**
     * The curfew in this town: { active, from, to, by: 'realm'|'town'|null, why }.
     * The realm's law first; else the town's own, a little later in the night.
     */
    curfew(world, settlement) {
        const C = NightStreets._c('curfew');
        if (!settlement) return { active: false, from: null, to: null, by: null, why: '' };
        const realm = settlement.kingdom != null ? Laws.value(world, settlement.kingdom, 'curfew') : null;
        if (realm === 'curfew') {
            const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(settlement.kingdom) : null;
            const h = C.hours || { from: 21, to: 5 };
            return { active: true, from: _num(h.from, 21), to: _num(h.to, 5), by: 'realm', why: `The law of ${(k && k.name) || 'the realm'} keeps a curfew.` };
        }
        if (NightStreets.localCurfew(settlement)) {
            const h = C.townHours || C.hours || { from: 22, to: 5 };
            return { active: true, from: _num(h.from, 22), to: _num(h.to, 5), by: 'town', why: `${settlement.name || 'The town'} rings its own curfew bell.` };
        }
        return { active: false, from: null, to: null, by: null, why: '' };
    },

    /** Is the curfew on at this hour here? */
    inCurfew(world, settlement, hour) {
        const c = NightStreets.curfew(world, settlement);
        return c.active && _inHours(hour, c);
    },

    /** The bell's hour as said aloud: "nine". */
    bellHour(h) {
        const n = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
        return n[((Math.floor(_num(h, 21)) % 12) + 12) % 12];
    },

    /** The player may walk the curfew: the realm's ruler (its watch stands aside). */
    exempt(player, world, settlement) {
        return StreetCrime.aboveLaw(player, world, settlement);
    },

    _typeFine(settlement) {
        const F = NightStreets._c('curfew').fine || {};
        return _num(F[settlement && settlement.type], _num(F.town, 15));
    },

    /** Times stopped in this town tonight. */
    stopsTonight(player, settlement, day) {
        const st = NightStreets.ensure(player);
        const s = st.stops[_key(settlement && settlement.q, settlement && settlement.r)];
        return s && s.day === _num(day) ? _num(s.n) : 0;
    },

    noteStop(player, settlement, day) {
        const st = NightStreets.ensure(player);
        const k = _key(settlement && settlement.q, settlement && settlement.r);
        const s = st.stops[k];
        st.stops[k] = { day: _num(day), n: (s && s.day === _num(day) ? _num(s.n) : 0) + 1 };
        st.stats.stops++;
    },

    /** The fine for breaking the curfew (before the realm's punishment law, which Underworld._fine applies). */
    fineFor(player, world, settlement) {
        const C = NightStreets._c('curfew');
        const repeat = Math.max(0, NightStreets.stopsTonight(player, settlement, world && world.day) - 1);
        return Math.round(NightStreets._typeFine(settlement) * Math.pow(_num(C.repeatFineMult, 1.5), repeat));
    },

    bribeCost(player, world, settlement) {
        const C = NightStreets._c('curfew');
        const heat = Underworld.getHeat(player, settlement && settlement.kingdom);
        return Math.max(2, Math.round(NightStreets.fineFor(player, world, settlement) * _num(C.bribe.costMult, 1.2) * (1 + heat / 50)));
    },

    talkChance(player, world, settlement, ctx = {}) {
        const T = NightStreets._c('curfew').talk || {};
        const heat = Underworld.getHeat(player, settlement && settlement.kingdom);
        const repeat = Math.max(0, NightStreets.stopsTonight(player, settlement, world && world.day) - 1);
        let p = _num(T.base, 0.45)
            + (_num(player && player.charisma, 5) - 5) * _num(T.charisma, 0.04)
            + SocialSkills.perk(player, 'persuasion', 'talk') * _num(T.talkPerk, 0.012)
            - heat * _num(T.heatDrag, 0.004)
            - repeat * _num(T.repeatDrag, 0.15)
            + (ctx.lodger ? _num(T.lodger, 0.15) : 0);
        return _clamp(p, 0.05, 0.92);
    },

    bribeChance(player, world, settlement) {
        const B = NightStreets._c('curfew').bribe || {};
        const heat = Underworld.getHeat(player, settlement && settlement.kingdom);
        return _clamp(_num(B.odds, 0.7) + SocialSkills.frac(player, 'persuasion', 'bribeOdds') - heat * _num(B.heatDrag, 0.003), 0.05, 0.95);
    },

    /** The challenge's choices: [{ id, icon, label, hint, chance, cost, can, reason }]. */
    challengeOptions(player, world, settlement, ctx = {}) {
        const fine = Math.round(NightStreets.fineFor(player, world, settlement) * (settlement && settlement.kingdom != null ? Laws.punishment(world, settlement.kingdom).fine : 1));
        const bribe = NightStreets.bribeCost(player, world, settlement);
        const gold = Math.floor(_num(player && player.gold));
        return [
            { id: 'talk', icon: '🗣️', label: 'Talk your way home', hint: 'An errand, a sick friend, lost your way: if they believe you, you go on with a warning.', chance: NightStreets.talkChance(player, world, settlement, ctx) },
            { id: 'bribe', icon: '💰', label: 'Slip them a coin', cost: `${bribe}g`, hint: 'A guard who won\'t take it fines you all the same.', chance: NightStreets.bribeChance(player, world, settlement), can: gold >= bribe, reason: `You need ${bribe} gold` },
            { id: 'flee', icon: '🏃', label: 'Run for it', hint: 'Lose them in the dark (a light carried gives you away). Caught, it is the cells.', chance: NightStreets.fleeChance(player, ctx) },
            { id: 'submit', icon: '⚖️', label: `Pay the fine (${fine}g)`, hint: gold >= fine ? 'Into the town\'s purse; the realm\'s punishment law sets it.' : 'You cannot pay it: a night in the cells.', chance: null },
        ];
    },

    fleeChance(player, ctx = {}) {
        let p = StreetCrime.escapeChance(player);
        // The dark hides a runner; a light carried shows the way to them
        if (ctx.lit === false) p += 0.15;
        else if (ctx.lit) p -= 0.1;
        return _clamp(p, 0.05, 0.9);
    },

    /**
     * Answer the watch: 'talk' | 'bribe' | 'flee' | 'submit'.
     * ctx: { guardName, guard (npc with a _person purse), lit, lodger, q, r (the town's world hex) }
     * → { outcome: 'let_go'|'bribed'|'fined'|'fled'|'jailed', text, fine?, jailed? }
     */
    answerChallenge(player, world, settlement, choice, ctx = {}) {
        if (!player || !settlement) return { outcome: 'let_go', text: '' };
        const C = NightStreets._c('curfew');
        const st = NightStreets.ensure(player);
        const vars = { guard: ctx.guardName || 'The guard' };
        const kingdom = settlement.kingdom;
        const qr = { q: ctx.q != null ? ctx.q : settlement.q, r: ctx.r != null ? ctx.r : settlement.r };
        const fineOut = (textId) => {
            const want = NightStreets.fineFor(player, world, settlement);
            const law = kingdom != null ? Laws.punishment(world, kingdom).fine : 1;
            if (Math.floor(_num(player.gold)) < Math.round(want * law) && C.jailIfBroke !== false) {
                return NightStreets._jail(player, world, settlement, NightStreets.text('broke', vars) || 'You cannot pay; the cells.', qr);
            }
            const fine = Underworld._fine(player, world, settlement, want);
            st.stats.fines += fine;
            Underworld.recordCrime(player, world, 'curfew', { kingdom, caught: false, scale: _num(C.heat && C.heat.fined, 1), ...qr });
            NightStreets._log(player, world, `Fined ${fine}g for breaking the curfew in ${settlement.name || 'town'}.`);
            return { outcome: 'fined', fine, text: NightStreets.text(textId, { ...vars, fine }) || `Fined ${fine}g.` };
        };
        if (choice === 'talk') {
            if (Utils.random() < NightStreets.talkChance(player, world, settlement, ctx)) return { outcome: 'let_go', text: NightStreets.text('talk_ok', vars) || 'They let you go.' };
            return fineOut('talk_fail');
        }
        if (choice === 'bribe') {
            const cost = NightStreets.bribeCost(player, world, settlement);
            if (Math.floor(_num(player.gold)) < cost) return { outcome: 'invalid', invalid: true, text: `You need ${cost} gold.` };
            if (Utils.random() < NightStreets.bribeChance(player, world, settlement)) {
                player.gold -= cost;
                Ledger.record(player, 'bribes', -cost);
                // Into the guard's own purse (a townsperson's), else the watch's (the captain's)
                const holder = ctx.guard && _obj(ctx.guard._person) ? ctx.guard._person : null;
                if (holder) holder.purse = Math.round((_num(holder.purse) + cost) * 100) / 100;
                else Gangs.payCaptain(world, { q: qr.q, r: qr.r, settlement }, cost);
                st.stats.bribes++;
                return { outcome: 'bribed', paid: cost, text: NightStreets.text('bribe_ok', vars) || 'They take the coin.' };
            }
            Underworld.addHeat(player, kingdom, _num(C.heat && C.heat.bribeRefused, 2), world);
            return fineOut('bribe_fail');
        }
        if (choice === 'flee') {
            if (Utils.random() < NightStreets.fleeChance(player, ctx)) {
                st.stats.fled++;
                Underworld.recordCrime(player, world, 'curfew', { kingdom, caught: false, scale: _num(C.heat && C.heat.fled, 3), ...qr });
                return { outcome: 'fled', text: NightStreets.text('flee_ok', vars) || 'You get away.' };
            }
            Underworld.recordCrime(player, world, 'curfew', { kingdom, caught: true, scale: _num(C.flee && C.flee.heatCaught, 6) / 3, ...qr });
            return NightStreets._jail(player, world, settlement, NightStreets.text('flee_fail', vars) || 'Caught.', qr);
        }
        // submit
        return fineOut('submit');
    },

    _jail(player, world, settlement, text, qr = {}) {
        const st = NightStreets.ensure(player);
        const arrest = Underworld._arrest(player, world, settlement, 'breaking the curfew');
        if (player.jailState && qr.q != null && player.jailState.q == null) { player.jailState.q = qr.q; player.jailState.r = qr.r; }
        st.stats.jailed++;
        NightStreets._log(player, world, `Jailed for breaking the curfew in ${settlement.name || 'town'}.`);
        return { outcome: 'jailed', jailed: true, days: arrest.days, text: `${text} ${arrest.text}`.trim() };
    },

    // ──────────── SMUGGLERS' LANDINGS ────────────

    _seed(world) {
        return (world && world.generationParams && world.generationParams.seed) || 0;
    },

    /** Is it the hour of a landing? */
    landingHour(hour) {
        return _inHours(hour, NightStreets._c('landings').hours);
    },

    /**
     * Tonight's landing at this town, or null: one of its gangs runs a load of
     * contraband in from over the border (a hash of the town and the night).
     * → { key, q, r, day, good, units, ask, from, gangId, gangName, crew }
     */
    landingPlan(world, tile, day) {
        const s = tile && tile.settlement;
        if (!s || !Gangs.hasGangs(s) || s.kingdom == null) return null;
        const L = NightStreets._c('landings');
        const base = `${NightStreets._seed(world)}|land|${tile.q},${tile.r}|${_num(day)}`;
        if (_frac(base) >= _num(L.chance, 0.3)) return null;
        const gangs = Gangs.gangsAt(world, tile).filter(g => _num(g.purse) >= _num(L.minGangPurse, 30));
        if (!gangs.length) return null;
        const g = gangs[Math.floor(_frac(`${base}|gang`) * gangs.length) % gangs.length];
        const good = Gangs._smuggleChoice(world, tile);
        if (!good) return null;
        const src = Gangs._source(world, tile, good);
        if (!src) return null;
        const want = _range(L.units, _frac(`${base}|units`), [4, 9]);
        const units = Math.min(want, Math.floor(_num(g.purse) / Math.max(1, src.ask)), Math.floor(SettlementMarket.available(src.s, good)));
        if (!(units >= 1)) return null;
        return {
            key: `${tile.q},${tile.r}|${_num(day)}`, q: tile.q, r: tile.r, day: _num(day),
            good, units, ask: src.ask, from: src.s.name || 'over the border',
            gangId: g.id, gangName: g.name || 'a crew', crew: _range(L.crew, _frac(`${base}|crew`), [2, 4]),
        };
    },

    /** What has become of tonight's landing for the player: null | 'joined' | 'informed' | 'robbed' | 'beaten'. */
    landingDone(player, plan) {
        const st = player && player.nightStreets;
        return (plan && st && _obj(st.landings) && st.landings[plan.key]) || null;
    },

    /** A gang here holds a grudge against the player (informed on them, robbed a landing)? */
    grudge(player, world, tile) {
        const st = player && player.nightStreets;
        const g = st && _obj(st.grudge) ? st.grudge[_key(tile && tile.q, tile && tile.r)] : null;
        if (!g) return null;
        const days = _num(NightStreets._c('landings').grudgeDays, 60);
        return _num(world && world.day) - _num(g.day) < days ? g : null;
    },

    _setGrudge(player, world, tile, why) {
        NightStreets.ensure(player).grudge[_key(tile.q, tile.r)] = { day: _num(world && world.day), why };
    },

    /**
     * The load comes ashore: the gang bought it over the border (that town's
     * market stock down, its purse paid). → units landed, or 0.
     */
    _land(world, tile, plan) {
        const g = Gangs.gang(world, tile, plan.gangId);
        if (!g) return { g: null, got: 0 };
        const src = Gangs._source(world, tile, plan.good);
        if (!src) return { g, got: 0 };
        const n = Math.min(plan.units, Math.floor(_num(g.purse) / Math.max(1, src.ask)), Math.floor(SettlementMarket.available(src.s, plan.good)));
        if (!(n >= 1)) return { g, got: 0 };
        const got = SettlementMarket.take(src.s, plan.good, n);
        const cost = Math.round(got * src.ask);
        g.purse = Math.round((_num(g.purse) - cost) * 100) / 100;
        Gangs._book(g, 'out', 'smuggling', cost);
        Economy.payTown(src.s, cost);
        return { g, got, cost, from: src.s.name };
    },

    /** The odds the watch falls on a landing you help with. */
    raidChance(player, world, tile) {
        const L = NightStreets._c('landings');
        let p = _num(L.raidBase, 0.06) + Gangs.crackdown(world, tile) * _num(L.raidPerCrackdown, 0.004);
        if (Gangs.bought(player, world, tile).captain) p *= _num(L.boughtCaptainMult, 0.3);
        return _clamp(p, 0.01, 0.8);
    },

    robChance(player, plan) {
        const R = NightStreets._c('landings').rob || {};
        const str = _num(player && player.strength, 5);
        const agi = _num(player && (player.agility != null ? player.agility : player.dexterity), 5);
        return _clamp(_num(R.base, 0.47) + (str - 5) * _num(R.strength, 0.03) + (agi - 5) * _num(R.agility, 0.02) - _num(plan && plan.crew, 3) * _num(R.perCrew, 0.06), 0.05, 0.9);
    },

    /** The landing's choices: [{ id, icon, label, hint, chance, can, reason }]. */
    landingOptions(player, world, tile, plan) {
        const L = NightStreets._c('landings');
        const ap = _num(L.joinAP, 1);
        const grudge = NightStreets.grudge(player, world, tile);
        const cut = Math.max(1, Math.round(plan.units * _num(L.cutShare, 0.3)));
        return [
            { id: 'join', icon: '📦', label: 'Lend a hand', hint: `Carry the load for a cut (~${cut} ${_label(plan.good)}), no tariff paid. The watch may fall on it.`, chance: 1 - NightStreets.raidChance(player, world, tile), can: !grudge && _num(player.actionPoints) >= ap, reason: grudge ? 'They know what you did. Not tonight, not ever.' : `Needs ${ap} action point` },
            { id: 'inform', icon: '🛡️', label: 'Tell the watch', hint: 'The load seized, a reward from the town\'s purse; the gang will not forget it.', chance: null },
            { id: 'rob', icon: '🗡️', label: 'Rob them', hint: `${plan.crew} of them in the dark. Win, and the load is yours (stolen, hot); lose, and they beat you and take your purse.`, chance: NightStreets.robChance(player, plan) },
            { id: 'leave', icon: '↩', label: 'Leave them to it', chance: null, isDefault: true },
        ];
    },

    joinLanding(player, world, tile, plan) {
        if (!player || !plan) return { success: false, reason: 'Nothing to join.' };
        if (NightStreets.landingDone(player, plan)) return { success: false, reason: 'That landing is done with.' };
        if (NightStreets.grudge(player, world, tile)) return { success: false, reason: 'They know what you did. Not tonight, not ever.' };
        const L = NightStreets._c('landings');
        const ap = _num(L.joinAP, 1);
        if (_num(player.actionPoints) < ap) return { success: false, reason: `It takes ${ap} action point.` };
        player.actionPoints -= ap;
        const st = NightStreets.ensure(player);
        const s = tile.settlement;
        const vars = { shore: plan.shore || 'shore', good: _label(plan.good), gang: plan.gangName };
        const { g, got } = NightStreets._land(world, tile, plan);
        st.landings[plan.key] = 'joined';
        if (!g || !(got >= 1)) return { success: true, cut: 0, text: 'The boat came in near empty: nothing worth the carrying tonight.' };
        if (Utils.random() < NightStreets.raidChance(player, world, tile)) {
            // Seized: the town sells it off
            SettlementMarket.add(s, plan.good, got);
            Underworld.recordCrime(player, world, 'smuggling', { kingdom: s.kingdom, caught: true, q: tile.q, r: tile.r });
            const arrest = Underworld._maybeArrest(player, world, s, 'smuggling', 0.5);
            NightStreets._log(player, world, `A landing raided in ${s.name}.`);
            return { success: true, raided: true, jailed: !!arrest, text: `${NightStreets.text('join_raided', vars)}${arrest ? ` ${arrest.text}` : ' You slip away in the confusion.'}` };
        }
        const want = Math.max(1, Math.round(got * _num(L.cutShare, 0.3)));
        let cut = 0;
        const res = PlayerInventory.addItem(player, plan.good, want);
        if (res && res.success) cut = want;
        // The rest (and a cut that wouldn't fit) goes into the gang's stash
        g.stash[plan.good] = Math.round((_num(g.stash[plan.good]) + got - cut) * 100) / 100;
        Underworld.recordCrime(player, world, 'smuggling', { kingdom: s.kingdom, q: tile.q, r: tile.r });
        const m = Gangs.membership(player, tile);
        if (m && m.gangId === g.id) Gangs._gainStanding(player, world, tile, m, 2);
        st.stats.joined++;
        NightStreets._log(player, world, `Helped ${g.name} land ${got} ${_label(plan.good)} in ${s.name}; your cut ${cut}.`);
        return { success: true, cut, hours: _num(L.joinHours, 2), text: cut ? NightStreets.text('join_ok', { ...vars, cut }) : 'Your pack is full: your cut goes back on the boat.' };
    },

    informLanding(player, world, tile, plan) {
        if (!player || !plan) return { success: false, reason: 'Nothing to tell.' };
        if (NightStreets.landingDone(player, plan)) return { success: false, reason: 'That landing is done with.' };
        const L = NightStreets._c('landings');
        const st = NightStreets.ensure(player);
        const s = tile.settlement;
        const { g, got } = NightStreets._land(world, tile, plan);
        st.landings[plan.key] = 'informed';
        const vars = { shore: plan.shore || 'shore', good: _label(plan.good), gang: plan.gangName };
        if (!(got >= 1)) return { success: true, reward: 0, text: 'By the time the watch comes, the boat is gone and the bank empty.' };
        SettlementMarket.add(s, plan.good, got);
        const want = Math.round(got * _num(plan.ask, 10) * _num(L.informReward, 0.35));
        const reward = Math.floor(Economy.drawTown(s, want));
        if (reward > 0) { player.gold = _num(player.gold) + reward; Ledger.record(player, 'bounties', reward); }
        Gangs.addCrackdown(world, tile.q, tile.r, _num(L.informCrackdown, 8));
        NightStreets._setGrudge(player, world, tile, 'informed');
        // One of their own turned informer: out of the crew
        const m = Gangs.membership(player, tile);
        if (g && m && m.gangId === g.id) Gangs.leave(player, world, tile);
        player.karma = Math.min(100, _num(player.karma) + 1);
        st.stats.informed++;
        NightStreets._log(player, world, `Informed on ${plan.gangName}'s landing in ${s.name}: ${reward}g.`);
        return { success: true, reward, text: NightStreets.text('inform_ok', { ...vars, reward }) };
    },

    robLanding(player, world, tile, plan) {
        if (!player || !plan) return { success: false, reason: 'Nothing to rob.' };
        if (NightStreets.landingDone(player, plan)) return { success: false, reason: 'That landing is done with.' };
        const R = NightStreets._c('landings').rob || {};
        const st = NightStreets.ensure(player);
        const s = tile.settlement;
        const vars = { shore: plan.shore || 'shore', good: _label(plan.good), gang: plan.gangName };
        NightStreets._setGrudge(player, world, tile, 'robbed');
        if (Utils.random() < NightStreets.robChance(player, plan)) {
            const { g, got } = NightStreets._land(world, tile, plan);
            st.landings[plan.key] = 'robbed';
            if (!(got >= 1)) return { success: true, units: 0, text: 'They scatter, but the boat held nothing worth the taking.' };
            const loot = Underworld._addLoot(player, world, { [plan.good]: got });
            const kept = _num(loot.added[plan.good]);
            if (g && got - kept > 0) g.stash[plan.good] = Math.round((_num(g.stash[plan.good]) + got - kept) * 100) / 100;
            Underworld.recordCrime(player, world, 'robbery', { kingdom: s.kingdom, q: tile.q, r: tile.r });
            st.stats.robbed++;
            NightStreets._log(player, world, `Robbed ${plan.gangName}'s landing in ${s.name}: ${kept} ${_label(plan.good)}.`);
            return { success: true, units: kept, text: NightStreets.text('rob_ok', { ...vars, units: kept }) };
        }
        st.landings[plan.key] = 'beaten';
        const [lo, hi] = Array.isArray(R.beating) ? R.beating : [10, 25];
        const blow = Utils.randInt(lo, hi);
        player.health = Math.max(1, _num(player.health, 100) - blow);
        const lost = Math.floor(_num(player.gold) * _num(R.purseShare, 0.3));
        if (lost > 0) {
            player.gold -= lost;
            Ledger.record(player, 'robbery', -lost);
            const g = Gangs.gang(world, tile, plan.gangId);
            if (g) { g.purse = Math.round((_num(g.purse) + lost) * 100) / 100; Gangs._book(g, 'in', 'robbery', lost); }
            else Economy.payTown(s, lost);
        }
        return { success: true, beaten: true, lost, text: NightStreets.text('rob_fail', { ...vars, lost }) };
    },

    // ──────────── THE NIGHT MARKET ────────────

    marketOpen(hour) {
        return _inHours(hour, NightStreets._c('market').hours);
    },

    /** Has the town a night market at all? (where gangs live) */
    hasMarket(settlement) {
        return Gangs.hasGangs(settlement);
    },

    /** The fence who keeps it (a name, the same all game). */
    fenceName(world, tile) {
        const list = NightStreets._c('market').fences || ['Hooded fence'];
        return list[Math.floor(_frac(`${NightStreets._seed(world)}|fence|${tile && tile.q},${tile && tile.r}`) * list.length) % list.length];
    },

    /** May the player in? → { ok, reason, why: 'shut'|'grudge'|'stranger' } */
    canEnterMarket(player, world, tile, hour) {
        const s = tile && tile.settlement;
        if (!NightStreets.hasMarket(s)) return { ok: false, why: 'none', reason: 'No night market works a place this small.' };
        if (hour != null && !NightStreets.marketOpen(hour)) return { ok: false, why: 'shut', reason: NightStreets.text('market_shut') };
        if (NightStreets.grudge(player, world, tile)) return { ok: false, why: 'grudge', reason: NightStreets.text('market_refused') };
        const uw = Underworld.ensure(player);
        if (!(uw.guild.contactMet || uw.guild.member || Gangs.membership(player, tile))) return { ok: false, why: 'stranger', reason: NightStreets.text('market_stranger') };
        return { ok: true };
    },

    /**
     * What the night market sells tonight: the gangs' stash (contraband,
     * cold fenced goods) cheaply, and goods still cooling at the fence
     * cheaper (hot to you). → [{ good, qty, price, hot, gangId }]
     */
    marketWares(player, world, tile) {
        const M = NightStreets._c('market');
        const out = [];
        for (const g of Gangs.gangsAt(world, tile)) {
            for (const [good, q] of Object.entries(g.stash || {})) {
                const qty = Math.floor(_num(q));
                if (qty < 1) continue;
                const price = Math.max(1, Math.floor(Underworld.blackMarketPrice(world, tile, good) * _num(M.stashPrice, 0.6)));
                out.push({ good, qty, price, hot: false, gangId: g.id });
            }
            for (const f of g.fenced || []) {
                const qty = Math.floor(_num(f.qty));
                if (qty < 1) continue;
                const price = Math.max(1, Math.floor(Underworld._baseValue(f.good) * _num(M.fencedPrice, 0.45)));
                out.push({ good: f.good, qty, price, hot: true, gangId: g.id });
            }
        }
        // Merge the same good and kind across gangs, cheapest seller first
        out.sort((a, b) => a.price - b.price);
        const seen = new Map();
        const merged = [];
        for (const w of out) {
            const k = `${w.good}|${w.hot}`;
            if (seen.has(k)) continue;
            seen.set(k, true);
            merged.push(w);
        }
        return merged.sort((a, b) => b.price * b.qty - a.price * a.qty).slice(0, _num(M.maxWares, 10));
    },

    /** Buy from the night market: coin into the gang's purse, goods out of its stash (or its fence's pile). */
    buyFromMarket(player, world, tile, good, hot = false, qty = 1) {
        const ok = NightStreets.canEnterMarket(player, world, tile);
        if (!ok.ok) return { success: false, reason: ok.reason };
        const ware = NightStreets.marketWares(player, world, tile).find(w => w.good === good && !!w.hot === !!hot);
        if (!ware) return { success: false, reason: 'Nobody has that tonight.' };
        const g = Gangs.gang(world, tile, ware.gangId);
        if (!g) return { success: false, reason: 'Nobody has that tonight.' };
        const n = Math.min(Math.floor(_num(qty, 1)), ware.qty);
        const cost = n * ware.price;
        if (_num(player.gold) < cost) return { success: false, reason: `That's ${cost}g; you have ${Math.floor(_num(player.gold))}g.` };
        const add = PlayerInventory.addItem(player, good, n);
        if (!add || !add.success) return { success: false, reason: PlayerInventory.fullMessage ? PlayerInventory.fullMessage(player) : 'Your pack is full.' };
        player.gold -= cost;
        Ledger.record(player, 'blackMarket', -cost);
        g.purse = Math.round((_num(g.purse) + cost) * 100) / 100;
        Gangs._book(g, 'in', 'nightMarket', cost);
        if (hot) {
            let left = n;
            for (const f of g.fenced || []) {
                if (left <= 0) break;
                if (f.good !== good) continue;
                const t = Math.min(_num(f.qty), left);
                f.qty -= t; left -= t;
            }
            g.fenced = (g.fenced || []).filter(f => _num(f.qty) > 0);
            Underworld.markHot(player, good, n, _num(world && world.day));
        } else {
            g.stash[good] = Math.round((_num(g.stash[good]) - n) * 100) / 100;
            if (g.stash[good] <= 0) delete g.stash[good];
        }
        NightStreets.ensure(player).stats.bought += n;
        Underworld.recordCrime(player, world, 'black_market', { kingdom: tile.settlement.kingdom, scale: hot ? 0.5 : 0.25 });
        return { success: true, cost, text: `${n} ${_label(good)} for ${cost}g${hot ? ' (stolen: hot for a while)' : ''}. No questions asked.` };
    },

    /** Sell to the night market's fence (the gangs' fence: Underworld.sellToFence). */
    sellAtMarket(player, world, tile, good, qty = 1) {
        const ok = NightStreets.canEnterMarket(player, world, tile);
        if (!ok.ok) return { success: false, reason: ok.reason };
        const uw = Underworld.ensure(player);
        // (in the market, the fence deals with you as with a contact)
        const was = uw.guild.contactMet;
        uw.guild.contactMet = true;
        try { return Underworld.sellToFence(player, world, tile, good, qty); } finally { uw.guild.contactMet = was; }
    },

    /** A line for the Underworld panel: where tonight's market is kept. */
    marketHint(player, world, tile, where = null) {
        const s = tile && tile.settlement;
        if (!NightStreets.hasMarket(s)) return '';
        const can = NightStreets.canEnterMarket(player, world, tile);
        if (!can.ok && can.why === 'stranger') return '';
        if (!can.ok && can.why === 'grudge') return 'The night market is shut to you here: they know what you did.';
        return `After dark a night market opens ${where ? `behind ${where}` : 'in a back alley'}: ${NightStreets.fenceName(world, tile)} sells the gangs' stash cheap and buys what you bring.`;
    },

    // ──────────── THE DAY ────────────

    /** Day's end: forget last nights' landings and stops; grudges run out. */
    processDay(player, world) {
        if (!player || !player.nightStreets) return;
        const st = NightStreets.ensure(player);
        const day = _num(world && world.day);
        for (const k of Object.keys(st.landings)) {
            const d = Number(k.split('|')[1]);
            if (!(day - d <= 2)) delete st.landings[k];
        }
        for (const [k, v] of Object.entries(st.stops)) if (!v || day - _num(v.day) > 2) delete st.stops[k];
        const G = _num(NightStreets._c('landings').grudgeDays, 60);
        for (const [k, v] of Object.entries(st.grudge)) if (!v || day - _num(v.day) >= G) delete st.grudge[k];
    },
};
