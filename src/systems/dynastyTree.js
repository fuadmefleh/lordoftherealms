// ============================================
// DYNASTY TREE — every generation of the House, as people
// ============================================
// The player object becomes the heir at each succession
// (Relationships.succeedAsHeir overwrites it), so the people of earlier
// generations would be lost but for the reign records. This module keeps the
// lineage: player.house.lineage = { people: { id: person }, rulerOf: { gen: id },
// currentId } — the rulers, their spouses (linked to the Houses and realms they
// came from), their children and the siblings left after each succession (the
// cadet lines that wed out), the founder's parents when the player was born to
// a family, regents, titles held, traits, life dates and causes of death.
//
//   DynastyTree.sync(player, world, { npc })   — daily (ui/game/endDay.js) and
//                                                before a succession: refresh
//                                                the living from the player
//   DynastyTree.onSuccession(player, world, ctx) — the heir takes the seat
//   DynastyTree.build(player, world, opts)     — PURE: { house, nodes, edges,
//                                                succession, rulers, regents,
//                                                layout } for the tree panel and
//                                                the chronicle book
//   DynastyTree.lifeSummary(player, world, id) — one person's life, as lines
//
// `opts.npc` is a lookup (id → NPC) the caller passes (Relationships.getNPC),
// so this module needs nothing from the relationships system. No randomness,
// no import-time side effects. Saved with the House (House.serialize).

import { DataLoader } from '../core/dataLoader.js';
import { Traits } from './traits.js';
import { Heirlooms } from './heirlooms.js';

const ROLE_LABEL = { steward: 'Steward of the House', marshal: 'Marshal of the House', chancellor: 'Chancellor of the House', spymaster: 'Spymaster of the House' };
const TITLE_CAP = 8;

function _num(v, d = 0) {
    return typeof v === 'number' && isFinite(v) ? v : d;
}

function _day(world) {
    return _num(world && world.day);
}

function _dpy() {
    const rel = (typeof DataLoader !== 'undefined' && DataLoader.relationships) || null;
    return _num(rel && rel.heirSettings && rel.heirSettings.daysPerYear) || 120;
}

function _first(name) {
    return String(name || '').split(' ')[0] || '';
}

function _kingdomName(world, kid) {
    if (kid == null || !world || typeof world.getKingdom !== 'function') return null;
    const k = world.getKingdom(kid);
    return k ? k.name : null;
}

function _blank(o) {
    return {
        id: o.id, name: '', first: '', gender: null, kind: 'blood', generation: 1,
        born: null, died: null, cause: null, alive: true,
        parents: [], spouses: [], traits: [], titles: [], epithet: '',
        reign: null, regent: null, npcId: null, origin: null, appearance: null,
        branch: null, sibling: false, placement: null,
        ...o,
    };
}

function _addTitle(rec, t) {
    if (!t || typeof t !== 'string') return;
    if (/^(Heir of|Son of|Daughter of|Child of)\b/.test(t)) return;
    if (!rec.titles.includes(t)) rec.titles.push(t);
    if (rec.titles.length > TITLE_CAP) rec.titles = rec.titles.slice(-TITLE_CAP);
}

function _link(list, id) {
    if (id && !list.includes(id)) list.push(id);
}

