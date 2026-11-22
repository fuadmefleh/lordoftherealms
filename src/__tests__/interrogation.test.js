// The dungeon (systems/interrogation.js): those you hold put to the question. What they give up is
// real game state (a hidden plot, a rival's bought man, an outlaw lair, a rival House's secrets);
// under the irons they may lie and name an innocent, and acting on a lie costs you. The law on
// torture, the body's price, death in custody, a rival House torturing your hostage child.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Interrogation } from '../systems/interrogation.js';
import { PeopleCrimes } from '../systems/peopleCrimes.js';
import { Schemes } from '../systems/schemes.js';
import { RivalAgents } from '../systems/rivalAgents.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Afterlife } from '../player/afterlife.js';
import { Executions } from '../systems/executions.js';
import { RealmIntel } from '../systems/realmIntel.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) { DataLoader.clearCache(); await DataLoader.initializeAll(); }
});

let saved;
beforeEach(() => { Utils.setSeed(4242); saved = DataLoader._gamedata.interrogation; });
afterEach(() => { DataLoader._gamedata.interrogation = saved; });

/** Make every step certain to break (or not), and the lies certain or impossible. */
function tune({ brk = 1, lie = 0, lieEmpty = 0, death = 0, leak = 0 } = {}) {
    const d = JSON.parse(JSON.stringify(saved));
    for (const s of Object.values(d.steps)) { s.break = brk; s.lie = lie; s.lieEmpty = lieEmpty; s.death = death; s.markChance = 0; }
    d.deathPerHp = 0;
    for (const k of Object.values(d.know)) for (const f of Object.keys(k)) if (!/Radius|Days/.test(f)) k[f] = 1;
    d.resolve.minBreak = brk >= 1 ? 1 : 0;
    d.resolve.maxBreak = brk >= 1 ? 1 : 0;
    d.leak = { captive: leak, rival: leak, bounty: leak };
    DataLoader._gamedata.interrogation = d;
}

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Ware', gender, born: -40 * 120, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], purse: 20, traits: [], ...o });

function makeWorld({ torture = 'forbidden', day = 2000 } = {}) {
    const people = [P(0, 'Hal', 'male'), P(1, 'Meg', 'female'), P(2, 'Rob', 'male'), P(3, 'Nell', 'female'), P(4, 'Tam', 'male')];
    const folk = { q: 3, r: 4, n: people.length, people, annals: [] };
    const kingdom = { id: 1, name: 'Varn', isAlive: true, treasury: 5000, stability: 60, culture: 'Imperial', laws: { torture }, capital: { q: 3, r: 4 } };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk, culture: 'Imperial', economy: { gold: 2000 }, type: 'town', population: 900 };
    const world = {
        day, generationParams: { seed: 11 }, kingdoms: [kingdom], events: [], width: 40, height: 40,
        getTile: (q, r) => (q === 3 && r === 4 ? { q, r, settlement: town } : { q, r, terrain: { passable: true } }),
        getSettlementViews: () => [town],
        getKingdom: (id) => (String(id) === '1' ? kingdom : null),
    };
    return { world, folk, town, kingdom, people };
}

function makePlayer(o = {}) {
    return {
        name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 500, karma: 0, reputation: { 1: 20 }, q: 3, r: 4, faith: 5,
        skills: { diplomacy: 5 }, inventory: {}, children: [],
        house: { name: 'House Voss', generation: 1, prestige: 100, history: [], rivals: {} }, ...o,
    };
}

/** Lock townsperson `pid` in the player's cellar. */
function cellar(player, world, pid) {
    const st = PeopleCrimes.state(player);
    const p = world.getTile(3, 4).settlement.folk.people.find(x => x.id === pid);
    p.away = { d: world.day, to: 'no one knows where' };
    const c = { id: st.nextId++, q: 3, r: 4, pid, name: `${p.first} ${p.last}`, town: 'Ashford', kingdom: 1, place: 'house', day: world.day - 3, fed: true, hunger: 0, starveAt: 18 };
    st.captives.push(c);
    return c;
}

function rival(o = {}) {
    return { kingdomId: 2, name: 'House Thorne', houseKey: 'thorne', feud: 40, gold: 3000, head: { firstName: 'Osric', gender: 'male', age: 50, children: [] }, memory: [], ...o };
}

