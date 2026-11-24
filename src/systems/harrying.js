// ============================================
// HARRYING — the countryside burned in war
// ============================================
// In a war the cheapest way to hurt a realm is not to besiege its towns but
// to ride through its land and ruin it: burn the villages and farmsteads,
// fire the standing crops and the mill, drive off the herds, kill or scatter
// the peasants. The realm starves, its lords' rents and its crown's taxes
// fall, and its army must come out to fight. Six acts (data/harrying.json
// acts), each done to a settlement by the player (player/harrying.js) or by a
// realm's riders in an AI war (weekly, hash-rolled):
//
//   torch     settlement.damage (the market's production, the harvest, the
//             labour market's danger — so its people keep leaving) held up
//             until rebuilt, the rebuilding eating the market's wood; a fire
//             mark (burnt shells on the street map: systems/townMemory.js);
//             the dead and the homeless (refugees moved to the realm's other
//             towns: TownLabour.moveMix, remembered for their return by
//             systems/labour.js); the granary and the stores burned, after the
//             harriers carry off what food they can (real goods, to whoever
//             carries them)
//   fields    the harvest in force falls (world/harvests.js farm.y: market
//             grain, granary food, the crown's land tax, rents, revolt
//             hunger) and, in the growing season, the next one reckoned
//             (settlement.harried.fields, read by Harvests._settle); out of
//             season the barns burn; the estates' soil (rents, values) is
//             scorched and grows back
//   mill      market.idle.mill (no flour ground) until rebuilt — with wood
//   herds     the pens emptied (settlement.livestockMarket, real head) into the
//             harrier's hands; the pens refill slowly (systems/livestock.js
//             reads settlement.harried.herds) and the town's herds yield less
//   scatter   the peasants driven off as refugees (real people, elsewhere)
//   slaughter the peasants killed (and named townsfolk with them)
//
// The realm answers. kingdom.harried { towns, stab, lords } each week: its
// stability falls (world/kingdomState.js 'Countryside harried') and, for the
// player's own realm, its lords' opinion (systems/kingship.js 'The countryside
// burns') — halved while the crown answers. Against the player it answers in
// the field: a pursuit host (a hostile war_host, paid for out of the treasury:
// the muster into the capital's purse, a chest in its bags) rides out of the
// nearest town after the harriers and follows them while they are in its land.
//
// No coin is made: what is carried off was in the town, what is burned is
// gone, the host's pay comes out of the crown's treasury and goes home with
// it. No shared RNG: AI rolls are hashes of the world seed; units are made on
// a seeded stream of their own. Pure: explicit params, no globals.
// State: world.harrying (saved by systems/saveLoad.js), each town's scar on
// settlement.harried (saved with the tile). Runs with player = null.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';
import { Harvests } from '../world/harvests.js';
import { Estates } from '../world/estates.js';
import { Seasons } from '../world/seasons.js';
import { CrownBooks } from '../world/crownBooks.js';
import { TownMemory } from './townMemory.js';
import { Townsfolk } from './townsfolk.js';
import { Livestock } from './livestock.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _key = (q, r) => `${q},${r}`;
const _r3 = (v) => Math.round(v * 1000) / 1000;
const _day = (world) => _num(world && world.day);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
export const ACTS = ['torch', 'fields', 'mill', 'herds', 'scatter', 'slaughter'];
const CROP_YIELDS = ['grain', 'veg', 'fibre', 'vine', 'fodder'];

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _roll(world, key) {
    let h = Utils.hashStr(`${_seed(world)}|harrying|${key}`) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
}

const DEFAULTS = {
    enabled: true,
    minStrength: 30,
    resist: { share: { village: 0.4, town: 0.25, city: 0.15, capital: 0.1 }, min: 5 },
    acts: {
        torch: { apCost: 3, damage: { village: 0.45, town: 0.22, city: 0.1, capital: 0.06 }, fireShare: { village: 0.6, town: 0.25, city: 0.1, capital: 0.06 }, deadRate: 0.03, homelessRate: 0.16, granary: 0.6, stores: 0.5, carry: 30, carryGoods: ['grain', 'bread', 'flour', 'meat'], rebuildDays: 180, woodPerWeek: 1.2 },
        fields: { apCost: 3, share: 0.35, nextShare: 0.5, fieldsDays: 90, barns: 0.6, granary: 0.4, soilLoss: 0.25, regrowDays: 240 },
        mill: { apCost: 2, days: { village: 60, town: 75, city: 90, capital: 100 }, woodNeed: { village: 6, town: 10, city: 16, capital: 20 }, flour: 0.8 },
        herds: { apCost: 2, share: 0.7, slow: 0.25, herdsDays: 150, stockLoss: 0.45 },
        scatter: { apCost: 2, share: 0.2, minPop: 40 },
        slaughter: { apCost: 3, share: 0.25, minPop: 30 },
    },
    cooldownDays: 60,
    realm: { perTown: 2.5, cap: 14, lordsPerTown: 3, lordsCap: 18, seatHarried: 10, answeredDays: 60 },
    pursuit: { minMilitary: 50, base: 20, share: 0.25, min: 25, max: 220, musterPerMan: 1, chestPerMan: 1.5, days: 30, leashHexes: 8, speed: 3, cooldownDays: 20 },
    ai: { chance: 0.12, cruel: 1.6, cruelTraits: [], rangeHexes: 10, minMilitary: 40, carryShare: 0.4, slaughterChance: 0.35, acts: ['torch', 'fields', 'herds', 'scatter'], logCap: 40 },
    lines: {},
};

let _cfg = null;
let _cfgSrc;

