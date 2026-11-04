// ============================================
// LOTS — buying building land and vacant houses in town
// ============================================
// A town's building lots and vacant houses (world/lotBook.js; laid out by
// world/townPlanner.js, shown on the town map by world/innerMap/lots.js) are
// for anyone to buy: the player, a rival House of the realm (out of its
// purse), or a townsman. The player builds only within a lot they hold.
//
//   buyLot / buildOnLot      a lot, and the player's property standing on it
//   rentHouse / buyHouse     a vacant house: by the day, or outright
//   leaveHouse               give up a rented house
//   processDay               rent day for the player's houses (miss it and
//                            you're put out); the AI buys free lots and
//                            raises buildings on them, takes and leaves houses
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
        rec.built = { type: property && property.type, name: property && property.name, by: 'player', readyDay: _day(world) };
        return true;
    },

    /** May the player build on this lot (theirs, and nothing stands on it yet)? */
    canBuildOnLot(settlement, lotId) {
        const rec = LotBook.lot(settlement, lotId);
        if (!rec) return { ok: false, reason: 'Buy the lot first.' };
        if (!LotBook.isPlayer(rec)) return { ok: false, reason: `This lot belongs to ${rec.holderName}.` };
        if (rec.built) return { ok: false, reason: `Your ${rec.built.name || 'building'} already stands here.` };
        return { ok: true };
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
        const keep = [];
        for (const h of player.lotHoldings) {
            if (h.kind !== 'rent') { keep.push(h); continue; }
            const s = _settlementAt(world, h.q, h.r);
            const v = s && LotBook.vacancy(s, h.key);
            if (!v || v.holder !== 'player') continue;
            if (v.day === day) { keep.push(h); continue; }
            const rent = _num(v.rent, LotBook.rentPerDay(s.type));
            if (_num(player.gold) >= rent) {
                player.gold -= rent;
                Ledger.record(player, 'townRent', -rent);
                v.paidDay = day;
                keep.push(h);
            } else {
                delete s.lotBook.vacancies[h.key];
                notices.push({ icon: '🏚️', title: 'Put Out', text: `You couldn't find the ${rent}g rent for ${h.name || 'your house'} in ${h.town}. The landlord has changed the locks.`, type: 'warning' });
            }
        }
        player.lotHoldings = keep;
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
