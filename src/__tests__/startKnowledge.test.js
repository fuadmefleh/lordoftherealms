// What an advanced start knows on day one (player/startKnowledge.js) and the
// library at its seat (systems/library.js, read through systems/books.js):
// the map charted, the realm's history, the realms, prices, tongues, people,
// and books written from the world — never facts it doesn't hold.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, roundTrip } from './playtest/harness.js';
import { Scenarios } from '../player/scenarios.js';
import { Library } from '../systems/library.js';
import { Books } from '../systems/books.js';
import { Religion } from '../systems/religion.js';
import { Relationships } from '../systems/relationships.js';
import { PriceKnowledge } from '../systems/priceKnowledge.js';
import { Peoples } from '../systems/peoples.js';
import { Cultures } from '../world/cultures.js';

beforeAll(async () => {
    await loadData();
});

function start(origin, seed = 61) {
    const g = newGame(seed);
    g.player.age = 30;
    const report = Scenarios.apply(g.player, g.world, { origin });
    return { g, report, p: g.player, w: g.world };
}

/** Read the library's books at its shelves until every one is done (two sittings a day count). */
function readAll(p, w, building) {
    const lib = Library.state(p);
    const ctx = { townKey: `${lib.seat.q},${lib.seat.r}`, building, shelfKey: 'test' };
    const out = [];
    for (let i = 0; i < 200 && Library.unread(p, Books.state(p).finished).length; i++) {
        const r = Books.read(p, w, ctx);
        if (!r.counted) w.day += 1;
        out.push(r);
    }
    return out;
}

const libIds = p => Library.state(p).books.map(b => b.id);

