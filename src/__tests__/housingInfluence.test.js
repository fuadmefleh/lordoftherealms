// Housing "influence" does something: a house gives better prices with that
// town's merchants, total influence strengthens negotiations with lords, and
// the Great Hall really does "dramatically increase influence".

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Housing } from '../systems/housing.js';
import { PlayerEffects } from '../player/playerEffects.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const typeId = () => Housing._getHouseTypes()[0].id;
const house = (extra = {}) => ({ q: 3, r: 4, typeId: typeId(), upgrades: [], condition: 100, settlementName: 'Brightwater', ...extra });

describe('housing influence', () => {
    it('a house gives local influence only in its own town', () => {
        const player = { houses: [house()] };
        expect(Housing.getLocalInfluence(player, { q: 3, r: 4 })).toBe(5);
        expect(Housing.getLocalInfluence(player, { name: 'Brightwater' })).toBe(5);
        expect(Housing.getLocalInfluence(player, { q: 9, r: 9, name: 'Elsewhere' })).toBe(0);
    });

    it('the Great Hall adds a large influence bonus', () => {
        const plain = Housing.getHouseInfluence(house({ upgrades: ['trophy_room'] }));
        const hall = Housing.getHouseInfluence(house({ upgrades: ['great_hall'] }));
        expect(hall - plain).toBe(10);
    });

    it('local influence improves trade prices there', () => {
        const owner = { houses: [house()], skills: {}, inventory: {} };
        const stranger = { houses: [], skills: {}, inventory: {} };
        const town = { q: 3, r: 4, name: 'Brightwater', kingdom: null };
        expect(PlayerEffects.tradeBonus(owner, town) - PlayerEffects.tradeBonus(stranger, town)).toBeCloseTo(0.015, 5);
    });

    it('total influence helps negotiations with lords', () => {
        const owner = { houses: [house(), house({ q: 5, r: 5, settlementName: 'Oakmere' })], skills: {} };
        const stranger = { houses: [], skills: {} };
        expect(PlayerEffects.negotiationBonus(owner) - PlayerEffects.negotiationBonus(stranger)).toBeCloseTo(0.02, 5);
    });

    it('total influence is capped', () => {
        const many = Array.from({ length: 30 }, (_, i) => house({ q: i, r: 0, settlementName: `T${i}` }));
        expect(Housing.getInfluence({ houses: many })).toBe(50);
    });
});
