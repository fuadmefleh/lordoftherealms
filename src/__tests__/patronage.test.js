// Patronage & Great Works (systems/patronage.js): clients from a town's salon,
// commissions and their effects, stipends, neglect and rival Houses poaching;
// Great Works in stages with deliveries, labour, stalls and completion
// effects read by the other systems; the kingdoms' race for wonders; save and
// load; determinism (no RNG drawn).

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Patronage } from '../systems/patronage.js';
import { House } from '../systems/house.js';
import { Legacy } from '../systems/legacy.js';
import { Deeds } from '../systems/deeds.js';
import { Technology } from '../systems/technology.js';
import { Ailments } from '../systems/ailments.js';
import { Festivals } from '../systems/festivals.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Taxation } from '../systems/marketDynamics.js';
import { Heralds } from '../systems/heralds.js';
import { Counsel } from '../systems/counsel.js';
import { Achievements } from '../systems/achievements.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { KingdomStability } from '../world/kingdomState.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let saved = null;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    await loadData();
    saved = JSON.parse(JSON.stringify(DataLoader.patronage));
});

afterEach(() => {
    DataLoader.patronage = JSON.parse(JSON.stringify(saved));
    Utils.resetRng();
});

/** Tweak the data for one test (restored after each). */
function tune(fn) {
    fn(DataLoader.patronage);
}

const PLAINS = { id: 'plains', passable: true, moveCost: 1 };
const OCEAN = { id: 'ocean', passable: false, moveCost: Infinity };

/**
 * A small hand-built world: an ocean column at q=0, Ashford (a town, river
 * beside it) at (3,3), Brookby (a village) at (6,6), Saltmere (a coastal town)
 * at (1,5), Kingsport (capital of k2) at (8,3). Kingdom k1 holds the first three.
 */
function makeWorld(seed = 1, day = 10) {
    const W = 12;
    const H = 10;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: q === 0 ? OCEAN : PLAINS, explored: true });
        tiles.push(row);
    }
    const place = (q, r, s) => { tiles[r][q].settlement = { q, r, ...s }; tiles[r][q].kingdom = s.kingdom; };
    place(3, 3, { name: 'Ashford', type: 'town', population: 2400, kingdom: 'k1', happiness: 50 });
    place(6, 6, { name: 'Brookby', type: 'village', population: 300, kingdom: 'k1' });
    place(1, 5, { name: 'Saltmere', type: 'town', population: 1800, kingdom: 'k1' });
    place(8, 3, { name: 'Kingsport', type: 'capital', population: 6000, kingdom: 'k2' });
    tiles[4][3].hasRiver = true;
    const kingdoms = [
        { id: 'k1', name: 'Avaria', isAlive: true, capital: { q: 3, r: 3 }, treasury: 30000, wars: [], stability: 60 },
        { id: 'k2', name: 'Belmor', isAlive: true, capital: { q: 8, r: 3 }, treasury: 30000, wars: [], stability: 60 },
    ];
    return {
        width: W, height: H, day, tiles, kingdoms, activeEvents: [],
        generationParams: { seed },
        getTile(q, r) { return (tiles[r] && tiles[r][q]) || null; },
        getKingdom(id) { return kingdoms.find(k => k.id === id) || null; },
        getAllSettlements() { return tiles.flat().filter(t => t.settlement).map(t => t.settlement); },
    };
}

function makePlayer(world, extra = {}) {
    const player = { name: 'Aldric Vane', lastName: 'Vane', q: 3, r: 3, gold: 50000, inventory: {}, renown: 0, reputation: {},
        settlements: [{ q: 3, r: 3 }, { q: 6, r: 6 }, { q: 1, r: 5 }], ...extra };
    House.initialize(player, world);
    return player;
}

function tick(world, player, days = 1) {
    const outs = [];
    for (let i = 0; i < days; i++) {
        world.day++;
        outs.push(Patronage.processDay(world, player));
    }
    return outs;
}

const tileOf = (world, q, r) => world.getTile(q, r);

function hireOf(player, world, profession, q = 3, r = 3) {
    // Search the coming months' salons for someone of this profession
    const day0 = world.day;
    for (let m = 0; m < 24; m++) {
        world.day = day0 + m * 30;
        const cand = Patronage.salon(player, world, tileOf(world, q, r)).find(c => c.profession === profession);
        if (cand) {
            const res = Patronage.hire(player, world, tileOf(world, q, r), cand.id);
            world.day = day0;
            expect(res.success).toBe(true);
            return res.client;
        }
    }
    world.day = day0;
    throw new Error(`no ${profession} found`);
}

