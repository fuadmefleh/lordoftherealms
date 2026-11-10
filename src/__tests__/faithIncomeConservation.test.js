// Faith income is real coin: every coin the faith's head takes comes out of
// someone's purse. The followers' offerings come from the towns they live in
// (PlayerReligion.collectFaithIncome), a hospice's pilgrims from the towns
// around it (applyBuildingYields), a sermon's alms from the town preached in,
// and a realm's pilgrims and temple offerings from its own towns
// (Religion.processTurn, KingdomAI.updateInstitutions). A town gives at most
// a share of what it holds (data/religion.json offerings).

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Scenarios } from '../player/scenarios.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { Religion } from '../systems/religion.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Economy } from '../world/economy.js';

beforeAll(async () => {
    await loadData();
});

const town = (q, r, population, gold, kingdom = 'k1') => ({
    q, r, terrain: { passable: true },
    settlement: { name: `T${q}`, population, kingdom, economy: { gold } },
});

function sparseWorld(tiles, kingdoms = []) {
    const map = {};
    for (const t of tiles) map[`${t.q},${t.r}`] = t;
    return { day: 10, kingdoms, getTile: (q, r) => map[`${q},${r}`] || null, getKingdom: id => kingdoms.find(k => k.id === id) || null };
}

const purses = (world, keys) => keys.reduce((s, k) => s + world.getTile(...k).settlement.economy.gold, 0);

function faithful(followers, presence) {
    return {
        gold: 100, karma: 0, faith: 0, charisma: 0,
        religion: { name: 'Light', followers, buildings: [], influence: 0, presence, tenets: [] },
    };
}

describe('the followers give out of their own towns\' purses', () => {
    it('player gold + the towns\' purses stay constant across a day of faith income', () => {
        const world = sparseWorld([town(0, 0, 2000, 400), town(3, 0, 1000, 300)]);
        const p = faithful(1500, { '0,0': 0.5, '3,0': 0.2 });
        const before = p.gold + purses(world, [[0, 0], [3, 0]]);
        const paid = PlayerReligion.collectFaithIncome(p, world);
        expect(paid).toBeGreaterThan(0);
        expect(p.gold + purses(world, [[0, 0], [3, 0]])).toBeCloseTo(before, 6);
        expect(p.religion.lastOffering.paid).toBe(paid);
    });

    it('a town gives its share by its faithful, at most a share of its coin; a poor town gives less', () => {
        const cap = PlayerReligion.offeringsConfig().maxPurseShare;
        const world = sparseWorld([town(0, 0, 1000, 1000), town(3, 0, 1000, 20)]);
        const p = faithful(2000, { '0,0': 0.5, '3,0': 0.5 });
        PlayerReligion.collectFaithIncome(p, world);
        const rich = 1000 - world.getTile(0, 0).settlement.economy.gold;
        const poor = 20 - world.getTile(3, 0).settlement.economy.gold;
        // 2,000 followers owe 20 g, but only the 1,000 faithful living in the
        // two towns give: 5 g each
        expect(rich).toBeCloseTo(5, 6);
        expect(poor).toBeCloseTo(20 * cap, 6);
        expect(poor).toBeLessThan(rich);
    });

    it('no towns of the faithful, no offerings — nothing is minted', () => {
        const world = sparseWorld([{ q: 0, r: 0, terrain: { passable: true } }]);
        const p = faithful(5000, {});
        expect(PlayerReligion.collectFaithIncome(p, world)).toBe(0);
        expect(p.gold).toBe(100);
    });

    it('a hospice\'s pilgrims and a sermon\'s alms are paid by the towns', () => {
        const world = sparseWorld([{ q: 0, r: 0, terrain: { passable: true } }, town(1, 0, 3000, 500)]);
        const p = faithful(0, {});
        p.gold = 100000;
        expect(PlayerReligion.buildReligiousBuilding(p, 'PILGRIM_HOSPICE', world.getTile(0, 0), world).success).toBe(true);
        world.getTile(0, 0).religiousBuilding.underConstruction = false;
        const before = p.gold + purses(world, [[1, 0]]);
        const y = PlayerReligion.applyBuildingYields(p, world);
        expect(y.gold).toBeGreaterThan(0);
        expect(p.gold + purses(world, [[1, 0]])).toBeCloseTo(before, 6);

        const t = world.getTile(1, 0);
        const g0 = p.gold + t.settlement.economy.gold;
        const res = PlayerReligion.preach(p, t.settlement, t);
        expect(res.success).toBe(true);
        expect(p.gold + t.settlement.economy.gold).toBeCloseTo(g0, 6);
    });
});

