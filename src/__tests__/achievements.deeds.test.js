// Achievements that were defined only in data (no check function) and so
// could never unlock. They now read quest counters and player records.

import { describe, it, expect, beforeAll } from 'vitest';
import { Achievements } from '../systems/achievements.js';
import { Quests } from '../systems/quests.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makePlayer() {
    const player = { gold: 0, karma: 0, renown: 0, army: [], reputation: {}, properties: [] };
    Quests.initialize(player);
    Achievements.initialize(player);
    return player;
}

const unlockedIds = (player, world) => Achievements.checkAchievements(player, world).map(a => a.id);

describe('Deed achievements', () => {
    it('every data achievement has a check', () => {
        const json = DataLoader._gamedata.achievements.achievements || DataLoader._gamedata.achievements;
        const unchecked = Object.keys(json).filter(k => typeof (Achievements.ACHIEVEMENTS[k] || {}).check !== 'function');
        expect(unchecked).toEqual([]);
    });

    it('first kill and ruin delver unlock from quest counters', () => {
        const player = makePlayer();
        const world = { kingdoms: [] };
        expect(unlockedIds(player, world)).not.toContain('first_kill');
        Quests.track(player, 'battles_won');
        Quests.track(player, 'ruins_explored', 10);
        const ids = unlockedIds(player, world);
        expect(ids).toContain('first_kill');
        expect(ids).toContain('ruin_delver');
    });

    it('globe trotter needs every living kingdom visited', () => {
        const player = makePlayer();
        const world = { kingdoms: [{ id: 'a', isAlive: true }, { id: 'b', isAlive: true }, { id: 'c', isAlive: false }] };
        player.kingdomsVisited = ['a'];
        expect(unlockedIds(player, world)).not.toContain('globe_trotter');
        player.kingdomsVisited.push('b');
        expect(unlockedIds(player, world)).toContain('globe_trotter');
    });
});
