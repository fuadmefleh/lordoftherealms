// Sieges as operations (systems/sieges.js): investing a settlement, the daily
// tick of both sides, stances and works, storming, terms, relief hosts,
// endings, and the save round trip — on a real generated world.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Sieges } from '../systems/sieges.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { RealmWars } from '../systems/realmWars.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Player } from '../player/player.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { loadData, newGame } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

const cfgBackup = [];
/** Override a tuning value for one test (restored afterwards). */
function tune(path, value) {
    const keys = path.split('.');
    let o = Sieges.config();
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

function armyOf(type, n) {
    const def = Object.values(PlayerMilitary.UNIT_TYPES).find(u => u.id === type);
    return Array.from({ length: n }, () => PlayerMilitary.makeArmyUnit(def));
}

/** A game with the player standing at a kingdom's town (inland unless port is asked for). */
function setup(seed = 4242, { type = null, port = false, units = 8, unitType = 'soldier', walled = false } = {}) {
    const game = newGame(seed);
    const { world, player } = game;
    const all = world.getAllSettlements().filter(s => s.kingdom && (!type || s.type === type)
        && KingdomNavy.isPortTile(world, s.q, s.r) === port && s.type !== 'capital');
    const found = all.find(s => !walled || s.type === 'town' || s.type === 'city');
    if (!found) throw new Error('no settlement fits the test');
    const settlement = world.getTile(found.q, found.r).settlement;
    player.q = settlement.q;
    player.r = settlement.r;
    player.army = armyOf(unitType, units);
    player.gold = 5000;
    player.allegiance = null;
    player.inventory = { bread: 40 };
    const tile = world.getTile(settlement.q, settlement.r);
    return { game, world, player, settlement, tile };
}

/** Count RNG draws made while fn runs. */
function drawsDuring(fn) {
    const base = Utils.getRng();
    let n = 0;
    Utils.setRng(() => { n++; return base(); });
    try { fn(); } finally { Utils.setRng(base); }
    return n;
}

describe('Sieges — investing', () => {
    it('the daily tick draws no randomness when no siege is in progress', () => {
        const { world, player } = setup();
        Sieges.state(player);
        expect(drawsDuring(() => Sieges.processDay(world, player))).toBe(0);
        // ...nor for a save from before sieges existed
        delete player.sieges;
        expect(drawsDuring(() => Sieges.processDay(world, player))).toBe(0);
    });

    it("investing a realm's town is an act of war, unless your liege already fights that realm", () => {
        const { world, player, tile, settlement } = setup();
        const res = Sieges.invest(player, world, tile);
        expect(res.success).toBe(true);
        expect(RealmWars.atWarWith(player, settlement.kingdom)).toBe(true);
        expect(res.siege.declaredWar).toBe(true);

        const b = setup(4243);
        const liege = b.world.kingdoms.find(k => k.isAlive && k.id !== b.settlement.kingdom);
        b.player.allegiance = liege.id;
        if (!liege.wars.includes(b.settlement.kingdom)) liege.wars.push(b.settlement.kingdom);
        expect(Sieges.invest(b.player, b.world, b.tile).success).toBe(true);
        expect(RealmWars.atWarWith(b.player, b.settlement.kingdom)).toBe(false);
    });

    it('needs a land army of the minimum strength', () => {
        const { world, player, tile } = setup();
        player.army = armyOf('soldier', 1);
        const res = Sieges.invest(player, world, tile);
        expect(res.success).toBe(false);
        expect(res.reason).toMatch(/too weak/);
        player.army = [];
        expect(Sieges.canInvest(player, world, tile).ok).toBe(false);
    });

    it('refuses your liege\'s towns and your own holdings', () => {
        const { world, player, tile, settlement } = setup();
        player.allegiance = settlement.kingdom;
        expect(Sieges.canInvest(player, world, tile).ok).toBe(false);
        player.allegiance = null;
        settlement.colony = { isPlayerColony: true };
        expect(Sieges.canInvest(player, world, tile).ok).toBe(false);
    });

    it('investing sets up both sides and costs reputation with the owner', () => {
        const { world, player, tile, settlement } = setup();
        const repBefore = player.reputation[settlement.kingdom] || 0;
        const res = Sieges.invest(player, world, tile);
        expect(res.success).toBe(true);
        const s = Sieges.active(player);
        expect(s.name).toBe(settlement.name);
        expect(s.garrison).toBeGreaterThan(0);
        expect(s.stores).toBeGreaterThan(0);
        expect(s.storesStart).toBe(s.stores);
        expect(s.wallHp).toBe(100);
        expect(s.morale).toBeGreaterThan(0);
        // The siege's own cost, then the war it starts drags standing down to -60
        expect(player.reputation[settlement.kingdom]).toBe(Math.min(repBefore + Sieges.config().investReputation, -60));
        expect(Sieges.invest(player, world, tile).success).toBe(false); // one siege at a time
    });

    it('a relief host takes its strength out of the realm\'s army', () => {
        const { world, player, tile, settlement } = setup();
        const k = world.getKingdom(settlement.kingdom);
        k.military = 1000;
        tune('relief.chance', { village: 1, town: 1, city: 1, capital: 1 });
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        expect(s.relief).toBeTruthy();
        expect(k.military).toBe(1000 - s.relief.strength);
        expect(s.relief.arriveDay).toBeGreaterThan(world.day);
        // Lifting the siege sends it home (most of it)
        Sieges.lift(player, world);
        expect(k.military).toBe(1000 - s.relief.strength + Math.round(s.relief.strength * Sieges.config().relief.returnShare));
    });
});

describe('Sieges — the daily tick', () => {
    it('stores fall faster under a blockade than while sapping, and morale sinks', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        const m0 = s.morale;
        const st0 = s.stores;
        world.day++;
        Sieges.processDay(world, player);
        const blockadeDrop = st0 - s.stores;
        expect(blockadeDrop).toBeCloseTo(Sieges.config().stores.blockadeEats, 5);
        expect(s.morale).toBeLessThan(m0);
        Sieges.setStance(player, world, 'sap');
        const st1 = s.stores;
        world.day++;
        Sieges.processDay(world, player);
        expect(st1 - s.stores).toBeCloseTo(1, 5);
    });

    it('a port the sea still feeds eats half as fast — until galleys blockade it', () => {
        const { world, player, tile } = setup(4242, { port: true });
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        Sieges.setStance(player, world, 'sap');
        expect(Sieges.consumption(player, world, s)).toBeCloseTo(Sieges.config().stores.unblockadedPort, 5);
        player.army.push(...armyOf('war_galley', 1));
        expect(Sieges.navalBlockade(player, world, s)).toBe(true);
        expect(Sieges.consumption(player, world, s)).toBeCloseTo(1, 5);
    });

    it('the camp eats from the packs what the land does not give', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        tune('camp.forage', { Spring: 0, Summer: 0, Autumn: 0, Winter: 0 });
        Sieges.invest(player, world, tile);
        const need = Sieges.supply(player, world, Sieges.active(player)).need;
        const before = player.inventory.bread;
        world.day++;
        Sieges.processDay(world, player);
        expect(player.inventory.bread).toBe(before - need);
    });

    it('a hungry camp loses heart', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        tune('camp.forage', { Spring: 0, Summer: 0, Autumn: 0, Winter: 0 });
        tune('campDisease.perDay', 0);
        player.inventory = {};
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        const m0 = s.campMorale;
        world.day++;
        const out = Sieges.processDay(world, player);
        expect(s.hungryDays).toBe(1);
        expect(s.campMorale).toBeLessThanOrEqual(m0 - Sieges.config().camp.hunger);
        expect(out.notices.some(n => /Hungry/i.test(n.title))).toBe(true);
    });

    it('a starving, broken town surrenders and is taken (a holding for the unsworn)', () => {
        const { world, player, tile, settlement } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        s.stores = 0;
        s.morale = 3;
        world.day++;
        const out = Sieges.processDay(world, player);
        expect(out.ended && out.ended.outcome).toBe('captured');
        expect(Sieges.active(player)).toBe(null);
        expect(settlement.colony && settlement.colony.isPlayerColony).toBe(true);
        expect(player.colonies.some(c => c.q === tile.q && c.r === tile.r)).toBe(true);
        expect(player.sieges.stats.captured).toBe(1);
    });

    it('marching away lifts the siege', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        player.q = (player.q + 3) % world.width;
        world.day++;
        const out = Sieges.processDay(world, player);
        expect(out.ended.outcome).toBe('lifted');
        expect(Sieges.active(player)).toBe(null);
    });

    it('a relief host arrives, then attacks the camp the next day', () => {
        const { world, player, tile, settlement } = setup();
        world.getKingdom(settlement.kingdom).military = 600;
        tune('relief.chance', { village: 1, town: 1, city: 1, capital: 1 });
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        world.day = s.relief.arriveDay;
        const arrive = Sieges.processDay(world, player);
        expect(s.relief.arrived).toBe(true);
        expect(arrive.notices.some(n => /Relief/.test(n.title))).toBe(true);
        expect(arrive.battle).toBe(null);
        world.day++;
        const attack = Sieges.processDay(world, player);
        expect(attack.battle).toBeTruthy();
        if (attack.battle.victory) expect(Sieges.active(player).relief).toBe(null);
        else expect(Sieges.active(player)).toBe(null);
    });
});

