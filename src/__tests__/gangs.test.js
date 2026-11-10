// The towns' gangs (systems/gangs.js): seeded per town from the world's hash,
// every coin from a real purse (the town's, the gang's, the crown's) and every
// good from a real stock; the watch's crackdown and bought captains and
// magistrates; joining, errands, ranks, challenging the boss, founding a crew;
// the boss's hand; wars and betrayals; dirty coin and laundering; the realm's
// laws; and the Crime Lord advanced start in a generated world.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Gangs } from '../systems/gangs.js';
import { Underworld } from '../systems/underworld.js';
import { Laws } from '../systems/laws.js';
import { Victory } from '../systems/victory.js';
import { Scenarios } from '../player/scenarios.js';
import { Prison } from '../player/prison.js';
import { Player } from '../player/player.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(4242));

const KINGDOMS = {
    azurath: { id: 'azurath', name: 'Theocracy of Azurath', culture: 'Religious', traits: ['religious'], religion: { faithId: 'starseers', piety: 40 }, isAlive: true, treasury: 5000 },
    merathis: { id: 'merathis', name: 'Republic of Merathis', culture: 'Maritime', traits: ['mercantile'], religion: { faithId: 'tidemother', piety: 30 }, isAlive: true, treasury: 5000 },
};

/** Two realms: a city in Azurath (liquor banned there) and a town over the border in Merathis. */
function makeWorld(day = 50) {
    const tiles = {
        '0,0': { q: 0, r: 0, settlement: { name: 'Azur', type: 'city', population: 6000, kingdom: 'azurath', economy: { gold: 20000 } } },
        '2,0': { q: 2, r: 0, settlement: { name: 'Tidewatch', type: 'town', population: 2500, kingdom: 'merathis', economy: { gold: 8000 } } },
        '5,0': { q: 5, r: 0, settlement: { name: 'Fishhook', type: 'village', population: 200, kingdom: 'merathis', economy: { gold: 300 } } },
    };
    for (const t of Object.values(tiles)) {
        t.terrain = { id: 'plains', passable: true };
        t.settlement.q = t.q;
        t.settlement.r = t.r;
    }
    const kingdoms = JSON.parse(JSON.stringify(KINGDOMS));
    return {
        day,
        width: 40,
        generationParams: { seed: 77 },
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

function contact(p, rank = 0) {
    const st = Underworld.ensure(p);
    st.guild.contactMet = true;
    st.guild.member = true;
    st.guild.rank = rank;
    return st;
}

/** Every coin in the mock world: towns, gangs, the watch's purses, crowns and the player. */
function coin(w, p) {
    let total = p ? p.gold : 0;
    for (const t of Object.values(w.tiles)) {
        const s = t.settlement;
        total += s.economy.gold;
        const st = s.underworld;
        if (!st) continue;
        for (const g of st.gangs) total += g.purse;
        total += st.watch.captain.purse + st.watch.magistrate.purse;
    }
    for (const k of w.kingdoms) total += k.treasury;
    return Math.round(total * 100) / 100;
}

const city = w => w.getTile(0, 0);

describe('the towns\' underworld', () => {
    it('seeds gangs in towns and cities only, the same for the same world, without touching the shared dice', () => {
        const w = makeWorld();
        const before = Utils.random();
        Utils.setSeed(4242);
        const st = Gangs.town(w, city(w));
        expect(Utils.random()).toBe(before);
        expect(st.gangs.length).toBeGreaterThanOrEqual(1);
        expect(Gangs.town(w, w.getTile(5, 0))).toBeNull();
        const again = Gangs.town(makeWorld(), city(makeWorld()));
        expect(again.gangs.map(g => g.name)).toEqual(st.gangs.map(g => g.name));
        for (const g of st.gangs) {
            expect(g.lieutenants.length).toBeGreaterThanOrEqual(2);
            expect(g.boss.name).toBeTruthy();
        }
        expect(st.gangs.reduce((a, g) => a + g.turf, 0)).toBeLessThanOrEqual(1.0001);
    });

    it('a gang\'s first purse and stash came out of the town', () => {
        const w = makeWorld();
        const s = city(w).settlement;
        SettlementMarket.ensure(s);
        const stock = { ...s.market.stock };
        const gold = s.economy.gold;
        const st = Gangs.town(w, city(w));
        const purses = st.gangs.reduce((a, g) => a + g.purse, 0);
        expect(purses).toBeGreaterThan(0);
        expect(Math.round((gold - s.economy.gold) * 100) / 100).toBeCloseTo(purses, 1);
        for (const g of st.gangs) {
            for (const [good, n] of Object.entries(g.stash)) expect(s.market.stock[good]).toBeCloseTo(stock[good] - st.gangs.reduce((a, x) => a + (x.stash[good] || 0), 0), 1);
            expect(Object.keys(g.stash).length).toBeGreaterThanOrEqual(0);
        }
    });

    it('a week of the underworld moves coin between purses and never makes any', () => {
        const w = makeWorld(52);
        const p = makePlayer();
        Gangs.town(w, city(w));
        Gangs.town(w, w.getTile(2, 0));
        const total = coin(w, p);
        for (let d = 53; d <= 53 + 21; d++) {
            w.day = d;
            Gangs.processDay(w, p);
        }
        expect(coin(w, p)).toBeCloseTo(total, 0);
        // ...and the gangs did take from the town: protection, dens and the black market
        const st = city(w).settlement.underworld;
        expect(st.gangs.some(g => g.week && g.week.protection > 0)).toBe(true);
    });

    it('smuggling buys contraband out of a foreign market and the stash sells at supply-and-demand prices', () => {
        const w = makeWorld(52);
        const tide = w.getTile(2, 0).settlement;
        SettlementMarket.ensure(tide);
        tide.market.stock.liquor = 200;
        const st = Gangs.town(w, city(w));
        const g = st.gangs[0];
        g.purse = 5000;
        const liquorBefore = tide.market.stock.liquor;
        const goldBefore = tide.economy.gold;
        const run = Gangs._smuggleRun(w, city(w), g, {});
        expect(run).toBeTruthy();
        expect(['liquor', 'beer', 'mead', 'wine']).toContain(run.good);
        if (run.good === 'liquor') expect(tide.market.stock.liquor).toBeCloseTo(liquorBefore - run.units, 2);
        expect(tide.economy.gold).toBeCloseTo(goldBefore + run.cost, 2);
        // More of it in the stash, cheaper it sells
        const thin = Gangs.blackScarcity(w, city(w), 'liquor');
        g.stash.liquor = (g.stash.liquor || 0) + 200;
        expect(Gangs.blackScarcity(w, city(w), 'liquor')).toBeLessThan(thin);
        expect(Underworld.blackMarketPrice(w, city(w), 'liquor')).toBeGreaterThan(0);
    });

    it('the black market and the fence are the gangs: their purse pays, their stash takes the goods', () => {
        const w = makeWorld();
        const p = makePlayer({ inventory: { liquor: 3 } });
        contact(p);
        const tile = city(w);
        const buyer = Gangs.buyer(p, w, tile);
        buyer.purse = 1000;
        Utils.setRng(() => 0.99); // the watch never comes
        const res = Underworld.sellBlackMarket(p, w, tile, 'liquor', 1);
        expect(res.success).toBe(true);
        expect(buyer.purse).toBe(1000 - res.earned);
        expect(buyer.stash.liquor).toBeGreaterThanOrEqual(1);
        expect(Gangs.dirty(p)).toBe(res.earned);
        // A broke gang can't buy
        for (const g of Gangs.gangsAt(w, tile)) g.purse = 0;
        expect(Underworld.sellBlackMarket(p, w, tile, 'liquor', 1).success).toBe(false);
        expect(p.inventory.liquor).toBe(2);
    });
});

describe('running with a crew', () => {
    it('join through a contact, run errands for the town\'s coin, rise in rank', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        const g = Gangs.gangsAt(w, tile)[0];
        expect(Gangs.join(p, w, tile, g.id).success).toBe(false); // no contact
        contact(p);
        expect(Gangs.join(p, w, tile, g.id).success).toBe(true);
        expect(Gangs.membership(p, tile).rank).toBe(0);
        const town = tile.settlement.economy.gold;
        const purse = g.purse;
        Utils.setRng(() => 0.0);
        const res = Gangs.doErrand(p, w, tile, 'collect');
        expect(res.outcome).toBe('success');
        const took = town - tile.settlement.economy.gold;
        expect(took).toBeGreaterThan(0);
        expect(Math.round((g.purse - purse + (p.gold - 2000)) * 100) / 100).toBeCloseTo(took, 1);
        expect(Gangs.crackdown(w, tile)).toBeGreaterThan(0);
        for (let i = 0; i < 12; i++) Gangs.doErrand(p, w, tile, 'collect');
        expect(Gangs.membership(p, tile).rank).toBeGreaterThanOrEqual(1);
        // Kidnap is an enforcer's job
        expect(Gangs.errands(p, w, tile).find(e => e.id === 'kidnap').locked).toBeTruthy();
    });

    it('forging papers turns parchment and ink into contraband', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer({ inventory: { parchment: 1, ink: 1 } });
        contact(p);
        const g = Gangs.gangsAt(w, tile)[0];
        Gangs.join(p, w, tile, g.id);
        Gangs.membership(p, tile).rank = 1;
        Utils.setRng(() => 0.0);
        const res = Gangs.doErrand(p, w, tile, 'forge');
        expect(res.outcome).toBe('success');
        expect(p.inventory.forged_documents).toBe(1);
        expect(p.inventory.parchment).toBeUndefined();
        expect(Underworld.contrabandStatus(w.getKingdom('azurath'), 'forged_documents')).toBe('illegal');
    });

    it('a lieutenant can take the gang; a failed challenge makes enemies', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        contact(p);
        const g = Gangs.gangsAt(w, tile)[0];
        Gangs.join(p, w, tile, g.id);
        expect(Gangs.challengeBoss(p, w, tile).success).toBe(false); // not a lieutenant
        Gangs.membership(p, tile).rank = 3;
        Utils.setRng(() => 0.0);
        const res = Gangs.challengeBoss(p, w, tile);
        expect(res.outcome).toBe('success');
        expect(g.boss.player).toBe(true);
        expect(Gangs.isBoss(p, w, tile)).toBe(true);
        expect(Gangs.bossTowns(p, w).length).toBe(1);

        const w2 = makeWorld();
        const q = makePlayer();
        contact(q);
        const g2 = Gangs.gangsAt(w2, city(w2))[0];
        Gangs.join(q, w2, city(w2), g2.id);
        Gangs.membership(q, city(w2)).rank = 3;
        Utils.setRng(() => 0.99);
        expect(Gangs.challengeBoss(q, w2, city(w2)).outcome).toBe('failed');
        expect(Gangs.membership(q, city(w2))).toBeNull();
        expect(Gangs.join(q, w2, city(w2), g2.id).success).toBe(false);
    });

    it('founding a crew costs your coin; the signing fees go to the town', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        contact(p, 1);
        expect(Gangs.found(p, w, tile).success).toBe(false); // a Cutpurse is nobody
        Underworld.ensure(p).guild.rank = 2;
        const town = tile.settlement.economy.gold;
        const res = Gangs.found(p, w, tile, 'The Test Knives');
        expect(res.success).toBe(true);
        const fees = Gangs.cfg().recruitFee * 4;
        expect(p.gold).toBe(2000 - 200 - fees);
        expect(tile.settlement.economy.gold).toBe(town + fees);
        expect(res.gang.purse).toBe(200);
        expect(Gangs.isBoss(p, w, tile)).toBe(true);
    });
});

