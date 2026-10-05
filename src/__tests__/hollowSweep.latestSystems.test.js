// Hollow sweep of the latest systems (sieges, holding sieges, merchant houses,
// discovery, kingship, deeds): every effect written below has a reader, and
// the systems reach each other where the game says they do.
//   - supply contracts are posted for real sieges, blockades, hungry realms
//     and pirate-harried coasts, and food delivered to a besieged holding
//     fills its siege stores
//   - edicts reach the player's own affairs (roads, charters, rival houses,
//     holdings' walls) through kingdom.crown.effects
//   - the royal Marshal and Steward stand by a besieged holding
//   - rebel hosts meet a holding's garrison, never seat a lord on it, and
//     leave a holding already besieged to that siege
//   - a discovered colony's stationed troops defend the claim
//   - the Deeds ledger counts the royal court and the sieges of holdings
//   - all of it survives a save

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { HoldingSieges } from '../systems/holdingSieges.js';
import { RealmWars } from '../systems/realmWars.js';
import { Holdings } from '../systems/holdings.js';
import { Kingship } from '../systems/kingship.js';
import { Throne } from '../systems/throne.js';
import { Discovery } from '../systems/discovery.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Technology } from '../systems/technology.js';
import { Ships } from '../systems/ships.js';
import { Deeds } from '../systems/deeds.js';
import { Relationships } from '../systems/relationships.js';
import { House } from '../systems/house.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Utils.resetRng();
});

// ── A small hand-built world (as holdingSieges.test.js) ─────────────

/** Plains, kingdom k1 with a town at (12,12), kingdom k2 (no settlements). */
function makeWorld(day = 50) {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 16; q++) {
        for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    }
    const k1 = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, treasury: 500, territory: [{ q: 12, r: 12 }], population: 5000 };
    const k2 = { id: 'k2', name: 'Esk', isAlive: true, military: 800, treasury: 500, territory: [], population: 0 };
    tiles.get('12,12').settlement = { name: 'Varrholt', type: 'town', q: 12, r: 12, kingdom: 'k1', population: 2000 };
    return {
        day,
        width: 16,
        kingdoms: [k1, k2],
        units: [],
        events: [],
        activeEvents: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => [k1, k2].find(k => k.id === id) || null,
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

function ownColony(world, player, q = 5, r = 5, kingdom = null) {
    const settlement = {
        name: 'Newhope', type: 'village', population: 400, level: 1, kingdom, happiness: 60,
        colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 10 },
    };
    Economy.initSettlement(settlement);
    world.getTile(q, r).settlement = settlement;
    player.colonies.push({ q, r, name: settlement.name, foundedDay: 0 });
    Holdings.processDay(player, world);
    return settlement;
}

/** A war host of k1 standing on the colony; the next RealmWars tick invests it. */
function besiege(world, player, strength = 80) {
    const kingdom = world.kingdoms[0];
    const war = RealmWars.declareWar(player, world, kingdom);
    war.lastHostDay = world.day;
    const rec = { id: 'wh_test', name: 'Varr War Host', q: 5, r: 5, targetQ: 5, targetR: 5, target: { kind: 'colony', q: 5, r: 5, name: 'Newhope' }, strength };
    war.hosts.push(rec);
    RealmWars._spawnUnit(world, kingdom, rec);
    RealmWars.processDaily(player, world);
    return HoldingSieges.at(player, 5, 5);
}

function soldiers(n) {
    const def = Object.values(PlayerMilitary.UNIT_TYPES).find(u => u.id === 'soldier');
    return Array.from({ length: n }, () => PlayerMilitary.makeArmyUnit(def));
}

// ── Supply contracts read real state ────────────────────────────────

