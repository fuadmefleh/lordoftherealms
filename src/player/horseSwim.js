// ============================================
// HORSE SWIM — your horse in the water: wading a ford, swimming a river
// ============================================
//
// The rules for a horse in the street map's water (the frame-by-frame side,
// the look and the hooks into the walk are ui/innerMapHorseSwim.js):
//
//   • wade(player): a cell of ford or shallows ridden through — the rider's
//     legs a little wet (wadeWet a cell, up to wadeWetCap; never drier).
//   • fresh(a) / maxStamina(a): a horse's strength in the water, in cells of
//     swimming (stamina, cut by poor health down to healthFloor of it).
//   • refusal(a, st, ctx): why it won't go into deep water now, or null —
//     a foal, water at or below coldRefuseC (or frozen on the map), blown
//     from the last swim (below refuseBelow of its strength).
//   • swim(st, { cells, drift, dt }): its strength spent in the water →
//     { flagging, spent } (told once each a swim).
//   • rest(st, dt): ashore, its wind back.
//   • soakRider(player): waist-deep in the river — wet through (riderWet).
//   • soakPacks(player, st): a long swim gets into the packs, once a swim:
//     a share of the goods that spoil in water is ruined (a real sink:
//     the goods are gone, not sold).
//
// No randomness, no globals: the player, the animal and its swim state are
// passed in. Numbers: data/horseSwim.json.

import { DataLoader } from '../core/dataLoader.js';

