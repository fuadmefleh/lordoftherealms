// ============================================
// CROWN SUCCESSION — the war for your own crown when the seat passes
// ============================================
// The AI realms have their succession crises (systems/throne.js). This is the
// player's own: when the player rules a realm and the seat passes — a death,
// an abdication, the return from an interregnum — the heir the player goes on
// as must hold the crown against those who would take it.
//
//   CLAIMANTS   younger sons and daughters of the late ruler (and uncles of
//               the heir), heads of cadet branches gone cold, the late royal
//               consort's kin of another realm (they want the regency of a
//               child heir), and the old royal line of a realm the House took
//               rather than founded. Each has a STRENGTH, the sum of named
//               parts (data/crownSuccession.json → claimants).
//   STANDING    the heir's: named in life, crowned in life, the lords' oaths
//               sworn to them, of age or a child (and the regent's loyalty),
//               the House's Prestige, the late reign's length, the realm's
//               stability and the lords' mood, the heir's own name, the
//               succession secured with Prestige or disputed (House), an
//               abdication blessed or one that passed the rightful heir over,
//               and the years an interregnum left the throne empty.
//   RISING      a claimant rises with chance (strength − standing + 20) / 80
//               (at most 90%), from this system's own seeded stream. The
//               strongest who rises leads; the others stand with him.
//   THE LORDS   every vassal of the royal court (systems/kingship.js) leans:
//               his opinion of the crown, the claimant's edge, his ambition,
//               an oath to the heir (weighed by his honour), kinship, a council
//               seat, his own temper (a fixed hash). Those who lean over back
//               the claimant; the power they hold is his support, the rest
//               and the royal host the crown's. Too few (under 15% of the lords'
//               power) and he stands down.
//   THE WAR     a succession revolt on the Kingship revolt machinery: his
//               lords' seats withhold their levies, rebel hosts march, the royal
//               host meets them in the field, rebel seats can be besieged, a
//               parley buys him off. A foreign realm behind him (the consort's
//               kin; a realm hostile to yours behind the old line) sends men.
//               Crushed, his lords are broken and he is exiled or cloistered.
//               Lost (momentum −100 or the time run out behind), the REALM
//               SPLITS: his seats become a kingdom of his own — a rival with a
//               claim on your crown, which goes to war to take the rest when its
//               truce runs out and its host is strong enough, and on which your
//               heir holds a blood claim (press it: Claims & Crowns). His hosts
//               take the capital, and the CROWN ITSELF passes to him.
//   PREPARATION in life, on the Royal Court's Succession tab: name the heir,
//               crown them in your lifetime, take the lords' oaths to them, give
//               younger children portions (bought off), send one into holy
//               orders, marry daughters abroad (systems/heirs.js), land sons as
//               cadet branches (systems/cadetBranches.js), and quiet the old
//               line (a pension, a cloister, a marriage into it). Every factor
//               shows its weight there before the day comes.
//   REGENCY     a child heir stands weaker; a loyal regent steadies them, a
//               disloyal one does not; the consort's kin rise against a
//               regency not theirs. The war is fought under the regent's rule
//               (no siege may be laid: Regency.forbids).
//   INTERREGNUM nothing runs while the House waits in trust (player.interregnum:
//               player-held); on the return every year of the empty throne
//               weighs against the heir, and after five a claimant who rises
//               has already taken the crown.
//
// Hooks: Relationships.succeedAsHeir calls capture() before the seat changes
// hands and onSuccession() after; Kingship._endRevolt calls warEnded() for a
// succession revolt. The world day calls processDay(world, player) (the
// breakaway realms' wars to reunite). State on player.crownSuccession (saved);
// oaths ride on the court's vassals (v.heirOath), a child's vows and portion
// on the child (child.crownSuccession, child.purse). Draws only from its own
// streams (world seed + day + key); nothing runs unless the player rules.
// Tunables in data/crownSuccession.json. No import-time side effects.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Names } from '../core/names.js';
import { Interrupts } from '../core/interrupts.js';
import { Kingdom } from '../world/kingdom.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { NPCLords } from '../world/npcLords.js';
import { Characters } from '../world/characters.js';
import { Economy } from '../world/economy.js';
import { House } from './house.js';
import { Throne } from './throne.js';
import { Kingship } from './kingship.js';
import { Relationships } from './relationships.js';
import { CadetBranches } from './cadetBranches.js';
import { Inheritance } from './inheritance.js';
import { Ledger } from './ledger.js';
import { LlmProse } from './llmProse.js';
import { HighCrowns } from './highCrowns.js';
import { NamedLegacy } from './namedLegacy.js';

const DEFAULTS = {
    riseBase: 20, riseDivisor: 80, riseMax: 0.9, minLordShare: 0.15,
    claimants: {
        brother: { son: 30, daughter: 14, uncleMult: 0.6, elder: 18, ambitious: 10, turned: 15, passedOver: 25, wedToLord: 10, aggrieved: 15, grudge: 8, boughtOffGold: 1000, boughtOffCut: 0.7 },
        cadet: { base: 6, perLoyaltyBelow50: 0.6, estranged: 15, loyalAbove: 60 },
        spouseKin: { regencyDenied: 28, adult: 6, hostileRealm: 12, hostileBelow: 0, widowedMult: 0.6 },
        pretender: { base: 38, decayPerYear: 0.8, quietMult: 0.4 },
    },
    standing: {
        designated: 12, crowned: 28, oathMax: 24, minor: -18, regentLoyal: 6, regentLoyalAt: 60, regentDisloyal: -10, regentDisloyalBelow: 40,
        prestigePer: 25, prestigeCap: 12, reignPerYear: 0.5, reignCap: 10, stabilityPivot: 50, stabilityWeight: 0.3, opinionWeight: 0.2,
        heirSkillWeight: 0.8, heirSkillCap: 8, secured: 10, disputed: -10, abdicationBlessed: 14, abdicationPassedOver: -12, interregnumPerYear: -6,
    },
    lean: { opinionWeight: -0.5, edgeWeight: 0.6, ambitionPer: 2.5, oathPerHonor: -4, kinOfClaimant: 40, kinOfCrown: -15, onCouncil: -10, cowed: -20, noise: 15 },
    war: { startMomentum: 40, foreignShare: 0.12, foreignMax: 250, foreignHostileBelow: -30, wonPrestige: 10, parleyQuietYears: 20, crushedCadetLoyalty: 5, crushedCadetFine: 0.5, crushedSpouseRealm: -20, farSeparatismPer: 0.5 },
    prep: {
        coronation: { prestige: 25, gold: 400, minAge: 16 },
        oaths: { prestige: 10, gold: 150, minOpinion: 0, cooldownDays: 120 },
        portion: { step: 250 },
        orders: { gold: 200, minAge: 14 },
        pension: { gold: 500, years: 12 },
        cloister: { prestige: 30, stability: -5, years: 40 },
    },
    split: { truceDays: 360, relations: -60, claimStrength: 40, prestige: -30, stability: -10, minMilitary: 20, reunionMilitaryShare: 0.6, reunitedPrestige: 30 },
    usurp: { claimStrength: 55, prestige: -40 },
    interregnum: { usurpYears: 5, usurpMinStrength: 30 },
    historyCap: 20,
};

const KIND_FALLBACK = {
    brother: { icon: '🗡️', label: 'a younger son', labelDaughter: 'a daughter of the House', labelUncle: 'an uncle of the heir' },
    cadet: { icon: '🌿', label: 'a cadet branch' },
    spouseKin: { icon: '💍', label: 'the late consort\'s kin' },
    pretender: { icon: '🏚️', label: 'the old royal line' },
};

