// ============================================
// THE ECONOMIC CHRONICLE — the gazette, the fashions, the player's worth
// ============================================
// The daily tick of the world's economic record, and what the player knows
// of it:
//   • the realms' weekly indices (world/economyIndex.js) and the fashions at
//     court (world/fashions.js) — ticked here, once a week;
//   • the GAZETTE: realm-level numbers are public, posted weekly in every
//     settlement with a market. Standing in one, the player reads it — their
//     own realm's latest numbers and the other realms' a week older (news
//     travels), the world's, and the fashions within a few days' ride. The
//     Economy panel (ui/actionMenu/economy.js) shows only what was read;
//     town-level prices stay what the price book knows (systems/priceKnowledge.js);
//   • the player's NET WORTH (gold, deposits, bonds, goods at known prices,
//     the book value of properties, works, ships and the company, less what
//     they owe), sampled weekly for the Merchant's Ledger.
//
// State: player.econ (saved with the player; older saves backfill a blank
// record). Draws no RNG. Tuned in data/chronicle.json (gazette, netWorth).

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { EconomyIndex } from '../world/economyIndex.js';
import { Fashions } from '../world/fashions.js';
import { PriceKnowledge } from './priceKnowledge.js';
import { Ships } from './ships.js';
import { MerchantHouses } from './merchantHouses.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _day = (world) => _num(world && world.day);

function _goods() {
    const gd = DataLoader._gamedata;
    return (gd && gd.playerEconomy && gd.playerEconomy.GOODS) || {};
}

