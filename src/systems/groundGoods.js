// ============================================
// GROUND GOODS — what is left lying about, hex by hex
// ============================================
// Goods set down on the ground stay in the WORLD, not on the throwaway street
// map: a store per world hex, saved with the world.
//
//   world.groundGoods = {
//     seq,                       — the next pile's number
//     hexes: { 'q,r': [pile] },  — what lies on each hex
//     books: { left, picked, destroyed, rotted, eaten, taken: { where: { good: n } } },
//     gone:  { 'q,r': [{ good, qty, who, day }] } — the player's piles carried
//            off while they were away (told once, rolled up, on their return)
//   }
//   pile: { id, good, qty, grades: { gradeId: n } (the non-Common units),
//           by: 'player' | 'market' | 'townsfolk' | …, byName, day,
//           spot: { q, r } — where on the hex's street map it lies (null: not
//                 yet set down on a map: the street map finds it a place),
//           refuse — a town's spoiled food thrown out in the street,
//           claim: { owner, name, until } — set down, not abandoned: lifting
//                 it while the owner is about is theft (pickUp) }
//
// Where it goes (nothing vanishes):
//   - dropped (drop / leave): out of the packs (their grades with them) onto
//     the hex; the same good set down by the same hand on the same spot
//     merges. A hex holds perHex piles at most (a full hex takes no more).
//   - thrown away (throwAway): destroyed on purpose — gone for good, booked
//     in books.destroyed so no census thinks it leaked.
//   - rotting: a perishable (its spoil rate in data/markets.json, × rotMult
//     out in the weather) loses whole units as the fraction mounts; booked in
//     books.rotted.
//   - taken by others (processDay, and the street map's scavengers through
//     takeBy): each day a pile past its grace may be carried off — likelier
//     in a town than on a road, on a road than in the wilds, and the more it
//     is worth. What is taken goes somewhere real: in a town (or carried to
//     the nearest one by a traveller or a woodsman) a good the market trades
//     is sold into the market's stock, any other kept in the townsfolk's
//     houses (settlement.finds); a trader on the hex loads it in its cargo; in
//     the wilds outlaws near (an active lair within lairRange) bank it in the
//     lair's hoard; refuse is eaten by the beggars who clear it (books.eaten).
//   - refuse: a town's market now and then throws out a little of its rotting
//     food (out of its stock: it was spoiling there anyway).
//
// No import-time effects. No shared RNG: every chance is a hash of the world
// seed, the pile and the day, so the tick never moves another system's dice.
// Settings: data/groundGoods.json.

import { DataLoader } from '../core/dataLoader.js';
import { Grades } from '../core/grades.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { Economy } from '../world/economy.js';
import { Arms } from './arms.js';
import { Containers } from './containers.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => (world && Number.isFinite(world.day) ? world.day : 0);

const DEFAULTS = {
    enabled: true,
    take: { town: 0.35, road: 0.14, wilds: 0.025 },
    valueAt: 40,
    valueMax: 2.5,
    graceDays: 1,
    rotMult: 3,
    lairRange: 3,
    perHex: 16,
    totalCap: 900,
    claimDays: 1,
    ownerSight: 8,
    confirmValue: 40,
    streetScanSeconds: 3,
    streetRadius: 14,
    streetKneelSeconds: 2.5,
    refuse: { enabled: true, chance: 0.12, goods: ['bread', 'fish', 'meat'], maxQty: 3 },
    inside: { take: 0.4, publicTypes: ['tavern', 'inn', 'church', 'temple'], publicTakers: ['the potboy'], homeTakers: ['the household'], clearers: ['a servant'] },
    setDown: { enabled: true, range: 8, perTown: 2, reclaim: 0.9, kinds: {} },
    retinue: { enabled: true, stay: 0.45, pass: 0.12, valuableAt: 30, headGrab: 0.7, sellDiscount: 0.6, useShare: 0.25 },
    finds: { cap: 40, use: 0.02, trickle: 0.25, discount: 0.6 },
    kinds: { meat: { spoil: 0.05 }, arrows: {}, salvage: { sinkDays: 90 } },
    takers: {
        town: ['a beggar', 'a scavenger', 'a townsman'],
        road: ['a traveller', 'a carter'],
        wilds: ['a wanderer'],
        outlaws: ['outlaws'],
    },
};
// The order units of a pile are handed out in: Common first, then the rest
const GRADE_ORDER = ['common', 'poor', 'fine', 'excellent', 'masterwork'];

/** A hash in [0, 1). */
function _frac(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}
const _pick = (arr, seed) => (Array.isArray(arr) && arr.length ? arr[Math.floor(_frac(seed) * arr.length) % arr.length] : null);
const _seed = (world) => (world && world.generationParams && world.generationParams.seed) || 0;
const _add = (obj, k, n) => { obj[k] = Math.round((_num(obj[k]) + n) * 100) / 100; };
/** Book `n` units into the ledger's flows: dir 'in' (by source) or 'out' (by end). */
const _flow = (st, dir, key, n) => { if (st && n > 0) _add(st.books.flow[dir], key, n); };

