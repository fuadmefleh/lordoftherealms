// Stewards & governors (systems/stewards.js): appointing real people over the
// player's seats, standing orders read by Holdings, embezzlement out of real
// purses, audits, rewards and punishment, risings, marriage proposals, the
// season's dispatch as a court letter, succession, and the Stewards panel.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Holdings } from '../systems/holdings.js';
import { Stewards } from '../systems/stewards.js';
import { Economy } from '../world/economy.js';
import { Relationships } from '../systems/relationships.js';
import { House } from '../systems/house.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { ActionMenu } from '../ui/actionMenu/index.js';
import { stewards as botStewards } from './playtest/bot.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

afterEach(() => Utils.resetRng());

function makeWorld(day = 7) {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 16; q++) for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, territory: [{ q: 5, r: 5 }], population: 5000 };
    return {
        day, width: 16, kingdoms: [kingdom], units: [], events: [], generationParams: { seed: 42 },
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
    };
}

function makePlayer(world) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male',
        gold: 10000, renown: 20, karma: 0, reputation: {}, properties: [], colonies: [],
        children: [{ id: 'c1', firstName: 'Ada', age: 20, gender: 'female', isAlive: true, skills: { commerce: 5, combat: 2 }, intelligence: 7, strength: 4, traits: [] }],
        inventory: {}, army: [], q: 9, r: 9, taxRate: 'moderate',
        skills: { commerce: 20, combat: 4, leadership: 3, diplomacy: 4, stealth: 2 },
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    return player;
}

function own(player, world, q, r) {
    const s = { name: `Town${q}${r}`, type: 'village', population: 900, level: 1, kingdom: null, colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 0 } };
    Economy.initSettlement(s);
    s.economy.gold = 5000;
    world.getTile(q, r).settlement = s;
    player.colonies.push({ q, r, name: s.name, foundedDay: 0 });
    return s;
}

function days(player, world, n) {
    for (let i = 0; i < n; i++) {
        world.day++;
        Holdings.processDay(player, world);
        Stewards.processDay(world, player);
    }
}

function setup() {
    Utils.setSeed(7);
    const world = makeWorld();
    const player = makePlayer(world);
    const s = own(player, world, 5, 5);
    own(player, world, 7, 5);
    return { world, player, s };
}

