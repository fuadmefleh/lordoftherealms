/**
 * Below decks and the ship's officers: the rooms under the deck sized by the
 * hull (systems/belowDecks.js), the hold showing her real cargo, who is below
 * at an hour, the walkable rooms (world/innerMap/belowDecks.js) and the scene
 * (ui/innerMapBelowDecks.js); officers promoted from the named hands, their
 * pay, loyalty, desertion and what they give (systems/shipOfficers.js).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Ships, DeckLife, BelowDecks, ShipOfficers, Ailments;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Ships } = await import('../systems/ships.js'));
    ({ DeckLife } = await import('../systems/deckLife.js'));
    ({ BelowDecks } = await import('../systems/belowDecks.js'));
    ({ ShipOfficers } = await import('../systems/shipOfficers.js'));
    ({ Ailments } = await import('../systems/ailments.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

let savedChance;
beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(23);
    savedChance = DataLoader.ships.settings.voyage.eventChance;
});
afterEach(() => {
    DataLoader.ships.settings.voyage.eventChance = savedChance;
});

const OCEAN = { id: 'ocean', passable: false };
const PLAINS = { id: 'plains', passable: true };

function seaWorld(land = {}, { width = 40, height = 30, day = 1, weather = null } = {}) {
    const tiles = new Map();
    return {
        width, height, day, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 3 }, activeEvents: [], kingdoms: [],
        weather: weather ? { getWeather: () => weather, getTemperature: () => ({ value: 0.5 }) } : null,
        getTile(q, r) {
            if (r < 0 || r >= height) return null;
            q = ((q % width) + width) % width;
            const key = `${q},${r}`;
            if (!tiles.has(key)) {
                const spec = land[key];
                tiles.set(key, {
                    q, r, terrain: spec ? spec.terrain || PLAINS : OCEAN, elevation: 0.3, temperature: 0.5, moisture: 0.5,
                    settlement: spec && spec.settlement ? { q, r, ...spec.settlement } : null,
                });
            }
            return tiles.get(key);
        },
        getSettlementViews: () => [],
        getKingdom: () => null,
    };
}

const twoPorts = (opts) => seaWorld({
    '5,10': { settlement: { name: 'Saltmere', type: 'town' } },
    '25,10': { settlement: { name: 'Gullhaven', type: 'town' } },
}, opts);

const mkShip = (typeId, extra = {}) => ({
    id: 'ship_1', typeId, name: 'Gull', q: 5, r: 10, status: 'docked', condition: 100,
    customizations: [], cargo: { food: 30 }, crew: Ships.getShipEffectiveStats({ typeId }).crewRequired, morale: 70, ...extra,
});
const captain = (s, extra = {}) => ({
    gold: 5000, renown: 0, karma: 0, health: 100, maxHealth: 100, reputation: {}, inventory: {}, skills: {},
    strength: 5, charisma: 5, luck: 5,
    ships: [s], army: [], q: s.q, r: s.r, boardedShip: null, ...extra,
});

function underWay(typeId = 'caravel', opts = {}) {
    const w = twoPorts(opts);
    const s = mkShip(typeId);
    const p = captain(s);
    expect(Ships.startVoyage(p, w, s.id, 25, 10, 'Gullhaven').success).toBe(true);
    DataLoader.ships.settings.voyage.eventChance = 0;
    w.day++;
    Ships.processDaily(p, w);
    return { w, s, p };
}

/** Every walkable cell of a plan reachable from the ladder's foot, with `blocked` cells (furniture) shut. */
function reach(plan, blocked) {
    const ok = (q, r) => plan.cells[r] && plan.cells[r][q] && plan.cells[r][q] !== 'W' && !blocked.has(`${q},${r}`);
    const start = { q: plan.ladder.q, r: plan.ladder.r + 1 };
    const seen = new Set([`${start.q},${start.r}`]);
    const queue = [start];
    while (queue.length) {
        const c = queue.shift();
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = { q: c.q + dq, r: c.r + dr };
            const k = `${n.q},${n.r}`;
            if (seen.has(k) || !ok(n.q, n.r)) continue;
            seen.add(k);
            queue.push(n);
        }
    }
    return seen;
}