export const DynastyTree = {
    /** Year of a day, as the Annals reckon it (world.baseYear + whole years). */
    year(world, day) {
        if (day == null) return null;
        const base = _num(world && world.baseYear, 1);
        // (days before the chronicle began — a founder's birth — count back into earlier years)
        // (day 0 is the chronicle's first day, as before)
        const d = Math.floor(_num(day, 1)) || 1;
        return base + Math.floor((d - 1) / _dpy());
    },

    /** The lineage book (backfilled from the reign records for old saves). Null without a House. */
    ensure(player, world) {
        const house = player && player.house;
        if (!house) return null;
        let L = house.lineage;
        if (!L || typeof L !== 'object' || !L.people || typeof L.people !== 'object') {
            L = house.lineage = { v: 1, people: {}, rulerOf: {}, currentId: null };
        }
        if (!L.rulerOf || typeof L.rulerOf !== 'object') L.rulerOf = {};
        if (!L.currentId) {
            const gen = house.generation || 1;
            const Y = _dpy();
            // Earlier rulers known only from the House Chronicle: one person each
            let prev = null;
            (house.reigns || []).forEach((r, i) => {
                const g = r.generation || i + 1;
                if (g >= gen) return;
                const rid = `ruler_g${g}`;
                if (!L.people[rid]) {
                    L.people[rid] = _blank({
                        id: rid, name: r.name || 'A Ruler', first: _first(r.name), gender: r.gender || null, kind: 'ruler', generation: g,
                        parents: prev ? [prev] : [], born: _num(r.startDay) - Math.round(_num(r.startAge) * Y), died: _num(r.endDay), cause: r.cause || null,
                        alive: false, epithet: r.epithet || '', reign: { from: _num(r.startDay), to: _num(r.endDay), gen: g },
                    });
                    if (r.title) _addTitle(L.people[rid], r.title);
                    if (r.crown) _addTitle(L.people[rid], `Crown of ${r.crown}`);
                }
                L.rulerOf[g] = rid;
                prev = rid;
            });
            const id = `ruler_g${gen}`;
            L.currentId = id;
            L.rulerOf[gen] = id;
            if (!L.people[id]) L.people[id] = _blank({ id, name: player.name || 'The Founder', first: player.firstName || _first(player.name), kind: 'ruler', generation: gen, parents: prev ? [prev] : [] });
        }
        return L;
    },

    /** A person from an NPC of the world (a spouse, a parent): name, dates, the House and realm they came from. */
    _npcPerson(L, world, npc, npcId, o = {}) {
        const id = o.id || `npc_${npcId}`;
        const rec = L.people[id] || (L.people[id] = _blank({ id, kind: o.kind || 'spouse', generation: o.generation || 1 }));
        rec.npcId = npcId;
        if (npc) {
            rec.name = `${npc.firstName || ''} ${npc.dynasty || ''}`.trim() || rec.name;
            rec.first = npc.firstName || rec.first;
            rec.gender = npc.gender || rec.gender;
            if (rec.born == null && npc.age != null) rec.born = _day(world) - Math.round(_num(npc.age) * _dpy());
            rec.alive = npc.isAlive !== false;
            if (!rec.alive && rec.died == null) rec.died = _num(npc.deathDay, _day(world));
            if (npc.deathCause) rec.cause = npc.deathCause;
            const kid = npc.royal && npc.royal.kingdomId != null ? npc.royal.kingdomId : (npc.kingdom != null ? npc.kingdom : npc.kingdomId);
            rec.origin = {
                house: (npc.royal && npc.royal.dynasty) || npc.dynasty || null,
                kingdom: _kingdomName(world, kid) || (npc.settlementName ? null : null),
                town: npc.settlementName || null,
                royal: !!npc.royal, noble: !!npc.noble,
            };
            if (Array.isArray(npc.traits)) rec.traits = npc.traits.map(t => (t && (t.name || t.id)) || (typeof t === 'string' ? t : null)).filter(Boolean).slice(0, 4);
        }
        return rec;
    },

    /**
     * Refresh the living from the player: the ruler, their spouse, their
     * children and siblings. opts.npc: id → NPC lookup. Returns the lineage.
     */
    sync(player, world, opts = {}) {
        const L = DynastyTree.ensure(player, world);
        if (!L) return null;
        const house = player.house;
        const day = _day(world);
        const Y = _dpy();
        const gen = house.generation || 1;
        const npcOf = typeof opts.npc === 'function' ? opts.npc : () => null;

        // The ruler
        const me = L.people[L.currentId] || (L.people[L.currentId] = _blank({ id: L.currentId, kind: 'ruler', generation: gen }));
        me.kind = 'ruler';
        me.generation = gen;
        me.name = player.name || me.name;
        me.first = player.firstName || _first(player.name) || me.first;
        me.gender = player.gender || me.gender;
        if (me.born == null) me.born = day - Math.round(_num(player.age) * Y);
        me.traits = Traits.getEarned(player).map(id => (Traits.TRAITS[id] || {}).name).filter(Boolean);
        if (player.currentTitle && player.title) _addTitle(me, player.title);
        const ruling = player.throne && player.throne.ruling;
        const crown = ruling ? _kingdomName(world, ruling.kingdomId) : null;
        if (crown) _addTitle(me, `Crown of ${crown}`);
        if (house.currentReign && !me.reign) me.reign = { from: _num(house.currentReign.startDay), to: null, gen };
        if (player.appearance && typeof player.appearance === 'object') me.appearance = JSON.parse(JSON.stringify(player.appearance));
        const rg = player.regency;
        if (rg && rg.regent && (rg.active || rg.ending || rg.done)) {
            me.regent = { name: rg.regent.name, kind: rg.regent.kind || null, since: _num(rg.since, day), until: rg.active ? null : (me.regent && me.regent.until != null ? me.regent.until : day) };
        }
        if (player._isDead) {
            me.alive = false;
            if (me.died == null) me.died = day;
            const dc = player.ailments && player.ailments.deathCause;
            if (!me.cause && dc && dc.name) me.cause = String(dc.name).toLowerCase();
        }

        // The founder's own parents (born to a family: player/parentage.js)
        const pa = player.parentage;
        if (pa && gen === (L.foundingGen || gen) && !me.parents.length) {
            const f = pa.father != null ? DynastyTree._npcPerson(L, world, npcOf(pa.father), pa.father, { kind: 'parent', generation: gen - 1 }) : null;
            const m = pa.mother != null ? DynastyTree._npcPerson(L, world, npcOf(pa.mother), pa.mother, { kind: 'parent', generation: gen - 1 }) : null;
            if (f) _link(me.parents, f.id);
            if (m) _link(me.parents, m.id);
            if (f && m) { _link(f.spouses, m.id); _link(m.spouses, f.id); }
        }
        if (L.foundingGen == null) L.foundingGen = gen;

        // The ruler's spouse (a placeholder from the heir's own match takes the NPC's face)
        let spouseId = null;
        if (player.spouse != null) {
            const npc = npcOf(player.spouse);
            const ph = me.spouses.map(id => L.people[id]).find(p => p && p.npcId == null && npc && _first(p.name) === npc.firstName);
            const rec = DynastyTree._npcPerson(L, world, npc, player.spouse, { id: ph ? ph.id : null, kind: 'spouse', generation: gen });
            if (!rec.name) rec.name = 'the spouse';
            rec.kind = 'spouse';
            _link(me.spouses, rec.id);
            _link(rec.spouses, me.id);
            if (player.marriageDay != null && rec.wed == null) rec.wed = player.marriageDay;
            spouseId = rec.id;
        }
        // A spouse who died stays in the tree, dead
        for (const sid of me.spouses) {
            const s = L.people[sid];
            if (s && s.npcId != null && sid !== spouseId) {
                const npc = npcOf(s.npcId);
                if (npc) DynastyTree._npcPerson(L, world, npc, s.npcId, { id: sid });
            }
        }

        // Children of the ruler, and the siblings left from the last reign
        for (const c of player.children || []) {
            if (!c || !c.id) continue;
            let rec = L.people[c.id];
            if (!rec) {
                const parents = c.isSibling
                    ? [L.rulerOf[gen - 1]].filter(Boolean)
                    : [L.currentId, spouseId].filter(Boolean);
                rec = L.people[c.id] = _blank({ id: c.id, kind: 'blood', parents, generation: c.isSibling ? gen : gen + 1 });
            }
            if (rec.kind !== 'ruler') rec.kind = 'blood';
            rec.name = `${c.firstName || ''} ${c.dynasty || ''}`.trim() || rec.name;
            rec.first = c.firstName || rec.first;
            rec.gender = c.gender || rec.gender;
            rec.born = c.birthDay != null ? _num(c.birthDay) : (rec.born != null ? rec.born : day - Math.round(_num(c.age) * Y));
            rec.alive = c.isAlive !== false;
            if (!rec.alive && rec.died == null) rec.died = _num(c.deathDay, day);
            if (c.deathCause) rec.cause = c.deathCause;
            rec.sibling = !!c.isSibling;
            if (Array.isArray(c.traits)) rec.traits = c.traits.map(t => (t && (t.name || t.id)) || (typeof t === 'string' ? t : null)).filter(Boolean).slice(0, 6);
            for (const [rid, label] of Object.entries(ROLE_LABEL)) {
                if (house.roles && house.roles[rid] === c.id) _addTitle(rec, label);
            }
            const up = c.upbringing;
            if (up && up.placement && up.placement.kind) rec.placement = { kind: up.placement.kind, realm: up.placement.kingdomName || null, day: up.placement.day != null ? up.placement.day : null };
            const sp = up && up.spouse;
            if (sp && sp.name) {
                const sid = `sp_${c.id}`;
                const srec = L.people[sid] || (L.people[sid] = _blank({ id: sid, kind: 'spouse', generation: rec.generation }));
                srec.name = sp.name;
                srec.first = _first(sp.name);
                srec.gender = srec.gender || (c.gender === 'female' ? 'male' : 'female');
                srec.wed = sp.day != null ? sp.day : srec.wed;
                const realm = sp.kingdomName || _kingdomName(world, sp.kingdomId);
                const rest = String(sp.name).split(' ').slice(1).join(' ');
                srec.origin = {
                    house: sp.kind === 'royal' && rest ? rest : (sp.dynasty || null),
                    kingdom: realm || null, town: sp.town || null,
                    royal: sp.kind === 'royal', noble: sp.kind === 'alliance' || sp.kind === 'royal', match: sp.kind,
                };
                _link(rec.spouses, sid);
                _link(srec.spouses, rec.id);
                if (rec.sibling && realm && (sp.kind === 'alliance' || sp.kind === 'royal')) rec.branch = `the cadet line wed into ${realm}`;
                else if (rec.sibling && sp.kind === 'local') rec.branch = 'a cadet line in the towns';
            }
        }
        L.heirId = player.heir || null;
        return L;
    },

    /**
     * The heir has taken the seat (Relationships.succeedAsHeir, after the
     * heir became the player). ctx = { heirId, reign (Legacy's closed record),
     * cause, npc }. The late ruler is closed; the heir becomes the ruler.
     */
    onSuccession(player, world, ctx = {}) {
        const L = DynastyTree.ensure(player, world);
        if (!L) return null;
        const day = _day(world);
        const old = L.people[L.currentId];
        const reign = ctx.reign || null;
        if (old) {
            old.alive = false;
            if (old.died == null) old.died = reign && reign.endDay != null ? reign.endDay : day;
            old.cause = old.cause || ctx.cause || (reign && reign.cause) || null;
            if (reign) {
                old.reign = { from: _num(reign.startDay), to: _num(reign.endDay, day), gen: reign.generation || old.generation };
                if (reign.epithet) old.epithet = reign.epithet;
                if (reign.title) _addTitle(old, reign.title);
                if (reign.crown) _addTitle(old, `Crown of ${reign.crown}`);
            } else if (old.reign) old.reign.to = day;
        }
        const gen = (player.house && player.house.generation) || ((old && old.generation) || 1) + 1;
        const id = ctx.heirId || `ruler_g${gen}`;
        const rec = L.people[id] || (L.people[id] = _blank({ id, parents: old ? [old.id] : [], generation: gen }));
        rec.kind = 'ruler';
        rec.generation = gen;
        rec.sibling = false;
        rec.branch = null;
        rec.reign = { from: day, to: null, gen };
        L.currentId = id;
        L.rulerOf[gen] = id;
        DynastyTree.sync(player, world, { npc: ctx.npc });
        return rec;
    },

    // ── The tree as data ──────────────────────────────

    /** The lineage to read: the saved one, else one built on a throwaway copy (build stays pure). */
    _read(player, world, opts) {
        if (!player || !player.house) return null;
        if (player.house.lineage && player.house.lineage.currentId) return player.house.lineage;
        const tmp = Object.create(player);
        tmp.house = { ...player.house, lineage: undefined };
        return DynastyTree.sync(tmp, world, opts);
    },

    /** The line of succession: the designated heir, the ruler's other children eldest first, then the siblings. */
    succession(player, L) {
        if (!player || !L) return [];
        const people = Object.values(L.people);
        const living = people.filter(p => p.alive && p.kind === 'blood' && p.id !== L.currentId);
        const own = living.filter(p => !p.cadet && !p.sibling && p.parents.includes(L.currentId)).sort((a, b) => _num(a.born) - _num(b.born));
        const sibs = living.filter(p => !p.cadet && p.sibling).sort((a, b) => _num(a.born) - _num(b.born));
        // ...then the heads of the cadet branches (systems/cadetBranches.js), nearest the main line first
        const cadets = living.filter(p => p.cadet && p.cadetHead).sort((a, b) => _num(a.generation) - _num(b.generation) || _num(a.born) - _num(b.born));
        const line = [...own, ...sibs, ...cadets].map(p => p.id);
        const heir = player.heir;
        if (heir && line.includes(heir)) return [heir, ...line.filter(id => id !== heir)];
        return line;
    },

    /**
     * PURE. The whole tree: { house, current, nodes, edges, succession,
     * rulers, regents, generations, layout: { id: { x, y } } } — x in node
     * columns, y in rows (one per generation). opts: { npc, succession }.
     */
    build(player, world, opts = {}) {
        const empty = { house: null, current: null, nodes: [], edges: [], succession: [], rulers: [], regents: [], generations: 0, layout: {}, width: 0, height: 0 };
        const L = DynastyTree._read(player, world, opts);
        if (!L) return empty;
        const house = player.house;
        const day = _day(world);
        const Y = _dpy();
        const succession = Array.isArray(opts.succession) ? opts.succession : DynastyTree.succession(player, L);
        const heirlooms = (house.heirlooms && Array.isArray(house.heirlooms.items)) ? house.heirlooms.items : [];
        const nodes = Object.values(L.people).map(p => {
            const bornYear = DynastyTree.year(world, p.born != null ? p.born : null);
            const diedYear = p.died != null ? DynastyTree.year(world, p.died) : null;
            const age = p.born != null ? Math.max(0, Math.floor(((p.alive ? day : _num(p.died, day)) - p.born) / Y)) : null;
            const holds = heirlooms.filter(h => (h.status === 'held' && p.id === L.currentId) || (h.status === 'child' && h.holderId === p.id));
            const bore = heirlooms.filter(h => (h.bearers || []).some(b => b.id === p.id));
            const rank = succession.indexOf(p.id);
            return {
                id: p.id, name: p.name || '—', first: p.first || _first(p.name), gender: p.gender || null, kind: p.kind,
                generation: p.generation, alive: !!p.alive, born: p.born, died: p.died, bornYear, diedYear, age,
                life: bornYear == null ? (diedYear != null ? `d. ${diedYear}` : '') : (p.alive ? `b. ${bornYear}` : `${bornYear}–${diedYear != null ? diedYear : '?'}`),
                cause: p.cause || null, epithet: p.epithet || '', traits: [...(p.traits || [])], titles: [...(p.titles || [])],
                ruler: p.kind === 'ruler', current: p.id === L.currentId, heir: rank === 0, successionRank: rank >= 0 ? rank + 1 : null,
                reign: p.reign ? { ...p.reign, fromYear: DynastyTree.year(world, p.reign.from), toYear: p.reign.to != null ? DynastyTree.year(world, p.reign.to) : null } : null,
                regent: p.regent ? { ...p.regent } : null, origin: p.origin ? { ...p.origin } : null, branch: p.branch || null, sibling: !!p.sibling, cadet: p.cadet || null,
                placement: p.placement ? { ...p.placement } : null, wed: p.wed != null ? p.wed : null,
                portrait: { npcId: p.npcId != null ? p.npcId : null, appearance: p.appearance || null, current: p.id === L.currentId },
                heirlooms: holds.map(h => ({ id: h.id, name: h.name, icon: h.icon })),
                bore: bore.filter(h => !holds.includes(h)).map(h => ({ id: h.id, name: h.name, icon: h.icon })),
                parents: [...(p.parents || [])].filter(id => L.people[id]), spouses: [...(p.spouses || [])].filter(id => L.people[id]),
            };
        });
        const edges = [];
        const seenSpouse = new Set();
        for (const n of nodes) {
            for (const pid of n.parents) edges.push({ from: pid, to: n.id, kind: 'parent' });
            for (const sid of n.spouses) {
                const key = [n.id, sid].sort().join('|');
                if (seenSpouse.has(key)) continue;
                seenSpouse.add(key);
                edges.push({ from: n.id, to: sid, kind: 'spouse' });
            }
        }
        const rulers = Object.keys(L.rulerOf).map(Number).sort((a, b) => a - b).map(g => L.rulerOf[g]).filter(id => L.people[id]);
        const regents = nodes.filter(n => n.regent).map(n => ({ id: n.id, regent: n.regent.name, since: n.regent.since, until: n.regent.until }));
        const { layout, width, height } = DynastyTree.layout(nodes);
        return {
            house: { name: house.name, motto: house.motto || '', sigil: { ...(house.sigil || {}) }, generation: house.generation || 1, founded: _num(house.foundedDay), ended: !!house.ended },
            current: L.currentId, nodes, edges, succession, rulers, regents,
            generations: new Set(nodes.map(n => n.generation)).size, layout, width, height,
        };
    },

    /**
     * A tidy layout: each blood member and their spouses side by side in a
     * row, their children centred beneath. → { layout: { id: { x, y } }, width, height }.
     */
    layout(nodes) {
        const byId = new Map(nodes.map(n => [n.id, n]));
        const spouseOnly = new Set();
        // A spouse (or a parent's partner) sits beside their blood partner
        for (const n of nodes) {
            if (n.kind === 'spouse' || (n.kind === 'parent' && n.gender === 'female' && n.spouses.length)) spouseOnly.add(n.id);
        }
        const kidsOf = new Map();
        const primary = (n) => n.parents.find(pid => byId.has(pid) && !spouseOnly.has(pid)) || n.parents.find(pid => byId.has(pid)) || null;
        for (const n of nodes) {
            if (spouseOnly.has(n.id)) continue;
            const p = primary(n);
            if (!p) continue;
            if (!kidsOf.has(p)) kidsOf.set(p, []);
            kidsOf.get(p).push(n);
        }
        for (const list of kidsOf.values()) list.sort((a, b) => _num(a.born) - _num(b.born) || String(a.id).localeCompare(String(b.id)));
        const partners = (n) => n.spouses.filter(id => spouseOnly.has(id) && byId.has(id));
        const widthMemo = new Map();
        const visiting = new Set();
        const width = (n) => {
            if (widthMemo.has(n.id)) return widthMemo.get(n.id);
            if (visiting.has(n.id)) return 1;
            visiting.add(n.id);
            const unit = 1 + partners(n).length;
            const kids = kidsOf.get(n.id) || [];
            const sum = kids.reduce((s, k) => s + width(k), 0);
            visiting.delete(n.id);
            const w = Math.max(unit, sum);
            widthMemo.set(n.id, w);
            return w;
        };
        const layout = {};
        let maxY = 0;
        const place = (n, left, depth) => {
            if (layout[n.id]) return;
            const w = width(n);
            const unit = 1 + partners(n).length;
            const kids = kidsOf.get(n.id) || [];
            const unitLeft = left + (w - unit) / 2;
            layout[n.id] = { x: unitLeft + 0.5, y: depth };
            maxY = Math.max(maxY, depth);
            partners(n).forEach((sid, i) => {
                if (!layout[sid]) layout[sid] = { x: unitLeft + 1.5 + i, y: depth };
            });
            const total = kids.reduce((s, k) => s + width(k), 0);
            let x = left + (w - total) / 2;
            for (const k of kids) {
                place(k, x, depth + 1);
                x += width(k);
            }
        };
        const roots = nodes.filter(n => !spouseOnly.has(n.id) && !primary(n))
            .sort((a, b) => _num(a.generation) - _num(b.generation) || _num(a.born) - _num(b.born));
        let left = 0;
        const minGen = nodes.length ? Math.min(...nodes.map(n => _num(n.generation, 1))) : 1;
        for (const r of roots) {
            place(r, left, Math.max(0, _num(r.generation, 1) - minGen));
            left += width(r);
        }
        // Anyone left (a spouse of no one placed): a row's end
        for (const n of nodes) {
            if (layout[n.id]) continue;
            layout[n.id] = { x: left + 0.5, y: Math.max(0, _num(n.generation, 1) - minGen) };
            maxY = Math.max(maxY, layout[n.id].y);
            left += 1;
        }
        return { layout, width: left, height: nodes.length ? maxY + 1 : 0 };
    },

    /**
     * One person's life as lines: { id, name, epithet, life, lines: [{ year, text }],
     * deeds: [{ label, value }], heirlooms, reignKey } — from the lineage, the
     * House Chronicle (house.history), the closed reign records (Legacy) and the
     * heirlooms they bore. reignKey { generation, startDay } finds their Annals chapter.
     */
    lifeSummary(player, world, id, opts = {}) {
        const tree = opts.tree || DynastyTree.build(player, world, opts);
        const n = tree.nodes.find(x => x.id === id);
        if (!n) return null;
        const by = new Map(tree.nodes.map(x => [x.id, x]));
        const house = player.house || {};
        const lines = [];
        const add = (day, text) => { if (text) lines.push({ day: day != null ? day : null, year: day != null ? DynastyTree.year(world, day) : null, text }); };
        const parents = n.parents.map(pid => by.get(pid)).filter(Boolean);
        add(n.born, `Born${parents.length ? ` to ${parents.map(p => p.first || p.name).join(' and ')}` : ''}${n.origin && n.origin.house ? `, of the House of ${n.origin.house}` : ''}${n.origin && n.origin.kingdom ? ` in ${n.origin.kingdom}` : ''}.`);
        for (const sid of n.spouses) {
            const s = by.get(sid);
            if (!s) continue;
            const from = s.origin ? [s.origin.house ? `of ${s.origin.house}` : '', s.origin.kingdom ? `from ${s.origin.kingdom}` : ''].filter(Boolean).join(', ') : '';
            add(s.wed != null ? s.wed : n.wed, `Wed ${s.name}${from ? `, ${from}` : ''}.`);
        }
        if (n.placement && n.placement.kind === 'ward') add(n.placement.day, `Fostered at the court of ${n.placement.realm || 'a ruler'}.`);
        if (n.reign) add(n.reign.from, `Took up the mantle of ${house.name || 'the House'}${n.reign.to == null ? '' : `, and held it until the year ${n.reign.toYear}`}.`);
        if (n.regent) add(n.regent.since, `${n.regent.name} ruled as regent${n.regent.until != null ? ` until the year ${DynastyTree.year(world, n.regent.until)}` : ''}.`);
        // The House Chronicle: the entries that name them, in their lifetime
        const first = n.first;
        if (first && first.length > 1) {
            const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
            const from = n.born != null ? n.born : -Infinity;
            const to = n.died != null ? n.died : Infinity;
            const hist = (house.history || []).filter(h => h && h.text && re.test(h.text) && _num(h.day) >= from && _num(h.day) <= to);
            for (const h of hist.slice(-14)) add(h.day, h.text);
        }
        // A ruler's closed reign: its highlights and counters (Deeds & Records)
        const deeds = [];
        let reignKey = null;
        if (n.ruler && n.reign) {
            reignKey = { generation: n.reign.gen || n.generation, startDay: n.reign.from };
            const rec = (house.reigns || []).find(r => (r.generation || 0) === (n.reign.gen || n.generation) && _num(r.startDay) === _num(n.reign.from))
                || (house.reigns || []).find(r => (r.generation || 0) === (n.reign.gen || n.generation));
            if (rec) {
                for (const h of rec.highlights || []) if (!lines.some(l => l.text === h.text)) add(h.day, h.text);
                const D = [['Years ruled', rec.years], ['Battles won', rec.battles], ['Crowns won', rec.crownsWon], ['Titles gained', rec.titles],
                    ['Quests', rec.quests], ['Delves cleared', rec.delvesCleared], ['Rivals bested', rec.rivalsBested], ['Petitions ruled', rec.petitionsRuled],
                    ['Children', rec.children], ['Prestige gained', rec.prestigeGained], ['Legacy score', rec.score]];
                for (const [label, value] of D) if (_num(value) > 0) deeds.push({ label, value: _num(value) });
            }
        }
        if (!n.alive) add(n.died, `Died${n.age != null ? ` aged ${n.age}` : ''}${n.cause ? ` (${n.cause})` : ''}.`);
        lines.sort((a, b) => _num(a.day, -1) - _num(b.day, -1));
        const items = heirloomsOf(player, n);
        return {
            id: n.id, name: n.name, epithet: n.epithet, life: n.life, alive: n.alive, age: n.age, ruler: n.ruler, current: n.current,
            titles: n.titles, traits: n.traits, cause: n.cause, branch: n.branch, successionRank: n.successionRank, regent: n.regent,
            lines, deeds, heirlooms: items, reignKey,
        };
    },
};

function heirloomsOf(player, n) {
    const ids = new Set([...n.heirlooms, ...n.bore].map(h => h.id));
    return Heirlooms.list(player).filter(h => ids.has(h.id)).map(h => {
        const s = Heirlooms.summary(h);
        const b = (h.bearers || []).filter(x => x.id === n.id);
        return { ...s, holds: n.heirlooms.some(x => x.id === h.id), bore: b };
    });
}
