// The heirs you raise (systems/raising.js): time together (activities that
// teach, plant character and move the bond), tutors who are real people paid
// real wages, wards taken in from other realms (a fee from their treasury,
// standing, wardmates, hostages, a death), betrothals and dowries in real coin,
// the coming-of-age summary — and all of it carried into succession and
// through a save.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { NPCLords } from '../world/npcLords.js';
import { Player } from '../player/player.js';
import { House } from '../systems/house.js';
import { Heirs } from '../systems/heirs.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { Upbringing } from '../systems/upbringing.js';
import { Raising } from '../systems/raising.js';
import { Relationships } from '../systems/relationships.js';
import { Traits } from '../systems/traits.js';
import { Court } from '../systems/court.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let baseUp;
beforeAll(async () => {
    await loadData();
    baseUp = JSON.parse(JSON.stringify(DataLoader.upbringing));
});
beforeEach(() => {
    Relationships._npcs = [];
});
afterEach(() => {
    DataLoader.upbringing.raising = JSON.parse(JSON.stringify(baseUp.raising));
    DataLoader.upbringing.agency = JSON.parse(JSON.stringify(baseUp.agency));
    DataLoader.upbringing.config = JSON.parse(JSON.stringify(baseUp.config));
});

const Y = () => Upbringing._daysPerYear();

function makeWorld(day = 40) {
    const lord = (name, kid) => ({ name, kingdomId: kid, age: 50, traits: [], honor: 6, martial: 5, diplomacy: 5, stewardship: 5, relationships: {}, goals: [] });
    const world = {
        day, width: 30, height: 20, units: [], events: [], generationParams: { seed: 991 },
        kingdoms: [
            { id: 'k1', name: 'Arvenland', ruler: 'Queen Maud', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', traits: ['militaristic'], military: 200, territory: [], treasury: 1000,
                characterData: { ruler: { firstName: 'Maud', dynasty: 'Arven', traits: [] }, children: [{ id: 'roy_a', firstName: 'Piers', dynasty: 'Arven', gender: 'male', age: 9, isAlive: true }] },
                lord: lord('Queen Maud', 'k1') },
            { id: 'k2', name: 'Belmarch', ruler: 'King Osric', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', traits: ['mercantile'], military: 180, territory: [], treasury: 800,
                lord: lord('King Osric', 'k2') },
        ],
        getTile: () => null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [],
        getAllSettlements: () => [],
    };
    return world;
}

function makePlayer(world) {
    const p = new Player();
    p.firstName = 'Aldric';
    p.lastName = 'Vane';
    p.name = 'Aldric Vane';
    p.gold = 3000;
    p.age = 50;
    p.renown = 10;
    p.reputation = { k1: 20, k2: 15 };
    p.relationships = {};
    p.children = [];
    p.army = [];
    p.skills = { commerce: 2, combat: 8, leadership: 3, diplomacy: 3, stealth: 1, cartography: 0 };
    House.initialize(p, world);
    return p;
}

