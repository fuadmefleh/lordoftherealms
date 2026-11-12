// ============================================
// CONSTRUCTION — building work that goes day by day
// ============================================
// Every build that is raised as a project (a road or bridge hex, a property,
// a temple, a cultural building, a holding's walls) carries the work-days it
// needs. Each day adds `pace` of them: the season, today's weather on the hex
// and any crews of hired hands (data/construction.json). Winter halves the
// work and a blizzard all but stops it; work goes on whether or not the
// builder is there to watch.
//
// A record keeps the classic fields the panels already read —
// underConstruction, constructionDaysLeft (whole work-days left) and
// constructionDaysTotal — plus workDone (work-days done, fractional) and
// crews (hired crews, 0..max). Older saves' records start from their days
// left.
//
// Crews are real labour: `hands` labourers hired in the nearest town at its
// land wage, paid each day from the builder's purse into the town's purse.
// A crew unpaid for a day walks off.
//
// No RNG (weather is a hash field); no domain globals.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { Economy } from '../world/economy.js';
import { TownLabour } from '../world/townLabour.js';

const DEFAULTS = {
    season: { Spring: 1, Summer: 1.1, Autumn: 0.9, Winter: 0.5 },
    weather: { clear: 1, cloudy: 1, rain: 0.75, storm: 0.35, snow: 0.5, blizzard: 0.1, heatwave: 0.85 },
    minPace: 0.05,
    terrainKinds: ['dirt_road', 'stone_road', 'irrigation_channel', 'river_dam'],
    terrain: { default: 1.3 },
    river: 1.5,
    crews: { hands: 6, wageMult: 1.5, speedPerCrew: 0.5, max: 3 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _r2 = (v) => Math.round(v * 100) / 100;

export const Construction = {
    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.construction) || {};
        return {
            ...DEFAULTS, ...d,
            season: { ...DEFAULTS.season, ...(d.season || {}) },
            weather: { ...DEFAULTS.weather, ...(d.weather || {}) },
            terrain: { ...DEFAULTS.terrain, ...(d.terrain || {}) },
            crews: { ...DEFAULTS.crews, ...(d.crews || {}) },
        };
    },

    // ── How long ──

    /** Hard-ground factor for a road-like work on this hex (1 on open level ground). */
    terrainFactor(tile, kindId) {
        const C = Construction.config();
        if (!tile || !(C.terrainKinds || []).includes(kindId)) return 1;
        const tid = tile.terrain && (tile.terrain.id || tile.terrain);
        let f = _num(C.terrain[tid], _num(C.terrain.default, 1));
        if ((tile.hasRiver || tile.river) && kindId !== 'river_dam') f *= _num(C.river, 1);
        return f;
    },

    /** Work-days for infrastructure on a hex: its buildTime x hard ground x the local stone and timber. */
    infraDays(infra, tile, world) {
        const base = _num(infra && infra.buildTime, 0);
        if (!(base > 0)) return 0;
        const days = base * Construction.terrainFactor(tile, infra.id);
        return world && tile ? Economy.scaleBuildDays(days, world, tile.q, tile.r) : Math.max(1, Math.round(days));
    },

    // ── How fast today ──

    /** Today's weather type on a hex, or null. */
    _weatherAt(world, q, r) {
        const w = world && world.weather;
        if (!w || typeof w.getWeather !== 'function') return null;
        try {
            const x = w.getWeather(q, r, Number.isFinite(world.day) ? world.day : undefined);
            return x && x.type ? x.type : null;
        } catch {
            return null;
        }
    },

    /**
     * Work-days done today on a build at (q, r).
     * opts.crews overrides the record's; opts.sheltered halves the weather and season slowdowns (work under a roof).
     * → { pace, season, weather, crews, notes[] }
     */
    pace(world, q, r, rec = null, opts = {}) {
        const C = Construction.config();
        const day = Seasons.today(world);
        const season = day == null ? null : Seasons.seasonOf(day);
        let sF = season ? _num(C.season[season], 1) : 1;
        const weather = Construction._weatherAt(world, q, r);
        let wF = weather ? _num(C.weather[weather], 1) : 1;
        if (opts.sheltered) { sF = 1 - (1 - sF) / 2; wF = 1 - (1 - wF) / 2; }
        const crews = Math.max(0, Math.floor(_num(opts.crews, _num(rec && rec.crews, 0))));
        const cF = 1 + _num(C.crews.speedPerCrew, 0.5) * crews;
        const pace = Math.max(_num(C.minPace, 0.05), sF * wF * cF);
        const notes = [];
        if (sF < 1) notes.push(`${season}`);
        if (wF < 1) notes.push(`${weather}`);
        if (crews > 0) notes.push(`${crews} crew${crews > 1 ? 's' : ''}`);
        return { pace: _r2(pace), season, weather, crews, notes };
    },

    // ── Progress ──

    /** Work-days a record needs in all. */
    total(rec) {
        return Math.max(0, _num(rec && rec.constructionDaysTotal, _num(rec && rec.constructionDaysLeft, 0)));
    },

    /** Work-days done (older records: from their days left). */
    done(rec) {
        if (!rec) return 0;
        if (Number.isFinite(rec.workDone)) return rec.workDone;
        return Math.max(0, Construction.total(rec) - _num(rec.constructionDaysLeft, 0));
    },

    /** Share of the work done, 0..1. */
    progress(rec) {
        const t = Construction.total(rec);
        if (!rec || !rec.underConstruction || !(t > 0)) return 1;
        return Math.max(0, Math.min(1, Construction.done(rec) / t));
    },

    /**
     * One day's work on a record at (q, r). → true when it is finished today.
     * Leaves underConstruction for the caller's own completion step.
     */
    advance(rec, world, q, r, opts = {}) {
        if (!rec || !rec.underConstruction) return false;
        const t = Construction.total(rec);
        if (!(t > 0)) return true;
        if (!Number.isFinite(rec.constructionDaysTotal)) rec.constructionDaysTotal = t;
        const p = Construction.pace(world, q, r, rec, opts);
        rec.workDone = _r2(Math.min(t, Construction.done(rec) + p.pace));
        rec.constructionDaysLeft = Math.max(0, Math.ceil(t - rec.workDone - 1e-9));
        rec.pace = p.pace;
        return rec.constructionDaysLeft <= 0;
    },

    /**
     * Days until done, walking the calendar forward with the season (today's
     * weather for today only; the crews kept on). Capped at 20 years.
     */
    eta(rec, world, q, r, opts = {}) {
        if (!rec || !rec.underConstruction) return 0;
        let left = Construction.total(rec) - Construction.done(rec);
        if (!(left > 0)) return 0;
        const C = Construction.config();
        const crews = Math.max(0, Math.floor(_num(opts.crews, _num(rec.crews, 0))));
        const cF = 1 + _num(C.crews.speedPerCrew, 0.5) * crews;
        const today = Seasons.today(world);
        let days = 0;
        // today, with its weather
        left -= Construction.pace(world, q, r, rec, opts).pace;
        days++;
        while (left > 1e-9 && days < 2400) {
            const season = today == null ? null : Seasons.seasonOf(today + days);
            let sF = season ? _num(C.season[season], 1) : 1;
            if (opts.sheltered) sF = 1 - (1 - sF) / 2;
            left -= Math.max(_num(C.minPace, 0.05), sF * cF);
            days++;
        }
        return days;
    },

    // ── Crews of hired hands ──

    /** The settlement nearest a hex (its labourers build the works), or null. */
    nearestTown(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return null;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        let best = null, bd = Infinity;
        for (const v of views || []) {
            if (!v || !Number.isFinite(v.q) || !Number.isFinite(v.r)) continue;
            const d = Hex.distance(q, r, v.q, v.r);
            if (d < bd) { bd = d; best = v; }
        }
        const t = best ? world.getTile(best.q, best.r) : null;
        return (t && t.settlement) || null;
    },

    /** A crew's pay for one day, hired in the town nearest (q, r). */
    crewWage(world, q, r) {
        const C = Construction.config();
        const s = Construction.nearestTown(world, q, r);
        const lab = s && s.labour;
        const w = lab && lab.wage && Number.isFinite(lab.wage.land) ? lab.wage.land : TownLabour.baseWage(s ? s.type : 'town', 'land');
        return Math.max(1, Math.round(_num(C.crews.hands, 6) * Math.max(0.1, _num(w, 0.4)) * _num(C.crews.wageMult, 1.5) * 10) / 10);
    },

    /** Take on one more crew for a build. → { success, crews, wage, reason } */
    hireCrew(player, rec, world, q, r) {
        const C = Construction.config();
        if (!rec || !rec.underConstruction) return { success: false, reason: 'Nothing is being built there.' };
        const crews = Math.max(0, Math.floor(_num(rec.crews, 0)));
        if (crews >= _num(C.crews.max, 3)) return { success: false, reason: `At most ${_num(C.crews.max, 3)} crews can work one site.` };
        const wage = Construction.crewWage(world, q, r);
        if (_num(player && player.gold) < wage) return { success: false, reason: `A crew wants ${wage}g a day.` };
        rec.crews = crews + 1;
        return { success: true, crews: rec.crews, wage };
    },

    /** Let one crew go. */
    dismissCrew(rec) {
        if (!rec || !(_num(rec.crews) > 0)) return { success: false, reason: 'No crews are hired there.' };
        rec.crews = Math.max(0, Math.floor(_num(rec.crews)) - 1);
        return { success: true, crews: rec.crews };
    },

    /**
     * Pay a build's crews for the day, purse to the nearest town's purse.
     * Crews the purse cannot cover walk off. → { paid, left }
     */
    payCrews(player, rec, world, q, r) {
        const crews = Math.max(0, Math.floor(_num(rec && rec.crews, 0)));
        if (!crews || !player) return { paid: 0, left: 0 };
        const wage = Construction.crewWage(world, q, r);
        const afford = Math.min(crews, Math.floor(_num(player.gold) / wage));
        const paid = _r2(afford * wage);
        if (paid > 0) {
            player.gold = _r2(_num(player.gold) - paid);
            const town = Construction.nearestTown(world, q, r);
            if (town) Economy.payTown(town, paid);
        }
        rec.crews = afford;
        return { paid, left: crews - afford };
    },
};
