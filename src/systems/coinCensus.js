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
//     • guilds        guild treasuries, their lobbying purses and the escrow
//                     held for the player's open guild contracts
//     • inns          the innkeepers' cash (world.hospitality)
//     • couriers      the courier companies' cash (world.post)
//     • roads         coin carried by units on the map — merchant caravans' and
//                     trade ships' purses, raiders', riders', armies' bags —
//                     counted in the realm whose land they stand on (none in
//                     the wilds or at sea); pedlars' purses (systems/townTrade.js)
//                     in the realm of the town they are bound for or in; coin
//                     riding with the player's letters and their replies
//                     (systems/mail.js) where written, unless a rider carries it
//     • court         court and relationship NPCs' purses, in their realm, and
//                     the House's children's portions (child.purse) where it stands
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
//                     capital (trading companies working across every realm)
//                     and the player's own company's, in its charter realm,
//                     in their seat's realm
//     • player        the player's purse, in the realm the player stands in
//                     (in the wilds or at sea: the realm of the nearest town
//                     that keeps coin — the purse is never out of the count):
//                     a single purse that can hold more than a town and that
//                     travels, so it is a hoard; the coin moves prices once it
//                     is spent into a town, a person's or a guild's purse
//
//   and, in the world's total (each/total) though in no realm's count:
//     • sea           coin lost at sea, until the sea gives it up (world.money.sea)
//     • outlaws       named pirate captains' takings (player.seaRoving: at sea)
//     • court         an avenger's own purse (systems/nemesis.js, blood or kin)
//     • coffers       the stranger's purse (systems/soulPact.js: what souls paid)
//   and in the site's realm: a player's public work's budget held by its
//   paymaster (world.transport.works[].budget, systems/publicWorks.js: coffers)
//
// Pure read: no randomness, no writes. world-scoped holders come from
// `world`, player-scoped ones (rival Houses, banks, NPCs, merchant houses,
// lairs, rivals) from `player` (null: those are left out).