describe('the plan below, sized by the hull', () => {
    it('an open boat has no below; a fishing boat a hold; a sloop a cuddy; a galleon every room', () => {
        expect(BelowDecks.plan(mkShip('rowboat'))).toBeNull();
        expect(BelowDecks.reason(mkShip('rowboat'))).toMatch(/open boat/);
        const fish = BelowDecks.plan(mkShip('fishing_vessel'));
        expect(fish.rooms.map(r => r.id)).toEqual(['hold']);
        const sloop = BelowDecks.plan(mkShip('sloop'));
        expect(sloop.rooms.map(r => r.id)).toEqual(['berths', 'hold', 'cabin']);
        expect(sloop.stove).toBeTruthy();
        const cog = BelowDecks.plan(mkShip('cog'));
        const galleon = BelowDecks.plan(mkShip('galleon'));
        expect(galleon.rooms.map(r => r.id)).toEqual(['berths', 'galley', 'hold', 'cabin']);
        // bigger hull, bigger below: more hammocks, a wider hold, a taller deck
        expect(galleon.hammocks.length).toBeGreaterThan(sloop.hammocks.length);
        expect(galleon.w).toBeGreaterThan(sloop.w);
        expect(galleon.h).toBeGreaterThan(sloop.h);
        expect(cog.holdSlots.length).toBeGreaterThan(fish.holdSlots.length);
        for (const plan of [fish, sloop, cog, galleon]) {
            expect(plan.ladder).toBeTruthy();
            // every piece of furniture stands on open floor
            for (const f of plan.furniture) expect(plan.cells[f.r][f.q]).toBe('.');
        }
        expect(galleon.chartTable && galleon.cot && galleon.mess).toBeTruthy();
    });

    it('the hold packed to the beams never cuts off a room: every free cell and every piece is reachable from the ladder', () => {
        for (const type of ['fishing_vessel', 'sloop', 'cog', 'caravel', 'war_galley', 'galleon']) {
            const plan = BelowDecks.plan(mkShip(type));
            const blocked = new Set(plan.furniture.filter(f => !f.passable).map(f => `${f.q},${f.r}`));
            for (const s of plan.holdSlots) blocked.add(`${s.q},${s.r}`);
            const seen = reach(plan, blocked);
            for (let r = 0; r < plan.h; r++) {
                for (let q = 0; q < plan.w; q++) {
                    if (plan.cells[r][q] === 'W' || blocked.has(`${q},${r}`)) continue;
                    expect(seen.has(`${q},${r}`), `${type} ${q},${r}`).toBe(true);
                }
            }
            // the furniture you use has open floor beside it
            for (const f of plan.furniture.filter(x => !x.passable)) {
                const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => seen.has(`${f.q + dq},${f.r + dr}`));
                expect(beside, `${type} ${f.name}`).toBe(true);
            }
        }
    });

    it('the hold shows her real cargo: crates, barrels and sacks by the good, in proportion to how full she is', () => {
        const s = mkShip('cog');
        const plan = BelowDecks.plan(s);
        const cap = Ships.getShipEffectiveStats(s).cargoCapacity;
        s.cargo = { wine: cap / 4, grain: cap / 4 };
        const half = BelowDecks.stowage(s, plan.holdSlots);
        expect(half.length).toBeGreaterThan(plan.holdSlots.length * 0.35);
        expect(half.length).toBeLessThan(plan.holdSlots.length * 0.65);
        expect(half.filter(x => x.good === 'wine').every(x => x.kind === 'barrel')).toBe(true);
        expect(half.filter(x => x.good === 'grain').every(x => x.kind === 'sack')).toBe(true);
        s.cargo = { tools: cap };
        const full = BelowDecks.stowage(s, plan.holdSlots);
        expect(full.length).toBe(plan.holdSlots.length);
        expect(full[0].kind).toBe('crate');
        // (a stack every other piece, so a full hold reads as packed)
        expect(full.some(x => x.type === 'crate_stack')).toBe(true);
        // anything aboard shows, however little
        s.cargo = { spices: 1 };
        expect(BelowDecks.stowage(s, plan.holdSlots).length).toBe(1);
        s.cargo = {};
        expect(BelowDecks.stowage(s, plan.holdSlots)).toEqual([]);
    });
});

