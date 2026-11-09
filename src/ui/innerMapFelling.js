// ============================================================
// INNER MAP FELLING — how chopping a tree looks and sounds
// ============================================================
// The world side (world/innerMap/felling.js, movement.js) decides when a blow
// lands and when the tree comes down; this draws it:
//
//   • the swing: the body's slash frames timed to the blows (swingFrame — the
//     impact frame on the very moment the blow lands) and an axe in the hands
//     (drawAxe: the painted axe of ui/jobItems.js, raised over the shoulder,
//     brought down on the trunk)
//   • each blow (onHit): the axe's knock, wood chips flying back towards you,
//     leaves (blossom, autumn colour, a puff of snow off a winter crown)
//     shaken down, and the tree shuddering (shakeAt: the crown sways more than
//     the trunk, the shudder dies away before the next blow)
//   • the felling (InnerMap._fallingTrees): the tree, its stump already left
//     standing, creaks and topples away from you, falling faster as it goes
//     (drawFalling), hits the ground with a thud, a cloud of dust and a burst of
//     leaves (onLanded), lies a moment and is gone (its logs are in your packs)
//   • the Woodcutting XP it earned, floating up from the stump (onFelled)
//
// Pure presentation: Math.random is fine here (ui/), nothing it draws touches the game.

import { InnerMap } from '../world/innerMap.js';
import { CustomObjects } from '../world/customObjects.js';
import { DataLoader } from '../core/dataLoader.js';
import { audioManager } from '../systems/audio/index.js';
import { drawMapText, labelZoom } from './mapInk.js';

const T = 32;
const DIR_UP = 0, DIR_LEFT = 1, DIR_DOWN = 2, DIR_RIGHT = 3;
// A tree's trunk stands at the bottom middle of its cell, this far above the cell's foot (scripts/make_palm_sheet.py fit)
const FOOT = 6 / 32;

const LEAVES = {
    spring: ['#7fbf4a', '#9ed35a', '#f2c6d8', '#ffffff'],
    summer: ['#4f8f2e', '#6aa83a', '#3d7a26'],
    autumn: ['#d9822b', '#c8502a', '#e8b23a', '#a8642a'],
    winter: ['#ffffff', '#eef4fb', '#dfe8f2'],
};
const DEAD = ['#7a5a3a', '#5e452c', '#8d6d4a'];
const CHIPS = ['#e8c48c', '#d9ad6c', '#c8945a', '#f1d6a6'];
const DUST = ['rgba(150,124,92,', 'rgba(126,104,78,', 'rgba(170,150,120,'];

const ease = (p) => p * p * (3 - 2 * p);

function _season() {
    return String(InnerMap.season || 'Summer').toLowerCase();
}

function _config() {
    const d = (DataLoader.get && DataLoader.get('townProps')) || (DataLoader._gamedata && DataLoader._gamedata.townProps) || {};
    return d.felling || {};
}

function _sfx(name) {
    try { audioManager.playSFX(name); } catch { /* sound is best-effort */ }
}

/** The trunk's foot of an object anchored at (q, r), in world px. */
function _trunk(def, q, r) {
    const b = def && def.bounds ? def.bounds : { minCol: 0, maxCol: 0 };
    const col = Math.floor((b.minCol + b.maxCol) / 2);
    return { x: (q + col + 0.5) * T, y: (r + 1 - FOOT) * T, height: def && def.bounds ? (b.maxRow - b.minRow + 1) : 1 };
}

let _axeImg = null;
function _axe() {
    const art = ((DataLoader.get && DataLoader.get('mapTasks')) || {}).itemArt;
    const rect = art && art.items && art.items.axe;
    if (!rect || typeof Image === 'undefined') return null;
    if (!_axeImg) { _axeImg = new Image(); _axeImg.src = art.sheet; }
    return _axeImg.complete && _axeImg.naturalWidth ? { img: _axeImg, rect } : null;
}

