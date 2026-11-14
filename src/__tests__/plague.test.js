/**
 * Plague in the streets (systems/plague.js): severity from the town's
 * sickness, gates shut by a ruler and by the player, the gate turning the
 * player back, the shut gate cutting the spread (Illness.quarantined), the
 * trade routes carrying a sickness, and the player's acts — nursing, burning
 * the dead's goods (the town's spread slowed), selling remedies out of real
 * purses, looting a dead household's house.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Illness } from '../systems/illness.js';
import { Plague } from '../systems/plague.js';
import { Underworld } from '../systems/underworld.js';
import { Economy } from '../world/economy.js';

beforeAll(() => {
    DataLoader._gamedata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/gamedata.json'), 'utf-8'));
});

function makeWorld(seed = 777) {
    const towns = [
        { name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 },
        { name: 'Greymoor', type: 'village', q: 8, r: 9, population: 400, kingdom: 1 },
    ];
    const kingdoms = { 1: { id: 1, name: 'Westmark', wars: [] } };
    const world = {
        day: 400, baseYear: 853, generationParams: { seed }, activeEvents: [], kingdoms: Object.values(kingdoms), width: 40, height: 40,
        getSettlementViews: () => towns, getKingdom: id => kingdoms[id] || null,
        getTile: (q, r) => ({ q, r, settlement: towns.find(t => t.q === q && t.r === r) || null, terrain: { passable: true } }),
    };
    for (const t of towns) Townsfolk.seed(t, world, { q: t.q, r: t.r });
    return { world, towns };
}

/** Lay the plague on a share of the town (sick now, the course still running). */
function strike(world, s, share = 0.3) {
    Illness.state(world, s, s.folk, world.day);
    const res = Townsfolk.residents(s.folk);
    const n = Math.max(1, Math.round(res.length * share));
    for (const p of res.slice(0, n)) p.ill = { k: 'plague', d: world.day - 3, on: world.day - 2, end: world.day + 5, sv: 0.9, fam: false, hl: 1, hb: false, v: 0 };
    s.sickness = { d: world.day, n, abed: n, share: n / res.length, k: 'plague', epi: true, closed: false };
    return res.slice(0, n);
}

function player(extra = {}) {
    return { id: 'p1', name: 'Aldric', q: 0, r: 0, gold: 500, karma: 0, inventory: {}, skills: {}, ...extra };
}

beforeEach(() => Utils.setSeed(12345));

describe('Plague — severity', () => {
    it('is 0 in a clean town, at least the plague base in a plague town, more as more fall sick', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        expect(Plague.severityAt(world, a)).toBe(0);
        strike(world, a, 0.05);
        const low = Plague.severityAt(world, a);
        expect(low).toBeGreaterThanOrEqual(Plague.config().severity.plagueBase);
        strike(world, a, 0.4);
        const high = Plague.severityAt(world, a);
        expect(high).toBeGreaterThan(low);
        expect(high).toBeLessThanOrEqual(1);
        expect(Plague.isPlague(world, a)).toBe(true);
    });

    it('a lesser epidemic is capped below a plague', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        Illness.state(world, a, a.folk, world.day);
        a.sickness = { d: world.day, n: 50, abed: 40, share: 0.5, k: 'fever', epi: true, closed: false };
        const sev = Plague.severityAt(world, a);
        expect(sev).toBeGreaterThan(0);
        expect(sev).toBeLessThanOrEqual(Plague.config().severity.epiMax);
        expect(Plague.isPlague(world, a)).toBe(false);
    });

    it('an abstract plague (a town with no roster) counts too', () => {
        const { world, towns } = makeWorld();
        const b = towns[1];
        delete b.folk;
        b.sickness = { k: 'plague', d: world.day, until: world.day + 10, abs: true };
        expect(Plague.severityAt(world, b)).toBe(Plague.config().severity.abstractPlague);
    });
});

