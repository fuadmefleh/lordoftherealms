// Public executions (systems/executions.js): the condemned awaiting your word, the place and
// the manner, the crowd and its mood, the last words, what a death costs and what mercy buys,
// the rope that breaks, martyrs' shrines and their unrest, the truth about the innocent, the
// realms' own scaffolds and the crowd a visitor can join, the trial's 'scaffold' verdict.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Executions } from '../systems/executions.js';
import { Trials } from '../player/trials.js';

beforeAll(async () => { await loadData(); });
beforeEach(() => { Utils.setSeed(4242); });

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Cole', gender, born: -40 * 360, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], purse: 20, ...o });

function makeWorld({ day = 700 } = {}) {
    const hal = P(0, 'Hal', 'male', { spouse: 1, kids: [2], job: { id: 'smith', rank: 'master', since: 0 } });
    const meg = P(1, 'Meg', 'female', { spouse: 0, kids: [2], job: { id: 'healer', rank: 'master', since: 0 } });
    const rob = P(2, 'Rob', 'male', { parents: [0, 1], born: -20 * 360 });
    const nell = P(3, 'Nell', 'female');
    const folk = { q: 3, r: 4, n: 4, people: [hal, meg, rob, nell], annals: [] };
    const kingdom = { id: 1, name: 'Varn', isAlive: true, treasury: 5000, stability: 60, culture: 'Imperial', laws: {}, capital: { q: 3, r: 4 } };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk, economy: { gold: 2000 }, type: 'town', population: 900, happiness: 60 };
    // A neighbouring realm the player does not rule, with folk of its own in its capital
    const ofolk = { q: 8, r: 8, n: 2, people: [P(10, 'Wat', 'male'), P(11, 'Ivo', 'male')], annals: [] };
    const other = { id: 2, name: 'Oster', isAlive: true, treasury: 3000, stability: 55, culture: 'Imperial', laws: {}, capital: { q: 8, r: 8 } };
    const otown = { name: 'Osterburg', q: 8, r: 8, kingdom: 2, folk: ofolk, economy: { gold: 1500 }, type: 'city', population: 4000, happiness: 50 };
    const world = {
        day, generationParams: { seed: 7 }, kingdoms: [kingdom, other], events: [], width: 40, height: 40,
        getTile: (q, r) => (q === 3 && r === 4 ? { q, r, settlement: town } : q === 8 && r === 8 ? { q, r, settlement: otown } : null),
        getSettlementViews: () => [town, otown],
        getKingdom: (id) => (String(id) === '1' ? kingdom : String(id) === '2' ? other : null),
    };
    return { world, folk, town, kingdom, other, otown, ofolk, hal, meg, rob, nell };
}

function makePlayer(o = {}) {
    return {
        name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 500, karma: 0, reputation: { 1: 20 }, q: 3, r: 4,
        strength: 8, charisma: 7, intelligence: 6, faith: 5, luck: 5,
        skills: { combat: 8, commerce: 5, leadership: 6, diplomacy: 7, stealth: 5 },
        inventory: {}, house: { name: 'House Voss', generation: 1, prestige: 100, history: [], rivals: {} }, children: [],
        throne: { ruling: { kingdomId: 1 } }, ...o,
    };
}

// The day's chances, pinned for a spec (restored after each)
let saved = null;
function pin(o) {
    const C = Executions.config();
    saved = saved || JSON.parse(JSON.stringify({ disruption: C.disruption, martyr: C.martyr, ai: C.ai, surfaceChance: C.surfaceChance }));
    if (o.rescue != null) C.disruption.rescue = { ...C.disruption.rescue, max: o.rescue, base: o.rescue, perKin: 0, perPopularity: 0, house: 0, band: 0, angry: 0, present: 1, success: 1 };
    if (o.riot != null) C.disruption.riot = { ...C.disruption.riot, angry: o.riot, sullen: o.riot };
    if (o.rope != null) C.disruption.rope = { chance: o.rope };
    if (o.martyr != null) C.martyr = { ...C.martyr, innocent: o.martyr, popular: o.martyr };
    if (o.ai != null) C.ai = { ...C.ai, chance: o.ai };
    if (o.surface != null) C.surfaceChance = o.surface;
}
afterEach(() => {
    if (!saved) return;
    const C = Executions.config();
    C.disruption = saved.disruption; C.martyr = saved.martyr; C.ai = saved.ai; C.surfaceChance = saved.surfaceChance;
    saved = null;
});
const calm = () => pin({ rescue: 0, riot: 0, rope: 0 });

