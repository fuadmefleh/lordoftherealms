// ============================================
// WETNESS — out in the rain: wet through, then dry again
// ============================================
//
// player.wetness, 0 (dry) .. 100 (soaked to the skin). On the street map
// (ui/innerMapWeather.js ticks it with the map's hours):
//
//   • it rises out in the rain or the snow, uncovered — not indoors, not under
//     the eaves (world/innerMap/streetWeather.js isCoveredAt); a swim soaks you
//     at once;
//   • it dries indoors, faster still by a fire, slowly out of the rain (quicker
//     in the warmth and the wind);
//   • while wet: comfort drains (the colder the day, the more — wet is cold),
//     the clothes go grubby, a little fun goes; soaked through in the cold for
//     long, a chill may get into you (data/ailments.json `chill`).
//
// coldFactor(player) — 1 dry … 2 soaked — for anything else that asks how
// much the cold bites (the winter's ice and cold).
//
// Not saved: a reload finds you dry. Numbers: data/streetWeather.json
// `wetness`. Draws from Utils only for the chill (Ailments).

import { DataLoader } from '../core/dataLoader.js';
import { Ailments } from '../systems/ailments.js';

const DEFAULTS = {
    rainPerHour: 70, snowPerHour: 16, dryIndoors: 28, dryByFire: 70, dryCovered: 10, dryOutdoors: 7,
    dryWarmPerC: 0.6, dryWind: 6, comfortPerHour: 2.2, coldBelowC: 10, coldComfortPerC: 0.16,
    clothesPerHour: 3, funPerHour: 0.5, fireTiles: 2.5,
    chill: { wetAbove: 75, belowC: 6, afterHours: 2, chancePerHour: 0.03, ailment: 'chill' },
    levels: [
        { min: 75, label: 'Soaked', icon: '💧' },
        { min: 40, label: 'Wet', icon: '💧' },
        { min: 12, label: 'Damp', icon: '💧' },
    ],
    notices: {
        soaked: ['💧 Soaked Through', 'The rain has soaked you to the skin. Get indoors, or by a fire, to dry off.'],
        dry: ['☀️ Dry Again', 'Your clothes have dried out.'],
    },
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const Wetness = {
    config() {
        const g = DataLoader._gamedata;
        const d = _obj(g && g.streetWeather && g.streetWeather.wetness) || {};
        return { ...DEFAULTS, ...d, chill: { ...DEFAULTS.chill, ...(_obj(d.chill) || {}) }, notices: { ...DEFAULTS.notices, ...(_obj(d.notices) || {}) } };
    },

    /** How wet the player is, 0..100. */
    get(player) {
        return _clamp(_num(player && player.wetness, 0), 0, 100);
    },

    /** { label, icon } for how wet, or null when dry. */
    level(player) {
        const w = Wetness.get(player);
        for (const l of Wetness.config().levels || []) if (w >= _num(l.min, 0)) return l;
        return null;
    },

    /** 1 dry … 2 soaked: how much harder the cold bites. */
    coldFactor(player) {
        return 1 + Wetness.get(player) / 100;
    },

    /**
     * `hours` of the map's clock gone by (fractions welcome).
     * ctx: { rain 0..1, snow 0..1 (falling now), covered (indoors or under the eaves),
     *        indoors, nearFire, swimming, celsius, wind 0..1, world }
     * Returns { notices: [{ icon, title, text, type }], changed, caught? }.
     */
    tick(player, hours, ctx = {}) {
        const out = { notices: [], changed: false };
        if (!player || !(hours > 0)) return out;
        const C = Wetness.config();
        const h = Math.min(hours, 12);
        const before = Wetness.get(player);
        let w = before;
        const c = _num(ctx.celsius, 12);
        if (ctx.swimming) {
            w = 100;
        } else if (!ctx.covered && (_num(ctx.rain) > 0 || _num(ctx.snow) > 0)) {
            // (snow wets slowly, and not at all in a hard frost: it lies on you dry)
            const snowWet = c > -4 ? _num(ctx.snow) * _num(C.snowPerHour, 16) : 0;
            w += (_num(ctx.rain) * _num(C.rainPerHour, 70) + snowWet) * h;
        } else {
            let dry = ctx.nearFire ? _num(C.dryByFire, 70)
                : ctx.indoors ? _num(C.dryIndoors, 28)
                    : ctx.covered ? _num(C.dryCovered, 10)
                        : _num(C.dryOutdoors, 7) + Math.max(0, c - 10) * _num(C.dryWarmPerC, 0.6) + _num(ctx.wind) * _num(C.dryWind, 6);
            if (c < 0 && !ctx.nearFire && !ctx.indoors) dry *= 0.4;
            w -= dry * h;
        }
        w = _clamp(w, 0, 100);
        player.wetness = Math.round(w * 100) / 100;
        out.changed = Math.abs(w - before) > 0.01;

        // What being wet does, by the hour (on the average of before and after)
        const k = (before + w) / 200;
        if (k > 0.01) {
            const coldK = c < _num(C.coldBelowC, 10) ? (_num(C.coldBelowC, 10) - c) * _num(C.coldComfortPerC, 0.16) : 0;
            if (typeof player.modifyNeed === 'function' && player.needs) {
                player.modifyNeed('comfort', -k * (_num(C.comfortPerHour, 2.2) + coldK) * h);
                player.modifyNeed('fun', -k * _num(C.funPerHour, 0.5) * h);
            }
            if (typeof player.soilClothes === 'function') player.soilClothes(k * _num(C.clothesPerHour, 3) * h);
            // Soaked in the cold for long: a chill
            const CH = C.chill;
            if (w >= _num(CH.wetAbove, 75) && c < _num(CH.belowC, 6)) {
                player._soakedColdHours = _num(player._soakedColdHours) + h;
                if (player._soakedColdHours >= _num(CH.afterHours, 2) && Ailments && typeof Ailments._tryCatch === 'function') {
                    const caught = Ailments._tryCatch(player, ctx.world || null, CH.ailment || 'chill', _num(CH.chancePerHour, 0.03) * h, 'soaked in the cold', null);
                    if (caught) {
                        out.caught = caught;
                        out.notices.push({ icon: caught.icon || '🤧', title: caught.name || 'A Chill', text: caught.text || 'Wet through in the cold, you have caught a chill.', type: 'warning' });
                    }
                }
            } else {
                player._soakedColdHours = 0;
            }
        }

        // Told: soaked through, and dry again
        const N = C.notices || {};
        if (before < 75 && w >= 75 && !player._wetTold && N.soaked) {
            player._wetTold = true;
            out.notices.push({ icon: '💧', title: N.soaked[0], text: N.soaked[1], type: 'info' });
        }
        if (player._wetTold && w <= 0.5) {
            player._wetTold = false;
            if (N.dry) out.notices.push({ icon: '☀️', title: N.dry[0], text: N.dry[1], type: 'info' });
        }
        return out;
    },
};