describe('Supply contracts are posted for real sieges, hunger and pirates', () => {
    it('siege relief: a besieged holding of the player\'s and a port an enemy fleet blockades', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        ownColony(world, player, 5, 5, 'k2');
        const towns = [{ q: 12, r: 12, name: 'Varrholt', kingdom: 'k1' }];
        // No siege, no blockade: nowhere to relieve (the old settlement flags were never set)
        expect(MerchantHouses._triggerTowns(world, 'siege', towns, player)).toEqual([]);

        // A blockaded port
        vi.spyOn(KingdomNavy, 'portBlockade').mockImplementation((w, q, r) => (q === 12 && r === 12 ? { closed: false } : null));
        expect(MerchantHouses._triggerTowns(world, 'siege', towns, player).map(t => t.name)).toEqual(['Varrholt']);
        vi.restoreAllMocks();

        // A holding of the player's (a k2 colony, too small for the town list) under siege
        const siege = besiege(world, player);
        expect(siege).toBeTruthy();
        const places = MerchantHouses._triggerTowns(world, 'siege', towns, player);
        expect(places).toEqual([{ q: 5, r: 5, name: 'Newhope', kingdom: 'k2' }]);
    });

    it('famine relief follows a saga\'s hunger events, not just the famine templates', () => {
        const world = makeWorld();
        const towns = [{ q: 12, r: 12, name: 'Varrholt', kingdom: 'k1' }];
        world.day = 200; // past the lean weeks
        world.activeEvents.push({ id: 'saga_long_winter', name: 'Hoarded Granaries', effects: { foodPrices: 0.3, stability: -4 }, kingdomId: 'k1', q: 12, r: 12, daysLeft: 20 });
        expect(MerchantHouses._triggerTowns(world, 'famine', towns).map(t => t.name)).toEqual(['Varrholt']);
        world.activeEvents[0].effects = { stability: -4 };
        world.activeEvents.push({ id: 'saga_long_winter', name: 'Early Frost', effects: { farmProduction: -0.15 }, kingdomId: 'k1', q: 12, r: 12, daysLeft: 20 });
        expect(MerchantHouses._triggerTowns(world, 'famine', towns).length).toBe(1);
    });

    it('fleet contracts come from a realm whose coasts pirates harry, even without a navy', () => {
        const world = makeWorld();
        const towns = [{ q: 12, r: 12, name: 'Varrholt', kingdom: 'k1' }];
        vi.spyOn(Ships, 'isPortTile').mockReturnValue(true);
        expect(MerchantHouses._triggerTowns(world, 'fleet', towns)).toEqual([]);
        world.activeEvents.push({ id: 'saga_sea_reavers', name: 'Reaver Fleet', effects: { pirateSpawnRate: 1, seaTradeIncome: -0.4 }, kingdomId: 'k1', q: 12, r: 12, daysLeft: 30 });
        expect(MerchantHouses._triggerTowns(world, 'fleet', towns).map(t => t.name)).toEqual(['Varrholt']);
    });

    it('food delivered on a contract to a besieged holding fills its siege stores', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        ownColony(world, player, 5, 5, 'k2');
        const siege = besiege(world, player);
        const before = siege.stores;
        const morale = siege.morale;
        const company = { name: 'Ash & Co', capital: 0, ledger: [], stats: {}, contracts: [] };
        player.merchant = { company };
        vi.spyOn(MerchantHouses, 'contractUnitPay').mockReturnValue(5);
        vi.spyOn(MerchantHouses, '_credit').mockImplementation(() => 0);
        const contract = { id: 'ctr1', status: 'accepted', good: 'bread', qty: 40, delivered: 0, q: 5, r: 5, town: 'Newhope', kingdomId: 'k2' };
        const n = MerchantHouses._deliver(player, world, contract, 20, 'by hand');
        expect(n).toBe(20);
        expect(siege.stores).toBeCloseTo(before + 20 / HoldingSieges.foodPerDay(siege), 1);
        expect(siege.morale).toBeGreaterThan(morale);
        // Not under siege: nothing to add
        expect(HoldingSieges.receiveFood(player, world, 12, 12, 20)).toBe(0);
    });
});

// ── Edicts reach the player's own affairs ───────────────────────────

