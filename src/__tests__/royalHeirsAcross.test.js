// Royal heirs across two realms (world/characters: Characters._heirPartner,
// _birthsHere, _lineOf, handleSuccession; systems/realmUnions.js _crownAbroad,
// _flip): married rulers of two realms have children, born at one court; the
// child is of both lines, so a union can pass to a shared child; the ruler's
// shown name keeps to the royal record; no royal match of one sex.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Characters } from '../world/characters.js';
import { WorldEvents } from '../world/worldEvents.js';
import { RealmUnions } from '../systems/realmUnions.js';
import { CrownMatches } from '../systems/betrothals.js';
import { Utils } from '../core/utils.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => logSpy && logSpy.mockRestore());

const tiles = n => Array.from({ length: n }, (_, i) => ({ q: i, r: 0 }));

function royal(id, firstName, gender, extra = {}) {
    const c = Characters.generateCharacter({ culture: 'Imperial', gender, age: 30, dynasty: extra.dynasty || 'Test', isRuler: true });
    return Object.assign(c, { id, firstName, maxLifespan: 90 }, extra);
}

function makeWorld({ wed = true } = {}) {
    const k = (id, name, ruler, land, mil) => {
        const kd = {
            id, name, isAlive: true, wars: [], allies: [], relations: {}, truces: {}, culture: 'Imperial',
            military: mil, population: 2000, territory: tiles(land), treasury: 4000, stability: 60, laws: { crownAbroad: 'blood' },
            capital: { q: 0, r: 0 },
            characterData: { ruler, spouse: null, children: [], advisors: {}, dynasty: { name: ruler.dynasty, members: [ruler.id], bloodline: [ruler.id], prestige: 10 } },
            lord: { name: '', kingdomId: id, age: 30, traits: [], honor: 6, martial: 5, diplomacy: 5, stewardship: 5, relationships: {}, goals: [] },
        };
        ruler.kingdomId = id;
        Characters.syncRulerName(kd);
        return kd;
    };
    const ca = royal('ca', 'Aldric', 'male', { dynasty: 'Arven' });
    const cb = royal('cb', 'Brena', 'female', { dynasty: 'Belm' });
    if (wed) { ca.spouseId = 'cb'; cb.spouseId = 'ca'; }
    const world = {
        day: 60, width: 40, height: 30, units: [], events: [], generationParams: { seed: 5150 },
        kingdoms: [k('k1', 'Kingdom of Arvenland', ca, 40, 900), k('k2', 'Belmarch', cb, 12, 300), k('k3', 'Corvath', royal('cc', 'Cedric', 'male'), 20, 500)],
    };
    world.getKingdom = id => world.kingdoms.find(x => x.id === id) || null;
    world.getTile = () => null;
    return world;
}

const K = (world, id) => world.getKingdom(id);
const R = (world, id) => K(world, id).characterData.ruler;

describe('royal births across two realms', () => {
    it('two reigning spouses in union: their children are rolled at the senior court only', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        expect(K(world, 'k1').personalUnion.role).toBe('senior');
        const atSenior = Characters._heirPartner(world, K(world, 'k1'));
        expect(atSenior.partner.id).toBe('cb');
        expect(atSenior.abroad).toBe(K(world, 'k2'));
        expect(Characters._heirPartner(world, K(world, 'k2'))).toBe(null);
    });

    it('two reigning spouses apart: at the father\'s court', () => {
        const world = makeWorld();
        K(world, 'k2').laws.crownAbroad = 'native';
        RealmUnions.processDay(world, null);
        expect(K(world, 'k1').personalUnion).toBeUndefined();
        expect(Characters._heirPartner(world, K(world, 'k1')).partner.id).toBe('cb');
        expect(Characters._heirPartner(world, K(world, 'k2'))).toBe(null);
    });

    it('the monthly roll makes a child of both lines, at the same rate as a couple at one court', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const k1 = K(world, 'k1');
        world.day = 90; // (a month's turn; not a year's, so no one ages)
        const rnd = vi.spyOn(Utils, 'random').mockReturnValue(0.06); // (under the 0.08 chance; over the 5% court event)
        try {
            Characters.processKingdomCharacters(k1, world);
        } finally { rnd.mockRestore(); }
        const child = k1.characterData.children[0];
        expect(child).toBeTruthy();
        expect(child.parentId).toBe('ca');
        expect(child.parentId2).toBe('cb');
        expect(child.otherRealmId).toBe('k2');
        expect(R(world, 'k1').childrenIds).toContain(child.id);
        expect(R(world, 'k2').childrenIds).toContain(child.id);
        expect(K(world, 'k2').characterData.children.length).toBe(0);
        expect(world.events.some(e => /both crowns/.test(e.text))).toBe(true);
    });

    it('a ruler wed to a prince of another realm has the children at home', () => {
        const world = makeWorld({ wed: false });
        const prince = royal('pp', 'Piers', 'male', { isRuler: false, age: 28 });
        K(world, 'k3').characterData.children.push(prince);
        prince.spouseId = 'cb'; R(world, 'k2').spouseId = 'pp';
        const p = Characters._heirPartner(world, K(world, 'k2'));
        expect(p.partner).toBe(prince);
        expect(p.abroad).toBe(K(world, 'k3'));
    });
});