// ─────────────────────────────────────────────────────────────

describe('the salon and hiring', () => {
    it('offers the same candidates for the same town and month, new ones next month, none in a village', () => {
        const world = makeWorld(7);
        const player = makePlayer(world);
        const a = Patronage.salon(player, world, tileOf(world, 3, 3));
        const b = Patronage.salon(player, makeWorld(7), tileOf(world, 3, 3));
        expect(a.length).toBe(3);
        expect(a).toEqual(b);
        world.day += 30;
        const c = Patronage.salon(player, world, tileOf(world, 3, 3));
        expect(c.map(x => x.id)).not.toEqual(a.map(x => x.id));
        expect(Patronage.salon(player, world, tileOf(world, 6, 6))).toEqual([]);
        for (const cand of a) {
            expect(Patronage.professions()[cand.profession]).toBeTruthy();
            expect(cand.skill).toBeGreaterThanOrEqual(1);
            expect(cand.skill).toBeLessThanOrEqual(10);
            expect(cand.stipend).toBeGreaterThan(0);
            expect(cand.name.length).toBeGreaterThan(2);
        }
    });

    it('hiring costs a fee, adds the client, and takes them out of the salon; the cap holds', () => {
        const world = makeWorld(3);
        const player = makePlayer(world);
        const cand = Patronage.salon(player, world, tileOf(world, 3, 3))[0];
        const gold = player.gold;
        const res = Patronage.hire(player, world, tileOf(world, 3, 3), cand.id);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold - Patronage.hireFee(cand));
        expect(Patronage.state(player).clients).toHaveLength(1);
        expect(Patronage.salon(player, world, tileOf(world, 3, 3)).some(c => c.id === cand.id)).toBe(false);
        expect(Patronage.hire(player, world, tileOf(world, 3, 3), cand.id).success).toBe(false);
        tune(d => { d.config.maxClients = 1; });
        const next = Patronage.salon(player, world, tileOf(world, 3, 3))[0];
        const capped = Patronage.hire(player, world, tileOf(world, 3, 3), next.id);
        expect(capped.success).toBe(false);
        expect(capped.reason).toMatch(/at most/);
    });
});

