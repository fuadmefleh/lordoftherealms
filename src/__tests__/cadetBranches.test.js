// Cadet branches (systems/cadetBranches.js): a grown younger child of the
// House founds a minor House of the blood — the coin moves, none is made —
// that lives on its own under the rival-House AI, whose loyalty drifts with
// how it is treated, and whose head can take up the mantle when the main
// line runs dry.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { CadetBranches, CADET_TYPE, LEVY_TYPE } from '../systems/cadetBranches.js';
import { Relationships } from '../systems/relationships.js';
import { Inheritance } from '../systems/inheritance.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { House } from '../systems/house.js';
import { DynastyTree } from '../systems/dynastyTree.js';
import { EstateSettlement } from '../player/estateSettlement.js';
import { Afterlife } from '../player/afterlife.js';
import { DataLoader } from '../core/dataLoader.js';
import { Estates } from '../world/estates.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const census = (game) => CoinCensus.total(game.world, game.player).total;

/** A child of the House of `age`. */
function kid(game, age, gender = null) {
    const c = Relationships.generateChild(game.player, { culture: 'Imperial' }, game.world, { quiet: true });
    c.age = age;
    if (gender) c.gender = gender;
    return c;
}

/** A game with an heir and a grown younger child ready to found a branch. */
function setup(seed) {
    const game = newGame(seed);
    endDay(game);
    const { player } = game;
    player.children = [];
    player.heir = null;
    const heir = kid(game, 24);
    player.heir = heir.id;
    const younger = kid(game, 20);
    Inheritance.setCoin(player, 3000);
    return { game, heir, younger };
}

/** Run only the branches' days (the rest of the world held still): cheap decades. */
function branchDays(game, n, opts = {}) {
    const out = [];
    for (let i = 0; i < n; i++) {
        game.world.day++;
        out.push(...CadetBranches.processDay(game.player, game.world, opts).notices);
    }
    return out;
}

describe('founding a cadet branch', () => {
    it('makes a House of the blood with the portion and the grant — coin moved, none made', () => {
        const { game, younger } = setup(901);
        const { player, world } = game;
        younger.purse = 300;
        const before = census(game);
        const coin0 = Inheritance.coin(player);
        const res = CadetBranches.found(player, world, younger.id, { grant: 500 });
        expect(res.success).toBe(true);
        const b = res.branch;
        expect(b.gold).toBe(800);
        expect(Inheritance.coin(player)).toBe(coin0 - 500);
        expect(younger.purse).toBe(0);
        expect(player.children.some(c => c.id === younger.id)).toBe(false);
        expect(census(game)).toBeCloseTo(before, 2);
        expect(b.name).toMatch(/^House .+ of .+/);
        expect(b.head.firstName).toBe(younger.firstName);
        expect(b.head.personId).toBe(younger.id);
        expect(b.seat).toMatchObject({ name: expect.any(String) });
        expect(b.loyalty).toBeGreaterThan(60);
        // the tree keeps them, as the head of the branch, after the heir in the line
        const tree = DynastyTree.build(player, world);
        const node = tree.nodes.find(n => n.id === younger.id);
        expect(node && node.cadet).toBe(b.id);
        expect(node.branch).toMatch(/head of/);
        expect(tree.succession[0]).toBe(player.heir);
        expect(tree.succession).toContain(younger.id);
        // a retinue rides out from the seat
        branchDays(game, 1);
        const u = CadetBranches.retinueOf(world, b);
        expect(u && u.type).toBe(CADET_TYPE);
    }, 120000);

    it('a founder who governs a holding gives the post up: the governor seat falls vacant', async () => {
        const { Holdings } = await import('../systems/holdings.js');
        const { game, younger } = setup(913);
        const { player, world } = game;
        const v = world.getSettlementViews()[0];
        player.settlements = [{ q: v.q, r: v.r }];
        const ref = Holdings.find(player, world, v.q, v.r);
        expect(ref).toBeTruthy();
        Holdings.ensure(ref.settlement).governor = { id: younger.id, kind: 'child', name: younger.firstName };
        const res = CadetBranches.found(player, world, younger.id);
        expect(res.success).toBe(true);
        expect(ref.settlement.holding.governor).toBe(null);
        expect(res.vacated).toMatch(/governorship/);
        expect(res.text).toContain(res.vacated);
    }, 120000);

    it('refuses the heir, a child too young, and a grant the purse cannot meet', () => {
        const { game, heir } = setup(902);
        const { player, world } = game;
        const small = kid(game, 12);
        expect(CadetBranches.found(player, world, heir.id).success).toBe(false);
        expect(CadetBranches.found(player, world, small.id).success).toBe(false);
        const grown = kid(game, 19);
        expect(CadetBranches.found(player, world, grown.id, { grant: 1e6 }).success).toBe(false);
        expect(CadetBranches.list(player)).toHaveLength(0);
    }, 120000);

    it('a grown child with a portion of their own may leave on their own at the year\'s end', () => {
        const { game, younger } = setup(903);
        const { player, world } = game;
        younger.age = 25;
        younger.purse = 600;
        const saved = DataLoader._gamedata.cadetBranches;
        DataLoader._gamedata.cadetBranches = { ...saved, leave: { ...saved.leave, chance: 1 } };
        try {
            world.day = 119;
            branchDays(game, 1);
        } finally {
            DataLoader._gamedata.cadetBranches = saved;
        }
        const b = CadetBranches.list(player)[0];
        expect(b && b.why).toBe('own');
        expect(b.gold).toBe(600);
        expect(player.children.some(c => c.id === younger.id)).toBe(false);
        expect(player.children.some(c => c.id === player.heir)).toBe(true);
    }, 120000);
});

