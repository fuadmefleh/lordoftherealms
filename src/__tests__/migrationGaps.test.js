// Migration's loose ends (systems/migration.js): towns change size class with
// their people, falling on a column of migrants has consequences, and people
// the player has dealt with may move away (and are followed there).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { STRATA } from '../world/townLabour.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Migration } from '../systems/migration.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Relationships } from '../systems/relationships.js';
import { Underworld } from '../systems/underworld.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

function quiet() {
    const a = vi.spyOn(console, 'log').mockImplementation(() => {});
    const b = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => { a.mockRestore(); b.mockRestore(); };
}

function linkedGame(seed) {
    const game = newGame(seed);
    for (let d = 0; d < 8; d++) { game.player.health = 100; game.player.inventory.bread = 40; endDay(game); }
    const links = MarketDynamics._cache(game.world).links.list;
    const link = links.find(l => l.a.population > 800 && l.b.population > 800 && l.a !== l.b
        && Math.abs(l.a.q - l.b.q) + Math.abs(l.a.r - l.b.r) >= 3) || links[0];
    const { a, b } = link;
    Townsfolk.seed(a, game.world, { q: a.q, r: a.r });
    Townsfolk.seed(b, game.world, { q: b.q, r: b.r });
    for (const s of STRATA) { a.labour.wel[s] = 0.3; b.labour.wel[s] = 0.98; }
    return { game, a, b };
}

describe('a town changes its size with its people', () => {
    it('grows village → town → city after holding there, and dwindles back; capitals stay', () => {
        const s = { name: 'Brook', type: 'village', level: 0, population: 700, q: 1, r: 1 };
        const world = { events: [] };
        const out = { notices: [] };
        expect(Migration._resize(world, s, 30, out)).toBe(false);
        expect(Migration._resize(world, s, 60, out)).toBe(false);
        expect(Migration._resize(world, s, 90, out)).toBe(true);
        expect(s.type).toBe('town');
        expect(s.level).toBe(1);
        // A month under the line resets the count: no flicker at the edge
        s.population = 6000;
        Migration._resize(world, s, 120, out);
        s.population = 4000;
        Migration._resize(world, s, 150, out);
        s.population = 6000;
        Migration._resize(world, s, 180, out);
        Migration._resize(world, s, 210, out);
        expect(s.type).toBe('town');
        Migration._resize(world, s, 240, out);
        expect(s.type).toBe('city');
        expect(s.level).toBe(2);
        s.population = 3000;
        for (let d = 270; d <= 330; d += 30) Migration._resize(world, s, d, out);
        expect(s.type).toBe('town');
        s.population = 200;
        for (let d = 360; d <= 420; d += 30) Migration._resize(world, s, d, out);
        expect(s.type).toBe('village');
        expect(world.events.length).toBe(4);
        // The player hears of it in their own town
        const player = { q: 1, r: 1 };
        s.population = 800;
        for (let d = 450; d <= 510; d += 30) Migration._resize(world, s, d, out, player, new Set());
        expect(out.notices.some(n => n.title === 'Brook Grows')).toBe(true);
        const cap = { name: 'Crown', type: 'capital', population: 100, q: 2, r: 2 };
        for (let d = 30; d <= 300; d += 30) Migration._resize(world, cap, d, out);
        expect(cap.type).toBe('capital');
        // Founded villages rise by their own rule
        const f = { name: 'New', type: 'village', population: 900, playerFounded: true, q: 3, r: 3 };
        for (let d = 30; d <= 300; d += 30) Migration._resize(world, f, d, out);
        expect(f.type).toBe('village');
    });
});

