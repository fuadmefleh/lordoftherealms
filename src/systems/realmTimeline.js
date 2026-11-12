// ============================================
// REALM TIMELINE — the world's borders and deeds, kept as the years pass
// ============================================
// The timeline viewer (ui/actionMenu/timeline.js) replays the realm: borders
// as they were in any season, the wars, crises and reigns along a strip, and
// the battles, sieges, crowns and towns as markers on the map. None of that
// can be read back later, so it is recorded as it happens, compactly enough
// to keep for centuries (a game runs 10k+ days):
//
//   base      the tile→realm grid on the day recording began (a new game, or
//             the day an old save was first loaded), run-length encoded:
//             "code*run,code*run,…" over the tiles row by row (code 0 = no
//             realm, k = st.realms[k-1]; numbers in base 36)
//   frames    every `every` days (a season): [day, changes, holdings?] —
//             changes "gap.code*run,…" (base 36, tiles in order; see
//             encodeChanges) since the frame before,
//             holdings (only when they changed) the player's holding tiles
//             "tile.tile" ('' = none). Past `frameCap` frames (or `frameBytes`
//             of changes) the two closest frames
//             are merged (their changes composed, later wins), so every frame
//             kept still reconstructs exactly and old years thin evenly
//   realms    [{ id, m: [[day, name, colour, ruler]…], f: fell day|null,
//             r: rose day|null }] — a line added only when one changes
//   towns     [[q, r, name, founded day|null, gone day|null]] — null founded:
//             standing when recording began
//   wars      [[codeA, codeB, from, to|null, victor code|null]]
//   ages      the crises: [[uid, kind, name, from, to|null, q|null, r|null]]
//   lives     the player's line: [[from, to|null, name, house]]
//   events    [[day, kind, q, r, text, weight, count]] — battles (from the
//             world.timelineFeed that world/townMarks.js noteBattle fills,
//             merged by place and season), sieges, towns taken, crises' grave
//             news, realms risen and fallen, crowns and successions. Past
//             `eventCap` the least weighty go first
//   seen      what was already filed: crisis news, sieges, the crown
//   pops      each town's population every `popEveryYears` years:
//             { "q,r": "day.pop,…" } (base 36), at most `popCap` a town (the
//             older half thinned) — the Almanac's town pages read it
//
// State: world.timeline (saved, systems/saveLoad.js); world.timelineFeed is
// a transient inbox. processDay(world, player) runs from ui/game/endDay.js,
// the playtest harness and the afterlife's world-only tick (player null).
// Reads the world, never changes it; draws no RNG. Config: data/timeline.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { Climate } from '../world/climate.js';
import { ChronicleMaps } from './chronicleMaps.js';