describe('Sieges — works, mines and storms', () => {
    it('a battering ram is paid for and built over days; a trebuchet needs Siege Engineering', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        expect(Sieges.setStance(player, world, 'works', 'trebuchet').success).toBe(false);
        const gold = player.gold;
        expect(Sieges.setStance(player, world, 'works', 'ram').success).toBe(true);
        expect(player.gold).toBe(gold - Sieges.config().works.ram.cost);
        for (let i = 0; i < 6 && !s.works.ram; i++) { world.day++; Sieges.processDay(world, player); }
        expect(s.works.ram).toBe(true);
        expect(s.stance).toBe('blockade');
        const before = Sieges.stormDefense({ ...s, works: { ...s.works, ram: false } });
        expect(Sieges.stormDefense(s)).toBeLessThan(before);
    });

    it('a finished mine brings down part of the wall', () => {
        const { world, player, tile } = setup(4242, { walled: true });
        tune('relief.chance', {});
        tune('sap.counterChance', 0);
        tune('sap.days', 2);
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        expect(s.walls).toBeGreaterThan(0);
        Sieges.setStance(player, world, 'sap');
        for (let i = 0; i < 3 && s.wallHp === 100; i++) { world.day++; Sieges.processDay(world, player); }
        expect(s.wallHp).toBeLessThanOrEqual(100 - Sieges.config().sap.breach + Sieges.config().walls.repairPerDay);
        expect(Sieges.effectiveWalls(s)).toBeLessThan(s.walls);
    });

    it('an overwhelming storm takes the town by the existing conquest', () => {
        const { world, player, tile, settlement } = setup(4242, { units: 30, unitType: 'knight' });
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const res = Sieges.storm(player, world);
        expect(res.success).toBe(true);
        expect(res.victory).toBe(true);
        expect(res.conquered).toBe(true);
        expect(res.outcome.outcome).toBe('captured');
        expect(settlement.colony && settlement.colony.isPlayerColony).toBe(true);
    });

    it('a sworn lord hands the stormed town to the liege', () => {
        const { world, player, tile, settlement } = setup(4242, { units: 30, unitType: 'knight' });
        tune('relief.chance', {});
        const liege = world.kingdoms.find(k => k.isAlive && k.id !== settlement.kingdom);
        player.allegiance = liege.id;
        Sieges.invest(player, world, tile);
        const res = Sieges.storm(player, world);
        expect(res.victory).toBe(true);
        expect(settlement.kingdom).toBe(liege.id);
    });

    it('a sack loots and burns: gold, karma and cruelty, no conquest', () => {
        const { world, player, tile, settlement } = setup(4242, { units: 30, unitType: 'knight' });
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const owner = settlement.kingdom;
        const pop = settlement.population;
        const karma = player.karma;
        const res = Sieges.storm(player, world, { sack: true });
        expect(res.victory).toBe(true);
        expect(res.outcome.outcome).toBe('sacked');
        expect(res.plunder).toBeGreaterThan(0);
        expect(settlement.kingdom).toBe(owner);
        expect(settlement.population).toBeLessThan(pop);
        expect(player.karma).toBeLessThan(karma + Sieges.config().sack.karma + 1);
        expect(player.traits.deeds.cruelty).toBeGreaterThan(0);
    });

    it('a failed storm bloodies the garrison and lifts its spirits', () => {
        const { world, player, tile } = setup(4242, { units: 5, unitType: 'soldier' });
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        s.garrison = 5000;
        const m0 = s.morale;
        const res = Sieges.storm(player, world);
        expect(res.victory).toBe(false);
        expect(s.garrison).toBeLessThan(5000);
        expect(s.morale).toBeGreaterThan(m0);
        expect(res.stormLosses).toBeGreaterThan(0);
    });
});

