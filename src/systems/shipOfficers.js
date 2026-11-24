// ============================================
// SHIP'S OFFICERS — navigator, gunner, bosun, surgeon
// ============================================
// Four posts aboard each of the player's ships (data/shipOfficers.json), each
// filled by promoting one of her named hands (systems/deckLife.js roster):
//
//   Skill    — the hand's aptitude for the post (hashed from the ship and the
//              berth, higher for a hand whose work is close to it: the
//              helmsman makes a navigator, the cook a surgeon), growing with
//              days at sea and fights won.
//   Loyalty  — how they are treated: their pay (or arrears), short rations,
//              a tot of grog, floggings at the gangway (the bosun approves,
//              the surgeon does not), victories and defeats, praise and
//              reprimands, and the crew's own morale they live among. Low
//              loyalty halves what they give (sulking); lower still, in port,
//              they go ashore for good.
//   Pay      — a daily wage each (posts.<id>.pay), paid with the crew's; what
//              the purse cannot meet is owed as arrears, and sours them daily.
//              The coin goes ashore with them (the fleet's ports' purses).
//
// What they give is read through `bonus(ship, kind)` — a fraction, 0 without
// an officer for it. Kinds: speed, routeSafety (navigator); gunnery (gunner);
// morale, repair (bosun); sickness, wounds (surgeon). Wired here: the bosun's
// running repairs and steadying of spirits, the surgeon's care of an outbreak
// (Ailments crew state). Exposed for the sea-fight and wind systems: speed,
// routeSafety, gunnery, `tendWounded(ship, lost)` and `noteBattle(ship, won)`.
//
// The ship's logbook: each finished voyage's log (ship.lastVoyage) is bound
// into ship.logbook (the last logbook.voyages of them), read in the captain's
// cabin (ui/innerMapBelowDecks.js).
//
// State on the ship (ship.officers, ship.discipline, ship.logbook), so it
// saves with player.ships. Explicit params; randomness from Utils.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Ships } from './ships.js';
import { DeckLife } from './deckLife.js';
import { Ailments } from './ailments.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const POST_ORDER = ['navigator', 'gunner', 'bosun', 'surgeon'];

const DEFAULTS = {
    posts: {
        navigator: { title: 'navigator', icon: '🧭', pay: 4, minCrew: 4, aptitude: { helmsman: 20 }, bonuses: { speed: 0.15, routeSafety: 0.35 } },
        gunner: { title: 'master gunner', icon: '💥', pay: 3, minCrew: 6, aptitude: { carpenter: 15 }, bonuses: { gunnery: 0.3 } },
        bosun: { title: 'bosun', icon: '📯', pay: 3, minCrew: 4, aptitude: { bosun: 22 }, bonuses: { morale: 0.6, repair: 0.6 } },
        surgeon: { title: 'surgeon', icon: '⚕️', pay: 4, minCrew: 8, aptitude: { cook: 14 }, bonuses: { sickness: 0.45, wounds: 0.4 } },
    },
    aptitudeBase: [15, 55],
    loyaltyBase: [45, 70],
    skill: { max: 95, perDayAtSea: 0.12, perVictory: 1.5 },
    loyalty: {
        paid: 0.4, unpaid: -6, perArrearsDay: -1, hungry: -2, grog: 1, victory: 6, defeat: -4,
        moraleTarget: { base: 25, perMorale: 0.55 }, drift: 1, praise: 4, praiseEvery: 7,
        reprimand: -6, reprimandLifts: 3, promoted: 12,
        flogging: { bosun: 1, gunner: 0, navigator: -1, surgeon: -3 },
        floggingSpree: { count: 3, days: 7, loss: -3 },
        sulkAt: 30, desertAt: 18, desertChance: 0.35, fullHeartAt: 50,
    },
    discipline: { flogMorale: -3, promoteMorale: 2, dismissMorale: -2 },
    logbook: { voyages: 8 },
};

