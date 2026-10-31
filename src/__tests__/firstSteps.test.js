// First Steps (systems/firstSteps.js): the guided first month. Each step is
// read from real player/world state; a step done pays its reward once; the
// last pays the final reward (House Prestige) and unlocks the achievement;
// skip / resume; save → load keeps it; saves from before it, heirs and new
// lives are not guided.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { FirstSteps } from '../systems/firstSteps.js';
import { Achievements } from '../systems/achievements.js';
import { Quests } from '../systems/quests.js';
import { House } from '../systems/house.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
});

/** A guided player in a tiny fake world (no map needed for the readers). */
function setup({ enabled = true } = {}) {
    const world = { day: 1, width: 10, height: 10, getTile: () => null };
    const player = new Player({ firstName: 'Ada', lastName: 'Test', gender: 'female', age: 20 });
    Quests.initialize(player);
    Quests.grantStarterQuest(player, world);
    House.initialize(player, world);
    FirstSteps.initialize(player, world, { enabled });
    return { world, player };
}

const ids = (notices) => notices.map(n => n.step);

describe('First Steps — data and init', () => {
    it('loads 8–12 steps from data, each with a reader, title, why, how and a reward', () => {
        const steps = FirstSteps.steps();
        expect(steps.length).toBeGreaterThanOrEqual(8);
        expect(steps.length).toBeLessThanOrEqual(12);
        for (const s of steps) {
            expect(typeof FirstSteps.READERS[s.check]).toBe('function');
            expect(s.title && s.why && s.how).toBeTruthy();
            expect(s.reward && (s.reward.gold > 0 || s.reward.renown > 0)).toBeTruthy();
        }
        expect(new Set(steps.map(s => s.id)).size).toBe(steps.length);
    });

    it('initialize records the start and baselines; the first step is current', () => {
        const { player } = setup();
        const fs = player.firstSteps;
        expect(fs.enabled).toBe(true);
        expect(fs.startDay).toBe(1);
        expect(fs.base).toMatchObject({ jobs: 0, trades: 0, bounties: 0 });
        expect(FirstSteps.isActive(player)).toBe(true);
        expect(FirstSteps.current(player).id).toBe(FirstSteps.steps()[0].id);
        const v = FirstSteps.view(player);
        expect(v.doneCount).toBe(0);
        expect(v.total).toBe(FirstSteps.steps().length);
    });

    it('disabled (setting or scenario off): nothing is checked or paid, but it can be resumed', () => {
        const { world, player } = setup({ enabled: false });
        world.day = 5;
        player.jobsCompleted = 3;
        const gold = player.gold;
        expect(FirstSteps.check(player, world)).toEqual([]);
        expect(player.gold).toBe(gold);
        expect(FirstSteps.canResume(player)).toBe(true);
        expect(FirstSteps.resume(player)).toBe(true);
        expect(ids(FirstSteps.check(player, world))).toEqual(expect.arrayContaining(['first_day', 'odd_job']));
    });
});