describe('the boss\'s hand', () => {
    function bossGame() {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        contact(p, 2);
        const res = Gangs.found(p, w, tile, 'The Test Knives');
        res.gang.purse = 3000;
        return { w, tile, p, g: res.gang };
    }

    it('buys the captain and the magistrate: fewer searches, cheaper bribes, a case dismissed', () => {
        const { w, tile, p, g } = bossGame();
        const search = Gangs.searchMult(p, w, tile);
        const purse = g.purse;
        expect(Gangs.bossAct(p, w, tile, 'captain').success).toBe(true);
        expect(Gangs.watch(w, tile).captain.purse).toBeGreaterThan(0);
        expect(g.purse).toBeLessThan(purse);
        expect(Gangs.searchMult(p, w, tile)).toBeLessThan(search);
        Underworld.addHeat(p, 'azurath', 40, w);
        expect(Gangs.bossAct(p, w, tile, 'magistrate').success).toBe(true);
        const arrest = Underworld._arrest(p, w, tile.settlement, 'test');
        expect(arrest.days).toBe(1);
        expect(p.jailState.q).toBe(0);
    });

    it('hires from the town, pays bonuses, purges; the cut sours lieutenants', () => {
        const { w, tile, p, g } = bossGame();
        const town = tile.settlement.economy.gold;
        const crew = g.crew;
        expect(Gangs.bossAct(p, w, tile, 'hire', 2).success).toBe(true);
        expect(g.crew).toBe(crew + 2);
        expect(tile.settlement.economy.gold).toBe(town + Gangs.cfg().recruitFee * 2);
        const lt = g.lieutenants[0];
        const loyal = lt.loyalty;
        Gangs.bossAct(p, w, tile, 'bonus', lt.id);
        expect(lt.loyalty).toBeGreaterThan(loyal);
        Gangs.bossAct(p, w, tile, 'cut', 2);
        expect(g.cut).toBe(0.4);
        const before = lt.loyalty;
        w.day = 52;
        for (let d = 53; d <= 53 + 7; d++) { w.day = d; Gangs.processDay(w, p); }
        expect(lt.loyalty).toBeLessThan(before + 2);
        expect(Gangs.bossAct(p, w, tile, 'purge', lt.id).success).toBe(true);
        expect(g.lieutenants.includes(lt)).toBe(false);
    });

    it('the boss\'s weekly cut is the gang\'s take, paid as dirty coin', () => {
        const { w, tile, p, g } = bossGame();
        g.turf = 0.5;
        p.gold = 0;
        Underworld.ensure(p).dirty = 0;
        w.day = 52;
        Gangs.processDay(w, p);
        expect(g.week.bossCut).toBeGreaterThan(0);
        expect(p.gold).toBe(g.week.bossCut);
        expect(Gangs.dirty(p)).toBe(p.gold);
    });

    it('war: crews clash weekly, the broken gang\'s streets and purse go to the victor', () => {
        const { w, tile, p, g } = bossGame();
        const foe = Gangs.gangsAt(w, tile).find(x => x !== g);
        expect(Gangs.bossAct(p, w, tile, 'war', foe.id).success).toBe(true);
        g.crew = 40;
        foe.crew = 4;
        foe.stash = { liquor: 3 };
        for (const day of [52, 59, 66, 73]) {
            w.day = day;
            Gangs.processDay(w, p);
            if (foe.dissolved) break;
        }
        expect(foe.dissolved).toBe(true);
        expect(Gangs.gangsAt(w, tile).includes(foe)).toBe(false);
        // Its streets went to the victor, its purse and stash emptied into the victor's
        expect(foe.purse).toBe(0);
        expect(foe.turf).toBe(0);
        expect(Object.keys(foe.stash)).toEqual([]);
        expect(g.turf).toBeGreaterThan(0.15);
    });

    it('a squeezed, ambitious lieutenant betrays you', () => {
        const { w, tile, p, g } = bossGame();
        const lt = g.lieutenants[0];
        lt.loyalty = 0;
        lt.ambition = 0.2; // not a usurper: he informs or splits
        const crack = Gangs.crackdown(w, tile);
        const gangs = Gangs.gangsAt(w, tile).length;
        Utils.setRng(() => 0.01);
        Gangs._betrayals(w, tile, Gangs.town(w, tile), g, p, Gangs.membership(p, tile), { notices: [] });
        expect(Gangs.crackdown(w, tile) > crack || Gangs.gangsAt(w, tile).length > gangs).toBe(true);
    });

    it('with no player behind it (a new life), a lieutenant takes the gang', () => {
        const { w, tile, g } = bossGame();
        w.day = 52;
        Gangs.processDay(w, null);
        expect(g.boss.player).toBeFalsy();
        expect(g.boss.name).toBeTruthy();
    });
});

