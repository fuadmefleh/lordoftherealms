// ============================================
// COIN CENSUS — where each realm's coin actually is
// ============================================
// The money supply (world/moneySupply.js) is the real coin held in each
// realm: this module walks every purse in the world and the player's state
// once a week and sums it by the realm it sits in. Two kinds of holding:
//
//   in circulation (moves prices: MoneySupply's price level reads it)
//     • towns         settlement.economy.gold (the market's and the people's
//                     common purse — by far the largest)
//     • folk          the townsfolk's own purses (settlement.folk.people[].purse,
//                     only once rolled: an unrolled purse is not coin yet;
//                     parents' savings are these same purses)
//     • underworld    gangs' purses, the bribed watch captain's and magistrate's
//     • guilds        guild treasuries and their lobbying purses
//     • inns          the innkeepers' cash (world.hospitality)
//     • couriers      the courier companies' cash (world.post)
//     • roads         coin carried by units on the map — merchant caravans' and
//                     trade ships' purses, raiders', riders', armies' bags —
//                     counted in the realm whose land they stand on (none in
//                     the wilds or at sea); pedlars' purses (systems/townTrade.js)
//                     in the realm of the town they are bound for or in
//     • court         court and relationship NPCs' purses, in their realm
//     • outlaws       outlaw lairs' hoards (none in the wilds)
//     • rivals        adventurer rivals' gold, where they stand
//
//   held out of circulation (broad money: moves no prices until it is spent)
//     • treasury      the crown's chests (kingdom.treasury) and the crown's
//                     own estate purse
//     • coffers       the great landholders' coffers: the nobles', the
//                     church's and the burghers' estate purses (world.estates;
//                     merchant houses' estates have no realm) and the rival
//                     Houses' gold, at their seat — savings spent into the
//                     towns month by month, as the crown spends its chests
//     • banks         the banks' vaults (bank.capital of open banks), the
//                     underwriters' capital and the rival merchant houses'
//                     capital (trading companies working across every realm),
//                     in their seat's realm
//     • player        the player's purse, in the realm the player stands in:
//                     a single purse that can hold more than a town and that
//                     travels, so it is a hoard; the coin moves prices once it
//                     is spent into a town, a person's or a guild's purse
//
// Pure read: no randomness, no writes. world-scoped holders come from
// `world`, player-scoped ones (rival Houses, banks, NPCs, merchant houses,
// lairs, rivals) from `player` (null: those are left out).

import { Relationships } from './relationships.js';
import { Barter } from '../world/barter.js';

const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _pos = (v) => { const n = _num(v); return n > 0 ? n : 0; };

/** Circulating holder kinds, in the order the census reports them. */
export const CIRCULATING = ['towns', 'folk', 'underworld', 'guilds', 'inns', 'couriers', 'roads', 'court', 'outlaws', 'rivals'];
/** Hoards: broad money outside circulation. */
export const HOARDS = ['treasury', 'coffers', 'banks', 'player'];

function _blank() {
    const o = { coin: 0, broad: 0 };
    for (const k of CIRCULATING) o[k] = 0;
    for (const k of HOARDS) o[k] = 0;
    return o;
}

/** The realm id of a map position: the town's realm, else the land's owner, else null. */
function _realmAt(world, q, r) {
    if (!world || typeof world.getTile !== 'function' || !Number.isFinite(q) || !Number.isFinite(r)) return null;
    const t = world.getTile(q, r);
    if (!t) return null;
    if (t.settlement && t.settlement.kingdom != null) return t.settlement.kingdom;
    return t.kingdom != null ? t.kingdom : null;
}

