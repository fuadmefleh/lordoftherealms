// Sieges of the player's holdings (systems/holdingSieges.js): a war host that
// reaches a holding invests it, the daily tick of both sides, the player's
// options (relieve, supply, sally, terms, buy off, peace, yield), the endings,
// and the save backfill.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { HoldingSieges } from '../systems/holdingSieges.js';
import { RealmWars } from '../systems/realmWars.js';
import { Holdings } from '../systems/holdings.js';
import { Economy } from '../world/economy.js';
import { WorldUnit } from '../world/units.js';
import { Relationships } from '../systems/relationships.js';
import { House } from '../systems/house.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const cfgBackup = [];
function tune(path, value) {
    const keys = path.split('.');
    let o = HoldingSieges.config();
    for (const k of keys.slice(0, -1)) o = o[k];
    cfgBackup.push([o, keys[keys.length - 1], o[keys[keys.length - 1]]]);
    o[keys[keys.length - 1]] = value;
}
afterEach(() => {
    while (cfgBackup.length) {
        const [o, k, v] = cfgBackup.pop();
        o[k] = v;
    }
    Utils.resetRng();
});

/** Plains, a kingdom k1 with a town at (12,12), our colony at (5,5). */
function makeWorld(day = 50) {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 16; q++) {
        for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    }
    const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, treasury: 500, territory: [{ q: 12, r: 12 }], population: 5000 };
    tiles.get('12,12').settlement = { name: 'Varrholt', type: 'town', q: 12, r: 12, kingdom: 'k1', population: 2000 };
    return {
        day,
        width: 16,
        kingdoms: [kingdom],
        units: [],
        events: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
    };
}

function makePlayer(world) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male',
        gold: 10000, renown: 20, karma: 0, reputation: { k1: 0 }, properties: [], colonies: [], children: [],
        inventory: { bread: 100 }, army: [], q: 0, r: 0, taxRate: 'moderate',
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    return player;
}

function ownColony(world, player, q = 5, r = 5) {
    const settlement = {
        name: 'Newhope', type: 'village', population: 400, level: 1, kingdom: null, happiness: 60,
        colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 10 },
    };
    Economy.initSettlement(settlement);
    world.getTile(q, r).settlement = settlement;
    player.colonies.push({ q, r, name: settlement.name, foundedDay: 0 });
    Holdings.processDay(player, world);
    return settlement;
}

function soldiers(n) {
    const def = Object.values(PlayerMilitary.UNIT_TYPES).find(u => u.id === 'soldier');
    return Array.from({ length: n }, () => PlayerMilitary.makeArmyUnit(def));
}

/** A war, and a host of `strength` standing on the colony: the next RealmWars tick invests it. */
function hostAtColony(world, player, strength = 80) {
    const kingdom = world.kingdoms[0];
    const war = RealmWars.declareWar(player, world, kingdom);
    war.lastHostDay = world.day; // no new host today
    const rec = { id: 'wh_test', name: 'Varr War Host', q: 5, r: 5, targetQ: 5, targetR: 5, target: { kind: 'colony', q: 5, r: 5, name: 'Newhope' }, strength };
    war.hosts.push(rec);
    RealmWars._spawnUnit(world, kingdom, rec);
    return { kingdom, war, rec };
}

function besiege(strength = 80) {
    const world = makeWorld();
    const player = makePlayer(world);
    const settlement = ownColony(world, player);
    const { kingdom, war, rec } = hostAtColony(world, player, strength);
    const out = RealmWars.processDaily(player, world);
    const siege = HoldingSieges.at(player, 5, 5);
    return { world, player, settlement, kingdom, war, rec, out, siege, unit: world.units.find(u => u.id === rec.id) };
}

function drawsDuring(fn) {
    const base = Utils.getRng();
    let n = 0;
    Utils.setRng(() => { n++; return base(); });
    try { fn(); } finally { Utils.setRng(base); }
    return n;
}

