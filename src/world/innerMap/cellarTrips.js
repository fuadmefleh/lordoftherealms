// InnerMap — down to the cellar and back: the staff of a building with a cellar under it
// (floors.js cellarOf: a tavern's ale cellar, a manor's wine cellar, a shop's store
// cellar, a bank's vault) go down now and then to fetch what's kept there and come back up.
//
//   _cellarKeeper(npc, b)     one who fetches from b's cellar: its owner, those who work there
//                             (the innkeeper and the serving staff, the shopkeeper), the
//                             servants of the house (living in or by day) — never a customer,
//                             a lodger, a child, the lord himself, a guard or a priest
//   _cellarTripNow(npc)       on a trip down this minute? Each half-hour (slotMinutes) a
//                             keeper may make one (chance by the cellar's kind), of minutes
//                             long, at a time in the slot by a hash of them, the day and the
//                             slot (no RNG drawn: the same trips whenever you look); only in
//                             the waking hours, not abed nor at a meal
//   _cellarFloorFor(npc)      -1 while they're down there (floors.npcFloor's hook: whoever
//                             goes to a floor finds them where their trip has them)
//   _updateCellarTrips(dt)    each frame inside (npcs.updateNPCs): one whose trip starts while
//                             they're in sight walks to the cellar steps (or the stairs down)
//                             and goes down; with the player in the cellar they come down the
//                             steps to the casks, racks, crates and sacks, and when the trip
//                             is up walk back to the steps and up; seen coming up on the
//                             ground floor, they carry what they fetched for a moment
//   _cellarTripStep(npc, dt)  their walk to the steps (furnitureUse._updateInteriorNpc's hook)
//
// Data: data/interiorPlans.json `cellarTrips` (over the defaults below).

import { InnerMap } from './_ref.js';
import { DataLoader } from './_imports.js';

const DEFAULTS = {
    enabled: true,
    hours: [6, 23],
    slotMinutes: 30,
    minutes: [8, 15],
    chance: { ale_cellar: 0.5, wine_cellar: 0.3, store_cellar: 0.35, root_cellar: 0.2, vault: 0.15, _default: 0.3 },
    notJobs: ['noble', 'guard', 'priest', 'beggar'],
    notTypes: ['child', 'traveler', 'guard', 'noble', 'priest', 'beggar'],
    carrySecs: 6,
    carry: {
        ale_cellar: { icon: '🍺', label: 'up from the cellar with a jug of ale' },
        wine_cellar: { icon: '🍷', label: 'up from the cellar with a bottle' },
        store_cellar: { icon: '📦', label: 'up from the cellar with stores' },
        root_cellar: { icon: '🥕', label: 'up from the cellar with roots' },
        vault: { icon: '💰', label: 'up from the vault' },
        _default: { icon: '📦', label: 'up from the cellar' },
    },
    going: { icon: '🔽', label: 'going down to the cellar' },
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};
const _same = (a, b) => !!(a && b && a.q === b.q && a.r === b.r);

function _cfg() {
    const P = (DataLoader._gamedata && DataLoader._gamedata.interiorPlans) || {};
    const d = (P.cellarTrips && typeof P.cellarTrips === 'object') ? P.cellarTrips : {};
    return { ...DEFAULTS, ...d, chance: { ...DEFAULTS.chance, ...(d.chance || {}) }, carry: { ...DEFAULTS.carry, ...(d.carry || {}) } };
}

