// Tech and tech-building effects that previously did nothing.

import { describe, it, expect, beforeAll } from 'vitest';
import { Technology } from '../systems/technology.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function player(techs = [], extra = {}) {
    const p = { gold: 10000, health: 50, maxHealth: 100, q: 5, r: 5, properties: [], skills: { commerce: 0 }, ...extra };
    Technology.initPlayer(p);
    p.technology.implemented = techs;
    return p;
}

// One-tile world holding the given player properties at (5,5)
function worldWith(props) {
    const tile = { q: 5, r: 5, terrain: { id: 'plains', passable: true }, playerProperties: props, playerProperty: props[0] || null };
    return { tile, getTile: (q, r) => (q === 5 && r === 5 ? tile : null) };
}

describe('Tech effects', () => {
    it('sums effect keys across implemented techs', () => {
        expect(Technology.getEffectTotal(player(['writing', 'printing_press']), 'researchBonus')).toBeCloseTo(0.35);
        expect(Technology.getEffectTotal(player([]), 'researchBonus')).toBe(0);
    });

    it('banking systems pays daily interest on gold', () => {
        const p = player(['banking_systems']);
        const w = worldWith([]);
        const out = Technology.applyDailyEffects(p, w);
        expect(out.interest).toBe(20);
        expect(p.gold).toBe(10020);
    });
});

describe('Tech buildings', () => {
    it('a hospital heals you nearby', () => {
        const hospital = { type: 'hospital_building', underConstruction: false };
        const p = player([], { properties: [{ q: 5, r: 5, type: 'hospital_building' }] });
        const out = Technology.applyDailyEffects(p, worldWith([hospital]));
        expect(out.healed).toBe(15);
        expect(p.health).toBe(65);
    });

    it('a merchant guild hall adds to trade profit; universities speed research', () => {
        const props = [{ q: 5, r: 5, type: 'merchant_guild_building' }, { q: 5, r: 5, type: 'university_building' }];
        const p = player([], { properties: props });
        expect(Technology.getTradeProfitBonus(p)).toBeCloseTo(0.1);
        expect(Technology.getResearchBonus(p)).toBeCloseTo(0.25);
    });

    it('a granary beside a farm boosts its harvest', () => {
        const run = (withGranary) => {
            const farm = { type: 'farm', produces: 'grain', productionRate: 10, upkeep: 0, level: 1, storage: 0, daysOwned: 0 };
            const props = [farm];
            const refs = [{ q: 5, r: 5, type: 'farm' }];
            if (withGranary) {
                props.push({ type: 'granary', produces: null, productionRate: 0, upkeep: 0, level: 1, storage: 0, daysOwned: 0 });
                refs.push({ q: 5, r: 5, type: 'granary' });
            }
            const p = player([], { properties: refs });
            return PlayerEconomy.produceGoods(p, worldWith(props)).grain;
        };
        expect(run(false)).toBe(10);
        expect(run(true)).toBe(12);
    });
});
