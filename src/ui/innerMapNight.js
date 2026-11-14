// ============================================
// INNER MAP NIGHT — the town after dark on the street map
// ============================================
// The street map's half of systems/nightStreets.js, ticked and drawn from
// InnerMapCombat (beside the thieves and the watch stop):
//
//   THE DARK    — each frame the light's darkness and whether you carry a
//                 light go to NightSight (StreetCrime's witnesses and
//                 container thefts see less far in the dark). L shutters or
//                 lights your lantern (LightSystem.playerLightDoused).
//   CURFEW      — the town's curfew (NightStreets.curfew) set on the map as
//                 InnerMap._curfew: folk go home, more of the watch walks its
//                 beat (world/innerMap/nightWatch.js), each with a lantern
//                 drawn in hand. A guard who sees you out (far with a light,
//                 near in the dark) calls a halt and walks up: the
//                 'curfew_challenge' scene (ui/actionMenu/nightScenes.js).
//   LANDINGS    — tonight's landing (NightStreets.landingPlan) at a quiet
//                 shore or river bank away from the pier: an LPC skiff drawn
//                 up (world/innerMap/harbour.js _moorShip, flagged smugglers,
//                 unmoored at dawn), the crew hauling crates; come near and
//                 the 'smuggler_landing' scene opens.
//   NIGHT MARKET — after dark, behind a building on the town's edge: a
//                 hanging lantern, crates and the fence; come near and the
//                 'night_market' scene opens.
//
// Spawned folk are flagged _nightFolk (the curfew leaves them be) and sent
// off when the hour passes or the map changes. Placement and timing draw on
// hashes of the seed, the town, the day and the clock, never the shared RNG.

import { InnerMap } from '../world/innerMap.js';
import { CustomObjects } from '../world/customObjects.js';
import { ShipHulls } from '../world/shipHulls.js';
import { NightStreets } from '../systems/nightStreets.js';
import { NightSight } from '../systems/nightSight.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { LightSystem } from './lightSystem.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { NpcDialog } from './npcDialog.js';
import { ConversationScene } from './conversationScene.js';
import { ActionMenu } from './actionMenu.js';
import { settleScene } from './actionMenu/choiceScenes.js';

const NIGHT_SCENES = new Set(['curfew_challenge', 'smuggler_landing', 'night_market']);

const T = 32;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));
const _seed = world => (world && world.generationParams && world.generationParams.seed) || 0;

function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// The art: the lit head of the LPC street lamp as a hand lantern, and a small crate
const LANTERN = { src: 'assets/lpc/Objects/Furniture/Lighting, Outdoors.png', sx: 7, sy: 4, sw: 18, sh: 24 };
const CRATE = { src: 'assets/lpc/Objects/Furniture/Crate.png', sx: 69, sy: 37, sw: 22, sh: 24 };
const _imgs = new Map();
function _img(src) {
    if (typeof Image === 'undefined') return null;
    let im = _imgs.get(src);
    if (!im) { im = new Image(); im.src = src; _imgs.set(src, im); }
    return im.complete && im.naturalWidth ? im : null;
}

/** An NPC's world position, between the cells of its walk. */
function _npcWorld(npc, out) {
    if (npc.state === 'walking' && npc.path && npc.pathIndex < npc.path.length) {
        const t = npc.path[npc.pathIndex];
        const p = _num(npc.moveProgress);
        out.x = npc.q * T + T / 2 + (t.q - npc.q) * T * p;
        out.y = npc.r * T + T / 2 + (t.r - npc.r) * T * p;
    } else {
        out.x = npc.q * T + T / 2;
        out.y = npc.r * T + T / 2;
    }
    return out;
}
const _pos = { x: 0, y: 0 };

