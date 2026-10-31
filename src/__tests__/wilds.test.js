// Wilderness encounters: hash-placed on wilderness inner maps, resolved through
// choices with odds (player/wilds.js), remembered per hex and saved; the minor
// points of interest use the same engine.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Wilds } from '../player/wilds.js';
import { InnerMap } from '../world/innerMap.js';
import { Traits } from '../systems/traits.js';
import { Ailments } from '../systems/ailments.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { World } from '../world/world.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    Wilds._loaded = false;
    Wilds._ensureLoaded();
});

beforeEach(() => {
    Utils.setSeed(1234);
});

function makePlayer(extra = {}) {
    const p = new Player({ firstName: 'Ash', lastName: 'Wend' });
    p.gold = 100;
    p.health = 80;
    p.maxHealth = 100;
    p.movementRemaining = 6;
    p.inventory = {};
    Object.assign(p, extra);
    return p;
}

function mockWorld(extra = {}) {
    const tiles = new Map();
    return {
        day: 10, width: 40, height: 40, units: [], kingdoms: [],
        generationParams: { seed: 'wilds-test' },
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: () => null,
        getAllSettlements: () => [],
        _tiles: tiles,
        ...extra,
    };
}

function openTiles(n = 64) {
    const tiles = [];
    for (let r = 0; r < n; r++) {
        const row = [];
        for (let q = 0; q < n; q++) row.push({ q, r, subTerrain: { passable: true }, encounter: null });
        tiles.push(row);
    }
    return tiles;
}

/** A small encounter for engine tests (installed under a test id). */
function withTestEncounter(def) {
    Wilds.ENCOUNTERS.__test = { name: 'Test', icon: '?', description: 'x', text: 'x', ...def };
    return '__test';
}

describe('content', () => {
    it('every encounter, biome list and POI set is valid', () => {
        expect(Wilds.validate()).toEqual([]);
    });

    it('covers every biome with several encounters, each with 2–3 choices', () => {
        const biomes = Object.keys(Wilds.BIOMES);
        expect(biomes.length).toBeGreaterThanOrEqual(18);
        for (const b of biomes) {
            expect(Wilds.BIOMES[b].length, b).toBeGreaterThanOrEqual(4);
            for (const id of Wilds.BIOMES[b]) {
                const n = Wilds.ENCOUNTERS[id].choices.length;
                expect(n >= 2 && n <= 3, id).toBe(true);
            }
        }
        expect(Object.keys(Wilds.ENCOUNTERS).length).toBeGreaterThanOrEqual(100);
    });

    it('uses the existing systems across the set, and not only fights', () => {
        const kinds = new Set();
        for (const enc of Object.values(Wilds.ENCOUNTERS)) {
            for (const c of enc.choices) {
                for (const o of [c.success, c.failure]) for (const k of Object.keys(o || {})) kinds.add(k);
            }
        }
        for (const k of ['forage', 'hunt', 'ailment', 'wound', 'gold', 'items', 'prices', 'lead', 'lore', 'chart', 'reveal', 'rumour', 'skills', 'deeds']) {
            expect(kinds.has(k), k).toBe(true);
        }
    });

    it('every POI encounter has an option a penniless, empty-handed player can take (the AP is already spent)', () => {
        const poor = makePlayer({ gold: 0, inventory: {} });
        for (const [type, ids] of Object.entries(Wilds.POI_SETS)) {
            for (const id of ids) {
                expect(Wilds.ENCOUNTERS[id].choices.some(c => Wilds.canChoose(poor, c).ok), `${type}/${id}`).toBe(true);
            }
        }
    });
});

