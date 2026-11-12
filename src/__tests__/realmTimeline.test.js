// The Timeline of the Realm (systems/realmTimeline.js): the tile→realm grid
// recorded each season as deltas must reconstruct EXACTLY at every frame kept —
// over decades, through frame thinning and a save/load in the middle — the
// record must stay small over a century of churn, and a real game must record
// it through the day's turn and keep it across a save.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { RealmTimeline } from '../systems/realmTimeline.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

const W = 60, H = 40;

/** A small world the test owns: realms carving the map up, towns rising and falling. */
function mockWorld() {
    const kingdoms = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
        id, name: `Realm ${id.toUpperCase()}`, color: `#${(i * 37 + 40).toString(16).padStart(2, '0')}7744`, ruler: `King ${id}1`,
        isAlive: true, wars: [], capital: { q: 6 + i * 11, r: 20 },
    }));
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const water = r < 2 || r >= H - 2;
            row.push({ q, r, terrain: { id: water ? 'ocean' : 'plains', color: water ? '#224' : '#585' }, kingdom: water ? null : kingdoms[Math.min(4, Math.floor(q / 12))].id, settlement: null });
        }
        tiles.push(row);
    }
    const world = {
        width: W, height: H, day: 1, baseYear: 1, tiles, kingdoms, warHistory: [],
        getKingdom(id) { return this.kingdoms.find(k => k.id === id); },
        getTile(q, r) { return r >= 0 && r < H ? this.tiles[r][((q % W) + W) % W] : null; },
        getSettlementViews() {
            const out = [];
            for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) { const s = this.tiles[r][q].settlement; if (s) { s.q = q; s.r = r; out.push(s); } }
            return out;
        },
    };
    for (let i = 0; i < 12; i++) world.tiles[5 + i * 2][4 + i * 4].settlement = { name: `Town ${i}`, type: 'town' };
    return world;
}

/** One day of churn: a border shifts, a war starts or ends, a ruler dies, a town rises or falls. */
function churn(world, player) {
    const K = world.kingdoms;
    if (Utils.random() < 0.25) {
        const k = K[Utils.randInt(0, K.length - 1)];
        if (k.isAlive) {
            const q0 = Utils.randInt(0, W - 4), r0 = Utils.randInt(2, H - 6);
            for (let r = r0; r < r0 + 3; r++) for (let q = q0; q < q0 + 3; q++) world.tiles[r][q].kingdom = k.id;
        }
    }
    if (Utils.random() < 0.01) {
        const a = K[Utils.randInt(0, 4)], b = K[Utils.randInt(0, 4)];
        if (a !== b && a.isAlive && b.isAlive) {
            if (a.wars.includes(b.id)) {
                a.wars = a.wars.filter(x => x !== b.id); b.wars = b.wars.filter(x => x !== a.id);
                world.warHistory.push({ id: world.warHistory.length + 1, day: world.day, a: a.id, b: b.id, victor: a.id });
            } else { a.wars.push(b.id); b.wars.push(a.id); }
        }
    }
    if (Utils.random() < 0.004) { const k = K[Utils.randInt(0, 4)]; k.ruler = `King ${k.id}${world.day}`; }
    if (Utils.random() < 0.01) {
        const t = world.tiles[Utils.randInt(2, H - 3)][Utils.randInt(0, W - 1)];
        t.settlement = t.settlement ? null : { name: `Newtown ${world.day}`, type: 'village' };
    }
    if (Utils.random() < 0.02) world.timelineFeed.push({ q: Utils.randInt(0, W - 1), r: Utils.randInt(2, H - 3), day: world.day, dead: Utils.randInt(20, 400), victor: 'Realm A', loser: 'Realm B' });
    if (player && Utils.random() < 0.01) {
        const keys = player.holdings.keys;
        if (keys.length > 3 || (keys.length && Utils.random() < 0.3)) keys.splice(Utils.randInt(0, keys.length - 1), 1);
        else keys.push(`${Utils.randInt(0, W - 1)},${Utils.randInt(2, H - 3)}`);
    }
    // A realm falls once, late
    if (world.day === 3000) { K[4].isAlive = false; K[4].wars = []; for (const k of K) k.wars = k.wars.filter(x => x !== 'e'); }
}