function _hash(...parts) {
    let h = 2166136261;
    const s = parts.join('|');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/** A steady value in [lo, hi] from a hash. */
function _span(range, h) {
    const lo = _num(range && range[0], 0), hi = _num(range && range[1], lo);
    return lo + (h % 1000) / 999 * (hi - lo);
}

const _day = (world) => (world ? _num(world.day) : 0);

export const ShipOfficers = {
    POSTS: POST_ORDER,

    /** data/shipOfficers.json over the defaults. */
    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.shipOfficers) || {};
        const posts = {};
        for (const id of POST_ORDER) posts[id] = { ...DEFAULTS.posts[id], ...((d.posts || {})[id] || {}) };
        return {
            ...DEFAULTS, ...d, posts,
            skill: { ...DEFAULTS.skill, ...(d.skill || {}) },
            loyalty: { ...DEFAULTS.loyalty, ...(d.loyalty || {}) },
            discipline: { ...DEFAULTS.discipline, ...(d.discipline || {}) },
            logbook: { ...DEFAULTS.logbook, ...(d.logbook || {}) },
        };
    },

    post(id) {
        return this.config().posts[id] || null;
    },

    /* ── Who holds what ──────────────────────────────────────── */

    /** ship.officers, created on demand. */
    _state(ship) {
        if (!ship.officers || typeof ship.officers !== 'object') ship.officers = {};
        return ship.officers;
    },

    /** The officer in a post, or null. */
    of(ship, post) {
        const o = ship && ship.officers && ship.officers[post];
        return o && typeof o === 'object' ? o : null;
    },

    /** Every officer aboard: [{ post, ...officer }], in post order. */
    list(ship) {
        if (!ship || !ship.officers) return [];
        return POST_ORDER.filter(p => this.of(ship, p)).map(p => ({ post: p, ...ship.officers[p] }));
    },

    /** The post the hand in roster berth `slot` holds, or null. */
    postOfSlot(ship, slot) {
        for (const p of POST_ORDER) {
            const o = this.of(ship, p);
            if (o && o.slot === slot) return p;
        }
        return null;
    },

    /** Does this ship carry the post at all (she is big enough)? */
    hasPost(ship, post) {
        const P = this.post(post);
        if (!P || !ship) return false;
        return Ships.getShipEffectiveStats(ship).crewRequired >= _num(P.minCrew, 1);
    },

    /** The posts this ship carries. */
    postsFor(ship) {
        return POST_ORDER.filter(p => this.hasPost(ship, p));
    },

    /** A hand's aptitude for a post (0..100): hashed, more for kindred work. */
    aptitude(ship, member, post) {
        const C = this.config();
        const P = C.posts[post] || {};
        const base = _span(C.aptitudeBase, _hash('apt', ship && (ship.id || ship.name), member.slot, post));
        const kin = _num((P.aptitude || {})[member.role]);
        return Math.round(_clamp(base + kin, 1, _num(C.skill.max, 95)));
    },

    /** A hand's loyalty to the captain before any promotion (hashed, lifted by the ship's morale). */
    handLoyalty(ship, member) {
        const C = this.config();
        const base = _span(C.loyaltyBase, _hash('loy', ship && (ship.id || ship.name), member.slot));
        return Math.round(_clamp(base + (Ships.getMorale(ship) - 70) * 0.2, 0, 100));
    },

    /**
     * Hands who could fill a post: [{ slot, name, role, title, skill, loyalty, score }],
     * best first — not those already holding a post (the mate keeps the deck).
     */
    candidates(ship, post) {
        if (!ship || !this.post(post)) return [];
        const held = new Set(this.list(ship).filter(o => o.post !== post).map(o => o.slot));
        return DeckLife.roster(ship)
            .filter(m => m.role !== 'mate' && !held.has(m.slot))
            .map(m => {
                const skill = this.aptitude(ship, m, post);
                const loyalty = this.handLoyalty(ship, m);
                return { slot: m.slot, name: m.name, role: m.role, title: m.title, skill, loyalty, score: Math.round(skill * 0.7 + loyalty * 0.3) };
            })
            .sort((a, b) => b.score - a.score || a.slot - b.slot);
    },

    /** Why `slot` can't be made `post` now, or null. */
    promoteReason(ship, post, slot) {
        if (!ship) return 'No ship.';
        if (!this.post(post)) return 'No such post.';
        if (!this.hasPost(ship, post)) return `She is too small to carry a ${this.post(post).title}.`;
        if (Ships.getCrew(ship) <= 0) return 'She has no crew.';
        const c = this.candidates(ship, post).find(x => x.slot === slot);
        if (!c) return 'That hand cannot take the post.';
        return null;
    },

    /**
     * Promote the hand in berth `slot` to `post` (the holder, if any, back
     * to the hands). → { success, message, officer }
     */
    promote(player, world, ship, post, slot) {
        const why = this.promoteReason(ship, post, slot);
        if (why) return { success: false, message: why };
        const C = this.config();
        const c = this.candidates(ship, post).find(x => x.slot === slot);
        const st = this._state(ship);
        const prev = st[post] || null;
        const officer = {
            slot, name: c.name, skill: c.skill,
            loyalty: Math.round(_clamp(c.loyalty + _num(C.loyalty.promoted), 0, 100)),
            since: _day(world), arrears: 0, owedDays: 0, victories: 0, defeats: 0,
            lastPraise: null, liftedUntil: null,
        };
        st[post] = officer;
        Ships._ensureCrew(ship);
        Ships._setMorale(ship, ship.morale + _num(C.discipline.promoteMorale));
        const title = C.posts[post].title;
        if (ship.voyage) Ships._voyageLog(ship, C.posts[post].icon || '⚓', `${c.name} made ${title}.`, world);
        const was = prev ? ` ${prev.name} goes back to the hands.` : '';
        return { success: true, officer, message: `${c.name} is ${title} of the ${ship.name} now. The hands cheer one of their own.${was}` };
    },

    /** Break an officer back to the hands (their arrears are still owed). */
    dismiss(player, world, ship, post) {
        const o = this.of(ship, post);
        if (!o) return { success: false, message: 'Nobody holds that post.' };
        const C = this.config();
        delete ship.officers[post];
        this._carryArrears(ship, o);
        Ships._ensureCrew(ship);
        Ships._setMorale(ship, ship.morale + _num(C.discipline.dismissMorale));
        if (ship.voyage) Ships._voyageLog(ship, '⚓', `${o.name} broken back to the hands.`, world);
        return { success: true, message: `${o.name} is no longer ${C.posts[post].title}. They take it badly, and so do their messmates.` };
    },

    /** Arrears owed to someone who has left their post stay owed (ship.officerArrears). */
    _carryArrears(ship, o) {
        if (!(_num(o.arrears) > 0)) return;
        ship.officerArrears = Utils.cents(_num(ship.officerArrears) + o.arrears);
    },

    /* ── What they give ──────────────────────────────────────── */

    /** How much an officer gives (0..1): their skill, halved when sulking. */
    _effectiveness(o, world = null) {
        if (!o) return 0;
        const L = this.config().loyalty;
        let f = _clamp(_num(o.skill) / 100, 0, 1);
        const lifted = o.liftedUntil != null && world && _day(world) <= o.liftedUntil;
        if (_num(o.loyalty) < _num(L.sulkAt, 30) && !lifted) f *= 0.5;
        else if (_num(o.loyalty) < _num(L.fullHeartAt, 50)) f *= 0.85;
        return f;
    },

    /**
     * What the ship's officers give to `kind` (a fraction; 0 with nobody in
     * the post): speed, routeSafety, gunnery, morale, repair, sickness, wounds.
     * `world` (optional) lets a reprimand's lift count.
     */
    bonus(ship, kind, world = null) {
        if (!ship || !ship.officers) return 0;
        const C = this.config();
        let total = 0;
        for (const p of POST_ORDER) {
            const o = this.of(ship, p);
            const max = o && _num((C.posts[p].bonuses || {})[kind]);
            if (!max) continue;
            // (a post the ship has outgrown or shrunk below gives nothing)
            if (!this.hasPost(ship, p)) continue;
            total += max * this._effectiveness(o, world);
        }
        return Math.round(total * 1000) / 1000;
    },

    /** Daily wages owed to the ship's officers. */
    dailyPay(ship) {
        const C = this.config();
        return this.list(ship).reduce((a, o) => a + _num(C.posts[o.post].pay), 0);
    },

    /** Arrears owed to the officers (and those who left owed). */
    arrears(ship) {
        return Utils.cents(this.list(ship).reduce((a, o) => a + _num(o.arrears), 0) + _num(ship && ship.officerArrears));
    },

    /**
     * After a fight that cost `lost` hands: how many the surgeon saves
     * (wounded, not dead — they come back to their berths). The caller adds
     * them back to ship.crew; returns the number saved.
     */
    tendWounded(ship, lost) {
        const n = Math.max(0, Math.floor(_num(lost)));
        const b = this.bonus(ship, 'wounds');
        if (!n || !(b > 0)) return 0;
        let saved = 0;
        for (let i = 0; i < n; i++) if (Utils.random() < b) saved++;
        return saved;
    },

    /** A sea fight fought (won or lost): counted at the day's end in processDay. */
    noteBattle(ship, won) {
        if (!ship) return;
        if (!Array.isArray(ship._officerBattles)) ship._officerBattles = [];
        ship._officerBattles.push(!!won);
    },

    /* ── The captain's hand ──────────────────────────────────── */

    _discipline(ship) {
        if (!ship.discipline || typeof ship.discipline !== 'object') ship.discipline = { floggings: [] };
        if (!Array.isArray(ship.discipline.floggings)) ship.discipline.floggings = [];
        return ship.discipline;
    },

    /** Floggings in the last `days` days. */
    floggingsSince(ship, world, days) {
        const d = _day(world);
        return ((ship && ship.discipline && ship.discipline.floggings) || []).filter(x => d - x < days).length;
    },

    flogReason(ship, world) {
        if (!ship) return 'No ship.';
        if (Ships.getCrew(ship) <= 0) return 'There is nobody to flog.';
        const D = ship.discipline;
        if (D && D.floggings && D.floggings.includes(_day(world))) return 'A man has been flogged today already.';
        return null;
    },

    /**
     * A hand flogged at the gangway for insolence: the crew's morale falls,
     * and each officer takes it their own way (posts → loyalty.flogging); too
     * many in a week and they all mislike it. → { success, message, morale }
     */
    flog(player, world, ship) {
        const why = this.flogReason(ship, world);
        if (why) return { success: false, message: why };
        const C = this.config();
        const D = this._discipline(ship);
        D.floggings.push(_day(world));
        D.floggings = D.floggings.filter(x => _day(world) - x < 30);
        Ships._ensureCrew(ship);
        const before = ship.morale;
        Ships._setMorale(ship, ship.morale + _num(C.discipline.flogMorale, -3));
        const spree = C.loyalty.floggingSpree || {};
        const many = this.floggingsSince(ship, world, _num(spree.days, 7)) >= _num(spree.count, 3);
        const lines = [];
        for (const o of this.list(ship)) {
            let d = _num((C.loyalty.flogging || {})[o.post]);
            if (many) d += _num(spree.loss, -3);
            ship.officers[o.post].loyalty = _clamp(Math.round(_num(o.loyalty) + d), 0, 100);
            if (d > 0) lines.push(`${o.name} nods grimly.`);
            else if (d < 0) lines.push(`${o.name} looks away.`);
        }
        if (ship.voyage) Ships._voyageLog(ship, '➰', 'A hand flogged at the gangway.', world);
        const head = many ? 'Another flogging. The lash is getting a name aboard.' : 'Two dozen at the gangway, the hands mustered to watch.';
        return { success: true, morale: ship.morale - before, message: `${head}${lines.length ? ` ${lines.join(' ')}` : ''}` };
    },

    /** Why an officer can't be praised now, or null. */
    praiseReason(ship, world, post) {
        const o = this.of(ship, post);
        if (!o) return 'Nobody holds that post.';
        const every = _num(this.config().loyalty.praiseEvery, 7);
        if (o.lastPraise != null && _day(world) - o.lastPraise < every) return 'Praised lately: more would ring hollow.';
        return null;
    },

    /** A word of praise before the hands. */
    praise(player, world, ship, post) {
        const why = this.praiseReason(ship, world, post);
        if (why) return { success: false, message: why };
        const o = ship.officers[post];
        o.loyalty = _clamp(Math.round(_num(o.loyalty) + _num(this.config().loyalty.praise, 4)), 0, 100);
        o.lastPraise = _day(world);
        return { success: true, message: `You praise ${o.name} before the hands. They stand a little taller.` };
    },

    /**
     * A reprimand: they mislike it (loyalty), but a sulking officer is shaken
     * into doing their work for a few days (liftedUntil).
     */
    reprimand(player, world, ship, post) {
        const o = this.of(ship, post);
        if (!o) return { success: false, message: 'Nobody holds that post.' };
        const L = this.config().loyalty;
        o.loyalty = _clamp(Math.round(_num(o.loyalty) + _num(L.reprimand, -6)), 0, 100);
        o.liftedUntil = _day(world) + _num(L.reprimandLifts, 3);
        return { success: true, message: `You dress ${o.name} down in your cabin. They go about their work stiffly — but they go about it.` };
    },

    /** Pay off what is owed the officers, as far as the purse goes. → { success, paid, message } */
    payArrears(player, world, ship) {
        const owed = this.arrears(ship);
        if (!(owed > 0)) return { success: false, message: 'Nothing is owed.' };
        const keep = Ships.layUpSettings().keepBack;
        const can = Utils.cents(Math.min(owed, Math.max(0, _num(player && player.gold) - keep)));
        if (!(can > 0)) return { success: false, message: 'You have not the coin to pay them.' };
        player.gold = Utils.cents(_num(player.gold) - can);
        Ships._payFleet(world, [ship], can);
        if (player.financeToday) player.financeToday.expenses.crewWages = Utils.cents(_num(player.financeToday.expenses.crewWages) + can);
        let left = can;
        const gone = Math.min(left, _num(ship.officerArrears));
        ship.officerArrears = Utils.cents(_num(ship.officerArrears) - gone);
        left = Utils.cents(left - gone);
        for (const o of this.list(ship)) {
            if (!(left > 0)) break;
            const rec = ship.officers[o.post];
            const pay = Math.min(left, _num(rec.arrears));
            rec.arrears = Utils.cents(_num(rec.arrears) - pay);
            left = Utils.cents(left - pay);
            if (rec.arrears <= 0) { rec.arrears = 0; rec.owedDays = 0; rec.loyalty = _clamp(_num(rec.loyalty) + 3, 0, 100); }
        }
        return { success: true, paid: can, message: `You pay ${Utils.formatGold(can)}g of what is owed the officers.${can < owed ? ` ${Utils.formatGold(Utils.cents(owed - can))}g is still owing.` : ''}` };
    },

    /* ── The logbook ─────────────────────────────────────────── */

    /** Bind a finished voyage's log into ship.logbook (once). → whether one was bound */
    archiveVoyage(ship) {
        const lv = ship && ship.lastVoyage;
        if (!lv || lv._booked || !Array.isArray(lv.log) || !lv.log.length) return false;
        if (!Array.isArray(ship.logbook)) ship.logbook = [];
        ship.logbook.push({ fromName: lv.fromName || null, destName: lv.destName || null, days: _num(lv.days), log: lv.log.map(e => ({ ...e })) });
        const keep = Math.max(1, _num(this.config().logbook.voyages, 8));
        if (ship.logbook.length > keep) ship.logbook.splice(0, ship.logbook.length - keep);
        lv._booked = true;
        return true;
    },

    /** The pages of the log, newest voyage first: [{ title, current, entries }]. */
    logPages(ship) {
        if (!ship) return [];
        this.archiveVoyage(ship);
        const pages = [];
        const v = ship.voyage;
        if (v && Array.isArray(v.log) && v.log.length) pages.push({ title: `${v.fromName || 'Port'} to ${v.destName || 'the open sea'} (under way, day ${_num(v.day)})`, current: true, entries: v.log.slice() });
        const book = Array.isArray(ship.logbook) ? ship.logbook : [];
        for (let i = book.length - 1; i >= 0; i--) {
            const b = book[i];
            pages.push({ title: `${b.fromName || 'Port'} to ${b.destName || 'the open sea'} (${b.days} day${b.days === 1 ? '' : 's'})`, current: false, entries: (b.log || []).slice() });
        }
        return pages;
    },

    /* ── The day ─────────────────────────────────────────────── */

    /**
     * The officers' day, after Ships.processDaily (`shipDay` its report):
     * pay and arrears, loyalty, skill, desertion, the bosun's and surgeon's
     * work, and the logbook. → { notices: [{ icon, title, text, type }] }
     */
    processDay(player, world, shipDay = null) {
        const out = { notices: [] };
        if (!player || !Array.isArray(player.ships)) return out;
        const C = this.config();
        const L = C.loyalty;
        const day = _day(world);
        const keep = Ships.layUpSettings().keepBack;
        // Battles today: the sea's interceptions, a boarding settled at the day's end, and what other systems noted
        const battles = {};
        const addBattle = (id, won) => { (battles[id] = battles[id] || []).push(!!won); };
        for (const ic of (shipDay && shipDay.interceptions) || []) addBattle(ic.shipId, ic.won);
        const vb = shipDay && shipDay.voyage && shipDay.voyage.autoBoarding;
        if (vb && vb.success && shipDay.voyage.shipId != null) addBattle(shipDay.voyage.shipId, vb.won);

        for (const ship of player.ships) {
            this.archiveVoyage(ship);
            const n0 = out.notices.length;
            for (const won of ship._officerBattles || []) addBattle(ship.id, won);
            delete ship._officerBattles;
            const list = this.list(ship);
            if (!list.length) continue;
            const atSea = ship.status !== 'docked' && ship.status !== 'building';
            const roster = DeckLife.roster(ship);
            const rosterSlots = new Set(roster.map(m => m.slot));
            // Lost with the crew: the berth is gone (the crew fell below it)
            for (const o of list) {
                if (rosterSlots.has(o.slot)) continue;
                this._carryArrears(ship, o);
                delete ship.officers[o.post];
                out.notices.push({ icon: '⚓', title: `The ${C.posts[o.post].title} is lost`, text: `${o.name}, ${C.posts[o.post].title} of the ${ship.name}, is gone with the hands she lost.`, type: 'warning' });
            }
            const live = this.list(ship);
            if (!live.length) continue;

            // Pay: today's wages, then what is owed
            const pay = live.reduce((a, o) => a + _num(C.posts[o.post].pay), 0);
            const purse = Math.max(0, _num(player.gold) - keep);
            const paid = pay <= purse;
            if (paid && pay > 0) {
                player.gold = Utils.cents(_num(player.gold) - pay);
                Ships._payFleet(world, [ship], pay);
                if (player.financeToday) player.financeToday.expenses.crewWages = Utils.cents(_num(player.financeToday.expenses.crewWages) + pay);
            }
            const hungry = _num(ship.hungryDays) > 0;
            const grog = !!(ship.deckDay && ship.deckDay.day === day && ship.deckDay.done && ship.deckDay.done.grog);
            const fought = battles[ship.id] || [];
            const target = _num(L.moraleTarget.base, 25) + Ships.getMorale(ship) * _num(L.moraleTarget.perMorale, 0.55);
            for (const o of live) {
                const rec = ship.officers[o.post];
                let d = 0;
                if (paid) {
                    d += _num(L.paid);
                } else {
                    rec.arrears = Utils.cents(_num(rec.arrears) + _num(C.posts[o.post].pay));
                    d += _num(L.unpaid);
                }
                if (_num(rec.arrears) > 0) {
                    rec.owedDays = _num(rec.owedDays) + 1;
                    d += _num(L.perArrearsDay) * Math.min(10, rec.owedDays) / 3;
                } else rec.owedDays = 0;
                if (hungry) d += _num(L.hungry);
                if (grog) d += _num(L.grog);
                for (const won of fought) {
                    d += won ? _num(L.victory) : _num(L.defeat);
                    if (won) { rec.victories = _num(rec.victories) + 1; rec.skill = Math.min(_num(C.skill.max, 95), _num(rec.skill) + _num(C.skill.perVictory)); } else rec.defeats = _num(rec.defeats) + 1;
                }
                // Living among the hands: their mood is catching
                const lv = _num(rec.loyalty) + d;
                const step = _num(L.drift, 1);
                rec.loyalty = Math.round(_clamp(lv + (target > lv ? Math.min(step, target - lv) : -Math.min(step, lv - target)), 0, 100) * 10) / 10;
                if (atSea) rec.skill = Math.round(Math.min(_num(C.skill.max, 95), _num(rec.skill) + _num(C.skill.perDayAtSea)) * 100) / 100;
                const sulking = rec.loyalty < _num(L.sulkAt, 30);
                if (sulking && !rec.sulking) out.notices.push({ icon: '😠', title: 'A Sullen Officer', text: `${rec.name}, ${C.posts[o.post].title} of the ${ship.name}, goes about the work with half a heart.${_num(rec.arrears) > 0 ? ` They are owed ${Utils.formatGold(rec.arrears)}g.` : ''}`, type: 'warning' });
                rec.sulking = sulking;
                // In port, an officer at the end of their rope goes ashore for good
                if (!atSea && rec.loyalty < _num(L.desertAt, 18) && Utils.random() < _num(L.desertChance, 0.35)) {
                    this._carryArrears(ship, rec);
                    delete ship.officers[o.post];
                    Ships._ensureCrew(ship);
                    if (ship.crew > 0) ship.crew -= 1;
                    out.notices.push({ icon: '🚪', title: 'An Officer Deserts', text: `${rec.name}, ${C.posts[o.post].title} of the ${ship.name}, has gone ashore and will not come back${_num(rec.arrears) > 0 ? `, owed ${Utils.formatGold(rec.arrears)}g and saying so in every tavern` : ''}.`, type: 'error' });
                }
            }
            if (!paid && pay > 0) out.notices.push({ icon: '💰', title: 'Officers Unpaid', text: `You could not pay the officers of the ${ship.name} today (${Utils.formatGold(pay)}g). What is owed sours them day by day.`, type: 'warning' });
            if (ship.voyage) for (const n of out.notices.slice(n0)) Ships._voyageLog(ship, n.icon, n.text, world);

            // The bosun's work at sea: running repairs, the hands kept at it
            if (atSea) {
                const rep = this.bonus(ship, 'repair', world);
                if (rep > 0 && _num(ship.condition, 100) < 90 && Utils.random() < rep) {
                    ship.condition = Math.min(90, _num(ship.condition, 100) + 1);
                }
                const mor = this.bonus(ship, 'morale', world);
                const rest = _num(Ships._getCrewSettings().restingMorale, 70);
                if (mor > 0 && Ships.getCrew(ship) > 0 && Ships.getMorale(ship) < rest && Utils.random() < mor) {
                    Ships._ensureCrew(ship);
                    Ships._setMorale(ship, ship.morale + 1);
                }
            }
            // The surgeon's care: an outbreak aboard runs its course faster
            const sick = this.bonus(ship, 'sickness', world);
            if (sick > 0) {
                const st = Ailments.getState(player);
                const ob = st && st.crews && st.crews[String(ship.id)];
                if (ob && Utils.random() < sick) {
                    ob.daysLeft = _num(ob.daysLeft) - 1;
                    if (ship.voyage) Ships._voyageLog(ship, '⚕️', 'The surgeon is among the sick day and night.', world);
                }
            }
        }
        return out;
    },
};
