// Leftovers of the last pass, each with a reader:
//  1. known pirate havens (and lately sighted captains) on the chart — Pirates.mapMarkers / hexInfo
//  2. the tax collector's crown share reaches the kingdom's treasury out of the town's purse
//  3. the throne's appeal reads lord memory against world.day
//  4. a robbed map-owner accuses you when you wake in his town, not only on arrival
//  5. prison bribes booked under their own ledger category
//  6. a feast betrothal ignores the alliance reputation bar
//  7. Tavern._playDice is gone
//  8. celebrated / legendary players are begged for favours in towns
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Pirates } from '../systems/pirates.js';
import { Titles } from '../systems/titles.js';
import { CrownBooks } from '../world/crownBooks.js';
import { NPCLords } from '../world/npcLords.js';
import { Throne } from '../systems/throne.js';
import { RealmWars } from '../systems/realmWars.js';
import { MapTheft } from '../systems/mapTheft.js';
import { Prison } from '../player/prison.js';
import { Ledger } from '../systems/ledger.js';
import { Feasts } from '../systems/feasts.js';
import { Heirs } from '../systems/heirs.js';
import { Upbringing } from '../systems/upbringing.js';
import { Tavern } from '../player/tavern.js';
import { Fame } from '../systems/fame.js';
import { loadData, newGame } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    return () => logSpy.mockRestore();
});

beforeEach(() => Utils.setSeed(7));

const SRC = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

// ── 1. Pirate havens on the chart ─────────────────────────────

describe('pirate havens drawn on the map', () => {
    function rovers() {
        const game = newGame(101);
        const { world, player } = game;
        const st = Pirates.ensure(player, world);
        expect(st.havens.length).toBeGreaterThan(0);
        return { game, world, player, st };
    }

    it('only havens the player knows are marked, with their captains, strength and grudge', () => {
        const { world, player, st } = rovers();
        expect(Pirates.mapMarkers(player, world).filter(m => m.kind === 'haven')).toHaveLength(0);
        const h = st.havens[0];
        h.known = true;
        const cap = Pirates.atLarge(player)[0];
        cap.havenId = h.id;
        cap.met = 2;
        cap.regard = -40;
        const marks = Pirates.mapMarkers(player, world).filter(m => m.kind === 'haven');
        expect(marks).toHaveLength(1);
        expect(marks[0]).toMatchObject({ q: h.q, r: h.r, name: h.name, raidable: true });
        expect(marks[0].captains.map(c => c.name)).toContain(cap.name);
        expect(marks[0].captains.find(c => c.id === cap.id).grudge).toBe('sworn to drown you');
        const lines = Pirates.hexInfo(player, world, h.q, h.r);
        expect(lines[0]).toContain(h.name);
        expect(lines.join(' ')).toContain(cap.name);
        expect(lines.join(' ')).toMatch(/strength \d+/);
        expect(lines.join(' ')).toContain('Bring your ship alongside');
        // A raided haven shows as such until its hoard refills
        h.raidedDay = world.day || 0;
        expect(Pirates.mapMarkers(player, world).find(m => m.kind === 'haven').raidable).toBe(false);
        expect(Pirates.hexInfo(player, world, h.q, h.r)[0]).toMatch(/raided on day/);
    });

    it('a captain met at sea is marked where last sighted, and fades from the chart', () => {
        const { world, player } = rovers();
        const cap = Pirates.atLarge(player)[0];
        player.q = 12; player.r = 9;
        Pirates._sighted(cap, player, world);
        const s = Pirates.mapMarkers(player, world).find(m => m.kind === 'sighting');
        expect(s).toMatchObject({ q: 12, r: 9, name: cap.name });
        expect(Pirates.hexInfo(player, world, 12, 9)[0]).toContain('last sighted');
        world.day = (world.day || 0) + Pirates.config().sightingDays + 1;
        expect(Pirates.mapMarkers(player, world).some(m => m.kind === 'sighting')).toBe(false);
    });

    it('the raid action is offered beside a known haven; the renderer draws the markers', async () => {
        const { world, player, st } = rovers();
        const h = st.havens[0];
        h.known = true;
        // A ship on the water next to the haven
        const water = Hex.neighbors(h.q, h.r).map(n => world.getTile(Hex.wrapQ(n.q, world.width), n.r)).find(t => t && t.terrain && /water|ocean|sea|coast/.test(t.terrain.id));
        expect(water).toBeTruthy();
        player.ships = [{ id: 'sh', typeId: 'galleon', name: 'Test', q: water.q, r: water.r, status: 'at_sea', condition: 100, customizations: [], cargo: {}, crew: 40, morale: 70 }];
        player.boardedShip = 'sh';
        player.q = water.q; player.r = water.r;
        expect(Pirates.havenNear(player, world)).toBe(h);
        const { PlayerActions } = await import('../player/playerActions.js');
        const acts = PlayerActions.getAvailableActions(player, world.getTile(water.q, water.r), world);
        expect(acts.some(a => a.type === 'raid_haven')).toBe(true);

        const { Renderer } = await import('../ui/renderer.js');
        const calls = [];
        const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
        const fake = {
            player, world, hexSize: 30, camera: { zoom: 1, worldToScreen: (x, y) => ({ x: 100, y: 100 }) },
            canvas: { width: 800, height: 600 }, getHexPixelPos: () => ({ x: 0, y: 0 }),
            drawMapMarker: (c, icon) => calls.push(icon), drawMapText: (c, text) => calls.push(text),
        };
        Renderer.prototype.renderPirateHavens.call(fake, ctx);
        expect(calls).toContain('island');
        expect(calls).toContain(h.name);
        expect(src('ui/renderer/world.js')).toMatch(/this\.renderPirateHavens\(ctx\)/);
    });
});