describe('HoldingSieges — the siege begins', () => {
    it('draws no randomness without a besieged holding, even at war', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        ownColony(world, player);
        expect(drawsDuring(() => HoldingSieges.processDay(world, player))).toBe(0);
        RealmWars.declareWar(player, world, world.kingdoms[0]);
        expect(drawsDuring(() => HoldingSieges.processDay(world, player))).toBe(0);
    });

    it('a war host that reaches a holding invests it instead of a single roll', () => {
        const { player, settlement, out, siege, unit, war } = besiege(80);
        expect(siege).toBeTruthy();
        expect(out.struck.some(s => s.siege)).toBe(true);
        expect(settlement.colony.isPlayerColony).toBe(true);   // not taken yet
        expect(unit.destroyed).toBe(false);                     // the host camps on the tile
        expect(war.hosts[0].besieging).toBe('5,5');
        expect(siege.besiegers).toBe(80);
        expect(siege.garrison).toBeGreaterThan(0);
        expect(siege.stores).toBeGreaterThan(0);
        expect(siege.morale).toBeGreaterThan(0);
        expect(HoldingSieges.list(player)).toHaveLength(1);
        expect(HoldingSieges.state(player).siegeStats.besieged).toBe(1);
    });

    it('a second host joins the siege already there', () => {
        const { world, player, kingdom, war, siege } = besiege(80);
        const rec2 = { id: 'wh_two', name: 'Second Host', q: 5, r: 5, targetQ: 5, targetR: 5, target: { kind: 'colony', q: 5, r: 5, name: 'Newhope' }, strength: 40 };
        war.hosts.push(rec2);
        const unit2 = RealmWars._spawnUnit(world, kingdom, rec2);
        const res = HoldingSieges.begin(player, world, kingdom, war, rec2, unit2);
        expect(res.joined).toBe(true);
        expect(siege.besiegers).toBe(120);
        expect(unit2.destroyed).toBe(true);
        expect(war.hosts.find(h => h.id === 'wh_two')).toBeFalsy();
    });

    it('walls, a governor and a happy, loyal town make stouter defenders', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const s = ownColony(world, player);
        const plain = HoldingSieges.moraleOf(s);
        s.holding.built.palisade = 1;
        s.holding.governor = { name: 'Marta', martial: 5, intrigue: 2, stewardship: 3, loyalty: 80 };
        Holdings.refresh(s);
        expect(HoldingSieges.wallsOf(s)).toBeGreaterThan(0);
        expect(HoldingSieges.moraleOf(s)).toBeGreaterThan(plain);
        s.happiness = 10;
        s.colony.loyalty = 10;
        expect(HoldingSieges.moraleOf(s)).toBeLessThan(plain + 20);
    });
});

