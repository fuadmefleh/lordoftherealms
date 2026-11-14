// Four quick wins: following the road on the street map (world/roadTrace.js,
// ui/innerMapRoadWalk.js), the sea's currents shown and told (ui/renderer/currents.js,
// OceanCurrents.describe), a line cast from beside your net (ui/innerMapRiverDrift.js),
// and a companion's mood moved by a talk (systems/companionChatMood.js).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { traceRoad, bestRoadHeading, dirIndex } from '../world/roadTrace.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapRoadWalk } from '../ui/innerMapRoadWalk.js';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import { OceanCurrents } from '../world/oceanCurrents.js';
import { currentsDisplay } from '../ui/renderer/currents.js';
import { InnerMapRiverDrift } from '../ui/innerMapRiverDrift.js';
import { RiverNets } from '../systems/riverNets.js';
import { CompanionChatMood } from '../systems/companionChatMood.js';
import { Companions } from '../systems/companions.js';
import { NpcChat } from '../systems/npcChat.js';
import { Relationships } from '../systems/relationships.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

/** A W x H grid, road where `road(q, r)` says */
function grid(W, H, road) {
    const cells = new Set();
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (road(q, r)) cells.add(r * W + q);
    return { W, H, isRoad: (q, r) => cells.has(r * W + q), canStep: () => true };
}

describe('tracing a road', () => {
    it('names the eight ways', () => {
        expect(dirIndex(0, -1)).toBe(0);
        expect(dirIndex(1, 0)).toBe(2);
        expect(dirIndex(-1, 1)).toBe(5);
        expect(dirIndex(0, 0)).toBe(-1);
    });

    it('follows a wide straight road to the edge of the map', () => {
        const m = grid(30, 15, (q, r) => r >= 6 && r <= 8);
        const t = traceRoad(m, { q: 5, r: 7 }, { dq: 1, dr: 0 });
        expect(t.end).toBe('edge');
        expect(t.cells[t.cells.length - 1].q).toBe(29);
        expect(t.cells.every(c => m.isRoad(c.q, c.r))).toBe(true);
    });

    it('stops at a crossroads, and runs out at a dead end', () => {
        const m = grid(40, 21, (q, r) => (r >= 9 && r <= 11) || (q >= 24 && q <= 26 && r < 9));
        const t = traceRoad(m, { q: 3, r: 10 }, { dq: 1, dr: 0 });
        expect(t.end).toBe('junction');
        const last = t.cells[t.cells.length - 1];
        expect(last.q).toBeGreaterThanOrEqual(21);
        expect(last.q).toBeLessThanOrEqual(26);
        const dead = grid(20, 10, (q, r) => r === 5 && q >= 2 && q <= 12);
        const d = traceRoad(dead, { q: 3, r: 5 }, { dq: 1, dr: 0 });
        expect(d.end).toBe('deadEnd');
        expect(d.cells[d.cells.length - 1]).toEqual({ q: 12, r: 5 });
    });

    it('bends with a road that turns, never back on itself', () => {
        // east along r=5 to q=15, then south down q=15 to the bottom
        const m = grid(30, 30, (q, r) => (r === 5 && q <= 15) || (q === 15 && r >= 5));
        const t = traceRoad(m, { q: 2, r: 5 }, { dq: 1, dr: 0 });
        expect(t.end).toBe('edge');
        expect(t.cells[t.cells.length - 1]).toEqual({ q: 15, r: 29 });
        expect(new Set(t.cells.map(c => `${c.q},${c.r}`)).size).toBe(t.cells.length);
    });

    it('a wide road round a bend is no junction; a T is', () => {
        const wide = grid(40, 40, (q, r) => (r >= 5 && r <= 7 && q <= 20) || (q >= 18 && q <= 20 && r >= 5));
        const t = traceRoad(wide, { q: 2, r: 6 }, { dq: 1, dr: 0 });
        expect(t.end).toBe('edge');
        expect(t.cells[t.cells.length - 1].r).toBe(39);
        const tee = grid(40, 40, (q, r) => (r >= 19 && r <= 21 && q <= 20) || (q >= 20 && q <= 22));
        const j = traceRoad(tee, { q: 2, r: 20 }, { dq: 1, dr: 0 });
        expect(j.end).toBe('junction');
        expect(j.cells[j.cells.length - 1].q).toBeGreaterThanOrEqual(17);
    });

    it('picks the way the road runs nearest the one asked', () => {
        const m = grid(20, 20, (q) => q === 10);
        expect(bestRoadHeading(m, 10, 10, { dq: 1, dr: 0 })).not.toBe(null);
        expect(bestRoadHeading(m, 10, 10, { dq: 0, dr: 1 })).toEqual({ dq: 0, dr: 1 });
        expect(bestRoadHeading(m, 10, 10, { dq: 0, dr: -1 })).toEqual({ dq: 0, dr: -1 });
    });
});

