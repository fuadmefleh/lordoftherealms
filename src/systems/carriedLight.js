// ============================================
// CARRIED LIGHT — a torch or a lantern in your hand after dark
// ============================================
// The player's own light on the street map (the map's half: ui/innerMapTorchlight.js).
//
//   TORCH    the good 'torch', bound by hand from a stick and a binder (resin,
//            tallow, a strip of linen): lit, it burns torch.hours game hours and
//            is gone. Put out part-burnt, the stub is kept and lit first next
//            time; guttering out, a fresh one is lit from the packs if any.
//   LANTERN  the good 'lantern' (it lasts): it burns fuel, a unit of lamp oil,
//            candles or tallow (fuels: hours a unit) filled in from the packs
//            when you light it dry and when it runs dry.
//   AT NIGHT only does it matter (strength: 0 by day, 1 at full dark): the
//            light pool, the fish it draws, the bite it gives a line, how far
//            off a poacher sees it coming (scareReach).
//   A TRAP   a lantern hung at your fish trap (hangLantern) keeps poachers
//            off while its fuel lasts (systems/fishTraps.js poacherAt reads
//            trap.lantern); taken down, the lantern and what is left of the
//            fuel come back to you.
//
// Every unit is real: a torch is bound from goods you hold and burns away; the
// lantern's fuel is taken from the packs and burns away hour by hour.
// State: player.carriedLight = { lit: null | 'torch' | 'lantern', stub, fuel, at }
// (game hours: day * 24 + the hour). Tunables: data/torchlight.json. No RNG.

import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const DEFAULTS = {
    enabled: true, minDarkness: 0.25, fullDarkness: 0.85, bareNight: 55,
    torch: { item: 'torch', hours: 3, radius: 185, intensity: 0.92, color: [255, 168, 72], biteBonus: 0.2, lure: 1 },
    lantern: { item: 'lantern', capacity: 10, radius: 160, intensity: 0.85, color: [255, 206, 136], biteBonus: 0.15, lure: 0.8 },
    fuels: { lamp_oil: 8, candles: 5, tallow: 3 },
    bind: { sticks: { sticks: 2, firewood: 2, driftwood: 1, wood: 4 }, binders: ['resin', 'tallow', 'linen', 'textiles'] },
    fish: { pull: 7, ring: [0.8, 1.8], reach: 3, speed: 0.7, extra: 3, comeEvery: 4, near: 3.5, glow: 0.75 },
    poach: { scareMult: 2.2, minHang: 6 },
};

let _cfgSrc, _cfgVal = null;

function _inv(player) {
    if (!player) return {};
    if (!player.inventory) player.inventory = {};
    return player.inventory;
}

function _take(player, id, n = 1) {
    const inv = _inv(player);
    if (!(_num(inv[id]) >= n)) return false;
    inv[id] -= n;
    if (inv[id] <= 0) delete inv[id];
    return true;
}

