// ============================================
// BURIALS — the dead the player lays in the ground off the churchyard
// ============================================
// A body buried on the street map (ui/innerMapDigging.js) is a plain mound of
// turned earth: no name, no marker, and over the days it settles back into
// the ground until it can hardly be seen (data/digging.json `burial`). The
// record stays: it can still be dug up, and a marker can still be raised.
//
// Raise a marker on it — a wooden cross, a headstone, a carved headstone, the
// kinds the churchyards raise (world/graveBook.js markers, drawn with the
// grave art of world/graveArt.js) — and it is a grave like a churchyard one:
// named, read, its marker weathering as the years go (GraveBook.markerNow).
// A marker comes from somewhere: one carried in the pack (bought at a market:
// grave_cross, headstone, carved_headstone, made by the towns' grave carvers
// and masons, data/markets.json), or a cross carved on the spot from wood or
// planks carried.
//
// Each burial is kept on world.burials[hexKey]['q,r'] (saved with the world):
//
//   { kind: 'grave', name, body, day, died, born, pid, marker, markedDay, head }
//
// `body` is the plain body (what ui/innerMapCombat.js restores on exhuming);
// `head`: the marker stands as an object on the tile above (as a churchyard
// grave: marker at the head, mound below) — else it is drawn on the mound.
// The same object is the tile's `_dug` while the map is up, so the map and
// the record never disagree; world/innerMap/graves.js lays it on entry.
//
// A grave's life (the same for these and, in systems/graveyards.js, the
// churchyard's): intact → OPEN (dug up or robbed: `open` the day, the earth
// thrown up beside it, the body still lying in it until taken, the grave
// goods out, the marker still standing — knocked `askew` by a robber) →
// REFILLED (`disturbed` the day: the earth fresh over it again for a while).
// A marker comes off only when pulled up on purpose (`takeMarker`); an open
// grave is still the grave — never a hole to dig again.
//
// Things put in the ground (a hole filled in over them, or laid in a grave
// with its dead) are kept too:
//
//   world.caches[hexKey]['q,r'] = { kind: 'cache', items: { id: n }, gold,
//                                   day, open, seen: [{ id, name }], taken }
//   a burial's `goods` = { items, gold } — its grave goods.
//
// A cache comes back to whoever digs that spot; anyone who watched it buried
// may come back for it, and now and then someone turns it up by chance
// (processDay: a hash of the day, never the shared RNG).
//
// Pure data and arithmetic: no RNG, no globals (world, player, day passed in).

import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { GraveBook } from './graveBook.js';

const DEFAULTS = {
    settleDays: 360,
    minAlpha: 0.12,
    markers: {
        cross_wood: { item: 'grave_cross', carve: [{ planks: 1 }, { wood: 1 }], seconds: 3, carveSeconds: 10 },
        headstone_plain: { item: 'headstone', seconds: 4 },
        headstone_carved: { item: 'carved_headstone', seconds: 4 },
    },
    // How dug ground goes: a hole left open caves in and is turned earth after
    // holeCaveDays; turned earth fades back into the ground after filledFadeDays
    ground: { holeCaveDays: 20, filledFadeDays: 40 },
    // A grave opened and filled in again shows its disturbed earth for disturbedDays;
    // in a town the sexton fills in a grave left open after refillDays
    disturbedDays: 60,
    refillDays: 3,
    cache: { witnessDays: 1, witnessChance: 0.25, strayTown: 0.002, strayWild: 0.0005, maxSeen: 3 },
    text: {},
};

/** The ground a dig leaves on a street-map tile (ui/innerMapDigging.js setGround). */
export const DUG_GROUND = {
    hole: { id: 'dug_hole', name: 'Hole', icon: '🕳️', color: '#3b2a1c', passable: false },
    filled: { id: 'turned_earth', name: 'Turned Earth', icon: '⬛', color: '#6b5034', passable: true },
    grave: { id: 'grave', name: 'Burial Mound', icon: '⚰️', color: '#6b5034', passable: true },
};

