// ============================================
// LAND HISTORY — the past written into the map (terrainGen 17+)
// ============================================
//
// Worlds since terrainGen 17 place their ruins where the past would have
// left them, not at random: most stand on good town sites no living town
// took (a ford, a river mouth, a confluence, a lake shore, the foot of a
// pass: world/townSiting.js scores), a few are hill forts on the heights
// over a mountain pass, a few worked-out mines in an ore field (a delvable
// Abandoned Mine; some still hide a vein that prospecting strikes first,
// world/hinterland.js). Faint old roads (tile._oldRoad, world.oldRoads) link
// some ruins to each other and to the passes: a little quicker than open
// ground, slower than any road (systems/infrastructure.js). Names and lore
// in data/landHistory.json. Draws from its own seeded stream, so the world's
// main dice are untouched. Older worlds keep World.placePointsOfInterest.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Kingdom } from './kingdom.js';
import { TownSiting } from './townSiting.js';

const DEFAULTS = {
    ruins: { townPool: 6, minSettlement: 3, minApart: 5, fortShare: 0.25, mineShare: 0.2 },
    forts: { reach: 3, terrains: ['hills', 'highlands', 'mountain'] },
    mines: { minOre: 0.45, terrains: ['hills', 'highlands', 'mountain'], veinChance: 0.3, kinds: {} },
    oldRoads: { maxLength: 24, toPass: 12, travelFactor: 0.85, render: {} },
    text: { town: {}, fort: {}, mine: {}, ores: {} },
};

