/**
 * A grave's life and what goes in the ground (world/burials.js, world/innerMap/graves.js,
 * systems/graveyards.js, systems/scavengers.js, ui/innerMapDigging.js):
 *   - caches: put in a hole, filled in, saved, dug up again (items back);
 *   - a robbed grave lies open with its marker still standing; filled in again (disturbed);
 *   - no hole is dug into a grave or mound in any state, the churchyard, a marker's tile;
 *   - grave goods come out when a grave is opened; robbing is a crime when seen;
 *   - NPC grave robbers (seeded, the goods into the market, the grave open, marker kept);
 *   - looters (kin keep, opportunists steal, the knocked-out player robbed and told).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Burials, Graveyards, GraveBook, SettlementMarket, StreetCrime, Scavengers, InnerMapDigging, NpcDisposition, InnerMapScavengers;

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
    ({ Burials } = await import('../world/burials.js'));
    ({ Graveyards } = await import('../systems/graveyards.js'));
    ({ GraveBook } = await import('../world/graveBook.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    ({ StreetCrime } = await import('../systems/streetCrime.js'));
    ({ Scavengers } = await import('../systems/scavengers.js'));
    ({ NpcDisposition } = await import('../systems/npcDisposition.js'));
    ({ InnerMapDigging } = await import('../ui/innerMapDigging.js'));
    ({ InnerMapScavengers } = await import('../ui/innerMapScavengers.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

const HEX = '5,6';
const Y = 120;

function person(id, o = {}) {
    return { id, first: `P${id}`, last: 'Digby', gender: 'male', born: -40 * Y, died: null, cause: null, role: 'villager', spouse: null, parents: [], kids: [], away: null, log: [], traits: [], ...o };
}

function setup(type = 'town') {
    const settlement = { name: 'Moundby', type, population: 2000, q: 5, r: 6, kingdom: 'k1', economy: { gold: 5000, food: 100, goods: 0, production: {} } };
    settlement.folk = { v: 1, q: 5, r: 6, n: 10, target: 10, tick: 0, people: Array.from({ length: 10 }, (_, i) => person(i)), annals: [] };
    SettlementMarket.ensure(settlement);
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 600, season: 'Spring', baseYear: 853, generationParams: { seed: 31, terrainGen: 5 }, activeEvents: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    const player = { gold: 100, name: 'Ada', inventory: {}, reputation: { k1: 0 }, lotHoldings: [], q: 5, r: 6, maxInventory: 20, children: [], skills: {} };
    const notes = [];
    const ui = { showNotification: (t, b) => notes.push(`${t}: ${b}`), updateStats() {}, showCustomPanel() {} };
    return { game: { world, player, ui }, world, player, settlement, notes };
}

/** A clear tile of bare ground with clear ground above it, away from doors and graves. */
function spot(skip = new Set()) {
    for (let r = 4; r < InnerMap.height - 4; r++) {
        for (let q = 4; q < InnerMap.width - 4; q++) {
            if (skip.has(`${q},${r}`)) continue;
            const t = InnerMap.getTile(q, r);
            if (!InnerMapDigging.canDig(t) || !InnerMap.burialHeadFree(q, r)) continue;
            return { q, r };
        }
    }
    return null;
}

/** Stand the player beside (q, r), still. */
function standBy(at) {
    InnerMap.playerInnerQ = at.q + 1;
    InnerMap.playerInnerR = at.r;
    InnerMap._playerWalking = false;
}

const finish = (ctx, kind, at) => InnerMapDigging._finish({ kind, q: at.q, r: at.r, game: ctx.game }, ctx.game);
const body = (o = {}) => ({ name: 'Wat Miller', type: 'villager', preset: null, q: 3, r: 3, day: 598, ...o });