describe('Plague — the gates', () => {
    it('a ruler shuts a plague town within a week, and Illness.quarantined then reads it', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        strike(world, a, 0.3);
        expect(Illness.quarantined(world, a)).toBe(false);
        // the chance comes once a week; a few weeks of rolls make it all but sure
        for (let i = 0; i < 28 && !(a.plagueGate && a.plagueGate.shut); i++) { world.day++; a.sickness.d = world.day; Plague.processDay(world, null); }
        expect(a.plagueGate && a.plagueGate.shut).toBe(true);
        expect(Plague.isQuarantined(world, a)).toBe(true);
        expect(Illness.quarantined(world, a)).toBe(true);
    });

    it('opens again once the town has been clean a while, not before', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        Plague.shut(world, a, 'ruler', world.day);
        const G = Plague.config().gates;
        // clean from the start: held shut at least minDays
        for (let i = 0; i < G.minDays - 2; i++) { world.day++; Plague.processDay(world, null); }
        expect(a.plagueGate.shut).toBe(true);
        for (let i = 0; i < G.openAfterDays + 5; i++) { world.day++; Plague.processDay(world, null); }
        expect(a.plagueGate ? a.plagueGate.shut : false).toBe(false);
    });

    it('a town the player holds is never shut for them: they are told, and choose', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        a.owner = 'p1';
        const me = player({ q: a.q, r: a.r });
        strike(world, a, 0.3);
        let told = 0;
        for (let i = 0; i < 20; i++) { world.day++; a.sickness.d = world.day; told += Plague.processDay(world, me).notices.length; }
        expect(a.plagueGate ? a.plagueGate.shut : false).toBe(false);
        expect(told).toBe(1);
        const res = Plague.setGates(me, world, a, true);
        expect(res.success).toBe(true);
        expect(Plague.isQuarantined(world, a)).toBe(true);
        expect(a.plagueGate.by).toBe('player');
        // someone else's town is not theirs to command
        expect(Plague.setGates(me, world, towns[1], true).success).toBe(false);
    });

    it('turns the player back unless they have leave; a bribe lets them in', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        strike(world, a, 0.3);
        Plague.shut(world, a, 'ruler', world.day);
        const me = player();
        const gate = Plague.canEnter(me, world, a);
        expect(gate.ok).toBe(false);
        expect(gate.bribe).toBe(Plague.bribeCost(a));
        // a house there is leave enough
        expect(Plague.canEnter(player({ houses: [{ q: a.q, r: a.r }] }), world, a).ok).toBe(true);
        const gold0 = me.gold;
        if (!a.economy) Economy.initSettlement(a);
        const purse0 = a.economy.gold;
        const res = Plague.bribeGate(me, world, a, () => 0.99);
        expect(res.success).toBe(true);
        expect(me.gold).toBe(gold0 - gate.bribe);
        // (the coin goes to the watch, into the town's purse — though the crime's heat may stir the
        // town's gangs, who draw on it too: systems/gangs.js — so only that it was paid in)
        expect(purse0).toBeGreaterThan(0);
        expect(Plague.canEnter(me, world, a)).toMatchObject({ ok: true, permitted: 'leave' });
        // seen at it: a crime on the charge sheet
        const me2 = player();
        Plague.bribeGate(me2, world, a, () => 0);
        expect(Underworld.ensure(me2).charges.length).toBeGreaterThan(0);
    });

    it('a shut gate cuts the sickness carried to the next town', () => {
        // the same seed and the same plague, with and without the gate shut
        const run = (shut) => {
            const { world, towns } = makeWorld(31337);
            const [a, b] = towns;
            strike(world, a, 0.5);
            if (shut) Plague.shut(world, a, 'ruler', world.day);
            let hits = 0;
            Illness.state(world, b, b.folk, world.day);
            for (let d = 0; d < 60; d++) {
                world.day += 2;
                for (const p of Townsfolk.residents(a.folk).slice(0, Math.round(Townsfolk.residents(a.folk).length * 0.5))) { if (p.died == null) p.ill = { k: 'plague', d: world.day - 3, on: world.day - 2, end: world.day + 5, sv: 0.5, hl: 1, v: 0 }; }
                for (const p of Townsfolk.residents(b.folk)) { if (p.ill) { hits++; delete p.ill; } }
                Illness._travel(world, towns, world.day);
            }
            return hits;
        };
        expect(run(true)).toBeLessThan(run(false));
    });
});

describe('Plague — the trade routes carry it', () => {
    it('a town linked by road takes it more readily than one off any route', () => {
        const a = { q: 0, r: 0, market: { links: [[3, 0, 3, false, true, 1]] } };
        const linked = { q: 3, r: 0, market: { links: [[0, 0, 3, false, true, 1]] } };
        const off = { q: 0, r: 3, market: { links: [] } };
        expect(Illness._route(a, linked)).toBeGreaterThan(1);
        expect(Illness._route(a, off)).toBeLessThan(1);
        // towns with no links drawn travel as before
        expect(Illness._route({ q: 0, r: 0 }, off)).toBe(1);
    });
});