export const GroundGoods = {
    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.groundGoods;
        if (this._cfgSrc !== src || !this._cfg) {
            this._cfgSrc = src;
            const s = src || {};
            this._cfg = {
                ...DEFAULTS, ...s,
                take: { ...DEFAULTS.take, ...(s.take || {}) },
                refuse: { ...DEFAULTS.refuse, ...(s.refuse || {}) },
                takers: { ...DEFAULTS.takers, ...(s.takers || {}) },
                inside: { ...DEFAULTS.inside, ...(s.inside || {}) },
                setDown: { ...DEFAULTS.setDown, ...(s.setDown || {}) },
                retinue: { ...DEFAULTS.retinue, ...(s.retinue || {}) },
                finds: { ...DEFAULTS.finds, ...(s.finds || {}) },
                kinds: { ...DEFAULTS.kinds, ...(s.kinds || {}) },
            };
        }
        return this._cfg;
    },

    /** The world's store (created / backfilled). */
    state(world, create = true) {
        if (!world) return null;
        let st = world.groundGoods;
        if (!st || typeof st !== 'object') {
            if (!create) return null;
            st = world.groundGoods = {};
        }
        if (!(st.seq > 0)) st.seq = 1;
        if (!st.hexes || typeof st.hexes !== 'object') st.hexes = {};
        if (!st.gone || typeof st.gone !== 'object') st.gone = {};
        const b = st.books && typeof st.books === 'object' ? st.books : (st.books = {});
        for (const k of ['left', 'picked', 'destroyed', 'rotted', 'eaten', 'reclaimed', 'cleared', 'sunk']) if (!b[k] || typeof b[k] !== 'object') b[k] = {};
        if (!b.taken || typeof b.taken !== 'object') b.taken = {};
        if (!b.finds || typeof b.finds !== 'object') b.finds = { toMarket: 0, used: 0, sold: 0 };
        // The ledger's flows (units, by source and by end): a store kept before the
        // ledger opens with what lay about then (goodsLedger)
        if (!b.flow || typeof b.flow !== 'object' || !b.flow.in || !b.flow.out) {
            b.flow = { in: {}, out: {} };
            let held = 0;
            for (const k in st.hexes) for (const p of st.hexes[k] || []) held += _num(p && p.qty);
            b.opening = held;
        }
        if (!Number.isFinite(b.opening)) b.opening = 0;
        return st;
    },

    key(q, r) { return `${q},${r}`; },

    /** The piles on a hex (a live array; [] when none). */
    at(world, q, r) {
        const st = GroundGoods.state(world, false);
        return (st && st.hexes[GroundGoods.key(q, r)]) || [];
    },

    find(world, q, r, id) {
        return GroundGoods.at(world, q, r).find(p => p.id === id) || null;
    },

    /** How many piles lie about the whole world. */
    count(world) {
        const st = GroundGoods.state(world, false);
        if (!st) return 0;
        let n = 0;
        for (const k in st.hexes) n += st.hexes[k].length;
        return n;
    },

    // ── What a good is ──

    _goodDef(good) {
        const G = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        return G[String(good).toUpperCase()] || null;
    },

    nameOf(good) {
        if (Arms.isArms(good)) return Arms.nameOf(good);
        const g = GroundGoods._goodDef(good);
        return (g && g.name) || String(good).replace(/_/g, ' ');
    },

    iconOf(good) {
        if (Arms.isArms(good)) return Arms.iconOf(good) || '🗡️';
        const g = GroundGoods._goodDef(good);
        return (g && g.icon) || '📦';
    },

    /** "5 bread", "a cheese" */
    describe(good, n) {
        const name = GroundGoods.nameOf(good).toLowerCase();
        return n === 1 ? `1 ${name}` : `${n} ${name}`;
    },

    /** What `n` units of `good` from a holder's stack are worth (base price × their grades). */
    worth(holder, good, n) {
        const base = PlayerInventory.goodValue(good) || (Arms.isArms(good) ? _num((Arms.item(good) || {}).price) : 0);
        const g = holder ? Grades.peek(holder, good, n, { order: 'best' }) : null;
        return Math.round(base * n * (g ? g.price : 1));
    },

    /** A pile's worth (base price × its grades). */
    pileWorth(pile) {
        const base = PlayerInventory.goodValue(pile.good) || (Arms.isArms(pile.good) ? _num((Arms.item(pile.good) || {}).price) : 0);
        let units = 0, mult = 0;
        for (const [g, n] of Object.entries(pile.grades || {})) { units += n; mult += n * Grades.priceMult(g); }
        mult += Math.max(0, pile.qty - units);
        return Math.round(base * mult);
    },

    /** How many of a stack are worn (arms in their slot): those stay on until put away. */
    wornCount(player, good) {
        return Arms.isArms(good) && Arms.isEquipped(player, good) ? 1 : 0;
    },

    /** The most of a stack that can be set down or thrown away (the worn piece stays on). */
    spare(player, good) {
        const have = Math.floor(_num(player && player.inventory && player.inventory[good]));
        return Math.max(0, have - GroundGoods.wornCount(player, good));
    },

    /** Why `n` of a good can't leave the packs, or null. */
    blocked(player, good, n = 1) {
        const have = Math.floor(_num(player && player.inventory && player.inventory[good]));
        if (!(have > 0)) return 'You have none of that left.';
        if (n > GroundGoods.spare(player, good)) return have > 1 ? 'One is worn: put it away first, or set down fewer.' : 'You are wearing it: put it away first.';
        return null;
    },

    /** A caution before parting with it (goods a quest wants carried), or null. */
    caution(player, good) {
        const qs = player && player.quests && Array.isArray(player.quests.active) ? player.quests.active : [];
        for (const q of qs) {
            for (const o of (q && q.objectives) || []) {
                if (o && o.type === 'deliver_item' && o.item === good && !o.completed) return `${q.title || 'A quest'} wants ${_num(o.target)} of these carried.`;
            }
        }
        return null;
    },

    // ── Into the world ──

    /** Take `n` units (their grades) out of a holder's packs → the grade mix drawn. */
    _outOfPacks(holder, good, n) {
        const res = Grades.take(holder, good, n, { order: 'worst' });
        const inv = holder.inventory;
        inv[good] = _num(inv[good]) - n;
        if (!(inv[good] > 0)) delete inv[good];
        const grades = {};
        for (const [g, k] of Object.entries(res.drawn || {})) if (g !== 'common' && k > 0) grades[g] = k;
        return grades;
    },

    /**
     * Set a pile on a hex (the low-level door: the player's drops, a market's
     * refuse, tests). Merges with the same good set down by the same hand on
     * the same spot. → the pile, or null when the hex is full.
     */
    leave(world, q, r, good, qty, o = {}) {
        const n = Math.floor(_num(qty));
        if (!world || !good || !(n > 0)) return null;
        const st = GroundGoods.state(world);
        const k = GroundGoods.key(q, r);
        const list = st.hexes[k] || [];
        const by = o.by || 'someone';
        const spot = o.spot && Number.isFinite(o.spot.q) ? { q: o.spot.q, r: o.spot.r } : null;
        const same = o.claim || _num(o.gold) > 0 ? null : list.find(p => p.good === good && p.by === by && !!p.refuse === !!o.refuse
            && (p.kind || null) === (o.kind || null) && !p.claim && !p.gold && (p.inside || null) === (o.inside || null)
            && (spot ? (p.spot && p.spot.q === spot.q && p.spot.r === spot.r) : !p.spot));
        const day = o.day != null ? o.day : _day(world);
        let pile = same;
        if (pile) {
            pile.qty += n;
            pile.day = day;
        } else {
            if (list.length >= _num(GroundGoods.config().perHex, 16)) return null;
            pile = { id: `g${st.seq++}`, good, qty: n, grades: {}, by, byName: o.byName || null, day, spot };
            if (o.refuse) pile.refuse = true;
            if (o.claim) {
                pile.claim = { owner: o.claim.owner, name: o.claim.name || null, until: _num(o.claim.until, day) };
                for (const f of ['kind', 'from', 'backHour', 'want']) if (o.claim[f] != null) pile.claim[f] = o.claim[f];
            }
            // A kind drawn as itself on the street map (butchered meat, a spent arrow, wreck salvage)
            if (o.kind) pile.kind = o.kind;
            if (o.label) pile.label = o.label;
            if (o.icon) pile.icon = o.icon;
            if (o.salvage) pile.salvage = { ...o.salvage };
            if (_num(o.gold) > 0) pile.gold = Math.round(_num(o.gold));
            if (o.inside) pile.inside = o.inside;
            list.push(pile);
            st.hexes[k] = list;
        }
        for (const [g, c] of Object.entries(o.grades || {})) if (c > 0) _add(pile.grades, g, c);
        _add(st.books.left, good, n);
        _flow(st, 'in', o.src || (o.refuse ? 'refuse' : o.kind || (by === 'player' ? 'player' : 'other')), n);
        return pile;
    },

    /**
     * The player sets `qty` of a good down on hex (q, r) (o.spot: the street
     * map's tile it lies on). → { ok, n, pile, reason }
     */
    drop(world, player, good, qty, o = {}) {
        const n = Math.max(1, Math.floor(_num(qty, 1)));
        const why = GroundGoods.blocked(player, good, n);
        if (why) return { ok: false, reason: why };
        const st = GroundGoods.state(world);
        const list = st.hexes[GroundGoods.key(o.q, o.r)] || [];
        const merges = list.some(p => p.good === good && p.by === 'player' && !p.refuse && !p.kind && (p.inside || null) === (o.inside || null)
            && (o.spot ? (p.spot && p.spot.q === o.spot.q && p.spot.r === o.spot.r) : !p.spot));
        if (!merges && list.length >= _num(GroundGoods.config().perHex, 16)) return { ok: false, reason: 'The ground here is heaped with things already: there is no room to set more down.' };
        const grades = GroundGoods._outOfPacks(player, good, n);
        const pile = GroundGoods.leave(world, o.q, o.r, good, n, { by: 'player', byName: player.name || 'you', grades, day: o.day, spot: o.spot, inside: o.inside || null, src: 'player' });
        if (pile && o.insideOwn) pile.insideOwn = true;
        return { ok: true, n, pile };
    },

    /**
     * Throw away: destroyed on purpose, gone for good (booked in books.destroyed).
     * → { ok, n, value, reason }
     */
    throwAway(world, player, good, qty) {
        const n = Math.max(1, Math.floor(_num(qty, 1)));
        const why = GroundGoods.blocked(player, good, n);
        if (why) return { ok: false, reason: why };
        const value = GroundGoods.worth(player, good, n);
        GroundGoods._outOfPacks(player, good, n);
        const st = GroundGoods.state(world);
        _add(st.books.destroyed, good, n);
        return { ok: true, n, value };
    },

    /** Units off a pile (Common first), its grade record with them → { gradeId: n } (non-Common). */
    _offPile(pile, n) {
        const graded = Object.values(pile.grades || {}).reduce((a, b) => a + b, 0);
        let left = n;
        const out = {};
        for (const g of GRADE_ORDER) {
            if (left <= 0) break;
            const have = g === 'common' ? Math.max(0, pile.qty - graded) : _num(pile.grades[g]);
            const k = Math.min(left, have);
            if (!(k > 0)) continue;
            left -= k;
            if (g !== 'common') {
                out[g] = k;
                pile.grades[g] = have - k;
                if (!(pile.grades[g] > 0)) delete pile.grades[g];
            }
        }
        pile.qty -= n;
        return out;
    },

    _remove(world, q, r, pile) {
        const st = GroundGoods.state(world);
        const k = GroundGoods.key(q, r);
        const list = st.hexes[k];
        if (!list) return;
        const i = list.indexOf(pile);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) delete st.hexes[k];
    },

    /** Is a pile someone else's still (set down, not abandoned)? */
    claimed(pile, day, who = 'player') {
        return !!(pile && pile.claim && pile.claim.owner !== who && day <= _num(pile.claim.until));
    },

    /**
     * The player picks up `qty` of a pile (as much as the packs take).
     * Someone else's goods just set down (a claim, the owner about —
     * o.ownerNear, default true) are stolen: Containers.stealGoods, with
     * o.scene the witnesses and o.ctx the place. → { ok, n, theft, caught, text, reason }
     */
    pickUp(world, player, q, r, pileId, qty, o = {}) {
        const pile = GroundGoods.find(world, q, r, pileId);
        if (!pile) return { ok: false, reason: 'It is no longer there.' };
        const day = o.day != null ? o.day : _day(world);
        const st = GroundGoods.state(world);
        // A wreck's strongbox: its coin is the caller's to pay out (PlayerCoin.found, a layer up); the box is gone
        if (_num(pile.gold) > 0) {
            GroundGoods._remove(world, q, r, pile);
            _add(st.books.picked, pile.good, pile.qty);
            _flow(st, 'out', 'picked', pile.qty);
            return { ok: true, n: pile.qty, gold: pile.gold, left: 0, text: `You prise the strongbox open: ${pile.gold} gold.` };
        }
        let n = Math.min(pile.qty, Math.max(1, Math.floor(_num(qty, pile.qty))));
        if (GroundGoods.claimed(pile, day) && o.ownerNear !== false) {
            const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
            const ctx = {
                building: null, inSettlement: !!(tile && tile.settlement), kingdom: (tile && (tile.kingdom || (tile.settlement && tile.settlement.kingdom))) || null,
                settlementName: tile && tile.settlement ? tile.settlement.name : null, worldQ: q, worldR: r,
                ownerName: pile.claim.name || pile.byName || null, ...(o.ctx || {}),
            };
            const res = Containers.stealGoods(player, world, ctx, pile.good, n, o.scene || {});
            if (!res.ok) return { ok: false, theft: true, caught: !!res.caught, text: res.text, reason: res.text };
            GroundGoods._offPile(pile, n);
            if (pile.qty <= 0) GroundGoods._remove(world, q, r, pile);
            _add(st.books.picked, pile.good, n);
            _flow(st, 'out', 'picked', n);
            return { ok: true, n, theft: true, caught: false, text: res.text };
        }
        const add = PlayerInventory.addItem(player, pile.good, n, { partial: true });
        if (!add.success) return { ok: false, reason: add.reason || PlayerInventory.fullMessage(player) };
        n = add.added;
        const grades = GroundGoods._offPile(pile, n);
        Grades.addMix(player, pile.good, grades);
        if (pile.qty <= 0) GroundGoods._remove(world, q, r, pile);
        _add(st.books.picked, pile.good, n);
        _flow(st, 'out', 'picked', n);
        const left = pile.qty > 0 ? pile.qty : 0;
        return { ok: true, n, left, text: `You pick up ${GroundGoods.describe(pile.good, n)}${left ? ` (${left} left on the ground)` : ''}.` };
    },

    // ── Others take it ──

    /** What kind of place a hex is for finding things: 'town' | 'road' | 'wilds'. */
    placeOf(tile) {
        if (!tile) return 'wilds';
        if (tile.settlement) return 'town';
        if (tile.hasRoad || tile.infrastructure) return 'road';
        return 'wilds';
    },

    /** The daily chance someone carries a pile off. */
    takeChance(pile, place) {
        const C = GroundGoods.config();
        let c = _num(C.take[place], 0);
        const v = GroundGoods.pileWorth(pile);
        c *= Math.min(_num(C.valueMax, 2.5), 1 + v / Math.max(1, _num(C.valueAt, 40)));
        if (pile.refuse) c *= 1.5;
        return Math.min(0.95, c);
    },

    /** The nearest town to (q, r) (cached for a tick in views). */
    _nearestTown(world, q, r, views) {
        let best = null, bd = Infinity;
        const w = world.width || 0;
        for (const s of views || []) {
            if (!s || !Number.isFinite(s.q)) continue;
            const d = Hex.wrappingDistance(q, r, s.q, s.r, w);
            if (d < bd) { bd = d; best = s; }
        }
        return best;
    },

    /** A town's goods: the market's stock for a good it trades, else its folk's houses. → 'market' | 'house' */
    _intoTown(s, good, n) {
        if (SettlementMarket.tracks(good) && SettlementMarket.add(s, good, n) > 0) return 'market';
        if (!s.finds || typeof s.finds !== 'object') s.finds = {};
        _add(s.finds, good, n);
        return 'house';
    },

    /**
     * Someone carries `n` of a pile off (all of it by default) — the daily
     * tick's finder, or a street-map scavenger (who: { kind: 'town' | 'road'
     * | 'wilds', name }). It goes somewhere real. → { where, whereName, who, n } or null
     */
    takeBy(world, q, r, pileId, n = null, who = {}, opts = {}) {
        const pile = GroundGoods.find(world, q, r, pileId);
        if (!pile || _num(pile.gold) > 0) return null; // (a strongbox is left for whoever swims out to it)
        const k = Math.min(pile.qty, Math.max(1, Math.floor(_num(n, pile.qty))));
        const tile = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (pile.inside) return GroundGoods._takeInside(world, q, r, pile, k, tile, who, opts);
        const place = who.kind || GroundGoods.placeOf(tile);
        const views = opts.views || (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : []);
        const lairs = opts.lairs || [];
        const good = pile.good;
        let where = null, whereName = null, name = who.name || null;
        if (pile.refuse && SettlementMarket.good(good) && SettlementMarket.good(good).group === 'food' && place === 'town') {
            // Rotting food: the beggars who clear it eat it
            where = 'eaten';
            name = name || 'a beggar';
        } else if (place === 'town' && tile && tile.settlement) {
            where = GroundGoods._intoTown(tile.settlement, good, k);
            whereName = tile.settlement.name || 'the town';
        } else {
            // A trader on the road loads it; outlaws near the wilds bank it; anyone else sells it in the nearest town
            const trader = place === 'road' && SettlementMarket.tracks(good) && Array.isArray(world.units)
                ? world.units.find(u => u && !u.destroyed && u.q === q && u.r === r && u.cargo && typeof u.cargo === 'object' && /trade_/.test(String(u.type || '')))
                : null;
            const lair = !trader && place === 'wilds' ? lairs.find(l => l && l.hoard && Hex.wrappingDistance(q, r, l.q, l.r, world.width || 0) <= _num(GroundGoods.config().lairRange, 3)) : null;
            if (trader) {
                _add(trader.cargo, good, k);
                where = 'caravan';
                whereName = trader.name || 'a trader';
                name = name || 'a trader';
            } else if (lair) {
                if (!lair.hoard.goods || typeof lair.hoard.goods !== 'object') lair.hoard.goods = {};
                _add(lair.hoard.goods, good, k);
                where = 'lair';
                whereName = lair.name || 'an outlaw lair';
                name = name || _pick(GroundGoods.config().takers.outlaws, `${pile.id}|o`) || 'outlaws';
            } else {
                const s = GroundGoods._nearestTown(world, q, r, views);
                if (!s) return null; // (nobody anywhere to carry it off: it lies on)
                where = GroundGoods._intoTown(s, good, k);
                whereName = s.name || 'a town';
            }
        }
        name = name || _pick(GroundGoods.config().takers[place], `${pile.id}|${_day(world)}`) || 'someone';
        return GroundGoods._took(world, q, r, pile, k, where, whereName, name);
    },

    /** The books and the pile after `k` of it went to `where` → the taking. */
    _took(world, q, r, pile, k, where, whereName, name) {
        const st = GroundGoods.state(world);
        const good = pile.good;
        GroundGoods._offPile(pile, k); // (markets, hoards, larders keep no grades: the units are simply goods there)
        if (where === 'eaten' || where === 'cleared') _add(st.books[where], good, k);
        else {
            if (!st.books.taken[where]) st.books.taken[where] = {};
            _add(st.books.taken[where], good, k);
        }
        _flow(st, 'out', where === 'eaten' || where === 'cleared' ? where : `taken:${where}`, k);
        if (pile.qty <= 0) GroundGoods._remove(world, q, r, pile);
        return { where, whereName, who: name, n: k, good, by: pile.by };
    },

    /** The building a pile inside belongs to: { type, q, r } from its key ('tavern_12_8'). */
    insideOf(pile) {
        const m = pile && typeof pile.inside === 'string' ? /^(.*)_(-?\d+)_(-?\d+)$/.exec(pile.inside) : null;
        return m ? { type: m[1], q: Number(m[2]), r: Number(m[3]) } : null;
    },

    /** Is the building a public house (a tavern, a church: staff and patrons about)? */
    isPublic(type) {
        return (GroundGoods.config().inside.publicTypes || []).includes(type);
    },

    /**
     * Inside a building the people of the house take it: in a public house
     * (a tavern, a church) the staff or a patron (sold on in the town, or kept);
     * in a home its household, into the building's own larder or chest when it
     * keeps one (systems/containers.js settlement.larders), else into their
     * house (settlement.finds). Refuse the servants clear (food eaten, the rest
     * swept onto the midden: books.cleared).
     */
    _takeInside(world, q, r, pile, k, tile, who = {}, opts = {}) {
        const b = GroundGoods.insideOf(pile) || { type: 'house', q: 0, r: 0 };
        const town = tile && tile.settlement ? tile.settlement
            : GroundGoods._nearestTown(world, q, r, opts.views || (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : []));
        const pub = GroundGoods.isPublic(b.type);
        const I = GroundGoods.config().inside;
        const name = who.name || (pile.insideVacant ? I.vacantTaker || "the landlord's man" : null) || _pick(pub ? I.publicTakers : I.homeTakers, `${pile.id}|in|${_day(world)}`) || 'the household';
        if (pile.refuse) {
            const food = SettlementMarket.good(pile.good) && SettlementMarket.good(pile.good).group === 'food';
            return GroundGoods._took(world, q, r, pile, k, food ? 'eaten' : 'cleared', null, who.name || _pick(I.clearers, `${pile.id}|cl`) || 'a servant');
        }
        if (!pub && !pile.insideVacant && town && town.larders && typeof town.larders === 'object') {
            const tag = `|${b.type}@${b.q},${b.r}`;
            const key = Object.keys(town.larders).find(x => x.includes(tag + '|') || x.includes(tag + '~'));
            const rec = key ? town.larders[key] : null;
            if (rec && rec.stock && typeof rec.stock === 'object') {
                rec.stock[pile.good] = _num(rec.stock[pile.good]) + k;
                return GroundGoods._took(world, q, r, pile, k, 'larder', town.name || 'the town', name);
            }
        }
        if (!town) return null;
        const where = GroundGoods._intoTown(town, pile.good, k);
        return GroundGoods._took(world, q, r, pile, k, where, town.name || 'the town', name);
    },

    /** Where it went, in words. */
    whereWords(res) {
        if (!res) return '';
        switch (res.where) {
            case 'market': return `sold on in ${res.whereName}'s market`;
            case 'house': return `kept in a house in ${res.whereName}`;
            case 'caravan': return `loaded on ${res.whereName}`;
            case 'lair': return `carried off to ${res.whereName}`;
            case 'eaten': return 'eaten';
            case 'larder': return 'put away in the house\'s own store';
            case 'cleared': return 'swept out onto the midden';
            case 'rival': return `taken up by ${res.whereName || 'a rival House\'s retinue'}`;
            case 'owner': return 'taken back by its owner';
            default: return 'carried off';
        }
    },

    /** The piles of the player's carried off while away from a hex: the rolled-up line, told once. */
    goneLine(world, q, r) {
        const st = GroundGoods.state(world, false);
        const k = GroundGoods.key(q, r);
        const list = st && st.gone[k];
        if (!list || !list.length) return '';
        delete st.gone[k];
        const sum = {};
        for (const g of list) sum[g.good] = _num(sum[g.good]) + g.qty;
        return `What you left here is gone: ${Object.entries(sum).map(([g, n]) => GroundGoods.describe(g, n)).join(', ')}. Someone took ${list.length > 1 ? 'them' : 'it'}.`;
    },

    /** Is a good one that goes off (butchered cuts: meat, offal, a haunch; not hide or bone)? */
    _perishable(good) {
        return !/(hide|pelt|fur|bone|antler|horn|feather|sinew|skull|tusk|ivory|leather)/.test(String(good));
    },

    /**
     * The day: owners take back what they set down (or leave it), people set
     * goods down near the player, perishables rot, others carry piles off
     * (inside a building its people), towns throw out a little spoiled food,
     * the townsfolk's houses use what they keep, and the books are closed.
     * opts.views / opts.lairs for tests. → { notices }
     */
    processDay(world, player, day = _day(world), opts = {}) {
        const notices = [];
        const C = GroundGoods.config();
        if (!world || !C.enabled) return { notices };
        const st = GroundGoods.state(world);
        const seed = _seed(world);
        const views = opts.views || (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : []);
        const lairs = opts.lairs || ((player && player.outlawLairs && Array.isArray(player.outlawLairs.lairs)) ? player.outlawLairs.lairs.filter(l => l && l.status === 'active') : []);
        // Yesterday's set-downs: taken back by their owners, or left behind
        GroundGoods._ownersBack(world, day, views);
        const told = {};
        for (const k of Object.keys(st.hexes)) {
            const list = st.hexes[k];
            const [q, r] = k.split(',').map(Number);
            const tile = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
            const place = GroundGoods.placeOf(tile);
            for (const pile of list.slice()) {
                // Rot: whole units as the fraction mounts (a butchered cut goes off as meat does)
                const m = SettlementMarket.good(pile.good);
                let spoil = m ? _num(m.spoil) : 0;
                const K = pile.kind ? C.kinds[pile.kind] : null;
                if (!(spoil > 0) && K && _num(K.spoil) > 0 && GroundGoods._perishable(pile.good)) spoil = _num(K.spoil);
                spoil *= _num(C.rotMult, 3) * (pile.refuse ? 2 : 1);
                if (spoil > 0) {
                    pile.rot = _num(pile.rot) + pile.qty * spoil;
                    const gone = Math.min(pile.qty, Math.floor(pile.rot + 1e-9));
                    if (gone > 0) {
                        pile.rot -= gone;
                        GroundGoods._offPile(pile, gone);
                        _add(st.books.rotted, pile.good, gone);
                        _flow(st, 'out', 'rotted', gone);
                        if (pile.qty <= 0) { GroundGoods._remove(world, q, r, pile); continue; }
                    }
                }
                // A strongbox in the shallows: nobody but a swimmer has it; in time the silt does
                if (_num(pile.gold) > 0) {
                    if (day - _num(pile.day) > _num(C.kinds.salvage && C.kinds.salvage.sinkDays, 90)) {
                        _add(st.books.sunk, pile.good, pile.qty);
                        _flow(st, 'out', 'sunk', pile.qty);
                        GroundGoods._remove(world, q, r, pile);
                    }
                    continue;
                }
                // Others: past its grace, not someone's set down, a hash against the day's chance
                if (day - _num(pile.day) < _num(C.graceDays, 1)) continue;
                if (GroundGoods.claimed(pile, day, null)) continue;
                if (opts.hold === k) continue;
                if (pile.inside && pile.insideOwn) continue; // (your own house: yours to leave about)
                const chance = pile.inside ? Math.min(0.95, _num(C.inside.take, 0.4) * (pile.refuse ? 1.5 : 1) * (pile.insideVacant ? _num(C.inside.vacantMult, 0.1) : 1)) : GroundGoods.takeChance(pile, place);
                if (_frac(`${seed}|gg|${pile.id}|${day}`) >= chance) continue;
                const res = GroundGoods.takeBy(world, q, r, pile.id, null, { kind: place }, { views, lairs });
                if (!res || res.by !== 'player') continue;
                const here = player && player.q === q && player.r === r;
                if (here) {
                    const t = told[k] || (told[k] = []);
                    t.push(`${res.who.charAt(0).toUpperCase()}${res.who.slice(1)} took your ${GroundGoods.describe(res.good, res.n)} (${GroundGoods.whereWords(res)}).`);
                } else {
                    (st.gone[k] = st.gone[k] || []).push({ good: res.good, qty: res.n, who: res.who, day });
                    if (st.gone[k].length > 20) st.gone[k].splice(0, st.gone[k].length - 20);
                }
            }
        }
        for (const lines of Object.values(told)) notices.push({ icon: '🖐️', title: 'Your Goods Taken', text: lines.slice(0, 3).join(' ') + (lines.length > 3 ? ` And ${lines.length - 3} more.` : ''), type: 'warning' });
        // Refuse: a town's market throws out a little of its rotting food (out of its stock)
        const R = C.refuse;
        if (R && R.enabled && Array.isArray(R.goods) && R.goods.length && GroundGoods.count(world) < _num(C.totalCap, 900)) {
            for (const s of views) {
                if (!s || !Number.isFinite(s.q) || !s.market) continue;
                if (_frac(`${seed}|refuse|${s.q},${s.r}|${day}`) >= _num(R.chance, 0.1)) continue;
                const good = _pick(R.goods, `${seed}|refuseGood|${s.q},${s.r}|${day}`);
                const have = SettlementMarket.available(s, good);
                if (have < 5) continue;
                const want = Math.max(1, Math.min(_num(R.maxQty, 3), Math.floor(have * _num((SettlementMarket.good(good) || {}).spoil) + 1e-9)));
                const got = Math.floor(SettlementMarket.take(s, good, want) + 1e-9);
                if (got > 0) GroundGoods.leave(world, s.q, s.r, good, got, { by: 'market', byName: `${s.name || 'the town'}'s market`, refuse: true, day });
            }
        }
        // People about the player set things down for the day (claimed: theirs till they come back)
        GroundGoods._setDownDay(world, player, day, views);
        // The townsfolk's houses: what they keep is used, sold on once a market deals in it
        GroundGoods._findsDay(world, day, views);
        st.census = GroundGoods.ledger(world);
        st.census.day = day;
        delete st.census.inBy; delete st.census.outBy; delete st.census.finds;
        return { notices };
    },

    // ── Set down, not abandoned: goods someone means to come back for ──

    /**
     * Someone sets goods down for a while (a stallholder's crates, a carter's
     * load while he rests, washing by a door, harvest sacks by the field, a
     * caravan's camp): out of where they were (the caller has taken them),
     * claimed till the day's end. o: { kind, owner, name, from: { kind:
     * 'market', q, r } | { kind: 'caravan', unitId }, day, backHour }. → the pile or null
     */
    setDown(world, q, r, good, qty, o = {}) {
        const day = o.day != null ? o.day : _day(world);
        const owner = o.owner || `${o.kind || 'someone'}:${q},${r}:${day}`;
        const claim = { owner, name: o.name || null, until: day, kind: o.kind || 'set', from: o.from || null,
            backHour: o.backHour != null ? o.backHour : 12 + Math.floor(_frac(`${owner}|${good}|back`) * 7) };
        return GroundGoods.leave(world, q, r, good, qty, { by: o.by || o.kind || 'townsfolk', byName: o.name || null, day, claim, src: 'setDown', spot: o.spot || null });
    },

    /** Where a set-down pile came from takes it back → { where, name } or null. */
    _backTo(world, pile, q, r, n, views) {
        const from = (pile.claim && pile.claim.from) || {};
        if (from.kind === 'market') {
            const t = typeof world.getTile === 'function' ? world.getTile(from.q, from.r) : null;
            if (t && t.settlement && SettlementMarket.add(t.settlement, pile.good, n) > 0) return { where: 'market', name: t.settlement.name };
        }
        if (from.kind === 'caravan') {
            const u = Array.isArray(world.units) ? world.units.find(x => x && x.id === from.unitId && !x.destroyed) : null;
            if (u) {
                if (!u.cargo || typeof u.cargo !== 'object') u.cargo = {};
                _add(u.cargo, pile.good, n);
                return { where: 'caravan', name: u.name || 'a trader' };
            }
        }
        // (the cart gone on, the stall packed up: it goes to the nearest town all the same)
        const s = GroundGoods._nearestTown(world, q, r, views);
        return s ? { where: GroundGoods._intoTown(s, pile.good, n), name: s.name } : null;
    },

    /**
     * The owner comes back for a pile they set down: all of it back where it
     * came from (the market's stock, the caravan's cargo). → { n, good, where, whereName, who } or null
     */
    reclaim(world, q, r, pileId, opts = {}) {
        const pile = GroundGoods.find(world, q, r, pileId);
        if (!pile || !pile.claim || pile.by === 'player') return null;
        const back = GroundGoods._backTo(world, pile, q, r, pile.qty, opts.views || (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : []));
        if (!back) return null;
        const st = GroundGoods.state(world);
        const n = pile.qty;
        _add(st.books.reclaimed, pile.good, n);
        _flow(st, 'out', 'reclaimed', n);
        GroundGoods._offPile(pile, n);
        GroundGoods._remove(world, q, r, pile);
        return { n, good: pile.good, where: back.where, whereName: back.name, who: pile.claim.name || pile.byName };
    },

    /** Past their day: most owners come back for what they set down; a few never do (it lies abandoned). */
    _ownersBack(world, day, views) {
        const st = GroundGoods.state(world);
        const S = GroundGoods.config().setDown;
        const seed = _seed(world);
        for (const k of Object.keys(st.hexes)) {
            const [q, r] = k.split(',').map(Number);
            for (const pile of (st.hexes[k] || []).slice()) {
                if (!pile.claim || pile.by === 'player' || day <= _num(pile.claim.until)) continue;
                const K = (S.kinds || {})[pile.claim.kind] || {};
                const back = _num(K.reclaim, _num(S.reclaim, 0.9));
                if (_frac(`${seed}|back|${pile.id}`) < back && GroundGoods.reclaim(world, q, r, pile.id, { views })) continue;
                // Never came back for it: anyone's now
                pile.abandoned = day;
                delete pile.claim;
            }
        }
    },

    /** The market towns within `range` of the player. */
    _nearTowns(world, player, views, range) {
        if (!player || !Number.isFinite(player.q)) return [];
        const w = world.width || 0;
        return (views || []).filter(s => s && Number.isFinite(s.q) && s.market && Hex.wrappingDistance(player.q, player.r, s.q, s.r, w) <= range);
    },

    /**
     * A day's set-downs about the player (the life near you; far off, none):
     * each town's stalls, doors and fields (out of its market's stock: the
     * town's own goods), and the caravans on the roads near (out of cargo).
     * → piles set down
     */
    _setDownDay(world, player, day, views) {
        const S = GroundGoods.config().setDown;
        if (!S || !S.enabled || !player || GroundGoods.count(world) >= _num(GroundGoods.config().totalCap, 900)) return 0;
        const seed = _seed(world);
        const range = _num(S.range, 8);
        const season = String(Seasons.seasonOf(day) || '').toLowerCase();
        let made = 0;
        for (const s of GroundGoods._nearTowns(world, player, views, range)) {
            let here = 0;
            for (const [kind, K] of Object.entries(S.kinds || {})) {
                if (!K || K.at !== 'town' || here >= _num(S.perTown, 2)) continue;
                if (Array.isArray(K.seasons) && !K.seasons.includes(season)) continue;
                if (_frac(`${seed}|sd|${kind}|${s.q},${s.r}|${day}`) >= _num(K.chance, 0.3)) continue;
                const good = _pick((K.goods || []).filter(g => SettlementMarket.available(s, g) >= _num(K.minStock, 8)), `${seed}|sdg|${kind}|${s.q},${s.r}|${day}`);
                if (!good) continue;
                const [lo, hi] = Array.isArray(K.qty) ? K.qty : [1, 3];
                const want = lo + Math.floor(_frac(`${seed}|sdq|${kind}|${s.q},${s.r}|${day}`) * (hi - lo + 1));
                const got = Math.floor(SettlementMarket.take(s, good, Math.min(want, Math.floor(SettlementMarket.available(s, good) / 4))) + 1e-9);
                if (!(got > 0)) continue;
                const name = _pick(K.names, `${seed}|sdn|${kind}|${s.q},${s.r}|${day}`) || 'someone';
                const pile = GroundGoods.setDown(world, s.q, s.r, good, got, { kind, owner: `${kind}:${s.q},${s.r}:${day}`, name, by: kind, day, from: { kind: 'market', q: s.q, r: s.r } });
                if (!pile) { SettlementMarket.add(s, good, got); continue; }
                here++; made++;
            }
        }
        // Caravans near: unloading in a town, a carter resting at the roadside, a camp in the wilds
        const w = world.width || 0;
        for (const u of Array.isArray(world.units) ? world.units : []) {
            if (!u || u.destroyed || u.type !== 'trade_caravan' || !u.cargo || typeof u.cargo !== 'object') continue;
            if (Hex.wrappingDistance(player.q, player.r, u.q, u.r, w) > range) continue;
            const tile = typeof world.getTile === 'function' ? world.getTile(u.q, u.r) : null;
            const place = GroundGoods.placeOf(tile);
            const kind = place === 'town' ? 'unload' : place === 'road' ? 'carter' : 'camp';
            const K = (S.kinds || {})[kind];
            if (!K || _frac(`${seed}|sd|${kind}|${u.id}|${day}`) >= _num(K.chance, 0.3)) continue;
            const [good, have] = Object.entries(u.cargo).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1])[0] || [];
            if (!good) continue;
            const [lo, hi] = Array.isArray(K.qty) ? K.qty : [2, 6];
            const n = Math.min(Math.floor(have), lo + Math.floor(_frac(`${seed}|sdq|${u.id}|${day}`) * (hi - lo + 1)));
            if (!(n > 0)) continue;
            u.cargo[good] = Math.round((u.cargo[good] - n) * 100) / 100;
            if (!(u.cargo[good] > 0.001)) delete u.cargo[good];
            const name = _pick(K.names, `${seed}|sdn|${u.id}|${day}`) || 'a carter';
            const pile = GroundGoods.setDown(world, u.q, u.r, good, n, { kind, owner: `${kind}:${u.id}:${day}`, name, by: kind, day, from: { kind: 'caravan', unitId: u.id } });
            if (!pile) { _add(u.cargo, good, n); continue; }
            made++;
        }
        return made;
    },

    // ── What the townsfolk's houses keep (settlement.finds) ──

    /**
     * A day of the houses' finds: a good a market now deals in is sold on
     * into its stock (a share a day); anything else is used up a little at a
     * time (mended, burnt, worn out), faster once a town keeps more than cap.
     */
    _findsDay(world, day, views) {
        const F = GroundGoods.config().finds;
        const st = GroundGoods.state(world);
        const cap = Math.max(1, _num(F.cap, 40));
        for (const s of views || []) {
            const f = s && s.finds;
            if (!f || typeof f !== 'object') continue;
            let total = 0;
            for (const n of Object.values(f)) total += _num(n);
            const over = total > cap ? total / cap : 1;
            if (!s.findsWear || typeof s.findsWear !== 'object') s.findsWear = {};
            for (const good of Object.keys(f)) {
                const have = _num(f[good]);
                if (have > 0 && s.market && SettlementMarket.tracks(good)) {
                    const n = Math.min(have, Math.max(1, Math.ceil(have * _num(F.trickle, 0.25))));
                    if (SettlementMarket.add(s, good, n) > 0) {
                        _add(f, good, -n);
                        st.books.finds.toMarket = _num(st.books.finds.toMarket) + n;
                    }
                } else if (have > 0) {
                    s.findsWear[good] = _num(s.findsWear[good]) + have * _num(F.use, 0.02) * over;
                    const used = Math.min(have, Math.floor(s.findsWear[good] + 1e-9));
                    if (used > 0) {
                        s.findsWear[good] -= used;
                        _add(f, good, -used);
                        st.books.finds.used = _num(st.books.finds.used) + used;
                    }
                }
                if (!(_num(f[good]) > 0.001)) { delete f[good]; delete s.findsWear[good]; }
            }
            if (!Object.keys(f).length) { delete s.finds; delete s.findsWear; }
        }
    },

    /** The houses' finds a town offers second-hand → [{ good, qty, price }] (a unit's price, at a discount). */
    secondHand(settlement) {
        const F = GroundGoods.config().finds;
        const out = [];
        for (const [good, n] of Object.entries((settlement && settlement.finds) || {})) {
            const qty = Math.floor(_num(n) + 1e-9);
            if (qty < 1) continue;
            const base = PlayerInventory.goodValue(good) || (Arms.isArms(good) ? _num((Arms.item(good) || {}).price) : 0);
            out.push({ good, qty, price: Math.max(1, Math.round(base * _num(F.discount, 0.6))) });
        }
        return out.sort((a, b) => b.price * b.qty - a.price * a.qty);
    },

    /** Buy `n` second-hand from the town's houses: the coin into the town's purse. → { ok, n, cost, text, reason } */
    buyUsed(world, player, settlement, good, n = 1) {
        const row = GroundGoods.secondHand(settlement).find(x => x.good === good);
        const k = Math.floor(_num(n, 1));
        if (!row || k < 1 || k > row.qty) return { ok: false, reason: 'They have no more of that to sell.' };
        if (settlement.inKind) return { ok: false, reason: 'They barter here: no one takes coin for it.' };
        const cost = row.price * k;
        if (_num(player.gold) < cost) return { ok: false, reason: 'You cannot afford it.' };
        const add = PlayerInventory.addItem(player, good, k);
        if (!add.success) return { ok: false, reason: add.reason || PlayerInventory.fullMessage(player) };
        player.gold = Math.round((_num(player.gold) - cost) * 100) / 100;
        Economy.payTown(settlement, cost);
        _add(settlement.finds, good, -k);
        if (!(settlement.finds[good] > 0.001)) delete settlement.finds[good];
        const st = GroundGoods.state(world);
        st.books.finds.sold = _num(st.books.finds.sold) + k;
        return { ok: true, n: k, cost, text: `You buy ${GroundGoods.describe(good, k)} second-hand for ${cost} gold.` };
    },

    // ── Passers-by of their own: a rival House's retinue ──

    /**
     * A retinue on the road picks up what it finds: on each hex it passed
     * (cells: [{ q, r, stay }]) a pile goes with it at its chance — likelier
     * where it stays than where it rides through, and the more it is worth; a
     * valuable the House's head takes for himself whatever else. Into the
     * House's stores (rival.stores, sold on in a market town or used:
     * systems/rivalHouses.js). Never someone's set down, a strongbox, or
     * anything inside a building. → [{ good, n, head, q, r }]
     */
    retinueGlean(world, rival, cells, day = _day(world)) {
        const T = GroundGoods.config().retinue;
        const out = [];
        if (!T || !T.enabled || !rival || !Array.isArray(cells) || !GroundGoods.state(world, false)) return out;
        const seed = _seed(world);
        const grasping = rival.head && Array.isArray(rival.head.traits) && rival.head.traits.includes('grasping');
        const label = `${rival.name || 'a rival House'}'s retinue`;
        for (const c of cells) {
            for (const pile of GroundGoods.at(world, c.q, c.r).slice()) {
                if (pile.inside || _num(pile.gold) > 0 || GroundGoods.claimed(pile, day, null) || day - _num(pile.day) < _num(GroundGoods.config().graceDays, 1)) continue;
                const worth = GroundGoods.pileWorth(pile);
                const head = worth >= _num(T.valuableAt, 30);
                let chance = head ? _num(T.headGrab, 0.7) * (grasping ? 1.3 : 1) : _num(c.stay ? T.stay : T.pass, 0.2) * Math.min(2, 1 + worth / 60);
                if (pile.refuse) chance *= 0.3;
                if (_frac(`${seed}|rv|${rival.houseKey || rival.kingdomId}|${pile.id}|${day}`) >= Math.min(0.95, chance)) continue;
                const good = pile.good, n = pile.qty, by = pile.by;
                if (!rival.stores || typeof rival.stores !== 'object') rival.stores = {};
                _add(rival.stores, good, n);
                const who = head ? (rival.head && rival.head.name) || 'the head of the House' : label;
                GroundGoods._took(world, c.q, c.r, pile, n, 'rival', label, who);
                if (by === 'player') {
                    const k = GroundGoods.key(c.q, c.r);
                    const st = GroundGoods.state(world);
                    (st.gone[k] = st.gone[k] || []).push({ good, qty: n, who, day });
                    if (st.gone[k].length > 20) st.gone[k].splice(0, st.gone[k].length - 20);
                }
                out.push({ good, n, head, q: c.q, r: c.r });
            }
        }
        return out;
    },

    // ── The goods ledger (a census of the ground store) ──

    /**
     * The ground store's books: opening + in − out must equal what lies on
     * the ground (in by source: player, refuse, setDown, meat, arrows,
     * salvage, …; out by end: picked, rotted, eaten, cleared, reclaimed,
     * sunk, taken:<where>). → { opening, in, out, onHand, piles, gap, closes, inBy, outBy, finds }
     */
    ledger(world) {
        const st = GroundGoods.state(world);
        let onHand = 0, piles = 0;
        for (const k in st.hexes) for (const p of st.hexes[k]) { onHand += _num(p.qty); piles++; }
        const sum = (o) => Object.values(o || {}).reduce((a, b) => a + _num(b), 0);
        const inn = sum(st.books.flow.in), out = sum(st.books.flow.out);
        const gap = Math.round((_num(st.books.opening) + inn - out - onHand) * 100) / 100;
        return {
            opening: _num(st.books.opening), in: Math.round(inn * 100) / 100, out: Math.round(out * 100) / 100, onHand, piles, gap, closes: Math.abs(gap) < 0.01,
            inBy: { ...st.books.flow.in }, outBy: { ...st.books.flow.out }, finds: { ...st.books.finds },
        };
    },

    /** The ledger in a line (the cheats panel). */
    ledgerLine(world) {
        const L = GroundGoods.ledger(world);
        const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') || 'none';
        return `${L.piles} piles, ${L.onHand} units on the ground · in ${Math.round(L.in)} (${top(L.inBy)}) · out ${Math.round(L.out)} (${top(L.outBy)}) · ${L.closes ? 'the books close' : `gap ${L.gap}`}`;
    },

    // ── Saved with the world ──

    serialize(world) {
        const st = GroundGoods.state(world, false);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(data, world) {
        if (!world) return;
        if (data && typeof data === 'object' && data.hexes && typeof data.hexes === 'object') {
            world.groundGoods = JSON.parse(JSON.stringify(data));
            const st = GroundGoods.state(world);
            for (const k of Object.keys(st.hexes)) {
                const list = Array.isArray(st.hexes[k]) ? st.hexes[k].filter(p => p && p.id && p.good && p.qty > 0) : [];
                for (const p of list) if (!p.grades || typeof p.grades !== 'object') p.grades = {};
                if (list.length) st.hexes[k] = list; else delete st.hexes[k];
            }
        } else {
            world.groundGoods = null;
        }
    },
};