describe('a branch lives on its own', () => {
    it('keeps a sane purse over decades: trades and sits at court, its heads die and are followed, branches sprout, within the cap', () => {
        const { game, younger } = setup(904);
        const { player, world } = game;
        younger.purse = 2000;
        const b = CadetBranches.found(player, world, younger.id, { grant: 0 }).branch;
        b.head.age = 70; // an old founder: the branch must pass on in these decades
        const saved = DataLoader._gamedata.cadetBranches;
        DataLoader._gamedata.cadetBranches = { ...saved, sub: { ...saved.sub, chance: 0.6, minGold: 300 } };
        try {
            branchDays(game, 120 * 30);
        } finally {
            DataLoader._gamedata.cadetBranches = saved;
        }
        const C = CadetBranches.config();
        const list = CadetBranches.list(player);
        expect(list.length).toBeGreaterThan(0);
        expect(list.length).toBeLessThanOrEqual(C.maxBranches);
        expect(b.stats.heads).toBeGreaterThan(1);
        let business = 0;
        for (const x of list) {
            expect(Number.isFinite(x.gold) && x.gold >= 0).toBe(true);
            expect(x.gold).toBeLessThan(1e6);
            expect(x.depth).toBeLessThanOrEqual(C.maxDepth);
            expect(x.loyalty).toBeGreaterThanOrEqual(0);
            expect(x.loyalty).toBeLessThanOrEqual(100);
            business += x.stats.trades + x.stats.courtVisits;
            expect(CadetBranches.retinueOf(world, x)).toBeTruthy();
        }
        expect(business).toBeGreaterThan(0);
        // the dead founder is closed in the tree; the living heads are of the blood
        const L = player.house.lineage;
        expect(L.people[younger.id].alive).toBe(false);
        for (const x of list) expect(L.people[x.head.personId] && L.people[x.head.personId].cadetHead).toBe(true);
        // one retinue a branch, none for branches gone
        const units = world.units.filter(u => u && u.type === CADET_TYPE && !u.destroyed);
        expect(units.length).toBe(list.length);
    }, 240000);
});

