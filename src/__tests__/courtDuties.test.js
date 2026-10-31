// Court-office duties as choices: the tax collector's round (fair, squeeze,
// spare, skim) with the town's grudge read back by later collections and a
// month's audit for skimmers; the chaplain's blessing with a reader in
// Ailments; the jailer's fugitive taken and judged through BountyHunting.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Titles } from '../systems/titles.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Ailments } from '../systems/ailments.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(day = 40) {
    const tiles = [];
    for (let r = 0; r < 12; r++) {
        tiles.push([]);
        for (let q = 0; q < 12; q++) tiles[r].push({ q, r, terrain: { id: 'plains', passable: true } });
    }
    tiles[5][5].settlement = { name: 'Barleyford', type: 'town', kingdom: 'k1', population: 2000 };
    tiles[6][6].settlement = { name: 'Oakmere', type: 'town', kingdom: 'k1', population: 2000 };
    return {
        day, width: 12, height: 12, tiles, generationParams: { seed: 7 },
        getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
        getKingdom: () => ({ id: 'k1', name: 'Kingdom' }),
    };
}

function collector() {
    return {
        name: 'Tester', gold: 0, karma: 0, renown: 0, health: 100, currentTitle: 'tax_collector', allegiance: 'k1',
        titleProgress: Titles._resetProgress('tax_collector'), reputation: { k1: 0 }, skills: { commerce: 1 }, q: 5, r: 5,
    };
}

beforeEach(() => Utils.setSeed(42));

describe('tax collection as a choice', () => {
    it('fair collection keeps the old take; squeeze pays more and angers the town', () => {
        const world = makeWorld();
        const tile = world.getTile(5, 5);
        const p = collector();
        const a = Titles.taxAssessment(p, tile, world);
        const opts = Object.fromEntries(Titles.taxOptions(p, a).map(o => [o.id, o]));
        expect(opts.squeeze.fee).toBeGreaterThan(opts.fair.fee);
        expect(opts.spare.fee).toBeLessThan(opts.fair.fee);
        expect(opts.skim.skim).toBeGreaterThan(0);

        const res = Titles.collectTaxAtSettlement(p, tile, world, 'squeeze', a);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(res.fee);
        expect(tile.settlement.happiness).toBeLessThan(50);
        expect(tile.settlement.crownLevy.resentment).toBeGreaterThan(0);
        // ...and a second collection there this month is refused
        expect(Titles.collectTaxAtSettlement(p, tile, world, 'fair').success).toBe(false);
    });

    it('a resentful town yields less next month, and the grudge fades', () => {
        const world = makeWorld();
        const tile = world.getTile(5, 5);
        const p = collector();
        Titles.collectTaxAtSettlement(p, tile, world, 'squeeze');
        const before = Titles.taxYieldMult(tile.settlement, world.day);
        expect(before).toBeLessThan(1);
        expect(Titles.taxYieldMult(tile.settlement, world.day + 200)).toBeGreaterThan(before);
        // A fresh month: the grudge cuts the take compared with a calm town
        p.titleProgress = Titles._resetProgress('tax_collector');
        const angry = Titles.taxAssessment(p, tile, world);
        const calm = Titles.taxAssessment(p, world.getTile(6, 6), world);
        expect(angry.mult).toBeLessThan(calm.mult);
        expect(angry.resentment).toBeGreaterThan(0);
        expect(Titles.taxOptions(p, angry).find(o => o.id === 'squeeze').riotChance).toBeGreaterThan(0);
    });

    it('sparing the poor lifts the town and the collector', () => {
        const world = makeWorld();
        const tile = world.getTile(5, 5);
        const p = collector();
        Titles.collectTaxAtSettlement(p, tile, world, 'spare');
        expect(tile.settlement.happiness).toBeGreaterThan(50);
        expect(p.karma).toBeGreaterThan(0);
        expect(p.renown).toBeGreaterThan(0);
    });

    it('skimming is booked and the month-end audit can expose it', () => {
        const world = makeWorld();
        const p = collector();
        const res = Titles.collectTaxAtSettlement(p, world.getTile(5, 5), world, 'skim');
        expect(res.skim).toBeGreaterThan(0);
        expect(p.titleProgress.skimmed).toBe(res.skim);
        expect(p.financeToday.income.embezzlement).toBe(res.skim);

        // Over many months some audits find it and some do not; an exposed one repays and costs face
        let exposed = 0;
        let passed = 0;
        for (let d = 60; d < 600; d += 30) {
            const q = collector();
            q.gold = 1000;
            q.titleProgress.skimmed = 60;
            const out = Titles._audit(q, { ...world, day: d });
            if (out.exposed) {
                exposed++;
                expect(q.gold).toBe(1000 - out.owed);
                expect(q.reputation.k1).toBeLessThan(0);
            } else passed++;
        }
        expect(exposed).toBeGreaterThan(0);
        expect(passed).toBeGreaterThan(0);
        // Nothing skimmed: no audit
        expect(Titles._audit(collector(), world)).toBeNull();
    });

    it('the audit is rolled at the duty deadline and an exposure fails the month', () => {
        const world = makeWorld(100);
        const p = collector();
        p.titleDutyDeadline = 100;
        p.titleProgress.skimmed = 400; // capped at the max chance
        p.titleProgress.collectionsCompleted = 5;
        p.gold = 5000;
        let seen = null;
        for (let d = 100; d < 400 && !(seen && seen.exposed); d += 30) {
            p.titleDutyDeadline = d;
            p.titleProgress.skimmed = 400;
            p.titleProgress.collectionsCompleted = 5;
            const out = Titles.processDaily(p, { ...world, day: d });
            seen = out && out.audit;
            if (seen && seen.exposed) expect(out.evaluation.passed).toBe(false);
            if (out && out.stripped) break;
        }
        expect(seen && seen.exposed).toBe(true);
    });
});

