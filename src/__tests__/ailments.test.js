// Wounds, sickness and medicine (systems/ailments.js): personal conditions
// with effects, healing time, infection, disease stages, contagion, treatment
// and death that is reported (never triggered) by the domain code.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Ailments } from '../systems/ailments.js';
import { Traits } from '../systems/traits.js';
import { Technology } from '../systems/technology.js';
import { Relationships } from '../systems/relationships.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { addSettlementActions } from '../player/actions/settlementActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    delete Ailments.DEFS.test_doom;
    delete Ailments.DEFS.test_scar;
});

function makeWorld(day = 10, tileExtra = {}) {
    const tile = { q: 3, r: 3, terrain: { id: 'plains', passable: true }, ...tileExtra };
    return {
        day, season: 'Summer', width: 40, height: 40, units: [], events: [], activeEvents: [],
        getTile: (q, r) => (q === 3 && r === 3 ? tile : null),
        getKingdom: () => null,
        _tile: tile,
    };
}

function makePlayer() {
    const p = new Player();
    p.q = 3; p.r = 3;
    p.inventory = {};
    p.health = 100;
    p._lastRestType = 'outdoors';
    p.movementRemaining = 10;
    return p;
}

/** Run days until the player has no conditions left (or the cap). */
function runUntilWell(p, w, cap = 80) {
    const all = { healed: [], caught: [], worsened: [], infected: [], died: null };
    for (let i = 0; i < cap && Ailments.list(p).length; i++) {
        w.day++;
        p.health = 100;
        const out = Ailments.processDay(w, p);
        all.healed.push(...out.healed);
        all.caught.push(...out.caught);
        all.worsened.push(...out.worsened);
        all.infected.push(...out.infected);
        if (out.died) { all.died = out.died; break; }
    }
    return all;
}

describe('content (data/ailments.json)', () => {
    it('is internally consistent', () => {
        expect(Ailments.validate()).toEqual([]);
    });

    it('has the wounds and diseases the realm needs', () => {
        for (const id of ['gash', 'broken_arm', 'cracked_ribs', 'head_wound', 'arrow_leg', 'slashed_face', 'bite_wound']) {
            expect(Ailments.def(id).kind).toBe('wound');
        }
        for (const id of ['chill', 'flux', 'marsh_fever', 'plague', 'scurvy', 'famine_fever', 'wound_fever']) {
            expect(Ailments.def(id).kind).toBe('disease');
            expect(Ailments.def(id).stages.length).toBeGreaterThan(0);
        }
        expect(Traits.TRAITS.scarred).toBeDefined();
        expect(Traits.TRAITS.lame).toBeDefined();
    });
});

