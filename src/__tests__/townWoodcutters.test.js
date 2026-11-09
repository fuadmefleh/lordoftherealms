/**
 * Town woodcutters (world/innerMap/townWoodcutters.js): the town's cutters by trade
 * walk out to a tree beyond the houses and fell it blow by blow, as the player does —
 * its own stump left, the tree falling away from them, the felling kept with the map's
 * (so it grows back) — then carry the logs into the town's goods; a few trees a day
 * at most.
 */
import { SettlementMarket } from '../world/settlementMarket.js';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

let InnerMap, DataLoader, Utils, CustomObjects, TownProps, PracticeSkills, Townsfolk;

beforeAll(async () => {
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
    ({ PracticeSkills } = await import('../systems/practiceSkills.js'));
    ({ Townsfolk } = await import('../systems/townsfolk.js'));
    CustomObjects.reset();
    await CustomObjects.loadAll();
}, 120000);

beforeEach(() => Utils.setSeed(11));

/** A 40x30 meadow with a tree anchored at (20, 15); the town is the left quarter. */
function meadow(treeId = 'tp_tree_birch') {
    const tiles = Array.from({ length: 30 }, (_, r) => Array.from({ length: 40 }, (_, q) => ({
        q, r, explored: true, visible: true, subTerrain: { id: 'grass', passable: true },
    })));
    if (treeId) expect(TownProps.place(tiles, CustomObjects.getDef(treeId), 20, 15)).toBe(true);
    InnerMap.tiles = tiles;
    InnerMap.width = 40;
    InnerMap.height = 30;
    InnerMap._insideBuilding = null;
    InnerMap._activeInteraction = null;
    InnerMap._chopEvents = [];
    InnerMap.playerInnerQ = 2;
    InnerMap.playerInnerR = 2;
    InnerMap.townArea = () => ({ margin: 2 });
    InnerMap.inTown = (q) => q < 10;
    InnerMap._bindFelling({ day: 50, felled: { '5,5': {} } }, '5,5', 50);
    return tiles;
}

const cutter = (q, r) => ({ id: 1, q, r, state: 'idle', idleTimer: 5, type: 'villager', _home: { q: 4, r: 15 } });

/** Stand the cutter at the trunk's side and swing until the tree is down (or give up). */
function fell(npc) {
    const anchor = { q: 20, r: 15 };
    const def = CustomObjects.getDef(InnerMap.tiles[15][20].customObject.defId);
    InnerMap.npcs = [npc];
    npc._chop = { q: anchor.q, r: anchor.r, defId: def.id, timer: 0, interval: 0.8, going: true };
    InnerMap._startChopping(npc);
    let blows = 0;
    for (let i = 0; i < 400 && npc._chop; i++) {
        const before = InnerMap._chopEvents.length;
        InnerMap._updateTownChopping(0.8);
        blows += InnerMap._chopEvents.length - before;
    }
    return { def, blows };
}

