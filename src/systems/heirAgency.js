// ============================================
// HEIR AGENCY — play the heir before they inherit
// ============================================
// The player's choices about their children during their life, and what
// those choices leave behind when one of them takes up the mantle.
//
// Directed family actions (on top of systems/heirs.js placements):
//   • fostering a CHILD (age 7–15) at a chosen lord's or rival House's court
//     for 1–3 years. The host's court becomes the child's tutor (its focus
//     follows the realm's temper; the ruler's character seeds the child's),
//     a bond with that lord grows month by month, and a rival House's feud
//     cools. If that court comes to think ill of the House, the child is held
//     as a hostage (up.heldBy — ransomed by letter, systems/mail.js). A grown
//     child is sent as a ward instead (Heirs.sendAsWard). The return itself
//     is Upbringing.processDay's (_returnWard).
//   • betrothing a child to an NPC dynasty: half the dowry now, the match
//     made when the child comes of age. A realm bound by marriage or
//     betrothal is slower to join a league against the House
//     (Heirs.kinshipFactor, read by systems/coalitions.js).
//   • commissions for a grown child with real stakes:
//       command  — they lead the House's company: field battles use their
//                  martial skill (commandMultiplier), and every battle may
//                  wound, capture (ransom) or kill them (onBattle);
//       envoy    — an embassy to a realm's court: standing, the lord's
//                  memory, a bond; a realm that turns to war keeps them;
//       steward  — governing a holding (Holdings.appointGovernor): days in
//                  office are counted and teach commerce.
//   Outcomes come home as letters (a 'family_report' court letter).
//
// The record (child.upbringing.agency.record) — fosterings, battles,
// embassies, stewardship, bonds — pays off at succession (onSuccession,
// called by Relationships.succeedAsHeir): lords' memories, standing,
// Prestige, renown, a trait, and a line in the Annals.
//
// Determinism: no Utils.random draws at all. A commander's fate in battle is
// a hash roll of (world seed, child, day, battle count). Content:
// data/upbringing.json → agency. No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { House } from './house.js';
import { Upbringing } from './upbringing.js';
import { Heirs } from './heirs.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';
import { CourtLetters } from './courtLetters.js';
import { Holdings } from './holdings.js';

