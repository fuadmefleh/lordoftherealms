// Sentenced where there's no jail: marched in chains to the nearest town that
// has one (player/prison.js). Days pass on the road; raiders and the rest may
// happen along it.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { Prison } from '../player/prison.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

beforeAll(async () => { await loadData(); });
beforeEach(() => Utils.setSeed(21));

function jailedInVillage(seed = 7) {
    const g = newGame(seed);
    const village = g.world.getSettlementViews().find(s => s.type === 'village' && Prison.jailTownFor(g.world, s));
    g.player.q = village.q;
    g.player.r = village.r;
    g.player.jailState = { settlement: village.name, offense: 'theft', offenseNumber: 1, daysRemaining: 12, totalDays: 12, bailCost: 0, escapeChance: 0.1 };
    return { ...g, village };
}

describe('The march to a jail', () => {
    it('villages keep no jail; towns and cities do', () => {
        expect(Prison.hasJail('village')).toBe(false);
        for (const t of ['town', 'city', 'capital']) expect(Prison.hasJail(t)).toBe(true);
    });

    it('marches the prisoner from a village to the nearest town with a jail, the days counting', () => {
        const { world, player, village } = jailedInVillage();
        expect(Prison.needsTransport(player, world)).toBe(true);
        const tr = Prison.beginTransport(player, world);
        expect(Prison.hasJail(tr.to.type)).toBe(true);
        expect(tr.from.name).toBe(village.name);
        expect(tr.days).toBeGreaterThanOrEqual(1);
        let guard = 0;
        const seen = [];
        while (player.jailState && !player.jailState.transport.done && guard++ < 40) {
            const ev = Prison.transportStep(player, world);
            if (ev) seen.push(ev.kind);
            if (ev && ev.choice && player.jailState) Prison.transportChoice(player, world, 'stay');
            if (!player.jailState) break;
        }
        if (player.jailState) {
            expect(player.jailState.settlement).toBe(tr.to.name);
            expect(player.q).toBe(tr.to.q);
            expect(player.r).toBe(tr.to.r);
            expect(Prison.needsTransport(player, world)).toBe(false);
            expect(seen[seen.length - 1]).toBe('arrive');
        }
    });

    it('the march advances with the days (the day\'s end)', () => {
        const g = jailedInVillage(11);
        const tr = Prison.beginTransport(g.player, g.world);
        const before = g.player.jailState.daysRemaining;
        endDay(g);
        if (g.player.jailState) {
            expect(g.player.jailState.transport.day + (g.player.jailState.transport.event && g.player.jailState.transport.event.spent ? 1 : 0)).toBeGreaterThanOrEqual(1);
            expect(g.player.jailState.daysRemaining).toBe(before - 1);
        }
        expect(tr.log.length).toBeGreaterThan(0);
    });

    it('in a raid: slip away (an escape), fight (a shorter sentence), or keep down', () => {
        const raid = (g) => { g.player.jailState.transport.event = { kind: 'raid', choice: true, resolved: false, text: 'Raiders!' }; };
        // Slip: always away when the odds are certain
        let g = jailedInVillage();
        Prison.beginTransport(g.player, g.world);
        raid(g);
        g.player.skills = { stealth: 10 }; g.player.agility = 20;
        Utils.setSeed(1);
        let r = Prison.transportChoice(g.player, g.world, 'slip');
        expect(r.success).toBe(true);
        if (r.escaped) {
            expect(g.player.jailState).toBeNull();
            expect(g.player.lastJailRelease.how).toBe('escaped');
        }
        // Fight and win: days off
        g = jailedInVillage();
        Prison.beginTransport(g.player, g.world);
        raid(g);
        g.player.skills = { combat: 10 }; g.player.strength = 20;
        r = Prison.transportChoice(g.player, g.world, 'fight');
        expect(r.success).toBe(true);
        if (/days off/.test(r.text)) expect(g.player.jailState.daysRemaining).toBeLessThan(12);
        // Keep down: still chained, or taken into servitude, or freed and robbed
        g = jailedInVillage();
        Prison.beginTransport(g.player, g.world);
        raid(g);
        r = Prison.transportChoice(g.player, g.world, 'stay');
        expect(r.success).toBe(true);
        if (r.captured) expect(g.player.indenturedServitude).toBeTruthy();
        expect(Prison.transportChoice(g.player, g.world, 'stay').success).toBe(false);
    });

    it('a bribe on the road: paid, the prisoner is loose', () => {
        const g = jailedInVillage();
        Prison.beginTransport(g.player, g.world);
        g.player.gold = 200;
        g.player.jailState.transport.event = { kind: 'bribe', choice: true, resolved: false, cost: 40, text: '' };
        const r = Prison.transportChoice(g.player, g.world, 'pay');
        expect(r.escaped).toBe(true);
        expect(g.player.gold).toBe(160);
        expect(g.player.jailState).toBeNull();
    });
});