describe('commissions and what they make', () => {
    it('a painting takes materials from the packs, takes days, earns Prestige and goes to the gallery', () => {
        const world = makeWorld(11);
        const player = makePlayer(world, { inventory: { dyes: 5 } });
        const c = hireOf(player, world, 'artist');
        const res = Patronage.commission(player, world, c.id, 'painting');
        expect(res.success).toBe(true);
        expect(player.inventory.dyes).toBe(3);
        const before = player.house.prestige;
        const days = c.task.days;
        tick(world, player, days - 1);
        expect(Patronage.state(player).gallery).toHaveLength(0);
        const out = tick(world, player, 1)[0];
        expect(out.notices.some(n => /Painting Finished|Masterpiece/.test(n.title))).toBe(true);
        const st = Patronage.state(player);
        expect(st.gallery).toHaveLength(1);
        expect(st.stats.works).toBe(1);
        expect(player.house.prestige).toBeGreaterThan(before);
        expect(c.task).toBe(null);
    });

    it('materials the packs lack are bought at a markup', () => {
        const world = makeWorld(11);
        const player = makePlayer(world);
        const c = hireOf(player, world, 'artist');
        const gold = player.gold;
        expect(Patronage.commission(player, world, c.id, 'sculpture').success).toBe(true);
        expect(gold - player.gold).toBe(8 * Patronage.unitPrice('stone'));
        expect(Patronage.unitPrice('stone')).toBeGreaterThan(8);
    });

    it('a treatise pushes the current research forward, and banks what it cannot use', () => {
        const world = makeWorld(12);
        const player = makePlayer(world, { inventory: { parchment: 10 } });
        Technology.initPlayer(player);
        player.technology.currentResearch = { techId: 'x', progress: 0, totalDays: 4, startDay: 0 };
        const c = hireOf(player, world, 'scholar');
        Patronage.commission(player, world, c.id, 'treatise');
        tick(world, player, c.task.days);
        const st = Patronage.state(player);
        expect(st.stats.treatises).toBe(1);
        // Never the final day: completion stays with Technology.processResearch
        expect(player.technology.currentResearch.progress).toBe(3);
        expect(st.scholarship).toBeGreaterThan(0);
        // The banked days go into the next research, a day at a time
        player.technology.currentResearch = { techId: 'y', progress: 0, totalDays: 30, startDay: 0 };
        const bank = st.scholarship;
        tick(world, player, 2);
        expect(player.technology.currentResearch.progress).toBe(2);
        expect(st.scholarship).toBe(bank - 2);
    });

    it('medical texts make sickness less deadly (Ailments.careFactor) and wounds mend faster', () => {
        const world = makeWorld(13);
        const player = makePlayer(world, { inventory: { herbs: 20, parchment: 10 } });
        const base = Ailments.careFactor(player, world).mult;
        const c = hireOf(player, world, 'physician');
        Patronage.commission(player, world, c.id, 'medical_text');
        tick(world, player, c.task.days);
        expect(Patronage.fx(player, 'care')).toBeLessThan(1);
        expect(Patronage.fx(player, 'woundHeal')).toBeGreaterThan(0);
        const care = Ailments.careFactor(player, world);
        expect(care.mult).toBeLessThan(base);
        expect(care.parts.join(' ')).toMatch(/physicians/);
    });

    it('a chronicle writes the House chronicle and scores in its Legacy', () => {
        const world = makeWorld(14);
        const player = makePlayer(world, { inventory: { parchment: 10 } });
        Legacy.ensure(player, world);
        const scoreBefore = Legacy.summarize(player, world).score;
        const c = hireOf(player, world, 'chronicler');
        Patronage.commission(player, world, c.id, 'chronicle');
        tick(world, player, c.task.days);
        expect(player.house.stats.chronicle).toBeGreaterThanOrEqual(1);
        expect(player.house.history.some(h => (h.tags || []).includes('chronicle'))).toBe(true);
        const rec = Legacy.summarize(player, world);
        expect(rec.chronicles).toBeGreaterThanOrEqual(1);
        expect(rec.score).toBeGreaterThan(scoreBefore);
    });

    it('a donated work lifts a holding\'s happiness target, or wins standing with a foreign realm', () => {
        const world = makeWorld(15);
        const player = makePlayer(world, { inventory: { dyes: 10 } });
        const c = hireOf(player, world, 'artist');
        Patronage.commission(player, world, c.id, 'painting');
        tick(world, player, c.task.days);
        Patronage.commission(player, world, c.id, 'painting');
        tick(world, player, c.task.days);
        const [g1, g2] = Patronage.state(player).gallery;
        const ashford = tileOf(world, 3, 3);
        expect(Taxation.patronageMood(ashford.settlement)).toBe(0);
        expect(Patronage.donate(player, world, ashford, g1.uid).success).toBe(true);
        expect(Taxation.patronageMood(ashford.settlement)).toBeGreaterThan(0);
        // The weekly mood drift aims higher
        const entry = {};
        const s2 = { ...ashford.settlement, happiness: 50 };
        Taxation._applyTaxMood(s2, { happinessBonus: 0, growthBonus: 0 }, entry);
        const s3 = { ...ashford.settlement, patronage: null, happiness: 50 };
        Taxation._applyTaxMood(s3, { happinessBonus: 0, growthBonus: 0 }, {});
        expect(s2.happiness).toBeGreaterThan(s3.happiness);
        // Abroad: standing with the realm
        player.q = 8; player.r = 3;
        const res = Patronage.donate(player, world, tileOf(world, 8, 3), g2.uid);
        expect(res.success).toBe(true);
        expect(player.reputation.k2).toBeGreaterThan(0);
        expect(Patronage.donate(player, world, tileOf(world, 8, 3), g2.uid).success).toBe(false);
    });
});

