// Faces, fame, and what comes after:
//   - rival Houses' plots work through named townsfolk (systems/schemes.js + townsfolk.js)
//   - local fame stages with real readers (systems/fame.js)
//   - ambition tiers with rewards, and demands on a rich House (systems/house.js, demands.js)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { House } from '../systems/house.js';
import { Schemes } from '../systems/schemes.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcFamily } from '../systems/npcFamily.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Fame } from '../systems/fame.js';
import { Demands } from '../systems/demands.js';
import { Chatter } from '../systems/chatter.js';
import { Tavern } from '../player/tavern/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readData = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${name}.json`), 'utf-8'));

let savedGamedata;
beforeEach(() => {
    savedGamedata = DataLoader._gamedata;
    DataLoader._gamedata = { ...(savedGamedata || {}), fame: readData('fame'), house: readData('house') };
});
afterEach(() => {
    DataLoader._gamedata = savedGamedata;
    House.resetBrain();
});

function seedNpcs() {
    const types = { villager: 6, merchant: 3, guard: 3, farmer: 2, priest: 1, blacksmith_npc: 1, child: 2 };
    const npcs = [];
    let id = 0;
    for (const [type, n] of Object.entries(types)) for (let i = 0; i < n; i++) npcs.push({ id: id++, type, name: 'Ada', age: 30 });
    let s = 7;
    NpcFamily.generateFamilies(npcs, () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; });
    return npcs;
}

function makeWorld(day = 10) {
    const town = { name: 'Ashford', type: 'town', q: 5, r: 5, kingdom: 'k1' };
    const tiles = new Map([['5,5', { q: 5, r: 5, settlement: town }]]);
    const kingdoms = [
        { id: 'k1', name: 'Varr', isAlive: true, military: 500, treasury: 100, ruler: 'King Aldo', wars: [] },
        { id: 'k2', name: 'Osk', isAlive: true, military: 300, treasury: 5000, ruler: 'Queen Mab', wars: [] },
    ];
    const world = {
        day, baseYear: 853, generationParams: { seed: 777 }, activeEvents: [], kingdoms, town,
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [town],
        _tiles: tiles,
    };
    Townsfolk.attach(town, world, seedNpcs(), { q: 5, r: 5, target: 18 });
    return world;
}

function makePlayer(world, extra = {}) {
    const player = {
        id: 'p1', name: 'Edda', lastName: 'Ashborne', gold: 1000, renown: 0, karma: 0, q: 5, r: 5,
        reputation: { k1: 0, k2: 0 }, properties: [], colonies: [], children: [], skills: {}, charisma: 5,
        ...extra,
    };
    House.initialize(player, world);
    House.seedRivals(player, world, 2);
    return player;
}