const OFFICES = ['chancellor', 'marshal', 'steward', 'spymaster', 'highPriest'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day);
const _key = (q, r) => `${q},${r}`;

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash(s) {
    let h = Utils.hashStr(String(s)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/** −1..1, fixed for a key in this world (a lord's own temper; no stream touched). */
function _noise(world, key) {
    return ((_hash(`${_seed(world)}|crownSucc|${key}`) % 20001) / 10000) - 1;
}

/** A dedicated stream (mulberry32) for this system's draws and the code it calls. */
function _rng(world, key) {
    let a = _hash(`${_seed(world)}|crownSuccRng|${_day(world)}|${key}`) || 1;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

const _cfgMemo = { src: undefined, out: null };

export const CrownSuccession = {
    // ── Data ────────────────────────────────────────────────────

    data() {
        return (DataLoader._gamedata && DataLoader._gamedata.crownSuccession) || {};
    },

    config() {
        const raw = CrownSuccession.data().config;
        if (_cfgMemo.out && _cfgMemo.src === raw) return _cfgMemo.out;
        _cfgMemo.src = raw;
        _cfgMemo.out = _merge(DEFAULTS, raw || {});
        return _cfgMemo.out;
    },

    kindInfo(kind) {
        return { ...(KIND_FALLBACK[kind] || { icon: '👑', label: kind }), ...((CrownSuccession.data().kinds || {})[kind] || {}) };
    },

    _Y() {
        return _num(Relationships._getHeirSettings().daysPerYear, 120) || 120;
    },

    _minAge() {
        return _num(Relationships._getHeirSettings().minAgeToPlay, 16) || 16;
    },

    // ── State ───────────────────────────────────────────────────

    _blank() {
        return { prep: {}, history: [], splits: [], seq: 0 };
    },

    /** player.crownSuccession, created/backfilled on use. */
    state(player) {
        if (!player) return CrownSuccession._blank();
        if (!_obj(player.crownSuccession)) player.crownSuccession = CrownSuccession._blank();
        const st = player.crownSuccession;
        if (!_obj(st.prep)) st.prep = {};
        if (!Array.isArray(st.history)) st.history = [];
        if (!Array.isArray(st.splits)) st.splits = [];
        if (!(st.seq >= 0)) st.seq = 0;
        return st;
    },

    /** Preparation for one crown: { crowned, oathsDay, quietUntil, brokenUntil, pretender }. */
    prep(player, kid) {
        const st = CrownSuccession.state(player);
        if (!_obj(st.prep[kid])) st.prep[kid] = {};
        return st.prep[kid];
    },

    _childState(child) {
        if (!_obj(child.crownSuccession)) child.crownSuccession = {};
        return child.crownSuccession;
    },

    /** The crowns the player wears: the court's realm first, then any other (systems/highCrowns.js, if present). */
    crowns(player, world) {
        return HighCrowns.crownsOf(player, world).map(c => c.kingdom).filter(Boolean);
    },

    // ── Who would inherit now ───────────────────────────────────

    /** The heir who would take the seat today: the named heir if living, else the eldest of age, else the eldest child. */
    likelyHeir(player) {
        const kids = (player && player.children || []).filter(c => c && c.isAlive !== false && !(c.kin && c.kin.unfit));
        const named = kids.find(c => c.id === player.heir);
        if (named) return named;
        const grown = Relationships.getEligibleHeirs(player);
        if (grown.length) return grown[0];
        return kids.filter(c => !c.isSibling).sort((a, b) => _num(b.age) - _num(a.age))[0] || null;
    },

    _heirSkill(child) {
        const sk = (child && child.skills) || {};
        return _num(sk.leadership) + _num(sk.diplomacy);
    },

    /** Is a child wed abroad (alliance or royal match into another realm)? */
    _wedAbroad(child, kid) {
        const sp = child && child.upbringing && child.upbringing.spouse;
        return !!(sp && (sp.kind === 'alliance' || sp.kind === 'royal') && sp.kingdomId && sp.kingdomId !== kid);
    },

    /** The vassal house a child married into (Kingship.arrangeMarriage), by name. */
    _wedToLord(child) {
        const sp = child && child.upbringing && child.upbringing.spouse;
        if (!sp || sp.kind !== 'vassal') return null;
        return String(sp.name || '').replace(/^kin of\s+/i, '') || null;
    },

    /**
     * The facts of the succession, read before the seat changes hands (the
     * late ruler's children, spouse, oaths and preparation) — plain data.
     * Live (for the forecast) when `child` is the likely heir and opts is {}.
     */
    capture(player, world, child, opts = {}) {
        const k = Throne.ruledKingdom(player, world);
        if (!player || !k || !child) return null;
        const prep = CrownSuccession.prep(player, k.id);
        const court = Kingship.court(player);
        const day = _day(world);
        const sib = (player.children || []).filter(c => c && c.id !== child.id && c.isAlive !== false);
        const spouse = player.spouse ? Relationships.getNPC(player.spouse) : null;
        const house = player.house || {};
        const cr = house.currentReign;
        const st = Relationships._getHeirSettings();
        const minor = _num(child.age) < _num(st.minAgeToPlay, 16);
        const eldest = sib.filter(c => _num(c.age) >= CrownSuccession._minAge() && !c.isSibling).sort((a, b) => _num(b.age) - _num(a.age))[0];
        return {
            kingdomId: k.id,
            day,
            heir: { id: child.id, firstName: child.firstName, name: `${child.firstName || ''} ${child.dynasty || ''}`.trim(), age: _num(child.age), gender: child.gender, skill: CrownSuccession._heirSkill(child), purple: child.upbringing && !child.upbringing.hardened ? _num(child.upbringing.purple) : 0 },
            minor,
            designated: player.heir === child.id,
            crowned: !!(prep.crowned && prep.crowned.heirId === child.id),
            oaths: court ? court.vassals.filter(v => v.heirOath && v.heirOath.heirId === child.id).map(v => v.id) : [],
            siblings: sib.map(c => ({
                id: c.id, firstName: c.firstName, dynasty: c.dynasty, gender: c.gender, age: _num(c.age), uncle: !!c.isSibling,
                purse: _num(c.purse), orders: !!(c.crownSuccession && c.crownSuccession.orders),
                exiled: !!(c.crownSuccession && (c.crownSuccession.exiled || c.crownSuccession.renounced)),
                abroad: CrownSuccession._wedAbroad(c, k.id), wedToLord: CrownSuccession._wedToLord(c),
                grudge: !!(c.crownSuccession && c.crownSuccession.grudge),
                ambitious: (c.traits || []).some(t => (t && (t.id || t)) === 'ambitious'),
                turned: !!(c.upbringing && c.upbringing.turned), unfit: !!(c.kin && c.kin.unfit),
                elder: !c.isSibling && _num(c.age) > _num(child.age),
                passedOver: !!(house._pendingClaim && eldest && eldest.id === c.id),
            })),
            spouse: spouse && spouse.royal && spouse.royal.kingdomId && spouse.royal.kingdomId !== k.id ? {
                id: spouse.id, name: spouse.name || `${spouse.firstName || ''} ${spouse.dynasty || ''}`.trim(),
                kingdomId: spouse.royal.kingdomId, dynasty: spouse.royal.dynasty || spouse.dynasty || null, alive: spouse.isAlive !== false,
            } : null,
            // Younger children who would be passed over for the far crowns kept whole (systems/highCrowns.js)
            aggrieved: HighCrowns.plan(player) === 'whole' && HighCrowns.crownsOf(player, world).length > 1
                ? sib.filter(c => !c.isSibling && _num(c.age) >= CrownSuccession._minAge()).map(c => c.id) : [],
            heirSpouseRoyalHere: !!(child.upbringing && child.upbringing.spouse && child.upbringing.spouse.kind === 'royal' && child.upbringing.spouse.kingdomId === k.id),
            rulerSpouseRoyalHere: !!(spouse && spouse.royal && spouse.royal.kingdomId === k.id),
            pendingClaim: !!house._pendingClaim,
            abdication: opts.abdication ? (house._pendingClaim ? 'passedOver' : 'blessed') : null,
            regency: !!(opts.regency && minor),
            interregnumDays: player.interregnum ? Math.max(0, day - _num(player.interregnum.since, day)) : 0,
            reignDays: cr ? Math.max(0, day - _num(cr.startDay, day)) : 0,
            cause: opts.cause || null,
        };
    },

    // ── The old line ────────────────────────────────────────────

    /** The old royal line of a realm the House took (not founded), or null. */
    oldLine(player, world, k, ctx = null) {
        const r = player && player.throne && player.throne.ruling;
        if (!k || !r || r.kingdomId !== k.id || r.founded) return null;
        const data = k.characterData;
        const dyn = data && data.dynasty && data.dynasty.name;
        const mine = player.house && player.house.name ? player.house.name.replace(/^House\s+/i, '').trim() : String(player.lastName || '');
        if (!dyn || (mine && dyn.toLowerCase() === mine.toLowerCase())) return null;
        const prep = CrownSuccession.prep(player, k.id);
        const day = _day(world);
        if (prep.brokenUntil && prep.brokenUntil > day) return null;
        // The eldest grown child of the old line still at court, else a kinsman (kept, so he has one name)
        const royal = Array.isArray(data.children)
            ? data.children.filter(c => c && c.isAlive !== false && _num(c.age) >= 16).sort((a, b) => _num(b.age) - _num(a.age))[0] : null;
        if (royal) prep.pretender = { name: Characters.getFullName(royal), firstName: royal.firstName, dynasty: royal.dynasty || dyn, gender: royal.gender, age: _num(royal.age), culture: royal.culture || k.culture, charId: royal.id };
        if (!prep.pretender) {
            let ch = null;
            Utils.withRng(_rng(world, `pretender:${k.id}`), () => { ch = Characters.generateCharacter({ culture: k.culture, age: Utils.randInt(22, 45), dynasty: dyn, gender: 'male' }); });
            prep.pretender = { name: Characters.getFullName(ch), firstName: ch.firstName, dynasty: dyn, gender: ch.gender, age: ch.age, culture: ch.culture, charId: null };
        }
        const joined = ctx ? (ctx.heirSpouseRoyalHere || ctx.rulerSpouseRoyalHere) : false;
        return {
            ...prep.pretender, dynasty: prep.pretender.dynasty || dyn,
            yearsHeld: Math.max(0, (day - _num(prep.heldSince != null ? prep.heldSince : r.since, day)) / CrownSuccession._Y()),
            quiet: !!(prep.quietUntil && prep.quietUntil > day), joined,
        };
    },

    // ── Claimants and standing ──────────────────────────────────

    _part(parts, label, value) {
        const v = Math.round(value);
        if (v) parts.push({ label, value: v });
        return v;
    },

    /**
     * Everyone who could press a claim on `k` against ctx.heir: [{ id, kind,
     * name, icon, label, strength, parts: [{label, value}], ref }], strongest first.
     */
    claimants(player, world, k, ctx) {
        if (!player || !k || !ctx) return [];
        const C = CrownSuccession.config().claimants;
        const out = [];
        const add = (c) => { c.strength = Math.max(0, Math.round(c.parts.reduce((s, p) => s + p.value, 0))); if (c.strength > 0) out.push(c); };
        const minAge = CrownSuccession._minAge();
        // Younger sons and daughters (and the heir's uncles)
        const B = C.brother;
        for (const s of ctx.siblings || []) {
            if (s.age < minAge || s.orders || s.exiled || s.abroad || s.unfit) continue;
            // (a younger child given a far crown of their own reigns there: systems/highCrowns.js)
            const live = (player.children || []).find(c => c.id === s.id);
            if (live && live.crownedIn) continue;
            const info = CrownSuccession.kindInfo('brother');
            const parts = [];
            const mult = s.uncle ? _num(B.uncleMult, 0.6) : 1;
            CrownSuccession._part(parts, s.gender === 'female' ? 'A daughter of the blood' : 'A son of the blood', (s.gender === 'female' ? _num(B.daughter) : _num(B.son)) * mult);
            if (s.elder) CrownSuccession._part(parts, 'Older than the heir', _num(B.elder));
            if (s.passedOver) CrownSuccession._part(parts, 'The rightful heir, passed over', _num(B.passedOver));
            if (s.ambitious) CrownSuccession._part(parts, 'Ambitious', _num(B.ambitious));
            if (s.turned) CrownSuccession._part(parts, 'Turned against the House', _num(B.turned));
            if (s.wedToLord) CrownSuccession._part(parts, `Wed into the house of ${s.wedToLord}`, _num(B.wedToLord));
            if (s.grudge) CrownSuccession._part(parts, 'Stood down once, and remembers', _num(B.grudge));
            if ((ctx.aggrieved || []).includes(s.id)) CrownSuccession._part(parts, 'Denied a far crown', _num(B.aggrieved));
            const base = parts.reduce((x, p) => x + p.value, 0);
            if (s.purse > 0 && base > 0) {
                const cut = _num(B.boughtOffCut, 0.7) * Math.min(1, s.purse / Math.max(1, _num(B.boughtOffGold, 1000)));
                CrownSuccession._part(parts, `A portion of ${Utils.formatGold(s.purse)}g`, -base * cut);
            }
            add({
                id: `brother:${s.id}`, kind: 'brother', ref: s.id, icon: info.icon,
                label: s.uncle ? info.labelUncle : (s.gender === 'female' ? info.labelDaughter : info.label),
                name: `${s.firstName || ''} ${s.dynasty || ''}`.trim(), gender: s.gender, age: s.age, wedToLord: s.wedToLord, parts,
            });
        }
        // Cadet branches gone cold
        const Cd = C.cadet;
        for (const b of CadetBranches.list(player)) {
            const loyalty = _num(b.loyalty, 50);
            if (loyalty >= _num(Cd.loyalAbove, 60)) continue;
            const parts = [];
            CrownSuccession._part(parts, 'Blood of the House', _num(Cd.base));
            if (loyalty < 50) CrownSuccession._part(parts, `Loyalty ${Math.round(loyalty)}`, (50 - loyalty) * _num(Cd.perLoyaltyBelow50));
            if (b.estranged || loyalty < 20) CrownSuccession._part(parts, 'Estranged from the main line', _num(Cd.estranged));
            const info = CrownSuccession.kindInfo('cadet');
            add({ id: `cadet:${b.id}`, kind: 'cadet', ref: b.id, icon: info.icon, label: `${info.label} (${b.name || 'a branch'})`, name: CadetBranches.headName(b), gender: b.head && b.head.gender, age: b.head && b.head.age, parts });
        }
        // The late consort's kin
        const Sk = C.spouseKin;
        if (ctx.spouse) {
            const realm = Throne._kingdom(world, ctx.spouse.kingdomId);
            if (realm && realm.isAlive) {
                const parts = [];
                const regent = player.regency && player.regency.active ? player.regency.regent : null;
                const regentIsSpouse = !!(regent && regent.kind === 'spouse');
                if (ctx.minor && !regentIsSpouse) CrownSuccession._part(parts, 'A child heir, the regency not theirs', _num(Sk.regencyDenied));
                else if (!ctx.minor) CrownSuccession._part(parts, 'Kin of the crown', _num(Sk.adult));
                const rel = _num((realm.relations || {})[k.id]);
                if (rel < _num(Sk.hostileBelow) && parts.length) CrownSuccession._part(parts, `${Names.realm(realm.name)} is cold to you (${Math.round(rel)})`, _num(Sk.hostileRealm));
                if (!ctx.spouse.alive && parts.length) {
                    const base = parts.reduce((x, p) => x + p.value, 0);
                    CrownSuccession._part(parts, 'The consort is dead', -base * (1 - _num(Sk.widowedMult, 0.6)));
                }
                const info = CrownSuccession.kindInfo('spouseKin');
                const name = `${ctx.spouse.dynasty ? `House ${ctx.spouse.dynasty}` : 'the consort\'s kin'} of ${Names.realm(realm.name)}`;
                if (parts.length) add({ id: `spouseKin:${realm.id}`, kind: 'spouseKin', ref: realm.id, icon: info.icon, label: info.label, name, realmId: realm.id, parts });
            }
        }
        // The old royal line
        const P = C.pretender;
        const line = CrownSuccession.oldLine(player, world, k, ctx);
        if (line && !line.joined) {
            const parts = [];
            CrownSuccession._part(parts, `The old line of ${line.dynasty}`, _num(P.base));
            CrownSuccession._part(parts, `${Math.floor(line.yearsHeld)} years of your House's rule`, -line.yearsHeld * _num(P.decayPerYear));
            if (line.quiet) {
                const base = parts.reduce((x, p) => x + p.value, 0);
                CrownSuccession._part(parts, 'Pensioned and quiet', -Math.max(0, base) * (1 - _num(P.quietMult, 0.4)));
            }
            const info = CrownSuccession.kindInfo('pretender');
            add({ id: `pretender:${k.id}`, kind: 'pretender', ref: k.id, icon: info.icon, label: info.label, name: line.name, gender: line.gender, age: line.age, parts });
        }
        return out.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
    },

    /** The lords' power (Kingship vassals) and the share sworn to the heir. */
    _lordPower(player, world, k, ids = null) {
        const court = Kingship.court(player);
        if (!court) return { total: 0, sworn: 0 };
        let total = 0;
        let sworn = 0;
        for (const v of court.vassals) {
            const p = Kingship.power(world, v, k);
            total += p;
            if (ids && ids.includes(v.id)) sworn += p;
        }
        return { total, sworn };
    },

    /** The heir's standing against any claimant: { value, parts }. extra: { house (processSuccession result) }. */
    standing(player, world, k, ctx, extra = {}) {
        const S = CrownSuccession.config().standing;
        const parts = [];
        if (!player || !k || !ctx) return { value: 0, parts };
        const P = CrownSuccession._part;
        if (ctx.designated) P(parts, 'Named heir in life', _num(S.designated));
        if (ctx.crowned) P(parts, 'Crowned in the late ruler\'s lifetime', _num(S.crowned));
        const lp = CrownSuccession._lordPower(player, world, k, ctx.oaths || []);
        if (lp.total > 0 && lp.sworn > 0) P(parts, `Oaths of lords holding ${Math.round(lp.sworn / lp.total * 100)}% of the realm`, lp.sworn / lp.total * _num(S.oathMax));
        if (ctx.minor) {
            P(parts, `A child of ${ctx.heir.age}`, _num(S.minor));
            const regent = player.regency && player.regency.active ? player.regency.regent : null;
            if (regent) {
                if (_num(regent.loyalty) >= _num(S.regentLoyalAt)) P(parts, `${regent.name}, a loyal regent`, _num(S.regentLoyal));
                else if (_num(regent.loyalty) < _num(S.regentDisloyalBelow)) P(parts, `${regent.name}, a regent of doubtful loyalty`, _num(S.regentDisloyal));
            }
        }
        const prestige = House.getPrestige(player);
        P(parts, 'The House\'s Prestige', Math.min(_num(S.prestigeCap), prestige / Math.max(1, _num(S.prestigePer))));
        const years = _num(ctx.reignDays) / CrownSuccession._Y();
        P(parts, `A reign of ${Math.floor(years)} years`, Math.min(_num(S.reignCap), years * _num(S.reignPerYear)));
        const stab = typeof k.stability === 'number' ? k.stability : 60;
        P(parts, `The realm's stability (${Math.round(stab)})`, (stab - _num(S.stabilityPivot)) * _num(S.stabilityWeight));
        const court = Kingship.court(player);
        if (court && court.vassals.length) {
            const avg = court.vassals.reduce((s, v) => s + _num(v.opinion), 0) / court.vassals.length;
            P(parts, `The lords' mood (${Math.round(avg)})`, avg * _num(S.opinionWeight));
        }
        P(parts, 'The heir\'s own name', Math.min(_num(S.heirSkillCap), _num(ctx.heir.skill) * _num(S.heirSkillWeight)));
        const hr = extra.house;
        if (hr && hr.disputed) P(parts, hr.secured ? 'The succession secured with Prestige' : 'A disputed succession', hr.secured ? _num(S.secured) : _num(S.disputed));
        // the House's founding tale invoked for legitimacy (systems/namedLegacy.js)
        const legit = NamedLegacy.legitimacy ? NamedLegacy.legitimacy(player, world) : null;
        if (legit && legit.active) P(parts, 'The House\'s founding tale told for the heir', _num(S.mythLegitimacy, 12));
        // an heir raised soft at court (systems/realmDecline.js): the lords doubt him
        const purple = ctx.heir ? _num(ctx.heir.purple) : 0;
        if (purple > _num(S.purpleFrom, 50)) P(parts, 'Born in the purple, and the lords know it', -(purple - _num(S.purpleFrom, 50)) * _num(S.purpleWeight, 0.3));
        if (ctx.abdication === 'blessed') P(parts, 'Handed the crown by the old ruler', _num(S.abdicationBlessed));
        else if (ctx.abdication === 'passedOver') P(parts, 'The rightful heir passed over', _num(S.abdicationPassedOver));
        if (ctx.interregnumDays > 0) {
            const yrs = ctx.interregnumDays / CrownSuccession._Y();
            P(parts, `${Math.floor(yrs)} years of an empty throne`, yrs * _num(S.interregnumPerYear));
        }
        return { value: Math.round(parts.reduce((s, p) => s + p.value, 0)), parts };
    },

    /** The chance a claimant of `strength` rises against `standing` (0–riseMax). */
    riseChance(strength, standing) {
        const C = CrownSuccession.config();
        if (!(strength > 0)) return 0;
        return Utils.clamp((strength - standing + _num(C.riseBase)) / Math.max(1, _num(C.riseDivisor)), 0, _num(C.riseMax, 0.9));
    },

    /** One lord's lean toward a claimant (above 0: he backs him). → { value, parts } */
    lean(player, world, k, v, claimant, standing, ctx) {
        const L = CrownSuccession.config().lean;
        const court = Kingship.court(player);
        const parts = [];
        const P = CrownSuccession._part;
        P(parts, `His opinion of the crown (${Math.round(_num(v.opinion))})`, _num(v.opinion) * _num(L.opinionWeight));
        P(parts, 'The claim against the heir', (claimant.strength - standing) * _num(L.edgeWeight));
        P(parts, 'Ambition', (_num(v.ambition) - 5.5) * _num(L.ambitionPer));
        if (ctx && (ctx.oaths || []).includes(v.id)) P(parts, `Sworn to the heir (honour ${_num(v.honor, 5)})`, _num(v.honor, 5) * _num(L.oathPerHonor));
        const kinOfClaimant = claimant.wedToLord && claimant.wedToLord === Kingship.fullName(v);
        if (kinOfClaimant) P(parts, 'Kin of the claimant', _num(L.kinOfClaimant));
        else if (v.kin) P(parts, 'Kin of the crown', _num(L.kinOfCrown));
        if (court && OFFICES.some(o => court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === v.id)) P(parts, 'A seat on the council', _num(L.onCouncil));
        if (_num(v.cowedUntil) > _day(world)) P(parts, 'Cowed', _num(L.cowed));
        P(parts, 'His own temper', _noise(world, `lean:${v.id}:${claimant.id}`) * _num(L.noise));
        return { value: Math.round(parts.reduce((s, p) => s + p.value, 0)), parts };
    },

    /** Who would back `claimant`: { backers: [{v, name, power, lean}], others, claimantPower, crownPower, share }. */
    sides(player, world, k, claimant, standing, ctx) {
        const court = Kingship.court(player);
        const backers = [];
        const others = [];
        let total = 0;
        for (const v of (court ? court.vassals : [])) {
            const power = Kingship.power(world, v, k);
            total += power;
            const ln = CrownSuccession.lean(player, world, k, v, claimant, standing, ctx);
            const row = { v, id: v.id, name: Kingship.fullName(v), seat: v.seat ? v.seat.name : 'landless', power, lean: ln.value, parts: ln.parts };
            if (v.rebel || ln.value > 0) backers.push(row);
            else others.push(row);
        }
        const claimantPower = backers.reduce((s, b) => s + b.power, 0);
        const F = Kingship.config().factions || {};
        const crownPower = Math.round(others.reduce((s, o) => s + o.power, 0) + _num(k.military) * _num(F.crownPerMilitary, 0.05));
        return { backers, others, claimantPower, crownPower, lordPower: total, share: total > 0 ? claimantPower / total : 0 };
    },

    /**
     * The Succession card: who would inherit today, their standing, each
     * claimant with his strength, chance to rise and the lords who would back
     * him. Pure (draws nothing; the pretender's name is drawn once from its own stream).
     */
    forecast(player, world) {
        const k = Throne.ruledKingdom(player, world);
        if (!k) return null;
        const heir = CrownSuccession.likelyHeir(player);
        if (!heir) return { kingdom: k, heir: null, standing: { value: 0, parts: [] }, claimants: [], risk: 0 };
        const ctx = CrownSuccession.capture(player, world, heir, {});
        // (a child would reign under a regency: show it as the death screen would offer it)
        ctx.regency = ctx.minor;
        const standing = CrownSuccession.standing(player, world, k, ctx);
        const claimants = CrownSuccession.claimants(player, world, k, ctx).map(c => {
            const chance = CrownSuccession.riseChance(c.strength, standing.value);
            const sides = CrownSuccession.sides(player, world, k, c, standing.value, ctx);
            return { ...c, chance, sides };
        });
        let calm = 1;
        for (const c of claimants) calm *= (1 - c.chance);
        const court = Kingship.court(player);
        const sworn = court ? court.vassals.filter(v => v.heirOath && v.heirOath.heirId === heir.id).length : 0;
        return { kingdom: k, heir, ctx, standing, claimants, risk: 1 - calm, sworn, lords: court ? court.vassals.length : 0, prep: CrownSuccession.prep(player, k.id) };
    },

    /** For the deathbed: the chance a claimant rises if `child` takes the crown, and the likeliest. → null without a crown. */
    riskFor(player, world, child, opts = {}) {
        const k = Throne.ruledKingdom(player, world);
        if (!k || !child) return null;
        const ctx = CrownSuccession.capture(player, world, child, opts);
        if (!ctx) return null;
        const standing = CrownSuccession.standing(player, world, k, ctx);
        let calm = 1;
        let top = null;
        for (const c of CrownSuccession.claimants(player, world, k, ctx)) {
            const p = CrownSuccession.riseChance(c.strength, standing.value);
            calm *= 1 - p;
            if (!top || p > top.chance) top = { name: c.name, label: c.label, chance: p };
        }
        return { risk: 1 - calm, standing: standing.value, top };
    },

    // ── At the succession ───────────────────────────────────────

    _record(player, world, rec) {
        const st = CrownSuccession.state(player);
        const C = CrownSuccession.config();
        st.seq++;
        rec.id = rec.id || `cs${st.seq}`;
        rec.day = _day(world);
        st.history.push(rec);
        if (st.history.length > _num(C.historyCap, 20)) st.history = st.history.slice(-_num(C.historyCap, 20));
        return rec;
    },

    _chronicle(player, world, k, text, tags = ['throne', 'succession']) {
        Throne._log(player, world, text);
        if (world && Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: k ? k.id : null });
        if (player.house && tags.length && !tags.includes('throne')) House._chronicle(player.house, world, text, tags);
    },

    /** The facts handed to the chronicler; its retelling (or the plain text) is kept on the world. */
    _prose(world, key, facts, fallback) {
        try {
            return LlmProse.write(world, { kind: 'crisis', key, facts, fallback });
        } catch (e) {
            return fallback;
        }
    },

    /** The record's text: the chronicler's retelling once written, else the plain text. */
    recordText(world, rec) {
        if (!rec) return '';
        return rec.proseKey ? LlmProse.text(world, rec.proseKey, rec.text) : rec.text;
    },

    /**
     * After Relationships.succeedAsHeir has seated the heir: weigh every
     * claimant, raise the strongest who rises, let the lords choose, and start
     * the war — or, after a long interregnum, find the crown already taken.
     * extra: { house (House.processSuccession result) }. → { contested, war,
     * usurped, text, claimant, record } or null when the player ruled nothing.
     */
    onSuccession(player, world, ctx, extra = {}) {
        if (!player || !world || !ctx) return null;
        const k = Throne._kingdom(world, ctx.kingdomId);
        if (!k || !k.isAlive || !player.throne || !player.throne.ruling || player.throne.ruling.kingdomId !== k.id) return null;
        const C = CrownSuccession.config();
        const prep = CrownSuccession.prep(player, k.id);
        const court = Kingship.court(player);
        let result = null;
        Utils.withRng(_rng(world, `succ:${k.id}:${ctx.heir.id}`), () => {
            if (court && !court.initialized) {
                Kingship._generateVassals(player, world, k, court);
                court.initialized = true;
                court.lastNewVassalDay = _day(world);
            }
            // (the far crowns were kept whole or parted before us: who was passed over, systems/highCrowns.js)
            ctx.aggrieved = HighCrowns.aggrieved(player).map(a => a.id);
            const standing = CrownSuccession.standing(player, world, k, ctx, extra);
            const claimants = CrownSuccession.claimants(player, world, k, ctx);
            CrownSuccession._farCrowns(player, world, k, claimants, standing);
            const risen = claimants.filter(c => Utils.random() < CrownSuccession.riseChance(c.strength, standing.value));
            // The preparation was for this succession: the oaths and the crowning are spent
            prep.crowned = null;
            if (court) for (const v of court.vassals) if (v.heirOath) delete v.heirOath;
            if (!risen.length) {
                const text = claimants.length
                    ? `👑 ${ctx.heir.name} takes the crown of ${Names.realm(k.name)}. No claimant dares rise against a standing of ${standing.value}.`
                    : `👑 ${ctx.heir.name} takes the crown of ${Names.realm(k.name)} unopposed.`;
                const rec = CrownSuccession._record(player, world, { kingdomId: k.id, heir: ctx.heir.name, outcome: 'peaceful', standing: standing.value, claimants: claimants.map(c => ({ name: c.name, kind: c.kind, strength: c.strength })), text });
                CrownSuccession._chronicle(player, world, k, text, []);
                result = { contested: false, text, record: rec, standing };
                return;
            }
            const lead = risen[0];
            const others = risen.slice(1);
            const sides = CrownSuccession.sides(player, world, k, lead, standing.value, ctx);
            const Y = CrownSuccession._Y();
            // A long empty throne: the claimant took it while the House waited
            if (ctx.interregnumDays >= _num(C.interregnum.usurpYears) * Y && lead.strength >= _num(C.interregnum.usurpMinStrength)) {
                result = CrownSuccession._usurp(player, world, k, lead, ctx, standing, 'interregnum');
                return;
            }
            if (!court || sides.share < _num(C.minLordShare)) {
                const text = `👑 ${lead.name}, ${lead.label}, claims the crown of ${Names.realm(k.name)} against ${ctx.heir.name}, but no lord will rise for ${lead.gender === 'female' ? 'her' : 'him'} (${Math.round(sides.share * 100)}% of the realm's power). The claim is set aside.`;
                CrownSuccession._afterClaim(player, world, k, lead, 'unbacked');
                const rec = CrownSuccession._record(player, world, { kingdomId: k.id, heir: ctx.heir.name, outcome: 'unbacked', standing: standing.value, claimant: { name: lead.name, kind: lead.kind, strength: lead.strength }, text });
                CrownSuccession._chronicle(player, world, k, text, []);
                result = { contested: true, war: false, text, claimant: lead, record: rec, standing };
                return;
            }
            result = CrownSuccession._startWar(player, world, k, court, lead, others, sides, standing, ctx);
        });
        return result;
    },

    /**
     * The far crowns in personal union (systems/highCrowns.js) have no royal
     * court of ours: a claimant who rises there stirs their lords' wish for a
     * king of their own (the entry's separatism, which HighCrowns acts on).
     */
    _farCrowns(player, world, home, claimants, standing) {
        const per = _num(CrownSuccession.config().war.farSeparatismPer, 0.5);
        for (const c of HighCrowns.crownsOf(player, world)) {
            if (c.home || !c.kingdom) continue;
            const entry = HighCrowns.unionCrown(player, c.kingdomId);
            const lead = claimants.find(x => Utils.random() < CrownSuccession.riseChance(x.strength, standing.value));
            if (!entry || !lead) continue;
            const add = Math.round(lead.strength * per);
            entry.separatism = Utils.clamp(_num(entry.separatism) + add, 0, 100);
            CrownSuccession._chronicle(player, world, c.kingdom, `⚔️ ${lead.name}, ${lead.label}, is hailed by lords of ${Names.realm(c.kingdom.name)}: its wish for a king of its own grows (+${add}).`, ['succession']);
        }
    },

    /** Raise the succession revolt (Kingship's revolt machinery) for `lead` and his lords. */
    _startWar(player, world, k, court, lead, others, sides, standing, ctx) {
        const C = CrownSuccession.config();
        const W = C.war;
        const day = _day(world);
        const members = sides.backers.map(b => b.id);
        const leader = sides.backers.slice().sort((a, b) => b.power - a.power)[0];
        const scratch = { notices: [] };
        if (court.revolt) {
            // A revolt already burning takes up the claimant's cause
            const rv = court.revolt;
            for (const b of sides.backers) {
                if (rv.members.includes(b.id)) continue;
                rv.members.push(b.id);
                b.v.rebel = true;
                b.v.factionId = null;
                for (const o of OFFICES) if (court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === b.id) court.council[o] = null;
                if (b.v.seat && Kingship._seatOf(world, b.v, k)) rv.seats.push(_key(b.v.seat.q, b.v.seat.r));
                rv.strength += Math.round(b.power * _num((Kingship.config().revolt || {}).strengthPerPower, 4));
            }
            rv.demand = { type: 'crown', claimant: lead.name };
        } else {
            for (const b of sides.backers) Kingship._leaveFaction(court, b.v);
            const f = { id: `succ_${k.id}_${day}`, members, leaderId: leader.id, demand: { type: 'crown', claimant: lead.name }, revealed: true };
            Kingship._startRevolt(player, world, court, k, f, scratch);
        }
        const rv = court.revolt;
        if (!rv) return null;
        const crownShare = sides.crownPower / Math.max(1, sides.crownPower + sides.claimantPower);
        rv.momentum = Math.round((crownShare - 0.5) * _num(W.startMomentum));
        rv.leaderName = lead.name;
        // A foreign realm behind the claimant sends men (out of its own host)
        let foreign = null;
        let backer = null;
        if (lead.kind === 'spouseKin') backer = Throne._kingdom(world, lead.realmId);
        else if (lead.kind === 'pretender') {
            backer = (world.kingdoms || []).filter(o => o && o.isAlive && o.id !== k.id && _num((o.relations || {})[k.id]) < _num(W.foreignHostileBelow))
                .sort((a, b) => _num((a.relations || {})[k.id]) - _num((b.relations || {})[k.id]) || (a.id < b.id ? -1 : 1))[0] || null;
        }
        if (backer && backer.isAlive) {
            const men = Math.round(Math.min(_num(W.foreignMax), _num(backer.military) * _num(W.foreignShare)));
            if (men > 0) {
                backer.military = Math.max(0, _num(backer.military) - men);
                rv.strength += men;
                foreign = { kingdomId: backer.id, name: backer.name, men };
            }
        }
        rv.succession = {
            claimant: { id: lead.id, kind: lead.kind, ref: lead.ref, name: lead.name, label: lead.label, gender: lead.gender || null, age: lead.age || null, strength: lead.strength, realmId: lead.realmId || null, wedToLord: lead.wedToLord || null },
            heir: ctx.heir.name, standing: standing.value, startDay: day,
            support: { claimant: sides.claimantPower, crown: sides.crownPower },
            backers: sides.backers.map(b => ({ id: b.id, name: b.name, power: b.power })),
            others: others.map(o => ({ name: o.name, kind: o.kind, strength: o.strength })), foreign,
        };
        const backed = sides.backers.map(b => `${b.name} (${b.power})`).join(', ');
        const text = `⚔️ War for the crown of ${Names.realm(k.name)}! ${lead.name}, ${lead.label}, claims the throne against ${ctx.heir.name}. Behind ${lead.gender === 'female' ? 'her' : 'him'}: ${backed} — support ${sides.claimantPower} against the crown's ${sides.crownPower}.${foreign ? ` ${Names.realm(foreign.name)} sends ${foreign.men} men.` : ''}${others.length ? ` ${others.map(o => o.name).join(' and ')} also put${others.length === 1 ? 's' : ''} forward a claim, and stand${others.length === 1 ? 's' : ''} with ${lead.name}.` : ''}`;
        const proseKey = `crownSuccession:${k.id}:${day}:war`;
        CrownSuccession._prose(world, proseKey, {
            event: 'a war of succession begins', realm: k.name, heir: ctx.heir.name, claimant: lead.name, claimantIs: lead.label,
            lords: sides.backers.map(b => b.name), support: sides.claimantPower, crownSupport: sides.crownPower, foreign: foreign ? foreign.name : null,
        }, text);
        const rec = CrownSuccession._record(player, world, { kingdomId: k.id, heir: ctx.heir.name, outcome: 'war', standing: standing.value, claimant: { name: lead.name, kind: lead.kind, strength: lead.strength }, support: rv.succession.support, text, proseKey });
        rv.succession.recordId = rec.id;
        CrownSuccession._chronicle(player, world, k, text, []);
        Interrupts.raise(world, { reason: `${lead.name} claims your crown`, icon: '⚔️', source: 'crownSuccession' });
        Kingship.refresh(player, world);
        return { contested: true, war: true, text, claimant: lead, record: rec, standing, support: rv.succession.support };
    },

    /** What becomes of a claimant who stood down, was crushed or was bought off. how: 'unbacked' | 'crushed' | 'parley'. */
    _afterClaim(player, world, k, cl, how) {
        const W = CrownSuccession.config().war;
        const day = _day(world);
        const Y = CrownSuccession._Y();
        if (cl.kind === 'brother') {
            const c = (player.children || []).find(x => x.id === cl.ref);
            if (c) {
                const cs = CrownSuccession._childState(c);
                if (how === 'crushed') cs.exiled = day;
                else if (how === 'parley') cs.renounced = day;
                else cs.grudge = day;
            }
        } else if (cl.kind === 'cadet') {
            const b = CadetBranches.get(player, cl.ref);
            if (b && how === 'crushed') {
                b.loyalty = _num(W.crushedCadetLoyalty, 5);
                // (the branch's fine: half its purse into the royal treasury, coin purse to chest)
                const fine = Math.floor(_num(b.gold) * _num(W.crushedCadetFine, 0.5));
                if (fine > 0) { b.gold -= fine; k.treasury = _num(k.treasury) + fine; }
            } else if (b && how === 'parley') b.loyalty = Math.max(_num(b.loyalty), 40);
        } else if (cl.kind === 'pretender') {
            const prep = CrownSuccession.prep(player, k.id);
            if (how === 'crushed') { prep.brokenUntil = day + _num(CrownSuccession.config().prep.cloister.years, 40) * Y; prep.pretender = null; }
            else if (how === 'parley') prep.quietUntil = day + _num(W.parleyQuietYears, 20) * Y;
        } else if (cl.kind === 'spouseKin' && how === 'crushed') {
            const realm = Throne._kingdom(world, cl.realmId || cl.ref);
            if (realm) {
                if (!realm.relations) realm.relations = {};
                realm.relations[k.id] = Utils.clamp(_num(realm.relations[k.id]) + _num(W.crushedSpouseRealm), -100, 100);
            }
        }
    },

    /**
     * Kingship._endRevolt hook for a succession revolt. how 'crushed' | 'parley'
     * (after Kingship's own ending): the claimant's fate. how 'conceded' (before,
     * instead of Kingship's ending): the realm splits, or the crown is lost.
     * → the text for a conceded war (the caller returns it), else null.
     */
    warEnded(player, world, court, k, rv, how, out) {
        if (!rv || !rv.succession) return null;
        const C = CrownSuccession.config();
        const s = rv.succession;
        const cl = s.claimant;
        const day = _day(world);
        let text = null;
        Utils.withRng(_rng(world, `end:${k.id}:${how}`), () => {
            if (how === 'crushed' || how === 'parley') {
                CrownSuccession._afterClaim(player, world, k, cl, how);
                if (how === 'crushed' && _num(C.war.wonPrestige)) House.award(player.house, _num(C.war.wonPrestige), `held the crown against ${cl.name}`, day);
                const fate = how === 'parley' ? 'bought off and renounces the claim'
                    : cl.kind === 'brother' ? 'taken and sent into exile'
                        : cl.kind === 'pretender' ? 'taken and shut in a cloister; the old line is broken'
                            : cl.kind === 'cadet' ? 'beaten; the branch pays a heavy fine' : 'beaten back across the border';
                const t = `👑 The war for the crown of ${Names.realm(k.name)} is over: ${cl.name} is ${fate}. ${player.name} reigns.`;
                CrownSuccession._record(player, world, { kingdomId: k.id, heir: s.heir, outcome: how === 'parley' ? 'boughtOff' : 'held', claimant: { name: cl.name, kind: cl.kind }, text: t });
                CrownSuccession._chronicle(player, world, k, t, ['succession']);
                if (out) out.notices.push({ icon: '👑', title: 'The Crown Is Held', text: t, type: 'success' });
                return;
            }
            // Conceded: the revolt ends here, on our terms
            court.revolt = null;
            for (const h of rv.hosts || []) {
                const unit = (world.units || []).find(u => u.id === h.id);
                if (unit) unit.destroyed = true;
            }
            const capKey = k.capital ? _key(k.capital.q, k.capital.r) : null;
            if (capKey && rv.seats.includes(capKey)) {
                text = CrownSuccession._usurp(player, world, k, cl, null, { value: s.standing }, 'capital').text;
            } else {
                text = CrownSuccession._split(player, world, court, k, rv, cl);
            }
            if (out) out.notices.push({ icon: '🥀', title: 'The Realm Is Split', text, type: 'error' });
        });
        if (how === 'conceded') Kingship.refresh(player, world);
        return text;
    },

    /** The claimant's own character, for an AI throne. */
    _claimantCharacter(player, world, k, cl) {
        let ch = null;
        if (cl.kind === 'brother') {
            const c = (player.children || []).find(x => x.id === cl.ref);
            ch = Characters.generateCharacter({ culture: (c && c.culture) || k.culture, age: Math.max(16, _num(c ? c.age : cl.age, 25)), dynasty: (c && c.dynasty) || player.lastName || undefined, gender: (c && c.gender) || cl.gender || 'male', name: c ? c.firstName : undefined });
        } else if (cl.kind === 'cadet') {
            const b = CadetBranches.get(player, cl.ref);
            const h = b && b.head;
            ch = Characters.generateCharacter({ culture: (h && h.culture) || k.culture, age: Math.max(16, _num(h && h.age, 30)), dynasty: (h && h.dynasty) || undefined, gender: (h && h.gender) || 'male', name: h ? h.firstName : undefined });
        } else if (cl.kind === 'pretender') {
            const prep = CrownSuccession.prep(player, k.id);
            const p = prep.pretender || {};
            const royal = p.charId && k.characterData && Array.isArray(k.characterData.children) ? k.characterData.children.find(c => c.id === p.charId) : null;
            if (royal) {
                k.characterData.children = k.characterData.children.filter(c => c !== royal);
                ch = royal;
            } else ch = Characters.generateCharacter({ culture: p.culture || k.culture, age: Math.max(16, _num(p.age, 30)), dynasty: p.dynasty || undefined, gender: p.gender || 'male', name: p.firstName || undefined });
            prep.pretender = null;
        } else {
            const realm = Throne._kingdom(world, cl.realmId || cl.ref);
            ch = Characters.generateCharacter({ culture: (realm && realm.culture) || k.culture, age: Utils.randInt(25, 45), dynasty: (realm && realm.characterData && realm.characterData.dynasty && realm.characterData.dynasty.name) || undefined });
        }
        return ch;
    },

    /** A brother who wins a crown leaves the household (he reigns now). */
    _claimantLeaves(player, world, cl, realmName) {
        if (cl.kind === 'brother') {
            const c = (player.children || []).find(x => x.id === cl.ref);
            if (c) {
                player.children = player.children.filter(x => x !== c);
                if (player.heir === c.id) player.heir = null;
                if (player.house) {
                    for (const r of House.ROLE_IDS) if (player.house.roles && player.house.roles[r] === c.id) player.house.roles[r] = null;
                    House._chronicle(player.house, world, `${c.firstName} leaves the House to reign over ${realmName}.`, ['succession', 'heirs']);
                }
            }
        } else if (cl.kind === 'cadet') {
            const b = CadetBranches.get(player, cl.ref);
            if (b) { b.loyalty = 0; b.estranged = true; }
        }
    },

    /** The claimant takes the whole crown (the capital fell, or an empty throne was taken in the wait). */
    _usurp(player, world, k, cl, ctx, standing, why) {
        const C = CrownSuccession.config();
        const st = Throne.state(player);
        const day = _day(world);
        Throne._archiveReign(player, world, 'usurped', k);
        st.ruling = null;
        const ch = CrownSuccession._claimantCharacter(player, world, k, cl);
        const data = k.characterData;
        const playerRuler = data && data.ruler && data.ruler.isPlayer ? data.ruler : null;
        Throne._installRuler(world, k, ch);
        if (playerRuler) { playerRuler.isAlive = false; playerRuler.deposed = true; }
        if (player.allegiance === k.id) player.allegiance = null;
        player.kingdomTitle = null;
        player.title = `Rightful heir of ${Names.realm(k.name)}`;
        Throne.syncCrowns(player, world);
        const claim = Throne.grantClaim(player, world, k.id, 'blood', _num(C.usurp.claimStrength));
        if (_num(C.usurp.prestige) < 0 && player.house) House.spend(player.house, Math.min(House.getPrestige(player), -_num(C.usurp.prestige)), `the crown of ${Names.realm(k.name)} lost to ${cl.name}`, day);
        CrownSuccession._claimantLeaves(player, world, cl, Names.realm(k.name));
        const how = why === 'interregnum' ? 'took the empty throne while the House waited' : 'took the capital';
        const text = `💀 ${cl.name} ${how}: ${k.ruler} is crowned in ${Names.realm(k.name)}, and your crown is lost. You hold a blood claim of ${claim} — press it from Claims & Crowns.`;
        const proseKey = `crownSuccession:${k.id}:${day}:usurped`;
        CrownSuccession._prose(world, proseKey, { event: 'the crown is lost to a claimant', realm: k.name, claimant: cl.name, how, newRuler: k.ruler }, text);
        const rec = CrownSuccession._record(player, world, { kingdomId: k.id, heir: ctx ? ctx.heir.name : player.name, outcome: 'usurped', standing: standing ? standing.value : null, claimant: { name: cl.name, kind: cl.kind, strength: cl.strength }, text, proseKey });
        CrownSuccession._chronicle(player, world, k, text, ['succession', 'loss']);
        Interrupts.raise(world, { reason: `The crown of ${Names.realm(k.name)} is lost`, icon: '💀', source: 'crownSuccession' });
        return { contested: true, war: false, usurped: true, text, claimant: cl, record: rec, standing };
    },

    /** The claimant's seats leave the realm as a kingdom of his own. → the text. */
    _split(player, world, court, k, rv, cl) {
        const C = CrownSuccession.config();
        const X = C.split;
        const day = _day(world);
        let keys = rv.seats.slice();
        if (!keys.length) {
            for (const id of rv.members) {
                const v = court.vassals.find(x => x.id === id);
                if (v && v.seat && Kingship._seatOf(world, v, k)) keys.push(_key(v.seat.q, v.seat.r));
            }
        }
        const entries = [...new Set(keys)].map(key => {
            const [q, r] = key.split(',').map(Number);
            const tile = world.getTile(q, r);
            return tile && tile.settlement && tile.settlement.kingdom === k.id ? { q, r, tile, settlement: tile.settlement } : null;
        }).filter(Boolean);
        if (!entries.length) {
            // Nothing to carry off: the claimant is bought out of the treasury instead
            const cost = Math.round(_num(rv.strength) * _num((Kingship.config().revolt || {}).parleyPerStrength, 3));
            const paid = Economy.crownSpend(k, world, cost);
            CrownSuccession._afterClaim(player, world, k, cl, 'parley');
            const t = `🥀 The crown cannot win, but ${cl.name} holds no town to carry off: ${Utils.formatGold(paid)}g from the treasury buys the claim away.`;
            CrownSuccession._record(player, world, { kingdomId: k.id, heir: rv.succession.heir, outcome: 'boughtOff', claimant: { name: cl.name, kind: cl.kind }, text: t });
            CrownSuccession._chronicle(player, world, k, t, ['succession']);
            return t;
        }
        const ch = CrownSuccession._claimantCharacter(player, world, k, cl);
        const nk = CrownSuccession._carveRealm(world, k, entries, ch, rv, cl);
        // The lords who went with him leave the royal court
        const gone = new Set(entries.map(e => _key(e.q, e.r)));
        const leaving = court.vassals.filter(v => rv.members.includes(v.id) || (v.seat && gone.has(_key(v.seat.q, v.seat.r))));
        for (const v of leaving) for (const o of OFFICES) if (court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === v.id) court.council[o] = null;
        court.vassals = court.vassals.filter(v => !leaving.includes(v));
        k.stability = Utils.clamp(_num(k.stability) + _num(X.stability), 0, 100);
        if (_num(X.prestige) < 0 && player.house) House.spend(player.house, Math.min(House.getPrestige(player), -_num(X.prestige)), `the realm split by ${cl.name}`, day);
        court.stats.revoltsConceded = _num(court.stats.revoltsConceded) + 1;
        const claim = Throne.grantClaim(player, world, nk.id, 'blood', _num(X.claimStrength));
        CrownSuccession._claimantLeaves(player, world, cl, Names.realm(nk.name));
        const st = CrownSuccession.state(player);
        st.splits.push({ kingdomId: nk.id, name: nk.name, from: k.id, fromName: k.name, claimant: cl.name, kind: cl.kind, day, towns: entries.map(e => e.settlement.name), reunited: null });
        const text = `🥀 The realm is split. ${cl.name} carries ${entries.length} town${entries.length === 1 ? '' : 's'} (${entries.map(e => e.settlement.name).join(', ')}) out of ${Names.realm(k.name)} and is crowned in ${nk.name}, a rival with a claim on your crown. You hold a blood claim of ${claim} on it.`;
        const proseKey = `crownSuccession:${k.id}:${day}:split`;
        CrownSuccession._prose(world, proseKey, { event: 'the realm splits after a war of succession', realm: k.name, claimant: cl.name, newRealm: nk.name, towns: entries.map(e => e.settlement.name) }, text);
        CrownSuccession._record(player, world, { kingdomId: k.id, heir: rv.succession.heir, outcome: 'split', claimant: { name: cl.name, kind: cl.kind }, newKingdomId: nk.id, newKingdom: nk.name, towns: entries.length, text, proseKey });
        CrownSuccession._chronicle(player, world, k, text, ['succession', 'loss']);
        Interrupts.raise(world, { reason: `${cl.name} carries off part of the realm`, icon: '🥀', source: 'crownSuccession' });
        return text;
    },

    /** A new kingdom of `entries` (towns of `parent`), ruled by `ch`. Like Throne.foundKingdom, for an AI crown. */
    _carveRealm(world, parent, entries, ch, rv, cl) {
        const X = CrownSuccession.config().split;
        const day = _day(world);
        const ids = new Set(world.kingdoms.map(x => x.id));
        let n = 1;
        while (ids.has(`breakaway_${n}`)) n++;
        const id = `breakaway_${n}`;
        const palette = ['#7b1fa2', '#00695c', '#ad1457', '#4e342e', '#283593', '#827717', '#bf360c', '#37474f'];
        const used = new Set(world.kingdoms.map(x => String(x.color || '').toLowerCase()));
        const color = palette.find(c => !used.has(c)) || '#5d4037';
        const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
        const leaderSeat = entries.slice().sort((a, b) => _num(b.settlement.population) - _num(a.settlement.population))[0];
        const name = `Kingdom of ${leaderSeat.settlement.name}`;
        const k = Kingdom.create({
            id, name, ruler: Characters.getFullName(ch), color, colorLight: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.2)`,
            culture: ch.culture || parent.culture,
            description: `A realm carved out of ${parent.name} by ${cl.name} in a war of succession.`,
            preferredTerrain: parent.preferredTerrain || ['plains', 'grassland', 'hills'], traits: ['aggressive'],
        });
        k.foundedDay = day;
        k.capital = { q: leaderSeat.q, r: leaderSeat.r };
        k.colonization = { policy: 'coexistence', colonies: [], pioneersActive: 0 };
        k.truces = {};
        k.warState = {};
        k.stability = 45;
        k.crownClaim = { on: parent.id, since: day, claimant: cl.name, kind: cl.kind };
        const keys = new Set(entries.map(e => _key(e.q, e.r)));
        const take = (tile) => {
            const owner = tile.kingdom ? Throne._kingdom(world, tile.kingdom) : null;
            if (owner && Array.isArray(owner.territory)) owner.territory = owner.territory.filter(t => t.q !== tile.q || t.r !== tile.r);
            tile.kingdom = id;
            if (!k.territory.some(t => t.q === tile.q && t.r === tile.r)) k.territory.push({ q: tile.q, r: tile.r });
        };
        let population = 0;
        for (const e of entries) {
            take(e.tile);
            if (e.settlement.kingdom && !e.settlement.formerKingdom) e.settlement.formerKingdom = e.settlement.kingdom;
            e.settlement.kingdom = id;
            population += _num(e.settlement.population);
            for (const nb of Hex.neighbors(e.q, e.r)) {
                const nt = world.getTile(Hex.wrapQ ? Hex.wrapQ(nb.q, world.width) : nb.q, nb.r);
                if (!nt || !nt.terrain || !nt.terrain.passable) continue;
                if (nt.settlement && !keys.has(_key(nt.q, nt.r))) continue;
                if (nt.kingdom !== parent.id) continue;
                take(nt);
            }
        }
        k.population = population;
        // The rebel host is the new crown's army (the levies it took from the old one)
        k.military = Math.max(_num(X.minMilitary, 20), Math.round(_num(rv.strength)));
        if (parent.religion) k.religion = { ...JSON.parse(JSON.stringify(parent.religion)), heresies: [], holySites: [], pilgrimIncome: 0 };
        for (const o of world.kingdoms) {
            if (!o.relations) o.relations = {};
            const toNew = o.id === parent.id ? _num(X.relations) : Utils.randInt(-10, 10);
            o.relations[id] = toNew;
            k.relations[o.id] = o.id === parent.id ? _num(X.relations) : Utils.randInt(-10, 10);
        }
        // A truce while both lick their wounds
        if (!parent.truces) parent.truces = {};
        parent.truces[id] = day + _num(X.truceDays);
        k.truces[parent.id] = day + _num(X.truceDays);
        world.kingdoms.push(k);
        k.lord = NPCLords.generateLord(k);
        if (typeof Characters.generateRoyalFamily === 'function') k.characterData = Characters.generateRoyalFamily(k, world);
        if (k.characterData) Throne._installRuler(world, k, ch);
        else k.ruler = Characters.getFullName(ch);
        if (k.lord) k.lord.name = k.ruler;
        KingdomNavy.ensure(k);
        // The new crown's first chests: its own towns' first taxes (no coin from nowhere)
        k.treasury = 0;
        Economy.crownRaise(k, world, 300, 0.2);
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        return k;
    },

    // ── Preparation in life ─────────────────────────────────────

    _court(player, world) {
        const k = Throne.ruledKingdom(player, world);
        const court = k ? Kingship.court(player) : null;
        return { k, court };
    },

    _payCapital(world, k, amount) {
        if (!(amount > 0) || !k) return;
        const cap = k.capital && world.getTile(k.capital.q, k.capital.r);
        if (cap && cap.settlement && cap.settlement.kingdom === k.id && cap.settlement.economy) Economy.payTown(cap.settlement, amount);
        else if (!Economy.payRealm(k, world, amount)) Economy.payNearest(world, k.capital ? k.capital.q : 0, k.capital ? k.capital.r : 0, amount);
    },

    /** Crown the heir in your lifetime: Prestige and a coronation feast (paid to the capital). */
    crownHeir(player, world) {
        const P = CrownSuccession.config().prep.coronation;
        const { k } = CrownSuccession._court(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const heir = (player.children || []).find(c => c.id === player.heir && c.isAlive !== false);
        if (!heir) return { success: false, reason: 'Name your heir first (Dynasty → House → Heir).' };
        if (_num(heir.age) < _num(P.minAge)) return { success: false, reason: `${heir.firstName} must be ${P.minAge} to be crowned.` };
        const prep = CrownSuccession.prep(player, k.id);
        if (prep.crowned && prep.crowned.heirId === heir.id) return { success: false, reason: `${heir.firstName} is already crowned.` };
        if (Inheritance.coin(player) < _num(P.gold)) return { success: false, reason: `The coronation feast costs ${Utils.formatGold(P.gold)}g.` };
        if (!House.spend(player.house, _num(P.prestige), `crowned ${heir.firstName} in the ruler's lifetime`, _day(world))) return { success: false, reason: `Need ${P.prestige} Prestige.` };
        Inheritance.setCoin(player, Inheritance.coin(player) - _num(P.gold));
        Ledger.record(player, 'family', -_num(P.gold));
        CrownSuccession._payCapital(world, k, _num(P.gold));
        prep.crowned = { heirId: heir.id, day: _day(world), name: heir.firstName };
        const text = `👑 ${heir.firstName} is anointed and crowned beside you in ${Names.realm(k.name)}: the realm has two crowned heads, and one heir.`;
        CrownSuccession._chronicle(player, world, k, text, ['succession', 'heirs']);
        return { success: true, message: text };
    },

    /** The lords swear to the heir: each with opinion minOpinion+ swears (v.heirOath); the rest refuse. */
    takeOaths(player, world) {
        const P = CrownSuccession.config().prep.oaths;
        const { k, court } = CrownSuccession._court(player, world);
        if (!k || !court) return { success: false, reason: 'You rule no realm.' };
        const heir = (player.children || []).find(c => c.id === player.heir && c.isAlive !== false);
        if (!heir) return { success: false, reason: 'Name your heir first (Dynasty → House → Heir).' };
        const prep = CrownSuccession.prep(player, k.id);
        const day = _day(world);
        if (prep.oathsDay != null && day - prep.oathsDay < _num(P.cooldownDays)) return { success: false, reason: `The lords swore ${day - prep.oathsDay} days ago; call them again in ${_num(P.cooldownDays) - (day - prep.oathsDay)} days.` };
        if (court.revolt) return { success: false, reason: 'Not while lords are in revolt.' };
        if (Inheritance.coin(player) < _num(P.gold)) return { success: false, reason: `The gathering costs ${Utils.formatGold(P.gold)}g.` };
        if (!House.spend(player.house, _num(P.prestige), `the lords' oaths to ${heir.firstName}`, day)) return { success: false, reason: `Need ${P.prestige} Prestige.` };
        Inheritance.setCoin(player, Inheritance.coin(player) - _num(P.gold));
        Ledger.record(player, 'family', -_num(P.gold));
        CrownSuccession._payCapital(world, k, _num(P.gold));
        prep.oathsDay = day;
        const sworn = [];
        const refused = [];
        for (const v of court.vassals) {
            if (v.rebel) continue;
            if (_num(v.opinion) >= _num(P.minOpinion)) { v.heirOath = { heirId: heir.id, day }; sworn.push(Kingship.fullName(v)); } else refused.push(Kingship.fullName(v));
        }
        const text = `🤝 ${sworn.length} lord${sworn.length === 1 ? '' : 's'} of ${Names.realm(k.name)} swear${sworn.length === 1 ? 's' : ''} to ${heir.firstName}${sworn.length ? `: ${sworn.join(', ')}` : ''}.${refused.length ? ` ${refused.join(', ')} will not.` : ''}`;
        Kingship._log(court, world, text);
        if (player.house) House._chronicle(player.house, world, text, ['succession', 'court']);
        return { success: true, message: text, sworn: sworn.length, refused: refused.length };
    },

    _otherChild(player, childId) {
        const c = (player.children || []).find(x => x.id === childId && x.isAlive !== false);
        if (!c) return { error: 'No such child.' };
        if (c.id === player.heir) return { error: `${c.firstName} is your heir.` };
        return { child: c };
    },

    /** Give a younger child a portion (step gold) from the purse into theirs: a claim bought off. */
    givePortion(player, world, childId) {
        const step = _num(CrownSuccession.config().prep.portion.step, 250);
        const got = CrownSuccession._otherChild(player, childId);
        if (got.error) return { success: false, reason: got.error };
        if (Inheritance.coin(player) < step) return { success: false, reason: `You need ${Utils.formatGold(step)}g.` };
        Inheritance.setCoin(player, Inheritance.coin(player) - step);
        Ledger.record(player, 'family', -step);
        got.child.purse = _num(got.child.purse) + step;
        return { success: true, message: `${got.child.firstName}'s portion is now ${Utils.formatGold(got.child.purse)}g. A provided-for child presses no claim.` };
    },

    /** A younger child takes holy orders: alms to the church (the capital's purse), the claim renounced for good. */
    sendToChurch(player, world, childId) {
        const P = CrownSuccession.config().prep.orders;
        const { k } = CrownSuccession._court(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const got = CrownSuccession._otherChild(player, childId);
        if (got.error) return { success: false, reason: got.error };
        const c = got.child;
        if (_num(c.age) < _num(P.minAge)) return { success: false, reason: `${c.firstName} is too young for vows (${P.minAge}).` };
        if (c.upbringing && c.upbringing.spouse) return { success: false, reason: `${c.firstName} is wed.` };
        const cs = CrownSuccession._childState(c);
        if (cs.orders) return { success: false, reason: `${c.firstName} is already in holy orders.` };
        if (Inheritance.coin(player) < _num(P.gold)) return { success: false, reason: `The alms are ${Utils.formatGold(P.gold)}g.` };
        Inheritance.setCoin(player, Inheritance.coin(player) - _num(P.gold));
        Ledger.record(player, 'family', -_num(P.gold));
        CrownSuccession._payCapital(world, k, _num(P.gold));
        cs.orders = _day(world);
        if (player.house) {
            for (const r of House.ROLE_IDS) if (player.house.roles && player.house.roles[r] === c.id && r !== 'heir') player.house.roles[r] = null;
            House._chronicle(player.house, world, `${c.firstName} takes holy orders, and gives up any claim to the crown.`, ['succession', 'faith']);
        }
        return { success: true, message: `${c.firstName} takes holy orders. No claim of theirs will trouble the crown.` };
    },

    /** Pension the old royal line (gold into the capital, where its household lives): quiet for `years`. */
    pensionOldLine(player, world) {
        const P = CrownSuccession.config().prep.pension;
        const { k } = CrownSuccession._court(player, world);
        const line = k ? CrownSuccession.oldLine(player, world, k) : null;
        if (!line) return { success: false, reason: 'No old royal line troubles this crown.' };
        if (line.quiet) return { success: false, reason: `${line.name} is already pensioned.` };
        if (Inheritance.coin(player) < _num(P.gold)) return { success: false, reason: `The pension is ${Utils.formatGold(P.gold)}g.` };
        Inheritance.setCoin(player, Inheritance.coin(player) - _num(P.gold));
        Ledger.record(player, 'family', -_num(P.gold));
        CrownSuccession._payCapital(world, k, _num(P.gold));
        CrownSuccession.prep(player, k.id).quietUntil = _day(world) + _num(P.years) * CrownSuccession._Y();
        const text = `🏚️ ${line.name} of the old line takes a pension of ${Utils.formatGold(P.gold)}g and keeps quiet for ${P.years} years.`;
        CrownSuccession._chronicle(player, world, k, text, ['succession']);
        return { success: true, message: text };
    },

    /** Shut the old line's claimant in a cloister: Prestige and the realm's unease; the line is broken for `years`. */
    cloisterOldLine(player, world) {
        const P = CrownSuccession.config().prep.cloister;
        const { k } = CrownSuccession._court(player, world);
        const line = k ? CrownSuccession.oldLine(player, world, k) : null;
        if (!line) return { success: false, reason: 'No old royal line troubles this crown.' };
        if (!House.spend(player.house, _num(P.prestige), `shut ${line.name} in a cloister`, _day(world))) return { success: false, reason: `Need ${P.prestige} Prestige.` };
        const prep = CrownSuccession.prep(player, k.id);
        prep.brokenUntil = _day(world) + _num(P.years) * CrownSuccession._Y();
        if (line.charId && k.characterData && Array.isArray(k.characterData.children)) {
            const royal = k.characterData.children.find(c => c.id === line.charId);
            if (royal) k.characterData.children = k.characterData.children.filter(c => c !== royal);
        }
        prep.pretender = null;
        k.stability = Utils.clamp(_num(k.stability) + _num(P.stability), 0, 100);
        const text = `⛪ ${line.name}, last claimant of the old line, is shut in a cloister. The realm mutters (${P.stability} stability); the line is broken for a generation.`;
        CrownSuccession._chronicle(player, world, k, text, ['succession']);
        return { success: true, message: text };
    },

    // ── The days ────────────────────────────────────────────────

    /**
     * The world's day with the player: once a year, each breakaway realm
     * weighs a war to take the rest of the crown it claims (truce over, host
     * strong enough); a breakaway that falls is the realm made whole again.
     * Player-held: nothing runs with no player (the interregnum).
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !world || !_obj(player.crownSuccession)) return out;
        const st = CrownSuccession.state(player);
        if (!st.splits.length) return out;
        const day = _day(world);
        const X = CrownSuccession.config().split;
        const yearly = day % CrownSuccession._Y() === 0;
        for (const sp of st.splits) {
            if (sp.reunited != null) continue;
            const nk = Throne._kingdom(world, sp.kingdomId);
            const parent = Throne._kingdom(world, sp.from);
            if (!nk || !nk.isAlive) {
                sp.reunited = day;
                const mine = parent && parent.isAlive && player.throne && player.throne.ruling && player.throne.ruling.kingdomId === parent.id;
                const text = mine ? `👑 ${sp.name} is no more: the realm ${sp.claimant} carved away is whole again.` : `${sp.name}, carved out by ${sp.claimant}, is no more.`;
                if (mine && _num(X.reunitedPrestige)) House.award(player.house, _num(X.reunitedPrestige), `made ${Names.realm(parent.name)} whole again`, day);
                CrownSuccession._chronicle(player, world, parent, text, mine ? ['succession'] : []);
                out.notices.push({ icon: '👑', title: 'The Realm Made Whole', text, type: mine ? 'success' : 'info' });
                continue;
            }
            if (!yearly || !parent || !parent.isAlive || !nk.crownClaim || nk.crownClaim.on !== parent.id) continue;
            if ((nk.wars || []).includes(parent.id) || KingdomAI.hasTruce(nk, parent, world)) continue;
            if (_num(nk.military) < _num(parent.military) * _num(X.reunionMilitaryShare)) continue;
            KingdomAI.startWar(nk, parent, world);
            const text = `⚔️ ${nk.ruler} of ${nk.name} goes to war to take the rest of the crown of ${Names.realm(parent.name)}.`;
            CrownSuccession._chronicle(player, world, parent, text, []);
            out.notices.push({ icon: '⚔️', title: 'The Breakaway Strikes', text, type: 'error' });
            Interrupts.raise(world, { reason: `${nk.name} goes to war for your crown`, icon: '⚔️', source: 'crownSuccession' });
        }
        return out;
    },

    // ── Save / load ─────────────────────────────────────────────

    serialize(player) {
        return player && _obj(player.crownSuccession) ? JSON.parse(JSON.stringify(player.crownSuccession)) : null;
    },

    loadState(player) {
        if (!player) return;
        if (!_obj(player.crownSuccession)) { player.crownSuccession = null; return; }
        CrownSuccession.state(player);
    },
};