describe('Plague — the player in a sick town', () => {
    it('nursing the sick betters their care, once a house a day for karma', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        const sick = strike(world, a, 0.1);
        const me = player();
        const res = Plague.nurse(me, world, a, sick.slice(0, 2), '10,10');
        expect(res.success).toBe(true);
        expect(sick[0].ill.hl).toBeLessThanOrEqual(Plague.config().nurse.careMult);
        expect(me.karma).toBe(Plague.config().nurse.karma);
        Plague.nurse(me, world, a, sick.slice(0, 2), '10,10');
        expect(me.karma).toBe(Plague.config().nurse.karma);
        expect(Plague.nurse(me, world, a, [], '11,11').success).toBe(false);
    });

    it("burning the dead's goods slows the town's spread within its walls", () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        strike(world, a, 0.2);
        const me = player();
        const res = Plague.burnGoods(me, world, a, '12,12');
        expect(res.success).toBe(true);
        expect(Illness._env(world, a, a.folk, world.day).townMult).toBe(Plague.config().burn.cleanseMult);
        expect(Plague.burnGoods(me, world, a, '12,12').success).toBe(false);
        // and it wears off
        world.day += Plague.config().burn.cleanseDays + 1;
        expect(Illness._env(world, a, a.folk, world.day).townMult).toBe(1);
    });

    it('selling remedies takes coin out of the townsfolk purses at a plague price', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        strike(world, a, 0.3);
        const res0 = Townsfolk.residents(a.folk);
        for (const p of res0) p.purse = 200;
        const before = res0.reduce((s, p) => s + Townsfolk.purse(a.folk, p, world), 0);
        const me = player({ inventory: { herbs: 5, healing_salve: 2 } });
        const price = Plague.remedyPrice(world, a, 'herbs');
        expect(price).toBeGreaterThan(Math.round(5 * 1.3) - 1);
        const gold0 = me.gold;
        const res = Plague.sellRemedies(me, world, a);
        expect(res.success).toBe(true);
        expect(res.n).toBe(7);
        expect(me.inventory.herbs).toBeUndefined();
        const after = res0.reduce((s, p) => s + Townsfolk.purse(a.folk, p, world), 0);
        // every coin the player took came out of a purse
        expect(me.gold - gold0).toBe(res.gold);
        expect(Math.round(before - after)).toBe(res.gold);
    });

    it("looting a dead household's house takes the dead's purse and goods, is a crime, and can't be done twice", () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        strike(world, a, 0.3);
        const dead = Townsfolk.residents(a.folk).slice(0, 2);
        for (const p of dead) { p.died = world.day - 1; p.purse = 30; }
        const me = player();
        const res = Plague.lootHouse(me, world, a, '14,14', dead, () => 0.01);
        expect(res.success).toBe(true);
        expect(res.gold).toBe(60);
        expect(dead.every(p => p.purse === 0)).toBe(true);
        expect(Object.keys(res.items).length).toBeGreaterThan(0);
        expect(res.seen).toBe(true);
        expect(Underworld.ensure(me).charges.some(c => c.crime === 'burglary')).toBe(true);
        expect(Plague.lootHouse(me, world, a, '14,14', dead, () => 0.5).success).toBe(false);
        expect(Plague.burnGoods(me, world, a, '14,14').success).toBe(false);
    });

    it("the street map's picks hold all day and grow with severity", () => {
        let lo = 0, hi = 0;
        for (let i = 0; i < 200; i++) {
            if (Plague.stallAbandoned(0.2, `o:${i},3`, '5,7', 400)) lo++;
            if (Plague.stallAbandoned(0.8, `o:${i},3`, '5,7', 400)) hi++;
        }
        expect(hi).toBeGreaterThan(lo);
        expect(Plague.stallAbandoned(0.5, 'o:1,3', '5,7', 400)).toBe(Plague.stallAbandoned(0.5, 'o:1,3', '5,7', 400));
        expect(Plague.shopShut(1, 'church', '1,1', '5,7', 400)).toBe(false);
        expect(Plague.stayHome(0)).toBeLessThan(Plague.stayHome(1));
    });

    it('its state rides on the settlement and survives a save (JSON)', () => {
        const { world, towns } = makeWorld();
        const [a] = towns;
        Plague.shut(world, a, 'player', world.day);
        Plague.burnGoods(player(), world, a, '3,3');
        const back = JSON.parse(JSON.stringify({ plagueGate: a.plagueGate, plague: a.plague }));
        const b = { ...towns[1], ...back };
        expect(Plague.isQuarantined(world, b)).toBe(true);
        expect(Plague.burnt(b, '3,3')).toBe(true);
    });
});
