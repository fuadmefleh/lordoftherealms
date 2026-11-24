/**
 * Lesser punishments and penal labour (systems/penalLabour.js): the realm's
 * laws gate the lash, the iron, the mines and the oar; each sentence's real
 * effects on a townsperson (the body, the pillory, the brand read by the
 * watch and the trades, the town soured and cowed); convicts at the player's
 * mine (output, rations) and ship (unpaid berths, a sullen bench, mutiny),
 * the crown's gangs (ore to the capital's market and coin to the chests, the
 * oars cutting the royal fleet's upkeep); terms ending, deaths and escapes;
 * the realms' own courts; the player flogged, pilloried and sent to the mines
 * (labour, escape with a warrant, ransom into the crown's chests).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PenalLabour } from '../systems/penalLabour.js';
import { Trials } from '../player/trials.js';
import { Executions } from '../systems/executions.js';
import { MaimMarks } from '../systems/maimMarks.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Ships } from '../systems/ships.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Wanted } from '../systems/wanted.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(11));

// Tuning overrides restored after each test
const _saved = [];
function tune(section, patch) {
    const C = DataLoader._gamedata.penalLabour[section];
    _saved.push([C, { ...C }]);
    Object.assign(C, patch);
}
afterEach(() => { while (_saved.length) { const [C, old] = _saved.pop(); for (const k of Object.keys(C)) delete C[k]; Object.assign(C, old); } });

const Y = 120;
function person(id, first, last, role = 'villager', extra = {}) {
    return { id, first, last, gender: 'male', born: 1000 - 30 * Y, role, traits: [], parents: [], kids: [], spouse: null, log: [], ...extra };
}

function makeWorld(laws = {}) {
    const folk = {
        q: 4, r: 4, annals: [], people: [
            person(1, 'Ella', 'Cobb', 'villager', { gender: 'female' }),
            person(2, 'Tom', 'Reed', 'farmer'),
            person(3, 'Hugh', 'Marlow', 'noble'),
            person(4, 'Piers', 'Quill', 'priest'),
            person(5, 'Wat', 'Tyler', 'merchant', { purse: 40 }),
            person(6, 'Jack', 'Straw', 'laborer'),
        ],
    };
    const capFolk = { q: 9, r: 9, annals: [], people: [person(20, 'Joan', 'Ash', 'merchant', { gender: 'female' })] };
    const ashford = { name: 'Ashford', type: 'town', q: 4, r: 4, population: 1200, kingdom: 'k1', economy: { gold: 500 }, folk, happiness: 60, npcCrimes: [] };
    const capital = { name: 'Valden', type: 'capital', q: 9, r: 9, population: 6000, kingdom: 'k1', economy: { gold: 3000 }, folk: capFolk, happiness: 60 };
    const k1 = { id: 'k1', name: 'Valdor', ruler: 'Aldric', isAlive: true, capital: { q: 9, r: 9 }, treasury: 1000, territory: [{ q: 4, r: 4 }, { q: 9, r: 9 }], laws: { punishment: 'standard', corporal: 'iron', penalLabour: 'oars', ...laws }, lord: { name: 'Aldric', traits: [], memory: [] } };
    const towns = { '4,4': ashford, '9,9': capital };
    const extra = {};
    return {
        day: 1000, generationParams: { seed: 7 }, units: [], kingdoms: [k1], width: 40,
        ashford, capital, k1, folk, extra,
        getTile: (q, r) => extra[`${q},${r}`] || (towns[`${q},${r}`] ? { q, r, settlement: towns[`${q},${r}`] } : { q, r }),
        getKingdom: id => (id === 'k1' ? k1 : null),
        getSettlementViews: () => [ashford, capital],
    };
}

function makePlayer(extra = {}) {
    return { name: 'Ash', q: 4, r: 4, gold: 500, health: 100, maxHealth: 100, karma: 0, renown: 10, reputation: {}, charisma: 5, strength: 5, skills: {}, inventory: {}, properties: [], ships: [], army: [], ...extra };
}

const get = (w, pid) => Townsfolk.get(w.folk, pid);
const sentence = (w, p, pid, s, crimeId = 'theft', sev = 2, extra = {}) => PenalLabour.sentenceFolk(p, w, { settlement: w.ashford, folk: w.folk, person: get(w, pid), sentence: s, crimeId, severity: sev, kingdomId: 'k1', by: p ? 'player' : 'crown', guilty: true, ...extra });

/** A case before the player's court in Ashford. */
function aCase(w, p, pid, crime = 'theft', severity = 2) {
    const st = Trials.state(p);
    const c = { id: st.next++, q: 4, r: 4, key: '4,4', town: 'Ashford', kingdomId: 'k1', opened: w.day, expires: w.day + 12, crime, crimeLabel: crime, severity, accused: { name: Townsfolk.name(get(w, pid)), pid }, victim: { name: 'Ella Cobb', pid: 1 }, proof: 3, guilty: true, source: 'record', witnesses: [] };
    st.cases.push(c);
    return c;
}

