/**
 * Felling trees (world/innerMap/felling.js, movement.js _fellNow; world/townProps.js
 * fell / grub blocks; player/gathering.js fellGives, toolFor): each tree leaves its
 * own stump and topples away from the cutter; the felling is kept on world.felled and
 * laid back on the map (stump, then sapling, then the tree again); a stump grubbed
 * out leaves the ground clear; harder trees take more blows; an axe helps; a tree
 * gives more than logs.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

let InnerMap, DataLoader, Utils, CustomObjects, TownProps, Felling, Gathering, SaveLoad, PracticeSkills;

beforeAll(async () => {
    // (CustomObjects.loadAll waits on its sheets: images that load at once)
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    ({ DataLoader } = await import('../core/dataLoader.js'));
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ Utils } = await import('../core/utils.js'));
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ TownProps } = await import('../world/townProps.js'));
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ Felling } = await import('../world/innerMap/felling.js'));
    ({ Gathering } = await import('../player/gathering.js'));
    ({ SaveLoad } = await import('../systems/saveLoad.js'));
    ({ PracticeSkills } = await import('../systems/practiceSkills.js'));
    CustomObjects.reset();
    await CustomObjects.loadAll();
}, 120000);

beforeEach(() => Utils.setSeed(7));

const def = (id) => CustomObjects.getDef(id);

/** A 12x10 meadow; the player stands left of a tree anchored at (4, 6) (trunk at q 5). */
function meadow(treeId = 'tp_tree_oak2') {
    const tiles = Array.from({ length: 10 }, (_, r) => Array.from({ length: 12 }, (_, q) => ({
        q, r, explored: true, visible: true, subTerrain: { id: 'grass', passable: true },
    })));
    if (treeId) expect(TownProps.place(tiles, def(treeId), 4, 6)).toBe(true);
    InnerMap.tiles = tiles;
    InnerMap.width = 12;
    InnerMap.height = 10;
    InnerMap._insideBuilding = null;
    InnerMap.npcs = [];
    InnerMap.playerInnerQ = 3;
    InnerMap.playerInnerR = 6;
    InnerMap._activeInteraction = null;
    return tiles;
}

/** Swing at the object at (4, 6) until it is down. → the completed result */
function chopDown(damage = 30) {
    InnerMap.startInteraction(4, 6, InnerMap.tiles[6][4].customObject.defId, damage);
    for (let i = 0; i < 200; i++) {
        const res = InnerMap.updateInteraction(0.5);
        if (res && res.completed) return res;
    }
    return null;
}

describe('every tree has its own stump', () => {
    it('the drawn trees and the palms leave a stump of their own, which blocks at the trunk like the tree', () => {
        const trees = [...CustomObjects.getAllDefs()].filter(d => /^tp_(tree|palm)_/.test(d.id) && d.id !== 'tp_palm_sprout');
        expect(trees.length).toBe(16 + 17);
        const stumps = new Set();
        for (const t of trees) {
            expect(t.objectType, t.id).toBe('tree');
            expect(t.topples, t.id).toBe(true);
            expect(t.resource && t.resource.type, t.id).toBe('wood');
            const s = def(t.spawnAfter);
            expect(s, `${t.id} -> ${t.spawnAfter}`).toBeTruthy();
            expect(s.objectType).toBe('stump');
            // the stump stands where the trunk stood: the same middle column blocks
            expect(s.meta.filter(m => m.impassable).map(m => `${m.localCol},${m.localRow}`)).toEqual(['1,0']);
            expect(Object.keys(s.seasonVariants).sort()).toEqual(['autumn', 'spring', 'summer', 'winter']);
            stumps.add(t.spawnAfter);
        }
        expect(stumps.size).toBe(16 + 4);
        // the drawn trees each have their own; no tree falls back on the old LPC stump
        expect([...stumps].every(id => /^tp_stump_/.test(id))).toBe(true);
    });

    it('stumps are never scattered wild, and a harder tree resists the axe more', () => {
        for (const s of [...CustomObjects.getAllDefs()].filter(d => d.objectType === 'stump')) expect(s.spawnWeight || 0).toBe(0);
        expect(def('tp_tree_great_oak').resistance).toBeGreaterThan(def('tp_tree_birch').resistance);
        const p = { strength: 5, luck: 5 };
        expect(InnerMap._computeObjectDamage(p, def('tp_tree_great_oak'))).toBeLessThan(InnerMap._computeObjectDamage(p, def('tp_tree_birch')));
    });
});

