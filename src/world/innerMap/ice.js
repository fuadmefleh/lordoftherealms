// ============================================
// InnerMap — winter ice cell by cell: thin and solid, skating, holes kept
// ============================================
// world/innerMap/streetSeasons.js freezes the street map's water by the
// day's ice (world/streetSeasons.js). This file makes that ice differ from
// cell to cell, and gives it to the player to skate on:
//
//   • Thin and solid, by the cell (_iceLocalGrid, asked by _reconcileIce):
//     the ice is thinner over a river's running channel than beside its
//     banks, beside open water (the sea, a hole broken through, water not
//     frozen over yet) and in a warm spell, with a hashed patchiness — so a
//     pond may bear you in the middle of winter and not at its mouth, and
//     the first and last weeks of the frost (the ice itself thin) show a
//     dark, cracked border of thin ice round a frozen middle.
//   • Holes kept (_iceBind, _iceRecordHole): a hole the player broke is kept
//     on the world (world.iceHoles: { "hexQ,hexR": { "q,r": day } }, saved),
//     open `ice.holeRefreezeDays`, then skinned over with thin ice
//     `winterIce.holes.thinDays` more — though the street map is dealt again.
//   • Skating (_iceStepped, _icePace, _iceTick, called by the walk:
//     movement.js updatePlayer and streetSeasons.js _iceStep): with skates
//     (InnerMap._iceGear, set each frame by ui/innerMapIce.js from the
//     player's packs) the player gathers speed over solid ice, loses some
//     of it in a turn, and glides on a cell or two past where the walk ends.
//     On foot, or on thin ice, they may slip and go down a moment. A horse
//     balks at thin ice; a full pack, a cart or a horse make thin ice likelier
//     to break (_iceCrackMult).
//   • Townsfolk skate on solid ice of a winter afternoon (_iceSkatePick /
//     _iceSkateArrived, from the season's call: streetSeasons.js _seasonPick).
//
// Gameplay rolls draw from Utils (seeded); the patchiness is a hash. What the
// cold water and a fall do to the player is player/icyWater.js; the look is
// ui/innerMapLayers/ice.js. Data: data/streetSeasons.json `winterIce`.

import { InnerMap } from './_ref.js';
import { Utils } from './_imports.js';
import { StreetSeasons, ssHash, ssStrHash } from '../streetSeasons.js';