describe('town woodcutters', () => {
    it('fell a tree blow by blow: its own stump stays, it falls away from them, the logs go on their back', () => {
        meadow();
        const def = CustomObjects.getDef('tp_tree_birch');
        const trunk = InnerMap.trunkOf(20, 15, def);
        const npc = cutter(trunk.q - 1, trunk.r);
        const { blows } = fell(npc);
        expect(blows).toBeGreaterThan(3);
        const here = InnerMap.tiles[15][20].customObject;
        expect(here && here.defId).toBe(def.spawnAfter);
        expect(def.spawnAfter).toBe('tp_stump_birch');
        const rec = InnerMap._fellRec['20,15'];
        expect(rec).toMatchObject({ tree: 'tp_tree_birch', stump: def.spawnAfter, day: 50, by: 'town' });
        const falling = InnerMap._fallingTrees.find(f => f.q === 20 && f.r === 15);
        expect(falling.dir).toBe(1);                       // (cut from the left: it falls to the right)
        expect(npc._carry).toMatchObject({ good: 'wood' });
        expect(npc._carry.qty).toBeGreaterThan(0);
        expect(npc.activity).toBeFalsy();
        expect(InnerMap._chopEvents.some(e => e.kind === 'felled')).toBe(true);
    });

    it('a harder tree takes more blows', () => {
        meadow('tp_tree_birch');
        const soft = fell(cutter(19, 15)).blows;
        Utils.setSeed(11);
        meadow('tp_tree_gnarled');
        const hard = fell(cutter(19, 15)).blows;
        expect(hard).toBeGreaterThan(soft);
    });

    it('leave the town\'s own trees, saplings and a tree another is at; and stop at the day\'s few', () => {
        meadow();
        InnerMap.npcs = [];
        const npc = cutter(15, 15);
        expect(InnerMap._pickTownTree(npc)).toMatchObject({ q: 20, r: 15 });
        // in town (or by it): left standing
        InnerMap.inTown = (q) => q < 24;
        expect(InnerMap._pickTownTree(npc)).toBeNull();
        InnerMap.inTown = (q) => q < 10;
        // someone already at it
        const other = cutter(19, 15);
        other.id = 2;
        other._chop = { q: 20, r: 15 };
        InnerMap.npcs = [other];
        expect(InnerMap._pickTownTree(npc)).toBeNull();
        InnerMap.npcs = [];
        // the day's fellings done
        const max = InnerMap.townWoodConfig().maxPerDay;
        for (let i = 0; i < max; i++) InnerMap._fellRec[`${30 + i},5`] = { tree: 'tp_tree_birch', day: 50, by: 'town' };
        expect(InnerMap._goToTree(npc)).toBe(false);
    });

    it('are the townsfolk whose trade is woodcutting', () => {
        let yes = 0, no = 0;
        for (let i = 0; i < 300; i++) {
            const npc = { _folk: { q: 3, r: 4 }, _person: { id: i, role: 'villager', born: -9000 } };
            const want = PracticeSkills.craftOf(Townsfolk.skillWho(npc._folk, npc._person, 1, false, false)) === 'woodcutter';
            expect(InnerMap._isTownWoodcutter(npc)).toBe(want);
            if (want) yes++; else no++;
        }
        expect(yes).toBeGreaterThan(5);
        expect(no).toBeGreaterThan(yes);
        expect(InnerMap._isTownWoodcutter({ type: 'traveler' })).toBe(false);
    });

    it('carry the logs to the town\'s market at its yard', () => {
        meadow(null);
        // (the logs go on the town's market stalls, where the prices see them: 2026-11)
        const econ = { goods: 10, food: 5 };
        const town = { type: 'town', population: 1000, economy: econ };
        SettlementMarket.ensure(town);
        const wood0 = SettlementMarket.stock(town, 'wood');
        InnerMap._currentWorldTileRef = { settlement: town };
        const npc = cutter(5, 5);
        npc._carry = { good: 'wood', qty: 20 };
        InnerMap._townDelivered(npc, { type: 'warehouse', q: 5, r: 4 });
        expect(npc._carry).toBeNull();
        expect(SettlementMarket.stock(town, 'wood')).toBeCloseTo(wood0 + 20, 2);
        expect(econ.food).toBe(5);
    });

    it('grub out an old stump: the ground clear for good, its firewood on their back', () => {
        meadow();
        const def = CustomObjects.getDef('tp_tree_birch');
        fell(cutter(19, 15));
        expect(InnerMap.tiles[15][20].customObject.defId).toBe('tp_stump_birch');
        const npc = cutter(19, 15);
        InnerMap.npcs = [npc];
        // a fresh stump is left a while; an old one is fair game
        expect(InnerMap._pickTownTree(npc, 'stump')).toBeNull();
        InnerMap._fellWorld.day = 50 + InnerMap.townWoodConfig().grubAfterDays;
        expect(InnerMap._pickTownTree(npc, 'stump')).toMatchObject({ q: 20, r: 15 });
        npc._chop = { q: 20, r: 15, defId: def.spawnAfter, timer: 0, interval: 0.8, going: true };
        InnerMap._startChopping(npc);
        expect(npc.activity.label).toMatch(/stump/i);
        for (let i = 0; i < 400 && npc._chop; i++) InnerMap._updateTownChopping(0.8);
        expect(InnerMap.tiles[15][20].customObject).toBeFalsy();
        expect(InnerMap._fellRec['20,15']).toMatchObject({ grubbed: true, grubbedBy: 'town' });
        expect(InnerMap._townGrubbedToday()).toBe(1);
        expect(npc._carry).toMatchObject({ good: 'firewood' });
        // and nothing grows back there
        InnerMap._bindFelling(InnerMap._fellWorld, '5,5', 50 + 400);
        expect(InnerMap.tiles[15][20].customObject).toBeFalsy();
        // the firewood goes to the town's market at the yard
        const town = { type: 'town', population: 1000, economy: { goods: 0 } };
        SettlementMarket.ensure(town);
        const fw0 = SettlementMarket.stock(town, 'firewood');
        InnerMap._currentWorldTileRef = { settlement: town };
        InnerMap._townDelivered(npc, { type: 'warehouse', q: 5, r: 4 });
        expect(npc._carry).toBeNull();
        expect(SettlementMarket.stock(town, 'firewood')).toBeGreaterThan(fw0);
    });

    it('a stump the map was drawn with may go any time', () => {
        meadow(null);
        expect(TownProps.place(InnerMap.tiles, CustomObjects.getDef('tp_stump_oak2'), 20, 15)).toBe(true);
        InnerMap.npcs = [];
        expect(InnerMap._pickTownTree(cutter(15, 15), 'stump')).toMatchObject({ q: 20, r: 15 });
        expect(InnerMap._pickTownTree(cutter(15, 15), 'tree')).toBeNull();
    });
});