describe('Sieges — terms', () => {
    it('a ransom is paid and the army marches away', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const value = Sieges.termsValue(Sieges.active(player)).ransom;
        const gold = player.gold;
        Utils.setRng(() => 0);
        const res = Sieges.negotiate(player, world, 'ransom');
        expect(res.accepted).toBe(true);
        expect(player.gold).toBe(gold + value);
        expect(Sieges.active(player)).toBe(null);
        expect(player.sieges.stats.terms).toBe(1);
    });

    it('refused terms put off the next parley', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        Utils.setRng(() => 0.999);
        const res = Sieges.negotiate(player, world, 'surrender');
        expect(res.accepted).toBe(false);
        expect(Sieges.negotiate(player, world, 'ransom').success).toBe(false);
    });

    it('hunger and despair make surrender likelier; a coming relief makes it less likely', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        const fresh = Sieges.termsChance(player, world, 'surrender');
        s.morale = 10;
        s.stores = 0;
        const starving = Sieges.termsChance(player, world, 'surrender');
        expect(starving).toBeGreaterThan(fresh);
        s.relief = { name: 'x', strength: 50, arriveDay: world.day + 5, arrived: false };
        expect(Sieges.termsChance(player, world, 'surrender')).toBeLessThan(starving);
        s.relief = null;
    });

    it('tribute pays weekly afterwards, with no randomness', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        const v = Sieges.termsValue(Sieges.active(player));
        Utils.setRng(() => 0);
        expect(Sieges.negotiate(player, world, 'tribute').accepted).toBe(true);
        Utils.resetRng();
        const gold = player.gold;
        world.day += 7;
        const draws = drawsDuring(() => Sieges.processDay(world, player));
        expect(draws).toBe(0);
        expect(player.gold).toBe(gold + v.tributeWeekly);
        expect(player.sieges.tributes[0].weeksLeft).toBe(v.tributeWeeks - 1);
    });
});