describe('placement', () => {
    it('is a pure hash of seed and hex: same plan twice, draws no RNG', () => {
        const before = Utils.random();
        Utils.setSeed(1234);
        let found = null;
        for (let q = 0; q < 30 && !found; q++) {
            const plan = InnerMap.planWildEncounters(openTiles(), 'woodland', q, 7, 'seed-a');
            if (plan.length) found = { q, plan };
        }
        expect(found).not.toBeNull();
        const again = InnerMap.planWildEncounters(openTiles(), 'woodland', found.q, 7, 'seed-a');
        expect(again).toEqual(found.plan);
        expect(Utils.random()).toBe(before);
        for (const p of found.plan) expect(Wilds.BIOMES.woodland).toContain(p.id);
        expect(new Set(found.plan.map(p => p.id)).size).toBe(found.plan.length);
    });

    it('varies with the world seed and leaves resolved slots empty', () => {
        let a = 0;
        let b = 0;
        let diff = 0;
        for (let q = 0; q < 40; q++) {
            const pa = InnerMap.planWildEncounters(openTiles(), 'plains', q, 3, 'seed-a');
            const pb = InnerMap.planWildEncounters(openTiles(), 'plains', q, 3, 'seed-b');
            a += pa.length;
            b += pb.length;
            if (JSON.stringify(pa) !== JSON.stringify(pb)) diff++;
            if (pa.length) {
                const skipped = InnerMap.planWildEncounters(openTiles(), 'plains', q, 3, 'seed-a', [pa[0].slot]);
                expect(skipped.find(p => p.slot === pa[0].slot)).toBeUndefined();
                expect(skipped.length).toBe(pa.length - 1);
            }
        }
        expect(a).toBeGreaterThan(10);
        expect(b).toBeGreaterThan(10);
        expect(diff).toBeGreaterThan(10);
    });

    it('avoids impassable, built and central tiles', () => {
        const tiles = openTiles();
        for (let r = 0; r < 64; r++) for (let q = 0; q < 32; q++) tiles[r][q].subTerrain.passable = false;
        for (let q = 0; q < 200; q++) {
            for (const p of InnerMap.planWildEncounters(tiles, 'grassland', q, 1, 'x')) {
                expect(p.q).toBeGreaterThanOrEqual(32);
                expect(Math.max(Math.abs(p.q - 32), Math.abs(p.r - 32))).toBeGreaterThanOrEqual(6);
            }
        }
    });

    it('generate() puts encounters on wilderness maps only, and skips what the player resolved', () => {
        const game = { world: mockWorld(), player: makePlayer() };
        let hit = null;
        for (let q = 0; q < 20 && !hit; q++) {
            const tiles = InnerMap.generate({ terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5 }, q, 4, game);
            const encs = tiles.flat().filter(t => t.encounter);
            if (encs.length) hit = { q, encs };
        }
        expect(hit).not.toBeNull();
        const e = hit.encs[0].encounter;
        expect(e.wq).toBe(hit.q);
        expect(Wilds.def(e.id)).toBeTruthy();
        expect(hit.encs[0].subTerrain.passable).toBe(true);

        game.player.wilds = { resolved: { [`${hit.q},4`]: hit.encs.map(t => t.encounter.slot) } };
        const again = InnerMap.generate({ terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5 }, hit.q, 4, game);
        expect(again.flat().filter(t => t.encounter)).toHaveLength(0);

        const town = InnerMap.generate({ terrain: { id: 'grassland' }, settlement: { name: 'X', type: 'village', population: 100 }, elevation: 0.5, temperature: 0.5, moisture: 0.5 }, hit.q, 4, { world: mockWorld(), player: makePlayer() });
        expect(town.flat().filter(t => t.encounter)).toHaveLength(0);
    });
});

describe('odds and requirements', () => {
    it('attributes, skills, gear, companions and traits move the odds, clamped', () => {
        const p = makePlayer({ strength: 5, skills: { combat: 0 } });
        const choice = { check: { base: 0.5, stat: 'strength', skill: 'combat', items: { rope: 0.1 }, traits: { brave: 0.1 } } };
        expect(Wilds.chance(p, choice)).toBeCloseTo(0.5);
        p.strength = 7;
        expect(Wilds.chance(p, choice)).toBeCloseTo(0.6);
        p.skills.combat = 5;
        expect(Wilds.chance(p, choice)).toBeCloseTo(0.8);
        p.inventory.rope = 1;
        expect(Wilds.chance(p, choice)).toBeCloseTo(0.9);
        Traits.grantTraits(p, ['brave']);
        expect(Wilds.chance(p, choice)).toBe(0.95);
        expect(Wilds.chance(p, { label: 'safe' })).toBeNull();
        expect(Wilds.oddsLabel(null)).toBe('certain');
    });

    it('requires gates a choice without consuming', () => {
        const p = makePlayer();
        const c = { requires: { items: { bow: 1 }, gold: 50 } };
        expect(Wilds.canChoose(p, c).ok).toBe(false);
        p.inventory.bow = 1;
        expect(Wilds.canChoose(p, c).ok).toBe(true);
        p.gold = 10;
        expect(Wilds.canChoose(p, c).reason).toMatch(/gold/);
        expect(Wilds.canChoose(p, { requires: { companions: ['healer'] } }).reason).toMatch(/healer/);
        expect(Wilds.canChoose(p, { requires: { traits: ['pious'] } }).ok).toBe(false);
        expect(Wilds.canChoose(p, { requires: { skills: { stealth: 9 } } }).ok).toBe(false);
    });

    it('describe() reports odds, costs and gates for the UI', () => {
        const p = makePlayer();
        const d = Wilds.describe(p, 'wolf');
        expect(d.name).toBeTruthy();
        expect(d.choices.length).toBeGreaterThanOrEqual(2);
        for (const c of d.choices) {
            expect(typeof c.odds).toBe('string');
            expect(c.can).toHaveProperty('ok');
        }
    });
});

