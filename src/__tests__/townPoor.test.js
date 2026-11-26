// The poor pay to live (systems/townPoor.js) and the towns' houses hold so many
// (world/townHousing.js): each class's households buy their basket from their
// wages, the idle have none; what is short is met by savings, day labour, the
// church's alms, the guilds, the lords, a poor rate, the crown's dole and an
// almshouse's box, begging, theft and pawning — real coin where it is given —
// and what is still short goes unbought: hunger, sickness and death. The named
// townsfolk at payday draw on the same dole or go hungry, starve and die.
// Housing: capacity by dwelling type and era, crowding's harm, denser types
// where plots are scarce, the player's tenement let by the room.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { DataLoader } from '../core/dataLoader.js';
import { TownPoor } from '../systems/townPoor.js';
import { TownHousing } from '../world/townHousing.js';
import { TownLabour } from '../world/townLabour.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownJobs } from '../systems/townJobs.js';
import { NpcFamily } from '../systems/npcFamily.js';
import { Illness } from '../systems/illness.js';
import { Lots } from '../systems/lots.js';
import { LotBook } from '../world/lotBook.js';
import { Economy } from '../world/economy.js';

beforeAll(async () => { await loadData(); }, 120000);

// (data patched for a test, put back after)
const patched = [];
function patch(obj, key, value) { patched.push([obj, key, obj[key]]); obj[key] = value; }
afterEach(() => { while (patched.length) { const [o, k, v] = patched.pop(); o[k] = v; } });

let _game = null;
/** A generated world a few market days in (made once), and its biggest town with a market. */
function world101() {
    if (!_game) {
        _game = newGame(101);
        for (let i = 0; i < 12; i++) endDay(_game);
    }
    const w = _game.world;
    const v = w.getSettlementViews().filter(x => x.market && x.labour).sort((a, b) => b.population - a.population)[2];
    return { game: _game, world: w, s: w.getTile(v.q, v.r).settlement };
}

/** Strip a town's poor of every help, idle half its peasants: the bare budget. */
function bare(world, s) {
    const P = DataLoader._gamedata.townPoor;
    for (const k of ['saveShare']) patch(P, k, 0);
    patch(P, 'beg', { ...P.beg, share: 0 });
    patch(P, 'crime', { ...P.crime, share: 0 });
    patch(P, 'dayLabour', { ...P.dayLabour, perTrade: 0, perBuild: 0 });
    const p = TownPoor.ensure(s);
    p.sav = { peasants: 0, artisans: 0, merchants: 0 };
    p.pawn = 0;
    p.box = 0;
    p.h = {};
    delete p.cut;
    patch(s, 'guilds', null);
    patch(s, 'ordinances', {});
    const st = world.estates;
    if (st && st.holders) for (const h of Object.values(st.holders)) if (h.kind === 'church' || h.kind === 'noble') patch(h, 'purse', 0);
    const k = world.getKingdom(s.kingdom);
    if (k) { if (!k.laws) k.laws = {}; patch(k.laws, 'poorRelief', 'charity'); }
    patch(s.labour, 'idle', { ...s.labour.idle, land: 0.5 });
    return p;
}

