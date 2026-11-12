// The illustrated chronicle (systems/chronicleMaps.js, systems/chronicleBook.js,
// ui/chronicleBook.js): border maps taken as the game runs, compactly; the
// book composed from the Annals with a map per reign, key moments, a family
// tree and an appendix; rendered as one self-contained HTML file.
// CHRONICLE_SAMPLE=<path> writes the harness book there.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import { loadData, newGame, endDay, roundTrip, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { ChronicleMaps } from '../systems/chronicleMaps.js';
import { ChronicleBook } from '../systems/chronicleBook.js';
import { render, mapSvg } from '../ui/chronicleBook.js';
import { Relationships } from '../systems/relationships.js';
import { House } from '../systems/house.js';
import { MetaLegacy } from '../systems/metaLegacy.js';
import { Afterlife } from '../player/afterlife.js';
import { HallChronicles } from '../ui/hallChronicles.js';

beforeAll(async () => {
    await loadData();
});

/** A small mock world: two realms side by side, a sea along the bottom. */
function mockWorld(day = 1) {
    const W = 20, H = 10;
    const kingdoms = { 1: { id: 1, name: 'Avel', color: '#aa3333', capital: { q: 3, r: 3 } }, 2: { id: 2, name: 'Brosk', color: '#3355aa', capital: { q: 15, r: 4 } } };
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            if (r >= 8) row.push({ terrain: { id: 'ocean' }, kingdom: null });
            else row.push({ terrain: { id: q === 10 ? 'mountains' : 'grassland' }, kingdom: q < 9 ? 1 : q > 10 ? 2 : null });
        }
        tiles.push(row);
    }
    return { day, baseYear: 1000, width: W, height: H, tiles, kingdoms: Object.values(kingdoms), getKingdom: id => kingdoms[id] || null };
}

describe('ChronicleMaps — border snapshots', () => {
    it('encodes the realm compactly and decodes the same grid', () => {
        const world = mockWorld(5);
        const m = ChronicleMaps.snapshot(world, { holdings: { keys: ['2,2'] }, throne: { ruling: { kingdomId: 2 } } }, { kind: 'era', label: 'x' });
        expect(m.w).toBe(20);
        expect(m.h).toBe(10);
        const rows = ChronicleMaps.decode(m);
        expect(rows).toHaveLength(10);
        expect(rows[0]).toBe('A'.repeat(9) + '.^' + 'B'.repeat(9));
        expect(rows[9]).toBe('~'.repeat(20));
        expect(m.rows.split('/')[0]).toBe('A9.^B9');
        expect(m.realms.map(r => r[2])).toEqual(['Avel', 'Brosk']);
        expect(m.crown).toBe('B');
        expect(m.own).toEqual([2 * 20 + 2]);
        expect(m.seats).toContainEqual(['A', 3, 3]);
        const svg = mapSvg(m);
        expect(svg).toMatch(/^<svg class="map"/);
        expect(svg).toContain('#aa3333');
        expect(svg).toContain('Brosk ♛');
    });

    it('takes the founding, a reign end and a crown; thins to the cap', () => {
        const world = mockWorld(1);
        const player = { name: 'Aldric Vell', gender: 'male', house: { name: 'House Vell', foundedDay: 1, reigns: [], currentReign: { generation: 1, startDay: 1 } }, throne: { ruling: null } };
        ChronicleMaps.processDay(player, world);
        const st = player.house.chronicleBook;
        expect(st.maps.map(m => m.kind)).toEqual(['founding']);
        expect(st.rulers.g1_1.name).toBe('Aldric Vell');
        world.day = 50;
        player.throne.ruling = { kingdomId: 1 };
        ChronicleMaps.processDay(player, world);
        expect(st.maps.map(m => m.kind)).toEqual(['founding', 'crownWon']);
        world.day = 200;
        player.house.history = [{ day: 120, generation: 1, text: 'House Vell besieges Kettle.', tags: ['war', 'siege'] }, { day: 130, generation: 1, text: 'A feast.', tags: ['court'] }];
        player.house.reigns.push({ name: 'Aldric Vell', generation: 1, startDay: 1, endDay: 199 });
        player.house.currentReign = { generation: 2, startDay: 199 };
        ChronicleMaps.processDay(player, world);
        expect(st.maps.find(m => m.kind === 'end').reign).toBe('g1_1');
        expect(st.moments.g1_1.map(m => m.text)).toEqual(['House Vell besieges Kettle.']);
        // The same day again takes nothing more
        expect(ChronicleMaps.processDay(player, world)).toBeNull();
        // A century of era maps stays under the cap, founding and reign ends kept
        for (let y = 1; y <= 200; y++) {
            world.day = 200 + y * 30 * 120;
            ChronicleMaps.processDay(player, world);
        }
        const cap = ChronicleMaps.config().mapCap;
        expect(st.maps.length).toBeLessThanOrEqual(cap);
        expect(st.maps[0].kind).toBe('founding');
        expect(st.maps.some(m => m.kind === 'end')).toBe(true);
    });

    it('sorts chronicle lines into battles, works and deaths', () => {
        expect(ChronicleMaps.classify({ tags: ['war'], text: 'x' })).toBe('battles');
        expect(ChronicleMaps.classify({ tags: ['greatWork', 'patronage'], text: 'x' })).toBe('works');
        expect(ChronicleMaps.classify({ tags: ['court'], text: 'Old Tam of the court dies.' })).toBe('deaths');
        expect(ChronicleMaps.classify({ tags: ['court'], text: 'A feast is held.' })).toBeNull();
    });
});