describe('resolving', () => {
    it('pays the cost, rolls seeded, books gold in the ledger and remembers the slot', () => {
        const id = withTestEncounter({
            choices: [
                { id: 'go', label: 'Go', cost: { stamina: 2 }, check: { base: 0.5 }, success: { text: 'won', gold: 30 }, failure: { text: 'lost', gold: -20 } },
                { id: 'safe', label: 'Safe', success: { text: 'ok' } },
            ],
        });
        const outcomes = [];
        for (let i = 0; i < 2; i++) {
            Utils.setSeed(77);
            const p = makePlayer();
            const res = Wilds.resolve(p, mockWorld(), { id, wq: 3, wr: 4, slot: 1, terrain: 'woodland' }, 'go');
            expect(res.success).toBe(true);
            expect(p.movementRemaining).toBe(4);
            outcomes.push([res.passed, p.gold]);
            const booked = p.financeToday.income.exploration || -(p.financeToday.expenses.exploration || 0);
            expect(booked).toBe(p.gold - 100);
            expect(Wilds.isResolved(p, 3, 4, 1)).toBe(true);
            expect(Wilds.resolve(p, mockWorld(), { id, wq: 3, wr: 4, slot: 1 }, 'go').success).toBe(false);
            expect(p.wilds.journal).toHaveLength(1);
        }
        expect(outcomes[0]).toEqual(outcomes[1]);
    });

    it('items respect the inventory cap; forage and hunt bank through the craft trips', () => {
        const id = withTestEncounter({
            choices: [
                { id: 'loot', label: 'Loot', success: { text: 'x', items: { iron: 3 } } },
                { id: 'land', label: 'Land', success: { text: 'y', forage: 2, hunt: true } },
            ],
        });
        const p = makePlayer();
        const cap = PlayerInventory.getFreeSlots(p);
        for (let i = 0; i < cap; i++) p.inventory[`filler_${i}`] = 1;
        const full = Wilds.resolve(p, mockWorld(), { id, wq: 0, wr: 0, terrain: 'woodland' }, 'loot');
        expect(full.lines.join(' ')).toMatch(/left behind/);
        expect(p.inventory.iron).toBeUndefined();

        const q = makePlayer();
        const res = Wilds.resolve(q, mockWorld(), { id, wq: 0, wr: 0, terrain: 'woodland' }, 'land');
        expect(res.success).toBe(true);
        expect(q.foragingTrips).toBe(1);
        expect(q.huntingTrips).toBe(1);
        expect(Object.keys(q.inventory).length).toBeGreaterThan(0);
    });

    it('harm, ailments, skills, deeds and traits land on the player', () => {
        const id = withTestEncounter({
            choices: [
                { id: 'hurt', label: 'Hurt', success: { text: 'ow', health: -10, ailment: 'bite_wound' } },
                { id: 'grow', label: 'Grow', success: { text: 'yes', skills: { stealth: 1 }, deeds: { mercy: 1 }, traits: ['wanderer'], karma: 3, renown: 2 } },
            ],
        });
        const p = makePlayer();
        Wilds.resolve(p, mockWorld(), { id, wq: 0, wr: 0 }, 'hurt');
        expect(p.health).toBeLessThan(80);
        expect(Ailments.has(p, 'bite_wound')).toBe(true);
        const before = (p.skills && p.skills.stealth) || 0;
        Wilds.resolve(p, mockWorld(), { id, wq: 0, wr: 0 }, 'grow');
        expect(p.skills.stealth).toBe(before + 1);
        expect(Traits.has(p, 'wanderer')).toBe(true);
        expect(p.traits.deeds.mercy).toBeGreaterThan(0);
    });

    it('refuses a choice the player cannot pay for', () => {
        const id = withTestEncounter({
            choices: [
                { id: 'pay', label: 'Pay', cost: { gold: 500 }, success: { text: 'x' } },
                { id: 'safe', label: 'Safe', success: { text: 'ok' } },
            ],
        });
        const p = makePlayer();
        const res = Wilds.resolve(p, mockWorld(), { id, wq: 0, wr: 0, slot: 0 }, 'pay');
        expect(res.success).toBe(false);
        expect(p.gold).toBe(100);
        expect(Wilds.isResolved(p, 0, 0, 0)).toBe(false);
    });
});

