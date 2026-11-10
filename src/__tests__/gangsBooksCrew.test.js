// The gangs' books (systems/gangs.js: what each gang took and paid, by kind,
// last week and all time, matching its purse), and word to your crew from a
// cell (player/prison.js: the gaoler bribed, a breakout, the magistrate the
// gang keeps) — every coin from the gang's purse to a real one.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Gangs } from '../systems/gangs.js';
import { Underworld } from '../systems/underworld.js';
import { Prison } from '../player/prison.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(777));

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
        day, width: 40, generationParams: { seed: 91 }, units: [],
        kingdoms: Object.values(kingdoms),
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: id => kingdoms[id] || null,
        getSettlementViews: () => Object.values(tiles).map(t => t.settlement),
        getAllSettlements: () => Object.values(tiles).map(t => ({ q: t.q, r: t.r, ...t.settlement })),
        tiles,
    };
}

function makePlayer() {
    const p = new Player();
    p.gold = 2000;
    p.actionPoints = 100;
    p.inventory = {};
    p.q = 0; p.r = 0;
    p.reputation = { azurath: 0 };
    return p;
}

function contact(p, rank = 0) {
    const st = Underworld.ensure(p);
    st.guild.contactMet = true;
    st.guild.member = true;
    st.guild.rank = rank;
}

/** Every coin in the mock world. */
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

/** The player as boss of a crew of their own in the city, with a fat purse. */
function bossGame() {
    const w = makeWorld();
    const tile = city(w);
    const p = makePlayer();
    contact(p, 2);
    const res = Gangs.found(p, w, tile, 'The Test Knives');
    res.gang.purse = 3000;
    res.gang.crew = 12;
    return { w, tile, p, g: res.gang };
}

/** Arrested in the city, the way the watch does it. */
function arrest(p, w) {
    Underworld._arrest(p, w, city(w).settlement, 'theft');
    p.jailState.daysRemaining = 8;
    p.jailState.totalDays = 8;
    return p.jailState;
}

describe('the gangs\' books', () => {
    it('book every coin a gang takes and pays, by kind, and close the week', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        const gangs = Gangs.gangsAt(w, tile);
        const before = new Map(gangs.map(g => [g, g.purse - Gangs.bookTotal(Gangs.books(g).all.in) + Gangs.bookTotal(Gangs.books(g).all.out)]));
        for (let d = 50; d <= 50 + 7 * 6; d++) {
            w.day = d;
            Gangs.processDay(w, p);
        }
        for (const g of Gangs.gangsAt(w, tile)) {
            const b = Gangs.bookView(g);
            expect(b.weeks).toBeGreaterThanOrEqual(6);
            expect(b.last).not.toBeNull();
            expect(b.all.took).toBeGreaterThan(0);
            expect(b.all.in.protection).toBeGreaterThan(0);
            expect(b.all.out.wages).toBeGreaterThan(0);
            // The purse is what it started with, plus what it took, less what it paid
            if (before.has(g)) expect(Math.abs(g.purse - (before.get(g) + b.all.took - b.all.paid))).toBeLessThan(0.05);
            expect(g.stats.taken).toBeCloseTo(b.all.took, 1);
            expect(g.stats.paid).toBeCloseTo(b.all.paid, 1);
        }
    });

    it('book the boss\'s orders and your errands, and show them in the view', () => {
        const { w, tile, p, g } = bossGame();
        Gangs.bossAct(p, w, tile, 'hire', 2);
        Gangs.bossAct(p, w, tile, 'captain');
        Gangs.bossAct(p, w, tile, 'withdraw', 100);
        Gangs.bossAct(p, w, tile, 'deposit', 50);
        const b = Gangs.bookView(g);
        expect(b.cur.out.recruits).toBe(Gangs.cfg().recruitFee * 2);
        expect(b.cur.out.bribes).toBeGreaterThan(0);
        expect(b.cur.out.toYou).toBe(100);
        expect(b.cur.in.deposits).toBe(200 + 50);
        const v = Gangs.view(p, w, tile);
        const mine = v.gangs.find(x => x.id === g.id);
        expect(mine.books.cur.paid).toBeGreaterThan(100);
        for (const x of v.gangs) expect(x.books).toBeTruthy();
    });

    it('the books survive a save (plain data on the gang)', () => {
        const { g } = bossGame();
        Gangs._book(g, 'in', 'protection', 12.5);
        const copy = JSON.parse(JSON.stringify(g));
        expect(Gangs.bookView(copy).all.in.protection).toBe(12.5);
    });
});