export const InnerMapNight = {
    _tiles: null,
    _tick: 0,
    _clock: 0,
    _cfKey: null,
    _walk: null,        // a guard walking up: { npc, left, repath, speed }
    _grace: 0,          // game hours (day * 24 + hour) until the watch stops you again
    _planKey: null,
    _plan: null,
    _landing: null,     // { plan, spot, boat, crates, crew, armed, shore, mode, endAt }
    _market: null,      // { spot, crates, fence, armed, where }
    _noMarketKey: null,
    _noLandingKey: null,

    // ──────────── THE LIGHT ────────────

    /** L on the street map: shutter or light your lantern. */
    toggleLight(game) {
        if (!game || !game.player) return;
        const lit = NightStreets.toggleLight(game.player);
        LightSystem.playerLightDoused = !lit;
        if (game.ui && typeof game.ui.showNotification === 'function') {
            game.ui.showNotification(lit ? '🏮 Lantern lit' : '🌑 Lantern shuttered', lit
                ? 'You see your way, and everyone sees you.'
                : 'In the dark you are hard to see: deeds go unwitnessed, the watch must come close to spot you. (L to light it again)', 'info');
        }
    },

    // ──────────── THE TICK ────────────

    update(dt, game) {
        if (!InnerMap.active || !game || !game.world || !game.player) {
            if (this._tiles) this._teardown();
            NightSight.clear();
            return;
        }
        // (a new street map; stepping into a building and out again keeps the night's folk where they were)
        if (this._tiles !== InnerMap.tiles && !InnerMap._insideBuilding) {
            this._teardown();
            this._tiles = InnerMap.tiles;
            this._sweepStaleBoats();
        }
        if (LightSystem.extraLights !== _nightLights) LightSystem.extraLights = _nightLights;
        const player = game.player;
        const lit = NightStreets.lit(player);
        LightSystem.playerLightDoused = !lit;
        NightStreets.setAmbient(InnerMap._insideBuilding ? 0 : _num(LightSystem.ambientDarkness), lit);
        this._clock += dt;
        if (this._walk) this._driveGuard(dt, game);
        this._tick -= dt;
        if (this._tick > 0) return;
        this._tick = 0.5;
        // A night scene whose panel was closed unanswered: settled now (the challenge: the fine), not left hanging till dawn
        const sc = game._scene;
        if (sc && NIGHT_SCENES.has(sc.kind) && typeof document !== 'undefined' && document.getElementById && !document.getElementById('customPanel')) settleScene(game);

        const world = game.world;
        const wt = InnerMap.currentWorldTile;
        const tile = wt && typeof world.getTile === 'function' ? world.getTile(wt.q, wt.r) : null;
        const s = tile && tile.settlement;
        const day = _num(world.day);
        const hour = _num(InnerMap.timeOfDay, 12);
        // The curfew on the map (read by world/innerMap/nightWatch.js)
        const cfKey = `${wt && wt.q},${wt && wt.r}|${day}`;
        if (this._cfKey !== cfKey) {
            this._cfKey = cfKey;
            const cf = s ? NightStreets.curfew(world, s) : null;
            const C = NightStreets._c('curfew');
            InnerMap._curfew = cf && cf.active ? { from: cf.from, to: cf.to, extraWatch: _num(C.extraWatchShare, 0.5), patrol: _num(C.patrolShare, 0.8), by: cf.by } : null;
        }
        if (!s || InnerMap._insideBuilding) return;
        this._curfewWatch(game, tile, s, day, hour, lit);
        this._landingTick(game, tile, s, day, hour);
        this._marketTick(game, tile, s, day, hour);
    },

    _busy(game) {
        return !!(game._scene || NpcDialog.active || ConversationScene.active || game.player.jailState
            || (typeof document !== 'undefined' && document.getElementById && document.getElementById('npcDialogOverlay')));
    },

    // ──────────── CURFEW ────────────

    _curfewWatch(game, tile, s, day, hour, lit) {
        if (this._walk || !InnerMap._curfew || !InnerMap._curfewNow(hour)) return;
        const now = day * 24 + hour;
        if (now < this._grace || this._busy(game)) return;
        if (NightStreets.exempt(game.player, game.world, s)) return;
        const radius = NightStreets.spotRadius(_num(LightSystem.ambientDarkness), lit);
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const hidden = new Set(StreetCrime.config().sight.hiddenStates || []);
        let best = null;
        for (const n of InnerMap.npcs || []) {
            if (!n || n.type !== 'guard' || hidden.has(n.state) || n.state === 'gone' || n.state === 'unconscious') continue;
            if (n._fight || n._dialogFrozen || n._carried || n._downed || n._doorPost) continue;
            if (InnerMapReactions._responders && InnerMapReactions._responders.has(n.id)) continue;
            const d = _dist(n.q, n.r, pq, pr);
            if (d > radius || (best && d >= best.d)) continue;
            best = { n, d };
        }
        if (!best) return;
        const npc = best.n;
        const C = NightStreets._c('curfew');
        this._walk = { npc, left: _num(C.walkUpSeconds, 30), repath: 0, speed: npc.speed };
        npc.speed = (npc.speed || 1) * _num(C.walkSpeedMult, 1.4);
        npc.departing = false;
        InnerMapReactions.bark(npc, NightStreets.line('halt', `${npc.id}|${day}|${Math.floor(hour * 4)}`) || 'Halt!');
    },

    _releaseGuard(npc, speed) {
        if (!npc) return;
        if (speed) npc.speed = speed;
        npc._dialogFrozen = false;
        npc.path = null;
        if (npc.state === 'walking' || npc.state === 'dialog') npc.state = 'idle';
        npc.idleTimer = 3;
    },

    _driveGuard(dt, game) {
        const w = this._walk;
        const npc = w.npc;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        w.left -= dt;
        if (!npc || npc.state === 'gone' || npc._fight || w.left <= 0 || game.player.jailState || InnerMap._insideBuilding) {
            // (lost you: you are off the street, or out of reach — the watch will look again in a while)
            this._releaseGuard(npc, w.speed);
            this._walk = null;
            this._grace = _num(game.world.day) * 24 + _num(InnerMap.timeOfDay) + 0.5;
            return;
        }
        if (npc.state === 'inside_building') return;
        if (_dist(npc.q, npc.r, pq, pr) <= 1) {
            if (this._busy(game)) return;
            npc.path = null;
            npc.moveProgress = 0;
            npc.state = 'idle';
            npc._dialogFrozen = true;
            npc.facing = InnerMapCharacters.getDirection(pq - npc.q, pr - npc.r);
            this._walk = null;
            const wt = InnerMap.currentWorldTile || {};
            const t = typeof game.world.getTile === 'function' ? game.world.getTile(wt.q, wt.r) : null;
            if (t && t.settlement) NightStreets.noteStop(game.player, t.settlement, game.world.day);
            ActionMenu.showScene(game, 'curfew_challenge', {
                npcId: npc.id, guardName: npc.name || 'A guard of the watch', q: wt.q, r: wt.r,
                lit: NightStreets.lit(game.player), speed: w.speed,
            });
            return;
        }
        w.repath -= dt;
        const walking = npc.path && npc.pathIndex < npc.path.length;
        const end = walking ? npc.path[npc.path.length - 1] : null;
        if (walking && (w.repath > 0 || _dist(end.q, end.r, pq, pr) <= 1)) return;
        w.repath = 0.6;
        const path = InnerMap._findPath(npc.q, npc.r, pq, pr);
        if (!path || path.length < 3) return;
        const step = walking ? npc.path[npc.pathIndex] : null;
        const keep = step && path[1] && path[1].q === step.q && path[1].r === step.r ? npc.moveProgress : 0;
        npc.path = path.slice(1, -1);
        npc.pathIndex = 0;
        npc.moveProgress = keep;
        if (!keep) { npc.prevQ = npc.q; npc.prevR = npc.r; }
        npc.state = 'walking';
        npc._targetBuilding = null;
    },

    /** The challenge answered (ui/actionMenu/nightScenes.js): the guard back to the beat, a grace before the next stop. */
    afterChallenge(game, st, out) {
        const npc = (InnerMap.npcs || []).find(n => n && n.id === st.npcId) || null;
        this._releaseGuard(npc, st.speed);
        const C = NightStreets._c('curfew');
        this._grace = _num(game.world.day) * 24 + _num(InnerMap.timeOfDay) + _num(C.graceHours, 1.5);
        if (!npc || !out) return;
        if (out.outcome === 'fled') InnerMapReactions.bark(npc, NightStreets.line('after_fled', `${npc.id}|fled`) || 'Stop!');
        else if (out.outcome !== 'jailed') InnerMapReactions.bark(npc, NightStreets.line('after_let_go', `${npc.id}|${out.outcome}`) || 'Indoors with you.');
    },

    // ──────────── SMUGGLERS' LANDINGS ────────────

    _landingTick(game, tile, s, day, hour) {
        const world = game.world;
        const L = this._landing;
        if (L) {
            const done = NightStreets.landingDone(game.player, L.plan);
            if (done && !L.endAt) { L.endAt = this._clock + 6; this._sendOff(L.crew, done !== 'joined'); return; }
            if (!NightStreets.landingHour(hour) || L.plan.day !== day || (done && this._clock >= L.endAt)) { this._clearLanding(); return; }
            if (done) return;
            this._crewWork(L);
            const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
            const d = _dist(pq, pr, L.spot.q, L.spot.r);
            const R = _num(NightStreets._c('landings').approachRadius, 3);
            if (d > R + 3) L.armed = true;
            if (L.armed && d <= R && !this._busy(game)) {
                L.armed = false;
                ActionMenu.showScene(game, 'smuggler_landing', { key: L.plan.key, q: tile.q, r: tile.r });
            }
            return;
        }
        if (!NightStreets.landingHour(hour)) return;
        const pk = `${tile.q},${tile.r}|${day}`;
        if (this._planKey !== pk) {
            this._planKey = pk;
            this._plan = NightStreets.landingPlan(world, tile, day);
        }
        if (!this._plan || NightStreets.landingDone(game.player, this._plan) || this._noLandingKey === pk) return;
        if (!this._stageLanding(world, this._plan)) this._noLandingKey = pk;
    },

    /** The live landing's plan (the scene reads it). */
    landing() {
        return this._landing ? this._landing.plan : null;
    },

    /** Note how a landing came out, so the crew goes off (the scene calls it). */
    landingResolved() {
        if (this._landing) this._landing.armed = false;
    },

    /** A quiet shore: dry ground by the water, away from the pier and the town's middle. */
    _findShore(world, key) {
        const tiles = InnerMap.tiles;
        if (!tiles || !tiles.length) return null;
        const H = tiles.length, W = tiles[0].length;
        const A = InnerMap.townArea ? InnerMap.townArea() : null;
        const piers = [];
        for (let r = 0; r < H; r += 2) for (let q = 0; q < W; q += 2) if (tiles[r][q] && tiles[r][q]._pier) piers.push({ q, r });
        const out = [];
        for (let r = 3; r < H - 3; r++) {
            const row = tiles[r];
            for (let q = 3; q < W - 3; q++) {
                const t = row[q];
                if (!t || t._wet || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.customObjectPart || t._pier || t._bridge) continue;
                let water = null;
                for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const n = tiles[r + dr] && tiles[r + dr][q + dq];
                    if (n && n._wet && !n._pier && !n._bridge && !n._ford && n.subTerrain && n.subTerrain.passable === false) { water = n._waterKind || (n._sea ? 'sea' : 'river'); break; }
                }
                if (!water) continue;
                if (piers.some(p => _dist(p.q, p.r, q, r) < 14)) continue;
                if (A && A.center) {
                    const d = Math.hypot(q - A.center.q, r - A.center.r);
                    if (d < A.R * 0.5 || d > A.R * 2.2) continue;
                }
                out.push({ q, r, water });
            }
        }
        if (!out.length) return null;
        return out[Math.floor(_frac(`${key}|shore`) * out.length) % out.length];
    },

    /** Can a hull lie with its anchor here: all of it on open water, none of the pier or a bridge? */
    _boatFits(def, q, r) {
        const tiles = InnerMap.tiles;
        const H = tiles.length, W = tiles[0].length;
        for (const m of ShipHulls.footprint(def)) {
            const x = q + m.localCol, y = r + m.localRow;
            if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
            const t = tiles[y][x];
            if (!t || !t._wet || t._pier || t._bridge || t._ford || t.customObject || t.customObjectPart || !t.subTerrain || t.subTerrain.passable !== false) return false;
        }
        for (const t of def.tiles || []) {
            const x = q + t.localCol, y = r + t.localRow;
            if (x < 0 || y < 0 || x >= W || y >= H) return false;
        }
        return true;
    },

    _stageLanding(world, plan) {
        const key = `${_seed(world)}|${plan.key}`;
        const shore = this._findShore(world, key);
        if (!shore) return false;
        const tiles = InnerMap.tiles;
        // The skiff drawn up as near the spot as it lies
        let boat = null;
        const def = CustomObjects.getDef('hull_skiff');
        if (def && InnerMap._moorShip) {
            search: for (let rad = 1; rad <= 7; rad++) {
                for (let dr = -rad; dr <= rad; dr++) for (let dq = -rad; dq <= rad; dq++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    if (this._boatFits(def, shore.q + dq, shore.r + dr)) { boat = { q: shore.q + dq, r: shore.r + dr }; break search; }
                }
            }
            if (boat) InnerMap._moorShip(tiles, def, boat.q, boat.r, { smugglers: true, label: 'A boat with no lights' });
        }
        // Crates stacked on the dry ground behind the spot
        const crates = [];
        for (let rad = 1; rad <= 3 && crates.length < 3; rad++) {
            for (const [dq, dr] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad], [rad, rad], [-rad, -rad]]) {
                const t = tiles[shore.r + dr] && tiles[shore.r + dr][shore.q + dq];
                if (t && !t._wet && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart && crates.length < 3) crates.push({ q: shore.q + dq, r: shore.r + dr });
            }
        }
        // The crew
        const crew = [];
        let id = (InnerMap.npcs || []).reduce((m, n) => Math.max(m, _num(n.id)), 0) + 1;
        let x = (_frac(`${key}|crew`) * 1e9) >>> 0;
        const rng = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
        for (let i = 0; i < Math.max(1, plan.crew); i++) {
            const npc = InnerMap._makeNpc && InnerMap._makeNpc('villager', id++, rng);
            if (!npc) break;
            const at = crates[i % Math.max(1, crates.length)] || shore;
            const spot = InnerMap._findPassableAdjacentTile(at.q, at.r) || at;
            npc.q = npc.prevQ = npc.targetQ = spot.q;
            npc.r = npc.prevR = npc.targetR = spot.r;
            npc.name = i === 0 ? 'Smugglers\' master' : 'Smuggler';
            npc.roleTitle = 'Smuggler';
            npc._nightFolk = true;
            npc._smuggler = true;
            npc.state = 'idle';
            npc.idleTimer = 999;
            npc.path = null;
            InnerMap.npcs.push(npc);
            crew.push(npc);
        }
        const shoreName = shore.water === 'river' ? 'river bank' : shore.water === 'lake' ? 'lake shore' : (_frac(`${key}|cove`) < 0.5 ? 'cove' : 'beach');
        plan.shore = shoreName;
        this._landing = { plan, spot: shore, boat, crates, crew, armed: true, shore: shoreName, mode: boat ? 'boat' : 'land', endAt: 0, next: 0 };
        return true;
    },

    /** The crew at work: back and forth between the boat and the crates, a word now and then. */
    _crewWork(L) {
        for (const npc of L.crew) {
            if (!npc || npc.state === 'gone') continue;
            if (npc.state === 'idle') npc.idleTimer = 999;
        }
        if (this._clock < L.next) return;
        const k = `${L.plan.key}|${Math.floor(this._clock)}`;
        L.next = this._clock + 3 + _frac(`${k}|next`) * 4;
        const live = L.crew.filter(n => n && n.state === 'idle');
        if (!live.length) return;
        const npc = live[Math.floor(_frac(`${k}|who`) * live.length) % live.length];
        const toBoat = _dist(npc.q, npc.r, L.spot.q, L.spot.r) > 1;
        const target = toBoat ? L.spot : (L.crates[Math.floor(_frac(`${k}|crate`) * L.crates.length)] || L.spot);
        const spot = toBoat ? L.spot : (InnerMap._findPassableAdjacentTile(target.q, target.r) || target);
        if (spot) InnerMap._walkTo(npc, spot);
        if (_frac(`${k}|bark`) < 0.35) InnerMapReactions.bark(npc, NightStreets.line('smugglers', k), 2.5);
    },

    /** Folk of the night go: off to the map's edge (or, run off, at once). */
    _sendOff(list, run) {
        for (const npc of list || []) {
            if (!npc || npc.state === 'gone') continue;
            npc.idleTimer = 2;
            if (run) { InnerMapReactions._flee ? InnerMapReactions._flee(npc, { indoors: false }) : (npc.state = 'gone'); continue; }
            const edge = InnerMap._findNearestEdgeTile ? InnerMap._findNearestEdgeTile(npc.q, npc.r) : null;
            const path = edge ? InnerMap._findPath(npc.q, npc.r, edge.q, edge.r) : null;
            if (!path || path.length < 2) { npc.state = 'gone'; continue; }
            npc.departing = true;
            npc.path = path.slice(1);
            npc.pathIndex = 0;
            npc.moveProgress = 0;
            npc.prevQ = npc.q;
            npc.prevR = npc.r;
            npc.state = 'walking';
        }
    },

    _clearLanding(tiles = InnerMap.tiles) {
        const L = this._landing;
        if (!L) return;
        this._landing = null;
        if (L.boat && tiles && tiles[L.boat.r] && tiles[L.boat.r][L.boat.q]) {
            const o = tiles[L.boat.r][L.boat.q].customObject;
            if (o && o.smugglers && InnerMap._unmoor) InnerMap._unmoor(tiles, L.boat.q, L.boat.r);
        }
        for (const npc of L.crew) if (npc && npc.state !== 'gone' && !npc.departing) npc.state = 'gone';
    },

    /** A skiff left from an earlier night (a map cached, or saved, while it lay there): gone. */
    _sweepStaleBoats() {
        const tiles = InnerMap.tiles;
        if (!tiles || !InnerMap._unmoor) return;
        for (let r = 0; r < tiles.length; r++) {
            const row = tiles[r];
            for (let q = 0; q < row.length; q++) {
                const o = row[q] && row[q].customObject;
                if (o && o.smugglers) InnerMap._unmoor(tiles, q, r);
            }
        }
    },

    // ──────────── THE NIGHT MARKET ────────────

    _marketTick(game, tile, s, day, hour) {
        const world = game.world;
        const M = this._market;
        if (!NightStreets.hasMarket(s) || !NightStreets.marketOpen(hour)) { if (M) this._clearMarket(); return; }
        if (!M) {
            const mk = `${tile.q},${tile.r}|${day}`;
            if (this._noMarketKey === mk) return;
            if (!this._stageMarket(world, tile)) this._noMarketKey = mk;
            return;
        }
        if (M.fence && M.fence.state === 'idle') M.fence.idleTimer = 999;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const d = _dist(pq, pr, M.spot.q, M.spot.r);
        const R = _num(NightStreets._c('market').approachRadius, 2);
        if (d > R + 3) M.armed = true;
        if (M.armed && d <= R && !this._busy(game)) {
            M.armed = false;
            if (M.fence) InnerMapReactions.bark(M.fence, NightStreets.line('market', `${tile.q},${tile.r}|${day}|${Math.floor(this._clock)}`), 2.5);
            ActionMenu.showScene(game, 'night_market', { q: tile.q, r: tile.r, where: M.where, fence: M.fenceName });
        }
    },

    /** Where the market is kept tonight (the panel's hint): the building it hides behind. */
    marketWhere() {
        return this._market ? this._market.where : null;
    },

    _stageMarket(world, tile) {
        const A = InnerMap.townArea ? InnerMap.townArea() : null;
        if (!A || !A.center) return false;
        const types = NightStreets._c('market').alleyTypes || ['warehouse', 'house'];
        const blds = (InnerMap.buildings || []).filter(b => b && !b.isPlayerOwned && !b.isPlayerProperty && types.includes(b.type));
        if (!blds.length) return false;
        // The far side of town from the square: the back alleys
        const far = blds.map(b => ({ b, d: Math.hypot(b.q - A.center.q, b.r - A.center.r) })).sort((a, b) => b.d - a.d);
        const pool = far.slice(0, Math.max(1, Math.ceil(far.length / 3)));
        const key = `${_seed(world)}|market|${tile.q},${tile.r}`;
        const tiles = InnerMap.tiles;
        for (let i = 0; i < pool.length; i++) {
            const b = pool[(Math.floor(_frac(key) * pool.length) + i) % pool.length].b;
            // A quiet cell beside it, off the road if there is one
            let spot = null;
            for (let rad = 1; rad <= 3 && !spot; rad++) {
                for (let dr = -rad; dr <= rad && !spot; dr++) for (let dq = -rad; dq <= rad; dq++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const t = tiles[b.r + dr] && tiles[b.r + dr][b.q + dq];
                    if (!t || t._wet || !t.subTerrain || !t.subTerrain.passable || t.isRoad || t.customObject || t.customObjectPart) continue;
                    if (InnerMap.getBuildingAt && InnerMap.getBuildingAt(b.q + dq, b.r + dr)) continue;
                    spot = { q: b.q + dq, r: b.r + dr };
                    break;
                }
            }
            if (!spot) continue;
            const crates = [];
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [1, 1]]) {
                const t = tiles[spot.r + dr] && tiles[spot.r + dr][spot.q + dq];
                if (t && !t._wet && t.subTerrain && t.subTerrain.passable && !t.isRoad && crates.length < 2) crates.push({ q: spot.q + dq, r: spot.r + dr });
            }
            const fenceName = NightStreets.fenceName(world, tile);
            let fence = null;
            let x = (_frac(`${key}|fence`) * 1e9) >>> 0;
            const rng = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
            const id = (InnerMap.npcs || []).reduce((m, n) => Math.max(m, _num(n.id)), 0) + 1;
            fence = InnerMap._makeNpc ? InnerMap._makeNpc('villager', id, rng) : null;
            if (fence) {
                fence.q = fence.prevQ = fence.targetQ = spot.q;
                fence.r = fence.prevR = fence.targetR = spot.r;
                fence.name = fenceName;
                fence.roleTitle = 'Fence';
                fence._nightFolk = true;
                fence._fence = true;
                fence.state = 'idle';
                fence.idleTimer = 999;
                fence.path = null;
                InnerMap.npcs.push(fence);
            }
            const where = InnerMap.BUILDING_TYPES && InnerMap.BUILDING_TYPES[b.type] && InnerMap.BUILDING_TYPES[b.type].name
                ? `the ${String(InnerMap.BUILDING_TYPES[b.type].name).toLowerCase()}` : `the ${String(b.type).replace(/_/g, ' ')}`;
            this._market = { spot, crates, fence, fenceName, armed: true, where };
            return true;
        }
        return false;
    },

    _clearMarket() {
        const M = this._market;
        if (!M) return;
        this._market = null;
        if (M.fence && M.fence.state !== 'gone') this._sendOff([M.fence], false);
    },

    _teardown() {
        if (this._walk) { this._releaseGuard(this._walk.npc, this._walk.speed); this._walk = null; }
        this._clearLanding(this._tiles);
        const M = this._market;
        this._market = null;
        if (M && M.fence) M.fence.state = 'gone';
        this._tiles = null;
        this._cfKey = null;
        this._planKey = null;
        this._plan = null;
        this._noLandingKey = null;
        this._noMarketKey = null;
        InnerMap._curfew = null;
    },

    // ──────────── DRAWING ────────────

    _drawSprite(ctx, S, x, y, h) {
        const im = _img(S.src);
        if (!im) return;
        const w = Math.max(1, Math.round(S.sw * h / S.sh));
        ctx.drawImage(im, S.sx, S.sy, S.sw, S.sh, Math.round(x - w / 2), Math.round(y - h), w, Math.round(h));
    },

    /** Drawn with the street's sprites (before the night's light falls over them). */
    render(ctx, camera) {
        if (!InnerMap.active || InnerMap._insideBuilding || !camera) return;
        const z = camera.zoom || 1;
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        const dark = _num(LightSystem.ambientDarkness);
        // The watch's lanterns, carried at the hip
        if (dark > 0.2) {
            const b = camera.getVisibleBounds ? camera.getVisibleBounds() : null;
            for (const npc of InnerMap.npcs || []) {
                if (!npc || npc.type !== 'guard' || npc.state === 'inside_building' || npc.state === 'gone' || npc.state === 'unconscious') continue;
                _npcWorld(npc, _pos);
                if (b && (_pos.x < b.left - T || _pos.x > b.right + T || _pos.y < b.top - T || _pos.y > b.bottom + T)) continue;
                const sc = camera.worldToScreenFast(_pos.x + 9, _pos.y + 4);
                this._drawSprite(ctx, LANTERN, sc.x, sc.y, 11 * z);
            }
            // Your own, while it is lit
            if (!LightSystem.playerLightDoused && InnerMap.getPlayerWorldPos) {
                const p = InnerMap.getPlayerWorldPos();
                const sc = camera.worldToScreenFast(p.x + 9, p.y + 4);
                this._drawSprite(ctx, LANTERN, sc.x, sc.y, 11 * z);
            }
        }
        const L = this._landing;
        if (L) {
            for (const c of L.crates) {
                const sc = camera.worldToScreenFast(c.q * T + T / 2, c.r * T + T);
                this._drawSprite(ctx, CRATE, sc.x, sc.y, 20 * z);
            }
            // A shuttered lantern set down on the shore
            const sc = camera.worldToScreenFast(L.spot.q * T + T / 2, L.spot.r * T + T - 2);
            this._drawSprite(ctx, LANTERN, sc.x, sc.y, 10 * z);
        }
        const M = this._market;
        if (M) {
            for (const c of M.crates) {
                const sc = camera.worldToScreenFast(c.q * T + T / 2, c.r * T + T);
                this._drawSprite(ctx, CRATE, sc.x, sc.y, 22 * z);
            }
            // The lantern hung over the cellar door
            const sc = camera.worldToScreenFast(M.spot.q * T + T / 2, M.spot.r * T - 6);
            this._drawSprite(ctx, LANTERN, sc.x, sc.y, 13 * z);
        }
        ctx.imageSmoothingEnabled = smooth;
    },

    /** Lights of the night's street life (LightSystem.extraLights). */
    lights(ls, camera) {
        if (!InnerMap.active || InnerMap._insideBuilding) return;
        const z = camera.zoom || 1;
        const L = this._landing;
        if (L) {
            const sc = camera.worldToScreenFast(L.spot.q * T + T / 2, L.spot.r * T + T / 2);
            ls.addLight(sc.x, sc.y, 42 * z, { r: 255, g: 170, b: 80 }, 0.5, 'torch');
        }
        const M = this._market;
        if (M) {
            const sc = camera.worldToScreenFast(M.spot.q * T + T / 2, M.spot.r * T);
            ls.addLight(sc.x, sc.y, 70 * z, { r: 255, g: 175, b: 85 }, 0.7, 'torch');
        }
    },
};

/** (LightSystem calls this each frame for the night's own lights; set on the first tick) */
function _nightLights(ls, camera) {
    InnerMapNight.lights(ls, camera);
}