export const CarriedLight = {
    config() {
        const g = DataLoader._gamedata;
        const src = g && g.torchlight;
        if (_cfgSrc !== src || !_cfgVal) {
            _cfgSrc = src;
            const o = src || {};
            _cfgVal = {
                ...DEFAULTS, ...o,
                torch: { ...DEFAULTS.torch, ...(o.torch || {}) },
                lantern: { ...DEFAULTS.lantern, ...(o.lantern || {}) },
                fuels: { ...(o.fuels || DEFAULTS.fuels) },
                bind: { ...DEFAULTS.bind, ...(o.bind || {}) },
                fish: { ...DEFAULTS.fish, ...(o.fish || {}) },
                poach: { ...DEFAULTS.poach, ...(o.poach || {}) },
            };
        }
        return _cfgVal;
    },

    /** The player's light state (made when `create`). */
    state(player, create = true) {
        if (!player) return null;
        let st = player.carriedLight;
        if (!st || typeof st !== 'object') {
            if (!create) return null;
            st = player.carriedLight = { lit: null, stub: 0, fuel: 0, at: null };
        }
        if (st.lit !== 'torch' && st.lit !== 'lantern') st.lit = null;
        st.stub = Math.max(0, _num(st.stub));
        st.fuel = Math.max(0, _num(st.fuel));
        return st;
    },

    /** What is lit: 'torch' | 'lantern' | null */
    lit(player) {
        const st = this.state(player, false);
        return st ? st.lit : null;
    },

    /** How much the light counts at this darkness: 0 by day … 1 at full dark */
    strength(darkness) {
        const C = this.config();
        const lo = _num(C.minDarkness, 0.25), hi = Math.max(lo + 0.01, _num(C.fullDarkness, 0.85));
        const d = _num(darkness);
        if (d <= lo) return 0;
        return Math.min(1, (d - lo) / (hi - lo));
    },

    /** The light's settings for a kind ('torch' | 'lantern') */
    kind(kind) {
        const C = this.config();
        return kind === 'lantern' ? C.lantern : kind === 'torch' ? C.torch : null;
    },

    // ── Fuel ──

    /** The fuels in the packs, best first: [{ id, hours, have }] */
    fuelsInPacks(player) {
        const inv = _inv(player);
        const F = this.config().fuels || {};
        return Object.keys(F).filter(id => id !== '_doc' && _num(inv[id]) >= 1 && _num(F[id]) > 0)
            .map(id => ({ id, hours: _num(F[id]), have: Math.floor(_num(inv[id])) }))
            .sort((a, b) => b.hours - a.hours);
    },

    /** One unit of fuel from the packs into the lantern (never past its capacity). → the fuel used, or null */
    refuel(player) {
        const st = this.state(player);
        const cap = Math.max(1, _num(this.config().lantern.capacity, 10));
        const f = this.fuelsInPacks(player)[0];
        if (!f || !_take(player, f.id, 1)) return null;
        st.fuel = Math.min(cap, st.fuel + f.hours);
        return f;
    },

    /** Torches to hand: the stub, and the fresh ones in the packs */
    torches(player) {
        const st = this.state(player, false);
        const T = this.config().torch;
        return { stub: st ? st.stub : 0, fresh: Math.floor(_num(_inv(player)[T.item])) };
    },

    /** Why this light can't be lit now, or null */
    whyNot(player, kind) {
        if (!player) return 'no one to hold it';
        if (!this.config().enabled) return 'not now';
        if (kind === 'torch') {
            const t = this.torches(player);
            return t.stub > 0 || t.fresh > 0 ? null : 'no torch in your packs (bind one: a stick and resin, tallow or a rag)';
        }
        if (kind === 'lantern') {
            if (!(_num(_inv(player)[this.config().lantern.item]) >= 1)) return 'no lantern in your packs';
            const st = this.state(player, false);
            if ((st ? st.fuel : 0) > 0 || this.fuelsInPacks(player).length) return null;
            return 'nothing to burn in it (lamp oil, candles or tallow)';
        }
        return 'no such light';
    },

    /**
     * Light a torch or the lantern at hour `now` (the other put out). → { ok, text, used }
     * A torch: the stub, else a fresh one from the packs. The lantern: dry, a unit of fuel first.
     */
    light(player, kind, now) {
        const why = this.whyNot(player, kind);
        if (why) return { ok: false, text: why };
        const st = this.state(player);
        if (st.lit) this.putOut(player, now);
        let used = null;
        if (kind === 'torch') {
            if (!(st.stub > 0)) {
                _take(player, this.config().torch.item, 1);
                st.stub = Math.max(0.1, _num(this.config().torch.hours, 3));
                used = 'torch';
            }
        } else if (!(st.fuel > 0)) {
            const f = this.refuel(player);
            used = f ? f.id : null;
        }
        st.lit = kind;
        st.at = Number.isFinite(now) ? now : null;
        return { ok: true, used, text: kind === 'torch' ? 'torch lit' : 'lantern lit' };
    },

    /** Put out what is lit (burnt to hour `now` first; the stub or the fuel kept). → what was lit */
    putOut(player, now) {
        const st = this.state(player, false);
        if (!st || !st.lit) return null;
        if (Number.isFinite(now)) this.tick(player, now);
        const was = st.lit;
        st.lit = null;
        st.at = null;
        return was;
    },

    /** In the water: the light out; a torch drowned (the stub lost). → what was lit */
    douse(player, now) {
        const st = this.state(player, false);
        const was = this.putOut(player, now);
        if (was === 'torch' && st) st.stub = 0;
        return was;
    },

    /**
     * Burn the light on to hour `now`: a torch down to nothing (the next lit from the
     * packs), the lantern's fuel (filled from the packs as it runs dry). → notices [{ kind, text }]
     */
    tick(player, now) {
        const out = [];
        const st = this.state(player, false);
        if (!st || !st.lit || !Number.isFinite(now)) return out;
        if (!Number.isFinite(st.at)) { st.at = now; return out; }
        let dt = Math.max(0, now - st.at);
        st.at = now;
        for (let guard = 0; dt > 0 && st.lit && guard < 200; guard++) {
            if (st.lit === 'torch') {
                const burn = Math.min(dt, st.stub);
                st.stub -= burn; dt -= burn;
                if (st.stub > 1e-6) break;
                st.stub = 0;
                if (_take(player, this.config().torch.item, 1)) {
                    st.stub = Math.max(0.1, _num(this.config().torch.hours, 3));
                    out.push({ kind: 'torch_next', text: 'Your torch gutters out; you light a fresh one from it.' });
                } else {
                    st.lit = null; st.at = null;
                    out.push({ kind: 'torch_out', text: 'Your torch gutters and goes out. You have no other.' });
                }
            } else {
                if (!(_num(_inv(player)[this.config().lantern.item]) >= 1)) {
                    st.lit = null; st.at = null;
                    out.push({ kind: 'lantern_gone', text: 'You no longer have the lantern.' });
                    break;
                }
                const burn = Math.min(dt, st.fuel);
                st.fuel -= burn; dt -= burn;
                if (st.fuel > 1e-6) break;
                st.fuel = 0;
                const f = this.refuel(player);
                if (f) out.push({ kind: 'lantern_fill', text: `Your lantern burns dry; you fill it (${f.id.replace(/_/g, ' ')}).` });
                else {
                    st.lit = null; st.at = null;
                    out.push({ kind: 'lantern_out', text: 'Your lantern burns dry and goes out: nothing left to burn in it.' });
                }
            }
        }
        return out;
    },

    // ── Binding torches by hand ──

    /** What you would bind torches from: { stick, binder, makes } or null */
    bindPlan(player) {
        const inv = _inv(player);
        const B = this.config().bind || {};
        const sticks = B.sticks || {};
        let stick = null;
        for (const id of Object.keys(sticks)) if (_num(inv[id]) >= 1 && _num(sticks[id]) > 0) { stick = id; break; }
        const binder = (B.binders || []).find(id => _num(inv[id]) >= 1) || null;
        if (!stick || !binder) return null;
        return { stick, binder, makes: Math.max(1, Math.round(_num(sticks[stick], 1))) };
    },

    /** Bind torches: one stick-stuff and one binder used up, the torches into the packs. → { ok, made, stick, binder, text } */
    bindTorch(player) {
        const plan = this.bindPlan(player);
        if (!plan) return { ok: false, made: 0, text: 'You need a stick (sticks, firewood, driftwood or wood) and resin, tallow or a strip of cloth to bind on it.' };
        const item = this.config().torch.item;
        if (!PlayerInventory.canAdd(player, item)) return { ok: false, made: 0, text: PlayerInventory.fullMessage(player) };
        _take(player, plan.stick, 1);
        _take(player, plan.binder, 1);
        PlayerInventory.addItem(player, item, plan.makes, { force: true });
        return { ok: true, made: plan.makes, stick: plan.stick, binder: plan.binder, text: `bound ${plan.makes} torch${plan.makes > 1 ? 'es' : ''}` };
    },

    // ── Poachers ──

    /** How near a poacher lets you come before he runs: farther by far when he sees your light at night */
    scareReach(base, player, darkness) {
        const b = Math.max(1, _num(base, 5));
        if (!this.lit(player) || this.strength(darkness) <= 0) return b;
        return Math.round(b * Math.max(1, _num(this.config().poach.scareMult, 2)));
    },

    /** Is the lantern hung at this trap burning in hour h? */
    lanternBurning(trap, h) {
        const L = trap && trap.lantern;
        return !!(L && Number.isFinite(h) && h >= Math.floor(_num(L.from)) && h < _num(L.until));
    },

    /**
     * Hang a lantern at your trap from hour `now`: a lantern from the packs (the lit one put
     * out), its fuel with it (topped up with a unit from the packs under poach.minHang hours).
     * → { ok, hours, text }
     */
    hangLantern(trap, player, now) {
        if (!trap || !player) return { ok: false, text: 'Nothing to hang it on.' };
        if (trap.lantern) return { ok: false, text: 'A lantern already hangs there.' };
        const C = this.config();
        if (!(_num(_inv(player)[C.lantern.item]) >= 1)) return { ok: false, text: 'You have no lantern.' };
        const st = this.state(player);
        if (st.lit === 'lantern') this.putOut(player, now);
        if (st.fuel < _num(C.poach.minHang, 6)) this.refuel(player);
        if (!(st.fuel > 0)) return { ok: false, text: 'You have nothing to burn in it (lamp oil, candles or tallow).' };
        _take(player, C.lantern.item, 1);
        const hours = st.fuel;
        trap.lantern = { from: now, until: now + hours };
        st.fuel = 0;
        return { ok: true, hours, text: `A lantern hangs at the trap: about ${Math.round(hours)} hours of light.` };
    },

    /** Take the lantern down at hour `now`: it and what fuel is left back to you. → { ok, left } */
    takeDownLantern(trap, player, now) {
        if (!trap || !trap.lantern || !player) return { ok: false, left: 0 };
        const C = this.config();
        const left = Math.max(0, _num(trap.lantern.until) - Math.max(_num(trap.lantern.from), _num(now)));
        delete trap.lantern;
        PlayerInventory.addItem(player, C.lantern.item, 1, { force: true });
        const st = this.state(player);
        st.fuel = Math.min(Math.max(1, _num(C.lantern.capacity, 10)), Math.max(st.fuel, left));
        return { ok: true, left };
    },
};
