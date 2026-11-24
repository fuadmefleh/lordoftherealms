// ============================================
// BELOW DECKS — the rooms under the deck, what is in them, who is there
// ============================================
// The rules for going below on your ship at sea (data/belowDecks.json):
//
//   Plan     — the rooms, bow to stern: crew berths (a hammock a hand, slung
//              in rows either side of an aisle), the galley (its stove, the
//              mess table and benches, the water casks), the hold (the ladder
//              up to the hatch, and the cargo) and the captain's cabin (the
//              cot, the chart table, the sea chest). Sized by the hull: her
//              crewRequired and cargoCapacity. A small ship has a hold and a
//              cuddy with the stove among the hammocks; an open boat, nothing.
//   Stowage  — the hold's cargo as pieces: each good crates, barrels or sacks
//              (cargoKinds), as many as its share of her capacity, so a full
//              hold is packed to the beams and a light one shows bare boards.
//   Who      — the named hands (systems/deckLife.js roster, then the hands
//              beyond it who never come on deck) and where each is at an hour:
//              the off-watch asleep in their hammocks at night, the mess at
//              its meals, the cook at the stove, the navigator at the charts,
//              the sick in their hammocks and the surgeon among them; all
//              hands on deck in a storm, a fight or when the sea sends
//              something. Everyone else is on deck.
//   Charts   — the voyage as a chart: the route, how far along, what is left.
//
// Pure: no state of its own. world/innerMap/belowDecks.js lays the plan as
// tiles, ui/innerMapBelowDecks.js runs the scene. Explicit params; no RNG
// (the same ship gives the same rooms and the same hands every time).

import { DataLoader } from '../core/dataLoader.js';
import { Ships } from './ships.js';
import { DeckLife } from './deckLife.js';
import { ShipOfficers } from './shipOfficers.js';
import { Water } from './water.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DEFAULTS = {
    openBoatCrew: 1,
    smallCrew: 6,
    holdOnlyCrew: 2,
    maxExtras: 14,
    meals: [[6, 7, 'breakfast'], [12, 13, 'dinner'], [18, 19, 'supper']],
    cookHours: [5, 20],
    chartHours: [[8, 11], [14, 17]],
    sickShare: 0.2,
    maxSick: 6,
    cargoKinds: { barrel: ['wine', 'ale', 'beer', 'oil', 'fish', 'preserved_fish', 'water'], sack: ['grain', 'flour', 'food', 'salt', 'wool', 'spices'] },
    pile: { crate: 'crate_stack', barrel: 'barrel_rack', sack: 'sack_pile' },
    rooms: {
        berths: { name: 'Crew Berths', icon: '🛏️' },
        galley: { name: 'The Galley', icon: '🍲' },
        hold: { name: 'The Hold', icon: '📦' },
        cabin: { name: "The Captain's Cabin", icon: '🧭' },
    },
    acts: {},
    chatter: {},
};