describe('a union passes to a shared child', () => {
    function withChild(world, age = 20) {
        const child = Characters._birthChild(K(world, 'k1'), R(world, 'k1'), R(world, 'k2'), world, K(world, 'k2'));
        child.age = age;
        return child;
    }

    it('the monarch dies first: they part; the consort dies: the crowns join again on the child', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const child = withChild(world);
        world.day += 1;
        Characters.handleSuccession(K(world, 'k1'), world);
        expect(R(world, 'k1')).toBe(child);
        let out = RealmUnions.processDay(world, null);
        expect(out.ended[0].how).toBe('parted');
        world.day += 1;
        Characters.handleSuccession(K(world, 'k2'), world);
        const ab = K(world, 'k2').lastSuccession.abroad;
        expect(ab.seatId).toBe('k1');
        expect(ab.heirId).toBe(child.id);
        const standIn = R(world, 'k2');
        expect(standIn.standIn.forId).toBe(child.id);
        out = RealmUnions.processDay(world, null);
        expect(out.formed.length).toBe(1);
        expect(K(world, 'k1').personalUnion.role).toBe('senior');
        expect(K(world, 'k2').personalUnion.resident).toMatchObject({ id: standIn.id, role: 'regent' });
        expect(K(world, 'k2').ruler).toBe(K(world, 'k1').ruler);
        expect(K(world, 'k1').ruler).toBe(Characters.getDisplayName(child, K(world, 'k1')));
        const h = RealmUnions.history(world);
        expect(h[h.length - 1].how).toBe('inheritance');
    });

    it('where the crown is native, the stand-in is crowned instead', () => {
        const world = makeWorld();
        K(world, 'k2').laws.crownAbroad = 'native'; // (no union by marriage either)
        RealmUnions.processDay(world, null);
        const child = withChild(world);
        world.day += 1;
        Characters.handleSuccession(K(world, 'k1'), world);
        world.day += 1;
        Characters.handleSuccession(K(world, 'k2'), world);
        expect(K(world, 'k2').lastSuccession.abroad.heirId).toBe(child.id);
        const out = RealmUnions.processDay(world, null);
        expect(out.formed.length).toBe(0);
        expect(R(world, 'k2').standIn).toBeUndefined();
        expect(K(world, 'k2').ruler).toBe(Characters.getDisplayName(R(world, 'k2'), K(world, 'k2')));
    });

    it('a younger child of the line holds the court for the heir abroad', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const elder = withChild(world, 24);
        const younger = withChild(world, 18);
        world.day += 1;
        Characters.handleSuccession(K(world, 'k1'), world); // (the elder reigns at k1)
        expect(R(world, 'k1')).toBe(elder);
        RealmUnions.processDay(world, null);
        world.day += 1;
        Characters.handleSuccession(K(world, 'k2'), world);
        expect(R(world, 'k2')).toBe(younger);
        expect(younger.kingdomId).toBe('k2');
        expect(K(world, 'k1').characterData.children).not.toContain(younger);
        RealmUnions.processDay(world, null);
        expect(K(world, 'k2').personalUnion.resident.id).toBe(younger.id);
    });

    it('the consort dies first: the child keeps her court; the monarch dies: the seat moves to the child\'s realm', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const child = withChild(world);
        world.day += 1;
        Characters.handleSuccession(K(world, 'k2'), world); // (the child comes to reign at k2)
        expect(R(world, 'k2')).toBe(child);
        let out = RealmUnions.processDay(world, null);
        expect(out.ended.length).toBe(0);
        expect(K(world, 'k2').personalUnion.resident.id).toBe(child.id);
        world.day += 1;
        Characters.handleSuccession(K(world, 'k1'), world);
        expect(K(world, 'k1').lastSuccession.abroad.seatId).toBe('k2');
        out = RealmUnions.processDay(world, null);
        expect(out.ended.length).toBe(0);
        expect(K(world, 'k2').personalUnion.role).toBe('senior');
        expect(K(world, 'k1').personalUnion.role).toBe('junior');
        expect(K(world, 'k1').personalUnion.resident.role).toBe('regent');
        expect(K(world, 'k2').ruler).toBe(Characters.getDisplayName(child, K(world, 'k2')));
        expect(K(world, 'k1').ruler).toBe(K(world, 'k2').ruler);
        // ...and the union keeps running
        world.day += 7 - (world.day % 7);
        expect(() => RealmUnions.processDay(world, null)).not.toThrow();
        expect(RealmUnions.together(K(world, 'k1'), K(world, 'k2'))).toBe(true);
    });
});