describe('Faces in town: rival plots work through named townsfolk', () => {
    it('a hatched plot names an agent from the nearest town, without drawing the shared RNG', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        Utils.setSeed(3);
        const scheme = Schemes.hatch(player, world, player.house.rivals.k1, 'theft');
        const after = Utils.random();
        expect(scheme.agent).toBeTruthy();
        expect(scheme.agent.town).toBe('Ashford');
        const p = Townsfolk.get(world.town.folk, scheme.agent.pid);
        expect(p.role).toBe('merchant'); // thieves bribe a merchant
        // the casting draws nothing from the shared RNG: same stream as a town-less hatch
        const bare = makePlayer({ ...world, getSettlementViews: () => [] });
        Utils.setSeed(3);
        const plain = Schemes.hatch(bare, { ...world, getSettlementViews: () => [] }, bare.house.rivals.k1, 'theft');
        expect(plain.agent).toBeUndefined();
        expect(Utils.random()).toBe(after);
        scheme.revealed = true;
        expect(Schemes.describe(scheme)).toContain(scheme.agent.name);
    });

    it('a struck theft writes the town annals and names a suspect; accusing exiles them and recovers gold', () => {
        Utils.setSeed(11);
        const world = makeWorld();
        const player = makePlayer(world, { gold: 5000 });
        const scheme = Schemes.hatch(player, world, player.house.rivals.k1, 'theft');
        world.day = scheme.dueDay;
        const res = Schemes.processDaily(player, world);
        const struck = res.resolved.find(r => r.outcome === 'struck');
        expect(struck).toBeTruthy();
        expect(struck.text).toContain(scheme.agent.name);
        const plot = world.town.folk.annals.find(a => a.k === 'plot');
        expect(plot).toBeTruthy();
        world.town.folk.prevVisit = 0;
        expect(Townsfolk.townNews(world.town.folk, world, 6).join(' ')).toContain(scheme.rivalName);

        const sus = Schemes.suspects(player, world);
        expect(sus.length).toBe(1);
        const person = Townsfolk.get(world.town.folk, sus[0].pid);
        expect(Schemes.suspectFor(player, world, world.town.folk, person)).toBeTruthy();
        const goldBefore = player.gold;
        const feudBefore = player.house.rivals.k1.feud;
        const out = Schemes.confront(player, world, sus[0].id, 'accuse');
        expect(out.success).toBe(true);
        expect(out.gold).toBeGreaterThan(0);
        expect(player.gold).toBe(goldBefore + out.gold);
        expect(player.house.rivals.k1.feud).toBeGreaterThan(feudBefore);
        expect(person.away).toBeTruthy();
        expect(player.reputation.k1).toBe(Schemes.CONFIG.exposeReputation);
        expect(world.town.folk.annals.some(a => a.k === 'exiled' && a.a === person.id)).toBe(true);
        expect(Schemes.suspects(player, world).length).toBe(0);
    });

    it('a revealed plot names its agent; turning them foils the plot and plants an informant', () => {
        Utils.setSeed(5);
        const world = makeWorld();
        const player = makePlayer(world, { gold: 2000 });
        const scheme = Schemes.hatch(player, world, player.house.rivals.k2, 'slander');
        Schemes.revealAll(player, world);
        const [s] = Schemes.suspects(player, world);
        expect(s.status).toBe('plotting');
        const cost = Schemes.turnCost(player, s);
        const out = Schemes.confront(player, world, s.id, 'turn');
        expect(out.success).toBe(true);
        expect(player.gold).toBe(2000 - cost);
        expect(Schemes.active(player).includes(scheme)).toBe(false);
        expect(player.house.informants.k2).toBeTruthy();
        const next = Schemes.hatch(player, world, player.house.rivals.k2, 'slander');
        expect(Schemes.revealChance(player, next, world.day)).toBeGreaterThan(Schemes.revealChance(player, null, world.day));
        const person = Townsfolk.get(world.town.folk, s.pid);
        expect(person.log.some(e => e.k === 'informant')).toBe(true);
    });

    it('sparing a suspect is mercy: karma, goodwill, a cooler feud, and a reunion line later', () => {
        Utils.setSeed(9);
        const world = makeWorld();
        const player = makePlayer(world);
        player.house.rivals.k1.feud = 40;
        Schemes.hatch(player, world, player.house.rivals.k1, 'slander');
        Schemes.revealAll(player, world);
        const [s] = Schemes.suspects(player, world);
        const out = Schemes.confront(player, world, s.id, 'release');
        expect(out.success).toBe(true);
        expect(player.karma).toBe(Schemes.CONFIG.mercyKarma);
        expect(player.house.rivals.k1.feud).toBeLessThan(40);
        expect(Schemes.active(player).length).toBe(1); // the plot goes on
        const person = Townsfolk.get(world.town.folk, s.pid);
        person.seen = { d: world.day - 1, age: 30, role: person.role };
        world.day += 200;
        const line = Townsfolk.reunionLine({ _person: person, _folk: world.town.folk }, world);
        expect(line).toMatch(/let me go/);
    });

    it('a raid kills a guard of the town, who dies on the roster', () => {
        Utils.setSeed(21);
        const world = makeWorld();
        const player = makePlayer(world);
        world._tiles.set('6,5', { playerProperties: [{ type: 'farm', level: 2, storage: 10 }] });
        player.properties.push({ q: 6, r: 5, type: 'farm' });
        const scheme = Schemes.hatch(player, world, player.house.rivals.k1, 'raid_property');
        const guardsBefore = Townsfolk.residents(world.town.folk).filter(p => p.role === 'guard').length;
        world.day = scheme.dueDay;
        Schemes.processDaily(player, world);
        const guardsAfter = Townsfolk.residents(world.town.folk).filter(p => p.role === 'guard').length;
        expect(guardsAfter).toBeLessThan(guardsBefore);
        expect(world.town.folk.annals.some(a => a.k === 'died' && /raiders/.test(a.x))).toBe(true);
    });
});