describe('Executions — the condemned', () => {
    it('condemn puts a townsperson in the cells on the list awaiting your word, once', () => {
        const { world, nell } = makeWorld();
        const p = makePlayer();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 3 }, { crime: 'murder', source: 'test', ref: 'x1', guilty: true });
        expect(e).toBeTruthy();
        expect(e.name).toBe('Nell Cole');
        expect(e.gender).toBe('female');
        expect(nell.jailedUntil).toBeGreaterThan(world.day);
        expect(Executions.list(p)).toHaveLength(1);
        expect(Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 3 }, { crime: 'murder' })).toBe(null);
        expect(Executions.fateOf(p, 'test', 'x1').waiting).toBe(true);
        expect((world._interrupts || []).some(i => i.source === 'executions')).toBe(true);
    });

    it('the manner suits the rank, the crime and the faith: no axe for a commoner, the stake only for heresy', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        const thief = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 3 }, { crime: 'theft', guilty: true });
        const m = Object.fromEntries(Executions.methods(p, world, thief).map(x => [x.id, x]));
        expect(m.hang.ok).toBe(true);
        expect(m.behead.ok).toBe(false);
        expect(m.burn.ok).toBe(false);
        expect(m.quarter.ok).toBe(false);
        const lord = Executions.condemn(p, world, { kind: 'other', name: 'Sir Odo Brand', gender: 'male', rank: 'noble', q: 3, r: 4, kingdomId: 1 }, { crime: 'treason', guilty: true });
        const lm = Object.fromEntries(Executions.methods(p, world, lord).map(x => [x.id, x]));
        expect(lm.behead.ok).toBe(true);
        expect(lm.quarter.ok).toBe(true);
    });

    it('the crowd: a loved healer hanged for a debt is a sullen crowd; a murderer, a baying one', () => {
        const { world } = makeWorld();
        const place = { q: 3, r: 4 };
        const loved = Executions.crowd(world, place, { proclaimed: true, method: 'hang', guilty: true, crime: 'debt', popularity: 40 });
        const hated = Executions.crowd(world, place, { proclaimed: true, method: 'hang', guilty: true, crime: 'murder', popularity: -10 });
        expect(['sullen', 'angry']).toContain(loved.mood.id);
        expect(['baying', 'eager']).toContain(hated.mood.id);
        const quick = Executions.crowd(world, place, { proclaimed: false, method: 'hang', crime: 'murder' });
        expect(quick.size).toBeLessThan(hated.size);
    });
});

