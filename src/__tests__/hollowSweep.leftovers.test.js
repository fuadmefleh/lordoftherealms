// Hollow sweep leftovers (TODO.md, after sweep 24): street-map mining draws the
// hex's deposit down, a companion's hp matters, display-only stats are shown,
// and a broke crown's lair bounty is a writ, not coin from nothing.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Stewards } from '../systems/stewards.js';
import { Mints } from '../systems/mints.js';
import { InnerMap } from '../world/innerMap.js';
import { Mines } from '../world/innerMap/mines.js';
import { Hinterland } from '../world/hinterland.js';
import { Climate } from '../world/climate.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Crises } from '../systems/crises.js';
import { Hearsay } from '../systems/hearsay.js';
import { Pressure } from '../systems/pressure.js';
import { HoldingSieges } from '../systems/holdingSieges.js';
import { InnerMapMining } from '../ui/innerMapMining.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
}, 60000);

afterEach(() => {
    InnerMap._insideBuilding = null;
    InnerMap._mineWorld = null;
});

/** Underground in hex 4,4 of a world whose hinterland works an iron mine there. */
function ironHex(res = 10) {
    const site = { id: '4,4', q: 4, r: 4, h: '5,5', kind: 'iron_mine', st: 'open', res, res0: 100 };
    const world = { day: 10, hinterland: { sites: [site] }, mines: {} };
    InnerMap._mineWorld = world;
    InnerMap._insideBuilding = { type: 'mine', _underground: { kind: 'adit', key: Mines.siteKey('adit', 1, 1), hexKey: '4,4' } };
    return { world, site };
}

describe('street-map mining draws the hex\'s deposit down (world/innerMap/mines.js → Hinterland.deplete)', () => {
    it('ore of the deposit\'s good comes out of its reserve; other goods leave it be', () => {
        const { site } = ironHex(10);
        expect(InnerMap.mineDeposit('ore').left).toBeCloseTo(9.98, 5);
        const r = InnerMap.mineCredit('ore', 3);
        expect(r.drawn).toBe(3);
        expect(site.res).toBe(7);
        expect(InnerMap.mineCredit('coal', 2)).toBeNull();
        expect(site.res).toBe(7);
        expect(InnerMap.mineHere().site.got).toEqual({ ore: 3, coal: 2 });
        expect(InnerMap.mineHere().site.drawn).toBe(3);
    });

    it('a deposit dug to its scrapings is barren to the pick; its own market turn closes it', () => {
        const { site } = ironHex(5);
        const before = Hinterland.yieldOf(site);
        InnerMap.mineCredit('ore', 50);
        expect(site.res).toBeCloseTo(0.02, 5);
        expect(site.st).toBe('open');
        expect(InnerMap.mineDeposit('ore').left).toBe(0);
        expect(Hinterland.yieldOf(site)).toBeLessThan(before);
        // (the concession's next turn draws the last and marks it exhausted)
        expect(Hinterland.deplete(site, 1)).toBe('exhausted');
        expect(InnerMap.mineDeposit('ore').left).toBe(0);
    });

    it('a hex with no deposit of the good: nothing to draw', () => {
        InnerMap._mineWorld = { day: 1, hinterland: { sites: [] }, mines: {} };
        InnerMap._insideBuilding = { type: 'mine', _underground: { kind: 'adit', key: Mines.siteKey('adit', 1, 1), hexKey: '9,9' } };
        expect(InnerMap.mineDeposit('ore')).toBeNull();
        expect(InnerMap.mineCredit('ore', 2)).toBeNull();
    });

    it('the way out and the barren vein have their words in data/mining.json', () => {
        const T = InnerMapMining.config().text;
        expect(T.leave).toBeTruthy();
        expect(T.workedOut).toBeTruthy();
    });
});

describe('a companion\'s hp (systems/animalCompanions.js)', () => {
    it('a breed\'s hp over its kind\'s; hits come off health as a share of it', () => {
        const player = { q: 1, r: 1 };
        const st = AnimalCompanions.state(player);
        const mutt = { id: 'a1', name: 'Bran', species: 'dog', breed: 'mutt', health: 100, bond: 80, hunger: 80 };
        const mastiff = { id: 'a2', name: 'Grip', species: 'dog', breed: 'mastiff', health: 100, bond: 80, hunger: 80 };
        const cat = { id: 'a3', name: 'Tib', species: 'cat', breed: 'tabby', health: 100, bond: 80, hunger: 80 };
        st.list.push(mutt, mastiff, cat);
        expect(AnimalCompanions.maxHp(mutt)).toBe(30);
        expect(AnimalCompanions.maxHp(mastiff)).toBe(45);
        expect(AnimalCompanions.maxHp(cat)).toBe(12);
        AnimalCompanions.wound(player, 'a1', 15);
        AnimalCompanions.wound(player, 'a2', 15);
        expect(mutt.health).toBeCloseTo(50, 5);
        expect(mastiff.health).toBeGreaterThan(mutt.health);
        expect(AnimalCompanions.hpOf(mutt)).toBe(15);
        // What kills a cat outright
        expect(AnimalCompanions.wound(player, 'a3', 12)).toBe(true);
        expect(st.list.includes(cat)).toBe(false);
        const H = AnimalCompanions.streetHurt();
        expect(H.chance).toBeGreaterThan(0);
        expect(H.npc[1]).toBeGreaterThanOrEqual(H.npc[0]);
    });
});

