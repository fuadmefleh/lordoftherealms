// The first hour (playthrough 2026-11-17): what a new player meets on day 1.
//   - A House is not named after the placeholder first name (House.familyNameFor).
//   - Merchant Dynasty's first milestone is in reach, and the chooser says what each asks.
//   - No "A New Friend" for your own kin or a tie you began with; no plea or loan from kin,
//     nor any asked of a child at home.
//   - A notice-board quarry beyond you shows its honest odds (BountyHunting.captureOdds).
//   - The Explorer achievement counts what you uncover, not what a start shows you.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { House } from '../systems/house.js';
import { Bonds } from '../systems/bonds.js';
import { Relationships } from '../systems/relationships.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Achievements } from '../systems/achievements.js';
import { Utils } from '../core/utils.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the House\'s name', () => {
    it('a character with no family name gets one of the land it starts in, the same each time, drawing no RNG', () => {
        const g = newGame(4242);
        const p = { firstName: 'Wanderer', q: g.player.q, r: g.player.r };
        Utils.setSeed(7);
        const before = Utils.random();
        Utils.setSeed(7);
        const a = House.familyNameFor(p, g.world);
        expect(Utils.random()).toBe(before);
        expect(a).toMatch(/^[A-Z][\w' -]+$/);
        expect(a).not.toBe('Wanderer');
        expect(House.familyNameFor(p, g.world)).toBe(a);
        expect(House.familyNameFor(null, g.world)).toBe('');
    }, 120000);
});

describe('Merchant Dynasty', () => {
    it('its first milestone is a single property, and says what one costs and where to build it', () => {
        const def = House._getAmbitionDef('merchant_dynasty');
        expect(def.milestones[0].req).toEqual({ properties: 1 });
        expect(def.milestones[0].hint).toMatch(/Build Property/);
        expect(def.milestones[0].hint).toMatch(/\d+.*g/);
        const player = { id: 'p', lastName: 'Ashborne', properties: [{}] };
        House.initialize(player, { day: 1 });
        House.chooseAmbition(player.house, 'merchant_dynasty', 1);
        const res = House.evaluateAmbition(player, { day: 2 });
        expect(res.milestonesCompleted).toContain('first_property');
        expect(res.milestonesCompleted).not.toContain('estates');
    });

    it('the chooser lists each ambition\'s milestones', () => {
        const md = House.ambitions().find(a => a.id === 'merchant_dynasty');
        expect(md.milestones.map(m => m.id)).toEqual(['first_property', 'estates', 'routes', 'coffers']);
    });
});

describe('day-1 notices about the people you start with', () => {
    function npcHere(g, score, rel = {}) {
        const views = g.world.getSettlementViews();
        const s = views.find(v => v.type === 'town') || views[0];
        const npc = Relationships.generateNPC(s, g.world);
        npc.settlementQ = s.q;
        npc.settlementR = s.r;
        npc.age = 40;
        const r = Relationships.getRelationship(g.player, npc.id);
        r.score = score;
        Object.assign(r, rel);
        return npc;
    }

    it('kin and a tie you began with become friends without "A New Friend"; someone met since still says so', () => {
        const g = newGame(777);
        // (the start's day, as player/scenarios.js records it)
        g.player.scenario = { ...(g.player.scenario || {}), startDay: g.world.day };
        const kin = npcHere(g, 60, { family: 'father' });
        const tie = npcHere(g, 55, { tie: 'friend', history: [{ day: g.world.day, action: 'friend' }] });
        const out = Bonds.processDay(g.world, g.player);
        expect(Bonds.get(g.player, kin.id)).toBeTruthy();
        expect(Bonds.get(g.player, tie.id)).toBeTruthy();
        expect(out.notices.some(n => n.title === 'A New Friend')).toBe(false);
        const met = npcHere(g, 50);
        g.world.day++;
        const out2 = Bonds.processDay(g.world, g.player);
        expect(Bonds.get(g.player, met.id)).toBeTruthy();
        expect(out2.notices.some(n => n.title === 'A New Friend')).toBe(true);
    }, 120000);

    it('your own family asks no plea or loan of you, and nobody asks it of a child at home', () => {
        const g = newGame(778);
        const npc = { id: 'x', firstName: 'Lorcan' };
        const pick = (rel, player = g.player) => {
            const seen = new Set();
            for (let i = 0; i < 300; i++) seen.add(Relationships._pickMatterKind(player, 'x', rel, npc));
            return seen;
        };
        expect(pick({ score: 70 })).toContain('plea');
        const kin = pick({ score: 70, family: 'father' });
        expect(kin.has('plea')).toBe(false);
        expect(kin.has('loan')).toBe(false);
        const child = { ...g.player, spouse: null, parentage: { active: true } };
        const asked = pick({ score: 70 }, child);
        expect(asked.has('plea')).toBe(false);
        expect(asked.has('loan')).toBe(false);
    }, 120000);
});

describe('the notice board', () => {
    it('captureOdds is the first attempt\'s honest chance, lower for a harder quarry', () => {
        const p = { skills: { combat: 1, stealth: 1, leadership: 1 }, army: [] };
        const easy = BountyHunting.captureOdds(p, { difficulty: 1 });
        const lv3 = BountyHunting.captureOdds(p, { difficulty: 3 });
        const lv5 = BountyHunting.captureOdds(p, { difficulty: 5 });
        expect(easy).toBeGreaterThan(lv3);
        expect(lv3).toBeGreaterThan(lv5);
        expect(lv3).toBeLessThan(0.4); // a new character is warned off a Lv 3 manhunt
        expect(lv5).toBeGreaterThanOrEqual(0);
        const strong = { skills: { combat: 9, stealth: 6, leadership: 5 }, army: new Array(16).fill({}) };
        expect(BountyHunting.captureOdds(strong, { difficulty: 3 })).toBe(1);
    });
});

describe('the Explorer achievement', () => {
    it('counts the tiles uncovered since the start, not those the start showed', () => {
        const def = Object.values(Achievements.ACHIEVEMENTS || Achievements.achievements || {}).find(a => a && a.id === 'explorer')
            || (typeof Achievements.getAll === 'function' ? Achievements.getAll().find(a => a.id === 'explorer') : null);
        expect(def).toBeTruthy();
        const tiles = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ explored: true })));
        const world = { width: 12, height: 12, tiles };
        expect(def.check({ achievements: { exploredAtStart: 144 } }, world)).toBe(false);
        expect(def.check({ achievements: { exploredAtStart: 40 } }, world)).toBe(true);
        expect(def.check({}, world)).toBe(true);
    });
});