describe('the poor pay to live: a class budget and each source of relief', () => {
    it('the idle earn nothing; with no help at all the want goes unbought, hunger rises and the poorest die', () => {
        const { world, s } = world101();
        bare(world, s);
        const pop0 = s.population;
        const r = TownPoor.turn(world, s, 4, world.day);
        expect(r.deficit).toBeGreaterThan(0);
        expect(r.unmet).toBeCloseTo(r.deficit, 1);
        expect(s.poor.cut.food).toBeGreaterThan(0);
        expect(s.poor.cut.clothes).toBeGreaterThan(0);
        let dead = 0;
        for (let i = 0; i < 40; i++) dead += TownPoor.turn(world, s, 4, world.day + i * 4).dead;
        expect(TownPoor.hunger(s, 'peasants')).toBeGreaterThan(0.12);
        expect(dead).toBeGreaterThan(0);
        expect(s.population).toBe(pop0 - dead);
        // (and the hunger weighs on the peasants' welfare at the next labour turn)
        const wel0 = s.labour.wel.peasants;
        TownLabour.update(s, { day: world.day + 200, k: 4, col: 1 });
        expect(s.labour.wel.peasants).toBeLessThan(wel0);
        patch(s, 'population', pop0);
    });

    it('savings carry them first; then day labour for the idle', () => {
        const { world, s } = world101();
        const p = bare(world, s);
        p.sav = { peasants: 1e6, artisans: 0, merchants: 0 };
        let r = TownPoor.turn(world, s, 4, world.day);
        expect(r.by.savings).toBeGreaterThan(0);
        expect(r.unmet).toBe(0);
        p.sav = { peasants: 0, artisans: 0, merchants: 0 };
        patch(DataLoader._gamedata.townPoor, 'dayLabour', { perTrade: 1, perBuild: 6, wage: 0.7, maxShare: 0.6 });
        patch(s.market, 'trade', { in: 400, out: 400 });
        r = TownPoor.turn(world, s, 4, world.day);
        expect(r.by.dayLabour).toBeGreaterThan(0);
    });

    it("the church's alms are real coin: out of its estate purse, into the town's", () => {
        const { world, s } = world101();
        bare(world, s);
        const ch = TownPoor._church(world, s) || (world.estates.holders[`church:${s.kingdom}`] = { id: `church:${s.kingdom}`, kind: 'church', purse: 0 });
        patch(ch, 'purse', 200000);
        const town0 = s.economy.gold, ch0 = ch.purse;
        const r = TownPoor.turn(world, s, 4, world.day);
        expect(r.by.church).toBeGreaterThan(0);
        expect(ch0 - ch.purse).toBeCloseTo(r.by.church, 2);
        expect(s.economy.gold - town0).toBeCloseTo(r.by.church, 2);
    });

    it('a poor rate (the law, or the town\'s own) and the crown\'s dole feed them; the dole from the treasury, booked', () => {
        const { world, s } = world101();
        bare(world, s);
        const k = world.getKingdom(s.kingdom);
        let r = TownPoor.turn(world, s, 4, world.day);
        const unmet0 = r.unmet;
        TownPoor.setRate(null, world, s, true);
        expect(TownPoor.relief(world, s)).toBe('rate');
        r = TownPoor.turn(world, s, 4, world.day);
        expect(r.by.rate).toBeGreaterThan(0);
        expect(r.unmet).toBeLessThan(unmet0);
        k.laws.poorRelief = 'crownDole';
        patch(k, 'treasury', 500000);
        const t0 = k.treasury, town0 = s.economy.gold;
        r = TownPoor.turn(world, s, 4, world.day);
        expect(r.by.crown).toBeGreaterThan(0);
        expect(t0 - k.treasury).toBeCloseTo(r.by.crown, 2);
        expect(s.economy.gold - town0).toBeCloseTo(r.by.crown, 2);
    });

    it("the player endows an almshouse: their coin into its box, paid out as the dole into the town's purse", () => {
        const { game, world, s } = world101();
        bare(world, s);
        const pl = game.player;
        patch(pl, 'gold', 5000);
        const res = TownPoor.give(pl, world, s, 200);
        expect(res.success).toBe(true);
        expect(res.founded).toBe(true);
        expect(pl.gold).toBe(4800);
        expect(s.poor.box).toBe(200);
        expect(s.poor.almshouse.by).toBe('player');
        const town0 = s.economy.gold;
        const r = TownPoor.turn(world, s, 4, world.day);
        expect(r.by.box).toBeGreaterThan(0);
        expect(200 - s.poor.box).toBeCloseTo(r.by.box, 2);
        expect(s.economy.gold - town0).toBeCloseTo(r.by.box, 2);
        expect(TownPoor.give(pl, world, s, 1e9).success).toBe(false);
    });

    it('in good times the classes put by and nobody goes short', () => {
        const { world, s } = world101();
        const p = TownPoor.ensure(s);
        patch(s.labour, 'idle', { land: 0, craft: 0, trade: 0 });
        p.sav = { peasants: 0, artisans: 0, merchants: 0 };
        const r = TownPoor.turn(world, s, 4, world.day);
        expect(r.unmet).toBe(0);
        expect(p.sav.artisans + p.sav.merchants).toBeGreaterThan(0);
        expect(p.cut).toBeUndefined();
    });
});

