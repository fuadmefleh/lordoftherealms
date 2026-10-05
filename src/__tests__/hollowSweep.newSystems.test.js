// Hollow-mechanics sweep of the newer systems: each test pins an effect that
// used to be written (or promised) with nothing reading it.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Throne } from '../systems/throne.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Traits } from '../systems/traits.js';
import { Player } from '../player/player.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Economy } from '../world/economy.js';
import { NPCLords } from '../world/npcLords.js';
import { WorldUnit } from '../world/units.js';
import { Holdings } from '../systems/holdings.js';
import { Ships } from '../systems/ships.js';
import { Petitions } from '../systems/petitions.js';
import { Underworld } from '../systems/underworld.js';
import { Rivals } from '../systems/rivals.js';
import { Ailments } from '../systems/ailments.js';
import { Companions } from '../systems/companions.js';
import { Quests } from '../systems/quests.js';
import { Upbringing } from '../systems/upbringing.js';

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
    world.day = 100;
    return world;
}

function makePlayer(world, extra = {}) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 30,
        gold: 20000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [],
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        relationships: {}, actionPoints: 10, army: [],
        ...extra,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    player.house.prestige = 200;
    return player;
}

describe('Throne', () => {
    it('saves the player\'s title (Pretender, Exile, an office) instead of resetting to "Nobody"', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.title = 'Pretender to Somewhere';
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const fresh = new Player({ firstName: 'X', lastName: 'Y' });
        expect(fresh.title).toBe('Nobody');
        Object.assign(fresh, saved);
        expect(fresh.title).toBe('Pretender to Somewhere');
    });

    it('a king who shares the pretender\'s traits leans toward them (lordAffinity in the appeal)', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const k = world.kingdoms.find(x => x.isAlive && x.lord);
        k.lord.traits = [{ id: 'brave' }];
        const without = Throne.appeal(player, world, k).value;
        player.traits = player.traits || { deeds: {}, progress: {}, earned: {}, notices: [] };
        player.traits.earned = { brave: { since: 1 } };
        const withTrait = Throne.appeal(player, world, k);
        const part = withTrait.parts.find(p => p.label === 'Your traits');
        expect(part).toBeTruthy();
        // brave's flat lordOpinion (0) plus the brave king's affinity (+10)
        expect(part.value).toBe(Traits.lordOpinion(player, k.lord));
        expect(withTrait.value).toBeGreaterThan(without);
    });

    it('founding a kingdom counts as a crown won for the House\'s legacy', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        for (const s of world.getAllSettlements().slice(0, 3)) {
            world.getTile(s.q, s.r).settlement.colony = { isPlayerColony: true, loyalty: 60 };
            player.colonies.push({ q: s.q, r: s.r, name: s.name });
        }
        expect(Throne.foundKingdom(player, world, { name: 'Realm of Ash' }).success).toBe(true);
        expect(player.house.stats.crowned).toBe(1);
    });
});

// ── Hand-built worlds for the holdings / rivals / underworld checks ──

function flatWorld(day = 10) {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 16; q++) {
        for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    }
    const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, territory: [], population: 5000, traits: [] };
    return {
        day, width: 16, kingdoms: [kingdom], units: [], events: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
    };
}

function holder(world, extra = {}) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male',
        gold: 10000, renown: 20, karma: 0, reputation: {}, properties: [], colonies: [], children: [],
        inventory: {}, army: [], q: 5, r: 5, taxRate: 'moderate', health: 100, maxHealth: 100,
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        ...extra,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    return player;
}

function ownTown(player, world, q, r, extra = {}) {
    const settlement = {
        name: `Town${q}${r}`, type: 'town', population: 800, level: 1, kingdom: null,
        colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 0 }, ...extra,
    };
    Economy.initSettlement(settlement);
    world.getTile(q, r).settlement = settlement;
    player.colonies.push({ q, r, name: settlement.name, foundedDay: 0 });
    return settlement;
}

