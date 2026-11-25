// The fate of prisoners, beyond the field battle (player/prisonerFates.js): men who yield in a stormed
// lair, in a stormed town's breach, on a deck (world/warStakes.js yieldUp → PrisonerFates.collect); a
// broken rebel host judged through its rising's own aftermath (systems/peasantRevolts.js); outlaws let
// go who really ride again (a world unit); raiders and pirates turned away by the stakes (world/units.js);
// and a captured lord of a rival House's blood: his House pays toward his ransom out of its own purse,
// and his death or maiming in your keeping is a blood feud (systems/interrogation.js, systems/bloodFeuds.js).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PrisonerFates } from '../player/prisonerFates.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Interrogation } from '../systems/interrogation.js';
import { Sieges } from '../systems/sieges.js';
import { SeaFights } from '../systems/seaFights.js';
import { BloodFeuds } from '../systems/bloodFeuds.js';
import { WarStakes } from '../world/warStakes.js';
import { WorldUnit } from '../world/units.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) { DataLoader.clearCache(); await DataLoader.initializeAll(); }
});

let saved;
let savedInt;
beforeEach(() => { Utils.setSeed(777); saved = DataLoader._gamedata.prisonerFates; savedInt = DataLoader._gamedata.interrogation; });
afterEach(() => { DataLoader._gamedata.prisonerFates = saved; DataLoader._gamedata.interrogation = savedInt; });

function tune(over) {
    const d = JSON.parse(JSON.stringify(saved));
    for (const [k, v] of Object.entries(over)) d[k] = { ...d[k], ...v };
    DataLoader._gamedata.prisonerFates = d;
}

/** Every rank of the realm's lords taken is of the rival House's blood. */
function allKin() {
    const d = JSON.parse(JSON.stringify(savedInt));
    d.pow = { ...d.pow, house: { ...d.pow.house, lord: 1, knight: 1, captain: 1 } };
    DataLoader._gamedata.interrogation = d;
}

function kingdom(id, name, o = {}) {
    return {
        id, name, isAlive: true, treasury: 5000, military: 400, population: 8000, stability: 60, culture: 'Imperial',
        relations: {}, wars: [], allies: [], capital: { q: id * 10, r: 2 }, religion: { faithId: `faith${id}` },
        lord: { name: 'King', honor: 5, ambition: 5, traits: [], memory: [], relationships: {}, goals: [] }, ...o,
    };
}

function makeWorld(o = {}) {
    const k1 = kingdom(1, 'Varn');
    const k2 = kingdom(2, 'Esk');
    const towns = [
        { name: 'Varnhold', q: 10, r: 2, kingdom: 1, type: 'capital', population: 4000, economy: { gold: 2000 } },
        { name: 'Eskby', q: 20, r: 2, kingdom: 2, type: 'capital', population: 4000, economy: { gold: 2000 } },
    ];
    const at = {};
    for (const t of towns) at[`${t.q},${t.r}`] = t;
    const tiles = {};
    const terrainAt = o.terrainAt || (() => ({ id: 'plains', passable: true }));
    const world = {
        day: 500, width: 60, height: 40, generationParams: { seed: 31 }, events: [], units: [],
        kingdoms: [k1, k2],
        getTile: (q, r) => tiles[`${q},${r}`] || (tiles[`${q},${r}`] = { q, r, visible: true, regionId: 1, terrain: terrainAt(q, r), settlement: at[`${q},${r}`] || null }),
        getKingdom: (id) => [k1, k2].find(k => String(k.id) === String(id)) || null,
        getSettlementViews: () => towns,
        getAllSettlements: () => towns,
    };
    world.captivesFeed = [];
    return { world, k1, k2, towns };
}

function makePlayer(o = {}) {
    const army = [];
    for (let i = 0; i < 8; i++) army.push(PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('soldier')));
    return {
        name: 'Aldric Voss', gold: 1000, karma: 0, renown: 10, reputation: { 1: 0, 2: 0 }, q: 5, r: 5, army,
        skills: { combat: 1, leadership: 3, diplomacy: 3 }, inventory: {}, children: [], colonies: [],
        house: { name: 'House Voss', generation: 1, prestige: 100, history: [], rivals: {} }, ...o,
    };
}

/** A rival House seated in realm 1, with a head and a real purse. */
function rivalIn(player, kid = 1, gold = 3000) {
    const rival = {
        kingdomId: kid, name: 'House Varr', feud: 20, gold, houseKey: `${kid}:0`, seat: { q: 10, r: 2 },
        head: { firstName: 'Aldo', gender: 'male', age: 44, traits: [], children: [] }, memory: [], log: [], events: [], stats: { heads: 1 },
    };
    player.house.rivals[kid] = rival;
    return rival;
}