describe('battles in the book', () => {
    it('a battle the House fought is listed with its date, place, foe and outcome, and filed with the reign', () => {
        const world = mockWorld(130);
        world.getTile = (q, r) => (world.tiles[r] && world.tiles[r][q]) || null;
        world.getTile(3, 3).settlement = { name: 'Kettle', type: 'town' };
        world.getSettlementViews = () => [{ name: 'Kettle', q: 3, r: 3 }];
        const reign = { name: 'Aldric Vell', generation: 1, startDay: 1, live: true };
        const player = { name: 'Aldric Vell', house: { name: 'House Vell', generation: 1, foundedDay: 1, reigns: [], currentReign: { generation: 1, startDay: 1 } } };
        // Two steps from Kettle in the field, won; a skirmish below minStrength, not chronicled
        const e = House.recordBattle(player, world, { kind: 'field', outcome: 'victory', foe: 'the Brosk host', q: 5, r: 3, strength: 300 });
        expect(e.tags).toEqual(expect.arrayContaining(['war', 'battle']));
        expect(House.recordBattle(player, world, { kind: 'field', outcome: 'victory', foe: 'two footpads', q: 5, r: 3, strength: 3 })).toBeNull();
        world.day = 200;
        House.recordBattle(player, world, { kind: 'assault', outcome: 'defeat', foe: 'Brosk', place: 'Harrow' });
        const m = ChronicleBook.moments(player, world, reign);
        expect(m.battles).toHaveLength(2);
        const [won, lost] = m.battles;
        expect(won).toMatchObject({ day: 130, year: ChronicleMaps.year(world, 130), place: 'Kettle', foe: 'the Brosk host', outcome: 'victory' });
        expect(won.text).toMatch(/defeated the Brosk host in battle near Kettle/);
        expect(lost).toMatchObject({ day: 200, place: 'Harrow', foe: 'Brosk', outcome: 'defeat' });
        expect(lost.text).toMatch(/assault on Harrow was thrown back by Brosk/);
        // The reign closes: its battles filed keep their particulars after the chronicle forgets them
        player.house.reigns.push({ name: 'Aldric Vell', generation: 1, startDay: 1, endDay: 210 });
        player.house.currentReign = { generation: 2, startDay: 210 };
        world.day = 211;
        ChronicleMaps.processDay(player, world);
        player.house.history = [];
        const filed = ChronicleBook.moments(player, world, { ...player.house.reigns[0], live: false });
        expect(filed.battles.map(b => [b.place, b.foe, b.outcome])).toEqual([['Kettle', 'the Brosk host', 'victory'], ['Harrow', 'Brosk', 'defeat']]);
    });
});

