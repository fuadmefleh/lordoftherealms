// ============================================
// META LEGACY — the Hall of Houses, kept across games
// ============================================
// Not the in-run House Chronicle (systems/legacy.js): this is a profile kept
// OUTSIDE every save, so it outlives the game it was earned in. Each House
// whose line ends (Legacy.endDynasty) is filed here: its name, years ruled,
// generations, peak titles, how it ended, its legacy score, and whether the
// run was Ironman or tainted by cheats. The Hall of Houses screen
// (components/HallOfHouses.jsx) lists them.
//
// What the Hall has earned carries into new games as modest unlocks
// (data/metaLegacy.json → unlocks): a boon picked as the "Inheritance" (an
// heirloom item, a trait), a lineage (start as a descendant of a past House,
// remembered in the new world's lore, with an old rival and, for a crowned
// line, a weak ancestral claim), and legacy starts. Applying them is
// systems/metaLegacyStart.js. Houses of tainted runs are listed but earn
// nothing.
//
// The run itself — one game, across heirs, new lives and waits — is
// world.run (saved with the world, SaveLoad.serializeWorld):
//   { id, ironman, tainted: null | { day, why }, final, startedAt, startYear,
//     origin, difficulty, seed, legacy: { lineage, boon, origin }, deathPending }
// Ironman (SaveLoad's ironman slot) makes it one save, written at each day's
// end and on quit, never loaded by hand; `final` is set when the run is over.
//
// Storage: localStorage under data storageKey, every access in try/catch; an
// in-memory fallback when there is none (tests, private windows). Tests set
// MetaLegacy.storage to their own { getItem, setItem, removeItem }.
// No randomness here.

import { DataLoader } from '../core/dataLoader.js';

const DEFAULTS = {
    storageKey: 'lord_of_realms_hall_v1',
    maxEntries: 200,
    lineage: { rivalFeud: 18, claimStrength: 8, prestige: 5, loreLines: [], rivalLines: [] },
    unlocks: [],
    origins: {},
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _str = (v, d = '') => (typeof v === 'string' ? v : d);

/** In-memory storage for when the browser's is missing or refuses. */
function _memoryStore() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
    };
}