describe('wounds', () => {
    it('cost attributes, skills, movement and battle power until they mend, then give them back', () => {
        Utils.setSeed(3);
        const w = makeWorld();
        const p = makePlayer();
        const str = p.strength;
        const combat = p.skills.combat;
        const rep = Ailments.inflict(p, w, 'broken_arm', { source: 'test' });
        expect(rep.name).toBe('Broken Arm');
        expect(p.strength).toBe(str - 2);
        expect(p.skills.combat).toBe(Math.max(0, combat - 1));
        expect(Ailments.battleMultiplier(p)).toBeLessThan(1);
        expect(PlayerEffects.ailmentBattleMultiplier(p)).toBeCloseTo(Ailments.battleMultiplier(p));

        Ailments.inflict(p, w, 'arrow_leg');
        expect(Ailments.movementPenalty(p)).toBe(3);
        p.movementRemaining = 10;
        Ailments.processDay(w, p);
        expect(p.movementRemaining).toBe(7);

        Ailments.list(p).forEach(r => { r.treated = 1; });
        p._lastRestType = 'inn';
        const all = runUntilWell(p, w);
        expect(all.healed).toEqual(expect.arrayContaining(['Broken Arm', 'Arrow in the Leg']));
        expect(p.strength).toBe(str);
        expect(p.skills.combat).toBe(combat);
        expect(Ailments.battleMultiplier(p)).toBe(1);
    });

    it('a second wound of the same kind extends the first instead of stacking', () => {
        const w = makeWorld();
        const p = makePlayer();
        Ailments.inflict(p, w, 'gash', { days: 3 });
        Ailments.inflict(p, w, 'gash', { days: 8 });
        expect(Ailments.list(p)).toHaveLength(1);
        expect(Ailments.list(p)[0].daysLeft).toBe(8);
    });

    it('never pushes an attribute below 1, and gives back exactly what it took', () => {
        const w = makeWorld();
        const p = makePlayer();
        p.strength = 2;
        Ailments.inflict(p, w, 'broken_arm');
        expect(p.strength).toBe(1);
        Ailments.cureAll(p);
        expect(p.strength).toBe(2);
    });

    it('heal faster resting at an inn than sleeping rough', () => {
        const days = (rest) => {
            Utils.setSeed(5);
            const w = makeWorld();
            const p = makePlayer();
            p._lastRestType = rest;
            Ailments.inflict(p, w, 'cracked_ribs', { days: 16 });
            let n = 0;
            while (Ailments.list(p).length && n < 60) { w.day++; n++; Ailments.processDay(w, p); }
            return n;
        };
        expect(days('inn')).toBeLessThan(days('outdoors'));
    });

    it('untreated wounds can turn infected; infected wounds stop mending and drain health', () => {
        Utils.setSeed(1);
        const w = makeWorld();
        const p = makePlayer();
        Ailments.inflict(p, w, 'bite_wound', { days: 30 });
        const rec = Ailments.list(p)[0];
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        Ailments.processDay(w, p);
        expect(rec.infected).toBe(true);
        vi.restoreAllMocks();
        const left = rec.daysLeft;
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        p.health = 50;
        const out = Ailments.processDay(w, p);
        expect(rec.daysLeft).toBe(left);
        expect(out.drained).toBeGreaterThan(0);
        expect(p.health).toBeLessThan(50);
    });

    it('treated wounds almost never fester', () => {
        Utils.setSeed(2);
        let infected = 0;
        for (let i = 0; i < 200; i++) {
            const w = makeWorld();
            const p = makePlayer();
            Ailments.inflict(p, w, 'bite_wound', { days: 8 });
            Ailments.list(p)[0].treated = 0.8;
            infected += runUntilWell(p, w).infected.length;
        }
        expect(infected).toBeLessThan(15);
    });

    it('a wound can leave a lasting mark that earns the Scarred trait and changes how NPCs react', () => {
        const w = makeWorld();
        const p = makePlayer();
        Ailments.DEFS.test_scar = { kind: 'wound', name: 'Test Cut', icon: '🩸', severity: 1, days: [1, 1], infection: 0, effects: {}, permanent: { chance: 1, deed: 'scarring' } };
        Ailments.inflict(p, w, 'test_scar');
        w.day++;
        const out = Ailments.processDay(w, p);
        expect(out.scarred[0].traits).toContain('scarred');
        expect(Traits.has(p, 'scarred')).toBe(true);
        expect(Traits.effect(p, 'intimidation')).toBeLessThan(0);
        expect(Traits.effect(p, 'npcWarmth')).toBeLessThan(0);
    });

    it('a limp (Lame) costs a hex of movement every day', () => {
        const p = makePlayer();
        expect(Ailments.movementPenalty(p)).toBe(0);
        Traits.recordDeed(p, 'maiming', 1);
        expect(Traits.has(p, 'lame')).toBe(true);
        expect(Ailments.movementPenalty(p)).toBe(1);
    });

    it('wound sources roll from data, and Divine Protection prevents them', () => {
        Utils.setSeed(8);
        let hits = 0;
        for (let i = 0; i < 400; i++) {
            const p = makePlayer();
            if (Ailments.maybeWound(p, makeWorld(), 'battle_loss')) hits++;
        }
        expect(hits).toBeGreaterThan(40);
        expect(hits).toBeLessThan(140);
        const p = makePlayer();
        p.blessings = { protection: 3 };
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        expect(Ailments.maybeWound(p, makeWorld(), 'monster')).toBeNull();
    });

    it('armour lowers the odds of a wound', () => {
        const count = (inv) => {
            Utils.setSeed(21);
            let n = 0;
            for (let i = 0; i < 500; i++) {
                const p = makePlayer();
                p.inventory = { ...inv };
                if (Ailments.maybeWound(p, makeWorld(), 'ambush')) n++;
            }
            return n;
        };
        expect(count({ leather_armor: 1, shield: 1 })).toBeLessThan(count({}));
    });
});

