// ============================================================
// DEAD DISPLAYS — heads over the gate, a gibbet at the crossroads, a body left on the gallows
// ============================================================
// The dead a lord puts on show (systems/gibbets.js decides who, where and what it
// costs) live on their town: settlement.displays = [{ id, kind: 'spike'|'gibbet'|
// 'gallows', day, name, gender, rank, by, … }], saved with the tile. Here, the
// pure part every layer can read:
//
//   stage()   how far the body has gone: fresh → rotting → bones (data/gibbets.json
//             stages, by days since it went up); past the last stage it has fallen
//             to pieces and stands no more
//   standing() the displays up in a town on a day
//   stamp()   folded into the street map's cache key (world/innerMap/terrain.js), so
//             the map is laid anew when a head goes up, rots, or is taken down
//   lay()     on the street map, after the memorials and the scaffold: a head on a
//             spike beside the gate (the walls' gate where the town is walled, else
//             where a road leaves the town), a gibbet cage at a crossroads on the
//             outskirts, a body hanging from the gallows in the square
//             (data/townProps.json gb_* props, art assets/executions/displays.png)
//
// Pure: hash-placed, draws nothing from the map's rng; no globals.

import { DataLoader } from '../core/dataLoader.js';
import { CustomObjects } from './customObjects.js';
import { TownProps } from './townProps.js';
import { TownMarks, markHash } from './townMarks.js';
import { Scaffolds } from './scaffolds.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const DEFAULT_STAGES = [
    { id: 'fresh', until: 14, label: 'fresh' },
    { id: 'rotting', until: 75, label: 'rotting' },
    { id: 'bones', until: 300, label: 'picked to the bones' },
];

/** The prop for each kind of display at each stage. */
const PROPS = {
    spike: { fresh: 'gb_spike_fresh', rotting: 'gb_spike_rotting', bones: 'gb_spike_bones' },
    gibbet: { fresh: 'gb_gibbet_fresh', rotting: 'gb_gibbet_rotting', bones: 'gb_gibbet_bones' },
    gallows: { fresh: 'gb_gallows_fresh', rotting: 'gb_gallows_rotting', bones: 'gb_gallows_bones' },
};

/** At most this many displays are laid on one town's street map (the rest stand off the map's edge). */
const MAX_LAID = 8;