const purses = (player, world, rival) => player.gold + world.kingdoms.reduce((t, k) => t + k.treasury, 0) + (rival ? rival.gold : 0);

describe('PrisonerFates — captives from beyond the field', () => {
    it('a stormed lair\'s men who yield make an outlaw column, "among the ruins"', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        WarStakes.yieldUp(world, { source: 'lair', kingdomId: null, outlaw: true, unitType: 'raider', name: 'Grim Tom\'s Cutthroats', q: 6, r: 5, strength: 30, place: 'Blackwood Camp' });
        const col = PrisonerFates.collect(player, world);
        expect(col).toBeTruthy();
        expect(col.outlaw).toBe(true);
        expect(col.source).toBe('lair');
        expect(col.men).toBe(24); // 30 × 0.4, two men a point
        expect(PrisonerFates.options(player, world).map(o => o.id)).toEqual(PrisonerFates.OUTLAW_FATES);
        expect(PrisonerFates.view(player, world).text).toMatch(/among the ruins of Blackwood Camp/);
        // (taken up once)
        expect(PrisonerFates.collect(player, world)).toBeNull();
    });

    it('a stormed town\'s garrison yields in the breach: a realm column with its men of rank', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        const result = {};
        Sieges._garrisonYields(world, { name: 'Eskby', q: 20, r: 2, garrison: 200 }, 2, result);
        expect(result.yielded).toBe(true);
        const col = PrisonerFates.collect(player, world);
        expect(col.kingdomId).toBe(2);
        expect(col.outlaw).toBe(false);
        expect(col.source).toBe('siege');
        expect(col.nobles.length).toBeGreaterThanOrEqual(1);
        expect(PrisonerFates.options(player, world).map(o => o.id)).toEqual(PrisonerFates.REALM_FATES);
        PrisonerFates.decideNobles(player, world, 'dungeon');
        expect(PrisonerFates.view(player, world).text).toMatch(/in the breach at Eskby/);
        expect(PrisonerFates.decide(player, world, 'oath').success).toBe(true);
    });

    it('a realm\'s ship carried by boarding: her crew yield on the deck', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        const f = { outcome: { kind: 'victory', boarded: true, enemyId: 'e0' }, ships: [{ id: 'e0', name: 'Swan', crew: 60 }] };
        expect(SeaFights.boardedYield(world, f, { kingdomId: 1, name: 'Varn\'s sailors', q: 3, r: 3 })).toBeTruthy();
        // (not boarded: nothing; outlaws need no realm here, they have the pirates' own aftermath)
        expect(SeaFights.boardedYield(world, { ...f, outcome: { kind: 'victory', enemyId: 'e0' } }, { kingdomId: 1 })).toBeNull();
        const col = PrisonerFates.collect(player, world);
        expect(col.sea).toBe(true);
        expect(col.kingdomId).toBe(1);
        expect(PrisonerFates.options(player, world).find(o => o.id === 'blind').can).toBe(false); // not at sea
    });

    it('processDay takes up the surrenders no panel did, with a notice; your captains decide them the next day', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        WarStakes.yieldUp(world, { source: 'boarding', kingdomId: null, outlaw: true, unitType: 'pirate', name: 'Sea-Raiders', q: 3, r: 3, strength: 20, sea: true });
        const out = PrisonerFates.processDay(world, player);
        expect(out.notices.some(n => n.title === 'Captives Await Your Word')).toBe(true);
        expect(PrisonerFates.pending(player).source).toBe('boarding');
        world.day++;
        const out2 = PrisonerFates.processDay(world, player);
        expect(PrisonerFates.pending(player)).toBeNull();
        expect(out2.notices.some(n => n.title === 'Your Captains Decide')).toBe(true);
        expect(PrisonerFates.state(player).stats.hanged).toBeGreaterThan(0);
    });
});