describe('Interrogation — who is held', () => {
    it('lists a cellar captive, an outlaw taken for a bounty, and a rival House\'s child', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        cellar(player, world, 2);
        player.activeBounties = [{ id: 'b1', type: 'criminal_hunt', status: 'captured_pending_decision', targetName: 'Black Wat', crime: 'murder', targetQ: 5, targetR: 5, difficulty: 4, kingdomId: 1 }];
        const r = rival();
        const kid = { firstName: 'Edda', gender: 'female', age: 17, uid: 'rc:thorne:Edda:17' };
        r.head.children.push(kid);
        player.house.rivals[2] = r;
        player.maiming = { v: 1, history: [], stats: { total: 0, byAct: {}, suffered: 0 }, enemyDays: {}, captives: [{ id: 1, rivalId: 2, uid: kid.uid, name: 'Edda Thorne', gender: 'female', day: 1990, how: 'the road', person: kid }], nextCaptive: 2 };
        const held = Interrogation.held(player, world);
        expect(held.map(h => h.kind).sort()).toEqual(['bounty', 'captive', 'rival']);
        expect(held.find(h => h.kind === 'rival').gender).toBe('female');
    });
});

describe('Interrogation — the law', () => {
    it('forbidden: only words are lawful; free: anything; for treason only: a feuding House\'s blood', () => {
        const a = makeWorld({ torture: 'forbidden' });
        const player = makePlayer();
        cellar(player, a.world, 2);
        const h = Interrogation.held(player, a.world)[0];
        expect(Interrogation.lawful(player, a.world, h, 'threaten')).toBe(true);
        expect(Interrogation.lawful(player, a.world, h, 'irons')).toBe(false);
        a.kingdom.laws.torture = 'free';
        expect(Interrogation.lawful(player, a.world, h, 'fire')).toBe(true);
        a.kingdom.laws.torture = 'treason';
        expect(Interrogation.lawful(player, a.world, h, 'irons')).toBe(false);
        // …unless they are a rival's bought man
        player.rivalAgents = { agents: [{ id: 1, rivalId: 2, rivalName: 'House Thorne', kind: 'informant', q: 3, r: 4, pid: 2, name: 'Rob Ware', role: 'villager', town: 'Ashford', known: false, turned: false }], nextId: 2, log: [], stats: {} };
        expect(Interrogation.lawful(player, a.world, h, 'irons')).toBe(true);
    });
});