describe('who is below at an hour', () => {
    it('night: the off-watch asleep in their hammocks, the watch on deck; a storm: all hands up', () => {
        const { w, s, p } = underWay('galleon');
        const plan = BelowDecks.plan(s);
        const night = DeckLife.situation(p, w, s, { hour: 23 });
        const below = BelowDecks.below(s, { hour: 23, sit: night, plan });
        const sleepers = below.filter(e => e.act === 'sleep');
        expect(sleepers.length).toBeGreaterThan(3);
        expect(sleepers.every(e => e.asleep && e.room === 'berths')).toBe(true);
        // the helmsman keeps the watch
        expect(below.some(e => e.member.role === 'helmsman')).toBe(false);
        // the hands beyond the deck's roster are below too, named
        expect(below.some(e => e.member.extra && e.member.name)).toBe(true);
        const storm = BelowDecks.below(s, { hour: 23, sit: { kind: 'storm', night: true }, plan });
        expect(storm.filter(e => !e.member.extra).length).toBe(0);
    });

    it('meals in the galley, the cook at his stove, the navigator at the charts, the sick and the surgeon', () => {
        const { w, s, p } = underWay('galleon');
        const plan = BelowDecks.plan(s);
        const noon = DeckLife.situation(p, w, s, { hour: 12.2 });
        const mess = BelowDecks.below(s, { hour: 12.2, sit: noon, plan });
        expect(mess.some(e => e.act === 'eat' && e.room === 'galley')).toBe(true);
        expect(mess.some(e => e.act === 'cook' && e.member.role === 'cook')).toBe(true);
        // the second half of the hour, the other half of the mess
        const mess2 = BelowDecks.below(s, { hour: 12.7, sit: noon, plan });
        const a = new Set(mess.filter(e => e.act === 'eat').map(e => e.member.slot));
        expect(mess2.filter(e => e.act === 'eat').some(e => !a.has(e.member.slot))).toBe(true);
        // a navigator works the charts in the cabin in the forenoon
        const nav = ShipOfficers.candidates(s, 'navigator')[0];
        expect(ShipOfficers.promote(p, w, s, 'navigator', nav.slot).success).toBe(true);
        const nine = BelowDecks.below(s, { hour: 9, sit: DeckLife.situation(p, w, s, { hour: 9 }), plan });
        expect(nine.find(e => e.member.slot === nav.slot)).toMatchObject({ room: 'cabin', act: 'charts' });
        // an outbreak: the sick in their hammocks, the surgeon among them
        const sur = ShipOfficers.candidates(s, 'surgeon')[0];
        ShipOfficers.promote(p, w, s, 'surgeon', sur.slot);
        const sick = BelowDecks.below(s, { hour: 10, sit: DeckLife.situation(p, w, s, { hour: 10 }), plan, outbreak: 'scurvy' });
        expect(sick.filter(e => e.act === 'sick').length).toBeGreaterThan(0);
        expect(sick.find(e => e.member.slot === sur.slot)).toMatchObject({ room: 'berths', act: 'tend' });
    });

    it('the charts: the route laid off, how far along, the navigator\'s word', () => {
        const { w, s, p } = underWay('caravel');
        let c = BelowDecks.chart(p, s);
        expect(c.route.length).toBe(s.voyage.route.length + 1);
        expect(c.dest).toBe('Gullhaven');
        expect(c.done + c.left).toBe(c.leagues);
        expect(c.advice).toMatch(/no navigator/i);
        ShipOfficers.promote(p, w, s, 'navigator', ShipOfficers.candidates(s, 'navigator')[0].slot);
        c = BelowDecks.chart(p, s);
        expect(c.navigator).toBeTruthy();
        expect(c.advice).toMatch(/Gullhaven/);
    });
});

