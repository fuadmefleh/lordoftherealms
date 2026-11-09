// ============================================
// LIVESTOCK — the player's own beasts, by the head
// ============================================
// Chickens, ducks, pigs, goats, sheep, dairy cows, highland cattle and
// horses, bought and sold at a town's livestock market and kept at a place
// of the player's that suits them (data/livestock.json → places):
//
//   a property      a Pasture, Dairy, Cattle Ranch or Horse Ranch (whose
//                   working beasts make its own output — `works`), a farm's
//                   or orchard's yard, an inn's or tavern's back yard
//   an estate       land the player holds about a town (world/estates.js)
//   a lot or house  a town lot, a house bought or rented there (systems/lots.js)
//   a home          a house bought through Housing (systems/housing.js)
//
// Every head is one record (sex, age, health, sickness) on its place's herd,
// so the herd lives by the day (`processDay`): fodder bought when it cannot
// graze (or hunger), eggs, milk, feathers and wool into the herd's store
// (collected like a property's goods), births in season when a male is kept
// with the females, illness that spreads in a crowded yard, old age, and
// beasts taken by the wolves, foxes and bears of the hex (data/animals.json
// → terrain). A livestock property's output scales with its working head
// against its target (`workFactor`, read by player/playerEconomy/property.js);
// each comes with a founding herd of that size, so a property at its target
// yields what it always did. A farm's horses and pigs lift its harvest
// (`draftFactor`). A horse can be saddled as the player's mount (player.mount,
// as the stable sells one) and a mount stabled back into a herd.
//
// The market (`market`) is per settlement: which beasts it sells (a hash of
// the world seed and the town — no RNG), how many it has (bought down,
// restocked by the day, sold into) and the price (by town size, the land,
// the season and the stock left). Its state is on settlement.livestockMarket
// (saved with the tile); the herds on player.livestock (saved with the player).
//
// The day's dice are its own stream (a hash of the world seed and the day,
// drawn through Utils.withRng), so no other system's rolls move. No globals:
// world and player come in as parameters.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Seasons } from '../world/seasons.js';
import { Estates } from '../world/estates.js';
import { Lots } from './lots.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const _pair = (p, d) => (Array.isArray(p) ? [_num(p[0], d), _num(p.length > 1 ? p[1] : p[0], d)] : [d, d]);
const _day = (world) => _num(world && world.day, 0);
const SIZES = ['small', 'medium', 'large'];

function _strHash(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
}

