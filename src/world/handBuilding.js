// ============================================
// HAND BUILDING — small things you build yourself on the street map
// ============================================
// The model: what can be built (data/handBuilding.json structures), the
// record of what stands or is going up on each hex's street map, the work
// done on a site, the goods it takes from your packs stage by stage, the
// hired hands who work beside you, the dismantling, and what a finished
// structure gives (a store, room for hens, a scarecrow's guard, a seat).
//
// State: world.handBuilt = { seq, hexes: { 'q,r': { camp: { q, r } | null,
// items: [rec] } } } (saved by systems/saveLoad.js), where
//   rec = { id, kind, q, r, stage, progress, paid: [{ good: n }], done,
//           day, doneDay, store: { good: n }, label, hands: [{ day, name, preset }] }
// (q, r) is the structure's anchor on the street map: its bottom-left cell;
// it covers footprint [w, h] cells to the right and up from there.
//
// The ground (whose it is, what may stand where) and the standing on the
// map are world/innerMap/handBuilding.js; the mode, the work in person and
// the drawing ui/innerMapHandBuild.js. The clock is the caller's: work()
// is told how many hours were worked. No randomness drawn.

import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = (v) => Math.round(v * 100) / 100;
const _hexKey = (hq, hr) => `${hq},${hr}`;

const DEFAULTS = {
    enabled: true,
    ground: { aroundHome: 4, campRadius: 7, maxPerHex: 80 },
    work: { chunkSeconds: 2.5, chunkMinutes: 30, lateHour: 22, toolGoods: ['tools', 'steel_tools'], toolSpeed: 1.35, needs: { energy: -2, hygiene: -1 } },
    hands: { perHandSpeed: 0.75, max: 2, wageMult: 1.5, fallbackWage: 0.6 },
    dismantle: { finishedShare: 0.5, siteShare: 0.8, hoursShare: 0.25 },
    order: [],
    structures: {},
};

let _src = null;
let _cfg = null;

function _goodName(id) {
    const G = DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS;
    const g = G && G[String(id).toUpperCase()];
    return (g && g.name) || String(id).replace(/_/g, ' ');
}

