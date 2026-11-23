// ============================================
// The sound of the room you are in — the game loop's side
// ============================================
// Once a frame (ui/game/gameLoop.js): while the player is inside a building on the street
// map, the room's ambience is chosen from the building, the hour and who is in it
// (interiorAmbienceSpec, pure), and handed to the audio (systems/audio/interior.js
// setInteriorAmbience) when it changes; the outdoor music and ambience are ducked meanwhile.
//   tavern / inn / hotel / roadhouse / guest house: the murmur of voices, as loud as the
//     room is full and the hour busy (evenings), mugs clinking; the hearth if it has one
//   church / temple / chapel: a low quiet hum and the echo of the vault; a murmur at a service
//   smithy: the forge's fire and the bellows while the smith is at work (the anvil itself is
//     the town scenes' own hammering: world/innerMap/townScenes.js → sfx 'anvil')
//   bakery: the oven's fire; marketplace hall: the crowd while the market's open
//   town hall / guildhall / manor / castle / barracks / bank / library: a big room's echo
//   jail: a cold cell, dripping; underground (mines, caves): the dark, echoing, dripping
//   a house (and anything else): the quiet room tone, a fire crackling if the room has a hearth
// It falls silent on stepping out, leaving the town, pausing (speed 0) or opening the
// settings, and — a watchdog — when the game loop stops calling (back to the title, a hidden tab).
//
// QA from the console: InteriorAmbience.debug() → the spec now playing.

import { InnerMap } from '../world/innerMap.js';
import { audioManager } from '../systems/audio.js';

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _clamp01 = (v) => Math.max(0, Math.min(1, _num(v)));

/** Building types → the kind of room they sound like. */
export const INTERIOR_SOUND_KINDS = {
    tavern: ['tavern', 'inn', 'hotel', 'roadhouse', 'guest_house', 'alehouse', 'bnb'],
    church: ['church', 'temple', 'chapel', 'cathedral', 'monastery', 'shrine', 'abbey'],
    smithy: ['blacksmith', 'armorer', 'armourer', 'forge', 'smithy'],
    bakery: ['bakery'],
    market: ['marketplace', 'market_hall'],
    hall: ['town_hall', 'guildhall', 'manor', 'castle', 'keep', 'palace', 'barracks', 'bank', 'library', 'mint'],
    cell: ['jail'],
};

const FIRE_RE = /fireplace|hearth|oven|forge|brazier|stove|kiln|furnace|campfire/i;
const SMITH_RE = /smith/i;

/** What kind of room a building is, by its type ('house' for anything not listed). */
export function interiorSoundKind(building) {
    if (!building) return null;
    if (building._underground) return 'cave';
    if (building._jail) return 'cell';
    const t = String(building.type || '').replace(/^player_/, '').toLowerCase();
    for (const [kind, types] of Object.entries(INTERIOR_SOUND_KINDS)) if (types.includes(t)) return kind;
    return 'house';
}

/** How busy a tavern is at `hour` (0..1): quiet in the small hours, fullest in the evening. */
export function tavernBusyAt(hour) {
    const h = ((_num(hour, 12) % 24) + 24) % 24;
    if (h < 2) return 0.55;
    if (h < 6) return 0.15;
    if (h < 11) return 0.35;
    if (h < 14) return 0.6;
    if (h < 17) return 0.45;
    if (h < 23) return 1;
    return 0.75;
}

/** The people in the room (the player is not among InnerMap.npcs). */
export function roomOccupants(npcs) {
    if (!Array.isArray(npcs)) return 0;
    let n = 0;
    for (const p of npcs) {
        if (!p || p.dead || p.isDead || p.state === 'dead' || p._downed) continue;
        n++;
    }
    return n;
}

/** The nearest fire in the room (hearth, oven, forge...) → { dist } in cells, or null. */
export function nearestFire(tiles, pq, pr) {
    if (!Array.isArray(tiles)) return null;
    let best = null;
    for (let r = 0; r < tiles.length; r++) {
        const row = tiles[r];
        if (!row) continue;
        for (let q = 0; q < row.length; q++) {
            const t = row[q];
            const f = t && t._furniture;
            if (!f || !(FIRE_RE.test(String(f.type || '')) || FIRE_RE.test(String(f.name || '')))) continue;
            const d = Math.max(Math.abs(q - _num(pq)), Math.abs(r - _num(pr)));
            if (!best || d < best.dist) best = { dist: d, q, r, type: f.type };
        }
    }
    return best;
}

/** Whether the smith is at work at the anvil (the town scenes put them at their station). */
export function smithAtWork(npcs, hour) {
    const h = _num(hour, 12);
    if (h < 6 || h >= 19) return false;
    return Array.isArray(npcs) && npcs.some(n => n && !n.dead && SMITH_RE.test(String(n.type || ''))
        && ((n._scene && n._scene.phase === 'at') || n._swing || /hammer|anvil/i.test(String(n.activity || ''))));
}

/**
 * The room's ambience — pure. ctx: { building, npcs, tiles, hour, playerQ, playerR }.
 * → null (no building) or { kind, layers: { room, chatter, crowd, fire, forge, hum, drip } 0..1, echo, duck: true }.
 */
