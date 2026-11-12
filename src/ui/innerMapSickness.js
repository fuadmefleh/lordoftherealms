// ============================================
// INNER MAP SICKNESS — the sick, the healer and the dead on the street map
// ============================================
// The street map's half of systems/illness.js, while the player walks a town
// (where the sick and the healer go is world/innerMap/townSickness.js):
//
//   - each walker is marked from their person's sickness (npc._sick: drawn
//     pale by ui/innerMapLayers/entities.js); the sick on their feet cough
//     and sniff as the player passes, the sick abed groan when the player is
//     in the house with them;
//   - the town's healer is flagged (npc._healer) and handed the houses the
//     sick lie in (InnerMap._sickHomes) for their round; at the bedside they
//     say what healers say;
//   - standing close by someone with a catching sickness counts toward the
//     player catching it (`takeContact`, read by ui/game/endDay.js →
//     systems/illnessPlayer.js);
//   - an epidemic: frightened barks, the watch calling the dead out in a
//     plague, the gate guards turning folk back under quarantine; houses
//     with plague in them marked with a red cross on the door (`collect`);
//   - a death in town these two days: the dead's kin and a few neighbours
//     stand at the church door a while, mourning (the jobs' funeral
//     procession may take this over: TODO there).
//
// Lines: data/illness.json → lines. Barks go on npc._bark (drawn by
// ui/innerMapReactions.js). Picks are hashes of the clock and the people,
// never the shared RNG.

import { InnerMap } from '../world/innerMap.js';
import { Illness } from '../systems/illness.js';
import { Townsfolk } from '../systems/townsfolk.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

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

