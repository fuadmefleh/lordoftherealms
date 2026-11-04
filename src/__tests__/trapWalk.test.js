// Trapping walked on the inner map (ui/mapTasks/wildTasks.js WildTaskRunner.trap):
// the snares you set, where, and the ones you check make the result.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { WildTasks } from '../systems/wildTasks.js';

let InnerMap, InnerMapTasks, WildTaskRunner;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapTasks } = await import('../ui/innerMapTasks.js'));
    ({ WildTaskRunner } = await import('../ui/mapTasks/wildTasks.js'));
    // No HUD under node
    for (const k of ['_mountHud', '_unmountHud', '_renderHud']) vi.spyOn(InnerMapTasks, k).mockImplementation(() => {});
});

const saved = {};
function openMap(W = 40, H = 40) {
    for (const k of ['active', 'tiles', 'width', 'height', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_insideBuilding', 'buildings']) saved[k] = InnerMap[k];
    const tiles = [];
    for (let r = 0; r < H; r++) {
        tiles.push([]);
        for (let q = 0; q < W; q++) tiles[r].push({ q, r, subTerrain: { id: 'snow', passable: true } });
    }
    Object.assign(InnerMap, { active: true, tiles, width: W, height: H, playerInnerQ: 20, playerInnerR: 20, _playerWalking: false, _insideBuilding: false, buildings: [] });
}
afterEach(() => {
    if (InnerMapTasks.active) InnerMapTasks.abandon(true);
    Object.assign(InnerMap, saved);
});

const game = () => ({ world: { day: 300 }, player: { name: 'T', luck: 5, skills: {}, q: 0, r: 0 }, ui: { hideCustomPanel() {}, showCustomPanel() {} } });
const stand = (p) => { InnerMap.playerInnerQ = p.q; InnerMap.playerInnerR = p.r; };
const press = (ctx, label) => {
    const b = ctx.tpl.buttons(ctx).find(x => x.label === label);
    expect(b, label).toBeTruthy();
    b.act();
};
const work = (g, secs = 3) => { for (let t = 0; t < secs; t += 0.5) InnerMapTasks.update(0.5, g); };

describe('trapping walked in person', () => {
    it('a day run: snares set on a run and on open ground, checked, and the catch comes back', async () => {
        openMap();
        const g = game();
        const c = WildTasks.cfg('trap');
        let out;
        await WildTaskRunner.trap(g, { mode: 'run', player: g.player }, (res) => { out = res; }, () => { out = 'abandoned'; });
        const ctx = InnerMapTasks.active;
        expect(ctx).toBeTruthy();
        expect(ctx.runs.length).toBeGreaterThan(0);
        // On the run
        stand(ctx.runs[0]);
        press(ctx, c.setHere);
        work(g);
        // Out in a far corner of open ground
        stand({ q: 2, r: 2 });
        press(ctx, c.setHere);
        work(g);
        press(ctx, c.doneSetting);
        expect(ctx.phase).toBe('check');
        // Check only the first snare, then call it a day
        stand(ctx.runs[0]);
        work(g, 2);
        press(ctx, c.doneChecking);
        expect(out).toBeTruthy();
        expect(out.spots.length).toBe(2);
        expect(out.spots[0].quality).toBeGreaterThan(out.spots[1].quality);
        expect(out.checked).toEqual([0]);
        expect(typeof out.caught).toBe('object');
    });

    it('tending a line: only the snares reached are reported checked', async () => {
        openMap();
        const g = game();
        const line = { snares: [{ q: 10, r: 10, quality: 0.8 }, { q: 30, r: 30, quality: 0.4 }], catch: { pelts: 4 } };
        let out;
        await WildTaskRunner.trap(g, { mode: 'collect', line, player: g.player }, (res) => { out = res; });
        const ctx = InnerMapTasks.active;
        stand({ q: 30, r: 30 });
        work(g, 2);
        press(ctx, WildTasks.cfg('trap').doneChecking);
        expect(out.checked).toEqual([1]);
        expect(out.spots.map(s => s.quality)).toEqual([0.8, 0.4]);
    });
});
