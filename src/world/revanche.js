// ============================================
// REVANCHE — every realm remembers the towns it lost
// ============================================
// When a town changes hands by war (KingdomAI.takeTile; a peace that cedes it,
// KingdomAI.cedeTown; a fallen realm's rising, KingdomAI.restoreKingdom; the
// player storming a town for his liege), the realm that lost it writes it down
// on kingdom.lostTowns: [{ q, r, name, by, byName, day, capital, native }] —
// who took it, when, whether it was the realm's seat when it fell, and whether
// it was the realm's own town (native) or one it had itself taken from another.
// Saved with the kingdom (saveLoad _pickDefined).
//
// Each record weighs as a claim on whoever holds the town now (claims / claimOn):
// a town 1, the capital it lost capitalWeight, a town it had only held by
// conquest conqueredShare of that; halving every halfLifeYears (a lost capital
// every capitalHalfLifeYears). Under minWeight, or once the town is back, it is
// forgotten (prune).
//
// Read by:
//   KingdomAI.considerWar    a claim is a casus belli on the holder: the court's
//                            grudge runs warmer (grudgePer), it marches at a
//                            lower strength (easePer, up to maxEase) and picks a
//                            holder of its towns before any other foe
//   KingdomAI.considerNeighbours  the claimant's regard of the holder sours weekly
//   KingdomAI.startWar       a war on a holder is a reclaim war (warState.reclaim):
//                            won once every claimed town it held is retaken
//   KingdomAI.endWar         the victor's peace may return a claimed town
//                            (reclaimReturn in a reclaim war, else peaceReturn)
//   PeasantRevolts.pressure  the town's people remember the old crown ('oldCrown')
//   Throne / the Royal Court's Realm tab, CourtLetters ('reclaim_urged'), the
//   soak bot (playtest/bot.js reclaimWeek) — the player's realm alike.
// No RNG: the peace's roll is a hash of the day and the pair. Content:
// data/kingship.json config.revanche.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';

