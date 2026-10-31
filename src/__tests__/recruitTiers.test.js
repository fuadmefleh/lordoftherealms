// What a settlement is big enough to offer (core/settlementSize.js):
// a village raises only its own folk — militia, hunters and scouts — and
// keeps no famous mercenary companies or fine trades. Trained, mounted and
// exotic troops, guild halls and universities need a town; the elite need a
// great town or a capital (data → minSettlement / minPopulation).

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { SettlementSize } from '../core/settlementSize.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Technology } from '../systems/technology.js';
import { World } from '../world/world.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const available = (settlement, context = {}) => [
    ...Object.values(PlayerMilitary.UNIT_TYPES)
        .filter(u => PlayerMilitary.isUnitAvailable(u, settlement, context).available),
    ...Object.values(Technology.TECH_UNITS)
        .filter(u => PlayerMilitary.isTechUnitAvailable(u, settlement, context).available),
].map(u => u.id);

const VILLAGE = { type: 'village', population: 400 };
const SMALL_TOWN = { type: 'town', population: 800 };
const GREAT_TOWN = { type: 'town', population: 2800 };
const CAPITAL = { type: 'capital', population: 9000 };

describe('recruitment by settlement size', () => {
    it('every recruitable unit names the settlement it needs', () => {
        for (const u of [...Object.values(PlayerMilitary.UNIT_TYPES), ...Object.values(Technology.TECH_UNITS)]) {
            expect(SettlementSize.TIER[u.minSettlement], u.id).toBeGreaterThan(0);
        }
    });

    it('a village offers only militia, archers and scouts', () => {
        expect(available(VILLAGE, { isPort: true }).sort()).toEqual(['archer', 'militia', 'scout']);
    });

    it('bigger settlements open up more of the roster', () => {
        const small = available(SMALL_TOWN);
        const great = available(GREAT_TOWN);
        const capital = available(CAPITAL);
        expect(small).toContain('soldier');
        expect(small).not.toContain('knight');
        expect(great).toContain('knight');
        expect(great).not.toContain('war_elephant');
        expect(capital).toContain('war_elephant');
        expect(capital).toContain('battle_mage');
        expect(small.length).toBeLessThan(great.length);
        expect(great.length).toBeLessThan(capital.length);
    });

    it('recruitUnit refuses a knight in a village, however big', () => {
        const player = { gold: 100000, army: [], skills: { combat: 0 } };
        const res = PlayerMilitary.recruitUnit(player, 'KNIGHT', { type: 'village', population: 5000 });
        expect(res.success).toBe(false);
        expect(res.reason).toMatch(/town/);
    });
});

describe('mercenary companies by settlement size', () => {
    const offersAt = (settlement) => {
        const player = { gold: 0, army: [] };
        return PlayerMilitary.getMercenaryOffers(player, { q: 1, r: 1, settlement }, { day: 10 });
    };

    it('no famous company seeks work in a village', () => {
        expect(offersAt({ ...VILLAGE, name: 'V' })).toEqual([]);
    });

    it('a small town draws one company, a great town more', () => {
        expect(offersAt({ ...SMALL_TOWN, name: 'S' })).toHaveLength(1);
        expect(offersAt({ ...GREAT_TOWN, name: 'G' }).length).toBeGreaterThanOrEqual(2);
    });
});

describe('properties and tech buildings by settlement size', () => {
    const tileIn = (settlement) => ({ q: 1, r: 1, terrain: { id: 'plains', passable: true }, settlement });
    const world = { getTile: () => null };
    const canBuild = (key, settlement) => PlayerEconomy.canBuildProperty({ gold: 1e6 }, key, tileIn(settlement), world);

    it('a village cannot host a jeweler, an inn or a grand hotel, but can a bakery', () => {
        expect(canBuild('JEWELER', VILLAGE).canBuild).toBe(false);
        expect(canBuild('INN', VILLAGE).canBuild).toBe(false);
        expect(canBuild('HOTEL', VILLAGE).canBuild).toBe(false);
        expect(canBuild('BAKERY', VILLAGE).canBuild).toBe(true);
    });

    it('a grand hotel needs a great town, not a capital as such', () => {
        expect(canBuild('HOTEL', SMALL_TOWN).canBuild).toBe(false);
        expect(canBuild('HOTEL', GREAT_TOWN).canBuild).toBe(true);
    });

    it('universities, hospitals and guild halls need a town', () => {
        for (const b of ['UNIVERSITY', 'HOSPITAL', 'MERCHANT_GUILD']) {
            expect(SettlementSize.meets(Technology.TECH_BUILDINGS[b], VILLAGE).ok, b).toBe(false);
        }
        expect(SettlementSize.meets(Technology.TECH_BUILDINGS.UNIVERSITY, SMALL_TOWN).ok).toBe(false);
        expect(SettlementSize.meets(Technology.TECH_BUILDINGS.UNIVERSITY, GREAT_TOWN).ok).toBe(true);
    });
});

describe('custom-map cities', () => {
    it('found towns, the settlement type the rest of the game knows', () => {
        expect(World.EDITOR_SETTLEMENTS.city.type).toBe('town');
        expect(World.EDITOR_SETTLEMENTS.capital.type).toBe('town');
    });
});