let nextId = 1;
function addChild(player, extra = {}) {
    const c = {
        id: `rz_${nextId++}`, firstName: extra.firstName || 'Edda', dynasty: 'Vane', gender: 'female', age: 9, isAlive: true,
        traits: [], strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    player.children.push(c);
    return c;
}

function makeNpc(player, extra = {}) {
    const npc = {
        id: `tnpc_${nextId++}`, firstName: 'Hild', dynasty: 'Ash', gender: 'female', age: 40, isAlive: true,
        occupation: 'knight', traits: ['brave', 'serious'], purse: 0, ...extra,
    };
    Relationships._npcs.push(npc);
    player.relationships[npc.id] = { score: 30, history: [] };
    return npc;
}

/** The daily ticks the endDay loop runs for the family, `days` times. */
function live(player, world, days) {
    const notices = [];
    for (let i = 0; i < days; i++) {
        world.day++;
        if (world.day % Y() === 0) for (const c of player.children) if (c.isAlive) c.age++;
        Upbringing.processDay(player, world);
        notices.push(...HeirAgency.processDay(player, world).notices);
        notices.push(...Raising.processDay(player, world).notices);
    }
    return notices;
}

describe('content', () => {
    it('loads activities, tutor tempers and ward rules whose trait ids resolve', () => {
        const cfg = Raising.config();
        expect(cfg.activities.length).toBeGreaterThanOrEqual(8);
        for (const a of cfg.activities) {
            for (const id of Object.keys(a.seeds || {})) expect(Traits.TRAITS[id], `${a.id}:${id}`).toBeTruthy();
        }
        for (const seeds of Object.values(cfg.tutorTraitSeeds)) for (const id of Object.keys(seeds)) expect(Traits.TRAITS[id], id).toBeTruthy();
        for (const id of [...Object.keys(cfg.closeSeeds), ...Object.keys(cfg.distantSeeds)]) expect(Traits.TRAITS[id], id).toBeTruthy();
        for (const d of ['ward_raised', 'ward_died']) expect(NPCLords.deedDef(d), d).toBeTruthy();
    });
});

describe('time together', () => {
    it('an activity teaches (at the parent\'s skill), plants character and moves the bond', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const kid = addChild(p, { age: 10 });
        const bond0 = Raising.bond(kid);
        const res = Raising.spendTime(p, world, kid.id, 'spar');
        expect(res.success).toBe(true);
        expect(res.factor).toBeGreaterThan(1); // a parent with combat 8 teaches well
        expect(Raising.bond(kid)).toBe(bond0 + Raising.activity('spar').bond);
        expect(kid.upbringing.seeds.brave).toBeGreaterThan(0);
        expect(kid.upbringing.xp['skill:combat']).toBeGreaterThan(0.4);

        // A clumsy parent teaches less
        const q = makePlayer(world);
        q.skills.combat = 0;
        const k2 = addChild(q, { age: 10 });
        Raising.spendTime(q, world, k2.id, 'spar');
        expect(k2.upbringing.xp['skill:combat']).toBeLessThan(kid.upbringing.xp['skill:combat']);
    });

    it('a hard lesson teaches the focus fast and cools the child toward you', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const kid = addChild(p, { age: 10 });
        Upbringing.setFocus(p, kid.id, 'stewardship', world);
        const res = Raising.spendTime(p, world, kid.id, 'discipline');
        expect(res.success).toBe(true);
        expect(res.bondDelta).toBeLessThan(0);
        expect(kid.upbringing.xp['skill:commerce']).toBeGreaterThan(0);
    });

    it('a few times a year only, with a rest between, at home, at the right age', () => {
        const world = makeWorld(100);
        const p = makePlayer(world);
        const kid = addChild(p, { age: 10 });
        const cfg = Raising.config();
        expect(Raising.spendTime(p, world, kid.id, 'tales').success).toBe(true);
        const again = Raising.spendTime(p, world, kid.id, 'tales');
        expect(again.success).toBe(false);
        expect(again.reason).toMatch(/lately/);
        for (let i = 1; i < cfg.timesPerYear; i++) {
            world.day += cfg.timeCooldownDays;
            expect(Raising.spendTime(p, world, kid.id, 'chapel').success).toBe(true);
        }
        world.day += cfg.timeCooldownDays;
        const full = Raising.spendTime(p, world, kid.id, 'chapel');
        expect(full.success).toBe(false);
        expect(full.reason).toMatch(/this year/);
        world.day = 100 + Y();
        expect(Raising.spendTime(p, world, kid.id, 'chapel').success).toBe(true);

        const tiny = addChild(p, { age: 5 });
        expect(Raising.spendTime(p, world, tiny.id, 'hunt').success).toBe(false); // hunting from 8
        expect(Raising.spendTime(p, world, tiny.id, 'tales').success).toBe(true);

        const away = addChild(p, { age: 9 });
        expect(HeirAgency.fosterChild(p, world, away.id, 'k1', 1).success).toBe(true);
        expect(Raising.spendTime(p, world, away.id, 'tales').success).toBe(false);
    });

    it('a child left alone drifts away; the bond shapes their adult character and the succession', () => {
        const world = makeWorld(0);
        const p = makePlayer(world);
        const lonely = addChild(p, { age: 10, firstName: 'Lone' });
        const loved = addChild(p, { age: 10, firstName: 'Dear' });
        live(p, world, 1);
        // Spend time with one child every 40 days; none with the other
        for (let y = 0; y < 6; y++) {
            for (let k = 0; k < 3; k++) {
                const r = Raising.spendTime(p, world, loved.id, 'tales');
                if (!r.success) Raising.spendTime(p, world, loved.id, 'indulge');
                live(p, world, 40);
            }
        }
        expect(Raising.bond(lonely)).toBeLessThan(Raising.config().distantBond + 1);
        expect(Raising.bond(loved)).toBeGreaterThanOrEqual(Raising.config().closeBond);
        expect(lonely.upbringing.comeOfAge).toBe(true);
        expect(loved.upbringing.comeOfAge).toBe(true);
        // Close: merciful/honest seeds; distant: cruel/wanderer seeds
        expect(loved.upbringing.seeds.merciful || 0).toBeGreaterThanOrEqual(1);
        expect(lonely.upbringing.seeds.cruel || 0).toBeGreaterThanOrEqual(1.5);
        const planLoved = HeirAgency.payoff(p, world, loved);
        const planLonely = HeirAgency.payoff(p, world, lonely);
        expect(planLoved.lines.some(l => l.icon === '❤️')).toBe(true);
        expect(planLonely.lines.some(l => l.icon === '🥀')).toBe(true);
        expect(planLoved.prestige - planLonely.prestige).toBe(Raising.config().payoff.closePrestige - Raising.config().payoff.distantPrestige);
    });

    it('the bond scales how much of the parent rubs off', () => {
        const world = makeWorld(0);
        const run = (bond) => {
            Utils.setSeed(12345);
            const p = makePlayer(world);
            Traits.grantTraits(p, ['greedy', 'pious', 'cunning', 'scholar']);
            const kid = addChild(p, { age: 6 });
            Raising.ensure(kid).bond = bond;
            const out = { tutorsLeft: [], rubOff: [] };
            for (let i = 0; i < 40; i++) Upbringing._growthTick(p, world, kid, out);
            return out.rubOff.length;
        };
        expect(run(100)).toBeGreaterThan(run(0));
    });
});