describe('HoldingSieges — each day', () => {
    it('stores fall, morale sinks and the besiegers bring up a ram', () => {
        const { world, player, siege } = besiege(30);
        tune('storm.after', 999);
        const stores = siege.stores;
        const morale = siege.morale;
        const notices = [];
        for (let i = 0; i < HoldingSieges.config().ramDays; i++) {
            world.day++;
            notices.push(...HoldingSieges.processDay(world, player).notices);
        }
        expect(siege.stores).toBeLessThan(stores);
        expect(siege.morale).toBeLessThan(morale);
        expect(siege.ramBuilt).toBe(true);
        expect(notices.some(n => /Siege Works/.test(n.title))).toBe(true);
        expect(siege.besiegerStores).toBeLessThan(HoldingSieges.config().besiegers.stores[1]);
    });

    it('a starving, broken town falls: the enemy takes it through the capture path', () => {
        const { world, player, settlement, siege, war, kingdom, unit } = besiege(80);
        const military = kingdom.military;
        siege.stores = 0;
        siege.morale = 1;
        world.day++;
        const out = HoldingSieges.processDay(world, player);
        expect(out.ended[0].outcome).toBe('fallen');
        expect(settlement.kingdom).toBe('k1');
        expect(settlement.colony.isPlayerColony).toBe(false);
        expect(player.colonies).toHaveLength(0);
        expect(war.holdingsLost).toBe(1);
        expect(unit.destroyed).toBe(true);
        expect(kingdom.military).toBeGreaterThan(military);
        expect(player.house.history.some(c => c.tags.includes('siege') && /After/.test(c.text))).toBe(true);
        // ...and Holdings sees it lost the next day
        const h = Holdings.processDay(player, world);
        expect(h.lost).toHaveLength(1);
        expect(HoldingSieges.list(player)).toHaveLength(0);
    });

    it('besiegers who starve and lose heart give up: the holding held', () => {
        const { world, player, siege, war, kingdom, unit, settlement } = besiege(80);
        const military = kingdom.military;
        const score = war.score;
        const loyalty = settlement.colony.loyalty;
        siege.besiegerStores = 0;
        siege.besiegerMorale = 2;
        tune('storm.after', 999);
        world.day++;
        const out = HoldingSieges.processDay(world, player);
        expect(out.ended[0].outcome).toBe('held');
        expect(war.score).toBe(score + HoldingSieges.config().outcome.heldScore);
        expect(unit.destroyed).toBe(true);
        expect(kingdom.military).toBeGreaterThan(military);
        expect(settlement.colony.loyalty).toBeGreaterThan(loyalty);
        expect(war.hosts).toHaveLength(0);
    });

    it('a storm with overwhelming numbers carries the walls', () => {
        const { world, player, settlement, siege } = besiege(600);
        siege.ramBuilt = true;
        tune('storm.after', 0);
        tune('storm.strongChance', 1);
        world.day++;
        const out = HoldingSieges.processDay(world, player);
        expect(out.ended[0].outcome).toBe('fallen');
        expect(settlement.kingdom).toBe('k1');
    });
});