describe('Holdings', () => {
    it('a lost holding keeps its walls but its harbour and market stop serving the player', () => {
        const world = flatWorld();
        const player = holder(world);
        const s = ownTown(player, world, 5, 5);
        const h = Holdings.ensure(s);
        h.built = { harbour: 1, market_square: 1, stone_walls: 1 };
        Holdings.processDay(player, world);
        expect(s.holding.fx.port).toBeGreaterThan(0);
        expect(Ships._harbourAt(world, 5, 5)).toBe(true);
        // The town is lost (rebels, a war host...)
        player.colonies = [];
        s.colony.isPlayerColony = false;
        Holdings.processDay(player, world);
        expect(s.holding.lost).toBe(true);
        expect(s.holding.fx.port).toBe(0);
        expect(s.holding.fx.portPrices).toBe(0);
        expect(Economy.holdingFx(s, 'salePrice')).toBe(0);
        expect(Ships._harbourAt(world, 5, 5)).toBe(false);
        expect(s.holding.fx.defense).toBeGreaterThan(0); // the walls still stand
        // Retaken: everything works again
        player.colonies.push({ q: 5, r: 5, name: s.name, foundedDay: 0 });
        s.colony.isPlayerColony = true;
        Holdings.processDay(player, world);
        expect(s.holding.lost).toBe(false);
        expect(s.holding.fx.port).toBeGreaterThan(0);
    });

    it('older saves: a developed town no longer held is marked lost on load', () => {
        const world = flatWorld();
        const player = holder(world);
        const mine = ownTown(player, world, 5, 5);
        const gone = ownTown(player, world, 8, 8);
        Holdings.ensure(mine);
        Holdings.ensure(gone).built = { harbour: 1 };
        Holdings.refresh(gone);
        player.colonies = player.colonies.filter(c => c.q === 5);
        gone.colony.isPlayerColony = false;
        Holdings.loadState(player, world);
        expect(gone.holding.lost).toBe(true);
        expect(gone.holding.fx.port).toBe(0);
    });

    it('a spouse made governor leaves the party, and a governor cannot be invited back', () => {
        const world = flatWorld();
        const player = holder(world);
        ownTown(player, world, 5, 5);
        const spouse = { id: 'sp1', firstName: 'Mira', isAlive: true, traits: [], occupation: 'noble' };
        Relationships._npcs.push(spouse);
        player.spouse = 'sp1';
        player.relationships.sp1 = { score: 90, affection: 90, history: [] };
        player.travelParty = ['sp1'];
        const res = Holdings.appointGovernor(player, world, 5, 5, 'sp1');
        expect(res.success).toBe(true);
        expect(player.travelParty).not.toContain('sp1');
        expect(spouse.governing).toBe('5,5');
        const again = Relationships.requestJoinTravelParty(player, 'sp1', world);
        expect(again.success).toBe(false);
        expect(again.reason).toMatch(/governing/);
        // Relieved: they ride with you again
        Holdings.dismissGovernor(player, world, 5, 5);
        expect(spouse.governing).toBeUndefined();
        expect(player.travelParty).toContain('sp1');
    });

    it('a companion who betrayed you will not rejoin', () => {
        const world = flatWorld();
        const player = holder(world);
        const npc = { id: 'b1', firstName: 'Cole', isAlive: true, traits: [], companion: { leftHow: 'betrayed' } };
        Relationships._npcs.push(npc);
        player.relationships.b1 = { score: 100, affection: 100, history: [] };
        player.travelParty = [];
        expect(Relationships.requestJoinTravelParty(player, 'b1', world).success).toBe(false);
    });

    it('a companion away governing keeps their personal quest', () => {
        const world = flatWorld();
        const player = holder(world);
        Quests.initialize(player);
        player.travelParty = [];
        const gov = { id: 'g1', firstName: 'Tam', isAlive: true, traits: [], governing: '5,5', companion: { quest: { status: 'active', questId: 'x' } } };
        const gone = { id: 'g2', firstName: 'Ula', isAlive: true, traits: [], companion: { quest: { status: 'active', questId: 'y' } } };
        Relationships._npcs.push(gov, gone);
        Companions.processDay(player, world);
        expect(gov.companion.quest.status).toBe('active');
        expect(gone.companion.quest.status).toBe('abandoned');
    });
});

