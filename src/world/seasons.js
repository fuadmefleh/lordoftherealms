// ============================================
// SEASONS — the agricultural year
// ============================================
//
// A year is 120 days of four 30-day seasons (Spring, Summer, Autumn, Winter),
// the same clock World.advanceDay and the weather use. This module turns the
// calendar into economics:
//
//   production curves  → farms, orchards, herds, fishing and hunting produce
//                        on a seasonal curve whose yearly mean is exactly 1, so
//                        yearly totals hold and only the timing changes
//                        (player properties, settlement food, fishing boats)
//   price curves       → food is cheap after the harvest and dear in late
//                        winter and early spring; furs are dear in winter
//   the lean season    → late winter and early spring: settlements with thin
//                        food stores lose happiness (Economy.applyLeanSeason)
//   campaign season    → kingdoms declare war more in summer and autumn
//   event seasons      → floods in spring, droughts in summer, bountiful
//                        harvests in autumn, blizzards and famine in winter
//
// Everything here is a pure function of the day (and a tile) — it draws no
// randomness, so it never disturbs the game's RNG stream. Tuning lives in
// data/economy.json "seasons", installed into Seasons.CONFIG by DataLoader.

const NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

export const Seasons = {
    NAMES,
    DAYS_PER_SEASON: 30,
    DAYS_PER_YEAR: 120,
    ICONS: { Spring: '🌱', Summer: '☀️', Autumn: '🍂', Winter: '❄️' },

    /** Defaults; replaced field by field from data/economy.json "seasons". */
    CONFIG: {
        // Output multiplier per season. Normalised to a yearly mean of 1.
        curves: {
            crops: { Spring: 0.4, Summer: 1.0, Autumn: 2.2, Winter: 0.4 },
            orchard: { Spring: 0.5, Summer: 1.5, Autumn: 1.7, Winter: 0.3 },
            livestock: { Spring: 1.3, Summer: 1.1, Autumn: 0.9, Winter: 0.7 },
            fishing: { Spring: 1.1, Summer: 1.3, Autumn: 1.0, Winter: 0.6 },
            hunting: { Spring: 0.8, Summer: 0.9, Autumn: 1.4, Winter: 0.9 },
            settlementFood: { Spring: 0.6, Summer: 1.0, Autumn: 1.8, Winter: 0.6 },
        },
        // Which curve a player property follows (others are not seasonal)
        propertyCurves: {
            farm: 'crops', irrigated_farm: 'crops', hemp_farm: 'crops',
            orchard: 'orchard', forager_hut: 'orchard', apiary: 'orchard', herb_garden: 'orchard',
            pasture: 'livestock', dairy: 'livestock', cattle_ranch: 'livestock',
            hunting_lodge: 'hunting', fishing_fleet: 'fishing',
        },
        // Price modifier anchors: [dayOfYear (1-120), fraction]; interpolated
        // linearly and wrapping from day 120 back to day 1.
        priceCurves: {
            food: {
                label: 'Food',
                goods: ['grain', 'flour', 'bread', 'fish', 'preserved_fish', 'meat', 'dried_meat', 'cheese', 'fruit', 'berries', 'honey', 'food'],
                points: [[1, 0.30], [25, 0.20], [50, 0.0], [70, -0.20], [88, -0.30], [100, -0.15], [112, 0.15], [120, 0.28]],
            },
            furs: {
                label: 'Furs & hides',
                goods: ['pelts', 'hide'],
                points: [[1, 0.0], [30, -0.15], [50, -0.20], [75, 0.05], [95, 0.25], [110, 0.20], [120, 0.05]],
            },
        },
        // Days of the year when stores run thin: late winter, early spring
        lean: { windows: [[106, 120], [1, 25]], reserveDays: 5, maxPenalty: 8, step: 1 },
        // × a realm's daily war-declaration chance (yearly mean 1)
        campaign: { Spring: 0.8, Summer: 1.5, Autumn: 1.2, Winter: 0.5 },
        // × the weight of a timed world event when picking which one starts
        eventSeasons: {
            flood: { Spring: 2.5, Summer: 0.6, Autumn: 0.6, Winter: 0.3 },
            drought: { Spring: 0.4, Summer: 2.5, Autumn: 0.8, Winter: 0.3 },
            bountiful_harvest: { Spring: 0.2, Summer: 0.8, Autumn: 3.0, Winter: 0.0 },
            blizzard: { Spring: 0.3, Summer: 0.0, Autumn: 0.7, Winter: 3.0 },
            famine: { Spring: 2.0, Summer: 0.3, Autumn: 0.0, Winter: 1.7 },
        },
        // One line per season for the outlook
        notes: {
            Spring: 'Planting season: fields are bare and rivers flood. Sign planting contracts; they pay at harvest.',
            Summer: 'Campaign season: crops grow, roads are dry and kingdoms march to war.',
            Autumn: 'Harvest: farms pour out grain, food is cheap and harvest hands are well paid. Fill your stores.',
            Winter: 'The lean months: fields lie fallow and food prices climb. Trap furs and fish through the ice.',
        },
        // Winter work on cold ground
        coldThreshold: 0.35,
        // Spring planting contracts (player/seasonalWork.js)
        plantingContract: { advance: [8, 15], payout: [45, 80], maxActive: 3 },
        winterWork: {
            trapping: {
                terrains: ['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tundra', 'snow', 'hills', 'highlands'],
                pelts: [1, 3], meatChance: 0.4, rareChance: 0.08,
            },
            iceFishing: { fish: [2, 5], bigChance: 0.15 },
        },
    },

    /** Install data/economy.json "seasons" over the defaults (top-level fields replace). */
    configure(data) {
        if (!data || typeof data !== 'object') return;
        const { _doc, ...rest } = data;
        Seasons.CONFIG = { ...Seasons.CONFIG, ...rest };
    },

    // ── Calendar ──────────────────────────────────────────

    /** Day of the year, 1..120. */
    dayOfYear(day) {
        const d = Math.max(1, Math.floor(day || 1));
        return ((d - 1) % Seasons.DAYS_PER_YEAR) + 1;
    },

    /** 'Spring' | 'Summer' | 'Autumn' | 'Winter' for a day (matches World.advanceDay). */
    seasonOf(day) {
        return NAMES[Math.floor((Seasons.dayOfYear(day) - 1) / Seasons.DAYS_PER_SEASON)];
    },

    /** Day within the season, 1..30. */
    dayInSeason(day) {
        return ((Seasons.dayOfYear(day) - 1) % Seasons.DAYS_PER_SEASON) + 1;
    },

    /**
     * The world's current day, or null for a world outside the calendar (a
     * headless fixture with no day) — every seasonal effect is neutral then.
     */
    today(world) {
        return world && Number.isFinite(world.day) ? world.day : null;
    },

    /** True when `day` is a real calendar day. */
    _dated(day) {
        return Number.isFinite(day);
    },

    // ── Production ────────────────────────────────────────

    /** A curve's per-season values scaled so their mean is exactly 1. */
    _normalised(kind) {
        const curve = (Seasons.CONFIG.curves || {})[kind];
        if (!curve) return null;
        const vals = NAMES.map(n => (Number.isFinite(curve[n]) ? Math.max(0, curve[n]) : 1));
        const mean = vals.reduce((a, b) => a + b, 0) / NAMES.length;
        if (!(mean > 0)) return null;
        const out = {};
        NAMES.forEach((n, i) => { out[n] = vals[i] / mean; });
        return out;
    },

    /** Output multiplier of a production curve ('crops', 'fishing', ...) on a day. 1 when unknown. */
    productionMultiplier(kind, day) {
        if (!Seasons._dated(day)) return 1;
        const curve = Seasons._normalised(kind);
        return curve ? curve[Seasons.seasonOf(day)] : 1;
    },

    /** The curve a player property type follows, or null when it isn't seasonal. */
    propertyCurve(type) {
        return ((Seasons.CONFIG.propertyCurves || {})[type]) || null;
    },

    /** Seasonal output multiplier for a player property type (1 when not seasonal). */
    propertyMultiplier(type, day) {
        const kind = Seasons.propertyCurve(type);
        return kind ? Seasons.productionMultiplier(kind, day) : 1;
    },

    /** Seasonal multiplier on the food a settlement brings to market. */
    settlementFoodMultiplier(day) {
        return Seasons.productionMultiplier('settlementFood', day);
    },

    // ── Prices ────────────────────────────────────────────

    /** The price curve id ('food', 'furs') a good follows, or null. */
    priceGroup(goodId) {
        for (const [id, def] of Object.entries(Seasons.CONFIG.priceCurves || {})) {
            if (def && Array.isArray(def.goods) && def.goods.includes(goodId)) return id;
        }
        return null;
    },

    /** Interpolated value of a [[dayOfYear, value], ...] anchor list (wraps). */
    _interpolate(points, doy) {
        if (!Array.isArray(points) || points.length === 0) return 0;
        const pts = [...points].sort((a, b) => a[0] - b[0]);
        const Y = Seasons.DAYS_PER_YEAR;
        // The segment containing doy, wrapping last → first + Y
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = i + 1 < pts.length ? pts[i + 1] : [pts[0][0] + Y, pts[0][1]];
            let x = doy;
            if (x < pts[0][0]) x += Y; // before the first anchor: on the wrap segment
            if (x >= a[0] && x <= b[0]) {
                const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
                return a[1] + (b[1] - a[1]) * t;
            }
        }
        return pts[0][1];
    },

    /** Seasonal price modifier for a good on a day (e.g. +0.28 = 28% dearer). 0 when not seasonal. */
    priceModifier(goodId, day) {
        if (!Seasons._dated(day)) return 0;
        const group = Seasons.priceGroup(goodId);
        if (!group) return 0;
        return Seasons._interpolate(Seasons.CONFIG.priceCurves[group].points, Seasons.dayOfYear(day));
    },

    /** Price multiplier (never below 0.1). */
    priceMultiplier(goodId, day) {
        return Math.max(0.1, 1 + Seasons.priceModifier(goodId, day));
    },

    /**
     * Where a good's seasonal price is heading over the next `ahead` days:
     * 'rising' | 'falling' | 'stable' (non-seasonal goods are 'stable').
     */
    priceTrend(goodId, day, ahead = 10) {
        if (!Seasons._dated(day) || !Seasons.priceGroup(goodId)) return 'stable';
        const diff = Seasons.priceModifier(goodId, day + ahead) - Seasons.priceModifier(goodId, day);
        if (diff > 0.04) return 'rising';
        if (diff < -0.04) return 'falling';
        return 'stable';
    },

    /** ▲ / ▼ / ▬ arrow for a trend. */
    trendArrow(trend) {
        return trend === 'rising' ? '▲' : trend === 'falling' ? '▼' : '▬';
    },

    // ── Lean season, campaigns, events ────────────────────

    /** True during the lean weeks (late winter, early spring). */
    isLean(day) {
        if (!Seasons._dated(day)) return false;
        const doy = Seasons.dayOfYear(day);
        const windows = (Seasons.CONFIG.lean && Seasons.CONFIG.lean.windows) || [];
        return windows.some(([a, b]) => doy >= a && doy <= b);
    },

    /**
     * Happiness points a settlement loses in the lean season for thin stores:
     * none outside the lean weeks or with `reserveDays` of food put by, up to
     * `maxPenalty` with empty granaries.
     * @param {number} reserveDays - days of food the settlement has in store
     */
    leanPenalty(day, reserveDays) {
        if (!Seasons.isLean(day)) return 0;
        const L = Seasons.CONFIG.lean || {};
        const need = L.reserveDays > 0 ? L.reserveDays : 5;
        const max = Number.isFinite(L.maxPenalty) ? L.maxPenalty : 8;
        const shortfall = Math.max(0, Math.min(1, 1 - Math.max(0, reserveDays || 0) / need));
        return max * shortfall;
    },

    /** Multiplier on a realm's daily chance to consider war (summer and autumn are campaign season). */
    campaignFactor(day) {
        if (!Seasons._dated(day)) return 1;
        const c = Seasons.CONFIG.campaign || {};
        const v = c[Seasons.seasonOf(day)];
        return Number.isFinite(v) ? Math.max(0, v) : 1;
    },

    /** Multiplier on a timed world event's weight this season (1 when the event isn't seasonal). */
    eventWeight(eventId, day) {
        if (!Seasons._dated(day)) return 1;
        const e = (Seasons.CONFIG.eventSeasons || {})[eventId];
        if (!e) return 1;
        const v = e[Seasons.seasonOf(day)];
        return Number.isFinite(v) ? Math.max(0, v) : 1;
    },

    // ── Winter work ───────────────────────────────────────

    /** Is this tile cold enough for winter trapping and ice fishing today? */
    isColdTile(tile, world) {
        if (!tile) return false;
        const day = Seasons.today(world);
        if (!Seasons._dated(day) || Seasons.seasonOf(day) !== 'Winter') return false;
        const coldTerrains = ['tundra', 'snow', 'ice', 'snow_peak'];
        if (tile.terrain && coldTerrains.includes(tile.terrain.id)) return true;
        const base = typeof tile.temperature === 'number' ? tile.temperature : 0.5;
        // Winter takes 0.15 off the base temperature (WeatherSystem._seasonalTemp)
        return base - 0.15 < (Seasons.CONFIG.coldThreshold || 0.35);
    },

    // ── Outlook ───────────────────────────────────────────

    /**
     * What this season means for trade and work: what's producing, what's
     * cheap or dear (and where it's heading), and a one-line note.
     * @returns {{season, icon, dayInSeason, lean, note, producing:Array, slack:Array, cheap:Array, dear:Array, summary:string}}
     */
    outlook(day) {
        const season = Seasons.seasonOf(day);
        const producing = [];
        const slack = [];
        const labels = { crops: 'Farms', orchard: 'Orchards', livestock: 'Herds', fishing: 'Fishing', hunting: 'Hunting' };
        for (const kind of Object.keys(labels)) {
            const m = Seasons.productionMultiplier(kind, day);
            if (m >= 1.2) producing.push({ kind, label: labels[kind], mult: m });
            else if (m <= 0.75) slack.push({ kind, label: labels[kind], mult: m });
        }
        const cheap = [];
        const dear = [];
        for (const [id, def] of Object.entries(Seasons.CONFIG.priceCurves || {})) {
            const mod = Seasons._interpolate(def.points, Seasons.dayOfYear(day));
            const first = (def.goods || [])[0];
            const entry = { id, label: def.label || id, mod, trend: first ? Seasons.priceTrend(first, day) : 'stable' };
            if (mod <= -0.08) cheap.push(entry);
            else if (mod >= 0.08) dear.push(entry);
        }
        const pct = (m) => `${m > 0 ? '+' : '−'}${Math.round(Math.abs(m) * 100)}%`;
        const parts = [];
        if (producing.length) parts.push(`Plenty: ${producing.map(p => `${p.label} ×${p.mult.toFixed(1)}`).join(', ')}`);
        if (slack.length) parts.push(`Slack: ${slack.map(p => `${p.label} ×${p.mult.toFixed(1)}`).join(', ')}`);
        if (cheap.length) parts.push(`Cheap: ${cheap.map(c => `${c.label} ${pct(c.mod)} ${Seasons.trendArrow(c.trend)}`).join(', ')}`);
        if (dear.length) parts.push(`Dear: ${dear.map(c => `${c.label} ${pct(c.mod)} ${Seasons.trendArrow(c.trend)}`).join(', ')}`);
        const lean = Seasons.isLean(day);
        if (lean) parts.push('Lean season: towns with thin stores grow restless');
        return {
            season,
            icon: Seasons.ICONS[season] || '',
            dayInSeason: Seasons.dayInSeason(day),
            lean,
            note: (Seasons.CONFIG.notes || {})[season] || '',
            producing, slack, cheap, dear,
            summary: parts.join(' · '),
        };
    },
};