describe('loyalty', () => {
    it('rises with gifts (less for a second soon after), falls with asks and neglect; a loyal rich branch sends tribute', () => {
        const { game, younger } = setup(905);
        const { player, world } = game;
        const b = CadetBranches.found(player, world, younger.id, { grant: 0 }).branch;
        b.loyalty = 50;
        const g1 = CadetBranches.gift(player, world, b.id, 300);
        expect(g1.success).toBe(true);
        expect(b.loyalty).toBe(62);
        const g2 = CadetBranches.gift(player, world, b.id, 300);
        expect(g2.gain).toBe(6);
        expect(b.gold).toBe(600);
        // asking for gold moves coin back and costs loyalty
        const before = census(game);
        const coin = Inheritance.coin(player);
        const ask = CadetBranches.askGold(player, world, b.id);
        expect(ask.success).toBe(true);
        expect(Inheritance.coin(player)).toBe(coin + ask.amount);
        expect(b.loyalty).toBe(68 - 8);
        expect(census(game)).toBeCloseTo(before, 2);
        expect(CadetBranches.askGold(player, world, b.id).success).toBe(false); // too soon
        // a year of neglect wears it down
        const l0 = b.loyalty;
        b.lastContact = world.day - 400;
        world.day = 119;
        branchDays(game, 1);
        expect(b.loyalty).toBeLessThan(l0);
        // tribute from a loyal, rich branch
        b.loyalty = 90;
        b.gold = 5000;
        b.lastTribute = -1e9;
        const c2 = Inheritance.coin(player);
        world.day = 125;
        branchDays(game, 1);
        expect(Inheritance.coin(player)).toBeGreaterThan(c2);
        expect(b.stats.tribute).toBeGreaterThan(0);
    }, 120000);

    it('a branch treated badly breaks away, contests the succession, and can be won back', () => {
        const { game, younger } = setup(906);
        const { player, world } = game;
        const b = CadetBranches.found(player, world, younger.id).branch;
        b.loyalty = 10;
        world.day = 139;
        const notices = branchDays(game, 1);
        expect(b.estranged).toBe(true);
        expect(b.feud).toBe(80);
        expect(notices.some(n => /Breaks Away/.test(n.title))).toBe(true);
        expect(House._maxRivalFeud(player.house)).toBeGreaterThanOrEqual(80);
        expect(CadetBranches.askMen(player, world, b.id).success).toBe(false);
        // falling on their retinue makes it worse
        const unit = CadetBranches.retinueOf(world, b);
        CadetBranches.onAttacked(player, world, unit, true);
        expect(b.loyalty).toBe(0);
        // gifts win them back
        Inheritance.setCoin(player, 10000);
        for (let i = 0; i < 4; i++) { b.lastGiftDay = -1e9; CadetBranches.gift(player, world, b.id, 1000); }
        expect(b.loyalty).toBeGreaterThanOrEqual(35);
        world.day = 146;
        branchDays(game, 1);
        expect(b.estranged).toBe(false);
        expect(b.feud).toBe(0);
    }, 120000);

    it('sends men to a war, paid out of its own purse, and they go home when their time is up', () => {
        const { game, younger } = setup(907);
        const { player, world } = game;
        const b = CadetBranches.found(player, world, younger.id, { grant: 1500 }).branch;
        b.loyalty = 80;
        const res = CadetBranches.askMen(player, world, b.id);
        expect(res.success).toBe(true);
        expect(player.army.some(u => u.type === LEVY_TYPE && u.cadetId === b.id)).toBe(true);
        const g0 = b.gold;
        world.day = Math.ceil((world.day + 1) / 7) * 7 - 1;
        branchDays(game, 1);
        expect(b.gold).toBeLessThan(g0 + 200); // wages paid out of the purse (dues come in too)
        world.day = res.unit.until;
        branchDays(game, 1);
        expect(player.army.some(u => u.type === LEVY_TYPE)).toBe(false);
    }, 120000);
});