/** The grid as the record's codes, read straight off the world. */
function expectedGrid(world, st) {
    const codes = new Map(st.realms.map((r, i) => [r.id, i + 1]));
    const g = new Array(W * H).fill(0);
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) { const id = world.tiles[r][q].kingdom; if (id != null) g[r * W + q] = codes.get(id) || 0; }
    return g;
}

function holdingsOf(player) {
    return [...new Set(player.holdings.keys.map(k => { const [q, r] = k.split(',').map(Number); return r * W + q; }))].sort((a, b) => a - b);
}

/** Run `years` of days; returns the expected grid and holdings by frame day. */
function run(world, player, years, { saveAtYear = null } = {}) {
    const out = new Map();
    const days = years * 120;
    for (let i = 0; i < days; i++) {
        world.day++;
        RealmTimeline.state(world);
        churn(world, player);
        const res = RealmTimeline.processDay(world, player);
        const st = world.timeline;
        if (st.base && st.base.d === world.day) out.set(world.day, { grid: expectedGrid(world, st), hold: holdingsOf(player) });
        if (res && res.frame) out.set(world.day, { grid: expectedGrid(world, st), hold: holdingsOf(player) });
        if (saveAtYear != null && world.day === saveAtYear * 120) {
            // A save and a load: the record goes through JSON and its cache is rebuilt
            const json = JSON.stringify(RealmTimeline.serialize(world));
            RealmTimeline.restore(JSON.parse(json), world);
        }
    }
    return out;
}

function checkExact(world, exp) {
    const st = world.timeline;
    const pts = RealmTimeline.points(st);
    let prev = null;
    for (const p of pts) {
        const want = exp.get(p.day);
        if (!want) throw new Error(`no expectation for day ${p.day}`);
        const grid = RealmTimeline.gridAt(st, p.index, prev);
        prev = { index: p.index, grid };
        // (every tile, exactly)
        let bad = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] !== want.grid[i]) bad++;
        if (bad) throw new Error(`frame ${p.index} (day ${p.day}): ${bad} tiles differ`);
        if (p.index > 0) {
            const hold = RealmTimeline.holdingsAt(st, p.index);
            if (JSON.stringify(hold) !== JSON.stringify(want.hold)) throw new Error(`frame ${p.index} (day ${p.day}): holdings ${hold} ≠ ${want.hold}`);
        }
        // Replayed from the base too (not only from the previous frame)
        if (p.index % 37 === 0) expect(Array.from(RealmTimeline.gridAt(st, p.index))).toEqual(want.grid);
    }
    return pts.length;
}

let savedGd;
beforeAll(async () => {
    await loadData();
    savedGd = DataLoader._gamedata;
});
afterEach(() => { DataLoader._gamedata = savedGd; });