describe('Edicts reach roads, charters, rival houses and holdings', () => {
    function crowned(seed = 11) {
        const game = newGame(seed);
        const { world, player } = game;
        const all = world.getAllSettlements();
        const k = world.kingdoms.filter(x => x.isAlive)
            .sort((a, b) => all.filter(s => s.kingdom === b.id).length - all.filter(s => s.kingdom === a.id).length)[0];
        Throne._takeThrone(player, world, k);
        k.treasury = 20000;
        Kingship.processDay(world, player);
        return { ...game, k };
    }

    it('the crown publishes the edicts in force and their effects on the kingdom', () => {
        const { world, player, k } = crowned();
        expect(KingdomBonuses.crownEffect(k, 'roadCost')).toBe(0);
        expect(Kingship.passEdict(player, world, 'road_programme').success).toBe(true);
        expect(Kingship.passEdict(player, world, 'merchant_charters').success).toBe(true);
        expect(Kingship.passEdict(player, world, 'fortification').success).toBe(true);
        expect(k.crown.edicts).toEqual(expect.arrayContaining(['road_programme', 'merchant_charters', 'fortification']));
        expect(KingdomBonuses.crownEffect(k, 'roadCost')).toBeCloseTo(-0.4);
        expect(KingdomBonuses.crownEffect(k, 'charterCost')).toBeCloseTo(-0.5);
        expect(KingdomBonuses.crownEffect(k, 'holdingWalls')).toBeCloseTo(0.15);
        Kingship.revokeEdict(player, world, 'road_programme');
        expect(KingdomBonuses.crownEffect(k, 'roadCost')).toBe(0);
        // Another realm feels none of it
        const other = world.kingdoms.find(x => x.id !== k.id);
        expect(KingdomBonuses.crownEffect(other, 'charterCost')).toBe(0);
    });

    it('the road-building programme cuts the cost of roads built in the realm', () => {
        const { world, player, k } = crowned();
        player.gold = 100000;
        const tile = k.territory.map(p => world.getTile(p.q, p.r)).find(t => t && t.terrain && t.terrain.passable && !t.settlement && !t.infrastructure);
        vi.spyOn(Technology, 'isImplemented').mockReturnValue(true);
        const base = Infrastructure.canBuild(player, 'dirt_road', tile, world);
        expect(base.can).toBe(true);
        Kingship.passEdict(player, world, 'road_programme');
        const cheap = Infrastructure.canBuild(player, 'dirt_road', tile, world);
        expect(cheap.cost).toBe(Math.max(1, Math.round(base.cost * 0.6)));
        // Irrigation is no road
        const ditch = Infrastructure.canBuild(player, 'irrigation_channel', tile, world);
        Kingship.revokeEdict(player, world, 'road_programme');
        if (ditch.can) expect(Infrastructure.canBuild(player, 'irrigation_channel', tile, world).cost).toBe(ditch.cost);
    });

    it('merchant charters halve the realm\'s charter; crown monopolies drag the rival houses\' posts in it', () => {
        const { world, player, k } = crowned();
        const full = MerchantHouses.charterCost(world, k);
        Kingship.passEdict(player, world, 'merchant_charters');
        expect(MerchantHouses.charterCost(world, k)).toBe(Math.round(full * 0.5));

        // Rival houses: the same week, with and without the crown's monopolies on their posts
        const rivals = MerchantHouses.ensureRivals({}, world);
        const realmPost = world.getAllSettlements().find(s => s.kingdom === k.id);
        const make = () => {
            const m = { company: { name: 'Us', capital: 1000, posts: [], ledger: [], stats: {}, contracts: [] }, rivals: JSON.parse(JSON.stringify(rivals)), news: [], board: [] };
            for (const r of m.rivals) r.posts = [{ q: realmPost.q, r: realmPost.r, name: realmPost.name }];
            return m;
        };
        const week = () => {
            player.merchant = make();
            Utils.setSeed(99);
            MerchantHouses._rivalWeek(player, world, { notices: [] });
            return player.merchant.rivals.reduce((s, r) => s + r.capital, 0);
        };
        const free = week();
        Kingship.revokeEdict(player, world, 'merchant_charters');
        Kingship.passEdict(player, world, 'crown_monopolies');
        const squeezed = week();
        expect(squeezed).toBeLessThan(free);
    });
});