describe('succession falls to the cadet line', () => {
    it('with no heir of the main line, the nearest branch\'s head takes up the mantle with its purse, land and children', () => {
        const { game, younger, heir } = setup(908);
        const { player, world } = game;
        younger.purse = 400;
        const b = CadetBranches.found(player, world, younger.id, { grant: 600 }).branch;
        b.head.children = [{ firstName: 'Osric', gender: 'male', age: 3 }];
        // an estate for the branch, if this world keeps them
        let estate = null;
        if (world.estates && Estates.enabled()) {
            estate = Object.values(world.estates.estates).find(e => e && e.holder !== 'player');
            if (estate) Estates.setHolder(world, estate, b.landKey);
        }
        // the main line dies out
        heir.isAlive = false;
        player.children = player.children.filter(c => c.isAlive);
        expect(EstateSettlement.heirless(player)).toBe(false);
        const before = census(game);
        const res = CadetBranches.succeed(player, world, b.id, { cause: 'old age' });
        expect(res.success).toBe(true);
        expect(player.firstName).toBe(younger.firstName);
        expect(res.cadet.gold).toBe(1000);
        expect(CadetBranches.list(player)).toHaveLength(0);
        expect(player.children.some(c => c.firstName === 'Osric' && !c.isSibling)).toBe(true);
        expect(player.heir).toBeTruthy();
        if (estate) expect(estate.holder).toBe('player');
        expect(world.units.some(u => u && u.type === CADET_TYPE && !u.destroyed)).toBe(false);
        expect(census(game)).toBeCloseTo(before, 0);
        expect(player.house.lineage.currentId).toBe(younger.id);
    }, 120000);

    it('in the interregnum the branches live on, the estate waits unsettled, and a branch head can return', () => {
        const { game, younger, heir } = setup(909);
        const { player, world } = game;
        const b = CadetBranches.found(player, world, younger.id, { grant: 300 }).branch;
        heir.isAlive = false;
        player.children = [];
        Afterlife.begin(player, world, 'old age');
        expect(EstateSettlement.settled(player)).toBe(null);
        world.day++;
        CadetBranches.processDay(player, world, { interregnum: true });
        expect(b.lastDay).toBe(world.day);
        expect(Afterlife.cadetsReady(player)[0]).toBe(b);
        const res = Afterlife.returnAsCadet(player, world, b.id);
        expect(res.success).toBe(true);
        expect(player.interregnum).toBeUndefined();
        expect(player.firstName).toBe(younger.firstName);
    }, 120000);

    it('a new life taken with branches out in the world dissolves them, their coin spent at their seats', () => {
        const { game, younger } = setup(910);
        const { player, world } = game;
        const b = CadetBranches.found(player, world, younger.id, { grant: 300 }).branch;
        const before = census(game);
        CadetBranches.dissolve(player, world);
        expect(b.ended).toBe(true);
        expect(b.gold).toBe(0);
        expect(CadetBranches.list(player)).toHaveLength(0);
        expect(census(game)).toBeCloseTo(before, 2);
    }, 120000);
});

describe('save and load', () => {
    it('keeps the branches, their loyalty and their retinues', () => {
        const { game, younger } = setup(911);
        const b = CadetBranches.found(game.player, game.world, younger.id, { grant: 500 }).branch;
        b.loyalty = 57;
        for (let i = 0; i < 10; i++) endDay(game);
        const g = b.gold;
        const loaded = roundTrip(game);
        const b2 = CadetBranches.get(loaded.player, b.id);
        expect(b2).toBeTruthy();
        expect(b2.name).toBe(b.name);
        expect(b2.loyalty).toBe(b.loyalty);
        expect(b2.gold).toBeCloseTo(g, 2);
        expect(b2.head.firstName).toBe(younger.firstName);
        const u = CadetBranches.retinueOf(loaded.world, b2);
        expect(u && u.type).toBe(CADET_TYPE);
        endDay(loaded);
        expect(CadetBranches.retinueOf(loaded.world, b2)).toBeTruthy();
    }, 240000);
});

describe('the panels', () => {
    it('draws the branches, the founding choice and the cadet line on the deathbed', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { game, younger, heir } = setup(912);
        const { player, world } = game;
        const panels = [];
        game.ui = { showCustomPanel: (title, html) => panels.push({ title, html }), showNotification: () => {}, hideCustomPanel: () => {}, updateStats: () => {} };
        const other = kid(game, 19);
        const b = CadetBranches.found(player, world, younger.id, { grant: 200 }).branch;
        ActionMenu.showCadetBranches(game);
        let p = panels.pop();
        expect(p.html).toContain(b.name.replace(/'/g, '&#39;'));
        expect(p.html).toContain('cadetAct');
        expect(p.html).toContain(other.firstName);
        ActionMenu.showCadetFound(game, other.id);
        p = panels.pop();
        expect(p.html).toContain('cadetFound');
        ActionMenu.cadetAct(game, b.id, 'gift', 100);
        expect(b.stats.gifts).toBe(100);
        heir.isAlive = false;
        other.isAlive = false;
        ActionMenu.showDeathScreen(game, 'old age');
        p = panels.pop();
        expect(p.html).toContain('The Cadet Line');
        expect(p.html).toContain(`_succeedAsCadet('${b.id}')`);
    }, 120000);
});
