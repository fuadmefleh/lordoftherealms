// ============================================
// STEWARDS — delegation: reeves, bailiffs and governors with agency
// ============================================
// A great House cannot ride to every holding. The player names a real person
// (a spouse or grown child, a courtier, a travelling companion, or one of the
// townsfolk of the place) to run each of their seats by a standing order, and
// they run it as their skill, honesty, loyalty and ambition make them:
//
//   SEATS     holding:q,r   a settlement the player holds (systems/holdings.js):
//                           the office IS the holding's governor
//                           (settlement.holding.governor), extended here with
//                           `gov.st` — Holdings.computeFx reads gov.st.fx (the
//                           standing order's effects) and gov.st.skim.
//             province:q,r  a demesne town of the realm the player rules
//                           (systems/kingship.js: a town no vassal holds):
//                           the royal governor's collect / skim are published
//                           on settlement.provinceFx, read by the crown's tax
//                           collectors (systems/fiscal.js).
//             estates       the player's estate lands (systems/landMarket.js):
//                           the bailiff's cut, pressure and skim are published
//                           on player.stewards.estatesFx, read at rent day.
//             company       the trading company (systems/merchantHouses.js):
//                           the chief factor polices the posts' factors.
//   ORDERS    data/stewards.json → orders: maximise revenue, keep them fed,
//             build defences, keep the peace, grow the town, watch the
//             factors. Their effects scale with the holder's skill. A works
//             allowance lets a steward start the holding's projects
//             (Holdings.startProject, paid from the player's purse) on the
//             order's list of works — and a crooked one pads the bill.
//   AGENCY    weekly, on its own seeded stream:
//               embezzle  the dishonest pocket part of the take (real coin out
//                         of the town's purse / the crown's collection / the
//                         rents / the company's capital, into their pocket)
//               excel     the able and honest settle feuds, hurry the works
//               abuse     the cruel and the greedy extort and bully: unrest
//               bribes    a rival House with a feud buys them (its own gold)
//               power     a power base grows with years, ambition and a
//                         content town; ambitious, disloyal and strong, they
//                         rise (a holding's rebellion, a province's defiance,
//                         a company's chief factor defecting with capital)
//               marriage  the ambitious and loyal ask for the hand of an
//                         unwed child of the House (answered in the panel)
//   REPORTS   a season's dispatch from every office arrives as one court
//             letter (CourtLetters.deliver, kind family_report). A dishonest
//             steward's account is rosier than the truth; the town's talk
//             (suspicion) shows through.
//   THE LORD  audit (fee; may find the pocket, claws most of it back — and
//             insults the honest), reward (gold, public honour), recall,
//             punish (fine, disgrace). Offices outlive the lord: at a
//             succession, those sworn to the House stay; those who served the
//             person stay if loyal or honest, else resign — or defy the heir.
//
// State: player.stewards (saved by SaveLoad): non-holding offices, pending
// proposals, reports, log, stats. Holding offices live on the tiles with the
// holding. All rolls come from a seeded stream (world seed + day) or, for the
// player's own actions, Utils.random. No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Economy } from '../world/economy.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Holdings } from './holdings.js';
import { Taxation } from './marketDynamics.js';
import { Relationships } from './relationships.js';
import { Companions } from './companions.js';
import { Court } from './court.js';
import { House } from './house.js';
import { Townsfolk } from './townsfolk.js';
import { Throne } from './throne.js';
import { Kingship } from './kingship.js';
import { LandMarket } from './landMarket.js';
import { MerchantHouses } from './merchantHouses.js';
import { Upbringing } from './upbringing.js';
import { CourtLetters } from './courtLetters.js';
import { Ledger } from './ledger.js';
import { LlmProse } from './llmProse.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day);
const _r2 = (v) => Math.round(v * 100) / 100;
const _key = (q, r) => `${q},${r}`;

