// ============================================
// CHRONICLE MAPS — what the illustrated chronicle must keep as the game runs
// ============================================
// The illustrated book (systems/chronicleBook.js, ui/chronicleBook.js) is
// composed on demand from the Annals, but three things cannot be read back
// later, so they are taken as they happen:
//
//   maps      border snapshots of the realm: at the founding, at each
//             reign's end, when a crown is won or lost and every `eraYears`
//             years. A map is a coarse grid (at most `maxCols` cells wide),
//             each cell a realm letter, '.' unclaimed land, '^' mountain or
//             '~' water, run-length encoded row by row ("~12A5.3/..."), with
//             the realms' names, colours and seats as they then were and the
//             cells of the player's holdings. Thinned to `mapCap` (era maps
//             first): eighty years of play save a few tens of kilobytes.
//   rulers    per reign (the Annals chapter id g<gen>_<startDay>): the ruler's
//             look (player.appearance, for the portrait), spouse and children
//             as last seen — the family tree of rulers long dead
//   moments   per closed reign: its chronicle lines of war, great works and
//             death, filed when the reign ends so they outlive the House
//             chronicle's cap (raw: the book tells them in the past tense)
//
// State: player.house.chronicleBook — saved with the House (House.serialize
// deep-copies it). processDay(player, world) runs from House.processDaily.
// A leaf module (data, seasons, terrain only): reads the world, never
// changes it, draws no RNG. Config: data/chronicleBook.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { Terrain } from '../world/terrain.js';

const DEFAULTS = {
    maxCols: 64, mapCap: 32, eraYears: 30, familyEvery: 30, momentCap: 10,
    moments: {
        battles: { title: 'Wars and battles', icon: '⚔️', tags: ['war', 'siege', 'conquest', 'peace', 'coalition', 'battle'], words: ['battle', 'siege', 'war'] },
        works: { title: 'Great works', icon: '🏛️', tags: ['greatWork'], words: ['great work'] },
        deaths: { title: 'Deaths', icon: '🕯️', tags: ['widowed', 'death', 'ended'], words: ['dies', 'died', 'slain', 'killed'] },
    },
    // A battle as the House chronicle tells it (House.recordBattle): by kind and outcome
    battleLines: {
        minStrength: 20, near: 6,
        field: { victory: '{who} defeated {foe} in battle {at}.', defeat: '{who} was defeated by {foe} in battle {at}.' },
        sea: { victory: '{who} defeated {foe} in a sea battle {at}.', defeat: '{who} was defeated by {foe} in a sea battle {at}.' },
        assault: { victory: '{who} stormed {place}, defended by {foe}.', defeat: "{who}'s assault on {place} was thrown back by {foe}." },
        siege: { victory: '{who} took {place} from {foe} after a siege.', defeat: '{who} failed to take {place} from {foe}.' },
    },
    labels: {
        founding: 'The realm at the founding of {house}', end: 'The realm at the death of {name}',
        era: 'The realm in the year {year}', crownWon: 'The realm as {name} took the crown of {crown}',
        crownLost: 'The realm as the crown of {crown} passed from {house}', final: 'The realm in the year {year}',
    },
};

