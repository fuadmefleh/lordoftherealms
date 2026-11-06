/**
 * Trade skills (systems/tradeSkills.js, data/skillPacks/trades.json):
 * Smithing, Tanning & Weaving, Brewing and Medicine as practised skills in
 * levels — crafting through them, old craft values migrated, perks felt at
 * the bench and the sickbed, and the NPC smiths, tanners, brewers and healers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { TradeSkills } from '../systems/tradeSkills.js';
import { Crafting } from '../player/crafting.js';
import { Ailments } from '../systems/ailments.js';
import { Relationships } from '../systems/relationships.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcFamily } from '../systems/npcFamily.js';
import { OddJobs } from '../player/oddJobs.js';
import { Commissions } from '../systems/commissions.js';
import { SettlementServices } from '../player/settlementServices.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(4321));
afterEach(() => vi.restoreAllMocks());

function crafter(over = {}) {
    return {
        gold: 1000, health: 60, maxHealth: 100, strength: 5, intelligence: 5, charisma: 5, faith: 5, luck: 5,
        renown: 0, karma: 0, inventory: {}, maxInventory: 200, reputation: {},
        skills: { commerce: 1, combat: 1, leadership: 1, diplomacy: 1, stealth: 1, cartography: 0 },
        ...over,
    };
}

describe('the trade skills are practised skills', () => {
    it('Smithing, Tanning & Weaving, Brewing and Medicine are in the data with perks on every level', () => {
        for (const id of ['smithing', 'tanning', 'brewing', 'medicine']) {
            const d = PracticeSkills.def(id);
            expect(d, id).toBeTruthy();
            for (const [pid, p] of Object.entries(d.perks)) expect(p.levels.length, `${id}.${pid}`).toBe(PracticeSkills.maxLevel());
            // every rise gives something
            for (let L = 1; L < PracticeSkills.maxLevel(); L++) expect(PracticeSkills.gainsBetween(id, L, L + 1).length, `${id} ${L}`).toBeGreaterThan(0);
        }
        expect(TradeSkills.forCraft('leatherwork')).toBe('tanning');
        expect(TradeSkills.forCraft('tailoring')).toBe('tanning');
        expect(TradeSkills.forCraft('alchemy')).toBe('brewing');
        expect(TradeSkills.forCraft('carpentry')).toBe(null);
    });

    it('old 0..10 craft values migrate into XP: (level - 1) + progress = the old value', () => {
        const p = crafter({ skills: { smithing: 4.5, leatherwork: 3, tailoring: 6.2 } });
        expect(Crafting.skillLevel(p, 'smithing')).toBeCloseTo(4.5, 2);
        expect(PracticeSkills.level(p, 'smithing')).toBe(5);
        // leatherwork and tailoring are one skill now: the better of the two
        expect(PracticeSkills.level(p, 'tanning')).toBe(7);
        expect(Crafting.skillLevel(p, 'leatherwork')).toBeCloseTo(6.2, 2);
        // migrating again changes nothing; a lower old value never lowers XP
        const xp = PracticeSkills.xp(p, 'smithing');
        p.skills.smithing = 1;
        TradeSkills.migrate(p);
        expect(PracticeSkills.xp(p, 'smithing')).toBe(xp);
        expect(TradeSkills.xpFromOld(10)).toBe(PracticeSkills.xpForLevel(PracticeSkills.maxLevel()));
    });

    it('an old save\'s single crafting rank reaches the practised skills', () => {
        const p = crafter({ crafting: { xp: 400 } });
        expect(PracticeSkills.level(p, 'smithing')).toBe(1);
        expect(Crafting.skillLevel(p, 'smithing')).toBeGreaterThan(5);
        expect(PracticeSkills.level(p, 'brewing')).toBeGreaterThan(5);
    });

    it('practised skills survive a save and load', () => {
        const p = new Player();
        PracticeSkills.setLevel(p, 'smithing', 6);
        PracticeSkills.setLevel(p, 'medicine', 4);
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p))), back);
        expect(PracticeSkills.level(back, 'smithing')).toBe(6);
        expect(PracticeSkills.level(back, 'medicine')).toBe(4);
    });
});

describe('crafting through the levels', () => {
    it('working at the bench earns practised XP and announces a level-up; old values kept in step', () => {
        const p = crafter({ inventory: { hide: 200, salt: 100 } });
        const ups = [];
        for (let i = 0; i < 30; i++) {
            const r = Crafting.craft(p, 'tan_hides');
            if (r.levelUp) ups.push(r.levelUp);
        }
        expect(PracticeSkills.xp(p, 'tanning')).toBeGreaterThan(0);
        expect(ups.length).toBeGreaterThan(0);
        expect(ups[0].skill).toBe('tanning');
        expect(ups[0].text).toMatch(/Tanning & Weaving rose to level 2/);
        expect(p.skills.leatherwork).toBeCloseTo(TradeSkills.craftLevel(p, 'tanning'), 5);
        expect(p.skills.tailoring).toBeCloseTo(TradeSkills.craftLevel(p, 'tanning'), 5);
    });

    it('a higher level: better grades, less wasted, quicker work, a steadier hammer', () => {
        const r = Crafting.recipe('chainmail_forge');
        const novice = crafter({ inventory: { iron_ingot: 2, leather: 1 } });
        const master = crafter({ inventory: { iron_ingot: 2, leather: 1 } });
        PracticeSkills.setLevel(master, 'smithing', 9);
        const a = Crafting.odds(novice, r, {});
        const b = Crafting.odds(master, r, {});
        expect(b.score).toBeGreaterThan(a.score + 2);
        expect(b.fail).toBeLessThan(a.fail);
        expect(b.waste).toBeLessThan(a.waste);
        expect(a.waste).toBe(0.5);
        expect(Crafting.hoursFor(master, r)).toBeLessThan(Crafting.hoursFor(novice, r));
        expect(Crafting.hoursFor(novice, r)).toBe(1);
        expect(Crafting.forgeBonus(master, r)).toBeGreaterThan(0);
        expect(Crafting.forgeBonus(novice, r)).toBe(0);
        // a non-practised craft still reads the old value
        expect(Crafting.hoursFor(novice, Crafting.recipe('saw_planks'))).toBe(1);
    });

    it('a spoiled piece wastes less in practised hands', () => {
        const recipe = { ...Crafting.recipe('boots_craft'), ingredients: { leather: 10 } };
        const lost = (level) => {
            const p = crafter({ inventory: { leather: 10 } });
            if (level > 1) PracticeSkills.setLevel(p, 'tanning', level);
            vi.spyOn(Utils, 'random').mockReturnValue(0);
            const res = Crafting.craft(p, recipe);
            vi.restoreAllMocks();
            expect(res.failed).toBe(true);
            return res.lost.leather;
        };
        expect(lost(1)).toBe(5);
        expect(lost(10)).toBeLessThan(5);
    });

    it('a practised brewer sometimes gets an extra measure (seeded)', () => {
        let spares = 0;
        const p = crafter({ inventory: { grain: 400, honey: 0 } });
        PracticeSkills.setLevel(p, 'brewing', 10);
        for (let i = 0; i < 60; i++) {
            const res = Crafting.craft(p, 'brew_ale');
            if (res.spare) spares++;
        }
        expect(spares).toBeGreaterThan(3);
    });
});

describe('medicine', () => {
    function makeWorld(day = 10) {
        const tile = { q: 3, r: 3, terrain: { id: 'plains', passable: true } };
        return { day, season: 'Summer', units: [], events: [], activeEvents: [], getTile: (q, r) => (q === 3 && r === 3 ? tile : null), getKingdom: () => null };
    }
    function patient(level = 1) {
        const p = new Player();
        p.q = 3; p.r = 3; p.inventory = {}; p.health = 50; p._lastRestType = 'outdoors';
        if (level > 1) PracticeSkills.setLevel(p, 'medicine', level);
        return p;
    }

    it('remedies do more, sickness worsens and catches less, wounds mend faster', () => {
        const w = makeWorld();
        const lo = patient(1), hi = patient(8);
        expect(Ailments.medicineMult(lo)).toBe(1);
        expect(Ailments.medicineMult(hi)).toBeGreaterThan(1.5);
        expect(Ailments.careFactor(hi, w).mult).toBeLessThan(Ailments.careFactor(lo, w).mult);
        expect(Ailments.careFactor(hi, w).parts).toContain('your own physicking');
        expect(Ailments._catchMult(hi)).toBeLessThan(Ailments._catchMult(lo));
        // a gash mends faster
        for (const p of [lo, hi]) Ailments.inflict(p, w, 'gash');
        const [gl, gh] = [Ailments.list(lo)[0], Ailments.list(hi)[0]];
        gl.daysLeft = gh.daysLeft = 20;
        gl.treated = gh.treated = 1; // no infection roll matters
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        Ailments.processDay(w, lo);
        Ailments.processDay(w, hi);
        expect(gh.daysLeft).toBeLessThan(gl.daysLeft);
    });

    it('a remedy heals more in practised hands and teaches Medicine', () => {
        const w = makeWorld();
        const lo = patient(1), hi = patient(7);
        for (const p of [lo, hi]) { p.inventory.healing_salve = 1; Ailments.inflict(p, w, 'gash'); }
        const a = Ailments.useRemedy(lo, w, 'healing_salve', Ailments.list(lo)[0].key);
        const b = Ailments.useRemedy(hi, w, 'healing_salve', Ailments.list(hi)[0].key);
        expect(a.success && b.success).toBe(true);
        expect(hi.health - 50).toBeGreaterThan(lo.health - 50);
        expect(Ailments.list(hi)[0].dressedUntil).toBeGreaterThan(Ailments.list(lo)[0].dressedUntil);
        expect(PracticeSkills.xp(lo, 'medicine')).toBeGreaterThan(0);
    });

    it('enough doctoring raises the level, with an announcement', () => {
        const p = patient(1);
        let up = null;
        for (let i = 0; i < 30 && !up; i++) up = Ailments.learnMedicine(p, 'remedy');
        expect(up).toBeTruthy();
        expect(up.text).toMatch(/Medicine rose to level 2/);
    });

    it('you can nurse a sick companion yourself, once a day, with herbs', () => {
        const w = makeWorld();
        const p = patient(10);
        p.travelParty = ['c1'];
        vi.spyOn(Relationships, 'getTravelPartyMembers').mockReturnValue([{ id: 'c1', firstName: 'Bran', occupation: 'guard' }]);
        vi.spyOn(Relationships, 'getNPC').mockReturnValue({ id: 'c1', firstName: 'Bran' });
        Ailments.getState(p).party.c1 = { id: 'chill', daysLeft: 6 };
        expect(Ailments.tendOption(p, w, 'c1').can).toBe(false); // nothing to tend with
        p.inventory.herbs = 2;
        const opt = Ailments.tendOption(p, w, 'c1');
        expect(opt.can).toBe(true);
        expect(opt.chance).toBeGreaterThan(Ailments.tendOption(patient(1), w, 'c1').chance || 0);
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const res = Ailments.tendCompanion(p, w, 'c1');
        expect(res.success && res.cured).toBe(true);
        expect(Ailments.sickCompanions(p).length).toBe(0);
        expect(p.inventory.herbs).toBe(1);
    });

    it('a failed night\'s nursing still shortens it, and waits for tomorrow', () => {
        const w = makeWorld();
        const p = patient(1);
        p.inventory.herbs = 3;
        vi.spyOn(Relationships, 'getNPC').mockReturnValue({ id: 'c1', firstName: 'Bran' });
        Ailments.getState(p).party.c1 = { id: 'chill', daysLeft: 6 };
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        const res = Ailments.tendCompanion(p, w, 'c1');
        expect(res.success).toBe(true);
        expect(res.cured).toBe(false);
        expect(Ailments.getState(p).party.c1.daysLeft).toBe(5);
        expect(Ailments.tendCompanion(p, w, 'c1').success).toBe(false);
    });

    it('a healer companion\'s care goes with their Medicine', () => {
        expect(TradeSkills.companionCare({ id: 'x', occupation: 'healer', practiceSkills: {} }, 0.7)).toBeGreaterThan(
            TradeSkills.companionCare({ id: 'y', occupation: 'healer', practiceSkills: { medicine: PracticeSkills.xpForLevel(9) } }, 0.7));
        expect(TradeSkills.companionCare({ id: 'z', occupation: 'guard' }, 1)).toBe(1);
    });
});

describe('NPC smiths, tanners, brewers and healers', () => {
    it('roles seed their trade, and some villagers work a craft on the side', () => {
        const smith = {};
        PracticeSkills.seedNpc(smith, { key: 's1', role: 'blacksmith_npc', age: 40 });
        expect(PracticeSkills.level(smith, 'smithing')).toBeGreaterThanOrEqual(6);
        const healer = {};
        PracticeSkills.seedNpc(healer, { key: 'h1', role: 'healer', age: 40 });
        expect(PracticeSkills.level(healer, 'medicine')).toBeGreaterThanOrEqual(6);
        const crafts = {};
        for (let i = 0; i < 400; i++) {
            const c = PracticeSkills.craftOf({ key: `v${i}`, role: 'villager' });
            if (c) crafts[c] = (crafts[c] || 0) + 1;
        }
        // (other skill packs add their own side trades too)
        expect(Object.keys(crafts)).toEqual(expect.arrayContaining(['alewife', 'healer', 'tanner', 'weaver']));
        const mine = ['alewife', 'healer', 'tanner', 'weaver'].reduce((a, k) => a + (crafts[k] || 0), 0);
        expect(mine).toBeGreaterThan(40);
        expect(mine).toBeLessThan(160);
        // a weaver grows by their work
        const key = Object.keys(crafts).length && [...Array(400).keys()].map(i => `v${i}`).find(k => PracticeSkills.craftOf({ key: k, role: 'villager' }) === 'weaver');
        const w = {};
        PracticeSkills.seedNpc(w, { key, role: 'villager', age: 30 });
        const before = PracticeSkills.xp(w, 'tanning');
        PracticeSkills.growNpc(w, { key, role: 'villager', age: 30 }, 30);
        expect(PracticeSkills.xp(w, 'tanning')).toBeGreaterThan(before);
    });

    function town() {
        const t = { name: 'Ashford', type: 'town', q: 5, r: 7 };
        const world = { day: 1, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [], town: t, getSettlementViews: () => [t], getKingdom: () => null };
        const types = { villager: 8, merchant: 2, guard: 2, farmer: 2, priest: 1, blacksmith_npc: 1, child: 2 };
        const npcs = [];
        let id = 0;
        for (const [type, n] of Object.entries(types)) for (let i = 0; i < n; i++) npcs.push({ id: id++, type, name: 'Ada' });
        let s = 7;
        NpcFamily.generateFamilies(npcs, () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; });
        Townsfolk.attach(t, world, npcs, { q: 5, r: 7, target: 18 });
        return { t, world };
    }

    it('a town\'s best smith is its master; hired work and honing go by their level', () => {
        const { t, world } = town();
        const m = TradeSkills.master(t, world, 'smithing');
        expect(m).toBeTruthy();
        expect(m.level).toBeGreaterThanOrEqual(6);
        expect(TradeSkills.hiredBonus(t, world, 'smithing').bonus).toBeCloseTo((m.level - 5) * 0.25, 5);
        expect(TradeSkills.master({ name: 'Nowhere', type: 'village' }, world, 'smithing')).toBe(null);
        expect(TradeSkills.hiredBonus({ name: 'Nowhere' }, world, 'smithing').bonus).toBe(0);
        // a brilliant smith hones for longer
        PracticeSkills.setLevel(m.person, 'smithing', 9);
        expect(SettlementServices.honeArmsDays(t, world).days).toBe(11);
        expect(SettlementServices.honeArmsDays({ name: 'Nowhere' }, world).days).toBe(7);
        // hired smithing names the master
        expect(Commissions.skillOf({ kind: 'craft', recipeId: 'iron_ingot' })).toBe('smithing');
        expect(Commissions.skillOf({ kind: 'trade', recipeId: 'tannery' })).toBe('tanning');
    });

    it('a town\'s physician is its best healer, or a typical one for its size', () => {
        const { t, world } = town();
        const doc = TradeSkills.physician(t, world);
        expect(doc.level).toBeGreaterThanOrEqual(1);
        expect(TradeSkills.physician({ type: 'city' }, world)).toMatchObject({ level: 6, typical: 6, known: false });
        expect(TradeSkills.physicianBonus({ type: 'city' }, world)).toBe(0);
        // a great healer in town treats better
        const m = TradeSkills.master(t, world, 'medicine') || { person: t.folk.people.find(p => p.role !== 'child' && Townsfolk.isHere(p)) };
        PracticeSkills.setLevel(m.person, 'medicine', 10);
        const p = new Player();
        expect(Ailments.physicianQuality(p, t, 'wound', world)).toBeGreaterThan(Ailments.physicianQuality(p, { ...t, folk: undefined }, 'wound', world));
    });
});

describe('day labour in the trades', () => {
    it('a smith\'s striker learns Smithing', () => {
        const p = crafter();
        const gains = OddJobs.train(p, { id: 'smith_striker', stat: 'strength', difficulty: 4, practice: { smithing: 8 } }, 80);
        const g = gains.find(x => x.kind === 'practice');
        expect(g.id).toBe('smithing');
        expect(PracticeSkills.xp(p, 'smithing')).toBeCloseTo(g.by, 5);
        expect(p.strength).toBeGreaterThanOrEqual(5);
        const jobs = DataLoader._gamedata.earlyJobs.oddJobs.settlement_jobs;
        const all = Object.values(jobs).flat();
        for (const id of ['smith_striker', 'tannery_hand', 'brewhouse_hand', 'physicians_aide']) expect(all.find(j => j.id === id), id).toBeTruthy();
    });
});
