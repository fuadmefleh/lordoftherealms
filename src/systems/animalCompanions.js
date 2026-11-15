// ============================================
// ANIMAL COMPANIONS — your own dog, cat, hawk and horse
// ============================================
// Named animals of the player's that go about with them (or are kept at one
// of their homes): dogs (a hound, a mastiff, a sheepdog, a mutt), a cat, a
// hawk or falcon — and the riding horse. The horse is player.mount, as the
// stable and the livestock market have always made it ({ name, price,
// acquiredDay, ... }): this system adds its own fields to that same object
// (id 'mount', bond, hunger, health, bornDay, deathDay), so every reader of
// player.mount goes on as before and an old save's mount is simply
// backfilled. The others live on player.animalCompanions (saved:
// systems/saveLoad.js EXTRA_PLAYER_FIELDS):
//
//   { v, seq, list: [animal], gone: [{ name, species, how, day }], strays: { key: trust|'taken' } }
//   animal = { id, species, breed, name, sex, bornDay, deathDay, bond, hunger,
//              health, acquiredDay, from, lastPetDay, keptAt }
//
// Getting one: bought at a town's market (market/buy: a kennel's pups, a
// kitten, a falconer's hawk — the price paid into the town's purse), or a
// stray dog won over on the street map with food from your packs
// (strayAt/offerFood; ui/innerMapPets.js shows it).
// By the day (processDay, from ui/game/endDay.js): each grows older (a year
// is 120 days) and dies of old age at its deathDay; it gets hungry and eats
// what it finds itself (a cat mouses, a hawk hunts, a horse grazes outside
// winter), then what it eats from your packs, else scraps or fodder bought
// at the town's market (coin to the town's purse) — or, kept at a home, from
// that home's larder. Fed, its bond with you grows and it heals; starved, it
// sickens, and an unloved one runs off.
// What they do (modest, by fitness — bond, belly, health — and only the
// ones travelling with you): a dog's nose adds to the hunt (Hunting.rollQty,
// player/foraging.js), it warns of cutpurses (NpcTheft.awareness) and of a
// band on the road (RoadEncounters.fleeChance), and takes part of a beast's
// mauling (RoadEncounters.ambush); a hawk brings small game (the hunt's meat,
// feathers and hides); a cat kept at a home keeps the rats from its larder
// (Household spoilage). On the street map they walk at your side and a dog
// fights beside you (ui/innerMapPets.js).
//
// No globals: world and player come in as parameters. No shared RNG: every
// chance is a hash of the world seed and what it is about.

import { DataLoader } from '../core/dataLoader.js';
import { Economy } from '../world/economy.js';
import { Seasons } from '../world/seasons.js';
import { Ledger } from './ledger.js';
import { StreetFollowers } from './streetFollowers.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day, 0);
const TYPES = ['village', 'town', 'city', 'capital'];
const PRICE_BY_TYPE = { village: 0.85, town: 1, city: 1.15, capital: 1.3 };

function _hash(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
}
const _frac = (...parts) => _hash(parts.join('|')) / 4294967296;

function _seed(world) {
    const g = world && world.generationParams;
    return g && g.seed != null ? g.seed : 'world';
}

const _fmt = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? m : String(v[k])));

const FALLBACK = {
    config: {
        dayYear: 120, maxAnimals: 6, feedBelow: 60, boardBelow: 30, starveBelow: 12, bondPerDayFed: 0.6, bondPerDayAway: -0.2,
        bondFloorAway: 20, petBond: 4, feedBond: 2, healPerDay: 3, starveHealth: 6, starveBond: 3, runOffBond: 8,
        strayTrust: 80, strayWindowDays: 10, strayChance: { village: 0.45, town: 0.6, city: 0.7, capital: 0.75 },
        goneCap: 12, noticeCap: 4,
    },
};