describe('the ship\'s officers', () => {
    it('posts by the size of the ship; candidates are her named hands, best first, never the mate', () => {
        expect(ShipOfficers.postsFor(mkShip('fishing_vessel'))).toEqual([]);
        expect(ShipOfficers.postsFor(mkShip('sloop'))).toEqual(['navigator', 'bosun']);
        expect(ShipOfficers.postsFor(mkShip('galleon'))).toEqual(['navigator', 'gunner', 'bosun', 'surgeon']);
        const s = mkShip('galleon');
        const c = ShipOfficers.candidates(s, 'bosun');
        const names = new Set(DeckLife.roster(s).map(m => m.name));
        expect(c.every(x => names.has(x.name))).toBe(true);
        expect(c.some(x => x.role === 'mate')).toBe(false);
        for (let i = 1; i < c.length; i++) expect(c[i - 1].score).toBeGreaterThanOrEqual(c[i].score);
        // the same hands, the same aptitudes, every time
        expect(ShipOfficers.candidates(s, 'bosun')).toEqual(c);
        // kindred work tells: the roster's bosun is a likelier bosun than a gunner
        const bos = DeckLife.roster(s).find(m => m.role === 'bosun');
        expect(ShipOfficers.aptitude(s, bos, 'bosun') - ShipOfficers.aptitude(s, bos, 'gunner')).toBeGreaterThan(-30);
        expect(ShipOfficers.promoteReason(mkShip('sloop'), 'surgeon', 3)).toMatch(/too small/);
    });

    it('promote, and the post is held (one post a hand); break them, and it is vacant again', () => {
        const { w, s, p } = underWay('galleon');
        const morale = s.morale;
        const best = ShipOfficers.candidates(s, 'gunner')[0];
        const res = ShipOfficers.promote(p, w, s, 'gunner', best.slot);
        expect(res.success).toBe(true);
        expect(ShipOfficers.of(s, 'gunner').name).toBe(best.name);
        expect(s.morale).toBeGreaterThanOrEqual(morale);
        expect(ShipOfficers.postOfSlot(s, best.slot)).toBe('gunner');
        expect(ShipOfficers.candidates(s, 'navigator').some(x => x.slot === best.slot)).toBe(false);
        expect(s.voyage.log.some(e => /master gunner/.test(e.text))).toBe(true);
        expect(ShipOfficers.dismiss(p, w, s, 'gunner').success).toBe(true);
        expect(ShipOfficers.of(s, 'gunner')).toBeNull();
        expect(ShipOfficers.dismiss(p, w, s, 'gunner').success).toBe(false);
    });

    it('bonus(): nothing without the officer; their skill with one; half of it from a sulking one', () => {
        const { w, s, p } = underWay('galleon');
        for (const k of ['speed', 'routeSafety', 'gunnery', 'morale', 'repair', 'sickness', 'wounds']) expect(ShipOfficers.bonus(s, k)).toBe(0);
        ShipOfficers.promote(p, w, s, 'gunner', ShipOfficers.candidates(s, 'gunner')[0].slot);
        const o = ShipOfficers.of(s, 'gunner');
        o.skill = 80; o.loyalty = 80;
        const full = ShipOfficers.bonus(s, 'gunnery');
        expect(full).toBeCloseTo(ShipOfficers.post('gunner').bonuses.gunnery * 0.8, 3);
        expect(ShipOfficers.bonus(s, 'speed')).toBe(0);
        o.loyalty = 10;
        expect(ShipOfficers.bonus(s, 'gunnery')).toBeCloseTo(full / 2, 3);
        // a reprimand shakes them into it for a few days (not with a whole heart)
        ShipOfficers.reprimand(p, w, s, 'gunner');
        expect(ShipOfficers.bonus(s, 'gunnery', w)).toBeCloseTo(full * 0.85, 3);
        w.day += 10;
        expect(ShipOfficers.bonus(s, 'gunnery', w)).toBeCloseTo(full / 2, 3);
    });

    it('pay: paid daily from the purse into the ports; unpaid, it is owed and sours them; paying it off mends it', () => {
        const { w, s, p } = underWay('galleon');
        ShipOfficers.promote(p, w, s, 'navigator', ShipOfficers.candidates(s, 'navigator')[0].slot);
        ShipOfficers.promote(p, w, s, 'surgeon', ShipOfficers.candidates(s, 'surgeon')[0].slot);
        const pay = ShipOfficers.dailyPay(s);
        expect(pay).toBe(ShipOfficers.post('navigator').pay + ShipOfficers.post('surgeon').pay);
        const gold = p.gold;
        ShipOfficers.processDay(p, w, null);
        expect(p.gold).toBeCloseTo(gold - pay, 2);
        const lo = ShipOfficers.of(s, 'navigator').loyalty;
        p.gold = 0;
        const out = ShipOfficers.processDay(p, w, null);
        expect(out.notices.some(n => /Unpaid/.test(n.title))).toBe(true);
        expect(ShipOfficers.arrears(s)).toBeCloseTo(pay, 2);
        expect(ShipOfficers.of(s, 'navigator').loyalty).toBeLessThan(lo);
        expect(ShipOfficers.payArrears(p, w, s).success).toBe(false);
        p.gold = 1000;
        expect(ShipOfficers.payArrears(p, w, s).success).toBe(true);
        expect(ShipOfficers.arrears(s)).toBe(0);
    });

    it('victories lift them, defeats and hunger sour them; a sea fight can be noted by other systems', () => {
        const { w, s, p } = underWay('galleon');
        ShipOfficers.promote(p, w, s, 'gunner', ShipOfficers.candidates(s, 'gunner')[0].slot);
        const o = ShipOfficers.of(s, 'gunner');
        o.loyalty = 50;
        ShipOfficers.processDay(p, w, { interceptions: [{ shipId: s.id, won: true }] });
        const afterWin = o.loyalty;
        expect(afterWin).toBeGreaterThan(50);
        expect(o.victories).toBe(1);
        ShipOfficers.noteBattle(s, false);
        s.hungryDays = 2;
        ShipOfficers.processDay(p, w, null);
        expect(o.loyalty).toBeLessThan(afterWin);
        expect(o.defeats).toBe(1);
        expect(s._officerBattles).toBeUndefined();
    });

    it('in port, an officer at the end of their rope goes ashore for good (owed, and saying so)', () => {
        const { w, s, p } = underWay('galleon');
        ShipOfficers.promote(p, w, s, 'bosun', ShipOfficers.candidates(s, 'bosun')[0].slot);
        Ships.heaveTo(p, w);
        s.status = 'docked';
        s.morale = 0;
        p.gold = 0;
        const crew = s.crew;
        let gone = null;
        for (let d = 0; d < 40 && !gone; d++) {
            ShipOfficers.of(s, 'bosun').loyalty = 0;
            const out = ShipOfficers.processDay(p, w, null);
            gone = out.notices.find(n => /Deserts/.test(n.title));
        }
        expect(gone).toBeTruthy();
        expect(ShipOfficers.of(s, 'bosun')).toBeNull();
        expect(s.crew).toBe(crew - 1);
        expect(ShipOfficers.arrears(s)).toBeGreaterThan(0);
    });

    it('flogging: once a day, the crew mislikes it, the bosun approves and the surgeon does not; too many and all sour', () => {
        const { w, s, p } = underWay('galleon');
        ShipOfficers.promote(p, w, s, 'bosun', ShipOfficers.candidates(s, 'bosun')[0].slot);
        ShipOfficers.promote(p, w, s, 'surgeon', ShipOfficers.candidates(s, 'surgeon')[0].slot);
        const b = ShipOfficers.of(s, 'bosun'), su = ShipOfficers.of(s, 'surgeon');
        b.loyalty = 50; su.loyalty = 50;
        const m = s.morale;
        const res = ShipOfficers.flog(p, w, s);
        expect(res.success).toBe(true);
        expect(s.morale).toBeLessThan(m);
        expect(b.loyalty).toBeGreaterThan(50);
        expect(su.loyalty).toBeLessThan(50);
        expect(ShipOfficers.flog(p, w, s).success).toBe(false);
        w.day++; ShipOfficers.flog(p, w, s);
        const bBefore = b.loyalty;
        w.day++; ShipOfficers.flog(p, w, s);
        expect(b.loyalty).toBeLessThan(bBefore + 1);
        expect(ShipOfficers.floggingsSince(s, w, 7)).toBe(3);
        expect(s.voyage.log.some(e => /flogged/.test(e.text))).toBe(true);
    });

    it('the surgeon saves wounded after a fight and shortens an outbreak; the bosun patches her at sea', () => {
        const { w, s, p } = underWay('galleon');
        expect(ShipOfficers.tendWounded(s, 5)).toBe(0);
        ShipOfficers.promote(p, w, s, 'surgeon', ShipOfficers.candidates(s, 'surgeon')[0].slot);
        ShipOfficers.of(s, 'surgeon').skill = 95;
        ShipOfficers.of(s, 'surgeon').loyalty = 90;
        let saved = 0;
        for (let i = 0; i < 20; i++) saved += ShipOfficers.tendWounded(s, 5);
        expect(saved).toBeGreaterThan(0);
        expect(saved).toBeLessThan(100);
        Ailments.startCrewOutbreak(p, s, 'scurvy');
        const ob = Ailments.getState(p).crews[String(s.id)];
        ob.daysLeft = 100;
        for (let i = 0; i < 20; i++) ShipOfficers.processDay(p, w, null);
        expect(ob.daysLeft).toBeLessThan(100);
        ShipOfficers.promote(p, w, s, 'bosun', ShipOfficers.candidates(s, 'bosun')[0].slot);
        ShipOfficers.of(s, 'bosun').skill = 95;
        ShipOfficers.of(s, 'bosun').loyalty = 90;
        s.condition = 60;
        for (let i = 0; i < 20; i++) ShipOfficers.processDay(p, w, null);
        expect(s.condition).toBeGreaterThan(60);
        expect(s.condition).toBeLessThanOrEqual(90);
    });

    it('the logbook: each finished voyage bound in, newest first, the voyage under way on top', () => {
        const { w, s, p } = underWay('caravel');
        expect(ShipOfficers.logPages(s)[0].current).toBe(true);
        Ships.heaveTo(p, w);
        expect(ShipOfficers.archiveVoyage(s)).toBe(true);
        expect(ShipOfficers.archiveVoyage(s)).toBe(false);
        const pages = ShipOfficers.logPages(s);
        expect(pages.length).toBe(1);
        expect(pages[0].current).toBe(false);
        expect(pages[0].entries.some(e => /Set sail/.test(e.text))).toBe(true);
        expect(pages[0].title).toMatch(/Gullhaven/);
    });
});

