// The town after dark (systems/nightStreets.js, systems/nightSight.js):
// darkness cutting witnesses' sight, the curfew law and the watch's
// challenge, smugglers' landings (every good bought from a real market, every
// coin from a real purse) and the back-alley night market.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { NightStreets } from '../systems/nightStreets.js';
import { NightSight } from '../systems/nightSight.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Underworld } from '../systems/underworld.js';
import { Gangs } from '../systems/gangs.js';
import { Laws } from '../systems/laws.js';
import { Player } from '../player/player.js';
import { SettlementMarket } from '../world/settlementMarket.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => {
    Utils.setSeed(4242);
    NightSight.clear();
});

const KINGDOMS = {
    azurath: { id: 'azurath', name: 'Theocracy of Azurath', culture: 'Religious', traits: ['religious'], religion: { faithId: 'starseers', piety: 40 }, isAlive: true, treasury: 5000 },
    merathis: { id: 'merathis', name: 'Republic of Merathis', culture: 'Maritime', traits: ['mercantile'], religion: { faithId: 'tidemother', piety: 30 }, isAlive: true, treasury: 5000 },
};

function makeWorld(day = 50) {
    const tiles = {
        '0,0': { q: 0, r: 0, settlement: { name: 'Azur', type: 'city', population: 6000, kingdom: 'azurath', economy: { gold: 20000 } } },
        '2,0': { q: 2, r: 0, settlement: { name: 'Tidewatch', type: 'town', population: 2500, kingdom: 'merathis', economy: { gold: 8000 } } },
    };
    for (const t of Object.values(tiles)) {
        t.terrain = { id: 'plains', passable: true };
        t.settlement.q = t.q;
        t.settlement.r = t.r;
    }
    const kingdoms = JSON.parse(JSON.stringify(KINGDOMS));
    return {
        day, width: 40, generationParams: { seed: 77 },
        kingdoms: Object.values(kingdoms),
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: id => kingdoms[id] || null,
        getSettlementViews: () => Object.values(tiles).map(t => t.settlement),
        getAllSettlements: () => Object.values(tiles).map(t => ({ q: t.q, r: t.r, ...t.settlement })),
        tiles,
    };
}

function makePlayer(extra = {}) {
    const p = new Player();
    p.gold = 2000;
    p.actionPoints = 100;
    p.inventory = {};
    p.q = 0; p.r = 0;
    Object.assign(p, extra);
    return p;
}

/** The first night (from day 1) that has a landing at this town, with its plan. */
function nightWithLanding(world, tile) {
    // The town over the border has drink to sell, the gangs coin to buy it
    const tide = world.getTile(2, 0).settlement;
    SettlementMarket.ensure(tide);
    for (const g of ['liquor', 'beer', 'mead', 'wine']) tide.market.stock[g] = 200;
    for (const g of Gangs.gangsAt(world, tile)) g.purse = 5000;
    for (let d = 1; d < 200; d++) {
        const plan = NightStreets.landingPlan(world, tile, d);
        if (plan) { world.day = d; return plan; }
    }
    return null;
}