export const AnimalCompanions = {
    data() {
        return (DataLoader.get && DataLoader.get('animalCompanions')) || {};
    },

    config() {
        return { ...FALLBACK.config, ...(AnimalCompanions.data().config || {}) };
    },

    species(id) {
        const s = AnimalCompanions.data().species || {};
        return _obj(s[id]);
    },

    breed(spId, breedId) {
        const sp = AnimalCompanions.species(spId);
        const b = sp && _obj(sp.breeds) ? sp.breeds[breedId] : null;
        return _obj(b);
    },

    /** "Hunting Hound", "Tabby Cat" — the animal's kind in words. */
    kindName(a) {
        if (!a) return '';
        const b = AnimalCompanions.breed(a.species, a.breed);
        const sp = AnimalCompanions.species(a.species) || {};
        return (b && b.name) || sp.name || String(a.species);
    },

    icon(a) {
        const sp = AnimalCompanions.species(a && a.species) || {};
        return sp.icon || '🐾';
    },

    line(key, vars = {}) {
        const L = AnimalCompanions.data().lines || {};
        return _fmt(L[key] || '', vars);
    },

    // ──────────── STATE ────────────

    /** The player's animals' book (created / backfilled). */
    state(player) {
        if (!player) return null;
        let st = player.animalCompanions;
        if (!_obj(st)) st = player.animalCompanions = { v: 1, seq: 0, list: [], gone: [], strays: {} };
        if (!Array.isArray(st.list)) st.list = [];
        if (!Array.isArray(st.gone)) st.gone = [];
        if (!_obj(st.strays)) st.strays = {};
        if (!Number.isFinite(st.seq)) st.seq = 0;
        return st;
    },

    /** The horse as one of the animals: player.mount, its own fields backfilled. */
    mount(player, world = null) {
        const m = player && _obj(player.mount);
        if (!m) return null;
        const cfg = AnimalCompanions.config();
        const day = world ? _day(world) : _num(m.acquiredDay, 0);
        m.id = 'mount';
        m.species = 'horse';
        if (!m.breed) m.breed = 'riding';
        if (!Number.isFinite(m.bond)) m.bond = 50;
        if (!Number.isFinite(m.hunger)) m.hunger = 80;
        if (!Number.isFinite(m.health)) m.health = 100;
        if (!Number.isFinite(m.bornDay)) {
            // (a herd horse knows its age in days; a stable's is a horse of five or so)
            m.bornDay = _num(m.acquiredDay, day) - (Number.isFinite(m.age) ? m.age : 5 * cfg.dayYear);
        }
        if (!Number.isFinite(m.deathDay)) m.deathDay = AnimalCompanions._deathDay('horse', m.bornDay, `${m.name}|${m.acquiredDay}`);
        return m;
    },

    _deathDay(spId, bornDay, key) {
        const sp = AnimalCompanions.species(spId) || {};
        const [lo, hi] = Array.isArray(sp.lifeYears) ? sp.lifeYears : [10, 14];
        const years = lo + (hi - lo) * _frac('life', spId, key);
        return Math.round(bornDay + years * AnimalCompanions.config().dayYear);
    },

    /** Every living animal of yours (the horse last). */
    list(player, world = null) {
        const st = AnimalCompanions.state(player);
        if (!st) return [];
        const out = st.list.slice();
        const m = AnimalCompanions.mount(player, world);
        if (m) out.push(m);
        return out;
    },

    get(player, id) {
        if (!player) return null;
        if (id === 'mount') return AnimalCompanions.mount(player);
        return AnimalCompanions.state(player).list.find(a => a.id === id) || null;
    },

    /** The ones going about with you (not kept at a home). */
    travelling(player, world = null) {
        return AnimalCompanions.list(player, world).filter(a => !a.keptAt);
    },

    /** Its age in days. */
    ageDays(a, world) {
        return Math.max(0, _day(world) - _num(a && a.bornDay, _day(world)));
    },

    ageYears(a, world) {
        return Math.floor(AnimalCompanions.ageDays(a, world) / AnimalCompanions.config().dayYear);
    },

    isYoung(a, world) {
        const sp = AnimalCompanions.species(a && a.species) || {};
        return AnimalCompanions.ageDays(a, world) < _num(sp.matureDays, 90);
    },

    /** "a pup", "3 years", "old" — its age in words. */
    ageText(a, world) {
        const sp = AnimalCompanions.species(a && a.species) || {};
        if (AnimalCompanions.isYoung(a, world)) return `a ${sp.youngName || 'young one'}`;
        const y = AnimalCompanions.ageYears(a, world);
        return y < 1 ? 'under a year' : `${y} year${y === 1 ? '' : 's'}`;
    },

    _name(player, spId, key) {
        const pool = ((AnimalCompanions.data().names || {})[spId]) || ['Beast'];
        const used = new Set(AnimalCompanions.list(player).map(a => a.name));
        const start = _hash(`name|${spId}|${key}`) % pool.length;
        for (let i = 0; i < pool.length; i++) {
            const n = pool[(start + i) % pool.length];
            if (!used.has(n)) return n;
        }
        return pool[start];
    },

    /** Add an animal to your book. o: { breed, name, ageDays, bond, from, sex } → the animal */
    acquire(world, player, spId, o = {}) {
        const sp = AnimalCompanions.species(spId);
        if (!player || !sp || sp.mount) return null;
        const st = AnimalCompanions.state(player);
        const day = _day(world);
        st.seq += 1;
        const id = `a${st.seq}`;
        const breed = o.breed && sp.breeds && sp.breeds[o.breed] ? o.breed : Object.keys(sp.breeds || {})[0] || null;
        const bornDay = day - Math.max(0, Math.round(_num(o.ageDays, _num(sp.matureDays, 90))));
        const a = {
            id, species: spId, breed,
            name: o.name || AnimalCompanions._name(player, spId, `${_seed(world)}|${day}|${id}`),
            sex: o.sex || (_frac('sex', _seed(world), day, id) < 0.5 ? 'f' : 'm'),
            bornDay, deathDay: AnimalCompanions._deathDay(spId, bornDay, `${_seed(world)}|${id}`),
            bond: _clamp(_num(o.bond, 40), 0, 100), hunger: 80, health: 100,
            acquiredDay: day, from: o.from || 'bought', lastPetDay: null, keptAt: null,
        };
        st.list.push(a);
        return a;
    },

    /** How fit it is to do its work: 0.25..1 by bond, belly and health (a youngster half). */
    fitness(a, world = null) {
        if (!a) return 0;
        let f = 0.5 + 0.5 * _clamp(_num(a.bond, 50), 0, 100) / 100;
        if (_num(a.hunger, 80) <= 15) f *= 0.5;
        if (_num(a.health, 100) <= 30) f *= 0.6;
        if (world && AnimalCompanions.isYoung(a, world)) f *= 0.5;
        return f;
    },

    /** An effect's strength for one animal (its kind's, times its breed's, times its fitness). */
    effectOf(a, key, world = null) {
        const sp = AnimalCompanions.species(a && a.species);
        const base = sp && _obj(sp.effects) ? _num(sp.effects[key]) : 0;
        if (!base) return 0;
        const b = AnimalCompanions.breed(a.species, a.breed);
        const mult = b && _obj(b.mult) && Number.isFinite(b.mult[key]) ? b.mult[key] : 1;
        return base * mult * AnimalCompanions.fitness(a, world);
    },

    /** Your own animals going about with you, read without touching the book (the horse has no effects of its own). */
    _with(player) {
        const st = player && _obj(player.animalCompanions);
        return st && Array.isArray(st.list) ? st.list.filter(a => a && !a.keptAt) : [];
    },

    /** The best of an effect among the animals with you (they don't stack). */
    _best(player, key, world = null, filter = null) {
        let best = 0;
        for (const a of AnimalCompanions._with(player)) {
            if (filter && !filter(a)) continue;
            best = Math.max(best, AnimalCompanions.effectOf(a, key, world));
        }
        return best;
    },

    // ──────────── WHAT THEY DO (read by the game) ────────────

    /** The hunt's extra chance of another cut of `entry` (a dog's nose; a hawk for small game). */
    huntQtyBonus(player, entry = null, world = null) {
        const item = entry && (entry.item || entry.name);
        return AnimalCompanions._best(player, 'huntQty', world, (a) => {
            const sp = AnimalCompanions.species(a.species) || {};
            const items = sp.effects && sp.effects.huntItems;
            return !Array.isArray(items) || (item != null && items.includes(item));
        });
    },

    /** A cutpurse's hand noticed (added to the player's awareness). */
    theftWarning(player, world = null) {
        // (only one walking the streets with you: not one left waiting at the inn)
        return AnimalCompanions._best(player, 'theftWarn', world, a => StreetFollowers.walks(player, StreetFollowers.animalKey(a.id)));
    },

    /** The beast at your heel that barks at a cutpurse's hand (the best warner walking with you), or null. */
    theftWarner(player, world = null) {
        let best = null, bv = 0;
        for (const a of AnimalCompanions._with(player)) {
            if (!StreetFollowers.walks(player, StreetFollowers.animalKey(a.id))) continue;
            const v = AnimalCompanions.effectOf(a, 'theftWarn', world);
            if (v > bv) { bv = v; best = a; }
        }
        return best;
    },

    /** Warning of a band on the road: added to the chance of getting away. */
    roadWarning(player, world = null) {
        return AnimalCompanions._best(player, 'roadWarn', world);
    },

    /** The share of a beast's mauling a dog takes on itself: { share, animal } (the best guard). */
    beastGuard(player, world = null) {
        let best = { share: 0, animal: null };
        for (const a of AnimalCompanions._with(player)) {
            const s = AnimalCompanions.effectOf(a, 'beastGuard', world);
            if (s > best.share) best = { share: Math.min(0.6, s), animal: a };
        }
        return best;
    },

    /** Larder spoilage cut at a home by a cat kept there (0..0.8). */
    mouserCut(player, homeKey) {
        if (!player || homeKey == null) return 0;
        let best = 0;
        const st = _obj(player.animalCompanions);
        for (const a of (st && Array.isArray(st.list) ? st.list : [])) {
            if (!a || a.keptAt !== homeKey) continue;
            best = Math.max(best, AnimalCompanions.effectOf(a, 'mouser'));
        }
        return Math.min(0.8, best);
    },

    /** Its bite beside you on the street map (0 for one that doesn't fight). */
    streetDamage(a, world = null) {
        const sp = AnimalCompanions.species(a && a.species);
        if (!sp || !sp.fights) return 0;
        return Math.max(1, AnimalCompanions.effectOf(a, 'streetFight', world));
    },

    // ──────────── TENDING ────────────

    /** Foods in your packs it will eat, cheapest-filling first: [{ id, fills, have }] */
    foodsFor(player, a) {
        const sp = AnimalCompanions.species(a && a.species) || {};
        const inv = (player && player.inventory) || {};
        return Object.entries(_obj(sp.eats) || {})
            .filter(([id]) => _num(inv[id]) >= 1)
            .map(([id, fills]) => ({ id, fills: _num(fills), have: Math.floor(_num(inv[id])) }));
    },

    _takeFood(player, id) {
        const inv = player.inventory || {};
        if (_num(inv[id]) < 1) return false;
        inv[id] -= 1;
        if (inv[id] <= 0) delete inv[id];
        return true;
    },

    /** Feed it from your packs (a given food, or the first it eats). → { success, text } */
    feed(player, id, foodId = null, world = null) {
        const a = AnimalCompanions.get(player, id);
        if (!a) return { success: false, reason: 'No such animal.' };
        const foods = AnimalCompanions.foodsFor(player, a);
        const f = foodId ? foods.find(x => x.id === foodId) : foods[0];
        if (!f) return { success: false, reason: `You have nothing ${a.name} will eat.` };
        if (_num(a.hunger) >= 100) return { success: false, reason: `${a.name} is full.` };
        AnimalCompanions._takeFood(player, f.id);
        a.hunger = _clamp(_num(a.hunger) + f.fills, 0, 100);
        a.bond = _clamp(_num(a.bond) + AnimalCompanions.config().feedBond, 0, 100);
        if (world) a.lastFedDay = _day(world);
        return { success: true, food: f.id, text: `${a.name} eats the ${f.id.replace(/_/g, ' ')}.` };
    },

    /** Make a fuss of it (once a day counts). → { success, text } */
    pet(player, id, world = null) {
        const a = AnimalCompanions.get(player, id);
        if (!a) return { success: false, reason: 'No such animal.' };
        const day = _day(world);
        if (a.lastPetDay === day) return { success: true, text: `${a.name} leans into your hand.`, gained: 0 };
        a.lastPetDay = day;
        const gain = AnimalCompanions.config().petBond;
        a.bond = _clamp(_num(a.bond) + gain, 0, 100);
        const sp = AnimalCompanions.species(a.species) || {};
        const how = a.species === 'cat' ? 'purrs and winds about your legs' : a.species === 'hawk' ? 'rouses its feathers on your fist' : sp.mount ? 'nickers and noses at your hand' : 'wags and leans against your knee';
        return { success: true, gained: gain, text: `${a.name} ${how}.` };
    },

    rename(player, id, name) {
        const a = AnimalCompanions.get(player, id);
        const clean = String(name == null ? '' : name).replace(/[<>"'`&]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
        if (!a) return { success: false, reason: 'No such animal.' };
        if (!clean) return { success: false, reason: 'Give it a name.' };
        const old = a.name;
        a.name = clean;
        return { success: true, text: `${old} is ${clean} now.` };
    },

    /** Keep it at a home of yours (its key), or take it along again (null). */
    keepAt(player, id, homeKey) {
        const a = AnimalCompanions.get(player, id);
        if (!a) return { success: false, reason: 'No such animal.' };
        if (a.id === 'mount') return { success: false, reason: 'Stable your horse at a herd of yours instead.' };
        a.keptAt = homeKey == null ? null : String(homeKey);
        return { success: true, text: homeKey == null ? `${a.name} comes along with you again.` : `${a.name} stays at the house.` };
    },

    /** Let one go (not the horse: sell it at a stable). */
    release(player, id, world = null) {
        const st = AnimalCompanions.state(player);
        const a = st.list.find(x => x.id === id);
        if (!a) return { success: false, reason: 'No such animal.' };
        st.list = st.list.filter(x => x !== a);
        StreetFollowers.forget(player, StreetFollowers.animalKey(id));
        AnimalCompanions._remember(player, a, 'let go', world);
        return { success: true, text: `You let ${a.name} go.` };
    },

    /** Hurt in a fight (a beast's teeth): its health; dead at 0. → true when it died */
    hurt(player, id, dmg, world = null, notices = null) {
        const a = AnimalCompanions.get(player, id);
        if (!a) return false;
        a.health = _clamp(_num(a.health, 100) - Math.max(0, _num(dmg)), 0, 100);
        if (a.health <= 0) {
            AnimalCompanions._die(player, a, 'fell', world, notices);
            return true;
        }
        return false;
    },

    /** How much it can take: its breed's hp, else its kind's (data: species.hp / breeds.hp). */
    maxHp(a) {
        const sp = AnimalCompanions.species(a && a.species) || {};
        const br = AnimalCompanions.breed(a && a.species, a && a.breed) || {};
        return Math.max(1, _num(br.hp, _num(sp.hp, 30)));
    },

    /** Its hit points now: health (0..100) of its hp. */
    hpOf(a) {
        return Math.round(AnimalCompanions.maxHp(a) * _clamp(_num(a && a.health, 100), 0, 100) / 100);
    },

    /**
     * Struck for `hits` hit points (a beast's bite on the street map): a big
     * mastiff shrugs off what kills a cat. → true when it died
     */
    wound(player, id, hits, world = null, notices = null) {
        const a = AnimalCompanions.get(player, id);
        if (!a || !(hits > 0)) return false;
        return AnimalCompanions.hurt(player, id, hits * 100 / AnimalCompanions.maxHp(a), world, notices);
    },

    /** The foe's bite back at it on the street map: { chance, npc: [min, max] } (config.streetHurt). */
    streetHurt() {
        const H = _obj(AnimalCompanions.config().streetHurt) || {};
        return { chance: _clamp(_num(H.chance, 0.3), 0, 1), npc: Array.isArray(H.npc) ? H.npc : [2, 6], beast: Array.isArray(H.beast) ? H.beast : [3, 8] };
    },

    _remember(player, a, how, world) {
        const st = AnimalCompanions.state(player);
        st.gone.push({ name: a.name, species: a.species, breed: a.breed, how, day: _day(world) });
        const cap = AnimalCompanions.config().goneCap;
        if (st.gone.length > cap) st.gone.splice(0, st.gone.length - cap);
    },

    _die(player, a, how, world, notices) {
        const st = AnimalCompanions.state(player);
        if (a.id === 'mount') player.mount = null;
        else st.list = st.list.filter(x => x !== a);
        StreetFollowers.forget(player, StreetFollowers.animalKey(a.id));
        AnimalCompanions._remember(player, a, how, world);
        if (notices) {
            const text = how === 'old age' ? AnimalCompanions.line('oldAge', { name: a.name, years: AnimalCompanions.ageYears(a, world) })
                : how === 'starved' ? AnimalCompanions.line('starved', { name: a.name })
                    : how === 'ran off' ? AnimalCompanions.line('ranOff', { name: a.name })
                        : `${a.name} is dead.`;
            notices.push({ icon: how === 'ran off' ? '🐾' : '🕯️', title: how === 'ran off' ? `${a.name} Is Gone` : `${a.name} Is Dead`, text, type: 'warning' });
        }
    },

    // ──────────── THE DAY ────────────

    _settlementAt(world, player) {
        if (!world || typeof world.getTile !== 'function' || !player) return null;
        const t = world.getTile(player.q, player.r);
        return (t && t.settlement) || null;
    },

    _winter(world) {
        const s = (world && world.season) || (world && Number.isFinite(world.day) ? Seasons.seasonOf(world.day) : null);
        return s === 'Winter';
    },

    /**
     * A day of their lives. ctx.larder(homeKey) → that home's larder ({ good: qty })
     * for the ones kept there (ui/game/endDay.js passes Household's). → { notices }
     */
    processDay(world, player, ctx = {}) {
        const notices = [];
        if (!player) return { notices };
        const cfg = AnimalCompanions.config();
        const day = _day(world);
        const town = AnimalCompanions._settlementAt(world, player);
        const winter = AnimalCompanions._winter(world);
        const boarded = [];
        let boardCost = 0;
        for (const a of AnimalCompanions.list(player, world)) {
            const sp = AnimalCompanions.species(a.species) || {};
            // Old age
            if (Number.isFinite(a.deathDay) && day >= a.deathDay) { AnimalCompanions._die(player, a, 'old age', world, notices); continue; }
            a.hunger = _clamp(_num(a.hunger, 80) - _num(sp.hungerPerDay, 30), 0, 100);
            const F = _obj(sp.forage) || {};
            if (a.keptAt) {
                // Kept at a home: a cat mouses about the house; the rest eat from its larder
                a.hunger = _clamp(a.hunger + _num(F.town), 0, 100);
                const larder = typeof ctx.larder === 'function' ? _obj(ctx.larder(a.keptAt)) : null;
                if (larder) {
                    for (const [g, fills] of Object.entries(_obj(sp.eats) || {})) {
                        while (a.hunger < cfg.feedBelow && _num(larder[g]) >= 1) {
                            larder[g] -= 1;
                            if (larder[g] <= 0) delete larder[g];
                            a.hunger = _clamp(a.hunger + _num(fills), 0, 100);
                        }
                    }
                }
                if (a.hunger > 30) a.bond = Math.max(Math.min(_num(a.bond), cfg.bondFloorAway), _num(a.bond) + cfg.bondPerDayAway);
            } else {
                // What it finds itself: in town, out in the wild (a horse grazes but not on winter's snow)
                a.hunger = _clamp(a.hunger + (town ? _num(F.town) : (winter && F.winterWild != null ? _num(F.winterWild) : _num(F.wild))), 0, 100);
                // Then from your packs
                for (const f of AnimalCompanions.foodsFor(player, a)) {
                    while (a.hunger < cfg.feedBelow && AnimalCompanions._takeFood(player, f.id)) a.hunger = _clamp(a.hunger + f.fills, 0, 100);
                    if (a.hunger >= cfg.feedBelow) break;
                }
                // Then scraps or fodder bought at the market, if you're in a town
                if (a.hunger < cfg.boardBelow && town && _num(sp.board) > 0) {
                    boarded.push(a);
                    boardCost += _num(sp.board);
                }
            }
        }
        if (boarded.length) {
            if (_num(player.gold) >= boardCost) {
                player.gold = _num(player.gold) - boardCost;
                // the butcher's scraps and the chandler's oats are the town's to sell
                Economy.payTown(town, boardCost);
                Ledger.record(player, 'animals', -boardCost);
                for (const a of boarded) a.hunger = Math.max(a.hunger, 75);
                const text = AnimalCompanions.line('boarded', { cost: Math.round(boardCost), names: boarded.map(a => a.name).join(', ') });
                if (text) notices.push({ icon: '🦴', title: 'Fed at the Market', text, type: 'info' });
            }
        }
        for (const a of AnimalCompanions.list(player, world)) {
            if (a.hunger > 30) {
                a.health = _clamp(_num(a.health, 100) + cfg.healPerDay, 0, 100);
                if (!a.keptAt) a.bond = _clamp(_num(a.bond) + cfg.bondPerDayFed, 0, 100);
            } else if (a.hunger <= _num(cfg.starveBelow, 12)) {
                // (starving: what it scrounges for itself keeps it alive a while, not well)
                a.health = _clamp(_num(a.health, 100) - cfg.starveHealth, 0, 100);
                a.bond = _clamp(_num(a.bond) - cfg.starveBond, 0, 100);
                if (a.health <= 0) { AnimalCompanions._die(player, a, 'starved', world, notices); continue; }
                if (a.id !== 'mount' && a.bond <= cfg.runOffBond) { AnimalCompanions._die(player, a, 'ran off', world, notices); continue; }
                if (_num(a.health) <= 40) notices.push({ icon: AnimalCompanions.icon(a), title: 'Hungry', text: AnimalCompanions.line('starving', { name: a.name }), type: 'warning' });
            }
        }
        // Old strays forgotten
        const st = AnimalCompanions.state(player);
        const win = Math.floor(day / Math.max(1, cfg.strayWindowDays));
        for (const k of Object.keys(st.strays)) {
            const w = Number(String(k).split('|').pop());
            if (Number.isFinite(w) && w < win - 1) delete st.strays[k];
        }
        return { notices: notices.slice(0, cfg.noticeCap) };
    },

    // ──────────── THE MARKET ────────────

    _typeOf(s) {
        const t = String((s && s.type) || 'town');
        return TYPES.includes(t) ? t : 'town';
    },

    /** What the town's market has this month: [{ key, species, breed, name, icon, price, stock, desc }] */
    market(world, s) {
        if (!s) return [];
        const type = AnimalCompanions._typeOf(s);
        const month = Math.floor(_day(world) / 30);
        const book = AnimalCompanions._book(s, month);
        const out = [];
        for (const [spId, sp] of Object.entries(AnimalCompanions.data().species || {})) {
            if (!sp || sp.mount) continue;
            for (const [bId, b] of Object.entries(sp.breeds || {})) {
                const M = _obj(b.market);
                if (!M) continue;
                if (TYPES.indexOf(type) < TYPES.indexOf(M.minType || 'village')) continue;
                const chance = _num((M.chance || {})[type]);
                const key = `${spId}:${bId}`;
                if (_frac(_seed(world), 'pets', s.q, s.r, month, key) >= chance) continue;
                const stock = 1 + Math.floor(_frac(_seed(world), 'petStock', s.q, s.r, month, key) * 3) - _num(book.sold[key]);
                if (stock <= 0) continue;
                out.push({
                    key, species: spId, breed: bId, name: b.name || sp.name, icon: sp.icon || '🐾', desc: b.desc || '',
                    price: Math.max(1, Math.round(_num(b.price, 10) * (PRICE_BY_TYPE[type] || 1))), stock,
                    young: spId !== 'hawk',
                });
            }
        }
        return out;
    },

    _book(s, month) {
        if (!_obj(s.petMarket) || s.petMarket.m !== month) s.petMarket = { m: month, sold: {} };
        if (!_obj(s.petMarket.sold)) s.petMarket.sold = {};
        return s.petMarket;
    },

    /** Buy one at the town's market: the price into the town's purse. → { success, animal, text } */
    buy(world, player, s, key) {
        if (!player || !s) return { success: false, reason: 'There is no market here.' };
        const offer = AnimalCompanions.market(world, s).find(o => o.key === key);
        if (!offer) return { success: false, reason: 'None of those for sale here this month.' };
        const cfg = AnimalCompanions.config();
        if (AnimalCompanions.state(player).list.length >= cfg.maxAnimals) return { success: false, reason: `You can't look after more than ${cfg.maxAnimals} animals.` };
        if (_num(player.gold) < offer.price) return { success: false, reason: `${offer.name} costs ${offer.price}g; you have ${Math.floor(_num(player.gold))}g.` };
        player.gold = _num(player.gold) - offer.price;
        Economy.payTown(s, offer.price);
        Ledger.record(player, 'animals', -offer.price);
        const book = AnimalCompanions._book(s, Math.floor(_day(world) / 30));
        book.sold[key] = _num(book.sold[key]) + 1;
        const sp = AnimalCompanions.species(offer.species) || {};
        const mature = _num(sp.matureDays, 90);
        const ageDays = offer.young ? Math.round(mature * (0.35 + 0.3 * _frac('age', _seed(world), _day(world), key))) : Math.round(mature + 120 + 120 * _frac('age', _seed(world), _day(world), key));
        const a = AnimalCompanions.acquire(world, player, offer.species, { breed: offer.breed, ageDays, bond: offer.young ? 45 : 30, from: 'bought' });
        return { success: true, animal: a, cost: offer.price, text: `You buy ${a.name}, ${offer.young ? `a ${(sp.youngName || 'young one')}` : `a ${offer.name.toLowerCase()}`}, for ${offer.price}g.` };
    },

    // ──────────── STRAYS ────────────

    /** The stray about this town now (a hash of the world, the town and the week), or null. */
    strayAt(world, s, player = null) {
        if (!s) return null;
        const cfg = AnimalCompanions.config();
        const win = Math.floor(_day(world) / Math.max(1, cfg.strayWindowDays));
        const type = AnimalCompanions._typeOf(s);
        if (_frac(_seed(world), 'stray', s.q, s.r, win) >= _num(cfg.strayChance[type], 0.5)) return null;
        const key = `${s.q},${s.r}|${win}`;
        const st = player ? AnimalCompanions.state(player) : null;
        if (st && st.strays[key] === 'taken') return null;
        return { key, species: 'dog', breed: 'mutt', trust: st ? _num(st.strays[key]) : 0, ageDays: Math.round(150 + 500 * _frac(_seed(world), 'strayAge', key)) };
    },

    /** Offer the stray food from your packs: its trust grows; enough and it's yours. */
    offerFood(world, player, s, foodId = null) {
        const stray = AnimalCompanions.strayAt(world, s, player);
        if (!stray) return { success: false, reason: 'The stray is gone.' };
        const sp = AnimalCompanions.species(stray.species) || {};
        const eats = _obj(sp.eats) || {};
        const inv = player.inventory || {};
        if (foodId && eats[foodId] == null) return { success: false, reason: `The stray sniffs the ${String(foodId).replace(/_/g, ' ')} and turns away.` };
        const food = foodId || Object.keys(eats).find(id => _num(inv[id]) >= 1);
        if (!food || _num(inv[food]) < 1) return { success: false, reason: 'You have nothing a dog would eat.' };
        const cfg = AnimalCompanions.config();
        if (AnimalCompanions.state(player).list.length >= cfg.maxAnimals) return { success: false, reason: `You can't look after more than ${cfg.maxAnimals} animals.` };
        AnimalCompanions._takeFood(player, food);
        const st = AnimalCompanions.state(player);
        const trust = _num(st.strays[stray.key]) + _num(eats[food]);
        if (trust < cfg.strayTrust) {
            st.strays[stray.key] = trust;
            return { success: true, joined: false, trust, need: cfg.strayTrust, text: AnimalCompanions.line('strayWary', {}) };
        }
        st.strays[stray.key] = 'taken';
        const a = AnimalCompanions.acquire(world, player, stray.species, { breed: stray.breed, ageDays: stray.ageDays, bond: 30, from: 'stray' });
        a.hunger = 90;
        return { success: true, joined: true, animal: a, text: AnimalCompanions.line('strayJoins', { name: a.name }) };
    },
};