export const MetaLegacy = {
    /** Set by tests (or a host) to a { getItem, setItem, removeItem } of their own. */
    storage: null,
    _mem: null,

    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.metaLegacy) || {};
        return {
            ...DEFAULTS,
            ...d,
            lineage: { ...DEFAULTS.lineage, ...(_obj(d.lineage) || {}) },
            unlocks: Array.isArray(d.unlocks) ? d.unlocks.filter(u => _obj(u) && u.id) : DEFAULTS.unlocks,
            origins: _obj(d.origins) || DEFAULTS.origins,
        };
    },

    _store() {
        if (MetaLegacy.storage) return MetaLegacy.storage;
        try {
            const ls = globalThis.localStorage;
            if (ls && typeof ls.getItem === 'function') return ls;
        } catch (err) { /* blocked: fall through to memory */ }
        if (!MetaLegacy._mem) MetaLegacy._mem = _memoryStore();
        return MetaLegacy._mem;
    },

    _blankProfile() {
        return { version: 1, entries: [] };
    },

    /** The profile as stored (a blank one when there is none, or it is unreadable). */
    load() {
        try {
            const raw = MetaLegacy._store().getItem(MetaLegacy.config().storageKey);
            if (!raw) return MetaLegacy._blankProfile();
            const p = JSON.parse(raw);
            if (!_obj(p) || !Array.isArray(p.entries)) return MetaLegacy._blankProfile();
            return { ...MetaLegacy._blankProfile(), ...p, entries: p.entries.filter(e => _obj(e)) };
        } catch (err) {
            return MetaLegacy._blankProfile();
        }
    },

    /** Write the profile back. Returns false when storage refused. */
    save(profile) {
        try {
            const cfg = MetaLegacy.config();
            const entries = (profile.entries || []).slice(-Math.max(1, _num(cfg.maxEntries, 200)));
            MetaLegacy._store().setItem(cfg.storageKey, JSON.stringify({ ...profile, entries }));
            return true;
        } catch (err) {
            return false;
        }
    },

    /** Every House in the Hall, the latest ended first. */
    entries(profile = null) {
        const p = profile || MetaLegacy.load();
        return p.entries.slice().sort((a, b) => _num(b.endedAt) - _num(a.endedAt));
    },

    /** Forget one House (the Hall's own delete). */
    removeEntry(id) {
        const p = MetaLegacy.load();
        const before = p.entries.length;
        p.entries = p.entries.filter(e => e.id !== id);
        if (p.entries.length !== before) MetaLegacy.save(p);
        return p.entries.length !== before;
    },

    // ── The run (world.run) ─────────────────────────────────

    /**
     * A new game's run record. opts: { ironman, origin, difficulty, seed,
     * startYear, legacy, now }. The id is unique enough to tell games apart
     * in the Hall (time and seed; not random).
     */
    newRun(opts = {}) {
        const now = _num(opts.now, Date.now());
        return {
            id: `run-${now.toString(36)}-${_str(String(opts.seed == null ? '' : opts.seed)).slice(0, 12)}`,
            ironman: !!opts.ironman,
            tainted: null,
            final: false,
            startedAt: now,
            startYear: _num(opts.startYear, 0),
            origin: _str(opts.origin, 'wanderer'),
            difficulty: _str(opts.difficulty, 'normal'),
            seed: opts.seed == null ? null : String(opts.seed),
            legacy: _obj(opts.legacy) || { lineage: null, boon: null, origin: null },
            deathPending: null,
        };
    },

    /** world.run, made for a world that has none (older saves, custom maps): never Ironman. */
    ensureRun(world, opts = {}) {
        if (!world) return null;
        if (!_obj(world.run)) world.run = MetaLegacy.newRun({ ...opts, ironman: false, startYear: _num(world.year, 0) });
        const run = world.run;
        if (run.tainted === undefined) run.tainted = null;
        if (!_obj(run.legacy)) run.legacy = { lineage: null, boon: null, origin: null };
        return run;
    },

    isIronman(world) {
        return !!(world && _obj(world.run) && world.run.ironman);
    },

    isTainted(world) {
        return !!(world && _obj(world.run) && world.run.tainted);
    },

    /** Mark the run as tainted (cheats). Returns true the first time. */
    taint(world, why = 'cheats', day = null) {
        const run = MetaLegacy.ensureRun(world);
        if (!run || run.tainted) return false;
        run.tainted = { day: _num(day, _num(world && world.day)), why: _str(why, 'cheats') };
        return true;
    },

    /** The run is over (an Ironman House's last epitaph): no more saves. */
    finalize(world) {
        const run = MetaLegacy.ensureRun(world);
        if (run) run.final = true;
        return run;
    },

    // ── Filing an ended House ───────────────────────────────

    /** Peak titles of a House: crowns worn first, then titles held, at most three. */
    _peak(reigns) {
        const crowns = [];
        const titles = [];
        for (const r of reigns || []) {
            if (r && r.crown && !crowns.includes(r.crown)) crowns.push(r.crown);
            if (r && r.title && !titles.includes(r.title)) titles.push(r.title);
        }
        return [...crowns.map(c => `Crown of ${c}`), ...titles].slice(0, 3);
    },

    /**
     * Build the Hall entry of an ended House (no state change). `epitaph` is
     * Legacy.epitaph's view; `world.run` gives the run's marks.
     */
    entryFor(player, world, epitaph, cause = null, now = Date.now()) {
        const house = player && player.house;
        if (!house || !epitaph) return null;
        const run = _obj(world && world.run) || {};
        const reigns = Array.isArray(epitaph.reigns) ? epitaph.reigns : [];
        const ended = _obj(house.ended) || {};
        const endDay = _num(ended.day, _num(world && world.day));
        const sc = _obj(player.scenario) || {};
        return {
            id: `${_str(run.id, 'run')}:${_str(house.name, 'House')}:${endDay}`,
            runId: _str(run.id, null),
            house: _str(epitaph.houseName || house.name, 'A nameless House'),
            motto: _str(epitaph.motto),
            sigilIcon: _str(epitaph.sigil && epitaph.sigil.icon, '🛡️'),
            founder: reigns.length ? _str(reigns[0].name) : '',
            lastRuler: _str(ended.lastRuler, _str(player.name)),
            generations: _num(epitaph.generations, 1),
            years: _num(epitaph.years),
            prestige: _num(epitaph.prestige),
            crowns: _num(epitaph.crowns),
            peak: MetaLegacy._peak(reigns),
            score: _num(epitaph.score),
            rank: _str(epitaph.rank && epitaph.rank.label),
            rankIcon: _str(epitaph.rank && epitaph.rank.icon),
            cause: _str(cause || ended.cause, 'unknown'),
            line: _str(epitaph.line),
            ironman: !!run.ironman,
            tainted: !!run.tainted,
            origin: _str(sc.id, _str(run.origin, 'wanderer')),
            difficulty: _str(sc.difficulty, _str(run.difficulty, 'normal')),
            victory: sc.victoryAchieved ? _str(sc.victoryAchieved.id || sc.victoryAchieved.name || String(sc.victoryAchieved)) : null,
            startYear: _num(run.startYear),
            endYear: _num(world && world.year),
            endDay,
            endedAt: _num(now, Date.now()),
            descendedFrom: run.legacy && run.legacy.lineage ? _str(run.legacy.lineage.house, null) : null,
            reigns: reigns.slice(0, 40).map(r => ({
                name: _str(r.name), epithet: _str(r.epithet), years: _num(r.years), score: _num(r.score),
                title: r.title || null, crown: r.crown || null, cause: r.cause || null,
            })),
            // The heirlooms the House still held at its end (systems/heirlooms.js:
            // house.heirlooms.items), so a descendant may carry one again
            heirlooms: (((house.heirlooms && house.heirlooms.items) || [])
                .filter(h => h && h.name && h.status === 'held')
                .sort((x, y) => _num(y.legend) - _num(x.legend))
                .slice(0, 5)
                .map(h => ({ name: String(h.name), kind: _str(h.kind, 'relic'), icon: _str(h.icon), legend: _num(h.legend) }))),
            // A seam for the exportable chronicle (ui/chronicleBook.js, when it exists):
            // whatever it hands MetaLegacy.attachChronicle is kept with the entry
            chronicle: null,
        };
    },

    /** File an ended House in the Hall (Legacy.endDynasty calls this). Idempotent. */
    recordHouseEnd(player, world, epitaph, cause = null, now = Date.now()) {
        if (!world || !_obj(world.run)) return null;
        const entry = MetaLegacy.entryFor(player, world, epitaph, cause, now);
        if (!entry) return null;
        const p = MetaLegacy.load();
        if (p.entries.some(e => e.id === entry.id)) return p.entries.find(e => e.id === entry.id);
        p.entries.push(entry);
        MetaLegacy.save(p);
        return entry;
    },

    /** The Hall entry filed for this run's House of that name (the latest), or null. */
    lastEntryFor(runId, houseName, profile = null) {
        return MetaLegacy.entries(profile).find(e => e.runId === runId && e.house === houseName) || null;
    },

    /** Keep a chronicle export with a filed House (the exportable chronicle's seam). */
    attachChronicle(entryId, chronicle) {
        const p = MetaLegacy.load();
        const e = p.entries.find(x => x.id === entryId);
        if (!e) return false;
        e.chronicle = chronicle == null ? null : chronicle;
        return MetaLegacy.save(p);
    },

    // ── What the Hall has earned ────────────────────────────

    /** The tallies unlocks are measured by (untainted Houses only). */
    stats(profile = null) {
        const all = (profile || MetaLegacy.load()).entries;
        const clean = all.filter(e => !e.tainted);
        return {
            housesEnded: clean.length,
            bestScore: clean.reduce((m, e) => Math.max(m, _num(e.score)), 0),
            totalYears: Math.round(clean.reduce((s, e) => s + _num(e.years), 0) * 10) / 10,
            generations: clean.reduce((m, e) => Math.max(m, _num(e.generations)), 0),
            crowns: clean.filter(e => _num(e.crowns) > 0 || (e.peak || []).some(t => /^Crown of /.test(t))).length,
            ironmanHouses: clean.filter(e => e.ironman).length,
            tainted: all.length - clean.length,
        };
    },

    _REQ_LABELS: {
        housesEnded: n => `${n} House${n === 1 ? '' : 's'} ended`,
        bestScore: n => `a House of legacy ${n}`,
        totalYears: n => `${n} years ruled in all`,
        generations: n => `a House of ${n} generations`,
        crowns: n => `${n} House${n === 1 ? '' : 's'} that wore a crown`,
        ironmanHouses: n => `${n} Ironman House${n === 1 ? '' : 's'} ended`,
    },

    /** "2 Houses ended, a House of legacy 250" */
    describeRequirement(req) {
        return Object.entries(_obj(req) || {})
            .map(([k, v]) => (MetaLegacy._REQ_LABELS[k] ? MetaLegacy._REQ_LABELS[k](v) : `${k} ${v}`))
            .join(', ');
    },

    /** Every unlock with whether it is earned. */
    unlocks(profile = null) {
        const st = MetaLegacy.stats(profile);
        return MetaLegacy.config().unlocks.map(u => {
            const req = _obj(u.requires) || {};
            const earned = Object.entries(req).every(([k, v]) => _num(st[k]) >= _num(v));
            return { ...u, earned, requirement: MetaLegacy.describeRequirement(req) };
        });
    },

    earnedIds(profile = null) {
        return new Set(MetaLegacy.unlocks(profile).filter(u => u.earned).map(u => u.id));
    },

    /** Boons one may take as the Inheritance: [{ id, name, icon, blurb, boon }]. */
    boons(profile = null) {
        return MetaLegacy.unlocks(profile).filter(u => u.earned && _obj(u.grants) && _obj(u.grants.boon))
            .map(u => ({ id: u.id, name: u.name, icon: u.icon || '', blurb: u.blurb || '', boon: u.grants.boon }));
    },

    /** Legacy starts earned: [{ id, ...origin def }]. */
    legacyOrigins(profile = null) {
        const defs = MetaLegacy.config().origins;
        const out = [];
        for (const u of MetaLegacy.unlocks(profile)) {
            const id = u.earned && _obj(u.grants) ? u.grants.origin : null;
            if (id && _obj(defs[id]) && !out.some(o => o.id === id)) out.push({ id, ...defs[id] });
        }
        return out;
    },

    /** Is a lineage (descendant start) open, and the ancestral claim with it? */
    lineageOpen(profile = null) {
        const ids = MetaLegacy.unlocks(profile).filter(u => u.earned && _obj(u.grants));
        return { lineage: ids.some(u => u.grants.lineage), claim: ids.some(u => u.grants.claim) };
    },

    /** Past Houses one may descend from (untainted), the latest first. */
    lineages(profile = null) {
        return MetaLegacy.entries(profile).filter(e => !e.tainted);
    },
};
