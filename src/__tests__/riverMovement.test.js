// Rivers cost the player extra stamina to ford unless a road/bridge spans
// them; Bridge Construction halves the penalty. World units are unaffected.

import { describe, it, expect, beforeAll } from 'vitest';
import { Infrastructure } from '../systems/infrastructure.js';
import { Technology } from '../systems/technology.js';
import { Player } from '../player/player.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function player(techs = []) {
    const p = { gold: 0, properties: [] };
    Technology.initPlayer(p);
    p.technology.implemented = techs;
    return p;
}

function tile(extra = {}) {
    return { q: 0, r: 0, terrain: { id: 'plains', passable: true, moveCost: 2 }, hasRiver: false, hasRoad: false, infrastructure: null, ...extra };
}

function built(id) {
    const t = Infrastructure.TYPES[id];
    return { id: t.id, name: t.name, moveCostOverride: t.moveCostOverride, moveCostReduction: t.moveCostReduction, underConstruction: false };
}

describe('River movement penalty', () => {
    it('adds +2 to entering an unbridged river tile', () => {
        const t = tile({ hasRiver: true });
        expect(Infrastructure.getRiverPenalty(t, player())).toBe(2);
        expect(Infrastructure.getPlayerMoveCost(t, player())).toBe(4);
    });

    it('leaves non-river tiles unchanged', () => {
        const t = tile();
        expect(Infrastructure.getRiverPenalty(t, player())).toBe(0);
        expect(Infrastructure.getPlayerMoveCost(t, player())).toBe(Infrastructure.getEffectiveMoveCost(t));
        expect(Infrastructure.getPlayerMoveCost(tile({ hasRiver: true, terrain: { passable: false, moveCost: Infinity } }), player())).toBe(Infinity);
    });

    it('does not change the shared cost used by world units', () => {
        expect(Infrastructure.getEffectiveMoveCost(tile({ hasRiver: true }))).toBe(2);
    });

    it('a finished bridge or road spans the river (no penalty)', () => {
        expect(Infrastructure.getPlayerMoveCost(tile({ hasRiver: true, infrastructure: built('BRIDGE') }), player())).toBe(1);
        expect(Infrastructure.getPlayerMoveCost(tile({ hasRiver: true, infrastructure: built('DIRT_ROAD') }), player())).toBe(1);
        expect(Infrastructure.getRiverPenalty(tile({ hasRiver: true, hasRoad: true }), player())).toBe(0);
    });

    it('a bridge still under construction or an irrigation channel does not', () => {
        const unfinished = { ...built('BRIDGE'), underConstruction: true };
        expect(Infrastructure.getRiverPenalty(tile({ hasRiver: true, infrastructure: unfinished }), player())).toBe(2);
        expect(Infrastructure.getRiverPenalty(tile({ hasRiver: true, infrastructure: built('IRRIGATION_CHANNEL') }), player())).toBe(2);
    });

    it('Bridge Construction halves the penalty to +1', () => {
        const p = player(['bridge_construction']);
        expect(Technology.getEffectTotal(p, 'riverCrossReduction')).toBeCloseTo(0.5);
        expect(Infrastructure.getRiverPenalty(tile({ hasRiver: true }), p)).toBe(1);
        expect(Infrastructure.getPlayerMoveCost(tile({ hasRiver: true }), p)).toBe(3);
    });

    it('bridges can be built on any river tile', () => {
        const p = player(['road_building', 'bridge_construction']);
        p.gold = 1000;
        expect(Infrastructure.canBuild(p, 'BRIDGE', tile({ hasRiver: true }), null).can).toBe(true);
    });
});

describe('Player movement respects the river penalty', () => {
    // 5x1 wrapping strip: player at (0,0), river at (1,0), plains at (2,0),
    // and impassable peaks at (3,0)/(4,0) so the only way east is the river
    function strip(riverExtra = {}) {
        const peak = (q) => tile({ q, terrain: { id: 'snow_peak', passable: false, moveCost: Infinity } });
        const tiles = [tile({ q: 0 }), tile({ q: 1, hasRiver: true, ...riverExtra }), tile({ q: 2 }), peak(3), peak(4)];
        return { width: 5, height: 1, tiles: [tiles], getTile: (q, r) => (r === 0 ? tiles[q] : null) };
    }

    it('charges the penalty per step and in the reachable-hex preview', () => {
        const p = new Player();
        p.q = 0; p.r = 0; p.movementRemaining = 4;
        const world = strip();
        expect(p._hexMoveCost(world.getTile(1, 0))).toBe(4);
        expect(p._hexMoveCost(world.getTile(2, 0))).toBe(2);
        const reach = p.getReachableHexes(world);
        expect(reach.get('1,0')).toBe(4);
        expect(reach.has('2,0')).toBe(false);
    });

    it('a bridge makes the far bank reachable', () => {
        const p = new Player();
        p.q = 0; p.r = 0; p.movementRemaining = 4;
        const reach = p.getReachableHexes(strip({ infrastructure: built('BRIDGE') }));
        expect(reach.get('1,0')).toBe(1);
        expect(reach.get('2,0')).toBe(3);
    });
});
