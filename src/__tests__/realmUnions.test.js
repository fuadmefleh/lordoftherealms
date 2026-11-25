// Personal unions between the AI realms (systems/realmUnions.js): formed when two
// reigning rulers are wed, one ruler and one foreign policy, broken at a
// succession the law or blood won't follow or by the junior lords' revolt,
// kept across a save.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RealmUnions } from '../systems/realmUnions.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomStability } from '../world/kingdomState.js';
import { HighCrowns } from '../systems/highCrowns.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => logSpy && logSpy.mockRestore());

const lord = (name, kid) => ({ name, kingdomId: kid, age: 50, traits: [], honor: 6, martial: 5, diplomacy: 5, stewardship: 5, relationships: {}, goals: [] });
const royal = (id, firstName, gender, extra = {}) => ({ id, firstName, dynasty: 'Test', gender, age: 30, isAlive: true, isRuler: true, culture: 'Imperial', traits: [], childrenIds: [], ...extra });
const tiles = n => Array.from({ length: n }, (_, i) => ({ q: i, r: 0 }));

function makeWorld(day = 70) {
    const k = (id, name, rulerChar, land, mil, extra = {}) => ({
        id, name, ruler: `King ${rulerChar.firstName}`, isAlive: true, wars: [], allies: [], relations: {}, truces: {}, culture: 'Imperial',
        military: mil, population: 2000, territory: tiles(land), treasury: 4000, stability: 60, laws: { crownAbroad: 'blood' },
        capital: { q: 0, r: 0 }, characterData: { ruler: rulerChar, children: [], dynasty: { name: 'Test', members: [], bloodline: [] } },
        lord: lord(`King ${rulerChar.firstName}`, id), ...extra,
    });
    const ca = royal('ca', 'Aldric', 'male', { spouseId: 'cb' });
    const cb = royal('cb', 'Brena', 'female', { spouseId: 'ca' });
    const world = {
        day, width: 40, height: 30, units: [], events: [], generationParams: { seed: 5150 },
        kingdoms: [
            k('k1', 'Kingdom of Arvenland', ca, 40, 900),
            k('k2', 'Belmarch', cb, 12, 300),
            k('k3', 'Corvath', royal('cc', 'Cedric', 'male'), 20, 500),
            k('k4', 'Dunmere', royal('cd', 'Dagny', 'female'), 15, 400),
        ],
    };
    world.kingdoms[1].ruler = 'Queen Brena';
    world.getKingdom = id => world.kingdoms.find(x => x.id === id) || null;
    return world;
}

const K = (world, id) => world.getKingdom(id);

describe('realm unions — forming', () => {
    it('two reigning rulers wed: one ruler for both, allied, never at war', () => {
        const world = makeWorld();
        world.kingdoms[0].wars = ['k2']; world.kingdoms[1].wars = ['k1'];
        const out = RealmUnions.processDay(world, null);
        const [a, b] = [K(world, 'k1'), K(world, 'k2')];
        expect(out.formed.length).toBe(1);
        expect(a.personalUnion.role).toBe('senior');
        expect(b.personalUnion.role).toBe('junior');
        expect(b.personalUnion.resident.role).toBe('consort');
        // One ruler: the junior reads the monarch's name
        expect(b.ruler).toBe(a.ruler);
        expect(a.wars).not.toContain('k2');
        expect(a.allies).toContain('k2');
        expect(b.allies).toContain('k1');
        expect(KingdomAI.mayOpenWar(a, b, { ...world, day: world.day + 5000 }, { founding: false, rested: false, beset: false })).toBe(false);
        expect(out.notices.some(n => /One Head/.test(n.title))).toBe(true);
        const d = RealmUnions.describe(world, b);
        expect(d.role).toBe('junior');
        expect(d.partnerName).toBe(a.name);
        expect(RealmUnions.history(world)[0].to).toBe(null);
        // Its own laws and treasury still
        expect(b.treasury).toBe(4000);
    });

    it('a native crown refuses: allied spouses reign apart', () => {
        const world = makeWorld();
        K(world, 'k2').laws.crownAbroad = 'native';
        const out = RealmUnions.processDay(world, null);
        expect(out.formed.length).toBe(0);
        expect(K(world, 'k2').personalUnion).toBeUndefined();
        expect(K(world, 'k2').ruler).toBe('Queen Brena');
        // ...and is not asked again
        world.events = [];
        RealmUnions.processDay(world, null);
        expect(world.events.length).toBe(0);
    });

    it('no union with a realm the player rules, nor between rulers not wed to each other', () => {
        const world = makeWorld();
        K(world, 'k1').crown = { playerRuled: true };
        expect(RealmUnions.processDay(world, null).formed.length).toBe(0);
        const w2 = makeWorld();
        K(w2, 'k2').characterData.ruler.spouseId = 'someone';
        expect(RealmUnions.processDay(w2, null).formed.length).toBe(0);
    });
});