describe('the timeline records the borders exactly', () => {
    it('reconstructs every frame over forty years, through a save and load', () => {
        Utils.setSeed(4242);
        const world = mockWorld();
        const player = { name: 'Bot Harness', house: { name: 'House Harness' }, holdings: { keys: ['10,10'] } };
        const exp = run(world, player, 40, { saveAtYear: 17 });
        const st = world.timeline;
        expect(st.base.d).toBe(2);
        expect(st.frames.length).toBe(Math.floor((40 * 120 - 1) / 30));
        const n = checkExact(world, exp);
        expect(n).toBe(st.frames.length + 1);
        // The towns, the realms' rulers, the wars and the fall are on record
        expect(st.towns.some(t => t[3] != null)).toBe(true);
        expect(st.towns.some(t => t[4] != null)).toBe(true);
        expect(st.realms.find(r => r.id === 'e').f).toBe(3000);
        expect(st.events.some(e => e[1] === 'fall')).toBe(true);
        expect(st.events.some(e => e[1] === 'battle')).toBe(true);
        expect(st.wars.length).toBeGreaterThan(0);
        expect(st.realms.some(r => r.m.length > 1)).toBe(true);
        expect(st.lives).toEqual([[2, null, 'Bot Harness', 'House Harness']]);
        // A realm as of a day reads its ruler then
        const a = st.realms[0];
        if (a.m.length > 1) expect(RealmTimeline.realmAt(st, 1, a.m[1][0] - 1).ruler).toBe(a.m[0][3]);
    });

    it('stays exact when old frames are thinned (frames merged)', () => {
        DataLoader._gamedata = { ...savedGd, timeline: { ...(savedGd.timeline || {}), frameCap: 24 } };
        Utils.setSeed(99);
        const world = mockWorld();
        const player = { name: 'Bot', house: null, holdings: { keys: [] } };
        const exp = run(world, player, 30, { saveAtYear: 11 });
        const st = world.timeline;
        expect(st.frames.length).toBe(24);
        checkExact(world, exp);
        // Thinned evenly: no gap far wider than the rest, and the newest frame is the last day taken
        const days = st.frames.map(f => f[0]);
        const gaps = days.slice(1).map((d, i) => d - days[i]);
        expect(Math.max(...gaps)).toBeLessThanOrEqual(Math.min(...gaps) * 4);
        expect(days[days.length - 1]).toBe(Math.max(...exp.keys()));
    });

    it('holds the border changes to their byte budget, still exact', () => {
        DataLoader._gamedata = { ...savedGd, timeline: { ...(savedGd.timeline || {}), frameBytes: 12000 } };
        Utils.setSeed(31);
        const world = mockWorld();
        const player = { name: 'Bot', house: null, holdings: { keys: [] } };
        const exp = run(world, player, 30);
        const st = world.timeline;
        const bytes = st.frames.reduce((s, f) => s + f[1].length + 12, 0);
        expect(bytes).toBeLessThanOrEqual(12000);
        expect(st.frames.length).toBeLessThan(119); // (thirty years of seasons, thinned)
        checkExact(world, exp);
    });

    it('keeps a century of heavy churn small', () => {
        Utils.setSeed(7);
        const world = mockWorld();
        const player = { name: 'Bot', house: { name: 'House Bot' }, holdings: { keys: [] } };
        run(world, player, 100);
        const st = world.timeline;
        const bytes = RealmTimeline.bytes(world);
        // 400 frames of seasonal borders, ~1,200 battles merged, towns, rulers and wars in well under 100 KB
        expect(st.frames.length).toBeLessThanOrEqual(480);
        expect(st.events.length).toBeLessThanOrEqual(RealmTimeline.config().eventCap);
        expect(bytes).toBeLessThan(100 * 1024);
        console.info(`timeline: a century of churn → ${(bytes / 1024).toFixed(1)} KB, ${st.frames.length} frames, ${st.events.length} events, ${st.towns.length} towns, ${st.wars.length} wars`);
    });

    it('files the crises, sieges and the crown with their places, and the strip shows them', () => {
        const world = mockWorld();
        world.day = 100;
        const player = { name: 'Bot', house: { name: 'House Bot' }, holdings: { keys: [] }, realmWars: { besieged: {} }, throne: null };
        RealmTimeline.processDay(world, player);
        world.day = 101;
        world.crises = { v: 1, history: [], news: [{ key: 'crisis:plague1:2', kind: 'crisis_grave', day: 101, text: 'The plague reaches Town 3.', q: 16, r: 11 }],
            active: { uid: 'plague1', kind: 'plague', name: 'Great Plague', startDay: 101, endDay: null, place: { q: 16, r: 11 }, log: [] } };
        player.realmWars.besieged['20,9'] = { q: 20, r: 9, kingdomName: 'Realm C' };
        player.throne = { ruling: { kingdomId: 'b' } };
        RealmTimeline.processDay(world, player);
        world.day = 102;
        RealmTimeline.processDay(world, player); // (filed once, not again)
        const st = world.timeline;
        const kinds = st.events.map(e => e[1]);
        expect(kinds.filter(k => k === 'crisis').length).toBe(2);
        expect(st.events.find(e => e[4] === 'The Great Plague began.')).toEqual([101, 'crisis', 16, 11, 'The Great Plague began.', 50, 1]);
        expect(st.events.filter(e => e[1] === 'siege')).toEqual([[101, 'siege', 20, 9, 'Realm C laid siege to a holding.', 20, 1]]);
        expect(st.events.find(e => e[1] === 'crown')[4]).toBe('Bot took the crown of Realm B.');
        world.crises.history.push(world.crises.active);
        world.crises.active.endDay = 400;
        world.crises.active = null;
        world.day = 400;
        RealmTimeline.processDay(world, null);
        expect(st.ages).toEqual([['plague1', 'plague', 'Great Plague', 101, 400, 16, 11]]);
        expect(st.lives).toEqual([[100, 400, 'Bot', 'House Bot']]);
        const strip = RealmTimeline.strip(world, st);
        expect(strip.lanes.map(l => l.id)).toEqual(['ages', 'lives', 'wars']);
        expect(strip.lanes[0].spans[0]).toMatchObject({ from: 101, to: 400, label: 'Great Plague', icon: '☠️' });
        expect(RealmTimeline.pointFor(st, 101)).toBe(0); // (the nearest frame: the next lies a season and more away)
        expect(RealmTimeline.pointFor(st, 380)).toBe(1);
    });

    it('a new save without a record starts recording on load, the player gone does not stop it', () => {
        const world = mockWorld();
        world.day = 5000;
        RealmTimeline.restore(null, world);
        expect(world.timeline).toBe(null);
        RealmTimeline.processDay(world, null);
        expect(world.timeline.base.d).toBe(5000);
        expect(world.timeline.start).toBe(5000);
        world.day += 30;
        expect(RealmTimeline.processDay(world, null).frame[0]).toBe(5030);
        expect(world.timeline.lives).toEqual([]);
    });
});