describe('the dark', () => {
    it('cuts nothing by day or with a light carried, up to maxSightCut at full dark', () => {
        expect(NightSight.cutFor(0.1, false)).toBe(0);
        expect(NightSight.cutFor(0.9, true)).toBe(0);
        expect(NightSight.cutFor(1, false, 4)).toBe(4);
        expect(NightSight.cutFor(0.6, false, 4)).toBeGreaterThan(0);
    });

    it('a deed in the dark is seen from less far off, unless you carry a light', () => {
        const npcs = [{ id: 1, q: 6, r: 0, state: 'idle', type: 'villager' }];
        const scene = { q: 0, r: 0, indoors: false };
        expect(StreetCrime.selectWitnesses(npcs, scene, null).filter(w => w.seen)).toHaveLength(1);
        NightStreets.setAmbient(1, false);
        expect(StreetCrime.selectWitnesses(npcs, scene, null).filter(w => w.seen)).toHaveLength(0);
        // (indoors the dark doesn't matter: the room sees)
        expect(StreetCrime.selectWitnesses(npcs, { ...scene, indoors: true }, null).filter(w => w.seen)).toHaveLength(1);
        NightStreets.setAmbient(1, true);
        expect(StreetCrime.selectWitnesses(npcs, scene, null).filter(w => w.seen)).toHaveLength(1);
    });

    it('a guard still hears in the dark what he cannot see', () => {
        const npcs = [{ id: 2, q: 6, r: 0, state: 'idle', type: 'guard' }];
        NightStreets.setAmbient(1, false);
        const w = StreetCrime.selectWitnesses(npcs, { q: 0, r: 0, indoors: false }, null);
        expect(w).toHaveLength(1);
        expect(w[0].seen).toBe(false);
    });

    it('the lantern toggles, and the watch spots a light from further than a shadow', () => {
        const p = makePlayer();
        expect(NightStreets.lit(p)).toBe(true);
        expect(NightStreets.toggleLight(p)).toBe(false);
        expect(NightStreets.lit(p)).toBe(false);
        expect(NightStreets.spotRadius(1, true)).toBeGreaterThan(NightStreets.spotRadius(1, false));
    });
});

describe('the curfew', () => {
    it('is a law of the realm the panel lists, and a realm that proclaims it keeps it', () => {
        expect(Laws.law('curfew')).toBeTruthy();
        const world = makeWorld();
        const s = world.getTile(0, 0).settlement;
        world.getKingdom('azurath').laws = { curfew: 'curfew' };
        const c = NightStreets.curfew(world, s);
        expect(c.active).toBe(true);
        expect(c.by).toBe('realm');
        expect(NightStreets.inCurfew(world, s, 23)).toBe(true);
        expect(NightStreets.inCurfew(world, s, 3)).toBe(true);
        expect(NightStreets.inCurfew(world, s, 12)).toBe(false);
        world.getKingdom('azurath').laws = { curfew: 'none' };
        s.ordinances = { curfew: 'none' };
        expect(NightStreets.curfew(world, s).active).toBe(false);
        s.ordinances = { curfew: 'curfew' };
        expect(NightStreets.curfew(world, s).by).toBe('town');
    });

    it('paying the fine sends the coin to the town, by the realm\'s punishment law', () => {
        const world = makeWorld();
        const s = world.getTile(0, 0).settlement;
        world.getKingdom('azurath').laws = { curfew: 'curfew', punishment: 'standard' };
        const p = makePlayer({ gold: 500 });
        NightStreets.noteStop(p, s, world.day);
        // (the town's gangs seeded first: they take their founding purses from the town)
        Gangs.town(world, world.getTile(0, 0));
        const town0 = s.economy.gold;
        const out = NightStreets.answerChallenge(p, world, s, 'submit', { guardName: 'Wat' });
        expect(out.outcome).toBe('fined');
        expect(out.fine).toBeGreaterThan(0);
        expect(p.gold).toBe(500 - out.fine);
        expect(s.economy.gold).toBeCloseTo(town0 + out.fine, 5);
    });

    it('a fine you cannot pay is a night in the cells', () => {
        const world = makeWorld();
        const s = world.getTile(0, 0).settlement;
        world.getKingdom('azurath').laws = { curfew: 'curfew' };
        const p = makePlayer({ gold: 0 });
        const out = NightStreets.answerChallenge(p, world, s, 'submit', {});
        expect(out.outcome).toBe('jailed');
        expect(p.jailState).toBeTruthy();
        expect(p.jailState.offense).toMatch(/curfew/);
    });

    it('a bribe taken goes into the guard\'s own purse', () => {
        const world = makeWorld();
        const s = world.getTile(0, 0).settlement;
        world.getKingdom('azurath').laws = { curfew: 'curfew' };
        const guard = { id: 9, _person: { purse: 3 } };
        let took = null;
        for (let i = 0; i < 20 && !took; i++) {
            const p = makePlayer({ gold: 500 });
            const cost = NightStreets.bribeCost(p, world, s);
            const out = NightStreets.answerChallenge(p, world, s, 'bribe', { guard });
            if (out.outcome === 'bribed') took = { cost, p };
        }
        expect(took).toBeTruthy();
        expect(took.p.gold).toBe(500 - took.cost);
        expect(guard._person.purse).toBeGreaterThanOrEqual(3 + took.cost);
    });

    it('a second stop the same night costs more', () => {
        const world = makeWorld();
        const s = world.getTile(0, 0).settlement;
        const p = makePlayer();
        NightStreets.noteStop(p, s, world.day);
        const one = NightStreets.fineFor(p, world, s);
        NightStreets.noteStop(p, s, world.day);
        expect(NightStreets.fineFor(p, world, s)).toBeGreaterThan(one);
    });
});

