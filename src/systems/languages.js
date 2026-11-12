// ============================================
// LANGUAGES — the tongues the player and the rival Houses speak
// ============================================
//
// The realms don't share a language (world/cultures.js: ten tongues in five
// families). The player is born speaking the tongue of where they begin
// (player.nativeLanguage) and learns others:
//
//   - living among speakers: each day spent where a tongue is spoken (its
//     settlement, or its realm's land) teaches a little — slower the better
//     you get, and slower with an interpreter doing the talking;
//   - talking to people in it (a few conversations a day count);
//   - lessons from a tutor in a town (a fee, once a day), in the town's
//     tongue or one its scholars teach.
//
// Or they hire an interpreter in a town (a fee, then a daily wage; they
// leave when unpaid), who speaks the town's tongue, the player's and one or
// two of the realms about.
//
// What not understanding costs (by the level in the tongue spoken where the
// player stands): worse prices (tradeModifier, read by
// PlayerEffects.tradeBonus), speech that comes out in the foreign tongue and
// conversation choices that need words (ui/npcDialog), and a lord's
// audience that needs a common tongue or an interpreter (canAudience).
//
// The rival Houses are bound by the same: on business in a town of another
// tongue they pay an interpreter when the purse allows, else deal at worse
// terms and win less favour at court, and pick the tongue up a little each
// visit (rivalVisit, called by systems/rivalHouses.js).
//
// State: player.languages ({ lang: 0-100 }), player.nativeLanguage,
// player.translator, player.langTalk; rival.languages. Tuned in
// data/cultures.json (learning, translator, effects, rivals). No
// randomness of its own (an interpreter on offer is a hash of the town and
// the week); world and player passed in.

import { Hex } from '../core/hex.js';
import { Cultures } from '../world/cultures.js';
import { Ledger } from './ledger.js';
import { Names } from '../core/names.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day, 0);

function _hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

const NAMES = ['Alun', 'Berit', 'Casimir', 'Dara', 'Emeric', 'Fenna', 'Galen', 'Hesper', 'Iskander', 'Jorund', 'Kesia', 'Lior', 'Mirela', 'Nikos', 'Oriel', 'Petra', 'Quill', 'Rasa', 'Sefton', 'Talia'];

