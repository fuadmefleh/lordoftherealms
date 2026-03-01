// ============================================
// UTILS — Helper functions
// ============================================

export const Utils = {
    /**
     * Clamp a value between min and max
     */
    clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    },

    /**
     * Linear interpolation
     */
    lerp(a, b, t) {
        return a + (b - a) * t;
    },

    /**
     * Random integer in range [min, max]
     */
    randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    /**
     * Random float in range [min, max)
     */
    randFloat(min, max) {
        return Math.random() * (max - min) + min;
    },

    /**
     * Pick random element from array
     */
    randPick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    /**
     * Weighted random pick — items is [{value, weight}, ...]
     */
    weightedPick(items) {
        const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
        let r = Math.random() * totalWeight;
        for (const item of items) {
            r -= item.weight;
            if (r <= 0) return item.value;
        }
        return items[items.length - 1].value;
    },

    /**
     * Shuffle array in-place (Fisher-Yates)
     */
    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    },

    /**
     * Simple hash for seeding
     */
    hashStr(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return hash;
    },

    /**
     * Simplex-like noise (simple value noise for terrain gen)
     */
    noise2D: (() => {
        const perm = new Uint8Array(512);
        const grad = [
            [1, 1], [-1, 1], [1, -1], [-1, -1],
            [1, 0], [-1, 0], [0, 1], [0, -1]
        ];

        // Initialize permutation table
        for (let i = 0; i < 256; i++) perm[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

        function dot(g, x, y) {
            return g[0] * x + g[1] * y;
        }

        function fade(t) {
            return t * t * t * (t * (t * 6 - 15) + 10);
        }

        return function(x, y) {
            const X = Math.floor(x) & 255;
            const Y = Math.floor(y) & 255;
            const xf = x - Math.floor(x);
            const yf = y - Math.floor(y);
            const u = fade(xf);
            const v = fade(yf);

            const aa = perm[perm[X] + Y] & 7;
            const ab = perm[perm[X] + Y + 1] & 7;
            const ba = perm[perm[X + 1] + Y] & 7;
            const bb = perm[perm[X + 1] + Y + 1] & 7;

            const x1 = Utils.lerp(dot(grad[aa], xf, yf), dot(grad[ba], xf - 1, yf), u);
            const x2 = Utils.lerp(dot(grad[ab], xf, yf - 1), dot(grad[bb], xf - 1, yf - 1), u);

            return Utils.lerp(x1, x2, v);
        };
    })(),

    /**
     * Multi-octave noise
     */
    fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
        let sum = 0;
        let amp = 1;
        let freq = 1;
        let maxAmp = 0;
        for (let i = 0; i < octaves; i++) {
            sum += Utils.noise2D(x * freq, y * freq) * amp;
            maxAmp += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / maxAmp;
    },

    /**
     * Format number with commas
     */
    formatNumber(n) {
        return n.toLocaleString();
    },

    /**
     * Deep clone a plain object
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Create a seeded random function
     */
    seededRandom(seed) {
        let s = seed;
        return function () {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }
};
