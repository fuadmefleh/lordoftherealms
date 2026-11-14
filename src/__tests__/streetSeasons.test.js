/**
 * Seasons on the street map: the ground's state by the day (world/streetSeasons.js)
 * and the map made of it — ice to walk on and thin ice that breaks, the going,
 * the townsfolk at the season's doings (world/innerMap/streetSeasons.js).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { InnerMap } from '../world/innerMap.js';
import { StreetSeasons } from '../world/streetSeasons.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

/** A world of one kind of weather: every hex `temperature` warm, wet every `wetEvery` days. */
function world({ temperature = 0.5, wetEvery = 3, wet = 0.85, dry = 0.3, day = 100 } = {}) {
    const tile = { q: 5, r: 5, temperature, terrain: { id: 'grassland' } };
    return {
        day,
        width: 40,
        height: 40,
        generationParams: { seed: 7 },
        weather: { seed: 99, precipitation: (q, r, d) => (((d % wetEvery) + wetEvery) % wetEvery === 0 ? wet : dry) },
        getTile: (q, r) => (q === 5 && r === 5 ? tile : null),
    };
}

// Days of the year: winter is 91-120 (mid-winter 105), spring 1-30, autumn 61-90
const MIDWINTER = 120 * 3 + 105;
const EARLY_SPRING = 120 * 4 + 12;