describe('Sieges — civil war and saving', () => {
    it('a loyalist town taken in a war for the throne declares for the pretender', () => {
        const { world, player, tile, settlement } = setup();
        tune('relief.chance', {});
        player.throne = { civilWar: { kingdomId: settlement.kingdom, sides: {}, momentum: 0, battlesWon: 0 } };
        Sieges.invest(player, world, tile);
        const s = Sieges.active(player);
        expect(s.civilWar).toBe(true);
        s.morale = 0;
        world.day++;
        const out = Sieges.processDay(world, player);
        expect(out.ended.outcome).toBe('captured');
        expect(player.throne.civilWar.sides[`${tile.q},${tile.r}`]).toBe('pretender');
        expect(player.throne.civilWar.momentum).toBe(Sieges.config().civilWar.momentum);
        expect(settlement.kingdom).toBe(player.throne.civilWar.kingdomId); // not conquered
        // A town on your side can't be besieged
        expect(Sieges.canInvest(player, world, tile).ok).toBe(false);
    });

    it('a siege in progress survives a save and load', () => {
        const { world, player, tile } = setup();
        tune('relief.chance', {});
        Sieges.invest(player, world, tile);
        Sieges.setStance(player, world, 'works', 'ram');
        world.day++;
        Sieges.processDay(world, player);
        const data = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const p2 = new Player();
        SaveLoad.restorePlayer(data, p2, world);
        expect(Sieges.active(p2)).toEqual(Sieges.active(player));
        // Older saves get a blank record
        delete data.sieges;
        const p3 = new Player();
        SaveLoad.restorePlayer(data, p3, world);
        expect(p3.sieges.active).toBe(null);
        expect(p3.sieges.stats.invested).toBe(0);
    });
});
