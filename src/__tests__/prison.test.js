/**
 * The prison loop (player/prison.js): named cellmates hashed from the
 * sentence, befriending them, guard bribes priced by the town and the
 * offence, the tunnel and the snitch, labour that counts double, jailbreaks
 * once a night with heat and a bounty on escape, friends who follow you out,
 * and the day's events on their own stream (a bare jailState draws nothing).
 * Servitude: once-a-day escape, the overseer's bribe, hard labour.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Prison } from '../player/prison.js';
import { PlayerActions } from '../player/playerActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(type = 'town') {
    const tiles = new Map();
    const kingdom = { id: 'k1', name: 'Arden', culture: 'Imperial' };
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) tiles.set(key, { q, r, kingdom: 'k1', terrain: { id: 'plains', passable: true }, settlement: null });
        return tiles.get(key);
    };
    const w = { width: 40, height: 40, day: 30, generationParams: { seed: 11 }, units: [], kingdoms: [kingdom], getTile, getKingdom: (id) => (id === 'k1' ? kingdom : null), getAllSettlements: () => [] };
    w.getTile(5, 5).settlement = { name: 'Greyford', type, kingdom: 'k1', population: 800 };
    return w;
}

function jailed(over = {}) {
    return {
        name: 'Ash', q: 5, r: 5, gold: 400, karma: 0, renown: 0, health: 100, strength: 6, charisma: 6, luck: 5,
        maxStamina: 10, stamina: 0, inventory: { bread: 5 }, reputation: { k1: 0 }, relationships: {}, travelParty: [],
        skills: { stealth: 3, combat: 3, diplomacy: 3 },
        jailState: { daysRemaining: 6, totalDays: 6, offense: 'theft', offenseNumber: 1, settlement: 'Greyford', bailCost: 120, escapeChance: 0.17 },
        ...over,
    };
}

describe('the cell', () => {
    it('cellmates are named and cast the same way for the same sentence', () => {
        const world = makeWorld();
        const a = Prison.state(jailed(), world);
        const b = Prison.state(jailed(), world);
        expect(a.cellmates.length).toBeGreaterThanOrEqual(2);
        expect(a.cellmates.map(c => `${c.name}/${c.archetype}`)).toEqual(b.cellmates.map(c => `${c.name}/${c.archetype}`));
        expect(a.type).toBe('town');
    });

    it('sharing food wins a cellmate over, once a day each', () => {
        const world = makeWorld();
        const p = jailed();
        const pr = Prison.state(p, world);
        const m = pr.cellmates[0];
        expect(Prison.talk(p, world, m.id, 'food').ok).toBe(true);
        expect(Prison.talk(p, world, m.id, 'food').success).toBe(false);
        for (let d = 1; d < 4; d++) {
            world.day += 1;
            Prison.talk(p, world, m.id, 'food');
        }
        expect(m.friend).toBe(true);
        expect(p.inventory.bread).toBe(1);
    });

    it('bribes cost more in a capital and for a longer sentence', () => {
        const village = Prison.bribeCost(jailed(), makeWorld('village'), 'lookaway');
        const capital = Prison.bribeCost(jailed(), makeWorld('capital'), 'lookaway');
        expect(capital).toBeGreaterThan(village);
        const long = jailed();
        long.jailState.totalDays = 20;
        expect(Prison.bribeCost(long, makeWorld('village'), 'lookaway')).toBeGreaterThan(village);
        expect(Prison.bribeCost(jailed(), makeWorld('village'), 'release')).toBeGreaterThan(village);
    });

    it('a guard who looks away makes slipping out likelier', () => {
        Utils.setRng(() => 0.01);
        const world = makeWorld();
        const p = jailed();
        const before = Prison.breakChance(p, world, 'slip');
        const res = Prison.bribe(p, world, 'lookaway');
        expect(res.ok).toBe(true);
        expect(Prison.breakChance(p, world, 'slip')).toBeGreaterThan(before);
    });

    it('labour counts double; the tunnel needs tools', () => {
        const world = makeWorld();
        const p = jailed();
        Prison.work(p, world);
        expect(p.jailState.daysRemaining).toBe(5);
        expect(Prison.dig(p, world).success).toBe(false);
        Prison.state(p, world).tools = 1;
        Utils.setRng(() => 0.9);
        const res = Prison.dig(p, world);
        expect(res.success).toBe(true);
        expect(res.tunnel).toBeGreaterThan(0);
    });

    it('one jailbreak a night; escaping brings heat, a bounty and lost reputation', () => {
        const world = makeWorld();
        const p = jailed();
        Utils.setRng(() => 0.99);
        const fail = Prison.breakout(p, world, 'slip');
        expect(fail.escaped).toBe(false);
        expect(p.jailState.daysRemaining).toBeGreaterThan(6);
        expect(Prison.breakout(p, world, 'slip').success).toBe(false);
        world.day += 1;
        Utils.setRng(() => 0.0);
        const ok = Prison.breakout(p, world, 'slip');
        expect(ok.escaped).toBe(true);
        expect(p.jailState).toBeNull();
        expect(p.underworld.heat.k1).toBeGreaterThan(0);
        expect(p.gossip.bounties.some(b => b.description === 'jailbreak')).toBe(true);
        expect(p.reputation.k1).toBeLessThan(0);
    });

    it('befriended cellmates follow you out', () => {
        const world = makeWorld();
        const p = jailed();
        const pr = Prison.state(p, world);
        pr.cellmates = [
            { id: 'a', name: 'Rolf Ironjaw', archetype: 'veteran', rapport: 3, friend: true, sold: false },
            { id: 'b', name: 'Pell Saltlip', archetype: 'fence', rapport: 2, friend: true, sold: false },
        ];
        const rel = Prison.postBail(p, world);
        expect(rel.success).toBe(true);
        expect(p.jailState).toBeNull();
        expect(p.travelParty.length).toBe(1);
        expect(p.underworld.guild.contactMet).toBe(true);
    });
});

describe('nights in the cell', () => {
    it('a bare jailState (the bot\'s) draws no randomness at day\'s end', () => {
        const world = makeWorld();
        const p = jailed();
        Utils.setSeed(4);
        const next = Utils.random();
        Utils.setSeed(4);
        expect(Prison.processDay(p, world).notices).toEqual([]);
        expect(Utils.random()).toBe(next);
    });

    it('the night runs on its own stream: tools arrive, a snitch sells you out', () => {
        const world = makeWorld();
        const p = jailed();
        const pr = Prison.state(p, world);
        pr.cellmates = [{ id: 'a', name: 'Odo the Grey', archetype: 'informant', rapport: 0, friend: false, sold: false }];
        pr.toolsDueDay = world.day;
        Utils.setSeed(4);
        const next = Utils.random();
        Utils.setSeed(4);
        let found = false;
        for (let i = 0; i < 40 && !found; i++) {
            const out = Prison.processDay(p, world);
            found = out.notices.some(n => n.title === 'Found Out');
            world.day += 1;
            pr.tunnel = Math.max(pr.tunnel, 10);
        }
        expect(Utils.random()).toBe(next);
        expect(found).toBe(true);
        expect(pr.cellmates[0].sold).toBe(true);
        expect(pr.tools).toBe(0);
    });

    it('PlayerActions.endDay serves the sentence and lists the jail actions', () => {
        const world = makeWorld();
        const p = jailed();
        const ids = PlayerActions.getAvailableActions(p, world.getTile(5, 5), world).map(a => a.type);
        expect(ids).toEqual(expect.arrayContaining(['jail_wait', 'jail_bail', 'jail_cell', 'jail_escape']));
    });
});

describe('servitude', () => {
    function bound() {
        return { ...jailed({ jailState: null }), indenturedServitude: { daysRemaining: 8, totalDays: 8, captor: 'the Red Band', escapeChance: 0.2, canBuyFreedom: true, freedomCost: 300 } };
    }

    it('an overseer can be bribed once a day; hard work shortens the bond', () => {
        const world = makeWorld();
        const p = bound();
        Utils.setRng(() => 0.99);
        const r = Prison.bribeOverseer(p, world);
        expect(r.freed).toBe(false);
        expect(Prison.bribeOverseer(p, world).success).toBe(false);
        const days = p.indenturedServitude.daysRemaining;
        Prison.servitudeWork(p);
        expect(p.indenturedServitude.daysRemaining).toBe(days - 1);
        world.day += 1;
        Utils.setRng(() => 0.0);
        expect(Prison.bribeOverseer(p, world).freed).toBe(true);
        expect(p.indenturedServitude).toBeNull();
    });

    it('the prison and servitude scenes render without throwing', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const world = makeWorld();
        const p = jailed();
        const panels = [];
        const game = { player: p, world, endDay() {}, ui: { showCustomPanel: (t, h) => panels.push(h), hideCustomPanel() {}, showNotification() {}, updateStats() {} } };
        ActionMenu.attemptJailbreak(game, 'cell');
        for (const c of ['mates', 'back', 'bribe', 'back', 'break', 'back']) ActionMenu.sceneAct(game, c);
        const mate = Prison.state(p, world).cellmates[0];
        ActionMenu.sceneAct(game, 'mates');
        ActionMenu.sceneAct(game, `food:${mate.id}`);
        ActionMenu.sceneAct(game, 'back');
        ActionMenu.sceneAct(game, 'work');
        expect(game._scene).toBeNull();
        const q = bound();
        game.player = q;
        ActionMenu.attemptServitudeEscape(game);
        ActionMenu.sceneAct(game, 'work');
        for (const h of panels) expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
    });
});
