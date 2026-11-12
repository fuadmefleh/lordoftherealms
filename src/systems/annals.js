// ============================================
// THE ANNALS — the story of the player's life and dynasty, told as a book
// ============================================
// Not a new record: a narrator over the ones the systems already keep.
//   - house.reigns / house.currentReign (systems/legacy.js): one chapter per
//     ruler, with the reign's tallies, traits, crown, cause of death, and the
//     counters it added (rec.deedsDelta)
//   - house.history (systems/house.js _chronicle): the dated events — births,
//     marriages and widowhood, wars and sieges, crowns, offices, sagas,
//     schemes — filtered to the notable (data/annals.json tagWeights)
//   - house.wealthMarks / wealthPeak (House.markWealth): the purse's curve
//   - traits earned (since when), achievements won (on what day), sagas the
//     player took part in, pilgrimages made, the ledger's last season,
//     fame realm by realm, lords' memories (enemies and friends), children
// A stranger's new life (player/afterlife.js) carries the old line's book
// in `player.annalsPast` (Annals.archive), shown as "Before".
//
// compose(player, world) → { title, house, chapters: [{ id, title, ruler,
// epithet, generation, live, paragraphs: [{ theme, year?, text }] }], legacy,
// before: [books] }. Prose comes from the phrase lists in data/annals.json,
// picked by a hash of (event, day): no RNG is drawn, the same save always
// reads the same. Read-only except Legacy.ensure's backfill of old saves.
//
// The court scribe (optional, NpcBrain's local LLM, off by default): scribe()
// retells one chapter as prose from its template text, never throws, and
// the caller keeps the template text on any failure.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Seasons } from '../world/seasons.js';
import { NPCLords } from '../world/npcLords.js';
import { Legacy } from './legacy.js';
import { Traits } from './traits.js';
import { Fame } from './fame.js';
import { Ledger } from './ledger.js';
import { Achievements } from './achievements.js';
import { NpcBrain } from './npcBrain.js';
import { LlmProse } from './llmProse.js';

// What the daily scribe tick last saw, per world (not saved: a load just looks once more)
const _autoMemo = new WeakMap();
import { Crises } from './crises.js';
import { Climate } from '../world/climate.js';
import { Names } from '../core/names.js';

const DEFAULTS = {
    minWeight: 4, minEvents: 4, maxEventsPerChapter: 40, maxEventsPerYear: 6, quietGapYears: 3,
    enemyOpinion: -15, friendOpinion: 20, rivalFeudEnemy: 30, archiveCap: 6,
    tagWeights: {}, themes: [{ id: 'rise', tags: [] }], themeLabels: {},
    infamousTraits: ['cruel', 'greedy', 'deceitful', 'craven', 'dread_lord', 'kinslayer', 'drunkard'],
    faithTraits: ['pious', 'zealous'],
    bookTitle: ['The Annals of {house}'], beforeTitle: ['Before: the Annals of {house}'],
    chapterTitle: { crowned: ['The Reign of {name}{epithet}, {ordinal} of {house}'], lord: ['The Lordship of {name}{epithet}, {ordinal} of {house}'], life: ['The Life of {name}{epithet}, {ordinal} of {house}'] },
    chapterYears: { closed: ', years {from}–{to}', single: ', year {from}', live: ', year {from} to the present' },
    opening: { founder: ['In the {season} of the year {year}, {name} founded {house}.'], stranger: ['{name} founded {house} in the year {year}.'], heir: ['In the year {year}, {name} took up the mantle of {house}, aged {age}.'] },
    openingDisputed: ['The succession was disputed{quelled}.'], openingQuelled: ', and the dispute quelled with Prestige', openingRegency: 'A regency ruled in {poss} name at first.',
    traitsLine: ['Men came to call {obj} {traits}.'], traitEarned: ['Men began to call {name} {trait}.'],
    yearOpener: ['In the year {year}, '], seasonOpener: ['In the {season}, '], laterOpener: ['Later, in the {season}, '],
    overflow: ['And {n} lesser matters besides.'], quietYears: ['The years {from} to {to} passed quietly.'],
    achievement: ['The deed known as "{name}" belongs to this year: {desc}'],
    saga: ['The tale of {saga} came to its end: {title}.{won}'], sagaWon: ', and shared in the triumph',
    pilgrimage: ['{name} made pilgrimage to {site}{times}.'],
    summary: { death: {} },
    legacy: { title: 'Legacy' },
    scribe: {},
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);

let _cfg = null;
let _cfgSrc;

function _hash(key) {
    return Utils.hashStr(String(key)) >>> 0;
}

/** One phrase from a list (or the string itself), chosen by the key's hash. */
function _pick(list, key) {
    if (typeof list === 'string') return list;
    const a = _arr(list);
    return a.length ? a[_hash(key) % a.length] : '';
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : ''));
}

