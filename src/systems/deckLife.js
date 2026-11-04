// ============================================
// DECK LIFE — the crew aboard, what they do, and what the captain can do
// ============================================
// The rules behind time on deck (the inner map at sea: world/innerMap/
// deckLife.js lays the stations, ui/innerMapDeck.js runs the scene).
//
//   Roster   — the hands on deck (up to maxOnDeck of the ship's crew): a
//              helmsman, a mate, a lookout, a bosun... then topmen and
//              deckhands. Names are hashed from the ship and the berth, so
//              the same people are aboard every time you come on deck.
//   Situation — what the deck is doing now: fair sailing, the night watch,
//              a storm (Ships._stormAtSea at the ship), an event waiting on
//              the captain (the voyage's pending event), boarders on deck
//              (voyage.boarding), and land within a day's sail.
//   Stations — where each role goes in each situation (the storm sends the
//              topmen aloft and the rest to the pumps; at night the off-watch
//              sleep; becalmed, they fish and doze) and the work they do there.
//   Orders   — once a day each: address the crew (charisma), splice the
//              mainbrace (provisions from the hold), lend a hand (your energy,
//              two hours of the day). They move the ship's morale — the same
//              morale that fights, deserts and rows the sweeps.
//   Boarding — the size of a boarding party from the pirates' strength, and
//              the blows traded between the crew and boarders on deck.
//
// No time of its own: the deck's hours are the inner map's clock, and its
// days are the world's (the voyage moves in Ships.processDaily). State lives
// on the ship (ship.deckDay, voyage.landSighted), so it saves with it.
// Explicit params; randomness from Utils.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Ships } from './ships.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const DEFAULTS = {
    maxOnDeck: 12,
    roles: [
        { id: 'helmsman', title: 'helmsman', min: 1, station: 'helm', type: 'villager', watch: true },
        { id: 'mate', title: 'first mate', min: 2, station: 'quarterdeck', type: 'merchant', watch: true, officer: true },
        { id: 'lookout', title: 'lookout', min: 3, station: 'bow', type: 'villager', watch: true },
    ],
    fillRoles: [{ id: 'deckhand', title: 'deckhand', station: 'deck', type: 'villager' }],
    names: ['Tam', 'Bram', 'Ned', 'Silas', 'Jory', 'Hob', 'Wat', 'Kit'],
    nicknames: [],
    work: {},
    situations: {},
    events: {},
    chatter: {},
    orders: {},
    boarding: { perStrength: 5, min: 2, max: 7, hp: 70, crewHp: 40, crewHit: [4, 10], boarderHit: [3, 9], blowSecs: 1.1, names: ['Boarder'], lines: [] },
    landSighted: { morale: 2, callout: 'Land ho!' },
};

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

function _pick(list) {
    return Array.isArray(list) && list.length ? list[Utils.randInt(0, list.length - 1)] : null;
}

function _roll(v) {
    if (Array.isArray(v)) return Utils.randInt(Math.min(v[0], v[1]), Math.max(v[0], v[1]));
    return _num(v);
}