describe('a real game records the timeline', () => {
    it('through the day\'s turn, and keeps it across a save', () => {
        const game = newGame(11);
        // (the bot kept fed and rested: a death stops the day's turn short)
        const fed = (g) => { for (const k of Object.keys(g.player.needs || {})) g.player.needs[k] = 100; g.player.health = g.player.maxHealth || 100; g.player.starvationDays = 0; g.player.food = Math.max(g.player.food || 0, 20); };
        for (let i = 0; i < 95; i++) { fed(game); endDay(game); }
        const st = game.world.timeline;
        expect(st && st.base).toBeTruthy();
        expect(st.frames.length).toBeGreaterThanOrEqual(2);
        expect(st.lives.length).toBe(1);
        const codes = new Map(st.realms.map((r, i) => [r.id, i + 1]));
        // The last frame's grid is the world's as of that day — check today's against a fresh capture
        const now = RealmTimeline.gridNow(game.world, st);
        let owned = 0;
        for (let r = 0; r < game.world.height; r++) for (let q = 0; q < game.world.width; q++) {
            const id = game.world.tiles[r][q].kingdom;
            expect(now[r * game.world.width + q]).toBe(id != null ? (codes.get(id) || 0) : 0);
            if (id != null) owned++;
        }
        expect(owned).toBeGreaterThan(100);
        const last = RealmTimeline.gridAt(st, st.frames.length);
        const g2 = roundTrip(game);
        const st2 = g2.world.timeline;
        expect(st2.frames.length).toBe(st.frames.length);
        expect(Array.from(RealmTimeline.gridAt(st2, st2.frames.length))).toEqual(Array.from(last));
        // The record is a small share of the save
        const bytes = RealmTimeline.bytes(g2.world);
        expect(bytes).toBeLessThan(20 * 1024);
        console.info(`timeline after ${game.world.day} days: ${(bytes / 1024).toFixed(1)} KB of a ${(g2.bytes / 1024).toFixed(0)} KB save`);
        fed(g2);
        endDay(g2);
        expect(g2.world.timeline.frames.length).toBeGreaterThanOrEqual(3);
    }, 120000);
});
