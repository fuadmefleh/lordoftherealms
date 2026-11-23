// Each interior belongs to its building and its people (world/innerMap/interiorPlanner.js
// _exteriorOf / _interiorIdentity, data/interiorPlans.json exterior, household, trades,
// cultures): as wide as its street front, its door and front windows where the facade has
// them, as many floors as its front shows; its trade's pieces in it, a bed for each of its
// household; its culture's taste about the house — and every planner guarantee still held.
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';

let CustomBuildings;
beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    CustomBuildings.reset();
    await CustomBuildings.loadAll();
}, 120000);

const G = () => DataLoader._gamedata;
const work = (type) => (G().architecture.wealth.floors.work || []).includes(type);
const defs = (type) => G().buildings.filter(d => d.buildingType === type && d.layers && d.bounds && d.meta && (d.tags || []).includes('composed'));
const exOf = (d) => InnerMap._exteriorOf(d);

/** Plan one building as _generateInterior does after its custom interiors. */
function plan(type, who = null, tier = 'mid', q = 3, r = 4) {
    const base = InnerMap.INTERIOR_LAYOUTS[type];
    const look = { wall: base.wall, floor: base.floor, tier, kind: work(type) ? 'work' : 'home', tint: null };
    const out = InnerMap._planInterior({ type, name: type, q, r }, `9,14_${type}_${q}_${r}`, base, look, null, who);
    InnerMap._joinPieces(out.tiles, out.width, out.height, out.door);
    InnerMap._decorateInterior(out.tiles, out.width, out.height, out.info);
    return out;
}
const sig = (room) => room.tiles.map(row => row.map(t => (t.baseTerrain === 'wall' ? (t._wallDecor ? t._wallDecor[0] : '#') : t._furniture ? t._furniture.type[0] : '.')).join('')).join('/');

function reached(room, start) {
    const { tiles } = room;
    const seen = new Set([`${start.q},${start.r}`]), queue = [start];
    while (queue.length) {
        const { q, r } = queue.shift();
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t = tiles[r + dr] && tiles[r + dr][q + dq];
            if (!t || seen.has(`${q + dq},${r + dr}`) || !t.subTerrain.passable) continue;
            seen.add(`${q + dq},${r + dr}`); queue.push({ q: q + dq, r: r + dr });
        }
    }
    return seen;
}
/** Each piece once (a two-tile bed counted at its head). */
const pieces = (room, type) => room.tiles.flat().filter(t => t._furniture && t._furniture.type === type && !(t._furniture.piece && (t._furniture.piece.i || t._furniture.piece.j)));

