// Quest board, acceptance and progress.
// The journal offers quests from the full template catalogue (harder tiers
// unlock with progress); accepted quests progress from player state or from
// event counters recorded with Quests.track().

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Quests } from '../systems/quests.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(12345));

function makePlayer(overrides = {}) {
    const player = { gold: 100, karma: 0, renown: 0, properties: [], army: [], reputation: {}, ...overrides };
    Quests.initialize(player);
    return player;
}

const world = { width: 2, height: 1, tiles: [[{ explored: true, terrain: { id: 'mountain' } }, { explored: false, terrain: { id: 'plains' } }]] };

describe('Quest board', () => {
    it('loads every data template plus the code-only artifact quests', () => {
        expect(Object.keys(Quests.QUEST_TEMPLATES).length).toBeGreaterThanOrEqual(45);
        expect(Quests.QUEST_TEMPLATES.ARTIFACT_CROWN_EMBERS).toBeTruthy();
    });

    it('offers a full board of easy quests to a new player, never the starter', () => {
        const player = makePlayer();
        const offers = player.quests.available;
        expect(offers).toHaveLength(Quests.MAX_AVAILABLE);
        for (const q of offers) {
            expect(q).toBeTruthy();
            expect(q.difficulty).toBe('easy');
            expect(q.id).not.toBe('a_new_beginning');
        }
        expect(new Set(offers.map(q => q.id)).size).toBe(offers.length);
    });

    it('unlocks harder tiers with renown', () => {
        expect(Quests._unlockedDifficulties(makePlayer())).toEqual(['easy']);
        expect(Quests._unlockedDifficulties(makePlayer({ renown: 150 }))).toEqual(['easy', 'medium', 'hard']);
    });

    it('offers an artifact quest once a fragment is found', () => {
        const player = makePlayer({ artifacts: { fragments: { crown_embers: 1 } } });
        player.quests.available = [];
        Quests.generateAvailableQuests(player);
        expect(player.quests.available.some(q => q.id === 'artifact_crown_embers')).toBe(true);
    });

    it('accepting moves a quest to active and refills the board', () => {
        const player = makePlayer();
        const first = player.quests.available[0];
        const result = Quests.acceptQuest(player, first.id);
        expect(result.success).toBe(true);
        expect(player.quests.active.map(q => q.id)).toContain(first.id);
        expect(player.quests.available.some(q => q.id === first.id)).toBe(false);
        expect(player.quests.available.length).toBe(Quests.MAX_AVAILABLE);
    });
});

describe('Quest progress', () => {
    function activate(player, templateKey) {
        const q = Quests.createQuest(templateKey, player);
        q.status = 'active';
        player.quests.active.push(q);
        return q;
    }

    it('event counters drive objectives that had no progress before', () => {
        const player = makePlayer();
        const quest = activate(player, 'RUINS_EXPLORER');
        const target = quest.objectives[0].target;
        Quests.track(player, 'ruins_explored', target - 1);
        expect(Quests.updateProgress(player, world)).toHaveLength(0);
        Quests.track(player, 'ruins_explored');
        const done = Quests.updateProgress(player, world);
        expect(done.map(q => q.id)).toEqual([quest.id]);
        expect(player.gold).toBe(100 + quest.rewards.gold);
    });

    it('derives mountain exploration from explored tiles', () => {
        const player = makePlayer();
        const quest = activate(player, 'MOUNTAIN_CLIMBER');
        Quests.updateProgress(player, world);
        expect(quest.objectives[0].current).toBe(1);
    });
});

describe('Quest pool sanity', () => {
    it('never offers a quest whose objectives nothing can advance', () => {
        const player = makePlayer({ renown: 1000 });
        for (let i = 0; i < 20; i++) {
            player.quests.available = [];
            Quests.generateAvailableQuests(player);
            for (const q of player.quests.available) {
                for (const o of q.objectives) expect(Quests.UNTRACKABLE_OBJECTIVES).not.toContain(o.type);
            }
        }
    });
});
