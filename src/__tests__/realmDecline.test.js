// Realm decline (systems/realmDecline.js): the weight of greatness — graft,
// far provinces drifting, heirs born in the purple, guilds and clergy
// entrenched — on the realm the player rules, the countermeasures, and the
// lighter sag of old big AI realms.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Economy } from '../world/economy.js';
import { KingdomStability } from '../world/kingdomState.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Councils } from '../systems/councils.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { HeirPaths } from '../systems/heirPaths.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { RealmDecline } from '../systems/realmDecline.js';

const Y = 120;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(seed = 11) {
    Utils.setSeed(seed);
    const world = new World(40, 30);
    world.generate({ kingdomCount: 4 });
    world.day = 98;
    // (every town keeps a purse, as in a running game)
    for (const v of world.getSettlementViews()) {
        const t = world.getTile(v.q, v.r);
        if (t && t.settlement && !t.settlement.economy) Economy.initSettlement(t.settlement);
    }
    return world;
}

function makePlayer(world) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 30,
        gold: 20000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [],
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        relationships: {}, actionPoints: 10, army: [],
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    player.house.prestige = 300;
    return player;
}

function biggest(world) {
    const all = world.getAllSettlements();
    const count = k => all.filter(s => s.kingdom === k.id).length;
    return world.kingdoms.filter(k => k.isAlive).sort((a, b) => count(b) - count(a))[0];
}

/** A crowned player whose court has opened. */
function crowned(seed = 11) {
    const world = makeWorld(seed);
    const player = makePlayer(world);
    const k = biggest(world);
    Throne._takeThrone(player, world, k);
    k.treasury = 50000;
    Kingship.processDay(world, player);
    return { world, player, k, court: Kingship.court(player) };
}

/** Run `weeks` weekly decline ticks (days kept on the cadence). */
function weeks(world, player, n) {
    for (let i = 0; i < n; i++) {
        world.day = Math.ceil((world.day + 1) / 7) * 7;
        RealmDecline.processDay(world, player);
    }
}

/** Sum of every town purse in the world plus every realm's treasury. */
function coin(world) {
    let s = 0;
    for (const v of world.getSettlementViews()) {
        const t = world.getTile(v.q, v.r);
        if (t && t.settlement && t.settlement.economy) s += Number(t.settlement.economy.gold) || 0;
    }
    for (const k of world.kingdoms) s += Number(k.treasury) || 0;
    return Math.round(s * 100) / 100;
}

function kidOf(player, extra = {}) {
    const child = { id: `c${player.children.length + 1}`, firstName: 'Edric', gender: 'male', age: 15, isAlive: true, skills: { combat: 3, leadership: 3 }, ...extra };
    player.children.push(child);
    Upbringing.ensure(child);
    return child;
}

describe('Realm decline data', () => {
    it('is registered with four strains and the measures', () => {
        const C = RealmDecline.config();
        expect(DataLoader._gamedata.realmDecline).toBeTruthy();
        for (const id of RealmDecline.STRAINS) expect(C.strains[id].label, id).toBeTruthy();
        for (const id of [...RealmDecline.MEASURES, 'marchCommand']) expect(C.measures[id].label, id).toBeTruthy();
        expect(HeirPaths.kind('march')).toBeTruthy();
    });
});