describe('the chaplain\'s blessing', () => {
    it('lifts the mood and guards the town against sickness (read by Ailments)', () => {
        const world = makeWorld();
        const tile = world.getTile(5, 5);
        const p = { name: 'Chap', karma: 0, renown: 0, currentTitle: 'court_chaplain', allegiance: 'k1', titleProgress: {}, reputation: {}, q: 5, r: 5 };
        const res = Titles.blessSettlement(p, tile, world);
        expect(res.success).toBe(true);
        expect(tile.settlement.happiness).toBeGreaterThan(50);
        expect(Titles.isBlessed(tile.settlement, world.day + 5)).toBe(true);
        expect(Ailments._blessingMult(p, world)).toBeLessThan(1);
        expect(Ailments._blessingMult(p, { ...world, day: world.day + 100 })).toBe(1);
        expect(Ailments._blessingMult({ ...p, q: 1, r: 1 }, world)).toBe(1);
    });
});

describe('the jailer\'s fugitive goes through BountyHunting', () => {
    function jailer(world) {
        const p = { name: 'Jail', gold: 0, karma: 0, renown: 0, currentTitle: 'jailer', allegiance: 'k1', titleProgress: Titles._resetProgress('jailer'), skills: { combat: 10, stealth: 10, leadership: 10 }, army: [] };
        BountyHunting.initialize(p);
        expect(Titles.spawnFugitive(p, world).success).toBe(true);
        p.q = p.activeFugitive.q;
        p.r = p.activeFugitive.r;
        return p;
    }

    it('a captured fugitive awaits judgment; turning in credits the duty and the office', () => {
        const world = makeWorld();
        const p = jailer(world);
        p.activeFugitive.difficulty = 1;
        let res = null;
        for (let i = 0; i < 20 && !(res && res.success); i++) {
            res = Titles.captureFugitive(p, world);
            if (!res.success) { p.q = p.activeFugitive.q; p.r = p.activeFugitive.r; }
        }
        expect(res.success).toBe(true);
        expect(p.activeFugitive).toBeNull();
        const bounty = p.activeBounties.find(b => b.jailerWarrant);
        expect(bounty.status).toBe('captured_pending_decision');
        const karma = p.karma;
        const out = BountyHunting.resolveCapturedTarget(p, bounty, 'turn_in');
        expect(out.turnedIn).toBe(true);
        expect(p.gold).toBe(out.pay);
        expect(p.titleProgress.capturesMade).toBe(1);
        expect(p.karma).toBeGreaterThan(karma);
        expect(p.activeBounties.length).toBe(0);
    });

    it('recruiting the crown\'s fugitive costs karma and earns no duty credit', () => {
        const world = makeWorld();
        const p = jailer(world);
        const bounty = Titles.fugitiveBounty(p, p.activeFugitive);
        bounty.status = 'captured_pending_decision';
        p.activeBounties.push(bounty);
        const out = BountyHunting.resolveCapturedTarget(p, bounty, 'recruit');
        expect(out.recruited).toBe(true);
        expect(p.titleProgress.capturesMade || 0).toBe(0);
        expect(p.karma).toBeLessThan(-1);
        expect(p.army.length).toBe(1);
    });

    it('a fugitive who fights free runs on and grows warier', () => {
        const world = makeWorld();
        const p = jailer(world);
        p.skills = { combat: 0, stealth: 0, leadership: 0 };
        p.activeFugitive.difficulty = 10;
        const res = Titles.captureFugitive(p, world);
        expect(res.success).toBe(false);
        expect(res.escaped).toBe(true);
        expect(p.activeFugitive.escapes).toBe(1);
    });
});