describe('the realms\' pilgrims and temples', () => {
    it('holy-site pilgrim gold comes out of the realm\'s towns into the treasury', () => {
        const site = { name: 'Shrine', incomeBonus: 100, level: 2, pilgrimCount: 0, controller: 'k1', contested: false };
        const k = {
            id: 'k1', name: 'Kingdom of Avalon', isAlive: true, treasury: 50, relations: {},
            territory: [{ q: 0, r: 0 }, { q: 2, r: 0 }, { q: 5, r: 5 }],
            religion: { faithId: 'solaris', piety: 50, unity: 50, heresies: [], holySites: [{ q: 5, r: 5 }] },
        };
        const world = sparseWorld([town(0, 0, 2000, 600), town(2, 0, 500, 100), { q: 5, r: 5, holySite: site }], [k]);
        const before = k.treasury + purses(world, [[0, 0], [2, 0]]);
        Religion.processTurn(world);
        expect(k.religion.pilgrimIncome).toBe(20);
        expect(k.religion.pilgrimPaid).toBeGreaterThan(0);
        expect(k.religion.pilgrimPaid).toBeLessThanOrEqual(20);
        // (processTurn may also cost the crown a heresy's unrest; nothing is ever added from nowhere)
        expect(k.treasury + purses(world, [[0, 0], [2, 0]])).toBeLessThanOrEqual(before + 1e-6);
        expect(k.treasury).toBeCloseTo(50 + k.religion.pilgrimPaid, 6);
    });

    it('a realm\'s temple offerings come out of its towns', () => {
        const k = {
            id: 'k1', name: 'Kingdom of Avalon', isAlive: true, treasury: 0, relations: {},
            territory: [{ q: 0, r: 0 }], temples: [{ type: 'cathedral' }, { type: 'chapel' }],
            religion: { faithId: 'solaris', piety: 50, unity: 50, heresies: [], holySites: [] },
        };
        const world = sparseWorld([town(0, 0, 3000, 2000)], [k]);
        world.activeEvents = [];
        const fx = KingdomAI.templeEffects(k);
        expect(fx.income).toBeGreaterThan(0);
        const before = k.treasury + purses(world, [[0, 0]]);
        KingdomAI.updateInstitutions(k, world);
        expect(k.treasury).toBeGreaterThan(0);
        expect(k.treasury + purses(world, [[0, 0]])).toBeCloseTo(before, 6);
    });

    it('Economy.drawTowns never takes more than the share of a purse', () => {
        const a = { economy: { gold: 100 } };
        const b = { economy: { gold: 0 } };
        const res = Economy.drawTowns([{ settlement: a, weight: 1 }, { settlement: b, weight: 1 }], 1000, 0.05);
        expect(res.paid).toBeCloseTo(5, 6);
        expect(a.economy.gold).toBeCloseTo(95, 6);
        expect(b.economy.gold).toBe(0);
    });
});

describe('the High Priest\'s see', () => {
    it('a real start: faith income moves coin from the towns, never mints it', () => {
        const g = newGame(71);
        Scenarios.apply(g.player, g.world, { origin: 'high_priest' });
        const p = g.player;
        // (every town's purse as its first day gives it, so the sum is complete)
        for (const row of g.world.tiles) for (const t of row) if (t && t.settlement) Economy.initSettlement(t.settlement);
        const towns = () => {
            let s = 0;
            for (const row of g.world.tiles) for (const t of row) if (t && t.settlement && t.settlement.economy) s += Math.max(0, t.settlement.economy.gold || 0);
            return s;
        };
        const rows = [];
        for (let d = 1; d <= 6; d++) {
            const owed = PlayerReligion.getFaithIncome(p);
            const before = p.gold + towns();
            const paid = PlayerReligion.collectFaithIncome(p, g.world);
            const yields = PlayerReligion.applyBuildingYields(p, g.world).gold;
            expect(p.gold + towns()).toBeCloseTo(before, 4);
            rows.push({ day: d, followers: p.religion.followers, owed, paid, yields, towns: p.religion.lastOffering.towns });
            endDay(g);
        }
        if (process.env.FAITH_PROBE) console.table(rows);
        expect(rows.some(r => r.paid > 0)).toBe(true);
        for (const r of rows) expect(r.paid).toBeLessThanOrEqual(r.owed + 1e-6);
    }, 120000);
});
