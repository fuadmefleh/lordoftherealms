/**
 * Town herbalists (world/innerMap/townHerbalists.js): the town's herbalists by trade
 * walk out to a herb, berry or flower bush beyond the houses and gather from it with
 * a sickle; the bush stands, picked bare until it grows back; berries go into the
 * town's food, herbs and flowers into its goods; a few bushes a day at most.
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

beforeEach(() => Utils.setSeed(9));

let world;
/** A 40x30 meadow with a bush anchored at (20, 15); the town is the left quarter. */
function meadow(bushId = 'tp_bush_lavender') {
    const tiles = Array.from({ length: 30 }, (_, r) => Array.from({ length: 40 }, (_, q) => ({
        q, r, explored: true, visible: true, subTerrain: { id: 'grass', passable: true },
    })));
    if (bushId) expect(TownProps.place(tiles, CustomObjects.getDef(bushId), 20, 15)).toBe(true);
    InnerMap.tiles = tiles;
    InnerMap.width = 40;
    InnerMap.height = 30;
    InnerMap._insideBuilding = null;
    InnerMap._activeInteraction = null;
    InnerMap._townForage = null;
    InnerMap.npcs = [];
    InnerMap.townArea = () => ({ margin: 2 });
    InnerMap.inTown = (q) => q < 10;
    InnerMap._goStand = (npc, spot, act, face) => { npc.q = spot.q; npc.r = spot.r; npc._face = face; npc._activity = act; InnerMap._npcArrivedInTown(npc); return true; };
    world = { day: 30, felled: { '5,5': {} } };
    InnerMap._bindFelling(world, '5,5', 30);
    return tiles;
}

const herbalist = () => ({ id: 1, q: 15, r: 15, state: 'idle', idleTimer: 5, type: 'villager', _home: { q: 4, r: 15 } });

describe('town herbalists', () => {
    it('gather from a bush with a sickle: it stands, picked bare, the herbs in their basket and into the town\'s goods', () => {
        meadow('tp_bush_lavender');
        const npc = herbalist();
        InnerMap.npcs = [npc];
        expect(InnerMap._goToBush(npc)).toBe(true);
        expect(npc.activity).toMatchObject({ type: 'forage', anim: 'halfslash', tool: 'sickle' });
        expect(npc.activity.label).toMatch(/herbs/i);
        InnerMap._leaveForage(npc);
        const obj = InnerMap.tiles[15][20].customObject;
        expect(obj && obj.defId).toBe('tp_bush_lavender');
        expect(obj.pickedDay).toBe(30);
        expect(npc._carry).toMatchObject({ good: 'herbs' });
        expect(InnerMap._townForagedToday()).toBe(1);
        // picked bare: not again till it grows back
        const other = herbalist();
        expect(InnerMap._pickTownBush(other)).toBeNull();
        world.day = 30 + InnerMap.townForageConfig().regrowDays;
        expect(InnerMap._pickTownBush(other)).toMatchObject({ q: 20, r: 15 });
        // the herbs to the apothecary, into the goods
        const econ = { goods: 0, food: 0 };
        InnerMap._currentWorldTileRef = { settlement: { economy: econ } };
        expect(InnerMap._yardStores(npc._carry)[0]).toBe('apothecary');
        InnerMap._townDelivered(npc, { type: 'apothecary', q: 5, r: 4 });
        expect(npc._carry).toBeNull();
        expect(econ.goods).toBeGreaterThan(0);
        expect(econ.food).toBe(0);
    });

    it('berries go into the town\'s food', () => {
        meadow('tp_bush_blueberry');
        const npc = herbalist();
        InnerMap.npcs = [npc];
        expect(InnerMap._goToBush(npc)).toBe(true);
        expect(npc.activity.label).toMatch(/berries/i);
        InnerMap._leaveForage(npc);
        expect(npc._carry).toMatchObject({ good: 'berries' });
        const econ = { goods: 0, food: 10 };
        InnerMap._currentWorldTileRef = { settlement: { economy: econ } };
        InnerMap._townDelivered(npc, { type: 'granary', q: 5, r: 4 });
        expect(econ.food).toBeGreaterThan(10);
        expect(econ.goods).toBe(0);
    });

    it('called away before working gather nothing; firewood bushes and the town\'s own are left; a few a day', () => {
        meadow('tp_bush_lavender');
        const npc = herbalist();
        npc._forage = { q: 20, r: 15, defId: 'tp_bush_lavender', good: 'herbs' };
        InnerMap._leaveForage(npc);                       // (no spell of work at it)
        expect(npc._carry).toBeUndefined();
        expect(InnerMap.tiles[15][20].customObject.pickedDay).toBeUndefined();
        meadow('tp_bush_leafy');                           // (gives firewood)
        expect(InnerMap._pickTownBush(herbalist())).toBeNull();
        meadow('tp_bush_rose');
        InnerMap.inTown = (q) => q < 24;
        expect(InnerMap._pickTownBush(herbalist())).toBeNull();
        InnerMap.inTown = (q) => q < 10;
        InnerMap._townForage = { day: 30, hex: '5,5', n: InnerMap.townForageConfig().maxPerDay };
        expect(InnerMap._goToBush(herbalist())).toBe(false);
    });

    it('are the townsfolk whose trade is herb gathering', () => {
        let yes = 0;
        for (let i = 0; i < 600; i++) {
            const npc = { _folk: { q: 3, r: 4 }, _person: { id: i, role: 'villager', born: -9000 } };
            const want = PracticeSkills.craftOf(Townsfolk.skillWho(npc._folk, npc._person, 1, false, false)) === 'herbalist';
            expect(InnerMap._isTownHerbalist(npc)).toBe(want);
            if (want) yes++;
        }
        expect(yes).toBeGreaterThan(1);
    });
});