describe('an origin\'s first moves in the panels (ui/actionMenu/counsel.js)', () => {
    it('every first move opens a known panel, and opening it by any door ticks its First Steps step', async () => {
        const { COUNSEL_PANELS, trackFirstStepsPanels } = await import('../ui/actionMenu/counsel.js');
        const { FirstSteps } = await import('../systems/firstSteps.js');
        const { DataLoader } = await import('../core/dataLoader.js');
        for (const [id, o] of Object.entries(DataLoader._gamedata.scenarios.origins)) {
            for (const m of o.firstMoves || []) expect(COUNSEL_PANELS[m.open], `${id}: ${m.open}`).toBeTruthy();
        }
        const opened = [];
        const target = { showGuildhall: (game, tile) => opened.push(['guild', tile]), showSomethingElse: () => opened.push('else') };
        trackFirstStepsPanels(target);
        trackFirstStepsPanels(target); // (wrapped once)
        const world = { day: 3 };
        const player = { firstSteps: null };
        FirstSteps.initialize(player, world, { origin: 'guildmaster' });
        target.showGuildhall({ player, world }, 'T');
        expect(opened).toEqual([['guild', 'T']]);
        expect(player.firstSteps.seen.guilds).toBe(3);
        expect(FirstSteps.check(player, world).map(n => n.step)).toContain('see_guilds');
    }, 120000);
});
