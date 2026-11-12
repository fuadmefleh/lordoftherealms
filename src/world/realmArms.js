// ============================================
// REALM ARMS — the crowns' armouries: arms bought, worn, lost and stripped
// ============================================
// A realm's army (kingdom.military, in men) fights with what its arsenals
// hold: kingdom.armoury.stock = { good: pieces } of the same goods the town
// armourers make and sell (weapons, spears, bows, crossbows, shields, helms,
// gambesons, leather, mail) and the arrows and bolts its archers loose.
//
//   need      a kit per `menPerKit` men (data/arms.json realms): a weapon for
//             the foot and horse, a bow for the archers (the army's archer
//             share, kept on the armoury by KingdomAI), a shield for the
//             foot, a helm and a body armour for every man, a quiver per
//             archer kit
//   buying    every `buyEvery` days (staggered by realm) the crown buys
//             what it lacks out of its own towns' market stock, cheapest
//             first, at the town's price: the treasury pays the town's purse
//             (booked on the crown's 'arms' line). Never more than a share of
//             a town's stock at once, never past the treasury's reserve
//   wear      pieces wear out, faster at war: this is the realm's draw on its
//             towns' arms (the old war-demand multiplier on the markets is gone)
//   battle    the fallen's arms are lost; the side holding the field gathers
//             some of its own and strips some of the beaten's; both loose
//             their arrows (the victor picks a few up)
//   surplus   past `keep` × the need (a demobilised army, a rich haul) the
//             crown sells the rest back to its best-stocked town, as far as
//             that town's purse pays
//   factor    battle power × the arms factor: the soldier's and the archer's
//             kit worth (data/arms.json troops.kits) by how full each slot
//             is and the pieces' tier; archers short of arrows at dryMult
//
// Kept in the world layer (no imports above world/): KingdomAI calls
// `daily` from updateMilitary and `battle` from simulateBattle; systems
// (realmWars, holdingSieges) `detach` a host's share and `attach` what comes
// home. Pure: no RNG, no globals.

import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from './settlementMarket.js';
import { Economy } from './economy.js';
import { CrownBooks } from './crownBooks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const DEFAULTS = {
    menPerKit: 10, buyEvery: 3, spendShare: 0.12, reserveBase: 300, reservePerMan: 0.8, marketShare: 0.5,
    keep: 1.25, sellShare: 0.6, start: 1,
    wear: { peace: 0.0006, war: 0.004 },
    lostShare: 1, recoverOwn: 0.35, strip: 0.3,
    quiver: 16, perBattle: 8, arrowRecover: 0.25, dryMult: 0.35, minFactor: 0.6,
    meleeKit: 'soldier', rangedKit: 'archer',
    slots: { main: ['weapons', 'spear'], ranged: ['bow', 'crossbow'], off: ['shield'], head: ['helmet'], body: ['gambeson', 'leather_armor', 'chainmail'] },
    ammo: { bow: 'arrows', crossbow: 'bolts' },
    order: ['main', 'ranged', 'body', 'off', 'head', 'ammo'],
};
const ARCHER_SHARE = 0.28;

let _src;
let _cfg = null;

function _hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