describe('Interrogation — what they give up is real', () => {
    it('a plotter\'s own tool gives up the plot: revealed, and the agent a suspect', () => {
        tune();
        const { world } = makeWorld();
        const player = makePlayer();
        player.house.rivals[2] = rival();
        player.house.schemes = [{ id: 1, type: 'slander', rivalId: 2, realmId: 2, rivalName: 'House Thorne', target: { q: 3, r: 4 }, startDay: 1995, dueDay: 2010, revealed: false, agent: { q: 3, r: 4, pid: 3, name: 'Nell Ware', role: 'villager', town: 'Ashford' } }];
        player.house._nextSchemeId = 2;
        cellar(player, world, 3);
        const h = Interrogation.held(player, world)[0];
        const r = Interrogation.question(player, world, h.key, 'talk');
        expect(r.success).toBe(true);
        expect(r.broke).toBe(true);
        expect(r.told).toBe('scheme');
        expect(Schemes.known(player)).toHaveLength(1);
        expect(r.text).toMatch(/House Thorne/);
        // once a day
        expect(Interrogation.question(player, world, h.key, 'talk').success).toBe(false);
    });

    it('a rival\'s bought man is a name: accused, it was true — exposed and driven out', () => {
        tune();
        const { world, people } = makeWorld();
        const player = makePlayer();
        player.house.rivals[2] = rival();
        player.rivalAgents = { agents: [{ id: 1, rivalId: 2, rivalName: 'House Thorne', kind: 'informant', q: 3, r: 4, pid: 4, name: 'Tam Ware', role: 'villager', town: 'Ashford', known: false, turned: false, suspicion: 0, acts: 0 }], nextId: 2, log: [], stats: { recruited: 1, exposed: 0, turned: 0, sabotaged: 0, leaks: 0, inquiries: 0 } };
        cellar(player, world, 4); // (the agent himself)
        const h = Interrogation.held(player, world)[0];
        const r = Interrogation.question(player, world, h.key, 'threaten');
        expect(r.told).toBe('agent');
        const [n] = Interrogation.names(player);
        expect(n.name).toBe('Tam Ware');
        expect(n.truth).toEqual({ type: 'agent', id: 1 });
        // (a name looks the same either way: the panel shows no truth)
        const a = Interrogation.accuse(player, world, n.id);
        expect(a.success).toBe(true);
        expect(a.truth).toBe(true);
        expect(RivalAgents.list(player)).toHaveLength(0);
        expect(people[4]).toBeTruthy();
    });

    it('an outlaw tells where a lair lies: it is on your charts', () => {
        tune();
        const { world } = makeWorld();
        const player = makePlayer();
        player.activeBounties = [{ id: 'b1', type: 'criminal_hunt', status: 'captured_pending_decision', targetName: 'Black Wat', crime: 'murder', targetQ: 5, targetR: 5, difficulty: 4, kingdomId: 1 }];
        const st = OutlawLairs.state(player);
        st.lairs.push({ id: 7, name: 'Crow Hollow', kind: 'bandit_camp', q: 9, r: 9, status: 'active', known: false, rumoured: false, strength: 30, parties: [], hoard: { gold: 240, goods: {} }, leader: { name: 'Gerd One-Ear' }, log: [] });
        const h = Interrogation.held(player, world)[0];
        const r = Interrogation.question(player, world, h.key, 'irons');
        expect(r.told).toBe('lair');
        expect(st.lairs[0].known).toBe(true);
        expect(r.text).toMatch(/Crow Hollow/);
    });

    it('a rival House\'s child tells its secrets: the purse, and its plots come to light sooner', () => {
        tune();
        const { world } = makeWorld();
        const player = makePlayer();
        const r0 = rival({ feud: 30 });
        const kid = { firstName: 'Edda', gender: 'female', age: 17, uid: 'rc:thorne:Edda:17' };
        r0.head.children.push(kid);
        player.house.rivals[2] = r0;
        player.maiming = { v: 1, history: [], stats: { total: 0, byAct: {}, suffered: 0 }, enemyDays: {}, captives: [{ id: 1, rivalId: 2, uid: kid.uid, name: 'Edda Thorne', gender: 'female', day: 1990, how: 'the road', person: kid }], nextCaptive: 2 };
        const h = Interrogation.held(player, world)[0];
        const before = Schemes.revealChance(player, { rivalId: 2 }, world.day);
        const r = Interrogation.question(player, world, h.key, 'talk');
        expect(r.told).toBe('intel');
        expect(player.house.informants[2]).toBeTruthy();
        expect(Schemes.revealChance(player, { rivalId: 2 }, world.day)).toBeGreaterThan(before);
        expect(Interrogation.state(player).intel[2].gold).toBe(3000);
    });
});

describe('Interrogation — lies, and acting on them', () => {
    it('one who knows nothing names an innocent under the irons; accused, the town turns on you', () => {
        tune({ lieEmpty: 1 });
        const { world, people } = makeWorld({ torture: 'free' });
        const player = makePlayer();
        player.house.rivals[2] = rival();
        cellar(player, world, 1);
        const h = Interrogation.held(player, world)[0];
        const r = Interrogation.question(player, world, h.key, 'irons');
        expect(r.told).toBe('name');
        const [n] = Interrogation.names(player);
        expect(n.truth).toBeNull();
        expect(n.pid).not.toBe(1);
        const rep = player.reputation[1];
        const a = Interrogation.accuse(player, world, n.id);
        expect(a.truth).toBe(false);
        expect(player.reputation[1]).toBeLessThan(rep);
        const innocent = people.find(p => p.id === n.pid);
        expect(JSON.stringify(innocent)).toMatch(/named_under_torture/);
    });
});

describe('Interrogation — the scaffold', () => {
    it('a name condemned goes onto the list for the scaffold, which is told the truth the player is not', () => {
        tune({ lieEmpty: 1 });
        const { world } = makeWorld({ torture: 'free' });
        const player = makePlayer();
        player.house.rivals[2] = rival();
        cellar(player, world, 1);
        const h = Interrogation.held(player, world)[0];
        Interrogation.question(player, world, h.key, 'irons');
        const [n] = Interrogation.names(player);
        expect(Interrogation.canCondemn()).toBe(true);
        const r = Interrogation.condemn(player, world, n.id);
        expect(r.success).toBe(true);
        expect(n.status).toBe('condemned');
        const e = Executions.list(player).find(x => x.source === 'interrogation');
        expect(e).toBeTruthy();
        expect(e.guilty).toBe(false);
        expect(e.name).toBe(n.name);
    });
});

