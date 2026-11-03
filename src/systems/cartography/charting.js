// Cartography — charting members. A map is made on the road: the player
// charts the tile they stand on, one action per tile, into a draft
// (player.chartDraft), and once enough tiles are charted draws a map from them.
//   chartTile(player, world)          chart the tile underfoot into the draft
//   drawOptions(player, world)        which maps the draft can be drawn into
//   drawMap(player, world, type)      ink the draft into a map; clears it
//   discardDraft(player)              throw the draft away
//   startAutoChart / autoChartNext /  a standing order to walk an area and chart
//   stopAutoChart / autoChartView     every tile in it (player.autoChart, saved);
//                                     the walking is the game loop's (ui/game/autoChart.js)
// Tuning lives in data/cartography.json "charting".
import { Cartography } from './_ref.js';
import { Utils, Hex } from './_imports.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _key = (q, r) => `${q},${r}`;

Object.assign(Cartography, {
    /** data/cartography.json "charting" (DataLoader); these are the fallbacks. */
    CHARTING: {
        minTiles: { regional: 12, survey: 20, kingdom: 15 },
        kingdomShare: 0.2,
        inkCost: { regional: 10, survey: 25, kingdom: 40 },
        valueMult: { regional: 1, survey: 1.5, kingdom: 2 },
        valuePerTiles: 20,
        skillPerTile: 0.02,
        maxDraft: 600,
        autoRadii: [2, 3, 4],
        autoStop: { health: 35, hunger: 15, energy: 10, mood: 20 },
    },

    /** The draft in progress: { startedDay, tiles: { "q,r": entry } }, or null. */
    getDraft(player) {
        const d = player && player.chartDraft;
        return d && d.tiles ? d : null;
    },

    /** How many tiles the draft holds. */
    draftCount(player) {
        const d = Cartography.getDraft(player);
        return d ? Object.keys(d.tiles).length : 0;
    },

    /** Has the tile at q,r been charted into the draft? */
    isCharted(player, q, r) {
        const d = Cartography.getDraft(player);
        return !!(d && d.tiles[_key(q, r)]);
    },

    /** Chart the tile the player stands on. */
    chartTile(player, world) {
        const tile = world.getTile(player.q, player.r);
        if (!tile) return { success: false, reason: 'There is nothing here to chart.' };
        if (!tile.terrain || !tile.terrain.passable) return { success: false, reason: 'You cannot chart from here.' };
        const C = Cartography.CHARTING;
        if (!Cartography.getDraft(player)) player.chartDraft = { startedDay: world.day, tiles: {} };
        const draft = player.chartDraft;
        const k = _key(player.q, player.r);
        if (draft.tiles[k]) return { success: false, reason: 'You have already charted this tile.' };
        if (Object.keys(draft.tiles).length >= _num(C.maxDraft, 600)) {
            return { success: false, reason: 'Your sheets are full. Draw up a map before charting more.' };
        }
        draft.tiles[k] = {
            q: player.q,
            r: player.r,
            terrain: tile.terrain.id,
            hasSettlement: !!tile.settlement,
            settlementName: tile.settlement ? tile.settlement.name : null,
            kingdom: tile.kingdom,
            hasResource: !!tile.resource,
            resource: tile.resource || null,
        };
        tile.explored = true;
        player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + _num(C.skillPerTile, 0.02));
        return { success: true, count: Object.keys(draft.tiles).length, terrain: tile.terrain.name || tile.terrain.id, settlement: tile.settlement ? tile.settlement.name : null, resource: Cartography._resourceName(tile.resource) };
    },

    /**
     * The maps the draft can be drawn into:
     * [{ type, name, icon, ready, need, have, cost, reason }].
     */
    drawOptions(player, world) {
        const C = Cartography.CHARTING;
        const d = Cartography.getDraft(player);
        const tiles = d ? Object.values(d.tiles) : [];
        const out = [];
        for (const type of ['regional', 'survey']) {
            const need = _num(C.minTiles[type], 12);
            out.push({
                type, name: Cartography.MAP_TYPES[type].name, icon: Cartography.MAP_TYPES[type].icon,
                have: tiles.length, need, ready: tiles.length >= need, cost: _num(C.inkCost[type]),
                reason: tiles.length >= need ? '' : `Chart ${need - tiles.length} more tile${need - tiles.length === 1 ? '' : 's'}.`,
            });
        }
        const kingdom = player.allegiance && world.getKingdom ? world.getKingdom(player.allegiance) : null;
        if (kingdom) {
            const have = tiles.filter(t => t.kingdom === kingdom.id).length;
            const territory = (kingdom.territory || []).length;
            const need = Math.max(_num(C.minTiles.kingdom, 15), Math.ceil(territory * _num(C.kingdomShare, 0.2)));
            out.push({
                type: 'kingdom', name: `Map of ${kingdom.name}`, icon: Cartography.MAP_TYPES.kingdom.icon,
                have, need, ready: have >= need, cost: _num(C.inkCost.kingdom),
                reason: have >= need ? '' : `Chart ${need - have} more of ${kingdom.name}'s tiles.`,
            });
        }
        return out;
    },

    /** Ink the draft into a map of `type`; the draft is used up. Gold is not taken here. */
    drawMap(player, world, type) {
        const opt = Cartography.drawOptions(player, world).find(o => o.type === type);
        if (!opt) return { success: false, reason: 'You cannot draw that map.' };
        if (!opt.ready) return { success: false, reason: opt.reason };
        const C = Cartography.CHARTING;
        let tiles = Object.values(Cartography.getDraft(player).tiles);
        if (type === 'kingdom') tiles = tiles.filter(t => t.kingdom === player.allegiance);

        const skill = player.skills.cartography || 0;
        const quality = Cartography.getQualityForSkill(skill);
        const qualityData = Cartography.QUALITY[quality];
        const center = Cartography._draftCenter(tiles, world);
        const radius = tiles.reduce((m, t) => Math.max(m, Hex.wrappingDistance(center.q, center.r, t.q, t.r, world.width)), 0);
        const kingdom = type === 'kingdom' ? world.getKingdom(player.allegiance) : null;
        const region = Cartography._getRegionName(center.q, center.r, world);
        const sizeMult = Math.max(0.5, tiles.length / _num(C.valuePerTiles, 20));
        const map = {
            id: `map_${Utils.nextId()}_${Utils.randInt(0, 9999)}`,
            type,
            name: type === 'kingdom' ? `Map of ${kingdom.name}` : type === 'survey' ? `Survey of ${region}` : `Regional Map of ${region}`,
            icon: type === 'kingdom' ? '👑' : type === 'survey' ? '📐' : qualityData.icon,
            quality,
            accuracy: Math.min(1, qualityData.accuracy + skill * (type === 'survey' ? 0.03 : 0.02)),
            centerQ: center.q,
            centerR: center.r,
            radius,
            createdDay: world.day,
            createdBy: player.name,
            value: Math.floor(qualityData.value * _num(C.valueMult[type], 1) * (1 + skill * 0.1) * sizeMult),
            tiles: tiles.map(t => ({ ...t, hasResource: type === 'survey' ? t.hasResource : false, resource: type === 'survey' ? t.resource : null })),
            charted: true,
            deliberateErrors: [],
            isPropaganda: false,
            isStolen: false,
            isAncient: false,
            notes: `Charted on foot, ${tiles.length} tiles.`,
        };
        if (type === 'survey') map.showResources = true;
        if (kingdom) map.kingdomId = kingdom.id;
        player.chartDraft = null;
        if (!player.maps) player.maps = [];
        player.maps.push(map);
        player.skills.cartography = Math.min(10, skill + Cartography.SKILL_GAIN_CREATE);
        return { success: true, map };
    },

    // ── Auto-charting: a standing order ──────────────────

    /** Uncharted land within `radius` of (cq, cr) that can be walked to, minus tiles given up on. */
    _autoTargets(player, world, cq, cr, radius, skip = []) {
        const out = [];
        const skipped = new Set(skip);
        for (const h of Hex.hexesInRange(cq, cr, radius)) {
            const q = Hex.wrapQ(h.q, world.width);
            const t = world.getTile(q, h.r);
            if (!t || !t.terrain || !t.terrain.passable) continue;
            const k = _key(q, h.r);
            if (skipped.has(k) || Cartography.isCharted(player, q, h.r)) continue;
            out.push({ q, r: h.r });
        }
        return out;
    },

    /** Give the order to chart every tile within `radius` of where the player stands. */
    startAutoChart(player, world, radius) {
        const C = Cartography.CHARTING;
        const radii = Array.isArray(C.autoRadii) ? C.autoRadii : [2, 3, 4];
        if (!radii.includes(radius)) return { success: false, reason: 'Pick an area to chart.' };
        const targets = Cartography._autoTargets(player, world, player.q, player.r, radius);
        if (!targets.length) return { success: false, reason: 'Everything around you is already charted.' };
        const room = _num(C.maxDraft, 600) - Cartography.draftCount(player);
        if (room <= 0) return { success: false, reason: 'Your sheets are full. Draw up a map before charting more.' };
        player.autoChart = { q: player.q, r: player.r, radius, startedDay: world.day, charted: 0, skip: [] };
        return { success: true, tiles: Math.min(targets.length, room) };
    },

    /** Stop the order. Returns what it charted. */
    stopAutoChart(player) {
        const o = player.autoChart;
        player.autoChart = null;
        return o ? o.charted : 0;
    },

    /** The order in hand, for the panel: { radius, charted, left } or null. */
    autoChartView(player, world) {
        const o = player && player.autoChart;
        if (!o) return null;
        return { radius: o.radius, charted: o.charted, left: Cartography._autoTargets(player, world, o.q, o.r, o.radius, o.skip).length };
    },

    /** Should the order pause? A reason, or null (hurt, starving, spent). */
    autoChartHalt(player) {
        const S = Cartography.CHARTING.autoStop || {};
        if (player.jailState || player.indenturedServitude) return 'you are not free to wander';
        if (player.boardedShip) return 'you are aboard ship';
        if (_num(player.health, 100) < _num(S.health, 35)) return 'you are badly hurt';
        const n = player.needs || {};
        if (player.needsEnabled !== false && n.hunger != null && n.hunger < _num(S.hunger, 15) && !(player.getFoodCount && player.getFoodCount() > 0)) return 'you are starving and have no food';
        if (player.needsEnabled !== false && n.energy != null && n.energy < _num(S.energy, 10)) return 'you are exhausted';
        // Weeks alone in the wilds wear a body down: a desperate mood drains health (player/core/needs.js)
        if (player.needsEnabled !== false && player.getMood && player.getMood().score < _num(S.mood, 20)) return 'you are worn down and miserable (find an inn, company and a bath)';
        return null;
    },

    /**
     * One step of the order: chart the tile underfoot if it is wanted, then
     * name the next tile to walk to (the nearest uncharted one).
     * Returns { charted, next: {q,r} | null, done, reason }.
     *   done    — the area is charted (or the sheets are full); the order is cleared
     *   next    — walk there (the caller paths, and calls again on arrival)
     */
    autoChartNext(player, world) {
        const o = player.autoChart;
        if (!o) return { done: true, charted: null, next: null };
        let charted = null;
        const inArea = Hex.wrappingDistance(o.q, o.r, player.q, player.r, world.width) <= o.radius;
        if (inArea && !Cartography.isCharted(player, player.q, player.r) && (player.actionPoints || 0) >= 1) {
            const res = Cartography.chartTile(player, world);
            if (res.success) {
                player.actionPoints -= 1;
                o.charted++;
                charted = res;
            } else if (/full/.test(res.reason)) {
                player.autoChart = null;
                return { done: true, charted, next: null, reason: res.reason };
            }
        }
        const targets = Cartography._autoTargets(player, world, o.q, o.r, o.radius, o.skip);
        if (!targets.length) {
            player.autoChart = null;
            return { done: true, charted, next: null };
        }
        let best = targets[0];
        let bestD = Infinity;
        for (const t of targets) {
            const d = Hex.wrappingDistance(player.q, player.r, t.q, t.r, world.width);
            if (d < bestD || (d === bestD && (t.r < best.r || (t.r === best.r && t.q < best.q)))) { best = t; bestD = d; }
        }
        return { done: false, charted, next: best };
    },

    /** The order can't reach a tile: leave it out. */
    autoChartSkip(player, q, r) {
        if (player.autoChart) player.autoChart.skip.push(_key(q, r));
    },

    /** A tile resource's name for messages (resources are { id, name, icon } objects). */
    _resourceName(res) {
        if (!res) return null;
        if (typeof res === 'string') return res;
        return res.name || res.id || null;
    },

    /** Throw away the draft. */
    discardDraft(player) {
        player.chartDraft = null;
    },

    /** The charted tile nearest the middle of the rest (the map's centre). */
    _draftCenter(tiles, world) {
        let best = tiles[0];
        let bestScore = Infinity;
        for (const a of tiles) {
            let score = 0;
            for (const b of tiles) score = Math.max(score, Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width));
            if (score < bestScore) { bestScore = score; best = a; }
        }
        return { q: best.q, r: best.r };
    },
});
