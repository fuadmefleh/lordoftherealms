// ============================================
// NAMES — pick a name no living neighbour already answers to
// ============================================
// Pure helpers shared by every system that names people (townsfolk births and
// newcomers, the player's children). A pick costs exactly ONE draw from the
// caller's RNG, whatever is taken — so de-duplicating never shifts a seeded
// stream: the draw chooses a starting point in the pool and the pick walks on
// from there to the first name not taken. Only when every name is taken does
// it fall back to the drawn one.

export const Names = {
    /**
     * A realm's name as it reads inside a sentence: a styled name takes "the"
     * ('Kingdom of Valdoria' → 'the Kingdom of Valdoria', 'The Kharzun Khanate'
     * → 'the Kharzun Khanate'); a bare one stands alone ('Westmarch'). So
     * "the court of the Kingdom of Valdoria", never "of Kingdom of Valdoria".
     * `cap`: capitalised, for the head of a sentence or a title.
     */
    realm(name, cap = false) {
        const s = String(name == null ? '' : name).trim();
        if (!s) return s;
        let out = s;
        if (/^the\s/i.test(s)) out = `the ${s.slice(4)}`;
        else if (/^[A-Z][\w'-]*(?:[ -][A-Z][\w'-]*)?\s+of\s+\S/.test(s)) out = `the ${s}`;
        return cap ? out.charAt(0).toUpperCase() + out.slice(1) : out;
    },

    /**
     * A name from `pool`, starting at index floor(r * pool.length) and walking
     * forward (wrapping) past every name `isTaken(name)` reports. `r` is one
     * draw in [0, 1). Null for an empty pool.
     */
    pickFree(pool, r, isTaken) {
        if (!Array.isArray(pool) || !pool.length) return null;
        const n = pool.length;
        const start = Math.min(n - 1, Math.max(0, Math.floor((Number(r) || 0) * n)));
        if (typeof isTaken !== 'function') return pool[start];
        for (let i = 0; i < n; i++) {
            const name = pool[(start + i) % n];
            if (!isTaken(name)) return name;
        }
        return pool[start];
    },

    /** The pools joined, each name once, in order (null/empty pools skipped). */
    merge(...pools) {
        const out = [];
        const seen = new Set();
        for (const p of pools) {
            if (!Array.isArray(p)) continue;
            for (const name of p) {
                if (typeof name !== 'string' || !name || seen.has(name)) continue;
                seen.add(name);
                out.push(name);
            }
        }
        return out;
    },
};