function _cap(s) {
    s = String(s || '');
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Lower the first letter of a chronicle line that follows an opener ("The war…" → "the war…"). */
function _lcFirst(text) {
    return /^(The|A|An|After|Its|His|Her|Their|Generation|Men|It|By|So|Of|Come)\b/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/**
 * A chronicle line as the book tells it: no glyphs, no game tallies in
 * brackets ("(now 15)", "(−1 Prestige)"), and no sentence spoken to "you"
 * (a few systems' lines address the player). '' when nothing is left.
 */
function _clean(text) {
    let t = String(text || '')
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
        .replace(/\(s\)/g, 's')
        .replace(/\s*\([^)]*\d[^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const parts = t.split(/(?<=[.!?])\s+/).filter(x => x && !/\b(you|your|yours|yourself)\b/i.test(x));
    t = parts.join(' ').replace(/^[^\p{L}\p{N}"'“]+/u, '').trim();
    return t;
}

let _ptSrc;
let _ptRules = null;

/**
 * A chronicle line put into the past tense (data/annals.json → pastTense):
 * the phrases, then the whole lowercase words, outside quoted text only.
 */
function _pastTense(text, pt) {
    if (!text || !_obj(pt)) return text;
    if (_ptSrc !== pt) {
        _ptSrc = pt;
        const words = _obj(pt.words) || {};
        const keys = Object.keys(words).filter(k => !k.startsWith('_')).sort((a, b) => b.length - a.length);
        _ptRules = {
            phrases: _arr(pt.phrases).filter(p => Array.isArray(p) && p.length >= 2).map(([re, to]) => [new RegExp(re, 'g'), String(to)]),
            words: keys.length ? new RegExp(`\\b(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g') : null,
            map: words,
        };
    }
    const R = _ptRules;
    // Even-indexed parts are outside quotes ("…" or “…”)
    return String(text).split(/("[^"]*"|“[^”]*”)/).map((part, i) => {
        if (i % 2) return part;
        let t = part;
        for (const [re, to] of R.phrases) t = t.replace(re, (...m) => to.replace(/\$(\d)/g, (_, n) => m[+n] || ''));
        if (R.words) t = t.replace(R.words, (w) => R.map[w] || w);
        return t;
    }).join('');
}

function _sentence(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    return /[.!?…"”)]$/.test(t) ? t : `${t}.`;
}

function _s(n) { return n === 1 ? '' : 's'; }

function _ord(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
}

function _list(items) {
    const a = items.filter(Boolean);
    if (a.length <= 1) return a[0] || '';
    return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

function _fmt(n) {
    return Math.round(_num(n)).toLocaleString('en-US');
}

function _pron(gender) {
    if (gender === 'female') return { Pronoun: 'She', pronoun: 'she', poss: 'her', obj: 'her' };
    if (gender === 'male') return { Pronoun: 'He', pronoun: 'he', poss: 'his', obj: 'him' };
    return { Pronoun: 'They', pronoun: 'they', poss: 'their', obj: 'them' };
}

function _firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || 'The Founder';
}

/** The House's name for the book: an unnamed House ('Your House', no surname) reads as its founder's. */
function _houseName(house, player) {
    if (house && house.name && house.name !== 'Your House') return house.name;
    const founder = _firstName((house && house.founder) || (player && (player.firstName || player.name)));
    return founder === 'The Founder' ? 'the House' : `the House of ${founder}`;
}

export const Annals = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.annals : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const o = _obj(src) || {};
            _cfg = {
                ...DEFAULTS, ...o,
                tagWeights: { ...DEFAULTS.tagWeights, ...(_obj(o.tagWeights) || {}) },
                chapterTitle: { ...DEFAULTS.chapterTitle, ...(_obj(o.chapterTitle) || {}) },
                chapterYears: { ...DEFAULTS.chapterYears, ...(_obj(o.chapterYears) || {}) },
                opening: { ...DEFAULTS.opening, ...(_obj(o.opening) || {}) },
                summary: { ...DEFAULTS.summary, ...(_obj(o.summary) || {}), death: { ...((_obj(o.summary) || {}).death || {}) } },
                legacy: { ...DEFAULTS.legacy, ...(_obj(o.legacy) || {}) },
                scribe: { ...DEFAULTS.scribe, ...(_obj(o.scribe) || {}) },
                themes: Array.isArray(o.themes) && o.themes.length ? o.themes : DEFAULTS.themes,
            };
        }
        return _cfg;
    },

    // ── Calendar ────────────────────────────────────────

    year(world, day) {
        const base = _num(world && world.baseYear, 1);
        return base + Math.floor((Math.max(1, Math.floor(_num(day, 1))) - 1) / Seasons.DAYS_PER_YEAR);
    },

    season(day) {
        return String(Seasons.seasonOf(Math.max(1, _num(day, 1)))).toLowerCase();
    },

    // ── Events ──────────────────────────────────────────

    /** An entry's weight: the highest of its tags' (data/annals.json tagWeights). */
    weight(tags) {
        const W = Annals.config().tagWeights;
        let w = 1;
        for (const t of _arr(tags)) w = Math.max(w, _num(W[t], 1));
        return w;
    },

    /** The book's theme for a set of tags (the first theme listing one of them). */
    theme(tags) {
        const T = Annals.config().themes;
        const set = new Set(_arr(tags));
        const hit = T.find(t => _arr(t.tags).some(x => set.has(x)));
        return hit ? hit.id : (T[T.length - 1] || { id: 'rise' }).id;
    },

    /**
     * Everything dated in a reign: chronicle entries of its generation,
     * plus (by day) traits earned, achievements won, sagas taken part in and
     * pilgrimages made. Each { day, text, tags, weight, theme }.
     */
    _events(player, world, reign, ctx) {
        const C = Annals.config();
        const house = (player && player.house) || {};
        const from = _num(reign.startDay);
        const to = reign.live ? Infinity : _num(reign.endDay, Infinity);
        const inReign = (d) => Number.isFinite(d) && d >= from && d <= to;
        const name = _firstName(reign.name);
        const out = [];
        const add = (day, text, tags, battle = null) => {
            let t = _clean(text);
            for (const [re, to] of _arr(C.rewrites)) {
                const m = new RegExp(re).exec(t);
                if (m) { t = to.replace(/\$(\d)/g, (_, i) => m[+i] || '').replace('{name}', name); break; }
            }
            t = _pastTense(t, C.pastTense);
            t = _sentence(t);
            if (t) out.push({ day: _num(day), text: t, tags, weight: Annals.weight(tags), theme: Annals.theme(tags), ...(_obj(battle) ? { battle } : {}) });
        };

        // The House chronicle: this generation's entries (the accession and the
        // founding are the chapter's opening, the line's end the legacy's)
        const seen = new Set();
        for (const h of _arr(house.history)) {
            const tags = _arr(h && h.tags);
            if ((h.generation || 1) !== (reign.generation || 1)) continue;
            if (!reign.live && _num(h.day) > to) continue;
            if (tags.includes('succession') || tags.includes('founding') || tags.includes('ended')) continue;
            seen.add(h.text);
            add(h.day, h.text, tags, h.battle);
        }
        // A reign whose entries the chronicle no longer holds keeps its highlights
        for (const hl of _arr(reign.highlights)) {
            if (hl && hl.text && !seen.has(hl.text) && !/succeeds|enters history/.test(hl.text)) add(hl.day, hl.text, ['highlight']);
        }

        // Traits earned this reign (the living ruler's: when each was first said)
        if (reign.live) {
            const earned = _obj(player.traits && player.traits.earned) || {};
            for (const [id, e] of Object.entries(earned)) {
                const def = Traits.TRAITS[id];
                const since = _num(e && e.since, NaN);
                if (!def || !inReign(since) || since <= from) continue;
                add(since, _fill(_pick(C.traitEarned, `trait:${id}:${since}`), { name, trait: `the ${def.name}` }), ['trait']);
            }
        }

        // Achievements of the higher tiers, on the day they were won
        const ach = _obj(player.achievements);
        if (ach && !ctx.archived) {
            for (const id of _arr(ach.unlocked)) {
                const def = Achievements.ACHIEVEMENTS[id];
                const p = ach.progress && ach.progress[id];
                const day = _num(p && p.day, NaN);
                if (!def || !inReign(day) || !['gold', 'legendary'].includes(def.tier)) continue;
                add(day, _fill(_pick(C.achievement, `ach:${id}:${day}`), { name, deed: def.name }), ['achievement']);
            }
        }

        // Sagas the House took part in, as they ended
        for (const saga of _arr(player.sagas && player.sagas.done)) {
            const end = saga && saga.ended;
            if (!saga.involved || !end || !inReign(_num(end.day, NaN))) continue;
            add(end.day, _fill(_pick(C.saga, `saga:${saga.uid}:${end.day}`), {
                saga: saga.name, title: end.title, name, won: end.success ? C.sagaWon : '',
            }), ['saga']);
        }

        // Pilgrimages (systems/devotion.js keeps the last visit to each shrine)
        const pil = _obj(player.devotion && player.devotion.pilgrimages) || {};
        for (const [key, rec] of Object.entries(pil)) {
            if (!rec || !rec.name || !inReign(_num(rec.day, NaN))) continue;
            const n = _num(rec.n, 1);
            // (a devotion: the faith theme's 'piety' tag, data/annals.json themes)
            add(rec.day, _fill(_pick(C.pilgrimage, `pil:${key}:${rec.day}`), { name, site: rec.name, times: n > 1 ? `, for the ${_ord(n)} time` : '' }), ['faith', 'piety']);
        }
        // The same tidings told again (a claim's strength rising, a guild pressing
        // once more): the latest telling stands
        const norm = (e) => e.text.replace(/[\d,.]+/g, '#').toLowerCase();
        const last = new Map();
        out.forEach((e, i) => last.set(norm(e), i));
        return out.filter((e, i) => last.get(norm(e)) === i);
    },

    /** The notable few: by weight, topped up to minEvents, capped, then told in order. */
    _notable(events) {
        const C = Annals.config();
        const ranked = events.map((e, i) => ({ e, i })).sort((a, b) => b.e.weight - a.e.weight || a.i - b.i);
        let keep = ranked.filter(x => x.e.weight >= C.minWeight);
        if (keep.length < C.minEvents) keep = ranked.slice(0, Math.max(keep.length, Math.min(C.minEvents, ranked.length)));
        keep = keep.slice(0, C.maxEventsPerChapter);
        return keep.sort((a, b) => a.e.day - b.e.day || a.i - b.i).map(x => x.e);
    },

    // ── Chapters ────────────────────────────────────────

    /** "the Bold": the reign's epithet, else one its fame and deeds suggest. */
    epithet(reign, player = null) {
        if (reign.epithet) return reign.epithet;
        // data/annals.json epithets: { from: 'player' (the living only) | 'reign', field, min | max, epithet }
        for (const e of _arr(Annals.config().epithets)) {
            const src = e.from === 'player' ? (reign.live ? player : null) : reign;
            if (!src || !Number.isFinite(src[e.field])) continue;
            if (e.min != null && src[e.field] >= e.min) return e.epithet;
            if (e.max != null && src[e.field] <= e.max) return e.epithet;
        }
        return '';
    },

    _status(reign) {
        if (reign.crown || _num(reign.crownsWon) > 0 || _arr(reign.crownsLost).length) return 'crowned';
        if (reign.title || _num(reign.titles) > 0 || _num(reign.settlements) > 0) return 'lord';
        return 'life';
    },

    _opening(player, world, reign, ctx, P) {
        const C = Annals.config();
        const house = player.house || {};
        const vars = {
            name: reign.name, house: _houseName(house, player), season: Annals.season(reign.startDay),
            year: Annals.year(world, reign.startDay), age: _num(reign.startAge) || '?', ...P,
        };
        let kind = 'heir';
        if (ctx.index === 0) kind = player.origin && player.origin.town && !ctx.archived ? 'stranger' : 'founder';
        if (kind === 'stranger') {
            const st = (DataLoader._gamedata && DataLoader._gamedata.afterlife && DataLoader._gamedata.afterlife.stations) || {};
            const def = st[player.origin.station];
            vars.station = def && def.title ? `a ${def.title.toLowerCase()}` : 'a commoner';
            vars.town = player.origin.town;
        }
        const parts = [_fill(_pick(C.opening[kind] || C.opening.heir, `open:${reign.name}:${reign.startDay}`), vars)];
        // How the mantle passed (House.processSuccession's chronicle line)
        const succ = _arr(house.history).find(h => _arr(h.tags).includes('succession') && (h.generation || 1) === reign.generation && !_arr(h.tags).includes('ended'));
        if (succ && /disputed|dispute quelled/.test(succ.text)) {
            parts.push(_fill(_pick(C.openingDisputed, `disp:${succ.day}`), { ...vars, quelled: /quelled/.test(succ.text) ? C.openingQuelled : '' }));
        }
        if (succ && /regency/.test(succ.text)) parts.push(_fill(C.openingRegency, vars));
        // The life the heir lived before the throne (systems/heirAgency.js onSuccession)
        const record = _arr(house.history).find(h => _arr(h.tags).includes('heirRecord') && (h.generation || 1) === reign.generation);
        if (record && ctx.index > 0) parts.push(record.text);
        // (the living ruler's names won this reign are told in their year instead)
        const earned = reign.live ? (_obj(player.traits && player.traits.earned) || {}) : {};
        const told = (id) => _num(earned[id] && earned[id].since, -1) > _num(reign.startDay);
        const traits = _arr(reign.traits).filter(id => !told(id)).map(id => Traits.TRAITS[id]).filter(Boolean).map(t => `the ${t.name}`);
        if (traits.length) parts.push(_fill(_pick(C.traitsLine, `traits:${reign.name}:${reign.startDay}`), { ...vars, traits: _list(traits) }));
        return { theme: 'rise', text: parts.map(_sentence).join(' ') };
    },

    /** Year-by-year paragraphs, with the quiet stretches between them. */
    _years(world, events, reign) {
        const C = Annals.config();
        const byYear = new Map();
        for (const e of events) {
            const y = Annals.year(world, e.day);
            if (!byYear.has(y)) byYear.set(y, []);
            byYear.get(y).push(e);
        }
        const out = [];
        let prevYear = null;
        for (const [year, list] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
            if (prevYear != null && year - prevYear - 1 >= C.quietGapYears) {
                const n = year - prevYear - 1;
                out.push({ theme: 'years', quiet: true, text: _fill(_pick(C.quietYears, `quiet:${reign.name}:${prevYear}:${year}`), { from: prevYear + 1, to: year - 1, n }) });
            }
            prevYear = year;
            let told = list;
            let overflow = 0;
            if (list.length > C.maxEventsPerYear) {
                const top = new Set(list.map((e, i) => ({ e, i })).sort((a, b) => b.e.weight - a.e.weight || a.i - b.i).slice(0, C.maxEventsPerYear).map(x => x.e));
                told = list.filter(e => top.has(e));
                overflow = list.length - told.length;
            }
            const sentences = [];
            const used = new Set();
            // A phrase not yet used in this paragraph (the hash's pick, else the next free one)
            const fresh = (list, key) => {
                const a = typeof list === 'string' ? [list] : _arr(list);
                if (!a.length) return '';
                const start = _hash(key) % a.length;
                for (let j = 0; j < a.length; j++) {
                    const p = a[(start + j) % a.length];
                    if (!used.has(p)) { used.add(p); return p; }
                }
                return '';
            };
            let lastSeason = null;
            told.forEach((e, i) => {
                const season = Annals.season(e.day);
                const key = `${e.day}:${e.text}`;
                let opener;
                if (i === 0) opener = _fill(_pick(C.yearOpener, `y:${key}`), { year, season });
                else if (season !== lastSeason) opener = _fill(fresh(C.laterOpener, `l:${key}`), { year, season });
                else opener = '';
                lastSeason = season;
                // A first opener may be followed by a season phrase of its own
                if (i === 0 && !/\{season\}/.test(_pick(C.yearOpener, `y:${key}`))) {
                    const sp = _fill(_pick(C.seasonOpener, `s:${key}`), { season });
                    if (sp) opener = opener ? `${opener}${sp[0].toLowerCase()}${sp.slice(1)}` : sp;
                }
                sentences.push(opener ? `${opener}${_lcFirst(e.text)}` : e.text);
            });
            if (overflow) sentences.push(_fill(_pick(C.overflow, `o:${reign.name}:${year}`), { n: overflow }));
            // The paragraph's theme: the one its events weigh most in
            const tally = {};
            for (const e of told) tally[e.theme] = _num(tally[e.theme]) + e.weight;
            const theme = Object.entries(tally).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
            out.push({ theme: theme ? theme[0] : 'years', year, text: sentences.map(s => _cap(_sentence(s))).join(' ') });
        }
        return out;
    },

    /** The thematic close of a chapter: war, rise, wealth, family, faith, infamy, death. */
    _summaries(player, world, reign, ctx, P) {
        const C = Annals.config();
        const S = C.summary;
        const house = player.house || {};
        const name = reign.name;
        const k = `${reign.name}:${reign.startDay}`;
        const d = _obj(reign.deedsDelta) || {};
        const v = { name, ...P };
        const out = [];
        const para = (theme, parts) => {
            const text = parts.filter(Boolean).map(p => _cap(_sentence(p))).join(' ');
            if (text) out.push({ theme, text });
        };

        // War
        const battles = _num(reign.battles), settlements = _num(reign.settlements);
        const sieges = _num(d['sieges.invested']), captured = _num(d['sieges.captured']), beasts = _num(d['sagas.beastsSlain']);
        para('war', [
            battles || settlements ? _fill(_pick(S.war, `war:${k}`), {
                ...v, battles, battlesS: _s(battles),
                settlementsClause: settlements ? _fill(S.warSettlements, { settlements, settlementsS: _s(settlements) }) : '',
            }) : '',
            sieges ? _fill(S.warSieges, { sieges, siegesS: _s(sieges), captured }) : '',
            beasts ? _fill(S.warSagas, { ...v, beasts, beastsS: _s(beasts) }) : '',
        ]);

        // Rise: offices, Prestige, crowns, judgement, quests
        const titles = _num(reign.titles), prestige = _num(reign.prestigeGained);
        const rulings = _arr(reign.notableRulings).map(n => n.text);
        const ruled = _num(reign.petitionsRuled);
        const quests = _num(reign.quests), delves = _num(reign.delvesCleared);
        para('rise', [
            reign.crown ? _fill(_pick(S.crown, `crown:${k}`), { ...v, crown: reign.crown }) : '',
            ..._arr(reign.crownsLost).map(c => _fill(S.crownLost, { crown: c.kingdomName, how: c.how === 'abdicated' ? 'set down' : 'lost', days: c.days })),
            titles ? _fill(_pick(S.rise, `rise:${k}`), { ...v, titles, titlesS: _s(titles), prestige: Math.max(0, prestige) })
                : (prestige >= 10 ? _fill(_pick(S.risePrestige, `risep:${k}`), { ...v, prestige }) : ''),
            prestige < -10 ? _fill(_pick(S.riseLost, `fall:${k}`), { ...v, prestige: -prestige }) : '',
            ruled && rulings.length ? _fill(_pick(S.justice, `just:${k}`), { ...v, ruled, ruledS: _s(ruled), rulings: rulings.join('; ') }) : (ruled >= 5 ? _fill(S.justicePlain, { ...v, ruled, ruledS: _s(ruled) }) : ''),
            quests >= 3 ? _fill(S.quests, { quests, questsS: _s(quests), delvesClause: delves ? _fill(S.questsDelves, { delves, delvesS: _s(delves) }) : '' }) : '',
        ]);

        // Wealth: the purse's curve over the reign, and (living) the ledger's season
        const marks = _arr(house.wealthMarks).filter(m => (m.generation || 1) === reign.generation && m.day >= reign.startDay && (reign.live || m.day <= reign.endDay));
        const wealth = [];
        if (marks.length >= 2 || (marks.length && reign.live)) {
            const start = marks[0].gold;
            const end = reign.live ? Math.round(_num(player.gold)) : marks[marks.length - 1].gold;
            let peak = marks[0], low = marks[0];
            for (const m of marks) { if (m.gold > peak.gold) peak = m; if (m.gold < low.gold) low = m; }
            const hp = _obj(house.wealthPeak);
            if (hp && (hp.generation || 1) === reign.generation && hp.day >= reign.startDay && hp.gold > peak.gold) peak = hp;
            wealth.push(_fill(_pick(S.wealthRange, `wr:${k}`), { ...v, start: _fmt(start), end: _fmt(end) }));
            if (peak.gold > Math.max(start, end) * 1.2 && peak.gold >= 200) wealth.push(_fill(_pick(S.wealthPeak, `wp:${k}`), { ...v, peak: _fmt(peak.gold), year: Annals.year(world, peak.day) }));
            if (low.gold < Math.min(start, end) * 0.5 && low !== marks[0]) wealth.push(_fill(S.wealthLow, { low: _fmt(low.gold), year: Annals.year(world, low.day) }));
        }
        if (reign.live && !ctx.archived) {
            const st = Ledger.statement(player, world, 120);
            const top = st.op.income[0];
            const sink = st.op.expenses[0];
            if (top && top.amount >= 50) wealth.push(_fill(_pick(S.wealthSource, `ws:${k}`), { source: String(top.name || top.id).toLowerCase() }));
            if (sink && -sink.amount >= 100) wealth.push(_fill(S.wealthSpend, { sink: String(sink.name || sink.id).toLowerCase() }));
        }
        para('wealth', wealth);

        // Love & family: the spouse (living), the children born in the reign
        const fam = [];
        if (reign.live && ctx.spouseName) fam.push(_fill(_pick(S.familySpouse, `sp:${k}`), { ...v, spouse: ctx.spouseName }));
        const kids = _arr(player.children).filter(c => c && _num(c.birthDay, -1) >= reign.startDay && (reign.live || _num(c.birthDay) <= reign.endDay));
        const count = kids.length || _num(reign.children);
        if (count) {
            const cv = { ...v, count, childrenS: count === 1 ? '' : 'ren', wereWas: count === 1 ? 'was' : 'were' };
            const list = (reign.gender === 'female' || (reign.live && player.gender === 'female')) ? S.familyChildrenF : S.familyChildren;
            // A late ruler's children have grown into the House's own: counted, not named
            fam.push(kids.length ? _fill(_pick(list, `ch:${k}`), { ...cv, names: _list(kids.map(c => c.firstName)) }) : _fill(_pick(S.familyCount, `cc:${k}`), cv));
            const lost = kids.filter(c => c.isAlive === false).length;
            if (lost) fam.push(_fill(S.familyLost, { ...v, lost }));
        } else if (!reign.live) {
            fam.push(_fill(_pick(S.familyNone, `nc:${k}`), v));
        }
        para('family', fam);

        // Faith: devotions this reign (the counters are the player's, so the
        // last reign's are taken off), a faith founded, a pious name
        const dev = _obj(reign.devotion) || (reign.live ? _obj(player.devotion && player.devotion.stats) : null);
        const prevDev = _obj(ctx.prevReign && ctx.prevReign.devotion) || {};
        const faith = [];
        if (dev) {
            const prayers = Math.max(0, _num(dev.prayers) - _num(prevDev.prayers));
            const pilgrimages = Math.max(0, _num(dev.pilgrimages) - _num(prevDev.pilgrimages));
            const kept = Math.max(0, _num(dev.vowsKept) - _num(prevDev.vowsKept));
            const broken = Math.max(0, _num(dev.vowsBroken) - _num(prevDev.vowsBroken));
            if (prayers >= 10 || pilgrimages) faith.push(_fill(_pick(S.faithPious, `fp:${k}`), { ...v, prayers, prayersS: _s(prayers), pilgrimages, pilgrimagesS: _s(pilgrimages) }));
            if (kept || broken) faith.push(_fill(S.faithVows, { kept, keptS: _s(kept), broken }));
        }
        const religion = reign.religion || (reign.live && player.religion && player.religion.name);
        if (religion && (!ctx.prevReign || ctx.prevReign.religion !== religion)) faith.push(_fill(S.faithFounded, { ...v, religion }));
        // A pious name (faithTraits: the traits that speak of faith)
        const pious = _arr(reign.traits).filter(id => _arr(C.faithTraits).includes(id)).map(id => Traits.TRAITS[id]).filter(Boolean).map(t => `the ${t.name}`);
        if (pious.length) faith.push(_fill(S.faithName || 'Men called {obj} {traits}.', { ...v, traits: _list(pious) }));
        para('faith', faith);

        // Infamy: blood, crime, whispers, a dark name
        const kills = _num(d['gossip.kills']), witnessedN = _num(d['gossip.witnessedKills']);
        const crimes = _num(d['underworld.crimes']), caught = _num(d['underworld.caught']);
        const planted = _num(d['whispers.planted']), rivals = _num(reign.rivalsBested);
        const dark = _arr(reign.traits).filter(id => C.infamousTraits.includes(id)).map(id => Traits.TRAITS[id]).filter(Boolean).map(t => `the ${t.name}`);
        para('infamy', [
            kills ? _fill(_pick(S.infamyKills, `ik:${k}`), { ...v, kills, lives: kills === 1 ? 'life' : 'lives', witnessed: witnessedN ? _fill(S.infamyWitnessed, { witnessedN }) : '' }) : '',
            crimes ? _fill(S.infamyCrimes, { ...v, crimes, crimesS: _s(crimes), caught, caughtS: _s(caught) }) : '',
            planted ? _fill(S.infamyWhispers, { planted, plantedS: _s(planted) }) : '',
            rivals ? _fill(S.infamyRivals, { ...v, rivals, rivalsS: _s(rivals) }) : '',
            dark.length ? _fill(S.infamyTraits, { ...v, traits: _list(dark) }) : '',
        ]);

        // Death, or life going on
        const D = S.death || {};
        const epithet = Annals.epithet(reign, player);
        const dv = {
            ...v, age: _num(reign.endAge) || '?', year: Annals.year(world, reign.live ? _num(world && world.day) : reign.endDay),
            season: Annals.season(reign.live ? _num(world && world.day) : reign.endDay), years: Math.max(0, Math.round(_num(reign.years))),
            cause: reign.cause, nth: _ord(Math.max(1, Math.ceil(_num(reign.years) || 0.01))), epithet: epithet ? ` ${epithet}` : '',
        };
        dv.yearsS = _s(dv.years);
        const death = [];
        if (reign.live) death.push(_fill(_pick(D.live, `dl:${k}`), dv));
        else if (reign.abdicated && D.abdicated) {
            // Stepped down, not dead: the abdication, then the years out of the seat (systems/abdication.js)
            const ab = reign.abdicated;
            const ed = reign.elderDeath;
            const av = { ...dv, heir: ab.to || 'the heir' };
            death.push(_fill(_pick(ab.how === 'forced' && D.abdicatedForced ? D.abdicatedForced : D.abdicated, `da:${k}`), av));
            if (ed) death.push(_fill(_pick(D.elderDied, `de:${k}`), { ...av, diedYear: Annals.year(world, ed.day), diedAge: ed.age || '?', elderCause: ed.cause || 'old age' }));
            else death.push(_fill(_pick(D.elderLives, `dz:${k}`), av));
        } else death.push(_fill(_pick(reign.cause ? D.closed : D.closedNoCause, `dc:${k}`), dv));
        if (!reign.live && epithet) death.push(_fill(_pick(D.remembered, `rm:${k}`), dv));
        para('death', death);
        return out;
    },

    _chapter(player, world, reign, ctx) {
        const C = Annals.config();
        const house = player.house || {};
        const P = _pron(reign.gender || (reign.live ? player.gender : null));
        const epithet = Annals.epithet(reign, player);
        const from = Annals.year(world, reign.startDay);
        const to = Annals.year(world, reign.live ? _num(world && world.day) : reign.endDay);
        const status = Annals._status(reign);
        const title = _fill(_pick(C.chapterTitle[status] || C.chapterTitle.life, `ct:${reign.name}:${reign.startDay}`), {
            name: _firstName(reign.name), epithet: epithet ? ` ${epithet}` : '', ordinal: _ord(ctx.index + 1), house: _houseName(house, player),
        }) + _fill(reign.live ? C.chapterYears.live : (from === to ? C.chapterYears.single : C.chapterYears.closed), { from, to });
        const events = Annals._notable(Annals._events(player, world, reign, ctx));
        const paragraphs = [
            Annals._opening(player, world, reign, ctx, P),
            ...Annals._years(world, events, reign),
            ...Annals._summaries(player, world, reign, ctx, P),
        ];
        const chapter = {
            id: `g${reign.generation || 1}_${reign.startDay}`,
            title, ruler: reign.name, epithet, generation: reign.generation || 1, status,
            fromYear: from, toYear: to, live: !!reign.live, events: events.length, paragraphs,
        };
        chapter.text = paragraphs.map(p => p.text).join('\n\n');
        return chapter;
    },

    // ── Legacy ──────────────────────────────────────────

    _legacy(player, world, reigns, ctx) {
        const C = Annals.config();
        const L = C.legacy;
        const house = player.house || {};
        const hname = _houseName(house, player);
        const paragraphs = [];
        const push = (theme, parts) => {
            const text = parts.filter(Boolean).map(p => _cap(_sentence(p))).join(' ');
            if (text) paragraphs.push({ theme, text });
        };
        const score = player.house ? Legacy.score(player, world) : 0;
        const rank = Legacy.rank(score);
        const generations = reigns.length || house.generation || 1;
        const ended = _obj(house.ended);
        const best = reigns.filter(r => !r.live).slice().sort((a, b) => _num(b.score) - _num(a.score))[0] || null;
        push('legacy', [
            ended
                ? _fill(_pick(L.ended, `le:${ended.day}`), { house: hname, year: Annals.year(world, ended.day), last: ended.lastRuler, rank: ended.rank || rank.label })
                : _fill(_pick(L.headline, `lh:${hname}:${generations}`), { house: hname, generations, generationsS: _s(generations), rank: rank.label }),
            _fill(L.prestige, { prestige: _fmt(house.prestige), score: _fmt(score) }),
            best && reigns.length > 1 ? _fill(L.best, { best: best.name, bestEpithet: best.epithet ? ` ${best.epithet}` : '' }) : '',
        ]);

        // What the House holds (the living line only)
        if (!ended && !ctx.archived) {
            const held = [];
            const ruling = player.throne && player.throne.ruling;
            const crown = ruling && world && typeof world.getKingdom === 'function' ? world.getKingdom(ruling.kingdomId) : null;
            if (crown) held.push(`the crown of ${crown.name}`);
            const holdings = _arr(player.holdings && player.holdings.keys).length;
            if (holdings) held.push(`${holdings} holding${_s(holdings)}`);
            if (player.currentTitle && player.title) held.push(`the office of ${player.title}`);
            const estates = _arr(player.land && player.land.estates).length;
            if (estates) held.push(`${estates} estate${_s(estates)}`);
            push('rise', [held.length ? _fill(L.holdings, { holdings: _list(held) }) : L.holdingsNone]);
        }

        // The fortune across the generations
        const marks = _arr(house.wealthMarks);
        if (marks.length >= 2) {
            const first = marks[0].gold;
            const last = ctx.archived || ended ? marks[marks.length - 1].gold : Math.round(_num(player.gold));
            let peak = marks[0];
            for (const m of marks) if (m.gold > peak.gold) peak = m;
            const hp = _obj(house.wealthPeak);
            if (hp && hp.gold > peak.gold) peak = hp;
            const w = { first: _fmt(first), last: _fmt(last), peak: _fmt(peak.gold), peakYear: Annals.year(world, peak.day) };
            push('wealth', [last < first * 0.8 ? _fill(L.wealthFell, w) : _fill(_pick(L.wealth, `lw:${hname}`), w)]);
        }

        // Fame and enemies (the living line, as the world sees it now)
        if (!ended && !ctx.archived && world && Array.isArray(world.kingdoms)) {
            const live = world.kingdoms.filter(k => k && k.isAlive !== false);
            let good = null, bad = null;
            for (const k of live) {
                const s = Fame.stageIn(player, k.id);
                if (s.kind !== 'ill' && s.id !== 'stranger' && (!good || s.good > good.s.good)) good = { k, s };
                if (s.kind === 'ill' && (!bad || s.ill > bad.s.ill)) bad = { k, s };
            }
            const fame = [];
            if (good) fame.push(_fill(L.fame, { good: good.k.name, goodStage: good.s.label.toLowerCase() }));
            if (bad) fame.push(_fill(L.infame, { bad: bad.k.name, badStage: bad.s.label.toLowerCase() }));
            const day = _num(world.day);
            const enemies = [], friends = [];
            for (const r of Object.values(_obj(house.rivals) || {})) {
                if (r && _num(r.feud) >= C.rivalFeudEnemy && r.name) enemies.push(r.name);
            }
            for (const k of live) {
                if (!k.lord) continue;
                const op = NPCLords.memoryOpinion(k.lord, day);
                const who = `${k.lord.name || 'the lord'} of ${Names.realm(k.name)}`;
                if (op <= C.enemyOpinion) enemies.push(who);
                else if (op >= C.friendOpinion) friends.push(who);
            }
            if (enemies.length) fame.push(_fill(_pick(L.enemies, `en:${hname}:${enemies.length}`), { enemies: _list(enemies.slice(0, 6)) }));
            if (friends.length) fame.push(_fill(L.friends, { friends: _list(friends.slice(0, 4)) }));
            push('infamy', fame);
        }

        // The blood that lives on
        if (!ctx.archived) {
            const living = _arr(player.children).filter(c => c && c.isAlive !== false);
            push('family', [living.length
                ? _fill(L.children, { living: living.length, livingS: living.length === 1 ? 's' : '', names: _list(living.map(c => `${c.firstName}${c.age != null ? ` (${c.age})` : ''}`)) })
                : L.childrenNone]);
            const ach = Achievements.getProgress(player, world);
            if (ach.unlocked) push('rise', [_fill(L.achievements, { won: ach.unlocked, total: ach.total })]);
        }
        return { title: L.title || 'Legacy', score, rank: rank.label, rankIcon: rank.icon || '', paragraphs, text: paragraphs.map(p => p.text).join('\n\n') };
    },

    // ── The book ────────────────────────────────────────

    /**
     * Compose the book from the saved state. opts: { spouseName } (the UI
     * passes the living spouse's name; systems never reach for the NPC
     * registry here), { archived } (a closing copy for Annals.archive).
     */
    compose(player, world, opts = {}) {
        const C = Annals.config();
        const empty = { title: 'The Annals', house: null, chapters: [], legacy: null, before: [], day: _num(world && world.day) };
        if (!player) return empty;
        const ctx = { archived: !!opts.archived, spouseName: opts.spouseName || null, index: 0, prevReign: null };
        let reigns;
        if (player.house) {
            const d = Legacy.describe(player, world);
            reigns = d ? d.reigns : [];
        } else {
            // No House (a very old save): the player's own life, from zero
            reigns = [{ name: player.name || 'A Stranger', generation: 1, startDay: 0, startAge: _num(player.age), endAge: _num(player.age), years: 0, traits: Traits.getEarned(player), live: true, gender: player.gender }];
        }
        // Read from the deathbed (the death screen, before an heir or a new life is
        // chosen): the reign is over even though the House has not yet closed it
        if (player._isDead) {
            const dc = player.ailments && player.ailments.deathCause;
            const cause = opts.deathCause || (dc && dc.name ? dc.name.toLowerCase() : null);
            reigns = reigns.map(r => (r.live ? { ...r, live: false, endDay: _num(world && world.day), endAge: _num(player.age), cause: r.cause || cause } : r));
        }
        const house = player.house || {};
        const chapters = reigns.map((r, i) => {
            ctx.index = i;
            ctx.prevReign = i > 0 ? reigns[i - 1] : null;
            return Annals._chapter(player, world, r, ctx);
        });
        const hname = _houseName(house, player);
        return {
            title: _fill(_pick(C.bookTitle, `bt:${hname}:${house.foundedDay || 0}`), { house: hname }),
            house: { name: hname, motto: house.motto || '', sigil: house.sigil || {}, generation: house.generation || 1, foundedDay: _num(house.foundedDay), ended: !!house.ended },
            chapters,
            legacy: Annals._legacy(player, world, reigns, ctx),
            before: ctx.archived ? [] : _arr(player.annalsPast),
            // The age's crises the House lived through, each a chapter of its own (systems/crises.js)
            // ...and the climate's eras: little ice ages, droughts, warm ages (world/climate.js)
            ages: [...Crises.annalChapters(world, _num(house.foundedDay)), ...Climate.annalChapters(world, _num(house.foundedDay))]
                .sort((a, b) => _num(a.fromYear) - _num(b.fromYear)),
            day: _num(world && world.day),
        };
    },

    /**
     * Close the book of a line that ends for a new life (player/afterlife.js
     * becomeStranger): the old line's books, then this one, for the new
     * character's `annalsPast`. Plain data, saved with the player.
     */
    archive(player, world) {
        if (!player) return [];
        const book = Annals.compose(player, world, { archived: true });
        const hname = book.house ? book.house.name : 'the House';
        const closed = {
            title: _fill(_pick(Annals.config().beforeTitle, `bf:${hname}`), { house: hname }),
            house: book.house, chapters: book.chapters.map(c => ({ ...c, live: false })), legacy: book.legacy, day: book.day,
        };
        const past = _arr(player.annalsPast).concat([closed]);
        return past.slice(-Math.max(1, _num(Annals.config().archiveCap, 6)));
    },

    /** The whole book as plain text, to copy and share. */
    toText(book) {
        if (!book) return '';
        const lines = [];
        const rule = (s) => '='.repeat(Math.min(72, String(s).length));
        const tell = (b) => {
            lines.push(b.title, rule(b.title));
            if (b.house && b.house.motto) lines.push(`"${b.house.motto}"`);
            lines.push('');
            for (const c of b.chapters || []) {
                lines.push(c.title, '-'.repeat(Math.min(72, c.title.length)), '');
                for (const p of c.paragraphs || []) lines.push(p.text, '');
            }
            if (b.legacy && b.legacy.paragraphs.length) {
                lines.push(b.legacy.title, '-'.repeat(b.legacy.title.length), '');
                for (const p of b.legacy.paragraphs) lines.push(p.text, '');
            }
        };
        tell(book);
        for (const a of _arr(book.ages)) {
            lines.push('', a.title, '-'.repeat(Math.min(72, a.title.length)), '');
            for (const p of a.paragraphs || []) lines.push(p.text, '');
        }
        for (const b of _arr(book.before).slice().reverse()) { lines.push(''); tell(b); }
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    },

    // ── The court scribe ────────────────────────────────

    /** Is the scribe (the LLM, systems/npcBrain.js) switched on, and allowed the Annals? */
    scribeAvailable() {
        return NpcBrain.isEnabled() && LlmProse.category('annals');
    },

    /** The House's id in prose keys (as the chronicle book has it: house.id, else its name). */
    proseHouseId(player) {
        const h = player && player.house;
        return (h && (h.id || h.name)) || 'house';
    },

    /** world.prose key of a chapter's retelling (systems/llmProse.js; data/chronicleBook.json proseKeys). */
    chapterKey(player, chapterOrId) {
        const id = chapterOrId && typeof chapterOrId === 'object' ? chapterOrId.id : chapterOrId;
        return `annals:${Annals.proseHouseId(player)}:${id}`;
    },

    /** world.prose key of a closed reign's summary. */
    reignKey(player, chapterOrId) {
        const id = chapterOrId && typeof chapterOrId === 'object' ? chapterOrId.id : chapterOrId;
        return `reign:${Annals.proseHouseId(player)}:${id}`;
    },

    /** A chapter's facts for the scribe: its title, ruler, years and the annals' own sentences. */
    chapterFacts(chapter) {
        return {
            title: chapter.title, ruler: chapter.ruler, epithet: chapter.epithet || null,
            years: chapter.fromYear === chapter.toYear ? `${chapter.fromYear}` : `${chapter.fromYear} to ${chapter.live ? 'the present' : chapter.toYear}`,
            stillReigning: !!chapter.live,
            annals: _arr(chapter.paragraphs).map(p => p.text).filter(Boolean),
        };
    },

    /** Hand a chapter to the scribe (LlmProse); returns the text shown now. Never throws. */
    writeChapter(world, player, chapter) {
        if (!chapter || !chapter.text) return chapter ? chapter.text || '' : '';
        const S = Annals.config().scribe || {};
        return LlmProse.write(world, {
            kind: 'annals', key: Annals.chapterKey(player, chapter),
            facts: Annals.chapterFacts(chapter), fallback: chapter.text,
            style: typeof S.style === 'string' ? S.style : null,
        });
    },

    /** A closed reign's facts (Legacy's record) and its plain summary. */
    reignFacts(world, rec) {
        const facts = {
            ruler: rec.name, epithet: rec.epithet || null, generation: rec.generation || 1,
            fromYear: Annals.year(world, _num(rec.startDay)), toYear: Annals.year(world, _num(rec.endDay)),
            yearsReigned: Math.max(0, Math.round(_num(rec.years))), ageAtDeath: _num(rec.endAge) || null, cause: rec.cause || null,
            crown: rec.crown || null, office: rec.title || null,
        };
        const tallies = [['battles', 'battles won'], ['crownsWon', 'crowns won'], ['titles', 'titles gained'], ['settlements', 'settlements taken'],
            ['wars', 'wars declared'], ['children', 'children born'], ['nobleMarriages', 'noble marriages'], ['greatWorks', 'great works raised'],
            ['rebellionsCrushed', 'rebellions crushed'], ['rivalsBested', 'rivals bested'], ['petitionsRuled', 'petitions ruled'], ['prestigeGained', 'prestige gained']];
        facts.deeds = tallies.filter(([k]) => _num(rec[k]) > 0).map(([k, label]) => `${_num(rec[k])} ${label}`);
        facts.knownAs = _arr(rec.traits).map(id => Traits.TRAITS[id]).filter(Boolean).map(t => `the ${t.name}`);
        facts.highlights = _arr(rec.highlights).slice(-8).map(h => h && h.text).filter(Boolean);
        const name = rec.name || 'The ruler';
        const parts = [`${name}${rec.epithet ? ` ${rec.epithet}` : ''} ruled ${facts.yearsReigned} year${_s(facts.yearsReigned)}, from the year ${facts.fromYear} to the year ${facts.toYear}${rec.abdicated ? `, and stepped down${rec.abdicated.how === 'forced' ? ' at the demand of the court' : ''}${rec.elderDeath ? `; died of ${rec.elderDeath.cause || 'old age'} in the year ${Annals.year(world, rec.elderDeath.day)}` : ''}` : rec.cause ? `, and died of ${rec.cause}` : ''}.`];
        if (rec.crown) parts.push(`${name} wore the crown of ${rec.crown}.`);
        if (facts.deeds.length) parts.push(`The reign counted ${_list(facts.deeds.slice(0, 5))}.`);
        if (facts.knownAs.length) parts.push(`Men called ${name} ${_list(facts.knownAs)}.`);
        return { facts, fallback: parts.join(' ') };
    },

    /** File a closed reign's summary with the scribe (kept forever). Never throws. */
    writeReign(world, player, rec) {
        try {
            if (!rec || rec.startDay == null) return '';
            const id = `g${rec.generation || 1}_${rec.startDay}`;
            const { facts, fallback } = Annals.reignFacts(world, rec);
            return LlmProse.write(world, { kind: 'reign', key: Annals.reignKey(player, id), facts, fallback });
        } catch (e) {
            return '';
        }
    },

    /** world.prose key of an ended House's epitaph (data/chronicleBook.json proseKeys). */
    epitaphKey(player) {
        return `epitaph:${Annals.proseHouseId(player)}`;
    },

    /**
     * An ended House's epitaph (Legacy.epitaph's view) for the scribe — kept
     * forever. Returns the text shown now (the plain epitaph). Never throws.
     * Callers: player/afterlife.js (a new life), ui/actionMenu/heirs.js (the line let end).
     */
    writeEpitaph(world, player, epitaph) {
        try {
            if (!epitaph || !player || !player.house) return '';
            const house = player.house;
            const ended = _obj(house.ended) || {};
            const rulers = _arr(epitaph.reigns).map(r => `${r.name}${r.epithet ? ` ${r.epithet}` : ''}`).filter(Boolean);
            const years = Math.round(_num(epitaph.years));
            const gens = _num(epitaph.generations, 1);
            const crowns = _num(epitaph.crowns);
            const facts = {
                house: epitaph.houseName, motto: epitaph.motto || null, generations: gens, yearsOfTheLine: years,
                crownsWon: crowns || null, standing: epitaph.rank && epitaph.rank.label, rulers,
                rememberedFor: epitaph.best ? `${epitaph.best.name}${epitaph.best.epithet ? ` ${epitaph.best.epithet}` : ''}` : null,
                lastRuler: ended.lastRuler || null, cause: ended.cause || null,
                endedInYear: ended.day != null ? Annals.year(world, _num(ended.day)) : null,
            };
            const fallback = `Here ends the line of ${epitaph.houseName}: ${gens} generation${_s(gens)} over ${years} year${_s(years)}${crowns ? `, and ${crowns} crown${_s(crowns)} won` : ''}.${epitaph.line ? ` ${epitaph.line}` : ''}`;
            return LlmProse.write(world, { kind: 'epitaph', key: Annals.epitaphKey(player), facts, fallback });
        } catch (e) {
            return '';
        }
    },

    /**
     * The daily tick (ui/game/endDay.js). With the scribe on (and allowed the
     * Annals): every closed reign gets its summary once (from Legacy's record),
     * every closed chapter is written once, and the living chapter afresh each year — all
     * kept in world.prose and saved. Reads only; draws no randomness; never throws.
     */
    processDay(world, player) {
        try {
            if (!world || !player || !player.house || player._isDead) return;
            const house = player.house;
            const reigns = _arr(house.reigns);
            const hid = Annals.proseHouseId(player);
            const memo = _autoMemo.get(world) || {};
            const on = LlmProse.canWrite('annals');
            const year = Annals.year(world, _num(world.day));
            const changed = memo.reigns !== reigns.length || memo.hid !== hid;
            // (the model off: nothing is filed — the chapters' own death paragraphs stand)
            if (on && (changed || !memo.on)) for (const rec of reigns) Annals.writeReign(world, player, rec);
            if (on && (changed || memo.year !== year || !memo.on)) {
                const book = Annals.compose(player, world);
                for (const c of book.chapters) Annals.writeChapter(world, player, c);
            }
            _autoMemo.set(world, { reigns: reigns.length, hid, year, on });
        } catch (e) {
            /* the annals stand as written */
        } finally {
            if (world) LlmProse.processDay(world);
        }
    },

    /**
     * Have the court scribe retell a chapter. Resolves { ok, text } — the
     * scribe's prose — or { ok:false, reason }; never throws.
     */
    async scribe(chapter) {
        if (!chapter || !chapter.text) return { ok: false, reason: 'no chapter' };
        const S = Annals.config().scribe;
        try {
            return await NpcBrain.writeChronicle(chapter.text, {
                title: chapter.title, system: S.system, user: S.user,
                maxTokens: S.maxTokens, minLength: S.minLength, maxLength: S.maxLength,
            });
        } catch (e) {
            return { ok: false, reason: 'scribe failed' };
        }
    },
};
