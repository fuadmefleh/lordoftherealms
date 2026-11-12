// The Timeline of the Realm's viewer (ui/actionMenu/timeline.js): the panel
// paints a map canvas, a year slider with play/pause, the strip of ages,
// reigns and wars, the realms of the shown season and its happenings; the
// Annals and the House Chronicle link to it at their day. Rendered against a
// real new game whose record was advanced by hand (borders moved, a battle).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RealmTimeline } from '../systems/realmTimeline.js';
import { loadData, newGame } from './playtest/harness.js';

let ActionMenu, TimelineView, tileAtPoint, logSpy;
const savedDocument = globalThis.document;
let els = new Map();

function el(id) {
    const ctx = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
    return {
        id, style: {}, dataset: {}, innerHTML: '', value: '', width: 0, height: 0,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, querySelector() { return el(); }, querySelectorAll() { return []; },
        setAttribute() {}, getAttribute() { return null; }, remove() {}, insertAdjacentHTML() {}, getContext: () => ctx,
    };
}

function shell(game) {
    const rec = { panels: [] };
    game.ui = new Proxy({
        showCustomPanel: (title, html) => { els = new Map(); rec.panels.push({ title: String(title), html: String(html) }); },
        _panelNav: null,
    }, { get(t, p) { return p in t ? t[p] : (typeof p === 'symbol' ? undefined : () => {}); } });
    return rec;
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

/** A new game with a few seasons on record: a border pushed, a battle, a war. */
function recorded() {
    const game = newGame(5);
    const { world, player } = game;
    RealmTimeline.processDay(world, player);
    const [a, b] = world.kingdoms.filter(k => k.isAlive && k.capital);
    let moved = 0;
    for (let i = 0; i < 4; i++) {
        world.day += 30;
        // b's tiles nearest a's capital pass to a
        for (const row of world.tiles) for (const t of row) {
            if (moved < (i + 1) * 15 && t.kingdom === b.id) { t.kingdom = a.id; moved++; }
        }
        if (i === 1) {
            a.wars.push(b.id);
            b.wars.push(a.id);
            world.timelineFeed.push({ q: b.capital.q, r: b.capital.r, day: world.day, dead: 240, victor: a.name, loser: b.name });
        }
        RealmTimeline.processDay(world, player);
    }
    return { game, a, b };
}

beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.document = {
        getElementById: (id) => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
        createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, body: el(),
    };
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    ({ TimelineView, tileAtPoint } = await import('../ui/actionMenu/timeline.js'));
});
afterAll(() => {
    globalThis.document = savedDocument;
    if (logSpy) logSpy.mockRestore();
});

