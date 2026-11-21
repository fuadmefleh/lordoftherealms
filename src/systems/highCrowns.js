// ============================================
// HIGH CROWNS — many crowns on one head, and the crown above them
// ============================================
// Claims & Crowns (systems/throne.js) seats the player on one throne: the
// HOME crown (player.throne.ruling, run in person through the Royal Court,
// systems/kingship.js). This system lets a ruler win more — FAR crowns, held
// in personal union:
//
//   WINNING ONE  press a claim on a second throne (Throne.canPress asks
//                canSeekAnother; the civil war's crown lands here through
//                Throne._takeThrone), dictate the crown to a beaten realm
//                whose capital you once stormed (dictate: a conquest claim,
//                its host broken in a war with your crown), or be offered it
//                when its royal line falters and you hold a claim of blood or
//                marriage (the council's offer: accept / decline).
//   PERSONAL     each far crown stays its own kingdom with its own lords. It
//   UNION        keeps its own policies (tax, war stance, faith — the home
//                crown's options, data/throne.json) and up to two decrees
//                (data/highCrowns.json → decrees), allied to the home crown
//                and declaring no war save on an aggressive stance
//                (KingdomAI.considerWar reads kingdom.crown.union).
//   THE VICEROY  you rule it through a viceroy you appoint: your spouse, a
//                grown child or sibling, a courtier, or one of its own great
//                lords. Competence moves its stability and taxes; loyalty
//                drifts weekly toward what the House can command (Prestige,
//                favours, your visits) and sinks with neglect and the lords'
//                discontent; a disloyal viceroy skims the levy into his own
//                purse; a disloyal, ambitious one plots — whispers first —
//                and at last crowns himself, breaking the union.
//   SEPARATISM   0–100 per far crown: its lords want a king of their own.
//                Rises with absence, foreign blood, heavy taxes, tribute,
//                unrest, a child on the throne, an Empire's weight; falls with
//                royal progresses (standing in the realm), a native or kin
//                viceroy, the old charter confirmed. Read by the realm's
//                stability (kingdom.crown.mods → KingdomBonuses), the levy and
//                the viceroy's loyalty; past breakAt, in an unruly realm, its
//                lords crown a native and the union breaks.
//   HIGH CROWN   with two crowns or more, Prestige and land, proclaim an
//                Empire / High Kingship — the title by the home crown's
//                culture (data → titles), a coronation feast paid into the
//                capital, the chronicle and the Annals (LlmProse), a victory
//                goal (data/scenarios.json → high_crown). Lasting: Prestige
//                yearly, stability in every crown. New problems: separatism
//                runs faster, the leagues fear you more and swear "to break
//                the false empire" (systems/coalitions.js), the title lapses
//                if the crowns fall to one.
//   SUCCESSION   the ruler chooses in life: keep the crowns WHOLE for the heir
//                (each far crown tests the new ruler: separatism up; the
//                younger children are aggrieved — aggrieved() for
//                systems/crownSuccession.js) or PARTITION them: each far crown
//                goes to a grown younger child, who rules it as kin
//                (Relationships.succeedAsHeir calls onSuccession).
//
// The levy and every coin are real: a far crown's levy leaves its treasury
// (CrownBooks 'purse'), the viceroy's skim goes into his own purse or his
// seat's, decrees' garrisons are paid into the realm's towns, the coronation
// feast into the capital and the realm. Weekly rolls draw from this system's
// own seeded stream (world seed + day), never the shared one. State on
// player.highCrowns (SaveLoad EXTRA_PLAYER_FIELDS). With no player (the
// interregnum) nothing runs. No import-time side effects.
//
// Interface for other systems: HighCrowns.isEmperor(player),
// HighCrowns.crownsOf(player, world), HighCrowns.unionCrown(player, kid),
// HighCrowns.aggrieved(player), HighCrowns.plan(player).

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Interrupts } from '../core/interrupts.js';
import { Names } from '../core/names.js';
import { Kingdom } from '../world/kingdom.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Characters } from '../world/characters.js';
import { Economy } from '../world/economy.js';
import { House } from './house.js';
import { Throne } from './throne.js';
import { Relationships } from './relationships.js';
import { Court } from './court.js';
import { Regency } from './regency.js';
import { RealmWars } from './realmWars.js';
import { LlmProse } from './llmProse.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _day = (world) => _num(world && world.day);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r1 = (v) => Math.round(v * 10) / 10;
const _fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const YEAR = 120;
const HISTORY_CAP = 40;

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