describe('The strains of the realm the player rules', () => {
    it('climb slowly — years, not weeks — and faster the older the reign', () => {
        const { world, player } = crowned();
        weeks(world, player, 17);
        const st = RealmDecline.state(player);
        const oneYear = { ...st.strains };
        for (const id of RealmDecline.STRAINS) expect(oneYear[id], id).toBeLessThan(40);
        // Forty years on the throne
        player.throne.ruling.since = world.day - 40 * Y;
        const P = RealmDecline.pressures(player, world, Throne.ruledKingdom(player, world));
        expect(P.graft.value).toBeGreaterThan(oneYear.graft);
        expect(P.graft.parts.some(p => /years of your House/.test(p.label))).toBe(true);
        weeks(world, player, 17 * 15);
        expect(st.strains.graft).toBeGreaterThan(oneYear.graft + 10);
        expect(st.strains.soft).toBeGreaterThan(oneYear.soft + 10);
        expect(st.history.length).toBeGreaterThan(1);
    });

    it('draws no shared RNG', () => {
        const { world, player } = crowned();
        Utils.setSeed(4242);
        weeks(world, player, 30);
        const a = Utils.random();
        Utils.setSeed(4242);
        expect(Utils.random()).toBe(a);
    });

    it('graft skims the treasury into real purses, coin for coin', () => {
        const { world, player, k } = crowned();
        const st = RealmDecline.state(player);
        st.kingdomId = k.id;
        st.strains.graft = 80;
        const before = coin(world);
        const t0 = k.treasury;
        world.day = Math.ceil((world.day + 1) / 7) * 7;
        RealmDecline._graftWeek(world, player, st, k, Kingship.court(player), RealmDecline.bite(80), 7);
        expect(k.treasury).toBeLessThan(t0);
        expect(coin(world)).toBeCloseTo(before, 1);
        expect(st.stats.graftTotal).toBeCloseTo(t0 - k.treasury, 1);
        expect(Object.keys(st.takers).length).toBeGreaterThan(0);
    });

    it('an audit costs coin, recovers part of the skim, cuts graft, and has a cooldown', () => {
        const { world, player, k } = crowned();
        const st = RealmDecline.state(player);
        st.kingdomId = k.id;
        const court = Kingship.court(player);
        for (let i = 0; i < 10; i++) RealmDecline._graftWeek(world, player, st, k, court, 1, 7);
        st.strains.graft = 75;
        const before = coin(world);
        const res = RealmDecline.audit(player, world);
        expect(res.success).toBe(true);
        expect(res.recovered).toBeGreaterThan(0);
        expect(st.strains.graft).toBeLessThan(40);
        expect(coin(world)).toBeCloseTo(before, 1);
        expect(RealmDecline.audit(player, world).success).toBe(false);
    });

    it('far lords drift: an opinion term Kingship reads, and the crown\'s taxes fall', () => {
        const { world, player, k, court } = crowned();
        const st = RealmDecline.state(player);
        st.kingdomId = k.id;
        // A lord seated far away
        const v = court.vassals.find(x => x.seat) || court.vassals[0];
        v.seat = { q: (k.capital.q + 20) % world.width, r: k.capital.r, name: 'Farhold' };
        const P = { farShare: 0.5 };
        RealmDecline._driftWeek(world, player, st, k, court, [], 0.8, P, { notices: [] });
        expect(v.drift).toBeGreaterThan(0);
        expect(Kingship.opinion(player, world, v).parts.some(p => p.label === 'Far from the crown')).toBe(true);
        Kingship.computeMods(player, world);
        expect(court.mods.tax).toBeLessThan(0);
    });

    it('entrenched guilds and clergy make edicts dearer and the factions slower', () => {
        const { world, player, k, court } = crowned();
        const def = Kingship.edicts().road_programme;
        const base = Kingship._passCost(def, court);
        court.declineFx = { edictCost: 1.8, edictUpkeep: 1.5, factionMove: 0.4, factions: ['merchants', 'clergy'] };
        expect(Kingship._passCost(def, court)).toBe(Math.round(base * 1.8));
        court.edicts.road_programme = { since: world.day };
        expect(Kingship.upkeep(player)).toBeCloseTo((def.upkeep || 0) * 1.5, 5);
        const fac = Councils._ensureState(player).factions;
        fac.merchants.support = 50;
        fac.nobility.support = 50;
        Kingship._shiftFactions(player, { merchants: 10, nobility: 10 }, 1);
        expect(fac.merchants.support).toBeCloseTo(54, 5);
        expect(fac.nobility.support).toBeCloseTo(60, 5);
        expect(k.id).toBeTruthy();
    });

    it('stability feels it through kingdom.decline (Weight of greatness)', () => {
        const { world, player, k } = crowned();
        const st = RealmDecline.state(player);
        for (const id of RealmDecline.STRAINS) st.strains[id] = 0;
        st.kingdomId = k.id;
        player.throne.ruling.since = world.day - 60 * Y;
        weeks(world, player, 17 * 25);
        expect(k.decline.stab).toBeLessThan(0);
        expect(KingdomStability.target(k, world).parts.some(p => p.label === 'Weight of greatness')).toBe(true);
    });
});

describe('Countermeasures', () => {
    it('a purge seizes the skim, cuts graft and entrenchment, and every lord takes a grudge', () => {
        const { world, player, k, court } = crowned();
        const st = RealmDecline.state(player);
        st.kingdomId = k.id;
        st.strains.graft = 70;
        st.strains.entrench = 70;
        k.stability = 60;
        const g0 = court.vassals.map(v => v.grudge || 0);
        const stab0 = k.stability;
        const pr0 = House.getPrestige(player);
        const res = RealmDecline.purge(player, world);
        expect(res.success).toBe(true);
        expect(st.strains.graft).toBe(40);
        expect(st.strains.entrench).toBe(30);
        court.vassals.forEach((v, i) => expect(v.grudge).toBeLessThan(g0[i]));
        expect(k.stability).toBeLessThan(stab0);
        expect(House.getPrestige(player)).toBeLessThan(pr0);
    });

    it('moving the capital to a more central town pays its builders and leaves the old court behind', () => {
        const { world, player, k } = crowned();
        const st = RealmDecline.state(player);
        st.kingdomId = k.id;
        st.strains.entrench = 60;
        const c = RealmDecline.capitalCandidates(player, world)[0];
        if (!c) return; // (a realm whose capital is already its heart)
        const before = coin(world);
        const res = RealmDecline.moveCapital(player, world, c.q, c.r);
        expect(res.success).toBe(true);
        expect(k.capital).toEqual({ q: c.q, r: c.r });
        expect(st.strains.entrench).toBe(25);
        expect(coin(world)).toBeCloseTo(before, 1);
    });

    it('reorganising the provinces needs far towns and cuts the drift', () => {
        const { world, player, k } = crowned();
        const st = RealmDecline.state(player);
        st.kingdomId = k.id;
        st.strains.drift = 60;
        const can = RealmDecline.can(player, world, 'reorganise');
        if (!can.ok) { expect(can.reason).toBeTruthy(); return; }
        const res = RealmDecline.reorganise(player, world);
        expect(res.success).toBe(true);
        expect(st.strains.drift).toBe(25);
    });
});