describe('tutors of flesh and blood', () => {
    it('a known person tutors for wages paid into their own purse; coin is conserved', () => {
        const world = makeWorld(29);
        const p = makePlayer(world);
        const kid = addChild(p, { age: 8 });
        Upbringing.setFocus(p, kid.id, 'martial', world);
        const knight = makeNpc(p, { occupation: 'knight', traits: ['brave', 'serious'] });
        const baker = makeNpc(p, { occupation: 'baker', traits: ['greedy'], firstName: 'Bram' });
        const list = Raising.tutorCandidates(p, world, kid.id);
        expect(list[0].npcId).toBe(knight.id); // the martial teacher first for a martial focus
        expect(list[0].focus).toBe('martial');
        expect(list.find(c => c.npcId === baker.id).focus).toBe('stewardship');

        const before = p.gold + knight.purse;
        const res = Raising.hireTutor(p, world, kid.id, { npcId: knight.id });
        expect(res.success).toBe(true);
        const t = kid.upbringing.tutor;
        expect(t.kind).toBe('person');
        expect(t.quality).toBeGreaterThan(1.3);
        expect(t.seeds.brave).toBeGreaterThan(0); // their temper passes on
        expect(Upbringing.tutorMultiplier(kid.upbringing)).toBe(t.quality);
        expect(knight.purse).toBe(t.wage);
        expect(p.gold + knight.purse).toBe(before);

        live(p, world, 1); // day 30: a month's wage
        expect(knight.purse).toBe(2 * t.wage);
        expect(p.gold + knight.purse).toBe(before);
        expect(kid.upbringing.raising.taught[t.name]).toBe(1);
        expect(kid.upbringing.seeds.brave).toBeGreaterThan(0);

        // Unpaid, they go
        p.gold = 0;
        const notes = live(p, world, 30);
        expect(kid.upbringing.tutor).toBeNull();
        expect(notes.some(n => n.title === 'Tutor Gone')).toBe(true);
    });

    it('a courtier teaches for a share of the wage', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const kid = addChild(p, { age: 8 });
        const sage = makeNpc(p, { occupation: 'scholar', traits: ['scholarly'] });
        const full = Raising.tutorWage(p, sage);
        p.house.court = [{ npcId: sage.id, since: 0, stipend: 4, loyalty: 60 }];
        expect(Court.isMember(p, sage.id)).toBe(true);
        expect(Raising.tutorWage(p, sage)).toBe(Math.max(1, Math.round(full * Raising.config().tutorCourtierShare)));
        const c = Raising.tutorCandidates(p, world, kid.id).find(x => x.npcId === sage.id);
        expect(c.kind).toBe('courtier');
        expect(Raising.hireTutor(p, world, kid.id, { npcId: sage.id }).tutor.courtier).toBe(true);
    });

    it('the masters for hire are paid into the treasury of the realm you stand in', () => {
        const world = makeWorld(29);
        world.getTile = () => ({ kingdom: 'k2' });
        const p = makePlayer(world);
        const kid = addChild(p, { age: 8 });
        const k2 = world.getKingdom('k2');
        const before = p.gold + k2.treasury;
        expect(Upbringing.hireCourtTutor(p, world, kid.id, 'court_scholar').success).toBe(true);
        live(p, world, 1);
        expect(p.gold + k2.treasury).toBe(before);
        expect(k2.treasury).toBeGreaterThan(800);
    });
});

