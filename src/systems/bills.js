// ============================================
// BILLS OF EXCHANGE — gold paid in at one house, paid out at another
// ============================================
// Carrying a fortune on the road is asking to lose it: anyone robbed without
// an army loses 15–40% of the gold they carry (ui/game/combat.logic.js). A
// bill of exchange carries the money instead: pay gold into one banking
// house (systems/finance.js) at its seat or a branch, and it draws a bill on
// another house, payable at that house's seat or any of its branches.
//   - The fee rises with the distance between the two houses' seats
//     (data/bourse.json → bills). The gold moves between the houses at once:
//     the paying house holds it until the bill is presented.
//   - A bill is payable "at N days' sight" (the distance at a courier's pace)
//     and should be presented within validDays; after that it is protested
//     and the house keeps a protest fee.
//   - Robbers take bills too. A stolen bill is worthless to them until a
//     forger can cash it (a few days); stop it first at a branch of the paying
//     house (a small fee) and the house pays you instead.
//   - A bill on a house that fails falls on the house that drew it; if that
//     one has failed too, the receivers pay what they can.
//   - The Thieves' Guild can forge a bill on a house: gold for nothing, if the
//     clerk does not see through it.
//
// Draws no RNG: thefts, forgers' days and forgery checks roll a hash of the
// seed, the day and the bill. State on player.bills (saved with the player).

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Finance } from './finance.js';
import { Underworld } from './underworld.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function _day(world) {
    return world && Number.isFinite(world.day) ? world.day : 0;
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

function _roll(world, key) {
    return (_hash(`${_seed(world)}|bills|${key}`) % 100000) / 100000;
}

const DEFAULTS = {
    base: 0.006, perHex: 0.0003, maxFee: 0.04, minFee: 5, minAmount: 200, maxHeld: 8,
    usanceHexes: 8, validDays: 120, protestFee: 0.05,
    stealChance: 0.5, cashDays: [3, 8], stopFee: 0.02, recovery: [0.3, 0.6],
    forgery: { minRank: 2, fee: 0.25, max: 2500, caught: 0.45, perRank: 0.05, perForgery: 0.1, cooldown: 30, heat: 30, fineMult: 1 },
};

let _cfgSrc;
let _cfg = null;