// ── The named townsfolk ──

function makeTown(day = 1) {
    const town = { name: 'Ashford', type: 'town', q: 5, r: 7, population: 2000, economy: { gold: 4000 }, kingdom: 0 };
    const kingdom = { id: 0, religion: { faithId: 'solaris', piety: 50 } };
    const world = { day, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [], town, getSettlementViews: () => [town], getKingdom: (id) => (id === 0 ? kingdom : null), getTile: () => ({ settlement: town }) };
    const npcs = [];
    let id = 0;
    for (const [type, n] of Object.entries({ villager: 20, merchant: 3, farmer: 3, priest: 1, blacksmith_npc: 1, child: 3 })) for (let i = 0; i < n; i++) npcs.push({ id: id++, type, name: 'Ada', age: type === 'child' ? 9 : 22 + ((i * 7) % 30) });
    let sd = 77;
    NpcFamily.generateFamilies(npcs, () => { sd = (sd * 1664525 + 1013904223) & 0x7fffffff; return sd / 0x7fffffff; });
    Townsfolk.attach(town, world, npcs, { q: 5, r: 7, target: 24 });
    TownJobs.ensure(town.folk, town, world, day);
    return { world, s: town, folk: town.folk };
}

/** A grown jobless resident with an empty purse and no children to keep. */
function pauper(folk, day) {
    const p = Townsfolk.residents(folk).find(x => Townsfolk.age(x, day) >= 20 && x.role === 'villager' && !(x.kids || []).length);
    p.job = { id: 'unemployed', rank: 'master', since: 1 };
    p.purse = 0;
    return p;
}

describe('the named poor: bread from their purse, the dole, or hunger', () => {
    it('one who cannot pay their board goes hungry, starving the seasons after; the almshouse box feeds them', () => {
        const { world, s, folk } = makeTown(31);
        const p = pauper(folk, 31);
        TownJobs.payday(world, s, folk, 31, 30);
        expect(p.hungry).toBe(31);
        expect(p.starve).toBe(1);
        expect(p.diet).toBe('starving');
        expect(Townsfolk.status(p, world).text).toMatch(/gaunt|starving/);
        // ...sickens the more easily
        const env = { env: 1, town: 1, hygiene: 1 };
        const fed = { ...p, hungry: null, starve: 0 };
        expect(Illness.risk(p, 'fever', env, 2, 31)).toBeGreaterThan(Illness.risk(fed, 'fever', env, 2, 31));
        // The box: real coin, from it into the town's purse as their bread
        s.poor = { v: 1, sav: {}, h: {}, box: 100, pawn: 8 };
        p.purse = 0;
        const g0 = s.economy.gold;
        TownJobs.payday(world, s, folk, 61, 30);
        expect(p.dole).toBe(61);
        expect(s.poor.box).toBeLessThan(100);
        const out = 100 - s.poor.box;
        // (the town paid the others' board too: only the box's part is checked)
        expect(s.economy.gold).toBeGreaterThan(g0 - 1e6);
        expect(out).toBeGreaterThan(0);
        expect(p.starve).toBeUndefined();
    });

    it('starving seasons in a hungry town may kill them; or they take day labour where the town hires, or leave', () => {
        const { world, s, folk } = makeTown(31);
        const N = DataLoader._gamedata.townPoor.named;
        const a = pauper(folk, 31);
        a.starve = 2;
        s.poor = { v: 1, sav: {}, h: { peasants: 0.2 }, hunger: 0.1, box: 0, by: {} };
        patch(N, 'dieChance', 1);
        let r = TownJobs._hungerSeason(world, s, folk, 31, []);
        expect(r.died).toBeGreaterThan(0);
        expect(a.died).toBe(31);
        expect(a.cause).toBe('hunger and want');
        const b = pauper(folk, 31);
        b.starve = 1;
        s.poor.by = { dayLabour: 0.3 };
        patch(N, 'labourChance', 1);
        r = TownJobs._hungerSeason(world, s, folk, 31, []);
        expect(b.job.id).toBe('labourer');
        const c = pauper(folk, 31);
        c.starve = 1;
        c.spouse = null;
        s.poor.by = {};
        patch(N, 'leaveChance', 1);
        r = TownJobs._hungerSeason(world, s, folk, 31, []);
        expect(c.away && c.away.to).toBeTruthy();
    });
});

