/**
 * Building by hand (world/handBuilding.js the model; world/innerMap/handBuilding.js
 * the ground and the standing; ui/innerMapHandBuild.js the mode): only on your own
 * ground, placement checked cell by cell, each stage's goods out of the packs as
 * it starts, work by the hour (faster with tools and hired hands), kept on the
 * world through a save, laid back on the map on entry, taken down for some goods
 * back, a hand-built gate that opens and shuts, a store, a coop's room, a
 * scarecrow's guard.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { HandBuilding } from '../world/handBuilding.js';
import { TownProps } from '../world/townProps.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Livestock } from '../systems/livestock.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const HEX = { q: 3, r: 4 };

/** A 24×20 meadow (a wilds map unless `town` is given), the player at (2, 18). */
function lay({ town = null } = {}) {
    const W = 24, H = 20;
    const tiles = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, q) => ({
        q, r, explored: true, visible: true, subTerrain: { id: 'grass', passable: true },
    })));
    InnerMap.active = true;
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    InnerMap._insideBuilding = null;
    InnerMap._underwater = false;
    InnerMap._outerMapState = null;
    InnerMap.buildings = [];
    InnerMap.roads = [];
    InnerMap.npcs = [];
    InnerMap.animals = [];
    InnerMap.currentWorldTile = { ...HEX };
    InnerMap._currentWorldTileRef = { ...HEX, settlement: town };
    InnerMap.playerInnerQ = 2;
    InnerMap.playerInnerR = 18;
    InnerMap._gateRec = null;
    InnerMap._npcGates = new Set();
    InnerMap._hbHomeCache = null;
    return tiles;
}

function player(inv = {}) {
    return { name: 'Aldo', gold: 50, inventory: { ...inv }, maxInventory: 20 };
}

function world() {
    return { day: 10 };
}

describe('only on your own ground', () => {
    beforeEach(() => lay());

    it('the open wilds are nobody\'s until you stake a camp; then its radius is yours', () => {
        const w = world();
        InnerMap._bindHandBuilt(w, `${HEX.q},${HEX.r}`);
        expect(InnerMap.handBuildGround(10, 10, w).ok).toBe(false);
        expect(InnerMap.handBuildCheck('fence', 10, 10, { world: w }).ok).toBe(false);
        expect(InnerMap.handBuildCampCheck(w).ok).toBe(true);
        expect(HandBuilding.stakeCamp(w, HEX.q, HEX.r, 10, 10).ok).toBe(true);
        const R = HandBuilding.config().ground.campRadius;
        expect(InnerMap.handBuildGround(10, 10, w)).toMatchObject({ ok: true, why: 'camp' });
        expect(InnerMap.handBuildGround(10 + R, 10, w).ok).toBe(true);
        expect(InnerMap.handBuildGround(10 + R + 1, 10, w).ok).toBe(false);
        // No camp in a town
        lay({ town: { name: 'Oakby', type: 'town', q: HEX.q, r: HEX.r } });
        expect(InnerMap.handBuildCampCheck(w).ok).toBe(false);
    });

    it('in town: your own lot, and the ground about a house you own (not one you rent), nowhere else', () => {
        const town = { name: 'Oakby', type: 'town', q: HEX.q, r: HEX.r, lotBook: { lots: { L1: { holder: 'player' }, L2: { holder: 'npc_1', holderName: 'Wat' } }, vacancies: {} } };
        const tiles = lay({ town });
        for (let r = 3; r <= 5; r++) for (let q = 3; q <= 6; q++) tiles[r][q]._lot = 'L1';
        for (let r = 3; r <= 5; r++) for (let q = 14; q <= 17; q++) tiles[r][q]._lot = 'L2';
        const w = world();
        InnerMap._bindHandBuilt(w, `${HEX.q},${HEX.r}`);
        expect(InnerMap.handBuildGround(4, 4, w)).toMatchObject({ ok: true, why: 'lot' });
        expect(InnerMap.handBuildGround(15, 4, w).ok).toBe(false);
        expect(InnerMap.handBuildGround(15, 4, w).reason).toMatch(/someone else/i);
        expect(InnerMap.handBuildGround(10, 14, w).ok).toBe(false);
        // A house of yours at (10, 14): its footprint q 9..11, r 12..14, and aroundHome beyond it
        InnerMap.buildings = [{ q: 10, r: 14, type: 'house', isPlayerOwned: true, ownerTitle: 'Owner' }];
        InnerMap._hbHomeCache = null;
        const A = HandBuilding.config().ground.aroundHome;
        expect(InnerMap.handBuildGround(11 + A, 14, w)).toMatchObject({ ok: true, why: 'home' });
        expect(InnerMap.handBuildGround(11 + A + 1, 14, w).ok).toBe(false);
        // Rented, it is not yours to build about
        InnerMap.buildings = [{ q: 10, r: 14, type: 'house', isPlayerOwned: true, ownerTitle: 'Tenant' }];
        InnerMap._hbHomeCache = null;
        expect(InnerMap.handBuildGround(12, 14, w).ok).toBe(false);
    });
});

