// ============================================
// INNER MAP PLAGUE — the pestilence on the street map
// ============================================
// What a sick town looks like while the player walks it, by how bad it is
// (systems/plague.js severityAt; the sick, the healer's round, the red
// crosses and the mourners are ui/innerMapSickness.js; the death cart is
// ui/innerMapCarts.js):
//
//   - the streets empty: the healthy keep indoors (InnerMap._plagueStay, read
//     by world/innerMap/townSickness.js), stalls are left with their wares
//     under a cloth and their keepers at home (_plagueStalls), shops shuttered
//     with boards across their doors and nothing sold (_plagueShops, read by
//     world/innerMap/npcs.js getBuildingActions);
//   - the plague houses boarded up as well as crossed; the houses no one
//     lives in now taken for the dead's (as many as the plague dead allow),
//     boarded and crossed — their goods to burn, or to loot;
//   - the healers go in beaked masks and black (an LPC look of their own,
//     data/plague.json street.doctorLayers; scripts/make_plague_mask.py);
//   - herb fires burn in the square (real campfire props, so the flames,
//     smoke and glow are ui/innerMapLayers/ambient.js's), and one before
//     each house whose dead's goods were burnt;
//   - the death cart's crier rings a handbell;
//   - an open grave in the churchyard, the shrouded dead in it, lime over;
//   - a barrier across each road in at a shut gate;
//   - going into a house where the sick lie counts toward catching it
//     (InnerMapSickness._contact, read once a day by ui/game/endDay.js).
//
// The houses' menus (buildingItems / handle: plague_*): nurse the sick,
// burn the dead's goods, loot the dead's house; at the market, sell
// remedies. turnedAway: told when the gate guards turn the player back on
// the world map (player/core/movement.js), with a bribe offered.
//
// Picks are hashes of the town, the place and the day (systems/plague.js),
// never the shared RNG; the crimes draw Utils' stream (systems/plague.js).

import { InnerMap } from '../world/innerMap.js';
import { CustomObjects } from '../world/customObjects.js';
import { TownProps } from '../world/townProps.js';
import { Plague } from '../systems/plague.js';
import { Illness } from '../systems/illness.js';
import { InnerMapSickness } from './innerMapSickness.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { PlagueArt } from './plagueArt.js';
import { audioManager } from '../systems/audio/index.js';
import { esc, lede, rowList, price } from './actionMenu/uiKit.js';