// ── Housing ──

const town = (type, pop, era = null) => ({ name: `H-${type}`, type, population: pop, q: 1, r: 1, ...(era ? { townEra: { history: [[era, 0, 1]] } } : {}) });

describe('housing: capacity, crowding, denser types', () => {
    it('capacity is the sum of its dwellings by type (a stone tenement holds more), a little over its people at first', () => {
        const C = TownHousing.config();
        for (const [type, pop] of [['village', 300], ['town', 2000], ['city', 8000], ['capital', 15000]]) {
            const s = town(type, pop);
            const h = TownHousing.ensure(s);
            let cap = 0;
            for (const [id, n] of Object.entries(h.d)) cap += n * TownHousing.people(s, id);
            expect(TownHousing.capacity(s)).toBe(Math.round(cap));
            expect(TownHousing.capacity(s)).toBeGreaterThanOrEqual(pop);
            expect(TownHousing.capacity(s)).toBeLessThan(pop * 1.2);
            expect(TownHousing.crowd(s)).toBeLessThan(1);
        }
        expect(TownHousing.ensure(town('village', 300)).d.tenement).toBeUndefined();
        expect(TownHousing.ensure(town('capital', 15000)).d.tenement).toBeGreaterThan(0);
        expect(TownHousing.people(town('city', 1, 'stone'), 'tenement')).toBeCloseTo(C.types.tenement.people * C.eraMult.tenement.stone, 6);
        expect(TownHousing.people(town('city', 1, 'timber'), 'tenement')).toBe(C.types.tenement.people);
        // (an era that raises none: no tenements in the hearth age)
        expect(TownHousing.allowed(town('city', 1, 'hearth'), 'tenement')).toBe(false);
    });

    it('overcrowding: lodgers in rooms let, then rough sleepers; rents, sickness, fire up; welfare and growth down', () => {
        const s = town('town', 2000);
        TownHousing.ensure(s);
        const cap = TownHousing.capacity(s);
        expect(TownHousing.over(s)).toBe(0);
        expect(TownHousing.growthFactor(s)).toBe(1);
        const rent0 = Lots.rentFor(s);
        s.population = Math.round(cap * 1.08);
        const L1 = TownHousing.lodgers(s);
        expect(L1.lodged).toBeGreaterThan(0);
        expect(L1.rough).toBe(0);
        const mild = TownHousing.over(s);
        s.population = Math.round(cap + TownHousing.rooms(s) + cap * 0.1);
        expect(TownHousing.lodgers(s).rough).toBeGreaterThan(0);
        expect(TownHousing.over(s)).toBeGreaterThan(mild);
        expect(TownHousing.rentMult(s)).toBeGreaterThan(1);
        expect(Lots.rentFor(s)).toBeGreaterThan(rent0);
        expect(TownHousing.sickMult(s)).toBeGreaterThan(1);
        expect(TownHousing.fireMult(s)).toBeGreaterThan(1);
        expect(TownHousing.welfarePenalty(s)).toBeGreaterThan(0);
        expect(TownHousing.growthFactor(s)).toBeLessThan(1);
        // ...and its builders set to work, the timber and stone off the market
        const b = TownHousing.week(s, 7);
        expect(b.begun).toBeGreaterThan(0);
        // under capacity: empty houses, cheaper rents
        s.population = Math.round(cap * 0.6);
        expect(TownHousing.rentMult(s)).toBeLessThan(1);
    });

    it('denser types where plots are scarce: row houses and tenements in a city, a house in a village', () => {
        const c = town('city', 8000, 'stone');
        const h = TownHousing.ensure(c);
        h.plots = h.foot;
        expect(TownHousing.scarce(c)).toBe(true);
        const picks = new Set();
        for (let i = 0; i < 4; i++) { const id = TownHousing.nextDwellingType(c); picks.add(id); TownHousing.addDwelling(c, id); }
        for (const id of picks) expect(['tenement', 'row']).toContain(id);
        expect(picks.has('tenement')).toBe(true);
        const v = town('village', 300);
        const hv = TownHousing.ensure(v);
        hv.plots = hv.foot;
        expect(['cottage', 'house']).toContain(TownHousing.nextDwellingType(v));
        // with ground to spare a city builds its own mix
        const c2 = town('city', 8000, 'stone');
        TownHousing.ensure(c2).plots += 500;
        expect(TownHousing.scarce(c2)).toBe(false);
        expect(TownHousing.allowed(c2, TownHousing.nextDwellingType(c2))).toBe(true);
        // a fire takes its houses, not its plots
        const before = TownHousing.capacity(c2);
        TownHousing.lose(c2, 0.25);
        expect(TownHousing.capacity(c2)).toBeLessThan(before * 0.8);
    });

    it('the player raises a tenement on their lot and lets it by the room; rents come from the town purse, the town houses more', () => {
        const s = { name: 'Lotby', type: 'city', population: 6000, q: 5, r: 6, kingdom: 'k1' };
        Economy.initSettlement(s);
        s.economy.gold = 5000;
        const tile = { q: 5, r: 6, settlement: s };
        const world = { day: 10, generationParams: { seed: 31 }, getTile: () => tile, getSettlementViews: () => [s], getKingdom: () => null };
        const pl = { gold: 5000, name: 'Ada', financeToday: { income: {}, expenses: {} } };
        expect(Lots.buyLot(pl, world, s, { id: 'lot0', w: 6, h: 6 }).success).toBe(true);
        const g0 = pl.gold;
        const res = Lots.buildTenementOnLot(pl, world, s, 'lot0', 'tenement');
        expect(res.success).toBe(true);
        expect(pl.gold).toBe(g0 - Lots.tenementCost(s, 'tenement'));
        const b = LotBook.lot(s, 'lot0').built;
        expect(b.rooms).toBeGreaterThan(4);
        expect(b.type).toBe('tenement');
        // a village can't take one
        expect(Lots.mayBuildTenement({ type: 'village' }, 'tenement')).toBe(false);
        TownHousing.ensure(s);
        const cap0 = TownHousing.capacity(s);
        s.population = Math.round(cap0 * 1.1);
        world.day = b.readyDay;
        expect(TownPoor.countLots(s, world.day)).toBe(1);
        expect(TownHousing.capacity(s)).toBeGreaterThan(cap0);
        const coin0 = pl.gold + s.economy.gold;
        for (let i = 0; i < 60; i++) { world.day++; Lots.processDay(world, pl); }
        expect(b.lodgers.length).toBeGreaterThan(0);
        expect(pl.gold).toBeGreaterThan(g0 - Lots.tenementCost(s, 'tenement'));
        // (the rent moved from the town's purse to the player's: no coin made)
        expect(pl.gold + s.economy.gold).toBeCloseTo(coin0, 2);
        const row = Lots.holdingsView(world, pl)[0];
        expect(row.rooms).toBe(b.rooms);
        expect(row.lodgers).toBe(b.lodgers.length);
    });
});
