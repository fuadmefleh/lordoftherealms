// ============================================
// RAISING — the heirs you raise
// ============================================
// The parent's own hand in a child's upbringing, on top of the education
// focus, tutors and childhood dilemmas of systems/upbringing.js and the
// fostering, betrothals and commissions of systems/heirAgency.js:
//
//   • Time together. A few times a year (timesPerYear, a cooldown between)
//     the ruler can spend time with a child: a hunt, the accounts, the
//     petitions, prayer, tales by the fire, a hard lesson… Each activity
//     teaches (scaled by the parent's own skill in it), plants seeds of
//     character, and moves the child's BOND with the parent (0–100). A child
//     left alone for a year drifts away. The bond is read: it scales how much
//     of the parent's character rubs off (Upbringing._growthTick); at coming
//     of age a close child leans merciful and honest, a distant one cruel and
//     restless (Upbringing.comeOfAge); and at succession a close heir brings
//     Prestige, an estranged one costs it (HeirAgency.payoff).
//   • Tutors of flesh and blood. Courtiers, people the ruler knows, or the
//     townsfolk of the town the ruler stands in can be hired to teach. Their
//     occupation decides the subject; their skill in it the pace; their
//     temper (NPC traits) the character they pass on. Wages are paid monthly
//     from the ruler's purse into the tutor's own (npc.purse) — a courtier
//     teaches for a share of the usual wage. Unpaid, they leave.
//   • Wards taken in. A realm at peace whose standing with the House is good
//     sends a child of its court to be raised at the House's: its treasury
//     pays a monthly fosterage fee into the ruler's purse; standing with that
//     realm grows; the House's own children raised beside the ward make a
//     friend of that court (HeirAgency record.wardmates — paid off when one
//     of them inherits). At war, the ward is a hostage in the House's keeping;
//     sent home in the war, the realm is grateful. A ward can sicken and die
//     (a hash roll), and their realm takes it hard.
//   • The coming-of-age summary: what the childhood made of them — the gains
//     since education began, the tutors, the time together, the bond, the
//     traits, fosterage and betrothal, and a grade (summary on the record,
//     shown on the child's page and carried onto the ruler as
//     player.upbringingRecord when they inherit).
//
// State: child.upbringing.raising (saved with player.children);
// player.house.wards / wardHistory / wardLast (saved with the House); a
// tutor's wages on their NPC (npc.purse, saved with the relationship NPCs).
// Randomness: the activity's risk and the parent's example draw from Utils
// (player actions); the daily tick draws none (a ward's fate is a hash roll).
// Content: data/upbringing.json → raising. No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { NPCLords } from '../world/npcLords.js';
import { Upbringing } from './upbringing.js';
import { HeirAgency } from './heirAgency.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Court } from './court.js';
import { Ledger } from './ledger.js';
import { Relationships } from './relationships.js';
import { Townsfolk } from './townsfolk.js';
import { CourtLetters } from './courtLetters.js';
import { Throne } from './throne.js';
import { Names } from '../core/names.js';

const STATS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];
const SKILLS = ['commerce', 'combat', 'leadership', 'diplomacy', 'stealth', 'cartography'];

