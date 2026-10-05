// Petitions & the Court: data-driven dilemmas brought to the player's
// holdings, with chained follow-ups, expiry costs and a court reputation.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { House } from '../systems/house.js';
import { Councils } from '../systems/councils.js';
import { Petitions } from '../systems/petitions.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { NPCLords } from '../world/npcLords.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(day = 10) {
    const tiles = new Map();
    const kingdoms = [
        { id: 'k1', name: 'Varr', isAlive: true, military: 500, stability: 60, wars: [], capital: { q: 5, r: 5 }, religion: { faithId: 'solaris', name: 'The Solar Covenant', piety: 50 } },
        { id: 'k2', name: 'Osk', isAlive: true, military: 300, stability: 60, wars: [] },
    ];
    const world = {
        day,
        season: 'Winter',
        kingdoms,
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        _tiles: tiles,
    };
    tiles.set('1,1', {
        q: 1, r: 1,
        settlement: {
            name: 'Millbrook', type: 'town', population: 900, kingdom: 'k1', happiness: 50,
            colony: { isPlayerColony: true, loyalty: 50 },
            demographics: [
                { tribe: { id: 'ashfolk', name: 'Ashfolk' }, population: 500, sentiment: 50 },
                { tribe: { id: 'bramble', name: 'Bramblers' }, population: 300, sentiment: 50 },
            ],
        },
    });
    tiles.set('5,5', { q: 5, r: 5, settlement: { name: 'Varrholt', type: 'capital', population: 3000, kingdom: 'k1', happiness: 50 } });
    return world;
}

function makePlayer(world, { holdings = true } = {}) {
    const player = {
        id: 'p1', lastName: 'Ashborne', gold: 5000, karma: 0, renown: 20,
        reputation: { k1: 0, k2: 0 }, properties: [], houses: [], children: [],
        colonies: holdings ? [{ q: 1, r: 1 }] : [],
        allegiance: 'k1',
        currentTitle: holdings ? 'chancellor' : null,
        kingdomTitle: holdings ? 'chancellor' : 'citizen',
        religion: holdings ? { name: 'Way of the Ember', followers: 200, presence: {} } : null,
        realmWars: holdings ? { wars: { k2: { kingdomId: 'k2' } }, ultimatums: {}, truces: {} } : undefined,
    };
    House.initialize(player, world);
    if (holdings) House.seedRivals(player, world, 1);
    return player;
}

const BASES = (world) => ({
    settlement: { kind: 'settlement', q: 1, r: 1, settlement: world.getTile(1, 1).settlement },
    office: { kind: 'office', q: 5, r: 5, settlement: world.getTile(5, 5).settlement, kingdomId: 'k1' },
    house: { kind: 'house' },
});

function forceSpawn(player, world, defId) {
    const def = Petitions.getDef(defId);
    const kind = ((def.requires && def.requires.holding) || ['settlement'])[0];
    const base = BASES(world)[kind];
    return Petitions._create(player, world, def, defId, Petitions._buildCtx(def, base, player, world));
}

function allEffectBlocks(def) {
    const blocks = [];
    if (def.ignore) blocks.push(['ignore', def.ignore.effects || {}]);
    for (const ch of def.choices || []) {
        blocks.push([`choice ${ch.id}`, ch.effects || {}]);
        if (ch.gamble) {
            if (ch.gamble.success) blocks.push([`choice ${ch.id} gamble success`, ch.gamble.success.effects || {}]);
            if (ch.gamble.failure) blocks.push([`choice ${ch.id} gamble failure`, ch.gamble.failure.effects || {}]);
        }
    }
    return blocks;
}

