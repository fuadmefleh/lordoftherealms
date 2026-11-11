// ============================================
// WORLD AGE — how long the realms have stood when the game begins
// ============================================
//
// A start year between the dawn year (data/dawn.json `dawnYear`, before which
// the world begins at the Dawn of Man — world/dawn.js) and the mature year
// (`age.matureYear`, the default start year) begins in a younger world:
// t = (year - dawnYear) / (matureYear - dawnYear), from 0 at the dawn to 1
// at maturity. The full-grown world is generated as always, then aged back
// (WorldAge.apply, called by World._generateWorld before roads, history,
// religion, culture, peoples, colonization, cartography and the first units,
// so all of those derive from what is left):
//   - fewer places: only the oldest share of the realms' towns, the free
//     villages and the human-made ruins, shrines and monuments still stand
//     (capitals always do; caves and oases are nature's and stay)
//   - smaller places: every population scaled down; a town too small for
//     the name becomes a village (capitals stay capitals)
//   - smaller realms: a realm's lands shrink about its capital, keeping a
//     hex about each of its towns — more unclaimed wilderness
//   - founding years told faster: dawnYear + (Y - dawnYear) x t, so every
//     place was founded before the start year, oldest still first
// The world's roads (shorter reach), history (from the dawn year only),
// holy sites and the towns' rural sites (world/hinterland.js) read the same
// age. Years from matureYear on are the full-grown world, unchanged.
//
// Only worlds made since terrainGen 6 (ui/game/gameSetup.js) age: an older
// save regenerates exactly as it was made. A young world keeps a snapshot of
// the age settings in generationParams.worldAge, so a save regenerates the
// same world even if data/dawn.json is retuned. No RNG is drawn: what stands
// is chosen by founding year (then a hash of the seed and the hex).

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';

const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const DEFAULT_YEAR = 853;
const HUMAN_MADE = new Set(['ruins', 'shrine', 'monument']);

const DEFAULTS = {
    matureYear: DEFAULT_YEAR,
    realmTowns: { at0: 0.15, pow: 1 },
    independents: { at0: 0.1, pow: 1 },
    ruins: { at0: 0.1, pow: 1 },
    population: { at0: 0.25, pow: 0.8 },
    claim: { at0: 0.4, pow: 1 },
    hinterland: { at0: 0.4, pow: 1 },
    holySites: { at0: 0.3, pow: 1 },
    roadsAt0: 6,
    roadsAt1: 40,
    townMinPop: 500,
    villageMinPop: 30,
    bands: [
        { upTo: 0.25, label: 'a young world', hint: 'few towns, small realms, little built' },
        { upTo: 0.55, label: 'a growing world', hint: 'scattered towns, modest realms and the first roads between them' },
        { upTo: 0.9, label: 'a settled world', hint: 'most towns founded, the realms near their full reach' },
        { upTo: 1, label: 'a mature world', hint: 'the realms long founded' },
    ],
};

