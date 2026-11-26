// ============================================
// The soundscape — what the world sounds like where you are (the game loop's side)
// ============================================
// Once a frame (ui/game/gameLoop.js), after the room's sound (ui/innerMapInteriorSound.js):
//   - the music's mood (systems/audio/music.js setMusicMood): battle in a fight, court in a
//     castle or manor, town in a settlement, night out of doors after dark, the road elsewhere;
//   - the ambience beds outdoors (systems/audio/beds.js setAmbienceBeds), crossfaded by the
//     place, the hour, the season and the weather: birds by day, crickets and an owl by night,
//     the forest, wind on the heights and in a gale, the surf near the sea or a river, the sea
//     and the hull's creak aboard, the street's murmur in town, the market's hubbub near the
//     stalls by day, a tavern's noise spilling out near its door of an evening, the smith's
//     hammer near the forge — muffled through the walls indoors (the room itself is the
//     interior's: audio/interior.js plays its recorded bed);
//   - footsteps on the street map: two to a tile, timed to the walk, by the ground underfoot
//     (stone, wood indoors, grass, dirt, mud, leaves, snow, a ford's shallows); none rowing or
//     swimming (a stroke splashes instead); on horseback the hooves (hoofStep: a walk, a trot
//     with the run held, dulled on soft ground), and on the world map while a mounted
//     traveller rides from hex to hex;
//   - the hour on both maps: the world map keeps the one day clock too (InnerMap.timeOfDay,
//     moved on by the action points spent: ui/game/dayClock.js), so its nights have crickets,
//     an owl and the night music;
//   - the street's things heard where they are: a cart's wheels while it rolls, a horse
//     snorting by the stables, the choir through a church's walls while a service is sung;
//   - a door opening and shutting on going in or out; blades meeting when a blow lands
//     (ui/innerMapCombat.js hit flashes); the listener's place for sounds with one.
// Choosing is pure (soundscapeSpec, stepSurface); this object only gathers the state and
// hands it on. A watchdog falls silent when the loop stops calling (back to the title).
//
// For other systems: Soundscape.addSource(id, { bed, q, r, level, near, far, ttl }) puts a
// place-bound bed on the street map (a crowd, a feast, a procession) heard by distance, and
// audioManager.playSFX(kind, { q, r }) plays a one-shot as loud as it is near.
//
// QA from the console: Soundscape.debug() → { spec, surface, steps, inputs }.

import { InnerMap } from '../world/innerMap.js';
import { audioManager } from '../systems/audio.js';
import { interiorSoundKind, tavernBusyAt } from './innerMapInteriorSound.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapBattle } from './innerMapBattle.js';

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _clamp01 = (v) => Math.max(0, Math.min(1, _num(v)));
const _r2 = (v) => Math.round(_clamp01(v) * 100) / 100;