import { Relationships } from './relationships.js';
import { Barter } from '../world/barter.js';
import { Economy } from '../world/economy.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Utils } from '../core/utils.js';

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
                // (a dead one's purse too, until the estate is settled: their heir's or the town's coin, not lost)
                if (folk) for (const p of folk) if (p && !p.away && typeof p.purse === 'number') add(kid, 'folk', p.purse);
                if (s.folk && _obj(s.folk.school)) add(kid, 'towns', s.folk.school.fund);
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

        // Public works' budgets, with their paymaster at the site (systems/publicWorks.js)
        const tr = _obj(world.transport);
        if (tr && Array.isArray(tr.works)) for (const w of tr.works) if (w && _pos(w.budget) > 0) add(_realmAt(world, w.tq, w.tr), 'coffers', w.budget);

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
            // The House's cadet branches (systems/cadetBranches.js), at their seat
            for (const b of player.house && Array.isArray(player.house.cadets) ? player.house.cadets : []) if (b && !b.ended) add(b.kingdomId != null ? b.kingdomId : b.seat ? _realmAt(world, b.seat.q, b.seat.r) : null, 'coffers', b.gold);
            // Court and relationship NPCs (once a courtier leaves, the purse is the townsperson's)
            const npcs = Array.isArray(Relationships._npcs) && Relationships._npcs.length ? Relationships._npcs
                : Array.isArray(player._relationshipNpcs) ? player._relationshipNpcs : [];
            for (const n of npcs) {
                if (!n || n.isAlive === false || n.dead) continue;
                const kid = n.kingdomId != null ? n.kingdomId : _realmAt(world, n.settlementQ, n.settlementR);
                add(kid, 'court', n.purse);
            }
            // The House's children's portions (systems/inheritance.js), where the House stands
            for (const c of Array.isArray(player.children) ? player.children : []) if (c && c.purse > 0) add(_realmAt(world, player.q, player.r), 'court', c.purse);
            // Rival merchant houses' capital, at their seat (with the banks: a hoard)
            const mer = _obj(player.merchant);
            if (mer && Array.isArray(mer.rivals)) for (const r of mer.rivals) if (r && r.seat && !r.bankrupt) add(_realmAt(world, r.seat.q, r.seat.r), 'banks', r.capital);
            // ...and the player's own company's (systems/merchantHouses.js), in its charter realm
            if (mer && _obj(mer.company)) add(mer.company.charterKingdom, 'banks', mer.company.capital);
            // Outlaw lairs
            const ol = _obj(player.outlawLairs);
            if (ol && Array.isArray(ol.lairs)) for (const l of ol.lairs) if (l && l.hoard && !l.destroyed && !l.cleared) add(l.kingdomId, 'outlaws', l.hoard.gold);
            // Adventurer rivals
            const rv = _obj(player.rivals);
            if (rv && Array.isArray(rv.list)) for (const r of rv.list) if (r && !r.dead) add(_realmAt(world, r.q, r.r), 'rivals', r.gold);
            // ...and a delve partner's cut not yet in their purse (systems/delves.js → rivals.js _tickPartner), where the player stands
            if (rv && _obj(rv.partner)) add(_realmAt(world, player.q, player.r), 'rivals', rv.partner.owed);
            // Banks' vaults and the underwriters
            const fin = _obj(player.finance);
            if (fin && Array.isArray(fin.banks)) for (const b of fin.banks) if (b && b.status === 'open') add(b.kingdomId, 'banks', b.capital);
            const uw = _obj(player.underwriting);
            if (uw && Array.isArray(uw.guilds)) for (const g of uw.guilds) if (g) add(g.kingdomId, 'banks', g.capital);
            // The guildhalls' escrow set aside for the player's open guild contracts (systems/guilds.js), in its town
            const gc = _obj(player.guilds);
            if (gc && Array.isArray(gc.contracts)) for (const c of gc.contracts) if (c && c.escrow > 0) add(_realmAt(world, c.q, c.r), 'guilds', c.escrow);
            // Coin riding with letters (systems/mail.js): a letter's enclosure and a reply's purse,
            // where they were written — unless a rider on the map carries it (counted there, with the
            // units); the coin a reply's writer enclosed (its hooks) until it is handed over
            const mail = _obj(player.mail);
            if (mail) {
                const ridden = (id) => id != null && Array.isArray(world.units) && world.units.some(u => u && u.id === id && !u.destroyed && u.inventory && _pos(u.inventory.gold) > 0);
                const at = (p) => (p && Number.isFinite(p.q) ? _realmAt(world, p.q, p.r) : null) ?? _realmAt(world, player.q, player.r);
                for (const L of Array.isArray(mail.outbox) ? mail.outbox : []) if (L && _pos(L.gold) > 0 && !ridden(L.rider)) add(at(L.from), 'roads', L.gold);
                for (const R of Array.isArray(mail.replies) ? mail.replies : []) {
                    if (!R) continue;
                    if (_pos(R.gold) > 0 && !ridden(R.rider)) add(at(R.from), 'roads', R.gold);
                    for (const h of Array.isArray(R.hooks) ? R.hooks : []) if (h && h.arrive && _pos(h.arrive.gold) > 0) add(at(R.from), 'roads', h.arrive.gold);
                }
            }
            // The player's own purse: where they stand
            // (real coin only: in a barter place `player.gold` reads the goods carried — world/barter.js)
            // (in the wilds or at sea, with the nearest town that keeps coin: walking out of a realm loses no coin)
            let here = _realmAt(world, player.q, player.r);
            if (here == null || !alive.has(here)) {
                const near = Economy.nearestPurse(world, player.q, player.r);
                if (near && near.kingdom != null) here = near.kingdom;
            }
            add(here, 'player', Barter.coinOf(player));
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
    each(world, player, fn, opts = {}) {
        if (!world) return;
        // opts.once: a unit's coin once — a trade caravan's inventory.gold is a mirror of
        // its purse (systems/merchantCaravans.js _syncInventory), as count() reads it;
        // purge (the default) clears both
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views) {
            const tile = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = (tile && tile.settlement) || v;
            if (!s) continue;
            if (s.economy) fn(s.economy, 'gold', 'towns');
            // (opts.people: the caller walks a roster's purses itself, in the same order — tidyCents, daily)
            if (s.folk && Array.isArray(s.folk.people)) {
                if (opts.people) opts.people(s.folk.people);
                else for (const p of s.folk.people) if (p && typeof p.purse === 'number') fn(p, 'purse', 'folk');
            }
            // (the town school's fund — systems/literacy.js, townSchool.js: coin the town holds for it)
            if (s.folk && _obj(s.folk.school) && typeof s.folk.school.fund === 'number') fn(s.folk.school, 'fund', 'towns');
            const uw = _obj(s.underworld);
            if (uw) {
                for (const g of Array.isArray(uw.gangs) ? uw.gangs : []) if (g) fn(g, 'purse', 'underworld');
                const w = _obj(uw.watch);
                if (w) for (const who of ['captain', 'magistrate']) if (w[who]) fn(w[who], 'purse', 'underworld');
            }
            const gs = _obj(s.guilds);
            if (gs) for (const g of Object.values(gs)) if (g) { fn(g, 'treasury', 'guilds'); if (g.lobbying) fn(g.lobbying, 'purse', 'guilds'); }
            // (pedlars on the road to this town or in it — systems/townTrade.js — as count() has them)
            const tt = _obj(s.townTrade);
            if (tt && Array.isArray(tt.pedlars)) for (const ped of tt.pedlars) if (ped && typeof ped.purse === 'number') fn(ped, 'purse', 'roads');
        }
        const hosp = _obj(world.hospitality);
        if (hosp && _obj(hosp.houses)) for (const h of Object.values(hosp.houses)) if (h) fn(h, 'cash', 'inns');
        const post = _obj(world.post);
        if (post && Array.isArray(post.couriers)) for (const c of post.couriers) if (c) fn(c, 'cash', 'couriers');
        const est = _obj(world.estates);
        if (est && _obj(est.holders)) for (const h of Object.values(est.holders)) if (h && h.kind !== 'player') fn(h, 'purse', 'coffers');
        const tr = _obj(world.transport);
        if (tr && Array.isArray(tr.works)) for (const w of tr.works) if (w && typeof w.budget === 'number') fn(w, 'budget', 'coffers');
        // (a unit just destroyed still carries its coin until the day's turn takes it off the
        // map and pays it into the nearest town — World.settleUnitCoin — so it is counted)
        for (const u of Array.isArray(world.units) ? world.units : []) {
            if (!u) continue;
            if (typeof u.purse === 'number') fn(u, 'purse', 'roads');
            if (u.inventory && typeof u.inventory.gold === 'number' && !(opts.once && typeof u.purse === 'number')) fn(u.inventory, 'gold', 'roads');
        }
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false) continue;
            fn(k, 'treasury', 'treasury');
            if (k.royalBank) fn(k.royalBank, 'treasury', 'banks');
        }
        // (coin lost at sea, in the sea's keeping until it is found: MoneySupply.seaLost / seaFound)
        const ms = _obj(world.money);
        if (ms && typeof ms.sea === 'number') fn(ms, 'sea', 'sea');
        if (!player) return;
        const rivals = player.house && _obj(player.house.rivals);
        if (rivals) for (const h of Object.values(rivals)) if (h && !h.extinct) fn(h, 'gold', 'coffers');
        for (const b of player.house && Array.isArray(player.house.cadets) ? player.house.cadets : []) if (b && !b.ended) fn(b, 'gold', 'coffers');
        const npcs = Array.isArray(Relationships._npcs) && Relationships._npcs.length ? Relationships._npcs
            : Array.isArray(player._relationshipNpcs) ? player._relationshipNpcs : [];
        for (const n of npcs) if (n && typeof n.purse === 'number') fn(n, 'purse', 'court');
        for (const c of Array.isArray(player.children) ? player.children : []) if (c && typeof c.purse === 'number') fn(c, 'purse', 'court');
        const mer = _obj(player.merchant);
        if (mer && Array.isArray(mer.rivals)) for (const r of mer.rivals) if (r) fn(r, 'capital', 'banks');
        if (mer && _obj(mer.company)) fn(mer.company, 'capital', 'banks');
        // Coin riding with the player's letters and their replies (systems/mail.js), unless a rider on the map carries it
        const mail = _obj(player.mail);
        if (mail) {
            const ridden = (id) => id != null && Array.isArray(world.units) && world.units.some(u => u && u.id === id && !u.destroyed && u.inventory && _pos(u.inventory.gold) > 0);
            for (const L of Array.isArray(mail.outbox) ? mail.outbox : []) if (L && typeof L.gold === 'number' && !ridden(L.rider)) fn(L, 'gold', 'roads');
            for (const R of Array.isArray(mail.replies) ? mail.replies : []) {
                if (!R) continue;
                if (typeof R.gold === 'number' && !ridden(R.rider)) fn(R, 'gold', 'roads');
                for (const h of Array.isArray(R.hooks) ? R.hooks : []) if (h && h.arrive && typeof h.arrive.gold === 'number') fn(h.arrive, 'gold', 'roads');
            }
        }
        const ol = _obj(player.outlawLairs);
        if (ol && Array.isArray(ol.lairs)) for (const l of ol.lairs) if (l && l.hoard) fn(l.hoard, 'gold', 'outlaws');
        const rv = _obj(player.rivals);
        if (rv && Array.isArray(rv.list)) for (const r of rv.list) if (r) fn(r, 'gold', 'rivals');
        if (rv && _obj(rv.partner) && typeof rv.partner.owed === 'number') fn(rv.partner, 'owed', 'rivals');
        const fin = _obj(player.finance);
        if (fin && Array.isArray(fin.banks)) for (const b of fin.banks) if (b) fn(b, 'capital', 'banks');
        const uwr = _obj(player.underwriting);
        if (uwr && Array.isArray(uwr.guilds)) for (const g of uwr.guilds) if (g) fn(g, 'capital', 'banks');
        const gc = _obj(player.guilds);
        if (gc && Array.isArray(gc.contracts)) for (const c of gc.contracts) if (c) fn(c, 'escrow', 'guilds');
        // Coin in no realm: pirate captains' takings at sea, an avenger's own purse, the stranger's
        const sr = _obj(player.seaRoving);
        if (sr && Array.isArray(sr.captains)) for (const c of sr.captains) if (c && typeof c.loot === 'number') fn(c, 'loot', 'outlaws');
        const nem = _obj(player.nemesis);
        if (nem && Array.isArray(nem.list)) for (const nm of nem.list) if (nm && typeof nm.purse === 'number' && nm.kind !== 'house' && nm.kind !== 'lord' && nm.kind !== 'rival') fn(nm, 'purse', 'court');
        const sp = _obj(player.soulPact);
        if (sp && typeof sp.purse === 'number') fn(sp, 'purse', 'coffers');
    },

    /** All the coin in the world, in or out of any realm (the player's real coin included) → { total, byKind } */
    total(world, player = null) {
        const byKind = {};
        let total = 0;
        CoinCensus.each(world, player, (h, key, kind) => {
            const n = _pos(h[key]);
            if (n > 0) { byKind[kind] = Math.round(((byKind[kind] || 0) + n) * 100) / 100; total += n; }
        }, { once: true });
        const own = player ? _pos(Barter.coinOf(player)) : 0;
        if (own > 0) { byKind.player = own; total += own; }
        return { total: Math.round(total * 100) / 100, byKind };
    },

    /**
     * The smallest coin is 0.01g: every purse holds a whole number of cents.
     * The paths coin moves by (PlayerCoin, Economy.payTown/drawTown, the crowns'
     * books) move whole cents; this daily backstop rounds any purse a stray
     * sum left between two cents (and the player's real coin), and books the
     * residue with MoneySupply.leak ('cents') so the census stays closed —
     * the sub-cent part is carried to the next day (world.money.centsCarry)
     * until it makes a whole cent. → the residue rounded away today (+: coin added)
     */
    tidyCents(world, player = null) {
        if (!world) return 0;
        let residue = 0;
        const tidy = (h, key) => {
            const v = h[key];
            if (typeof v !== 'number' || !Number.isFinite(v) || Utils.isCents(v)) return 0;
            const c = Utils.cents(v);
            h[key] = c;
            return c - v;
        };
        // (a roster's purses walked here, not through fn: thousands a day, most already whole cents)
        const people = (ppl) => {
            for (let i = 0; i < ppl.length; i++) {
                const p = ppl[i];
                if (!p) continue;
                const v = p.purse;
                if (typeof v !== 'number') continue;
                const x = v * 100;
                if (x === Math.round(x)) continue;
                residue += tidy(p, 'purse');
            }
        };
        CoinCensus.each(world, player, (h, key) => { residue += tidy(h, key); }, { once: true, people });
        // (a trade caravan's inventory.gold mirrors its purse, counted once above)
        for (const u of Array.isArray(world.units) ? world.units : []) {
            if (u && typeof u.purse === 'number' && u.inventory && typeof u.inventory.gold === 'number') tidy(u.inventory, 'gold');
        }
        if (player && !Barter.installed(player)) residue += tidy(player, 'gold');
        if (!residue) return 0;
        const st = MoneySupply.state(world);
        const carry = _num(st.centsCarry) + residue;
        const book = Utils.cents(carry);
        if (book) MoneySupply.leak(world, book, 'cents');
        st.centsCarry = carry - book;
        return residue;
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