describe('PrisonerFates — outlaws let go ride again', () => {
    it('released outlaws come back as a real band some days later, leaving you be a while', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        PrisonerFates.afterBattle(player, world, { id: 'r1', type: 'raider', name: 'Red Cutthroats', q: 6, r: 5, strength: 40 }, { victory: true, enemyRemaining: 40, theatre: 'land', tactics: {} });
        const r = PrisonerFates.decide(player, world, 'release');
        expect(r.success).toBe(true);
        const freed = WarStakes.state(world).freed;
        expect(freed.length).toBe(1);
        expect(freed[0].type).toBe('raider');
        expect(world.units.length).toBe(0);
        const due = freed[0].due;
        expect(due).toBeGreaterThan(world.day);
        world.day = due;
        const out = PrisonerFates.processDay(world, player);
        const band = world.units.find(u => u.freedBy);
        expect(band).toBeTruthy();
        expect(band).toBeInstanceOf(WorldUnit);
        expect(band.type).toBe('raider');
        expect(band.name).toBe('Red Cutthroats');
        expect(band.strength).toBe(Math.round(16 * 0.6)); // the column's strength 16 × freedShare
        expect(band.sparedUntilDay).toBeGreaterThan(world.day);
        expect(out.notices.some(n => n.title === 'Old Faces on the Road')).toBe(true);
        expect(WarStakes.state(world).freed.length).toBe(0);
    });

    it('pirates let go put to sea again; a handful too few to make a band scatter', () => {
        const { world } = makeWorld({ terrainAt: (q) => (q >= 8 ? { id: 'ocean', passable: false } : { id: 'plains', passable: true }) });
        const player = makePlayer();
        PrisonerFates.afterBattle(player, world, { id: 'p1', type: 'pirate', name: 'Black Gulls', q: 6, r: 5, strength: 40 }, { victory: true, enemyRemaining: 40, theatre: 'sea', tactics: {} });
        PrisonerFates.decide(player, world, 'release');
        const f = WarStakes.state(world).freed[0];
        expect(f.type).toBe('pirate');
        world.day = f.due;
        PrisonerFates.processDay(world, player);
        const band = world.units.find(u => u.freedBy);
        expect(band.type).toBe('pirate');
        expect(world.getTile(band.q, band.r).terrain.id).toBe('ocean');
        // too few
        const p2 = makePlayer();
        PrisonerFates.afterBattle(p2, world, { id: 'r2', type: 'raider', name: 'Few', q: 6, r: 5, strength: 10 }, { victory: true, enemyRemaining: 10, theatre: 'land', tactics: {} });
        PrisonerFates.decide(p2, world, 'release');
        expect(WarStakes.state(world).freed.length).toBe(0);
    });
});

describe('Raiders and pirates and the stakes', () => {
    function staked(world, day) {
        WarStakes.state(world).stakes.push({ id: 1, byPlayer: true, by: 'House Voss', kingdomId: null, realm: 'outlaws', men: 20, day, q: 10, r: 10, tiles: [{ q: 10, r: 10 }, { q: 11, r: 10 }], rotDays: 90, place: 'the road' });
    }

    it('a band near fresh stakes turns away from them, and hunts no one meanwhile', () => {
        const { world } = makeWorld();
        tune({ outlaws: { stakeTurnBack: 5 } });
        staked(world, world.day);
        const u = new WorldUnit('raider', 13, 10);
        expect(u._shunStakes(world)).toBe(true);
        expect(u.shunUntil).toBeGreaterThan(world.day);
        expect(u.shunQ).toBeGreaterThan(13); // away from the posts
        expect(u.targetQ).toBe(u.shunQ);
        // (and keeps to it for the days it shuns them, without rolling again)
        world.day++;
        expect(u._shunStakes(world)).toBe(true);
        // a pirate likewise
        const p = new WorldUnit('pirate', 8, 10);
        expect(p._shunStakes(world)).toBe(true);
        // (west across the map's wrap, away from the posts)
        expect(Hex.wrappingDistance(p.shunQ, p.shunR, 10, 10, world.width)).toBeGreaterThan(Hex.wrappingDistance(8, 10, 10, 10, world.width) + 3);
    });

    it('no stakes, rotted stakes, or out of reach: the band rides on', () => {
        const { world } = makeWorld();
        tune({ outlaws: { stakeTurnBack: 5 } });
        const u = new WorldUnit('raider', 13, 10);
        expect(u._shunStakes(world)).toBe(false);
        staked(world, world.day - 200); // bones
        expect(u._shunStakes(world)).toBe(false);
        WarStakes.state(world).stakes.length = 0;
        staked(world, world.day);
        const far = new WorldUnit('raider', 40, 30);
        expect(far._shunStakes(world)).toBe(false);
    });

    it('the deterrence is a roll: half-rotted stakes turn some bands, not all', () => {
        const { world } = makeWorld();
        staked(world, world.day - 45); // half fresh
        let turned = 0;
        for (let i = 0; i < 200; i++) {
            const u = new WorldUnit('raider', 12, 10);
            u.id = `t${i}`;
            if (u._shunStakes(world)) turned++;
        }
        // 0.6 × 0.5 × 1.5 (impaled outlaws) ≈ 45%
        expect(turned).toBeGreaterThan(50);
        expect(turned).toBeLessThan(150);
    });
});

