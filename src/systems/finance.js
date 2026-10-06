// ============================================
// FINANCE — Banks, Credit & Coin
// ============================================
// The money side of the world: banking houses that take deposits and lend,
// the player's credit standing, the crowns' war chests and debts, the purity
// of each realm's coin, and the rare panics when it all goes wrong.
//
// Banking houses — 3–5 named lending houses seated in capitals and cities
//   (picked from the map by a hash of the world seed: no RNG, no world-gen
//   change; created on the first daily tick or when a save loads). Each has
//   capital reserves (deposits are part of them, loans draw on them), an
//   interest rate that rises as reserves fall, and a relation with every
//   realm. Branches in the cities and capitals of its seat realm serve the
//   player as well as the seat.
// Deposits — earn a slow, safe rate (≈3–7.5% a game year) compounded daily,
//   and are at risk: when a house fails the receivers pay back only part.
// Loans — products from market.json → loanOptions (amount, flat interest for
//   the term, duration, minCredit), priced by the borrower's credit score and
//   the house's reserves. A missed day costs a late fee and extends the term;
//   being overdue escalates: bailiffs take goods from the packs (7 days), the
//   house seizes collateral — deposits with it, then properties, docked ships,
//   company capital (14 days, then weekly) — and at 30 days the debt is
//   declared in default: written off, the house blacklists the player, the
//   realm thinks less of them, the House loses Prestige, a large debt puts a
//   price on their head (Gossip bounty) and a very large one sends them to
//   the debtors' prison when caught in that realm's towns.
// Credit — a 300–850 score from repayment history, collateral (properties,
//   ships, the company, holdings, deposits), House Prestige and debt load;
//   it sets the borrowing limit, which products are offered and their rate.
// Crowns — kingdom.finance: a smoothed estimate of the crown's daily income,
//   war spending above it (warBurn × income a day at war), a reserve of
//   reserveDays of income. A crown at war (or raising a wonder) that falls
//   below its reserve borrows from the friendliest house with reserves to
//   spare; it pays its debts weekly from the treasury. A crown in crisis
//   (missed payments, unpaid armies, debt above its capacity) raises an
//   extraordinary levy (unrest), debases its coin (gold now, dearer markets
//   and less trust), or defaults (its lenders lose capital, may fail; its
//   stability and its relations with the houses suffer). The player can lend
//   to a crown through royal bonds: weekly coupons, the principal at
//   maturity, reputation and Prestige — and a haircut if the crown defaults.
// Coinage — kingdom.finance.purity, read by world/coinage.js: Economy.marketPrice
//   multiplies by Coinage.priceMultiplier (Finance.coinPriceMultiplier) and
//   KingdomStability.target adds Coinage.stabilityMod.
// Events — data/finance.json → events: runs on banks, lost ventures, crowns
//   seizing strongrooms, new silver at the mint; recorded in finance.history
//   for the heralds (systems/heralds.js) and townsfolk chatter.
//
// The daily tick draws from its own seeded stream (Utils.withRng, seeded by
// the world seed and the day) so it never reshuffles another system's dice;
// player actions draw no randomness at all. State: player.finance (banks,
// accounts, loans, bonds, credit history; saved with the player) and
// kingdom.finance (saved with the kingdom). Content in data/finance.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Coinage } from '../world/coinage.js';
import { Technology } from './technology.js';
import { House } from './house.js';
import { Gossip } from './gossip.js';
import { Ships } from './ships.js';
import { MerchantHouses } from './merchantHouses.js';

