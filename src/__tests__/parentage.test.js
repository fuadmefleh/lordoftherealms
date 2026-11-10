// Born to a Family and the people every life begins among (player/parentage.js):
// the parents picker lists real couples of the world (varied, deterministic,
// no draws on the shared RNG), the born start makes the player their child at
// home (parents and siblings linked to the town's roster, a purse by station,
// a royal claim by birth order), the parents' rules bite (flagged and refused
// actions, curfew, the leash, duties, escalation to grounding), trust lifts
// rules, asking leave works, coming of age ends it, every origin starts with
// people (and the landed ones with a court), and it all survives a save.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Parentage } from '../player/parentage.js';
import { Scenarios } from '../player/scenarios.js';
import { PlayerActions } from '../player/actions/index.js';
import { Relationships } from '../systems/relationships.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Throne } from '../systems/throne.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { Court } from '../systems/court.js';

beforeAll(async () => {
    await loadData();
});

function born(seed, parents = 'farmer', age = 14) {
    const g = newGame(seed);
    const report = Scenarios.apply(g.player, g.world, { origin: 'born', parents, birthAge: age });
    return { ...g, report };
}

const npc = id => Relationships._npcs.find(n => n.id === id);

/** A passable hex next to home that is not home. */
function nextDoor(g) {
    const pa = g.player.parentage;
    for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
        const t = g.world.getTile(pa.home.q + dq, pa.home.r + dr);
        if (t && t.terrain && t.terrain.passable !== false && !t.settlement) return { q: t.q != null ? t.q : pa.home.q + dq, r: t.r != null ? t.r : pa.home.r + dr };
    }
    return { q: pa.home.q + 1, r: pa.home.r };
}

describe('the parents picker', () => {
    it('lists real couples across walks of life, the same for the same world, without touching the shared RNG', () => {
        const a = newGame(61);
        const before = Utils.random();
        const b = newGame(61);
        const list = Parentage.couples(b.world);
        expect(Utils.random()).toBe(before);
        const stations = new Set(list.map(c => c.station));
        expect(stations.size).toBeGreaterThanOrEqual(6);
        expect(stations.has('farmer')).toBe(true);
        // Every couple is a man and a woman of a real roster (or a royal pair)
        for (const c of list) {
            if (c.royal) continue;
            const folk = b.world.getTile(c.q, c.r).settlement.folk;
            expect(Townsfolk.get(folk, c.father.id).gender).toBe('male');
            expect(Townsfolk.get(folk, c.mother.id).gender).toBe('female');
        }
        // No one is a parent in two couples
        const people = list.filter(c => !c.royal).flatMap(c => [`${c.q},${c.r}#${c.father.id}`, `${c.q},${c.r}#${c.mother.id}`]);
        expect(new Set(people).size).toBe(people.length);
        const again = Parentage.couples(a.world);
        expect(again.map(c => c.key)).toEqual(list.map(c => c.key));
        expect(Parentage.randomCouple(a.world).key).toBe(Parentage.randomCouple(b.world).key);
        // A station asked for gives several of it
        expect(Parentage.couples(b.world, { station: 'farmer' }).every(c => c.station === 'farmer')).toBe(true);
    }, 120000);
});