function _hash(str) {
    let h = Utils.hashStr(String(str)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _hash01(world, key) {
    return (_hash(`${_seed(world)}|highCrowns|${key}`) % 100000) / 100000;
}

/** This system's own stream (mulberry32) for code that draws Utils.random. */
function _rng(world, key) {
    let a = _hash(`${_seed(world)}|highCrownsRng|${key}`) || 1;
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

/** Built-in tuning; data/highCrowns.json → config is laid over it. */
const DEFAULTS = {
    enabled: true, maxCrowns: 4, cadence: 7, offset: 5,
    levy: { share: 0.6, cap: 90, reserve: 400, stability: [25, 75], separatismCut: 0.5 },
    viceroy: {
        baseLoyalty: { spouse: 72, kin: 64, courtier: 58, native: 48 },
        baseAmbition: { spouse: 25, kin: 55, courtier: 45, native: 60 },
        baseCompetence: { spouse: 50, kin: 52, courtier: 55, native: 60 },
        spread: 30, loyaltyTarget: 55, prestigeLoyalty: 0.03, prestigeLoyaltyCap: 15, favourLoyalty: 1,
        neglectDays: 360, neglectLoyaltyPerYear: 10, neglectCap: 25, presenceLoyalty: 6, separatismLoyalty: 0.15,
        drift: 2, favourDecayDays: 120, competenceStability: 0.001, competenceTax: 0.001,
        skimBelow: 45, skimMax: 0.4, plotBelow: 30, plotAmbition: 50, rumourAt: 50, plotDecay: 4,
        giftGold: 200, giftFavour: 10, honourPrestige: 12, honourFavour: 14, honourAmbition: -6,
        replacePrestige: 10, replaceExposedPrestige: 2, replacedLoyaltyHit: 10,
        nativeSeparatism: -0.35, kinSeparatism: -0.2, noViceroySeparatism: 0.6, noViceroyStability: -0.06,
    },
    separatism: {
        start: { civilWar: 30, conquest: 50, inherited: 15, founded: 10, promoted: 0 },
        base: 0.15, absentAfterDays: 120, absent: 0.35, foreignCulture: 0.25, heavyTax: 0.3, lightTax: -0.15,
        present: -1.5, lowStability: 0.3, stabilityPivot: 45, empireMult: 1.25, minorRuler: 0.3, settle: -0.1,
        stabilityMod: 0.0012, warnAt: 70, breakAt: 90, breakStability: 70, breakChance: 0.25,
    },
    inherit: {
        minClaim: 40, span: 50, maxChance: 0.75,
        causes: { distant_relative: 1, disputed: 0.8, regent: 0.7, young_heir: 0.3, heir: 0.08 },
        sources: ['marriage', 'blood'], offerDays: 40, feePerTown: 25, feeMin: 150,
    },
    dictate: { minClaim: 35, maxRatio: 0.5, prestige: 40, reputation: -20 },
    proclaim: {
        minCrowns: 2, minPrestige: 250, minSettlements: 10, prestigeCost: 120, feast: 1500, treasuryShare: 0.5,
        renown: 120, yearlyPrestige: 10, stability: 0.03, coalitionFear: 1.3, leagueResolve: 15,
    },
    succession: { default: 'whole', wholeSpike: 12, minorSpike: 10, viceroyLoyaltyHit: 8, partitionRelations: 60, partitionMinAge: 16 },
    breakaway: { relations: -50, warChance: 0.5, prestigeLoss: 25 },
    power: { crownShare: 0.75, empire: 30 },
};

const TITLE_FALLBACK = { male: 'Emperor', female: 'Empress', realm: 'Empire' };
const KIND_LABEL = { spouse: 'your spouse', kin: 'of your blood', courtier: 'a courtier of your House', native: 'a great lord of the realm' };

let _cfg = null;
let _cfgSrc;

export const HighCrowns = {

    DEFAULTS,

    // ──────────── DATA ────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.highCrowns)) || _obj(DataLoader.highCrowns) || {};
    },

    config() {
        const src = HighCrowns.data().config;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    decrees() {
        const d = _obj(HighCrowns.data().decrees) || {};
        const out = {};
        for (const [id, v] of Object.entries(d)) if (_obj(v) && !id.startsWith('_')) out[id] = v;
        return out;
    },

    decreeSlots() {
        return Math.max(0, _num(_obj(HighCrowns.data().decrees) && HighCrowns.data().decrees.slots, 2));
    },

    _text(id, vars, fallback) {
        const t = _obj(HighCrowns.data().text) || {};
        return _fill(t[id] || fallback, vars);
    },

    /** The high title for a culture and gender: { title, realmWord }. */
    titleFor(culture, gender = 'male') {
        const T = _obj(HighCrowns.data().titles) || {};
        const def = _obj(T[culture]) || _obj(T.default) || TITLE_FALLBACK;
        const g = gender === 'female' ? 'female' : 'male';
        return { title: def[g] || TITLE_FALLBACK[g], realmWord: def.realm || TITLE_FALLBACK.realm };
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            crowns: {},        // { kid: far crown entry }
            empire: null,      // the high crown proclaimed, or null
            past: [],          // high crowns that lapsed: { name, title, from, until, why }
            plan: null,        // 'whole' | 'partition' (null: the config default)
            offers: {},        // { kid: { day, expires, claim, cause, fee } }
            seenSucc: {},      // { kid: day } — AI successions already weighed
            seenInit: false,
            aggrieved: [],     // younger children passed over when the crowns were kept whole
            history: [],
            stats: { won: 0, broken: 0, usurped: 0, released: 0, partitioned: 0, viceroys: 0, coronations: 0 },
        };
    },

    state(player) {
        if (!player) return null;
        if (!_obj(player.highCrowns)) player.highCrowns = HighCrowns._blank();
        const st = player.highCrowns;
        const blank = HighCrowns._blank();
        for (const k of ['crowns', 'offers', 'seenSucc']) if (!_obj(st[k])) st[k] = {};
        for (const k of ['past', 'aggrieved', 'history']) if (!Array.isArray(st[k])) st[k] = [];
        if (!_obj(st.empire)) st.empire = null;
        st.stats = { ...blank.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && player.highCrowns ? JSON.parse(JSON.stringify(player.highCrowns)) : null;
    },

    loadState(player) {
        if (player && player.highCrowns) HighCrowns.state(player);
    },

    _log(player, world, text, tags = null) {
        const st = HighCrowns.state(player);
        st.history.push({ day: _day(world), text });
        if (st.history.length > HISTORY_CAP) st.history.splice(0, st.history.length - HISTORY_CAP);
        if (player.house) House._chronicle(player.house, world, text, tags || ['throne']);
    },

    _kingdom(world, kid) {
        return world && typeof world.getKingdom === 'function' && kid != null ? world.getKingdom(kid) : null;
    },

    // ──────────── READERS (the interface) ────────────

    /** The far crown entry for a kingdom the player holds in personal union, or null. */
    unionCrown(player, kid) {
        const c = player && _obj(player.highCrowns) && _obj(player.highCrowns.crowns);
        return c && kid != null && _obj(c[kid]) ? c[kid] : null;
    },

    /** Has the player proclaimed a high crown (Empire / High Kingship) that still stands? */
    isEmperor(player) {
        return !!(player && _obj(player.highCrowns) && _obj(player.highCrowns.empire));
    },

    /** The high crown proclaimed, or null: { name, title, realmWord, proper, day, by, culture, proseKey }. */
    empire(player) {
        return HighCrowns.isEmperor(player) ? player.highCrowns.empire : null;
    },

    /**
     * Every crown the player wears, the home crown first:
     * [{ kingdomId, kingdom, name, home, since, how, viceroy, separatism, towns }].
     */
    crownsOf(player, world) {
        const out = [];
        if (!player || !world) return out;
        const home = Throne.ruledKingdom(player, world);
        if (home) {
            const r = player.throne.ruling;
            out.push({ kingdomId: home.id, kingdom: home, name: home.name, home: true, since: _num(r.since), how: r.founded ? 'founded' : 'home', viceroy: null, separatism: 0, towns: Throne._settlementsOf(world, home).length });
        }
        const st = _obj(player.highCrowns);
        for (const e of Object.values((st && st.crowns) || {})) {
            const k = HighCrowns._kingdom(world, e.kingdomId);
            if (!k || !k.isAlive) continue;
            out.push({ kingdomId: k.id, kingdom: k, name: k.name, home: false, since: _num(e.since), how: e.how, viceroy: e.viceroy || null, separatism: _r1(_num(e.separatism)), towns: Throne._settlementsOf(world, k).length });
        }
        return out;
    },

    /** The succession plan in force: 'whole' | 'partition'. */
    plan(player) {
        const st = player && _obj(player.highCrowns);
        const p = st && st.plan;
        return p === 'partition' || p === 'whole' ? p : (HighCrowns.config().succession.default === 'partition' ? 'partition' : 'whole');
    },

    /** Younger children passed over when the crowns were kept whole: [{ id, name, day, crowns }]. */
    aggrieved(player) {
        const st = player && _obj(player.highCrowns);
        return st ? _arr(st.aggrieved).slice() : [];
    },

    // ──────────── WINNING A SECOND CROWN ────────────

    /** May a ruler seek another crown (press a claim on it, be offered it, dictate it)? → { ok, reason }. */
    canSeekAnother(player, world, kid) {
        const C = HighCrowns.config();
        if (C.enabled === false) return { ok: false, reason: 'You already wear a crown.' };
        const home = Throne.ruledKingdom(player, world);
        if (home && home.id === kid) return { ok: false, reason: 'You already wear this crown.' };
        if (HighCrowns.unionCrown(player, kid)) return { ok: false, reason: 'You already wear this crown, through your viceroy.' };
        const n = HighCrowns.crownsOf(player, world).length;
        if (n >= _num(C.maxCrowns, 4)) return { ok: false, reason: `No head can carry more than ${_num(C.maxCrowns, 4)} crowns.` };
        return { ok: true };
    },

    /**
     * A far crown joins the union (Throne._takeThrone calls this when the
     * player already rules a home crown). The ruler's stand-in is seated by
     * Throne; this files the crown, its policies, its first viceroy and its
     * lords' temper, and binds it to the home crown in peace and alliance.
     */
    addCrown(player, world, kingdom, opts = {}) {
        const C = HighCrowns.config();
        const st = HighCrowns.state(player);
        const day = _day(world);
        const how = opts.how || 'civilWar';
        const policies = {};
        for (const axis of Throne.POLICY_AXES) {
            const def = Throne.policies()[axis];
            policies[axis] = def ? def.default : null;
        }
        const entry = {
            kingdomId: kingdom.id, name: kingdom.name, since: day, how, policies, decrees: {},
            viceroy: null, separatism: _clamp(_num(C.separatism.start[how], 25), 0, 100),
            levyTotal: 0, lastPresentDay: day, warned: false, skimmed: 0, lastTreasury: _num(kingdom.treasury),
        };
        st.crowns[kingdom.id] = entry;
        st.stats.won++;
        delete st.offers[kingdom.id];
        HighCrowns._bindToHome(player, world, kingdom);
        // The first viceroy: the best of those at hand
        const best = HighCrowns.candidates(player, world, kingdom.id)[0];
        if (best) HighCrowns._seatViceroy(player, world, entry, best, { quiet: true });
        HighCrowns._refreshMods(player, world);
        const home = Throne.ruledKingdom(player, world);
        HighCrowns._log(player, world, `👑 ${player.name || 'The ruler'} now wears the crown of ${Names.realm(kingdom.name)} beside that of ${home ? Names.realm(home.name) : 'the home realm'}${entry.viceroy ? `, and names ${entry.viceroy.name} viceroy there` : ''}.`, ['throne', 'conquest']);
        if (Array.isArray(world.events)) world.events.push({ text: `👑 ${Names.realm(kingdom.name, true)} and ${home ? Names.realm(home.name) : 'another realm'} now share one ruler.`, type: 'political', category: 'political', kingdom: kingdom.id });
        return entry;
    },

    /** The union's realms keep the peace with each other and stand allied. */
    _bindToHome(player, world, k) {
        const home = Throne.ruledKingdom(player, world);
        if (!home || !k || home === k) return;
        if ((home.wars || []).includes(k.id) || (k.wars || []).includes(home.id)) {
            Utils.withRng(_rng(world, `peace:${k.id}:${_day(world)}`), () => KingdomAI.endWar(home, k, world, { text: `🕊️ ${home.name} and ${k.name}, one ruler's now, lay down their arms.` }));
        }
        if (!Array.isArray(home.allies)) home.allies = [];
        if (!Array.isArray(k.allies)) k.allies = [];
        if (!home.allies.includes(k.id)) home.allies.push(k.id);
        if (!k.allies.includes(home.id)) k.allies.push(home.id);
        if (!home.relations) home.relations = {};
        if (!k.relations) k.relations = {};
        home.relations[k.id] = Math.max(_num(home.relations[k.id]), 75);
        k.relations[home.id] = Math.max(_num(k.relations[home.id]), 75);
    },

    // ── The council's offer (a royal line falters) ──

    /** The coronation fee for a realm (paid into its capital's purse). */
    offerFee(world, k) {
        const I = HighCrowns.config().inherit;
        return Math.max(_num(I.feeMin), Throne._settlementsOf(world, k).length * _num(I.feePerTown));
    },

    /** The share of a claim that is of blood or marriage (the only kind a council honours). */
    _bloodClaim(player, kid) {
        const I = HighCrowns.config().inherit;
        const c = player && player.throne && player.throne.claims && player.throne.claims[kid];
        if (!c || !c.sources) return 0;
        return _arr(I.sources).reduce((s, src) => s + _num(c.sources[src]), 0);
    },

    _scanSuccessions(player, world, out) {
        const I = HighCrowns.config().inherit;
        const st = HighCrowns.state(player);
        const day = _day(world);
        const home = Throne.ruledKingdom(player, world);
        for (const k of world.kingdoms || []) {
            const succ = k && k.lastSuccession;
            if (!k || !k.isAlive || !succ) continue;
            if (!st.seenInit || _num(succ.day) <= _num(st.seenSucc[k.id])) { st.seenSucc[k.id] = Math.max(_num(st.seenSucc[k.id]), _num(succ.day)); continue; }
            st.seenSucc[k.id] = _num(succ.day);
            if ((home && home.id === k.id) || HighCrowns.unionCrown(player, k.id) || st.offers[k.id]) continue;
            if (player.throne && player.throne.civilWar && player.throne.civilWar.kingdomId === k.id) continue;
            const claim = Math.min(100, HighCrowns._bloodClaim(player, k.id));
            if (claim < _num(I.minClaim)) continue;
            if (!HighCrowns.canSeekAnother(player, world, k.id).ok) continue;
            const cause = Throne._crisisCause(succ, Throne.config());
            const chance = _clamp((claim - _num(I.minClaim)) / Math.max(1, _num(I.span, 50)) + 0.15, 0, 1) * _num((I.causes || {})[cause]) * _num(I.maxChance, 0.75);
            if (_hash01(world, `offer:${k.id}:${succ.day}`) >= chance) continue;
            const offer = { kingdomId: k.id, name: k.name, day, expires: day + _num(I.offerDays, 40), claim, cause, fee: HighCrowns.offerFee(world, k), oldRuler: succ.oldRulerName || null };
            st.offers[k.id] = offer;
            const text = HighCrowns._text('offer', { realm: Names.realm(k.name), claim }, '{realm} offers you its crown.');
            HighCrowns._log(player, world, `📜 ${text}`, ['throne']);
            out.notices.push({ icon: '📜', title: `The Crown of ${Names.realm(k.name, true)} Is Offered`, text: `${text} Answer within ${_num(I.offerDays, 40)} days (Claims & Crowns → High Crowns).`, type: 'warning' });
            Interrupts.raise(world, { reason: `${Names.realm(k.name, true)} offers you its crown`, icon: '📜', source: 'highCrowns' });
        }
        st.seenInit = true;
        for (const [kid, o] of Object.entries(st.offers)) {
            const k = HighCrowns._kingdom(world, kid);
            if (!k || !k.isAlive || day > _num(o.expires) || HighCrowns.unionCrown(player, kid) || (home && home.id === kid)) {
                delete st.offers[kid];
                if (k && k.isAlive && day > _num(o.expires)) HighCrowns._log(player, world, `📜 The council of ${Names.realm(k.name)} waited in vain; it crowns another.`);
            }
        }
    },

    /** Take the crown the council offers: the coronation fee into its capital, and a crown in union (or your first). */
    acceptOffer(player, world, kid) {
        const st = HighCrowns.state(player);
        const o = st.offers[kid];
        const k = HighCrowns._kingdom(world, kid);
        if (!o || !k || !k.isAlive) return { success: false, reason: 'No such offer stands.' };
        const can = HighCrowns.canSeekAnother(player, world, kid);
        if (!can.ok) return { success: false, reason: can.reason };
        const fee = _num(o.fee);
        if (_num(player.gold) < fee) return { success: false, reason: `The coronation costs ${Utils.formatGold(fee)} gold.` };
        player.gold = _num(player.gold) - fee;
        const cap = k.capital ? world.getTile(k.capital.q, k.capital.r) : null;
        if (!(cap && cap.settlement && Economy.payTown(cap.settlement, fee))) Economy.payRealm(k, world, fee);
        delete st.offers[kid];
        const hadCrown = !!Throne.ruledKingdom(player, world);
        // (any crisis over the throne ends with the crown on your head)
        Throne._takeThrone(player, world, k, { how: 'inherited' });
        House.award(player.house, Math.round(Throne.config().crownedPrestige / 2), `the crown of ${Names.realm(k.name)} by right of blood`, _day(world));
        const text = `👑 The council of ${Names.realm(k.name)} crowns ${player.name || 'you'} by right of ${o.cause === 'distant_relative' ? 'the nearest blood' : 'blood and marriage'}.`;
        HighCrowns._log(player, world, text, ['throne', 'marriage']);
        return { success: true, message: `${text}${hadCrown ? ` Name a viceroy to rule it while you are away.` : ''}` };
    },

    declineOffer(player, world, kid) {
        const st = HighCrowns.state(player);
        const o = st.offers[kid];
        if (!o) return { success: false, reason: 'No such offer stands.' };
        delete st.offers[kid];
        HighCrowns._log(player, world, `📜 ${player.name || 'You'} declines the crown of ${Names.realm(o.name)}.`);
        return { success: true, message: `You decline. The council of ${Names.realm(o.name)} looks elsewhere.` };
    },

    // ── Dictating a crown to a beaten realm ──

    canDictate(player, world, kid, opts = {}) {
        const D = HighCrowns.config().dictate;
        const k = HighCrowns._kingdom(world, kid);
        const home = Throne.ruledKingdom(player, world);
        if (!k || !k.isAlive) return { ok: false, reason: 'No such realm.' };
        if (!home) return { ok: false, reason: 'Only a crowned ruler dictates a crown.' };
        const can = HighCrowns.canSeekAnother(player, world, kid);
        if (!can.ok) return can;
        const c = player.throne && player.throne.claims && player.throne.claims[kid];
        const conquest = _num(c && c.sources && c.sources.conquest);
        if (conquest < _num(D.minClaim)) return { ok: false, reason: `You need a claim by conquest of ${_num(D.minClaim)} (storm its capital).` };
        if (!(home.wars || []).includes(k.id)) return { ok: false, reason: `${home.name} is not at war with ${k.name}.` };
        const ours = _num(home.military) + _num(opts.armyStrength);
        if (_num(k.military) > ours * _num(D.maxRatio, 0.5)) return { ok: false, reason: `${k.name}'s host (${Math.floor(_num(k.military))}) is not broken: it must fall to ${Math.round(_num(D.maxRatio, 0.5) * 100)}% of yours (${Math.floor(ours)}).` };
        if (House.getPrestige(player) < _num(D.prestige)) return { ok: false, reason: `Need ${_num(D.prestige)} Prestige.` };
        return { ok: true };
    },

    dictate(player, world, kid, opts = {}) {
        const D = HighCrowns.config().dictate;
        const can = HighCrowns.canDictate(player, world, kid, opts);
        if (!can.ok) return { success: false, reason: can.reason };
        const k = HighCrowns._kingdom(world, kid);
        const home = Throne.ruledKingdom(player, world);
        House.spend(player.house, _num(D.prestige), `dictating the crown of ${Names.realm(k.name)}`, _day(world));
        Utils.withRng(_rng(world, `dictate:${k.id}:${_day(world)}`), () => KingdomAI.endWar(home, k, world, { text: `🕊️ ${k.name} yields its crown to ${home.name}'s ruler.` }));
        RealmWars.endWar(player, world, k.id, 'the crown was yielded');
        Throne._takeThrone(player, world, k, { how: 'conquest' });
        if (!player.reputation) player.reputation = {};
        player.reputation[k.id] = _clamp(_num(player.reputation[k.id]) + _num(D.reputation), -100, 100);
        const text = `⚔️ Beaten in the field, the court of ${Names.realm(k.name)} yields its crown to ${player.name || 'the conqueror'}.`;
        HighCrowns._log(player, world, text, ['throne', 'conquest', 'war']);
        return { success: true, message: `${text} Its lords bow, and hate you for it.` };
    },

    // ──────────── THE VICEROY ────────────

    /** A viceroy's ambition and competence: their kind, their traits, a little of their own (hash of who). */
    _temper(world, kind, id, traits, skillAvg = null) {
        const V = HighCrowns.config().viceroy;
        const has = (t) => _arr(traits).some(x => (x && x.id ? x.id : x) === t);
        let amb = _num(V.baseAmbition[kind], 45) + Math.round((_hash01(world, `amb:${kind}:${id}`) - 0.5) * _num(V.spread, 30));
        if (has('ambitious') || has('greedy') || has('scheming')) amb += 20;
        if (has('loyal') || has('content') || has('honest') || has('honorable')) amb -= 15;
        let comp = _num(V.baseCompetence[kind], 50) + Math.round((_hash01(world, `comp:${kind}:${id}`) - 0.5) * _num(V.spread, 30));
        if (skillAvg != null) comp = Math.round(comp * 0.5 + _clamp(skillAvg * 5, 0, 100) * 0.5);
        if (has('lazy') || has('drunkard')) comp -= 12;
        if (has('diligent') || has('administrator') || has('just')) comp += 10;
        return { ambition: _clamp(Math.round(amb), 0, 100), competence: _clamp(Math.round(comp), 5, 100) };
    },

    /**
     * Who could rule a far crown in your name: your spouse, grown children
     * and siblings at home, your courtiers, the realm's own great lords.
     * [{ kind, id, name, loyalty, ambition, competence, culture, blurb }], best first.
     */
    candidates(player, world, kid) {
        const V = HighCrowns.config().viceroy;
        const k = HighCrowns._kingdom(world, kid);
        const st = HighCrowns.state(player);
        const out = [];
        if (!player || !k) return out;
        const busy = new Set(Object.values(st.crowns).filter(e => e.kingdomId !== kid && e.viceroy).map(e => `${e.viceroy.kind}:${e.viceroy.id}`));
        const push = (kind, id, name, traits, culture, skillAvg) => {
            if (busy.has(`${kind}:${id}`)) return;
            const t = HighCrowns._temper(world, kind, id, traits, skillAvg);
            out.push({ kind, id, name, loyalty: _num(V.baseLoyalty[kind], 55), ambition: t.ambition, competence: t.competence, culture: culture || null, blurb: KIND_LABEL[kind] || kind });
        };
        if (player.spouse) {
            const sp = Relationships.getNPC(player.spouse);
            if (sp && sp.isAlive !== false && sp.isMarried !== false) push('spouse', sp.id, `${sp.firstName}${sp.dynasty ? ` ${sp.dynasty}` : ''}`, sp.traits, sp.culture, null);
        }
        for (const c of player.children || []) {
            if (!c || c.isAlive === false || _num(c.age) < 16 || c.crownedIn) continue;
            const up = c.upbringing || {};
            if (up.heldBy || (up.path && up.path.active)) continue;
            const sk = c.skills ? Object.values(c.skills).filter(v => Number.isFinite(v)) : [];
            push('kin', c.id, `${c.firstName}${c.dynasty ? ` ${c.dynasty}` : ''}`, [..._arr(c.traits), ..._arr(up.adultTraits)], player.culture || null, sk.length ? sk.reduce((a, b) => a + b, 0) / sk.length : null);
        }
        for (const npc of Court.members(player)) {
            const sk = Court.ensureSkills(npc) || {};
            const vals = Object.values(sk).filter(v => Number.isFinite(v));
            push('courtier', npc.id, `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`, npc.traits, npc.culture, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length * 0.6 : null);
        }
        const adv = k.characterData && _obj(k.characterData.advisors);
        for (const a of Object.values(adv || {})) {
            if (!a || a.isAlive === false) continue;
            const sk = a.skills ? Object.values(a.skills).filter(v => Number.isFinite(v)) : [];
            const base = _num(V.baseLoyalty.native, 48);
            const kindLoyal = Math.round((base + _num(a.loyalty, base)) / 2);
            const t = HighCrowns._temper(world, 'native', a.id, a.traits, sk.length ? sk.reduce((x, y) => x + y, 0) / sk.length : null);
            if (busy.has(`native:${a.id}`)) continue;
            out.push({ kind: 'native', id: a.id, name: Characters.getFullName ? Characters.getFullName(a) : `${a.firstName} ${a.dynasty || ''}`.trim(), loyalty: kindLoyal, ambition: t.ambition, competence: t.competence, culture: a.culture || k.culture, blurb: `${KIND_LABEL.native}${a.advisorRole ? ` (${a.advisorRole})` : ''}` });
        }
        // Best first: competence, then loyalty, less ambition
        return out.sort((a, b) => (b.competence + b.loyalty - b.ambition * 0.5) - (a.competence + a.loyalty - a.ambition * 0.5));
    },

    _seatViceroy(player, world, entry, cand, { quiet = false } = {}) {
        const st = HighCrowns.state(player);
        entry.viceroy = {
            kind: cand.kind, id: cand.id, name: cand.name, loyalty: _num(cand.loyalty, 55), ambition: _num(cand.ambition, 45),
            competence: _num(cand.competence, 50), culture: cand.culture || null, since: _day(world), favour: 0, plot: 0, rumoured: false,
        };
        st.stats.viceroys++;
        if (!quiet) HighCrowns._log(player, world, `🏛️ ${cand.name} is named viceroy of ${Names.realm(entry.name)}.`, ['throne', 'court']);
        return entry.viceroy;
    },

    /** Name a viceroy (kind + id from candidates). Replacing one costs Prestige (little if their plot was whispered). */
    appoint(player, world, kid, kind, id) {
        const V = HighCrowns.config().viceroy;
        const entry = HighCrowns.unionCrown(player, kid);
        if (!entry) return { success: false, reason: 'You do not hold that crown in union.' };
        const cand = HighCrowns.candidates(player, world, kid).find(c => c.kind === kind && String(c.id) === String(id));
        if (!cand) return { success: false, reason: 'They cannot be your viceroy.' };
        const old = entry.viceroy;
        if (old && old.kind === kind && String(old.id) === String(id)) return { success: false, reason: `${cand.name} already rules there in your name.` };
        if (old) {
            const cost = old.rumoured ? _num(V.replaceExposedPrestige) : _num(V.replacePrestige);
            if (cost > 0 && !House.spend(player.house, cost, `replacing the viceroy of ${entry.name}`, _day(world))) return { success: false, reason: `Need ${cost} Prestige to set ${old.name} aside.` };
        }
        HighCrowns._seatViceroy(player, world, entry, cand);
        HighCrowns._refreshMods(player, world);
        return { success: true, message: `${cand.name} will rule ${Names.realm(entry.name)} in your name${old ? `; ${old.name} is set aside` : ''}.` };
    },

    _viceroyAlive(player, world, entry) {
        const v = entry && entry.viceroy;
        if (!v) return false;
        if (v.kind === 'spouse' || v.kind === 'courtier') {
            const npc = Relationships.getNPC(v.id);
            if (v.kind === 'courtier' && !Court.isMember(player, v.id)) return false;
            return !!npc && npc.isAlive !== false;
        }
        if (v.kind === 'kin') {
            const c = (player.children || []).find(x => x && x.id === v.id);
            return !!(c && c.isAlive !== false && !c.crownedIn);
        }
        if (v.kind === 'native') {
            const k = HighCrowns._kingdom(world, entry.kingdomId);
            const adv = k && k.characterData && _obj(k.characterData.advisors);
            return !!Object.values(adv || {}).find(a => a && a.id === v.id && a.isAlive !== false);
        }
        return false;
    },

    /** Where the viceroy's skim goes: { holder, key } — his purse, his portion, or his seat's coffers; null when nowhere real. */
    _viceroyTill(player, world, entry) {
        const v = entry && entry.viceroy;
        if (!v) return null;
        if (v.kind === 'spouse' || v.kind === 'courtier') {
            const npc = Relationships.getNPC(v.id);
            return npc && npc.isAlive !== false ? { holder: npc, key: 'purse' } : null;
        }
        if (v.kind === 'kin') {
            const c = (player.children || []).find(x => x && x.id === v.id && x.isAlive !== false);
            return c ? { holder: c, key: 'purse' } : null;
        }
        const k = HighCrowns._kingdom(world, entry.kingdomId);
        const t = k && k.capital ? world.getTile(k.capital.q, k.capital.r) : null;
        const s = t && t.settlement;
        if (s && !s.inKind) {
            if (!s.economy) Economy.initSettlement(s);
            return { holder: s.economy, key: 'gold' };
        }
        return null;
    },

    /** Win the viceroy's goodwill: how = 'gift' (gold into his purse) | 'honour' (Prestige). */
    favour(player, world, kid, how) {
        const V = HighCrowns.config().viceroy;
        const entry = HighCrowns.unionCrown(player, kid);
        const v = entry && entry.viceroy;
        if (!v) return { success: false, reason: 'There is no viceroy to favour.' };
        if (how === 'gift') {
            const amt = _num(V.giftGold);
            if (_num(player.gold) < amt) return { success: false, reason: `A fitting gift is ${Utils.formatGold(amt)} gold.` };
            const till = HighCrowns._viceroyTill(player, world, entry);
            if (!till) return { success: false, reason: `${v.name} has no purse to receive it.` };
            player.gold = _num(player.gold) - amt;
            till.holder[till.key] = _num(till.holder[till.key]) + amt;
            v.favour = _num(v.favour) + _num(V.giftFavour);
            return { success: true, message: `${v.name} thanks you for the gift (${Utils.formatGold(amt)}g). Their loyalty will warm.` };
        }
        if (how === 'honour') {
            const cost = _num(V.honourPrestige);
            if (!House.spend(player.house, cost, `honouring ${v.name}`, _day(world))) return { success: false, reason: `Need ${cost} Prestige.` };
            v.favour = _num(v.favour) + _num(V.honourFavour);
            v.ambition = _clamp(_num(v.ambition) + _num(V.honourAmbition), 0, 100);
            return { success: true, message: `You honour ${v.name} before both courts. Their loyalty warms and their ambition is sated a little.` };
        }
        return { success: false, reason: 'Unknown favour.' };
    },

    /** Where the viceroy's loyalty is heading, and why: { value, parts: [{ label, value }] }. */
    loyaltyTarget(player, world, entry) {
        const V = HighCrowns.config().viceroy;
        const day = _day(world);
        const parts = [];
        const add = (label, v) => { v = Math.round(v); if (v) parts.push({ label, value: v }); return v; };
        let t = add('Duty', _num(V.loyaltyTarget, 55));
        t += add('Your House\'s Prestige', Math.min(_num(V.prestigeLoyaltyCap, 15), House.getPrestige(player) * _num(V.prestigeLoyalty)));
        t += add('Your favours', _num(entry.viceroy && entry.viceroy.favour) * _num(V.favourLoyalty, 1));
        const away = day - _num(entry.lastPresentDay, entry.since);
        if (away <= 30) t += add('Your presence', _num(V.presenceLoyalty));
        else if (away > _num(V.neglectDays, 360)) t += add('Neglect', -Math.min(_num(V.neglectCap, 25), (away - _num(V.neglectDays, 360)) / YEAR * _num(V.neglectLoyaltyPerYear, 10)));
        t += add('The lords\' discontent', -_num(entry.separatism) * _num(V.separatismLoyalty));
        if (entry.viceroy && entry.viceroy.ambition >= 60) t += add('His ambition', -(entry.viceroy.ambition - 60) / 4);
        return { value: _clamp(Math.round(t), 0, 100), parts };
    },

    // ──────────── POLICIES & DECREES (per crown) ────────────

    setPolicy(player, world, kid, axis, optionId) {
        const entry = HighCrowns.unionCrown(player, kid);
        if (!entry) return { success: false, reason: 'You do not hold that crown in union.' };
        const def = Throne.policies()[axis];
        const opt = def && def.options && def.options[optionId];
        if (!opt) return { success: false, reason: 'No such policy.' };
        if (entry.policies[axis] === optionId) return { success: false, reason: 'That is already its policy.' };
        entry.policies[axis] = optionId;
        HighCrowns._refreshMods(player, world);
        return { success: true, message: `${Names.realm(entry.name, true)}: ${def.label}, ${opt.label}. ${opt.blurb || ''}`.trim() };
    },

    proclaimDecree(player, world, kid, id) {
        const entry = HighCrowns.unionCrown(player, kid);
        const def = HighCrowns.decrees()[id];
        if (!entry) return { success: false, reason: 'You do not hold that crown in union.' };
        if (!def) return { success: false, reason: 'No such decree.' };
        if (entry.decrees[id]) return { success: false, reason: 'That decree is already in force.' };
        if (Object.keys(entry.decrees).length >= HighCrowns.decreeSlots()) return { success: false, reason: `A realm bears ${HighCrowns.decreeSlots()} decrees from a far king at most. Revoke one first.` };
        const cost = _num(def.prestige);
        if (cost > 0 && !House.spend(player.house, cost, `${def.label} in ${entry.name}`, _day(world))) return { success: false, reason: `Need ${cost} Prestige.` };
        entry.decrees[id] = _day(world);
        HighCrowns._refreshMods(player, world);
        HighCrowns._log(player, world, `${def.icon || '📜'} ${player.name || 'The ruler'} decrees for ${Names.realm(entry.name)}: ${def.label}.`, ['throne', 'court']);
        return { success: true, message: `${def.label}: ${def.blurb || ''}`.trim() };
    },

    revokeDecree(player, world, kid, id) {
        const entry = HighCrowns.unionCrown(player, kid);
        if (!entry || !entry.decrees[id]) return { success: false, reason: 'No such decree is in force there.' };
        delete entry.decrees[id];
        HighCrowns._refreshMods(player, world);
        const def = HighCrowns.decrees()[id] || {};
        return { success: true, message: `${def.label || id} is revoked in ${Names.realm(entry.name)}.` };
    },

    _decreeSum(entry, key) {
        const D = HighCrowns.decrees();
        let v = 0;
        for (const id of Object.keys((entry && entry.decrees) || {})) v += _num(D[id] && D[id][key]);
        return v;
    },

    _decreeProduct(entry, key) {
        const D = HighCrowns.decrees();
        let v = 1;
        for (const id of Object.keys((entry && entry.decrees) || {})) if (D[id] && Number.isFinite(D[id][key])) v *= D[id][key];
        return v;
    },

    /** The viceroy's working competence (a native court ties his hands). */
    competence(entry) {
        const v = entry && entry.viceroy;
        return v ? _clamp(_num(v.competence, 50) + HighCrowns._decreeSum(entry, 'viceroyCompetence'), 0, 100) : 0;
    },

    /**
     * What this system adds to a crown's kingdom.crown.mods (read by
     * KingdomBonuses.get through Throne.syncCrowns): for a far crown its
     * policies, viceroy, decrees and the lords' discontent; for any crown of
     * an Empire the imperial name's stability.
     */
    crownMods(player, kid) {
        const mods = {};
        const add = (key, v) => { if (v) mods[key] = _r1((_num(mods[key]) + v) * 1000) / 1000; };
        const entry = HighCrowns.unionCrown(player, kid);
        if (entry) {
            const V = HighCrowns.config().viceroy;
            const S = HighCrowns.config().separatism;
            for (const [key, v] of Object.entries(Throne.policyMods(entry.policies || {}))) add(key, v);
            if (entry.viceroy) {
                const c = HighCrowns.competence(entry) - 50;
                add('stability', c * _num(V.competenceStability));
                add('tax', c * _num(V.competenceTax));
            } else add('stability', _num(V.noViceroyStability));
            add('stability', -_num(entry.separatism) * _num(S.stabilityMod));
            const D = HighCrowns.decrees();
            for (const id of Object.keys(entry.decrees || {})) {
                for (const [key, v] of Object.entries((D[id] && D[id].mods) || {})) add(key, _num(v));
            }
        }
        if (HighCrowns.isEmperor(player) && (entry || (player.throne && player.throne.ruling && player.throne.ruling.kingdomId === kid))) {
            add('stability', _num(HighCrowns.config().proclaim.stability));
        }
        return mods;
    },

    _refreshMods(player, world) {
        if (world && Array.isArray(world.kingdoms)) Throne.syncCrowns(player, world);
    },

    // ──────────── THE LEVY ────────────

    /** Today's levy from a far crown and why: { levy, rate, revenue, upkeep, stabilityMult, reserve, cap, skim, limit }. */
    levyQuote(player, world, kid) {
        const L = HighCrowns.config().levy;
        const entry = HighCrowns.unionCrown(player, kid);
        const k = HighCrowns._kingdom(world, kid);
        const out = { levy: 0, rate: 0, revenue: 0, upkeep: 0, stabilityMult: 0, reserve: _num(L.reserve), cap: _num(L.cap), skim: 0, limit: 'rate' };
        if (!entry || !k) return out;
        const tax = Throne.policies().tax;
        const opt = tax && tax.options && tax.options[entry.policies.tax];
        out.rate = _num(opt && opt.levy) * _num(L.share, 0.6) * HighCrowns._decreeProduct(entry, 'levy') * (1 - _num(entry.separatism) / 100 * _num(L.separatismCut, 0.5));
        if (CrownBooks.enabled()) {
            out.revenue = CrownBooks.lastRevenue(k);
            out.upkeep = CrownBooks.upkeep(k);
        } else {
            out.revenue = Math.max(0, _num(k.treasury) - _num(entry.lastTreasury, _num(k.treasury)));
        }
        const stab = typeof k.stability === 'number' ? k.stability : 60;
        const [lo, hi] = Array.isArray(L.stability) ? L.stability : [25, 75];
        out.stabilityMult = _clamp((stab - lo) / Math.max(1, hi - lo), 0, 1);
        const base = Math.max(0, out.revenue) * out.rate;
        let v = base;
        const lims = [
            ['stability', base * out.stabilityMult],
            ['surplus', Math.max(Math.max(0, out.revenue - out.upkeep) * 0.75, base * out.stabilityMult * 0.25)],
            ['reserve', _num(k.treasury) - out.reserve],
            ['cap', out.cap],
        ];
        for (const [id, x] of lims) if (x < v) { v = x; out.limit = id; }
        out.levy = Math.max(0, Math.floor(v));
        const V = HighCrowns.config().viceroy;
        const vic = entry.viceroy;
        if (vic && vic.loyalty < _num(V.skimBelow, 45) && out.levy > 0) {
            out.skim = Math.floor(out.levy * _num(V.skimMax, 0.4) * (_num(V.skimBelow, 45) - vic.loyalty) / _num(V.skimBelow, 45));
        }
        return out;
    },

    _levyDay(player, world, entry, k, out) {
        const q = HighCrowns.levyQuote(player, world, entry.kingdomId);
        entry.lastTreasury = _num(k.treasury);
        if (!(q.levy > 0)) return;
        k.treasury = _num(k.treasury) - q.levy;
        CrownBooks.note(k, 'purse', q.levy);
        let skim = q.skim;
        const till = skim > 0 ? HighCrowns._viceroyTill(player, world, entry) : null;
        if (till) {
            till.holder[till.key] = _num(till.holder[till.key]) + skim;
            entry.skimmed = _num(entry.skimmed) + skim;
        } else skim = 0;
        const toPurse = q.levy - skim;
        player.gold = _num(player.gold) + toPurse;
        entry.levyTotal = _num(entry.levyTotal) + toPurse;
        if (player.financeToday && player.financeToday.income) {
            player.financeToday.income.royalLevy = _num(player.financeToday.income.royalLevy) + toPurse;
        }
        out.levy += toPurse;
        entry.lastTreasury = _num(k.treasury);
    },

    // ──────────── THE DAY ────────────

    /**
     * The daily hook (after Throne.processDaily and Kingship.processDay).
     * Daily: offers, the levy, presence, the union's peace, garrisons paid.
     * Weekly: viceroys, separatism, breakaways, the Empire's year.
     * Returns { notices: [{ icon, title, text, type }], levy }.
     */
    processDay(world, player) {
        const out = { notices: [], levy: 0 };
        const C = HighCrowns.config();
        if (!world || !player || player.interregnum || C.enabled === false || !Array.isArray(world.kingdoms)) return out;
        const st = HighCrowns.state(player);
        const day = _day(world);
        HighCrowns._scanSuccessions(player, world, out);
        const far = Object.values(st.crowns);
        if (!far.length && !st.empire) return out;

        // The home crown lost (abdicated, fallen): the eldest far crown becomes home
        if (!Throne.ruledKingdom(player, world) && far.length) HighCrowns.onHomeLost(player, world, out);

        const here = world.getTile ? world.getTile(player.q, player.r) : null;
        for (const entry of Object.values(st.crowns)) {
            const k = HighCrowns._kingdom(world, entry.kingdomId);
            if (!k || !k.isAlive) {
                delete st.crowns[entry.kingdomId];
                HighCrowns._log(player, world, `💀 ${entry.name} has fallen, and that crown with it.`);
                out.notices.push({ icon: '💀', title: 'A Crown Lost', text: `${entry.name} has fallen; you wear its crown no more.`, type: 'error' });
                continue;
            }
            entry.name = k.name;
            // The ruler's stand-in on its throne carries the ruler's name (an heir's, after a succession)
            const ruler = Throne._playerRuler(player, k);
            if (k.characterData) k.characterData.ruler = ruler;
            k.ruler = Characters.getDisplayName(ruler, k);
            if (k.lord) k.lord.name = entry.viceroy ? entry.viceroy.name : k.ruler;
            if (here && here.kingdom === k.id) entry.lastPresentDay = day;
            HighCrowns._bindToHome(player, world, k);
            HighCrowns._levyDay(player, world, entry, k, out);
            const cost = HighCrowns._decreeSum(entry, 'cost');
            if (cost > 0) Economy.crownSpend(k, world, cost);
            if (entry.viceroy && !HighCrowns._viceroyAlive(player, world, entry)) {
                const gone = entry.viceroy.name;
                entry.viceroy = null;
                const next = HighCrowns.candidates(player, world, entry.kingdomId)[0];
                if (next) HighCrowns._seatViceroy(player, world, entry, next, { quiet: true });
                out.notices.push({ icon: '🏛️', title: 'A New Viceroy', text: `${gone} can rule ${Names.realm(entry.name)} no longer.${entry.viceroy ? ` ${entry.viceroy.name} takes up the seals until you choose otherwise.` : ' The realm has no viceroy: name one.'}`, type: 'warning' });
            }
        }

        const cad = Math.max(1, _num(C.cadence, 7));
        if (day > 0 && (day + _num(C.offset)) % cad === 0) {
            Utils.withRng(_rng(world, `week:${day}`), () => HighCrowns._week(player, world, out));
        }
        HighCrowns._empireDay(player, world, out);
        HighCrowns._refreshMods(player, world);
        return out;
    },

    _week(player, world, out) {
        const C = HighCrowns.config();
        const V = C.viceroy;
        const S = C.separatism;
        const st = HighCrowns.state(player);
        const day = _day(world);
        const home = Throne.ruledKingdom(player, world);
        const minor = Regency.active(player);
        for (const entry of Object.values(st.crowns)) {
            const k = HighCrowns._kingdom(world, entry.kingdomId);
            if (!k || !k.isAlive) continue;
            const v = entry.viceroy;
            // ── The viceroy ──
            if (v) {
                const target = HighCrowns.loyaltyTarget(player, world, entry).value;
                const diff = target - v.loyalty;
                v.loyalty = _clamp(Math.round(v.loyalty + Math.sign(diff) * Math.min(Math.abs(diff), _num(V.drift, 2)) + Utils.randInt(-1, 1)), 0, 100);
                if (v.favour > 0) v.favour = Math.max(0, _r1(v.favour - _num(C.cadence, 7) * 10 / Math.max(1, _num(V.favourDecayDays, 120))));
                if (v.loyalty < _num(V.plotBelow) && v.ambition >= _num(V.plotAmbition)) {
                    v.plot = Math.min(100, _num(v.plot) + Math.round(v.ambition / 12) + Utils.randInt(0, 3));
                    if (!v.rumoured && v.plot >= _num(V.rumourAt)) {
                        v.rumoured = true;
                        out.notices.push({ icon: '🕵️', title: `Whispers from ${Names.realm(k.name, true)}`, text: `It is whispered that ${v.name}, your viceroy, means to wear the crown of ${Names.realm(k.name)} himself. Win him back with favours, go there in person — or replace him while it is only talk.`, type: 'warning' });
                        HighCrowns._log(player, world, `🕵️ Whispers that ${v.name}, viceroy of ${Names.realm(k.name)}, plots for its crown.`, ['throne', 'betrayal']);
                        Interrupts.raise(world, { reason: `Your viceroy in ${k.name} plots`, icon: '🕵️', source: 'highCrowns' });
                    }
                    if (v.plot >= 100) { HighCrowns._breakaway(player, world, entry, 'usurp', out); continue; }
                } else if (v.plot > 0 && v.loyalty >= _num(V.skimBelow)) {
                    v.plot = Math.max(0, v.plot - _num(V.plotDecay, 4));
                    if (v.plot < _num(V.rumourAt) / 2) v.rumoured = false;
                }
            }
            // ── The lords' temper ──
            let d = _num(S.base);
            const away = day - _num(entry.lastPresentDay, entry.since);
            if (away > _num(S.absentAfterDays)) d += _num(S.absent);
            if (home && k.culture && home.culture && k.culture !== home.culture) d += _num(S.foreignCulture);
            if (entry.policies.tax === 'heavy') d += _num(S.heavyTax);
            if (entry.policies.tax === 'light') d += _num(S.lightTax);
            if (!v) d += _num(V.noViceroySeparatism);
            else if (v.kind === 'native') d += _num(V.nativeSeparatism);
            else if (v.kind === 'kin') d += _num(V.kinSeparatism);
            d += HighCrowns._decreeSum(entry, 'separatism');
            const stab = typeof k.stability === 'number' ? k.stability : 60;
            if (stab < _num(S.stabilityPivot)) d += _num(S.lowStability);
            if (minor) d += _num(S.minorRuler);
            if (d > 0 && HighCrowns.isEmperor(player)) d *= _num(S.empireMult, 1);
            if (away <= 7) d += _num(S.present);
            d += _num(S.settle);
            entry.separatism = _clamp(_r1(_num(entry.separatism) + d), 0, 100);
            if (!entry.warned && entry.separatism >= _num(S.warnAt)) {
                entry.warned = true;
                out.notices.push({ icon: '🏴', title: `${Names.realm(k.name, true)} Grows Restless`, text: `The lords of ${Names.realm(k.name)} talk of a king of their own (discontent ${Math.round(entry.separatism)}). Go there, confirm their charter, give them a native viceroy — or lose the crown.`, type: 'warning' });
                Interrupts.raise(world, { reason: `${k.name}'s lords want a king of their own`, icon: '🏴', source: 'highCrowns' });
            } else if (entry.warned && entry.separatism < _num(S.warnAt) - 10) entry.warned = false;
            // (past breakAt an unruly realm rises; at 100 even a quiet one does)
            if (entry.separatism >= _num(S.breakAt) && (stab < _num(S.breakStability) || entry.separatism >= 100) && Utils.random() < _num(S.breakChance)) {
                HighCrowns._breakaway(player, world, entry, 'lords', out);
            }
        }
    },

    _empireDay(player, world, out) {
        const st = HighCrowns.state(player);
        const e = st.empire;
        if (!e) return;
        const P = HighCrowns.config().proclaim;
        const crowns = HighCrowns.crownsOf(player, world).length;
        if (crowns < _num(P.minCrowns, 2)) {
            HighCrowns._lapse(player, world, 'its crowns fell to one', out);
            return;
        }
        HighCrowns.styleTitle(player, world);
        const day = _day(world);
        if (day >= _num(e.nextYearDay)) {
            e.nextYearDay = day + YEAR;
            if (_num(P.yearlyPrestige) > 0) House.award(player.house, _num(P.yearlyPrestige), `the ${e.realmWord} of ${e.proper}`, day);
        }
    },

    _lapse(player, world, why, out = null) {
        const st = HighCrowns.state(player);
        const e = st.empire;
        if (!e) return;
        st.past.push({ name: e.name, title: e.title, from: e.day, until: _day(world), why });
        if (st.past.length > 12) st.past.splice(0, st.past.length - 12);
        st.empire = null;
        const text = `🥀 The ${e.name} is no more: ${why}.`;
        HighCrowns._log(player, world, text, ['throne', 'betrayal']);
        if (out) out.notices.push({ icon: '🥀', title: `The ${e.realmWord} Is No More`, text, type: 'error' });
        const home = Throne.ruledKingdom(player, world);
        if (home) Throne._styleRuler(player, home, Throne._playerRuler(player, home));
    },

    // ──────────── BREAKING THE UNION ────────────

    /** The old line's heir for a realm: its eldest grown royal child, else a kinsman of its dynasty. */
    _oldLineHeir(world, k) {
        const data = k.characterData;
        const royal = data && Array.isArray(data.children)
            ? data.children.filter(c => c && c.isAlive !== false && _num(c.age) >= 16).sort((a, b) => _num(b.age) - _num(a.age))[0] : null;
        if (royal) {
            data.children = data.children.filter(c => c !== royal);
            return royal;
        }
        return Utils.withRng(_rng(world, `heir:${k.id}:${_day(world)}`), () => Characters.generateCharacter({
            culture: k.culture, age: Utils.randInt(25, 45),
            dynasty: data && data.dynasty ? data.dynasty.name : undefined, isRuler: true,
        }));
    },

    /** The player's stand-in leaves the throne; `heir` (a character) takes it. */
    _handOver(player, world, entry, k, heir) {
        const st = HighCrowns.state(player);
        const data = k.characterData;
        const stand = data && data.ruler && data.ruler.isPlayer ? data.ruler : null;
        Throne._installRuler(world, k, heir);
        if (stand) { stand.isAlive = false; stand.deposed = false; }
        delete st.crowns[entry.kingdomId];
        if (k.crown) delete k.crown;
    },

    _breakaway(player, world, entry, how, out) {
        const B = HighCrowns.config().breakaway;
        const st = HighCrowns.state(player);
        const k = HighCrowns._kingdom(world, entry.kingdomId);
        if (!k) return;
        const home = Throne.ruledKingdom(player, world);
        const v = entry.viceroy;
        const seatTile = k.capital ? world.getTile(k.capital.q, k.capital.r) : null;
        const seat = (seatTile && seatTile.settlement && seatTile.settlement.name) || k.name;
        let heir;
        if (how === 'usurp' && v) {
            const adv = k.characterData && _obj(k.characterData.advisors);
            const native = v.kind === 'native' ? Object.entries(adv || {}).find(([, a]) => a && a.id === v.id) : null;
            if (native) {
                heir = native[1];
                delete adv[native[0]];
            } else {
                const child = v.kind === 'kin' ? (player.children || []).find(c => c && c.id === v.id) : null;
                const parts = String(v.name).split(' ');
                heir = Utils.withRng(_rng(world, `usurper:${k.id}:${_day(world)}`), () => Characters.generateCharacter({
                    culture: v.culture || k.culture, age: child ? Math.max(16, _num(child.age, 30)) : 35,
                    gender: child ? child.gender : undefined, name: parts[0], dynasty: parts.slice(1).join(' ') || undefined, isRuler: true,
                }));
                if (child) child.crownedIn = { kingdomId: k.id, day: _day(world), hostile: true };
            }
            st.stats.usurped++;
        } else {
            heir = HighCrowns._oldLineHeir(world, k);
            st.stats.broken++;
        }
        HighCrowns._handOver(player, world, entry, k, heir);
        // The realm turns from its old master
        if (home) {
            home.allies = (home.allies || []).filter(id => id !== k.id);
            k.allies = (k.allies || []).filter(id => id !== home.id);
            if (!home.relations) home.relations = {};
            if (!k.relations) k.relations = {};
            home.relations[k.id] = Math.min(_num(home.relations[k.id]), _num(B.relations));
            k.relations[home.id] = Math.min(_num(k.relations[home.id]), _num(B.relations));
            if (_hash01(world, `breakwar:${k.id}:${_day(world)}`) < _num(B.warChance) && !(k.wars || []).includes(home.id)) {
                Utils.withRng(_rng(world, `breakwar:${k.id}:${_day(world)}`), () => KingdomAI.startWar(k, home, world));
            }
        }
        if (player.house && _num(B.prestigeLoss) > 0) {
            const loss = Math.min(_num(B.prestigeLoss), House.getPrestige(player));
            if (loss > 0) House.spend(player.house, loss, `the crown of ${k.name} lost`, _day(world));
        }
        const text = how === 'usurp'
            ? HighCrowns._text('usurp', { viceroy: v ? v.name : 'your viceroy', realm: Names.realm(k.name), seat }, '{viceroy} has crowned himself.')
            : HighCrowns._text('breakaway', { realm: Names.realm(k.name), ruler: k.ruler, seat }, 'The union is broken.');
        HighCrowns._log(player, world, `💔 ${text}`, ['throne', 'betrayal']);
        if (Array.isArray(world.events)) world.events.push({ text: `💔 ${text}`, type: 'political', category: 'political', kingdom: k.id });
        if (out) {
            out.notices.push({ icon: '💔', title: how === 'usurp' ? 'The Viceroy Crowns Himself' : `${Names.realm(k.name, true)} Breaks Away`, text: `${text}${(k.wars || []).includes(home && home.id) ? ` ${k.name} is at war with you.` : ''}`, type: 'error' });
            Interrupts.raise(world, { reason: `${k.name} has broken from your crown`, icon: '💔', source: 'highCrowns' });
        }
    },

    /** Lay down a far crown: its old line takes it back, in peace. */
    release(player, world, kid) {
        const st = HighCrowns.state(player);
        const entry = HighCrowns.unionCrown(player, kid);
        const k = HighCrowns._kingdom(world, kid);
        if (!entry || !k) return { success: false, reason: 'You do not hold that crown in union.' };
        const heir = HighCrowns._oldLineHeir(world, k);
        HighCrowns._handOver(player, world, entry, k, heir);
        st.stats.released++;
        const home = Throne.ruledKingdom(player, world);
        if (home && k.relations) k.relations[home.id] = Math.max(_num(k.relations[home.id]), 30);
        const text = `👑 ${player.name || 'The ruler'} lays down the crown of ${Names.realm(k.name)}. ${k.ruler} of its old line takes it.`;
        HighCrowns._log(player, world, text, ['throne']);
        HighCrowns._refreshMods(player, world);
        return { success: true, message: text };
    },

    /** Every far crown back to its old line (the player's line ends: Throne.passCrown). */
    releaseAll(player, world, how = 'died') {
        const st = player && _obj(player.highCrowns);
        if (!st || !world) return [];
        const out = [];
        for (const entry of Object.values(st.crowns || {})) {
            const k = HighCrowns._kingdom(world, entry.kingdomId);
            if (!k) { delete st.crowns[entry.kingdomId]; continue; }
            HighCrowns._handOver(player, world, entry, k, HighCrowns._oldLineHeir(world, k));
            out.push(k.name);
            if (player.house) House._chronicle(player.house, world, `👑 The crown of ${Names.realm(k.name)} passes back to its old line (${how}): ${k.ruler}.`, ['throne']);
        }
        if (st.empire) HighCrowns._lapse(player, world, 'its line ended');
        st.offers = {};
        return out;
    },

    /** The home crown is gone but far crowns remain: the oldest of them becomes the home crown. */
    onHomeLost(player, world, out = null) {
        const st = HighCrowns.state(player);
        if (Throne.ruledKingdom(player, world)) return null;
        const pick = Object.values(st.crowns).map(e => ({ e, k: HighCrowns._kingdom(world, e.kingdomId) }))
            .filter(x => x.k && x.k.isAlive).sort((a, b) => _num(a.e.since) - _num(b.e.since))[0];
        if (!pick) return null;
        const ts = Throne.state(player);
        delete st.crowns[pick.k.id];
        ts.ruling = { kingdomId: pick.k.id, since: _num(pick.e.since), founded: pick.e.how === 'founded', policies: { ...pick.e.policies }, levyTotal: 0, peaceCooldown: {} };
        player.allegiance = pick.k.id;
        player.kingdomTitle = 'king';
        Throne._styleRuler(player, pick.k, Throne._playerRuler(player, pick.k));
        const text = `👑 ${Names.realm(pick.k.name, true)} is now the seat of ${player.house ? player.house.name : 'the House'}; ${pick.e.viceroy ? `${pick.e.viceroy.name} gives back the seals` : 'its court is yours to keep in person'}.`;
        HighCrowns._log(player, world, text, ['throne']);
        if (out) out.notices.push({ icon: '👑', title: 'A New Seat', text, type: 'info' });
        Throne.syncCrowns(player, world);
        return pick.k;
    },

    // ──────────── THE HIGH CROWN ────────────

    /** How the high crown would be styled now: { title, realmWord, proper, name }. */
    styleFor(player, world, customName = null) {
        const home = Throne.ruledKingdom(player, world);
        const culture = home ? home.culture : (player && player.culture);
        const t = HighCrowns.titleFor(culture, player && player.gender);
        const proper = home ? Kingdom.parseRealmName(home.name).proper : 'the Realms';
        const custom = String(customName || '').trim().replace(/\s+/g, ' ');
        return { title: t.title, realmWord: t.realmWord, proper, name: custom.length >= 3 ? custom.slice(0, 48) : `${t.realmWord} of ${proper}` };
    },

    /** Could the player proclaim a high crown now? { ok, reasons[], crowns, prestige, towns, cost, feast } */
    proclaimStatus(player, world) {
        const P = HighCrowns.config().proclaim;
        const crowns = HighCrowns.crownsOf(player, world);
        const towns = crowns.reduce((s, c) => s + c.towns, 0);
        const prestige = House.getPrestige(player);
        const home = Throne.ruledKingdom(player, world);
        const feast = _num(P.feast);
        const fromTreasury = Math.round(feast * _num(P.treasuryShare, 0.5));
        const fromPurse = feast - fromTreasury;
        const reasons = [];
        if (HighCrowns.isEmperor(player)) reasons.push('You are already crowned above kings.');
        if (crowns.length < _num(P.minCrowns, 2)) reasons.push(`Wear ${_num(P.minCrowns, 2)} crowns (you wear ${crowns.length}).`);
        if (prestige < _num(P.minPrestige)) reasons.push(`Reach ${_num(P.minPrestige)} Prestige (you have ${prestige}).`);
        if (towns < _num(P.minSettlements)) reasons.push(`Rule ${_num(P.minSettlements)} settlements across your crowns (you rule ${towns}).`);
        if (player.throne && player.throne.civilWar) reasons.push('You are fighting for another crown.');
        if (_num(player.gold) < fromPurse) reasons.push(`The coronation feast needs ${Utils.formatGold(fromPurse)} gold from your purse.`);
        if (home && _num(home.treasury) < fromTreasury) reasons.push(`...and ${Utils.formatGold(fromTreasury)} from the treasury of ${home.name}.`);
        return { ok: reasons.length === 0, reasons, crowns, prestige, towns, cost: _num(P.prestigeCost), feast, fromPurse, fromTreasury };
    },

    /** Proclaim the Empire / High Kingship: the coronation, the chronicle, the Annals. opts.name: a custom name. */
    proclaim(player, world, opts = {}) {
        const P = HighCrowns.config().proclaim;
        const status = HighCrowns.proclaimStatus(player, world);
        if (!status.ok) return { success: false, reason: status.reasons[0] };
        const day = _day(world);
        if (!House.spend(player.house, status.cost, 'the high crown', day)) return { success: false, reason: `Need ${status.cost} Prestige.` };
        const home = Throne.ruledKingdom(player, world);
        const capTile = home && home.capital ? world.getTile(home.capital.q, home.capital.r) : null;
        const seat = (capTile && capTile.settlement && capTile.settlement.name) || (home ? home.name : 'the capital');
        // The feast: the purse's share into the capital's purse, the treasury's into the realm's towns
        player.gold = _num(player.gold) - status.fromPurse;
        if (!(capTile && capTile.settlement && Economy.payTown(capTile.settlement, status.fromPurse))) Economy.payRealm(home, world, status.fromPurse);
        Economy.crownSpend(home, world, status.fromTreasury);
        const style = HighCrowns.styleFor(player, world, opts.name);
        const st = HighCrowns.state(player);
        st.stats.coronations++;
        const crownNames = status.crowns.map(c => c.name);
        const proseKey = `highcrown:coronation:${st.stats.coronations}:${day}`;
        st.empire = {
            name: style.name, title: style.title, realmWord: style.realmWord, proper: style.proper, culture: home ? home.culture : null,
            day, by: player.name || null, crowns: crownNames, seat, proseKey, nextYearDay: day + YEAR,
        };
        player.renown = _num(player.renown) + _num(P.renown);
        if (player.house) {
            player.house.stats = player.house.stats || {};
            player.house.stats.highCrowns = _num(player.house.stats.highCrowns) + 1;
        }
        HighCrowns.styleTitle(player, world);
        const fallback = HighCrowns._text('coronation', {
            seat, crowns: crownNames.join(', '), name: player.name || 'the ruler', title: style.title,
            realmWord: style.realmWord, proper: style.proper, crownCount: crownNames.length,
        }, '{name} is crowned {title}.');
        const text = LlmProse.write(world, {
            kind: 'annals', key: proseKey, fallback,
            facts: { event: 'coronation of a high king', ruler: player.name || null, house: player.house ? player.house.name : null, title: style.title, realm: style.name, seat, crowns: crownNames, day },
        }) || fallback;
        HighCrowns._log(player, world, `👑 ${fallback}`, ['throne', 'capstone']);
        Throne._log(player, world, `👑 ${player.name || 'The ruler'} is crowned ${style.title} of the ${style.name}.`);
        if (Array.isArray(world.events)) world.events.push({ text: `👑 ${player.name || 'A ruler'} is crowned ${style.title}: the ${style.name} is proclaimed.`, type: 'political', category: 'political', kingdom: home ? home.id : null });
        HighCrowns._refreshMods(player, world);
        return { success: true, empire: st.empire, message: `${text} +${_num(P.renown)} renown.` };
    },

    /** The emperor's style on the player (Throne._tickRuling restyles daily, then calls this). */
    styleTitle(player, world) {
        const e = HighCrowns.empire(player);
        if (!e) return;
        const gender = player.gender === 'female' ? 'female' : 'male';
        const t = HighCrowns.titleFor(e.culture, gender);
        e.title = t.title;
        player.rulerTitle = t.title;
        player.title = `${t.title} of the ${e.name}`;
    },

    // ──────────── SUCCESSION ────────────

    setPlan(player, plan) {
        if (plan !== 'whole' && plan !== 'partition') return { success: false, reason: 'No such plan.' };
        HighCrowns.state(player).plan = plan;
        return { success: true, message: plan === 'partition'
            ? 'At your death each far crown will go to a grown younger child of the House, to rule as kin.'
            : 'At your death your heir will keep every crown. The younger children will get nothing of them, and the far realms will test the new ruler.' };
    },

    /** Who would take each far crown if the crowns were parted today: [{ kingdomId, name, child }]. */
    partitionPreview(player, world, heirId = null) {
        const S = HighCrowns.config().succession;
        const st = HighCrowns.state(player);
        const kids = (player.children || []).filter(c => c && c.isAlive !== false && c.id !== heirId && _num(c.age) >= _num(S.partitionMinAge, 16) && !c.crownedIn)
            .sort((a, b) => _num(b.age) - _num(a.age));
        if (!heirId && kids.length) kids.shift(); // (the eldest is the heir)
        return Object.values(st.crowns).sort((a, b) => _num(a.since) - _num(b.since))
            .map(e => ({ kingdomId: e.kingdomId, name: e.name, child: kids.shift() || null }));
    },

    /**
     * Relationships.succeedAsHeir calls this once the heir is the player and
     * the late ruler's other children are marked siblings. Partition or keep
     * whole; viceroys answer to the new ruler. → { partitioned: [{ realm, to }], kept } or null.
     */
    onSuccession(player, world, child, opts = {}) {
        const S = HighCrowns.config().succession;
        const st = player && _obj(player.highCrowns);
        if (!st || !world) return null;
        HighCrowns.state(player);
        const far = Object.values(st.crowns).sort((a, b) => _num(a.since) - _num(b.since));
        const res = { partitioned: [], kept: 0, plan: HighCrowns.plan(player) };
        if (!far.length) { st.aggrieved = []; return res; }
        const day = _day(world);
        const sibs = (player.children || []).filter(c => c && c.isSibling && c.isAlive !== false && _num(c.age) >= _num(S.partitionMinAge, 16) && !c.crownedIn)
            .sort((a, b) => _num(b.age) - _num(a.age));
        const home = Throne.ruledKingdom(player, world);
        if (res.plan === 'partition') {
            for (const entry of far) {
                const sib = sibs.shift();
                if (!sib) break;
                const k = HighCrowns._kingdom(world, entry.kingdomId);
                if (!k || !k.isAlive) continue;
                const ch = Utils.withRng(_rng(world, `partition:${k.id}:${day}`), () => Characters.generateCharacter({
                    culture: k.culture, gender: sib.gender, age: Math.max(16, _num(sib.age, 20)), name: sib.firstName,
                    dynasty: sib.dynasty || (player.house ? String(player.house.name).replace(/^House\s+/i, '') : undefined), isRuler: true,
                }));
                ch.houseKin = { childId: sib.id, house: player.house ? player.house.name : null };
                HighCrowns._handOver(player, world, entry, k, ch);
                sib.crownedIn = { kingdomId: k.id, day, hostile: false };
                if (home) {
                    if (!home.relations) home.relations = {};
                    if (!k.relations) k.relations = {};
                    home.relations[k.id] = Math.max(_num(home.relations[k.id]), _num(S.partitionRelations));
                    k.relations[home.id] = Math.max(_num(k.relations[home.id]), _num(S.partitionRelations));
                    if (!(home.allies || []).includes(k.id)) { home.allies = home.allies || []; home.allies.push(k.id); }
                    if (!(k.allies || []).includes(home.id)) { k.allies = k.allies || []; k.allies.push(home.id); }
                }
                res.partitioned.push({ realm: k.name, to: `${sib.firstName}${sib.dynasty ? ` ${sib.dynasty}` : ''}` });
            }
            st.stats.partitioned += res.partitioned.length;
            st.aggrieved = [];
            if (res.partitioned.length && player.house) {
                const e = st.empire;
                House._chronicle(player.house, world, `👑 ${HighCrowns._text('partition', { title: e ? e.title : 'ruler', list: res.partitioned.map(p => `${p.realm} to ${p.to}`).join('; ') }, 'The crowns are parted: {list}.')}`, ['throne', 'heirs']);
            }
        } else {
            st.aggrieved = sibs.map(c => ({ id: c.id, name: `${c.firstName}${c.dynasty ? ` ${c.dynasty}` : ''}`, day, crowns: far.map(e => e.name) }));
        }
        // Every crown still held tests the new ruler; viceroys weigh their new master
        for (const entry of Object.values(st.crowns)) {
            res.kept++;
            entry.separatism = _clamp(_num(entry.separatism) + _num(S.wholeSpike) + (opts.regency ? _num(S.minorSpike) : 0), 0, 100);
            if (entry.viceroy) {
                if (entry.viceroy.kind === 'kin' && child && entry.viceroy.id === child.id) entry.viceroy = null;
                else entry.viceroy.loyalty = _clamp(_num(entry.viceroy.loyalty) - _num(S.viceroyLoyaltyHit), 0, 100);
            }
            entry.lastPresentDay = Math.max(_num(entry.lastPresentDay), day - 30);
        }
        if (st.empire) {
            st.empire.by = player.name || st.empire.by;
            if (HighCrowns.crownsOf(player, world).length < _num(HighCrowns.config().proclaim.minCrowns, 2)) {
                HighCrowns._lapse(player, world, res.partitioned.length ? 'the crowns were parted among the children' : 'its crowns fell to one');
            }
        }
        return res;
    },

    // ──────────── THE LEAGUES (systems/coalitions.js) ────────────

    /** What the far crowns and the high crown add to Coalitions.power's crown part. P: coalitions' power config. */
    coalitionPower(player, world, P = {}) {
        const W = HighCrowns.config().power;
        let v = 0;
        for (const c of HighCrowns.crownsOf(player, world)) {
            if (c.home) continue;
            v += (_num(P.crown, 40) + c.towns * _num(P.crownTown, 4)) * _num(W.crownShare, 0.75);
        }
        if (HighCrowns.isEmperor(player)) v += _num(W.empire, 30);
        return _r1(v);
    },

    /** The leagues' fear of an emperor: a multiplier on their fear (1 for a king). */
    coalitionFear(player) {
        return HighCrowns.isEmperor(player) ? _num(HighCrowns.config().proclaim.coalitionFear, 1.3) : 1;
    },

    /** Extra resolve a league sworn against an emperor starts with. */
    leagueResolve(player) {
        return HighCrowns.isEmperor(player) ? _num(HighCrowns.config().proclaim.leagueResolve, 15) : 0;
    },

    /** Anything for the High Crowns panel? */
    hasBusiness(player, world) {
        const st = player && _obj(player.highCrowns);
        if (st && (Object.keys(st.crowns || {}).length || st.empire || Object.keys(st.offers || {}).length)) return true;
        return !!Throne.ruledKingdom(player, world);
    },
};