const DEFAULTS = {
    local: { riverChannel: 0.4, riverBank: 0.7, openEdge: 0.25, openEdge2: 0.1, warmPerDegree: 0.03, jitter: 0.05, refrozenStrength: 0.2 },
    holes: { thinDays: 3 },
    skating: {
        skates: { iron_skates: { top: 2.0, slipSkates: 0.004 }, bone_skates: { top: 1.65, slipSkates: 0.012 } },
        accel: 0.9, turnKeep: 0.55, glideCells: 2, glideAt: 1.25,
        slip: 0.04, slipThin: 0.06, slipPerSpeed: 0.03, fallSeconds: 1.4, fallHealth: 1, fallComfort: -3,
    },
    load: { ladenAbove: 0.5, laden: 1.0, cart: 2.5, horse: 3.0, horseRefusesThin: true },
    plunge: { shockHealth: 3, shockComfort: -10, healthPerSecond: 1.1, energyPerSecond: 0.8, comfortPerSecond: -1.0, warnEvery: 6, chillAfter: 4, chillAilment: 'chill' },
    townSkating: { hours: [12, 17], share: {}, hops: [3, 6], radius: 40, lines: [] },
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/** The kind of water a sub-terrain is (as world/innerMap/streetSeasons.js reads it). */
function _waterKind(sub) {
    const id = String((sub && sub.id) || '');
    if (/sea|ocean/.test(id)) return 'sea';
    if (/river|stream/.test(id)) return 'river';
    if (/lake/.test(id)) return 'lake';
    return 'pond';
}

let _cfg = null, _cfgSrc;

export const WinterIce = {
    /** data/streetSeasons.json `winterIce` over the defaults, section by section. */
    config() {
        const src = StreetSeasons.config().winterIce;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = {};
            for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            out.skating.skates = { ...(_obj(d.skating && d.skating.skates) || DEFAULTS.skating.skates) };
            _cfg = out;
        }
        return _cfg;
    },

    /**
     * How thick the ice is on one cell: the water's ice (st.ice, world/streetSeasons.js)
     * by its kind, less what the cell's place takes off it.
     * at: { kind, channel (a river's running water, not by its bank), open (0 none, 1
     * open water beside, 2 two off), jitter 0..1 (a hash), celsius }
     */
    cellThickness(st, at = {}) {
        if (!st) return 0;
        const L = WinterIce.config().local;
        const I = StreetSeasons.config().ice;
        const kind = at.kind || 'pond';
        if (kind === 'sea') return 0;
        let rate = 1;
        if (kind === 'river') rate = at.channel ? _num(L.riverChannel, 0.4) : _num(L.riverBank, _num(I.riverRate, 0.45));
        let eff = _num(st.ice) * rate;
        if (at.open === 1) eff -= _num(L.openEdge, 0.25);
        else if (at.open === 2) eff -= _num(L.openEdge2, 0.1);
        eff -= Math.max(0, _num(at.celsius, _num(st.celsius))) * _num(L.warmPerDegree, 0.03);
        if (at.jitter != null) eff += (_num(at.jitter, 0.5) - 0.5) * 2 * _num(L.jitter, 0.05);
        return Math.max(0, eff);
    },

    /** Ice of this thickness → { state: 'none' | 'thin' | 'solid', strength 0..1 } (StreetSeasons.iceOn's thresholds). */
    classify(eff, thawing = false) {
        const I = StreetSeasons.config().ice;
        const thin = _num(I.thin, 0.22), solid = _num(I.solid, 0.55);
        if (eff < thin) return { state: 'none', strength: 0 };
        const strength = _clamp((eff - thin) / Math.max(0.01, solid - thin), 0, 1);
        if (eff >= solid && !(thawing && eff < _num(I.rottenBelow, 0.75))) return { state: 'solid', strength: 1 };
        return { state: 'thin', strength: eff >= solid ? 0.6 : strength * 0.9 };
    },

    /** The skates' settings for the pair the player has (gear.skates: an item id), or null. */
    skatesOf(gear) {
        const id = gear && gear.skates;
        const s = id ? WinterIce.config().skating.skates[id] : null;
        return s ? { id, top: _num(s.top, 1.6), slipSkates: _num(s.slipSkates, 0.01) } : null;
    },

    /** The chance a step on ice (iced 1 thin, 2 solid) throws you down, at speed v (× a walk). */
    slipChance(gear, iced, v = 1) {
        const S = WinterIce.config().skating;
        const sk = WinterIce.skatesOf(gear);
        const base = sk && iced === 2 ? sk.slipSkates : iced === 1 ? _num(S.slipThin, 0.06) : _num(S.slip, 0.04);
        return _clamp(base + Math.max(0, v - 1) * _num(S.slipPerSpeed, 0.03) * (sk ? 0.3 : 1), 0, 1);
    },

    /** × the chance thin ice breaks, for what the player brings onto it. */
    crackMult(gear, riding = false) {
        const Ld = WinterIce.config().load;
        let m = 1;
        const laden = _num(gear && gear.laden);
        const above = _num(Ld.ladenAbove, 0.5);
        if (laden > above) m += (laden - above) / Math.max(0.01, 1 - above) * _num(Ld.laden, 1);
        if (gear && gear.cart) m += _num(Ld.cart, 2.5);
        if (riding) m += _num(Ld.horse, 3);
        return m;
    },
};

