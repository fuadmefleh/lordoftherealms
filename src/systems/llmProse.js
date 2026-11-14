// ============================================
// LLM PROSE — the court chronicler's pen, for any system that writes prose
// ============================================
// One service between the deterministic game and the optional language model
// (systems/llmClient.js via the switch and budget of systems/npcBrain.js).
// A system hands in the FACTS of a passage and its own deterministic text;
// it gets that text back at once, and the model's retelling is written in
// the background and kept on the world:
//
//   LlmProse.write(world, { kind, key, facts, fallback, style? }) → fallback
//       Records { kind, facts, fallback, status } at world.prose[key] and, if
//       the model is on (and the kind's category is allowed), queues a
//       background generation; its text lands at world.prose[key].text.
//       Writing the same facts again is a no-op (and returns the text once
//       written); new facts under the same key replace the entry (the old
//       retelling is still shown until the new one is done).
//   LlmProse.text(world, key, fallback) → the model's text, else the stored
//       fallback, else the given fallback.
//   LlmProse.status(world, key) → null | 'off' | 'queued' | 'writing' | 'done'
//       | 'failed' | 'rejected';  LlmProse.pending(world) → entries waiting.
//
// Guarantees: never throws, never blocks the tick (generation runs off the
// tick, a few at a time under NpcBrain's concurrency cap and a per-day start
// budget), queues by priority (Annals chapters, reign summaries and epitaphs
// before letters and heralds' flavour). It draws no randomness and reads no
// globals: with the model off — always, in tests — everything is the
// deterministic fallback and no RNG stream or golden output moves.
//
// Prompts are built from the facts only, under a strict instruction never to
// invent events, names or outcomes; the reply is then checked (validate):
// any number, or any capitalised name, not found in the facts throws the
// retelling away and the fallback stands.
//
// Saved with the world (systems/saveLoad.js: serialize / restore). The run's
// history — Annals chapters, reign summaries, epitaphs, the chronicle book's
// foreword and epilogue — is kept forever; everything else is bounded
// (settings.cap entries, oldest first), and flavour never written by the
// model is not saved at all (it is the fallback, which its system keeps).

import { LlmClient } from './llmClient.js';
import { NpcBrain } from './npcBrain.js';

/** Kinds that are the run's history: kept forever, written first. */
const PERMANENT = new Set(['annals', 'chapter', 'reign', 'epitaph', 'foreword', 'epilogue', 'crisis']);

/** Queue priority by kind (higher first); unknown kinds take `default`. */
const PRIORITY = {
    annals: 100, chapter: 100, reign: 95, epitaph: 95, foreword: 80, epilogue: 80,
    crisis: 60, estate: 55, nemesis: 55, deeds: 50, town: 50, townHistory: 50, townMark: 45,
    letter: 40, familyStory: 35, skip_digest: 30, heralds: 20, default: 10, overheard: 5,
};

/** The settings category ("Scribe writes: …") each kind falls under. */
const CATEGORY = {
    annals: 'annals', chapter: 'annals', reign: 'annals', foreword: 'annals', epilogue: 'annals', deeds: 'annals',
    crisis: 'annals', town: 'annals', townHistory: 'annals', townMark: 'annals',
    epitaph: 'epitaphs', estate: 'epitaphs',
    letter: 'letters',
    heralds: 'heralds', skip_digest: 'heralds',
};