describe('below decks on the inner map', () => {
    let InnerMapDeck, InnerMapBelowDecks;
    beforeAll(async () => {
        ({ InnerMapDeck } = await import('../ui/innerMapDeck.js'));
        ({ InnerMapBelowDecks } = await import('../ui/innerMapBelowDecks.js'));
    });

    function sceneGame(typeId = 'galleon', hour = 10) {
        const { w, s, p } = underWay(typeId);
        const notes = [];
        const ui = {
            panel: null,
            showNotification: (title, body) => notes.push(`${title}: ${body}`),
            showCustomPanel(title, html) { this.panel = { title, html }; },
            hideCustomPanel() { this.panel = null; },
            updateStats() {},
        };
        const game = { world: w, player: p, ui, notes, endDay() { w.day++; Ships.processDaily(p, w); }, exitInnerMap() { InnerMap.exit(game); } };
        InnerMap.enter(game, p.q, p.r);
        InnerMap.timeOfDay = hour;
        expect(InnerMapDeck.onEnter(game)).toBe(true);
        return { game, w, s, p };
    }

    afterEach(() => { if (InnerMapDeck) { InnerMapDeck._fight = null; InnerMapDeck._game = null; } InnerMapBelowDecks.resetDeck(); InnerMap.active = false; });

    it('down the hatch: the rooms laid, the cargo in the hold, the ladder back up to the deck', () => {
        const { game, s } = sceneGame('galleon', 10);
        s.cargo = { wine: 20, grain: 10, food: 20 };
        const items = [];
        InnerMapDeck.menuItems(game, items, null, InnerMap._deck.hatch.q, InnerMap._deck.hatch.r, []);
        expect(items.some(i => i.action === 'deck_below')).toBe(true);
        expect(InnerMapBelowDecks.goBelow(game)).toBe(true);
        expect(InnerMap.inBelowDecks()).toBe(true);
        expect(InnerMapBelowDecks.active(game)).toBe(true);
        expect(InnerMap._floorCount).toBe(1);
        const all = InnerMap.tiles.flat();
        expect(all.some(t => t._ladder)).toBe(true);
        expect(all.filter(t => t._furniture && t._furniture.type === 'hammock').length).toBeGreaterThan(5);
        const cargo = all.filter(t => t._cargo);
        expect(cargo.some(t => t._cargo.good === 'wine' && t._furniture.type.startsWith('barrel'))).toBe(true);
        expect(cargo.some(t => t._cargo.good === 'grain' && /sack/.test(t._furniture.type))).toBe(true);
        expect(all.some(t => t._wallDecor === 'torch' && t._decorLit)).toBe(true);
        // the player stands at the foot of the ladder
        const l = InnerMap.belowLanding();
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([l.q, l.r]);
        // the cabin's menu: the log, the charts, the officers
        const cabin = all.find(t => t._belowRoom === 'cabin' && t.subTerrain.passable && !t._furniture);
        const menu = [{ type: 'header', label: 'X' }, { type: 'action', action: 'exit_building' }];
        InnerMapBelowDecks.menuItems(game, menu, cabin, cabin.q, cabin.r, []);
        const acts = menu.map(i => i.action).filter(Boolean);
        expect(acts).toEqual(expect.arrayContaining(['below_log', 'below_charts', 'below_officers', 'below_up']));
        expect(acts).not.toContain('exit_building');
        InnerMapBelowDecks.handle(game, { action: 'below_log' });
        expect(game.ui.panel.html).toMatch(/Set sail from Saltmere/);
        InnerMapBelowDecks.handle(game, { action: 'below_charts' });
        expect(game.ui.panel.html).toMatch(/<svg/);
        InnerMapBelowDecks.handle(game, { action: 'below_officers' });
        expect(game.ui.panel.html).toMatch(/Promote/);
        // promote from the panel
        const c = ShipOfficers.candidates(s, 'navigator')[0];
        window._bdPromote('navigator', c.slot);
        expect(ShipOfficers.of(s, 'navigator').name).toBe(c.name);
        // a crate: what is in it
        InnerMapBelowDecks.handle(game, { action: 'below_cargo', good: 'wine' });
        expect(game.notes.some(n => /20 wine/.test(n))).toBe(true);
        // and back up
        expect(InnerMapBelowDecks.climbUp(game)).toBe(true);
        expect(InnerMap.inBelowDecks()).toBe(false);
        expect(InnerMapDeck.active(game)).toBe(true);
    });

    it('at night the off-watch go down the hatch, and are found asleep in their hammocks below', () => {
        const { game, s } = sceneGame('galleon', 23);
        InnerMapDeck._refresh(game, true);
        const L = InnerMap._deck;
        const going = InnerMap.npcs.filter(n => n._goingBelow);
        expect(going.length).toBeGreaterThan(2);
        // they reach the hatch and are gone from the deck
        for (const n of going) { n.q = L.hatch.q; n.r = L.hatch.r; n.state = 'idle'; }
        InnerMapBelowDecks.tickDeck(game);
        expect(InnerMapBelowDecks.stowedCount()).toBe(going.length);
        expect(InnerMap.npcs.some(n => n._goingBelow)).toBe(false);
        // the roster check at a new day counts them aboard: no re-manning
        expect(DeckLife.roster(s).length).toBe(InnerMapDeck._crew().length + InnerMapBelowDecks.stowedCount());
        // below: the same people, asleep
        expect(InnerMapBelowDecks.goBelow(game)).toBe(true);
        const asleep = InnerMap.npcs.filter(n => n._belowHand && n._asleep);
        expect(asleep.length).toBeGreaterThan(2);
        const names = new Set(asleep.map(n => n.name));
        expect(going.some(n => names.has(n.name))).toBe(true);
        for (const n of asleep) expect(InnerMap.tiles[n.r][n.q]._furniture.type).toBe('hammock');
        // a word with a sleeper: let them be
        InnerMapBelowDecks.handle(game, { action: 'wake_npc', npc: asleep[0] });
        expect(game.notes.some(n => /asleep in a hammock/.test(n))).toBe(true);
        // morning: they get up and climb out; the deck takes them back
        InnerMap.timeOfDay = 9;
        InnerMapBelowDecks.update(1.1, game);
        expect(InnerMap.npcs.filter(n => n._belowHand && n._belowLeaving).length).toBeGreaterThan(0);
        const stowed = InnerMapBelowDecks.stowedCount();
        InnerMapBelowDecks.climbUp(game);
        expect(InnerMapBelowDecks.stowedCount()).toBeLessThan(stowed);
        expect(InnerMapDeck._crew().length + InnerMapBelowDecks.stowedCount()).toBe(DeckLife.roster(s).length);
    });

    it('a fight brings everyone up; no going below with boarders on deck', () => {
        const { game, s } = sceneGame('galleon', 23);
        InnerMapDeck._refresh(game, true);
        const L = InnerMap._deck;
        for (const n of InnerMap.npcs.filter(x => x._goingBelow)) { n.q = L.hatch.q; n.r = L.hatch.r; n.state = 'idle'; }
        InnerMapBelowDecks.tickDeck(game);
        expect(InnerMapBelowDecks.stowedCount()).toBeGreaterThan(0);
        s.voyage.boarding = { enemy: 10, fight: { pirates: true, win: { text: 'Won.' }, lose: { text: 'Lost.' } }, eventId: 'sighted_sail' };
        InnerMapDeck._startBoarding(game, true);
        expect(InnerMapBelowDecks.stowedCount()).toBe(0);
        expect(InnerMapBelowDecks.goBelow(game)).toBe(false);
        InnerMapDeck.onExit(game);
    });

    it('turning in ends the day at sea, and the hands below are where the new hour has them', () => {
        const { game, s, w } = sceneGame('caravel', 22);
        expect(InnerMapBelowDecks.goBelow(game)).toBe(true);
        const day = w.day;
        const step = s.voyage.step;
        InnerMapBelowDecks.turnIn(game);
        expect(w.day).toBe(day + 1);
        expect(s.voyage ? s.voyage.step : Infinity).toBeGreaterThan(step);
        expect(InnerMap.timeOfDay).toBe(7);
        expect(InnerMap.inBelowDecks()).toBe(true);
    });
});