describe('Fame: what the name means in one realm', () => {
    it('stages climb with renown and standing, and ill fame wins out when it is worse', () => {
        const p = { renown: 0, karma: 0, reputation: {} };
        expect(Fame.stageIn(p, 'k1').id).toBe('stranger');
        p.renown = 50;
        expect(Fame.stageIn(p, 'k1').id).toBe('known');
        p.reputation.k1 = 60;
        expect(Fame.stageIn(p, 'k1').id).toBe('celebrated');
        p.renown = 200;
        expect(Fame.stageIn(p, 'k1').id).toBe('legend');
        const q = { renown: 10, karma: -80, reputation: { k1: -60 } };
        expect(Fame.stageIn(q, 'k1').id).toBe('shunned');
        q.reputation.k1 = -20;
        expect(Fame.stageIn(q, 'k1').id).toBe('distrusted');
        // House honours add to fame everywhere
        const h = { renown: 0, karma: 0, reputation: {}, house: { honours: [{ id: 'x', fame: 20 }] } };
        expect(Fame.stageIn(h, 'k9').id).toBe('known');
    });

    it('fame shades a trader\'s prices and the first impression; a rival House chills its realm', () => {
        const npc = { name: 'Brom', type: 'merchant', personalityTraits: [] };
        const celebrated = { renown: 60, karma: 0, reputation: { k1: 60 } };
        const base = NpcDisposition.getPriceModifiers(npc);
        const famed = NpcDisposition.getPriceModifiers(npc, { player: celebrated, kingdomId: 'k1' });
        expect(famed.buy).toBeLessThan(base.buy);
        expect(famed.reasons.some(r => /Celebrated/.test(r.label))).toBe(true);

        const npc2 = { name: 'Una', type: 'villager' };
        NpcDisposition.seedFromStanding(npc2, celebrated, 'k1');
        expect(NpcDisposition.getMemory(npc2).disposition).toBe(60);
        // applied once only
        NpcDisposition.seedFromStanding(npc2, celebrated, 'k1');
        expect(NpcDisposition.getMemory(npc2).disposition).toBe(60);

        const feuded = { renown: 0, karma: 0, reputation: {}, house: { rivals: { k1: { name: 'House Varr', feud: 60 } } } };
        const npc3 = { name: 'Holt', type: 'guard' };
        const seed = NpcDisposition.seedFromStanding(npc3, feuded, 'k1');
        expect(seed.delta).toBeLessThan(0);
        expect(NpcDisposition.getMemory(npc3).disposition).toBeLessThan(50);
    });

    it('the shunned pay dearer bribes and are shadowed', () => {
        const q = { renown: 0, karma: -100, reputation: { k1: -80 } };
        expect(Fame.bribeMult(q, 'k1')).toBeGreaterThan(1);
        expect(Fame.shadowCatch(q, 'k1')).toBeGreaterThan(0);
        expect(Fame.bribeMult({ renown: 0, reputation: {} }, 'k1')).toBe(1);
    });

    it('the celebrated eat and sleep on the house, once a week a town', () => {
        const world = makeWorld();
        const tile = world.getTile(5, 5);
        const player = { renown: 60, karma: 0, reputation: { k1: 60 }, gold: 100, q: 5, r: 5 };
        const opts = Tavern.getTavernOptions(player, tile, world);
        expect(opts.find(o => o.id === 'buy_meal').cost).toBe(0);
        Tavern._buyMeal(player, tile, world);
        expect(player.gold).toBe(100);
        Tavern._buyMeal(player, tile, world);
        expect(player.gold).toBe(92);
        Tavern._restAtInn(player, tile, world);
        expect(player.gold).toBe(92);
        world.day += 8;
        expect(Fame.innFree(player, world, tile, 'meal')).toBe(true);
        // round-trips
        const copy = {};
        Fame.restore(copy, JSON.parse(JSON.stringify(Fame.serialize(player))));
        expect(copy.fame.towns['5,5'].meal).toBe(player.fame.towns['5,5'].meal);
    });

    it('crowds gather for a legend, guards fall in for the shunned', () => {
        const world = makeWorld();
        const tile = world.getTile(5, 5);
        const legend = { name: 'Edda', renown: 300, karma: 0, reputation: { k1: 80 }, gold: 0 };
        const n = Fame.onEnterSettlement(legend, world, tile);
        expect(n.length).toBeGreaterThan(0);
        // not again the same week
        expect(Fame.onEnterSettlement(legend, world, tile).length).toBe(0);
        const shunned = { name: 'Rook', renown: 0, karma: -100, reputation: { k1: -90 } };
        const m = Fame.onEnterSettlement(shunned, world, tile);
        expect(m.some(x => x.type === 'warning')).toBe(true);
    });

    it('chatter can be gated on the local fame stage and a rival House', () => {
        expect(Chatter.matches({ fame: ['legend'] }, { fame: ['legend'] })).toBe(true);
        expect(Chatter.matches({ fame: ['legend'] }, { fame: ['known'] })).toBe(false);
        expect(Chatter.matches({ rivalHouse: true }, { rivalHouse: 'House Varr' })).toBe(true);
        DataLoader._gamedata.chatter = readData('chatter');
        const groups = (DataLoader._gamedata.chatter.groups || DataLoader._gamedata.chatter.talk || []);
        expect(JSON.stringify(groups)).toContain('fame_legend');
    });
});

