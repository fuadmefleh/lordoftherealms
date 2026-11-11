/**
 * The player's own burials off the churchyard (world/burials.js; laid on the
 * map by world/innerMap/graves.js): a bare mound until a marker is raised.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Burials, GraveBook, GraveArt, SettlementMarket, CustomObjects;

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
    ({ GraveBook } = await import('../world/graveBook.js'));
    ({ GraveArt } = await import('../world/graveArt.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    ({ CustomObjects } = await import('../world/customObjects.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

const HEX = '5,6';

function setup() {
    const settlement = { name: 'Moundby', type: 'town', population: 2000, q: 5, r: 6, kingdom: 'k1', economy: { gold: 5000, food: 100, goods: 0, production: {} } };
    SettlementMarket.ensure(settlement);
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 600, season: 'Spring', baseYear: 853, generationParams: { seed: 31, terrainGen: 5 }, activeEvents: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    const player = { gold: 100, name: 'Ada', inventory: {}, reputation: { k1: 0 }, lotHoldings: [], q: 5, r: 6, maxInventory: 20, children: [] };
    return { game: { world, player }, world, player, settlement };
}

const body = (o = {}) => ({ name: 'Wat Miller', type: 'villager', preset: { body: 'light' }, q: 3, r: 3, day: 598, _npc: { id: 9, name: 'Wat Miller', _person: { id: 42, born: -3000 }, self: null }, ...o });

describe('A burial of the player\'s', () => {
    it('is a nameless, unmarked mound; the dead are on the record, the parish told', () => {
        const { world, settlement } = setup();
        const g = Burials.bury(world, HEX, 3, 3, body(), 600, settlement);
        expect(g.kind).toBe('grave');
        expect(g.marker).toBe(null);
        expect(g.name).toBe('Wat Miller');
        expect(g.died).toBe(598);
        expect(g.pid).toBe(42);
        // (a plain body: nothing live is kept, it saves)
        expect(g.body._npc).toBeUndefined();
        expect(() => JSON.stringify(world.burials)).not.toThrow();
        expect(Burials.at(world, HEX, 3, 3)).toBe(g);
        expect(Burials.label(g, 600)).toBe('Burial Mound');
        expect(Burials.isLegible(g, 600)).toBe(false);
        expect(Burials.canMark(g, 600)).toBe(true);
        expect(GraveBook.of(settlement).buried[42]).toBe('player');
    });

    it('settles back into the ground over the days, the record kept', () => {
        const { world } = setup();
        const g = Burials.bury(world, HEX, 3, 3, body(), 600);
        const C = Burials.config();
        expect(C.settleDays).toBeGreaterThan(30);
        expect(Burials.moundAlpha(g, 600)).toBe(1);
        const mid = Burials.moundAlpha(g, 600 + C.settleDays / 2);
        expect(mid).toBeLessThan(1);
        expect(mid).toBeGreaterThan(C.minAlpha);
        expect(Burials.moundAlpha(g, 600 + C.settleDays * 3)).toBeCloseTo(C.minAlpha, 5);
        expect(Burials.overgrown(g, 600 + C.settleDays)).toBe(true);
        expect(Burials.label(g, 600 + C.settleDays)).toBe('Sunken Earth');
        expect(Burials.at(world, HEX, 3, 3)).toBe(g);
        expect(Burials.canMark(g, 600 + C.settleDays)).toBe(true);
    });

    it('a marker comes from the pack, or a cross is carved from the planks or wood carried', () => {
        const { player } = setup();
        expect(Burials.markerOptions(player)).toEqual([]);
        player.inventory = { wood: 2 };
        let opts = Burials.markerOptions(player);
        expect(opts).toHaveLength(1);
        expect(opts[0]).toMatchObject({ marker: 'cross_wood', how: 'carve', cost: { wood: 1 } });
        player.inventory = { wood: 2, planks: 1, headstone: 1 };
        opts = Burials.markerOptions(player);
        expect(opts.find(o => o.how === 'carve').cost).toEqual({ planks: 1 });
        expect(opts.find(o => o.how === 'item')).toMatchObject({ marker: 'headstone_plain', item: 'headstone' });
        // Every marker is a churchyard kind, with its art, and its item a good on sale
        const goods = DataLoader._gamedata.playerEconomy.GOODS;
        for (const [m, def] of Object.entries(Burials.config().markers)) {
            expect(GraveBook.markerDef(m)).toBeTruthy();
            expect(GraveArt.hasArt(m)).toBe(true);
            const good = Object.values(goods).find(x => x.id === def.item);
            expect(good && good.basePrice).toBeGreaterThan(0);
            expect(DataLoader._gamedata.markets.goods[def.item]).toBeTruthy();
            // made from something: a trade turns the town's wood or stone into it
            expect(DataLoader._gamedata.markets.recipes.some(r => r.out && r.out[def.item] && Object.keys(r.in || {}).length)).toBe(true);
        }
    });

    it('raising a marker uses it up and makes a named grave that reads as a churchyard one', () => {
        const { world, player } = setup();
        Burials.bury(world, HEX, 3, 3, body(), 600);
        expect(Burials.placeMarker(world, player, HEX, 3, 3, { marker: 'headstone_plain', how: 'item' }, 601).success).toBe(false);
        player.inventory = { headstone: 1 };
        const res = Burials.placeMarker(world, player, HEX, 3, 3, Burials.markerOptions(player)[0], 601, true);
        expect(res.success).toBe(true);
        expect(player.inventory.headstone).toBeUndefined();
        const g = res.grave;
        expect(g).toMatchObject({ marker: 'headstone_plain', markedDay: 601, head: true });
        expect(Burials.label(g, 601)).toBe('Grave of Wat Miller');
        expect(Burials.isLegible(g, 601)).toBe(true);
        expect(Burials.readLines(g, world, 601)[0]).toMatch(/^Wat Miller, /);
        // Only on a burial, and only one marker
        player.inventory = { grave_cross: 1 };
        expect(Burials.placeMarker(world, player, HEX, 3, 3, Burials.markerOptions(player)[0], 602).success).toBe(false);
        expect(Burials.placeMarker(world, player, HEX, 9, 9, Burials.markerOptions(player)[0], 602).success).toBe(false);
        expect(player.inventory.grave_cross).toBe(1);
    });

    it('a cross carved on the spot takes the wood; it rots in time, and the grave can be marked again', () => {
        const { world, player } = setup();
        const g = Burials.bury(world, HEX, 3, 3, body(), 600);
        player.inventory = { planks: 1, wood: 1 };
        const carve = Burials.markerOptions(player).find(o => o.how === 'carve');
        expect(Burials.placeMarker(world, player, HEX, 3, 3, carve, 600).success).toBe(true);
        expect(player.inventory).toEqual({ wood: 1 });
        // (a carve the player can't pay for is refused, the pack untouched)
        const g2 = Burials.bury(world, HEX, 4, 3, body({ name: 'Ann' }), 600);
        expect(Burials.placeMarker(world, player, HEX, 4, 3, { marker: 'cross_wood', how: 'carve', cost: { planks: 1 } }, 600).success).toBe(false);
        expect(player.inventory).toEqual({ wood: 1 });
        expect(g2.marker).toBe(null);
        const rot = GraveBook.config().aging.rotYears * GraveBook.config().daysPerYear;
        expect(Burials.markerNow(g, 600 + rot - 1)).toBe('cross_wood');
        expect(Burials.markerNow(g, 600 + rot)).toBe(null);
        expect(Burials.canMark(g, 600 + rot)).toBe(true);
    });

    it('dug up: the marker back to the pack, the burial off the record', () => {
        const { world, player } = setup();
        const g = Burials.bury(world, HEX, 3, 3, body(), 600);
        player.inventory = { grave_cross: 1 };
        Burials.placeMarker(world, player, HEX, 3, 3, Burials.markerOptions(player)[0], 600);
        expect(player.inventory.grave_cross).toBeUndefined();
        expect(Burials.takeMarker(g, player, 700)).toBe('grave_cross');
        expect(player.inventory.grave_cross).toBe(1);
        expect(Burials.unbury(world, HEX, 3, 3)).toBe(g);
        expect(Burials.at(world, HEX, 3, 3)).toBe(null);
        expect(world.burials[HEX]).toBeUndefined();
    });
});

describe('On the map', () => {
    /** A clear tile of bare ground with clear ground above it. */
    function spot() {
        for (let r = 4; r < InnerMap.height - 4; r++) {
            for (let q = 4; q < InnerMap.width - 4; q++) {
                const t = InnerMap.getTile(q, r);
                if (!t || !t.subTerrain || !t.subTerrain.passable || t.isRoad || t.customObject || t.customObjectPart || t.building || t.customBuilding || t._plotRef || t._doorMarker) continue;
                if (t._wet || t._sea || t._shallow || t._ford || /water/.test(t.subTerrain.id || '')) continue;
                if (!InnerMap.burialHeadFree(q, r)) continue;
                return { q, r };
            }
        }
        return null;
    }

    it('a burial lies as a mound, its marker stands at the head, and both come back on a map drawn afresh (and from a save)', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        const at = spot();
        expect(at).toBeTruthy();
        const g = Burials.bury(ctx.world, InnerMap._burialHex(), at.q, at.r, body(), 600);
        InnerMap.layBurial(at.q, at.r, g, 600);
        let t = InnerMap.getTile(at.q, at.r);
        expect(t._dug).toBe(g);
        expect(t.subTerrain.name).toBe('Burial Mound');
        expect(t.subTerrain.passable).toBe(true);
        expect(g.was && g.was.subTerrain).toBeTruthy();
        expect(InnerMap.getTile(at.q, at.r - 1).customObject).toBeFalsy();

        ctx.player.inventory = { grave_cross: 1 };
        const res = Burials.placeMarker(ctx.world, ctx.player, InnerMap._burialHex(), at.q, at.r, Burials.markerOptions(ctx.player)[0], 600, InnerMap.burialHeadFree(at.q, at.r));
        expect(res.success).toBe(true);
        InnerMap.layBurial(at.q, at.r, g, 600);
        const head = InnerMap.getTile(at.q, at.r - 1);
        expect(head.customObject && head.customObject.defId).toBe(GraveArt.defId('cross_wood'));
        expect(t.subTerrain.name).toBe('Grave of Wat Miller');
        // The marker answers for the grave below it
        expect(InnerMap.burialAt(at.q, at.r - 1)).toMatchObject({ q: at.q, r: at.r, grave: g });

        // Saved and loaded: the map is drawn again from nothing, the burial laid from the record
        const saved = JSON.parse(JSON.stringify(ctx.world.burials));
        ctx.world.burials = saved;
        InnerMap._cache = {};
        InnerMap.enter(ctx.game, 5, 6);
        t = InnerMap.getTile(at.q, at.r);
        expect(t._dug && t._dug.name).toBe('Wat Miller');
        expect(t._dug.marker).toBe('cross_wood');
        expect(InnerMap.getTile(at.q, at.r - 1).customObject.defId).toBe(GraveArt.defId('cross_wood'));

        // Taken down: the head is clear again
        InnerMap.clearBurialMarker(at.q, at.r);
        expect(InnerMap.getTile(at.q, at.r - 1).customObject).toBeFalsy();
    });

    it('an unmarked mound left long enough is grown over: the ground as it was, the record still there', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        const at = spot();
        const before = InnerMap.getTile(at.q, at.r).subTerrain.id;
        const g = Burials.bury(ctx.world, InnerMap._burialHex(), at.q, at.r, body(), 600);
        InnerMap.layBurial(at.q, at.r, g, 600);
        expect(InnerMap.getTile(at.q, at.r).subTerrain.id).toBe('grave');
        ctx.world.day = 600 + Burials.config().settleDays + 1;
        InnerMap._cache = {};
        InnerMap.enter(ctx.game, 5, 6);
        const t = InnerMap.getTile(at.q, at.r);
        expect(t.subTerrain.id).toBe(before);
        expect(t._dug).toBe(g);
    });

    it('burials are saved with the world', () => {
        const src = fs.readFileSync('src/systems/saveLoad.js', 'utf8');
        expect(src).toMatch(/burials: world\.burials/);
        expect(src).toMatch(/world\.burials = saveData\.burials/);
    });
});
