// ============================================
// INNER MAP RITES — funeral processions, and the town's word on an absent ruler
// ============================================
// The street map's half of the town's last rites (systems/townWorship.js
// buries the dead off the map, with its mourners, an annal):
//
//   - a death in town these two days (the town's annals: a 'died'), in the
//     daytime hours, with a church in town: the kin (out of the house if
//     they are home), a few neighbours and the priest gather at the dead's
//     house; two bearers lift the bier and walk it to the churchyard, the
//     priest at the head, the mourners behind; at the grave (the dead's own
//     plot, world/innerMap/graves.js; else the churchyard gate, else the
//     church door) a short rite: the priest's words, the mourners' grief;
//     then all go back to their day. While one is on or due,
//     InnerMap._funeralOn is set, so the sick-town mourners at the church
//     door (ui/innerMapSickness.js) stand aside for it;
//   - the ruler in town who sat out the holy day (TownWorship.rulerAbsent:
//     person.mem.missedRuler) hears about it from the devout as they pass.
//
// The bier is drawn between its bearers (collect). Lines: data/
// townWorship.json lines (funeralBier, funeralWalk, funeralRite,
// funeralMourn, rulerAbsentBark). Picks are hashes of the clock and the
// people, never the shared RNG; who walks is held by npc._rite (world/
// innerMap/townLife.js leaves them be).