describe('petition registry (data/petitions.json)', () => {
    const defs = () => Petitions.defs();
    const TOKENS = new Set(['name', 'name2', 'settlement', 'kingdom', 'people', 'rivalPeople', 'faith', 'house', 'rival', 'prior', 'priorChoice']);

    it('has at least 25 petitions that can arrive on their own, plus chained follow-ups', () => {
        const all = Object.values(defs());
        expect(all.filter(d => !d.followUpOnly).length).toBeGreaterThanOrEqual(25);
        expect(all.filter(d => d.followUpOnly).length).toBeGreaterThan(0);
    });

    it('every petition is well-formed: 2–4 choices, an ignore cost, known conditions and holding kinds', () => {
        for (const [id, def] of Object.entries(defs())) {
            expect(def.title, id).toBeTruthy();
            expect(def.text, id).toBeTruthy();
            expect(def.choices.length, id).toBeGreaterThanOrEqual(2);
            expect(def.choices.length, id).toBeLessThanOrEqual(4);
            expect(new Set(def.choices.map(c => c.id)).size, `${id} duplicate choice ids`).toBe(def.choices.length);
            expect(def.ignore, `${id} needs an ignore cost`).toBeTruthy();
            for (const key of Object.keys(def.requires || {})) {
                expect(Petitions.REQUIREMENT_KEYS, `${id} requires.${key}`).toContain(key);
            }
            for (const kind of (def.requires && def.requires.holding) || []) {
                expect(Petitions.HOLDING_KINDS, `${id} holding ${kind}`).toContain(kind);
            }
            for (const ch of def.choices) {
                expect(ch.label, `${id}.${ch.id}`).toBeTruthy();
                expect(ch.result, `${id}.${ch.id}`).toBeTruthy();
                for (const key of Object.keys(ch.requires || {})) {
                    expect(Petitions.CHOICE_REQUIREMENT_KEYS, `${id}.${ch.id} requires.${key}`).toContain(key);
                }
            }
        }
    });

    it('every choice, gamble branch and ignore cost uses only registered effect keys with valid values', () => {
        const factions = new Set(Councils.FACTIONS.map(f => f.id));
        for (const [id, def] of Object.entries(defs())) {
            for (const [where, effects] of allEffectBlocks(def)) {
                for (const [key, value] of Object.entries(effects)) {
                    expect(Petitions.EFFECTS, `${id} ${where}: unknown effect "${key}"`).toHaveProperty(key);
                    if (key === 'faction') {
                        for (const [f, v] of Object.entries(value)) {
                            expect(factions.has(f), `${id} ${where}: faction ${f}`).toBe(true);
                            expect(typeof v).toBe('number');
                        }
                    } else if (key === 'court') {
                        for (const [axis, v] of Object.entries(value)) {
                            expect(Petitions.COURT_AXES, `${id} ${where}: court axis ${axis}`).toContain(axis);
                            expect(typeof v).toBe('number');
                        }
                    } else if (key === 'monopoly') {
                        expect(typeof value.good, `${id} ${where}: monopoly good`).toBe('string');
                    } else if (key === 'charter') {
                        expect(value, `${id} ${where}: charter`).toBe(true);
                    } else {
                        expect(typeof value, `${id} ${where}: ${key}`).toBe('number');
                    }
                }
            }
        }
    });

    it('every choice offers a real trade-off: something gained or some cost paid', () => {
        for (const [id, def] of Object.entries(defs())) {
            for (const ch of def.choices) {
                const keys = Object.keys(ch.effects || {}).filter(k => k !== 'court');
                expect(keys.length + (ch.gamble ? 1 : 0), `${id}.${ch.id} does nothing`).toBeGreaterThan(0);
            }
        }
    });

    it('follow-ups point at real petitions, and every follow-up-only petition is reachable', () => {
        const reachable = new Set();
        for (const [id, def] of Object.entries(defs())) {
            for (const ch of def.choices) {
                if (!ch.followUp) continue;
                expect(Array.isArray(ch.followUp.delay), `${id}.${ch.id} delay`).toBe(true);
                for (const o of ch.followUp.options) {
                    expect(defs()[o.id], `${id}.${ch.id} → ${o.id}`).toBeTruthy();
                    reachable.add(o.id);
                }
            }
        }
        for (const [id, def] of Object.entries(defs())) {
            if (def.followUpOnly) expect(reachable.has(id), `${id} is never scheduled`).toBe(true);
        }
    });

    it('texts only use known {tokens}', () => {
        const check = (id, s) => {
            for (const m of String(s || '').matchAll(/\{(\w+)\}/g)) expect(TOKENS.has(m[1]), `${id}: {${m[1]}}`).toBe(true);
        };
        for (const [id, def] of Object.entries(defs())) {
            check(id, def.title); check(id, def.text); check(id, def.ignore && def.ignore.result);
            for (const ch of def.choices) {
                check(id, ch.label); check(id, ch.result); check(id, ch.chronicle);
                if (ch.gamble) { check(id, ch.gamble.success && ch.gamble.success.result); check(id, ch.gamble.failure && ch.gamble.failure.result); }
            }
        }
    });

    it('every choice of every petition can be ruled on without error', () => {
        Utils.setSeed(11);
        for (const [id, def] of Object.entries(defs())) {
            for (const ch of def.choices) {
                const world = makeWorld();
                const player = makePlayer(world);
                const p = forceSpawn(player, world, id);
                expect(p, id).toBeTruthy();
                const res = Petitions.rule(player, world, p.id, ch.id);
                expect(res.success, `${id}.${ch.id}: ${res.reason}`).toBe(true);
                expect(Number.isFinite(player.gold)).toBe(true);
                expect(res.text).not.toMatch(/\{\w+\}/);
                expect(Petitions.pending(player).find(x => x.id === p.id)).toBeUndefined();
            }
        }
    });
});