describe('a broke crown\'s lair bounty is a writ, not coin from nothing (systems/bountyHunting.js)', () => {
    it('pays what the crown and the town hold; the rest is owed and collected as the chests fill', () => {
        const k = { id: 'k1', name: 'Arden', isAlive: true, treasury: 50 };
        const town = { name: 'Ashford', economy: { gold: 30 } };
        const world = { day: 100, kingdoms: [k], getTile: (q, r) => (q === 3 && r === 4 ? { settlement: town } : null) };
        const player = { gold: 0 };
        BountyHunting.initialize(player);
        const bounty = { id: 'b1', kingdomId: 'k1', fromQ: 3, fromR: 4, targetName: 'Black Wat' };
        const paid = BountyHunting._payLairBounty(world, bounty, 120);
        expect(paid).toBe(80);
        expect(k.treasury).toBe(0);
        expect(town.economy.gold).toBe(0);
        const writ = BountyHunting.owe(player, world, bounty, 120 - paid);
        expect(writ.amount).toBe(40);
        expect(BountyHunting.owedTotal(player)).toBe(40);
        // Nothing in the chests: nothing paid, the writ stands
        const u0 = { chiefs: [] };
        BountyHunting._settleWrits(player, world, u0);
        expect(player.gold).toBe(0);
        expect(u0.chiefs).toEqual([]);
        // Part in: paid on account
        k.treasury = 25;
        const u1 = { chiefs: [] };
        BountyHunting._settleWrits(player, world, u1);
        expect(player.gold).toBe(25);
        expect(u1.chiefs[0]).toMatchObject({ outcome: 'writPart', pay: 25, left: 15 });
        // The rest: paid off and gone
        k.treasury = 500;
        const u2 = { chiefs: [] };
        BountyHunting._settleWrits(player, world, u2);
        expect(player.gold).toBe(40);
        expect(k.treasury).toBe(485);
        expect(u2.chiefs[0].outcome).toBe('writPaid');
        expect(BountyHunting.owedTotal(player)).toBe(0);
    });

    it('a writ on a fallen realm is worthless', () => {
        const k = { id: 'k2', name: 'Morrow', isAlive: true, treasury: 0 };
        const world = { day: 10, kingdoms: [k], getTile: () => null };
        const player = { gold: 0 };
        BountyHunting.initialize(player);
        BountyHunting.owe(player, world, { id: 'b2', kingdomId: 'k2', targetName: 'Red Jack' }, 60);
        k.isAlive = false;
        const u = { chiefs: [] };
        BountyHunting._settleWrits(player, world, u);
        expect(u.chiefs[0]).toMatchObject({ outcome: 'writLapsed', left: 60 });
        expect(BountyHunting.owedTotal(player)).toBe(0);
        expect(player.gold).toBe(0);
    });
});

