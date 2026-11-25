// Holy wars and excommunication (systems/holyWars.js): every faith gets a see
// with a head who ages and dies, coffers of real coin and a seat; the head calls
// holy wars that run through the realms' own war machinery with a coalition of
// the crowns that answer; anyone of the faith may take the cross (a muster, the
// front, remission of sins; the crowns of the faith keep their lands meanwhile);
// rulers who defy the see are cast out (stability, their lords' regard, the
// faithful cool) and lifted by penance, payment or a counter-pope.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { DataLoader } from '../core/dataLoader.js';
import { HolyWars } from '../systems/holyWars.js';
import { RealmWars } from '../systems/realmWars.js';
import { Devotion } from '../systems/devotion.js';
import { Wanted } from '../systems/wanted.js';
import { Kingship } from '../systems/kingship.js';
import { KingdomStability } from '../world/kingdomState.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { Annals } from '../systems/annals.js';
import { Utils } from '../core/utils.js';
import { CourtLetters } from '../systems/courtLetters.js';

let base = null;

beforeAll(async () => {
    await loadData();
    base = JSON.parse(JSON.stringify(DataLoader._gamedata.holyWars));
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
    DataLoader._gamedata.holyWars = JSON.parse(JSON.stringify(base));
});

function realm(id, name, faithId, q, r, extra = {}) {
    return {
        id, name, isAlive: true, treasury: 5000, military: 400, population: 20000, capital: { q, r }, territory: [{ q, r }],
        wars: [], allies: [], relations: {}, truces: {}, religion: { faithId, piety: 60, unity: 60, heresies: [], holySites: [] }, ...extra,
    };
}

/** Three realms of the Sun (k1 the chief), one of the Iron Creed holding a shrine of the Sun. */
function makeWorld(day = 400) {
    const ks = [
        realm('k1', 'Valdor', 'solaris', 2, 2, { military: 600 }),
        realm('k2', 'Aster', 'solaris', 8, 2),
        realm('k3', 'Merrow', 'solaris', 2, 8),
        realm('k4', 'Kharn', 'ironfaith', 8, 8, { military: 200 }),
    ];
    const towns = [
        { name: 'Solhaven', type: 'capital', q: 2, r: 2, kingdom: 'k1', population: 4000, economy: { gold: 4000 } },
        { name: 'Asterby', type: 'city', q: 8, r: 2, kingdom: 'k2', population: 3000, economy: { gold: 3000 } },
        { name: 'Merrowfield', type: 'city', q: 2, r: 8, kingdom: 'k3', population: 3000, economy: { gold: 3000 } },
        { name: 'Kharnhold', type: 'capital', q: 8, r: 8, kingdom: 'k4', population: 3000, economy: { gold: 3000 } },
        { name: 'Ironford', type: 'town', q: 9, r: 9, kingdom: 'k4', population: 1500, economy: { gold: 1500 } },
    ];
    const tiles = new Map();
    for (const s of towns) tiles.set(`${s.q},${s.r}`, { q: s.q, r: s.r, kingdom: s.kingdom, settlement: s });
    // A shrine of the Sun in the Iron Creed's hands
    tiles.set('7,7', { q: 7, r: 7, kingdom: 'k4', holySite: { name: 'Sacred Spring', faithId: 'solaris', controller: 'k4', level: 1 } });
    ks[3].religion.holySites.push({ q: 7, r: 7 });
    const world = {
        day, baseYear: 853, width: 40, height: 30, generationParams: { seed: 4242 }, events: [], kingdoms: ks, units: [],
        getKingdom: (id) => ks.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getSettlementViews: () => towns,
    };
    return { world, ks, towns, tiles };
}

function makePlayer(extra = {}) {
    const p = {
        name: 'Aldo Harness', gold: 2000, q: 2, r: 2, health: 100, karma: 0, reputation: {}, skills: {},
        house: { name: 'House Harness', generation: 1, prestige: 100, rivals: {}, history: [] }, ...extra,
    };
    Devotion.state(p).faithId = 'solaris';
    return p;
}

