// ============================================
// CULTURES — who speaks what, and how they build
// ============================================
//
// Ten cultures, ten tongues in five families (data/cultures.json). Every
// settlement keeps the culture it was founded with — `settlement.culture`,
// stamped when the world is made (stampSettlements) or the first time it is
// asked for — and so its people's tongue, whoever rules it later. A realm's
// court speaks its own culture's tongue and learns those of the realms it
// deals with (kingdom.tongues), and talks less easily with a court it
// shares no words with (realmDiplomacy, read by KingdomAI.considerDiplomacy).
//
// Fluency is 0-100 per language. What someone *understands* of a tongue is
// their own fluency in it, or a share (familyShare) of their best in a
// tongue of the same family. `hear` renders speech as a listener with that
// understanding hears it: the words they don't know come out in the foreign
// tongue (built from its syllables, a hash of the word, so the same word
// always sounds the same).
//
// Pure: no randomness, no globals; world and the rest passed in. The
// player's own learning, translators and the rival Houses live in
// systems/languages.js.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';

const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const FALLBACK = {
    familyShare: 0.4,
    levels: [
        { id: 'none', name: 'No words', min: 0 },
        { id: 'broken', name: 'Broken', min: 20 },
        { id: 'conversational', name: 'Conversational', min: 50 },
        { id: 'fluent', name: 'Fluent', min: 80 },
    ],
    languages: {},
    cultures: {},
};