describe('diseases', () => {
    it('run through stages and either pass or worsen; the deadly stage is reported, not triggered', () => {
        const w = makeWorld();
        const p = makePlayer();
        Ailments.DEFS.test_doom = {
            kind: 'disease', name: 'Doom', icon: '☠️', severity: 3, contagion: 0,
            stages: [
                { name: 'Unease', days: [1, 1], worsen: 1, effects: { attrs: { strength: -1 } } },
                { name: 'Doom', days: [5, 5], deathChance: 1, effects: { healthDrain: 1 } },
            ],
        };
        const str = p.strength;
        vi.spyOn(Utils, 'random').mockReturnValue(0.5);
        Ailments.inflict(p, w, 'test_doom');
        expect(p.strength).toBe(str - 1);
        w.day++;
        let out = Ailments.processDay(w, p);
        expect(out.worsened[0].stage).toBe('Doom');
        expect(p.strength).toBe(str);
        // A strong body survives the crisis: a heavy blow, not death
        p.health = p.maxHealth || 100;
        w.day++;
        out = Ailments.processDay(w, p);
        expect(out.died).toBeNull();
        expect(out.crises[0].name).toBe('Doom');
        expect(p.health).toBeLessThan(p.maxHealth || 100);
        // Weakened, the next crisis kills
        p.health = Math.floor((p.maxHealth || 100) * Ailments.DEATH_HEALTH_FRACTION);
        w.day++;
        out = Ailments.processDay(w, p);
        expect(out.died).toEqual({ cause: 'illness', name: 'Doom', icon: '☠️' });
        expect(p.ailments.deathCause.name).toBe('Doom');
    });

    it('draining health to nothing is reported as death', () => {
        const w = makeWorld();
        const p = makePlayer();
        Ailments.inflict(p, w, 'plague', { stage: 1 });
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        p.health = 3;
        const out = Ailments.processDay(w, p);
        expect(out.died.cause).toBe('illness');
        expect(p.health).toBe(0);
    });

    it('a mild case usually passes on its own, more surely with rest and care', () => {
        const worse = (rest) => {
            Utils.setSeed(11);
            let n = 0;
            for (let i = 0; i < 300; i++) {
                const w = makeWorld();
                const p = makePlayer();
                p._lastRestType = rest;
                Ailments.inflict(p, w, 'chill');
                n += runUntilWell(p, w).worsened.length;
            }
            return n;
        };
        const rough = worse('outdoors');
        const inn = worse('inn');
        expect(inn).toBeLessThan(rough);
        expect(rough).toBeLessThan(300 * 0.6);
    });

    it('exposure to a storm can bring on a chill; a heat wave brings heatstroke', () => {
        Utils.setSeed(4);
        let chills = 0;
        let heat = 0;
        for (let i = 0; i < 300; i++) {
            const p = makePlayer();
            const out = Ailments.processDay(makeWorld(), p, { exposure: 5, weather: 'blizzard' });
            if (out.caught.some(c => c.id === 'chill')) chills++;
            const p2 = makePlayer();
            const out2 = Ailments.processDay(makeWorld(), p2, { exposure: 5, weather: 'heatwave' });
            if (out2.caught.some(c => c.id === 'heatstroke')) heat++;
        }
        expect(chills).toBeGreaterThan(20);
        expect(heat).toBeGreaterThan(20);
        // No exposure, no chill
        const p = makePlayer();
        expect(Ailments.processDay(makeWorld(), p, {}).caught.filter(c => c.source === 'exposure')).toEqual([]);
    });

    it('a plague over your tile can infect you — worse in a crowded city, less with medicine', () => {
        const rate = (settlement, techs = []) => {
            Utils.setSeed(6);
            let n = 0;
            for (let i = 0; i < 600; i++) {
                const w = makeWorld(10, settlement ? { settlement, kingdom: 'k1' } : { kingdom: 'k1' });
                w.activeEvents = [{ id: 'plague', kingdomId: 'k1', regionName: 'Varr', effects: { population: -0.15 } }];
                const p = makePlayer();
                Technology.initPlayer(p);
                p.technology.implemented = techs;
                if (Ailments.processDay(w, p).caught.some(c => c.id === 'plague')) n++;
            }
            return n;
        };
        const wild = rate(null);
        const capital = rate({ type: 'capital', name: 'X', population: 9000 });
        const protectedCapital = rate({ type: 'capital', name: 'X', population: 9000 }, ['herbalism', 'plague_prevention']);
        expect(capital).toBeGreaterThan(wild);
        expect(protectedCapital).toBeLessThan(capital);
    });

    it('swamp fevers strike in the fens, rarely indoors', () => {
        const rate = (rest, terrain) => {
            Utils.setSeed(7);
            let n = 0;
            for (let i = 0; i < 1000; i++) {
                const p = makePlayer();
                p._lastRestType = rest;
                if (Ailments.processDay(makeWorld(10, { terrain: { id: terrain } }), p).caught.some(c => c.id === 'marsh_fever')) n++;
            }
            return n;
        };
        expect(rate('outdoors', 'swamp')).toBeGreaterThan(rate('inn', 'swamp'));
        expect(rate('outdoors', 'plains')).toBe(0);
    });

    it('raw rations can bring on the flux', () => {
        Utils.setSeed(9);
        let n = 0;
        for (let i = 0; i < 2000; i++) {
            const p = makePlayer();
            p._lastFood = 'fish';
            if (Ailments.processDay(makeWorld(), p).caught.some(c => c.id === 'flux')) n++;
        }
        expect(n).toBeGreaterThan(2);
        expect(n).toBeLessThan(40);
    });

    it('long voyages without fresh food bring scurvy; fruit in the hold keeps it away', () => {
        const voyage = (inv) => {
            Utils.setSeed(10);
            const w = makeWorld();
            const p = makePlayer();
            p.boardedShip = 'ship1';
            p.inventory = { ...inv };
            for (let d = 0; d < 60; d++) {
                w.day++;
                Ailments.processDay(w, p);
                if (Ailments.has(p, 'scurvy')) return d;
            }
            return null;
        };
        const d = voyage({});
        expect(d).not.toBeNull();
        expect(d).toBeGreaterThan(Ailments.cfg().sources.scurvy.graceDays - 1);
        expect(voyage({ fruit: 40 })).toBeNull();
    });
});