describe('a tree felled on the map', () => {
    it('leaves its stump at once, falls away from the cutter, and is kept on the world', () => {
        meadow('tp_tree_birch');
        const world = { day: 40 };
        InnerMap._bindFelling(world, '3,4', 40);
        const res = chopDown();
        expect(res.felled).toBe(true);
        expect(res.resource.type).toBe('wood');
        expect(res.stumpId).toBe('tp_stump_birch');
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_stump_birch');
        // the crown's cells are free to walk again; the trunk's cell blocks (the stump)
        expect(InnerMap.tiles[3][5].customObjectPart).toBeUndefined();
        expect(InnerMap.tiles[6][5].subTerrain.passable).toBe(false);
        // the cutter stood left of the trunk: it falls to the right
        expect(InnerMap._fallingTrees).toEqual([{ q: 4, r: 6, defId: 'tp_tree_birch', dir: 1, t: 0 }]);
        expect(world.felled).toEqual({ '3,4': { '4,6': { tree: 'tp_tree_birch', stump: 'tp_stump_birch', day: 40 } } });
        // it hits the ground once, then lies a while and is gone
        expect(InnerMap.updateFelling(0.5)).toEqual([]);
        expect(InnerMap.updateFelling(0.7).length).toBe(1);
        expect(InnerMap.updateFelling(0.2)).toEqual([]);
        InnerMap.updateFelling(5);
        expect(InnerMap._fallingTrees).toEqual([]);
    });

    it('falls left when cut from the right', () => {
        meadow();
        InnerMap._bindFelling({ day: 1 }, '0,0', 1);
        InnerMap.playerInnerQ = 7;
        chopDown();
        expect(InnerMap._fallingTrees[0].dir).toBe(-1);
    });

    it('the stump grubbed out leaves the ground clear, and the record says so', () => {
        meadow();
        const world = { day: 5 };
        InnerMap._bindFelling(world, '1,1', 5);
        chopDown();
        const res = chopDown();
        expect(res.defId).toBe('tp_stump_oak2');
        expect(res.resource.type).toBe('firewood');
        expect(InnerMap.tiles[6][4].customObject).toBeUndefined();
        expect(InnerMap.tiles[6][5].subTerrain.passable).toBe(true);
        expect(world.felled['1,1']['4,6'].grubbed).toBe(true);
    });
});

describe('the map remembers, and the wood grows back', () => {
    function felledWorld(day) {
        meadow('tp_tree_maple');
        const world = { day };
        InnerMap._bindFelling(world, '2,2', day);
        chopDown();
        return world;
    }

    it('a fresh drawing of the map shows the stump, then a sapling, then the tree again', () => {
        const C = Felling.config();
        const world = felledWorld(10);
        const rec = JSON.parse(JSON.stringify(SaveLoad.serializeWorld({ ...world, tiles: [], kingdoms: [], units: [] }).felled));
        expect(rec['2,2']['4,6'].tree).toBe('tp_tree_maple');
        // the map drawn afresh (the tree stands again in the generator's layout)
        const back = { felled: rec, day: 10 + C.sproutDays - 1 };
        meadow('tp_tree_maple');
        InnerMap._bindFelling(back, '2,2', back.day);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_stump_maple');
        expect(InnerMap.tiles[3][5].customObjectPart).toBeUndefined();
        back.day = 10 + C.sproutDays;
        InnerMap._bindFelling(back, '2,2', back.day);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe(C.sapling);
        back.day = 10 + C.treeDays;
        InnerMap._bindFelling(back, '2,2', back.day);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_tree_maple');
        expect(back.felled['2,2']['4,6']).toBeUndefined();
        // another hex's map is untouched
        meadow('tp_tree_maple');
        InnerMap._bindFelling({ felled: { '2,2': { '4,6': { tree: 'tp_tree_maple', stump: 'tp_stump_maple', day: 0 } } } }, '9,9', 1);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_tree_maple');
    });

    it('a palm grows back from a young palm; ground grubbed clear stays clear', () => {
        expect(Felling.saplingFor({ tree: 'tp_palm_3' })).toBe(Felling.config().palmSapling);
        meadow('tp_tree_oak2');
        InnerMap._bindFelling({ day: 900, felled: { '5,5': { '4,6': { tree: 'tp_tree_oak2', stump: 'tp_stump_oak2', day: 0, grubbed: true } } } }, '5,5', 900);
        expect(InnerMap.tiles[6][4].customObject).toBeUndefined();
        // something else standing there is left alone
        const tiles = meadow(null);
        expect(TownProps.place(tiles, def('tp_tree_linden'), 4, 6)).toBe(true);
        InnerMap._bindFelling({ felled: { '5,5': { '4,6': { tree: 'tp_tree_oak2', stump: 'tp_stump_oak2', day: 0 } } } }, '5,5', 10);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_tree_linden');
    });

    it('a sapling grown on an old stump grows back into the first tree when felled', () => {
        meadow(Felling.config().sapling);
        const world = { day: 300, felled: { '4,4': { '4,6': { tree: 'tp_tree_great_oak', stump: 'tp_stump_great_oak', day: 150 } } } };
        InnerMap._bindFelling(world, '4,4', 300);
        chopDown();
        expect(world.felled['4,4']['4,6'].tree).toBe('tp_tree_great_oak');
        expect(world.felled['4,4']['4,6'].day).toBe(300);
    });
});

