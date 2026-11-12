// InnerMapRenderer — ambient life on the inner map (mixed in via Object.assign).
//
//   • Fires burn: the campfire plays the four flame frames its sheet already
//     holds, spits embers, and its smoke drifts off on the wind; a warm halo
//     round it, and a light in the night's light map. A cold campfire sends up
//     a thread of smoke. Lamp posts glow after dark.
//   • Chimneys smoke: houses by the hour and the season (morning and evening,
//     more in winter and on cold days, one house lighting after another), the
//     smithy all working day with sparks, the bakery from before dawn, the
//     taverns and inns most of the day. The bathhouse steams.
//   • Indoors: hearths, forges and ovens glow and spit embers or sparks, a
//     cauldron and a bath steam, candles waver.
//   • On cold days everyone out of doors breathes a little cloud.
//   • Moving parts — a waterwheel by a mill on the river, windmill sails, a
//     pennant, a well's bucket — drawn from art in data/ambient.json `artDir`
//     once it exists (nothing in code stands in for the art).
//
// The particles are effects (soft puffs and glints), not objects: they keep no
// state (ui/ambientModel.js works each one out from the clock), so a frame
// allocates nothing once warm. The clock is the renderer's own `_ambientT`,
// advanced by the game loop only while time runs — pause the game and the
// smoke hangs still. Settings: data/ambient.json.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { CustomObjects } from '../../world/customObjects.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { CustomSheets } from '../../core/customSheets.js';
import { LightSystem } from '../lightSystem.js';
import {
    ambientConfig, hash01, scheduleIntensity, emitterLevel, windFor, weatherMods,
    slotCount, particleAt, flicker, frameAt, buildingEmitters, buildingBox,
} from '../ambientModel.js';

const SPRITE = 64;          // puff / glow sprite size in px
const VARIANTS = 3;         // puff shapes per kind

// One particle's position, reused for every particle
const _p = { alive: false, x: 0, y: 0, size: 0, alpha: 0, u: 0, h: 0 };

const _isWater = t => !!(t && (t._wet || t._sea) && !t._deck && !t._pier && !t.isRoad
    && !(t.subTerrain && /frozen|ice/.test(t.subTerrain.id || '')));

/** A stable number for a person's id (a number, or a string hashed). */
function _idSeed(id) {
    if (typeof id === 'number') return id;
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h & 0x7fffffff;
}

function _canvas(w, h) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

/** A soft, slightly lumpy puff in a colour: a few overlapping radial blobs. */
function _puffSprite(color, variant) {
    const c = _canvas(SPRITE, SPRITE);
    if (!c) return null;
    const g = c.getContext('2d');
    const [r, gr, b] = color;
    const blobs = 5;
    for (let i = 0; i < blobs; i++) {
        const a = hash01(variant, i, 1) * Math.PI * 2;
        const d = i === 0 ? 0 : SPRITE * 0.12 * (0.5 + hash01(variant, i, 2));
        const cx = SPRITE / 2 + Math.cos(a) * d, cy = SPRITE / 2 + Math.sin(a) * d;
        const rad = SPRITE * (i === 0 ? 0.42 : 0.24 + hash01(variant, i, 3) * 0.12);
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grd.addColorStop(0, `rgba(${r},${gr},${b},${i === 0 ? 0.7 : 0.5})`);
        grd.addColorStop(0.55, `rgba(${r},${gr},${b},0.24)`);
        grd.addColorStop(1, `rgba(${r},${gr},${b},0)`);
        g.fillStyle = grd;
        g.fillRect(0, 0, SPRITE, SPRITE);
    }
    return c;
}

/** A round glow with a hot core (for embers, sparks and halos). */
function _glowSprite(color) {
    const c = _canvas(SPRITE, SPRITE);
    if (!c) return null;
    const g = c.getContext('2d');
    const [r, gr, b] = color;
    const h = SPRITE / 2;
    const grd = g.createRadialGradient(h, h, 0, h, h, h);
    grd.addColorStop(0, `rgba(255,${Math.min(255, gr + 80)},${Math.min(255, b + 90)},1)`);
    grd.addColorStop(0.18, `rgba(${r},${gr},${b},0.85)`);
    grd.addColorStop(0.5, `rgba(${r},${gr},${b},0.25)`);
    grd.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, SPRITE, SPRITE);
    return c;
}

