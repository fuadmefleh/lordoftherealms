// Voyages take real days at sea; crews eat provisions from the hold; events
// at sea offer choices; and port prices share the land economy's scale, with
// no buy-and-sell-back loop between a port and the settlements beside it.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Ships } from '../systems/ships.js';
import { Ailments } from '../systems/ailments.js';
import { Trading, PlayerEconomy } from '../player/playerEconomy.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

let savedChance;
beforeEach(() => {
    Utils.setSeed(4242);
    savedChance = DataLoader.ships.settings.voyage.eventChance;
});
afterEach(() => {
    DataLoader.ships.settings.voyage.eventChance = savedChance;
});

const OCEAN = { id: 'ocean', passable: false };
const PLAINS = { id: 'plains', passable: true };

/** Open sea with land (and settlements) where listed. */
function seaWorld(land = {}, { width = 40, height = 30, day = 1 } = {}) {
    const tiles = new Map();
    return {
        width, height, day,
        getTile(q, r) {
            if (r < 0 || r >= height) return null;
            q = ((q % width) + width) % width;
            const key = `${q},${r}`;
            if (!tiles.has(key)) {
                const spec = land[key];
                tiles.set(key, {
                    q, r, terrain: spec ? spec.terrain || PLAINS : OCEAN,
                    settlement: spec && spec.settlement ? { q, r, ...spec.settlement } : null,
                });
            }
            return tiles.get(key);
        },
    };
}

const twoPorts = () => seaWorld({
    '5,10': { settlement: { name: 'Saltmere', type: 'town' } },
    '25,10': { settlement: { name: 'Gullhaven', type: 'town' } },
});

const ship = (typeId, extra = {}) => ({
    id: 'ship_1', typeId, name: 'Gull', q: 5, r: 10, status: 'docked', condition: 100,
    customizations: [], cargo: {}, crew: Ships.getShipEffectiveStats({ typeId }).crewRequired, morale: 70, ...extra,
});
const captain = (s, extra = {}) => ({
    gold: 5000, renown: 0, karma: 0, health: 100, reputation: {}, inventory: {}, skills: {},
    ships: [s], army: [], q: s.q, r: s.r, boardedShip: null, ...extra,
});

/** Run daily ticks until the voyage ends (answering any event with its default). */
function sail(p, w, maxDays = 60) {
    const days = [];
    for (let i = 0; i < maxDays && Ships.getVoyage(p); i++) {
        w.day++;
        const out = Ships.processDaily(p, w);
        days.push(out);
        if (Ships.describeVoyageEvent(p)) Ships.resolveVoyageEvent(p, w, null);
    }
    return days;
}

