// Reforged legendary artifacts are lasting heirlooms, not one-off payouts.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { LegendaryArtifacts } from '../systems/legendaryArtifacts.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Ships } from '../systems/ships.js';

const owner = (...ids) => ({ health: 50, maxHealth: 100, karma: 0, skills: {}, artifacts: { fragments: {}, forged: ids, discovered: ids } });

describe('Legendary artifact passives', () => {
    beforeAll(async () => {
        await DataLoader.initializeAll();
    });

    it('every artifact has a lasting effect and a description of it', () => {
        const defs = LegendaryArtifacts._getDefinitions();
        expect(defs.length).toBeGreaterThanOrEqual(6);
        for (const a of defs) {
            expect(Object.keys(a.passive || {}).length).toBeGreaterThan(0);
            expect(a.passiveText).toBeTruthy();
        }
    });

    it('sums effects only from reforged relics', () => {
        expect(LegendaryArtifacts.getPassiveTotal(owner(), 'battlePower')).toBe(0);
        expect(LegendaryArtifacts.getPassiveTotal(owner('sword_first_king'), 'battlePower')).toBeCloseTo(0.15);
    });

    it('the Banner cuts casualties, the Ledger lifts income and prices, the Crown reputation', () => {
        expect(PlayerEffects.casualtyMultiplier(owner('banner_iron_host'))).toBeCloseTo(0.75);
        expect(PlayerEffects.propertyIncomeMultiplier(owner('ledger_coin_kings'))).toBeCloseTo(1.15);
        expect(PlayerEffects.tradeBonus(owner('ledger_coin_kings'), null)).toBeCloseTo(0.05);
        expect(PlayerEffects.reputationGainMultiplier(owner('crown_embers')))
            .toBeCloseTo(PlayerEffects.reputationGainMultiplier(owner()) * 1.25);
    });

    it('the Chalice heals and purifies each day', () => {
        const p = owner('chalice_dawn');
        const res = LegendaryArtifacts.processDaily(p);
        expect(res.healed).toBe(3);
        expect(p.karma).toBeCloseTo(0.2);
    });

    it('the Astrolabe speeds your ships', () => {
        const ship = { typeId: 'cog', customizations: [], condition: 100 };
        const plain = Ships.getSailingSpeed(owner(), ship);
        const charted = Ships.getSailingSpeed(owner('astrolabe_tides'), ship);
        expect(charted).toBeGreaterThanOrEqual(plain);
        expect(charted).toBe(Math.max(1, Math.round(Ships.getShipEffectiveStats(ship).speed * 1.3)));
    });
});