describe('wards at court', () => {
    it('a realm sends a child: its fee from their treasury into your purse, standing, wardmates', () => {
        const world = makeWorld(10);
        const p = makePlayer(world);
        const mine = addChild(p, { age: 9 });
        const k1 = world.getKingdom('k1');
        const res = Raising.takeWard(p, world, 'k1');
        expect(res.success).toBe(true);
        expect(res.ward.firstName).toBe('Piers'); // the real royal child
        expect(k1.characterData.children[0].wardAt).toBeTruthy();
        expect(Raising.takeWard(p, world, 'k1').success).toBe(false); // one per realm
        expect(Raising.takeWard(p, world, 'k2').success).toBe(false); // one seat without Prestige

        const sum = p.gold + k1.treasury;
        const rep = p.reputation.k1;
        live(p, world, 30);
        expect(p.gold + k1.treasury).toBe(sum);
        expect(k1.treasury).toBe(1000 - Raising.config().wards.fee);
        expect(p.reputation.k1).toBe(rep + Raising.config().wards.repPerMonth);
        expect(HeirAgency.ensure(mine).record.wardmates.k1).toBe(1);
    });

    it('goes home in time, remembered; a raised wardmate inherits a friend', () => {
        DataLoader.upbringing.raising.wards.deathChancePerYear = 0;
        const world = makeWorld(10);
        const p = makePlayer(world);
        const mine = addChild(p, { age: 9 });
        Raising.takeWard(p, world, 'k1');
        const notes = live(p, world, Raising.config().wards.years * Y() + 1);
        expect(Raising.wards(p)).toHaveLength(0);
        expect(notes.some(n => n.title === 'A Ward Goes Home')).toBe(true);
        expect(NPCLords.memoryOf(world.getKingdom('k1').lord).map(m => m.key)).toContain('ward_raised');
        expect(p.house.wardHistory[0].how).toBe('raised');
        expect(world.getKingdom('k1').characterData.children[0].wardAt).toBeUndefined();
        const plan = HeirAgency.payoff(p, world, mine);
        expect(plan.lines.some(l => l.icon === '🎓')).toBe(true);
        expect(plan.reputation.k1).toBeGreaterThan(0);
    });

    it('at war the ward is a hostage; freed in the war, the realm is grateful', () => {
        const world = makeWorld(10);
        const p = makePlayer(world);
        Raising.takeWard(p, world, 'k1');
        p.allegiance = 'k2';
        world.kingdoms[0].wars.push('k2');
        const t0 = world.getKingdom('k1').treasury;
        live(p, world, 30);
        const w = Raising.wards(p)[0];
        expect(w.held).toBe(true);
        expect(world.getKingdom('k1').treasury).toBe(t0); // no fee in war
        const rep = p.reputation.k1;
        const res = Raising.sendWardHome(p, world, w.id);
        expect(res.success).toBe(true);
        expect(p.reputation.k1).toBe(rep + Raising.config().wards.warReturnReputation);
    });

    it('a ward who dies at court is a grief their realm remembers', () => {
        DataLoader.upbringing.raising.wards.deathChancePerYear = 1;
        const world = makeWorld(10);
        const p = makePlayer(world);
        Raising.takeWard(p, world, 'k1');
        const rep = p.reputation.k1;
        const notes = live(p, world, Y());
        expect(Raising.wards(p)).toHaveLength(0);
        expect(notes.some(n => n.title === 'A Ward Dies')).toBe(true);
        expect(p.reputation.k1).toBeLessThan(rep);
        expect(NPCLords.memoryOf(world.getKingdom('k1').lord).map(m => m.key)).toContain('ward_died');
    });
});