describe('smugglers\' landings', () => {
    it('some nights a gang lands contraband bought over the border; it is the same night for everyone', () => {
        const world = makeWorld();
        const tile = world.getTile(0, 0);
        const plan = nightWithLanding(world, tile);
        expect(plan).toBeTruthy();
        expect(plan.units).toBeGreaterThan(0);
        expect(NightStreets.landingPlan(world, tile, plan.day)).toEqual(plan);
        expect(Underworld.contrabandStatus(world.getKingdom('azurath'), plan.good)).not.toBe('legal');
    });

    it('joining: the foreign market sells the load, the gang pays for it, you carry off a cut', () => {
        const world = makeWorld();
        const tile = world.getTile(0, 0);
        const plan = nightWithLanding(world, tile);
        const src = world.getTile(2, 0).settlement;
        const g = Gangs.gang(world, tile, plan.gangId);
        const purse0 = g.purse;
        const stock0 = SettlementMarket.available(src, plan.good);
        const srcGold0 = src.economy.gold;
        // (no raid tonight)
        Gangs.watch(world, tile).crackdown = 0;
        let res = null;
        for (let i = 0; i < 10; i++) {
            const p = makePlayer();
            Utils.setSeed(100 + i);
            const r = NightStreets.joinLanding(p, world, tile, plan);
            if (!r.raided) { res = { r, p }; break; }
        }
        expect(res).toBeTruthy();
        expect(res.r.cut).toBeGreaterThan(0);
        expect(res.p.inventory[plan.good]).toBe(res.r.cut);
        expect(g.purse).toBeLessThan(purse0);
        expect(SettlementMarket.available(src, plan.good)).toBeLessThan(stock0);
        expect(src.economy.gold).toBeGreaterThan(srcGold0);
        expect(NightStreets.landingDone(res.p, plan)).toBe('joined');
        // (not twice)
        expect(NightStreets.joinLanding(res.p, world, tile, plan).success).toBe(false);
    });

    it('informing: the load goes onto the town market, a reward from the town purse, the gang\'s grudge shuts the night market', () => {
        const world = makeWorld();
        const tile = world.getTile(0, 0);
        const s = tile.settlement;
        const plan = nightWithLanding(world, tile);
        const p = makePlayer({ gold: 0 });
        Underworld.ensure(p).guild.contactMet = true;
        const stock0 = SettlementMarket.stock(s, plan.good);
        const town0 = s.economy.gold;
        const res = NightStreets.informLanding(p, world, tile, plan);
        expect(res.success).toBe(true);
        expect(res.reward).toBeGreaterThan(0);
        expect(p.gold).toBe(res.reward);
        expect(s.economy.gold).toBeLessThan(town0);
        expect(SettlementMarket.stock(s, plan.good)).toBeGreaterThan(stock0);
        expect(NightStreets.grudge(p, world, tile)).toBeTruthy();
        expect(NightStreets.canEnterMarket(p, world, tile, 23).why).toBe('grudge');
        // the grudge runs out
        world.day += 365;
        NightStreets.processDay(p, world);
        expect(NightStreets.grudge(p, world, tile)).toBe(null);
    });

    it('robbing: the whole load, hot — or a beating and your purse to the gang', () => {
        const world = makeWorld();
        const tile = world.getTile(0, 0);
        const plan = nightWithLanding(world, tile);
        let won = null, lost = null;
        for (let i = 0; i < 40 && (!won || !lost); i++) {
            Utils.setSeed(900 + i);
            const p = makePlayer({ gold: 100, health: 100 });
            const res = NightStreets.robLanding(p, world, tile, { ...plan });
            if (res.beaten) lost = lost || { p, res };
            else won = won || { p, res };
        }
        expect(won).toBeTruthy();
        expect(won.p.inventory[plan.good]).toBeGreaterThan(0);
        expect(Underworld.hotQty(won.p, plan.good, world.day)).toBeGreaterThan(0);
        expect(lost).toBeTruthy();
        expect(lost.p.health).toBeLessThan(100);
        expect(lost.p.gold).toBe(100 - lost.res.lost);
    });
});