describe('Interrogation — prisoners of war', () => {
    it('a captain taken from a beaten host: held, ransomed out of the treasury of his realm', () => {
        const d = JSON.parse(JSON.stringify(saved));
        d.pow.chance = 1;
        DataLoader._gamedata.interrogation = d;
        const { world, kingdom } = makeWorld();
        const player = makePlayer();
        const w = Interrogation.takePrisoners(player, world, { kingdomId: 1, strength: 30, how: 'in the field' });
        expect(w).toBeTruthy();
        expect(w.rank).toBe('captain');
        expect(Interrogation.held(player, world).find(h => h.kind === 'pow')).toBeTruthy();
        const price = Interrogation.powRansom(player, world, w);
        expect(price).toBe(80);
        const gold = player.gold;
        const r = Interrogation.ransomPow(player, world, w.id);
        expect(r.success).toBe(true);
        expect(player.gold).toBe(gold + 80);
        expect(kingdom.treasury).toBe(5000 - 80);
        expect(Interrogation.held(player, world)).toHaveLength(0);
    });

    it('a captain who talks opens the books and army to you for a season', () => {
        tune();
        const d = DataLoader._gamedata.interrogation;
        d.pow.chance = 1;
        const { world } = makeWorld();
        const player = makePlayer();
        Interrogation.takePrisoners(player, world, { kingdomId: 1, strength: 50, how: 'in the field' });
        expect(RealmIntel.can(player, world, 1, 'books')).toBe(false);
        const h = Interrogation.held(player, world).find(x => x.kind === 'pow');
        const r = Interrogation.question(player, world, h.key, 'talk');
        expect(r.told).toBe('realm');
        expect(RealmIntel.can(player, world, 1, 'books')).toBe(true);
        expect(RealmIntel.can(player, world, 1, 'military')).toBe(true);
        expect(RealmIntel.whyLabel(player, world, 1, 'books')).toMatch(/prisoner/);
    });
});

describe('Interrogation — the leader of a rising', () => {
    it('names the ringleaders; accused, it was true, and the grievance of the town falls', () => {
        tune();
        const { world } = makeWorld({ torture: 'treason' });
        world.peasantRevolts = { towns: { '3,4': { g: 70, p: 70 } } };
        const player = makePlayer();
        world.getTile(3, 4).settlement.folk.people[0].away = { d: 1990, to: 'prison' };
        player.peasantRevolts = { prisoners: [{ id: 1, kind: 'rebel_leader', name: 'Hal Ware', gender: 'male', pid: 0, q: 3, r: 4, town: 'Ashford', kingdomId: 1, day: 1990, knows: { accomplices: ['Meg Ware'], towns: ['Ashford'] } }], nextId: 2 };
        const h = Interrogation.held(player, world).find(x => x.kind === 'rebel');
        expect(h).toBeTruthy();
        expect(Interrogation.lawful(player, world, h, 'irons')).toBe(true); // (a rebel is a traitor under every law but "forbidden")
        const r = Interrogation.question(player, world, h.key, 'talk');
        expect(r.told).toBe('accomplice');
        const [n] = Interrogation.names(player);
        expect(n.name).toBe('Meg Ware');
        const a = Interrogation.accuse(player, world, n.id);
        expect(a.truth).toBe(true);
        expect(world.peasantRevolts.towns['3,4'].g).toBe(62);
    });
});

describe('Interrogation — your spies in their cells', () => {
    it('a crown puts your captured spy to the question: your missions against it are blown, its regard falls', () => {
        const d = JSON.parse(JSON.stringify(saved));
        d.spies.chance = 1;
        d.spies.secondChance = 0;
        DataLoader._gamedata.interrogation = d;
        const { world } = makeWorld();
        const player = makePlayer();
        const spy = { id: 5, name: 'Sly Tom', status: 'on_mission', currentMission: 77 };
        player.espionage = { spies: [spy], activeMissions: [{ id: 77, spyId: 5, targetKingdom: 1 }], takenSpies: [{ id: 9, name: 'Wat Reed', kingdomId: 1, day: world.day - 7 }] };
        const out = Interrogation.processDay(world, player);
        expect(out.notices.some(n => /Wat Reed/.test(n.title))).toBe(true);
        expect(player.espionage.activeMissions).toHaveLength(0);
        expect(spy.status).toBe('idle');
        expect(player.reputation[1]).toBe(12);
        expect(player.espionage.takenSpies).toHaveLength(0);
    });
});

