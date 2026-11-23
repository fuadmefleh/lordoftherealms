// Settlements founded in play in worlds since terrainGen 16 choose their sites as
// generation does (world/townSiting.js, data/kingdoms.json siting.founded): a realm's
// new villages (KingdomAI.tryExpand), its pioneers (Colonization.launchKingdomPioneers),
// wandering settlers (WorldUnit.updateSettler) and a village's daughter party
// (VillageFounding.bestSites) rank candidate hexes by the site score, inside their own
// rules (territory, spacing, reach). Older worlds found exactly as before.
//
// The comparison is on one map: the same gen-16 world twice, the second told it is a
// gen-15 world (generationParams.terrainGen), so it founds by the old rules.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { TownSiting } from '../world/townSiting.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Colonization } from '../world/colonization.js';
import { WorldUnit } from '../world/units.js';
import { VillageFounding } from '../world/villageFounding.js';

const SEED = 4711;
const make = (asGen) => {
    const w = new World(120, 80);
    w.generate({ seed: SEED, kingdomCount: 6, terrainGen: 16, riverCount: 40 });
    w.generationParams.terrainGen = asGen;
    return w;
};
const keyOf = (s) => `${s.q},${s.r}`;
const wet = (m, q, r) => { const f = m.liveFeatures(q, r); return f.river || f.riverNear || f.lakeShore || f.coast; };

/** Let every realm expand `rounds` times with foundChance 1; → the villages founded, with their tile */
function expandAll(w, rounds) {
    const G = DataLoader._gamedata.realmGrowth;
    const was = G.foundChance;
    G.foundChance = 1;
    const before = new Set(w.getSettlementViews().map(keyOf));
    Utils.setSeed(99);
    try {
        for (let d = 1; d <= rounds; d++) {
            w.day = d;
            for (const k of w.kingdoms) if (k.isAlive) KingdomAI.tryExpand(k, w);
        }
    } finally { G.foundChance = was; }
    return w.getSettlementViews().filter(s => !before.has(keyOf(s))).map(s => ({ ...s, tile: w.getTile(s.q, s.r) }));
}

/** Send pioneers from every realm `n` times (the caps lifted); → their targets */
function pioneerTargets(w, n) {
    Utils.setSeed(77);
    const out = [];
    for (let i = 0; i < n; i++) {
        for (const k of w.kingdoms) {
            if (!k.isAlive || !k.capital) continue;
            k.treasury = 10000; k.military = 1000;
            Colonization._ensureKingdomColonization(k);
            k.colonization.pioneersActive = 0;
            k.colonization.colonies = [];
            const u = Colonization.launchKingdomPioneers(k, w);
            if (u) { out.push({ q: u.targetQ, r: u.targetR }); u.destroyed = true; }
        }
    }
    w.units = w.units.filter(u => !u.destroyed);
    return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

let w16, wOld, map;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    w16 = make(16);
    wOld = make(15);
    map = TownSiting.map(w16.tiles, w16.width, w16.height);
}, 600000);