/** A small generator seeded by a string (mulberry32). */
function _stream(seed) {
    let a = _strHash(seed);
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A 0..1 hash of the parts (no RNG drawn). */
const _roll = (...parts) => _strHash(parts.join(':')) / 4294967296;

function _seed(world) {
    const g = world && world.generationParams;
    return g && g.seed != null ? g.seed : 'world';
}

function _tile(world, q, r) {
    return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
}

/** The town's purse (settlement.economy.gold): what the dealers pay out of and into. null when it keeps none. */
function _econ(s) {
    return s && _obj(s.economy) ? s.economy : null;
}

/** Coin into (+) or out of (−) a town's purse. */
function _purse(s, amount) {
    const e = _econ(s);
    if (e) e.gold = _r2(Math.max(0, _num(e.gold) + amount));
}

/** The settlement at (q, r), else the nearest one (the market a herd there buys its fodder from). */
function _townNear(world, q, r) {
    const t = _tile(world, q, r);
    if (t && t.settlement) return t.settlement;
    const list = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
    let best = null, bd = Infinity;
    for (const s of list) {
        const d = Hex.distance(q, r, s.q, s.r);
        if (d < bd) { bd = d; best = s; }
    }
    return best;
}

function _season(world) {
    return (world && world.season) || Seasons.seasonOf(Seasons.today(world));
}

export const Livestock = {
    // ── Data ──────────────────────────────────────────────

    config() {
        return (DataLoader.get && DataLoader.get('livestock')) || {};
    },

    /** One species' livestock data (data/livestock.json), or null. */
    species(id) {
        const s = Livestock.config().species;
        return (s && _obj(s[id])) || null;
    },

    speciesIds() {
        return Object.keys(Livestock.config().species || {});
    },

    /** A good's display name and icon (data/playerEconomy.json GOODS). */
    good(id) {
        const pe = (DataLoader.get && DataLoader.get('playerEconomy')) || {};
        const g = pe.GOODS && pe.GOODS[String(id).toUpperCase()];
        return g || { id, name: String(id).replace(/_/g, ' '), icon: '📦', basePrice: 1 };
    },

    /** What a head of the species is worth at base (its market price). */
    baseValue(id) {
        return _num((Livestock.species(id) || {}).price, 10);
    },

    /** The word for one head: hen, ram, calf... */
    headName(a, sp = Livestock.species(a && a.sp)) {
        if (!sp) return 'beast';
        if (Livestock.isYoung(a, sp)) return sp.youngName || `young ${String(sp.name).toLowerCase()}`;
        return (a.sex === 'm' ? sp.maleName : sp.femaleName) || String(sp.name).toLowerCase();
    },

    /** A word for n of them: ewe → ewes, calf → calves, billy → billies, sheep → sheep. */
    plural(word, n = 2) {
        const w = String(word || '');
        if (n === 1 || !w) return w;
        if (/(sheep|deer|cattle|fish)$/i.test(w)) return w;
        if (/lf$/i.test(w)) return w.replace(/lf$/i, 'lves');
        if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ies');
        if (/(sh|ch|s|x)$/i.test(w)) return `${w}es`;
        return `${w}s`;
    },

    isYoung(a, sp = Livestock.species(a && a.sp)) {
        return _num(a && a.age) < _num(sp && sp.matureDays, 60);
    },

    isOld(a, sp = Livestock.species(a && a.sp)) {
        return _num(a && a.age) > _num(sp && sp.lifespanDays, 1000) * 0.75;
    },

    // ── State ─────────────────────────────────────────────

    state(player) {
        if (!player) return { herds: [], seq: 0 };
        if (!_obj(player.livestock)) player.livestock = { herds: [], seq: 0 };
        const st = player.livestock;
        if (!Array.isArray(st.herds)) st.herds = [];
        st.seq = _num(st.seq);
        return st;
    },

    /** The herd kept at a place key, made when `make`. */
    herd(player, key, make = null) {
        const st = Livestock.state(player);
        let h = st.herds.find(x => x && x.key === key);
        if (!h && make) {
            h = { key, place: { ...make }, animals: [], store: {}, carry: {}, hungry: 0 };
            st.herds.push(h);
        }
        return h || null;
    },

    _newId(player) {
        const st = Livestock.state(player);
        st.seq += 1;
        return `a${st.seq}`;
    },

    /** A new head on a herd. */
    _addHead(player, herd, sp, sex, age, extra = {}) {
        const a = { id: Livestock._newId(player), sp, sex: sex === 'm' ? 'm' : 'f', age: Math.max(0, Math.round(_num(age))), hp: 100, ...extra };
        herd.animals.push(a);
        return a;
    },

    // ── Places ────────────────────────────────────────────

    /** The key of a place: one herd per place. */
    placeKey(place) {
        if (!place) return null;
        switch (place.kind) {
            case 'property': return `p:${place.q},${place.r}:${place.type}`;
            case 'estate': return `e:${place.id}`;
            case 'home': return `h:${place.q},${place.r}`;
            default: return `l:${place.q},${place.r}:${place.ref}`; // lot, house, rent
        }
    },

    /** A place's keeping rules (capacity, species, grazing, works, draft), or null. */
    placeConfig(place) {
        const P = Livestock.config().places || {};
        if (!place) return null;
        if (place.kind === 'property') return _obj((P.properties || {})[place.type]);
        return _obj(P[place.kind]);
    },

    /** The player's property a place names (and its tile), or null. */
    _propertyOf(world, player, place) {
        const t = _tile(world, place.q, place.r);
        const prop = t && Array.isArray(t.playerProperties) ? t.playerProperties.find(p => p && p.type === place.type) : (t && t.playerProperty && t.playerProperty.type === place.type ? t.playerProperty : null);
        if (!prop) return null;
        if (!(player.properties || []).some(p => p && p.q === place.q && p.r === place.r && p.type === place.type)) return null;
        return { tile: t, prop };
    },

    /**
     * Every place the player could keep beasts: [{ key, place, name, q, r,
     * capacity, species, grazing, works, building, town }]. With `herdsOnly`,
     * only the places that keep a herd now.
     */
    places(world, player) {
        if (!player) return [];
        const out = [];
        const P = Livestock.config().places || {};
        const push = (place, name, cfg, extra = {}) => {
            if (!cfg) return;
            out.push({
                key: Livestock.placeKey(place), place, name, q: place.q, r: place.r,
                capacity: Math.round(_num(cfg.capacity) * (extra.scale || 1)), species: cfg.species || [], grazing: !!cfg.grazing,
                works: _obj(cfg.works), draft: !!cfg.draft, building: !!extra.building, town: extra.town || null,
                inTown: !!(_tile(world, place.q, place.r) || {}).settlement,
            });
        };
        // The player's properties (a level adds a quarter of the room)
        const seen = new Set();
        for (const ref of player.properties || []) {
            if (!ref) continue;
            const place = { kind: 'property', q: ref.q, r: ref.r, type: ref.type };
            const k = Livestock.placeKey(place);
            if (seen.has(k)) continue;
            seen.add(k);
            const cfg = _obj((P.properties || {})[ref.type]);
            if (!cfg) continue;
            const got = Livestock._propertyOf(world, player, place);
            if (!got) continue;
            const t = got.tile;
            const where = t && t.settlement ? ` at ${t.settlement.name}` : '';
            push(place, `${got.prop.name || ref.name || ref.type}${where}`, cfg, { scale: 1 + 0.25 * (Math.max(1, _num(got.prop.level, 1)) - 1), building: !!got.prop.underConstruction, town: t && t.settlement ? t.settlement.name : null });
        }
        // Estates held about the towns
        if (world && world.estates) {
            for (const est of Estates.heldBy(world, 'player')) {
                const [q, r] = String(est.town || '').split(',').map(Number);
                if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
                const t = _tile(world, q, r);
                const town = t && t.settlement ? t.settlement.name : null;
                push({ kind: 'estate', id: est.id, q, r }, `${est.name || 'Estate'}${town ? ` near ${town}` : ''}`, _obj(P.estate), { scale: _clamp(0.6 + _num(est.share, 0.5), 0.6, 1.6), town });
            }
        }
        // Lots and houses in town
        for (const v of Lots.holdingsView(world, player)) {
            const kind = v.kind === 'lot' ? 'lot' : v.kind === 'rent' ? 'rent' : 'house';
            const label = v.kind === 'lot' ? (v.name || 'Lot') : (v.name || 'House');
            push({ kind, q: v.q, r: v.r, ref: v.ref }, `${label} in ${v.town}`, _obj(P[kind]), { town: v.town });
        }
        // Homes bought through Housing
        for (const h of player.houses || []) {
            if (!h || h.q == null) continue;
            const t = _tile(world, h.q, h.r);
            const town = (t && t.settlement && t.settlement.name) || h.settlementName || null;
            const ht = ((DataLoader.get && DataLoader.get('housing')) || DataLoader.housing || {}).houseTypes || [];
            const typeName = (ht.find(x => x && x.id === h.typeId) || {}).name || 'Your home';
            push({ kind: 'home', q: h.q, r: h.r }, `${typeName}${town ? ` in ${town}` : ''}`, _obj(P.home), { town });
        }
        return out;
    },

    /** One of the player's places by key, or null (gone: sold, lost, given up). */
    placeOf(world, player, key) {
        return Livestock.places(world, player).find(p => p.key === key) || null;
    },

    /** Room a head takes. */
    space(id) {
        return Math.max(1, _num((Livestock.species(id) || {}).space, 1));
    },

    /** Room used by a herd. */
    used(herd) {
        return (herd && herd.animals || []).reduce((s, a) => s + Livestock.space(a.sp), 0);
    },

    /** May `n` head of `id` go to this place (`pl` from places())? { ok, reason, room } */
    canKeep(world, player, pl, id, n = 1) {
        const sp = Livestock.species(id);
        if (!sp) return { ok: false, reason: 'No such beast.' };
        if (!pl) return { ok: false, reason: 'You have nowhere to keep them: a pasture, farm, estate, lot or house of your own.' };
        if (pl.building) return { ok: false, reason: `${pl.name} is still being built.` };
        if (!pl.species.includes(id)) return { ok: false, reason: `${pl.name} is no place for ${String(sp.plural || sp.name).toLowerCase()}.` };
        const herd = Livestock.herd(player, pl.key);
        const room = pl.capacity - Livestock.used(herd);
        const need = Livestock.space(id) * Math.max(1, n);
        if (need > room) {
            const fits = Math.max(0, Math.floor(room / Livestock.space(id)));
            return { ok: false, room: fits, reason: fits ? `${pl.name} has room for only ${fits} more ${String(fits === 1 ? sp.name : (sp.plural || sp.name)).toLowerCase()}.` : `${pl.name} is full.` };
        }
        return { ok: true, room: Math.floor(room / Livestock.space(id)) };
    },

    /** The places a species could go now, with room for `n`: [{ pl, ok, reason }]. */
    destinations(world, player, id, n = 1) {
        return Livestock.places(world, player).map(pl => ({ pl, ...Livestock.canKeep(world, player, pl, id, n) }));
    },

    // ── The market ────────────────────────────────────────

    /** The settlement's tile (it may be given). */
    _townTile(world, s, tile = null) {
        return tile || (s && s.q != null ? _tile(world, s.q, s.r) : null);
    },

    _terrainOf(world, s, tile = null) {
        const t = Livestock._townTile(world, s, tile);
        return t && t.terrain ? t.terrain.id : null;
    },

    /** Is the town by water (a river, lake or the sea)? */
    _byWater(world, s, tile = null) {
        const t = Livestock._townTile(world, s, tile);
        if (!t) return false;
        if (t.hasRiver || t.river) return true;
        return Hex.neighbors(t.q, t.r).some(n => {
            const nt = _tile(world, n.q, n.r);
            return nt && nt.terrain && ['ocean', 'deep_ocean', 'coast', 'sea', 'lake', 'beach'].includes(nt.terrain.id);
        });
    },

    /** Is one of `ids` a map resource on the town's hex or one next to it? */
    _resourceNear(world, s, ids, tile = null) {
        if (!Array.isArray(ids) || !ids.length) return false;
        const t = Livestock._townTile(world, s, tile);
        if (!t) return false;
        const has = (x) => x && x.resource && ids.includes(x.resource.id);
        return has(t) || Hex.neighbors(t.q, t.r).some(n => has(_tile(world, n.q, n.r)));
    },

    /**
     * Which beasts a settlement's market sells and how many it aims to keep:
     * { id: target } — a hash of the world seed and the town, so the same
     * town always deals in the same beasts.
     */
    offerings(world, s, tile = null) {
        const out = {};
        if (!s) return out;
        const M = Livestock.config().market || {};
        const type = s.type || 'village';
        const rank = { village: 0, town: 1, city: 2, capital: 3 };
        const terrain = Livestock._terrainOf(world, s, tile);
        const water = Livestock._byWater(world, s, tile);
        for (const id of Livestock.speciesIds()) {
            const sp = Livestock.species(id);
            const m = _obj(sp.market);
            if (!m) continue;
            const res = Livestock._resourceNear(world, s, m.resource, tile);
            // Too small a town for it (unless the land is known for it: a resource nearby)
            if (_num(rank[type], 0) < _num(rank[m.minType || 'village'], 0) && !res) continue;
            let chance = _num((m.chance || {})[type], 0);
            if (Array.isArray(m.likes) && m.likes.includes(terrain) && chance > 0) chance = Math.min(1, chance + 0.3);
            if (Array.isArray(m.shuns) && m.shuns.includes(terrain)) chance *= 0.3;
            if (m.water != null && water) chance = Math.min(1, chance + _num(m.water));
            if (res) chance = 1;
            if (chance <= 0 || _roll(_seed(world), 'lsSell', s.q, s.r, id) >= chance) continue;
            const [lo, hi] = _pair(m.stock, 4);
            const base = lo + Math.floor(_roll(_seed(world), 'lsStock', s.q, s.r, id) * (hi - lo + 1));
            const mult = _num((M.typeStock || {})[type], 1) * (res ? 1.5 : 1) * (Array.isArray(m.likes) && m.likes.includes(terrain) ? 1.3 : 1);
            out[id] = Math.max(1, Math.round(base * mult));
        }
        return out;
    },

    /** The market's book on the settlement, restocked up to today. */
    _book(world, s, tile = null) {
        const offer = Livestock.offerings(world, s, tile);
        if (!_obj(s.livestockMarket)) s.livestockMarket = { day: _day(world), stock: {} };
        const b = s.livestockMarket;
        if (!_obj(b.stock)) b.stock = {};
        const M = Livestock.config().market || {};
        const days = Math.max(0, _day(world) - _num(b.day, _day(world)));
        const per = 1 / Math.max(1, _num(M.restockDays, 20));
        for (const [id, target] of Object.entries(offer)) {
            const now = b.stock[id] == null ? target : _num(b.stock[id]);
            // Back toward the target: refilled when bought down, sold on when glutted
            const step = target * per * days;
            // (bred by the town's own farmers, a head at a time, toward what the land carries)
            b.stock[id] = _r2(now < target ? Math.min(target, now + step) : Math.max(target, now - step));
            // a glut goes to the town's butchers: its meat into the town's food
            const culled = now > target ? now - b.stock[id] : 0;
            const e = _econ(s);
            if (culled > 0 && e && e.food != null) {
                const meat = ((Livestock.species(id) || {}).slaughter || []).find(x => x && /meat|mutton|beef|pork/.test(String(x.good)));
                const [lo, hi] = _pair(meat && meat.qty, 0);
                e.food = _r2(_num(e.food) + culled * (lo + hi) / 2);
            }
        }
        for (const id of Object.keys(b.stock)) if (offer[id] == null) delete b.stock[id];
        b.day = _day(world);
        return { book: b, offer };
    },

    /** Price of one head of `id` here with `stock` left (the market's asking price). */
    unitPrice(world, s, id, stock, target, tile = null) {
        const sp = Livestock.species(id);
        if (!sp) return 0;
        const M = Livestock.config().market || {};
        const m = _obj(sp.market) || {};
        const terrain = Livestock._terrainOf(world, s, tile);
        let p = _num(sp.price, 10) * _num((M.typePrice || {})[s.type || 'village'], 1) * _num((M.seasons || {})[_season(world)], 1);
        if (Array.isArray(m.likes) && m.likes.includes(terrain)) p *= _num(M.liked, 0.85);
        else if (Array.isArray(m.shuns) && m.shuns.includes(terrain)) p *= _num(M.foreign, 1.25);
        if (Livestock._resourceNear(world, s, m.resource, tile)) p *= _num(M.liked, 0.85);
        const share = target > 0 ? stock / target : 1;
        p *= _clamp(1 + _num(M.scarcity, 0.6) * (1 - share), _num(M.scarcityMin, 0.75), _num(M.scarcityMax, 1.6));
        return Math.max(1, p);
    },

    /** What the market pays for one head (`a`, or an adult in health) with `stock` there. */
    unitSellPrice(world, s, id, stock, target, a = null, tile = null) {
        const M = Livestock.config().market || {};
        let p = Livestock.unitPrice(world, s, id, stock, target, tile) * _num(M.sellShare, 0.65);
        if (a) {
            const sp = Livestock.species(id);
            if (Livestock.isYoung(a, sp)) p *= _num(M.young, 0.5);
            else if (Livestock.isOld(a, sp)) p *= _num(M.old, 0.6);
            if (a.sick) p *= _num(M.sick, 0.3);
        }
        return Math.max(1, p);
    },

    /**
     * The market of a settlement: [{ id, name, icon, stock, target, price,
     * sellPrice }] — sorted small beasts first. Empty where none is kept.
     */
    market(world, s, tile = null) {
        if (!s) return [];
        const { book, offer } = Livestock._book(world, s, tile);
        const out = [];
        for (const [id, target] of Object.entries(offer)) {
            const sp = Livestock.species(id);
            const stock = Math.floor(_num(book.stock[id]));
            out.push({
                id, name: sp.name, plural: sp.plural || sp.name, icon: sp.icon || '🐾', size: sp.size || 'medium', stock, target,
                price: Math.round(Livestock.unitPrice(world, s, id, stock, target, tile)),
                sellPrice: Math.round(Livestock.unitSellPrice(world, s, id, stock, target, null, tile)),
            });
        }
        return out.sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size) || a.price - b.price);
    },

    /** The cost of buying `n` head here (each dearer as the pens empty). */
    buyCost(world, s, id, n, tile = null) {
        const { book, offer } = Livestock._book(world, s, tile);
        const target = offer[id];
        if (target == null) return null;
        let stock = Math.floor(_num(book.stock[id]));
        let cost = 0;
        for (let i = 0; i < n; i++) cost += Livestock.unitPrice(world, s, id, stock - i - 1, target, tile);
        return Math.round(cost);
    },

    /** Drover's fee to drive `n` head of `id` from the town to a place `hexes` away. */
    droveFee(id, n, hexes) {
        const M = Livestock.config().market || {};
        const sp = Livestock.species(id) || {};
        return hexes > 0 ? Math.ceil(_num((M.droveFee || {})[sp.size || 'medium'], 0.4) * n * hexes) : 0;
    },

    /** Hexes from the town to a place. */
    _hexes(s, pl) {
        if (!s || !pl) return 0;
        return Hex.distance(s.q, s.r, pl.q, pl.r);
    },

    /**
     * Buy `n` head of `id` at the settlement's market, to keep at the place
     * `placeKey` (or, for a horse with o.ride, to ride away as your mount).
     * o.sex: 'f' / 'm' (otherwise females, with a male among them where the
     * herd has none of its kind). → { success, cost, fee, text } | { success: false, reason }
     */
    buy(world, player, s, id, n, placeKey, o = {}) {
        n = Math.max(1, Math.floor(_num(n, 1)));
        const sp = Livestock.species(id);
        if (!player || !s || !sp) return { success: false, reason: 'There is no such beast for sale here.' };
        const { book, offer } = Livestock._book(world, s, o.tile);
        if (offer[id] == null) return { success: false, reason: `${s.name || 'This town'} has no ${String(sp.plural || sp.name).toLowerCase()} for sale.` };
        const stock = Math.floor(_num(book.stock[id]));
        if (stock < n) return { success: false, reason: stock ? `Only ${stock} left in the pens.` : `The pens are empty of ${String(sp.plural || sp.name).toLowerCase()} — come back in a few days.` };
        const ride = !!o.ride && id === 'horse';
        if (ride && (player.mount || n !== 1)) return { success: false, reason: player.mount ? `You already ride ${player.mount.name}.` : 'You can ride only one horse.' };
        let pl = null;
        if (!ride) {
            pl = Livestock.placeOf(world, player, placeKey);
            const chk = Livestock.canKeep(world, player, pl, id, n);
            if (!chk.ok) return { success: false, reason: chk.reason };
        }
        const hexes = pl ? Livestock._hexes(s, pl) : 0;
        const M = Livestock.config().market || {};
        if (hexes > _num(M.droveMax, 12)) return { success: false, reason: `${pl.name} is too far for a drover (${hexes} hexes).` };
        const cost = Livestock.buyCost(world, s, id, n, o.tile);
        const fee = Livestock.droveFee(id, n, hexes);
        if (_num(player.gold) < cost + fee) return { success: false, reason: `${n} ${String(n === 1 ? sp.name : (sp.plural || sp.name)).toLowerCase()} cost ${cost}g${fee ? ` and ${fee}g to drive home` : ''}; you have ${Math.floor(_num(player.gold))}g.` };
        player.gold -= cost + fee;
        // the dealer's price and the drover's wage stay in the town
        _purse(s, cost + fee);
        Ledger.record(player, 'livestock', -cost);
        if (fee) Ledger.record(player, 'livestockFeed', -fee);
        book.stock[id] = _r2(_num(book.stock[id]) - n);
        const rng = _stream(`${_seed(world)}:lsBuy:${_day(world)}:${Livestock.state(player).seq}`);
        const age = () => Math.round(_num(sp.matureDays, 60) + rng() * _num(sp.lifespanDays, 1000) * 0.3);
        if (ride) {
            const names = ((Livestock.config().names || {}).horse) || ['Bramble'];
            const sex = o.sex === 'f' ? 'f' : 'm';
            player.mount = { name: names[Math.floor(rng() * names.length)], price: cost, acquiredDay: _day(world), fromHerd: true, sex, age: age() };
            return { success: true, cost, fee: 0, text: `You buy ${player.mount.name}, a ${sex === 'f' ? 'mare' : 'gelding'}, for ${cost}g, and ride away.` };
        }
        const herd = Livestock.herd(player, pl.key, pl.place);
        herd.place = { ...pl.place };
        const hasMale = herd.animals.some(a => a.sp === id && a.sex === 'm' && !Livestock.isYoung(a, sp));
        for (let i = 0; i < n; i++) {
            let sex = o.sex === 'm' || o.sex === 'f' ? o.sex : 'f';
            if (!o.sex && !hasMale && n >= 2 && i === 0) sex = 'm';
            Livestock._addHead(player, herd, id, sex, age());
        }
        const what = n === 1 ? `a ${o.sex === 'm' ? sp.maleName || sp.name : o.sex === 'f' ? sp.femaleName || sp.name : sp.name}`.toLowerCase() : `${n} ${String(sp.plural || sp.name).toLowerCase()}`;
        return {
            success: true, cost, fee, herdKey: pl.key,
            text: `You buy ${what} for ${cost}g${fee ? `, and pay a drover ${fee}g to bring them to ${pl.name}` : ` — kept at ${pl.name}`}.`,
        };
    },

    /** The herds a market can buy from: kept in its hex or one next to it. */
    herdsNear(world, player, s) {
        if (!s) return [];
        const near = (q, r) => (q === s.q && r === s.r) || Hex.distance(s.q, s.r, q, r) <= 1;
        return Livestock.state(player).herds.filter(h => h.animals.length && near(h.place.q, h.place.r));
    },

    /** Which `n` head of `id` go first from a herd: spare males, the old, the young, then the rest. */
    _pick(herd, id, n, o = {}) {
        const sp = Livestock.species(id);
        const list = herd.animals.filter(a => a.sp === id);
        const adultMales = list.filter(a => a.sex === 'm' && !Livestock.isYoung(a, sp));
        const keepMale = adultMales.length ? adultMales.reduce((b, a) => (a.age < b.age ? a : b)) : null;
        const rank = (a) => {
            if (o.youngLast && Livestock.isYoung(a, sp)) return 5;
            if (a.sex === 'm' && a !== keepMale && !Livestock.isYoung(a, sp)) return 0;
            if (Livestock.isOld(a, sp)) return 1;
            if (a.sick) return 2;
            if (a === keepMale) return 6;
            if (Livestock.isYoung(a, sp)) return o.youngFirst ? 1.5 : 4;
            return 3;
        };
        return list.slice().sort((a, b) => rank(a) - rank(b) || b.age - a.age).slice(0, n);
    },

    /** Sell `n` head of `id` from the herd `herdKey` to the market. */
    sell(world, player, s, herdKey, id, n = 1, o = {}) {
        n = Math.max(1, Math.floor(_num(n, 1)));
        const herd = Livestock.herd(player, herdKey);
        const sp = Livestock.species(id);
        if (!herd || !sp || !s) return { success: false, reason: 'No such beasts.' };
        if (!Livestock.herdsNear(world, player, s).includes(herd)) return { success: false, reason: 'They are kept too far from this market: sell them nearer home.' };
        const picks = Livestock._pick(herd, id, n);
        if (!picks.length) return { success: false, reason: `You keep no ${String(sp.plural || sp.name).toLowerCase()} there.` };
        const { book, offer } = Livestock._book(world, s, o.tile);
        const target = offer[id] != null ? offer[id] : Math.max(2, Math.round(_num((_obj(sp.market) || {}).stock && sp.market.stock[0], 3)));
        let stock = _num(book.stock[id], offer[id] != null ? target : 0);
        // paid out of the town's purse: no more than it holds
        const econ = _econ(s);
        const purse = econ ? Math.max(0, _num(econ.gold)) : Infinity;
        let earned = 0;
        const sold = [];
        for (const a of picks) {
            const p = Livestock.unitSellPrice(world, s, id, stock + 1, target, a, o.tile);
            if (Math.round(earned + p) > purse) break;
            earned += p;
            stock += 1;
            sold.push(a);
        }
        if (!sold.length) return { success: false, reason: `${s.name || 'The town'}'s dealers haven't the coin to buy today.` };
        picks.length = 0;
        picks.push(...sold);
        earned = Math.round(earned);
        _purse(s, -earned);
        book.stock[id] = _r2(stock);
        herd.animals = herd.animals.filter(a => !picks.includes(a));
        player.gold = _num(player.gold) + earned;
        Ledger.record(player, 'livestock', earned);
        const k = picks.length;
        return { success: true, earned, sold: k, text: `You sell ${k === 1 ? `a ${Livestock.headName(picks[0], sp)}` : `${k} ${String(sp.plural || sp.name).toLowerCase()}`} for ${earned}g.` };
    },

    // ── At the yard ───────────────────────────────────────

    /** What slaughtering one head gives: [{ good, qty, name }] (rolled on the given rng). */
    _slaughterYield(sp, a, rng) {
        const young = Livestock.isYoung(a, sp);
        const out = [];
        for (const e of sp.slaughter || []) {
            const [lo, hi] = _pair(e.qty, 1);
            let q = lo + Math.floor(rng() * (hi - lo + 1));
            if (young) q = Math.floor(q / 2);
            if (q > 0) out.push({ good: e.good, qty: q, name: e.name || Livestock.good(e.good).name });
        }
        return out;
    },

    /**
     * Slaughter a head at its yard (from the herds panel): its meat and hide
     * into your packs (the rest into the herd's store when they are full).
     * `which`: an animal id, or a species (the spare one goes first).
     */
    slaughter(world, player, herdKey, which) {
        const herd = Livestock.herd(player, herdKey);
        if (!herd) return { success: false, reason: 'No such herd.' };
        const a = herd.animals.find(x => x.id === which) || (Livestock.species(which) ? Livestock._pick(herd, which, 1, { youngLast: true })[0] : null);
        if (!a) return { success: false, reason: 'There is no such beast there.' };
        const sp = Livestock.species(a.sp);
        herd.animals = herd.animals.filter(x => x !== a);
        const rng = _stream(`${_seed(world)}:lsSlaughter:${_day(world)}:${a.id}`);
        const got = Livestock._slaughterYield(sp, a, rng);
        const kept = [], stored = [];
        for (const g of got) {
            if (PlayerInventory.addItem(player, g.good, g.qty).success) kept.push(g);
            else { herd.store[g.good] = _num(herd.store[g.good]) + g.qty; stored.push(g); }
        }
        const list = (xs) => xs.map(g => `${g.qty} ${g.name.toLowerCase()}`).join(', ');
        let text = `You slaughter a ${Livestock.headName(a, sp)}${kept.length ? `: ${list(kept)}` : ''}.`;
        if (stored.length) text += ` Your packs are full: ${list(stored)} kept in the yard's store.`;
        return { success: true, got, text };
    },

    /** A head killed on the inner map (the carcass is butchered there): gone from its herd. */
    removeHead(player, herdKey, animalId) {
        const herd = Livestock.herd(player, herdKey);
        if (!herd) return null;
        const a = herd.animals.find(x => x.id === animalId);
        if (a) herd.animals = herd.animals.filter(x => x !== a);
        return a || null;
    },

    /** Take a herd's store into your packs (what fits). → { success, taken: { good: qty }, text } */
    collect(world, player, herdKey) {
        const herd = Livestock.herd(player, herdKey);
        if (!herd) return { success: false, reason: 'No such herd.' };
        const taken = {};
        let full = false;
        for (const [good, qty] of Object.entries(herd.store || {})) {
            const n = Math.floor(_num(qty));
            if (n <= 0) { delete herd.store[good]; continue; }
            if (!PlayerInventory.addItem(player, good, n).success) { full = true; continue; }
            taken[good] = n;
            delete herd.store[good];
        }
        const parts = Object.entries(taken).map(([g, n]) => `${n} ${Livestock.good(g).name.toLowerCase()}`);
        if (!parts.length) return { success: false, reason: full ? PlayerInventory.fullMessage(player) : 'There is nothing in the store.' };
        return { success: true, taken, full, text: `You take ${parts.join(', ')}${full ? ' (your packs are full: the rest waits)' : ''}.` };
    },

    /** Saddle a horse from the herd as your mount. */
    ride(world, player, herdKey) {
        const herd = Livestock.herd(player, herdKey);
        if (!herd) return { success: false, reason: 'No such herd.' };
        if (player.mount) return { success: false, reason: `You already ride ${player.mount.name}.` };
        const sp = Livestock.species('horse');
        const a = herd.animals.filter(x => x.sp === 'horse' && !Livestock.isYoung(x, sp) && !x.sick)
            .sort((x, y) => (x.sex === 'm' ? 0 : 1) - (y.sex === 'm' ? 0 : 1) || x.age - y.age)[0];
        if (!a) return { success: false, reason: 'There is no grown, sound horse there to ride.' };
        herd.animals = herd.animals.filter(x => x !== a);
        const names = ((Livestock.config().names || {}).horse) || ['Bramble'];
        const name = a.name || names[_strHash(`${a.id}`) % names.length];
        player.mount = { name, price: Math.round(Livestock.baseValue('horse')), acquiredDay: _day(world), fromHerd: true, sex: a.sex, age: a.age };
        return { success: true, text: `You saddle ${name}, ${a.sex === 'f' ? 'a mare' : 'a stallion'} of your own breeding stock, and ride.` };
    },

    /** Put your mount out to a place that keeps horses (it joins the herd: it can breed). */
    stableMount(world, player, placeKey) {
        if (!player.mount) return { success: false, reason: 'You have no horse to stable.' };
        const pl = Livestock.placeOf(world, player, placeKey);
        const chk = Livestock.canKeep(world, player, pl, 'horse', 1);
        if (!chk.ok) return { success: false, reason: chk.reason };
        const m = player.mount;
        const herd = Livestock.herd(player, pl.key, pl.place);
        const sp = Livestock.species('horse');
        Livestock._addHead(player, herd, 'horse', m.sex === 'f' ? 'f' : 'm', _num(m.age, _num(sp.matureDays, 360) + 200), { name: m.name });
        player.mount = null;
        return { success: true, text: `You turn ${m.name} out at ${pl.name}. Saddle a horse there to ride again.` };
    },

    // ── What the herds give the properties ────────────────

    /**
     * A livestock property's output against its working herd (Pasture,
     * Dairy, Cattle Ranch, Horse Ranch): its working head (weighted; young
     * half, sick little) over its target, at most works.maxFactor. 1 until
     * its founding herd is in (so a property yields what it always did).
     */
    workFactor(world, player, tile, property) {
        if (!property || !tile) return 1;
        const P = Livestock.config().places || {};
        const cfg = _obj((P.properties || {})[property.type]);
        const works = cfg && _obj(cfg.works);
        if (!works || !property.herdFounded) return 1;
        const herd = Livestock.herd(player, Livestock.placeKey({ kind: 'property', q: tile.q, r: tile.r, type: property.type }));
        const units = Livestock._workUnits(herd, works);
        return _clamp(units / Math.max(1, _num(works.target, 10)), 0, _num(works.maxFactor, 1.4));
    },

    _workUnits(herd, works) {
        let units = 0;
        for (const a of (herd && herd.animals) || []) {
            const w = _num((works.species || {})[a.sp], 0);
            if (!w) continue;
            const sp = Livestock.species(a.sp);
            units += w * (Livestock.isYoung(a, sp) ? 0.5 : 1) * (a.sick ? 0.3 : 1) * (herd.hungry > 0 ? 0.5 : 1);
        }
        return units;
    },

    /** A farm's harvest lift from its horses at the plough and its pigs' and cattle's muck (1 + share, at most draftMax). */
    draftFactor(world, player, tile, property) {
        if (!property || !tile) return 1;
        const P = Livestock.config().places || {};
        const cfg = _obj((P.properties || {})[property.type]);
        if (!cfg || !cfg.draft) return 1;
        const herd = Livestock.herd(player, Livestock.placeKey({ kind: 'property', q: tile.q, r: tile.r, type: property.type }));
        if (!herd) return 1;
        let lift = 0;
        for (const a of herd.animals) {
            const sp = Livestock.species(a.sp);
            if (!sp || Livestock.isYoung(a, sp)) continue;
            lift += _num(sp.draft) + _num(sp.manure);
        }
        return 1 + Math.min(_num(P.draftMax, 0.2), lift);
    },

    /** Give each livestock property its founding herd (once; built, or from an older save). */
    _found(world, player, notices) {
        for (const pl of Livestock.places(world, player)) {
            if (pl.place.kind !== 'property' || !pl.works || pl.building) continue;
            const got = Livestock._propertyOf(world, player, pl.place);
            if (!got || got.prop.herdFounded) continue;
            const works = pl.works;
            const id = works.found || Object.keys(works.species || {})[0];
            const sp = Livestock.species(id);
            if (!sp) continue;
            const herd = Livestock.herd(player, pl.key, pl.place);
            const n = Math.max(1, Math.round(_num(works.target, 10)));
            const males = Math.max(1, Math.round(n / 8));
            for (let i = 0; i < n; i++) {
                const age = Math.round(_num(sp.matureDays, 60) + Utils.random() * _num(sp.lifespanDays, 1000) * 0.4);
                Livestock._addHead(player, herd, id, i < males ? 'm' : 'f', age);
            }
            got.prop.herdFounded = true;
            notices.push({ icon: sp.icon || '🐾', title: 'A Founding Herd', text: `${n} ${String(sp.plural || sp.name).toLowerCase()} are turned out at ${pl.name}: its output rises and falls with them. Keep the head up, sell the surplus.`, type: 'info' });
        }
    },

    // ── The day ───────────────────────────────────────────

    /** The share of a head's fodder bought today at this place. */
    _feedShare(pl, sp, season) {
        const P = Livestock.config().places || {};
        let share = 1;
        if (pl.grazing) share = _num((P.feedShare || {})[season], season === 'Winter' ? 1 : 0);
        if (sp.hardy && season === 'Winter') share *= _num(P.hardyWinter, 0.6);
        // Small beasts and pigs scratch a living in a town yard
        if (!pl.grazing && sp.scrounges) share *= 1 - _num(sp.scrounges);
        return share;
    },

    /** Today's fodder bill for a herd (the working head a livestock property feeds out of its upkeep). */
    feedCost(world, herd, pl) {
        if (!herd || !pl) return 0;
        const season = _season(world);
        let covered = pl.works ? Math.max(0, Math.round(_num(pl.works.target))) : 0;
        let cost = 0;
        for (const a of herd.animals) {
            const sp = Livestock.species(a.sp);
            if (!sp) continue;
            if (covered > 0 && pl.works && _num((pl.works.species || {})[a.sp]) > 0) { covered--; continue; }
            cost += _num(sp.feed, 0.1) * Livestock._feedShare(pl, sp, season) * (Livestock.isYoung(a, sp) ? 0.5 : 1);
        }
        return _r2(cost);
    },

    /**
     * The day of every herd: places lost (the beasts sold off), fodder,
     * hunger and health, products, births, ageing and death, predators.
     * → { notices: [{ icon, title, text, type }] }
     */
    processDay(world, player) {
        const notices = [];
        if (!player || !world) return { notices };
        const st = Livestock.state(player);
        const day = _day(world);
        if (st.lastDay === day) return { notices };
        st.lastDay = day;
        const PP = (Livestock.config().places || {}).properties || {};
        const anyWorks = (player.properties || []).some(p => p && _obj(PP[p.type]) && PP[p.type].works);
        if (!st.herds.length && !anyWorks) return { notices };
        const rng = _stream(`${_seed(world)}:livestock:${day}`);
        Utils.withRng(rng, () => {
            Livestock._found(world, player, notices);
            const places = new Map(Livestock.places(world, player).map(pl => [pl.key, pl]));
            for (const herd of st.herds.slice()) {
                const pl = places.get(herd.key);
                if (!pl) { Livestock._orphaned(world, player, herd, notices); continue; }
                Livestock._herdDay(world, player, herd, pl, notices);
            }
            st.herds = st.herds.filter(h => h.animals.length || Object.keys(h.store || {}).some(k => _num(h.store[k]) > 0));
        });
        return { notices };
    },

    /** A place lost (sold, given up, taken): its beasts are sold off at the nearest market's price. */
    _orphaned(world, player, herd, notices) {
        const M = Livestock.config().market || {};
        let value = 0;
        for (const a of herd.animals) {
            const sp = Livestock.species(a.sp);
            value += Livestock.baseValue(a.sp) * _num(M.sellShare, 0.65) * (Livestock.isYoung(a, sp) ? _num(M.young, 0.5) : 1);
        }
        const n = herd.animals.length;
        // bought by the nearest town's dealers, out of its purse
        const town = n ? _townNear(world, herd.place && herd.place.q, herd.place && herd.place.r) : null;
        const e = _econ(town);
        value = Math.round(e ? Math.min(value, Math.max(0, _num(e.gold))) : value);
        if (n) {
            _purse(town, -value);
            player.gold = _num(player.gold) + value;
            Ledger.record(player, 'livestock', value);
            notices.push({ icon: '🐾', title: 'Beasts Sold Off', text: `With nowhere left to keep them, your ${n} beast${n === 1 ? '' : 's'} were sold off for ${value}g.`, type: 'warning' });
        }
        Livestock.state(player).herds = Livestock.state(player).herds.filter(h => h !== herd);
    },

    _herdDay(world, player, herd, pl, notices) {
        const H = Livestock.config().health || {};
        const P = Livestock.config().places || {};
        const season = _season(world);
        if (!_obj(herd.store)) herd.store = {};
        if (!_obj(herd.carry)) herd.carry = {};
        const name = pl.name;
        const deaths = [];
        // Fodder: bought, or they go hungry
        const cost = Livestock.feedCost(world, herd, pl);
        if (cost > 0) {
            const whole = Math.ceil(cost * 100) / 100;
            // Fodder is real: hay and grain out of the nearest town's store, the coin into its purse
            const town = _townNear(world, pl.q, pl.r);
            const te = _econ(town);
            const food = whole * _num((Livestock.config().fodder || {}).foodPerGold, 0.5);
            const stocked = !te || te.food == null || _num(te.food) >= food;
            if (_num(player.gold) >= whole && stocked) {
                player.gold -= whole;
                if (te) {
                    _purse(town, whole);
                    if (te.food != null) te.food = _r2(Math.max(0, _num(te.food) - food));
                }
                Ledger.record(player, 'livestockFeed', -whole);
                herd.hungry = 0;
            } else {
                herd.hungry = _num(herd.hungry) + 1;
                const why = stocked ? `You cannot pay for fodder at ${name} (${whole}g a day)` : `${town.name || 'The town'} has no fodder to spare for ${name}`;
                if (herd.hungry === 1 || herd.hungry % 5 === 0) notices.push({ icon: '🌾', title: 'Hungry Beasts', text: `${why}: your beasts go hungry and give nothing.`, type: 'error' });
            }
        } else herd.hungry = 0;
        const hungry = herd.hungry > 0;
        // Health: hunger, sickness and its spread, old age
        const over = Math.max(0, Livestock.used(herd) / Math.max(1, pl.capacity) - 1);
        const sickNow = herd.animals.filter(a => a.sick).length;
        if (herd.animals.length && Utils.random() < _num(H.illness, 0.004) * (1 + _num(H.crowding, 3) * over) * Math.sqrt(herd.animals.length)) {
            const well = herd.animals.filter(a => !a.sick);
            if (well.length) {
                const a = well[Math.floor(Utils.random() * well.length)];
                const [lo, hi] = _pair(H.sickDays, 8);
                a.sick = lo + Math.floor(Utils.random() * (hi - lo + 1));
                notices.push({ icon: '🤒', title: 'A Sick Beast', text: `A ${Livestock.headName(a)} at ${name} has fallen sick. Kept close, it may spread.`, type: 'warning' });
            }
        }
        for (let i = 0; i < sickNow; i++) {
            if (Utils.random() >= _num(H.spread, 0.15) * (1 + over)) continue;
            const well = herd.animals.filter(a => !a.sick);
            if (!well.length) break;
            const a = well[Math.floor(Utils.random() * well.length)];
            const [lo, hi] = _pair(H.sickDays, 8);
            a.sick = lo + Math.floor(Utils.random() * (hi - lo + 1));
        }
        for (const a of herd.animals) {
            const sp = Livestock.species(a.sp);
            if (!sp) continue;
            a.age = _num(a.age) + 1;
            if (a.rest > 0) a.rest -= 1;
            if (hungry) a.hp = _num(a.hp, 100) - _num(H.hungerLoss, 12);
            else if (!a.sick) a.hp = Math.min(100, _num(a.hp, 100) + _num(H.recover, 5));
            if (a.sick) {
                if (Utils.random() < _num(H.deathPerDay, 0.04)) { deaths.push([a, 'sickness']); continue; }
                a.sick -= 1;
                if (a.sick <= 0) delete a.sick;
            }
            if (a.hp <= 0) { deaths.push([a, 'hunger']); continue; }
            if (a.age > _num(sp.lifespanDays, 1000) && Utils.random() < _num(H.oldDeath, 0.02)) deaths.push([a, 'old age']);
        }
        // Predators: the hex's wolves, foxes and bears, where the place is out of town
        const t = _tile(world, pl.q, pl.r);
        if (t && !t.settlement && t.terrain && herd.animals.length) {
            const animals = (DataLoader.get && DataLoader.get('animals')) || {};
            const groups = [].concat((animals.terrain || {})[t.terrain.id] || []);
            for (const pr of H.predators || []) {
                const g = groups.find(x => x && x.herd === pr.herd);
                if (!g || Utils.random() >= _num(g.chance) * _num(pr.rate)) continue;
                const prey = herd.animals.filter(a => (pr.takes || []).includes((Livestock.species(a.sp) || {}).size) && !deaths.some(d => d[0] === a));
                if (!prey.length) continue;
                const young = prey.filter(a => Livestock.isYoung(a));
                const pool = young.length ? young : prey;
                const a = pool[Math.floor(Utils.random() * pool.length)];
                deaths.push([a, 'predator']);
                notices.push({ icon: '🐺', title: 'Taken in the Night', text: `${pr.verb || 'Something took'} a ${Livestock.headName(a)} from ${name}.`, type: 'warning' });
            }
        }
        if (deaths.length) {
            const dead = new Set(deaths.map(d => d[0]));
            herd.animals = herd.animals.filter(a => !dead.has(a));
            const why = deaths.filter(d => d[1] !== 'predator');
            if (why.length) {
                const by = {};
                for (const [a, w] of why) by[w] = (by[w] || 0) + 1;
                const parts = Object.entries(by).map(([w, n]) => `${n} of ${w}`);
                notices.push({ icon: '🪦', title: 'Beasts Lost', text: `At ${name}: ${why.length === 1 ? `a ${Livestock.headName(why[0][0])} died of ${why[0][1]}` : `${why.length} died — ${parts.join(', ')}`}.`, type: 'warning' });
            }
        }
        // Products: eggs, milk, feathers, wool (a livestock property's working beasts work for it instead)
        if (!hungry) {
            const cap = _num(P.storeCap, 80);
            let held = Object.values(herd.store).reduce((s, v) => s + _num(v), 0);
            const made = {};
            for (const a of herd.animals) {
                const sp = Livestock.species(a.sp);
                if (!sp || a.sick || Livestock.isYoung(a, sp)) continue;
                if (pl.works && _num((pl.works.species || {})[a.sp]) > 0) continue;
                for (const pr of sp.products || []) {
                    if (pr.femaleOnly && a.sex !== 'f') continue;
                    made[pr.good] = _num(made[pr.good]) + _num(pr.perDay) * _num((pr.seasons || {})[season], 1);
                }
            }
            for (const [good, amt] of Object.entries(made)) {
                const total = amt + _num(herd.carry[good]);
                const whole = Math.floor(total);
                herd.carry[good] = _r2(total - whole);
                const room = Math.max(0, cap - held);
                const put = Math.min(whole, room);
                if (put > 0) { herd.store[good] = _num(herd.store[good]) + put; held += put; }
            }
        }
        // Births: a female in season, a male of her kind kept with her, room in the yard
        const born = {};
        for (const a of herd.animals.slice()) {
            const sp = Livestock.species(a.sp);
            const b = sp && _obj(sp.breeding);
            if (!b || a.sex !== 'f' || a.sick || hungry || Livestock.isYoung(a, sp) || a.rest > 0) continue;
            if (Array.isArray(b.seasons) && !b.seasons.includes(season)) continue;
            if (!herd.animals.some(m => m.sp === a.sp && m.sex === 'm' && !Livestock.isYoung(m, sp))) continue;
            if (Utils.random() >= _num(b.chance, 0.03)) continue;
            const [lo, hi] = _pair(b.young, 1);
            const room = Math.floor((pl.capacity - Livestock.used(herd)) / Livestock.space(a.sp));
            const n = Math.min(room, lo + Math.floor(Utils.random() * (hi - lo + 1)));
            a.rest = _num(b.restDays, 60);
            if (n <= 0) continue;
            for (let i = 0; i < n; i++) Livestock._addHead(player, herd, a.sp, Utils.random() < _num(b.femaleShare, 0.5) ? 'f' : 'm', 0);
            born[a.sp] = _num(born[a.sp]) + n;
        }
        for (const [id, n] of Object.entries(born)) {
            const sp = Livestock.species(id);
            notices.push({ icon: sp.icon || '🐣', title: 'Born in the Yard', text: `${n} ${Livestock.plural(sp.youngName || 'young', n)} born at ${name}.`, type: 'success' });
        }
    },

    // ── For the panels and the map ────────────────────────

    /** A herd's head counts by species: { id: { adultsF, adultsM, young, sick, total } }. */
    counts(herd) {
        const out = {};
        for (const a of (herd && herd.animals) || []) {
            const sp = Livestock.species(a.sp);
            const c = out[a.sp] || (out[a.sp] = { adultsF: 0, adultsM: 0, young: 0, sick: 0, total: 0 });
            c.total++;
            if (a.sick) c.sick++;
            if (Livestock.isYoung(a, sp)) c.young++;
            else if (a.sex === 'm') c.adultsM++;
            else c.adultsF++;
        }
        return out;
    },

    /** Every herd with its place, room, fodder, store and the property it works for. */
    view(world, player) {
        const places = new Map(Livestock.places(world, player).map(pl => [pl.key, pl]));
        const out = [];
        for (const herd of Livestock.state(player).herds) {
            const pl = places.get(herd.key);
            if (!pl) continue;
            const got = pl.place.kind === 'property' ? Livestock._propertyOf(world, player, pl.place) : null;
            out.push({
                key: herd.key, pl, name: pl.name, q: pl.q, r: pl.r, herd,
                counts: Livestock.counts(herd), used: Livestock.used(herd), capacity: pl.capacity,
                feed: Livestock.feedCost(world, herd, pl), hungry: _num(herd.hungry),
                store: { ...(herd.store || {}) },
                works: pl.works ? { factor: got ? Livestock.workFactor(world, player, got.tile, got.prop) : 1, target: _num(pl.works.target), produces: got ? got.prop.produces : null } : null,
                draft: pl.draft && got ? Livestock.draftFactor(world, player, got.tile, got.prop) : null,
            });
        }
        return out;
    },

    /** Goods waiting in the herds' stores at hex (q, r): { good: qty }. */
    storeAt(player, q, r) {
        const out = {};
        for (const h of Livestock.state(player).herds) {
            if (!h.place || h.place.q !== q || h.place.r !== r) continue;
            for (const [g, n] of Object.entries(h.store || {})) if (_num(n) > 0) out[g] = _num(out[g]) + _num(n);
        }
        return out;
    },

    /** Collect every herd store at hex (q, r). */
    collectAt(world, player, q, r) {
        const taken = {};
        let full = false;
        for (const h of Livestock.state(player).herds) {
            if (!h.place || h.place.q !== q || h.place.r !== r) continue;
            const res = Livestock.collect(world, player, h.key);
            if (res.success) for (const [g, n] of Object.entries(res.taken)) taken[g] = _num(taken[g]) + n;
            if (res.full || (!res.success && /full|room|slot/i.test(res.reason || ''))) full = true;
        }
        return { taken, full };
    },

    /**
     * The beasts to stand on the inner map of hex (q, r): at most map.maxShown
     * of each herd (each species in its share). [{ id, animalId, herdKey,
     * species, sex, young, place, placeName }]
     */
    mapEntries(world, player, q, r) {
        const out = [];
        const max = Math.max(1, _num((Livestock.config().map || {}).maxShown, 10));
        const places = new Map(Livestock.places(world, player).map(pl => [pl.key, pl]));
        for (const herd of Livestock.state(player).herds) {
            if (!herd.place || herd.place.q !== q || herd.place.r !== r || !herd.animals.length) continue;
            const pl = places.get(herd.key);
            if (!pl) continue;
            const by = {};
            for (const a of herd.animals) (by[a.sp] || (by[a.sp] = [])).push(a);
            const total = herd.animals.length;
            for (const [, list] of Object.entries(by)) {
                const n = Math.max(1, Math.round(list.length / total * Math.min(max, total)));
                for (const a of list.slice(0, n)) {
                    out.push({ id: `own:${a.id}`, animalId: a.id, herdKey: herd.key, species: a.sp, sex: a.sex, young: Livestock.isYoung(a), place: herd.place, placeName: pl.name });
                }
            }
        }
        return out;
    },
};