describe('placement validity', () => {
    it('every cell of the footprint must be open dry ground with nobody on it', () => {
        const tiles = lay();
        const w = world();
        InnerMap._bindHandBuilt(w, `${HEX.q},${HEX.r}`);
        HandBuilding.stakeCamp(w, HEX.q, HEX.r, 10, 10);
        expect(InnerMap.handBuildFootprint('shed')).toEqual([3, 2]);
        expect(InnerMap.handBuildCheck('shed', 9, 10, { world: w }).ok).toBe(true);
        tiles[9][10].isRoad = true;
        expect(InnerMap.handBuildCheck('shed', 9, 10, { world: w }).reason).toMatch(/road/i);
        tiles[9][10].isRoad = false;
        tiles[10][11]._wet = true;
        expect(InnerMap.handBuildCheck('shed', 9, 10, { world: w }).reason).toMatch(/water/i);
        tiles[10][11]._wet = false;
        InnerMap.npcs = [{ name: 'Wat', q: 11, r: 9, state: 'idle' }];
        expect(InnerMap.handBuildCheck('shed', 9, 10, { world: w }).reason).toMatch(/standing/i);
        InnerMap.npcs = [];
        tiles[10][9].subTerrain = { id: 'tilled_soil', passable: true };
        expect(InnerMap.handBuildCheck('shed', 9, 10, { world: w }).ok).toBe(false);
        // …but a scarecrow stands on bare tilled soil — not on a crop
        expect(InnerMap.handBuildCheck('scarecrow', 9, 10, { world: w }).ok).toBe(true);
        expect(InnerMap.handBuildCheck('scarecrow', 9, 10, { world: w, cropAt: () => true }).reason).toMatch(/crop/i);
        // A door's step stays clear
        tiles[11][13]._doorMarker = { anchorQ: 13, anchorR: 11 };
        expect(InnerMap.handBuildCheck('fence', 13, 10, { world: w }).reason).toMatch(/door/i);
        // Over the camp's edge
        expect(InnerMap.handBuildCheck('shed', 16, 10, { world: w }).ok).toBe(false);
    });

    it('a site laid blocks its cells and nothing more can go there', () => {
        lay();
        const w = world();
        InnerMap._bindHandBuilt(w, `${HEX.q},${HEX.r}`);
        HandBuilding.stakeCamp(w, HEX.q, HEX.r, 10, 10);
        const res = InnerMap.layHandBuilt(w, 'shed', 9, 10, 10);
        expect(res.ok).toBe(true);
        for (const c of InnerMap.handBuildCells('shed', 9, 10)) {
            const t = InnerMap.getTile(c.q, c.r);
            expect(t._hb.id).toBe(res.rec.id);
            expect(t.subTerrain.passable).toBe(false);
        }
        expect(InnerMap.handBuiltAt(11, 9, w).id).toBe(res.rec.id);
        expect(InnerMap.handBuildCheck('fence', 10, 9, { world: w }).ok).toBe(false);
        expect(HandBuilding.at(w, HEX.q, HEX.r)).toHaveLength(1);
    });
});

