// Works of the Ages (systems/greatWorks.js): civic great works raised over
// decades by many funders. Founding and pledging, the pace funding sets, the
// funders' shares carved on completion, broken pledges and the shame that
// follows the House, a stalled work decaying into a ruin and the town's
// grudge, resuming it, NPC actors founding and pledging, the effects other
// systems read — and every coin of it moving purse to purse (the census closes).

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { GreatWorks } from '../systems/greatWorks.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownEras } from '../world/townEras.js';
import { TownMarks } from '../world/townMarks.js';
import { Transport } from '../world/transport.js';
import { Literacy } from '../systems/literacy.js';
import { TownMemory } from '../systems/townMemory.js';
import { World } from '../world/world.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const DPY = 120;

/** A small realm: three towns on a row, a crown, a church and a noble House with purses. */
function realm(opts = {}) {
    const towns = [];
    const specs = [['Highmere', 'city', 9000], ['Ashford', 'town', 3000], ['Brook', 'village', 900]];
    specs.forEach(([name, type, population], i) => {
        const s = { name, q: i * 3, r: 0, kingdom: 'a', population, type, id: `s${i}` };
        Economy.initSettlement(s);
        s.economy.gold = 4000;
        SettlementMarket.ensure(s);
        // plenty of stone, timber and iron to buy (the market's own goods)
        for (const g of ['stone', 'wood', 'iron', 'glassware', 'planks', 'parchment', 'book', 'tools']) s.market.stock[g] = Math.max(s.market.stock[g] || 0, 400);
        towns.push(s);
    });
    towns[0].guilds = { masons: { name: 'The Masons of Highmere', treasury: 2000 } };
    const k = { id: 'a', name: 'Avalon', isAlive: true, treasury: opts.treasury != null ? opts.treasury : 60000, religion: { piety: 50 }, wars: [] };
    const world = Object.create(World.prototype);
    world.width = 60; world.height = 10; world.units = []; world.day = 7;
    world.year = 1000;
    world.generationParams = { seed: 4242 };
    world.kingdoms = [k];
    world.getKingdom = (id) => world.kingdoms.find(x => x.id === id) || null;
    world.getTile = (q, r) => { const s = towns.find(t => t.q === q && t.r === r); return s ? { q, r, settlement: s, terrain: { passable: true } } : { q, r, terrain: { passable: true } }; };
    world.getSettlementViews = () => towns;
    world.estates = { holders: {
        'church:a': { id: 'church:a', kind: 'church', name: 'the Church in Avalon', kid: 'a', purse: opts.church != null ? opts.church : 20000, debt: 0, inc: 0 },
        'noble:a:1': { id: 'noble:a:1', kind: 'noble', name: 'House Ashby', kid: 'a', purse: 8000, debt: 0, inc: 0 },
    } };
    const player = { q: 0, r: 0, gold: opts.gold != null ? opts.gold : 20000, kingdomId: 'a', house: { id: 'house_vane', name: 'House Vane', prestige: 100, rivals: {}, history: [], stats: {}, prestigeLog: [] } };
    return { world, towns, k, player };
}

/** Run the world `days` days, a day at a time (GreatWorks acts on its weekly day). */
function run(world, player, days) {
    const out = [];
    for (let i = 0; i < days; i++) {
        world.day++;
        out.push(...GreatWorks.processDay(world, player).notices);
    }
    return out;
}