describe('contagion', () => {
    function withParty(p, npcs) {
        p.travelParty = npcs.map(n => n.id);
        vi.spyOn(Relationships, 'getTravelPartyMembers').mockReturnValue(npcs);
    }

    it('a contagious disease spreads to companions, and back', () => {
        const w = makeWorld();
        const p = makePlayer();
        const npc = { id: 'n1', firstName: 'Ana', occupation: 'guard', companion: { approval: 50, values: [] } };
        withParty(p, [npc]);
        Ailments.inflict(p, w, 'plague');
        vi.spyOn(Utils, 'random').mockReturnValue(0.1);
        const out = Ailments.processDay(w, p);
        expect(out.companions.some(c => c.event === 'caught' && c.npcId === 'n1')).toBe(true);
        expect(Ailments.sickCompanions(p)[0].disease).toBe('Plague');

        const p2 = makePlayer();
        withParty(p2, [npc]);
        Ailments.getState(p2).party.n1 = { id: 'flux', daysLeft: 5 };
        Utils.random.mockReturnValue(0.01);
        const out2 = Ailments.processDay(w, p2);
        expect(out2.caught.some(c => c.id === 'flux' && c.from === 'Ana')).toBe(true);
    });

    it('sickness aboard ship spreads to the crew, costs morale and sailors, and passes', () => {
        const w = makeWorld();
        const p = makePlayer();
        const ship = { id: 's1', name: 'Gull', crew: 20, morale: 70, status: 'at_sea' };
        p.ships = [ship];
        p.boardedShip = 's1';
        Ailments.inflict(p, w, 'plague');
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const out = Ailments.processDay(w, p);
        expect(out.crews.some(c => c.event === 'outbreak')).toBe(true);
        expect(ship.morale).toBeLessThan(70);
        expect(ship.crew).toBeLessThan(20);
        vi.restoreAllMocks();
        Ailments.cureAll(p);
        ship.status = 'docked';
        p.boardedShip = null;
        for (let i = 0; i < 12 && Ailments.getState(p).crews.s1; i++) { w.day++; Ailments.processDay(w, p); }
        expect(Ailments.getState(p).crews.s1).toBeUndefined();
    });
});