const DEFAULTS = {
    bondStart: 50, timesPerYear: 3, timeCooldownDays: 20, timeMinAge: 3,
    neglectDays: 120, bondDecayPerMonth: 1.5, bondDecayAway: 0.5, bondFloor: 15,
    parentSkillWeight: 0.08, parentSkillMin: 0.6, parentSkillCap: 1.8,
    rubOffBase: 0.2, rubOffPerBond: 0.004,
    closeBond: 70, distantBond: 25, closeSeeds: {}, distantSeeds: {},
    tutorWageDays: 4, tutorCourtierShare: 0.5, tutorQualityBase: 1, tutorQualityPerSkill: 0.11,
    tutorQualityCap: 2.2, tutorMinAge: 18, tutorTownRoles: ['priest', 'guard', 'merchant', 'noble'], tutorListCap: 8,
    focusSkill: {}, tutorOccupations: {}, tutorTraitSeeds: {}, tutorTraitQuality: {},
    summaryGrades: [], activities: [],
    wards: {
        maxBase: 1, prestigePerSeat: 120, maxCap: 3, minReputation: 10, years: 2, minAge: 6, maxAge: 13,
        fee: 10, repPerMonth: 1, repCap: 12, returnReputation: 8, returnPrestige: 3,
        deathChancePerYear: 0.01, deathReputation: -25, sendHomeReputation: -4, warReturnReputation: 10,
        wardmateAgeGap: 4, wardmateCap: 24, cooldownDays: 240, historyCap: 12,
    },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

/** A hash roll in [0,1): the same world and key always roll the same. */
function _roll(world, key) {
    return ((Utils.hashStr(`${_seed(world)}|raising|${key}`) >>> 0) % 1000003) / 1000003;
}

function _traitIds(npc) {
    return ((npc && npc.traits) || []).map(t => (t && t.id) || t).filter(Boolean);
}

export const Raising = {
    // ──────────── DATA ────────────

    config() {
        const d = _obj(DataLoader.upbringing && DataLoader.upbringing.raising) || {};
        return { ...DEFAULTS, ...d, wards: { ...DEFAULTS.wards, ...(_obj(d.wards) || {}) } };
    },

    activities() {
        return Raising.config().activities || [];
    },

    activity(id) {
        return Raising.activities().find(a => a && a.id === id) || null;
    },

    _daysPerYear() {
        return Upbringing._daysPerYear();
    },

    _child(player, childId) {
        return ((player && player.children) || []).find(c => c && c.id === childId) || null;
    },

    _kingdom(world, kid) {
        return world && typeof world.getKingdom === 'function' && kid ? world.getKingdom(kid) : null;
    },

    _rep(player, kid, n) {
        if (!kid || !n) return;
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = Utils.clamp(_num(player.reputation[kid]) + n, -100, 100);
    },

    // ──────────── STATE ────────────

    /** A child's raising record (created / backfilled; never draws RNG). */
    ensure(child) {
        if (!child) return null;
        const up = Upbringing.ensure(child);
        let r = up.raising;
        if (!_obj(r)) r = up.raising = {};
        if (!Number.isFinite(r.bond)) r.bond = Raising.config().bondStart;
        if (!Array.isArray(r.timeLog)) r.timeLog = [];
        if (!Number.isFinite(r.timeCount)) r.timeCount = 0;
        if (r.lastTime === undefined) r.lastTime = null;
        if (r.neglectFrom === undefined) r.neglectFrom = null;
        if (!_obj(r.taught)) r.taught = {};
        if (r.start === undefined) r.start = null;
        if (r.summary === undefined) r.summary = null;
        return r;
    },

    bond(child) {
        const r = child && child.upbringing && child.upbringing.raising;
        return r && Number.isFinite(r.bond) ? r.bond : Raising.config().bondStart;
    },

    /** "Close", "Fond", "Distant"… for a bond value. */
    bondLabel(v) {
        const c = Raising.config();
        if (v >= 85) return 'Devoted';
        if (v >= c.closeBond) return 'Close';
        if (v >= 45) return 'Fond';
        if (v > c.distantBond) return 'Cool';
        return 'Estranged';
    },

    _addBond(child, n) {
        const r = Raising.ensure(child);
        r.bond = Math.round(Utils.clamp(r.bond + _num(n), 0, 100) * 10) / 10;
        return r.bond;
    },

    // ──────────── TIME TOGETHER ────────────

    /** Can the ruler spend time with this child now? { ok, reason, left, next }. */
    timeStatus(player, world, child) {
        const cfg = Raising.config();
        if (!child || child.isAlive === false) return { ok: false, reason: 'No such child.', left: 0 };
        const up = Upbringing.ensure(child);
        const r = Raising.ensure(child);
        const day = _day(world);
        const Y = Raising._daysPerYear();
        const left = Math.max(0, cfg.timesPerYear - r.timeLog.filter(d => day - d < Y).length);
        const name = child.firstName || 'The child';
        if (up.comeOfAge) return { ok: false, reason: `${name} is grown; your time together now is counsel, not lessons.`, left };
        if (_num(child.age) < cfg.timeMinAge) return { ok: false, reason: `${name} is too small for more than a cradle song.`, left };
        if (HeirAgency.isAway(child)) return { ok: false, reason: `${name} is not at home.`, left };
        if (!left) {
            const next = Math.min(...r.timeLog.filter(d => day - d < Y)) + Y;
            return { ok: false, reason: `You have given ${name} all the time this year allows. Again from day ${next}.`, left, next };
        }
        if (r.lastTime != null && day - r.lastTime < cfg.timeCooldownDays) {
            const next = r.lastTime + cfg.timeCooldownDays;
            return { ok: false, reason: `You were with ${name} only lately. Again from day ${next}.`, left, next };
        }
        return { ok: true, reason: null, left };
    },

    /** The activities with whether each fits the child's age. */
    activitiesFor(player, world, child) {
        const age = _num(child && child.age);
        return Raising.activities().map(a => ({
            ...a, fits: age >= _num(a.minAge), why: age >= _num(a.minAge) ? null : `From age ${a.minAge}.`,
            parentFactor: Raising.parentFactor(player, a),
        }));
    },

    /** How well the parent teaches an activity (their own skill in it). */
    parentFactor(player, act) {
        const cfg = Raising.config();
        if (!act || (!act.parentSkill && !act.parentStat)) return 1;
        const v = act.parentSkill
            ? _num(player && player.skills && player.skills[act.parentSkill])
            : _num(player && player[act.parentStat], 5) - 2;
        return Math.round(Utils.clamp(1 + (v - 3) * cfg.parentSkillWeight, cfg.parentSkillMin, cfg.parentSkillCap) * 100) / 100;
    },

    /**
     * Spend time with a child: teach, plant character, move the bond.
     * Returns { success, text, bond, bondDelta, gains, rubOff, hurt } or { success:false, reason }.
     */
    spendTime(player, world, childId, activityId) {
        const cfg = Raising.config();
        const child = Raising._child(player, childId);
        const st = Raising.timeStatus(player, world, child);
        if (!st.ok) return { success: false, reason: st.reason };
        const act = Raising.activity(activityId);
        if (!act) return { success: false, reason: 'No such pastime.' };
        if (_num(child.age) < _num(act.minAge)) return { success: false, reason: `${child.firstName} is too young for that (from age ${act.minAge}).` };
        const r = Raising.ensure(child);
        const day = _day(world);
        const f = Raising.parentFactor(player, act);
        const before = Raising._snap(child);

        for (const [stat, v] of Object.entries(act.stats || {})) if (STATS.includes(stat)) Upbringing._addXp(child, 'stat', stat, _num(v) * f);
        for (const [skill, v] of Object.entries(act.skills || {})) if (SKILLS.includes(skill)) Upbringing._addXp(child, 'skill', skill, _num(v) * f);
        if (act.seeds) Upbringing._addSeeds(child, act.seeds);
        if (act.focusBoost) Upbringing._growPure(child, _num(act.focusBoost), false);

        // The parent's own character, passed on in the telling
        let rubOff = null;
        const earned = Traits.getEarned(player);
        if (act.rubOff && earned.length) {
            const chance = Utils.clamp(cfg.rubOffBase + r.bond * cfg.rubOffPerBond, 0, 0.9) * _num(act.rubOff, 1);
            if (Utils.random() < chance) {
                rubOff = earned[Math.floor(Utils.random() * earned.length)];
                Upbringing._addSeeds(child, { [rubOff]: 1 });
            }
        }
        // A pastime with a risk (a fall from the saddle)
        let hurt = null;
        if (act.risk && Utils.random() < _num(act.risk.chance)) {
            const loss = _num(act.risk.maxHealth);
            if (loss) {
                child.maxHealth = Math.max(50, _num(child.maxHealth, 100) + loss);
                child.health = Math.min(_num(child.health, child.maxHealth), child.maxHealth);
            }
            hurt = Upbringing._fill(act.risk.text || '{child} is hurt.', child, null);
        }
        const bondDelta = _num(act.bond) + (hurt ? _num(act.risk.bond) : 0);
        const was = r.bond;
        Raising._addBond(child, bondDelta);

        r.timeLog.push(day);
        r.timeLog = r.timeLog.filter(d => day - d < Raising._daysPerYear() * 2).slice(-8);
        r.timeCount++;
        r.lastTime = day;

        const gains = Raising._diff(before, Raising._snap(child));
        const texts = [Upbringing._fill(act.result || `You spend the day with {child}.`, child, null)];
        if (rubOff && Traits.TRAITS[rubOff]) texts.push(`${child.firstName} hangs on your every word — something of your ${Traits.TRAITS[rubOff].name.toLowerCase()} way takes root.`);
        if (hurt) texts.push(hurt);
        return { success: true, child, activity: act, text: texts.join(' '), bond: r.bond, bondDelta: Math.round((r.bond - was) * 10) / 10, gains, rubOff, hurt, factor: f };
    },

    _snap(child) {
        const s = { stats: {}, skills: {} };
        for (const k of STATS) s.stats[k] = _num(child && child[k]);
        for (const k of SKILLS) s.skills[k] = _num(child && child.skills && child.skills[k]);
        return s;
    },

    _diff(a, b) {
        const out = {};
        for (const k of STATS) if (b.stats[k] !== a.stats[k]) out[k] = b.stats[k] - a.stats[k];
        for (const k of SKILLS) if (b.skills[k] !== a.skills[k]) out[k] = b.skills[k] - a.skills[k];
        return out;
    },

    // ──────────── TUTORS OF FLESH AND BLOOD ────────────

    /** The subject a person would teach (their occupation), or null for "all subjects". */
    teaches(npc) {
        const cfg = Raising.config();
        const occ = String((npc && npc.occupation) || '').toLowerCase();
        const map = { ...((Upbringing.data().companionOccupations) || {}), ...(cfg.tutorOccupations || {}) };
        const f = map[occ] || null;
        return f && Upbringing.focus(f) ? f : null;
    },

    /** Tutor quality: their skill in the subject, their temper. */
    tutorQuality(npc, focus) {
        const cfg = Raising.config();
        const skills = Court.ensureSkills(npc) || {};
        let skill;
        if (focus) skill = _num(skills[cfg.focusSkill[focus] || 'diplomacy']);
        else skill = Math.max(0, ...Object.values(skills).map(v => _num(v))) * 0.5;
        let q = cfg.tutorQualityBase + skill * cfg.tutorQualityPerSkill;
        for (const t of _traitIds(npc)) q += _num(cfg.tutorTraitQuality[t]);
        return Math.round(Utils.clamp(q, 1, cfg.tutorQualityCap) * 100) / 100;
    },

    /** The character a tutor's temper passes on: { traitId: seeds per year }. */
    tutorSeeds(npc) {
        const cfg = Raising.config();
        const seeds = {};
        for (const t of _traitIds(npc)) {
            for (const [id, v] of Object.entries(cfg.tutorTraitSeeds[t] || {})) {
                if (Traits.TRAITS[id]) seeds[id] = Math.round((_num(seeds[id]) + _num(v)) * 1000) / 1000;
            }
        }
        return seeds;
    },

    /** Their monthly wage: a few days of what they would ask at court; a courtier teaches for a share. */
    tutorWage(player, npc) {
        const cfg = Raising.config();
        let w = Court.expectedStipend(npc) * cfg.tutorWageDays;
        if (Court.isMember(player, npc.id)) w *= cfg.tutorCourtierShare;
        return Math.max(1, Math.round(w));
    },

    _tutorBarred(player, npc) {
        const cfg = Raising.config();
        if (!npc || npc.isAlive === false) return 'They are not available.';
        if (_num(npc.age, 30) < cfg.tutorMinAge) return `${npc.firstName} is too young to teach.`;
        if ((player.travelParty || []).includes(npc.id)) return null; // a companion: asked as one (Upbringing.hireCompanionTutor)
        if (npc.royal && npc.royal.kingdomId) return `${npc.firstName} is of royal blood and teaches no one's children.`;
        if (npc.rivalHouse || npc.courtOf) return `${npc.firstName} is bound to another House.`;
        if (npc.governing) return `${npc.firstName} is governing one of your holdings.`;
        return null;
    },

    _candidate(player, world, npc, kind, extra = {}) {
        const focus = Raising.teaches(npc);
        return {
            kind, npcId: npc ? npc.id : null, name: `${npc.firstName}${npc.dynasty ? ' ' + npc.dynasty : ''}`,
            occupation: npc.occupation || null, focus, quality: Raising.tutorQuality(npc, focus),
            wage: Raising.tutorWage(player, npc), seeds: Raising.tutorSeeds(npc), traits: _traitIds(npc),
            ...extra,
        };
    },

    /**
     * People who could tutor a child: courtiers, people you know, and the
     * townsfolk of the town you stand in (priests, guards, merchants, nobles).
     * The best teachers of the child's focus first.
     */
    tutorCandidates(player, world, childId) {
        const cfg = Raising.config();
        const child = Raising._child(player, childId);
        if (!child) return [];
        const focus = Upbringing.ensure(child).focus;
        const out = [];
        const seen = new Set();
        const add = (c) => { if (c && !seen.has(c.npcId || c.folkUid)) { seen.add(c.npcId || c.folkUid); out.push(c); } };
        for (const npc of Court.members(player)) {
            if (!Raising._tutorBarred(player, npc) && !(player.travelParty || []).includes(npc.id)) add(Raising._candidate(player, world, npc, 'courtier'));
        }
        for (const id of Object.keys(player.relationships || {})) {
            const npc = Relationships.getNPC(id);
            if (!npc || player.spouse === npc.id || (player.travelParty || []).includes(npc.id) || Raising._tutorBarred(player, npc)) continue;
            if (!Raising.teaches(npc) && !cfg.tutorOccupations[String(npc.occupation || '').toLowerCase()]) continue;
            add(Raising._candidate(player, world, npc, 'known'));
        }
        // The townsfolk of the town you stand in: not yet known, a stranger's price
        const tile = world && typeof world.getTile === 'function' && player ? world.getTile(player.q, player.r) : null;
        const folk = tile && tile.settlement && tile.settlement.folk;
        if (folk && Array.isArray(folk.people)) {
            const C = Townsfolk.config();
            for (const p of folk.people) {
                if (!Townsfolk.isHere(p) || !cfg.tutorTownRoles.includes(p.role)) continue;
                if (Townsfolk.age(p, _day(world)) < Math.max(cfg.tutorMinAge, _num(C.comeOfAge))) continue;
                const uid = Relationships.folkUid(folk, p);
                const known = Relationships.npcForPerson(folk, p);
                if (known) {
                    if (!Raising._tutorBarred(player, known)) add(Raising._candidate(player, world, known, 'known'));
                    continue;
                }
                const temp = Raising._folkStandIn(folk, p, world, tile.settlement);
                add(Raising._candidate(player, world, temp, 'townsfolk', { npcId: null, folkUid: uid, town: tile.settlement.name, role: Townsfolk.roleTitle(p) }));
            }
        }
        const fit = (c) => (focus && c.focus === focus ? 2 : c.focus ? 0 : 1);
        out.sort((a, b) => fit(b) - fit(a) || b.quality - a.quality || a.wage - b.wage || String(a.name).localeCompare(String(b.name)));
        return out.slice(0, cfg.tutorListCap);
    },

    /**
     * What a townsperson would be as an NPC — the same traits, occupation and
     * skills the bridge (Relationships.fromTownsperson) will give them.
     */
    _folkStandIn(folk, p, world, settlement) {
        const uid = Relationships.folkUid(folk, p);
        const temp = {
            id: `folk:${uid}`, firstName: p.first, dynasty: p.last, age: Townsfolk.age(p, _day(world)),
            occupation: { villager: 'artisan', farmer: 'farmer', merchant: 'merchant', guard: 'guard', priest: 'priest', noble: 'noble' }[p.retired || p.role] || 'artisan',
            traits: Raising._folkTraits(p), isAlive: true, settlementName: settlement ? settlement.name : '',
        };
        Court.ensureSkills(temp);
        return temp;
    },

    _folkTraits(p) {
        const map = {
            kind: ['honest', 'generous'], quiet: ['homebody', 'serious'], bold: ['brave', 'adventurous'],
            witty: ['humorous', 'cunning'], jovial: ['humorous', 'romantic'], stern: ['serious', 'loyal'],
            cautious: ['cautious', 'practical'], generous: ['generous', 'loyal'], stubborn: ['loyal', 'practical'],
            curious: ['scholarly', 'adventurous'],
        };
        const out = [];
        for (const t of p.traits || []) for (const x of map[t] || []) if (!out.includes(x)) out.push(x);
        return out.slice(0, 3);
    },

    /**
     * Hire a person to tutor a child. ref: { npcId } (a courtier or someone
     * known) or { folkUid } (a townsperson, met for the purpose). The first
     * month's wage is paid now, into their purse.
     */
    hireTutor(player, world, childId, ref = {}) {
        const child = Raising._child(player, childId);
        if (!child || child.isAlive === false) return { success: false, reason: 'No such child.' };
        const up = Upbringing.ensure(child);
        if (up.comeOfAge) return { success: false, reason: `${child.firstName} is grown; tutors are for children.` };
        if (HeirAgency.isAway(child)) return { success: false, reason: `${child.firstName} is not at home.` };
        let npc = ref.npcId ? Relationships.getNPC(ref.npcId) : null;
        let standIn = null;
        if (!npc && ref.folkUid) {
            const found = Relationships.folkPerson(world, ref.folkUid);
            if (!found) return { success: false, reason: 'They are not to be found.' };
            standIn = Raising._folkStandIn(found.folk, found.p, world, found.settlement);
            const res = Relationships.fromTownsperson(player, world, found.folk, found.p, found.settlement);
            if (!res.success) return { success: false, reason: res.reason };
            npc = res.npc;
            // Keep the skills they were offered on (the bridge's id is new)
            if (!_obj(npc.skills)) npc.skills = { ...standIn.skills };
        }
        if (!npc) return { success: false, reason: 'No such person.' };
        if ((player.travelParty || []).includes(npc.id)) return { success: false, reason: `${npc.firstName} travels with you — ask them as a companion.` };
        const barred = Raising._tutorBarred(player, npc);
        if (barred) return { success: false, reason: barred };
        const c = Raising._candidate(player, world, npc, Court.isMember(player, npc.id) ? 'courtier' : 'known');
        if (_num(player.gold) < c.wage) return { success: false, reason: `${npc.firstName} wants the first month's wage, ${c.wage} gold, up front.` };
        Raising._pay(player, npc, c.wage);
        up.tutor = {
            kind: 'person', npcId: npc.id, name: c.name, icon: c.kind === 'courtier' ? '🎓' : '👨‍🏫',
            occupation: c.occupation, focus: c.focus, quality: c.quality, wage: c.wage, seeds: c.seeds,
            traits: c.traits, courtier: c.kind === 'courtier', since: _day(world), paidMonths: 1,
        };
        const rel = player.relationships && player.relationships[npc.id];
        if (rel && Number.isFinite(rel.score)) rel.score = Math.min(100, rel.score + 3);
        return { success: true, child, tutor: up.tutor, cost: c.wage, npc };
    },

    /** Wages from the ruler's purse into the tutor's own. */
    _pay(player, npc, amount) {
        const a = Math.max(0, Math.round(amount));
        if (!a) return 0;
        player.gold = _num(player.gold) - a;
        npc.purse = _num(npc.purse) + a;
        Ledger.record(player, 'family', -a);
        return a;
    },

    // ──────────── WARDS AT COURT ────────────

    wards(player) {
        const h = player && player.house;
        if (!h) return [];
        if (!Array.isArray(h.wards)) h.wards = [];
        return h.wards;
    },

    /** How many wards the House can keep (Prestige makes room). */
    wardSeats(player) {
        const W = Raising.config().wards;
        const pr = _num(player && player.house && player.house.prestige);
        return Math.min(W.maxCap, W.maxBase + Math.floor(pr / Math.max(1, W.prestigePerSeat)));
    },

    wardAge(world, w) {
        return _num(w.age) + Math.floor(Math.max(0, _day(world) - _num(w.since)) / Raising._daysPerYear());
    },

    /** Why a realm would not send a ward, or null. */
    _wardBarred(player, world, k) {
        const W = Raising.config().wards;
        if (!player || !player.house) return 'You have no House to raise another\'s child.';
        if (!k || k.isAlive === false) return 'No such realm.';
        const ruled = Throne.ruledKingdom(player, world);
        if (ruled && ruled.id === k.id) return 'That is your own realm.';
        if (CourtLetters.atWar(player, world, k.id)) return `You are at war with ${Names.realm(k.name)}.`;
        if (_num(player.reputation && player.reputation[k.id]) < W.minReputation) return `${k.name} does not trust your House enough (need ${W.minReputation} standing).`;
        if (Raising.wards(player).some(w => w.kingdomId === k.id)) return `A ward of ${Names.realm(k.name)} already lives at your court.`;
        if (Raising.wards(player).length >= Raising.wardSeats(player)) return `Your household has room for ${Raising.wardSeats(player)} ward${Raising.wardSeats(player) === 1 ? '' : 's'}. More Prestige makes room.`;
        const last = player.house.wardLast && player.house.wardLast[k.id];
        if (last != null && _day(world) - last < W.cooldownDays) return `${k.name} sent you a ward lately; ask again from day ${last + W.cooldownDays}.`;
        return null;
    },

    /** Realms that could send a ward: [{ kingdom, ok, reason, fee }]. */
    wardOffers(player, world) {
        const W = Raising.config().wards;
        return ((world && world.kingdoms) || []).filter(k => k && k.isAlive !== false).map(k => {
            const reason = Raising._wardBarred(player, world, k);
            return { kingdom: k, ok: !reason, reason, fee: W.fee, rep: Math.round(_num(player.reputation && player.reputation[k.id])) };
        });
    },

    /** A child of a realm's court to send: a real royal child if one is of age, else a noble child. */
    _wardChild(world, k) {
        const W = Raising.config().wards;
        const day = _day(world);
        const royals = ((k.characterData && k.characterData.children) || [])
            .filter(c => c && c.isAlive !== false && _num(c.age) >= W.minAge && _num(c.age) <= W.maxAge && !c.wardAt)
            .sort((a, b) => _num(a.age) - _num(b.age) || String(a.id).localeCompare(String(b.id)));
        if (royals.length) {
            const c = royals[0];
            return { firstName: c.firstName, dynasty: c.dynasty || '', gender: c.gender || 'male', age: _num(c.age), royalId: c.id || null, royal: c };
        }
        const gender = _roll(world, `${k.id}:${day}:g`) < 0.5 ? 'male' : 'female';
        const culture = k.culture || 'Imperial';
        const pools = DataLoader._gamedata && DataLoader._gamedata.characters && DataLoader._gamedata.characters.firstNames;
        const list = (pools && pools[culture] && pools[culture][gender]) || (gender === 'female' ? ['Helena', 'Maud', 'Isolde'] : ['Edmund', 'Osric', 'Aldo']);
        const firstName = list[Math.floor(_roll(world, `${k.id}:${day}:n`) * list.length)];
        const age = W.minAge + Math.floor(_roll(world, `${k.id}:${day}:a`) * (W.maxAge - W.minAge + 1));
        const ruler = k.characterData && k.characterData.ruler;
        return { firstName, dynasty: (ruler && ruler.dynasty) || '', gender, age, royalId: null, royal: null };
    },

    /** Ask a realm to send a child to be raised at the House's court. */
    takeWard(player, world, kid) {
        const W = Raising.config().wards;
        const k = Raising._kingdom(world, kid);
        const barred = Raising._wardBarred(player, world, k);
        if (barred) return { success: false, reason: barred };
        const day = _day(world);
        const c = Raising._wardChild(world, k);
        if (c.royal) c.royal.wardAt = player.house.name || 'a foreign House';
        const ward = {
            id: `ward_${k.id}_${day}`, firstName: c.firstName, dynasty: c.dynasty, gender: c.gender, age: c.age,
            royalId: c.royalId, kingdomId: k.id, kingdomName: k.name, lordName: HeirAgency._lordName(k),
            since: day, until: day + W.years * Raising._daysPerYear(), held: false, repGiven: 0, feesPaid: 0, fateRolls: 0,
        };
        Raising.wards(player).push(ward);
        if (!_obj(player.house.wardLast)) player.house.wardLast = {};
        player.house.wardLast[k.id] = day;
        House._chronicle(player.house, world, `${ward.firstName}${ward.dynasty ? ' ' + ward.dynasty : ''} of ${Names.realm(k.name)}, aged ${ward.age}, comes to be raised at the court of ${player.house.name}.`, ['heirs', 'court']);
        return { success: true, ward };
    },

    /** Send a ward home before their time (in war: a hostage freed, and the realm is grateful). */
    sendWardHome(player, world, wardId) {
        const W = Raising.config().wards;
        const list = Raising.wards(player);
        const ward = list.find(w => w.id === wardId);
        if (!ward) return { success: false, reason: 'No such ward.' };
        const k = Raising._kingdom(world, ward.kingdomId);
        let rep;
        let text;
        if (ward.held) {
            rep = W.warReturnReputation;
            text = `${ward.firstName} is sent home through the lines of war, unransomed. ${ward.kingdomName} will not forget it.`;
            if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'ward_raised', { note: ward.firstName });
        } else {
            rep = W.sendHomeReputation;
            text = `${ward.firstName} is sent home to ${ward.kingdomName} before their time.`;
        }
        Raising._rep(player, ward.kingdomId, rep);
        Raising._wardGone(player, world, ward, ward.held ? 'freed' : 'sent home', text);
        return { success: true, ward, reputation: rep, text };
    },

    _wardGone(player, world, ward, how, text) {
        const W = Raising.config().wards;
        const h = player.house;
        h.wards = Raising.wards(player).filter(w => w !== ward);
        const k = Raising._kingdom(world, ward.kingdomId);
        const royal = ward.royalId && k && k.characterData && (k.characterData.children || []).find(c => c && c.id === ward.royalId);
        if (royal) delete royal.wardAt;
        if (!Array.isArray(h.wardHistory)) h.wardHistory = [];
        h.wardHistory.push({ name: `${ward.firstName}${ward.dynasty ? ' ' + ward.dynasty : ''}`, kingdomId: ward.kingdomId, kingdomName: ward.kingdomName, from: ward.since, to: _day(world), how });
        if (h.wardHistory.length > W.historyCap) h.wardHistory = h.wardHistory.slice(-W.historyCap);
        if (text) House._chronicle(h, world, text, ['heirs', 'court']);
    },

    /** One month of a ward at court. */
    _wardMonth(player, world, ward, out) {
        const W = Raising.config().wards;
        const k = Raising._kingdom(world, ward.kingdomId);
        const day = _day(world);
        if (!k || k.isAlive === false) {
            const text = `${ward.kingdomName} is no more; ${ward.firstName} stays on in your household, a ward of no realm, and leaves to make their own way.`;
            Raising._wardGone(player, world, ward, 'realm fell', text);
            out.notices.push({ icon: '🏚️', title: 'A Ward Without a Realm', text, type: 'info' });
            return;
        }
        const war = CourtLetters.atWar(player, world, k.id);
        if (war && !ward.held) {
            ward.held = true;
            out.notices.push({ icon: '⛓️', title: `${ward.firstName} Is a Hostage`, text: `At war with ${Names.realm(k.name)}, you hold its ward ${ward.firstName}. Send them home through the lines and ${k.name} will be grateful.`, type: 'warning' });
        } else if (!war && ward.held) {
            ward.held = false;
        }
        if (!ward.held) {
            // The fosterage fee, from their treasury into your purse
            const fee = Math.min(W.fee, Math.max(0, Math.floor(_num(k.treasury))));
            if (fee > 0) {
                k.treasury = _num(k.treasury) - fee;
                player.gold = _num(player.gold) + fee;
                Ledger.record(player, 'family', fee);
                ward.feesPaid = _num(ward.feesPaid) + fee;
            }
            if (_num(ward.repGiven) < W.repCap) {
                const n = Math.min(W.repPerMonth, W.repCap - _num(ward.repGiven));
                Raising._rep(player, k.id, n);
                ward.repGiven = _num(ward.repGiven) + n;
            }
        }
        // The House's children raised beside the ward
        const wAge = Raising.wardAge(world, ward);
        for (const c of player.children || []) {
            if (!c || c.isAlive === false || HeirAgency.isAway(c)) continue;
            if (Math.abs(_num(c.age) - wAge) > W.wardmateAgeGap) continue;
            const rec = HeirAgency.ensure(c).record;
            if (!_obj(rec.wardmates)) rec.wardmates = {};
            rec.wardmates[k.id] = Math.min(W.wardmateCap, _num(rec.wardmates[k.id]) + 1);
        }
    },

    _wardYear(player, world, ward, out) {
        const W = Raising.config().wards;
        ward.fateRolls = _num(ward.fateRolls) + 1;
        if (_roll(world, `${ward.id}:fate:${ward.fateRolls}`) >= W.deathChancePerYear) return;
        const k = Raising._kingdom(world, ward.kingdomId);
        Raising._rep(player, ward.kingdomId, W.deathReputation);
        if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'ward_died', { note: ward.firstName });
        const royal = ward.royalId && k && k.characterData && (k.characterData.children || []).find(c => c && c.id === ward.royalId);
        if (royal) royal.isAlive = false;
        const text = `${ward.firstName}, the ward of ${ward.kingdomName}, sickens and dies at your court. ${ward.kingdomName} grieves, and wonders.`;
        Raising._wardGone(player, world, ward, 'died', text);
        out.notices.push({ icon: '🕯️', title: 'A Ward Dies', text, type: 'error' });
    },

    _wardHome(player, world, ward, out) {
        const W = Raising.config().wards;
        const k = Raising._kingdom(world, ward.kingdomId);
        Raising._rep(player, ward.kingdomId, W.returnReputation);
        if (player.house) House.award(player.house, W.returnPrestige, `${ward.firstName} raised at court`, _day(world));
        if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'ward_raised', { note: ward.firstName });
        const text = `${ward.firstName} goes home to ${ward.kingdomName}, raised at the court of ${player.house.name}.`;
        Raising._wardGone(player, world, ward, 'raised', text);
        out.notices.push({ icon: '🎓', title: 'A Ward Goes Home', text: `${text} (+${W.returnReputation} standing, ⭐+${W.returnPrestige})`, type: 'success' });
    },

    // ──────────── COMING OF AGE ────────────

    /** What the childhood made of them. Stored on the record once built. */
    comingOfAgeSummary(player, world, child) {
        if (!child) return null;
        const up = Upbringing.ensure(child);
        const r = Raising.ensure(child);
        if (r.summary) return r.summary;
        if (!up.comeOfAge) return null;
        const cfg = Raising.config();
        const start = r.start || { age: _num(child.age), stats: {}, skills: {} };
        const now = Raising._snap(child);
        const gains = {};
        let total = 0;
        for (const k of STATS) { const d = now.stats[k] - _num(start.stats[k], now.stats[k]); if (d) gains[k] = d; total += Math.max(0, d); }
        for (const k of SKILLS) { const d = now.skills[k] - _num(start.skills[k], now.skills[k]); if (d) gains[k] = d; total += Math.max(0, d); }
        const grades = (cfg.summaryGrades || []).slice().sort((a, b) => b.min - a.min);
        const grade = grades.find(g => total >= _num(g.min)) || { label: 'Raised', icon: '🎓' };
        const focus = Upbringing.focus(up.focus);
        const tutors = Object.entries(r.taught).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, months]) => ({ name, months }));
        const a = HeirAgency.ensure(child);
        const traits = (up.adultTraits || []).filter(id => Traits.TRAITS[id]);
        const wardmates = Object.entries((a.record && a.record.wardmates) || {}).filter(([, m]) => m > 0).map(([kid, months]) => {
            const k = Raising._kingdom(world, kid);
            return { kingdomId: kid, kingdomName: k ? k.name : kid, months };
        });
        const fostered = (a.record.fostered || []).map(f => f.lordName);
        const betrothed = a.betrothal ? a.betrothal.name : (up.spouse && up.spouse.betrothed ? up.spouse.name : null);
        const bond = Math.round(r.bond);
        const parts = [];
        parts.push(`${child.firstName} comes of age ${grade.label.toLowerCase()}${focus ? `, raised in ${focus.name.toLowerCase()} arts` : ''}.`);
        if (traits.length) parts.push(`${child.firstName} is ${traits.map(id => Traits.TRAITS[id].name.toLowerCase()).join(', ')}.`);
        if (tutors.length) parts.push(`Taught by ${tutors.map(t => t.name).join(', ')}.`);
        parts.push(`${r.timeCount ? `You spent ${r.timeCount} day${r.timeCount === 1 ? '' : 's'} together` : 'You spent no days together'}; ${child.gender === 'female' ? 'she' : 'he'} is ${Raising.bondLabel(bond).toLowerCase()} with you.`);
        if (fostered.length) parts.push(`Fostered at the court of ${fostered.join(', ')}.`);
        if (wardmates.length) parts.push(`Grew up beside the ward${wardmates.length === 1 ? '' : 's'} of ${wardmates.map(w => w.kingdomName).join(', ')}.`);
        if (betrothed) parts.push(`Promised to ${betrothed}.`);
        r.summary = {
            day: _day(world), age: _num(child.age), fromAge: _num(start.age), focus: focus ? focus.name : null,
            grade: grade.label, gradeIcon: grade.icon || '🎓', total, gains, tutors, timeCount: r.timeCount, bond,
            bondLabel: Raising.bondLabel(bond), traits, fostered, wardmates, betrothed, text: parts.join(' '),
        };
        return r.summary;
    },

    // ──────────── DAILY ────────────

    /**
     * One day of raising: tutors paid, the bond's drift, the coming-of-age
     * summary, the wards at court. Draws no RNG. Returns { notices }.
     */
    processDay(player, world) {
        const out = { notices: [] };
        if (!player || !world) return out;
        const cfg = Raising.config();
        const ucfg = Upbringing.config();
        const day = _day(world);
        const cadence = ucfg.growthCadence > 0 ? ucfg.growthCadence : 30;
        const monthly = day > 0 && day % cadence === 0;

        for (const child of (player.children || [])) {
            if (!child || child.isAlive === false) continue;
            const up = Upbringing.ensure(child);
            const r = Raising.ensure(child);
            // Where education began: the mark the summary measures from
            if (!r.start && !up.comeOfAge && _num(child.age) >= ucfg.startAge) {
                r.start = { day, age: _num(child.age), ...Raising._snap(child) };
            }
            if (up.comeOfAge) {
                if (!r.summary && up.comeOfAgeDay != null) {
                    const s = Raising.comingOfAgeSummary(player, world, child);
                    if (s) out.notices.push({ icon: s.gradeIcon, title: `${child.firstName} Comes of Age`, text: s.text, type: 'success', childId: child.id });
                }
                continue;
            }
            if (!monthly) continue;
            // The tutor: wages into their purse, or they go
            const t = up.tutor;
            if (t) {
                r.taught[t.name] = _num(r.taught[t.name]) + 1;
                if (t.kind === 'person') Raising._tutorMonth(player, world, child, t, out);
            }
            // A child left alone drifts away (a sibling of the ruler is not theirs to neglect)
            if (_num(child.age) >= cfg.timeMinAge && !child.isSibling) {
                const since = r.lastTime != null ? r.lastTime : r.neglectFrom;
                if (since == null) {
                    r.neglectFrom = day; // the count of neglect begins now
                } else if (day - since > cfg.neglectDays && r.bond > cfg.bondFloor) {
                    const drop = HeirAgency.isAway(child) ? cfg.bondDecayAway : cfg.bondDecayPerMonth;
                    r.bond = Math.max(cfg.bondFloor, Math.round((r.bond - drop) * 10) / 10);
                }
            }
        }

        // The wards at court
        const wards = player.house ? Raising.wards(player) : [];
        const Y = Raising._daysPerYear();
        for (const ward of wards.slice()) {
            const since = day - _num(ward.since);
            if (since <= 0) continue;
            if (since % cadence === 0) Raising._wardMonth(player, world, ward, out);
            if (!Raising.wards(player).includes(ward)) continue;
            if (since % Y === 0) Raising._wardYear(player, world, ward, out);
            if (!Raising.wards(player).includes(ward)) continue;
            if (day >= _num(ward.until) && !ward.held) Raising._wardHome(player, world, ward, out);
        }
        return out;
    },

    _tutorMonth(player, world, child, t, out) {
        const npc = Relationships.getNPC(t.npcId);
        let leave = null;
        if (!npc || npc.isAlive === false) leave = `${t.name} is gone, and ${child.firstName}'s lessons with them.`;
        else if ((player.travelParty || []).includes(npc.id)) leave = null;
        else if (Raising._tutorBarred(player, npc)) leave = `${t.name} can no longer teach ${child.firstName}.`;
        if (!leave && npc) {
            if (_num(player.gold) >= t.wage) {
                Raising._pay(player, npc, t.wage);
                t.paidMonths = _num(t.paidMonths) + 1;
            } else {
                leave = `Unpaid, ${t.name} stops teaching ${child.firstName}.`;
            }
        }
        if (leave) {
            Upbringing.ensure(child).tutor = null;
            out.notices.push({ icon: '👨‍🏫', title: 'Tutor Gone', text: leave, type: 'warning' });
        }
    },

    // ──────────── SUCCESSION ────────────

    /**
     * The heir takes up the mantle (Relationships.succeedAsHeir): their
     * coming-of-age summary goes with them as the ruler's education.
     */
    onSuccession(player, world, child) {
        if (!player || !child) return null;
        const up = Upbringing.ensure(child);
        if (!up.comeOfAge) return null;
        const s = Raising.comingOfAgeSummary(player, world, child);
        if (s) player.upbringingRecord = { ...s, name: child.firstName };
        return s;
    },
};