export const Cultures = {
    data() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.cultures)) || FALLBACK;
    },

    // ── Languages ──────────────────────────────────────────

    languages() {
        return _obj(Cultures.data().languages) || {};
    },

    language(id) {
        return (id && Cultures.languages()[id]) || null;
    },

    languageName(id) {
        const l = Cultures.language(id);
        return l ? l.name : (id || 'an unknown tongue');
    },

    /** The tongue a culture speaks (null for an unknown culture) */
    languageOfCulture(culture) {
        const c = Cultures.cultureDef(culture);
        if (c && c.language && Cultures.language(c.language)) return c.language;
        return null;
    },

    family(lang) {
        const l = Cultures.language(lang);
        return l ? l.family : null;
    },

    cultureDef(culture) {
        return (culture && _obj(Cultures.data().cultures) && Cultures.data().cultures[culture]) || null;
    },

    cultureNames() {
        return Object.keys(_obj(Cultures.data().cultures) || {});
    },

    // ── Fluency ────────────────────────────────────────────

    /** The band a fluency falls in: { id, name, min } */
    level(fluency) {
        const L = Cultures.data().levels || FALLBACK.levels;
        let best = L[0];
        for (const l of L) if (_num(fluency) >= l.min) best = l;
        return best;
    },

    /**
     * What someone with these fluencies ({ lang: 0-100 }) understands of
     * `lang`: their own, or a share of their best in a kindred tongue.
     */
    understands(fluencies, lang) {
        if (!lang) return 100;
        const f = _obj(fluencies) || {};
        let best = _num(f[lang]);
        const fam = Cultures.family(lang);
        if (fam) {
            const share = _num(Cultures.data().familyShare, 0.4);
            for (const [other, v] of Object.entries(f)) {
                if (other !== lang && Cultures.family(other) === fam) best = Math.max(best, _num(v) * share);
            }
        }
        return Math.max(0, Math.min(100, best));
    },

    // ── Where a tongue is spoken ───────────────────────────

    /**
     * A settlement's culture: the one it was founded with. Stamped onto the
     * settlement the first time (its realm's culture, else the nearest
     * realm's, else the land's), so a later conqueror doesn't change it.
     */
    cultureOf(world, settlement) {
        if (!settlement) return null;
        if (settlement.culture && Cultures.cultureDef(settlement.culture)) return settlement.culture;
        let culture = null;
        const k = settlement.kingdom && world && typeof world.getKingdom === 'function' ? world.getKingdom(settlement.kingdom) : null;
        if (k && k.culture) culture = k.culture;
        if (!culture && world && Array.isArray(world.kingdoms) && Number.isFinite(settlement.q)) {
            let best = null;
            for (const kk of world.kingdoms) {
                if (!kk || !kk.capital || !kk.culture) continue;
                const d = Hex.wrappingDistance(settlement.q, settlement.r, kk.capital.q, kk.capital.r, world.width || 0);
                if (!best || d < best.d) best = { d, culture: kk.culture };
            }
            if (best) culture = best.culture;
        }
        if (!culture) culture = Cultures.cultureNames()[0] || 'Imperial';
        if (Cultures.cultureDef(culture)) settlement.culture = culture;
        return culture;
    },

    /** Give every settlement its culture (world generation; no randomness) */
    stampSettlements(world) {
        if (!world || !Array.isArray(world.tiles)) return 0;
        let n = 0;
        for (const row of world.tiles) {
            for (const t of row) {
                if (!t || !t.settlement || t.settlement.culture) continue;
                if (!Number.isFinite(t.settlement.q)) { t.settlement.q = t.q; t.settlement.r = t.r; }
                if (Cultures.cultureOf(world, t.settlement)) n++;
            }
        }
        return n;
    },

    /**
     * The tongue spoken on hex (q, r): its settlement's, else the realm's
     * whose land it is, else null (the wilds: no one to talk to).
     */
    languageAt(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (!t) return null;
        if (t.settlement) return Cultures.languageOfCulture(Cultures.cultureOf(world, t.settlement));
        if (t.kingdom && typeof world.getKingdom === 'function') {
            const k = world.getKingdom(t.kingdom);
            if (k && k.isAlive !== false) return Cultures.languageOfCulture(k.culture);
        }
        return null;
    },

    // ── Speech as heard ────────────────────────────────────

    /** A foreign word in `lang` standing for `word` (same word → same sound) */
    foreignWord(word, lang) {
        const l = Cultures.language(lang);
        const syl = l && Array.isArray(l.syllables) && l.syllables.length ? l.syllables : ['la', 'ru', 'mo', 'ten'];
        const h = _hash(`${lang}:${word.toLowerCase()}`);
        const n = Math.max(1, Math.min(4, Math.round(word.length / 3)));
        let out = '';
        for (let i = 0; i < n; i++) out += syl[(h >>> (i * 5)) % syl.length];
        if (word[0] && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) out = out[0].toUpperCase() + out.slice(1);
        return out;
    },

    /**
     * `text` as a listener who understands `share` (0-1) of `lang` hears it:
     * each word they don't know comes out in the tongue (which words a
     * listener catches is a hash of the word, so it stays put). Stage
     * directions (*...*) and numbers are left as they are.
     */
    hear(text, lang, share) {
        const s = Math.max(0, Math.min(1, _num(share)));
        if (!text || !lang || s >= 0.999) return text;
        const parts = String(text).split(/(\*[^*]*\*)/);
        return parts.map(part => {
            if (part.startsWith('*') && part.endsWith('*') && part.length > 1) return part;
            return part.replace(/[A-Za-zÀ-ɏ']+/g, (w) => {
                // short words go first: a learner catches the long ones they have studied
                const known = (_hash(`k:${w.toLowerCase()}`) % 1000) / 1000 < s;
                return known ? w : Cultures.foreignWord(w, lang);
            });
        }).join('');
    },

    // ── How a culture builds ───────────────────────────────

    /** { walls: {material: weight}, roofs: {...}, styles: {style: bias} } or null */
    palette(culture) {
        const c = Cultures.cultureDef(culture);
        return (c && _obj(c.build)) || null;
    },

    /**
     * How a culture builds its towns (data/architecture.json): { culture, plan,
     * mix, interior, streetSheet }, or null for a culture with none of its own.
     */
    architecture(culture) {
        const g = DataLoader._gamedata;
        const a = g && _obj(g.architecture);
        const c = a && _obj(a.cultures) && _obj(a.cultures[culture]);
        if (!c) return null;
        return { culture, plan: _obj(c.plan) || {}, mix: _obj(c.mix), interior: _obj(c.interior), streetSheet: a.streetSheet || null };
    },

    /** How well a composed building fits a palette (higher is better) */
    fit(palette, def) {
        if (!palette || !def) return 1;
        const w = _num((palette.walls || {})[def.wall], 0.15);
        const r = _num((palette.roofs || {})[def.roof], 0.15);
        return w * r;
    },

    // ── Names ──────────────────────────────────────────────

    /**
     * First names for a culture: `pools` (Characters.FIRST_NAMES, passed in)
     * first, then the culture data's own; null when neither has the culture.
     */
    firstNames(culture, gender = 'male', pools = null) {
        const g = gender === 'female' ? 'female' : 'male';
        const p = pools && _obj(pools[culture]);
        if (p && Array.isArray(p[g]) && p[g].length) return p[g];
        const d = _obj(Cultures.data().names);
        const own = d && _obj(d[culture]);
        return own && Array.isArray(own[g]) && own[g].length ? own[g] : null;
    },

    /** House names for a culture from the culture data, or null */
    dynastyNames(culture) {
        const d = _obj(Cultures.data().dynasties);
        return d && Array.isArray(d[culture]) && d[culture].length ? d[culture] : null;
    },

    // ── Courts ─────────────────────────────────────────────

    /** A realm court's tongues ({ lang: fluency }), its own at 100 */
    courtTongues(kingdom) {
        if (!kingdom) return {};
        if (!_obj(kingdom.tongues)) kingdom.tongues = {};
        const own = Cultures.languageOfCulture(kingdom.culture);
        if (own && _num(kingdom.tongues[own]) < 100) kingdom.tongues[own] = 100;
        return kingdom.tongues;
    },

    /**
     * How a court's envoys fare with another court for want (or not) of a
     * common tongue — a relation change for KingdomAI.considerDiplomacy — and
     * the contact teaches each court a little of the other's tongue.
     */
    realmDiplomacy(kingdom, target) {
        const R = _obj(Cultures.data().realms) || {};
        const D = _obj(R.diplomacy) || { none: -3, broken: -1, conversational: 0, fluent: 1, same: 2 };
        const a = Cultures.languageOfCulture(kingdom && kingdom.culture);
        const b = Cultures.languageOfCulture(target && target.culture);
        if (!a || !b) return 0;
        if (a === b) return _num(D.same, 2);
        const ta = Cultures.courtTongues(kingdom);
        const tb = Cultures.courtTongues(target);
        const best = Math.max(Cultures.understands(ta, b), Cultures.understands(tb, a));
        // Each contact teaches a little
        const learn = _num(R.courtLearn, 1.5);
        ta[b] = Math.min(100, _num(ta[b]) + learn);
        tb[a] = Math.min(100, _num(tb[a]) + learn);
        return _num(D[Cultures.level(best).id], 0);
    },
};
