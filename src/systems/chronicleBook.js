// ============================================
// THE CHRONICLE BOOK — the Annals as an illustrated book, as plain data
// ============================================
// compose(player, world, opts) gathers everything the exported book shows
// (ui/chronicleBook.js renders it to one self-contained HTML file):
//   - the Annals (systems/annals.js): title, the House, one chapter per ruler
//     with the scribe's prose, the Legacy, the books of lines before;
//   - per reign: the ruler's look (for a portrait), the map of the realm at
//     the reign's end (systems/chronicleMaps.js keeps them as the game runs;
//     the living reign gets today's), and its key moments — wars and battles,
//     great works, deaths;
//   - the atlas: every map in the order taken;
//   - the dynasty tree: the line of rulers with spouses and children — from
//     the House's lineage (systems/dynastyTree.js build) where it keeps one,
//     else the rulers' notes (systems/chronicleMaps.js), or opts.tree;
//   - the appendix: Deeds & Records (systems/deeds.js) lifetime tallies, the
//     Ledger's last year (systems/ledger.js), the purse's curve, the score.
// Read-only (beyond the state backfills the Annals and the maps already
// make). Draws no RNG.

import { Seasons } from '../world/seasons.js';
import { ChronicleMaps } from './chronicleMaps.js';
import { Annals } from './annals.js';
import { Legacy } from './legacy.js';
import { Deeds } from './deeds.js';
import { Ledger } from './ledger.js';
import { DynastyTree } from './dynastyTree.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _first = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export const ChronicleBook = {
    /**
     * A reign's key moments: { battles: [{ day, year, text, place?, foe?,
     * outcome?, battleKind? }], works, deaths }.
     * The chronicle's lines (and those filed when the reign closed, which
     * outlive the chronicle's cap) told as the Annals tell them, the great
     * works the House raised, and the ruler's own death.
     */
    moments(player, world, reign) {
        const C = ChronicleMaps.config();
        const cap = Math.max(1, _num(C.momentCap, 10));
        const out = { battles: [], works: [], deaths: [] };
        if (!reign) return out;
        const house = (player && player.house) || {};
        const st = _obj(house.chronicleBook) || {};
        const filed = _arr(_obj(st.moments) && st.moments[ChronicleMaps.reignId(reign)]);
        const seen = new Set();
        const push = (kind, day, text, battle = null) => {
            const t = String(text || '').trim();
            const key = `${_num(day)}:${t}`;
            if (!t || !out[kind] || seen.has(key)) return;
            seen.add(key);
            const m = { day: _num(day), year: ChronicleMaps.year(world, day), text: t };
            // A battle House.recordBattle chronicled: its place, foe and outcome as data too
            const b = _obj(battle);
            if (b) Object.assign(m, { place: b.place || null, foe: b.foe || null, outcome: b.outcome || null, battleKind: b.kind || null });
            out[kind].push(m);
        };
        // The chronicle's lines, cleaned and put in the past as the Annals do
        // (filed lines first: a shim House holding them alone)
        const ctx = { archived: true, index: 0, prevReign: null };
        const told = (h) => Annals._events({ house: { history: h } }, world, { ...reign, live: false, highlights: [] }, ctx);
        const live = { ...reign, live: !!reign.live, highlights: [] };
        const fromHistory = Annals._events({ house: { history: _arr(house.history) } }, world, live, ctx);
        for (const e of [...(filed.length ? told(filed) : []), ...fromHistory]) {
            const kind = ChronicleMaps.classify({ tags: e.tags, text: e.text });
            if (kind) push(kind, e.day, e.text, e.battle);
        }
        // Deaths the chronicle keeps apart from its events (a line's end)
        const from = _num(reign.startDay), to = reign.live ? Infinity : _num(reign.endDay, Infinity);
        for (const b of _arr(world && world.greatWorks && world.greatWorks.built)) {
            if (!b || b.owner !== 'player' || _num(b.day) < from || _num(b.day) > to) continue;
            push('works', b.day, `The ${b.name || 'great work'} was raised${b.settlementName ? ` at ${b.settlementName}` : ''}.`);
        }
        if (!reign.live && reign.name && reign.abdicated) {
            // Stepped down while alive; their death later, if it has come (systems/abdication.js)
            push('deaths', reign.endDay, `${reign.name} ${reign.abdicated.how === 'forced' ? 'was made to set down the seat' : 'set down the seat'}${reign.endAge ? `, aged ${reign.endAge}` : ''}.`);
            const ed = reign.elderDeath;
            if (ed) push('deaths', ed.day, `${reign.name} died in retirement${ed.cause ? ` of ${ed.cause}` : ''}${ed.age ? `, aged ${ed.age}` : ''}.`);
        } else if (!reign.live && reign.name) {
            push('deaths', reign.endDay, `${reign.name} died${reign.cause ? ` of ${reign.cause}` : ''}${reign.endAge ? `, aged ${reign.endAge}` : ''}.`);
        }
        for (const k of Object.keys(out)) {
            out[k].sort((a, b) => a.day - b.day);
            out[k] = ChronicleMaps.spread(out[k], cap);
        }
        return out;
    },

    /**
     * The line of rulers, generation by generation: { line: [{ id, name,
     * epithet, from, to, live, spouse, children: [{ name, alive, born,
     * ruled }] }] }. From the rulers' notes (systems/chronicleMaps.js); the
     * living ruler as now.
     */
    tree(player, world, chapters, opts = {}) {
        const st = _obj(player && player.house && player.house.chronicleBook) || {};
        const rulers = _obj(st.rulers) || {};
        const line = chapters.map((c, i) => {
            const note = c.live && player ? ChronicleMaps.rulerNote(player, world, { spouseName: opts.spouseName }) : (_obj(rulers[c.id]) || {});
            const next = chapters[i + 1];
            const heir = next ? _first(next.ruler) : null;
            const children = _arr(note.children).map(k => ({
                name: k.name, born: k.born, alive: k.alive !== false, ruled: !!(heir && _first(k.name) === heir),
            }));
            // (the heir born after the last note: still the next in the line)
            if (heir && !children.some(k => k.ruled)) children.push({ name: next.ruler, born: null, alive: true, ruled: true });
            return { id: c.id, name: c.ruler, epithet: c.epithet || '', from: c.fromYear, to: c.toYear, live: !!c.live, spouse: note.spouse || null, children };
        });
        return { line };
    },

    /**
     * The House's lineage (systems/dynastyTree.js build: nodes, rulers) in
     * the book's shape — the rulers in order, each with spouses and children,
     * the one who took the seat marked. Null when it knows no rulers.
     */
    fromLineage(t, chapters = []) {
        const nodes = _arr(t && t.nodes);
        const rulers = _arr(t && t.rulers);
        if (!nodes.length || !rulers.length) return null;
        const byId = new Map(nodes.map(n => [n.id, n]));
        const line = rulers.map((id, i) => {
            const n = byId.get(id);
            if (!n) return null;
            const ch = chapters[i] || null;
            const kids = nodes.filter(k => _arr(k.parents).includes(id) && k.kind !== 'spouse');
            return {
                id: (ch && ch.id) || String(id), name: n.name, epithet: n.epithet || (ch && ch.epithet) || '',
                from: n.reign ? n.reign.fromYear : (ch && ch.fromYear), to: n.reign && n.reign.toYear != null ? n.reign.toYear : (ch ? ch.toYear : null),
                live: !!n.current, spouse: _arr(n.spouses).map(sid => (byId.get(sid) || {}).name).filter(Boolean).join(', ') || null,
                children: kids.map(k => ({ name: k.name, born: k.bornYear, alive: !!k.alive, ruled: !!k.ruler })),
            };
        }).filter(Boolean);
        return line.length ? { line, source: 'lineage' } : null;
    },

    /** The lineage tree when the House keeps one (read-only build; never throws). */
    _lineage(player, world, chapters, opts) {
        if (!player || !player.house || !player.house.lineage) return null;
        try {
            return ChronicleBook.fromLineage(DynastyTree.build(player, world, { npc: opts.npc }), chapters);
        } catch (e) {
            return null;
        }
    },

    /**
     * Everything the illustrated book shows, as plain data. opts: {
     * spouseName (the living spouse, the UI's to look up), tree (a ready
     * tree in tree()'s shape), liveMap (false: no map of today) }.
     */
    compose(player, world, opts = {}) {
        const annals = Annals.compose(player, world, { spouseName: opts.spouseName || null });
        const house = (player && player.house) || null;
        const st = house ? ChronicleMaps.state(house) : { maps: [], rulers: {}, moments: {} };
        const day = _num(world && world.day);
        const C = ChronicleMaps.config();
        const year = ChronicleMaps.year(world, day);
        const described = house ? Legacy.describe(player, world) : null;
        const reigns = described ? described.reigns : [];
        const today = opts.liveMap === false ? null
            : ChronicleMaps.snapshot(world, player, { kind: 'final', label: String(C.labels.final || '').replace('{year}', year) });
        const maps = st.maps.slice();

        const sections = annals.chapters.map((ch, i) => {
            const reign = reigns.find(r => ChronicleMaps.reignId(r) === ch.id) || null;
            const closed = !ch.live;
            let map = null;
            if (closed) {
                map = maps.find(m => m.reign === ch.id) || null;
                if (!map && reign) {
                    // (no map of the very day: the last one taken in the reign)
                    const inReign = maps.filter(m => m.day >= _num(reign.startDay) && m.day <= _num(reign.endDay, day) + 2);
                    map = inReign[inReign.length - 1] || null;
                }
                // (the deathbed: the reign just ended, today's map is its end)
                if (!map && i === annals.chapters.length - 1) map = today;
            } else map = today;
            const note = ch.live && player ? ChronicleMaps.rulerNote(player, world, { spouseName: opts.spouseName }) : _obj(st.rulers[ch.id]);
            const r = reign ? { ...reign, live: !!ch.live } : { name: ch.ruler, generation: ch.generation, startDay: 0, live: !!ch.live };
            if (closed && reign && reign.endDay == null) { r.endDay = day; r.cause = r.cause || null; }
            return {
                index: i, id: ch.id, chapter: ch, map,
                ruler: { name: ch.ruler, epithet: ch.epithet || '', gender: (note && note.gender) || (reign && reign.gender) || null, appearance: note ? note.appearance || null : null },
                from: ch.fromYear, to: ch.toYear, years: reign ? Math.round(_num(reign.years)) : null,
                cause: (reign && reign.cause) || null, live: !!ch.live,
                moments: ChronicleBook.moments(player, world, r),
            };
        });

        // The atlas: every map in the order taken, and today's
        const atlas = maps.slice();
        if (today && (!atlas.length || atlas[atlas.length - 1].day !== today.day)) atlas.push(today);

        const deeds = player ? Deeds.sections(player, world).filter(s => !s.empty).map(s => ({
            id: s.id, title: s.title, icon: s.icon,
            rows: s.rows.filter(r => r.lifetime).map(r => ({ label: r.label, value: r.lifetime, current: !!r.current })),
        })).filter(s => s.rows.length) : [];
        const score = house ? Legacy.score(player, world) : 0;
        const rank = Legacy.rank(score);
        const ended = house && _obj(house.ended);

        return {
            title: annals.title,
            house: annals.house || { name: (player && player.name) || 'A Stranger', motto: '', sigil: {}, generation: 1 },
            houseId: (house && (house.id || house.name)) || null,
            day, year,
            epitaph: ended ? (Legacy.epitaph(player, world) || {}).line || '' : '',
            foundedYear: house ? ChronicleMaps.year(world, _num(house.foundedDay, 1)) : null,
            ended: ended ? { ...ended, year: ChronicleMaps.year(world, ended.day) } : null,
            annals, sections, atlas,
            // The age's crises, each its own chapter (systems/crises.js via the annals)
            ages: _arr(annals.ages).map(a => ({ id: a.id, kind: a.kind, icon: a.icon || '', title: a.title, fromYear: a.fromYear, toYear: a.toYear, live: !!a.live, paragraphs: _arr(a.paragraphs).map(p => ({ text: p.text })) })),
            tree: opts.tree || ChronicleBook._lineage(player, world, annals.chapters, opts) || ChronicleBook.tree(player, world, annals.chapters, opts),
            momentTitles: Object.fromEntries(Object.entries(C.moments).map(([k, v]) => [k, { title: v.title, icon: v.icon }])),
            appendix: {
                generations: annals.chapters.length,
                years: Math.round(reigns.reduce((s, x) => s + _num(x.years), 0)),
                prestige: house ? Math.round(_num(house.prestige)) : 0,
                score, rank: rank.label || '', rankIcon: rank.icon || '',
                gold: Math.round(_num(player && player.gold)),
                deeds,
                ledger: player ? Ledger.statement(player, world, Seasons.DAYS_PER_YEAR) : null,
                wealth: house ? _arr(house.wealthMarks).map(m => ({ day: m.day, year: ChronicleMaps.year(world, m.day), gold: m.gold })) : [],
            },
        };
    },
};