describe('Caches: things buried in a hole', () => {
    it('put in a hole and filled in: buried on the world, saved, dug up again — the items back', () => {
        const ctx = setup();
        InnerMap.npcs = [];
        InnerMap.enter(ctx.game, 5, 6);
        InnerMap.npcs = [];
        const at = spot();
        expect(at).toBeTruthy();
        standBy(at);
        ctx.player.inventory = { iron: 3, wool: 2 };
        ctx.player.gold = 100;
        InnerMapDigging.setGround(InnerMap.getTile(at.q, at.r), 'hole', { day: 600 });
        expect(InnerMapDigging.canStash(at.q, at.r)).toBe(true);
        expect(InnerMapDigging.stash(ctx.game, at.q, at.r, 'iron', 3)).toBe(3);
        expect(InnerMapDigging.stash(ctx.game, at.q, at.r, 'gold', 40)).toBe(40);
        expect(ctx.player.inventory.iron).toBeUndefined();
        expect(ctx.player.gold).toBe(60);
        finish(ctx, 'fill', at);
        const c = Burials.cacheAt(ctx.world, HEX, at.q, at.r);
        expect(c).toMatchObject({ open: false, gold: 40, items: { iron: 3 } });
        expect(InnerMap.getTile(at.q, at.r)._dug.kind).toBe('filled');

        // Saved and loaded: the map drawn afresh, the cache still under the spot
        ctx.world.caches = JSON.parse(JSON.stringify(ctx.world.caches));
        ctx.world.day = 600 + Burials.config().ground.filledFadeDays + 5;
        InnerMap._cache = {};
        InnerMap.enter(ctx.game, 5, 6);
        InnerMap.npcs = [];
        // (the turned earth has grown back over: nothing shows, the ground can be dug)
        expect(InnerMap.getTile(at.q, at.r)._dug).toBeFalsy();
        standBy(at);
        finish(ctx, 'dig', at);
        expect(ctx.player.inventory.iron).toBe(3);
        expect(ctx.player.gold).toBe(100);
        expect(Burials.cacheAt(ctx.world, HEX, at.q, at.r)).toBe(null);
        expect(ctx.notes.some(n => /Unearthed/.test(n))).toBe(true);
    });

    it('a body and things in the same hole: grave goods, out again when the grave is opened', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        InnerMap.npcs = [];
        const at = spot();
        standBy(at);
        ctx.player.inventory = { jewelry: 1 };
        InnerMapDigging.setGround(InnerMap.getTile(at.q, at.r), 'hole', { day: 600 });
        InnerMapDigging.stash(ctx.game, at.q, at.r, 'jewelry', 1);
        InnerMapDigging._buryBody(ctx.game, InnerMap.getTile(at.q, at.r), body(), 600);
        const g = Burials.at(ctx.world, HEX, at.q, at.r);
        expect(g.goods).toEqual({ items: { jewelry: 1 }, gold: 0 });
        expect(Burials.cacheAt(ctx.world, HEX, at.q, at.r)).toBe(null);
        // Dug up: open, the body still in it, the goods out to the player
        finish(ctx, 'exhume', at);
        expect(g.open).toBe(600);
        expect(g.body).toBeTruthy();
        expect(ctx.player.inventory.jewelry).toBe(1);
        expect(g.goods).toBeUndefined();
        expect(InnerMap.getTile(at.q, at.r)._dug).toBe(g);
        expect(InnerMap.getTile(at.q, at.r).subTerrain.passable).toBe(false);
    });

    it('whoever watched it buried may come back for it; the dig then finds it gone', () => {
        const ctx = setup();
        const c = Burials.openCache(ctx.world, '9,9', 3, 3, 600);
        c.items.iron = 5;
        Burials.closeCache(ctx.world, '9,9', 3, 3, 600, [{ id: 'n1', name: 'Tam' }]);
        let taken = null;
        for (let d = 601; d < 640 && !taken; d++) taken = Burials.processDay(ctx.world, d, { isTown: () => true }).find(e => e.kind === 'cacheTaken');
        expect(taken && taken.by).toBe('Tam');
        expect(Burials.isEmpty(c)).toBe(true);
        const res = Burials.digUpCache(ctx.world, '9,9', 3, 3);
        expect(res.taken.by).toBe('Tam');
        expect(Burials.cacheAt(ctx.world, '9,9', 3, 3)).toBe(null);
        // (the same days, the same story)
        const w2 = setup().world;
        const c2 = Burials.openCache(w2, '9,9', 3, 3, 600);
        c2.items.iron = 5;
        Burials.closeCache(w2, '9,9', 3, 3, 600, [{ id: 'n1', name: 'Tam' }]);
        let t2 = null;
        for (let d = 601; d < 640 && !t2; d++) t2 = Burials.processDay(w2, d, { isTown: () => true }).find(e => e.kind === 'cacheTaken');
        expect(c2.taken.day).toBe(c.taken.day);
    });

    it('caches are saved with the world', () => {
        const src = fs.readFileSync('src/systems/saveLoad.js', 'utf8');
        expect(src).toMatch(/caches: world\.caches/);
        expect(src).toMatch(/world\.caches = saveData\.caches/);
    });
});

