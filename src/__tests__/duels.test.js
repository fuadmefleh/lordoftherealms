// The shared personal-combat engine (systems/duels.js): combatants from real
// state, the move matrix, stamina, temperament AI, determinism, and its
// wiring into rival duels, tournaments and inner-map brawls.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Duels } from '../systems/duels.js';
import { Rivals } from '../systems/rivals.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Traits } from '../systems/traits.js';
import { Ailments } from '../systems/ailments.js';
import { Player } from '../player/player.js';
import { InnerMapCombat } from '../ui/innerMapCombat.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => {
    Utils.setSeed(777);
});

function makePlayer(over = {}) {
    const p = new Player();
    p.name = 'Aldric';
    p.q = 5; p.r = 5;
    p.gold = 1000;
    p.health = 100; p.maxHealth = 100;
    p.renown = 10;
    p.inventory = {};
    p.army = [];
    p.skills = { ...(p.skills || {}), combat: 3 };
    p.strength = 6;
    p.luck = 5;
    Object.assign(p, over);
    return p;
}

/** A seeded stream for one test. */
function rngFrom(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

const always = () => 0; // every hit roll lands, every pick takes the first option

describe('combatants from real state', () => {
    it('the data file is loaded: four moves, a rock-paper-scissors cycle', () => {
        const C = Duels.config();
        expect(Duels.MOVES).toEqual(['strike', 'thrust', 'feint', 'guard']);
        for (const m of Duels.MOVES) expect(C.moves[m]).toBeTruthy();
        // Each move beats exactly one other and is beaten by exactly one
        for (const m of Duels.MOVES) {
            expect(Duels.MOVES).toContain(C.beats[m]);
            expect(Duels.MOVES.filter(x => C.beats[x] === m)).toHaveLength(1);
        }
        expect(C.tournament.tiers.length).toBe(3);
    });

    it('the best carried weapon counts; a shield guards and ripostes; armour turns blows', () => {
        const bare = Duels.fromPlayer(makePlayer());
        const armed = Duels.fromPlayer(makePlayer({ inventory: { weapons: 1, tools: 1 } }));
        const magic = Duels.fromPlayer(makePlayer({ inventory: { weapons: 1, enchanted_weapon: 1 } }));
        expect(bare.weapon).toBe('bare fists');
        expect(armed.weapon).toMatch(/sword/);
        expect(magic.weapon).toMatch(/enchanted/);
        expect(armed.power).toBeGreaterThan(bare.power);
        expect(magic.power).toBeGreaterThan(armed.power);
        expect(armed.attack).toBeGreaterThan(bare.attack);

        const shielded = Duels.fromPlayer(makePlayer({ inventory: { shield: 1 } }));
        expect(shielded.defense).toBeGreaterThan(bare.defense);
        expect(shielded.riposte).toBeGreaterThan(0);

        const armoured = Duels.fromPlayer(makePlayer({ inventory: { leather_armor: 1 } }));
        expect(armoured.armour).toBeCloseTo(0.2);
        const blessed = Duels.fromPlayer(makePlayer({ blessings: { protection: 3 } }));
        expect(blessed.armour).toBe(Duels.config().maxArmour);
    });

    it('an equipped weapon is used even over a better one in the pack', () => {
        const p = makePlayer({ inventory: { weapons: 1, enchanted_weapon: 1 }, equipped: { weapon: 'weapons' } });
        expect(Duels.fromPlayer(p).weapon).toMatch(/sword/);
    });

    it('wounds, traits, skill and health shape the fighter', () => {
        const whole = Duels.fromPlayer(makePlayer());
        const hurt = makePlayer();
        Ailments.inflict(hurt, { day: 1 }, 'broken_arm');
        expect(Duels.fromPlayer(hurt).attack).toBeLessThan(whole.attack);

        const brave = makePlayer();
        Traits.grantTraits(brave, ['brave']);
        expect(Duels.fromPlayer(brave).attack).toBeGreaterThan(whole.attack);

        const master = Duels.fromPlayer(makePlayer({ skills: { combat: 9 } }));
        expect(master.attack).toBeGreaterThan(whole.attack + 4);
        expect(master.defense).toBeGreaterThan(whole.defense);

        const battered = Duels.fromPlayer(makePlayer({ health: 20 }));
        expect(battered.hp).toBeLessThan(whole.hp);
        expect(Duels.fromPlayer(makePlayer({ health: 20 }), { fresh: true }).hp).toBe(whole.hp);
    });

    it('a tired player has less breath', () => {
        const rested = makePlayer({ needsEnabled: true });
        rested.needs.energy = 100;
        const tired = makePlayer({ needsEnabled: true });
        tired.needs.energy = 0;
        expect(Duels.fromPlayer(tired).maxStamina).toBeLessThan(Duels.fromPlayer(rested).maxStamina);
    });

    it('rivals, townsfolk and trainers get temperaments from who they are', () => {
        const rival = { id: 'r1', name: 'Kael', icon: '🗡️', archetype: 'sellsword', level: 3, stats: { prowess: 8, cunning: 4, faith: 3, charm: 4 } };
        const c = Duels.fromRival(rival);
        expect(c.temperament).toBe('aggressive');
        expect(c.attack).toBeGreaterThan(5);
        expect(Duels.fromRival({ ...rival, archetype: 'usurper' }).temperament).toBe('tricky');

        const bold = Duels.fromNpc({ id: 1, type: 'guard', name: 'Brom', personalityTraits: ['bold'] });
        expect(bold.temperament).toBe('aggressive');
        expect(bold.armour).toBeGreaterThan(0);
        expect(Duels.fromNpc({ id: 2, type: 'merchant', personalityTraits: ['cautious'] }).temperament).toBe('cautious');
        const guard = Duels.fromNpc({ id: 3, type: 'guard' });
        const child = Duels.fromNpc({ id: 4, type: 'child' });
        expect(guard.attack).toBeGreaterThan(child.attack);

        expect(Duels.trainer({ type: 'capital' }).name).toBe('Royal Swordmaster');
        expect(Duels.trainer({ type: 'town' }).name).toBe('Militia Sergeant');
    });
});

describe('the exchange', () => {
    const pair = () => {
        const a = Duels.fromProfile({ id: 'a', kind: 'player', name: 'A', attack: 4, defense: 3, power: 8, hp: 40, stamina: 10 });
        const b = Duels.fromProfile({ id: 'b', name: 'B', attack: 4, defense: 3, power: 8, hp: 40, stamina: 10 });
        return Duels.create(a, b, { mode: 'firstBlood' });
    };

    it('strike beats thrust; guard turns a strike into a riposte and winds the striker', () => {
        let s = pair();
        let e = Duels.exchange(s, 'strike', { bMove: 'thrust', rng: always });
        expect(e.dmgToB).toBeGreaterThan(0);
        expect(e.dmgToA).toBe(0);

        s = pair();
        e = Duels.exchange(s, 'guard', { bMove: 'strike', rng: always });
        expect(e.dmgToB).toBeGreaterThan(0);
        expect(e.dmgToA).toBe(0);
        // Strike cost 3, winded 1 more, then a breath back
        expect(s.b.stamina).toBe(10 - 3 - 1 + 1);
        // Guard recovers breath (capped at max)
        expect(s.a.stamina).toBe(10);
    });

    it('feint beats guard: drains breath and opens the next attack; thrust punishes a feint', () => {
        const s = pair();
        const e = Duels.exchange(s, 'feint', { bMove: 'guard', rng: always });
        expect(e.dmgToB).toBeGreaterThan(0);
        expect(s.b.stamina).toBeLessThan(10);
        expect(s.opening.a).toBeGreaterThan(0);

        const t = pair();
        const f = Duels.exchange(t, 'feint', { bMove: 'thrust', rng: always });
        expect(f.dmgToA).toBeGreaterThan(0);
        expect(f.dmgToB).toBe(0);
    });

    it('a strike with no breath left comes slow', () => {
        const s = pair();
        s.a.stamina = 1;
        const e = Duels.exchange(s, 'strike', { bMove: 'feint', rng: () => 0.5 });
        expect(e.notes.some(n => /blown/.test(n))).toBe(true);
    });

    it('armour turns part of every blow', () => {
        const soft = pair();
        const hard = pair();
        hard.b.armour = 0.5;
        const e1 = Duels.exchange(soft, 'strike', { bMove: 'thrust', rng: always });
        const e2 = Duels.exchange(hard, 'strike', { bMove: 'thrust', rng: always });
        expect(e2.dmgToB).toBeLessThan(e1.dmgToB);
    });

    it('yielding ends the duel; in a duel to the death the opponent never yields', () => {
        const s = pair();
        Duels.exchange(s, 'yield');
        const r = Duels.result(s);
        expect(s.over).toBe(true);
        expect(r.playerWon).toBe(false);
        expect(r.yielded).toBe('a');

        for (let seed = 1; seed < 40; seed++) {
            const a = Duels.fromProfile({ kind: 'player', attack: 9, defense: 8, power: 12, hp: 60, stamina: 14 });
            const b = Duels.fromProfile({ attack: 1, defense: 1, power: 5, hp: 20, stamina: 8, temperament: 'cautious' });
            const res = Duels.autoResolve(a, b, { mode: 'toDeath', rng: rngFrom(seed) });
            expect(res.yielded).not.toBe('b');
        }
    });

    it('spar bouts end after five exchanges, and may be drawn', () => {
        const a = Duels.fromProfile({ kind: 'player', attack: 3, defense: 3, power: 6, hp: 200, stamina: 10 });
        const b = Duels.fromProfile({ attack: 3, defense: 3, power: 6, hp: 200, stamina: 10 });
        const r = Duels.autoResolve(a, b, { mode: 'spar', rng: rngFrom(5) });
        expect(r.rounds).toBe(5);
    });
});

describe('the opponent AI', () => {
    const picks = (temperament, n = 600, history = []) => {
        const rng = rngFrom(42);
        const counts = { strike: 0, thrust: 0, feint: 0, guard: 0, yield: 0 };
        for (let i = 0; i < n; i++) {
            const s = Duels.create(
                Duels.fromProfile({ kind: 'player', name: 'A' }),
                Duels.fromProfile({ name: 'B', temperament }),
            );
            s.history.a = history.slice();
            counts[Duels.aiMove(s, 'b', rng)]++;
        }
        return counts;
    };

    it('aggressive fighters attack, cautious ones guard, tricky ones feint', () => {
        const ag = picks('aggressive');
        const ca = picks('cautious');
        const tr = picks('tricky');
        expect(ag.strike + ag.thrust).toBeGreaterThan(ca.strike + ca.thrust);
        expect(ca.guard).toBeGreaterThan(ag.guard);
        expect(tr.feint).toBeGreaterThan(ag.feint);
    });

    it('a tricky fighter reads a habit and counters it', () => {
        const tr = picks('tricky', 600, ['strike', 'strike', 'strike']);
        // Guard beats Strike
        expect(tr.guard / 600).toBeGreaterThan(0.45);
    });

    it('a winded fighter guards', () => {
        const rng = rngFrom(9);
        let guards = 0;
        for (let i = 0; i < 300; i++) {
            const s = Duels.create(Duels.fromProfile({ kind: 'player' }), Duels.fromProfile({ temperament: 'aggressive' }));
            s.b.stamina = 1;
            if (Duels.aiMove(s, 'b', rng) === 'guard') guards++;
        }
        expect(guards / 300).toBeGreaterThan(0.4);
    });
});

describe('outcomes', () => {
    it('is deterministic for a seed', () => {
        const run = () => {
            Utils.setSeed(2024);
            const r = Duels.autoResolve(Duels.fromPlayer(makePlayer()), Duels.fromProfile({ attack: 4, defense: 3, power: 7, hp: 30, temperament: 'tricky' }));
            return r.log.map(e => `${e.aMove}/${e.bMove}/${e.dmgToA}/${e.dmgToB}`).join(',') + r.winner;
        };
        expect(run()).toBe(run());
    });

    it('skill tells: a master beats a novice almost always', () => {
        let wins = 0;
        for (let seed = 1; seed <= 200; seed++) {
            const a = Duels.fromPlayer(makePlayer({ skills: { combat: 10 }, strength: 10, inventory: { weapons: 1 } }));
            const b = Duels.fromProfile({ attack: 1.5, defense: 1.5, power: 6, hp: 24, temperament: 'aggressive' });
            if (Duels.autoResolve(a, b, { rng: rngFrom(seed) }).playerWon) wins++;
        }
        expect(wins).toBeGreaterThanOrEqual(190);
    });

    it('evenly matched fighters split their bouts', () => {
        let wins = 0;
        for (let seed = 1; seed <= 200; seed++) {
            const a = Duels.fromProfile({ kind: 'player', attack: 4, defense: 3, power: 8, hp: 30, stamina: 11 });
            const b = Duels.fromProfile({ attack: 4, defense: 3, power: 8, hp: 30, stamina: 11 });
            if (Duels.autoResolve(a, b, { rng: rngFrom(seed) }).playerWon) wins++;
        }
        expect(wins).toBeGreaterThan(50);
        expect(wins).toBeLessThan(150);
    });

    it('harm scales with the share of the bout pool lost', () => {
        expect(Duels.harm(0, [8, 20])).toBe(8);
        expect(Duels.harm(1, [8, 20])).toBe(20);
        expect(Duels.harm(0.5, [8, 20])).toBe(14);
    });
});

describe('tournaments', () => {
    it('a bracket of three named opponents, weakest first; rivals take places', () => {
        const rival = Duels.fromRival({ id: 'r1', name: 'Kael the Bold', archetype: 'duelist', level: 4, stats: { prowess: 9, cunning: 5 } });
        const field = Duels.tournamentField({ name: 'Tallow' }, [rival]);
        expect(field).toHaveLength(3);
        expect(field.map(f => f.name)).toContain('Kael the Bold');
        for (const f of field) expect(f.name.length).toBeGreaterThan(3);
        const str = (c) => c.attack + c.defense * 0.6 + c.power * 0.3 + c.maxHp * 0.05;
        expect(str(field[0])).toBeLessThanOrEqual(str(field[1]));
        expect(str(field[1])).toBeLessThanOrEqual(str(field[2]));
    });

    it('the champion takes the purse; the runner-up a share; harm and wounds follow the bouts', () => {
        const won = { playerWon: true, aLost: 0.2 };
        const lost = { playerWon: false, aLost: 0.9 };
        const champ = makePlayer();
        const gold = champ.gold;
        const out = Duels.settleTournament(champ, { prizePool: 600, bouts: [{ result: won }, { result: won }, { result: won }], armour: 0, world: { day: 3 } });
        expect(out.champion).toBe(true);
        expect(champ.gold).toBe(gold + 600);
        expect(out.renown).toBe(3 * 2 + 5);
        expect(out.harm).toBeGreaterThan(0);

        const second = makePlayer();
        const o2 = Duels.settleTournament(second, { prizePool: 600, bouts: [{ result: won }, { result: won }, { result: lost }], armour: 0.2 });
        expect(o2.finalist).toBe(true);
        expect(o2.gold).toBe(240);

        const out1 = Duels.settleTournament(makePlayer(), { prizePool: 600, bouts: [{ result: lost }] });
        expect(out1.gold).toBe(0);
        expect(out1.wins).toBe(0);
    });
});

describe('rival duels use the engine', () => {
    const W = 30;
    const H = 20;
    function makeWorld(day = 5) {
        const tiles = [];
        for (let r = 0; r < H; r++) {
            const row = [];
            for (let q = 0; q < W; q++) row.push({ q, r, terrain: { id: 'grassland', passable: true } });
            tiles.push(row);
        }
        const towns = [
            { q: 5, r: 5, name: 'Tallow', type: 'town', kingdom: 'k1', population: 800 },
            { q: 12, r: 6, name: 'Brindle', type: 'capital', kingdom: 'k1', population: 2000 },
        ];
        for (const t of towns) tiles[t.r][t.q].settlement = { ...t };
        const world = {
            day, width: W, height: H, tiles, units: [],
            kingdoms: [{ id: 'k1', name: 'Arvenland', isAlive: true, settlements: towns }],
            getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
            getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
            getAllSettlements() {
                const out = [];
                for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (tiles[r][q].settlement) out.push({ q, r, ...tiles[r][q].settlement });
                return out;
            },
        };
        return world;
    }
    function setup() {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        rival.task = null;
        rival.q = player.q; rival.r = player.r;
        rival.attitude = 0;
        return { world, player, rival };
    }

    it('an interactive outcome is honoured, whatever the stats', () => {
        const { world, player, rival } = setup();
        player.skills.combat = 10;
        player.strength = 10;
        rival.stats.prowess = 1;
        const { a, b } = Rivals.duelists(player, rival);
        const outcome = { playerWon: false, aLost: 1, bLost: 0.1, yielded: 'a', rounds: 3 };
        expect(a.kind).toBe('player');
        expect(b.name).toBe(rival.name);
        const res = Rivals.duel(player, world, rival.id, { outcome });
        expect(res.success).toBe(true);
        expect(res.playerWon).toBe(false);
        expect(res.yielded).toBe('a');
        expect(res.harm).toBeGreaterThan(0);
    });

    it('canDuel gates the challenge (once a day)', () => {
        const { world, player, rival } = setup();
        expect(Rivals.canDuel(player, world, rival.id).ok).toBe(true);
        Rivals.duel(player, world, rival.id);
        expect(Rivals.canDuel(player, world, rival.id).ok).toBe(false);
    });

    it('auto-resolved duels: the better-armed fighter wins more', () => {
        let armed = 0;
        let bare = 0;
        for (let seed = 1; seed <= 60; seed++) {
            for (const kit of ['armed', 'bare']) {
                Utils.setSeed(seed);
                const { world, player, rival } = setup();
                rival.stats.prowess = 6; rival.level = 3; rival.stats.cunning = 5;
                player.skills.combat = 5;
                player.strength = 7;
                if (kit === 'armed') player.inventory = { enchanted_weapon: 1, shield: 1, leather_armor: 1 };
                const res = Rivals.duel(player, world, rival.id);
                if (res.playerWon) { if (kit === 'armed') armed++; else bare++; }
            }
        }
        expect(armed).toBeGreaterThan(bare);
    });
});

describe('inner-map brawls', () => {
    it('the weapon carried counts in every swing', () => {
        const bare = InnerMapCombat._computePlayerDamage(makePlayer());
        const sword = InnerMapCombat._computePlayerDamage(makePlayer({ inventory: { weapons: 1 } }));
        const blade = InnerMapCombat._computePlayerDamage(makePlayer({ inventory: { enchanted_weapon: 1 } }));
        expect(sword).toBeGreaterThan(bare);
        expect(blade).toBeGreaterThan(sword);
    });

    it('a townsperson keeps their purse, their injury heals day by day, and a killing goes on the roster', () => {
        const world = { day: 10, generationParams: { seed: 99 } };
        const folk = { q: 3, r: 4, people: [] };
        const p = { id: 7, first: 'Brom', last: 'Oakshield', born: -2000, role: 'merchant', spouse: null, kids: [], parents: [], log: [] };
        folk.people.push(p);
        const coin = Townsfolk.purse(folk, p, world, [15, 60]);
        expect(coin).toBeGreaterThanOrEqual(15);
        expect(coin).toBeLessThanOrEqual(60);
        expect(Townsfolk.purse(folk, p, world, [15, 60])).toBe(coin); // rolled once
        // Its own hash stream: the shared RNG is untouched
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        const q = { ...p, id: 8 };
        delete q.purse;
        Townsfolk.purse(folk, q, world, [1, 9]);
        expect(Utils.random()).toBe(before);

        expect(Townsfolk.takePurse(folk, p, world, [15, 60])).toBe(coin);
        expect(Townsfolk.purse(folk, p, world, [15, 60])).toBe(0);

        Townsfolk.injure(p, 10, 20, 80);
        expect(Townsfolk.injury(p, 10).hp).toBe(20);
        expect(Townsfolk.injury(p, 12, 0.12).hp).toBeGreaterThan(20);
        expect(Townsfolk.injury(p, 30, 0.12)).toBeNull();
        expect(p.hurt).toBeUndefined();

        Townsfolk.slay(folk, p, 11, 'a brawl');
        expect(p.died).toBe(11);
        expect(Townsfolk.isHere(p)).toBe(false);
    });

    it('spoils come from what the NPC actually carries', () => {
        const npc = { id: 1, type: 'blacksmith_npc', shopInventory: { weapons: { qty: 4, markup: 1 }, iron: { qty: 0, markup: 1 } } };
        const spoils = Duels.brawlSpoils(npc, rngFrom(3));
        expect(spoils.length).toBe(1);
        expect(spoils[0].id).toBe('weapons');
        expect(spoils[0].qty).toBe(2);
        expect(Duels.brawlSpoils({ id: 2, type: 'villager' })).toEqual([]);
        expect(Duels.npcBrawlHp({ type: 'guard' })).toBeGreaterThan(Duels.npcBrawlHp({ type: 'child' }));
    });

    it('an injured townsperson starts the next brawl hurt', () => {
        const p = { id: 1, hurt: { hp: 10, max: 100, d: 5 } };
        const npc = { id: 3, type: 'villager', name: 'Una', q: 0, r: 0 };
        Object.defineProperty(npc, '_person', { value: p });
        const game = { world: { day: 5 }, player: makePlayer(), ui: null };
        InnerMapCombat._npcHealth = new Map();
        InnerMapCombat._npcReactions = new Map();
        InnerMapCombat._beginNPCAttack(game, npc);
        const h = InnerMapCombat.getNPCHealth(3);
        expect(h.current).toBeLessThan(h.max * 0.2);
        InnerMapCombat.cancelAttack();
    });
});

describe('the duel panel', () => {
    it('renders both fighters, plays moves, and hands the result over once', async () => {
        const { DuelPanel } = await import('../ui/actionMenu/duel.js');
        const shown = [];
        const game = { ui: { showCustomPanel: (t, h) => shown.push({ t, h }), hideCustomPanel() {} } };
        const results = [];
        const a = Duels.fromPlayer(makePlayer({ inventory: { weapons: 1, shield: 1 } }));
        const b = Duels.trainer({ type: 'town' });
        const state = DuelPanel.open(game, { a, b, mode: 'spar', title: 'Spar', onFinish: (r) => results.push(r) });
        expect(shown[0].h).toContain('Militia Sergeant');
        expect(shown[0].h).toContain('munition sword');
        for (const m of Duels.MOVES) expect(shown[0].h).toContain(`window._duel.move('${m}')`);
        window._duel.move('guard');
        expect(state.round).toBe(1);
        expect(shown[shown.length - 1].h).toMatch(/R1/);
        window._duel.auto();
        expect(state.over).toBe(true);
        window._duel.done();
        window._duel.done();
        expect(results).toHaveLength(1);
        expect(results[0].rounds).toBe(5);
    });
});