export const Harrying = {
    ACTS,
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.harrying : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const acts = {};
            for (const a of ACTS) acts[a] = { ...DEFAULTS.acts[a], ...(_obj((d.acts || {})[a]) || {}) };
            _cfg = {
                ...DEFAULTS, ...d, acts,
                resist: { ...DEFAULTS.resist, ...(_obj(d.resist) || {}) },
                realm: { ...DEFAULTS.realm, ...(_obj(d.realm) || {}) },
                pursuit: { ...DEFAULTS.pursuit, ...(_obj(d.pursuit) || {}) },
                ai: { ...DEFAULTS.ai, ...(_obj(d.ai) || {}) },
                lines: { ...(_obj(d.lines) || {}) },
            };
        }
        return _cfg;
    },

    enabled() { return Harrying.config().enabled !== false; },

    line(id, vars = {}) { return _fill(Harrying.config().lines[id] || '', vars); },

    // ── State ───────────────────────────────────────────

    _blank() {
        return { v: 1, towns: {}, hosts: [], realms: {}, burnt: [], log: [], stats: { player: 0, ai: 0, killed: 0, fled: 0, head: 0, hostsSent: 0, hostsBeaten: 0 } };
    },

    state(world) {
        if (!world) return null;
        if (!_obj(world.harrying)) world.harrying = Harrying._blank();
        const st = world.harrying;
        const b = Harrying._blank();
        for (const k of ['towns', 'realms']) if (!_obj(st[k])) st[k] = {};
        for (const k of ['hosts', 'burnt', 'log']) if (!Array.isArray(st[k])) st[k] = [];
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(world) {
        return world && _obj(world.harrying) ? JSON.parse(JSON.stringify(world.harrying)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.harrying = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : Harrying._blank();
        Harrying.state(world);
        Harrying._reckonRealms(world);
    },

    // ── A town's scar ──────────────────────────────────

    /** settlement.harried, created on demand. */
    scar(s) {
        if (!s) return null;
        if (!_obj(s.harried)) s.harried = { acts: {}, until: 0 };
        if (!_obj(s.harried.acts)) s.harried.acts = {};
        return s.harried;
    },

    /** Is the town still scarred by a harrying (anything not yet grown back or rebuilt)? */
    active(s, day) {
        const h = s && _obj(s.harried);
        return !!h && _num(h.until) > _num(day);
    },

    /** Days since `act` was done here, or null. */
    since(s, act, day) {
        const h = s && _obj(s.harried);
        const d = h && h.acts ? h.acts[act] : null;
        return Number.isFinite(d) ? _num(day) - d : null;
    },

    /** Why `act` cannot be done to the town now ('' when it can). */
    blocked(world, s, act) {
        const C = Harrying.config();
        const A = C.acts[act];
        if (!s || !A) return 'There is nothing to harry here.';
        const day = _day(world);
        const ago = Harrying.since(s, act, day);
        if (ago != null && ago < _num(C.cooldownDays, 60)) return `Already done here ${ago} day(s) ago: nothing left of it for ${_num(C.cooldownDays, 60) - ago} more.`;
        const pop = _num(s.population);
        if (act === 'mill') {
            if (!SettlementMarket.hasTrade(s, 'mill')) return `${s.name} grinds no corn of its own.`;
            const m = s.market;
            if (m && _obj(m.idle) && _num(m.idle.mill) > day) return 'Its mill stands idle already.';
        }
        if (act === 'herds') {
            const pens = Harrying.pens(world, s);
            if (!Object.values(pens).some(n => n >= 1)) return 'Its pens are empty.';
        }
        if ((act === 'scatter' || act === 'slaughter') && pop <= _num(A.minPop, 30)) return 'Hardly anyone is left in the fields.';
        return '';
    },

    /** Head in the town's pens now: { speciesId: n }. */
    pens(world, s) {
        const out = {};
        if (!s) return out;
        try {
            const { book } = Livestock._book(world, s);
            for (const [id, n] of Object.entries(book.stock || {})) if (_num(n) >= 1) out[id] = Math.floor(_num(n));
        } catch (e) { /* no livestock data */ }
        return out;
    },

    _touch(world, s, act, info = {}) {
        const st = Harrying.state(world);
        const h = Harrying.scar(s);
        const day = _day(world);
        h.acts[act] = day;
        h.d = day;
        if (info.by) h.by = info.by;
        h.byKid = info.kid != null ? info.kid : null;
        h.byPlayer = !!info.byPlayer;
        h.n = _num(h.n) + 1;
        Harrying._untilOf(s, day);
        st.towns[_key(s.q, s.r)] = { kid: s.kingdom != null ? s.kingdom : null, d: day, until: h.until, name: s.name };
        st.stats[info.byPlayer ? 'player' : 'ai'] = _num(st.stats[info.byPlayer ? 'player' : 'ai']) + 1;
        return h;
    },

    /** h.until: the last day anything of the harrying still shows (rebuilt, regrown, refilled). */
    _untilOf(s, day) {
        const h = s.harried;
        const C = Harrying.config();
        let u = 0;
        if (h.burn && h.burn.left > 0) u = Math.max(u, _num(h.burn.until, day + 30));
        if (h.fields) u = Math.max(u, _num(h.fields.until));
        if (h.herds) u = Math.max(u, _num(h.herds.until));
        if (h.mill) u = Math.max(u, _num(h.mill.until));
        // (the acts themselves are remembered for the cooldown)
        for (const d of Object.values(h.acts || {})) u = Math.max(u, _num(d) + _num(C.cooldownDays, 60));
        h.until = u;
        return u;
    },

    // ── The acts ───────────────────────────────────────

    /**
     * Burn the houses (a village) or the outlying farmsteads (a town and up).
     * opts: { by, kid, byPlayer, carry(goodId, n) → n taken, carryMax }.
     * → { dead, fled, homeless, carried: { good: n }, damage }
     */
    torch(world, s, opts = {}) {
        const A = Harrying.config().acts.torch;
        const day = _day(world);
        const type = s.type || 'village';
        const dmg = _num((A.damage || {})[type], 0.2);
        const fs = _num((A.fireShare || {})[type], 0.2);
        const scale = dmg / Math.max(0.01, _num((A.damage || {}).village, 0.45));
        // What the men carry off first (out of the market's stores: no goods from nowhere)
        const carried = {};
        let room = Math.max(0, _num(opts.carryMax, A.carry));
        if (typeof opts.carry === 'function') {
            for (const g of A.carryGoods || []) {
                if (room <= 0) break;
                const have = SettlementMarket.available(s, g);
                if (have < 1) continue;
                const took = SettlementMarket.take(s, g, Math.min(have, room));
                const kept = Math.max(0, Math.min(took, Math.floor(_num(opts.carry(g, Math.floor(took))))));
                if (took - kept > 0) SettlementMarket.add(s, g, took - kept); // (what will not go in the packs stays — and burns)
                if (kept > 0) { carried[g] = kept; room -= kept; }
            }
        }
        // The fire
        s.damage = _r3(Math.min(0.9, _num(s.damage) + dmg));
        const pop0 = Math.max(0, _num(s.population));
        const dead = Math.min(Math.max(0, pop0 - 10), Math.round(pop0 * _num(A.deadRate) * scale));
        s.population = Math.max(1, pop0 - dead);
        const homeless = Math.round(pop0 * _num(A.homelessRate) * scale);
        const fled = Harrying._flee(world, s, homeless);
        if (s.economy && Number.isFinite(s.economy.food)) s.economy.food = Math.floor(s.economy.food * (1 - _clamp(_num(A.granary), 0, 1)));
        try { SettlementMarket.loot(s, _clamp(_num(A.stores) * Math.max(0.3, scale), 0, 0.9)); } catch (e) { /* no market */ }
        s.happiness = _clamp(_num(s.happiness, 50) - 12 * Math.max(0.4, scale), 0, 100);
        // The scar: kept from repairing until it is rebuilt
        const h = Harrying._touch(world, s, 'torch', opts);
        const prev = _obj(h.burn) ? _num(h.burn.left) : 0;
        h.burn = { dmg: _r3(Math.min(0.9, prev + dmg)), left: _r3(Math.min(0.9, prev + dmg)), start: day, until: day + _num(A.rebuildDays, 180) };
        h.dead = _num(h.dead) + dead;
        h.fled = _num(h.fled) + fled;
        Harrying._untilOf(s, day);
        // The town remembers it, and its street map shows the burnt shells
        let m = null;
        try { m = TownMemory.mark(s, 'fire', { share: fs, cause: 'harrying', great: fs >= 0.35 }, world, { consequences: false }); } catch (e) { m = null; }
        if (m) {
            m.dead = dead;
            m.homeless = fled;
            if (opts.by) m.by = opts.by;
            try { TownMemory._folkStruck(world, s, m, fs, day, 'the harrying', 'fled the harrying'); } catch (e) { /* no roster */ }
        }
        Harrying._stat(world, dead, fled);
        return { dead, fled, homeless, carried, damage: dmg };
    },

    /**
     * Fire the crops. In spring and summer the standing crop (the harvest in
     * force and the next one reckoned); in autumn and winter the barns and ricks.
     * → { season, standing, share, grainBurnt, estates }
     */
    fields(world, s, opts = {}) {
        const A = Harrying.config().acts.fields;
        const day = _day(world);
        const season = Seasons.seasonOf(day);
        const standing = season === 'Spring' || season === 'Summer';
        const f = Harvests.ensureFarm(world, s);
        const share = _clamp(_num(A.share), 0, 0.95);
        if (f) {
            const y = { ...Harvests.townYield(s) };
            if (_obj(f.y) && f.y.salted) y.salted = 1;
            for (const c of CROP_YIELDS) y[c] = _r3(Math.max(0, _num(y[c], 1) * (1 - share)));
            f.y = y;
            if (!Number.isFinite(f.yr)) f.yr = Harvests.yearOf(day);
            const hs = world && _obj(world.harvests);
            if (hs) hs.ver = _num(hs.ver) + 1;
        }
        const h = Harrying._touch(world, s, 'fields', opts);
        let grainBurnt = 0;
        if (standing) {
            h.fields = { share: _clamp(_num(A.nextShare), 0, 0.95), until: day + _num(A.fieldsDays, 90), d: day };
        } else {
            for (const g of ['grain', 'flour']) {
                const n = SettlementMarket.stock(s, g) * _clamp(_num(A.barns), 0, 1);
                grainBurnt += SettlementMarket.take(s, g, n);
            }
            if (s.economy && Number.isFinite(s.economy.food)) s.economy.food = Math.floor(s.economy.food * (1 - _clamp(_num(A.granary), 0, 1)));
        }
        // The estates' fields scorched: their soil (and rents, and value) grow back
        const st = Harrying.state(world);
        let estates = 0;
        try {
            for (const e of Estates.estatesOf(world, s.q, s.r)) {
                const lost = _r3(Math.min(_num(e.soil, 1) - 0.3, _num(e.soil, 1) * _num(A.soilLoss)));
                if (!(lost > 0)) continue;
                e.soil = _r3(_num(e.soil, 1) - lost);
                st.burnt.push({ id: e.id, lost, left: lost, day });
                Estates.bumpTown(world, e.town);
                estates++;
            }
        } catch (e) { /* no estates */ }
        if (st.burnt.length > 400) st.burnt.splice(0, st.burnt.length - 400);
        Harrying._untilOf(s, day);
        s.happiness = _clamp(_num(s.happiness, 50) - 8, 0, 100);
        return { season, standing, share, grainBurnt: _r3(grainBurnt), estates };
    },

    /** Burn the mill: no flour ground until it is rebuilt. → { days, flourBurnt } */
    mill(world, s, opts = {}) {
        const A = Harrying.config().acts.mill;
        const day = _day(world);
        const type = s.type || 'village';
        const days = Math.round(_num((A.days || {})[type], 75));
        const m = SettlementMarket.ensure(s);
        if (m) {
            if (!_obj(m.idle)) m.idle = {};
            m.idle.mill = Math.max(_num(m.idle.mill), day + days);
        }
        const flourBurnt = SettlementMarket.take(s, 'flour', SettlementMarket.stock(s, 'flour') * _clamp(_num(A.flour), 0, 1));
        const h = Harrying._touch(world, s, 'mill', opts);
        h.mill = { until: day + days, wood: Math.round(_num((A.woodNeed || {})[type], 8)), paid: false };
        Harrying._untilOf(s, day);
        return { days, flourBurnt: _r3(flourBurnt) };
    },

    /**
     * Drive off the herds: share of every beast in the pens. opts.receive(taken)
     * is handed { speciesId: n } (the harrier does with them what it will).
     * → { taken, head }
     */
    herds(world, s, opts = {}) {
        const A = Harrying.config().acts.herds;
        const day = _day(world);
        const taken = {};
        let head = 0;
        try {
            const { book } = Livestock._book(world, s);
            for (const [id, n0] of Object.entries(book.stock || {})) {
                const n = Math.floor(_num(n0) * _clamp(_num(A.share), 0, 1));
                if (n < 1) continue;
                book.stock[id] = Math.round((_num(n0) - n) * 100) / 100;
                taken[id] = n;
                head += n;
            }
        } catch (e) { /* no livestock */ }
        const f = Harvests.ensureFarm(world, s);
        if (f) {
            const y = { ...Harvests.townYield(s) };
            if (_obj(f.y) && f.y.salted) y.salted = 1;
            y.stock = _r3(_num(y.stock, 1) * (1 - _clamp(_num(A.stockLoss), 0, 0.9)));
            f.y = y;
            if (!Number.isFinite(f.yr)) f.yr = Harvests.yearOf(day);
        }
        const h = Harrying._touch(world, s, 'herds', opts);
        h.herds = { until: day + _num(A.herdsDays, 150), slow: _clamp(_num(A.slow, 0.25), 0, 1) };
        Harrying._untilOf(s, day);
        Harrying.state(world).stats.head += head;
        if (typeof opts.receive === 'function' && head > 0) opts.receive(taken);
        return { taken, head };
    },

    /** Drive the peasants off: refugees to the realm's other towns. → { fled } */
    scatter(world, s, opts = {}) {
        const A = Harrying.config().acts.scatter;
        const pop = _num(s.population);
        const want = Math.min(Math.floor(pop * _clamp(_num(A.share), 0, 0.8)), Math.max(0, Math.floor(pop - _num(A.minPop, 40))));
        const fled = Harrying._flee(world, s, want);
        Harrying._folk(world, s, fled / Math.max(1, pop), 'exile');
        const h = Harrying._touch(world, s, 'scatter', opts);
        h.fled = _num(h.fled) + fled;
        s.happiness = _clamp(_num(s.happiness, 50) - 10, 0, 100);
        Harrying._stat(world, 0, fled);
        return { fled };
    },

    /** Put the peasants to the sword. → { killed } */
    slaughter(world, s, opts = {}) {
        const A = Harrying.config().acts.slaughter;
        const pop = _num(s.population);
        const killed = Math.max(0, Math.min(Math.floor(pop * _clamp(_num(A.share), 0, 0.8)), Math.floor(pop - _num(A.minPop, 30))));
        s.population = Math.max(1, pop - killed);
        Harrying._folk(world, s, killed / Math.max(1, pop), 'slay');
        const h = Harrying._touch(world, s, 'slaughter', opts);
        h.dead = _num(h.dead) + killed;
        s.happiness = _clamp(_num(s.happiness, 50) - 25, 0, 100);
        Harrying._stat(world, killed, 0);
        return { killed };
    },

    _stat(world, dead, fled) {
        const st = Harrying.state(world);
        st.stats.killed += dead;
        st.stats.fled += fled;
    },

    /** Named townsfolk killed or driven out, `share` of the roster (hash-picked). */
    _folk(world, s, share, how) {
        const folk = s && s.folk;
        if (!folk || !Array.isArray(folk.people) || !(share > 0)) return 0;
        const day = _day(world);
        const here = Townsfolk.residents(folk).sort((a, b) => _roll(world, `folk|${day}|${a.id}`) - _roll(world, `folk|${day}|${b.id}`));
        const n = Math.min(here.length, Math.round(here.length * share * 0.5));
        for (const p of here.slice(0, n)) {
            if (how === 'slay') Townsfolk.slay(folk, p, day, 'the harrying', world);
            else Townsfolk.exile(folk, p, day, 'fled the harrying', world);
        }
        return n;
    },

    /**
     * `n` people of the town flee to the nearest towns of its realm (any towns
     * for a free one): real people moved with their trades (TownLabour.moveMix),
     * remembered as refugees so they go home when it is safe (systems/labour.js).
     * Those with nowhere to go stay. → moved.
     */
    _flee(world, s, n) {
        if (!(n >= 1) || !world || typeof world.getSettlementViews !== 'function') return 0;
        const day = _day(world);
        const views = world.getSettlementViews();
        const same = (t) => (s.kingdom != null ? t.kingdom === s.kingdom : true);
        const cands = views.filter(t => t !== s && same(t) && !Harrying.active(t, day) && _num(t.population) > 0)
            .map(t => ({ t, d: Hex.wrappingDistance(s.q, s.r, t.q, t.r, world.width) }))
            .filter(x => x.d <= 14)
            .sort((a, b) => a.d - b.d)
            .slice(0, 3);
        if (!cands.length) return 0;
        const wts = cands.map(x => Math.sqrt(Math.max(1, _num(x.t.population))) / Math.max(1, x.d));
        const wsum = wts.reduce((a, b) => a + b, 0);
        let moved = 0;
        const fk = _key(s.q, s.r);
        cands.forEach((x, i) => {
            const want = i === cands.length - 1 ? n - moved : Math.floor(n * wts[i] / wsum);
            const got = TownLabour.moveMix(s, x.t, want, 10);
            if (!(got > 0)) return;
            moved += got;
            const lt = x.t.labour;
            if (lt) {
                lt.refugees = _num(lt.refugees) + got;
                lt.from = _obj(lt.from) || {};
                lt.from[fk] = _num(lt.from[fk]) + got;
            }
        });
        return moved;
    },

    // ── The realm answers ──────────────────────────────

    _realm(st, kid) {
        const k = String(kid);
        if (!_obj(st.realms[k])) st.realms[k] = { harried: 0, byPlayer: 0, lastHarried: null, lastHost: null, answeredDay: null, lost: 0, by: {} };
        return st.realms[k];
    },

    /**
     * The player has harried a town of a realm: its grudge grows, and (if its
     * crown can pay) a host rides out after them. → the host record, or null.
     */
    provoke(world, player, s) {
        if (!world || !s || s.kingdom == null) return null;
        const st = Harrying.state(world);
        const P = Harrying.config().pursuit;
        const day = _day(world);
        const r = Harrying._realm(st, s.kingdom);
        r.harried++;
        r.lastHarried = day;
        if (player) r.byPlayer++;
        if (!player || st.hosts.some(h => String(h.kid) === String(s.kingdom))) return null;
        if (r.lastHost != null && day - _num(r.lastHost) < _num(P.cooldownDays, 20)) return null;
        const k = typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
        if (!k || k.isAlive === false || _num(k.military) < _num(P.minMilitary, 50)) return null;
        return Harrying._dispatch(world, player, k, s, r);
    },

    _dispatch(world, player, k, s, r) {
        const P = Harrying.config().pursuit;
        const st = Harrying.state(world);
        const day = _day(world);
        const strength = Math.min(Math.floor(_num(k.military)), Utils.clamp(Math.round(_num(P.base) + _num(k.military) * _num(P.share)), _num(P.min, 25), _num(P.max, 220)));
        if (strength < _num(P.min, 25)) return null;
        // Its muster, paid to the captains in the capital; its chest, carried
        const muster = Math.round(strength * _num(P.musterPerMan, 1));
        if (_num(k.treasury) < muster) return null;
        if (CrownBooks.spendAtCapital(world, k, muster) > 0) {
            k.treasury = _num(k.treasury) - muster;
            CrownBooks.note(k, 'army', muster);
        }
        const chest = Math.min(Math.max(0, Math.floor(_num(k.treasury))), Math.round(strength * _num(P.chestPerMan, 1.5)));
        k.treasury = _num(k.treasury) - chest;
        k.military = Math.max(0, _num(k.military) - strength);
        // Out of the realm's town nearest the harriers (not the burning one, if it has another)
        const towns = (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : []).filter(t => t.kingdom === k.id);
        const pq = Number.isFinite(player.q) ? player.q : s.q, pr = Number.isFinite(player.r) ? player.r : s.r;
        const from = towns.filter(t => t !== s).sort((a, b) => Hex.wrappingDistance(a.q, a.r, pq, pr, world.width) - Hex.wrappingDistance(b.q, b.r, pq, pr, world.width))[0] || s;
        const rec = {
            id: `hp_${k.id}_${day}`, kid: k.id, name: `The Host of ${k.name}`, q: from.q, r: from.r, from: from.name,
            strength, chest, start: day, until: day + _num(P.days, 30), tq: pq, tr: pr,
        };
        st.hosts.push(rec);
        st.stats.hostsSent++;
        r.lastHost = day;
        Harrying._spawn(world, k, rec);
        return rec;
    },

    _spawn(world, k, rec) {
        if (!Array.isArray(world.units)) world.units = [];
        const P = Harrying.config().pursuit;
        const rng = Utils.seededRandom((Utils.hashStr(`${_seed(world)}|harryHost|${rec.id}`) >>> 0) || 1);
        const unit = Utils.withRng(rng, () => new WorldUnit('war_host', rec.q, rec.r, rec.tq, rec.tr));
        unit.id = rec.id;
        unit.icon = '🚩';
        unit.name = rec.name;
        unit.speed = _num(P.speed, 3);
        unit.strength = Math.max(1, Math.round(rec.strength));
        unit.population = rec.strength * 2;
        unit.kingdomId = k.id;
        unit.objectiveQ = rec.tq;
        unit.objectiveR = rec.tr;
        unit.maxAge = 1e6;
        unit.hostile = true;
        unit.harryPursuit = true;
        // (its chest, out of the treasury; it lives off the land it rides through, so it carries no stores to take)
        unit.inventory = { gold: Math.max(0, Math.floor(_num(rec.chest))) };
        world.units.push(unit);
        return unit;
    },

    _unitOf(world, rec) {
        return (world.units || []).find(u => u && u.id === rec.id) || null;
    },

    /** The player broke a pursuit host (PlayerMilitary.attackUnit): the crown answered, and lost. */
    onHostDefeated(player, world, unit) {
        const st = Harrying.state(world);
        const rec = st.hosts.find(h => h.id === unit.id);
        if (!rec) return null;
        st.hosts = st.hosts.filter(h => h !== rec);
        st.stats.hostsBeaten++;
        const r = Harrying._realm(st, rec.kid);
        r.answeredDay = _day(world);
        r.lost++;
        // (what the victor left of its chest goes home with the survivors)
        const k = typeof world.getKingdom === 'function' ? world.getKingdom(rec.kid) : null;
        if (k && k.isAlive !== false && unit.inventory) {
            const coin = Math.max(0, _num(unit.inventory.gold));
            unit.inventory.gold = 0;
            k.treasury = Math.round((_num(k.treasury) + coin) * 100) / 100;
            k.military = _num(k.military) + Math.round(rec.strength * 0.15);
        }
        return rec;
    },

    /** A host comes home: its men back to the realm's strength, its chest to the treasury. */
    _home(world, rec, unit, share = 1) {
        const k = typeof world.getKingdom === 'function' ? world.getKingdom(rec.kid) : null;
        if (unit) {
            if (k && k.isAlive !== false && unit.inventory) {
                const coin = Math.max(0, _num(unit.inventory.gold));
                unit.inventory.gold = 0;
                k.treasury = Math.round((_num(k.treasury) + coin) * 100) / 100;
            }
            unit.destroyed = true;
        }
        if (k && k.isAlive !== false) k.military = _num(k.military) + Math.round(_num(unit ? unit.strength : rec.strength) * share);
    },

    _hostsDay(world, player, st, day, out) {
        const P = Harrying.config().pursuit;
        for (const rec of st.hosts.slice()) {
            const unit = Harrying._unitOf(world, rec);
            if (!unit) {
                // Gone from the map (cut down by others, or an old save): its men drift home
                st.hosts = st.hosts.filter(h => h !== rec);
                Harrying._home(world, rec, null, 0.5);
                continue;
            }
            if (unit.destroyed) {
                // Broken in the field by the player (the crown answered, and lost), or by someone else
                if (unit.slainByPlayer && player) Harrying.onHostDefeated(player, world, unit);
                else st.hosts = st.hosts.filter(h => h !== rec);
                continue;
            }
            rec.q = unit.q; rec.r = unit.r;
            rec.strength = Math.max(1, _num(unit.strength, rec.strength));
            // On the harriers' heels while they are in (or near) its land, for its days
            const near = player && Number.isFinite(player.q) && !player.boardedShip ? Harrying._nearRealm(world, rec.kid, player.q, player.r, _num(P.leashHexes, 8)) : false;
            if (day <= _num(rec.until) && near) {
                rec.tq = player.q; rec.tr = player.r;
                unit.objectiveQ = player.q; unit.objectiveR = player.r;
                Harrying._realm(st, rec.kid).answeredDay = day;
                continue;
            }
            st.hosts = st.hosts.filter(h => h !== rec);
            Harrying._home(world, rec, unit, 1);
            if (player) out.notices.push({ icon: '🚩', title: 'The Chase Is Off', text: Harrying.line('pursuitHome', { host: rec.name }), type: 'info' });
        }
    },

    /** Is (q, r) within `hexes` of a town of the realm? */
    _nearRealm(world, kid, q, r, hexes) {
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const t of views) {
            if (t.kingdom !== kid) continue;
            if (Math.abs(t.r - r) > hexes) continue;
            if (Hex.wrappingDistance(t.q, t.r, q, r, world.width) <= hexes) return true;
        }
        return false;
    },

    /** Each realm's harried countryside → kingdom.harried { towns, stab, lords, answered }. */
    _reckonRealms(world) {
        if (!world || !Array.isArray(world.kingdoms)) return;
        const st = Harrying.state(world);
        const R = Harrying.config().realm;
        const day = _day(world);
        const count = {};
        for (const [key, t] of Object.entries(st.towns)) {
            if (_num(t.until) <= day) continue;
            const [q, r] = key.split(',').map(Number);
            const s = typeof world.getTile === 'function' ? (world.getTile(q, r) || {}).settlement : null;
            if (!s || !Harrying.active(s, day) || s.kingdom == null) continue;
            // (only the hurt that still shows: rebuilt, regrown and refilled towns do not count)
            const h = s.harried;
            if (!((h.burn && h.burn.left > 0) || h.fields || h.herds || h.mill || (day - _num(h.d) < _num(R.answeredDays, 60)))) continue;
            count[s.kingdom] = (count[s.kingdom] || 0) + 1;
        }
        for (const k of world.kingdoms) {
            if (!k) continue;
            const n = count[k.id] || 0;
            if (!n) { if (k.harried) delete k.harried; continue; }
            const rec = st.realms[String(k.id)];
            const answered = !!(st.hosts.some(h => String(h.kid) === String(k.id))
                || (rec && rec.answeredDay != null && day - _num(rec.answeredDay) <= _num(R.answeredDays, 60)));
            const half = answered ? 0.5 : 1;
            k.harried = {
                towns: n,
                stab: -Math.round(Math.min(_num(R.cap, 14), n * _num(R.perTown, 2.5)) * half * 10) / 10,
                lords: Math.round(Math.min(_num(R.lordsCap, 18), n * _num(R.lordsPerTown, 3)) * half * 10) / 10,
                answered,
            };
        }
    },

    /** Is a vassal's seat (q, r) harried and not yet mended? The lord's own grudge (systems/kingship.js). */
    seatPenalty(world, q, r) {
        const s = world && typeof world.getTile === 'function' ? (world.getTile(q, r) || {}).settlement : null;
        return s && Harrying.active(s, _day(world)) && (_obj(s.harried.burn) || s.harried.fields || s.harried.herds || s.harried.mill)
            ? _num(Harrying.config().realm.seatHarried, 10) : 0;
    },

    // ── Recovery ───────────────────────────────────────

    _mendWeek(world, st, day) {
        const A = Harrying.config().acts;
        for (const [key, t] of Object.entries(st.towns)) {
            const [q, r] = key.split(',').map(Number);
            const s = typeof world.getTile === 'function' ? (world.getTile(q, r) || {}).settlement : null;
            if (!s || !_obj(s.harried)) { delete st.towns[key]; continue; }
            const h = s.harried;
            // Rebuilding: a week's share of the burning, as far as the town's wood goes
            if (_obj(h.burn) && h.burn.left > 0) {
                const step = _num(h.burn.dmg) * 7 / Math.max(7, _num(A.torch.rebuildDays, 180));
                const need = _num(A.torch.woodPerWeek, 1.2) * Math.max(0, _num(s.population)) / 100;
                let frac = 1;
                if (need > 0 && SettlementMarket.tracks('wood')) frac = SettlementMarket.take(s, 'wood', need) / need;
                h.burn.left = _r3(Math.max(0, _num(h.burn.left) - step * frac));
                if (frac < 1) h.burn.until = Math.max(_num(h.burn.until), day + 7);
                // (the burnt houses hold the town's repair back: what is not rebuilt is still ruin)
                s.damage = _r3(Math.min(0.9, Math.max(_num(s.damage), h.burn.left)));
                if (!(h.burn.left > 0)) delete h.burn;
            }
            if (h.fields && (_num(h.fields.until) <= day || h.fields.applied)) delete h.fields;
            if (h.herds && _num(h.herds.until) <= day) delete h.herds;
            if (h.mill) {
                const m = SettlementMarket.ensure(s);
                if (!h.mill.paid && day >= _num(h.mill.until) - 7) {
                    // The millwrights want timber: from the town's market, or the mill waits
                    const need = _num(h.mill.wood, 8);
                    if (!SettlementMarket.tracks('wood') || SettlementMarket.available(s, 'wood') >= need) {
                        if (SettlementMarket.tracks('wood')) SettlementMarket.take(s, 'wood', need);
                        h.mill.paid = true;
                    } else {
                        h.mill.until = day + 8;
                    }
                }
                if (m) {
                    if (!_obj(m.idle)) m.idle = {};
                    if (_num(h.mill.until) > day) m.idle.mill = Math.max(_num(m.idle.mill), _num(h.mill.until));
                }
                if (_num(h.mill.until) <= day && h.mill.paid) delete h.mill;
            }
            Harrying._untilOf(s, day);
            if (_num(h.until) <= day) {
                delete s.harried;
                delete st.towns[key];
            } else {
                t.until = h.until;
                t.kid = s.kingdom != null ? s.kingdom : null;
            }
        }
        // The scorched estates grow back
        st.burnt = st.burnt.filter(b => {
            let e = null;
            try { e = Estates.estate(world, b.id); } catch (err) { e = null; }
            if (!e) return false;
            const add = Math.min(_num(b.left), _num(b.lost) * 7 / Math.max(7, _num(A.fields.regrowDays, 240)));
            if (add > 0) {
                e.soil = _r3(_num(e.soil, 1) + add);
                b.left = Math.round((_num(b.left) - add) * 10000) / 10000;
                try { Estates.bumpTown(world, e.town); } catch (err) { /* no estates */ }
            }
            return b.left > 0.0005;
        });
    },

    // ── The realms harry each other ────────────────────

    _cruel(k) {
        const set = new Set(Harrying.config().ai.cruelTraits || []);
        const t = k && k.lord && Array.isArray(k.lord.traits) ? k.lord.traits : [];
        return t.some(x => x && set.has(typeof x === 'string' ? x : x.id));
    },

    _aiWeek(world, player, st, day, out, ownKid = null) {
        const A = Harrying.config().ai;
        if (!Array.isArray(world.kingdoms) || typeof world.getSettlementViews !== 'function') return;
        const week = Math.floor(day / 7);
        let views = null;
        const byK = new Map();
        const towns = (kid) => {
            if (!views) {
                views = world.getSettlementViews();
                for (const s of views) {
                    if (s.kingdom == null) continue;
                    if (!byK.has(s.kingdom)) byK.set(s.kingdom, []);
                    byK.get(s.kingdom).push(s);
                }
            }
            return byK.get(kid) || [];
        };
        for (const k of world.kingdoms) {
            if (!k || k.isAlive === false || !Array.isArray(k.wars) || !k.wars.length) continue;
            if (ownKid != null && k.id === ownKid) continue; // (the player's own realm harries at the player's word)
            if (_num(k.military) < _num(A.minMilitary, 40)) continue;
            for (const eid of k.wars) {
                const e = typeof world.getKingdom === 'function' ? world.getKingdom(eid) : null;
                if (!e || e.isAlive === false || e === k) continue;
                const chance = _num(A.chance, 0.12) * (Harrying._cruel(k) ? _num(A.cruel, 1.6) : 1);
                if (_roll(world, `ai|${k.id}|${eid}|${week}`) >= chance) continue;
                const own = towns(k.id);
                if (!own.length) continue;
                let best = null;
                for (const s of towns(eid)) {
                    if ((s.type !== 'village' && s.type !== 'town') || _num(s.population) < 60 || Harrying.active(s, day)) continue;
                    if (s.holding || (s.colony && s.colony.isPlayerColony)) continue;
                    for (const o of own) {
                        if (Math.abs(o.r - s.r) > _num(A.rangeHexes, 10)) continue;
                        const d = Hex.wrappingDistance(o.q, o.r, s.q, s.r, world.width);
                        if (d <= _num(A.rangeHexes, 10) && (!best || d < best.d)) best = { s, o, d };
                    }
                }
                if (best) Harrying._aiHarry(world, player, st, k, e, best.s, best.o, day, out, ownKid);
            }
        }
    },

    _aiHarry(world, player, st, k, e, s, home, day, out, ownKid = null) {
        const A = Harrying.config().ai;
        const opts = { by: k.name, kid: k.id, byPlayer: false };
        let fled = 0;
        const acts = Array.isArray(A.acts) ? A.acts : DEFAULTS.ai.acts;
        for (const act of acts) {
            if (Harrying.blocked(world, s, act)) continue;
            if (act === 'torch') {
                const T = Harrying.config().acts.torch;
                fled += Harrying.torch(world, s, { ...opts, carryMax: _num(T.carry, 30) * 2, carry: (g, n) => SettlementMarket.add(home, g, Math.floor(n * _num(A.carryShare, 0.4)) || 0) }).fled;
            } else if (act === 'fields') Harrying.fields(world, s, opts);
            else if (act === 'herds') {
                // Driven to the riders' own town's pens
                Harrying.herds(world, s, {
                    ...opts, receive: (taken) => {
                        try {
                            const { book } = Livestock._book(world, home);
                            for (const [id, n] of Object.entries(taken)) book.stock[id] = Math.round((_num(book.stock[id]) + n) * 100) / 100;
                        } catch (err) { /* no pens */ }
                    },
                });
            } else if (act === 'scatter') {
                if (Harrying._cruel(k) && _roll(world, `slaughter|${k.id}|${s.q},${s.r}|${day}`) < _num(A.slaughterChance, 0.35)) Harrying.slaughter(world, s, opts);
                else fled += Harrying.scatter(world, s, opts).fled;
            }
        }
        const r = Harrying._realm(st, e.id);
        r.harried++;
        r.lastHarried = day;
        r.by[String(k.id)] = _num(r.by[String(k.id)]) + 1;
        // The harried crown rides out after them when it has the men: a skirmish in the fields, both sides bloodied
        if (_num(e.military) >= _num(k.military) * 0.6 && _roll(world, `answer|${e.id}|${s.q},${s.r}|${day}`) < 0.5) {
            r.answeredDay = day;
            const loss = Math.round(Math.min(_num(e.military), _num(k.military)) * 0.03);
            e.military = Math.max(0, _num(e.military) - loss);
            k.military = Math.max(0, _num(k.military) - loss);
        }
        const text = Harrying.line('aiHarry', { realm: k.name, town: s.name, victim: e.name, fled });
        st.log.push({ day, by: k.id, byName: k.name, victim: e.id, victimName: e.name, town: s.name, q: s.q, r: s.r, fled });
        while (st.log.length > _num(A.logCap, 40)) st.log.shift();
        if (Array.isArray(world.events)) world.events.push({ text: `🔥 ${text}`, type: 'military', category: 'MILITARY' });
        if (player) {
            const mine = (player.allegiance != null && player.allegiance === e.id) || (ownKid != null && ownKid === e.id);
            const near = Number.isFinite(player.q) && Hex.wrappingDistance(player.q, player.r, s.q, s.r, world.width) <= 6;
            if (mine) out.notices.push({ icon: '🔥', title: 'The Countryside Burns', text: Harrying.line('aiHarryYours', { realm: k.name, town: s.name, fled }), type: 'warning' });
            else if (near) out.notices.push({ icon: '🔥', title: 'Riders Harry the Land', text, type: 'info' });
        }
    },

    // ── The days ───────────────────────────────────────

    /**
     * One day: the pursuit hosts follow the harriers (daily); weekly the burnt
     * towns rebuild, the fields regrow, the realms reckon their harried land
     * and the realms at war harry each other. ownKid: the realm the player
     * rules (its riders wait on the player's word). → { notices }
     */
    processDay(world, player = null, ownKid = null) {
        const out = { notices: [] };
        if (!world || !Harrying.enabled()) return out;
        const st = Harrying.state(world);
        const day = _day(world);
        if (st.hosts.length) Harrying._hostsDay(world, player, st, day, out);
        if (day > 0 && day % 7 === 3) {
            Harrying._mendWeek(world, st, day);
            Harrying._aiWeek(world, player, st, day, out, ownKid);
            Harrying._reckonRealms(world);
        }
        return out;
    },

    /** What the realm's harried countryside looks like: [{ q, r, name, kid, burnt, fields, herds, mill, until }] (the map, panels). */
    scars(world) {
        const st = world && _obj(world.harrying);
        if (!st) return [];
        const day = _day(world);
        const out = [];
        for (const [key, t] of Object.entries(st.towns || {})) {
            if (_num(t.until) <= day) continue;
            const [q, r] = key.split(',').map(Number);
            const s = typeof world.getTile === 'function' ? (world.getTile(q, r) || {}).settlement : null;
            const h = s && _obj(s.harried);
            if (!h) continue;
            out.push({ q, r, name: s.name, kid: s.kingdom, burnt: _obj(h.burn) ? _num(h.burn.left) : 0, fields: !!h.fields, herds: !!h.herds, mill: !!h.mill, d: _num(h.d), until: _num(h.until) });
        }
        return out;
    },
};