const DEFAULTS = {
    every: 30, frameCap: 480, frameBytes: 60000, eventCap: 360, townCap: 400, warCap: 160,
    popEveryYears: 5, popCap: 24,
    minBattleDead: 60, battleMergeDays: 120, battleMergeRange: 3,
    priority: { crisis: 9, rise: 8, fall: 8, crown: 8, siege: 6, taken: 5, battle: 3, succession: 2 },
    icons: {
        battle: '⚔️', siege: '🏰', taken: '🚩', crisis: '🌋', rise: '🌅', fall: '💀', crown: '👑', succession: '🕯️',
        founded: '🏘️', ruined: '🏚️', war: '🔥', peace: '🕊️',
    },
    text: {
        battle: '{victor} defeated {loser} {at}.',
        battleMany: '{victor} and {loser} fought {n} battles {at}.',
        siegeHolding: '{foe} laid siege to {town}.',
        siegePlayer: '{who} laid siege to {town} of {foe}.',
        taken: '{victor} took {town} from {loser}.',
        rise: '{realm} rose.',
        fall: '{realm} fell.',
        crownWon: '{who} took the crown of {realm}.',
        crownLost: '{who} no longer holds the crown of {realm}.',
        succession: '{ruler} succeeded {old} in {realm}.',
        crisisBegins: '{name} began.',
    },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _b36 = (n) => n.toString(36);
const _int = (s) => parseInt(s, 36);

let _cfgSrc;
let _cfg = null;
// Per timeline: the grid as of the last frame, the holdings string, realm codes, open towns.
// Rebuilt from the record itself after a load (never saved).
const _cache = new WeakMap();

export const RealmTimeline = {
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.timeline) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            _cfg = {
                ...DEFAULTS, ...o,
                priority: { ...DEFAULTS.priority, ...(o.priority || {}) },
                icons: { ...DEFAULTS.icons, ...(o.icons || {}) },
                text: { ...DEFAULTS.text, ...(o.text || {}) },
            };
        }
        return _cfg;
    },

    /** The timeline on the world (created empty: recording begins on its first day). */
    state(world) {
        if (!world) return null;
        let st = _obj(world.timeline);
        if (!st || st.v !== 1) st = world.timeline = { v: 1, w: 0, h: 0, start: null, next: null, base: null, frames: [], realms: [], towns: [], wars: [], ages: [], lives: [], events: [], seen: {} };
        if (!Array.isArray(world.timelineFeed)) world.timelineFeed = [];
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.timeline);
        return st && st.base ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.timeline = _obj(saved) && saved.v === 1 && saved.base ? saved : null;
        world.timelineFeed = [];
    },

    /** The calendar year of a day (as Annals.year). */
    year(world, day) {
        return ChronicleMaps.year(world, day);
    },

    // ── The daily tick ──────────────────────────────────

    /**
     * Note what changed today; every `every` days take a frame of the borders.
     * Most days a few compares. Returns { frame } when a frame was taken, else null.
     */
    processDay(world, player = null) {
        if (!world || !Array.isArray(world.tiles) || !world.width || !world.height) return null;
        const st = RealmTimeline.state(world);
        const C = RealmTimeline.config();
        const day = _num(world.day);
        if (!st.base || st.w !== world.width || st.h !== world.height) RealmTimeline._begin(world, st, day);
        const cache = RealmTimeline._cacheOf(st);

        RealmTimeline._realmsDaily(world, st, cache, day);
        RealmTimeline._warsDaily(world, st, cache, day);
        RealmTimeline._drainFeed(world, st, day);
        RealmTimeline._crisesDaily(world, st, day);
        RealmTimeline._playerDaily(world, st, player, day);
        RealmTimeline._popsDaily(world, st, day);

        let frame = null;
        if (day >= _num(st.next, day)) {
            frame = RealmTimeline._frame(world, st, cache, player, day);
            st.next = day + Math.max(1, _num(C.every, 30));
        }
        RealmTimeline._thinEvents(st);
        return frame ? { frame } : null;
    },

    /** The first day of the record: the base grid, the realms, towns, wars and rulers as they stand. */
    _begin(world, st, day) {
        st.w = world.width;
        st.h = world.height;
        st.start = day;
        st.next = day + Math.max(1, _num(RealmTimeline.config().every, 30));
        st.frames = [];
        st.realms = [];
        st.towns = [];
        st.wars = [];
        st.seen = {};
        _cache.delete(st);
        const cache = { codes: new Map(), grid: null, hold: '', n: 0, towns: new Map() };
        _cache.set(st, cache);
        for (const k of _arr(world.kingdoms)) if (k && k.isAlive !== false) RealmTimeline._code(st, cache, k, day, false);
        const grid = RealmTimeline._liveGrid(world, st, cache, true);
        cache.grid = grid;
        st.base = { d: day, g: RealmTimeline.encodeGrid(grid) };
        for (const s of RealmTimeline._views(world)) {
            cache.towns.set(`${s.q},${s.r}`, st.towns.length);
            st.towns.push([s.q, s.r, String(s.name || 'a town'), null, null]);
        }
    },

    /** The cache for a timeline, rebuilt from the record when missing or stale (a load). */
    _cacheOf(st) {
        let c = _cache.get(st);
        if (c && c.n === st.frames.length && c.grid && c.grid.length === st.w * st.h) return c;
        c = { codes: new Map(), grid: null, hold: '', n: st.frames.length, towns: new Map() };
        st.realms.forEach((r, i) => c.codes.set(r.id, i + 1));
        const grid = RealmTimeline.decodeGrid(st.base.g, st.w * st.h);
        for (const f of st.frames) {
            RealmTimeline.applyChanges(grid, f[1]);
            if (f.length > 2 && typeof f[2] === 'string') c.hold = f[2];
        }
        c.grid = grid;
        st.towns.forEach((t, i) => { if (t[4] == null) c.towns.set(`${t[0]},${t[1]}`, i); });
        _cache.set(st, c);
        return c;
    },

    /** A realm's code (1-based), registered on first sight. */
    _code(st, cache, k, day, risen = true) {
        if (!k || k.id == null) return 0;
        const have = cache.codes.get(k.id);
        if (have) return have;
        st.realms.push({ id: k.id, m: [[day, String(k.name || 'A realm'), String(k.color || '#8a7a5a'), String(k.ruler || '')]], f: k.isAlive === false ? day : null, r: risen ? day : null });
        const code = st.realms.length;
        cache.codes.set(k.id, code);
        if (risen && k.isAlive !== false) {
            const cap = _obj(k.capital);
            RealmTimeline._event(st, day, 'rise', cap ? cap.q : null, cap ? cap.r : null, _fill(RealmTimeline.config().text.rise, { realm: k.name || 'A realm' }));
        }
        return code;
    },

    /** A crisis's name as the head of a line: 'The Invasion', 'The great plague of Varn'. */
    _theName(name) {
        const n = String(name || 'crisis').trim();
        const t = /^(the|a|an)\s/i.test(n) ? n : `The ${n}`;
        return t.charAt(0).toUpperCase() + t.slice(1);
    },

    /**
     * Every popEveryYears years, each town's population: st.pops = { "q,r":
     * "day.pop,day.pop,…" } (base 36). Past popCap samples a town's older half
     * is thinned to every other one, so a long game keeps its whole span.
     */
    _popsDaily(world, st, day) {
        const C = RealmTimeline.config();
        const every = Math.max(1, _num(C.popEveryYears, 5)) * Seasons.DAYS_PER_YEAR;
        if (!_obj(st.pops)) st.pops = {};
        if (st.popNext != null && day < st.popNext) return;
        st.popNext = day + every;
        const cap = Math.max(4, _num(C.popCap, 24));
        for (const v of RealmTimeline._views(world)) {
            const t = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = (t && t.settlement) || v;
            const pop = Number(s && s.population);
            if (!Number.isFinite(pop) || pop <= 0) continue;
            const key = `${v.q},${v.r}`;
            let list = st.pops[key] ? st.pops[key].split(',') : [];
            list.push(`${_b36(Math.max(0, Math.round(day)))}.${_b36(Math.round(pop))}`);
            if (list.length > cap) {
                const half = Math.floor(list.length / 2);
                list = [...list.slice(0, half).filter((x, i) => i % 2 === 0), ...list.slice(half)];
            }
            st.pops[key] = list.join(',');
        }
    },

    /** A town's population over the years: [{ day, pop }], oldest first. */
    populationOf(st, q, r) {
        const raw = st && _obj(st.pops) && st.pops[`${q},${r}`];
        if (!raw) return [];
        return String(raw).split(',').map(x => { const [d, p] = x.split('.'); return { day: _int(d), pop: _int(p) }; }).filter(x => Number.isFinite(x.day) && Number.isFinite(x.pop));
    },

    _views(world) {
        return typeof world.getSettlementViews === 'function' ? _arr(world.getSettlementViews()).filter(s => s && Number.isFinite(s.q) && Number.isFinite(s.r)) : [];
    },

    /** Today's grid of realm codes (Int16Array, row by row). */
    _liveGrid(world, st, cache, register = false) {
        const w = st.w, h = st.h;
        const grid = new Int16Array(w * h);
        for (let r = 0; r < h; r++) {
            const row = world.tiles[r];
            if (!row) continue;
            for (let q = 0; q < w; q++) {
                const t = row[q];
                const id = t ? t.kingdom : null;
                if (id == null) continue;
                let code = cache.codes.get(id);
                if (!code && register) {
                    const k = typeof world.getKingdom === 'function' ? world.getKingdom(id) : null;
                    code = k ? RealmTimeline._code(st, cache, k, _num(world.day), st.base != null) : 0;
                }
                grid[r * w + q] = code || 0;
            }
        }
        return grid;
    },

    _event(st, day, kind, q, r, text, weight = 0) {
        st.events.push([day, kind, Number.isFinite(q) ? q : null, Number.isFinite(r) ? r : null, String(text || ''), weight, 1]);
    },

    // ── What changes from day to day ────────────────────

    _realmsDaily(world, st, cache, day) {
        const T = RealmTimeline.config().text;
        for (const k of _arr(world.kingdoms)) {
            if (!k || k.id == null) continue;
            if (!cache.codes.has(k.id) && k.isAlive === false) continue;
            const code = RealmTimeline._code(st, cache, k, day, true);
            const rec = st.realms[code - 1];
            const last = rec.m[rec.m.length - 1];
            const name = String(k.name || 'A realm'), color = String(k.color || '#8a7a5a'), ruler = String(k.ruler || '');
            if (last[1] !== name || last[2] !== color || last[3] !== ruler) {
                if (last[3] && ruler && last[3] !== ruler && k.isAlive !== false) {
                    const cap = _obj(k.capital);
                    RealmTimeline._event(st, day, 'succession', cap ? cap.q : null, cap ? cap.r : null, _fill(T.succession, { ruler, old: last[3], realm: name }));
                }
                if (last[0] === day) rec.m[rec.m.length - 1] = [day, name, color, ruler];
                else rec.m.push([day, name, color, ruler]);
            }
            if (k.isAlive === false && rec.f == null) {
                rec.f = day;
                const cap = _obj(k.capital);
                RealmTimeline._event(st, day, 'fall', cap ? cap.q : null, cap ? cap.r : null, _fill(T.fall, { realm: name }));
            } else if (k.isAlive !== false && rec.f != null) {
                rec.f = null;
                rec.r = day;
                const cap = _obj(k.capital);
                RealmTimeline._event(st, day, 'rise', cap ? cap.q : null, cap ? cap.r : null, _fill(T.rise, { realm: name }));
            }
        }
    },

    _warsDaily(world, st, cache, day) {
        const now = new Set();
        for (const k of _arr(world.kingdoms)) {
            if (!k || k.isAlive === false) continue;
            const a = cache.codes.get(k.id);
            for (const id of _arr(k.wars)) {
                const b = cache.codes.get(id);
                if (!a || !b || a === b) continue;
                now.add(a < b ? `${a}|${b}` : `${b}|${a}`);
            }
        }
        const open = new Map();
        st.wars.forEach((w, i) => { if (w[3] == null) open.set(`${w[0]}|${w[1]}`, i); });
        for (const key of now) {
            if (open.has(key)) continue;
            const [a, b] = key.split('|').map(Number);
            st.wars.push([a, b, day, null, null]);
        }
        for (const [key, i] of open) {
            if (now.has(key)) continue;
            const w = st.wars[i];
            w[3] = day;
            // The victor, if the realms' war record names one (world/kingdomAI.js)
            const ida = (st.realms[w[0] - 1] || {}).id, idb = (st.realms[w[1] - 1] || {}).id;
            const h = _arr(world.warHistory).slice(-12).reverse().find(x => x && Math.abs(_num(x.day) - day) <= 3 && ((x.a === ida && x.b === idb) || (x.a === idb && x.b === ida)));
            if (h && h.victor != null) w[4] = cache.codes.get(h.victor) || null;
        }
        // Keep the record bounded: the shortest closed wars go first
        const cap = Math.max(16, _num(RealmTimeline.config().warCap, 160));
        while (st.wars.length > cap) {
            let best = -1, len = Infinity;
            st.wars.forEach((w, i) => { if (w[3] != null && w[3] - w[2] < len) { len = w[3] - w[2]; best = i; } });
            if (best < 0) break;
            st.wars.splice(best, 1);
        }
    },

    /** Battles from world/townMarks.js (noteBattle), merged by place and season. */
    _drainFeed(world, st, day) {
        const feed = world.timelineFeed;
        if (!Array.isArray(feed) || !feed.length) return;
        const C = RealmTimeline.config();
        const list = feed.splice(0, feed.length);
        for (const b of list) {
            if (!b || !Number.isFinite(b.q) || !Number.isFinite(b.r) || _num(b.dead) < _num(C.minBattleDead, 60)) continue;
            const d = _num(b.day, day);
            let merged = false;
            for (let i = st.events.length - 1; i >= 0 && i >= st.events.length - 60; i--) {
                const e = st.events[i];
                if (d - e[0] > _num(C.battleMergeDays, 120)) break;
                if (e[1] !== 'battle' || e[2] == null) continue;
                if (Hex.wrappingOffsetDistance(e[2], e[3], b.q, b.r, world.width) > _num(C.battleMergeRange, 3)) continue;
                e[5] += Math.round(_num(b.dead));
                e[6] += 1;
                const where = ChronicleMaps.placeOf(world, e[2], e[3]);
                e[4] = _fill(C.text.battleMany, { victor: b.victor || 'A realm', loser: b.loser || 'its foe', n: e[6], at: where.at });
                merged = true;
                break;
            }
            if (merged) continue;
            const where = ChronicleMaps.placeOf(world, b.q, b.r);
            RealmTimeline._event(st, d, 'battle', b.q, b.r, _fill(C.text.battle, { victor: b.victor || 'A realm', loser: b.loser || 'its foe', at: where.at }), Math.round(_num(b.dead)));
        }
    },

    /** The crises: their spans (the strip's ages) and their grave news with a place. */
    _crisesDaily(world, st, day) {
        const cs = _obj(world.crises);
        if (!cs) return;
        const C = RealmTimeline.config();
        if (!_obj(st.seen.cn)) st.seen.cn = {};
        for (const c of [..._arr(cs.history), cs.active].filter(Boolean)) {
            if (!c.uid) continue;
            let a = st.ages.find(x => x[0] === c.uid);
            if (!a) {
                if (c.endDay != null && c.endDay < _num(st.start)) continue;
                const at = _obj(c.place) || (_obj(c.data) && _obj(c.data.at)) || null;
                a = [c.uid, String(c.kind || ''), String(c.name || c.kind || 'crisis'), _num(c.startDay, day), c.endDay != null ? c.endDay : null, at ? at.q : null, at ? at.r : null];
                st.ages.push(a);
                RealmTimeline._event(st, a[3], 'crisis', a[5], a[6], _fill(C.text.crisisBegins, { name: RealmTimeline._theName(a[2]) }), 50);
            }
            a[2] = String(c.name || a[2]);
            if (a[5] == null) {
                const at = _obj(c.place);
                if (at) { a[5] = at.q; a[6] = at.r; }
            }
            if (c.endDay != null && a[4] == null) a[4] = c.endDay;
        }
        // Grave news with a place: crisis:<uid>:<n>
        for (const n of _arr(cs.news)) {
            if (!n || n.kind !== 'crisis_grave' || !Number.isFinite(n.q) || !Number.isFinite(n.r)) continue;
            const m = /^crisis:(.+):(\d+)$/.exec(String(n.key || ''));
            if (!m) continue;
            const seenN = st.seen.cn[m[1]];
            if (seenN != null && Number(m[2]) <= seenN) continue;
            st.seen.cn[m[1]] = Number(m[2]);
            RealmTimeline._event(st, _num(n.day, day), 'crisis', n.q, n.r, String(n.text || ''), 30);
        }
    },

    /** The player's line, the sieges they fight or suffer, the crown they wear. */
    _playerDaily(world, st, player, day) {
        const C = RealmTimeline.config();
        const open = st.lives.length && st.lives[st.lives.length - 1][1] == null ? st.lives[st.lives.length - 1] : null;
        if (!player) {
            if (open) open[1] = day;
            st.seen.sg = [];
            return;
        }
        const name = String(player.name || 'A stranger');
        const house = String((player.house && player.house.name) || '');
        if (!open || open[2] !== name || open[3] !== house) {
            if (open) open[1] = day;
            st.lives.push([day, null, name, house]);
        }
        // Sieges: of the player's holdings (systems/holdingSieges.js) and by the player's host (player/generalship.js)
        const now = [];
        const T = C.text;
        const besieged = _obj(player.realmWars && player.realmWars.besieged) || {};
        const prev = new Set(_arr(st.seen.sg));
        for (const [key, s] of Object.entries(besieged)) {
            if (!s) continue;
            const id = `h:${key}`;
            now.push(id);
            if (prev.has(id)) continue;
            const t = typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null;
            const foe = s.kingdomName || s.foeName || (s.kingdomId != null && world.getKingdom ? (world.getKingdom(s.kingdomId) || {}).name : null) || 'An enemy host';
            RealmTimeline._event(st, day, 'siege', s.q, s.r, _fill(T.siegeHolding, { foe, town: (t && t.settlement && t.settlement.name) || s.name || 'a holding' }), 20);
        }
        const sg = player.commission && _obj(player.commission.siege);
        if (sg) {
            const id = `p:${sg.q},${sg.r}`;
            now.push(id);
            if (!prev.has(id)) RealmTimeline._event(st, day, 'siege', sg.q, sg.r, _fill(T.siegePlayer, { who: name, town: sg.name || 'a town', foe: sg.kingdomName || 'the enemy' }), 20);
        }
        st.seen.sg = now;
        // The crown the player wears (systems/throne.js)
        const ruling = player.throne && player.throne.ruling;
        const crown = ruling && ruling.kingdomId != null ? ruling.kingdomId : null;
        const was = st.seen.crown === undefined ? crown : st.seen.crown;
        if (crown !== was) {
            const kid = crown != null ? crown : was;
            const k = typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
            const cap = k && _obj(k.capital);
            RealmTimeline._event(st, day, 'crown', cap ? cap.q : null, cap ? cap.r : null,
                _fill(crown != null ? T.crownWon : T.crownLost, { who: name, realm: (k && k.name) || 'the realm' }), 40);
        }
        st.seen.crown = crown;
    },

    // ── The frames ──────────────────────────────────────

    _frame(world, st, cache, player, day) {
        const C = RealmTimeline.config();
        const T = C.text;
        const grid = RealmTimeline._liveGrid(world, st, cache, true);
        const old = cache.grid;
        const changed = [];
        for (let i = 0; i < grid.length; i++) if (grid[i] !== old[i]) changed.push([i, grid[i]]);
        // Towns that changed hands, were founded or are gone
        const views = RealmTimeline._views(world);
        const here = new Set();
        for (const s of views) {
            const key = `${s.q},${s.r}`;
            here.add(key);
            const idx = s.r * st.w + s.q;
            const from = old[idx], to = grid[idx];
            if (from && to && from !== to) {
                RealmTimeline._event(st, day, 'taken', s.q, s.r, _fill(T.taken, { victor: RealmTimeline._name(st, to, day), loser: RealmTimeline._name(st, from, day), town: s.name || 'a town' }), 10);
            }
            if (!cache.towns.has(key)) {
                cache.towns.set(key, st.towns.length);
                st.towns.push([s.q, s.r, String(s.name || 'a town'), day, null]);
            }
        }
        for (const [key, i] of [...cache.towns]) {
            if (here.has(key)) continue;
            if (st.towns[i]) st.towns[i][4] = day;
            cache.towns.delete(key);
        }
        RealmTimeline._thinTowns(st, cache);
        const f = [day, RealmTimeline.encodeChanges(changed)];
        // The player's holdings, when they changed
        const hold = RealmTimeline._holdings(player, st);
        if (hold !== cache.hold) { f.push(hold); cache.hold = hold; }
        st.frames.push(f);
        cache.grid = grid;
        cache.n = st.frames.length;
        RealmTimeline._thinFrames(st, cache);
        return f;
    },

    _holdings(player, st) {
        if (!player) return '';
        const out = [];
        for (const key of _arr(player.holdings && player.holdings.keys)) {
            const [q, r] = String(key).split(',').map(Number);
            if (!Number.isFinite(q) || !Number.isFinite(r) || q < 0 || r < 0 || q >= st.w || r >= st.h) continue;
            out.push(r * st.w + q);
        }
        return [...new Set(out)].sort((a, b) => a - b).slice(0, 60).map(_b36).join('.');
    },

    /** Past frameCap: fold the frame closest to its neighbours into the next (never the last). */
    _thinFrames(st, cache) {
        const C = RealmTimeline.config();
        const cap = Math.max(8, _num(C.frameCap, 480));
        // (and a budget on the changes' bytes: a century of churn thins the old years harder)
        const budget = Math.max(4096, _num(C.frameBytes, 60000));
        let bytes = 0;
        for (const f of st.frames) bytes += f[1].length + 12;
        while (st.frames.length > cap || (bytes > budget && st.frames.length > 8)) {
            const F = st.frames;
            let best = 0, span = Infinity;
            for (let i = 0; i < F.length - 1; i++) {
                const prev = i > 0 ? F[i - 1][0] : _num(st.base.d);
                const s = F[i + 1][0] - prev;
                if (s < span) { span = s; best = i; }
            }
            const a = F[best], b = F[best + 1];
            const merged = [b[0], RealmTimeline.composeChanges(a[1], b[1])];
            if (b.length > 2) merged.push(b[2]);
            else if (a.length > 2) merged.push(a[2]);
            bytes += merged[1].length - a[1].length - b[1].length - 12;
            F.splice(best, 2, merged);
        }
        if (cache) cache.n = st.frames.length;
    },

    _thinTowns(st, cache) {
        const cap = Math.max(40, _num(RealmTimeline.config().townCap, 400));
        if (st.towns.length <= cap) return;
        // The oldest of the gone go first
        while (st.towns.length > cap) {
            const i = st.towns.findIndex(t => t[4] != null);
            if (i < 0) break;
            st.towns.splice(i, 1);
        }
        cache.towns.clear();
        st.towns.forEach((t, i) => { if (t[4] == null) cache.towns.set(`${t[0]},${t[1]}`, i); });
    },

    _thinEvents(st) {
        const C = RealmTimeline.config();
        const cap = Math.max(20, _num(C.eventCap, 360));
        if (st.events.length <= cap) return;
        const P = C.priority;
        const score = (e) => _num(P[e[1]], 1) + Math.log10(1 + _num(e[5])) * 0.5;
        const order = st.events.map((e, i) => i).sort((a, b) => score(st.events[a]) - score(st.events[b]) || a - b);
        const drop = new Set(order.slice(0, st.events.length - cap));
        st.events = st.events.filter((e, i) => !drop.has(i));
    },

    // ── Encoding ────────────────────────────────────────

    /** A grid as "code*run,…" (base 36). */
    encodeGrid(grid) {
        const out = [];
        let run = 0, cur = -1;
        for (let i = 0; i < grid.length; i++) {
            if (grid[i] === cur) { run++; continue; }
            if (run) out.push(run > 1 ? `${_b36(cur)}*${_b36(run)}` : _b36(cur));
            cur = grid[i];
            run = 1;
        }
        if (run) out.push(run > 1 ? `${_b36(cur)}*${_b36(run)}` : _b36(cur));
        return out.join(',');
    },

    decodeGrid(str, size) {
        const grid = new Int16Array(size);
        let i = 0;
        for (const tok of String(str || '').split(',')) {
            if (!tok) continue;
            const [c, n] = tok.split('*');
            const code = _int(c), run = n ? _int(n) : 1;
            grid.fill(code, i, Math.min(size, i + run));
            i += run;
        }
        return grid;
    },

    /**
     * Changed tiles [[tile, code]…] (any order) as "gap.code[*run],…" (base 36):
     * tiles in order, each token's gap counted from the end of the token before,
     * a run of neighbouring tiles that took the same realm folded into one.
     */
    encodeChanges(list) {
        const sorted = [...list].sort((a, b) => a[0] - b[0]);
        const out = [];
        let end = 0;
        for (let k = 0; k < sorted.length;) {
            const [i, code] = sorted[k];
            let run = 1;
            while (k + run < sorted.length && sorted[k + run][0] === i + run && sorted[k + run][1] === code) run++;
            out.push(`${_b36(i - end)}.${_b36(code)}${run > 1 ? `*${_b36(run)}` : ''}`);
            end = i + run;
            k += run;
        }
        return out.join(',');
    },

    /** A change string back as [[tile, code]…] in tile order. */
    decodeChanges(str) {
        const out = [];
        if (!str) return out;
        let end = 0;
        for (const tok of str.split(',')) {
            const dot = tok.indexOf('.');
            if (dot < 0) continue;
            const star = tok.indexOf('*', dot);
            const i = end + _int(tok.slice(0, dot));
            const code = _int(star < 0 ? tok.slice(dot + 1) : tok.slice(dot + 1, star));
            const run = star < 0 ? 1 : _int(tok.slice(star + 1));
            for (let k = 0; k < run; k++) out.push([i + k, code]);
            end = i + run;
        }
        return out;
    },

    applyChanges(grid, str) {
        for (const [i, code] of RealmTimeline.decodeChanges(str)) if (i >= 0 && i < grid.length) grid[i] = code;
        return grid;
    },

    /** Two change strings as one (b after a; b wins on a tile both touch). */
    composeChanges(a, b) {
        const m = new Map();
        for (const [i, code] of RealmTimeline.decodeChanges(a)) m.set(i, code);
        for (const [i, code] of RealmTimeline.decodeChanges(b)) m.set(i, code);
        return RealmTimeline.encodeChanges([...m]);
    },

    // ── Reading the record (the viewer, the tests) ──────

    /** The days the record can show: [{ day, index }] — index 0 the base, k the k-th frame. */
    points(st) {
        if (!st || !st.base) return [];
        return [{ day: _num(st.base.d), index: 0 }, ...st.frames.map((f, i) => ({ day: f[0], index: i + 1 }))];
    },

    /** The grid at point `index` (0 = base). Pass `from` { index, grid } to replay forward from a known grid. */
    gridAt(st, index, from = null) {
        const size = st.w * st.h;
        let grid, k;
        if (from && from.grid && from.index <= index) { grid = Int16Array.from(from.grid); k = from.index; } else { grid = RealmTimeline.decodeGrid(st.base.g, size); k = 0; }
        for (; k < index && k < st.frames.length; k++) RealmTimeline.applyChanges(grid, st.frames[k][1]);
        return grid;
    },

    /** The player's holding tiles at point `index`: [tile index]. */
    holdingsAt(st, index) {
        let h = '';
        for (let k = 0; k < index && k < st.frames.length; k++) if (st.frames[k].length > 2) h = st.frames[k][2];
        return h ? h.split('.').map(_int) : [];
    },

    /** A realm (by code) as it was on `day`: { code, id, name, color, ruler, fell }. */
    realmAt(st, code, day) {
        const r = st && st.realms[code - 1];
        if (!r) return null;
        let m = r.m[0];
        for (const x of r.m) { if (x[0] <= day) m = x; else break; }
        return { code, id: r.id, name: m[1], color: m[2], ruler: m[3], fell: r.f };
    },

    _name(st, code, day) {
        const r = RealmTimeline.realmAt(st, code, day);
        return r ? r.name : 'a realm';
    },

    /** Towns standing on `day`: [{ q, r, name, founded, gone }]. */
    townsAt(st, day) {
        return _arr(st && st.towns).filter(t => (t[3] == null || t[3] <= day) && (t[4] == null || t[4] > day))
            .map(t => ({ q: t[0], r: t[1], name: t[2], founded: t[3], gone: t[4] }));
    },

    /** Events with from < day <= to: [{ day, kind, q, r, text, weight, count, i }]. */
    eventsBetween(st, from, to) {
        const out = [];
        _arr(st && st.events).forEach((e, i) => {
            if (e[0] > from && e[0] <= to) out.push({ day: e[0], kind: e[1], q: e[2], r: e[3], text: e[4], weight: e[5], count: e[6], i });
        });
        return out;
    },

    /** Wars open on `day`: [{ a, b, from, to, victor }] (realm codes). */
    warsAt(st, day) {
        return _arr(st && st.wars).filter(w => w[2] <= day && (w[3] == null || w[3] > day)).map(w => ({ a: w[0], b: w[1], from: w[2], to: w[3], victor: w[4] }));
    },

    /**
     * The strip under the slider: { from, to, lanes: [{ id, label, spans:
     * [{ from, to, label, icon, tone }] }] } — the age's crises, the player's
     * line, and the wars (of `minWarDays` or more).
     */
    strip(world, st, opts = {}) {
        if (!st || !st.base) return { from: 0, to: 0, lanes: [] };
        const now = _num(world && world.day, _num(st.base.d));
        const from = _num(st.base.d), to = Math.max(now, from + 1);
        const icons = { invasion: '⚔️', plague: '☠️', schism: '⛪', famine: '🥀', rush: '💰' };
        const ages = st.ages.map(a => ({ from: Math.max(from, a[3]), to: a[4] == null ? to : a[4], label: a[2], icon: icons[a[1]] || '🌋', tone: 'bad', q: a[5], r: a[6] }));
        // The climate's eras (world/climate.js: game-year spans, a hash of the seed) that have begun
        for (const e of RealmTimeline.climateEras(world, from, to)) ages.push(e);
        ages.sort((a, b) => a.from - b.from);
        const lives = st.lives.map(l => ({ from: Math.max(from, l[0]), to: l[1] == null ? to : l[1], label: `${l[2]}${l[3] ? ` of House ${l[3].replace(/^House\s+/i, '')}` : ''}`, icon: '👑', tone: 'gold' }));
        const minWar = Math.max(0, _num(opts.minWarDays, 30));
        const wars = st.wars.filter(w => (w[3] == null ? to : w[3]) - w[2] >= minWar).map(w => {
            const a = RealmTimeline._name(st, w[0], w[2]), b = RealmTimeline._name(st, w[1], w[2]);
            return { from: Math.max(from, w[2]), to: w[3] == null ? to : w[3], label: `${a} against ${b}${w[4] ? ` — won by ${RealmTimeline._name(st, w[4], w[3] || to)}` : ''}`, icon: '🔥', tone: 'warn' };
        });
        return {
            from, to,
            lanes: [
                { id: 'ages', label: 'Ages', spans: ages },
                { id: 'lives', label: 'Your line', spans: lives },
                { id: 'wars', label: 'Wars', spans: wars },
            ],
        };
    },

    /**
     * The climate eras over [from, to] days as strip spans: { from, to, label,
     * icon, tone: 'cool', climate } — only those begun by `to`. Reads only.
     */
    climateEras(world, from, to) {
        if (!world) return [];
        let eras = [];
        try { eras = Climate.eras(world, Climate.yearOf(to)); } catch (err) { return []; }
        const Y = Seasons.DAYS_PER_YEAR;
        const kinds = (Climate.config() || {}).kinds || {};
        const out = [];
        for (const e of _arr(eras)) {
            const a = Math.round(_num(e.from) * Y) + 1, b = Math.round(_num(e.to) * Y) + 1;
            if (a > to || b < from) continue;
            const name = String(e.name || (kinds[e.kind] || {}).label || 'a change in the weather');
            out.push({ from: Math.max(from, a), to: Math.min(to, b), label: name.charAt(0).toUpperCase() + name.slice(1), icon: (kinds[e.kind] || {}).icon || '🌦️', tone: 'cool', climate: e.kind });
        }
        return out;
    },

    /** The live grid as the viewer's "now" (no realm registered; unknown ones show as unclaimed). */
    gridNow(world, st) {
        if (!st || !st.base) return null;
        const cache = RealmTimeline._cacheOf(st);
        return RealmTimeline._liveGrid(world, st, cache, false);
    },

    /** A rough size of the record in bytes (its JSON). */
    bytes(world) {
        const st = world && _obj(world.timeline);
        return st ? JSON.stringify(st).length : 0;
    },

    /** The point index nearest a day (for jump-to links). */
    pointFor(st, day) {
        const pts = RealmTimeline.points(st);
        if (!pts.length) return 0;
        // The first frame on or after the day (the borders "as of then") when one lies within a season
        const after = pts.find(p => p.day >= day);
        if (after && after.day - day <= Seasons.DAYS_PER_SEASON) return after.index;
        let best = pts[0];
        for (const p of pts) if (Math.abs(p.day - day) < Math.abs(best.day - day)) best = p;
        return best.index;
    },
};
