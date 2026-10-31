/**
 * The walking NPCs of a town are its persistent townsfolk: the same people on
 * every visit, older each time — and the dialog memory goes with them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcDisposition } from '../systems/npcDisposition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INNER_MAP_JSON = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/innerMap.json'), 'utf-8'));

const Y = 120;

function makeGame() {
    const settlement = { name: 'Testby', type: 'town', population: 1200, q: 5, r: 6 };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
        getTile: () => worldTile,
        getSettlementViews: () => [settlement, { name: 'Elsewhere' }],
        getKingdom: () => null,
    };
    return { world, player: {}, settlement };
}

beforeEach(() => {
    InnerMap.initialize(JSON.parse(JSON.stringify(INNER_MAP_JSON)));
    InnerMap._cache = {};
    DataLoader._gamedata = { terrainNineTileBrushes: [] };
});

describe('Townsfolk on the inner map', () => {
    it('shows the same people, older, after ten years', () => {
        const game = makeGame();
        InnerMap.enter(game, 5, 6);
        const first = InnerMap.npcs.filter(n => n.uid);
        expect(first.length).toBeGreaterThan(10);
        expect(InnerMap.npcs.filter(n => n.type === 'traveler').every(n => !n.uid)).toBe(true);
        const child = first.find(n => n.type === 'child');
        NpcDisposition.getMemory(child).timesSpoken = 2;
        Townsfolk.noteSeen(child, game.world.day);
        const before = new Map(first.map(n => [n.uid, n.age]));
        const childUid = child.uid;
        InnerMap.exit(game);

        while (game.world.day < 1 + 10 * Y) {
            game.world.day++;
            Townsfolk.processDay(game.world);
        }

        InnerMap.enter(game, 5, 6);
        const again = InnerMap.npcs.filter(n => n.uid);
        const survivors = again.filter(n => before.has(n.uid));
        expect(survivors.length).toBeGreaterThan(5);
        for (const n of survivors) expect(n.age).toBe(before.get(n.uid) + 10);

        const person = game.settlement.folk.people.find(p => `5,6#${p.id}` === childUid);
        if (person.died == null && !person.away) {
            const grown = again.find(n => n.uid === childUid);
            expect(grown.type).not.toBe('child');
            expect(NpcDisposition.getMemory(grown).timesSpoken).toBe(2);
            expect(Townsfolk.reunionLine(grown, game.world)).toMatch(/I was only a child of/);
        }
        // Kin on the map point at each other by map id
        const married = again.find(n => n.spouseId != null);
        if (married) expect(InnerMap.npcs.find(n => n.id === married.spouseId).spouseId).toBe(married.id);
    });

    it('keeps the roster through a save round-trip of the settlement', () => {
        const game = makeGame();
        InnerMap.enter(game, 5, 6);
        const names = InnerMap.npcs.filter(n => n.uid).map(n => n.fullName).sort();
        InnerMap.exit(game);
        game.settlement.folk = JSON.parse(JSON.stringify(game.settlement.folk));
        InnerMap.enter(game, 5, 6);
        expect(InnerMap.npcs.filter(n => n.uid).map(n => n.fullName).sort()).toEqual(names);
    });
});
