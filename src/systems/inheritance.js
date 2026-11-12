// ============================================
// INHERITANCE — what an heir does not keep of the purse, and where it goes
// ============================================
// An heir who takes up the mantle (Relationships.succeedAsHeir) keeps
// `heirSettings.inheritanceGoldPercent` of the late ruler's coin. The rest is
// not lost: it is the dues of a death, paid out of the purse into real
// purses, in this order (data/relationships.json → heirSettings.inheritance):
//
//   1. Debts first (`payDebts`): wages owed to the court (house.court[].owed,
//      into each courtier's purse) and to companions (companion.wageDue), then
//      the House's loans — overdue ones first — paid down into the lender's
//      vault or the crown's treasury, as a day's payment is (Finance).
//   2. The other children's portions (`siblingShare` of what is left):
//      split evenly among the late ruler's other living children (the heir's
//      brothers and sisters, not the late ruler's own), each held
//      in the child's own purse (child.purse, saved with player.children and
//      counted by CoinCensus). A portion goes back to the House purse if its
//      holder dies (reclaimPortions), joins the purse if its holder inherits,
//      and is gathered into the estate if the House ends
//      (player/estateSettlement.js).
//   3. The heriot (death duty) — the rest — to the liege crown's treasury:
//      the crown the late ruler wore, else the realm they were sworn to,
//      else the realm they died in (or the nearest town's). Booked on the
//      crown's 'heriot' line (world/crownBooks.js). With no crown, it goes
//      to the nearest town's purse; with no town, it stays with the heir.
//
// Only real coin is touched: at the dawn the purse in kind keeps its goods
// (world/barter.js; `player.gold` may be an accessor there). The player's
// Ledger records each flow. No randomness; no globals (an NPC lookup is
// passed in by the caller).

import { DataLoader } from '../core/dataLoader.js';
import { Barter } from '../world/barter.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Finance } from './finance.js';
import { Ledger } from './ledger.js';

const DEFAULTS = { payDebts: true, siblingShare: 0.4 };

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = (v) => Math.round(v * 100) / 100;

