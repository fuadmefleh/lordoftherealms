// ============================================
// MERCHANT HOUSES — the trading company, its factors, contracts and rivals
// ============================================
// Trade is personal until the player founds a company: buy a charter from a
// kingdom (or be granted one by a petition or royal office), put capital in,
// and the company keeps its own treasury, ledger and reputation.
//
//   - Posts and factors: a factor hired in a town runs a trading post and
//     trades there once a week by the player's standing orders (buy X below
//     P, sell Y above Q, keep N). Factors pay and are paid exactly what the
//     player would be (Trading.getAvailableGoods / buyDiscount for buying,
//     Trading.saleUnitPrice — capped by Trading.saleUnitCap against the asks
//     on the tile and next door, Ships.nearbyAsks — for selling), so a post
//     can't run a buy→sell loop. Profit comes from timing (the seasons) and
//     from moving goods between posts. Skill sets weekly volume; a dishonest
//     factor skims; the underworld can rob a post.
//   - Contracts: realms post supply contracts (food for a famished or
//     besieged town, timber for a fleet, iron for a war). The town never
//     sells the good itself or next door, so goods must be brought in by
//     convoy (caravan or ship), by hand, or from a ship's hold. Late means a
//     broken contract: reputation, and gossip.
//   - Rival houses: 3–5 NPC houses (data/merchantHouses.json) set up lazily
//     and deterministically (a hash of the world seed — no RNG), simulated
//     only once the player has a company. They bid for contracts, undercut
//     posts in their towns, lobby for monopolies (a petition at the player's
//     own holdings), slander the company, sell shares, can be bought out or
//     ruined.
//   - Monopolies: settlement.monopolies[good] = { holder, untilDay }.
//     Nobody else may trade that good there (Trading.monopolyBlock for the
//     player; factors and rivals here). Petitions grant and revoke them.
//   - Investments: shares in rival houses (dividends) and royal ventures
//     (a fleet expedition: a long wait, then a multiple or a loss).
//
// State lives on player.merchant (serialized by saveLoad). All randomness
// flows through Utils, and none is drawn until the player has a company.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { PlayerInventory } from '../player/inventory.js';
import { Ships } from './ships.js';
import { Underworld } from './underworld.js';
import { Gossip } from './gossip.js';
import { Petitions } from './petitions.js';
import { Taxation } from './marketDynamics.js';
import { RealmWars } from './realmWars.js';
import { HoldingSieges } from './holdingSieges.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { Quests } from './quests.js';
import { LossBook } from './lossBook.js';

const DEFAULT_CONFIG = {
    charter: { baseCost: 900, perSettlement: 60, maxCost: 2400, minReputation: 0 },
    found: { minCapital: 500, startReputation: 30 },
    post: { openCost: 350, foreignMult: 1.5, foreignMinReputation: -10, maxPosts: 6, capacity: 300, weeklyRent: 5, maxOrders: 4, reserveWeeks: 2 },
    factor: {
        baseWage: 10, wagePerSkill: 3, volumeBase: 30, volumePerSkill: 8, skill: [2, 9], honesty: [0.35, 1], candidates: 3,
        skimRate: 0.18, dishonestBelow: 0.7, suspicionPerSkim: 4, suspicionShown: 12,
        auditCost: 60, auditFindChance: 0.85, auditRecover: 0.5, unpaidQuitWeeks: 2,
    },
    robbery: { base: 0.03, guildTown: 0.02, perGuard: 0.006, minChance: 0.01, guildFriendRank: 2, guildFriendMult: 0.3, insiderMult: 1.5, stockLoss: [0.2, 0.5] },
    contracts: { maxBoard: 5, spawnPerWeek: [1, 2], minReputation: 10, reputationReward: 6, reputationPenalty: 10, kingdomReputation: 3, rivalBidAfter: [6, 14] },
    convoy: { hexesPerDay: 5, shipHexesPerDay: 9, feePerUnitPerDay: 0.08, minFee: 5, riskPerDay: 0.012, shipRiskPerDay: 0.006, lossShare: [0.4, 1] },
    rivals: {
        count: [3, 5], minActive: 3, weeklyReturn: [-0.035, 0.05], contestedDrag: 0.006,
        dividendShare: 0.5, sharePremium: 1.15, sellDiscount: 0.85, ruinCapital: 400,
        expandChance: 0.2, maxPosts: 6, lobbyChance: 0.07, slanderChance: 0.12, slanderRivalry: 50,
        undercutVolume: 0.75, newcomerChance: 0.25,
        priceWar: { minSpend: 200, damage: [0.9, 1.5], reputationCost: 3, rivalry: 25 },
        openRivalry: 10, contractRivalry: 5,
    },
    monopoly: { lobbyBase: 600, perPopulation: 0.4, minReputation: 40, minKingdomReputation: 10, days: 120, chance: 0.55, perReputation: 0.004, ownHoldingMult: 0.5, sellVolumeBonus: 0.25, rivalBribe: [80, 220] },
    ventures: { maxOpen: 3, spawnChance: 0.3, minStake: 100, maxStakeShare: 0.1, maxStake: 4000 },
    ledgerCap: 80, newsCap: 30, weeksCap: 12,
};

const FAMINE_EVENTS = ['famine', 'drought', 'blizzard', 'plague'];
const FLOWS = ['paidIn', 'drawn'];
// A timed event this hard on bread counts as hunger (a saga's hoarded granaries)
const HUNGER_FOOD_PRICES = 0.2;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day);
const _key = (q, r) => `${q},${r}`;
const _hash = (s) => Utils.hashStr(String(s)) >>> 0;
const _label = (id) => String(id || '').replace(/_/g, ' ');

function _deepMerge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
            ? _deepMerge(base[k], v) : v;
    }
    return out;
}

