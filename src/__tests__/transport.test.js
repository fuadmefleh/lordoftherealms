/**
 * Roads, canals & logistics — world/transport.js (road segments, their state,
 * the haulage of the trade links) and systems/publicWorks.js (upkeep, works,
 * tolls). A small hand-built world: four towns on one road along r = 5,
 *
 *   A (2,5) town — B (8,5) town — C (14,5) village — D (20,5) village
 *
 * with a river hex at (11,5) and a mountain hex at (12,5) on the B–C road.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Transport } from '../world/transport.js';
import { PublicWorks } from '../systems/publicWorks.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { Hinterland } from '../world/hinterland.js';
import { Ledger } from '../systems/ledger.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const PLAINS = { id: 'plains', passable: true, moveCost: 2 };
const FOREST = { id: 'seasonal_forest', passable: true, moveCost: 3 };
const MOUNTAIN = { id: 'mountain', passable: true, moveCost: 5 };

function makeWorld({ day = 40, treasury = 50000, seed = 'tx-test' } = {}) {
    const W = 24, H = 12;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: PLAINS, regionId: 1, kingdom: 'k1', elevation: 0.5 });
        tiles.push(row);
    }
    for (let q = 2; q <= 20; q++) tiles[5][q].hasRoad = true;
    tiles[5][11].hasRiver = true;
    tiles[5][12].terrain = MOUNTAIN;
    tiles[5][12].elevation = 0.9;
    const kingdom = { id: 'k1', name: 'Testland', isAlive: true, treasury, wars: [], finance: { debtRatio: 0, missed: 0 }, traits: ['mercantile'] };
    const mk = (name, q, r, type, population) => {
        const s = { name, q, r, type, population, kingdom: 'k1', economy: { tradeIncome: 0 } };
        tiles[r][q].settlement = s;
        return s;
    };
    const towns = [mk('Aston', 2, 5, 'town', 3000), mk('Brill', 8, 5, 'town', 3000), mk('Cobb', 14, 5, 'village', 600), mk('Dunn', 20, 5, 'village', 500)];
    const world = {
        width: W, height: H, day, tiles, units: [], kingdoms: [kingdom], events: [],
        generationParams: { seed },
        getTile(q, r) {
            if (r < 0 || r >= H) return null;
            return tiles[r][((q % W) + W) % W];
        },
        getSettlementViews() { return towns; },
        getAllSettlements() { return towns; },
        getKingdom(id) { return id === 'k1' ? kingdom : null; },
    };
    for (const s of towns) SettlementMarket.ensure(s);
    return { world, kingdom, towns, A: towns[0], B: towns[1], C: towns[2], D: towns[3] };
}

const seg = (world, a, b) => Transport.segmentsOf(world, a.q, a.r).find(s => (s.a.s === a && s.b.s === b) || (s.a.s === b && s.b.s === a));
const link = (a, b, road = true, dist = 6) => ({ a, b, dist, sea: false, road, routes: 0, friction: 0.035 * dist * (road ? 0.6 : 1), fr0: 0.035 * dist * (road ? 0.6 : 1), base: 120, capacity: 120, factor: 1, _tf: NaN });

beforeEach(() => Transport.setEnabled(true));

describe('road segments', () => {
    it('splits the road into segments between neighbouring towns, with tiers from their towns', () => {
        const { world, A, B, C, D } = makeWorld();
        const segs = Transport.segments(world);
        expect(segs).toHaveLength(3);
        expect(Transport.segState(world, seg(world, A, B)).t).toBe('road');
        expect(Transport.segState(world, seg(world, C, D)).t).toBe('track');
        const bc = seg(world, B, C);
        expect(bc.rivers).toHaveLength(1);
        expect(bc.pass).toBe(true);
        expect(Transport.segState(world, bc).x).toBe('bridge');
        // Each road hex belongs to one segment and carries its baked state
        expect(world.getTile(5, 5).roadSeg).toBe(seg(world, A, B).id);
    });

    it('is deterministic: the same world derives the same segments and starting states', () => {
        const a = makeWorld(), b = makeWorld();
        Transport.segments(a.world); Transport.segments(b.world);
        expect(JSON.stringify(a.world.transport.segs)).toBe(JSON.stringify(b.world.transport.segs));
        const c = makeWorld({ seed: 'another' });
        Transport.segments(c.world);
        expect(JSON.stringify(c.world.transport.segs)).not.toBe(JSON.stringify(a.world.transport.segs));
    });
});

describe('quality: decay, upkeep and repair', () => {
    it('a realm with a treasury pays the upkeep and keeps its roads; a broke one lets them decay', () => {
        const rich = makeWorld({ treasury: 50000 });
        const poor = makeWorld({ treasury: 100 });
        for (const g of [rich, poor]) {
            Transport.segments(g.world);
            for (const sg of Transport.segments(g.world)) Transport.setSegment(g.world, sg, { c: 80 });
        }
        const before = rich.kingdom.treasury;
        for (let d = 40; d < 54; d++) { rich.world.day = d; poor.world.day = d; Transport.tick(rich.world, d); Transport.tick(poor.world, d); }
        const ab = (g) => Transport.segState(g.world, seg(g.world, g.A, g.B)).c;
        expect(rich.kingdom.treasury).toBeLessThan(before);
        expect(rich.world.transport.stats.upkeep).toBeGreaterThan(0);
        expect(ab(rich)).toBeGreaterThan(80);
        expect(ab(poor)).toBeLessThan(80);
        expect(poor.kingdom.treasury).toBe(100);
    });

    it('war wears the roads and war hosts on them grind them down', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        Transport.setSegment(g.world, ab, { c: 80 });
        g.world.units.push({ type: 'war_host', q: 5, r: 5 });
        Transport.tick(g.world, 41);
        expect(Transport.segState(g.world, ab).c).toBeLessThan(80);
    });

    it('repairs bring a ruined road back to good repair (and its movement with it)', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        Transport.setSegment(g.world, ab, { c: 5 });
        expect(Transport.band(Transport.segState(g.world, ab))).toBe('ruined');
        const res = PublicWorks.commission(g.world, null, 'repair', ab.key, { by: 'k1' });
        expect(res.success).toBe(true);
        for (let d = 41; d < 60 && res.work.status !== 'done'; d++) { g.world.day = d; PublicWorks.processDay(g.world, null); }
        expect(res.work.status).toBe('done');
        expect(Transport.segState(g.world, ab).c).toBe(100);
    });
});

describe('movement and caravan speed', () => {
    it('player movement on a road hex follows the tier and repair; an unbaked road hex is the old ×0.5', () => {
        const g = makeWorld();
        const t = g.world.getTile(5, 5);
        delete t.roadMove;
        expect(Infrastructure.getEffectiveMoveCost(t)).toBe(1);
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        expect(Infrastructure.getEffectiveMoveCost(t)).toBe(1);
        t.terrain = FOREST;
        Transport.setSegment(g.world, ab, { t: 'road', c: 90 });
        expect(Infrastructure.getEffectiveMoveCost(t)).toBe(2);
        Transport.setSegment(g.world, ab, { t: 'highway' });
        expect(Infrastructure.getEffectiveMoveCost(t)).toBe(1);
        Transport.setSegment(g.world, ab, { t: 'road', c: 5 });
        expect(Infrastructure.getEffectiveMoveCost(t)).toBe(3);
    });

    it('a washed-out bridge brings back a (smaller) river penalty; a snowbound pass is slow going', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const bc = seg(g.world, g.B, g.C);
        const river = g.world.getTile(11, 5);
        expect(Infrastructure.getRiverPenalty(river, null)).toBe(0);
        Transport.setSegment(g.world, bc, { x: 'ford' });
        expect(Infrastructure.getRiverPenalty(river, null)).toBe(1);
        const base = Infrastructure.getEffectiveMoveCost(g.world.getTile(12, 5));
        Transport.setSegment(g.world, bc, { cl: 'snow' });
        expect(Infrastructure.getEffectiveMoveCost(g.world.getTile(12, 5))).toBe(base + 3);
    });

    it('caravans run faster on a highway and slower on a track or a rutted road', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        const speeds = {};
        for (const [label, fields] of [['highway', { t: 'highway', c: 100 }], ['road', { t: 'road', c: 100 }], ['rutted', { t: 'road', c: 30 }], ['track', { t: 'track', c: 100 }]]) {
            Transport.setSegment(g.world, ab, fields);
            const l = link(g.A, g.B);
            Transport.applyLink(g.world, l, 40);
            const route = [];
            for (let q = 2; q <= 8; q++) route.push(q, 5);
            const u = MerchantCaravans._spawn(g.world, l, g.A, g.B, { grain: 20 }, 200, route, { grain: 3 }, 40, null);
            speeds[label] = u.speed;
        }
        expect(speeds.highway).toBeGreaterThan(speeds.road);
        expect(speeds.road).toBeGreaterThan(speeds.track);
        expect(speeds.rutted).toBeLessThan(speeds.road);
    });
});

describe('link friction and price dispersion', () => {
    it('a road in good repair hauls cheaper than the old flat road; tiers, repair, season and terrain move it', () => {
        // (the old flat roadFactor was 0.6: a road in good repair is now its tier's friction against it)
        const goodRoad = Transport.tier('road').friction / 0.6;
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        Transport.setSegment(g.world, ab, { t: 'road', c: 90 });
        const l = link(g.A, g.B);
        Transport.applyLink(g.world, l, 40);
        expect(l.friction).toBeCloseTo(l.fr0 * goodRoad, 6);
        expect(goodRoad).toBeLessThan(1);
        Transport.setSegment(g.world, ab, { t: 'highway' });
        Transport.applyLink(g.world, l, 40);
        const hw = l.friction;
        Transport.setSegment(g.world, ab, { t: 'road', c: 5 });
        Transport.applyLink(g.world, l, 40);
        expect(hw).toBeLessThan(l.fr0);
        expect(l.friction).toBeGreaterThan(l.fr0);
        // Open country: plains = 1, rough ground dearer, spring mud dearer still
        const open = link(g.A, g.B, false);
        Transport.applyLink(g.world, open, 40);
        expect(open.friction).toBeCloseTo(open.fr0, 6);
        for (let q = 3; q < 8; q++) for (const r of [4, 5, 6]) g.world.tiles[r][q].terrain = FOREST;
        const rough = link(g.A, g.B, false);
        Transport.applyLink(g.world, rough, 40);
        expect(rough.friction).toBeGreaterThan(rough.fr0);
        const muddy = link(g.A, g.B, false);
        Transport.applyLink(g.world, muddy, 10);
        expect(muddy.friction).toBeGreaterThan(rough.friction);
    });

    it('prices draw together faster over a good road than over a ruined one', () => {
        const run = (cond) => {
            const g = makeWorld();
            Transport.segments(g.world);
            Transport.setSegment(g.world, seg(g.world, g.A, g.B), { t: 'road', c: cond });
            g.A.market.stock.grain *= 3;
            g.B.market.stock.grain *= 0.3;
            const l = link(g.A, g.B);
            const bases = { grain: 3 };
            for (const id of SettlementMarket.config().goodIds) if (!bases[id]) bases[id] = 0;
            for (let i = 0; i < 6; i++) { Transport.applyLink(g.world, l, 40); SettlementMarket.flows([l], bases); }
            return Transport.dispersion(g.world, [l], ['grain'], (s, id) => SettlementMarket.scarcity(s, id));
        };
        const good = run(100), ruined = run(5);
        expect(good.all.mean).toBeLessThan(ruined.all.mean);
        expect(good.good.links).toBe(1);
        expect(ruined.poor.links).toBe(1);
    });

    it('perishables spoil on the way: part of what leaves never arrives', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        g.A.market.stock.fish = 200;
        g.B.market.stock.fish = 0;
        const l = link(g.A, g.B, false, 12);
        Transport.applyLink(g.world, l, 40);
        expect(l.loss).toBeGreaterThan(0);
        expect(l.perish).toBeGreaterThan(0);
        const bases = {};
        for (const id of SettlementMarket.config().goodIds) bases[id] = id === 'fish' ? 4 : 0;
        const before = g.A.market.stock.fish + g.B.market.stock.fish;
        SettlementMarket.flows([l], bases);
        const after = g.A.market.stock.fish + g.B.market.stock.fish;
        expect(g.B.market.stock.fish).toBeGreaterThan(0);
        expect(after).toBeLessThan(before);
    });

    it('a good road trades at a quicker pace and holds back less stock than a ruined one or open country', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        const at = (fields, road = true) => {
            if (road) Transport.setSegment(g.world, ab, fields);
            const l = link(g.A, g.B, road);
            Transport.applyLink(g.world, l, 40);
            return l;
        };
        const good = at({ t: 'road', c: 90 });
        const hw = at({ t: 'highway', c: 90 });
        const ruined = at({ t: 'road', c: 5 });
        const open = at({}, false);
        // open country is the reference pace (1, the old reserve)
        expect(open.rate).toBeCloseTo(1, 6);
        expect(open.keep).toBeCloseTo(1, 6);
        expect(good.rate).toBeGreaterThan(1.2);
        expect(good.keep).toBeLessThan(0.8);
        expect(hw.rate).toBeGreaterThan(good.rate);
        expect(hw.keep).toBeLessThanOrEqual(good.keep);
        expect(ruined.rate).toBeCloseTo(1, 6);
        expect(ruined.keep).toBeCloseTo(1, 6);
        // Switched off (measurement), every link trades at the old pace
        Transport.setEnabled(false);
        const off = at({ t: 'highway', c: 90 });
        expect(off.rate).toBe(1);
        expect(off.keep).toBe(1);
        Transport.setEnabled(true);
    });

    it('the pace moves more goods over a link (SettlementMarket.flows reads link.rate and link.keep)', () => {
        const run = (rate, keep) => {
            const g = makeWorld();
            const [a, b] = [g.A, g.B];
            const target = SettlementMarket.target(a, 'grain');
            a.market.stock.grain = target * 1.6;
            b.market.stock.grain = target * 0.3;
            const l = { ...link(a, b), rate, keep, friction: 0.05, capacity: 100000 };
            SettlementMarket.flows([l], { grain: 10 });
            return target * 1.6 - a.market.stock.grain;
        };
        const slow = run(1, 1);
        const quick = run(1.33, 0.75);
        expect(slow).toBeGreaterThan(0);
        expect(quick).toBeGreaterThan(slow * 1.2);
    });

    it('a canal cuts the haulage between its towns', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const l = link(g.A, g.B);
        Transport.applyLink(g.world, l, 40);
        const roadF = l.friction;
        g.world.transport.canals['2,5|8,5'] = { id: 'pwX', owner: 'k1', toll: false, day: 1 };
        Transport.applyLink(g.world, l, 40);
        expect(l.friction).toBeLessThan(roadF * 0.75);
        expect(Transport.linkBand(g.world, g.A, g.B)).toBe('canal');
    });
});

describe('seasonal closures', () => {
    it('a pass over the mountains closes in deep winter and stops the trade over it', () => {
        const g = makeWorld({ day: 100 });
        Transport.segments(g.world);
        const bc = seg(g.world, g.B, g.C);
        for (let d = 98; d <= 112; d++) Transport.tick(g.world, d);
        expect(Transport.segState(g.world, bc).cl).toBe('snow');
        const l = link(g.B, g.C);
        expect(Transport.applyLink(g.world, l, 112)).toBe(true);
        expect(g.world.transport.history.some(h => h.kind === 'pass_closed')).toBe(true);
        // ...and opens with the spring
        for (let d = 113; d <= 130; d++) Transport.tick(g.world, d);
        expect(Transport.segState(g.world, bc).cl).toBe(null);
    });

    it('a ford floods in spring (hash rolls: some weeks, deterministically)', () => {
        const flooded = (seed) => {
            const g = makeWorld({ day: 1, seed });
            Transport.segments(g.world);
            const bc = seg(g.world, g.B, g.C);
            Transport.setSegment(g.world, bc, { x: 'ford' });
            let n = 0;
            for (let d = 1; d <= 30; d++) { Transport.tick(g.world, d); if (Transport.segState(g.world, bc).cl === 'flood') n++; }
            return n;
        };
        let any = 0;
        for (let i = 0; i < 12; i++) any += flooded(`flood-${i}`);
        expect(any).toBeGreaterThan(0);
        expect(flooded('flood-3')).toBe(flooded('flood-3'));
    });
});

describe('public works: goods, labour, tolls', () => {
    it('a work buys stone and timber from its town and hires hands there', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        g.A.market.stock.stone = 60; g.A.market.stock.wood = 60; g.A.market.stock.iron = 20;
        g.B.market.stock.stone = 60; g.B.market.stock.wood = 60; g.B.market.stock.iron = 20;
        const priceBefore = SettlementMarket.scarcity(g.A, 'stone');
        const player = { gold: 5000, financeToday: {} };
        const res = PublicWorks.commission(g.world, player, 'upgrade_highway', ab.key, { by: 'player', toll: true });
        expect(res.success).toBe(true);
        expect(player.gold).toBeLessThan(5000);
        g.world.day = 41;
        PublicWorks.processDay(g.world, player);
        expect(Transport.handsAt(g.world, res.work.tq, res.work.tr)).toBe(res.work.hands);
        const site = res.work.tq === g.A.q ? g.A : g.B;
        expect(site.market.stock.stone).toBeLessThan(60);
        expect(SettlementMarket.scarcity(site, 'stone')).toBeGreaterThan(priceBefore - 1e-9);
        for (let d = 42; d < 90 && res.work.status !== 'done'; d++) { g.world.day = d; PublicWorks.processDay(g.world, player); }
        expect(res.work.status).toBe('done');
        expect(Transport.segState(g.world, ab).t).toBe('highway');
        expect(Transport.segState(g.world, ab).toll).toBe(res.work.id);
        expect(res.work.spent).toBeGreaterThan(0);
        expect(Transport.handsAt(g.world, res.work.tq, res.work.tr)).toBe(0);
    });

    it('tolls are paid out of the towns\' trade income to the work\'s owner, and booked in the Ledger', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        const player = { gold: 0, financeToday: {}, throne: { ruling: { kingdomId: 'k1' } } };
        g.world.transport.works.push({ id: 'pwT', kind: 'bridge', owner: 'player', kid: 'k1', status: 'done', tollRate: 0.08, playerToll: 3, toll: true, tollIncome: 0 });
        Transport.setSegment(g.world, ab, { toll: 'pwT' });
        const l = link(g.A, g.B);
        Transport.applyLink(g.world, l, 40);
        expect(l.toll).toBeCloseTo(0.08, 6);
        expect(l.friction).toBeCloseTo(l.fr0 * Transport.tier('road').friction / 0.6 + 0.08, 6);
        l.val = 500;
        g.A.economy.tradeIncome = 30; g.B.economy.tradeIncome = 30;
        const money0 = player.gold + g.A.economy.tradeIncome + g.B.economy.tradeIncome + g.kingdom.treasury;
        PublicWorks.afterFlows(g.world, [l], player, 40);
        expect(player.gold).toBeCloseTo(40, 6);
        expect(Ledger.today(player).income.roadTolls).toBeCloseTo(40, 6);
        const money1 = player.gold + g.A.economy.tradeIncome + g.B.economy.tradeIncome + g.kingdom.treasury;
        expect(money1).toBeCloseTo(money0, 6);
    });

    it('a foreign investor\'s tolls pay the crown its share; caravans pay at the gate; the player pays crossing', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        const player = { gold: 100, financeToday: {} };
        g.world.transport.works.push({ id: 'pwG', kind: 'bridge', owner: 'k1', kid: 'k1', status: 'done', tollRate: 0.08, playerToll: 3, toll: true, tollIncome: 0 });
        Transport.setSegment(g.world, ab, { toll: 'pwG' });
        const gate = g.world.getTile(ab.gate % g.world.width, Math.floor(ab.gate / g.world.width));
        expect(gate.tollGate).toBe('pwG');
        const t0 = g.kingdom.treasury;
        expect(PublicWorks.playerCrossing(g.world, player, gate)).toBe(3);
        expect(player.gold).toBe(97);
        expect(g.kingdom.treasury).toBe(t0 + 3);
        const u = { value: 400, purse: 100 };
        expect(PublicWorks.caravanToll(g.world, u, gate)).toBe(32);
        expect(PublicWorks.caravanToll(g.world, u, gate)).toBe(0);
        expect(u.purse).toBe(68);
        // The player's own toll work abroad: the crown takes its cut
        const p2 = { gold: 0, financeToday: {} };
        const w = { id: 'pwP', kind: 'bridge', owner: 'player', kid: 'k1', status: 'done', tollRate: 0.08, toll: true, tollIncome: 0 };
        g.world.transport.works.push(w);
        const t1 = g.kingdom.treasury;
        PublicWorks._payToll(g.world, p2, w, 100);
        expect(p2.gold).toBeCloseTo(75, 6);
        expect(g.kingdom.treasury).toBeCloseTo(t1 + 25, 6);
    });

    it('no money loop: a player\'s budget comes back only as the unspent part; abandoning refunds what is left', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const bc = seg(g.world, g.B, g.C);
        Transport.setSegment(g.world, bc, { x: 'ford' });
        const player = { gold: 2000, financeToday: {} };
        const res = PublicWorks.commission(g.world, player, 'bridge', bc.key, { by: 'player', toll: true });
        expect(res.success).toBe(true);
        const paid = 2000 - player.gold;
        g.world.day = 41;
        PublicWorks.processDay(g.world, player);
        const back = PublicWorks.abandon(g.world, player, res.work.id);
        expect(back.success).toBe(true);
        expect(player.gold).toBeLessThan(2000);
        expect(player.gold).toBeCloseTo(2000 - res.work.spent, 0);
        expect(paid).toBeGreaterThan(res.work.spent);
        // A work can't be commissioned twice on one road at once
        const again = PublicWorks.commission(g.world, player, 'bridge', bc.key, { by: 'player' });
        const twice = PublicWorks.commission(g.world, player, 'bridge', bc.key, { by: 'player' });
        expect(again.success).toBe(true);
        expect(twice.success).toBe(false);
    });

    it('an NPC crown repairs its ruined roads and rebuilds a washed-out bridge from its treasury', () => {
        const g = makeWorld({ treasury: 20000 });
        Transport.segments(g.world);
        const bc = seg(g.world, g.B, g.C);
        Transport.setSegment(g.world, bc, { x: 'ferry' });
        Transport.segState(g.world, bc).wash = 30;
        const w = PublicWorks._realmTurn(g.world, g.kingdom, 40);
        expect(w && w.kind).toBe('bridge');
        expect(w.owner).toBe('k1');
        const ab = seg(g.world, g.A, g.B);
        Transport.setSegment(g.world, ab, { c: 10 });
        const w2 = PublicWorks._realmTurn(g.world, g.kingdom, 47);
        expect(w2 && w2.kind).toBe('repair');
        // A broke crown commissions nothing
        const poor = makeWorld({ treasury: 200 });
        Transport.segments(poor.world);
        Transport.setSegment(poor.world, seg(poor.world, poor.A, poor.B), { c: 10 });
        expect(PublicWorks._realmTurn(poor.world, poor.kingdom, 40)).toBe(null);
    });

    it('a canal needs a river or a port between its towns, and opens on completion', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        expect(PublicWorks.quote(g.world, 'canal', '2,5|8,5').ok).toBe(false);
        const q = PublicWorks.quote(g.world, 'canal', '8,5|14,5');
        expect(q.ok).toBe(true);
        expect(q.goods.stone).toBeGreaterThan(0);
        for (const s of [g.B, g.C]) { s.market.stock.stone = 400; s.market.stock.wood = 200; s.market.stock.iron = 40; }
        const res = PublicWorks.commission(g.world, null, 'canal', '8,5|14,5', { by: 'k1' });
        expect(res.success).toBe(true);
        for (let d = 41; d < 160 && res.work.status !== 'done'; d++) { g.world.day = d; PublicWorks.processDay(g.world, null); }
        expect(res.work.status).toBe('done');
        expect(g.world.transport.canals['8,5|14,5']).toBeTruthy();
        expect(g.world.transport.history.some(h => h.kind === 'canal_opened')).toBe(true);
    });
});

describe('the hinterland and the chatter', () => {
    it('goods hauled to market over a closed or ruined road lose part of the way', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        expect(Transport.haulFactor(g.world, g.C, g.B)).toBe(1);
        Transport.setSegment(g.world, seg(g.world, g.B, g.C), { cl: 'snow' });
        expect(Transport.haulFactor(g.world, g.C, g.B)).toBeLessThan(1);
        const site = { kind: 'iron_mine', q: 13, r: 5 };
        const before = g.B.market.stock.iron;
        Hinterland.deliver(g.world, site, { iron: 10 }, g.C, g.B);
        expect(g.B.market.stock.iron - before).toBeLessThan(5);
    });

    it('townsfolk talk of the roads out of town', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        Transport.setSegment(g.world, seg(g.world, g.B, g.C), { cl: 'snow' });
        expect(Transport.talk(g.world, g.B)).toContain('pass_closed');
        expect(Transport.talk(g.world, g.C)).toContain('pass_closed');
    });
});

describe('save and load', () => {
    it('round-trips the roads\' state through a save, and an old save derives it', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        const ab = seg(g.world, g.A, g.B);
        Transport.setSegment(g.world, ab, { t: 'highway', c: 33 });
        const saved = JSON.parse(JSON.stringify(Transport.serialize(g.world)));
        const h = makeWorld();
        Transport.restore(saved, h.world);
        const ab2 = seg(h.world, h.A, h.B);
        expect(Transport.segState(h.world, ab2)).toEqual(Transport.segState(g.world, ab));
        expect(h.world.getTile(5, 5).roadTier).toBe('highway');
        // An old save: no transport record — the roads' state is derived from the roads
        const old = makeWorld();
        Transport.restore(undefined, old.world);
        expect(old.world.transport).toBe(null);
        expect(Transport.segments(old.world)).toHaveLength(3);
        expect(Transport.segState(old.world, seg(old.world, old.A, old.B)).c).toBeGreaterThan(50);
    });

    it('the world save carries it (SaveLoad.serializeWorld / restoreWorld)', () => {
        expect(typeof SaveLoad.serializeWorld).toBe('function');
        const g = makeWorld();
        Transport.segments(g.world);
        const st = Transport.serialize(g.world);
        expect(st && typeof st.segs).toBe('object');
    });

    it('switched off (measurement), the links keep the old flat friction', () => {
        const g = makeWorld();
        Transport.segments(g.world);
        Transport.setSegment(g.world, seg(g.world, g.A, g.B), { t: 'highway' });
        Transport.setEnabled(false);
        const l = link(g.A, g.B);
        Transport.applyLink(g.world, l, 40);
        expect(l.friction).toBe(l.fr0);
        Transport.setEnabled(true);
    });
});