describe('born to a family', () => {
    it('makes the player the couple\'s child at home: parents and siblings linked, the family name, a child\'s purse', () => {
        const g = born(62, 'farmer');
        const p = g.player;
        const pa = p.parentage;
        expect(pa.active).toBe(true);
        expect(pa.station).toBe('farmer');
        expect(p.age).toBe(14);
        expect(p.q).toBe(pa.home.q);
        expect(p.r).toBe(pa.home.r);
        expect(p.gold).toBe(6);
        const f = npc(pa.father);
        const m = npc(pa.mother);
        expect(f.kin).toBe('father');
        expect(m.kin).toBe('mother');
        expect(p.relationships[f.id].family).toBe('father');
        expect(p.relationships[m.id].score).toBeGreaterThan(40);
        // Linked to the roster, and wed there
        const ff = Relationships.folkPerson(g.world, f.folkUid);
        const mf = Relationships.folkPerson(g.world, m.folkUid);
        expect(ff.p.spouse).toBe(mf.p.id);
        expect(p.lastName).toBe(ff.p.last);
        expect(p.house.name).toBe(`House ${ff.p.last}`);
        expect(p.title).toMatch(/^(Son|Daughter|Child) of /);
        const sibs = Parentage.kin(p, g.world).filter(k => k.role === 'brother' || k.role === 'sister');
        expect(sibs.length).toBeGreaterThanOrEqual(1);
        for (const s of sibs) {
            const sp = Relationships.folkPerson(g.world, npc(s.id).folkUid).p;
            expect(sp.parents).toContain(ff.p.id);
            expect(sp.parents).toContain(mf.p.id);
        }
        // The household keeps savings on the roster (real coin, from the town)
        expect(Parentage.savings(g.world, p)).toBeGreaterThan(0);
        expect(g.report.welcome).toContain(p.name);
        expect(g.report.welcome).not.toMatch(/\{\w+\}/);
        // Friends of an age, from the town
        expect(p.ties.friends.length).toBeGreaterThanOrEqual(1);
    }, 120000);

    it('a merchant\'s child has more pocket money than a labourer\'s', () => {
        const a = born(63, 'merchant');
        const b = born(63, 'labourer');
        expect(a.player.gold).toBeGreaterThan(b.player.gold);
    }, 120000);

    it('a royal child is a prince or princess with a blood claim placed by birth order', () => {
        let g = null;
        for (const seed of [64, 65, 66, 67, 68]) {
            const t = newGame(seed);
            const c = Parentage.couples(t.world, { station: 'royal' })[0];
            if (!c) continue;
            const res = Parentage.bornTo(t.player, t.world, c);
            expect(res.success).toBe(true);
            g = { ...t, c };
            break;
        }
        expect(g).not.toBeNull();
        const p = g.player;
        expect(p.title).toMatch(/^(Prince|Princess) of /);
        const kid = p.parentage.royal.kid;
        const claim = Throne.claimStrength(p, kid);
        const st = Parentage.station('royal');
        expect(claim).toBe(Math.max(st.claimMin, st.claim - (g.c.line - 1) * st.claimPerElder));
        expect(Throne.claims(p, g.world)[0].sources.map(s => s.id)).toContain('blood');
        expect(npc(p.parentage.father).charId).toBeDefined();
        expect(p.q).toBe(g.c.q);
    }, 200000);

    it('"choose" waits for the picker; left unchosen, fate chooses at the end of the day', () => {
        const g = newGame(69);
        const r = Scenarios.apply(g.player, g.world, { origin: 'born', parents: 'choose' });
        expect(g.player.parentage.pending).toBe(true);
        expect(r.welcome).toMatch(/Choose your parents/);
        const acts = PlayerActions.getAvailableActions(g.player, g.world.getTile(g.player.q, g.player.r), g.world);
        expect(acts[0].type).toBe('your_parents');
        Parentage.processDay(g.player, g.world);
        expect(g.player.parentage.pending).toBe(false);
        expect(g.player.parentage.active).toBe(true);
        expect(npc(g.player.parentage.father)).toBeDefined();
    }, 120000);
});