/** Advance to the next weekly tick (HolyWars weekDay) and run it. */
function week(world, player, n = 1) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        do { world.day++; notices.push(...HolyWars.processDay(world, player).notices); } while (world.day % 7 !== HolyWars.config().weekDay);
    }
    return notices;
}

describe('the sees of the faiths', () => {
    it('raises a see for every faith the realms keep, seated in its chief realm, with a head', () => {
        const { world } = makeWorld();
        week(world, null);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const iron = HolyWars.see(world, 'ironfaith|orthodox');
        expect(sun).toBeTruthy();
        expect(iron).toBeTruthy();
        expect(sun.kingdomId).toBe('k1');
        expect(sun.town).toBe('Solhaven');
        expect(sun.head.name).toMatch(/ [IVX]+$/);
        expect(HolyWars.headLabel(sun)).toContain('Hierarch of the Sun');
    });

    it('the faithful tithe real coin from their chests into its coffers, counted by the census', () => {
        const { world, ks } = makeWorld();
        const before = ks.reduce((s, k) => s + k.treasury, 0);
        week(world, null, 3);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const iron = HolyWars.see(world, 'ironfaith|orthodox');
        const after = ks.reduce((s, k) => s + k.treasury, 0);
        expect(sun.coffers).toBeGreaterThan(0);
        expect(Math.round((before - after) * 100)).toBe(Math.round((sun.coffers + iron.coffers) * 100));
        const census = CoinCensus.count(world, null);
        expect(census.get('k1').coffers).toBeGreaterThanOrEqual(sun.coffers - 0.01);
    });

    it('a head dies in time and a new one is raised', () => {
        const { world } = makeWorld();
        week(world, null);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const first = sun.head.name;
        world.day = sun.head.dies + 1;
        week(world, null);
        expect(sun.head.name).not.toBe(first);
        expect(HolyWars.state(world).log.some(e => e.kind === 'head')).toBe(true);
    });

    it('the player as High Priest heads the see, and its coin is theirs', () => {
        const { world } = makeWorld();
        const player = makePlayer({ religion: { name: 'The Solar Covenant', worldFaithId: 'solaris', see: { kingdomId: 'k1', q: 2, r: 2 }, presence: {} } });
        week(world, player);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        expect(sun.head.player).toBe(true);
        expect(HolyWars.headedSee(player, world)).toBe(sun);
        const gold = player.gold;
        HolyWars.deposit(world, player, sun, 50, 'k2');
        expect(player.gold).toBe(gold + 50);
    });
});

