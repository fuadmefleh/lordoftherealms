// ============================================
// THE ALMANAC OF THE WORLD — a searchable, cross-linked encyclopedia
// ============================================
// Not a new record: an index over the ones the game already keeps. No
// simulation, no RNG, nothing written to the world or the player.
//
//   people    the House's lineage (systems/dynastyTree.js build/lifeSummary),
//             courtiers (house.court) and the NPCs the player knows (opts.npc /
//             opts.known: the caller passes the relationships lookups), the
//             townsfolk spoken to (Townsfolk.acquaintances, with what they
//             remember of the House: systems/npcMemory.js person.nm), the realms'
//             lords (kingdom.lord, NPCLords.memoryOf), rival House heads, nemeses
//             (player.nemesis), cadet branch heads
//   houses    the player's (house.history), rivals' (house.rivals, their log),
//             cadet branches (house.cadets, their log)
//   places    every settlement standing (type, realm, culture, founding, its
//             era: world/townEras.js; its marks: world/townMarks.js via
//             TownMemory.markText; the town's own memory of the House: folk.nm;
//             its townsfolk annals) and the towns the Timeline saw fall to ruin
//   realms    world.timeline realms (rulers and names over time, rise and
//             fall: systems/realmTimeline.js), else world.kingdoms
//   wars      the Timeline's wars (else world.warHistory) and its battles,
//             sieges and towns taken; the House's own battles (house.history)
//   ages      the crises (Crises.annalChapters) and climate eras
//             (Climate.annalChapters)
//   works     the great works raised (world.greatWorks.built)
//
// index(player, world, opts) builds once per day and keeps it (a WeakMap on
// the world); the heavier text of a page (a life told in full, a town's
// annals) is only made when the page is opened (entry.more()). Lists are
// capped (data/almanac.json caps) so an eighty-year save stays quick.
//
// Links: each entry links the entries it names (people ↔ Houses ↔ places ↔
// events, both ways), and any text shown can be linkified (mentions()).
// Entries with a place carry q/r ("see on the map"); those with a date carry
// tlDay ("see on the Timeline").

import { DataLoader } from '../core/dataLoader.js';
import { ChronicleMaps } from './chronicleMaps.js';
import { DynastyTree } from './dynastyTree.js';
import { Crises } from './crises.js';
import { Climate } from '../world/climate.js';
import { Nemesis } from './nemesis.js';
import { RivalHouses } from './rivalHouses.js';
import { CadetBranches } from './cadetBranches.js';
import { Townsfolk } from './townsfolk.js';
import { TownMarks } from '../world/townMarks.js';
import { TownMemory } from './townMemory.js';
import { TownEras } from '../world/townEras.js';
import { NPCLords } from '../world/npcLords.js';
import { Seasons } from '../world/seasons.js';
import { Hex } from '../core/hex.js';
import { RealmTimeline } from './realmTimeline.js';
import { PublicWorks } from './publicWorks.js';
import { Names } from '../core/names.js';

const DEFAULTS = {
    cats: [
        { id: 'person', label: 'People', icon: '👤' },
        { id: 'house', label: 'Houses', icon: '🛡️' },
        { id: 'place', label: 'Places', icon: '🏘️' },
        { id: 'realm', label: 'Realms', icon: '👑' },
        { id: 'war', label: 'Wars & Battles', icon: '⚔️' },
        { id: 'age', label: 'Ages', icon: '🌋' },
        { id: 'work', label: 'Great Works', icon: '🏛️' },
    ],
    caps: { townsfolk: 240, npcs: 160, lines: 40, houseHistory: 80, search: 50, list: 80, townAnnals: 14, memories: 8 },
    eras: { hearth: 'the Hearth Age', timber: 'the Timber Age', stone: 'the Age of Stone', guild: 'the Guild Age' },
    kinds: {
        ruler: '👑', blood: '🧬', spouse: '💍', parent: '🌿', courtier: '🎩', npc: '👤', townsfolk: '🧑', lord: '🤴',
        rivalHead: '⚔️', nemesis: '🩸', cadetHead: '🌱', battle: '⚔️', siege: '🏰', taken: '🚩', war: '🔥',
        house: '🛡️', rival: '🗡️', cadet: '🌱', town: '🏘️', ruin: '🏚️', realm: '👑', fallen: '💀', crisis: '🌋', climate: '🌦️', work: '🏛️',
    },
    battleKinds: ['battle', 'siege', 'taken'],
    minNameLength: 4,
};

let _cfgSrc;
let _cfg = null;
const _memo = new WeakMap();

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _cap = (s) => { const t = String(s || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
const _reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _try = (fn, d = null) => { try { return fn(); } catch (e) { return d; } };

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') { const k = _try(() => world.getKingdom(id)); if (k) return k; }
    return _arr(world.kingdoms).find(k => k && k.id === id) || null;
}

function _views(world) {
    if (!world || typeof world.getSettlementViews !== 'function') return [];
    const out = [];
    for (const v of _arr(_try(() => world.getSettlementViews(), []))) {
        if (!v) continue;
        const t = typeof world.getTile === 'function' ? _try(() => world.getTile(v.q, v.r)) : null;
        const s = (t && t.settlement) || v;
        out.push({ s, q: _num(v.q, t ? t.q : 0), r: _num(v.r, t ? t.r : 0) });
    }
    return out;
}

/** Fill "{actor}"-style templates of the memory kinds (data/npcMemory.json labels). */
function _fill(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : ''));
}