function _kingdom(world, id) {
    if (!world || id == null) return null;
    const k = typeof world.getKingdom === 'function' ? world.getKingdom(id) : (world.kingdoms || []).find(x => x && x.id === id);
    return k && k.isAlive !== false ? k : null;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

const _hasPurse = (s) => !!(s && s.economy && Number.isFinite(s.economy.gold));

function _nearestTown(world, q, r) {
    const here = _settlementAt(world, q, r);
    if (_hasPurse(here)) return here;
    const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
    let best = null;
    let bestD = Infinity;
    for (const v of views) {
        const s = _settlementAt(world, v.q, v.r) || v;
        if (!_hasPurse(s) || _num(s.population, 1) <= 0) continue;
        const d = (v.q - q) * (v.q - q) + (v.r - r) * (v.r - r);
        if (d < bestD) { bestD = d; best = s; }
    }
    return best;
}

export const Inheritance = {
    config() {
        const rel = DataLoader._gamedata && DataLoader._gamedata.relationships;
        const hs = _obj(rel && rel.heirSettings) || {};
        return { ...DEFAULTS, ...(_obj(hs.inheritance) || {}) };
    },

    /** The player's real coin (at the dawn, the purse in kind's coin only). */
    coin(player) {
        return Math.max(0, _num(Barter.coinOf(player)));
    },

    /** Set the player's real coin (leaving any goods in kind alone). */
    setCoin(player, v) {
        const n = _r2(Math.max(0, v));
        if (Barter.installed(player)) player._inKind.coin = n;
        else player.gold = n;
    },

    /** Who takes the heriot: { kingdom, town }. */
    liegeOf(player, world) {
        const town = player ? _nearestTown(world, player.q, player.r) : null;
        const ruling = player && player.throne && player.throne.ruling;
        let kingdom = ruling ? _kingdom(world, ruling.kingdomId) : null;
        if (!kingdom && player && player.allegiance != null) kingdom = _kingdom(world, player.allegiance);
        if (!kingdom) {
            const here = _settlementAt(world, player && player.q, player && player.r);
            if (here) kingdom = _kingdom(world, here.kingdom);
        }
        if (!kingdom && town) kingdom = _kingdom(world, town.kingdom);
        return { kingdom, town };
    },

    /**
     * Portions of children who have died go back to the House purse.
     * → the coin reclaimed.
     */
    reclaimPortions(player) {
        let back = 0;
        for (const c of (player && player.children) || []) {
            if (!c || c.isAlive || !(_num(c.purse) > 0)) continue;
            back = _r2(back + _num(c.purse));
            c.purse = 0;
        }
        if (back > 0) {
            Inheritance.setCoin(player, Inheritance.coin(player) + back);
            Ledger.record(player, 'inheritance', back);
        }
        return back;
    },

    /**
     * Pay out what the heir does not keep. Call while the late ruler's state
     * (debts, allegiance, throne, children) is still on `player`, with the
     * heir passed as `heirId` (or already out of `player.children`).
     * opts: { keepShare, heirId, npc(id) → NPC }.
     * → { before, kept, dues, debts: [{ to, kind, amount }], debtsPaid,
     *     portions: [{ id, name, amount }], portionsPaid, heriot, crown, town, line }
     */
    settle(player, world, opts = {}) {
        const C = Inheritance.config();
        const keepShare = Math.max(0, Math.min(1, _num(opts.keepShare, 0.75)));
        const before = Inheritance.coin(player);
        const kept = Math.floor(before * keepShare);
        let pot = _r2(before - kept);
        const rec = { before, kept, dues: pot, debts: [], debtsPaid: 0, portions: [], portionsPaid: 0, heriot: 0, crown: null, town: null, line: '' };
        if (!player || !(pot > 0)) { rec.line = Inheritance.line(rec); return rec; }
        Inheritance.setCoin(player, kept);

        // 1. Debts first
        if (C.payDebts) pot = Inheritance._payDebts(player, world, pot, rec, opts.npc);

        // 2. The other children's portions
        // (the late ruler's own children: not their siblings from an earlier succession)
        const sibs = ((player.children) || []).filter(c => c && c.isAlive && !c.isSibling && c.id !== opts.heirId);
        const share = Math.max(0, Math.min(1, _num(C.siblingShare)));
        if (sibs.length && pot > 0 && share > 0) {
            const all = _r2(pot * share);
            const each = Math.floor((all / sibs.length) * 100) / 100;
            let given = 0;
            sibs.forEach((c, i) => {
                const a = i === sibs.length - 1 ? _r2(all - given) : each;
                if (!(a > 0)) return;
                c.purse = _r2(_num(c.purse) + a);
                given = _r2(given + a);
                rec.portions.push({ id: c.id, name: c.firstName || c.name || 'a child', amount: a });
            });
            rec.portionsPaid = given;
            pot = _r2(pot - given);
            if (given > 0) Ledger.record(player, 'inheritance', -given);
        }

        // 3. The heriot, to the liege crown (else the town; else it stays)
        if (pot > 0) {
            const { kingdom, town } = Inheritance.liegeOf(player, world);
            if (kingdom) {
                kingdom.treasury = _r2(_num(kingdom.treasury) + pot);
                CrownBooks.note(kingdom, 'heriot', pot);
                rec.crown = { id: kingdom.id, name: kingdom.name };
                rec.heriot = pot;
            } else if (_hasPurse(town)) {
                town.economy.gold = _r2(town.economy.gold + pot);
                rec.town = { name: town.name };
                rec.heriot = pot;
            } else {
                Inheritance.setCoin(player, Inheritance.coin(player) + pot);
                rec.kept = _r2(rec.kept + pot);
            }
            if (rec.heriot > 0) Ledger.record(player, 'deathDuty', -rec.heriot);
        }
        rec.line = Inheritance.line(rec);
        return rec;
    },

    /** Wages owed, then loans (overdue first). → what is left of the pot. */
    _payDebts(player, world, pot, rec, npcOf) {
        const lookup = typeof npcOf === 'function' ? npcOf : () => null;
        const pay = (to, kind, amount, fn) => {
            const a = _r2(Math.min(pot, Math.max(0, amount)));
            if (!(a > 0)) return 0;
            fn(a);
            pot = _r2(pot - a);
            rec.debtsPaid = _r2(rec.debtsPaid + a);
            rec.debts.push({ to, kind, amount: a });
            return a;
        };
        // Wages owed: the court's stipends, the companions' pay
        const house = player.house;
        for (const e of (house && Array.isArray(house.court) ? house.court : [])) {
            const npc = e ? lookup(e.npcId) : null;
            if (!npc || !(_num(e.owed) > 0) || !(pot > 0)) continue;
            const a = pay(npc.firstName || npc.name || 'a courtier', 'stipend', _num(e.owed), (x) => { npc.purse = _r2(_num(npc.purse) + x); });
            e.owed = _r2(Math.max(0, _num(e.owed) - a));
            if (a > 0) Ledger.record(player, 'courtStipends', -a);
        }
        for (const id of (Array.isArray(player.travelParty) ? player.travelParty : [])) {
            const npc = lookup(typeof id === 'object' && id ? id.id : id);
            const c = npc && npc.companion;
            if (!c || !(_num(c.wageDue) > 0) || !(pot > 0)) continue;
            const a = pay(npc.firstName || npc.name || 'a companion', 'wages', Math.round(_num(c.wageDue)), (x) => { npc.purse = _r2(_num(npc.purse) + x); });
            c.wageDue = Math.max(0, _r2(_num(c.wageDue) - a));
            if (a > 0) Ledger.record(player, 'family', -a);
        }
        // Loans, overdue first
        const fin = _obj(player.finance);
        const loans = fin && Array.isArray(fin.loans) ? fin.loans.slice().sort((a, b) => _num(b.overdue) - _num(a.overdue)) : [];
        for (const loan of loans) {
            if (!(pot > 0)) break;
            const owed = _num(loan.totalOwed);
            if (!(owed > 0)) continue;
            const a = pay(Finance._lenderName(player, world, loan), 'loan', owed, (x) => {
                Finance._bookPayment(player, loan, x);
                Finance._payLender(player, world, loan, x);
            });
            loan.totalOwed = _r2(Math.max(0, owed - a));
            loan.totalPaid = _r2(_num(loan.totalPaid) + a);
            if (loan.totalOwed <= 0) {
                Finance._closeLoan(fin, loan);
                if (fin.credit) fin.credit.repaid = _num(fin.credit.repaid) + 1;
            } else {
                loan.overdue = 0;
            }
        }
        return pot;
    },

    /** "Of 1,000 crowns, the heir keeps 750; 100 settled debts, 60 went to the younger children and 90 to the crown of X as heriot." */
    line(rec) {
        if (!rec || !(rec.dues > 0)) return '';
        const n = (v) => Math.round(v).toLocaleString('en-US');
        const parts = [];
        if (rec.debtsPaid >= 0.5) parts.push(`${n(rec.debtsPaid)} paid the late ruler's debts`);
        if (rec.portionsPaid >= 0.5) parts.push(`${n(rec.portionsPaid)} went to ${rec.portions.length === 1 ? rec.portions[0].name : 'the other children'} as ${rec.portions.length === 1 ? 'a portion' : 'portions'}`);
        if (rec.heriot >= 0.5) parts.push(`${n(rec.heriot)} to ${rec.crown ? `the crown of ${/^[A-Z][a-z]+ of /.test(rec.crown.name) ? `the ${rec.crown.name}` : rec.crown.name}` : `the town of ${rec.town ? rec.town.name : 'the place'}`} as heriot`);
        const tail = parts.length ? parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : 'the rest stayed in the purse';
        return `Of ${n(rec.before)} gold, the heir keeps ${n(rec.kept)}: ${tail}.`;
    },
};
