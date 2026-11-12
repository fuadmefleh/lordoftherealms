// ============================================
// CARTS — handcarts and merchants' wagons on the street map: the rules
// ============================================
// Pure decisions over explicit params, no globals, no dice (a pick is a hash
// of who and when, so a reload tells the same story). ui/innerMapCarts.js
// applies them on the street map; world/innerMap/carts.js keeps the ground a
// cart takes up.
//
//   A cart is a train behind whoever leads it: the leader (a carter between
//   the handles, a merchant at the horse's head, the player) on the front
//   tile, the cart's body on the `length` tiles behind (`trail`, front first).
//
//   follow(cart, from, to)  — the leader stepped from→to: the body follows on
//   stepAllowed(...)        — a cart never steps onto anyone, another cart, water, a wall or a door
//   pushSpeed(player, cart) — the player's walk while hauling it (laden: slower)
//   canUse(cart, ctx)       — may the player take its handles / lay someone on it (theft of use?)
//   plagueRound(doors, from)— the death cart's round: marked doors, nearest first
//   bodiesDue(folk, day)    — the town's dead of these last days, for the cart
//   departingCaravan(...)   — a trade caravan leaving this town today
//   owns(player)            — the player has a handcart of their own (the market good)
//
// Data: data/carts.json.

import { DataLoader } from '../core/dataLoader.js';