describe('betrothals and dowries in real coin', () => {
    it('the gift and the rest of the dowry go into their treasury', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const kid = addChild(p, { age: 14 });
        const k2 = world.getKingdom('k2');
        const sum = p.gold + k2.treasury;
        const res = HeirAgency.betroth(p, world, kid.id, 'k2');
        expect(res.success).toBe(true);
        expect(p.gold + k2.treasury).toBe(sum);
        expect(res.betrothal.due).toBe(Heirs.config().allianceDowry - res.cost);
        kid.age = 16;
        live(p, world, 1);
        expect(kid.upbringing.spouse.kingdomId).toBe('k2');
        expect(k2.treasury).toBe(800 + Heirs.config().allianceDowry);
        expect(p.gold + k2.treasury).toBe(sum);
    });

    it('broken by you: they keep the gift, and the House loses Prestige', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        p.house.prestige = 50;
        const kid = addChild(p, { age: 10 });
        HeirAgency.betroth(p, world, kid.id, 'k1');
        const t = world.getKingdom('k1').treasury;
        const res = HeirAgency.breakBetrothal(p, world, kid.id);
        expect(res.success).toBe(true);
        expect(world.getKingdom('k1').treasury).toBe(t);
        expect(p.house.prestige).toBe(50 - Raising.config().betrothal.breakPrestige);
    });

    it('a war that will not end: they break it and send the gift back', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const kid = addChild(p, { age: 8 });
        const res = HeirAgency.betroth(p, world, kid.id, 'k1');
        const sum = p.gold + world.getKingdom('k1').treasury;
        const gold = p.gold;
        p.allegiance = 'k2';
        world.kingdoms[0].wars.push('k2');
        const notes = live(p, world, Raising.config().betrothal.warBreakDays + 1);
        expect(HeirAgency.ensure(kid).betrothal).toBeNull();
        expect(notes.some(n => n.title === 'A Betrothal Ended')).toBe(true);
        expect(p.gold).toBe(gold + res.cost);
        expect(p.gold + world.getKingdom('k1').treasury).toBe(sum);
    });

    it('an alliance match\'s dowry goes into the realm\'s treasury', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const kid = addChild(p, { age: 18 });
        const sum = p.gold + world.getKingdom('k2').treasury;
        expect(Heirs.marryForAlliance(p, world, kid.id, 'k2').success).toBe(true);
        expect(p.gold + world.getKingdom('k2').treasury).toBe(sum);
    });
});