describe('the ground by the day', () => {
    it('a cold wet winter piles up snow and freezes the ponds hard', () => {
        const w = world({ temperature: 0.25 });
        const st = StreetSeasons.state(w, 5, 5, MIDWINTER);
        expect(st.season).toBe('Winter');
        expect(st.celsius).toBeLessThan(0);
        expect(st.snow).toBeGreaterThan(0.4);
        expect(st.mud).toBe(0);   // (frozen ground)
        expect(StreetSeasons.lookSeason('Winter', st)).toBe('Winter');
        expect(StreetSeasons.iceOn(st, 'pond').state).toBe('solid');
        expect(StreetSeasons.iceOn(st, 'sea').state).toBe('none');
    });

    it('a warm winter lies bare: no snow, no ice, and it looks like late autumn', () => {
        const st = StreetSeasons.state(world({ temperature: 0.8 }), 5, 5, MIDWINTER);
        expect(st.snow).toBe(0);
        expect(StreetSeasons.iceOn(st, 'pond').state).toBe('none');
        expect(StreetSeasons.lookSeason('Winter', st)).toBe('Autumn');
    });

    it('rivers need a harder frost than ponds; thawing ice goes rotten', () => {
        const st = { ice: 0.8, thawing: false };
        expect(StreetSeasons.iceOn(st, 'pond').state).toBe('solid');
        expect(StreetSeasons.iceOn(st, 'river').state).toBe('thin');
        expect(StreetSeasons.iceOn({ ice: 1.4, thawing: false }, 'river').state).toBe('solid');
        expect(StreetSeasons.iceOn({ ice: 0.6, thawing: true }, 'pond').state).toBe('thin');
        expect(StreetSeasons.iceOn({ ice: 0.1, thawing: false }, 'pond').state).toBe('none');
        // the weaker the ice, the likelier a step breaks it
        expect(StreetSeasons.crackChance(0)).toBeGreaterThan(StreetSeasons.crackChance(0.8));
    });

    it('the thaw: the snow goes to slush and mud, the ice goes rotten', () => {
        const w = world({ temperature: 0.36 });
        const late = StreetSeasons.state(w, 5, 5, EARLY_SPRING);
        expect(late.season).toBe('Spring');
        // some day this early spring the ice is thawing and thin, and the ground goes to mud
        let thin = false, mud = 0;
        for (let d = EARLY_SPRING - 10; d <= EARLY_SPRING + 15; d++) {
            const st = StreetSeasons.state(w, 5, 5, d);
            if (st.thawing && StreetSeasons.iceOn(st, 'pond').state === 'thin') thin = true;
            mud = Math.max(mud, st.mud);
        }
        expect(thin).toBe(true);
        expect(mud).toBeGreaterThan(StreetSeasons.config().mud.showAt);
    });

    it('rain on a mild autumn makes mud; dry weather dries it', () => {
        const wet = StreetSeasons.state(world({ temperature: 0.55, wetEvery: 2, wet: 0.95 }), 5, 5, 120 * 2 + 75);
        const dry = StreetSeasons.state(world({ temperature: 0.55, wetEvery: 50, wet: 0.95 }), 5, 5, 120 * 2 + 75);
        expect(wet.mud).toBeGreaterThan(0.4);
        expect(dry.mud).toBeLessThan(wet.mud);
    });

    it('leaves lie in autumn, none in summer', () => {
        expect(StreetSeasons.leavesOn(85)).toBeGreaterThan(0.8);
        expect(StreetSeasons.leavesOn(40)).toBe(0);
        expect(StreetSeasons.leavesOn(110)).toBe(0);
    });

    it('is a pure function of the day: the same answer twice, no randomness drawn', () => {
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        const w = world({ temperature: 0.3 });
        const a = StreetSeasons.state(w, 5, 5, MIDWINTER);
        const b = StreetSeasons.state(world({ temperature: 0.3 }), 5, 5, MIDWINTER);
        expect(b).toEqual(a);
        expect(Utils.random()).toBe(before);
    });

    it("the town's calendar: its harvest fair in autumn, midwinter fires, the sowing", () => {
        const town = { name: 'Ashford', q: 3, r: 4 };
        const first = StreetSeasons.fairFirstDay(town);
        const fairDay = 120 + 60 + first;
        expect(StreetSeasons.fairOn(town, fairDay)).toBe(true);
        expect(StreetSeasons.fairOn(town, fairDay - 1)).toBe(false);
        expect(StreetSeasons.fairOn(town, fairDay - 60)).toBe(false);
        // a great fair on in the town counts too
        expect(StreetSeasons.fairOn({ ...town, market: { fair: { start: 10, until: 14 } } }, 12)).toBe(true);
        expect(StreetSeasons.midwinterOn(120 + 90 + 15)).toBe(true);
        expect(StreetSeasons.midwinterOn(120 + 90 + 25)).toBe(false);
        expect(StreetSeasons.sowingOn(120 + 5)).toBe(true);
        expect(StreetSeasons.sowingOn(120 + 35)).toBe(false);
    });

    it('the going: deep snow and mud slow feet and carts more off the cleared streets', () => {
        const st = { snow: 0.8, mud: 0.7, slush: 0 };
        expect(StreetSeasons.pace(st, 'street')).toBe(1);
        expect(StreetSeasons.pace(st, 'open')).toBeLessThan(0.75);
        expect(StreetSeasons.pace(st, 'soft', true)).toBeLessThan(StreetSeasons.pace(st, 'soft', false));
        expect(StreetSeasons.pace({ snow: 0, mud: 0, slush: 0 }, 'open')).toBe(1);
    });
});

/** A 14×8 green with a pond (cols 5-8), a road down col 2, a town tile record. */
function lay() {
    const tiles = [];
    for (let r = 0; r < 8; r++) {
        const row = [];
        for (let q = 0; q < 14; q++) {
            const wet = q >= 5 && q <= 8;
            row.push({
                q, r, explored: true, visible: true, baseTerrain: wet ? 'water' : 'grass',
                subTerrain: wet ? { id: 'pond_water', passable: false } : { id: 'grass', passable: true },
                _wet: wet, isRoad: q === 2,
            });
        }
        tiles.push(row);
    }
    InnerMap.tiles = tiles;
    InnerMap.width = 14;
    InnerMap.height = 8;
    InnerMap._insideBuilding = null;
    InnerMap._swimAllowed = true;
    InnerMap.playerInnerQ = 1;
    InnerMap.playerInnerR = 3;
    InnerMap.npcs = [];
    InnerMap.cancelPlayerWalk();
    return tiles;
}