describe('the realm\'s laws decide which sentences exist', () => {
    it('the stocks only: no lash, no iron, no labour; the lash and the iron, the mines and the oars where the law has them', () => {
        const soft = makeWorld({ corporal: 'stocks', penalLabour: 'none' });
        expect(PenalLabour.allowed(soft, 'k1', 'stocks').ok).toBe(true);
        expect(PenalLabour.allowed(soft, 'k1', 'flog').ok).toBe(false);
        expect(PenalLabour.allowed(soft, 'k1', 'brand').ok).toBe(false);
        expect(PenalLabour.allowed(soft, 'k1', 'mines').ok).toBe(false);
        const lash = makeWorld({ corporal: 'lash', penalLabour: 'mines' });
        expect(PenalLabour.allowed(lash, 'k1', 'flog').ok).toBe(true);
        expect(PenalLabour.allowed(lash, 'k1', 'brand').ok).toBe(false);
        expect(PenalLabour.allowed(lash, 'k1', 'mines').ok).toBe(true);
        expect(PenalLabour.allowed(lash, 'k1', 'galleys').ok).toBe(false);
        const hard = makeWorld();
        for (const s of ['flog', 'brand', 'mines', 'galleys', 'stocks', 'outlaw']) expect(PenalLabour.allowed(hard, 'k1', s).ok).toBe(true);
        // A sentence the law forbids is refused outright
        expect(sentence(soft, makePlayer(), 6, 'flog').ok).toBe(false);
    });

    it('the court offers only the sentences the law allows; the harsh law lays on more lashes and longer terms', () => {
        const soft = makeWorld({ corporal: 'stocks', penalLabour: 'none' });
        const p = makePlayer();
        const ids = Trials.verdicts(soft, aCase(soft, p, 6), p).map(v => v.id);
        expect(ids).toContain('stocks');
        expect(ids).not.toContain('flog');
        expect(ids).not.toContain('brand');
        expect(ids).not.toContain('mines');
        const hard = makeWorld();
        const ids2 = Trials.verdicts(hard, aCase(hard, p, 6), p).map(v => v.id);
        for (const id of ['flog', 'brand', 'mines', 'galleys', 'outlaw']) expect(ids2).toContain(id);
        const harsh = makeWorld({ punishment: 'harsh' });
        expect(PenalLabour.lashes(harsh, 'k1', 2)).toBeGreaterThan(PenalLabour.lashes(hard, 'k1', 2));
        expect(PenalLabour.termDays(harsh, 'k1', 3)).toBeGreaterThan(PenalLabour.termDays(hard, 'k1', 3));
    });

    it('harder law cows the town\'s thieves', () => {
        const soft = makeWorld({ corporal: 'stocks', penalLabour: 'none' });
        const hard = makeWorld();
        expect(PenalLabour.deterrence(soft, soft.ashford)).toBe(1);
        expect(PenalLabour.deterrence(hard, hard.ashford)).toBeLessThan(1);
    });
});

