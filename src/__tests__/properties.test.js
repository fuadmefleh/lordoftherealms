// Property types and production chains.
// Covers the data (every property type loads from playerEconomy.json, with
// valid recipes/goods), the Mill, same-tile supply chains, and the
// several-properties-per-tile bookkeeping.

import { describe, it, expect, beforeAll } from 'vitest';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Technology } from '../systems/technology.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(tileOverrides = {}) {
    const tile = {
        q: 3, r: 4,
        terrain: { id: 'plains', passable: true },
        settlement: null, resource: null, hasRiver: false,
        playerProperties: null, playerProperty: null,
        ...tileOverrides,
    };
    return { tile, getTile: (q, r) => (q === tile.q && r === tile.r ? tile : null), width: 50 };
}

function makePlayer() {
    return { gold: 100000, properties: [], inventory: {}, skills: { commerce: 0 } };
}

/** Focus a recipe building on its tile and pick its recipe, as the manage menu does. */
function setRecipe(world, player, prop, recipeId) {
    world.tile.playerProperty = prop;
    expect(PlayerEconomy.setWorkshopRecipe(world.tile, recipeId, player).success).toBe(true);
}

/** Build a property and skip its construction time. */
function build(player, type, world) {
    const result = PlayerEconomy.buildProperty(player, type, world.tile, world);
    expect(result.success, result.reason).toBe(true);
    const prop = PlayerEconomy.findPropertyAt(world.tile, PlayerEconomy.PROPERTY_TYPES[type].id);
    prop.underConstruction = false;
    return prop;
}

describe('Property data', () => {
    it('loads the full catalogue from data, including the Mill and new producers', () => {
        for (const key of ['GRAIN_MILL', 'BAKERY', 'FORGE', 'QUARRY', 'WINERY',
            'HUNTING_LODGE', 'CATTLE_RANCH', 'HERB_GARDEN', 'HORSE_RANCH', 'FORAGER_HUT']) {
            expect(PlayerEconomy.PROPERTY_TYPES[key], key).toBeTruthy();
        }
        expect(PlayerEconomy.PROPERTY_TYPES.GRAIN_MILL.name).toBe('Mill');
    });

    it('only references recipes and goods that exist', () => {
        for (const [key, def] of Object.entries(PlayerEconomy.PROPERTY_TYPES)) {
            for (const r of def.allowedRecipes || []) expect(PlayerEconomy.RECIPES[r], `${key} → ${r}`).toBeTruthy();
            if (def.produces && def.produces !== 'gold') {
                expect(PlayerEconomy.GOODS[def.produces.toUpperCase()], `${key} → ${def.produces}`).toBeTruthy();
            }
        }
        for (const [key, r] of Object.entries(PlayerEconomy.RECIPES)) {
            expect(PlayerEconomy.GOODS[r.input.toUpperCase()], `${key} input`).toBeTruthy();
            expect(PlayerEconomy.GOODS[r.output.toUpperCase()], `${key} output`).toBeTruthy();
        }
    });

    it('treats workshops, mills and tech mills as recipe buildings, farms not', () => {
        expect(PlayerEconomy.isRecipeBuilding('workshop')).toBe(true);
        expect(PlayerEconomy.isRecipeBuilding('grain_mill')).toBe(true);
        expect(PlayerEconomy.isRecipeBuilding('farm')).toBe(false);
        // Tech buildings are keyed differently from their ids
        expect(Technology.TECH_BUILDINGS.WINDMILL).toBeTruthy();
        expect(PlayerEconomy.isRecipeBuilding('windmill_building')).toBe(true);
        expect(PlayerEconomy.isRecipeBuilding('water_mill_building')).toBe(true);
    });
});

describe('Mill and same-tile supply chains', () => {
    it('a Mill beside a Farm grinds the day\'s harvest without any hauling', () => {
        const world = makeWorld();
        const player = makePlayer();
        const farm = build(player, 'FARM', world);
        const mill = build(player, 'GRAIN_MILL', world);
        setRecipe(world, player, mill, 'FLOUR');

        const production = PlayerEconomy.produceGoods(player, world);

        // Farm makes 10 grain; the mill (rate 8 → 4 runs of 2→2) takes 8 of it
        expect(production.grain).toBe(10);
        expect(production.flour).toBe(8);
        expect(farm.storage).toBe(2);
        expect(mill.storage).toBe(8);
    });

    it('a Mill on a river gets the water-wheel bonus', () => {
        const dry = makeWorld();
        const wet = makeWorld({ hasRiver: true });
        const run = (world) => {
            const player = makePlayer();
            const mill = build(player, 'GRAIN_MILL', world);
            setRecipe(world, player, mill, 'FLOUR');
            mill.inputStorage = 100;
            return PlayerEconomy.produceGoods(player, world).flour;
        };
        expect(run(dry)).toBe(8);
        expect(run(wet)).toBe(12);
    });

    it('an unpaid property idles and keeps its inputs', () => {
        const world = makeWorld();
        const player = makePlayer();
        const mill = build(player, 'GRAIN_MILL', world);
        setRecipe(world, player, mill, 'FLOUR');
        mill.inputStorage = 20;
        player.gold = 0;

        PlayerEconomy.produceGoods(player, world);

        expect(mill.inputStorage).toBe(20);
        expect(mill.storage).toBe(0);
    });
});

describe('Several properties on one tile', () => {
    it('each property produces once, for itself', () => {
        const world = makeWorld();
        const player = makePlayer();
        const farm = build(player, 'FARM', world);
        const ranch = build(player, 'CATTLE_RANCH', world);

        const production = PlayerEconomy.produceGoods(player, world);

        expect(production).toEqual({ grain: 10, meat: 8 });
        expect(farm.storage).toBe(10);
        expect(ranch.storage).toBe(8);
    });

    it('collects every property\'s goods but never a tavern\'s earnings tally', () => {
        const world = makeWorld({ settlement: { name: 'Ashford', type: 'town', population: 400 } });
        const player = makePlayer();
        const farm = build(player, 'FARM', world);
        const tavern = build(player, 'TAVERN', world);
        farm.storage = 7;
        tavern.storage = 500;

        const collected = PlayerEconomy.collectGoods(player, world);

        expect(collected).toEqual({ grain: 7 });
        expect(player.inventory.gold).toBeUndefined();
        expect(tavern.storage).toBe(500);
    });
});