describe('holy wars', () => {
    it('finds a holy site of the faith in infidel hands as a cause', () => {
        const { world } = makeWorld();
        week(world, null);
        const t = HolyWars.targets(world, HolyWars.see(world, 'solaris|orthodox'));
        const kharn = t.find(x => x.k.id === 'k4');
        expect(kharn).toBeTruthy();
        expect(kharn.casus).toBe('holySite');
        expect(kharn.site.name).toBe('Sacred Spring');
    });

    it('a call: the seat answers at once and goes to war through the realms\' machinery, with a subsidy', () => {
        const { world, ks } = makeWorld();
        week(world, null, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        sun.coffers = 4000;
        const war = HolyWars.call(world, null, sun, ks[3], 'holySite', { q: 7, r: 7, name: 'Sacred Spring' });
        expect(war.invited.sort()).toEqual(['k1', 'k2', 'k3']);
        expect(war.members).toEqual(['k1']);
        expect(ks[0].wars).toContain('k4');
        expect(ks[3].wars).toContain('k1');
        // sworn: the lords' peace cannot end it
        expect(ks[0].warState.k4.sworn).toBe(war.until);
        expect(war.subsidies).toBeGreaterThan(0);
        expect(sun.coffers).toBeLessThan(4000);
    });

    it('the faithful answer or refuse within the call; refusing costs piety and stability and angers the see', () => {
        const { world, ks } = makeWorld();
        week(world, null, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        // Aster is too far and too busy to go; Merrow pious and near
        ks[1].religion.piety = 0;
        ks[1].wars = ['x1', 'x2'];
        ks[2].religion.piety = 100;
        const war = HolyWars.call(world, null, sun, ks[3], 'holySite', { q: 7, r: 7, name: 'Sacred Spring' });
        week(world, null, 7);
        expect(war.refused).toContain('k2');
        expect(sun.grievance.k2).toBeGreaterThan(20);
        expect(ks[1].church.refusedUntil).toBeGreaterThan(world.day);
        expect(ks[1].church.stab).toBeLessThan(0);
        expect(war.phase).toBe('war');
    });

    it('ends in victory when the holy site is retaken, through KingdomAI.endWar, and goes on record', () => {
        const { world, ks, tiles } = makeWorld();
        week(world, null, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, null, sun, ks[3], 'holySite', { q: 7, r: 7, name: 'Sacred Spring' });
        // the crusaders take the shrine and a town
        tiles.get('7,7').holySite.controller = 'k1';
        tiles.get('9,9').settlement.kingdom = 'k1';
        week(world, null);
        expect(HolyWars.state(world).wars).not.toContain(war);
        const rec = HolyWars.state(world).past[0];
        expect(rec.outcome).toBe('victory');
        expect(rec.gained).toContain('Ironford');
        expect(ks[0].wars).not.toContain('k4');
        expect(world.warHistory.some(h => h.victor === 'k1')).toBe(true);
        const ch = HolyWars.annalChapters(world, 0);
        expect(ch[0].kind).toBe('holyWar');
        expect(ch[0].paragraphs[0].text).toMatch(/Holy War|holy war/);
    });

    it('a call no crown answers comes to nothing', () => {
        const { world, ks } = makeWorld();
        week(world, null, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        for (const k of ks) k.wars = ['x1', 'x2'];
        const war = HolyWars.call(world, null, sun, ks[3], 'holySite', null);
        week(world, null, 8);
        expect(HolyWars.state(world).past.find(h => h.id === war.id).outcome).toBe('unanswered');
    });

    it('the AI heads call their own holy wars in time', () => {
        const { world } = makeWorld();
        DataLoader._gamedata.holyWars.call.chance = 1;
        DataLoader._gamedata.holyWars.call.firstAfterDays = 0;
        week(world, null, 30);
        expect(HolyWars.state(world).wars.length + HolyWars.state(world).past.length).toBeGreaterThan(0);
    });
});

describe('the player\'s crown and the call', () => {
    function ruled(world, k) {
        k.crown = { playerRuled: true };
        return makePlayer({ throne: { ruling: { kingdomId: k.id } } });
    }

    it('the realm the player rules is invited; answering goes to war and pleases the lords', () => {
        const { world, ks } = makeWorld();
        const player = ruled(world, ks[2]);
        week(world, player, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, player, sun, ks[3], 'holySite', null);
        expect(HolyWars.invitations(player, world).map(w => w.id)).toEqual([war.id]);
        const res = HolyWars.answer(player, world, war.id, true);
        expect(res.success).toBe(true);
        expect(ks[2].wars).toContain('k4');
        week(world, player);
        expect(ks[2].church.vassal).toBeGreaterThan(0);
        expect(KingdomStability.target(ks[2], world).parts.some(p => p.label === 'The Church' && p.value > 0)).toBe(true);
    });

    it('refusing — or never answering — counts against the crown', () => {
        const { world, ks } = makeWorld();
        const player = ruled(world, ks[2]);
        week(world, player, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, player, sun, ks[3], 'holySite', null);
        week(world, player, 8);
        expect(war.refused).toContain('k3');
        expect(Devotion.standing(player, 'solaris')).toBeLessThan(0);
        expect(ks[2].church.vassal).toBeLessThan(0);
        expect(sun.grievance.k3).toBeGreaterThan(0);
    });
});

describe('the cross', () => {
    it('take the cross, reach the muster (at war with the foe), serve, and win remission of sins', () => {
        const { world, ks } = makeWorld();
        const player = makePlayer({ q: 0, r: 0 });
        week(world, player, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, player, sun, ks[3], 'holySite', null);
        Wanted.charge(player, world, { kingdomId: 'k2', label: 'theft', gold: 120 });
        Wanted.charge(player, world, { kingdomId: 'k2', label: 'murder', gold: 500, grave: true });
        const opt = HolyWars.crossOptions(player, world)[0];
        expect(opt.ok).toBe(true);
        const res = HolyWars.takeCross(player, world, war.id);
        expect(res.success).toBe(true);
        const c = player.holyWars.cross;
        // the crowns of the faith keep the crusader's lands
        expect(RealmWars.churchShields(player, ks[1])).toBe(true);
        expect(RealmWars.churchShields(player, ks[3])).toBe(false);
        // walk to the muster
        player.q = c.muster.q; player.r = c.muster.r;
        world.day++; HolyWars.processDay(world, player);
        expect(c.arrived).toBe(world.day);
        expect(RealmWars.atWarWith(player, 'k4')).toBe(true);
        const prestige = player.house.prestige;
        for (let i = 0; i < HolyWars.config().cross.serveDays + 1; i++) { world.day++; HolyWars.processDay(world, player); if (!player.holyWars.cross) break; }
        expect(player.holyWars.cross).toBeNull();
        expect(player.holyWars.crusades).toBe(1);
        expect(player.holyWars.past[0].how).toBe('fulfilled');
        expect(player.house.prestige).toBeGreaterThan(prestige);
        expect(Wanted.realm(player, 'k2').lesser).toBe(0);
        expect(Wanted.realm(player, 'k2').grave).toBeLessThan(500);
        expect(player.karma).toBeGreaterThan(0);
    });

    it('never reaching the muster breaks the vow', () => {
        const { world, ks } = makeWorld();
        const player = makePlayer({ q: 30, r: 25 });
        week(world, player, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, player, sun, ks[3], 'holySite', null);
        HolyWars.takeCross(player, world, war.id);
        world.day = player.holyWars.cross.by + 1;
        const n = HolyWars.processDay(world, player).notices;
        expect(player.holyWars.cross).toBeNull();
        expect(player.holyWars.past[0].how).toBe('broken');
        expect(n.some(x => x.title === 'A Broken Vow')).toBe(true);
        expect(sun.grievance.player).toBeGreaterThan(0);
    });
});

describe('excommunication', () => {
    it('a crown at war with the see\'s own realm is cast out: stability, lords, the faithful cool', () => {
        const { world, ks } = makeWorld();
        week(world, null);
        ks[1].wars = ['k1'];
        ks[1].allies = ['k3'];
        ks[2].allies = ['k2'];
        ks[1].relations.k3 = 30;
        week(world, null, 12);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        expect(sun.bans.k2).toBeTruthy();
        expect(HolyWars.isBanned(world, 'k2')).toBe(true);
        expect(ks[1].church.banned).toBe(true);
        expect(ks[1].church.stab).toBeLessThan(0);
        expect(KingdomStability.target(ks[1], world).parts.some(p => p.label === 'Under the ban of the Church')).toBe(true);
        expect(ks[1].relations.k3).toBeLessThan(30);
    });

    it('the player ruler cast out: the vassals\' regard reads the ban; payment lifts it', () => {
        const { world, ks } = makeWorld();
        ks[2].crown = { playerRuled: true };
        const player = makePlayer({ throne: { ruling: { kingdomId: 'k3', court: null } } });
        week(world, player);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        sun.grievance.k3 = 200;
        week(world, player);
        expect(HolyWars.playerBans(player, world).length).toBe(1);
        expect(Devotion.standing(player, 'solaris')).toBeLessThan(0);
        week(world, player);
        expect(ks[2].church.vassal).toBeLessThan(0);
        const v = { id: 'v1', traits: [], honor: 5, ambition: 5, seat: null };
        const op = Kingship.opinion(player, world, v);
        expect(op.parts.some(p => p.label === 'The crown cast out of the faith')).toBe(true);
        const opts = HolyWars.absolutionOptions(player, world, sun.key, 'k3');
        expect(opts.find(o => o.how === 'pay').ok).toBe(true);
        const coffers = sun.coffers;
        const res = HolyWars.seekAbsolution(player, world, sun.key, 'k3', 'pay');
        expect(res.success).toBe(true);
        expect(sun.bans.k3).toBeUndefined();
        expect(sun.coffers).toBeGreaterThan(coffers);
    });

    it('a counter-pope: where a schism split the faith, the banned crown turns to the other rite', () => {
        const { world, ks } = makeWorld();
        ks[2].religion.rite = 'reformed';
        ks[2].crown = { playerRuled: true };
        const player = makePlayer({ throne: { ruling: { kingdomId: 'k2' } } });
        ks[1].crown = { playerRuled: true };
        player.throne.ruling.kingdomId = 'k2';
        week(world, player);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        expect(HolyWars.see(world, 'solaris|reformed')).toBeTruthy();
        sun.grievance.k2 = 200;
        week(world, player);
        const opt = HolyWars.absolutionOptions(player, world, sun.key, 'k2').find(o => o.how === 'counterPope');
        expect(opt).toBeTruthy();
        const res = HolyWars.seekAbsolution(player, world, sun.key, 'k2', 'counterPope');
        expect(res.success).toBe(true);
        expect(ks[1].religion.rite).toBe('reformed');
        expect(sun.bans.k2).toBeUndefined();
    });

    it('a High Priest casts a ruler out by his own word', () => {
        const { world, ks } = makeWorld();
        const player = makePlayer({ religion: { name: 'The Solar Covenant', worldFaithId: 'solaris', see: { kingdomId: 'k1', q: 2, r: 2 }, presence: {} } });
        week(world, player);
        const res = HolyWars.pronounceBan(player, world, 'k2');
        expect(res.success).toBe(true);
        expect(HolyWars.isBanned(world, 'k2')).toBe(true);
        expect(HolyWars.pronounceBan(player, world, 'k2', true).success).toBe(true);
        expect(HolyWars.isBanned(world, 'k2')).toBe(false);
        // ...and calls a holy war himself
        const call = HolyWars.proclaimHolyWar(player, world, 'k4');
        expect(call.success).toBe(true);
        expect(HolyWars.state(world).wars[0].byPlayer).toBe(true);
        void ks;
    });
});

describe('saving and a real world', () => {
    it('the sees, the wars and the cross survive a save', () => {
        const { world, ks } = makeWorld();
        const player = makePlayer();
        week(world, player, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, player, sun, ks[3], 'holySite', null);
        HolyWars.takeCross(player, world, war.id);
        const saved = HolyWars.serialize(world);
        const w2 = { ...world };
        HolyWars.restore(saved, w2);
        expect(HolyWars.see(w2, 'solaris|orthodox').head.name).toBe(sun.head.name);
        expect(HolyWars.war(w2, war.id).target).toBe('k4');
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('holyWars');
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('inquisition');
    });

    it('runs on a generated world for years without breaking, and the Annals take it in', () => {
        const game = newGame(9101);
        const { world, player } = game;
        DataLoader._gamedata.holyWars.call.chance = 0.5;
        DataLoader._gamedata.holyWars.call.firstAfterDays = 0;
        const t0 = Date.now();
        for (let i = 0; i < 600; i++) { world.day++; HolyWars.processDay(world, player); }
        const per = (Date.now() - t0) / 600;
        expect(per).toBeLessThan(5);
        const st = HolyWars.state(world);
        expect(Object.keys(st.sees).length).toBeGreaterThan(0);
        expect(st.wars.length + st.past.length).toBeGreaterThan(0);
        for (const w of st.wars) for (const id of w.members) expect(world.getKingdom(id).wars).toContain(w.target);
        const book = Annals.compose(player, world);
        if (book) expect(Array.isArray(book.ages)).toBe(true);
        void Utils;
    });
});

describe('Knights of the Cross', () => {
    function lords(ks) {
        ks.forEach((k, i) => { k.lord = { name: `King ${k.name}`, age: 40 + i, memory: [] }; });
    }

    it('a vow fulfilled in a holy war won: the title, the House\'s honour, the lords remember', () => {
        const { world, ks, tiles } = makeWorld();
        lords(ks);
        const player = makePlayer({ q: 0, r: 0 });
        week(world, player, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, player, sun, ks[3], 'holySite', { q: 7, r: 7, name: 'Sacred Spring' });
        HolyWars.takeCross(player, world, war.id);
        const c = player.holyWars.cross;
        player.q = c.muster.q; player.r = c.muster.r;
        for (let i = 0; i < HolyWars.config().cross.serveDays + 2 && player.holyWars.cross; i++) { world.day++; HolyWars.processDay(world, player); }
        expect(player.holyWars.served).toContain(war.id);
        expect(HolyWars.knightOf(player)).toBeNull();
        // the crusaders retake the shrine: the war is won
        tiles.get('7,7').holySite.controller = 'k1';
        const notices = week(world, player);
        expect(HolyWars.state(world).past[0].outcome).toBe('victory');
        expect(HolyWars.knightOf(player).title).toBe('Knight of the Cross');
        expect(HolyWars.styleOf(player)).toBe('Knight of the Cross');
        expect(notices.some(n => n.title === 'Knight of the Cross')).toBe(true);
        expect(player.house.honours.some(h => h.id.startsWith('cross_knight'))).toBe(true);
        expect(ks[1].lord.memory.some(m => m.k === 'crusader')).toBe(true);
        expect(ks[3].lord.memory.some(m => m.k === 'crusaded_against')).toBe(true);
        // the crowns still in the field at the victory: their rulers are hailed too
        expect(ks[0].lord.crossKnight.title).toBe('Knight of the Cross');
        // an heir of another name does not inherit it
        expect(HolyWars.knightOf({ ...player, name: 'Bera Harness' })).toBeNull();
    });

    it('a rival House in an answering realm takes the cross, pays to ride, and comes home hailed', () => {
        const { world, ks, tiles } = makeWorld();
        lords(ks);
        DataLoader._gamedata.holyWars.knight.rival.chance = 5;
        DataLoader._gamedata.holyWars.knight.rival.death = 0;
        const player = makePlayer({ q: 0, r: 0 });
        player.house.rivals.k1 = {
            kingdomId: 'k1', name: 'House Varr', houseKey: 'k1:1', gold: 2000, renown: 0, standing: {}, guard: 0, log: [],
            seat: { q: 2, r: 2, name: 'Solhaven' }, head: { firstName: 'Aldric', gender: 'male', age: 40, martial: 8, traits: ['proud'], children: [] },
        };
        const rival = player.house.rivals.k1;
        week(world, player, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const town = world.getSettlementViews()[0];
        const purse = town.economy.gold;
        const war = HolyWars.call(world, player, sun, ks[3], 'holySite', { q: 7, r: 7, name: 'Sacred Spring' });
        expect(war.members).toContain('k1');
        expect(rival.cross.warId).toBe(war.id);
        expect(rival.gold).toBeLessThan(2000);
        expect(town.economy.gold).toBeGreaterThan(purse); // (the outfitting bought at the seat)
        tiles.get('7,7').holySite.controller = 'k1';
        week(world, player);
        expect(rival.cross).toBeNull();
        expect(rival.head.crossKnight.title).toBe('Knight of the Cross');
        expect(rival.renown).toBeGreaterThan(0);
        expect(rival.standing.k1).toBeGreaterThan(0);
    });
});

describe('a letter asking you to take the cross', () => {
    it('a crusading crown writes; taking the cross from the letter makes the vow; a knight is written to as one', () => {
        const { world, ks } = makeWorld();
        ks.forEach(k => { k.lord = { name: `King ${k.name}`, age: 50, memory: [] }; });
        const player = makePlayer({ q: 0, r: 0 });
        week(world, player, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, player, sun, ks[3], 'holySite', null);
        const cands = CourtLetters._candidates(world, player, 'crusade_call');
        expect(cands.map(c => c.kingdom.id)).toContain('k1');
        const plain = CourtLetters.compose(world, player, 'crusade_call', cands[0]);
        expect(plain.body).toContain('Kharn');
        expect(plain.body).not.toMatch(/\{\w+\}/);
        player.holyWars.knight = { title: 'Knight of the Cross', name: player.name, wars: 1 };
        const knightly = CourtLetters.deliver(player, CourtLetters.compose(world, player, 'crusade_call', cands[0]));
        expect(knightly.body).toContain('one crusader to another');
        expect(CourtLetters.choicesFor(player, world, knightly).find(c => c.id === 'take').ok).toBe(true);
        const res = CourtLetters.answer(player, world, knightly.id, 'take');
        expect(res.success).toBe(true);
        expect(player.holyWars.cross.warId).toBe(war.id);
        // under a vow already: no more such letters
        expect(CourtLetters._candidates(world, player, 'crusade_call').length).toBe(0);
    });
});

describe('how often and how long', () => {
    it('towns win a holy war only once enough have fallen and it has run its minimum days', () => {
        const { world, ks, tiles } = makeWorld();
        // (the beaten foe would sue for terms once its towns fall: holyWarTerms.test.js)
        DataLoader._gamedata.holyWars.terms = { ...DataLoader._gamedata.holyWars.terms, enabled: false };
        week(world, null, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, null, sun, ks[3], 'infidel', null);
        expect(HolyWars.townsToWin(war)).toBe(2);
        week(world, null, 7);
        expect(war.phase).toBe('war');
        tiles.get('8,8').settlement.kingdom = 'k1';
        tiles.get('9,9').settlement.kingdom = 'k1';
        week(world, null);
        expect(HolyWars.state(world).wars).toContain(war);
        world.day = war.answerBy + HolyWars.config().war.minDays;
        week(world, null);
        expect(HolyWars.state(world).past[0].outcome).toBe('victory');
    });

    it('a call waits on a world-wide gap, and a foe lately fought weighs less', () => {
        const { world, ks } = makeWorld();
        week(world, null, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const w1 = HolyWars.call(world, null, sun, ks[3], 'holySite', null);
        const st = HolyWars.state(world);
        expect(st.nextAny - world.day).toBeGreaterThanOrEqual(HolyWars.config().call.worldGapYears[0] * 120);
        const before = HolyWars.targets(world, sun, { targeted: true }).find(t => t.k.id === 'k4').weight;
        HolyWars._end(world, null, w1, 'defeat', { notices: [] });
        const after = HolyWars.targets(world, sun).find(t => t.k.id === 'k4').weight;
        expect(after).toBeLessThan(before);
    });

    it('one holy war at a time against a foe; a second see joins it as a joint crusade', () => {
        const { world, ks, towns, tiles } = makeWorld();
        const ember = realm('k5', 'Ember', 'ashwalkers', 12, 8, { relations: { k4: -60 } });
        ks.push(ember);
        const t5 = { name: 'Emberhold', type: 'capital', q: 12, r: 8, kingdom: 'k5', population: 3000, economy: { gold: 3000 } };
        towns.push(t5);
        tiles.set('12,8', { q: 12, r: 8, kingdom: 'k5', settlement: t5 });
        DataLoader._gamedata.holyWars.call.jointChance = 1;
        week(world, null, 2);
        const sun = HolyWars.see(world, 'solaris|orthodox');
        const ash = HolyWars.see(world, 'ashwalkers|orthodox');
        expect(HolyWars.targets(world, ash).some(t => t.k.id === 'k4')).toBe(true);
        const war = HolyWars.call(world, null, sun, ks[3], 'holySite', null);
        // the foe is no longer a cause of its own for anyone
        expect(HolyWars.targets(world, ash).some(t => t.k.id === 'k4')).toBe(false);
        week(world, null, 6);
        expect(war.joint).toContain(ash.key);
        expect(war.invited).toContain('k5');
        expect(HolyWars.state(world).wars.filter(w => w.target === 'k4').length).toBe(1);
        expect(war.answered).toContain('k5');
        expect(ember.wars).toContain('k4');
    });
});
