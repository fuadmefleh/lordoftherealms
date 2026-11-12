// ============================================
// ESTATE SETTLEMENT — an heirless House's money, settled once
// ============================================
// The user's rule: "If [you] die with no heir, the banks and debtors take
// their share and the rest goes to the crown."
//
// When it runs (player/afterlife.js calls it; exactly once per estate,
// marked by `player.estateSettled`, saved with the player):
//   - at death, when no child or sibling of the blood is alive at all
//     (Afterlife.begin);
//   - during the interregnum, the day the last of them dies (Afterlife.passDay);
//   - when the player takes a new life (Afterlife.becomeStranger), heirs or not:
//     the House ends there;
//   - when the line is let end on the death screen (ui/actionMenu/heirs.js).
// A House whose heir takes up the mantle is never settled: the heir inherits
// the loans, deposits and bonds on the same player object, as before.
//
// Every coin comes from a real purse and goes into one (no coin is made or
// lost; the test counts the world's coin before and after):
//
// 1. The estate is gathered into coin:
//      the purse, and the children's portions (systems/inheritance.js);
//      the company's coffers (the outside shareholders' part goes to the
//        merchants of the exchange city who hold it);
//      deposits, drawn from each bank's vault (what a vault cannot pay is lost);
//      bills of exchange held, paid by the house that owes them;
//      royal bonds, redeemed from the issuing crown's treasury as far as it
//        holds coin; a bond on the heir crown itself is simply cancelled (the
//        crown would be paying itself);
//      shares, sold on the exchange at the bid less brokerage; the buyers'
//        coin is the exchange city's purse;
//      goods in the packs and in store-rooms, sold to the town where they lie
//        at a forced-sale discount (`goodsShare` of the base price), paid from
//        its purse; what the purse cannot buy goes to its market unpaid.
// 2. The land: estates and buildings escheat to the crown (Afterlife.escheat),
//    so the land is not sold. Instead the crown that takes it answers for
//    the debts upon it: if the coin falls short, each crown pays the unpaid
//    creditors up to `landShare` of the land's worth, from its treasury. A
//    forced sale in an interregnum would fetch less, and selling to the very
//    crown that escheats it would be the same coin going round.
// 3. The creditors, in order, pro rata inside a class when the estate is short:
//      I   the banks and the crown: bank loans (secured), written-off debts,
//          a crown's own loans and a lease's arrears (royalties);
//      II  merchants and landlords: store-room rent;
//      III wages owed: courtiers' stipends, companions' pay.
//    Each is paid into its real purse: the bank's vault, the kingdom's
//    treasury, the landlord's town, the courtier's own purse. An unpaid bank
//    books the loss in its history, and a loss large against its vault
//    (`stressShare`) starts a run on it (Finance._startRun).
// 4. The rest passes to the crown of the realm the player ruled, else the one
//    they died in (or the nearest realm's), booked on the crown's 'escheat'
//    line (world/crownBooks.js). With no realm, it goes to the local town.
// 5. A record (`player.estateSettled`): assets, claims paid and unpaid, where
//    the rest went, and a line for the House chronicle / Annals, written
//    through systems/llmProse.js (key 'estate:<house>'; the template is the fallback).
// The player's own bank, if any, passes to its partners as an ordinary house.
//
// Draws no randomness; tuned in data/afterlife.json → estate.

import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { CrownBooks } from '../world/crownBooks.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Barter } from '../world/barter.js';
import { Finance } from '../systems/finance.js';
import { Bills } from '../systems/bills.js';
import { Bourse } from '../systems/bourse.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Relationships } from '../systems/relationships.js';
import { Ledger } from '../systems/ledger.js';
import { LlmProse } from '../systems/llmProse.js';
import { CadetBranches } from '../systems/cadetBranches.js';

// The prose writer (systems/llmProse.js) retells the chronicle line when the
// model is on; the template line stands otherwise (and if it ever goes away).
function _llmProse() {
    return LlmProse && typeof LlmProse.write === 'function' ? LlmProse : null;
}

const DEFAULTS = { goodsShare: 0.6, landShare: 0.5, stressShare: 0.15 };

