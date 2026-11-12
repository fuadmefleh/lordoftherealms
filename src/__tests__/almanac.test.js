// The Almanac of the World (systems/almanac.js, ui/actionMenu/almanac.js): an
// index over what a played game has recorded — people, Houses, places, realms,
// wars and battles, ages, great works — searchable, every link resolving both
// ways, and a panel that lists, searches, opens pages and walks back.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Almanac } from '../systems/almanac.js';
import { Relationships } from '../systems/relationships.js';
import { RealmTimeline } from '../systems/realmTimeline.js';
import { Seasons } from '../world/seasons.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

let ActionMenu, logSpy;
const savedDocument = globalThis.document;
let played = null;

function el(id) {
    return {
        id, style: {}, dataset: {}, innerHTML: '', value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, querySelector() { return el(); }, querySelectorAll() { return []; },
        setAttribute() {}, getAttribute() { return null; }, remove() {}, focus() {},
    };
}

function shell(game) {
    const rec = { panels: [] };
    game.ui = new Proxy({
        showCustomPanel: (title, html) => { rec.panels.push({ title: String(title), html: String(html) }); },
        _panelNav: null,
    }, { get(t, p) { return p in t ? t[p] : (typeof p === 'symbol' ? undefined : () => {}); } });
    return rec;
}

const opts = (player) => ({ npc: (id) => Relationships.getNPC(id), known: () => Relationships.getKnownNPCs(player) });

/** A game played some months, with a war, a battle near a capital and a great work on record. */
function play() {
    if (played) return played;
    const game = newGame(11);
    const { world } = game;
    const [a, b] = world.kingdoms.filter(k => k.isAlive && k.capital);
    for (let d = 0; d < 70; d++) {
        if (d === 20) {
            a.wars.push(b.id);
            b.wars.push(a.id);
        }
        if (d === 30) world.timelineFeed.push({ q: b.capital.q, r: b.capital.r, day: world.day, dead: 300, victor: a.name, loser: b.name });
        if (endDay(game).died) break;
    }
    const cap = world.getTile(a.capital.q, a.capital.r);
    world.greatWorks = world.greatWorks || { built: [] };
    world.greatWorks.built = world.greatWorks.built || [];
    world.transport = world.transport || {};
    world.transport.works = world.transport.works || [];
    world.transport.works.push({ id: 'pwT1', kind: 'bridge', name: 'Kingsbridge', icon: '🌉', owner: 'player', kid: a.id, status: 'done', started: world.day - 30, done: world.day, tq: a.capital.q, tr: a.capital.r + 1 });
    world.greatWorks.built.push({ uid: 'gwbT1', workId: 'cathedral', q: a.capital.q, r: a.capital.r, name: 'Great Cathedral', icon: '⛪', owner: 'player', kingdomId: a.id, day: world.day, settlementName: cap.settlement.name });
    played = { game, a, b };
    return played;
}

beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const els = new Map();
    globalThis.document = {
        getElementById: (id) => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
        createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, body: el(),
    };
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
});
afterAll(() => {
    globalThis.document = savedDocument;
    if (logSpy) logSpy.mockRestore();
});

