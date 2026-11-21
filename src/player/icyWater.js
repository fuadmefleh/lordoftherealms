// ============================================
// ICY WATER — what the ice does to the player: a fall, a plunge, the cold
// ============================================
//
// The street map's winter ice (world/innerMap/streetSeasons.js, ice.js) can
// throw the player down or let them through into the water under it. This
// is what that does to them:
//
//   • fall(player): down on the ice — a knock (a point of health, some
//     comfort).
//   • plunge(player): through the ice — the shock of the cold water.
//   • tick(player, dt, secondsIn): each second in ice-cold water drains
//     health, energy and comfort fast (over the swim's own cost per stroke:
//     player/swimming.js); told on going in and again as the cold bites.
//   • out(player, world, secondsIn): out of the water — after more than a
//     moment in it, a chill (data/ailments.json `chill`) gets into you.
//   • bestSkates(player): the pair of skates in the packs, or null.
//
// Numbers: data/streetSeasons.json `winterIce` (skating, plunge). No
// randomness here (the chill's course is the ailment's own); player and
// world passed in. Notices come back for the UI to show.

import { DataLoader } from '../core/dataLoader.js';
import { Ailments } from '../systems/ailments.js';
import { Endurance } from './endurance.js';

const DEFAULTS = {
    skating: { skates: { iron_skates: { top: 2.0 }, bone_skates: { top: 1.65 } }, fallHealth: 1, fallComfort: -3 },
    plunge: { shockHealth: 3, shockComfort: -10, healthPerSecond: 1.1, energyPerSecond: 0.8, comfortPerSecond: -1.0, warnEvery: 6, chillAfter: 4, chillAilment: 'chill' },
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function _notice(key, vars = {}) {
    const g = DataLoader._gamedata;
    const N = (g && g.streetSeasons && g.streetSeasons.notices) || {};
    const n = N[key];
    if (!n) return null;
    const fill = s => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return { title: fill(n[0]), text: fill(n[1]) };
}

function _hurt(player, health) {
    player.health = Math.max(0, _num(player.health, 100) - Math.max(0, health));
}

export const IcyWater = {
    config() {
        const g = DataLoader._gamedata;
        const d = _obj(g && g.streetSeasons && g.streetSeasons.winterIce) || {};
        return {
            skating: { ...DEFAULTS.skating, ...(_obj(d.skating) || {}) },
            plunge: { ...DEFAULTS.plunge, ...(_obj(d.plunge) || {}) },
        };
    },

    /** The best pair of skates in the player's packs (the one with the highest top speed), or null. */
    bestSkates(player) {
        const all = IcyWater.config().skating.skates || {};
        const inv = player && player.inventory;
        let best = null;
        for (const [id, s] of Object.entries(all)) {
            if (_num(inv && inv[id]) >= 1 && (!best || _num(s.top) > _num(all[best].top))) best = id;
        }
        return best;
    },

    /** Down on the ice. → { notice } */
    fall(player) {
        if (!player) return { notice: null };
        const S = IcyWater.config().skating;
        _hurt(player, _num(S.fallHealth, 1));
        if (typeof player.modifyNeed === 'function' && player.needs) player.modifyNeed('comfort', _num(S.fallComfort, -3));
        return { notice: _notice('slip') };
    },

    /** Through the ice: the shock of the cold. → { notice } */
    plunge(player) {
        if (!player) return { notice: null };
        const P = IcyWater.config().plunge;
        _hurt(player, _num(P.shockHealth, 3));
        if (typeof player.modifyNeed === 'function' && player.needs) player.modifyNeed('comfort', _num(P.shockComfort, -10));
        return { notice: _notice('plunge') };
    },

    /**
     * `dt` seconds more in ice-cold water, `secondsIn` already. The hardy last a
     * little longer (player/endurance.js). → { notices[], dead }
     */
    tick(player, dt, secondsIn = 0) {
        const out = { notices: [], dead: false };
        if (!player || !(dt > 0)) return out;
        const P = IcyWater.config().plunge;
        const hardy = Endurance && typeof Endurance.energyMult === 'function' ? _num(Endurance.energyMult(player), 1) : 1;
        _hurt(player, _num(P.healthPerSecond, 1.1) * dt * hardy);
        if (typeof player.modifyNeed === 'function' && player.needs) {
            player.modifyNeed('energy', -_num(P.energyPerSecond, 0.8) * dt * hardy);
            player.modifyNeed('comfort', _num(P.comfortPerSecond, -1) * dt);
        }
        const every = Math.max(1, _num(P.warnEvery, 6));
        const before = Math.floor(secondsIn / every), after = Math.floor((secondsIn + dt) / every);
        if (after > before && after >= 1) {
            const n = _notice('numb');
            if (n) out.notices.push(n);
        }
        out.dead = _num(player.health, 100) <= 0;
        return out;
    },

    /** Out of the ice-cold water after `secondsIn` seconds. → { notices[], ailment } */
    out(player, world, secondsIn = 0) {
        const out = { notices: [], ailment: null };
        if (!player) return out;
        const P = IcyWater.config().plunge;
        const n = _notice('out');
        if (n) out.notices.push(n);
        if (secondsIn >= _num(P.chillAfter, 4) && P.chillAilment) {
            const rep = Ailments.inflict(player, world, P.chillAilment, { source: 'icy water' });
            if (rep) {
                out.ailment = rep;
                const c = _notice('chilled', { ailment: rep.name || 'a chill' });
                if (c) out.notices.push(c);
            }
        }
        return out;
    },
};