export const InnerMapSickness = {
    _tiles: null,
    _clock: 0,
    _tick: 0,
    _n: 0,
    _next: new Map(),
    // the sick met close today: { [illness]: n }, and whom (npc uid) already counted
    _contact: {},
    _met: new Set(),
    _mourned: new Set(),
    _mourning: [],
    _healDay: -1,
    _healIds: new Set(),

    /** The sick the player stood close by since last asked (endDay reads it, once a day). */
    takeContact() {
        const c = this._contact;
        this._contact = {};
        this._met.clear();
        return c;
    },

    _reset() {
        this._tiles = InnerMap.tiles;
        this._next.clear();
        for (const m of this._mourning) this._release(m);
        this._mourning = [];
        this._healDay = -1;
        InnerMap._sickHomes = [];
        InnerMap._plagueDoors = [];
    },

    _roll(...parts) { return _frac(`${parts.join('|')}|${this._n++}|${Math.floor(this._clock * 10)}`); },

    _bark(npc, text, delay = 0, secs = 3.2) {
        if (!npc || !text) return;
        const now = _now();
        npc._bark = { text, until: now + delay * 1000 + secs * 1000, from: now + delay * 1000 };
    },

    _ready(key, lo = 14, hi = 30) {
        const at = this._next.get(key);
        if (at != null && this._clock < at) return false;
        this._next.set(key, this._clock + lo + this._roll(key, 'cd') * (hi - lo));
        return true;
    },

    _visible(npc) {
        if (!npc || npc.state === 'gone' || npc._dialogFrozen || npc._fight) return false;
        if (npc.state === 'inside_building') {
            const b = InnerMap._insideBuilding;
            return !!b && npc._insideBuildingQ === b.q && npc._insideBuildingR === b.r;
        }
        return !InnerMap._insideBuilding;
    },

    update(dt, game) {
        if (!InnerMap.active || !game || !game.world) return;
        if (this._tiles !== InnerMap.tiles) this._reset();
        const ref = InnerMap._currentWorldTileRef;
        const s = ref && ref.settlement;
        if (!s || !s.folk || !Illness.on()) { InnerMap._sickHomes = []; InnerMap._plagueDoors = []; return; }
        this._clock += dt;
        this._runMourning();
        this._tick -= dt;
        if (this._tick > 0) return;
        this._tick = 1.2 + this._roll('scan') * 1.2;
        const world = game.world;
        const day = _num(world.day, 1);
        const folk = s.folk;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        if (this._healDay !== day) {
            this._healDay = day;
            this._healIds = new Set(Illness.healers(s, world, day).slice(0, 3).map(h => h.person.id));
        }
        const npcs = (InnerMap.npcs || []).filter(n => n._person && n._folk === folk && n.state !== 'gone');
        const homes = new Map();
        const doors = new Map();
        for (const n of npcs) {
            const p = n._person;
            const d = Illness.describe(p, day);
            n._sick = d ? { k: d.k, abed: d.abed } : null;
            n._healer = this._healIds.has(p.id);
            if (d && d.abed && n._home) {
                homes.set(`${n._home.q},${n._home.r}`, n._home);
                if ((Illness.def(d.k) || {}).plague) doors.set(`${n._home.q},${n._home.r}`, n._home);
            }
        }
        InnerMap._sickHomes = [...homes.values()];
        InnerMap._plagueDoors = [...doors.values()];

        const sk = Illness.townSickness(s, day);
        const busy = n => (n._bark && n._bark.until > _now()) || n._mourning;
        for (const n of npcs) {
            if (!this._visible(n)) continue;
            const near = _dist(n, me);
            const p = n._person;
            // Close by someone with a catching sickness
            if (n._sick && near <= 2 && Illness.isContagious(p, day) && !this._met.has(n.uid)) {
                this._met.add(n.uid);
                this._contact[n._sick.k] = _num(this._contact[n._sick.k]) + 1;
            }
            if (near > 14 || busy(n)) continue;
            if (n._sick && !n._sick.abed && this._ready(`c${n.id}`, 8, 20)) {
                this._bark(n, Illness.line('cough', null, `${n.id}|${this._n++}`));
            } else if (n._sick && n._sick.abed && n.state === 'inside_building' && this._ready(`a${n.id}`, 16, 32)) {
                this._bark(n, Illness.line('abed', null, `${n.id}|${this._n++}`));
            } else if (n._healer && n.state === 'inside_building' && homes.has(`${n._insideBuildingQ},${n._insideBuildingR}`) && this._ready(`h${n.id}`, 12, 24)) {
                this._bark(n, Illness.line('healer', null, `${n.id}|${this._n++}`));
            } else if (sk && sk.epi && n.type === 'guard' && n.state !== 'inside_building' && this._ready(`g${n.id}`, 30, 60)) {
                const key = sk.closed && n._post ? 'quarantine' : (Illness.def(sk.k) || {}).plague ? 'dead' : null;
                if (key) this._bark(n, Illness.line(key, null, `${n.id}|${this._n++}`));
            } else if (sk && sk.epi && !n._sick && n.type !== 'guard' && near <= 6 && n.state !== 'inside_building' && this._ready(`f${n.id}`, 40, 80)) {
                this._bark(n, Illness.line('fear', null, `${n.id}|${this._n++}`));
            }
        }
        this._maybeMourn(game, s, folk, day, npcs);
    },

    // ──────────── MOURNERS ────────────

    _maybeMourn(game, s, folk, day, npcs) {
        const hour = _num(InnerMap.timeOfDay, 12);
        if (hour < 9 || hour >= 17 || InnerMap._insideBuilding || this._mourning.length) return;
        // TODO(jobs agent): a funeral procession (world/innerMap/townWork.js) takes over when there is one
        if (InnerMap._funeralOn) return;
        const recent = (folk.annals || []).filter(e => e.k === 'died' && day - _num(e.d) <= 1 && day >= _num(e.d));
        for (const e of recent) {
            const key = `${s.q},${s.r}|${e.a}|${e.d}`;
            if (this._mourned.has(key)) continue;
            this._mourned.add(key);
            const dead = Townsfolk.get(folk, e.a);
            if (!dead) continue;
            const kinIds = new Set([dead.spouse, ...(dead.kids || []), ...(dead.parents || []), ...Townsfolk.siblings(folk, dead).map(x => x.id)].filter(x => x != null));
            const free = n => n.state !== 'inside_building' && !n._dialogFrozen && !n._fight && n.type !== 'guard' && !n._wedding && !n._behindCounter && !n._sick;
            const kin = npcs.filter(n => free(n) && kinIds.has(n._person.id));
            if (!kin.length) continue;
            const church = (InnerMap.buildings || []).find(b => b && (b.type === 'church' || b.type === 'temple' || b.type === 'chapel'));
            if (!church) continue;
            const door = InnerMap._findPassableAdjacentTile(church.q, church.r);
            const others = npcs.filter(n => free(n) && !kinIds.has(n._person.id)).sort((a, b) => _dist(a, door) - _dist(b, door)).slice(0, 3);
            const who = [...kin, ...others];
            const spots = this._ring(door, who.length);
            who.forEach((n, i) => {
                if (!spots[i]) return;
                if (InnerMap._sceneClear) InnerMap._sceneClear(n);
                n._mourning = key;
                n._activity = null;
                n.path = null;
                n.state = 'idle';
                InnerMap._goStand(n, spots[i], 'mourn');
            });
            this._mourning.push({ key, who, until: this._clock + 45, next: this._clock + 6, door, dead });
            if (game.ui && game.ui.showNotification && _dist(door, { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR }) <= 40) {
                game.ui.showNotification('🕯️ Mourning', `${Townsfolk.name(dead)}'s kin gather at the church door — ${dead.cause || 'gone'}.`, 'info');
            }
            return;
        }
    },

    _runMourning() {
        this._mourning = this._mourning.filter(m => {
            if (this._clock >= m.until) { this._release(m); return false; }
            if (this._clock >= m.next) {
                m.next = this._clock + 5 + this._roll(m.key, 'n') * 5;
                const here = m.who.filter(n => n.state === 'idle' && _dist(n, m.door) <= 5 && !(n._bark && n._bark.until > _now()));
                if (here.length) {
                    const n = here[Math.floor(this._roll(m.key, 'w') * here.length) % here.length];
                    this._bark(n, Illness.line('mourn', null, `${m.key}|${this._n++}`));
                }
            }
            return true;
        });
    },

    _release(m) {
        for (const n of m.who || []) {
            if (!n) continue;
            n._mourning = null;
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

    // ──────────── DRAWN ────────────

    /** A red cross painted on the door of each house with plague in it. */
    collect(items, ctx, camera, T) {
        const doors = InnerMap._plagueDoors;
        if (!doors || !doors.length || InnerMap._insideBuilding) return;
        const ds = T * camera.zoom;
        for (const b of doors) {
            const door = InnerMap._findPassableAdjacentTile(b.q, b.r);
            if (!door) continue;
            // (on the house's face, just above the doorstep)
            const fx = (b.q + door.q) / 2 * T + T / 2;
            const fy = (b.r + door.r) / 2 * T + T / 2;
            // (worldToScreenFast hands back a shared object: copy it before the deferred draw)
            const s0 = camera.worldToScreenFast(fx, fy);
            const sc = { x: s0.x, y: s0.y };
            if (sc.x < -ds || sc.y < -ds || sc.x > ctx.canvas.width + ds || sc.y > ctx.canvas.height + ds) continue;
            items.push({ sortY: Math.max(b.r, door.r) * T + T - 0.25, zLayer: 2, draw: () => {
                ctx.save();
                ctx.strokeStyle = 'rgba(176,24,24,0.88)';
                ctx.lineWidth = Math.max(2, ds * 0.09);
                ctx.lineCap = 'round';
                const h = ds * 0.26;
                ctx.beginPath();
                ctx.moveTo(sc.x, sc.y - h); ctx.lineTo(sc.x, sc.y + h);
                ctx.moveTo(sc.x - h * 0.75, sc.y - h * 0.25); ctx.lineTo(sc.x + h * 0.75, sc.y - h * 0.25);
                ctx.stroke();
                ctx.restore();
            } });
        }
    },
};