describe('No hole is dug into a grave', () => {
    it('refuses a burial mound in every state, its marker tile, and the churchyard', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        InnerMap.npcs = [];
        const at = spot();
        const g = Burials.bury(ctx.world, HEX, at.q, at.r, body(), 600);
        ctx.player.inventory = { headstone: 1 };
        Burials.placeMarker(ctx.world, ctx.player, HEX, at.q, at.r, Burials.markerOptions(ctx.player)[0], 600, true);
        const days = [600, 640, 600 + Burials.config().settleDays + 10];
        for (const d of days) {
            InnerMap.layBurial(at.q, at.r, g, d);
            expect(InnerMapDigging.canDig(InnerMap.getTile(at.q, at.r))).toBe(false);
        }
        expect(InnerMapDigging.canDig(InnerMap.getTile(at.q, at.r - 1))).toBe(false);
        // unmarked and settled level, grown over: still the grave
        Burials.takeMarker(g, ctx.player, 600);
        InnerMap.clearBurialMarker(at.q, at.r);
        InnerMap.layBurial(at.q, at.r, g, 600 + Burials.config().settleDays * 2);
        expect(Burials.overgrown(g, 600 + Burials.config().settleDays * 2)).toBe(true);
        expect(InnerMapDigging.canDig(InnerMap.getTile(at.q, at.r))).toBe(false);
        // open
        Burials.openGrave(g, 700, true);
        InnerMap.layBurial(at.q, at.r, g, 700);
        expect(InnerMapDigging.canDig(InnerMap.getTile(at.q, at.r))).toBe(false);
        // refilled
        Burials.refillGrave(g, 701);
        InnerMap.layBurial(at.q, at.r, g, 701);
        expect(InnerMapDigging.canDig(InnerMap.getTile(at.q, at.r))).toBe(false);
        // The churchyard: every tile of it, a plot open or not
        const yard = InnerMap.townYard();
        if (yard) {
            for (let r = yard.r0; r <= yard.r1; r++) for (let q = yard.q0; q <= yard.q1; q++) {
                expect(InnerMapDigging.canDig(InnerMap.getTile(q, r))).toBe(false);
            }
        }
        // Nor in front of a door, nor under someone's feet
        let door = null;
        for (const row of InnerMap.tiles) for (const t of row) if (!door && t && t._doorMarker) door = t;
        if (door) expect(InnerMapDigging.canDig(InnerMap.getTile(door.q, door.r + 1))).toBe(false);
        const free = spot(new Set([`${at.q},${at.r}`]));
        InnerMap.npcs = [{ id: 1, q: free.q, r: free.r, state: 'idle' }];
        expect(InnerMapDigging.canDig(InnerMap.getTile(free.q, free.r))).toBe(false);
        InnerMap.npcs = [];
        expect(InnerMapDigging.canDig(InnerMap.getTile(free.q, free.r))).toBe(true);
    });

    it('a hole left open caves in; turned earth fades back into the ground', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        InnerMap.npcs = [];
        const at = spot();
        InnerMapDigging.setGround(InnerMap.getTile(at.q, at.r), 'hole', { day: 600 });
        const G = Burials.config().ground;
        InnerMap._bindBurials(ctx.world, HEX, 600 + G.holeCaveDays);
        expect(InnerMap.getTile(at.q, at.r)._dug.kind).toBe('filled');
        InnerMap._bindBurials(ctx.world, HEX, 600 + G.holeCaveDays + G.filledFadeDays);
        expect(InnerMap.getTile(at.q, at.r)._dug).toBeFalsy();
        expect(InnerMap.getTile(at.q, at.r).subTerrain.passable).toBe(true);
    });

    it('a dig set on one map is dropped when the player leaves it', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        const job = { kind: 'dig', q: 3, r: 3, t: null, key: 'elsewhere|0', game: ctx.game };
        InnerMapDigging._job = job;
        InnerMapDigging.update(0.1, ctx.game);
        expect(InnerMapDigging._job).toBe(null);
    });
});