describe('Interrogation — the price', () => {
    it('torture costs karma and the name for cruelty; word that gets out of an unlawful cellar costs the realm\'s regard', () => {
        tune({ brk: 0, leak: 1 });
        const { world } = makeWorld({ torture: 'forbidden' });
        const player = makePlayer();
        cellar(player, world, 2);
        const h = Interrogation.held(player, world)[0];
        const r = Interrogation.question(player, world, h.key, 'irons');
        expect(r.broke).toBe(false);
        expect(r.seen).toBe(true);
        expect(player.karma).toBeLessThan(0);
        expect(player.atrocities.butcher).toBeGreaterThan(0);
        expect(player.reputation[1]).toBeLessThan(20);
        expect(Interrogation.subject(player, h, world).hp).toBeLessThan(100);
        // the cellar's hunger: deprived of bread (read by PeopleCrimes' starving)
        world.day++;
        Interrogation.question(player, world, h.key, 'deprive');
        expect(PeopleCrimes.captives(player)[0].hunger).toBe(2);
    });

    it('one near death dies under the fire: the body stays in the cellar', () => {
        tune({ brk: 0 });
        const { world, people } = makeWorld();
        const player = makePlayer();
        const c = cellar(player, world, 2);
        const h = Interrogation.held(player, world)[0];
        Interrogation.subject(player, h, world).hp = 10;
        expect(Interrogation.deathChance(player, world, h, 'fire')).toBe(1);
        const r = Interrogation.question(player, world, h.key, 'fire');
        expect(r.died).toBe(true);
        expect(people[2].died).not.toBeNull();
        expect(c.dead).toBe(world.day);
        expect(Interrogation.held(player, world)).toHaveLength(0);
    });

    it('a rival House\'s child put to the irons: the feud runs hotter, and the House remembers', () => {
        tune({ brk: 0 });
        const { world } = makeWorld();
        const player = makePlayer();
        const r0 = rival({ feud: 30 });
        const kid = { firstName: 'Edda', gender: 'female', age: 17, uid: 'rc:thorne:Edda:17' };
        r0.head.children.push(kid);
        player.house.rivals[2] = r0;
        player.maiming = { v: 1, history: [], stats: { total: 0, byAct: {}, suffered: 0 }, enemyDays: {}, captives: [{ id: 1, rivalId: 2, uid: kid.uid, name: 'Edda Thorne', gender: 'female', day: 1990, how: 'the road', person: kid }], nextCaptive: 2 };
        const h = Interrogation.held(player, world)[0];
        Interrogation.question(player, world, h.key, 'irons');
        expect(r0.feud).toBeGreaterThan(30);
        expect(r0.memory.some(m => m.kind === 'tortured' && m.w < 0)).toBe(true);
    });
});

describe('Interrogation — the AI', () => {
    it('a rival House with a hot feud puts your hostage child to the question', () => {
        const d = JSON.parse(JSON.stringify(saved));
        d.ai.weekly = 1;
        d.ai.markChance = 0;
        DataLoader._gamedata.interrogation = d;
        const { world } = makeWorld();
        const player = makePlayer();
        player.house.rivals[2] = rival({ feud: 95 });
        const child = { id: 'c1', firstName: 'Wynn', gender: 'male', age: 12, isAlive: true, health: 100, maxHealth: 100, upbringing: { heldBy: { rival: true, kingdomId: 2 } } };
        player.children.push(child);
        const out = Interrogation.processDay(world, player);
        expect(out.notices).toHaveLength(1);
        expect(out.notices[0].title).toMatch(/Wynn/);
        expect(child.health).toBeLessThan(100);
        // not again for a long while
        world.day += 7;
        expect(Interrogation.processDay(world, player).notices).toHaveLength(0);
    });

    it('does nothing with no player (the interregnum), and is classified for the wait', () => {
        const { world } = makeWorld();
        expect(Interrogation.processDay(world, null).notices).toHaveLength(0);
        expect(Afterlife.worldDaySkipped().Interrogation).toBeTruthy();
    });
});

describe('Interrogation — determinism and saving', () => {
    it('the same prisoner, the same day, the same answer (hash rolls; the shared RNG untouched)', () => {
        const run = () => {
            const { world } = makeWorld({ torture: 'free' });
            const player = makePlayer();
            player.house.rivals[2] = rival();
            cellar(player, world, 1);
            const h = Interrogation.held(player, world)[0];
            const out = [];
            for (let i = 0; i < 6; i++) { world.day++; out.push(Interrogation.question(player, world, h.key, 'irons').text); }
            return out;
        };
        Utils.setSeed(1);
        const before = Utils.random();
        Utils.setSeed(1);
        const a = run();
        expect(Utils.random()).toBe(before);
        expect(run()).toEqual(a);
    });

    it('is saved with the player', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('interrogation');
    });
});