describe('founding and pledging', () => {
    it('the player founds a cathedral with a pledge; it buys stone from the markets and hires hands', () => {
        const { world, towns, player } = realm();
        const s = towns[0];
        const opts = GreatWorks.options(world, s);
        const cat = opts.find(o => o.id === 'cathedral');
        expect(cat.ok).toBe(true);
        expect(cat.est.total).toBeGreaterThan(10000);
        // a village cannot raise a cathedral
        expect(GreatWorks.siteCheck(world, towns[2], 'cathedral').ok).toBe(false);
        // too small a founding pledge is refused
        expect(GreatWorks.found(world, player, s, 'cathedral', { weekly: 1 }).success).toBe(false);
        const res = GreatWorks.found(world, player, s, 'cathedral', { weekly: Math.ceil(cat.est.weekly), years: 0 });
        expect(res.success).toBe(true);
        const w = res.work;
        expect(w.funders[0].kind).toBe('player');
        expect(w.funders[0].house).toBe('house_vane');
        // a second work cannot rise in the same town at once
        expect(GreatWorks.siteCheck(world, s, 'university').ok).toBe(false);
        const stone0 = s.market.stock.stone;
        const gold0 = player.gold;
        run(world, player, 14);
        expect(w.prog).toBeGreaterThan(0);
        expect(player.gold).toBeLessThan(gold0);
        expect(s.market.stock.stone).toBeLessThan(stone0);
        expect(s.ageWorkHands).toBeGreaterThan(0);
        expect(w.funders[0].paid).toBeGreaterThan(0);
    });

    it('a good the near towns lack is carted from afar at a haulage markup, else a substitute stands in', () => {
        const { world, towns, player } = realm({ gold: 1e6 });
        // a far town (20 hexes off) keeps iron; the near ones have none
        const far = { name: 'Farholt', q: 26, r: 0, kingdom: 'a', population: 4000, type: 'town', id: 's9' };
        Economy.initSettlement(far);
        far.economy.gold = 1000;
        SettlementMarket.ensure(far);
        far.market.stock.iron = 400;
        towns.push(far);
        for (const t of towns.slice(0, 3)) { t.market.stock.iron = 0; t.market.stock.tools = 0; }
        const C = GreatWorks.config();
        const near = C.supplyRange;
        C.supplyRange = 8;
        try {
            const T = GreatWorks.type('castle_keep');
            const est = GreatWorks.estimate(T, towns[1]);
            const w = GreatWorks.found(world, player, towns[1], 'castle_keep', { weekly: Math.ceil(est.weekly * 1.5) }).work;
            w.prog = GreatWorks.stageEnd(T, 0); // the tower: iron wanted
            const iron0 = far.market.stock.iron;
            const coin0 = CoinCensus.total(world, player).total - MoneySupply.bookedChange(world);
            run(world, player, 28);
            expect(far.market.stock.iron).toBeLessThan(iron0);
            expect(w.matF).toBeGreaterThan(0.9);
            expect(CoinCensus.total(world, player).total - MoneySupply.bookedChange(world)).toBeCloseTo(coin0, 0);
            // no iron anywhere: tools stand in for it
            far.market.stock.iron = 0;
            towns[1].market.stock.tools = 400;
            run(world, player, 28);
            expect((w.subs && w.subs.tools) || 0).toBeGreaterThan(0);
            expect(w.matF).toBeGreaterThan(0.9);
        } finally { C.supplyRange = near; }
    });

    it('a pledge may be raised but not cut; NPC actors join a work short of funds', () => {
        const { world, towns, player } = realm();
        const T = GreatWorks.type('cathedral');
        const est = GreatWorks.estimate(T, towns[0]);
        const w = GreatWorks.found(world, player, towns[0], 'cathedral', { weekly: Math.ceil(est.weekly * 0.2) }).work;
        expect(GreatWorks.pledge(world, player, w.id, 1).success).toBe(false);
        expect(GreatWorks.pledge(world, player, w.id, Math.ceil(est.weekly * 0.3)).success).toBe(true);
        run(world, player, 7 * 4 * 6);
        const npc = w.funders.filter(f => f.kind !== 'player');
        expect(npc.length).toBeGreaterThan(0);
        expect(npc.some(f => ['crown', 'holder', 'guild'].includes(f.kind))).toBe(true);
    });
});

describe('coin', () => {
    it('the census closes across years of funding: every coin moves purse to purse', () => {
        const { world, towns, player } = realm();
        const T = GreatWorks.type('university');
        const est = GreatWorks.estimate(T, towns[0]);
        GreatWorks.found(world, player, towns[0], 'university', { weekly: Math.ceil(est.weekly * 0.5) });
        const before = CoinCensus.total(world, player).total;
        const booked0 = MoneySupply.bookedChange(world);
        run(world, player, DPY * 4);
        const w = GreatWorks.works(world)[0];
        expect(w.spent).toBeGreaterThan(0);
        expect(w.funders.length).toBeGreaterThan(1);
        const after = CoinCensus.total(world, player).total;
        expect(MoneySupply.bookedChange(world)).toBe(booked0);
        expect(after).toBeCloseTo(before, 1);
        // the crown's share is booked as works in its books
        expect(Object.values(towns).every(t => Number.isFinite(t.economy.gold))).toBe(true);
    });
});