describe('display-only stats reach their panels', () => {
    it('crisis acts: the player\'s part in words, and a count per crisis on record', () => {
        const player = { crises: { acts: [{ uid: 'plague1', id: 'physicians', day: 130 }, { uid: 'plague1', id: 'flee', day: 140 }, { uid: 'rush2', id: 'stake', day: 900 }], sides: {} } };
        const acts = Crises.actsOf(player, 'plague1');
        expect(acts.map(a => a.id)).toEqual(['flee', 'physicians']);
        expect(acts[1].label).toMatch(/physicians/);
        const v = Crises.view(player, { day: 1000, crises: { active: null, history: [], nextDay: 2000 } });
        expect(v.actsIn).toEqual({ plague1: 2, rush2: 1 });
    });

    it('hearsay: the tales told of yourself and the times caught, and how long a tale has been about', () => {
        const player = { name: 'Bran', hearsay: { nextId: 2, npcs: {}, claims: [], stats: { claims: 4, caught: 1 }, rumours: [{ id: 1, k: 'claim', tp: 'origin', v: 'a smith', te: 'Ada', on: 'Ashford', d: 40, towns: { '3,4': { d: 40, r: 0.4, l: 0 } } }] } };
        const v = Hearsay.view(player, { day: 50, getTile: () => null }, '3,4');
        expect(v.stats).toEqual({ claims: 4, caught: 1 });
        expect(v.here[0].sinceText).toBe('10 days ago');
    });

    it('pressure clocks: progress, heat and firings for the Threats panel', () => {
        const holder = {};
        expect(Pressure.describe(holder, 'siege')).toBeNull();
        Pressure.wind(holder, 'siege', 1, 100, { days: 7, seed: 1 });
        holder.clock.fired = 2;
        holder.clock.heat = 1.5;
        const d = Pressure.describe(holder, 'siege', 1);
        expect(d.progress).toBeGreaterThan(0);
        expect(d).toMatchObject({ fired: 2, heat: 1.5 });
        expect(HoldingSieges.clockView({}, { day: 1 })).toBeNull();
        const player = { realmWars: { siegeClock: { ...holder, cooldownUntil: 300, pending: null, log: [{ day: 90, text: 'Arden marched on Hope' }] } } };
        const c = HoldingSieges.clockView(player, { day: 120, generationParams: { seed: 1 } });
        expect(c).toMatchObject({ fired: 2, cooldownUntil: 300 });
        expect(c.log[0].text).toMatch(/Arden/);
    });

    it('the panels render the records: stewards, mints, crises, hearsay, threats, abdication', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const game = newGame(7);
        const { player, world } = game;
        let shown = null;
        game.ui = { showCustomPanel: (title, html) => { shown = { title, html }; }, showNotification: () => {}, updateStats: () => {}, setPanelNav: () => {} };
        const st = Stewards.state(player);
        st.stats.appointed = 3;
        st.stats.worksStarted = 2;
        ActionMenu.showStewards(game, 'reports');
        expect(shown.html).toMatch(/record with its stewards/);
        expect(shown.html).toMatch(/Works begun/);
        const ms = Mints.state(player);
        ms.stats.sold = 4; ms.stats.soldGold = 90; ms.stats.passed = 2; ms.stats.counterfeitGain = 70;
        ms.log.push({ day: 3, text: 'Sold gold ore to the mint.' });
        ActionMenu.showMint(game, null, 'coin');
        expect(shown.html).toMatch(/Your dealings with the mints/);
        expect(shown.html).toMatch(/Trust/);
        Crises.playerState(player).acts.push({ uid: 'x1', id: 'relief', day: 5 });
        ActionMenu.showCrisesPanel(game);
        expect(shown.title).toMatch(/Age/);
        Hearsay.state(player).stats.claims = 3;
        ActionMenu.showHearsay(game);
        expect(shown.html).toMatch(/Tales of yourself told/);
        player.realmWars = player.realmWars || {};
        player.realmWars.siegeClock = { clock: { charge: 0.3, fired: 1, heat: 1, lastDay: 1 }, cooldownUntil: 0, pending: null, log: [{ day: 2, text: 'Arden was paid off' }] };
        ActionMenu.showThreatsPanel(game);
        expect(shown.html).toMatch(/Covetous realms/);
        expect(shown.html).toMatch(/Arden was paid off/);
        ActionMenu.showAbdication(game);
        expect(shown.html).toBeTruthy();
    }, 120000);

    it('climate: the era\'s kind ("Little Ice Age") is named beside its own name', () => {
        const H = 60;
        const tiles = new Map();
        const mk = (seed) => ({
            day: 1, width: 80, height: H, baseYear: 900, generationParams: { seed },
            getTile(q, r) {
                if (r < 0 || r >= H) return null;
                const k = `${q},${r}`;
                if (!tiles.has(k)) tiles.set(k, { q, r, temperature: 0.1 + (1 - Math.abs(r / H - 0.5) * 2) * 0.75, moisture: 0.5, terrain: { id: 'plains', passable: true } });
                return tiles.get(k);
            },
        });
        let w = null, e = null;
        for (let seed = 1; seed < 300 && !e; seed++) {
            w = mk(seed);
            e = Climate.eras(w, 2000).find(x => x.kind === 'cold');
        }
        expect(e).toBeTruthy();
        const mid = Math.round(((e.from + e.to) / 2) * 120) + 1;
        const d = Climate.describe(w, 10, 20, mid);
        expect(d.label).toBe(Climate.config().kinds.cold.label);
        expect(d.text).toContain(d.label);
    });
});