describe('the Almanac index', () => {
    it('builds from a played game: people, the House, places, realms, wars, battles and works', () => {
        const { game, a, b } = play();
        const { player, world } = game;
        Almanac.invalidate(world);
        const t0 = Date.now();
        const idx = Almanac.index(player, world, opts(player));
        expect(Date.now() - t0).toBeLessThan(3000);
        const n = Almanac.counts(idx);
        expect(n.person).toBeGreaterThan(0);
        expect(n.house).toBeGreaterThan(0);
        expect(n.place).toBeGreaterThan(5);
        expect(n.realm).toBeGreaterThanOrEqual(world.kingdoms.filter(k => k.isAlive).length);
        expect(n.work).toBe(1 + world.transport.works.length);
        // the player's House and its head
        const house = Almanac.get(idx, 'h:player');
        expect(house.name).toBe(player.house.name);
        expect(idx.byCat.person.some(e => e.id.startsWith('p:dyn:') && e.links.has('h:player'))).toBe(true);
        // the realms' lords
        expect(Almanac.get(idx, `p:lord:${a.id}`)).toBeTruthy();
        // the war and its battle, the battle by its place
        const war = idx.byCat.war.find(e => e.kind === 'war' && e.links.has(`k:${a.id}`) && e.links.has(`k:${b.id}`));
        expect(war).toBeTruthy();
        const battle = idx.byCat.war.find(e => e.kind === 'battle' && e.q === b.capital.q && e.r === b.capital.r);
        expect(battle).toBeTruthy();
        expect(battle.links.has(`s:${b.capital.q},${b.capital.r}`)).toBe(true);
        expect(battle.links.has(war.id)).toBe(true);
        // a place knows its realm; the work its place and the House
        const capital = Almanac.get(idx, `s:${a.capital.q},${a.capital.r}`);
        expect(capital.links.has(`k:${a.id}`)).toBe(true);
        expect(Almanac.get(idx, 'g:gwbT1').links.has(capital.id)).toBe(true);
        expect(Almanac.get(idx, 'g:gwbT1').links.has('h:player')).toBe(true);
    });

    it('indexes public works by the town nearest them (true hex distance)', () => {
        const { game, a } = play();
        const idx = Almanac.index(game.player, game.world, opts(game.player));
        const w = Almanac.get(idx, 'pw:pwT1');
        expect(w.name).toBe('Kingsbridge');
        expect(w.links.has(`s:${a.capital.q},${a.capital.r}`)).toBe(true);
        expect(w.links.has('h:player')).toBe(true);
        expect(Almanac.search(idx, 'bridge').map(e => e.id)).toContain('pw:pwT1');
    });

    it('shows a town population over the years, sampled by the Timeline (capped, thinned)', () => {
        const { game, a } = play();
        const { world } = game;
        const st = world.timeline;
        const s = world.getTile(a.capital.q, a.capital.r).settlement;
        const saved = { pops: st.pops, popNext: st.popNext, pop: s.population, day: world.day };
        st.pops = {};
        st.popNext = null;
        const gap = RealmTimeline.config().popEveryYears * Seasons.DAYS_PER_YEAR;
        for (let i = 0; i < 60; i++) {
            s.population = 1000 + i * 10;
            RealmTimeline._popsDaily(world, st, 100 + i * gap);
        }
        const list = RealmTimeline.populationOf(st, a.capital.q, a.capital.r);
        expect(list.length).toBeLessThanOrEqual(RealmTimeline.config().popCap);
        expect(list[0]).toEqual({ day: 100, pop: 1000 });
        expect(list[list.length - 1]).toEqual({ day: 100 + 59 * gap, pop: 1590 });
        // the same day twice takes no second sample
        RealmTimeline._popsDaily(world, st, 100 + 59 * gap + 1);
        expect(RealmTimeline.populationOf(st, a.capital.q, a.capital.r).length).toBe(list.length);
        expect(String(st.pops[`${a.capital.q},${a.capital.r}`]).length).toBeLessThan(400);
        const idx = Almanac.index(game.player, world, { ...opts(game.player), force: true });
        const pg = Almanac.page(idx, `s:${a.capital.q},${a.capital.r}`);
        const sec = pg.sections.find(x => x.title === 'Population over the years');
        expect(sec.rows[0].text).toContain('1,590 souls');
        Object.assign(st, { pops: saved.pops, popNext: saved.popNext });
        s.population = saved.pop;
        Almanac.invalidate(world);
    });

    it('keeps the index for the day, and builds anew the next', () => {
        const { game } = play();
        const { player, world } = game;
        const i1 = Almanac.index(player, world, opts(player));
        expect(Almanac.index(player, world, opts(player))).toBe(i1);
        world.day += 1;
        const i2 = Almanac.index(player, world, opts(player));
        world.day -= 1;
        expect(i2).not.toBe(i1);
        Almanac.invalidate(world);
    });

    it('every link resolves, and each runs both ways', () => {
        const { game } = play();
        const idx = Almanac.index(game.player, game.world, opts(game.player));
        let links = 0;
        for (const e of idx.entries.values()) {
            for (const id of e.links) {
                const other = idx.entries.get(id);
                expect(other, `${e.id} → ${id}`).toBeTruthy();
                expect(other.links.has(e.id), `${id} → ${e.id}`).toBe(true);
                links++;
            }
        }
        expect(links).toBeGreaterThan(20);
        // every page opens, its related entries real
        for (const e of [...idx.entries.values()].slice(0, 400)) {
            const pg = Almanac.page(idx, e.id);
            expect(pg.entry).toBe(e);
            for (const list of Object.values(pg.related)) for (const x of list) expect(idx.entries.get(x.id)).toBe(x);
        }
    });

    it('search finds people, places and events', () => {
        const { game, a } = play();
        const { player, world } = game;
        const idx = Almanac.index(player, world, opts(player));
        const first = String(player.name || player.firstName).split(' ')[0];
        expect(Almanac.search(idx, first).some(e => e.cat === 'person' && e.id.startsWith('p:dyn:'))).toBe(true);
        const town = world.getTile(a.capital.q, a.capital.r).settlement.name;
        const hits = Almanac.search(idx, town.toLowerCase());
        expect(hits[0].cat === 'place' || hits.some(e => e.id === `s:${a.capital.q},${a.capital.r}`)).toBe(true);
        expect(Almanac.search(idx, `war ${a.name}`).some(e => e.kind === 'war')).toBe(true);
        expect(Almanac.search(idx, 'battle', { cat: 'war' }).some(e => e.kind === 'battle')).toBe(true);
        expect(Almanac.search(idx, 'cathedral').map(e => e.id)).toContain('g:gwbT1');
        expect(Almanac.search(idx, 'zzqxv-nothing')).toEqual([]);
    });

    it('turns the names in a line into links', () => {
        const { game, a } = play();
        const idx = Almanac.index(game.player, game.world, opts(game.player));
        const parts = Almanac.mentions(idx, `Envoys of ${a.name} came.`);
        expect(parts.find(p => p.id === `k:${a.id}`).text).toBe(a.name);
        expect(parts.map(p => p.text).join('')).toBe(`Envoys of ${a.name} came.`);
        expect(Almanac.mentions(idx, `Envoys of ${a.name} came.`, `k:${a.id}`).every(p => !p.id)).toBe(true);
    });

    it('reads an empty world without throwing', () => {
        const idx = Almanac.index(null, { day: 1, kingdoms: [], getSettlementViews: () => [] }, {});
        expect(idx.entries.size).toBe(0);
        expect(Almanac.search(idx, 'x')).toEqual([]);
    });
});

