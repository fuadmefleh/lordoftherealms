// ============================================
// THE HOUSE'S COURT — retainers and courtiers who are not of the blood
// ============================================
// People the player knows (Relationships NPCs) can be invited to live at the
// House's court. Whether they come depends on how they feel about you, the
// House's Prestige and rank, their traits, whether they are bound elsewhere
// (governing a holding, a royal of another realm, wed into another House)
// and the stipend you offer. A courtier:
//   - lives at court: off their town's streets and out of "Meet People"
//     (npc.atCourt; a bridged townsperson is away "at the court of …"), but
//     keeps their name, kin and history;
//   - is paid a daily stipend from the player's purse into their own
//     (npc.purse; Ledger 'courtStipends'), with a welcome purse on joining.
//     When they leave, their savings go home with them (a townsperson's purse);
//   - has skills (commerce, combat, diplomacy, stealth, leadership — the
//     children's keys and scale) worked out once from occupation and traits
//     plus a hashed jitter, stored on the NPC;
//   - can hold a House office (House.assignRole — any but the heir's) and
//     the regency (Regency.candidates, kind 'courtier'), or be named
//     regent-designate (Regency.designate);
//   - has loyalty (0–100) that settles weekly toward what the House offers:
//     Prestige, the stipend against what they think they are worth, your
//     friendship, an office (an ambitious one passed over sours). Unpaid,
//     they sour by the day; a disloyal officer skims; a courtier at the
//     bottom of their loyalty, long unpaid or lured by a better offer leaves.
//
// The court's size is capped by Prestige and rank (capacity).
// State: player.house.court = [{ npcId, since, stipend, loyalty, … }] (saved
// with the House), skills / purse / atCourt on the NPC (saved with
// player._relationshipNpcs). The weekly drift draws from its own seeded
// stream (world seed + day); the invitation's answer from the shared RNG,
// as the travel-party request does. Tunables: data/house.json → court.
// No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Ledger } from './ledger.js';
import { House } from './house.js';
import { Relationships } from './relationships.js';
import { Townsfolk } from './townsfolk.js';

const SKILLS = ['commerce', 'combat', 'diplomacy', 'stealth', 'leadership'];