describe("HoldingSieges — the player's options", () => {
    it('relieving it: your army breaks the besiegers at the holding with the usual combat', () => {
        const { world, player, siege, war, settlement } = besiege(30);
        player.army = soldiers(40);
        player.q = 5; player.r = 5;
        const score = war.score;
        const loyalty = settlement.colony.loyalty;
        const res = HoldingSieges.relieve(player, world, siege.key);
        expect(res.success).toBe(true);
        expect(res.victory).toBe(true);
        expect(HoldingSieges.list(player)).toHaveLength(0);
        expect(war.score).toBe(score + RealmWars.CONFIG.scorePerHostDefeated);
        expect(settlement.colony.loyalty).toBeGreaterThan(loyalty);
        expect(HoldingSieges.state(player).siegeStats.relieved).toBe(1);
    });

    it('relief needs your army at the holding', () => {
        const { world, player, siege } = besiege(30);
        player.army = soldiers(10);
        expect(HoldingSieges.relieve(player, world, siege.key).success).toBe(false);
    });

    it('a supply caravan brings food and gold into the town in days', () => {
        const { world, player, siege } = besiege(30);
        tune('supply.caravanCatch', 0);
        tune('storm.after', 999);
        const res = HoldingSieges.sendSupplies(player, world, siege.key, { food: 40, gold: 200, via: 'caravan' });
        expect(res.success).toBe(true);
        expect(player.inventory.bread).toBe(60);
        expect(player.gold).toBe(10000 - 200);
        const garrison = siege.garrison;
        let stores = siege.stores;
        for (let i = 0; i < res.days; i++) {
            stores = siege.stores;
            world.day++;
            HoldingSieges.processDay(world, player);
        }
        expect(siege.convoys).toHaveLength(0);
        expect(siege.stores).toBeGreaterThan(stores);
        expect(siege.garrison).toBeGreaterThan(garrison - 2);
    });

    it('a ship needs a port and a ship; caught supplies feed the besiegers', () => {
        const { world, player, siege } = besiege(30);
        expect(HoldingSieges.sendSupplies(player, world, siege.key, { food: 10, via: 'ship' }).success).toBe(false);
        tune('supply.caravanCatch', 1);
        tune('storm.after', 999);
        const res = HoldingSieges.sendSupplies(player, world, siege.key, { food: 40, via: 'caravan' });
        const bStores = siege.besiegerStores;
        for (let i = 0; i < res.days; i++) {
            world.day++;
            HoldingSieges.processDay(world, player);
        }
        expect(siege.besiegerStores).toBeGreaterThan(bStores - res.days);
    });

    it('the governor sallies: a won sally cuts up the lines and burns the ram; then it must wait', () => {
        const { world, player, siege } = besiege(30);
        siege.garrison = 200;
        siege.ramBuilt = true;
        const before = siege.besiegers;
        const res = HoldingSieges.sally(player, world, siege.key);
        expect(res.success).toBe(true);
        expect(res.won).toBe(true);
        expect(siege.besiegers).toBeLessThan(before);
        expect(siege.ramBuilt).toBe(false);
        expect(HoldingSieges.sally(player, world, siege.key).success).toBe(false);
    });

    it('the governor treats with the besiegers: if they accept, gold sends them home', () => {
        const { world, player, siege, kingdom } = besiege(30);
        tune('terms.min', 1);
        tune('terms.max', 1);
        const price = HoldingSieges.termsPrice(siege);
        const military = kingdom.military;
        const res = HoldingSieges.negotiate(player, world, siege.key);
        expect(res.accepted).toBe(true);
        expect(player.gold).toBe(10000 - price);
        expect(kingdom.military).toBeGreaterThan(military);
        expect(HoldingSieges.list(player)).toHaveLength(0);
    });

    it('refused terms put off the next parley and dishearten the town', () => {
        const { world, player, siege } = besiege(30);
        tune('terms.min', 0);
        tune('terms.max', 0);
        const morale = siege.morale;
        expect(HoldingSieges.negotiate(player, world, siege.key).accepted).toBe(false);
        expect(siege.morale).toBeLessThan(morale);
        expect(HoldingSieges.negotiate(player, world, siege.key).success).toBe(false);
    });

    it('paying the enemy lifts the siege, priced from the peace price; the war goes on', () => {
        const { world, player, siege, kingdom, unit } = besiege(30);
        const price = HoldingSieges.buyOffPrice(player, world, siege);
        expect(price).toBeGreaterThanOrEqual(Math.round(RealmWars.peacePrice(player, kingdom) * HoldingSieges.config().buyOff.peaceShare));
        const res = HoldingSieges.buyOff(player, world, siege.key);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(10000 - price);
        expect(unit.destroyed).toBe(true);
        expect(RealmWars.atWarWith(player, 'k1')).toBe(true);
        expect(HoldingSieges.state(player).siegeStats.bought).toBe(1);
    });

    it('buying peace ends the war and every siege it brought', () => {
        const { world, player } = besiege(30);
        expect(RealmWars.sueForPeace(player, world, 'k1').success).toBe(true);
        expect(HoldingSieges.list(player)).toHaveLength(0);
        expect(HoldingSieges.state(player).siegeStats.lifted).toBe(1);
    });

    it('letting it fall hands the town over', () => {
        const { world, player, settlement, siege } = besiege(30);
        const res = HoldingSieges.yieldHolding(player, world, siege.key);
        expect(res.success).toBe(true);
        expect(settlement.kingdom).toBe('k1');
        expect(HoldingSieges.state(player).siegeStats.fallen).toBe(1);
    });

    it('describe() gives the panel its numbers', () => {
        const { world, player, siege } = besiege(30);
        const d = HoldingSieges.describe(player, world, siege.key);
        expect(d.defense).toBeGreaterThan(0);
        expect(d.buyOffPrice).toBeGreaterThan(0);
        expect(d.commander.name).toBe('the garrison captain');
        expect(d.canRelieve).toBe(false);
        expect(d.supply.caravan.days).toBeGreaterThan(0);
    });
});