describe('Petitions and governors', () => {
    it('a governor\'s stewardship keeps petitioners waiting longer', () => {
        const world = flatWorld();
        const player = holder(world);
        const s = ownTown(player, world, 5, 5);
        const h = Holdings.ensure(s);
        expect(Petitions._holdingDays(world, { q: 5, r: 5 })).toBe(0);
        h.governor = { kind: 'steward', id: 'st1', name: 'Steward', stewardship: 10, martial: 0, intrigue: 0, loyalty: 60 };
        expect(Petitions._holdingDays(world, { q: 5, r: 5 })).toBe(3);
        h.governor.stewardship = 4;
        expect(Petitions._holdingDays(world, { q: 5, r: 5 })).toBe(1);
    });

    it('config.opinionCap in data/petitions.json caps the court opinion', () => {
        const cfg = DataLoader.petitions.config;
        const old = cfg.opinionCap;
        try {
            cfg.opinionCap = 4;
            const lord = { traits: [{ id: 'honorable' }, { id: 'cautious' }] };
            const player = { petitions: { court: { mercy: 20, severity: -20, justice: 20, piety: 20, generosity: 20 } } };
            expect(NPCLords.courtOpinion(lord, player)).toBe(4);
        } finally {
            cfg.opinionCap = old;
        }
    });
});

describe('Underworld and holdings', () => {
    it('a watchtower and a garrison stiffen the guard in your holding; no search at your own gate', () => {
        const world = flatWorld();
        const player = holder(world);
        const s = ownTown(player, world, 5, 5, { kingdom: 'k1' });
        const before = Underworld.guardStrength(s, world.getKingdom('k1'));
        const h = Holdings.ensure(s);
        h.built = { watchtower: 1 };
        h.garrison = [{ type: 'militia', strength: 5 }, { type: 'militia', strength: 5 }];
        Holdings.refresh(s);
        const after = Underworld.guardStrength(s, world.getKingdom('k1'));
        expect(after).toBeCloseTo(before + 0.4 * 2 + 0.5, 5);

        Underworld.loadState(player);
        Underworld.addHeat(player, 'k1', 90, world);
        const gate = Underworld.onEnterSettlement(player, world, world.getTile(5, 5));
        expect(gate.heat).toBeGreaterThan(0);
        expect(gate.search).toBe(null);
        // Not yours any more: the guard is the realm's again
        h.lost = true;
        Holdings.refresh(s);
        expect(Underworld.guardStrength(s, world.getKingdom('k1'))).toBeCloseTo(before, 5);
    });
});

describe('Rivals', () => {
    function rivalWorld() {
        const world = flatWorld(5);
        world.getTile(5, 5).settlement = { name: 'Tallow', type: 'town', kingdom: 'k1', population: 800 };
        world.getTile(9, 9).settlement = { name: 'Brindle', type: 'capital', kingdom: 'k1', population: 2000 };
        return world;
    }

    it('react once to the traits you earn (and back when you lose them)', () => {
        const world = rivalWorld();
        const player = holder(world);
        Rivals.ensureCast(player, world);
        const rival = Rivals.alive(player)[0];
        rival.archetype = 'crusader';
        rival.attitude = 0;
        player.traits = { deeds: {}, progress: {}, earned: { cruel: { since: 1 } }, notices: [] };
        Rivals._tickTraits(player, world);
        const delta = DataLoader.rivals.archetypes.crusader.traitAttitude.cruel;
        expect(rival.attitude).toBe(delta);
        expect(rival.memory[0].text).toMatch(/cruel/);
        Rivals._tickTraits(player, world); // once only
        expect(rival.attitude).toBe(delta);
        player.traits.earned = {};
        Rivals._tickTraits(player, world);
        expect(rival.attitude).toBe(0);
    });

    it('losing a duel can leave a wound', () => {
        const world = rivalWorld();
        const player = holder(world);
        player.skills.combat = 0;
        player.strength = 1;
        Rivals.ensureCast(player, world);
        const rival = Rivals.alive(player)[0];
        rival.stats.prowess = 50;
        const src = Ailments.cfg().woundSources.duel;
        const old = src.chance;
        try {
            src.chance = 1;
            const res = Rivals._fight(player, world, rival, {});
            expect(res.playerWon).toBe(false);
            expect(res.wound).toBeTruthy();
            expect(Ailments.getState(player).list.some(a => a.kind === 'wound' && a.source === 'duel')).toBe(true);
        } finally {
            src.chance = old;
        }
    });
});