describe('following the road on the street map', () => {
    beforeEach(() => {
        const tiles = [];
        for (let r = 0; r < 12; r++) {
            const row = [];
            for (let q = 0; q < 24; q++) {
                const road = r >= 5 && r <= 6;
                row.push({ q, r, explored: true, visible: true, isRoad: road, subTerrain: { id: road ? 'dirt' : 'grass', passable: true } });
            }
            tiles.push(row);
        }
        Object.assign(InnerMap, { active: true, tiles, width: 24, height: 12, _insideBuilding: null, _swimAllowed: false, playerInnerQ: 3, playerInnerR: 5, _climb: null, _climbRequest: null });
        InnerMap.cancelPlayerWalk();
        InnerMapRoadWalk._path = null;
        InnerMapRoadWalk._cont = null;
        InnerMapRenderer._playerFacing = 3; // facing right
    });

    it('walks on along the road the way you face, to the edge, ready to go on', () => {
        const game = { player: { q: 4, r: 4 }, ui: { showNotification() {} } };
        const res = InnerMapRoadWalk.start(game, {});
        expect(res.ok).toBe(true);
        expect(res.end).toBe('edge');
        expect(InnerMapRoadWalk.isWalking()).toBe(true);
        expect(InnerMapRoadWalk._cont).toMatchObject({ hex: '4,4' });
        for (let i = 0; i < 2000 && InnerMap._playerWalking; i++) InnerMap.updatePlayer(1 / 30);
        expect(InnerMap.playerInnerQ).toBe(23);
        // The crossing refused (still the same hex): the follow is forgotten
        InnerMapRoadWalk.update(game);
        expect(InnerMapRoadWalk._cont).toBe(null);
    });

    it('takes up the road again in the next hex', () => {
        const game = { player: { q: 4, r: 4 }, ui: { showNotification() {} } };
        InnerMapRoadWalk.start(game, {});
        for (let i = 0; i < 2000 && InnerMap._playerWalking; i++) InnerMap.updatePlayer(1 / 30);
        // across into the next hex, come in on the west edge
        game.player.q = 5;
        InnerMap.playerInnerQ = 0; InnerMap.playerInnerR = 6;
        InnerMapRoadWalk.update(game);
        expect(InnerMapRoadWalk.isWalking()).toBe(true);
        expect(InnerMap._playerPath[InnerMap._playerPath.length - 1].q).toBe(23);
    });

    it('is taken over by another walk, and stops on R', () => {
        const game = { player: { q: 4, r: 4 }, ui: { showNotification() {} } };
        InnerMapRoadWalk.toggle(game);
        expect(InnerMapRoadWalk.isWalking()).toBe(true);
        InnerMap.movePlayerTo(3, 9);
        InnerMapRoadWalk.update(game);
        expect(InnerMapRoadWalk._path).toBe(null);
        InnerMap.cancelPlayerWalk();
        InnerMapRoadWalk.toggle(game);
        expect(InnerMapRoadWalk.isWalking()).toBe(true);
        InnerMapRoadWalk.toggle(game);
        expect(InnerMapRoadWalk._path).toBe(null);
        expect(InnerMap._playerPath.length).toBeLessThanOrEqual(2);
    });

    it('offers Follow the Road on road cells only; refuses with no road near', () => {
        expect(InnerMapRoadWalk.menuItems({}, InnerMap.tiles[5][8], 8, 5).map(i => i.action)).toEqual(['roadwalk_follow']);
        expect(InnerMapRoadWalk.menuItems({}, InnerMap.tiles[1][8], 8, 1)).toEqual([]);
        InnerMap.playerInnerR = 0; InnerMap.playerInnerQ = 3;
        const res = InnerMapRoadWalk.start({ player: { q: 0, r: 0 } }, {});
        expect(res.ok).toBe(false);
    });
});

describe('the sea\'s currents shown', () => {
    it('tells a current in words', () => {
        expect(OceanCurrents.describe({ name: 'the westerly drift', dir: 0, strength: 0.8 })).toBe('the westerly drift, running east, strong');
        expect(OceanCurrents.describe({ name: 'the polar current', dir: 3, strength: 0.3 })).toBe('the polar current, running west, gentle');
        expect(OceanCurrents.describe(null)).toBe('');
    });

    it('reads its display from data/currents.json', () => {
        const d = currentsDisplay();
        expect(d.enabled).toBe(true);
        expect(d.streaks).toBeGreaterThan(0);
        expect(d.modes.trade).toBeGreaterThan(1);
    });
});