/** A well-mixed hash of a string, in [0, 1) (the caches' chances: no shared RNG). */
function _frac(str) {
    const t = String(str);
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
        h ^= t.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** The '{q},{r}' key of a tile. */
export const burialKey = (q, r) => `${q},${r}`;

export const Burials = {
    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.digging) || {};
        const b = _obj(d.burial) || {};
        return {
            ...DEFAULTS,
            ...b,
            markers: { ...DEFAULTS.markers, ...(_obj(b.markers) || {}) },
            ground: { ...DEFAULTS.ground, ...(_obj(d.ground) || {}) },
            cache: { ...DEFAULTS.cache, ...(_obj(d.cache) || {}) },
            text: { ...DEFAULTS.text, ...(_obj(b.text) || {}) },
        };
    },

    // ── The record ─────────────────────────────

    /** The burials on a hex's map (world.burials[hexKey]), made when asked. */
    record(world, hexKey, create = false) {
        if (!world || !hexKey) return null;
        if (!_obj(world.burials)) {
            if (!create) return null;
            world.burials = {};
        }
        if (!_obj(world.burials[hexKey]) && create) world.burials[hexKey] = {};
        return world.burials[hexKey] || null;
    },

    /** The burial at (q, r) of a hex's map, or null. */
    at(world, hexKey, q, r) {
        const rec = Burials.record(world, hexKey);
        return (rec && rec[burialKey(q, r)]) || null;
    },

    /** A body as plain data: no live NPC, nothing that won't save. */
    plainBody(body) {
        if (!body) return { name: 'someone', type: 'villager', preset: null };
        const out = { name: body.name || 'someone', type: body.type || 'villager', icon: body.icon || null, preset: body.preset || null, side: body.side || 1 };
        const p = body._npc && body._npc._person;
        if (p && p.id != null) out.pid = p.id;
        if (p && p.born != null) out.born = p.born;
        if (body.pid != null) out.pid = body.pid;
        if (body.born != null) out.born = body.born;
        try { out.preset = out.preset ? JSON.parse(JSON.stringify(out.preset)) : null; } catch { out.preset = null; }
        return out;
    },

    /**
     * Lay a body in the ground at (q, r): an unmarked mound. A townsperson
     * buried so is in the town's book as buried (the parish won't bury them again).
     */
    bury(world, hexKey, q, r, body, day, settlement = null, goods = null) {
        const rec = Burials.record(world, hexKey, true);
        if (!rec) return null;
        const b = Burials.plainBody(body);
        const g = {
            kind: 'grave', name: b.name, body: b, day: _num(day),
            died: _num(body && body.day, _num(day)), born: b.born != null ? b.born : null, pid: b.pid != null ? b.pid : null,
            marker: null, markedDay: null, head: false,
        };
        // (what was in the hole goes in with them: grave goods)
        if (goods && !Burials.isEmpty(goods)) g.goods = Burials.contents(goods);
        rec[burialKey(q, r)] = g;
        if (settlement && g.pid != null) {
            const book = GraveBook.of(settlement);
            if (book) book.buried[g.pid] = 'player';
        }
        return g;
    },

    /** Take the burial at (q, r) off the record (dug up): it, or null. */
    unbury(world, hexKey, q, r) {
        const rec = Burials.record(world, hexKey);
        const k = burialKey(q, r);
        const g = rec ? rec[k] : null;
        if (!g) return null;
        delete rec[k];
        if (!Object.keys(rec).length) delete world.burials[hexKey];
        return g;
    },

    // ── The marker ─────────────────────────────

    /** The marker standing over a burial today (weathered as a churchyard one), or null: unmarked. */
    markerNow(g, day) {
        if (!g || !g.marker) return null;
        const m = GraveBook.markerNow({ marker: g.marker, died: _num(g.markedDay, _num(g.day)), until: null }, day);
        return m && m !== 'grave_mound' && m !== 'grave_open' ? m : null;
    },

    /** Can anyone tell who lies here? */
    isLegible(g, day) {
        const m = Burials.markerNow(g, day);
        return !!m && m !== 'headstone_broken';
    },

    /** Can a marker go on it? A burial with none standing (never raised, or rotted away). */
    canMark(g, day) {
        return !!g && g.kind === 'grave' && g.open == null && !Burials.markerNow(g, day);
    },

    /**
     * The markers the player could raise, as they stand: [{ marker, name,
     * how: 'item'|'carve', item?, cost?, seconds }] — one from the pack, or a
     * cross carved from what is carried.
     */
    markerOptions(player) {
        const C = Burials.config();
        const inv = (player && player.inventory) || {};
        const out = [];
        for (const [marker, def] of Object.entries(C.markers)) {
            if (!_obj(def)) continue;
            const name = (GraveBook.markerDef(marker) || {}).name || marker;
            if (def.item && _num(inv[def.item]) >= 1) {
                out.push({ marker, name, how: 'item', item: def.item, seconds: _num(def.seconds, 3) });
            }
            for (const cost of Array.isArray(def.carve) ? def.carve : []) {
                if (!_obj(cost)) continue;
                if (Object.entries(cost).every(([id, n]) => _num(inv[id]) >= _num(n))) {
                    out.push({ marker, name, how: 'carve', cost: { ...cost }, seconds: _num(def.carveSeconds, 10) });
                    break;
                }
            }
        }
        return out;
    },

    /**
     * Raise a marker on the burial at (q, r): the item (or the carving's
     * wood) comes out of the pack. head: whether it stands on the tile above.
     * Returns { success, text|reason, grave }.
     */
    placeMarker(world, player, hexKey, q, r, choice, day, head = false) {
        const g = Burials.at(world, hexKey, q, r);
        const T = Burials.config().text;
        if (!g) return { success: false, reason: 'No one is buried there.' };
        if (g.open != null) return { success: false, reason: T.openNoMarker || 'Fill the grave in first.' };
        if (!Burials.canMark(g, day)) return { success: false, reason: T.alreadyMarked || 'A marker already stands there.' };
        const def = choice && Burials.config().markers[choice.marker];
        if (!def || !GraveBook.markerDef(choice.marker)) return { success: false, reason: 'That is no grave marker.' };
        const inv = player && player.inventory;
        if (!inv) return { success: false, reason: 'You have nothing to raise.' };
        const take = (id, n) => {
            inv[id] = _num(inv[id]) - n;
            if (inv[id] <= 1e-9) delete inv[id];
        };
        if (choice.how === 'item') {
            if (!def.item || _num(inv[def.item]) < 1) return { success: false, reason: 'You have no such marker with you.' };
            take(def.item, 1);
        } else if (choice.how === 'carve') {
            const cost = _obj(choice.cost);
            const allowed = (Array.isArray(def.carve) ? def.carve : []).some(c => _obj(c) && cost && JSON.stringify(c) === JSON.stringify(cost));
            if (!allowed || !Object.entries(cost).every(([id, n]) => _num(inv[id]) >= _num(n))) return { success: false, reason: 'You haven\'t the wood to carve it from.' };
            for (const [id, n] of Object.entries(cost)) take(id, _num(n));
        } else {
            return { success: false, reason: 'That is no grave marker.' };
        }
        g.marker = choice.marker;
        g.markedDay = _num(day);
        g.head = !!head;
        const name = (GraveBook.markerDef(choice.marker) || {}).name || 'a marker';
        const line = choice.how === 'carve' ? T.carved || 'You carve a {marker} and set it over {name}.' : T.marked || 'You raise a {marker} over {name}.';
        return { success: true, grave: g, text: line.replace('{marker}', name.toLowerCase()).replace('{name}', g.name) };
    },

    /** The marker comes off a grave (dug up): the item it is, back to the pack (null if none stood). */
    takeMarker(g, player, day) {
        if (!g || !Burials.markerNow(g, day)) return null;
        const def = Burials.config().markers[g.marker];
        const item = def && def.item;
        g.marker = null;
        g.markedDay = null;
        g.head = false;
        g.askew = false;
        if (item && player && player.inventory) player.inventory[item] = _num(player.inventory[item]) + 1;
        return item || null;
    },

    // ── How it looks and reads ─────────────────

    /** How far an unmarked mound has settled: 0 fresh … 1 level with the ground. */
    settled(g, day) {
        if (!g) return 1;
        if (g.open != null) return 0;
        const n = Math.max(1, _num(Burials.config().settleDays, 360));
        return Math.max(0, Math.min(1, (_num(day) - Burials.turnedDay(g)) / n));
    },

    /** The day its earth was last turned: the burial, or the day it was filled in again. */
    turnedDay(g) {
        return Math.max(_num(g && g.day), _num(g && g.disturbed, -Infinity));
    },

    /** Is its earth fresh (dark, bare, turned) today? A new burial, or one disturbed and filled in again. */
    isFresh(g, day) {
        if (!g || g.open != null) return false;
        const C = Burials.config();
        const fresh = _num(C.freshDays, 30);
        if (g.disturbed != null && _num(day) - _num(g.disturbed) < Math.max(fresh, _num(C.disturbedDays, 60))) return true;
        return !g.marker && _num(day) - _num(g.day) < fresh;
    },

    /** Has an unmarked mound settled level, the ground grown back over it? */
    overgrown(g, day) {
        return !!g && g.open == null && !Burials.markerNow(g, day) && Burials.settled(g, day) >= 1;
    },

    /** How strongly the mound is drawn (1 fresh, down to minAlpha as it settles). */
    moundAlpha(g, day) {
        const min = Math.max(0, Math.min(1, _num(Burials.config().minAlpha, 0.12)));
        return 1 - (1 - min) * Burials.settled(g, day);
    },

    /** What it's called to anyone looking. */
    label(g, day) {
        if (!g) return '';
        if (g.open != null) {
            if (!g.body) return Burials.isLegible(g, day) ? `Empty Grave of ${g.name}` : 'An Empty Grave';
            return Burials.isLegible(g, day) ? `Open Grave of ${g.name}` : 'An Open Grave';
        }
        if (Burials.isLegible(g, day)) return `Grave of ${g.name}`;
        if (Burials.markerNow(g, day)) return 'An Old Grave';
        return Burials.settled(g, day) >= 0.75 ? 'Sunken Earth' : 'Burial Mound';
    },

    /** Reading a marked grave: its lines, as a churchyard grave reads. */
    readLines(g, world, day) {
        if (!Burials.isLegible(g, day)) return [GraveBook.config().text.unmarked || 'Its marker is long gone.'];
        const lines = [GraveBook.epitaph({ name: g.name, born: g.born, died: _num(g.died, _num(g.day)) }, world)];
        const years = GraveBook.yearsBetween(g.day, day);
        lines.push(years ? `${years} year${years === 1 ? '' : 's'} in the ground.` : 'Buried this year.');
        lines.push('Laid here by your hand.');
        if (g.open != null) lines.push(g.body ? 'The grave lies open, the earth heaped beside it.' : 'The grave lies open and empty.');
        else if (g.disturbed != null && _num(day) - _num(g.disturbed) < _num(Burials.config().disturbedDays, 60)) lines.push('The earth over it has been dug and put back.');
        if (g.askew) lines.push('Its marker has been knocked askew.');
        return lines;
    },

    // ── A grave's life: open, emptied, filled in again ─────────────────

    /** Is it dug open? */
    isOpen(g) {
        return !!g && g.open != null;
    },

    /**
     * Dig a grave open (exhumed or robbed): the earth up beside it, the body
     * still lying in it, the marker left standing (knocked askew when robbed).
     * Returns its grave goods, taken off it ({ items, gold }, or null).
     */
    openGrave(g, day, robbed = false) {
        if (!g || g.open != null) return null;
        g.open = _num(day);
        if (robbed) {
            g.robbed = _num(day);
            if (g.marker) g.askew = true;
        }
        const goods = g.goods && !Burials.isEmpty(g.goods) ? g.goods : null;
        delete g.goods;
        return goods;
    },

    /** Fill an open grave in again: intact, its earth disturbed (fresh) for a while. */
    refillGrave(g, day, straighten = true) {
        if (!g || g.open == null) return false;
        g.open = null;
        g.disturbed = _num(day);
        if (straighten) g.askew = false;
        return true;
    },

    /** Lift the body out of an open grave: its plain body, the grave left empty. */
    takeBody(g) {
        if (!g || g.open == null || !g.body) return null;
        const b = g.body;
        g.body = null;
        return b;
    },

    /** Lay a body in an open, empty grave (another's, or the same one put back). */
    layBody(g, body, day) {
        if (!g || g.open == null || g.body) return false;
        const b = Burials.plainBody(body);
        g.body = b;
        // A new dead: the grave is theirs now (a marker over it keeps the name it bears)
        if (!g.marker || b.name === g.name) {
            g.name = b.name;
            g.pid = b.pid != null ? b.pid : null;
            g.born = b.born != null ? b.born : null;
            g.died = _num(body && body.day, _num(day));
        }
        delete g.buriedAlive;
        delete g.aliveOutcome;
        return true;
    },

    /** Is there nothing left to it (no body, no marker, nothing in it)? Then it is only a hole. */
    isHollow(g, day) {
        return !!g && !g.body && !Burials.markerNow(g, day) && (!g.goods || Burials.isEmpty(g.goods));
    },

    // ── What is put in the ground: contents ─────────────────

    /** Contents in their shape: { items: { id: n }, gold }. */
    contents(c) {
        const items = {};
        for (const [id, n] of Object.entries((_obj(c) && _obj(c.items)) || {})) if (_num(n) > 0) items[id] = _num(n);
        return { items, gold: Math.max(0, Math.floor(_num(_obj(c) && c.gold))) };
    },

    isEmpty(c) {
        return !c || (!(_num(c.gold) > 0) && !Object.values(c.items || {}).some(n => _num(n) > 0));
    },

    /** "34 gold, 3 iron, 1 sword" (names from `nameOf`, else the id). */
    describe(c, nameOf = null) {
        if (Burials.isEmpty(c)) return 'nothing';
        const parts = [];
        if (_num(c.gold) > 0) parts.push(`${Math.floor(c.gold)} gold`);
        for (const [id, n] of Object.entries(c.items || {})) {
            if (!(_num(n) > 0)) continue;
            const name = (typeof nameOf === 'function' && nameOf(id)) || id.replace(/_/g, ' ');
            parts.push(`${n} ${name}`);
        }
        return parts.join(', ');
    },

    /** Move up to qty of itemId (or 'gold') from the player's packs into contents → how many went in. */
    putIn(c, player, itemId, qty = 1) {
        if (!c || !player || !itemId) return 0;
        if (!c.items) c.items = {};
        if (itemId === 'gold') {
            const n = Math.min(Math.floor(_num(player.gold)), Math.floor(_num(qty)));
            if (n <= 0) return 0;
            player.gold = _num(player.gold) - n;
            c.gold = _num(c.gold) + n;
            return n;
        }
        const inv = player.inventory || {};
        const n = Math.min(_num(inv[itemId]), Math.max(0, _num(qty)));
        if (!(n > 0)) return 0;
        inv[itemId] = _num(inv[itemId]) - n;
        if (inv[itemId] <= 1e-9) delete inv[itemId];
        c.items[itemId] = _num(c.items[itemId]) + n;
        return n;
    },

    /** Take everything out of contents the packs have room for → { taken, left } (left: what stays, or null). */
    takeAll(c, player) {
        const taken = { items: {}, gold: 0 };
        if (!c || !player) return { taken, left: c || null };
        if (_num(c.gold) > 0) {
            player.gold = _num(player.gold) + _num(c.gold);
            taken.gold = _num(c.gold);
            c.gold = 0;
        }
        for (const [id, n] of Object.entries(c.items || {})) {
            if (!(_num(n) > 0)) { delete c.items[id]; continue; }
            if (!PlayerInventory.addItem(player, id, _num(n)).success) continue;
            taken.items[id] = _num(n);
            delete c.items[id];
        }
        return { taken, left: Burials.isEmpty(c) ? null : c };
    },

    // ── Caches: things buried with no one ─────────────────

    /** The caches on a hex's map (world.caches[hexKey]), made when asked. */
    cacheRecord(world, hexKey, create = false) {
        if (!world || !hexKey) return null;
        if (!_obj(world.caches)) {
            if (!create) return null;
            world.caches = {};
        }
        if (!_obj(world.caches[hexKey]) && create) world.caches[hexKey] = {};
        return world.caches[hexKey] || null;
    },

    /** The cache at (q, r) of a hex's map, or null. */
    cacheAt(world, hexKey, q, r) {
        const rec = Burials.cacheRecord(world, hexKey);
        return (rec && rec[burialKey(q, r)]) || null;
    },

    /** The open hole's cache at (q, r): made (empty, open) if there is none. */
    openCache(world, hexKey, q, r, day) {
        const rec = Burials.cacheRecord(world, hexKey, true);
        if (!rec) return null;
        const k = burialKey(q, r);
        if (!rec[k]) rec[k] = { kind: 'cache', items: {}, gold: 0, day: _num(day), open: true, seen: [] };
        rec[k].open = true;
        return rec[k];
    },

    /** Let a cache go off the record. */
    dropCache(world, hexKey, q, r) {
        const rec = Burials.cacheRecord(world, hexKey);
        const k = burialKey(q, r);
        if (!rec || !rec[k]) return null;
        const c = rec[k];
        delete rec[k];
        if (!Object.keys(rec).length) delete world.caches[hexKey];
        return c;
    },

    /**
     * The hole at (q, r) is filled in over its cache: buried (saved, found again
     * by digging there). seen: who watched it go in ([{ id, name }]). An empty
     * one is let go. → the cache, or null.
     */
    closeCache(world, hexKey, q, r, day, seen = []) {
        const c = Burials.cacheAt(world, hexKey, q, r);
        if (!c) return null;
        if (Burials.isEmpty(c)) { Burials.dropCache(world, hexKey, q, r); return null; }
        c.open = false;
        c.day = _num(day);
        const max = Math.max(0, _num(Burials.config().cache.maxSeen, 3));
        c.seen = (Array.isArray(seen) ? seen : []).filter(w => w && w.name).slice(0, max).map(w => ({ id: w.id != null ? String(w.id) : null, name: String(w.name) }));
        delete c.taken;
        return c;
    },

    /**
     * Someone digs at (q, r): a cache there comes up into the hole (open again).
     * → { cache } with what's in it, { taken, seen } when someone else got there
     * first (the record let go), or null: nothing buried there.
     */
    digUpCache(world, hexKey, q, r) {
        const c = Burials.cacheAt(world, hexKey, q, r);
        if (!c) return null;
        if (c.taken) {
            Burials.dropCache(world, hexKey, q, r);
            return { taken: c.taken, seen: c.seen || [] };
        }
        c.open = true;
        return { cache: c };
    },

    /** Every cache on the world: [{ hex, q, r, cache }]. */
    caches(world) {
        const out = [];
        for (const [hex, rec] of Object.entries((world && _obj(world.caches)) || {})) {
            for (const [k, c] of Object.entries(rec || {})) {
                const [q, r] = k.split(',').map(Number);
                out.push({ hex, q, r, cache: c });
            }
        }
        return out;
    },

    /** Every burial of the player's on the world: [{ hex, q, r, grave }]. */
    burials(world) {
        const out = [];
        for (const [hex, rec] of Object.entries((world && _obj(world.burials)) || {})) {
            for (const [k, g] of Object.entries(rec || {})) {
                const [q, r] = k.split(',').map(Number);
                out.push({ hex, q, r, grave: g });
            }
        }
        return out;
    },

    // ── The days go by ─────────────────

    /**
     * Each day: whoever watched a cache buried may come back for it (after
     * cache.witnessDays, at witnessChance a day), and now and then someone turns
     * one up digging (strayTown / strayWild a day); a grave left open in a town
     * the sexton fills in after refillDays. Never on the map the player stands
     * on (opts.here: its hex key). opts.isTown(hexKey) → is it a town's map.
     * Chances from a hash of the day (no shared RNG).
     * @returns {Array<{ kind: 'cacheTaken'|'graveRefilled', hex, q, r, by, grave? }>}
     */
    processDay(world, day, opts = {}) {
        const out = [];
        if (!world) return out;
        const C = Burials.config();
        const K = C.cache;
        const seed = (world.generationParams && world.generationParams.seed) || 0;
        const isTown = typeof opts.isTown === 'function' ? opts.isTown : () => false;
        const d = _num(day);
        for (const { hex, q, r, cache } of Burials.caches(world)) {
            if (hex === opts.here || cache.open || cache.taken || Burials.isEmpty(cache)) continue;
            let by = null;
            if (d - _num(cache.day) >= _num(K.witnessDays, 1)) {
                for (const w of cache.seen || []) {
                    if (_frac(`${seed}|cache|${hex}|${q},${r}|${d}|${w.id || w.name}`) < _num(K.witnessChance, 0.25)) { by = w.name; break; }
                }
            }
            const town = isTown(hex);
            if (!by && _frac(`${seed}|stray|${hex}|${q},${r}|${d}`) < (town ? _num(K.strayTown, 0.002) : _num(K.strayWild, 0.0005))) {
                by = town ? 'someone digging' : 'a treasure hunter';
            }
            if (!by) continue;
            cache.taken = { by, day: d };
            cache.items = {};
            cache.gold = 0;
            out.push({ kind: 'cacheTaken', hex, q, r, by });
        }
        for (const { hex, q, r, grave } of Burials.burials(world)) {
            if (hex === opts.here || grave.open == null || !isTown(hex)) continue;
            if (d - _num(grave.open) < _num(C.refillDays, 3)) continue;
            // The sexton fills it in: an empty one with nothing over it is only a hole filled
            if (Burials.isHollow(grave, d)) Burials.unbury(world, hex, q, r);
            else Burials.refillGrave(grave, d);
            out.push({ kind: 'graveRefilled', hex, q, r, by: 'the sexton', grave });
        }
        return out;
    },
};