const DEFAULTS = {
    enabled: true,
    art: {},
    kinds: {
        handcart: { name: 'handcart', length: 1, speed: 0.8, good: 'handcart', icon: '🛒' },
        wagon: { name: "merchant's wagon", length: 2, speed: 0.7, icon: '🐴' },
    },
    push: { base: 0.62, perStrength: 0.02, max: 0.8, laden: 0.8 },
    use: { seenWithin: 7, crimeScale: 0.4, disposition: -12, reach: 1 },
    carters: { hours: [6, 11], max: 2, gapSecs: 40, minStores: 2, jobs: ['carter'], from: [], to: [], parkedMax: 2, lines: [] },
    plague: { hours: [[5, 9], [18, 22]], stopSecs: 7, bodyDays: 3, maxBodies: 4, maxDoors: 8, lines: {} },
    caravan: { hours: [6, 13], loadSecs: 30, porters: 2, lines: {} },
    lines: {},
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

/** A well-mixed hash of a string, in [0, 1). */
function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

let _cfg = null;
let _cfgSrc;

export const Carts = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.carts : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const kinds = {};
            for (const [k, v] of Object.entries({ ...DEFAULTS.kinds, ...(_obj(d.kinds) || {}) })) kinds[k] = { ...(DEFAULTS.kinds[k] || {}), ...(_obj(v) || {}) };
            _cfg = {
                enabled: d.enabled !== false,
                art: _obj(d.art) || {},
                kinds,
                push: { ...DEFAULTS.push, ...(_obj(d.push) || {}) },
                use: { ...DEFAULTS.use, ...(_obj(d.use) || {}) },
                carters: { ...DEFAULTS.carters, ...(_obj(d.carters) || {}) },
                plague: { ...DEFAULTS.plague, ...(_obj(d.plague) || {}) },
                caravan: { ...DEFAULTS.caravan, ...(_obj(d.caravan) || {}) },
                lines: { ...DEFAULTS.lines, ...(_obj(d.lines) || {}) },
            };
        }
        return _cfg;
    },

    on() { return Carts.config().enabled; },

    kind(k) { return Carts.config().kinds[k] || Carts.config().kinds.handcart; },

    /** The tiles a cart's body takes behind its leader. */
    length(cart) { return Math.max(1, Math.round(_num(Carts.kind(cart && cart.kind).length, 1))); },

    /** A line from a list (lines.<key>, or a section's lines), picked by a hash of `salt`; {vars} filled in. */
    line(list, salt = '', vars = {}) {
        if (!Array.isArray(list) || !list.length) return '';
        const s = list[Math.floor(_frac(salt) * list.length) % list.length];
        return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    },

    /** Is the hour within [a, b) (a list of windows, or one)? */
    inHours(hour, hours) {
        const wins = Array.isArray(hours) && Array.isArray(hours[0]) ? hours : [hours];
        return wins.some(w => Array.isArray(w) && hour >= _num(w[0]) && hour < _num(w[1], 24));
    },

    // ──────────── THE TRAIN ────────────

    /**
     * A new cart standing behind (lq, lr), its body on the tiles `behind` (front first).
     * @returns {object} { id, kind, variant, trail:[{q,r}], tiles (same), facing, parked, ... }
     */
    make(id, kind, behind, opts = {}) {
        const trail = (behind || []).map(t => ({ q: t.q, r: t.r }));
        return {
            id, kind: kind || 'handcart', variant: opts.variant || 'empty',
            trail, tiles: trail,
            facing: opts.facing != null ? opts.facing : 2,
            parked: opts.parked !== false,
            owner: opts.owner || 'town',
            driver: null, pusher: null, load: null, bodies: 0, goods: opts.goods || null,
            job: opts.job || null,
        };
    },

    /** The facing (0 up, 1 left, 2 down, 3 right) of a step from a to b. */
    facingOf(a, b) {
        const dq = b.q - a.q, dr = b.r - a.r;
        if (Math.abs(dq) >= Math.abs(dr)) return dq >= 0 ? 3 : 1;
        return dr >= 0 ? 2 : 0;
    },

    /**
     * The leader stepped from `from` to `to`: the body follows on, the front of it onto
     * the tile the leader left (a cart turned about in place when the leader stepped
     * back onto it). Faces the way it now points (from its front to the leader).
     */
    follow(cart, from, to) {
        const n = Carts.length(cart);
        const trail = [{ q: from.q, r: from.r }, ...cart.trail.filter(t => !(t.q === from.q && t.r === from.r))];
        // (the leader stepped back onto the body: what was there turns about)
        cart.trail = trail.filter(t => !(t.q === to.q && t.r === to.r)).slice(0, n);
        cart.tiles = cart.trail;
        cart.facing = Carts.facingOf(cart.trail[0], to);
        return cart;
    },

    /**
     * May the leader of `cart` step onto (q, r)?
     * @param {object} cart
     * @param {{q,r}} to
     * @param {object} ctx { ground(q,r): wheels can go there, taken(q,r): someone stands there, cartAt(q,r): a cart there }
     */
    stepAllowed(cart, to, ctx) {
        if (!ctx.ground(to.q, to.r)) return false;
        if (ctx.taken(to.q, to.r)) return false;
        const other = ctx.cartAt(to.q, to.r);
        // (its own body: the leader turning back onto it, the cart turns about)
        return !other || other === cart;
    },

    // ──────────── THE PLAYER AT THE HANDLES ────────────

    /** The share of the player's walk while hauling `cart` (strength helps; laden is slower). */
    pushSpeed(player, cart) {
        const P = Carts.config().push;
        const str = _num(player && player.strength, 5);
        let f = _num(P.base, 0.62) + Math.max(0, str - 5) * _num(P.perStrength, 0);
        f = Math.min(_num(P.max, 0.8), f);
        if (cart && (cart.load || cart.bodies > 0 || cart.variant === 'loaded')) f *= _num(P.laden, 0.8);
        return Math.max(0.2, f);
    },

    /**
     * May the player take this cart's handles (or lay someone on it)?
     * @param {object} cart
     * @param {object} ctx { near: within reach, pusher: the player already hauls a cart }
     * @returns {{ ok:boolean, theft:boolean, reason:string|null }}
     */
    canUse(cart, ctx = {}) {
        if (!cart) return { ok: false, theft: false, reason: 'no cart' };
        if (cart.kind !== 'handcart') return { ok: false, theft: false, reason: 'a wagon' };
        if (cart.driver) return { ok: false, theft: false, reason: 'someone is pulling it' };
        if (cart.job === 'plague') return { ok: false, theft: false, reason: 'the death cart' };
        if (ctx.near === false) return { ok: false, theft: false, reason: 'too far' };
        const mine = cart.owner === 'player';
        return { ok: true, theft: !mine && !cart._takenBy, reason: null };
    },

    /** Has the player a handcart of their own (the market good, in the pack)? */
    owns(player) {
        const good = Carts.kind('handcart').good || 'handcart';
        const inv = player && player.inventory;
        if (!inv) return false;
        if (typeof inv.getQuantity === 'function') return inv.getQuantity(good) > 0;
        if (typeof inv.get === 'function') return _num(inv.get(good)) > 0;
        return _num(inv[good]) > 0;
    },

    // ──────────── THE DEATH CART ────────────

    /**
     * The death cart's round: the marked doors, each next the nearest to the last, from `from`.
     * @param {Array<{q,r}>} doors the doorsteps of the houses with plague in them
     * @returns {Array<{q,r}>}
     */
    plagueRound(doors, from, max = 8) {
        const left = (doors || []).filter(Boolean).map(d => ({ ...d }));
        const out = [];
        let at = from;
        while (left.length && out.length < max) {
            let bi = 0, bd = Infinity;
            left.forEach((d, i) => {
                const dist = Math.abs(d.q - at.q) + Math.abs(d.r - at.r);
                if (dist < bd || (dist === bd && (d.q < left[bi].q || (d.q === left[bi].q && d.r < left[bi].r)))) { bd = dist; bi = i; }
            });
            at = left.splice(bi, 1)[0];
            out.push(at);
        }
        return out;
    },

    /** The town's dead these last `days` days (its annals' 'died'), for the death cart: [entry]. */
    bodiesDue(folk, day, days = 3, max = 4) {
        const ann = folk && Array.isArray(folk.annals) ? folk.annals : [];
        return ann.filter(e => e && e.k === 'died' && day - _num(e.d) <= days && day >= _num(e.d)).slice(-max);
    },

    /**
     * How many bodies the cart takes up at the i-th door of a round of n (the dead shared
     * out along the round, the earlier doors first).
     */
    bodiesAt(i, n, dead) {
        if (n <= 0 || dead <= 0) return 0;
        const per = Math.floor(dead / n), extra = dead % n;
        return per + (i < extra ? 1 : 0);
    },

    // ──────────── THE CARAVAN ────────────

    /**
     * A trade caravan leaving this town today (systems/merchantCaravans.js trade_caravan units
     * on world.units, set out from (q, r) on `day`), or null.
     */
    departingCaravan(world, q, r, day) {
        const units = world && Array.isArray(world.units) ? world.units : [];
        return units.find(u => u && !u.destroyed && u.type === 'trade_caravan' && u.sourceQ === q && u.sourceR === r
            && _num(u.departed, -1) === day) || null;
    },

    /** The good a caravan carries most of, as a word for the lines. */
    cargoWord(unit) {
        const g = unit && unit.mainGood;
        return g ? String(g).replace(/_/g, ' ') : 'goods';
    },

    // ──────────── SEEN ────────────

    /** Who of `npcs` sees the player at (q, r) take a cart not theirs: awake, outdoors, within reach. */
    witnesses(npcs, at, reach = 7) {
        return (npcs || []).filter(n => n && n.state !== 'gone' && n.state !== 'inside_building' && n.state !== 'unconscious'
            && n.state !== 'bound' && !n._carried && !n._onCart && _cheb(n, at) <= reach);
    },
};