describe('in a generated world', () => {
    let world;
    beforeAll(() => {
        Utils.setSeed(11);
        world = new World(40, 30);
        world.generate({ kingdomCount: 3 });
        world.day = 50;
    });

    it('reveal charts the country; prices learn the nearest markets; a rumour starts', () => {
        const id = withTestEncounter({
            choices: [
                { id: 'all', label: 'All', success: { text: 'x', reveal: 3, prices: 2, rumour: 'wilds_rescue' } },
                { id: 'safe', label: 'Safe', success: { text: 'ok' } },
            ],
        });
        const s = world.getSettlementViews()[0];
        const p = makePlayer();
        p.q = s.q;
        p.r = s.r;
        for (const row of world.tiles) for (const t of row) t.explored = false;
        const res = Wilds.resolve(p, world, { id, wq: s.q, wr: s.r + 2, terrain: 'grassland' }, 'all');
        expect(res.success).toBe(true);
        expect(world.tiles.flat().filter(t => t.explored).length).toBeGreaterThan(10);
        expect(res.lines.some(l => /learn the prices/.test(l))).toBe(true);
        expect(Object.keys(p.priceBook.towns || p.priceBook).length).toBeGreaterThan(0);
        expect(p.gossip.rumors.some(r => r.type === 'wilds_rescue')).toBe(true);
    });

    it('every wilderness encounter in the data resolves without throwing', () => {
        const ctxFor = (id) => ({ id, wq: 5, wr: 5, terrain: 'woodland' });
        for (const [id, enc] of Object.entries(Wilds.ENCOUNTERS)) {
            if (id === '__test') continue;
            for (const c of enc.choices) {
                Utils.setSeed(id.length + c.id.length);
                const p = makePlayer({ inventory: { bow: 1, rope: 1, meat: 2, herbs: 2, healing_salve: 1, lantern: 1, holy_water: 1, bread: 2, weapons: 1, tools: 1 }, gold: 500 });
                if (!Wilds.canChoose(p, c).ok) continue;
                const res = Wilds.resolve(p, world, ctxFor(id), c.id);
                expect(res.success, `${id}.${c.id}`).toBe(true);
                expect(p.health).toBeGreaterThanOrEqual(1);
            }
        }
    });

    it('a minor POI holds a fixed encounter from its set; finishing marks it explored and hands over hidden maps', () => {
        const tile = world.tiles.flat().find(t => t.terrain.passable && !t.settlement);
        tile.improvement = { type: 'shrine', name: 'Roadside Shrine', icon: '⛩️', explored: false, loot: [{ type: 'ancient', name: 'Old Chart', tiles: [] }] };
        const a = Wilds.poiEncounterId(world, tile);
        expect(Wilds.POI_SETS.shrine).toContain(a);
        expect(Wilds.poiEncounterId(world, tile)).toBe(a);
        const p = makePlayer();
        const safe = Wilds.ENCOUNTERS[a].choices.find(c => !c.check && Wilds.canChoose(p, c).ok);
        expect(Wilds.resolve(p, world, { id: a, wq: tile.q, wr: tile.r, terrain: tile.terrain.id, poi: { type: 'shrine' } }, safe.id).success).toBe(true);
        const fin = Wilds.finishPoi(p, world, tile);
        expect(tile.improvement.explored).toBe(true);
        expect(p.maps.some(m => m.name === 'Old Chart')).toBe(true);
        expect(fin.lines.some(l => /Old Chart/.test(l))).toBe(true);
        expect(p.wilds.stats.poi).toBe(1);
        tile.improvement = { type: 'ruins', name: 'Ruins' };
        expect(Wilds.poiEncounterId(world, tile)).toBeNull();
        delete tile.improvement;
    });
});

describe('saving', () => {
    it('resolved slots and the journal survive a save/load round trip', () => {
        const id = withTestEncounter({ choices: [{ id: 'a', label: 'A', success: { text: 'x' } }, { id: 'b', label: 'B', success: { text: 'y' } }] });
        const p = makePlayer();
        Wilds.resolve(p, mockWorld(), { id, wq: 9, wr: 2, slot: 2 }, 'a');
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(Wilds.isResolved(back, 9, 2, 2)).toBe(true);
        expect(back.wilds.journal).toHaveLength(1);
        expect(Wilds.getState(back).stats.resolved).toBe(1);
    });
});