describe('PrisonerFates — a broken rebel host', () => {
    function rising(player, world, id = 7) {
        const rv = {
            id, kingdomId: 1, against: 'player', towns: ['10,2'], townNames: ['Varnhold'], origin: '10,2', strength: 60, startDay: world.day - 20,
            leader: { name: 'Wat Tyler', q: 10, r: 2, gender: 'male', town: 'Varnhold', role: 'smith' }, causeLabel: 'hunger', cause: 'hunger', demands: [], sworn: [],
        };
        player.peasantRevolts = { prisoners: [], aftermath: { rvId: id, day: world.day, until: world.day + 30, rv }, nextId: 1, stats: {} };
        return rv;
    }
    const host = { id: 'ph1', type: 'peasant_host', name: 'Wat Tyler\'s Rising', peasantRevoltId: 7, q: 6, r: 5, strength: 60 };
    const won = { victory: true, enemyRemaining: 40, theatre: 'land', tactics: {} };

    it('its men kneel as a column whose fates are the rising\'s own judgement', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        rising(player, world);
        const out = PrisonerFates.afterBattle(player, world, host, won);
        expect(out.column).toBeTruthy();
        expect(out.column.rebel.leader).toBe('Wat Tyler');
        expect(PrisonerFates.options(player, world).map(o => o.id)).toEqual(PrisonerFates.REBEL_FATES);
        expect(PrisonerFates.defaultFate(out.column)).toBe('mercy');
        const r = PrisonerFates.decide(player, world, 'hang_leader');
        expect(r.success).toBe(true);
        expect(player.peasantRevolts.aftermath).toBeNull(); // judged through PeasantRevolts
        expect(PrisonerFates.pending(player)).toBeNull();
    });

    it('pressed into service: militia companies of turncoats, and the leader taken', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        rising(player, world);
        PrisonerFates.afterBattle(player, world, host, won);
        const n0 = player.army.length;
        const r = PrisonerFates.decide(player, world, 'service');
        expect(r.success).toBe(true);
        const pressed = PrisonerFates.turncoats(player);
        expect(player.army.length).toBeGreaterThan(n0);
        expect(pressed.every(u => u.turncoat.rebel && u.turncoat.outlaw)).toBe(true);
        expect(player.peasantRevolts.aftermath).toBeNull();
        expect(player.peasantRevolts.prisoners.length).toBe(1);
    });

    it('a rising against another\'s crown leaves no column (its lord judges); one judged in its own panel clears it', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        expect(PrisonerFates.afterBattle(player, world, host, won).column).toBeNull();
        rising(player, world);
        PrisonerFates.afterBattle(player, world, host, won);
        player.peasantRevolts.aftermath = null; // judged elsewhere
        PrisonerFates.processDay(world, player);
        expect(PrisonerFates.pending(player)).toBeNull();
    });
});

