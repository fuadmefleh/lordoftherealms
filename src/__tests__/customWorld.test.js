// Custom worlds (world_editor.html → World.loadFromEditorData): what the map
// maker placed — towns, landmarks, roads, rivers, realms, the player's start —
// must reach play, and a saved game must rebuild the same map on resume.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const W = 40, H = 30;

// A lake-ringed continent of grassland with a hill spine
function editorWorld(extra = {}) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            const edge = q < 3 || q >= W - 3 || r < 3 || r >= H - 3;
            tiles.push(edge ? 'ocean' : (q === 20 ? 'hills' : 'grassland'));
        }
    }
    return { name: 'Test Realm', seed: 4242, width: W, height: H, tiles, ...extra };
}

function load(data) {
    Utils.setSeed(1);
    const world = new World(data.width, data.height);
    world.loadFromEditorData(data);
    return world;
}

describe('custom worlds', () => {
    it('places the hand-made towns and landmarks, keeping their names', () => {
        const world = load(editorWorld({
            overlays: {
                '8,8': { type: 'town', name: 'Oakhollow' },
                '30,20': { type: 'city', name: 'Greywater' },
                '12,22': { type: 'dungeon', name: 'The Pit' },
                '1,1': { type: 'village', name: 'Drowned' }, // on water: dropped
            },
        }));
        expect(world.tiles[8][8].settlement).toMatchObject({ type: 'town', name: 'Oakhollow' });
        expect(world.tiles[20][30].settlement).toMatchObject({ type: 'city', name: 'Greywater' });
        expect(world.tiles[22][12].improvement).toMatchObject({ type: 'ruins', name: 'The Pit', explored: false });
        expect(world.tiles[1][1].settlement).toBeNull();
    });

    it('lays painted roads and rivers, and gives every tile a region', () => {
        const roads = {}, rivers = {};
        for (let q = 6; q <= 14; q++) roads[`${q},10`] = { type: 'road' };
        for (let r = 4; r <= 12; r++) rivers[`25,${r}`] = true;
        const world = load(editorWorld({ roadOverlays: roads, rivers }));
        for (let q = 6; q <= 14; q++) expect(world.tiles[10][q].hasRoad).toBe(true);
        for (let r = 4; r <= 12; r++) expect(world.tiles[r][25].hasRiver).toBe(true);
        // Neighbouring river tiles differ in height, so the renderer joins them
        expect(world.tiles[5][25].elevation).not.toBe(world.tiles[6][25].elevation);
        expect(world.tiles.flat().every(t => t.regionId > 0)).toBe(true);
    });

    it('seats the realms the map maker placed, on their painted lands', () => {
        const territory = {};
        for (let r = 5; r <= 12; r++) for (let q = 5; q <= 15; q++) territory[`${q},${r}`] = 'sylvaris';
        const world = load(editorWorld({
            realms: [
                { id: 'sylvaris', name: 'The Greenwood', capital: { q: 10, r: 8 } },
                { id: 'my_realm', name: 'Duchy of Ash', color: '#334455', culture: 'Nordic', capital: { q: 30, r: 22 } },
            ],
            territory,
            overlays: { '7,11': { type: 'town', name: 'Fernmouth' } },
        }));
        expect(world.kingdoms.map(k => k.id)).toEqual(['sylvaris', 'my_realm']);
        const [green, ash] = world.kingdoms;
        expect(green.name).toBe('The Greenwood');
        expect(green.capital).toEqual({ q: 10, r: 8 });
        expect(world.tiles[8][10].settlement.type).toBe('capital');
        // Its lands are the painted ones, and the town in them is its own
        expect(green.territory.length).toBe(88);
        expect(world.tiles[11][7].settlement.kingdom).toBe('sylvaris');
        expect(world.tiles[4][4].kingdom).not.toBe('sylvaris');
        // A realm of the maker's own: its colour and culture
        expect(ash.color).toBe('#334455');
        expect(ash.culture).toBe('Nordic');
        expect(ash.territory.length).toBeGreaterThan(10);
    });

    it('falls back to random realms when none were placed', () => {
        const world = load(editorWorld({ rules: { kingdomCount: 3 } }));
        expect(world.kingdoms.length).toBe(3);
        expect(world.kingdoms.every(k => k.capital)).toBe(true);
    });

    it('starts the player where the map says', () => {
        const world = load(editorWorld({ playerStart: { q: 17, r: 14 } }));
        const player = new Player({ firstName: 'Test', lastName: '', gender: 'male', age: 20 });
        player.placeInWorld(world);
        expect([player.q, player.r]).toEqual([17, 14]);
    });

    it('rebuilds the same map from the saved generation params', () => {
        const data = editorWorld({
            overlays: { '8,8': { type: 'town', name: 'Oakhollow' } },
            realms: [{ id: 'valdoria', capital: { q: 28, r: 15 } }],
        });
        const first = load(data);
        Utils.setSeed(999); // a different outer RNG must not matter
        const again = new World(first.width, first.height);
        again.generate(first.generationParams);
        // Terrain, realms and what the map maker placed (a save restores the
        // rest — settlements, units — from its own record)
        const sig = (w) => w.tiles.flat().map(t => `${t.terrain.id}:${t.kingdom || ''}:${t.hasRoad}:${t.hasRiver}:${t.resource ? t.resource.id : ''}`).join('|');
        expect(sig(again)).toBe(sig(first));
        expect(again.tiles[8][8].settlement.name).toBe('Oakhollow');
        expect(again.kingdoms.map(k => k.capital)).toEqual(first.kingdoms.map(k => k.capital));
    });
});