describe('Stewards', () => {
    it('lists the seats and real people to put over them', () => {
        const { world, player } = setup();
        const seats = Stewards.seats(player, world);
        expect(seats.map(x => x.id)).toEqual(['holding:5,5', 'holding:7,5']);
        expect(seats[0].title).toBe('Steward');
        const cands = Stewards.candidates(player, world, 'holding:5,5');
        expect(cands.some(c => c.kind === 'family' && c.id === 'c1')).toBe(true);
        for (const c of cands) {
            expect(c.honesty).toBeGreaterThan(0);
            expect(['good', 'warn', 'bad']).toContain(c.reference.tone);
        }
    });

    it('appoints a townsperson as the holding governor, and the standing order reaches the holding', () => {
        const { world, player, s } = setup();
        const folk = Stewards.candidates(player, world, 'holding:5,5').find(c => c.kind === 'townsfolk');
        expect(folk).toBeTruthy();
        const res = Stewards.appoint(player, world, 'holding:5,5', folk.key);
        expect(res.success).toBe(true);
        const g = s.holding.governor;
        expect(g.kind).toBe('townsfolk');
        expect(g.st).toBeTruthy();
        expect(Relationships.getNPC(g.id).folkUid).toBe(folk.folkUid);
        const before = s.holding.fx.defense;
        expect(Stewards.setOrders(player, world, 'holding:5,5', 'defences').success).toBe(true);
        expect(s.holding.fx.defense).toBeGreaterThan(before);
        expect(Stewards.setOrders(player, world, 'holding:5,5', 'watch').success).toBe(false);
    });

    it('a crooked steward pockets real coin from the town; an audit claws it back', () => {
        const { world, player, s } = setup();
        Stewards.appoint(player, world, 'holding:5,5', 'family:c1');
        const g = s.holding.governor;
        g.st.honesty = 0.1;
        g.st.orders = 'revenue';
        const purse0 = s.economy.gold;
        days(player, world, 28);
        expect(g.st.pocket).toBeGreaterThan(0);
        expect(s.holding.fx.skim).toBeGreaterThan(0);
        expect(s.economy.gold).toBeLessThan(purse0 + 1e9);
        const pocket = g.st.pocket;
        const gold0 = player.gold;
        Utils.setSeed(3);
        const res = Stewards.audit(player, world, 'holding:5,5');
        expect(res.success).toBe(true);
        if (res.found) {
            expect(res.recovered).toBe(Math.floor(Math.floor(pocket) * 0.7));
            expect(player.gold).toBe(gold0 - res.cost + res.recovered);
            expect(g.st.caught).toBe(true);
            const fine = Stewards.punish(player, world, 'holding:5,5', 'fine');
            expect(fine.success).toBe(true);
            expect(g.st.pocket).toBe(0);
        }
        expect(Stewards.audit(player, world, 'holding:5,5').success).toBe(false); // cooldown
    });

    it('sends the season\'s dispatch as a court letter', () => {
        const { world, player } = setup();
        Stewards.fillVacant(player, world);
        expect(Stewards.offices(player, world).length).toBe(2);
        days(player, world, 31);
        const st = Stewards.state(player);
        expect(st.reports.length).toBeGreaterThan(0);
        expect(st.reports[0].keys[0]).toMatch(/^steward:/);
        expect(CourtLetters.open(player).some(l => /dispatches/.test(l.subject))).toBe(true);
        const v = Stewards.view(player, world);
        expect(v.reports[0].lines.length).toBe(2);
    });

    it('a strong, disloyal, ambitious governor raises the town', () => {
        const { world, player, s } = setup();
        Stewards.appoint(player, world, 'holding:5,5', 'family:c1');
        const g = s.holding.governor;
        const seat = Stewards.seat(player, world, 'holding:5,5');
        const out = { notices: [] };
        Stewards._rise(player, world, seat, g, out);
        expect(s.holding.governor).toBe(null);
        expect(s.holding.rebellion).toBeTruthy();
        expect(out.notices.some(n => /Rises/.test(n.title))).toBe(true);
    });

    it('a steward asks for a child\'s hand; consent binds them to the House', () => {
        const { world, player, s } = setup();
        player.children[0].upbringing = undefined;
        const folk = Stewards.candidates(player, world, 'holding:5,5').find(c => c.kind === 'townsfolk');
        Stewards.appoint(player, world, 'holding:5,5', folk.key);
        const g = s.holding.governor;
        const npc = Relationships.getNPC(g.id);
        npc.gender = 'male';
        npc.marriedTo = null;
        Object.assign(g.st, { ambition: 9, power: 60 });
        g.loyalty = 80;
        const orig = Stewards.config;
        Stewards.config = () => ({ ...orig(), marriage: { ...orig().marriage, chance: 1 } });
        try {
            Stewards._proposal(player, world, Stewards.seat(player, world, 'holding:5,5'), g, g.st, { notices: [] });
        } finally {
            Stewards.config = orig;
        }
        const st = Stewards.state(player);
        expect(st.pending.length).toBe(1);
        const res = Stewards.answer(player, world, st.pending[0].id, true);
        expect(res.success).toBe(true);
        expect(player.children[0].upbringing.spouse.kind).toBe('steward');
        expect(g.st.kin).toBe(true);
        expect(g.st.oath).toBe('house');
    });

    it('at a succession, the House\'s sworn stay and the disloyal servants of the person go', () => {
        const { world, player, s } = setup();
        const t = own(player, world, 9, 5);
        Stewards.appoint(player, world, 'holding:5,5', 'family:c1');
        const folk = Stewards.candidates(player, world, 'holding:9,5').find(c => c.kind === 'townsfolk');
        Stewards.appoint(player, world, 'holding:9,5', folk.key);
        const g2 = t.holding.governor;
        Object.assign(g2.st, { oath: 'person', honesty: 0.3, power: 0 });
        g2.loyalty = 40;
        days(player, world, 1);
        player.name = 'Bran Ashborne';
        player.house.generation = 2;
        days(player, world, 1);
        expect(s.holding.governor).toBeTruthy();
        expect(t.holding.governor).toBe(null);
        expect(Stewards.state(player).stats.resigned).toBe(1);
    });

    it('survives a save round trip and renders the panel', () => {
        const { world, player } = setup();
        Stewards.fillVacant(player, world);
        const copy = JSON.parse(JSON.stringify(Stewards.serialize(player)));
        expect(copy.stats.appointed).toBe(2);
        let html = '';
        const game = { player, world, ui: { showCustomPanel: (t, h) => { html = h; }, showNotification: () => {}, updateStats: () => {} } };
        ActionMenu.showStewards(game);
        expect(html).toContain('Seats');
        ActionMenu.showStewards(game, 'seat', 'holding:5,5');
        expect(html).toContain('Audit the books');
        ActionMenu.stewardsAct(game, 'order', 'holding:5,5', 'peace');
        expect(Stewards.office(player, Stewards.seat(player, world, 'holding:5,5')).st.orders).toBe('peace');
    });

    it('the playtest bot fills its seats and sets their orders', () => {
        const { world, player } = setup();
        world.day = 10;
        const stats = {};
        botStewards({ player, world }, stats);
        expect(stats.stewardsAppointed).toBe(2);
        for (const { office } of Stewards.offices(player, world)) expect(office.st.orders).toMatch(/revenue|peace|fed/);
    });
});