export const InnerMapFelling = {
    _parts: [],      // chips, leaves, dust: { x, y, vx, vy, g, ground, life, age, size, color, kind, spin }
    _shakes: [],     // { q, r, age }
    _xp: [],         // { x, y, age, text }

    /** Is this the kind of thing chopped with an axe (a tree, or a stump grubbed out)? */
    isChopped(def) {
        return !!(def && (def.topples || def.objectType === 'stump' || def.objectType === 'tree'));
    },

    // ── The swing ──

    /**
     * The swing's phase (0 the moment a blow lands, rising to 1 at the next) for
     * the active interaction, or null when the player isn't chopping.
     */
    swingPhase() {
        const ia = InnerMap._activeInteraction;
        if (!ia || ia.done || ia.nonDestructive || ia.fading || !(ia.swingInterval > 0)) return null;
        const def = CustomObjects.getDef(ia.defId);
        if (!this.isChopped(def)) return null;
        return Math.max(0, Math.min(0.999, ia.swingTimer / ia.swingInterval));
    },

    /**
     * The slash frame for a phase: the follow-through just after the blow (2), the
     * recovery (3), the axe raised and held (0), the downswing (1) just before it.
     */
    swingFrame(p) {
        if (p < 0.14) return 2;
        if (p < 0.3) return 3;
        if (p < 0.8) return 0;
        return 1;
    },

    /** The time to hand InnerMapCharacters.drawCharacter so it draws that frame (fps: the anim's). */
    swingTime(p, fps = 12) {
        return (this.swingFrame(p) + 0.5) / fps;
    },

    /** The axe's angle (degrees on the screen, facing right: 0 straight ahead, -90 up) through the swing. */
    axeAngle(p) {
        const RAISED = -150, BACK = -165, STRUCK = 18, REST = -40;
        if (p < 0.3) return STRUCK + (REST - STRUCK) * ease(p / 0.3);
        if (p < 0.8) return REST + (BACK - REST) * ease((p - 0.3) / 0.5);
        if (p < 0.86) return BACK + (RAISED - BACK) * ((p - 0.8) / 0.06);
        return RAISED + (STRUCK - RAISED) * Math.pow((p - 0.86) / 0.14, 1.6);
    },

    /**
     * Facing us or away, the chop is overhead: how far the axe is lifted (0 at the
     * blow, 1 drawn right back) by the side view's swing.
     */
    axeLift(p) {
        const STRUCK = 18, BACK = -165;
        return Math.max(0, Math.min(1, (STRUCK - this.axeAngle(p)) / (STRUCK - BACK)));
    },

    /**
     * The overhead chop seen from in front (facing us, DIR_DOWN) or behind (DIR_UP):
     * the axe swung in the up-down plane, so on the screen it only runs up or down
     * from the hands, foreshortened as it points at us or away (the top-down view
     * tilts a forward reach to half). Raised, the head is up over the head; at the
     * blow it is out level with the waist, into the trunk. → { hx, hy, ang, len, front }:
     * the hands, the handle's screen angle, its length as a share of the art's, and
     * whether it is drawn over the body.
     */
    _overhead(dir, p, px, py, ds) {
        const L = this.axeLift(p);
        const toUs = dir === DIR_DOWN;
        // the swing's angle from straight up: a little back over the head when raised, just past level at the blow
        // (facing away it bites level, into the trunk ahead)
        const phi = ((-20 + (toUs ? 135 : 110) * (1 - L)) * Math.PI) / 180;
        // on the screen: up for up, and a reach forward is down the screen facing us, up it facing away
        const vy = -Math.cos(phi) + (toUs ? 0.5 : -0.5) * Math.sin(phi);
        const len = Math.max(0.3, Math.min(1, Math.abs(vy)));
        // swung over the right shoulder, so it leans that way a little; raised, the hands are up
        // over the head, the head of the axe clear above it
        const lean = toUs ? 16 : 20;
        return {
            hx: px + ds * (toUs ? 0.08 : 0.16),
            hy: py - ds * (toUs ? 0.5 + 0.8 * L : 0.7 + 0.6 * L),
            ang: vy < 0 ? -90 + lean : 90 - lean,
            len,
            // facing us, drawn back over the head it is behind it; facing away, raised over the
            // shoulder it is nearer us than the head, and buried in the trunk it is past the body
            front: toUs ? L < 0.62 : L > 0.55,
        };
    },

    /** Is the axe drawn over the body (else behind it) at this phase, facing dir? */
    axeInFront(dir, p) {
        if (dir === DIR_DOWN || dir === DIR_UP) return this._overhead(dir, p, 0, 0, 1).front;
        return true;
    },

    /**
     * The axe in the hands of a body drawn round (px, py), `ds` px a tile,
     * facing dir, at swing phase p. Call with behind = true before the body and
     * false after: it draws on whichever call its place at that moment says.
     */
    drawAxe(ctx, px, py, ds, dir, p, behind) {
        if (p == null) return false;
        if (this.axeInFront(dir, p) === behind) return true;
        const a = _axe();
        if (!a) return false;
        const [sx, sy, sw, sh] = a.rect;
        // the painted axe lies handle bottom-left to head top-right: its grip, and the handle's own angle
        const grip = [sx + sw * 0.15, sy + sh * 0.9];
        const own = -56;
        const k = ds * 0.7 / 128;   // the art is 128px a tile
        if (dir === DIR_DOWN || dir === DIR_UP) {
            const o = this._overhead(dir, p, px, py, ds);
            ctx.save();
            ctx.translate(o.hx, o.hy);
            ctx.rotate((o.ang * Math.PI) / 180);
            ctx.scale(o.len, 1);                       // (foreshortened along the handle)
            ctx.rotate((-own * Math.PI) / 180);        // (the handle laid along the x axis first)
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(a.img, sx, sy, sw, sh, -(grip[0] - sx) * k, -(grip[1] - sy) * k, sw * k, sh * k);
            ctx.restore();
            return true;
        }
        const ang = this.axeAngle(p);
        const flip = dir === DIR_LEFT ? -1 : 1;
        const squash = 1;
        // the hands: up by the shoulder when raised, out at the trunk when it bites
        const reach = Math.max(0, Math.cos((ang * Math.PI) / 180));
        const side = dir === DIR_RIGHT ? 1 : dir === DIR_LEFT ? -1 : 0;
        const hx = px + side * ds * (0.06 + reach * 0.16) + (side === 0 ? ds * 0.12 : 0);
        const hy = py - ds * (0.62 - reach * 0.32);
        ctx.save();
        ctx.translate(hx, hy);
        ctx.scale(flip, squash);
        ctx.rotate(((ang - own) * Math.PI) / 180);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(a.img, sx, sy, sw, sh, -(grip[0] - sx) * k, -(grip[1] - sy) * k, sw * k, sh * k);
        ctx.restore();
        return true;
    },

    // ── The blows ──

    /** A blow landed on the object at (q, r): chips, leaves, the shudder and the knock. */
    onHit(q, r, def, cutterQ, cutterR, quiet = false) {
        if (!this.isChopped(def)) return;
        if (!quiet) _sfx('chop');
        const tr = _trunk(def, q, r);
        const toward = cutterQ != null && cutterQ * T + T / 2 < tr.x ? -1 : cutterQ != null && cutterQ * T + T / 2 > tr.x ? 1 : (Math.random() < 0.5 ? -1 : 1);
        const hitY = tr.y - T * (def.objectType === 'stump' ? 0.3 : 0.35);
        const n = 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
            this._parts.push({
                kind: 'chip', x: tr.x + toward * T * 0.12, y: hitY,
                vx: toward * (30 + Math.random() * 70) + (Math.random() - 0.5) * 30,
                vy: -(40 + Math.random() * 70), g: 260, ground: tr.y + (Math.random() - 0.3) * T * 0.3,
                life: 0.9 + Math.random() * 0.5, age: 0, size: 1.4 + Math.random() * 1.6,
                color: CHIPS[Math.floor(Math.random() * CHIPS.length)], spin: Math.random() * 6,
            });
        }
        // the crown sheds a few leaves (a stump has none)
        if (def.topples) this._shedLeaves(def, tr, 2 + Math.floor(Math.random() * 3), 0.6);
        this._shakes = this._shakes.filter(s => !(s.q === q && s.r === r));
        this._shakes.push({ q, r, age: 0 });
    },

    _leafColors(def) {
        if (/dead/.test(def.id || '')) return DEAD;
        const s = _season();
        // the evergreens keep their needles: green all year, snow in winter
        if (/spruce|cypress|palm/.test(def.id || '') && s !== 'winter') return LEAVES.summer;
        return LEAVES[s] || LEAVES.summer;
    },

    _shedLeaves(def, tr, n, spread) {
        const colors = this._leafColors(def);
        const snow = _season() === 'winter';
        for (let i = 0; i < n; i++) {
            const x = tr.x + (Math.random() - 0.5) * T * 2.4 * spread;
            const y = tr.y - T * (1.4 + Math.random() * (tr.height - 1.8));
            this._parts.push({
                kind: snow ? 'snow' : 'leaf', x, y, vx: (Math.random() - 0.5) * 14, vy: 8 + Math.random() * 10,
                g: snow ? 30 : 6, ground: tr.y + (Math.random() - 0.2) * T * 0.4, life: 1.6 + Math.random() * 1.2,
                age: 0, size: snow ? 1.6 + Math.random() * 1.8 : 1.6 + Math.random() * 1.2,
                color: colors[Math.floor(Math.random() * colors.length)], spin: Math.random() * 6, sway: Math.random() * 6,
            });
        }
    },

    /** A felling grew on while you watched (world/innerMap/felling.js _regrowLive): a little stir of leaves. */
    onRegrow(q, r, defId) {
        const def = CustomObjects.getDef(defId);
        if (!def) return;
        const tr = _trunk(def, q, r);
        this._shedLeaves(def, tr, def.topples && !/sapling|young/.test(def.id) ? 10 : 4, 0.6);
    },

    /** How far the object at (q, r) is thrown off by the last blow, for a cell at localRow: px on the screen. */
    shakeAt(q, r, localRow, ds) {
        const s = this._shakes.find(e => e.q === q && e.r === r);
        if (!s) return 0;
        const amp = ds * 0.045 * Math.exp(-s.age * 9) * (1 + Math.max(0, -localRow) * 0.55);
        return Math.sin(s.age * 48) * amp;
    },

    // ── The felling ──

    /** It came down: the creak, a last flurry, and the XP the tree was worth over the stump. */
    onFelled(def, q, r, xp, skillName, quiet = false) {
        if (!def) return;
        if (!quiet) _sfx('tree_creak');
        const tr = _trunk(def, q, r);
        if (def.topples) this._shedLeaves(def, tr, 6, 1);
        if (xp > 0) this._xp.push({ x: tr.x, y: tr.y - T * 0.9, age: 0, text: `+${Math.round(xp)} ${skillName || 'Woodcutting'}` });
        this._shakes = this._shakes.filter(s => !(s.q === q && s.r === r));
    },

    /** A felled tree hit the ground: the thud, dust along its length, leaves burst from the crown. */
    onLanded(f) {
        const def = CustomObjects.getDef(f.defId);
        if (!def) return;
        _sfx('tree_thud');
        const tr = _trunk(def, f.q, f.r);
        const len = (tr.height - 0.4) * T;
        for (let i = 0; i < 34; i++) {
            const along = Math.random();
            this._parts.push({
                kind: 'dust', x: tr.x + f.dir * along * len, y: tr.y - T * 0.1 + (Math.random() - 0.5) * T * 0.4,
                vx: (Math.random() - 0.5) * 50, vy: -(6 + Math.random() * 22), g: 0, ground: Infinity,
                life: 0.7 + Math.random() * 0.7, age: 0, size: T * (0.07 + Math.random() * 0.09),
                color: DUST[Math.floor(Math.random() * DUST.length)],
            });
        }
        // the crown lies at the far end: leaves (or snow) burst out of it
        const crown = { x: tr.x + f.dir * len * 0.8, y: tr.y + T * 0.2, height: 2.2 };
        const colors = this._leafColors(def);
        const snow = _season() === 'winter';
        for (let i = 0; i < 16; i++) {
            this._parts.push({
                kind: snow ? 'snow' : 'leaf', x: crown.x + (Math.random() - 0.5) * T * 1.6, y: crown.y - T * Math.random() * 0.8,
                vx: (Math.random() - 0.5) * 60, vy: -(30 + Math.random() * 60), g: snow ? 120 : 70,
                ground: crown.y + (Math.random() - 0.3) * T * 0.5, life: 1.2 + Math.random() * 1.0, age: 0,
                size: 1.6 + Math.random() * 1.6, color: colors[Math.floor(Math.random() * colors.length)],
                spin: Math.random() * 6, sway: Math.random() * 6,
            });
        }
    },

    /** The tree's tilt now (radians, + falls right) and how solid it still is, for a falling record. */
    fallPose(f) {
        const fall = Number(_config().fallSeconds) || 1.1;
        const t = f.t;
        let a;
        if (t < fall) {
            // a creak and a lean first, then it goes, faster and faster
            const p = t / fall;
            a = (Math.PI / 2) * Math.pow(p, 2.4) + Math.sin(t * 30) * 0.012 * (1 - p);
        } else {
            // it bounces once on its branches and settles
            const s = t - fall;
            a = Math.PI / 2 - Math.abs(Math.sin(s * 14)) * 0.09 * Math.exp(-s * 6);
        }
        const fadeFrom = fall * 1.5, fadeTo = fall * 2.2;
        const alpha = t < fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / (fadeTo - fadeFrom));
        return { angle: a * f.dir, alpha };
    },

    /**
     * Draw a falling tree: its cells rotated about its trunk's foot. `renderer`
     * is InnerMapRenderer (its season tiles and sheet scale).
     */
    drawFalling(ctx, camera, f, renderer) {
        const def = CustomObjects.getDef(f.defId);
        if (!def) return;
        const ds = T * camera.zoom;
        const cs = Math.ceil(ds) + 1;
        const tr = _trunk(def, f.q, f.r);
        const foot = camera.worldToScreenFast(tr.x, tr.y);
        const fx = foot.x, fy = foot.y;
        const anchor = camera.worldToScreenFast(f.q * T, f.r * T);
        const ax = anchor.x, ay = anchor.y;
        const { angle, alpha } = this.fallPose(f);
        if (alpha <= 0) return;
        const tiles = renderer._getActiveObjectTiles(def, {});
        ctx.save();
        ctx.globalAlpha *= alpha;
        // a shadow stretching out under it as it comes down
        const lie = Math.abs(angle) / (Math.PI / 2);
        ctx.fillStyle = `rgba(0,0,0,${0.18 * lie})`;
        ctx.beginPath();
        ctx.ellipse(fx + Math.sign(angle) * tr.height * ds * 0.42 * lie, fy + ds * 0.08, ds * (0.4 + tr.height * 0.45 * lie), ds * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.translate(fx, fy);
        ctx.rotate(angle);
        const smooth0 = ctx.imageSmoothingEnabled;
        for (const td of tiles) {
            const img = td.sheetPath ? CustomObjects.getImage(td.sheetPath) : (def.sheetPath ? CustomObjects.getImage(def.sheetPath) : null);
            if (!img || !img.complete) continue;
            const k = renderer._sheetScale(img);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(img, td.sx * k, td.sy * k, td.sw * k, td.sh * k,
                Math.floor(ax + td.localCol * ds) - fx, Math.floor(ay + td.localRow * ds) - fy, cs, cs);
        }
        ctx.imageSmoothingEnabled = smooth0;
        ctx.restore();
    },

    // ── Each frame ──

    update(dt) {
        if (!(dt > 0)) return;
        for (const s of this._shakes) s.age += dt;
        this._shakes = this._shakes.filter(s => s.age < 0.6);
        for (const p of this._parts) {
            p.age += dt;
            if (p.kind === 'dust') {
                p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
                continue;
            }
            if (p.y < p.ground) {
                p.vy += p.g * dt;
                if (p.kind === 'leaf' || p.kind === 'snow') {
                    p.vy = Math.min(p.vy, p.kind === 'snow' ? 40 : 22);
                    p.x += Math.sin(p.age * 3 + p.sway) * 12 * dt;
                }
                p.x += p.vx * dt; p.y += p.vy * dt;
                p.spin += dt * 8;
                if (p.y >= p.ground) { p.y = p.ground; p.vx = 0; p.vy = 0; }
            }
        }
        this._parts = this._parts.filter(p => p.age < p.life);
        for (const x of this._xp) x.age += dt;
        this._xp = this._xp.filter(x => x.age < 1.8);
    },

    /** The chips, leaves, dust and XP, over everything else. */
    drawParticles(ctx, camera) {
        if (!this._parts.length && !this._xp.length) return;
        const z = camera.zoom;
        ctx.save();
        for (const p of this._parts) {
            const s = camera.worldToScreenFast(p.x, p.y);
            const sx = s.x, sy = s.y;
            const fade = Math.min(1, (p.life - p.age) / 0.35);
            if (p.kind === 'dust') {
                const grow = 1 + p.age * 1.8;
                ctx.fillStyle = `${p.color}${(0.3 * fade).toFixed(3)})`;
                ctx.beginPath();
                ctx.arc(sx, sy, p.size * z * grow, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }
            ctx.globalAlpha = fade;
            ctx.fillStyle = p.color;
            const w = p.size * z, h = (p.kind === 'leaf' ? p.size * 0.6 : p.kind === 'snow' ? p.size : p.size * 0.55) * z;
            ctx.save();
            ctx.translate(sx, sy);
            if (p.kind !== 'snow') ctx.rotate(p.spin);
            if (p.kind === 'snow') {
                ctx.beginPath(); ctx.arc(0, 0, w * 0.6, 0, Math.PI * 2); ctx.fill();
            } else {
                ctx.fillRect(-w / 2, -h / 2, w, h);
                if (p.kind === 'chip') { ctx.fillStyle = 'rgba(90,60,30,0.6)'; ctx.fillRect(-w / 2, h / 2 - Math.max(0.5, h * 0.3), w, Math.max(0.5, h * 0.3)); }
            }
            ctx.restore();
            ctx.globalAlpha = 1;
        }
        for (const x of this._xp) {
            const s = camera.worldToScreenFast(x.x, x.y);
            const p = x.age / 1.8;
            ctx.globalAlpha = p < 0.1 ? p / 0.1 : p > 0.7 ? Math.max(0, 1 - (p - 0.7) / 0.3) : 1;
            drawMapText(ctx, x.text, s.x, s.y - p * 26 * labelZoom(z), { size: 13 * labelZoom(z), min: 11, family: 'body', weight: 800, color: '#ffd27a' });
        }
        ctx.restore();
    },

    /** Drop everything (a new map). */
    reset() {
        this._parts = [];
        this._shakes = [];
        this._xp = [];
    },
};