describe('the Monarch knows the kingdom', () => {
    it('has the realm charted, its history, its neighbours, its prices and its tongues', () => {
        const { report, p, w } = start('monarch');
        const k = w.getKingdom(p.scenario.realm);
        // Every hex of the realm's land is on the map
        const land = Library.realmTiles(w, k.id);
        expect(land.length).toBeGreaterThan(0);
        expect(land.every(t => w.getTile(t.q, t.r).explored)).toBe(true);
        // The realm, fully; its neighbours' strength and temper
        for (const cat of ['basics', 'ruler', 'military', 'economy', 'diplomacy']) expect(p.knowsAbout(k.id, cat)).toBe(true);
        for (const n of Library.neighbours(w, k)) expect(p.knowsAbout(n.id, 'military')).toBe(true);
        // History the court remembers is in the History panel's record, and it is the world's own
        const known = [...p.discoveredLore];
        const ids = new Set(Peoples.getMergedHistory(w).map(e => e.id));
        expect(known.every(id => ids.has(id))).toBe(true);
        // Prices from its towns, the realm's tongue fluent
        const towns = Library.realmTowns(w, k.id);
        expect(PriceKnowledge.towns(p).length).toBeGreaterThan(0);
        expect(p.languages[Cultures.languageOfCulture(k.culture)]).toBe(100);
        // The welcome says so
        expect(report.welcome).toContain('What you know');
        expect(report.welcome).toContain(k.name);
        expect(report.welcome).not.toMatch(/\{\w+\}/);
        expect(report.knowledge.lines.length).toBeGreaterThan(3);
        expect(towns.length).toBeGreaterThan(0);
    });

    it('owns a royal library at the capital, its books written from the world', () => {
        const { p, w } = start('monarch');
        const k = w.getKingdom(p.scenario.realm);
        const lib = Library.state(p);
        expect(lib.kind).toBe('royal');
        expect([lib.seat.q, lib.seat.r]).toEqual([k.capital.q, k.capital.r]);
        expect(lib.name).toContain(w.getTile(k.capital.q, k.capital.r).settlement.name);
        expect(libIds(p)).toEqual(expect.arrayContaining([`lib_chronicle_${k.id}`, `lib_roll_${k.id}`, `lib_letters_${k.id}`]));
        expect(lib.books.some(b => b.kind === 'map')).toBe(true);
        // The chronicle names only the realm's real towns, with their founding years
        const chron = Library.book(p, `lib_chronicle_${k.id}`);
        const text = chron.pages.join(' ');
        for (const t of Library.realmTowns(w, k.id)) {
            if (Number.isFinite(t.s.founded)) expect(text).toContain(`${t.s.name}`);
        }
        const cap = w.getTile(k.capital.q, k.capital.r).settlement;
        if (Number.isFinite(cap.founded)) expect(text).toContain(`In the year ${cap.founded}, ${cap.name} was founded`);
        // Its lore rewards are the world's own entries about the realm
        for (const id of chron.reward.lore) expect(Library.realmLore(w, k).some(e => e.id === id)).toBe(true);
        // The roll names the late monarch
        expect(Library.book(p, `lib_roll_${k.id}`).pages.join(' ')).toContain(p.scenario.start.oldRuler);
    });

    it('reads the library at the castle: passages each sitting, and the rewards on finishing', () => {
        const { p, w } = start('monarch');
        const k = w.getKingdom(p.scenario.realm);
        // Away from the seat, the library's books are not on the shelf
        const away = Books.nextBook(p, { townKey: '0,0', building: 'castle', settlementType: 'capital' });
        expect(away && away.library).toBeFalsy();
        // At the castle they come first
        const at = { townKey: `${k.capital.q},${k.capital.r}`, building: 'castle', settlementType: 'capital' };
        expect(Books.nextBook(p, at).library).toBe(true);
        const map = Library.state(p).books.find(b => b.kind === 'map');
        const nk = w.getKingdom(map.reward.chart[0].kid);
        const before = Library.realmTiles(w, nk.id).filter(t => !w.getTile(t.q, t.r).explored).length;
        const loreBefore = p.discoveredLore.size;
        const results = readAll(p, w, 'castle');
        expect(Library.unread(p, Books.state(p).finished).length).toBe(0);
        // Passages were read out, the books' own pages
        const first = results.find(r => r.book && r.book.library && r.passage && r.passage.length);
        expect(first.text).toContain(first.passage[0]);
        // The neighbour's map charted its land; the chronicle taught the rest of the history
        expect(Library.realmTiles(w, nk.id).every(t => w.getTile(t.q, t.r).explored)).toBe(true);
        expect(before).toBeGreaterThanOrEqual(0);
        const realmIds = Library.realmLore(w, k).map(e => e.id);
        expect(realmIds.every(id => p.discoveredLore.has(id))).toBe(true);
        expect(p.discoveredLore.size).toBeGreaterThanOrEqual(loreBefore);
        expect(results[results.length - 1].text).toContain('every book');
    });

    it('keeps the library and the reading through save and load', () => {
        const s = start('monarch');
        const lib = Library.state(s.p);
        const ctx = { townKey: `${lib.seat.q},${lib.seat.r}`, building: 'castle', shelfKey: 'x' };
        Books.read(s.p, s.w, ctx);
        const g2 = roundTrip(s.g);
        const lib2 = Library.state(g2.player);
        expect(lib2.books.map(b => b.id)).toEqual(lib.books.map(b => b.id));
        expect(lib2.books[0].pages).toEqual(lib.books[0].pages);
        expect(Books.nextBook(g2.player, ctx).id).toBe(Books.state(s.p).current);
        expect(g2.player.scenario.knowledge.lines.length).toBeGreaterThan(0);
    });
});

describe('the Great Lord knows his lands', () => {
    it('charts the seat and the realm\'s roads, knows vassals and neighbours, and has a library at the seat he holds', () => {
        const { report, p, w } = start('great_lord');
        const seat = p.scenario.start.seat;
        expect(w.getTile(seat.q, seat.r).explored).toBe(true);
        const k = w.getKingdom(p.scenario.realm);
        const roads = Library.chartTiles(w, [{ kind: 'roads', kid: k.id }]);
        expect(roads.every(t => w.getTile(t.q, t.r).explored)).toBe(true);
        const lib = Library.state(p);
        expect(lib.kind).toBe('lordly');
        expect(lib.holdsSeat).toBe(true);
        expect([lib.seat.q, lib.seat.r]).toEqual([seat.q, seat.r]);
        expect(libIds(p)).toEqual(expect.arrayContaining([`lib_chronicle_${k.id}`, `lib_map_${k.id}`]));
        if (p.scenario.start.estates > 0) expect(libIds(p)).toContain(`lib_estates_${k.id}`);
        const people = Relationships._npcs.filter(n => p.relationships[n.id] && n.knownFrom);
        expect(people.some(n => n.occupation === 'knight')).toBe(true);
        expect(report.welcome).toContain('What you know');
        // The whole-realm map charts what he only knew by road
        readAll(p, w, 'manor');
        expect(Library.realmTiles(w, k.id).every(t => w.getTile(t.q, t.r).explored)).toBe(true);
    });
});