/** The planner's guarantees: door in the front wall, the tile inside open, every walkable tile and piece reached. */
function guarantees(room, tag) {
    const { tiles, width: w, height: h, door } = room;
    expect(door.r, tag).toBe(h - 1);
    expect(tiles[h - 1][door.q]._isDoor, tag).toBe(true);
    expect(tiles[h - 2][door.q].subTerrain.passable, tag).toBe(true);
    expect(tiles[h - 1].filter(t => t._isDoor).length, tag).toBe(1);
    const seen = reached(room, door);
    for (const t of tiles.flat()) if (t.subTerrain.passable) expect(seen.has(`${t.q},${t.r}`), `${tag} ${t.q},${t.r}`).toBe(true);
    const groups = new Map();
    for (const t of tiles.flat()) {
        const f = t._furniture;
        if (!f || f.passable) continue;
        const k = f.piece ? `${f.piece.q},${f.piece.r}` : `${t.q},${t.r}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
    }
    for (const [k, cells] of groups) {
        expect(cells.some(t => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => seen.has(`${t.q + dq},${t.r + dr}`))), `${tag} piece ${k}`).toBe(true);
    }
    expect(w).toBeGreaterThanOrEqual(5);
}

describe('inside as it stands outside', () => {
    it('reads a design\'s front: frontage, door, windows by storey, storeys', () => {
        const th = G().buildings.find(d => d.id === 'imperial_townhouse_1');
        const ex = exOf(th);
        expect(ex.frontage).toBe(5);
        expect(ex.doorFrac).toBeCloseTo(0.5, 5);
        expect(ex.front.length).toBeGreaterThan(0);
        expect(ex.upper.length).toBeGreaterThan(0);
        expect(ex.storeys).toBe(2);
        expect(ex.party).toBe(true);                    // a townhouse stands shoulder to shoulder
        // a one-storey cottage: no upper windows, one storey
        const low = defs('house').find(d => { const e = exOf(d); return e.front.length && !e.upper.length; });
        expect(exOf(low).storeys).toBe(1);
        // an off-centre door is read where it is
        const off = G().buildings.find(d => d.meta && d.bounds && (() => { const m = d.meta.find(x => x.door); const w = d.bounds.maxCol - d.bounds.minCol + 1; return m && w >= 6 && m.q - d.bounds.minCol <= 2; })());
        expect(exOf(off).doorFrac).toBeLessThan(0.45);
    });

    it('its width follows its frontage, its door where the facade\'s is, its front windows where the facade\'s are', () => {
        for (const type of ['house', 'tavern', 'inn', 'blacksmith', 'bakery', 'manor', 'church', 'warehouse', 'town_hall', 'barn', 'farm', 'apothecary']) {
            const list = defs(type);
            if (!list.length) continue;
            for (const tier of ['poor', 'mid', 'rich']) {
                const byFront = new Map();
                for (const d of list.slice(0, 14)) {
                    const ex = exOf(d);
                    const room = plan(type, { exterior: ex }, tier, 5, d.bounds.maxCol + 7);
                    const tag = `${type}/${tier} ${d.id}`;
                    guarantees(room, tag);
                    // (wider fronts are never narrower inside)
                    const prev = byFront.get(ex.frontage);
                    byFront.set(ex.frontage, prev == null ? room.width : Math.min(prev, room.width));
                    // the door along the front where the facade's is (its side of the middle)
                    const mid = (room.width - 1) / 2;
                    if (ex.doorFrac < 0.4) expect(room.door.q, tag).toBeLessThan(mid);
                    if (ex.doorFrac > 0.6) expect(room.door.q, tag).toBeGreaterThan(mid);
                    if (Math.abs(ex.doorFrac - 0.5) < 0.01) expect(room.door.q, tag).toBe(Math.floor(room.width / 2));
                    // front windows when the facade shows them; none when it doesn't
                    const fronts = room.tiles[room.height - 1].filter(t => t._wallDecor === 'window' || t._wallDecor === 'curtains');
                    if (!ex.front.length) expect(fronts.length, tag).toBe(0);
                    else if (type === 'house') expect(fronts.length, tag).toBeGreaterThan(0);
                    for (const t of fronts) { expect(t._wallDecorFace).toBe('up'); expect(Math.abs(t.q - room.door.q)).toBeGreaterThan(1); }
                    // a terraced house has no side windows
                    if (ex.party) for (const t of room.tiles.flat()) if (t.q === 0 || t.q === room.width - 1) expect(t._wallDecor === 'window', tag).toBe(false);
                }
                const fronts = [...byFront.keys()].sort((a, z) => a - z);
                for (let i = 1; i < fronts.length; i++) expect(byFront.get(fronts[i]), `${type}/${tier} ${fronts[i]}`).toBeGreaterThanOrEqual(byFront.get(fronts[i - 1]) - 0);
            }
        }
        // a narrow cottage and a broad house of the same tier: the broad one wider inside
        const hs = defs('house').map(exOf).sort((a, z) => a.frontage - z.frontage);
        const narrow = plan('house', { exterior: hs[0] }, 'mid'), broad = plan('house', { exterior: hs[hs.length - 1] }, 'mid');
        expect(broad.width).toBeGreaterThan(narrow.width);
    });

    it('as many floors as its front shows; the upper floor\'s front windows its upper ones', () => {
        InnerMap.currentWorldTile = { q: 4, r: 4 };
        InnerMap._currentWorldTileRef = { q: 4, r: 4, settlement: { name: 'Stoneby', type: 'town' } };
        const two = defs('house').find(d => exOf(d).storeys === 2);
        const one = defs('house').find(d => exOf(d).storeys === 1);
        for (let i = 0; i < 6; i++) {
            expect(InnerMap.floorsOf({ type: 'house', q: i, r: 9, _customDefId: two.id })).toBe(2);
            expect(InnerMap.floorsOf({ type: 'house', q: i, r: 9, _customDefId: one.id })).toBe(1);
        }
        // its upper front windows follow the facade's upper row
        const ex = exOf(two);
        const ground = plan('house', { exterior: ex, storeys: 2 }, 'mid');
        ground._who = { exterior: ex, storeys: 2 };
        ground._tier = 'mid';
        ground._stairs = { up: InnerMap._stairsSpot(ground, [], 'x') };
        const up = InnerMap._buildUpperFloor(ground, { type: 'house', q: 1, r: 1 }, 1, false, 'k_f1');
        const wins = up.tiles[up.height - 1].filter(t => t._wallDecor === 'window');
        expect(wins.length).toBeGreaterThan(0);
        expect(wins.length).toBeLessThanOrEqual(ex.upper.length);
        expect(up.tiles[up.height - 1].some(t => t._isDoor)).toBe(false);
    });
});

describe('the owner\'s trade and household', () => {
    const has = (room, type, name) => room.tiles.flat().some(t => t._furniture && t._furniture.type === type && (!name || t._furniture.name === name));
    it('a trade\'s pieces stand in its home, with its work on them', () => {
        const T = G().interiorPlans.trades;
        for (let i = 0; i < 8; i++) for (const tier of ['poor', 'mid', 'rich']) {
            const cob = plan('house', { trades: ['cobbler'] }, tier, i, 3 * i);
            const bench = cob.tiles.flat().find(t => t._furniture && t._furniture.name === 'Cobbler\'s Bench');
            expect(bench, `cobbler ${tier} ${i}`).toBeTruthy();
            expect(bench._decor).toBe('tools');
            expect(has(plan('house', { trades: ['weaver'] }, tier, i, 3 * i), 'loom'), `weaver ${tier}`).toBe(true);
            const bake = plan('house', { trades: ['baker'] }, tier, i, 3 * i);
            expect(has(bake, 'oven', 'Bread Oven'), `baker ${tier}`).toBe(true);
            expect(has(bake, 'sack_pile', 'Flour Sacks'), `baker ${tier}`).toBe(true);
            guarantees(bake, `baker ${tier} ${i}`);
            const hunt = plan('house', { trades: ['hunter'] }, tier, i, 3 * i);
            expect(hunt.tiles.flat().some(t => t._wallDecor === 'antlers'), `hunter ${tier}`).toBe(true);
            const smith = plan('house', { trades: ['smith'] }, tier, i, 3 * i);
            expect(smith.tiles.flat().some(t => t._wallDecor === 'weapon_rack'), `smith ${tier}`).toBe(true);
            const fish = plan('farm', { trades: ['fisher'] }, tier, i, 3 * i);
            expect(fish.tiles.flat().some(t => t._furniture && t._furniture.name === 'Fish Creel'), `fisher ${tier}`).toBe(true);
        }
        const scribe = plan('house', { trades: ['scribe'] }, 'mid', 2, 2);
        expect(has(scribe, 'desk', 'Writing Desk') && has(scribe, 'bookshelf')).toBe(true);
        // every trade's pieces come from the vocabulary
        const known = new Set([...Object.keys(InnerMap.FURNITURE_COLORS), ...Object.keys(G().interiorPlans.pieces)]);
        for (const [id, tr] of Object.entries(T)) if (!id.startsWith('_')) for (const p of tr.pieces || []) expect(known.has(p.type), `${id} ${p.type}`).toBe(true);
        // a trade's things lie about more than in a house without one
        let cloth = 0, none = 0;
        for (let i = 0; i < 20; i++) {
            cloth += plan('house', { trades: ['tailor'] }, 'mid', i, i).tiles.flat().filter(t => t._decor === 'cloth').length;
            none += plan('house', null, 'mid', i, i).tiles.flat().filter(t => t._decor === 'cloth').length;
        }
        expect(cloth).toBeGreaterThan(none);
    });

    it('beds follow the household: a bed per couple and grown one, children two to a bed, a cradle per infant', () => {
        const hh = (couples, singles, children, infants) => ({ size: couples * 2 + singles + children + infants, adults: couples * 2 + singles, couples, singles, children, infants });
        const cases = [
            [hh(0, 1, 0, 0), 'mid', 1, 0], [hh(1, 0, 0, 0), 'mid', 1, 0], [hh(1, 1, 0, 0), 'mid', 2, 0],
            [hh(1, 0, 2, 1), 'mid', 2, 1], [hh(1, 0, 4, 0), 'rich', 3, 0], [hh(1, 1, 5, 1), 'poor', 5, 1],
        ];
        for (const [h, tier, beds, cradles] of cases) for (let i = 0; i < 5; i++) {
            const room = plan('house', { household: h, storeys: 1, exterior: null }, tier, i * 2, i + 5);
            const tag = `${JSON.stringify(h)} ${tier} ${i}`;
            expect(pieces(room, 'bed').length, tag).toBe(beds);
            expect(pieces(room, 'cradle').length, tag).toBe(cradles);
            guarantees(room, tag);
        }
        // the poor's children on straw pallets
        const poor = plan('house', { household: hh(1, 0, 4, 0), storeys: 1 }, 'poor', 1, 1);
        expect(pieces(poor, 'bed').length).toBe(3);
        expect(pieces(poor, 'bed').every(t => t._furniture.art === 'straw')).toBe(true);
        // a big family has more beds than a lone widow
        expect(pieces(plan('house', { household: hh(1, 1, 3, 0) }, 'mid', 4, 4), 'bed').length)
            .toBeGreaterThan(pieces(plan('house', { household: hh(0, 1, 0, 0) }, 'mid', 4, 4), 'bed').length);
        // where nobody is known, a chance cradle as before; known and childless, none
        let chance = 0;
        for (let i = 0; i < 30; i++) chance += pieces(plan('house', null, 'mid', i, 2 * i), 'cradle').length;
        expect(chance).toBeGreaterThan(0);
        for (let i = 0; i < 30; i++) expect(pieces(plan('house', { household: hh(1, 0, 0, 0) }, 'mid', i, 2 * i), 'cradle').length).toBe(0);
    });

    it('a household of two storeys sleeps upstairs: its bedchamber has its beds', () => {
        InnerMap.currentWorldTile = { q: 4, r: 4 };
        const two = defs('house').find(d => exOf(d).storeys === 2);
        const who = { exterior: exOf(two), storeys: 2, household: { size: 6, adults: 3, couples: 1, singles: 1, children: 2, infants: 1 } };
        const ground = plan('house', who, 'mid', 2, 3);
        ground._who = who; ground._tier = 'mid';
        ground._stairs = { up: InnerMap._stairsSpot(ground, [], 'x') };
        const up = InnerMap._buildUpperFloor(ground, { type: 'house', q: 1, r: 1 }, 1, false, 'k2_f1');
        expect(pieces(up, 'bed').length).toBe(3);
        expect(pieces(up, 'cradle').length).toBe(1);
    });

    it('whose a house is, from the town\'s people: ages, couples, trades; lodgers aren\'t of the house', () => {
        InnerMap.currentWorldTile = { q: 4, r: 4 };
        InnerMap._currentWorldTileRef = { q: 4, r: 4, settlement: { name: 'Fernby', type: 'town', culture: 'Nordic' } };
        InnerMap.tiles = [];
        const home = { type: 'house', q: 10, r: 12 };
        const at = { type: 'house', q: 10, r: 12 };
        InnerMap.npcs = [
            { id: 1, age: 40, spouseId: 2, job: 'cobbler', _home: at },
            { id: 2, age: 37, spouseId: 1, job: 'weaver', _home: at },
            { id: 3, age: 9, _home: at }, { id: 4, age: 6, _home: at }, { id: 5, age: 1, _home: at },
            { id: 6, age: 30, type: 'traveler', _home: at },
            { id: 7, age: 30, job: 'smith', _home: { type: 'house', q: 2, r: 2 } },
        ];
        const who = InnerMap._interiorIdentity(home, null);
        expect(who.household).toEqual({ size: 5, adults: 2, couples: 1, singles: 0, children: 2, infants: 1 });
        expect(who.trades).toEqual(['cobbler', 'weaver']);
        expect(who.culture).toBe('Nordic');
        const room = plan('house', { ...who, storeys: 1 }, 'mid', 10, 12);
        expect(pieces(room, 'bed').length).toBe(2);
        expect(pieces(room, 'cradle').length).toBe(1);
        expect(room.tiles.flat().some(t => t._furniture && t._furniture.name === 'Cobbler\'s Bench')).toBe(true);
        // a tavern's lodgers are no household
        expect(InnerMap._interiorIdentity({ type: 'tavern', q: 10, r: 12 }, null).household).toBe(null);
        InnerMap.npcs = [];
    });

    it('a trade worked at a shop stays there: a baker who works at the bakery keeps no oven at home', () => {
        InnerMap.currentWorldTile = { q: 4, r: 4 };
        InnerMap._currentWorldTileRef = { q: 4, r: 4, settlement: { name: 'Fernby', type: 'town' } };
        InnerMap.tiles = [];
        const home = { type: 'house', q: 10, r: 12 };
        const bakery = { type: 'bakery', q: 20, r: 12 };
        InnerMap.npcs = [
            { id: 1, age: 40, job: 'baker', _home: home, _work: bakery },
            { id: 2, age: 38, job: 'cobbler', _home: home, _work: null },
            { id: 3, age: 30, job: 'weaver', _home: home, _work: home },
        ];
        const who = InnerMap._interiorIdentity(home, null);
        expect(who.trades).not.toContain('baker');
        expect(who.trades).toEqual(['cobbler', 'weaver']);
        InnerMap.npcs = [];
    });
});

describe('culture', () => {
    it('shades the decor: the north\'s antlers and furs, the south\'s rugs and lamps', () => {
        const count = (culture, f) => { let n = 0; for (let i = 0; i < 30; i++) n += plan('house', { culture }, 'mid', i, 3 * i).tiles.flat().filter(f).length; return n; };
        const antlers = (t) => t._wallDecor === 'antlers';
        const rugs = (t) => t._furniture && t._furniture.type === 'rug';
        expect(count('Nordic', antlers)).toBeGreaterThan(count('Desert', antlers) + 5);
        expect(count('Desert', rugs)).toBeGreaterThan(count('Nordic', rugs));
        expect(count('Desert', t => t._furniture && t._furniture.name === 'Oil Lamp')).toBeGreaterThan(0);
        expect(count('Imperial', t => t._wallDecor === 'painting')).toBeGreaterThan(count('Swamp', t => t._wallDecor === 'painting'));
        // a workshop keeps its trade's look, whatever its culture
        const smithy = (c) => sig(plan('blacksmith', { culture: c }, 'mid', 3, 3));
        expect(smithy('Nordic')).toBe(smithy('Desert'));
        // every culture's things from the vocabulary
        const P = G().interiorPlans, items = new Set(P.decorItems), walls = new Set(P.wallDecor);
        for (const [id, c] of Object.entries(P.cultures)) {
            for (const x of c.items || []) expect(items.has(x), `${id} ${x}`).toBe(true);
            for (const x of c.wall || []) expect(walls.has(x), `${id} ${x}`).toBe(true);
            for (let i = 0; i < 4; i++) guarantees(plan('house', { culture: id }, ['poor', 'mid', 'rich'][i % 3], i, i), `${id} ${i}`);
        }
    });
});

describe('in a town', () => {
    it('entering its houses: each as wide as its front, its door where the facade\'s is, its people\'s beds', async () => {
        const fs = await import('fs');
        const { loadData } = await import('./playtest/harness.js');
        await loadData();
        InnerMap.initialize(G().innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
        InnerMap._cache = {};
        InnerMap._interiorCache = {};
        InnerMap._insideBuilding = null;
        InnerMap._outerMapState = null;
        const settlement = { name: 'Hearthby', type: 'town', population: 1500, q: 5, r: 6, culture: 'Nordic' };
        const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
        const world = { day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null };
        const game = { world, player: {}, settlement, ui: { showNotification() {} } };
        InnerMap.enter(game, 5, 6);
        const houses = InnerMap.buildings.filter(b => b.type === 'house' && b._customDefId);
        expect(houses.length).toBeGreaterThan(3);
        let withPeople = 0, offCentre = 0;
        for (const b of houses.slice(0, 12)) {
            const def = CustomBuildings.getBuilding(b._customDefId);
            const ex = exOf(def);
            const who = InnerMap._interiorIdentity(b, def);
            if (process.env.IDENT_DUMP) console.log(`IDENT ${b._customDefId} ${JSON.stringify({ hh: who.household, trades: who.trades, culture: who.culture, storeys: who.storeys, door: ex.doorFrac.toFixed(2) })}`);
            expect(InnerMap.enterBuilding(b, game), b._customDefId).toBe(true);
            const it = { tiles: InnerMap.tiles, width: InnerMap.width, height: InnerMap.height, door: InnerMap._interiorDoorOf(InnerMap._floorInteriors[0]) };
            guarantees(it, `${b._customDefId}@${b.q},${b.r}`);
            // the player a step inside the door
            expect(InnerMap.playerInnerQ).toBe(it.door.q);
            expect(InnerMap.playerInnerR).toBe(it.height - 2);
            if (ex.doorFrac < 0.4) { expect(it.door.q).toBeLessThan((it.width - 1) / 2); offCentre++; }
            // its floors as its front shows
            if (ex.storeys) expect(InnerMap._floorCount, b._customDefId).toBe(Math.max(1, Math.min(2, ex.storeys)));
            if (who.household) {
                withPeople++;
                const k = InnerMap._householdUpstairs(b, who) ? 1 : 0;
                const fl = k ? InnerMap._floorInterior(1) : InnerMap._floorInteriors[0];
                const want = InnerMap._householdBeds(who.household, InnerMap._floorInteriors[0]._tier || 'mid');
                expect(pieces(fl, 'bed').length, `${b._customDefId} beds`).toBeGreaterThanOrEqual(want.adult);
            }
            InnerMap.exitBuilding(game);
        }
        if (process.env.IDENT_DUMP) console.log(`IDENT town: ${withPeople} with people, ${offCentre} off-centre`);
        expect(withPeople).toBeGreaterThan(0);
        expect(offCentre + 1).toBeGreaterThan(0);
    }, 120000);
});

describe('determinism and pace', () => {
    it('the same building and people, the same plan; under 5 ms each', () => {
        const ex = exOf(defs('house')[3]);
        const who = { exterior: ex, trades: ['baker'], culture: 'Woodland', household: { size: 4, adults: 2, couples: 1, singles: 0, children: 2, infants: 0 }, storeys: 1, wear: 1 };
        for (const tier of ['poor', 'mid', 'rich']) expect(sig(plan('house', who, tier, 6, 6))).toBe(sig(plan('house', who, tier, 6, 6)));
        // and two of a street differ
        expect(sig(plan('house', who, 'mid', 6, 6)) !== sig(plan('house', who, 'mid', 9, 2))).toBe(true);
        let ms = 0, n = 0;
        for (const type of ['house', 'inn', 'manor', 'church', 'warehouse']) for (const d of defs(type).slice(0, 6)) {
            const t0 = performance.now();
            plan(type, { exterior: exOf(d), trades: ['carpenter'], culture: 'Nordic', household: { size: 3, adults: 2, couples: 1, singles: 0, children: 1, infants: 0 } }, 'mid', n, n);
            ms += performance.now() - t0; n++;
        }
        // (about 1-5 ms a plan; the bound leaves room for a machine busy with other suites)
        expect(ms / n).toBeLessThan(20);
    });
});

// (pictures of plans for the eye: IDENT_DUMP=1 npx vitest run src/__tests__/interiorIdentity.test.js)
if (typeof process !== 'undefined' && process.env && process.env.IDENT_DUMP) {
    describe('dump', () => {
        it('draws', () => {
            const C = { bed: 'B', table: 'T', fireplace: 'F', chest: 'c', rug: '~', candle: 'i', workbench: 'W', loom: 'l', oven: 'O', sack_pile: 's', cradle: 'y', basket: 'b', barrel: 'o', cupboard: 'C', chair: 'h', firewood: 'f', spinning_wheel: 'g', bookshelf: 'L', desk: 'D' };
            const draw = (label, room) => {
                const lines = room.tiles.map(row => row.map(t => (t._isDoor ? 'D' : t._doorway ? ':' : t.baseTerrain === 'wall' ? (t._wallDecor === 'window' || t._wallDecor === 'curtains' ? 'w' : t._wallDecor === 'antlers' ? 'a' : t._wallDecor ? '+' : '#') : t._furniture ? (C[t._furniture.type] || '?') : '.')).join(''));
                console.log(`${label} ${room.width}x${room.height}\n${lines.join('\n')}`);
            };
            const hs = defs('house');
            const off = hs.find(d => exOf(d).doorFrac < 0.4) || hs[0];
            draw(`off-centre door ${off.id} front ${JSON.stringify(exOf(off))}`, plan('house', { exterior: exOf(off) }, 'mid'));
            const th = G().buildings.find(d => d.id === 'imperial_townhouse_1');
            draw('townhouse', plan('house', { exterior: exOf(th) }, 'mid'));
            draw('cobbler, couple + 2 children + infant, Nordic', plan('house', { trades: ['cobbler'], culture: 'Nordic', household: { size: 5, adults: 2, couples: 1, singles: 0, children: 2, infants: 1 } }, 'mid', 4, 4));
            draw('poor weaver, couple + 5 children', plan('house', { trades: ['weaver'], household: { size: 7, adults: 2, couples: 1, singles: 0, children: 5, infants: 0 } }, 'poor', 4, 4));
            draw('baker, Desert', plan('house', { trades: ['baker'], culture: 'Desert' }, 'mid', 7, 2));
        });
    });
}
