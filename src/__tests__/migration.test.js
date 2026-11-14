// Migration (systems/migration.js, data/migration.json): the flows of the labour
// week logged with their reasons, plague refugees, the player's settlers'
// grants and closed borders, real households moving between rosters, columns
// on the roads, the trend and empty houses, save/load, no shared RNG.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { STRATA } from '../world/townLabour.js';
import { TownEras } from '../world/townEras.js';
import { Labour } from '../systems/labour.js';
import { Migration, MIGRANT_TYPE } from '../systems/migration.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

function quiet() {
    const a = vi.spyOn(console, 'log').mockImplementation(() => {});
    const b = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => { a.mockRestore(); b.mockRestore(); };
}

const key = (s) => `${s.q},${s.r}`;
const totalPop = (world) => world.getSettlementViews().reduce((a, s) => a + s.population, 0);

/** A game a week in, and a link between two towns of a realm, at least two hexes apart. */
function linkedGame(seed = 101) {
    const game = newGame(seed);
    for (let d = 0; d < 8; d++) { game.player.health = 100; game.player.inventory.bread = 40; endDay(game); }
    const links = MarketDynamics._cache(game.world).links.list;
    const link = links.find(l => l.a.population > 800 && l.b.population > 800 && l.a !== l.b
        && Math.abs(l.a.q - l.b.q) + Math.abs(l.a.r - l.b.r) >= 3) || links[0];
    return { game, link };
}

function week(game, link, ruled = new Set(), day = null, player = null) {
    const { world } = game;
    const out = { notices: [], news: [] };
    Labour._week(world, player, world.getSettlementViews(), [link], Labour._dangerCtx(world, player, [link]), ruled, day == null ? world.day : day, out);
    return out;
}

function drift(link) {
    for (const s of STRATA) { link.a.labour.wel[s] = 0.55; link.b.labour.wel[s] = 0.93; }
}

describe('the flows', () => {
    it('logs who came and went on both towns, with the reason, and keeps the head count whole', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame();
            const { world } = game;
            const { a, b } = link;
            const before = totalPop(world);
            drift(link);
            week(game, link);
            expect(totalPop(world)).toBe(before);
            const la = Migration.town(a).log, lb = Migration.town(b).log;
            expect(la.some(e => e.o && e.t === b.name && e.n > 0)).toBe(true);
            expect(lb.some(e => e.i && e.t === a.name && e.n > 0)).toBe(true);
            const out = la.find(e => e.o);
            expect(Migration.reasonDef(out.w)).toBeTruthy();
            expect(b.migr.yr.in).toBe(a.migr.yr.out);
            // Kin who went before draw others after them
            expect(b.migr.kin[key(a)]).toBeGreaterThan(0);
            expect(Migration.kinPull(a, b)).toBeGreaterThan(0);
        } finally { restore(); }
    }, 60000);

    it('plague drives people out as refugees, and a quarantined plague town holds them', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame(202);
            const { world } = game;
            const { a, b } = link;
            const popA = a.population;
            a.sickness = { k: 'plague', d: world.day, until: world.day + 21, abs: true };
            expect(Migration.plagueAt(world, a)).toBeGreaterThanOrEqual(0.5);
            week(game, link);
            expect(a.population).toBeLessThan(popA);
            const fled = Migration.town(b).log.find(e => e.i && e.k === 'refugees');
            expect(fled && fled.w).toBe('plague');
            // Quarantine: no one leaves
            const k = world.getKingdom(a.kingdom);
            if (k) {
                k.laws = { ...(k.laws || {}), pestilence: 'quarantine' };
                const p2 = a.population;
                week(game, link, new Set(), world.day + 7);
                expect(a.population).toBe(p2);
            }
        } finally { restore(); }
    }, 60000);
});