Object.assign(InnerMapRenderer, {
    /** The ambient clock (s): runs with the game, stops when it is paused. */
    _ambientT: 0,
    _ambCfgSrc: undefined,
    _ambCfg: null,
    _ambBldgCache: null,     // building def id → emitters (tiles from anchor)
    _ambPartPlace: null,     // WeakMap tiles → Map 'q,r|part' → placement or false
    _ambArtImgs: null,       // art id → { img, ready }
    _ambGlowSprites: null,   // 'r,g,b' → canvas
    _ambEm: null,            // this frame's emitters (pooled records)
    _ambEmN: 0,
    _ambGl: null,            // this frame's glows (pooled records)
    _ambGlN: 0,
    _ambParts: null,         // this frame's moving parts (pooled records)
    _ambPartsN: 0,
    _ambCtx: null,          // this frame's { hour, season, celsius, weather }
    _ambWind: null,
    _ambLifeK: 1,
    _ambAlphaK: 1,

    /** Advance the ambient clock (ui/game/gameLoop.js): not while paused. */
    tickAmbient(dt, speed) {
        if (!(speed > 0) || !(dt > 0)) return;
        this._ambientT += Math.min(dt, 0.1);
        // (kept small so the float stays precise over a long session)
        if (this._ambientT > 86400) this._ambientT -= 86400;
    },

    _ambientConfig() {
        const src = DataLoader._gamedata && DataLoader._gamedata.ambient;
        if (this._ambCfg && src === this._ambCfgSrc) return this._ambCfg;
        const cfg = ambientConfig(src);
        // Each kind's puff sprites (or its glint), made once
        for (const kind of Object.values(cfg.kinds)) {
            kind._sprites = [];
            if (kind.glow) kind._sprites.push(_glowSprite(kind.color));
            else for (let v = 0; v < VARIANTS; v++) kind._sprites.push(_puffSprite(kind.color, v + 1));
            if (!kind._sprites[0]) kind._sprites.length = 0;
        }
        this._ambCfgSrc = src;
        this._ambCfg = cfg;
        this._ambBldgCache = new Map();
        this._ambPartPlace = new WeakMap();
        this._ambArtImgs = new Map();
        this._ambGlowSprites = new Map();
        if (!this._ambEm) { this._ambEm = []; this._ambGl = []; }
        return cfg;
    },

    _ambGlowSprite(color) {
        const key = color[0] * 65536 + color[1] * 256 + color[2];
        let s = this._ambGlowSprites.get(key);
        if (s === undefined) { s = _glowSprite(color); this._ambGlowSprites.set(key, s); }
        return s;
    },

    /** An art piece's image from artDir (null until loaded, or if it isn't there). */
    _ambArt(cfg, id) {
        const man = cfg.art && cfg.art[id];
        if (!man) return null;
        let rec = this._ambArtImgs.get(id);
        if (!rec) {
            rec = { img: null, ready: false, man };
            this._ambArtImgs.set(id, rec);
            if (typeof Image !== 'undefined') {
                const img = new Image();
                img.onload = () => { rec.img = img; rec.ready = true; };
                img.onerror = () => { console.warn(`[ambient] art not found: ${id}`); };
                img.src = CustomSheets.resolve(`${cfg.artDir || 'assets/lpc/new/anim'}/${man.file || id + '.png'}`);
            }
        }
        return rec.ready ? rec : null;
    },

    /** An object def's frame animation (data `objects[id].frames`), or null. */
    _ambientAnim(defId) {
        const cfg = this._ambCfg || this._ambientConfig();
        if (!cfg.enabled) return null;
        const o = cfg.objects[defId];
        return o && o.frames && o.frames.count > 1 ? o.frames : null;
    },

    /** Which frame an animated object shows now (see _ambientAnim). */
    _ambientFrameOf(frames, q, r) {
        return frameAt(frames, this._ambientT, q * 4099 + r);
    },

    // ── This frame's emitters ────────────────────────────────

    _ambPush(x, y, kind, rate, level, seed, spread) {
        let e = this._ambEm[this._ambEmN];
        if (!e) { e = { x: 0, y: 0, kind: null, rate: 0, level: 0, seed: 0, n: 0, spread: null }; this._ambEm.push(e); }
        this._ambEmN++;
        e.x = x; e.y = y; e.kind = kind; e.rate = rate; e.level = level; e.seed = seed;
        e.n = slotCount(kind, rate, this._ambCfg.maxSlots);
        e.spread = spread == null ? null : spread;
    },

    _ambPushGlow(x, y, g, strength, seed) {
        let o = this._ambGl[this._ambGlN];
        if (!o) { o = { x: 0, y: 0, radius: 0, sprite: null, alpha: 0, seed: 0, flick: 1 }; this._ambGl.push(o); }
        this._ambGlN++;
        o.x = x; o.y = y; o.radius = g.radius || 0.8; o.alpha = strength;
        o.sprite = this._ambGlowSprite(g.color || [255, 150, 60]);
        o.seed = seed; o.flick = g.flicker != null ? g.flicker : 1;
    },

    /** The day's conditions, read once a frame. */
    _ambConditions(cfg) {
        const ctx = this._ambCtx || (this._ambCtx = { hour: 12, season: '', celsius: 10, weather: '' });
        const acc = Number.isFinite(InnerMap._timeAccumulator) && InnerMap.TIME_SCALE ? InnerMap._timeAccumulator / InnerMap.TIME_SCALE : 0;
        ctx.hour = (Number.isFinite(InnerMap.timeOfDay) ? InnerMap.timeOfDay : 12) + acc;
        ctx.season = InnerMap.season || '';
        ctx.celsius = InnerMap.temperature && Number.isFinite(InnerMap.temperature.celsius) ? InnerMap.temperature.celsius : 10;
        ctx.weather = InnerMap.weather && InnerMap.weather.type ? String(InnerMap.weather.type).toLowerCase() : '';
        const wt = InnerMap.currentWorldTile || { q: 0, r: 0 };
        const key = `${wt.q},${wt.r},${InnerMap.worldDay || 0},${ctx.weather}`;
        if (!this._ambWind || this._ambWind._key !== key) {
            this._ambWind = windFor(wt.q, wt.r, InnerMap.worldDay || 0, ctx.weather, cfg.wind);
            this._ambWind._key = key;
        }
        const wm = weatherMods(cfg, ctx.weather);
        this._ambLifeK = InnerMap._insideBuilding ? 1 : wm.life;
        this._ambAlphaK = InnerMap._insideBuilding ? 1 : wm.alpha;
        return ctx;
    },

    /** Emitters, glows and lights of an object or piece of furniture (spec from data). */
    _ambFromSpec(cfg, spec, tx, ty, seed, conds, ds, camera, T) {
        let level = 1;
        if (spec.lit) {
            level = scheduleIntensity(cfg.schedules[spec.lit], conds);
            if (level < 0.02) return;
        }
        if (spec.emit) {
            for (let i = 0; i < spec.emit.length; i++) {
                const e = spec.emit[i];
                const kind = cfg.kinds[e.kind];
                if (!kind || !kind._sprites || !kind._sprites.length) continue;
                const at = e.at || [0.5, 0.5];
                this._ambPush((tx + at[0]) * T, (ty + at[1]) * T, kind, e.rate || 1, level, seed * 7 + i, e.spread);
            }
        }
        const dark = Math.min(1, (LightSystem.ambientDarkness || 0) / 0.85);
        if (spec.glow) {
            const g = spec.glow;
            const s = ((g.day || 0) + ((g.night != null ? g.night : 0.7) - (g.day || 0)) * dark) * level;
            if (s > 0.01) {
                const at = g.at || [0.5, 0.5];
                this._ambPushGlow((tx + at[0]) * T, (ty + at[1]) * T, g, s, seed);
            }
        }
        if (spec.light && dark > 0.01 && LightSystem.enabled) {
            const L = spec.light;
            const at = L.at || [0.5, 0.5];
            const sc = camera.worldToScreenFast((tx + at[0]) * T, (ty + at[1]) * T);
            const c = L.color || [255, 160, 60];
            const f = flicker(this._ambientT, seed);
            LightSystem.addLight(sc.x, sc.y, (L.radius || 2.5) * ds * (0.96 + (f - 1) * 0.6),
                { r: c[0], g: c[1], b: c[2] }, (L.intensity || 0.8) * level * f, 'point');   // (flickered here on the ambient clock, so it holds still when paused)
        }
    },

    /** A building def's emitters, cached (tiles from its anchor). */
    _ambBuildingEmitters(cfg, def, type) {
        const key = type ? `${def.id}|${type}` : def.id;
        let list = this._ambBldgCache.get(key);
        if (!list) {
            list = buildingEmitters(def, cfg, type);
            for (const e of list) e._kind = cfg.kinds[e.kind] || null;
            this._ambBldgCache.set(key, list);
        }
        return list;
    },

    /** Gather the emitters, glows and lights on screen (once a frame, before the passes). */
    _ambCollect(camera) {
        const cfg = this._ambientConfig();
        this._ambEmN = 0;
        this._ambGlN = 0;
        this._ambPartsN = 0;
        if (!cfg.enabled || !InnerMap.tiles || InnerMap._underwater) return cfg;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const conds = this._ambConditions(cfg);
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const tiles = InnerMap.tiles;
        const W = tiles.length ? tiles[0].length : 0;
        const inside = !!InnerMap._insideBuilding;

        // Only what the depth-sorted pass draws (innerMapLayers/entities.js): a
        // building or object on a visible tile in the view's rows — so no smoke
        // ever rises from a roof that isn't there. A plume reaches sideways on
        // the wind, so the columns run a little wider.
        const q0 = Math.max(0, qMin - (inside ? 0 : 4)), q1 = Math.min(W - 1, qMax + (inside ? 0 : 4));
        const scheds = cfg.schedules;
        for (let r = rMin; r <= rMax; r++) {
            const row = tiles[r];
            for (let q = q0; q <= q1; q++) {
                const tile = row[q];
                if (!tile || !tile.visible || !tile.explored) continue;
                const seed = q * 4099 + r;
                if (inside) {
                    const f = tile._furniture;
                    const spec = f && cfg.furniture[f.type];
                    if (spec) this._ambFromSpec(cfg, spec, q, r, seed, conds, ds, camera, T);
                    continue;
                }
                if (tile.customObject) {
                    const spec = cfg.objects[tile.customObject.defId];
                    if (spec) this._ambFromSpec(cfg, spec, q, r, seed, conds, ds, camera, T);
                    if (cfg.parts.length) this._ambPartsFor(cfg, 'object', tile.customObject.defId, null, q, r);
                } else if (tile.customBuilding && CustomBuildings.isLoaded()) {
                    // (a burnt-out or sacked shell has no hearth smoke, no lamp in its windows: world/townMarks.js)
                    if (tile.customBuilding.ruin === 'burnt' || tile.customBuilding.ruin === 'sacked') continue;
                    // (nor does a building still going up on its lot: no fire lit in a hearth not yet built)
                    if (tile._propertyRef && tile._propertyRef.underConstruction) continue;
                    const def = CustomBuildings.getBuilding(tile.customBuilding.defId);
                    if (!def) continue;
                    const list = this._ambBuildingEmitters(cfg, def, null);
                    for (let i = 0; i < list.length; i++) {
                        const e = list[i];
                        if (!e._kind || !e._kind._sprites || !e._kind._sprites.length) continue;
                        const lvl = emitterLevel(scheduleIntensity(scheds[e.schedule], conds), e.share, seed + i * 31);
                        if (lvl < 0.02) continue;
                        this._ambPush((q + e.x) * T, (r + e.y) * T, e._kind, e.rate, lvl, seed * 13 + i, e.spread);
                    }
                    if (cfg.parts.length) this._ambPartsFor(cfg, 'building', def.buildingType, def, q, r);
                }
            }
        }
        if (!inside) this._ambBreath(cfg, conds, camera, T);
        return cfg;
    },

    /** A puff of breath from each person out of doors on a cold day. */
    _ambBreath(cfg, conds, camera, T) {
        const B = cfg.breath;
        if (!B || !(conds.celsius < B.belowC)) return;
        const kind = cfg.kinds[B.kind || 'breath'];
        if (!kind || !kind._sprites || !kind._sprites.length) return;
        const rate = 1 / (B.every || 3);
        const head = (B.head != null ? B.head : 0.5) * T;
        const side = (B.side || 0) * T;
        // Before the face, the way they look (InnerMapCharacters: 0 up, 1 left, 2 down, 3 right)
        const fx = d => (d === 1 ? -side : d === 3 ? side : 0);
        const fy = d => (d === 2 ? side * 0.5 : 0);
        const pos = InnerMap.getPlayerWorldPos ? InnerMap.getPlayerWorldPos() : null;
        const pf = this._playerFacing;
        if (pos) this._ambPush(pos.x + fx(pf), pos.y - head + fy(pf), kind, rate, 1, 977, null);
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        for (const npc of InnerMap.npcs || []) {
            if (npc.state === 'inside_building' || npc.state === 'gone') continue;
            if (npc.q < qMin || npc.q > qMax || npc.r < rMin || npc.r > rMax) continue;
            let x = npc.q * T + T / 2, y = npc.r * T + T / 2;
            if (npc.state === 'walking' && npc.path && npc.pathIndex < npc.path.length) {
                const tg = npc.path[npc.pathIndex];
                const p = npc.moveProgress || 0;
                x += (tg.q - npc.q) * T * p;
                y += (tg.r - npc.r) * T * p;
            }
            this._ambPush(x + fx(npc.facing), y - head + fy(npc.facing), kind, rate, 1, 1000 + _idSeed(npc.id), null);
        }
    },

    // ── Moving parts (art-gated) ─────────────────────────────

    /** Note the parts that stand on this object or building (drawn in the depth sort). */
    _ambPartsFor(cfg, what, id, def, q, r) {
        for (let i = 0; i < cfg.parts.length; i++) {
            const part = cfg.parts[i];
            const on = part.on || {};
            if (what === 'object' ? !(on.objects && on.objects.includes(id)) : !(on.buildingTypes && on.buildingTypes.includes(id))) continue;
            const art = this._ambArt(cfg, part.art || part.id);
            if (!art) continue;
            const place = this._ambPlace(part, def, q, r);
            if (!place) continue;
            if (!this._ambParts) this._ambParts = [];
            let rec = this._ambParts[this._ambPartsN];
            if (!rec) { rec = {}; this._ambParts.push(rec); }
            this._ambPartsN++;
            rec.part = part; rec.art = art; rec.x = place.x; rec.y = place.y; rec.flip = place.flip;
            rec.sortY = (r + 1) * this.TILE_SIZE + 0.25; rec.q = q; rec.r = r; rec.waterY = place.waterY;
            rec.turn = place.turn || 1;
        }
    },

    /** Where a part stands (tiles), worked out once per map: { x, y, flip, waterY } or null. */
    _ambPlace(part, def, q, r) {
        const tiles = InnerMap.tiles;
        let m = this._ambPartPlace.get(tiles);
        if (!m) { m = new Map(); this._ambPartPlace.set(tiles, m); }
        const key = `${q},${r}|${part.id}`;
        let p = m.get(key);
        if (p !== undefined) return p;
        p = null;
        const at = part.at || [0, 0];
        if (part.place === 'object') {
            p = { x: q + at[0], y: r + at[1], flip: false, waterY: null };
        } else if (def) {
            const box = buildingBox(def);
            // A mill the map stood on the bank knows its wheel's wall (world/innerMap/mills.js)
            const cb = InnerMap.tiles[r] && InnerMap.tiles[r][q] && InnerMap.tiles[r][q].customBuilding;
            const wheel = cb && cb.wheel && box ? cb.wheel : null;
            const water = wheel ? { side: wheel.side } : box ? this._ambWaterSide(box, q, r) : null;
            if (part.place === 'waterSide') {
                if (wheel) {
                    // Beside the gable wall's foot, `at` [out from the wall, down from the foot row's top]
                    const wall = wheel.side > 0 ? q + box.maxQ + 1 : q + box.minQ;
                    const y = r + box.maxR + at[1];
                    // The bottom of an undershot wheel goes with the stream (still water: it turns as it was built to)
                    p = { x: wall + at[0] * wheel.side, y, flip: false, waterY: y + (part.waterline || 0), turn: wheel.flow ? -wheel.flow : 1 };
                } else if (water) p = { x: water.x + at[0] * (water.flip ? -1 : 1), y: water.y + at[1], flip: water.flip, waterY: water.y };
            } else if (part.place === 'roof' && box && !(part.unlessWater && water)) {
                p = { x: q + (box.minQ + box.maxQ + 1) / 2 + at[0], y: r + box.roofR + at[1], flip: false, waterY: null };
            }
        }
        m.set(key, p);
        return p;
    },

    /**
     * A side of the building with water against it: the gable ends first (the
     * wheel turning beside the wall, its foot in the water), then the front.
     * Returns the wheel's centre in tiles, or null.
     */
    _ambWaterSide(box, q, r) {
        const at = (tq, tr) => { const row = InnerMap.tiles[tr]; return row ? row[tq] : null; };
        const rows = [box.maxR, box.maxR - 1];
        for (const side of [1, -1]) {
            const col = side > 0 ? q + box.maxQ + 1 : q + box.minQ - 1;
            let wet = 0;
            for (const dr of rows) if (_isWater(at(col, r + dr)) || _isWater(at(col + side, r + dr))) wet++;
            if (wet === rows.length) return { x: side > 0 ? col + 0.35 : col + 0.65, y: r + box.maxR + 0.2, flip: side < 0 };
        }
        const frontR = r + box.maxR + 1;
        for (let dq = box.minQ; dq <= box.maxQ; dq++) {
            if (_isWater(at(q + dq, frontR)) && _isWater(at(q + dq + 1, frontR))) return { x: q + dq + 1, y: frontR + 0.1, flip: false };
        }
        return null;
    },

    /** Push the parts on screen into the depth-sorted pass (innerMapLayers/entities.js). */
    _ambientSortItems(items, ctx, camera) {
        if (!this._ambPartsN) return;
        const self = this;
        for (let i = 0; i < this._ambPartsN; i++) {
            const rec = this._ambParts[i];
            items.push({ sortY: rec.sortY, zLayer: 1, sortH: 0, sortX: rec.q, draw() { self._ambDrawPart(ctx, camera, rec); } });
        }
    },

    _ambDrawPart(ctx, camera, rec) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const { part, art } = rec;
        const man = art.man;
        const frames = Math.max(1, man.frames || 1);
        const fw = (man.w || art.img.width / frames), fh = man.h || art.img.height;
        const w = (man.tilesW || 1) * ds * (part.scale || 1), h = (man.tilesH || 1) * ds * (part.scale || 1);
        const piv = man.pivot || [0.5, 0.5];
        const t = this._ambientT;
        let frame = 0;
        if (frames > 1) {
            if (part.every) {
                const ph = (t + hash01(rec.q, rec.r, 9) * part.every) % part.every;
                const f = Math.floor(ph * (part.fps || 6));
                frame = f < frames ? f : 0;
            } else frame = frameAt({ count: frames, fps: part.fps || 6 }, t, rec.q * 4099 + rec.r);
        }
        const sc = camera.worldToScreenFast(rec.x * T, rec.y * T);
        const sx = sc.x, sy = sc.y;
        if (sx + w < 0 || sx - w > ctx.canvas.width || sy + h < 0 || sy - h > ctx.canvas.height) return;
        // (squash: a wheel or sails seen a little from the side, narrower than tall)
        const sq = part.squash || 1;
        // Below the waterline a wheel shows dim through the water (`submerged`: how much of it shows)
        const wl = part.submerged != null && rec.waterY != null ? camera.worldToScreenFast(0, rec.waterY * T).y : null;
        const pose = () => {
            ctx.translate(sx, sy);
            if (rec.flip) ctx.scale(-1, 1);
            if (sq !== 1) ctx.scale(sq, 1);
            if (part.spin) ctx.rotate(t * part.spin * (rec.turn || 1) * Math.PI * 2);
            if (part.sway) ctx.rotate(Math.sin(t * 1.3 + rec.q) * part.sway * Math.PI / 180);
            ctx.drawImage(art.img, frame * fw, 0, fw, fh, -w * piv[0], -h * piv[1], w, h);
        };
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        if (wl != null) {
            ctx.beginPath();
            ctx.rect(sx - w, sy - h, w * 2, wl - (sy - h));
            ctx.clip();
        }
        pose();
        ctx.restore();
        if (wl != null && part.submerged > 0) {
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.beginPath();
            ctx.rect(sx - w, wl, w * 2, sy + h - wl);
            ctx.clip();
            ctx.globalAlpha = part.submerged;
            pose();
            ctx.restore();
        }
        // Where the wheel meets the water it throws up spray: at the rim on either side, the
        // paddles coming up out of the stream (downstream) throwing the more
        if (part.spray && rec.waterY != null) {
            const kind = this._ambCfg.kinds[part.spray];
            if (kind && kind._sprites && kind._sprites.length) {
                const rate = part.sprayRate || 5;
                const n = slotCount(kind, rate, this._ambCfg.maxSlots);
                const half = (man.tilesW || 1) * (part.scale || 1) * 0.5 * sq * 0.8;
                const up = -(rec.turn || 1);  // the side the bottom paddles head for
                for (const s of [up, -up]) {
                    const k = s === up ? 1 : 0.5;
                    this._ambDrawEmitter(ctx, camera, (rec.x + s * half) * T, rec.waterY * T, kind, rate * k, 1, rec.q * 31 + rec.r + (s > 0 ? 7 : 0), Math.max(1, Math.round(n * k)), ds, null);
                }
                ctx.globalAlpha = 1;
            }
        }
    },

    // ── Drawing ──────────────────────────────────────────────

    _ambDrawEmitter(ctx, camera, wx, wy, kind, rate, level, seed, n, ds, spread) {
        const sc = camera.worldToScreenFast(wx, wy);
        const ox = sc.x, oy = sc.y;
        // (an emitter whose whole plume is off the view: nothing to do)
        const reach = ds * ((kind.rise || 1) * (kind.life ? kind.life[1] : 1) + 2);
        if (ox < -reach || ox > ctx.canvas.width + reach || oy < -ds * 2 || oy - reach > ctx.canvas.height) return;
        const t = this._ambientT;
        const wind = this._ambWind;
        const sprites = kind._sprites;
        const alphaK = Math.min(1, level) * (kind.glow ? 1 : this._ambAlphaK);
        const rateK = rate * Math.max(0.35, Math.min(1.5, level));
        for (let i = 0; i < n; i++) {
            particleAt(kind, seed, i, n, rateK, t, wind, this._ambLifeK, _p, spread);
            if (!_p.alive) continue;
            const a = _p.alpha * alphaK;
            if (a < 0.01) continue;
            const s = Math.max(1.5, _p.size * ds * (kind.glow ? 2.2 : 1.6));
            const x = ox + _p.x * ds, y = oy + _p.y * ds;
            ctx.globalAlpha = a > 1 ? 1 : a;
            ctx.drawImage(sprites[sprites.length > 1 ? Math.floor(_p.h * sprites.length) : 0], x - s / 2, y - s / 2, s, s);
        }
    },

    /** Smoke, steam and breath — over the sprites, under the night (innerMapRenderer.js). */
    _renderAmbient(ctx, camera) {
        const cfg = this._ambCfg;
        if (!cfg || !cfg.enabled || !this._ambEmN) return;
        const ds = this.TILE_SIZE * camera.zoom;
        const sm = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = true;
        for (let i = 0; i < this._ambEmN; i++) {
            const e = this._ambEm[i];
            if (e.kind.glow) continue;
            this._ambDrawEmitter(ctx, camera, e.x, e.y, e.kind, e.rate, e.level, e.seed, e.n, ds, e.spread);
        }
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = sm;
    },

    /** Halos, embers and sparks — added after the night lighting, so they shine in the dark. */
    _renderAmbientGlow(ctx, camera) {
        const cfg = this._ambCfg;
        if (!cfg || !cfg.enabled || (!this._ambEmN && !this._ambGlN)) return;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const t = this._ambientT;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < this._ambGlN; i++) {
            const g = this._ambGl[i];
            if (!g.sprite) continue;
            const f = 1 + (flicker(t, g.seed) - 1) * g.flick * 2;
            const sc = camera.worldToScreenFast(g.x, g.y);
            const s = g.radius * 2 * ds * (0.96 + (f - 1) * 0.5);
            if (sc.x + s < 0 || sc.x - s > ctx.canvas.width || sc.y + s < 0 || sc.y - s > ctx.canvas.height) continue;
            ctx.globalAlpha = Math.max(0, Math.min(1, g.alpha * f * 0.6));
            ctx.drawImage(g.sprite, sc.x - s / 2, sc.y - s / 2, s, s);
        }
        for (let i = 0; i < this._ambEmN; i++) {
            const e = this._ambEm[i];
            if (!e.kind.glow) continue;
            this._ambDrawEmitter(ctx, camera, e.x, e.y, e.kind, e.rate, e.level, e.seed, e.n, ds, e.spread);
        }
        ctx.restore();
    },
});
