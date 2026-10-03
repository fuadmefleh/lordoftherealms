// Tech effects that reach gameplay: stonecutting cuts building costs,
// commerce techs raise sale revenue, cartography widens sight.

import { describe, it, expect, beforeAll } from 'vitest';
import { Technology } from '../systems/technology.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { Player } from '../player/player.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function withTechs(player, ids) {
    Technology.initPlayer(player);
    player.technology.implemented = ids;
    return player;
}

describe('Technology bonuses in play', () => {
    it('stonecutting makes properties cheaper to build', () => {
        const farm = PlayerEconomy.PROPERTY_TYPES.FARM;
        const plain = withTechs({ gold: 0 }, []);
        const mason = withTechs({ gold: 0 }, ['stonecutting']);
        expect(PlayerEconomy.getBuildCost(plain, farm)).toBe(farm.cost);
        expect(PlayerEconomy.getBuildCost(mason, farm)).toBe(Math.round(farm.cost * 0.85));
    });

    it('basic accounting raises market sale revenue', () => {
        const sell = (techs) => {
            const p = withTechs({ gold: 0, inventory: { iron: 10 }, skills: { commerce: 1 } }, techs);
            return Trading.sellGoods(p, 'iron', 10).earned;
        };
        expect(sell(['basic_accounting'])).toBe(Math.floor(sell([]) * 1.15));
    });

    it('cartography widens the sight radius', () => {
        const tiles = Array.from({ length: 20 }, (_, r) =>
            Array.from({ length: 20 }, (_, q) => ({ q, r, explored: false, visible: false, terrain: { id: 'plains' } })));
        const world = { width: 20, height: 20, tiles, getTile: (q, r) => (tiles[r] ? tiles[r][((q % 20) + 20) % 20] : null) };
        const seen = (techs) => {
            for (const row of tiles) for (const t of row) { t.explored = false; t.visible = false; }
            const p = withTechs(new Player(), techs);
            p.q = 10; p.r = 10;
            p.updateVisibility(world, 3);
            return tiles.flat().filter(t => t.visible).length;
        };
        expect(seen(['cartography'])).toBeGreaterThan(seen([]));
    });
});