describe('port prices share the land scale', () => {
    it('prices every sea good as a multiple of its land base price', () => {
        // Outside the calendar (no day), so the season moves nothing
        const w = seaWorld({ '5,10': { settlement: { name: 'Saltmere', type: 'town' } } }, { day: null });
        const P = Ships._getPortPriceSettings();
        for (const e of Ships.getPortMarket(w, 5, 10)) {
            const base = PlayerEconomy.GOODS[e.id.toUpperCase()].basePrice;
            expect(e.basePrice).toBe(base);
            if (e.role === 'export') {
                expect(e.buy).toBeGreaterThanOrEqual(Math.floor(base * P.export[0]));
                expect(e.buy).toBeLessThanOrEqual(Math.ceil(base * P.export[1]));
            }
            if (e.role === 'import') expect(e.sell).toBeLessThanOrEqual(Math.ceil(base * P.import[1]));
        }
    });

    it('silk costs what silk costs ashore (no 15–30 silk against a land base of 80)', () => {
        let found = 0;
        for (let q = 0; q < 40; q += 3) {
            const w = seaWorld({ [`${q},5`]: { settlement: { name: 'P', type: 'town' } } });
            const silk = Ships.getPortMarket(w, q, 5).find(e => e.id === 'silk');
            if (silk.buy) {
                expect(silk.buy).toBeGreaterThanOrEqual(56);
                found++;
            }
        }
        expect(found).toBeGreaterThan(0);
    });

    it('an export bought at a port sells inland for no more than it cost, before trade bonuses', () => {
        for (let q = 0; q < 40; q += 2) {
            const w = seaWorld({ [`${q},5`]: { settlement: { name: 'P', type: 'town' } } });
            for (const e of Ships.getPortMarket(w, q, 5).filter(x => x.role === 'export')) {
                const good = PlayerEconomy.GOODS[e.id.toUpperCase()];
                expect(Trading.getSellPrice(good, w)).toBeLessThanOrEqual(e.buy);
            }
        }
    });

    it('a port next door caps what this port pays: no export→import loop between adjacent ports', () => {
        let checked = 0;
        for (let q = 2; q < 38; q++) {
            const [n] = Hex.neighbors(q, 10);
            const w = seaWorld({
                [`${q},10`]: { settlement: { name: 'A', type: 'town' } },
                [`${n.q},${n.r}`]: { settlement: { name: 'B', type: 'town' } },
            });
            const a = Ships.getPortMarket(w, q, 10);
            const b = Ships.getPortMarket(w, n.q, n.r);
            for (const ea of a.filter(x => x.buy)) {
                const eb = b.find(x => x.id === ea.id);
                const buffed = { reputation: {}, skills: {}, technologies: {} };
                const pays = Ships.portSaleUnitPrice(buffed, w, n.q, n.r, eb);
                expect(pays).toBeLessThan(ea.buy);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(10);
    });

    it('a town that stocks a good in its own market never imports it by sea', () => {
        for (let q = 0; q < 40; q++) {
            const w = seaWorld({ [`${q},5`]: { settlement: { name: 'P', type: 'capital' } } });
            const gems = Ships.getPortMarket(w, q, 5).find(e => e.id === 'gems');
            expect(gems.role).not.toBe('import');
        }
    });
});

describe('voyages take real days', () => {
    it('plots a sea route and reports the days it will take', () => {
        const w = twoPorts();
        const s = ship('cog');
        const p = captain(s);
        const routes = Ships.seaRoutes(w, 5, 10);
        expect(routes.map(r => r.name)).toContain('Gullhaven');
        const res = Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        expect(res.success).toBe(true);
        expect(res.distance).toBe(20);
        expect(res.days).toBe(Math.ceil(20 / Ships.getSailingSpeed(p, s)));
        expect(p.boardedShip).toBe(s.id);
        expect(s.status).toBe('at_sea');
        expect(p.q).toBe(5); // nobody has moved yet
    });

    it('a day passes per leg: the ship is mid-sea after one day and makes port after the estimate', () => {
        DataLoader.ships.settings.voyage.eventChance = 0;
        const w = twoPorts();
        const s = ship('cog', { cargo: { food: 40 } });
        const p = captain(s);
        const { days } = Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        expect(days).toBeGreaterThan(1);

        w.day++;
        const first = Ships.processDaily(p, w);
        expect(first.voyage.moved).toBe(Ships.getSailingSpeed(p, s));
        expect(first.voyage.arrived).toBe(false);
        expect(p.q).not.toBe(25);
        expect(Ships.isWaterTile(w.getTile(p.q, p.r))).toBe(true);
        expect(s.q).toBe(p.q);

        const rest = sail(p, w);
        expect(1 + rest.length).toBe(days);
        expect(rest[rest.length - 1].voyage.arrived).toBe(true);
        expect(p.q).toBe(25);
        expect(p.boardedShip).toBe(null);
        expect(s.status).toBe('docked');
        expect(s.dockedAt).toBe('Gullhaven');
        expect(s.voyage).toBeUndefined();
        expect(s.lastVoyage.log.length).toBeGreaterThan(days - 1);
    });

    it('each day at sea costs upkeep and wages, and the crew eats', () => {
        DataLoader.ships.settings.voyage.eventChance = 0;
        const w = twoPorts();
        const s = ship('cog', { cargo: { food: 40 } });
        const p = captain(s);
        Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        const daily = Ships.getShipType('cog').dailyUpkeep + Ships.getDailyWages(s);
        const gold = p.gold;
        w.day++;
        Ships.processDaily(p, w);
        expect(p.gold).toBe(gold - daily);
        expect(Ships.getProvisions(s)).toBe(38); // 8 sailors at 4 per ration
    });

    it('steering off the route by hand re-plots it from where you are', () => {
        DataLoader.ships.settings.voyage.eventChance = 0;
        const w = twoPorts();
        const s = ship('cog', { cargo: { food: 40 } });
        const p = captain(s);
        Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        w.day++;
        Ships.processDaily(p, w);
        p.q += 1; p.r += 2; // sailed about by hand during the day
        const days = sail(p, w);
        expect(days[days.length - 1].voyage.arrived).toBe(true);
        expect(p.q).toBe(25);
    });

    it('a storm halves the day\'s run', () => {
        DataLoader.ships.settings.voyage.eventChance = 0;
        const w = twoPorts();
        w.weather = { getWeather: () => ({ type: 'storm' }) };
        const s = ship('caravel', { cargo: { food: 40 } });
        const p = captain(s);
        Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        w.day++;
        const out = Ships.processDaily(p, w);
        expect(out.voyage.moved).toBe(Math.floor(Ships.getSailingSpeed(p, s) * Ships._getVoyageSettings().stormProgress));
        expect(out.voyage.notable).toBe(true);
    });

    it('heaving to ends the voyage and leaves you at the helm, aboard', () => {
        DataLoader.ships.settings.voyage.eventChance = 0;
        const w = twoPorts();
        const s = ship('cog', { cargo: { food: 40 } });
        const p = captain(s);
        Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        w.day++;
        Ships.processDaily(p, w);
        expect(Ships.heaveTo(p, w).success).toBe(true);
        expect(Ships.getVoyage(p)).toBe(null);
        expect(p.boardedShip).toBe(s.id);
        expect(s.status).toBe('at_sea');
        expect(s.lastVoyage.log.some(e => /Hove to/.test(e.text))).toBe(true);
    });

    it('needs a sea route', () => {
        const w = seaWorld({
            '5,10': { settlement: { name: 'Saltmere', type: 'town' } },
            '25,10': { settlement: { name: 'Inland', type: 'town' } },
            // wall the second port in with land
            ...Object.fromEntries(Hex.neighbors(25, 10).map(n => [`${n.q},${n.r}`, {}])),
        });
        const s = ship('cog');
        const res = Ships.startVoyage(captain(s), w, s.id, 25, 10, 'Inland');
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/no sea route/);
    });
});

describe('provisions', () => {
    it('counts days of food in the hold and buys more at a port', () => {
        const w = twoPorts();
        const s = ship('cog', { cargo: { preserved_fish: 6 } });
        const p = captain(s);
        expect(Ships.getDailyRations(s)).toBe(2);
        expect(Ships.getProvisionDays(s)).toBe(3);
        // The captain's own ration is counted too (they eat from the hold when their packs run dry)
        expect(Ships.provisionsNeeded(s, 10, { captain: false })).toBe(14);
        const need = Ships.provisionsNeeded(s, 10);
        expect(need).toBe(24);
        const res = Ships.buyProvisions(p, w, s.id, need);
        expect(res.success).toBe(true);
        expect(Ships.getProvisionDays(s)).toBe(15);
        expect(p.gold).toBe(5000 - need * Ships.provisionPrice(w, 5, 10));
        // The chandler's markup keeps provisions dearer than the land market pays for food
        const food = PlayerEconomy.GOODS.FOOD;
        expect(Trading.getSellPrice(food, w)).toBeLessThan(Ships.provisionPrice(w, 5, 10));
    });

    it('a crew in harbour eats ashore', () => {
        const w = twoPorts();
        const s = ship('cog', { cargo: { food: 10 } });
        Ships.processDaily(captain(s), w);
        expect(s.cargo.food).toBe(10);
    });

    it('an empty hold costs morale, then brings scurvy, then desertion', () => {
        const w = twoPorts();
        const s = ship('cog', { status: 'anchored' });
        const p = captain(s);
        const reports = [];
        for (let d = 0; d < 12; d++) {
            w.day++;
            reports.push(Ships.processDaily(p, w));
        }
        expect(reports[0].provisions[0].short).toBe(2);
        expect(reports.some(r => r.provisions.some(x => x.outbreak))).toBe(true);
        expect(Ailments.getState(p).crews[s.id].id).toBe('scurvy');
        expect(s.morale).toBeLessThan(Ships._getCrewSettings().desertionMorale);
        expect(reports.some(r => r.crew.deserted.length > 0)).toBe(true);
        expect(s.crew).toBeLessThan(8);
    });

    it('the captain eats from the hold when their own packs are empty', () => {
        const s = ship('cog', { cargo: { bread: 2 } });
        const p = captain(s, { boardedShip: s.id });
        expect(Ships.feedCaptain(p)).toBe('bread');
        expect(s.cargo.bread).toBe(1);
    });
});

describe('events at sea', () => {
    const KNOWN = new Set(['id', 'label', 'text', 'requires', 'morale', 'crew', 'gold', 'goldPerCrew', 'renown', 'karma', 'hull',
        'repair', 'delay', 'cargo', 'loseCargo', 'provisions', 'heat', 'deed', 'piracy', 'sickness', 'chance', 'fight']);

    function checkBlock(fx, where) {
        for (const k of Object.keys(fx)) expect(KNOWN.has(k), `${where}: unknown effect "${k}"`).toBe(true);
        if (fx.sickness) expect(Ailments.def(fx.sickness), `${where}: unknown disease`).toBeTruthy();
        if (fx.chance) {
            checkBlock(fx.chance.pass, `${where}.pass`);
            checkBlock(fx.chance.fail, `${where}.fail`);
        }
        if (fx.fight) {
            checkBlock(fx.fight.win, `${where}.win`);
            checkBlock(fx.fight.lose, `${where}.lose`);
        }
    }

    it('a table of a dozen events, each with a valid default and known effects', () => {
        const events = Ships._getVoyageEvents();
        expect(events.length).toBeGreaterThanOrEqual(12);
        const deeds = Object.keys(DataLoader._gamedata.traits.deeds);
        for (const e of events) {
            expect(e.choices.length).toBeGreaterThan(1);
            expect(e.choices.some(c => c.id === e.default), `${e.id} default`).toBe(true);
            for (const c of e.choices) {
                checkBlock(c, `${e.id}.${c.id}`);
                const allDeeds = JSON.stringify(c).match(/"deed":\{[^}]*\}/g) || [];
                for (const d of allDeeds) for (const id of Object.keys(JSON.parse(d.slice(7)))) expect(deeds).toContain(id);
            }
        }
    });

    function atSea(eventId, shipExtra = {}) {
        const w = twoPorts();
        const s = ship('cog', { cargo: { food: 40 }, ...shipExtra });
        const p = captain(s);
        Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        s.voyage.pending = { id: eventId, day: w.day };
        return { w, s, p };
    }

    it('answering an event applies its effects and logs it', () => {
        const { w, s, p } = atSea('castaway', { crew: 6 });
        const ev = Ships.describeVoyageEvent(p);
        expect(ev.title).toBe('A Castaway');
        const res = Ships.resolveVoyageEvent(p, w, 'rescue');
        expect(res.success).toBe(true);
        expect(s.crew).toBe(7);
        expect(p.karma).toBe(2);
        expect(Ships.getProvisions(s)).toBe(38);
        expect(Ships.describeVoyageEvent(p)).toBe(null);
        expect(s.voyage.log.some(e => /Take him aboard/.test(e.text))).toBe(true);
    });

    it('a choice the ship cannot make is refused', () => {
        const { w, p } = atSea('smugglers');
        p.gold = 50;
        const buy = Ships.describeVoyageEvent(p).choices.find(c => c.id === 'buy');
        expect(buy.available).toBe(false);
        expect(Ships.resolveVoyageEvent(p, w, 'buy').success).toBe(false);
    });

    it('an unanswered event takes its default the next day', () => {
        DataLoader.ships.settings.voyage.eventChance = 0;
        const { w, s, p } = atSea('fog_bank');
        w.day++;
        const out = Ships.processDaily(p, w);
        expect(out.voyage.autoResolved.auto).toBe(true);
        expect(out.voyage.autoResolved.choice).toBe('heave_to');
        // Heaving to in the fog costs that very day
        expect(out.voyage.moved).toBe(0);
        expect(s.voyage.pending).toBe(null);
    });

    it('events come up on their own while under way', () => {
        DataLoader.ships.settings.voyage.eventChance = 1;
        const w = twoPorts();
        const s = ship('cog', { cargo: { food: 40 } });
        const p = captain(s);
        Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        w.day++;
        const out = Ships.processDaily(p, w);
        expect(out.voyage.event).toBeTruthy();
        expect(out.voyage.notable).toBe(true);
    });

    it('piracy at sea costs karma and reputation with every realm', () => {
        const { w, s, p } = atSea('sighted_sail');
        p.reputation = { k1: 0 };
        w.getAllSettlements = () => [{ q: 5, r: 10, kingdom: 'k1' }];
        Ships._applyVoyageOutcome(p, w, s, { piracy: true }, [], 0);
        expect(p.karma).toBeLessThan(0);
        expect(p.reputation.k1).toBeLessThan(0);
    });
});