export const DeckLife = {
    /** data/deckLife.json over the defaults. */
    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.deckLife) || {};
        return {
            ...DEFAULTS, ...d,
            boarding: { ...DEFAULTS.boarding, ...(d.boarding || {}) },
            landSighted: { ...DEFAULTS.landSighted, ...(d.landSighted || {}) },
        };
    },

    /* ── The crew on deck ────────────────────────────────────── */

    /** How many of the ship's hands stand on deck (the rest are below). */
    onDeckCount(ship) {
        if (!ship) return 0;
        return Math.max(0, Math.min(Ships.getCrew(ship), _num(this.config().maxOnDeck, 12)));
    },

    /**
     * The hands on deck: [{ slot, role, title, station, type, watch, officer, name }].
     * The same ship gives the same people in the same berths (hashed, not rolled).
     */
    roster(ship) {
        const C = this.config();
        const n = this.onDeckCount(ship);
        if (!n) return [];
        const seed = _hash((ship && (ship.id || ship.name)) || 'ship');
        const roles = C.roles.filter(r => n >= _num(r.min, 1));
        const fill = C.fillRoles && C.fillRoles.length ? C.fillRoles : DEFAULTS.fillRoles;
        const names = C.names && C.names.length ? C.names : DEFAULTS.names;
        const used = new Set();
        const out = [];
        for (let slot = 0; slot < n; slot++) {
            const r = slot < roles.length ? roles[slot] : fill[(slot - roles.length) % fill.length];
            let k = (seed + slot * 7919) % names.length;
            for (let i = 0; i < names.length && used.has(k); i++) k = (k + 1) % names.length;
            used.add(k);
            let name = names[k];
            const nick = C.nicknames || [];
            if (nick.length && ((seed >>> (slot % 16)) & 7) === 0) name = `${nick[(seed + slot) % nick.length]} ${name}`;
            out.push({
                slot, role: r.id, title: r.title || r.id, station: r.station || 'deck', type: r.type || 'villager',
                watch: !!r.watch, officer: !!r.officer, name,
            });
        }
        return out;
    },

    /** The officer who answers for the ship (the mate, else the helmsman, else anyone). */
    officerOf(members) {
        const list = members || [];
        return list.find(m => m.role === 'mate') || list.find(m => m.officer) || list[0] || null;
    },

    /* ── What the deck is doing ──────────────────────────────── */

    /**
     * The situation aboard: { kind: 'boarding'|'storm'|'calm'|'pray'|'event'|'night'|'fair',
     * eventId, scene, storm, landNear, night }. `hour` is the deck's clock.
     */
    situation(player, world, ship, { hour = 12 } = {}) {
        const C = this.config();
        const night = hour >= 21 || hour < 5;
        const out = { kind: night ? 'night' : 'fair', eventId: null, scene: null, storm: null, landNear: false, night };
        if (!ship) return out;
        const v = ship.voyage || null;
        if (v && !v.expedition && Array.isArray(v.route)) {
            out.landNear = v.route.length - _num(v.step) <= Ships.getSailingSpeed(player, ship);
        }
        if (v && v.boarding) {
            return { ...out, kind: 'boarding', eventId: v.boarding.eventId || null, scene: 'pirates' };
        }
        out.storm = world ? Ships._stormAtSea(ship, world) : null;
        const pending = v && v.pending && player && player.boardedShip === ship.id ? v.pending.id : null;
        if (pending) {
            const ev = (C.events || {})[pending] || {};
            out.eventId = pending;
            out.scene = ev.scene || 'event';
            if (!out.storm) out.kind = ev.situation || 'event';
        }
        if (out.storm) out.kind = 'storm';
        return out;
    },

    /** Where a hand goes in this situation (a station key of the deck layout). */
    stationFor(member, sit) {
        if (!member) return 'deck';
        if (member.wounded) return 'wounded';
        const kind = (sit && sit.kind) || 'fair';
        if (kind === 'boarding') return member.role === 'helmsman' ? 'helm' : 'fight';
        const S = (this.config().situations || {})[kind] || {};
        const st = S.stations && S.stations[member.role];
        if (st) return st;
        // The night watch: the watch keeps its posts, two in three of the rest sleep
        if (kind === 'night' && !member.watch && member.slot % 3 !== 0) return S.offWatch || 'rest';
        return member.station || 'deck';
    },

    /** The work done at a station: { label, icon, anim, secs }. */
    workAt(station) {
        const w = (this.config().work || {})[station];
        return w ? { ...w } : { label: 'At work', icon: '⚓', anim: 'idle', secs: [5, 10] };
    },

    /** How fast the hands move in this situation (a storm: at a run). */
    pace(sit) {
        const S = (this.config().situations || {})[(sit && sit.kind) || 'fair'] || {};
        return _num(S.pace, 1);
    },

    /** Seconds a hand stays at a piece of work before moving on. */
    workSecs(station) {
        const s = this.workAt(station).secs;
        return Array.isArray(s) ? s[0] + Utils.random() * Math.max(0, s[1] - s[0]) : _num(s, 6);
    },

    /** Something a hand says, from what's going on and how the crew feels. */
    chatter(member, ship, sit) {
        const C = this.config().chatter || {};
        const kind = (sit && sit.kind) || 'fair';
        if (['boarding', 'storm', 'calm', 'pray'].includes(kind) && C[kind]) return _pick(C[kind]);
        if (kind === 'event' && C.event && Utils.random() < 0.7) return _pick(C.event);
        if (ship && _num(ship.hungryDays) > 0 && C.hungry && Utils.random() < 0.6) return _pick(C.hungry);
        if (sit && sit.landNear && C.land && Utils.random() < 0.5) return _pick(C.land);
        if (kind === 'night' && C.night && Utils.random() < 0.6) return _pick(C.night);
        const m = Ships.getMorale(ship);
        return _pick(m >= 70 ? C.high : m >= 40 ? C.mid : C.low) || _pick(C.mid) || '';
    },

    /**
     * What is cried out when a situation begins: { role, text } or null —
     * the lookout sights things, the mate calls all hands.
     */
    callout(sit) {
        const C = this.config();
        if (!sit) return null;
        if (sit.kind === 'boarding') return { role: 'mate', text: _pick(C.boarding.lines) || 'Repel boarders!' };
        if (sit.kind === 'storm') return { role: 'mate', text: 'All hands! All hands on deck! Reef topsails!' };
        if (sit.eventId) {
            const ev = (C.events || {})[sit.eventId];
            if (ev && ev.callout) return { role: 'lookout', text: ev.callout };
        }
        return null;
    },

    /** The mate's report on the ship: lines of plain talk. */
    mateReport(player, world, ship) {
        if (!ship) return [];
        const lines = [];
        const crew = Ships.getCrew(ship);
        const need = Ships.getShipEffectiveStats(ship).crewRequired;
        const m = Ships.getMorale(ship);
        const mood = m >= 80 ? 'in fine heart' : m >= 60 ? 'content enough' : m >= 40 ? 'sullen' : m >= 25 ? 'close to mutiny' : 'ready to jump ship';
        lines.push(`${crew} hand${crew === 1 ? '' : 's'} aboard of the ${need} she wants, Captain, and they're ${mood}.`);
        const food = Ships.getProvisionDays(ship);
        if (food === Infinity) lines.push('No mouths to feed but yours.');
        else if (food <= 0) lines.push('The hold\'s bare. The men are going hungry.');
        else lines.push(`Victuals for ${food} day${food === 1 ? '' : 's'} at this rate.`);
        const c = _num(ship.condition, 100);
        lines.push(c >= 85 ? 'She\'s tight and dry.' : c >= 60 ? `She's working a little — ${c}% sound.` : c >= 35 ? `She's leaking, ${c}% sound. We're pumping every watch.` : `She's in a bad way, Captain: ${c}% sound. We need a yard.`);
        const v = ship.voyage;
        if (v && Array.isArray(v.route)) {
            const left = Ships.voyageDays(player, ship, Math.max(1, v.route.length - _num(v.step)));
            lines.push(`Day ${_num(v.day)} out. ${left <= 1 ? `${v.destName} by tomorrow, if the wind holds.` : `About ${left} days to ${v.destName}.`}`);
            if (v.pending) {
                const ev = Ships.getVoyageEvent(v.pending.id);
                if (ev) lines.push(`The hands are waiting on your word about ${/^(a|an|the) /i.test(ev.title) ? ev.title.toLowerCase() : `the ${ev.title.toLowerCase()}`}.`);
            }
            if (_num(v.delay) > 0) lines.push('We\'re lying to. We make no way today.');
        } else {
            lines.push('No course set — we\'re lying to. Take the helm and name a port.');
        }
        if (_num(ship.hungryDays) >= 2) lines.push('Short commons too long, Captain. There\'s talk of scurvy.');
        return lines;
    },

    /* ── Orders ──────────────────────────────────────────────── */

    _deckDay(ship, world) {
        const day = world ? _num(world.day) : 0;
        if (!ship.deckDay || ship.deckDay.day !== day) ship.deckDay = { day, done: {} };
        if (!ship.deckDay.done) ship.deckDay.done = {};
        return ship.deckDay;
    },

    /** Why an order can't be given now, or null. */
    orderReason(player, world, ship, id) {
        const o = (this.config().orders || {})[id];
        if (!o) return 'No such order.';
        if (!ship) return 'You are not aboard.';
        if (Ships.getCrew(ship) <= 0) return 'There is no crew to give orders to.';
        const dd = ship.deckDay && ship.deckDay.day === (world ? _num(world.day) : 0) ? ship.deckDay.done || {} : {};
        if (dd[id]) return 'Done today already.';
        if (id === 'grog') {
            const need = this.grogCost(ship);
            if (Ships.getProvisions(ship) < need) return `Needs ${need} provisions in the hold`;
        }
        if (id === 'lend' && player && player.needsEnabled && player.needs && _num(player.needs.energy, 100) < _num(o.energy, 12)) return 'You are too tired.';
        return null;
    },

    /** Provisions a double ration all round costs. */
    grogCost(ship) {
        const o = (this.config().orders || {}).grog || {};
        return Math.max(1, Math.ceil(Ships.getCrew(ship) / Math.max(1, _num(o.perHands, 8))));
    },

    /** The orders on deck: [{ id, label, icon, desc, available, why }]. */
    ordersFor(player, world, ship) {
        const O = this.config().orders || {};
        return Object.keys(O).map(id => {
            const why = this.orderReason(player, world, ship, id);
            const desc = id === 'grog' && ship ? `${O[id].desc || ''} (${this.grogCost(ship)} provisions)` : O[id].desc || '';
            return { id, label: O[id].label || id, icon: O[id].icon || '⚓', desc, available: !why, why };
        });
    },

    /**
     * Give an order on deck. → { success, message, morale (the change), hours (of the day it took) }.
     */
    giveOrder(player, world, ship, id) {
        const why = this.orderReason(player, world, ship, id);
        if (why) return { success: false, message: why };
        const o = this.config().orders[id];
        Ships._ensureCrew(ship);
        const before = ship.morale;
        let message = '';
        let hours = 0;
        if (id === 'rally') {
            let p = _num(o.p, 0.5) + (_num(player && player[o.stat || 'charisma'], 5) - 5) * _num(o.per, 0.07);
            p = Math.max(0.05, Math.min(0.95, p));
            if (Utils.random() < p) {
                const gain = Math.max(0, Math.min(_num(o.morale, 6), _num(o.cap, 90) - ship.morale));
                Ships._setMorale(ship, ship.morale + gain);
                message = gain > 0 ? 'They cheer you to the echo. Hats in the air.' : 'They cheer — but they were already as keen as a crew gets.';
            } else {
                Ships._setMorale(ship, ship.morale + _num(o.fail, -2));
                message = 'You speak; they shuffle. Somebody coughs. It does not land.';
            }
            hours = 1;
        } else if (id === 'grog') {
            Ships._eatFromHold(ship, this.grogCost(ship));
            Ships._setMorale(ship, ship.morale + _num(o.morale, 5));
            message = 'A double ration and a tot all round. Somebody starts a song.';
        } else if (id === 'lend') {
            if (player && typeof player.modifyNeed === 'function') player.modifyNeed('energy', -_num(o.energy, 12));
            Ships._setMorale(ship, ship.morale + _num(o.morale, 2));
            hours = _num(o.hours, 2);
            message = 'You haul with the hands until your palms burn. They take note of a captain who will.';
        }
        this._deckDay(ship, world).done[id] = true;
        return { success: true, message, morale: ship.morale - before, hours };
    },

    /** The first sight of land on a voyage: the crew's spirits lift once. → { morale } or null */
    noteLandSighted(ship) {
        const v = ship && ship.voyage;
        if (!v || v.landSighted) return null;
        v.landSighted = true;
        Ships._ensureCrew(ship);
        const m = _num(this.config().landSighted.morale, 2);
        Ships._setMorale(ship, ship.morale + m);
        return { morale: m };
    },

    /* ── Boarders ────────────────────────────────────────────── */

    /** The party that comes over the side: { count, hp, names } from the pirates' strength. */
    boardingParty(boarding) {
        const B = this.config().boarding;
        const enemy = _num(boarding && boarding.enemy, 15);
        const count = Math.max(_num(B.min, 2), Math.min(_num(B.max, 7), Math.round(enemy / Math.max(1, _num(B.perStrength, 5)))));
        const names = [];
        for (let i = 0; i < count; i++) names.push(B.names[i % B.names.length] || 'Boarder');
        return { count, hp: _num(B.hp, 70), names };
    },

    /** A hand's blow against a boarder: steadier with a full, willing crew. */
    crewBlow(ship) {
        const B = this.config().boarding;
        return Math.max(1, Math.round(_roll(B.crewHit) * Ships.getCrewCombatFactor(ship)));
    },

    /** A boarder's blow against a hand. */
    boarderBlow() {
        return Math.max(1, _roll(this.config().boarding.boarderHit));
    },

    /** Hit points a hand has in a fight on deck. */
    crewHp() {
        return _num(this.config().boarding.crewHp, 40);
    },
};