describe('realm unions — one foreign policy', () => {
    it('the junior joins the monarch\'s war, declares none of its own, and makes his peace', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const [a, b, c] = [K(world, 'k1'), K(world, 'k2'), K(world, 'k3')];
        KingdomAI.startWar(a, c, world);
        world.day += 1;
        RealmUnions.processDay(world, null);
        expect(b.wars).toContain('k3');
        expect(c.wars).toContain('k2');
        // (the junior's own war council stays silent)
        b.relations.k4 = -100;
        const before = b.wars.length;
        for (let i = 0; i < 20; i++) KingdomAI.considerWar(b, { ...world, day: 5000 });
        expect(b.wars.length).toBe(before);
        // The monarch makes peace: so does the junior
        KingdomAI.endWar(a, c, world);
        world.day += 1;
        RealmUnions.processDay(world, null);
        expect(b.wars).not.toContain('k3');
    });

    it('the monarch comes to the junior\'s defence; the two hosts are weighed as one', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const [a, b, d] = [K(world, 'k1'), K(world, 'k2'), K(world, 'k4')];
        KingdomAI.startWar(d, b, world);
        world.day += 1;
        RealmUnions.processDay(world, null);
        expect(a.wars).toContain('k4');
        expect(KingdomAI.unionMight(b, world)).toBeCloseTo(KingdomAI.unionMight(a, world));
        expect(KingdomAI.unionMight(b, world)).toBeGreaterThan(300 + 200);
    });

    it('the junior\'s lords chafe: temper grows, stability suffers, its crown is not offered to the player', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const b = K(world, 'k2');
        K(world, 'k1').culture = 'Nomadic';
        b.personalUnion.resident.role = 'regent';
        const t0 = b.personalUnion.temper;
        for (let w = 1; w <= 20; w++) { world.day = 70 + w * 7; RealmUnions.processDay(world, null); }
        expect(b.personalUnion.temper).toBeGreaterThan(t0);
        expect(b.personalUnion.stab).toBeLessThan(0);
        const parts = KingdomStability.target(b, world).parts.map(p => p.label);
        expect(parts.some(l => /personal union/.test(l))).toBe(true);
        expect(b.relations.k1).toBeLessThan(90);
        // (HighCrowns' council offer skips it)
        expect(RealmUnions.partnerOf(world, b)).toBe(K(world, 'k1'));
        expect(typeof HighCrowns.processDay).toBe('function');
    });
});

