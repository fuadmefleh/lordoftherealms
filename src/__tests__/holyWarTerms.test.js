// The ways out of a holy war (systems/holyWars.js terms): a realm a holy war is
// sworn against hears no envoys, but may offer the calling see terms — a
// penance in real coin (its chests into the see's coffers, a share passed on to
// the crusaders), the holy site or a border town yielded, the see's rite taken,
// submission under the ban, or tolerance proclaimed. The price and the see's
// will follow the war; an AI crown losing one seeks terms on its own.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { DataLoader } from '../core/dataLoader.js';
import { HolyWars } from '../systems/holyWars.js';
import { Laws } from '../systems/laws.js';
import { Devotion } from '../systems/devotion.js';
import { KingdomAI } from '../world/kingdomAI.js';

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

/** Three realms of the Sun (k1 the chief), one of the Iron Creed (k4: three towns) holding a shrine of the Sun. */
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
        { name: 'Ashgate', type: 'town', q: 6, r: 8, kingdom: 'k4', population: 1200, economy: { gold: 1200 } },
    ];
    const tiles = new Map();
    for (const s of towns) tiles.set(`${s.q},${s.r}`, { q: s.q, r: s.r, kingdom: s.kingdom, settlement: s });
    for (const s of towns) if (s.kingdom === 'k4' && s.type !== 'capital') ks[3].territory.push({ q: s.q, r: s.r });
    tiles.set('7,7', { q: 7, r: 7, kingdom: 'k4', holySite: { name: 'Sacred Spring', faithId: 'solaris', controller: 'k4', level: 1 } });
    ks[3].territory.push({ q: 7, r: 7 });
    ks[3].religion.holySites.push({ q: 7, r: 7 });
    const world = {
        day, baseYear: 853, width: 40, height: 30, generationParams: { seed: 4242 }, events: [], kingdoms: ks, units: [],
        getKingdom: (id) => ks.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getSettlementViews: () => towns,
    };
    return { world, ks, towns, tiles };
}

function week(world, player, n = 1) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        do { world.day++; notices.push(...HolyWars.processDay(world, player).notices); } while (world.day % 7 !== HolyWars.config().weekDay);
    }
    return notices;
}

/** A holy war called, answered by the seat, in the field for `weeks` weeks. */
function warOn(world, ks, casus = 'infidel', site = null, weeks = 10, player = null) {
    week(world, player, 2);
    const sun = HolyWars.see(world, 'solaris|orthodox');
    // (the others stay home: one crusader, the seat)
    ks[1].wars = ['x1', 'x2'];
    ks[2].wars = ['x1', 'x2'];
    const war = HolyWars.call(world, player, sun, ks[3], casus, site);
    ks[1].wars = [];
    ks[2].wars = [];
    return { sun, war };
}

const coin = (world, ks) => ks.reduce((s, k) => s + k.treasury, 0) + Object.values(HolyWars.state(world).sees).reduce((s, x) => s + (x.coffers || 0), 0);

/** The see takes whatever is offered. */
function seeAgrees() {
    DataLoader._gamedata.holyWars.terms = { ...DataLoader._gamedata.holyWars.terms, accept: { ...DataLoader._gamedata.holyWars.terms.accept, min: 1, max: 1, yieldSite: 1 } };
}

