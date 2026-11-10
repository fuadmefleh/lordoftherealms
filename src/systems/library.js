// ============================================
// LIBRARY — a seat's own books, and the knowledge a place in the world brings
// ============================================
// A ruler, a great lord, a high priest or a guildmaster does not wake up
// knowing nothing: a court keeps rolls of its realm, a see its annals, a
// guildhall its rolls. Two things live here:
//
//   - knowledge helpers over the game's real records: charting the map
//     (tile.explored — what the player's map shows), the world's history
//     (world.history and the peoples' history, as Peoples.getMergedHistory
//     ids on player.discoveredLore — the History panel), and what the player
//     knows of a realm (player.learnAboutKingdom categories);
//   - the library itself, on player.library (saved): a seat (town and the
//     building types whose shelves are the library's), and books written
//     from the world as it stands — the realm's chronicle (its towns'
//     founding years, the history the world holds about it, its wars and
//     allies), the royal house's roll, maps of the realm and its neighbours,
//     the chancery's letters, the annals of a faith, the holy places, the
//     guild's rolls, a factor's itinerary. Nothing in them is invented: each
//     page is read off the world when the library is founded.
//
// systems/books.js reads them: at a shelf inside the seat the library's
// unread books come first, a passage a sitting (book.pages), and finishing
// one grants its reward — lore discovered, realms learned about, the land
// it maps charted, holy places known, small skill gains.
//
// No randomness (picks are by world state and hashes); world/player passed in.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Characters } from '../world/characters.js';
import { Peoples } from './peoples.js';
import { Religion } from './religion.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _key = (q, r) => `${q},${r}`;
const _day = world => _num(world && world.day);

/** "the Iron Creed" for a name that may already start with "The". */
const _the = (name, cap = false) => { const n = String(name || '').replace(/^the /i, ''); return `${cap ? 'The' : 'the'} ${n}`; };

const DEFAULTS = {
    pagesPerSitting: 2,
    minSittings: 3,
    maxSittings: 8,
    neighbours: 3,
    buildings: {
        royal: ['castle', 'manor', 'town_hall', 'library'],
        lordly: ['manor', 'castle', 'town_hall', 'library'],
        temple: ['temple', 'church', 'cathedral', 'monastery', 'chapel', 'library'],
        guild: ['guildhall', 'town_hall', 'library'],
    },
    names: {
        royal: 'the Royal Library of {town}',
        lordly: 'the Library of {town}',
        temple: 'the Library of the {temple}',
        guild: 'the Archive of the {guild}',
    },
};

function _cfg() {
    const gd = DataLoader._gamedata;
    const d = (gd && gd.books && _obj(gd.books.libraries)) || {};
    return { ...DEFAULTS, ...d, buildings: { ...DEFAULTS.buildings, ...(d.buildings || {}) }, names: { ...DEFAULTS.names, ...(d.names || {}) } };
}

