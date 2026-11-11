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
// Pure data and arithmetic: no RNG, no globals (world, player, day passed in).

import { DataLoader } from '../core/dataLoader.js';
import { GraveBook } from './graveBook.js';

const DEFAULTS = {
    settleDays: 360,
    minAlpha: 0.12,
    markers: {
        cross_wood: { item: 'grave_cross', carve: [{ planks: 1 }, { wood: 1 }], seconds: 3, carveSeconds: 10 },
        headstone_plain: { item: 'headstone', seconds: 4 },
        headstone_carved: { item: 'carved_headstone', seconds: 4 },
    },
    text: {},
};

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
    bury(world, hexKey, q, r, body, day, settlement = null) {
        const rec = Burials.record(world, hexKey, true);
        if (!rec) return null;
        const b = Burials.plainBody(body);
        const g = {
            kind: 'grave', name: b.name, body: b, day: _num(day),
            died: _num(body && body.day, _num(day)), born: b.born != null ? b.born : null, pid: b.pid != null ? b.pid : null,
            marker: null, markedDay: null, head: false,
        };
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
        return !!g && g.kind === 'grave' && !Burials.markerNow(g, day);
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
        if (item && player && player.inventory) player.inventory[item] = _num(player.inventory[item]) + 1;
        return item || null;
    },

    // ── How it looks and reads ─────────────────

    /** How far an unmarked mound has settled: 0 fresh … 1 level with the ground. */
    settled(g, day) {
        if (!g) return 1;
        const n = Math.max(1, _num(Burials.config().settleDays, 360));
        return Math.max(0, Math.min(1, (_num(day) - _num(g.day)) / n));
    },

    /** Has an unmarked mound settled level, the ground grown back over it? */
    overgrown(g, day) {
        return !!g && !Burials.markerNow(g, day) && Burials.settled(g, day) >= 1;
    },

    /** How strongly the mound is drawn (1 fresh, down to minAlpha as it settles). */
    moundAlpha(g, day) {
        const min = Math.max(0, Math.min(1, _num(Burials.config().minAlpha, 0.12)));
        return 1 - (1 - min) * Burials.settled(g, day);
    },

    /** What it's called to anyone looking. */
    label(g, day) {
        if (!g) return '';
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
        return lines;
    },
};
