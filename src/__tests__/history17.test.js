// Worlds since terrainGen 17 (world/landHistory.js, data/landHistory.json): history written
// into the land. The ruins stand on good town sites no living town took (a ford, a river
// mouth, a confluence, a lake shore, a pass foot), a few are hill forts over the mountain
// passes, a few worked-out mines in an ore field (some still hiding a vein); faint old
// roads link some ruins to each other and to the passes. Older worlds are unchanged.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { TownSiting } from '../world/townSiting.js';
import { Hinterland } from '../world/hinterland.js';
import { Infrastructure } from '../systems/infrastructure.js';

const SEEDS = [4711, 1234, 31337];
const make = (gen, seed) => {
    const w = new World(120, 80);
    w.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40 });
    return w;
};
const pois = (w) => w.tiles.flat().filter(t => t.improvement);
const ruinsOf = (w) => pois(w).filter(t => t.improvement.type === 'ruins');
const fingerprint = (w) => Utils.hashStr(pois(w)
    .map(t => `${t.improvement.type}@${t.q},${t.r}:${t.improvement.name}`).sort().join('|'));

let w16 = [], w17 = [];
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    w16 = SEEDS.map(s => make(16, s));
    w17 = SEEDS.map(s => make(17, s));
}, 240000);

describe('History in the land (terrainGen 17)', () => {
    it('keeps as many points of interest, and of ruins, as before', () => {
        const sum = (ws, f) => ws.reduce((a, w) => a + f(w).length, 0);
        const p16 = sum(w16, pois), p17 = sum(w17, pois);
        expect(p17).toBeGreaterThan(p16 * 0.7);
        expect(p17).toBeLessThan(p16 * 1.3 + 3);
        const r16 = sum(w16, ruinsOf);
        const r17 = sum(w17, w => pois(w).filter(t => t.improvement.history));
        expect(r17).toBeGreaterThan(r16 * 0.5);
        expect(r17).toBeLessThan(r16 * 1.6 + 3);
    });

    it('puts lost towns on good empty sites: they score far better than gen 16 ruins did', () => {
        const mean = (ws, pick) => {
            const v = [];
            for (const w of ws) {
                const m = TownSiting.map(w.tiles, w.width, w.height);
                for (const t of pick(w)) v.push(m.score(t.q, t.r, 'town'));
            }
            return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
        };
        const s16 = mean(w16, ruinsOf);
        const s17 = mean(w17, w => ruinsOf(w).filter(t => t.improvement.history === 'town'));
        expect(s17).toBeGreaterThan(s16 + 3);
        for (const w of w17) {
            const towns = ruinsOf(w).filter(t => t.improvement.history === 'town');
            for (const t of towns) {
                expect(t.settlement).toBeFalsy();
                expect(['ford', 'mouth', 'confluence', 'lake', 'pass', 'coast', 'river']).toContain(t.improvement.site);
                expect(t.improvement.lore.length).toBeGreaterThan(10);
                for (const s of w.getAllSettlements()) {
                    expect(Hex.wrappingOffsetDistance(t.q, t.r, s.q, s.r, w.width)).toBeGreaterThanOrEqual(3);
                }
            }
        }
    });

    it('raises hill forts on high ground overlooking a pass', () => {
        let forts = 0;
        for (const w of w17) {
            const passes = w.tiles.flat().filter(t => t._pass);
            for (const t of pois(w).filter(x => x.improvement.history === 'fort')) {
                forts++;
                expect(['hills', 'highlands', 'mountain']).toContain(t.terrain.id);
                expect(t._pass).toBeFalsy();
                const d = Math.min(...passes.map(p => Hex.wrappingOffsetDistance(t.q, t.r, p.q, p.r, w.width)));
                expect(d).toBeLessThanOrEqual(3);
            }
        }
        expect(forts).toBeGreaterThan(0);
    });

    it('leaves worked-out mines inside ore fields, a delvable Abandoned Mine', () => {
        let mines = 0;
        for (const w of w17) {
            for (const t of pois(w).filter(x => x.improvement.history === 'mine')) {
                mines++;
                expect(t.improvement.type).toBe('cave');
                expect(t.ores && t.ores[t.improvement.ore]).toBeGreaterThan(0.4);
                expect(['hills', 'highlands', 'mountain']).toContain(t.terrain.id);
                expect(t.resource).toBeFalsy();
                if (t.improvement.vein) expect(t._oldVein).toBe(t.improvement.vein);
            }
        }
        expect(mines).toBeGreaterThan(0);
    });

    it('lays a few faint old roads from ruin to ruin or pass, quicker than open land, slower than a road', () => {
        let roads = 0;
        for (const w of w17) {
            const land = w.tiles.flat().filter(t => t.terrain.passable).length;
            const old = w.tiles.flat().filter(t => t._oldRoad);
            expect(old.length / land).toBeLessThan(0.03);
            expect(old.every(t => !t.hasRoad && !t.settlement)).toBe(true);
            for (const road of w.oldRoads) {
                roads++;
                const end = (p) => { const t = w.getTile(p[0], p[1]); return !!(t.improvement && t.improvement.history) || !!t._pass; };
                expect(end(road.a) && end(road.b)).toBe(true);
                expect(road.path[0]).toEqual(road.a);
                expect(road.path[road.path.length - 1]).toEqual(road.b);
                for (let i = 1; i < road.path.length; i++) {
                    const [aq, ar] = road.path[i - 1], [bq, br] = road.path[i];
                    expect(Hex.directionTo(aq, ar, bq, br, w.width)).toBeGreaterThanOrEqual(0);
                }
            }
        }
        expect(roads).toBeGreaterThan(0);
        // Days per hex: an old road on grass beats grass, and loses to a track
        const grass = (extra) => ({ q: 0, r: 0, terrain: { id: 'grassland', passable: true }, ...extra });
        const open = Infrastructure.getPlayerHexDays(grass({}), null);
        const oldRoad = Infrastructure.getPlayerHexDays(grass({ _oldRoad: true }), null);
        const track = Infrastructure.getPlayerHexDays(grass({ hasRoad: true, roadTier: 'track', roadMove: 0.6 }), null);
        expect(oldRoad).toBeLessThan(open);
        expect(oldRoad).toBeGreaterThan(track);
    });

    it("strikes an old mine's hidden vein first when a town prospects within reach", () => {
        const w = make(17, SEEDS[0]);
        const mine = w.tiles.flat().find(t => t.improvement && t.improvement.history === 'mine');
        expect(mine).toBeTruthy();
        // (a world whose old mines all came up dry: hide the vein in one for the test)
        const t = w.tiles.flat().find(x => x._oldVein) || Object.assign(mine, { _oldVein: 'iron_mine' });
        const res = Hinterland.strike(w, { q: t.q, r: t.r, type: 'town', name: 'Test' }, 'test:vein', 1, { newOnly: true });
        expect(res && res.kind).toBe('strike');
        expect([res.site.q, res.site.r]).toEqual([t.q, t.r]);
        expect(res.site.kind).toBe(t._oldVein);
    });

    it('is deterministic for a seed', () => {
        const again = make(17, SEEDS[0]);
        expect(fingerprint(again)).toBe(fingerprint(w17[0]));
        expect(JSON.stringify(again.oldRoads)).toBe(JSON.stringify(w17[0].oldRoads));
    });

    it('leaves gen 16 worlds as they were: ruins anywhere, no history, no old roads', () => {
        for (const w of w16) {
            expect(pois(w).some(t => t.improvement.history)).toBe(false);
            expect(w.tiles.flat().some(t => t._oldRoad || t._oldVein)).toBe(false);
            expect(w.oldRoads).toBeUndefined();
        }
    });
});