/** What each kind asks of the chronicler, and how long it may run. */
const BRIEFS = {
    annals: { ask: 'Retell this chapter of the Annals as chronicle prose in a few short paragraphs, keeping the events in their order.', maxTokens: 700, maxLen: 6000 },
    chapter: { ask: 'Retell this chapter of the Annals as chronicle prose in a few short paragraphs, keeping the events in their order.', maxTokens: 700, maxLen: 6000 },
    reign: { ask: 'Write a summary of the reign just ended in two to four sentences, as the chronicle closes it.', maxTokens: 220, maxLen: 900 },
    epitaph: { ask: 'Write the epitaph of this House in one or two grave sentences.', maxTokens: 140, maxLen: 500 },
    foreword: { ask: 'Write a short foreword to the chronicle of this House, one paragraph.', maxTokens: 260, maxLen: 1400 },
    epilogue: { ask: 'Write a short epilogue to the chronicle of this House, one paragraph.', maxTokens: 260, maxLen: 1400 },
    letter: { ask: 'Write the body of this letter in its sender\'s voice, first person, keeping every name, sum, number and request exactly as given. Write only the body, no greeting line or signature.', maxTokens: 320, maxLen: 1400 },
    heralds: { ask: 'Write the heralds\' cry for the day: one short paragraph proclaiming the news below.', maxTokens: 200, maxLen: 900 },
    deeds: { ask: 'Sum up the recorded deeds below in a short paragraph of two to four sentences.', maxTokens: 220, maxLen: 900 },
    town: { ask: 'Write a short history of this settlement from the record below, one or two paragraphs.', maxTokens: 400, maxLen: 2400 },
    townHistory: { ask: 'Write a short history of this settlement from the record below, one or two paragraphs.', maxTokens: 400, maxLen: 2400 },
    townMark: { ask: 'Write the inscription for this marker or monument in one or two sentences.', maxTokens: 120, maxLen: 500 },
    crisis: { ask: 'Write the chronicle\'s entry for this turn of the crisis in two or three sentences.', maxTokens: 200, maxLen: 900 },
    estate: { ask: 'Write how the late ruler\'s estate was settled, as the clerk of the court records it, in two to four sentences.', maxTokens: 220, maxLen: 900 },
    familyStory: { ask: 'Tell this family story as kin retell it, in two or three sentences.', maxTokens: 180, maxLen: 800 },
    overheard: { ask: 'Say this piece of town talk as one short spoken line, as a townsperson tells it to a neighbour.', maxTokens: 70, maxLen: 200 },
    default: { ask: 'Write a short passage from the facts below.', maxTokens: 260, maxLen: 1400 },
};

const SYSTEM = 'You are the court chronicler of a medieval realm. Write in a concise period voice: grave, plain and spare, with no modern idiom, no modern words, no lists, no headings and no commentary on the task. '
    + 'Use ONLY the facts given. Never invent events, people, names, places, titles, numbers, dates, causes or outcomes that are not in the facts, and never say more than the facts say. '
    + 'Keep every name and number exactly as written. If the facts are few, write little. Reply with the prose alone.';

/** Capitalised words a chronicler may use without the facts naming them. */
const ALLOWED_CAPS = new Set(['I', 'Lord', 'Lady', 'Lords', 'Ladies', 'King', 'Queen', 'Kings', 'Queens', 'Prince', 'Princess', 'Duke', 'Duchess', 'Count', 'Countess', 'Baron', 'Baroness', 'Sir', 'Dame', 'Sire', 'Majesty', 'Grace', 'Highness', 'Lordship', 'Ladyship', 'House', 'Houses', 'Crown', 'Throne', 'Realm', 'God', 'Gods', 'Heaven', 'Heavens', 'Annals', 'Chronicle', 'Church', 'Spring', 'Summer', 'Autumn', 'Winter', 'Your', 'My', 'Our', 'Hear', 'Oyez']);

/** Common words that may open a sentence (any other opener must be in the facts). */
const STARTERS = new Set(('the a an and but so yet thus then there here this that these those it its in on at by of to from for with upon after before when while as since though although until once now long few many much more most all every each no none not nor or if his her their he she they we you i our my your who whom whose what which how where whereupon wherefore therefore thereafter hence lo verily alas truly indeed so such great small little men women folk none one two three some let may might must shall should would could will was were is are be been had has have did do none nothing still even only also never ever ere amid among against through over under within without beyond about around again soon late early first last next yet ye hear know be o oyez what').split(/\s+/));

const DEFAULTS = { maxConcurrent: 2, maxPerDay: 24, cap: 300, maxFactsChars: 6000, maxTries: 2 };