describe('Executions — the day', () => {
    it('proclaimed, the day comes: the condemned dies, the kin and the town remember, thieves are cowed', () => {
        calm();
        const { world, town, meg, hal } = makeWorld();
        const p = makePlayer({ q: 0, r: 0 });
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 0 }, { crime: 'murder', guilty: true, quiet: true });
        const r = Executions.proclaim(p, world, e.id, 'hang', '3,4');
        expect(r.success).toBe(true);
        expect(Executions.carryOut(p, world, e.id, 'hang', '3,4').success).toBe(false); // (not there: proclaim, or go)
        world.day = Executions.get(p, e.id).proclaimed.day;
        const out = Executions.processDay(world, p);
        expect(out.notices.some(n => /Scaffold of Ashford/.test(n.title))).toBe(true);
        expect(hal.died).not.toBe(null);
        expect((meg.nm || []).some(m => m.k === 'hanged')).toBe(true);
        expect((town.folk.nm || []).some(m => m.k === 'hanged')).toBe(true);
        expect(Executions.list(p)).toHaveLength(0);
        const h = Executions.state(p).history[0];
        expect(h.outcome).toBe('executed');
        expect(h.words).toBeTruthy();
        expect(Executions.deterrence(town, world.day)).toBeLessThan(1);
        expect(Executions.deterrence(town, world.day + 400)).toBe(1);
        expect(p.house.history.some(x => /died by the rope in Ashford/.test(x.text))).toBe(true);
        expect(Executions.state(p).stats.executed).toBe(1);
    });

    it('a burning is the cruellest name: cruelty, the butcher\'s infamy, the realm\'s talk', () => {
        calm();
        const { world } = makeWorld();
        world.kingdoms[0].religion = { faithId: 'solaris' };
        const p = makePlayer();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 3 }, { crime: 'heresy', guilty: true, quiet: true });
        const burn = Executions.methods(p, world, e).find(x => x.id === 'burn');
        expect(burn.ok).toBe(true);
        const r = Executions.carryOut(p, world, e.id, 'burn', '3,4');
        expect(r.success).toBe(true);
        expect(r.outcome).toBe('executed');
        expect(p.atrocities && p.atrocities.butcher).toBeGreaterThan(0);
        expect((p.gossip && p.gossip.rumors || []).some(x => x.type === 'burning')).toBe(true);
    });

    it('the rope breaks: back on the list; sparing them then is a blessing on your name', () => {
        pin({ rescue: 0, riot: 0, rope: 1 });
        const { world, town, nell } = makeWorld();
        const p = makePlayer();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 3 }, { crime: 'theft', guilty: true, quiet: true });
        const r = Executions.carryOut(p, world, e.id, 'hang', '3,4');
        expect(r.outcome).toBe('rope');
        expect(nell.died).toBe(null);
        expect(Executions.get(p, e.id).ropeBroke).toBe(true);
        const h0 = town.happiness;
        const s = Executions.spare(p, world, e.id, 'pardon');
        expect(s.success).toBe(true);
        expect(town.happiness).toBeGreaterThan(h0);
        expect(nell.jailedUntil).toBe(null);
        expect((nell.nm || []).some(m => m.k === 'spared_scaffold')).toBe(true);
        expect(Executions.state(p).stats.spared).toBe(1);
    });

    it('a rescue from the crowd: the condemned is gone into the lanes', () => {
        pin({ rescue: 1, riot: 0, rope: 0 });
        const { world, nell } = makeWorld();
        const p = makePlayer();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 3 }, { crime: 'theft', guilty: true, quiet: true });
        const r = Executions.carryOut(p, world, e.id, 'hang', '3,4');
        expect(r.outcome).toBe('rescued');
        expect(nell.died).toBe(null);
        expect(nell.away).toBeTruthy();
        expect(Executions.list(p)).toHaveLength(0);
    });

    it('exile and the cloister send them away alive', () => {
        calm();
        const { world, rob } = makeWorld();
        const p = makePlayer();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 2 }, { crime: 'arson', guilty: true, quiet: true });
        expect(Executions.spare(p, world, e.id, 'cloister').success).toBe(true);
        expect(rob.died).toBe(null);
        expect(rob.away.to).toBe('a cloister');
    });
});

