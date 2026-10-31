// What townsfolk tell the player is read from the world (systems/npcKnowledge.js):
// the realm's ruler, wars, army, tariffs; the town's buildings, market and the
// outlaws about; rumours of real places — by who is asked and how they feel.

import { describe, it, expect, beforeAll } from 'vitest';
import { NpcKnowledge } from '../systems/npcKnowledge.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

beforeAll(async () => { await loadData(); });

function game(days = 10, seed = 7) {
    const g = newGame(seed);
    for (let i = 0; i < days; i++) endDay(g);
    const realm = g.world.kingdoms.find(k => k && k.isAlive !== false && k.tradePolicy);
    const town = g.world.getSettlementViews().find(s => s.kingdom === realm.id) || g.world.getTile(g.player.q, g.player.r).settlement;
    return { ...g, realm, town };
}

describe('Asking about the realm', () => {
    it('a noble names the true ruler and the realm\'s wars or peace', () => {
        const { world, player, realm, town } = game();
        const foe = world.kingdoms.find(k => k && k.id !== realm.id && k.isAlive !== false);
        realm.wars = [foe.id];
        const ans = NpcKnowledge.aboutKingdom(world, player, { id: 1, type: 'noble' }, realm, { disposition: 60, settlement: town });
        expect(ans.tone).toBe('sure');
        expect(ans.text).toContain(realm.ruler);
        expect(ans.text).toContain(`at war with ${foe.name}`);
        expect(ans.learned).toEqual(expect.arrayContaining(['basics', 'ruler', 'diplomacy']));
    });

    it('a merchant quotes the real tariff', () => {
        const { world, player, realm, town } = game();
        const ans = NpcKnowledge.aboutKingdom(world, player, { id: 2, type: 'merchant' }, realm, { disposition: 55, settlement: town });
        const pct = `${Math.round(TradePolicy.avgImport(realm) * 100)}%`;
        expect(ans.text).toContain(pct);
        expect(ans.text.toLowerCase()).toContain(TradePolicy.stance(realm.tradePolicy.stance).label.toLowerCase());
    });

    it('a villager speaks from hearsay and says so; nothing they say adds to what the player knows', () => {
        const { world, player, realm, town } = game();
        const ans = NpcKnowledge.aboutKingdom(world, player, { id: 3, type: 'villager' }, realm, { disposition: 55, settlement: town });
        expect(ans.tone).toBe('hearsay');
        const hedges = NpcKnowledge.config().hedges;
        expect(hedges.some(h => ans.text.includes(h.replace(/^[,—]\s*/, '').slice(0, 10)))).toBe(true);
        expect(ans.learned).toEqual(['basics']);
    });

    it('the warmer they feel, the more they say — down to the crown\'s debts and unpaid soldiers', () => {
        const { world, player, realm, town } = game();
        realm.fisc = { ...(realm.fisc || {}), arrearsDays: 12 };
        const cold = NpcKnowledge.aboutKingdom(world, player, { id: 4, type: 'guard' }, realm, { disposition: 15, settlement: town });
        const warm = NpcKnowledge.aboutKingdom(world, player, { id: 4, type: 'guard' }, realm, { disposition: 85, settlement: town });
        expect(cold.tone).toBe('guarded');
        expect(cold.topics.length).toBe(1);
        expect(warm.topics.length).toBeGreaterThan(cold.topics.length);
        expect(warm.text).toMatch(/haven't been paid/);
        expect(cold.text).not.toMatch(/haven't been paid/);
    });

    it('the same NPC tells it the same way (no dice)', () => {
        const { world, player, realm, town } = game();
        const a = NpcKnowledge.aboutKingdom(world, player, { id: 5, type: 'villager' }, realm, { disposition: 80, settlement: town, seed: 's' });
        const b = NpcKnowledge.aboutKingdom(world, player, { id: 5, type: 'villager' }, realm, { disposition: 80, settlement: town, seed: 's' });
        expect(a.text).toBe(b.text);
    });
});

describe('Asking about the town', () => {
    it('names the buildings and their keepers, and what the market is short of', () => {
        const { world, player } = game();
        const here = world.getTile(player.q, player.r).settlement;
        const short = SettlementMarket.worstShortage(here, 1.6);
        const ans = NpcKnowledge.aboutTown(world, player, { id: 6, type: 'merchant', name: 'Ada' }, here, {
            disposition: 80, buildings: [{ type: 'tavern', ownerName: 'Brom' }, { type: 'marketplace', ownerName: 'Ada' }, { type: 'church' }],
        });
        expect(ans.text).toContain(here.name);
        expect(ans.text).toContain('Brom keeps the tavern');
        if (short) expect(ans.text.toLowerCase()).toContain(short.id.replace(/_/g, ' '));
    });

    it('a guard names the outlaws nearby — and the lair goes on the map', () => {
        const { world, player } = game(5);
        const lair = OutlawLairs.active(player)[0];
        expect(lair).toBeTruthy();
        lair.known = false;
        const near = { name: 'Watchford', type: 'village', population: 200, q: lair.q + 3, r: lair.r, kingdom: null };
        const ans = NpcKnowledge.aboutTown(world, player, { id: 7, type: 'guard' }, near, { disposition: 60 });
        expect(ans.revealed.lairs).toContain(lair.id);
        expect(lair.known).toBe(true);
        expect(ans.text).toContain(lair.name);
    });
});

describe('Rumours from the world as it is', () => {
    it('a rumour names a real town, lair, place or realm', () => {
        const { world, player } = game();
        const here = world.getTile(player.q, player.r).settlement;
        const names = [
            ...world.getSettlementViews().map(s => s.name),
            ...OutlawLairs.active(player).map(l => l.name),
            ...world.kingdoms.map(k => k.name),
        ];
        let grounded = 0;
        for (let i = 0; i < 8; i++) {
            const r = NpcKnowledge.rumour(world, player, { id: i, type: 'villager' }, { settlement: here, seed: `r${i}` });
            if (!r) continue;
            if (names.some(n => r.includes(n)) || /old (ruin|cave|mine)/.test(r) || /harvest/.test(r)) grounded++;
        }
        expect(grounded).toBeGreaterThan(0);
    });
});

describe('Swaying them, and spending their goodwill', () => {
    it('the stern are harder to flatter than the jovial, and flattery wears thin', () => {
        const mem = { disposition: 50 };
        const stern = NpcKnowledge.socialDifficulty({ type: 'villager', personalityTraits: ['stern'] }, mem, 'flatter').difficulty;
        const jovial = NpcKnowledge.socialDifficulty({ type: 'villager', personalityTraits: ['jovial'] }, mem, 'flatter').difficulty;
        expect(stern).toBeGreaterThan(jovial);
        const again = NpcKnowledge.socialDifficulty({ type: 'villager', personalityTraits: ['jovial'] }, { disposition: 50, flattered: true }, 'flatter').difficulty;
        expect(again).toBeGreaterThan(jovial);
        const cold = NpcKnowledge.socialDifficulty({ type: 'villager' }, { disposition: 20 }, 'persuade').difficulty;
        const warm = NpcKnowledge.socialDifficulty({ type: 'villager' }, { disposition: 80 }, 'persuade').difficulty;
        expect(cold).toBeGreaterThan(warm);
    });

    it('a trader who likes you knocks something off — this visit — for a little goodwill', () => {
        const npc = { id: 1, type: 'merchant', name: 'Ada' };
        const mem = NpcDisposition.getMemory(npc);
        mem.disposition = 70; mem.timesSpoken = 2;
        const before = NpcDisposition.getPriceModifiers(npc).buy;
        expect(NpcKnowledge.canBargain(npc, mem)).toBe(true);
        const res = NpcKnowledge.bargain(npc, mem, { skills: { commerce: 3 } });
        expect(mem.disposition).toBe(70 - res.cost);
        const after = NpcDisposition.getPriceModifiers(npc);
        expect(after.reasons.some(r => r.label === 'Bargained')).toBe(true);
        expect(after.buy).toBeLessThan(before + 0.0001 + res.cost / 250);
        expect(NpcKnowledge.canBargain(npc, mem)).toBe(false);
        mem.timesSpoken++; // the next visit: the bargain is over
        expect(NpcDisposition.getPriceModifiers(npc).reasons.some(r => r.label === 'Bargained')).toBe(false);
    });

    it('a guard who likes you names a lair the player had not found', () => {
        const { world, player } = game(5);
        for (const l of OutlawLairs.active(player)) l.known = false;
        const lair = OutlawLairs.active(player)[0];
        const at = { q: lair.q + 2, r: lair.r, kingdom: null, name: 'Nowhere' };
        const mem = { disposition: 80, timesSpoken: 3 };
        expect(NpcKnowledge.canAskFavour({ type: 'guard' }, mem, world.day)).toBe(true);
        const res = NpcKnowledge.askFavour(world, player, { id: 1, type: 'guard' }, mem, { settlement: at });
        expect(res.kind).toBe('lair');
        expect(OutlawLairs.active(player).some(l => l.known)).toBe(true);
        expect(mem.disposition).toBe(80 - NpcKnowledge.config().favour.cost);
        expect(NpcKnowledge.canAskFavour({ type: 'guard' }, mem, world.day)).toBe(false);
    });
});
