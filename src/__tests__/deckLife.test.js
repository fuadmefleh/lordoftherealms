/**
 * Life aboard ship: the crew on deck (systems/deckLife.js rules,
 * world/innerMap/deckLife.js stations), what the deck does in a storm, an
 * event or a boarding, the captain's orders, the deck-only event choices,
 * and boarding fights that wait for the deck (Ships.finishBoarding).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Ships, DeckLife, CustomObjects, _PS;

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
    ({ PracticeSkills: _PS } = await import('../systems/practiceSkills.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    ({ CustomObjects } = await import('../world/customObjects.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

let savedChance;
beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(11);
    savedChance = DataLoader.ships.settings.voyage.eventChance;
});
afterEach(() => {
    DataLoader.ships.settings.voyage.eventChance = savedChance;
});

const OCEAN = { id: 'ocean', passable: false };
const PLAINS = { id: 'plains', passable: true };

/** Open sea, with land (and ports) where listed; weather by hex when given. */
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
    customizations: [], cargo: { food: 200 }, crew: Ships.getShipEffectiveStats({ typeId }).crewRequired, morale: 70, ...extra,
});
const captain = (s, extra = {}) => ({
    gold: 5000, renown: 0, karma: 0, health: 100, maxHealth: 100, reputation: {}, inventory: {}, skills: {},
    strength: 5, charisma: 5, luck: 5,
    ships: [s], army: [], q: s.q, r: s.r, boardedShip: null, ...extra,
});

/** A player on a voyage from Saltmere to Gullhaven, a day out. */
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

/** Put a voyage event in waiting. */
function pend(s, id, w) {
    s.voyage.pending = { id, day: w.day };
}

describe('the crew roster', () => {
    it('the hands on deck: a helmsman, a mate, a lookout first; capped; the same names every time', () => {
        const s = mkShip('galleon');
        const a = DeckLife.roster(s);
        expect(a.length).toBe(DeckLife.config().maxOnDeck);
        expect(a.slice(0, 3).map(m => m.role)).toEqual(['helmsman', 'mate', 'lookout']);
        expect(new Set(a.map(m => m.name)).size).toBe(a.length);
        expect(DeckLife.roster(s).map(m => m.name)).toEqual(a.map(m => m.name));
        // a two-hand fishing boat has a helmsman and a mate, no more
        expect(DeckLife.roster(mkShip('fishing_vessel')).map(m => m.role)).toEqual(['helmsman', 'mate']);
        // nobody aboard, nobody on deck
        expect(DeckLife.roster(mkShip('sloop', { crew: 0 }))).toEqual([]);
        expect(DeckLife.officerOf(a).role).toBe('mate');
    });
});