const DEFAULTS = {
    fosterMinAge: 7, fosterYears: [1, 2, 3], fosterMinReputation: -10, fosterQuality: 1.4,
    fosterBondPerMonth: 1, fosterBondCap: 20, fosterRivalFeudCut: 10,
    hostageRegard: -30, hostageCheckDays: 15, hostFocus: {},
    betrothalMinAge: 4, betrothalDowryShare: 0.5, betrothalReputation: 8, betrothalBreakReputation: -15,
    kinshipMarried: 0.5, kinshipBetrothed: 0.75,
    commandMinAge: 16, commandCombat: 0.025, commandLeadership: 0.015, commandCap: 0.3, regencyBattleMult: 0.92,
    fate: { woundWin: 0.06, woundLoss: 0.2, captureLoss: 0.08, deathWin: 0.01, deathLoss: 0.04, woundDays: 30, captiveDays: 60, ransom: 150, unransomedPrestige: 6 },
    battleCombatXp: 0.5, battleLeadershipXp: 0.25, skillCap: 10,
    envoyDays: 30, envoyCost: 40, envoyReputation: 6, envoyDiplomacyRep: 1.5, envoyBond: 4,
    stewardXpDays: 90,
    payoff: {
        fosterReputation: 10, fosterBondWeight: 0.6, envoyReputation: 3,
        battlePrestige: 2, battlePrestigeCap: 15, battleRenown: 5, battleRenownCap: 50, braveAt: 3,
        capturedPrestige: -3, stewardDays: 180, stewardPrestige: 3, stewardCommerce: 1,
        marriagePrestige: 3, fosterPrestige: 4, envoyPrestige: 1,
    },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

export const HeirAgency = {
    config() {
        const d = _obj(DataLoader.upbringing && DataLoader.upbringing.agency) || {};
        return {
            ...DEFAULTS, ...d,
            fate: { ...DEFAULTS.fate, ...(_obj(d.fate) || {}) },
            payoff: { ...DEFAULTS.payoff, ...(_obj(d.payoff) || {}) },
            hostFocus: { ...(_obj(d.hostFocus) || {}) },
        };
    },

    _daysPerYear() {
        return Upbringing._daysPerYear();
    },

    // ──────────── STATE ────────────

    _blankRecord() {
        return { fostered: [], battles: { fought: 0, won: 0, lost: 0 }, captured: 0, wounds: 0, envoys: [], stewardDays: 0, bonds: {} };
    },

    /** A child's agency record (created / backfilled; never draws RNG). */
    ensure(child) {
        if (!child) return null;
        const up = Upbringing.ensure(child);
        let a = up.agency;
        if (!_obj(a)) a = up.agency = { record: null, commission: null, betrothal: null, wounded: null, captive: null, xp: {} };
        const blank = HeirAgency._blankRecord();
        if (!_obj(a.record)) a.record = blank;
        for (const k of Object.keys(blank)) if (a.record[k] === undefined) a.record[k] = blank[k];
        if (!_obj(a.record.battles)) a.record.battles = { fought: 0, won: 0, lost: 0 };
        if (!_obj(a.record.bonds)) a.record.bonds = {};
        if (!Array.isArray(a.record.fostered)) a.record.fostered = [];
        if (!Array.isArray(a.record.envoys)) a.record.envoys = [];
        for (const k of ['commission', 'betrothal', 'wounded', 'captive']) if (a[k] === undefined) a[k] = null;
        if (!_obj(a.xp)) a.xp = {};
        return a;
    },

    _child(player, childId) {
        return ((player && player.children) || []).find(c => c && c.id === childId) || null;
    },

    _kingdom(world, kid) {
        return world && typeof world.getKingdom === 'function' && kid ? world.getKingdom(kid) : null;
    },

    _lordName(k) {
        const ruler = k && k.characterData && k.characterData.ruler;
        if (ruler && ruler.firstName) return `${ruler.firstName} of ${k.name}`;
        if (k && k.lord && k.lord.name) return `${k.lord.name} of ${k.name}`;
        return (k && (k.ruler || k.name)) || 'a lord';
    },

    _rep(player, kid, n) {
        if (!kid || !n) return;
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = Utils.clamp(_num(player.reputation[kid]) + n, -100, 100);
    },

    _prestige(player, n, reason, world) {
        const house = player && player.house;
        if (!house || !n) return 0;
        if (n > 0) { House.award(house, n, reason, _day(world)); return n; }
        const amt = Math.min(-n, Math.max(0, _num(house.prestige)));
        if (amt > 0) House.spend(house, amt, reason, _day(world));
        return -amt;
    },

    /** A skill grows by `amount` (fractional, accumulated), capped. */
    _train(child, skill, amount) {
        const a = HeirAgency.ensure(child);
        const cap = HeirAgency.config().skillCap;
        if (!child.skills) child.skills = {};
        a.xp[skill] = _num(a.xp[skill]) + amount;
        while (a.xp[skill] >= 1) {
            a.xp[skill] -= 1;
            child.skills[skill] = Math.min(cap, _num(child.skills[skill]) + 1);
        }
        a.xp[skill] = Math.round(a.xp[skill] * 1000) / 1000;
    },

    /** A hash roll in [0,1): the same world, child and moment always roll the same. */
    _roll(world, key) {
        const h = (Utils.hashStr(`${_seed(world)}|heirAgency|${key}`) >>> 0) % 233279;
        return Utils.seededRandom(h + 1)();
    },

    /** News for the next daily report (transient, not saved). */
    _news(player, n) {
        if (!player) return;
        if (!Array.isArray(player._agencyNews)) player._agencyNews = [];
        player._agencyNews.push(n);
    },

    /** A child's account comes home as a court letter (data/courtLetters.json family_report). */
    letter(player, world, child, subject, body, kingdomId = null) {
        if (!player) return null;
        const day = _day(world);
        const K = CourtLetters.kind('family_report') || {};
        const from = { name: child ? child.firstName : 'Your House', type: 'family', kingdomId: kingdomId || null, childId: child ? child.id : null };
        return CourtLetters.deliver(player, {
            id: 0, kind: 'family_report', day, expires: day + _num(K.expiry, 20),
            from, key: `family:${child ? child.id : 'house'}:${day}`,
            vars: { from: from.name, subject, body }, data: { childId: child ? child.id : null },
            subject, body, read: false,
        });
    },

    // ──────────── WHERE THEY ARE ────────────

    /** Away from home: a ward abroad, on an embassy, a captive or held hostage. */
    isAway(child) {
        if (!child) return false;
        const a = child.upbringing && child.upbringing.agency;
        return Upbringing.isAway(child)
            || !!(a && a.commission && a.commission.kind === 'envoy')
            || !!(a && a.captive)
            || !!(child.upbringing && child.upbringing.heldBy);
    },

    /** One line on where a child is and what they do. */
    status(player, world, child) {
        if (!child) return '';
        const up = Upbringing.ensure(child);
        const a = HeirAgency.ensure(child);
        if (child.isAlive === false) return 'Dead';
        if (up.heldBy) {
            const k = HeirAgency._kingdom(world, up.heldBy.kingdomId);
            return `⛓️ Held hostage at ${k ? k.name : 'a foreign court'}`;
        }
        if (a.captive) return `⛓️ Captive of ${a.captive.by} (ransom ${a.captive.ransom}g)`;
        if (Upbringing.isAway(child)) return `🏰 Fostering at the court of ${up.placement.lordName} until day ${up.placement.until}`;
        if (a.commission && a.commission.kind === 'envoy') return `📜 Envoy to ${a.commission.kingdomName} until day ${a.commission.until}`;
        if (a.commission && a.commission.kind === 'command') return `⚔️ Commands the House's company${a.wounded ? ' (wounded)' : ''}`;
        if (HeirAgency.governing(player, world, child)) return '🏛️ Governs a holding';
        if (a.betrothal) return `💍 Betrothed to ${a.betrothal.name}`;
        return '';
    },

    /** The holding a child governs, or null. */
    governing(player, world, child) {
        if (!player || !world || !child) return null;
        for (const ref of Holdings.list(player, world)) {
            const g = ref.settlement && ref.settlement.holding && ref.settlement.holding.governor;
            if (g && g.id === child.id) return ref;
        }
        return null;
    },

    // ──────────── FOSTERING ────────────

    /** The focus a host court teaches (its realm's temper). */
    hostFocus(world, kid) {
        const k = HeirAgency._kingdom(world, kid);
        const map = HeirAgency.config().hostFocus;
        const id = map[KingdomAI.personalityId(k)] || 'diplomacy';
        return Upbringing.focus(id) ? id : null;
    },

    /**
     * Foster a child at a ruler's court for `years` years. A grown child goes
     * as a ward for a season instead (Heirs.sendAsWard). Returns
     * { success, child, placement } or { success: false, reason }.
     */
    fosterChild(player, world, childId, kid, years = 2) {
        const cfg = HeirAgency.config();
        const child = HeirAgency._child(player, childId);
        if (!child || child.isAlive === false) return { success: false, reason: 'No such child.' };
        const up = Upbringing.ensure(child);
        if (up.comeOfAge) return Heirs.sendAsWard(player, world, childId, kid);
        if (_num(child.age) < cfg.fosterMinAge) return { success: false, reason: `${child.firstName} is too young to leave home (fostering from age ${cfg.fosterMinAge}).` };
        if (HeirAgency.isAway(child)) return { success: false, reason: `${child.firstName} is not at home.` };
        if (up.fostered) return { success: false, reason: `${child.firstName} has already been fostered.` };
        const k = HeirAgency._kingdom(world, kid);
        if (!k || k.isAlive === false) return { success: false, reason: 'No such court.' };
        if (CourtLetters.atWar(player, world, kid)) return { success: false, reason: `You are at war with ${k.name}.` };
        const rep = _num(player.reputation && player.reputation[kid]);
        if (rep < cfg.fosterMinReputation) return { success: false, reason: `${k.name} will not take in the child of a House it distrusts (need ${cfg.fosterMinReputation} reputation).` };
        const yrs = (cfg.fosterYears || []).includes(years) ? years : (cfg.fosterYears || [2])[0];
        const day = _day(world);
        const lordName = HeirAgency._lordName(k);
        const trait = Heirs.lordTrait(world, kid);
        up.fostered = true;
        up.placement = {
            kind: 'ward', kingdomId: kid, kingdomName: k.name, lordName, day,
            until: day + yrs * HeirAgency._daysPerYear(), trait, returned: false, minor: true, years: yrs,
        };
        // The host's court is the child's tutor now; a tutor at home is let go
        const focus = HeirAgency.hostFocus(world, kid);
        up.tutor = {
            kind: 'host', id: 'host_court', name: `the court of ${lordName}`, icon: '🏰', focus,
            quality: cfg.fosterQuality, wage: 0, seeds: trait ? { [trait]: 0.6 } : {}, since: day,
        };
        const rival = player.house && player.house.rivals && player.house.rivals[kid];
        if (rival) {
            rival.feud = Utils.clamp(_num(rival.feud) - cfg.fosterRivalFeudCut, 0, 100);
            House._chronicle(player.house, world, `${child.firstName} is fostered at the court of ${rival.name}, a rival House — the feud cools, for now.`, ['heirs', 'rival']);
        }
        if (k.lord) NPCLords.rememberDeed(world, k.lord, 'ward', { note: child.firstName });
        if (player.house) House._chronicle(player.house, world, `${child.firstName}, aged ${child.age}, is sent to be raised at the court of ${lordName} for ${yrs} year${yrs === 1 ? '' : 's'}.`, ['heirs', 'upbringing']);
        return { success: true, child, placement: up.placement, focus };
    },

    // ──────────── BETROTHAL ────────────

    /**
     * Promise a child (not yet of age) to a realm's nobility: half the dowry
     * now, standing and the lord's memory; the match is made at coming of age.
     */
    betroth(player, world, childId, kid) {
        const cfg = HeirAgency.config();
        const hc = Heirs.config();
        const child = HeirAgency._child(player, childId);
        if (!child || child.isAlive === false) return { success: false, reason: 'No such child.' };
        const up = Upbringing.ensure(child);
        const a = HeirAgency.ensure(child);
        if (up.comeOfAge) return { success: false, reason: `${child.firstName} is of age — arrange a match instead.` };
        if (_num(child.age) < cfg.betrothalMinAge) return { success: false, reason: `${child.firstName} is too young even to be promised.` };
        if (up.spouse || a.betrothal) return { success: false, reason: `${child.firstName} is already promised.` };
        const k = HeirAgency._kingdom(world, kid);
        if (!k || k.isAlive === false) return { success: false, reason: 'No such realm.' };
        if (CourtLetters.atWar(player, world, kid)) return { success: false, reason: `You are at war with ${k.name}.` };
        const rep = _num(player.reputation && player.reputation[kid]);
        if (rep < _num(hc.allianceMinReputation)) return { success: false, reason: `${k.name}'s nobles will not promise a child to a House they distrust.` };
        const dowry = Math.round(_num(hc.allianceDowry) * cfg.betrothalDowryShare);
        if (_num(player.gold) < dowry) return { success: false, reason: `The betrothal gift is ${dowry} gold.` };
        player.gold -= dowry;
        Ledger.record(player, 'family', -dowry);
        HeirAgency._rep(player, kid, cfg.betrothalReputation);
        const gender = child.gender === 'female' ? 'male' : 'female';
        a.betrothal = { kingdomId: kid, kingdomName: k.name, name: `${Heirs._name(world, gender, k.culture)} of ${k.name}`, day: _day(world), dowry };
        if (k.lord) NPCLords.rememberDeed(world, k.lord, 'betrothal_made', { note: child.firstName });
        if (player.house) House._chronicle(player.house, world, `${child.firstName} is betrothed to ${a.betrothal.name}, binding ${player.house.name} to ${k.name}.`, ['marriage', 'heirs']);
        return { success: true, child, betrothal: a.betrothal, cost: dowry };
    },

    /** Break a child's betrothal: the realm takes it hard. */
    breakBetrothal(player, world, childId, why = null) {
        const cfg = HeirAgency.config();
        const child = HeirAgency._child(player, childId);
        const a = child && HeirAgency.ensure(child);
        if (!a || !a.betrothal) return { success: false, reason: 'No betrothal to break.' };
        const b = a.betrothal;
        a.betrothal = null;
        const k = HeirAgency._kingdom(world, b.kingdomId);
        HeirAgency._rep(player, b.kingdomId, cfg.betrothalBreakReputation);
        if (k && k.lord && k.isAlive !== false) NPCLords.rememberDeed(world, k.lord, 'betrothal_broken', { note: child.firstName });
        if (player.house) House._chronicle(player.house, world, `${child.firstName}'s betrothal to ${b.name} is broken${why ? ` (${why})` : ''}.`, ['marriage', 'heirs']);
        return { success: true, child, betrothal: b };
    },

    /** The betrothal becomes a marriage when the child comes of age. */
    _fulfilBetrothal(player, world, child, a, out) {
        const b = a.betrothal;
        const up = child.upbringing;
        const k = HeirAgency._kingdom(world, b.kingdomId);
        a.betrothal = null;
        if (!k || k.isAlive === false) {
            out.notices.push({ icon: '💔', title: 'A Promise Undone', text: `${b.kingdomName} has fallen; ${child.firstName}'s betrothal to ${b.name} comes to nothing.`, type: 'info' });
            return;
        }
        const hc = Heirs.config();
        const day = _day(world);
        up.spouse = { kind: 'alliance', kingdomId: b.kingdomId, kingdomName: k.name, name: b.name, day, betrothed: b.day };
        up.placement = { kind: 'alliance', kingdomId: b.kingdomId, kingdomName: k.name, day };
        HeirAgency._rep(player, b.kingdomId, Math.max(0, _num(hc.allianceReputation) - HeirAgency.config().betrothalReputation));
        if (player.house) {
            House.award(player.house, _num(hc.alliancePrestige), `${child.firstName} weds into ${k.name}`, day);
            House._chronicle(player.house, world, `Come of age, ${child.firstName} weds ${b.name} as was promised, binding ${player.house.name} to ${k.name}.`, ['marriage', 'heirs']);
        }
        Heirs._recordMatch(player, world, child, up.spouse);
        if (k.lord) NPCLords.rememberDeed(world, k.lord, 'child_wed', { note: child.firstName });
        HeirAgency.letter(player, world, child, `${child.firstName} is wed`, `The promise is kept: I am wed to ${b.name}. ${k.name} counts our House as kin now.`, b.kingdomId);
        out.notices.push({ icon: '💍', title: 'A Promise Kept', text: `${child.firstName} weds ${b.name} of ${k.name}, as was promised.`, type: 'success' });
    },

    // ──────────── COMMISSIONS ────────────

    _grownAtHome(player, world, child) {
        if (!child || child.isAlive === false) return 'No such child.';
        const up = Upbringing.ensure(child);
        const a = HeirAgency.ensure(child);
        if (!up.comeOfAge) return `${child.firstName} has not yet come of age.`;
        if (HeirAgency.isAway(child)) return `${child.firstName} is not at home.`;
        if (a.wounded) return `${child.firstName} is still recovering from wounds.`;
        if (HeirAgency.governing(player, world, child)) return `${child.firstName} governs a holding — relieve them first.`;
        return null;
    },

    /** Give a grown child command of the House's company (one commander at a time). */
    giveCommand(player, world, childId) {
        const child = HeirAgency._child(player, childId);
        const why = HeirAgency._grownAtHome(player, world, child);
        if (why) return { success: false, reason: why };
        // Of age is not old enough to lead men (data/upbringing.json agency.commandMinAge)
        const minAge = Number(HeirAgency.config().commandMinAge) || 0;
        if (Number(child.age) < minAge) return { success: false, reason: `${child.firstName} is too young to lead the company (${minAge} at least).` };
        for (const c of player.children || []) {
            const a = c && c.upbringing && c.upbringing.agency;
            if (a && a.commission && a.commission.kind === 'command') a.commission = null;
        }
        HeirAgency.ensure(child).commission = { kind: 'command', since: _day(world) };
        if (player.house) House._chronicle(player.house, world, `${child.firstName} is given command of ${player.house.name}'s company.`, ['heirs', 'war']);
        return { success: true, child };
    },

    /** Send a grown child as envoy to a realm's court. */
    sendEnvoy(player, world, childId, kid) {
        const cfg = HeirAgency.config();
        const child = HeirAgency._child(player, childId);
        const why = HeirAgency._grownAtHome(player, world, child);
        if (why) return { success: false, reason: why };
        const k = HeirAgency._kingdom(world, kid);
        if (!k || k.isAlive === false) return { success: false, reason: 'No such court.' };
        if (CourtLetters.atWar(player, world, kid)) return { success: false, reason: `You are at war with ${k.name}; no envoy would be received.` };
        if (_num(player.gold) < cfg.envoyCost) return { success: false, reason: `An embassy costs ${cfg.envoyCost} gold in gifts and retinue.` };
        player.gold -= cfg.envoyCost;
        Ledger.record(player, 'family', -cfg.envoyCost);
        const day = _day(world);
        const a = HeirAgency.ensure(child);
        a.commission = { kind: 'envoy', kingdomId: kid, kingdomName: k.name, since: day, until: day + cfg.envoyDays };
        // An envoy cannot hold a House office from abroad
        if (player.house && player.house.roles) {
            for (const r of House.ROLE_IDS) if (r !== 'heir' && player.house.roles[r] === child.id) player.house.roles[r] = null;
        }
        if (player.house) House._chronicle(player.house, world, `${child.firstName} rides as envoy to the court of ${k.name}.`, ['heirs', 'court']);
        return { success: true, child, commission: a.commission, cost: cfg.envoyCost };
    },

    /** End a child's commission (an envoy recalled early earns nothing). */
    endCommission(player, world, childId) {
        const child = HeirAgency._child(player, childId);
        const a = child && HeirAgency.ensure(child);
        if (!a || !a.commission) return { success: false, reason: 'They hold no commission.' };
        const was = a.commission;
        a.commission = null;
        return { success: true, child, commission: was };
    },

    /** The child commanding the House's company, fit to lead, or null. */
    commander(player) {
        for (const c of (player && player.children) || []) {
            if (!c || c.isAlive === false) continue;
            const a = c.upbringing && c.upbringing.agency;
            if (a && a.commission && a.commission.kind === 'command' && !a.wounded && !a.captive && !(c.upbringing.heldBy)) return c;
        }
        return null;
    },

    /**
     * The battle multiplier of who leads the company: a commanding child's
     * martial skill, or — under a regency with no one of the blood to lead —
     * a regent's captains, a little weaker. 1 otherwise. Pure.
     */
    commandMultiplier(player) {
        const cfg = HeirAgency.config();
        const c = HeirAgency.commander(player);
        if (c) {
            const sk = c.skills || {};
            return 1 + Math.min(cfg.commandCap, _num(sk.combat) * cfg.commandCombat + _num(sk.leadership) * cfg.commandLeadership);
        }
        if (player && player.regency && player.regency.active) return cfg.regencyBattleMult;
        return 1;
    },

    /**
     * A battle was fought (PlayerMilitary.combat, FieldBattle.finish): the
     * commanding child's record grows, and their fate is rolled — wounded,
     * captured for ransom, or killed. Returns { child, fate, text } or null.
     */
    onBattle(player, world, victory, enemyName = 'the enemy') {
        const child = HeirAgency.commander(player);
        if (!child) return null;
        const cfg = HeirAgency.config();
        const F = cfg.fate;
        const a = HeirAgency.ensure(child);
        const rec = a.record;
        const day = _day(world);
        rec.battles.fought++;
        if (victory) rec.battles.won++;
        else rec.battles.lost++;
        HeirAgency._train(child, 'combat', cfg.battleCombatXp);
        HeirAgency._train(child, 'leadership', cfg.battleLeadershipXp);
        const roll = HeirAgency._roll(world, `${child.id}:${day}:${rec.battles.fought}`);
        const death = victory ? F.deathWin : F.deathLoss;
        const capture = victory ? 0 : F.captureLoss;
        const wound = victory ? F.woundWin : F.woundLoss;
        let fate = 'unhurt';
        let text = `${child.firstName} led the company ${victory ? 'to victory' : 'in defeat'} against ${enemyName}.`;
        if (roll < death) {
            fate = 'killed';
            child.isAlive = false;
            child.deathDay = day;
            child.deathCause = 'battle';
            a.commission = null;
            if (player.heir === child.id) player.heir = null;
            if (player.house && player.house.roles) {
                for (const r of House.ROLE_IDS) if (player.house.roles[r] === child.id) player.house.roles[r] = null;
            }
            text = `${child.firstName} fell at the head of the company against ${enemyName}.`;
            if (player.house) House._chronicle(player.house, world, text, ['heirs', 'war']);
            HeirAgency._news(player, { icon: '🕯️', title: `${child.firstName} Has Fallen`, text, type: 'error' });
        } else if (roll < death + capture) {
            fate = 'captured';
            rec.captured++;
            a.commission = null;
            a.captive = { by: enemyName, day, until: day + F.captiveDays, ransom: F.ransom };
            text = `${child.firstName} was taken captive by ${enemyName}. They ask ${F.ransom} gold.`;
            if (player.house) House._chronicle(player.house, world, `${child.firstName} is taken captive by ${enemyName}.`, ['heirs', 'war']);
            HeirAgency.letter(player, world, child, `${child.firstName} is a captive`, `${enemyName} hold me. They ask ${F.ransom} gold for my freedom — pay it from my page in the Dynasty panel, or they will let me go in their own time, and the realm will say our House would not pay for its own.`);
            HeirAgency._news(player, { icon: '⛓️', title: `${child.firstName} Captured`, text, type: 'error' });
        } else if (roll < death + capture + wound) {
            fate = 'wounded';
            rec.wounds++;
            a.wounded = { day, until: day + F.woundDays };
            text = `${child.firstName} was wounded leading the company against ${enemyName}, and must rest ${F.woundDays} days.`;
            HeirAgency._news(player, { icon: '🔴', title: `${child.firstName} Wounded`, text, type: 'warning' });
        }
        return { child, fate, text, victory };
    },

    /** Pay a captive child's ransom. */
    ransom(player, world, childId) {
        const child = HeirAgency._child(player, childId);
        const a = child && HeirAgency.ensure(child);
        if (!a || !a.captive) return { success: false, reason: 'They are not held for ransom.' };
        const cost = _num(a.captive.ransom);
        if (_num(player.gold) < cost) return { success: false, reason: `The ransom is ${cost} gold.` };
        player.gold -= cost;
        Ledger.record(player, 'family', -cost);
        const by = a.captive.by;
        a.captive = null;
        if (player.house) House._chronicle(player.house, world, `${child.firstName} is ransomed from ${by}.`, ['heirs']);
        return { success: true, child, cost };
    },

    // ──────────── DAILY ────────────

    /**
     * One day of the House's children abroad and at work. Draws no RNG.
     * Returns { notices: [{ icon, title, text, type }] }.
     */
    processDay(player, world) {
        const out = { notices: [] };
        if (!player || !world) return out;
        if (Array.isArray(player._agencyNews) && player._agencyNews.length) {
            out.notices.push(...player._agencyNews);
            player._agencyNews = [];
        }
        const kids = ((player.children) || []).filter(c => c && c.isAlive !== false);
        if (!kids.length) return out;
        const cfg = HeirAgency.config();
        const day = _day(world);
        let governors = null;
        for (const child of kids) {
            const up = Upbringing.ensure(child);
            const a = HeirAgency.ensure(child);
            const p = up.placement;

            // A ward abroad: the bond grows; a soured court takes a hostage
            if (p && p.kind === 'ward' && !p.returned) {
                if (up.recalledHome) {
                    p.returned = true;
                    p.recalled = true;
                    if (up.tutor && up.tutor.kind === 'host') up.tutor = null;
                } else if (!up.heldBy) {
                    if (day > _num(p.day) && (day - _num(p.day)) % 30 === 0) {
                        a.record.bonds[p.kingdomId] = Math.min(cfg.fosterBondCap, _num(a.record.bonds[p.kingdomId]) + cfg.fosterBondPerMonth);
                    }
                    if (cfg.hostageCheckDays > 0 && day % cfg.hostageCheckDays === 0) HeirAgency._hostageCheck(player, world, child, p, out);
                }
            }
            // A fosterage over: into the record, and a letter home
            if (p && p.kind === 'ward' && p.returned && !p.recorded) {
                p.recorded = true;
                a.record.fostered.push({
                    kingdomId: p.kingdomId, kingdomName: p.kingdomName, lordName: p.lordName,
                    from: _num(p.day), to: day, minor: !!p.minor, recalled: !!p.recalled,
                });
                if (!p.recalled) {
                    HeirAgency.letter(player, world, child, `${child.firstName} comes home`, `I am home from the court of ${p.lordName}. I learned more there than I can write — and ${p.lordName} bids me remember them kindly.`, p.kingdomId);
                }
            }
            // The betrothed come of age (or are married elsewhere)
            if (a.betrothal) {
                if (up.spouse) {
                    if (up.spouse.kingdomId !== a.betrothal.kingdomId) HeirAgency.breakBetrothal(player, world, child.id, 'wed elsewhere');
                    else a.betrothal = null;
                } else if (up.comeOfAge) {
                    HeirAgency._fulfilBetrothal(player, world, child, a, out);
                }
            }
            // An embassy completes
            const cm = a.commission;
            if (cm && cm.kind === 'envoy' && day >= _num(cm.until)) HeirAgency._envoyHome(player, world, child, a, out);
            // Wounds heal; a captive no one ransomed is let go
            if (a.wounded && day >= _num(a.wounded.until)) {
                a.wounded = null;
                out.notices.push({ icon: '🤕', title: `${child.firstName} Recovered`, text: `${child.firstName} is fit to ride again.`, type: 'info' });
            }
            if (a.captive && day >= _num(a.captive.until)) {
                const by = a.captive.by;
                a.captive = null;
                HeirAgency._prestige(player, -cfg.fate.unransomedPrestige, `${child.firstName} left unransomed`, world);
                if (player.house) House._chronicle(player.house, world, `${child.firstName} is let go by ${by}, unransomed. It is said the House would not pay for its own.`, ['heirs']);
                out.notices.push({ icon: '🕊️', title: `${child.firstName} Freed`, text: `${by} let ${child.firstName} go unransomed. The House is shamed.`, type: 'warning' });
            }
            // A governor of the blood learns the trade of stewardship
            if (up.comeOfAge) {
                if (governors == null) {
                    governors = new Set();
                    for (const ref of Holdings.list(player, world)) {
                        const g = ref.settlement && ref.settlement.holding && ref.settlement.holding.governor;
                        if (g) governors.add(g.id);
                    }
                }
                if (governors.has(child.id)) {
                    a.record.stewardDays++;
                    if (cfg.stewardXpDays > 0 && a.record.stewardDays % cfg.stewardXpDays === 0) HeirAgency._train(child, 'commerce', 1);
                }
            }
        }
        return out;
    },

    /** A host court that has come to think ill of the House keeps the child. */
    _hostageCheck(player, world, child, p, out) {
        const k = HeirAgency._kingdom(world, p.kingdomId);
        if (!k || !k.lord || k.isAlive === false) return;
        // At open war the court letters carry it (child_hostage); this is the cold peace
        if (CourtLetters.atWar(player, world, k.id)) return;
        const regard = CourtLetters.regard(player, world, k);
        if (regard > HeirAgency.config().hostageRegard) return;
        const day = _day(world);
        Upbringing.ensure(child).heldBy = { kingdomId: k.id, day };
        HeirAgency._prestige(player, -5, `${child.firstName} held at ${k.name}`, world);
        if (player.house) House._chronicle(player.house, world, `${k.name}'s court, grown cold toward ${player.house.name}, keeps ${child.firstName} as a hostage.`, ['heirs', 'threat']);
        out.notices.push({ icon: '⛓️', title: `${child.firstName} Held`, text: `${p.lordName} no longer trusts your House and keeps ${child.firstName} as a hostage. Win back their regard, or send a ransom by letter (Post → ${k.name}).`, type: 'error' });
    },

    _envoyHome(player, world, child, a, out) {
        const cfg = HeirAgency.config();
        const cm = a.commission;
        a.commission = null;
        const k = HeirAgency._kingdom(world, cm.kingdomId);
        if (!k || k.isAlive === false) return;
        const day = _day(world);
        if (CourtLetters.atWar(player, world, k.id)) {
            Upbringing.ensure(child).heldBy = { kingdomId: k.id, day };
            if (player.house) House._chronicle(player.house, world, `War breaks the embassy: ${k.name} keeps ${child.firstName} as a hostage.`, ['heirs', 'war']);
            out.notices.push({ icon: '⛓️', title: `${child.firstName} Held`, text: `Your realms are at war: ${k.name} keeps your envoy ${child.firstName} as a hostage.`, type: 'error' });
            return;
        }
        const rep = Math.round(cfg.envoyReputation + _num(child.skills && child.skills.diplomacy) * cfg.envoyDiplomacyRep);
        HeirAgency._rep(player, k.id, rep);
        if (k.lord) NPCLords.rememberDeed(world, k.lord, 'envoy_received', { note: child.firstName });
        a.record.bonds[k.id] = Math.min(cfg.fosterBondCap, _num(a.record.bonds[k.id]) + cfg.envoyBond);
        a.record.envoys.push({ kingdomId: k.id, kingdomName: k.name, day, reputation: rep });
        HeirAgency._train(child, 'diplomacy', 1);
        if (player.house) House._chronicle(player.house, world, `${child.firstName} returns from an embassy to ${k.name}.`, ['heirs', 'court']);
        HeirAgency.letter(player, world, child, `The embassy to ${k.name}`, `My embassy is done. ${HeirAgency._lordName(k)} received me well; our standing at that court has risen (+${rep}).`, k.id);
        out.notices.push({ icon: '📜', title: 'An Embassy Returns', text: `${child.firstName} is home from ${k.name}: +${rep} standing there.`, type: 'success' });
    },

    // ──────────── SUCCESSION ────────────

    /**
     * What the heir's record will carry into the reign: [{ icon, text }],
     * Prestige, renown, traits, standing and memories. Pure — the same plan
     * applySuccession() carries out.
     */
    payoff(player, world, child) {
        const P = HeirAgency.config().payoff;
        const plan = { lines: [], prestige: 0, renown: 0, traits: [], reputation: {}, memories: [], commerce: 0 };
        if (!child) return plan;
        const up = Upbringing.ensure(child);
        const a = HeirAgency.ensure(child);
        const rec = a.record;
        const rep = (kid, n) => { plan.reputation[kid] = _num(plan.reputation[kid]) + n; };
        for (const f of rec.fostered) {
            if (f.recalled) continue;
            const k = HeirAgency._kingdom(world, f.kingdomId);
            if (!k || k.isAlive === false) continue;
            const bond = _num(rec.bonds[f.kingdomId]);
            const def = NPCLords.deedDef('fostered_heir');
            plan.memories.push({ kingdomId: k.id, deed: 'fostered_heir', weight: Math.round((_num(def && def.weight, 14) + bond * P.fosterBondWeight) * 10) / 10 });
            rep(k.id, P.fosterReputation);
            plan.prestige += P.fosterPrestige;
            plan.lines.push({ icon: '🏰', text: `Raised at the court of ${f.lordName}: ${k.name} counts the new ruler as its own (+${P.fosterReputation} standing).` });
        }
        const envoyRealms = [...new Set(rec.envoys.map(e => e.kingdomId))];
        for (const kid of envoyRealms) {
            const k = HeirAgency._kingdom(world, kid);
            if (!k || k.isAlive === false) continue;
            rep(kid, P.envoyReputation);
            plan.prestige += P.envoyPrestige;
            plan.lines.push({ icon: '📜', text: `Once envoy to ${k.name} (+${P.envoyReputation} standing).` });
        }
        const won = _num(rec.battles.won);
        if (rec.battles.fought > 0) {
            const pr = Math.min(P.battlePrestigeCap, won * P.battlePrestige);
            const rn = Math.min(P.battleRenownCap, won * P.battleRenown);
            plan.prestige += pr;
            plan.renown += rn;
            plan.lines.push({ icon: '⚔️', text: `Commanded the House's company in ${rec.battles.fought} battle${rec.battles.fought === 1 ? '' : 's'}, ${won} won${pr ? ` (+${pr} Prestige, +${rn} renown)` : ''}.` });
            if (won >= P.braveAt && Traits.TRAITS.brave) {
                plan.traits.push('brave');
                plan.lines.push({ icon: '🦁', text: 'The soldiers who followed them call the new ruler Brave.' });
            }
        }
        if (rec.captured > 0) {
            plan.prestige += rec.captured * P.capturedPrestige;
            plan.lines.push({ icon: '⛓️', text: `Once a captive — the realm remembers (${rec.captured * P.capturedPrestige} Prestige).` });
        }
        if (rec.stewardDays >= P.stewardDays) {
            plan.prestige += P.stewardPrestige;
            plan.commerce += P.stewardCommerce;
            plan.lines.push({ icon: '🏛️', text: `Governed a holding for ${rec.stewardDays} days (+${P.stewardCommerce} commerce).` });
        }
        const sp = up.spouse;
        if (sp && (sp.kind === 'alliance' || sp.kind === 'royal') && sp.kingdomId) {
            const k = HeirAgency._kingdom(world, sp.kingdomId);
            if (k && k.isAlive !== false) {
                plan.memories.push({ kingdomId: k.id, deed: 'marriage_kin', weight: null });
                plan.prestige += P.marriagePrestige;
                plan.lines.push({ icon: '💍', text: `Wed to ${sp.name}: ${k.name} is kin to the throne now.` });
            }
        }
        return plan;
    },

    /**
     * Carry the heir's record into the reign (Relationships.succeedAsHeir,
     * after the heir has taken over). Returns the plan applied.
     */
    onSuccession(player, world, child) {
        const plan = HeirAgency.payoff(player, world, child);
        if (!player || !child) return plan;
        for (const m of plan.memories) {
            const k = HeirAgency._kingdom(world, m.kingdomId);
            if (k && k.lord) NPCLords.rememberDeed(world, k.lord, m.deed, { note: child.firstName, ...(m.weight != null ? { weight: m.weight } : {}) });
        }
        for (const [kid, n] of Object.entries(plan.reputation)) HeirAgency._rep(player, kid, n);
        if (plan.renown) player.renown = _num(player.renown) + plan.renown;
        if (plan.commerce) {
            if (!player.skills) player.skills = {};
            player.skills.commerce = _num(player.skills.commerce) + plan.commerce;
        }
        plan.granted = plan.traits.length ? Traits.grantTraits(player, plan.traits) : [];
        plan.prestigeApplied = HeirAgency._prestige(player, plan.prestige, `${child.firstName}'s life before the throne`, world);
        if (player.house && plan.lines.length) {
            const parts = plan.lines.map(l => l.text.replace(/\s*\([^)]*\)/g, '').replace(/\.$/, ''));
            House._chronicle(player.house, world, `${child.firstName} came to the seat with a life already lived: ${parts.join('; ')}.`, ['heirRecord']);
        }
        return plan;
    },
};