// ── The crown stands by a besieged holding ──────────────────────────

describe('The royal council and fortification aid a besieged holding', () => {
    it('Marshal: garrison and morale; Steward: stores; fortification: walls', () => {
        const plain = (() => {
            const world = makeWorld();
            const player = makePlayer(world);
            ownColony(world, player, 5, 5, 'k2');
            return besiege(world, player);
        })();

        const world = makeWorld();
        const player = makePlayer(world);
        ownColony(world, player, 5, 5, 'k2');
        player.throne = { ruling: { kingdomId: 'k2', since: 0, policies: {} } };
        world.getKingdom('k2').crown = { playerRuled: true, mods: {}, edicts: ['fortification'], effects: { holdingWalls: 0.15 } };
        vi.spyOn(Kingship, 'councillor').mockImplementation((p, w, office) => (
            office === 'marshal' ? { name: 'Sir Brand', competence: 16, loyalty: 80 }
                : office === 'steward' ? { name: 'Old Ledger', competence: 12, loyalty: 80 } : null));
        const aid = HoldingSieges.crownAid(player, world, world.getTile(5, 5).settlement);
        expect(aid.garrison).toBeGreaterThan(0);
        expect(aid.morale).toBeGreaterThan(0);
        expect(aid.stores).toBeGreaterThan(0);
        expect(aid.walls).toBeCloseTo(0.15);
        const siege = besiege(world, player);
        expect(siege.garrison).toBeGreaterThan(plain.garrison);
        expect(siege.morale).toBeGreaterThan(plain.morale);
        expect(siege.stores).toBeGreaterThan(plain.stores);
        expect(siege.walls).toBeCloseTo(plain.walls + 0.15, 2);
        expect(siege.log.some(l => /The crown stands by Newhope/.test(l.text || l))).toBe(true);
    });

    it('no crown, no aid (and nothing drawn)', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const s = ownColony(world, player, 5, 5, 'k2');
        world.getKingdom('k2').crown = { effects: { holdingWalls: 0.15 } };
        Utils.setSeed(5);
        const expected = Utils.random();
        Utils.setSeed(5);
        expect(HoldingSieges.crownAid(player, world, s)).toMatchObject({ garrison: 0, morale: 0, stores: 0, walls: 0 });
        expect(Utils.random()).toBe(expected);
    });
});

// ── Revolts and the player's holdings ───────────────────────────────