describe('what the deck is doing', () => {
    it('fair sailing, the night watch, a storm, an event waiting, boarders, land near', () => {
        const { w, s, p } = underWay();
        expect(DeckLife.situation(p, w, s, { hour: 10 }).kind).toBe('fair');
        expect(DeckLife.situation(p, w, s, { hour: 23 }).kind).toBe('night');
        pend(s, 'man_overboard', w);
        const ev = DeckLife.situation(p, w, s, { hour: 10 });
        expect(ev.kind).toBe('event');
        expect(ev.scene).toBe('overboard');
        expect(DeckLife.callout(ev).text).toMatch(/overboard/i);
        pend(s, 'becalmed', w);
        expect(DeckLife.situation(p, w, s, { hour: 10 }).kind).toBe('calm');
        s.voyage.pending = null;
        s.voyage.boarding = { enemy: 20, fight: {}, eventId: 'sighted_sail' };
        expect(DeckLife.situation(p, w, s, { hour: 10 }).kind).toBe('boarding');
        s.voyage.boarding = null;
        // the last day's sail: land is near
        s.voyage.step = s.voyage.route.length - 1;
        expect(DeckLife.situation(p, w, s, { hour: 10 }).landNear).toBe(true);
        const storm = underWay('caravel', { weather: { type: 'storm', intensity: 1 } });
        const st = DeckLife.situation(storm.p, storm.w, storm.s, { hour: 10 });
        expect(st.kind).toBe('storm');
        expect(st.storm.danger).toBeGreaterThan(0);
    });

    it('stations follow the situation: storm to the masts and pumps, night watch keeps its posts, boarders are fought', () => {
        const crew = DeckLife.roster(mkShip('galleon'));
        const by = (sit) => Object.fromEntries(crew.map(m => [`${m.role}${m.slot}`, DeckLife.stationFor(m, sit)]));
        const fair = by({ kind: 'fair' });
        expect(fair.helmsman0).toBe('helm');
        expect(fair.lookout2).toBe('bow');
        const storm = crew.map(m => DeckLife.stationFor(m, { kind: 'storm' }));
        expect(storm.filter(x => x === 'pump').length).toBeGreaterThan(2);
        expect(storm.filter(x => x === 'mast').length).toBeGreaterThan(1);
        const night = crew.map(m => DeckLife.stationFor(m, { kind: 'night' }));
        expect(night[0]).toBe('helm');
        expect(night.filter(x => x === 'rest').length).toBeGreaterThan(2);
        const fight = crew.map(m => DeckLife.stationFor(m, { kind: 'boarding' }));
        expect(fight[0]).toBe('helm');
        expect(fight.slice(1).every(x => x === 'fight')).toBe(true);
        expect(DeckLife.workAt('pump').anim).toBe('swing');
        expect(DeckLife.pace({ kind: 'storm' })).toBeGreaterThan(1);
    });

    it('the mate reports the crew, the stores, the hull and the voyage', () => {
        const { w, s, p } = underWay();
        pend(s, 'whales', w);
        const lines = DeckLife.mateReport(p, w, s).join(' ');
        expect(lines).toMatch(/hands aboard/);
        expect(lines).toMatch(/Victuals for \d+ day/);
        expect(lines).toMatch(/Gullhaven/);
        expect(lines).toMatch(/whales/i);
        expect(DeckLife.chatter(DeckLife.roster(s)[3], s, { kind: 'storm' })).toBeTruthy();
    });
});

describe('the captain\'s orders', () => {
    it('address the crew, splice the mainbrace, lend a hand: each once a day, each moving morale', () => {
        const { w, s, p } = underWay();
        s.morale = 50;
        p.charisma = 10;
        const rally = DeckLife.giveOrder(p, w, s, 'rally');
        expect(rally.success).toBe(true);
        expect(DeckLife.giveOrder(p, w, s, 'rally').success).toBe(false);
        const food = Ships.getProvisions(s);
        const grog = DeckLife.giveOrder(p, w, s, 'grog');
        expect(grog.success).toBe(true);
        expect(grog.morale).toBeGreaterThan(0);
        expect(Ships.getProvisions(s)).toBe(food - DeckLife.grogCost(s));
        p.needsEnabled = true; p.needs = { energy: 80 };
        p.modifyNeed = (k, d) => { p.needs[k] += d; };
        const lend = DeckLife.giveOrder(p, w, s, 'lend');
        expect(lend.success).toBe(true);
        expect(lend.hours).toBeGreaterThan(0);
        expect(p.needs.energy).toBeLessThan(80);
        expect(DeckLife.ordersFor(p, w, s).every(o => !o.available)).toBe(true);
        // a new day, new orders
        w.day++;
        expect(DeckLife.ordersFor(p, w, s).some(o => o.available)).toBe(true);
        // no provisions, no grog
        s.cargo = {};
        expect(DeckLife.orderReason(p, w, s, 'grog')).toMatch(/provisions/);
    });

    it('lending a hand costs a hardy captain less, and is Endurance XP', () => {
        const { w, s, p } = underWay();
        const PracticeSkills = _PS;
        p.needsEnabled = true; p.needs = { energy: 80 };
        p.modifyNeed = (k, d) => { p.needs[k] += d; };
        p.practiceSkills = { endurance: PracticeSkills.xpForLevel(10) };
        DeckLife.giveOrder(p, w, s, 'lend');
        const hardy = 80 - p.needs.energy;
        const { w: w2, s: s2, p: q } = underWay();
        q.needsEnabled = true; q.needs = { energy: 80 };
        q.modifyNeed = (k, d) => { q.needs[k] += d; };
        DeckLife.giveOrder(q, w2, s2, 'lend');
        const soft = 80 - q.needs.energy;
        expect(hardy).toBeLessThan(soft);
        expect(hardy).toBeCloseTo(soft * PracticeSkills.energyMult(p));
        expect(PracticeSkills.xp(q, 'endurance')).toBeGreaterThan(0);
    });

    it('the first sight of land lifts the crew once', () => {
        const { s } = underWay();
        s.morale = 60;
        expect(DeckLife.noteLandSighted(s).morale).toBeGreaterThan(0);
        expect(s.morale).toBeGreaterThan(60);
        expect(DeckLife.noteLandSighted(s)).toBeNull();
    });
});