export const Bills = {
    config() {
        const gd = DataLoader._gamedata;
        const src = _obj(gd && gd.bourse && gd.bourse.bills);
        if (_cfg && _cfgSrc === src) return _cfg;
        _cfgSrc = src;
        const o = src || {};
        _cfg = { ...DEFAULTS, ...o, forgery: { ...DEFAULTS.forgery, ...(_obj(o.forgery) || {}) } };
        return _cfg;
    },

    _blank() {
        return { list: [], nextId: 1, forgeries: [], stats: { drawn: 0, fees: 0, paidOut: 0, stolen: 0, stopped: 0, lost: 0, forged: 0, forgeriesCaught: 0 } };
    },

    state(player) {
        if (!player) return Bills._blank();
        let st = player.bills;
        if (!_obj(st)) { player.bills = Bills._blank(); return player.bills; }
        if (!Array.isArray(st.list)) st.list = [];
        if (!Array.isArray(st.forgeries)) st.forgeries = [];
        if (!(st.nextId > 0)) st.nextId = st.list.length + 1;
        st.stats = { ...Bills._blank().stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && player.bills ? JSON.parse(JSON.stringify(player.bills)) : null;
    },

    loadState(player) {
        if (!player || player.bills == null) return null;
        return Bills.state(player);
    },

    /** Bills the player holds (or has had stolen and not yet lost). */
    held(player) {
        const st = player && player.bills;
        return st && Array.isArray(st.list) ? st.list.filter(b => b && (b.status === 'held' || b.status === 'stolen')) : [];
    },

    /** Gold held in bills (good ones only). */
    total(player) {
        return Bills.held(player).filter(b => b.status === 'held').reduce((a, b) => a + _num(b.amount), 0);
    },

    _distance(world, a, b) {
        if (!a || !b) return 0;
        return Hex.wrappingDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
    },

    /** The terms for a bill: { fee, rate, distance, usance }. */
    terms(player, world, fromBankId, payBankId, amount) {
        const C = Bills.config();
        const from = Finance.bank(player, fromBankId);
        const pay = Finance.bank(player, payBankId);
        const distance = Bills._distance(world, from, pay);
        const rate = Math.min(_num(C.maxFee, 0.04), _num(C.base, 0.006) + _num(C.perHex, 0.0003) * distance);
        const fee = Math.max(_num(C.minFee, 5), Math.ceil(_num(amount) * rate));
        const usance = Math.max(1, Math.ceil(distance / Math.max(1, _num(C.usanceHexes, 8))));
        return { fee, rate, distance, usance };
    },

    /** Houses a bill can be drawn on from here: every open house but the one drawing it. */
    payees(player, fromBankId) {
        return Finance.openBanks(player).filter(b => b.id !== fromBankId);
    },

    /** Pay gold into a house serving the player here and take a bill payable at another. */
    draw(player, world, fromBankId, payBankId, amount) {
        const C = Bills.config();
        const st = Bills.state(player);
        const day = _day(world);
        const from = Finance.bank(player, fromBankId);
        const pay = Finance.bank(player, payBankId);
        const amt = Math.floor(_num(amount));
        if (!from || from.status !== 'open') return { success: false, reason: 'That house is not trading.' };
        if (!pay || pay.status !== 'open' || pay.id === from.id) return { success: false, reason: 'Draw the bill on another open house.' };
        if (!Finance._serves(player, world, from)) return { success: false, reason: `Visit ${from.name} in ${from.seat} or one of its branches.` };
        if (Finance.inPanic(from, day) || Finance.inPanic(pay, day)) return { success: false, reason: 'No clerk draws bills on a house with a crowd at its doors.' };
        if (amt < _num(C.minAmount, 200)) return { success: false, reason: `The smallest bill is ${_num(C.minAmount, 200)}g.` };
        if (Bills.held(player).length >= _num(C.maxHeld, 8)) return { success: false, reason: 'You carry as many bills as any sane merchant would.' };
        const t = Bills.terms(player, world, from.id, pay.id, amt);
        if (_num(player.gold) < amt + t.fee) return { success: false, reason: `You need ${amt + t.fee}g (the bill and a fee of ${t.fee}g).` };
        player.gold -= amt + t.fee;
        Ledger.record(player, 'billFees', -t.fee);
        Ledger.record(player, 'bills', -amt);
        from.capital = _num(from.capital) + t.fee;
        pay.capital = _num(pay.capital) + amt;
        const bill = {
            id: `bill${st.nextId++}`, amount: amt, fee: t.fee, fromBankId: from.id, fromName: from.name,
            payBankId: pay.id, payName: pay.name, payAt: pay.seat, payKingdomId: pay.kingdomId,
            issuedDay: day, payableFrom: day + t.usance, validUntil: day + _num(C.validDays, 120), status: 'held',
        };
        st.list.push(bill);
        st.stats.drawn += amt;
        st.stats.fees += t.fee;
        return { success: true, bill, text: `${from.name} draws a bill of ${amt}g on ${pay.name}, payable at ${pay.seat} or its branches from day ${bill.payableFrom}. Fee ${t.fee}g.` };
    },

    /** The house that pays this bill now (the drawer if the payee failed), or null. */
    payer(player, bill) {
        const pay = Finance.bank(player, bill.payBankId);
        if (pay && pay.status === 'open') return pay;
        const from = Finance.bank(player, bill.fromBankId);
        return from && from.status === 'open' ? from : null;
    },

    /** Present a bill at a branch of the house that pays it. */
    present(player, world, billId) {
        const C = Bills.config();
        const st = Bills.state(player);
        const day = _day(world);
        const bill = st.list.find(b => b.id === billId);
        if (!bill || bill.status !== 'held') return { success: false, reason: 'You hold no such bill.' };
        const bank = Bills.payer(player, bill);
        if (!bank) return { success: false, reason: 'Both houses on this bill have failed.' };
        if (!Finance._serves(player, world, bank)) return { success: false, reason: `Present it to ${bank.name} at ${bank.seat} or one of its branches.` };
        if (day < bill.payableFrom) return { success: false, reason: `Payable at sight from day ${bill.payableFrom}.` };
        if (Finance.inPanic(bank, day)) return { success: false, reason: 'The counters are shut while the run lasts.' };
        const protest = day > bill.validUntil ? Math.ceil(bill.amount * _num(C.protestFee, 0.05)) : 0;
        const pay = Math.max(0, Math.min(bill.amount - protest, Math.floor(Math.max(0, _num(bank.capital)))));
        if (pay <= 0) return { success: false, reason: 'The house has no coin to pay you.' };
        bank.capital = _num(bank.capital) - pay;
        player.gold = _num(player.gold) + pay;
        Ledger.record(player, 'bills', pay);
        if (protest) Ledger.record(player, 'billFees', -protest);
        bill.status = 'paid';
        bill.paidDay = day;
        st.stats.paidOut += pay;
        Bills._prune(st);
        return { success: true, amount: pay, text: `${bank.name} pays your bill: ${pay}g${protest ? ` (less ${protest}g for presenting it late)` : ''}.` };
    },

    /** Robbed on the road: the thieves may take bills along with the gold. Returns the bills taken. */
    onRobbed(player, world) {
        const C = Bills.config();
        const st = player && player.bills;
        if (!st || !Array.isArray(st.list)) return [];
        const day = _day(world);
        const taken = [];
        for (const b of st.list) {
            if (b.status !== 'held') continue;
            if (_roll(world, `steal:${b.id}:${day}`) >= _num(C.stealChance, 0.5)) continue;
            const [lo, hi] = C.cashDays || [3, 8];
            b.status = 'stolen';
            b.stolenDay = day;
            b.cashDay = day + lo + Math.floor(_roll(world, `cash:${b.id}:${day}`) * (hi - lo + 1));
            st.stats.stolen++;
            taken.push(b);
        }
        return taken;
    },

    /** Stop a stolen bill at a branch of its paying house before a forger cashes it. */
    stop(player, world, billId) {
        const C = Bills.config();
        const st = Bills.state(player);
        const day = _day(world);
        const bill = st.list.find(b => b.id === billId);
        if (!bill || bill.status !== 'stolen') return { success: false, reason: 'No such stolen bill.' };
        const bank = Bills.payer(player, bill);
        if (!bank) return { success: false, reason: 'Both houses on this bill have failed.' };
        if (!Finance._serves(player, world, bank)) return { success: false, reason: `Only ${bank.name} can stop it, at ${bank.seat} or a branch.` };
        const fee = Math.max(5, Math.ceil(bill.amount * _num(C.stopFee, 0.02)));
        if (_num(player.gold) < fee) return { success: false, reason: `Stopping it costs ${fee}g.` };
        player.gold -= fee;
        Ledger.record(player, 'billFees', -fee);
        bank.capital = _num(bank.capital) + fee;
        bill.status = 'held';
        bill.stopped = (bill.stopped || 0) + 1;
        delete bill.cashDay;
        st.stats.stopped++;
        return { success: true, fee, text: `${bank.name} stops the stolen bill (${fee}g) and will pay it to you alone.` };
    },

    /** Forge a bill on a house through the Thieves' Guild and present it here. */
    forge(player, world, bankId, amount) {
        const C = Bills.config();
        const F = C.forgery;
        const st = Bills.state(player);
        const day = _day(world);
        const bank = Finance.bank(player, bankId);
        const amt = Math.floor(_num(amount));
        const g = Underworld.ensure(player).guild;
        if (!g || !g.member || _num(g.rank) < _num(F.minRank, 2)) return { success: false, reason: "Only the Thieves' Guild's best hands forge a banker's bill." };
        if (!bank || bank.status !== 'open' || !Finance._serves(player, world, bank)) return { success: false, reason: 'Present it at a branch of the house it is drawn on.' };
        if (Finance.inPanic(bank, day)) return { success: false, reason: 'The counters are shut while the run lasts.' };
        const recent = st.forgeries.filter(d => day - d <= 120);
        if (recent.length && day - recent[recent.length - 1] < _num(F.cooldown, 30)) return { success: false, reason: 'The forger lies low a while after the last one.' };
        if (amt < 100 || amt > _num(F.max, 2500)) return { success: false, reason: `The forger draws bills of 100–${_num(F.max, 2500)}g.` };
        const fee = Math.ceil(amt * _num(F.fee, 0.25));
        if (_num(player.gold) < fee) return { success: false, reason: `The forger wants ${fee}g.` };
        player.gold -= fee;
        Ledger.record(player, 'fraud', -fee);
        st.forgeries.push(day);
        if (st.forgeries.length > 10) st.forgeries.splice(0, st.forgeries.length - 10);
        const chance = _clamp(_num(F.caught, 0.45) - _num(g.rank) * _num(F.perRank, 0.05) + recent.length * _num(F.perForgery, 0.1), 0.1, 0.9);
        if (_roll(world, `forge:${bank.id}:${day}:${st.forgeries.length}`) < chance) {
            const fine = Math.round(amt * _num(F.fineMult, 1));
            const take = Math.min(fine, Math.max(0, Math.floor(_num(player.gold))));
            player.gold -= take;
            if (take) Ledger.record(player, 'fines', -take);
            bank.capital = _num(bank.capital) + take;
            Underworld.addHeat(player, bank.kingdomId, _num(F.heat, 30) + Math.round((fine - take) / 100), world);
            st.stats.forgeriesCaught++;
            return { success: false, caught: true, reason: `The clerk of ${bank.name} holds the bill to the light and calls the watch. A fine of ${fine}g${fine > take ? ' (more than you have)' : ''}, and the watch knows your face.` };
        }
        const pay = Math.min(amt, Math.floor(Math.max(0, _num(bank.capital))));
        bank.capital = _num(bank.capital) - pay;
        player.gold += pay;
        Ledger.record(player, 'fraud', pay);
        st.stats.forged += pay;
        return { success: true, amount: pay, text: `${bank.name} pays the forged bill: ${pay}g.` };
    },

    /** The day: stolen bills a forger cashes; bills on failed houses. Draws no RNG. */
    processDay(world, player) {
        const out = { notices: [] };
        const st = player && player.bills;
        if (!st || !Array.isArray(st.list) || !st.list.length) return out;
        const C = Bills.config();
        const day = _day(world);
        for (const b of st.list) {
            if (b.status === 'stolen' && day >= _num(b.cashDay)) {
                const bank = Bills.payer(player, b);
                if (bank) bank.capital = _num(bank.capital) - b.amount;
                b.status = 'lost';
                st.stats.lost += b.amount;
                out.notices.push({ icon: '🗝️', title: 'A Stolen Bill Cashed', text: `A forger has cashed your stolen bill of ${b.amount}g on ${b.payName}. It is gone.`, type: 'error' });
                continue;
            }
            if (b.status !== 'held') continue;
            const pay = Finance.bank(player, b.payBankId);
            if (pay && pay.status === 'open') continue;
            const from = Finance.bank(player, b.fromBankId);
            if (from && from.status === 'open') {
                if (!b.protested) {
                    b.protested = true;
                    out.notices.push({ icon: '📜', title: 'Bill Protested', text: `${b.payName} has failed. Your bill of ${b.amount}g falls on ${from.name}, which drew it: present it there.`, type: 'warning' });
                }
                continue;
            }
            const [lo, hi] = C.recovery || [0.3, 0.6];
            const back = Math.floor(b.amount * (lo + (hi - lo) * ((_hash(`${b.id}|recovery`) % 1000) / 1000)));
            player.gold = _num(player.gold) + back;
            Ledger.record(player, 'bills', back);
            b.status = 'failed';
            st.stats.lost += b.amount - back;
            out.notices.push({ icon: '🏚️', title: 'Bill Dishonoured', text: `Both houses on your bill of ${b.amount}g have failed. The receivers pay ${back}g.`, type: 'error' });
        }
        Bills._prune(st);
        return out;
    },

    _prune(st) {
        const done = st.list.filter(b => !['held', 'stolen'].includes(b.status));
        if (done.length > 12) {
            const drop = new Set(done.slice(0, done.length - 12));
            st.list = st.list.filter(b => !drop.has(b));
        }
    },

    /** For the counsel: bills payable now near expiry, or stolen and not yet stopped. */
    dueSoon(player, world, days = 10) {
        const day = _day(world);
        return Bills.held(player).filter(b => b.status === 'stolen' || (day >= b.payableFrom && b.validUntil - day <= days));
    },
};