describe('the work: goods by stage, hours, tools and hands', () => {
    it('each stage takes its goods from the packs as it starts, and work by the hour finishes it', () => {
        lay();
        const w = world();
        const p = player({ wood: 10, planks: 10, iron: 1, reeds: 8 });
        InnerMap._bindHandBuilt(w, `${HEX.q},${HEX.r}`);
        HandBuilding.stakeCamp(w, HEX.q, HEX.r, 10, 10);
        const { rec } = InnerMap.layHandBuilt(w, 'shed', 9, 10, 10);
        const d = HandBuilding.def('shed');
        // Nothing taken by laying the site
        expect(p.inventory.wood).toBe(10);
        const r1 = HandBuilding.work(w, p, rec, 1);
        expect(r1.ok).toBe(true);
        expect(r1.paid).toEqual(d.stages[0].needs);
        expect(p.inventory.wood).toBe(10 - d.stages[0].needs.wood);
        expect(p.inventory.planks).toBe(10);     // the walls' goods not yet
        expect(rec.progress).toBe(1);
        // The frame's hours done: on to the walls, which take their goods when started
        HandBuilding.work(w, p, rec, d.stages[0].hours);
        expect(rec.stage).toBe(1);
        expect(p.inventory.planks).toBe(10);
        HandBuilding.work(w, p, rec, 0.5);
        expect(p.inventory.planks).toBe(10 - d.stages[1].needs.planks);
        expect(p.inventory.iron).toBeUndefined();
        // Short of the roof's reeds: the work stops there
        HandBuilding.work(w, p, rec, d.stages[1].hours);
        expect(rec.stage).toBe(2);
        p.inventory.reeds = 2;
        const short = HandBuilding.work(w, p, rec, 1);
        expect(short.ok).toBe(false);
        expect(short.missing.reeds).toBe(d.stages[2].needs.reeds - 2);
        expect(rec.done).toBe(false);
        p.inventory.reeds = 8;
        const last = HandBuilding.work(w, p, rec, d.stages[2].hours);
        expect(last.finished).toBe(true);
        expect(rec.done).toBe(true);
        expect(HandBuilding.fraction(rec)).toBe(1);
        expect(HandBuilding.canWork(p, rec).ok).toBe(false);
    });

    it('tools and hands hired for the day make the same hour do more', () => {
        const w = world();
        const mk = () => HandBuilding.lay(w, 1, 1, 'well', 5, 5, 10).rec;
        const bare = mk();
        HandBuilding.work(w, player({}), bare, 1);
        const tooled = mk();
        HandBuilding.work(w, player({ tools: 1 }), tooled, 1);
        const helped = mk();
        const p = player({ tools: 1 });
        expect(HandBuilding.canHire(p, helped, w.day, 1).ok).toBe(true);
        HandBuilding.addHand(helped, w.day, { name: 'Wat' });
        HandBuilding.addHand(helped, w.day, { name: 'Hob' });
        expect(HandBuilding.canHire(p, helped, w.day, 1).ok).toBe(false);   // at most two
        HandBuilding.work(w, p, helped, 1);
        expect(tooled.progress).toBeGreaterThan(bare.progress);
        expect(helped.progress).toBeGreaterThan(tooled.progress);
        // Yesterday's hands have gone home
        const tomorrow = HandBuilding.speed(p, helped, w.day + 1);
        expect(tomorrow).toBe(HandBuilding.speed(p, tooled, w.day + 1));
    });
});