export function interiorAmbienceSpec(ctx) {
    const c = ctx || {};
    const kind = interiorSoundKind(c.building);
    if (!kind) return null;
    const hour = _num(c.hour, 12);
    const occ = roomOccupants(c.npcs);
    const fireAt = nearestFire(c.tiles, c.playerQ, c.playerR);
    // a fire is louder the nearer you stand to it
    const fireNear = fireAt ? 0.35 + 0.65 * Math.max(0, 1 - fireAt.dist / 12) : 0;
    const L = { room: 1, chatter: 0, crowd: 0, fire: fireNear, forge: 0, hum: 0, drip: 0 };
    let echo = 0;
    switch (kind) {
        case 'tavern': {
            const busy = tavernBusyAt(hour);
            L.chatter = occ ? Math.min(1, (0.2 + occ / 9) * busy) : 0;
            L.crowd = occ >= 5 ? Math.min(1, (occ - 4) / 8) * busy : 0;
            L.room = 0.8;
            break;
        }
        case 'church': {
            const night = hour >= 21 || hour < 5;
            L.hum = night ? 0.7 : 1;
            L.chatter = occ >= 3 ? Math.min(0.25, occ / 30) : 0;   // a hushed murmur, at a service
            L.room = 0.6;
            echo = 0.85;
            break;
        }
        case 'smithy': {
            const working = smithAtWork(c.npcs, hour);
            L.forge = working ? 0.9 : 0;
            // the forge's coals: roaring at work, banked after hours
            L.fire = fireAt ? (working ? Math.max(0.7, fireNear) : 0.25) : (working ? 0.6 : 0);
            L.room = 0.7;
            break;
        }
        case 'bakery':
            L.room = 0.8;
            break;
        case 'market': {
            const open = hour >= 7 && hour < 18;
            L.chatter = occ ? Math.min(0.8, 0.15 + occ / 14) * (open ? 1 : 0.4) : 0;
            L.crowd = open && occ >= 6 ? Math.min(0.8, (occ - 5) / 10) : 0;
            echo = 0.3;
            break;
        }
        case 'hall':
            L.chatter = occ >= 2 ? Math.min(0.45, occ / 16) : 0;
            echo = 0.45;
            break;
        case 'cell':
            L.room = 0.6;
            L.drip = 0.45;
            L.chatter = 0;
            echo = 0.5;
            break;
        case 'cave':
            L.room = 0.9;
            L.drip = 1;
            echo = 0.9;
            break;
        default:   // a house: its quiet, the household's few words
            L.chatter = occ >= 2 ? Math.min(0.2, 0.06 * occ) : 0;
            break;
    }
    for (const k of Object.keys(L)) L[k] = Math.round(_clamp01(L[k]) * 100) / 100;
    return { kind, layers: L, echo: Math.round(_clamp01(echo) * 100) / 100, duck: true };
}

/** Whether two specs sound the same (within a hair). */
export function sameAmbience(a, b) {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind || Math.abs(a.echo - b.echo) > 0.03) return false;
    for (const k of new Set([...Object.keys(a.layers), ...Object.keys(b.layers)])) {
        if (Math.abs(_num(a.layers[k]) - _num(b.layers[k])) > 0.04) return false;
    }
    return true;
}

const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export const InteriorAmbience = {
    _applied: null,      // the spec last handed to the audio (null: silent)
    _acc: 0,
    _key: null,          // building/floor/paused: a change re-chooses at once
    _lastUpdate: 0,
    _watch: null,
    WATCHDOG_MS: 700,
    audio: audioManager, // (specs swap in a fake)

    /** Once a frame from the game loop. */
    update(game, dt) {
        this._lastUpdate = _now();
        const b = InnerMap.active ? InnerMap._insideBuilding : null;
        const paused = !!(game && game.timeSpeed === 0);
        const menu = this._menuOpen();
        if (!b || paused || menu) {
            this._apply(null);
            return;
        }
        const key = `${b.type}|${b.q},${b.r}|${_num(InnerMap._floor)}`;
        this._acc += Math.max(0, _num(dt));
        if (key !== this._key || this._acc >= 0.5 || !this._applied) {
            this._key = key;
            this._acc = 0;
            const spec = interiorAmbienceSpec({
                building: b,
                npcs: InnerMap.npcs,
                tiles: InnerMap.tiles,
                hour: typeof InnerMap._sceneClock === 'function' ? InnerMap._sceneClock() : InnerMap.timeOfDay,
                playerQ: InnerMap.playerInnerQ,
                playerR: InnerMap.playerInnerR,
            });
            this._apply(spec);
        }
        if (this._applied) {
            try { if (typeof this.audio.interiorTick === 'function') this.audio.interiorTick(dt); } catch { /* sound is best-effort */ }
        }
    },

    /** Silence it now (leaving the game, a new game). */
    stop() {
        this._apply(null);
    },

    _apply(spec) {
        if (!spec && !this._applied) return;
        if (spec && sameAmbience(spec, this._applied)) return;
        let done = true;
        try { if (typeof this.audio.setInteriorAmbience === 'function') done = this.audio.setInteriorAmbience(spec) !== false; } catch { /* sound is best-effort */ }
        // (no audio yet — before the first click: asked again next time)
        if (!done) return;
        this._applied = spec;
        if (!spec) this._key = null;
        if (spec) this._startWatch(); else this._stopWatch();
    },

    _menuOpen() {
        try { return typeof document !== 'undefined' && !!document.querySelector && !!document.querySelector('.game-settings-panel'); } catch { return false; }
    },

    /** The loop stopped calling (the title screen, a hidden tab, a crash): fall silent. */
    _watchdog(now = _now()) {
        if (this._applied && now - this._lastUpdate > this.WATCHDOG_MS) this._apply(null);
    },

    _startWatch() {
        if (this._watch || typeof setInterval !== 'function') return;
        this._watch = setInterval(() => this._watchdog(), 300);
    },

    _stopWatch() {
        if (this._watch) { clearInterval(this._watch); this._watch = null; }
    },

    debug() {
        return this._applied;
    },
};