describe('events on deck', () => {
    it('deck-only choices show only on deck, and the crew never takes one by default', () => {
        const { w, s, p } = underWay();
        pend(s, 'man_overboard', w);
        expect(Ships.describeVoyageEvent(p).choices.map(c => c.id)).not.toContain('dive');
        const onDeck = Ships.describeVoyageEvent(p, { onDeck: true });
        expect(onDeck.choices.find(c => c.id === 'dive').deckOnly).toBe(true);
        // off deck, a deck-only choice is not taken: the default is
        const res = Ships.resolveVoyageEvent(p, w, 'dive');
        expect(res.choice).toBe('come_about');
        pend(s, 'man_overboard', w);
        expect(Ships.resolveVoyageEvent(p, w, 'dive', { onDeck: true }).choice).toBe('dive');
    });

    it('a whale pod is one of the sea\'s events', () => {
        expect(Ships.getVoyageEvent('whales')).toBeTruthy();
    });

    it('pirates met on deck wait to be fought hand to hand; the fight settles by the event\'s own outcomes', () => {
        const { w, s, p } = underWay();
        pend(s, 'sighted_sail', w);
        // run, and she is faster (force the chance to fail): pirates
        const ev = Ships.getVoyageEvent('sighted_sail');
        const run = ev.choices.find(c => c.id === 'run');
        const saved = run.chance.p;
        run.chance.p = -10;
        let res;
        try { res = Ships.resolveVoyageEvent(p, w, 'run', { onDeck: true }); } finally { run.chance.p = saved; }
        expect(res.boarding).toBeTruthy();
        expect(Ships.getBoarding(p).enemy).toBeGreaterThan(0);
        expect(res.text).toMatch(/over the side/);
        const party = DeckLife.boardingParty(Ships.getBoarding(p));
        expect(party.count).toBeGreaterThanOrEqual(DeckLife.config().boarding.min);
        expect(party.count).toBeLessThanOrEqual(DeckLife.config().boarding.max);
        // beaten off on deck: the win block (gold) applies
        const gold = p.gold;
        const out = Ships.finishBoarding(p, w, true);
        expect(out.won).toBe(true);
        expect(p.gold).toBeGreaterThan(gold);
        expect(Ships.getBoarding(p)).toBeNull();
        expect(Ships.finishBoarding(p, w, true).success).toBe(false);
    });

    it('a boarding left unfinished is rolled on the next day; heaving to settles it too', () => {
        const { w, s, p } = underWay();
        s.voyage.boarding = { enemy: 1, fight: { pirates: true, win: { text: 'Won.', renown: 1 }, lose: { text: 'Lost.' } }, eventId: 'sighted_sail' };
        w.day++;
        const day = Ships.processDaily(p, w);
        expect(day.voyage.autoBoarding.success).toBe(true);
        expect(Ships.getBoarding(p)).toBeNull();
        s.voyage.boarding = { enemy: 1, fight: { pirates: true, win: { text: 'Won.' }, lose: { text: 'Lost.' } } };
        Ships.heaveTo(p, w);
        expect(s.voyage).toBeUndefined();
    });

    it('off deck, a pirate fight is rolled at once, as before', () => {
        const { w, s, p } = underWay();
        pend(s, 'sighted_sail', w);
        const res = Ships.resolveVoyageEvent(p, w, 'prey');
        expect(res.boarding).toBeNull();
        expect(s.voyage.boarding).toBeNull();
    });
});