export const EconomyChronicle = {
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.chronicle) || {};
        return {
            gazette: { foreignLagWeeks: 1, fashionRadius: 30, ...(d.gazette || {}) },
            netWorth: { goodsShare: 0.5, shipShare: 0.6, propertyDepreciation: 0.1, propertyFloor: 0.5, worthWeeks: 52, ...(d.netWorth || {}) },
        };
    },

    // ── State ─────────────────────────────────────────────

    _blank() {
        return { read: null, at: null, realms: {}, worldAsOf: null, fashions: {}, worth: [], lastWorth: null, setDay: null };
    },

    state(player) {
        if (!player) return EconomyChronicle._blank();
        let st = player.econ;
        if (!_obj(st)) st = player.econ = EconomyChronicle._blank();
        const b = EconomyChronicle._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        if (!_obj(st.realms)) st.realms = {};
        if (!_obj(st.fashions)) st.fashions = {};
        if (!Array.isArray(st.worth)) st.worth = [];
        return st;
    },

    serialize(player) {
        return player && _obj(player.econ) ? JSON.parse(JSON.stringify(player.econ)) : null;
    },

    loadState(player) {
        if (player) EconomyChronicle.state(player);
    },

    // ── The day ───────────────────────────────────────────

    /**
     * The day's economic record: the realms measured and the fashions turned
     * (weekly), the gazette read where the player stands, the player's worth
     * sampled weekly. → { measured, news, fashions: { started, ended }, read }
     */
    processDay(world, player) {
        const out = { measured: false, news: [], fashions: { started: [], ended: [] }, read: false };
        if (!world) return out;
        const news = EconomyIndex.processDay(world);
        if (news) { out.measured = true; out.news = news; }
        const F = Fashions.config();
        const fs = Fashions.state(world);
        if (fs.lastWeek == null || _day(world) - fs.lastWeek >= F.every || _day(world) < fs.lastWeek) out.fashions = Fashions.processWeek(world);
        if (!player) return out;
        out.read = EconomyChronicle.readGazette(player, world);
        const st = EconomyChronicle.state(player);
        // The fashion holding the player's own town is plain to see
        if (Number.isFinite(player.q)) {
            for (const x of Fashions.at(world, player.q, player.r)) st.fashions[x.fashion.uid] = _day(world);
        }
        const C = EconomyChronicle.config().netWorth;
        if (st.lastWorth == null || _day(world) - st.lastWorth >= 7 || _day(world) < st.lastWorth) {
            st.lastWorth = _day(world);
            st.worth.push([_day(world), EconomyChronicle.netWorth(player, world).total]);
            const cap = Math.max(2, Math.floor(_num(C.worthWeeks, 52)));
            if (st.worth.length > cap) st.worth.splice(0, st.worth.length - cap);
        }
        // Forget fashions long over
        const live = new Set(fs.active.map(f => String(f.uid)));
        for (const p of fs.past) live.add(String(p.uid));
        for (const k of Object.keys(st.fashions)) if (!live.has(k)) delete st.fashions[k];
        return out;
    },

    // ── The gazette ───────────────────────────────────────

    /** Read the gazette posted where the player stands (a settlement with a market). */
    readGazette(player, world) {
        if (!player || !world || typeof world.getTile !== 'function' || !Number.isFinite(player.q) || player.boardedShip) return false;
        const t = world.getTile(player.q, player.r);
        const s = t && t.settlement;
        if (!s || !s.market) return false;
        const st = EconomyChronicle.state(player);
        const C = EconomyChronicle.config().gazette;
        const I = EconomyIndex.config();
        const latest = EconomyIndex.latest(world, null);
        if (!latest) return false;
        const lag = Math.max(0, _num(C.foreignLagWeeks, 1)) * I.every;
        // (this week's gazette, read here already: nothing new to learn but the date)
        const same = st.worldAsOf === latest.day && st.at === (s.name || 'a market town') && st.read != null;
        st.read = _day(world);
        if (same) return true;
        st.at = s.name || 'a market town';
        st.worldAsOf = latest.day;
        for (const k of world.kingdoms || []) {
            if (!k) continue;
            const mine = s.kingdom != null && k.id === s.kingdom;
            const row = EconomyIndex.latest(world, k.id, mine ? Infinity : latest.day - lag);
            if (row) st.realms[k.id] = Math.max(_num(st.realms[k.id], -Infinity), row.day);
        }
        // The fashions talked of at court within a few days' ride
        for (const f of Fashions.active(world)) {
            if (Hex.wrappingDistance(f.q, f.r, s.q, s.r, world.width || 0) <= _num(C.fashionRadius, 30) + Fashions.reach(f, _day(world))) {
                st.fashions[f.uid] = _day(world);
            }
        }
        return true;
    },

    /**
     * What the player's gazettes say: { read, at, world: { now, then, asOf },
     * realms: [{ id, name, alive, asOf, now, then, history }] } — each realm
     * as of the last gazette that reported it (none: never read).
     */
    gazette(player, world) {
        const st = EconomyChronicle.state(player);
        const I = EconomyIndex.config();
        const out = { read: st.read, at: st.at, world: null, realms: [] };
        if (st.worldAsOf != null) {
            out.world = { asOf: st.worldAsOf, now: EconomyIndex.latest(world, null, st.worldAsOf), then: EconomyIndex.ago(world, null, I.changeWeeks, st.worldAsOf), history: EconomyIndex.history(world, null, st.worldAsOf) };
        }
        for (const k of (world && world.kingdoms) || []) {
            const asOf = st.realms[k.id];
            if (asOf == null) continue;
            const now = EconomyIndex.latest(world, k.id, asOf);
            if (!now) continue;
            out.realms.push({
                id: k.id, name: k.name, alive: k.isAlive !== false, asOf, now,
                then: EconomyIndex.ago(world, k.id, I.changeWeeks, asOf), history: EconomyIndex.history(world, k.id, asOf),
            });
        }
        out.realms.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return out;
    },

    /** The fashions the player has heard of, running and lately over: [{ fashion, def, known, running, stage, daysLeft, goods }]. */
    knownFashions(player, world) {
        const st = EconomyChronicle.state(player);
        const fs = Fashions.state(world);
        const day = _day(world);
        const out = [];
        for (const f of fs.active) {
            if (st.fashions[f.uid] == null) continue;
            out.push({ fashion: f, def: Fashions.def(f.id), known: st.fashions[f.uid], running: true, stage: Fashions.stage(f, day), daysLeft: Fashions.daysLeft(f, day), goods: Fashions.goods(f) });
        }
        for (const p of fs.past) {
            if (st.fashions[p.uid] == null) continue;
            out.push({ fashion: p, def: Fashions.def(p.id), known: st.fashions[p.uid], running: false, stage: 'over', daysLeft: 0, goods: Fashions.goods(p) });
        }
        return out.sort((a, b) => (b.running - a.running) || (b.fashion.start - a.fashion.start));
    },

    /**
     * The sharpest shortages and gluts the player's price book knows:
     * { short: [...], glut: [...] } of { town, q, r, good, name, icon, scarcity, ask, bid, age, src }.
     */
    marketSignals(player, world, { limit = 8, shortAt = 1.6, glutAt = 0.65 } = {}) {
        const short = [], glut = [];
        const G = _goods();
        for (const id of PriceKnowledge.knownGoods(player)) {
            const g = G[String(id).toUpperCase()] || {};
            for (const k of PriceKnowledge.known(player, world, id)) {
                const x = { town: k.name, q: k.q, r: k.r, good: id, name: g.name || id, icon: g.icon || '📦', scarcity: k.scarcity, ask: k.ask, bid: k.bid, age: k.age, src: k.src };
                if (k.scarcity >= shortAt) short.push(x);
                else if (k.scarcity <= glutAt) glut.push(x);
            }
        }
        const fresh = (a, b) => a.age - b.age || (a.town < b.town ? -1 : 1);
        short.sort((a, b) => b.scarcity - a.scarcity || fresh(a, b));
        glut.sort((a, b) => a.scarcity - b.scarcity || fresh(a, b));
        return { short: short.slice(0, limit), glut: glut.slice(0, limit) };
    },

    // ── Net worth ─────────────────────────────────────────

    /** What a unit of a good is worth to the player: the best the book knows the stalls pay, or base × goodsShare. */
    unitValue(player, goodId) {
        const bid = PriceKnowledge.bestBid(player, goodId);
        if (bid != null) return bid;
        const g = _goods()[String(goodId).toUpperCase()];
        return g && g.basePrice > 0 ? g.basePrice * _num(EconomyChronicle.config().netWorth.goodsShare, 0.5) : 0;
    },

    /**
     * The player's net worth: { total, assets: { gold, deposits, bonds,
     * goods, properties, works, ships, company }, debts: { loans, guildLoans,
     * arrears } }.
     */
    netWorth(player, world) {
        const C = EconomyChronicle.config().netWorth;
        const a = { gold: 0, deposits: 0, bonds: 0, goods: 0, properties: 0, works: 0, ships: 0, company: 0 };
        const d = { loans: 0, guildLoans: 0, arrears: 0 };
        if (!player) return { total: 0, assets: a, debts: d };
        a.gold = Math.max(0, _num(player.gold));
        const fin = _obj(player.finance);
        if (fin) {
            for (const acct of Object.values(_obj(fin.accounts) || {})) a.deposits += Math.max(0, _num(acct && acct.balance));
            for (const b of _arr(fin.bonds)) a.bonds += Math.max(0, _num(b && b.principal) * (1 - _num(b && b.haircut)));
            for (const l of _arr(fin.loans)) d.loans += Math.max(0, _num(l && l.totalOwed));
        }
        // Goods: the packs, the holds and the store-rooms, at what the book says they fetch
        const goods = {};
        const add = (id, n) => { if (_num(n) > 0) goods[id] = _num(goods[id]) + _num(n); };
        const G = _goods();
        for (const [id, n] of Object.entries(_obj(player.inventory) || {})) if (G[String(id).toUpperCase()]) add(id, n);
        for (const ship of _arr(player.ships)) for (const [id, n] of Object.entries(_obj(ship && ship.cargo) || {})) add(id, n);
        const mp = _obj(player.merchantPrince);
        for (const w of _arr(mp && mp.warehouses)) {
            for (const [id, n] of Object.entries(_obj(w && w.goods) || {})) add(id, n);
            d.arrears += Math.max(0, _num(w && w.arrears));
        }
        for (const [id, n] of Object.entries(goods)) a.goods += n * EconomyChronicle.unitValue(player, id);
        // Properties: their cost, losing a share a year down to a floor
        const types = Object.values((DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.PROPERTY_TYPES) || {});
        const yearDays = 120;
        for (const ref of _arr(player.properties)) {
            const t = world && typeof world.getTile === 'function' ? world.getTile(ref.q, ref.r) : null;
            const prop = t && _arr(t.playerProperties).find(p => p && p.type === ref.type);
            const def = types.find(x => x && x.id === ref.type);
            const cost = _num(prop && prop.cost, _num(def && def.cost));
            const age = _num(prop && prop.daysOwned) / yearDays;
            a.properties += cost * Math.max(_num(C.propertyFloor, 0.5), 1 - age * _num(C.propertyDepreciation, 0.1));
        }
        // Works: what was put in, as they stand
        for (const inv of _arr(mp && mp.investments)) {
            const t = world && typeof world.getTile === 'function' ? world.getTile(inv.q, inv.r) : null;
            const w = t && t.settlement ? SettlementMarket.works(t.settlement, inv.recipe) : null;
            a.works += Math.max(0, _num(inv.invested)) * (w ? Math.max(0, Math.min(1, _num(w.cond, 1))) : 0);
        }
        for (const ship of _arr(player.ships)) a.ships += _num(Ships.getShipValue(ship)) * _num(C.shipShare, 0.6);
        a.company = MerchantHouses.company(player) ? _num(MerchantHouses.companyValue(player)) : 0;
        const gl = _obj(player.guilds);
        for (const l of _arr(gl && gl.loans)) d.guildLoans += Math.max(0, _num(l && l.owed));
        for (const k of Object.keys(a)) a[k] = Math.round(a[k]);
        for (const k of Object.keys(d)) d[k] = Math.round(d[k]);
        const total = Object.values(a).reduce((s, v) => s + v, 0) - Object.values(d).reduce((s, v) => s + v, 0);
        return { total, assets: a, debts: d };
    },

    /** Weekly samples of the player's net worth: [{ day, worth }] (oldest first). */
    worthHistory(player) {
        return EconomyChronicle.state(player).worth.map(([day, worth]) => ({ day, worth }));
    },
};