describe('The churchyard: robbed, it lies open with its marker', () => {
    function plotWith(ctx, extra = {}) {
        Graveyards.ensure(ctx.world, ctx.settlement);
        const town = Graveyards.ground(ctx.settlement, 'town');
        const i = GraveBook.freePlots(town)[0];
        town.plots[i] = { id: 'rob', name: 'Rich Man', died: 0, until: null, marker: 'headstone_carved', cls: 'rich', goods: 2, ...extra };
        return { town, i };
    }

    it('robbing opens the grave: the goods come out, the marker stays (askew), the body stays', () => {
        const ctx = setup();
        const { town, i } = plotWith(ctx);
        Utils.setSeed(1);
        const res = Graveyards.robGrave(ctx.player, ctx.world, ctx.settlement, 'town', i, { witnesses: 0, guards: 0, hour: 2 });
        const gr = town.plots[i];
        expect(gr).toBeTruthy();
        expect(gr.open).toBe(600);
        expect(gr.marker).toBe('headstone_carved');
        expect(gr.askew).toBe(true);
        if (res.success) {
            expect(ctx.player.inventory.grave_goods).toBe(2);
            expect(gr.goods).toBe(0);
            expect(ctx.player.inventory.bones).toBeUndefined();
        }
        expect(GraveBook.markerNow(gr, 600)).toBe('headstone_carved');
        // On the map: the marker still stands over the open pit
        InnerMap.enter(ctx.game, 5, 6);
        const yard = InnerMap.townYard();
        if (yard && yard.plots[i]) {
            const head = InnerMap.getTile(yard.plots[i].q, yard.plots[i].r);
            expect(head._graveShow.open).toBe(true);
            expect(head._graveShow.marker).toBe('headstone_carved');
        }
    });

    it('seen at it, the robber is caught: fined, standing lost', () => {
        const ctx = setup();
        const { i } = plotWith(ctx);
        const res = Graveyards.robGrave(ctx.player, ctx.world, ctx.settlement, 'town', i, { witnesses: 30, guards: 5, hour: 12 });
        expect(res.caught).toBe(true);
        expect(ctx.player.reputation.k1).toBeLessThan(0);
        expect(ctx.player.criminalRecord.theft).toBe(1);
    });

    it('filled in again by the player or the sexton: intact, disturbed a while; the town talks of the robbery', () => {
        const ctx = setup();
        const { town, i } = plotWith(ctx);
        Graveyards.robGrave(ctx.player, ctx.world, ctx.settlement, 'town', i, { witnesses: 0, guards: 0, hour: 2 });
        const r = Graveyards.refillGrave(ctx.world, ctx.settlement, 'town', i);
        expect(r.success).toBe(true);
        expect(town.plots[i].open).toBe(null);
        expect(town.plots[i].disturbed).toBe(600);
        expect(town.plots[i].askew).toBe(false);
        expect(Graveyards.graveAt(ctx.world, ctx.settlement, 'town', i).disturbed).toBe(true);
        // Left open, the sexton fills it in after refillDays and the robbery is found
        const j = GraveBook.freePlots(town)[0];
        town.plots[j] = { id: 'rob2', name: 'Old Nan', died: 0, until: null, marker: 'cross_wood', cls: 'middling', goods: 1 };
        Graveyards.robGrave(ctx.player, ctx.world, ctx.settlement, 'town', j, { witnesses: 0, guards: 0, hour: 2 });
        Scavengers.mend(ctx.world, ctx.settlement, 600 + Burials.config().refillDays);
        expect(town.plots[j].open).toBe(null);
        expect(town.plots[j].found).toBe(600 + Burials.config().refillDays);
        expect(ctx.settlement.folk.annals.some(a => a.k === 'graveRobbed')).toBe(true);
    });

    it('a marker comes off only on purpose: pried up, a theft', () => {
        const ctx = setup();
        const { town, i } = plotWith(ctx);
        expect(Graveyards.pryableMarker(ctx.world, ctx.settlement, 'town', i)).toMatchObject({ item: 'carved_headstone' });
        Utils.setSeed(1);
        const res = Graveyards.pryMarker(ctx.player, ctx.world, ctx.settlement, 'town', i, { witnesses: 0, guards: 0, hour: 2 });
        if (res.success) {
            expect(ctx.player.inventory.carved_headstone).toBe(1);
            expect(town.plots[i].marker).toBe('grave_mound');
        }
    });
});