describe('the ways out of a holy war', () => {
    it('envoys cannot end it: the war is sworn', () => {
        const { world, ks } = makeWorld();
        warOn(world, ks);
        expect(KingdomAI.isSworn(ks[0], ks[3], world)).toBe(true);
    });

    it('no terms before the crusaders have been in the field afterWeeks; then a price that follows the war', () => {
        const { world, ks, tiles } = makeWorld();
        const { war } = warOn(world, ks);
        // (still the call: no one to treat with)
        expect(HolyWars.terms(world, war, ks[3]).every(o => !o.ok)).toBe(true);
        week(world, null, 6);
        expect(war.phase).toBe('war');
        // (the AI would make its own terms: keep it out of this one)
        DataLoader._gamedata.holyWars.terms.ai = { everyWeeks: 9999 };
        week(world, null, 6);
        const fresh = HolyWars.indemnity(world, war, ks[3]);
        expect(HolyWars.terms(world, war, ks[3]).find(o => o.how === 'indemnity').ok).toBe(true);
        // Towns taken: dearer, and the see less willing
        const chance0 = HolyWars.termsChance(world, war, 'indemnity');
        tiles.get('9,9').settlement.kingdom = 'k1';
        war.gained = ['Ironford'];
        expect(HolyWars.indemnity(world, war, ks[3])).toBeGreaterThan(fresh);
        expect(HolyWars.termsChance(world, war, 'indemnity')).toBeLessThan(chance0);
        // Their resolve spent and the term run down: cheaper, and the see glad of it
        war.gained = [];
        war.resolve = 20;
        world.day = Math.floor((war.answerBy + war.until) / 2) + 200;
        expect(HolyWars.indemnity(world, war, ks[3])).toBeLessThan(fresh);
        expect(HolyWars.termsChance(world, war, 'indemnity')).toBeGreaterThan(chance0);
    });

    it('an AI crown losing a holy war buys its way out: real coin into the see and on to the crusaders, a truce, on record', () => {
        const { world, ks } = makeWorld();
        const { sun, war } = warOn(world, ks);
        const total0 = coin(world, ks);
        let rec = null;
        for (let i = 0; i < 80 && !rec; i++) {
            week(world, null);
            rec = HolyWars.state(world).past.find(h => h.id === war.id);
        }
        expect(rec).toBeTruthy();
        expect(rec.outcome).toBe('terms');
        expect(rec.terms.how).toBe('indemnity');
        expect(rec.terms.paid).toBeGreaterThan(0);
        // the war over through the realms' machinery: a truce, no longer at war
        expect(ks[0].wars).not.toContain('k4');
        expect(ks[0].truces.k4).toBeGreaterThan(world.day);
        // no coin made or lost: the treasuries and the coffers hold what they did
        expect(coin(world, ks)).toBeCloseTo(total0, 0);
        expect(sun.coffers).toBeGreaterThan(0);
        // humbled: its lords grumble a while
        expect(ks[3].church.humbledUntil).toBeGreaterThan(world.day);
        expect(HolyWars.state(world).log.some(e => e.kind === 'end' && /ends on terms/.test(e.text))).toBe(true);
        expect(world.events.some(e => /makes terms with the Church/.test(e.text))).toBe(true);
        expect(HolyWars.annalChapters(world, 0)[0].icon).toBe('🕊️');
    });

    it('an AI crown that is not losing seeks no terms', () => {
        const { world, ks } = makeWorld();
        ks[3].military = 5000;
        const { war } = warOn(world, ks);
        week(world, null, 20);
        expect(HolyWars.state(world).wars).toContain(war);
        expect(war.termsTried || 0).toBe(0);
    });

    it('the holy site yielded ends a holy war for it: the shrine and its ground to the crusader', () => {
        const { world, ks, tiles } = makeWorld();
        seeAgrees();
        DataLoader._gamedata.holyWars.terms.ai = { everyWeeks: 9999 };
        const { war } = warOn(world, ks, 'holySite', { q: 7, r: 7, name: 'Sacred Spring' });
        week(world, null, 12);
        const opt = HolyWars.terms(world, war, ks[3]).find(o => o.how === 'yieldSite');
        expect(opt.ok).toBe(true);
        const res = HolyWars._offer(world, null, war, ks[3], 'yieldSite', { notices: [] });
        expect(res.accepted).toBe(true);
        // (to the crusader crown nearest it)
        const to = HolyWars._receiver(world, { members: ['k1', 'k2', 'k3'].filter(id => HolyWars.state(world).past[0].members.includes(world.getKingdom(id).name)) }, { q: 7, r: 7 });
        expect(tiles.get('7,7').kingdom).toBe(to.id);
        expect(tiles.get('7,7').holySite.controller).toBe(to.id);
        expect(to.religion.holySites.some(h => h.q === 7 && h.r === 7)).toBe(true);
        expect(ks[3].religion.holySites.length).toBe(0);
        expect(HolyWars.state(world).past[0].outcome).toBe('terms');
    });

    it('a border town yielded goes to the nearest crusader; never the capital', () => {
        const { world, ks, tiles } = makeWorld();
        seeAgrees();
        DataLoader._gamedata.holyWars.terms.ai = { everyWeeks: 9999 };
        const { war } = warOn(world, ks);
        week(world, null, 12);
        const opt = HolyWars.terms(world, war, ks[3]).find(o => o.how === 'yield');
        expect(opt.ok).toBe(true);
        expect(opt.town).not.toBe('Kharnhold');
        const t = [...tiles.values()].find(x => x.settlement && x.settlement.name === opt.town);
        const to = HolyWars._receiver(world, war, t);
        expect(war.members).toContain(to.id);
        const res = HolyWars._offer(world, null, war, ks[3], 'yield', { notices: [] });
        expect(res.accepted).toBe(true);
        expect(t.settlement.kingdom).toBe(to.id);
        expect(t.settlement.formerKingdom).toBe('k4');
        expect(ks[3].capital).toEqual({ q: 8, r: 8 });
    });

    it('an infidel crown may proclaim tolerance; a heretic take the see\'s rite; a refusal bars envoys a while', () => {
        const { world, ks } = makeWorld();
        seeAgrees();
        DataLoader._gamedata.holyWars.terms.ai = { everyWeeks: 9999 };
        const { war } = warOn(world, ks);
        week(world, null, 12);
        expect(HolyWars._offer(world, null, war, ks[3], 'tolerate', { notices: [] }).accepted).toBe(true);
        expect(Laws.value(world, 'k4', 'heresy')).toBe('tolerance');

        // A heretic realm of the Sun's other rite
        const b = makeWorld();
        b.ks[3].religion = { faithId: 'solaris', rite: 'reformed', piety: 60, unity: 60, heresies: [], holySites: [] };
        const hw = warOn(b.world, b.ks, 'heretic');
        week(b.world, null, 12);
        // (the see turns it away: no envoy heard for cooldownDays)
        DataLoader._gamedata.holyWars.terms.accept = { ...DataLoader._gamedata.holyWars.terms.accept, min: 0, max: 0 };
        const no = HolyWars._offer(b.world, null, hw.war, b.ks[3], 'rite', { notices: [] });
        expect(no.accepted).toBe(false);
        expect(HolyWars.terms(b.world, hw.war, b.ks[3]).every(o => !o.ok)).toBe(true);
        b.world.day = hw.war.termsAfter;
        seeAgrees();
        expect(HolyWars._offer(b.world, null, hw.war, b.ks[3], 'rite', { notices: [] }).accepted).toBe(true);
        expect(b.ks[3].religion.rite || 'orthodox').toBe('orthodox');
    });

    it('the see hears terms sooner once a town has fallen to the crusaders', () => {
        const { world, ks } = makeWorld();
        const { war } = warOn(world, ks);
        const T = HolyWars.config().terms;
        expect(HolyWars.termsAfterWeeks(war)).toBe(T.afterWeeks);
        war.gained = ['Ironford'];
        expect(HolyWars.termsAfterWeeks(war)).toBe(T.afterWeeksLosing);
        expect(T.afterWeeksLosing).toBeLessThan(T.afterWeeks);
    });

    /** A holy war on Kharn holding only its capital (its other towns already gone), in the field. */
    function lastTownWar() {
        const made = makeWorld();
        const { world, ks, tiles } = made;
        for (const key of ['9,9', '6,8']) { tiles.get(key).settlement.kingdom = 'k2'; tiles.get(key).kingdom = 'k2'; }
        ks[3].territory = ks[3].territory.filter(t => !((t.q === 9 && t.r === 9) || (t.q === 6 && t.r === 8)));
        // (keep its own fortnightly seeking out of it: the plea is what is tested)
        DataLoader._gamedata.holyWars.terms.ai = { ...base.terms.ai, everyWeeks: 9999 };
        const { war } = warOn(world, ks);
        week(world, null, 6);
        return { ...made, war };
    }

    it('an AI crown besieged in its last town sues the see for terms before it capitulates; the term is on record', () => {
        const { world, ks, war } = lastTownWar();
        seeAgrees();
        expect(war.phase).toBe('war');
        expect(ks[3].holyPlea).toMatchObject({ war: war.id, asked: null });
        const crusader = world.getKingdom(war.members[0]);
        // the gates held: no capitulation, the war goes on while the envoys ride
        expect(KingdomAI._capitulates(crusader, ks[3], world)).toBe(true);
        expect(crusader.wars).toContain('k4');
        expect(ks[3].holyPlea.asked).toBe(world.day);
        expect(world.events.some(e => /sends envoys to the Church/.test(e.text))).toBe(true);
        // the see answers the same day, whatever the weeks
        HolyWars.processDay(world, null);
        const rec = HolyWars.state(world).past.find(h => h.id === war.id);
        expect(rec.outcome).toBe('terms');
        expect(rec.endedBy).toBe('terms');
        expect(rec.terms.how).toBe('indemnity');
        expect(rec.offers[rec.offers.length - 1]).toMatchObject({ how: 'indemnity', accepted: true, urgent: true });
        expect(crusader.wars).not.toContain('k4');
        expect(ks[3].holyPlea).toBeUndefined();
        expect(ks[3].isAlive).toBe(true);
    });

    it('refused, the besieged crown capitulates as any realm would', () => {
        const { world, ks, war } = lastTownWar();
        DataLoader._gamedata.holyWars.terms.accept = { ...base.terms.accept, min: 0, max: 0, yieldSite: 0 };
        const crusader = world.getKingdom(war.members[0]);
        expect(KingdomAI._capitulates(crusader, ks[3], world)).toBe(true);
        HolyWars.processDay(world, null);
        expect(HolyWars.state(world).wars).toContain(war);
        expect(ks[3].holyPlea.refused).toBe(true);
        expect(war.offers[war.offers.length - 1]).toMatchObject({ accepted: false, urgent: true });
        // (the next assault: no plea holds the gates, the realm's own capitulation roll decides)
        world.day++;
        const cap = KingdomAI.WAR.capitulate;
        KingdomAI.WAR.capitulate = 0;
        try { expect(KingdomAI._capitulates(crusader, ks[3], world)).toBe(false); } finally { KingdomAI.WAR.capitulate = cap; }
    });

    it('the player\'s crown offers terms; the purse tops up the chests; the House chronicle records it', () => {
        const { world, ks } = makeWorld();
        seeAgrees();
        ks[3].crown = { playerRuled: true };
        ks[3].treasury = 300;
        const player = { name: 'Aldo Harness', gold: 9000, q: 8, r: 8, karma: 0, reputation: {}, skills: {}, throne: { ruling: { kingdomId: 'k4' } }, house: { name: 'House Harness', generation: 1, prestige: 50, rivals: {}, history: [] } };
        Devotion.state(player).faithId = 'ironfaith';
        const { war } = warOn(world, ks, 'infidel', null, 10, player);
        week(world, player, 12);
        const list = HolyWars.termsFor(player, world);
        expect(list.length).toBe(1);
        const o = list[0].terms.find(x => x.how === 'indemnity');
        expect(o.ok).toBe(true);
        const gold0 = player.gold;
        const res = HolyWars.offerTerms(player, world, war.id, 'indemnity');
        expect(res.success).toBe(true);
        expect(res.accepted).toBe(true);
        expect(ks[3].treasury).toBeCloseTo(0, 1);
        expect(gold0 - player.gold).toBeCloseTo(o.cost - 300, 0);
        expect(HolyWars.termsFor(player, world).length).toBe(0);
        expect(player.house.chronicle || player.house.history).toBeTruthy();
    });
});
