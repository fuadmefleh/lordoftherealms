// Planks can be made wherever the wood is: by hand on trestles (a field recipe,
// offered as a world-map action with wood in the packs), at a Sawmill (its
// PLANKS recipe, on any land), and by village sawyers (markets.json).
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Crafting } from '../player/crafting.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { addWildernessActions } from '../player/actions/wildernessActions.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => { await loadData(); });

describe('making planks', () => {
    it('saw planks is a field recipe, offered anywhere with wood in the packs', () => {
        const field = Crafting.recipes('craft').filter(r => r.field);
        expect(field.map(r => r.id)).toContain('saw_planks');
        const { world, player } = newGame(101);
        const tile = world.getTile(player.q, player.r);
        const types = (inv) => { player.inventory = inv; const a = []; addWildernessActions(a, player, tile, world); return a.map(x => x.type); };
        expect(types({ wood: 0 })).not.toContain('saw_planks');
        expect(types({ wood: 4 })).toContain('saw_planks');
    });

    it('a sawmill saws planks and stands on any land', () => {
        const def = PlayerEconomy.getPropertyDef('sawmill');
        expect(def.allowedRecipes[0]).toBe('PLANKS');
        expect(PlayerEconomy.RECIPES.PLANKS.output).toBe('planks');
        for (const t of ['savanna', 'swamp', 'tundra', 'highlands', 'woodland']) expect(def.requiredTerrain).toContain(t);
    });

    it('villages keep and saw planks', () => {
        const M = DataLoader._gamedata.markets;
        const goods = M.goods || {};
        expect((goods.planks || {}).minType).toBe('village');
        expect((M.recipes || []).find(r => r.id === 'sawyer').minType).toBe('village');
    });
});