describe('medicine', () => {
    const village = { type: 'village', name: 'V' };
    const city = { type: 'city', name: 'C' };

    it('physicians are better in cities and with medicine techs', () => {
        const p = makePlayer();
        Technology.initPlayer(p);
        const v = Ailments.physicianQuality(p, village, 'wound');
        const c = Ailments.physicianQuality(p, city, 'wound');
        expect(c).toBeGreaterThan(v);
        p.technology.implemented = ['herbalism', 'surgery', 'hospital'];
        expect(Ailments.physicianQuality(p, city, 'wound')).toBeGreaterThan(c);
        expect(Ailments.physicianQuality(p, city, 'wound')).toBeLessThanOrEqual(0.95);
    });

    it('treatment is charged by severity and settlement size', () => {
        const w = makeWorld();
        const p = makePlayer();
        Ailments.inflict(p, w, 'gash');
        Ailments.inflict(p, w, 'broken_arm');
        const [gash, arm] = Ailments.treatmentOptions(p, w, city);
        expect(arm.cost).toBeGreaterThan(gash.cost);
        expect(Ailments.treatmentOptions(p, w, village)[1].cost).toBeLessThan(arm.cost);
    });

    it('treating a wound cleans it, sets it and costs gold', () => {
        Utils.setSeed(12);
        const w = makeWorld();
        const p = makePlayer();
        p.gold = 500;
        Ailments.inflict(p, w, 'arrow_leg', { days: 16 });
        const rec = Ailments.list(p)[0];
        rec.infected = true;
        const res = Ailments.treat(p, w, city, rec.key);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(500 - res.cost);
        expect(rec.infected).toBe(false);
        expect(rec.treated).toBeGreaterThan(0);
        expect(rec.daysLeft).toBeLessThan(16);
        // Can't be treated twice at the same quality
        expect(Ailments.treat(p, w, city, rec.key).success).toBe(false);
    });

    it("can't be paid for without the gold", () => {
        const w = makeWorld();
        const p = makePlayer();
        p.gold = 0;
        Ailments.inflict(p, w, 'chill');
        const res = Ailments.treat(p, w, city, Ailments.list(p)[0].key);
        expect(res.success).toBe(false);
    });

    it('temple rites tend fevers but not wounds', () => {
        const w = makeWorld();
        const p = makePlayer();
        p.gold = 500;
        Ailments.inflict(p, w, 'gash');
        Ailments.inflict(p, w, 'chill');
        const opts = Ailments.treatmentOptions(p, w, city, true);
        expect(opts.find(o => o.kind === 'wound').can).toBe(false);
        expect(opts.find(o => o.kind === 'disease').can).toBe(true);
        expect(opts.find(o => o.kind === 'disease').cost).toBeLessThan(Ailments.treatmentOptions(p, w, city, false).find(o => o.kind === 'disease').cost);
    });

    it('remedies from the pack dress wounds and ease fevers', () => {
        const w = makeWorld();
        const p = makePlayer();
        p.inventory = { herbs: 2, potion: 1 };
        Ailments.inflict(p, w, 'gash');
        Ailments.inflict(p, w, 'chill');
        const [gash, chill] = Ailments.list(p);
        expect(Ailments.useRemedy(p, w, 'herbs', gash.key).success).toBe(true);
        expect(gash.dressedUntil).toBeGreaterThan(w.day);
        expect(p.inventory.herbs).toBe(1);
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        expect(Ailments.useRemedy(p, w, 'potion', chill.key).success).toBe(true);
        expect(chill.easeMult).toBeLessThan(1);
        expect(Ailments.careFactor(p, w, chill).mult).toBeLessThan(Ailments.careFactor(p, w).mult);
        expect(Ailments.useRemedy(p, w, 'potion', chill.key).success).toBe(false); // none left
    });

    it('a healer in the party and an inn bed improve care', () => {
        const w = makeWorld();
        const p = makePlayer();
        const base = Ailments.careFactor(p, w).mult;
        p._lastRestType = 'inn';
        const inn = Ailments.careFactor(p, w).mult;
        p.travelParty = ['h1'];
        vi.spyOn(Relationships, 'getTravelPartyMembers').mockReturnValue([{ id: 'h1', firstName: 'Mira', occupation: 'healer' }]);
        const healer = Ailments.careFactor(p, w);
        expect(inn).toBeLessThan(base);
        expect(healer.mult).toBeLessThan(inn);
        expect(healer.parts.join(' ')).toContain('Mira');
    });

    it('prayer eases the worst fever once a day', () => {
        const w = makeWorld();
        const p = makePlayer();
        expect(Ailments.pray(p, w)).toBeNull();
        Ailments.inflict(p, w, 'flux');
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        const r = Ailments.pray(p, w);
        expect(r.answered).toBe(false);
        expect(Ailments.list(p)[0].easeMult).toBeLessThan(1);
        expect(Ailments.pray(p, w)).toBeNull();
    });

    it('the Divine Healing miracle lifts every wound and sickness', () => {
        const w = makeWorld();
        const p = makePlayer();
        p.karma = 100;
        const str = p.strength;
        Ailments.inflict(p, w, 'broken_arm');
        Ailments.inflict(p, w, 'plague');
        p.religion = { name: 'Test Faith', tenets: [], buildings: [] };
        const res = PlayerReligion.performMiracle(p, 'healing', w);
        expect(res.success).toBe(true);
        expect(res.effect).toContain('lifted');
        expect(Ailments.list(p)).toEqual([]);
        expect(p.strength).toBe(str);
    });

    it('a settlement offers a physician only when someone needs one', () => {
        const w = makeWorld();
        const p = makePlayer();
        const tile = { q: 3, r: 3, terrain: { id: 'plains' }, settlement: { type: 'town', name: 'T', population: 900 } };
        const ctx = { isCity: true, isVillage: false };
        const types = () => {
            const actions = [];
            try { addSettlementActions(actions, p, tile, w, ctx); } catch (e) { /* other builders may need a fuller world */ }
            return actions.map(a => a.type);
        };
        expect(types()).not.toContain('seek_physician');
        Ailments.inflict(p, w, 'gash');
        expect(types()).toContain('seek_physician');
    });
});