export const Languages = {
    cfg() {
        return Cultures.data() || {};
    },

    learning() {
        return _obj(Languages.cfg().learning) || {};
    },

    // ── The player's tongues ───────────────────────────────

    /** The tongue spoken near (q, r): the hex's own, else the nearest settlement's within `reach` */
    languageNear(world, q, r, reach = 12) {
        const here = Cultures.languageAt(world, q, r);
        if (here) return here;
        if (!world || typeof world.getSettlementViews !== 'function') return null;
        let best = null;
        for (const s of world.getSettlementViews()) {
            const d = Hex.wrappingDistance(q, r, s.q, s.r, world.width || 0);
            if (d <= reach && (!best || d < best.d)) best = { d, s };
        }
        return best ? Cultures.languageOfCulture(Cultures.cultureOf(world, best.s)) : null;
    },

    /**
     * Give a new character their mother tongue: the clan's at the Dawn of
     * Man, else the tongue spoken where they begin.
     */
    initialize(player, world, opts = {}) {
        if (!player) return null;
        let native = opts.native || null;
        if (!native && player.dawnClan && world && Array.isArray(world.units)) {
            const clan = world.units.find(u => u && u.id === player.dawnClan);
            if (clan) native = Cultures.languageOfCulture(clan.culture);
        }
        if (!native) native = Languages.languageNear(world, player.q, player.r, 40);
        if (!native) native = Object.keys(Cultures.languages())[0] || null;
        player.nativeLanguage = native;
        player.languages = native ? { [native]: 100 } : {};
        player.translator = null;
        player.langTalk = null;
        return native;
    },

    /**
     * A character from before languages: the tongue where they stand, and a
     * working knowledge of those of realms they are known to — they have got
     * by this far, and shouldn't wake up mute.
     */
    ensure(player, world) {
        if (!player || _obj(player.languages)) return player && player.languages;
        Languages.initialize(player, world);
        const L = Languages.learning();
        const legacy = _num(L.legacyFluency, 60);
        const rep = _obj(player.reputation) || {};
        for (const k of (world && world.kingdoms) || []) {
            if (!k || _num(rep[k.id]) < _num(L.legacyReputation, 10)) continue;
            const lang = Cultures.languageOfCulture(k.culture);
            if (lang && _num(player.languages[lang]) < legacy) player.languages[lang] = legacy;
        }
        return player.languages;
    },

    fluency(player, lang) {
        return _num(player && _obj(player.languages) && player.languages[lang]);
    },

    /** The interpreter's fluency in a tongue (0 when there's none, or not this tongue) */
    translatorIn(player, lang) {
        const t = player && _obj(player.translator);
        if (!t || !lang || !Array.isArray(t.tongues) || !t.tongues.includes(lang)) return 0;
        return _num(t.fluency, _num((Languages.cfg().translator || {}).fluency, 70));
    },

    /**
     * What the player makes of `lang`: { value 0-100, level, via: 'self' |
     * 'kin' | 'translator' | null }. (No tongue: everything is understood.)
     */
    comprehension(player, lang) {
        // (no tongue here, or a character from before languages until Languages.ensure gives them theirs)
        if (!lang || !_obj(player && player.languages)) return { value: 100, level: Cultures.level(100), via: null };
        const own = Languages.fluency(player, lang);
        const kin = Cultures.understands(player && player.languages, lang);
        const tr = Languages.translatorIn(player, lang);
        const value = Math.max(own, kin, tr);
        const via = value <= 0 ? null : tr >= value && tr > Math.max(own, kin) ? 'translator' : own >= kin ? 'self' : 'kin';
        return { value, level: Cultures.level(value), via };
    },

    /** The tongue spoken where the player stands, and what they make of it */
    here(player, world) {
        const lang = player ? Cultures.languageAt(world, player.q, player.r) : null;
        return { lang, ...Languages.comprehension(player, lang) };
    },

    /** The tongue of a settlement (its founding culture's) */
    settlementLanguage(world, settlement) {
        if (!settlement) return null;
        const culture = settlement.culture || (world ? Cultures.cultureOf(world, settlement) : null);
        return Cultures.languageOfCulture(culture);
    },

    // ── What it costs not to understand ────────────────────

    /** Added to the player's trade bonus in a settlement (haggling in a tongue you lack) */
    tradeModifier(player, settlement, world = null) {
        if (!player || !settlement || !_obj(player.languages)) return 0;
        const lang = Languages.settlementLanguage(world, settlement);
        if (!lang) return 0;
        const T = _obj((Languages.cfg().effects || {}).trade) || {};
        return _num(T[Languages.comprehension(player, lang).level.id], 0);
    },

    /** Can the player put their case to a lord of this realm? → { ok, reason } */
    canAudience(player, world, kingdom) {
        if (!kingdom || !_obj(player && player.languages)) return { ok: true };
        const lang = Cultures.languageOfCulture(kingdom.culture);
        const need = _num((Languages.cfg().effects || {}).audience, 50);
        const c = Languages.comprehension(player, lang);
        if (c.value >= need) return { ok: true, via: c.via };
        return {
            ok: false,
            reason: `The court of ${Names.realm(kingdom.name)} speaks ${Cultures.languageName(lang)}, and you have ${c.level.name.toLowerCase()} of it. Learn it, or hire an interpreter, before you ask for an audience.`,
        };
    },

    /** Which dialog choices a level of understanding allows (null: all of them) */
    dialogChoices(levelId) {
        const D = _obj((Languages.cfg().effects || {}).dialog) || {};
        return Array.isArray(D[levelId]) ? D[levelId] : null;
    },

    // ── Learning ───────────────────────────────────────────

    _pace(fluency) {
        const P = Array.isArray(Languages.learning().pace) ? Languages.learning().pace : [[0, 1]];
        let m = 1;
        for (const [min, mult] of P) if (fluency >= min) m = mult;
        return m;
    },

    /** Raise the player's fluency in `lang` by `amount` (paced). → { from, to, levelUp } */
    _gain(player, lang, amount) {
        if (!lang || !(amount > 0)) return null;
        if (!_obj(player.languages)) player.languages = {};
        const from = _num(player.languages[lang]);
        if (from >= 100) return null;
        const to = Math.min(100, from + amount * Languages._pace(from));
        player.languages[lang] = Math.round(to * 100) / 100;
        const a = Cultures.level(from), b = Cultures.level(to);
        return { from, to, levelUp: a.id !== b.id ? b : null };
    },

    _levelNotice(lang, lv) {
        if (!lv) return null;
        const name = Cultures.languageName(lang);
        const text = lv.id === 'broken' ? `You can get by in ${name} now: prices, directions, simple talk.`
            : lv.id === 'conversational' ? `You speak ${name} well enough to talk of anything, and to put your case at court.`
                : `You speak ${name} like one born to it.`;
        return { icon: '🗣️', title: `${name}: ${lv.name}`, text, type: 'success' };
    },

    /** A conversation in `lang` (ui/npcDialog): a little learned, a few times a day */
    noteTalk(player, world, lang) {
        if (!player || !lang || !_obj(player.languages)) return null;
        const L = Languages.learning();
        const day = _day(world);
        if (!_obj(player.langTalk) || player.langTalk.day !== day) player.langTalk = { day, n: 0 };
        if (player.langTalk.n >= _num(L.talkPerDay, 3)) return null;
        player.langTalk.n++;
        const g = Languages._gain(player, lang, _num(L.talk, 0.6));
        return g && g.levelUp ? Languages._levelNotice(lang, g.levelUp) : null;
    },

    /**
     * The day: living among speakers teaches; the interpreter is paid (or
     * leaves). → { notices }
     */
    processDay(player, world) {
        const out = { notices: [] };
        if (!player || !world) return out;
        Languages.ensure(player, world);
        const L = Languages.learning();
        const { lang } = Languages.here(player, world);
        if (lang) {
            const damp = Languages.translatorIn(player, lang) > 0 ? _num(L.translatorDamp, 0.5) : 1;
            const g = Languages._gain(player, lang, _num(L.immersion, 0.7) * damp);
            const n = g && g.levelUp ? Languages._levelNotice(lang, g.levelUp) : null;
            if (n) out.notices.push(n);
        }
        const t = _obj(player.translator);
        if (t) {
            const wage = _num(t.wage);
            if (_num(player.gold) >= wage) {
                player.gold -= wage;
                Ledger.record(player, 'languages', -wage);
                t.paid = _num(t.paid) + wage;
            } else {
                out.notices.push({ icon: '🗣️', title: 'Your interpreter leaves', text: `${t.name} goes unpaid and leaves your service.`, type: 'warning' });
                player.translator = null;
            }
        }
        return out;
    },

    /** The tongues a town's tutors teach: its own, its neighbours', and every realm's in a capital */
    teachable(world, settlement) {
        if (!settlement) return [];
        const out = new Set();
        const own = Languages.settlementLanguage(world, settlement);
        if (own) out.add(own);
        if (world && typeof world.getSettlementViews === 'function') {
            for (const s of world.getSettlementViews()) {
                if (Hex.wrappingDistance(settlement.q, settlement.r, s.q, s.r, world.width || 0) > 15) continue;
                const l = Languages.settlementLanguage(world, s);
                if (l) out.add(l);
            }
        }
        if (settlement.type === 'capital' || settlement.type === 'city') {
            for (const k of (world && world.kingdoms) || []) {
                const l = k && k.isAlive !== false ? Cultures.languageOfCulture(k.culture) : null;
                if (l) out.add(l);
            }
        }
        return [...out];
    },

    /** A lesson with a tutor in the town the player is in → { success, text } | { success: false, reason } */
    lesson(player, world, lang) {
        const t = world.getTile(player.q, player.r);
        const s = t && t.settlement;
        if (!s) return { success: false, reason: 'There are tutors only in towns and villages.' };
        if (!Languages.teachable(world, s).includes(lang)) return { success: false, reason: `No one in ${s.name} teaches ${Cultures.languageName(lang)}.` };
        const T = _obj(Languages.learning().tutor) || {};
        const cost = _num(T.cost, 18);
        const day = _day(world);
        if (!_obj(player.langTalk) || player.langTalk.day !== day) player.langTalk = { day, n: 0 };
        if (_num(player.langTalk.lessons) >= _num(T.perDay, 1)) return { success: false, reason: 'You have had your lesson for today.' };
        if (Languages.fluency(player, lang) >= 100) return { success: false, reason: `You already speak ${Cultures.languageName(lang)} like a native.` };
        if (_num(player.gold) < cost) return { success: false, reason: `A lesson costs ${cost} gold.` };
        player.gold -= cost;
        Ledger.record(player, 'languages', -cost);
        player.langTalk.lessons = _num(player.langTalk.lessons) + 1;
        const g = Languages._gain(player, lang, _num(T.gain, 5));
        const lv = g && g.levelUp ? Languages._levelNotice(lang, g.levelUp) : null;
        return {
            success: true, spent: cost,
            text: `A morning's lesson in ${Cultures.languageName(lang)}: ${Math.round(g ? g.to : Languages.fluency(player, lang))}/100.${lv ? ` ${lv.text}` : ''}`,
        };
    },

    // ── Interpreters ───────────────────────────────────────

    /**
     * The interpreter for hire in the town the player is in (the same one all
     * week): { name, tongues, hire, wage, fluency } or null.
     */
    translatorOffer(player, world) {
        const t = world && world.getTile(player.q, player.r);
        const s = t && t.settlement;
        if (!s) return null;
        const C = _obj(Languages.cfg().translator) || {};
        const own = Languages.settlementLanguage(world, s);
        const week = Math.floor(_day(world) / 7);
        const h = _hash(`${s.name}:${week}`);
        const tongues = new Set();
        if (own) tongues.add(own);
        if (player.nativeLanguage) tongues.add(player.nativeLanguage);
        const extra = Languages.teachable(world, s).filter(l => !tongues.has(l));
        const [lo, hi] = Array.isArray(C.extraTongues) ? C.extraTongues : [1, 2];
        const n = Math.min(extra.length, lo + (h % (Math.max(0, hi - lo) + 1)));
        for (let i = 0; i < n; i++) tongues.add(extra[(h >>> (i * 3)) % extra.length]);
        const big = s.type === 'capital' || s.type === 'city' ? 1.5 : 1;
        return {
            name: `${NAMES[h % NAMES.length]} the Tongue`,
            tongues: [...tongues],
            hire: Math.round(_num(C.hire, 25) * big),
            wage: Math.round(_num(C.wage, 4) * big),
            fluency: _num(C.fluency, 70),
            town: s.name,
        };
    },

    hireTranslator(player, world) {
        const offer = Languages.translatorOffer(player, world);
        if (!offer) return { success: false, reason: 'There is no one to hire here.' };
        if (_num(player.gold) < offer.hire) return { success: false, reason: `${offer.name} asks ${offer.hire} gold to take service.` };
        player.gold -= offer.hire;
        Ledger.record(player, 'languages', -offer.hire);
        player.translator = { ...offer, since: _day(world), paid: 0 };
        return { success: true, spent: offer.hire, text: `${offer.name} enters your service: ${offer.tongues.map(Cultures.languageName).join(', ')}, for ${offer.wage} gold a day.` };
    },

    dismissTranslator(player) {
        const t = _obj(player.translator);
        if (!t) return { success: false, reason: 'You have no interpreter.' };
        player.translator = null;
        return { success: true, text: `${t.name} takes their leave.` };
    },

    // ── The rival Houses ───────────────────────────────────

    /**
     * A rival House's head does business in a settlement. They speak their
     * own culture's tongue and what they've learned; in a town of another
     * tongue they pay an interpreter if they can (`fee`), else deal at
     * `badDeal` worse terms (and win half the favour at court), and learn a
     * little either way. → { understood, paid, dealFactor, favourFactor }
     */
    rivalVisit(world, rival, settlement, culture) {
        const R = _obj(Languages.cfg().rivals) || {};
        const lang = Languages.settlementLanguage(world, settlement);
        if (!rival || !lang) return { understood: true, paid: 0, dealFactor: 1, favourFactor: 1 };
        if (!_obj(rival.languages)) {
            const own = Cultures.languageOfCulture(culture);
            rival.languages = own ? { [own]: 100 } : {};
        }
        const know = Cultures.understands(rival.languages, lang);
        const out = { understood: know >= 50, paid: 0, dealFactor: 1, favourFactor: 1, lang };
        if (!out.understood) {
            const fee = _num(R.fee, 12);
            if (_num(rival.gold) >= fee * 4) {
                rival.gold -= fee;
                out.paid = fee;
                out.understood = true;
            } else {
                out.dealFactor = 1 - _num(R.badDeal, 0.12);
                out.favourFactor = 0.5;
            }
        }
        rival.languages[lang] = Math.min(100, _num(rival.languages[lang]) + _num(R.learn, 3));
        return out;
    },

    // ── For panels ─────────────────────────────────────────

    /** The player's tongues, best first: [{ id, name, fluency, level, native }] */
    known(player) {
        const out = [];
        for (const [id, v] of Object.entries(_obj(player && player.languages) || {})) {
            if (_num(v) <= 0) continue;
            out.push({ id, name: Cultures.languageName(id), fluency: Math.round(_num(v)), level: Cultures.level(v), native: id === player.nativeLanguage });
        }
        return out.sort((a, b) => b.fluency - a.fluency);
    },

    /** A short line for the hex panel: "Norrish (you: Broken)" */
    describeHere(player, world, q, r) {
        const lang = Cultures.languageAt(world, q, r);
        if (!lang) return null;
        const c = Languages.comprehension(player, lang);
        return { lang, name: Cultures.languageName(lang), level: c.level, via: c.via, value: Math.round(c.value) };
    },
};