import { InnerMap } from '../world/innerMap.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownWorship } from '../systems/townWorship.js';
import { GraveBook } from '../world/graveBook.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const CHURCH = ['church', 'temple', 'chapel'];

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export const InnerMapRites = {
    _tiles: null,
    _clock: 0,
    _tick: 0,
    _n: 0,
    _funeral: null,
    _done: new Set(),
    _next: new Map(),

    /** Tuning (data/townWorship.json funerals.onMap), with defaults. */
    config() {
        const F = TownWorship.config().funerals || {};
        return {
            hours: [9, 17], mourners: 8, gatherSecs: 14, walkSecs: 70, riteSecs: 26, pace: 0.6,
            ...(F.onMap && typeof F.onMap === 'object' ? F.onMap : {}),
        };
    },

    _town() {
        const ref = InnerMap._currentWorldTileRef;
        return ref && ref.settlement && ref.settlement.folk ? ref.settlement : null;
    },

    _reset() {
        this._tiles = InnerMap.tiles;
        if (this._funeral) this._release(this._funeral);
        this._funeral = null;
        this._next.clear();
        InnerMap._funeralOn = false;
    },

    _roll(...parts) { return _frac(`${parts.join('|')}|${this._n++}|${Math.floor(this._clock * 10)}`); },

    _bark(npc, text, delay = 0, secs = 3.4) {
        if (!npc || !text) return;
        const now = _now();
        npc._bark = { text, until: now + delay * 1000 + secs * 1000, from: now + delay * 1000 };
    },

    _line(key, salt) {
        const list = (TownWorship.config().lines || {})[key];
        return Array.isArray(list) && list.length ? list[Math.floor(_frac(`${salt}|${this._n++}`) * list.length) % list.length] : '';
    },

    _ready(key, lo, hi) {
        const at = this._next.get(key);
        if (at != null && this._clock < at) return false;
        this._next.set(key, this._clock + lo + this._roll(key, 'cd') * (hi - lo));
        return true;
    },

    update(dt, game) {
        if (!InnerMap.active || !game || !game.world) return;
        if (this._tiles !== InnerMap.tiles && !InnerMap._insideBuilding) this._reset();
        const s = this._town();
        if (!s) { InnerMap._funeralOn = false; return; }
        this._clock += dt;
        const day = _num(game.world.day, 1);
        // A funeral is due (or on) in this town: the church-door mourners stand aside — every frame,
        // so they never step in first (a death these two days in a town with a church is the funeral's)
        const annals = s.folk.annals || [];
        const rk = `${s.q},${s.r}|${day}|${annals.length}`;
        if (this._recentKey !== rk || this._recentTiles !== InnerMap.tiles) {
            this._recentKey = rk;
            this._recentTiles = InnerMap.tiles;
            this._recent = annals.some(e => e && e.k === 'died' && day - _num(e.d) <= 1 && day >= _num(e.d)) && !!this._church();
        }
        InnerMap._funeralOn = !!this._funeral || !!this._recent;
        if (this._funeral) this._run(game, this._funeral, dt);
        this._tick -= dt;
        if (this._tick > 0) return;
        this._tick = 1.5 + this._roll('scan') * 1.5;
        const due = this._dueDeaths(s, day);
        if (!this._funeral && !InnerMap._insideBuilding) this._maybeFuneral(game, s, day, due);
        if (!InnerMap._insideBuilding) this._rulerTalk(game, s, day);
    },

    // ──────────── A FUNERAL ────────────

    /** Deaths in town these two days not yet walked to the grave: [annal entry]. */
    _dueDeaths(s, day) {
        const folk = s.folk;
        return (folk.annals || []).filter(e => e && e.k === 'died' && day - _num(e.d) <= 1 && day >= _num(e.d)
            && !this._done.has(`${s.q},${s.r}|${e.a}|${e.d}`));
    },

    _church() {
        const A = InnerMap.townArea && InnerMap.townArea();
        const list = (InnerMap.buildings || []).filter(b => b && CHURCH.includes(String(b.type).replace(/^player_/, '')));
        if (!list.length) return null;
        return A ? list.sort((a, b) => Math.hypot(a.q - A.center.q, a.r - A.center.r) - Math.hypot(b.q - A.center.q, b.r - A.center.r))[0] : list[0];
    },

    /** Where the dead are laid: their plot in the churchyard, else its gate, else the church door. */
    graveSpot(s, dead) {
        const yard = InnerMap.townYard ? InnerMap.townYard() : null;
        if (yard) {
            const town = GraveBook.townGround(s);
            const i = town && Array.isArray(town.plots) ? town.plots.findIndex(g => g && g.pid === dead.id) : -1;
            if (i >= 0 && yard.plots[i]) return { q: yard.plots[i].q, r: yard.plots[i].r, plot: true };
            if (yard.gate) return { q: yard.gate.q, r: yard.gate.r, plot: false };
        }
        const church = this._church();
        return church ? { ...InnerMap._findPassableAdjacentTile(church.q, church.r), plot: false } : null;
    },

    /** Free to walk in a procession (or at home and awake: they come out of the house). */
    _free(n) {
        if (!n || n.state === 'gone' || n._dialogFrozen || n._fight || n._rite || n._wedding || n._mourning || n._carried) return false;
        if (n.type === 'guard' || n._behindCounter || n._sick || n.departing) return false;
        if (n.state === 'inside_building') {
            const h = n._home;
            return !!(h && n._insideBuildingQ === h.q && n._insideBuildingR === h.r && !(InnerMap._townAbed && InnerMap._townAbed(n)));
        }
        return n.state === 'idle' || n.state === 'walking';
    },

    /** Out of their house onto the step, if they are in. */
    _stepOut(n) {
        if (n.state !== 'inside_building') return;
        n.state = 'idle';
        n.currentBuilding = null;
        n._insideBuildingQ = undefined;
        n._insideBuildingR = undefined;
        if (n._outsideQ != null) { n.q = n.prevQ = n._outsideQ; n.r = n.prevR = n._outsideR; }
        n._outsideQ = undefined;
        n._outsideR = undefined;
    },

    _maybeFuneral(game, s, day, due) {
        const C = this.config();
        const hour = _num(InnerMap.timeOfDay, 12);
        if (hour < C.hours[0] || hour >= C.hours[1] || !due.length) return;
        const church = this._church();
        if (!church) return;
        const folk = s.folk;
        const npcs = (InnerMap.npcs || []).filter(n => n._person && n._folk === folk);
        for (const e of due) {
            const key = `${s.q},${s.r}|${e.a}|${e.d}`;
            const dead = Townsfolk.get(folk, e.a);
            if (!dead) { this._done.add(key); continue; }
            const kinIds = new Set([dead.spouse, ...(dead.kids || []), ...(dead.parents || []), ...Townsfolk.siblings(folk, dead).map(x => x.id)].filter(x => x != null));
            const kin = npcs.filter(n => kinIds.has(n._person.id) && this._free(n));
            if (!kin.length) continue;
            this._done.add(key);
            this._stage(game, s, key, dead, kin, npcs, church);
            return;
        }
    },

    _stage(game, s, key, dead, kin, npcs, church) {
        const C = this.config();
        const home = (kin.find(n => n._home && n._home.type === 'house') || kin.find(n => n._home) || {})._home || church;
        const door = InnerMap._findPassableAdjacentTile(home.q, home.r);
        const grave = this.graveSpot(s, dead) || InnerMap._findPassableAdjacentTile(church.q, church.r);
        const priest = (InnerMap.npcs || []).find(n => this._free(n) && !kin.includes(n)
            && (n.type === 'priest' || (n._person && n._person.job && n._person.job.id === 'priest'))) || null;
        const grown = n => n.type !== 'child' && (!n._person || Townsfolk.age(n._person, _num(InnerMap.worldDay, 1)) >= 16);
        const others = npcs.filter(n => !kin.includes(n) && n !== priest && this._free(n) && n.state !== 'inside_building' && _dist(n, door) <= 30)
            .sort((a, b) => _dist(a, door) - _dist(b, door)).slice(0, Math.max(0, C.mourners - kin.length));
        const all = [...kin, ...others];
        // Two bearers: grown kin first, then grown neighbours
        const bearers = [...all.filter(grown)].slice(0, 2);
        if (bearers.length < 2) return;
        const F = {
            key, dead, home, door, grave, church, priest, bearers, mourners: all.filter(n => !bearers.includes(n)),
            phase: 'gather', t: 0, next: 6, walkAt: C.gatherSecs, ended: false,
        };
        for (const n of [...all, priest].filter(Boolean)) {
            this._stepOut(n);
            if (InnerMap._sceneClear) InnerMap._sceneClear(n);
            n._rite = key;
            n._activity = null;
            n.path = null;
            n.state = 'idle';
            n._ritePace = n._ritePace || n.speed;
        }
        // Gather at the house door
        const spots = this._ring(door, all.length + 1);
        [...bearers, priest, ...F.mourners].filter(Boolean).forEach((n, i) => { if (spots[i]) InnerMap._goStand(n, spots[i], 'rite'); });
        this._funeral = F;
        InnerMap._funeralOn = true;
        if (game.ui && game.ui.showNotification && _dist(door, { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR }) <= 40) {
            game.ui.showNotification('🕯️ A funeral', `${Townsfolk.name(dead)}'s kin gather at the house to walk ${dead.gender === 'female' ? 'her' : 'him'} to the churchyard.`, 'info');
        }
    },

    _run(game, F, dt) {
        const C = this.config();
        F.t += dt;
        if (InnerMap._insideBuilding) return;
        const everyone = [...F.bearers, F.priest, ...F.mourners].filter(Boolean);
        // Anyone taken from it (a fight, the player's talk, gone) drops out; without both bearers it ends
        for (const n of everyone) if (n.state === 'gone' || n._fight || n._dialogFrozen) n._rite = null;
        if (F.bearers.some(b => !b._rite)) { this._end(F); return; }
        if (F.phase === 'gather' && F.t >= F.walkAt) {
            F.phase = 'walk';
            F.walkT = 0;
            // The priest at the head, the bier behind, the mourners after: slowly
            const pace = _num(C.pace, 0.6);
            for (const n of everyone) { if (n._rite) n.speed = (n._ritePace || n.speed) * pace; }
            // (to the ground beside the grave: its mound and marker are not walked on)
            const lead = this._ring(F.grave, 3);
            F.stand = lead[0] || F.grave;
            if (F.priest && F.priest._rite) InnerMap._goStand(F.priest, lead[1] || F.stand, 'rite');
            InnerMap._goStand(F.bearers[0], F.stand, 'rite');
            F.started = this._clock;
            this._bark(F.bearers[0], this._line('funeralBier', F.key), 0.4, 2.6);
        }
        if (F.phase === 'walk') {
            F.walkT += dt;
            const [b0, b1] = F.bearers;
            // The second bearer keeps to the first's heels; the mourners follow on, one by one
            if (b1.state !== 'walking' || F.walkT - (F.followAt || 0) > 1.2) {
                F.followAt = F.walkT;
                const tq = b0.prevQ != null ? b0.prevQ : b0.q, tr = b0.prevR != null ? b0.prevR : b0.r;
                const walking = b1.state === 'walking' && b1.path && b1.pathIndex < b1.path.length;
                const goal = walking ? b1.path[b1.path.length - 1] : null;
                if (_dist(b1, { q: tq, r: tr }) > 0 && (!goal || goal.q !== tq || goal.r !== tr)) {
                    // (a fresh path starts the stride over: mid-step toward the same tile, keep it,
                    // or at the slow pace a bearer re-pathed every beat never takes a step)
                    const next = walking ? b1.path[b1.pathIndex] : null;
                    const keep = walking ? _num(b1.moveProgress) : 0;
                    InnerMap._goStand(b1, { q: tq, r: tr }, 'rite');
                    const first = b1.path && b1.path[0];
                    if (keep && next && first && first.q === next.q && first.r === next.r) b1.moveProgress = keep;
                }
            }
            F.mourners.forEach((n, i) => {
                if (!n._rite || n._riteGo || F.walkT < 2 + i * 0.8) return;
                n._riteGo = true;
                const spots = this._ring(F.grave, F.mourners.length + 4);
                if (spots[i + 3]) InnerMap._goStand(n, spots[i + 3], 'rite');
            });
            F.next -= dt;
            if (F.next <= 0) {
                F.next = 7 + this._roll(F.key, 'w') * 5;
                const near = everyone.filter(n => n._rite && !(n._bark && n._bark.until > _now()));
                if (near.length) this._bark(near[Math.floor(this._roll(F.key, 'who') * near.length) % near.length], this._line(near.length && this._roll(F.key, 'k') < 0.5 ? 'funeralWalk' : 'funeralMourn', F.key), 0, 3);
            }
            const there = _dist(b0, F.stand || F.grave) <= 1 && b0.state !== 'walking';
            if (there || F.walkT >= C.walkSecs) this._beginRite(F);
        }
        if (F.phase === 'rite') {
            F.riteT += dt;
            F.next -= dt;
            if (F.next <= 0) {
                F.next = 5 + this._roll(F.key, 'r') * 4;
                if (F.priest && F.priest._rite && !F.saidRite) {
                    F.saidRite = true;
                    this._bark(F.priest, this._line('funeralRite', F.key), 0, 4.5);
                } else {
                    const near = [...F.bearers, ...F.mourners].filter(n => n._rite && _dist(n, F.grave) <= 5 && !(n._bark && n._bark.until > _now()));
                    if (near.length) this._bark(near[Math.floor(this._roll(F.key, 'm') * near.length) % near.length], this._line('funeralMourn', F.key), 0, 3);
                }
            }
            if (F.riteT >= C.riteSecs) this._end(F);
        }
    },

    _beginRite(F) {
        F.phase = 'rite';
        F.riteT = 0;
        F.next = 1;
        // Round the grave: the priest at its head, the bearers beside it, the mourners about
        const everyone = [F.priest, ...F.bearers, ...F.mourners].filter(n => n && n._rite);
        const spots = this._ring(F.grave, everyone.length + 1);
        everyone.forEach((n, i) => {
            n.speed = n._ritePace || n.speed;
            if (spots[i]) InnerMap._goStand(n, spots[i], 'rite', this._face(spots[i], F.grave));
        });
    },

    _face(from, to) {
        const dq = to.q - from.q, dr = to.r - from.r;
        if (Math.abs(dq) >= Math.abs(dr)) return dq >= 0 ? 3 : 1;
        return dr >= 0 ? 2 : 0;
    },

    _end(F) {
        F.ended = true;
        this._release(F);
        if (this._funeral === F) this._funeral = null;
    },

    _release(F) {
        for (const n of [F.priest, ...F.bearers, ...F.mourners]) {
            if (!n) continue;
            if (n._rite === F.key) n._rite = null;
            n._riteGo = false;
            if (n._ritePace) { n.speed = n._ritePace; n._ritePace = null; }
            if (n.state === 'idle') n.idleTimer = Math.min(n.idleTimer || 0, 2);
        }
    },

    /** Free spots round a point, nearest first: [{ q, r }] */
    _ring(at, n) {
        const out = [];
        for (let rad = 1; rad <= 4 && out.length < n; rad++) {
            for (let dq = -rad; dq <= rad; dq++) {
                for (let dr = -rad; dr <= rad; dr++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const t = InnerMap.tiles && InnerMap.tiles[at.r + dr] && InnerMap.tiles[at.r + dr][at.q + dq];
                    if (!t || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.isWater) continue;
                    out.push({ q: at.q + dq, r: at.r + dr });
                }
            }
        }
        return out;
    },

    // ──────────── THE RULER WHO MISSED THE HOLY DAY ────────────

    _rulerTalk(game, s, day) {
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        for (const n of InnerMap.npcs || []) {
            const m = n._person && n._person.mem;
            if (!m || m.missedRuler == null || day - m.missedRuler > 6 || n.state !== 'idle' || n._rite || (n._bark && n._bark.until > _now())) continue;
            if (_dist(n, me) > 4 || !this._ready(`ra${n.id}`, 60, 120)) continue;
            this._bark(n, this._line('rulerAbsentBark', `${n.id}|${day}`), 0, 3.4);
            return;
        }
    },

    // ──────────── DRAWN ────────────

    /** The bier on its bearers' shoulders while they walk it. */
    collect(items, ctx, camera, T) {
        const F = this._funeral;
        if (!F || F.phase !== 'walk' || InnerMap._insideBuilding) return;
        const pos = (n) => {
            if (n.state === 'walking' && n.path && n.pathIndex < n.path.length) {
                const t = n.path[n.pathIndex];
                const p = _num(n.moveProgress);
                return { x: (n.q + (t.q - n.q) * p) * T + T / 2, y: (n.r + (t.r - n.r) * p) * T + T / 2 };
            }
            return { x: n.q * T + T / 2, y: n.r * T + T / 2 };
        };
        const [b0, b1] = F.bearers;
        const p0 = pos(b0), p1 = pos(b1);
        const close = Math.hypot(p0.x - p1.x, p0.y - p1.y) <= T * 1.6;
        const mid = close ? { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 } : p0;
        const ang = close && (p0.x !== p1.x || p0.y !== p1.y) ? Math.atan2(p0.y - p1.y, p0.x - p1.x) : 0;
        // (copied: worldToScreenFast hands back one shared object, overwritten by the next call before this draws)
        const s0 = camera.worldToScreenFast(mid.x, mid.y - T * 0.95);
        const sc = { x: s0.x, y: s0.y };
        const ds = T * camera.zoom;
        if (sc.x < -ds * 2 || sc.y < -ds * 2 || sc.x > ctx.canvas.width + ds * 2 || sc.y > ctx.canvas.height + ds * 2) return;
        items.push({ sortY: Math.max(p0.y, p1.y) + T * 0.6, zLayer: 2, draw: () => {
            ctx.save();
            ctx.translate(sc.x, sc.y);
            ctx.rotate(ang);
            const L = ds * 1.25, W = ds * 0.34;
            // the plank, its handles, the shrouded body on it
            ctx.fillStyle = '#5b3a21';
            ctx.fillRect(-L / 2 - ds * 0.12, -W * 0.18, L + ds * 0.24, W * 0.36);
            ctx.fillStyle = '#6e4a2c';
            ctx.fillRect(-L / 2, -W / 2, L, W);
            ctx.fillStyle = '#e9e4d6';
            ctx.beginPath();
            ctx.ellipse(0, -W * 0.08, L * 0.44, W * 0.4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(70,60,50,0.55)';
            ctx.lineWidth = Math.max(1, ds * 0.03);
            ctx.stroke();
            ctx.restore();
        } });
    },
};