describe('the deck scene (ui/innerMapDeck.js)', () => {
    let InnerMapDeck;
    beforeAll(async () => { ({ InnerMapDeck } = await import('../ui/innerMapDeck.js')); });

    function sceneGame(typeId = 'caravel') {
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
        expect(InnerMapDeck.onEnter(game)).toBe(true);
        return { game, w, s, p };
    }

    afterEach(() => { if (InnerMapDeck) { InnerMapDeck._fight = null; InnerMapDeck._game = null; } InnerMap.active = false; });

    it('comes aboard to a manned deck; the deck menu has the helm, the hold and the orders, not "Strike"', () => {
        const { game } = sceneGame();
        expect(InnerMapDeck.active(game)).toBe(true);
        expect(InnerMap.npcs.filter(n => n.deckRole).length).toBeGreaterThan(3);
        const L = InnerMap._deck;
        const items = [{ type: 'header', label: 'Brig' }, { type: 'action', action: 'interact_object' }, { type: 'action', action: 'attack_object' }];
        InnerMapDeck.menuItems(game, items, InnerMap.tiles[L.helm.r][L.helm.q], L.helm.q, L.helm.r, []);
        const acts = items.map(i => i.action).filter(Boolean);
        expect(acts).toContain('deck_helm');
        expect(acts).toContain('deck_hold');
        expect(acts).toContain('deck_order');
        expect(acts).not.toContain('attack_object');
        InnerMapDeck.showHelm(game);
        expect(game.ui.panel.html).toMatch(/Sail through the day/);
        InnerMapDeck.showHold(game);
        expect(game.ui.panel.title).toMatch(/Hold/);
        const mate = InnerMap.npcs.find(n => n.deckRole === 'mate');
        expect(InnerMapDeck.talk(game, mate)).toBe(true);
        expect(game.ui.panel.html).toMatch(/hands aboard/);
    });

    it('an event sends the cry up and the crew to the rail; a storm sends them to the pumps', () => {
        const { game, s, w } = sceneGame();
        pend(s, 'castaway', w);
        InnerMapDeck._refresh(game, false);
        expect(InnerMapDeck._sit.kind).toBe('event');
        expect(InnerMap.npcs.filter(n => n.deckRole).some(n => n.deckStation === 'rail')).toBe(true);
        expect(game.notes.some(n => /Castaway/.test(n))).toBe(true);
        InnerMapDeck.choose(game, 'rescue');
        expect(s.voyage.pending).toBeNull();
        w.weather = { getWeather: () => ({ type: 'storm', intensity: 1 }), getTemperature: () => ({ value: 0.5 }) };
        InnerMapDeck._refresh(game, false);
        expect(InnerMapDeck._sit.kind).toBe('storm');
        expect(InnerMap.npcs.filter(n => n.deckStation === 'pump').length).toBeGreaterThan(1);
    });

    it('sailing through the day moves the voyage on, and the morning comes on deck', () => {
        const { game, s } = sceneGame();
        const step = s.voyage.step;
        InnerMapDeck.sailThroughDay(game);
        expect(s.voyage ? s.voyage.step : Infinity).toBeGreaterThan(step);
        expect(InnerMap.timeOfDay).toBe(8);
        expect(InnerMapDeck.onVoyageDay(game, { log: [], notable: false })).toBe(true);
    });

    it('boarders fought on deck: a pirate hull alongside, the fight to its end, the event\'s outcome', () => {
        const { game, s, p, w } = sceneGame('galleon');
        s.voyage.boarding = { enemy: 12, fight: { pirates: true, win: { text: 'Driven off.', gold: [50, 50] }, lose: { text: 'Taken.', hull: 5 } }, eventId: 'sighted_sail', icon: '⛵', title: 'Sail Ho!' };
        InnerMapDeck._startBoarding(game, true);
        const f = InnerMapDeck._fight;
        expect(f.boarders.length).toBeGreaterThanOrEqual(2);
        expect(InnerMap._deck.pirate).toBeTruthy();
        expect(InnerMapDeck._sit.kind).toBe('boarding');
        // Bring every boarder up against a hand and let the blows fall
        const gold = p.gold;
        for (let i = 0; i < 400 && InnerMapDeck._fight; i++) {
            const crew = InnerMap.npcs.filter(n => n.deckRole && !n._deckWounded && n.deckStation === 'fight');
            for (const b of InnerMapDeck._fight.boarders.filter(x => !x._down)) {
                const hand = crew[0];
                if (hand) { b.q = hand.q + 1; b.r = hand.r; }
            }
            // (the player stays clear at the helm)
            InnerMap.playerInnerQ = InnerMap._deck.helm.q; InnerMap.playerInnerR = InnerMap._deck.helm.r;
            InnerMapDeck._fightTick(1.2, game);
        }
        expect(InnerMapDeck._fight).toBeNull();
        expect(s.voyage.boarding).toBeNull();
        expect(InnerMap._deck.pirate).toBeNull();
        expect(InnerMap.npcs.some(n => n._boarder)).toBe(false);
        expect(game.notes.some(n => /Boarders Beaten Off|Boarded and Beaten/.test(n))).toBe(true);
        expect(p.gold !== gold || s.condition < 100).toBe(true);
        void w;
    });

    it('draws every sea scene and the voyage line without a throw', () => {
        const { game, s, w } = sceneGame('galleon');
        const grad = { addColorStop() {} };
        const ctx = new Proxy({ canvas: { width: 800, height: 600 } }, {
            get(target, k) {
                if (k in target) return target[k];
                if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
                if (k === 'measureText') return () => ({ width: 10 });
                return () => {};
            },
            set(target, k, v) { target[k] = v; return true; },
        });
        const camera = { zoom: 2, worldToScreenFast: (x, y) => ({ x, y }) };
        const canvas = { width: 800, height: 600 };
        for (const scene of ['overboard', 'sail', 'convoy', 'derelict', 'coils', 'whales', 'shoal', 'castaway', 'bottle', 'elmo', 'fog', null]) {
            InnerMapDeck._sit = { kind: 'event', scene, storm: scene === 'fog' ? { type: 'storm', danger: 1 } : null, landNear: scene === 'sail' };
            expect(() => InnerMapDeck.renderSea(ctx, camera, canvas)).not.toThrow();
        }
        pend(s, 'whales', w);
        expect(() => InnerMapDeck.renderHud(ctx, camera, canvas)).not.toThrow();
        expect(InnerMap._deck.mastTops.length).toBeGreaterThan(1);
        void game;
    });

    it('leaving the deck mid-fight settles it by the dice', () => {
        const { game, s } = sceneGame();
        s.voyage.boarding = { enemy: 5, fight: { pirates: true, win: { text: 'Won.' }, lose: { text: 'Lost.' } } };
        InnerMapDeck._startBoarding(game, true);
        InnerMapDeck.onExit(game);
        expect(s.voyage.boarding).toBeNull();
        expect(InnerMapDeck._fight).toBeNull();
    });
});