describe('word to your crew', () => {
    it('no crew in the jail\'s town, no word', () => {
        const w = makeWorld();
        const p = makePlayer();
        arrest(p, w);
        expect(Prison.crew(p, w)).toBeNull();
        expect(Prison.crewOptions(p, w)).toEqual([]);
        expect(Prison.sendWord(p, w, 'bribe').success).toBe(false);
    });

    it('a hanger-on is refused; a soldier gets the gaoler bribed and owes the boss standing', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        contact(p);
        const g = Gangs.gangsAt(w, tile)[0];
        expect(Gangs.join(p, w, tile, g.id).success).toBe(true);
        g.purse = 2000;
        arrest(p, w);
        expect(Prison.crewOptions(p, w).find(o => o.id === 'bribe').can).toBe(false);
        const m = Gangs.membership(p, tile);
        m.rank = 1;
        m.standing = 30;
        const opt = Prison.crewOptions(p, w).find(o => o.id === 'bribe');
        expect(opt.can).toBe(true);
        const total = coin(w, p);
        const town = tile.settlement.economy.gold;
        const purse = g.purse;
        Utils.setRng(() => 0);
        const res = Prison.sendWord(p, w, 'bribe');
        Utils.resetRng();
        expect(res.success && res.released).toBe(true);
        expect(p.jailState).toBeNull();
        expect(g.purse).toBeCloseTo(purse - opt.cost, 2);
        expect(tile.settlement.economy.gold).toBeCloseTo(town + opt.cost, 2);
        expect(Gangs.bookView(g).cur.out.springing).toBe(opt.cost);
        expect(m.standing).toBe(20);
        expect(coin(w, p)).toBeCloseTo(total, 1);
    });

    it('a bribe gone wrong: the coin is spent, days are added, and it is once a day', () => {
        const { w, p, g } = bossGame();
        const jail = arrest(p, w);
        const purse = g.purse;
        Utils.setRng(() => 0.999);
        const res = Prison.sendWord(p, w, 'bribe');
        Utils.resetRng();
        expect(res.ok).toBe(false);
        expect(jail.daysRemaining).toBeGreaterThan(8);
        expect(g.purse).toBeLessThan(purse);
        expect(Prison.sendWord(p, w, 'breakout').success).toBe(false); // already had word today
        w.day += 1;
        expect(Prison.crewOptions(p, w).find(o => o.id === 'breakout').can).toBe(true);
    });

    it('the breakout: the men are paid into the town, some are lost, the crackdown rises, and it is a jailbreak', () => {
        const { w, tile, p, g } = bossGame();
        arrest(p, w);
        const total = coin(w, p);
        const crack = Gangs.crackdown(w, tile);
        const crew = g.crew;
        const opt = Prison.crewOptions(p, w).find(o => o.id === 'breakout');
        expect(opt.cost).toBeGreaterThan(0);
        Utils.setRng(() => 0);
        const res = Prison.sendWord(p, w, 'breakout');
        Utils.resetRng();
        expect(res.escaped).toBe(true);
        expect(p.jailState).toBeNull();
        expect(p.lastJailRelease.how).toBe('escaped');
        expect(Gangs.crackdown(w, tile)).toBeGreaterThan(crack);
        expect(g.crew).toBeLessThanOrEqual(crew);
        expect(Underworld.getHeat(p, 'azurath')).toBeGreaterThan(0);
        expect(coin(w, p)).toBeCloseTo(total, 1);
    });

    it('a failed breakout costs men, days and the lieutenants\' faith', () => {
        const { w, p, g } = bossGame();
        const jail = arrest(p, w);
        const crew = g.crew;
        const loyal = g.lieutenants.map(l => l.loyalty);
        Utils.setRng(() => 0.999);
        const res = Prison.sendWord(p, w, 'breakout');
        Utils.resetRng();
        expect(res.escaped).toBeFalsy();
        expect(jail.daysRemaining).toBeGreaterThan(8);
        expect(g.crew).toBeLessThan(crew);
        g.lieutenants.forEach((l, i) => expect(l.loyalty).toBeLessThan(loyal[i] + 0.001));
    });

    it('the magistrate the gang keeps dismisses the case, for his fee', () => {
        const { w, tile, p, g } = bossGame();
        arrest(p, w);
        expect(Prison.crewOptions(p, w).find(o => o.id === 'magistrate').can).toBe(false);
        expect(Gangs.bossAct(p, w, tile, 'magistrate').success).toBe(true);
        const mag = Gangs.watch(w, tile).magistrate;
        const held = mag.purse;
        const total = coin(w, p);
        const opt = Prison.crewOptions(p, w).find(o => o.id === 'magistrate');
        expect(opt.can).toBe(true);
        const res = Prison.sendWord(p, w, 'magistrate');
        expect(res.released).toBe(true);
        expect(p.jailState).toBeNull();
        expect(mag.purse).toBeCloseTo(held + opt.cost, 2);
        expect(coin(w, p)).toBeCloseTo(total, 1);
        expect(g.purse).toBeGreaterThan(0);
    });

    it('the cell offers word to the crew, and its scene renders', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { w, p } = bossGame();
        arrest(p, w);
        const panels = [];
        const notes = [];
        const game = { player: p, world: w, endDay() {}, ui: { showCustomPanel: (t, h) => panels.push(h), hideCustomPanel() {}, showNotification: (t, b) => notes.push(b), updateStats() {} } };
        ActionMenu.attemptJailbreak(game, 'cell');
        expect(panels[panels.length - 1]).toContain('Send word to your crew');
        ActionMenu.sceneAct(game, 'crew');
        expect(panels[panels.length - 1]).toContain('pay off the gaoler');
        for (const h of panels) expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
        Utils.setRng(() => 0);
        ActionMenu.sceneAct(game, 'crew:bribe');
        Utils.resetRng();
        expect(p.jailState).toBeNull();
        expect(notes.join(' ')).toMatch(/lost/);
    }, 180000);

    it('a member can\'t ask more of the purse than his rank is worth', () => {
        const w = makeWorld();
        const tile = city(w);
        const p = makePlayer();
        contact(p);
        const g = Gangs.gangsAt(w, tile)[0];
        Gangs.join(p, w, tile, g.id);
        Gangs.membership(p, tile).rank = 1;
        g.purse = 60;
        arrest(p, w);
        const opt = Prison.crewOptions(p, w).find(o => o.id === 'bribe');
        expect(opt.can).toBe(false);
        expect(opt.reason).toMatch(/purse|spend/);
    });
});
