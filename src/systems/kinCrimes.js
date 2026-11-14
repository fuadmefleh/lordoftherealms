// ============================================
// KIN CRIMES — deplorable acts against your own blood
// ============================================
// The dark counsel of the family panels (ui/actionMenu/kinCrimes.js):
//
//   Remove an heir   a 'hunting accident' or a cup of poison (murder), the
//                    cloister (the child leaves the House for an abbey), or
//                    declared sickly and unfit to rule (child.kin.unfit: read
//                    by Relationships.getEligibleHeirs / designateHeir and
//                    House.assessSuccession — they can never take the seat).
//   Kill a sibling   the same murder, aimed at a sibling kept from the last
//                    succession (child.isSibling): their portion comes to you.
//   Disinherit       a grown child is cast out (their portion seized, or
//                    not) and founds a cadet branch (systems/cadetBranches.js)
//                    born estranged, with a GRUDGE: its loyalty is capped for
//                    `grudgeHeads` heads of the branch, so it whispers against
//                    you at court and presses claims at your successions.
//   Forced match     a grown child wed into a realm against their will, for a
//                    bride-price out of its treasury or an alliance. Their bond
//                    with you is capped by their grievance for life; unhappy,
//                    they may flee the match or swear a feud (Nemesis); if they
//                    inherit they come to the seat hardened (a trait) and will
//                    never sell a child of their own.
//
// SUSPICION. Each hidden deed has a suspicion (0–100): the method's, more for
// the heir, less for a stealthy hand. Children of the household may see it
// (they SUSPECT: their bond falls and their grievance caps it for good). Every
// week the deed may come out (suspicion × exposeWeekly); suspicion decays to a
// floor, never to nothing for a murder, and a suspecting sibling keeps it
// alive each year. An heir who suspected may tell the truth when they take the
// seat. EXPOSED: Prestige lost, standing lost in every realm, the ruler marked
// Kinslayer (Traits deed 'kinslaying'), the dead's cause rewritten in the
// family tree, the deed chronicled as betrayal (the Annals' Infamy), the
// victim's siblings swear a feud (Nemesis), and the House's STAIN grows. The
// stain halves at each succession and, while it lasts, gives men a reason to
// press another claim to the seat (house._pendingClaim, House._disputeChance).
//
// An elder child passed over for a younger heir resents it and may press a
// claim of their own — the reason an inconvenient heir is inconvenient.
//
// State: player.house.kinCrimes (saved with the House) and child.kin (saved
// with the children). Player acts draw from Utils' stream; the daily tick from
// its own seeded stream (world seed + day). Content: data/kinCrimes.json. No
// globals, no import-time effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Names } from '../core/names.js';
import { Seasons } from '../world/seasons.js';
import { Economy } from '../world/economy.js';
import { NPCLords } from '../world/npcLords.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Raising } from './raising.js';
import { Upbringing } from './upbringing.js';
import { HeirAgency } from './heirAgency.js';
import { Heirs } from './heirs.js';
import { Nemesis } from './nemesis.js';
import { CadetBranches } from './cadetBranches.js';
import { RivalHouses } from './rivalHouses.js';
import { DynastyTree } from './dynastyTree.js';
import { Inheritance } from './inheritance.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const DEFAULTS = {
    witnessMinAge: 10, witnessFactor: 0.6, witnessBond: -15, witnessGrievance: 15,
    exposeWeekly: 0.02, decayWeekly: 0.15, heirSuspicion: 10, stealthPer: 1.5,
    murder: {
        minAge: 6, methods: {}, floor: 15, failSuspicion: 30, failGrievance: 60, failBond: -50, failNemesisScore: 75,
        exposePrestige: 40, exposeReputation: -10, exposeKinslaying: 3, stain: 40, exposedCause: 'murdered by their own blood',
    },
    cloister: {
        minAge: 7, endowment: 150, vocationFaith: 7, vocationBond: 65, vocationPrestige: 2, forcedSuspicion: 20, forcedGrievance: 40,
        forcedBond: -30, exposePrestige: 8, stain: 5, floor: 0, deathAge: 50, deathChance: 0.04, fleeChance: 0.03, fleeMinAge: 16, fleeNemesisScore: 55,
    },
    unfit: { suspicion: 15, strongSuspicion: 20, strongAt: 6, grievance: 30, awareAge: 12, bond: -25, exposePrestige: 10, stain: 5, floor: 0, restorePrestige: 5, restoreBond: 10 },
    disinherit: { prestige: 4, loyalty: 12, seizedLoyalty: 5, grudgeCap: 30, grudgeHeads: 2, siblingBond: -5 },
    forced: {
        priceShare: 0.12, priceCap: 900, priceMin: 40, allianceReputation: 20, alliancePrestige: 2, priceReputation: 6, grievance: 45, bond: -40,
        unhappyBond: 25, fleeChance: 0.06, fleeReputation: -15, nemesisChance: 0.05, nemesisScore: 50, rulerTraitBitter: 'cruel', rulerTraitCold: 'cunning', bitterBond: 25,
    },
    succession: { knewExposeChance: 0.5, knewBond: -10, stainDecay: 0.5, stainMin: 2 },
    stain: { claimAt: 20, claimPer: 0.004 },
    passedOver: { years: 2, bond: -5, claimChance: 0.25 },
    lines: {},
};