describe('House offices and legacy', () => {
    it('only grown children at home hold offices; the heir may be named young', () => {
        const world = flatWorld();
        const player = holder(world);
        const young = { id: 'c1', firstName: 'Pip', isAlive: true, age: 8, skills: {}, upbringing: { comeOfAge: false } };
        const ward = { id: 'c2', firstName: 'Wren', isAlive: true, age: 18, skills: {}, upbringing: { comeOfAge: true, placement: { kind: 'ward', returned: false } } };
        const grown = { id: 'c3', firstName: 'Bryn', isAlive: true, age: 20, skills: {}, upbringing: { comeOfAge: true } };
        player.children = [young, ward, grown];
        expect(House.assignRole(player, 'marshal', 'c1').success).toBe(false);
        expect(House.assignRole(player, 'steward', 'c2').success).toBe(false);
        expect(House.assignRole(player, 'steward', 'c3').success).toBe(true);
        expect(House.assignRole(player, 'heir', 'c1').success).toBe(true);
        ward.upbringing.placement.returned = true;
        expect(House.assignRole(player, 'chancellor', 'c2').success).toBe(true);
    });

    it('beating a monster counts as a battle won for the House; robbing a caravan does not', () => {
        const world = flatWorld();
        const army = Array.from({ length: 30 }, (_, i) => ({ type: 'knight', name: `K${i}`, strength: 20, level: 3, upkeep: 1, experience: 0 }));
        const player = holder(world, { army, q: 3, r: 3, blessings: {} });
        Utils.setSeed(21);
        const beast = new WorldUnit('monster', 3, 3);
        beast.strength = 1;
        beast.inventory = {};
        expect(PlayerMilitary.attackUnit(player, beast, world).victory).toBe(true);
        expect(player.house.stats.battleWon).toBe(1);
        const caravan = new WorldUnit('caravan', 3, 3);
        caravan.strength = 1;
        caravan.inventory = {};
        expect(PlayerMilitary.attackUnit(player, caravan, world).victory).toBe(true);
        expect(player.house.stats.battleWon).toBe(1);
    });
});

describe('Upbringing: companion tutors follow approval', () => {
    it('an unhappy companion refuses to teach; a tutor\'s quality follows their mood', () => {
        const world = flatWorld(0);
        const player = holder(world);
        const kid = { id: 'k1', firstName: 'Lio', isAlive: true, age: 8, skills: {} };
        player.children = [kid];
        Upbringing.loadState(player);
        const npc = { id: 'n1', firstName: 'Bran', occupation: 'knight', isAlive: true, traits: [], companion: { values: ['honour'], approval: 10 } };
        Relationships._npcs.push(npc);
        player.travelParty = ['n1'];
        expect(Upbringing.hireCompanionTutor(player, world, 'k1', npc).success).toBe(false);
        npc.companion.approval = 50; // Content
        const res = Upbringing.hireCompanionTutor(player, world, 'k1', npc);
        expect(res.success).toBe(true);
        const contentQ = res.tutor.quality;
        expect(contentQ).toBeCloseTo(Upbringing.config().companionMatchQuality, 5);
        // Grown loyal: teaches better at the next growth tick
        npc.companion.approval = 90;
        Upbringing._growthTick(player, world, kid, { tutorsLeft: [], rubOff: [] });
        expect(kid.upbringing.tutor.quality).toBeGreaterThan(contentQ);
        // Soured: stops teaching
        npc.companion.approval = 10;
        const out = { tutorsLeft: [], rubOff: [] };
        Upbringing._growthTick(player, world, kid, out);
        expect(kid.upbringing.tutor).toBe(null);
        expect(out.tutorsLeft[0].text).toMatch(/unhappy/);
    });

    it('the player is told when their traits rub off on a child', async () => {
        const { _reportUpbringing } = await import('../ui/game/endDay.js');
        const shown = [];
        const ctx = { ui: { showNotification: (title, text) => shown.push({ title, text }) }, world: { day: 1 } };
        const kid = { firstName: 'Lio' };
        _reportUpbringing.call(ctx, { rubOff: [{ child: kid, traitId: 'pious' }, { child: kid, traitId: 'brave' }] });
        expect(shown).toHaveLength(1);
        expect(shown[0].text).toMatch(/pious, brave/);
    });
});