describe('Executions — those in your power', () => {
    it('a rebel lord of your court to the block: gone from the court, the rest cowed; an outlaw taken for a bounty hanged', () => {
        calm();
        const { world } = makeWorld();
        const p = makePlayer();
        p.throne.ruling.court = { vassals: [
            { id: 'vassal_1', firstName: 'Odo', dynasty: 'Brand', gender: 'male', rebel: true, seat: { q: 3, r: 4, name: 'Ashford' }, grudge: 0 },
            { id: 'vassal_2', firstName: 'Piers', dynasty: 'Holt', gender: 'male', grudge: 0, cowedUntil: 0 },
        ] };
        p.activeBounties = [{ id: 'b1', type: 'criminal_hunt', status: 'captured_pending_decision', targetName: 'Black Jory', crime: 'highway robbery', fromQ: 3, fromR: 4, kingdomId: 1 }];
        const ts = Executions.targets(p, world);
        expect(ts.find(t => t.kind === 'vassal' && t.id === 'vassal_1').guilty).toBe(true);
        expect(ts.find(t => t.kind === 'vassal' && t.id === 'vassal_2').guilty).toBe(false);
        const lord = Executions.bring(p, world, 'vassal', 'vassal_1').entry;
        expect(lord.rank).toBe('vassal');
        expect(Executions.carryOut(p, world, lord.id, 'behead', '3,4').outcome).toBe('executed');
        const court = p.throne.ruling.court;
        expect(court.vassals.map(v => v.id)).toEqual(['vassal_2']);
        expect(court.vassals[0].cowedUntil).toBeGreaterThan(world.day);
        const jory = Executions.bring(p, world, 'bounty', 'b1').entry;
        expect(jory.crime).toBe('banditry');
        expect(Executions.carryOut(p, world, jory.id, 'hang', '3,4').outcome).toBe('executed');
        expect(p.activeBounties.some(b => b.id === 'b1')).toBe(false);
    });
});

describe('Executions — a ward of a rival House', () => {
    it('a ward raised at your court can be brought to the scaffold; the axe breaks guest-right, and every House hears', () => {
        calm();
        const { world } = makeWorld();
        const p = makePlayer();
        const child = { firstName: 'Ada', gender: 'female', age: 15, wardOf: 'player' };
        const other = { kingdomId: 'r2', name: 'House Grey', feud: 10, head: { firstName: 'Hugo', children: [] } };
        const rival = { kingdomId: 'r1', name: 'House Marr', feud: 20, head: { firstName: 'Bran', gender: 'male', age: 50, children: [child] }, seat: { name: 'Marrholt' } };
        p.house.rivals = { r1: rival, r2: other };
        p.house.wards = [{ id: 'w7', rivalId: 'r1', rivalChild: 'Ada', firstName: 'Ada', kingdomId: 'r1', kingdomName: 'House Marr', since: 600, age: 12, kept: true }];
        const t = Executions.targets(p, world).find(x => x.kind === 'rival');
        expect(t).toBeTruthy();
        expect(t.id).toBe('w:w7');
        expect(t.ward).toBe(true);
        const e = Executions.bring(p, world, 'rival', t.id).entry;
        expect(e.ref.ward).toBe(true);
        expect(Executions.methods(p, world, e).find(m => m.id === 'behead').ok).toBe(true);
        const k0 = p.karma;
        const pr0 = p.house.prestige;
        const r = Executions.carryOut(p, world, e.id, 'behead', '3,4');
        expect(r.outcome).toBe('executed');
        expect(r.text).toMatch(/guest-right/);
        expect(rival.head.children).toHaveLength(0);
        expect(p.house.wards).toHaveLength(0);
        expect(rival.feud).toBeGreaterThan(20);
        expect(other.feud).toBeGreaterThan(10); // (every House hears)
        expect(p.karma).toBeLessThan(k0 - 10);
        expect(p.house.prestige).toBeLessThan(pr0);
        expect(p.house.history.some(h => /guest-right broken/.test(h.text))).toBe(true);
    });
});