export const WorldAge = {
    DEFAULTS,

    /** data/dawn.json (the live gamedata, or `dawnData` as given). */
    _dawnData(dawnData) {
        if (_obj(dawnData)) return dawnData;
        const g = DataLoader._gamedata;
        return (g && _obj(g.dawn)) || {};
    },

    /** The age settings: data/dawn.json `age` over the defaults (`src` overrides, e.g. a save's snapshot). */
    config(src = null, dawnData = null) {
        const d = _obj(src) || _obj(WorldAge._dawnData(dawnData).age) || {};
        const out = { ...DEFAULTS };
        for (const [k, v] of Object.entries(d)) {
            if (k.startsWith('_')) continue;
            out[k] = _obj(v) && _obj(DEFAULTS[k]) ? { ...DEFAULTS[k], ...v } : v;
        }
        if (!Array.isArray(out.bands) || !out.bands.length) out.bands = DEFAULTS.bands;
        return out;
    },

    /** The world's age 0..1 for a start year (1 from the mature year on; 0 at or before the dawn year). */
    factorOf(year, dawnYear, matureYear) {
        const span = matureYear - dawnYear;
        if (!(span > 0) || year >= matureYear) return 1;
        return Math.max(0, Math.min(1, (year - dawnYear) / span));
    },

    /** at0 + (1 - at0) x t^pow (1 when t is 1). */
    curve(spec, t) {
        if (t >= 1) return 1;
        const at0 = Math.max(0, Math.min(1, _num(spec && spec.at0, 1)));
        const pow = Math.max(0.01, _num(spec && spec.pow, 1));
        return at0 + (1 - at0) * Math.pow(Math.max(0, t), pow);
    },

    /**
     * The age of a world with these generation params:
     * { t, year, dawnYear, matureYear, cfg, snapshot }. t is 1 (full-grown,
     * nothing aged) for a world made before terrainGen 6 without a snapshot,
     * a custom (editor) world, and any year from the mature year on.
     */
    forParams(params) {
        const p = _obj(params) || {};
        const snap = _obj(p.worldAge);
        const cfg = WorldAge.config(snap);
        const dawnYear = _num(snap && snap.dawnYear, _num(WorldAge._dawnData().dawnYear, 200));
        const matureYear = _num(cfg.matureYear, DEFAULT_YEAR);
        const y = Math.floor(Number(p.startYear));
        const year = Number.isFinite(y) && y >= 1 ? y : DEFAULT_YEAR;
        const ages = !!snap || (Number(p.terrainGen) || 1) >= 6;
        const t = !ages || p.customWorld || year < dawnYear ? 1 : WorldAge.factorOf(year, dawnYear, matureYear);
        const snapshot = { dawnYear };
        for (const [k, v] of Object.entries(cfg)) if (k !== 'bands') snapshot[k] = v;
        return { t, year, dawnYear, matureYear, cfg, snapshot };
    },

    /** The age of a generated world (its generationParams). */
    of(world) {
        return WorldAge.forParams(world && world.generationParams);
    },

    /** A curve (`name` in the age settings) at this world's age; 1 for a full-grown world. */
    scale(world, name) {
        const a = WorldAge.of(world);
        return a.t >= 1 ? 1 : WorldAge.curve(a.cfg[name], a.t);
    },

    /**
     * A curve at the world's age NOW: a young world grows up as its years
     * pass (world.year), reaching 1 at the mature year. 1 for a world that
     * began full-grown.
     */
    scaleNow(world, name) {
        const a = WorldAge.of(world);
        if (a.t >= 1) return 1;
        const year = _num(world && world.year, a.year);
        return WorldAge.curve(a.cfg[name], WorldAge.factorOf(year, a.dawnYear, a.matureYear));
    },

    /** The longest road (hexes) a world of age t lays between two towns at generation (Infinity when mature). */
    roadReach(age) {
        if (!age || age.t >= 1) return Infinity;
        const a0 = _num(age.cfg.roadsAt0, 6);
        const a1 = _num(age.cfg.roadsAt1, 40);
        return a0 + (a1 - a0) * age.t;
    },

    /**
     * What a start year means, for the New Game screen: { dawn, t, label,
     * hint }. `dawnData` is data/dawn.json (the screen imports it; the
     * gamedata may not be loaded yet).
     */
    band(year, dawnData = null) {
        const dd = WorldAge._dawnData(dawnData);
        const cfg = WorldAge.config(null, dd);
        const dawnYear = _num(dd.dawnYear, 200);
        const y = Math.floor(Number(year)) || DEFAULT_YEAR;
        if (y < dawnYear) return { dawn: true, t: 0, label: 'the Dawn of Man', hint: '' };
        const t = WorldAge.factorOf(y, dawnYear, _num(cfg.matureYear, DEFAULT_YEAR));
        const b = cfg.bands.find(x => t <= _num(x.upTo, 1)) || cfg.bands[cfg.bands.length - 1];
        return { dawn: false, t, label: String(b.label || ''), hint: String(b.hint || '') };
    },

    /** A founding year of the full-grown world told at age t (dawn-year and older stay). */
    redate(founded, age) {
        if (typeof founded !== 'number' || !Number.isFinite(founded) || age.t >= 1) return founded;
        if (founded <= age.dawnYear) return founded;
        const y = Math.floor(age.dawnYear + (founded - age.dawnYear) * age.t);
        return Math.max(age.dawnYear, Math.min(age.year - 1, y));
    },

    // ── Ageing a generated world ─────────────────────────────

    /**
     * Age a freshly generated full-grown world back to age.t (see the head of
     * this file). Runs after the realms, free villages and points of interest
     * are placed and before the roads. Returns what it did.
     */
    apply(world, age) {
        const report = { realmTowns: 0, independents: 0, ruins: 0, demoted: 0, unclaimed: 0 };
        if (!world || !age || age.t >= 1) return report;
        const cfg = age.cfg;
        const t = age.t;
        const W = world.width;
        const seed = String((world.generationParams && world.generationParams.seed) || 'world');
        const tie = (q, r) => Utils.hashStr(`age:${seed}:${q},${r}`) >>> 0;
        const dist = (a, b) => Hex.wrappingDistance(a.q, a.r, b.q, b.r, W);

        // What stands now, by kind
        const realmTowns = [], independents = [], ruins = [];
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < W; q++) {
                const tile = world.tiles[r][q];
                const s = tile.settlement;
                if (s && s.type !== 'capital') (s.kingdom != null ? realmTowns : independents).push({ q, r, tile, f: _num(s.founded, 0) });
                const imp = tile.improvement;
                if (imp && HUMAN_MADE.has(imp.type)) ruins.push({ q, r, tile, f: _num(imp.founded, 0) });
            }
        }
        // The oldest share stands (founding year, then the hash)
        const fallen = (list, spec) => {
            list.sort((a, b) => (a.f - b.f) || (tie(a.q, a.r) - tie(b.q, b.r)));
            const keep = Math.round(list.length * WorldAge.curve(spec, t));
            return list.slice(keep);
        };
        for (const x of fallen(realmTowns, cfg.realmTowns)) { x.tile.settlement = null; report.realmTowns++; }
        for (const x of fallen(independents, cfg.independents)) { x.tile.settlement = null; report.independents++; }
        for (const x of fallen(ruins, cfg.ruins)) { x.tile.improvement = null; report.ruins++; }

        // Smaller places, founded earlier
        const popScale = WorldAge.curve(cfg.population, t);
        const townMin = _num(cfg.townMinPop, 500);
        const villageMin = _num(cfg.villageMinPop, 30);
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < W; q++) {
                const tile = world.tiles[r][q];
                const s = tile.settlement;
                if (s) {
                    s.population = Math.max(villageMin, Math.round(_num(s.population, 0) * popScale));
                    if (s.type === 'town' && s.population < townMin) {
                        s.type = 'village';
                        s.level = 0;
                        report.demoted++;
                    }
                    s.founded = WorldAge.redate(s.founded, age);
                }
                if (tile.improvement) tile.improvement.founded = WorldAge.redate(tile.improvement.founded, age);
            }
        }

        // Smaller realms: their lands about the capital, and a hex about each town
        const claimScale = WorldAge.curve(cfg.claim, t);
        for (const k of world.kingdoms || []) {
            if (!k.capital || !Array.isArray(k.territory)) continue;
            const reach = k.territory.reduce((m, h) => Math.max(m, dist(h, k.capital)), 0);
            const keepR = Math.max(1, Math.round(reach * claimScale));
            const towns = [];
            for (const h of k.territory) {
                const s = world.tiles[h.r][h.q].settlement;
                if (s && s.type !== 'capital') towns.push(h);
            }
            const kept = [];
            for (const h of k.territory) {
                const tile = world.tiles[h.r][h.q];
                if (tile.settlement || dist(h, k.capital) <= keepR || towns.some(tw => dist(tw, h) <= 1)) kept.push(h);
                else if (tile.kingdom === k.id) { tile.kingdom = null; report.unclaimed++; }
            }
            k.territory = kept;
            // Its people and standing army, from what is left (no dice)
            let pop = 0;
            for (const h of kept) {
                const tile = world.tiles[h.r][h.q];
                if (tile.settlement && tile.kingdom === k.id) pop += _num(tile.settlement.population, 0);
            }
            const was = _num(k.population, 0);
            k.military = was > 0 ? Math.floor(_num(k.military, 0) * pop / was) : _num(k.military, 0);
            k.population = pop;
        }
        return report;
    },
};
