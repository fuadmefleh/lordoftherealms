/**
 * Town miners (world/innerMap/townMiners.js): the town's miners by trade walk out to
 * a rock beyond the houses and break it up with a pick, blow by blow, as the player
 * does; the rock is gone, and they carry the stone to the town's mason or yard, into
 * its goods; a few rocks a day at most.
 */
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

beforeEach(() => Utils.setSeed(5));

/** A 40x30 meadow with a rock anchored at (20, 15); the town is the left quarter. */
function meadow(rockId = 'tp_rock_boulder') {
    const tiles = Array.from({ length: 30 }, (_, r) => Array.from({ length: 40 }, (_, q) => ({
        q, r, explored: true, visible: true, subTerrain: { id: 'grass', passable: true },
    })));
    if (rockId) expect(TownProps.place(tiles, CustomObjects.getDef(rockId), 20, 15)).toBe(true);
    InnerMap.tiles = tiles;
    InnerMap.width = 40;
    InnerMap.height = 30;
    InnerMap._insideBuilding = null;
    InnerMap._activeInteraction = null;
    InnerMap._chopEvents = [];
    InnerMap._townQuarry = null;
    InnerMap.npcs = [];
    InnerMap.playerInnerQ = 2;
    InnerMap.playerInnerR = 2;
    InnerMap.townArea = () => ({ margin: 2 });
    InnerMap.inTown = (q) => q < 10;
    InnerMap._goStand = (npc, spot, act, face) => { npc.q = spot.q; npc.r = spot.r; npc._face = face; npc._activity = act; InnerMap._npcArrivedInTown(npc); return true; };
    InnerMap._bindFelling({ day: 30, felled: { '5,5': {} } }, '5,5', 30);
    return tiles;
}

const miner = (q = 15, r = 15) => ({ id: 1, q, r, state: 'idle', idleTimer: 5, type: 'villager', _home: { q: 4, r: 15 } });

describe('town miners', () => {
    it('break a rock with a pick: it is gone, the stone on their back, into the town\'s goods', () => {
        meadow();
        const npc = miner();
        InnerMap.npcs = [npc];
        expect(InnerMap._goToRock(npc)).toBe(true);
        expect(npc._chop).toMatchObject({ q: 20, r: 15, tool: 'pickaxe' });
        expect(npc.activity.label).toMatch(/stone/i);
        let blows = 0;
        for (let i = 0; i < 400 && npc._chop; i++) {
            const before = InnerMap._chopEvents.length;
            InnerMap._updateTownChopping(0.9);
            blows += InnerMap._chopEvents.length - before;
        }
        expect(blows).toBeGreaterThan(4);
        expect(InnerMap.tiles[15][20].customObject).toBeFalsy();
        expect(InnerMap._chopEvents.some(e => e.kind === 'broken')).toBe(true);
        expect(npc._carry).toMatchObject({ good: 'stone' });
        expect(InnerMap._townRocksToday()).toBe(1);
        const econ = { goods: 0, food: 3 };
        InnerMap._currentWorldTileRef = { settlement: { economy: econ } };
        InnerMap._townDelivered(npc, { type: 'warehouse', q: 5, r: 4 });
        expect(npc._carry).toBeNull();
        expect(econ.goods).toBeCloseTo(8 * InnerMap.townMineConfig().goodsPerStone);
        expect(econ.food).toBe(3);
    });

    it('take stone to the mason first, logs to the sawmill', () => {
        meadow(null);
        expect(InnerMap._yardStores({ good: 'stone', qty: 1 })[0]).toBe('mason');
        expect(InnerMap._yardStores({ good: 'wood', qty: 1 })[0]).toBe('sawmill');
        expect(InnerMap._yardStores({ good: 'wheat', qty: 1 })).toBeNull();
    });

    it('leave rocks in or by the town, and stop at the day\'s few', () => {
        meadow();
        const npc = miner();
        InnerMap.inTown = (q) => q < 24;
        expect(InnerMap._pickTownTree(npc, 'rock')).toBeNull();
        InnerMap.inTown = (q) => q < 10;
        expect(InnerMap._pickTownTree(npc, 'rock')).toMatchObject({ q: 20, r: 15 });
        // trees and stumps are not rocks
        expect(InnerMap._pickTownTree(npc, 'tree')).toBeNull();
        InnerMap._townQuarry = { day: 30, hex: '5,5', n: InnerMap.townMineConfig().maxPerDay };
        expect(InnerMap._goToRock(npc)).toBe(false);
    });

    it('are the townsfolk whose trade is mining', () => {
        let yes = 0;
        for (let i = 0; i < 600; i++) {
            const npc = { _folk: { q: 3, r: 4 }, _person: { id: i, role: 'villager', born: -9000 } };
            const want = PracticeSkills.craftOf(Townsfolk.skillWho(npc._folk, npc._person, 1, false, false)) === 'miner';
            if (want) { expect(InnerMap._isTownMiner(npc)).toBe(true); yes++; }
        }
        expect(yes).toBeGreaterThan(1);
        expect(InnerMap._isTownMiner({ type: 'traveler' })).toBe(false);
    });
});