describe('the watch and the law', () => {
    it('the crackdown rises with crime here and spoils the odds', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        contact(p, 2);
        const odds = Underworld.jobOdds(p, w, tile.settlement, 'pickpocket', 0, tile);
        Underworld.recordCrime(p, w, 'heist', { kingdom: 'azurath', q: 0, r: 0 });
        expect(Gangs.crackdown(w, tile)).toBeGreaterThan(20);
        expect(Underworld.jobOdds(p, w, tile.settlement, 'pickpocket', 0, tile)).toBeLessThan(odds);
    });

    it('harsh punishment lengthens the cell; fines go to the town', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        w.getKingdom('azurath').laws = { punishment: 'lenient' };
        Underworld._arrest(p, w, tile.settlement, 'test');
        const lenient = p.jailState.daysRemaining;
        p.jailState = null;
        w.getKingdom('azurath').laws = { punishment: 'harsh' };
        Underworld.addHeat(p, 'azurath', 50, w);
        Underworld._arrest(p, w, tile.settlement, 'test');
        expect(p.jailState.daysRemaining).toBeGreaterThan(lenient);
        const town = tile.settlement.economy.gold;
        const fine = Underworld._fine(p, w, tile.settlement, 100);
        expect(fine).toBe(160);
        expect(tile.settlement.economy.gold).toBe(town + 160);
    });

    it('licensed vice: the dens take more and the crown takes its licence', () => {
        const run = (vice) => {
            const w = makeWorld(52);
            w.getKingdom('azurath').laws = { vice };
            const st = Gangs.town(w, city(w));
            for (const g of st.gangs) g.dens = 1;
            const treasury = w.getKingdom('azurath').treasury;
            w.day = 52;
            Gangs.processDay(w, null);
            return { dens: st.gangs.reduce((a, g) => a + g.week.dens, 0), licence: w.getKingdom('azurath').treasury - treasury };
        };
        const tol = run('tolerated');
        const lic = run('licensed');
        expect(Laws.law('vice')).toBeTruthy();
        expect(tol.licence).toBe(0);
        expect(lic.licence).toBeGreaterThan(0);
        expect(lic.dens).toBeGreaterThan(0);
    });

    it('jail bribes and bail reach the town that passed the sentence', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        Underworld._arrest(p, w, tile.settlement, 'test');
        const town = tile.settlement.economy.gold;
        const res = Prison.postBail(p, w);
        expect(res.success).toBe(true);
        expect(tile.settlement.economy.gold).toBe(town + res.bail);
    });
});