describe('First Steps — detection from state', () => {
    it('reads each step from the state its system keeps', () => {
        const { world, player } = setup();
        expect(FirstSteps.check(player, world)).toEqual([]);

        world.day = 2;
        expect(ids(FirstSteps.check(player, world))).toEqual(['first_day']);

        // Odd jobs (player/oddJobs.js)
        player.jobsCompleted = 1;
        expect(ids(FirstSteps.check(player, world))).toEqual(['odd_job']);

        // A market deal on the price book (systems/priceKnowledge.js)
        player.priceBook = { towns: {}, hist: { ids: [], towns: {} }, pnl: { goods: { bread: { bought: 3, spent: 6, sold: 0, earned: 0, profit: 0 } }, routes: {}, held: {} } };
        expect(ids(FirstSteps.check(player, world))).toEqual(['market']);

        // Merely listing someone (an empty relationship) is not talking to them
        player.relationships.npc_a = { score: 0, romantic: false, affection: 0, history: [] };
        expect(ids(FirstSteps.check(player, world))).toEqual([]);
        player.relationships.npc_a.history.push({ day: 2, action: 'chat', result: 'success' });
        expect(ids(FirstSteps.check(player, world))).toEqual(['meet_people']);

        // A bounty taken from the notice board
        player.activeBounties = [{ id: 'b1', type: 'criminal_hunt' }];
        expect(ids(FirstSteps.check(player, world))).toEqual(['notice_board']);

        // A room booked for tonight (systems/hospitality.js)
        player.lodging = { id: 'h1', night: world.day, services: [] };
        expect(ids(FirstSteps.check(player, world))).toEqual(['inn']);

        // The House's ambition (systems/house.js)
        const amb = House.ambitions(player.house)[0];
        expect(House.chooseAmbition(player.house, amb.id, world.day)).toBeTruthy();
        expect(ids(FirstSteps.check(player, world))).toEqual(['ambition']);

        // Two towns visited
        player.quests.settlementsVisited.add('Alpha');
        expect(ids(FirstSteps.check(player, world))).toEqual([]);
        player.quests.settlementsVisited.add('Beta');
        expect(ids(FirstSteps.check(player, world))).toEqual(['second_town']);
    });

    it('the night slept at an inn counts the morning after', () => {
        const { world, player } = setup();
        player._lastRestType = 'camp';
        expect(FirstSteps.isDone(player, 'inn')).toBe(false);
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'inn')).toBe(false);
        player._lastRestType = 'inn';
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'inn')).toBe(true);
    });

    it('a quest from the journal counts for the task step; the starter quest does not', () => {
        const { world, player } = setup();
        Quests.grantStarterQuest(player, world);
        FirstSteps.initialize(player, world);
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'notice_board')).toBe(false);
        expect(FirstSteps.isDone(player, 'scout')).toBe(false);
        player.quests.active.push({ id: 'wanderer', objectives: [] });
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'notice_board')).toBe(true);
        // Scouting is done when the starter quest is
        const q = player.quests.active.findIndex(x => x.id === 'a_new_beginning');
        player.quests.completed.push(player.quests.active.splice(q, 1)[0]);
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'scout')).toBe(true);
    });

    it('counters the player started with are a baseline: one more is needed', () => {
        const world = { day: 1, width: 10, height: 10, getTile: () => null };
        const player = new Player({ firstName: 'B', lastName: 'C', gender: 'male', age: 20 });
        Quests.initialize(player);
        House.initialize(player, world);
        player.jobsCompleted = 4;
        FirstSteps.initialize(player, world);
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'odd_job')).toBe(false);
        player.jobsCompleted = 5;
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'odd_job')).toBe(true);
    });
});

describe('First Steps — rewards', () => {
    it('pays a step once, onto the ledger', () => {
        const { world, player } = setup();
        const step = FirstSteps.steps().find(s => s.id === 'odd_job');
        const gold = player.gold;
        player.jobsCompleted = 1;
        FirstSteps.check(player, world);
        expect(player.gold).toBe(gold + step.reward.gold);
        expect(player.financeToday.income.firstSteps).toBe(step.reward.gold);
        player.jobsCompleted = 2;
        FirstSteps.check(player, world);
        FirstSteps.check(player, world);
        expect(player.gold).toBe(gold + step.reward.gold);
    });

    it('finishing every step pays the final reward with Prestige and unlocks the achievement', () => {
        const { world, player } = setup();
        const prestige = player.house.prestige;
        for (const s of FirstSteps.steps()) player.firstSteps.done[s.id] = 1;
        delete player.firstSteps.done.second_town;
        player.quests.settlementsVisited.add('A');
        player.quests.settlementsVisited.add('B');
        const renown = player.renown;
        const notices = FirstSteps.check(player, world);
        const fin = FirstSteps.config().final;
        expect(notices.map(n => n.step)).toEqual(['second_town', null]);
        expect(player.firstSteps.finishedDay).toBe(1);
        expect(player.house.prestige).toBe(prestige + fin.prestige);
        expect(player.renown).toBeGreaterThanOrEqual(renown + fin.renown);
        expect(FirstSteps.isActive(player)).toBe(false);
        expect(FirstSteps.check(player, world)).toEqual([]);
        expect(Achievements.ACHIEVEMENTS.FIRST_STEPS.check(player, world)).toBe(true);
        expect(DataLoader._gamedata.achievements.achievements.FIRST_STEPS.id).toBe('first_steps');
    });
});

