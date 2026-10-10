// ============================================
// COINAGE — the purity of each realm's coin, and what crown finances do to
// its markets and its peace
// ============================================
// A realm's coin starts pure (1.0). A crown in trouble may debase it
// (systems/finance.js): the mint gets short-term gold, but every market in
// the realm then asks more for the same goods. This module is the read side,
// kept in the world layer so Economy.marketPrice and KingdomStability can
// read it without reaching up into systems/:
//   • priceMultiplier(world, settlement) — one clean multiplier on a
//     settlement's market prices (1 for pure coin, no world, or no realm).
//   • stabilityMod(kingdom, day) — the stability target term for the crown's
//     finances (debased coin, a war levy, a recent default, heavy debt).
// The multiplier is one coherent figure for what the realm's coin buys:
// the purity term (silver taken out of each piece) × the quantity term (the
// realm's coin per head against the world's, world/moneySupply.js: a realm
// awash in coin is dear, one drained of it cheap).
// State lives on kingdom.finance (saved with the kingdom) and world.money;
// this module only reads them and draws no randomness.

import { DataLoader } from '../core/dataLoader.js';
import { MoneySupply } from './moneySupply.js';

function _num(v, d = 0) {
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

export const Coinage = {
    /** data/finance.json → config.coinage */
    config() {
        const d = DataLoader.finance || (DataLoader.get && DataLoader.get('finance')) || {};
        return (d.config && d.config.coinage) || {};
    },

    /** The purity of a realm's coin, 0.1–1 (1 when it has no finance record). */
    purity(kingdom) {
        const f = kingdom && kingdom.finance;
        if (!f || typeof f.purity !== 'number' || !Number.isFinite(f.purity)) return 1;
        return Math.max(0.1, Math.min(1, f.purity));
    },

    /** The realm a settlement belongs to, if any. */
    kingdomOf(world, settlement) {
        if (!world || !settlement || settlement.kingdom == null) return null;
        if (typeof world.getKingdom === 'function') return world.getKingdom(settlement.kingdom) || null;
        return (world.kingdoms || []).find(k => k && k.id === settlement.kingdom) || null;
    },

    /**
     * What the realm's coin does to a settlement's prices: the purity term
     * 1 + (1 − purity) × elasticity, times the realm's price level
     * (MoneySupply.level: 1 until measured). Exactly 1 for pure coin at the
     * world's norm, with no world or outside a realm.
     */
    priceMultiplier(world, settlement) {
        const k = Coinage.kingdomOf(world, settlement);
        if (!k) return 1;
        return Coinage.purityFactor(k) * MoneySupply.level(world, k.id);
    },

    /** The purity term alone: 1 + (1 − purity) × elasticity (1 for pure coin). */
    purityFactor(kingdom) {
        const p = Coinage.purity(kingdom);
        if (p >= 1) return 1;
        return 1 + (1 - p) * _num(Coinage.config().elasticity, 0.9);
    },

    /** The quantity term alone: the realm's price level (world/moneySupply.js). */
    level(world, kingdom) {
        return kingdom ? MoneySupply.level(world, kingdom.id) : 1;
    },

    /** How far a realm's people trust its coin and its crown's word, 0–100. */
    trust(kingdom, day = null) {
        const f = kingdom && kingdom.finance;
        if (!f) return 100;
        let t = 100 - (1 - Coinage.purity(kingdom)) * 150;
        if (day != null && f.lastDefaultDay != null) t -= Math.max(0, 40 - (day - f.lastDefaultDay) / 6);
        t -= Math.min(30, _num(f.defaults) * 10);
        return Math.max(0, Math.min(100, Math.round(t)));
    },

    /**
     * Stability target term for the crown's finances (≤ 0): debased coin,
     * an extraordinary levy, a default in the last weeks, heavy debt.
     * 0 for a realm with no finance record (so nothing changes until the
     * finance tick has run).
     */
    stabilityMod(kingdom, day = null) {
        const f = kingdom && kingdom.finance;
        if (!f) return 0;
        const C = Coinage.config();
        let m = -(1 - Coinage.purity(kingdom)) * _num(C.stabilityPerPurity, 30);
        if (f.levy && day != null && _num(f.levy.until) >= day) m -= _num(C.levyStability, 6);
        if (f.lastDefaultDay != null && day != null && day - f.lastDefaultDay <= _num(C.defaultStabilityDays, 60)) {
            m -= _num(C.defaultStability, 8);
        }
        const ratio = _num(f.debtRatio);
        if (ratio > 0.5) m -= Math.min(_num(C.debtStabilityCap, 8), (ratio - 0.5) * _num(C.debtStability, 4) * 2);
        return m;
    },
};