describe('the illustrated chronicle — a played game across two reigns (harness)', () => {
    it('builds a book with a map per reign, the tree and the appendix; saves compactly', () => {
        const game = newGame(5150);
        game.player.gold += 20000;
        for (let d = 0; d < 120; d++) {
            botDay(game, {});
            if (endDay(game).died) break;
        }
        const founder = game.player.name;
        const heir = Relationships.generateChild(game.player, { culture: 'Imperial' }, game.world);
        heir.age = 20;
        endDay(game); // (the birth is noted on the day's tick)
        expect(game.player.house.chronicleBook.rulers[ChronicleMaps.reignId(ChronicleMaps._currentReign(game.player.house))].children.map(c => c.name)).toContain([heir.firstName, heir.lastName].filter(Boolean).join(' '));
        const how = carryOn(game, 'a fever');
        expect(how.how).toBe('heir');
        for (let d = 0; d < 60; d++) {
            botDay(game, {});
            if (endDay(game).died) break;
        }
        const { player, world } = game;
        const st = player.house.chronicleBook;
        expect(st.maps[0].kind).toBe('founding');
        expect(st.maps.some(m => m.kind === 'end')).toBe(true);
        // A century's worth stays small: this whole state is a few KB here
        expect(JSON.stringify(st).length).toBeLessThan(20000);

        const book = ChronicleBook.compose(player, world, { spouseName: null });
        expect(book.sections).toHaveLength(2);
        expect(book.sections[0].ruler.name).toBe(founder);
        for (const s of book.sections) expect(s.map && s.map.rows).toBeTruthy();
        expect(book.sections[0].map.kind).toBe('end');
        expect(book.sections[0].moments.deaths.some(m => /a fever/.test(m.text))).toBe(true);
        expect(book.tree.line).toHaveLength(2);
        expect(book.tree.line[0].children.some(c => c.ruled)).toBe(true);
        expect(book.atlas.length).toBeGreaterThanOrEqual(2);

        const html = render(book, {
            portraits: { [book.sections[1].id]: 'data:image/png;base64,iVBORw0KGgo=' },
            prose: key => (key === `book:${book.houseId}:foreword` ? 'Written by the model: a foreword.' : null),
        });
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('<svg class="arms"');
        expect((html.match(/<section class="page chapter"/g) || []).length).toBe(2);
        expect((html.match(/<svg class="map"/g) || []).length).toBeGreaterThanOrEqual(4);
        for (const id of ['title', 'contents', 'legacy', 'atlas', 'tree', 'appendix']) expect(html).toContain(`id="${id}"`);
        expect(html).toContain('Written by the model: a foreword.');
        expect(html).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
        expect(html).toContain('class="portrait medallion');
        expect(html).toContain('@media print');
        expect(html).toContain(founder);
        // Self-contained: nothing fetched from elsewhere
        expect(html).not.toMatch(/<(script|link)\b[^>]*(src|href)=/i);
        expect(html).not.toMatch(/(src|href)="https?:/i);
        if (process.env.CHRONICLE_SAMPLE) fs.writeFileSync(process.env.CHRONICLE_SAMPLE, render(book, {}), 'utf8');

        // The maps and notes ride with the House through a save
        const loaded = roundTrip(game);
        expect(loaded.player.house.chronicleBook.maps).toEqual(st.maps);
        const again = ChronicleBook.compose(loaded.player, loaded.world);
        expect(again.sections.map(s => s.chapter.title)).toEqual(book.sections.map(s => s.chapter.title));
    }, 300000);

    it('carries the age\'s crises as "The ages of the world", in calendar years', async () => {
        const { Crises } = await import('../systems/crises.js');
        const game = newGame(5151);
        endDay(game);
        const c = Crises.start(game.world, 'plague', { force: true });
        expect(c).toBeTruthy();
        endDay(game);
        const book = ChronicleBook.compose(game.player, game.world, { spouseName: null });
        expect(book.ages.length).toBe(1);
        expect(book.ages[0].fromYear).toBe(book.year);
        expect(book.ages[0].paragraphs.length).toBeGreaterThan(0);
        const html = render(book, {});
        expect(html).toContain('id="ages"');
        expect(html).toContain('href="#ages"');
        expect(html).toContain(book.ages[0].title.replace(/&/g, '&amp;'));
    }, 120000);

    it('composes for a player without a House or any maps', () => {
        const world = mockWorld(10);
        const book = ChronicleBook.compose({ name: 'Nobody', gold: 3 }, world);
        const html = render(book, {});
        expect(html).toContain('id="appendix"');
    });
});

// A House that ends because the player takes a new life (player/afterlife.js
// becomeStranger) is filed in the Hall of Houses like any ended line, and its
// chronicle book is built from the OLD player — the game has already moved on
// to the new one (ui/hallChronicles.js archive with opts.player).
describe('the chronicle of a House ended by a new life', () => {
    it('is filed in the Hall and its book kept, built from the House that ended', async () => {
        const mem = new Map();
        MetaLegacy.storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); } };
        const kept = [];
        const save = vi.spyOn(HallChronicles, 'save').mockImplementation(async (id, rec) => { kept.push({ id, rec }); return true; });
        try {
            const game = newGame(5151);
            game.world.run = MetaLegacy.newRun({ seed: 5151, now: 1 });
            const old = game.player;
            const houseName = old.house.name;
            const cand = Afterlife.candidates(game.world)[0];
            const res = Afterlife.becomeStranger(old, game.world, cand);
            expect(res.success).toBe(true);
            // The game moves on to the new life
            game.player = res.player;
            const entry = MetaLegacy.lastEntryFor(game.world.run.id, houseName);
            expect(entry).toBeTruthy();
            expect(old.house.ended).toBeTruthy();

            // Built from game.player alone (the new life's House, never filed) nothing is kept...
            expect(await HallChronicles.archive(game)).toBe(false);
            // ...from the House that ended, its book
            expect(await HallChronicles.archive(game, { player: old })).toBe(true);
            expect(kept.length).toBe(1);
            expect(kept[0].id).toBe(entry.id);
            expect(kept[0].rec.html).toContain(houseName.replace(/^House /, ''));
            expect(kept[0].rec.html).toContain('id="appendix"');
            expect(MetaLegacy.lastEntryFor(game.world.run.id, houseName).chronicle).toMatchObject({ store: 'indexedDB' });
        } finally {
            save.mockRestore();
            MetaLegacy.storage = null;
        }
    }, 240000);
});