export const HandBuilding = {
    config() {
        const src = (DataLoader._gamedata && DataLoader._gamedata.handBuilding) || null;
        if (_cfg && src === _src) return _cfg;
        _src = src;
        const d = src || {};
        _cfg = {
            ...DEFAULTS, ...d,
            ground: { ...DEFAULTS.ground, ...(d.ground || {}) },
            work: { ...DEFAULTS.work, ...(d.work || {}) },
            hands: { ...DEFAULTS.hands, ...(d.hands || {}) },
            dismantle: { ...DEFAULTS.dismantle, ...(d.dismantle || {}) },
            structures: _obj(d.structures) || {},
        };
        return _cfg;
    },

    enabled() {
        return this.config().enabled !== false;
    },

    /** A kind's definition (data/handBuilding.json structures[kind]) with its id, or null. */
    def(kind) {
        const s = this.config().structures[kind];
        return s ? { id: kind, ...s } : null;
    },

    /** Every kind, in the palette's order. */
    kinds() {
        const C = this.config();
        const all = Object.keys(C.structures);
        const order = (C.order || []).filter(k => all.includes(k));
        return [...order, ...all.filter(k => !order.includes(k))].map(k => this.def(k));
    },

    /** [w, h] of a kind (data footprint; the map may take a prop's own size instead). */
    footprint(kind) {
        const d = this.def(kind);
        const f = d && Array.isArray(d.footprint) ? d.footprint : [1, 1];
        return [Math.max(1, Math.floor(_num(f[0], 1))), Math.max(1, Math.floor(_num(f[1], 1)))];
    },

    /** The cells covered with the anchor (bottom-left) at (q, r), for a footprint [w, h]. */
    cellsAt(q, r, [w, h]) {
        const out = [];
        for (let dr = 0; dr < h; dr++) for (let dq = 0; dq < w; dq++) out.push({ q: q + dq, r: r - dr });
        return out;
    },

    /** Every good its stages take, summed: { good: n }. */
    totalNeeds(kind) {
        const d = this.def(kind);
        const out = {};
        for (const st of (d && d.stages) || []) for (const [g, n] of Object.entries(st.needs || {})) out[g] = _num(out[g]) + _num(n);
        return out;
    },

    /** The hours of work its stages take, summed. */
    totalHours(kind) {
        const d = this.def(kind);
        return _r2(((d && d.stages) || []).reduce((s, st) => s + _num(st.hours), 0));
    },

    /** "4 wood, 8 sawn planks" */
    needsText(needs) {
        const parts = Object.entries(needs || {}).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${_goodName(g).toLowerCase()}`);
        return parts.length ? parts.join(', ') : 'nothing but work';
    },

    goodName(id) {
        return _goodName(id);
    },

    // ──────────── THE RECORD ────────────

    state(world, create = false) {
        if (!world) return null;
        if (!_obj(world.handBuilt)) {
            if (!create) return null;
            world.handBuilt = { seq: 1, hexes: {} };
        }
        if (!_obj(world.handBuilt.hexes)) world.handBuilt.hexes = {};
        return world.handBuilt;
    },

    /** The record of a hex's map: { camp, items } (made when create is set), or null. */
    hex(world, hq, hr, create = false) {
        const st = this.state(world, create);
        if (!st) return null;
        const k = _hexKey(hq, hr);
        if (!st.hexes[k] && create) st.hexes[k] = { camp: null, items: [] };
        const h = st.hexes[k] || null;
        if (h && !Array.isArray(h.items)) h.items = [];
        return h;
    },

    /** Every structure and site on a hex's map. */
    at(world, hq, hr) {
        const h = this.hex(world, hq, hr);
        return h ? h.items : [];
    },

    find(world, hq, hr, id) {
        return this.at(world, hq, hr).find(x => x && x.id === id) || null;
    },

    /** The camp staked on a hex's map ({ q, r }), or null. */
    camp(world, hq, hr) {
        const h = this.hex(world, hq, hr);
        return (h && h.camp) || null;
    },

    /** Stake (or move, while nothing stands on the old ground) your camp on a wilds map. */
    stakeCamp(world, hq, hr, q, r) {
        const h = this.hex(world, hq, hr, true);
        if (h.camp && h.items.length) return { ok: false, reason: 'You have built on your camp\'s ground already: take your things down to move it.' };
        h.camp = { q, r };
        return { ok: true, camp: h.camp };
    },

    /** Strike your camp (only once nothing of yours stands on it). */
    strikeCamp(world, hq, hr) {
        const h = this.hex(world, hq, hr);
        if (!h || !h.camp) return { ok: false, reason: 'You have no camp here.' };
        if (h.items.length) return { ok: false, reason: 'Take down what you built here first.' };
        h.camp = null;
        return { ok: true };
    },

    /**
     * Lay a site of `kind` with its anchor at (q, r) on hex (hq, hr). The ground
     * is checked by the caller (world/innerMap/handBuilding.js). → { ok, rec, reason }
     */
    lay(world, hq, hr, kind, q, r, day = 0) {
        const d = this.def(kind);
        if (!d) return { ok: false, reason: 'Nothing of that kind can be built.' };
        const h = this.hex(world, hq, hr, true);
        if (h.items.length >= _num(this.config().ground.maxPerHex, 80)) return { ok: false, reason: 'You have built all this ground will hold.' };
        const st = this.state(world, true);
        const rec = { id: `hb${st.seq++}`, kind, q, r, stage: 0, progress: 0, paid: [], done: false, day: _num(day), doneDay: null, store: {}, label: null, hands: [] };
        h.items.push(rec);
        return { ok: true, rec };
    },

    /** The stage being worked (or next to be): { index, stage } or null when done. */
    stageOf(rec) {
        const d = rec && this.def(rec.kind);
        if (!d || rec.done) return null;
        const i = Math.max(0, Math.floor(_num(rec.stage)));
        const stage = (d.stages || [])[i];
        return stage ? { index: i, stage } : null;
    },

    /** How far along the whole build is (0..1). */
    fraction(rec) {
        const d = rec && this.def(rec.kind);
        if (!d) return 0;
        if (rec.done) return 1;
        const total = this.totalHours(rec.kind) || 1;
        let done = 0;
        (d.stages || []).forEach((st, i) => {
            if (i < rec.stage) done += _num(st.hours);
            else if (i === rec.stage) done += Math.min(_num(st.hours), _num(rec.progress));
        });
        return Math.max(0, Math.min(1, done / total));
    },

    /** Is the current stage's goods yet to be laid out? */
    _unpaid(rec) {
        const s = this.stageOf(rec);
        return !!s && !rec.paid[s.index];
    },

    /** What the player still lacks for a stage's goods: { good: short } (empty when all there). */
    missing(player, needs) {
        const inv = (player && player.inventory) || {};
        const out = {};
        for (const [g, n] of Object.entries(needs || {})) {
            const short = _num(n) - _num(inv[g]);
            if (short > 0) out[g] = short;
        }
        return out;
    },

    /**
     * May work go on at this site now? → { ok, reason, missing, stage }
     * (the stage's goods must be in the packs, unless they were laid out already)
     */
    canWork(player, rec) {
        if (!rec) return { ok: false, reason: 'There is nothing to build there.' };
        if (rec.done) return { ok: false, reason: 'It is finished.' };
        const s = this.stageOf(rec);
        if (!s) return { ok: false, reason: 'It is finished.' };
        if (!rec.paid[s.index]) {
            const miss = this.missing(player, s.stage.needs);
            if (Object.keys(miss).length) return { ok: false, reason: `${s.stage.name} needs ${this.needsText(s.stage.needs)}: you are short ${this.needsText(miss)}.`, missing: miss, stage: s };
        }
        return { ok: true, stage: s };
    },

    /** Take a stage's goods out of the packs. */
    _pay(player, rec, s) {
        const taken = {};
        for (const [g, n] of Object.entries(s.stage.needs || {})) {
            const k = Math.max(0, Math.floor(_num(n)));
            if (!k) continue;
            player.inventory[g] = _num(player.inventory[g]) - k;
            if (player.inventory[g] <= 0) delete player.inventory[g];
            taken[g] = k;
        }
        rec.paid[s.index] = taken;
        return taken;
    },

    /** Hands hired for this site who work today. */
    handsToday(rec, day) {
        return ((rec && rec.hands) || []).filter(h => h && _num(h.day, -1) === _num(day));
    },

    /** Do the packs hold a tool to build with? */
    hasTools(player) {
        const inv = (player && player.inventory) || {};
        return (this.config().work.toolGoods || []).some(id => _num(inv[id]) > 0);
    },

    /** How many hours of building an hour's work does: tools and the hands working beside you. */
    speed(player, rec, day) {
        const C = this.config();
        const tools = this.hasTools(player) ? Math.max(1, _num(C.work.toolSpeed, 1)) : 1;
        const hands = this.handsToday(rec, day).length;
        return _r2(tools * (1 + _num(C.hands.perHandSpeed, 0.75) * hands));
    },

    /**
     * Work `hours` on a site. Lays out the stage's goods first (from the packs)
     * when they aren't yet. A stage finished moves on to the next; the work
     * does not run past a stage's end. → { ok, reason, missing, paid, stageDone,
     * finished, stage, next, gained }
     */
    work(world, player, rec, hours, opts = {}) {
        const chk = this.canWork(player, rec);
        if (!chk.ok) return { ok: false, reason: chk.reason, missing: chk.missing || null };
        const s = chk.stage;
        let paid = null;
        if (!rec.paid[s.index]) paid = this._pay(player, rec, s);
        const day = opts.day != null ? opts.day : _num(world && world.day);
        const gained = _r2(Math.max(0, _num(hours)) * this.speed(player, rec, day));
        const need = _num(s.stage.hours);
        rec.progress = _r2(Math.min(need, _num(rec.progress) + gained));
        const out = { ok: true, paid, stageDone: false, finished: false, stage: s.stage, next: null, gained };
        if (rec.progress >= need - 1e-6) {
            out.stageDone = true;
            rec.stage = s.index + 1;
            rec.progress = 0;
            const d = this.def(rec.kind);
            const next = (d.stages || [])[rec.stage];
            if (!next) {
                rec.done = true;
                rec.doneDay = day;
                out.finished = true;
            } else out.next = next;
        }
        return out;
    },

    /** Everything its stages took from the packs, summed. */
    paidTotal(rec) {
        const out = {};
        for (const p of (rec && rec.paid) || []) for (const [g, n] of Object.entries(p || {})) out[g] = _num(out[g]) + _num(n);
        return out;
    },

    /** What taking it down gives back: { good: n }. */
    salvage(rec) {
        const C = this.config().dismantle;
        const share = rec && rec.done ? _num(C.finishedShare, 0.5) : _num(C.siteShare, 0.8);
        const out = {};
        for (const [g, n] of Object.entries(this.paidTotal(rec))) {
            const k = Math.floor(n * share + 1e-9);
            if (k > 0) out[g] = k;
        }
        return out;
    },

    /** The hours taking it down takes (a bare site: a few minutes). */
    dismantleHours(rec) {
        if (!rec) return 0;
        const base = rec.done ? this.totalHours(rec.kind) : this.totalHours(rec.kind) * this.fraction(rec);
        return Math.max(0.25, _r2(base * _num(this.config().dismantle.hoursShare, 0.25)));
    },

    /**
     * Take a structure or a site down: the goods it gives back into the packs
     * (what has no room is left out of the count), the record let go.
     * → { ok, reason, got, lost }
     */
    dismantle(world, player, hq, hr, id) {
        const h = this.hex(world, hq, hr);
        const rec = h && h.items.find(x => x && x.id === id);
        if (!rec) return { ok: false, reason: 'It is gone already.' };
        if (Object.values(rec.store || {}).some(n => _num(n) > 0)) return { ok: false, reason: 'Empty it first: take out what is stored in it.' };
        const got = {}, lost = {};
        for (const [g, n] of Object.entries(this.salvage(rec))) {
            const ok = player ? PlayerInventory.addItem(player, g, n).success : false;
            if (ok) got[g] = n; else lost[g] = n;
        }
        h.items = h.items.filter(x => x !== rec);
        return { ok: true, got, lost, rec };
    },

    // ──────────── WHAT IT GIVES ────────────

    /** Its store's rules ({ capacity, goods }) or null when it keeps nothing. */
    storeRules(kind) {
        const d = this.def(kind);
        return d && d.store ? { capacity: Math.max(0, _num(d.store.capacity)), goods: Array.isArray(d.store.goods) ? d.store.goods : null } : null;
    },

    storeUsed(rec) {
        return Object.values((rec && rec.store) || {}).reduce((s, n) => s + _num(n), 0);
    },

    /** May this good go into it? → { ok, reason, room } */
    canStore(rec, good) {
        const R = rec && rec.done ? this.storeRules(rec.kind) : null;
        if (!R) return { ok: false, reason: 'It keeps nothing.' };
        if (R.goods && !R.goods.includes(good)) return { ok: false, reason: `Only ${R.goods.map(g => _goodName(g).toLowerCase()).join(', ')} go in it.` };
        const room = Math.max(0, R.capacity - this.storeUsed(rec));
        if (!room) return { ok: false, reason: 'It is full.', room: 0 };
        return { ok: true, room };
    },

    /** Put `n` of a good from the packs in. → { ok, reason, moved } */
    putIn(player, rec, good, n = 1) {
        const chk = this.canStore(rec, good);
        if (!chk.ok) return { ok: false, reason: chk.reason, moved: 0 };
        const have = Math.floor(_num(player && player.inventory && player.inventory[good]));
        const k = Math.min(have, chk.room, Math.max(1, Math.floor(_num(n, 1))));
        if (!(k > 0)) return { ok: false, reason: `You carry no ${_goodName(good).toLowerCase()}.`, moved: 0 };
        player.inventory[good] = have - k;
        if (player.inventory[good] <= 0) delete player.inventory[good];
        if (!_obj(rec.store)) rec.store = {};
        rec.store[good] = _num(rec.store[good]) + k;
        return { ok: true, moved: k };
    },

    /** Take `n` of a good out into the packs. → { ok, reason, moved } */
    takeOut(player, rec, good, n = 1) {
        const have = Math.floor(_num(rec && rec.store && rec.store[good]));
        if (!(have > 0)) return { ok: false, reason: 'There is none of that in it.', moved: 0 };
        const k = Math.min(have, Math.max(1, Math.floor(_num(n, 1))));
        if (!PlayerInventory.addItem(player, good, k).success) return { ok: false, reason: PlayerInventory.fullMessage(player), moved: 0 };
        rec.store[good] = have - k;
        if (rec.store[good] <= 0) delete rec.store[good];
        return { ok: true, moved: k };
    },

    /**
     * The room for livestock the finished structures on a hex add (a hen coop):
     * { capacity, species } — systems/livestock.js adds it to a place of yours there.
     */
    roomOn(world, hq, hr) {
        let capacity = 0;
        const species = new Set();
        for (const rec of this.at(world, hq, hr)) {
            const d = rec && rec.done ? this.def(rec.kind) : null;
            if (!d || !d.room) continue;
            capacity += Math.max(0, _num(d.room.capacity));
            for (const s of d.room.species || []) species.add(s);
        }
        return { capacity, species: [...species] };
    },

    /** The share more a ripe crop at street cell (q, r) yields for a finished scarecrow in reach (the best one). */
    guardBonus(world, hq, hr, q, r) {
        let best = 0;
        for (const rec of this.at(world, hq, hr)) {
            const d = rec && rec.done ? this.def(rec.kind) : null;
            if (!d || !d.guard) continue;
            const reach = Math.max(0, _num(d.guard.reach, 4));
            if (Math.max(Math.abs(rec.q - q), Math.abs(rec.r - r)) <= reach) best = Math.max(best, _num(d.guard.bonus));
        }
        return best;
    },

    /** Hire a hand for today at this wage (the purse paid by the caller's town). → { ok, reason } */
    canHire(player, rec, day, wage) {
        if (!rec || rec.done) return { ok: false, reason: 'There is nothing left to build there.' };
        const max = Math.max(0, Math.floor(_num(this.config().hands.max, 2)));
        if (this.handsToday(rec, day).length >= max) return { ok: false, reason: `At most ${max} hands can work beside you on it.` };
        if (_num(player && player.gold) < wage) return { ok: false, reason: `A hand wants ${wage}g for the day.` };
        return { ok: true };
    },

    /** Take a hand on for today (the wage already paid). */
    addHand(rec, day, who = {}) {
        if (!Array.isArray(rec.hands)) rec.hands = [];
        // (yesterday's hands have gone home)
        rec.hands = rec.hands.filter(h => h && _num(h.day, -1) === _num(day));
        const hand = { day: _num(day), name: who.name || 'a hired hand', preset: who.preset || null };
        rec.hands.push(hand);
        return hand;
    },

    // ──────────── SAVE ────────────

    serialize(world) {
        const st = this.state(world);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(data, world) {
        if (!world) return;
        if (!_obj(data) || !_obj(data.hexes)) { delete world.handBuilt; return; }
        const hexes = {};
        for (const [k, h] of Object.entries(data.hexes)) {
            if (!_obj(h)) continue;
            const items = (Array.isArray(h.items) ? h.items : []).filter(x => x && x.id && x.kind && Number.isFinite(x.q) && Number.isFinite(x.r))
                .map(x => ({ stage: 0, progress: 0, paid: [], done: false, store: {}, hands: [], label: null, ...x }));
            const camp = _obj(h.camp) && Number.isFinite(h.camp.q) && Number.isFinite(h.camp.r) ? { q: h.camp.q, r: h.camp.r } : null;
            if (items.length || camp) hexes[k] = { camp, items };
        }
        world.handBuilt = { seq: Math.max(1, Math.floor(_num(data.seq, 1))), hexes };
    },
};
