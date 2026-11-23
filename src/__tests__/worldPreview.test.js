/**
 * The New Game world preview (world/worldPreview.js, components/WorldPreview.jsx):
 * the land it shows is the land a New Game with the same settings and seed makes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world/index.js';
import { WorldPreview } from '../world/worldPreview.js';
import { newWorldParams } from '../ui/game/worldParams.js';
import { randomSeed, previewKey, PreviewClient } from '../components/worldPreviewClient.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) DataLoader.clearCache();
    await DataLoader.initializeAll();
});

const TINY = { worldWidth: 60, worldHeight: 40, kingdomCount: 3, mapSeed: 'Raven4821', startYear: 853 };

/** The world a New Game makes (as _doStartNewGame does) */
function fullWorld(settings) {
    const { width, height, params } = newWorldParams(settings);
    const world = new World(width, height);
    world.generate(params);
    return world;
}

function sameLand(preview, world) {
    const W = world.width;
    let diffs = 0;
    let rivers = 0;
    for (let r = 0; r < world.height; r++) {
        for (let q = 0; q < W; q++) {
            const t = world.tiles[r][q];
            const i = r * W + q;
            if (preview.types[preview.terrain[i]].id !== t.terrain.id) diffs++;
            if (t.hasRiver) rivers++;
        }
    }
    return { diffs, rivers };
}

describe('world preview', () => {
    it('newWorldParams carries the chosen seed and settings into the generation params', () => {
        const p = newWorldParams({ ...TINY, rainfall: 'wet', landMass: 60 });
        expect(p.width).toBe(60);
        expect(p.height).toBe(40);
        expect(p.params.seed).toBe('Raven4821');
        expect(p.params.rainfall).toBe('wet');
        expect(p.params.landMass).toBe(60);
        expect(p.params.terrainGen).toBeGreaterThanOrEqual(16);
        expect(newWorldParams({ mapSeed: '  ' }).params.seed).toBe(null);
    });

    it('startNewGame generates from newWorldParams (the previewed params)', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../ui/game/gameSetup.js'), 'utf8');
        expect(src).toMatch(/newWorldParams\(s\)/);
        expect(src).toMatch(/this\.world\.generate\(worldParams\)/);
    });

    it('shows the very land a New Game makes: terrain, rivers, capitals, first towns', () => {
        const { width, height, params } = newWorldParams(TINY);
        const preview = WorldPreview.build(width, height, params);
        const world = fullWorld(TINY);
        expect(world.generationParams.seed).toBe('Raven4821');
        expect(preview.seed).toBe('Raven4821');
        const { diffs, rivers } = sameLand(preview, world);
        expect(diffs).toBe(0);
        expect(preview.stats.river).toBe(rivers);
        expect(preview.stats.land + preview.stats.water).toBe(width * height);
        // River courses: each river hex flows where the game's does
        for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) {
            const t = world.tiles[r][q];
            if (!t.hasRiver || !(t.riverDir >= 0)) continue;
            expect(preview.riverTo[r * width + q]).toBeGreaterThanOrEqual(0);
        }
        // The realms' capitals stand where the game's do, under the same names
        expect(preview.kingdoms.map(k => k.id)).toEqual(world.kingdoms.map(k => k.id));
        for (const k of preview.kingdoms) {
            const real = world.kingdoms.find(x => x.id === k.id);
            expect(k.capital).toMatchObject({ q: real.capital.q, r: real.capital.r });
            expect(k.capital.name).toBe(world.tiles[real.capital.r][real.capital.q].settlement.name);
        }
        // ...and the realms' first towns too
        for (const town of preview.towns) {
            const s = world.tiles[town.r][town.q].settlement;
            expect(s && s.name).toBe(town.name);
        }
    });

    it('is the same land for the same seed, and another for another seed', () => {
        const { width, height, params } = newWorldParams(TINY);
        const a = WorldPreview.build(width, height, params);
        const b = WorldPreview.build(width, height, params);
        expect(Array.from(b.terrain)).toEqual(Array.from(a.terrain));
        const c = WorldPreview.build(width, height, { ...params, seed: 'Wolf1234' });
        expect(Array.from(c.terrain)).not.toEqual(Array.from(a.terrain));
    });

    it('leaves the caller RNG and id counter alone', () => {
        Utils.setSeed(777);
        Utils.setIdCounter(42);
        const expected = (() => { Utils.setSeed(777); return Utils.random(); })();
        Utils.setSeed(777);
        const { width, height, params } = newWorldParams(TINY);
        WorldPreview.build(width, height, params);
        expect(Utils.random()).toBe(expected);
        expect(Utils.getIdCounter()).toBe(42);
    });

    it('a Dawn of Man start previews the land without realms', () => {
        const dawn = { ...TINY, startYear: 50 };
        const { width, height, params } = newWorldParams(dawn);
        const preview = WorldPreview.build(width, height, params);
        expect(preview.kingdoms.length).toBe(0);
        expect(preview.towns.length).toBe(0);
        const world = fullWorld(dawn);
        expect(sameLand(preview, world).diffs).toBe(0);
    });

    it('colours each hex by its terrain type (data/terrain.json types[].color)', () => {
        const { width, height, params } = newWorldParams(TINY);
        const preview = WorldPreview.build(width, height, params);
        const terrainTypes = DataLoader._gamedata.terrain.types;
        for (const t of preview.types) {
            const def = Object.values(terrainTypes).find(d => d.id === t.id);
            if (def) expect(t.color).toBe(def.color);
        }
        expect(preview.types.some(t => t.water)).toBe(true);
        expect(preview.types.some(t => !t.water)).toBe(true);
    });

    it('reroll gives a new seed; the key changes with the land settings, not the character', () => {
        let seed = 'Raven4821';
        for (let i = 0; i < 50; i++) {
            const next = randomSeed(seed);
            expect(next).not.toBe(seed);
            expect(next).toMatch(/^[A-Z][a-z]+\d{3,4}$/);
            seed = next;
        }
        // (even a stuck random source never repeats the seed)
        expect(randomSeed('Dragon100', () => 0)).not.toBe('Dragon100');
        const k = previewKey(TINY);
        expect(previewKey({ ...TINY, charFirstName: 'Aldric', origin: 'born' })).toBe(k);
        expect(previewKey({ ...TINY, mapSeed: 'Wolf1234' })).not.toBe(k);
        expect(previewKey({ ...TINY, rainfall: 'arid' })).not.toBe(k);
    });

    it('the client makes the land on this thread when there are no workers', async () => {
        const client = new PreviewClient();
        const preview = await client.request(TINY);
        const { width, height, params } = newWorldParams(TINY);
        const direct = WorldPreview.build(width, height, params);
        expect(Array.from(preview.terrain)).toEqual(Array.from(direct.terrain));
        // A request made while another is pending supersedes it
        const first = client.request(TINY);
        const second = client.request({ ...TINY, mapSeed: 'Wolf1234' });
        await expect(first).rejects.toMatchObject({ superseded: true });
        const last = await second;
        expect(last.seed).toBe('Wolf1234');
    });
});
