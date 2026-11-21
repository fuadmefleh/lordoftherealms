// ============================================
// FALCONRY — flying your hawk at quarry (the rules)
// ============================================
// Your hawk (systems/animalCompanions.js, species 'hawk') rides your gloved
// fist on the street map; ui/innerMapHawk.js flies it, visibly, at a small
// wild beast or bird of the map (world/innerMap/animals.js). This holds the
// rules, with no drawing and no map in them:
//
//   hawkOf(player)                      the hawk on your fist: the first travelling hawk that walks with you
//   quarry(species)                     its quarry entry (data/falconry.json quarry) or null
//   canFly(world, player, hawk, beast, dist, o)   → { ok, reason }
//   chance(world, player, hawk, beast, dist, o)   → the chance of a kill, 0..1
//   rakeChance(world, hawk)             → the chance it goes off on its own instead
//   launch(world, player, hawk, beast, dist, o)   → { outcome: 'kill'|'miss'|'rake', p, rake }
//   bound(world, hawk)                  it bound to the quarry: a kill to its name (training)
//   reward / feedUp / rakeAway / lure / leftRaked  what follows
//
// Every roll is a hash of the world seed, the day, the hawk and the beast and
// how many flights it has had (no shared RNG stream drawn: the same seed, the
// same flights, the same outcomes). The hawk's record of its own:
//   hawk.hawking = { flights, kills }            its career (training)
//   hawk.hawked  = { day, flights, kills, fed }  flown today, read and cleared by
//                  AnimalCompanions.processDay (its own hunting cut that day) and
//                  huntQtyBonus (no share in the hunt's small game that day)
//   hawk.raked   = { day, tries }                 gone off to a tree, to be lured down
// No coin moves here: the meat for a lure comes out of your packs into the
// hawk's belly; a kill is a real carcass on the map, yours to carry or butcher.
//
// No globals: world and player come in as parameters.

import { DataLoader } from '../core/dataLoader.js';
import { AnimalCompanions } from './animalCompanions.js';
import { StreetFollowers } from './streetFollowers.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day, 0);

function _hash(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return h >>> 0;
}
const _frac = (...parts) => _hash(parts.join('|')) / 4294967296;
const _seed = (world) => {
    const g = world && world.generationParams;
    return g && g.seed != null ? g.seed : 'world';
};
const _fmt = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? m : String(v[k])));

const FALLBACK = {
    range: 12, minRange: 1, freeTiles: 5, perTile: 0.025, trainWeight: 0.3, killsToMaster: 25, perHuntRank: 0.025,
    minChance: 0.05, maxChance: 0.9, satedAbove: 88, satedMult: 0.6, minHealth: 25, maxFlightsPerDay: 8,
    words: {}, quarry: {}, breeds: {}, weather: {},
    rake: { base: 0.03, untrained: 0.22, hungry: 0.18, hungryBelow: 22, young: 0.1, steadied: 0.6, bondLoss: 4 },
    lure: { base: 0.45, perBond: 0.4, hungry: 0.2, leftBond: 6 },
    reward: { hunger: 18, bond: 2 }, feedUp: { hunger: 45, seconds: 45 },
    daily: { fedForage: 0, flownForage: 0.5 }, flight: {}, lines: {},
};