// ── 2. The crown's share of the tax round ─────────────────────

describe('tax duty: the crown gets its share', () => {
    function taxWorld() {
        const tiles = [];
        for (let r = 0; r < 12; r++) {
            tiles.push([]);
            for (let q = 0; q < 12; q++) tiles[r].push({ q, r, terrain: { id: 'plains', passable: true } });
        }
        tiles[5][5].settlement = { name: 'Barleyford', type: 'town', kingdom: 'k1', population: 2000, economy: { gold: 5000 } };
        const kingdom = { id: 'k1', name: 'Arden', treasury: 1000, isAlive: true };
        return {
            day: 40, width: 12, height: 12, tiles, generationParams: { seed: 7 }, kingdoms: [kingdom],
            getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
            getKingdom: (id) => (id === 'k1' ? kingdom : null),
        };
    }
    const collector = () => ({
        name: 'Tester', gold: 0, karma: 0, renown: 0, health: 100, currentTitle: 'tax_collector', allegiance: 'k1',
        titleProgress: Titles._resetProgress('tax_collector'), reputation: { k1: 0 }, skills: { commerce: 1 }, q: 5, r: 5,
    });

    it('a fair collection moves the levy from the town purse into the treasury, booked on the tax lines', () => {
        const world = taxWorld();
        const tile = world.getTile(5, 5);
        const k = world.kingdoms[0];
        const p = collector();
        const res = Titles.collectTaxAtSettlement(p, tile, world, 'fair');
        expect(res.success).toBe(true);
        expect(res.crown).toBe(res.levy);
        expect(k.treasury).toBeCloseTo(1000 + res.levy, 0);
        // No coin is minted: the town paid the levy and the collector's fee
        expect(tile.settlement.economy.gold).toBeCloseTo(5000 - res.levy - res.fee, 1);
        const lines = CrownBooks.state(k).day;
        expect(lines.land + lines.poll + lines.excise).toBeCloseTo(res.levy, 1);
    });

    it('a skim comes out of the crown\'s share', () => {
        const world = taxWorld();
        const k = world.kingdoms[0];
        const res = Titles.collectTaxAtSettlement(collector(), world.getTile(5, 5), world, 'skim');
        expect(res.skim).toBeGreaterThan(0);
        expect(res.crown).toBe(res.levy - res.skim);
        expect(k.treasury).toBeCloseTo(1000 + res.levy - res.skim, 0);
    });

    it('a poor town pays only what its purse holds', () => {
        const world = taxWorld();
        const s = world.getTile(5, 5).settlement;
        s.economy.gold = 3;
        const res = Titles.collectTaxAtSettlement(collector(), world.getTile(5, 5), world, 'fair');
        expect(s.economy.gold).toBe(0);
        expect(res.crown).toBeLessThan(res.levy);
        expect(world.kingdoms[0].treasury).toBeLessThanOrEqual(1003);
    });

    it('squeezing a town the player does not hold sours it beyond the plain mood hit', () => {
        const world = taxWorld();
        const s = world.getTile(5, 5).settlement;
        s.happiness = 50;
        Titles.collectTaxAtSettlement(collector(), world.getTile(5, 5), world, 'squeeze');
        const m = Titles._taxCfg().modes.squeeze;
        expect(s.happiness).toBeCloseTo(50 + m.happiness - m.unrest * Titles._taxCfg().unheldUnrestHappiness, 5);
    });

    it('a tax riot shuts the crown\'s tax-house for a while (settlement.taxRevolt)', () => {
        const world = taxWorld();
        const s = world.getTile(5, 5).settlement;
        s.crownLevy = { day: 40, mode: 'squeeze', resentment: 6 };
        Utils.setRng(() => 0.01);
        const res = Titles.collectTaxAtSettlement(collector(), world.getTile(5, 5), world, 'squeeze');
        expect(res.riot).toBeTruthy();
        expect(s.taxRevolt).toBe(40 + Titles._taxCfg().riotRevoltDays);
        expect(res.crown).toBeLessThanOrEqual(Math.round(res.levy / 2));
    });
});

