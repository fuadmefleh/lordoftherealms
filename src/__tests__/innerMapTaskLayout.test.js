// The in-person job's layout (ui/innerMapTasks.js; first-hour playthrough 2026-11-17):
// a Sowing Hand's spots lie about the town's fields, a short walk apart (they were
// spread over the whole map: about 150 tiles of walking for a day's 12–24 g), a
// gather job without fields keeps to one stretch of the town's edge, and a click on
// a spot's floating item (drawn a tile above its ring) picks the spot itself.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapTasks } from '../ui/innerMapTasks.js';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import { Utils } from '../core/utils.js';
import { loadData } from './playtest/harness.js';

const N = 80;
const saved = {};

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    InnerMapTasks.active = null;
    Object.assign(InnerMap, saved);
});

/** An open N×N street map: grass everywhere (the outer ring the town's edge), fields where asked. */
function lay({ fields = [], me = { q: 40, r: 40 } } = {}) {
    for (const k of ['tiles', 'width', 'height', 'active', 'playerInnerQ', 'playerInnerR', 'buildings', '_insideBuilding']) saved[k] = InnerMap[k];
    const tiles = [];
    for (let r = 0; r < N; r++) {
        const row = [];
        for (let q = 0; q < N; q++) {
            const edge = q < 12 || r < 12 || q >= N - 12 || r >= N - 12;
            row.push({ q, r, subTerrain: { id: 'grass', passable: true }, terrainDetail: 'grass', _townFade: edge ? 0.5 : null, _townCore: !edge });
        }
        tiles.push(row);
    }
    for (const f of fields) tiles[f.r][f.q].customObject = { defId: 'tp_field_plowed_6x3' };
    Object.assign(InnerMap, { tiles, width: N, height: N, active: true, playerInnerQ: me.q, playerInnerR: me.r, buildings: [], _insideBuilding: false });
}

function gatherCtx(plan) {
    const game = { world: { day: 10 }, player: {} };
    const tpl = InnerMapTasks.TEMPLATES.gather;
    const ctx = InnerMapTasks._makeCtx(game, { plan: { template: 'gather', count: [6, 6], ...plan } }, tpl, Utils.seededRandom(99));
    InnerMapTasks.active = ctx;
    tpl.setup(ctx);
    return ctx;
}

const spread = (marks) => {
    let d = 0;
    for (const a of marks) for (const b of marks) d = Math.max(d, Math.abs(a.q - b.q), Math.abs(a.r - b.r));
    return d;
};

describe('a gather job\'s spots', () => {
    it('lie about the nearest field when the job says so', () => {
        lay({ fields: [{ q: 50, r: 30 }, { q: 15, r: 70 }] });
        const ctx = gatherCtx({ near: 'fields' });
        expect(ctx.marks.length).toBe(6);
        expect(ctx.site).toMatchObject({ atQ: 50, atR: 30 });
        for (const m of ctx.marks) expect(Math.max(Math.abs(m.q - 50), Math.abs(m.r - 31))).toBeLessThanOrEqual(10);
        expect(spread(ctx.marks)).toBeLessThanOrEqual(16);
    });

    it('without fields, keep to one stretch of the town\'s edge, not the whole map', () => {
        lay({ me: { q: 40, r: 20 } });
        const ctx = gatherCtx({});
        expect(ctx.marks.length).toBe(6);
        expect(spread(ctx.marks)).toBeLessThanOrEqual(30);
        // (the edge nearest where the job began: the top of the map)
        for (const m of ctx.marks) expect(m.r).toBeLessThan(40);
    });
});

describe('clicking a spot\'s floating item', () => {
    it('picks the spot under it, and leaves other clicks alone', () => {
        lay({ fields: [{ q: 50, r: 30 }] });
        const ctx = gatherCtx({ near: 'fields' });
        const T = InnerMapRenderer.TILE_SIZE || 32;
        const camera = { zoom: 2, worldToScreen: (x, y) => ({ x: x * 2, y: y * 2 }), screenToWorld: (x, y) => ({ x: x / 2, y: y / 2 }) };
        const m = ctx.marks[0];
        const ds = T * camera.zoom;
        const s = camera.worldToScreen(m.q * T + T / 2, m.r * T + T / 2);
        expect(InnerMapTasks.pickMark(s.x, s.y - ds * 0.8, camera)).toEqual({ q: m.q, r: m.r });
        // through the renderer's own hit test (the click path)
        InnerMapRenderer.taskPick = (x, y, cam) => InnerMapTasks.pickMark(x, y, cam);
        expect(InnerMapRenderer.getInnerHexAtScreen(s.x, s.y - ds * 0.8, camera)).toEqual({ q: m.q, r: m.r });
        // far from any item: the tile under the pointer, as before
        expect(InnerMapTasks.pickMark(5, 5, camera)).toBeNull();
        InnerMapTasks.active = null;
        expect(InnerMapTasks.pickMark(s.x, s.y - ds * 0.8, camera)).toBeNull();
    });
});