describe('finished structures on the map, kept with the save', () => {
    it('a finished fence and gate stand as town props; the gate opens and shuts and is kept', () => {
        lay();
        const w = world();
        const p = player({ wood: 20, planks: 4, iron: 2 });
        const hexKey = `${HEX.q},${HEX.r}`;
        InnerMap._bindHandBuilt(w, hexKey);
        InnerMap._bindGates(w, hexKey);
        HandBuilding.stakeCamp(w, HEX.q, HEX.r, 10, 10);
        const recs = [];
        for (const [kind, q] of [['fence', 8], ['gate', 9], ['fence', 10]]) {
            const res = InnerMap.layHandBuilt(w, kind, q, 12, 10);
            expect(res.ok).toBe(true);
            while (!res.rec.done) expect(HandBuilding.work(w, p, res.rec, 1).ok).toBe(true);
            InnerMap.refreshHandBuilt(res.rec);
            recs.push(res.rec);
        }
        const gate = InnerMap.getTile(9, 12).customObject;
        expect(gate.defId).toBe('tp_fence_gate');
        expect(gate.handBuilt).toBe(recs[1].id);
        expect(InnerMap.getTile(9, 12).subTerrain.passable).toBe(false);
        // the fence lengths joined to it, its gateposts
        expect(InnerMap.getTile(8, 12).customObject.defId).toBe('tp_fence_e');
        expect(InnerMap.getTile(10, 12).customObject.defId).toBe('tp_fence_w');
        expect(InnerMap.setGateOpen(9, 12, true)).toBe('opened');
        expect(InnerMap.getTile(9, 12).subTerrain.passable).toBe(true);
        // Saved and loaded, onto a fresh map of the same hex
        const data = JSON.parse(JSON.stringify(SaveLoad.serializeWorld({ ...w, tiles: [], kingdoms: [], units: [] })));
        expect(data.handBuilt.hexes[hexKey].items).toHaveLength(3);
        const w2 = { day: 11, gates: data.gates };
        HandBuilding.restore(data.handBuilt, w2);
        lay();
        expect(InnerMap.getTile(9, 12).customObject).toBeUndefined();
        expect(InnerMap._bindHandBuilt(w2, hexKey)).toBe(3);
        InnerMap._bindGates(w2, hexKey);
        expect(InnerMap.gateAt(9, 12).open).toBe(true);
        expect(InnerMap.getTile(8, 12).customObject.handBuilt).toBe(recs[0].id);
        expect(InnerMap.setGateOpen(9, 12, false)).toBe('shut');
        expect(InnerMap.getTile(9, 12).subTerrain.passable).toBe(false);
        // Laid twice (a map kept from the last visit): nothing doubled
        expect(InnerMap._bindHandBuilt(w2, hexKey)).toBe(3);
    });

    it('a hand-drawn shed blocks its cells after a reload, keeps its store, and a stale mark is cleared', () => {
        lay();
        const w = world();
        const p = player({ wood: 10, planks: 12, iron: 1, reeds: 8, grain: 30 });
        const hexKey = `${HEX.q},${HEX.r}`;
        InnerMap._bindHandBuilt(w, hexKey);
        HandBuilding.stakeCamp(w, HEX.q, HEX.r, 10, 10);
        const { rec } = InnerMap.layHandBuilt(w, 'shed', 9, 10, 10);
        while (!rec.done) HandBuilding.work(w, p, rec, 4);
        InnerMap.refreshHandBuilt(rec);
        expect(HandBuilding.putIn(p, rec, 'grain', 20)).toMatchObject({ ok: true, moved: 20 });
        expect(p.inventory.grain).toBe(10);
        const data = JSON.parse(JSON.stringify(SaveLoad.serializeWorld({ ...w, tiles: [], kingdoms: [], units: [] })));
        const w2 = {};
        HandBuilding.restore(data.handBuilt, w2);
        lay();
        InnerMap._bindHandBuilt(w2, hexKey);
        const back = HandBuilding.find(w2, HEX.q, HEX.r, rec.id);
        expect(back.store.grain).toBe(20);
        for (const c of InnerMap.handBuildCells('shed', 9, 10)) expect(InnerMap.getTile(c.q, c.r).subTerrain.passable).toBe(false);
        // Not taken down while it holds goods
        expect(HandBuilding.dismantle(w2, p, HEX.q, HEX.r, rec.id).ok).toBe(false);
        expect(HandBuilding.takeOut(p, back, 'grain', 20).ok).toBe(true);
        expect(p.inventory.grain).toBe(30);
        // Gone from the record (as if taken down elsewhere): the map's stale marks are cleared on entry
        w2.handBuilt.hexes[hexKey].items = [];
        InnerMap._bindHandBuilt(w2, hexKey);
        for (const c of InnerMap.handBuildCells('shed', 9, 10)) {
            const t = InnerMap.getTile(c.q, c.r);
            expect(t._hb).toBeUndefined();
            expect(t.subTerrain.passable).toBe(true);
        }
    });

    it('the save restores it (and older saves carry none)', () => {
        const src = fs.readFileSync(path.join(__dirname, '../systems/saveLoad.js'), 'utf8');
        expect(src).toMatch(/handBuilt: HandBuilding\.serialize\(world\)/);
        expect(src).toMatch(/HandBuilding\.restore\(saveData\.handBuilt, world\)/);
        const w = { handBuilt: { seq: 3, hexes: {} } };
        HandBuilding.restore(undefined, w);
        expect(w.handBuilt).toBeUndefined();
    });
});

