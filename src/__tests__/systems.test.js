import { describe, it, expect, beforeAll } from 'vitest';
import { Religion } from '../systems/religion.js';
import { Culture } from '../systems/culture.js';
import { Technology } from '../systems/technology.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Quests } from '../systems/quests.js';
import { Achievements } from '../systems/achievements.js';
import { Cartography } from '../systems/cartography.js';
import { Colonization } from '../world/colonization.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { NPCLords } from '../world/npcLords.js';
import { Tavern } from '../player/tavern.js';
import { Peoples } from '../systems/peoples.js';
import { WorldEvents } from '../world/worldEvents.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('Religion', () => {
    it('FAITHS: loaded from JSON', () => {
        expect(Religion.FAITHS).toBeTruthy();
        expect(Object.keys(Religion.FAITHS).length).toBeGreaterThanOrEqual(5);
    });

    it('FAITHS: each has required fields', () => {
        for (const [key, faith] of Object.entries(Religion.FAITHS)) {
            expect(faith).toHaveProperty('id');
            expect(faith).toHaveProperty('name');
            expect(faith).toHaveProperty('icon');
        }
    });

    it('KINGDOM_FAITHS: maps kingdom to faith', () => {
        expect(Religion.KINGDOM_FAITHS).toBeTruthy();
    });
});

describe('Culture', () => {
    it('BUILDING_TYPES: loaded from JSON', () => {
        expect(Culture.BUILDING_TYPES).toBeTruthy();
        expect(Object.keys(Culture.BUILDING_TYPES).length).toBeGreaterThanOrEqual(4);
    });

    it('TRADITIONS: loaded from JSON', () => {
        expect(Culture.TRADITIONS).toBeTruthy();
    });
});

describe('Technology', () => {
    it('TECHS: loaded from JSON', () => {
        expect(Technology.TECHS).toBeTruthy();
        expect(Object.keys(Technology.TECHS).length).toBeGreaterThanOrEqual(20);
    });

    it('CATEGORIES: loaded from JSON', () => {
        expect(Technology.CATEGORIES).toBeTruthy();
    });

    it('TECH_BUILDINGS: loaded with costs', () => {
        expect(Technology.TECH_BUILDINGS).toBeTruthy();
        for (const [key, building] of Object.entries(Technology.TECH_BUILDINGS)) {
            expect(building).toHaveProperty('name');
        }
    });
});

describe('Infrastructure', () => {
    it('TYPES: loaded from JSON', () => {
        expect(Infrastructure.TYPES).toBeTruthy();
        expect(Object.keys(Infrastructure.TYPES).length).toBeGreaterThanOrEqual(4);
    });

    it('TYPES: each has cost and description', () => {
        for (const [key, type] of Object.entries(Infrastructure.TYPES)) {
            expect(type).toHaveProperty('id');
            expect(type).toHaveProperty('cost');
            expect(type).toHaveProperty('description');
        }
    });
});

describe('Quests', () => {
    it('QUEST_TEMPLATES: loaded from JSON', () => {
        expect(Quests.QUEST_TEMPLATES).toBeTruthy();
        expect(Object.keys(Quests.QUEST_TEMPLATES).length).toBeGreaterThanOrEqual(10);
    });

    it('QUEST_TEMPLATES: cover multiple categories', () => {
        const types = new Set();
        for (const quest of Object.values(Quests.QUEST_TEMPLATES)) {
            types.add(quest.type);
        }
        expect(types.size).toBeGreaterThanOrEqual(4);
    });
});

describe('Achievements', () => {
    it('ACHIEVEMENTS: loaded from JSON', () => {
        expect(Achievements.ACHIEVEMENTS).toBeTruthy();
    });
});

describe('Cartography', () => {
    it('QUALITY: loaded from JSON', () => {
        expect(Cartography.QUALITY).toBeTruthy();
        expect(Cartography.QUALITY).toHaveProperty('crude');
        expect(Cartography.QUALITY).toHaveProperty('masterwork');
    });

    it('MAP_TYPES: loaded from JSON', () => {
        expect(Cartography.MAP_TYPES).toBeTruthy();
    });
});

describe('Colonization', () => {
    it('INDIGENOUS_TRIBES: loaded from JSON', () => {
        expect(Colonization.INDIGENOUS_TRIBES).toBeTruthy();
    });

    it('POLICIES: loaded from JSON', () => {
        expect(Colonization.POLICIES).toBeTruthy();
        expect(Object.keys(Colonization.POLICIES).length).toBeGreaterThanOrEqual(4);
    });
});

describe('KingdomAI', () => {
    it('PERSONALITIES: loaded from JSON', () => {
        expect(KingdomAI.PERSONALITIES).toBeTruthy();
        expect(Object.keys(KingdomAI.PERSONALITIES).length).toBeGreaterThanOrEqual(5);
    });
});

describe('NPCLords', () => {
    it('TRAITS: loaded from JSON', () => {
        expect(NPCLords.TRAITS).toBeTruthy();
        expect(Object.keys(NPCLords.TRAITS).length).toBeGreaterThanOrEqual(8);
    });
});

describe('Tavern', () => {
    it('config constants: loaded from JSON', () => {
        expect(Tavern.DRINK_COST).toBeGreaterThan(0);
        expect(Tavern.BRIBE_COST).toBeGreaterThan(0);
        expect(Tavern.MAX_RUMORS).toBeGreaterThan(0);
    });

    it('RELIABILITY: loaded from JSON', () => {
        expect(Tavern.RELIABILITY).toBeTruthy();
    });
});

describe('Peoples', () => {
    it('TRIBAL_ROOTS: loaded from JSON', () => {
        expect(Peoples.TRIBAL_ROOTS).toBeTruthy();
    });

    it('EVOLUTION_STAGES: loaded from JSON', () => {
        expect(Peoples.EVOLUTION_STAGES).toBeTruthy();
    });
});

describe('WorldEvents', () => {
    it('CATEGORIES: loaded from JSON', () => {
        expect(WorldEvents.CATEGORIES).toBeTruthy();
        expect(WorldEvents.CATEGORIES).toHaveProperty('POLITICAL');
        expect(WorldEvents.CATEGORIES).toHaveProperty('MILITARY');
    });
});