describe('the parents\' rules bite', () => {
    it('flags a forbidden tavern, and a defiance found out costs regard, trust and a strike', () => {
        const g = born(70, 'smith');
        const p = g.player;
        const pa = p.parentage;
        const tile = g.world.getTile(p.q, p.r);
        const acts = PlayerActions.getAvailableActions(p, tile, g.world);
        const tav = acts.find(a => a.type === 'tavern');
        if (tav) expect(tav.description).toMatch(/forbid/);
        expect(Parentage.check(p, g.world, 'tavern')).toMatchObject({ defy: true, rule: 'tavern' });
        const trust = pa.trust;
        const regard = Parentage.regard(p);
        const res = Parentage.onAction(p, g.world, 'tavern', { roll: 0 });
        expect(res.caught).toBe(true);
        expect(pa.trust).toBeLessThan(trust);
        expect(Parentage.regard(p)).toBeLessThan(regard);
        expect(pa.strikes.length).toBe(1);
        // Away from home, unseen, it costs nothing (but they are not told)
        const home = { q: p.q, r: p.r };
        const near = nextDoor(g);
        p.q = near.q; p.r = near.r;
        const res2 = Parentage.onAction(p, g.world, 'gambling', { roll: 0.99 });
        expect(res2.caught).toBe(false);
        expect(pa.strikes.length).toBe(1);
        p.q = home.q; p.r = home.r;
        // A second strike grounds: outings refused, travel refused
        Parentage.onAction(p, g.world, 'gambling', { roll: 0 });
        expect(Parentage.grounded(p, g.world)).toBe(true);
        expect(Parentage.check(p, g.world, 'meet_people')).toMatchObject({ refused: true });
        const acts2 = PlayerActions.getAvailableActions(p, tile, g.world);
        for (const a of acts2.filter(x => x.type === 'tavern' || x.type === 'meet_people')) expect(a.disabled).toBe(true);
        const away = nextDoor(g);
        expect(Parentage.travelCheck(p, g.world, away.q, away.r)).toMatchObject({ refused: true });
        expect(Parentage.travelCheck(p, g.world, pa.home.q, pa.home.r)).toBeNull();
    }, 120000);

    it('the curfew: a night away is a breach; a night at home earns trust', () => {
        const g = born(71, 'farmer');
        const p = g.player;
        const pa = p.parentage;
        g.world.day += 1;
        const t0 = pa.trust;
        Parentage.processDay(p, g.world);
        expect(pa.trust).toBeGreaterThan(t0);
        const away = nextDoor(g);
        p.q = away.q; p.r = away.r;
        g.world.day += 1;
        const out = Parentage.processDay(p, g.world);
        expect(out.notices.some(n => /nightfall/.test(n.text))).toBe(true);
        expect(pa.strikes.some(s => s.rule === 'curfew')).toBe(true);
    }, 120000);

    it('the leash: far beyond it without leave is a breach; leave to travel lifts it', () => {
        const g = born(72, 'farmer');
        const p = g.player;
        const pa = p.parentage;
        pa.trust = 80; // the curfew lifted: only the leash is left to break
        const far = g.world.getSettlementViews().map(v => ({ q: v.q, r: v.r }))
            .find(t => Hex.wrappingDistance(t.q, t.r, pa.home.q, pa.home.r, g.world.width) > Parentage.roamRadius(p, g.world) + 2);
        expect(far).toBeDefined();
        expect(Parentage.travelCheck(p, g.world, far.q, far.r)).toMatchObject({ warn: true });
        p.q = far.q; p.r = far.r;
        g.world.day += 1;
        Parentage.processDay(p, g.world);
        expect(pa.strikes.some(s => s.rule === 'roam')).toBe(true);
        // Asked and granted: on leave the leash is long
        pa.strikes = [];
        pa.steps = {};
        pa.grounded = null;
        pa.asked = {};
        p.q = pa.home.q; p.r = pa.home.r;
        const ask = Parentage.ask(p, g.world, 'travel', { roll: 0 });
        expect(ask.granted).toBe(true);
        expect(Parentage.roamRadius(p, g.world)).toBe(Parentage.data().permissions.travel.radius);
    }, 120000);

    it('duties: undone they are a breach; done they train, pay the household and earn trust', () => {
        const g = born(73, 'farmer');
        const p = g.player;
        const pa = p.parentage;
        const hh = Parentage._household(g.world, pa);
        const purse0 = hh.payee.purse;
        p.actionPoints = 10;
        const t0 = pa.trust;
        const res = Parentage.doDuty(p, g.world, 'chore');
        expect(res.success).toBe(true);
        expect(p.actionPoints).toBe(6);
        expect(pa.trust).toBeGreaterThan(t0);
        expect(hh.payee.purse).toBeGreaterThanOrEqual(purse0);
        expect(Parentage.doDuty(p, g.world, 'chore').success).toBe(false); // once a day
        // Four days without a hand's turn
        g.world.day += 4;
        Parentage.processDay(p, g.world);
        expect(pa.strikes.some(s => s.rule === 'chores')).toBe(true);
    }, 120000);

    it('the allowance comes out of the household\'s own savings', () => {
        const g = born(74, 'merchant');
        const p = g.player;
        const before = Parentage.savings(g.world, p);
        const gold = p.gold;
        g.world.day += 7;
        Parentage.processDay(p, g.world);
        const st = Parentage.station('merchant');
        expect(p.gold).toBe(gold + st.allowance);
        // (the household's week of wages and spending moves its purse too; the allowance is out of it)
        expect(Parentage.savings(g.world, p)).toBeLessThan(before + st.wage * 7);
    }, 120000);

    it('escalates to being sent away or disowned when strikes pile up', () => {
        const g = born(75, 'guard');
        const p = g.player;
        const pa = p.parentage;
        // (once grounded, forbidden things are refused outright: the strikes come from nights out and duties)
        Parentage.onAction(p, g.world, 'pickpocket', { roll: 0 });
        expect(Parentage.grounded(p, g.world)).toBe(true);
        expect(Parentage.onAction(p, g.world, 'pickpocket', { roll: 0 })).toMatchObject({ refused: true });
        for (let i = 0; i < 6 && pa.active; i++) Parentage._breach(p, g.world, 'crime', { notices: [] });
        expect(pa.sentTo || pa.disinherited || !pa.active).toBeTruthy();
        expect(pa.cut).not.toBeNull();
    }, 120000);
});