describe('falling on a column', () => {
    it('takes their purses, cuts down a share who never arrive, and is murder before the realm', () => {
        const restore = quiet();
        try {
            const { game, a, b } = linkedGame(808);
            const { world, player } = game;
            const moved = Migration._moveFolk(world, a, b, Math.ceil(a.population / Townsfolk.residents(a.folk).length * 3), 'war', 'refugees', world.day);
            expect(moved.length).toBeGreaterThan(0);
            for (const h of moved) for (const c of h.people || []) c.purse = 5;
            const u = Migration._spawnColumn(world, a, b, 90, 'refugees', 'war', moved, world.day);
            const popB = b.population;
            const gold0 = player.gold;
            const karma0 = player.karma || 0;
            const heat0 = Underworld.ensure(player).stats.crimes;
            const nB = b.folk.people.length;
            const res = PlayerMilitary.attackUnit(player, u, world, { combatResult: { victory: true } });
            expect(u.destroyed).toBe(true);
            expect(u.massacre.killed).toBe(27);
            expect(b.population).toBe(popB - 27);
            expect(player.gold).toBeGreaterThan(gold0);
            expect(res.inventoryLoot.gold).toBeGreaterThan(0);
            expect(player.karma).toBeLessThan(karma0 - 8);
            expect(Underworld.ensure(player).stats.crimes).toBeGreaterThan(heat0);
            // Some died on the road (their old roster says so); the rest reached the new town now
            const slain = a.folk.people.filter(p => p.cause === 'slain on the road');
            const survivors = b.folk.people.length - nB;
            const all = moved.reduce((t, h) => t + h.people.length, 0);
            expect(slain.length + survivors).toBe(all);
            expect(world.events.some(e => /cut down/.test(e.text))).toBe(true);
        } finally { restore(); }
    }, 60000);
});

describe('people you know move away', () => {
    it('go (less readily), tell you, keep their memory of you, and are followed to their new town', () => {
        const restore = quiet();
        try {
            const { game, a, b } = linkedGame(909);
            const { world, player } = game;
            // The player has spoken with everyone in town, and come to know one man well
            const res = Townsfolk.residents(a.folk);
            for (const p of res) p.mem = { timesSpoken: 2, disposition: 70 };
            const friend = res.find(p => Townsfolk.age(p, world.day) >= 20 && p.role !== 'noble' && p.role !== 'priest' && !p.ill);
            const { npc } = Relationships.fromTownsperson(player, world, a.folk, friend, a);
            const oldUid = npc.folkUid;
            // ...and courts another, who stays
            const lover = res.find(p => p !== friend && p.spouse == null && Townsfolk.age(p, world.day) >= 20 && p.role !== 'noble' && p.role !== 'priest');
            const lnpc = Relationships.fromTownsperson(player, world, a.folk, lover, a).npc;
            lnpc.isRomantic = true;
            const all = Migration.households(a.folk, world.day);
            const withFriend = all.find(g => g.includes(friend));
            expect(Migration._mayGo(withFriend, world.day, player)).toBe(true);
            expect(Migration._mayGo(all.find(g => g.includes(lover)), world.day, player)).toBe(false);
            // Move the friend's household (as the week would)
            const h = Migration._leave(world, a.folk, withFriend, a, b, 'wages', 'migrants', world.day);
            expect(h.known.map(k => k.name)).toContain(Townsfolk.name(friend));
            const out = { notices: [] };
            Migration._toldOfKnown([h], b, 'wages', out, { n: 0 });
            expect(out.notices[0].title).toBe('Moved Away');
            expect(out.notices[0].text).toContain(b.name);
            Migration._place(world, b, [h], a, world.day, player);
            // Followed: the old uid finds them in the new town, the relationship NPC lives there now
            const found = Relationships.folkPerson(world, oldUid);
            expect(found.settlement).toBe(b);
            expect(found.p.first).toBe(friend.first);
            expect(found.p.mem.timesSpoken).toBe(2);
            expect(npc.folkUid).toBe(`${b.folk.q},${b.folk.r}#${found.p.id}`);
            expect(npc.settlementName).toBe(b.name);
            expect(found.p.rnpc).toBe(npc.id);
            expect(friend.rnpc).toBeUndefined();
            expect(Relationships.npcForPerson(b.folk, found.p)).toBe(npc);
        } finally { restore(); }
    }, 60000);
});
