// ============================================
// MOUNTAIN BARRIERS — ranges are walls, passes are the gates
// ============================================
//
// A mountain hex is a hard climb (data/travel.json hexDays, floorDays) and a
// snow peak no way at all; since terrainGen 16 every long range is notched by
// one to three passes (Terrain._passes16, tile._pass: hills and highlands), so
// the cheap way across a range is by its pass. This module holds what the
// mountains cost on top of that (data/travel.json "mountains"):
//
//   winterMult  → off the road, in Winter the high ground is dearer, and in deep
//                 winter (from day deepFrom of the season, when the high road
//                 passes of world/transport.js close too) the peaks are
//                 snowbound; a pass hex only slows (Infrastructure.getPlayerHexDays)
//   marchCost   → what a hex costs a marching host, caravan or procession, in
//                 hexes of its daily speed (WorldUnit.marchToward,
//                 MerchantCaravans._travel and its route search)
//   roadCost    → the world's road builder (World.findRoadPath) since
//                 terrainGen 17: mountains dear, passes cheap
//
// Pure functions of the tile and the day: no randomness, no globals.

import { DataLoader } from '../core/dataLoader.js';
import { Seasons } from './seasons.js';

const DEFAULTS = {
    deepFrom: 8,
    winter: { mountain: { early: 1.5, deep: 2.5 }, highlands: { early: 1.25, deep: 1.5 } },
    passWinter: { early: 1, deep: 1.25 },
    passDays: 1.5,
    march: { mountain: 5, highlands: 1.25 },
    passMarch: 1,
    marchRoad: { mountain: 1.5 },
    marchRoadExtra: 0.5,
    pathTypes: ['war_host', 'relief_host', 'peasant_host', 'invader_host'],
    costTypes: ['caravan', 'lord_party', 'mercenary_band', 'pilgrim_group', 'smuggler', 'refugee', 'diplomatic_envoy'],
    caravanFactor: 1,
    roads: { mountain: 14, highlands: 5 },
    passRoad: 0.8,
};

const _num = (v, d) => (Number.isFinite(v) ? v : d);
const _pos = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);

let _cfg = null;
let _cfgSrc = null;

export const MountainBarriers = {
    /** The terrainGen from which World.findRoadPath pays roadCost. */
    ROAD_GEN: 17,

    /** data/travel.json "mountains" over the defaults (re-read when the data is reloaded). */
    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.travel ? DataLoader._gamedata.travel.mountains : null;
        if (_cfg && _cfgSrc === src) return _cfg;
        const M = src && typeof src === 'object' ? src : {};
        _cfg = { ...DEFAULTS, ...M };
        for (const k of ['winter', 'passWinter', 'march', 'marchRoad', 'roads']) {
            _cfg[k] = M[k] && typeof M[k] === 'object' ? M[k] : DEFAULTS[k];
        }
        _cfg.pathSet = new Set(Array.isArray(_cfg.pathTypes) ? _cfg.pathTypes : []);
        _cfg.costSet = new Set(Array.isArray(_cfg.costTypes) ? _cfg.costTypes : []);
        _cfgSrc = src;
        return _cfg;
    },

    /** Winter's grip on `day`: null (not winter, or no day), 'early' or 'deep'. */
    winterPhase(day) {
        if (!Number.isFinite(day)) return null;
        if (Seasons.seasonOf(day) !== 'Winter') return null;
        return Seasons.dayInSeason(day) >= _num(MountainBarriers.config().deepFrom, 8) ? 'deep' : 'early';
    },

    /**
     * Off the road, a pass hex goes at a trodden way's pace: `days` (its
     * terrain's) at most passDays. Other hexes keep their days.
     */
    passDays(tile, days) {
        if (!tile || !tile._pass) return days;
        return Math.min(days, _pos(MountainBarriers.config().passDays, days));
    },

    /** Is this hex part of a mountain pass (worlds since terrainGen 16)? */
    isPass(tile) {
        return !!(tile && tile._pass);
    },

    /**
     * Winter's factor on crossing `tile` off the road on `day`: 1 outside
     * winter and on low ground; a pass hex takes passWinter, never the peaks'.
     */
    winterMult(tile, day) {
        const phase = MountainBarriers.winterPhase(day);
        if (!phase || !tile || !tile.terrain) return 1;
        const C = MountainBarriers.config();
        const row = tile._pass ? C.passWinter : C.winter[tile.terrain.id];
        return row ? _pos(row[phase], 1) : 1;
    },

    /** Is there a usable road on this hex (a world road not ruined, or a road the player built)? */
    _onRoad(tile) {
        const inf = tile.infrastructure;
        if (inf && !inf.underConstruction && (inf.id === 'stone_road' || inf.id === 'dirt_road' || inf.id === 'bridge')) return true;
        return !!tile.hasRoad && !(tile.roadMove >= 1);
    },

    /**
     * What entering `tile` costs a marching unit on `day`, in hexes of its
     * daily speed: 1 on open ground; mountains (and in winter more) dear,
     * a pass cheap; on a road marchRoad plus its extra (a closed pass road).
     * Infinity where no one walks.
     */
    marchCost(tile, day = null) {
        if (!tile || !tile.terrain) return 1;
        if (!tile.terrain.passable) return Infinity;
        const C = MountainBarriers.config();
        const id = tile.terrain.id;
        if (MountainBarriers._onRoad(tile)) {
            let c = _pos(C.marchRoad[id], 1);
            if (tile.roadExtra > 0) c += tile.roadExtra * _num(C.marchRoadExtra, 0.5);
            return c;
        }
        let c = _pos(C.march[id], 1);
        if (tile._pass) c = Math.min(c, _pos(C.passMarch, c));
        return c * MountainBarriers.winterMult(tile, day);
    },

    /** Does this unit type plan its march by these costs (and so go by a pass)? */
    plansMarch(type) {
        return MountainBarriers.config().pathSet.has(type);
    },

    /** Does this unit type pay the mountains' cost on its way (planned or straight)? */
    paysMarch(type) {
        const C = MountainBarriers.config();
        return C.pathSet.has(type) || C.costSet.has(type);
    },

    /**
     * The road builder's step cost on `tile` for a world of `terrainGen`
     * (World.findRoadPath): before ROAD_GEN the terrain's moveCost, as those
     * worlds were made; since, the mountains' road cost and a pass's discount.
     */
    roadCost(tile, terrainGen) {
        const base = tile.terrain.moveCost || 1;
        if (!(Number(terrainGen) >= MountainBarriers.ROAD_GEN)) return base;
        const C = MountainBarriers.config();
        let c = _pos(C.roads[tile.terrain.id], base);
        if (tile._pass) c *= _pos(C.passRoad, 1);
        return c;
    },
};