describe('trust, leave and the end of it', () => {
    it('trust lifts the curfew and the tavern ban and lengthens the leash', () => {
        const g = born(76, 'farmer');
        const p = g.player;
        const pa = p.parentage;
        const r0 = Parentage.roamRadius(p, g.world);
        expect(Parentage.ruleActive(p, 'curfew')).toBe(true);
        pa.trust = 80;
        expect(Parentage.ruleActive(p, 'curfew')).toBe(false);
        expect(Parentage.ruleActive(p, 'tavern')).toBe(false);
        expect(Parentage.check(p, g.world, 'tavern')).toBeNull();
        expect(Parentage.ruleActive(p, 'crime')).toBe(true);
        expect(Parentage.roamRadius(p, g.world)).toBeGreaterThan(r0);
    }, 120000);

    it('their blessing to court lifts the marriage rule; asking too soon after is refused', () => {
        const g = born(77, 'farmer', 15);
        const p = g.player;
        expect(Parentage.ruleActive(p, 'marry')).toBe(true);
        const res = Parentage.ask(p, g.world, 'court', { roll: 0 });
        expect(res.granted).toBe(true);
        expect(Parentage.ruleActive(p, 'marry')).toBe(false);
        expect(Parentage.ask(p, g.world, 'court').success).toBe(false);
    }, 120000);

    it('coming of age ends their rule, with a parting gift if they are fond of you', () => {
        const g = born(78, 'merchant');
        const p = g.player;
        const gold = p.gold;
        p.age = Parentage.data().comeOfAge;
        g.world.day += 1;
        const out = Parentage.processDay(p, g.world);
        expect(p.parentage.active).toBe(false);
        expect(p.parentage.ended.how).toBe('age');
        expect(p.gold).toBeGreaterThan(gold);
        expect(out.notices.some(n => n.title === 'Of Age')).toBe(true);
        expect(Parentage.check(p, g.world, 'tavern')).toBeNull();
    }, 120000);

    it('running away frees you and disowns you', () => {
        const g = born(79, 'farmer');
        const res = Parentage.runAway(g.player, g.world);
        expect(res.success).toBe(true);
        expect(g.player.parentage.active).toBe(false);
        expect(g.player.parentage.disinherited).toBe(true);
        expect(Parentage.regard(g.player)).toBeLessThan(30);
    }, 120000);
});

describe('nobody starts alone', () => {
    it('every origin begins with people, and the landed ones with a court', () => {
        const ids = Object.keys(Scenarios.origins()).filter(id => id !== 'born');
        expect(ids.length).toBeGreaterThanOrEqual(10);
        const T = Parentage.data().ties.origins;
        for (const id of ids) {
            const g = newGame(80);
            Scenarios.apply(g.player, g.world, { origin: id });
            const known = Object.keys(g.player.relationships || {});
            expect(known.length, `${id} knows someone`).toBeGreaterThan(0);
            expect(g.player.ties.origin).toBe(id);
            const spec = { ...T._default, ...(T[id] || {}) };
            if (spec.court > 0) expect((g.player.house.court || []).length, `${id} has a court`).toBeGreaterThan(0);
            expect((g.player.house.court || []).length, `${id} court within its seats`).toBeLessThanOrEqual(Court.capacity(g.player));
            if (spec.parents > 0) expect(g.player.ties.family.length, `${id} has family`).toBeGreaterThan(0);
        }
    }, 600000);
});

describe('save and load', () => {
    it('round-trips the parents\' rule and the family', () => {
        const g = born(81, 'farmer');
        const p = g.player;
        Parentage.onAction(p, g.world, 'tavern', { roll: 0 });
        Relationships.prepareForSave(p);
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.parentage).toEqual(JSON.parse(JSON.stringify(p.parentage)));
        expect(back.ties).toEqual(JSON.parse(JSON.stringify(p.ties)));
        Relationships.initialize(back);
        expect(Parentage.kin(back, g.world).length).toBe(Parentage.kin(p, g.world).length);
        expect(Parentage.regard(back)).toBe(Parentage.regard(p));
    }, 120000);
});