describe('Rebel hosts and the player\'s own holdings', () => {
    function crownedWithHolding(seed = 11) {
        const game = newGame(seed);
        const { world, player } = game;
        const all = world.getAllSettlements();
        const k = world.kingdoms.filter(x => x.isAlive)
            .sort((a, b) => all.filter(s => s.kingdom === b.id).length - all.filter(s => s.kingdom === a.id).length)[0];
        Throne._takeThrone(player, world, k);
        k.treasury = 20000;
        const town = all.find(s => s.kingdom === k.id && !(k.capital && k.capital.q === s.q && k.capital.r === s.r));
        player.settlements = [{ q: town.q, r: town.r, name: town.name }];
        Kingship.processDay(world, player);
        return { ...game, k, town, court: Kingship.court(player) };
    }

    it('no vassal lord is seated on a holding of the player\'s', () => {
        const { court, town } = crownedWithHolding();
        expect(court.vassals.length).toBeGreaterThan(0);
        expect(court.vassals.some(v => v.seat && v.seat.q === town.q && v.seat.r === town.r)).toBe(false);
    });

    it('a rebel host meets the holding\'s garrison; if it falls it is sacked, never made a rebel seat', () => {
        const { world, player, k, town, court } = crownedWithHolding();
        const s = world.getTile(town.q, town.r).settlement;
        const h = Holdings.ensure(s);
        h.garrison = soldiers(6);
        h.unrest = 0;
        const rv = { id: 'rv1', seats: [], members: [], hosts: [], strength: 0, momentum: 0, leaderName: 'Lord Test' };
        court.revolt = rv;
        const out = { notices: [] };

        // A weak host breaks on the garrison
        const weak = { id: 'rh_w', name: 'Weak Host', q: town.q, r: town.r, targetQ: town.q, targetR: town.r, strength: 1 };
        rv.hosts.push(weak);
        Kingship._hostStrikes(world, k, rv, weak, { destroyed: false }, out, player);
        expect(out.notices.some(n => n.title === 'Rebels Repelled')).toBe(true);
        expect(rv.seats).toEqual([]);

        // An overwhelming host sacks it — and it stays the player's
        const pop = s.population;
        const big = { id: 'rh_b', name: 'Great Host', q: town.q, r: town.r, targetQ: town.q, targetR: town.r, strength: 1e6 };
        rv.hosts.push(big);
        Kingship._hostStrikes(world, k, rv, big, { destroyed: false }, out, player);
        expect(out.notices.some(n => n.title === 'Holding Sacked')).toBe(true);
        expect(rv.seats).toEqual([]);
        expect(h.unrest).toBeGreaterThan(0);
        expect(s.population).toBeLessThan(pop);
        expect(Holdings.find(player, world, town.q, town.r)).toBeTruthy();
    });

    it('rebel hosts leave a holding a foreign war host already besieges to that siege', () => {
        const { world, player, k, town, court } = crownedWithHolding();
        const st = HoldingSieges.state(player);
        st.besieged[`${town.q},${town.r}`] = { key: `${town.q},${town.r}`, q: town.q, r: town.r };
        const rv = { id: 'rv1', seats: [], members: [], hosts: [], strength: 200, momentum: 0, leaderName: 'Lord Test', lastHostDay: 0 };
        // The rebels hold every other town but the capital and the besieged holding
        for (const e of Throne._settlementsOf(world, k)) {
            const key = `${e.q},${e.r}`;
            if (key !== `${town.q},${town.r}` && !(k.capital && k.capital.q === e.q && k.capital.r === e.r)) rv.seats.push(key);
        }
        court.revolt = rv;
        const rec = Kingship._dispatchHost(world, k, rv, player);
        if (rec) expect(`${rec.targetQ},${rec.targetR}`).not.toBe(`${town.q},${town.r}`);
    });
});

// ── Discovery: a colony's troops defend the claim ───────────────────

describe('A discovered land\'s colony defends its claim with its stationed troops', () => {
    it('the holding\'s garrison and militia count toward the contest', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const s = ownColony(world, player, 5, 5);
        const site = { id: 'site1', claim: { by: 'player', colony: { q: 5, r: 5, name: 'Newhope' } } };
        const before = Discovery._playerFleet(player, world, site);
        Holdings.ensure(s).garrison = soldiers(4);
        const after = Discovery._playerFleet(player, world, site);
        expect(after - before).toBe(Holdings.garrisonStrength(s.holding));
        expect(after).toBeGreaterThan(before);
    });
});

// ── The Spymaster's rate has one source ─────────────────────────────

describe('The Spymaster reveals plots at the office\'s rate, else the factions\' default', () => {
    it('falls back to factions.revealPerCompetence when the office names none', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const def = Kingship.offices().spymaster;
        const F = Kingship.config().factions;
        const saved = [def.reveal, F.revealBase, F.revealPerCompetence];
        try {
            delete def.reveal;
            F.revealBase = 0;
            F.revealPerCompetence = 1;
            vi.spyOn(Kingship, 'councillor').mockReturnValue({ name: 'Whisper', competence: 20, loyalty: 100 });
            const court = { factions: [{ id: 'f1', revealed: false, members: ['v1'], leaderId: 'v1', demand: { type: 'lowerLevy' } }], vassals: [], stats: { plotsRevealed: 0 } };
            Kingship._revealPlots(player, world, court, { notices: [] });
            expect(court.factions[0].revealed).toBe(true);
            F.revealPerCompetence = 0;
            court.factions[0].revealed = false;
            Kingship._revealPlots(player, world, court, { notices: [] });
            expect(court.factions[0].revealed).toBe(false);
        } finally {
            [def.reveal, F.revealBase, F.revealPerCompetence] = saved;
        }
    });
});