describe('the street map in the season', () => {
    beforeEach(() => { lay(); Utils.setSeed(11); });

    it('frozen water is walked across and not swum in; the thaw gives the water back', () => {
        InnerMap.season = 'Winter';
        const cold = world({ temperature: 0.2, day: MIDWINTER });
        const wt = cold.getTile(5, 5);
        const ss = InnerMap._bindStreetSeason(cold, wt, 5, 5);
        expect(ss.solidCells).toBeGreaterThan(0);
        expect(InnerMap.iceAt(6, 3)).toBe(2);
        expect(InnerMap.tiles[3][6].subTerrain.passable).toBe(true);
        expect(InnerMap.isSwimmable(6, 3)).toBe(false);
        // a path straight across the ice, no swimming asked
        const path = InnerMap._findPath(3, 3, 11, 3);
        expect(path && path.length).toBe(9);
        // spring: the water again
        InnerMap.season = 'Summer';
        InnerMap._bindStreetSeason(world({ temperature: 0.7, day: 120 * 4 + 50 }), wt, 5, 5);
        expect(InnerMap.iceAt(6, 3)).toBe(0);
        expect(InnerMap.tiles[3][6].subTerrain.id).toBe('pond_water');
        expect(InnerMap.isSwimmable(6, 3)).toBe(true);
    });

    it('thin ice warns, and sooner or later gives way: a hole to swim in', () => {
        InnerMap.season = 'Winter';
        const cold = world({ temperature: 0.2, day: MIDWINTER });
        InnerMap._bindStreetSeason(cold, cold.getTile(5, 5), 5, 5);
        // thin it by hand (the ice near the thaw)
        for (const row of InnerMap.tiles) for (const t of row) if (t._iced) { t._iced = 1; t._iceStrength = 0; t._iceCost = 6; }
        const first = InnerMap._iceStep(6, 3);
        expect(first && ['thin', 'crack']).toBeTruthy();
        let broke = first && first.kind === 'crack';
        for (let i = 0; i < 200 && !broke; i++) {
            const ev = InnerMap._iceStep(6, 3);
            broke = !!(ev && ev.kind === 'crack');
        }
        expect(broke).toBe(true);
        expect(InnerMap.iceAt(6, 3)).toBe(0);
        expect(InnerMap.isSwimmable(6, 3)).toBe(true);
        expect(InnerMap.tiles[3][6]._ssHole).toBe(MIDWINTER);
        // the hole stays open the next day, though the frost holds
        InnerMap._bindStreetSeason(world({ temperature: 0.2, day: MIDWINTER + 1 }), cold.getTile(5, 5), 5, 5);
        expect(InnerMap.isSwimmable(6, 3)).toBe(true);
    });

    it('paths go round thin ice when they can', () => {
        InnerMap.season = 'Winter';
        const cold = world({ temperature: 0.2, day: MIDWINTER });
        InnerMap._bindStreetSeason(cold, cold.getTile(5, 5), 5, 5);
        for (const row of InnerMap.tiles) for (const t of row) if (t._iced && t.r !== 0) { t._iced = 1; t._iceCost = 20; }
        const path = InnerMap._findPath(3, 3, 11, 3);
        expect(path.some(p => p.r === 0)).toBe(true);
    });

    it('snow drags at the feet off the cleared street', () => {
        InnerMap.season = 'Winter';
        const cold = world({ temperature: 0.2, day: MIDWINTER });
        InnerMap._bindStreetSeason(cold, cold.getTile(5, 5), 5, 5);
        expect(InnerMap._groundPace(2, 3)).toBe(1);
        expect(InnerMap._groundPace(0, 3)).toBeLessThan(1);
        expect(InnerMap._groundPace(0, 3, true)).toBeLessThan(InnerMap._groundPace(0, 3));
    });

    it('looks like the ground: a bare winter brown, a snowy winter white', () => {
        const wt = { terrain: { id: 'grassland' }, temperature: 0.8 };
        expect(InnerMap._streetLookSeason(world({ temperature: 0.8, day: MIDWINTER }), wt, 5, 5, 'Winter')).toBe('Autumn');
        expect(InnerMap._streetLookSeason(world({ temperature: 0.2, day: MIDWINTER }), wt, 5, 5, 'Winter')).toBe('Winter');
        // snowfields stay white whatever the day
        expect(InnerMap._streetLookSeason(world({ temperature: 0.8 }), { terrain: { id: 'snow' } }, 5, 5, 'Winter')).toBe('Winter');
    });

    it('the townsfolk at the season: shovelling, the fair, the fire, sowing', () => {
        const npc = { id: 1, q: 2, r: 3, type: 'villager' };
        InnerMap._seasonArrived(npc, 'ss_shovel');
        expect(npc.activity).toMatchObject({ type: 'season', label: 'Shovelling snow', tool: 'hoe' });
        expect(npc.idleTimer).toBeGreaterThan(5);
        InnerMap._seasonArrived(npc, 'ss_bonfire');
        expect(npc.activity.icon).toBe('🔥');
        InnerMap._seasonArrived(npc, 'ss_music');
        expect(npc.activity.label).toMatch(/Fiddling/);
        InnerMap._seasonClear(npc);
        expect(npc.activity).toBe(null);
        // a hand at the field in spring sows instead of weeding
        InnerMap._ssDay = 120 + 5;
        npc._field = { q: 4, r: 4 };
        npc._ssSow = true;
        npc.activity = { type: 'field', icon: '🌾', label: 'Working the field', anim: 'swing', tool: 'hoe' };
        InnerMap._seasonArrived(npc, 'field');
        expect(npc.activity.icon).toBe('🌱');
    });
});