describe('What comes after: ambition tiers and demands on a rich House', () => {
    it('fulfilling an ambition pays its reward, records an honour and opens the next tier', () => {
        const world = makeWorld();
        const player = makePlayer(world, { gold: 60000, tradeRoutes: [{}, {}, {}, {}, {}] });
        expect(House.ambitions(player.house).some(a => a.id === 'bankers_to_kings')).toBe(false);
        House.chooseAmbition(player.house, 'merchant_dynasty', 1);
        const prestigeBefore = player.house.prestige;
        const res = House.evaluateAmbition(player, world);
        expect(res.capstoneCompleted).toBe(true);
        expect(player.gold).toBe(60000 + 2500);
        expect(player.house.prestige).toBeGreaterThan(prestigeBefore);
        expect(player.house.honours.map(h => h.id)).toContain('merchant_princes');
        expect(res.unlocked).toContain('Bankers to Kings');
        const open = House.ambitions(player.house).map(a => a.id);
        expect(open).toContain('bankers_to_kings');
        expect(open).not.toContain('merchant_dynasty');
        expect(House.chooseAmbition(player.house, 'merchant_dynasty', 2)).toBeNull();
        expect(House.chooseAmbition(player.house, 'masters_of_coin', 2)).toBeNull(); // tier 3 not yet open
        const prog = House.chooseAmbition(player.house, 'bankers_to_kings', 2);
        expect(prog.milestones.length).toBe(3);
        player.gold = 120000;
        const r2 = House.evaluateAmbition(player, world);
        expect(r2.milestonesCompleted).toContain('coffers100k');
        // the honour raises fame everywhere
        expect(Fame.honourFame(player)).toBe(5);
    });

    it('a low crown asks a rich vassal for money; paying a forced loan is repaid with interest', () => {
        const world = makeWorld(0);
        const player = makePlayer(world, { gold: 20000, allegiance: 'k1' });
        world.kingdoms[0].fisc = { avg: { rev: 50, exp: 100 }, arrearsDays: 2 };
        let d = null;
        for (let day = 15; day <= 1500 && !d; day += 15) {
            world.day = day;
            player.house._demandCooldown = {};
            player.house.demands = [];
            player.house.rivals = {}; // only the crown and guilds may ask here
            Demands.processDay(world, player);
            d = Demands.open(player).find(x => x.kind === 'crown' && x.sub === 'loan') || null;
        }
        expect(d).toBeTruthy();
        const treasury = world.kingdoms[0].treasury;
        const res = Demands.answer(player, world, d.id, 'pay');
        expect(res.success).toBe(true);
        expect(world.kingdoms[0].treasury).toBe(treasury + d.amount);
        expect(player.reputation.k1).toBeGreaterThan(0);
        const loan = Demands.loans(player)[0];
        expect(loan.amount).toBe(d.amount);
        // fall due with a full treasury: repaid with interest
        world.kingdoms[0].treasury = 1e6;
        world.day = loan.dueDay;
        const goldBefore = player.gold;
        Demands.processDay(world, player);
        expect(player.gold).toBe(goldBefore + Math.round(loan.amount * 1.05));
        expect(Demands.loans(player).length).toBe(0);
    });

    it('a feuding rival demands tribute that grows with wealth; refusing inflames the feud and hatches a plot', () => {
        const world = makeWorld(0);
        const player = makePlayer(world, { gold: 50000 });
        player.house.rivals.k2.feud = 70;
        delete player.house.rivals.k1;
        let d = null;
        for (let day = 15; day <= 1500 && !d; day += 15) {
            world.day = day;
            player.house._demandCooldown = {};
            player.house.demands = [];
            Demands.processDay(world, player);
            d = Demands.open(player).find(x => x.kind === 'rival') || null;
        }
        expect(d).toBeTruthy();
        const poorer = Demands.tributeAsk({ ...player, gold: 5000 }, player.house.rivals.k2);
        expect(d.amount).toBeGreaterThan(poorer);
        const res = Demands.answer(player, world, d.id, 'refuse');
        expect(res.success).toBe(true);
        expect(player.house.rivals.k2.feud).toBe(85);
        expect(Schemes.active(player).some(s => s.rivalId === 'k2')).toBe(true);
        expect(Demands.open(player).length).toBe(0);
    });

    it('an unanswered demand lapses as a refusal', () => {
        const world = makeWorld(30);
        const player = makePlayer(world, { gold: 50000 });
        const house = Demands._state(player);
        house.demands.push({ id: 99, kind: 'rival', rivalId: 'k1', from: 'House Varr', amount: 500, icon: '⚔️', day: 20, dueDay: 30, outcome: null, negotiated: false });
        player.house.rivals.k1.feud = 10;
        Demands.processDay(world, player);
        expect(house.demands[0].outcome).toBe('lapsed');
        expect(player.house.rivals.k1.feud).toBe(25);
    });
});