const DEFAULTS = {
    baseSeats: 2, prestigePerSeat: 40, seatsPerTitleRank: 1, rulerSeats: 3, lordSeats: 2, maxSeats: 12,
    minAge: 16, minScore: 0, refuseCooldown: 30, joinDays: 7,
    baseChance: 0.15, scoreWeight: 0.006, loyaltyWeight: 0.005,
    prestigeWeight: 0.002, prestigeChanceCap: 0.25, titleRankWeight: 0.04, rulerChance: 0.15,
    stipendWeight: 0.35, stipendChanceMin: -0.45, stipendChanceMax: 0.3,
    minChance: 0.03, maxChance: 0.95,
    traitChance: { loyal: 0.08, adventurous: 0.05, ambitious: 0.06, homebody: -0.15, fickle: -0.05, serious: 0.02 },
    occupationStipend: { default: 3 },
    greedyStipend: 1.3, ambitiousStipend: 1.15,
    baseLoyalty: 55, cadence: 7, drift: 3, prestigeLoyalty: 0.05, prestigeLoyaltyCap: 20,
    stipendLoyalty: 20, scoreLoyalty: 0.15, officeLoyalty: 6,
    passedOverDays: 90, passedOverLoyalty: -10,
    traitLoyalty: { loyal: 8, fickle: -6, ambitious: -4, honest: 2, greedy: -2 },
    unpaidLoyalty: 3, unpaidLeaveDays: 10,
    leaveBelow: 15, leaveChance: 0.35, offerBelow: 40, offerChance: 0.04,
    embezzleBelow: 30, embezzleRate: 0.02, embezzleMax: 60,
    raiseLoyaltyPerGold: 3, raiseLoyaltyCap: 15, cutLoyaltyPerGold: 5,
    dismissScore: -5, skillCap: 8, jitterMin: -1, jitterMax: 2,
    occupationSkills: { default: { commerce: 1, diplomacy: 1 } },
    traitSkills: {},
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _hash01 = (key) => ((Utils.hashStr(String(key)) >>> 0) % 10000) / 10000;
const _has = (npc, t) => (npc && npc.traits || []).some(x => (x && x.id ? x.id : x) === t);
const _name = (npc) => (npc ? `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}` : 'someone');

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

export const Court = {
    SKILLS,

    /** Tunables: the defaults, data/house.json → court over them, then a runtime DataLoader.house.court. */
    config() {
        const gd = DataLoader._gamedata;
        const d = _obj(gd && gd.house && gd.house.court) || {};
        const o = _obj(DataLoader.house && DataLoader.house.court) || {};
        const merged = { ...DEFAULTS, ...d, ...o };
        for (const k of ['traitChance', 'occupationStipend', 'traitLoyalty', 'occupationSkills', 'traitSkills']) {
            merged[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}), ...(_obj(o[k]) || {}) };
        }
        return merged;
    },

    // ──────────── MEMBERSHIP ────────────

    /** The court's roll on the House (created when missing). */
    ensure(player) {
        const house = player && player.house;
        if (!house) return [];
        if (!Array.isArray(house.court)) house.court = [];
        if (house.regentDesignate === undefined) house.regentDesignate = null;
        return house.court;
    },

    /** One member's entry on the roll, or null. */
    entry(player, npcId) {
        const house = player && player.house;
        if (!house || !Array.isArray(house.court) || !npcId) return null;
        return house.court.find(e => e && e.npcId === npcId) || null;
    },

    isMember(player, npcId) {
        return !!Court.entry(player, npcId);
    },

    /** The NPC behind an id (the live registry first, then the player's saved copy). */
    _npc(player, npcId) {
        return Relationships.getNPC(npcId)
            || ((player && player._relationshipNpcs) || []).find(n => n && n.id === npcId) || null;
    },

    /** The living courtiers, as NPC objects. */
    members(player) {
        const out = [];
        for (const e of (player && player.house && player.house.court) || []) {
            const npc = Court._npc(player, e.npcId);
            if (npc && npc.isAlive !== false) out.push(npc);
        }
        return out;
    },

    /** A living courtier by id, or null. */
    member(player, npcId) {
        if (!Court.isMember(player, npcId)) return null;
        const npc = Court._npc(player, npcId);
        return npc && npc.isAlive !== false ? npc : null;
    },

    /** How many may live at court: Prestige and rank. */
    capacity(player) {
        const cfg = Court.config();
        const prestige = _num(player && player.house && player.house.prestige);
        const defs = (DataLoader.titles && DataLoader.titles.titles) || {};
        const rank = player && player.currentTitle && defs[player.currentTitle] ? _num(defs[player.currentTitle].rank) : 0;
        const ruler = !!(player && player.throne && player.throne.ruling);
        // A lordly title (a great lord's 'Duke of Irongate', a baron's...) keeps a lord's household
        const lordly = !!(player && typeof player.title === 'string'
            && /^(Lord|Lady|Duke|Duchess|Count|Countess|Earl|Baron|Baroness|Marquess|Marchioness|Prince|Princess|King|Queen)\b/.test(player.title.trim()));
        const seats = cfg.baseSeats + Math.floor(prestige / Math.max(1, cfg.prestigePerSeat))
            + rank * cfg.seatsPerTitleRank + (ruler ? cfg.rulerSeats : 0) + (lordly ? _num(cfg.lordSeats, 2) : 0);
        return Utils.clamp(Math.floor(seats), 1, cfg.maxSeats);
    },

    /** The House office a courtier holds, or null. */
    officeOf(player, npcId) {
        const roles = player && player.house && player.house.roles;
        if (!roles) return null;
        return House.ROLE_IDS.find(r => roles[r] === npcId) || null;
    },

    // ──────────── SKILLS ────────────

    /**
     * A courtier's skills, worked out once from occupation and traits and a
     * little of their own (a hash of who they are), and kept on the NPC.
     */
    ensureSkills(npc) {
        if (!npc) return null;
        if (_obj(npc.skills) && SKILLS.every(k => Number.isFinite(npc.skills[k]))) return npc.skills;
        const cfg = Court.config();
        const occ = String(npc.occupation || '').toLowerCase();
        const base = _obj(cfg.occupationSkills[occ]) || _obj(cfg.occupationSkills.default) || {};
        const skills = { ...(_obj(npc.skills) || {}) };
        for (const k of SKILLS) {
            if (Number.isFinite(skills[k])) continue;
            let v = _num(base[k]);
            for (const t of npc.traits || []) {
                const ts = _obj(cfg.traitSkills[t && t.id ? t.id : t]);
                if (ts) v += _num(ts[k]);
            }
            // Age and experience: the older a little more leadership
            if (k === 'leadership' && _num(npc.age) >= 35) v += 1;
            const span = cfg.jitterMax - cfg.jitterMin + 1;
            v += cfg.jitterMin + Math.floor(_hash01(`court:${npc.id}:${k}`) * span);
            skills[k] = Utils.clamp(Math.round(v), 0, cfg.skillCap);
        }
        npc.skills = skills;
        return skills;
    },

    // ──────────── THE INVITATION ────────────

    /** The stipend they would think fair, gold a day (occupation; the greedy and ambitious want more). */
    expectedStipend(npc) {
        const cfg = Court.config();
        const occ = String((npc && npc.occupation) || '').toLowerCase();
        let s = _num(cfg.occupationStipend[occ], _num(cfg.occupationStipend.default, 3));
        if (_has(npc, 'greedy')) s *= cfg.greedyStipend;
        if (_has(npc, 'ambitious')) s *= cfg.ambitiousStipend;
        return Math.max(1, Math.round(s));
    },

    /** Why they cannot be asked at all, or null. */
    _barred(player, world, npc) {
        const cfg = Court.config();
        if (!player || !player.house) return 'You have no House to keep a court.';
        if (!npc || npc.isAlive === false) return 'They are not available.';
        const first = npc.firstName || 'They';
        if (Court.isMember(player, npc.id)) return `${first} already serves at your court.`;
        if (player.spouse === npc.id) return `${first} is your spouse, already of your household.`;
        if (!(player.relationships && player.relationships[npc.id])) return 'You need to meet this person first.';
        if (_num(npc.age, 18) < cfg.minAge) return `${first} is too young to serve at court.`;
        if (npc.governing) return `${first} is governing one of your holdings.`;
        if (npc.companion && npc.companion.leftHow === 'betrayed') return `${first} betrayed you once; you will not have them at court.`;
        if (npc.royal && npc.royal.kingdomId) return `${first} is of the royal blood of another realm and keeps its court.`;
        if (npc.rivalHouse || npc.courtOf) return `${first} is bound to another House.`;
        // Wed to someone else's House: a noble spouse of another family
        if (npc.marriedTo && npc.noble) return `${first} is wed into another House and keeps to it.`;
        if (Court.members(player).length >= Court.capacity(player)) {
            return `Your court is full (${Court.capacity(player)} seats). More Prestige or a higher rank makes room.`;
        }
        return null;
    },

    /**
     * The odds an invitation at this stipend is taken, and why — no dice.
     * { ok, chance, reason, expected, joinCost, parts:[{ label, value }] }
     */
    inviteOdds(player, world, npcId, stipend = null) {
        const cfg = Court.config();
        const npc = Court._npc(player, npcId);
        const barred = Court._barred(player, world, npc);
        const expected = npc ? Court.expectedStipend(npc) : 0;
        const pay = Math.max(0, Math.round(stipend != null ? _num(stipend) : expected));
        const joinCost = pay * cfg.joinDays;
        if (barred) return { ok: false, chance: 0, reason: barred, expected, stipend: pay, joinCost, parts: [] };
        const rel = player.relationships[npc.id] || {};
        if (_num(rel.score) < cfg.minScore) {
            return { ok: false, chance: 0, reason: `${npc.firstName} does not think well enough of you to serve you.`, expected, stipend: pay, joinCost, parts: [] };
        }
        const refused = npc.courtRefused;
        if (refused && _day(world) - _num(refused.day) < cfg.refuseCooldown && pay <= _num(refused.stipend)) {
            return { ok: false, chance: 0, reason: `${npc.firstName} gave you an answer lately. Ask again in time, or offer more.`, expected, stipend: pay, joinCost, parts: [] };
        }
        const parts = [];
        const add = (label, v) => { if (v) parts.push({ label, value: v }); };
        add('Base', cfg.baseChance);
        add('Your friendship', _num(rel.score) * cfg.scoreWeight);
        add('Their loyalty to you', (_num(npc.loyalty, 50) - 50) * cfg.loyaltyWeight);
        add('House Prestige', Math.min(cfg.prestigeChanceCap, _num(player.house.prestige) * cfg.prestigeWeight));
        const defs = (DataLoader.titles && DataLoader.titles.titles) || {};
        const rank = player.currentTitle && defs[player.currentTitle] ? _num(defs[player.currentTitle].rank) : 0;
        add('Your rank', rank * cfg.titleRankWeight);
        if (player.throne && player.throne.ruling) add('A royal court', cfg.rulerChance);
        const ratio = expected > 0 ? pay / expected : 1;
        add('The stipend', Utils.clamp((ratio - 1) * cfg.stipendWeight * (_has(npc, 'greedy') ? 1.5 : 1), cfg.stipendChanceMin, cfg.stipendChanceMax));
        for (const [t, v] of Object.entries(cfg.traitChance)) if (_has(npc, t)) add(`${t[0].toUpperCase()}${t.slice(1)}`, _num(v));
        const chance = Utils.clamp(parts.reduce((s, p) => s + p.value, 0), cfg.minChance, cfg.maxChance);
        return { ok: true, chance, reason: null, expected, stipend: pay, joinCost, parts };
    },

    /**
     * Invite someone you know to join the court at a daily stipend. The
     * welcome purse (stipend × joinDays) is paid when they accept.
     * { success, accepted, npc, chance, roll, reason }
     */
    invite(player, world, npcId, opts = {}) {
        const odds = Court.inviteOdds(player, world, npcId, opts.stipend);
        if (!odds.ok) return { success: false, reason: odds.reason };
        const npc = Court._npc(player, npcId);
        if (_num(player.gold) < odds.joinCost) return { success: false, reason: `You need ${odds.joinCost} gold for their welcome purse.` };
        const rel = Relationships.getRelationship(player, npcId);
        const day = _day(world);
        const roll = Utils.random();
        if (roll < odds.chance) {
            const res = Court.join(player, world, npcId, { stipend: odds.stipend });
            if (!res.success) return res;
            rel.score = Math.min(100, _num(rel.score) + 3);
            if (Array.isArray(rel.history)) rel.history.push({ day, action: 'join_court', result: 'accepted' });
            return { success: true, accepted: true, npc, chance: odds.chance, roll, member: res.member,
                reason: `${npc.firstName} accepts a place at your court for ${odds.stipend} gold a day.` };
        }
        npc.courtRefused = { day, stipend: odds.stipend };
        if (Array.isArray(rel.history)) rel.history.push({ day, action: 'join_court', result: 'rejected' });
        const why = odds.stipend < odds.expected ? 'The stipend is beneath them.' : _has(npc, 'homebody') ? 'They would rather keep to their own hearth.' : 'They are not ready to leave the life they have.';
        return { success: true, accepted: false, npc, chance: odds.chance, roll, reason: `${npc.firstName} declines. ${why}` };
    },

    /**
     * Add someone to the court with no acceptance roll (game-start seeding, an
     * accepted invitation). opts: { stipend, loyalty, free (no welcome purse) }.
     * { success, member, npc } | { success:false, reason }
     */
    join(player, world, npcId, opts = {}) {
        const cfg = Court.config();
        if (!player || !player.house) return { success: false, reason: 'No House.' };
        const npc = Court._npc(player, npcId);
        if (!npc || npc.isAlive === false) return { success: false, reason: 'They are not available.' };
        const court = Court.ensure(player);
        const had = Court.entry(player, npcId);
        if (had) return { success: true, member: had, npc };
        const stipend = Math.max(0, Math.round(opts.stipend != null ? _num(opts.stipend) : Court.expectedStipend(npc)));
        const day = _day(world);
        if (!opts.free) {
            const purse = stipend * cfg.joinDays;
            if (_num(player.gold) < purse) return { success: false, reason: `You need ${purse} gold for their welcome purse.` };
            if (purse > 0) Court._pay(player, npc, purse);
        }
        const member = {
            npcId, since: day, stipend,
            loyalty: Utils.clamp(Math.round(opts.loyalty != null ? _num(opts.loyalty) : cfg.baseLoyalty), 0, 100),
            owed: 0, unpaidDays: 0, embezzled: 0, skimMonth: 0, officeSince: null,
        };
        court.push(member);
        Court.ensureSkills(npc);
        Court._settle(player, world, npc, true);
        npc.courtRefused = null;
        House._chronicle(player.house, world, `${_name(npc)}, ${npc.occupation || 'a commoner'}, joins the court of ${player.house.name}.`, ['court']);
        return { success: true, member, npc };
    },

    /** Gold from the player's purse into the courtier's own. */
    _pay(player, npc, amount, category = 'courtStipends') {
        const a = Math.max(0, Math.round(amount));
        if (!a) return 0;
        player.gold = _num(player.gold) - a;
        npc.purse = _num(npc.purse) + a;
        Ledger.record(player, category, -a);
        return a;
    },

    /** Move a courtier to court (or home again): off the streets, out of the travel party. */
    _settle(player, world, npc, toCourt) {
        const day = _day(world);
        const found = npc.folkUid && world ? Relationships.folkPerson(world, npc.folkUid) : null;
        if (toCourt) {
            npc.atCourt = (player.house && player.house.id) || true;
            if (Array.isArray(player.travelParty) && player.travelParty.includes(npc.id)) {
                Relationships.removeFromTravelParty(player, npc.id);
            }
            if (found && found.p && found.p.died == null) {
                found.p.away = { d: day, to: `the court of ${player.house ? player.house.name : 'a great House'}`, withPlayer: 'court' };
            }
        } else {
            npc.atCourt = null;
            if (found && found.p) {
                const p = found.p;
                // Their savings go home with them
                if (_num(npc.purse) > 0 && p.died == null) {
                    Townsfolk.purse(found.folk, p, world);
                    p.purse = _num(p.purse) + _num(npc.purse);
                    npc.purse = 0;
                }
                if (p.away && p.away.withPlayer === 'court') p.away = null;
            }
        }
    },

    /**
     * Take someone off the roll: offices vacated, the regent-designation
     * dropped, home again. how: 'dismissed' | 'left' | 'died'.
     */
    _remove(player, world, npcId, how = 'left') {
        const house = player && player.house;
        if (!house || !Array.isArray(house.court)) return null;
        const idx = house.court.findIndex(e => e && e.npcId === npcId);
        if (idx < 0) return null;
        const [entry] = house.court.splice(idx, 1);
        for (const r of House.ROLE_IDS) if (house.roles && house.roles[r] === npcId) house.roles[r] = null;
        if (house.regentDesignate === npcId) house.regentDesignate = null;
        const npc = Court._npc(player, npcId);
        if (npc && how !== 'died') Court._settle(player, world, npc, false);
        else if (npc) npc.atCourt = null;
        return { entry, npc };
    },

    /** Send a courtier away. Arrears are paid first if the purse allows. */
    dismiss(player, world, npcId) {
        const cfg = Court.config();
        const entry = Court.entry(player, npcId);
        if (!entry) return { success: false, reason: 'They do not serve at your court.' };
        const npc = Court._npc(player, npcId);
        if (player.regency && player.regency.active && player.regency.regent && player.regency.regent.id === npcId) {
            return { success: false, reason: `${npc ? npc.firstName : 'They'} rules as your regent. Put the regent aside first.` };
        }
        let paid = 0;
        if (entry.owed > 0 && npc && _num(player.gold) >= entry.owed) paid = Court._pay(player, npc, entry.owed);
        Court._remove(player, world, npcId, 'dismissed');
        if (npc && player.relationships && player.relationships[npcId]) {
            const rel = player.relationships[npcId];
            rel.score = Utils.clamp(_num(rel.score) + cfg.dismissScore - (entry.owed > paid ? 5 : 0), -100, 100);
        }
        if (player.house) House._chronicle(player.house, world, `${_name(npc)} is dismissed from the court of ${player.house.name}.`, ['court']);
        return { success: true, npc, paid, text: `${npc ? npc.firstName : 'They'} leaves your court${paid ? `, paid the ${paid} gold owed` : ''}.` };
    },

    /** Change a courtier's stipend: a raise warms them, a cut sours them. */
    setStipend(player, npcId, stipend) {
        const cfg = Court.config();
        const entry = Court.entry(player, npcId);
        if (!entry) return { success: false, reason: 'They do not serve at your court.' };
        const next = Math.max(0, Math.round(_num(stipend)));
        const diff = next - entry.stipend;
        if (!diff) return { success: true, stipend: next, loyalty: entry.loyalty };
        const delta = diff > 0 ? Math.min(cfg.raiseLoyaltyCap, diff * cfg.raiseLoyaltyPerGold) : diff * cfg.cutLoyaltyPerGold;
        entry.stipend = next;
        entry.loyalty = Utils.clamp(Math.round(entry.loyalty + delta), 0, 100);
        return { success: true, stipend: next, loyalty: entry.loyalty, delta };
    },

    /** Per-day running cost of the court. */
    dailyCost(player) {
        return ((player && player.house && player.house.court) || []).reduce((s, e) => s + _num(e.stipend), 0);
    },

    // ──────────── THE DAY ────────────

    /**
     * A day at court (from House.processDaily): stipends paid or owed, the
     * dead taken off the roll; weekly, loyalty settles, a disloyal officer
     * skims, the faithless leave. Returns { notices: [{ icon, title, text, type }] }.
     */
    processDay(player, world) {
        const out = { notices: [] };
        const house = player && player.house;
        if (!house || !Array.isArray(house.court) || !house.court.length) return out;
        const cfg = Court.config();
        const day = _day(world);

        for (const e of [...house.court]) {
            const npc = Court._npc(player, e.npcId);
            if (!npc || npc.isAlive === false) {
                Court._remove(player, world, e.npcId, 'died');
                if (npc) {
                    House._chronicle(house, world, `${_name(npc)} of the court of ${house.name} dies.`, ['court']);
                    out.notices.push({ icon: '🕯️', title: 'A Death at Court', text: `${_name(npc)}, who served at your court, has died.`, type: 'warning' });
                }
                continue;
            }
            // The stipend: today's, and what is owed, if the purse allows
            const due = _num(e.stipend) + _num(e.owed);
            if (due <= 0) continue;
            if (_num(player.gold) >= due) {
                Court._pay(player, npc, due);
                e.owed = 0;
                e.unpaidDays = 0;
            } else {
                const part = Math.max(0, Math.floor(_num(player.gold)));
                if (part > 0) Court._pay(player, npc, part);
                e.owed = due - part;
                e.unpaidDays = _num(e.unpaidDays) + 1;
                e.loyalty = Utils.clamp(e.loyalty - cfg.unpaidLoyalty, 0, 100);
                if (e.unpaidDays === 1) {
                    out.notices.push({ icon: '💸', title: 'A Stipend Unpaid', text: `${npc.firstName} goes unpaid at your court (owed ${Math.round(e.owed)} gold).`, type: 'warning' });
                }
                if (e.unpaidDays >= cfg.unpaidLeaveDays && !Court._isRegent(player, npc.id)) {
                    Court._leave(player, world, npc, e, `${npc.firstName} will not serve for nothing, and leaves your court owed ${Math.round(e.owed)} gold.`, out);
                }
            }
        }

        const cad = Math.max(1, cfg.cadence);
        if (day % cad !== 0) return out;
        const rng = Utils.seededRandom(((Utils.hashStr(`${_seed(world)}|court|${day}`) >>> 0) % 233279) + 1);
        Utils.withRng(rng, () => Court._week(player, world, out));
        return out;
    },

    _isRegent(player, npcId) {
        const st = player && player.regency;
        return !!(st && st.active && st.regent && st.regent.id === npcId);
    },

    /** Where a courtier's loyalty settles. */
    loyaltyTarget(player, npc, e) {
        const cfg = Court.config();
        const house = player.house;
        let t = cfg.baseLoyalty;
        t += Math.min(cfg.prestigeLoyaltyCap, _num(house.prestige) * cfg.prestigeLoyalty);
        const expected = Court.expectedStipend(npc);
        t += Utils.clamp((_num(e.stipend) / Math.max(1, expected) - 1) * cfg.stipendLoyalty, -cfg.stipendLoyalty, cfg.stipendLoyalty);
        const rel = player.relationships && player.relationships[npc.id];
        t += _num(rel && rel.score) * cfg.scoreLoyalty;
        if (Court.officeOf(player, npc.id)) t += cfg.officeLoyalty;
        for (const [trait, v] of Object.entries(cfg.traitLoyalty)) if (_has(npc, trait)) t += _num(v);
        return Utils.clamp(t, 0, 100);
    },

    _week(player, world, out) {
        const cfg = Court.config();
        const house = player.house;
        const day = _day(world);
        for (const e of [...house.court]) {
            const npc = Court._npc(player, e.npcId);
            if (!npc || npc.isAlive === false) continue;
            const office = Court.officeOf(player, npc.id);
            if (office && e.officeSince == null) e.officeSince = day;
            if (!office) e.officeSince = null;
            let target = Court.loyaltyTarget(player, npc, e);
            // An ambitious courtier long without an office feels passed over
            const passedOver = !office && _has(npc, 'ambitious') && day - _num(e.since) >= cfg.passedOverDays;
            if (passedOver) target = Utils.clamp(target + cfg.passedOverLoyalty, 0, 100);
            const diff = target - e.loyalty;
            e.loyalty = Utils.clamp(Math.round(e.loyalty + Math.sign(diff) * Math.min(Math.abs(diff), cfg.drift) + Utils.randInt(-1, 1)), 0, 100);

            // A disloyal officer's hand in the coffers
            if (office && e.loyalty < cfg.embezzleBelow && _num(player.gold) > 0) {
                const share = cfg.embezzleRate * (cfg.embezzleBelow - e.loyalty) / cfg.embezzleBelow;
                const amt = Math.min(cfg.embezzleMax, Math.floor(_num(player.gold) * share));
                if (amt > 0) {
                    Court._pay(player, npc, amt, 'courtEmbezzled');
                    e.embezzled = _num(e.embezzled) + amt;
                    e.skimMonth = _num(e.skimMonth) + amt;
                }
            }
            if (_num(e.skimMonth) > 0 && day % 30 < cfg.cadence) {
                out.notices.push({ icon: '🧾', title: 'The Accounts Are Short', text: `${e.skimMonth} gold is missing this month. ${npc.firstName}, your ${House.roleDefs()[office] ? House.roleDefs()[office].label : 'officer'}, keeps those books.`, type: 'warning' });
                e.skimMonth = 0;
            }

            if (Court._isRegent(player, npc.id)) continue;
            // The faithless leave; the half-hearted may be lured away
            if (e.loyalty < cfg.leaveBelow && Utils.random() < cfg.leaveChance) {
                Court._leave(player, world, npc, e, `${npc.firstName} has had enough of your court and leaves${e.embezzled ? `, with ${e.embezzled} gold that was never theirs` : ''}.`, out);
            } else if (e.loyalty < cfg.offerBelow && Utils.random() < cfg.offerChance) {
                Court._leave(player, world, npc, e, `${npc.firstName} takes a better offer elsewhere and leaves your court.`, out);
            } else if (passedOver && e.loyalty < cfg.offerBelow && Utils.random() < cfg.offerChance * 2) {
                Court._leave(player, world, npc, e, `${npc.firstName}, passed over for every office, leaves your court to seek advancement elsewhere.`, out);
            }
        }
    },

    _leave(player, world, npc, e, text, out) {
        if (!Court.isMember(player, npc.id)) return;
        Court._remove(player, world, npc.id, 'left');
        if (player.house) House._chronicle(player.house, world, `${_name(npc)} leaves the court of ${player.house.name}.`, ['court']);
        out.notices.push({ icon: '🚪', title: 'A Courtier Leaves', text, type: 'warning' });
    },

    // ──────────── VIEW ────────────

    /** Rows for the House panel's Court view. */
    view(player) {
        return Court.members(player).map(npc => {
            const e = Court.entry(player, npc.id);
            return {
                npc, id: npc.id, name: _name(npc), occupation: npc.occupation || 'commoner', age: npc.age,
                skills: Court.ensureSkills(npc), loyalty: e.loyalty, stipend: e.stipend, owed: Math.round(_num(e.owed)),
                since: e.since, office: Court.officeOf(player, npc.id), expected: Court.expectedStipend(npc),
                regentDesignate: !!(player.house && player.house.regentDesignate === npc.id),
                purse: Math.round(_num(npc.purse)),
            };
        });
    },

    /** People you know who might be asked to court, best friends first. */
    prospects(player, world) {
        const out = [];
        for (const [npcId, rel] of Object.entries((player && player.relationships) || {})) {
            const npc = Court._npc(player, npcId);
            if (!npc || npc.isAlive === false || Court.isMember(player, npcId) || player.spouse === npcId) continue;
            out.push({ npc, rel, odds: Court.inviteOdds(player, world, npcId) });
        }
        out.sort((a, b) => _num(b.rel.score) - _num(a.rel.score));
        return out;
    },

    // ──────────── SAVE ────────────

    /** Backfill a loaded House's court (older saves have none). */
    loadState(player) {
        const court = Court.ensure(player);
        if (!player || !player.house) return;
        player.house.court = court.filter(e => e && e.npcId).map(e => ({
            owed: 0, unpaidDays: 0, embezzled: 0, skimMonth: 0, officeSince: null,
            ...e,
            since: _num(e.since), stipend: Math.max(0, _num(e.stipend)), loyalty: Utils.clamp(_num(e.loyalty, 55), 0, 100),
        }));
    },
};