describe('the player\'s policy', () => {
    it('closed borders keep newcomers out of the player\'s towns', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame(303);
            const { world, player } = game;
            const { b } = link;
            Migration.setPolicy(world, 'borders', 'closed');
            drift(link);
            const popB = b.population;
            const out = week(game, link, new Set([key(b)]), null, player);
            expect(b.population).toBe(popB);
            expect(out.notices.some(n => n.title === 'Turned Back')).toBe(true);
        } finally { restore(); }
    }, 60000);

    it('settlers\' grants draw people and are paid from the purse into the town\'s', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame(404);
            const { world, player } = game;
            const { a, b } = link;
            Migration.setPolicy(world, 'settlers', 'land');
            // (a small welfare gap the grants alone tip)
            for (const s of STRATA) { a.labour.wel[s] = 0.8; b.labour.wel[s] = 0.8; }
            const w = Migration.week(world, player, world.getSettlementViews(), new Set([key(b)]), world.day);
            expect(w.pull(b) - w.pull(a)).toBeGreaterThan(0.05);
            player.gold = 5000;
            if (!b.economy) b.economy = { gold: 0 };
            const purse = b.economy.gold;
            drift(link);
            week(game, link, new Set([key(b)]), null, player);
            const came = b.migr.yr.in;
            expect(came).toBeGreaterThan(0);
            expect(player.gold).toBeCloseTo(5000 - came * 2, 2);
            expect(b.economy.gold).toBeCloseTo(purse + came * 2, 2);
            // An empty purse: the grants lapse
            player.gold = 0;
            drift(link);
            const out = week(game, link, new Set([key(b)]), world.day + 7, player);
            if (out.notices.some(n => n.title === 'Grants Lapse')) expect(Migration.policy(world).settlers).toBe('none');
        } finally { restore(); }
    }, 60000);
});

describe('real households', () => {
    it('a family leaves one roster and is written into the other, kin kept', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame(505);
            const { world } = game;
            const { a, b } = link;
            Townsfolk.seed(a, world, { q: a.q, r: a.r });
            Townsfolk.seed(b, world, { q: b.q, r: b.r });
            const nB = b.folk.people.length;
            // A big week: enough movers for a household (the roster stands for the town)
            for (const s of STRATA) { a.labour.wel[s] = 0.3; b.labour.wel[s] = 0.98; }
            const moved = Migration._moveFolk(world, a, b, Math.ceil(a.population / Townsfolk.residents(a.folk).length * 3), 'wages', 'migrants', world.day);
            expect(moved.length).toBeGreaterThan(0);
            const gone = a.folk.people.filter(p => p.away && p.away.mig);
            expect(gone.length).toBeGreaterThan(0);
            expect(gone[0].away.to).toBe(b.name);
            Migration._place(world, b, moved, a, world.day);
            const came = b.folk.people.slice(nB);
            expect(came.length).toBe(gone.length);
            for (const p of came) {
                expect(p.mig.from).toBe(a.name);
                expect(Townsfolk.isHere(p)).toBe(true);
                if (p.spouse != null) expect(Townsfolk.get(b.folk, p.spouse).spouse).toBe(p.id);
                for (const id of p.kids) expect(Townsfolk.get(b.folk, id).parents).toContain(p.id);
            }
            // Ids are fresh in the new roster
            expect(new Set(b.folk.people.map(p => p.id)).size).toBe(b.folk.people.length);
        } finally { restore(); }
    }, 60000);

    it('a town without a roster sends newcomer families to one with', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame(606);
            const { world } = game;
            const { a, b } = link;
            delete a.folk;
            Townsfolk.seed(b, world, { q: b.q, r: b.r });
            const n0 = b.folk.people.length;
            const moved = Migration._moveFolk(world, a, b, Math.ceil(b.population / Townsfolk.residents(b.folk).length * 4), 'work', 'migrants', world.day);
            expect(moved.length).toBeGreaterThan(0);
            expect(b.folk.people.length).toBeGreaterThan(n0);
            expect(b.folk.people.slice(n0).every(p => p.mig && p.mig.from === a.name)).toBe(true);
        } finally { restore(); }
    }, 60000);
});