describe('taking it down', () => {
    it('returns a share of the goods its stages took, and clears the ground', () => {
        lay();
        const w = world();
        const p = player({ stone: 20 });
        InnerMap._bindHandBuilt(w, `${HEX.q},${HEX.r}`);
        HandBuilding.stakeCamp(w, HEX.q, HEX.r, 10, 10);
        const { rec } = InnerMap.layHandBuilt(w, 'stone_wall', 10, 10, 10);
        while (!rec.done) HandBuilding.work(w, p, rec, 2);
        InnerMap.refreshHandBuilt(rec);
        const used = HandBuilding.totalNeeds('stone_wall').stone;
        expect(p.inventory.stone).toBe(20 - used);
        const share = HandBuilding.config().dismantle.finishedShare;
        const out = HandBuilding.dismantle(w, p, HEX.q, HEX.r, rec.id);
        expect(out.ok).toBe(true);
        expect(out.got.stone).toBe(Math.floor(used * share));
        expect(p.inventory.stone).toBe(20 - used + Math.floor(used * share));
        InnerMap._unstandHandBuilt(out.rec);
        expect(InnerMap.getTile(10, 10)._hb).toBeUndefined();
        expect(InnerMap.getTile(10, 10).subTerrain.passable).toBe(true);
        expect(HandBuilding.at(w, HEX.q, HEX.r)).toHaveLength(0);
        // A bare site (nothing laid out yet) gives nothing back
        const site = HandBuilding.lay(w, HEX.q, HEX.r, 'bench', 4, 4, 10).rec;
        expect(HandBuilding.salvage(site)).toEqual({});
    });
});

