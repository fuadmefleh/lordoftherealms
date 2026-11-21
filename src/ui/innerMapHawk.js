// ============================================
// INNER MAP HAWK — hawking on the street map, visibly
// ============================================
// Your hawk (systems/animalCompanions.js) rides your gloved fist as you walk
// the street map — drawn on your arm in all four facings, and in the saddle
// too (ui/innerMapPets.js drawRider) — instead of wheeling overhead (it can
// still be cast off to wheel: "Cast the Hawk Off to Wheel Overhead").
// Right-click a small wild beast or bird within range (data/falconry.json
// quarry: rabbits, hares, pheasants, wild ducks, a fox) and "Fly the Hawk at
// the rabbit": it launches off the glove, wings beating, climbs and circles
// over the quarry, then stoops in a fast dive, its shadow racing it across
// the ground — and either binds to it (the beast killed where it sat: a real
// carcass, InnerMap.killAnimal; the hawk mantles over it, wings spread, till
// you walk up and take it — its reward off the kill, the carcass over your
// shoulder) or misses (the quarry bolts, the hawk throws up and comes back to
// the fist). A hungry or green hawk may rake away instead and take stand in a
// tree, to be lured down with meat from your packs. "Call the Hawk" brings it
// back to the glove whenever it is out (not mid-stoop). The rules — chances,
// rake-away, lure, the reward, the day's marks that keep the abstract daily
// hunting from double-dipping — are systems/falconry.js; this flies and draws it.
//
// The hawk is drawn here as procedural pixel art (no sheet): perched in four
// facings, mantling, flying from above in a four-frame wing beat, and folded
// in the stoop, in its breed's colours (a goshawk's brown and barred breast,
// a peregrine's slate and moustache).
//
//   update(dt, game)                 its flight (game/gameLoop.js, after InnerMapPets.update)
//   collect(items, ctx, camera, T, facing)   into the depth-sorted pass (innerMapLayers/entities.js)
//   menuItems(game, q, r) / handle(game, item)   hawk_* (innerMapUI.js)

import { InnerMap } from '../world/innerMap.js';
import { InnerMapBattle } from './innerMapBattle.js';
import { InnerMapPets } from './innerMapPets.js';
import { InnerMapAnimals } from './innerMapAnimals.js';
import { InnerMapCarry } from './innerMapCarry.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapCarts } from './innerMapCarts.js';
import { Falconry } from '../systems/falconry.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { Hunting } from '../player/foraging.js';
import { CustomObjects } from '../world/customObjects.js';

const T_PX = 32;
const FIST_ALT = 30;   // world px above the ground the glove is held
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _notify = (game, title, body, kind = 'info') => {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
};
const _lower = (sp, a) => String((sp && sp.name) || (a && a.species) || 'beast').toLowerCase();
/** The render clock in seconds (drawing only). */
const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;

// ── The pixel art ──
// '.' empty; letters from the breed's palette. Each sprite is outlined ('k') where it meets the empty.
const PAL = {
    goshawk: { D: '#4b3c30', M: '#6e5a48', L: '#9a8268', B: '#e8dfcc', b: '#8a6d55', y: '#e3b23c', e: '#d4651c', m: '#352a21', k: '#1e1712' },
    falcon: { D: '#3e4652', M: '#5d6878', L: '#8e98a6', B: '#efe6d4', b: '#4f545e', y: '#e8c040', e: '#20160f', m: '#22272f', k: '#15171c' },
};
const GLOVE = { g: '#8b5a2b', G: '#5c3a1a', h: '#c9a777', k: '#2a1a0c' };

const PERCH = {
    down: [
        '...mmm...',
        '..mDDDm..',
        '..DeDeD..',
        '..DByBD..',
        '.MBBbBBM.',
        '.MBbBbBM.',
        'MMBBBBBMM',
        'MMBbBbBMM',
        'MMBBbBBMM',
        '.MBbBbBM.',
        '.MLBBBLM.',
        '..LLDLL..',
        '...LDL...',
        '...LDL...',
        '...y.y...',
    ],
    up: [
        '...mmm...',
        '..mDDDm..',
        '..DDDDD..',
        '..DDDDD..',
        '.MDDDDDM.',
        '.MMDDDMM.',
        'MMLMDMLMM',
        'MMMLDLMMM',
        'MMMMDMMMM',
        '.MMMDMMM.',
        '.MMLDLMM.',
        '..LLDLL..',
        '...LDL...',
        '...LDL...',
        '...y.y...',
    ],
    right: [
        '.....mmm..',
        '....mDDDm.',
        '....DDDeDy',
        '....mDDBym',
        '...MDDBBb.',
        '..MMMDBBB.',
        '..MLMMBbB.',
        '.MMMLMBBB.',
        '.MMMMLBbB.',
        '.MLMMMBBB.',
        'MMMLMMBB..',
        'LLMMMM....',
        'LLL.yy....',
        'LL........',
        'L.........',
    ],
};
PERCH.left = PERCH.right.map(r => r.split('').reverse().join(''));