const FOREST = new Set(['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'forest', 'jungle', 'swamp']);
const HEIGHTS = new Set(['mountain', 'hills', 'highlands', 'snow', 'snow_peak', 'tundra', 'ice', 'glacier', 'badlands']);
const COASTAL = new Set(['beach', 'island', 'coast']);
const SEA = new Set(['ocean', 'deep_ocean', 'sea', 'coast', 'lake']);
const COLD = new Set(['snow', 'snow_peak', 'tundra', 'ice', 'glacier']);
const COURT_TYPES = /castle|keep|palace|manor|throne|citadel|fortress/;

/** How much of the day it is at `hour` (1 by day, 0 by night, ramps at dawn 4–6 and dusk 19–21). */
export function daylight(hour) {
    if (hour == null || !Number.isFinite(Number(hour))) return 1;
    const h = ((Number(hour) % 24) + 24) % 24;
    if (h >= 6 && h < 19) return 1;
    if (h >= 21 || h < 4) return 0;
    if (h < 6) return (h - 4) / 2;
    return 1 - (h - 19) / 2;
}

/** Birdsong by the season (spring loudest, little in winter). */
const BIRDS = { Spring: 1, Summer: 0.9, Autumn: 0.55, Winter: 0.12 };
/** Crickets by the season (none in winter). */
const CRICKETS = { Spring: 0.6, Summer: 1, Autumn: 0.55, Winter: 0 };

/** A sound's level at `dist` cells: 1 within `near`, nothing past `far` (null dist: nothing). */
export function nearness(dist, near, far) {
    if (dist == null || !Number.isFinite(Number(dist))) return 0;
    const d = Number(dist);
    if (d <= near) return 1;
    if (d >= far) return 0;
    return Math.pow(1 - (d - near) / (far - near), 1.4);
}

/** How busy a town's streets are at `hour` (0..1): empty in the small hours, full by day. */
export function streetBusyAt(hour) {
    if (hour == null) return 0.7;
    const h = ((_num(hour, 12) % 24) + 24) % 24;
    if (h < 5) return 0.08;
    if (h < 7) return 0.3;
    if (h < 18) return 1;
    if (h < 21) return 0.65;
    return 0.25;
}

/**
 * What should be heard — pure. c: {
 *   mode: 'world' | 'street', combat, court, hour (street; null on the world map), season,
 *   terrain (the hex's terrain id), town, atSea, coast (0..1 nearness of the sea),
 *   river (0..1 nearness of a river or pond), weather: { rain, snow, wind, storm },
 *   inside: room kind (interiorSoundKind) or null, near: { market, smithy, tavern, church } in
 *   cells (null: none on the map), crowd (folk within ~10 cells), sources: [{ bed, level }] }
 * → { mood, beds: { bed: 0..1 }, muffle 0..1, events: { owl, creak, wave, anvil… } }
 */
/**
 * A hoofbeat on horseback — pure. c: { speed (InnerMap._rideSpeed), run (the run held),
 * surface (stepSurface of the ground, as if on foot) } → { gain, rate, lowpass, double } |
 * null (not riding). A walk is one clip-clop a footfall; a trot (the run held) is quicker,
 * louder and doubled; soft ground (grass, mud, leaves, snow) dulls it.
 */
export function hoofStep(c) {
    c = c || {};
    const speed = _num(c.speed);
    if (!(speed > 0)) return null;
    const trot = !!c.run;
    const soft = ['grass', 'mud', 'leaves', 'snow', 'dirt'].includes(c.surface);
    const water = c.surface === 'water';
    return {
        gain: Math.round((trot ? 1.2 : 0.9) * (soft ? 0.75 : 1) * (water ? 0.6 : 1) * 100) / 100,
        rate: Math.round((trot ? 1.12 : 1) * Math.min(1.1, 0.9 + speed * 0.06) * 100) / 100,
        lowpass: water ? 900 : soft ? (c.surface === 'snow' ? 1200 : 2200) : 0,
        double: trot,
    };
}

export function soundscapeSpec(c) {
    c = c || {};
    const W = c.weather || {};
    const rain = _clamp01(W.rain);
    const windW = _clamp01(W.wind);
    const storm = !!W.storm;
    const season = c.season || 'Summer';
    const terrain = String(c.terrain || '').toLowerCase();
    const street = c.mode === 'street';
    // (the world map has the day clock too: c.hour there is InnerMap.timeOfDay, null when unknown)
    const hour = c.hour == null ? null : c.hour;
    const day = daylight(hour);
    const night = 1 - day;
    const inside = c.inside || null;
    const town = !!c.town;
    const busy = streetBusyAt(hour);

    // ── The music's mood ──
    let mood = 'explore';
    if (c.combat) mood = 'battle';
    else if (c.court) mood = 'court';
    else if (!inside && night > 0.6) mood = 'night';
    else if (town || inside === 'tavern') mood = 'town';

    // ── The beds outdoors ──
    const B = {};
    const E = {};
    const quietRain = 1 - 0.75 * rain;
    if (!c.atSea) {
        const wild = town ? 0.35 : 1;
        if (FOREST.has(terrain)) B.forest = day * (season === 'Winter' ? 0.45 : 0.95) * quietRain * (town ? 0.4 : 1);
        else B.day_birds = day * (BIRDS[season] ?? 0.8) * quietRain * wild;
        B.night_crickets = night * (CRICKETS[season] ?? 0.6) * (1 - rain) * (town ? 0.45 : 1) * (COLD.has(terrain) ? 0 : 1);
        E.owl = night > 0.5 && !storm ? (season === 'Winter' ? 0.5 : 1.1) * (town ? 0.35 : 1) * (FOREST.has(terrain) ? 1.5 : 1) : 0;
    }
    let wind = HEIGHTS.has(terrain) ? 0.5 : COASTAL.has(terrain) || c.atSea ? 0.3 : terrain === 'plains' || terrain === 'grassland' ? 0.2 : 0.12;
    wind += windW * 0.6 + (storm ? 0.3 : 0) + (season === 'Winter' ? 0.08 : 0);
    if (town && street) wind *= 0.7;
    B.wind = Math.min(1, wind);
    B.wind_gust = Math.max(0, (B.wind - 0.55) * 1.6);
    const coast = _clamp01(c.coast);
    const river = _clamp01(c.river);
    B.surf = Math.max(coast * 0.9, river * 0.55);
    if (coast > 0.15) { E.wave = 3.5 * coast; E.waveGain = 0.4 + 0.6 * coast; }
    if (c.atSea) {
        B.sea = 1;
        B.surf = Math.max(B.surf, 0.35);
        E.creak = storm ? 9 : 5;
        E.wave = Math.max(E.wave || 0, 2.5);
        E.waveGain = Math.max(E.waveGain || 0, 0.6);
    }
    if (town) {
        const crowd = street ? Math.min(0.6, _num(c.crowd) / 18) : 0.3;
        B.town_street = busy * (0.35 + crowd) * (1 - 0.5 * rain);
    }
    if (street) {
        const N = c.near || {};
        const open = hour >= 7 && hour < 18 ? 1 : hour >= 6 && hour < 20 ? 0.35 : 0;
        B.market = open * nearness(N.market, 3, 20) * (1 - 0.6 * rain);
        B.tavern = tavernBusyAt(hour) * nearness(N.tavern, 1, 7) * 0.45;
        const forge = hour >= 6 && hour < 19 ? nearness(N.smithy, 2, 14) : 0;
        if (forge > 0.05) { E.anvil = 7; E.anvilGain = 0.25 + 0.75 * forge; }
        // the horses in the stables, and the one you ride
        const stable = nearness(N.stable, 2, 12);
        if (stable > 0.05 || c.riding) {
            E.snort = Math.max(stable > 0.05 ? 2.5 : 0, c.riding ? 1.2 : 0);
            E.snortGain = Math.max(0.35 + 0.65 * stable, c.riding ? 0.7 : 0);
        }
        // the choir through the church's walls while a service is sung (quiet: the walls)
        if (c.service) B.choir = 0.45 * nearness(N.church, 2, 12);
        // a cart's wheels while it rolls
        let cart = 0;
        for (const d of c.carts || []) cart = Math.max(cart, nearness(d, 1, 11));
        if (cart > 0) B.cart = cart * 0.9;
    }
    // (other systems' place-bound beds: Soundscape.addSource)
    for (const s of c.sources || []) {
        if (s && s.bed) B[s.bed] = Math.max(B[s.bed] || 0, _clamp01(s.level));
    }
    // Indoors the street is heard through the walls: quieter, muffled
    const muffle = inside ? 0.85 : 0;
    if (inside) {
        for (const k of Object.keys(B)) B[k] *= inside === 'cave' || inside === 'cell' ? 0.15 : 0.55;
        E.owl = (E.owl || 0) * 0.4;
        E.anvil = 0;
        E.snort = 0;
    }
    const beds = {};
    for (const [k, v] of Object.entries(B)) { const r = _r2(v); if (r > 0) beds[k] = r; }
    for (const k of Object.keys(E)) E[k] = Math.round(_num(E[k]) * 100) / 100;
    return { mood, beds, muffle, events: E };
}

/**
 * The ground underfoot for a footstep — pure. c: { inside: room kind | null, ground:
 * 'street'|'road'|'soft'|'open'|'ice'|'thinIce'|'water' (world/innerMap/streetSeasons.js
 * _groundKind), mud 0..1, snow 0..1 (lying on the ground), cold (a frozen hex), sub (the
 * cell's sub-terrain id), season, forest, swimming, riding, rowing }
 * → 'stone'|'wood'|'grass'|'dirt'|'mud'|'leaves'|'snow'|'water', or null (no footsteps).
 */
export function stepSurface(c) {
    c = c || {};
    if (c.riding || c.rowing) return null;
    if (c.swimming) return 'water';
    if (c.inside) return ['church', 'hall', 'cell', 'cave'].includes(c.inside) ? 'stone' : 'wood';
    const g = c.ground || 'open';
    if (g === 'water') return 'water';
    if (g === 'ice' || g === 'thinIce') return 'stone';
    const snow = c.cold ? Math.max(0.6, _num(c.snow)) : _num(c.snow);
    if (g === 'street') return snow > 0.55 ? 'snow' : 'stone';
    if (snow > 0.25) return 'snow';
    const mud = _num(c.mud);
    if (g === 'road') return mud > 0.3 ? 'mud' : 'dirt';
    if (g === 'soft') return mud > 0.25 ? 'mud' : 'dirt';
    const sub = String(c.sub || '');
    if (/sand|beach|dune|desert/.test(sub)) return 'grass';   // (the grass set is sand-and-grass: soft and dry)
    if (/rock|stone|boulder|gravel|scree/.test(sub)) return 'dirt';
    if ((c.forest && c.season === 'Autumn') || /leaf|leaves|trees|brush|forest/.test(sub)) return 'leaves';
    return 'grass';
}

const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export const Soundscape = {
    audio: audioManager,     // (specs swap in a fake)
    _acc: 1,
    _spec: null,
    _inputs: null,
    _lastUpdate: 0,
    _watch: null,
    _live: false,
    _walk: null,             // { q, r, half } the walk's last footfall
    _steps: 0,
    _surface: null,
    _inside: undefined,
    _sources: new Map(),
    _near: null,             // the map's places by kind, cached per map
    _nearKey: null,
    WATCHDOG_MS: 1200,
    RECHOOSE_S: 0.5,

    /** Once a frame from the game loop. */
    update(game, dt) {
        const A = this.audio;
        this._lastUpdate = _now();
        if (!A || !A.ctx || typeof A.recordedOn !== 'function' || !A.recordedOn()) return;
        this._live = true;
        this._startWatch();
        A._moodOwnerAt = Date.now();
        const street = !!InnerMap.active;
        if (street) {
            A.setListener(InnerMap.playerInnerQ, InnerMap.playerInnerR);
            this._doors();
            this._footsteps(game);
            this._blows();
        } else {
            A.setListener(null, null);
            this._walk = null;
            this._inside = undefined;
            this._worldHooves(game, dt);
        }
        this._acc += Math.max(0, _num(dt));
        if (this._acc >= this.RECHOOSE_S) {
            this._acc = 0;
            const inputs = this._gather(game, street);
            this._inputs = inputs;
            const spec = soundscapeSpec(inputs);
            this._spec = spec;
            try {
                A.setMusicMood(spec.mood);
                A.setAmbienceBeds(spec.beds, { muffle: spec.muffle, events: spec.events });
            } catch { /* sound is best-effort */ }
        }
        try { A.bedsTick(dt); } catch { /* sound is best-effort */ }
    },

    /** A place-bound bed for other systems: heard by distance from (q, r) on this street map. */
    addSource(id, o = {}) {
        if (!id || !o.bed) return;
        this._sources.set(String(id), {
            bed: o.bed, q: _num(o.q), r: _num(o.r), level: o.level == null ? 1 : _clamp01(o.level),
            near: _num(o.near, 2), far: _num(o.far, 14), until: o.ttl ? Date.now() + _num(o.ttl) * 1000 : 0,
            map: InnerMap.currentWorldTile ? `${InnerMap.currentWorldTile.q},${InnerMap.currentWorldTile.r}` : null,
        });
    },

    removeSource(id) {
        this._sources.delete(String(id));
    },

    /** Gather the state the spec needs. */
    _gather(game, street) {
        const world = game && game.world;
        const player = game && game.player;
        const season = (world && world.season) || InnerMap.season || 'Summer';
        const combat = !!(player && player.inCombat) || !!(InnerMapBattle && InnerMapBattle.active)
            || !!(InnerMapCombat && InnerMapCombat._attackState && !InnerMapCombat._attackState.pending)
            || (this._lastBlow && Date.now() - this._lastBlow < 8000)
            || (this.audio && this.audio._battleUntil > Date.now() && !!(game && game._pendingEncounter));
        if (!street) {
            const tile = world && player && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
            const terrain = tile && tile.terrain ? (tile.terrain.id || tile.terrain) : (tile && tile.type) || '';
            const atSea = !!(player && player.boardedShip) || SEA.has(String(terrain));
            return {
                mode: 'world', combat, season, terrain, atSea,
                hour: this._clockHour(),
                town: !!(tile && (tile.settlement || tile.popCenter)),
                coast: COASTAL.has(String(terrain)) ? 0.6 : 0,
                weather: this._worldWeather(world),
            };
        }
        const at = InnerMap.currentWorldTile || null;
        const wt = this._worldTile(world, at);
        const terrain = wt && wt.terrain ? (wt.terrain.id || wt.terrain) : '';
        const b = InnerMap._insideBuilding || null;
        const inside = b ? interiorSoundKind(b) : null;
        const sw = InnerMap._sw || null;
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        const water = b ? { sea: null, river: null } : this._waterNear(q, r);
        const near = b ? {} : this._placesNear(q, r);
        const now = Date.now();
        const mapKey = at ? `${at.q},${at.r}` : null;
        const sources = [];
        for (const [id, s] of this._sources) {
            if ((s.until && now > s.until) || (s.map && s.map !== mapKey)) { this._sources.delete(id); continue; }
            sources.push({ bed: s.bed, level: s.level * nearness(Math.hypot(s.q - q, s.r - r), s.near, s.far) });
        }
        return {
            mode: 'street', combat, season, terrain,
            court: !!(b && COURT_TYPES.test(String(b.type || '').toLowerCase())),
            hour: typeof InnerMap.streetHour === 'function' ? InnerMap.streetHour() : _num(InnerMap.timeOfDay, 12),
            town: !!(wt && wt.settlement),
            atSea: !!InnerMap._deck,
            coast: nearness(water.sea, 2, 16),
            river: nearness(water.river, 1, 9),
            weather: sw ? { rain: sw.rain, snow: sw.snow, wind: sw.wind ? sw.wind.strength : 0, storm: !!sw.storm } : {},
            inside,
            near,
            crowd: this._crowd(q, r),
            sources,
            service: !b && this._serviceSung(),
            carts: b ? [] : this._rollingCarts(q, r),
            riding: _num(InnerMap._rideSpeed) > 0,
        };
    },

    /** The day clock's hour (one clock for both maps: InnerMap.timeOfDay), or null. */
    _clockHour() {
        try {
            if (typeof InnerMap.streetHour === 'function') return InnerMap.streetHour();
        } catch { /* fall through */ }
        return Number.isFinite(InnerMap.timeOfDay) ? InnerMap.timeOfDay : null;
    },

    /** A service under way in the town's church now (world/innerMap/townScenes.js serviceAt; not its bell's lead). */
    _serviceSung() {
        try {
            if (typeof InnerMap.serviceAt !== 'function' || !InnerMap.townArea || !InnerMap.townArea()) return false;
            const sv = InnerMap.serviceAt(undefined, undefined, false);
            return !!(sv && sv.begun);
        } catch { return false; }
    },

    /** How far off each cart that rolled lately is (a driven one stepping, the one you haul). */
    _rollingCarts(q, r) {
        const list = typeof InnerMap.streetCarts === 'function' ? InnerMap.streetCarts() : [];
        const now = Date.now();
        const seen = this._cartSeen || (this._cartSeen = new Map());
        const out = [];
        for (const c of list || []) {
            const t = c && c.tiles && c.tiles[0];
            if (!t) continue;
            const key = c.id || c;
            const was = seen.get(key);
            const pos = `${t.q},${t.r}`;
            if (!was || was.pos !== pos) seen.set(key, { pos, at: was ? now : 0 });
            const at = (seen.get(key) || {}).at || 0;
            if (now - at < 1400) out.push(Math.hypot(t.q - q, t.r - r));
        }
        if (seen.size > 64) seen.clear();
        return out;
    },

    /** The world's hex under this street map (InnerMap keeps only its q, r). */
    _worldTile(world, at) {
        if (!at) return null;
        if (at.terrain || at.settlement) return at;
        try { return world && typeof world.getTile === 'function' ? world.getTile(at.q, at.r) || at : at; } catch { return at; }
    },

    /** The world map's weather, if the world keeps one (the hex's own: no hour out there). */
    _worldWeather(world) {
        const w = world && world.weather;
        const t = w && (w.type || w.current || '');
        const s = String(typeof t === 'object' ? t.type || '' : t || '').toLowerCase();
        return { rain: /storm/.test(s) ? 1 : /rain/.test(s) ? 0.6 : 0, wind: /storm|wind|blizzard/.test(s) ? 0.7 : 0.15, storm: /storm|blizzard/.test(s) };
    },

    /** The nearest sea/lake and river/pond cells within 16 of (q, r), checked over a window. */
    _waterNear(q, r) {
        const tiles = InnerMap.tiles;
        const out = { sea: null, river: null };
        if (!Array.isArray(tiles) || !tiles.length) return out;
        const R = 16;
        for (let dr = -R; dr <= R; dr += 1) {
            const row = tiles[r + dr];
            if (!row) continue;
            for (let dq = -R; dq <= R; dq += (Math.abs(dr) > 8 ? 2 : 1)) {
                const t = row[q + dq];
                if (!t || !t._wet) continue;
                const d = Math.hypot(dq, dr);
                const sea = t._waterKind === 'sea' || t._waterKind === 'lake';
                if (sea) { if (out.sea == null || d < out.sea) out.sea = d; } else if (out.river == null || d < out.river) out.river = d;
            }
        }
        return out;
    },

    /** The nearest market, smithy, tavern and church on this map (the buildings, cached per map). */
    _placesNear(q, r) {
        const list = Array.isArray(InnerMap.buildings) ? InnerMap.buildings : [];
        const key = `${InnerMap.currentWorldTile ? InnerMap.currentWorldTile.q + ',' + InnerMap.currentWorldTile.r : ''}|${list.length}`;
        if (key !== this._nearKey) {
            this._nearKey = key;
            const by = { market: [], smithy: [], tavern: [], church: [], stable: [] };
            for (const b of list) {
                if (!b) continue;
                const k = /stable/i.test(String(b.type || '')) ? 'stable' : interiorSoundKind(b);
                if (!by[k]) continue;
                const w = _num(b.width, 1), h = _num(b.height, 1);
                by[k].push({ q: _num(b.q) + (w - 1) / 2, r: _num(b.r) + (h - 1) / 2 });
            }
            // (the stalls on the square are a market too: world/innerMap/stalls.js keeps them)
            let stalls = null;
            try { stalls = typeof InnerMap._squareStalls === 'function' ? InnerMap._squareStalls() : null; } catch { stalls = null; }
            if (Array.isArray(stalls)) for (const s of stalls) if (s) by.market.push({ q: _num(s.q), r: _num(s.r) });
            this._near = by;
        }
        const out = {};
        for (const [k, arr] of Object.entries(this._near || {})) {
            let best = null;
            for (const p of arr) { const d = Math.hypot(p.q - q, p.r - r); if (best == null || d < best) best = d; }
            out[k] = best;
        }
        return out;
    },

    /** Folk within ~10 cells. */
    _crowd(q, r) {
        const npcs = Array.isArray(InnerMap.npcs) ? InnerMap.npcs : [];
        let n = 0;
        for (const p of npcs) {
            if (!p || p.dead || p.isDead) continue;
            const pq = _num(p.q, _num(p.innerQ, NaN)), pr = _num(p.r, _num(p.innerR, NaN));
            if (Number.isFinite(pq) && Number.isFinite(pr) && Math.abs(pq - q) <= 10 && Math.abs(pr - r) <= 10) n++;
        }
        return n;
    },

    /** Going in or out of a building: the door. */
    _doors() {
        const b = InnerMap._insideBuilding || null;
        if (this._inside === undefined) { this._inside = b; return; }
        if (b === this._inside) return;
        const was = this._inside;
        this._inside = b;
        // (a hole, a mine, a ladder below decks: no door to it)
        const door = (x) => x && !x._underground && !x._jail && !/deck|hold|cabin|mine|cave/i.test(String(x.type || ''));
        if (door(b) || door(was)) {
            this.audio.playSFX('door_open', { gain: 0.9 });
            this.audio.playSFX('door_close', { gain: 0.75, delay: 0.55 });
        }
    },

    /** Footfalls: two to a tile, on the half-steps of the walk. */
    _footsteps(game) {
        const walking = !!InnerMap._playerWalking && !InnerMap._climb;
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        const p = _num(InnerMap._playerMoveProgress);
        if (!walking) { this._walk = null; return; }
        const W = this._walk;
        if (!W) { this._walk = { q, r, half: p >= 0.5 ? 1 : 0 }; return; }
        let fall = false;
        if (W.q !== q || W.r !== r) {
            // a new tile: a footfall on arriving, the other at the half-step
            W.q = q; W.r = r;
            W.half = p >= 0.5 ? 1 : 0;
            fall = true;
        } else if (!W.half && p >= 0.5) {
            W.half = 1;
            fall = true;
        }
        if (!fall) return;
        const inputs = this._stepInputs(game, q, r);
        const run = !!InnerMap._runHeld && !InnerMap._winded;
        if (inputs.riding && !inputs.rowing) {
            // on horseback: the hooves, by the ground the horse treads
            const hoof = hoofStep({ speed: InnerMap._rideSpeed, run, surface: stepSurface({ ...inputs, riding: false }) });
            this._surface = 'hoof';
            if (!hoof) return;
            this._steps++;
            this._hoofs = (this._hoofs || 0) + 1;
            try {
                this.audio.playSFX('hoof', { gain: hoof.gain, rate: hoof.rate, lowpass: hoof.lowpass || undefined });
                if (hoof.double) this.audio.playSFX('hoof', { gain: hoof.gain * 0.8, rate: hoof.rate * 1.04, lowpass: hoof.lowpass || undefined, delay: 0.16 });
            } catch { /* sound is best-effort */ }
            return;
        }
        const surface = stepSurface(inputs);
        this._surface = surface;
        if (!surface) return;
        this._steps++;
        try { this.audio.playSFX('step_' + surface, { gain: run ? 1.25 : 0.95, rate: run ? 1.06 : 1 }); } catch { /* sound is best-effort */ }
    },

    _stepInputs(game, q, r) {
        const t = InnerMap.tiles && InnerMap.tiles[r] ? InnerMap.tiles[r][q] : null;
        const b = InnerMap._insideBuilding || null;
        const ss = InnerMap._ss || null;
        const sw = InnerMap._sw || null;
        const wt = this._worldTile(game && game.world, InnerMap.currentWorldTile || null);
        const terrain = wt && wt.terrain ? String(wt.terrain.id || wt.terrain) : '';
        return {
            inside: b ? interiorSoundKind(b) : null,
            ground: t && typeof InnerMap._groundKind === 'function' ? InnerMap._groundKind(t) : 'open',
            mud: Math.max(ss ? _num(ss.mud) : 0, sw ? _num(sw.mud) : 0),
            snow: ss ? (ss.winterLook ? Math.max(_num(ss.snow), 0.3) : _num(ss.snow)) : 0,
            cold: COLD.has(terrain),
            sub: t && t.subTerrain ? t.subTerrain.id : '',
            season: (game && game.world && game.world.season) || InnerMap.season,
            forest: FOREST.has(terrain),
            swimming: typeof InnerMap.isPlayerSwimming === 'function' ? !!InnerMap.isPlayerSwimming() : false,
            riding: _num(InnerMap._rideSpeed) > 0,
            rowing: !!InnerMap._aboardBoat,
        };
    },

    /** Riding from hex to hex on the world map: a clip-clop every half second while the horse goes. */
    _worldHooves(game, dt) {
        const p = game && game.player;
        const riding = !!(p && p.isMoving && p.mount && !p.boardedShip && !game.isProcessingTurn);
        if (!riding) { this._hoofT = 0; return; }
        this._hoofT = (this._hoofT || 0) - Math.max(0, _num(dt));
        if (this._hoofT > 0) return;
        this._hoofT = 0.52;
        this._hoofs = (this._hoofs || 0) + 1;
        try { this.audio.playSFX('hoof', { gain: 0.55, rate: 0.97 }); } catch { /* sound is best-effort */ }
    },

    /**
     * A crowd where something is watched (the scaffold, the lists, the pit): its roar as a
     * place-bound bed for `ttl` seconds at (q, r) on this street map (the listener's spot when
     * none is given), and a cheer now when `cheer` (true, or its gain). For the scenes' UI
     * (ui/innerMapTournament.js, ui/actionMenu/executions.js, ui/actionMenu/pitFights.js).
     */
    crowd(id, o = {}) {
        try {
            const on = !!InnerMap.active;
            const q = o.q != null ? o.q : InnerMap.playerInnerQ, r = o.r != null ? o.r : InnerMap.playerInnerR;
            if (on && q != null && r != null) {
                this.addSource(id, { bed: 'crowd', q, r, level: o.level == null ? 0.7 : o.level, near: 4, far: 22, ttl: o.ttl || 20 });
            }
            if (o.cheer) {
                const at = on && q != null ? { q, r, far: 30 } : {};
                this.audio.playSFX('crowd_cheer', { ...at, gain: o.cheer === true ? 1 : _num(o.cheer, 1), delay: _num(o.delay) });
            }
        } catch { /* sound is best-effort */ }
    },

    /** A blow landing in a fight (ui/innerMapCombat.js hit flashes): blades meeting, where it fell. */
    _blows() {
        const list = InnerMapCombat && InnerMapCombat._hitFlashes;
        if (!Array.isArray(list) || !list.length) return;
        // (a blow at a tree or a rock is the felling's and the mining's own sound)
        const st = InnerMapCombat._attackState;
        const objects = !!(st && st.targetType === 'object');
        let n = 0;
        for (const f of list) {
            if (!f || f._heard) continue;
            f._heard = true;
            if (objects || n++ >= 2) continue;
            this._lastBlow = Date.now();
            const q = _num(f.worldX) / 32 - 0.5, r = _num(f.worldY) / 32 - 0.5;
            try { this.audio.playSFX(Math.random() < 0.7 ? 'sword_clash' : 'sword_swing', { q, r, far: 22 }); } catch { /* sound is best-effort */ }
        }
    },

    /** The loop stopped calling (the title screen, a hidden tab): the beds fall silent, the music is the scenes' again. */
    _watchdog(now = _now()) {
        if (!this._live || now - this._lastUpdate <= this.WATCHDOG_MS) return;
        this._live = false;
        this._spec = null;
        this._acc = 1;
        try {
            this.audio._moodOwnerAt = 0;
            this.audio.setAmbienceBeds({}, {});
            this.audio.setListener(null, null);
        } catch { /* sound is best-effort */ }
        this._stopWatch();
    },

    _startWatch() {
        if (this._watch || typeof setInterval !== 'function') return;
        this._watch = setInterval(() => this._watchdog(), 400);
    },

    _stopWatch() {
        if (this._watch) { clearInterval(this._watch); this._watch = null; }
    },

    debug() {
        return {
            spec: this._spec,
            surface: this._surface,
            steps: this._steps,
            hoofs: this._hoofs || 0,
            inputs: this._inputs,
            music: this.audio && this.audio.musicState ? this.audio.musicState() : null,
            beds: this.audio && this.audio.bedStats ? this.audio.bedStats() : null,
        };
    },
};