const DOCTOR = 'plague_doctor';
const FIRE = 'tp_campfire';
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const _bkey = b => `${b.q},${b.r}`;

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _frac(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

function _sfx(name) {
    try { audioManager.playSFX(name); } catch (e) { /* sound is best-effort */ }
}

export const InnerMapPlague = {
    _outer: null,
    _tick: 0,
    _clock: 0,
    _sev: 0,
    _day: -1,
    _townKey: null,
    _bellAt: 0,
    _doctorReady: false,
    _doctorAsked: false,
    _fires: [],
    _abandoned: [],
    _pit: null,
    _pitDead: 0,
    _barriers: [],
    _visited: new Set(),
    _quarantined: false,

    /** The street map's own tiles (the outside, even while the player is in a building). */
    _outerTiles() {
        return InnerMap._insideBuilding && InnerMap._outerMapState ? InnerMap._outerMapState.tiles : InnerMap.tiles;
    },

    _reset() {
        this._outer = this._outerTiles();
        this._fires = [];
        this._abandoned = [];
        this._pit = null;
        this._pitDead = 0;
        this._barriers = [];
        this._day = -1;
        this._sev = 0;
        this._visited.clear();
        InnerMap._plagueStay = 0;
        InnerMap._plagueStalls = null;
        InnerMap._plagueShops = null;
        InnerMap._plagueAbandoned = null;
    },

    _bark(npc, text, secs = 3.4) {
        if (!npc || !text) return;
        const now = _now();
        npc._bark = { text, until: now + secs * 1000, from: now };
    },

    /** The masked look, composited once (its layers: data/plague.json). */
    _ensureDoctor() {
        if (this._doctorAsked) return this._doctorReady;
        this._doctorAsked = true;
        const layers = Plague.config().street.doctorLayers;
        if (!Array.isArray(layers) || !layers.length || typeof InnerMapCharacters.registerPreset !== 'function') return false;
        try {
            Promise.resolve(InnerMapCharacters.registerPreset(DOCTOR, layers)).then(ok => { this._doctorReady = ok !== false; }).catch(() => { this._doctorReady = false; });
        } catch (e) { this._doctorReady = false; }
        return false;
    },

    update(dt, game) {
        if (!InnerMap.active || !game || !game.world) return;
        if (this._outer !== this._outerTiles()) this._reset();
        const ref = InnerMap._currentWorldTileRef;
        const s = ref && ref.settlement;
        if (!s) { if (this._sev) this._reset(); return; }
        this._clock += dt;
        this._tick -= dt;
        if (this._tick > 0) return;
        this._tick = 1.5;
        const world = game.world;
        const day = _num(world.day, 1);
        const sev = Plague.severityAt(world, s, day);
        const S = Plague.config().street;
        const townKey = `${s.q},${s.r}`;
        const changed = day !== this._day || Math.abs(sev - this._sev) > 0.05 || townKey !== this._townKey;
        this._sev = sev;
        this._townKey = townKey;
        this._quarantined = Plague.isQuarantined(world, s);
        InnerMap._plagueStay = sev > 0 ? Plague.stayHome(sev) : 0;
        // (planned from the street: indoors the map's buildings are the room's)
        if (changed && !InnerMap._insideBuilding) {
            this._day = day;
            this._plan(world, s, day, sev);
        }
        this._doctors(sev >= _num(S.doctorAt, 0.2));
        if (!InnerMap._insideBuilding) this._lightFires(world, s, day, sev);
        if (sev <= 0) return;
        this._bell(game);
        this._houseContact(day);
        this._doctorTalk();
    },

    // ──────────── THE DAY'S PLAN ────────────

    /** Which stalls stand covered, which shops shut, which houses are the dead's, where the grave is. */
    _plan(world, s, day, sev) {
        const S = Plague.config().street;
        const tk = this._townKey;
        // Stalls under a cloth, shops shuttered
        const stalls = new Set();
        const shops = new Set();
        if (sev > 0 && !InnerMap._insideBuilding) {
            for (const st of (InnerMap._squareStalls ? InnerMap._squareStalls(this._outer) : [])) {
                if (Plague.stallAbandoned(sev, st.key, tk, day)) stalls.add(`${st.q},${st.r}`);
            }
        }
        const blds = InnerMap._townBuildings ? InnerMap._townBuildings() : (InnerMap.buildings || []);
        if (sev > 0) for (const b of blds) if (b && b.type !== 'house' && Plague.shopShut(sev, b.type, _bkey(b), tk, day)) shops.add(_bkey(b));
        InnerMap._plagueStalls = stalls.size ? stalls : null;
        InnerMap._plagueShops = shops.size ? shops : null;
        // The dead's houses: houses no one lives in now, as many as the dead allow
        this._abandoned = [];
        const ill = s.folk && s.folk.ill;
        const deadAny = Array.isArray(ill && ill.deaths) ? ill.deaths.filter(e => e && day - _num(e.d) <= _num(S.pitDays, 60) && day >= _num(e.d)).length : 0;
        if (sev > 0 && deadAny > 0) {
            const lived = new Set((InnerMap.npcs || []).filter(n => n._home).map(n => _bkey(n._home)));
            const empty = blds.filter(b => b && b.type === 'house' && !b._vacant && !b.isPlayerOwned && !b.isPlayerProperty && !lived.has(_bkey(b)))
                .sort((a, b) => _frac(`ab|${tk}|${_bkey(a)}`) - _frac(`ab|${tk}|${_bkey(b)}`));
            this._abandoned = empty.slice(0, Math.min(_num(S.abandonMax, 6), Math.ceil(deadAny / 2)));
        }
        InnerMap._plagueAbandoned = this._abandoned.length ? new Set(this._abandoned.map(_bkey)) : null;
        // The open grave in the churchyard
        const dead = Plague.deaths(s, day);
        this._pitDead = dead;
        this._pit = dead >= _num(S.pitDeaths, 2) ? (this._pit || this._pitSpot()) : null;
        // Barriers across the roads in at a shut gate
        const A = this._quarantined && InnerMap.townArea && !InnerMap._insideBuilding ? InnerMap.townArea() : null;
        this._barriers = A && Array.isArray(A.gates) ? A.gates.map(g => ({ q: g.q, r: g.r })) : [];
    },

    /** A run of three free cells at the back of the churchyard, else beside the church. → { q, r, len } or null */
    _pitSpot() {
        const tiles = this._outer;
        if (!tiles) return null;
        const free = (q, r) => {
            const t = tiles[r] && tiles[r][q];
            return !!(t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart && !t.building && !t.customBuilding && !t.customBuildingPart && !t.isWater && !t._plotHead);
        };
        const run = (q, r) => free(q, r) && free(q + 1, r) && free(q + 2, r);
        const yard = InnerMap.townYard ? InnerMap.townYard() : null;
        if (yard) {
            const rows = [];
            for (let r = yard.r0; r <= yard.r1; r++) rows.push(r);
            // the back of the yard first (away from its gate)
            rows.sort((a, b) => (yard.front === 'south' ? a - b : b - a));
            for (const r of rows) for (let q = yard.q0; q <= yard.q1 - 2; q++) if (run(q, r)) return { q, r, len: 3 };
        }
        const church = (InnerMap.buildings || []).find(b => b && (b.type === 'church' || b.type === 'temple' || b.type === 'chapel'));
        if (!church) return null;
        for (let rad = 3; rad <= 8; rad++) {
            for (let dr = -rad; dr <= rad; dr++) {
                for (let dq = -rad; dq <= rad; dq++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const q = church.q + dq, r = church.r + dr;
                    if (run(q, r) && !(tiles[r][q].isRoad || tiles[r][q + 1].isRoad || tiles[r][q + 2].isRoad)) return { q, r, len: 3 };
                }
            }
        }
        return null;
    },

    // ──────────── THE MASKED HEALERS ────────────

    _doctors(on) {
        const npcs = InnerMap.npcs || [];
        const ready = on && this._ensureDoctor() && this._doctorReady;
        for (const n of npcs) {
            const want = ready && n._healer && n.state !== 'gone';
            if (want && n.preset !== DOCTOR) {
                n._prePlaguePreset = n.preset;
                n.preset = DOCTOR;
            } else if (!want && n.preset === DOCTOR && n._prePlaguePreset !== undefined) {
                n.preset = n._prePlaguePreset;
                delete n._prePlaguePreset;
            }
        }
    },

    _doctorTalk() {
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        for (const n of InnerMap.npcs || []) {
            if (n.preset !== DOCTOR || _dist(n, me) > 6 || (n._bark && n._bark.until > _now())) continue;
            if (_frac(`doc|${n.id}|${Math.floor(this._clock / 9)}`) < 0.25) this._bark(n, Plague.line('doctor', `${n.id}|${Math.floor(this._clock)}`));
        }
    },

    // ──────────── THE DEATH CART'S BELL ────────────

    _bell(game) {
        if (this._clock < this._bellAt || !InnerMap.streetCarts) return;
        const S = Plague.config().street;
        const [lo, hi] = Array.isArray(S.bellEvery) ? S.bellEvery : [7, 12];
        this._bellAt = this._clock + lo + _frac(`bell|${Math.floor(this._clock)}`) * (hi - lo);
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        for (const c of InnerMap.streetCarts()) {
            if (c.job !== 'plague' || !c.driver) continue;
            const d = c.driver;
            if (!(d._bark && d._bark.until > _now())) this._bark(d, Plague.line('bell', `${d.id}|${Math.floor(this._clock)}`), 2.4);
            if (!InnerMap._insideBuilding && _dist(d, me) <= 18 && game) _sfx('handbell');
        }
    },

    // ──────────── HERB FIRES ────────────

    _fireAt(q, r) {
        const t = this._outer && this._outer[r] && this._outer[r][q];
        return !!(t && t.customObject && t.customObject._plagueFire);
    },

    _putFire(q, r, tag) {
        const def = CustomObjects.getDef ? CustomObjects.getDef(FIRE) : null;
        const tiles = this._outer;
        if (!def || !tiles || !TownProps.place(tiles, def, q, r)) return false;
        tiles[r][q].customObject._plagueFire = tag;
        this._fires.push({ q, r, tag });
        return true;
    },

    _clearFire(f) {
        const t = this._outer && this._outer[f.r] && this._outer[f.r][f.q];
        if (t && t.customObject && t.customObject._plagueFire) {
            t.customObject = null;
            for (const row of this._outer) for (const c of row) if (c && c.customObjectPart && c.customObjectPart.anchorQ === f.q && c.customObjectPart.anchorR === f.r) c.customObjectPart = null;
        }
    },

    /** Free ground next to (q, r) for a fire, off the road where it can be. */
    _fireSpot(at, ring = 3) {
        const tiles = this._outer;
        let road = null;
        for (let rad = 1; rad <= ring; rad++) {
            for (let dr = -rad; dr <= rad; dr++) {
                for (let dq = -rad; dq <= rad; dq++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const q = at.q + dq, r = at.r + dr;
                    const t = tiles[r] && tiles[r][q];
                    if (!t || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.customObjectPart || t.building || t.customBuilding || t.customBuildingPart || t.isWater) continue;
                    if (!t.isRoad) return { q, r };
                    road = road || { q, r };
                }
            }
        }
        return road;
    },

    _lightFires(world, s, day, sev) {
        if (!this._outer) return;
        const S = Plague.config().street;
        const want = [];
        if (sev >= _num(S.bonfireAt, 0.25)) {
            const A = InnerMap.townArea ? InnerMap.townArea() : null;
            const n = Math.max(1, Math.min(_num(S.bonfires, 3), Math.round(sev * _num(S.bonfires, 3))));
            const sq = A && A.square ? A.square.slice().sort((a, b) => _frac(`f|${this._townKey}|${a.q},${a.r}`) - _frac(`f|${this._townKey}|${b.q},${b.r}`)) : [];
            for (let i = 0; i < sq.length && want.filter(w => w.tag === 'sq').length < n; i++) {
                if (want.some(w => _dist(w, sq[i]) < 4)) continue;
                want.push({ q: sq[i].q, r: sq[i].r, tag: 'sq' });
            }
        }
        // Before each house whose dead's goods were burnt these days
        const burnt = (s.plague && s.plague.burnt) || {};
        for (const [k, d] of Object.entries(burnt)) {
            if (day - _num(d) > _num(S.burnDays, 3)) continue;
            const [q, r] = k.split(',').map(Number);
            const door = InnerMap._findPassableAdjacentTile ? InnerMap._findPassableAdjacentTile(q, r) : null;
            if (door) want.push({ q: door.q, r: door.r, tag: `b:${k}` });
        }
        // Out what is no longer wanted; in what is
        this._fires = this._fires.filter(f => {
            if (want.some(w => w.tag === f.tag)) return true;
            this._clearFire(f);
            return false;
        });
        for (const w of want) {
            if (this._fires.some(f => f.tag === w.tag)) continue;
            const spot = this._fireSpot(w, w.tag === 'sq' ? 3 : 2);
            if (spot) this._putFire(spot.q, spot.r, w.tag);
        }
    },

    // ──────────── IN A SICK HOUSE ────────────

    _houseContact(day) {
        const b = InnerMap._insideBuilding;
        if (!b) return;
        const key = `${day}|${_bkey(b)}`;
        if (this._visited.has(key)) return;
        const sickHere = (InnerMap.npcs || []).filter(n => n._sick && n._home && n._home.q === b.q && n._home.r === b.r && n._person && Illness.isContagious(n._person, day));
        if (!sickHere.length) return;
        this._visited.add(key);
        const per = _num(Plague.config().street.contact.sickHouse, 3);
        for (const n of sickHere) {
            const k = n._person.ill.k;
            InnerMapSickness._contact[k] = _num(InnerMapSickness._contact[k]) + per;
        }
    },

    _addContact(k, n) {
        if (!k || !(n > 0)) return;
        InnerMapSickness._contact[k] = _num(InnerMapSickness._contact[k]) + n;
    },

    // ──────────── DRAWN ────────────

    /** The door's face of a building on screen (as the red cross: ui/innerMapSickness.js). */
    _doorFace(b, camera, T) {
        const door = InnerMap._findPassableAdjacentTile(b.q, b.r);
        if (!door) return null;
        const fx = (b.q + door.q) / 2 * T + T / 2;
        const fy = (b.r + door.r) / 2 * T + T / 2;
        const s0 = camera.worldToScreenFast(fx, fy);
        return { x: s0.x, y: s0.y, sortY: Math.max(b.r, door.r) * T + T - 0.3 };
    },

    _onScreen(ctx, x, y, m) {
        return !(x < -m || y < -m || x > ctx.canvas.width + m || y > ctx.canvas.height + m);
    },

    collect(items, ctx, camera, T) {
        if (InnerMap._insideBuilding || !(this._sev > 0 || this._quarantined)) return;
        const ds = T * camera.zoom;
        const u = Math.max(1, Math.round(ds / 22));
        const S = Plague.config().street;
        // Plague houses boarded up (the cross over the planks is ui/innerMapSickness.js's), the dead's
        // houses boarded and crossed, shops' doors barred
        if (this._sev >= _num(S.boardAt, 0.3)) {
            for (const b of InnerMap._plagueDoors || []) {
                const f = this._doorFace(b, camera, T);
                if (!f || !this._onScreen(ctx, f.x, f.y, ds)) continue;
                const x = Math.round(f.x), y = Math.round(f.y);
                items.push({ sortY: f.sortY - 0.01, zLayer: 2, draw: () => PlagueArt.boards(ctx, x, y, u, 'x') });
            }
        }
        for (const b of this._abandoned) {
            const f = this._doorFace(b, camera, T);
            if (!f || !this._onScreen(ctx, f.x, f.y, ds)) continue;
            const x = Math.round(f.x), y = Math.round(f.y);
            const burnt = Plague.burnt(InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement, _bkey(b));
            items.push({ sortY: f.sortY, zLayer: 2, draw: () => { PlagueArt.boards(ctx, x, y, u, 'x'); if (!burnt) PlagueArt.cross(ctx, x, y, u); } });
        }
        const shops = InnerMap._plagueShops;
        if (shops) {
            for (const b of InnerMap.buildings || []) {
                if (!b || !shops.has(_bkey(b))) continue;
                const f = this._doorFace(b, camera, T);
                if (!f || !this._onScreen(ctx, f.x, f.y, ds)) continue;
                const x = Math.round(f.x), y = Math.round(f.y);
                items.push({ sortY: f.sortY, zLayer: 2, draw: () => PlagueArt.boards(ctx, x, y, u, 'bar') });
            }
        }
        // Stalls with their wares under a cloth
        const stalls = InnerMap._plagueStalls;
        if (stalls) {
            const def = CustomObjects.getDef ? CustomObjects.getDef('tp_stall') : null;
            const bd = def && def.bounds ? def.bounds : { minCol: 0, maxCol: 1, minRow: -1 };
            const w = (bd.maxCol - bd.minCol + 1) * ds;
            for (const k of stalls) {
                const [q, r] = k.split(',').map(Number);
                // (over the counter and its wares, the awning and the stall's front left showing)
                const s0 = camera.worldToScreenFast((q + bd.minCol) * T, (r - 1) * T);
                const x = Math.round(s0.x), y = Math.round(s0.y);
                if (!this._onScreen(ctx, x, y, w)) continue;
                items.push({ sortY: r * T + T - 0.2, zLayer: 2, draw: () => PlagueArt.stallCloth(ctx, x + u, y, w - 2 * u, ds * 1.05, u) });
            }
        }
        // The open grave in the churchyard
        const pit = this._pit;
        if (pit) {
            const s0 = camera.worldToScreenFast(pit.q * T, pit.r * T + T * 0.1);
            const x = Math.round(s0.x), y = Math.round(s0.y);
            if (this._onScreen(ctx, x, y, ds * 4)) {
                const dead = Math.min(this._pitDead, 6);
                items.push({ sortY: pit.r * T + 0.5, zLayer: 1, draw: () => PlagueArt.trench(ctx, x, y, ds, pit.len, dead, u) });
            }
        }
        // A barrier across each road in at a shut gate
        if (this._quarantined) {
            for (const g of this._barriers) {
                const s0 = camera.worldToScreenFast(g.q * T + T / 2, g.r * T + T / 2);
                const x = Math.round(s0.x), y = Math.round(s0.y);
                if (!this._onScreen(ctx, x, y, ds * 2)) continue;
                items.push({ sortY: g.r * T + T * 0.6, zLayer: 2, draw: () => PlagueArt.barrier(ctx, x, y, ds, u) });
            }
        }
    },

    // ──────────── THE HOUSES' MENUS ────────────

    _town(game) {
        const ref = InnerMap._currentWorldTileRef;
        return (ref && ref.settlement) || (game && game.world && game.player ? (game.world.getTile(game.player.q, game.player.r) || {}).settlement : null) || null;
    },

    _isSickHouse(b) { return (InnerMap._sickHomes || []).some(h => h && h.q === b.q && h.r === b.r); },

    _isAbandoned(b) { return !!(InnerMap._plagueAbandoned && InnerMap._plagueAbandoned.has(_bkey(b))); },

    /** Menu entries for a building in a sick town. */
    buildingItems(game, building) {
        const out = [];
        const s = this._town(game);
        if (!s || !building || !(this._sev > 0)) return out;
        const key = _bkey(building);
        if (InnerMap._plagueShops && InnerMap._plagueShops.has(key)) {
            out.push({ type: 'disabled', label: '🚪 Shuttered against the plague', desc: 'Boards across the door; no one will trade until the sickness passes' });
        }
        if (building.type === 'house' && this._isSickHouse(building)) {
            out.push({ type: 'disabled', label: '✚ The sick lie within', desc: 'A cross on the door: someone in this house is laid up' });
            out.push({ type: 'action', action: 'plague_nurse', label: 'Nurse the Sick Within', icon: '🩹', desc: 'Sit with them, water and clean linen — kindness remembered, and the closest you can come to catching it', building });
        }
        if (building.type === 'house' && this._isAbandoned(building)) {
            const burnt = Plague.burnt(s, key), looted = Plague.looted(s, key);
            out.push({ type: 'disabled', label: burnt ? '🕯️ Its people are dead; their goods are ash' : looted ? '🕯️ Its people are dead; it has been robbed' : '🕯️ Its people are dead of the sickness', desc: 'The house stands shut up and silent' });
            if (!burnt && !looted) {
                out.push({ type: 'action', action: 'plague_burn', label: "Burn the Dead's Goods", icon: '🔥', desc: 'Bedding and clothes on a fire before the door: the sickness goes the slower through the town (karma)', building });
                out.push({ type: 'action', action: 'plague_loot', label: 'Loot the Empty House', icon: '🦹', desc: "What the dead left — a crime, and their goods may carry the plague", building });
            }
        }
        if (building.type === 'marketplace' || building.type === 'apothecary' || building.type === 'church' || building.type === 'temple') {
            const rem = Plague.remedies(game.player, game.world, s);
            if (rem.length) out.push({ type: 'action', action: 'plague_remedies', label: 'Sell Remedies to the Frightened', icon: '🧪', desc: `${rem.map(r => `${r.id.replace(/_/g, ' ')} ${r.price}g`).join(', ')} — a plague price`, building });
        }
        return out;
    },

    /** Run plague_*. Returns true when it was ours. */
    handle(game, item) {
        if (!item || !/^plague_/.test(item.action || '')) return false;
        const s = this._town(game);
        const b = item.building;
        if (!s) return true;
        const { world, player } = game;
        const note = (title, res) => game.ui.showNotification(title, res.success ? res.text : res.reason, res.success ? 'success' : 'info');
        if (item.action === 'plague_nurse' && b) {
            const people = (InnerMap.npcs || []).filter(n => n._home && n._home.q === b.q && n._home.r === b.r && n._person).map(n => n._person);
            const res = Plague.nurse(player, world, s, people, _bkey(b));
            if (res.success) {
                this._addContact(res.k, res.contact);
                if (InnerMap.passHours) InnerMap.passHours(2);
                const sick = (InnerMap.npcs || []).find(n => n._sick && n._home && n._home.q === b.q && n._home.r === b.r);
                if (sick) this._bark(sick, Plague.line('nursed', `${sick.id}|${world.day}`));
            }
            note('🩹 At the Bedside', res);
        } else if (item.action === 'plague_burn' && b) {
            const res = Plague.burnGoods(player, world, s, _bkey(b));
            if (res.success) {
                this._addContact(Plague.isPlague(world, s) ? 'plague' : ((s.sickness && s.sickness.k) || null), res.contact);
                if (InnerMap.passHours) InnerMap.passHours(1);
                this._lightFires(world, s, _num(world.day, 1), this._sev);
            }
            note("🔥 The Dead's Goods", res);
        } else if (item.action === 'plague_loot' && b) {
            const res = Plague.lootHouse(player, world, s, _bkey(b), this._deadOf(s, b));
            if (res.success) {
                this._addContact(Plague.isPlague(world, s) ? 'plague' : null, res.contact);
                if (InnerMap.passHours) InnerMap.passHours(0.5);
                if (res.seen) {
                    const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
                    const near = (InnerMap.npcs || []).filter(n => n.state !== 'inside_building' && _dist(n, me) <= 8).sort((x, y) => _dist(x, me) - _dist(y, me))[0];
                    if (near) this._bark(near, Plague.line('looted', `${near.id}|${world.day}`));
                }
            }
            game.ui.showNotification('🦹 Among the Dead', res.success ? res.text : res.reason, res.success ? (res.seen || res.caught ? 'warning' : 'success') : 'info');
        } else if (item.action === 'plague_remedies') {
            note('🧪 Remedies', Plague.sellRemedies(player, world, s));
        }
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        return true;
    },

    /** The dead of a dead household's house: those of the roster who died of the sickness lately, by a hash of the house. */
    _deadOf(s, b) {
        const ill = s.folk && s.folk.ill;
        if (!ill || !Array.isArray(ill.deaths) || !Array.isArray(s.folk.people)) return [];
        const ids = ill.deaths.map(e => e.a);
        const dead = s.folk.people.filter(p => ids.includes(p.id) && p.died != null && _num(p.purse) > 0);
        const ix = this._abandoned.findIndex(x => x.q === b.q && x.r === b.r);
        if (ix < 0 || !dead.length) return [];
        // each house its share of the dead
        const per = Math.max(1, Math.ceil(dead.length / Math.max(1, this._abandoned.length)));
        return dead.slice(ix * per, ix * per + per);
    },

    // ──────────── TURNED AWAY ────────────

    /** The gate guards turned the player back on the world map (player.turnedAway): tell it, offer the bribe. */
    turnedAway(game) {
        const p = game && game.player;
        const t = p && p.turnedAway;
        if (!t) return;
        p.turnedAway = null;
        const tile = game.world.getTile(t.q, t.r);
        const s = tile && tile.settlement;
        if (!s) return;
        const line = Plague.line('gateTurn', `${s.q},${s.r}|${game.world.day}`);
        const can = _num(p.gold) >= _num(t.bribe);
        if (typeof game.ui.showCustomPanel === 'function') {
            const html = lede(`${line ? `<i>“${esc(line)}”</i><br>` : ''}${esc(t.why)}`)
                + rowList([{
                    icon: '🪙', name: 'Bribe the gate guards',
                    desc: `They look the other way for a few days. If their sergeant sees it, it is a crime — and you go in among the sick.`,
                    side: price(t.bribe, can), off: !can, why: `Needs ${t.bribe}g.`,
                    act: 'sicknessAct', args: ['bribe', s.q, s.r],
                }], '🚧 The shut gate');
            game.ui.showCustomPanel(`🚧 ${s.name} — Gates Shut`, html);
        } else {
            game.ui.showNotification('🚧 Gates Shut', t.why, 'warning');
        }
    },
};