describe('realm unions — breaking', () => {
    it('the monarch dies while the consort lives: her crown stays hers', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const [a, b] = [K(world, 'k1'), K(world, 'k2')];
        world.day += 30;
        a.characterData.ruler = royal('ce', 'Edwin', 'male');
        a.ruler = 'King Edwin';
        a.lastSuccession = { day: world.day, type: 'heir', crisis: false, heirName: 'Edwin', oldRulerName: 'King Aldric' };
        const out = RealmUnions.processDay(world, null);
        expect(out.ended[0].how).toBe('parted');
        expect(a.personalUnion).toBeUndefined();
        expect(b.personalUnion).toBeUndefined();
        expect(b.ruler).toMatch(/Brena/);
        expect(RealmUnions.history(world)[0].end).toBe('parted');
        // Friends still, but free to quarrel one day
        expect(b.allies).toContain('k1');
    });

    it('the consort dies first: by the blood the union holds under a regent; then the heir of the blood inherits both', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const [a, b] = [K(world, 'k1'), K(world, 'k2')];
        world.day += 30;
        const heir = royal('cf', 'Faramund', 'male', { parentId: 'ca' }); // a child of the monarch
        b.characterData.ruler = heir;
        b.ruler = 'King Faramund';
        b.lastSuccession = { day: world.day, type: 'heir', crisis: false, heirName: 'Faramund', oldRulerName: 'Queen Brena' };
        RealmUnions.processDay(world, null);
        expect(b.personalUnion).toBeDefined();
        expect(b.personalUnion.resident.role).toBe('regent');
        expect(b.ruler).toBe(a.ruler);
        // The monarch dies, his heir of the blood takes the senior throne: the junior follows
        world.day += 30;
        a.characterData.ruler = royal('cg', 'Gerold', 'male', { parentId: 'ca' });
        a.ruler = 'King Gerold';
        a.lastSuccession = { day: world.day, type: 'heir', crisis: false, heirName: 'Gerold', oldRulerName: 'King Aldric' };
        RealmUnions.processDay(world, null);
        expect(b.personalUnion).toBeDefined();
        expect(b.ruler).toBe('King Gerold');
        // ...but a stranger to the blood on the senior throne ends it
        world.day += 30;
        a.characterData.ruler = royal('ch', 'Hugo', 'male');
        a.ruler = 'King Hugo';
        a.lastSuccession = { day: world.day, type: 'distant_relative', crisis: true, heirName: 'Hugo', oldRulerName: 'King Gerold' };
        const out = RealmUnions.processDay(world, null);
        expect(out.ended[0].how).toBe('stranger');
        expect(b.ruler).toMatch(/Faramund/);
    });

    it('a native heir of the junior line takes his own crown', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const b = K(world, 'k2');
        world.day += 30;
        b.characterData.ruler = royal('ci', 'Ivo', 'male', { parentId: 'cb' });
        b.lastSuccession = { day: world.day, type: 'heir', crisis: false, heirName: 'Ivo', oldRulerName: 'Queen Brena' };
        const out = RealmUnions.processDay(world, null);
        expect(out.ended[0].how).toBe('native');
        expect(b.ruler).toMatch(/Ivo/);
    });

    it('the lords rise against an absent king', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        const [a, b] = [K(world, 'k1'), K(world, 'k2')];
        let ended = null;
        for (let w = 1; w <= 400 && !ended; w++) {
            world.day = 70 + w * 7;
            b.personalUnion.temper = 100;
            const out = RealmUnions.processDay(world, null);
            if (out.ended.length) ended = out.ended[0];
        }
        expect(ended && ended.how).toBe('revolt');
        expect(b.personalUnion).toBeUndefined();
        expect(b.allies).not.toContain('k1');
        expect(b.relations.k1).toBeLessThanOrEqual(-40);
        expect(b.ruler).toMatch(/Brena/);
        void a;
    });

    it('the player taking either throne ends it', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        K(world, 'k2').crown = { playerRuled: true };
        world.day += 1;
        const out = RealmUnions.processDay(world, null);
        expect(out.ended[0].how).toBe('player');
        expect(K(world, 'k1').personalUnion).toBeUndefined();
    });

    it('a fallen realm ends it', () => {
        const world = makeWorld();
        RealmUnions.processDay(world, null);
        K(world, 'k1').isAlive = false;
        world.day += 1;
        const out = RealmUnions.processDay(world, null);
        expect(out.ended[0].how).toBe('fallen');
        expect(K(world, 'k2').personalUnion).toBeUndefined();
    });
});

describe('realm unions — save/load', () => {
    it('the union, its record and the monarch\'s name survive a round trip', () => {
        let game = newGame(4242);
        const ks = game.world.kingdoms.filter(k => k.isAlive && k.characterData && k.characterData.ruler);
        const [a, b] = ks;
        a.characterData.ruler.spouseId = b.characterData.ruler.id;
        b.characterData.ruler.spouseId = a.characterData.ruler.id;
        a.laws = { ...(a.laws || {}), crownAbroad: 'blood' };
        b.laws = { ...(b.laws || {}), crownAbroad: 'blood' };
        const out = RealmUnions.processDay(game.world, game.player);
        expect(out.formed.length).toBe(1);
        const junior = [a, b].find(k => k.personalUnion.role === 'junior');
        junior.personalUnion.temper = 33;
        const jid = junior.id;
        const ruler = junior.ruler;
        game = roundTrip(game);
        const j2 = game.world.kingdoms.find(k => k.id === jid);
        expect(j2.personalUnion.role).toBe('junior');
        expect(j2.personalUnion.temper).toBe(33);
        expect(j2.ruler).toBe(ruler);
        expect(RealmUnions.history(game.world).length).toBe(1);
        expect(RealmUnions.partnerOf(game.world, j2)).toBeTruthy();
        // ...and it keeps running
        expect(() => RealmUnions.processDay(game.world, game.player)).not.toThrow();
        expect(j2.personalUnion).toBeDefined();
    });
});