describe('ruling effects', () => {
    it('applies gold, happiness, council factions and court reputation', () => {
        Utils.setSeed(3);
        const world = makeWorld();
        const player = makePlayer(world);
        Councils._ensureState(player);
        const merchantsBefore = player.council.factions.merchants.support;
        const p = forceSpawn(player, world, 'guild_monopoly');
        const goldBefore = player.gold;
        const res = Petitions.rule(player, world, p.id, 'refuse');
        expect(res.success).toBe(true);
        expect(world.getTile(1, 1).settlement.happiness).toBe(53);
        expect(player.council.factions.merchants.support).toBe(merchantsBefore - 6);
        expect(player.gold).toBe(goldBefore);
        expect(Petitions.courtStanding(player).justice).toBe(1);
        expect(Petitions.history(player).at(-1)).toMatchObject({ defId: 'guild_monopoly', outcome: 'ruled', choiceId: 'refuse' });
    });

    it('a choice that costs gold cannot be taken without it', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.gold = 10;
        const p = forceSpawn(player, world, 'temple_request');
        const res = Petitions.rule(player, world, p.id, 'temple');
        expect(res.success).toBe(false);
        expect(Petitions.pending(player)).toHaveLength(1);
    });

    it('peoples conflicts move the two peoples\' sentiment in opposite directions', () => {
        Utils.setSeed(5);
        const world = makeWorld();
        const player = makePlayer(world);
        const p = forceSpawn(player, world, 'peoples_conflict');
        expect(p.ctx.peopleName).toBe('Ashfolk');
        expect(p.ctx.rivalPeopleName).toBe('Bramblers');
        Petitions.rule(player, world, p.id, 'side_a');
        const [a, b] = world.getTile(1, 1).settlement.demographics;
        expect(a.sentiment).toBe(62);
        expect(b.sentiment).toBe(38);
    });

    it('notable rulings enter the House chronicle and sway lords by their traits', () => {
        Utils.setSeed(9);
        const world = makeWorld();
        const player = makePlayer(world);
        const honorable = { traits: [{ id: 'honorable' }] };
        const cruel = { traits: [{ id: 'cruel' }] };
        const before = NPCLords.getLordOpinion(honorable, player);
        const p = forceSpawn(player, world, 'noble_sons_crime');
        Petitions.rule(player, world, p.id, 'hang');
        expect(player.house.history.at(-1).text).toMatch(/hanged a noble's son/);
        expect(player.house.history.at(-1).tags).toContain('court');
        expect(NPCLords.getLordOpinion(honorable, player)).toBeGreaterThan(before);
        expect(NPCLords.courtOpinion(cruel, player)).toBe(1);
        player.petitions.court.justice = 200;
        expect(NPCLords.courtOpinion(honorable, player)).toBe(NPCLords.COURT_OPINION_CAP);
    });
});