describe('the deck on the inner map', () => {
    function goAboard(typeId = 'galleon') {
        const { w, s, p } = underWay(typeId);
        const g = { world: w, player: p };
        InnerMap.enter(g, p.q, p.r);
        return { g, w, s, p };
    }

    it('finds the helm at the stern, the bow, the masts and the hatch on the deck', () => {
        goAboard('galleon');
        const L = InnerMap._deckLayout();
        expect(L).toBeTruthy();
        expect(L.helm.q).toBeGreaterThan(L.bow.q);
        expect(L.masts.length).toBeGreaterThanOrEqual(2);
        for (const c of [L.helm, L.bow, L.hatch, ...L.masts]) {
            expect(InnerMap.isOnDeck(c.q, c.r)).toBe(true);
            expect(InnerMap.tiles[c.r][c.q].subTerrain.passable).toBe(true);
        }
        expect(InnerMap.tiles[L.helm.r][L.helm.q]._helm).toBe(true);
        expect(InnerMap.tiles[L.hatch.r][L.hatch.q]._hatch).toBe(true);
        for (const st of ['quarterdeck', 'mast', 'pump', 'rail', 'rest', 'pray']) {
            expect(InnerMap._deckStationCells(st).every(c => InnerMap.isOnDeck(c.q, c.r)), st).toBe(true);
        }
    });

    it('mans the deck: every hand on a deck cell, at their station, and walks them from station to station', () => {
        const { s } = goAboard('caravel');
        const roster = DeckLife.roster(s);
        const crew = InnerMap._manDeck(roster);
        expect(crew.length).toBe(roster.length);
        for (const n of crew) expect(InnerMap.isOnDeck(n.q, n.r)).toBe(true);
        const helmsman = crew.find(n => n.deckRole === 'helmsman');
        expect(helmsman.q).toBe(InnerMap._deck.helm.q);
        // manning again does not double the crew
        InnerMap._manDeck(roster);
        expect(InnerMap.npcs.filter(n => n.deckRole).length).toBe(roster.length);
        // a hand sent to the pumps walks there, then works
        const hand = InnerMap.npcs.find(n => n.deckRole === 'deckhand' || n.deckRole === 'topman') || InnerMap.npcs[InnerMap.npcs.length - 1];
        hand.deckStation = 'pump';
        hand.deckWork = DeckLife.workAt('pump');
        InnerMap._deckDestination(hand);
        if (hand.state === 'walking') {
            const end = hand.path[hand.path.length - 1];
            expect(InnerMap._deckStationCells('pump').some(c => c.q === end.q && c.r === end.r)).toBe(true);
            hand.q = end.q; hand.r = end.r; hand.path = null; hand.state = 'idle';
            Utils.setSeed(3);
            for (let i = 0; i < 6 && hand.state !== 'idle'; i++) InnerMap._deckDestination(hand);
        }
        let worked = false;
        for (let i = 0; i < 10 && !worked; i++) {
            hand.path = null; hand.state = 'idle';
            InnerMap._deckDestination(hand);
            worked = hand.state === 'idle' && !!hand.activity;
        }
        expect(worked).toBe(true);
        expect(hand.activity.anim).toBe('swing');
    });

    it('lays a pirate ship alongside and sends boarders over the rail facing it; clears it after', () => {
        const { s } = goAboard('brig');
        InnerMap._manDeck(DeckLife.roster(s));
        const pir = InnerMap._layPirateHull('hull_sloop');
        expect(pir).toBeTruthy();
        const o = InnerMap.tiles[pir.r][pir.q].customObject;
        expect(o.pirateShip).toBe(true);
        const party = DeckLife.boardingParty({ enemy: 20 });
        const boarders = InnerMap._spawnBoarders(party.names.map(name => ({ name, hp: party.hp })));
        expect(boarders.length).toBe(party.count);
        const L = InnerMap._deck;
        const rail = pir.side === 'S' ? L.railS : L.railN;
        for (const b of boarders) {
            expect(b._boarder).toBe(true);
            expect(rail.some(c => c.q === b.q && c.r === b.r)).toBe(true);
        }
        // a boarder goes for a target set on them
        const b = boarders[0];
        b.deckTarget = { q: L.helm.q, r: L.helm.r };
        InnerMap._deckDestination(b);
        expect(['walking', 'idle']).toContain(b.state);
        // boarders (and crew) stay aboard as the NPCs tick: a boarder is a
        // 'traveler' sprite with no visits, and once walked off the deck and
        // vanished, so the fight ended "won" with every boarder unhurt
        for (const n of boarders) { n.state = 'idle'; n.idleTimer = 0; n.deckTarget = null; }
        for (let i = 0; i < 120; i++) InnerMap.updateNPCs(0.25);
        for (const n of boarders) {
            expect(InnerMap.npcs).toContain(n);
            expect(n.state).not.toBe('gone');
            expect(n.departing).toBeFalsy();
        }
        expect(InnerMap.npcs.filter(n => n.deckRole).length).toBe(DeckLife.roster(s).length);
        InnerMap._clearPirateHull();
        expect(InnerMap.tiles[pir.r][pir.q].customObject).toBeNull();
        expect(InnerMap._deck.pirate).toBeNull();
    });
});