describe('PrisonerFates — a lord of a rival House\'s blood', () => {
    function kinsman(player, world, rank = 'lord') {
        allKin();
        return Interrogation.addPow(player, world, { kingdomId: 1, strength: 120, rank, how: 'in the field' });
    }

    it('taken, he bears the House\'s name and the House hears of it', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        const rival = rivalIn(player);
        const feud0 = rival.feud;
        const w = kinsman(player, world);
        expect(w.houseKid).toBe(1);
        expect(w.houseName).toBe('House Varr');
        expect(w.name).toMatch(/^Lord \S+ Varr$/);
        expect(rival.feud).toBeGreaterThan(feud0);
        expect(rival.memory.some(m => m.kind === 'captured')).toBe(true);
        // no rival House in the realm: a plain lord
        const w2 = Interrogation.addPow(player, world, { kingdomId: 2, strength: 120, rank: 'lord' });
        expect(w2.houseKid).toBeUndefined();
    });

    it('his ransom is paid out of the House\'s purse first, then his crown\'s treasury: no coin made', () => {
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        const rival = rivalIn(player, 1, 3000);
        k1.treasury = 100; // a poor crown: the House carries it
        const w = kinsman(player, world);
        const before = purses(player, world, rival);
        const gold0 = player.gold;
        const house0 = rival.gold;
        expect(PrisonerFates.openTalks(player, world, w.id, 'fair').success).toBe(true);
        player.prisonerFates = PrisonerFates.state(player);
        for (let i = 0; i < 20 && Interrogation._pow(player, w.id); i++) {
            world.day++;
            PrisonerFates.processDay(world, player);
            const t = w.talks;
            if (t && t.stage === 'offered') PrisonerFates.acceptOffer(player, world, w.id);
        }
        expect(Interrogation._pow(player, w.id)).toBeNull();
        expect(player.gold).toBeGreaterThan(gold0);
        expect(rival.gold).toBeLessThan(house0);
        expect(purses(player, world, rival)).toBeCloseTo(before, 2);
        expect(rival.memory.some(m => m.kind === 'ransomedKin')).toBe(true);
        expect(PrisonerFates.state(player).history.some(h => /House Varr pays/.test(h.text))).toBe(true);
    });

    it('the dungeon\'s own ransom (Interrogation.ransomPow) draws on the House\'s purse too', () => {
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        const rival = rivalIn(player, 1, 3000);
        k1.treasury = 0;
        const w = kinsman(player, world);
        expect(Interrogation.powRansom(player, world, w)).toBeGreaterThan(0);
        const r = Interrogation.ransomPow(player, world, w.id);
        expect(r.success).toBe(true);
        expect(r.text).toMatch(/House Varr pays/);
        expect(rival.gold).toBe(3000 - r.paid);
    });

    it('dead in your keeping: a blood feud with his House, once', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        const rival = rivalIn(player);
        const w = kinsman(player, world);
        const f = Interrogation.powBlood(player, world, w, 'captive');
        expect(f).toBeTruthy();
        expect(f.sides.some(s => s.key === 'house:1')).toBe(true);
        expect(BloodFeuds.ofPlayer(world)).toHaveLength(1);
        expect(rival.memory.some(m => m.kind === 'diedCaptive')).toBe(true);
        expect(Interrogation.powBlood(player, world, w, 'captive')).toBeNull();
        // a plain lord of a realm with no House: no feud
        const w2 = Interrogation.addPow(player, world, { kingdomId: 2, strength: 120, rank: 'lord' });
        expect(Interrogation.powBlood(player, world, w2, 'captive')).toBeNull();
    });

    it('maimed in your keeping: blood owed too, in its own words', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        const rival = rivalIn(player);
        const w = kinsman(player, world);
        const feud0 = rival.feud;
        const f = Interrogation.powBlood(player, world, w, 'maimed', { maimed: true, what: 'the iron' });
        expect(f).toBeTruthy();
        expect(f.deaths[f.deaths.length - 1].how).toBe('maimed');
        expect(rival.feud).toBeGreaterThan(feud0);
        expect(rival.memory.some(m => m.kind === 'maimedKin')).toBe(true);
        expect(Interrogation.powBlood(player, world, w, 'maimed', { maimed: true })).toBeNull();
    });

    it('rotting to death in your cells is blood owed', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        rivalIn(player);
        tune({ ransom: { rotAfter: 0, rotChance: 1 } });
        const w = kinsman(player, world);
        player.prisonerFates = PrisonerFates.state(player);
        let note = null;
        for (let i = 0; i < 12 && Interrogation._pow(player, w.id); i++) {
            world.day++;
            const out = PrisonerFates.processDay(world, player);
            note = out.notices.find(n => n.title === 'Dead in the Dungeon') || note;
        }
        expect(Interrogation._pow(player, w.id)).toBeNull();
        expect(note.text).toMatch(/House Varr will want blood/);
        expect(BloodFeuds.ofPlayer(world)).toHaveLength(1);
    });

    it('sharing the fate of the men he leads: cut down with them, his House owes you blood', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        rivalIn(player);
        allKin();
        const out = PrisonerFates.afterBattle(player, world, { id: 'wh_1', type: 'war_host', name: 'Varn War Host', kingdomId: 1, q: 6, r: 5, strength: 200 }, { victory: true, enemyRemaining: 120, theatre: 'land', tactics: {} });
        expect(out.column.nobles.length).toBeGreaterThanOrEqual(1);
        expect(PrisonerFates.view(player, world).text).toMatch(/House Varr's blood/);
        PrisonerFates.decideNobles(player, world, 'share');
        const r = PrisonerFates.decide(player, world, 'slaughter');
        expect(r.success).toBe(true);
        expect(r.text).toMatch(/House Varr will want blood/);
        expect(BloodFeuds.ofPlayer(world)).toHaveLength(1);
    });
});