const MANTLE = [
    '......mmm......',
    '.....mDeDy.....',
    '....MDDDDDM....',
    '..MMMDBBBMMMM..',
    '.MMLMMBbBMMLMM.',
    'MMLMMMBBBMMMLMM',
    'MLMLMMBbBMMLMLM',
    'LML.MMBBBMM.LML',
    'L.L..yy.yy..L.L',
];

const GLOVE_ART = {
    // the gauntlet's cuff and the fist, a jess hanging
    fist: ['.gg.', 'gGGg', 'gggg', '.hG.', '.h..'],
};

/** A hawk seen from above, head up: wings at a share of their span, tips drooped on the downstroke. */
function _flyArt(span, droop = 0, folded = false) {
    const W = 25, H = 14, c = 12;
    const g = Array.from({ length: H }, () => Array(W).fill('.'));
    const put = (x, y, ch) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = ch; };
    put(c, 0, 'm');
    for (let x = c - 1; x <= c + 1; x++) put(x, 1, x === c ? 'm' : 'D');
    for (let y = 2; y <= 8; y++) for (let x = c - 1; x <= c + 1; x++) put(x, y, x === c ? 'D' : 'M');
    const tail = [[9, 1], [10, 2], [11, 2], [12, 1]];
    for (const [y, hw] of tail) for (let x = c - hw; x <= c + hw; x++) put(x, y, (y === 10 || y === 12) && x !== c ? 'M' : 'L');
    if (folded) {
        // wings drawn in tight along the body: a dart
        for (let y = 3; y <= 10; y++) { put(c - 2, y, y < 9 ? 'M' : 'D'); put(c + 2, y, y < 9 ? 'M' : 'D'); }
        put(c - 2, 11, 'D'); put(c + 2, 11, 'D');
        return g.map(r => r.join(''));
    }
    const n = Math.max(2, Math.round(10 * span));
    for (let i = 1; i <= n; i++) {
        const outer = i > n - 3;
        const lead = 3 + Math.floor(i * 0.18) + (outer ? droop : 0);
        const depth = Math.max(2, 5 - Math.floor(i * 0.3));
        for (const side of [-1, 1]) {
            const x = c + side * (1 + i);
            for (let k = 0; k < depth; k++) {
                const y = lead + k;
                // the primaries splay at the tip: fingers
                if (i === n && k % 2 === 1) continue;
                put(x, y, k === 0 ? 'L' : (outer || k === depth - 1) ? 'D' : 'M');
            }
        }
    }
    return g.map(r => r.join(''));
}
const FLY = [_flyArt(1, 1), _flyArt(0.78, 0), _flyArt(0.5, 0), _flyArt(0.78, 0)];
const GLIDE = _flyArt(1, 0);
const STOOP = _flyArt(0.2, 0, true);

/** Outline a sprite: every empty cell touching a filled one (4-way) becomes 'k'. Padded by one. */
function _outline(rows) {
    const H = rows.length + 2, W = rows[0].length + 2;
    const at = (x, y) => (y >= 1 && y <= rows.length && x >= 1 && x <= rows[0].length ? rows[y - 1][x - 1] : '.');
    const out = [];
    for (let y = 0; y < H; y++) {
        let s = '';
        for (let x = 0; x < W; x++) {
            const ch = at(x, y);
            if (ch !== '.') { s += ch; continue; }
            const n = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some(v => v !== '.' && v !== 'k');
            s += n ? 'k' : '.';
        }
        out.push(s);
    }
    return out;
}
const _outlined = new Map();
function _art(rows) {
    let o = _outlined.get(rows);
    if (!o) { o = _outline(rows); _outlined.set(rows, o); }
    return o;
}

/**
 * Draw a sprite of `rows` with pixel size p, its anchor (ax, ay: share of its width / height) at (x, y),
 * turned by `rot` radians.
 */
function _blit(ctx, rows, pal, x, y, p, ax = 0.5, ay = 1, rot = 0) {
    const art = _art(rows);
    const w = art[0].length, h = art.length;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (rot) ctx.rotate(rot);
    const ox = -w * p * ax, oy = -h * p * ay;
    for (let r = 0; r < h; r++) {
        const line = art[r];
        for (let c = 0; c < w; c++) {
            const ch = line[c];
            if (ch === '.') continue;
            ctx.fillStyle = pal[ch] || '#f0f';
            // (a hair over the pixel so a turned sprite shows no seams)
            ctx.fillRect(ox + c * p, oy + r * p, p + (rot ? 0.6 : 0.02), p + (rot ? 0.6 : 0.02));
        }
    }
    ctx.restore();
}

/** The glove's x off your middle, in the character's pixels, by facing (up, left, down, right). */
const FIST_DX = { 0: -10, 1: -7, 2: 10, 3: 7 };

const FLYING = new Set(['launch', 'circle', 'stoop', 'throwup', 'return', 'rakeoff']);