const SECTIONS = ['murder', 'cloister', 'unfit', 'disinherit', 'forced', 'succession', 'stain', 'passedOver'];

export const KinCrimes = {
    DEFAULTS,

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.kinCrimes) || {};
        const out = { ...DEFAULTS, ...d };
        for (const k of SECTIONS) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        out.murder.methods = { ...(_obj(DEFAULTS.murder.methods) || {}), ...(_obj(d.murder && d.murder.methods) || {}) };
        out.lines = { ...(_obj(d.lines) || {}) };
        return out;
    },

    // ──────────── STATE ────────────

    /** The House's record of its crimes against its blood (created on first use), or null. */
    state(player) {
        const house = player && player.house;
        if (!house) return null;
        const st = _obj(house.kinCrimes) ? house.kinCrimes : (house.kinCrimes = {});
        if (!Array.isArray(st.acts)) st.acts = [];
        if (!Array.isArray(st.cloistered)) st.cloistered = [];
        if (!Array.isArray(st.notices)) st.notices = [];
        st.stain = _num(st.stain);
        st.nextId = Math.max(1, _num(st.nextId, 1));
        return st;
    },

    /** What a child of the House remembers of these things: { suspects:[actId], grievance, unfit?, forced?, passedOver? }. */
    kin(child) {
        if (!child) return null;
        if (!_obj(child.kin)) child.kin = {};
        const k = child.kin;
        if (!Array.isArray(k.suspects)) k.suspects = [];
        k.grievance = _num(k.grievance);
        return k;
    },

    /** Declared unfit to rule (read by the heir lists). */
    isUnfit(child) {
        return !!(child && child.kin && child.kin.unfit);
    },

    _child(player, id) {
        return ((player && player.children) || []).find(c => c && c.id === id) || null;
    },

    _rng(world, key) {
        const p = world && world.generationParams;
        return Utils.seededRandom((_hash(`${(p && p.seed) || 0}:kinCrimes:${_day(world)}:${key}`) % 233279) + 1);
    },

    _fill(tpl, vars) {
        return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    },

    _line(key, vars, fallback = '') {
        return KinCrimes._fill(KinCrimes.config().lines[key] || fallback, vars);
    },

    _vars(player, child, extra = {}) {
        const f = child && child.gender === 'female';
        return {
            name: child ? child.firstName : 'someone', obj: f ? 'her' : 'him', poss: f ? 'her' : 'his',
            ruler: player ? player.name || 'the ruler' : 'the ruler', house: (player && player.house && player.house.name) || 'the House', ...extra,
        };
    },

    _chronicle(player, world, text, tags) {
        if (player && player.house && text) House._chronicle(player.house, world, text, tags);
    },

    _prestigeLoss(player, n, reason, world) {
        const house = player && player.house;
        const amt = Math.min(_num(house && house.prestige), Math.max(0, Math.round(n)));
        if (amt > 0) House.spend(house, amt, reason, _day(world));
        return amt;
    },

    _repAll(player, n) {
        if (!player || !n) return;
        const rep = player.reputation || (player.reputation = {});
        for (const k of Object.keys(rep)) rep[k] = _num(rep[k]) + n;
    },

    _stealth(player) {
        return _num(player && player.skills && player.skills.stealth);
    },

    _home(child) {
        return !!child && child.isAlive !== false && !HeirAgency.isAway(child);
    },

    /** The town nearest the player (where an endowment is paid): their tile's, else the nearest settlement. */
    _townNear(player, world) {
        const t = world && typeof world.getTile === 'function' && player ? world.getTile(player.q, player.r) : null;
        if (t && t.settlement) return t.settlement;
        if (!world || typeof world.getSettlementViews !== 'function') return null;
        let best = null;
        let bd = Infinity;
        for (const s of world.getSettlementViews()) {
            if (!s) continue;
            const d = Math.abs(_num(s.q) - _num(player && player.q)) + Math.abs(_num(s.r) - _num(player && player.r));
            if (d < bd) { bd = d; best = s; }
        }
        return best;
    },

    _clearPosts(player, world, childId) {
        if (player.heir === childId) player.heir = null;
        const house = player.house;
        if (house && house.roles) for (const r of House.ROLE_IDS) if (house.roles[r] === childId) house.roles[r] = null;
        if (house && house.regentDesignate && house.regentDesignate.id === childId) house.regentDesignate = null;
    },

    _suspicionLabel(v) {
        return v >= 60 ? 'Whispered everywhere' : v >= 35 ? 'Talked of' : v >= 15 ? 'Doubted' : 'Believed';
    },

    // ──────────── GATES ────────────

    /** Why an act cannot be done to this child now (null when it can). act: murder|cloister|unfit|restore|disinherit|forced. */
    whyNot(player, world, childId, act, arg = null) {
        const C = KinCrimes.config();
        if (!player || !player.house) return 'You have no House.';
        const child = KinCrimes._child(player, childId);
        if (!child || child.isAlive === false) return 'No such child of the House.';
        const age = _num(child.age);
        const up = child.upbringing || {};
        const k = child.kin || {};
        const st = KinCrimes.state(player);
        if (act === 'murder') {
            const m = C.murder.methods[arg];
            if (!m) return 'No such way.';
            if (!child.isSibling && age < _num(C.murder.minAge, 6)) return `${child.firstName} is too young for anyone to believe it.`;
            if (age < _num(m.minAge)) return `${child.firstName} is too young to ride to the hunt.`;
            if (!KinCrimes._home(child)) return `${child.firstName} is away from home.`;
            return null;
        }
        if (act === 'cloister') {
            if (age < _num(C.cloister.minAge, 7)) return `${child.firstName} is too young for the abbey.`;
            if (up.spouse) return `${child.firstName} is wed.`;
            if (!KinCrimes._home(child)) return `${child.firstName} is away from home.`;
            const cost = _num(C.cloister.endowment);
            if (Inheritance.coin(player) < cost) return `The abbey asks an endowment of ${cost} gold.`;
            return null;
        }
        if (act === 'unfit') {
            if (child.isSibling) return `${child.firstName} is your sibling, not your heir to declare.`;
            if (k.unfit) return `${child.firstName} is already declared unfit.`;
            return null;
        }
        if (act === 'restore') return k.unfit ? null : `${child.firstName} is not declared unfit.`;
        if (act === 'disinherit') {
            if (child.isSibling) return `${child.firstName} is your sibling: their portion is not yours to take.`;
            const heir = player.heir;
            if (heir === child.id) player.heir = null;
            try {
                return CadetBranches.whyNot(player, world, childId);
            } finally {
                player.heir = heir;
            }
        }
        if (act === 'forced') {
            if (child.isSibling) return `${child.firstName} is your sibling: not yours to give.`;
            if (!up.comeOfAge) return `${child.firstName} has not come of age.`;
            if (up.spouse) return `${child.firstName} is already wed.`;
            if (!KinCrimes._home(child)) return `${child.firstName} is away from home.`;
            if (st && st.ruler && st.ruler.forced) return `Remembering the match forced on ${st.ruler.first || 'you'}, you will not sell a child of your own.`;
            return null;
        }
        return 'No such act.';
    },

    // ──────────── SUSPICION ────────────

    _newAct(player, world, kind, child, extra = {}) {
        const st = KinCrimes.state(player);
        const C = KinCrimes.config();
        const base = _num(extra.suspicion);
        const heirBonus = player.heir === child.id ? _num(C.heirSuspicion) : 0;
        const susp = base > 0 ? _clamp(Math.round(base + heirBonus - KinCrimes._stealth(player) * _num(C.stealthPer)), 5, 95) : 0;
        const act = {
            id: `kc${st.nextId++}`, kind, targetId: child.id, targetName: child.firstName, sibling: !!child.isSibling,
            day: _day(world), ruler: player.name || null, gen: _num(player.house.generation, 1),
            suspicion: susp, floor: _num(extra.floor), exposed: null, ...extra,
        };
        act.suspicion = susp;
        st.acts.push(act);
        return act;
    },

    /** The household's eyes: each child at home (not the victim) may suspect the deed. → [names] */
    _witness(player, world, act, rnd = Utils.random) {
        const C = KinCrimes.config();
        const seen = [];
        if (!(act.suspicion > 0)) return seen;
        for (const c of player.children || []) {
            if (!c || c.id === act.targetId || !KinCrimes._home(c) || _num(c.age) < _num(C.witnessMinAge, 10)) continue;
            if (rnd() >= (act.suspicion / 100) * _num(C.witnessFactor, 0.6)) continue;
            KinCrimes._suspect(player, c, act);
            seen.push(c.firstName);
        }
        return seen;
    },

    _suspect(player, c, act) {
        const C = KinCrimes.config();
        const k = KinCrimes.kin(c);
        if (k.suspects.includes(act.id)) return;
        k.suspects.push(act.id);
        k.grievance = _clamp(k.grievance + _num(C.witnessGrievance), 0, 100);
        if (!c.isSibling) Raising._addBond(c, _num(C.witnessBond));
    },

    // ──────────── THE ACTS ────────────

    /**
     * Have a child or a sibling killed: method 'hunt' (a hunting accident) or
     * 'poison'. → { success, died, act, text, witnesses } | { success:false, reason }
     */
    murder(player, world, childId, method = 'hunt', rnd = Utils.random) {
        const why = KinCrimes.whyNot(player, world, childId, 'murder', method);
        if (why) return { success: false, reason: why };
        const C = KinCrimes.config();
        const M = C.murder;
        const m = M.methods[method];
        const child = KinCrimes._child(player, childId);
        const day = _day(world);
        const vars = KinCrimes._vars(player, child);
        const chance = _clamp(_num(m.success, 0.8) + KinCrimes._stealth(player) * 0.01, 0.05, 0.97);
        const wasHeir = player.heir === childId;
        if (rnd() >= chance) {
            // It failed: they live, and they know
            const act = KinCrimes._newAct(player, world, 'attempt', child, { method, suspicion: _num(m.suspicion) + _num(M.failSuspicion), floor: _num(M.floor) });
            const k = KinCrimes.kin(child);
            k.suspects.push(act.id);
            k.grievance = _clamp(k.grievance + _num(M.failGrievance), 0, 100);
            if (!child.isSibling) Raising._addBond(child, _num(M.failBond));
            Nemesis.wrong(player, world, {
                kind: 'kin', name: `${child.firstName}${child.dynasty ? ` ${child.dynasty}` : ''}`, ref: { childId }, line: child.dynasty || null,
                deed: { key: 'kin_attempt', label: `the attempt on ${vars.poss === 'her' ? 'her' : 'his'} life`, note: m.name }, score: _num(M.failNemesisScore, 75),
                age: _num(child.age), gender: child.gender === 'female' ? 'female' : 'male',
            });
            const witnesses = KinCrimes._witness(player, world, act, rnd);
            return { success: true, died: false, act, witnesses, text: KinCrimes._fill(m.failText || '{name} survives.', vars) };
        }
        const act = KinCrimes._newAct(player, world, 'murder', child, { method, suspicion: _num(m.suspicion), floor: _num(M.floor), wasHeir });
        child.isAlive = false;
        child.deathDay = day;
        child.deathCause = m.cause || 'misfortune';
        KinCrimes._clearPosts(player, world, childId);
        // Their portion comes home now (the inheritance they stood between you and)
        const portion = Math.max(0, _num(child.purse));
        if (portion > 0) {
            child.purse = 0;
            Inheritance.setCoin(player, Inheritance.coin(player) + portion);
            Ledger.record(player, 'family', portion);
        }
        act.portion = Math.round(portion);
        // The official story
        KinCrimes._chronicle(player, world, KinCrimes._fill(m.cover || '{name} dies.', vars), ['heirs']);
        const witnesses = KinCrimes._witness(player, world, act, rnd);
        return { success: true, died: true, act, witnesses, portion: act.portion, text: KinCrimes._fill(m.cover || '{name} dies.', vars) };
    },

    /** Give a child to an abbey: out of the household and the succession for good. */
    cloister(player, world, childId) {
        const why = KinCrimes.whyNot(player, world, childId, 'cloister');
        if (why) return { success: false, reason: why };
        const C = KinCrimes.config().cloister;
        const st = KinCrimes.state(player);
        const child = KinCrimes._child(player, childId);
        const day = _day(world);
        const town = KinCrimes._townNear(player, world);
        const place = (town && town.name) || 'the hills';
        const cost = _num(C.endowment);
        if (cost > 0) {
            Inheritance.setCoin(player, Inheritance.coin(player) - cost);
            Ledger.record(player, 'family', -cost);
            if (town) Economy.payTown(town, cost);
        }
        const bond = Raising.bond(child);
        const vocation = _num(child.faith) >= _num(C.vocationFaith, 7) && bond >= _num(C.vocationBond, 65);
        const vars = KinCrimes._vars(player, child, { place });
        let act = null;
        if (!vocation) {
            act = KinCrimes._newAct(player, world, 'cloister', child, { suspicion: _num(C.forcedSuspicion), floor: _num(C.floor), place });
            KinCrimes._witness(player, world, act);
        }
        // The portion goes with them to the abbey
        const portion = Math.max(0, _num(child.purse));
        if (portion > 0 && town) Economy.payTown(town, portion);
        child.purse = 0;
        DynastyTree.sync(player, world, {});
        const L = player.house && player.house.lineage;
        const rec = L && L.people ? L.people[child.id] : null;
        if (rec) rec.branch = `took holy orders at ${place}`;
        KinCrimes._clearPosts(player, world, childId);
        CadetBranches._leaveGovernorships(player, world, childId);
        player.children = player.children.filter(c => c.id !== childId);
        st.cloistered.push({
            id: child.id, name: child.firstName, dynasty: child.dynasty || null, gender: child.gender || null, age: _num(child.age),
            day, place, bitter: !vocation, actId: act ? act.id : null, died: null, fled: null,
        });
        if (vocation) House.award(player.house, _num(C.vocationPrestige), `${child.firstName} takes holy orders`, day);
        const text = KinCrimes._line(vocation ? 'cloisterVocation' : 'cloisterForced', vars, '{name} goes to the abbey of {place}.');
        KinCrimes._chronicle(player, world, text, ['heirs', 'faith']);
        return { success: true, vocation, act, text };
    },

    /** Declare a child sickly and unfit to rule: they can never take the seat. */
    declareUnfit(player, world, childId) {
        const why = KinCrimes.whyNot(player, world, childId, 'unfit');
        if (why) return { success: false, reason: why };
        const C = KinCrimes.config().unfit;
        const child = KinCrimes._child(player, childId);
        const k = KinCrimes.kin(child);
        k.unfit = { day: _day(world) };
        const strong = _num(child.strength, 5) >= _num(C.strongAt, 6);
        const act = KinCrimes._newAct(player, world, 'unfit', child, { suspicion: _num(C.suspicion) + (strong ? _num(C.strongSuspicion) : 0), floor: _num(C.floor) });
        KinCrimes._clearPosts(player, world, childId);
        if (_num(child.age) >= _num(C.awareAge, 12)) {
            k.grievance = _clamp(k.grievance + _num(C.grievance), 0, 100);
            if (!k.suspects.includes(act.id)) k.suspects.push(act.id);
            Raising._addBond(child, _num(C.bond));
        }
        KinCrimes._witness(player, world, act);
        const text = KinCrimes._line('unfit', KinCrimes._vars(player, child), '{name} is declared unfit to rule.');
        KinCrimes._chronicle(player, world, text, ['heirs']);
        return { success: true, act, strong, text };
    },

    /** Lift the declaration: the physicians were wrong (a little Prestige; the grievance stays). */
    restoreFit(player, world, childId) {
        const why = KinCrimes.whyNot(player, world, childId, 'restore');
        if (why) return { success: false, reason: why };
        const C = KinCrimes.config().unfit;
        const child = KinCrimes._child(player, childId);
        delete child.kin.unfit;
        KinCrimes._prestigeLoss(player, _num(C.restorePrestige), 'a declaration of unfitness withdrawn', world);
        Raising._addBond(child, _num(C.restoreBond));
        for (const a of KinCrimes.state(player).acts) if (a.kind === 'unfit' && a.targetId === childId && !a.exposed) a.lifted = _day(world);
        const text = KinCrimes._line('restore', KinCrimes._vars(player, child), '{name} is declared fit.');
        KinCrimes._chronicle(player, world, text, ['heirs']);
        return { success: true, text };
    },

    /**
     * Disinherit a grown child and cast them out: they found a cadet branch
     * born estranged, with a grudge. opts.seize: take their portion first.
     */
    disinherit(player, world, childId, opts = {}) {
        const why = KinCrimes.whyNot(player, world, childId, 'disinherit');
        if (why) return { success: false, reason: why };
        const C = KinCrimes.config().disinherit;
        const house = player.house;
        const child = KinCrimes._child(player, childId);
        const day = _day(world);
        const seized = opts.seize ? Math.max(0, _num(child.purse)) : 0;
        if (seized > 0) {
            child.purse = 0;
            Inheritance.setCoin(player, Inheritance.coin(player) + seized);
            Ledger.record(player, 'family', seized);
        }
        if (player.heir === childId) player.heir = null;
        const histLen = (house.history || []).length;
        const res = CadetBranches.found(player, world, childId, { why: 'own', grant: 0 });
        if (!res.success) return res;
        const b = res.branch;
        // found() wrote "took their portion and left": this was no leaving of their own
        if (Array.isArray(house.history) && house.history.length > histLen) {
            const last = house.history[house.history.length - 1];
            if (last && Array.isArray(last.tags) && last.tags.includes('cadet')) house.history.pop();
        }
        b.why = 'cast';
        b.loyalty = _num(opts.seize ? C.seizedLoyalty : C.loyalty, 10);
        b.estranged = true;
        b.feud = _clamp(Math.round((50 - b.loyalty) * 2), 0, 100);
        b.grudge = { day, heads: _num(b.stats && b.stats.heads, 1), cap: _num(C.grudgeCap, 30), gens: _num(C.grudgeHeads, 2), seized: Math.round(seized) };
        RivalHouses._note(b, world, opts.seize ? 'Cast out of the main line and robbed of our portion.' : 'Cast out of the main line.', 'insulted');
        CadetBranches._treePerson(player, world, b, null);
        KinCrimes._prestigeLoss(player, _num(C.prestige), `${child.firstName} disinherited`, world);
        for (const c of player.children || []) if (c && c.isAlive !== false && !c.isSibling) Raising._addBond(c, _num(C.siblingBond));
        const text = KinCrimes._line('disinherit', KinCrimes._vars(player, child, { branch: b.name, seat: b.seat ? b.seat.name : 'a town' }), '{name} is cast out.');
        KinCrimes._chronicle(player, world, text, ['cadet', 'betrayal', 'heirs']);
        return { success: true, branch: b, seized: Math.round(seized), text };
    },

    /** The bride-price a realm would pay for a child of the House (out of its treasury). */
    bridePrice(player, world, kingdom) {
        const F = KinCrimes.config().forced;
        const st = KinCrimes.state(player);
        const stainCut = 1 - Math.min(0.8, _num(st && st.stain) / 200);
        const v = Math.floor(Math.min(_num(kingdom && kingdom.treasury) * _num(F.priceShare), _num(F.priceCap)) * stainCut);
        return v >= _num(F.priceMin) ? v : 0;
    },

    /** Wed a grown child into a realm against their will: kind 'price' (a bride-price) or 'alliance'. */
    forceMatch(player, world, childId, kingdomId, kind = 'price') {
        const why = KinCrimes.whyNot(player, world, childId, 'forced');
        if (why) return { success: false, reason: why };
        const F = KinCrimes.config().forced;
        const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(kingdomId) : null;
        if (!k || !k.isAlive || !Heirs.kingdoms(player, world).some(x => x.id === k.id)) return { success: false, reason: 'No such realm to wed into.' };
        const child = KinCrimes._child(player, childId);
        const up = Upbringing.ensure(child);
        const day = _day(world);
        let price = 0;
        if (kind === 'price') {
            price = KinCrimes.bridePrice(player, world, k);
            if (!price) return { success: false, reason: `${Names.realm(k.name, true)} has no coin to spare for a bride-price.` };
            k.treasury = _num(k.treasury) - price;
            Inheritance.setCoin(player, Inheritance.coin(player) + price);
            Ledger.record(player, 'family', price);
        }
        const rep = player.reputation || (player.reputation = {});
        rep[k.id] = _num(rep[k.id]) + _num(kind === 'price' ? F.priceReputation : F.allianceReputation);
        if (kind !== 'price') House.award(player.house, _num(F.alliancePrestige), `${child.firstName} wed into ${Names.realm(k.name)}`, day);
        const gender = child.gender === 'female' ? 'male' : 'female';
        up.spouse = { kind: 'alliance', kingdomId: k.id, kingdomName: k.name, name: `${Heirs._name(world, gender, k.culture)} of ${Names.realm(k.name)}`, day, forced: true };
        up.placement = { kind: 'alliance', kingdomId: k.id, kingdomName: k.name, day };
        Heirs._recordMatch(player, world, child, up.spouse);
        NPCLords.rememberDeed(world, k.lord, 'child_wed', { note: child.firstName });
        const kn = KinCrimes.kin(child);
        kn.forced = { day, kingdomId: k.id, realm: k.name, kind, price };
        kn.grievance = _clamp(kn.grievance + _num(F.grievance), 0, 100);
        Raising._addBond(child, _num(F.bond));
        const vars = KinCrimes._vars(player, child, { spouse: up.spouse.name.split(' of ')[0], realm: Names.realm(k.name), price });
        const text = KinCrimes._line(kind === 'price' ? 'forcedPrice' : 'forcedAlliance', vars, '{name} is wed against {poss} will.');
        KinCrimes._chronicle(player, world, text, ['marriage', 'heirs']);
        return { success: true, price, spouse: up.spouse, text };
    },

    // ──────────── EXPOSURE ────────────

    /** The deed comes out. → the notice. */
    expose(player, world, act, by = null) {
        if (!act || act.exposed) return null;
        const C = KinCrimes.config();
        const st = KinCrimes.state(player);
        const day = _day(world);
        act.exposed = day;
        act.exposedBy = by;
        const target = KinCrimes._child(player, act.targetId) || { firstName: act.targetName, gender: null };
        const vars = { ...KinCrimes._vars(player, target), ruler: act.ruler || 'the late ruler' };
        const sameRuler = act.gen === _num(player.house.generation, 1);
        let text;
        let lost = 0;
        if (act.kind === 'murder' || act.kind === 'attempt') {
            const M = C.murder;
            text = KinCrimes._line(act.kind === 'murder' ? 'exposeMurder' : 'exposeAttempt', vars, '{ruler} killed {name}.');
            lost = KinCrimes._prestigeLoss(player, _num(M.exposePrestige) * (sameRuler ? 1 : 0.5), 'kin-blood on the House', world);
            if (sameRuler) {
                KinCrimes._repAll(player, _num(M.exposeReputation));
                Traits.recordDeed(player, 'kinslaying', _num(M.exposeKinslaying, 3));
            }
            st.stain += _num(M.stain) * (act.kind === 'murder' ? 1 : 0.5);
            if (act.kind === 'murder' && KinCrimes._child(player, act.targetId)) target.deathCause = M.exposedCause;
            // The victim's grown siblings swear a feud
            for (const c of player.children || []) {
                if (!c || c.isAlive === false || c.id === act.targetId || _num(c.age) < 16) continue;
                if (!!c.isSibling !== !!act.sibling) continue;
                Nemesis.wrong(player, world, {
                    kind: 'kin', name: `${c.firstName}${c.dynasty ? ` ${c.dynasty}` : ''}`, ref: { childId: c.id }, line: c.dynasty || null,
                    deed: { key: 'kinslaying', label: `the murder of ${act.targetName}`, note: null }, score: 60, age: _num(c.age), gender: c.gender === 'female' ? 'female' : 'male',
                });
                KinCrimes._suspect(player, c, act);
            }
        } else if (act.kind === 'unfit') {
            text = KinCrimes._line('exposeUnfit', vars, '{name} was never unfit.');
            lost = KinCrimes._prestigeLoss(player, _num(C.unfit.exposePrestige), 'a false declaration exposed', world);
            st.stain += _num(C.unfit.stain);
        } else {
            text = KinCrimes._line('exposeCloister', { ...vars, place: act.place || 'the abbey' }, '{name} was walled up in an abbey.');
            lost = KinCrimes._prestigeLoss(player, _num(C.cloister.exposePrestige), 'a child walled up in an abbey', world);
            st.stain += _num(C.cloister.stain);
        }
        st.stain = Math.round(st.stain * 10) / 10;
        KinCrimes._chronicle(player, world, text, ['betrayal', 'heirs']);
        return { icon: '☠️', title: act.kind === 'murder' || act.kind === 'attempt' ? 'Kin-Blood Comes Out' : 'A Family Secret Out', text: `${text}${lost ? ` (−${lost} Prestige)` : ''}`, type: 'error' };
    },

    // ──────────── THE DAYS ────────────

    /** Daily: the week's suspicion, the grudges kept, and once a year the household's long memory. → { notices } */
    processDay(world, player, opts = {}) {
        const out = { notices: [] };
        if (!player || !player.house || !world) return out;
        const st = KinCrimes.state(player);
        if (st.notices.length) out.notices.push(...st.notices.splice(0));
        const day = _day(world);
        if (opts.interregnum) return out;
        const week = day % 7 === 0;
        const year = day > 0 && day % Seasons.DAYS_PER_YEAR === 0;
        if (!week && !year) return out;
        Utils.withRng(KinCrimes._rng(world, 'day'), () => {
            if (week) KinCrimes._week(player, world, st, out);
            if (year) KinCrimes._year(player, world, st, out);
        });
        return out;
    },

    _week(player, world, st, out) {
        const C = KinCrimes.config();
        for (const a of st.acts) {
            if (a.exposed || a.lifted || !(a.suspicion > 0)) continue;
            if (Utils.random() < (a.suspicion / 100) * _num(C.exposeWeekly)) {
                const n = KinCrimes.expose(player, world, a, 'rumour');
                if (n) out.notices.push(n);
                continue;
            }
            a.suspicion = Math.max(_num(a.floor), Math.round((a.suspicion - _num(C.decayWeekly)) * 100) / 100);
        }
        // A grievance caps the bond for good
        for (const c of player.children || []) {
            const k = c && c.kin;
            if (!k || !(k.grievance > 0) || c.isAlive === false) continue;
            const r = Raising.ensure(c);
            const cap = 100 - k.grievance;
            if (r.bond > cap) r.bond = cap;
        }
        // A cast-out branch keeps its grudge for its first heads
        for (const b of CadetBranches.list(player)) {
            const g = b && b.grudge;
            if (!g) continue;
            if (_num(b.stats && b.stats.heads, 1) - _num(g.heads, 1) >= _num(g.gens, 2)) {
                delete b.grudge;
                KinCrimes._chronicle(player, world, KinCrimes._line('grudgeFades', { branch: b.name }, 'An old grudge fades.'), ['cadet']);
                continue;
            }
            if (b.loyalty > g.cap) b.loyalty = g.cap;
        }
    },

    _year(player, world, st, out) {
        const C = KinCrimes.config();
        const house = player.house;
        const day = _day(world);
        // A suspecting sibling keeps the talk alive
        for (const a of st.acts) {
            if (a.exposed || a.lifted) continue;
            const n = (player.children || []).filter(c => c && c.isAlive !== false && c.kin && Array.isArray(c.kin.suspects) && c.kin.suspects.includes(a.id)).length;
            if (n) a.suspicion = Math.min(95, a.suspicion + 3 * n);
        }
        // The forced: unhappy, they flee the match or swear a feud
        const F = C.forced;
        for (const c of player.children || []) {
            const k = c && c.kin;
            const sp = c && c.upbringing && c.upbringing.spouse;
            if (!k || !k.forced || c.isAlive === false || !sp || !sp.forced) continue;
            if (Raising.bond(c) > _num(F.unhappyBond, 25)) continue;
            const roll = Utils.random();
            if (roll < _num(F.fleeChance)) {
                const realm = sp.kingdomName || k.forced.realm || 'the realm';
                c.upbringing.spouse = null;
                c.upbringing.placement = null;
                k.forced.fled = day;
                const rep = player.reputation || (player.reputation = {});
                if (sp.kingdomId != null) rep[sp.kingdomId] = _num(rep[sp.kingdomId]) + _num(F.fleeReputation);
                const kd = typeof world.getKingdom === 'function' ? world.getKingdom(sp.kingdomId) : null;
                if (kd && kd.lord) NPCLords.rememberDeed(world, kd.lord, 'betrothal_broken', { note: c.firstName });
                const text = KinCrimes._line('forcedFled', KinCrimes._vars(player, c, { realm: Names.realm(realm) }), '{name} flees the match.');
                KinCrimes._chronicle(player, world, text, ['divorce', 'heirs']);
                out.notices.push({ icon: '💔', title: `${c.firstName} Flees the Match`, text: `${text} (${_num(F.fleeReputation)} standing with ${Names.realm(realm)})`, type: 'warning' });
            } else if (roll < _num(F.fleeChance) + _num(F.nemesisChance) && _num(c.age) >= 16) {
                Nemesis.wrong(player, world, {
                    kind: 'kin', name: `${c.firstName}${c.dynasty ? ` ${c.dynasty}` : ''}`, ref: { childId: c.id }, line: c.dynasty || null,
                    deed: { key: 'forced_match', label: 'the match you forced on them', note: k.forced.realm || null }, score: _num(F.nemesisScore, 50),
                    age: _num(c.age), gender: c.gender === 'female' ? 'female' : 'male',
                });
            }
        }
        // The cloistered age, die, and the bitter may flee
        const Cl = C.cloister;
        for (const r of st.cloistered) {
            if (r.died != null || r.fled != null) continue;
            r.age = _num(r.age) + 1;
            const vars = { name: r.name, place: r.place, age: r.age, house: house.name };
            if (r.age >= _num(Cl.deathAge, 50) && Utils.random() < _num(Cl.deathChance) * (1 + (r.age - _num(Cl.deathAge, 50)) / 10)) {
                r.died = day;
                KinCrimes._chronicle(player, world, KinCrimes._line('cloisterDied', vars, '{name} dies at the abbey.'), ['heirs', 'faith']);
                continue;
            }
            if (r.bitter && r.age >= _num(Cl.fleeMinAge, 16) && Utils.random() < _num(Cl.fleeChance)) {
                r.fled = day;
                const text = KinCrimes._line('cloisterFled', vars, '{name} flees the abbey.');
                KinCrimes._chronicle(player, world, text, ['betrayal', 'heirs']);
                Nemesis.wrong(player, world, {
                    kind: 'blood', name: `${r.name}${r.dynasty ? ` ${r.dynasty}` : ''}`, line: r.dynasty || null,
                    deed: { key: 'cloistered', label: 'the abbey walls you put them behind', note: r.place }, score: _num(Cl.fleeNemesisScore, 55),
                    age: r.age, gender: r.gender === 'female' ? 'female' : 'male',
                });
                const act = st.acts.find(a => a.id === r.actId);
                if (act && !act.exposed) {
                    const n = KinCrimes.expose(player, world, act, 'fled');
                    if (n) out.notices.push(n);
                }
                out.notices.push({ icon: '⛪', title: `${r.name} Flees the Abbey`, text, type: 'warning' });
            }
        }
        // The stain: men say another of the blood should hold the seat
        const S = C.stain;
        if (st.stain >= _num(S.claimAt, 20) && !house._pendingClaim && Utils.random() < st.stain * _num(S.claimPer)) {
            house._pendingClaim = true;
            const text = KinCrimes._line('stainClaim', { house: house.name }, 'The seat is stained.');
            KinCrimes._chronicle(player, world, text, ['threat']);
            out.notices.push({ icon: '☠️', title: 'A Stained Seat', text: `${text} Your next succession may be contested.`, type: 'warning' });
        }
        // The elder passed over for a younger heir
        KinCrimes._passedOver(player, world, out);
    },

    /** The eldest grown child of the ruler, passed over for a younger heir: resentment, and in time a claim. */
    _passedOver(player, world, out) {
        const P = KinCrimes.config().passedOver;
        const house = player.house;
        const heir = KinCrimes._child(player, player.heir);
        if (!heir || heir.isSibling || heir.isAlive === false) return;
        const elder = (player.children || [])
            .filter(c => c && c.isAlive !== false && !c.isSibling && c.id !== heir.id && _num(c.age) > _num(heir.age) && _num(c.age) >= 16 && !KinCrimes.isUnfit(c))
            .sort((a, b) => _num(b.age) - _num(a.age))[0];
        if (!elder) return;
        const k = KinCrimes.kin(elder);
        k.passedOver = _num(k.passedOver) + 1;
        Raising._addBond(elder, _num(P.bond));
        if (k.passedOver >= _num(P.years, 2) && !house._pendingClaim && Utils.random() < _num(P.claimChance)) {
            house._pendingClaim = true;
            const text = KinCrimes._line('passedOver', KinCrimes._vars(player, elder), '{name} claims the seat.');
            KinCrimes._chronicle(player, world, text, ['heirs', 'threat']);
            out.notices.push({ icon: '👑', title: `${elder.firstName} Passed Over`, text: `${text} Your next succession may be contested.`, type: 'warning' });
        }
    },

    // ──────────── SUCCESSION ────────────

    /**
     * The heir takes the seat (Relationships.succeedAsHeir, after the heir has
     * taken over): a forced match hardens them; what they suspected may come
     * out; the stain halves. → { lines }
     */
    onSuccession(player, world, child) {
        const out = { lines: [] };
        if (!player || !player.house || !child) return out;
        const C = KinCrimes.config();
        const st = KinCrimes.state(player);
        const k = _obj(child.kin) || {};
        const vars = KinCrimes._vars(player, child);
        st.ruler = { name: player.name || null, first: child.firstName || null, forced: !!k.forced, gen: _num(player.house.generation, 1) };
        if (k.forced) {
            const F = C.forced;
            const bond = Raising.bond(child);
            const trait = bond <= _num(F.bitterBond, 25) ? F.rulerTraitBitter : F.rulerTraitCold;
            const granted = trait ? Traits.grantTraits(player, [trait]) : [];
            const text = KinCrimes._line('forcedRuler', vars, '{name} remembers.');
            KinCrimes._chronicle(player, world, text, ['heirs']);
            out.lines.push(text);
            if (granted.length) st.notices.push({ icon: '💍', title: 'A Match Not Forgotten', text: `${text} Men call the new ruler ${granted.map(id => (Traits.TRAITS[id] || {}).name || id).join(', ')}.`, type: 'info' });
        }
        // What the heir suspected of the late ruler: told now, or kept
        const S = C.succession;
        for (const id of k.suspects || []) {
            const a = st.acts.find(x => x.id === id);
            if (!a || a.exposed || a.lifted) continue;
            if (Utils.random() < _num(S.knewExposeChance, 0.5)) {
                const told = KinCrimes._line('knewTold', vars, '{name} tells.');
                KinCrimes._chronicle(player, world, told, ['heirs']);
                const n = KinCrimes.expose(player, world, a, 'heir');
                if (n) st.notices.push({ ...n, text: `${told} ${n.text}` });
                out.lines.push(told);
            }
        }
        if (st.stain > 0) {
            st.stain = Math.round(st.stain * _num(S.stainDecay, 0.5) * 10) / 10;
            if (st.stain < _num(S.stainMin, 2)) st.stain = 0;
            else KinCrimes._chronicle(player, world, KinCrimes._line('stainFades', vars, 'The stain fades.'), ['heirs']);
        }
        return out;
    },

    // ──────────── THE VIEW ────────────

    /** The deeds, as the panel shows them (hidden ones with their suspicion). */
    deeds(player) {
        const st = KinCrimes.state(player);
        if (!st) return [];
        return st.acts.slice().reverse().map(a => ({
            id: a.id, kind: a.kind, target: a.targetName, day: a.day, ruler: a.ruler, exposed: a.exposed, lifted: a.lifted || null,
            suspicion: Math.round(a.suspicion), label: a.exposed ? 'Known' : a.lifted ? 'Withdrawn' : KinCrimes._suspicionLabel(a.suspicion),
            suspects: ((player.children || []).filter(c => c && c.isAlive !== false && c.kin && (c.kin.suspects || []).includes(a.id)).map(c => c.firstName)),
        }));
    },

    /** One child's standing in these things: bond cap, grievance, flags. */
    viewChild(player, child) {
        const k = (child && child.kin) || {};
        return {
            grievance: Math.round(_num(k.grievance)), unfit: !!k.unfit, forced: k.forced || null, passedOver: _num(k.passedOver),
            suspects: (k.suspects || []).length,
        };
    },
};