// ── 3. The throne reads memories against today ────────────────

describe('lord memories fade against world.day in every caller', () => {
    it('Throne.appeal passes world to getLordOpinion', () => {
        const spy = vi.spyOn(NPCLords, 'getLordOpinion');
        const world = { day: 500, kingdoms: [] };
        const kingdom = { id: 'k1', lord: { name: 'King', traits: [], memory: [] }, stability: 60 };
        const player = { reputation: {}, renown: 0, karma: 0 };
        try {
            Throne.appeal(player, world, kingdom);
            expect(spy).toHaveBeenCalledWith(kingdom.lord, player, world);
        } finally {
            spy.mockRestore();
        }
    });

    it('RealmWars.hostility reads memory on the day it is given', () => {
        const spy = vi.spyOn(NPCLords, 'memoryOpinion');
        try {
            RealmWars.hostility({ reputation: {} }, { id: 'k2', lord: { name: 'L', traits: [] } }, 321);
            expect(spy).toHaveBeenCalledWith(expect.anything(), 321);
        } finally {
            spy.mockRestore();
        }
    });

    it('no getLordOpinion caller in src leaves out world', () => {
        const files = [];
        const walk = (d) => {
            for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                if (f.isDirectory()) { if (f.name !== '__tests__') walk(path.join(d, f.name)); } else if (/\.(js|jsx)$/.test(f.name)) files.push(path.join(d, f.name));
            }
        };
        walk(SRC);
        const bad = [];
        for (const f of files) {
            for (const m of fs.readFileSync(f, 'utf8').matchAll(/getLordOpinion\(([^)]*)\)/g)) {
                if (/^\s*lord, player, world = null\s*$/.test(m[1])) continue; // the definition
                if (m[1].split(',').length < 3) bad.push(`${path.relative(SRC, f)}: ${m[0]}`);
            }
        }
        expect(bad).toEqual([]);
    });
});

// ── 4. Map theft: waking in the owner's town ──────────────────