function _num(v, d = 0) {
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function _day(world) {
    return (world && Number.isFinite(world.day)) ? world.day : 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** A deterministic fraction in [0, 1) from a key. */
function _frac(key) {
    return (_hash(key) % 100000) / 100000;
}

function _between(range, f) {
    if (!Array.isArray(range)) return _num(range);
    const lo = _num(range[0]);
    const hi = _num(range[1], lo);
    return lo + (hi - lo) * f;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _settlements(world) {
    if (!world) return [];
    if (typeof world.getSettlementViews === 'function') return world.getSettlementViews();
    return typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
}

function _round2(v) {
    return Math.round(v * 100) / 100;
}

const CROWN_LENDER = 'crown:';

export const Finance = {

    // ──────────── DATA ────────────

    data() {
        return DataLoader.finance || (DataLoader.get && DataLoader.get('finance')) || {};
    },

    config() {
        return Finance.data().config || {};
    },

    cfg(section) {
        return Finance.config()[section] || {};
    },

    yearDays() {
        return Math.max(1, _num(Finance.config().yearDays, 120));
    },

    event(id) {
        return (Finance.data().events || []).find(e => e && e.id === id) || null;
    },

    /** Loan products: market.json → loanOptions (Banking's catalogue). */
    products() {
        return Banking.catalogue();
    },

    /** Debased coin's multiplier on a settlement's prices (world/coinage.js). */
    coinPriceMultiplier(world, settlement) {
        return Coinage.priceMultiplier(world, settlement);
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            initialized: false,
            banks: [],
            accounts: {},
            loans: [],
            bonds: [],
            credit: { onTime: 0, missed: 0, repaid: 0, defaults: 0, settled: 0, lastDefaultDay: null },
            blacklist: {},
            wanted: {},
            history: [],
            nextId: 1,
            nextBankId: 1,
            lastDay: null,
            stats: { interestEarned: 0, interestPaid: 0, couponsEarned: 0, seized: 0, lostInFailures: 0, borrowed: 0, bondsBought: 0 },
        };
    },

    /** Get (creating / backfilling) the player's finance record. */
    state(player) {
        if (!player) return Finance._blank();
        let st = player.finance;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.finance = Finance._blank();
            return player.finance;
        }
        const blank = Finance._blank();
        if (typeof st.initialized !== 'boolean') st.initialized = false;
        for (const key of ['banks', 'loans', 'bonds', 'history']) if (!Array.isArray(st[key])) st[key] = [];
        for (const key of ['accounts', 'blacklist', 'wanted']) if (!st[key] || typeof st[key] !== 'object' || Array.isArray(st[key])) st[key] = {};
        st.credit = { ...blank.credit, ...(st.credit && typeof st.credit === 'object' ? st.credit : {}) };
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        if (!(st.nextId > 0)) st.nextId = st.loans.length + st.bonds.length + 1;
        if (!(st.nextBankId > 0)) st.nextBankId = st.banks.length + 1;
        if (st.lastDay === undefined) st.lastDay = null;
        for (const b of st.banks) {
            if (!b.relations || typeof b.relations !== 'object') b.relations = {};
            if (!b.status) b.status = 'open';
            if (b.panic === undefined) b.panic = null;
        }
        return st;
    },

    serialize(player) {
        return player && player.finance ? JSON.parse(JSON.stringify(player.finance)) : null;
    },

    /**
     * After a load: backfill the record, set up the banking houses (a hash of
     * the seed; no RNG) and fold any loans from the old royal-bank model
     * (player.loans) into the new one.
     */
    loadState(player, world = null) {
        const st = Finance.state(player);
        if (world && Array.isArray(world.kingdoms)) {
            if (!st.initialized) Finance._initBanks(world, st);
            Finance.migrateLegacyLoans(player, world);
        }
        return st;
    },

    /** The crown's finance record on a kingdom (created / backfilled). */
    kingdomState(kingdom) {
        if (!kingdom) return null;
        let f = kingdom.finance;
        if (!f || typeof f !== 'object') {
            f = kingdom.finance = { purity: 1, debt: [], income: 0, lastTreasury: null, missed: 0, unpaid: 0, levy: null, defaults: 0, lastDefaultDay: null, debasements: 0, lastDebaseDay: null, debtRatio: 0, borrowed: 0 };
        }
        if (typeof f.purity !== 'number' || !Number.isFinite(f.purity)) f.purity = 1;
        if (!Array.isArray(f.debt)) f.debt = [];
        for (const key of ['income', 'missed', 'unpaid', 'defaults', 'debasements', 'debtRatio', 'borrowed']) f[key] = _num(f[key]);
        if (f.lastTreasury === undefined) f.lastTreasury = null;
        if (f.levy === undefined) f.levy = null;
        if (f.lastDefaultDay === undefined) f.lastDefaultDay = null;
        if (f.lastDebaseDay === undefined) f.lastDebaseDay = null;
        return f;
    },

    /** A kingdom's finance record for reading (never created on read). */
    _kf(kingdom) {
        const f = kingdom && kingdom.finance;
        return f && typeof f === 'object' ? f : { purity: 1, debt: [], income: 0, debtRatio: 0, defaults: 0, lastDefaultDay: null };
    },

    // ──────────── BANKING HOUSES ────────────

    _initBanks(world, st) {
        st.initialized = true;
        if (st.banks.length) return;
        const B = Finance.cfg('banks');
        const alive = (world.kingdoms || []).filter(k => k && k.isAlive !== false);
        if (!alive.length) return;
        const n = _clamp(Math.round(alive.length / _num(B.perRealms, 2.5)), _num(B.min, 3), _num(B.max, 5));
        const types = B.seatTypes || ['capital', 'city'];
        const seed = _seed(world);
        const seats = _settlements(world)
            .filter(s => s && types.includes(s.type) && s.kingdom != null && Number.isFinite(s.q))
            .map(s => ({ s, score: _num(s.population, 1000) * (s.type === 'capital' ? 1.2 : 1) * (0.8 + 0.4 * _frac(`${seed}|bankSeat|${s.q},${s.r}`)) }))
            .sort((a, b) => b.score - a.score || (a.s.q - b.s.q) || (a.s.r - b.s.r));
        const realms = new Set();
        for (const { s } of seats) {
            if (st.banks.length >= n) break;
            if (realms.has(s.kingdom)) continue;
            const k = _kingdom(world, s.kingdom);
            if (!k || k.isAlive === false) continue;
            realms.add(s.kingdom);
            Finance._newBank(world, st, s);
        }
    },

    _newBank(world, st, seat) {
        const B = Finance.cfg('banks');
        const seed = _seed(world);
        const id = `bank${st.nextBankId++}`;
        const names = Finance.data().names || [];
        const used = new Set(st.banks.map(b => b.name));
        let name = `The Bank of ${seat.name || 'the realm'}`;
        if (names.length) {
            const start = _hash(`${seed}|bankName|${id}`) % names.length;
            for (let i = 0; i < names.length; i++) {
                const cand = names[(start + i) % names.length];
                if (!used.has(cand)) { name = cand; break; }
            }
        }
        const k = _kingdom(world, seat.kingdom);
        const pop = _num(k && k.population) || _num(seat.population, 5000) * 3;
        const jitter = _between(B.capitalJitter || [0.8, 1.25], _frac(`${seed}|bankCapital|${id}`));
        const capital = Math.round((_num(B.capitalBase, 15000) + _num(B.capitalPerHead, 4) * pop) * jitter);
        const relations = {};
        for (const kk of world.kingdoms || []) {
            if (!kk || kk.id == null) continue;
            relations[kk.id] = _num(B.relationStart, 40) + (kk.id === seat.kingdom ? _num(B.relationSeat, 25) : 0);
        }
        const bank = {
            id, name, q: seat.q, r: seat.r, seat: seat.name || 'a city', kingdomId: seat.kingdom,
            capital, baseCapital: capital, status: 'open', panic: null, relations,
            founded: _day(world), failedDay: null, refounded: false,
        };
        st.banks.push(bank);
        return bank;
    },

    bank(player, id) {
        const st = player && player.finance;
        return (st && Array.isArray(st.banks) ? st.banks.find(b => b && b.id === id) : null) || null;
    },

    /** Houses still trading. */
    openBanks(player) {
        const st = player && player.finance;
        return st && Array.isArray(st.banks) ? st.banks.filter(b => b && b.status === 'open') : [];
    },

    /** Reserves against what the house started with (1 = as founded). */
    reserveRatio(bank) {
        return bank ? _num(bank.capital) / Math.max(1, _num(bank.baseCapital, 1)) : 0;
    },

    inPanic(bank, day) {
        return !!(bank && bank.panic && _num(bank.panic.until) >= day);
    },

    /** Houses that serve the player on this tile: the seat, or a branch in its realm's cities. */
    banksAt(player, world, tile) {
        const s = tile && tile.settlement;
        if (!s) return [];
        const branch = Finance.cfg('banks').branchTypes || ['capital', 'city'];
        return Finance.openBanks(player).filter(b => (b.q === tile.q && b.r === tile.r)
            || (branch.includes(s.type) && s.kingdom != null && s.kingdom === b.kingdomId));
    },

    _here(player, world) {
        return world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
    },

    _serves(player, world, bank) {
        const tile = Finance._here(player, world);
        return Finance.banksAt(player, world, tile).some(b => b.id === bank.id);
    },

    /** The yearly rate a house pays on deposits (higher when it is short of coin). */
    depositApr(bank) {
        const D = Finance.cfg('deposits');
        const B = Finance.cfg('banks');
        const short = _num(B.targetReserve, 0.8) - Finance.reserveRatio(bank);
        return _clamp(_num(D.apr, 0.045) * (1 + short * _num(D.reserveSensitivity, 0.5)), _num(D.minApr, 0.03), _num(D.maxApr, 0.075));
    },

    // ──────────── CREDIT ────────────

    _propertyValue(prop) {
        const pt = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.PROPERTY_TYPES) || {};
        const def = pt[String(prop && prop.type || '').toUpperCase()];
        return _num(def && def.cost, 500);
    },

    _holdingCount(player, world) {
        if (!world || !Array.isArray(world.kingdoms)) return 0;
        let n = 0;
        for (const s of _settlements(world)) {
            const tile = world.getTile ? world.getTile(s.q, s.r) : null;
            const live = tile && tile.settlement;
            if (live && live.holding && typeof live.holding === 'object' && !live.holding.lost) n++;
        }
        return n;
    },

    /** What the player owns that a lender could take: { total, properties, ships, company, holdings, deposits }. */
    collateral(player, world) {
        const C = Finance.cfg('credit');
        const properties = (player && player.properties || []).reduce((s, p) => s + Finance._propertyValue(p), 0);
        const ships = (player && player.ships || []).reduce((s, sh) => s + _num(Ships.getShipValue(sh)), 0);
        const company = _num(MerchantHouses.companyValue(player));
        const holdings = Finance._holdingCount(player, world) * _num(C.holdingValue, 1500);
        const deposits = Finance.totalDeposits(player);
        return { total: Math.round(properties + ships + company + holdings + deposits), properties, ships, company, holdings, deposits: Math.round(deposits) };
    },

    totalDeposits(player) {
        const st = player && player.finance;
        if (!st || !st.accounts) return 0;
        let sum = 0;
        for (const [id, a] of Object.entries(st.accounts)) {
            const b = Finance.bank(player, id);
            if (b && b.status === 'open') sum += _num(a && a.balance);
        }
        return sum;
    },

    totalDebt(player) {
        const st = player && player.finance;
        return st && Array.isArray(st.loans) ? st.loans.reduce((s, l) => s + _num(l.totalOwed), 0) : 0;
    },

    /**
     * The credit report: { score, band, label, parts:[{label,value}], collateral,
     * debt, limit, available, overdue, defaults, blacklisted }.
     */
    creditReport(player, world = null) {
        const C = Finance.cfg('credit');
        const st = Finance.state(player);
        const cr = st.credit;
        const day = _day(world);
        const parts = [];
        const add = (label, v) => { if (Math.abs(v) >= 1) parts.push({ label, value: Math.round(v) }); return v; };
        let s = _num(C.base, 560);
        s += add('Loans repaid', Math.min(_num(C.repaidCap, 100), _num(cr.repaid) * _num(C.perRepaid, 20)));
        s += add('Payments on time', Math.min(_num(C.onTimeCap, 40), _num(cr.onTime) / Math.max(1, _num(C.onTimePer, 15))));
        s += add('Missed payments', -Math.min(_num(C.missedCap, 160), _num(cr.missed) * _num(C.perMissed, 3)));
        let def = -_num(cr.defaults) * _num(C.perDefault, 110);
        if (cr.lastDefaultDay != null && day - cr.lastDefaultDay < _num(C.recentDefaultDays, 240)) def -= _num(C.recentDefault, 40);
        s += add('Defaults', def);
        s += add('Debts made good', _num(cr.settled) * _num(C.perSettled, 40));
        const overdue = st.loans.reduce((a, l) => a + _num(l.overdue), 0);
        s += add('Overdue now', -overdue * _num(C.perOverdueDay, 4));
        const col = Finance.collateral(player, world);
        s += add('Collateral', Math.min(_num(C.collateralCap, 110), _num(C.collateralScale, 22) * Math.log2(1 + col.total / Math.max(1, _num(C.collateralUnit, 500)))));
        s += add('House Prestige', Math.min(_num(C.prestigeCap, 60), House.getPrestige(player) / Math.max(1, _num(C.prestigeDiv, 8))));
        // A master's guild stands behind them (systems/guilds.js keeps player.guilds.backing)
        s += add('Guild backing', _num(player && player.guilds && player.guilds.backing));
        const debt = Finance.totalDebt(player);
        const ratio = debt / Math.max(1, col.total + _num(player && player.gold));
        s += add('Debt load', -Math.min(_num(C.debtLoadCap, 120), ratio * _num(C.debtLoad, 80)));
        const score = Math.round(_clamp(s, _num(C.min, 300), _num(C.max, 850)));
        const bands = C.bands || [];
        const band = bands.find(b => score >= _num(b.min)) || { id: 'bad', label: 'Ruinous' };
        const factor = (score - _num(C.min, 300)) / Math.max(1, _num(C.max, 850) - _num(C.min, 300)) * 1.5 + 0.25;
        const hasDefault = Object.keys(st.blacklist).length > 0;
        const limit = Math.max(0, Math.round((col.total * _num(C.limitCollateral, 0.6) + _num(player && player.gold) * _num(C.limitGold, 1)) * factor
            + (hasDefault ? 0 : _num(C.limitFloor, 300))));
        return {
            score, band: band.id, label: band.label, parts, collateral: col, debt: Math.round(debt), limit,
            available: Math.max(0, limit - Math.round(debt)), overdue, defaults: _num(cr.defaults),
            blacklisted: Object.keys(st.blacklist),
        };
    },

    /** How a credit score scales a loan's interest (1 at creditFactorAt). */
    creditFactor(score) {
        const L = Finance.cfg('loans');
        const f = 1 + (_num(L.creditFactorAt, 600) - score) / 550 * _num(L.creditFactorSpan, 0.9);
        return _clamp(f, _num(L.creditFactorMin, 0.6), _num(L.creditFactorMax, 1.6));
    },

    /** How a house's reserves scale its loan rates (dearer when it is short). */
    reserveFactor(bank) {
        const L = Finance.cfg('loans');
        const B = Finance.cfg('banks');
        const f = 1 + (_num(B.targetReserve, 0.8) - Finance.reserveRatio(bank)) * _num(L.reserveSensitivity, 0.6);
        return _clamp(f, _num(L.reserveFactorMin, 0.85), _num(L.reserveFactorMax, 1.6));
    },

    // ──────────── LOANS ────────────

    /**
     * The loans a house offers the player: [{ id, name, amount, duration, rate,
     * totalOwed, dailyPayment, available, reason }].
     */
    loanOffers(player, world, bankId) {
        const bank = Finance.bank(player, bankId);
        if (!bank) return [];
        const st = Finance.state(player);
        const B = Finance.cfg('banks');
        const L = Finance.cfg('loans');
        const day = _day(world);
        const report = Finance.creditReport(player, world);
        const tech = Math.max(0, 1 - _num(Technology.getEffectTotal(player, 'loanInterestReduction')));
        let mult = Finance.creditFactor(report.score) * Finance.reserveFactor(bank) * tech;
        const rep = _num(player && player.reputation && player.reputation[bank.kingdomId]);
        if (rep <= _num(L.badStandingRep, -20)) mult *= _num(L.badStandingFactor, 1.2);
        const ev = Finance.event('bank_run');
        if (Finance.inPanic(bank, day)) mult *= _num(ev && ev.rateMult, 1.5);
        const mine = st.loans.filter(l => l.bankId === bank.id).length;
        return Finance.products().map(p => {
            const rate = _round2(_num(p.interestRate) * mult * 100) / 100;
            const totalOwed = Math.floor(_num(p.amount) * (1 + rate));
            let reason = null;
            if (bank.status !== 'open') reason = 'The house has failed.';
            else if (st.blacklist[bank.id] != null) reason = 'The house will not lend to a defaulter until the old debt is made good.';
            else if (Finance.inPanic(bank, day)) reason = 'A run on the house: no new loans until it passes.';
            else if (mine >= _num(B.maxLoansPerBank, 3)) reason = `At most ${_num(B.maxLoansPerBank, 3)} loans from one house.`;
            else if (report.score < _num(p.minCredit)) reason = `Needs a credit score of ${p.minCredit} (yours: ${report.score}).`;
            else if (_num(p.amount) > report.available) reason = `Beyond your credit (${report.available}g available).`;
            else if (_num(p.amount) > _num(bank.capital) * _num(B.maxLoanShare, 0.25)) reason = 'The house cannot spare so much coin.';
            return {
                id: p.id, name: p.name, amount: _num(p.amount), duration: _num(p.duration), rate, totalOwed,
                dailyPayment: Math.ceil(totalOwed / Math.max(1, _num(p.duration, 30))),
                available: !reason, reason,
            };
        });
    },

    /** Borrow a product from a house the player stands at (seat or branch). */
    takeLoan(player, world, bankId, productId) {
        const st = Finance.state(player);
        const bank = Finance.bank(player, bankId);
        if (!bank) return { success: false, reason: 'No such banking house.' };
        if (!Finance._serves(player, world, bank)) return { success: false, reason: `Visit ${bank.name} in ${bank.seat} or one of its branches.` };
        const offer = Finance.loanOffers(player, world, bankId).find(o => o.id === productId);
        if (!offer) return { success: false, reason: 'No such loan.' };
        if (!offer.available) return { success: false, reason: offer.reason };
        const loan = {
            id: `L${st.nextId++}`, bankId: bank.id, lender: bank.name, kingdomId: bank.kingdomId, product: offer.id,
            principal: offer.amount, interestRate: offer.rate, totalOwed: offer.totalOwed,
            dailyPayment: offer.dailyPayment, remainingDays: offer.duration, daysTaken: 0,
            overdue: 0, missed: 0, takenDay: _day(world),
        };
        st.loans.push(loan);
        bank.capital -= offer.amount;
        player.gold = _num(player.gold) + offer.amount;
        st.stats.borrowed += offer.amount;
        return { success: true, loan, text: `${bank.name} lends you ${offer.amount}g: ${loan.totalOwed}g to repay over ${offer.duration} days (${loan.dailyPayment}g a day).` };
    },

    /** Pay off a loan in full (anywhere: the house sends a clerk). */
    repayLoan(player, world, loanId) {
        const st = Finance.state(player);
        const i = st.loans.findIndex(l => l.id === loanId);
        if (i < 0) return { success: false, reason: 'Loan not found.' };
        const loan = st.loans[i];
        const owed = Math.ceil(_num(loan.totalOwed));
        if (_num(player.gold) < owed) return { success: false, reason: `Need ${owed} gold.` };
        player.gold -= owed;
        Finance._payLender(player, world, loan, owed);
        st.loans.splice(i, 1);
        st.credit.repaid++;
        st.stats.interestPaid += Math.max(0, _num(loan.totalPaid) + owed - _num(loan.principal));
        return { success: true, amount: owed, text: `Paid ${owed}g: your debt to ${loan.lender} is cleared.` };
    },

    _payLender(player, world, loan, amount) {
        if (String(loan.bankId || '').startsWith(CROWN_LENDER)) {
            const k = _kingdom(world, loan.kingdomId);
            if (k) k.treasury = _num(k.treasury) + amount;
            return;
        }
        const bank = Finance.bank(player, loan.bankId);
        if (bank) bank.capital = _num(bank.capital) + amount;
    },

    _lenderName(player, world, loan) {
        if (loan.lender) return loan.lender;
        const k = _kingdom(world, loan.kingdomId);
        return k ? `the Exchequer of ${k.name}` : 'your creditors';
    },

    /**
     * Fold loans from the old royal-bank model ({ kingdomId: [loan] } on
     * player.loans) into finance.loans: owed to the house seated in that
     * realm, or to the realm's own exchequer when it has none.
     */
    migrateLegacyLoans(player, world = null) {
        const legacy = player && player.loans;
        if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return 0;
        const st = Finance.state(player);
        let n = 0;
        for (const [kingdomId, loans] of Object.entries(legacy)) {
            for (const old of Array.isArray(loans) ? loans : []) {
                if (!old || typeof old !== 'object') continue;
                const bank = st.banks.find(b => b.status === 'open' && b.kingdomId === kingdomId) || null;
                const k = _kingdom(world, kingdomId);
                const owed = Math.max(0, Math.round(_num(old.totalOwed, _num(old.amount))));
                if (!owed) continue;
                const days = Math.max(1, Math.round(_num(old.remainingDays, 30)));
                st.loans.push({
                    id: `L${st.nextId++}`,
                    bankId: bank ? bank.id : `${CROWN_LENDER}${kingdomId}`,
                    lender: bank ? bank.name : `the Exchequer of ${k ? k.name : kingdomId}`,
                    kingdomId, product: old.type || 'legacy',
                    principal: Math.round(_num(old.principal, owed)), interestRate: _num(old.interestRate, 0.1),
                    totalOwed: owed, dailyPayment: Math.max(1, Math.round(_num(old.dailyPayment, Math.ceil(owed / days)))),
                    remainingDays: days, daysTaken: Math.round(_num(old.daysTaken)), overdue: 0, missed: 0,
                    takenDay: _day(world) - Math.round(_num(old.daysTaken)), migrated: true,
                });
                n++;
            }
        }
        player.loans = {};
        return n;
    },

    // ──────────── DEPOSITS ────────────

    account(player, bankId) {
        const st = Finance.state(player);
        if (!st.accounts[bankId]) st.accounts[bankId] = { balance: 0, interest: 0, opened: null };
        return st.accounts[bankId];
    },

    deposit(player, world, bankId, amount) {
        const bank = Finance.bank(player, bankId);
        const D = Finance.cfg('deposits');
        amount = Math.floor(_num(amount));
        if (!bank || bank.status !== 'open') return { success: false, reason: 'That house is not trading.' };
        if (!Finance._serves(player, world, bank)) return { success: false, reason: `Visit ${bank.name} in ${bank.seat} or one of its branches.` };
        if (Finance.inPanic(bank, _day(world))) return { success: false, reason: 'Nobody sane deposits during a run on the house.' };
        if (amount < _num(D.minDeposit, 50)) return { success: false, reason: `The smallest deposit is ${_num(D.minDeposit, 50)}g.` };
        if (_num(player.gold) < amount) return { success: false, reason: 'Not enough gold.' };
        const acct = Finance.account(player, bankId);
        if (acct.opened == null) acct.opened = _day(world);
        player.gold -= amount;
        acct.balance = _round2(_num(acct.balance) + amount);
        bank.capital = _num(bank.capital) + amount;
        return { success: true, text: `Deposited ${amount}g with ${bank.name} at ${(Finance.depositApr(bank) * 100).toFixed(1)}% a year.` };
    },

    /** Withdraw (all of it with amount null). During a run the house pays out only so much a day. */
    withdraw(player, world, bankId, amount = null) {
        const bank = Finance.bank(player, bankId);
        if (!bank || bank.status !== 'open') return { success: false, reason: 'That house is not trading.' };
        if (!Finance._serves(player, world, bank)) return { success: false, reason: `Visit ${bank.name} in ${bank.seat} or one of its branches.` };
        const acct = Finance.account(player, bankId);
        let want = Math.floor(amount == null ? _num(acct.balance) : Math.min(_num(amount), _num(acct.balance)));
        if (want <= 0) return { success: false, reason: 'Nothing to withdraw.' };
        const day = _day(world);
        if (Finance.inPanic(bank, day)) {
            const ev = Finance.event('bank_run') || {};
            const cap = Math.floor(_num(bank.capital) * _num(ev.withdrawCap, 0.05));
            const paidToday = bank.panic.paidDay === day ? _num(bank.panic.paid) : 0;
            const left = Math.max(0, cap - paidToday);
            if (left <= 0) return { success: false, reason: 'The counters are shut for today: the house has paid out all it will.' };
            want = Math.min(want, left);
            bank.panic.paid = paidToday + want;
            bank.panic.paidDay = day;
        }
        want = Math.min(want, Math.floor(Math.max(0, _num(bank.capital))));
        if (want <= 0) return { success: false, reason: 'The house has no coin to pay you.' };
        acct.balance = _round2(_num(acct.balance) - want);
        // Withdrawing everything closes the account (the clerk keeps the odd copper)
        if (acct.balance < 0.01 || (amount == null && acct.balance < 1)) delete Finance.state(player).accounts[bankId];
        bank.capital -= want;
        player.gold = _num(player.gold) + want;
        return { success: true, amount: want, text: `Withdrew ${want}g from ${bank.name}.` };
    },

    // ──────────── ROYAL BONDS ────────────

    /** A crown's yearly bond rate: dearer the deeper its debts and the worse its record. */
    bondApr(kingdom, day) {
        const D = Finance.cfg('bonds');
        const f = Finance._kf(kingdom);
        let apr = _num(D.apr, 0.06) + Math.min(1.5, _num(f.debtRatio)) * _num(D.debtPremium, 0.08)
            + (1 - Coinage.purity(kingdom)) * _num(D.purityPremium, 0.15);
        if (f.lastDefaultDay != null && day - f.lastDefaultDay < 240) apr += _num(D.defaultPremium, 0.06);
        if (_num(kingdom.stability, 50) < 35) apr += _num(D.unrestPremium, 0.02);
        return _round2(Math.min(_num(D.maxApr, 0.2), apr) * 100) / 100;
    },

    /** Crowns whose bonds a house can broker: [{ kingdom, apr, room, held }]. */
    bondOffers(player, world) {
        const D = Finance.cfg('bonds');
        const st = Finance.state(player);
        const day = _day(world);
        const ruled = Finance._ruledId(player);
        return (world && world.kingdoms || []).filter(k => k && k.isAlive !== false && k.id !== ruled).map(k => {
            const held = st.bonds.filter(b => b.kingdomId === k.id).reduce((s, b) => s + _num(b.principal), 0);
            return { kingdom: k, kingdomId: k.id, apr: Finance.bondApr(k, day), held, room: Math.max(0, _num(D.maxPerCrown, 20000) - held) };
        }).sort((a, b) => b.apr - a.apr || String(a.kingdomId).localeCompare(String(b.kingdomId)));
    },

    _ruledId(player) {
        const r = player && player.throne && player.throne.ruling;
        return r && r.kingdomId != null ? r.kingdomId : null;
    },

    /** Lend to a crown through a house's brokers: the crown gets the gold now. */
    buyBond(player, world, kingdomId, amount, term = null) {
        const D = Finance.cfg('bonds');
        const st = Finance.state(player);
        const k = _kingdom(world, kingdomId);
        amount = Math.floor(_num(amount));
        if (!k || k.isAlive === false) return { success: false, reason: 'No such crown.' };
        if (!Finance.banksAt(player, world, Finance._here(player, world)).length) return { success: false, reason: 'Royal bonds are sold through a banking house.' };
        if (k.id === Finance._ruledId(player)) return { success: false, reason: 'You cannot lend to your own crown.' };
        if (amount < _num(D.min, 500)) return { success: false, reason: `The smallest bond is ${_num(D.min, 500)}g.` };
        if (_num(player.gold) < amount) return { success: false, reason: 'Not enough gold.' };
        const offer = Finance.bondOffers(player, world).find(o => o.kingdomId === kingdomId);
        if (!offer || amount > offer.room) return { success: false, reason: `The crown takes at most ${offer ? offer.room : 0}g more from you.` };
        const terms = D.terms || [120, 240];
        const days = terms.includes(term) ? term : terms[0];
        const day = _day(world);
        const bond = { id: `B${st.nextId++}`, kingdomId: k.id, kingdomName: k.name, principal: amount, apr: offer.apr, term: days, start: day, maturity: day + days, missed: 0, coupons: 0, haircut: 0 };
        st.bonds.push(bond);
        player.gold -= amount;
        k.treasury = _num(k.treasury) + amount;
        st.stats.bondsBought += amount;
        const f = Finance.kingdomState(k);
        f.borrowed = _num(f.borrowed) + amount;
        const rep = Math.min(_num(D.repCap, 10), Math.floor(amount / Math.max(1, _num(D.repPer, 500))));
        if (player.reputation && rep > 0) player.reputation[k.id] = Math.min(100, _num(player.reputation[k.id]) + rep);
        const prestige = Math.min(_num(D.prestigeCap, 25), Math.floor(amount / Math.max(1, _num(D.prestigePer, 400))));
        if (prestige > 0 && player.house) House.award(player.house, prestige, `royal bond to ${k.name}`, day);
        return { success: true, bond, text: `You lend ${amount}g to the crown of ${k.name} at ${(offer.apr * 100).toFixed(1)}% a year for ${days} days.${rep ? ` Reputation +${rep}.` : ''}${prestige ? ` Prestige +${prestige}.` : ''}` };
    },

    /** Sell a bond back through the brokers at a discount. */
    sellBond(player, world, bondId) {
        const D = Finance.cfg('bonds');
        const st = Finance.state(player);
        const i = st.bonds.findIndex(b => b.id === bondId);
        if (i < 0) return { success: false, reason: 'Bond not found.' };
        if (!Finance.banksAt(player, world, Finance._here(player, world)).length) return { success: false, reason: 'Bonds are sold through a banking house.' };
        const b = st.bonds[i];
        const k = _kingdom(world, b.kingdomId);
        const risk = k ? Math.min(0.5, Finance.bondApr(k, _day(world)) - _num(b.apr)) : 0.5;
        const price = Math.floor(_num(b.principal) * (1 - _num(D.sellDiscount, 0.1) - Math.max(0, risk)));
        st.bonds.splice(i, 1);
        player.gold = _num(player.gold) + price;
        return { success: true, amount: price, text: `The brokers buy your ${b.kingdomName || 'royal'} bond for ${price}g.` };
    },

    // ──────────── THE DAILY TICK ────────────

    /**
     * One day of money: the houses' yields and events, deposit interest, the
     * player's loan payments and what follows a missed one, bond coupons, the
     * crowns' war chests, debts and crises, the debtors' prison.
     * → { notices: [{ icon, title, text, type }], paid, defaulted }
     */
    processDay(world, player) {
        const out = { notices: [], paid: 0, defaulted: [] };
        if (!world || !player || !Array.isArray(world.kingdoms)) return out;
        const st = Finance.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        if (!st.initialized) Finance._initBanks(world, st);
        Finance.migrateLegacyLoans(player, world);
        Utils.withRng(Finance._dayRng(world), () => Finance._tick(world, player, st, out));
        return out;
    },

    /** Today's finance dice: a seeded stream from the world seed and the day. */
    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:finance:${_day(world)}`) % 233279) + 1);
    },

    _note(out, icon, title, text, type = 'info') {
        out.notices.push({ icon, title, text, type });
    },

    _record(st, world, rec) {
        const day = _day(world);
        st.history.push({ ...rec, day, key: `fin:${rec.kind}:${day}:${rec.bankId || rec.kingdomId || ''}` });
        const cap = Math.max(10, _num(Finance.config().history, 60));
        if (st.history.length > cap) st.history.splice(0, st.history.length - cap);
    },

    _tick(world, player, st, out) {
        const day = _day(world);
        Finance._banksDay(world, player, st, out);
        Finance._depositsDay(world, player, st, out);
        Finance.processLoans(world, player, out);
        Finance._bondsDay(world, player, st, out);
        Finance._crownsDay(world, player, st, out);
        Finance._eventsDay(world, player, st, out);
        Finance._prisonDay(world, player, st, out);
        Finance._refoundDay(world, player, st, day);
    },

    _banksDay(world, player, st, out) {
        const day = _day(world);
        const B = Finance.cfg('banks');
        const yd = Finance.yearDays();
        for (const bank of st.banks) {
            if (bank.status !== 'open') continue;
            // The house's own lending to merchants earns its yield
            if (bank.capital > 0) bank.capital = _round2(bank.capital * (1 + _num(B.yield, 0.07) / yd));
            if (bank.panic && _num(bank.panic.until) < day) Finance._endPanic(world, player, st, bank, out);
        }
    },

    _depositsDay(world, player, st, out) {
        const yd = Finance.yearDays();
        for (const [id, acct] of Object.entries(st.accounts)) {
            const bank = Finance.bank(player, id);
            if (!bank || bank.status !== 'open' || !acct) continue;
            const interest = _num(acct.balance) * Finance.depositApr(bank) / yd;
            if (interest <= 0) continue;
            acct.balance = _round2(_num(acct.balance) + interest);
            acct.interest = _round2(_num(acct.interest) + interest);
            st.stats.interestEarned = _round2(_num(st.stats.interestEarned) + interest);
        }
    },

    /**
     * The day's loan payments. A missed day adds a late fee and a day to the
     * term; long arrears bring bailiffs, seizures and finally a default.
     * Returns { paid, defaulted } (and fills `out` when given).
     */
    processLoans(world, player, out = null) {
        const res = out || { notices: [], paid: 0, defaulted: [] };
        const st = Finance.state(player);
        const L = Finance.cfg('loans');
        const D = Finance.cfg('default');
        for (const loan of st.loans.slice()) {
            loan.daysTaken = _num(loan.daysTaken) + 1;
            const pay = Math.min(_num(loan.dailyPayment), Math.ceil(_num(loan.totalOwed)));
            if (_num(player.gold) >= pay) {
                player.gold -= pay;
                loan.totalOwed = Math.max(0, _num(loan.totalOwed) - pay);
                loan.totalPaid = _num(loan.totalPaid) + pay;
                loan.remainingDays = Math.max(1, _num(loan.remainingDays) - 1);
                loan.overdue = 0;
                res.paid += pay;
                st.credit.onTime++;
                Finance._payLender(player, world, loan, pay);
                if (loan.totalOwed <= 0) {
                    Finance._closeLoan(st, loan);
                    st.credit.repaid++;
                    st.stats.interestPaid += Math.max(0, _num(loan.totalPaid) - _num(loan.principal));
                    Finance._note(res, '✅', 'Loan Repaid', `Your loan from ${Finance._lenderName(player, world, loan)} is paid off.`, 'success');
                }
                continue;
            }
            // Missed
            loan.missed = _num(loan.missed) + 1;
            loan.overdue = _num(loan.overdue) + 1;
            loan.remainingDays = _num(loan.remainingDays) + 1;
            loan.totalOwed = Math.ceil(_num(loan.totalOwed) + _num(loan.dailyPayment) * _num(L.lateFeeShare, 0.25));
            st.credit.missed++;
            res.defaulted.push({ ...loan });
            const lender = Finance._lenderName(player, world, loan);
            if (loan.overdue === 1) Finance._note(res, '⚠️', 'Loan Payment Missed', `You could not pay ${lender} today: a late fee is added. Keep missing and the bailiffs come.`, 'warning');
            if (loan.overdue === _num(D.bailiffsAt, 7)) Finance._bailiffs(world, player, st, loan, res);
            const seizeAt = _num(D.seizeAt, 14);
            if (loan.overdue >= seizeAt && (loan.overdue - seizeAt) % Math.max(1, _num(D.seizeEvery, 7)) === 0) Finance._seize(world, player, st, loan, res);
            if (st.loans.includes(loan) && loan.overdue >= _num(D.declareAt, 30)) Finance._declareDefault(world, player, st, loan, res);
        }
        return res;
    },

    _closeLoan(st, loan) {
        const i = st.loans.indexOf(loan);
        if (i >= 0) st.loans.splice(i, 1);
    },

    _repHit(player, kingdomId, amount) {
        if (!player.reputation || kingdomId == null || !amount) return;
        player.reputation[kingdomId] = Math.max(-100, _num(player.reputation[kingdomId]) - amount);
    },

    /** Apply proceeds of a seizure or sale to a loan; closes it if cleared. */
    _applyProceeds(player, world, st, loan, proceeds) {
        proceeds = Math.max(0, Math.floor(proceeds));
        if (!proceeds) return 0;
        const used = Math.min(proceeds, Math.ceil(_num(loan.totalOwed)));
        loan.totalOwed = Math.max(0, _num(loan.totalOwed) - used);
        Finance._payLender(player, world, loan, used);
        st.stats.seized += used;
        if (loan.totalOwed <= 0) {
            Finance._closeLoan(st, loan);
            loan.overdue = 0;
        }
        return used;
    },

    /** Bailiffs: goods taken from the packs, sold at a fraction of their worth. */
    _bailiffs(world, player, st, loan, out) {
        const D = Finance.cfg('default');
        const share = _num(D.goodsSaleShare, 0.5);
        const target = Math.ceil(_num(loan.totalOwed));
        const inv = player.inventory || {};
        const taken = [];
        let raised = 0;
        const items = Object.keys(inv).filter(id => id !== 'gold' && _num(inv[id]) > 0 && PlayerInventory.goodValue(id) > 0)
            .sort((a, b) => PlayerInventory.goodValue(b) - PlayerInventory.goodValue(a) || a.localeCompare(b));
        for (const id of items) {
            if (raised >= target) break;
            const unit = PlayerInventory.goodValue(id) * share;
            const qty = Math.min(_num(inv[id]), Math.ceil((target - raised) / Math.max(0.01, unit)));
            if (qty <= 0) continue;
            inv[id] -= qty;
            if (inv[id] <= 0) delete inv[id];
            raised += qty * unit;
            taken.push(`${qty} ${id}`);
        }
        Finance._repHit(player, loan.kingdomId, _num(D.bailiffRep, 3));
        const lender = Finance._lenderName(player, world, loan);
        const used = Finance._applyProceeds(player, world, st, loan, raised);
        Finance._note(out, '🧾', 'Bailiffs!', taken.length
            ? `The bailiffs of ${lender} took ${taken.join(', ')} from your packs (${used}g against the debt).`
            : `The bailiffs of ${lender} came for your goods and found nothing worth taking. Your collateral is next.`, 'error');
    },

    /** Seize collateral: deposits with the lender, then a property, a docked ship, company capital. */
    _seize(world, player, st, loan, out) {
        const D = Finance.cfg('default');
        const share = _num(D.collateralSaleShare, 0.5);
        const lender = Finance._lenderName(player, world, loan);
        // Set-off: the house takes what the player keeps with it
        const acct = st.accounts[loan.bankId];
        if (acct && _num(acct.balance) > 0) {
            const take = Math.min(_num(acct.balance), Math.ceil(_num(loan.totalOwed)));
            acct.balance = _round2(_num(acct.balance) - take);
            if (acct.balance < 0.01) delete st.accounts[loan.bankId];
            const bank = Finance.bank(player, loan.bankId);
            if (bank) bank.capital -= take; // the deposit leaves the house's books as it repays the loan
            Finance._applyProceeds(player, world, st, loan, take);
            Finance._note(out, '🏦', 'Deposits Seized', `${lender} took ${Math.floor(take)}g of your deposits against your debt.`, 'error');
            if (!st.loans.includes(loan)) return;
        }
        // A property (the most valuable)
        const props = (player.properties || []).slice().sort((a, b) => Finance._propertyValue(b) - Finance._propertyValue(a));
        if (props.length) {
            const prop = props[0];
            Finance._removeProperty(player, world, prop);
            const used = Finance._applyProceeds(player, world, st, loan, Finance._propertyValue(prop) * share);
            Finance._note(out, '🏚️', 'Property Seized', `${lender} seized your ${prop.name || prop.type} at (${prop.q}, ${prop.r}) and sold it for ${used}g against the debt.`, 'error');
            return;
        }
        // A ship lying in port (never the one you stand on)
        const ships = (player.ships || []).filter(s => s && s.status === 'docked' && s.id !== player.boardedShip)
            .sort((a, b) => _num(Ships.getShipValue(b)) - _num(Ships.getShipValue(a)));
        if (ships.length) {
            const ship = ships[0];
            player.ships = player.ships.filter(s => s !== ship);
            const used = Finance._applyProceeds(player, world, st, loan, _num(Ships.getShipValue(ship)) * share);
            Finance._note(out, '⚓', 'Ship Seized', `${lender} seized the ${ship.name || 'ship'} in port and sold her for ${used}g against the debt.`, 'error');
            return;
        }
        // The company's capital
        const c = MerchantHouses.company(player);
        if (c && _num(c.capital) > 0) {
            const take = Math.min(_num(c.capital), Math.ceil(_num(loan.totalOwed)));
            c.capital -= take;
            const used = Finance._applyProceeds(player, world, st, loan, take);
            Finance._note(out, '⚖️', 'Company Funds Seized', `${lender} took ${used}g from the coffers of ${c.name}.`, 'error');
            return;
        }
        Finance._note(out, '⚠️', 'Nothing Left to Seize', `${lender} found nothing more to take. Pay, or be declared a defaulter at ${_num(D.declareAt, 30)} days overdue.`, 'error');
    },

    _removeProperty(player, world, prop) {
        player.properties = (player.properties || []).filter(p => p !== prop);
        const tile = world && world.getTile ? world.getTile(prop.q, prop.r) : null;
        if (!tile) return;
        if (Array.isArray(tile.playerProperties)) {
            const idx = tile.playerProperties.findIndex(p => p && (p.type === prop.type || p.id === prop.type));
            if (idx !== -1) tile.playerProperties.splice(idx, 1);
            if (tile.playerProperties.length > 0) tile.playerProperty = tile.playerProperties[0];
            else { tile.playerProperty = null; tile.playerProperties = null; }
        } else {
            tile.playerProperty = null;
        }
    },

    /** The debt is written off and the player is a defaulter. */
    _declareDefault(world, player, st, loan, out) {
        const D = Finance.cfg('default');
        const day = _day(world);
        const remaining = Math.ceil(_num(loan.totalOwed));
        const lender = Finance._lenderName(player, world, loan);
        Finance._closeLoan(st, loan);
        st.credit.defaults++;
        st.credit.lastDefaultDay = day;
        st.blacklist[loan.bankId] = _num(st.blacklist[loan.bankId]) + remaining;
        Finance._repHit(player, loan.kingdomId, _num(D.declareRep, 15));
        let prestige = 0;
        if (player.house) {
            prestige = Math.min(House.getPrestige(player), Math.round(_num(D.prestigeBase, 20) + remaining * _num(D.prestigePerGold, 0.005)));
            if (prestige > 0) House.spend(player.house, prestige, `defaulted on ${lender}`, day);
        }
        const k = _kingdom(world, loan.kingdomId);
        const realm = k ? k.name : 'the realm';
        let extra = '';
        if (remaining >= _num(D.bountyAt, 1500) && loan.kingdomId != null) {
            Gossip.initializePlayer(player);
            player.gossip.bounties = player.gossip.bounties.filter(b => !(b.kingdom === loan.kingdomId && b.description === 'debt'));
            player.gossip.bounties.push({ rumorId: null, kingdom: loan.kingdomId, gold: Math.min(_num(D.bountyMax, 3000), Math.round(remaining * _num(D.bountyShare, 0.25))), issuedDay: day, description: 'debt' });
            extra += ` A price is on your head in ${realm}.`;
        }
        if (remaining >= _num(D.prisonAt, 4000) && loan.kingdomId != null) {
            st.wanted[loan.kingdomId] = { amount: remaining, bankId: loan.bankId, day };
            extra += ` The debtors' prison waits for you in its towns.`;
        }
        out.defaulted.push({ ...loan, declared: true, remaining });
        Finance._record(st, world, { kind: 'player_default', bankId: loan.bankId, kingdomId: loan.kingdomId, lender, amount: remaining });
        Finance._note(out, '💀', 'Declared a Defaulter', `${lender} writes off ${remaining}g and names you a defaulter. Reputation in ${realm} -${_num(D.declareRep, 15)}${prestige ? `, Prestige -${prestige}` : ''}.${extra}`, 'error');
    },

    /** Make good a written-off debt: the house lends again and the warrant lapses. */
    settleDefault(player, world, bankId) {
        const st = Finance.state(player);
        const owed = Math.ceil(_num(st.blacklist[bankId]));
        if (!owed) return { success: false, reason: 'You owe that house nothing.' };
        if (_num(player.gold) < owed) return { success: false, reason: `Need ${owed} gold.` };
        player.gold -= owed;
        delete st.blacklist[bankId];
        const bank = Finance.bank(player, bankId);
        if (bank) bank.capital = _num(bank.capital) + owed;
        const kid = bank ? bank.kingdomId : (String(bankId).startsWith(CROWN_LENDER) ? String(bankId).slice(CROWN_LENDER.length) : null);
        if (kid != null) {
            if (st.wanted[kid] && st.wanted[kid].bankId === bankId) delete st.wanted[kid];
            if (player.gossip && Array.isArray(player.gossip.bounties)) player.gossip.bounties = player.gossip.bounties.filter(b => !(b.kingdom === kid && b.description === 'debt'));
            const k = _kingdom(world, kid);
            if (k && !bank) k.treasury = _num(k.treasury) + owed; // owed to the realm's exchequer
        }
        st.credit.settled++;
        return { success: true, amount: owed, text: `You make good ${owed}g of old debt${bank ? ` to ${bank.name}` : ''}. Your name is cleared.` };
    },

    _bondsDay(world, player, st, out) {
        const D = Finance.cfg('bonds');
        const day = _day(world);
        const every = Math.max(1, _num(D.couponEvery, 7));
        const yd = Finance.yearDays();
        for (const b of st.bonds.slice()) {
            const k = _kingdom(world, b.kingdomId);
            if (!k || k.isAlive === false) {
                st.bonds = st.bonds.filter(x => x !== b);
                st.stats.lostInFailures += _num(b.principal);
                Finance._note(out, '🏴', 'Bond Lost', `The crown of ${b.kingdomName || 'a fallen realm'} is no more, and your ${Math.round(b.principal)}g bond with it.`, 'error');
                continue;
            }
            if ((day - _num(b.start)) > 0 && (day - _num(b.start)) % every === 0) {
                const coupon = Math.floor(_num(b.principal) * _num(b.apr) / yd * every);
                if (coupon > 0 && _num(k.treasury) >= coupon) {
                    k.treasury -= coupon;
                    player.gold = _num(player.gold) + coupon;
                    b.coupons = _num(b.coupons) + coupon;
                    st.stats.couponsEarned += coupon;
                } else if (coupon > 0) {
                    b.missed = _num(b.missed) + 1;
                    Finance._note(out, '📉', 'Coupon Missed', `The crown of ${k.name} could not pay the interest on your bond.`, 'warning');
                }
            }
            if (day >= _num(b.maturity)) {
                const due = Math.floor(_num(b.principal));
                if (_num(k.treasury) >= due) {
                    k.treasury -= due;
                    player.gold = _num(player.gold) + due;
                    st.bonds = st.bonds.filter(x => x !== b);
                    Finance._note(out, '📜', 'Bond Redeemed', `The crown of ${k.name} repays your ${due}g bond (${Math.round(b.coupons)}g interest earned).`, 'success');
                } else {
                    b.maturity = day + _num(D.extendDays, 30);
                    b.missed = _num(b.missed) + 1;
                    Finance._note(out, '📉', 'Bond Extended', `The crown of ${k.name} cannot repay your bond and puts you off for ${_num(D.extendDays, 30)} days.`, 'warning');
                }
            }
        }
    },

    // ──────────── CROWNS ────────────

    /** What a crown can carry: capacityDays of its daily income. */
    crownCapacity(kingdom) {
        const C = Finance.cfg('crowns');
        const f = Finance._kf(kingdom);
        return Math.max(1000, _num(f.income) * _num(C.capacityDays, 25));
    },

    crownDebt(kingdom) {
        const f = kingdom && kingdom.finance;
        return f && Array.isArray(f.debt) ? f.debt.reduce((s, d) => s + _num(d.owed), 0) : 0;
    },

    /** A crown's yearly borrowing rate from a house. */
    crownApr(kingdom, bank, day) {
        const C = Finance.cfg('crowns');
        const f = Finance._kf(kingdom);
        let apr = _num(C.apr, 0.12) + Math.min(2, _num(f.debtRatio)) * _num(C.debtPremium, 0.1)
            + (1 - Coinage.purity(kingdom)) * _num(C.purityPremium, 0.2);
        if (f.lastDefaultDay != null && day - f.lastDefaultDay < _num(C.refuseAfterDefault, 240) * 2) apr += _num(C.defaultPremium, 0.1);
        return _round2(apr * (bank ? Finance.reserveFactor(bank) : 1) * 100) / 100;
    },

    /** Is the crown at war, or raising a wonder? (what it borrows for) */
    _crownNeed(world, k) {
        if (Array.isArray(k.wars) && k.wars.length) return 'war';
        const gw = world.greatWorks;
        if (gw && Array.isArray(gw.npc) && gw.npc.some(n => n && n.kingdomId === k.id)) return 'wonder';
        return null;
    },

    _crownsDay(world, player, st, out) {
        const C = Finance.cfg('crowns');
        const day = _day(world);
        const ruled = Finance._ruledId(player);
        const kingdoms = (world.kingdoms || []).filter(k => k && k.isAlive !== false && k.id != null)
            .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
        for (const k of kingdoms) {
            const f = Finance.kingdomState(k);
            const treasury = _num(k.treasury);
            // The crown's income: smoothed daily gain of the treasury before today's finance
            if (f.lastTreasury == null) {
                f.income = Math.max(_num(f.income), Math.round(_num(k.population) * _num(C.incomePerHead, 0.06)));
            } else {
                const a = _num(C.incomeSmoothing, 0.1);
                f.income = Math.round(f.income * (1 - a) + Math.max(0, treasury - f.lastTreasury) * a);
            }
            const need = Finance._crownNeed(world, k);
            const reserve = f.income * _num(C.reserveDays, 30);
            // War costs more than the realm brings in
            const spend = need === 'war' ? Math.round(f.income * _num(C.warBurn, 1.6)) : 0;
            if (need && k.id !== ruled && _num(k.treasury) - spend < reserve) {
                Finance._crownBorrow(world, player, st, k, reserve + spend * 7 - (_num(k.treasury) - spend), out);
            }
            if (spend > 0) {
                const paid = Math.min(Math.max(0, _num(k.treasury)), spend);
                k.treasury = _num(k.treasury) - paid;
                f.unpaid = paid < spend ? f.unpaid + 1 : Math.max(0, f.unpaid - 1);
            } else if (f.unpaid > 0) {
                f.unpaid--;
            }
            // Interest runs daily; the crown pays weekly
            for (const d of f.debt) d.owed = _round2(_num(d.owed) * (1 + _num(d.apr) / Finance.yearDays()));
            if (f.debt.length && day % Math.max(1, _num(C.serviceEvery, 7)) === 0) Finance._crownService(world, player, st, k, out);
            f.debtRatio = _round2(Finance.crownDebt(k) / Finance.crownCapacity(k));
            // An extraordinary levy fills the coffers while it lasts
            if (f.levy && _num(f.levy.until) >= day) k.treasury = _num(k.treasury) + Math.round(f.income * _num(f.levy.share, 0.3));
            else if (f.levy) f.levy = null;
            // Honest coin returns slowly once the crown is out of trouble
            const G = Finance.cfg('coinage');
            if (f.purity < 1 && f.debtRatio < _num(G.recoinMaxRatio, 0.3) && !f.levy) f.purity = Math.min(1, _round2((f.purity + _num(G.recoinPerDay, 0.001)) * 1000) / 1000);
            // Crisis: the crown chooses how to get out of it
            if (k.id !== ruled && day % 7 === 0
                && (f.missed >= _num(C.crisisMissed, 2) || f.unpaid >= _num(C.crisisUnpaid, 14) || f.debtRatio > _num(C.crisisRatio, 1.2))) {
                Finance._crownCrisis(world, player, st, k, out);
            }
            f.lastTreasury = _num(k.treasury);
        }
    },

    /** Borrow up to `want` from the friendliest house that will lend. */
    _crownBorrow(world, player, st, k, want, out, opts = {}) {
        const C = Finance.cfg('crowns');
        const B = Finance.cfg('banks');
        const f = Finance.kingdomState(k);
        const day = _day(world);
        if (!opts.force && f.lastDefaultDay != null && day - f.lastDefaultDay < _num(C.refuseAfterDefault, 240)) return null;
        const capRoom = Finance.crownCapacity(k) * _num(C.crisisRatio, 1.2) - Finance.crownDebt(k);
        const amount0 = Math.floor(Math.min(want, capRoom));
        if (amount0 < _num(C.minLoan, 2000)) return null;
        const lenders = st.banks.filter(b => b.status === 'open' && !Finance.inPanic(b, day) && _num(b.relations[k.id], 0) >= 0)
            .map(b => {
                const exposure = f.debt.filter(d => d.bankId === b.id).reduce((s, d) => s + _num(d.owed), 0);
                const liquid = _num(b.capital) - _num(b.baseCapital) * _num(B.crownReserveFloor, 0.6);
                return { b, room: Math.floor(Math.min(_num(b.capital) * _num(B.maxCrownShare, 0.45) - exposure, liquid)) };
            })
            .filter(x => x.room >= _num(C.minLoan, 2000))
            .sort((x, y) => _num(y.b.relations[k.id]) - _num(x.b.relations[k.id]) || y.room - x.room || x.b.id.localeCompare(y.b.id));
        if (!lenders.length) return null;
        const { b, room } = lenders[0];
        const amount = Math.min(amount0, room);
        const apr = Finance.crownApr(k, b, day);
        b.capital -= amount;
        k.treasury = _num(k.treasury) + amount;
        f.debt.push({ id: `D${st.nextId++}`, bankId: b.id, principal: amount, owed: amount, apr, day });
        f.borrowed = _num(f.borrowed) + amount;
        f.debtRatio = _round2(Finance.crownDebt(k) / Finance.crownCapacity(k));
        return { bank: b, amount, apr };
    },

    _crownService(world, player, st, k, out) {
        const C = Finance.cfg('crowns');
        const f = Finance.kingdomState(k);
        const reserve = f.income * _num(C.reserveDays, 30);
        let missed = false;
        for (const d of f.debt.slice()) {
            const bank = Finance.bank(player, d.bankId);
            const rich = _num(k.treasury) - _num(d.owed) > reserve * _num(C.repayAllAt, 3);
            const pay = Math.ceil(rich ? _num(d.owed) : Math.min(_num(d.owed), Math.max(_num(d.owed) * _num(C.serviceShare, 0.08), 1)));
            if (_num(k.treasury) >= pay) {
                k.treasury -= pay;
                d.owed = _round2(_num(d.owed) - pay);
                if (bank) {
                    bank.capital = _num(bank.capital) + pay;
                    bank.relations[k.id] = Math.min(100, _num(bank.relations[k.id]) + _num(C.servicedRelation, 1));
                }
                if (d.owed < 1) f.debt = f.debt.filter(x => x !== d);
            } else {
                missed = true;
                if (bank) bank.relations[k.id] = Math.max(-100, _num(bank.relations[k.id]) - _num(C.missedRelation, 5));
            }
        }
        f.missed = missed ? f.missed + 1 : 0;
    },

    /** A crown in trouble: an extraordinary levy, debased coin, or a default. */
    _crownCrisis(world, player, st, k, out) {
        const C = Finance.cfg('crowns');
        const G = Finance.cfg('coinage');
        const f = Finance.kingdomState(k);
        const day = _day(world);
        const w = { ...(C.choices || { levy: 3, debase: 3, default: 2 }) };
        if (f.levy) w.levy = 0;
        if (f.purity - _num(G.debaseStep, 0.1) < _num(G.floor, 0.5) - 1e-9) w.debase = 0;
        if (!f.debt.length) w.default = 0;
        if (_num(k.stability, 50) < 30) w.levy = _num(w.levy) * 0.3;
        const total = Object.values(w).reduce((s, v) => s + Math.max(0, _num(v)), 0);
        if (total <= 0) return null;
        let roll = Utils.random() * total;
        let choice = 'levy';
        for (const [id, v] of Object.entries(w)) {
            roll -= Math.max(0, _num(v));
            if (roll < 0) { choice = id; break; }
        }
        if (choice === 'levy') Finance._levy(world, player, st, k, out);
        else if (choice === 'debase') Finance.debase(world, player, k, out);
        else Finance.crownDefault(world, player, k, out);
        f.missed = 0;
        f.unpaid = 0;
        return choice;
    },

    _levy(world, player, st, k, out) {
        const C = Finance.cfg('crowns');
        const f = Finance.kingdomState(k);
        const day = _day(world);
        f.levy = { until: day + _num(C.levyDays, 60), share: _num(C.levyShare, 0.3), day };
        Finance._record(st, world, { kind: 'levy', kingdomId: k.id, kingdom: k.name });
        if (Finance._touches(player, k)) Finance._note(out, '💰', 'A War Levy', `The crown of ${k.name}, deep in debt, raises an extraordinary levy. The realm grumbles.`, 'warning');
    },

    /** Clip the coin: gold for the mint now, dearer markets and less trust after. */
    debase(world, player, k, out = null) {
        const G = Finance.cfg('coinage');
        const C = Finance.cfg('crowns');
        const st = Finance.state(player);
        const f = Finance.kingdomState(k);
        const step = _num(G.debaseStep, 0.1);
        if (f.purity - step < _num(G.floor, 0.5) - 1e-9) return { success: false, reason: 'The coin is as base as it can be made.' };
        const day = _day(world);
        f.purity = _round2(f.purity - step);
        f.debasements++;
        f.lastDebaseDay = day;
        const gain = Math.round(Math.max(_num(f.income), 200) * _num(G.mintDays, 15));
        k.treasury = _num(k.treasury) + gain;
        for (const b of st.banks) if (b.relations && b.relations[k.id] != null) b.relations[k.id] = Math.max(-100, b.relations[k.id] - _num(C.debaseRelation, 10));
        Finance._record(st, world, { kind: 'debased', kingdomId: k.id, kingdom: k.name, purity: f.purity });
        const text = `The mint of ${k.name} clips its coin to ${Math.round(f.purity * 100)}% silver: ${gain}g for the crown, and prices in its markets rise ${Math.round((Coinage.priceMultiplier(world, { kingdom: k.id }) - 1) * 100)}%.`;
        if (out && Finance._touches(player, k)) Finance._note(out, '💱', 'Coin Debased', text, 'warning');
        return { success: true, gain, purity: f.purity, text };
    },

    /** The crown repudiates (part of) its debts: its lenders take the loss. */
    crownDefault(world, player, k, out = null, share = null) {
        const C = Finance.cfg('crowns');
        const st = Finance.state(player);
        const f = Finance.kingdomState(k);
        const day = _day(world);
        const cut = share != null ? share : _between(C.defaultShare || [0.5, 1], Utils.random());
        let total = 0;
        const hit = new Map();
        for (const d of f.debt.slice()) {
            const loss = Math.round(_num(d.owed) * cut);
            d.owed = _round2(_num(d.owed) - loss);
            total += loss;
            hit.set(d.bankId, _num(hit.get(d.bankId)) + loss);
            if (d.owed < 1) f.debt = f.debt.filter(x => x !== d);
        }
        f.defaults++;
        f.lastDefaultDay = day;
        f.debtRatio = _round2(Finance.crownDebt(k) / Finance.crownCapacity(k));
        k.stability = Math.max(0, _num(k.stability, 50) - _num(C.defaultStability, 10));
        const run = Finance.event('bank_run');
        for (const [bankId, loss] of hit) {
            const b = Finance.bank(player, bankId);
            if (!b) continue;
            const before = Math.max(1, _num(b.capital));
            b.capital -= loss;
            b.relations[k.id] = Math.max(-100, _num(b.relations[k.id]) - _num(C.defaultRelation, 60));
            if (b.status === 'open' && (b.capital <= 0 || loss / before >= _num(C.runIfLossShare, 0.25)) && run) Finance._startRun(world, player, st, b, out, `the default of ${k.name}`);
        }
        // Bondholders share the loss
        let bondLoss = 0;
        for (const b of st.bonds) {
            if (b.kingdomId !== k.id) continue;
            const loss = Math.floor(_num(b.principal) * cut);
            b.principal -= loss;
            b.haircut = _num(b.haircut) + loss;
            bondLoss += loss;
        }
        st.bonds = st.bonds.filter(b => _num(b.principal) >= 1);
        st.stats.lostInFailures += bondLoss;
        Finance._record(st, world, { kind: 'crown_default', kingdomId: k.id, kingdom: k.name, amount: total });
        const text = `The crown of ${k.name} repudiates ${Math.round(cut * 100)}% of its debts (${total}g).${bondLoss ? ` Your bonds lose ${bondLoss}g.` : ''}`;
        if (out && (bondLoss || Finance._touches(player, k))) Finance._note(out, '📛', 'A Crown Defaults', text, bondLoss ? 'error' : 'warning');
        return { success: true, amount: total, bondLoss, text };
    },

    /** Does news of this realm concern the player (they are in it, hold its bonds, or rule it)? */
    _touches(player, k) {
        if (!player || !k) return false;
        if (Finance._ruledId(player) === k.id) return true;
        const st = player.finance;
        if (st && Array.isArray(st.bonds) && st.bonds.some(b => b.kingdomId === k.id)) return true;
        return player.allegiance === k.id;
    },

    // ── The player as ruler: the crown's purse ──

    /** The kingdom the player rules, if any. */
    ruledKingdom(player, world) {
        const id = Finance._ruledId(player);
        return id != null ? _kingdom(world, id) : null;
    },

    /** Borrow for your own crown from the friendliest house. */
    royalBorrow(player, world, amount) {
        const k = Finance.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const res = Finance._crownBorrow(world, player, Finance.state(player), k, Math.floor(_num(amount)), null, { force: false });
        if (!res) return { success: false, reason: 'No house will lend the crown so much now.' };
        return { success: true, ...res, text: `${res.bank.name} lends the crown ${res.amount}g at ${(res.apr * 100).toFixed(1)}% a year.` };
    },

    royalDebase(player, world) {
        const k = Finance.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        return Finance.debase(world, player, k, null);
    },

    royalDefault(player, world) {
        const k = Finance.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        if (!Finance.kingdomState(k).debt.length) return { success: false, reason: 'The crown owes nothing.' };
        return Finance.crownDefault(world, player, k, null, 1);
    },

    // ──────────── EVENTS: runs, losses, seizures, silver ────────────

    _eventsDay(world, player, st, out) {
        const day = _day(world);
        const run = Finance.event('bank_run');
        const venture = Finance.event('venture_loss');
        const seizure = Finance.event('royal_seizure');
        const silver = Finance.event('silver_find');
        for (const b of st.banks.slice()) {
            if (b.status !== 'open') continue;
            const ratio = Finance.reserveRatio(b);
            if (run && !Finance.inPanic(b, day)) {
                let chance = _num(run.chance);
                if (ratio < _num(run.lowReserveAt, 0.5)) chance += _num(run.lowReserveChance, 0.01) * (1 - ratio / Math.max(0.01, _num(run.lowReserveAt, 0.5)));
                if (Utils.random() < chance) Finance._startRun(world, player, st, b, out, null);
            }
            if (venture && Utils.random() < _num(venture.chance)) {
                const loss = Math.round(Math.max(0, _num(b.capital)) * _between(venture.loss || [0.1, 0.25], Utils.random()));
                b.capital -= loss;
                Finance._record(st, world, { kind: 'venture_loss', bankId: b.id, bank: b.name, amount: loss });
                if (Finance._exposed(player, b)) Finance._note(out, venture.icon || '🌊', venture.name || 'A venture lost', Finance._fill(venture.text, { bank: b.name, place: b.seat }), 'warning');
            }
            const k = _kingdom(world, b.kingdomId);
            if (seizure && k && k.isAlive !== false && k.id !== Finance._ruledId(player)) {
                const f = Finance.kingdomState(k);
                const atWar = Array.isArray(k.wars) && k.wars.length > 0;
                if ((!seizure.needsWar || atWar) && _num(f.debtRatio) >= _num(seizure.needsCrisis, 0.8) && Utils.random() < _num(seizure.chance)) {
                    const amount = Math.round(Math.max(0, _num(b.capital)) * _between(seizure.share || [0.2, 0.4], Utils.random()));
                    b.capital -= amount;
                    k.treasury = _num(k.treasury) + amount;
                    b.relations[k.id] = Math.max(-100, _num(b.relations[k.id]) - _num(seizure.relation, 50));
                    Finance._record(st, world, { kind: 'royal_seizure', bankId: b.id, bank: b.name, kingdomId: k.id, kingdom: k.name, amount });
                    if (Finance._exposed(player, b) || Finance._touches(player, k)) {
                        Finance._note(out, seizure.icon || '👑', seizure.name || 'Royal seizure', Finance._fill(seizure.text, { bank: b.name, kingdom: k.name, amount }), 'warning');
                    }
                    if (run && !Finance.inPanic(b, day)) Finance._startRun(world, player, st, b, out, `the seizure by ${k.name}`);
                }
            }
            if (b.status === 'open' && _num(b.capital) <= 0 && !Finance.inPanic(b, day) && run) Finance._startRun(world, player, st, b, out, 'empty vaults');
        }
        if (silver) {
            for (const k of (world.kingdoms || []).filter(x => x && x.isAlive !== false && x.finance && x.finance.purity < 1)) {
                if (Utils.random() >= _num(silver.chance)) continue;
                const f = Finance.kingdomState(k);
                f.purity = Math.min(1, _round2(f.purity + _num(silver.purity, 0.1)));
                Finance._record(st, world, { kind: 'silver_find', kingdomId: k.id, kingdom: k.name, purity: f.purity });
                if (Finance._touches(player, k)) Finance._note(out, silver.icon || '⛏️', silver.name || 'New silver', Finance._fill(silver.text, { kingdom: k.name }), 'success');
            }
        }
    },

    _fill(text, tokens) {
        return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null ? tokens[k] : m));
    },

    /** Does the player have money with this house (deposits) or owe it? */
    _exposed(player, bank) {
        const st = player && player.finance;
        if (!st) return false;
        return _num(st.accounts[bank.id] && st.accounts[bank.id].balance) > 0 || st.loans.some(l => l.bankId === bank.id);
    },

    _startRun(world, player, st, bank, out, cause) {
        const run = Finance.event('bank_run');
        if (!run || bank.status !== 'open') return;
        const day = _day(world);
        bank.panic = { since: day, until: day + _num(run.days, 10), cause: cause || null, paid: 0, paidDay: null };
        Finance._record(st, world, { kind: 'bank_run', bankId: bank.id, bank: bank.name, kingdomId: bank.kingdomId, place: bank.seat });
        if (out && Finance._exposed(player, bank)) {
            Finance._note(out, run.icon || '🏃', `${run.name || 'Run on the bank'}: ${bank.name}`,
                `${Finance._fill(run.text, { bank: bank.name, place: bank.seat })}${cause ? ` (after ${cause})` : ''} Withdrawals are rationed for ${_num(run.days, 10)} days.`, 'error');
        }
    },

    /** A run ends: the house survives (poorer) or fails. */
    _endPanic(world, player, st, bank, out) {
        const run = Finance.event('bank_run') || {};
        const ratio = Finance.reserveRatio(bank);
        bank.panic = null;
        const fail = _clamp(_num(run.failBase, 0.1) + (0.6 - ratio) * _num(run.failPerReserve, 0.8), _num(run.failMin, 0.02), _num(run.failMax, 0.9));
        if (_num(bank.capital) <= 0 || Utils.random() < fail) {
            Finance._fail(world, player, st, bank, out);
        } else {
            bank.capital = Math.round(_num(bank.capital) * (1 - _num(run.survivorLoss, 0.1)));
            if (Finance._exposed(player, bank)) Finance._note(out, '🏦', 'The House Stands', `${bank.name} weathered the run, poorer but open.`, 'info');
        }
    },

    _fail(world, player, st, bank, out) {
        const run = Finance.event('bank_run') || {};
        const day = _day(world);
        bank.status = 'failed';
        bank.failedDay = day;
        bank.panic = null;
        const acct = st.accounts[bank.id];
        let text = `${bank.name} of ${bank.seat} has failed. Its doors are shut and its receivers sell what is left.`;
        if (acct && _num(acct.balance) > 0) {
            const share = _between(run.recovery || [0.3, 0.6], Utils.random());
            const back = Math.floor(_num(acct.balance) * share);
            const lost = Math.round(_num(acct.balance) - back);
            player.gold = _num(player.gold) + back;
            st.stats.lostInFailures += lost;
            text += ` The receivers pay you ${back}g of your ${Math.floor(acct.balance)}g on deposit.`;
        }
        delete st.accounts[bank.id];
        Finance._record(st, world, { kind: 'bank_failed', bankId: bank.id, bank: bank.name, kingdomId: bank.kingdomId, place: bank.seat });
        Finance._note(out, '🏚️', 'A Banking House Fails', text, acct ? 'error' : 'warning');
    },

    /** A failed house's seat gets a new house after a while. */
    _refoundDay(world, player, st, day) {
        const B = Finance.cfg('banks');
        for (const b of st.banks.slice()) {
            if (b.status !== 'failed' || b.refounded || day - _num(b.failedDay) < _num(B.refoundDays, 90)) continue;
            b.refounded = true;
            const tile = world.getTile ? world.getTile(b.q, b.r) : null;
            const s = tile && tile.settlement;
            if (!s || s.kingdom == null) continue;
            const k = _kingdom(world, s.kingdom);
            if (!k || k.isAlive === false) continue;
            const nb = Finance._newBank(world, st, { q: b.q, r: b.r, name: s.name || b.seat, kingdom: s.kingdom, population: s.population });
            Finance._record(st, world, { kind: 'bank_founded', bankId: nb.id, bank: nb.name, kingdomId: nb.kingdomId, place: nb.seat });
        }
    },

    // ──────────── DEBTORS' PRISON ────────────

    _prisonDay(world, player, st, out) {
        const D = Finance.cfg('default');
        if (player.jailState) return;
        const tile = Finance._here(player, world);
        const s = tile && tile.settlement;
        if (!s || s.kingdom == null) return;
        const w = st.wanted[s.kingdom];
        if (!w) return;
        if (Utils.random() >= _num(D.arrestChance, 0.2)) return;
        const days = Math.min(_num(D.prisonMaxDays, 20), Math.max(1, Math.round(_num(D.prisonBaseDays, 5) + _num(w.amount) / 1000 * _num(D.prisonDaysPer1000, 1))));
        player.jailState = {
            daysRemaining: days, totalDays: days, offense: 'unpaid debts', offenseNumber: 1,
            settlement: s.name || 'the town', bailCost: Math.round(_num(w.amount) * _num(D.prisonBailShare, 0.15)),
            escapeChance: 0.08 + _num(player.skills && player.skills.stealth) * 0.03,
        };
        player.stamina = 0;
        player.movementRemaining = 0;
        delete st.wanted[s.kingdom];
        Finance._note(out, '⛓️', "Debtors' Prison", `The watch of ${s.name || 'the town'} knows your face: you are thrown into the debtors' prison for ${days} days.`, 'error');
    },

    // ──────────── READERS ────────────

    /** A one-glance summary for panels and the counsel. */
    summary(player, world) {
        const st = Finance.state(player);
        const report = Finance.creditReport(player, world);
        const dailyDue = st.loans.reduce((s, l) => s + _num(l.dailyPayment), 0);
        return {
            deposits: Math.floor(Finance.totalDeposits(player)), debt: report.debt, dailyDue,
            bonds: st.bonds.reduce((s, b) => s + _num(b.principal), 0), loans: st.loans.length,
            overdue: st.loans.filter(l => _num(l.overdue) > 0).length, score: report.score, band: report.band, label: report.label,
            banks: Finance.openBanks(player).length,
        };
    },

    /** Loans at risk: [{ loan, lender, overdue, next: 'bailiffs'|'seizure'|'default', inDays }]. */
    atRisk(player, world) {
        const st = player && player.finance;
        if (!st || !Array.isArray(st.loans)) return [];
        const D = Finance.cfg('default');
        const out = [];
        for (const l of st.loans) {
            const o = _num(l.overdue);
            if (o <= 0) continue;
            const steps = [['bailiffs', _num(D.bailiffsAt, 7)], ['seizure', _num(D.seizeAt, 14)], ['default', _num(D.declareAt, 30)]];
            const next = steps.find(([, at]) => o < at) || ['default', _num(D.declareAt, 30)];
            out.push({ loan: l, lender: Finance._lenderName(player, world, l), overdue: o, next: next[0], inDays: Math.max(0, next[1] - o) });
        }
        return out.sort((a, b) => a.inDays - b.inDays);
    },

    /** A realm's money at a glance: { purity, priceMult, debt, ratio, levy, defaults, trust }. */
    realmReport(world, kingdom) {
        if (!kingdom) return null;
        const f = kingdom.finance || {};
        const day = _day(world);
        return {
            purity: Coinage.purity(kingdom), priceMult: Coinage.priceMultiplier(world, { kingdom: kingdom.id }),
            debt: Math.round(Finance.crownDebt(kingdom)), ratio: _num(f.debtRatio), income: _num(f.income),
            levy: !!(f.levy && _num(f.levy.until) >= day), defaults: _num(f.defaults), trust: Coinage.trust(kingdom, day),
            lastDefaultDay: f.lastDefaultDay != null ? f.lastDefaultDay : null,
        };
    },

    /** Recent money news within `days` (the heralds and chatter read finance.history directly). */
    recent(player, world, days = 30) {
        const st = player && player.finance;
        const day = _day(world);
        return st && Array.isArray(st.history) ? st.history.filter(h => h && day - _num(h.day) <= days) : [];
    },
};