describe('NPC grave robbers', () => {
    function rich(ctx) {
        Graveyards.ensure(ctx.world, ctx.settlement);
        const town = Graveyards.ground(ctx.settlement, 'town');
        const i = GraveBook.freePlots(town)[0];
        town.plots[i] = { id: 'rich', name: 'Lord Fat', died: 0, until: null, marker: 'headstone_carved', cls: 'rich', goods: 3 };
        // a crooked beggar in town
        ctx.settlement.folk.people[0].role = 'beggar';
        return { town, i };
    }

    it('rob on the nights the seed says, the same every time; none with no grave worth it', () => {
        const ctx = setup();
        const nights = d => Array.from({ length: 2000 }, (_, k) => d + k).filter(day => Scavengers.plan(ctx.world, ctx.settlement, day, null));
        expect(nights(600)).toEqual([]);   // (nothing buried with anyone)
        rich(ctx);
        const a = nights(600);
        expect(a.length).toBeGreaterThan(0);
        expect(a.length).toBeLessThan(200);   // a sane rate
        expect(nights(600)).toEqual(a);
        const plan = Scavengers.plan(ctx.world, ctx.settlement, a[0], null);
        expect(plan.robber.name).toBeTruthy();
    });

    it('the grave opened, its marker intact, the goods fenced into the market; seen, a crime on the record', () => {
        const ctx = setup();
        const { town, i } = rich(ctx);
        let day = 600;
        while (!Scavengers.plan(ctx.world, ctx.settlement, day, null)) day++;
        const plan = Scavengers.plan(ctx.world, ctx.settlement, day, null);
        const purse0 = ctx.settlement.folk.people.find(p => p.id === plan.robber.pid);
        const coin0 = purse0 ? purse0.purse || 0 : 0;
        const witness = { id: 77, name: 'Hob', type: 'villager', q: 0, r: 0 };
        const res = Scavengers.commit(ctx.world, ctx.settlement, plan, day, { seenBy: ['Hob'], witnesses: [witness] });
        const gr = town.plots[i];
        expect(gr.open).toBe(day);
        expect(gr.marker).toBe('headstone_carved');
        expect(gr.goods).toBe(0);
        expect(res.took.items.grave_goods).toBe(3);
        // (grave goods aren't market stock: sold to a fence, the coin out of the town's purse into the robber's)
        if (plan.robber.kind === 'townsfolk') expect(purse0.purse).toBeGreaterThan(coin0);
        expect(res.took.fenced).toBe(3);
        expect(ctx.settlement.npcCrimes.at(-1)).toMatchObject({ k: 'graveRobbing', by: plan.robber.name, caught: false });
        expect(NpcDisposition.getMemory(witness).sawNpc[0].by).toBe(plan.robber.name);
        // Not the same night again
        expect(Scavengers.plan(ctx.world, ctx.settlement, day, null)).toBe(null);
    });

    it('off the map, processDay robs (the watch sometimes catches them) and the sexton fills it in', () => {
        const ctx = setup();
        const { town, i } = rich(ctx);
        ctx.player.q = 99; // (the player is elsewhere)
        let day = 600, robbed = null;
        for (; day < 3000 && !robbed; day++) {
            ctx.world.day = day;
            robbed = Scavengers.processDay(ctx.world, ctx.player).events.find(e => e.kind === 'robbery');
        }
        expect(robbed).toBeTruthy();
        expect(town.plots[i].open != null || town.plots[i].disturbed != null).toBe(true);
        expect(town.plots[i].marker).toBe('headstone_carved');
        ctx.world.day += Burials.config().refillDays + 1;
        Scavengers.processDay(ctx.world, ctx.player);
        expect(town.plots[i].open).toBe(null);
    });

    it('a burial of the player\'s with goods, and a cache someone saw buried, tempt them too', () => {
        const ctx = setup();
        Burials.bury(ctx.world, HEX, 3, 3, body(), 600, null, { items: { jewelry: 2 }, gold: 30 });
        const c = Burials.openCache(ctx.world, HEX, 8, 8, 600);
        c.items.iron = 4;
        Burials.closeCache(ctx.world, HEX, 8, 8, 600, [{ id: 'x', name: 'Tam' }]);
        const t = Scavengers.targets(ctx.world, ctx.settlement, 610);
        expect(t.some(x => x.kind === 'burial')).toBe(true);
        expect(t.some(x => x.kind === 'cache')).toBe(true);
        const g = Burials.at(ctx.world, HEX, 3, 3);
        ctx.settlement.folk.people[0].role = 'beggar';
        const res = Scavengers.commit(ctx.world, ctx.settlement, { robber: { name: 'P0 Digby', kind: 'townsfolk', pid: 0 }, target: t.find(x => x.kind === 'burial') }, 610);
        expect(g.open).toBe(610);
        expect(g.robbed).toBe(610);
        expect(res.took).toMatchObject({ gold: 30, items: { jewelry: 2 } });
        expect(ctx.settlement.folk.people[0].purse).toBeGreaterThanOrEqual(30);
    });
});