describe('stipends, neglect and departures', () => {
    it('the stipend is paid weekly; three unpaid weeks and the client leaves', () => {
        const world = makeWorld(21);
        const player = makePlayer(world);
        const c = hireOf(player, world, 'scholar');
        const gold = player.gold;
        tick(world, player, 7);
        expect(player.gold).toBe(gold - c.stipend);
        player.gold = 0;
        tick(world, player, 21);
        expect(Patronage.state(player).clients).toHaveLength(0);
        expect(Patronage.state(player).stats.left).toBe(1);
    });

    it('an idle client sours; a busy one does not', () => {
        const world = makeWorld(22);
        const player = makePlayer(world, { inventory: { parchment: 30 } });
        const idle = hireOf(player, world, 'scholar');
        const start = idle.content;
        tick(world, player, 40);
        expect(idle.content).toBeLessThan(start);
        const world2 = makeWorld(22);
        const player2 = makePlayer(world2, { inventory: { parchment: 30 } });
        const busy = hireOf(player2, world2, 'scholar');
        Patronage.commission(player2, world2, busy.id, 'treatise');
        tick(world2, player2, 20);
        expect(busy.content).toBeGreaterThanOrEqual(start);
    });
});

describe('rival Houses poach clients', () => {
    function poachSetup(seed) {
        tune(d => { d.config.poach.base = 1; d.config.poach.cadence = 1; });
        const world = makeWorld(seed);
        const player = makePlayer(world);
        player.house.rivals = { k2: { kingdomId: 'k2', name: 'House Belmor', feud: 10, lastActedDay: 0 } };
        const c = hireOf(player, world, 'artist');
        const out = tick(world, player, 1)[0];
        return { world, player, c, out };
    }

    it('a rival makes an offer; matching it keeps the client at a higher stipend', () => {
        const { world, player, c, out } = poachSetup(31);
        const st = Patronage.state(player);
        expect(st.offers).toHaveLength(1);
        expect(out.notices.some(n => n.title === 'A Rival Offer')).toBe(true);
        const offer = st.offers[0];
        const gold = player.gold;
        const stipend = c.stipend;
        const res = Patronage.answerOffer(player, world, c.id, 'match');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold - offer.counter);
        expect(c.stipend).toBeGreaterThan(stipend);
        expect(st.offers).toHaveLength(0);
        expect(st.stats.matched).toBe(1);
    });

    it('letting them go loses the client to the rival and inflames the feud', () => {
        const { world, player, c } = poachSetup(32);
        const feud = player.house.rivals.k2.feud;
        Patronage.answerOffer(player, world, c.id, 'release');
        const st = Patronage.state(player);
        expect(st.clients).toHaveLength(0);
        expect(st.stats.poached).toBe(1);
        expect(player.house.rivals.k2.feud).toBeGreaterThan(feud);
        expect(Deeds.collect(player)['patronage.poached']).toBe(1);
    });

    it('an unanswered offer is decided by the client on its due day', () => {
        const { world, player } = poachSetup(33);
        // No further rival: only the pending offer remains to be decided
        player.house.rivals = {};
        const st = Patronage.state(player);
        const due = st.offers[0].dueDay;
        tick(world, player, due - world.day);
        expect(st.offers).toHaveLength(0);
        expect(st.stats.poached + (st.clients.length ? 1 : 0)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────

/** Supply and build every stage of a work at Ashford, returning the day's outs. */
function buildAll(world, player, projectId, guard = 1000) {
    const outs = [];
    for (let i = 0; i < guard; i++) {
        const p = Patronage.project(player, projectId);
        if (!p) break;
        if (p.status === 'supplying') expect(Patronage.deliver(player, world, p.id, { buyMissing: true }).success).toBe(true);
        outs.push(...tick(world, player, 1));
    }
    return outs;
}

describe('Great Works: founding', () => {
    it('only at a holding or seat, sized and placed for the work', () => {
        const world = makeWorld(41);
        const player = makePlayer(world);
        expect(Patronage.canFound(player, world, 8, 3, 'cathedral').reason).toMatch(/rule this town/);
        expect(Patronage.canFound(player, world, 6, 6, 'cathedral').reason).toMatch(/town or larger/);
        expect(Patronage.canFound(player, world, 3, 3, 'colossus').reason).toMatch(/harbour/);
        expect(Patronage.canFound(player, world, 1, 5, 'colossus').ok).toBe(true);
        expect(Patronage.canFound(player, world, 1, 5, 'grand_bridge').reason).toMatch(/river/);
        expect(Patronage.canFound(player, world, 3, 3, 'grand_bridge').ok).toBe(true);
        // A house in a foreign town is a seat
        player.houses = [{ q: 8, r: 3 }];
        expect(Patronage.canFound(player, world, 8, 3, 'cathedral').ok).toBe(true);
        expect(Patronage.found(player, world, 3, 3, 'cathedral').success).toBe(true);
        expect(Patronage.canFound(player, world, 3, 3, 'university').reason).toMatch(/already rising/);
        expect(Patronage.found(player, world, 1, 5, 'colossus').success).toBe(true);
        expect(Patronage.canFound(player, world, 8, 3, 'university').reason).toMatch(/at most/);
    });
});

describe('Great Works: stages, labour and stalls', () => {
    it('a stage waits for goods and gold; packs deliver on site, the rest is bought; labour costs wages daily', () => {
        const world = makeWorld(42);
        const player = makePlayer(world, { inventory: { stone: 30, wood: 5 } });
        const p = Patronage.found(player, world, 3, 3, 'university').project;
        tick(world, player, 3);
        expect(p.progress).toBe(0);
        const r1 = Patronage.deliver(player, world, p.id);
        expect(r1.success).toBe(true);
        expect(player.inventory.stone).toBeUndefined();
        expect(p.delivered.stone).toBe(30);
        expect(p.status).toBe('supplying');
        expect(p.goldPaid).toBe(true);
        const r2 = Patronage.deliver(player, world, p.id, { buyMissing: true });
        expect(r2.success).toBe(true);
        expect(p.status).toBe('building');
        const gold = player.gold;
        tick(world, player, 5);
        expect(p.progress).toBeGreaterThanOrEqual(5);
        const stage = Patronage.stageDef(p);
        expect(gold - player.gold).toBe(5 * stage.labour);
    });

    it('stalls: winter for outdoor stages, famine, siege, unpaid wages, a lost site; war slows it', () => {
        const world = makeWorld(43);
        const player = makePlayer(world);
        const p = Patronage.found(player, world, 3, 3, 'university').project;
        Patronage.deliver(player, world, p.id, { buyMissing: true });
        const cond = () => Patronage.conditions(player, world, p);
        expect(cond().stall).toBe(null);
        world.day = 95; // winter
        expect(cond().stall).toBe('winter');
        const before = p.progress;
        tick(world, player, 2);
        expect(p.progress).toBe(before);
        expect(p.stall).toBe('winter');
        world.day = 20;
        world.activeEvents = [{ id: 'famine', kingdomId: 'k1', effects: { farmProduction: -0.5 } }];
        expect(cond().stall).toBe('famine');
        world.activeEvents = [];
        player.realmWars = { wars: {}, besieged: { '3,3': { q: 3, r: 3 } } };
        expect(cond().stall).toBe('siege');
        player.realmWars = { wars: { k2: { kingdomId: 'k2' } } };
        const atWar = cond();
        expect(atWar.stall).toBe(null);
        player.realmWars = null;
        expect(atWar.speed).toBeLessThan(cond().speed);
        const gold = player.gold;
        player.gold = 1;
        expect(cond().stall).toBe('unpaid');
        const out = tick(world, player, 1)[0];
        expect(out.notices.some(n => n.title === 'Great Work Stalled')).toBe(true);
        expect(player.gold).toBe(1);
        player.gold = gold;
        player.settlements = [];
        expect(cond().stall).toBe('lost');
    });

    it('an architect speeds the labour by skill', () => {
        const world = makeWorld(44);
        const player = makePlayer(world);
        const p = Patronage.found(player, world, 3, 3, 'university').project;
        Patronage.deliver(player, world, p.id, { buyMissing: true });
        const plain = Patronage.conditions(player, world, p).speed;
        const arch = hireOf(player, world, 'architect');
        expect(Patronage.assignArchitect(player, world, arch.id, p.id).success).toBe(true);
        expect(Patronage.conditions(player, world, p).speed).toBeCloseTo(plain * (1 + 0.05 * arch.skill), 5);
        // An overseeing architect is busy, not idle
        tick(world, player, 30);
        expect(arch.idleDays).toBe(0);
    });
});

describe('Great Works: completion and the effects other systems read', () => {
    it('the Great Library: world record, Prestige, chronicle, renown, research speed, map record, achievements', () => {
        const world = makeWorld(51);
        const player = makePlayer(world);
        const research0 = Technology.getResearchBonus(player, world);
        const prestige0 = player.house.prestige;
        const p = Patronage.found(player, world, 3, 3, 'great_library').project;
        const outs = buildAll(world, player, p.id);
        expect(Patronage.project(player, p.id)).toBe(null);
        const built = Patronage.playerBuilt(world);
        expect(built).toHaveLength(1);
        expect(built[0]).toMatchObject({ workId: 'great_library', q: 3, r: 3, owner: 'player' });
        expect(Patronage.claimed(world, 'great_library')).toBeTruthy();
        expect(outs.some(o => o.completed.length)).toBe(true);
        expect(player.house.prestige - prestige0).toBeGreaterThanOrEqual(Patronage.greatWork('great_library').prestige);
        expect(player.house.stats.greatWork).toBe(1);
        expect(Technology.getResearchBonus(player, world)).toBeCloseTo(research0 + 0.2, 5);
        expect(Taxation.patronageMood(tileOf(world, 3, 3).settlement)).toBeGreaterThan(0);
        expect(Deeds.collect(player)['patronage.greatWorks']).toBe(1);
        expect(Deeds.collect(player)['patronage.uniqueWorks']).toBe(1);
        expect(Achievements.ACHIEVEMENTS.GREAT_BUILDER.check(player)).toBe(true);
        expect(Achievements.ACHIEVEMENTS.WONDER_OF_THE_WORLD.check(player)).toBe(true);
        expect(Legacy.summarize(player, world).greatWorks).toBe(1);
        // Nobody else may found it now
        expect(Patronage.canFound(player, world, 1, 5, 'great_library').reason).toMatch(/elsewhere|already raised/);
    });

    it('cathedral → conversion; hippodrome → festival renown; bridge → river fording; observatory → vision', () => {
        const world = makeWorld(52);
        const player = makePlayer(world, { religion: { buildings: [], influence: 0 } });
        const conv0 = PlayerReligion.conversionMultiplier(player);
        const host0 = Festivals.getReputation(player).hostBonus;
        const riverTile = { hasRiver: true, terrain: { passable: true, moveCost: 2 }, infrastructure: null };
        const river0 = Infrastructure.getRiverPenalty(riverTile, player);
        for (const [workId, q, r] of [['cathedral', 3, 3], ['hippodrome', 1, 5], ['grand_bridge', 3, 3], ['observatory', 6, 6]]) {
            const res = Patronage.found(player, world, q, r, workId);
            expect(res.success, `${workId}: ${res.reason}`).toBe(true);
            buildAll(world, player, res.project.id);
        }
        expect(Patronage.playerBuilt(world).map(b => b.workId).sort()).toEqual(['cathedral', 'grand_bridge', 'hippodrome', 'observatory']);
        expect(PlayerReligion.conversionMultiplier(player)).toBeCloseTo(conv0 * 1.25, 5);
        expect(Festivals.getReputation(player).hostBonus).toBe(host0 + 4);
        expect(Infrastructure.getRiverPenalty(riverTile, player)).toBeLessThan(river0);
        expect(Patronage.fx(player, 'vision')).toBe(1);
        // A work's gifts last only while the town is yours
        player.settlements = player.settlements.filter(s => !(s.q === 3 && s.r === 3));
        Patronage.refreshFx(player, world);
        expect(PlayerReligion.conversionMultiplier(player)).toBeCloseTo(conv0, 5);
    });

    it('the university teaches the heirs faster (Upbringing reads it)', async () => {
        const { Upbringing } = await import('../systems/upbringing.js');
        const grow = (education) => {
            const child = { id: 'c1', firstName: 'Ada', age: 8, skills: {}, strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5 };
            const up = Upbringing.ensure(child);
            up.focus = 'learning';
            const parent = { gold: 0, travelParty: [], patronage: { fx: { education } }, traits: null };
            Utils.setSeed(9);
            Upbringing._growthTick(parent, { day: 30 }, child, { tutorsLeft: [], rubOff: [] });
            return JSON.stringify(up.xp);
        };
        expect(grow(0.35)).not.toEqual(grow(0));
    });

    it('the Colossus pays Prestige every month', () => {
        const world = makeWorld(53);
        const player = makePlayer(world);
        const p = Patronage.found(player, world, 1, 5, 'colossus').project;
        buildAll(world, player, p.id);
        expect(Patronage.fx(player, 'monthlyPrestige')).toBeGreaterThan(0);
        const before = player.house.prestige;
        world.day = Math.ceil((world.day + 1) / 30) * 30 - 1;
        tick(world, player, 1);
        expect(player.house.prestige).toBe(before + Patronage.fx(player, 'monthlyPrestige'));
    });
});

describe('the kingdoms\' wonders', () => {
    function npcWorld(seed) {
        tune(d => { d.config.npc.startChance = 1; d.config.npc.firstDay = 0; });
        const world = makeWorld(seed, 29);
        return world;
    }

    it('kingdoms begin wonders at their capitals, pay from the treasury, and finish them', () => {
        const world = npcWorld(61);
        const out = Patronage.processDay((world.day++, world), null);
        expect(out.worldBegun.length).toBeGreaterThan(0);
        const n = Patronage.npcProjects(world)[0];
        const k = world.getKingdom(n.kingdomId);
        expect(n.q).toBe(k.capital.q);
        const treasury = k.treasury;
        let done = null;
        for (let i = 0; i < 2000 && !done; i++) {
            world.day++;
            const o = Patronage.processDay(world, null);
            done = o.worldCompleted.find(r => r.kingdomId === k.id) || null;
        }
        expect(done).toBeTruthy();
        expect(k.treasury).toBeLessThan(treasury);
        expect(k.greatWorks.some(g => g.id === done.workId)).toBe(true);
        // Its stability reads the wonder
        const target = KingdomStability.target(k, world);
        expect(target.parts.some(p => p.label === 'Great works')).toBe(true);
    });

    it('a kingdom finishing a unique work first forestalls the player, who gets half back', () => {
        const world = npcWorld(62);
        const player = makePlayer(world);
        // Only the Great Library is on offer
        tune(d => { for (const id of Object.keys(d.greatWorks)) if (id !== 'great_library') delete d.greatWorks[id].npc; d.greatWorks.great_library.npc.days = 5; });
        const p = Patronage.found(player, world, 3, 3, 'great_library').project;
        Patronage.deliver(player, world, p.id, { buyMissing: true });
        const spent = p.spent;
        const outs = tick(world, player, 1);
        expect(outs[0].worldBegun.some(n => n.workId === 'great_library')).toBe(true);
        // A race notice for the player's unique work
        expect(outs[0].notices.some(n => n.title === 'A Race Begins')).toBe(true);
        const gold = player.gold;
        const more = tick(world, player, 10);
        expect(Patronage.state(player).projects).toHaveLength(0);
        expect(Patronage.state(player).stats.forestalled).toBe(1);
        expect(more.some(o => o.notices.some(n => n.title === 'Beaten to It'))).toBe(true);
        expect(player.gold).toBeGreaterThan(gold - 1000); // the refund outweighs the wages paid meanwhile
        expect(player.gold - gold).toBeLessThanOrEqual(Math.floor(spent * 0.5));
        expect(Patronage.claimed(world, 'great_library').owner).toBe('kingdom');
    });

    it('the player finishing a unique work first ends the kingdoms\' race for it', () => {
        const world = npcWorld(63);
        const player = makePlayer(world);
        tune(d => { for (const id of Object.keys(d.greatWorks)) if (id !== 'observatory') delete d.greatWorks[id].npc; d.greatWorks.observatory.npc.days = 5000; });
        tick(world, player, 1);
        expect(Patronage.race(world, 'observatory').length).toBeGreaterThan(0);
        const p = Patronage.found(player, world, 3, 3, 'observatory').project;
        buildAll(world, player, p.id);
        expect(Patronage.race(world, 'observatory')).toEqual([]);
        expect(Patronage.claimed(world, 'observatory').owner).toBe('player');
    });

    it('the heralds proclaim a wonder begun and finished', () => {
        const world = npcWorld(64);
        const player = makePlayer(world);
        tune(d => { for (const id of Object.keys(d.greatWorks)) d.greatWorks[id].npc.days = 3; });
        Heralds.processDay(world, player); // first tick: snapshot only
        for (let i = 0; i < 8; i++) {
            world.day++;
            Patronage.processDay(world, player);
            Heralds.processDay(world, player);
        }
        const kinds = player.heralds.list.map(p => p.kind);
        expect(kinds).toContain('wonder_begun');
        expect(kinds).toContain('wonder');
    });
});

describe('the Counsel', () => {
    it('names stalled works, stages awaiting supplies, idle clients and rival offers', () => {
        tune(d => { d.config.poach.base = 1; d.config.poach.cadence = 1; d.config.poach.answerDays = 100; });
        const world = makeWorld(71);
        const player = makePlayer(world);
        player.house.rivals = { k2: { kingdomId: 'k2', name: 'House Belmor', feud: 0 } };
        const a = Patronage.found(player, world, 3, 3, 'university').project;
        Patronage.found(player, world, 1, 5, 'hippodrome');
        Patronage.deliver(player, world, a.id, { buyMissing: true });
        hireOf(player, world, 'scholar');
        world.day = 95;
        tick(world, player, 5); // winter: no stall warning; idle; an offer
        player.gold = 1;
        world.day = 130;
        tick(world, player, 1);
        const s = Counsel.scan(player, world, { fresh: true });
        const rules = [...s.threats, ...s.opportunities, ...(s.goals || [])].map(i => i.rule);
        expect(rules).toContain('great_work_stalled');
        expect(rules).toContain('great_work_supply');
        expect(rules).toContain('patronage_offer');
    });
});

describe('save and load', () => {
    it('round-trips patronage and the world\'s wonders through the real save, with backfill for old saves', () => {
        const game = newGame(4242);
        const { world, player } = game;
        const town = world.getAllSettlements().find(s => s.type === 'town' || s.type === 'capital');
        player.q = town.q; player.r = town.r;
        player.settlements = [{ q: town.q, r: town.r }];
        player.gold = 60000;
        const tile = world.getTile(town.q, town.r);
        const cand = Patronage.salon(player, world, tile)[0];
        expect(Patronage.hire(player, world, tile, cand.id).success).toBe(true);
        const found = Patronage.found(player, world, town.q, town.r, 'university');
        expect(found.success).toBe(true);
        Patronage.deliver(player, world, found.project.id, { buyMissing: true });
        world.greatWorks.npc.push({ uid: 'gwnX', kingdomId: world.kingdoms[0].id, workId: 'cathedral', q: 0, r: 0, progress: 3, days: 300, paid: 40, startDay: world.day });
        for (let i = 0; i < 3; i++) endDay(game);
        const before = { p: JSON.stringify(player.patronage), w: JSON.stringify(world.greatWorks) };
        const loaded = roundTrip(game);
        expect(JSON.stringify(loaded.player.patronage)).toBe(before.p);
        expect(JSON.stringify(loaded.world.greatWorks)).toBe(before.w);
        // The game goes on after the load
        expect(() => endDay(loaded)).not.toThrow();

        // An old save: no patronage, no wonders
        const p2 = { gold: 0 };
        Patronage.loadState(p2);
        expect(p2.patronage.clients).toEqual([]);
        expect(p2.patronage.fx.care).toBe(1);
        const w2 = {};
        Patronage.restoreWorld(undefined, w2);
        expect(w2.greatWorks).toEqual({ built: [], npc: [], claimed: {}, nextId: 1 });
    });
});

describe('determinism', () => {
    function run(seed) {
        tune(d => { d.config.npc.startChance = 0.5; d.config.npc.firstDay = 0; d.config.poach.base = 0.3; });
        const world = makeWorld(seed, 1);
        const player = makePlayer(world, { inventory: { dyes: 40, parchment: 40, herbs: 40 } });
        player.house.rivals = { k2: { kingdomId: 'k2', name: 'House Belmor', feud: 20 } };
        for (const c of Patronage.salon(player, world, tileOf(world, 3, 3))) Patronage.hire(player, world, tileOf(world, 3, 3), c.id);
        for (let i = 0; i < 400; i++) {
            for (const c of Patronage.state(player).clients) {
                const w = (Patronage.professions()[c.profession].works || [])[0];
                if (w && !c.task) Patronage.commission(player, world, c.id, w);
            }
            world.day++;
            Patronage.processDay(world, player);
        }
        DataLoader.patronage = JSON.parse(JSON.stringify(saved));
        return JSON.stringify({ p: player.patronage, w: world.greatWorks, k: world.kingdoms });
    }

    it('the same seed gives the same history, and no Utils RNG is drawn', () => {
        Utils.setSeed(1234);
        const expected = Utils.random();
        Utils.setSeed(1234);
        const a = run(5);
        expect(Utils.random()).toBe(expected);
        expect(run(5)).toBe(a);
        expect(run(6)).not.toBe(a);
    });
});