describe('save and load', () => {
    it('backfills provision fields and drops a voyage nobody is aboard for', () => {
        const s = ship('cog', { status: 'at_sea', voyage: { route: [[6, 10]], step: 0, destName: 'X' } });
        const p = captain(s, { boardedShip: null });
        Ships.restoreFromSave(p);
        expect(s.hungryDays).toBe(0);
        expect(s.rationCarry).toBe(0);
        expect(s.voyage).toBeUndefined();
        expect(s.status).toBe('anchored');
    });

    it('keeps a voyage in progress across a save', () => {
        DataLoader.ships.settings.voyage.eventChance = 0;
        const w = twoPorts();
        const s = ship('cog', { cargo: { food: 40 } });
        const p = captain(s);
        Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven');
        w.day++;
        Ships.processDaily(p, w);
        const back = JSON.parse(JSON.stringify(p));
        delete back.ships[0].voyage.log;
        Ships.restoreFromSave(back);
        expect(back.ships[0].voyage.log).toEqual([]);
        const days = sail(back, w);
        expect(days[days.length - 1].voyage.arrived).toBe(true);
    });
});

describe('making for port from the helm', () => {
    it('a captain hove to on open water can plot a voyage to a port', () => {
        const w = twoPorts();
        const s = ship('cog', { cargo: { preserved_fish: 20 } });
        const p = captain(s);
        const routes = Ships.seaRoutes(w, s.q, s.r);
        const dest = routes[0];
        expect(Ships.startVoyage(p, w, s.id, dest.q, dest.r, dest.name).success).toBe(true);
        expect(Ships.heaveTo(p, w).success).toBe(true);
        expect(p.boardedShip).toBe(s.id);
        expect(Ships.getVoyage(p)).toBeNull();
        // Still aboard at the helm: a new voyage starts from where she lies
        const back = Ships.seaRoutes(w, p.q, p.r)[0];
        const res = Ships.startVoyage(p, w, s.id, back.q, back.r, back.name);
        expect(res.success).toBe(true);
        expect(Ships.getVoyage(p)).toBeTruthy();
        expect(p.boardedShip).toBe(s.id);
    });
});