describe('founding in play, terrainGen 16', () => {
    it('only worlds since 16 (and not custom ones) are sited in play', () => {
        // (one map: the two worlds were made alike)
        expect(w16.getSettlementViews().map(keyOf).sort().join('|')).toBe(wOld.getSettlementViews().map(keyOf).sort().join('|'));
        expect(TownSiting.forWorld(w16)).toBeTruthy();
        expect(TownSiting.forWorld(wOld)).toBeNull();
        expect(TownSiting.forWorld({ ...w16, generationParams: { ...w16.generationParams, customWorld: true } })).toBeNull();
        // live() reads the land as it is now: the same as the generation score until it changes
        const s = w16.getSettlementViews()[0];
        expect(map.live(s.q, s.r, 'village')).toBeCloseTo(map.score(s.q, s.r, 'village'), 6);
    });

    // (the settlers and the daughter party first: both worlds still hold the same towns)
    it('wandering settlers go to the best site near the spot they drew, by the same rules', () => {
        const views = w16.getSettlementViews();
        let better = 0;
        for (let i = 0; i < 12; i++) {
            const from = views[i % views.length];
            const go = (w) => {
                Utils.setSeed(500 + i);
                const u = new WorldUnit('settler', from.q, from.r);
                const spd = u.stepsToday; u.stepsToday = () => 0; // (choose, don't walk)
                u.updateSettler(w, null);
                u.stepsToday = spd;
                return u;
            };
            const ua = go(w16);
            const ub = go(wOld);
            if (ub.targetQ === null) continue;
            const sa = map.live(ua.targetQ, ua.targetR, 'village');
            const sb = map.live(ub.targetQ, ub.targetR, 'village');
            expect(sa).toBeGreaterThanOrEqual(sb);
            if (sa > sb) better++;
            const t = w16.getTile(ua.targetQ, ua.targetR);
            expect(t.regionId).toBe(w16.getTile(from.q, from.r).regionId);
            expect(views.every(s => Hex.wrappingDistance(t.q, t.r, s.q, s.r, w16.width) > 6)).toBe(true);
        }
        expect(better).toBeGreaterThan(0);
    });

    it("a daughter party's sites rank by the site score as well; older worlds by the survey alone", () => {
        const from = w16.getSettlementViews().slice().sort((x, y) => y.population - x.population)[0];
        const a = VillageFounding.bestSites(w16, from, { maxRange: 8, limit: 5 });
        const b = VillageFounding.bestSites(wOld, from, { maxRange: 8, limit: 5 });
        expect(a.length).toBeGreaterThan(0);
        expect(a.every(s => s.ok)).toBe(true);
        expect(a.every(s => Number.isFinite(s.siteScore))).toBe(true);
        expect(b.every(s => s.siteScore === undefined)).toBe(true);
        expect(map.live(a[0].q, a[0].r, 'village')).toBeGreaterThanOrEqual(map.live(b[0].q, b[0].r, 'village'));
    });

    it("a realm's new villages take better ground than before, on its own land, spaced as before", () => {
        const a = expandAll(w16, 120);
        const b = expandAll(wOld, 120);
        expect(a.length).toBeGreaterThan(10);
        expect(b.length).toBeGreaterThan(10);
        const mOld = TownSiting.map(wOld.tiles, wOld.width, wOld.height);
        const sa = a.map(s => map.live(s.q, s.r, 'village'));
        const sb = b.map(s => mOld.live(s.q, s.r, 'village'));
        expect(mean(sa)).toBeGreaterThan(mean(sb) + 2);
        const wetA = a.filter(s => wet(map, s.q, s.r)).length / a.length;
        const wetB = b.filter(s => wet(mOld, s.q, s.r)).length / b.length;
        expect(wetA).toBeGreaterThan(wetB);
        const minScore = TownSiting.founded('expand').minScore;
        const spacing = DataLoader._gamedata.realmGrowth.minSpacing;
        const all = w16.getSettlementViews();
        for (const s of a) {
            expect(map.live(s.q, s.r, 'village')).toBeGreaterThanOrEqual(minScore);
            expect(s.tile.kingdom).toBe(s.kingdom);
            expect(s.tile.terrain.passable).toBe(true);
        }
        // (the spacing rule held at each founding: no two new villages within minSpacing)
        for (const s of a) {
            const near = all.filter(o => keyOf(o) !== keyOf(s) && Hex.wrappingDistance(s.q, s.r, o.q, o.r, w16.width) <= spacing);
            const newer = near.filter(o => a.some(x => keyOf(x) === keyOf(o)));
            expect(newer.length).toBe(0);
        }
    });

    it("a realm's pioneers aim for better sites, and only open land", () => {
        const a = pioneerTargets(w16, 8);
        const b = pioneerTargets(wOld, 8);
        expect(a.length).toBeGreaterThan(5);
        const mOld = TownSiting.map(wOld.tiles, wOld.width, wOld.height);
        expect(mean(a.map(t => map.live(t.q, t.r, 'village')))).toBeGreaterThan(mean(b.map(t => mOld.live(t.q, t.r, 'village'))) + 2);
        const views = w16.getSettlementViews();
        for (const t of a) {
            const tile = w16.getTile(t.q, t.r);
            expect(tile.terrain.passable && !tile.settlement && !tile.kingdom).toBe(true);
            expect(Math.min(...views.map(s => Hex.wrappingDistance(t.q, t.r, s.q, s.r, w16.width)))).toBeGreaterThanOrEqual(Colonization.MIN_SETTLEMENT_DISTANCE);
        }
    });

    it('is reproducible', () => {
        const w = make(16);
        const x = expandAll(w, 40).map(keyOf).join('|');
        const y = expandAll(make(16), 40).map(keyOf).join('|');
        expect(x).toBe(y);
        expect(x.length).toBeGreaterThan(0);
    });
});
