/**
 * A light carried at night, and fishing by torchlight (systems/carriedLight.js,
 * ui/innerMapTorchlight.js, ui/innerMapLayers/surfaceFish.js, ui/fishFed.js):
 * a torch is bound from goods you hold and burns down to nothing; the lantern
 * lasts but burns fuel from the packs; the light only counts at night; held by
 * deep water the fish gather to it and a line there bites the readier; a
 * poacher at your trap sees a light coming from farther off, and a lantern hung
 * at the trap keeps him off while it burns.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../ui/innerMapRenderer.js';
import '../ui/innerMapLayers.js';
import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';
import { CarriedLight } from '../systems/carriedLight.js';
import { FishTraps } from '../systems/fishTraps.js';
import { SurfaceFish } from '../ui/innerMapLayers/surfaceFish.js';
import { FishFed } from '../ui/fishFed.js';
import { LightSystem } from '../ui/lightSystem.js';
import { InnerMapTorchlight } from '../ui/innerMapTorchlight.js';

const SPECIES = [
    { id: 'perch', back: '#6f735e', length: 0.45, height: 0.32, speed: 1.2, school: [3, 5], weight: 5, waters: ['lake'] },
];

function lake({ W = 30, H = 16, r0 = 4, r1 = 13 } = {}) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const wet = r >= r0 && r < r1;
            row.push({ q, r, explored: true, visible: true, subTerrain: { id: wet ? 'lake_water' : 'grass', passable: !wet }, _wet: wet, _waterKind: wet ? 'lake' : undefined });
        }
        tiles.push(row);
    }
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    return tiles;
}
const RANGE = { qMin: 0, qMax: 29, rMin: 0, rMax: 15 };

const saved = {};
beforeEach(() => {
    DataLoader._gamedata = {
        ...(DataLoader._gamedata || {}),
        diving: { fish: { species: SPECIES } },
        innerMap: { ...((DataLoader._gamedata && DataLoader._gamedata.innerMap) || {}), surfaceFish: { max: 14, perCell: { lake: 0.06 }, jump: 0, feeding: { biteBonus: 0.15, near: 2.5, fedSeconds: 120 } } },
    };
    SurfaceFish._tiles = null;
    SurfaceFish.mask = null;
    SurfaceFish.fish = [];
    SurfaceFish.shoals = [];
    SurfaceFish.ripples = [];
    SurfaceFish.baits = [];
    SurfaceFish.fed = [];
    SurfaceFish._clock = 0;
    SurfaceFish._lightAt = null;
    InnerMap.season = 'Summer';
    InnerMap._waterStamp = 0;
    FishFed.light = null;
    for (const k of ['active', 'getPlayerWorldPos', 'isPlayerSwimming', '_underwater', '_insideBuilding', '_aboardBoat', 'timeOfDay', '_timeAccumulator']) saved[k] = InnerMap[k];
    saved.dark = LightSystem.ambientDarkness;
});
afterEach(() => {
    for (const k of Object.keys(saved)) if (k !== 'dark') InnerMap[k] = saved[k];
    LightSystem.ambientDarkness = saved.dark;
    LightSystem.carried = null;
    FishFed.light = null;
});

const NIGHT = 0.85, DAY = 0;

describe('the torch', () => {
    it('one from the packs a lighting; burns down by the hour; the stub kept when put out; the next lit as it gutters', () => {
        const hours = CarriedLight.config().torch.hours;
        const p = { inventory: { torch: 2 } };
        expect(CarriedLight.light(p, 'torch', 100).ok).toBe(true);
        expect(p.inventory.torch).toBe(1);
        expect(CarriedLight.lit(p)).toBe('torch');
        CarriedLight.tick(p, 101);
        expect(p.carriedLight.stub).toBeCloseTo(hours - 1);
        // put out: the stub kept, lit first next time (no fresh one taken)
        CarriedLight.putOut(p, 101.5);
        expect(CarriedLight.lit(p)).toBe(null);
        expect(p.carriedLight.stub).toBeCloseTo(hours - 1.5);
        CarriedLight.tick(p, 150);
        expect(p.carriedLight.stub).toBeCloseTo(hours - 1.5);
        CarriedLight.light(p, 'torch', 150);
        expect(p.inventory.torch).toBe(1);
        // guttering out: the last fresh one lit from it, then dark
        const n1 = CarriedLight.tick(p, 150 + hours - 1.5 + 0.1);
        expect(n1.map(n => n.kind)).toContain('torch_next');
        expect(p.inventory.torch).toBeUndefined();
        const n2 = CarriedLight.tick(p, 150 + hours * 3);
        expect(n2.map(n => n.kind)).toContain('torch_out');
        expect(CarriedLight.lit(p)).toBe(null);
        expect(CarriedLight.whyNot(p, 'torch')).toBeTruthy();
    });

    it('is bound by hand from a stick and a binder, both used up', () => {
        const p = { inventory: { sticks: 1, resin: 2 } };
        const res = CarriedLight.bindTorch(p);
        expect(res.ok).toBe(true);
        expect(p.inventory.sticks).toBeUndefined();
        expect(p.inventory.resin).toBe(1);
        expect(p.inventory.torch).toBe(res.made);
        expect(res.made).toBeGreaterThan(0);
        expect(CarriedLight.bindTorch(p).ok).toBe(false);
    });

    it('drowns in the water', () => {
        const p = { inventory: { torch: 1 } };
        CarriedLight.light(p, 'torch', 10);
        CarriedLight.douse(p, 10.2);
        expect(CarriedLight.lit(p)).toBe(null);
        expect(p.carriedLight.stub).toBe(0);
    });
});

describe('the lantern', () => {
    it('lasts, but burns fuel from the packs: filled when lit dry, refilled as it runs dry, out with none left', () => {
        const F = CarriedLight.config().fuels;
        const p = { inventory: { lantern: 1 } };
        expect(CarriedLight.whyNot(p, 'lantern')).toMatch(/nothing to burn/);
        p.inventory.lamp_oil = 1;
        p.inventory.candles = 1;
        const res = CarriedLight.light(p, 'lantern', 0);
        expect(res.ok).toBe(true);
        expect(res.used).toBe('lamp_oil');
        expect(p.inventory.lamp_oil).toBeUndefined();
        expect(p.carriedLight.fuel).toBeCloseTo(F.lamp_oil);
        const n = CarriedLight.tick(p, F.lamp_oil + 1);
        expect(n.map(x => x.kind)).toContain('lantern_fill');
        expect(p.inventory.candles).toBeUndefined();
        expect(p.carriedLight.fuel).toBeCloseTo(F.candles - 1);
        CarriedLight.tick(p, F.lamp_oil + F.candles + 5);
        expect(CarriedLight.lit(p)).toBe(null);
        expect(p.inventory.lantern).toBe(1);
    });
});

describe('only at night', () => {
    function game(inv) {
        return { player: { inventory: { ...inv } }, world: { day: 10 }, ui: { showNotification() {} } };
    }
    function onMap() {
        InnerMap.active = true;
        InnerMap._underwater = false;
        InnerMap._insideBuilding = null;
        InnerMap._aboardBoat = false;
        InnerMap.isPlayerSwimming = () => false;
        InnerMap.getPlayerWorldPos = () => ({ x: 10 * 32 + 16, y: 3 * 32 + 16 });
        InnerMap.timeOfDay = 22; InnerMap._timeAccumulator = 0;
    }

    it('the light pool and the bite bonus: strong at night, none by day', () => {
        onMap();
        const g = game({ torch: 1 });
        expect(CarriedLight.strength(DAY)).toBe(0);
        expect(CarriedLight.strength(NIGHT)).toBe(1);
        InnerMapTorchlight.handle(g, { action: 'torch_light' });
        LightSystem.ambientDarkness = NIGHT;
        InnerMapTorchlight.update(g);
        expect(LightSystem.carried).toBeTruthy();
        expect(LightSystem.carried.flicker).toBe(true);
        expect(FishFed.light).toBeTruthy();
        expect(FishFed.biteBonus(10, 5)).toBeCloseTo(CarriedLight.config().torch.biteBonus);
        // far off along the bank: nothing
        expect(FishFed.biteBonus(25, 5)).toBe(0);
        // by day: no draw, no bonus
        LightSystem.ambientDarkness = DAY;
        InnerMapTorchlight.update(g);
        expect(FishFed.light).toBe(null);
        expect(FishFed.biteBonus(10, 5)).toBe(0);
        // put out: no pool
        InnerMapTorchlight.handle(g, { action: 'torch_out' });
        InnerMapTorchlight.update(g);
        expect(LightSystem.carried).toBe(null);
    });

    it('the menu: light, put out, bind', () => {
        onMap();
        LightSystem.ambientDarkness = NIGHT;
        const g = game({ torch: 1, lantern: 1, sticks: 1, tallow: 1 });
        const labels = () => InnerMapTorchlight.menuItems(g).map(i => i.label);
        expect(labels()).toEqual(expect.arrayContaining(['Light a Torch', 'Light the Lantern', 'Bind a Torch']));
        InnerMapTorchlight.handle(g, { action: 'torch_light' });
        expect(labels()).toContain('Put Out the Torch');
        expect(labels()).not.toContain('Light a Torch');
        expect(InnerMapTorchlight.menuItems({ player: { inventory: {} } })).toEqual([]);
    });

    it('goes out off the street map', () => {
        onMap();
        const g = game({ torch: 1 });
        InnerMapTorchlight.handle(g, { action: 'torch_light' });
        InnerMap.active = false;
        InnerMapTorchlight.update(g);
        expect(CarriedLight.lit(g.player)).toBe(null);
        expect(g.player.carriedLight.stub).toBeGreaterThan(0);
    });
});

describe('fish drawn to the light', () => {
    const near = (x, y, d) => SurfaceFish.fish.filter(f => f.alive && Math.hypot(f.x - x, f.y - y) <= d).length;

    function settle(withLight, seconds = 40) {
        lake();
        SurfaceFish.cells(InnerMap.tiles);
        SurfaceFish.reset(7);
        const C = SurfaceFish.config();
        for (let t = 0; t < 2; t += 0.05) SurfaceFish.update(0.05, RANGE, null, C);
        FishFed.light = withLight ? { x: 15.5, y: 3.5, near: 3.5, bonus: 0.2, radius: 5, glow: 0.75, pull: 7, ring: [0.8, 1.8], reach: 3, speed: 0.7, extra: 3, comeEvery: 4, lure: 1, boat: false } : null;
        let most = 0;
        for (let t = 0; t < seconds; t += 0.05) {
            SurfaceFish.update(0.05, RANGE, null, C);
            if (t > seconds - 10) most = Math.max(most, near(15.5, 6.5, 3));
        }
        return { most, lit: SurfaceFish._lightAt };
    }

    it('they gather in the lit water by the bank, and more come up, where without it they wander', () => {
        const dark = settle(false);
        const lit = settle(true);
        // the light falls on the fish's own water, off the bank
        expect(lit.lit).toBeTruthy();
        expect(SurfaceFish.swimmable(lit.lit.x, lit.lit.y)).toBe(true);
        expect(Math.hypot(lit.lit.x - 15.5, lit.lit.y - 3.5)).toBeLessThanOrEqual(3);
        expect(lit.most).toBeGreaterThan(dark.most);
        expect(lit.most).toBeGreaterThanOrEqual(3);
    });
});

describe('poachers and the light', () => {
    it('a poacher sees a light coming from farther off, at night only', () => {
        const base = FishTraps.config().scareReach;
        const p = { inventory: { torch: 1 } };
        expect(CarriedLight.scareReach(base, p, NIGHT)).toBe(base);
        CarriedLight.light(p, 'torch', 0);
        expect(CarriedLight.scareReach(base, p, NIGHT)).toBeGreaterThan(base);
        expect(CarriedLight.scareReach(base, p, DAY)).toBe(base);
    });

    it('a lantern hung at the trap keeps him off while it burns; taken down, it and its oil come back', () => {
        const world = { day: 3, generationParams: { seed: 11 } };
        const trap = { id: 't1', q: 0, r: 0, x: 5, y: 5, catch: [{ itemId: 'fish', qty: 2 }] };
        // a night it would be robbed
        let hit = -1;
        for (let d = 0; d < 400 && hit < 0; d++) {
            const h = FishTraps.poachHour(world, trap, d);
            if (FishTraps.poacherAt(world, trap, h) >= 0) hit = h;
        }
        expect(hit).toBeGreaterThanOrEqual(0);
        const p = { inventory: { lantern: 1, lamp_oil: 1 } };
        const res = CarriedLight.hangLantern(trap, p, hit - 2);
        expect(res.ok).toBe(true);
        expect(p.inventory.lantern).toBeUndefined();
        expect(p.inventory.lamp_oil).toBeUndefined();
        expect(FishTraps.poacherAt(world, trap, hit)).toBe(-1);
        // burnt out: no help
        trap.lantern.until = hit - 1;
        expect(FishTraps.poacherAt(world, trap, hit)).toBeGreaterThanOrEqual(0);
        trap.lantern.until = hit + 4;
        const back = CarriedLight.takeDownLantern(trap, p, hit);
        expect(back.ok).toBe(true);
        expect(back.left).toBeCloseTo(4);
        expect(p.inventory.lantern).toBe(1);
        expect(p.carriedLight.fuel).toBeCloseTo(4);
        expect(trap.lantern).toBeUndefined();
    });
});