describe('a robbed map-owner finds you at breakfast', () => {
    function world() {
        const tiles = new Map();
        const kingdom = { id: 'k1', name: 'Arden', territory: [] };
        const getTile = (q, r) => {
            const key = `${q},${r}`;
            if (!tiles.has(key)) tiles.set(key, { q, r, kingdom: 'k1', terrain: { id: 'plains', passable: true }, settlement: null });
            return tiles.get(key);
        };
        const w = { width: 60, height: 60, day: 20, generationParams: { seed: 3 }, units: [], kingdoms: [kingdom], getTile, getKingdom: () => kingdom };
        w.getTile(10, 10).settlement = { name: 'Harbourwick', type: 'town', kingdom: 'k1', population: 900 };
        return w;
    }

    it('found out while you stay in his town, he confronts you at the start of the day', async () => {
        const w = world();
        const p = { name: 'Ash', q: 10, r: 10, gold: 500, karma: 0, renown: 0, health: 100, charisma: 5, inventory: {}, reputation: { k1: 0 }, skills: { stealth: 3, diplomacy: 2 }, maps: [{ id: 'm1' }] };
        p.mapGrudges = [{
            id: 'mg_1', ownerKey: '10,10:cartographer', targetId: 'cartographer', owner: 'Master Vell', settlement: 'Harbourwick', q: 10, r: 10,
            kingdom: 'k1', mapIds: ['m1'], value: 50, day: 10, discoverDay: 12, discoverChance: 1, status: 'unaware',
        }];
        MapTheft.processDay(w, p);
        expect(p.mapGrudges[0].status).toBe('discovered');
        const { checkMapAccusation } = await import('../ui/actionMenu/treasureScenes.js');
        await import('../ui/actionMenu.js');
        const game = { player: p, world: w, endDay() {}, ui: { showCustomPanel() {}, hideCustomPanel() {}, showNotification() {}, updateStats() {} } };
        expect(checkMapAccusation(game)).toBe(true);
        expect(game._scene.kind).toBe('map_accusation');
        // ...and the day's end calls it for a player who did not move
        const end = src('ui/game/endDay.js');
        expect(end.match(/checkMapAccusation\(this\)/g).length).toBeGreaterThanOrEqual(2);
    });
});

// ── 5. Prison bribes on their own ledger line ────────────────

describe('prison bribes are booked as bribes', () => {
    it('the category exists, and the guard\'s bribe lands in it, not under bail', () => {
        expect(Ledger.category('bribes').name).toMatch(/Bribe/);
        const tiles = new Map();
        const kingdom = { id: 'k1', name: 'Arden', culture: 'Imperial' };
        const getTile = (q, r) => {
            const key = `${q},${r}`;
            if (!tiles.has(key)) tiles.set(key, { q, r, kingdom: 'k1', terrain: { id: 'plains', passable: true }, settlement: null });
            return tiles.get(key);
        };
        const w = { width: 40, height: 40, day: 30, generationParams: { seed: 11 }, units: [], kingdoms: [kingdom], getTile, getKingdom: () => kingdom, getAllSettlements: () => [] };
        w.getTile(5, 5).settlement = { name: 'Greyford', type: 'town', kingdom: 'k1', population: 800 };
        const p = {
            name: 'Ash', q: 5, r: 5, gold: 400, karma: 0, renown: 0, health: 100, strength: 6, charisma: 6, luck: 5,
            maxStamina: 10, stamina: 0, inventory: {}, reputation: { k1: 0 }, relationships: {}, travelParty: [],
            skills: { stealth: 3, combat: 3, diplomacy: 3 },
            jailState: { daysRemaining: 6, totalDays: 6, offense: 'theft', offenseNumber: 1, settlement: 'Greyford', bailCost: 120, escapeChance: 0.17 },
        };
        Utils.setRng(() => 0.01);
        const cost = Prison.bribeCost(p, w, 'lookaway');
        Prison.bribe(p, w, 'lookaway');
        expect(p.financeToday.expenses.bribes).toBe(cost);
        expect(p.financeToday.expenses.bail).toBeUndefined();
    });
});

// ── 6. Feast betrothal ────────────────────────────────────────