describe('completion and its effects', () => {
    it('a well-funded work finishes in stages, carves its funders, and changes the world', () => {
        const { world, towns, player, k } = realm({ gold: 1e6 });
        const s = towns[0];
        const T = GreatWorks.type('cathedral');
        const est = GreatWorks.estimate(T, s);
        const w = GreatWorks.found(world, player, s, 'cathedral', { weekly: Math.ceil(est.weekly * 2) }).work;
        const prestige0 = player.house.prestige;
        // keep the markets stocked as their trade would
        for (let y = 0; y < 60 && w.status !== 'done'; y++) {
            for (const t of towns) for (const g of Object.keys(t.market.stock)) t.market.stock[g] = Math.max(t.market.stock[g], 400);
            run(world, player, DPY);
        }
        expect(w.status).toBe('done');
        // at better than full pace (capped), well short of the type's 50 years
        expect((w.done - w.founded) / DPY).toBeLessThan(T.years);
        expect((w.done - w.founded) / DPY).toBeGreaterThan(T.years / 2);
        expect(w.carved.some(c => c.kind === 'player' && c.house === 'house_vane')).toBe(true);
        expect(player.house.prestige).toBeGreaterThan(prestige0);
        expect(player.house.history.some(h => h.tags.includes('greatWork') && /completed/.test(h.text))).toBe(true);
        // the town's memory: its pride
        expect(TownMarks.marks(s, 'greatwork').length).toBe(1);
        expect(TownMemory.markText(s, TownMarks.marks(s, 'greatwork')[0], world)).toMatch(/finished/);
        // the realm grows more pious, pilgrims bring coin from the realm's towns, folk are drawn
        const piety0 = k.religion.piety;
        const g0 = s.economy.gold;
        run(world, player, 28);
        expect(k.religion.piety).toBeGreaterThan(piety0);
        expect(s.economy.gold).toBeGreaterThan(g0);
        expect(s.ageWorksFx.pull).toBeGreaterThan(0);
    });

    it('a university raises the letters of its town and realm and teaches the heirs; walls defend', () => {
        const { world, towns, player } = realm({ gold: 1e6 });
        const w = GreatWorks.found(world, player, towns[0], 'university', { weekly: 1e4 }).work;
        w.prog = 0.9999;
        run(world, player, 7);
        expect(w.status).toBe('done');
        run(world, player, 28);
        expect(towns[0].ageWorksFx.letters).toBeGreaterThan(towns[1].ageWorksFx.letters);
        expect(towns[1].ageWorksFx.letters).toBeGreaterThan(0);
        const t0 = Literacy.target(world, towns[1]);
        delete towns[1].ageWorksFx;
        expect(Literacy.target(world, towns[1])).toBeLessThan(t0);
        expect(GreatWorks.educationFor(player, world)).toBeGreaterThan(0);
        // walls: stone, and siege defence
        const ww = GreatWorks.found(world, player, towns[1], 'city_walls', { weekly: 1e4 });
        expect(ww.success).toBe(true);
        const d0 = TownEras.wallDefense(towns[1]);
        ww.work.prog = 0.9999;
        run(world, player, 35);
        expect(ww.work.status).toBe('done');
        expect(towns[1].townEra.walls.kind).toBe('stone');
        expect(TownEras.wallDefense(towns[1])).toBeGreaterThan(d0);
    });

    it('a great harbour cuts sea haulage (world/transport.js reads its mult)', () => {
        const { world, towns } = realm();
        const w = { id: 'awX', type: 'great_harbour', q: towns[0].q, r: towns[0].r, town: towns[0].name };
        GreatWorks._applyWorld(world, w, towns[0], 10);
        const h = Transport.state(world).harbours[`${towns[0].q},${towns[0].r}`];
        expect(h.mult).toBeLessThan(1);
        expect(h.great).toBe('awX');
    });
});

