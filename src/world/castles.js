// ============================================
// CASTLES — the age of stone keeps comes late
// ============================================
// For most of the world's history a realm's seat is a lord's great hall, not
// a castle. Castles arrive in an era (data/seats.json → castles.startYear) and
// roll in slowly: each capital is due its castle in a year of its own, a
// hash of the town within `spread` years of the era's start, and raises it
// when that year has come and its crown can pay the builders (cost, from the
// treasury into the capital's purse: masons, carters and quarrymen are paid
// in town). A world made after a capital's year starts with its castle
// standing (it was built long ago, paid for long ago).
//
// State: settlement.castle (true: it stands; false: a great hall; absent on
// towns that are not capitals, and on older saves' capitals, which keep the
// castle they always had). Read by:
//   - the town map's layout (world/innerMap/state.js settlementLayout: a
//     capital without its castle keeps its seat in a manor, the great hall)
//     and its cache (terrain.js: the map is laid out anew when the castle rises)
//   - the overworld sprite (ui/renderer/features.js: the walled city once
//     the castle stands, a great unwalled town before)
// sync(world) runs at world creation and each new year (World._advanceDay).
// Pure world model: no RNG (hashes), no imports above world/.

import { DataLoader } from '../core/dataLoader.js';
import { Economy } from './economy.js';

const DEFAULTS = { startYear: 650, spread: 150, cost: 1500, buildYears: 1 };

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _hash01(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 100000) / 100000;
}

export const Castles = {
    config() {
        const s = DataLoader._gamedata && DataLoader._gamedata.seats;
        return { ...DEFAULTS, ...((s && s.castles) || {}) };
    },

    /** The year this capital is due its castle (a hash of the town). */
    dueYear(settlement) {
        const C = Castles.config();
        const key = `${settlement && settlement.name}|${settlement && settlement.q},${settlement && settlement.r}|castle`;
        return Math.round(_num(C.startYear, 650) + _hash01(key) * _num(C.spread, 150));
    },

    /** Does this settlement have a castle? (Only capitals do; an older save's capital keeps its own.) */
    has(settlement) {
        if (!settlement || settlement.type !== 'capital') return false;
        return settlement.castle !== false;
    },

    /**
     * Bring every capital's castle up to the world's year. At creation
     * (opts.creating) a capital past its year starts with the castle standing;
     * in play it rises only when the crown can pay. → [{ settlement, kingdom }] raised.
     */
    sync(world, opts = {}) {
        const out = [];
        if (!world || typeof world.getSettlementViews !== 'function') return out;
        const C = Castles.config();
        const year = _num(world.year, _num(world.baseYear, 853));
        for (const v of world.getSettlementViews()) {
            const tile = world.getTile && world.getTile(v.q, v.r);
            const s = tile && tile.settlement;
            if (!s) continue;
            if (s.type !== 'capital') {
                // (a capital fallen to a lesser rank keeps no castle flag of its own)
                if (s.castle != null && s.type !== 'capital') delete s.castle;
                continue;
            }
            if (s.castle === true) continue;
            const due = Castles.dueYear({ name: s.name, q: v.q, r: v.r });
            if (year < due) {
                if (opts.creating || s.castle == null) s.castle = false;
                continue;
            }
            // (made after its year: it stands, as it always has: no flag, so a full-grown world is unchanged)
            if (opts.creating) continue;
            // (no flag: a castle standing since the world was made, or an older save's — never raised again)
            if (s.castle == null) continue;
            // In play: a castle takes buildYears to raise. Each year the crown
            // pays that year's share of the cost to the builders in town; a
            // year it cannot pay, the work stands still. (State: s.castleWorks)
            const k = s.kingdom != null && world.getKingdom ? world.getKingdom(s.kingdom) : null;
            const cost = _num(C.cost, 1500);
            const years = Math.max(1, Math.round(_num(C.buildYears, 1)));
            const works = s.castleWorks && typeof s.castleWorks === 'object' ? s.castleWorks : null;
            if (works && works.lastYear === year) { s.castle = false; continue; }
            const part = Math.ceil(cost / years);
            if (k) {
                if (_num(k.treasury) < part) { s.castle = false; continue; }
                k.treasury = _num(k.treasury) - part;
                Economy.payTown(s, part);
            }
            const w = works || (s.castleWorks = { begun: year, years, done: 0 });
            w.done = _num(w.done) + 1;
            w.lastYear = year;
            if (w.done < years) {
                s.castle = false;
                if (!works && Array.isArray(world.events)) {
                    world.events.push({ text: `🏗️ ${k ? k.name : 'Its lords'} begin a castle of stone at ${s.name}: ${years} years of work.`, type: 'growth' });
                }
                continue;
            }
            delete s.castleWorks;
            s.castle = true;
            out.push({ settlement: s, kingdom: k });
            if (Array.isArray(world.events)) {
                world.events.push({ text: `🏰 ${k ? k.name : 'Its lords'} raise a castle of stone at ${s.name}.`, type: 'growth' });
            }
        }
        return out;
    },
};