describe('Looters', () => {
    it('kin keep a fallen one\'s things (no theft); opportunists loot; honest folk and the watch do not', () => {
        expect(Scavengers.looterKind({ type: 'villager' }, { rel: 'kin' })).toBe('kin');
        expect(Scavengers.isTheft('kin')).toBe(false);
        expect(Scavengers.looterKind({ type: 'guard' })).toBe('watch');
        expect(Scavengers.looterKind({ type: 'beggar' })).toBe('opportunist');
        expect(Scavengers.looterKind({ type: 'villager', personalityTraits: ['kind'] })).toBe('honest');
        expect(Scavengers.looterKind({ type: 'villager', personalityTraits: ['bold'] })).toBe('opportunist');
        expect(Scavengers.isTheft('opportunist')).toBe(true);
        // Deterministic
        const a = Array.from({ length: 40 }, (_, i) => Scavengers.willLoot('opportunist', `n${i}|v|600`));
        expect(Array.from({ length: 40 }, (_, i) => Scavengers.willLoot('opportunist', `n${i}|v|600`))).toEqual(a);
        expect(a.some(Boolean)).toBe(true);
        expect(Array.from({ length: 40 }, (_, i) => Scavengers.willLoot('honest', `n${i}|v|600`)).some(Boolean)).toBe(false);
    });

    it('coin and valuables first, then gear; what is worn stays', () => {
        const inv = { bread: 3, jewelry: 1, rope: 1, sword: 1 };
        const took = Scavengers.pickLoot(inv, 50, 'k', { worn: id => id === 'sword' });
        expect(took.gold).toBe(50);
        expect(took.items.jewelry).toBe(1);
        expect(Object.keys(took.items).length).toBe(2);
        expect(inv.sword).toBe(1);
        expect(inv.jewelry).toBeUndefined();
    });

    it('the knocked-out player loses their purse and is told; a witness tells who did it', () => {
        const ctx = setup();
        ctx.player.gold = 100;
        ctx.player.inventory = { jewelry: 2, bread: 1 };
        const looter = { id: 5, name: 'Grub', type: 'beggar' };
        const witness = { id: 6, name: 'Hob', type: 'villager' };
        const took = Scavengers.lootPlayer(ctx.player, looter, 600, { seenBy: ['Hob'] });
        expect(took.gold).toBe(60);
        expect(ctx.player.gold).toBe(40);
        expect(ctx.player.inventory.jewelry).toBeUndefined();
        const line = Scavengers.wakeLine(ctx.player);
        expect(line).toMatch(/purse/);
        expect(line).toMatch(/Hob saw who did it/);
        expect(ctx.player.lootedWhileOut).toBeUndefined();
        // The theft on the town's record; the witness tells the player who it was, once
        StreetCrime.recordNpcCrime(ctx.world, ctx.settlement, { k: 'loot', by: 'Grub', victim: 'Ada', vuid: 'player', d: 600, seenBy: ['Hob'], witnesses: [witness] });
        expect(StreetCrime.npcCrimeAgainst(ctx.settlement, 'player').by).toBe('Grub');
        expect(StreetCrime.npcCrimeLine(witness, ctx.player)).toMatch(/Grub/);
        expect(StreetCrime.npcCrimeLine(witness, ctx.player)).toBe(null);
        expect(ctx.settlement.folk.annals.some(a => a.k === 'looted')).toBe(true);
        // The ruler's watch catching the looter: all of it back
        ctx.player.lootedWhileOut = { by: 'Grub', caught: true, gold: 0, items: {} };
        expect(Scavengers.wakeLine(ctx.player)).toMatch(/watch caught/);
    });
});