const settings = { ...DEFAULTS };
const categories = { annals: true, epitaphs: true, letters: true, heralds: true, other: true };

let client = LlmClient;
let enabledFn = () => NpcBrain.isEnabled();
let queue = [];          // { world, key, entry, priority, seq }
let inFlight = 0;
let seq = 0;
const started = { day: null, n: 0 };
const running = new Set(); // Promises in flight (test helper _flush)

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => _num(world && world.day, 0);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
}

/** A plain-data copy of the facts, bounded in size (functions, cycles and huge lists dropped). */
function _cleanFacts(facts, maxChars) {
    const seen = new WeakSet();
    const walk = (v, depth) => {
        if (v == null) return v === undefined ? undefined : null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (typeof v === 'string') return v.length > 800 ? `${v.slice(0, 800)}…` : v;
        if (typeof v === 'boolean') return v;
        if (typeof v !== 'object' || depth > 4 || seen.has(v)) return undefined;
        seen.add(v);
        if (Array.isArray(v)) return v.slice(0, 60).map(x => walk(x, depth + 1)).filter(x => x !== undefined);
        const out = {};
        for (const [k, x] of Object.entries(v)) {
            const w = walk(x, depth + 1);
            if (w !== undefined) out[k] = w;
        }
        return out;
    };
    let f = walk(facts && typeof facts === 'object' ? facts : { note: facts }, 0) || {};
    let json = JSON.stringify(f);
    // Too long: shorten the longest lists until it fits
    let guard = 0;
    while (json.length > maxChars && guard++ < 20) {
        let longest = null;
        const find = (o) => {
            for (const [k, x] of Object.entries(o)) {
                if (Array.isArray(x) && x.length > 1 && (!longest || x.length > longest.o[longest.k].length)) longest = { o, k };
                else if (x && typeof x === 'object' && !Array.isArray(x)) find(x);
            }
        };
        find(f);
        if (!longest) break;
        const arr = longest.o[longest.k];
        longest.o[longest.k] = arr.slice(0, Math.max(1, Math.floor(arr.length / 2)));
        json = JSON.stringify(f);
    }
    if (json.length > maxChars) f = { note: json.slice(0, maxChars) };
    return f;
}

/** Facts as the lines of a prompt: "- label: value", lists indented. */
function _factLines(facts, indent = '') {
    const lines = [];
    const label = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
    for (const [k, v] of Object.entries(facts || {})) {
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
        if (Array.isArray(v)) {
            lines.push(`${indent}- ${label(k)}:`);
            for (const x of v) {
                if (x && typeof x === 'object') lines.push(`${indent}  - ${Object.entries(x).filter(([, y]) => y != null && y !== '').map(([a, y]) => `${label(a)}: ${typeof y === 'object' ? JSON.stringify(y) : y}`).join('; ')}`);
                else lines.push(`${indent}  - ${x}`);
            }
        } else if (typeof v === 'object') {
            lines.push(`${indent}- ${label(k)}:`);
            lines.push(..._factLines(v, `${indent}  `));
        } else {
            lines.push(`${indent}- ${label(k)}: ${v}`);
        }
    }
    return lines;
}

/** Every word and number the facts (and the plain text) hold. */
function _sourceText(facts, fallback) {
    return `${JSON.stringify(facts || {})} ${typeof fallback === 'string' ? fallback : ''}`;
}

function _ensure(world) {
    if (!world || typeof world !== 'object') return null;
    if (!world.prose || typeof world.prose !== 'object' || Array.isArray(world.prose)) world.prose = {};
    return world.prose;
}

function _isEnabled() {
    try { return !!enabledFn(); } catch { return false; }
}

function _category(kind) {
    return CATEGORY[kind] || 'other';
}

function _priority(kind, given) {
    if (typeof given === 'number' && Number.isFinite(given)) return given;
    return PRIORITY[kind] != null ? PRIORITY[kind] : PRIORITY.default;
}