// The site a lost town is told by, first that fits
const SITE_ORDER = ['ford', 'mouth', 'confluence', 'lake', 'pass', 'coast', 'river', 'plain'];
const CULTURES = ['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'];

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export const LandHistory = {
    /** Does this world write its history into the land? */
    applies(terrainGen) {
        return (Number(terrainGen) || 1) >= 17;
    },

    cfg() {
        const d = obj(DataLoader._gamedata && DataLoader._gamedata.landHistory);
        const out = {};
        for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k], ...obj(d[k]) };
        return out;
    },

    /** Days per hex on an old road, times the open ground's. */
    travelFactor() {
        const f = LandHistory.cfg().oldRoads.travelFactor;
        return f > 0 && f <= 1 ? f : 0.85;
    },

    _stream(world, tag) {
        const seed = String((world.generationParams && world.generationParams.seed) || 'world');
        return Utils.seededRandom(Math.abs(Utils.hashStr(`landHistory:${tag}:${seed}`)) % 233280);
    },

    // ── Points of interest ─────────────────────────────

    /**
     * World.placePointsOfInterest for terrainGen 17+: as many points of
     * interest of each type as before (ruinsFreq), the ruins sited by history.
     */
    placePointsOfInterest(world, freq = 'normal', opts = {}) {
        return Utils.withRng(LandHistory._stream(world, 'poi'), () => LandHistory._place(world, freq, opts));
    },

    _place(world, freq, opts) {
        const allTypes = [
            { type: 'ruins', icon: '🏚️', name: 'Ancient Ruins' },
            { type: 'shrine', icon: '⛩️', name: 'Roadside Shrine' },
            { type: 'cave', icon: '🕳️', name: 'Mysterious Cave' },
            { type: 'oasis', icon: '🌴', name: 'Desert Oasis' },
            { type: 'monument', icon: '🗿', name: 'Stone Monument' },
        ];
        const poiTypes = opts.natural ? allTypes.filter(p => p.type === 'cave' || p.type === 'oasis') : allTypes;
        const freqMap = { none: 0, few: 0.4, normal: 1.0, many: 2.0 };
        const mult = freqMap[freq] !== undefined ? freqMap[freq] : 1.0;
        const scaleFactor = Math.sqrt((world.width * world.height) / (120 * 80));
        const numPOI = Math.round(Utils.randInt(15, 30) * mult * scaleFactor);
        if (numPOI === 0) return { placed: 0 };
        const picks = [];
        for (let i = 0; i < numPOI; i++) picks.push(Utils.randPick(poiTypes));
        const C = LandHistory.cfg();
        const W = world.width;
        const settlements = world.getAllSettlements();
        const pois = [];
        const apart = num(C.ruins.minApart, 5);
        const clear = (q, r, minSettle = 2, minPoi = 4) =>
            !settlements.some(s => Hex.wrappingOffsetDistance(q, r, s.q, s.r, W) < minSettle) &&
            !pois.some(p => Hex.wrappingOffsetDistance(q, r, p.q, p.r, W) < minPoi);
        const put = (q, r, imp) => {
            world.tiles[r][q].improvement = { explored: false, founded: Utils.randInt(100, 600), ...imp };
            pois.push({ q, r });
        };

        // The ruins first, by history: forts over passes, old mines in ore fields, lost towns
        const nRuins = picks.filter(p => p.type === 'ruins').length;
        const report = { placed: 0, ruins: nRuins, forts: 0, mines: 0, towns: 0 };
        if (nRuins > 0) {
            const forts = LandHistory._fortSites(world, C);
            const mines = LandHistory._mineSites(world, C);
            const share = (s, have) => Math.min(have, Math.max(have && nRuins >= 2 ? 1 : 0, Math.round(nRuins * num(s, 0))));
            let nFort = share(C.ruins.fortShare, forts.length);
            let nMine = share(C.ruins.mineShare, mines.length);
            if (nFort + nMine > nRuins) nMine = Math.max(0, nRuins - nFort);
            if (nFort + nMine > nRuins) nFort = nRuins;
            const minSettle = num(C.ruins.minSettlement, 3);
            for (const f of forts) {
                if (report.forts >= nFort) break;
                if (!clear(f.q, f.r, minSettle, apart) || world.tiles[f.r][f.q].improvement) continue;
                put(f.q, f.r, LandHistory._ruin(world, C, 'fort', f));
                report.forts++;
            }
            LandHistory._shuffle(mines);
            for (const m of mines) {
                if (report.mines >= nMine) break;
                if (!clear(m.q, m.r, minSettle, apart) || world.tiles[m.r][m.q].improvement) continue;
                put(m.q, m.r, LandHistory._ruin(world, C, 'mine', m));
                report.mines++;
            }
            const towns = LandHistory._townSites(world, C, minSettle);
            const pool = Math.max(1, num(C.ruins.townPool, 6));
            const need = nRuins - report.forts - report.mines;
            for (let i = 0; i < need; i++) {
                // The best few open sites still clear of the others, one picked by weight
                const open = [];
                for (const c of towns) {
                    if (open.length >= pool) break;
                    if (!world.tiles[c.r][c.q].improvement && clear(c.q, c.r, minSettle, apart)) open.push(c);
                }
                if (!open.length) break;
                const low = open[open.length - 1].s;
                const c = Utils.weightedPick(open.map(o => ({ value: o, weight: 1 + o.s - low }))) || open[0];
                put(c.q, c.r, LandHistory._ruin(world, C, 'town', c));
                report.towns++;
            }
        }

        // Everything else where it falls, as before
        for (const poi of picks) {
            if (poi.type === 'ruins') continue;
            for (let attempts = 0; attempts < 200; attempts++) {
                const q = Utils.randInt(0, W - 1);
                const r = Utils.randInt(2, world.height - 3);
                const tile = world.tiles[r][q];
                if (!tile.terrain.passable || tile.settlement || tile.improvement) continue;
                if (!clear(q, r)) continue;
                put(q, r, { type: poi.type, icon: poi.icon, name: poi.name });
                break;
            }
        }
        report.placed = pois.length;
        world._landHistory = report;
        console.log(`[World] Placed ${pois.length} Points of Interest (${report.towns} lost towns, ${report.forts} pass forts, ${report.mines} old mines)`);
        return report;
    },

    /** Unbiased in-place shuffle from the current stream. */
    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Utils.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    },

    /** The pass hexes: [{ q, r, id }]. */
    _passHexes(world) {
        const out = [];
        for (const row of world.tiles) for (const t of row) if (t._pass) out.push({ q: t.q, r: t.r, id: t._pass });
        return out;
    },

    /** One fort site per pass: the highest open hill/highland/mountain hex near it, off the way itself. */
    _fortSites(world, C) {
        const terrains = new Set(C.forts.terrains || []);
        const reach = Math.max(1, Math.floor(num(C.forts.reach, 3)));
        const byPass = new Map();
        for (const p of LandHistory._passHexes(world)) {
            if (!byPass.has(p.id)) byPass.set(p.id, []);
            byPass.get(p.id).push(p);
        }
        const out = [];
        for (const [id, hexes] of [...byPass.entries()].sort((a, b) => a[0] - b[0])) {
            let best = null;
            const seen = new Set();
            for (const p of hexes) {
                for (const h of Hex.hexesInRange(p.q, p.r, reach)) {
                    if (h.r < 1 || h.r >= world.height - 1) continue;
                    const q = Hex.wrapQ(h.q, world.width);
                    const k = h.r * world.width + q;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    const t = world.tiles[h.r][q];
                    if (!t || t._pass || !t.terrain || !t.terrain.passable || !terrains.has(t.terrain.id)) continue;
                    if (t.settlement || t.improvement || t.hasRiver) continue;
                    const d = Math.min(...hexes.map(x => Hex.wrappingOffsetDistance(q, h.r, x.q, x.r, world.width)));
                    if (d < 1 || d > reach) continue;
                    const v = num(t.elevation, 0) - 0.01 * d;
                    if (!best || v > best.v) best = { q, r: h.r, v, pass: id };
                }
            }
            if (best) out.push(best);
        }
        // the highest first
        return out.sort((a, b) => b.v - a.v);
    },

    /** Hill and mountain hexes in an ore field with no resource showing: [{ q, r, ore, strength }]. */
    _mineSites(world, C) {
        const terrains = new Set(C.mines.terrains || []);
        const kinds = obj(C.mines.kinds);
        const minOre = num(C.mines.minOre, 0.45);
        const out = [];
        for (const row of world.tiles) for (const t of row) {
            if (!t.ores || t.resource || t.settlement || t.improvement || !t.terrain || !t.terrain.passable) continue;
            if (!terrains.has(t.terrain.id) || t._pass || t.r < 1 || t.r >= world.height - 1) continue;
            let ore = null, s = 0;
            for (const id of Object.keys(t.ores).sort()) {
                if (!kinds[id]) continue;
                const v = num(t.ores[id], 0);
                if (v >= minOre && v > s) { ore = id; s = v; }
            }
            if (ore) out.push({ q: t.q, r: t.r, ore, strength: s });
        }
        return out;
    },

    /** Good town sites no living town took, best first: [{ q, r, s, site }]. */
    _townSites(world, C, minSettle) {
        const map = TownSiting.map(world.tiles, world.width, world.height);
        const settlements = world.getAllSettlements();
        const W = world.width;
        const out = [];
        for (const row of world.tiles) for (const t of row) {
            if (!t.terrain || !t.terrain.passable || t.settlement || t.improvement || t._pass) continue;
            if (t.r < 2 || t.r >= world.height - 2) continue;
            const s = map.score(t.q, t.r, 'town');
            if (!Number.isFinite(s)) continue;
            const site = LandHistory._siteKind(map.features(t.q, t.r));
            if (site === 'plain') continue; // a lost town is remembered by its water or its pass
            out.push({ q: t.q, r: t.r, s, site });
        }
        out.sort((a, b) => (b.s - a.s) || (a.r - b.r) || (a.q - b.q));
        // (clear of the living towns: checked here once, the spacing between ruins as they go)
        return out.filter(c => !settlements.some(x => Hex.wrappingOffsetDistance(c.q, c.r, x.q, x.r, W) < minSettle));
    },

    /** What a site is remembered by (SITE_ORDER), from TownSiting features. */
    _siteKind(f) {
        if (!f) return 'plain';
        if (f.bigRiver) return 'ford';
        if (f.riverMouth) return 'mouth';
        if (f.confluence) return 'confluence';
        if (f.lakeShore) return 'lake';
        if (f.passFoot) return 'pass';
        if (f.coast) return 'coast';
        if (f.river || f.riverNear) return 'river';
        return 'plain';
    },

    /** The improvement for a ruin of `kind` ('town' | 'fort' | 'mine') at site `c`. */
    _ruin(world, C, kind, c) {
        const T = obj(C.text);
        const tile = world.tiles[c.r][c.q];
        const realm = tile.kingdom != null && Array.isArray(world.kingdoms) ? world.kingdoms.find(k => k.id === tile.kingdom) : null;
        const old = Kingdom.generateCityName(realm && realm.culture ? realm.culture : Utils.randPick(CULTURES));
        const oreWord = c.ore ? (obj(T.ores)[c.ore] || c.ore) : '';
        const fill = (s) => String(s || '')
            .replace(/\{old\}/g, old)
            .replace(/\{Ore\}/g, oreWord.charAt(0).toUpperCase() + oreWord.slice(1))
            .replace(/\{ore\}/g, oreWord);
        const pick = (arr, fallback) => (Array.isArray(arr) && arr.length ? fill(Utils.randPick(arr)) : fallback);
        if (kind === 'fort') {
            const F = obj(T.fort);
            return { type: 'ruins', icon: '🏰', name: pick(F.names, 'Ruined Hill Fort'), lore: pick(F.lore, ''), history: 'fort', oldName: old, pass: c.pass };
        }
        if (kind === 'mine') {
            const M = obj(T.mine);
            const imp = { type: 'cave', icon: '⛏️', name: pick(M.names, 'Abandoned Mine'), lore: pick(M.lore, ''), history: 'mine', oldName: old, ore: c.ore };
            const vein = obj(C.mines.kinds)[c.ore];
            if (vein && Utils.random() < num(C.mines.veinChance, 0)) {
                imp.vein = vein;
                tile._oldVein = vein;
                if (M.veinLore) imp.lore = `${imp.lore} ${fill(M.veinLore)}`.trim();
            }
            return imp;
        }
        const S = obj(obj(T.town)[c.site]);
        return { type: 'ruins', icon: '🏚️', name: pick(S.names, `Ruins of Old ${old}`), lore: pick(S.lore, ''), history: 'town', site: c.site, oldName: old };
    },

    // ── Old roads ──────────────────────────────────────

    /**
     * Lay the old roads (after the living roads): each history ruin to the
     * nearest other within maxLength, and to the nearest pass within toPass. Marks tile._oldRoad on hexes no living road or town has, and
     * keeps the ways on world.oldRoads ([{ a, b, path: [[q, r], ...] }]).
     */
    layOldRoads(world) {
        const C = LandHistory.cfg().oldRoads;
        const W = world.width;
        world.oldRoads = [];
        const ruins = [];
        for (const row of world.tiles) for (const t of row) if (t.improvement && t.improvement.history) ruins.push(t);
        if (!ruins.length) return world.oldRoads;
        const maxLen = num(C.maxLength, 16);
        const toPass = num(C.toPass, 8);
        const passes = LandHistory._passHexes(world);
        const seen = new Set();
        const links = [];
        const d = (a, b) => Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, W);
        for (const a of ruins) {
            let best = null;
            for (const b of ruins) {
                if (b === a) continue;
                const k = d(a, b);
                if (k <= maxLen && (!best || k < best.k)) best = { b, k };
            }
            if (best) {
                const key = [`${a.q},${a.r}`, `${best.b.q},${best.b.r}`].sort().join('|');
                if (!seen.has(key)) { seen.add(key); links.push([a, best.b]); }
            }
            if (passes.length) {
                let p = null;
                for (const x of passes) {
                    const k = d(a, x);
                    if (k >= 1 && k <= toPass && (!p || k < p.k)) p = { x, k };
                }
                if (p) links.push([a, world.tiles[p.x.r][p.x.q]]);
            }
        }
        for (const [a, b] of links) {
            const path = world.findRoadPath(a.q, a.r, b.q, b.r);
            if (!path || path.length < 2) continue;
            for (const s of path) {
                const t = world.getTile(s.q, s.r);
                if (t && t.terrain && t.terrain.passable && !t.hasRoad && !t.settlement) t._oldRoad = true;
            }
            world.oldRoads.push({ a: [a.q, a.r], b: [b.q, b.r], path: path.map(s => [s.q, s.r]) });
        }
        return world.oldRoads;
    },
};