describe('chained follow-ups', () => {
    it('a pardoned bandit returns days later, remembered by name', () => {
        Utils.setSeed(21);
        const world = makeWorld(10);
        const player = makePlayer(world);
        const p = forceSpawn(player, world, 'bandit_surrender');
        const bandit = p.ctx.name;
        const res = Petitions.rule(player, world, p.id, 'pardon');
        expect(res.followUp).toBeTruthy();
        expect(['bandit_loyal', 'bandit_betrays']).toContain(res.followUp.defId);
        expect(res.followUp.dueDay).toBeGreaterThanOrEqual(18);
        expect(res.followUp.dueDay).toBeLessThanOrEqual(26);

        player.petitions.nextDay = 9999; // keep random petitions out of the way
        world.day = res.followUp.dueDay - 1;
        expect(Petitions.processDay(player, world).arrived).toHaveLength(0);
        world.day = res.followUp.dueDay;
        const out = Petitions.processDay(player, world);
        expect(out.arrived).toHaveLength(1);
        const back = out.arrived[0];
        expect(back.defId).toBe(res.followUp.defId);
        expect(back.text).toContain(bandit);
        expect(back.ctx.priorChoice).toMatch(/Pardon/);
        expect(player.petitions.scheduled).toHaveLength(0);
    });

    it('a pardoned noble son can kill again — and the follow-up names the son, not the father', () => {
        Utils.setSeed(2);
        const world = makeWorld(10);
        const player = makePlayer(world);
        let res = null;
        let son = null;
        // The bribe schedules a return 75% of the time — try seeds until one fires.
        for (let seed = 1; seed < 20 && !(res && res.followUp); seed++) {
            Utils.setSeed(seed);
            const p = forceSpawn(player, world, 'noble_sons_crime');
            son = p.ctx.name2;
            res = Petitions.rule(player, world, p.id, 'bribe');
        }
        expect(res.followUp.defId).toBe('noble_son_again');
        expect(res.followUp.ctx.prior).toBe(son);
    });

    it('a follow-up for a settlement the player has lost never arrives', () => {
        Utils.setSeed(4);
        const world = makeWorld(10);
        const player = makePlayer(world);
        const p = forceSpawn(player, world, 'refugees_at_gates');
        const res = Petitions.rule(player, world, p.id, 'admit');
        player.colonies = [];
        world.getTile(1, 1).settlement.colony.isPlayerColony = false;
        world.getTile(1, 1).settlement.kingdom = 'k2';
        player.petitions.nextDay = 9999;
        world.day = res.followUp.dueDay;
        expect(Petitions.processDay(player, world).arrived).toHaveLength(0);
        expect(player.petitions.scheduled).toHaveLength(0);
    });
});

describe('expiry', () => {
    it('an ignored petition expires on its day and its cost applies', () => {
        Utils.setSeed(8);
        const world = makeWorld(10);
        const player = makePlayer(world);
        const p = forceSpawn(player, world, 'land_dispute');
        expect(p.expiresDay).toBe(18);
        player.petitions.nextDay = 9999;
        world.day = 17;
        expect(Petitions.processDay(player, world).expired).toHaveLength(0);
        world.day = 18;
        const out = Petitions.processDay(player, world);
        expect(out.expired).toHaveLength(1);
        expect(out.expired[0].effects).toContain('-3 happiness');
        expect(world.getTile(1, 1).settlement.happiness).toBe(47);
        expect(Petitions.pending(player)).toHaveLength(0);
        expect(Petitions.history(player).at(-1)).toMatchObject({ defId: 'land_dispute', outcome: 'expired' });
        expect(player.petitions.stats.ignored).toBe(1);
    });

    it('dismissing petitioners applies the ignore cost at once', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const p = forceSpawn(player, world, 'cousin_debts');
        const before = player.house.prestige = 30;
        const res = Petitions.dismiss(player, world, p.id);
        expect(res.success).toBe(true);
        expect(player.house.prestige).toBe(before - 4);
        expect(Petitions.history(player).at(-1).outcome).toBe('dismissed');
    });
});

