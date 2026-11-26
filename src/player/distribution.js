// ============================================
// DISTRIBUTION — standing plans for where a property's output goes
// ============================================
// A plan per producing property (and the good it makes): a list of shares,
// each a destination and a percent, and a destination for the rest (by
// default the property's own store). Every day the day's output is split
// among them in whole units, each share's fraction of a unit carried over
// (largest remainder), so 10% of 3 a day still comes to 0.3 a day.
//
//   Destinations: another of your properties that takes the good as its
//   input (a rope walk's hemp, a mill's grain; a tavern's beer and liquor),
//   a store-room you rent (systems/merchantPrince.js), the larder of a home
//   (food only: player/household.js), a town you hold (its granary or
//   stores, as a trade line's supply stop: player/tradeLines.js), a market
//   town to sell in, or the store it was made in.
//
//   Nothing teleports. On the same hex the goods are moved at once. Else
//   they gather in the store until the plan's batch rule sends them (daily,
//   when N have gathered, weekly), and hired carters take them: days by the
//   way by land (roads quicker), carriage paid to the carters' home town by
//   weight and distance (cheaper on roads), the realm entered takes its
//   tolls, an export ban keeps them home, the road's robbers may take them
//   (to an outlaw lair's hoard). A sale is paid out of the market town's
//   purse at its price curve into its stock, with the crown's duty and the
//   guild's toll inside it. A destination that cannot take it all keeps the
//   rest waiting (tried daily) and then the carters bring it back.
//
// State: player.distribution { plans, transit, log, digest, stats } (saved
// with the player by SaveLoad). Daily processDay(world, player) after
// PlayerEconomy.produceGoods (player/actions/index.js). Draws Utils.random
// only for a consignment's robbery, when one is sent.
// Data: data/distribution.json.

import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { Transport } from '../world/transport.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { Ledger } from '../systems/ledger.js';
import { LossBook } from '../systems/lossBook.js';
import { Guilds } from '../systems/guilds.js';
import { Reckoning } from '../systems/reckoning.js';
import { Underworld } from '../systems/underworld.js';
import { Holdings } from '../systems/holdings.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Couriers } from '../systems/couriers.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { PlayerInventory } from './inventory.js';
import { PlayerEconomy, Trading } from './playerEconomy.js';
import { PlayerCoin } from './playerCoin.js';
import { Household } from './household.js';
import { TradeLines } from './tradeLines.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _c2 = (v) => Math.round(_num(v) * 100) / 100;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _name = (id) => String(id || '').replace(/_/g, ' ');

const KINDS = ['keep', 'property', 'warehouse', 'home', 'holding', 'market'];
const MODES = ['daily', 'load', 'weekly'];

const DEFAULTS = {
    maxPlans: 30, maxShares: 6, minLoad: 20, weeklyDays: 7, waitDays: 7, marketRange: 40, marketList: 16,
    routeDays: 30, noticeEvery: 7, logCap: 40,
    carriage: { loadLb: 500, perLoadHex: 1.2, minFee: 2, slow: 1.25, roadMin: 0.5, groundMax: 2, canal: 0.5, maxDays: 40 },
    tolls: { rate: 0.03, min: 1 },
    robbery: { scale: 0.25, max: 0.3 },
    sale: { floorShare: 0.4 },
};

let _cfg = null;
let _cfgSrc;

/** Largest k in [1, hi] with pred(k) true, pred monotone (true then false); 0 if none. */
function _maxTrue(hi, pred) {
    if (!(hi >= 1) || !pred(1)) return 0;
    let lo = 1;
    let top = Math.floor(hi);
    while (lo < top) {
        const mid = Math.ceil((lo + top) / 2);
        if (pred(mid)) lo = mid; else top = mid - 1;
    }
    return lo;
}