export const Almanac = {
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.almanac) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = _obj(d) || {};
            _cfg = {
                ...DEFAULTS, ...o,
                cats: Array.isArray(o.cats) && o.cats.length ? o.cats : DEFAULTS.cats,
                caps: { ...DEFAULTS.caps, ...(_obj(o.caps) || {}) },
                eras: { ...DEFAULTS.eras, ...(_obj(o.eras) || {}) },
                kinds: { ...DEFAULTS.kinds, ...(_obj(o.kinds) || {}) },
            };
        }
        return _cfg;
    },

    year(world, day) {
        return day == null ? null : ChronicleMaps.year(world, day);
    },

    /** Forget the kept index (a test, or a load). */
    invalidate(world) {
        if (world) _memo.delete(world);
    },

    /**
     * The index: { day, entries: Map(id → entry), byCat: { cat: [entry] },
     * re (the names to linkify), names: Map(lower name → id) }. Built once a
     * day per world and kept. opts: { npc(id) → NPC, known() → [NPC], force }.
     */
    index(player, world, opts = {}) {
        if (!world) return Almanac._empty();
        const key = `${_num(world.day)}|${(player && player.name) || '-'}|${(player && player.house && player.house.generation) || 0}`;
        const kept = _memo.get(world);
        if (kept && kept.key === key && !opts.force) return kept.idx;
        const idx = Almanac._build(player, world, opts);
        _memo.set(world, { key, idx });
        return idx;
    },

    _empty() {
        const byCat = {};
        for (const c of Almanac.config().cats) byCat[c.id] = [];
        return { day: 0, entries: new Map(), byCat, re: null, names: new Map() };
    },

    _build(player, world, opts) {
        const C = Almanac.config();
        const idx = Almanac._empty();
        idx.day = _num(world.day);
        const pairs = [];
        const byName = idx.names;
        const nameOf = (name, id, force = false) => {
            const n = String(name || '').trim();
            if (n.length < C.minNameLength) return;
            const k = n.toLowerCase();
            if (force || !byName.has(k)) byName.set(k, id);
        };
        const add = (e) => {
            if (!e || !e.id || idx.entries.has(e.id)) return idx.entries.get(e && e.id) || null;
            const entry = {
                cat: 'person', kind: '', icon: '', sub: '', day: null, q: null, r: null, tlDay: null,
                facts: [], lines: [], more: null, ...e, links: new Set(),
            };
            entry.icon = entry.icon || C.kinds[entry.kind] || '•';
            entry.name = String(entry.name || '—');
            idx.entries.set(entry.id, entry);
            if (!idx.byCat[entry.cat]) idx.byCat[entry.cat] = [];
            idx.byCat[entry.cat].push(entry);
            return entry;
        };
        const link = (a, b) => { if (a && b && a !== b) pairs.push([a, b]); };
        // (year: when the line's day falls before the record began — a town's eras in the deep past)
        const line = (e, day, text, icon = '', year = null) => {
            if (!e || !text) return;
            e.lines.push({ day: day == null ? null : _num(day), year: year != null ? year : Almanac.year(world, day), text: String(text), icon });
        };
        const ctx = { C, world, player, opts, add, link, line, nameOf, idx };

        // Names to linkify: houses, realms, places, rulers (longest first)
        const compile = () => {
            const names = [...byName.keys()].sort((a, b) => b.length - a.length);
            idx.re = names.length ? new RegExp(`(?<![\\w'])(${names.map(_reEsc).join('|')})(?![\\w])`, 'gi') : null;
        };
        for (const step of ['_realms', '_places', '_houses', '_lineage', '_courtAndKnown', '_townsfolk', '_lords', '_rivalHeads', '_cadetHeads', '_nemeses', '_wars', '_ages', '_works']) {
            // (the battles are matched to their wars by the realms they name)
            if (step === '_wars') compile();
            try { Almanac[step](ctx); } catch (err) { /* a source that cannot be read leaves its entries out */ }
        }
        compile();
        // Lines that name an entry link it
        for (const e of idx.entries.values()) {
            for (const l of e.lines) for (const id of Almanac._namedIn(idx, l.text)) link(e.id, id);
        }
        for (const [a, b] of pairs) {
            const ea = idx.entries.get(a), eb = idx.entries.get(b);
            if (!ea || !eb) continue;
            ea.links.add(b);
            eb.links.add(a);
        }
        for (const e of idx.entries.values()) {
            e.lines.sort((x, y) => _num(x.day, -1) - _num(y.day, -1));
            if (e.lines.length > C.caps.lines) e.lines = e.lines.slice(-C.caps.lines);
            e.search = [e.name, e.sub, ...e.facts.map(f => f[1])].join(' ').toLowerCase();
        }
        for (const list of Object.values(idx.byCat)) list.sort((a, b) => a.name.localeCompare(b.name));
        return idx;
    },

    _namedIn(idx, text) {
        const out = [];
        if (!idx.re || !text) return out;
        idx.re.lastIndex = 0;
        const s = String(text);
        let m;
        while ((m = idx.re.exec(s))) {
            const id = idx.names.get(m[1].toLowerCase());
            if (id && !out.includes(id)) out.push(id);
        }
        return out;
    },

    // ── Realms ─────────────────────────────────────

    _realms(ctx) {
        const { world, add, line, nameOf } = ctx;
        const st = _obj(world.timeline);
        const seen = new Set();
        for (const r of _arr(st && st.realms)) {
            if (!r || r.id == null) continue;
            const m = _arr(r.m);
            const last = m[m.length - 1] || [];
            const k = _kingdom(world, r.id);
            const fell = r.f != null || (k && k.isAlive === false);
            const e = add({
                id: `k:${r.id}`, cat: 'realm', kind: fell ? 'fallen' : 'realm', name: (k && k.name) || last[1] || 'A realm',
                sub: fell ? `Fell in the year ${Almanac.year(world, r.f != null ? r.f : world.day)}` : `Ruled by ${(k && k.ruler) || last[3] || 'an unknown ruler'}`,
                day: r.r != null ? r.r : (m[0] ? m[0][0] : null), tlDay: r.r != null ? r.r : null,
                q: k && k.capital ? k.capital.q : null, r: k && k.capital ? k.capital.r : null,
            });
            if (!e) continue;
            seen.add(r.id);
            let prevRuler = null, prevName = null;
            for (const x of m) {
                if (x[1] && x[1] !== prevName && prevName) line(e, x[0], `The realm took the name ${x[1]}.`, '📜');
                if (x[3] && x[3] !== prevRuler) line(e, x[0], prevRuler ? `${x[3]} ruled ${x[1]}, after ${prevRuler}.` : `${x[3]} ruled ${x[1]}.`, '👑');
                prevRuler = x[3] || prevRuler;
                prevName = x[1] || prevName;
                nameOf(x[1], e.id);
            }
            if (r.r != null) line(e, r.r, `${e.name} rose.`, '🌅');
            if (r.f != null) line(e, r.f, `${e.name} fell.`, '💀');
            Almanac._realmFacts(ctx, e, k);
            nameOf(e.name, e.id, true);
        }
        for (const k of _arr(world.kingdoms)) {
            if (!k || seen.has(k.id)) continue;
            const e = add({
                id: `k:${k.id}`, cat: 'realm', kind: k.isAlive === false ? 'fallen' : 'realm', name: k.name || 'A realm',
                sub: k.isAlive === false ? 'Fallen' : `Ruled by ${k.ruler || (k.lord && k.lord.name) || 'an unknown ruler'}`,
                day: k.foundedDay != null ? k.foundedDay : null, q: k.capital ? k.capital.q : null, r: k.capital ? k.capital.r : null,
            });
            if (!e) continue;
            Almanac._realmFacts(ctx, e, k);
            nameOf(e.name, e.id, true);
        }
    },

    _realmFacts(ctx, e, k) {
        if (!k) return;
        const f = e.facts;
        if (k.ruler || (k.lord && k.lord.name)) f.push(['Ruler', k.ruler || k.lord.name]);
        if (k.culture) f.push(['Culture', k.culture]);
        const faith = k.religion && (k.religion.name || k.religion.id || (typeof k.religion === 'string' ? k.religion : null));
        if (faith) f.push(['Faith', String(faith)]);
        if (Array.isArray(k.territory) && k.territory.length) f.push(['Lands', `${k.territory.length} hexes`]);
        if (k.capital) {
            const t = ctx.world.getTile ? _try(() => ctx.world.getTile(k.capital.q, k.capital.r)) : null;
            if (t && t.settlement && t.settlement.name) {
                f.push(['Capital', t.settlement.name]);
                ctx.link(e.id, `s:${k.capital.q},${k.capital.r}`);
            }
        }
    },

    // ── Places ─────────────────────────────────────

    _places(ctx) {
        const { C, world, add, line, link, nameOf } = ctx;
        const st = _obj(world.timeline);
        const tl = new Map();
        for (const t of _arr(st && st.towns)) tl.set(`${t[0]},${t[1]}`, t);
        const Y = Seasons.DAYS_PER_YEAR;
        for (const { s, q, r } of _views(world)) {
            const at = `${q},${r}`;
            const t = tl.get(at);
            const kid = s.kingdom != null ? s.kingdom : (world.getTile ? _try(() => world.getTile(q, r).kingdom) : null);
            const k = _kingdom(world, kid);
            const foundedDay = t && t[3] != null ? t[3] : (s.colony && s.colony.foundedDay != null ? s.colony.foundedDay : null);
            const foundedYear = foundedDay != null ? Almanac.year(world, foundedDay) : (Number.isFinite(s.founded) ? s.founded : null);
            const era = Almanac._era(world, s);
            const e = add({
                id: `s:${at}`, cat: 'place', kind: 'town', name: s.name || 'A settlement', q, r,
                icon: s.type === 'capital' ? '🏰' : s.type === 'city' ? '🏙️' : s.type === 'village' ? '🛖' : '🏘️',
                sub: `${_cap(s.type || 'settlement')}${k ? ` of ${Names.realm(k.name)}` : ''}${foundedYear != null ? ` · founded ${foundedYear}` : ''}`,
                day: foundedDay, tlDay: foundedDay,
            });
            if (!e) continue;
            nameOf(e.name, e.id, true);
            if (k) { e.facts.push(['Realm', k.name]); link(e.id, `k:${k.id}`); }
            if (Number.isFinite(s.population)) e.facts.push(['Population', Math.round(s.population).toLocaleString('en-US')]);
            if (s.culture) e.facts.push(['Culture', s.culture]);
            if (foundedYear != null) e.facts.push(['Founded', `the year ${foundedYear}${s.foundedBy ? `, by ${s.foundedBy}` : ''}`]);
            else if (t) e.facts.push(['Founded', 'before the record began']);
            if (era) e.facts.push(['Era', _cap(era.label)]);
            if (s.colony && s.colony.motherKingdom != null) {
                const mk = _kingdom(world, s.colony.motherKingdom);
                if (mk) { e.facts.push(['Colony of', mk.name]); link(e.id, `k:${mk.id}`); }
            }
            if (foundedDay != null) line(e, foundedDay, `${e.name} was founded${s.foundedBy ? ` by ${s.foundedBy}` : ''}.`, '🏘️');
            const ens = TownEras.state(s);
            for (const h of _arr(ens && ens.history).slice(1)) {
                const label = C.eras[h[0]] || `the ${h[0]} age`;
                const day = (_num(h[1]) - _num(world.baseYear, 1)) * Y + 1;
                line(e, day, `${e.name} entered ${label}.`, '🧱', Math.floor(_num(h[1])));
            }
            for (const m of _arr(_try(() => TownMarks.marks(s), []))) {
                const text = _try(() => TownMemory.markText(s, m, world));
                if (text) line(e, m.d, text, { fire: '🔥', sack: '🏚️', statue: '🗿', name: '🪧', cairn: '🪨', mound: '⚰️', district: '🏗️' }[m.k] || '•');
            }
            e.more = () => Almanac._placeMore(ctx, s, e);
        }
        // The towns the Timeline saw fall to ruin
        for (const t of tl.values()) {
            if (t[4] == null || ctx.idx.entries.has(`s:${t[0]},${t[1]}`)) continue;
            const e = add({
                id: `s:${t[0]},${t[1]}`, cat: 'place', kind: 'ruin', name: t[2] || 'A lost town', q: t[0], r: t[1],
                sub: `Ruins · abandoned ${Almanac.year(world, t[4])}`, day: t[3] != null ? t[3] : t[4], tlDay: t[3] != null ? t[3] : t[4],
            });
            if (!e) continue;
            nameOf(e.name, e.id);
            if (t[3] != null) line(e, t[3], `${e.name} was founded.`, '🏘️');
            line(e, t[4], `${e.name} was abandoned or fell to ruin.`, '🏚️');
        }
    },

    _era(world, s) {
        const st = TownEras.state(s);
        const h = _arr(st && st.history);
        if (!h.length) return null;
        const last = h[h.length - 1];
        return { id: last[0], year: last[1], label: Almanac.config().eras[last[0]] || `the ${last[0]} age` };
    },

    /** The heavier half of a town's page: its townsfolk annals and what it remembers of the House. */
    _placeMore(ctx, s, e) {
        const { C, world } = ctx;
        const sections = [];
        const folk = s.folk;
        // Its population over the years (the Timeline samples it: RealmTimeline.populationOf)
        const pops = _try(() => RealmTimeline.populationOf(world.timeline, e.q, e.r), []) || [];
        if (pops.length > 1) {
            const fmt = (n) => Math.round(n).toLocaleString('en-US');
            sections.push({
                title: 'Population over the years',
                pops: pops.map(p => ({ day: p.day, year: Almanac.year(world, p.day), pop: p.pop })),
                rows: pops.slice().reverse().map((p, i, list) => {
                    const prev = list[i + 1];
                    const delta = prev ? p.pop - prev.pop : 0;
                    return { day: p.day, year: Almanac.year(world, p.day), text: `${fmt(p.pop)} souls${prev && delta ? ` (${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))})` : ''}`, icon: delta > 0 ? '📈' : delta < 0 ? '📉' : '👥' };
                }),
            });
        }
        const mem = Almanac._memories(world, _arr(folk && folk.nm), 'the town');
        if (mem.length) sections.push({ title: 'What the town remembers of the House', rows: mem });
        const annals = _arr(folk && folk.annals).filter(x => x && x.k !== 'grown').slice(-C.caps.townAnnals * 2);
        const rows = [];
        for (const a of annals) {
            const text = _try(() => Townsfolk.annalText(folk, a, world));
            if (text) rows.push({ day: a.d, year: Almanac.year(world, a.d), text, icon: '·' });
        }
        if (rows.length) sections.push({ title: 'The talk of the town', rows: rows.slice(-C.caps.townAnnals).reverse() });
        const known = _arr(folk && folk.people).filter(p => p && p.mem && p.mem.timesSpoken > 0).length;
        if (known) sections.push({ title: 'Folk you know here', rows: [], links: [...ctx.idx.byCat.person].filter(p => p.home === e.id).map(p => p.id) });
        return sections;
    },

    /** Memory episodes (systems/npcMemory.js) as lines, strongest first. */
    _memories(world, eps, whom) {
        const kinds = _try(() => (DataLoader._gamedata && DataLoader._gamedata.npcMemory && DataLoader._gamedata.npcMemory.kinds) || {}, {}) || {};
        const C = Almanac.config();
        return [...eps].filter(ep => ep && ep.k).sort((a, b) => Math.abs(_num(b.w)) - Math.abs(_num(a.w))).slice(0, C.caps.memories).map(ep => {
            const def = kinds[ep.k] || {};
            const actor = `${ep.by || 'someone'}${ep.bh ? ` of ${ep.bh}` : ''}`;
            const vic = ep.vn ? `${ep.vr ? `${ep.vr} ` : ''}${ep.vn}` : whom;
            const label = def.label ? _fill(def.label, { actor, whom: vic }) : `${ep.k} (${actor})`;
            return { day: ep.d, year: Almanac.year(world, ep.d), text: `${_cap(label.trim())}${ep.g ? ` — a story told down ${ep.g} generation${ep.g === 1 ? '' : 's'}` : ''}.`, icon: _num(ep.w) >= 0 ? '💛' : '🖤' };
        });
    },

    // ── Houses ─────────────────────────────────────

    _houses(ctx) {
        const { C, world, player, add, line, link, nameOf } = ctx;
        const house = player && player.house;
        if (house) {
            const e = add({
                id: 'h:player', cat: 'house', kind: 'house', name: house.name || 'Your House', icon: (house.sigil && house.sigil.icon) || '🛡️',
                sub: `Your House · generation ${house.generation || 1}${house.motto ? ` · “${house.motto}”` : ''}`,
                day: _num(house.foundedDay, null), tlDay: _num(house.foundedDay, null),
            });
            if (e) {
                e.facts.push(['Generation', String(house.generation || 1)]);
                if (house.foundedDay != null) e.facts.push(['Founded', `the year ${Almanac.year(world, house.foundedDay)}`]);
                if (Number.isFinite(house.prestige)) e.facts.push(['Prestige', String(Math.round(house.prestige))]);
                if (house.motto) e.facts.push(['Motto', house.motto]);
                for (const h of _arr(house.history).slice(-C.caps.houseHistory)) if (h && h.text) line(e, h.day, h.text, h.battle ? '⚔️' : '📜');
                nameOf(e.name, e.id, true);
                const sur = String(e.name).replace(/^House\s+/i, '');
                if (sur !== e.name) nameOf(sur, e.id);
            }
        }
        for (const r of _try(() => RivalHouses.rivals(player), []) || []) {
            if (!r || !r.name) continue;
            const e = add({
                id: `h:rival:${r.kingdomId}`, cat: 'house', kind: 'rival', name: r.name,
                sub: `Rival House${r.seat && r.seat.name ? ` of ${r.seat.name}` : ''}${r.head ? ` · ${RivalHouses.headName(r)}` : ''}`,
            });
            if (!e) continue;
            nameOf(e.name, e.id, true);
            const k = _kingdom(world, r.kingdomId);
            if (k) { e.facts.push(['Realm', k.name]); link(e.id, `k:${k.id}`); }
            if (r.seat && r.seat.name) {
                e.facts.push(['Seat', r.seat.name]);
                if (Number.isFinite(r.seat.q)) { e.q = r.seat.q; e.r = r.seat.r; link(e.id, `s:${r.seat.q},${r.seat.r}`); }
            }
            e.facts.push(['Feud', String(Math.round(_num(r.feud)))]);
            if (Number.isFinite(r.renown)) e.facts.push(['Renown', String(Math.round(r.renown))]);
            if (r.stats && r.stats.heads > 1) e.facts.push(['Heads', String(r.stats.heads)]);
            for (const l of _arr(r.log)) if (l && l.text) line(e, l.day, l.text, '·');
            if (house) link(e.id, 'h:player');
        }
        for (const b of _arr(house && house.cadets)) {
            if (!b || !b.id || !b.name) continue;
            const e = add({
                id: `h:cadet:${b.id}`, cat: 'house', kind: 'cadet', name: b.name,
                sub: `Cadet branch${b.ended ? ' (ended)' : ''}${b.seat && b.seat.name ? ` · ${b.seat.name}` : ''}`,
                day: b.founded != null ? b.founded : null, tlDay: b.founded != null ? b.founded : null,
            });
            if (!e) continue;
            nameOf(e.name, e.id);
            if (b.founded != null) e.facts.push(['Founded', `the year ${Almanac.year(world, b.founded)}${b.founder ? `, by ${b.founder}` : ''}`]);
            if (!b.ended) e.facts.push(['Loyalty', `${Math.round(_num(b.loyalty))} · ${CadetBranches.loyaltyLabel(b.loyalty)}`]);
            if (b.seat && b.seat.name) {
                e.facts.push(['Seat', b.seat.name]);
                if (Number.isFinite(b.seat.q)) { e.q = b.seat.q; e.r = b.seat.r; link(e.id, `s:${b.seat.q},${b.seat.r}`); }
            }
            if (b.founded != null) line(e, b.founded, `${b.founder || 'A child of the House'} founded ${b.name}.`, '🌱');
            for (const l of _arr(b.log)) if (l && l.text) line(e, l.day, l.text, '·');
            link(e.id, 'h:player');
            if (b.parentId) link(e.id, `h:cadet:${b.parentId}`);
        }
    },

    // ── People ─────────────────────────────────────

    _lineage(ctx) {
        const { world, player, opts, add, link, nameOf } = ctx;
        if (!player || !player.house) return;
        const tree = DynastyTree.build(player, world, { npc: opts.npc });
        const kinds = ctx.C.kinds;
        for (const n of tree.nodes) {
            const role = n.current ? 'Head of the House' : n.ruler ? 'Ruler of the House' : n.kind === 'spouse' ? 'Wed into the House' : n.kind === 'parent' ? 'Parent of the founder' : n.cadet ? 'Of a cadet line' : 'Of the blood';
            const e = add({
                id: `p:dyn:${n.id}`, cat: 'person', kind: n.ruler ? 'ruler' : n.kind === 'spouse' ? 'spouse' : 'blood',
                icon: n.ruler ? kinds.ruler : n.kind === 'spouse' ? kinds.spouse : kinds.blood,
                name: `${n.name}${n.epithet ? ` ${n.epithet}` : ''}`,
                sub: `${role}${n.life ? ` · ${n.life}` : ''}${n.alive ? '' : ' †'}`,
                day: n.born != null ? n.born : null, tlDay: n.reign ? n.reign.from : (n.born != null ? n.born : null),
            });
            if (!e) continue;
            if (n.ruler) nameOf(n.name, e.id);
            if (n.life) e.facts.push(['Life', n.life]);
            if (n.reign) e.facts.push(['Reign', `${n.reign.fromYear}–${n.reign.toYear != null ? n.reign.toYear : 'now'}`]);
            if (n.titles.length) e.facts.push(['Titles', n.titles.join(', ')]);
            if (n.traits.length) e.facts.push(['Traits', n.traits.join(', ')]);
            if (n.cause) e.facts.push(['Died of', n.cause]);
            if (n.successionRank) e.facts.push(['In line', `#${n.successionRank}`]);
            if (n.origin && n.origin.house) e.facts.push(['Born of', n.origin.house]);
            if (n.origin && n.origin.kingdom) e.facts.push(['From', n.origin.kingdom]);
            link(e.id, 'h:player');
            for (const pid of n.parents) link(e.id, `p:dyn:${pid}`);
            for (const sid of n.spouses) link(e.id, `p:dyn:${sid}`);
            if (n.cadet) link(e.id, `h:cadet:${n.cadet}`);
            if (n.portrait && n.portrait.npcId != null) e.npcId = n.portrait.npcId;
            e.more = () => {
                const life = _try(() => DynastyTree.lifeSummary(player, world, n.id, { tree, npc: opts.npc }));
                const out = [];
                if (life && life.lines.length) out.push({ title: 'A life', rows: life.lines.map(l => ({ day: l.day, year: l.year, text: l.text, icon: '·' })) });
                if (life && life.deeds.length) out.push({ title: 'Deeds of the reign', facts: life.deeds.map(d => [d.label, String(d.value)]) });
                if (life && life.heirlooms.length) out.push({ title: 'Heirlooms', rows: life.heirlooms.map(h => ({ text: `${h.name}${h.holds ? ' (holds it)' : ' (bore it)'}`, icon: h.icon || '🗝️' })) });
                return out;
            };
        }
    },

    _npcEntry(ctx, npc, kind, extra = {}) {
        const { world, add, link } = ctx;
        if (!npc || npc.id == null) return null;
        const name = `${npc.firstName || npc.name || 'Someone'}${npc.dynasty ? ` ${npc.dynasty}` : (npc.lastName ? ` ${npc.lastName}` : '')}`;
        const e = add({
            id: `p:npc:${npc.id}`, cat: 'person', kind, name,
            sub: `${extra.role || _cap(npc.occupation || 'commoner')}${npc.settlementName ? ` · ${npc.settlementName}` : ''}${npc.isAlive === false ? ' †' : ''}`,
            npcId: npc.id,
        });
        if (!e) return null;
        if (npc.age != null) e.facts.push(['Age', String(Math.floor(_num(npc.age)))]);
        if (npc.occupation) e.facts.push(['Calling', _cap(npc.occupation)]);
        if (npc.settlementName) {
            e.facts.push(['Lives in', npc.settlementName]);
            const place = ctx.idx.names.get(String(npc.settlementName).toLowerCase());
            if (place) { link(e.id, place); e.home = place; }
        }
        const kid = npc.royal && npc.royal.kingdomId != null ? npc.royal.kingdomId : npc.kingdom;
        const k = _kingdom(world, kid);
        if (k) link(e.id, `k:${k.id}`);
        if (Array.isArray(npc.traits) && npc.traits.length) e.facts.push(['Traits', npc.traits.map(t => (t && (t.name || t.id)) || t).filter(x => typeof x === 'string').slice(0, 4).join(', ')]);
        return e;
    },

    _courtAndKnown(ctx) {
        const { C, player, opts, link } = ctx;
        if (!player || typeof opts.npc !== 'function') return;
        for (const c of _arr(player.house && player.house.court)) {
            const npc = _try(() => opts.npc(c.npcId));
            if (!npc) continue;
            const e = Almanac._npcEntry(ctx, npc, 'courtier', { role: `Courtier${c.office ? ` · ${c.office}` : ''}` });
            if (e) {
                if (c.since != null) e.facts.push(['At court since', `the year ${Almanac.year(ctx.world, c.since)}`]);
                if (c.loyalty != null) e.facts.push(['Loyalty', String(Math.round(_num(c.loyalty)))]);
                link(e.id, 'h:player');
            }
        }
        const known = typeof opts.known === 'function' ? _arr(_try(() => opts.known(player), [])) : [];
        for (const npc of known.slice(0, C.caps.npcs)) {
            const e = Almanac._npcEntry(ctx, npc, 'npc');
            const rel = e && player.relationships && player.relationships[npc.id];
            if (rel) e.facts.push(['Regard', `${Math.round(_num(rel.score))}${rel.romantic ? ' · romance' : ''}`]);
        }
    },

    _townsfolk(ctx) {
        const { C, world, add, link } = ctx;
        const list = _arr(_try(() => Townsfolk.acquaintances(world), [])).slice(0, C.caps.townsfolk);
        const views = new Map(_views(world).map(v => [v.s.name, v]));
        for (const a of list) {
            const p = a.person;
            const v = views.get(a.town);
            const at = v ? `${v.q},${v.r}` : a.town;
            const e = add({
                id: `p:tf:${at}:${p.id}`, cat: 'person', kind: 'townsfolk', name: `${p.first}${p.last ? ` ${p.last}` : ''}`,
                sub: `${_cap(_try(() => Townsfolk.roleTitle(p), 'townsfolk'))} of ${a.town}${a.status && a.status.kind === 'dead' ? ' †' : ''}`,
                day: p.born != null ? p.born : null,
            });
            if (!e) continue;
            if (a.status && a.status.text) e.facts.push(['Now', a.status.text]);
            if (a.spouse) e.facts.push(['Spouse', a.spouse]);
            if (a.kids && a.kids.length) e.facts.push(['Children', a.kids.join(', ')]);
            if (v) { link(e.id, `s:${at}`); e.home = `s:${at}`; e.q = v.q; e.r = v.r; }
            const lines = _arr(a.lines);
            const fam = a.family;
            const mem = Almanac._memories(world, _arr(p.nm), 'them');
            e.more = () => {
                const out = [];
                if (lines.length) out.push({ title: 'A life', rows: lines.slice(-C.caps.lines).map(t => ({ text: t, icon: '·' })) });
                if (fam) out.push({ title: 'Family', rows: [{ text: fam, icon: '🏠' }] });
                if (mem.length) out.push({ title: 'What they remember of the House', rows: mem });
                return out;
            };
        }
    },

    _lords(ctx) {
        const { world, add, link } = ctx;
        // The crowned heads (kingdom.ruler), where the realm's lord is someone else
        for (const k of _arr(world.kingdoms)) {
            if (!k || !k.ruler || k.isAlive === false || (k.lord && k.lord.name === k.ruler)) continue;
            const e = add({
                id: `p:king:${k.id}`, cat: 'person', kind: 'realm', name: k.ruler, sub: `Ruler of ${Names.realm(k.name)}`,
                q: k.capital ? k.capital.q : null, r: k.capital ? k.capital.r : null,
            });
            if (e) { link(e.id, `k:${k.id}`); ctx.nameOf(k.ruler, e.id); }
        }
        for (const k of _arr(world.kingdoms)) {
            const lord = k && k.lord;
            if (!lord || !lord.name || k.isAlive === false) continue;
            const e = add({
                id: `p:lord:${k.id}`, cat: 'person', kind: 'lord', name: lord.name,
                sub: `Lord of ${Names.realm(k.name)}${lord.age ? ` · aged ${lord.age}` : ''}`,
                q: k.capital ? k.capital.q : null, r: k.capital ? k.capital.r : null,
            });
            if (!e) continue;
            if (lord.age) e.facts.push(['Age', String(lord.age)]);
            if (Array.isArray(lord.traits) && lord.traits.length) e.facts.push(['Traits', lord.traits.map(t => (t && (t.name || t.id)) || t).filter(x => typeof x === 'string').join(', ')]);
            link(e.id, `k:${k.id}`);
            const mem = _arr(_try(() => NPCLords.memoryOf(lord, world.day), []));
            for (const m of mem.slice(0, Almanac.config().caps.memories)) {
                ctx.line(e, m.day, `Remembers ${m.label}${m.note ? ` (${m.note})` : ''}${m.inherited ? ', a wrong sworn to him by his father' : ''}.`, m.weight >= 0 ? '💛' : '🖤');
            }
        }
    },

    _rivalHeads(ctx) {
        const { world, player, add, link } = ctx;
        for (const r of _try(() => RivalHouses.rivals(player), []) || []) {
            if (!r || !r.head) continue;
            const h = r.head;
            const e = add({
                id: `p:rival:${r.kingdomId}`, cat: 'person', kind: 'rivalHead', name: RivalHouses.headName(r),
                sub: `Head of ${r.name}${h.age ? ` · aged ${h.age}` : ''}`,
            });
            if (!e) continue;
            if (h.age) e.facts.push(['Age', String(h.age)]);
            if (h.spouse && h.spouse.firstName) e.facts.push(['Spouse', h.spouse.firstName]);
            if (_arr(h.children).length) e.facts.push(['Children', h.children.map(c => c.firstName).filter(Boolean).join(', ')]);
            link(e.id, `h:rival:${r.kingdomId}`);
            const k = _kingdom(world, r.kingdomId);
            if (k) link(e.id, `k:${k.id}`);
        }
    },

    _cadetHeads(ctx) {
        const { player, add, link } = ctx;
        for (const b of _arr(player && player.house && player.house.cadets)) {
            if (!b || !b.head || b.ended) continue;
            const e = add({
                id: `p:cadet:${b.id}`, cat: 'person', kind: 'cadetHead', name: CadetBranches.headName(b),
                sub: `Head of ${b.name}${b.head.age ? ` · aged ${b.head.age}` : ''}`,
            });
            if (!e) continue;
            if (b.head.age) e.facts.push(['Age', String(b.head.age)]);
            link(e.id, `h:cadet:${b.id}`);
        }
    },

    _nemeses(ctx) {
        const { world, player, add, link, line } = ctx;
        if (!player) return;
        const one = (nm, live) => {
            const e = add({
                id: `p:nem:${nm.id}`, cat: 'person', kind: 'nemesis', name: nm.name || 'A nemesis',
                sub: `Nemesis${live ? '' : ' (the feud is over)'}${nm.origin && nm.origin.label ? ` · over ${nm.origin.label}` : ''}`,
                day: nm.bornDay != null ? nm.bornDay : null, tlDay: nm.bornDay != null ? nm.bornDay : null,
            });
            if (!e) return;
            const kd = _try(() => Nemesis.kindDef(nm.kind), null);
            if (kd && kd.label) e.facts.push(['Kind', kd.label]);
            if (live && Number.isFinite(nm.hatred)) e.facts.push(['Hatred', String(Math.round(nm.hatred))]);
            if (nm.generation > 1) e.facts.push(['Generation of the feud', String(nm.generation)]);
            const bearers = _arr(nm.bearers).map(b => (typeof b === 'string' ? b : b && b.name)).filter(Boolean);
            if (bearers.length) e.facts.push(['Borne before by', bearers.join(', ')]);
            if (nm.bornDay != null) line(e, nm.bornDay, `${nm.name} swore enmity against ${(nm.origin && nm.origin.against) || 'the House'}${nm.origin && nm.origin.label ? ` over ${nm.origin.label}` : ''}.`, '🩸');
            for (const a of _arr(nm.acts).slice(-10)) if (a && (a.text || a.label)) line(e, a.day, a.text || a.label, '🗡️');
            if (nm.ended && nm.ended.text) line(e, nm.ended.day, nm.ended.text, '🕊️');
            const ref = nm.ref || {};
            if (ref.kingdomId != null) {
                link(e.id, nm.kind === 'house' ? `h:rival:${ref.kingdomId}` : `p:lord:${ref.kingdomId}`);
                link(e.id, `k:${ref.kingdomId}`);
            }
            if (ref.folkRef) { const [at, pid] = String(ref.folkRef).split('#'); link(e.id, `p:tf:${at}:${pid}`); link(e.id, `s:${at}`); }
            link(e.id, 'h:player');
        };
        for (const nm of _arr(player.nemesis && player.nemesis.list)) if (nm && nm.id) one(nm, true);
        for (const nm of _arr(player.nemesis && player.nemesis.past)) if (nm && nm.id) one(nm, false);
    },

    // ── Wars and battles ───────────────────────────

    _wars(ctx) {
        const { C, world, add, link, line } = ctx;
        const st = _obj(world.timeline);
        const realmName = (code, day) => {
            const r = st && st.realms[code - 1];
            if (!r) return null;
            let m = r.m[0];
            for (const x of r.m) { if (x[0] <= day) m = x; else break; }
            return { id: r.id, name: m ? m[1] : 'a realm' };
        };
        const wars = [];
        if (st && Array.isArray(st.wars) && Array.isArray(st.realms)) {
            st.wars.forEach((w, i) => {
                const a = realmName(w[0], w[2]), b = realmName(w[1], w[2]);
                if (!a || !b) return;
                const v = w[4] ? realmName(w[4], w[3] != null ? w[3] : world.day) : null;
                wars.push({ id: `w:${i}`, a, b, from: w[2], to: w[3], victor: v });
            });
        } else {
            for (const w of _arr(world.warHistory)) {
                const ka = _kingdom(world, w.a), kb = _kingdom(world, w.b);
                if (!ka || !kb) continue;
                const v = _kingdom(world, w.victor);
                wars.push({ id: `w:h${w.id}`, a: { id: ka.id, name: ka.name }, b: { id: kb.id, name: kb.name }, from: null, to: w.day, victor: v ? { id: v.id, name: v.name } : null });
            }
        }
        for (const w of wars) {
            const fy = Almanac.year(world, w.from), ty = w.to != null ? Almanac.year(world, w.to) : null;
            const span = fy != null ? (ty == null ? `${fy}–` : fy === ty ? `${fy}` : `${fy}–${ty}`) : (ty != null ? `ended ${ty}` : '');
            const e = add({
                id: w.id, cat: 'war', kind: 'war', name: `War of ${w.a.name} and ${w.b.name}${span ? ` (${span})` : ''}`,
                sub: w.to == null ? 'Still fought' : w.victor ? `Won by ${w.victor.name}` : 'Ended without a victor',
                day: w.from != null ? w.from : w.to, tlDay: w.from != null ? w.from : w.to,
            });
            if (!e) continue;
            e.span = { from: w.from, to: w.to, a: w.a.id, b: w.b.id };
            e.facts.push(['Sides', `${w.a.name} against ${w.b.name}`]);
            if (w.victor) e.facts.push(['Victor', w.victor.name]);
            if (w.from != null) line(e, w.from, `${w.a.name} and ${w.b.name} went to war.`, '🔥');
            if (w.to != null) line(e, w.to, `The war ended${w.victor ? `, won by ${w.victor.name}` : ''}.`, '🕊️');
            link(e.id, `k:${w.a.id}`);
            link(e.id, `k:${w.b.id}`);
        }
        // Battles, sieges, towns taken — and the realms' crowns and successions go to the realms' pages
        const places = ctx.idx.byCat.place || [];
        const nearest = (q, r) => {
            let best = null, bd = Infinity;
            for (const p of places) {
                if (!Number.isFinite(p.q)) continue;
                const d = Hex.wrappingDistance(p.q, p.r, q, r, _num(world.width, 1));
                if (d < bd) { bd = d; best = p; }
            }
            return bd <= 6 ? best : null;
        };
        const I = { battle: 'Battle', siege: 'Siege', taken: 'Taking' };
        const warEntries = (ctx.idx.byCat.war || []).filter(x => x.span);
        _arr(st && st.events).forEach((ev, i) => {
            const [day, kind, q, r, text] = ev;
            if (!C.battleKinds.includes(kind)) {
                // (rise and fall, and each succession, the realm's own record already tells: one line, not two)
                if (kind === 'rise' || kind === 'fall' || kind === 'succession') return;
                // (a realm's crown, succession, rise or fall: on the realm's page by its name)
                for (const id of Almanac._namedIn(ctx.idx, text)) { const re = ctx.idx.entries.get(id); if (re && re.cat === 'realm') line(re, day, text, '•'); }
                return;
            }
            const near = Number.isFinite(q) ? nearest(q, r) : null;
            const e = add({
                id: `b:${i}`, cat: 'war', kind, name: `${I[kind] || 'Battle'} ${kind === 'battle' ? 'near' : 'of'} ${near ? near.name : 'the field'} (${Almanac.year(world, day)})`,
                sub: String(text || ''), day, tlDay: day, q: Number.isFinite(q) ? q : null, r: Number.isFinite(r) ? r : null,
            });
            if (!e) return;
            line(e, day, text, ctx.C.kinds[kind] || '⚔️');
            if (ev[6] > 1) e.facts.push(['Engagements', String(ev[6])]);
            if (near) { link(e.id, near.id); line(near, day, text, ctx.C.kinds[kind] || '⚔️'); }
            const named = Almanac._namedIn(ctx.idx, text).map(id => ctx.idx.entries.get(id)).filter(x => x && x.cat === 'realm');
            for (const w of warEntries) {
                if (day < _num(w.span.from, -Infinity) || day > _num(w.span.to, Infinity)) continue;
                const ids = named.map(x => x.id);
                if (ids.includes(`k:${w.span.a}`) && ids.includes(`k:${w.span.b}`)) { link(e.id, w.id); line(w, day, text, ctx.C.kinds[kind] || '⚔️'); }
            }
        });
        // The House's own battles (House.recordBattle)
        const hist = _arr(ctx.player && ctx.player.house && ctx.player.house.history);
        hist.forEach((h, i) => {
            if (!h || !h.battle || !h.text) return;
            const b = h.battle;
            const e = add({
                id: `b:h${h.day}_${i}`, cat: 'war', kind: 'battle', name: `${b.kind === 'sea' ? 'Sea battle' : b.kind === 'assault' ? 'Assault' : 'Battle'}${b.place ? ` at ${b.place}` : ''} (${Almanac.year(world, h.day)})`,
                sub: `${b.outcome === 'victory' ? 'A victory' : b.outcome === 'defeat' ? 'A defeat' : 'A battle'} of the House${b.foe ? ` against ${b.foe}` : ''}`,
                day: h.day, tlDay: h.day,
            });
            if (!e) return;
            if (b.foe) e.facts.push(['Foe', b.foe]);
            if (b.outcome) e.facts.push(['Outcome', _cap(b.outcome)]);
            line(e, h.day, h.text, '⚔️');
            link(e.id, 'h:player');
            const place = b.place ? ctx.idx.names.get(String(b.place).toLowerCase()) : null;
            if (place) { link(e.id, place); const p = ctx.idx.entries.get(place); if (p && Number.isFinite(p.q)) { e.q = p.q; e.r = p.r; } }
        });
    },

    // ── Ages: crises and climate ───────────────────

    _ages(ctx) {
        const { world, add, line, nameOf } = ctx;
        const Y = Seasons.DAYS_PER_YEAR;
        const base = _num(world.baseYear, 1);
        const crises = new Map([...Crises.history(world), ...(Crises.active(world) ? [Crises.active(world)] : [])].filter(Boolean).map(c => [`age_${c.uid}`, c]));
        const chapters = [
            ...(_arr(_try(() => Crises.annalChapters(world), []))),
            ...(_arr(_try(() => Climate.annalChapters(world), []))),
        ];
        for (const ch of chapters) {
            const c = crises.get(ch.id);
            const from = c ? c.startDay : (ch.fromYear != null ? (ch.fromYear - base) * Y + 1 : null);
            const e = add({
                id: `a:${ch.id}`, cat: 'age', kind: ch.kind === 'climate' ? 'climate' : 'crisis', icon: ch.icon,
                name: String(ch.title || '').split(',')[0] || 'An age',
                sub: `${ch.kind === 'climate' ? 'A change in the weather' : _cap(ch.kind || 'crisis')} · ${ch.live ? `${ch.fromYear} to the present` : `${ch.fromYear}–${ch.toYear}`}${ch.outcome ? ` · ${ch.outcome}` : ''}`,
                day: from, tlDay: from,
                q: c && c.place ? c.place.q : null, r: c && c.place ? c.place.r : null,
            });
            if (!e) continue;
            nameOf(c ? c.name : null, e.id);
            if (ch.outcome) e.facts.push(['Outcome', _cap(ch.outcome)]);
            for (const p of _arr(ch.paragraphs)) line(e, p.year != null ? (p.year - base) * Y + 1 : null, p.text, '·');
        }
    },

    // ── Great works ────────────────────────────────

    _works(ctx) {
        const { world, add, link, line } = ctx;
        for (const b of _arr(world.greatWorks && world.greatWorks.built)) {
            if (!b || !b.uid) continue;
            const k = _kingdom(world, b.kingdomId);
            const e = add({
                id: `g:${b.uid}`, cat: 'work', kind: 'work', icon: b.icon || '🏛️', name: b.name || 'A great work',
                sub: `${b.settlementName ? `At ${b.settlementName} · ` : ''}raised ${Almanac.year(world, b.day)}${b.owner === 'player' ? ' by your House' : k ? ` by ${Names.realm(k.name)}` : ''}`,
                day: b.day, tlDay: b.day, q: Number.isFinite(b.q) ? b.q : null, r: Number.isFinite(b.r) ? b.r : null,
            });
            if (!e) continue;
            if (b.settlementName) e.facts.push(['Place', b.settlementName]);
            e.facts.push(['Raised', `the year ${Almanac.year(world, b.day)}`]);
            line(e, b.day, `The ${b.name || 'great work'} was raised${b.settlementName ? ` at ${b.settlementName}` : ''}.`, b.icon || '🏛️');
            if (Number.isFinite(b.q)) link(e.id, `s:${b.q},${b.r}`);
            if (b.owner === 'player') link(e.id, 'h:player');
            else if (k) link(e.id, `k:${k.id}`);
        }
        // The public works: roads, bridges, canals (systems/publicWorks.js)
        const places = (ctx.idx.byCat.place || []).filter(p => Number.isFinite(p.q));
        const STATUS = { building: 'being built', stalled: 'stalled', done: 'finished', abandoned: 'abandoned' };
        for (const w of _arr(_try(() => PublicWorks.works(world), []))) {
            if (!w || w.id == null) continue;
            const q = Number.isFinite(w.tq) ? w.tq : (Number.isFinite(w.q) ? w.q : null);
            const r = Number.isFinite(w.tr) ? w.tr : (Number.isFinite(w.r) ? w.r : null);
            let near = null, bd = Infinity;
            if (q != null) for (const p of places) { const d = Hex.wrappingDistance(p.q, p.r, q, r, _num(world.width, 1)); if (d < bd) { bd = d; near = p; } }
            if (bd > 6) near = null;
            const k = _kingdom(world, w.kid);
            const when = w.done != null ? w.done : w.started;
            const e = add({
                id: `pw:${w.id}`, cat: 'work', kind: 'work', icon: w.icon || '🛤️', name: w.name || _cap(String(w.kind || 'a public work').replace(/_/g, ' ')),
                sub: `${_cap(String(w.kind || 'public work').replace(/_/g, ' '))}${near ? ` near ${near.name}` : ''} · ${STATUS[w.status] || w.status || ''}${w.owner === 'player' ? ' · your House\'s' : k ? ` · ${k.name}` : ''}`,
                day: when != null ? when : null, tlDay: when != null ? when : null, q, r,
            });
            if (!e) continue;
            e.facts.push(['Kind', _cap(String(w.kind || 'public work').replace(/_/g, ' '))]);
            if (w.status) e.facts.push(['State', _cap(STATUS[w.status] || w.status)]);
            if (w.toll) e.facts.push(['Toll', 'tolled']);
            if (w.started != null) line(e, w.started, `Work began on the ${w.name || 'work'}.`, '🛠️');
            if (w.done != null) line(e, w.done, `The ${w.name || 'work'} was finished.`, w.icon || '🛤️');
            if (near) link(e.id, near.id);
            if (w.owner === 'player') link(e.id, 'h:player');
            if (k) link(e.id, `k:${k.id}`);
        }
    },

    // ── Reading ────────────────────────────────────

    get(idx, id) {
        return (idx && idx.entries.get(id)) || null;
    },

    /** Entries matching every word of the query (names first), at most `limit`. opts { cat, limit }. */
    search(idx, query, opts = {}) {
        if (!idx) return [];
        const C = Almanac.config();
        const limit = _num(opts.limit, C.caps.search);
        const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
        const pool = opts.cat ? _arr(idx.byCat[opts.cat]) : [...idx.entries.values()];
        if (!words.length) return pool.slice(0, limit);
        const scored = [];
        for (const e of pool) {
            const name = e.name.toLowerCase();
            let score = 0, ok = true;
            for (const w of words) {
                if (name.startsWith(w)) score += 4;
                else if (name.includes(` ${w}`)) score += 3;
                else if (name.includes(w)) score += 2;
                else if (e.search.includes(w)) score += 1;
                else { ok = false; break; }
            }
            if (ok) scored.push([score, e]);
        }
        scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
        return scored.slice(0, limit).map(x => x[1]);
    },

    /** How many entries each category holds. */
    counts(idx) {
        const out = {};
        for (const c of Almanac.config().cats) out[c.id] = _arr(idx && idx.byCat[c.id]).length;
        return out;
    },

    /** The text cut into plain runs and runs that name an entry: [{ text, id? }]. */
    mentions(idx, text, selfId = null) {
        const s = String(text == null ? '' : text);
        if (!idx || !idx.re || !s) return [{ text: s }];
        const out = [];
        let at = 0, m;
        idx.re.lastIndex = 0;
        while ((m = idx.re.exec(s))) {
            const id = idx.names.get(m[1].toLowerCase());
            if (!id || id === selfId) continue;
            if (m.index > at) out.push({ text: s.slice(at, m.index) });
            out.push({ text: m[1], id });
            at = m.index + m[1].length;
        }
        if (at < s.length) out.push({ text: s.slice(at) });
        return out;
    },

    /**
     * An entry's page: { entry, facts, lines, sections (the heavier, made now),
     * related: { cat: [entry] } }. null for an unknown id.
     */
    page(idx, id) {
        const e = Almanac.get(idx, id);
        if (!e) return null;
        let sections = [];
        if (typeof e.more === 'function') sections = _arr(_try(() => e.more(), []));
        const related = {};
        const extra = new Set();
        for (const s of sections) for (const l of _arr(s.links)) extra.add(l);
        for (const lid of [...e.links, ...extra]) {
            const x = idx.entries.get(lid);
            if (!x || x.id === e.id) continue;
            (related[x.cat] || (related[x.cat] = [])).push(x);
        }
        for (const list of Object.values(related)) list.sort((a, b) => _num(a.day, Infinity) - _num(b.day, Infinity) || a.name.localeCompare(b.name));
        return { entry: e, facts: e.facts, lines: e.lines, sections, related };
    },
};