describe('the night market', () => {
    it('opens only after dark, and only to those the underworld knows', () => {
        const world = makeWorld();
        const tile = world.getTile(0, 0);
        const p = makePlayer();
        expect(NightStreets.canEnterMarket(p, world, tile, 23).why).toBe('stranger');
        Underworld.ensure(p).guild.contactMet = true;
        expect(NightStreets.canEnterMarket(p, world, tile, 12).why).toBe('shut');
        expect(NightStreets.canEnterMarket(p, world, tile, 23).ok).toBe(true);
        expect(NightStreets.marketHint(p, world, tile, 'the tannery')).toMatch(/tannery/);
    });

    it('sells the gangs\' stash cheaper than their black market: coin to the gang, goods out of the stash', () => {
        const world = makeWorld();
        const tile = world.getTile(0, 0);
        const g = Gangs.gangsAt(world, tile)[0];
        g.stash = { liquor: 5 };
        const p = makePlayer();
        Underworld.ensure(p).guild.contactMet = true;
        const ware = NightStreets.marketWares(p, world, tile).find(w => w.good === 'liquor');
        expect(ware).toBeTruthy();
        expect(ware.price).toBeLessThan(Underworld.blackMarketPrice(world, tile, 'liquor'));
        const purse0 = g.purse;
        const res = NightStreets.buyFromMarket(p, world, tile, 'liquor', false, 1);
        expect(res.success).toBe(true);
        expect(p.inventory.liquor).toBe(1);
        expect(g.stash.liquor).toBe(4);
        expect(g.purse).toBeCloseTo(purse0 + ware.price, 5);
    });

    it('goods still cooling at the fence come hot', () => {
        const world = makeWorld();
        const tile = world.getTile(0, 0);
        const g = Gangs.gangsAt(world, tile)[0];
        g.stash = {};
        g.fenced = [{ good: 'jewelry', qty: 2, day: world.day }];
        const p = makePlayer();
        Underworld.ensure(p).guild.member = true;
        const res = NightStreets.buyFromMarket(p, world, tile, 'jewelry', true, 1);
        expect(res.success).toBe(true);
        expect(Underworld.hotQty(p, 'jewelry', world.day)).toBe(1);
        expect(g.fenced[0].qty).toBe(1);
    });

    it('the fence buys your stolen goods, even for one with no contact of their own', () => {
        const world = makeWorld();
        const tile = world.getTile(0, 0);
        const p = makePlayer();
        Gangs._pst(p).gangs['0,0'] = { gangId: Gangs.gangsAt(world, tile)[0].id, rank: 0, standing: 0 };
        p.inventory = { tools: 2 };
        Underworld.markHot(p, 'tools', 2, world.day);
        const res = NightStreets.sellAtMarket(p, world, tile, 'tools', 1);
        expect(res.success).toBe(true);
        expect(p.inventory.tools).toBe(1);
        expect(Underworld.ensure(p).guild.contactMet).toBe(false);
    });
});