export const TIERS = [
    { id: 'crown', label: 'The banks and the crown' },
    { id: 'merchants', label: 'Merchants and landlords' },
    { id: 'wages', label: 'Wages owed' },
];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
// A realm's name in a sentence: "the Kingdom of Valdoria", but "Arland" as it is
const _realm = (name) => (/^[A-Z][a-z]+ of /.test(String(name || '')) ? `the ${name}` : String(name || ''));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = (v) => Math.round(v * 100) / 100;
const _day = (world) => (world && Number.isFinite(world.day) ? world.day : 0);

function _kingdom(world, id) {
    if (!world || id == null) return null;
    const k = typeof world.getKingdom === 'function' ? world.getKingdom(id) : (world.kingdoms || []).find(x => x && x.id === id);
    return k && k.isAlive !== false ? k : null;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' && Number.isFinite(q) ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

function _hasPurse(s) {
    return !!(s && s.economy && Number.isFinite(s.economy.gold));
}

/** The nearest settlement with a purse to (q, r) (offset grid: a plain distance is enough to pick). */
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

function _townPos(world, s) {
    if (!s) return null;
    if (Number.isFinite(s.q)) return { q: s.q, r: s.r };
    return null;
}

export const EstateSettlement = {
    config() {
        const d = DataLoader._gamedata && DataLoader._gamedata.afterlife;
        return { ...DEFAULTS, ...(_obj(d && d.estate) || {}) };
    },

    /**
     * No child (or sibling kept from a succession) of the blood is alive, and
     * no cadet branch's head could take up the mantle (systems/cadetBranches.js).
     */
    heirless(player) {
        if (((player && player.children) || []).some(c => c && c.isAlive)) return false;
        return !CadetBranches.list(player).length;
    },

    /** The settlement record, once made (null before). */
    settled(player) {
        return (player && _obj(player.estateSettled)) || null;
    },

    /**
     * Who takes the rest: { kingdom, town } — the crown the player ruled, else
     * the realm of the town they died in (or the nearest town's); the town is
     * the one nearest where they lay (goods are sold there; the rest goes to
     * its purse when there is no crown).
     */
    heirOf(player, world) {
        const town = player ? _nearestTown(world, player.q, player.r) : null;
        const ruling = player && player.throne && player.throne.ruling;
        let kingdom = ruling ? _kingdom(world, ruling.kingdomId) : null;
        if (!kingdom && town) kingdom = _kingdom(world, town.kingdom);
        return { kingdom, town };
    },

    /**
     * Settle the estate (once): gather it into coin, pay the creditors, pass
     * the rest on, clear the debts, write the record. → the record.
     */
    settle(player, world, opts = {}) {
        if (!player || !world) return null;
        if (EstateSettlement.settled(player)) return player.estateSettled;
        // The House ends with cadet branches still out in the world (a new life taken):
        // they go on as minor nobility outside it, their purses spent at their seats
        CadetBranches.dissolve(player, world);
        const C = EstateSettlement.config();
        const day = _day(world);
        const { kingdom: crown, town } = EstateSettlement.heirOf(player, world);
        const fin = Finance.state(player);
        const rec = {
            day, cause: opts.cause || null, name: player.name || 'The late ruler',
            house: player.house ? player.house.name : null, houseId: player.house ? (player.house.id || player.house.name) : null,
            crown: crown ? { id: crown.id, name: crown.name } : null,
            town: town ? { name: town.name, ...(_townPos(world, town) || {}) } : null,
            assets: { gold: 0, portions: 0, company: 0, deposits: 0, bills: 0, bonds: 0, shares: 0, goods: 0 },
            lost: { deposits: 0, bills: 0, bonds: 0, shares: 0 },
            cancelledBonds: 0, unsoldGoods: 0, land: 0, landPaid: 0,
            claims: [], owed: 0, paid: 0, unpaid: 0, toCrown: 0, toTown: 0, line: '', key: null,
        };
        let pot = 0;
        const gain = (kind, v) => { const a = _r2(Math.max(0, v)); rec.assets[kind] = _r2(rec.assets[kind] + a); pot = _r2(pot + a); return a; };

        // ── 1. The estate into coin ──
        // The purse (at the dawn the purse in kind keeps its coin aside: world/barter.js)
        const coin = Math.max(0, _num(Barter.coinOf(player)));
        if (Barter.installed(player)) player._inKind.coin = 0;
        else player.gold = 0;
        gain('gold', coin);
        // The children's portions set aside at earlier successions (systems/inheritance.js): the House ends, they are its estate
        for (const c of Array.isArray(player.children) ? player.children : []) {
            if (!c || !(_num(c.purse) > 0)) continue;
            gain('portions', _num(c.purse));
            c.purse = 0;
        }

        // The company's coffers: the outside shareholders' part to the merchants who hold it
        const company = MerchantHouses.company(player);
        if (company && _num(company.capital) > 0) {
            const outside = Math.min(1, Math.max(0, _num(company.float && company.float.outside) / 100));
            const theirs = _r2(_num(company.capital) * outside);
            const holders = theirs > 0 ? EstateSettlement._exchangeTown(player, world, null) || town : null;
            if (holders && theirs > 0) holders.economy.gold = _r2(holders.economy.gold + theirs);
            gain('company', _num(company.capital) - (holders ? theirs : 0));
            company.capital = 0;
        }

        // Deposits, from each vault (the player's own house is handled below)
        for (const [id, acct] of Object.entries(fin.accounts || {})) {
            const bank = Finance.bank(player, id);
            const bal = Math.max(0, _num(acct && acct.balance));
            const can = bank && bank.status === 'open' && bank.owner !== 'player' ? Math.min(bal, Math.max(0, _num(bank.capital))) : 0;
            if (can > 0) bank.capital = _r2(_num(bank.capital) - can);
            gain('deposits', can);
            rec.lost.deposits = _r2(rec.lost.deposits + bal - can);
        }
        fin.accounts = {};

        // Bills of exchange, paid by the house that owes them
        for (const b of Bills.held(player)) {
            if (b.status !== 'held') continue; // a stolen bill is the thieves' race to cash
            const payer = Bills.payer(player, b);
            const can = payer ? Math.min(_num(b.amount), Math.max(0, _num(payer.capital))) : 0;
            if (can > 0) payer.capital = _r2(_num(payer.capital) - can);
            gain('bills', can);
            rec.lost.bills = _r2(rec.lost.bills + _num(b.amount) - can);
            b.status = 'paid';
            b.paidDay = day;
        }

        // Royal bonds: redeemed from the issuing treasury; on the heir crown, cancelled
        for (const bond of fin.bonds || []) {
            const k = _kingdom(world, bond.kingdomId);
            const face = Math.max(0, _num(bond.principal));
            if (k && crown && k.id === crown.id) { rec.cancelledBonds = _r2(rec.cancelledBonds + face); continue; }
            const can = k ? Math.min(face, Math.max(0, _num(k.treasury))) : 0;
            if (can > 0) {
                k.treasury = _r2(_num(k.treasury) - can);
                CrownBooks.note(k, 'debt', can);
            }
            gain('bonds', can);
            rec.lost.bonds = _r2(rec.lost.bonds + face - can);
        }
        fin.bonds = [];

        // Shares, sold on the exchange; the buyers are the exchange city's merchants
        const bst = _obj(player.bourse);
        if (bst && _obj(bst.holdings)) {
            for (const [id, h] of Object.entries(bst.holdings)) {
                const l = Bourse.listing(player, id);
                const n = Math.floor(_num(h && h.shares));
                if (!l || l.kind === 'company' || n <= 0) continue;
                const q = Bourse.quoteTrade(l, n, 'sell');
                const buyers = EstateSettlement._exchangeTown(player, world, l);
                const can = buyers ? Math.min(_num(q.total), Math.max(0, buyers.economy.gold)) : 0;
                if (can > 0) buyers.economy.gold = _r2(buyers.economy.gold - can);
                gain('shares', can);
                rec.lost.shares = _r2(rec.lost.shares + _num(q.total) - can);
                if (l.kind === 'house') {
                    const r = MerchantHouses.getRival(player, l.ref);
                    if (r && r.shares) r.shares.purse = 0;
                }
            }
            bst.holdings = {};
        }

        // Goods in the packs (sold where the player lay) and in store-rooms (where they lie)
        const sell = (goods, s) => {
            for (const [id, qty0] of Object.entries(goods || {})) {
                const qty = Math.floor(_num(qty0));
                if (id === 'gold' || qty <= 0 || !SettlementMarket.tracks(id)) continue;
                const unit = PlayerInventory.goodValue(id) * C.goodsShare;
                if (!(unit > 0) || !_hasPurse(s)) continue;
                const n = Math.min(qty, Math.floor(Math.max(0, s.economy.gold) / unit));
                const pay = _r2(n * unit);
                if (pay > 0) s.economy.gold = _r2(s.economy.gold - pay);
                gain('goods', pay);
                rec.unsoldGoods += qty - n;
                SettlementMarket.add(s, id, qty);
                delete goods[id];
            }
        };
        if (_obj(player.inventory)) sell(player.inventory, town);
        const mp = _obj(player.merchantPrince);
        for (const w of (mp && Array.isArray(mp.warehouses) ? mp.warehouses : [])) {
            if (w && _obj(w.goods)) sell(w.goods, _settlementAt(world, w.q, w.r) || town);
        }

        // ── 2. The land, which the crowns take with its debts ──
        const land = new Map(); // kingdom id → { k, value }
        const addLand = (kid, value) => {
            const k = _kingdom(world, kid) || crown;
            if (!k || !(value > 0)) return;
            const e = land.get(k.id) || { k, value: 0 };
            e.value += value;
            land.set(k.id, e);
        };
        for (const p of player.properties || []) {
            const s = p ? _settlementAt(world, p.q, p.r) : null;
            addLand(s ? s.kingdom : null, Finance._propertyValue(p));
        }
        const est = _obj(world.estates);
        if (est && _obj(est.estates)) {
            for (const e of Object.values(est.estates)) {
                if (!e || e.holder !== 'player') continue;
                const t = est.towns && est.towns[e.town];
                addLand(t ? t.kid : null, _num(e.value));
            }
        }
        for (const e of land.values()) rec.land = _r2(rec.land + e.value);

        // ── 3. The creditors ──
        const claims = EstateSettlement._claims(player, world, fin);
        for (const c of claims) { c.paid = 0; rec.owed = _r2(rec.owed + c.amount); }
        pot = EstateSettlement._pay(claims, pot);
        for (const e of land.values()) {
            const left = claims.reduce((s, c) => s + (c.amount - c.paid), 0);
            if (left < 0.5) break;
            const draw = _r2(Math.min(left, e.value * C.landShare, Math.max(0, _num(e.k.treasury))));
            if (!(draw > 0)) continue;
            e.k.treasury = _r2(_num(e.k.treasury) - draw);
            rec.landPaid = _r2(rec.landPaid + draw);
            pot = _r2(pot + EstateSettlement._pay(claims, draw));
        }
        for (const c of claims) {
            rec.paid = _r2(rec.paid + c.paid);
            const unpaid = _r2(c.amount - c.paid);
            rec.unpaid = _r2(rec.unpaid + Math.max(0, unpaid));
            if (unpaid >= 0.5) EstateSettlement._loss(player, world, fin, c, unpaid, rec, C);
            rec.claims.push({ tier: c.tier, kind: c.kind, to: c.to, amount: _r2(c.amount), paid: _r2(c.paid) });
            if (c.clear) c.clear();
        }
        fin.loans = [];
        fin.blacklist = {};
        fin.wanted = {};

        // ── 4. The rest, to the crown (or the town) ──
        if (pot > 0) {
            if (crown) {
                crown.treasury = _r2(_num(crown.treasury) + pot);
                CrownBooks.note(crown, 'escheat', pot);
                rec.toCrown = pot;
            } else if (_hasPurse(town)) {
                town.economy.gold = _r2(town.economy.gold + pot);
                rec.toTown = pot;
            } else {
                // Nowhere in the world to take it: it stays with the dead (never made, never lost)
                player.gold = pot;
            }
        }

        // The player's own bank: its partners carry it on as an ordinary house
        for (const b of fin.banks || []) {
            if (!b || b.owner !== 'player') continue;
            delete b.owner;
            b.baseCapital = Math.max(1, Math.round(_num(b.capital)));
            rec.bank = b.name;
        }

        // ── 5. The record ──
        if (rec.paid > 0) Ledger.record(player, 'estateCreditors', -rec.paid);
        if (rec.toCrown + rec.toTown > 0) Ledger.record(player, 'estateEscheat', -(rec.toCrown + rec.toTown));
        Finance._record(fin, world, { kind: 'estate_settled', kingdomId: crown ? crown.id : null, amount: Math.round(rec.paid), lender: rec.house });
        rec.key = `estate:${rec.houseId || rec.name}`;
        rec.line = EstateSettlement._write(world, rec);
        EstateSettlement._chronicle(player, world, rec);
        player.estateSettled = rec;
        return rec;
    },

    /** The town whose merchants trade a listing (its exchange's city; any exchange's for none). */
    _exchangeTown(player, world, listing) {
        const st = _obj(player && player.bourse);
        const exs = st && Array.isArray(st.exchanges) ? st.exchanges : [];
        const ex = (listing && exs.find(e => e && e.kingdomId === listing.kingdomId)) || exs[0] || null;
        const s = ex ? _settlementAt(world, ex.q, ex.r) : null;
        return _hasPurse(s) ? s : null;
    },

    /**
     * What the estate owes: [{ tier, kind, to, amount, pay(amount), clear() }].
     * `pay` puts the coin in the creditor's real purse.
     */
    _claims(player, world, fin) {
        const out = [];
        const toBankOrCrown = (bankId, kingdomId) => {
            const bank = Finance.bank(player, bankId);
            if (bank) return { bank, pay: (a) => { bank.capital = _r2(_num(bank.capital) + a); } };
            const kid = String(bankId || '').startsWith('crown:') ? String(bankId).slice(6) : kingdomId;
            const k = _kingdom(world, kid) || _kingdom(world, kingdomId) || (world.kingdoms || []).find(x => x && String(x.id) === String(kid) && x.isAlive !== false);
            return k ? { kingdom: k, pay: (a) => { k.treasury = _r2(_num(k.treasury) + a); } } : null;
        };
        // I — the banks and the crown
        for (const loan of fin.loans || []) {
            const owed = Math.ceil(_num(loan.totalOwed));
            const who = toBankOrCrown(loan.bankId, loan.kingdomId);
            if (owed > 0 && who) out.push({ tier: 'crown', kind: 'loan', to: Finance._lenderName(player, world, loan), amount: owed, bank: who.bank || null, pay: who.pay });
        }
        for (const [bankId, owed0] of Object.entries(fin.blacklist || {})) {
            const owed = Math.ceil(_num(owed0));
            const who = toBankOrCrown(bankId, null);
            if (owed > 0 && who) out.push({ tier: 'crown', kind: 'old debt', to: who.bank ? who.bank.name : `the crown of ${_realm(who.kingdom.name)}`, amount: owed, bank: who.bank || null, pay: who.pay });
        }
        const hin = _obj(world.hinterland);
        for (const c of (hin && Array.isArray(hin.concessions) ? hin.concessions : [])) {
            if (!c || c.holder !== 'player' || !(_num(c.owed) > 0)) continue;
            const k = _kingdom(world, c.kingdomId);
            if (!k) continue;
            out.push({ tier: 'crown', kind: 'lease arrears', to: `the crown of ${_realm(k.name)}`, amount: _num(c.owed), pay: (a) => { k.treasury = _r2(_num(k.treasury) + a); }, clear: () => { c.owed = 0; c.owedSince = null; } });
        }
        // II — merchants and landlords
        const mp = _obj(player.merchantPrince);
        for (const w of (mp && Array.isArray(mp.warehouses) ? mp.warehouses : [])) {
            if (!w || !(_num(w.arrears) > 0)) continue;
            const s = _settlementAt(world, w.q, w.r);
            if (!_hasPurse(s)) continue;
            out.push({ tier: 'merchants', kind: 'store-room rent', to: `a landlord of ${w.town || s.name}`, amount: _num(w.arrears), pay: (a) => { s.economy.gold = _r2(s.economy.gold + a); }, clear: () => { w.arrears = 0; w.unpaid = 0; } });
        }
        // III — wages owed
        const npcOf = (id) => Relationships.getNPC(id) || ((player._relationshipNpcs || []).find(n => n && n.id === id)) || null;
        const house = player.house;
        for (const e of (house && Array.isArray(house.court) ? house.court : [])) {
            const npc = e ? npcOf(e.npcId) : null;
            if (!npc || !(_num(e.owed) > 0)) continue;
            out.push({ tier: 'wages', kind: 'stipend', to: npc.firstName || npc.name || 'a courtier', amount: _num(e.owed), pay: (a) => { npc.purse = _r2(_num(npc.purse) + a); }, clear: () => { e.owed = 0; } });
        }
        const npcs = Array.isArray(Relationships._npcs) && Relationships._npcs.length ? Relationships._npcs : (player._relationshipNpcs || []);
        for (const npc of npcs) {
            const c = npc && npc.companion;
            const due = c ? Math.round(_num(c.wageDue)) : 0;
            if (!(due > 0)) continue;
            out.push({ tier: 'wages', kind: 'wages', to: npc.firstName || npc.name || 'a companion', amount: due, pay: (a) => { npc.purse = _r2(_num(npc.purse) + a); }, clear: () => { c.wageDue = 0; } });
        }
        return out;
    },

    /** Pay `pot` down the classes, pro rata inside a class it cannot cover. → what is left of the pot. */
    _pay(claims, pot) {
        for (const tier of TIERS) {
            const list = claims.filter(c => c.tier === tier.id && c.amount - c.paid > 0.004);
            const due = list.reduce((s, c) => s + (c.amount - c.paid), 0);
            if (!(due > 0) || !(pot > 0)) continue;
            const share = Math.min(1, pot / due);
            let spent = 0;
            list.forEach((c, i) => {
                const want = c.amount - c.paid;
                // (the last of a short class takes what rounding left, so no copper is lost)
                const a = share >= 1 ? want : (i === list.length - 1 ? Math.min(want, _r2(pot - spent)) : Math.floor(want * share * 100) / 100);
                if (!(a > 0)) return;
                c.pay(a);
                c.paid = _r2(c.paid + a);
                spent = _r2(spent + a);
            });
            pot = _r2(pot - spent);
        }
        return Math.max(0, pot);
    },

    /** An unpaid creditor books the loss; a bank hit hard against its vault faces a run. */
    _loss(player, world, fin, claim, unpaid, rec, C) {
        const bank = claim.bank;
        if (!bank) return;
        Finance._record(fin, world, { kind: 'estate_loss', bankId: bank.id, bank: bank.name, kingdomId: bank.kingdomId, place: bank.seat, amount: Math.round(unpaid), lender: rec.house });
        const day = _day(world);
        if (bank.status === 'open' && bank.owner !== 'player' && !Finance.inPanic(bank, day) && unpaid >= C.stressShare * Math.max(1, _num(bank.capital))) {
            Finance._startRun(world, player, fin, bank, null, `the estate of ${rec.name} left ${Math.round(unpaid)} crowns unpaid`);
            rec.runs = (rec.runs || []).concat(bank.name);
        }
    },

    /** The line for the chronicle: the template, or the prose writer's when it is there. */
    _write(world, rec) {
        const fallback = EstateSettlement.templateLine(rec);
        const P = _llmProse();
        if (!P || typeof P.write !== 'function') return fallback;
        try {
            const facts = {
                name: rec.name, house: rec.house, cause: rec.cause, owed: Math.round(rec.owed), paid: Math.round(rec.paid),
                unpaid: Math.round(rec.unpaid), toCrown: Math.round(rec.toCrown), toTown: Math.round(rec.toTown),
                crown: rec.crown ? rec.crown.name : null, town: rec.town ? rec.town.name : null,
            };
            const out = P.write(world, { kind: 'estate', key: rec.key, facts, fallback });
            return typeof out === 'string' && out.trim() ? out : fallback;
        } catch (e) {
            return fallback;
        }
    },

    /** The line as it reads today (the prose writer may have finished it since). */
    line(world, rec) {
        if (!rec) return '';
        const P = _llmProse();
        if (P && typeof P.text === 'function' && rec.key) {
            try {
                const t = P.text(world, rec.key, rec.line || EstateSettlement.templateLine(rec));
                if (typeof t === 'string' && t.trim()) return t;
            } catch (e) { /* the template stands */ }
        }
        return rec.line || EstateSettlement.templateLine(rec);
    },

    /** "His creditors took 3,200 crowns; the remaining 1,100 passed to the crown of X." */
    templateLine(rec) {
        const n = (v) => Math.round(v).toLocaleString('en-US');
        const heir = rec.crown ? `the crown of ${_realm(rec.crown.name)}` : rec.town ? `the town of ${rec.town.name}` : 'no one';
        const rest = rec.toCrown + rec.toTown;
        const who = rec.name;
        if (rec.owed < 0.5) return rest > 0 ? `${who} died owing no one; the estate of ${n(rest)} crowns passed to ${heir}.` : `${who} died owing no one and leaving nothing.`;
        if (rec.unpaid >= 0.5) return `${who} died owing ${n(rec.owed)} crowns; the estate paid ${n(rec.paid)} and ${n(rec.unpaid)} went unpaid. Nothing passed to ${heir}.`;
        return rest > 0 ? `${who}'s creditors took ${n(rec.paid)} crowns; the remaining ${n(rest)} passed to ${heir}.` : `${who}'s creditors took ${n(rec.paid)} crowns, all the estate had.`;
    },

    /** The line in the House chronicle, dated inside the last reign so the Annals tell it. */
    _chronicle(player, world, rec) {
        const house = player.house;
        if (!house || !rec.line) return;
        const reigns = Array.isArray(house.reigns) ? house.reigns : [];
        const last = reigns[reigns.length - 1];
        const day = !house.currentReign && last && Number.isFinite(last.endDay) ? Math.min(rec.day, last.endDay) : rec.day;
        house.history = house.history || [];
        house.history.push({ day, generation: (last && !house.currentReign ? last.generation : house.generation) || 1, text: rec.line, tags: ['estate', 'heirs'] });
    },

    /** The breakdown for a screen: [{ label, value, tone }]. */
    breakdown(rec) {
        if (!rec) return [];
        const rows = [];
        const A = rec.assets || {};
        const names = { gold: 'Purse', portions: "Children's portions", company: 'Company coffers', deposits: 'Bank deposits', bills: 'Bills of exchange', bonds: 'Royal bonds redeemed', shares: 'Shares sold', goods: 'Goods sold' };
        for (const [k, label] of Object.entries(names)) if (_num(A[k]) >= 1) rows.push({ label, value: Math.round(A[k]), tone: '' });
        if (rec.landPaid >= 1) rows.push({ label: 'Paid by the crown for the land', value: Math.round(rec.landPaid), tone: '' });
        for (const t of TIERS) {
            const cs = (rec.claims || []).filter(c => c.tier === t.id);
            if (!cs.length) continue;
            const owed = cs.reduce((s, c) => s + c.amount, 0);
            const paid = cs.reduce((s, c) => s + c.paid, 0);
            rows.push({ label: `${t.label}: owed ${Math.round(owed)}`, value: -Math.round(paid), tone: paid + 0.5 < owed ? 'bad' : '' });
        }
        if (rec.unpaid >= 1) rows.push({ label: 'Went unpaid', value: Math.round(rec.unpaid), tone: 'bad' });
        if (rec.toCrown >= 1) rows.push({ label: `To the crown of ${rec.crown ? _realm(rec.crown.name) : 'the realm'}`, value: Math.round(rec.toCrown), tone: 'gold' });
        if (rec.toTown >= 1) rows.push({ label: `To the town of ${rec.town ? rec.town.name : 'the place'}`, value: Math.round(rec.toTown), tone: 'gold' });
        return rows;
    },
};
