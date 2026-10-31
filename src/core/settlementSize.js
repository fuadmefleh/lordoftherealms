// ============================================
// SETTLEMENT SIZE — what a settlement is big enough to offer
// A definition (unit type, property, …) may carry `minSettlement`
// ('village' | 'town' | 'city' | 'capital') and `minPopulation`.
// ============================================

export const SettlementSize = {
    /** Settlement tier hierarchy; a larger tier offers everything a smaller one does. */
    TIER: { village: 1, town: 2, city: 3, capital: 4 },

    tierOf(settlement) {
        return (settlement && SettlementSize.TIER[settlement.type]) || 0;
    },

    /** Is `settlement` large enough for `def`? → { ok, reason } */
    meets(def, settlement) {
        if (!def) return { ok: true };
        const need = def.minSettlement ? SettlementSize.TIER[def.minSettlement] || 1 : 0;
        if (need && SettlementSize.tierOf(settlement) < need) {
            return { ok: false, reason: `Requires a ${def.minSettlement} or larger` };
        }
        if (def.minPopulation && ((settlement && settlement.population) || 0) < def.minPopulation) {
            return { ok: false, reason: `Requires population ≥ ${def.minPopulation.toLocaleString()}` };
        }
        return { ok: true };
    },
};