// ── Deeds: the royal court and the sieges of holdings ───────────────

describe('Deeds count the royal court and the sieges of holdings', () => {
    it('reads court stats, edicts in force and the holding-siege ledger', () => {
        const player = {
            throne: { ruling: { court: {
                stats: { edictsPassed: 3, feasts: 1, grants: 4, plotsRevealed: 2, revolts: 1, revoltsCrushed: 1, revoltsConceded: 0, lordsBroken: 2 },
                vassals: [{ id: 'a' }, { id: 'b', rebel: true }, { id: 'c' }], edicts: { fortification: {}, tolerance: {} },
            } } },
            realmWars: { besieged: { '5,5': {} }, siegeStats: { besieged: 3, relieved: 1, held: 1, terms: 0, bought: 0, lifted: 0, fallen: 1 } },
        };
        const d = Deeds.collect(player);
        expect(d['kingship.edictsPassed']).toBe(3);
        expect(d['kingship.lordsBroken']).toBe(2);
        expect(d['kingship.vassals']).toBe(2);
        expect(d['kingship.edictsInForce']).toBe(2);
        expect(d['holdingSieges.besieged']).toBe(3);
        expect(d['holdingSieges.fallen']).toBe(1);
        expect(d['holdingSieges.active']).toBe(1);
        const secs = Deeds.sections(player);
        const court = secs.find(s => s.id === 'kingship');
        expect(court.empty).toBe(false);
        expect(court.rows.find(r => r.key === 'kingship.vassals').current).toBe(true);
        expect(secs.find(s => s.id === 'holdingSieges').empty).toBe(false);
        // Nothing to show without a crown or a siege
        const none = Deeds.sections({});
        expect(none.find(s => s.id === 'kingship').empty).toBe(true);
        expect(none.find(s => s.id === 'holdingSieges').empty).toBe(true);
    });
});

// ── Save and load ───────────────────────────────────────────────────

describe('The latest systems survive a save', () => {
    it('crown edicts and effects, court counters, a holding siege, discoveries, the company and the trips', () => {
        const game = newGame(11);
        const { world, player } = game;
        const all = world.getAllSettlements();
        const k = world.kingdoms.filter(x => x.isAlive)
            .sort((a, b) => all.filter(s => s.kingdom === b.id).length - all.filter(s => s.kingdom === a.id).length)[0];
        Throne._takeThrone(player, world, k);
        k.treasury = 20000;
        Kingship.processDay(world, player);
        Kingship.passEdict(player, world, 'fortification');
        Kingship.holdFeast(player, world);
        const st = HoldingSieges.state(player);
        st.besieged['3,4'] = { key: '3,4', q: 3, r: 4, name: 'Testhold', kingdomId: k.id, stores: 12.5, garrison: 40, walls: 0.25, morale: 61, log: [{ day: 1, text: 'The crown stands by Testhold.' }] };
        st.siegeStats.besieged = 2;
        st.siegeStats.relieved = 1;
        Discovery.state(player).stats.found = 3;
        Discovery.state(player).stats.colonies = 1;
        player.merchant = { company: { name: 'Ash & Co', capital: 1234, posts: [], stats: { contractsDone: 2 } } };
        player.foragingTrips = 17;
        player.huntingTrips = 6;
        const deeds = Deeds.collect(player);
        const effects = { ...k.crown.effects };

        const g2 = roundTrip(game);
        const k2 = g2.world.getKingdom(k.id);
        expect(k2.crown.edicts).toContain('fortification');
        expect(k2.crown.effects).toEqual(effects);
        expect(KingdomBonuses.crownEffect(k2, 'holdingWalls')).toBeCloseTo(0.15);
        const s2 = HoldingSieges.at(g2.player, 3, 4);
        expect(s2.stores).toBe(12.5);
        expect(s2.walls).toBe(0.25);
        expect(Deeds.collect(g2.player)).toEqual(deeds);
        expect(deeds['kingship.feasts']).toBe(1);
        expect(deeds['kingship.edictsInForce']).toBe(1);
        expect(deeds['land.foragingTrips']).toBe(17);
    });
});
