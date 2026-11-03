// ============================================
// MAP TASKS — work done on the street map, scored
// ============================================
// The jobs that used to be minigames (day labour, busking, foraging, hunting…)
// are now done in person on the inner map: carry the sacks, run the parcels,
// cry the wares at the corners, catch the rats. ui/innerMapTasks.js runs
// them; this module holds what can be reasoned about without a screen:
//
//   score()      0–100 from how much was done, how long it took against the
//                job's par (in game hours) and an optional quality 0..1
//   spots()      the places on a map a task can send you: building doors by
//                type, props by id, the square, roadsides, open ground
//   jobPlan()    which task a job is and its settings (data/mapTasks.json)
//
// Pure: everything is a parameter, randomness only from the rng passed in.

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function _data() {
    return (DataLoader.get && DataLoader.get('mapTasks')) || {};
}

export const MapTasks = {
    data: _data,

    /**
     * How well it went, 0–100.
     * @param {object} o { done, total, elapsedHours, parHours, quality (0..1, default 1), floor (min time factor) }
     */
    score(o) {
        const total = Math.max(1, _num(o.total, 1));
        const done = _clamp(_num(o.done), 0, total);
        const par = Math.max(0.1, _num(o.parHours, 2));
        const el = Math.max(0, _num(o.elapsedHours));
        const timeFactor = el <= par ? 1 : Math.max(_num(o.floor, 0.35), par / el);
        const quality = _clamp(o.quality == null ? 1 : _num(o.quality), 0, 1);
        return Math.round(_clamp(100 * (done / total) * timeFactor * (0.7 + 0.3 * quality), 0, 100));
    },

    /** The task a job is done as, with its settings merged over the template's. */
    jobPlan(job) {
        const d = _data();
        const byJob = (d.jobs || {})[job && job.id];
        const byStat = (d.byStat || {})[job && job.stat];
        const pick = byJob || byStat || { template: 'haul' };
        const tpl = (d.templates || {})[pick.template] || {};
        return { ...tpl, ...pick };
    },

    /**
     * Places on the map a task can use.
     * @param {object} map { tiles, width, height, buildings: [{q,r,type,name}] }
     */
    spots(map) {
        const { tiles, width: W, height: H } = map;
        const doors = [];
        const props = [];
        const plaza = [];
        const roads = [];
        const ground = [];
        const pass = (q, r) => q >= 0 && r >= 0 && q < W && r < H && tiles[r][q] && tiles[r][q].subTerrain && tiles[r][q].subTerrain.passable
            && !tiles[r][q].customObject && !tiles[r][q].customObjectPart && !tiles[r][q].customBuildingPart && !tiles[r][q].customBuilding;
        const byAnchor = new Map((map.buildings || []).map(b => [`${b.q},${b.r}`, b]));
        for (let r = 1; r < H - 1; r++) {
            for (let q = 1; q < W - 1; q++) {
                const t = tiles[r][q];
                if (t._doorMarker) {
                    const b = byAnchor.get(`${t._doorMarker.anchorQ},${t._doorMarker.anchorR}`);
                    if (pass(q, r + 1)) doors.push({ q, r: r + 1, doorQ: q, doorR: r, type: b ? b.type : 'house', name: b ? b.name : 'House' });
                }
                if (t.customObject && t.customObject.defId) {
                    // Stand in front of it (below), else beside it
                    const stand = [[0, 1], [-1, 0], [1, 0], [0, -1]].map(([dq, dr]) => [q + dq, r + dr]).find(([a, b]) => pass(a, b));
                    if (stand) props.push({ id: t.customObject.defId, q: stand[0], r: stand[1], atQ: q, atR: r });
                }
                if (!pass(q, r)) continue;
                if (t._plaza) plaza.push({ q, r });
                else if (t.isRoad) roads.push({ q, r });
                else if (t.terrainDetail || t._townFade != null) ground.push({ q, r, town: !!t._townCore, edge: t._townFade != null });
            }
        }
        let square = null;
        if (plaza.length) {
            const cq = plaza.reduce((s, p) => s + p.q, 0) / plaza.length;
            const cr = plaza.reduce((s, p) => s + p.r, 0) / plaza.length;
            square = plaza.reduce((best, p) => (!best || Math.hypot(p.q - cq, p.r - cr) < Math.hypot(best.q - cq, best.r - cr) ? p : best), null);
        }
        return { doors, props, plaza, roads, ground, square, passable: pass };
    },

    /** Doors of buildings whose type is in `types` ('*' = any; 'house' matches houses). */
    doorsOf(spots, types) {
        if (!types || types.includes('*')) return spots.doors.slice();
        return spots.doors.filter(d => types.includes(d.type));
    },

    /** Props whose id starts with any of `prefixes`. */
    propsOf(spots, prefixes) {
        return spots.props.filter(p => prefixes.some(px => p.id.startsWith(px)));
    },

    /** n distinct picks from a list, spread out (each at least `minGap` tiles from the others when possible). */
    pickSpread(list, n, rng, minGap = 4) {
        const pool = list.slice();
        const out = [];
        for (let tries = 0; out.length < n && pool.length && tries < 400; tries++) {
            const i = Math.floor(rng() * pool.length);
            const c = pool[i];
            const tooClose = out.some(o => Math.abs(o.q - c.q) + Math.abs(o.r - c.r) < minGap);
            if (!tooClose || tries > 300) { out.push(c); pool.splice(i, 1); }
        }
        return out;
    },

    /** Nearest of a list to (q, r). */
    nearest(list, q, r) {
        let best = null, bd = Infinity;
        for (const p of list) {
            const d = Math.abs(p.q - q) + Math.abs(p.r - r);
            if (d < bd) { bd = d; best = p; }
        }
        return best;
    },
};