function _hash(...parts) {
    let h = 2166136261;
    const s = parts.join('|');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

const _title = (id) => String(id || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export const BelowDecks = {
    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.belowDecks) || {};
        return {
            ...DEFAULTS, ...d,
            cargoKinds: { ...DEFAULTS.cargoKinds, ...(d.cargoKinds || {}) },
            pile: { ...DEFAULTS.pile, ...(d.pile || {}) },
            rooms: { ...DEFAULTS.rooms, ...(d.rooms || {}) },
            acts: { ...DEFAULTS.acts, ...(d.acts || {}) },
            chatter: { ...DEFAULTS.chatter, ...(d.chatter || {}) },
        };
    },

    /** The ship's size class below: null (an open boat), 'hold', 'small' or 'full'. */
    tier(ship) {
        if (!ship) return null;
        const C = this.config();
        const crew = Ships.getShipEffectiveStats(ship).crewRequired;
        if (crew <= _num(C.openBoatCrew, 1)) return null;
        if (crew <= _num(C.holdOnlyCrew, 2)) return 'hold';
        if (crew <= _num(C.smallCrew, 6)) return 'small';
        return 'full';
    },

    /** Why there is no going below on this ship, or null. */
    reason(ship) {
        if (!ship) return 'You are not aboard.';
        if (!this.tier(ship)) return `The ${ship.name} is an open boat: there is no below.`;
        return null;
    },

    /* ── The plan ────────────────────────────────────────────── */

    /**
     * The rooms under the deck: { w, h, tier, rooms: [{ id, name, q0, q1 }],
     * ladder, hammocks, holdSlots, cells, furniture: [{ q, r, type, name, icon,
     * passable, art, decor, lit, room }], wallDecor: [{ q, r, id, lit }],
     * stove, mess, chartTable, cot } — interior coordinates, walls round it
     * (row 0 and h-1, column 0 and w-1) and between the rooms. Null for an open boat.
     */
    plan(ship) {
        const tier = this.tier(ship);
        if (!tier) return null;
        const C = this.config();
        const stats = Ships.getShipEffectiveStats(ship);
        const crew = _num(stats.crewRequired, 4);
        const cargo = _num(stats.cargoCapacity, 10);
        const hIn = tier === 'hold' ? 4 : tier === 'small' ? 5 : crew >= 20 ? 7 : 6;
        const sleepRows = hIn >= 6 ? [0, 1, hIn - 2, hIn - 1] : [0, hIn - 1];
        const hammocks = tier === 'hold' ? 0 : _clamp(Math.max(Math.ceil(crew * 0.7), Math.min(crew, 12)), 2, 24);
        const widths = [];
        if (tier !== 'hold') widths.push(['berths', _clamp(Math.ceil(hammocks / sleepRows.length), 2, 10) + (tier === 'small' ? 1 : 0)]);
        if (tier === 'full') widths.push(['galley', 4]);
        widths.push(['hold', tier === 'hold' ? _clamp(Math.ceil(cargo / 3), 3, 6) : _clamp(Math.ceil(cargo / 4), 3, 14)]);
        if (tier !== 'hold') widths.push(['cabin', tier === 'small' ? 3 : crew >= 20 ? 6 : 5]);
        const w = 2 + widths.reduce((a, [, n]) => a + n, 0) + (widths.length - 1);
        const h = hIn + 2;
        const rooms = [];
        let q = 1;
        for (const [id, n] of widths) {
            rooms.push({ id, name: (C.rooms[id] || {}).name || _title(id), icon: (C.rooms[id] || {}).icon || '', q0: q, q1: q + n - 1 });
            q += n + 1;
        }
        const room = (id) => rooms.find(x => x.id === id) || null;
        const mid = 1 + Math.floor(hIn / 2);
        // The walls: round the hull, a bulkhead between each room with a doorway at the aisle
        const cells = [];
        for (let r = 0; r < h; r++) {
            const row = [];
            for (let c = 0; c < w; c++) row.push(r === 0 || r === h - 1 || c === 0 || c === w - 1 ? 'W' : '.');
            cells.push(row);
        }
        for (let i = 0; i < rooms.length - 1; i++) {
            const bq = rooms[i].q1 + 1;
            for (let r = 1; r < h - 1; r++) cells[r][bq] = r === mid ? 'D' : 'W';
        }
        // (the bow is narrower: its corners are timber)
        cells[1][1] = 'W';
        cells[h - 2][1] = 'W';
        const furniture = [];
        const wallDecor = [];
        const taken = new Set();
        // (the way through each doorway kept clear, either side)
        for (let i = 0; i < rooms.length - 1; i++) {
            taken.add(`${rooms[i].q1},${mid}`);
            taken.add(`${rooms[i + 1].q0},${mid}`);
        }
        const free = (c, r) => cells[r] && cells[r][c] === '.' && !taken.has(`${c},${r}`);
        const put = (c, r, f) => {
            if (!free(c, r)) return false;
            taken.add(`${c},${r}`);
            furniture.push({ q: c, r, passable: false, ...f });
            return true;
        };
        // The ladder up to the hatch: in the hold, against the deckhead, its landing kept clear
        const hold = room('hold');
        const lq = hold.q0 + Math.floor((hold.q1 - hold.q0) / 2);
        const ladder = { q: lq, r: 1 };
        put(lq, 1, { type: 'ladder', art: 'stairs', name: 'Ladder to the Deck', icon: '🔼', passable: true, room: 'hold' });
        // (and the way from its foot down to the aisle)
        for (let r = 2; r <= mid; r++) taken.add(`${lq},${r}`);
        wallDecor.push({ q: hold.q0, r: 0, id: 'torch', lit: true });

        // Berths: hammocks along the rows either side of the aisle, a lantern overhead
        const hammockAt = [];
        const berths = room('berths');
        if (berths) {
            let left = hammocks;
            for (let c = berths.q0; c <= berths.q1 && left > 0; c++) {
                for (const sr of sleepRows) {
                    if (left <= 0) break;
                    const r = 1 + sr;
                    if (put(c, r, { type: 'hammock', art: 'straw', name: 'Hammock', icon: '🛏️', passable: true, room: 'berths' })) {
                        hammockAt.push({ q: c, r });
                        left--;
                    }
                }
            }
            wallDecor.push({ q: berths.q0 + Math.floor((berths.q1 - berths.q0) / 2), r: 0, id: 'torch', lit: true });
        }
        // The galley (or, in a small ship, the stove at the berths' after end)
        let stove = null, mess = null;
        const galley = room('galley');
        if (galley) {
            stove = { q: galley.q0, r: 1 };
            put(stove.q, stove.r, { type: 'oven', name: 'Galley Stove', icon: '🔥', lit: true, room: 'galley' });
            put(galley.q0 + 1, 1, { type: 'cauldron', name: 'Copper Kettle', icon: '🍲', lit: true, room: 'galley' });
            wallDecor.push({ q: galley.q0 + 2, r: 0, id: 'hanging_pots' });
            mess = { q: galley.q0 + 1, r: mid - 1 };
            put(mess.q, mess.r, { type: 'table', name: 'Mess Table', icon: '🍽️', decor: ['bowls', 'mugs'], room: 'galley' });
            put(mess.q + 1, mess.r, { type: 'table', name: 'Mess Table', icon: '🍽️', decor: ['bread', 'bowls'], room: 'galley' });
            put(mess.q, mess.r - 1, { type: 'bench', name: 'Mess Bench', icon: '💺', passable: true, room: 'galley' });
            put(mess.q + 1, mess.r - 1, { type: 'bench', name: 'Mess Bench', icon: '💺', passable: true, room: 'galley' });
            put(mess.q, mess.r + 1, { type: 'bench', name: 'Mess Bench', icon: '💺', passable: true, room: 'galley' });
            put(mess.q + 1, mess.r + 1, { type: 'bench', name: 'Mess Bench', icon: '💺', passable: true, room: 'galley' });
        } else if (berths) {
            stove = { q: berths.q1, r: mid - 1 };
            put(stove.q, stove.r, { type: 'cauldron', name: 'Cook Pot', icon: '🍲', lit: true, room: 'berths' });
            mess = { q: berths.q1, r: mid + 1 };
            put(mess.q, mess.r, { type: 'table', name: 'Mess Board', icon: '🍽️', decor: ['bowls'], room: 'berths' });
        }
        // The water casks, as full as the casks are: along the galley's after bulkhead; in a
        // small ship one by the cook pot; in a boat with only a hold, one at its forward end
        const water = Math.max(0, _num(Water.shipWater(ship)));
        const cask = (room2) => ({ type: 'barrel', name: 'Water Cask', icon: '💧', room: room2, _water: true });
        if (galley) {
            const casksMax = hIn - 1;
            const casks = water > 0 ? Math.max(1, Math.min(casksMax, Math.ceil(casksMax * water / Water.shipCap()))) : 0;
            let placedCasks = 0;
            for (let r = h - 2; r >= 1 && placedCasks < casks; r--) if (put(galley.q1, r, cask('galley'))) placedCasks++;
        } else if (water > 0 && berths) {
            // (at the bow end, clear of the way to the hammocks)
            put(berths.q0, mid + 1, cask('berths'));
        } else if (water > 0) {
            put(hold.q0, mid, cask('hold'));
        }
        // The cabin: the cot, the chart table, the sea chest, the shelf of books
        let chartTable = null, cot = null;
        const cabin = room('cabin');
        if (cabin) {
            cot = { q: cabin.q1, r: 1 };
            put(cot.q, cot.r, { type: 'bed', name: "Captain's Cot", icon: '🛏️', room: 'cabin' });
            chartTable = { q: cabin.q0 + 1, r: mid };
            put(chartTable.q, chartTable.r, { type: 'desk', name: 'Chart Table', icon: '🗺️', decor: ['papers', 'candles'], decorLit: true, room: 'cabin' });
            if (cabin.q1 - cabin.q0 >= 3) put(chartTable.q + 1, chartTable.r, { type: 'desk', name: 'Chart Table', icon: '🗺️', decor: ['papers'], room: 'cabin' });
            put(chartTable.q, chartTable.r + 1, { type: 'chair', name: 'Chair', icon: '💺', passable: true, room: 'cabin' });
            put(cabin.q1, h - 2, { type: 'chest', name: 'Sea Chest', icon: '🧳', room: 'cabin' });
            if (cabin.q1 - cabin.q0 >= 2) put(cabin.q0, 1, { type: 'bookshelf', name: "The Ship's Books", icon: '📚', room: 'cabin' });
            wallDecor.push({ q: cabin.q0 + 1, r: 0, id: 'map' });
            if (cabin.q1 - cabin.q0 >= 4) wallDecor.push({ q: cabin.q1 - 1, r: 0, id: 'weapon_rack' });
            wallDecor.push({ q: cabin.q1, r: h - 1, id: 'torch', lit: true });
        }
        // The hold's stowage: every cell off the aisle and the ladder's landing, walls first
        const holdSlots = [];
        for (const r of [1, h - 2, 2, h - 3, 3, h - 4]) {
            if (r <= 0 || r >= h - 1 || r === mid) continue;
            for (let c = hold.q0; c <= hold.q1; c++) {
                if (free(c, r) && !holdSlots.some(s => s.q === c && s.r === r)) holdSlots.push({ q: c, r });
            }
        }
        return { w, h, tier, rooms, mid, ladder, hammocks: hammockAt, holdSlots, cells, furniture, wallDecor, stove, mess, chartTable, cot };
    },

    /** The room a cell lies in (by column), or null. */
    roomAt(plan, q) {
        return (plan && plan.rooms.find(x => q >= x.q0 && q <= x.q1)) || null;
    },

    /** Where the galley's work is done: the galley, else the room with the stove. */
    galleyRoom(plan) {
        if (!plan) return null;
        return plan.rooms.find(x => x.id === 'galley') || (plan.stove ? this.roomAt(plan, plan.stove.q) : null);
    },

    /* ── Stowage ─────────────────────────────────────────────── */

    /** What a good is carried in: 'crate', 'barrel' or 'sack'. */
    goodKind(good) {
        const K = this.config().cargoKinds || {};
        const id = String(good || '');
        for (const kind of ['barrel', 'sack']) if ((K[kind] || []).includes(id)) return kind;
        return 'crate';
    },

    /**
     * The hold's cargo as pieces in `slots` cells: [{ q, r, good, kind, type,
     * name, units }] — each good its share of the slots by its share of her
     * capacity (at least one piece for anything aboard), biggest first; every
     * other piece of a good a stack (pile art) so a full hold reads as packed.
     */
    stowage(ship, slots) {
        const list = (slots || []).slice();
        const cargo = Object.entries((ship && ship.cargo) || {}).filter(([, n]) => _num(n) > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
        if (!list.length || !cargo.length) return [];
        const C = this.config();
        const cap = Math.max(1, _num(Ships.getShipEffectiveStats(ship).cargoCapacity, 10));
        const per = cap / list.length;
        const out = [];
        for (const [good, qty] of cargo) {
            if (!list.length) break;
            const n = Math.min(list.length, Math.max(1, Math.round(qty / per)));
            const kind = this.goodKind(good);
            for (let i = 0; i < n; i++) {
                const at = list.shift();
                const pile = i % 2 === 1 && C.pile && C.pile[kind] ? C.pile[kind] : null;
                out.push({ q: at.q, r: at.r, good, kind, type: pile || kind, name: _title(good), units: Math.round(qty / n * 10) / 10 });
            }
        }
        return out;
    },

    /* ── The hands below ─────────────────────────────────────── */

    /**
     * Every named hand aboard: the deck's roster, then the hands beyond it
     * (below by day and night: `extra`), as far as maxExtras.
     */
    hands(ship) {
        const roster = DeckLife.roster(ship);
        const crew = Ships.getCrew(ship);
        const C = this.config();
        const D = DeckLife.config();
        const names = D.names && D.names.length ? D.names : ['Tam', 'Bram', 'Ned'];
        const nicks = D.nicknames && D.nicknames.length ? D.nicknames : ['Young', 'Old', 'Red'];
        const seed = _hash('below', (ship && (ship.id || ship.name)) || 'ship');
        const extra = Math.max(0, Math.min(_num(C.maxExtras, 14), crew - roster.length));
        const out = roster.map(m => ({ ...m }));
        for (let i = 0; i < extra; i++) {
            const slot = roster.length + i;
            const nm = names[(seed + slot * 7919) % names.length];
            const nick = nicks[(seed + slot * 31) % nicks.length];
            out.push({ slot, role: 'deckhand', title: 'hand', station: 'deck', type: 'villager', watch: false, officer: false, name: `${nick} ${nm}`, extra: true });
        }
        return out;
    },

    /** Is this hour a mealtime? → its name, or null. */
    mealAt(hour) {
        const h = _num(hour, 12);
        for (const m of this.config().meals || []) if (h >= m[0] && h < m[1]) return m[2] || 'meal';
        return null;
    },

    /** Berths of the sick in an outbreak (slots), steady for the ship. */
    sickSlots(ship, hands, outbreak) {
        if (!outbreak || !hands.length) return new Set();
        const C = this.config();
        const n = Math.min(_num(C.maxSick, 6), hands.length, Math.max(1, Math.ceil(Ships.getCrew(ship) * _num(C.sickShare, 0.2))));
        const pool = hands.filter(m => m.role !== 'helmsman' && m.role !== 'mate' && !ShipOfficers.postOfSlot(ship, m.slot));
        const seed = _hash('sick', ship.id || ship.name, outbreak);
        const sorted = pool.slice().sort((a, b) => (_hash(seed, a.slot) - _hash(seed, b.slot)));
        return new Set(sorted.slice(0, n).map(m => m.slot));
    },

    /**
     * Where a hand is: null (on deck), or { room, act, asleep } below.
     * ctx: { hour, sit (DeckLife.situation), sick: Set of slots, plan }.
     */
    whereIs(ship, member, ctx) {
        const C = this.config();
        const hour = _num(ctx && ctx.hour, 12);
        const sit = (ctx && ctx.sit) || { kind: 'fair' };
        const sick = (ctx && ctx.sick) || new Set();
        const galley = (this.galleyRoom(ctx && ctx.plan) || { id: 'galley' }).id;
        if (sick.has(member.slot)) return { room: 'berths', act: 'sick', asleep: true };
        const post = ShipOfficers.postOfSlot(ship, member.slot);
        // All hands: a storm, a fight, the sea's business
        if (['boarding', 'storm', 'event', 'pray'].includes(sit.kind)) {
            if (post === 'surgeon' && sick.size) return { room: 'berths', act: 'tend', asleep: false };
            return null;
        }
        const inHours = (spans) => (spans || []).some(s => hour >= s[0] && hour < s[1]);
        if (post === 'surgeon' && sick.size) return { room: 'berths', act: 'tend', asleep: false };
        if (post === 'navigator' && inHours(C.chartHours) && ctx && ctx.plan && ctx.plan.chartTable) return { room: 'cabin', act: 'charts', asleep: false };
        if (member.role === 'cook' && !sit.night && hour >= _num(C.cookHours[0], 5) && hour < _num(C.cookHours[1], 20)) return { room: galley, act: 'cook', asleep: false };
        if (sit.night) {
            const off = ((DeckLife.config().situations || {}).night || {}).offWatch || 'rest';
            if (member.extra || DeckLife.stationFor(member, sit) === off) return { room: 'berths', act: 'sleep', asleep: true };
            return null;
        }
        // The mess at its meals: half of it the first half-hour, half the second
        if (this.mealAt(hour) && !member.watch && !post) {
            const second = (hour % 1) >= 0.5;
            if ((member.slot % 2 === 1) === second) return { room: galley, act: 'eat', asleep: false };
        }
        if (member.extra) {
            const acts = [['hold', 'stow'], ['berths', 'mend'], ['berths', 'dice']];
            const [room, act] = acts[member.slot % acts.length];
            return { room, act, asleep: false };
        }
        return null;
    },

    /**
     * Everyone below at this hour: [{ member, room, act, asleep, label, icon }].
     * ctx as whereIs, plus `outbreak` (the disease aboard, or null).
     */
    below(ship, ctx = {}) {
        if (!ship || !this.tier(ship)) return [];
        const hands = this.hands(ship);
        const sick = ctx.sick || this.sickSlots(ship, hands, ctx.outbreak || null);
        const A = this.config().acts || {};
        const out = [];
        for (const m of hands) {
            const at = this.whereIs(ship, m, { ...ctx, sick });
            if (!at) continue;
            const a = A[at.act] || {};
            out.push({ member: m, ...at, label: a.label || at.act, icon: a.icon || '⚓', anim: a.anim || 'idle' });
        }
        return out;
    },

    /** Is this hand below now? (the deck hides them: ui/innerMapBelowDecks.js syncDeck) */
    isBelow(ship, member, ctx) {
        return !!this.whereIs(ship, member, ctx);
    },

    /** Something a hand below says at their work. */
    chatter(act, salt = 0) {
        const list = (this.config().chatter || {})[act] || [];
        return list.length ? list[Math.abs(Math.floor(salt)) % list.length] : null;
    },

    /* ── The charts ──────────────────────────────────────────── */

    /**
     * The voyage as a chart: { route: [[q, r]...], step, from, dest, leagues,
     * done, left, daysLeft, navigator: { name, skill } | null, advice } — or
     * { route: [] } hove to.
     */
    chart(player, ship) {
        const v = ship && ship.voyage;
        const nav = ShipOfficers.of(ship, 'navigator');
        const navigator = nav ? { name: nav.name, skill: Math.round(_num(nav.skill)) } : null;
        if (!v || !Array.isArray(v.route) || !v.route.length) {
            return { route: [], step: 0, from: null, dest: null, leagues: 0, done: 0, left: 0, daysLeft: 0, navigator, advice: navigator ? `${navigator.name}: "No course set, Captain. Name a port and I'll lay it off."` : 'No course is set. The charts lie rolled on the table.' };
        }
        const route = [[_num(v.fromQ), _num(v.fromR)], ...v.route];
        const leagues = v.route.length;
        const done = Math.min(leagues, _num(v.step));
        const left = leagues - done;
        const daysLeft = left > 0 ? Ships.voyageDays(player, ship, left) : 0;
        let advice;
        if (navigator) {
            const sure = navigator.skill >= 60 ? 'I would stake my pay on it' : navigator.skill >= 35 ? 'give or take' : 'if my reckoning is any good, which it may not be';
            const safe = ShipOfficers.bonus(ship, 'routeSafety');
            advice = `${navigator.name}: "${left <= 0 ? `${v.destName} is under our lee.` : `${left} league${left === 1 ? '' : 's'} to ${v.destName} — ${daysLeft} day${daysLeft === 1 ? '' : 's'}, ${sure}.`}${safe >= 0.15 ? ' I have kept us clear of the worst water.' : ''}"`;
        } else {
            advice = `With no navigator you work the reckoning yourself: about ${daysLeft} day${daysLeft === 1 ? '' : 's'} to ${v.destName}.`;
        }
        return { route, step: done, from: v.fromName || null, dest: v.destName || null, leagues, done, left, daysLeft, navigator, advice };
    },
};
