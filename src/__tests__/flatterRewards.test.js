// A flattered NPC keeps the promise in its line: the merchant's 10% off,
// the farmer's produce, the priest's blessing, the traveller's map marks...
// once per NPC.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { NpcDisposition, FLATTER_REWARDS } from '../systems/npcDisposition.js';
import { FLATTER_SUCCESS } from '../ui/npcDialog.data.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const player = (extra = {}) => ({ gold: 0, karma: 0, health: 50, maxHealth: 100, inventory: {}, reputation: {}, q: 0, r: 0, ...extra });

describe('flatter rewards', () => {
    it('every flatter line has a matching reward slot', () => {
        for (const [type, lines] of Object.entries(FLATTER_SUCCESS)) {
            expect(FLATTER_REWARDS[type], type).toBeDefined();
            expect(FLATTER_REWARDS[type].length, type).toBe(lines.length);
        }
    });

    it("the merchant's 10% discount lowers their prices", () => {
        const npc = { name: 'Mira', type: 'merchant' };
        const res = NpcDisposition.flatterReward(npc, 1, { player: player() });
        expect(res.kind).toBe('discount');
        expect(NpcDisposition.getMemory(npc).discount).toBeCloseTo(0.10);
    });

    it('the farmer hands over produce, the priest blesses and heals', () => {
        const p = player();
        NpcDisposition.flatterReward({ type: 'farmer' }, 0, { player: p });
        expect(p.inventory.grain).toBe(4);
        NpcDisposition.flatterReward({ type: 'priest' }, 0, { player: p });
        expect(p.karma).toBe(3);
        NpcDisposition.flatterReward({ type: 'priest' }, 1, { player: p });
        expect(p.health).toBe(65);
    });

    it('a noble puts in a word at court', () => {
        const p = player();
        NpcDisposition.flatterReward({ type: 'noble' }, 1, { player: p, kingdom: { id: 'k1', name: 'Avalon' } });
        expect(p.reputation.k1).toBe(3);
    });

    it('a traveller marks unexplored land on your map', () => {
        const tiles = {};
        const world = { getTile: (q, r) => (tiles[`${q},${r}`] ||= { q, r, explored: false }) };
        Utils.setSeed(4);
        const res = NpcDisposition.flatterReward({ type: 'traveler' }, 0, { player: player(), world });
        expect(res.kind).toBe('reveal');
        expect(Object.values(tiles).some(t => t.explored)).toBe(true);
    });

    it('rewards flattery only once per NPC, and gossip lines give nothing', () => {
        const p = player();
        const kid = { type: 'child' };
        Utils.setSeed(2);
        expect(NpcDisposition.flatterReward(kid, 1, { player: p })).not.toBeNull();
        const gold = p.gold;
        expect(NpcDisposition.flatterReward(kid, 1, { player: p })).toBeNull();
        expect(p.gold).toBe(gold);
        expect(NpcDisposition.flatterReward({ type: 'guard' }, 0, { player: p })).toBeNull();
    });

    it('a dialog type override picks the table (villager fallback)', () => {
        const p = player();
        NpcDisposition.flatterReward({ type: 'innkeeper' }, 0, { player: p, type: 'villager' });
        expect(p.inventory.bread).toBe(1);
    });
});