export const MerchantHouses = {

    // ── Data ────────────────────────────────────────────────────

    data() {
        return DataLoader.merchantHouses || (DataLoader.get && DataLoader.get('merchantHouses')) || {};
    },

    config() {
        return _deepMerge(DEFAULT_CONFIG, MerchantHouses.data().config || {});
    },

    _good(id) {
        const G = PlayerEconomy.GOODS || {};
        return G[String(id || '').toUpperCase()] || Object.values(G).find(g => g && g.id === id) || null;
    },

    goodName(id) {
        const g = MerchantHouses._good(id);
        return g ? `${g.icon || ''} ${g.name || _label(id)}`.trim() : _label(id);
    },

    // ── State ───────────────────────────────────────────────────

    /** The player's merchant record (created and backfilled on demand). */
    state(player) {
        if (!player) return null;
        let m = player.merchant;
        if (!m || typeof m !== 'object' || Array.isArray(m)) m = player.merchant = {};
        if (!Array.isArray(m.charters)) m.charters = [];
        if (m.company === undefined) m.company = null;
        if (!Array.isArray(m.rivals)) m.rivals = [];
        if (!Array.isArray(m.board)) m.board = [];
        if (!Array.isArray(m.ventures)) m.ventures = [];
        if (!Array.isArray(m.news)) m.news = [];
        if (!(m.nextId > 0)) m.nextId = 1;
        if (m.rivalsSeeded === undefined) m.rivalsSeeded = false;
        if (m.company) MerchantHouses._backfillCompany(m.company);
        for (const r of m.rivals) MerchantHouses._backfillRival(r);
        return m;
    },

    _backfillCompany(c) {
        c.capital = Math.max(0, _num(c.capital));
        c.reputation = _clamp(_num(c.reputation, 30), 0, 100);
        for (const k of ['posts', 'contracts', 'convoys', 'ledger', 'weeks']) if (!Array.isArray(c[k])) c[k] = [];
        if (!c.investments || typeof c.investments !== 'object') c.investments = {};
        if (!c.investments.shares || typeof c.investments.shares !== 'object') c.investments.shares = {};
        if (!Array.isArray(c.investments.ventures)) c.investments.ventures = [];
        if (!c.pnl || typeof c.pnl !== 'object') c.pnl = {};
        if (!c.pnl.income || typeof c.pnl.income !== 'object') c.pnl.income = {};
        if (!c.pnl.expenses || typeof c.pnl.expenses !== 'object') c.pnl.expenses = {};
        if (!c.week || typeof c.week !== 'object') c.week = { income: 0, expenses: 0 };
        if (!c.flows || typeof c.flows !== 'object') c.flows = {};
        if (!c.candidates || typeof c.candidates !== 'object') c.candidates = {};
        c.stats = { contractsDone: 0, contractsFailed: 0, robberies: 0, convoysLost: 0, ...(c.stats || {}) };
        for (const p of c.posts) {
            if (!p.stock || typeof p.stock !== 'object') p.stock = {};
            if (!Array.isArray(p.orders)) p.orders = [];
            p.skimmed = _num(p.skimmed);
            p.suspicion = _num(p.suspicion);
            if (p.factor === undefined) p.factor = null;
        }
        if (c.nextWeekDay == null) c.nextWeekDay = _num(c.foundedDay) + 7;
    },

    _backfillRival(r) {
        r.capital = _num(r.capital);
        r.reputation = _clamp(_num(r.reputation, 40), 0, 100);
        r.rivalry = _clamp(_num(r.rivalry), 0, 100);
        if (!Array.isArray(r.posts)) r.posts = [];
        if (!Array.isArray(r.specialty)) r.specialty = [];
        if (!r.shares || typeof r.shares !== 'object') r.shares = {};
        r.shares.player = _clamp(_num(r.shares.player), 0, 100);
        // Shares the player holds in their own name on the Bourse (systems/bourse.js)
        r.shares.purse = _clamp(_num(r.shares.purse), 0, 100);
        if (!r.status) r.status = 'active';
    },

    company(player) {
        return (player && player.merchant && player.merchant.company) || null;
    },

    hasCompany(player) {
        return !!MerchantHouses.company(player);
    },

    loadState(player) {
        if (!player) return null;
        if (player.merchant == null) { player.merchant = null; return null; }
        return MerchantHouses.state(player);
    },

    serialize(player) {
        if (!player || !player.merchant) return null;
        return JSON.parse(JSON.stringify(player.merchant));
    },

    _nextId(player, prefix) {
        const m = MerchantHouses.state(player);
        return `${prefix}${m.nextId++}`;
    },

    _news(player, world, text, icon = '⚖️') {
        const m = MerchantHouses.state(player);
        m.news.unshift({ day: _day(world), icon, text });
        const cap = MerchantHouses.config().newsCap;
        if (m.news.length > cap) m.news.length = cap;
    },

    // ── Books ───────────────────────────────────────────────────

    _book(c, world, kind, cat, amount, text) {
        const amt = Math.round(amount);
        if (!amt) return;
        c.ledger.unshift({ day: _day(world), kind, cat, amount: amt, text });
        const cap = MerchantHouses.config().ledgerCap;
        if (c.ledger.length > cap) c.ledger.length = cap;
        // Capital paid in or drawn out is the owner's, not profit or loss
        if (FLOWS.includes(cat)) { c.flows[cat] = (c.flows[cat] || 0) + amt; return; }
        const side = kind === 'income' ? c.pnl.income : c.pnl.expenses;
        side[cat] = (side[cat] || 0) + amt;
        c.week[kind] = (c.week[kind] || 0) + amt;
    },

    _credit(c, world, amount, cat, text) {
        const amt = Math.max(0, Math.floor(amount));
        c.capital += amt;
        MerchantHouses._book(c, world, 'income', cat, amt, text);
        return amt;
    },

    _debit(c, world, amount, cat, text) {
        const amt = Math.max(0, Math.ceil(amount));
        c.capital = Math.max(0, c.capital - amt);
        MerchantHouses._book(c, world, 'expenses', cat, amt, text);
        return amt;
    },

    /** Profit and loss, all time: { income, expenses, net, byCategory }. */
    profitAndLoss(player) {
        const c = MerchantHouses.company(player);
        if (!c) return null;
        const sum = (o) => Object.values(o || {}).reduce((a, b) => a + _num(b), 0);
        const income = sum(c.pnl.income);
        const expenses = sum(c.pnl.expenses);
        return { income, expenses, net: income - expenses, incomeBy: { ...c.pnl.income }, expensesBy: { ...c.pnl.expenses } };
    },

    /** Capital + stock at sale value + shares held. */
    companyValue(player) {
        const c = MerchantHouses.company(player);
        if (!c) return 0;
        let v = c.capital;
        for (const p of c.posts) {
            for (const [id, qty] of Object.entries(p.stock)) {
                const g = MerchantHouses._good(id);
                if (g) v += qty * g.basePrice * Trading.SELL_SHARE;
            }
        }
        for (const r of MerchantHouses.state(player).rivals) {
            if (r.status === 'active' && r.shares.player > 0) v += r.shares.player * MerchantHouses.sharePrice(r);
        }
        return Math.round(v);
    },

    // ── Prices (the player's own rules) ─────────────────────────

    /**
     * What a factor pays per unit for `goodId` on `tile` — the market's price
     * after the player's own discount there, as Trading.buyGoods charges it.
     * null when the market doesn't sell it (or a monopoly bars the company).
     */
    factorBuyUnit(player, world, tile, goodId) {
        const s = tile && tile.settlement;
        if (!s) return null;
        const holder = Economy.monopolyHolder(s, goodId, _day(world));
        if (holder && holder !== 'player') return null;
        const entry = Trading.getAvailableGoods(s, tile, world).find(g => g.id === goodId);
        if (!entry) return null;
        return Math.ceil(entry.price * Math.max(0.5, 1 - Trading.buyDiscount(player, s)));
    },

    /**
     * What a factor gets per unit selling `qty` of `goodId` on `tile` — what
     * the player would (Trading.saleUnitPrice: the season, trade bonuses, a
     * tariff, capped under the asks here and next door). 0 when it can't
     * be sold openly here.
     */
    factorSaleUnit(player, world, tile, goodId, qty = 1) {
        const s = tile && tile.settlement;
        const good = MerchantHouses._good(goodId);
        if (!s || !good || !(qty > 0)) return 0;
        const holder = Economy.monopolyHolder(s, goodId, _day(world));
        if (holder && holder !== 'player') return 0;
        const legality = Underworld.legalSaleCheck({ inventory: { [goodId]: qty } }, goodId, qty, s, world);
        if (!legality.ok) return 0;
        return Math.max(0, Trading.saleUnitPrice(player, good, s, world, legality.priceMult, qty));
    },

    // ── Charters & founding ─────────────────────────────────────

    charterCost(world, kingdom) {
        const cfg = MerchantHouses.config().charter;
        const n = kingdom && world && world.getSettlementsOf ? world.getSettlementsOf(kingdom.id).length
            : ((kingdom && kingdom.settlements) || []).length;
        const base = Math.min(cfg.maxCost, Math.round(cfg.baseCost + cfg.perSettlement * n));
        // A realm under the edict of merchant charters (systems/kingship.js) sells them cheap
        const edict = KingdomBonuses.crownEffect(kingdom, 'charterCost');
        return edict ? Math.max(1, Math.round(base * Math.max(0.1, 1 + edict))) : base;
    },

    hasCharter(player, kingdomId = null) {
        const m = player && player.merchant;
        const list = (m && Array.isArray(m.charters)) ? m.charters : [];
        return kingdomId == null ? list.length > 0 : list.some(ch => ch.kingdomId === kingdomId);
    },

    /** A royal office carries the right to charter a company in its realm. */
    officeCharter(player) {
        return !!(player && player.currentTitle && player.allegiance);
    },

    canBuyCharter(player, world, tile) {
        const s = tile && tile.settlement;
        if (!s || !s.kingdom) return { ok: false, reason: 'Charters are sold at a royal town.' };
        const k = world.getKingdom ? world.getKingdom(s.kingdom) : null;
        if (!k || !k.isAlive) return { ok: false, reason: 'No crown here to grant a charter.' };
        if (MerchantHouses.hasCharter(player, k.id)) return { ok: false, reason: `You already hold a charter from ${k.name}.` };
        if (RealmWars.atWarWith(player, k.id)) return { ok: false, reason: `${k.name} is at war with you.` };
        const rep = _num(player.reputation && player.reputation[k.id]);
        const cfg = MerchantHouses.config().charter;
        if (rep < cfg.minReputation) return { ok: false, reason: `${k.name} won't charter a merchant of your reputation (${rep}).` };
        const cost = MerchantHouses.charterCost(world, k);
        if (_num(player.gold) < cost) return { ok: false, reason: `A charter from ${k.name} costs ${cost} gold.`, cost, kingdom: k };
        return { ok: true, cost, kingdom: k };
    },

    buyCharter(player, world, tile) {
        const can = MerchantHouses.canBuyCharter(player, world, tile);
        if (!can.ok) return { success: false, reason: can.reason };
        const m = MerchantHouses.state(player);
        player.gold -= can.cost;
        can.kingdom.treasury = _num(can.kingdom.treasury) + can.cost;
        m.charters.push({ kingdomId: can.kingdom.id, source: 'purchase', day: _day(world) });
        return { success: true, cost: can.cost, kingdom: can.kingdom.name };
    },

    defaultName(player) {
        const names = MerchantHouses.data().names || {};
        const a = names.companyFirst && names.companyFirst.length ? names.companyFirst : ['Golden'];
        const b = names.companySecond && names.companySecond.length ? names.companySecond : ['Company'];
        const h = _hash(`${player.name || player.lastName || 'house'}`);
        return `The ${a[h % a.length]} ${b[(h >>> 8) % b.length]}`;
    },

    canFound(player, world, capital = null) {
        if (MerchantHouses.hasCompany(player)) return { ok: false, reason: 'You already run a company.' };
        if (!MerchantHouses.hasCharter(player) && !MerchantHouses.officeCharter(player)) {
            return { ok: false, reason: 'You need a charter: buy one from a crown, earn one at court, or hold a royal office.' };
        }
        const min = MerchantHouses.config().found.minCapital;
        const cap = capital == null ? min : capital;
        if (cap < min) return { ok: false, reason: `A company needs at least ${min} gold of capital.` };
        if (_num(player.gold) < cap) return { ok: false, reason: `You don't have ${cap} gold to put in.` };
        return { ok: true, capital: cap };
    },

    /** Found the company with `capital` gold from the player's purse. */
    found(player, world, { name = null, capital = null } = {}) {
        const can = MerchantHouses.canFound(player, world, capital);
        if (!can.ok) return { success: false, reason: can.reason };
        const m = MerchantHouses.state(player);
        if (!m.charters.length && MerchantHouses.officeCharter(player)) {
            m.charters.push({ kingdomId: player.allegiance, source: 'office', day: _day(world) });
        }
        const cfg = MerchantHouses.config();
        player.gold -= can.capital;
        m.company = {
            name: (name && String(name).trim().slice(0, 40)) || MerchantHouses.defaultName(player),
            foundedDay: _day(world),
            charterKingdom: m.charters[0].kingdomId,
            capital: 0,
            reputation: cfg.found.startReputation,
            nextWeekDay: _day(world) + 7,
        };
        MerchantHouses._backfillCompany(m.company);
        MerchantHouses._book(m.company, world, 'income', 'paidIn', can.capital, 'Founding capital');
        m.company.capital = can.capital;
        MerchantHouses.ensureRivals(player, world);
        MerchantHouses._news(player, world, `${m.company.name} is chartered and opens its ledger.`, '📜');
        return { success: true, company: m.company };
    },

    /** Move gold from the purse into the company. */
    deposit(player, world, amount) {
        const c = MerchantHouses.company(player);
        const amt = Math.floor(_num(amount));
        if (!c) return { success: false, reason: 'No company.' };
        if (amt <= 0 || amt > _num(player.gold)) return { success: false, reason: 'Not enough gold.' };
        player.gold -= amt;
        c.capital += amt;
        MerchantHouses._book(c, world, 'income', 'paidIn', amt, 'Capital paid in');
        return { success: true, amount: amt };
    },

    /** Draw gold from the company to the purse. */
    withdraw(player, world, amount) {
        const c = MerchantHouses.company(player);
        const amt = Math.floor(_num(amount));
        if (!c) return { success: false, reason: 'No company.' };
        // A floated company (systems/bourse.js): the outside shareholders take their part of anything drawn
        const outside = _clamp(_num(c.float && c.float.outside), 0, 99) / 100;
        const theirs = outside > 0 ? Math.ceil(amt * outside / (1 - outside)) : 0;
        if (amt <= 0 || amt + theirs > c.capital) return { success: false, reason: theirs ? `Drawing ${amt}g pays the shareholders ${theirs}g too: the company has not that much.` : 'The company has not that much.' };
        c.capital -= amt + theirs;
        player.gold = _num(player.gold) + amt;
        MerchantHouses._book(c, world, 'expenses', 'drawn', amt, 'Drawn by the owner');
        if (theirs) {
            c.flows.dividendsOut = _num(c.flows.dividendsOut) + theirs;
            c.ledger.unshift({ day: _day(world), kind: 'expenses', cat: 'dividendsOut', amount: theirs, text: "The shareholders' part of the owner's draw" });
        }
        return { success: true, amount: amt, toShareholders: theirs };
    },

    // ── Rival houses ────────────────────────────────────────────

    /**
     * Set up the rival houses once, deterministically from the world's seed
     * (a hash — no RNG): which houses, where they sit, their capital.
     */
    ensureRivals(player, world) {
        const m = MerchantHouses.state(player);
        if (m.rivalsSeeded || !world) return m.rivals;
        m.rivalsSeeded = true;
        const defs = (MerchantHouses.data().rivalHouses || []).slice();
        if (!defs.length) return m.rivals;
        const seed = String((world.generationParams && world.generationParams.seed) || 'world');
        const [lo, hi] = MerchantHouses.config().rivals.count;
        const n = Math.min(defs.length, lo + (_hash(`${seed}:houses`) % (hi - lo + 1)));
        defs.sort((a, b) => _hash(`${seed}:${a.id}`) - _hash(`${seed}:${b.id}`));
        const towns = MerchantHouses._towns(world);
        for (const def of defs.slice(0, n)) m.rivals.push(MerchantHouses._makeRival(def, world, towns, seed, _day(world)));
        return m.rivals;
    },

    /** Settlements a house would trade in: towns and larger (villages if that's all there is). */
    _towns(world) {
        const all = world.getSettlementViews ? world.getSettlementViews() : world.getAllSettlements();
        const big = all.filter(s => s.type && s.type !== 'village');
        return (big.length >= 3 ? big : all).map(s => ({ q: s.q, r: s.r, name: s.name, kingdom: s.kingdom }));
    },

    _makeRival(def, world, towns, seed, day) {
        const h = (k) => _hash(`${seed}:${def.id}:${k}`);
        const seat = towns.length ? towns[h('seat') % towns.length] : null;
        const [cLo, cHi] = def.capital || [2000, 5000];
        const posts = seat ? [{ q: seat.q, r: seat.r, name: seat.name }] : [];
        if (seat) {
            const near = towns.filter(t => t.q !== seat.q || t.r !== seat.r)
                .map(t => ({ ...t, d: Hex.wrappingDistance(seat.q, seat.r, t.q, t.r, world.width) }))
                .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
                .slice(0, 1 + (h('posts') % 2));
            for (const t of near) posts.push({ q: t.q, r: t.r, name: t.name });
        }
        const rival = {
            id: def.id, name: def.name, icon: def.icon || '⚖️', temperament: def.temperament || 'cautious',
            specialty: (def.specialty || []).slice(),
            capital: cLo + (h('capital') % Math.max(1, cHi - cLo + 1)),
            reputation: 35 + (h('rep') % 30),
            seat: seat ? { q: seat.q, r: seat.r, name: seat.name } : null,
            posts, status: 'active', rivalry: 0, shares: { player: 0 }, foundedDay: day, lastProfit: 0,
        };
        MerchantHouses._backfillRival(rival);
        return rival;
    },

    rivals(player) {
        return (player && player.merchant && player.merchant.rivals) || [];
    },

    activeRivals(player) {
        return MerchantHouses.rivals(player).filter(r => r.status === 'active');
    },

    getRival(player, id) {
        return MerchantHouses.rivals(player).find(r => r.id === id) || null;
    },

    temperament(rival) {
        const t = (MerchantHouses.data().temperaments || {})[rival && rival.temperament] || {};
        return { returnBias: 0, expand: 1, lobby: 1, slander: 1, bid: 1, ...t };
    },

    sharePrice(rival) {
        return Math.max(1, _num(rival && rival.capital) / 100);
    },

    rivalsAt(player, q, r) {
        return MerchantHouses.activeRivals(player).filter(rv => rv.posts.some(p => p.q === q && p.r === r));
    },

    // ── Posts & factors ─────────────────────────────────────────

    postAt(player, q, r) {
        const c = MerchantHouses.company(player);
        return c ? c.posts.find(p => p.q === q && p.r === r) || null : null;
    },

    getPost(player, postId) {
        const c = MerchantHouses.company(player);
        return c ? c.posts.find(p => p.id === postId) || null : null;
    },

    stockTotal(post) {
        return Object.values((post && post.stock) || {}).reduce((a, b) => a + _num(b), 0);
    },

    factorWage(factor) {
        const f = MerchantHouses.config().factor;
        return Math.round(f.baseWage + f.wagePerSkill * _num(factor && factor.skill));
    },

    factorVolume(factor) {
        const f = MerchantHouses.config().factor;
        return Math.round(f.volumeBase + f.volumePerSkill * _num(factor && factor.skill));
    },

    /** What people say about a candidate's honesty (a guess, not the truth). */
    reference(factor) {
        const v = _num(factor && factor.honestyGuess, 0.5);
        if (v >= 0.85) return { label: 'spotless references', color: '#7fd07f' };
        if (v >= 0.65) return { label: 'well spoken of', color: '#c8d07f' };
        if (v >= 0.45) return { label: 'mixed references', color: '#e0b060' };
        return { label: 'a doubtful past', color: '#e08080' };
    },

    postCost(player, world, tile) {
        const c = MerchantHouses.company(player);
        const cfg = MerchantHouses.config().post;
        const s = tile && tile.settlement;
        const foreign = !!(c && s && s.kingdom && s.kingdom !== c.charterKingdom && !MerchantHouses.hasCharter(player, s.kingdom));
        return { cost: Math.round(cfg.openCost * (foreign ? cfg.foreignMult : 1)), foreign };
    },

    /** Factors looking for work here this fortnight (drawn once, then kept). */
    candidates(player, world, tile) {
        const c = MerchantHouses.company(player);
        if (!c || !tile || !tile.settlement) return [];
        const key = _key(tile.q, tile.r);
        const day = _day(world);
        const cached = c.candidates[key];
        if (cached && day - cached.day < 14 && cached.list.length) return cached.list;
        const f = MerchantHouses.config().factor;
        const names = MerchantHouses.data().names || {};
        const given = names.factorGiven && names.factorGiven.length ? names.factorGiven : ['Factor'];
        const family = names.factorFamily && names.factorFamily.length ? names.factorFamily : [''];
        const list = [];
        for (let i = 0; i < f.candidates; i++) {
            const honesty = Math.round(Utils.randFloat(f.honesty[0], f.honesty[1]) * 100) / 100;
            const fac = {
                name: `${Utils.randPick(given)} ${Utils.randPick(family)}`.trim(),
                skill: Utils.randInt(f.skill[0], f.skill[1]),
                honesty,
                // Word around town: honest men are mostly spoken well of, and not always
                honestyGuess: _clamp(honesty + Utils.randFloat(-0.2, 0.2) + (c.reputation - 50) / 500, 0, 1),
            };
            fac.wage = MerchantHouses.factorWage(fac);
            list.push(fac);
        }
        c.candidates[key] = { day, list };
        return list;
    },

    canOpenPost(player, world, tile) {
        const c = MerchantHouses.company(player);
        if (!c) return { ok: false, reason: 'Found a company first.' };
        const s = tile && tile.settlement;
        if (!s) return { ok: false, reason: 'Posts stand in towns.' };
        if (MerchantHouses.postAt(player, tile.q, tile.r)) return { ok: false, reason: 'The company already has a post here.' };
        const cfg = MerchantHouses.config().post;
        if (c.posts.length >= cfg.maxPosts) return { ok: false, reason: `The company can run at most ${cfg.maxPosts} posts.` };
        if (s.kingdom && RealmWars.atWarWith(player, s.kingdom)) return { ok: false, reason: 'This realm is at war with you.' };
        const { cost, foreign } = MerchantHouses.postCost(player, world, tile);
        if (foreign && _num(player.reputation && player.reputation[s.kingdom]) < cfg.foreignMinReputation) {
            return { ok: false, reason: 'This realm distrusts you too much to license a foreign post.' };
        }
        if (c.capital < cost) return { ok: false, reason: `Opening a post here costs ${cost} gold of company capital.`, cost };
        return { ok: true, cost, foreign };
    },

    openPost(player, world, tile, candidateIdx = 0) {
        const can = MerchantHouses.canOpenPost(player, world, tile);
        if (!can.ok) return { success: false, reason: can.reason };
        const c = MerchantHouses.company(player);
        const list = MerchantHouses.candidates(player, world, tile);
        const factor = list[candidateIdx] || list[0];
        if (!factor) return { success: false, reason: 'Nobody here will work for you.' };
        MerchantHouses._debit(c, world, can.cost, 'posts', `Post opened at ${tile.settlement.name}${can.foreign ? ' (foreign licence)' : ''}`);
        const post = {
            id: MerchantHouses._nextId(player, 'post'),
            q: tile.q, r: tile.r, name: tile.settlement.name, kingdom: tile.settlement.kingdom || null,
            openedDay: _day(world),
            factor: { ...factor, hiredDay: _day(world), unpaid: 0 },
            stock: {}, orders: [], skimmed: 0, suspicion: 0, lastWeek: null,
        };
        c.posts.push(post);
        delete c.candidates[_key(tile.q, tile.r)];
        // Moving into a rival's town is a declaration
        for (const r of MerchantHouses.rivalsAt(player, tile.q, tile.r)) {
            r.rivalry = _clamp(r.rivalry + MerchantHouses.config().rivals.openRivalry, 0, 100);
        }
        return { success: true, post };
    },

    replaceFactor(player, world, postId, candidateIdx = 0) {
        const post = MerchantHouses.getPost(player, postId);
        if (!post) return { success: false, reason: 'No such post.' };
        const tile = world.getTile(post.q, post.r);
        const list = MerchantHouses.candidates(player, world, tile);
        const factor = list[candidateIdx];
        if (!factor) return { success: false, reason: 'No such candidate.' };
        const old = post.factor;
        post.factor = { ...factor, hiredDay: _day(world), unpaid: 0 };
        post.suspicion = 0;
        delete MerchantHouses.company(player).candidates[_key(post.q, post.r)];
        return { success: true, factor: post.factor, dismissed: old ? old.name : null };
    },

    /** Close a post: its stock is sold off here at today's prices. */
    closePost(player, world, postId) {
        const c = MerchantHouses.company(player);
        const post = MerchantHouses.getPost(player, postId);
        if (!c || !post) return { success: false, reason: 'No such post.' };
        const tile = world.getTile(post.q, post.r);
        let earned = 0;
        for (const [id, qty] of Object.entries(post.stock)) {
            if (!(qty > 0)) continue;
            const unit = MerchantHouses.factorSaleUnit(player, world, tile, id, qty);
            earned += Math.floor(unit * qty);
        }
        if (earned > 0) MerchantHouses._credit(c, world, earned, 'sales', `Stock sold off closing ${post.name}`);
        c.posts = c.posts.filter(p => p !== post);
        return { success: true, earned };
    },

    /** Standing order: { good, buyBelow, buyQty, sellAbove, sellQty, keep }. */
    setOrder(player, postId, order) {
        const post = MerchantHouses.getPost(player, postId);
        if (!post) return { success: false, reason: 'No such post.' };
        const good = MerchantHouses._good(order && order.good);
        if (!good) return { success: false, reason: 'Unknown good.' };
        const n = (v) => Math.max(0, Math.floor(_num(Number(v))));
        const clean = {
            good: good.id,
            buyBelow: n(order.buyBelow), buyQty: n(order.buyQty),
            sellAbove: Math.max(1, n(order.sellAbove)), sellQty: n(order.sellQty),
            keep: n(order.keep),
        };
        const i = post.orders.findIndex(o => o.good === good.id);
        if (i >= 0) post.orders[i] = clean;
        else {
            if (post.orders.length >= MerchantHouses.config().post.maxOrders) return { success: false, reason: 'This factor already handles as many goods as he can.' };
            post.orders.push(clean);
        }
        return { success: true, order: clean };
    },

    removeOrder(player, postId, goodId) {
        const post = MerchantHouses.getPost(player, postId);
        if (!post) return { success: false, reason: 'No such post.' };
        post.orders = post.orders.filter(o => o.good !== goodId);
        return { success: true };
    },

    /** Go over a post's books: a skimming factor is likely found out. */
    audit(player, world, postId) {
        const c = MerchantHouses.company(player);
        const post = MerchantHouses.getPost(player, postId);
        if (!c || !post) return { success: false, reason: 'No such post.' };
        const f = MerchantHouses.config().factor;
        if (c.capital < f.auditCost) return { success: false, reason: `An audit costs ${f.auditCost} gold.` };
        MerchantHouses._debit(c, world, f.auditCost, 'audits', `Audit of ${post.name}`);
        if (post.skimmed > 0 && Utils.random() < f.auditFindChance) {
            const found = post.skimmed;
            const recovered = MerchantHouses._credit(c, world, found * f.auditRecover, 'recovered', `Recovered from ${post.factor ? post.factor.name : 'the factor'}`);
            post.skimmed = 0;
            post.suspicion = 0;
            if (post.factor) post.factor.caught = true;
            return { success: true, found, recovered, text: `The books don't balance: ${post.factor ? post.factor.name : 'the factor'} has skimmed ${found} gold. ${recovered} is clawed back.` };
        }
        post.suspicion = 0;
        return { success: true, found: 0, recovered: 0, text: 'The books are in order — as far as the auditors can tell.' };
    },

    /** Take goods from a post into the packs (the player must be there). */
    withdrawStock(player, world, postId, goodId, qty) {
        const post = MerchantHouses.getPost(player, postId);
        if (!post) return { success: false, reason: 'No such post.' };
        if (player.q !== post.q || player.r !== post.r) return { success: false, reason: `You must be at ${post.name}.` };
        const n = Math.min(Math.floor(_num(qty)), _num(post.stock[goodId]));
        if (n <= 0) return { success: false, reason: 'None in the warehouse.' };
        if (!PlayerInventory.canAdd(player, goodId)) return { success: false, reason: PlayerInventory.fullMessage(player) };
        PlayerInventory.addItem(player, goodId, n);
        post.stock[goodId] -= n;
        if (post.stock[goodId] <= 0) delete post.stock[goodId];
        return { success: true, qty: n };
    },

    /** Put goods from the packs into a post's warehouse (not stolen ones). */
    depositStock(player, world, postId, goodId, qty) {
        const post = MerchantHouses.getPost(player, postId);
        if (!post) return { success: false, reason: 'No such post.' };
        if (player.q !== post.q || player.r !== post.r) return { success: false, reason: `You must be at ${post.name}.` };
        if (!MerchantHouses._good(goodId)) return { success: false, reason: 'The factor only deals in trade goods.' };
        const have = _num(player.inventory && player.inventory[goodId]) - Underworld.hotQty(player, goodId, _day(world));
        const room = MerchantHouses.config().post.capacity - MerchantHouses.stockTotal(post);
        const n = Math.min(Math.floor(_num(qty)), have, room);
        if (n <= 0) return { success: false, reason: have <= 0 ? 'Nothing (clean) to deposit.' : 'The warehouse is full.' };
        player.inventory[goodId] -= n;
        if (player.inventory[goodId] <= 0) delete player.inventory[goodId];
        post.stock[goodId] = _num(post.stock[goodId]) + n;
        return { success: true, qty: n };
    },

    // ── Monopolies ──────────────────────────────────────────────

    _setMonopoly(settlement, goodId, holder, holderName, day, days) {
        if (!settlement.monopolies) settlement.monopolies = {};
        settlement.monopolies[goodId] = { holder, holderName, sinceDay: day, untilDay: days ? day + days : null };
    },

    /** Drop monopolies that ran out or whose holder is gone. Deterministic; no RNG. */
    expireMonopolies(player, world) {
        const day = _day(world);
        const gone = new Set(MerchantHouses.rivals(player).filter(r => r.status !== 'active').map(r => r.id));
        const views = world.getSettlementViews ? world.getSettlementViews() : [];
        let n = 0;
        for (const s of views) {
            if (!s.monopolies) continue;
            for (const [good, mono] of Object.entries(s.monopolies)) {
                const lapsed = mono && mono.untilDay != null && day >= mono.untilDay;
                // A crown monopoly outlives neither the edict nor the town's place in the realm
                const crownGone = mono && mono.holder === 'crown'
                    && !(s.kingdom === mono.kingdomId && world.getKingdom && KingdomBonuses.crownEffect(world.getKingdom(s.kingdom), 'crownMonopoly') > 0);
                const orphan = mono && (crownGone || gone.has(mono.holder) || (mono.holder === 'player' && !MerchantHouses.hasCompany(player)));
                if (!mono || lapsed || orphan) { delete s.monopolies[good]; n++; }
            }
            if (!Object.keys(s.monopolies).length) delete s.monopolies;
        }
        return n;
    },

    monopolyLobbyCost(player, world, post) {
        const cfg = MerchantHouses.config().monopoly;
        const tile = world.getTile(post.q, post.r);
        const pop = _num(tile && tile.settlement && tile.settlement.population);
        let cost = cfg.lobbyBase + cfg.perPopulation * pop;
        if (MerchantHouses._ownsSettlement(player, world, post.q, post.r)) cost *= cfg.ownHoldingMult;
        return Math.round(cost);
    },

    _ownsSettlement(player, world, q, r) {
        return Taxation.getPlayerSettlements(player, world).some(s => s.q === q && s.r === r);
    },

    canLobby(player, world, postId, goodId) {
        const c = MerchantHouses.company(player);
        const post = MerchantHouses.getPost(player, postId);
        if (!c || !post) return { ok: false, reason: 'No such post.' };
        const cfg = MerchantHouses.config().monopoly;
        const tile = world.getTile(post.q, post.r);
        const s = tile && tile.settlement;
        if (!s || !MerchantHouses._good(goodId)) return { ok: false, reason: 'Nothing to lobby for.' };
        if (s.monopolies && s.monopolies[goodId]) return { ok: false, reason: `${s.monopolies[goodId].holderName || 'Someone'} already holds that monopoly.` };
        const own = MerchantHouses._ownsSettlement(player, world, post.q, post.r);
        if (!own) {
            if (c.reputation < cfg.minReputation) return { ok: false, reason: `The company needs ${cfg.minReputation} reputation to be heard.` };
            if (s.kingdom && _num(player.reputation && player.reputation[s.kingdom]) < cfg.minKingdomReputation) {
                return { ok: false, reason: `The crown needs to think better of you (reputation ${cfg.minKingdomReputation}).` };
            }
        }
        const cost = MerchantHouses.monopolyLobbyCost(player, world, post);
        if (c.capital < cost) return { ok: false, reason: `Lobbying costs ${cost} gold.`, cost };
        const chance = own ? 1 : _clamp(cfg.chance + (c.reputation - 50) * cfg.perReputation, 0.1, 0.9);
        return { ok: true, cost, chance, own };
    },

    /** Lobby the crown (or rule it yourself) for a monopoly on a good at a post's town. */
    lobbyMonopoly(player, world, postId, goodId) {
        const can = MerchantHouses.canLobby(player, world, postId, goodId);
        if (!can.ok) return { success: false, reason: can.reason };
        const c = MerchantHouses.company(player);
        const post = MerchantHouses.getPost(player, postId);
        const s = world.getTile(post.q, post.r).settlement;
        MerchantHouses._debit(c, world, can.cost, 'lobbying', `Lobbying for ${_label(goodId)} at ${post.name}`);
        const won = can.own || Utils.random() < can.chance;
        if (!won) return { success: true, granted: false, text: `The court takes your gold and grants nothing.` };
        const days = MerchantHouses.config().monopoly.days;
        MerchantHouses._setMonopoly(s, goodId, 'player', c.name, _day(world), days);
        for (const r of MerchantHouses.rivalsAt(player, post.q, post.r)) r.rivalry = _clamp(r.rivalry + 10, 0, 100);
        MerchantHouses._news(player, world, `${c.name} wins the ${_label(goodId)} monopoly at ${post.name}.`, '👑');
        return { success: true, granted: true, days, text: `${c.name} alone may trade ${_label(goodId)} in ${post.name} for ${days} days.` };
    },

    // ── Shares, buy-outs, price wars ────────────────────────────

    buyShares(player, world, rivalId, n) {
        const c = MerchantHouses.company(player);
        const r = MerchantHouses.getRival(player, rivalId);
        const k = Math.floor(_num(n));
        if (!c || !r || r.status !== 'active') return { success: false, reason: 'No such house.' };
        if (k <= 0 || r.shares.player + _num(r.shares.purse) + k > 100) return { success: false, reason: 'Not that many shares for sale.' };
        const cost = Math.ceil(k * MerchantHouses.sharePrice(r) * MerchantHouses.config().rivals.sharePremium);
        if (c.capital < cost) return { success: false, reason: `${k} shares cost ${cost} gold.` };
        MerchantHouses._debit(c, world, cost, 'shares', `${k} shares in ${r.name}`);
        r.shares.player += k; // bought from the house's partners: its capital is unchanged
        return { success: true, cost, shares: r.shares.player };
    },

    sellShares(player, world, rivalId, n) {
        const c = MerchantHouses.company(player);
        const r = MerchantHouses.getRival(player, rivalId);
        const k = Math.floor(_num(n));
        if (!c || !r || r.status !== 'active') return { success: false, reason: 'No such house.' };
        if (k <= 0 || k > r.shares.player) return { success: false, reason: 'You hold fewer shares than that.' };
        const paid = Math.floor(k * MerchantHouses.sharePrice(r) * MerchantHouses.config().rivals.sellDiscount);
        r.shares.player -= k;
        MerchantHouses._credit(c, world, paid, 'shares', `${k} shares in ${r.name} sold`);
        return { success: true, earned: paid, shares: r.shares.player };
    },

    buyOutCost(player, rival) {
        if (!rival || rival.status !== 'active') return null;
        return Math.ceil((100 - rival.shares.player) * MerchantHouses.sharePrice(rival) * MerchantHouses.config().rivals.sharePremium);
    },

    /** With a majority of its shares, buy the rest and fold the house into yours. */
    buyOut(player, world, rivalId) {
        const c = MerchantHouses.company(player);
        const r = MerchantHouses.getRival(player, rivalId);
        if (!c || !r || r.status !== 'active') return { success: false, reason: 'No such house.' };
        if (r.shares.player < 51) return { success: false, reason: `You need a majority of ${r.name}'s shares first.` };
        const cost = MerchantHouses.buyOutCost(player, r);
        if (c.capital < cost) return { success: false, reason: `Buying the rest of ${r.name} costs ${cost} gold.` };
        MerchantHouses._debit(c, world, cost, 'buyouts', `The rest of ${r.name}`);
        const assets = Math.floor(r.capital);
        r.capital = 0;
        r.status = 'bought';
        r.endedDay = _day(world);
        r.shares.player = 0;
        MerchantHouses._credit(c, world, assets, 'buyouts', `${r.name}'s coffers`);
        c.reputation = _clamp(c.reputation + 8, 0, 100);
        // Its monopolies pass to the company
        for (const s of world.getSettlementViews ? world.getSettlementViews() : []) {
            for (const mono of Object.values(s.monopolies || {})) {
                if (mono.holder === r.id) { mono.holder = 'player'; mono.holderName = c.name; }
            }
        }
        MerchantHouses._news(player, world, `${c.name} buys out ${r.name}.`, '🤝');
        return { success: true, cost, assets };
    },

    /** Spend company gold undercutting a rival everywhere it trades. */
    priceWar(player, world, rivalId, spend) {
        const c = MerchantHouses.company(player);
        const r = MerchantHouses.getRival(player, rivalId);
        const cfg = MerchantHouses.config().rivals.priceWar;
        const amt = Math.floor(_num(spend));
        if (!c || !r || r.status !== 'active') return { success: false, reason: 'No such house.' };
        if (amt < cfg.minSpend) return { success: false, reason: `A price war needs at least ${cfg.minSpend} gold.` };
        if (c.capital < amt) return { success: false, reason: 'The company has not that much.' };
        MerchantHouses._debit(c, world, amt, 'priceWar', `Price war on ${r.name}`);
        const damage = Math.round(amt * Utils.randFloat(cfg.damage[0], cfg.damage[1]));
        r.capital = Math.max(0, r.capital - damage);
        r.rivalry = _clamp(r.rivalry + cfg.rivalry, 0, 100);
        c.reputation = _clamp(c.reputation - cfg.reputationCost, 0, 100);
        const ruined = r.capital < MerchantHouses.config().rivals.ruinCapital;
        if (ruined) MerchantHouses._ruin(player, world, r, null);
        return { success: true, damage, ruined, text: `${r.name} loses ${damage} gold matching your prices${ruined ? ' — and goes under' : ''}.` };
    },

    _ruin(player, world, r, out) {
        r.status = 'ruined';
        r.endedDay = _day(world);
        const lost = r.shares.player;
        r.shares.player = 0;
        MerchantHouses.expireMonopolies(player, world);
        MerchantHouses._news(player, world, `${r.name} is ruined; its posts are boarded up${lost ? ` (your ${lost} shares are worthless)` : ''}.`, '💀');
        if (out) out.notices.push({ icon: '💀', title: 'A House Falls', text: `${r.name} has gone under.`, type: lost ? 'warning' : 'info' });
    },

    // ── Contracts ───────────────────────────────────────────────

    contractDefs() {
        return MerchantHouses.data().contracts || {};
    },

    board(player) {
        return (player && player.merchant && player.merchant.board) || [];
    },

    /**
     * What a contract pays per unit delivered today: its price, but never
     * as much as the good could be bought for at the town or next door (a
     * market that has since begun to sell it caps the pay), so nothing
     * bought on the spot pays out.
     */
    contractUnitPay(world, contract) {
        const near = Ships.nearbyAsks(world, contract.q, contract.r, contract.good);
        let pay = contract.pay;
        if (near.market != null) pay = Math.min(pay, Math.floor(near.market * 0.5) - 1);
        if (near.port != null) pay = Math.min(pay, near.port - 1);
        return Math.max(0, pay);
    },

    /**
     * The towns a kind of contract may be posted in today, each read from real
     * world state: famine and hunger (world events, and saga events such as
     * the Long Winter's frost and hoarded granaries), sieges (a port an enemy
     * fleet blockades — world/kingdomNavy.js — or a holding of the player's
     * under siege — systems/holdingSieges.js), realms at war, and realms with
     * a fleet to build or pirates on their coasts (Sea Reavers).
     */
    _triggerTowns(world, trigger, towns, player = null) {
        const day = _day(world);
        if (trigger === 'famine') {
            const out = [];
            const seen = new Set();
            for (const ev of world.activeEvents || []) {
                const fx = ev.effects || {};
                const hungry = FAMINE_EVENTS.includes(ev.id) || _num(fx.farmProduction) < 0 || _num(fx.foodPrices) >= HUNGER_FOOD_PRICES;
                if (!hungry || typeof ev.q !== 'number' || seen.has(_key(ev.q, ev.r))) continue;
                const t = world.getTile(ev.q, ev.r);
                if (t && t.settlement) {
                    seen.add(_key(ev.q, ev.r));
                    out.push({ q: ev.q, r: ev.r, name: t.settlement.name, kingdom: t.settlement.kingdom });
                }
            }
            // The lean weeks: any town may run short
            if (!out.length && Seasons.isLean(day)) return towns;
            return out;
        }
        if (trigger === 'siege') {
            const besieged = (player && player.realmWars && player.realmWars.besieged) || {};
            const out = towns.filter(t => !!besieged[_key(t.q, t.r)] || !!KingdomNavy.portBlockade(world, t.q, t.r));
            // A besieged holding too small for the town list still counts — if a realm can pay for it
            for (const s of Object.values(besieged)) {
                const tile = world.getTile(s.q, s.r);
                const st = tile && tile.settlement;
                if (st && st.kingdom && !out.some(t => t.q === s.q && t.r === s.r)) out.push({ q: s.q, r: s.r, name: st.name, kingdom: st.kingdom });
            }
            return out;
        }
        if (trigger === 'war') {
            return towns.filter(t => {
                const k = t.kingdom && world.getKingdom(t.kingdom);
                return k && k.isAlive && Array.isArray(k.wars) && k.wars.length > 0;
            });
        }
        if (trigger === 'fleet') {
            const harried = new Set((world.activeEvents || [])
                .filter(ev => ev.kingdomId && _num((ev.effects || {}).pirateSpawnRate) > 0).map(ev => ev.kingdomId));
            return towns.filter(t => {
                const k = t.kingdom && world.getKingdom(t.kingdom);
                if (!k || !k.isAlive || !Ships.isPortTile(world, t.q, t.r)) return false;
                return (k.navy && _num(k.navy.ports) > 0) || harried.has(k.id);
            });
        }
        return towns.filter(t => t.kingdom);
    },

    _spawnContract(player, world) {
        const m = MerchantHouses.state(player);
        const defs = MerchantHouses.contractDefs();
        const towns = MerchantHouses._towns(world);
        const busy = new Set(m.board.map(c => _key(c.q, c.r)).concat(((m.company && m.company.contracts) || []).map(c => _key(c.q, c.r))));
        const options = [];
        for (const [id, def] of Object.entries(defs)) {
            const places = MerchantHouses._triggerTowns(world, def.trigger || 'any', towns, player).filter(t => !busy.has(_key(t.q, t.r)));
            if (places.length) options.push({ value: { id, def, places }, weight: def.trigger === 'any' ? 1 : 2 });
        }
        if (!options.length) return null;
        const pick = Utils.weightedPick(options);
        const town = Utils.randPick(pick.places);
        const k = town.kingdom && world.getKingdom(town.kingdom);
        if (!k) return null;
        // Only goods the town can't buy at home or next door
        const goods = (pick.def.goods || []).filter(g => {
            if (!MerchantHouses._good(g)) return false;
            const near = Ships.nearbyAsks(world, town.q, town.r, g);
            return near.market == null && near.port == null;
        });
        if (!goods.length) return null;
        const goodId = Utils.randPick(goods);
        const good = MerchantHouses._good(goodId);
        const cfg = MerchantHouses.config().contracts;
        const [qLo, qHi] = pick.def.qty || [20, 50];
        const [pLo, pHi] = pick.def.premium || [1.3, 1.6];
        const [dLo, dHi] = pick.def.days || [20, 35];
        const [bLo, bHi] = cfg.rivalBidAfter;
        const day = _day(world);
        const fill = (t) => String(t || '').replace(/\{town\}/g, town.name).replace(/\{issuer\}/g, k.name).replace(/\{good\}/g, _label(goodId));
        const contract = {
            id: MerchantHouses._nextId(player, 'ctr'),
            defId: pick.id, icon: pick.def.icon || '📜', title: fill(pick.def.title), text: fill(pick.def.text),
            kingdomId: k.id, issuer: k.name, q: town.q, r: town.r, town: town.name,
            good: goodId, qty: Utils.randInt(qLo, qHi), delivered: 0,
            pay: Math.max(1, Math.round(good.basePrice * Utils.randFloat(pLo, pHi))),
            reputation: _num(pick.def.reputation, cfg.reputationReward),
            postedDay: day, deadline: day + Utils.randInt(dLo, dHi), bidDay: day + Utils.randInt(bLo, bHi),
            status: 'open',
        };
        m.board.push(contract);
        return contract;
    },

    canAcceptContract(player, contract) {
        const c = MerchantHouses.company(player);
        if (!c) return { ok: false, reason: 'Contracts go to chartered companies.' };
        if (!contract || contract.status !== 'open') return { ok: false, reason: 'That contract is gone.' };
        const min = MerchantHouses.config().contracts.minReputation;
        if (c.reputation < min) return { ok: false, reason: `No realm trusts a company with reputation under ${min}.` };
        return { ok: true };
    },

    acceptContract(player, world, contractId) {
        const m = MerchantHouses.state(player);
        const contract = m.board.find(x => x.id === contractId);
        const can = MerchantHouses.canAcceptContract(player, contract);
        if (!can.ok) return { success: false, reason: can.reason };
        m.board = m.board.filter(x => x !== contract);
        contract.status = 'accepted';
        contract.acceptedDay = _day(world);
        m.company.contracts.push(contract);
        return { success: true, contract };
    },

    getContract(player, contractId) {
        const c = MerchantHouses.company(player);
        return c ? c.contracts.find(x => x.id === contractId) || null : null;
    },

    /** Hand over `qty` of the contract's good (from wherever it came); pays per unit. */
    _deliver(player, world, contract, qty, how, out = null) {
        const c = MerchantHouses.company(player);
        const n = Math.min(Math.floor(_num(qty)), contract.qty - contract.delivered);
        if (n <= 0 || contract.status !== 'accepted') return 0;
        const unit = MerchantHouses.contractUnitPay(world, contract);
        contract.delivered += n;
        MerchantHouses._credit(c, world, unit * n, 'contracts', `${n} ${_label(contract.good)} to ${contract.town} (${how})`);
        // The goods reach the town's market (world/settlementMarket.js); food fills its granary too
        const tile = world.getTile(contract.q, contract.r);
        if (tile && tile.settlement) SettlementMarket.add(tile.settlement, contract.good, n);
        if (tile && tile.settlement && Seasons.priceGroup(contract.good) === 'food') {
            if (!tile.settlement.economy) Economy.initSettlement(tile.settlement);
            tile.settlement.economy.food = _num(tile.settlement.economy.food) + n;
            // A holding of the player's under siege eats it as siege stores
            HoldingSieges.receiveFood(player, world, contract.q, contract.r, n, `${c.name} (${how})`);
        }
        if (contract.delivered >= contract.qty) MerchantHouses._completeContract(player, world, contract, out);
        return n;
    },

    _completeContract(player, world, contract, out) {
        const c = MerchantHouses.company(player);
        const cfg = MerchantHouses.config().contracts;
        contract.status = 'done';
        contract.doneDay = _day(world);
        c.contracts = c.contracts.filter(x => x !== contract);
        c.reputation = _clamp(c.reputation + contract.reputation, 0, 100);
        if (!player.reputation) player.reputation = {};
        player.reputation[contract.kingdomId] = _clamp(_num(player.reputation[contract.kingdomId]) + cfg.kingdomReputation, -100, 100);
        c.stats.contractsDone++;
        if ((MerchantHouses.contractDefs()[contract.defId] || {}).trigger === 'siege') Quests.track(player, 'siege_supplies_delivered');
        MerchantHouses._news(player, world, `${c.name} fulfils "${contract.title}" for ${contract.issuer}.`, '✅');
        if (out) out.notices.push({ icon: '✅', title: 'Contract Fulfilled', text: `"${contract.title}": ${contract.issuer} is satisfied (+${contract.reputation} company reputation).`, type: 'success' });
    },

    _failContract(player, world, contract, out) {
        const c = MerchantHouses.company(player);
        const cfg = MerchantHouses.config().contracts;
        contract.status = 'failed';
        c.contracts = c.contracts.filter(x => x !== contract);
        c.reputation = _clamp(c.reputation - cfg.reputationPenalty, 0, 100);
        if (!player.reputation) player.reputation = {};
        player.reputation[contract.kingdomId] = _clamp(_num(player.reputation[contract.kingdomId]) - cfg.kingdomReputation, -100, 100);
        c.stats.contractsFailed++;
        MerchantHouses._rumor(player, world, 'contract_broken', contract.q, contract.r, contract.issuer, 0.85);
        MerchantHouses._news(player, world, `${c.name} breaks its contract with ${contract.issuer} ("${contract.title}").`, '❌');
        if (out) out.notices.push({ icon: '❌', title: 'Contract Broken', text: `"${contract.title}" ran out with ${contract.delivered}/${contract.qty} delivered. Reputation suffers, and the market talks.`, type: 'error' });
    },

    /** Ways the player can deliver to a contract right now: [{ from, label, qty, shipId? }]. */
    deliveryOptions(player, world, contractId) {
        const contract = MerchantHouses.getContract(player, contractId);
        if (!contract) return [];
        const out = [];
        const here = player.q === contract.q && player.r === contract.r;
        if (here) {
            const have = _num(player.inventory && player.inventory[contract.good]) - Underworld.hotQty(player, contract.good, _day(world));
            if (have > 0) out.push({ from: 'inventory', label: 'from your packs', qty: have });
            for (const ship of player.ships || []) {
                if (ship.q === contract.q && ship.r === contract.r && ship.status === 'docked' && _num(ship.cargo && ship.cargo[contract.good]) > 0) {
                    out.push({ from: 'ship', shipId: ship.id, label: `from ${ship.name}'s hold`, qty: ship.cargo[contract.good] });
                }
            }
        }
        const post = MerchantHouses.postAt(player, contract.q, contract.r);
        if (post && _num(post.stock[contract.good]) > 0) out.push({ from: 'post', postId: post.id, label: `from the ${post.name} warehouse`, qty: post.stock[contract.good] });
        return out;
    },

    /** Deliver by hand, from a docked ship's hold, or from the post at the contract town. */
    deliverContract(player, world, contractId, from = 'inventory', opts = {}) {
        const contract = MerchantHouses.getContract(player, contractId);
        if (!contract || contract.status !== 'accepted') return { success: false, reason: 'No such contract.' };
        const opt = MerchantHouses.deliveryOptions(player, world, contractId)
            .find(o => o.from === from && (opts.shipId == null || String(o.shipId) === String(opts.shipId)));
        if (!opt) return { success: false, reason: `Nothing to deliver ${from === 'post' ? 'from a post' : 'here'}.` };
        const want = opts.qty == null ? opt.qty : Math.min(opt.qty, Math.floor(_num(opts.qty)));
        const out = { notices: [] };
        const n = MerchantHouses._deliver(player, world, contract, want, from === 'ship' ? 'by ship' : from === 'post' ? 'from the post' : 'by hand', out);
        if (n <= 0) return { success: false, reason: 'Nothing delivered.' };
        if (from === 'inventory') {
            player.inventory[contract.good] -= n;
            if (player.inventory[contract.good] <= 0) delete player.inventory[contract.good];
        } else if (from === 'ship') {
            const ship = (player.ships || []).find(s => s.id === opt.shipId);
            ship.cargo[contract.good] -= n;
            if (ship.cargo[contract.good] <= 0) delete ship.cargo[contract.good];
        } else {
            const post = MerchantHouses.getPost(player, opt.postId);
            post.stock[contract.good] -= n;
            if (post.stock[contract.good] <= 0) delete post.stock[contract.good];
        }
        return { success: true, delivered: n, done: contract.status === 'done', notices: out.notices };
    },

    // ── Convoys ─────────────────────────────────────────────────

    /** Plan a convoy from a post to another post or a contract town: { days, fee, mode, risk }. */
    convoyPlan(player, world, post, q, r, qty) {
        const cfg = MerchantHouses.config().convoy;
        const dist = Hex.wrappingDistance(post.q, post.r, q, r, world.width);
        const bySea = Ships.isPortTile(world, post.q, post.r) && Ships.isPortTile(world, q, r);
        const days = Math.max(1, Math.ceil(dist / (bySea ? cfg.shipHexesPerDay : cfg.hexesPerDay)));
        const fee = Math.max(cfg.minFee, Math.ceil(qty * cfg.feePerUnitPerDay * days));
        const perDay = bySea ? cfg.shipRiskPerDay : cfg.riskPerDay;
        return { days, fee, mode: bySea ? 'ship' : 'caravan', risk: 1 - Math.pow(1 - perDay, days), dist };
    },

    /** Send goods from a post: to another post ({ postId }) or to a contract ({ contractId }). */
    dispatchConvoy(player, world, fromPostId, target, goodId, qty) {
        const c = MerchantHouses.company(player);
        const post = MerchantHouses.getPost(player, fromPostId);
        if (!c || !post) return { success: false, reason: 'No such post.' };
        const have = _num(post.stock[goodId]);
        let n = Math.min(Math.floor(_num(qty)), have);
        let dest;
        if (target && target.contractId) {
            const contract = MerchantHouses.getContract(player, target.contractId);
            if (!contract || contract.status !== 'accepted') return { success: false, reason: 'No such contract.' };
            if (contract.good !== goodId) return { success: false, reason: `That contract wants ${_label(contract.good)}.` };
            const inFlight = c.convoys.filter(v => v.contractId === contract.id).reduce((a, v) => a + v.qty, 0);
            n = Math.min(n, contract.qty - contract.delivered - inFlight);
            dest = { q: contract.q, r: contract.r, name: contract.town, contractId: contract.id };
        } else if (target && target.postId) {
            const to = MerchantHouses.getPost(player, target.postId);
            if (!to || to === post) return { success: false, reason: 'No such post.' };
            dest = { q: to.q, r: to.r, name: to.name, postId: to.id };
        } else return { success: false, reason: 'Send it where?' };
        if (n <= 0) return { success: false, reason: 'Nothing to send.' };
        const plan = MerchantHouses.convoyPlan(player, world, post, dest.q, dest.r, n);
        if (c.capital < plan.fee) return { success: false, reason: `The ${plan.mode} costs ${plan.fee} gold.` };
        MerchantHouses._debit(c, world, plan.fee, 'convoys', `${plan.mode === 'ship' ? 'Ship' : 'Caravan'}: ${n} ${_label(goodId)} ${post.name} → ${dest.name}`);
        post.stock[goodId] -= n;
        if (post.stock[goodId] <= 0) delete post.stock[goodId];
        const convoy = {
            id: MerchantHouses._nextId(player, 'cv'), from: post.name, fromQ: post.q, fromR: post.r,
            to: dest.name, q: dest.q, r: dest.r, postId: dest.postId || null, contractId: dest.contractId || null,
            good: goodId, qty: n, mode: plan.mode, risk: plan.risk, departDay: _day(world), arriveDay: _day(world) + plan.days,
        };
        c.convoys.push(convoy);
        return { success: true, convoy, plan };
    },

    _arriveConvoy(player, world, convoy, out) {
        const c = MerchantHouses.company(player);
        const cfg = MerchantHouses.config().convoy;
        let qty = convoy.qty;
        if (Utils.random() < convoy.risk) {
            const lost = Math.max(1, Math.round(qty * Utils.randFloat(cfg.lossShare[0], cfg.lossShare[1])));
            qty -= Math.min(qty, lost);
            c.stats.convoysLost++;
            LossBook.report(player, world, { kind: 'caravan', cause: convoy.mode === 'ship' ? 'storm and pirates' : 'bandits', value: LossBook.saleValue({ [convoy.good]: lost }), ref: `cv:${convoy.id}`, place: `${convoy.from} → ${convoy.to}`, q: convoy.q, r: convoy.r });
            out.notices.push({ icon: convoy.mode === 'ship' ? '🌊' : '🏴‍☠️', title: 'Convoy Struck', text: `Your ${convoy.mode} to ${convoy.to} lost ${lost} ${_label(convoy.good)} on the way${convoy.mode === 'ship' ? ' to storm and pirates' : ' to bandits'}.`, type: 'warning' });
        }
        if (qty <= 0) return;
        Quests.track(player, 'convoys_delivered');
        if (convoy.mode === 'ship') Quests.track(player, 'convoys_by_sea');
        if (convoy.contractId) {
            const contract = MerchantHouses.getContract(player, convoy.contractId);
            let left = qty;
            if (contract) left -= MerchantHouses._deliver(player, world, contract, qty, `by ${convoy.mode}`, out);
            if (left > 0) {
                // A cancelled or overfilled contract: sell what's left in town
                const tile = world.getTile(convoy.q, convoy.r);
                const unit = MerchantHouses.factorSaleUnit(player, world, tile, convoy.good, left);
                if (unit > 0) MerchantHouses._credit(c, world, unit * left, 'sales', `${left} ${_label(convoy.good)} sold off at ${convoy.to}`);
            }
            return;
        }
        const post = MerchantHouses.getPost(player, convoy.postId);
        if (post) post.stock[convoy.good] = _num(post.stock[convoy.good]) + qty;
        else {
            const tile = world.getTile(convoy.q, convoy.r);
            const unit = MerchantHouses.factorSaleUnit(player, world, tile, convoy.good, qty);
            if (unit > 0) MerchantHouses._credit(c, world, unit * qty, 'sales', `${qty} ${_label(convoy.good)} sold off at ${convoy.to}`);
        }
    },

    // ── Royal ventures ──────────────────────────────────────────

    ventureDefs() {
        return MerchantHouses.data().ventures || [];
    },

    _spawnVenture(player, world) {
        const m = MerchantHouses.state(player);
        const kingdoms = (world.kingdoms || []).filter(k => k.isAlive && _num(k.treasury) > 300);
        if (!kingdoms.length) return null;
        const k = Utils.randPick(kingdoms);
        const port = !!(k.navy && _num(k.navy.ports) > 0);
        const defs = MerchantHouses.ventureDefs().filter(d => d.requires !== 'port' || port);
        if (!defs.length) return null;
        const def = Utils.randPick(defs);
        const [dLo, dHi] = def.days || [40, 70];
        const day = _day(world);
        const cfg = MerchantHouses.config().ventures;
        const v = {
            id: MerchantHouses._nextId(player, 'ven'), defId: def.id, name: def.name, icon: def.icon || '⛵',
            text: String(def.text || '').replace(/\{kingdom\}/g, k.name),
            kingdomId: k.id, kingdom: k.name, openUntil: day + 14, days: Utils.randInt(dLo, dHi),
            success: _num(def.success, 0.5), returnMult: def.returnMult || [1.5, 2], salvage: def.salvage || [0, 0.3],
            maxStake: Math.round(Math.min(cfg.maxStake, Math.max(cfg.minStake * 2, _num(k.treasury) * cfg.maxStakeShare))),
        };
        m.ventures.push(v);
        return v;
    },

    invest(player, world, ventureId, amount) {
        const c = MerchantHouses.company(player);
        const m = MerchantHouses.state(player);
        const v = m.ventures.find(x => x.id === ventureId);
        const cfg = MerchantHouses.config().ventures;
        const amt = Math.floor(_num(amount));
        if (!c || !v) return { success: false, reason: 'No such venture.' };
        const held = c.investments.ventures.filter(x => x.ventureId === v.id).reduce((a, x) => a + x.stake, 0);
        if (amt < cfg.minStake) return { success: false, reason: `The least stake is ${cfg.minStake} gold.` };
        if (held + amt > v.maxStake) return { success: false, reason: `The crown sells at most ${v.maxStake} gold of shares in this.` };
        if (c.capital < amt) return { success: false, reason: 'The company has not that much.' };
        MerchantHouses._debit(c, world, amt, 'ventures', `Stake in ${v.name}`);
        const k = world.getKingdom(v.kingdomId);
        if (k) k.treasury = _num(k.treasury) + amt;
        c.investments.ventures.push({
            ventureId: v.id, name: v.name, icon: v.icon, kingdom: v.kingdom, stake: amt,
            resolveDay: _day(world) + v.days, success: v.success, returnMult: v.returnMult, salvage: v.salvage,
        });
        return { success: true, stake: amt };
    },

    _resolveVenture(player, world, stake, out) {
        const c = MerchantHouses.company(player);
        const won = Utils.random() < stake.success;
        const mult = won ? Utils.randFloat(stake.returnMult[0], stake.returnMult[1]) : Utils.randFloat(stake.salvage[0], stake.salvage[1]);
        const back = Math.floor(stake.stake * mult);
        if (back > 0) MerchantHouses._credit(c, world, back, 'ventures', `${stake.name} ${won ? 'comes home' : 'salvage'}`);
        const text = won ? `${stake.icon} ${stake.name} comes home laden: your ${stake.stake} gold returns ${back}.`
            : `${stake.icon} ${stake.name} is lost${back ? `; ${back} of your ${stake.stake} gold is salvaged` : ` with your ${stake.stake} gold`}.`;
        MerchantHouses._news(player, world, text, stake.icon);
        out.notices.push({ icon: stake.icon, title: won ? 'Venture Returns' : 'Venture Lost', text, type: won ? 'success' : 'warning' });
    },

    // ── Gossip ──────────────────────────────────────────────────

    _rumor(player, world, type, q, r, victimName, credibility) {
        const data = Gossip._getData();
        const def = data && data.rumorTypes && data.rumorTypes[type];
        const tile = world.getTile(q, r);
        if (!def || !tile || !tile.settlement) return null;
        Gossip.initializePlayer(player);
        const g = player.gossip;
        const rumor = {
            id: g.nextRumorId++, type,
            perpetrator: player.name || 'you',
            victim: { name: victimName, type: 'merchant', icon: '⚖️' },
            locationQ: q, locationR: r, locationName: tile.settlement.name, kingdom: tile.settlement.kingdom || null,
            dayCreated: _day(world), credibility, severity: def.baseSeverity * credibility,
            witnessCount: 0, witnessNames: [], spreadTo: [_key(q, r)], consequencesApplied: {}, expired: false,
            byMerchant: true,
        };
        g.rumors.push(rumor);
        return rumor;
    },

    // ── The weekly turn ─────────────────────────────────────────

    _runPost(player, world, post, out) {
        const c = MerchantHouses.company(player);
        const cfg = MerchantHouses.config();
        const tile = world.getTile(post.q, post.r);
        const s = tile && tile.settlement;
        if (!s) return;
        const day = _day(world);
        // Wages and rent
        const rent = cfg.post.weeklyRent;
        if (c.capital >= rent) MerchantHouses._debit(c, world, rent, 'rent', `Rent at ${post.name}`);
        if (post.factor) {
            const wage = MerchantHouses.factorWage(post.factor);
            if (c.capital >= wage) {
                MerchantHouses._debit(c, world, wage, 'wages', `${post.factor.name}'s wage`);
                post.factor.unpaid = 0;
            } else if (++post.factor.unpaid >= cfg.factor.unpaidQuitWeeks) {
                out.notices.push({ icon: '🚪', title: 'Factor Quits', text: `${post.factor.name} walks out of the ${post.name} post: no wages for ${post.factor.unpaid} weeks.`, type: 'warning' });
                post.factor = null;
            }
        }
        if (!post.factor) { post.lastWeek = { sales: 0, purchases: 0, idle: true }; return; }

        const rivalHere = MerchantHouses.rivalsAt(player, post.q, post.r).length > 0;
        let buyVolume = MerchantHouses.factorVolume(post.factor);
        let sellVolume = buyVolume;
        let sales = 0;
        let purchases = 0;
        const blocked = [];
        for (const order of post.orders) {
            const good = MerchantHouses._good(order.good);
            if (!good) continue;
            const holder = Economy.monopolyHolder(s, good.id, day);
            if (holder && holder !== 'player') { blocked.push(good.id); continue; }
            // Rivals in town take some of the custom, unless the company holds the monopoly
            const share = holder === 'player' ? 1 + cfg.monopoly.sellVolumeBonus : (rivalHere ? cfg.rivals.undercutVolume : 1);
            const spare = _num(post.stock[good.id]) - order.keep;
            const sellN = Math.min(order.sellQty, spare, Math.floor(sellVolume * share));
            if (sellN > 0) {
                const unit = MerchantHouses.factorSaleUnit(player, world, tile, good.id, sellN);
                if (unit > 0 && unit >= order.sellAbove) {
                    const earned = Math.floor(unit * sellN);
                    post.stock[good.id] -= sellN;
                    if (post.stock[good.id] <= 0) delete post.stock[good.id];
                    sellVolume -= sellN;
                    sales += MerchantHouses._credit(c, world, earned, 'sales', `${post.name}: sold ${sellN} ${_label(good.id)} at ${Math.round(unit * 10) / 10}`);
                    // The goods join the town's store (as the player's do); food its granary too
                    SettlementMarket.add(s, good.id, sellN);
                    if (Seasons.priceGroup(good.id) === 'food') {
                        if (!s.economy) Economy.initSettlement(s);
                        s.economy.food = _num(s.economy.food) + sellN;
                    }
                }
            }
            if (order.buyQty > 0 && buyVolume > 0) {
                const unit = MerchantHouses.factorBuyUnit(player, world, tile, good.id);
                const entry = unit != null ? Trading.getAvailableGoods(s, tile, world).find(g => g.id === good.id) : null;
                if (entry && unit > 0 && unit <= order.buyBelow) {
                    const room = cfg.post.capacity - MerchantHouses.stockTotal(post);
                    // Factors never spend the company's running costs for the next weeks
                    const spendable = Math.max(0, c.capital - MerchantHouses.reserve(player));
                    let n = Math.min(order.buyQty, entry.quantity, buyVolume, room, Math.floor(spendable / unit));
                    // Each unit costs what the player would pay for it (the price climbs as the stock falls)
                    let cost = n > 0 ? Trading.buyCost(player, entry, n, s) : 0;
                    while (n > 0 && cost > spendable) cost = --n > 0 ? Trading.buyCost(player, entry, n, s) : 0;
                    if (n > 0) {
                        purchases += MerchantHouses._debit(c, world, cost, 'purchases', `${post.name}: bought ${n} ${_label(good.id)} at ${Math.round(cost / n * 10) / 10}`);
                        post.stock[good.id] = _num(post.stock[good.id]) + n;
                        SettlementMarket.take(s, good.id, n);
                        buyVolume -= n;
                    }
                }
            }
        }
        // A dishonest factor keeps a little of every coin that passes through
        const turnover = sales + purchases;
        if (post.factor.honesty < cfg.factor.dishonestBelow && turnover > 0) {
            const skim = Math.min(c.capital, Math.floor(turnover * cfg.factor.skimRate * (1 - post.factor.honesty)));
            if (skim > 0) {
                c.capital -= skim;
                post.skimmed += skim;
                post.suspicion += cfg.factor.suspicionPerSkim;
            }
        }
        post.lastWeek = { sales, purchases, blocked };
    },

    /** Gold the factors leave untouched: wages and rent for `post.reserveWeeks` weeks. */
    reserve(player) {
        const c = MerchantHouses.company(player);
        if (!c) return 0;
        const cfg = MerchantHouses.config().post;
        const weekly = c.posts.reduce((a, p) => a + cfg.weeklyRent + (p.factor ? MerchantHouses.factorWage(p.factor) : 0), 0);
        return weekly * _num(cfg.reserveWeeks, 2);
    },

    robberyChance(player, world, post) {
        const cfg = MerchantHouses.config().robbery;
        const tile = world.getTile(post.q, post.r);
        const s = tile && tile.settlement;
        if (!s) return 0;
        const k = s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        let p = cfg.base + (Underworld.hasGuildPresence(s) ? cfg.guildTown : 0) - cfg.perGuard * Underworld.guardStrength(s, k);
        p = Math.max(cfg.minChance, p);
        const g = player.underworld && player.underworld.guild;
        if (g && g.member && _num(g.rank) >= cfg.guildFriendRank) p *= cfg.guildFriendMult;
        if (post.factor && post.factor.honesty < MerchantHouses.config().factor.dishonestBelow) p *= cfg.insiderMult;
        return p;
    },

    _robPost(player, world, post, out) {
        if (MerchantHouses.stockTotal(post) <= 0) return;
        if (Utils.random() >= MerchantHouses.robberyChance(player, world, post)) return;
        const c = MerchantHouses.company(player);
        const cfg = MerchantHouses.config().robbery;
        const share = Utils.randFloat(cfg.stockLoss[0], cfg.stockLoss[1]);
        let value = 0;
        const lost = [];
        for (const [id, qty] of Object.entries(post.stock)) {
            const n = Math.floor(qty * share);
            if (n <= 0) continue;
            post.stock[id] -= n;
            if (post.stock[id] <= 0) delete post.stock[id];
            const g = MerchantHouses._good(id);
            value += n * (g ? g.basePrice * Trading.SELL_SHARE : 0);
            lost.push(`${n} ${_label(id)}`);
        }
        if (!lost.length) return;
        c.stats.robberies++;
        LossBook.report(player, world, { kind: 'stock', cause: 'thieves', value: Math.round(value), ref: `post:${post.id}`, place: post.name, q: post.q, r: post.r });
        MerchantHouses._book(c, world, 'expenses', 'robbery', value, `Thieves at ${post.name}: ${lost.join(', ')}`);
        out.notices.push({ icon: '🗝️', title: 'Post Robbed', text: `Thieves broke into the ${post.name} warehouse and carried off ${lost.join(', ')}.`, type: 'error' });
    },

    _rivalWeek(player, world, out) {
        const m = MerchantHouses.state(player);
        const c = m.company;
        const cfg = MerchantHouses.config().rivals;
        const day = _day(world);
        const views = world.getSettlementViews ? world.getSettlementViews() : [];
        for (const r of m.rivals) {
            if (r.status !== 'active') continue;
            const t = MerchantHouses.temperament(r);
            const contested = r.posts.filter(p => c.posts.some(cp => cp.q === p.q && cp.r === p.r)).length;
            const monopolies = views.reduce((a, s) => a + Object.values(s.monopolies || {}).filter(mo => mo.holder === r.id).length, 0);
            // Crown monopolies (an edict of a realm the player rules) squeeze the posts in that realm
            const crownDrag = r.posts.reduce((a, p) => {
                const tile = world.getTile(p.q, p.r);
                const k = tile && tile.settlement && tile.settlement.kingdom && world.getKingdom(tile.settlement.kingdom);
                return a + KingdomBonuses.crownEffect(k, 'rivalPostReturn');
            }, 0);
            const rate = Utils.randFloat(cfg.weeklyReturn[0], cfg.weeklyReturn[1]) + t.returnBias - contested * cfg.contestedDrag + monopolies * 0.002 + crownDrag;
            const delta = r.capital * rate;
            r.capital = Math.max(0, r.capital + delta);
            r.lastProfit = Math.round(delta);
            r.lastWeek = day;
            r.lastDividend = 0;
            if (delta > 0) {
                const div = delta * cfg.dividendShare;
                r.lastDividend = Math.round(div * 100) / 100;
                r.capital -= div;
                const mine = Math.floor(div * r.shares.player / 100);
                if (mine > 0) MerchantHouses._credit(c, world, mine, 'dividends', `Dividend from ${r.name}`);
            }
            r.rivalry = _clamp(r.rivalry - 1, 0, 100);
            // Expand into a nearby town
            if (r.posts.length < cfg.maxPosts && r.capital > 2000 && Utils.random() < cfg.expandChance * t.expand) {
                const base = r.seat || r.posts[0];
                if (base) {
                    const towns = MerchantHouses._towns(world)
                        .filter(tw => !r.posts.some(p => p.q === tw.q && p.r === tw.r))
                        .map(tw => ({ ...tw, d: Hex.wrappingDistance(base.q, base.r, tw.q, tw.r, world.width) }))
                        .sort((a, b) => a.d - b.d)
                        .slice(0, 5);
                    if (towns.length) {
                        const tw = Utils.randPick(towns);
                        r.posts.push({ q: tw.q, r: tw.r, name: tw.name });
                        r.capital -= 300;
                        if (MerchantHouses.postAt(player, tw.q, tw.r)) {
                            r.rivalry = _clamp(r.rivalry + 10, 0, 100);
                            out.notices.push({ icon: r.icon, title: 'A Rival Moves In', text: `${r.name} opens a post in ${tw.name}, beside yours — your factor will feel it.`, type: 'warning' });
                        }
                    }
                }
            }
            if (Utils.random() < cfg.lobbyChance * t.lobby) MerchantHouses._rivalLobby(player, world, r, out);
            if (r.rivalry >= cfg.slanderRivalry && c.posts.length && Utils.random() < cfg.slanderChance * t.slander) {
                const p = Utils.randPick(c.posts);
                if (MerchantHouses._rumor(player, world, 'merchant_slander', p.q, p.r, r.name, 0.6)) {
                    c.reputation = _clamp(c.reputation - 2, 0, 100);
                    MerchantHouses._news(player, world, `${r.name} badmouths ${c.name} in ${p.name}.`, '🗣️');
                }
            }
            if (r.capital < cfg.ruinCapital) MerchantHouses._ruin(player, world, r, out);
        }
        // A newcomer takes a fallen house's place
        const active = m.rivals.filter(r => r.status === 'active').length;
        if (active < cfg.minActive && Utils.random() < cfg.newcomerChance) {
            const used = new Set(m.rivals.map(r => r.id));
            const free = (MerchantHouses.data().rivalHouses || []).filter(d => !used.has(d.id));
            if (free.length) {
                const def = Utils.randPick(free);
                const rival = MerchantHouses._makeRival(def, world, MerchantHouses._towns(world), `${day}:${Utils.randInt(1, 1e6)}`, day);
                m.rivals.push(rival);
                MerchantHouses._news(player, world, `${rival.name} opens its books in ${rival.seat ? rival.seat.name : 'the realm'}.`, rival.icon);
            }
        }
    },

    /**
     * The rival houses' week while the player has no company (the Bourse keeps
     * their shares trading, systems/bourse.js): the return on capital, the
     * dividend, ruin. Only the money side — no posts, lobbying or slander,
     * which need a company to act against. The caller supplies the dice (the
     * Bourse runs it on its own seeded stream).
     */
    quietWeek(player, world) {
        const m = MerchantHouses.state(player);
        if (m.company) return;
        const cfg = MerchantHouses.config().rivals;
        const day = _day(world);
        for (const r of m.rivals) {
            if (r.status !== 'active') continue;
            const t = MerchantHouses.temperament(r);
            const delta = r.capital * (Utils.randFloat(cfg.weeklyReturn[0], cfg.weeklyReturn[1]) + t.returnBias);
            r.capital = Math.max(0, r.capital + delta);
            r.lastProfit = Math.round(delta);
            r.lastWeek = day;
            r.lastDividend = delta > 0 ? Math.round(delta * cfg.dividendShare * 100) / 100 : 0;
            r.capital -= r.lastDividend;
            if (r.capital < cfg.ruinCapital) MerchantHouses._ruin(player, world, r, null);
        }
    },

    _rivalLobby(player, world, r, out) {
        if (!r.posts.length || !r.specialty.length) return;
        const p = Utils.randPick(r.posts);
        const goodId = Utils.randPick(r.specialty);
        const tile = world.getTile(p.q, p.r);
        const s = tile && tile.settlement;
        if (!s || (s.monopolies && s.monopolies[goodId]) || !MerchantHouses._good(goodId)) return;
        const cfg = MerchantHouses.config().monopoly;
        const c = MerchantHouses.company(player);
        if (MerchantHouses._ownsSettlement(player, world, p.q, p.r)) {
            // Your own town: they come to your court (once at a time)
            if (Petitions.pending(player).some(pt => pt.defId === `merchant_monopoly_${r.id}`)) return;
            const bribe = Utils.randInt(cfg.rivalBribe[0], cfg.rivalBribe[1]);
            const goodName = _label(goodId);
            const def = {
                title: `${r.name} Seeks a Monopoly`, icon: r.icon,
                text: `{name}, factor of ${r.name}, sets a purse of ${bribe} gold before you: the house asks for the sole right to trade ${goodName} in {settlement}.`,
                requires: { holding: ['settlement'] }, expires: 10,
                ignore: { result: `${r.name} takes its purse elsewhere.`, effects: {} },
                choices: [
                    { id: 'grant', label: 'Grant the monopoly and take the purse', effects: { gold: bribe, faction: { merchants: 2, commons: -3 }, monopoly: { good: goodId, holder: r.id, holderName: r.name, days: cfg.days } }, result: `${r.name} alone may trade ${goodName} in {settlement} now.` },
                    { id: 'refuse', label: 'Refuse: the market stays open', effects: { faction: { merchants: -2, commons: 2 } }, result: `${r.name}'s factor pockets the purse and leaves.` },
                ],
            };
            if (c) def.choices.push({ id: 'own', label: `Grant it to ${c.name} instead`, effects: { faction: { merchants: -3 }, monopoly: { good: goodId, holder: 'player', holderName: c.name, days: cfg.days } }, result: `The ${goodName} trade of {settlement} is ${c.name}'s alone.` });
            Petitions.spawnCustom(player, world, `merchant_monopoly_${r.id}`, def, { kind: 'settlement', q: p.q, r: p.r, settlement: s });
            return;
        }
        if (Utils.random() >= 0.5) return;
        MerchantHouses._setMonopoly(s, goodId, r.id, r.name, _day(world), cfg.days);
        r.capital -= 200;
        MerchantHouses._news(player, world, `${r.name} buys the ${_label(goodId)} monopoly at ${p.name}.`, '👑');
        const post = MerchantHouses.postAt(player, p.q, p.r);
        if (post && post.orders.some(o => o.good === goodId)) {
            out.notices.push({ icon: '👑', title: 'Monopoly Granted', text: `${r.name} now holds the ${_label(goodId)} monopoly at ${p.name}; your factor there may not trade it.`, type: 'warning' });
        }
    },

    _contractWeek(player, world, out) {
        const m = MerchantHouses.state(player);
        const cfg = MerchantHouses.config().contracts;
        const day = _day(world);
        // Rivals bid for what's been left on the board
        const active = MerchantHouses.activeRivals(player);
        for (const contract of m.board.slice()) {
            if (day < contract.bidDay || !active.length) continue;
            const bidder = active.slice().sort((a, b) => (b.reputation + b.capital / 200) - (a.reputation + a.capital / 200))[0];
            if (Utils.random() < 0.5 * MerchantHouses.temperament(bidder).bid) {
                m.board = m.board.filter(x => x !== contract);
                bidder.capital += Math.round(contract.qty * contract.pay * 0.15);
                bidder.reputation = _clamp(bidder.reputation + 2, 0, 100);
                MerchantHouses._news(player, world, `${bidder.name} takes the contract "${contract.title}".`, bidder.icon);
            }
        }
        if (m.board.length < cfg.maxBoard) {
            const n = Utils.randInt(cfg.spawnPerWeek[0], cfg.spawnPerWeek[1]);
            for (let i = 0; i < n && m.board.length < cfg.maxBoard; i++) {
                const ct = MerchantHouses._spawnContract(player, world);
                if (ct) out.notices.push({ icon: ct.icon, title: 'Contract Posted', text: `${ct.issuer}: ${ct.qty} ${_label(ct.good)} to ${ct.town} by day ${ct.deadline}, ${ct.pay}g each (Trading Company).`, type: 'info' });
            }
        }
    },

    _week(player, world, out) {
        const m = MerchantHouses.state(player);
        const c = m.company;
        for (const post of c.posts.slice()) MerchantHouses._runPost(player, world, post, out);
        for (const post of c.posts) MerchantHouses._robPost(player, world, post, out);
        MerchantHouses._contractWeek(player, world, out);
        MerchantHouses._rivalWeek(player, world, out);
        // Royal ventures
        const vcfg = MerchantHouses.config().ventures;
        if (m.ventures.length < vcfg.maxOpen && Utils.random() < vcfg.spawnChance) {
            const v = MerchantHouses._spawnVenture(player, world);
            if (v) out.notices.push({ icon: v.icon, title: 'A Royal Venture', text: `${v.text} (Trading Company → Investments)`, type: 'info' });
        }
        for (const post of c.posts) {
            if (post.suspicion >= MerchantHouses.config().factor.suspicionShown && !post.warned) {
                post.warned = true;
                out.notices.push({ icon: '🧾', title: 'The Books Look Thin', text: `The ${post.name} accounts don't add up. An audit may be in order.`, type: 'warning' });
            }
        }
        // A bad name fades slowly with honest trading
        if (c.reputation < MerchantHouses.config().found.startReputation) c.reputation += 1;
        c.weeks.unshift({ day: _day(world), income: Math.round(c.week.income || 0), expenses: Math.round(c.week.expenses || 0), capital: Math.round(c.capital) });
        const cap = MerchantHouses.config().weeksCap;
        if (c.weeks.length > cap) c.weeks.length = cap;
        c.week = { income: 0, expenses: 0 };
    },

    /**
     * The daily tick. Lapsed monopolies are cleared every week (no RNG);
     * everything else waits until the player has a company.
     * @returns {{ notices: object[] }}
     */
    processDay(player, world) {
        const out = { notices: [] };
        if (!player || !world) return out;
        const day = _day(world);
        if (day % 7 === 0) MerchantHouses.expireMonopolies(player, world);
        const c = MerchantHouses.company(player);
        if (!c) return out;
        const m = MerchantHouses.state(player);
        MerchantHouses.ensureRivals(player, world);

        // Convoys arriving
        for (const convoy of c.convoys.slice()) {
            if (day < convoy.arriveDay) continue;
            c.convoys = c.convoys.filter(v => v !== convoy);
            MerchantHouses._arriveConvoy(player, world, convoy, out);
        }
        // Deadlines
        for (const contract of c.contracts.slice()) {
            if (contract.status === 'accepted' && day > contract.deadline) MerchantHouses._failContract(player, world, contract, out);
        }
        m.board = m.board.filter(x => day <= x.deadline);
        // Ventures coming home; offers closing
        for (const stake of c.investments.ventures.slice()) {
            if (day < stake.resolveDay) continue;
            c.investments.ventures = c.investments.ventures.filter(x => x !== stake);
            MerchantHouses._resolveVenture(player, world, stake, out);
        }
        m.ventures = m.ventures.filter(v => day <= v.openUntil);

        if (day >= c.nextWeekDay) {
            c.nextWeekDay = day + 7;
            MerchantHouses._week(player, world, out);
        }
        return out;
    },
};