function _hash(str) {
    let h = Utils.hashStr(String(str)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function _h01(str) {
    return (_hash(str) % 100003) / 100003;
}

function _seed(world) {
    const p = world && world.generationParams;
    return p && p.seed != null ? p.seed : 0;
}

function _traitIds(list) {
    return (list || []).map(t => (typeof t === 'string' ? t : (t && t.id))).filter(Boolean);
}

const DEFAULTS = {
    weekDays: 7, reportDays: 30, maxReports: 12, logCap: 40, pendingDays: 20,
    maxTownsfolkCandidates: 4, townsfolkMinAge: 18, townsfolkWage: [2, 5], provinceWage: [4, 8], companyWage: [6, 12],
    honesty: { base: 0.62, jitter: 0.3, kin: 0.12, min: 0.05, max: 0.98, guessNoise: 0.2 },
    embezzle: { below: 0.62, rate: 0.5, max: 0.3, fearDecay: 0.02, auditFear: 0.5, punishFear: 0.8 },
    abuse: { chance: 0.05, unrest: 6, happiness: 4, extortShare: 0.15, suspicion: 12 },
    excel: { minSkill: 6, chance: 0.06, unrest: 8, happiness: 3, buildDays: 2, renown: 1 },
    bribe: { minFeud: 35, chance: 0.03, gold: [60, 220], skim: 0.08, loyalty: -12, suspicion: 8, acceptBelow: 0.55 },
    power: { perYear: 6, ambition: 0.6, intrigue: 0.4, mood: 0.05, kin: 10, cap: 100, recallDrop: 100, decayWhenLoyal: 0.4 },
    revolt: { power: 70, loyalty: 35, ambition: 6, chance: 0.08, rebelBonus: 0.5, defyDays: 60 },
    marriage: { ambition: 5, loyalty: 50, power: 35, chance: 0.04, minAge: 16, everyDays: 360, acceptLoyalty: 20, acceptPower: 15, acceptAmbition: -2, refuseLoyalty: -12, prestige: 2 },
    audit: { cost: 40, costPerIncome: 0.1, cooldown: 30, baseChance: 0.4, perSkill: 0.05, recover: 0.7, insult: -4, suspicionShown: 35 },
    reward: { goldLoyalty: 0.06, goldMin: 20, honourPrestige: 4, honourLoyalty: 10, honourPower: 6 },
    punish: { fineLoyalty: -25, disgraceRenown: 2, innocentLoyalty: -6, innocentRenown: -3, shamePower: 30 },
    recall: { refuseChance: 0.5, refusePower: 60, refuseLoyalty: 30 },
    succession: { personStayLoyalty: 60, personStayHonesty: 0.75, loyaltyShift: -8, defyPower: 55 },
    allowanceSteps: [0, 100, 250, 500, 1000],
    worksPad: 0.25,
};

const FALLBACK_ORDERS = {
    balanced: { name: 'Keep things as they are', icon: '⚖️', for: ['holding', 'province', 'estates', 'company'], fx: {}, embezzle: 1, abuse: 1 },
};

// The LLM's prose (systems/llmProse.js): plain templates until the scribe writes them.
const _prose = LlmProse;
function _loadProse() {}

/** LLM prose for a key, else the fallback (and asks for it to be written). */
function _proseWrite(world, kind, key, facts, fallback) {
    _loadProse();
    try {
        if (_prose && typeof _prose.write === 'function') return _prose.write(world, { kind, key, facts, fallback }) || fallback;
    } catch (e) { /* the template stands */ }
    return fallback;
}

function _proseText(world, key, fallback) {
    try {
        if (_prose && typeof _prose.text === 'function') return _prose.text(world, key, fallback) || fallback;
    } catch (e) { /* the template stands */ }
    return fallback;
}

const BASE_LOYALTY = { family: 80, companion: 60, courtier: 60, townsfolk: 55, steward: 55 };

export const Stewards = {

    // ──────────── DATA ────────────

    data() {
        const gd = DataLoader._gamedata;
        return _obj(gd && gd.stewards) || _obj(DataLoader.stewards) || {};
    },

    config() {
        const d = _obj(Stewards.data().config) || {};
        const out = { ...DEFAULTS, ...d };
        for (const [k, v] of Object.entries(DEFAULTS)) {
            if (_obj(v)) out[k] = { ...v, ...(_obj(d[k]) || {}) };
        }
        return out;
    },

    orders(kind = null) {
        const all = _obj(Stewards.data().orders) || FALLBACK_ORDERS;
        if (!kind) return all;
        const out = {};
        for (const [id, o] of Object.entries(all)) if (!Array.isArray(o.for) || o.for.includes(kind)) out[id] = o;
        return out;
    },

    order(id) {
        return Stewards.orders()[id] || Stewards.orders().balanced || FALLBACK_ORDERS.balanced;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            v: 1, seats: {}, pending: [], reports: [], log: [], nextId: 1,
            lastReportDay: null, reign: null, estatesFx: null,
            stats: { appointed: 0, recalled: 0, rewarded: 0, punished: 0, audits: 0, caught: 0, recovered: 0, excelled: 0, abuses: 0, bribed: 0, refusedBribes: 0, risings: 0, defections: 0, marriages: 0, resigned: 0, servedHeirs: 0, worksStarted: 0, died: 0 },
        };
    },

    /** The player's record (created and backfilled on demand). */
    state(player) {
        if (!player) return null;
        if (!_obj(player.stewards)) player.stewards = Stewards._blank();
        const st = player.stewards;
        const b = Stewards._blank();
        for (const k of ['seats']) if (!_obj(st[k])) st[k] = {};
        for (const k of ['pending', 'reports', 'log']) if (!Array.isArray(st[k])) st[k] = [];
        if (!(st.nextId > 0)) st.nextId = 1;
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && _obj(player.stewards) ? JSON.parse(JSON.stringify(player.stewards)) : null;
    },

    loadState(player) {
        if (player && _obj(player.stewards)) Stewards.state(player);
    },

    _log(player, world, text) {
        const st = Stewards.state(player);
        st.log.push({ day: _day(world), text });
        const cap = Stewards.config().logCap;
        if (st.log.length > cap) st.log.splice(0, st.log.length - cap);
    },

    _note(out, icon, title, text, type = 'info') {
        if (out) out.notices.push({ icon, title, text, type });
    },

    // ──────────── SEATS ────────────

    /** Title of an office: Reeve of a hamlet, Governor of a city, Bailiff, Chief Factor, Royal Governor. */
    titleFor(seat) {
        const T = _obj(Stewards.data().titles) || {};
        if (seat.kind === 'holding') {
            const list = Array.isArray(T.holding) ? T.holding : ['Reeve', 'Reeve', 'Steward', 'Governor'];
            return list[_clamp(Holdings.tierIndex(seat.settlement), 0, list.length - 1)] || 'Governor';
        }
        return T[seat.kind] || { province: 'Royal Governor', estates: 'Bailiff', company: 'Chief Factor' }[seat.kind] || 'Steward';
    },

    /** Demesne towns of the realm the player rules: no vassal seated there, not a holding. */
    _provinces(player, world) {
        const k = Throne.ruledKingdom(player, world);
        if (!k) return [];
        const court = Kingship.court(player);
        const held = new Set(((court && court.vassals) || []).filter(v => v.seat && !v.rebel).map(v => _key(v.seat.q, v.seat.r)));
        const mine = new Set(Holdings.list(player, world).map(h => h.key));
        return Throne._settlementsOf(world, k)
            .filter(e => !held.has(_key(e.q, e.r)) && !mine.has(_key(e.q, e.r)))
            .map(e => ({ ...e, kingdom: k }));
    },

    /**
     * Every seat the player could put someone over:
     * [{ id, kind, title, place, q?, r?, key?, settlement?, kingdom? }].
     */
    seats(player, world) {
        if (!player || !world) return [];
        const out = [];
        for (const ref of Holdings.list(player, world)) {
            const seat = { id: `holding:${ref.key}`, kind: 'holding', q: ref.q, r: ref.r, key: ref.key, settlement: ref.settlement, place: ref.settlement.name };
            seat.title = Stewards.titleFor(seat);
            out.push(seat);
        }
        for (const e of Stewards._provinces(player, world)) {
            const key = _key(e.q, e.r);
            out.push({ id: `province:${key}`, kind: 'province', q: e.q, r: e.r, key, settlement: e.settlement, kingdom: e.kingdom, place: e.settlement.name, title: Stewards.titleFor({ kind: 'province' }) });
        }
        if (world.estates && LandMarket.mine(player, world).length) {
            out.push({ id: 'estates', kind: 'estates', place: 'your estates', title: Stewards.titleFor({ kind: 'estates' }) });
        }
        if (MerchantHouses.hasCompany(player)) {
            const c = MerchantHouses.company(player);
            out.push({ id: 'company', kind: 'company', place: c.name || 'the company', title: Stewards.titleFor({ kind: 'company' }) });
        }
        return out;
    },

    seat(player, world, seatId) {
        return Stewards.seats(player, world).find(s => s.id === seatId) || null;
    },

    /** The office over a seat (the holding's governor, or a record on player.stewards). */
    office(player, seat) {
        if (!seat) return null;
        if (seat.kind === 'holding') {
            const h = seat.settlement && seat.settlement.holding;
            return (h && h.governor) || null;
        }
        const st = player && _obj(player.stewards);
        return (st && st.seats[seat.id]) || null;
    },

    /** Every filled office: [{ seat, office }] (holdings first). */
    offices(player, world) {
        return Stewards.seats(player, world).map(seat => ({ seat, office: Stewards.office(player, seat) })).filter(x => x.office);
    },

    // ──────────── PEOPLE ────────────

    _npc(player, id) {
        return Relationships.getNPC(id) || ((player && player._relationshipNpcs) || []).find(n => n && n.id === id) || null;
    },

    /** The living person behind an office (an NPC, or a child of the House), or null. */
    person(player, office) {
        if (!office) return null;
        if (office.kind === 'family') {
            const child = ((player && player.children) || []).find(c => c && c.id === office.id);
            if (child) return child.isAlive === false ? null : child;
        }
        if (office.kind === 'steward') return { id: office.id, firstName: office.name, isAlive: true, hired: true };
        const npc = Stewards._npc(player, office.id);
        return npc && npc.isAlive !== false ? npc : null;
    },

    /** Honesty from the traits, kinship and a little of the person's own (hash of who they are). */
    _honesty(id, traits, kin) {
        const H = Stewards.config().honesty;
        const tab = _obj(Stewards.data().honesty) || {};
        let v = _num(H.base) + (_h01(`stew-honest:${id}`) * 2 - 1) * _num(H.jitter);
        for (const t of traits) v += _num(tab[t]);
        if (kin) v += _num(H.kin);
        return _r2(_clamp(v, _num(H.min, 0.05), _num(H.max, 0.98)));
    },

    _honestyGuess(id, honesty) {
        const H = Stewards.config().honesty;
        return _r2(_clamp(honesty + (_h01(`stew-guess:${id}`) * 2 - 1) * _num(H.guessNoise), 0, 1));
    },

    /** What people say of a candidate's honesty (a guess, not the truth). */
    reference(guess) {
        const v = _num(guess, 0.5);
        if (v >= 0.85) return { label: 'spotless name', tone: 'good' };
        if (v >= 0.65) return { label: 'well spoken of', tone: 'good' };
        if (v >= 0.45) return { label: 'mixed talk', tone: 'warn' };
        return { label: 'a doubtful past', tone: 'bad' };
    },

    _ambition(id, traits, intrigue) {
        const tab = _obj(Stewards.data().ambition) || {};
        let v = _num(intrigue) * 0.5 + (_hash(`stew-amb:${id}`) % 4);
        for (const t of traits) v += _num(tab[t]);
        return Math.round(_clamp(v, 0, 10));
    },

    ambitionLabel(a) {
        return a >= 7 ? 'ambitious' : a >= 4 ? 'aspiring' : 'content';
    },

    /** A full candidate record from a base profile. */
    _candidate(base) {
        const traits = base.traits || [];
        const kin = base.kind === 'family';
        const honesty = Stewards._honesty(base.uid || base.id, traits, kin);
        const guess = Stewards._honestyGuess(base.uid || base.id, honesty);
        const oath = (Stewards.data().oathOfHouse || ['family', 'courtier']).includes(base.kind) || traits.includes('loyal') ? 'house' : 'person';
        return {
            ...base, traits, honesty, honestyGuess: guess, reference: Stewards.reference(guess),
            ambition: Stewards._ambition(base.uid || base.id, traits, base.intrigue), oath,
        };
    },

    /** Townsfolk of a town who could take an office: grown, at home, not already serving. */
    _folkCandidates(world, settlement, q, r, busy, cfg) {
        if (!settlement) return [];
        let folk = settlement.folk;
        if (!folk) {
            try { folk = settlement.folk = Townsfolk.seed(settlement, world, { q, r }); } catch (e) { folk = null; }
        }
        if (!folk || !Array.isArray(folk.people)) return [];
        const day = _day(world);
        const roles = _obj(Stewards.data().folkRoles) || {};
        const ftraits = _obj(Stewards.data().folkTraits) || {};
        const pool = Townsfolk.residents(folk).filter(p => p.role !== 'child' && p.role !== 'beggar' && !p.wedHouse
            && Townsfolk.age(p, day) >= cfg.townsfolkMinAge && Townsfolk.age(p, day) < 70);
        const out = [];
        for (const p of pool) {
            const uid = `${folk.q},${folk.r}#${p.id}`;
            const npc = Relationships.npcForPerson(folk, p);
            if (busy.has(uid) || (npc && busy.has(npc.id))) continue;
            if (npc && (npc.atCourt || npc.governing || Relationships.isInTravelParty({ travelParty: [] }, npc.id))) continue;
            const R = roles[p.retired || p.role] || roles.villager || {};
            const traits = [];
            for (const t of p.traits || []) for (const x of ftraits[t] || []) if (!traits.includes(x)) traits.push(x);
            const prof = { stewardship: 1 + _num(R.stewardship), martial: 1 + _num(R.martial), intrigue: 1 + _num(R.intrigue), loyaltyMod: 0 };
            for (const k of Holdings.STAT_KEYS) prof[k] += _hash(`stew-folk:${uid}:${k}`) % 4;
            for (const t of traits) Holdings._addMods(prof, (Holdings.data().governorTraits || {})[t]);
            Holdings._addMods(prof, (Holdings.data().governorOccupations || {})[R.occupation]);
            Holdings._clampProfile(prof);
            const [wLo, wHi] = Array.isArray(cfg.townsfolkWage) ? cfg.townsfolkWage : [2, 5];
            const wage = Math.round(wLo + (prof.stewardship / 10) * (wHi - wLo));
            const known = (p.mem && p.mem.timesSpoken) || 0;
            out.push({ kind: 'townsfolk', id: uid, uid, folkUid: uid, name: Townsfolk.name(p), blurb: `${Townsfolk.roleTitle(p)} of ${settlement.name}, age ${Townsfolk.age(p, day)}`, ...prof, traits, wage, score: prof.stewardship + prof.martial + prof.intrigue + Math.min(3, known) });
        }
        out.sort((a, b) => b.score - a.score || (a.uid < b.uid ? -1 : 1));
        return out.slice(0, cfg.maxTownsfolkCandidates);
    },

    /** Ids (npc / child / folk uid) already in an office. */
    _busy(player, world) {
        const ids = new Set();
        for (const { office } of Stewards.offices(player, world)) {
            ids.add(office.id);
            if (office.st && office.st.folkUid) ids.add(office.st.folkUid);
        }
        // the holdings' own governors (seats the list may miss) and the active regent
        for (const ref of Holdings.list(player, world)) {
            const g = ref.settlement.holding && ref.settlement.holding.governor;
            if (g) ids.add(g.id);
        }
        const reg = player && player.regency && player.regency.active && player.regency.regent;
        if (reg && reg.id) ids.add(reg.id);
        return ids;
    },

    /**
     * Who could take this office: the spouse, grown children, courtiers,
     * companions (holdings and provinces) and the townsfolk of the place.
     * @returns {Array<{ key, kind, id, name, blurb, stewardship, martial, intrigue, loyalty, wage, honestyGuess, reference, ambition, traits }>}
     */
    candidates(player, world, seatId) {
        const seat = Stewards.seat(player, world, seatId);
        if (!seat) return [];
        const cfg = Stewards.config();
        const G = Holdings.config().governor;
        const busy = Stewards._busy(player, world);
        const out = [];
        const seen = new Set();
        const push = (c) => {
            if (busy.has(c.id) || seen.has(c.id)) return;
            seen.add(c.id);
            const full = Stewards._candidate(c);
            full.key = `${c.kind}:${c.id}`;
            full.loyalty = _clamp(Math.round(_num(c.loyalty, _num(BASE_LOYALTY[c.kind], 55)) + _num(c.loyaltyMod)), 0, 100);
            out.push(full);
        };
        if (player.spouse) {
            const sp = Stewards._npc(player, player.spouse);
            if (sp && sp.isAlive !== false) {
                push({ kind: 'family', id: sp.id, name: `${sp.firstName || 'Your spouse'}${sp.dynasty ? ` ${sp.dynasty}` : ''}`, blurb: 'your spouse', ...Holdings.npcProfile(sp), traits: _traitIds(sp.traits), wage: 0, loyalty: G.baseLoyalty.family });
            }
        }
        for (const child of player.children || []) {
            if (!child || child.isAlive === false || _num(child.age) < G.familyMinAge || child.id === player.id) continue;
            if (Upbringing.isAway(child)) continue;
            push({ kind: 'family', id: child.id, name: `${child.firstName || 'Your child'}`, blurb: `your ${child.gender === 'female' ? 'daughter' : 'son'}, age ${child.age}`, ...Holdings.childProfile(child), traits: _traitIds(child.traits), wage: 0, loyalty: G.baseLoyalty.family });
        }
        for (const npc of Court.members(player)) {
            const e = Court.entry(player, npc.id) || {};
            const sk = Court.ensureSkills(npc) || {};
            const prof = Holdings.childProfile({ skills: sk, intelligence: 5, strength: 5, traits: npc.traits });
            push({ kind: 'courtier', id: npc.id, name: `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`, blurb: `courtier, ${npc.occupation || 'retainer'}`, ...prof, traits: _traitIds(npc.traits), wage: 0, loyalty: _num(e.loyalty, 55) });
        }
        if (seat.kind === 'holding' || seat.kind === 'province') {
            for (const npc of Companions.members(player, world)) {
                const p = Holdings.npcProfile(npc);
                push({ kind: 'companion', id: npc.id, name: `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`, blurb: `companion${npc.occupation ? `, ${npc.occupation}` : ''}`, ...p, traits: _traitIds(npc.traits), wage: _num(npc.companion && npc.companion.wage, 2), loyalty: _num(npc.companion && npc.companion.approval, G.baseLoyalty.companion) });
            }
        }
        // The townsfolk of the place (or, for the estates and the company, of the town you stand in or your first holding)
        let town = seat.settlement || null;
        let tq = seat.q;
        let tr = seat.r;
        if (!town && typeof world.getTile === 'function') {
            const here = world.getTile(player.q, player.r);
            if (here && here.settlement) { town = here.settlement; tq = player.q; tr = player.r; }
            else {
                const first = Holdings.list(player, world)[0];
                if (first) { town = first.settlement; tq = first.q; tr = first.r; }
            }
        }
        for (const c of Stewards._folkCandidates(world, town, tq, tr, busy, cfg)) {
            if (seat.kind === 'province') c.wage = Math.round(c.wage * 1.5);
            if (seat.kind === 'company') {
                const [lo, hi] = cfg.companyWage;
                c.wage = Math.round(lo + (c.stewardship / 10) * (hi - lo));
            }
            push(c);
        }
        out.sort((a, b) => Stewards.fitness(seat, b) - Stewards.fitness(seat, a));
        return out;
    },

    /** How well suited a candidate is to a seat and its order (the skills the order wants, a guessed honesty). */
    fitness(seat, c, orderId = null) {
        const o = Stewards.order(orderId || (seat.kind === 'company' ? 'watch' : 'balanced'));
        const main = _num(c[o.skill || 'stewardship']);
        return main * 2 + _num(c.stewardship) + _num(c.martial) * (seat.kind === 'holding' ? 0.6 : 0.2) + _num(c.intrigue) * 0.4
            + _num(c.honestyGuess, 0.5) * 6 + _num(c.loyalty, 50) / 20;
    },

    // ──────────── APPOINTING ────────────

    _newSt(cand, world) {
        return {
            orders: 'balanced', honesty: cand.honesty, honestyGuess: cand.honestyGuess, ambition: cand.ambition,
            traits: cand.traits.slice(0, 6), oath: cand.oath, folkUid: cand.folkUid || null,
            pocket: 0, embezzled: 0, skim: 0, fx: {}, fear: 0, power: 0, suspicion: 0,
            bribe: null, kin: cand.kind === 'family', defiant: 0,
            allowance: 0, spent: 0, lastAudit: -999, auditsPassed: 0, caught: false,
            excels: 0, abuses: 0, lastProposal: -999, servedLords: 0,
            season: { income: 0, skimmed: 0, excels: 0, abuses: 0, notes: [] },
            appointedDay: _day(world),
        };
    },

    /** Put a candidate (by key, from candidates()) over a seat. */
    appoint(player, world, seatId, key) {
        const seat = Stewards.seat(player, world, seatId);
        if (!seat) return { success: false, reason: 'That seat is not yours.' };
        const cand = Stewards.candidates(player, world, seatId).find(c => c.key === key);
        if (!cand) return { success: false, reason: 'That person cannot take the office.' };
        const day = _day(world);
        // A townsperson becomes someone the player knows (the relationships bridge)
        if (cand.kind === 'townsfolk') {
            const found = Relationships.folkPerson(world, cand.folkUid);
            if (!found) return { success: false, reason: 'They are not to be found.' };
            const res = Relationships.fromTownsperson(player, world, found.folk, found.p, found.settlement);
            if (!res.success) return { success: false, reason: res.reason };
            cand.id = res.npc.id;
        }
        const st = Stewards.state(player);
        const prev = Stewards.office(player, seat);
        if (prev) Stewards._vacate(player, world, seat, prev, 'replaced', null);
        const sto = Stewards._newSt(cand, world);
        sto.orders = Stewards._defaultOrder(seat);
        const rec = {
            kind: cand.kind, id: cand.id, name: cand.name,
            stewardship: cand.stewardship, martial: cand.martial, intrigue: cand.intrigue,
            loyaltyMod: _num(cand.loyaltyMod), loyalty: cand.loyalty, wage: _num(cand.wage),
            appointedDay: day, unpaid: 0, warned: false,
        };
        if (seat.kind === 'holding') {
            const hc = { ...rec, fee: 0 };
            const res = Holdings.appointGovernor(player, world, seat.q, seat.r, cand.id, { candidate: hc, extra: { st: sto } });
            if (!res.success) return res;
        } else {
            rec.st = sto;
            st.seats[seat.id] = rec;
            if (Relationships.isInTravelParty(player, cand.id)) Relationships.removeFromTravelParty(player, cand.id);
        }
        const npc = Stewards._npc(player, cand.id);
        if (npc && (cand.kind === 'courtier' || cand.kind === 'townsfolk' || seat.kind !== 'holding')) {
            if (seat.q != null) npc.governing = seat.key;
            npc.stewardOf = seat.id;
        }
        const office = Stewards.office(player, seat);
        Stewards._refreshFx(player, world, seat, office);
        st.stats.appointed++;
        const text = `${cand.name} is made ${seat.title.toLowerCase()} of ${seat.place}.`;
        Stewards._log(player, world, text);
        if (player.house) House._chronicle(player.house, world, text, ['stewards']);
        return { success: true, office, text };
    },

    _defaultOrder(seat) {
        return seat.kind === 'company' ? 'watch' : 'balanced';
    },

    /** Name the best candidate (by fitness) to a vacant seat — for the bot and "fill every vacant seat". */
    autoAppoint(player, world, seatId) {
        const seat = Stewards.seat(player, world, seatId);
        if (!seat || Stewards.office(player, seat)) return { success: false, reason: 'The seat is filled.' };
        const list = Stewards.candidates(player, world, seatId).filter(c => _num(c.honestyGuess, 0.5) >= 0.45 || c.kind === 'family');
        const best = list[0] || Stewards.candidates(player, world, seatId)[0];
        if (!best) return { success: false, reason: 'No one is fit for it.' };
        return Stewards.appoint(player, world, seatId, best.key);
    },

    /** Fill every empty seat: → { filled, results }. */
    fillVacant(player, world) {
        const results = [];
        for (const seat of Stewards.seats(player, world)) {
            if (Stewards.office(player, seat)) continue;
            const r = Stewards.autoAppoint(player, world, seat.id);
            if (r.success) results.push(r);
        }
        return { filled: results.length, results };
    },

    setOrders(player, world, seatId, orderId) {
        const seat = Stewards.seat(player, world, seatId);
        const office = Stewards.office(player, seat);
        if (!office) return { success: false, reason: 'No one holds that office.' };
        if (!Stewards.orders(seat.kind)[orderId]) return { success: false, reason: 'Not an order for this office.' };
        Stewards._ensureSt(office, world).orders = orderId;
        Stewards._refreshFx(player, world, seat, office);
        return { success: true, text: `${office.name} will ${Stewards.order(orderId).name.toLowerCase()} in ${seat.place}.` };
    },

    /** The same standing order for every office that takes it: → number changed. */
    setAllOrders(player, world, orderId) {
        let n = 0;
        for (const { seat } of Stewards.offices(player, world)) {
            if (Stewards.orders(seat.kind)[orderId] && Stewards.setOrders(player, world, seat.id, orderId).success) n++;
        }
        return n;
    },

    /** Gold a season the steward may spend from your purse on the holding's works. */
    setAllowance(player, world, seatId, gold) {
        const seat = Stewards.seat(player, world, seatId);
        const office = Stewards.office(player, seat);
        if (!office) return { success: false, reason: 'No one holds that office.' };
        if (seat.kind !== 'holding') return { success: false, reason: 'Only a holding has works to build.' };
        Stewards._ensureSt(office, world).allowance = Math.max(0, Math.round(_num(gold)));
        return { success: true };
    },

    /** Backfill the extension of an office made before this system (an old governor). */
    _ensureSt(office, world) {
        if (!_obj(office.st)) {
            const cand = Stewards._candidate({ kind: office.kind, id: office.id, intrigue: office.intrigue, traits: [] });
            office.st = Stewards._newSt(cand, world);
            office.st.appointedDay = _num(office.appointedDay, _day(world));
        }
        const s = office.st;
        if (!_obj(s.season)) s.season = { income: 0, skimmed: 0, excels: 0, abuses: 0, notes: [] };
        if (!Array.isArray(s.season.notes)) s.season.notes = [];
        if (!_obj(s.fx)) s.fx = {};
        return s;
    },

    // ──────────── EFFECTS ────────────

    /** Skill factor for an order: an average holder (5) gives the listed numbers. */
    _skillFactor(office, order) {
        return _clamp(_num(office[order.skill || 'stewardship'], 5) / 5, 0.3, 2);
    },

    /** Recompute the order's effects and publish them where the other systems read them. */
    _refreshFx(player, world, seat, office) {
        if (!seat || !office) return;
        const s = Stewards._ensureSt(office, world);
        const o = Stewards.order(s.orders);
        const f = Stewards._skillFactor(office, o);
        const fx = {};
        for (const [k, v] of Object.entries(o.fx || {})) fx[k] = _r2(v > 0 ? v * f : v) || 0;
        if (s.defiant > _day(world)) { fx.tax = (fx.tax || 0) - 1; }
        s.fx = fx;
        if (seat.kind === 'holding') {
            Holdings.refresh(seat.settlement);
        } else if (seat.kind === 'province') {
            const pf = _obj(seat.settlement.provinceFx) || {};
            const collect = s.defiant > _day(world) ? 0 : 1 + (_num(office.stewardship, 5) - 5) * 0.02 + (_num(o.collect) > 0 ? _num(o.collect) * f : _num(o.collect));
            seat.settlement.provinceFx = { collect: _r2(_clamp(collect, 0, 1.4)), skim: _r2(_num(s.skim)), pocket: _num(pf.pocket), by: office.id };
        } else if (seat.kind === 'estates') {
            const st = Stewards.state(player);
            const prev = _obj(st.estatesFx) || {};
            // A skilled bailiff collects for a smaller fee than the old 8%; the skim on top
            const cut = _clamp(0.09 - _num(office.stewardship, 5) * 0.006, 0.02, 0.1);
            st.estatesFx = {
                cut: _r2(cut + _num(s.skim)), skim: _r2(_num(s.skim)),
                collect: _r2(1 + (_num(o.collect) > 0 ? _num(o.collect) * f * 0.5 : _num(o.estateCollect))),
                loyalty: _num(o.estateLoyalty), pocket: _num(prev.pocket), by: office.id,
            };
        }
    },

    /** Where the office-holder's loyalty settles (non-holding offices; Holdings drifts its own governors'). */
    _loyaltyTarget(player, seat, office) {
        const town = seat.settlement || { happiness: 50 };
        let t = Holdings.governorLoyaltyTarget(player, town, office);
        if (office.kind === 'courtier') {
            const e = Court.entry(player, office.id);
            if (e) t += (_num(e.loyalty, 55) - 55) * 0.5;
        }
        return _clamp(t, 0, 100);
    },

    // ──────────── LEAVING OFFICE ────────────

    /** Take an office-holder out: their pocket goes with them; how: replaced|recalled|died|rebel|fled|resigned|disgraced. */
    _vacate(player, world, seat, office, how, out) {
        if (!seat || !office) return;
        const s = _obj(office.st) || {};
        const pocket = Math.floor(_num(s.pocket));
        const npc = Stewards._npc(player, office.id);
        if (pocket > 0) {
            if (npc && npc.isAlive !== false) npc.purse = _num(npc.purse) + pocket;
            else if (seat.settlement) Economy.payTown(seat.settlement, pocket);
        }
        if (npc) {
            if (npc.stewardOf === seat.id) delete npc.stewardOf;
            if (seat.kind !== 'holding' && npc.governing === seat.key) delete npc.governing;
            if (seat.kind === 'holding' && (office.kind === 'courtier' || office.kind === 'townsfolk')) delete npc.governing;
        }
        if (seat.kind === 'holding') {
            const h = seat.settlement.holding;
            if (h && h.governor === office) {
                const rejoin = how === 'recalled' || how === 'replaced';
                Holdings._releaseGovernor(player, office, rejoin);
                h.governor = null;
                Holdings.refresh(seat.settlement);
            }
        } else {
            const st = Stewards.state(player);
            delete st.seats[seat.id];
            if (seat.kind === 'province' && seat.settlement) delete seat.settlement.provinceFx;
            if (seat.kind === 'estates') st.estatesFx = null;
        }
        Stewards.state(player).pending = Stewards.state(player).pending.filter(p => p.seatId !== seat.id);
    },

    /** Relieve an office-holder. A powerful, disloyal one may refuse — and rise. */
    recall(player, world, seatId) {
        const seat = Stewards.seat(player, world, seatId);
        const office = Stewards.office(player, seat);
        if (!office) return { success: false, reason: 'No one holds that office.' };
        const s = Stewards._ensureSt(office, world);
        const R = Stewards.config().recall;
        if (s.power >= R.refusePower && office.loyalty < R.refuseLoyalty && Utils.random() < R.refuseChance) {
            const out = { notices: [] };
            Stewards._rise(player, world, seat, office, out);
            return { success: true, refused: true, text: out.notices.map(n => n.text).join(' ') || `${office.name} refuses to give up ${seat.place}.` };
        }
        Stewards._vacate(player, world, seat, office, 'recalled', null);
        Stewards.state(player).stats.recalled++;
        const text = `${office.name} is relieved as ${seat.title.toLowerCase()} of ${seat.place}.`;
        Stewards._log(player, world, text);
        return { success: true, text };
    },

    // ──────────── THE LORD'S HAND ────────────

    /** What an audit costs here (a fee and a share of the seat's income). */
    auditCost(player, world, seat) {
        const A = Stewards.config().audit;
        return Math.round(_num(A.cost) + _num(A.costPerIncome) * Stewards.weeklyIncome(player, world, seat) * 4);
    },

    /** The odds an audit finds a hand in the chest: your stewardship of your own (commerce), your House steward's, a spymaster. */
    auditChance(player, office) {
        const A = Stewards.config().audit;
        const skills = (player && player.skills) || {};
        let skill = _num(skills.commerce) + _num(skills.stewardship);
        const roles = player && player.house && player.house.roles;
        if (roles && roles.steward) {
            const m = House._findMember ? House._findMember(player, roles.steward) : null;
            const sk = m && m.skills;
            skill += _num(sk && sk.commerce) * 0.5;
        }
        if (roles && roles.spymaster) skill += 1;
        return _clamp(_num(A.baseChance) + skill * _num(A.perSkill) - _num(office && office.intrigue) * 0.03, 0.1, 0.95);
    },

    /** Send auditors over the books. */
    audit(player, world, seatId) {
        const seat = Stewards.seat(player, world, seatId);
        const office = Stewards.office(player, seat);
        if (!office) return { success: false, reason: 'No one holds that office.' };
        const A = Stewards.config().audit;
        const E = Stewards.config().embezzle;
        const s = Stewards._ensureSt(office, world);
        const day = _day(world);
        if (day - _num(s.lastAudit, -999) < A.cooldown) return { success: false, reason: `The books were gone over ${day - s.lastAudit} days ago.` };
        const cost = Stewards.auditCost(player, world, seat);
        if (_num(player.gold) < cost) return { success: false, reason: `The auditors want ${cost} gold.` };
        player.gold -= cost;
        Ledger.record(player, 'stewardAudits', -cost);
        s.lastAudit = day;
        const st = Stewards.state(player);
        st.stats.audits++;
        s.fear = _clamp(_num(s.fear) + _num(E.auditFear), 0, 1);
        const stolen = Math.floor(_num(s.pocket));
        const hidden = stolen > 0 || !!s.bribe;
        if (hidden && Utils.random() < Stewards.auditChance(player, office)) {
            const back = Math.floor(stolen * _num(A.recover, 0.7));
            if (back > 0) {
                s.pocket -= back;
                player.gold += back;
                Ledger.record(player, 'stewardAudits', back);
                st.stats.recovered += back;
            }
            s.caught = true;
            s.suspicion = 0;
            st.stats.caught++;
            const lines = [];
            if (stolen > 0) lines.push(`${office.name} has had ${stolen} gold out of ${seat.place}; ${back} is clawed back.`);
            if (s.bribe) lines.push(`And worse: letters from ${s.bribe.rivalName} — ${office.name} is in their pay.`);
            const text = `The books of ${seat.place} do not balance. ${lines.join(' ')}`;
            Stewards._log(player, world, text);
            return { success: true, found: true, stolen, recovered: back, bribe: s.bribe ? s.bribe.rivalName : null, cost, text };
        }
        s.auditsPassed++;
        s.suspicion = Math.max(0, _num(s.suspicion) - 20);
        // The honest take it as an insult
        if (!hidden && !s.traits.includes('loyal')) office.loyaltyMod = _num(office.loyaltyMod) + _num(A.insult);
        return { success: true, found: false, cost, text: hidden ? `The auditors find nothing amiss in ${seat.place} — as far as they can tell.` : `The books of ${seat.place} are in perfect order. ${office.name} is stung to be doubted.` };
    },

    /** Reward: kind 'gold' (amount from your purse into theirs) or 'honour' (House Prestige, in public). */
    reward(player, world, seatId, kind = 'gold', amount = null) {
        const seat = Stewards.seat(player, world, seatId);
        const office = Stewards.office(player, seat);
        if (!office) return { success: false, reason: 'No one holds that office.' };
        const W = Stewards.config().reward;
        const s = Stewards._ensureSt(office, world);
        if (kind === 'honour') {
            if (!player.house || !House.spend(player.house, W.honourPrestige, `honours for ${office.name}`, _day(world))) return { success: false, reason: `It takes ${W.honourPrestige} Prestige to honour them before the court.` };
            office.loyaltyMod = _num(office.loyaltyMod) + W.honourLoyalty;
            s.power = _clamp(_num(s.power) + W.honourPower, 0, 100);
        } else {
            const g = Math.max(_num(W.goldMin), Math.round(_num(amount, Math.max(W.goldMin, _num(office.wage) * 10))));
            if (_num(player.gold) < g) return { success: false, reason: `You need ${g} gold.` };
            player.gold -= g;
            Ledger.record(player, 'stewardRewards', -g);
            const npc = Stewards._npc(player, office.id);
            if (npc) npc.purse = _num(npc.purse) + g;
            else s.pocket = _num(s.pocket) + g; // (held for them)
            office.loyaltyMod = _num(office.loyaltyMod) + Math.round(g * W.goldLoyalty);
        }
        // A rewarded steward steals a little less for a while
        s.fear = _clamp(_num(s.fear) + 0.1, 0, 1);
        Stewards.state(player).stats.rewarded++;
        Stewards._refreshFx(player, world, seat, office);
        return { success: true, text: kind === 'honour' ? `${office.name} is honoured before your court.` : `${office.name} thanks you for the purse.` };
    },

    /** Punish: 'fine' (everything they took, and their goodwill) or 'disgrace' (stripped of office in public). */
    punish(player, world, seatId, kind = 'fine') {
        const seat = Stewards.seat(player, world, seatId);
        const office = Stewards.office(player, seat);
        if (!office) return { success: false, reason: 'No one holds that office.' };
        const P = Stewards.config().punish;
        const E = Stewards.config().embezzle;
        const s = Stewards._ensureSt(office, world);
        const st = Stewards.state(player);
        st.stats.punished++;
        const guilty = !!s.caught;
        if (!guilty) {
            // Tyranny: every other steward hears of it
            for (const { office: o } of Stewards.offices(player, world)) if (o !== office) o.loyaltyMod = _num(o.loyaltyMod) + P.innocentLoyalty;
            player.renown = Math.max(0, _num(player.renown) + P.innocentRenown);
        }
        if (kind === 'disgrace') {
            const name = office.name;
            const seized = Math.floor(_num(s.pocket));
            if (seized > 0) { player.gold += seized; Ledger.record(player, 'stewardAudits', seized); s.pocket = 0; st.stats.recovered += seized; }
            Stewards._vacate(player, world, seat, office, 'disgraced', null);
            if (guilty) player.renown = _num(player.renown) + P.disgraceRenown;
            const text = guilty ? `${name} is stripped of ${seat.place} in disgrace${seized ? `; ${seized} gold seized` : ''}. Justice is seen to be done.`
                : `${name} is stripped of ${seat.place} in disgrace, though nothing was proven. Your other stewards take note.`;
            Stewards._log(player, world, text);
            if (player.house) House._chronicle(player.house, world, text, ['stewards']);
            return { success: true, text };
        }
        const seized = Math.floor(_num(s.pocket));
        if (seized > 0) { player.gold += seized; Ledger.record(player, 'stewardAudits', seized); s.pocket = 0; st.stats.recovered += seized; }
        office.loyaltyMod = _num(office.loyaltyMod) + P.fineLoyalty;
        s.fear = _clamp(_num(s.fear) + _num(E.punishFear), 0, 1);
        s.power = Math.max(0, _num(s.power) - P.shamePower);
        s.caught = false;
        if (s.bribe) s.bribe = null;
        Stewards._refreshFx(player, world, seat, office);
        return { success: true, text: `${office.name} is fined${seized ? ` ${seized} gold` : ''} and kept on, sullen and afraid.` };
    },

    /** Answer a proposal from a steward (a marriage into the House). */
    answer(player, world, pendingId, accept) {
        const st = Stewards.state(player);
        const p = st.pending.find(x => x.id === pendingId);
        if (!p) return { success: false, reason: 'That is no longer before you.' };
        st.pending = st.pending.filter(x => x !== p);
        const seat = Stewards.seat(player, world, p.seatId);
        const office = Stewards.office(player, seat);
        if (!office || office.id !== p.officeId) return { success: false, reason: 'They no longer hold the office.' };
        const M = Stewards.config().marriage;
        const s = Stewards._ensureSt(office, world);
        if (p.kind === 'marriage') {
            const child = (player.children || []).find(c => c && c.id === p.childId);
            const up = child && Upbringing.ensure(child);
            if (accept) {
                if (!child || child.isAlive === false || !up || up.spouse) return { success: false, reason: 'The match can no longer be made.' };
                up.spouse = { kind: 'steward', npcId: office.id, name: office.name, day: _day(world), seat: seat.place };
                const npc = Stewards._npc(player, office.id);
                if (npc) npc.marriedTo = child.firstName;
                s.kin = true;
                s.oath = 'house';
                s.ambition = _clamp(_num(s.ambition) + M.acceptAmbition, 0, 10);
                s.power = _clamp(_num(s.power) + M.acceptPower, 0, 100);
                office.loyaltyMod = _num(office.loyaltyMod) + M.acceptLoyalty;
                if (player.house) House.spend(player.house, Math.min(_num(player.house.prestige), M.prestige), `${child.firstName} wed beneath the House`, _day(world));
                st.stats.marriages++;
                const text = `${child.firstName} weds ${office.name}, ${seat.title.toLowerCase()} of ${seat.place}. Kin now, bound to the House.`;
                Stewards._log(player, world, text);
                if (player.house) House._chronicle(player.house, world, text, ['marriage', 'stewards']);
                return { success: true, text };
            }
            office.loyaltyMod = _num(office.loyaltyMod) + M.refuseLoyalty;
            return { success: true, text: `You refuse ${office.name} the hand of ${child ? child.firstName : 'your child'}. They take it hard.` };
        }
        return { success: false, reason: 'Nothing to answer.' };
    },

    // ──────────── INCOME ────────────

    /** The seat's income a week as it stands (tax, crown dues, rents, company trade). */
    weeklyIncome(player, world, seat, taxRes = null) {
        if (!seat) return 0;
        if (seat.kind === 'holding') {
            const res = taxRes || Taxation.collectTaxes(player, world, { dryRun: true });
            const e = (res.settlements || []).find(x => x.q === seat.q && x.r === seat.r);
            return e ? e.collected : 0;
        }
        if (seat.kind === 'province') {
            const f = seat.kingdom ? CrownBooks.state(seat.kingdom) : null;
            return Math.round(_num(f && f.towns && f.towns[seat.key]) * 7);
        }
        if (seat.kind === 'estates') return Math.round(_num(LandMarket.summary(player, world).rent) / 120 * 7);
        if (seat.kind === 'company') {
            const c = MerchantHouses.company(player);
            return Math.round(_num(c && c.weeks && c.weeks[0] && c.weeks[0].income));
        }
        return 0;
    },

    // ──────────── DAILY ────────────

    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:stewards:${_day(world)}`) % 233279) + 1);
    },

    /**
     * Daily: an office-holder dead or gone vacates; every `weekDays` the
     * offices act (embezzle, excel, abuse, bribes, power, risings, proposals)
     * and works are started; every `reportDays` the season's dispatch comes.
     * Nothing runs unless the player has an office filled.
     * @returns {{ notices: Array<{icon,title,text,type}> }}
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player) return out;
        const has = _obj(player.stewards) || Holdings.list(player, world).some(r => r.settlement.holding && r.settlement.holding.governor);
        if (!has) return out;
        Utils.withRng(Stewards._dayRng(world), () => Stewards._tick(world, player, out));
        return out;
    },

    _tick(world, player, out) {
        const st = Stewards.state(player);
        const cfg = Stewards.config();
        const day = _day(world);
        const reign = `${_num(player.house && player.house.generation, 1)}|${player.name || ''}`;
        if (st.reign && st.reign !== reign) Stewards._onSuccession(player, world, out);
        st.reign = reign;

        // Lapsed proposals
        st.pending = st.pending.filter(p => !(day > _num(p.expires)));

        const week = day % Math.max(1, cfg.weekDays) === 0;
        const live = Stewards.offices(player, world);
        // Seats gone (a holding lost, the crown lost, the company wound up): their offices end
        if (week) {
            const ids = new Set(Stewards.seats(player, world).map(s => s.id));
            for (const [id, rec] of Object.entries(st.seats)) {
                if (ids.has(id)) continue;
                const npc = Stewards._npc(player, rec.id);
                if (npc) { delete npc.stewardOf; if (npc.governing && !String(id).startsWith('holding:')) delete npc.governing; }
                if (id.startsWith('province:')) {
                    const [q, r] = id.slice(9).split(',').map(Number);
                    const t = world.getTile(q, r);
                    if (t && t.settlement) delete t.settlement.provinceFx;
                }
                if (id === 'estates') st.estatesFx = null;
                delete st.seats[id];
            }
        }
        let taxRes = null;
        for (const { seat, office } of live) {
            const person = Stewards.person(player, office);
            const gone = !person || (office.kind !== 'family' && office.kind !== 'steward' && Relationships.isInTravelParty(player, office.id));
            if (!person) {
                st.stats.died++;
                Stewards._note(out, '🕯️', 'An Office Falls Empty', `${office.name}, ${seat.title.toLowerCase()} of ${seat.place}, is gone. The seat stands empty.`, 'warning');
                Stewards._vacate(player, world, seat, office, 'died', out);
                continue;
            }
            if (gone) { Stewards._vacate(player, world, seat, office, 'recalled', out); continue; }
            if (!week) continue;
            if (seat.kind === 'holding' && !taxRes) taxRes = Taxation.collectTaxes(player, world, { dryRun: true });
            Stewards._week(player, world, seat, office, taxRes, out);
        }
        if (st.lastReportDay == null) st.lastReportDay = day;
        if (day - st.lastReportDay >= cfg.reportDays) {
            st.lastReportDay = day;
            Stewards._report(player, world, out);
        }
    },

    /** One office's week. */
    _week(player, world, seat, office, taxRes, out) {
        const cfg = Stewards.config();
        const E = cfg.embezzle;
        const s = Stewards._ensureSt(office, world);
        const st = Stewards.state(player);
        const o = Stewards.order(s.orders);
        const day = _day(world);
        const town = seat.settlement || null;
        const h = seat.kind === 'holding' ? seat.settlement.holding : null;

        // Loyalty (Holdings drifts its own governors daily)
        if (seat.kind !== 'holding') {
            const target = Stewards._loyaltyTarget(player, seat, office);
            const step = _num(Holdings.config().governor.loyaltyDrift, 0.5) * cfg.weekDays;
            const cur = _num(office.loyalty, 50);
            office.loyalty = _r2(cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step));
            // Wages: a royal governor from the treasury, a chief factor from the company's capital
            const wage = _num(office.wage) * cfg.weekDays;
            if (wage > 0) {
                let paid = 0;
                if (seat.kind === 'province' && seat.kingdom) {
                    paid = Math.min(wage, Math.max(0, _num(seat.kingdom.treasury)));
                    seat.kingdom.treasury = _num(seat.kingdom.treasury) - paid;
                } else if (seat.kind === 'company') {
                    const c = MerchantHouses.company(player);
                    if (c) { paid = Math.min(wage, Math.max(0, _num(c.capital))); if (paid > 0) MerchantHouses._debit(c, world, paid, 'wages', `Wages of ${office.name}, chief factor`); }
                } else {
                    paid = Math.min(wage, Math.max(0, _num(player.gold)));
                    player.gold -= paid;
                    if (paid > 0) Ledger.record(player, 'stewardWages', -paid);
                }
                const npc = Stewards._npc(player, office.id);
                if (npc && paid > 0) npc.purse = _num(npc.purse) + paid;
                office.unpaid = paid < wage ? _num(office.unpaid) + 1 : 0;
            }
        }
        // Fear of being found out fades
        s.fear = Math.max(0, _num(s.fear) - _num(E.fearDecay));

        // How much they keep back
        let skim = 0;
        if (s.honesty < E.below) skim += (E.below - s.honesty) * E.rate * _num(o.embezzle, 1);
        if (office.loyalty < 40) skim += (40 - office.loyalty) / 400;
        skim *= 1 - _num(s.fear);
        if (s.bribe) skim += _num(cfg.bribe.skim);
        s.skim = _r2(_clamp(skim, 0, E.max));
        Stewards._refreshFx(player, world, seat, office);

        // The take this week, and their part of it
        const income = Stewards.weeklyIncome(player, world, seat, taxRes);
        s.season.income += income;
        let taken = 0;
        if (s.skim > 0) {
            if (seat.kind === 'holding') {
                // (the town kept back the skimmed share of its taxes: the steward has it of the town)
                const gross = income / Math.max(0.1, 1 - _num(h.fx && h.fx.skim));
                taken = Economy.drawTown(town, gross * s.skim);
            } else if (seat.kind === 'province') {
                const pf = _obj(town.provinceFx);
                taken = pf ? _num(pf.pocket) : 0;
                if (pf) pf.pocket = 0;
            } else if (seat.kind === 'estates') {
                const ef = _obj(st.estatesFx);
                taken = ef ? _num(ef.pocket) : 0;
                if (ef) ef.pocket = 0;
            } else if (seat.kind === 'company') {
                const c = MerchantHouses.company(player);
                if (c) {
                    taken = Math.min(Math.max(0, _num(c.capital)), Math.floor(income * s.skim));
                    c.capital -= taken;
                }
            }
        }
        if (taken > 0) {
            s.pocket = _r2(_num(s.pocket) + taken);
            s.embezzled = _r2(_num(s.embezzled) + taken);
            s.season.skimmed += taken;
            s.suspicion = _clamp(_num(s.suspicion) + taken / Math.max(20, income) * 6, 0, 100);
        } else {
            s.suspicion = Math.max(0, _num(s.suspicion) - 1);
        }

        Stewards._works(player, world, seat, office, s, o, out);
        Stewards._deeds(player, world, seat, office, s, o, out);
        Stewards._bribes(player, world, seat, office, s, out);
        Stewards._power(player, world, seat, office, s, out);
        if (!Stewards.office(player, seat)) return;
        Stewards._proposal(player, world, seat, office, s, out);
        if (seat.kind === 'company' && s.orders === 'watch') Stewards._watchFactors(player, world, office, s);
        if (s.defiant && s.defiant <= day) {
            s.defiant = 0;
            Stewards._refreshFx(player, world, seat, office);
        }
    },

    /** Start the order's works with the allowance (padding the bill if crooked). */
    _works(player, world, seat, office, s, o, out) {
        if (seat.kind !== 'holding' || !(s.allowance > 0)) return;
        const h = seat.settlement.holding;
        if (h.rebellion || h.queue.length) return;
        const left = s.allowance - _num(s.spent);
        for (const id of o.works || []) {
            const chk = Holdings.canStart(player, world, seat.q, seat.r, id);
            if (!chk.ok || !chk.quote) continue;
            const cost = chk.quote.total;
            const pad = s.honesty < 0.6 ? Math.round(cost * Stewards.config().worksPad * (0.6 - s.honesty) / 0.6) : 0;
            if (cost + pad > left || _num(player.gold) < cost + pad + 50) continue;
            const res = Holdings.startProject(player, world, seat.q, seat.r, id);
            if (!res.success) continue;
            Ledger.record(player, 'stewardWorks', -res.cost);
            if (pad > 0) {
                player.gold -= pad;
                Ledger.record(player, 'stewardWorks', -pad);
                s.pocket = _r2(_num(s.pocket) + pad);
                s.embezzled = _r2(_num(s.embezzled) + pad);
                s.season.skimmed += pad;
            }
            s.spent = _num(s.spent) + res.cost + pad;
            s.season.notes.push(`began the ${res.project.name} (${res.cost + pad}g)`);
            Stewards.state(player).stats.worksStarted++;
            Stewards._note(out, '🏗️', 'Works Begun', `${office.name} begins a ${res.project.name} in ${seat.place} (${res.cost + pad}g from your purse).`, 'info');
            return;
        }
    },

    /** Excellence and abuse. */
    _deeds(player, world, seat, office, s, o, out) {
        const cfg = Stewards.config();
        const X = cfg.excel;
        const A = cfg.abuse;
        const st = Stewards.state(player);
        const town = seat.settlement;
        const h = seat.kind === 'holding' ? town.holding : null;
        const skill = Math.max(_num(office.stewardship), _num(office[(o.skill || 'stewardship')]));
        if (skill >= X.minSkill && s.honesty >= 0.6 && office.loyalty >= 50
            && Utils.random() < X.chance * (1 + (skill - X.minSkill) / 3)) {
            s.excels++;
            s.season.excels++;
            st.stats.excelled++;
            if (h) {
                h.unrest = Math.max(0, _num(h.unrest) - X.unrest);
                if (h.queue[0]) h.queue[0].progress = _num(h.queue[0].progress) + X.buildDays;
            }
            if (town) town.happiness = _clamp(Taxation.getHappiness(town) + X.happiness, 0, 100);
            if (seat.kind === 'estates') {
                for (const e of LandMarket.mine(player, world)) e.loyalty = _clamp(_num(e.loyalty, 55) + 3, 0, 100);
            }
            if (seat.kind === 'company') {
                const c = MerchantHouses.company(player);
                if (c) c.reputation = _clamp(_num(c.reputation) + 2, 0, 100);
            }
            player.renown = _num(player.renown) + X.renown;
            const what = seat.kind === 'company' ? 'wins the company good name with the guilds'
                : seat.kind === 'estates' ? 'settles the tenants\' quarrels fairly' : 'settles an old feud and hurries the works';
            s.season.notes.push(what);
        }
        const cruel = s.traits.some(t => (Stewards.data().cruel || ['cruel', 'greedy']).includes(t));
        const ab = A.chance * _num(o.abuse, 1) * (cruel ? 2 : 1) * (1.2 - s.honesty);
        if (seat.kind !== 'company' && Utils.random() < ab) {
            s.abuses++;
            s.season.abuses++;
            st.stats.abuses++;
            s.suspicion = _clamp(_num(s.suspicion) + A.suspicion, 0, 100);
            if (h) h.unrest = _clamp(_num(h.unrest) + A.unrest, 0, 100);
            if (town) {
                town.happiness = _clamp(Taxation.getHappiness(town) - A.happiness, 0, 100);
                const got = Economy.drawTown(town, Math.max(0, _num(Economy.townPurse(town), 0)) * A.extortShare * 0.1);
                if (got > 0) { s.pocket = _r2(_num(s.pocket) + got); s.embezzled = _r2(_num(s.embezzled) + got); }
            }
            if (seat.kind === 'estates') {
                for (const e of LandMarket.mine(player, world)) e.loyalty = _clamp(_num(e.loyalty, 55) - 4, 0, 100);
            }
            if (s.suspicion >= cfg.audit.suspicionShown) {
                Stewards._note(out, '😠', 'Complaints', `Word comes from ${seat.place}: ${office.name}'s men bully and extort in your name.`, 'warning');
            }
        }
    },

    /** A rival House with a feud tries to buy the office-holder (its own gold). */
    _bribes(player, world, seat, office, s, out) {
        const B = Stewards.config().bribe;
        const st = Stewards.state(player);
        const rivals = player.house && _obj(player.house.rivals);
        if (!rivals) return;
        if (s.bribe) {
            const r = rivals[s.bribe.rivalId];
            // Paid every month while it lasts
            if (!r || _num(r.feud) < B.minFeud / 2) { s.bribe = null; return; }
            if ((_day(world) - _num(s.bribe.day)) % 28 < 7 && _num(r.gold) > 50) {
                const g = Math.min(_num(r.gold) - 50, Math.round((B.gold[0] + B.gold[1]) / 4));
                if (g > 0) { r.gold -= g; s.pocket = _r2(_num(s.pocket) + g); s.bribe.paid = _num(s.bribe.paid) + g; }
            }
            return;
        }
        const list = Object.entries(rivals).filter(([, r]) => r && _num(r.feud) >= B.minFeud && _num(r.gold, 1000) > B.gold[0]);
        if (!list.length) return;
        list.sort((a, b) => _num(b[1].feud) - _num(a[1].feud));
        const [rid, r] = list[0];
        if (Utils.random() >= B.chance * _num(r.feud) / 50) return;
        const g = Math.min(Number.isFinite(r.gold) ? Math.max(0, r.gold - 50) : B.gold[1], Utils.randInt(B.gold[0], B.gold[1]));
        if (!(g > 0)) return;
        const name = r.name || 'a rival House';
        if (s.honesty < B.acceptBelow || office.loyalty < 40) {
            if (Number.isFinite(r.gold)) r.gold -= g;
            s.bribe = { rivalId: rid, rivalName: name, day: _day(world), paid: g };
            s.pocket = _r2(_num(s.pocket) + g);
            office.loyaltyMod = _num(office.loyaltyMod) + B.loyalty;
            s.suspicion = _clamp(_num(s.suspicion) + B.suspicion, 0, 100);
            st.stats.bribed++;
        } else {
            st.stats.refusedBribes++;
            office.loyaltyMod = _num(office.loyaltyMod) + 2;
            s.season.notes.push(`refused ${g} gold from ${name}`);
            Stewards._note(out, '🛡️', 'A Bribe Refused', `${office.name}, ${seat.title.toLowerCase()} of ${seat.place}, writes that agents of ${name} offered ${g} gold for favours — and were sent away.`, 'success');
        }
    },

    /** The power base: years in office, ambition, a content town; strong and disloyal, they rise. */
    _power(player, world, seat, office, s, out) {
        const cfg = Stewards.config();
        const P = cfg.power;
        const R = cfg.revolt;
        const town = seat.settlement;
        const perWeek = P.perYear * cfg.weekDays / 120;
        let g = perWeek * (0.5 + _num(s.ambition) / 10 * P.ambition * 2 + _num(office.intrigue) / 10 * P.intrigue);
        if (town) g += (Taxation.getHappiness(town) - 50) * P.mood / 10;
        if (s.kin) g += P.kin * cfg.weekDays / 120;
        if (office.loyalty >= 70) g *= P.decayWhenLoyal;
        s.power = _r2(_clamp(_num(s.power) + g, 0, P.cap));
        if (s.power >= R.power && office.loyalty < R.loyalty && _num(s.ambition) >= R.ambition && Utils.random() < R.chance) {
            Stewards._rise(player, world, seat, office, out);
        }
    },

    /** The office-holder turns on you. */
    _rise(player, world, seat, office, out) {
        const st = Stewards.state(player);
        const R = Stewards.config().revolt;
        const s = Stewards._ensureSt(office, world);
        const name = office.name;
        if (seat.kind === 'holding') {
            const ref = { q: seat.q, r: seat.r, key: seat.key, settlement: seat.settlement };
            const h = seat.settlement.holding;
            const hout = { notices: [], rebellions: [] };
            Stewards._vacate(player, world, seat, office, 'rebel', out);
            if (!h.rebellion) {
                Holdings._startRebellion(player, world, ref, h, hout);
                if (h.rebellion) h.rebellion.strength = Math.round(h.rebellion.strength * (1 + _num(s.power) / 100 * R.rebelBonus));
                h.rebellion.leader = name;
            }
            st.stats.risings++;
            const text = `${name} raises ${seat.place} against you and holds it with the townsmen behind them${h.rebellion ? ` (rebels ${h.rebellion.strength} strong)` : ''}. Crush them or buy them off.`;
            Stewards._note(out, '🔥', 'A Steward Rises', text, 'error');
            Stewards._letter(player, world, `${name} rises in ${seat.place}`, text);
            Stewards._log(player, world, text);
            if (player.house) House._chronicle(player.house, world, `${name}, ${seat.title.toLowerCase()} of ${seat.place}, rises against ${player.house.name}.`, ['war', 'stewards']);
            return;
        }
        if (seat.kind === 'province') {
            s.defiant = _day(world) + R.defyDays;
            Stewards._refreshFx(player, world, seat, office);
            st.stats.risings++;
            const text = `${name}, royal governor of ${seat.place}, defies the crown: the town's taxes are withheld for the governor's own chest. Recall or punish them.`;
            Stewards._note(out, '🔥', 'A Governor Defies the Crown', text, 'error');
            Stewards._letter(player, world, `${name} defies the crown`, text);
            Stewards._log(player, world, text);
            return;
        }
        if (seat.kind === 'company') {
            const c = MerchantHouses.company(player);
            const took = c ? Math.min(Math.max(0, _num(c.capital)), Math.max(0, Math.round(_num(c.capital) * 0.15))) : 0;
            if (took > 0) { c.capital -= took; s.pocket = _r2(_num(s.pocket) + took); }
            Stewards._vacate(player, world, seat, office, 'fled', out);
            st.stats.defections++;
            const text = `${name}, chief factor of ${seat.place}, goes over to a rival house${took ? ` with ${took} gold of the company's capital` : ''}.`;
            Stewards._note(out, '🏃', 'The Chief Factor Defects', text, 'error');
            Stewards._log(player, world, text);
            return;
        }
        Stewards._vacate(player, world, seat, office, 'fled', out);
        st.stats.defections++;
        const text = `${name}, your ${seat.title.toLowerCase()}, flees with what they had of your rents.`;
        Stewards._note(out, '🏃', 'The Bailiff Flees', text, 'error');
        Stewards._log(player, world, text);
    },

    /** The ambitious and loyal ask for the hand of an unwed child of the House. */
    _proposal(player, world, seat, office, s, out) {
        const M = Stewards.config().marriage;
        const st = Stewards.state(player);
        const day = _day(world);
        if (s.kin || office.kind === 'family' || office.kind === 'steward') return;
        if (_num(s.ambition) < M.ambition || office.loyalty < M.loyalty || _num(s.power) < M.power) return;
        if (day - _num(s.lastProposal, -999) < M.everyDays || st.pending.some(p => p.seatId === seat.id)) return;
        const npc = Stewards._npc(player, office.id);
        if (!npc || npc.marriedTo || npc.isMarried || player.spouse === npc.id) return;
        const kids = (player.children || []).filter(c => c && c.isAlive !== false && _num(c.age) >= M.minAge && c.id !== player.heir
            && !(c.upbringing && (c.upbringing.spouse || (c.upbringing.agency && c.upbringing.agency.betrothal)))
            && !Upbringing.isAway(c) && (!npc.gender || !c.gender || c.gender !== npc.gender));
        if (!kids.length) return;
        if (Utils.random() >= M.chance) return;
        s.lastProposal = day;
        const child = kids[0];
        const p = { id: st.nextId++, kind: 'marriage', seatId: seat.id, officeId: office.id, childId: child.id, day, expires: day + Stewards.config().pendingDays };
        st.pending.push(p);
        const text = `${office.name}, ${seat.title.toLowerCase()} of ${seat.place}, asks for the hand of ${child.firstName}. Bound to your House, they would serve it the better — and stand the higher.`;
        Stewards._note(out, '💍', 'A Steward Seeks a Match', `${text} Answer in the Stewards panel.`, 'info');
        Stewards._letter(player, world, `${office.name} asks for ${child.firstName}'s hand`, text);
    },

    /** The chief factor goes over the posts' books: a skimming factor found out is replaced. */
    _watchFactors(player, world, office, s) {
        const c = MerchantHouses.company(player);
        if (!c || !Array.isArray(c.posts)) return;
        const day = _day(world);
        if (day % 28 >= 7) return;
        for (const post of c.posts) {
            if (!post.factor || !(post.suspicion > 4 || post.skimmed > 0)) continue;
            // A sharp chief factor sees more
            if (Utils.random() > 0.3 + _num(office.stewardship) * 0.06) continue;
            const res = MerchantHouses.audit(player, world, post.id);
            if (res && res.success && res.found) {
                s.season.notes.push(`caught the factor at ${post.name} skimming (${res.recovered}g back)`);
                MerchantHouses.replaceFactor(player, world, post.id, 0);
            }
        }
    },

    // ──────────── SUCCESSION ────────────

    /** A new head of the House: who stays to serve the heir. */
    _onSuccession(player, world, out) {
        const st = Stewards.state(player);
        const S = Stewards.config().succession;
        const lines = [];
        for (const { seat, office } of Stewards.offices(player, world)) {
            if (office.id === player.id) continue;
            const s = Stewards._ensureSt(office, world);
            s.servedLords = _num(s.servedLords) + 1;
            if (s.oath === 'house' || s.kin) {
                office.loyaltyMod = _num(office.loyaltyMod) + Math.round(S.loyaltyShift / 2);
                lines.push(`${office.name} (${seat.place}) keeps faith with the House.`);
                st.stats.servedHeirs++;
                continue;
            }
            if (office.loyalty >= S.personStayLoyalty || s.honesty >= S.personStayHonesty) {
                office.loyaltyMod = _num(office.loyaltyMod) + S.loyaltyShift;
                lines.push(`${office.name} (${seat.place}) stays on to serve the heir.`);
                st.stats.servedHeirs++;
                continue;
            }
            if (_num(s.power) >= S.defyPower && _num(s.ambition) >= 6) {
                office.loyaltyMod = _num(office.loyaltyMod) - 15;
                office.loyalty = Math.min(_num(office.loyalty), 30);
                lines.push(`${office.name} (${seat.place}) owes the heir nothing, and says so.`);
                continue;
            }
            lines.push(`${office.name} (${seat.place}) served your predecessor, not you, and lays down the office.`);
            Stewards._vacate(player, world, seat, office, 'resigned', out);
            st.stats.resigned++;
        }
        if (lines.length) {
            Stewards._note(out, '🏛️', 'Your Stewards', lines.slice(0, 4).join(' ') + (lines.length > 4 ? ` And ${lines.length - 4} more.` : ''), 'info');
            Stewards._letter(player, world, 'The stewards and the new head of the House', lines.join(' '));
        }
    },

    // ──────────── REPORTS ────────────

    /** One office's line in the season's dispatch: what they claim, what the town says. */
    reportLine(player, world, seat, office) {
        const s = Stewards._ensureSt(office, world);
        const A = Stewards.config().audit;
        const L = _obj(Stewards.data().lines) || {};
        const pick = (arr) => (Array.isArray(arr) && arr.length ? arr[_hash(`${office.id}:${_day(world)}`) % arr.length] : '');
        const season = s.season || {};
        // A crooked steward claims the take was what it would have been without their hand in it
        const claimed = Math.round(_num(season.income) + (s.honesty < 0.6 ? _num(season.skimmed) * 0.8 : 0));
        let mood = 'fair';
        const h = seat.kind === 'holding' ? seat.settlement.holding : null;
        const unrest = h ? _num(h.unrest) : 0;
        const hap = seat.settlement ? Taxation.getHappiness(seat.settlement) : 50;
        if (hap >= 60 && unrest < 30) mood = 'good';
        else if (hap < 40 || unrest >= 55) mood = 'bad';
        const quote = s.honesty < 0.5 && mood !== 'good' ? pick(L.rosy) : pick(L[mood]);
        const bits = [];
        if (seat.kind === 'holding') bits.push(`taxes ${claimed}g this season, unrest ${Math.round(unrest)}`);
        else if (seat.kind === 'province') bits.push(`the crown's dues ${claimed}g this season`);
        else if (seat.kind === 'estates') bits.push(`rents ${claimed}g this season`);
        else bits.push(`the company's trade ${claimed}g this season`);
        for (const n of (season.notes || []).slice(-2)) bits.push(n);
        let text = `${seat.title} ${office.name} of ${seat.place}: ${bits.join('; ')}. "${quote}"`;
        if (s.suspicion >= A.suspicionShown) text += ' (In town they say the steward lives well beyond the wage.)';
        if (s.power >= 50) text += ` (Much obeyed in ${seat.place}.)`;
        if (office.loyalty < 30) text += ' (The letter is curt.)';
        return text;
    },

    /**
     * The facts a steward's report may tell (for the LLM's prose): only what
     * the steward would claim and the town would say, never the hidden truth.
     */
    reportFacts(player, world, seat, office) {
        const s = Stewards._ensureSt(office, world);
        const season = s.season || {};
        const h = seat.kind === 'holding' ? seat.settlement.holding : null;
        return {
            writer: office.name, office: seat.title, place: seat.place, seatKind: seat.kind,
            orders: Stewards.order(s.orders).name,
            claimedIncome: Math.round(_num(season.income) + (s.honesty < 0.6 ? _num(season.skimmed) * 0.8 : 0)),
            unrest: h ? Math.round(_num(h.unrest)) : null,
            happiness: seat.settlement ? Math.round(Taxation.getHappiness(seat.settlement)) : null,
            deeds: (season.notes || []).slice(-3),
            tone: office.loyalty < 30 ? 'curt' : s.honesty < 0.5 ? 'flattering' : 'plain',
            townTalk: s.suspicion >= Stewards.config().audit.suspicionShown ? 'lives beyond the wage' : null,
            powerful: _num(s.power) >= 50,
            lord: player.name || null,
            traits: (s.traits || []).slice(0, 3),
        };
    },

    /** A report line in the LLM's words when it has written them, else the template. */
    reportText(world, key, fallback) {
        return _proseText(world, key, fallback);
    },

    _report(player, world, out) {
        const st = Stewards.state(player);
        const live = Stewards.offices(player, world);
        if (!live.length) return;
        const day = _day(world);
        const keys = [];
        const lines = live.map(({ seat, office }) => {
            const fallback = Stewards.reportLine(player, world, seat, office);
            const key = `steward:${office.id}:${day}`;
            keys.push(key);
            return _proseWrite(world, 'stewardReport', key, Stewards.reportFacts(player, world, seat, office), fallback);
        });
        st.reports.unshift({ day, lines, keys });
        if (st.reports.length > Stewards.config().maxReports) st.reports.length = Stewards.config().maxReports;
        for (const { office } of live) {
            const s = Stewards._ensureSt(office, world);
            s.season = { income: 0, skimmed: 0, excels: 0, abuses: 0, notes: [] };
            s.spent = 0;
        }
        const shown = lines.slice(0, 8).join('\n\n') + (lines.length > 8 ? `\n\n…and ${lines.length - 8} more dispatches, all in the Stewards panel.` : '');
        Stewards._letter(player, world, `The stewards' dispatches (${live.length})`, shown);
        Stewards._note(out, '📜', 'The Stewards Report', `${live.length} dispatch${live.length === 1 ? '' : 'es'} from your stewards (Journal → Letters, or the Stewards panel).`, 'info');
    },

    /** A letter from the stewards into the court inbox (CourtLetters' family_report: no cost to leave unanswered). */
    _letter(player, world, subject, body) {
        try {
            const day = _day(world);
            const K = CourtLetters.kind('family_report') || {};
            const from = { name: 'Your stewards', type: 'family', kingdomId: null };
            return CourtLetters.deliver(player, {
                id: 0, kind: 'family_report', day, expires: day + _num(K.expiry, 20),
                from, key: `stewards:${day}:${subject}`,
                vars: { from: from.name, subject, body }, data: {},
                subject, body, read: false,
            });
        } catch (e) {
            return null;
        }
    },

    // ──────────── VIEW ────────────

    /** Everything the Stewards panel shows. */
    view(player, world) {
        const st = Stewards.state(player);
        const A = Stewards.config().audit;
        const day = _day(world);
        const taxRes = Holdings.list(player, world).length ? Taxation.collectTaxes(player, world, { dryRun: true }) : null;
        const seats = Stewards.seats(player, world).map(seat => {
            const office = Stewards.office(player, seat);
            const s = office ? Stewards._ensureSt(office, world) : null;
            const h = seat.kind === 'holding' ? seat.settlement.holding : null;
            return {
                id: seat.id, kind: seat.kind, title: seat.title, place: seat.place,
                income: Stewards.weeklyIncome(player, world, seat, taxRes),
                unrest: h ? Math.round(_num(h.unrest)) : null,
                happiness: seat.settlement ? Math.round(Taxation.getHappiness(seat.settlement)) : null,
                rebellion: !!(h && h.rebellion),
                office: office ? {
                    kind: office.kind, id: office.id, name: office.name,
                    stewardship: office.stewardship, martial: office.martial, intrigue: office.intrigue,
                    loyalty: Math.round(_num(office.loyalty)), wage: _num(office.wage), since: _num(office.appointedDay),
                    orders: s.orders, allowance: _num(s.allowance), spent: _num(s.spent),
                    reference: Stewards.reference(s.caught ? 0.2 : s.honestyGuess), caught: !!s.caught,
                    ambition: Stewards.ambitionLabel(s.ambition), power: Math.round(_num(s.power)),
                    suspicion: s.suspicion >= A.suspicionShown, oath: s.oath, kin: !!s.kin,
                    defiant: s.defiant > day, auditReady: day - _num(s.lastAudit, -999) >= A.cooldown,
                    auditCost: Stewards.auditCost(player, world, seat), auditChance: Stewards.auditChance(player, office),
                    excels: s.excels, abuses: s.abuses, servedLords: s.servedLords, bribe: s.caught && s.bribe ? s.bribe.rivalName : null,
                } : null,
            };
        });
        return {
            seats,
            filled: seats.filter(s => s.office).length,
            pending: st.pending.map(p => {
                const child = (player.children || []).find(c => c && c.id === p.childId);
                const seat = seats.find(x => x.id === p.seatId);
                return { ...p, childName: child ? child.firstName : 'your child', officeName: seat && seat.office ? seat.office.name : '', place: seat ? seat.place : '', daysLeft: Math.max(0, p.expires - day) };
            }),
            reports: st.reports.slice(0, 4).map(r => ({ ...r, lines: (r.lines || []).map((l, i) => (r.keys && r.keys[i] ? Stewards.reportText(world, r.keys[i], l) : l)) })),
            log: st.log.slice(-10).reverse(),
            stats: st.stats,
        };
    },
};