export const Falconry = {
    config() {
        const d = (DataLoader.get && DataLoader.get('falconry')) || {};
        const out = { ...FALLBACK, ...d };
        for (const k of ['rake', 'lure', 'reward', 'feedUp', 'daily']) out[k] = { ...FALLBACK[k], ...(_obj(d[k]) || {}) };
        return out;
    },

    line(key, vars = {}) {
        return _fmt((Falconry.config().lines || {})[key] || '', vars);
    },

    /** "Hawk" or "Falcon": what to call it in a menu. */
    word(hawk) {
        const w = Falconry.config().words || {};
        return (hawk && w[hawk.breed]) || 'Hawk';
    },

    /** The hawk on your fist: the first hawk travelling and walking with you, or null. */
    hawkOf(player) {
        const st = player && _obj(player.animalCompanions);
        const list = st && Array.isArray(st.list) ? st.list : [];
        return list.find(a => a && a.species === 'hawk' && !a.keptAt
            && StreetFollowers.walks(player, StreetFollowers.animalKey(a.id))) || null;
    },

    /** Its career: { flights, kills } (created). */
    record(hawk) {
        if (!_obj(hawk.hawking)) hawk.hawking = { flights: 0, kills: 0 };
        return hawk.hawking;
    },

    /** The quarry entry for a species, or null (not a hawk's quarry). */
    quarry(species) {
        return _obj((Falconry.config().quarry || {})[species]);
    },

    /** Training 0..1: its bond and the kills it has made. */
    training(hawk) {
        const cfg = Falconry.config();
        const kills = _num(hawk && hawk.hawking && hawk.hawking.kills);
        return _clamp(0.6 * _clamp(_num(hawk && hawk.bond, 40), 0, 100) / 100 + 0.4 * Math.min(1, kills / Math.max(1, cfg.killsToMaster)), 0, 1);
    },

    /** Flights it has had today. */
    flightsToday(world, hawk) {
        const h = hawk && _obj(hawk.hawked);
        return h && h.day === _day(world) ? _num(h.flights) : 0;
    },

    /**
     * Can it be flown at this beast now? o.onFist (the map has it on the glove), o.why (a map reason
     * of the caller's, e.g. your hands are full). → { ok, reason }
     */
    canFly(world, player, hawk, beast, dist, o = {}) {
        const cfg = Falconry.config();
        if (!hawk) return { ok: false, reason: 'You have no hawk with you' };
        if (hawk.raked) return { ok: false, reason: `${hawk.name} is off in a tree` };
        if (o.onFist === false) return { ok: false, reason: `${hawk.name} is not on your fist` };
        if (o.why) return { ok: false, reason: o.why };
        if (!beast || beast.state === 'dead') return { ok: false, reason: 'Nothing there to fly at' };
        const q = Falconry.quarry(beast.species);
        if (!q) return { ok: false, reason: `Too big for ${hawk.name}` };
        if (beast.livestock || beast.ownedBy || beast.owner) return { ok: false, reason: 'Someone\'s beast, not quarry' };
        if (beast.hunted) return { ok: false, reason: 'You are already after it' };
        if (!(dist <= cfg.range)) return { ok: false, reason: `Too far — come within ${cfg.range} paces` };
        if (dist < cfg.minRange) return { ok: false, reason: 'Too close' };
        if (_num(hawk.health, 100) < cfg.minHealth) return { ok: false, reason: `${hawk.name} is too poorly to fly` };
        if (Falconry.flightsToday(world, hawk) >= cfg.maxFlightsPerDay) return { ok: false, reason: `${hawk.name} has flown enough for one day` };
        return { ok: true };
    },

    /** The weather's toll on a flight (o.weather: today's weather type out in the open; o.sheltered: none). */
    weatherMult(type, o = {}) {
        if (o.sheltered || !type) return 1;
        return _num((Falconry.config().weather || {})[type], 1);
    },

    /** The chance of a kill, 0..1. o: { weather, huntRank, sheltered } */
    chance(world, player, hawk, beast, dist, o = {}) {
        const cfg = Falconry.config();
        const q = Falconry.quarry(beast && beast.species);
        if (!hawk || !q) return 0;
        let p = _num(q.base, 0.3) + Falconry.training(hawk) * cfg.trainWeight + _clamp(_num(o.huntRank), 0, 4) * cfg.perHuntRank
            - Math.max(0, _num(dist) - cfg.freeTiles) * cfg.perTile;
        const bm = _obj((cfg.breeds || {})[hawk.breed]);
        p *= bm ? _num(bm[q.class], 1) : 1;
        p *= Falconry.weatherMult(o.weather, o);
        p *= Math.min(1, AnimalCompanions.fitness(hawk, world) / 0.75);
        if (_num(hawk.hunger, 80) > cfg.satedAbove) p *= cfg.satedMult;
        return _clamp(p, cfg.minChance, cfg.maxChance);
    },

    /** The chance it rakes away at the launch: hungry, untrained, young. */
    rakeChance(world, hawk) {
        const R = Falconry.config().rake;
        const cfg = Falconry.config();
        const tr = Falconry.training(hawk);
        let p = R.base + R.untrained * (1 - tr);
        if (_num(hawk.hunger, 80) < R.hungryBelow) p += R.hungry;
        if (world && AnimalCompanions.isYoung(hawk, world)) p += R.young;
        const kills = _num(hawk.hawking && hawk.hawking.kills);
        p *= 1 - Math.min(1, kills / Math.max(1, cfg.killsToMaster)) * R.steadied;
        return _clamp(p, 0, 0.9);
    },

    /**
     * Cast it off at the beast: counted as a flight today and in its career, and the outcome
     * decided (by hash). → { outcome: 'kill'|'miss'|'rake', p, rake }
     */
    launch(world, player, hawk, beast, dist, o = {}) {
        const rec = Falconry.record(hawk);
        const day = _day(world);
        const p = Falconry.chance(world, player, hawk, beast, dist, o);
        const rake = Falconry.rakeChance(world, hawk);
        const n = rec.flights;
        const key = [_seed(world), day, hawk.id, beast && beast.id, n];
        rec.flights += 1;
        const h = _obj(hawk.hawked) && hawk.hawked.day === day ? hawk.hawked : (hawk.hawked = { day, flights: 0, kills: 0, fed: false });
        h.flights += 1;
        let outcome;
        if (_frac('hawk-rake', ...key) < rake) outcome = 'rake';
        else outcome = _frac('hawk-bind', ...key) < p ? 'kill' : 'miss';
        if (outcome === 'rake') Falconry.rakeAway(world, hawk);
        return { outcome, p, rake };
    },

    /** It bound to its quarry (the kill made on the map): one more to its name. */
    bound(world, hawk) {
        const rec = Falconry.record(hawk);
        rec.kills += 1;
        const day = _day(world);
        if (!_obj(hawk.hawked) || hawk.hawked.day !== day) hawk.hawked = { day, flights: 0, kills: 0, fed: false };
        hawk.hawked.kills += 1;
    },

    /** You took the kill from it: its reward off the kill (the head and neck). */
    reward(world, hawk) {
        const R = Falconry.config().reward;
        hawk.hunger = _clamp(_num(hawk.hunger, 80) + R.hunger, 0, 100);
        hawk.bond = _clamp(_num(hawk.bond, 40) + R.bond, 0, 100);
        Falconry._fed(world, hawk);
        return { hunger: R.hunger, bond: R.bond };
    },

    /** Left on its kill, it eats its fill (the kill is then eaten). */
    feedUp(world, hawk) {
        const F = Falconry.config().feedUp;
        hawk.hunger = _clamp(_num(hawk.hunger, 80) + F.hunger, 0, 100);
        Falconry._fed(world, hawk);
        return { hunger: F.hunger };
    },

    _fed(world, hawk) {
        const day = _day(world);
        if (!_obj(hawk.hawked) || hawk.hawked.day !== day) hawk.hawked = { day, flights: 0, kills: 0, fed: false };
        hawk.hawked.fed = true;
    },

    /** It went off on its own to a tree: a little less yours. */
    rakeAway(world, hawk) {
        hawk.raked = { day: _day(world), tries: 0 };
        hawk.bond = _clamp(_num(hawk.bond, 40) - Falconry.config().rake.bondLoss, 0, 100);
    },

    /** The chance it comes down to the lure now. */
    lureChance(world, hawk) {
        const L = Falconry.config().lure;
        let p = L.base + L.perBond * _clamp(_num(hawk.bond, 40), 0, 100) / 100;
        if (_num(hawk.hunger, 80) < 50) p += L.hungry;
        return _clamp(p, 0.05, 0.97);
    },

    /**
     * Hold up meat from your packs to lure it down (foodId, or the first it eats). The meat is
     * only taken when it comes (into its belly). → { success, came, food, text } | { success: false, reason }
     */
    lure(world, player, hawk, foodId = null) {
        if (!hawk || !hawk.raked) return { success: false, reason: 'It is not off anywhere.' };
        const foods = AnimalCompanions.foodsFor(player, hawk);
        const f = foodId ? foods.find(x => x.id === foodId) : foods[0];
        if (!f) return { success: false, reason: `You have nothing in your packs to lure ${hawk.name} with.` };
        const p = Falconry.lureChance(world, hawk);
        const tries = _num(hawk.raked.tries);
        hawk.raked.tries = tries + 1;
        if (_frac('hawk-lure', _seed(world), _day(world), hawk.id, _num(hawk.raked.day), tries) >= p) {
            return { success: true, came: false, food: f.id, p, text: Falconry.line('lureFail', { name: hawk.name }) };
        }
        const inv = player.inventory;
        inv[f.id] -= 1;
        if (inv[f.id] <= 0) delete inv[f.id];
        hawk.hunger = _clamp(_num(hawk.hunger, 80) + f.fills, 0, 100);
        hawk.raked = null;
        return { success: true, came: true, food: f.id, p, text: Falconry.line('lured', { name: hawk.name }) };
    },

    /** You left the map with it raked away: it finds you by nightfall, wilder for it. */
    leftRaked(world, hawk) {
        if (!hawk || !hawk.raked) return null;
        hawk.raked = null;
        hawk.bond = _clamp(_num(hawk.bond, 40) - Falconry.config().lure.leftBond, 0, 100);
        return { text: Falconry.line('leftRaked', { name: hawk.name }) };
    },
};