function _fill(s, vars) {
    return String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _kingdom(world, kid) {
    if (!world || kid == null) return null;
    return typeof world.getKingdom === 'function' ? world.getKingdom(kid) : (world.kingdoms || []).find(k => k.id === kid) || null;
}

/** Strip a leading emoji and space from a history line. */
function _plain(text) {
    return String(text || '').replace(/^[^\p{L}\p{N}"'(]+/u, '').trim();
}

function _yearLine(year, text) {
    return Number.isFinite(year) ? `In the year ${year}: ${_plain(text)}` : _plain(text);
}

export const Library = {
    config: _cfg,

    // ── The world's records ────────────────────────────────

    /** Living settlements as { q, r, s } (live tile objects). */
    towns(world) {
        if (!world || typeof world.getSettlementViews !== 'function') return [];
        const out = [];
        for (const v of world.getSettlementViews()) {
            const t = world.getTile(v.q, v.r);
            if (t && t.settlement) out.push({ q: v.q, r: v.r, s: t.settlement });
        }
        return out;
    },

    realmTowns(world, kid) {
        return Library.towns(world).filter(t => t.s.kingdom === kid);
    },

    /** Every tile of a realm's land. */
    realmTiles(world, kid) {
        const out = [];
        if (!world || !Array.isArray(world.tiles)) return out;
        for (let r = 0; r < world.height; r++) {
            const row = world.tiles[r];
            if (!row) continue;
            for (let q = 0; q < world.width; q++) if (row[q] && row[q].kingdom === kid) out.push({ q, r });
        }
        return out;
    },

    dist(world, a, b) {
        return Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
    },

    /** The living realms nearest a realm's capital (by capital), up to n. */
    neighbours(world, k, n = _cfg().neighbours) {
        if (!k || !k.capital) return [];
        return (world.kingdoms || []).filter(x => x && x.id !== k.id && x.isAlive !== false && x.capital)
            .sort((a, b) => Library.dist(world, a.capital, k.capital) - Library.dist(world, b.capital, k.capital) || String(a.id).localeCompare(String(b.id)))
            .slice(0, n);
    },

    /** The world's history entries about a realm (merged history, with their ids). */
    realmLore(world, k) {
        if (!world || !k) return [];
        return Peoples.getMergedHistory(world).filter(e => e && (e.kingdom === k.id || (k.name && String(e.text || '').includes(k.name))));
    },

    /** The world's history entries about a faith. */
    faithLore(world, faith) {
        if (!world || !faith) return [];
        return Peoples.getMergedHistory(world).filter(e => e && String(e.text || '').includes(faith.name));
    },

    /** Mark world-history entries known (the History panel). Returns how many were new. */
    learnLore(player, ids) {
        if (!player) return 0;
        if (!(player.discoveredLore instanceof Set)) player.discoveredLore = new Set(Array.isArray(player.discoveredLore) ? player.discoveredLore : []);
        let n = 0;
        for (const id of ids || []) {
            if (id == null || player.discoveredLore.has(id)) continue;
            player.discoveredLore.add(id);
            n++;
        }
        return n;
    },

    /** Learn categories of what a realm is (player.learnAboutKingdom). Returns how many were new. */
    learnRealm(player, kid, cats) {
        if (!player || kid == null) return 0;
        if (typeof player.learnAboutKingdom === 'function') return player.learnAboutKingdom(kid, cats).length;
        if (!_obj(player.kingdomKnowledge)) player.kingdomKnowledge = {};
        const k = player.kingdomKnowledge[kid] || (player.kingdomKnowledge[kid] = {});
        let n = 0;
        for (const c of cats) if (!k[c]) { k[c] = true; n++; }
        return n;
    },

    // ── Charting ───────────────────────────────────────────

    /** A path between two places: along the roads where A* finds one, else a straight line. */
    route(world, a, b) {
        const passable = (q, r) => { const t = world.getTile(q, r); return !!(t && t.terrain && t.terrain.passable !== false); };
        const cost = (q, r) => { const t = world.getTile(q, r); return t && (t.hasRoad || t.settlement) ? 1 : 3; };
        let path = null;
        if (Library.dist(world, a, b) <= 40) {
            try { path = Hex.findPath(a.q, a.r, b.q, b.r, world.width, world.height, passable, cost); } catch (e) { path = null; }
        }
        if (Array.isArray(path) && path.length) return path.map(p => ({ q: p.q, r: p.r }));
        // (the short way round the seam)
        let bq = b.q;
        if (world.width && Math.abs(bq - a.q) > world.width / 2) bq += bq > a.q ? -world.width : world.width;
        return Hex.lineDraw(a.q, a.r, bq, b.r).map(h => ({ q: Hex.wrapQ(h.q, world.width), r: h.r }));
    },

    /**
     * The tiles a chart spec covers (unique). Specs:
     *   { kind: 'realm', kid, ring }          a realm's land and `ring` hexes past its border
     *   { kind: 'roads', kid }                a realm's roads and towns
     *   { kind: 'around', points, radius }    hexes around places
     *   { kind: 'routes', from, to, width }   the way from one place to others
     *   { kind: 'front', kid, enemy, depth }  both sides of the border between two realms
     *   { kind: 'holy', faithId, radius }     the holy sites (of a faith, or all)
     */
    chartTiles(world, specs) {
        const seen = new Map();
        const add = (q, r) => {
            const t = world.getTile(q, r);
            if (!t) return;
            const wq = Hex.wrapQ(q, world.width);
            seen.set(_key(wq, r), { q: wq, r });
        };
        const ring = (q, r, rad) => { for (const h of Hex.hexesInRange(q, r, rad)) add(h.q, h.r); };
        for (const spec of [].concat(specs || [])) {
            if (!spec) continue;
            if (spec.kind === 'realm') {
                const land = Library.realmTiles(world, spec.kid);
                const R = Math.max(0, Math.floor(_num(spec.ring)));
                const inner = new Set(land.map(t => _key(t.q, t.r)));
                for (const t of land) {
                    add(t.q, t.r);
                    if (R <= 0) continue;
                    // (only the border hexes reach past it)
                    if (Hex.neighbors(t.q, t.r).every(n => inner.has(_key(Hex.wrapQ(n.q, world.width), n.r)))) continue;
                    ring(t.q, t.r, R);
                }
            } else if (spec.kind === 'roads') {
                for (const t of Library.realmTiles(world, spec.kid)) {
                    const tile = world.getTile(t.q, t.r);
                    if (tile && (tile.hasRoad || tile.settlement)) add(t.q, t.r);
                }
            } else if (spec.kind === 'around') {
                for (const p of spec.points || []) ring(p.q, p.r, Math.max(0, Math.floor(_num(spec.radius))));
            } else if (spec.kind === 'routes') {
                const w = Math.max(0, Math.floor(_num(spec.width)));
                for (const to of spec.to || []) {
                    for (const h of Library.route(world, spec.from, to)) (w ? ring(h.q, h.r, w) : add(h.q, h.r));
                }
            } else if (spec.kind === 'front') {
                const depth = Math.max(1, Math.floor(_num(spec.depth, 4)));
                let found = 0;
                const mine = Library.realmTiles(world, spec.kid);
                const theirs = Library.realmTiles(world, spec.enemy);
                if (!mine.length || !theirs.length) continue;
                // A hex of either side within `depth` of the other side's land
                const near = (list, other) => {
                    const otherSet = new Set(other.map(t => _key(t.q, t.r)));
                    for (const t of list) {
                        if (Hex.hexesInRange(t.q, t.r, depth).some(h => otherSet.has(_key(Hex.wrapQ(h.q, world.width), h.r)))) { add(t.q, t.r); found++; }
                    }
                };
                near(mine, theirs);
                near(theirs, mine);
                // (realms with no common border: the march between the nearest towns)
                if (!found) {
                    const a = Library.realmTowns(world, spec.kid);
                    const b = Library.realmTowns(world, spec.enemy);
                    let best = null;
                    for (const x of a) for (const y of b) { const d = Library.dist(world, x, y); if (!best || d < best.d) best = { x, y, d }; }
                    if (best) for (const h of Library.route(world, best.x, best.y)) ring(h.q, h.r, 1);
                }
            } else if (spec.kind === 'holy') {
                for (const p of Library.holySites(world, spec.faithId)) ring(p.q, p.r, Math.max(0, Math.floor(_num(spec.radius, 1))));
            }
        }
        return [...seen.values()];
    },

    /** Chart the tiles of the specs on the player's map (tile.explored). Returns how many were new. */
    chart(world, specs) {
        let n = 0;
        for (const t of Library.chartTiles(world, specs)) {
            const tile = world.getTile(t.q, t.r);
            if (tile && !tile.explored) { tile.explored = true; n++; }
        }
        return n;
    },

    /** The holy sites of the world (of one faith, or all): [{ q, r, site }]. */
    holySites(world, faithId = null) {
        const out = [];
        if (!world || !Array.isArray(world.tiles)) return out;
        for (let r = 0; r < world.height; r++) {
            const row = world.tiles[r];
            if (!row) continue;
            for (let q = 0; q < world.width; q++) {
                const hs = row[q] && row[q].holySite;
                if (hs && (!faithId || hs.faithId === faithId)) out.push({ q, r, site: hs });
            }
        }
        return out;
    },

    /** Know the holy sites (player.discoveredHolySites) of a faith, or all. Returns how many were new. */
    knowHolySites(player, world, faithId = null) {
        if (!player) return 0;
        if (!(player.discoveredHolySites instanceof Set)) player.discoveredHolySites = new Set(Array.isArray(player.discoveredHolySites) ? player.discoveredHolySites : []);
        let n = 0;
        for (const h of Library.holySites(world, faithId)) {
            const k = _key(h.q, h.r);
            if (player.discoveredHolySites.has(k)) continue;
            player.discoveredHolySites.add(k);
            n++;
        }
        return n;
    },

    /** The settlement nearest a place (for "near X"). */
    nearestTown(world, at) {
        let best = null;
        for (const t of Library.towns(world)) {
            const d = Library.dist(world, t, at);
            if (!best || d < best.d) best = { t, d };
        }
        return best ? best.t : null;
    },

    // ── The library ────────────────────────────────────────

    state(player) {
        return player && _obj(player.library) && Array.isArray(player.library.books) ? player.library : null;
    },

    /**
     * Found the player's library at a seat. spec: { kind: 'royal'|'lordly'|'temple'|'guild',
     * q, r, town, books: [book], vars: { temple, guild } }. Returns the library.
     */
    found(player, world, spec) {
        const C = _cfg();
        const kind = spec.kind || 'lordly';
        const name = _fill(C.names[kind] || C.names.lordly, { town: spec.town, ...(spec.vars || {}) });
        const books = (spec.books || []).filter(b => b && Array.isArray(b.pages) && b.pages.length);
        player.library = {
            v: 1, kind, name: name.charAt(0).toUpperCase() + name.slice(1),
            seat: { q: spec.q, r: spec.r, town: spec.town },
            buildings: (C.buildings[kind] || C.buildings.lordly).slice(),
            holdsSeat: !!spec.holdsSeat,
            founded: _day(world),
            books,
        };
        return player.library;
    },

    book(player, id) {
        const lib = Library.state(player);
        return lib ? lib.books.find(b => b.id === id) || null : null;
    },

    /** Is a shelf here one of the library's? ctx: { townKey, building } */
    isAt(player, ctx = {}) {
        const lib = Library.state(player);
        if (!lib || !lib.seat || !ctx.townKey) return false;
        if (ctx.townKey !== _key(lib.seat.q, lib.seat.r)) return false;
        const b = String(ctx.building || '').replace(/^player_/, '');
        return !!b && lib.buildings.includes(b);
    },

    /** The library's unread books, those begun first. */
    unread(player, finished = []) {
        const lib = Library.state(player);
        if (!lib) return [];
        const done = new Set(finished);
        return lib.books.filter(b => !done.has(b.id));
    },

    /** The catalogue for a panel or the welcome: [{ id, title, kind, read, sittings }]. */
    catalogue(player, finished = []) {
        const lib = Library.state(player);
        if (!lib) return [];
        const done = new Set(finished);
        return lib.books.map(b => ({ id: b.id, title: b.title, kind: b.kind, read: done.has(b.id), sittings: b.sittings }));
    },

    /** The pages a sitting covers, moving the book from `before` to `after` sittings. */
    passage(book, before, after) {
        const pages = Array.isArray(book && book.pages) ? book.pages : [];
        if (!pages.length) return [];
        const per = pages.length / Math.max(1, _num(book.sittings, 1));
        const from = Math.min(pages.length - 1, Math.floor(before * per + 1e-9));
        const to = Math.max(from + 1, Math.min(pages.length, Math.floor(after * per + 1e-9)));
        return pages.slice(from, to);
    },

    /**
     * A finished library book's reward: lore, realms, the land charted, holy
     * places. (Skills and stats are Books._reward's.) → text parts.
     */
    reward(player, world, R = {}) {
        const out = [];
        if (Array.isArray(R.lore) && R.lore.length) {
            const n = Library.learnLore(player, R.lore);
            if (n) out.push(`${n} ${n === 1 ? 'page' : 'pages'} of history learned`);
        }
        if (Array.isArray(R.intel)) {
            let n = 0;
            for (const [kid, cats] of R.intel) if (Library.learnRealm(player, kid, cats)) n++;
            if (n) out.push(`${n} ${n === 1 ? 'realm' : 'realms'} better known`);
        }
        if (R.chart && world && typeof world.getTile === 'function') {
            const n = Library.chart(world, R.chart);
            if (n) out.push(`${n} tiles charted`);
        }
        if (R.holy && world) {
            const n = Library.knowHolySites(player, world, R.holy === '*' ? null : R.holy);
            if (n) out.push(`${n} holy ${n === 1 ? 'place' : 'places'} known`);
        }
        return out;
    },

    _book(id, o) {
        const C = _cfg();
        const pages = (o.pages || []).filter(Boolean);
        const sittings = Math.max(_num(C.minSittings, 3), Math.min(_num(C.maxSittings, 8), Math.ceil(pages.length / Math.max(1, _num(C.pagesPerSitting, 2)))));
        return {
            id, library: true, kind: o.kind || 'history', title: o.title, author: o.author || 'court scribes', topic: o.topic || 'history',
            tier: 0, sittings, pages, reward: o.reward || {}, finish: o.finish || `You close ${o.title}.`,
        };
    },

    // ── The books, written from the world ──────────────────

    _founding(world, t) {
        const y = _num(t.s.founded, NaN);
        return Number.isFinite(y) && y <= _num(world.year, Infinity) ? y : null;
    },

    /** The Chronicle of a realm: its founding, towns, the history the world holds about it, its wars. */
    realmChronicle(world, k) {
        if (!k) return null;
        const towns = Library.realmTowns(world, k.id);
        const cap = towns.find(t => k.capital && t.q === k.capital.q && t.r === k.capital.r) || null;
        const pages = [];
        const faith = k.religion && Religion.FAITHS[k.religion.faithId];
        pages.push(`${k.name} is a realm of the ${k.culture || 'old'} people${cap ? `, ruled from ${cap.s.name}` : ''}${faith ? `, keeping ${_the(faith.name)}` : ''}. It holds ${towns.length} ${towns.length === 1 ? 'settlement' : 'settlements'} today.`);
        if (cap && Library._founding(world, cap) != null) pages.push(`In the year ${Library._founding(world, cap)}, ${cap.s.name} was founded: the first stone of ${k.name}.`);
        const dated = towns.filter(t => t !== cap && Library._founding(world, t) != null).sort((a, b) => Library._founding(world, a) - Library._founding(world, b));
        for (let i = 0; i < dated.length; i += 3) {
            pages.push(`The realm grew: ${dated.slice(i, i + 3).map(t => `${t.s.name} was raised in the year ${Library._founding(world, t)}`).join('; ')}.`);
        }
        for (const t of towns) {
            if (t.s.formerKingdom != null && t.s.formerKingdom !== k.id) {
                const was = _kingdom(world, t.s.formerKingdom);
                pages.push(`${t.s.name} was taken from ${was ? was.name : 'another realm'} by the sword, and is held by ${k.name} still.`);
            }
        }
        const lore = Library.realmLore(world, k);
        for (const e of lore) pages.push(_yearLine(e.year, e.text));
        const wars = (k.wars || []).map(id => _kingdom(world, id)).filter(Boolean).map(x => x.name);
        const allies = (k.allies || []).map(id => _kingdom(world, id)).filter(Boolean).map(x => x.name);
        if (wars.length || allies.length) {
            pages.push(`At this writing, ${k.name} ${wars.length ? `is at war with ${wars.join(' and ')}` : 'is at peace'}${allies.length ? `, and allied to ${allies.join(' and ')}` : ''}.`);
        } else {
            pages.push(`At this writing, ${k.name} is at peace with every realm.`);
        }
        return Library._book(`lib_chronicle_${k.id}`, {
            kind: 'history', title: `The Chronicle of ${k.name}`, author: 'the court historians', topic: `the history of ${k.name}`,
            pages,
            reward: { lore: lore.map(e => e.id), intel: [[k.id, ['basics', 'peoples', 'religion', 'diplomacy']]], skills: { diplomacy: 0.3 } },
            finish: `You close the Chronicle of ${k.name}. Its towns, its wars and its founding are yours to quote now.`,
        });
    },

    /** The roll of a realm's royal house: the dynasty, its living members, the council. ctx: { late, pretender } */
    royalRoll(world, k, ctx = {}) {
        const data = k && k.characterData;
        if (!data) return null;
        const dyn = data.dynasty || {};
        const pages = [];
        const name = c => (c ? Characters.getFullName(c) : null);
        pages.push(`House ${dyn.name || 'of the crown'} has worn the crown of ${k.name}${Array.isArray(dyn.bloodline) && dyn.bloodline.length > 1 ? ` through ${dyn.bloodline.length} reigns` : ''}${dyn.prestige ? `, a house of ${Math.round(dyn.prestige)} prestige` : ''}.`);
        if (ctx.late) pages.push(`${ctx.late} ruled until ${ctx.lateDay != null ? `day ${ctx.lateDay}` : 'lately'}, and died.`);
        else if (data.ruler && !data.ruler.isPlayer) pages.push(`${name(data.ruler)} rules${Number.isFinite(data.ruler.age) ? `, aged ${data.ruler.age}` : ''}.`);
        if (data.spouse && data.spouse.isAlive !== false && !data.spouse.isPlayer) pages.push(`The royal consort is ${name(data.spouse)}.`);
        const kids = (data.children || []).filter(c => c && c.isAlive !== false);
        if (kids.length) pages.push(`Of the royal blood: ${kids.map(c => `${name(c)} (${_num(c.age)})`).join(', ')}.`);
        if (ctx.pretender) pages.push(`${ctx.pretender} says the throne is theirs by the old blood.`);
        const adv = Object.entries(_obj(data.advisors) || {}).filter(([, a]) => a && a.isAlive !== false);
        if (adv.length) {
            const roles = Characters.ADVISOR_ROLES || {};
            pages.push(`The council: ${adv.map(([role, a]) => `${name(a)}, ${((roles[role] && roles[role].name) || role).toLowerCase()}`).join('; ')}.`);
        }
        return Library._book(`lib_roll_${k.id}`, {
            kind: 'roll', title: `The Roll of House ${dyn.name || k.name}`, author: 'the heralds of the court', topic: 'the royal blood',
            pages,
            reward: { intel: [[k.id, ['ruler']]], skills: { diplomacy: 0.2, leadership: 0.2 } },
            finish: `You know the blood of House ${dyn.name || k.name} now, branch by branch.`,
        });
    },

    /** A map of a realm (whole), read off its land. */
    realmMap(world, k, ring = 1) {
        if (!k) return null;
        const towns = Library.realmTowns(world, k.id);
        const tiles = Library.realmTiles(world, k.id).length;
        const pages = [`A map of ${k.name}: ${tiles} leagues of land${towns.length ? `, its towns ${towns.map(t => t.s.name).join(', ')}` : ''}.`];
        const ruler = k.ruler ? `${k.ruler} rules it` : 'its crown is unclear';
        pages.push(`${k.name} is a ${k.culture || ''} realm; ${ruler}.`.replace(/ {2}/g, ' '));
        return Library._book(`lib_map_${k.id}`, {
            kind: 'map', title: `A Map of ${k.name}`, author: 'the map-room', topic: 'geography',
            pages,
            reward: { chart: [{ kind: 'realm', kid: k.id, ring }], intel: [[k.id, ['basics']]], skills: { cartography: 0.15 } },
            finish: `You have the lie of ${k.name} by heart: its rivers, roads and borders.`,
        });
    },

    /** The chancery's letters: how the realm stands with each neighbour. */
    chanceryLetters(world, k, neighbours) {
        if (!k || !neighbours.length) return null;
        const pages = [];
        const word = v => (v >= 50 ? 'warm friends' : v >= 15 ? 'on good terms' : v > -15 ? 'cool but civil' : v > -50 ? 'on bad terms' : 'bitter enemies');
        for (const n of neighbours) {
            const rel = _num(k.relations && k.relations[n.id]);
            const war = (k.wars || []).includes(n.id);
            const ally = (k.allies || []).includes(n.id);
            const nf = n.religion && Religion.FAITHS[n.religion.faithId];
            pages.push(`${n.name}${n.ruler ? `, under ${n.ruler}` : ''}: ${war ? 'at war with us' : ally ? 'our ally' : word(rel)}${nf ? `; they keep ${_the(nf.name)}` : ''}.`);
        }
        return Library._book(`lib_letters_${k.id}`, {
            kind: 'letters', title: `Letters of the Chancery of ${k.name}`, author: 'the chancellors', topic: 'diplomacy',
            pages,
            reward: { intel: neighbours.map(n => [n.id, ['basics', 'ruler', 'diplomacy', 'religion']]), skills: { diplomacy: 0.4 } },
            finish: 'Every envoy, every treaty and every slight is in these letters. You know where you stand with your neighbours.',
        });
    },

    /** The roll of a great house's lands (the estates the player holds). */
    estateRoll(world, k, estates, houseName = null) {
        if (!estates.length) return null;
        const byTown = new Map();
        for (const e of estates) {
            const at = String(e.town || '');
            if (!byTown.has(at)) byTown.set(at, []);
            byTown.get(at).push(e);
        }
        const pages = [`The rolls of ${houseName || 'the House'}: ${estates.length} ${estates.length === 1 ? 'estate' : 'estates'} in ${k ? k.name : 'the realm'}.`];
        for (const [at, list] of byTown) {
            const [q, r] = at.split(',').map(Number);
            const tile = Number.isFinite(q) && Number.isFinite(r) ? world.getTile(q, r) : null;
            const town = (tile && tile.settlement && tile.settlement.name) || 'a town';
            pages.push(`At ${town}: ${list.map(e => e.name || 'an estate').join(', ')}.`);
        }
        return Library._book(`lib_estates_${k ? k.id : 'house'}`, {
            kind: 'roll', title: `The Rolls of ${houseName || 'the House'}`, author: 'the stewards', topic: 'the House\'s lands',
            pages, reward: { skills: { commerce: 0.2, leadership: 0.2 } },
            finish: 'You know every field, mill and rent-roll of the House now.',
        });
    },

    /** The annals of a faith: founding, tenets, the history, the realms that keep it, its holy places, its heresies. */
    faithAnnals(world, faith, see = null) {
        if (!faith) return null;
        const pages = [];
        pages.push(`${_the(faith.name, true)}${Number.isFinite(faith.founded) ? `, founded in the year ${faith.founded}` : ''}${Array.isArray(faith.tenets) && faith.tenets.length ? `, teaches ${faith.tenets.join(', ')}` : ''}.`);
        const lore = Library.faithLore(world, faith);
        for (const e of lore) pages.push(_yearLine(e.year, e.text));
        const realms = (world.kingdoms || []).filter(x => x && x.isAlive !== false && x.religion && x.religion.faithId === faith.id);
        if (realms.length) pages.push(`It is kept today in ${realms.map(x => x.name).join(', ')}.`);
        const sites = Library.holySites(world, faith.id);
        if (sites.length) {
            pages.push(`Its holy places: ${sites.map(h => { const t = Library.nearestTown(world, h); return `${h.site.name || 'a holy place'}${t ? ` near ${t.s.name}` : ''}`; }).join('; ')}.`);
        }
        if (see && see.religion && Array.isArray(see.religion.heresies) && see.religion.heresies.length) {
            pages.push(`Heresy troubles ${see.name}: ${see.religion.heresies.map(h => h.name).filter(Boolean).join(', ')}.`);
        }
        return Library._book(`lib_faith_${faith.id}`, {
            kind: 'history', title: `The Annals of ${_the(faith.name)}`, author: 'the clerks of the see', topic: 'the faith\'s history',
            pages,
            reward: { lore: lore.map(e => e.id), intel: realms.map(x => [x.id, ['religion']]), holy: faith.id, stats: { faith: 0.15 } },
            finish: `The Annals of ${_the(faith.name)} end with your own name, newly written in.`,
        });
    },

    /** The book of the holy places of every faith. */
    holyPlaces(world) {
        const sites = Library.holySites(world, null);
        if (!sites.length) return null;
        const pages = sites.map(h => {
            const f = h.site.faithId && Religion.FAITHS[h.site.faithId];
            const t = Library.nearestTown(world, h);
            const ctl = h.site.controller != null ? _kingdom(world, h.site.controller) : null;
            return `${h.site.name || 'A holy place'}${t ? `, near ${t.s.name}` : ''}: ${f ? `sacred to ${_the(f.name)}` : 'its faith forgotten'}${ctl ? `, held by ${ctl.name}` : ''}.`;
        });
        return Library._book('lib_holy_places', {
            kind: 'map', title: 'The Book of the Holy Places', author: 'pilgrims of many ages', topic: 'the holy places',
            pages, reward: { chart: [{ kind: 'holy', faithId: null, radius: 1 }], holy: '*', skills: { cartography: 0.1 } },
            finish: 'Every shrine and sacred spring the pilgrims ever walked to is marked on your map now.',
        });
    },

    /** The guild's rolls: its towns, masters and members, its treasury. */
    guildRolls(world, gid, guildTowns, homeGuild) {
        if (!homeGuild) return null;
        const pages = [`The ${homeGuild.name}: ${_num(homeGuild.members)} masters and journeymen, ${Math.floor(_num(homeGuild.treasury))} gold in the hall's chest.`];
        for (const t of guildTowns) {
            const g = t.s.guilds && t.s.guilds[gid];
            if (!g || g === homeGuild) continue;
            pages.push(`At ${t.s.name}: the ${g.name}, ${_num(g.members)} members${g.master && g.master.name ? `, master ${g.master.name}` : ''}.`);
        }
        return Library._book(`lib_guild_${gid}`, {
            kind: 'roll', title: `The Rolls of the ${homeGuild.name}`, author: 'the guild clerks', topic: 'the guild',
            pages, reward: { skills: { commerce: 0.3 }, intel: [...new Set(guildTowns.map(t => t.s.kingdom).filter(x => x != null))].map(kid => [kid, ['economy']]) },
            finish: 'You know every hall of the trade, and who is master in each.',
        });
    },

    /** A factor's itinerary: the roads to the trade towns further out. */
    itinerary(world, home, far) {
        if (!far.length) return null;
        const pages = far.map(t => {
            const k = t.s.kingdom != null ? _kingdom(world, t.s.kingdom) : null;
            return `${t.s.name}, a ${t.s.type || 'town'}${k ? ` of ${k.name}` : ''}: ${Library.dist(world, home, t)} leagues from ${home.s.name}.`;
        });
        return Library._book(`lib_itinerary_${home.q}_${home.r}`, {
            kind: 'map', title: 'A Factor\'s Itinerary', author: 'the guild\'s factors', topic: 'trade roads',
            pages, reward: { chart: [{ kind: 'routes', from: { q: home.q, r: home.r }, to: far.map(t => ({ q: t.q, r: t.r })) }, { kind: 'around', points: far.map(t => ({ q: t.q, r: t.r })), radius: 1 }], skills: { cartography: 0.1, commerce: 0.1 } },
            finish: 'The factors\' roads are drawn on your map, every ford and toll-gate.',
        });
    },
};