const YEAR = 120;
const DEFAULTS = {
    enabled: true,
    townWeight: 1, capitalWeight: 3, conqueredShare: 0.35,
    halfLifeYears: 12, capitalHalfLifeYears: 40, minWeight: 0.1, maxRecords: 16, maxClaim: 4,
    grudgePer: 8, grudgeCap: 20, easePer: 0.08, maxEase: 0.25,
    sourPer: 1, sourCap: 3, sourFloor: -60,
    peaceReturn: 0.4, reclaimReturn: 1,
    urge: { minWeight: 0.8, everyDays: 360, ratio: 1.1, expiry: 30 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _same = (a, b) => a != null && b != null && String(a) === String(b);
const _day = (world) => (world && Number.isFinite(world.day) ? world.day : 0);

export const Revanche = {
    YEAR,

    config() {
        const k = DataLoader.kingship || (DataLoader._gamedata && DataLoader._gamedata.kingship) || {};
        const c = (k.config && k.config.revanche) || {};
        return { ...DEFAULTS, ...c, urge: { ...DEFAULTS.urge, ...(c.urge || {}) } };
    },

    enabled() { return Revanche.config().enabled !== false; },

    /** The realm's records (kingdom.lostTowns), created on use. */
    list(kingdom) {
        if (!kingdom) return [];
        if (!Array.isArray(kingdom.lostTowns)) kingdom.lostTowns = [];
        return kingdom.lostTowns;
    },

    /**
     * `loser` lost the town at q,r (settlement `s`) to `taker`. Call before the
     * town's crown changes (its seat and settlement.formerKingdom are read as
     * they were). → the record, or null.
     */
    record(world, loser, taker, s, q, r) {
        if (!loser || !s || !Revanche.enabled()) return null;
        const C = Revanche.config();
        // (the old records pruned first: the town still flies the loser's banner as this is written)
        Revanche.list(loser);
        Revanche.prune(world, loser);
        const list = loser.lostTowns.filter(e => e && !(e.q === q && e.r === r));
        const rec = {
            q, r, name: s.name || 'a town',
            by: taker ? taker.id : null, byName: taker ? taker.name : null,
            day: _day(world),
            capital: !!(loser.capital && loser.capital.q === q && loser.capital.r === r),
            native: s.formerKingdom == null || _same(s.formerKingdom, loser.id),
        };
        list.push(rec);
        loser.lostTowns = list;
        if (loser.lostTowns.length > C.maxRecords) {
            // (the lightest go first)
            loser.lostTowns.sort((a, b) => Revanche.weight(world, loser, b) - Revanche.weight(world, loser, a));
            loser.lostTowns.length = C.maxRecords;
        }
        return rec;
    },

    /** `k` holds the town at q,r again: its record is struck. → the record it had, or null. */
    regained(world, k, q, r) {
        if (!k || !Array.isArray(k.lostTowns)) return null;
        const i = k.lostTowns.findIndex(e => e && e.q === q && e.r === r);
        if (i < 0) return null;
        const [rec] = k.lostTowns.splice(i, 1);
        return rec;
    },

    /** A record's weight as a claim today (0 once forgotten). */
    weight(world, k, rec) {
        if (!rec) return 0;
        const C = Revanche.config();
        const age = Math.max(0, _day(world) - _num(rec.day));
        const half = Math.max(1, (rec.capital ? C.capitalHalfLifeYears : C.halfLifeYears) * YEAR);
        const base = rec.capital ? C.capitalWeight : C.townWeight;
        const share = rec.native === false ? C.conqueredShare : 1;
        return base * share * Math.pow(0.5, age / half);
    },

    /** The realm that holds a record's town now (its settlement's kingdom id), or null. */
    holderOf(world, rec) {
        const t = world && world.getTile ? world.getTile(rec.q, rec.r) : null;
        return t && t.settlement ? t.settlement.kingdom : null;
    },

    _kingdom(world, id) {
        if (id == null || !world) return null;
        if (typeof world.getKingdom === 'function') { const k = world.getKingdom(id); if (k) return k; }
        return (world.kingdoms || []).find(k => k && _same(k.id, id)) || null;
    },

    /** Strike the records that are forgotten, or whose town is back (or gone). */
    prune(world, k) {
        if (!k || !Array.isArray(k.lostTowns)) return;
        const C = Revanche.config();
        k.lostTowns = k.lostTowns.filter(e => {
            if (!e) return false;
            const t = world && world.getTile ? world.getTile(e.q, e.r) : null;
            if (world && world.getTile && !(t && t.settlement)) return false;
            if (t && t.settlement && _same(t.settlement.kingdom, k.id)) return false;
            return Revanche.weight(world, k, e) >= C.minWeight;
        });
    },

    /**
     * The realm's live claims: [{ rec, holderId, holder, w }], heaviest first —
     * towns of its, remembered, held now by a living realm.
     */
    claims(world, k) {
        if (!k || !Array.isArray(k.lostTowns) || !k.lostTowns.length || !Revanche.enabled()) return [];
        const C = Revanche.config();
        const out = [];
        for (const rec of k.lostTowns) {
            if (!rec) continue;
            const holderId = Revanche.holderOf(world, rec);
            if (holderId == null || _same(holderId, k.id)) continue;
            const holder = Revanche._kingdom(world, holderId);
            if (!holder || holder.isAlive === false) continue;
            const w = Revanche.weight(world, k, rec);
            if (w < C.minWeight) continue;
            out.push({ rec, holderId: holder.id, holder, w });
        }
        return out.sort((a, b) => b.w - a.w);
    },

    /** The weight of `k`'s claims on the towns `target` holds (capped at maxClaim). */
    claimOn(world, k, target) {
        if (!k || !target) return 0;
        let w = 0;
        for (const c of Revanche.claims(world, k)) if (_same(c.holderId, target.id)) w += c.w;
        return Math.min(Revanche.config().maxClaim, w);
    },

    /** The towns `k` claims from `target`: [{ rec, w }]. */
    claimedFrom(world, k, target) {
        return Revanche.claims(world, k).filter(c => target && _same(c.holderId, target.id));
    },

    /** How much warmer a claimant's grudge runs against the holder (added to considerWar's −30). */
    grudge(claim) {
        const C = Revanche.config();
        return Math.min(C.grudgeCap, Math.max(0, claim) * C.grudgePer);
    },

    /** The share of the holder's strength a claimant forgives itself before it marches. */
    ease(claim) {
        const C = Revanche.config();
        return Math.min(C.maxEase, Math.max(0, claim) * C.easePer);
    },

    /** The weekly souring of a claimant's regard for the holder (negative). */
    sour(claim) {
        const C = Revanche.config();
        return -Math.min(C.sourCap, Math.max(0, claim) * C.sourPer);
    },

    /**
     * Every remembered town by tile key → { kingdomId, w, capital } (the
     * heaviest living claimant that does not hold it): what its people
     * remember (systems/peasantRevolts.js).
     */
    townIndex(world) {
        const out = new Map();
        if (!world || !Array.isArray(world.kingdoms) || !Revanche.enabled()) return out;
        for (const k of world.kingdoms) {
            if (!k || k.isAlive === false || !Array.isArray(k.lostTowns) || !k.lostTowns.length) continue;
            for (const c of Revanche.claims(world, k)) {
                const key = `${c.rec.q},${c.rec.r}`;
                const was = out.get(key);
                if (!was || c.w > was.w) out.set(key, { kingdomId: k.id, w: c.w, capital: !!c.rec.capital });
            }
        }
        return out;
    },

    /**
     * Should the victor's peace return a claimed town? A hash of the day and
     * the pair against reclaimReturn (a reclaim war) or peaceReturn. Draws no RNG.
     */
    peaceRolls(world, victor, loser, reclaimWar) {
        const C = Revanche.config();
        const chance = reclaimWar ? C.reclaimReturn : C.peaceReturn;
        if (!(chance > 0)) return false;
        if (chance >= 1) return true;
        const roll = ((Utils.hashStr(`revanche:${_day(world)}:${victor.id}:${loser.id}`) >>> 0) % 10000) / 10000;
        return roll < chance;
    },

    /** A claim's weight in words. */
    label(w) {
        return w >= 2 ? 'burning' : w >= 1 ? 'strong' : w >= 0.4 ? 'fading' : 'faint';
    },
};