export const DeadDisplays = {
    PROPS,

    stages() {
        const g = DataLoader._gamedata && DataLoader._gamedata.gibbets;
        const s = g && Array.isArray(g.stages) && g.stages.length ? g.stages : DEFAULT_STAGES;
        return s;
    },

    /** → { id, label, age, i (0..n-1), share (0..1 of its whole span) } or null once it has fallen (or been taken down). */
    stage(d, day) {
        if (!d || typeof d !== 'object' || d.down) return null;
        const age = Math.max(0, _num(day) - _num(d.day));
        const S = DeadDisplays.stages();
        const last = _num(S[S.length - 1].until, 300) * _num(d.lasts, 1);
        if (age > last) return null;
        for (let i = 0; i < S.length; i++) {
            if (age <= _num(S[i].until) * _num(d.lasts, 1)) return { id: S[i].id, label: S[i].label || S[i].id, age, i, share: age / Math.max(1, last) };
        }
        return null;
    },

    /** The town's displays still up on `day`. */
    standing(settlement, day) {
        const list = settlement && Array.isArray(settlement.displays) ? settlement.displays : [];
        return list.filter(d => d && !d.down && _num(d.day) <= _num(day) && DeadDisplays.stage(d, day));
    },

    /** The prop id a display shows on `day` (null once fallen). */
    propOf(d, day) {
        const st = DeadDisplays.stage(d, day);
        if (!st) return null;
        const k = PROPS[d.kind] || PROPS.spike;
        return k[st.id] || k.bones;
    },

    /** Part of the street map's cache key: '' when nothing stands. */
    stamp(settlement, day) {
        const up = DeadDisplays.standing(settlement, day);
        if (!up.length) return '';
        return '|dd:' + up.slice(0, MAX_LAID).map(d => `${d.id}${DeadDisplays.stage(d, day).id[0]}`).join(',');
    },

    /**
     * Lay the town's displays on its street map (opts.plaza, opts.center as the planner left
     * them). → [{ q, r, id, kind, stage }] of those laid.
     */
    lay(tiles, settlement, day, opts = {}) {
        if (!tiles || !tiles.length || !tiles[0]) return [];
        const up = DeadDisplays.standing(settlement, day).slice(0, MAX_LAID);
        const out = [];
        if (!up.length) return out;
        const W = tiles[0].length, H = tiles.length;
        const center = opts.center || { q: Math.floor(W / 2), r: Math.floor(H / 2) };
        let gates = null, cross = null;
        for (const d of up) {
            const id = DeadDisplays.propOf(d, day);
            const def = id ? CustomObjects.getDef(id) : null;
            if (!def) continue;
            const key = `display|${d.id}`;
            let at = null;
            if (d.kind === 'gallows') {
                at = Scaffolds._place(tiles, def, key, opts);
            } else if (d.kind === 'gibbet') {
                cross = cross || DeadDisplays._crossroads(tiles, center);
                at = DeadDisplays._near(tiles, def, cross, key) || DeadDisplays._near(tiles, def, gates = gates || DeadDisplays._gates(tiles, center), key);
            } else {
                gates = gates || DeadDisplays._gates(tiles, center);
                at = DeadDisplays._near(tiles, def, gates, key);
            }
            if (!at) continue;
            tiles[at.r][at.q].customObject.display = d.id;
            const st = DeadDisplays.stage(d, day);
            out.push({ q: at.q, r: at.r, id: d.id, kind: d.kind, stage: st.id, name: d.name || null });
        }
        tiles._displays = out;
        return out;
    },

    /** Where the town's displays stand on these tiles. */
    laid(tiles) {
        return (tiles && tiles._displays) || [];
    },

    /** The road tiles where a road leaves the town: the walls' gates, else the town's last road out each way. */
    _gates(tiles, center) {
        const W = tiles[0].length, H = tiles.length;
        const walls = tiles._townWalls;
        const out = [];
        if (walls && walls.box) {
            const b = walls.box;
            for (let q = b.q0; q <= b.q1; q++) for (const r of [b.r0, b.r1]) if (tiles[r] && tiles[r][q] && tiles[r][q].isRoad) out.push({ q, r });
            for (let r = b.r0 + 1; r < b.r1; r++) for (const q of [b.q0, b.q1]) if (tiles[r] && tiles[r][q] && tiles[r][q].isRoad) out.push({ q, r });
            if (out.length) return out;
        }
        // Unwalled: how far the town is built, and the roads at its edge
        let R = 6;
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
            const t = tiles[r][q];
            if (t && (t.customBuilding || t._plaza)) R = Math.max(R, Math.hypot(q - center.q, r - center.r));
        }
        R = Math.min(R + 2, Math.min(W, H) / 2 - 3);
        const ring = [];
        for (let r = 2; r < H - 2; r++) for (let q = 2; q < W - 2; q++) {
            const t = tiles[r][q];
            if (!t || !t.isRoad) continue;
            const d = Math.hypot(q - center.q, r - center.r);
            if (d >= R * 0.7 && d <= R + 1) ring.push({ q, r, d, a: Math.atan2(r - center.r, q - center.q) });
        }
        // (one per quarter of the compass: the farthest out)
        for (let i = 0; i < 4; i++) {
            const lo = -Math.PI + i * Math.PI / 2;
            const qd = ring.filter(e => e.a >= lo && e.a < lo + Math.PI / 2).sort((a, b) => b.d - a.d);
            if (qd.length) out.push({ q: qd[0].q, r: qd[0].r });
        }
        return out.length ? out : [{ q: center.q, r: Math.min(H - 4, center.r + 6) }];
    },

    /** A meeting of roads out on the edge of town (three or four ways), else the gates. */
    _crossroads(tiles, center) {
        const W = tiles[0].length, H = tiles.length;
        const road = (q, r) => !!(tiles[r] && tiles[r][q] && tiles[r][q].isRoad);
        const found = [];
        for (let r = 3; r < H - 3; r++) for (let q = 3; q < W - 3; q++) {
            if (!road(q, r)) continue;
            const n = (road(q + 1, r) ? 1 : 0) + (road(q - 1, r) ? 1 : 0) + (road(q, r + 1) ? 1 : 0) + (road(q, r - 1) ? 1 : 0);
            // (a junction, not the middle of a paved square: some ground off the road nearby)
            if (n < 3 || (road(q + 1, r + 1) && road(q - 1, r - 1) && road(q + 1, r - 1) && road(q - 1, r + 1))) continue;
            found.push({ q, r, d: Math.hypot(q - center.q, r - center.r) });
        }
        found.sort((a, b) => b.d - a.d);
        return found.slice(0, 4);
    },

    /** Stand `def` beside one of the given road tiles (off the road first, then on it). → { q, r } or null. */
    _near(tiles, def, marks, key) {
        if (!marks || !marks.length) return null;
        const W = tiles[0].length, H = tiles.length;
        const spots = [];
        marks.forEach((m, i) => {
            for (let dr = -3; dr <= 3; dr++) for (let dq = -3; dq <= 3; dq++) {
                if (!dq && !dr) continue;
                const q = m.q + dq, r = m.r + dr;
                if (q < 2 || r < 3 || q >= W - 3 || r >= H - 2) continue;
                spots.push({ q, r, s: Math.abs(dq) + Math.abs(dr) + i * 0.5 + markHash(key, q, r) * 1.5 });
            }
        });
        spots.sort((a, b) => a.s - b.s);
        for (const onRoad of [false, true]) {
            for (const { q, r } of spots) {
                if (TownMarks._blocksDoor(tiles, def, q, r)) continue;
                if (TownProps.place(tiles, def, q, r, { onRoad, ignoreReserved: true })) return { q, r };
            }
        }
        return null;
    },
};