describe('HoldingSieges — save and load', () => {
    it('the siege survives a JSON round trip and older saves get a blank ledger', () => {
        const { world, player, siege } = besiege(30);
        world.day++;
        HoldingSieges.processDay(world, player);
        const p2 = { realmWars: JSON.parse(JSON.stringify(player.realmWars)) };
        HoldingSieges.loadState(p2);
        expect(HoldingSieges.at(p2, 5, 5)).toEqual(siege);
        const old = { realmWars: { wars: {}, ultimatums: {}, truces: {} } };
        HoldingSieges.loadState(old);
        expect(old.realmWars.besieged).toEqual({});
        expect(old.realmWars.siegeStats.besieged).toBe(0);
    });

    it('a besieging host lost on load is re-spawned on its holding and keeps its siege', () => {
        const { world, player, siege, rec } = besiege(30);
        world.units = [];
        world.day++;
        RealmWars.processDaily(player, world);
        HoldingSieges.processDay(world, player);
        const unit = world.units.find(u => u.id === rec.id);
        expect(unit).toBeTruthy();
        expect(unit instanceof WorldUnit).toBe(true);
        expect(unit.besieging).toBe(siege.key);
        expect(HoldingSieges.list(player)).toHaveLength(1);
    });
});

describe('HoldingSieges — the panel', () => {
    it('lists each besieged holding with its numbers and options, and acts on them', async () => {
        const { ActionMenu } = await import('../ui/actionMenu/index.js');
        const { world, player, siege } = besiege(30);
        const shown = [];
        const notes = [];
        const game = {
            player, world,
            ui: {
                showCustomPanel: (title, html) => shown.push({ title, html }),
                showNotification: (title, text) => notes.push(title),
                updateStats: () => {},
                hideCustomPanel: () => {},
            },
        };
        ActionMenu.showHoldingSiegesPanel(game);
        const { title, html } = shown.pop();
        expect(title).toMatch(/Holdings Under Siege/);
        expect(html).toContain('Newhope');
        expect(html).toContain('data-am-act="holdingSiegeAct"');
        for (const act of ['supply', 'sally', 'terms', 'buyoff', 'peace', 'yield']) expect(html).toContain(`[&quot;${act}&quot;`);
        ActionMenu.holdingSiegeAct(game, 'buyoff', siege.key);
        expect(HoldingSieges.list(player)).toHaveLength(0);
        expect(notes).toContain('💰 Siege Bought Off');
        expect(shown.pop().html).toContain('Past sieges');
    });
});

describe('HoldingSieges — in the real day loop', () => {
    it('a war host marches on a town held in your name, invests it, and the siege survives a save', async () => {
        await loadData();
        let game = newGame(4242);
        const { world, player } = game;
        // A free town, held in your own name, far from your (empty) army
        const town = world.getAllSettlements().find(s => !s.kingdom);
        expect(town).toBeTruthy();
        player.settlements = [{ q: town.q, r: town.r }];
        player.army = [];
        expect(Holdings.isHolding(player, world, town.q, town.r)).toBe(true);
        // The nearest realm makes war and sends a host at once
        const near = (k) => Math.min(...world.getAllSettlements().filter(s => s.kingdom === k.id).map(s => Math.abs(s.q - town.q) + Math.abs(s.r - town.r)));
        const kingdom = world.kingdoms.filter(k => k.isAlive).sort((a, b) => near(a) - near(b))[0];
        kingdom.military = 2000;
        const war = RealmWars.declareWar(player, world, kingdom);
        war.lastHostDay = world.day - RealmWars.CONFIG.hostCadence;
        let siege = null;
        for (let i = 0; i < 80 && !siege && RealmWars.atWarWith(game.player, kingdom.id); i++) {
            endDay(game);
            siege = HoldingSieges.at(game.player, town.q, town.r);
        }
        expect(siege).toBeTruthy();
        const host = game.world.units.find(u => u.id === siege.hostId);
        expect(host && host.besieging).toBe(siege.key);
        // Save and load mid-siege: the siege and its host come back
        game = roundTrip(game);
        const again = HoldingSieges.at(game.player, town.q, town.r);
        expect(again).toBeTruthy();
        expect(game.world.units.some(u => u.id === again.hostId && !u.destroyed)).toBe(true);
        // Play it out: it ends one way or another, without errors
        for (let i = 0; i < 80 && HoldingSieges.list(game.player).length; i++) endDay(game);
        expect(HoldingSieges.list(game.player)).toHaveLength(0);
        expect(game.player.realmWars.siegeHistory.length).toBeGreaterThan(0);
    }, 120000);
});