describe('Heirs born in the purple', () => {
    it('a child raised at a court in decline comes of age soft; one raised away does not', () => {
        const { world, player } = crowned();
        const st = RealmDecline.state(player);
        st.purple = { bite: 1, seeds: { craven: 4, drunkard: 3, greedy: 3, brave: -4 }, skillLoss: { combat: 1 } };
        const soft = kidOf(player);
        Upbringing.comeOfAge(player, world, soft);
        expect(soft.upbringing.adultTraits).toContain('craven');
        expect(soft.upbringing.purple).toBe(100);
        expect(soft.skills.combat).toBe(2);
        const hard = kidOf(player, { firstName: 'Aldo' });
        hard.upbringing.pathRecord = [{ kind: 'march', how: 'completed' }];
        Upbringing.comeOfAge(player, world, hard);
        expect(hard.upbringing.adultTraits).not.toContain('craven');
        expect(RealmDecline.purpleFor(player, hard)).toBe(0);
    });

    it('a march command hardens a grown soft heir in two years', () => {
        const { world, player } = crowned();
        const st = RealmDecline.state(player);
        st.purple = { bite: 1, seeds: { craven: 4, drunkard: 3 }, skillLoss: {} };
        const c = kidOf(player, { age: 18 });
        Upbringing.comeOfAge(player, world, c);
        expect(c.upbringing.adultTraits).toContain('craven');
        const gold = player.gold;
        const res = RealmDecline.marchCommand(player, world, c.id);
        expect(res.success).toBe(true);
        expect(player.gold).toBeLessThan(gold);
        expect(RealmDecline.marchCommand(player, world, c.id).success).toBe(false);
        weeks(world, player, 17 * 2 + 2);
        expect(c.upbringing.adultTraits).not.toContain('craven');
        expect(c.upbringing.adultTraits).toContain('brave');
        expect(c.upbringing.hardened).toBe(true);
    });

    it('a child of 10–14 can be sent to a march-warden in the realm\'s far towns', () => {
        const { world, player } = crowned();
        const child = kidOf(player, { age: 11 });
        const venues = HeirPaths.venues(player, world, 'march', child);
        expect(venues.length).toBeGreaterThan(0);
        expect(venues[0].payee.type).toBe('town');
    });
});

describe('AI realms sag too', () => {
    it('an old big realm sags over decades, skims coin into its capital, and the tick runs with no player', () => {
        const world = makeWorld(11);
        const k = biggest(world);
        k.treasury = 20000;
        const before = coin(world);
        for (let i = 0; i < 17 * 60; i++) {
            world.day += 7;
            RealmDecline.processDay(world, null);
        }
        expect(k.decline.s).toBeGreaterThan(20);
        expect(coin(world)).toBeCloseTo(before, 0);
        const s = RealmDecline.aiStanding(k);
        expect(s && s.label).toBeTruthy();
    });
});

describe('Save and load', () => {
    it('keeps the player\'s strains and each realm\'s decline', () => {
        const { world, player, k } = crowned();
        weeks(world, player, 20);
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('realmDecline');
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializeKingdoms([k])[0]));
        expect(saved.decline).toBeTruthy();
        expect(JSON.parse(JSON.stringify(player.realmDecline)).strains.graft).toBe(player.realmDecline.strains.graft);
    });
});

describe('The State of the Realm read-out', () => {
    it('reports each strain with its trend, causes, effects and measures', () => {
        const { world, player } = crowned();
        weeks(world, player, 20);
        const r = RealmDecline.report(player, world);
        expect(r.strains).toHaveLength(4);
        for (const s of r.strains) expect(s.effects.length).toBeGreaterThan(0);
        expect(r.strains[0].parts.length).toBeGreaterThan(0);
        expect(r.measures.map(m => m.id)).toEqual(RealmDecline.MEASURES);
        expect(RealmDecline.report(makePlayer(world), world)).toBeNull();
    });
});

describe('The State of the Realm tab', () => {
    it('renders a card per strain with its measures', async () => {
        const { stateOfRealmHtml } = await import('../ui/actionMenu/realmDecline.js');
        const { world, player } = crowned();
        weeks(world, player, 20);
        const html = stateOfRealmHtml({ player, world, ui: {} });
        for (const id of RealmDecline.STRAINS) expect(html).toContain(RealmDecline.strainDef(id).label);
        expect(html).toContain('Audit the treasury');
        expect(html).toContain('Move the capital');
    });
});
