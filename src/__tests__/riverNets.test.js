/**
 * Fishing nets the player sets and leaves (systems/riverNets.js; on the
 * street map ui/innerMapRiverDrift.js): across a river a net catches what
 * drifts down into it, like a weir of the player's own; every net takes fish
 * day by day, off the map too; nets tear and get stolen (deterministically);
 * hauled in, mended, taken up; kept in the save. And still water: a thing
 * thrown into a lake or pond floats where it lands, at sea the current takes
 * it, and a net out on still water gathers what was thrown in near it.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex, RiverDrift, RiverNets, InnerMapRiverDrift;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Hex } = await import('../core/hex.js'));
    ({ RiverDrift } = await import('../systems/riverDrift.js'));
    ({ RiverNets } = await import('../systems/riverNets.js'));
    ({ InnerMapRiverDrift } = await import('../ui/innerMapRiverDrift.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const innerMapData = () => DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8'));

let baseCfg;
beforeEach(() => {
    if (!baseCfg) baseCfg = DataLoader._gamedata.riverDrift;
    // (no thieves, no tears, unless a test asks for them)
    DataLoader._gamedata.riverDrift = { ...baseCfg, nets: { ...baseCfg.nets, theftChance: 0, townTheft: 0, tearChance: 0 } };
    InnerMap.initialize(innerMapData());
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    InnerMap.active = false;
    InnerMap._insideBuilding = null;
    InnerMap.timeOfDay = 10;
    InnerMap._timeAccumulator = 0;
    InnerMapRiverDrift._live.clear();
    InnerMapRiverDrift._liveTiles = null;
    InnerMapRiverDrift._lastNow = null;
    InnerMapRiverDrift._shown = [];
    InnerMapRiverDrift._fading = [];
    InnerMapRiverDrift._netCache.clear();
    Utils.setSeed(7);
});

const netsCfg = (over) => {
    DataLoader._gamedata.riverDrift = { ...baseCfg, nets: { ...baseCfg.nets, theftChance: 0, townTheft: 0, tearChance: 0, ...over } };
};

const HQ = 20, HR = 20;
const nb = (q, r, d) => Hex.neighbors(q, r)[d];

function makeWorld({ terrainAt = () => null, rivers = {}, extra = {}, gen = 3 } = {}) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const id = terrainAt(q, r) || 'grassland';
            const t = { q, r, terrain: { id, passable: !['ocean', 'lake'].includes(id) }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            if (extra[k]) Object.assign(t, extra[k]);
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    return {
        day: 3, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: gen }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => [],
        getKingdom: () => null,
    };
}

function westToSea(opts = {}) {
    const e = nb(HQ, HR, 0), w1 = nb(HQ, HR, 3), w2 = nb(w1.q, w1.r, 3), sea = nb(w2.q, w2.r, 3);
    const world = makeWorld({
        ...opts,
        terrainAt: (q, r) => (q === sea.q && r === sea.r ? 'ocean' : null),
        rivers: { [`${e.q},${e.r}`]: 3, [`${HQ},${HR}`]: 3, [`${w1.q},${w1.r}`]: 3, [`${w2.q},${w2.r}`]: 3 },
    });
    return { world, e, w1, w2, sea };
}

const player = (extra = {}) => ({ inventory: { fishing_net: 2, rope: 2, bread: 3 }, gold: 0, q: 0, r: 0, ships: [], ...extra });

describe('a net set across a river', () => {
    it('takes a net from the packs; one to a hex', () => {
        const { world, w1 } = westToSea();
        const p = player();
        expect(RiverNets.lay(world, { inventory: {} }, w1.q, w1.r, { water: 'river', frac: 0.5 }, 0).ok).toBe(false);
        const res = RiverNets.lay(world, p, w1.q, w1.r, { water: 'river', frac: 0.5 }, 0);
        expect(res.ok).toBe(true);
        expect(p.inventory.fishing_net).toBe(1);
        expect(RiverNets.lay(world, p, w1.q, w1.r, { water: 'river', frac: 0.5 }, 0).ok).toBe(false);
        // not on dry land
        expect(RiverNets.lay(world, p, HQ, HR + 6, { water: 'river' }, 0).ok).toBe(false);
    });

    it('catches what drifts down into it off the map; a full one lets the rest by', () => {
        netsCfg({ cap: 3 });
        const { world, w1, w2 } = westToSea();
        const p = player();
        const net = RiverNets.lay(world, p, w1.q, w1.r, { water: 'river', frac: 0.5 }, 0).net;
        const hph = RiverDrift.config().hoursPerHex;
        const things = [];
        for (let i = 0; i < 4; i++) things.push(RiverDrift.throwIn(world, HQ, HR, { itemId: 'bread', name: 'Bread' }, 0, { frac: 0 }).item);
        RiverDrift.advance(world, hph * 1.7);
        expect(net.catch.length).toBe(3);
        expect(net.catch[0].itemId).toBe('bread');
        const left = RiverDrift.state(world).items;
        expect(left.length).toBe(1);
        expect(left[0].netPast).toBe(true);
        RiverDrift.advance(world, hph * 2.2);
        expect([left[0].q, left[0].r]).toEqual([w2.q, w2.r]);
        expect(left[0].netPast).toBe(false);
    });

    it('meets the net before a weir set lower down the same hex', () => {
        const { world, w1 } = westToSea();
        world.getTile(w1.q, w1.r).infrastructure = { id: 'river_dam', name: 'Timber Dam', underConstruction: false };
        const net = RiverNets.lay(world, player(), w1.q, w1.r, { water: 'river', frac: 0.2 }, 0).net;
        RiverDrift.throwIn(world, HQ, HR, { itemId: 'bread' }, 0, { frac: 0 });
        RiverDrift.advance(world, 10);
        expect(net.catch.length).toBe(1);
        expect(RiverDrift.pileAt(world, w1.q, w1.r).length).toBe(0);
    });

    it('fishes day by day while you are away, the same each time; fish left too long are lost', () => {
        const run = () => {
            const { world, w1 } = westToSea();
            const net = RiverNets.lay(world, player(), w1.q, w1.r, { water: 'river', frac: 0.5 }, 0).net;
            for (let d = 1; d <= 2; d++) RiverNets.processDay(world, player(), d);
            return net;
        };
        const a = run(), b = run();
        expect(a.catch.length).toBeGreaterThan(0);
        expect(a.catch.map(e => [e.itemId, e.qty])).toEqual(b.catch.map(e => [e.itemId, e.qty]));
        const fishy = new Set(RiverNets.config().perishable);
        expect(a.catch.some(e => fishy.has(e.itemId))).toBe(true);
        // a fortnight on without hauling: only the last few days' fish are still in it, and it never overfills
        const { world, w1 } = westToSea();
        const net = RiverNets.lay(world, player(), w1.q, w1.r, { water: 'river', frac: 0.5 }, 0).net;
        RiverNets.processDay(world, player(), 14);
        const keep = RiverNets.config().fishKeepDays;
        for (const e of net.catch) if (fishy.has(e.itemId)) expect(14 * 24 + 24 - e.since).toBeLessThanOrEqual(keep * 24);
        expect(net.catch.length).toBeLessThanOrEqual(RiverNets.config().cap);
        expect(net.lastDay).toBe(14);
    });

    it('tears (and is mended with rope); is stolen while you are away, not while you stand by it', () => {
        netsCfg({ tearChance: 1 });
        const { world, w1 } = westToSea();
        const p = player();
        const net = RiverNets.lay(world, p, w1.q, w1.r, { water: 'river', frac: 0.5 }, 0).net;
        const n1 = RiverNets.processDay(world, p, 1).notices;
        expect(net.torn).toBe(true);
        expect(n1[0].title).toMatch(/Torn/);
        const before = net.catch.length;
        RiverNets.processDay(world, p, 2);
        expect(net.catch.length).toBeLessThanOrEqual(before); // a torn net catches nothing
        expect(RiverNets.mend(world, p, net.id).ok).toBe(true);
        expect(net.torn).toBe(false);
        expect(p.inventory.rope).toBe(1);

        netsCfg({ theftChance: 1, townTheft: 1 });
        const w = westToSea();
        const here = player({ q: w.w1.q, r: w.w1.r });
        RiverNets.lay(w.world, here, w.w1.q, w.w1.r, { water: 'river', frac: 0.5 }, 0);
        RiverNets.processDay(w.world, here, 1);
        expect(RiverNets.list(w.world).length).toBe(1);
        const away = player();
        const n2 = RiverNets.processDay(w.world, away, 2).notices;
        expect(RiverNets.list(w.world).length).toBe(0);
        expect(n2[0].title).toMatch(/Stolen/);
    });

    it('hauled in, then taken up back into the packs; kept in the save', () => {
        const { world, w1 } = westToSea();
        const p = player();
        const net = RiverNets.lay(world, p, w1.q, w1.r, { water: 'river', frac: 0.5 }, 0).net;
        RiverDrift.snare(world, { itemId: 'sticks', name: 'Sticks', qty: 3 }, net, 5);
        RiverDrift.snare(world, { itemId: 'leather_goods', name: 'Purse', qty: 1, coins: 7 }, net, 5);
        // the save keeps it
        const copy = { getTile: world.getTile };
        RiverDrift.restore(RiverDrift.serialize(world), copy);
        expect(RiverDrift.netAt(copy, w1.q, w1.r).catch.length).toBe(2);
        const res = RiverNets.haul(world, p, net.id);
        expect(res.got.length).toBe(2);
        expect(p.inventory.sticks).toBe(3);
        expect(p.gold).toBe(7);
        expect(net.catch.length).toBe(0);
        const up = RiverNets.takeUp(world, p, net.id);
        expect(up.ok).toBe(true);
        expect(p.inventory.fishing_net).toBe(2);
        expect(RiverNets.list(world).length).toBe(0);
    });
});

describe('still water', () => {
    it('a thing thrown into a pond floats where it landed, then sinks; a still net gathers what is near it', () => {
        const world = makeWorld();
        const { item } = RiverDrift.throwStill(world, HQ, HR, { itemId: 'bread' }, 0, { cell: { x: 30, y: 40 }, water: 'pond' });
        expect(item.state).toBe('rest');
        expect(item.where).toBe('still');
        RiverDrift.advance(world, 24);
        expect(RiverDrift.state(world).items.length).toBe(1);
        expect(RiverDrift.throwStill(world, HQ, HR, { itemId: 'stone' }, 0, { cell: { x: 1, y: 1 } }).sank).toBe(true);
        RiverDrift.advance(world, RiverDrift.config().restDays.still * 24 + 1);
        expect(RiverDrift.state(world).items.length).toBe(0);
        // a net out on the pond
        const net = RiverNets.lay(world, player(), HQ, HR, { water: 'pond', cell: { x: 30, y: 40 } }, 0).net;
        expect(net.still).toBe(true);
        RiverDrift.throwStill(world, HQ, HR, { itemId: 'bread' }, 30, { cell: { x: 32, y: 41 }, water: 'pond' });
        RiverDrift.throwStill(world, HQ, HR, { itemId: 'apples' }, 30, { cell: { x: 60, y: 41 }, water: 'pond' });
        RiverDrift.advance(world, 31);
        expect(net.catch.map(e => e.itemId)).toEqual(['bread']);
        // and it fishes the pond's fish
        RiverNets.processDay(world, player(), 3);
        const pondFish = new Set(RiverNets.config().fish.pond.map(f => f.item));
        expect(net.catch.slice(1).every(e => pondFish.has(e.itemId))).toBe(true);
    });

    it('at sea the current carries it off and it is lost', () => {
        const world = makeWorld();
        const { item } = RiverDrift.throwStill(world, HQ, HR, { itemId: 'bread' }, 0, { cell: { x: 30, y: 40 }, water: 'sea', cur: { x: 0.5, y: 0 } });
        expect(item.where).toBe('sea');
        const ev = RiverDrift.advance(world, RiverDrift.config().restDays.sea * 24 + 1);
        expect(ev[0].type).toBe('lost');
        expect(RiverDrift.state(world).items.length).toBe(0);
    });
});

// ── On the street map ──

const cells = (tiles, pred) => { const out = []; tiles.forEach((row, r) => row.forEach((t, q) => { if (pred(t, q, r)) out.push({ q, r, t }); })); return out; };
const _open = t => !!(t._wet && (t._ford || /water/.test((t.subTerrain && t.subTerrain.id) || '')));

function gameOn(world, inv = { bread: 3, fishing_net: 1, rope: 1 }) {
    const notes = [];
    return {
        world,
        player: { inventory: inv, ships: [], gold: 0, q: 0, r: 0 },
        ui: { showNotification: (t, x) => notes.push(`${t}: ${x}`), updateStats() {}, showCustomPanel() {}, hideCustomPanel() {} },
        notes,
    };
}

function enterMap(game, q = HQ, r = HR) {
    const tiles = InnerMap.generate(game.world.getTile(q, r), q, r, game);
    InnerMap.tiles = tiles;
    InnerMap.width = tiles[0].length;
    InnerMap.height = tiles.length;
    InnerMap.currentWorldTile = { q, r };
    InnerMap.active = true;
    return tiles;
}

describe('on the street map', () => {
    it('a net set across the river from its menu catches what floats down, and is hauled in', () => {
        const { world } = westToSea();
        const game = gameOn(world);
        game.player.q = HQ; game.player.r = HR;
        const tiles = enterMap(game);
        const netSpot = cells(tiles, t => t._flow && t._flow.run === 0 && t._flow.k > 70 && t._flow.k < 80 && !t._bridge && _open(t))[0];
        InnerMap.playerInnerQ = netSpot.q; InnerMap.playerInnerR = netSpot.r;
        const menu = InnerMapRiverDrift.menuItems(game, netSpot.t, netSpot.q, netSpot.r);
        const lay = menu.find(i => i.action === 'drift_net_lay');
        expect(lay).toBeTruthy();
        InnerMapRiverDrift.handle(game, lay, netSpot.q, netSpot.r);
        const net = RiverDrift.netAt(world, HQ, HR);
        expect(net).toBeTruthy();
        expect(game.player.inventory.fishing_net).toBeUndefined();
        const line = InnerMapRiverDrift.netLine(world, net);
        expect(line.b - line.a).toBeGreaterThan(3); // across the channel
        // throw something in upstream of it
        const up = cells(tiles, t => t._flow && t._flow.run === 0 && t._flow.k > 30 && t._flow.k < 40 && !t._bridge && _open(t))[0];
        InnerMap.playerInnerQ = up.q; InnerMap.playerInnerR = up.r;
        expect(InnerMapRiverDrift.throwItem(game, 'bread', up.q, up.r)).toBe(true);
        for (let i = 0; i < 300 && RiverDrift.state(world).items.some(it => it.itemId === 'bread'); i++) InnerMapRiverDrift.update(game, 0.5);
        expect(net.catch.some(e => e.itemId === 'bread')).toBe(true);
        expect(InnerMapRiverDrift._shown.some(s => s.kind === 'net')).toBe(true);
        // haul it in from the bank by it
        InnerMap.playerInnerQ = netSpot.q; InnerMap.playerInnerR = netSpot.r;
        const m2 = InnerMapRiverDrift.menuItems(game, netSpot.t, netSpot.q, netSpot.r);
        const haul = m2.find(i => i.action === 'drift_net_haul');
        expect(haul).toBeTruthy();
        InnerMapRiverDrift.handle(game, haul, netSpot.q, netSpot.r);
        expect(game.player.inventory.bread).toBe(3);
        expect(net.catch.length).toBe(0);
    });

    it('a thing thrown into a lake floats where it landed, and can be fished out again', () => {
        const world = makeWorld({ terrainAt: (q, r) => (q === HQ && r === HR ? 'lake' : null) });
        const game = gameOn(world, { bread: 2 });
        const tiles = enterMap(game);
        const deep = cells(tiles, (t, q, r) => InnerMap.isDivable(q, r));
        expect(deep.length).toBeGreaterThan(50);
        const spot = deep[Math.floor(deep.length / 2)];
        expect(InnerMapRiverDrift.isRiverCell(spot.q, spot.r)).toBe(false);
        expect(InnerMapRiverDrift.stillWaterAt(spot.q, spot.r)).toBe('lake');
        InnerMap.playerInnerQ = spot.q; InnerMap.playerInnerR = spot.r + 1;
        const menu = InnerMapRiverDrift.menuItems(game, spot.t, spot.q, spot.r);
        expect(menu.some(i => i.action === 'drift_throw')).toBe(true);
        expect(InnerMapRiverDrift.throwItem(game, 'bread', spot.q, spot.r)).toBe(true);
        const it = RiverDrift.state(world).items[0];
        expect(it.where).toBe('still');
        for (let i = 0; i < 20; i++) InnerMapRiverDrift.update(game, 0.5);
        const s = InnerMapRiverDrift._shown.find(x => x.item.id === it.id);
        expect(Math.hypot(s.x - spot.q, s.y - spot.r)).toBeLessThan(1);
        const take = InnerMapRiverDrift.menuItems(game, spot.t, spot.q, spot.r).find(i => i.action === 'drift_take');
        InnerMapRiverDrift.handle(game, take, spot.q, spot.r);
        expect(game.player.inventory.bread).toBe(2);
        expect(RiverDrift.state(world).items.length).toBe(0);
    });
});