describe('the Timeline of the Realm panel', () => {
    it('paints the map, the slider, the strip and the season\'s happenings', () => {
        const { game, a, b } = recorded();
        const rec = shell(game);
        ActionMenu.showTimeline(game);
        const p = rec.panels.pop();
        expect(p.title).toContain('Timeline of the Realm');
        const st = game.world.timeline;
        const pts = TimelineView.points(game.world, st);
        expect(pts.length).toBe(st.frames.length + 1); // (the last frame is today)
        // The map canvas sized to the world, the tooltip, the controls
        // (offset hexes: even rows shifted half a hex right, as the main map — the canvas half a hex wider)
        const px = game._timelineView.px;
        expect(px % 2).toBe(0);
        expect(p.html).toMatch(new RegExp(`<canvas id="tlMap" width="${st.w * px + px / 2}" height="${st.h * px}"`));
        expect(p.html).toContain('id="tlTip"');
        expect(p.html).toContain('data-tl="play"');
        expect(p.html).toMatch(new RegExp(`id="tlSlider" type="range" min="0" max="${pts.length - 1}"`));
        // The strip: three lanes; the war between a and b a clickable span
        const t = text(p.html);
        for (const lane of ['Ages', 'Your line', 'Wars']) expect(t).toContain(lane);
        expect(p.html).toMatch(/class="tl-span" data-tl-day="\d+"/);
        expect(p.html).toContain(`${a.name} against ${b.name}`.replace(/'/g, '&#39;'));
        expect(p.html).toContain('id="tlCursor"');
        // After the update: the year, the chips, the legend and the happenings filled
        expect(els.get('tlYear').innerHTML).toMatch(/year \d+/);
        expect(text(els.get('tlChips').innerHTML)).toMatch(/Realms \d+/);
        expect(els.get('tlLegend').innerHTML).toContain(a.name.replace(/'/g, '&#39;'));
        expect(game._timelineView.i).toBe(pts.length - 1);
    });

    it('jumps to a day, and lists the battle of that season with a place to show', () => {
        const { game, a } = recorded();
        const rec = shell(game);
        const st = game.world.timeline;
        const battleDay = st.events.find(e => e[1] === 'battle')[0];
        ActionMenu.showTimeline(game, { day: battleDay });
        rec.panels.pop();
        const view = game._timelineView;
        expect(view.pts[view.i].day).toBe(battleDay);
        const ev = text(els.get('tlEvents').innerHTML);
        expect(ev).toContain(`${a.name} defeated`);
        expect(ev).toContain('went to war');
        expect(els.get('tlEvents').innerHTML).toMatch(/data-tl-focus="\d+,\d+"/);
        // The grid shown is the record's as of that frame
        const grid = RealmTimeline.gridAt(st, view.pts[view.i].index);
        expect(view.lastGrid ? Array.from(view.lastGrid.grid) : Array.from(grid)).toEqual(Array.from(grid));
    });

    it('says the record is not yet begun before the first day ends', () => {
        const game = newGame(6);
        const rec = shell(game);
        ActionMenu.showTimeline(game);
        expect(text(rec.panels.pop().html)).toContain('not yet begun');
    });

    it('is linked from the Annals and the House Chronicle at their day', () => {
        const { game } = recorded();
        const rec = shell(game);
        ActionMenu.showAnnals(game);
        expect(rec.panels.pop().html).toMatch(/data-am-act="showTimeline" data-am-args='\[\{"day":\d+\}\]'/);
        ActionMenu.showHouseChronicle(game);
        expect(rec.panels.pop().html).toContain('data-am-act="showTimeline"');
    });

    it('finds the hex under a point the way the offset rows lie', () => {
        // px 8: row 0 (even) starts at x 4, row 1 (odd) at x 0
        expect(tileAtPoint(2, 3, 8, 10, 10)).toBe(null);
        expect(tileAtPoint(5, 3, 8, 10, 10)).toEqual({ q: 0, r: 0 });
        expect(tileAtPoint(2, 11, 8, 10, 10)).toEqual({ q: 0, r: 1 });
        expect(tileAtPoint(12, 11, 8, 10, 10)).toEqual({ q: 1, r: 1 });
        expect(tileAtPoint(12, 3, 8, 10, 10)).toEqual({ q: 1, r: 0 });
    });

    it("lays the climate's eras in the Ages lane beside the crises", () => {
        const { game } = recorded();
        const world = game.world;
        const st = world.timeline;
        // A long record: the strip reaches far enough for an era to have begun
        world.day = 120 * 80;
        const strip = RealmTimeline.strip(world, st);
        const ages = strip.lanes.find(l => l.id === 'ages').spans;
        const clim = ages.filter(a => a.tone === 'cool');
        expect(clim.length).toBeGreaterThan(0);
        for (const a of clim) {
            expect(a.from).toBeGreaterThanOrEqual(strip.from);
            expect(a.to).toBeLessThanOrEqual(strip.to);
            expect(a.label.length).toBeGreaterThan(2);
        }
        const html = TimelineView.stripHtml(world, st);
        expect(html).toContain(clim[0].label.replace(/'/g, '&#39;'));
    });

    it("is linked from the Age panel at a crisis's start", () => {
        const { game } = recorded();
        const rec = shell(game);
        const world = game.world;
        const c = { uid: 'plague9', kind: 'plague', name: 'the great plague', startDay: world.timeline.base.d + 30, endDay: world.day, outcome: 'passed', place: { q: 7, r: 9 }, log: [], data: {}, phase: 'aftermath' };
        world.crises = { v: 1, seq: 9, active: null, history: [c], news: [], nextDay: world.day + 999, lastKind: 'plague' };
        ActionMenu.showCrisesPanel(game);
        const html = rec.panels.pop().html;
        expect(html).toContain('data-am-act="showTimeline"');
        expect(html).toContain(`&quot;day&quot;:${c.startDay}`);
        expect(html).toContain('&quot;focus&quot;:{&quot;q&quot;:7,&quot;r&quot;:9}');
    });
});