function _enqueue(world, key, entry) {
    if (queue.some(q => q.world === world && q.key === key && q.entry === entry)) return;
    entry.status = 'queued';
    queue.push({ world, key, entry, priority: _num(entry.priority, PRIORITY.default), seq: ++seq });
}

/** Drop the oldest non-permanent entries over the cap. */
function _prune(prose) {
    const keys = Object.keys(prose);
    if (keys.length <= settings.cap) return;
    const flavour = keys.filter(k => prose[k] && !PERMANENT.has(prose[k].kind) && prose[k].status !== 'writing');
    const over = keys.length - settings.cap;
    if (over <= 0 || !flavour.length) return;
    flavour.sort((a, b) => (_num(prose[a].day) - _num(prose[b].day)) || (_num(prose[a].seq) - _num(prose[b].seq)));
    for (const k of flavour.slice(0, over)) delete prose[k];
}

export const LlmProse = {

    // ── The API ──────────────────────────────────────────

    /**
     * Record a passage and (model on) queue its retelling. Returns the fallback
     * at once — or, when these very facts were already written, the text.
     * opts { kind, key, facts, fallback, style?, priority? }. Never throws.
     */
    write(world, opts) {
        const fb = opts && opts.fallback !== undefined ? opts.fallback : null;
        try {
            if (!opts || opts.key == null || opts.key === '') return fb;
            const prose = _ensure(world);
            if (!prose) return fb;
            const key = String(opts.key);
            const kind = typeof opts.kind === 'string' && opts.kind ? opts.kind : 'default';
            const style = typeof opts.style === 'string' && opts.style ? opts.style.slice(0, 400) : null;
            const facts = _cleanFacts(opts.facts, settings.maxFactsChars);
            const fallback = typeof fb === 'string' ? fb : null;
            const hash = _hash(`${kind}\n${style || ''}\n${JSON.stringify(facts)}\n${fallback || ''}`);
            const old = prose[key];
            if (old && old.hash === hash) {
                if (old.text) return old.text;
                // The model was off (or failed) when last asked: ask again if it can now
                if (LlmProse.canWrite(kind) && (old.status === 'off' || (old.status === 'failed' && _num(old.tries) < settings.maxTries))) {
                    _enqueue(world, key, old);
                    LlmProse.pump();
                }
                return fb;
            }
            const entry = { kind, facts, fallback, status: 'off', hash, day: _day(world), seq: ++seq, priority: _priority(kind, opts.priority) };
            if (style) entry.style = style;
            // The retelling of the facts before is shown until the new one is written
            if (old && old.text && old.kind === kind) entry.prev = old.text;
            else if (old && old.prev && old.kind === kind) entry.prev = old.prev;
            prose[key] = entry;
            if (LlmProse.canWrite(kind)) {
                _enqueue(world, key, entry);
                LlmProse.pump();
            } else {
                delete entry.prev;
            }
            _prune(prose);
            return fb;
        } catch (e) {
            return fb;
        }
    },

    /** The model's text, else the stored fallback, else `fallback`. Never throws. */
    text(world, key, fallback = null) {
        try {
            const e = world && world.prose && key != null ? world.prose[key] : null;
            if (!e) return fallback;
            if (typeof e.text === 'string' && e.text) return e.text;
            if (e.prev && (e.status === 'queued' || e.status === 'writing')) return e.prev;
            if (typeof e.fallback === 'string' && e.fallback) return e.fallback;
            return fallback;
        } catch (e) {
            return fallback;
        }
    },

    /** Only the model's text (or null): for a "scribe's version" toggle. */
    written(world, key) {
        try {
            const e = world && world.prose && key != null ? world.prose[key] : null;
            if (!e) return null;
            if (typeof e.text === 'string' && e.text) return e.text;
            if (e.prev && (e.status === 'queued' || e.status === 'writing')) return e.prev;
            return null;
        } catch (e) {
            return null;
        }
    },

    /** null (never written) | 'off' | 'queued' | 'writing' | 'done' | 'failed' | 'rejected'. */
    status(world, key) {
        try {
            const e = world && world.prose && key != null ? world.prose[key] : null;
            return e ? (e.status || 'off') : null;
        } catch (e) {
            return null;
        }
    },

    /** How many of this world's passages wait for (or are under) the pen. */
    pending(world) {
        try {
            const prose = world && world.prose;
            if (!prose || typeof prose !== 'object') return 0;
            return Object.values(prose).filter(e => e && (e.status === 'queued' || e.status === 'writing')).length;
        } catch (e) {
            return 0;
        }
    },

    // ── Switches ─────────────────────────────────────────

    /** The model is on, and the kind's category ("Scribe writes: …") allowed. */
    canWrite(kind) {
        if (!_isEnabled()) return false;
        return LlmProse.category(_category(kind));
    },

    /**
     * Is this category on? ('annals' | 'epitaphs' | 'letters' | 'heralds' |
     * 'other'). Off when configured off here, or in the saved settings
     * NpcBrain.applyFromSettings last applied (NpcBrain.proseCategories).
     */
    category(id) {
        const saved = NpcBrain.proseCategories;
        if (saved && typeof saved === 'object' && saved[id] === false) return false;
        return categories[id] !== false;
    },

    /** The category a kind falls under. */
    categoryOf(kind) {
        return _category(kind);
    },

    /** Tune: { maxConcurrent, maxPerDay, cap, maxFactsChars, maxTries, categories: {annals,…} }. */
    configure(opts = {}) {
        for (const k of Object.keys(DEFAULTS)) {
            if (typeof opts[k] === 'number' && Number.isFinite(opts[k]) && opts[k] >= 0) settings[k] = opts[k];
        }
        if (opts.categories && typeof opts.categories === 'object') {
            for (const [k, v] of Object.entries(opts.categories)) if (k in categories) categories[k] = v !== false;
        }
        return { ...settings, categories: { ...categories } };
    },

    /** The saved game settings: llmProseAnnals / llmProseEpitaphs / llmProseLetters / llmProseHeralds (on unless false). */
    applyFromSettings(s = {}) {
        LlmProse.configure({ categories: {
            annals: s.llmProseAnnals !== false, epitaphs: s.llmProseEpitaphs !== false,
            letters: s.llmProseLetters !== false, heralds: s.llmProseHeralds !== false,
        } });
    },

    // ── The queue ────────────────────────────────────────

    /**
     * Start what the budget allows: the highest priority first, at most
     * NpcBrain's concurrency (less what NpcBrain has in flight) and
     * settings.maxPerDay starts per game day. Never throws.
     */
    pump() {
        try {
            if (!_isEnabled() || !queue.length) return;
            const brain = typeof NpcBrain.budget === 'function' ? NpcBrain.budget() : { maxConcurrent: 3, inFlight: 0 };
            const cap = Math.max(1, Math.min(settings.maxConcurrent, _num(brain.maxConcurrent, 3)));
            // Dialogue in flight goes first: it is the player waiting
            const free = () => cap - inFlight - Math.min(_num(brain.inFlight), Math.max(0, cap - 1));
            queue.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
            while (queue.length && free() > 0) {
                const item = queue[0];
                const day = _day(item.world);
                if (started.day !== day) { started.day = day; started.n = 0; }
                if (started.n >= settings.maxPerDay) return;
                queue.shift();
                const e = item.world && item.world.prose ? item.world.prose[item.key] : null;
                // Replaced, written, or switched off since it was queued
                if (e !== item.entry || e.status !== 'queued') continue;
                if (!LlmProse.canWrite(e.kind)) { e.status = 'off'; delete e.prev; continue; }
                started.n++;
                LlmProse._run(item.world, item.key, e);
            }
        } catch (e) { /* the queue waits for the next day */ }
    },

    /** The daily tick: forget other worlds' queued work, start what the budget allows. */
    processDay(world) {
        try {
            if (world) queue = queue.filter(q => q.world === world);
            LlmProse.pump();
        } catch (e) { /* nothing to do */ }
    },

    _run(world, key, entry) {
        inFlight++;
        entry.status = 'writing';
        const p = (async () => {
            try {
                const ok = await client.isAvailable();
                if (!ok) { entry.status = 'failed'; entry.tries = _num(entry.tries) + 1; return; }
                const brief = BRIEFS[entry.kind] || BRIEFS.default;
                const res = await client.chat(LlmProse.buildPrompt(entry.kind, entry.facts, entry.fallback, entry.style), { maxTokens: brief.maxTokens });
                if (!world.prose || world.prose[key] !== entry) return; // replaced meanwhile
                if (!res || !res.ok) { entry.status = 'failed'; entry.tries = _num(entry.tries) + 1; return; }
                const text = LlmProse.clean(res.text, brief.maxLen);
                if (!text || !LlmProse.validate(text, entry.facts, entry.fallback)) {
                    entry.status = 'rejected';
                    entry.tries = _num(entry.tries) + 1;
                    return;
                }
                entry.text = text;
                entry.status = 'done';
                entry.doneDay = _day(world);
                delete entry.prev;
            } catch (e) {
                entry.status = 'failed';
                entry.tries = _num(entry.tries) + 1;
            } finally {
                if (entry.status === 'writing') entry.status = 'failed';
                if (entry.status !== 'done' && entry.status !== 'queued') delete entry.prev;
                inFlight = Math.max(0, inFlight - 1);
            }
        })();
        running.add(p);
        p.finally(() => { running.delete(p); LlmProse.pump(); });
        return p;
    },

    // ── Prompts and checks ───────────────────────────────

    /** The chat messages for a passage: the system's rules, the brief, the facts (and the plain record). */
    buildPrompt(kind, facts, fallback = null, style = null) {
        const brief = BRIEFS[kind] || BRIEFS.default;
        const lines = _factLines(facts);
        let user = `${brief.ask}\n\nThe facts (use nothing else):\n${lines.length ? lines.join('\n') : '- (none)'}`;
        if (typeof fallback === 'string' && fallback.trim()) user += `\n\nThe plain record, written from the same facts:\n${fallback.trim()}`;
        if (style) user += `\n\nVoice: ${style}`;
        user += '\n\nInvent nothing. Every name and number you write must appear above.';
        return [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: NpcBrain._noThink(user) },
        ];
    },

    /** The reply as prose: reasoning, headings, quotes and preambles stripped; bounded. */
    clean(text, maxLen = 1400) {
        let s = NpcBrain._stripReasoning(typeof text === 'string' ? text : '');
        if (typeof s !== 'string') return '';
        s = s.replace(/^#+\s.*$/gm, '').replace(/\*\*?|__/g, '').replace(/^\s*(here is|here's)[^\n]*:\s*$/gim, '').trim();
        s = s.replace(/^["“]+|["”]+$/g, '').trim();
        if (s.length < 12) return '';
        if (s.length > maxLen) s = `${s.slice(0, maxLen).replace(/\s+\S*$/, '')}…`;
        return s;
    },

    /**
     * Does the retelling keep to the facts? Every number must be in the facts
     * (or the plain record), and every capitalised word — a name — too,
     * unless it is a title or a common word opening a sentence.
     */
    validate(text, facts, fallback = null) {
        if (typeof text !== 'string' || !text.trim()) return false;
        const src = _sourceText(facts, fallback);
        const srcNums = new Set(src.match(/\d+/g) || []);
        for (const n of text.match(/\d+/g) || []) if (!srcNums.has(n)) return false;
        const srcWords = new Set(src.match(/[A-Za-zÀ-ɏ']+/g) || []);
        const lower = new Set([...srcWords].map(w => w.toLowerCase()));
        const strip = (w) => w.replace(/'s$/, '').replace(/'$/, '');
        // Mid-sentence capitals are names
        const mid = /([^.!?:;"“”\s—-]\s+)([A-ZÀ-Þ][A-Za-zÀ-ɏ']+)/g;
        let m;
        while ((m = mid.exec(text))) {
            const w = strip(m[2]);
            if (!ALLOWED_CAPS.has(w) && !srcWords.has(w) && !srcWords.has(m[2])) return false;
        }
        // A sentence's first word: a common word, a title, or one the facts hold
        for (const sm of text.matchAll(/(?:^|[.!?:;"“”—]\s*)([A-ZÀ-Þ][A-Za-zÀ-ɏ']+)/g)) {
            const w = strip(sm[1]);
            if (!ALLOWED_CAPS.has(w) && !srcWords.has(w) && !lower.has(w.toLowerCase()) && !STARTERS.has(w.toLowerCase())) return false;
        }
        return true;
    },

    // ── Saving ───────────────────────────────────────────

    /**
     * The world's prose as plain data, bounded: history kept whole; flavour
     * only where the model wrote it or is about to (an unwritten flavour
     * entry is just its system's own text). Never throws.
     */
    serialize(world) {
        try {
            const prose = world && world.prose;
            if (!prose || typeof prose !== 'object') return null;
            _prune(prose);
            const out = {};
            for (const [k, e] of Object.entries(prose)) {
                if (!e || typeof e !== 'object') continue;
                const permanent = PERMANENT.has(e.kind);
                const live = e.status === 'queued' || e.status === 'writing';
                if (!permanent && !e.text && !live) continue;
                const c = { kind: e.kind, facts: e.facts, fallback: e.fallback, status: live ? 'queued' : (e.status || 'off'), hash: e.hash, day: e.day, seq: e.seq, priority: e.priority };
                if (e.text) c.text = e.text;
                if (e.prev && live) c.prev = e.prev;
                if (e.style) c.style = e.style;
                if (e.tries) c.tries = e.tries;
                if (e.doneDay != null) c.doneDay = e.doneDay;
                // The history's facts are dropped once written: the text holds them
                if (permanent && e.text && !live) delete c.facts;
                out[k] = JSON.parse(JSON.stringify(c));
            }
            return out;
        } catch (e) {
            return null;
        }
    },

    /** Put the saved prose back on the world; unfinished passages go back in the queue. Never throws. */
    restore(saved, world) {
        try {
            if (!world || typeof world !== 'object') return;
            world.prose = {};
            queue = queue.filter(q => q.world !== world);
            if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
            for (const [k, e] of Object.entries(saved)) {
                if (!e || typeof e !== 'object') continue;
                const entry = { ...e };
                if (!entry.facts) entry.facts = {};
                if (_num(entry.seq) > seq) seq = _num(entry.seq);
                world.prose[k] = entry;
            }
            for (const [k, e] of Object.entries(world.prose)) {
                if (e.status === 'queued' || e.status === 'writing') {
                    if (LlmProse.canWrite(e.kind)) _enqueue(world, k, e);
                    else { e.status = 'off'; delete e.prev; }
                }
            }
        } catch (e) {
            if (world && typeof world === 'object') world.prose = world.prose && typeof world.prose === 'object' ? world.prose : {};
        }
    },

    // ── Test helpers ─────────────────────────────────────

    /** Swap the transport (tests: a mocked { isAvailable, chat }); null restores LlmClient. */
    _setClient(c) { client = c || LlmClient; },
    /** Override the on/off switch (tests); null restores NpcBrain.isEnabled. */
    _setEnabled(fn) { enabledFn = typeof fn === 'function' ? fn : (fn == null ? () => NpcBrain.isEnabled() : () => !!fn); },
    _flush() { return Promise.allSettled([...running]); },
    _queueLength() { return queue.length; },
    _reset() {
        client = LlmClient;
        enabledFn = () => NpcBrain.isEnabled();
        queue = [];
        inFlight = 0;
        started.day = null; started.n = 0;
        running.clear();
        Object.assign(settings, DEFAULTS);
        for (const k of Object.keys(categories)) categories[k] = true;
        NpcBrain.proseCategories = null;
    },
};