describe('what a felled tree gives, and the axe', () => {
    it('gives its extras: its own fruit (an apple tree apples) only in season, chances rolled', () => {
        const apple = def('tp_tree_apple');
        const summer = Gathering.fellGives(apple, 'Summer');
        expect(summer.find(g => g.item === 'apples').qty).toBeGreaterThanOrEqual(2);
        expect(Gathering.fellGives(apple, 'Winter').find(g => g.item === 'apples')).toBeUndefined();
        expect(Gathering.fellGives(def('tp_tree_cherry'), 'Summer').find(g => g.item === 'cherries')).toBeTruthy();
        expect(Gathering.fellGives(def('tp_tree_pear'), 'Autumn').find(g => g.item === 'pears')).toBeTruthy();
        expect(Gathering.fellGives(apple, 'winter').find(g => g.item === 'firewood')).toBeTruthy();
        // a spruce weeps resin most of the time
        let resin = 0;
        for (let i = 0; i < 200; i++) if (Gathering.fellGives(def('tp_tree_spruce'), 'summer').some(g => g.item === 'resin')) resin++;
        expect(resin).toBeGreaterThan(100);
        expect(resin).toBeLessThan(180);
    });

    it('the best edge in the packs makes the blows land harder and is named', () => {
        const oak = def('tp_tree_oak2');
        const p = { inventory: {}, strength: 5, luck: 5 };
        const bare = Gathering.damageMult(p, oak);
        expect(Gathering.toolFor(p, oak)).toBeNull();
        p.inventory.tools = 1;
        expect(Gathering.toolFor(p, oak).name).toBe('iron axe');
        p.inventory.steel_tools = 1;
        expect(Gathering.toolFor(p, oak).name).toBe('steel axe');
        expect(Gathering.damageMult(p, oak)).toBeCloseTo(bare * 1.4);
        // on rock it is a pick
        expect(Gathering.toolFor(p, { objectType: 'rock' }).name).toBe('steel pick');
    });

    it('felled: the extras, the tool, and more XP for a harder tree; grubbing a stump trains Woodcutting', () => {
        const mk = () => ({ inventory: { tools: 1 }, needs: { energy: 100 }, modifyNeed() {} });
        const a = mk(), b = mk();
        const big = Gathering.felled(a, def('tp_tree_great_oak'), { type: 'wood', amount: 40 }, null, 'summer');
        const small = Gathering.felled(b, def('tp_tree_birch'), { type: 'wood', amount: 40 }, null, 'summer');
        expect(big.xp).toBeGreaterThan(small.xp);
        expect(big.tool.name).toBe('iron axe');
        expect(big.gives.some(g => g.item === 'firewood')).toBe(true);
        expect(PracticeSkills.xp(a, 'woodcutting')).toBeGreaterThan(PracticeSkills.xp(b, 'woodcutting'));
        expect(Gathering.skillFor(def('tp_stump_oak2'))).toBe('woodcutting');
    });
});

describe('the wood grows back while you are there', () => {
    it('as the day turns, a stump sprouts and the sapling grows into its tree, with no new visit', () => {
        meadow('tp_tree_birch');
        const world = { day: 10 };
        InnerMap._bindFelling(world, '6,6', 10);
        chopDown();
        InnerMap.updateFelling(5);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_stump_birch');
        InnerMap._regrown = [];
        const C = Felling.config();
        // the same day: nothing yet
        InnerMap.updateFelling(0.1);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_stump_birch');
        world.day = 10 + C.sproutDays;
        InnerMap.updateFelling(0.1);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe(C.sapling);
        expect(InnerMap._regrown).toEqual([{ q: 4, r: 6, stage: 'sapling', defId: C.sapling }]);
        world.day = 10 + C.treeDays;
        InnerMap.updateFelling(0.1);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_tree_birch');
        expect(world.felled['6,6']['4,6']).toBeUndefined();
    });

    it("never under anyone's feet nor while it is being grubbed: it waits a day", () => {
        meadow('tp_tree_birch');
        const world = { day: 10 };
        InnerMap._bindFelling(world, '7,7', 10);
        chopDown();
        const C = Felling.config();
        // standing on the trunk's cell (the stump's blocking cell, as if just stepped there)
        InnerMap.playerInnerQ = 5;
        world.day = 10 + C.sproutDays;
        InnerMap.updateFelling(0.1);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe('tp_stump_birch');
        // stepped off, the next day it sprouts
        InnerMap.playerInnerQ = 3;
        world.day += 1;
        InnerMap.updateFelling(0.1);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe(C.sapling);
        // a town woodcutter at it holds it too
        world.day = 10 + C.treeDays;
        InnerMap.npcs = [{ q: 3, r: 6, state: 'idle', _chop: { q: 4, r: 6 } }];
        InnerMap.updateFelling(0.1);
        expect(InnerMap.tiles[6][4].customObject.defId).toBe(C.sapling);
        InnerMap.npcs = [];
    });
});