// Realm letters: A–Z then a–z (digits are the run counts)
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KINDS = ['deaths', 'works', 'battles'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let _cfgSrc;
let _cfg = null;

export const ChronicleMaps = {
    LETTERS,

    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.chronicleBook) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            _cfg = { ...DEFAULTS, ...o, moments: { ...DEFAULTS.moments, ...(o.moments || {}) }, labels: { ...DEFAULTS.labels, ...(o.labels || {}) }, battleLines: { ...DEFAULTS.battleLines, ...(o.battleLines || {}) } };
        }
        return _cfg;
    },

    /** The House's book state, backfilled: { maps, rulers, moments, filed, lastCrown, lastFamilyDay }. */
    state(house) {
        if (!house) return null;
        let st = house.chronicleBook;
        if (!_obj(st)) st = house.chronicleBook = {};
        if (!Array.isArray(st.maps)) st.maps = [];
        if (!_obj(st.rulers)) st.rulers = {};
        if (!_obj(st.moments)) st.moments = {};
        if (!_obj(st.filed)) st.filed = {};
        if (st.lastCrown === undefined) st.lastCrown = null;
        return st;
    },

    /** The Annals chapter id of a reign record (systems/annals.js _chapter). */
    reignId(reign) {
        return reign ? `g${reign.generation || 1}_${_num(reign.startDay)}` : null;
    },

    /** The calendar year of a day (as Annals.year). */
    year(world, day) {
        const base = _num(world && world.baseYear, 1);
        return base + Math.floor((Math.max(1, Math.floor(_num(day, 1))) - 1) / Seasons.DAYS_PER_YEAR);
    },

    // ── The daily tick ──────────────────────────────────

    /**
     * Take the maps and notes the book will need. Called once a day with the
     * living player (House.processDaily); most days it is a few compares.
     * Returns { maps } when maps were taken, else null.
     */
    processDay(player, world) {
        const house = player && player.house;
        if (!house || !world || !Array.isArray(world.tiles)) return null;
        const st = ChronicleMaps.state(house);
        const C = ChronicleMaps.config();
        const day = _num(world.day);
        const hname = house.name || 'the House';
        const taken = [];

        const ruling = player.throne && player.throne.ruling;
        const crownId = ruling && ruling.kingdomId != null ? ruling.kingdomId : null;
        if (!st.maps.length) {
            // The first map: the founding (or, for a save from before the book, the year it was opened)
            const founding = day - _num(house.foundedDay, day) <= 2;
            taken.push(founding
                ? ChronicleMaps.capture(player, world, 'founding', _fill(C.labels.founding, { house: hname }))
                : ChronicleMaps.capture(player, world, 'first', _fill(C.labels.era, { year: ChronicleMaps.year(world, day) })));
            st.lastCrown = crownId;
        }

        // A reign closed since yesterday: its map and its moments
        for (const r of _arr(house.reigns)) {
            const id = ChronicleMaps.reignId(r);
            if (!id || st.filed[id] != null) continue;
            st.filed[id] = day;
            st.moments[id] = ChronicleMaps.fileMoments(house, r);
            // (an old save's reigns, closed long ago: no map of that day is left to take)
            if (day - _num(r.endDay, day) <= 2) {
                taken.push(ChronicleMaps.capture(player, world, 'end', _fill(C.labels.end, { name: r.name || 'the ruler' }), { reign: id, day: _num(r.endDay, day) }));
            }
        }

        // A crown won or lost
        if (crownId !== st.lastCrown) {
            const kid = crownId != null ? crownId : st.lastCrown;
            const k = typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
            const crown = (k && k.name) || (ruling && ruling.kingdomName) || 'the realm';
            if (crownId != null) taken.push(ChronicleMaps.capture(player, world, 'crownWon', _fill(C.labels.crownWon, { name: player.name || 'the ruler', crown })));
            else taken.push(ChronicleMaps.capture(player, world, 'crownLost', _fill(C.labels.crownLost, { crown, house: hname })));
            st.lastCrown = crownId;
        }

        // The long years between
        const last = st.maps[st.maps.length - 1];
        const eraDays = Math.max(1, _num(C.eraYears, 30)) * Seasons.DAYS_PER_YEAR;
        if (last && day - _num(last.day) >= eraDays) {
            taken.push(ChronicleMaps.capture(player, world, 'era', _fill(C.labels.era, { year: ChronicleMaps.year(world, day) })));
        }

        // The living ruler's look and family, refreshed now and then
        const curId = ChronicleMaps.reignId(ChronicleMaps._currentReign(house));
        const note = curId ? _obj(st.rulers[curId]) : null;
        // (and at once on a birth, a death in the family or a marriage)
        const changed = note && (_arr(note.children).length !== _arr(player.children).filter(Boolean).length
            || _arr(note.children).filter(c => c.alive).length !== _arr(player.children).filter(c => c && c.isAlive !== false).length
            || !!note.spouseId !== !!player.spouse);
        if (curId && (!note || changed || day - _num(st.lastFamilyDay, -1e9) >= _num(C.familyEvery, 30))) {
            st.rulers[curId] = ChronicleMaps.rulerNote(player, world);
            st.lastFamilyDay = day;
        }
        if (taken.length) ChronicleMaps._thin(st);
        const maps = taken.filter(Boolean);
        return maps.length ? { maps } : null;
    },

    /**
     * The open reign — or, before Legacy.ensure has opened one (a new House,
     * an old save), the one it will open: from the last succession, else the
     * founding (systems/legacy.js ensure).
     */
    _currentReign(house) {
        if (house.currentReign) return house.currentReign;
        if (house.currentReign === null && house.ended) return null;
        const last = _arr(house.history).filter(h => h && _arr(h.tags).includes('succession')).pop();
        return { generation: house.generation || 1, startDay: last ? last.day : _num(house.foundedDay) };
    },

    /** The ruler as the book remembers them: look, spouse, children. Plain data. */
    rulerNote(player, world, opts = {}) {
        const a = _obj(player && player.appearance);
        let appearance = null;
        if (a) {
            appearance = {};
            for (const k of Object.keys(a).slice(0, 24)) if (typeof a[k] === 'string' || typeof a[k] === 'number') appearance[k] = a[k];
        }
        const children = _arr(player && player.children).filter(Boolean).slice(0, 16).map(c => ({
            name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || 'a child',
            gender: c.gender || null, born: c.birthDay != null ? ChronicleMaps.year(world, c.birthDay) : null,
            alive: c.isAlive !== false,
        }));
        return {
            name: (player && player.name) || '', gender: (player && player.gender) || null, appearance,
            spouse: opts.spouseName || ChronicleMaps._spouseName(player) || null, spouseId: (player && player.spouse) || null, children, day: _num(world && world.day),
        };
    },

    /** The spouse's name from the player's NPC registry (synced by Relationships), else null. */
    _spouseName(player) {
        const id = player && player.spouse;
        if (!id) return null;
        const npc = _arr(player._relationshipNpcs).find(n => n && n.id === id);
        if (!npc) return null;
        return `${npc.firstName || npc.name || ''}${npc.dynasty ? ` ${npc.dynasty}` : ''}`.trim() || null;
    },

    /** Keep at most mapCap maps: the era maps go first, then the oldest past the founding (never the newest). */
    _thin(st) {
        const cap = Math.max(4, _num(ChronicleMaps.config().mapCap, 32));
        while (st.maps.length > cap) {
            const n = st.maps.length;
            let i = st.maps.findIndex((m, j) => m.kind === 'era' && j > 0 && j < n - 1);
            if (i < 0) i = st.maps.findIndex((m, j) => j > 0 && j < n - 1 && m.kind !== 'end');
            if (i < 0) i = 1;
            st.maps.splice(i, 1);
        }
    },

    // ── The maps ────────────────────────────────────────

    /** Take a map now and file it on the House. Returns the mark (or null). */
    capture(player, world, kind, label, extra = {}) {
        const st = ChronicleMaps.state(player && player.house);
        const mark = ChronicleMaps.snapshot(world, player, { kind, label, ...extra });
        if (st && mark) st.maps.push(mark);
        return mark;
    },

    /**
     * The realm's borders as a compact grid: { kind, label, day, year, w, h,
     * step, rows (RLE), realms: [[letter, id, name, color, cells]], seats:
     * [[letter, x, y]], own: [cell…] (the player's holdings), crown (letter
     * of the realm the player rules, or null), reign? }.
     */
    snapshot(world, player = null, meta = {}) {
        if (!world || !Array.isArray(world.tiles) || !world.width || !world.height) return null;
        const C = ChronicleMaps.config();
        const step = Math.max(1, Math.ceil(world.width / Math.max(8, _num(C.maxCols, 64))));
        const w = Math.ceil(world.width / step), h = Math.ceil(world.height / step);
        const kingdomOf = (id) => (typeof world.getKingdom === 'function' ? world.getKingdom(id) : null);
        const letterOf = new Map();
        const realms = [];
        const rows = [];
        for (let y = 0; y < h; y++) {
            let line = '', run = '', n = 0;
            const r = Math.min(world.height - 1, y * step + (step >> 1));
            for (let x = 0; x < w; x++) {
                const q = Math.min(world.width - 1, x * step + (step >> 1));
                const t = world.tiles[r] && world.tiles[r][q];
                let ch = '~';
                if (t) {
                    const tid = t.terrain && t.terrain.id;
                    if (tid && Terrain.isWaterId(tid)) ch = '~';
                    else if (t.kingdom != null) {
                        let L = letterOf.get(t.kingdom);
                        if (L === undefined) {
                            const k = kingdomOf(t.kingdom);
                            L = realms.length < LETTERS.length ? LETTERS[realms.length] : '.';
                            if (L !== '.') realms.push([L, t.kingdom, (k && k.name) || 'A realm', (k && k.color) || '#8a7a5a', 0]);
                            letterOf.set(t.kingdom, L);
                        }
                        ch = L;
                        if (L !== '.') realms[LETTERS.indexOf(L)][4]++;
                    } else ch = tid && /mountain|peak/.test(tid) ? '^' : '.';
                }
                if (ch === run) n++;
                else {
                    if (n) line += run + (n > 1 ? n : '');
                    run = ch;
                    n = 1;
                }
            }
            if (n) line += run + (n > 1 ? n : '');
            rows.push(line);
        }
        // The player's holdings, as cells ("q,r" keys)
        const own = [];
        for (const key of _arr(player && player.holdings && player.holdings.keys).slice(0, 40)) {
            const [q, r] = String(key).split(',').map(Number);
            if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
            const cell = Math.floor(r / step) * w + Math.floor(q / step);
            if (!own.includes(cell)) own.push(cell);
        }
        // Each realm's seat, for the map's labels
        const seats = [];
        for (const [L, id] of realms) {
            const cap = (kingdomOf(id) || {}).capital;
            if (cap && Number.isFinite(cap.q) && Number.isFinite(cap.r)) seats.push([L, Math.floor(cap.q / step), Math.floor(cap.r / step)]);
        }
        const ruling = player && player.throne && player.throne.ruling;
        const crown = ruling && letterOf.has(ruling.kingdomId) ? letterOf.get(ruling.kingdomId) : null;
        const day = meta.day != null ? _num(meta.day) : _num(world.day);
        const out = { kind: meta.kind || 'era', label: meta.label || '', day, year: ChronicleMaps.year(world, day), w, h, step, rows: rows.join('/'), realms, seats, own, crown: crown === '.' ? null : crown };
        if (meta.reign) out.reign = meta.reign;
        return out;
    },

    /** A map's grid back as rows of cell characters (each `w` long). */
    decode(mark) {
        if (!mark || typeof mark.rows !== 'string') return [];
        return mark.rows.split('/').map((line) => {
            let s = '';
            const re = /([^0-9])(\d*)/g;
            let m;
            while ((m = re.exec(line)) && m[0]) s += m[1].repeat(m[2] ? Number(m[2]) : 1);
            return s;
        });
    },

    // ── The moments ─────────────────────────────────────

    /** What kind of moment a chronicle entry is: 'battles' | 'works' | 'deaths' | null. */
    classify(entry) {
        if (!entry) return null;
        const M = ChronicleMaps.config().moments;
        const tags = _arr(entry.tags);
        // Deaths first (a death in war is a death), then the works, then the wars
        for (const id of KINDS) if (M[id] && _arr(M[id].tags).some(t => tags.includes(t))) return id;
        const text = String(entry.text || '').toLowerCase();
        for (const id of KINDS) {
            if (M[id] && _arr(M[id].words).some(w => new RegExp(`\\b${_reEsc(String(w).toLowerCase())}\\b`).test(text))) return id;
        }
        return null;
    },

    /**
     * Where a fight happened, for the chronicle: { place, at } — the town on the
     * tile ('at Kettle'), else the nearest within `battleLines.near` steps
     * ('near Kettle'), else the land itself ('in the hills'). Reads only.
     */
    placeOf(world, q, r) {
        if (!world || !Number.isFinite(q) || !Number.isFinite(r)) return { place: null, at: 'in the field' };
        const tile = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (tile && tile.settlement && tile.settlement.name) return { place: tile.settlement.name, at: `at ${tile.settlement.name}` };
        const near = Math.max(0, _num(ChronicleMaps.config().battleLines.near, 6));
        let best = null, bestD = Infinity;
        const views = typeof world.getSettlementViews === 'function' ? _arr(world.getSettlementViews()) : [];
        for (const v of views) {
            if (!v || !v.name || !Number.isFinite(v.q) || !Number.isFinite(v.r)) continue;
            const d = Hex.offsetDistance(q, r, v.q, v.r);
            if (d < bestD) { bestD = d; best = v; }
        }
        if (best && bestD <= near) return { place: best.name, at: `near ${best.name}` };
        const t = tile && tile.terrain && (tile.terrain.name || tile.terrain.id);
        return { place: null, at: t ? `in the ${String(t).toLowerCase().replace(/_/g, ' ')}` : 'in the field' };
    },

    /**
     * A battle's chronicle line (data/chronicleBook.json battleLines):
     * opts { who, foe, place, at, outcome: 'victory'|'defeat', kind:
     * 'field'|'sea'|'assault'|'siege' }.
     */
    battleLine(opts = {}) {
        const L = ChronicleMaps.config().battleLines || {};
        const byKind = _obj(L[opts.kind]) || _obj(L.field) || {};
        const tpl = byKind[opts.outcome === 'victory' ? 'victory' : 'defeat'] || '{who} fought {foe} {at}.';
        const place = opts.place || 'the field';
        return _fill(tpl, { who: opts.who || 'The House', foe: opts.foe || 'a foe', place, at: opts.at || (opts.place ? `at ${opts.place}` : 'in the field') })
            .replace(/\s+([.,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    },

    /** A closed reign's chronicle lines of war, works and death, raw: [{ day, text, tags }]. */
    fileMoments(house, reign) {
        const cap = Math.max(1, _num(ChronicleMaps.config().momentCap, 10));
        const from = _num(reign.startDay), to = _num(reign.endDay, Infinity), gen = reign.generation || 1;
        const by = { battles: [], works: [], deaths: [] };
        for (const h of _arr(house && house.history)) {
            if (!h || (h.generation || 1) !== gen || _num(h.day) < from || _num(h.day) > to) continue;
            const kind = ChronicleMaps.classify(h);
            if (kind) by[kind].push({ day: _num(h.day), text: String(h.text || ''), tags: _arr(h.tags).slice(0, 4), ...(_obj(h.battle) ? { battle: { ...h.battle } } : {}) });
        }
        return [].concat(...KINDS.map(k => ChronicleMaps.spread(by[k], cap)));
    },

    /** At most `cap` of a list in order: the first, the last and an even spread between. */
    spread(list, cap) {
        if (list.length <= cap) return list;
        const keep = [];
        for (let i = 0; i < cap; i++) {
            const e = list[Math.round(i * (list.length - 1) / Math.max(1, cap - 1))];
            if (!keep.includes(e)) keep.push(e);
        }
        return keep;
    },
};