describe('persistence and succession', () => {
    it('round-trips through a save', () => {
        const w = makeWorld();
        const p = makePlayer();
        Ailments.inflict(p, w, 'head_wound');
        Ailments.inflict(p, w, 'chill');
        const data = SaveLoad.serializePlayer(p);
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(Ailments.list(back).map(a => a.id)).toEqual(['head_wound', 'chill']);
        expect(back.ailments.stats.wounds).toBe(1);
    });

    it('older saves get a blank record', () => {
        const data = SaveLoad.serializePlayer(new Player());
        delete data.ailments;
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(back.ailments.list).toEqual([]);
        expect(back.ailments.daysAtSea).toBe(0);
        const partial = new Player();
        partial.ailments = { list: [] };
        Ailments.loadState(partial);
        expect(partial.ailments.party).toEqual({});
        expect(partial.ailments.stats.healed).toBe(0);
    });

    it('an heir does not inherit the late ruler\'s wounds', () => {
        const w = makeWorld();
        const p = makePlayer();
        Ailments.inflict(p, w, 'broken_arm');
        p.children = [{ id: 'c1', isAlive: true, age: 20, firstName: 'Bo', dynasty: 'X', strength: 6, skills: {} }];
        p.reputation = {};
        const res = Relationships.succeedAsHeir(p, 'c1', w);
        expect(res.success).toBe(true);
        expect(Ailments.list(p)).toEqual([]);
        expect(p.strength).toBe(6);
        // Nothing to give back later
        w.day += 100;
        Ailments.processDay(w, p);
        expect(p.strength).toBe(6);
    });
});
