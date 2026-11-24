// The fighting pit on the street map (world/pitRing.js): a fenced ring with a
// gate while the pit fights in the open, none once the law drives it
// underground; on a fight night the townsfolk stand at its fence
// (world/innerMap/pitCrowd.js); its fence opens the pit's panel (ui/innerMapPit.js).

import { describe, it, expect, beforeAll } from 'vitest';

let DataLoader, CustomObjects, PitRing, InnerMap;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    ({ DataLoader } = await import('../core/dataLoader.js'));
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ PitRing } = await import('../world/pitRing.js'));
    ({ InnerMap } = await import('../world/innerMap.js'));
    CustomObjects.reset();
    await CustomObjects.loadAll();
}, 120000);

/** A 40x30 town of open ground, a street along row 15. */
function town() {
    const tiles = Array.from({ length: 30 }, (_, r) => Array.from({ length: 40 }, (_, q) => ({
        q, r, explored: true, visible: true, isRoad: r === 15, subTerrain: { id: r === 15 ? 'cobble' : 'grass', passable: true },
    })));
    return { tiles, plaza: { q: 14, r: 10, w: 10, h: 4 }, center: { q: 20, r: 15 } };
}

const pitTown = (underground = false) => ({ name: 'Ashford', type: 'town', q: 3, r: 4, pit: { id: 'pit3,4', name: 'the Sand', underground } });

describe('the pit on the street map', () => {
    it('a pit in the open is a fenced ring with a gate, off the street, its fence marked as the pit\'s', () => {
        const s = pitTown();
        expect(PitRing.stamp(s)).toMatch(/pit/);
        const { tiles, plaza, center } = town();
        const ring = PitRing.lay(tiles, s, { plaza, center });
        expect(ring).toBeTruthy();
        const gate = tiles[ring.gate.r][ring.gate.q].customObject;
        expect(gate.defId).toBe('tp_fence_gate');
        expect(gate.pit).toBe('pit3,4');
        // a corner joined as a corner, the floor open ground inside
        const corner = tiles[ring.r][ring.q].customObject;
        expect(corner && /^tp_fence_/.test(corner.defId)).toBe(true);
        expect(corner.defId).not.toBe('tp_fence_ew');
        let floor = 0;
        for (let r = ring.r; r < ring.r + ring.h; r++) for (let q = ring.q; q < ring.q + ring.w; q++) {
            expect(tiles[r][q].isRoad).toBe(false);
            if (tiles[r][q]._pitFloor) { floor++; expect(tiles[r][q].customObject).toBeFalsy(); }
        }
        expect(floor).toBe((ring.w - 2) * (ring.h - 2));
        expect(PitRing.spot(tiles)).toBe(ring);
    });

    it('a pit gone underground has no ring', () => {
        const s = pitTown(true);
        expect(PitRing.stamp(s)).toBe('');
        const { tiles, plaza, center } = town();
        expect(PitRing.lay(tiles, s, { plaza, center })).toBe(null);
        expect(tiles.flat().some(t => t.customObject && t.customObject.pit)).toBe(false);
    });

    it('on a fight night, after dusk, townsfolk go and stand at the fence facing the ring', () => {
        const s = pitTown();
        const { tiles, plaza, center } = town();
        const ring = PitRing.lay(tiles, s, { plaza, center });
        let day = 40;
        while (!PitRing.nightOf(s, day).fight) day++;
        InnerMap.tiles = tiles;
        InnerMap.width = 40;
        InnerMap.height = 30;
        InnerMap.worldDay = day;
        InnerMap.timeOfDay = 20;
        InnerMap._timeAccumulator = 0;
        InnerMap.playerInnerQ = 0;
        InnerMap.playerInnerR = 0;
        InnerMap.npcs = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, uid: `f${i}`, type: 'villager', q: 2 + (i % 10), r: 26 + Math.floor(i / 10), state: 'idle' }));
        let going = 0;
        for (const n of InnerMap.npcs) if (InnerMap._pitPick(n)) going++;
        expect(going).toBeGreaterThan(4);
        const walker = InnerMap.npcs.find(n => n.state === 'walking');
        const end = walker.path[walker.path.length - 1];
        expect(PitRing.railCells(ring).some(c => c.q === end.q && c.r === end.r)).toBe(true);
        // ...and not by day, nor on a night without bouts
        InnerMap.timeOfDay = 11;
        expect(InnerMap.npcs.filter(n => InnerMap._pitPick({ ...n, state: 'idle', path: null })).length).toBe(0);
        InnerMap.timeOfDay = 20;
        let quiet = day + 1;
        while (PitRing.nightOf(s, quiet).fight) quiet++;
        InnerMap.worldDay = quiet;
        expect(InnerMap.npcs.filter(n => InnerMap._pitPick({ ...n, state: 'idle', path: null })).length).toBe(0);
    });
});