describe('coming of age and succession', () => {
    it('a summary of the childhood is written, and the heir carries it all into the reign', () => {
        const world = makeWorld(0);
        const p = makePlayer(world);
        const heir = addChild(p, { age: 6, firstName: 'Corin', gender: 'male' });
        Upbringing.setFocus(p, heir.id, 'martial', world);
        const knight = makeNpc(p);
        live(p, world, 1);
        expect(Raising.hireTutor(p, world, heir.id, { npcId: knight.id }).success).toBe(true);
        let notes = [];
        while (!heir.upbringing.comeOfAge) {
            Raising.spendTime(p, world, heir.id, heir.age >= 9 ? 'spar' : 'tales');
            notes = notes.concat(live(p, world, 40));
        }
        live(p, world, 1);
        const s = heir.upbringing.raising.summary;
        expect(s).toBeTruthy();
        expect(s.fromAge).toBe(6);
        expect(s.gains.combat).toBeGreaterThan(2);
        expect(s.tutors[0].name).toMatch(/Hild/);
        expect(s.timeCount).toBeGreaterThan(10);
        expect(notes.some(n => /Comes of Age/.test(n.title))).toBe(true);

        const stats = { strength: heir.strength, combat: heir.skills.combat };
        const traits = heir.upbringing.adultTraits.slice();
        const res = Relationships.succeedAsHeir(p, heir.id, world, { cause: 'old age' });
        expect(res.success).toBe(true);
        expect(p.strength).toBe(stats.strength);
        expect(p.skills.combat).toBe(Math.max(1, stats.combat));
        for (const t of traits) expect(Traits.has(p, t)).toBe(true);
        expect(p.upbringingRecord.name).toBe('Corin');
        expect(p.upbringingRecord.grade).toBe(s.grade);
        expect(res.heirEducation.text).toBe(s.text);
    });
});

describe('the panels', () => {
    it('a child\'s page offers time together and real tutors; the wards panel takes a ward', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const world = makeWorld(10);
        const p = makePlayer(world);
        const kid = addChild(p, { age: 10 });
        const knight = makeNpc(p);
        const panels = [];
        const game = {
            player: p, world,
            ui: { showCustomPanel: (title, html) => panels.push({ title, html }), showNotification: () => {}, updateStats: () => {} },
        };
        ActionMenu.showChildPanel(game, kid.id);
        let html = panels.at(-1).html;
        expect(html).toContain('Time Together');
        expect(html).toContain(`window._raisingUI.time('${kid.id}','spar')`);
        expect(html).toContain(`window._raisingUI.hire('${kid.id}','${knight.id}',null)`);
        window._raisingUI.time(kid.id, 'spar');
        expect(Raising.ensure(kid).timeCount).toBe(1);
        window._raisingUI.hire(kid.id, knight.id, null);
        expect(kid.upbringing.tutor.npcId).toBe(knight.id);

        ActionMenu.showHouseWards(game);
        html = panels.at(-1).html;
        expect(html).toContain("window._raisingUI.takeWard('k1')");
        window._raisingUI.takeWard('k1');
        expect(Raising.wards(p)).toHaveLength(1);
        expect(panels.at(-1).html).toContain('Piers');

        // Grown: the coming-of-age summary on the page
        kid.age = 16;
        live(p, world, 1);
        ActionMenu.showChildPanel(game, kid.id);
        expect(panels.at(-1).html).toContain('Coming of Age');
    });
});

describe('save and load', () => {
    it('the bond, a person tutor, the summary and the wards survive a save', () => {
        const game = newGame(5150);
        const { player, world } = game;
        const kid = addChild(player, { age: 10 });
        const kd = world.kingdoms.find(k => k.isAlive && k.id !== player.allegiance);
        player.reputation = { ...(player.reputation || {}), [kd.id]: 30 };
        player.gold = 2000;
        Raising.spendTime(player, world, kid.id, 'tales');
        const npc = makeNpc(player, { occupation: 'priest', traits: ['pious'] });
        expect(Raising.hireTutor(player, world, kid.id, { npcId: npc.id }).success).toBe(true);
        expect(Raising.takeWard(player, world, kd.id).success).toBe(true);
        player.upbringingRecord = { name: 'Bot', grade: 'Well schooled', text: 'x' };
        const bond = Raising.bond(kid);

        const g2 = roundTrip(game);
        const kid2 = g2.player.children.find(c => c.id === kid.id);
        expect(Raising.bond(kid2)).toBe(bond);
        expect(kid2.upbringing.raising.timeCount).toBe(1);
        expect(kid2.upbringing.tutor.kind).toBe('person');
        expect(kid2.upbringing.tutor.npcId).toBe(npc.id);
        expect(Raising.wards(g2.player)).toHaveLength(1);
        expect(Raising.wards(g2.player)[0].kingdomId).toBe(kd.id);
        expect(g2.player.upbringingRecord.grade).toBe('Well schooled');
    });
});