describe('dirty coin', () => {
    it('crime gold is dirty; a search takes it; a front washes it for a fee to the town', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer({ gold: 0 });
        contact(p);
        Underworld._payGold(p, w, 1000, 'theft');
        expect(Gangs.dirty(p)).toBe(1000);
        // Spending spends the dirty coin first
        p.gold -= 100;
        Gangs._dirtyFollowsGold(p);
        expect(Gangs.dirty(p)).toBe(900);
        expect(Gangs.launder(p, w, tile, 500).success).toBe(false); // no front
        tile.playerProperties = [{ type: 'tavern', level: 1 }];
        const town = tile.settlement.economy.gold;
        const res = Gangs.launder(p, w, tile, 500);
        expect(res.success).toBe(true);
        expect(Gangs.dirty(p)).toBe(900 - 160);
        expect(tile.settlement.economy.gold).toBe(town + 24);
        expect(Gangs.launder(p, w, tile, 500).success).toBe(false); // the week's capacity is used
        const seized = Gangs.seizeDirty(p, tile.settlement, 0.5);
        expect(seized).toBe(Math.floor((900 - 160) * 0.5));
    });
});

describe('the Crime Lord', () => {
    it('takes over the biggest gang of a city: crew, a scheming lieutenant, a bought captain, a rival at war', async () => {
        const g = newGame(73);
        const views = g.world.getSettlementViews();
        for (const s of views) if (!s.economy && s.population > 0) Economy.initSettlement(s);
        const purseTotal = () => views.reduce((a, s) => a + ((s.economy && s.economy.gold) || 0) + ((s.underworld && s.underworld.gangs) || []).reduce((b, x) => b + x.purse, 0), 0);
        const before = purseTotal();
        const r = Scenarios.apply(g.player, g.world, { origin: 'crime_lord' });
        const p = g.player;
        const st = p.scenario.start;
        expect(st.kind).toBe('crime_lord');
        const tile = g.world.getTile(st.q, st.r);
        expect(['city', 'town', 'capital']).toContain(tile.settlement.type);
        const gang = Gangs.myGang(p, g.world, tile);
        expect(gang.boss.player).toBe(true);
        expect(gang.crew).toBeGreaterThanOrEqual(12);
        expect(gang.dens).toBeGreaterThanOrEqual(1);
        expect(gang.lieutenants.length).toBeGreaterThanOrEqual(3);
        expect(gang.lieutenants.some(l => l.ambition >= 0.75)).toBe(true);
        expect(Gangs.watch(g.world, tile).captain.bribedBy).toBe(gang.id);
        expect(Gangs.watch(g.world, tile).magistrate.bribedBy).toBeNull();
        expect(Gangs.gangsAt(g.world, tile).some(x => x !== gang && Gangs.atWar(gang, x))).toBe(true);
        expect(Underworld.ensure(p).guild.rank).toBe(4);
        expect(Underworld.getHeat(p, tile.settlement.kingdom)).toBeGreaterThan(0);
        expect(p.q).toBe(st.q);
        expect(r.welcome).not.toMatch(/\{\w+\}/);
        // Nothing minted: the gangs' purses came out of the towns
        expect(purseTotal()).toBeCloseTo(before, 0);
        expect(Victory.progress(p, g.world, 'kingpin').text).toMatch(/1 of 4/);
        expect(Scenarios.choices().origins.find(o => o.id === 'crime_lord').suggestedVictory).toBe('kingpin');
        // Two weeks as boss, then save and load
        for (let d = 0; d < 14; d++) endDay(g);
        const back = roundTrip(g);
        const t2 = back.world.getTile(st.q, st.r);
        const g2 = Gangs.myGang(back.player, back.world, t2);
        expect(g2).toBeTruthy();
        expect(g2.name).toBe(gang.name);

        // The Underworld panel renders every tab for the boss, and its buttons reach the systems
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const shown = [];
        const notes = [];
        const game = {
            player: back.player, world: back.world,
            ui: {
                showCustomPanel: (title, html) => shown.push(html),
                setPanelNav: (nav) => { game.nav = nav; },
                showNotification: (t, text, type) => notes.push({ text, type }),
                updateStats() {}, hideCustomPanel() {},
            },
        };
        for (const tab of ['streets', 'guild', 'market', 'coin']) {
            ActionMenu.showUnderworldPanel(game, t2, tab);
            expect(shown[shown.length - 1].length).toBeGreaterThan(100);
        }
        ActionMenu.showUnderworldPanel(game, t2, 'streets');
        expect(shown[shown.length - 1]).toContain(g2.name);
        expect(shown[shown.length - 1]).toContain('The boss');
        expect(shown[shown.length - 1]).toContain('Last week took');
        expect(shown[shown.length - 1]).not.toMatch(/undefined|NaN/);
        expect(game.nav.items.map(i => i.key)).toEqual(['streets', 'guild', 'market', 'coin']);
        window._uw.gang('cut', 0);
        expect(g2.cut).toBe(0.1);
        expect(notes[notes.length - 1].type).toBe('success');
    }, 180000);
});