export const CoinCensus = {
    CIRCULATING,
    HOARDS,

    realmAt: _realmAt,

    /**
     * Count every purse by realm: Map(kid → { coin, broad, towns, folk, …,
     * treasury, banks, player }). coin = the circulating total, broad = coin +
     * the hoards. Only living realms are counted; `opts.towns` false skips the
     * town and folk purses (MoneySupply counts those itself).
     */
    count(world, player = null, opts = {}) {
        const out = new Map();
        if (!world) return out;
        const alive = new Set();
        for (const k of world.kingdoms || []) if (k && k.isAlive !== false && k.id != null) { alive.add(k.id); out.set(k.id, _blank()); }
        const add = (kid, kind, v) => {
            if (kid == null || !alive.has(kid)) return;
            const n = _pos(v);
            if (n > 0) out.get(kid)[kind] += n;
        };
        const withTowns = opts.towns !== false;

        // The towns: purse, townsfolk, underworld, guilds
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views) {
            const tile = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = (tile && tile.settlement) || v;
            const kid = s && s.kingdom;
            if (kid == null || !alive.has(kid)) continue;
            if (withTowns) {
                if (s.economy) add(kid, 'towns', s.economy.gold);
                const folk = s.folk && Array.isArray(s.folk.people) ? s.folk.people : null;
                if (folk) for (const p of folk) if (p && !p.died && !p.away && typeof p.purse === 'number') add(kid, 'folk', p.purse);
            }
            const uw = _obj(s.underworld);
            if (uw) {
                for (const g of Array.isArray(uw.gangs) ? uw.gangs : []) if (g) add(kid, 'underworld', g.purse);
                const w = _obj(uw.watch);
                if (w) for (const who of ['captain', 'magistrate']) if (w[who]) add(kid, 'underworld', w[who].purse);
            }
            const gs = _obj(s.guilds);
            if (gs) for (const g of Object.values(gs)) if (g) { add(kid, 'guilds', g.treasury); if (g.lobbying) add(kid, 'guilds', g.lobbying.purse); }
            // Pedlars on the road to this town or in it (systems/townTrade.js): coin carried on the roads
            const tt = _obj(s.townTrade);
            if (tt && Array.isArray(tt.pedlars)) for (const ped of tt.pedlars) if (ped) add(kid, 'roads', ped.purse);
        }

        // Inns and courier companies
        const hosp = _obj(world.hospitality);
        if (hosp && _obj(hosp.houses)) for (const h of Object.values(hosp.houses)) if (h) add(_realmAt(world, h.q, h.r), 'inns', h.cash);
        const post = _obj(world.post);
        if (post && Array.isArray(post.couriers)) {
            for (const c of post.couriers) {
                if (!c) continue;
                let kid = c.kingdomId;
                if (kid == null && typeof c.home === 'string') { const [q, r] = c.home.split(',').map(Number); kid = _realmAt(world, q, r); }
                add(kid, 'couriers', c.cash);
            }
        }

        // The landholders' coffers (the crown's purse is the crown's): hoards
        const est = _obj(world.estates);
        if (est && _obj(est.holders)) {
            for (const h of Object.values(est.holders)) {
                if (!h || h.purse == null || h.kind === 'player') continue;
                add(h.kid, h.kind === 'crown' ? 'treasury' : 'coffers', h.purse);
            }
        }

        // Coin on the roads: where the unit stands
        for (const u of Array.isArray(world.units) ? world.units : []) {
            if (!u || u.destroyed) continue;
            const coin = typeof u.purse === 'number' ? u.purse : u.inventory ? u.inventory.gold : 0;
            if (_pos(coin) > 0) add(_realmAt(world, u.q, u.r), 'roads', coin);
        }

        // The crowns' chests
        for (const k of world.kingdoms || []) if (k && alive.has(k.id)) add(k.id, 'treasury', k.treasury);

        if (player) {
            // Rival Houses, at their seat
            const rivals = player.house && _obj(player.house.rivals);
            if (rivals) for (const h of Object.values(rivals)) if (h && !h.extinct) add(h.kingdomId != null ? h.kingdomId : h.seat ? _realmAt(world, h.seat.q, h.seat.r) : null, 'coffers', h.gold);
            // Court and relationship NPCs (once a courtier leaves, the purse is the townsperson's)
            const npcs = Array.isArray(Relationships._npcs) && Relationships._npcs.length ? Relationships._npcs
                : Array.isArray(player._relationshipNpcs) ? player._relationshipNpcs : [];
            for (const n of npcs) {
                if (!n || n.isAlive === false || n.dead) continue;
                const kid = n.kingdomId != null ? n.kingdomId : _realmAt(world, n.settlementQ, n.settlementR);
                add(kid, 'court', n.purse);
            }
            // Rival merchant houses' capital, at their seat (with the banks: a hoard)
            const mer = _obj(player.merchant);
            if (mer && Array.isArray(mer.rivals)) for (const r of mer.rivals) if (r && r.seat && !r.bankrupt) add(_realmAt(world, r.seat.q, r.seat.r), 'banks', r.capital);
            // Outlaw lairs
            const ol = _obj(player.outlawLairs);
            if (ol && Array.isArray(ol.lairs)) for (const l of ol.lairs) if (l && l.hoard && !l.destroyed && !l.cleared) add(l.kingdomId, 'outlaws', l.hoard.gold);
            // Adventurer rivals
            const rv = _obj(player.rivals);
            if (rv && Array.isArray(rv.list)) for (const r of rv.list) if (r && !r.dead) add(_realmAt(world, r.q, r.r), 'rivals', r.gold);
            // Banks' vaults and the underwriters
            const fin = _obj(player.finance);
            if (fin && Array.isArray(fin.banks)) for (const b of fin.banks) if (b && b.status === 'open') add(b.kingdomId, 'banks', b.capital);
            const uw = _obj(player.underwriting);
            if (uw && Array.isArray(uw.guilds)) for (const g of uw.guilds) if (g) add(g.kingdomId, 'banks', g.capital);
            // The player's own purse: where they stand
            // (real coin only: in a barter place `player.gold` reads the goods carried — world/barter.js)
            add(_realmAt(world, player.q, player.r), 'player', Barter.coinOf(player));
        }

        for (const o of out.values()) {
            let c = 0, h = 0;
            for (const k of CIRCULATING) { o[k] = Math.round(o[k] * 100) / 100; c += o[k]; }
            for (const k of HOARDS) { o[k] = Math.round(o[k] * 100) / 100; h += o[k]; }
            o.coin = Math.round(c * 100) / 100;
            o.broad = Math.round((c + h) * 100) / 100;
        }
        return out;
    },

    /**
     * Every purse in the world and the player's state, wherever it is (in a
     * realm or not): fn(holder, key, kind) for each holder whose coin is
     * holder[key]. The same holders as count() walks, plus the crowns' royal
     * banks; the player's own purse is left out (world/barter.js keeps it).
     */
    each(world, player, fn) {
        if (!world) return;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views) {
            const tile = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = (tile && tile.settlement) || v;
            if (!s) continue;
            if (s.economy) fn(s.economy, 'gold', 'towns');
            if (s.folk && Array.isArray(s.folk.people)) for (const p of s.folk.people) if (p && typeof p.purse === 'number') fn(p, 'purse', 'folk');
            const uw = _obj(s.underworld);
            if (uw) {
                for (const g of Array.isArray(uw.gangs) ? uw.gangs : []) if (g) fn(g, 'purse', 'underworld');
                const w = _obj(uw.watch);
                if (w) for (const who of ['captain', 'magistrate']) if (w[who]) fn(w[who], 'purse', 'underworld');
            }
            const gs = _obj(s.guilds);
            if (gs) for (const g of Object.values(gs)) if (g) { fn(g, 'treasury', 'guilds'); if (g.lobbying) fn(g.lobbying, 'purse', 'guilds'); }
        }
        const hosp = _obj(world.hospitality);
        if (hosp && _obj(hosp.houses)) for (const h of Object.values(hosp.houses)) if (h) fn(h, 'cash', 'inns');
        const post = _obj(world.post);
        if (post && Array.isArray(post.couriers)) for (const c of post.couriers) if (c) fn(c, 'cash', 'couriers');
        const est = _obj(world.estates);
        if (est && _obj(est.holders)) for (const h of Object.values(est.holders)) if (h && h.kind !== 'player') fn(h, 'purse', 'coffers');
        for (const u of Array.isArray(world.units) ? world.units : []) {
            if (!u || u.destroyed) continue;
            if (typeof u.purse === 'number') fn(u, 'purse', 'roads');
            if (u.inventory && typeof u.inventory.gold === 'number') fn(u.inventory, 'gold', 'roads');
        }
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false) continue;
            fn(k, 'treasury', 'treasury');
            if (k.royalBank) fn(k.royalBank, 'treasury', 'banks');
        }
        if (!player) return;
        const rivals = player.house && _obj(player.house.rivals);
        if (rivals) for (const h of Object.values(rivals)) if (h && !h.extinct) fn(h, 'gold', 'coffers');
        const npcs = Array.isArray(Relationships._npcs) && Relationships._npcs.length ? Relationships._npcs
            : Array.isArray(player._relationshipNpcs) ? player._relationshipNpcs : [];
        for (const n of npcs) if (n && typeof n.purse === 'number') fn(n, 'purse', 'court');
        const mer = _obj(player.merchant);
        if (mer && Array.isArray(mer.rivals)) for (const r of mer.rivals) if (r) fn(r, 'capital', 'banks');
        const ol = _obj(player.outlawLairs);
        if (ol && Array.isArray(ol.lairs)) for (const l of ol.lairs) if (l && l.hoard) fn(l.hoard, 'gold', 'outlaws');
        const rv = _obj(player.rivals);
        if (rv && Array.isArray(rv.list)) for (const r of rv.list) if (r) fn(r, 'gold', 'rivals');
        const fin = _obj(player.finance);
        if (fin && Array.isArray(fin.banks)) for (const b of fin.banks) if (b) fn(b, 'capital', 'banks');
        const uwr = _obj(player.underwriting);
        if (uwr && Array.isArray(uwr.guilds)) for (const g of uwr.guilds) if (g) fn(g, 'capital', 'banks');
    },

    /** All the coin in the world, in or out of any realm (the player's real coin included) → { total, byKind } */
    total(world, player = null) {
        const byKind = {};
        let total = 0;
        CoinCensus.each(world, player, (h, key, kind) => {
            const n = _pos(h[key]);
            if (n > 0) { byKind[kind] = Math.round(((byKind[kind] || 0) + n) * 100) / 100; total += n; }
        });
        const own = player ? _pos(Barter.coinOf(player)) : 0;
        if (own > 0) { byKind.player = own; total += own; }
        return { total: Math.round(total * 100) / 100, byKind };
    },

    /**
     * Before the first coin (world/barter.js: no town has coin yet) there is no
     * coin to hold: whatever a purse holds then was made from nothing — a
     * keeper's float, a rival's seed money, a band's loot rolled at its making —
     * and is taken out of the world. Called daily while barter is the only way
     * (systems/mints.js). → the coin removed, by kind
     */
    purge(world, player = null) {
        const out = {};
        CoinCensus.each(world, player, (h, key, kind) => {
            const n = _num(h[key]);
            if (n > 0) { out[kind] = Math.round(((out[kind] || 0) + n) * 100) / 100; h[key] = 0; }
        });
        return out;
    },
};