describe('daily tick', () => {
    it('draws no RNG and creates no state for a player without holdings', () => {
        const world = makeWorld();
        const player = makePlayer(world, { holdings: false });
        let draws = 0;
        Utils.setRng(() => { draws++; return 0.5; });
        for (let d = 1; d <= 60; d++) {
            world.day = d;
            Petitions.processDay(player, world);
        }
        Utils.resetRng();
        expect(draws).toBe(0);
        expect(player.petitions).toBeUndefined();
    });

    it('brings petitioners on a cadence once the player holds land, never more than the cap at once', () => {
        Utils.setSeed(1234);
        const world = makeWorld(1);
        const player = makePlayer(world);
        const arrived = [];
        for (let d = 1; d <= 80; d++) {
            world.day = d;
            const out = Petitions.processDay(player, world);
            arrived.push(...out.arrived);
            expect(Petitions.pending(player).length).toBeLessThanOrEqual(Petitions.config().maxPending + player.petitions.scheduled.length + 1);
        }
        expect(arrived.length).toBeGreaterThanOrEqual(4);
        expect(arrived[0].arrivedDay).toBeGreaterThanOrEqual(1 + Petitions.config().firstDelay);
        // Fits the context: no summer-only petitions in winter
        expect(arrived.some(p => p.defId === 'festival_request' || p.defId === 'drought_plea')).toBe(false);
    });

    it('is deterministic for a fixed seed', () => {
        const run = () => {
            Utils.setSeed(77);
            const world = makeWorld(1);
            const player = makePlayer(world);
            const ids = [];
            for (let d = 1; d <= 40; d++) {
                world.day = d;
                for (const p of Petitions.processDay(player, world).arrived) ids.push(`${d}:${p.defId}:${p.ctx.name}`);
            }
            return ids;
        };
        expect(run()).toEqual(run());
    });

    it('gates petitions on season, war, peoples and faith', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const b = BASES(world);
        const def = (id) => Petitions.getDef(id);
        expect(Petitions.isEligible(def('famine_plea'), b.settlement, player, world)).toBe(true);
        world.season = 'Summer';
        expect(Petitions.isEligible(def('famine_plea'), b.settlement, player, world)).toBe(false);
        expect(Petitions.isEligible(def('drought_plea'), b.settlement, player, world)).toBe(true);
        expect(Petitions.isEligible(def('deserter_caught'), b.settlement, player, world)).toBe(true);
        player.realmWars.wars = {};
        expect(Petitions.isEligible(def('deserter_caught'), b.settlement, player, world)).toBe(false);
        expect(Petitions.isEligible(def('peoples_conflict'), b.office, player, world)).toBe(false);
        expect(Petitions.isEligible(def('peoples_conflict'), b.settlement, player, world)).toBe(true);
        world.getTile(1, 1).settlement.demographics = [];
        expect(Petitions.isEligible(def('peoples_conflict'), b.settlement, player, world)).toBe(false);
        expect(Petitions.isEligible(def('council_seat'), b.settlement, player, world)).toBe(false);
        expect(Petitions.isEligible(def('council_seat'), b.office, player, world)).toBe(true);
    });
});

describe('save & load', () => {
    it('round-trips pending petitions, follow-ups, history and court reputation', () => {
        Utils.setSeed(6);
        const world = makeWorld();
        const src = makePlayer(world);
        const p = forceSpawn(src, world, 'bandit_surrender');
        Petitions.rule(src, world, p.id, 'pardon');
        forceSpawn(src, world, 'orphans');

        const player = new Player();
        Object.assign(player, { petitions: src.petitions });
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.petitions.pending.map(x => x.defId)).toEqual(['orphans']);
        expect(back.petitions.scheduled).toHaveLength(1);
        expect(back.petitions.history).toHaveLength(1);
        expect(back.petitions.court.mercy).toBe(3);
    });

    it('older saves without petitions load, and partial state is backfilled', () => {
        const data = SaveLoad.serializePlayer(new Player());
        delete data.petitions;
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(back.petitions == null).toBe(true);

        const partial = new Player();
        partial.petitions = { pending: [] };
        Petitions.loadState(partial);
        expect(partial.petitions.history).toEqual([]);
        expect(partial.petitions.court.justice).toBe(0);
        expect(partial.petitions.nextId).toBe(1);
    });
});