Object.assign(InnerMap, {
    cellarTripsConfig: _cfg,

    /** Does this one fetch from the cellar of `b` (the building the player is in)? */
    _cellarKeeper(npc, b = this._insideBuilding) {
        if (!npc || !b || b !== this._insideBuilding || !this._hasCellar) return false;
        if (npc.state !== 'inside_building' || npc._insideBuildingQ !== b.q || npc._insideBuildingR !== b.r) return false;
        if (npc.departing || npc._carried || npc.state === 'unconscious') return false;
        const C = _cfg();
        if ((C.notTypes || []).includes(npc.type) || (C.notJobs || []).includes(npc.job)) return false;
        if (this._hhInfant && this._hhInfant(npc)) return false;
        if (this._hhChild && this._hhChild(npc)) return false;
        if (b.ownerId != null && b.ownerId === npc.id) return true;
        if (_same(npc._work, b)) return true;
        // (a servant living in: householdRooms.js)
        return !!(npc._liveIn && _same(npc._home, b));
    },

    /** Is `npc` down in the cellar (on a trip) at `clock` (hours, fractional)? Ignores who they are. */
    _cellarTripAt(npc, clock, day = this.worldDay || 0, kind = this._cellarKind) {
        const C = _cfg();
        if (!C.enabled || !npc) return false;
        const h = ((clock % 24) + 24) % 24;
        const [h0, h1] = Array.isArray(C.hours) ? C.hours : [6, 23];
        if (h < h0 || h >= h1) return false;
        const slot = Math.max(10, _num(C.slotMinutes, 30));
        const mins = h * 60;
        const s = Math.floor(mins / slot);
        const id = String(npc.id != null ? npc.id : npc.name || '');
        const chance = _num((C.chance || {})[kind] != null ? C.chance[kind] : (C.chance || {})._default, 0.3);
        if ((_hash(`${id}|${day}|${s}|cellar`) % 1000) / 1000 >= chance) return false;
        const [lo, hi] = Array.isArray(C.minutes) ? C.minutes : [8, 15];
        const len = Math.min(slot - 1, lo + (_hash(`${id}|${day}|${s}|len`) % Math.max(1, hi - lo + 1)));
        const start = s * slot + (_hash(`${id}|${day}|${s}|at`) % Math.max(1, slot - len));
        return mins >= start && mins < start + len;
    },

    /** On a trip down to the cellar now? */
    _cellarTripNow(npc) {
        if (!this._cellarKeeper(npc)) return false;
        if (npc._asleep || npc._meal === 'breakfast' || npc._meal === 'supper') return false;
        if (this._townAbed && this._townAbed(npc)) return false;
        if (this._sickAbed && this._sickAbed(npc)) return false;
        const clock = this._sceneClock ? this._sceneClock() : _num(this.timeOfDay, 8);
        return this._cellarTripAt(npc, clock);
    },

    /** floors.npcFloor's hook: -1 while they're down in the cellar, else null (their own floor). */
    _cellarFloorFor(npc) {
        if (!this._hasCellar || !this._insideBuilding) return null;
        // (the player changed floors while they walked to the stairs: they got there)
        if (npc && npc._cellarWalk) {
            const down = npc._cellarWalk.dir === 'down';
            npc._cellarWalk = null;
            npc._cellarBelow = down;
            npc._cellarGone = false;
            if (npc.activity && npc.activity.type === 'cellar') npc.activity = null;
            return down ? -1 : null;
        }
        const down = this._cellarTripNow(npc);
        if (npc) npc._cellarBelow = down;
        return down ? -1 : null;
    },

    /** The stairs tile on this floor leading toward floor `to` (down: below this one; up: above), or null. */
    _cellarStairs(dir) {
        const cur = this._floor || 0;
        for (const row of this.tiles || []) for (const t of row || []) {
            if (!t || !t._stairs) continue;
            const to = t._stairs.to;
            if (dir === 'down' ? (cur === 0 ? to === -1 : to < cur) : to > cur) return { q: t.q, r: t.r };
        }
        return null;
    },

    /** Set them walking to the stairs (down to the cellar, or up out of it); there, they're gone from this floor. */
    _cellarSend(npc, dir) {
        if (npc._scene && this._sceneDrop) this._sceneDrop(npc);
        if (npc._act && this._offPiece) this._offPiece(npc, npc._act);
        if (npc._behindCounter) npc._behindCounter = null;
        npc._act = null;
        npc._mealSeat = null;
        const C = _cfg();
        npc.activity = dir === 'down' ? { type: 'cellar', ...C.going, anim: 'idle' } : null;
        const at = this._cellarStairs(dir);
        npc._cellarWalk = { dir };
        if (!at || !this._npcWalkTo(npc, at.q, at.r)) this._cellarGoneFrom(npc);
    },

    /** Off this floor down (or up) the stairs. */
    _cellarGoneFrom(npc) {
        const w = npc._cellarWalk;
        npc._cellarWalk = null;
        npc._cellarBelow = !!(w && w.dir === 'down');
        npc.path = null;
        npc.activity = null;
        npc._cellarGone = true;
    },

    /** In by the stairs: down the cellar steps (dir 'down'), or up them onto the ground floor with what they fetched. */
    _cellarAppear(npc, dir) {
        const at = this._cellarStairs(dir === 'down' ? 'up' : 'down');
        if (!at) return false;
        const spot = this._besideStairs ? this._besideStairs({ tiles: this.tiles }, at) : at;
        npc.q = npc.prevQ = spot.q;
        npc.r = npc.prevR = spot.r;
        npc.path = null;
        npc.moveProgress = 0;
        npc._asleep = null;
        npc._scene = null;
        npc._act = { phase: 'rest', timer: 1 + (_hash(`${npc.id}|${this.worldDay}|${dir}`) % 3), spot: null };
        npc.idleTimer = Math.max(npc.idleTimer || 0, 30);
        npc.state = 'inside_building';
        if (dir === 'up') {
            const C = _cfg();
            const c = (C.carry || {})[this._cellarKind] || (C.carry || {})._default || DEFAULTS.carry._default;
            npc.activity = { type: 'cellar', icon: c.icon, label: c.label, anim: 'idle' };
            npc._cellarCarry = _num(C.carrySecs, 6);
        } else npc.activity = null;
        if (!this.npcs.includes(npc)) this.npcs.push(npc);
        return true;
    },

    /**
     * Each frame inside a building with a cellar: its keepers go down and come up as their
     * trips start and end, in sight on the floor the player is on (the ground floor or the cellar).
     */
    _updateCellarTrips(dt) {
        const b = this._insideBuilding;
        // (those who reached the stairs are off this floor)
        if (this.npcs && this.npcs.some(n => n._cellarGone)) {
            const gone = this.npcs.filter(n => n._cellarGone);
            this.npcs = this.npcs.filter(n => !n._cellarGone);
            for (const n of gone) n._cellarGone = false;
        }
        if (!b || !this._hasCellar || !_cfg().enabled) return;
        this._cellarTick = (this._cellarTick || 0) + dt;
        if (this._cellarTick < 0.5) return;
        this._cellarTick = 0;
        const cur = this._floor || 0;
        const outer = (this._outerMapState && this._outerMapState.npcs) || this.npcs || [];
        for (const npc of outer) {
            if (npc._cellarWalk) continue;
            if (!this._cellarKeeper(npc, b)) {
                // (no longer one of them — gone out, abed: nobody's left below)
                if (npc._cellarBelow && npc.state !== 'inside_building') npc._cellarBelow = false;
                continue;
            }
            const want = this._cellarTripNow(npc);
            const below = !!npc._cellarBelow;
            const shown = this.npcs.includes(npc);
            if (want === below) continue;
            if (want) {
                if (shown && cur === -1) { npc._cellarBelow = true; continue; }
                if (shown) { this._cellarSend(npc, 'down'); continue; }
                npc._cellarBelow = true;
                if (cur === -1) this._cellarAppear(npc, 'down');
            } else {
                if (shown && cur === -1) { this._cellarSend(npc, 'up'); continue; }
                npc._cellarBelow = false;
                if (shown) continue;
                // Up the steps onto the ground floor — or up the stairs onto the floor of their own above it
                if (cur === 0 || (cur > 0 && this.npcFloor && this.npcFloor(npc) === cur)) this._cellarAppear(npc, 'up');
            }
        }
    },

    /** furnitureUse._updateInteriorNpc's hook: the walk to the stairs, and the moment they carry what they fetched. True while it has them. */
    _cellarTripStep(npc, dt) {
        if (npc._cellarGone) return true;
        if (npc._cellarWalk) {
            if (npc._scene && this._sceneDrop) this._sceneDrop(npc);
            if (this._npcStep(npc, dt)) {
                const at = this._cellarStairs(npc._cellarWalk.dir);
                if (at && (npc.q !== at.q || npc.r !== at.r) && Math.max(Math.abs(at.q - npc.q), Math.abs(at.r - npc.r)) > 1 && this._npcWalkTo(npc, at.q, at.r)) return true;
                this._cellarGoneFrom(npc);
            }
            return true;
        }
        if (npc._cellarCarry > 0) {
            npc._cellarCarry -= dt;
            if (npc._cellarCarry <= 0) { npc._cellarCarry = 0; if (npc.activity && npc.activity.type === 'cellar') npc.activity = null; }
        }
        // (down in the cellar on their errand: not out of the building by the cellar steps)
        if (npc._cellarBelow && (this._floor || 0) === -1) npc.idleTimer = Math.max(npc.idleTimer || 0, 10);
        return false;
    },
});