describe('fishing from your net stake', () => {
    it('stands on the dry bank, casts at the net, with the stake\'s bonus', () => {
        const tiles = [];
        for (let r = 0; r < 10; r++) {
            const row = [];
            for (let q = 0; q < 10; q++) {
                const wet = q >= 5;
                row.push({ q, r, _wet: wet, subTerrain: { id: wet ? 'water' : 'grass', passable: !wet } });
            }
            tiles.push(row);
        }
        Object.assign(InnerMap, { active: true, tiles, width: 10, height: 10, playerInnerQ: 4, playerInnerR: 3 });
        const net = { id: 'n1', water: 'river', cell: { x: 6, y: 3 }, bank: { q: 4, r: 3 }, still: false };
        const o = InnerMapRiverDrift.netFishing({}, net);
        expect(o.spots).toEqual([{ q: 4, r: 3 }]);
        expect(o.target).toEqual({ q: 6, r: 3 });
        expect(o.depth).toBe('shallow');
        expect(o.biteBonus).toBeCloseTo(RiverNets.config().stakeBite);
        expect(InnerMapRiverDrift.netFishing({}, { ...net, torn: true }).biteBonus).toBeCloseTo(RiverNets.config().stakeBite / 2);
        // in the water, the stake's bank is where you cast from
        InnerMap.playerInnerQ = 7;
        expect(InnerMapRiverDrift.netFishing({}, net).spots).toEqual([{ q: 4, r: 3 }]);
    });
});

describe('a companion\'s mood, moved by a talk', () => {
    let _n = 0;
    const mk = () => {
        const n = { id: `cm_${++_n}`, firstName: 'Mira', dynasty: 'Vale', gender: 'female', age: 30, occupation: 'guard', isAlive: true, traits: [] };
        Relationships._npcs.push(n);
        Companions.ensure(n);
        return n;
    };
    const world = () => ({ day: 12, season: 'Spring', year: 853, width: 40, height: 40, getTile: () => null, units: [], kingdoms: [] });

    it('warms a travelling companion: approval up, a note, a bubble queued', () => {
        const n = mk();
        const p = { name: 'Ash', relationships: {}, gold: 0, inventory: {}, travelParty: [n.id] };
        const was = n.companion.approval;
        const notes = [];
        const r = CompanionChatMood.afterTalk(p, world(), n, 4, notes);
        expect(r.delta).toBeGreaterThan(0);
        expect(n.companion.approval).toBeGreaterThan(was);
        expect(notes[0].text).toMatch(/Mira is (pleased|delighted)/);
        const rx = CompanionChatMood.drainReactions(p);
        expect(rx).toHaveLength(1);
        expect(rx[0]).toMatchObject({ npcId: n.id, tone: 'good' });
        expect(rx[0].text).toMatch(/^\+ /);
        expect(CompanionChatMood.drainReactions(p)).toEqual([]);
        expect(Object.keys(p)).not.toContain('_companionReactions');
    });

    it('sours one, capped; leaves those not travelling with you alone', () => {
        const n = mk();
        const p = { name: 'Ash', relationships: {}, travelParty: [n.id] };
        const was = n.companion.approval;
        CompanionChatMood.afterTalk(p, world(), n, -100, []);
        expect(was - n.companion.approval).toBeCloseTo(CompanionChatMood.config().maxDown);
        expect(CompanionChatMood.drainReactions(p)[0].text).toMatch(/^− /);
        const away = mk();
        expect(CompanionChatMood.afterTalk({ travelParty: [] }, world(), away, 5, [])).toBe(null);
    });

    it('follows a free talk\'s warmth (NpcChat.applyActions)', () => {
        const n = mk();
        const p = { name: 'Ash', q: 1, r: 1, relationships: {}, gold: 100, actionPoints: 5, army: [], inventory: {}, travelParty: [n.id] };
        const w = world();
        const s = NpcChat.startSession(p, w, n);
        const was = n.companion.approval;
        const done = NpcChat.applyActions(p, w, n, s, [{ fn: 'warm_to', amount: 4 }]);
        expect(n.companion.approval).toBeGreaterThan(was);
        expect(done.notes.some(x => /Mira is/.test(x.text))).toBe(true);
    });
});