describe('what it gives', () => {
    it('a woodpile only takes wood; a coop adds room for hens at your place on the hex; a scarecrow guards crops near it', () => {
        const w = world();
        const p = player({ wood: 30, grain: 5 });
        const pile = HandBuilding.lay(w, 1, 1, 'woodpile', 5, 5, 10).rec;
        while (!pile.done) HandBuilding.work(w, p, pile, 1);
        expect(HandBuilding.putIn(p, pile, 'grain', 1).ok).toBe(false);
        expect(HandBuilding.putIn(p, pile, 'wood', 5).ok).toBe(true);
        // The coop
        expect(HandBuilding.roomOn(w, 1, 1).capacity).toBe(0);
        const coop = HandBuilding.lay(w, 1, 1, 'coop', 8, 5, 10).rec;
        const q = player({ wood: 10, planks: 10, reeds: 10 });
        while (!coop.done) HandBuilding.work(w, q, coop, 2);
        const room = HandBuilding.def('coop').room;
        expect(HandBuilding.roomOn(w, 1, 1)).toEqual({ capacity: room.capacity, species: room.species });
        // …added to a place of the player's on that hex (systems/livestock.js)
        const lw = { ...w, getTile: (tq, tr) => (tq === 1 && tr === 1 ? { q: 1, r: 1, settlement: null } : null) };
        const homeless = Livestock.places(lw, { houses: [{ q: 1, r: 1, typeId: 'cottage' }] });
        expect(homeless.length).toBe(1);
        expect(homeless[0].capacity).toBe(Livestock.config().places.home.capacity + room.capacity);
        // The scarecrow
        const sc = HandBuilding.lay(w, 1, 1, 'scarecrow', 12, 12, 10).rec;
        const r = player({ wood: 5, reeds: 5, wool: 2 });
        while (!sc.done) HandBuilding.work(w, r, sc, 1);
        const reach = HandBuilding.def('scarecrow').guard.reach;
        expect(HandBuilding.guardBonus(w, 1, 1, 12 + reach, 12)).toBe(HandBuilding.def('scarecrow').guard.bonus);
        expect(HandBuilding.guardBonus(w, 1, 1, 12 + reach + 1, 12)).toBe(0);
    });
});

describe('the Build by Hand mode', () => {
    it('offers Build by Hand on your ground, a camp on open wilds, and Work on It at a site', async () => {
        const { InnerMapHandBuild } = await import('../ui/innerMapHandBuild.js');
        const tiles = lay();
        const w = world();
        const p = player({ wood: 4 });
        const game = { world: w, player: p, ui: { showNotification() {}, updateStats() {} } };
        InnerMap._bindHandBuilt(w, `${HEX.q},${HEX.r}`);
        let items = InnerMapHandBuild.menuItems(game, tiles[10][10], 10, 10);
        expect(items.some(i => i.action === 'hb_camp')).toBe(true);
        expect(items.some(i => i.action === 'hb_start')).toBe(false);
        expect(InnerMapHandBuild.handle(game, items.find(i => i.action === 'hb_camp'))).toBe(true);
        expect(HandBuilding.camp(w, HEX.q, HEX.r)).toEqual({ q: 10, r: 10 });
        items = InnerMapHandBuild.menuItems(game, tiles[11][11], 11, 11);
        expect(items.some(i => i.action === 'hb_start')).toBe(true);
        // Holding a fence, a click lays it; it stays in hand for the next length
        InnerMapHandBuild.start(game);
        InnerMapHandBuild.pick('fence');
        expect(InnerMapHandBuild.click(game, 11, 11, 'left')).toBe(true);
        expect(InnerMapHandBuild.held).toBe('fence');
        const rec = InnerMap.handBuiltAt(11, 11, w);
        expect(rec && rec.kind).toBe('fence');
        items = InnerMapHandBuild.menuItems(game, tiles[11][11], 11, 11);
        expect(items.some(i => i.action === 'hb_work' && i.hbId === rec.id)).toBe(true);
        expect(items.some(i => i.action === 'hb_down')).toBe(true);
        InnerMapHandBuild.stop();
        expect(InnerMapHandBuild.active).toBe(false);
    });
});

describe('town props the structures stand as', () => {
    it('every prop named in the data is a registered town prop', () => {
        const ids = new Set(TownProps.defs().map(d => d.id));
        for (const d of HandBuilding.kinds()) if (d.prop) expect(ids.has(d.prop)).toBe(true);
    });
});
