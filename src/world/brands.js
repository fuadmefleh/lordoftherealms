// ============================================
// BRANDS — the mark a court burned into the player, read where it is seen
// ============================================
// A court's brand (player/trials.js, resolveTrial → player.trials.brands)
// stays on the person for years. This reads it, for every system that meets
// the player face to face:
//
//   - a townsperson's first impression (systems/fame.js dispositionSeed)
//   - a realm lord's opinion (world/npcLords.js getLordOpinion)
//   - a rival head's parley (systems/rivalHouses.js parleyChance)
//   - the watch of the branding realm (systems/watchQuestioning.js caseAt)
//   - respectable folk's prices, or their refusal (systems/npcDisposition.js),
//     fine houses (systems/hospitality.js quote), a realm's wards (raising.js)
//
// A brand weighs fully in the realm that burned it and by foreignShare
// elsewhere; after fadeAfterDays it is an old scar (fadedWeight). A brand of
// an earlier generation of the House died with its bearer; a pardoned one is
// a scar only. Pardons are the player's acts (player/trials.js). Tuning in
// data/trials.json → brands. Pure reads; no globals, no randomness.

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const Brands = {
    config() {
        const g = DataLoader._gamedata;
        return (g && g.trials && g.trials.brands) || {};
    },

    _gen(player) {
        return player && player.house ? _num(player.house.generation, 1) : null;
    },

    /** Every brand the player's own body bears, pardoned or not (an earlier head's died with them). */
    borne(player) {
        const list = player && player.trials && Array.isArray(player.trials.brands) ? player.trials.brands : [];
        const gen = Brands._gen(player);
        return list.filter(b => b && (b.gen == null || gen == null || b.gen === gen));
    },

    /** The brands that still mark a criminal: borne and not pardoned. */
    active(player) {
        return Brands.borne(player).filter(b => !b.pardoned);
    },

    /** 1 while fresh, fadedWeight once old (full weight without a world to date it). */
    weight(brand, world = null) {
        const C = Brands.config();
        if (!brand) return 0;
        if (!world || !Number.isFinite(world.day)) return 1;
        return world.day - _num(brand.day) >= _num(C.fadeAfterDays, 1200) ? _num(C.fadedWeight, 0.6) : 1;
    },

    /** How the brand weighs with someone of realm `kingdomId`: { f, brand, home } (f 0: no brand). */
    seen(player, kingdomId = null, world = null) {
        const C = Brands.config();
        let best = { f: 0, brand: null, home: false };
        for (const b of Brands.active(player)) {
            const home = kingdomId != null && String(b.kingdomId) === String(kingdomId);
            const f = Brands.weight(b, world) * (home ? 1 : _num(C.foreignShare, 0.5));
            if (f > best.f) best = { f, brand: b, home };
        }
        return best;
    },

    /** A townsperson's first impression: a negative delta (0 with no brand). */
    dispositionDelta(player, kingdomId = null, world = null) {
        const s = Brands.seen(player, kingdomId, world);
        return s.f ? Math.round(_num(Brands.config().disposition, -15) * s.f) : 0;
    },

    /** A realm lord's opinion. */
    lordOpinion(player, kingdomId = null, world = null) {
        const s = Brands.seen(player, kingdomId, world);
        return s.f ? Math.round(_num(Brands.config().lordOpinion, -20) * s.f) : 0;
    },

    /** Added to a rival head's parley chance. */
    parley(player, kingdomId = null, world = null) {
        const s = Brands.seen(player, kingdomId, world);
        return s.f ? _num(Brands.config().rivalParley, -0.1) * s.f : 0;
    },

    /** The watch's extra suspicion in a town of the realm that branded the player. */
    suspicion(player, kingdomId = null, world = null) {
        if (kingdomId == null) return 0;
        const s = Brands.seen(player, kingdomId, world);
        return s.home ? Math.round(_num(Brands.config().suspicion, 15) * s.f) : 0;
    },

    /** A trader's price shift (positive: dearer) for a respectable trade; 0 for the rest. */
    priceShift(player, kingdomId = null, npcType = null, world = null) {
        const C = Brands.config();
        if (!(C.respectable || []).includes(npcType)) return 0;
        const s = Brands.seen(player, kingdomId, world);
        return s.f ? Math.round(_num(C.priceShift, 0.12) * s.f * 100) / 100 : 0;
    },

    /** Does a person of this trade in the branding realm refuse the branded outright? */
    refuses(player, kingdomId = null, npcType = null, world = null) {
        const C = Brands.config();
        if (!(C.refuseRoles || []).includes(npcType)) return false;
        const s = Brands.seen(player, kingdomId, world);
        return s.home && s.f >= _num(C.refuseAt, 0.9);
    },

    /** A house of `stars` in a realm: { refuses, mult } for the branded guest. */
    innTerms(player, kingdomId = null, stars = 0, world = null) {
        const C = Brands.config();
        const s = Brands.seen(player, kingdomId, world);
        if (!s.f) return { refuses: false, mult: 1 };
        const refuses = s.home && s.f >= _num(C.refuseAt, 0.9) && _num(stars) >= _num(C.innRefuseStars, 4);
        return { refuses, mult: 1 + _num(C.innPriceShift, 0.25) * s.f };
    },

    /** "the brand of Valdor" — for the lines that name it. */
    label(brand) {
        return brand ? `the brand of ${brand.realm || 'a realm'}` : 'a brand';
    },
};