describe('a betrothal offered at a feast', () => {
    it('is accepted even where the House\'s reputation is below the alliance bar', () => {
        const kingdom = { id: 'k2', name: 'Belmarch', isAlive: true, culture: 'Imperial', lord: { name: 'King Osric', kingdomId: 'k2', traits: [], relationships: {} } };
        const world = { day: 40, kingdoms: [kingdom], generationParams: { seed: 4 }, getKingdom: (id) => (id === 'k2' ? kingdom : null) };
        const child = { id: 'c1', firstName: 'Elin', dynasty: 'Vane', isAlive: true, age: 18, gender: 'female', traits: [], skills: {} };
        Upbringing.ensure(child).comeOfAge = true;
        const player = { name: 'Aldric', gold: 5000, reputation: { k2: -60 }, children: [child], relationships: {} };
        // The plain alliance would be refused
        expect(Heirs.marryForAlliance({ ...player, children: [{ ...child }] }, world, 'c1', 'k2').success).toBe(false);
        Feasts.state(player).pending = { kind: 'betrothal', day: 40, kingdomId: 'k2', lord: 'King Osric' };
        const r = Feasts.acceptBetrothal(player, world, 'c1');
        expect(r.success).toBe(true);
        expect(Upbringing.ensure(child).spouse.kingdomId).toBe('k2');
        expect(Feasts.state(player).pending).toBeNull();
    });
});

// ── 7. Dead code ──────────────────────────────────────────────

describe('the tavern', () => {
    it('no longer carries the unused _playDice (dice go to the gambling den)', () => {
        expect(Tavern._playDice).toBeUndefined();
    });
});

// ── 8. Legends are asked for help ─────────────────────────────

describe('the famous are begged for favours', () => {
    function famous() {
        const game = newGame(101);
        const { world, player } = game;
        const views = world.getSettlementViews();
        const s = views.find(v => v.kingdom != null);
        const tile = world.getTile(s.q, s.r);
        player.q = s.q; player.r = s.r;
        player.renown = 400;
        player.reputation = { ...(player.reputation || {}), [tile.settlement.kingdom]: 90 };
        player.karma = 20;
        return { game, world, player, tile };
    }

    it('a legend arriving in towns now and then gets a real request, on its own stream', () => {
        const { world, player, tile } = famous();
        expect(Fame.stageIn(player, tile.settlement.kingdom).id).toBe('legend');
        const before = player.quests.active.length;
        let got = null;
        for (let d = 0; d < 400 && !got; d += 1) {
            world.day = 100 + d;
            Utils.setSeed(99);
            const ref = Utils.random();
            Utils.setSeed(99);
            got = Fame.townRequest(player, world, tile);
            // The shared stream is untouched by the request roll
            expect(Utils.random()).toBe(ref);
        }
        expect(got).toBeTruthy();
        expect(got.title).toContain(tile.settlement.name);
        expect(player.quests.active.length).toBe(before + 1);
        const q = player.quests.active.find(x => x.id === got.questId);
        expect(q.fameRequest.stage).toBe('legend');
        expect(Fame.openRequests(player)).toHaveLength(1);
        // One open favour at a time, and not again straight away
        expect(Fame.townRequest(player, world, tile)).toBeNull();
    });

    it('a stranger is never asked; the request is the same for the same day and town', () => {
        const { world, player, tile } = famous();
        const plain = { ...player, renown: 0, reputation: {}, karma: 0, fame: { towns: {} }, quests: { ...player.quests, active: [] } };
        for (let d = 0; d < 60; d++) {
            world.day = 100 + d;
            expect(Fame.townRequest(plain, world, tile)).toBeNull();
        }
        // Determinism: two identical legends on the same day get the same answer
        const mk = () => ({ ...player, fame: { towns: {} }, quests: { ...player.quests, active: [] } });
        let day = null;
        for (let d = 0; d < 400 && day == null; d++) {
            world.day = 100 + d;
            if (Utils.withRng(Fame._requestRng(world, tile), () => Utils.random()) < Fame.config().requests.chance.legend) day = world.day;
        }
        world.day = day;
        const a = Fame.townRequest(mk(), world, tile);
        const b = Fame.townRequest(mk(), world, tile);
        expect(a && a.text).toBe(b && b.text);
    });
});