export const Distribution = {

    // ──────────── DATA ────────────

    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.distribution && gd.distribution.config) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = _obj(d) || {};
            _cfg = { ...DEFAULTS, ...o };
            for (const [k, v] of Object.entries(DEFAULTS)) if (_obj(v)) _cfg[k] = { ...v, ...(_obj(o[k]) || {}) };
        }
        return _cfg;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            v: 1, nextId: 1, plans: [], transit: [], log: [],
            digest: { since: null, n: 0, goods: {}, earned: 0, carriage: 0, tolls: 0, places: [] },
            stats: { sent: 0, delivered: 0, sold: 0, earned: 0, carriage: 0, tolls: 0, robbed: 0, lost: 0, returned: 0 },
        };
    },

    /** The player's record (created and backfilled on demand). */
    state(player) {
        if (!player) return null;
        if (!_obj(player.distribution)) player.distribution = Distribution._blank();
        const st = player.distribution;
        const b = Distribution._blank();
        if (!Array.isArray(st.plans)) st.plans = [];
        if (!Array.isArray(st.transit)) st.transit = [];
        if (!Array.isArray(st.log)) st.log = [];
        if (!(st.nextId > 0)) st.nextId = 1;
        st.digest = { ...b.digest, ...(_obj(st.digest) || {}) };
        if (!Array.isArray(st.digest.places)) st.digest.places = [];
        if (!_obj(st.digest.goods)) st.digest.goods = {};
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        for (const p of st.plans) Distribution._backfillPlan(p);
        return st;
    },

    has(player) {
        const st = player && _obj(player.distribution);
        return !!(st && ((Array.isArray(st.plans) && st.plans.length) || (Array.isArray(st.transit) && st.transit.length)));
    },

    _leg(dest, pct = null, rest = false) {
        return { id: null, rest, pct, dest: Distribution._dest(dest), carry: 0, pending: 0, sent: 0, delivered: 0, lost: 0, carriage: 0, tolls: 0, earned: 0, lastDay: null, lastQty: 0, warn: null, route: null };
    },

    _backfillPlan(p) {
        if (!Array.isArray(p.shares)) p.shares = [];
        if (!_obj(p.rest)) p.rest = Distribution._leg({ kind: 'keep' }, null, true);
        p.rest.rest = true;
        for (const l of [...p.shares, p.rest]) {
            l.dest = Distribution._dest(l.dest);
            for (const k of ['carry', 'pending', 'sent', 'delivered', 'lost', 'carriage', 'tolls', 'earned', 'lastQty']) l[k] = _num(l[k]);
        }
        if (!_obj(p.batch) || !MODES.includes(p.batch.mode)) p.batch = { mode: 'load', n: Distribution.config().minLoad };
        p.batch.n = Math.max(1, Math.floor(_num(p.batch.n, Distribution.config().minLoad)));
        p.totals = { made: 0, ...(_obj(p.totals) || {}) };
        if (p.on === undefined) p.on = true;
        return p;
    },

    /** A clean destination record. */
    _dest(d) {
        const o = _obj(d) || {};
        const kind = KINDS.includes(o.kind) ? o.kind : 'keep';
        const out = { kind };
        if (kind !== 'keep') { out.q = _num(o.q); out.r = _num(o.r); }
        if (kind === 'property') out.type = String(o.type || '');
        if (kind === 'warehouse') out.id = o.id;
        if (kind === 'home') out.key = String(o.key || '');
        return out;
    },

    _sameDest(a, b) {
        if (!a || !b || a.kind !== b.kind) return false;
        if (a.kind === 'keep') return true;
        return a.q === b.q && a.r === b.r && (a.type || '') === (b.type || '') && String(a.id ?? '') === String(b.id ?? '') && (a.key || '') === (b.key || '');
    },

    plans(player) {
        return _obj(player && player.distribution) && Array.isArray(player.distribution.plans) ? player.distribution.plans : [];
    },

    plan(player, id) {
        return Distribution.plans(player).find(p => p.id === id) || null;
    },

    /** The plan for the property of `type` at (q, r), or null. */
    planFor(player, q, r, type) {
        return Distribution.plans(player).find(p => p.q === q && p.r === r && p.type === type) || null;
    },

    _log(player, world, text) {
        const st = Distribution.state(player);
        st.log.unshift({ day: _day(world), text });
        if (st.log.length > Distribution.config().logCap) st.log.length = Distribution.config().logCap;
    },

    // ──────────── PLACES & GOODS ────────────

    _tile(world, q, r) {
        return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
    },

    _dist(world, a, b) {
        return Hex.wrappingDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
    },

    goodName(id) {
        return TradeLines.goodName(id);
    },

    /** The good a property's store holds: its recipe's output, else what it produces. */
    goodOf(property) {
        if (!property) return null;
        if (PlayerEconomy.isRecipeBuilding(property.type)) {
            const r = property.activeRecipe && PlayerEconomy.RECIPES[property.activeRecipe];
            return r ? r.output : null;
        }
        return property.produces && property.produces !== 'gold' ? property.produces : null;
    },

    /** The plan's source: { tile, prop } (prop null when it is gone). */
    _source(player, world, plan) {
        const tile = Distribution._tile(world, plan.q, plan.r);
        return { tile, prop: tile ? PlayerEconomy.findPropertyAt(tile, plan.type) : null };
    },

    _townAt(world, q, r) {
        const t = Distribution._tile(world, q, r);
        return (t && t.settlement) || null;
    },

    /** The town a property trades with (its tile's, else where its hands come from, else the nearest). */
    _sourceTown(world, tile, prop) {
        return PlayerEconomy.propertyTown(world, tile, prop) || (tile ? PlayerCoin.nearestTown(world, null, tile) : null);
    },

    _placeName(world, q, r) {
        const s = Distribution._townAt(world, q, r);
        return s ? s.name : `${q},${r}`;
    },

    /** A destination's name for the panels. */
    destName(player, world, d) {
        if (!d || d.kind === 'keep') return 'Keep in store';
        const at = Distribution._placeName(world, d.q, d.r);
        if (d.kind === 'property') {
            const t = Distribution._tile(world, d.q, d.r);
            const p = t && PlayerEconomy.findPropertyAt(t, d.type);
            const def = PlayerEconomy.getPropertyDef(d.type);
            return `${(p && p.name) || (def && def.name) || _name(d.type)} at ${at}`;
        }
        if (d.kind === 'warehouse') {
            const w = player && player.merchantPrince ? MerchantPrince.warehouse(player, d.id) : null;
            const sz = w && MerchantPrince.sizes()[w.size];
            return `${(sz && sz.name) || 'Store-room'} in ${(w && w.town) || at}`;
        }
        if (d.kind === 'home') {
            const h = Household.homes(player).find(x => x.key === d.key);
            return `The larder of ${h ? `your ${String(h.name || 'home').toLowerCase()}` : 'your home'} in ${(h && h.town) || at}`;
        }
        if (d.kind === 'holding') return `The stores of ${at} (your holding)`;
        if (d.kind === 'market') return `Sell at ${at}`;
        return at;
    },

    destIcon(d) {
        return { keep: '📦', property: '🏭', warehouse: '🏚️', home: '🏠', holding: '🏰', market: '💰' }[(d && d.kind) || 'keep'] || '📦';
    },

    /**
     * Can this destination take `good` now, and how much? → { ok, room
     * (units; Infinity for no limit), why }. A market's room is what its
     * purse buys at the floor price or better (a rough figure for the panels).
     */
    canTake(player, world, d, good, qty = 1) {
        if (!d || d.kind === 'keep') return { ok: true, room: Infinity, why: null };
        const tile = Distribution._tile(world, d.q, d.r);
        if (!tile) return { ok: false, room: 0, why: 'No such place.' };
        const gname = Distribution.goodName(good).toLowerCase();
        if (d.kind === 'property') {
            const p = PlayerEconomy.findPropertyAt(tile, d.type);
            if (!p) return { ok: false, room: 0, why: 'That property is no longer yours.' };
            if (p.underConstruction) return { ok: false, room: 0, why: `${p.name} is still being built.` };
            if (p.type === 'tavern' && (good === 'beer' || good === 'liquor')) {
                const have = _num(good === 'beer' ? p.beerStock : p.liquorStock);
                const room = Math.max(0, 100 * _num(p.level, 1) - have);
                return { ok: room > 0, room, why: room > 0 ? null : `The tavern's cellar is full of ${gname}.` };
            }
            const recipe = p.activeRecipe && PlayerEconomy.RECIPES[p.activeRecipe];
            if (!PlayerEconomy.isRecipeBuilding(p.type)) return { ok: false, room: 0, why: `${p.name} does not work ${gname}.` };
            if (!recipe || recipe.input !== good) {
                const fit = Distribution._recipeFor(p, good);
                return { ok: false, room: 0, why: fit ? `Set ${p.name} to ${fit.name || _name(fit.output)} first: it works ${recipe ? Distribution.goodName(recipe.input).toLowerCase() : 'nothing'} now.` : `${p.name} does not work ${gname}.` };
            }
            const room = Math.max(0, PlayerEconomy.getStorageCapacity(player, p) - Math.floor(_num(p.inputStorage)));
            return { ok: room > 0, room, why: room > 0 ? null : `${p.name}'s input store is full.` };
        }
        if (d.kind === 'warehouse') {
            const w = player && player.merchantPrince ? MerchantPrince.warehouse(player, d.id) : null;
            if (!w) return { ok: false, room: 0, why: 'You no longer rent that store-room.' };
            const room = MerchantPrince.room(w);
            return { ok: room > 0, room, why: room > 0 ? null : 'The store-room is full.' };
        }
        if (d.kind === 'home') {
            if (!Household.isFood(good)) return { ok: false, room: 0, why: `A larder keeps food, not ${gname}.` };
            const h = Household.homes(player).find(x => x.key === d.key);
            if (!h) return { ok: false, room: 0, why: 'That home is no longer yours.' };
            const rec = h.rec || Household.home(player, d.key);
            const room = rec ? Math.max(0, Math.floor(Household.capacity(rec) - Household.units(rec))) : Math.floor(_num(Household.config().larder.baseCapacity, 30));
            return { ok: room > 0, room, why: room > 0 ? null : 'The larder is full.' };
        }
        if (d.kind === 'holding') {
            if (!tile.settlement || !Holdings.isHolding(player, world, d.q, d.r)) return { ok: false, room: 0, why: 'You no longer hold that town.' };
            return { ok: true, room: Infinity, why: null };
        }
        if (d.kind === 'market') {
            const s = tile.settlement;
            if (!s) return { ok: false, room: 0, why: 'There is no market there any more.' };
            const good0 = TradeLines._good(good);
            if (!good0 || good0.noMarket) return { ok: false, room: 0, why: `No stall buys ${gname}.` };
            const k = TradeLines._kingdom(world, s.kingdom);
            if (k && Underworld.contrabandStatus(k, good) === 'illegal') return { ok: false, room: 0, why: `${gname} is contraband there.` };
            const mono = Trading.monopolyBlock(s, good, player);
            if (mono) return { ok: false, room: 0, why: mono };
            const purse = Economy.townPurse(s);
            if (purse != null && purse < 1) return { ok: false, room: 0, why: `The merchants of ${s.name} have no coin.` };
            // (not worth the carting while the price there is under the plan's floor)
            const floor = _num(good0.basePrice) * _num(Distribution.config().sale.floorShare, 0.4);
            const unit = Trading.saleUnitPrice(player, good0, s, world, 1, 1);
            if (floor > 0 && unit < floor) return { ok: false, room: 0, why: `${gname} fetches ${Utils.formatGold(unit)}g at ${s.name}, under the ${Utils.formatGold(floor)}g the carters are sent for.` };
            return { ok: true, room: Infinity, why: null };
        }
        return { ok: false, room: 0, why: 'Unknown destination.' };
    },

    /** A recipe this recipe building could run that takes `good`, or null. */
    _recipeFor(p, good) {
        const def = PlayerEconomy.getPropertyDef(p.type);
        const allowed = def && Array.isArray(def.allowedRecipes) ? def.allowedRecipes : null;
        for (const [id, r] of Object.entries(PlayerEconomy.RECIPES || {})) {
            if (r && r.input === good && (!allowed || allowed.includes(id))) return r;
        }
        return null;
    },

    /**
     * Where the output of the property of `type` at (q, r) could go:
     * [{ dest, name, icon, dist, ok, why, note }], the store first, then your
     * properties, store-rooms, larders, holdings, and the nearest markets.
     */
    destinations(player, world, q, r, type, good = null) {
        const tile = Distribution._tile(world, q, r);
        const src = tile ? PlayerEconomy.findPropertyAt(tile, type) : null;
        const g = good || Distribution.goodOf(src);
        const from = { q, r };
        const out = [];
        const add = (dest, note = '') => {
            const d = Distribution._dest(dest);
            const can = g ? Distribution.canTake(player, world, d, g) : { ok: false, why: 'It makes nothing yet.' };
            out.push({ dest: d, name: Distribution.destName(player, world, d), icon: Distribution.destIcon(d), dist: d.kind === 'keep' ? 0 : Distribution._dist(world, from, d), ok: can.ok, why: can.why, note });
        };
        add({ kind: 'keep' });
        if (!g) return out;
        // Your other properties that work this good
        for (const ref of (player && player.properties) || []) {
            if (ref.q === q && ref.r === r && ref.type === type) continue;
            const t = Distribution._tile(world, ref.q, ref.r);
            const p = t && PlayerEconomy.findPropertyAt(t, ref.type);
            if (!p) continue;
            const takes = (p.type === 'tavern' && (g === 'beer' || g === 'liquor'))
                || (PlayerEconomy.isRecipeBuilding(p.type) && Distribution._recipeFor(p, g));
            if (takes) add({ kind: 'property', q: ref.q, r: ref.r, type: ref.type }, PlayerEconomy.isRecipeBuilding(p.type) ? `input ${Math.floor(_num(p.inputStorage))}/${PlayerEconomy.getStorageCapacity(player, p)}` : '');
        }
        // Store-rooms you rent
        if (player && _obj(player.merchantPrince)) {
            for (const w of MerchantPrince.state(player).warehouses) add({ kind: 'warehouse', id: w.id, q: w.q, r: w.r }, `${MerchantPrince.room(w)} room`);
        }
        // The larders of your homes (food)
        if (Household.isFood(g)) {
            for (const h of Household.homes(player)) if (Number.isFinite(h.q)) add({ kind: 'home', key: h.key, q: h.q, r: h.r });
        }
        // Towns you hold
        for (const h of Holdings.list(player, world)) add({ kind: 'holding', q: h.q, r: h.r });
        // The markets within reach, nearest first, with today's price for one unit
        const C = Distribution.config();
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        const near = [];
        for (const v of views) {
            if (!v || !Number.isFinite(v.q)) continue;
            if (Math.abs(v.r - r) > C.marketRange) continue;
            const d = Distribution._dist(world, from, v);
            if (d > C.marketRange) continue;
            const t = Distribution._tile(world, v.q, v.r);
            if (!t || !t.settlement || t.explored === false) continue;
            near.push({ q: v.q, r: v.r, d, s: t.settlement });
        }
        near.sort((a, b) => a.d - b.d);
        const goodRec = TradeLines._good(g);
        for (const m of near.slice(0, C.marketList)) {
            let note = '';
            if (goodRec && !goodRec.noMarket) {
                const u = Trading.saleUnitPrice(player, goodRec, m.s, world, 1, 1);
                if (u > 0) note = `${Utils.formatGold(u)}g each today`;
            }
            add({ kind: 'market', q: m.q, r: m.r }, note);
        }
        return out;
    },

    // ──────────── THE PLAYER'S ORDERS ────────────

    /** Make (or return) the plan for the property of `type` at (q, r). */
    ensurePlan(player, world, q, r, type) {
        const have = Distribution.planFor(player, q, r, type);
        if (have) return { success: true, plan: have };
        const tile = Distribution._tile(world, q, r);
        const prop = tile ? PlayerEconomy.findPropertyAt(tile, type) : null;
        if (!prop) return { success: false, reason: 'You have no such property.' };
        const good = Distribution.goodOf(prop);
        if (!good) return { success: false, reason: PlayerEconomy.isRecipeBuilding(type) ? 'Choose a recipe first: it makes nothing yet.' : 'This property makes no goods to send.' };
        const st = Distribution.state(player);
        if (st.plans.length >= Distribution.config().maxPlans) return { success: false, reason: `You can keep at most ${Distribution.config().maxPlans} plans.` };
        const plan = Distribution._backfillPlan({
            id: `D${st.nextId++}`, q, r, type, good, name: prop.name, on: true, since: _day(world), nextLeg: 0,
            shares: [], rest: Distribution._leg({ kind: 'keep' }, null, true), batch: { mode: 'load', n: Distribution.config().minLoad }, warn: null,
        });
        plan.rest.id = 'rest';
        st.plans.push(plan);
        prop.distPlan = plan.id;
        return { success: true, plan };
    },

    _sharesSum(plan, except = null) {
        return plan.shares.reduce((a, s) => a + (s === except ? 0 : _num(s.pct)), 0);
    },

    /** Add a share: dest + percent (whole percents, 1..100; all shares together at most 100). */
    addShare(player, world, planId, dest, pct) {
        const plan = Distribution.plan(player, planId);
        if (!plan) return { success: false, reason: 'No such plan.' };
        if (plan.shares.length >= Distribution.config().maxShares) return { success: false, reason: `A plan has at most ${Distribution.config().maxShares} shares (the rest takes what is left).` };
        const d = Distribution._dest(dest);
        if (d.kind === 'keep') return { success: false, reason: 'What is not shared out stays in store already: set the rest instead.' };
        if (d.kind === 'property' && d.q === plan.q && d.r === plan.r && d.type === plan.type) return { success: false, reason: 'A property cannot send to itself.' };
        if (plan.shares.some(s => Distribution._sameDest(s.dest, d))) return { success: false, reason: 'That destination already has a share: change its percent.' };
        const p = Math.round(_num(Number(pct), 0));
        if (!(p >= 1 && p <= 100)) return { success: false, reason: 'A share is 1% to 100%.' };
        const room = 100 - Distribution._sharesSum(plan);
        if (p > room) return { success: false, reason: `Only ${room}% is left to share out.` };
        const leg = Distribution._leg(d, p);
        leg.id = `s${plan.nextLeg = _num(plan.nextLeg) + 1}`;
        plan.shares.push(leg);
        return { success: true, share: leg, text: `${p}% of the ${Distribution.goodName(plan.good).toLowerCase()} to ${Distribution.destName(player, world, d)}.` };
    },

    _leg_(plan, legId) {
        if (legId === 'rest') return plan.rest;
        return plan.shares.find(s => s.id === legId) || null;
    },

    /** Change a share's percent (or its destination). */
    updateShare(player, world, planId, legId, patch = {}) {
        const plan = Distribution.plan(player, planId);
        const leg = plan && Distribution._leg_(plan, legId);
        if (!leg || leg.rest) return { success: false, reason: 'No such share.' };
        if (patch.pct != null) {
            const p = Math.round(_num(Number(patch.pct), -1));
            if (!(p >= 1 && p <= 100)) return { success: false, reason: 'A share is 1% to 100%.' };
            const room = 100 - Distribution._sharesSum(plan, leg);
            if (p > room) return { success: false, reason: `Only ${room}% is left for this share.` };
            leg.pct = p;
        }
        if (patch.dest) {
            const d = Distribution._dest(patch.dest);
            if (d.kind === 'keep') return { success: false, reason: 'A share goes somewhere: remove it to keep its part in store.' };
            if (plan.shares.some(s => s !== leg && Distribution._sameDest(s.dest, d))) return { success: false, reason: 'That destination already has a share.' };
            leg.dest = d;
            leg.route = null;
            leg.warn = null;
        }
        return { success: true, share: leg };
    },

    /** Strike a share: what it had gathered stays in store (goods on the road still arrive). */
    removeShare(player, world, planId, legId) {
        const plan = Distribution.plan(player, planId);
        if (!plan) return { success: false, reason: 'No such plan.' };
        const i = plan.shares.findIndex(s => s.id === legId);
        if (i < 0) return { success: false, reason: 'No such share.' };
        plan.shares.splice(i, 1);
        return { success: true };
    },

    /** Where the rest goes (default: kept in store). */
    setRest(player, world, planId, dest) {
        const plan = Distribution.plan(player, planId);
        if (!plan) return { success: false, reason: 'No such plan.' };
        const d = Distribution._dest(dest);
        if (d.kind === 'property' && d.q === plan.q && d.r === plan.r && d.type === plan.type) return { success: false, reason: 'A property cannot send to itself.' };
        if (!Distribution._sameDest(plan.rest.dest, d)) {
            plan.rest.dest = d;
            plan.rest.route = null;
            plan.rest.warn = null;
        }
        return { success: true };
    },

    /** How the consignments go out: 'daily', 'load' (when n have gathered), 'weekly'. */
    setBatch(player, planId, mode, n = null) {
        const plan = Distribution.plan(player, planId);
        if (!plan) return { success: false, reason: 'No such plan.' };
        if (!MODES.includes(mode)) return { success: false, reason: 'Daily, by the load, or weekly.' };
        plan.batch.mode = mode;
        if (n != null) plan.batch.n = Math.max(1, Math.min(9999, Math.floor(_num(Number(n), plan.batch.n))));
        return { success: true };
    },

    setOn(player, planId, on) {
        const plan = Distribution.plan(player, planId);
        if (!plan) return { success: false, reason: 'No such plan.' };
        plan.on = !!on;
        return { success: true };
    },

    /** The property makes another good now (a recipe changed): the plan follows it, its shares kept, what was gathered left in store. */
    retarget(player, world, planId) {
        const plan = Distribution.plan(player, planId);
        if (!plan) return { success: false, reason: 'No such plan.' };
        const { prop } = Distribution._source(player, world, plan);
        const good = Distribution.goodOf(prop);
        if (!good) return { success: false, reason: 'It makes nothing now.' };
        plan.good = good;
        plan.warn = null;
        for (const l of [...plan.shares, plan.rest]) { l.pending = 0; l.carry = 0; l.warn = null; }
        return { success: true, text: `The plan now shares out the ${Distribution.goodName(good).toLowerCase()}.` };
    },

    /** End a plan: what was gathered stays in store; goods already on the road still arrive. */
    removePlan(player, world, planId) {
        const st = Distribution.state(player);
        const plan = Distribution.plan(player, planId);
        if (!plan) return { success: false, reason: 'No such plan.' };
        st.plans = st.plans.filter(p => p !== plan);
        const { prop } = Distribution._source(player, world, plan);
        if (prop && prop.distPlan === plan.id) delete prop.distPlan;
        return { success: true };
    },

    // ──────────── THE WAY ────────────

    /**
     * The carters' way from a to b: { ok, hexes, days (whole, ≥1), ground
     * (carriage factor), why }. Cached on the leg for `routeDays` days.
     */
    route(world, a, b, leg = null) {
        const C = Distribution.config();
        const key = `${a.q},${a.r}>${b.q},${b.r}`;
        const day = _day(world);
        if (leg && leg.route && leg.route.key === key && day - _num(leg.route.day) < C.routeDays) return leg.route;
        const hexes = Distribution._dist(world, a, b);
        let out;
        if (hexes === 0) {
            out = { key, day, ok: true, hexes: 0, days: 0, ground: 1, why: null };
        } else {
            const K = C.carriage;
            const walk = Infrastructure.routeDays(world, a, b, null, K.maxDays / Math.max(0.1, K.slow));
            if (walk == null) {
                out = { key, day, ok: false, hexes, days: null, ground: 1, why: 'No way by land the carters can take (or longer than they will go).' };
            } else {
                let ground = _clamp(walk / Math.max(0.01, hexes * Infrastructure.openDays()), K.roadMin, K.groundMax);
                let canal = false;
                if (Distribution._townAt(world, a.q, a.r) && Distribution._townAt(world, b.q, b.r)) {
                    let band = null;
                    try { band = Transport.linkBand(world, a, b); } catch (e) { band = null; }
                    if (band === 'canal') { ground *= K.canal; canal = true; }
                }
                out = { key, day, ok: true, hexes, days: Math.max(1, Math.ceil(walk * K.slow)), ground: Math.round(ground * 1000) / 1000, canal, why: null };
            }
        }
        if (leg) leg.route = out;
        return out;
    },

    /** Carriage for `qty` of `good` over a route: minFee + loads × hexes × perLoadHex × ground. */
    carriage(good, qty, route) {
        if (!route || !route.ok || !(route.hexes > 0) || !(qty > 0)) return 0;
        const K = Distribution.config().carriage;
        const loads = PlayerInventory.itemWeight(good) * qty / Math.max(1, K.loadLb);
        return _c2(K.minFee + loads * route.hexes * K.perLoadHex * route.ground);
    },

    /** The chance a consignment is robbed on this way. */
    robChance(world, player, a, b) {
        const R = Distribution.config().robbery;
        let danger = 0;
        try {
            const ta = Distribution._tile(world, a.q, a.r), tb = Distribution._tile(world, b.q, b.r);
            danger = Couriers.routeDanger(world, player, a, b, TradeLines._realm(ta), TradeLines._realm(tb));
        } catch (e) { danger = 0; }
        return _clamp(_num(danger) * _num(R.scale), 0, _num(R.max, 0.3));
    },

    /** A consignment's terms for the panels: { ok, days, fee, toll, rob, why }. */
    quote(player, world, plan, leg, qty) {
        const d = leg.dest;
        if (d.kind === 'keep') return { ok: true, days: 0, fee: 0, rob: 0, why: null };
        const from = { q: plan.q, r: plan.r };
        const rt = Distribution.route(world, from, d, leg);
        if (!rt.ok) return { ok: false, days: null, fee: 0, rob: 0, why: rt.why };
        return { ok: true, days: rt.days, fee: Distribution.carriage(plan.good, qty, rt), rob: rt.hexes ? Distribution.robChance(world, player, from, d) : 0, why: null, hexes: rt.hexes, ground: rt.ground };
    },

    // ──────────── THE DAY ────────────

    /**
     * Daily, after the properties have made their goods: arrivals first,
     * then each plan splits the day's output and sends what is due.
     * → { notices: [{ icon, title, text, type }] }
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player || !Distribution.has(player)) return out;
        const st = Distribution.state(player);
        const day = _day(world);
        Distribution._transitDay(world, player, st, out);
        for (const plan of st.plans) Distribution._planDay(world, player, plan, out);
        st.transit = st.transit.filter(c => !c.done);
        // The week's arrivals in one notice
        const D = st.digest;
        if (D.since == null) D.since = day;
        if (day - D.since >= Distribution.config().noticeEvery) {
            if (D.n > 0) {
                const goods = Object.entries(D.goods).map(([g, n]) => `${n} ${Distribution.goodName(g).toLowerCase()}`).join(', ');
                const bits = [`${D.n} consignment${D.n > 1 ? 's' : ''} arrived (${goods})`];
                if (D.places.length) bits.push(`at ${D.places.slice(0, 4).join(', ')}${D.places.length > 4 ? ' and more' : ''}`);
                if (D.earned > 0) bits.push(`sales ${Utils.formatGold(D.earned)}g`);
                if (D.carriage > 0) bits.push(`carriage ${Utils.formatGold(D.carriage)}g`);
                if (D.tolls > 0) bits.push(`tolls ${Utils.formatGold(D.tolls)}g`);
                out.notices.push({ icon: '🚚', title: 'Distribution: the Week', text: `${bits.join(' · ')}.`, type: 'info' });
            }
            st.digest = { since: day, n: 0, goods: {}, earned: 0, carriage: 0, tolls: 0, places: [] };
        }
        return out;
    },

    /**
     * Split `made` among the legs in whole units: each leg's entitlement is
     * its carry + made × its share; floors first, the units left over to the
     * largest fractions. → [units per leg] (summing to made); carries updated.
     */
    apportion(legs, pcts, made) {
        const want = legs.map((l, i) => _num(l.carry) + made * pcts[i] / 100);
        const got = want.map(w => Math.max(0, Math.floor(w + 1e-9)));
        let left = made - got.reduce((a, n) => a + n, 0);
        if (left < 0) {
            // (more floors than units: take back from the smallest fractions)
            const order = want.map((w, i) => [w - got[i], i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            for (const [, i] of order) { if (left >= 0) break; if (got[i] > 0) { got[i]--; left++; } }
        }
        if (left > 0) {
            const order = want.map((w, i) => [w - got[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
            for (let k = 0; k < order.length && left > 0; k++) { got[order[k][1]]++; left--; }
            for (let k = 0; left > 0; k = (k + 1) % order.length) { got[order[k][1]]++; left--; }
        }
        legs.forEach((l, i) => { l.carry = Math.round((want[i] - got[i]) * 1000) / 1000; });
        return got;
    },

    _planDay(world, player, plan, out) {
        const day = _day(world);
        const { tile, prop } = Distribution._source(player, world, plan);
        if (!prop) { plan.warn = 'The property is no longer yours.'; return; }
        prop.distPlan = plan.id;
        if (!plan.on) { plan.warn = 'Paused.'; return; }
        if (prop.underConstruction) { plan.warn = 'Still being built.'; return; }
        const good = prop.outputDay === day && prop.lastGood ? prop.lastGood : Distribution.goodOf(prop);
        if (good !== plan.good) {
            plan.warn = `The plan is for ${Distribution.goodName(plan.good).toLowerCase()}; it makes ${good ? Distribution.goodName(good).toLowerCase() : 'nothing'} now.`;
            return;
        }
        plan.warn = null;
        const made = prop.outputDay === day && plan.lastDay !== day ? Math.max(0, Math.floor(_num(prop.lastOutput))) : 0;
        plan.lastDay = day;
        const legs = [...plan.shares, plan.rest];
        if (made > 0) {
            const sum = Math.min(100, Distribution._sharesSum(plan));
            const pcts = [...plan.shares.map(s => _num(s.pct)), 100 - sum];
            const got = Distribution.apportion(legs, pcts, made);
            plan.totals.made += made;
            legs.forEach((l, i) => { if (got[i] > 0 && l.dest.kind !== 'keep') l.pending += got[i]; });
        }
        // Same hex: at once. Else what is due goes out with the carters
        for (const leg of legs) {
            if (leg.dest.kind === 'keep' || !(leg.pending >= 1)) continue;
            const same = leg.dest.q === plan.q && leg.dest.r === plan.r;
            if (same || Distribution._due(plan, leg, day)) Distribution._send(world, player, plan, leg, tile, prop, same, out);
        }
    },

    _due(plan, leg, day) {
        const b = plan.batch;
        if (b.mode === 'daily') return true;
        if (b.mode === 'load') return leg.pending >= b.n;
        const every = Math.max(1, _num(Distribution.config().weeklyDays, 7));
        return (day - _num(plan.since)) % every === 0 || leg.pending >= 4 * b.n;
    },

    /** Take a leg's gathered goods out of the store and send them (or move them at once on the same hex). */
    _send(world, player, plan, leg, tile, prop, same, out) {
        const st = Distribution.state(player);
        const day = _day(world);
        const g = plan.good;
        const gname = Distribution.goodName(g).toLowerCase();
        // (what the store still holds: goods collected or loaded away meanwhile leave the pile short)
        let qty = Math.min(Math.floor(leg.pending), Math.floor(_num(prop.storage)));
        if (qty <= 0) { leg.pending = 0; return; }
        // A destination that cannot take it now (full, the wrong recipe, no coin): the goods
        // wait in this store, still gathered for it, and are sent when it can
        const can = Distribution.canTake(player, world, leg.dest, g, qty);
        if (!can.ok) { leg.warn = `${can.why} The ${gname} waits in store.`; return; }
        if (leg.dest.kind !== 'market') qty = Math.min(qty, can.room);
        if (same) {
            // On the hex: handed over at once, what it takes; the rest stays gathered
            const c = Distribution._consignment(world, st, plan, leg, g, qty, day, 0, tile);
            prop.storage -= qty;
            leg.pending -= qty;
            const res = Distribution._deliver(world, player, c, out, { quiet: true });
            leg.pending += c.qty;
            prop.storage += c.qty;
            c.qty = 0;
            c.done = true;
            leg.warn = res.left > 0 ? res.why : null;
            return;
        }
        const from = { q: plan.q, r: plan.r };
        const rt = Distribution.route(world, from, leg.dest, leg);
        if (!rt.ok) { leg.warn = rt.why; return; }
        // An export ban keeps the goods in the realm (systems/tradePolicy.js)
        const srcPlace = tile.settlement || tile;
        const dt = Distribution._tile(world, leg.dest.q, leg.dest.r);
        const banned = TradePolicy.exportBlock(player, world, srcPlace, (dt && dt.settlement) || dt, g);
        if (banned) { leg.warn = banned; return; }
        const fee = Distribution.carriage(g, qty, rt);
        if (_num(player.gold) < fee) { leg.warn = `No coin for the carters (${Utils.formatGold(fee)}g): the ${gname} waits in store.`; return; }
        // The carters are folk of the source's town: their pay goes there
        const carters = Distribution._sourceTown(world, tile, prop);
        Distribution._payCarters(world, player, carters, tile, fee);
        const c = Distribution._consignment(world, st, plan, leg, g, qty, day, rt.days, tile);
        c.cost = fee;
        c.carters = carters ? carters.name : null;
        c.robbed = Utils.random() < Distribution.robChance(world, player, from, leg.dest);
        prop.storage -= qty;
        leg.pending -= qty;
        leg.sent += qty;
        leg.carriage = _c2(leg.carriage + fee);
        leg.warn = null;
        st.transit.push(c);
        st.stats.sent += qty;
        st.stats.carriage = _c2(st.stats.carriage + fee);
        st.digest.carriage = _c2(st.digest.carriage + fee);
    },

    _payCarters(world, player, town, tile, fee) {
        if (!(fee > 0)) return;
        player.gold = _c2(_num(player.gold) - fee);
        if (!(town && Economy.payTown(town, fee) > 0)) Economy.payNearest(world, tile.q, tile.r, fee);
        Ledger.record(player, 'carriage', -fee);
    },

    _consignment(world, st, plan, leg, g, qty, day, days, tile) {
        const lots = {};
        // (booked to the realm it was made in: a market abroad charges its import duty)
        TradePolicy.book(lots, tile.settlement || tile, g, qty);
        return {
            id: `C${st.nextId++}`, planId: plan.id, legId: leg.id, good: g, qty,
            from: { q: plan.q, r: plan.r, name: Distribution._placeName(world, plan.q, plan.r) }, to: { ...leg.dest },
            departDay: day, arriveDay: day + days, status: 'road', waitUntil: null, cost: 0, robbed: false, lots, done: false,
        };
    },

    _transitDay(world, player, st, out) {
        const day = _day(world);
        for (const c of st.transit) {
            if (c.done) continue;
            if (c.status === 'road' || c.status === 'return') {
                if (day < c.arriveDay) continue;
                const back = c.status === 'return';
                const fromPt = back ? c.to : c.from;
                const toPt = back ? c.from : c.to;
                if (c.robbed) { Distribution._robbed(world, player, st, c, fromPt, toPt, out); continue; }
                Distribution._tolls(world, player, st, c, fromPt, toPt);
                if (back) { Distribution._home(world, player, st, c, out); continue; }
                const res = Distribution._deliver(world, player, c, out);
                if (c.qty > 0) {
                    c.status = 'waiting';
                    c.waitUntil = day + Distribution.config().waitDays;
                    c.why = res.why;
                }
            } else if (c.status === 'waiting') {
                const last = day >= c.waitUntil;
                Distribution._deliver(world, player, c, out, { last });
                if (c.qty > 0 && last) Distribution._sendBack(world, player, st, c, out);
            }
            if (c.qty <= 0 && c.status !== 'return') c.done = true;
        }
    },

    /** The realm entered takes its tolls on the goods' worth. */
    _tolls(world, player, st, c, a, b) {
        const ra = TradeLines._realm(Distribution._tile(world, a.q, a.r));
        const rb = TradeLines._realm(Distribution._tile(world, b.q, b.r));
        if (rb == null || String(ra) === String(rb) || !(c.qty > 0)) return 0;
        const k = TradeLines._kingdom(world, rb);
        if (!k || k.isAlive === false) return 0;
        const T = Distribution.config().tolls;
        const value = (PlayerInventory.goodValue(c.good) || 5) * c.qty;
        const rate = TradePolicy.tollRate(world, rb, ra, c.good, _num(T.rate, 0.03));
        const due = rate > 0 ? Math.max(_num(T.min, 1), Math.round(value * rate)) : 0;
        const paid = Math.min(Math.max(0, Math.floor(_num(player.gold))), due);
        if (!(paid > 0)) return 0;
        player.gold -= paid;
        k.treasury = _num(k.treasury) + paid;
        TradePolicy.noteToll(world, rb, paid);
        Ledger.record(player, 'roadTolls', -paid);
        c.tolls = _num(c.tolls) + paid;
        const leg = Distribution._legOf(player, c);
        if (leg) leg.tolls += paid;
        st.stats.tolls += paid;
        st.digest.tolls += paid;
        return paid;
    },

    _legOf(player, c) {
        const plan = Distribution.plan(player, c.planId);
        return plan ? Distribution._leg_(plan, c.legId) : null;
    },

    /**
     * Hand a consignment over where it is bound (as much as it takes now).
     * → { done, left, why }. `last`: a market's last day sells at any price.
     */
    _deliver(world, player, c, out, { last = false, quiet = false } = {}) {
        const st = Distribution.state(player);
        const d = c.to;
        const g = c.good;
        const day = _day(world);
        const tile = Distribution._tile(world, d.q, d.r);
        const can = Distribution.canTake(player, world, d, g, c.qty);
        let n = 0;
        let earned = 0;
        let why = can.why;
        if (can.ok) {
            if (d.kind === 'market') {
                const sale = Distribution._sell(world, player, tile.settlement, g, c.qty, c.lots, last ? 0 : null);
                n = sale.n;
                earned = sale.earned;
                why = sale.why;
            } else {
                n = Math.min(c.qty, can.room);
                Distribution._put(world, player, d, tile, g, n);
                TradePolicy.takeLots(c.lots, g, n, c.qty);
                if (n < c.qty) why = Distribution.canTake(player, world, d, g, 1).why || 'There was no more room.';
            }
        }
        if (n > 0) {
            c.qty -= n;
            if (quiet && earned > 0) { st.digest.earned = _c2(st.digest.earned + earned); }
            const leg = Distribution._legOf(player, c);
            if (leg) {
                leg.delivered += n;
                leg.lastDay = day;
                leg.lastQty = n;
                leg.earned = _c2(leg.earned + earned);
            }
            st.stats.delivered += n;
            if (earned > 0) { st.stats.sold += n; st.stats.earned = _c2(st.stats.earned + earned); }
        }
        if (n > 0 && !quiet) {
            const D = st.digest;
            D.n++;
            D.goods[g] = _num(D.goods[g]) + n;
            D.earned = _c2(D.earned + earned);
            const place = Distribution._placeName(world, d.q, d.r);
            if (!D.places.includes(place)) D.places.push(place);
        }
        return { done: c.qty <= 0, left: c.qty, why: c.qty > 0 ? (why || 'It could not take it all.') : null };
    },

    /** Put n units into a destination's store. */
    _put(world, player, d, tile, g, n) {
        if (!(n > 0)) return;
        if (d.kind === 'property') {
            const p = PlayerEconomy.findPropertyAt(tile, d.type);
            if (p.type === 'tavern' && (g === 'beer' || g === 'liquor')) {
                if (g === 'beer') p.beerStock = _num(p.beerStock) + n; else p.liquorStock = _num(p.liquorStock) + n;
            } else {
                p.inputStorage = _num(p.inputStorage) + n;
            }
        } else if (d.kind === 'warehouse') {
            const w = MerchantPrince.warehouse(player, d.id);
            w.goods[g] = _c2(_num(w.goods[g]) + n);
        } else if (d.kind === 'home') {
            const h = Household.homes(player).find(x => x.key === d.key);
            const rec = (h && h.rec) || Household.home(player, d.key, true, { name: h && h.name, town: h && h.town, q: d.q, r: d.r });
            rec.larder[g] = _num(rec.larder[g]) + n;
        } else if (d.kind === 'holding') {
            const s = tile.settlement;
            if (Seasons.priceGroup(g) === 'food') {
                if (!s.economy) Economy.initSettlement(s);
                s.economy.food = _num(s.economy.food) + n;
            } else {
                SettlementMarket.ensure(s);
                SettlementMarket.add(s, g, n);
            }
        }
    },

    /**
     * Sell up to `have` of a good at a town's market, as a trade line sells
     * (player/tradeLines.js _sell): paid out of the purse at the town's
     * price curve, never a unit under `floor` (null: the plan's floor share
     * of the base price), the crown's duty and the guild's toll inside it,
     * into the town's stock. → { n, earned, duty, why }
     */
    _sell(world, player, s, g, have, lots, floor = null) {
        const gname = Distribution.goodName(g).toLowerCase();
        const good = TradeLines._good(g);
        if (!s) return { n: 0, earned: 0, why: 'There is no market there.' };
        if (!good || good.noMarket) return { n: 0, earned: 0, why: `No stall buys ${gname}.` };
        const mono = Trading.monopolyBlock(s, g, player);
        if (mono) return { n: 0, earned: 0, why: mono };
        const k = TradeLines._kingdom(world, s.kingdom);
        if (k && Underworld.contrabandStatus(k, g) === 'illegal') return { n: 0, earned: 0, why: `${gname} is contraband there.` };
        let avail = Math.floor(have);
        let policy = TradePolicy.consignCheck(player, world, lots, have, s, g, avail);
        if (!policy.ok) {
            avail = Math.floor(have - _num(policy.embargoed));
            if (avail <= 0) return { n: 0, earned: 0, why: policy.reason };
            policy = TradePolicy.consignCheck(player, world, lots, have, s, g, avail);
            if (!policy.ok) return { n: 0, earned: 0, why: policy.reason };
        }
        const minUnit = floor != null ? floor : _num(good.basePrice) * _num(Distribution.config().sale.floorShare, 0.4);
        const total = (n) => TradeLines.saleTotal(player, good, s, world, policy.mult, n, 0);
        const outlay = (n) => Trading.saleOutlay(player, s, g, total(n), policy);
        let n = minUnit > 0 ? _maxTrue(avail, (q) => total(q) - total(q - 1) >= minUnit) : avail;
        if (n <= 0) return { n: 0, earned: 0, why: `The price at ${s.name} has fallen under ${Utils.formatGold(minUnit)}g.` };
        const purse = Economy.townPurse(s);
        if (purse != null) n = Math.min(n, _maxTrue(n, (q) => outlay(q) <= purse));
        while (n > 0 && Guilds.saleCheck(player, s, g, n)) n = Math.floor(n / 2);
        if (n <= 0) return { n: 0, earned: 0, why: purse != null ? `The merchants of ${s.name} have no coin for it.` : `The guild of ${s.name} will take no more.` };
        const earned = total(n);
        const duty = TradePolicy.consignSale(player, world, lots, s, g, n, earned, policy).duty;
        const toll = Trading._guildToll(player, s, g, earned);
        Economy.drawTown(s, earned + duty + toll);
        Reckoning.noteTrade(player, s, g, n, 'sell', earned);
        SettlementMarket.add(s, g, n);
        Guilds.onSale(player, s, g, n, earned, { tollPaid: true });
        if (Seasons.priceGroup(g) === 'food') {
            if (!s.economy) Economy.initSettlement(s);
            s.economy.food = _num(s.economy.food) + n;
        }
        player.gold = _c2(_num(player.gold) + earned);
        Ledger.record(player, 'distribution', earned);
        return { n, earned, duty, why: n < avail ? `${s.name} bought ${n} of ${avail} (its price or its purse ran out).` : null };
    },

    /** The road's robbers took it: to the nearest outlaw lair's hoard, else the fences of the nearest town. */
    _robbed(world, player, st, c, a, b, out) {
        const g = c.good;
        const n = c.qty;
        const W = (world && world.width) || 0;
        const mid = { q: Math.round((a.q + b.q) / 2), r: Math.round((a.r + b.r) / 2) };
        let lair = null, bd = Infinity;
        for (const l of OutlawLairs.active(player)) {
            if (!Number.isFinite(l.q)) continue;
            const d = Hex.wrappingDistance(l.q, l.r, mid.q, mid.r, W);
            if (d < bd) { bd = d; lair = l; }
        }
        if (lair && bd <= 12) {
            if (!_obj(lair.hoard)) lair.hoard = { gold: 0, goods: {} };
            if (!_obj(lair.hoard.goods)) lair.hoard.goods = {};
            lair.hoard.goods[g] = _num(lair.hoard.goods[g]) + n;
        } else {
            const town = PlayerCoin.nearestTown(world, null, mid);
            if (town) { SettlementMarket.ensure(town); SettlementMarket.add(town, g, n); }
        }
        const value = (PlayerInventory.goodValue(g) || 5) * n;
        const place = `${Distribution._placeName(world, a.q, a.r)} → ${Distribution._placeName(world, b.q, b.r)}`;
        LossBook.report(player, world, { kind: 'distribution', cause: 'robbed on the road', value, ref: `dist:${c.id}`, place, q: mid.q, r: mid.r });
        const leg = Distribution._legOf(player, c);
        if (leg) leg.lost += n;
        st.stats.robbed++;
        st.stats.lost += n;
        c.qty = 0;
        c.done = true;
        const text = `Robbers took ${n} ${Distribution.goodName(g).toLowerCase()} on the road ${place} (about ${Math.round(value)}g)${lair ? `: the outlaws of ${lair.name || 'a lair nearby'} have it` : ''}.`;
        out.notices.push({ icon: '🗡️', title: 'Consignment Robbed', text, type: 'error' });
        Distribution._log(player, world, text);
    },

    /** Waited its days and still not taken: the carters bring it back (carriage paid again, to the town it waited in). */
    _sendBack(world, player, st, c, out) {
        const back = Distribution.route(world, c.to, c.from, null);
        const fee = back.ok ? Distribution.carriage(c.good, c.qty, back) : 0;
        if (!back.ok || _num(player.gold) < fee) {
            // (no coin or no way: it waits on, tried every day)
            c.waitUntil = _day(world) + 1;
            c.why = back.ok ? `No coin to bring it back (${Utils.formatGold(fee)}g).` : back.why;
            return;
        }
        const tile = Distribution._tile(world, c.to.q, c.to.r);
        const town = (tile && tile.settlement) || PlayerCoin.nearestTown(world, null, c.to);
        Distribution._payCarters(world, player, town, tile || c.to, fee);
        c.cost = _c2(_num(c.cost) + fee);
        const leg = Distribution._legOf(player, c);
        if (leg) leg.carriage = _c2(leg.carriage + fee);
        st.stats.carriage = _c2(st.stats.carriage + fee);
        st.stats.returned += c.qty;
        c.status = 'return';
        c.arriveDay = _day(world) + back.days;
        c.robbed = Utils.random() < Distribution.robChance(world, player, c.to, c.from);
        const text = `${c.qty} ${Distribution.goodName(c.good).toLowerCase()} waited ${Distribution.config().waitDays} days at ${Distribution.destName(player, world, c.to)} (${c.why || 'not taken'}); the carters bring it back to ${Distribution._placeName(world, c.from.q, c.from.r)} (${Utils.formatGold(fee)}g).`;
        out.notices.push({ icon: '↩️', title: 'Consignment Returned', text, type: 'warning' });
        Distribution._log(player, world, text);
    },

    /** Back home: into the store as it has room; the rest sold at the source's town; anything left is left with its merchants. */
    _home(world, player, st, c, out) {
        const plan = Distribution.plan(player, c.planId);
        const tile = Distribution._tile(world, c.from.q, c.from.r);
        const prop = tile && plan ? PlayerEconomy.findPropertyAt(tile, plan.type) : (tile ? PlayerEconomy.getPropertiesAt(tile).find(p => Distribution.goodOf(p) === c.good) : null);
        if (prop && Distribution.goodOf(prop) === c.good) {
            const room = Math.max(0, PlayerEconomy.getStorageCapacity(player, prop) - Math.floor(_num(prop.storage)));
            const n = Math.min(room, c.qty);
            prop.storage = _num(prop.storage) + n;
            c.qty -= n;
        }
        if (c.qty > 0) {
            const town = Distribution._sourceTown(world, tile, prop);
            if (town) {
                const sale = Distribution._sell(world, player, town, c.good, c.qty, c.lots, 0);
                c.qty -= sale.n;
                if (c.qty > 0) {
                    SettlementMarket.ensure(town);
                    SettlementMarket.add(town, c.good, c.qty);
                    const value = (PlayerInventory.goodValue(c.good) || 5) * c.qty;
                    LossBook.report(player, world, { kind: 'distribution', cause: 'left unsold', value, ref: `dist:${c.id}`, place: town.name, q: c.from.q, r: c.from.r });
                    const leg = Distribution._legOf(player, c);
                    if (leg) leg.lost += c.qty;
                    st.stats.lost += c.qty;
                    out.notices.push({ icon: '📦', title: 'Goods Left Behind', text: `${c.qty} ${Distribution.goodName(c.good).toLowerCase()} came back to a full store and found no buyer in ${town.name}: left with its merchants.`, type: 'warning' });
                }
            }
        }
        c.qty = 0;
        c.done = true;
    },

    // ──────────── FOR THE PANELS ────────────

    /** Goods of a plan on the road (or waiting): [{ legId, qty, status, arriveDay, to }]. */
    inTransit(player, planId = null) {
        const st = _obj(player && player.distribution);
        if (!st || !Array.isArray(st.transit)) return [];
        return st.transit.filter(c => !c.done && c.qty > 0 && (planId == null || c.planId === planId));
    },

    /** Carriage a day, over the plan's life so far. */
    carriagePerDay(world, plan, leg) {
        const days = Math.max(1, _day(world) - _num(plan.since));
        return _c2(_num(leg.carriage) / days);
    },

    /** The plan's warnings: shares over 100, destinations that cannot take the good. */
    warnings(player, world, plan) {
        const out = [];
        const sum = Distribution._sharesSum(plan);
        if (sum > 100) out.push(`The shares come to ${sum}%: more than the whole.`);
        for (const leg of [...plan.shares, plan.rest]) {
            if (leg.dest.kind === 'keep') continue;
            const can = Distribution.canTake(player, world, leg.dest, plan.good);
            if (!can.ok) out.push(`${Distribution.destName(player, world, leg.dest)}: ${can.why}`);
            else if (leg.warn) out.push(`${Distribution.destName(player, world, leg.dest)}: ${leg.warn}`);
            const rt = Distribution.route(world, { q: plan.q, r: plan.r }, leg.dest, leg);
            if (!rt.ok) out.push(`${Distribution.destName(player, world, leg.dest)}: ${rt.why}`);
        }
        if (plan.warn) out.push(plan.warn);
        return [...new Set(out)];
    },

    /** Every plan, for the overview: [{ plan, name, good, shares, rest, transit, warnings }]. */
    view(player, world) {
        const st = _obj(player && player.distribution);
        if (!st) return { plans: [], transit: [], stats: Distribution._blank().stats };
        Distribution.state(player);
        const plans = st.plans.map(plan => ({
            plan, name: plan.name, good: plan.good, where: Distribution._placeName(world, plan.q, plan.r),
            legs: [...plan.shares, plan.rest].map(l => ({
                leg: l, name: Distribution.destName(player, world, l.dest), icon: Distribution.destIcon(l.dest),
                pct: l.rest ? Math.max(0, 100 - Distribution._sharesSum(plan)) : l.pct,
                transit: Distribution.inTransit(player, plan.id).filter(c => c.legId === l.id && c.status !== 'waiting').reduce((a, c) => a + c.qty, 0),
                waiting: Distribution.inTransit(player, plan.id).filter(c => c.legId === l.id && c.status === 'waiting').reduce((a, c) => a + c.qty, 0),
            })),
            warnings: Distribution.warnings(player, world, plan),
        }));
        const transit = Distribution.inTransit(player).map(c => ({ ...c, toName: Distribution.destName(player, world, c.status === 'return' ? { kind: 'keep' } : c.to) }));
        return { plans, transit, stats: st.stats, log: st.log };
    },
};