describe('the ruler shown keeps to the royal record', () => {
    it('a succession names the heir of the record, and the lord too', () => {
        const world = makeWorld({ wed: false });
        const k3 = K(world, 'k3');
        Characters.handleSuccession(k3, world);
        expect(k3.ruler).toBe(Characters.getDisplayName(k3.characterData.ruler, k3));
        expect(k3.lord.name).toBe(k3.ruler);
    });

    it('the court\'s "succession" news never makes up a ruler', () => {
        const world = makeWorld({ wed: false });
        const k3 = K(world, 'k3');
        const before = k3.ruler;
        const pick = vi.spyOn(Utils, 'randPick').mockImplementationOnce(() => 'succession').mockImplementationOnce(() => k3);
        let ev;
        try { ev = WorldEvents.generatePoliticalEvent(world); } finally { pick.mockRestore(); }
        expect(ev.text).toMatch(/heir/);
        expect(k3.ruler).toBe(before);
        expect(k3.ruler).toBe(Characters.getDisplayName(k3.characterData.ruler, k3));
    });

    it('a stray name is put right from the record on the court\'s day', () => {
        const world = makeWorld({ wed: false });
        const k3 = K(world, 'k3');
        k3.ruler = 'King Nobody';
        world.day = 61;
        const rnd = vi.spyOn(Utils, 'random').mockReturnValue(0.9);
        try { Characters.processKingdomCharacters(k3, world); } finally { rnd.mockRestore(); }
        expect(k3.ruler).toBe(Characters.getDisplayName(k3.characterData.ruler, k3));
    });

    it('a junior realm in union still reads its monarch', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        world.day = 61;
        const rnd = vi.spyOn(Utils, 'random').mockReturnValue(0.9);
        try { Characters.processKingdomCharacters(K(world, 'k2'), world); } finally { rnd.mockRestore(); }
        expect(K(world, 'k2').ruler).toBe(K(world, 'k1').ruler);
    });
});

describe('royal matches respect the world\'s marriage rule', () => {
    it('Characters.canWed: a man and a woman', () => {
        const m = royal('m', 'Mark', 'male');
        const f = royal('f', 'Fay', 'female');
        expect(Characters.canWed(m, f)).toBe(true);
        expect(Characters.canWed(m, royal('m2', 'Mort', 'male'))).toBe(false);
        expect(Characters.canWed(m, m)).toBe(false);
    });

    it('envoys never wed two kings', () => {
        const world = makeWorld({ wed: false });
        // (only men to wed on either side)
        expect(Characters.arrangeMarriage(K(world, 'k1'), K(world, 'k3'), world)).toBe(false);
        expect(R(world, 'k1').spouseId).toBe(null);
    });

    it('two kings recorded as wed make no union', () => {
        const world = makeWorld({ wed: false });
        R(world, 'k1').spouseId = 'cc'; R(world, 'k3').spouseId = 'ca';
        const out = RealmUnions.processDay(world, null);
        expect(out.formed.length).toBe(0);
    });

    it('the crowns promise no two princes to each other', () => {
        const world = makeWorld({ wed: false });
        for (const [kid, id] of [['k1', 'p1'], ['k3', 'p3']]) K(world, kid).characterData.children.push(royal(id, 'Prince', 'male', { isRuler: false, age: 8 }));
        for (const k of world.kingdoms) { k.allies = world.kingdoms.filter(o => o !== k).map(o => o.id); }
        for (let y = 1; y <= 40; y++) { world.day = y * 120; CrownMatches.processDay(world); }
        expect(K(world, 'k1').characterData.children[0].betrothedTo).toBeUndefined();
        expect(K(world, 'k1').characterData.children[0].spouseId).toBeFalsy();
    });
});

describe('save/load keeps the children of two realms', () => {
    it('the child, both parents\' lines and a stand-in survive a round trip', () => {
        let game = newGame(4242);
        const ks = game.world.kingdoms.filter(k => k.isAlive && k.characterData && k.characterData.ruler);
        const [a, b] = ks;
        const ra = a.characterData.ruler, rb = b.characterData.ruler;
        rb.gender = ra.gender === 'male' ? 'female' : 'male';
        ra.spouseId = rb.id; rb.spouseId = ra.id;
        a.characterData.spouse = null; b.characterData.spouse = null;
        const child = Characters._birthChild(a, ra, rb, game.world, b);
        child.age = 20;
        rb.standIn = { forId: child.id, seatId: a.id, day: game.world.day };
        b.lastSuccession = { day: game.world.day, type: 'heir', abroad: { heirId: child.id, seatId: a.id, heirName: 'x', settled: game.world.day } };
        const [aid, bid, cid] = [a.id, b.id, child.id];
        game = roundTrip(game);
        const a2 = game.world.kingdoms.find(k => k.id === aid);
        const b2 = game.world.kingdoms.find(k => k.id === bid);
        const c2 = a2.characterData.children.find(c => c.id === cid);
        expect(c2.otherRealmId).toBe(bid);
        expect(b2.characterData.ruler.childrenIds).toContain(cid);
        expect(b2.characterData.ruler.standIn.forId).toBe(cid);
        expect(b2.lastSuccession.abroad.seatId).toBe(aid);
        // (the line still finds the child across the two realms)
        expect(Characters._lineOf(game.world, b2, b2.characterData.ruler).map(f => f.char.id)).toContain(cid);
    });
});
