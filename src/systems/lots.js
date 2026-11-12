// ============================================
// LOTS — buying building land and vacant houses in town
// ============================================
// A town's building lots and vacant houses (world/lotBook.js; laid out by
// world/townPlanner.js, shown on the town map by world/innerMap/lots.js) are
// for anyone to buy: the player, a rival House of the realm (out of its
// purse), or a townsman. The player builds only within a lot they hold.
//
//   buyLot / buildOnLot      a lot, and the player's property standing on it
//   claimLotForProperty      a property built in town takes a lot of the
//                            player's (or buys a free one) to stand on
//   rentHouse / buyHouse     a vacant house: by the day, or outright
//   leaveHouse               give up a rented house
//   buildHouseOnLot          raise a house to let on your own lot
//   letHouse / stopLetting / evictTenant
//                            your own houses (bought, or raised on a lot) let
//                            to townsfolk, who pay you rent by the day
//   sellLot / sellHouse      sell a lot (with any house on it) or a town house
//   holdingsView             every lot and house of the player's, for the panel
//   processDay               rent day for the player's houses (miss it and
//                            you're put out), your tenants' rent (and their
//                            arrears), a monthly word of rents taken and paid;
//                            the AI buys free lots and raises buildings on
//                            them, takes and leaves houses
//
// The AI's dice are its own (a hash of the day and the town), so no other
// system's rolls move. Player holdings are listed on player.lotHoldings.
// Data: data/lots.json.

import { LotBook } from '../world/lotBook.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _day = world => _num(world && world.day, 0);

function _strHash(s) {
    let h = 2166136261;
    for (let i = 0; i < String(s).length; i++) h = Math.imul(h ^ String(s).charCodeAt(i), 16777619);
    return h >>> 0;
}