export const RealmArms = {
    /** data/arms.json realms over the defaults, with the kit weights and the item tiers. */
    config() {
        const gd = DataLoader._gamedata;
        const arms = (gd && _obj(gd.arms)) || {};
        if (!_cfg || arms !== _src) {
            _src = arms;
            const d = _obj(arms.realms) || {};
            const c = { ...DEFAULTS };
            for (const [k, v] of Object.entries(d)) {
                if (k.startsWith('_')) continue;
                c[k] = _obj(v) && _obj(DEFAULTS[k]) ? { ...DEFAULTS[k], ...v } : v;
            }
            const troops = _obj(arms.troops) || {};
            const kits = _obj(troops.kits) || {};
            const kitOf = (id, fb) => {
                const k = _obj(kits[id]) || fb;
                const w = {};
                for (const [slot, s] of Object.entries(_obj(k.slots) || {})) w[slot] = _num(s && s.w);
                return { bare: _clamp(_num(k.bare, 0.55), 0.1, 1), w };
            };
            c.melee = kitOf(c.meleeKit, { bare: 0.55, slots: { main: { w: 0.45 }, off: { w: 0.2 }, head: { w: 0.1 }, body: { w: 0.25 } } });
            c.ranged = kitOf(c.rangedKit, { bare: 0.45, slots: { main: { w: 0.7 }, head: { w: 0.1 }, body: { w: 0.2 } } });
            c.maxFactor = _num(troops.maxFactor, 1.45);
            c.tier = {};
            const items = _obj(arms.items) || {};
            for (const ids of Object.values(c.slots)) for (const id of ids) c.tier[id] = _num(items[id] && items[id].tier, 1);
            // which good is which slot, and what each ranged weapon shoots
            c.slotOf = {};
            for (const [slot, ids] of Object.entries(c.slots)) for (const id of ids) c.slotOf[id] = slot;
            c.ammoGoods = [...new Set(Object.values(c.ammo))];
            _cfg = c;
        }
        return _cfg;
    },

    /** The goods table entry (data/playerEconomy.json GOODS) of a good id. */
    _good(id) {
        const pe = DataLoader._gamedata && DataLoader._gamedata.playerEconomy;
        const G = (pe && pe.GOODS) || {};
        return G[String(id).toUpperCase()] || null;
    },

    /** kingdom.armoury, created when missing (filled `start` of its need: the arsenals at the start). */
    state(kingdom) {
        if (!kingdom) return null;
        let a = _obj(kingdom.armoury);
        if (a && _obj(a.stock)) return a;
        a = kingdom.armoury = {
            stock: {}, archer: ARCHER_SHARE, factor: 1,
            stats: { bought: 0, spent: 0, sold: 0, earned: 0, worn: 0, lost: 0, stripped: 0, arrows: 0 },
        };
        const C = RealmArms.config();
        const need = RealmArms.need(kingdom);
        const fill = _clamp(_num(C.start, 1), 0, 2);
        // (the first good of each slot, the body split between its first two)
        for (const [slot, ids] of Object.entries(C.slots)) {
            const n = need.slots[slot] * fill;
            if (!(n > 0) || !ids.length) continue;
            if (slot === 'body' && ids.length > 1) {
                a.stock[ids[0]] = _r2(n / 2);
                a.stock[ids[1]] = _r2(n / 2);
            } else a.stock[ids[0]] = _r2(n);
        }
        const firstAmmo = C.ammo[(C.slots.ranged || [])[0]] || 'arrows';
        if (need.ammo > 0) a.stock[firstAmmo] = _r2(need.ammo * fill);
        return a;
    },

    /**
     * What the army needs: { men, kits, archer, slots: { main, ranged, off,
     * head, body } (pieces), ammo (arrows and bolts together), battle
     * (missiles one battle looses) }.
     */
    need(kingdom) {
        const C = RealmArms.config();
        const men = Math.max(0, _num(kingdom && kingdom.military));
        const kits = men / Math.max(1, _num(C.menPerKit, 10));
        const a = _clamp(_num(kingdom && kingdom.armoury && kingdom.armoury.archer, ARCHER_SHARE), 0, 1);
        return {
            men, kits, archer: a,
            slots: { main: kits * (1 - a), ranged: kits * a, off: kits * (1 - a), head: kits, body: kits },
            ammo: kits * a * _num(C.quiver, 16),
            battle: kits * a * _num(C.perBattle, 8),
        };
    },

    /** What the arsenals hold by slot: { slot: { n, tier } } and ammo { n }. */
    held(kingdom) {
        const C = RealmArms.config();
        const st = (kingdom && kingdom.armoury && kingdom.armoury.stock) || {};
        const out = {};
        for (const [slot, ids] of Object.entries(C.slots)) {
            let n = 0, t = 0;
            for (const id of ids) {
                const v = Math.max(0, _num(st[id]));
                n += v;
                t += v * _num(C.tier[id], 1);
            }
            out[slot] = { n, tier: n > 0 ? t / n : 1 };
        }
        let ammo = 0;
        for (const g of C.ammoGoods) ammo += Math.max(0, _num(st[g]));
        out.ammo = { n: ammo };
        return out;
    },

    /**
     * The army's arms factor on its battle power: 1 for a realm fully kitted
     * in common iron, down to minFactor for an unarmed rabble, above 1 in mail.
     */
    factor(kingdom) {
        if (!kingdom || !(_num(kingdom.military) > 0) || !_obj(kingdom.armoury)) return 1;
        const C = RealmArms.config();
        const need = RealmArms.need(kingdom);
        const h = RealmArms.held(kingdom);
        const fill = (slot, of) => (of > 0 ? _clamp(h[slot].n / of, 0, 1) : 1);
        const part = (slot, of) => fill(slot, of) * h[slot].tier;
        const M = C.melee, R = C.ranged;
        const melee = M.bare + (1 - M.bare) * (_num(M.w.main) * part('main', need.slots.main)
            + _num(M.w.off) * part('off', need.slots.off)
            + _num(M.w.head) * part('head', need.kits) + _num(M.w.body) * part('body', need.kits));
        // A bow without arrows for the day is a stick
        const bows = Math.min(h.ranged.n, need.slots.ranged);
        const shots = bows * _num(C.perBattle, 8);
        const dry = _clamp(_num(C.dryMult, 0.35), 0, 1);
        const ammoF = shots > 0 ? dry + (1 - dry) * _clamp(h.ammo.n / shots, 0, 1) : 1;
        const ranged = R.bare + (1 - R.bare) * (_num(R.w.main) * part('ranged', need.slots.ranged) * ammoF
            + _num(R.w.head) * part('head', need.kits) + _num(R.w.body) * part('body', need.kits));
        const a = need.archer;
        return _r2(_clamp((1 - a) * melee + a * ranged, _num(C.minFactor, 0.45), _num(C.maxFactor, 1.45)));
    },

    /** The realm's towns with a market: [{ s (live settlement), tile }]. */
    _towns(kingdom, world) {
        if (!world || typeof world.getTile !== 'function') return [];
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : (typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : []);
        const out = [];
        for (const v of views) {
            if (!v || v.kingdom !== kingdom.id) continue;
            const tile = world.getTile(v.q, v.r);
            const s = tile && tile.settlement;
            if (!s || !s.market || s.kingdom !== kingdom.id) continue;
            out.push({ s, tile });
        }
        return out;
    },

    /** The gold the crown keeps back from arms (its reserve). */
    reserve(kingdom) {
        const C = RealmArms.config();
        return _num(C.reserveBase, 300) + Math.max(0, _num(kingdom.military)) * _num(C.reservePerMan, 0.8);
    },

    /**
     * A day of the realm's armoury (KingdomAI.updateMilitary, after the
     * army's size is settled): wear, and on its buying day what it lacks
     * bought from its towns and the surplus sold back. comp: the army's
     * composition ({ archer }), when the caller knows it. Draws no RNG.
     * → { bought: {good: n}, cost, sold: {good: n}, earned } or null.
     */
    daily(kingdom, world, comp = null, days = 1) {
        const n = days > 1 ? Math.floor(days) : 1;
        if (!kingdom || !kingdom.isAlive) return null;
        const a = RealmArms.state(kingdom);
        if (comp && Number.isFinite(comp.archer)) a.archer = _r2(_clamp(comp.archer, 0, 1));
        const C = RealmArms.config();
        const war = Array.isArray(kingdom.wars) && kingdom.wars.length > 0;
        // Pieces wear out: the realm's steady draw on its towns' armourers
        const rate = _clamp(_num(war ? C.wear.war : C.wear.peace), 0, 0.5);
        // (`days`: the distant years — that many days' wear, and the buyers come round once)
        for (let d = 0; d < n && rate > 0; d++) {
            let worn = 0;
            for (const id of Object.keys(a.stock)) {
                if (!C.slotOf[id]) continue;
                const v = _num(a.stock[id]);
                const left = _r2(v * (1 - rate));
                worn += v - left;
                a.stock[id] = left;
            }
            a.stats.worn = _r2(_num(a.stats.worn) + worn);
        }
        const day = Math.floor(_num(world && world.day));
        const every = Math.max(1, Math.floor(_num(C.buyEvery, 3)));
        let res = null;
        if (n > 1 || (day + (_hash(String(kingdom.id)) % every)) % every === 0) {
            res = RealmArms.buy(kingdom, world);
            const sold = RealmArms.sellSurplus(kingdom, world);
            res.sold = sold.sold;
            res.earned = sold.earned;
        }
        a.factor = RealmArms.factor(kingdom);
        return res;
    },

    /** What each slot (and the ammo) lacks, in whole pieces: { slot: n }. */
    deficits(kingdom) {
        const need = RealmArms.need(kingdom);
        const h = RealmArms.held(kingdom);
        const out = {};
        for (const slot of Object.keys(need.slots)) out[slot] = Math.max(0, Math.floor(need.slots[slot] - h[slot].n + 0.5));
        out.ammo = Math.max(0, Math.floor(need.ammo - h.ammo.n + 0.5));
        return out;
    },

    /**
     * Buy what the army lacks out of the realm's towns' stock (cheapest
     * first; the treasury pays each town's purse). → { bought, cost }
     */
    buy(kingdom, world) {
        const C = RealmArms.config();
        const a = RealmArms.state(kingdom);
        const out = { bought: {}, cost: 0 };
        let budget = Math.max(0, _num(kingdom.treasury) - RealmArms.reserve(kingdom)) * _clamp(_num(C.spendShare, 0.12), 0, 1);
        if (!(budget >= 1)) return out;
        const towns = RealmArms._towns(kingdom, world);
        if (!towns.length) return out;
        const def = RealmArms.deficits(kingdom);
        const share = _clamp(_num(C.marketShare, 0.5), 0, 1);
        // The ammunition wanted: arrows for the bows held, bolts for the crossbows
        const ammoGoods = () => {
            const st = a.stock;
            const goods = [];
            for (const [weapon, g] of Object.entries(C.ammo)) if (_num(st[weapon]) > 0.5 && !goods.includes(g)) goods.push(g);
            return goods.length ? goods : [C.ammo[(C.slots.ranged || [])[0]] || 'arrows'];
        };
        for (const slot of C.order) {
            let want = _num(def[slot]);
            const goods = slot === 'ammo' ? ammoGoods() : (C.slots[slot] || []);
            // (ammo is bought by the sheaf: a few dozen at a time)
            const lot = slot === 'ammo' ? 24 : 4;
            for (let guard = 0; want > 0 && budget >= 1 && guard < 60; guard++) {
                let best = null;
                for (const t of towns) {
                    for (const id of goods) {
                        if (!SettlementMarket.tracks(id)) continue;
                        const can = Math.floor(SettlementMarket.stock(t.s, id) * share + 1e-9);
                        if (!(can >= 1)) continue;
                        const good = RealmArms._good(id);
                        if (!good) continue;
                        const price = Math.max(1, Economy.marketPrice(good, t.s, t.tile, world));
                        // (the cheapest for the worth it gives: price / tier)
                        const v = price / Math.max(0.1, _num(C.tier[id], 1));
                        if (!best || v < best.v) best = { t, id, price, can, v };
                    }
                }
                if (!best) break;
                const n = Math.min(want, best.can, lot, Math.floor(budget / best.price));
                if (!(n >= 1)) break;
                const got = Math.floor(SettlementMarket.take(best.t.s, best.id, n) + 1e-9);
                if (!(got >= 1)) break;
                const cost = got * best.price;
                kingdom.treasury = _r2(_num(kingdom.treasury) - cost);
                Economy.payTown(best.t.s, cost);
                CrownBooks.note(kingdom, 'arms', cost);
                a.stock[best.id] = _r2(_num(a.stock[best.id]) + got);
                out.bought[best.id] = _num(out.bought[best.id]) + got;
                out.cost += cost;
                budget -= cost;
                want -= got;
            }
        }
        if (out.cost > 0) {
            a.stats.bought = _r2(_num(a.stats.bought) + Object.values(out.bought).reduce((s, v) => s + v, 0));
            a.stats.spent = _r2(_num(a.stats.spent) + out.cost);
            a.lastBuy = { day: _num(world && world.day), bought: out.bought, cost: out.cost };
        }
        return out;
    },

    /**
     * More than keep × the need in store: the rest sold back to the realm's
     * town that holds least of it, at sellShare of its price, as far as the
     * town's purse pays. → { sold, earned }
     */
    sellSurplus(kingdom, world) {
        const C = RealmArms.config();
        const a = RealmArms.state(kingdom);
        const out = { sold: {}, earned: 0 };
        const towns = RealmArms._towns(kingdom, world);
        if (!towns.length) return out;
        const need = RealmArms.need(kingdom);
        const h = RealmArms.held(kingdom);
        const keep = Math.max(1, _num(C.keep, 1.25));
        const over = {};
        for (const [slot, ids] of Object.entries(C.slots)) {
            const of = slot === 'head' || slot === 'body' ? need.kits : need.slots[slot];
            let extra = h[slot].n - of * keep;
            if (!(extra >= 1)) continue;
            // (the cheapest kind goes first)
            for (const id of ids.slice().reverse()) {
                const n = Math.min(Math.floor(_num(a.stock[id])), Math.floor(extra));
                if (n >= 1) { over[id] = n; extra -= n; }
                if (extra < 1) break;
            }
        }
        const ammoExtra = Math.floor(h.ammo.n - need.ammo * keep);
        if (ammoExtra >= 1) {
            let left = ammoExtra;
            for (const g of C.ammoGoods) {
                const n = Math.min(Math.floor(_num(a.stock[g])), left);
                if (n >= 1) { over[g] = n; left -= n; }
            }
        }
        for (const [id, n] of Object.entries(over)) {
            if (!SettlementMarket.tracks(id)) continue;
            const good = RealmArms._good(id);
            if (!good) continue;
            let to = null;
            for (const t of towns) {
                const st = SettlementMarket.stock(t.s, id);
                if (!to || st < to.st) to = { t, st };
            }
            if (!to) continue;
            const price = Math.max(1, Math.floor(Economy.marketPrice(good, to.t.s, to.t.tile, world) * _clamp(_num(C.sellShare, 0.6), 0, 1)));
            const purse = Math.max(0, _num(to.t.s.economy && to.t.s.economy.gold));
            const k = Math.min(n, Math.floor(purse / price));
            if (!(k >= 1)) continue;
            const pay = Economy.drawTown ? Economy.drawTown(to.t.s, k * price) : 0;
            if (!(pay > 0)) continue;
            const units = Math.floor(pay / price + 1e-9);
            SettlementMarket.add(to.t.s, id, units);
            a.stock[id] = _r2(Math.max(0, _num(a.stock[id]) - units));
            kingdom.treasury = _r2(_num(kingdom.treasury) + pay);
            CrownBooks.note(kingdom, 'sales', pay);
            out.sold[id] = units;
            out.earned += pay;
        }
        if (out.earned > 0) {
            a.stats.sold = _r2(_num(a.stats.sold) + Object.values(out.sold).reduce((s, v) => s + v, 0));
            a.stats.earned = _r2(_num(a.stats.earned) + out.earned);
        }
        return out;
    },

    /** Take a share of every arms good (not the ammo) out of the stock. → { good: n } taken */
    _takeShare(kingdom, share, ammoToo = false) {
        const C = RealmArms.config();
        const a = RealmArms.state(kingdom);
        const out = {};
        const s = _clamp(_num(share), 0, 1);
        if (!(s > 0)) return out;
        for (const id of Object.keys(a.stock)) {
            if (!C.slotOf[id] && !(ammoToo && C.ammoGoods.includes(id))) continue;
            const v = _num(a.stock[id]);
            const n = _r2(v * s);
            if (!(n > 0)) continue;
            a.stock[id] = _r2(v - n);
            out[id] = n;
        }
        return out;
    },

    _addTo(kingdom, goods, share = 1) {
        const a = RealmArms.state(kingdom);
        let n = 0;
        for (const [id, v] of Object.entries(goods || {})) {
            const add = _r2(_num(v) * share);
            if (!(add > 0)) continue;
            a.stock[id] = _r2(_num(a.stock[id]) + add);
            n += add;
        }
        return n;
    },

    /** Missiles loosed in a battle: per archer kit `perBattle`, as far as the quivers hold. → { good: n } */
    _loose(kingdom, menBefore) {
        const C = RealmArms.config();
        const a = RealmArms.state(kingdom);
        const kits = Math.max(0, _num(menBefore)) / Math.max(1, _num(C.menPerKit, 10));
        const bows = Math.min(RealmArms.held(kingdom).ranged.n, kits * a.archer);
        let want = bows * _num(C.perBattle, 8);
        const out = {};
        for (const g of C.ammoGoods) {
            if (!(want > 0)) break;
            const n = Math.min(_num(a.stock[g]), want);
            if (!(n > 0)) continue;
            a.stock[g] = _r2(_num(a.stock[g]) - n);
            out[g] = _r2(n);
            want -= n;
        }
        return out;
    },

    /**
     * A pitched battle is over (KingdomAI.simulateBattle, after both armies
     * bled): the fallen's arms are lost, the field's holder gathers some of
     * its own and strips some of the beaten's; both sides' arrows are loosed
     * and the victor picks a few up. before: { [kingdomId]: men before }.
     * → { [kingdomId]: { lost, gathered, stripped, loosed } }
     */
    battle(winner, loser, before = {}) {
        const C = RealmArms.config();
        const out = {};
        const lossOf = (k) => {
            const b = Math.max(0, _num(before[k.id], _num(k.military)));
            return b > 0 ? _clamp((b - Math.max(0, _num(k.military))) / b, 0, 1) : 0;
        };
        const sides = [winner, loser].filter(Boolean);
        const lost = {};
        for (const k of sides) {
            RealmArms.state(k);
            const loosed = RealmArms._loose(k, _num(before[k.id], _num(k.military)));
            lost[k.id] = RealmArms._takeShare(k, lossOf(k) * _clamp(_num(C.lostShare, 1), 0, 1));
            const lostN = Object.values(lost[k.id]).reduce((s, v) => s + v, 0);
            k.armoury.stats.lost = _r2(_num(k.armoury.stats.lost) + lostN);
            k.armoury.stats.arrows = _r2(_num(k.armoury.stats.arrows) + Object.values(loosed).reduce((s, v) => s + v, 0));
            out[k.id] = { lost: lost[k.id], loosed, gathered: 0, stripped: 0 };
            if (k === winner) out[k.id].gathered += RealmArms._addTo(k, loosed, _num(C.arrowRecover, 0.25));
        }
        if (winner) {
            out[winner.id].gathered += RealmArms._addTo(winner, lost[winner.id], _num(C.recoverOwn, 0.35));
            if (loser) {
                const s = RealmArms._addTo(winner, lost[loser.id], _num(C.strip, 0.3));
                out[winner.id].stripped = s;
                winner.armoury.stats.stripped = _r2(_num(winner.armoury.stats.stripped) + s);
            }
        }
        for (const k of sides) k.armoury.factor = RealmArms.factor(k);
        return out;
    },

    /**
     * A host marches out with `men` of the realm's army (the caller takes
     * the men): its share of the armoury and quivers goes with it.
     * → { stock, armed } (armed: its arms factor) — keep it on the host.
     */
    detach(kingdom, men) {
        if (!kingdom) return null;
        RealmArms.state(kingdom);
        const total = Math.max(0, _num(kingdom.military)) + Math.max(0, _num(men));
        const share = total > 0 ? _clamp(_num(men) / total, 0, 1) : 0;
        const armed = RealmArms.factor({ ...kingdom, military: total });
        const stock = RealmArms._takeShare(kingdom, share, true);
        return { stock, armed };
    },

    /** A host comes home: `share` of what it took (the survivors' arms) back into the armoury. */
    attach(kingdom, arms, share = 1) {
        if (!kingdom || !arms || !_obj(arms.stock)) return 0;
        return RealmArms._addTo(kingdom, arms.stock, _clamp(_num(share), 0, 1));
    },

    /**
     * A rising arms itself out of its town's stalls: `share` of every arms
     * good and missile the town's market holds goes into the armoury (the
     * rebels pay nothing). → pieces taken
     */
    seizeTown(kingdom, settlement, share = 0.6) {
        if (!kingdom || !settlement || !settlement.market) return 0;
        const C = RealmArms.config();
        const a = RealmArms.state(kingdom);
        let n = 0;
        for (const id of [...Object.keys(C.slotOf), ...C.ammoGoods]) {
            const take = Math.floor(SettlementMarket.stock(settlement, id) * _clamp(share, 0, 1));
            if (!(take >= 1)) continue;
            const got = SettlementMarket.take(settlement, id, take);
            a.stock[id] = _r2(_num(a.stock[id]) + got);
            n += got;
        }
        return n;
    },

    /** The armoury for the panels: { factor, need, held, deficits, stock, stats, lastBuy }. */
    summary(kingdom) {
        if (!kingdom || !_obj(kingdom.armoury)) return null;
        return {
            factor: RealmArms.factor(kingdom),
            need: RealmArms.need(kingdom),
            held: RealmArms.held(kingdom),
            deficits: RealmArms.deficits(kingdom),
            stock: { ...kingdom.armoury.stock },
            stats: { ...kingdom.armoury.stats },
            lastBuy: kingdom.armoury.lastBuy || null,
        };
    },
};