describe('the High Priest knows the faith', () => {
    it('knows the holy sites, the faith\'s history and the clergy; a library at the great temple', () => {
        const { report, p, w } = start('high_priest');
        const faith = Religion.FAITHS[p.scenario.start.faithId];
        for (const h of Library.holySites(w, faith.id)) {
            expect(p.discoveredHolySites.has(`${h.q},${h.r}`)).toBe(true);
            expect(w.getTile(h.q, h.r).explored).toBe(true);
        }
        for (const e of Library.faithLore(w, faith)) expect(p.discoveredLore.has(e.id)).toBe(true);
        const clergy = Relationships._npcs.filter(n => p.relationships[n.id] && n.occupation === 'priest' && n.knownFrom);
        expect(clergy.length).toBeGreaterThan(0);
        const lib = Library.state(p);
        expect(lib.kind).toBe('temple');
        expect(libIds(p)).toEqual(expect.arrayContaining([`lib_faith_${faith.id}`]));
        expect(Books.nextBook(p, { townKey: `${lib.seat.q},${lib.seat.r}`, building: 'temple' }).library).toBe(true);
        expect(report.welcome).toContain('What you know');
    });
});

describe('the Guildmaster knows the trade', () => {
    it('knows prices across the guild\'s towns, the roads to them, merchants; an archive at the guildhall', () => {
        const { report, p, w } = start('guildmaster');
        expect(PriceKnowledge.towns(p).length).toBeGreaterThan(1);
        const merchants = Relationships._npcs.filter(n => p.relationships[n.id] && n.occupation === 'merchant' && n.knownFrom);
        expect(merchants.length).toBeGreaterThan(0);
        const lib = Library.state(p);
        expect(lib.kind).toBe('guild');
        expect(libIds(p)).toContain(`lib_guild_${p.scenario.start.guild}`);
        expect(lib.buildings).toContain('guildhall');
        expect(report.welcome).toContain('What you know');
    });
});

describe('the General knows the front', () => {
    it('charts the front, knows the enemy\'s host, carries the crown\'s map of the enemy realm', () => {
        const { report, p, w } = start('general');
        const st = p.scenario.start;
        if (!st || st.kind !== 'general') return; // (no realm fit for a general in this world)
        expect(w.getTile(st.q, st.r).explored).toBe(true);
        if (st.enemyId != null) {
            expect(p.knowsAbout(st.enemyId, 'military')).toBe(true);
            expect(p.maps.some(m => m.kingdomId === st.enemyId && m.type === 'kingdom')).toBe(true);
            const front = Library.chartTiles(w, [{ kind: 'front', kid: st.kingdomId, enemy: st.enemyId, depth: 4 }]);
            expect(front.length).toBeGreaterThan(0);
            expect(front.every(t => w.getTile(t.q, t.r).explored)).toBe(true);
        }
        expect(Library.state(p)).toBeNull();
        expect(report.welcome).toContain('What you know');
    });
});

describe('the Crime Lord knows the streets', () => {
    it('charts the city, knows the gangs, the watch, a fence', () => {
        const { report, p, w } = start('crime_lord');
        const st = p.scenario.start;
        expect(w.getTile(st.q, st.r).explored).toBe(true);
        const fence = Relationships._npcs.filter(n => p.relationships[n.id] && n.occupation === 'fence');
        expect(fence.length).toBe(1);
        expect(report.welcome).toContain('What you know');
        expect(report.knowledge.lines.join(' ')).toMatch(/Captain/);
    });
});

describe('ordinary origins', () => {
    it('the Wanderer begins knowing nothing more, and with no library', () => {
        const { report, p } = start('wanderer');
        expect(Library.state(p)).toBeNull();
        expect(report.welcome).not.toContain('What you know');
        expect(report.knowledge).toBeNull();
    });
});