describe('drawing the season (a recording canvas)', () => {
    /** A 2D context that only counts what is drawn. */
    function recorder() {
        const calls = { fillRect: 0, drawImage: 0, fillText: 0 };
        const ctx = {
            canvas: { width: 800, height: 600 },
            fillStyle: '', globalAlpha: 1, imageSmoothingEnabled: false, font: '', textAlign: '',
            fillRect() { calls.fillRect++; }, drawImage() { calls.drawImage++; }, fillText() { calls.fillText++; },
            save() {}, restore() {},
        };
        return { ctx, calls };
    }
    const camera = { zoom: 2, worldToScreenFast(x, y) { return { x: x * 2, y: y * 2 }; } };

    it('snow banks, thin ice cracks and holes, mud and leaves are drawn over the ground', async () => {
        const { InnerMapRenderer } = await import('../ui/innerMapRenderer.js');
        await import('../ui/innerMapLayers.js');
        lay();
        InnerMap.season = 'Winter';
        const cold = world({ temperature: 0.2, day: MIDWINTER });
        InnerMap._bindStreetSeason(cold, cold.getTile(5, 5), 5, 5);
        expect(InnerMap._ss.banks).toBe(true);
        InnerMap.tiles[3][6]._iced = 1;
        InnerMap._breakIce(7, 3);
        InnerMapRenderer._frameRange = { qMin: 0, qMax: 13, rMin: 0, rMax: 7 };
        const a = recorder();
        InnerMapRenderer._renderSeasonGround(a.ctx, camera);
        expect(a.calls.fillRect).toBeGreaterThan(50);
        // the frozen pond's pieces come from the ice sheet; the deep block's become open ice
        const ov = { sheetPath: 'assets/lpc/Terrain/terrain_winter.png', sx: 32, sy: 24 * 32 };
        expect(InnerMapRenderer._iceDetail(ov)).toMatchObject({ sheetPath: 'assets/lpc/Terrain/terrain_winter_ice.png', sx: 32, sy: 11 * 32 });
        // autumn: leaves lying and drifting, mud after rain
        lay();
        InnerMap.season = 'Autumn';
        const autumn = world({ temperature: 0.55, wetEvery: 2, wet: 0.95, day: 120 * 2 + 84 });
        InnerMap._bindStreetSeason(autumn, autumn.getTile(5, 5), 5, 5);
        expect(InnerMap._ss.leavesShow).toBeGreaterThan(0.5);
        expect(InnerMap._ss.mudShow).toBeGreaterThan(0);
        const b = recorder();
        InnerMapRenderer._renderSeasonGround(b.ctx, camera);
        InnerMapRenderer._ambientT = 12.5;
        InnerMapRenderer._renderSeasonAir(b.ctx, camera);
        InnerMapRenderer._renderSeasonFx(b.ctx, camera);
        expect(b.calls.fillRect).toBeGreaterThan(50);
    });
});