describe('columns on the roads', () => {
    it('a big flow walks to its new town and its households arrive with it', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame(707);
            const { world } = game;
            const { a, b } = link;
            Townsfolk.seed(a, world, { q: a.q, r: a.r });
            Townsfolk.seed(b, world, { q: b.q, r: b.r });
            const moved = Migration._moveFolk(world, a, b, Math.ceil(a.population / Townsfolk.residents(a.folk).length * 2), 'war', 'refugees', world.day);
            const u = Migration._spawnColumn(world, a, b, 60, 'refugees', 'war', moved, world.day);
            expect(Migration.columns(world)).toContain(u);
            expect(u.type).toBe(MIGRANT_TYPE);
            const nB = b.folk.people.length;
            const out = { notices: [] };
            let d = world.day;
            for (let i = 0; i < 200 && !u.destroyed; i++) Migration._columnDay(world, game.player, u, ++d, out, new Set([key(b)]));
            expect(u.destroyed).toBe(true);
            expect(b.folk.people.length).toBe(nB + moved.reduce((t, h) => t + (h.people ? h.people.length : 0), 0));
            expect(out.notices.some(n => n.title === 'Refugees at the Gates')).toBe(true);
        } finally { restore(); }
    }, 60000);
});

describe('the trend', () => {
    it('reads growing or shrinking, stands empty houses in a town that has lost its people, and scales its roster', () => {
        const s = { name: 'Fallow', type: 'town', population: 2000, q: 3, r: 3, folk: { q: 3, r: 3, n: 0, target: 20, people: [] } };
        for (let d = 30; d <= 150; d += 30) { Migration._sample(s, d); s.population -= 150; }
        const t = Migration.trend(s, 150);
        expect(t.label).toBe('shrinking');
        expect(t.change).toBeLessThan(0);
        expect(s.migr.vac).toBeGreaterThan(0);
        expect(Migration.trendLine(s, 150)).toContain('shrinking');
        // The roster's usual size follows the town's
        expect(s.folk.mScale).toBeLessThan(1);
        expect(s.folk.target).toBeLessThan(20);
        // ...and the street map is laid out anew when it shows
        const world = { generationParams: { seed: 7, terrainGen: 99 }, year: 900, baseYear: 853 };
        if (TownEras.enabled(world)) {
            const st0 = TownEras.stamp(world, s);
            expect(st0).toContain(':v');
            const look = TownEras.look(world, s);
            let vac = 0;
            for (let q = 0; q < 40; q++) if (look.building(q, 10).vacant) vac++;
            expect(vac).toBeGreaterThan(0);
        }
        const g = { name: 'Bloom', type: 'town', population: 1000, q: 4, r: 4 };
        for (let d = 30; d <= 150; d += 30) { Migration._sample(g, d); g.population += 120; }
        expect(Migration.trend(g, 150).label).toBe('growing');
    });
});

describe('save and determinism', () => {
    it('keeps the policy, flows and columns through a save, and draws nothing from the shared RNG', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame(808);
            const { world } = game;
            Migration.setPolicy(world, 'settlers', 'grants');
            Migration.setPolicy(world, 'borders', 'refugees');
            Migration._spawnColumn(world, link.a, link.b, 40, 'migrants', 'wages', [], world.day);
            drift(link);
            Utils.setSeed(99);
            const r1 = Utils.random();
            Utils.setSeed(99);
            week(game, link);
            Migration.processDay(world, game.player, { notices: [] });
            expect(Utils.random()).toBe(r1);
            const b2 = roundTrip(game);
            expect(Migration.policy(b2.world)).toEqual({ settlers: 'grants', borders: 'refugees' });
            expect(Migration.columns(b2.world).length).toBe(Migration.columns(world).length);
            const sa = b2.world.getSettlementViews().find(s => s.name === link.a.name);
            expect(JSON.stringify(sa.migr)).toBe(JSON.stringify(link.a.migr));
        } finally { restore(); }
    }, 90000);
});