export const InnerMapHawk = {
    _game: null,
    st: null,       // { phase, hawkId, x, y, alt, t, vx, vy, quarry, outcome, perch, angle, ... }
    _map: null,

    _cfg() {
        return { launchSeconds: 0.55, circleSeconds: 2.2, circleRadius: 1.6, circleAlt: 3.2, stoopSeconds: 0.45, throwUpSeconds: 0.7, flySpeed: 7, takeReach: 1.3, perchAlt: 1.7, rakeTiles: [7, 13], ...(Falconry.config().flight || {}) };
    },

    _hidden(game) {
        return !InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active
            || !game || !game.player || game.player.boardedShip;
    },

    /** The hawk's walking record in ui/innerMapPets.js (so it hands the hawk over to us). */
    _record(hawk) {
        return (InnerMapPets._pets || []).find(p => p && p.a && p.a.id === hawk.id) || null;
    },

    /** The hawk this module flies now, or null (none with you, or wheeling overhead of its own). */
    hawk(game) {
        return Falconry.hawkOf(game && game.player);
    },

    /** On the glove? */
    onFist() {
        return !!(this.st && this.st.phase === 'fist');
    },

    _player() {
        const p = InnerMap.getPlayerWorldPos();
        return { x: p.x, y: p.y, walking: !!p.walking };
    },

    _beastPos(a) {
        const p = InnerMap.animalPos(a);
        return { x: p.q * T_PX + T_PX / 2, y: p.r * T_PX + T_PX / 2 };
    },

    /** Steer (x, y) toward (tx, ty) at `speed` px/s; true when there. */
    _toward(st, tx, ty, speed, dt) {
        const dx = tx - st.x, dy = ty - st.y;
        const d = Math.hypot(dx, dy);
        const step = speed * dt;
        if (d <= step || d < 0.5) { st.x = tx; st.y = ty; return true; }
        st.vx = dx / d; st.vy = dy / d;
        st.x += st.vx * step; st.y += st.vy * step;
        return false;
    },

    /** Leaving the map (or a load): a raked hawk comes back by nightfall; a held quarry is let go. */
    _leave(game) {
        const st = this.st;
        if (st && st.quarry && st.quarry.hunted && st.quarry.state !== 'dead') st.quarry.hunted = false;
        const hawk = game && game.player ? Falconry.hawkOf(game.player) : null;
        if (hawk && hawk.raked) {
            const r = Falconry.leftRaked(game.world, hawk);
            if (r) _notify(game, `🦅 ${hawk.name}`, r.text, 'info');
        }
        this.st = null;
    },

    update(dt, game) {
        this._game = game;
        if (!InnerMap.active) {
            if (this.st) this._leave(game);
            this._map = null;
            return;
        }
        if (this._map !== InnerMap.tiles) {
            if (this.st) this._leave(game);
            this._map = InnerMap.tiles;
        }
        if (this._hidden(game)) return;
        const hawk = this.hawk(game);
        if (!hawk) { if (this.st) this._leave(game); return; }
        const me = this._player();
        if (!this.st || this.st.hawkId !== hawk.id) {
            // (a hawk still marked raked from before — a load — has come back)
            if (hawk.raked) Falconry.leftRaked(game.world, hawk);
            this.st = { phase: 'fist', hawkId: hawk.id, x: me.x, y: me.y, alt: FIST_ALT, t: 0, vx: 0, vy: -1 };
        }
        const st = this.st;
        const rec = this._record(hawk);
        // Cast off to wheel overhead (or told to stay): ui/innerMapPets.js flies it
        if (st.phase === 'fist' && (hawk.streetWheel || (rec && rec.stay))) {
            if (rec) rec.hawkHeld = false;
            st.x = me.x; st.y = me.y;
            return;
        }
        if (rec) rec.hawkHeld = true;
        this._step(st, hawk, me, Math.max(0, Math.min(dt, 0.1)), game);
        if (rec) { rec.x = st.x; rec.y = st.y; rec.facing = 'down'; }
    },

    _step(st, hawk, me, dt, game) {
        const F = this._cfg();
        const speed = F.flySpeed * T_PX;
        st.t += dt;
        const q = st.quarry;
        switch (st.phase) {
            case 'fist':
                st.x = me.x; st.y = me.y; st.alt = FIST_ALT;
                return;
            case 'launch': {
                const goal = q ? this._beastPos(q) : me;
                this._toward(st, goal.x, goal.y, speed * 0.7, dt);
                st.alt += (F.circleAlt * T_PX * 0.6 - st.alt) * Math.min(1, dt * 3);
                if (st.t >= F.launchSeconds) {
                    st.t = 0;
                    if (st.outcome === 'rake') st.phase = 'rakeoff';
                    else { st.phase = 'circle'; st.angle = Math.atan2(st.y - goal.y, st.x - goal.x); }
                }
                return;
            }
            case 'circle': {
                if (!q || !InnerMap.animals.includes(q) || q.state === 'dead') { st.phase = 'return'; st.t = 0; return; }
                const c = this._beastPos(q);
                const R = F.circleRadius * T_PX;
                st.angle += dt * (speed * 0.8) / Math.max(1, R);
                const tx = c.x + Math.cos(st.angle) * R, ty = c.y + Math.sin(st.angle) * R * 0.6;
                this._toward(st, tx, ty, speed, dt);
                st.alt += (F.circleAlt * T_PX - st.alt) * Math.min(1, dt * 2);
                if (st.t >= F.circleSeconds && Math.hypot(st.x - c.x, st.y - c.y) <= R * 1.4) this._stoop(st, game);
                return;
            }
            case 'stoop': {
                const gone = !q || !InnerMap.animals.includes(q);
                const c = gone ? { x: st.sx, y: st.sy } : this._beastPos(q);
                const u = Math.min(1, st.t / Math.max(0.05, F.stoopSeconds));
                st.x = st.sx + (c.x - st.sx) * u;
                st.y = st.sy + (c.y - st.sy) * u;
                st.vx = c.x - st.sx; st.vy = c.y - st.sy;
                st.alt = st.salt * Math.pow(1 - u, 1.5);
                if (u >= 1) this._strike(st, hawk, game, gone);
                return;
            }
            case 'throwup':
                st.alt += (1.6 * T_PX - st.alt) * Math.min(1, dt * 4);
                st.x += st.vx * speed * 0.35 * dt; st.y += st.vy * speed * 0.35 * dt;
                if (st.t >= F.throwUpSeconds) { st.phase = 'return'; st.t = 0; }
                return;
            case 'return': {
                const there = this._toward(st, me.x, me.y, speed * 1.15, dt);
                st.alt += (FIST_ALT - st.alt) * Math.min(1, dt * 3);
                if (there || Math.hypot(st.x - me.x, st.y - me.y) < 6) { st.phase = 'fist'; st.t = 0; st.quarry = null; }
                return;
            }
            case 'mantle': {
                if (!q || !InnerMap.animals.includes(q)) { st.phase = 'fed'; st.t = 0; return; }
                const c = this._beastPos(q);
                st.x = c.x; st.y = c.y; st.alt = 0;
                if (Math.hypot(me.x - c.x, me.y - c.y) <= F.takeReach * T_PX) { this.takeKill(game); return; }
                const feed = Falconry.config().feedUp;
                if (st.t >= _num(feed.seconds, 45)) {
                    Falconry.feedUp(game.world, hawk);
                    InnerMap.butcherAnimal(q, game.world);
                    const sp = InnerMap.animalSpecies(q.species) || {};
                    _notify(game, `🦅 ${hawk.name}`, Falconry.line('fedUp', { name: hawk.name, quarry: _lower(sp, q) }), 'warning');
                    st.phase = 'fed'; st.t = 0;
                }
                return;
            }
            case 'fed':
                st.alt = 0;
                // (it steps up onto the glove when you come to it)
                if (Math.hypot(me.x - st.x, me.y - st.y) <= F.takeReach * T_PX) { st.phase = 'fist'; st.t = 0; st.quarry = null; }
                return;
            case 'rakeoff': {
                const p = st.perch || { x: st.x, y: st.y - 6 * T_PX };
                const there = this._toward(st, p.x, p.y, speed, dt);
                st.alt += (F.perchAlt * T_PX - st.alt) * Math.min(1, dt * 2.5);
                if (there) { st.phase = 'raked'; st.t = 0; st.alt = F.perchAlt * T_PX; }
                return;
            }
            case 'raked':
                // lured down: back to the glove
                if (!hawk.raked) { st.phase = 'return'; st.t = 0; }
                return;
            default:
                st.phase = 'fist';
        }
    },

    /** Over the quarry: the stoop. A doomed quarry freezes under the shadow; one to be missed bolts. */
    _stoop(st, game) {
        const q = st.quarry;
        st.phase = 'stoop'; st.t = 0;
        st.sx = st.x; st.sy = st.y; st.salt = st.alt;
        if (st.outcome === 'kill') {
            q.hunted = true;
            q.next = null; q.progress = 0;
        } else {
            InnerMap.alarmAnimal(q, { q: Math.round((st.x - T_PX / 2) / T_PX), r: Math.round((st.y - T_PX / 2) / T_PX) });
        }
    },

    /** The stoop ends: bound to the quarry (it dies where it sat: a real carcass), or a miss. */
    _strike(st, hawk, game, gone) {
        const q = st.quarry;
        const sp = q ? InnerMap.animalSpecies(q.species) || {} : {};
        const quarry = _lower(sp, q);
        if (st.outcome === 'kill' && !gone && q.state !== 'dead') {
            InnerMap.killAnimal(game.world, q);
            Falconry.bound(game.world, hawk);
            st.phase = 'mantle'; st.t = 0; st.alt = 0;
            _notify(game, `🦅 ${hawk.name} Binds`, Falconry.line('kill', { name: hawk.name, quarry }), 'success');
            return;
        }
        if (q && q.hunted && q.state !== 'dead') { q.hunted = false; InnerMap.alarmAnimal(q, { q: q.q, r: q.r + 1 }); }
        st.phase = 'throwup'; st.t = 0;
        const d = Math.hypot(st.vx, st.vy) || 1;
        st.vx /= d; st.vy /= d;
        _notify(game, `🦅 ${hawk.name} Misses`, Falconry.line('miss', { name: hawk.name, quarry }), 'info');
    },

    /** A tree within reach of the rake, else open air at that distance: where it takes stand. */
    _perch(hawk) {
        const F = this._cfg();
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const flights = _num(hawk.hawking && hawk.hawking.flights);
        const ang = flights * 2.39996;
        const [lo, hi] = Array.isArray(F.rakeTiles) ? F.rakeTiles : [7, 13];
        const dist = lo + (flights * 7) % Math.max(1, hi - lo + 1);
        const aim = { q: Math.round(me.q + Math.cos(ang) * dist), r: Math.round(me.r + Math.sin(ang) * dist) };
        let best = null, bd = Infinity;
        for (let r = aim.r - 6; r <= aim.r + 6; r++) {
            for (let q = aim.q - 6; q <= aim.q + 6; q++) {
                const t = InnerMap.getTile && InnerMap.getTile(q, r);
                if (!t || !t.customObject) continue;
                const def = CustomObjects.getDef(t.customObject.defId);
                const tags = (def && def.tags) || [];
                if (!def || !(def.objectType === 'tree' || tags.includes('tree'))) continue;
                const d = Math.hypot(q - aim.q, r - aim.r);
                if (d < bd) { bd = d; best = { q, r }; }
            }
        }
        const at = best || aim;
        const W = InnerMap.width || 128, H = InnerMap.height || 128;
        const q = Math.max(1, Math.min(W - 2, at.q)), r = Math.max(1, Math.min(H - 2, at.r));
        return { x: q * T_PX + T_PX / 2, y: r * T_PX + T_PX / 2, tree: !!best };
    },

    /** Why it can't be flown from where you are now (beyond the hawk and the quarry), or null. */
    _whyNot() {
        if (InnerMapCarry.person || InnerMapCombat._carrying) return 'your hands are full';
        if (typeof InnerMap.isPlayerSwimming === 'function' && InnerMap.isPlayerSwimming()) return 'not while swimming';
        if (InnerMapCombat.playerKnockedOut && InnerMapCombat.playerKnockedOut()) return 'you are down';
        return null;
    },

    _weather(game) {
        const w = game && game.world && game.world.weather;
        const p = game && game.player;
        if (!w || typeof w.getWeather !== 'function' || !p) return null;
        try {
            const x = w.getWeather(p.q, p.r, game.world.day);
            return x && x.type ? x.type : null;
        } catch {
            return null;
        }
    },

    _dist(a) {
        const p = InnerMap.animalPos(a);
        return Math.hypot(p.q - InnerMap.playerInnerQ, p.r - InnerMap.playerInnerR);
    },

    /** Fly it at the beast. → the launch's { outcome, p, rake } or null */
    fly(game, a) {
        const hawk = this.hawk(game);
        const world = game.world, player = game.player;
        const dist = this._dist(a);
        const chk = Falconry.canFly(world, player, hawk, a, dist, { onFist: this.onFist() && !(hawk && hawk.streetWheel), why: this._whyNot() });
        if (!chk.ok) { _notify(game, '🦅 Not Now', `${chk.reason}.`, 'warning'); return null; }
        const res = Falconry.launch(world, player, hawk, a, dist, { weather: this._weather(game), huntRank: Hunting.skill(player) });
        const st = this.st;
        const sp = InnerMap.animalSpecies(a.species) || {};
        const quarry = _lower(sp, a);
        Object.assign(st, { phase: 'launch', t: 0, quarry: a, outcome: res.outcome, alt: FIST_ALT, perch: null });
        if (res.outcome === 'rake') {
            st.perch = this._perch(hawk);
            _notify(game, `🦅 ${hawk.name} Rakes Away`, Falconry.line('rake', { name: hawk.name, quarry }), 'warning');
        } else {
            _notify(game, `🦅 ${hawk.name}`, Falconry.line('launch', { name: hawk.name, quarry }), 'info');
        }
        return res;
    },

    /** Back to the glove (not mid-stoop; a raked hawk wants the lure). */
    call(game) {
        const hawk = this.hawk(game), st = this.st;
        if (!hawk || !st) return false;
        if (st.phase === 'raked' || st.phase === 'rakeoff') {
            _notify(game, `🦅 ${hawk.name}`, `${hawk.name} won't come to a bare fist: lure it down with meat.`, 'warning');
            return false;
        }
        if (!['launch', 'circle', 'throwup', 'mantle', 'fed'].includes(st.phase)) return false;
        if (st.quarry && st.quarry.hunted && st.quarry.state !== 'dead') st.quarry.hunted = false;
        st.phase = 'return'; st.t = 0;
        if (st.alt < 8) st.alt = 8;
        _notify(game, `🦅 ${hawk.name}`, Falconry.line('called', { name: hawk.name }), 'info');
        return true;
    },

    /** You make in to the hawk on its kill: its reward, the carcass over your shoulder (hands free). */
    takeKill(game) {
        const hawk = this.hawk(game), st = this.st;
        if (!hawk || !st || st.phase !== 'mantle') return false;
        const q = st.quarry;
        Falconry.reward(game.world, hawk);
        const sp = q ? InnerMap.animalSpecies(q.species) || {} : {};
        st.phase = 'fist'; st.t = 0; st.quarry = null;
        _notify(game, `🦅 ${hawk.name}`, Falconry.line('taken', { name: hawk.name, quarry: _lower(sp, q) }), 'success');
        if (q && InnerMap.animals.includes(q) && !InnerMapAnimals._carry && InnerMapAnimals.canCarry(game, q).ok) InnerMapAnimals.pickUp(game, q);
        if (game.ui && game.ui.updateStats) game.ui.updateStats(game.player, game.world);
        return true;
    },

    lure(game, foodId) {
        const hawk = this.hawk(game);
        if (!hawk) return null;
        const res = Falconry.lure(game.world, game.player, hawk, foodId);
        if (!res.success) _notify(game, '🦅 Not Now', res.reason, 'warning');
        else _notify(game, `🦅 ${hawk.name}`, res.text, res.came ? 'success' : 'info');
        if (game.ui && game.ui.updateStats) game.ui.updateStats(game.player, game.world);
        return res;
    },

    // ── The menu ──

    _tileOf(x, y) {
        return { q: Math.floor(x / T_PX), r: Math.floor(y / T_PX) };
    },

    menuItems(game, q, r) {
        const out = [];
        if (!InnerMap.active || InnerMap._insideBuilding || this._hidden(game)) return out;
        const hawk = this.hawk(game);
        const st = this.st;
        if (!hawk || !st) return out;
        const word = Falconry.word(hawk);
        const wheeling = st.phase === 'fist' && !!hawk.streetWheel;
        // A quarry here: fly at it
        const beast = (InnerMap.getAnimalsNear(q, r, 1) || []).find(a => a.state !== 'dead' && Falconry.quarry(a.species) && !a.livestock && !a.ownedBy);
        if (beast) {
            const sp = InnerMap.animalSpecies(beast.species) || {};
            const lower = _lower(sp, beast);
            const dist = this._dist(beast);
            const chk = Falconry.canFly(game.world, game.player, hawk, beast, dist, { onFist: st.phase === 'fist' && !wheeling, why: this._whyNot() });
            if (chk.ok) {
                const weather = this._weather(game);
                const p = Falconry.chance(game.world, game.player, hawk, beast, dist, { weather, huntRank: Hunting.skill(game.player) });
                const wx = weather && Falconry.weatherMult(weather) < 1 ? `, the ${weather} against it` : '';
                out.push({ type: 'action', action: 'hawk_fly', label: `Fly the ${word} at the ${lower}`, icon: '🦅', animal: beast,
                    desc: `Cast ${hawk.name} off the fist: about ${Math.round(p * 100)}% it binds to the ${lower} (${Math.round(dist)} paces${wx}). A hungry or green hawk may rake away.` });
            } else {
                out.push({ type: 'disabled', label: `🦅 Fly the ${word} — ${chk.reason}` });
            }
        }
        // The hawk itself (on your own tile, or where it is)
        const mine = q === InnerMap.playerInnerQ && r === InnerMap.playerInnerR;
        const ht = this._tileOf(st.x, st.y);
        const atHawk = Math.abs(ht.q - q) <= 1 && r - ht.r >= -1 && r - ht.r <= 2;
        if (!mine && !atHawk) return out;
        const items = [];
        if (st.phase === 'mantle') {
            const near = Math.hypot(st.x - InnerMap.getPlayerWorldPos().x, st.y - InnerMap.getPlayerWorldPos().y) <= 2.2 * T_PX;
            if (near) items.push({ type: 'action', action: 'hawk_take', label: 'Take the Kill', icon: '🖐️', desc: `Make in to ${hawk.name}: its reward off the kill, the kill over your shoulder` });
            else items.push({ type: 'action', action: 'hawk_take', label: 'Take the Kill', icon: '🖐️', desc: `Walk up to ${hawk.name} on its kill and take it` });
        }
        if (['launch', 'circle', 'throwup', 'mantle', 'fed'].includes(st.phase)) {
            items.push({ type: 'action', action: 'hawk_call', label: `Call the ${word}`, icon: '📣', desc: `${hawk.name} back to the glove${st.phase === 'mantle' ? ' (leaving its kill where it lies, unrewarded)' : ''}` });
        }
        if (st.phase === 'raked' || st.phase === 'rakeoff') {
            const foods = AnimalCompanions.foodsFor(game.player, hawk).slice(0, 2);
            const p = Math.round(Falconry.lureChance(game.world, hawk) * 100);
            for (const f of foods) {
                const name = f.id.replace(/_/g, ' ');
                items.push({ type: 'action', action: 'hawk_lure', food: f.id, label: `Lure the ${word} Back (${name})`, icon: '🍖', desc: `Hold up ${name} on the glove: about ${p}% it comes down to it (×${f.have} in your packs; only eaten if it comes)` });
            }
            if (!foods.length) items.push({ type: 'disabled', label: `🍖 Lure the ${word} Back — nothing in your packs it will eat` });
        }
        if (mine && st.phase === 'fist') {
            if (wheeling) items.push({ type: 'action', action: 'hawk_fist', label: `Take the ${word} on Your Fist`, icon: '🧤', desc: `${hawk.name} comes down to the glove and rides there` });
            else items.push({ type: 'action', action: 'hawk_wheel', label: `Cast the ${word} Off to Wheel Overhead`, icon: '🌀', desc: `${hawk.name} flies free about you (take it back on the fist to fly it at quarry)` });
        }
        if (items.length) {
            const where = st.phase === 'raked' ? ', up in a tree' : st.phase === 'mantle' ? ', on its kill' : FLYING.has(st.phase) ? ', on the wing' : '';
            out.push({ type: 'header', label: `🦅 ${hawk.name}${where}` }, ...items, { type: 'separator' });
        }
        return out;
    },

    /** A menu choice of ours? (true when handled) */
    handle(game, item) {
        if (!item || !/^hawk_/.test(item.action || '')) return false;
        const hawk = this.hawk(game);
        switch (item.action) {
            case 'hawk_fly':
                if (item.animal && InnerMap.animals.includes(item.animal)) this.fly(game, item.animal);
                return true;
            case 'hawk_call': this.call(game); return true;
            case 'hawk_take': {
                const st = this.st;
                if (!st || st.phase !== 'mantle') return true;
                const near = Math.hypot(st.x - InnerMap.getPlayerWorldPos().x, st.y - InnerMap.getPlayerWorldPos().y) <= 2.2 * T_PX;
                if (near) this.takeKill(game);
                else if (InnerMap.approachAndThen) {
                    const t = this._tileOf(st.x, st.y);
                    const res = InnerMap.approachAndThen(t.q, t.r, () => { if (this.st && this.st.phase === 'mantle') this.takeKill(game); });
                    if (res === 'unreachable') _notify(game, 'Blocked', 'You can\'t reach it.', 'error');
                }
                return true;
            }
            case 'hawk_lure': this.lure(game, item.food); return true;
            case 'hawk_wheel':
                if (hawk) { hawk.streetWheel = true; _notify(game, `🦅 ${hawk.name}`, `You cast ${hawk.name} off: it wheels high over you.`, 'info'); }
                return true;
            case 'hawk_fist':
                if (hawk) { hawk.streetWheel = false; _notify(game, `🦅 ${hawk.name}`, `${hawk.name} drops onto your glove.`, 'info'); }
                return true;
            default: return false;
        }
    },

    // ── Drawing ──

    _pal(hawk) {
        return PAL[hawk && hawk.breed] || PAL.goshawk;
    },

    /**
     * Into the depth-sorted pass: on the fist (just after the player), on the wing (its shadow on
     * the ground, the bird above everything), mantling on its kill, up in its tree.
     */
    collect(items, ctx, camera, T, facing) {
        const st = this.st;
        if (!st || !InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active) return;
        const game = InnerMapHawk._game;
        const hawk = game ? this.hawk(game) : null;
        if (!hawk || hawk.id !== st.hawkId) return;
        if (st.phase === 'fist' && hawk.streetWheel) return;
        const rec = this._record(hawk);
        if (st.phase === 'fist' && rec && rec.stay) return;
        const ds = T * camera.zoom;
        const k = T / T_PX;
        const pal = this._pal(hawk);
        const p = ds * 1.8 / 64;   // the LPC character's own pixel
        const now = _now();
        if (st.phase === 'fist') {
            if (typeof InnerMap.isPlayerSwimming === 'function' && InnerMap.isPlayerSwimming()) return;
            const pos = InnerMap.getPlayerWorldPos();
            if (pos.climbing) return;
            // (up on a cart's seat, driving: ui/innerMapHitch.js seats you there; the hawk rides hooded)
            if (InnerMapCarts.pushing && InnerMapCarts.pushing.horse) return;
            const s = camera.worldToScreenFast(pos.x, pos.y);
            const px = s.x, py = s.y;
            const dir = facing != null ? facing : 2;
            items.push({ sortY: pos.y + T / 2 + 0.01, zLayer: 2, sortX: pos.x / T, draw: () => this._drawOnFist(ctx, hawk, pal, px, py, ds, p, dir, !!pos.walking, now) });
            return;
        }
        const s = camera.worldToScreenFast(st.x * k, st.y * k);
        const sx = s.x, sy = s.y + ds * 0.3;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        if (sx < -ds * 6 || sx > W + ds * 6 || sy < -ds * 8 || sy > H + ds * 6) return;
        const altPx = st.alt * k * camera.zoom;
        if (st.phase === 'mantle' || st.phase === 'fed') {
            const mant = st.phase === 'mantle';
            items.push({ sortY: st.y * k + T * 0.5, zLayer: 2, sortX: st.x * k / T, draw: () => {
                // mantling: wings spread low over the kill, rousing now and then
                const rouse = mant && Math.sin(now * 2.2) > 0.85 ? -p : 0;
                _blit(ctx, mant ? MANTLE : PERCH.down, pal, sx, sy - ds * 0.05 + rouse, p, 0.5, 1);
            } });
            return;
        }
        if (st.phase === 'raked') {
            items.push({ sortY: st.y * k + T * 8, zLayer: 3, sortX: st.x * k / T, draw: () => {
                const me = InnerMap.getPlayerWorldPos();
                const side = me.x < st.x ? PERCH.left : PERCH.right;
                const bob = Math.sin(now * 1.3) > 0.9 ? -p : 0;
                _blit(ctx, side, pal, sx, sy - altPx + bob, p, 0.5, 1);
            } });
            return;
        }
        // On the wing: its shadow on the ground (smaller and fainter the higher it is), the bird above
        const hi = Math.min(1, st.alt / (4 * T_PX));
        items.push({ sortY: st.y * k, zLayer: 1, sortX: st.x * k / T, draw: () => {
            ctx.save();
            ctx.globalAlpha = 0.28 - 0.14 * hi;
            ctx.fillStyle = '#000';
            ctx.beginPath();
            const w = ds * (0.42 - 0.12 * hi);
            ctx.ellipse(sx, sy - ds * 0.02, w, w * 0.32, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } });
        items.push({ sortY: st.y * k + T * 8, zLayer: 3, sortX: st.x * k / T, draw: () => {
            const rot = Math.atan2(st.vx || 0, -(st.vy || -1));
            let rows;
            if (st.phase === 'stoop') rows = STOOP;
            else {
                // beating hard off the fist and back to it; between, a glide and a few beats
                const fast = st.phase === 'launch' || st.phase === 'return' || st.phase === 'throwup' || st.phase === 'rakeoff';
                const fps = fast ? 12 : 8;
                const beat = Math.floor(now * fps) % 4;
                rows = fast || (now * 0.7) % 2 < 0.8 ? FLY[beat] : GLIDE;
            }
            _blit(ctx, rows, pal, sx, sy - altPx - ds * 0.2, p * 1.1, 0.5, 0.5, rot);
        } });
    },

    /** Where the glove is (screen px) for you at (px, py) facing `dir`, on foot or in the saddle. */
    _fistAt(px, py, ds, dir, walking, now) {
        const u = ds * 1.8 / 64;
        let top = py - ds * 1.8 + ds * 0.3;
        let along = 0;
        const m = InnerMapPets.riding && InnerMapPets.mounted ? InnerMapPets.mounted() : null;
        if (m) {
            // (as drawRider seats you: the saddle up the horse's flank, you a little behind the withers)
            const sp = InnerMapPets.sprite(m.a);
            if (sp) {
                const side = dir === 1 || dir === 3;
                const k = (_num(sp.drawTiles, 2) * _num(sp.scale, 1) * ds) / _num(sp.frameW, 112);
                const saddle = py + ds * 0.3 - (side ? 70 : 84) * k;
                top = saddle - 42 * u;
                along = side ? (dir === 3 ? -1 : 1) * 6 * k : 0;
            }
        }
        // the left fist, forearm up: to your left — the screen's right seen from the front
        const dx = FIST_DX[dir] != null ? FIST_DX[dir] : 10;
        const bob = walking ? Math.round(Math.sin(now * 10)) * u * 0.6 : 0;
        return { x: px + along + dx * u, y: top + 37 * u + bob, u };
    },

    _drawOnFist(ctx, hawk, pal, px, py, ds, p, dir, walking, now) {
        const f = this._fistAt(px, py, ds, dir, walking, now);
        const view = ['up', 'left', 'down', 'right'][dir] || 'down';
        // the glove, then the hawk standing on it, rousing now and then
        _blit(ctx, GLOVE_ART.fist, GLOVE, f.x, f.y + 3 * p, p, 0.5, 1);
        const rouse = Math.sin(now * 0.9 + 1.3) > 0.97 ? -p : 0;
        _blit(ctx, PERCH[view], pal, f.x, f.y + p * 0.5 + rouse, p, 0.5, 1);
    },
};