describe('each sentence on a townsperson', () => {
    it('flogged by the player\'s court: hurt, remembered, the post in the square, the town cowed and soured', () => {
        tune('flog', { deathPerLash: 0 });
        const w = makeWorld();
        const p = makePlayer();
        const c = aCase(w, p, 6);
        const before = w.ashford.happiness;
        const r = Trials.rule(p, w, c.id, 'flog');
        expect(r.success).toBe(true);
        const jack = get(w, 6);
        expect(jack.died).toBeUndefined();
        expect(Townsfolk.injury(jack, w.day)).toBeTruthy();
        expect(jack.lashed).toBe(1);
        expect(jack.log.some(e => e.k === 'penal' && /flogged/.test(e.x))).toBe(true);
        expect((jack.nm || []).some(e => e.k === 'flogged')).toBe(true);
        expect(w.ashford.pillory.why).toBe('flogging');
        expect(w.ashford.penalFear.m).toBeLessThan(1);
        expect(PenalLabour.deterrence(w, w.ashford)).toBeLessThan(PenalLabour.deterrence(makeWorld(), makeWorld().ashford));
        expect(r.text).toMatch(/lash/);
        expect(w.ashford.happiness).not.toBe(before);
    });

    it('enough lashes on an old back can kill', () => {
        tune('flog', { deathPerLash: 1, deathMax: 1 });
        const w = makeWorld();
        const r = sentence(w, makePlayer(), 4, 'flog', 'murder', 4);
        expect(r.ok).toBe(true);
        expect(r.died).toBe(true);
        expect(get(w, 4).died).toBe(w.day);
        expect(get(w, 4).cause).toMatch(/lash/);
    });

    it('the pillory: the square\'s pillory stands for them, they do no work while they sit', () => {
        const w = makeWorld();
        const p = makePlayer();
        const c = aCase(w, p, 6, 'brawl', 1);
        expect(Trials.rule(p, w, c.id, 'stocks').success).toBe(true);
        expect(w.ashford.pillory.ref).toBe('pen6');
        expect(w.ashford.pillory.until).toBeGreaterThan(w.day);
        expect(get(w, 6).jailedUntil).toBeGreaterThan(w.day);
        expect((get(w, 6).nm || []).some(e => e.k === 'pilloried')).toBe(true);
    });

    it('branded: the court\'s letter for life, watched by the watch, shunned by the trades, read in talk; never twice', () => {
        const w = makeWorld();
        const p = makePlayer();
        const wat = get(w, 5);
        const work = MaimMarks.workFactor(wat, 'merchant');
        const r = sentence(w, p, 5, 'brand', 'theft', 2);
        expect(r.ok).toBe(true);
        expect(MaimMarks.has(wat, 'brand')).toBe(true);
        expect(wat.brandMark.l).toBe('T');
        expect(PenalLabour.watchedMult(wat)).toBeGreaterThan(1);
        expect(PenalLabour.watchedMult(get(w, 2))).toBe(1);
        expect(MaimMarks.workFactor(wat, 'merchant')).toBeLessThan(work);
        expect(PenalLabour.markAside(wat)).toMatch(/thief's T/);
        expect(PenalLabour.brandReply(wat, w, p)).toMatch(/court|iron/i);
        expect(sentence(w, p, 5, 'brand').ok).toBe(false);
        // A brand already borne takes the iron off the court's list
        const ids = Trials.verdicts(w, aCase(w, p, 5), p).map(v => v.id);
        expect(ids).not.toContain('brand');
    });

    it('outlawed: their purse forfeit to the court, gone to the greenwood', () => {
        const w = makeWorld();
        const p = makePlayer();
        const gold = p.gold;
        const r = sentence(w, p, 5, 'outlaw', 'assault', 2);
        expect(r.ok).toBe(true);
        expect(get(w, 5).away.to).toBe('the greenwood');
        expect(p.gold).toBeGreaterThan(gold);
        // Not for a petty crime
        expect(sentence(w, p, 6, 'outlaw', 'brawl', 1).ok).toBe(false);
    });
});

/** The player's mine at (6, 6). */
function withMine(w, p) {
    const prop = { type: 'mine', name: 'Mine', produces: 'iron', productionRate: 3, level: 1, upkeep: 15, storage: 0 };
    w.extra['6,6'] = { q: 6, r: 6, playerProperties: [prop], playerProperty: prop };
    p.properties.push({ q: 6, r: 6, type: 'mine', name: 'Mine', produces: 'iron' });
    return prop;
}

describe('convicts at the player\'s mine', () => {
    it('a convict leaves town for a term at your mine: real output, bread bought in town, home at the term\'s end', () => {
        const w = makeWorld();
        const p = makePlayer();
        const mine = withMine(w, p);
        const c = aCase(w, p, 6, 'theft', 2);
        const r = Trials.rule(p, w, c.id, 'mines');
        expect(r.success).toBe(true);
        const jack = get(w, 6);
        expect(jack.away.convict).toBeTruthy();
        expect(Townsfolk.isHere(jack)).toBe(false);
        const conv = PenalLabour.state(p).convicts[0];
        expect(conv.site).toBe('prop:6,6:mine');
        expect(mine.convicts).toBe(1);
        expect(PenalLabour.mineStaffing(mine, 1)).toBeCloseTo(1.1, 5);
        expect(PenalLabour.mineStaffing({ type: 'farm', convicts: 3 }, 1)).toBe(1);
        // A day: the bread money from your purse into the nearest town's
        tune('mines', { deathPerWeek: 0, escapePerWeek: 0 });
        const gold = p.gold, town = w.ashford.economy.gold + w.capital.economy.gold;
        w.day += 1;
        PenalLabour.processDay(w, p);
        expect(p.gold).toBeLessThan(gold);
        expect(Utils.cents(w.ashford.economy.gold + w.capital.economy.gold - town)).toBeCloseTo(Utils.cents(gold - p.gold), 2);
        // The term served: home, hurt and changed
        w.day = conv.until;
        const out = PenalLabour.processDay(w, p);
        expect(Townsfolk.isHere(jack)).toBe(true);
        expect(jack.served.k).toBe('mines');
        expect(jack.log.some(e => e.k === 'penal' && /came home/.test(e.x))).toBe(true);
        expect(PenalLabour.state(p).convicts.length).toBe(0);
        expect(mine.convicts).toBeUndefined();
        expect(out.notices.some(n => n.title === 'A Term Served')).toBe(true);
    });

    it('convicts die at the work, or break out', () => {
        const w = makeWorld();
        const p = makePlayer();
        withMine(w, p);
        tune('mines', { deathPerWeek: 7, escapePerWeek: 0 });
        expect(sentence(w, p, 6, 'mines').ok).toBe(true);
        w.day += 1;
        PenalLabour.processDay(w, p);
        expect(get(w, 6).died).toBe(w.day);
        expect(get(w, 6).cause).toMatch(/mines/);
        tune('mines', { deathPerWeek: 0, escapePerWeek: 7 });
        expect(sentence(w, p, 2, 'mines').ok).toBe(true);
        w.day += 1;
        PenalLabour.processDay(w, p);
        expect(get(w, 2).away.escaped).toBe(true);
        expect(PenalLabour.state(p).stats.died).toBe(1);
        expect(PenalLabour.state(p).stats.escaped).toBe(1);
    });
});

describe('convicts at the oar', () => {
    const galleyShip = (extra = {}) => ({ id: 'ship_1', typeId: 'war_galley', name: 'Gull', q: 4, r: 4, status: 'docked', condition: 100, customizations: [], cargo: {}, crew: 10, morale: 70, ...extra });

    it('an empty berth filled with a convict: one more hand, no wage, a sullener ship', () => {
        const w = makeWorld();
        const ship = galleyShip();
        const p = makePlayer({ ships: [ship] });
        const wages = Ships.getDailyWages(ship);
        expect(sentence(w, p, 6, 'galleys').ok).toBe(true);
        expect(ship.crew).toBe(11);
        expect(ship.convictOars).toBe(1);
        expect(Ships.getDailyWages(ship)).toBe(wages);
        expect(Ships.convictMoraleShift(ship)).toBeLessThan(0);
        // The ship's resting morale sinks with the bench
        ship.morale = 70;
        Ships._payCrews(p, [ship], w);
        expect(ship.morale).toBeLessThan(70);
    });

    it('a big sullen bench at sea rises: convicts gone with the boats, hands killed', () => {
        tune('galleys', { mutiny: { share: 0.1, morale: 90, perDay: 1, killed: [1, 1], morale_after: -15 }, deathPerWeek: 0, escapeAtSeaPerWeek: 0 });
        const w = makeWorld();
        const ship = galleyShip({ crew: 4 });
        const p = makePlayer({ ships: [ship] });
        expect(sentence(w, p, 6, 'galleys').ok).toBe(true);
        expect(sentence(w, p, 2, 'galleys').ok).toBe(true);
        ship.status = 'at_sea';
        ship.morale = 30;
        w.day += 1;
        const out = PenalLabour.processDay(w, p);
        expect(out.notices.some(n => n.title === 'Mutiny at the Oars')).toBe(true);
        expect(PenalLabour.state(p).convicts.length).toBe(0);
        expect(ship.crew).toBe(3);
        expect(get(w, 6).away.escaped).toBe(true);
    });

    it('a war galley\'s bench rows without wages: its upkeep is cut', () => {
        const w = makeWorld();
        const unit = PlayerMilitary.makeArmyUnit(PlayerMilitary.UNIT_TYPES.WAR_GALLEY);
        unit.domain = 'sea';
        const p = makePlayer({ army: [unit] });
        const upkeep = PlayerMilitary.getUpkeepCost(p);
        expect(sentence(w, p, 6, 'galleys').ok).toBe(true);
        expect(sentence(w, p, 2, 'galleys').ok).toBe(true);
        expect(unit.convictOars).toBe(2);
        expect(PlayerMilitary.getUpkeepCost(p)).toBeLessThan(upkeep);
    });
});

describe('the crown\'s gangs', () => {
    it('with no site of yours, the crown takes them: ore for the capital\'s market, its price into the chests, bread from the chests', () => {
        const w = makeWorld();
        expect(sentence(w, null, 6, 'mines', 'theft', 3).ok).toBe(true);
        expect(sentence(w, null, 2, 'mines', 'theft', 3).ok).toBe(true);
        const W = PenalLabour.worldState(w);
        expect(W.crown.length).toBe(2);
        tune('mines', { deathPerWeek: 0, escapePerWeek: 0, crownGoods: ['iron'] });
        const stock = (SettlementMarket.ensure(w.capital).stock.iron || 0);
        const coin = w.k1.treasury + w.ashford.economy.gold + w.capital.economy.gold;
        w.day = 1004; // (the courts' day: day % 7 === 3)
        PenalLabour.processDay(w, null);
        expect(SettlementMarket.ensure(w.capital).stock.iron).toBeGreaterThan(stock);
        expect(W.stats.crownOre).toBeGreaterThan(0);
        // Coin only moved, purse to chests and chests to towns
        expect(Utils.cents(w.k1.treasury + w.ashford.economy.gold + w.capital.economy.gold)).toBeCloseTo(Utils.cents(coin), 2);
    });

    it('the crown\'s galley convicts cut the royal fleet\'s upkeep', () => {
        const w = makeWorld();
        expect(sentence(w, null, 6, 'galleys', 'murder', 4).ok).toBe(true);
        tune('galleys', { deathPerWeek: 0, escapeDockedPerWeek: 0 });
        w.k1.navy = { strength: 40, _init: true, blockades: {} };
        w.day = 1004;
        PenalLabour.processDay(w, null);
        expect(w.k1.navy.convictOars).toBe(1);
        const k2 = { id: 'k2', name: 'Other', treasury: 10000, territory: [], navy: { strength: 40, _init: true, blockades: {} } };
        const k3 = { id: 'k3', name: 'Oared', treasury: 10000, territory: [], navy: { strength: 40, _init: true, blockades: {}, convictOars: 20 } };
        const ww = { getTile: () => null, getSettlementViews: () => [], kingdoms: [k2, k3] };
        KingdomNavy.updateFleet(k2, ww);
        KingdomNavy.updateFleet(k3, ww);
        expect(k3.treasury).toBeGreaterThan(k2.treasury);
    });

    it('the realms\' own courts sentence the caught on a town\'s record, by the law', () => {
        tune('realm', { act: 1 });
        const w = makeWorld();
        w.ashford.npcCrimes.push({ id: 'c1', k: 'brawl', byPid: 6, d: 999, caught: true });
        w.ashford.npcCrimes.push({ id: 'c2', k: 'burglary', byPid: 2, d: 999, caught: true });
        w.day = 1004;
        PenalLabour.processDay(w, null);
        expect(w.ashford.npcCrimes[0].penal).toBe('flog');
        expect(['brand', 'mines']).toContain(w.ashford.npcCrimes[1].penal);
        expect(get(w, 6).lashed || get(w, 6).died != null).toBeTruthy();
        // The soft law: only the pillory for the brawler
        const soft = makeWorld({ corporal: 'stocks', penalLabour: 'none' });
        soft.ashford.npcCrimes.push({ id: 'c1', k: 'brawl', byPid: 6, d: 999, caught: true });
        soft.day = 1004;
        PenalLabour.processDay(soft, null);
        expect(soft.ashford.npcCrimes[0].penal).toBe('stocks');
    });

    it('state survives a save', () => {
        const w = makeWorld();
        sentence(w, null, 6, 'mines', 'theft', 3);
        const saved = JSON.parse(JSON.stringify(PenalLabour.serialize(w)));
        const w2 = makeWorld();
        PenalLabour.restore(saved, w2);
        expect(PenalLabour.worldState(w2).crown.length).toBe(1);
    });
});

describe('the scaffold\'s mercy', () => {
    it('one condemned to die may be spared for the oar, where the law sends convicts', () => {
        const w = makeWorld();
        const p = makePlayer({ house: { name: 'House Ash', prestige: 50, generation: 1, history: [] } });
        const e = Executions.condemn(p, w, { kind: 'folk', q: 4, r: 4, pid: 6 }, { crime: 'murder', crimeLabel: 'murder', source: 'trial', ref: 1, guilty: true, quiet: true });
        expect(e).toBeTruthy();
        const m = Executions.mercies(p, w, e).find(x => x.id === 'galleys');
        expect(m && m.ok).toBe(true);
        const r = Executions.spare(p, w, e.id, 'galleys');
        expect(r.success).toBe(true);
        expect(get(w, 6).away.convict).toBeTruthy();
        expect(PenalLabour.worldState(w).crown.length).toBe(1);
        const soft = makeWorld({ penalLabour: 'none' });
        const e2 = Executions.condemn(p, soft, { kind: 'folk', q: 4, r: 4, pid: 2 }, { crime: 'murder', crimeLabel: 'murder', source: 'trial', ref: 2, guilty: true, quiet: true });
        expect(Executions.mercies(p, soft, e2).find(x => x.id === 'mines').ok).toBe(false);
    });
});

describe('the player sentenced', () => {
    it('flogged: health, a wound, the stripes counted, renown and the realm\'s regard lost', () => {
        const w = makeWorld();
        const p = makePlayer();
        const r = PenalLabour.sentencePlayer(p, w, 'flogged', { kingdomId: 'k1', town: 'Ashford', q: 4, r: 4, severity: 2, crime: 'theft' });
        expect(r.ok).toBe(true);
        expect(p.health).toBeLessThan(100);
        expect(p.renown).toBeLessThan(10);
        expect(p.reputation.k1).toBeLessThan(0);
        expect(PenalLabour.state(p).scars).toBe(1);
        expect(PenalLabour.playerMarks(p).some(m => m.label === 'The lash')).toBe(true);
    });

    it('pilloried: held a day in the stocks, the pillory up in the square', () => {
        const w = makeWorld();
        const p = makePlayer();
        p.jailState = { daysRemaining: 5, totalDays: 5, offense: 'theft', offenseNumber: 1, settlement: 'Ashford', q: 4, r: 4 };
        PenalLabour.sentencePlayer(p, w, 'pilloried', { kingdomId: 'k1', town: 'Ashford', q: 4, r: 4, jail: p.jailState });
        expect(p.jailState.daysRemaining).toBe(1);
        expect(p.jailState.offense).toBe('the pillory');
        expect(w.ashford.pillory.ref).toBe('penplayer');
    });

    it('the mines: the days are hard and the crown\'s; escape brings a warrant; a ransom goes into the crown\'s chests', () => {
        const w = makeWorld();
        const p = makePlayer({ gold: 5000 });
        const r = PenalLabour.sentencePlayer(p, w, 'mines', { kingdomId: 'k1', town: 'Ashford', q: 4, r: 4, days: 40, crime: 'murder' });
        expect(r.ok).toBe(true);
        const s = p.indenturedServitude;
        expect(s.penal.kind).toBe('mines');
        expect(s.daysRemaining).toBe(40);
        const upd = PlayerMilitary.processServitude(p, w);
        expect(upd.message).toMatch(/labour/);
        expect(s.daysRemaining).toBe(39);
        // The crown's gang counts you
        w.day = 1004;
        PenalLabour.processDay(w, p);
        expect(PenalLabour.worldState(w).stats.crownOre).toBeGreaterThan(0);
        // Ransomed: into the chests of the crown that sentenced you
        const t = w.k1.treasury;
        const cost = s.freedomCost;
        expect(PlayerMilitary.buyFreedom(p, w).success).toBe(true);
        expect(w.k1.treasury).toBeCloseTo(t + cost, 2);
        // Escaped: the crown wants you
        PenalLabour.sentencePlayer(p, w, 'galleys', { kingdomId: 'k1', town: 'Ashford', q: 4, r: 4, days: 30 });
        p.indenturedServitude.escapeChance = 1;
        expect(PlayerMilitary.attemptEscape(p, w).success).toBe(true);
        expect(Object.keys(Wanted.realm(p, 'k1').charges).some(l => /galleys/.test(l))).toBe(true);
    });

    it('convicted at trial where the law has the lash, a lesser repeat offence goes to the post or the pillory, not the cells', () => {
        const w = makeWorld();
        const kinds = new Set();
        for (let id = 1; id <= 40; id++) kinds.add(Trials._penalKind(w, { id, opened: 1, kingdomId: 'k1' }, 'jailed', 10, false));
        expect(kinds.has('flogged') || kinds.has('pilloried')).toBe(true);
        const grave = new Set();
        for (let id = 1; id <= 40; id++) grave.add(Trials._penalKind(w, { id, opened: 1, kingdomId: 'k1' }, 'jailed', 60, true));
        expect(grave.has('mines') || grave.has('galleys')).toBe(true);
        // Where the law keeps no iron, the brand becomes the cells
        const soft = makeWorld({ corporal: 'stocks', penalLabour: 'none' });
        expect(Trials._penalKind(soft, { id: 1, opened: 1, kingdomId: 'k1' }, 'branded', 60, true)).toBe('jailed');
    });
});