// ============================================
// BANKING — the loan catalogue, and the old royal-bank calls kept as a
// thin facade over Finance (re-exported from marketDynamics.js)
// ============================================

export const Banking = {
    /** Fallback loan catalogue, used only when data/market.json has no loanOptions. */
    DEFAULT_LOAN_OPTIONS: [
        { id: 'small', name: 'Small Loan', amount: 500, interestRate: 0.10, duration: 30 },
        { id: 'medium', name: 'Medium Loan', amount: 2000, interestRate: 0.15, duration: 60 },
        { id: 'large', name: 'Large Loan', amount: 5000, interestRate: 0.20, duration: 90 },
    ],

    /** Loan catalogue from data/market.json (set by DataLoader). */
    _loanOptions: null,

    catalogue() {
        return Array.isArray(this._loanOptions) && this._loanOptions.length > 0 ? this._loanOptions : this.DEFAULT_LOAN_OPTIONS;
    },

    /**
     * The catalogue with a rough availability (gold × 2 + 500 a property);
     * the banking houses price and gate the real offers (Finance.loanOffers).
     */
    getLoanOptions(player, kingdomId) {
        const maxLoan = Math.floor(_num(player && player.gold) * 2 + ((player && player.properties && player.properties.length) || 0) * 500);
        return this.catalogue().map(opt => ({ ...opt, available: maxLoan >= opt.amount, kingdomId }));
    },

    /** Borrow from a house of that realm that serves the player here (see Finance.takeLoan). */
    takeLoan(player, loanType, kingdomId, world = null) {
        if (!world) return { success: false, reason: 'Visit a banking house to borrow.' };
        const here = Finance.banksAt(player, world, Finance._here(player, world));
        const bank = here.find(b => b.kingdomId === kingdomId) || here[0];
        if (!bank) return { success: false, reason: 'Visit a banking house to borrow.' };
        return Finance.takeLoan(player, world, bank.id, loanType);
    },

    /** The day's loan payments (Finance.processDay runs these as part of its tick). */
    processLoans(player, world) {
        Finance.migrateLegacyLoans(player, world);
        const res = Finance.processLoans(world, player);
        return { paid: res.paid, defaulted: res.defaulted };
    },

    repayLoan(player, loanId, world = null) {
        return Finance.repayLoan(player, world, loanId);
    },
};
