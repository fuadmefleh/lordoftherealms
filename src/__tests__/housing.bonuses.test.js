// House bonuses that reach the player: a night at home restores extra
// stamina (house staminaBonus + homeRestBonus); away from home there's none.

import { describe, it, expect, beforeAll } from 'vitest';
import { Player } from '../player/player.js';
import { Housing } from '../systems/housing.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function homeowner(atHome) {
    const p = new Player();
    p.q = 4; p.r = 4;
    p.houses = [{ id: 'h1', typeId: 'shack', q: atHome ? 4 : 9, r: atHome ? 4 : 9, upgrades: [], condition: 100 }];
    p.inventory = { bread: 10 };
    return p;
}

describe('Housing bonuses', () => {
    it('resting at home restores extra stamina', () => {
        const home = homeowner(true);
        const away = homeowner(false);
        expect(Housing.getHomeStaminaBonus(home)).toBeGreaterThan(0);
        expect(Housing.getHomeStaminaBonus(away)).toBe(0);
        home.endDay();
        away.endDay();
        expect(home.movementRemaining - away.movementRemaining).toBe(Housing.getHomeStaminaBonus(home));
    });
});
