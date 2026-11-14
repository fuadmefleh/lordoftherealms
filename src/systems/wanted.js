// ============================================
// WANTED — consequences that follow you, for decades
// ============================================
// The dark deeds (systems/underworld.js heat, streetCrime, townCrimes,
// peopleCrimes, profaneCrimes, kinCrimes, vanishings…) each raise heat in a
// realm, and heat cools in weeks. This layer is the crown's LONG memory:
//
//   The charge sheet   per realm (player.wanted.realms[kid]): a bounty in two
//                      parts — LESSER (theft, smuggling, assault…) and GRAVE
//                      (murder, kidnapping, a poisoned well, arson) — and the
//                      charges by name. Fed by heat the player gains
//                      (Underworld.addHeat → underworld.heatGained), the named
//                      crimes behind it (Underworld.recordCrime →
//                      underworld.charges), and the rumour bounties a crown
//                      posts when word of a witnessed crime reaches it
//                      (player.gossip.bounties). Read daily, then cleared.
//   Posters            once the bounty passes postAt (or any grave charge),
//                      posters go up across the realm: the notice board shows
//                      one, the watch of every town of the realm may know your
//                      face on arrival (onEnterSettlement) and, past
//                      arrestFrom, take you to the cells. The price GROWS while
//                      you are at large, up to a cap.
//   Bounty hunters     a party that takes the crown's notice (weekly roll by the
//                      bounty) rides out of the nearest town of the realm and
//                      tracks you across the map (a hostile world unit,
//                      'bounty_hunters'). Caught on the road: the road
//                      encounter (player/roadEncounters.js) offers pay them
//                      off, surrender (to jail; the charges answered), flee,
//                      hide, parley or fight. Beaten, the realm adds the
//                      slaying to your sheet. They stop at a realm at war with
//                      theirs, and give up after a while.
//   Avengers           the children of those you (or your House) killed — read
//                      from the townsfolk's own memory (systems/npcMemory.js:
//                      a 'blood' episode about a parent or sibling) — are
//                      noted as blood debts; when the child comes of age, years
//                      later, the grudge goes to Nemesis.wrong and a sworn
//                      avenger hunts you or your heir (systems/nemesis.js).
//   The ways out       a pardon bought from the realm's chancery or granted by
//                      a crown that favours you; weregild paid to a victim's
//                      family (the debt cancelled, the grave charge eased);
//                      penance at a church; fleeing abroad (lesser charges fade
//                      twice as fast while you are out of the realm, and hunters
//                      stop at a border at war); time (lesser charges fade after
//                      afterDays without a new crime; grave ones never do).
//   Generations        the crowns' charges die with the one they were against;
//                      the blood debts do not.
//
// Rules: explicit params, no globals; the day's rolls run on their own seeded
// stream (world seed + day, Utils.withRng). Tuning and text: data/wanted.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Interrupts } from '../core/interrupts.js';
import { WorldUnit } from '../world/units.js';
import { Economy } from '../world/economy.js';
import { Underworld } from './underworld.js';
import { Gossip } from './gossip.js';
import { Nemesis } from './nemesis.js';
import { NpcMemory } from './npcMemory.js';
import { Ledger } from './ledger.js';
import { Laws } from './laws.js';
// (posters are read where people read: systems/literacy.js; run time only)
import { Literacy } from './literacy.js';

export const HUNTER_TYPE = 'bounty_hunters';

const DEFAULTS = {
    daysPerYear: 120, goldPerHeat: 3, graveMult: 2, gossipShare: 0.6, postAt: 60,
    graveCrimes: ['murder', 'kidnapping', 'well_poisoning', 'arson'],
    graveRumourWords: ['murder', 'kill', 'assassin', 'massacre', 'slaughter', 'poison', 'burn'],
    growth: { lesserPerYear: 0.1, gravePerYear: 0.2, lesserCap: 1500, graveCap: 6000 },
    fade: { afterDays: 240, perYear: 0.5, abroadMult: 2, clearBelow: 10 },
    watch: { base: 0.12, perGold: 0.0006, perGuard: 0.05, stealthPer: 0.025, max: 0.8, arrestFrom: 150, arrestChance: 0.35, cooldownDays: 3, jailPerGold: 0.04, jailMax: 60 },
    hunters: {
        from: 150, chanceBase: 0.06, chancePerGold: 0.0001, chanceMax: 0.35, cooldownDays: 90, range: 30,
        days: 45, speed: 2, strengthBase: 6, strengthPerGold: 0.02, strengthMax: 80, payoffShare: 0.5, payoffMin: 30,
        beatenGold: 40, beatenShare: 0.15, takenJailMult: 1.25, giveUpRange: 45,
    },
    pardon: { buyMult: 1.25, graveMult: 1.5, min: 80, grantRep: 60, refuseRep: -50, repGain: 5, heatLeft: 10 },
    penance: { almsShare: 0.12, almsMin: 20, cooldownDays: 120, lesserKeep: 0.4, graveKeep: 0.85, karma: 3, heatRelief: 15 },
    weregild: { base: 120, perWeight: 4, memorySoften: 0.3 },
    debts: { scanDays: 30, comeOfAge: 16, maxDebts: 12, score: 75, minWeight: -20, maxAgeAtDeed: 15 },
};
const GROUPS = ['growth', 'fade', 'watch', 'hunters', 'pardon', 'penance', 'weregild', 'debts'];
const KIN_WORDS = ['father', 'mother', 'brother', 'sister', 'grandfather', 'grandmother', 'uncle', 'aunt'];
const LOG_CAP = 30;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _r = (v) => Math.round(v * 100) / 100;

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return ((world.kingdoms) || []).find(k => k && String(k.id) === String(id)) || null;
}

function _realmName(world, id) {
    const k = _kingdom(world, id);
    return (k && k.name) || String(id);
}

function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, (world && world.width) || 0);
}

function _views(world) {
    return world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
}