describe('broken pledges, ruins and grudges', () => {
    it('a House that cannot pay breaks its pledge; the work stalls, decays, falls to ruin, and the town remembers', () => {
        const { world, towns, player } = realm({ gold: 400, treasury: 0, church: 0 });
        world.estates.holders['noble:a:1'].purse = 0;
        towns[1].guilds = null;
        const T = GreatWorks.type('city_walls');
        const est = GreatWorks.estimate(T, towns[1]);
        const w = GreatWorks.found(world, player, towns[1], 'city_walls', { weekly: Math.ceil(est.weekly * 0.5) }).work;
        const prestige0 = player.house.prestige;
        run(world, player, DPY * 2);
        const mine = w.funders.find(f => f.kind === 'player');
        expect(mine.status).toBe('broken');
        expect(player.house.prestige).toBeLessThan(prestige0);
        expect(w.status).toBe('stalled');
        const built = w.prog;
        run(world, player, DPY * 9);
        expect(w.prog).toBeLessThan(built);
        expect(w.status).toBe('ruin');
        expect(w.abandonedBy.some(b => b.kind === 'player')).toBe(true);
        const grudge = TownMarks.marks(towns[1], 'grudge');
        expect(grudge.length).toBe(1);
        expect(grudge[0].houses).toContain('house_vane');
        // the town will not let the House found another work there...
        expect(GreatWorks.grudgeAgainst(world, towns[1], 'house_vane')).toBeTruthy();
        player.gold = 1e6;
        expect(GreatWorks.found(world, player, towns[1], 'castle_keep', { weekly: 1e3 }).success).toBe(false);
        // ...but anyone may take the ruin up again, the House too
        const r = GreatWorks.resume(world, player, w.id, { weekly: Math.ceil(est.weekly) });
        expect(r.success).toBe(true);
        expect(w.status).toBe('building');
    });

    it('withdrawing before the term is out is a broken pledge', () => {
        const { world, towns, player } = realm();
        const est = GreatWorks.estimate(GreatWorks.type('cathedral'), towns[0]);
        const w = GreatWorks.found(world, player, towns[0], 'cathedral', { weekly: Math.ceil(est.weekly * 0.2), years: 10 }).work;
        const p0 = player.house.prestige;
        expect(GreatWorks.withdraw(world, player, w.id).success).toBe(true);
        expect(player.house.prestige).toBeLessThan(p0);
        expect(w.broken[0].house).toBe('house_vane');
    });

    it('an heir inherits the House\'s pledges; another House\'s new life lets the old pledge lapse', () => {
        const { world, towns, player } = realm();
        const est = GreatWorks.estimate(GreatWorks.type('cathedral'), towns[0]);
        const w = GreatWorks.found(world, player, towns[0], 'cathedral', { weekly: Math.ceil(est.weekly * 0.3) }).work;
        const heir = { ...player, gold: 5000, house: player.house };
        run(world, heir, 14);
        expect(w.funders[0].status).toBe('active');
        expect(w.funders[0].last).toBeGreaterThan(0);
        // between lives (no player) the pledge waits: no misses
        run(world, null, 21);
        expect(w.funders[0].missed).toBe(0);
        const stranger = { ...player, gold: 5000, house: { id: 'house_other', name: 'House Other', prestige: 0, rivals: {}, history: [], stats: {}, prestigeLog: [] } };
        run(world, stranger, 7);
        expect(w.funders[0].status).toBe('lapsed');
    });
});

describe('NPC actors and saving', () => {
    it('crowns and the church found works on their own, and the state round-trips a save', () => {
        const { world, player } = realm({ treasury: 200000, church: 100000 });
        const N = DataLoader._gamedata.greatWorks.npc;
        const chance = N.foundChance;
        N.foundChance = 1;
        try { run(world, null, DPY * 2); } finally { N.foundChance = chance; }
        const list = GreatWorks.works(world);
        expect(list.length).toBeGreaterThan(0);
        expect(list.every(w => w.founder.kind !== 'player')).toBe(true);
        const saved = GreatWorks.serialize(world);
        const w2 = Object.create(World.prototype);
        GreatWorks.restore(JSON.parse(JSON.stringify(saved)), w2);
        expect(GreatWorks.works(w2).map(w => w.id)).toEqual(list.map(w => w.id));
        expect(player.gold).toBe(20000);
    });

    it('does nothing between its weekly days (the century soak is sensitive to ms/day)', () => {
        const { world, towns, player } = realm();
        GreatWorks.found(world, player, towns[0], 'cathedral', { weekly: 500 });
        world.day = 8;
        const before = JSON.stringify(world.ageWorks);
        GreatWorks.processDay(world, player);
        expect(JSON.stringify(world.ageWorks)).toBe(before);
    });
});

describe('the panel', () => {
    it('shows the works near you, their funders and the pledge buttons; the buttons pledge', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { world, towns, player } = realm();
        const est = GreatWorks.estimate(GreatWorks.type('cathedral'), towns[0]);
        const w = GreatWorks.found(world, player, towns[0], 'cathedral', { weekly: Math.ceil(est.weekly * 0.2) }).work;
        run(world, player, 14);
        let html = '';
        const game = { world, player, ui: { showCustomPanel: (t, h) => { html = h; }, updateStats: () => {} } };
        ActionMenu.showGreatWorks(game);
        expect(html).toContain(w.name);
        expect(html).toContain('House Vane');
        expect(html).toContain('greatWorksAct');
        expect(html).toContain('Found a');
        const before = w.funders[0].weekly;
        ActionMenu.greatWorksAct(game, 'pledge', w.id, 100);
        expect(w.funders[0].weekly).toBeGreaterThan(before);
    });
});