describe('On the street map', () => {
    it('a looter kneels by someone senseless and goes through their things; seen by a guard, caught and it all goes back', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        const at = spot();
        const victim = { id: 501, name: 'Wat', type: 'merchant', q: at.q, r: at.r, state: 'unconscious', _purse: 20, _ko: { until: Infinity } };
        const looter = { id: 502, name: 'Grub', type: 'beggar', q: at.q + 1, r: at.r, state: 'idle' };
        InnerMap.npcs = [victim, looter];
        InnerMapScavengers.reset();
        // (the looter decides by a hash: the beggar's turn may not come at this seed, so ask the scan directly)
        looter._scav = { kind: 'opportunist', victim: { ref: victim, q: victim.q, r: victim.r, name: victim.name, npc: victim, body: false, key: 'n|wat' }, phase: 'go', t: 0, tries: 0 };
        InnerMapScavengers._updateLooters(0.1, ctx.game);
        expect(looter._scav.phase).toBe('kneel');
        InnerMapScavengers._updateLooters(10, ctx.game);
        expect(victim._koSearched).toBe(true);
        expect(victim._lootedBy).toMatchObject({ by: 'Grub', gold: 20, kin: false });
        expect(looter._purse).toBe(20);

        // Again, a guard standing by: caught, the purse back
        const v2 = { id: 503, name: 'Ann', type: 'merchant', q: at.q, r: at.r, state: 'unconscious', _purse: 15, _ko: { until: Infinity } };
        const l2 = { id: 504, name: 'Nick', type: 'beggar', q: at.q + 1, r: at.r, state: 'idle' };
        const guard = { id: 505, name: 'Sergeant', type: 'guard', q: at.q + 2, r: at.r + 1, state: 'idle' };
        InnerMap.npcs = [v2, l2, guard];
        l2._scav = { kind: 'opportunist', victim: { ref: v2, q: v2.q, r: v2.r, name: v2.name, npc: v2, body: false, key: 'n|ann' }, phase: 'kneel', t: 0, tries: 0 };
        InnerMapScavengers._updateLooters(10, ctx.game);
        expect(v2._lootedBy.caught).toBe(true);
        expect(v2._purse).toBe(15);
        expect(InnerMap.npcs.includes(l2)).toBe(false);
        expect(ctx.settlement.npcCrimes.at(-1)).toMatchObject({ k: 'loot', by: 'Nick', caught: true });
    });

    it('a robber at the graves digs one of the player burials open, marker kept; the player watching sees it on the record', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        InnerMap.npcs = [];
        const at = spot();
        const g = Burials.bury(ctx.world, HEX, at.q, at.r, body(), 600, null, { items: { jewelry: 1 }, gold: 10 });
        ctx.player.inventory = { headstone: 1 };
        Burials.placeMarker(ctx.world, ctx.player, HEX, at.q, at.r, Burials.markerOptions(ctx.player)[0], 600, true);
        InnerMap.layBurial(at.q, at.r, g, 600);
        const plan = { robber: { name: 'a body-snatcher', kind: 'snatcher' }, target: Scavengers.targets(ctx.world, ctx.settlement, 610).find(t => t.kind === 'burial'), day: 610 };
        const R = InnerMapScavengers._begin(ctx.game, ctx.settlement, plan, 'k', 610);
        expect(R).toBeTruthy();
        InnerMap.playerInnerQ = at.q + 2;
        InnerMap.playerInnerR = at.r;
        InnerMapScavengers._finishRobbery(ctx.game, ctx.settlement, R, 610);
        expect(g.open).toBe(610);
        expect(g.marker).toBe('headstone_plain');
        expect(InnerMap.getTile(at.q, at.r - 1).customObject).toBeTruthy();
        expect(ctx.settlement.npcCrimes.at(-1)).toMatchObject({ k: 'graveRobbing', seenBy: ['you'] });
        expect(ctx.notes.some(n => /Grave Robber/.test(n))).toBe(true);
    });
});