Object.assign(InnerMap, {
    /** What the player brings onto the ice (ui/innerMapIce.js, each frame): { skates, laden 0..1, cart } */
    _iceGear: null,
    /** The skater's way: { v (× a walk), dq, dr, glideFrom (the path index the glide starts at) } */
    _skate: null,
    /** Seconds still down after a fall on the ice */
    _iceDown: 0,
    _iceWorld: null,
    _iceHex: null,
    _iceSolid: null,

    // ──────────── HOLES KEPT ON THE WORLD ────────────

    /** This hex's holes from the world, on a new map or a new day (_bindStreetSeason). */
    _iceBind(world, hq, hr, day) {
        this._iceWorld = world || null;
        this._iceHex = `${hq},${hr}`;
        if (!world || !this.tiles) return;
        const I = StreetSeasons.config().ice;
        const open = Math.max(0, _num(I.holeRefreezeDays, 3));
        const keep = open + Math.max(0, _num(WinterIce.config().holes.thinDays, 3));
        const all = world.iceHoles;
        if (!_obj(all)) return;
        for (const hk of Object.keys(all)) {
            const book = all[hk];
            for (const k of Object.keys(book || {})) if (!(day - book[k] < keep) || book[k] > day) delete book[k];
            if (!book || !Object.keys(book).length) delete all[hk];
        }
        const book = all[this._iceHex];
        if (!book) return;
        for (const [k, d] of Object.entries(book)) {
            const [q, r] = k.split(',').map(Number);
            const t = this.tiles[r] && this.tiles[r][q];
            if (t && t._ssHole == null && day - d < open) t._ssHole = d;
        }
    },

    /** A hole broken at (q, r) on `day`: kept on the world (_breakIce). */
    _iceRecordHole(q, r, day) {
        const w = this._iceWorld;
        if (!w || !this._iceHex || this._insideBuilding) return;
        if (!_obj(w.iceHoles)) w.iceHoles = {};
        const book = w.iceHoles[this._iceHex] || (w.iceHoles[this._iceHex] = {});
        book[`${q},${r}`] = _num(day);
    },

    /** The day a hole was broken at (q, r) on this hex, or null. */
    _iceHoleDay(q, r) {
        const w = this._iceWorld;
        const book = w && _obj(w.iceHoles) ? w.iceHoles[this._iceHex] : null;
        const d = book ? book[`${q},${r}`] : null;
        return d == null ? null : _num(d);
    },

    // ──────────── THIN AND SOLID, CELL BY CELL ────────────

    /**
     * Today's ice for every water cell (_reconcileIce): Map tile → { state, strength }.
     * Open water first (the sea, holes, water too warm to freeze), then each cell's
     * thickness less its place (a river's channel, open water beside it, the warmth).
     */
    _iceLocalGrid(ss, day) {
        const tiles = this.tiles;
        if (!ss || !tiles || !tiles.length) return null;
        const H = tiles.length, W = tiles[0].length;
        const I = StreetSeasons.config().ice;
        const L = WinterIce.config().local;
        const open = Math.max(0, _num(I.holeRefreezeDays, 3));
        const thinDays = Math.max(0, _num(WinterIce.config().holes.thinDays, 3));
        const seed = ssStrHash(this._iceHex || '') ^ Math.floor(_num(day) / 7);
        const thinAt = _num(I.thin, 0.22);
        const cells = [];
        const openIdx = new Uint8Array(W * H);
        for (let r = 0; r < H; r++) {
            const row = tiles[r];
            for (let q = 0; q < W; q++) {
                const t = row[q];
                if (!t) continue;
                const orig = t._ssOrigSub || t.subTerrain;
                const wet = t._ssOrigSub || t._wet || (orig && /_water$/.test(orig.id || ''));
                if (!wet || t._bridge || t._deck || t._pier || t._isInterior || t.customBuilding || t.customBuildingPart) continue;
                if (!t._ssOrigSub && orig && /frozen|ice|glacier/.test(orig.id || '')) continue;
                const kind = t._waterKind === 'river' ? 'river' : _waterKind(orig);
                const channel = kind === 'river' && !!(t._flow && (t._flow.x || t._flow.y)) && !this._iceBesideLand(q, r);
                const at = { kind, channel, jitter: ssHash(q, r, seed, 31), celsius: ss.celsius };
                const eff = WinterIce.cellThickness(ss, at);
                const hole = t._ssHole != null && day - t._ssHole < open;
                if (kind === 'sea' || hole || eff < thinAt) openIdx[r * W + q] = 1;
                cells.push({ t, q, r, at });
            }
        }
        const out = new Map();
        const solid = [];
        for (const c of cells) {
            const { t, q, r, at } = c;
            // open water beside (1) or two off (2)
            let near = 0;
            for (let dr = -2; dr <= 2 && near !== 1; dr++) {
                for (let dq = -2; dq <= 2; dq++) {
                    const d = Math.abs(dq) + Math.abs(dr);
                    if (!d || d > 2) continue;
                    const nq = q + dq, nr = r + dr;
                    if (nq < 0 || nr < 0 || nq >= W || nr >= H || !openIdx[nr * W + nq]) continue;
                    if (d === 1) { near = 1; break; }
                    near = 2;
                }
            }
            at.open = near;
            let ice = WinterIce.classify(WinterIce.cellThickness(ss, at), !!ss.thawing);
            // a hole broken lately, skinned over again: thin a few days more
            const hd = this._iceHoleDay(q, r);
            if (ice.state === 'solid' && hd != null && day - hd >= open && day - hd < open + thinDays) {
                ice = { state: 'thin', strength: _num(L.refrozenStrength, 0.2) };
            }
            out.set(t, ice);
            if (ice.state === 'solid') solid.push({ q, r });
        }
        this._iceSolid = solid;
        return out;
    },

    /** Is ground you can stand on beside this water cell (a bank, not a bridge)? */
    _iceBesideLand(q, r) {
        for (const [dq, dr] of N4) {
            const n = this.tiles[r + dr] && this.tiles[r + dr][q + dq];
            if (n && !n._wet && !n._ssOrigSub && n.subTerrain && n.subTerrain.passable && !n._bridge) return true;
        }
        return false;
    },

    // ──────────── SKATING AND SLIPPING ────────────

    /** The skater's state (made on first use). */
    _skateState() {
        return this._skate || (this._skate = { v: 1, dq: 0, dr: 0, glideFrom: null });
    },

    /** Seconds pass (ui/innerMapIce.js, each frame): back up after a fall. */
    _iceTick(dt) {
        if (this._iceDown > 0) this._iceDown = Math.max(0, this._iceDown - Math.max(0, _num(dt)));
    },

    /** Is the player gliding on their skates now (the walk carried on past where it ended)? */
    _iceGliding() {
        const s = this._skate;
        return !!(s && s.glideFrom != null && this._playerWalking && this._playerPathIndex >= s.glideFrom);
    },

    /** Down on the ice. */
    _iceFall() {
        const S = WinterIce.config().skating;
        this._iceDown = Math.max(0.2, _num(S.fallSeconds, 1.4));
        const s = this._skateState();
        s.v = 1;
        s.glideFrom = null;
    },

    /**
     * × the walk's speed toward `next` this frame (movement.js updatePlayer): 0 while
     * down after a fall or while a horse balks at thin ice, a skater's gathering speed
     * over solid ice, else 1.
     */
    _icePace(next, dt = 0) {
        if (this._iceDown > 0) return 0;
        const s = this._skate;
        if (!next || this._insideBuilding) { if (s) s.v = 1; return 1; }
        const cur = this.tiles && this.tiles[this.playerInnerR] && this.tiles[this.playerInnerR][this.playerInnerQ];
        const nt = this.tiles && this.tiles[next.r] && this.tiles[next.r][next.q];
        if (!(cur && cur._iced) && !(nt && nt._iced)) { if (s) { s.v = 1; s.glideFrom = null; } return 1; }
        // A horse will not go onto thin ice (ui/innerMapIce.js stops the walk and says so)
        if (this._rideSpeed > 0) {
            if (nt && nt._iced === 1 && WinterIce.config().load.horseRefusesThin) {
                if (!this._ssEvent || this._ssEvent.kind !== 'balk') this._ssEvent = { kind: 'balk', q: next.q, r: next.r, at: _now() };
                return 0;
            }
            return 1;
        }
        const sk = WinterIce.skatesOf(this._iceGear);
        const st = this._skateState();
        if (!sk || !(nt && nt._iced === 2)) { st.v = 1; return 1; }
        const S = WinterIce.config().skating;
        st.v = Math.min(sk.top, st.v + Math.max(0, _num(dt)) * _num(S.accel, 0.9));
        return st.v;
    },

    /**
     * The player stepped onto (q, r) (from _iceStep): the skater's turn, a slip, a
     * glide on past the walk's end. → { kind: 'slip' } when they go down, else null.
     */
    _iceStepped(q, r, t) {
        const s = this._skateState();
        if (!t || !t._iced || this._underwater) { s.v = 1; s.dq = 0; s.dr = 0; s.glideFrom = null; return null; }
        const S = WinterIce.config().skating;
        const dq = Math.sign(q - _num(this._playerPrevQ, q)), dr = Math.sign(r - _num(this._playerPrevR, r));
        // A turn loses some of the speed (a gentle one less than a sharp one)
        if ((s.dq || s.dr) && (dq !== s.dq || dr !== s.dr)) {
            const dot = dq * s.dq + dr * s.dr;
            const keep = dot > 0 ? (1 + _num(S.turnKeep, 0.55)) / 2 : _num(S.turnKeep, 0.55) * (dot < 0 ? 0.5 : 1);
            s.v = 1 + (s.v - 1) * keep;
        }
        s.dq = dq; s.dr = dr;
        if (this._rideSpeed > 0) return null;
        if (Utils.random() < WinterIce.slipChance(this._iceGear, t._iced, s.v)) {
            this._iceFall();
            return { kind: 'slip', q, r, at: _now() };
        }
        // The walk's last step at speed on skates: glide on a cell or two
        const path = this._playerPath;
        const last = path && this._playerPathIndex >= path.length;
        if (last && t._iced === 2 && !this._pendingAction && (dq || dr) && WinterIce.skatesOf(this._iceGear)) {
            const sk = WinterIce.skatesOf(this._iceGear);
            const glideAt = _num(S.glideAt, 1.25);
            if (s.v >= glideAt) {
                const n = Math.round(_clamp((s.v - 1) / Math.max(0.01, sk.top - 1), 0, 1) * Math.max(0, _num(S.glideCells, 2)));
                const from = path.length;
                let pq = q, pr = r;
                for (let k = 1; k <= n; k++) {
                    const nq = q + dq * k, nr = r + dr * k;
                    const nt = this.tiles[nr] && this.tiles[nr][nq];
                    if (!nt || nt._iced !== 2 || !this._playerMayEnter(nt, nq, nr) || this._stepBlocked(pq, pr, nq, nr)) break;
                    if ((this.npcs || []).some(o => o.q === nq && o.r === nr && o.state !== 'gone')) break;
                    path.push({ q: nq, r: nr });
                    pq = nq; pr = nr;
                }
                if (path.length > from) s.glideFrom = from;
            }
        } else if (!this._iceGliding()) {
            s.glideFrom = null;
        }
        return null;
    },

    /** × the chance thin ice gives way under the player now (_iceStep). */
    _iceCrackMult() {
        return WinterIce.crackMult(this._iceGear, this._rideSpeed > 0);
    },

    // ──────────── TOWNSFOLK ON THE ICE ────────────

    /** A winter afternoon: off to skate on the town's solid ice (from _seasonPick). → true when off. */
    _iceSkatePick(npc, period) {
        const ss = this._ss;
        const list = this._iceSolid;
        if (!ss || !ss.solidCells || !list || !list.length || npc.type === 'guard') return false;
        const C = WinterIce.config().townSkating;
        const h = _num(this.timeOfDay, 12);
        if (!StreetSeasons.inHours(h, C.hours)) return false;
        const rnd = Utils.random;
        const going = npc._skateHops > 0;
        if (!going && !(rnd() < _num((C.share || {})[npc.type], 0))) return false;
        const R = Math.max(4, _num(C.radius, 40));
        const from = going ? npc : ((this.townArea && this.townArea()) || {}).center || npc;
        for (let i = 0; i < 14; i++) {
            const c = list[Math.floor(rnd() * list.length)];
            const t = this.tiles[c.r] && this.tiles[c.r][c.q];
            if (!t || t._iced !== 2) continue;
            if (Math.max(Math.abs(c.q - from.q), Math.abs(c.r - from.r)) > (going ? 12 : R)) continue;
            if ((this.npcs || []).some(o => o !== npc && o.q === c.q && o.r === c.r)) continue;
            if (!going) {
                const [a, b] = Array.isArray(C.hops) ? C.hops : [3, 6];
                npc._skateHops = Math.max(1, Math.round(_num(a, 3) + rnd() * (_num(b, 6) - _num(a, 3))));
            }
            if (this._goStand(npc, c, 'ss_skate', null)) return true;
        }
        if (going) npc._skateHops = 0;
        return false;
    },

    /** Arrived on the ice (from _seasonArrived): skating there a moment, then on across it. */
    _iceSkateArrived(npc) {
        const cfg = StreetSeasons.config();
        const C = WinterIce.config().townSkating;
        const rnd = Utils.random;
        const [a, b] = Array.isArray((cfg.stay || {}).ss_skate) ? cfg.stay.ss_skate : [3, 7];
        npc.activity = { type: 'season', icon: '⛸️', label: 'Skating on the ice', anim: rnd() < 0.25 ? 'emotes' : 'idle' };
        npc.idleTimer = _num(a, 3) + rnd() * (_num(b, 7) - _num(a, 3));
        npc._skateHops = Math.max(0, _num(npc._skateHops) - 1);
        const near = Math.max(Math.abs(npc.q - _num(this.playerInnerQ, -99)), Math.abs(npc.r - _num(this.playerInnerR, -99))) <= 20;
        const lines = Array.isArray(C.lines) ? C.lines : [];
        if (near && lines.length && rnd() < 0.3) {
            const now = _now();
            npc._bark = { text: lines[Math.floor(rnd() * lines.length)], from: now + rnd() * 1200, until: now + 3800 };
        }
    },
});