export const Wanted = {
    // ──────────── DATA ────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.wanted)) || {};
    },

    config() {
        const src = _obj(Wanted.data().config) || {};
        const out = { ...DEFAULTS, ...src };
        for (const k of GROUPS) out[k] = { ...DEFAULTS[k], ...(_obj(src[k]) || {}) };
        return out;
    },

    text(key, vars = {}, fallback = '') {
        const t = (_obj(Wanted.data().text) || {})[key];
        return _fill(t || fallback, vars);
    },

    /** A crime's name on a charge sheet ('murder', 'robbing caravans'). */
    label(crime) {
        const L = _obj(Wanted.data().labels) || {};
        return L[crime] || String(crime || 'crimes').replace(/_/g, ' ');
    },

    isGraveCrime(crime) {
        return (Wanted.config().graveCrimes || []).includes(crime);
    },

    // ──────────── STATE ────────────

    _blank() {
        return { realms: {}, hunt: null, debts: [], seenGossip: {}, log: [], nextId: 1, lastGen: null, lastScanDay: -1e9, lastPenanceDay: -1e9, lastDay: null, watchSeen: {} };
    },

    state(player) {
        if (!player) return null;
        let st = player.wanted;
        if (!_obj(st)) {
            player.wanted = Wanted._blank();
            return player.wanted;
        }
        const b = Wanted._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        if (!_obj(st.realms)) st.realms = {};
        if (!Array.isArray(st.debts)) st.debts = [];
        if (!_obj(st.seenGossip)) st.seenGossip = {};
        if (!Array.isArray(st.log)) st.log = [];
        if (!_obj(st.watchSeen)) st.watchSeen = {};
        return st;
    },

    serialize(player) {
        return player && player.wanted ? JSON.parse(JSON.stringify(player.wanted)) : null;
    },

    loadState(player) {
        if (player) Wanted.state(player);
    },

    _log(player, world, text) {
        const st = Wanted.state(player);
        st.log.unshift({ day: _day(world), text });
        if (st.log.length > LOG_CAP) st.log.length = LOG_CAP;
    },

    /** The charge sheet of one realm (created when `make`). */
    realm(player, kingdomId, make = false, world = null) {
        const st = Wanted.state(player);
        const key = String(kingdomId);
        if (!st.realms[key] && make) {
            st.realms[key] = { kingdomId, lesser: 0, grave: 0, graveN: 0, charges: {}, first: _day(world), last: _day(world), posted: false, postedDay: null, lastHuntDay: -1e9, huntersBeaten: 0, peak: 0 };
        }
        return st.realms[key] || null;
    },

    /** The price on your head in a realm (gold). */
    bounty(player, kingdomId) {
        const rec = player && player.wanted && player.wanted.realms ? player.wanted.realms[String(kingdomId)] : null;
        return rec ? Math.round(_num(rec.lesser) + _num(rec.grave)) : 0;
    },

    /** Only the lesser part (what a fine at the guardhouse can settle). */
    lesserBounty(player, kingdomId) {
        const rec = player && player.wanted && player.wanted.realms ? player.wanted.realms[String(kingdomId)] : null;
        return rec ? Math.round(_num(rec.lesser)) : 0;
    },

    isPosted(player, kingdomId) {
        const rec = player && player.wanted && player.wanted.realms ? player.wanted.realms[String(kingdomId)] : null;
        return !!(rec && rec.posted);
    },

    /** Does the player rule this realm (above its law)? */
    _aboveLaw(player, kingdomId) {
        const ruling = player && player.throne && player.throne.ruling;
        return !!(ruling && kingdomId != null && String(ruling.kingdomId) === String(kingdomId));
    },

    /** Charges in words: "murder ×2, theft". */
    chargeList(rec, max = 4) {
        if (!rec) return '';
        const list = Object.entries(rec.charges || {}).sort((a, b) => (b[1].grave ? 1 : 0) - (a[1].grave ? 1 : 0) || b[1].n - a[1].n);
        const parts = list.slice(0, max).map(([label, c]) => `${label}${c.n > 1 ? ` ×${c.n}` : ''}`);
        if (list.length > max) parts.push('and more');
        return parts.join(', ') || 'crimes against the crown';
    },

    /**
     * Put a charge on a realm's sheet: { kingdomId, crime (an id) or label, gold, grave }.
     * Returns the realm record (or null when the player is above the law there).
     */
    charge(player, world, spec = {}) {
        if (!player || spec.kingdomId == null) return null;
        if (Wanted._aboveLaw(player, spec.kingdomId)) return null;
        const gold = Math.max(0, _num(spec.gold));
        const rec = Wanted.realm(player, spec.kingdomId, true, world);
        const grave = !!spec.grave;
        if (grave) { rec.grave += gold; rec.graveN = _num(rec.graveN) + 1; } else rec.lesser += gold;
        const label = spec.label || Wanted.label(spec.crime);
        const c = rec.charges[label] || (rec.charges[label] = { n: 0, last: 0, grave });
        c.n++;
        c.last = _day(world);
        if (grave) c.grave = true;
        rec.last = _day(world);
        rec.lesser = _r(rec.lesser);
        rec.grave = _r(rec.grave);
        return rec;
    },

    // ──────────── THE DAY ────────────

    _rng(world) {
        const p = world && world.generationParams;
        return Utils.seededRandom((_hash(`${(p && p.seed) || 0}:wanted:${_day(world)}`) % 233279) + 1);
    },

    /** One day: charges read in, posters, growth and fading, the hunt, the blood debts. → { notices } */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !world || player.interregnum) return out;
        const st = Wanted.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        Utils.withRng(Wanted._rng(world), () => {
            Wanted._watchSuccession(player, world, out);
            Wanted._absorb(player, world, out);
            Wanted._ageRealms(player, world, out);
            Wanted._huntDay(player, world, out);
            if (day % 7 === 0) Wanted._maybeHunt(player, world, out);
            if (day - _num(st.lastScanDay, -1e9) >= Wanted.config().debts.scanDays) {
                st.lastScanDay = day;
                Wanted._scanDebts(player, world, out);
            }
            Wanted._comeOfAge(player, world, out);
        });
        return out;
    },

    /** A new head on the seat: the crowns' charges against the dead lapse; the blood debts stay. */
    _watchSuccession(player, world, out) {
        const st = Wanted.state(player);
        const gen = player.house ? _num(player.house.generation, 1) : null;
        if (gen == null) return;
        if (st.lastGen != null && gen > st.lastGen) {
            const had = Object.keys(st.realms).length;
            st.realms = {};
            Wanted._endHunt(player, world, 'gaveup', null);
            if (had) {
                const text = Wanted.text('succession', { old: st.lastRuler || 'your predecessor' }, 'The charges held against your predecessor died with them.');
                Wanted._log(player, world, text);
                out.notices.push({ icon: '📜', title: 'Old Charges Lapse', text, type: 'info' });
            }
        }
        st.lastGen = gen;
        st.lastRuler = player.name || player.firstName || null;
    },

    /** Read in the heat gained, the named crimes and the rumour bounties since yesterday. */
    _absorb(player, world, out) {
        const C = Wanted.config();
        const st = Wanted.state(player);
        const uw = player.underworld;
        if (uw) {
            const charges = Array.isArray(uw.charges) ? uw.charges : [];
            const attributed = {};
            for (const ch of charges) {
                if (!ch || ch.kingdom == null) continue;
                const k = String(ch.kingdom);
                attributed[k] = _num(attributed[k]) + _num(ch.heat);
                const grave = Wanted.isGraveCrime(ch.crime);
                Wanted.charge(player, world, { kingdomId: ch.kingdom, crime: ch.crime, grave, gold: _num(ch.heat) * C.goldPerHeat * (grave ? C.graveMult : 1) });
            }
            uw.charges = [];
            const gained = _obj(uw.heatGained) || {};
            for (const [k, amt] of Object.entries(gained)) {
                const rest = _num(amt) - _num(attributed[k]);
                if (rest > 0.5) Wanted.charge(player, world, { kingdomId: k, crime: 'troubles', gold: rest * C.goldPerHeat });
            }
            uw.heatGained = {};
        }
        // Rumour bounties: a crown posts a price when word of a witnessed crime reaches it
        const bounties = player.gossip && Array.isArray(player.gossip.bounties) ? player.gossip.bounties : [];
        const words = C.graveRumourWords || [];
        for (const b of bounties) {
            if (!b || b.kingdom == null || b.description === 'underworld') continue;
            const key = `${b.rumorId}|${b.kingdom}|${b.issuedDay}`;
            if (st.seenGossip[key] != null) continue;
            st.seenGossip[key] = _day(world);
            const type = String(b.description || 'crime');
            const grave = words.some(w => type.toLowerCase().includes(w));
            Wanted.charge(player, world, { kingdomId: b.kingdom, label: type.replace(/_/g, ' '), grave, gold: _num(b.gold) * C.gossipShare });
        }
        // Forget the seen-keys of bounties long gone
        const keep = new Set(bounties.map(b => `${b.rumorId}|${b.kingdom}|${b.issuedDay}`));
        for (const k of Object.keys(st.seenGossip)) if (!keep.has(k) && _day(world) - st.seenGossip[k] > 400) delete st.seenGossip[k];
        // Posters go up
        for (const rec of Object.values(st.realms)) {
            const total = _num(rec.lesser) + _num(rec.grave);
            if (!rec.posted && (total >= C.postAt || _num(rec.grave) > 0)) {
                rec.posted = true;
                rec.postedDay = _day(world);
                rec.peak = Math.round(total);
                const text = Wanted.text('posted', { realm: _realmName(world, rec.kingdomId), bounty: Math.round(total), charges: Wanted.chargeList(rec) });
                Wanted._log(player, world, text);
                out.notices.push({ icon: '📜', title: 'Wanted', text, type: 'warning' });
            }
        }
    },

    /** Growth while at large; lesser charges fading in time (faster abroad); empty sheets dropped. */
    _ageRealms(player, world, out) {
        const C = Wanted.config();
        const Y = C.daysPerYear;
        const st = Wanted.state(player);
        const day = _day(world);
        const here = world.getTile ? world.getTile(player.q, player.r) : null;
        const inRealm = (kid) => !!here && ((here.settlement && String(here.settlement.kingdom) === String(kid)) || String(here.kingdom) === String(kid));
        for (const [key, rec] of Object.entries(st.realms)) {
            if (Wanted._aboveLaw(player, rec.kingdomId)) { delete st.realms[key]; continue; }
            if (rec.posted) {
                rec.grave = Math.min(C.growth.graveCap, _num(rec.grave) * (1 + C.growth.gravePerYear / Y));
                if (day - _num(rec.last) <= C.fade.afterDays) rec.lesser = Math.min(C.growth.lesserCap, _num(rec.lesser) * (1 + C.growth.lesserPerYear / Y));
            }
            if (day - _num(rec.last) > C.fade.afterDays && rec.lesser > 0) {
                const rate = (C.fade.perYear / Y) * (inRealm(rec.kingdomId) ? 1 : C.fade.abroadMult);
                rec.lesser = _num(rec.lesser) * (1 - rate);
                if (rec.lesser < C.fade.clearBelow) {
                    rec.lesser = 0;
                    for (const [label, c] of Object.entries(rec.charges)) if (!c.grave) delete rec.charges[label];
                }
            }
            rec.lesser = _r(rec.lesser);
            rec.grave = _r(rec.grave);
            const total = rec.lesser + rec.grave;
            // A milestone in the price (each doubling) is news
            if (rec.posted && _num(rec.peak) > 0 && total >= Math.max(200, rec.peak * 2)) {
                rec.peak = Math.round(total);
                out.notices.push({ icon: '📜', title: 'A Higher Price', text: Wanted.text('grown', { realm: _realmName(world, rec.kingdomId), bounty: Math.round(total) }), type: 'warning' });
            }
            if (total <= 0) {
                if (rec.posted) {
                    const text = Wanted.text('faded', { realm: _realmName(world, rec.kingdomId) });
                    Wanted._log(player, world, text);
                    out.notices.push({ icon: '🍂', title: 'Forgotten', text, type: 'info' });
                }
                delete st.realms[key];
            }
        }
    },

    /** Lift a realm's charges: all, or only the lesser ones. */
    clearRealm(player, kingdomId, opts = {}) {
        const st = Wanted.state(player);
        const key = String(kingdomId);
        const rec = st.realms[key];
        if (!rec) return 0;
        const before = Math.round(rec.lesser + rec.grave);
        if (opts.lesserOnly && rec.grave > 0) {
            rec.lesser = 0;
            for (const [label, c] of Object.entries(rec.charges)) if (!c.grave) delete rec.charges[label];
            return before - Math.round(rec.grave);
        }
        delete st.realms[key];
        if (st.hunt && String(st.hunt.kingdomId) === key) st.hunt.called = true;
        return before;
    },

    // ──────────── THE WATCH ────────────

    /** Odds the watch of this town know you from the posters. */
    recogniseChance(player, world, settlement) {
        const C = Wanted.config().watch;
        if (!settlement || settlement.kingdom == null) return 0;
        const rec = Wanted.realm(player, settlement.kingdom);
        if (!rec || !rec.posted) return 0;
        const total = rec.lesser + rec.grave;
        const guard = Underworld.guardStrength(settlement, _kingdom(world, settlement.kingdom));
        const stealth = _num(player.skills && player.skills.stealth);
        // (the notice board: a lettered town reads the posters, an unlettered one only hears of them)
        const board = Literacy.noticeFactor(world, settlement);
        return Math.max(0, Math.min(C.max, (C.base + total * C.perGold + guard * C.perGuard) * board - stealth * C.stealthPer));
    },

    /** Jail days for a realm's charges (the realm's own law on punishment). */
    jailDays(player, world, kingdomId, mult = 1) {
        const C = Wanted.config().watch;
        const total = Wanted.bounty(player, kingdomId);
        const law = Laws.punishment(world, kingdomId).jail;
        return Math.max(2, Math.min(C.jailMax, Math.round((2 + total * C.jailPerGold) * law * mult)));
    },

    /** Put the player in a realm's cells for its charges, and answer them. → days */
    _jail(player, world, settlement, kingdomId, offense, mult = 1) {
        const days = Wanted.jailDays(player, world, kingdomId, mult);
        const res = Underworld._arrest(player, world, settlement, offense);
        if (player.jailState) {
            const add = Math.max(0, days - _num(res.days));
            player.jailState.daysRemaining += add;
            player.jailState.totalDays += add;
        }
        Wanted.clearRealm(player, kingdomId);
        Gossip.settleWithKingdom(player, kingdomId);
        return Math.max(days, _num(res.days));
    },

    /**
     * Arriving in a town: the watch may know your face from the posters, and
     * past arrestFrom take you. → [{ icon, title, text, type }]
     */
    onEnterSettlement(player, world, tile) {
        const notes = [];
        const s = tile && tile.settlement;
        if (!player || !s || s.kingdom == null || player.jailState || player.interregnum) return notes;
        if (s.holding && !s.holding.lost) return notes; // your own watch
        const rec = Wanted.realm(player, s.kingdom);
        if (!rec || !rec.posted) return notes;
        const C = Wanted.config().watch;
        const st = Wanted.state(player);
        const key = `${tile.q},${tile.r}`;
        const day = _day(world);
        if (st.watchSeen[key] != null && day - st.watchSeen[key] < C.cooldownDays) return notes;
        st.watchSeen[key] = day;
        for (const [k, d] of Object.entries(st.watchSeen)) if (day - d > 60) delete st.watchSeen[k];
        if (!(Utils.random() < Wanted.recogniseChance(player, world, s))) return notes;
        const total = rec.lesser + rec.grave;
        const charges = Wanted.chargeList(rec);
        if (total >= C.arrestFrom && Utils.random() < C.arrestChance) {
            const days = Wanted._jail(player, world, s, s.kingdom, `wanted for ${charges}`);
            const text = Wanted.text('arrested', { town: s.name, charges, days });
            Wanted._log(player, world, text);
            notes.push({ icon: '⛓️', title: 'Known by the Watch', text, type: 'error' });
            return notes;
        }
        const text = `${Wanted.text('recognised', { town: s.name })} (${Math.round(total)} gold on your head)`;
        notes.push({ icon: '👁️', title: 'Recognised', text, type: 'warning' });
        return notes;
    },

    /** The poster on this town's notice board, if you are wanted here. → { realm, bounty, charges, grave } | null */
    posterAt(player, world, settlement) {
        if (!player || !settlement || settlement.kingdom == null) return null;
        const rec = Wanted.realm(player, settlement.kingdom);
        if (!rec || !rec.posted) return null;
        return { realm: _realmName(world, settlement.kingdom), bounty: Math.round(rec.lesser + rec.grave), charges: Wanted.chargeList(rec), grave: rec.grave > 0 };
    },

    // ──────────── BOUNTY HUNTERS ────────────

    /** The party on the player's trail, or null. */
    hunterUnit(player, world) {
        const h = player && player.wanted && player.wanted.hunt;
        if (!h || !world || !Array.isArray(world.units)) return null;
        return world.units.find(u => u && u.id === h.unitId && !u.destroyed) || null;
    },

    _maybeHunt(player, world, out) {
        const C = Wanted.config().hunters;
        const st = Wanted.state(player);
        if (st.hunt || player.jailState || player.prison || player.indenturedServitude || player.boardedShip) return null;
        const day = _day(world);
        const recs = Object.values(st.realms)
            .filter(r => r.posted && r.lesser + r.grave >= C.from && day - _num(r.lastHuntDay, -1e9) >= C.cooldownDays)
            .sort((a, b) => (b.lesser + b.grave) - (a.lesser + a.grave));
        for (const rec of recs) {
            const total = rec.lesser + rec.grave;
            const chance = Math.min(C.chanceMax, C.chanceBase + total * C.chancePerGold);
            if (!(Utils.random() < chance)) continue;
            return Wanted.startHunt(player, world, rec.kingdomId, out);
        }
        return null;
    },

    /** The nearest town of a realm to the player (within range), or null. */
    _nearestTown(player, world, kingdomId, range = Infinity) {
        let best = null;
        let bd = Infinity;
        for (const s of _views(world)) {
            if (!s || String(s.kingdom) !== String(kingdomId)) continue;
            const d = _dist(world, s, player);
            if (d < bd) { bd = d; best = s; }
        }
        return best && bd <= range ? best : null;
    },

    _captain() {
        const N = _obj(Wanted.data().captains) || {};
        const g = Utils.random() < 0.75 ? 'male' : 'female';
        const first = Utils.randPick((N[g] && N[g].length ? N[g] : ['Gerold']));
        const epi = Utils.randPick(N.epithets && N.epithets.length ? N.epithets : ['the Hound']);
        return `${first} ${epi}`;
    },

    /** A party takes the notice and rides out of the realm's nearest town. → the hunt, or null. */
    startHunt(player, world, kingdomId, out = null) {
        const C = Wanted.config().hunters;
        const st = Wanted.state(player);
        const rec = Wanted.realm(player, kingdomId);
        if (!rec || st.hunt) return null;
        const town = Wanted._nearestTown(player, world, kingdomId, C.range);
        if (!town) return null;
        const total = rec.lesser + rec.grave;
        const strength = Math.round(Math.min(C.strengthMax, C.strengthBase + total * C.strengthPerGold + _num(rec.huntersBeaten) * 4));
        const captain = Wanted._captain();
        const day = _day(world);
        const unit = Object.assign(Object.create(WorldUnit.prototype), {
            type: HUNTER_TYPE, id: `bh_${_hash(`${kingdomId}:${day}:${captain}`).toString(36)}`,
            q: town.q, r: town.r, sourceQ: town.q, sourceR: town.r, path: [], destroyed: false, age: 0, maxAge: 1e9, speed: 0,
            inventory: {}, icon: '🎯', name: `${captain}'s Bounty Hunters`, kingdomId, kingdom: kingdomId,
            strength, population: Math.max(3, Math.round(strength / 3)), hostile: true, bountyHunt: true, captain,
            targetQ: player.q, targetR: player.r,
        });
        if (!Array.isArray(world.units)) world.units = [];
        world.units.push(unit);
        rec.lastHuntDay = day;
        st.hunt = { unitId: unit.id, kingdomId, captain, since: day, until: day + C.days, strength, fromTown: town.name };
        const text = Wanted.text('huntStart', { captain, realm: _realmName(world, kingdomId), men: unit.population, strength });
        Wanted._log(player, world, text);
        if (out) out.notices.push({ icon: '🎯', title: 'Bounty Hunters', text, type: 'warning' });
        Interrupts.raise(world, { reason: `Bounty hunters are on your trail (${captain})`, icon: '🎯', source: 'wanted' });
        return st.hunt;
    },

    /** One step of the hunters toward the player over land (they wait at the edge of a town or the shore). */
    _step(world, unit, to) {
        const W = world.width || 0;
        const here = _dist(world, unit, to);
        if (here <= 1) return false;
        let best = null;
        let bd = here;
        for (const n of Hex.neighbors(unit.q, unit.r)) {
            const q = W ? Hex.wrapQ(n.q, W) : n.q;
            const t = world.getTile ? world.getTile(q, n.r) : null;
            if (!t || !t.terrain || !t.terrain.passable) continue;
            const d = Hex.wrappingDistance(q, n.r, to.q, to.r, W);
            if (d < bd) { bd = d; best = { q, r: n.r }; }
        }
        if (!best) return false;
        unit.q = best.q;
        unit.r = best.r;
        return true;
    },

    _huntDay(player, world, out) {
        const st = Wanted.state(player);
        const h = st.hunt;
        if (!h) return;
        const C = Wanted.config().hunters;
        const day = _day(world);
        const unit = Wanted.hunterUnit(player, world);
        if (!unit) return Wanted._endHunt(player, world, 'beaten', out);
        if (h.called || !Wanted.realm(player, h.kingdomId)) return Wanted._endHunt(player, world, 'called', out);
        if (day >= h.until || player.jailState || player.prison || player.indenturedServitude) return Wanted._endHunt(player, world, 'gaveup', out);
        // A realm at war with theirs is a refuge: they will not ride into it
        const tile = world.getTile ? world.getTile(player.q, player.r) : null;
        const landKid = tile ? (tile.settlement ? tile.settlement.kingdom : tile.kingdom) : null;
        const theirs = _kingdom(world, h.kingdomId);
        if (landKid != null && theirs && (theirs.wars || []).some(w => String(w) === String(landKid))) return Wanted._endHunt(player, world, 'refuge', out, landKid);
        if (_dist(world, unit, player) > C.giveUpRange) return Wanted._endHunt(player, world, 'gaveup', out);
        if (unit.sparedUntilDay != null && day < unit.sparedUntilDay) return; // licking their wounds, or thrown off the scent
        unit.hostile = true;
        unit.targetQ = player.q;
        unit.targetR = player.r;
        for (let i = 0; i < C.speed; i++) if (!Wanted._step(world, unit, player)) break;
    },

    /** The hunt is over: beaten / paid / taken / called (charges lifted) / refuge / gaveup. */
    _endHunt(player, world, how, out = null, refugeKid = null) {
        const st = Wanted.state(player);
        const h = st.hunt;
        if (!h) return null;
        st.hunt = null;
        const unit = world && Array.isArray(world.units) ? world.units.find(u => u && u.id === h.unitId) : null;
        if (unit) { unit.hostile = false; unit.destroyed = true; }
        const vars = { captain: h.captain, realm: _realmName(world, h.kingdomId) };
        let text = null;
        if (how === 'beaten') {
            const C = Wanted.config().hunters;
            const rec = Wanted.realm(player, h.kingdomId);
            if (rec) {
                rec.huntersBeaten = _num(rec.huntersBeaten) + 1;
                Wanted.charge(player, world, { kingdomId: h.kingdomId, crime: 'hunters_slain', gold: C.beatenGold + (rec.lesser + rec.grave) * C.beatenShare });
                vars.bounty = Wanted.bounty(player, h.kingdomId);
                text = Wanted.text('huntBeaten', vars);
            }
        } else if (how === 'refuge') {
            text = Wanted.text('huntRefuge', { ...vars, realm: _realmName(world, refugeKid) });
        } else if (how === 'gaveup') {
            text = Wanted.text('huntGaveUp', vars);
        }
        if (text) {
            Wanted._log(player, world, text);
            if (out) out.notices.push({ icon: '🎯', title: how === 'beaten' ? 'Hunters Broken' : 'The Hunt Is Off', text, type: how === 'beaten' ? 'warning' : 'info' });
        }
        return how;
    },

    /** What buying the hunters off costs. */
    payoffCost(player, unit) {
        const C = Wanted.config().hunters;
        const total = unit ? Wanted.bounty(player, unit.kingdomId) : 0;
        return Math.max(C.payoffMin, Math.round(total * C.payoffShare));
    },

    /**
     * The road encounter's choices against hunters (player/roadEncounters.js):
     * the toll becomes a bribe, and you may give yourself up. Mutates `opts`.
     */
    encounterOptions(player, unit, world, opts) {
        const i = opts.findIndex(o => o.id === 'toll');
        if (i >= 0) opts.splice(i, 1);
        const cost = Wanted.payoffCost(player, unit);
        const can = _num(player.gold) >= cost;
        const realm = _realmName(world, unit.kingdomId);
        opts.splice(1, 0, {
            id: 'payoff', icon: '💰', label: 'Buy them off', hint: `They report you lost. The price on your head in ${realm} stands.`,
            chance: null, odds: 'certain', can, reason: can ? '' : `They want ${cost} gold`, cost: `${cost} gold`, amount: cost,
        });
        const days = Wanted.jailDays(player, world, unit.kingdomId);
        opts.push({
            id: 'surrender', icon: '⛓️', label: 'Give yourself up', hint: `~${days} days in ${realm}'s cells; every charge there is answered.`,
            chance: null, odds: 'certain', can: true, reason: '', cost: `${days} days`,
        });
        return opts;
    },

    /** Pay off or surrender to the hunters. → a road-encounter result. */
    resolveEncounter(player, unit, world, choice) {
        const realm = _realmName(world, unit.kingdomId);
        const vars = { captain: unit.captain || 'The hunters', realm };
        if (choice === 'payoff') {
            const cost = Wanted.payoffCost(player, unit);
            if (_num(player.gold) < cost) return { kind: 'invalid', choice, success: false, notification: { title: 'Purse Too Light', body: `They want ${cost} gold.`, type: 'error' } };
            player.gold -= cost;
            Ledger.record(player, 'bribes', -cost);
            if (!unit.inventory) unit.inventory = {};
            unit.inventory.gold = _num(unit.inventory.gold) + cost;
            Wanted._endHunt(player, world, 'paid');
            const body = Wanted.text('paidOff', vars);
            Wanted._log(player, world, body);
            return { kind: 'paid', choice, success: true, goldPaid: cost, notification: { title: '💰 Bought Off', body, type: 'warning' } };
        }
        if (choice === 'surrender') {
            const out = Wanted._delivered(player, unit, world, 1);
            return { kind: 'surrendered', choice, success: true, notification: { title: '⛓️ You Give Yourself Up', body: Wanted.text('surrender', { ...vars, town: out.town, days: out.days }), type: 'warning' } };
        }
        return { kind: 'invalid', choice, success: false, notification: { title: 'No', body: 'That cannot be done.', type: 'error' } };
    },

    /** Beaten or run down by the hunters: dragged to the realm's cells. → a road-encounter result. */
    taken(player, unit, world, lead = '') {
        const out = Wanted._delivered(player, unit, world, Wanted.config().hunters.takenJailMult);
        const body = `${lead ? `${lead} ` : ''}${Wanted.text('taken', { captain: unit.captain || 'The hunters', realm: _realmName(world, unit.kingdomId), town: out.town, days: out.days })}`;
        Wanted._log(player, world, body);
        return { kind: 'taken', success: false, notification: { title: '⛓️ Taken for the Bounty', body: body.trim(), type: 'error' } };
    },

    /** The hunters hand the player to the realm's nearest town and collect from its crown. */
    _delivered(player, unit, world, mult) {
        const kid = unit.kingdomId;
        const town = Wanted._nearestTown(player, world, kid) || null;
        const bounty = Wanted.bounty(player, kid);
        // The crown pays its hunters out of a real treasury
        const k = _kingdom(world, kid);
        if (k && bounty > 0) {
            const paid = Math.min(Math.max(0, _num(k.treasury)), bounty);
            k.treasury = _num(k.treasury) - paid;
            if (!unit.inventory) unit.inventory = {};
            unit.inventory.gold = _num(unit.inventory.gold) + paid;
        }
        if (town) {
            if (typeof player.cancelTravel === 'function') player.cancelTravel();
            player.q = town.q;
            player.r = town.r;
        }
        const st = Wanted.state(player);
        if (st.hunt && st.hunt.unitId === unit.id) { st.hunt.called = true; }
        const days = Wanted._jail(player, world, town || { name: 'the cells', kingdom: kid }, kid, 'taken by bounty hunters', mult);
        Wanted._endHunt(player, world, 'taken');
        return { town: town ? town.name : 'the cells', days };
    },

    // ──────────── THE WAYS OUT ────────────

    /** The settlement the player stands in, or null. */
    _here(player, world) {
        const t = world && world.getTile ? world.getTile(player.q, player.r) : null;
        return t && t.settlement ? t.settlement : null;
    },

    /** A pardon from a realm: { ok, kind: 'grant'|'buy', cost, reason }. */
    pardonQuote(player, world, kingdomId) {
        const C = Wanted.config().pardon;
        const rec = Wanted.realm(player, kingdomId);
        if (!rec) return { ok: false, reason: 'You are not wanted there.' };
        const rep = _num(player.reputation && player.reputation[kingdomId]);
        if (Wanted._aboveLaw(player, kingdomId) || rep >= C.grantRep) return { ok: true, kind: 'grant', cost: 0, reason: '' };
        if (rep <= C.refuseRep) return { ok: false, kind: 'buy', reason: `The crown of ${_realmName(world, kingdomId)} hates you too well to sell you mercy (standing ${Math.round(rep)}).` };
        const here = Wanted._here(player, world);
        const cost = Math.max(C.min, Math.round(rec.lesser * C.buyMult + rec.grave * C.graveMult));
        if (!here || String(here.kingdom) !== String(kingdomId)) return { ok: false, kind: 'buy', cost, reason: `Petition the chancery in a town of ${_realmName(world, kingdomId)}.` };
        if (_num(player.gold) < cost) return { ok: false, kind: 'buy', cost, reason: `The chancery wants ${cost} gold.` };
        return { ok: true, kind: 'buy', cost, reason: '' };
    },

    pardon(player, world, kingdomId) {
        const q = Wanted.pardonQuote(player, world, kingdomId);
        if (!q.ok) return { success: false, reason: q.reason };
        const C = Wanted.config().pardon;
        const realm = _realmName(world, kingdomId);
        if (q.kind === 'buy') {
            player.gold -= q.cost;
            Ledger.record(player, 'fines', -q.cost);
            const k = _kingdom(world, kingdomId);
            if (k) k.treasury = _num(k.treasury) + q.cost;
        }
        Wanted.clearRealm(player, kingdomId);
        Gossip.settleWithKingdom(player, kingdomId);
        const uw = player.underworld && player.underworld.heat;
        if (uw && _num(uw[kingdomId]) > C.heatLeft) uw[kingdomId] = C.heatLeft;
        if (q.kind === 'buy' && player.reputation) player.reputation[kingdomId] = Math.min(100, _num(player.reputation[kingdomId]) + C.repGain);
        const text = Wanted.text(q.kind === 'buy' ? 'pardonBought' : 'pardonGranted', { realm, cost: q.cost });
        Wanted._log(player, world, text);
        return { success: true, text, cost: q.cost };
    },

    /** Penance at the church of the town you stand in: { ok, cost, reason, town, kingdomId }. */
    penanceQuote(player, world) {
        const C = Wanted.config().penance;
        const here = Wanted._here(player, world);
        if (!here || here.kingdom == null) return { ok: false, reason: 'Do penance at the church of a town.' };
        const rec = Wanted.realm(player, here.kingdom);
        if (!rec) return { ok: false, reason: `You are not wanted in ${_realmName(world, here.kingdom)}.` };
        const st = Wanted.state(player);
        const wait = C.cooldownDays - (_day(world) - _num(st.lastPenanceDay, -1e9));
        if (wait > 0) return { ok: false, reason: `The priest will hear you again in ${wait} days.` };
        const cost = Math.max(C.almsMin, Math.round((rec.lesser + rec.grave) * C.almsShare));
        if (_num(player.gold) < cost) return { ok: false, cost, reason: `The alms come to ${cost} gold.` };
        return { ok: true, cost, town: here, kingdomId: here.kingdom };
    },

    penance(player, world) {
        const q = Wanted.penanceQuote(player, world);
        if (!q.ok) return { success: false, reason: q.reason };
        const C = Wanted.config().penance;
        const st = Wanted.state(player);
        const rec = Wanted.realm(player, q.kingdomId);
        player.gold -= q.cost;
        Ledger.record(player, 'charity', -q.cost);
        Economy.payTown(q.town, q.cost);
        st.lastPenanceDay = _day(world);
        rec.lesser = _r(rec.lesser * C.lesserKeep);
        rec.grave = _r(rec.grave * C.graveKeep);
        player.karma = Math.min(100, _num(player.karma) + C.karma);
        if (player.underworld && player.underworld.heat && player.underworld.heat[q.kingdomId] != null) Underworld.addHeat(player, q.kingdomId, -C.heatRelief, world);
        const text = Wanted.text('penance', { town: q.town.name, cost: q.cost, realm: _realmName(world, q.kingdomId) });
        Wanted._log(player, world, text);
        return { success: true, text, cost: q.cost };
    },

    // ──────────── BLOOD DEBTS & AVENGERS ────────────

    /** The children (and young kin) of those your House killed, from the townsfolk's memory. */
    _scanDebts(player, world, out) {
        const C = Wanted.config();
        const D = C.debts;
        const st = Wanted.state(player);
        const day = _day(world);
        const Y = C.daysPerYear;
        const known = new Set(st.debts.map(d => d.folkRef));
        for (const s of _views(world)) {
            const folk = s && s.folk;
            if (!folk || !Array.isArray(folk.people)) continue;
            for (const p of folk.people) {
                if (!p || p.died != null || !Array.isArray(p.nm) || !p.nm.length) continue;
                const age = (day - _num(p.born, day)) / Y;
                if (age >= D.comeOfAge) continue;
                const ref = `${s.q},${s.r}#${p.id}`;
                if (known.has(ref)) continue;
                for (const e of p.nm) {
                    if (!e || !KIN_WORDS.includes(e.vr) || !(_num(e.w) <= D.minWeight)) continue;
                    const def = NpcMemory.kind(e.k);
                    if (!def || !def.blood) continue;
                    if (NpcMemory.actorOf(e, player).gen == null) continue;
                    if (st.debts.length >= D.maxDebts) return;
                    const debt = {
                        id: `bd${st.nextId++}`, folkRef: ref, name: `${p.first || 'a child'}${p.last ? ` ${p.last}` : ''}`, last: p.last || null,
                        gender: p.gender === 'female' ? 'female' : 'male', born: _num(p.born, day), victim: e.vn || 'their kin', vr: e.vr,
                        kind: e.k, label: def.label ? String(def.label).replace('{whom}', e.vn || 'their kin').replace('{actor}', 'your House') : 'the blood your House spilt',
                        town: s.name || null, kingdomId: s.kingdom != null ? s.kingdom : null, day, weight: Math.abs(_num(e.w)),
                        comeOfAgeDay: Math.round(_num(p.born, day) + D.comeOfAge * Y), paid: false, risen: false,
                    };
                    st.debts.push(debt);
                    known.add(ref);
                    const text = Wanted.text('debtNoted', { name: debt.name, age: Math.floor(age), rel: debt.gender === 'female' ? 'daughter' : 'son', victim: debt.victim });
                    Wanted._log(player, world, text);
                    break;
                }
            }
        }
    },

    /** Debts whose child is grown: the grudge goes to the nemesis layer; the dead and the paid are let go. */
    _comeOfAge(player, world, out) {
        const st = Wanted.state(player);
        const day = _day(world);
        const D = Wanted.config().debts;
        const keep = [];
        for (const d of st.debts) {
            if (d.paid || d.risen) { if (day - _num(d.closedDay, day) < 1200) keep.push(d); continue; }
            const got = NpcMemory.resolve(world, d.folkRef);
            if (!got || !got.p || got.p.died != null) continue; // the child did not live to grow
            if (day < d.comeOfAgeDay) { keep.push(d); continue; }
            const g = Nemesis.wrong(player, world, {
                kind: 'blood', name: d.name, line: d.last, ref: { folkRef: d.folkRef },
                score: D.score + Math.round(d.weight / 2), age: Math.floor((day - d.born) / Wanted.config().daysPerYear), gender: d.gender,
                deed: { key: d.kind || 'blood_debt', label: `the death of their ${d.vr} ${d.victim}`, note: d.town },
            });
            d.risen = true;
            d.closedDay = day;
            keep.push(d);
            if (g) {
                const text = Wanted.text('risen', { name: d.name, vr: d.vr, victim: d.victim });
                Wanted._log(player, world, text);
                out.notices.push({ icon: '🗡️', title: 'An Avenger Comes of Age', text, type: 'warning' });
            }
        }
        st.debts = keep;
    },

    /** Weregild owed to a debt's family. */
    weregildCost(debt) {
        const C = Wanted.config().weregild;
        return Math.round(C.base + _num(debt && debt.weight) * C.perWeight);
    },

    /** Pay the blood price to a victim's family: the debt is cancelled, the realm's grave charge eased. */
    weregild(player, world, debtId) {
        const st = Wanted.state(player);
        const d = st.debts.find(x => x.id === debtId);
        if (!d || d.paid || d.risen) return { success: false, reason: 'There is no such debt to pay.' };
        const cost = Wanted.weregildCost(d);
        if (_num(player.gold) < cost) return { success: false, reason: `The weregild is ${cost} gold.` };
        const got = NpcMemory.resolve(world, d.folkRef);
        player.gold -= cost;
        Ledger.record(player, 'weregild', -cost);
        if (got && got.p) {
            got.p.purse = _num(got.p.purse) + cost;
            // The blood memory sours less; the amends are remembered
            for (const e of got.p.nm || []) if (e && e.k === d.kind && e.vn === d.victim) e.w = Math.round(_num(e.w) * Wanted.config().weregild.memorySoften);
            NpcMemory.remember(world, { folk: got.folk, person: got.p }, { kind: 'amends', player });
        } else {
            const s = _views(world).find(v => v && v.name === d.town);
            if (s) Economy.payTown(s, cost);
        }
        d.paid = true;
        d.closedDay = _day(world);
        // The realm's grave charge for the killing is eased by one share
        const rec = d.kingdomId != null ? Wanted.realm(player, d.kingdomId) : null;
        if (rec && rec.graveN > 0) {
            rec.grave = _r(rec.grave - rec.grave / rec.graveN);
            rec.graveN -= 1;
        }
        const text = Wanted.text('weregild', { cost, victim: d.victim, name: d.name });
        Wanted._log(player, world, text);
        return { success: true, text, cost };
    },

    /** Debts not yet paid or risen: [{ debt, years (until of age), cost }]. */
    openDebts(player, world) {
        const st = Wanted.state(player);
        const Y = Wanted.config().daysPerYear;
        return st.debts.filter(d => !d.paid && !d.risen)
            .map(d => ({ debt: d, years: Math.max(0, Math.ceil((d.comeOfAgeDay - _day(world)) / Y)), cost: Wanted.weregildCost(d) }));
    },

    // ──────────── VIEW ────────────

    /** Everything the "Your Crimes & Enemies" panel shows. */
    view(player, world) {
        const st = Wanted.state(player);
        const day = _day(world);
        const C = Wanted.config();
        const realms = Object.values(st.realms).map(rec => {
            const total = Math.round(rec.lesser + rec.grave);
            return {
                kingdomId: rec.kingdomId, name: _realmName(world, rec.kingdomId), bounty: total, lesser: Math.round(rec.lesser), grave: Math.round(rec.grave),
                posted: rec.posted, charges: Wanted.chargeList(rec, 6), fading: rec.grave <= 0 && day - rec.last > C.fade.afterDays,
                fadesIn: rec.grave > 0 ? null : Math.max(0, C.fade.afterDays - (day - rec.last)), huntersBeaten: _num(rec.huntersBeaten),
                pardon: Wanted.pardonQuote(player, world, rec.kingdomId),
            };
        }).sort((a, b) => b.bounty - a.bounty);
        const h = st.hunt;
        const unit = Wanted.hunterUnit(player, world);
        const hunt = h && unit ? { ...h, realm: _realmName(world, h.kingdomId), strength: unit.strength, distance: _dist(world, unit, player), daysLeft: Math.max(0, h.until - day) } : null;
        const avengers = (player.nemesis && Array.isArray(player.nemesis.list) ? player.nemesis.list : [])
            .filter(n => n && n.kind === 'blood').map(n => ({ id: n.id, name: n.name, hatred: Math.round(_num(n.hatred)), label: n.origin ? n.origin.label : '' }));
        return { realms, hunt, debts: Wanted.openDebts(player, world), avengers, penance: Wanted.penanceQuote(player, world), log: st.log.slice(0, 8) };
    },
};