const DEFAULTS = {
    wadePace: 0.55, wadeWet: 4, wadeWetCap: 22, swimSpeed: 0.6, currentResist: 0.35,
    stamina: 26, healthFloor: 0.5, drainPerStroke: 1, drainPerDrift: 0.5, drainPerSecond: 0.12,
    restPerSecond: 0.4, refuseBelow: 0.45, flagAt: 0.3, coldRefuseC: 3, riderWet: 90,
    packSoak: { afterStrokes: 6, share: 0.15, goods: ['flour', 'bread', 'grain', 'salt'] },
    notices: {},
    refusals: {
        foal: '{name} is a foal yet, too young to swim behind you.',
        cold: '{name} won\'t go into water this cold.',
        blown: '{name} is blown from the last swim: let it get its wind back first.',
        spent: '{name} has nothing left to swim with.',
    },
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

export const HorseSwim = {
    config() {
        const g = DataLoader._gamedata;
        const d = _obj(g && g.horseSwim) || {};
        return {
            ...DEFAULTS, ...d,
            packSoak: { ...DEFAULTS.packSoak, ...(_obj(d.packSoak) || {}) },
            notices: { ...DEFAULTS.notices, ...(_obj(d.notices) || {}) },
            refusals: { ...DEFAULTS.refusals, ...(_obj(d.refusals) || {}) },
        };
    },

    /** A notice from the data, filled: { title, text } or null. */
    notice(key, vars = {}) {
        const n = HorseSwim.config().notices[key];
        return Array.isArray(n) ? { title: _fill(n[0], vars), text: _fill(n[1], vars) } : null;
    },

    /** Its strength in the water, in cells of swimming: less for a sick or hurt horse. */
    maxStamina(a) {
        const C = HorseSwim.config();
        const hp = Math.max(0, Math.min(100, _num(a && a.health, 100))) / 100;
        const floor = Math.max(0, Math.min(1, _num(C.healthFloor, 0.5)));
        return Math.max(1, _num(C.stamina, 26) * (floor + (1 - floor) * hp));
    },

    /** A fresh swim state for a horse: { stamina, max, strokes, flagTold, soaked } */
    fresh(a) {
        const max = HorseSwim.maxStamina(a);
        return { stamina: max, max, strokes: 0, flagTold: false, soaked: false, blown: false };
    },

    /**
     * Why it won't go into deep water now, or null.
     * ctx: { young (a foal), celsius (the air on the map), frozen (ice on the map's water) }
     */
    refusal(a, st, ctx = {}) {
        const C = HorseSwim.config();
        const vars = { name: (a && a.name) || 'Your horse' };
        if (ctx.young) return _fill(C.refusals.foal, vars);
        if (ctx.frozen || (ctx.celsius != null && Number.isFinite(Number(ctx.celsius)) && Number(ctx.celsius) <= _num(C.coldRefuseC, 3))) return _fill(C.refusals.cold, vars);
        if (st && st.stamina <= 0) return _fill(C.refusals.spent, vars);
        if (st && st.blown) return _fill(C.refusals.blown, vars);
        return null;
    },

    /**
     * Its strength spent in the water: `cells` swum, `drift` cells the current
     * carried it, `dt` seconds in. → { flagging, spent } — each true once a swim.
     */
    swim(st, { cells = 0, drift = 0, dt = 0 } = {}) {
        const out = { flagging: false, spent: false };
        if (!st) return out;
        const C = HorseSwim.config();
        const was = st.stamina;
        st.strokes += Math.max(0, cells) + Math.max(0, drift);
        st.stamina = Math.max(0, st.stamina - Math.max(0, cells) * _num(C.drainPerStroke, 1)
            - Math.max(0, drift) * _num(C.drainPerDrift, 0.5) - Math.max(0, dt) * _num(C.drainPerSecond, 0.12));
        if (!st.flagTold && st.stamina <= st.max * _num(C.flagAt, 0.3) && st.stamina > 0) { st.flagTold = true; out.flagging = true; }
        if (was > 0 && st.stamina <= 0) out.spent = true;
        // (once it has been hard pressed it is blown until it gets its wind back)
        if (st.stamina < st.max * _num(C.refuseBelow, 0.45)) st.blown = true;
        return out;
    },

    /** Ashore: its wind back. → true when it has just got it back (no longer blown). */
    rest(st, dt) {
        if (!st || !(dt > 0)) return false;
        const C = HorseSwim.config();
        // (out of the water: the next swim is a new one)
        st.strokes = 0; st.flagTold = false; st.soaked = false;
        st.stamina = Math.min(st.max, st.stamina + dt * _num(C.restPerSecond, 0.4));
        // (blown, it wants nearly all its wind back before it will swim again)
        if (st.blown && st.stamina >= st.max * Math.max(_num(C.refuseBelow, 0.45), 0.9)) {
            st.blown = false;
            return true;
        }
        return false;
    },

    /** A cell of ford or shallows ridden through: the legs and boots a little wet. → the new wetness */
    wade(player) {
        if (!player) return 0;
        const C = HorseSwim.config();
        const w = Math.max(0, Math.min(100, _num(player.wetness, 0)));
        const cap = _num(C.wadeWetCap, 22);
        if (w < cap) player.wetness = Math.round(Math.min(cap, w + _num(C.wadeWet, 4)) * 100) / 100;
        return _num(player.wetness, 0);
    },

    /** Waist-deep on a swimming horse: wet through. */
    soakRider(player) {
        if (!player) return;
        const C = HorseSwim.config();
        player.wetness = Math.max(_num(player.wetness, 0), Math.min(100, _num(C.riderWet, 90)));
    },

    /**
     * A long swim gets into the packs (once a swim): a share of each good that
     * spoils in water is ruined. → [{ id, n }] what was lost (empty: nothing).
     */
    soakPacks(player, st) {
        const out = [];
        if (!player || !st || st.soaked) return out;
        const P = HorseSwim.config().packSoak;
        if (st.strokes < _num(P.afterStrokes, 6)) return out;
        st.soaked = true;
        const inv = player.inventory;
        if (!inv || typeof inv !== 'object') return out;
        const share = Math.max(0, Math.min(1, _num(P.share, 0.15)));
        for (const id of Array.isArray(P.goods) ? P.goods : []) {
            const have = Math.floor(_num(inv[id], 0));
            const n = Math.floor(have * share);
            if (n <= 0) continue;
            inv[id] = have - n;
            if (inv[id] <= 0) delete inv[id];
            out.push({ id, n });
        }
        return out;
    },
};