describe('First Steps — skip, heirs and new lives', () => {
    it('skip stops the tracking and paying; resume picks it up', () => {
        const { world, player } = setup();
        expect(FirstSteps.skip(player)).toBe(true);
        expect(FirstSteps.isActive(player)).toBe(false);
        world.day = 3;
        const gold = player.gold;
        expect(FirstSteps.check(player, world)).toEqual([]);
        expect(player.gold).toBe(gold);
        expect(FirstSteps.view(player).active).toBe(false);
        expect(FirstSteps.canResume(player)).toBe(true);
        FirstSteps.resume(player);
        expect(ids(FirstSteps.check(player, world))).toContain('first_day');
        expect(player.gold).toBeGreaterThan(gold);
    });

    it('collapse is kept on the record', () => {
        const { player } = setup();
        FirstSteps.setCollapsed(player, true);
        expect(FirstSteps.view(player).collapsed).toBe(true);
    });

    it('an heir (a later House generation) is not guided', () => {
        const { world, player } = setup();
        player.house.generation = 2;
        world.day = 9;
        expect(FirstSteps.check(player, world)).toEqual([]);
        expect(player.firstSteps.retired).toBe(true);
        expect(FirstSteps.canResume(player)).toBe(false);
    });

    it('a new life (a Player without the record) and a null player are left alone', () => {
        const world = { day: 4 };
        const fresh = new Player({ firstName: 'New', lastName: 'Life', gender: 'male', age: 18 });
        expect(FirstSteps.check(fresh, world)).toEqual([]);
        expect(FirstSteps.processDay(world, null).notices).toEqual([]);
        expect(FirstSteps.view(fresh).active).toBe(false);
        expect(FirstSteps.canResume(fresh)).toBe(false);
    });
});

describe('First Steps — save and load', () => {
    it('round-trips through serializePlayer / restorePlayer', () => {
        const { world, player } = setup();
        world.day = 2;
        player.jobsCompleted = 1;
        FirstSteps.check(player, world);
        FirstSteps.setCollapsed(player, true);
        const data = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(back.firstSteps).toEqual(player.firstSteps);
        expect(FirstSteps.isActive(back)).toBe(true);
        expect(FirstSteps.isDone(back, 'odd_job')).toBe(true);
        expect(FirstSteps.current(back).id).toBe(FirstSteps.current(player).id);
    });

    it('a save from before First Steps loads with the guidance off for good', () => {
        const { player } = setup();
        const data = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        delete data.firstSteps;
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(back.firstSteps).toMatchObject({ enabled: false, legacy: true });
        expect(FirstSteps.isActive(back)).toBe(false);
        expect(FirstSteps.canResume(back)).toBe(false);
        expect(FirstSteps.resume(back)).toBe(false);
    });

    it('a new life saved without a record loads as legacy too (never guided)', () => {
        const data = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(new Player())));
        expect(data.firstSteps).toBeNull();
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(back.firstSteps.legacy).toBe(true);
    });
});

describe('First Steps — in the playtest harness', () => {
    it('a real game: the first day is credited at day end and the record survives a round trip', () => {
        const game = newGame(4242);
        expect(FirstSteps.isActive(game.player)).toBe(true);
        endDay(game);
        expect(FirstSteps.isDone(game.player, 'first_day')).toBe(true);
        const g2 = roundTrip(game);
        expect(g2.player.firstSteps.done.first_day).toBe(game.player.firstSteps.done.first_day);
        expect(FirstSteps.isActive(g2.player)).toBe(true);
        expect(() => endDay(g2)).not.toThrow();
    });
});

describe('Ledger category', () => {
    it('firstSteps rewards are a named labour income', () => {
        expect(DataLoader._gamedata.chronicle.ledger.categories.firstSteps).toBeTruthy();
    });
});