/** A small generator seeded by a string (mulberry32). */
function _rng(seed) {
    let a = _strHash(seed);
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _holdings(player) {
    if (!player.lotHoldings) player.lotHoldings = [];
    return player.lotHoldings;
}

function _settlementAt(world, q, r) {
    const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
    return (t && t.settlement) || null;
}

/** The holding's id within its town: a lot's id, or a house's key. */
const _ref = h => (h.kind === 'lot' ? h.id : h.key);

function _findHolding(player, q, r, ref) {
    return _holdings(player || {}).find(h => h.q === q && h.r === r && _ref(h) === ref) || null;
}

/** A townsperson to take a house: one of the town's people (systems/townsfolk.js roll), else a name from the data. */
function _tenantName(s, rnd, A) {
    const folk = s && s.folk;
    const people = folk && Array.isArray(folk.people) ? folk.people.filter(p => p && p.died == null && !p.away && p.role !== 'child' && p.first) : [];
    if (people.length) {
        const p = people[Math.floor(rnd() * people.length)];
        return `${p.first} ${p.last || ''}`.trim();
    }
    const names = Array.isArray(A.buyers) && A.buyers.length ? A.buyers : ['a townsman'];
    return names[Math.floor(rnd() * names.length)];
}

/** The month's rents (player.lotRentBook): taken from tenants and paid as one. */
function _rentBook(player, day) {
    let b = player.lotRentBook;
    if (!b || typeof b !== 'object') b = player.lotRentBook = { since: day, collected: 0, from: [], paid: 0, paidFor: [], missed: 0 };
    if (!Array.isArray(b.from)) b.from = [];
    if (!Array.isArray(b.paidFor)) b.paidFor = [];
    return b;
}

export const Lots = {
    config() { return LotBook.config(); },

    // ──────────── LOTS ────────────

    /**
     * Buy a free lot.
     * @param {object} lot { id, w, h } (from the town map)
     */
    buyLot(player, world, settlement, lot) {
        if (!player || !settlement || !lot) return { success: false, reason: 'There is no lot here.' };
        const law = Laws.mayHoldLand(world, player, settlement.kingdom);
        if (!law.ok) return { success: false, reason: law.reason };
        const book = LotBook.of(settlement);
        if (book.lots[lot.id]) return { success: false, reason: `This lot is already ${LotBook.isPlayer(book.lots[lot.id]) ? 'yours' : `sold to ${book.lots[lot.id].holderName}`}.` };
        const price = LotBook.lotPrice(settlement.type, lot.w, lot.h);
        if (!Number.isFinite(price) || price < 0) return { success: false, reason: 'This lot has no price.' };
        if (_num(player.gold) < price) return { success: false, reason: `The lot costs ${price}g; you have ${Math.floor(_num(player.gold))}g.` };
        player.gold -= price;
        Ledger.record(player, 'townLand', -price);
        book.lots[lot.id] = { holder: 'player', holderName: player.name || 'You', price, day: _day(world), built: null };
        _holdings(player).push({ kind: 'lot', q: settlement.q, r: settlement.r, id: lot.id, town: settlement.name, price });
        return { success: true, price, text: `You buy the lot (${lot.w}×${lot.h}) in ${settlement.name} for ${price}g. Build on it when you will.` };
    },

    /** The player's property now stands on their lot. */
    buildOnLot(player, world, settlement, lotId, property) {
        const rec = LotBook.lot(settlement, lotId);
        if (!LotBook.isPlayer(rec)) return false;
        return LotBook.bindProperty(settlement, lotId, property, _day(world), (player && player.name) || 'You');
    },

    /**
     * The lot a new property in this town would stand on: the one asked for (opts.lotId,
     * a lot of the player's chosen on the town map), else a bare lot they hold, else the
     * cheapest free lot (bought at its price).
     * → { ok, lotId, price, w, h, reason }
     */
    lotForProperty(player, settlement, opts = {}) {
        if (!settlement) return { ok: false, reason: 'There is no town here.' };
        if (opts.lotId) {
            // (a free lot named outright is bought with the build)
            const free = !LotBook.lot(settlement, opts.lotId) && LotBook.freeLots(settlement).find(l => l.id === opts.lotId);
            if (free) return { ok: true, lotId: free.id, price: free.price, w: free.w, h: free.h };
            const ok = this.canBuildOnLot(settlement, opts.lotId);
            return ok.ok ? { ok: true, lotId: opts.lotId, price: 0 } : { ok: false, reason: ok.reason };
        }
        const bare = LotBook.bareLotsOfPlayer(settlement);
        if (bare.length) return { ok: true, lotId: bare[0], price: 0 };
        const free = LotBook.freeLots(settlement).sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1));
        if (!free.length) return { ok: false, reason: `Every building lot in ${settlement.name || 'town'} is taken; land in town goes by the lot.` };
        const f = free[0];
        return { ok: true, lotId: f.id, price: f.price, w: f.w, h: f.h };
    },

    /**
     * A property just built in a town takes its lot (buying it when it is a free one):
     * the lot's built record is the property, property.lotId the lot.
     * → { success, lotId, price, reason }
     */
    claimLotForProperty(player, world, settlement, property, opts = {}) {
        const at = this.lotForProperty(player, settlement, opts);
        if (!at.ok) return { success: false, reason: at.reason };
        const book = LotBook.of(settlement);
        if (!book.lots[at.lotId]) {
            if (_num(player && player.gold) < at.price) return { success: false, reason: `A building lot in ${settlement.name} costs ${at.price}g.` };
            player.gold = _num(player.gold) - at.price;
            Ledger.record(player, 'townLand', -at.price);
            book.lots[at.lotId] = { holder: 'player', holderName: player.name || 'You', price: at.price, day: _day(world), built: null };
            _holdings(player).push({ kind: 'lot', q: settlement.q, r: settlement.r, id: at.lotId, town: settlement.name, price: at.price });
        }
        if (!this.buildOnLot(player, world, settlement, at.lotId, property)) return { success: false, reason: 'That lot is not yours.' };
        return { success: true, lotId: at.lotId, price: at.price };
    },

    /** May the player build on this lot (theirs, and nothing stands on it yet)? */
    canBuildOnLot(settlement, lotId) {
        const rec = LotBook.lot(settlement, lotId);
        if (!rec) return { ok: false, reason: 'Buy the lot first.' };
        if (!LotBook.isPlayer(rec)) return { ok: false, reason: `This lot belongs to ${rec.holderName}.` };
        if (rec.built) return { ok: false, reason: `Your ${rec.built.name || 'building'} already stands here.` };
        return { ok: true };
    },

    /** Raise a house to let on the player's own lot: gold now, standing after the builders' days. */
    buildHouseOnLot(player, world, settlement, lotId) {
        if (!player || !settlement) return { success: false, reason: 'There is no lot here.' };
        const ok = this.canBuildOnLot(settlement, lotId);
        if (!ok.ok) return { success: false, reason: ok.reason };
        const cost = LotBook.houseCost(settlement.type);
        if (_num(player.gold) < cost) return { success: false, reason: `Masons and timber for a house come to ${cost}g; you have ${Math.floor(_num(player.gold))}g.` };
        player.gold -= cost;
        Ledger.record(player, 'townLand', -cost);
        const days = LotBook.houseDays(settlement.type);
        const rec = LotBook.lot(settlement, lotId);
        rec.built = { type: 'house', kind: 'house', name: 'House', by: 'player', readyDay: _day(world) + days, cost, let: true, tenant: null };
        return { success: true, cost, days, text: `Masons set to work on a house on your lot in ${settlement.name} (${cost}g). It stands in ${days} days, and goes to let as soon as it does.` };
    },

    // ──────────── VACANT HOUSES ────────────

    rentHouse(player, world, settlement, key, name = 'the house') {
        const book = LotBook.of(settlement);
        if (!player || !key) return { success: false, reason: 'No house here.' };
        if (book.vacancies[key]) return { success: false, reason: 'Someone has taken it already.' };
        const law = Laws.mayHoldLand(world, player, settlement.kingdom);
        if (!law.ok) return { success: false, reason: law.reason };
        const rent = LotBook.rentPerDay(settlement.type);
        if (_num(player.gold) < rent) return { success: false, reason: `The first day's rent is ${rent}g.` };
        player.gold -= rent;
        Ledger.record(player, 'townRent', -rent);
        book.vacancies[key] = { status: 'rented', holder: 'player', holderName: player.name || 'You', rent, day: _day(world) };
        _holdings(player).push({ kind: 'rent', q: settlement.q, r: settlement.r, key, town: settlement.name, rent, name });
        return { success: true, text: `You take ${name} in ${settlement.name} at ${rent}g a day, paid at each day's end.` };
    },

    buyHouse(player, world, settlement, key, name = 'the house') {
        const book = LotBook.of(settlement);
        if (!player || !key) return { success: false, reason: 'No house here.' };
        const v = book.vacancies[key];
        if (v && v.holder !== 'player') return { success: false, reason: 'Someone has taken it already.' };
        const law = Laws.mayHoldLand(world, player, settlement.kingdom);
        if (!law.ok) return { success: false, reason: law.reason };
        if (v && v.status === 'owned') return { success: false, reason: 'It is yours already.' };
        const price = LotBook.salePrice(settlement.type);
        if (_num(player.gold) < price) return { success: false, reason: `The house costs ${price}g.` };
        player.gold -= price;
        Ledger.record(player, 'townLand', -price);
        book.vacancies[key] = { status: 'owned', holder: 'player', holderName: player.name || 'You', price, day: _day(world) };
        const hs = _holdings(player).filter(h => !(h.kind === 'rent' && h.key === key && h.q === settlement.q && h.r === settlement.r));
        hs.push({ kind: 'house', q: settlement.q, r: settlement.r, key, town: settlement.name, price, name });
        player.lotHoldings = hs;
        return { success: true, text: `${name} in ${settlement.name} is yours for ${price}g.` };
    },

    leaveHouse(player, world, settlement, key) {
        const book = LotBook.of(settlement);
        const v = book.vacancies[key];
        if (!v || v.holder !== 'player' || v.status !== 'rented') return { success: false, reason: 'You don\'t rent this house.' };
        delete book.vacancies[key];
        player.lotHoldings = _holdings(player).filter(h => !(h.kind === 'rent' && h.key === key && h.q === settlement.q && h.r === settlement.r));
        return { success: true, text: 'You hand back the key. The house stands empty again.' };
    },

    // ──────────── YOUR HOUSES TO LET ────────────

    /**
     * The record that carries a holding's letting (a bought house's vacancy,
     * or the house on a lot), with whether it stands yet; null when the
     * holding is no house of the player's own.
     */
    _letRecord(world, h) {
        const s = h && _settlementAt(world, h.q, h.r);
        if (!s) return null;
        if (h.kind === 'house') {
            const v = LotBook.vacancy(s, h.key);
            if (!v || v.holder !== 'player' || v.status !== 'owned') return null;
            return { s, rec: v, ready: true };
        }
        if (h.kind === 'lot') {
            const rec = LotBook.lot(s, h.id);
            const b = rec && LotBook.isPlayer(rec) ? rec.built : null;
            if (!b || b.kind !== 'house') return null;
            return { s, rec: b, ready: b.readyDay == null || _day(world) >= b.readyDay };
        }
        return null;
    },

    /** Offer one of your houses to let (a tenant is found within days). */
    letHouse(player, world, q, r, ref) {
        const lr = this._letRecord(world, _findHolding(player, q, r, ref));
        if (!lr) return { success: false, reason: 'You have no house there to let.' };
        if (lr.rec.tenant) return { success: false, reason: `${lr.rec.tenant.name} lives there already.` };
        lr.rec.let = true;
        return { success: true, text: `The house in ${lr.s.name} is to let at ${this.rentFor(lr.s)}g a day. Word goes round the town.` };
    },

    /** Take a house off the letting (only with no tenant in it). */
    stopLetting(player, world, q, r, ref) {
        const lr = this._letRecord(world, _findHolding(player, q, r, ref));
        if (!lr) return { success: false, reason: 'You have no house there.' };
        if (lr.rec.tenant) return { success: false, reason: `${lr.rec.tenant.name} lives there: put them out first.` };
        lr.rec.let = false;
        return { success: true, text: `The house in ${lr.s.name} is no longer to let.` };
    },

    /** Put the tenant out (their arrears are lost); the house stays to let. */
    evictTenant(player, world, q, r, ref) {
        const lr = this._letRecord(world, _findHolding(player, q, r, ref));
        const t = lr && lr.rec.tenant;
        if (!t) return { success: false, reason: 'No one rents that house from you.' };
        lr.rec.tenant = null;
        const owed = _num(t.owed);
        return { success: true, text: `${t.name} is put out of your house in ${lr.s.name}${owed ? `, ${owed}g of rent still unpaid` : ''}. It is to let again.` };
    },

    /** A tenant's daily rent in a town. */
    rentFor(settlement) {
        const L = this.config().letting || {};
        return Math.max(1, Math.round(LotBook.rentPerDay(settlement && settlement.type) * _num(L.rentMult, 1)));
    },

    // ──────────── SELLING ────────────

    _sellBack() { return Math.max(0, Math.min(1, _num(this.config().sellBack, 0.75))); },

    /** What a lot (with any house you raised on it) or a bought house fetches. */
    saleValue(world, h) {
        const s = h && _settlementAt(world, h.q, h.r);
        if (!s) return 0;
        if (h.kind === 'lot') {
            const rec = LotBook.lot(s, h.id);
            if (!LotBook.isPlayer(rec)) return 0;
            const house = rec.built && rec.built.kind === 'house' ? _num(rec.built.cost) : 0;
            return Math.round((_num(rec.price, _num(h.price, 0)) + house) * this._sellBack());
        }
        if (h.kind === 'house') return Math.round(_num(h.price, LotBook.salePrice(s.type)) * this._sellBack());
        return 0;
    },

    /**
     * Sell a lot. Bare, it goes back on the market; with your house on it, a
     * townsperson buys the two (and keeps any tenant). Not while a property of
     * yours (a workshop, a shop...) stands on it.
     */
    sellLot(player, world, q, r, lotId) {
        const h = _findHolding(player, q, r, lotId);
        const s = h && _settlementAt(world, q, r);
        const rec = s && LotBook.lot(s, lotId);
        if (!h || h.kind !== 'lot' || !LotBook.isPlayer(rec)) return { success: false, reason: 'That lot is not yours.' };
        if (rec.built && rec.built.kind !== 'house') return { success: false, reason: `Your ${rec.built.name || 'building'} stands on it: it goes with the property.` };
        const value = this.saleValue(world, h);
        const day = _day(world);
        if (rec.built) {
            const who = _tenantName(null, _rng(`${day}|sell|${s.name}|${lotId}`), this.config().ai || {});
            s.lotBook.lots[lotId] = { holder: `npc:${who}`, holderName: who, price: value, day, built: { type: 'house', by: `npc:${who}`, readyDay: rec.built.readyDay } };
        } else {
            delete s.lotBook.lots[lotId];
        }
        player.gold = _num(player.gold) + value;
        Ledger.record(player, 'townLand', value);
        player.lotHoldings = _holdings(player).filter(x => x !== h);
        return { success: true, value, text: `You sell your lot${rec.built ? ' and its house' : ''} in ${s.name} for ${value}g.` };
    },

    /** Sell a house you bought: a townsperson takes it (and any tenant with it). */
    sellHouse(player, world, q, r, key) {
        const h = _findHolding(player, q, r, key);
        const s = h && _settlementAt(world, q, r);
        const v = s && LotBook.vacancy(s, key);
        if (!h || h.kind !== 'house' || !v || v.holder !== 'player' || v.status !== 'owned') return { success: false, reason: 'That house is not yours.' };
        const value = this.saleValue(world, h);
        const day = _day(world);
        const who = _tenantName(null, _rng(`${day}|sellh|${s.name}|${key}`), this.config().ai || {});
        s.lotBook.vacancies[key] = { status: 'owned', holder: `npc:${who}`, holderName: who, price: value, day };
        player.gold = _num(player.gold) + value;
        Ledger.record(player, 'townLand', value);
        player.lotHoldings = _holdings(player).filter(x => x !== h);
        return { success: true, value, text: `${h.name || 'Your house'} in ${h.town} is sold to ${who} for ${value}g.` };
    },

    // ──────────── THE PANEL ────────────

    /**
     * Every lot and house of the player's, as the panel shows them:
     * [{ kind, q, r, ref, town, name, state ('empty'|'building'|'built'|'rented'|'owned'),
     *    what, daysLeft, rent, paidDay, tenant, owed, missed, letting, ready, value, houseCost,
     *    canBuildHouse, canLet, canStopLetting, canEvict, canSell, canLeave }]
     */
    holdingsView(world, player) {
        const out = [];
        const day = _day(world);
        for (const h of _holdings(player || {})) {
            const s = _settlementAt(world, h.q, h.r);
            if (!s) continue;
            const row = {
                kind: h.kind, q: h.q, r: h.r, ref: _ref(h), town: s.name || h.town, name: h.name || null, state: 'empty', what: null, daysLeft: 0,
                rent: null, paidDay: null, tenant: null, owed: 0, missed: 0, letting: false, ready: true, value: 0, houseCost: 0,
                canBuildHouse: false, canLet: false, canStopLetting: false, canEvict: false, canSell: false, canLeave: false,
            };
            if (h.kind === 'lot') {
                const rec = LotBook.lot(s, h.id);
                if (!LotBook.isPlayer(rec)) continue;
                row.name = `Lot ${String(h.id).replace(/^lot/, '#')}`;
                const b = rec.built;
                if (!b) {
                    row.canBuildHouse = true;
                    row.houseCost = LotBook.houseCost(s.type);
                    row.canSell = true;
                } else if (b.kind === 'house') {
                    row.what = 'a house to let';
                    row.ready = b.readyDay == null || day >= b.readyDay;
                    row.state = row.ready ? 'built' : 'building';
                    row.daysLeft = row.ready ? 0 : b.readyDay - day;
                    row.canSell = true;
                } else {
                    const prop = this._lotProperty(world, h, h.id);
                    row.what = b.name || String(b.type || 'building').replace(/_/g, ' ');
                    const building = prop ? !!prop.underConstruction : false;
                    row.state = building ? 'building' : 'built';
                    row.daysLeft = building ? _num(prop.constructionDaysLeft) : 0;
                }
            } else if (h.kind === 'rent') {
                const v = LotBook.vacancy(s, h.key);
                if (!v || v.holder !== 'player') continue;
                row.state = 'rented';
                row.rent = _num(v.rent, LotBook.rentPerDay(s.type));
                row.paidDay = v.paidDay != null ? v.paidDay : v.day;
                row.canLeave = true;
            } else if (h.kind === 'house') {
                const v = LotBook.vacancy(s, h.key);
                if (!v || v.holder !== 'player') continue;
                row.state = 'owned';
                row.canSell = true;
            }
            const lr = this._letRecord(world, h);
            if (lr) {
                const t = lr.rec.tenant;
                row.letting = !!lr.rec.let;
                if (t) {
                    row.tenant = t.name;
                    row.rent = _num(t.rent, this.rentFor(s));
                    row.paidDay = t.paidDay != null ? t.paidDay : null;
                    row.owed = _num(t.owed);
                    row.missed = _num(t.missed);
                    row.canEvict = true;
                } else {
                    row.rent = this.rentFor(s);
                    row.canLet = lr.ready && !lr.rec.let;
                    row.canStopLetting = !!lr.rec.let;
                }
            }
            if (row.canSell) row.value = this.saleValue(world, h);
            out.push(row);
        }
        return out;
    },

    /** The player's property standing on a lot (for its construction days), if any. */
    _lotProperty(world, h, lotId) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(h.q, h.r) : null;
        const props = (t && t.playerProperties) || [];
        return props.find(p => p && p.lotId === lotId) || null;
    },

    // ──────────── THE DAY ────────────

    /**
     * Rent day, and the town's other buyers.
     * @returns {{ notices: Array<{icon,title,text,type}> }}
     */
    processDay(world, player) {
        const notices = [];
        const day = _day(world);
        if (player && Array.isArray(player.lotHoldings)) this._rentDay(world, player, day, notices);
        this._aiDay(world, player, day, notices);
        return { notices };
    },

    _rentDay(world, player, day, notices) {
        const book = _rentBook(player, day);
        const keep = [];
        for (const h of player.lotHoldings) {
            if (h.kind !== 'rent') {
                keep.push(h);
                this._tenantDay(world, player, h, day, book, notices);
                continue;
            }
            const s = _settlementAt(world, h.q, h.r);
            const v = s && LotBook.vacancy(s, h.key);
            if (!v || v.holder !== 'player') continue;
            if (v.day === day) { keep.push(h); continue; }
            const rent = _num(v.rent, LotBook.rentPerDay(s.type));
            if (_num(player.gold) >= rent) {
                player.gold -= rent;
                Ledger.record(player, 'townRent', -rent);
                v.paidDay = day;
                book.paid += rent;
                const k = `${h.q},${h.r}|${h.key}`;
                if (!book.paidFor.includes(k)) book.paidFor.push(k);
                keep.push(h);
            } else {
                delete s.lotBook.vacancies[h.key];
                notices.push({ icon: '🏚️', title: 'Put Out', text: `You couldn't find the ${rent}g rent for ${h.name || 'your house'} in ${h.town}. The landlord has changed the locks.`, type: 'warning' });
            }
        }
        player.lotHoldings = keep;
        this._monthOfRents(player, day, book, notices);
    },

    /** One of your houses to let, for a day: a tenant found, rent paid or missed, a tenant who slips away. */
    _tenantDay(world, player, h, day, book, notices) {
        const lr = this._letRecord(world, h);
        if (!lr || !lr.ready) return;
        const { s, rec } = lr;
        const L = this.config().letting || {};
        const rnd = _rng(`${day}|let|${s.name}|${s.q},${s.r}|${_ref(h)}`);
        const where = `your house in ${s.name}`;
        if (!rec.tenant) {
            if (!rec.let || rnd() >= _num(L.tenantChance, 0.12)) return;
            const name = _tenantName(s, rnd, this.config().ai || {});
            rec.tenant = { name, since: day, rent: this.rentFor(s), paidDay: null, owed: 0, missed: 0 };
            notices.push({ icon: '🔑', title: 'A Tenant', text: `${name} takes ${where} at ${rec.tenant.rent}g a day.`, type: 'info' });
            return;
        }
        const t = rec.tenant;
        if (t.since === day) return;
        const rent = _num(t.rent, this.rentFor(s));
        const miss = _num(L.missChance, 0.03) * (_num(t.missed) > 0 ? _num(L.behindMult, 6) : 1);
        if (rnd() < Math.min(1, miss)) {
            t.missed = _num(t.missed) + 1;
            t.owed = _num(t.owed) + rent;
            book.missed = _num(book.missed) + 1;
            if (t.missed >= _num(L.leaveAfterMissed, 10)) {
                rec.tenant = null;
                notices.push({ icon: '🏚️', title: 'A Tenant Gone', text: `${t.name} has slipped away from ${where} by night, owing you ${t.owed}g. The house is to let again.`, type: 'warning' });
            } else if (t.missed === 1) {
                notices.push({ icon: '⚠️', title: 'Rent Unpaid', text: `${t.name} couldn't pay the ${rent}g rent on ${where} today.`, type: 'warning' });
            } else if (t.missed % Math.max(1, _num(L.warnEvery, 5)) === 0) {
                notices.push({ icon: '⚠️', title: 'Rent in Arrears', text: `${t.name} is ${t.missed} days behind on ${where} and owes you ${t.owed}g. Put them out, or wait on them.`, type: 'warning' });
            }
            return;
        }
        const back = Math.min(_num(t.owed), rent);
        const amount = rent + back;
        t.owed = _num(t.owed) - back;
        t.missed = 0;
        t.paidDay = day;
        player.gold = _num(player.gold) + amount;
        Ledger.record(player, 'townRentIncome', amount);
        book.collected += amount;
        const k = `${h.q},${h.r}|${_ref(h)}`;
        if (!book.from.includes(k)) book.from.push(k);
    },

    /** Every summaryDays: the rents taken and paid since the last word. */
    _monthOfRents(player, day, book, notices) {
        const L = this.config().letting || {};
        if (day - _num(book.since, day) < Math.max(1, _num(L.summaryDays, 30))) return;
        const parts = [];
        const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
        if (book.collected > 0) parts.push(`Rents collected: ${Math.round(book.collected)}g from ${n(book.from.length, 'house', 'houses')}.`);
        if (book.paid > 0) parts.push(`Rent paid: ${Math.round(book.paid)}g for ${n(book.paidFor.length, 'house', 'houses')}.`);
        if (book.missed > 0) parts.push(`${n(book.missed, 'day', 'days')} of rent went unpaid.`);
        if (parts.length) notices.unshift({ icon: '📜', title: 'Rents of the Month', text: parts.join(' '), type: 'info' });
        player.lotRentBook = { since: day, collected: 0, from: [], paid: 0, paidFor: [], missed: 0 };
    },

    _aiDay(world, player, day, notices) {
        if (!world || typeof world.getSettlementViews !== 'function') return;
        const C = this.config();
        const A = C.ai || {};
        const rivals = Object.values((player && player.house && player.house.rivals) || {}).filter(Boolean);
        for (const view of world.getSettlementViews() || []) {
            const s = _settlementAt(world, view.q, view.r) || view;
            if (!s || !s.type) continue;
            const rnd = _rng(`${day}|${s.name}|${s.q},${s.r}`);
            const book = s.lotBook;
            // A free lot bought
            if (rnd() < _num((A.buyChance || {})[s.type], 0)) {
                const known = book && book.known && Array.isArray(book.known.lots) ? book.known.lots : null;
                const ids = known ? known.map(l => l.id) : LotBook.lotIds(s.type);
                const free = ids.filter(id => !LotBook.lot(s, id));
                if (free.length) {
                    const id = free[Math.floor(rnd() * free.length)];
                    const geo = (known || []).find(l => l.id === id) || { w: 6, h: 5 };
                    const price = LotBook.lotPrice(s.type, geo.w, geo.h);
                    const rival = rivals.find(r => r.kingdomId === s.kingdom && _num(r.gold) >= price + 200);
                    const builds = Array.isArray(A.builds) && A.builds.length ? A.builds : ['house'];
                    const type = builds[Math.floor(rnd() * builds.length)];
                    let holder, holderName;
                    if (rival) {
                        rival.gold -= price;
                        holder = `rival:${rival.kingdomId}`;
                        holderName = rival.name;
                        notices.push({ icon: '🏗️', title: 'A Rival Builds', text: `${rival.name} buys a building lot in ${s.name} and sets masons to work on a ${type}.`, type: 'info' });
                    } else {
                        const names = Array.isArray(A.buyers) && A.buyers.length ? A.buyers : ['a townsman'];
                        holderName = names[Math.floor(rnd() * names.length)];
                        holder = `npc:${holderName}`;
                    }
                    LotBook.of(s).lots[id] = { holder, holderName, price, day, built: { type, by: holder, readyDay: day + _num(A.buildDays, 20) } };
                }
            }
            // Houses taken and left (only where the town's houses are known)
            const keys = book && book.known && Array.isArray(book.known.vacancies) ? book.known.vacancies : [];
            for (const key of keys) {
                const v = LotBook.vacancy(s, key);
                if (!v && rnd() < _num(A.rentChance, 0.02)) {
                    const names = Array.isArray(A.buyers) && A.buyers.length ? A.buyers : ['a townsman'];
                    const who = names[Math.floor(rnd() * names.length)];
                    LotBook.of(s).vacancies[key] = { status: 'rented', holder: `npc:${who}`, holderName: who, rent: LotBook.rentPerDay(s.type), day };
                } else if (v && v.holder !== 'player' && v.status === 'rented' && rnd() < _num(A.leaveChance, 0.006)) {
                    delete book.vacancies[key];
                }
            }
        }
    },
};