describe('the Almanac panel', () => {
    it('lists, searches, opens a page with its links, and walks back', () => {
        const { game, a } = play();
        Almanac.invalidate(game.world);
        game._almanacView = null;
        const rec = shell(game);
        ActionMenu.showAlmanac(game);
        let p = rec.panels.pop();
        expect(p.title).toContain('Almanac');
        expect(p.html).toContain('id="almanacSearch"');
        expect(p.html).toContain('id="almanacResults"');
        expect(p.html).toContain('data-am-act="almanacTab"');

        // a part of it: the places
        ActionMenu.almanacTab(game, 'place');
        p = rec.panels.pop();
        expect(p.html).toContain('recorded');
        expect(p.html).toContain('data-am-act="almanacOpen"');

        // a search
        ActionMenu.showAlmanac(game, { tab: 'index', query: a.name });
        p = rec.panels.pop();
        expect(p.html).toContain('found');

        // a page: the realm's capital
        const id = `s:${a.capital.q},${a.capital.r}`;
        ActionMenu.almanacOpen(game, id);
        p = rec.panels.pop();
        expect(p.html).toContain('See on the map');
        expect(p.html).toContain('almanacMap');
        expect(p.html).toContain('See also');
        expect(p.html).toContain('data-am-act="almanacOpen"');
        expect(p.html).toContain('class="alm-link"');
        expect(p.html).toContain('Back');

        // on to its realm, then back to the town
        ActionMenu.almanacOpen(game, `k:${a.id}`);
        p = rec.panels.pop();
        expect(p.html).toContain(a.name);
        ActionMenu.almanacBack(game);
        expect(game._almanacView.id).toBe(id);
        ActionMenu.almanacBack(game);
        expect(game._almanacView.id).toBe(null);

        // the Timeline link opens the Timeline at its day
        const spy = vi.spyOn(ActionMenu, 'showTimeline').mockImplementation(() => {});
        ActionMenu.almanacTimeline(game, 40, a.capital.q, a.capital.r);
        expect(spy).toHaveBeenCalledWith(game, { day: 40, focus: { q: a.capital.q, r: a.capital.r } });
        spy.mockRestore();
    });

    it('focuses the search box when the Almanac opens, not on every redraw', () => {
        const { game } = play();
        game._almanacView = null;
        shell(game);
        const prev = globalThis.document;
        let open = false, focused = 0;
        const input = { ...el('almanacSearch'), focus() { focused++; } };
        globalThis.document = {
            ...prev,
            getElementById: (id) => (id === 'almanacSearch' ? input : id === 'almanacRoot' ? (open ? { isConnected: true } : null) : el(id)),
        };
        try {
            ActionMenu.showAlmanac(game);
            expect(focused).toBe(1);
            open = true;
            ActionMenu.showAlmanac(game, {});
            ActionMenu.almanacTab(game, 'place');
            expect(focused).toBe(1);
        } finally {
            globalThis.document = prev;
        }
    });
});