describe('Executions — martyrs and the truth', () => {
    it('an innocent put to death on another\'s word: a martyr\'s shrine, unrest in your town, the truth comes out', () => {
        pin({ rescue: 0, riot: 0, rope: 0, martyr: 1, surface: 1 });
        const { world, town } = makeWorld();
        const p = makePlayer();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 3 }, { crime: 'spying', source: 'interrogation', ref: 'conf-9', guilty: false, quiet: true });
        const r = Executions.carryOut(p, world, e.id, 'hang', '3,4');
        expect(r.outcome).toBe('executed');
        const cults = Executions.cults(world);
        expect(cults).toHaveLength(1);
        expect(cults[0].by.kind).toBe('player');
        expect((town.folk.nm || []).some(m => m.k === 'martyred')).toBe(true);
        expect(Executions.fateOf(p, 'interrogation', 'conf-9').outcome).toBe('executed');
        // A week: the shrine sours the town you rule
        const h0 = town.happiness;
        world.day = Math.ceil((world.day + 1) / 7) * 7;
        Executions.processDay(world, p);
        expect(town.happiness).toBeLessThan(h0);
        // The truth
        const hist = Executions.state(p).history[0];
        expect(hist.surface).toBeGreaterThan(0);
        world.day = hist.surface;
        const out = Executions.processDay(world, p);
        expect(out.notices.some(n => n.title === 'The Truth Comes Out')).toBe(true);
        expect(p.karma).toBeLessThan(0);
        // Endowing the shrine: coin into the town's purse, the unrest ends
        const gold0 = town.economy.gold;
        const en = Executions.endowShrine(p, world, cults[0].id);
        expect(en.success).toBe(true);
        expect(town.economy.gold).toBeGreaterThan(gold0);
        expect(p.gold).toBeLessThan(500);
    });
});

describe('Executions — the realms\' scaffolds', () => {
    it('a realm hangs its condemned; a visitor in town that day can join the crowd; the world turns with no player', () => {
        pin({ ai: 1 });
        const { world, ofolk } = makeWorld({ day: 700 });
        const p = makePlayer({ q: 8, r: 8 });
        const out = Executions.processDay(world, p);
        const pub = world.executions.public.filter(x => x.kingdomId === 2);
        expect(pub.length).toBe(1);
        expect(world.executions.public.some(x => x.kingdomId === 1)).toBe(false); // (the realm you rule is your scaffold)
        expect(out.notices.some(n => n.title === 'A Death Proclaimed')).toBe(true);
        world.day = pub[0].day;
        expect(Executions.crowdsAt(world, 8, 8)).toHaveLength(1);
        const r = Executions.attend(p, world, pub[0].id, 'watch');
        expect(r.success).toBe(true);
        const dead = ofolk.people.find(x => x.id === pub[0].pid);
        expect(dead.died).not.toBe(null);
        expect(Executions.crowdsAt(world, 8, 8)).toHaveLength(0);
        // The interregnum: the world's scaffolds still turn
        world.day = 707;
        expect(() => Executions.processDay(world, null)).not.toThrow();
        // Saved and restored with the world
        const saved = Executions.serializeWorld(world);
        const w2 = { ...world };
        Executions.restoreWorld(saved, w2);
        expect(w2.executions.log.length).toBe(world.executions.log.length);
    });
});

describe('Executions — the trial\'s verdict', () => {
    it('"Condemn to the scaffold" sends the convicted to the list; the scaffold\'s end is written back on the trial', () => {
        calm();
        const { world, nell } = makeWorld();
        const p = makePlayer();
        expect(Trials.verdicts(world, null).some(v => v.id === 'scaffold')).toBe(true);
        const st = Trials.state(p);
        st.cases.push({ id: 77, q: 3, r: 4, key: '3,4', town: 'Ashford', kingdomId: 1, accused: { name: 'Nell Cole', pid: 3 }, crime: 'murder', crimeLabel: 'murder', severity: 4, proof: 3, guilty: true });
        const res = Trials.rule(p, world, 77, 'scaffold');
        expect(res.success).toBe(true);
        expect(nell.died).toBe(null);
        const e = Executions.list(p)[0];
        expect(e.source).toBe('trial');
        Executions.carryOut(p, world, e.id, 'hang', '3,4');
        expect(nell.died).not.toBe(null);
        expect(st.judged.find(j => j.id === 77).verdict).toBe('hang');
    });
});
