/**
 * Town life's loose ends on the street map: a funeral walked from the house
 * to the churchyard (ui/innerMapRites.js), dark windows of a sleeping house,
 * a big household's supper, fishers and miners who work beyond the map
 * (world/innerMap/townWork.js), a second priest at the altar and a wedding
 * service in the church (world/innerMap/townScenes.js), passers-by walking
 * round a fight, a thief who beats the watch, rival Houses' men in the street
 * (ui/innerMapBrawls.js, ui/innerMapScavengers.js), and the inn's keeper paid
 * (world/innerMap/hospitality.js).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Townsfolk, Brawls, InnerMapRites, InnerMapBrawls, InnerMapScavengers, Scavengers;

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
    ({ Townsfolk } = await import('../systems/townsfolk.js'));
    ({ Brawls } = await import('../systems/brawls.js'));
    ({ Scavengers } = await import('../systems/scavengers.js'));
    ({ InnerMapRites } = await import('../ui/innerMapRites.js'));
    ({ InnerMapBrawls } = await import('../ui/innerMapBrawls.js'));
    ({ InnerMapScavengers } = await import('../ui/innerMapScavengers.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function enter(hour, day = 40) {
    const settlement = { name: 'Testby', type: 'town', population: 1200, q: 5, r: 6, kingdom: 'k1' };
    const kingdom = { id: 'k1', name: 'Valdoria', ruler: 'King Aldric', religion: { faithId: 'solaris', name: 'The Solar Covenant', piety: 50 }, wars: [], isAlive: true };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], units: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: id => (id === 'k1' ? kingdom : null),
    };
    const notes = [];
    const game = { world, player: {}, settlement, ui: { showNotification: (t, x) => notes.push(`${t}: ${x}`) }, notes };
    InnerMap.timeOfDay = hour;
    InnerMap._timeAccumulator = 0;
    InnerMap.enter(game, 5, 6);
    InnerMap.timeOfDay = hour;
    return game;
}

let simNow = 1e6;
function run(game, seconds, step = 0.25, watch = null) {
    const real = performance.now;
    performance.now = () => simNow;
    try {
        for (let t = 0; t < seconds; t += step) {
            simNow += step * 1000;
            InnerMap.updateNPCs(step);
            InnerMapRites.update(step, game);
            if (watch) watch();
        }
    } finally { performance.now = real; }
}

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    InnerMap._interiorCache = {};
    InnerMap._insideBuilding = null;
    InnerMap._outerMapState = null;
    InnerMap._avoidTiles = null;
    InnerMapRites._tiles = null;
    InnerMapRites._done = new Set();
    InnerMapBrawls._fights = [];
    InnerMapBrawls._tiles = null;
    Utils.setSeed(11);
});

describe('A funeral on the street map (item 1)', () => {
    it('the kin and the priest walk the bier from the house to the churchyard, a rite at the grave, then their day', () => {
        const game = enter(11);
        const folk = game.settlement.folk;
        const day = game.world.day;
        const church = InnerMapRites._church();
        expect(church).toBeTruthy();
        // Someone with kin on the map dies
        const byPid = new Map(InnerMap.npcs.filter(n => n._person).map(n => [n._person.id, n]));
        const dead = folk.people.find(p => p.died == null && Townsfolk.age(p, day) >= 20
            && [p.spouse, ...(p.kids || []), ...(p.parents || [])].filter(id => byPid.has(id)).length >= 1
            && byPid.has(p.id) && byPid.get(p.id).type !== 'priest');
        expect(dead).toBeTruthy();
        const deadNpc = byPid.get(dead.id);
        InnerMap.npcs.splice(InnerMap.npcs.indexOf(deadNpc), 1);
        dead.died = day;
        folk.annals.push({ k: 'died', a: dead.id, d: day, x: 'a fever' });
        // (the kin up and about)
        for (const id of [dead.spouse, ...(dead.kids || []), ...(dead.parents || [])]) {
            const n = byPid.get(id);
            if (n && n.state === 'inside_building') { n.state = 'idle'; n.currentBuilding = null; n._insideBuildingQ = undefined; }
        }
        run(game, 4);
        expect(InnerMap._funeralOn).toBe(true);
        const F = InnerMapRites._funeral;
        expect(F).toBeTruthy();
        expect(F.bearers.length).toBe(2);
        expect(F.bearers.every(b => b._rite === F.key)).toBe(true);
        expect(game.notes.some(t => /funeral/i.test(t))).toBe(true);
        const phases = new Set();
        let bier = 0;
        let atGrave = Infinity;
        run(game, 200, 0.25, () => {
            if (InnerMapRites._funeral) phases.add(InnerMapRites._funeral.phase);
            if (InnerMapRites._funeral && InnerMapRites._funeral.phase === 'rite') atGrave = Math.min(atGrave, Math.max(Math.abs(F.bearers[0].q - F.grave.q), Math.abs(F.bearers[0].r - F.grave.r)));
            if (InnerMapRites._funeral && InnerMapRites._funeral.phase === 'walk') {
                const items = [];
                const ctx = { canvas: { width: 4000, height: 4000 } };
                InnerMapRites.collect(items, ctx, { zoom: 1, worldToScreenFast: (x, y) => ({ x: x % 2000, y: y % 2000 }) }, 32);
                bier += items.length;
            }
        });
        expect([...phases]).toEqual(expect.arrayContaining(['gather', 'walk', 'rite']));
        expect(bier).toBeGreaterThan(0);
        // At the grave for the rite: the lead bearer stood beside it
        expect(InnerMapRites._funeral).toBe(null);
        expect(atGrave).toBeLessThanOrEqual(4);
        expect(InnerMap.npcs.some(n => n._rite)).toBe(false);
        // (the sick-town mourners stood aside the while: it's the funeral's death)
        expect(InnerMap._funeralOn).toBe(true);
    });
});

describe('Lit windows (item 4)', () => {
    it('a house goes dark when its household is abed, and lit while someone is up', () => {
        const game = enter(2);
        void game;
        const homes = new Map();
        for (const n of InnerMap.npcs) if (n._home && n._home.type === 'house' && n.type !== 'traveler') (homes.get(n._home) || homes.set(n._home, []).get(n._home)).push(n);
        const [house, folk] = [...homes.entries()][0];
        for (const n of folk) {
            n.state = 'inside_building';
            n.currentBuilding = 'house';
            n._insideBuildingQ = house.q; n._insideBuildingR = house.r;
        }
        InnerMap._darkCache = null;
        expect(InnerMap._householdDark(house)).toBe(true);
        // An evening: someone's up at home
        InnerMap.timeOfDay = 19;
        InnerMap._darkCache = null;
        expect(InnerMap._householdDark(house)).toBe(false);
        // (a tavern or a church keeps its light: never a household's)
        const tav = InnerMap.buildings.find(b => b.type === 'tavern' || b.type === 'church');
        InnerMap.timeOfDay = 2;
        InnerMap._darkCache = null;
        expect(InnerMap._householdDark(tav)).toBe(false);
    });
});

describe('A big household at supper (item 9)', () => {
    it('past the table\'s stools the rest sit by the hearth or the wall, none left standing', () => {
        const game = enter(19);
        const house = InnerMap.buildings.find(b => b.type === 'house');
        InnerMap.enterBuilding(house, game, { force: true });
        expect(InnerMap._insideBuilding).toBeTruthy();
        const table = InnerMap._tableSeats().length;
        const fam = [];
        for (let i = 0; i < table + 4; i++) {
            const d = InnerMap._doorTile ? InnerMap._doorTile() : { q: 2, r: 2 };
            const n = { id: 900 + i, uid: `f${i}`, type: 'villager', name: `Kin${i}`, q: d.q, r: d.r, prevQ: d.q, prevR: d.r, state: 'inside_building', _meal: 'supper', _home: house, idleTimer: 30, speed: 1 };
            InnerMap.npcs.push(n);
            fam.push(n);
        }
        for (let k = 0; k < 40; k++) for (const n of fam) InnerMap._jobTableMeal(n, 0.25);
        const seated = fam.filter(n => n.activity && n.activity.type === 'meal' && n.activity.anim === 'sitting');
        expect(seated.length).toBe(fam.length);
        expect(fam.filter(n => n._mealSeat && (n._mealSeat.hearth || n._mealSeat.wall)).length).toBeGreaterThanOrEqual(4);
        // no two on one spot
        const spots = new Set(fam.map(n => `${n.q},${n.r}`));
        expect(spots.size).toBe(fam.length);
        InnerMap.exitBuilding(game);
    });
});

describe('Fishers and miners beyond the map (item 10)', () => {
    it('no shore in reach: out at the gate when work begins, back in at its end', () => {
        const game = enter(8);
        void game;
        const npc = InnerMap.npcs.find(n => n._person && n.type === 'villager' && n._home);
        npc._person.job = { id: 'fisher', rank: 'master', since: 1 };
        npc.state = 'idle';
        npc.path = null;
        const job = InnerMap._jobOf(npc);
        expect(job && job.o.work).toBe('fish');
        const shore = vi.spyOn(InnerMap, '_shoreSpots').mockReturnValue([]);
        try {
            expect(InnerMap._jobWork(npc, job)).toBe(true);
            expect(npc._activity).toBe('commute');
            for (let t = 0; t < 120 && npc.state !== 'inside_building'; t += 0.25) InnerMap.updateNPCs(0.25);
            expect(npc.state).toBe('inside_building');
            expect(npc.currentBuilding).toBe('away');
            expect(npc._awayAtWork.kind).toBe('fish');
            // (not today again)
            expect(InnerMap._jobCommute(npc, job)).toBe(false);
            // The day's work done: back in at the gate
            npc.idleTimer = 0.1;
            InnerMap.timeOfDay = 18;
            InnerMap.updateNPCs(0.25);
            expect(npc.state).not.toBe('inside_building');
            const A = InnerMap.townArea();
            expect(A.gates.some(g => Math.max(Math.abs(g.q - npc.q), Math.abs(g.r - npc.r)) <= 3)).toBe(true);
        } finally { shore.mockRestore(); }
    });
});

describe('The church (items 7, 8)', () => {
    it('a second priest is stood beside the altar, not wandering the nave', () => {
        const game = enter(8, 3);
        InnerMap.timeOfDay = 8;
        InnerMap._timeAccumulator = 0.3 * 60;
        const church = InnerMap.buildings.find(b => b.type === 'church');
        InnerMap.enterBuilding(church, game);
        for (let k = 0; k < 8; k++) { InnerMap.updateTime(0.25); InnerMap.updateNPCs(0.25); }
        const d = InnerMap._doorTile();
        const extra = { id: 990, uid: 'p2', type: 'priest', name: 'Brother Tam', q: d.q, r: d.r, prevQ: d.q, prevR: d.r, state: 'inside_building', _work: church, idleTimer: 60, speed: 1 };
        InnerMap.npcs.push(extra);
        for (let k = 0; k < 40; k++) { InnerMap.updateTime(0.25); InnerMap.updateNPCs(0.25); }
        const staff = InnerMap.npcs.filter(n => n._scene && n._scene.role === 'staff');
        expect(staff.length).toBe(1);
        expect(extra._scene && extra._scene.role).toBe('assistant');
        expect(extra._scene.phase).toBe('at');
        expect(extra.activity.label).toMatch(/altar/i);
        InnerMap.exitBuilding(game);
    });

    it('a wedding service: the couple before the altar, the guests in the pews, the priest\'s prayers and the vows', () => {
        const game = enter(11, 4);
        const church = InnerMap.buildings.find(b => b.type === 'church');
        InnerMap.enterBuilding(church, game);
        const d = InnerMap._doorTile();
        const mk = (id, role, type = 'villager') => {
            const n = { id, uid: `w${id}`, type, name: `W${id}`, q: d.q, r: d.r, prevQ: d.q, prevR: d.r, state: 'inside_building', idleTimer: 60, speed: 1, _wedding: 'k', _weddingRole: role, _rite: 'k' };
            InnerMap.npcs.push(n);
            return n;
        };
        const a = mk(980, 'couple');
        const b = mk(981, 'couple');
        for (let i = 0; i < 4; i++) mk(982 + i, 'guest');
        const said = new Set();
        const real = performance.now;
        performance.now = () => simNow;
        try {
            for (let k = 0; k < 160; k++) {
                simNow += 250;
                InnerMap.updateTime(0.25);
                InnerMap.updateNPCs(0.25);
                for (const n of InnerMap.npcs) if (n._bark && n._bark.text) said.add(n._bark.text);
            }
        } finally { performance.now = real; }
        expect(a._scene && a._scene.role).toBe('couple');
        expect(b._scene && b._scene.role).toBe('couple');
        expect(a.facing).toBe(0);
        const L = DataLoader._gamedata.townWorship.lines;
        expect([...said].some(t => L.weddingVow.includes(t))).toBe(true);
        expect(InnerMap.npcs.filter(n => n._weddingRole === 'guest' && n._scene && n._scene.role === 'patron').length).toBeGreaterThan(0);
        InnerMap.exitBuilding(game);
    });
});

describe('Fights in the street (items 14, 15, 16)', () => {
    it('paths go round a fight\'s ground; the player\'s own walk is not turned', () => {
        enter(12);
        const W = InnerMap.width;
        const A = InnerMap.townArea();
        const from = InnerMap.townSpot(() => 0.1, A.center, 4);
        const to = InnerMap.townSpot(() => 0.9, A.center, 8);
        const plain = InnerMap._findPath(from.q, from.r, to.q, to.r);
        expect(plain && plain.length).toBeGreaterThan(3);
        // A fight on the middle of that way
        const mid = plain[Math.floor(plain.length / 2)];
        const set = new Set();
        set.w = W;
        for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) set.add((mid.r + dr) * W + mid.q + dq);
        InnerMap._avoidTiles = set;
        const round = InnerMap._findPath(from.q, from.r, to.q, to.r);
        expect(round).toBeTruthy();
        const through = p => p.slice(1, -1).filter(t => set.has(t.r * W + t.q)).length;
        expect(through(round)).toBeLessThan(through(plain));
        // (the player's walk keeps its own way: levels)
        const mine = InnerMap._findPath(from.q, from.r, to.q, to.r, { levels: true });
        expect(mine.length).toBeLessThanOrEqual(round.length);
        InnerMap._avoidTiles = null;
    });

    it('a live fight marks its ground for the pathfinder', () => {
        const game = enter(12);
        const [a, b] = InnerMap.npcs.filter(n => n._person && n.type === 'villager').slice(0, 2);
        // (face to face in the square)
        const A = InnerMap.townArea();
        const at = InnerMap.townSpot(() => 0.3, A.center, 3);
        const t = (q, r) => InnerMap.tiles[r] && InnerMap.tiles[r][q] && InnerMap.tiles[r][q].subTerrain.passable;
        const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dq, dr]) => ({ q: at.q + dq, r: at.r + dr })).find(x => t(x.q, x.r));
        for (const [n, p] of [[a, at], [b, side]]) { Object.assign(n, { q: p.q, r: p.r, prevQ: p.q, prevR: p.r, state: 'idle', path: null, currentBuilding: null }); }
        const F = InnerMapBrawls.start(game, a, b, { cause: 'market' });
        expect(F).toBeTruthy();
        InnerMapBrawls._keepClear();
        expect(InnerMap._avoidTiles && InnerMap._avoidTiles.has(a.r * InnerMap.width + a.q)).toBe(true);
        InnerMapBrawls._fights = [];
        InnerMapBrawls._keepClear();
        expect(InnerMap._avoidTiles).toBe(null);
    });

    it('a thief who beats the guard and runs is not recorded as caught', () => {
        const game = enter(12);
        const thief = InnerMap.npcs.find(n => n._person && n.type === 'villager' && n.state !== 'inside_building');
        const commit = vi.spyOn(Scavengers, 'commit').mockReturnValue({ text: 'robbed', took: {} });
        const sight = vi.spyOn(InnerMapScavengers, '_sight').mockReturnValue({ seen: [], guards: 1, player: false });
        let onEnd = null;
        const resist = vi.spyOn(InnerMapBrawls, 'resistArrest').mockImplementation((g, n, o) => { onEnd = o && o.onEnd; return true; });
        try {
            const R = { npc: thief, spot: { q: thief.q, r: thief.r }, plan: { target: { kind: 'plot', q: thief.q, r: thief.r } } };
            InnerMapScavengers._finishRobbery(game, game.settlement, R, game.world.day);
            // the fight is on: nothing on the record yet
            expect(commit).not.toHaveBeenCalled();
            expect(typeof onEnd).toBe('function');
            // ...and the thief won and ran
            onEnd(false);
            expect(commit).toHaveBeenCalledTimes(1);
            expect(commit.mock.calls[0][4].caught).toBe(false);
        } finally { commit.mockRestore(); sight.mockRestore(); resist.mockRestore(); }
    });

    it('the brawl tells its caller how a resisted arrest ended', () => {
        const game = enter(12);
        const [thief, guard] = [InnerMap.npcs.find(n => n._person && n.type === 'villager' && n.state !== 'inside_building'), InnerMap.npcs.find(n => n.type === 'guard')];
        guard.state = 'idle';
        guard.q = thief.q + 2; guard.r = thief.r;
        const res = vi.spyOn(Brawls, 'resists').mockReturnValue(true);
        let told = null;
        try {
            expect(InnerMapBrawls.resistArrest(game, thief, { onEnd: (taken) => { told = taken; } })).toBe(true);
            const F = InnerMapBrawls._fights[0];
            Brawls.end(F.fight, 'ko', 0);
            InnerMapBrawls._finish(F, game);
            expect(told).toBe(false);
        } finally { res.mockRestore(); }
    });

    it('two rival Houses\' retinues in town: their men clash in the street, told by the Houses\' names', () => {
        const game = enter(12);
        game.world.units = [
            { id: 'u1', type: 'rival_retinue', q: 5, r: 6, houseName: 'House Varr' },
            { id: 'u2', type: 'rival_retinue', q: 5, r: 6, houseName: 'House Orme' },
        ];
        const R = Brawls.config().causes.retainers;
        const was = R.onMap;
        R.onMap = 1;
        try {
            InnerMapBrawls._retainDay = null;
            InnerMapBrawls._maybeRetainers(game, game.settlement);
            const F = InnerMapBrawls._fights[0];
            expect(F).toBeTruthy();
            expect(F.fight.cause).toBe('retainers');
            expect(F.names).toEqual({ a: 'House Varr', b: 'House Orme' });
            expect(Brawls.fighters(F.fight).length).toBeGreaterThanOrEqual(4);
            expect(InnerMap.npcs.filter(n => n._retainerOf).length).toBeGreaterThanOrEqual(4);
            // once a day
            InnerMapBrawls._fights = [];
            InnerMapBrawls._maybeRetainers(game, game.settlement);
            expect(InnerMapBrawls._fights.length).toBe(0);
        } finally { R.onMap = was; }
    });
});

describe('The inn\'s keeper paid (item 3)', () => {
    it('a traveller come to the inn for the night pays for the bed, into the keeper\'s purse', () => {
        enter(20);
        const inn = InnerMap.buildings.find(b => ['inn', 'tavern'].includes(b.type) && b.ownerId != null);
        expect(inn).toBeTruthy();
        const keeper = InnerMap.npcs.find(n => n.id === inn.ownerId);
        const tr = InnerMap.npcs.find(n => n.type === 'traveler') || InnerMap.npcs.find(n => !n._person);
        tr.type = 'traveler';
        tr._home = inn;
        tr._purse = 30;
        const before = keeper._person ? Townsfolk.purse(keeper._folk, keeper._person) : 0;
        const res = InnerMap._townEntered(tr, inn);
        expect(res && res.paid).toBeGreaterThan(0);
        expect(tr._purse).toBe(30 - res.paid);
        if (keeper._person) expect(keeper._person.purse).toBeCloseTo(before + res.paid, 5);
        // once a night
        expect(InnerMap._townEntered(tr, inn)).toBe(null);
    });
});

describe('Knocked out and bound (manual fixes)', () => {
    it('a crushing blow\'s overkill reaches the bleed roll (not a flat chance)', async () => {
        const { InnerMapCombat } = await import('../ui/innerMapCombat.js');
        const { Downed } = await import('../systems/downed.js');
        const game = enter(12);
        const npc = InnerMap.npcs.find(n => n._person && n.type === 'villager');
        const spy = vi.spyOn(Downed, 'rollBleed').mockReturnValue(null);
        try {
            InnerMapCombat._knockOutNPC(npc, game, 0.6);
            expect(spy).toHaveBeenCalled();
            expect(spy.mock.calls[0][1]).toBe(0.6);
        } finally { spy.mockRestore(); }
        // and the overkill does what the data says: more bleed on a crushing blow
        let soft = 0, hard = 0;
        Utils.setSeed(5);
        for (let i = 0; i < 400; i++) if (Downed.rollBleed(0, 0)) soft++;
        for (let i = 0; i < 400; i++) if (Downed.rollBleed(0, 0.6)) hard++;
        expect(hard).toBeGreaterThan(soft);
    });

    it('a passer-by who hears the bound cry out walks over, unties them, and runs for the watch', async () => {
        const { InnerMapDowned } = await import('../ui/innerMapDowned.js');
        const game = enter(12);
        const [victim, helper] = InnerMap.npcs.filter(n => n._person && n.type === 'villager').slice(0, 2);
        const A = InnerMap.townArea();
        const at = InnerMap.townSpot(() => 0.4, A.center, 3);
        Object.assign(victim, { q: at.q, r: at.r, prevQ: at.q, prevR: at.r, state: 'bound', _bound: true, path: null });
        const start = InnerMap.townSpot(() => 0.7, at, 5);
        Object.assign(helper, { q: start.q, r: start.r, prevQ: start.q, prevR: start.r, state: 'idle', path: null, currentBuilding: null });
        const real = performance.now;
        let clock = 5e6;
        performance.now = () => clock;
        try {
            victim._helper = { id: helper.id, at: clock };
            let untied = false;
            for (let t = 0; t < 40 && !untied; t += 0.25) {
                clock += 250;
                InnerMap.updateNPCs(0.25);
                InnerMapDowned._boundTick(game, victim, clock);
                untied = !victim._bound;
            }
            expect(untied).toBe(true);
            expect(victim.state).not.toBe('bound');
            expect(helper._untied).toBe(victim.id);
            expect(Math.max(Math.abs(helper.q - victim.q), Math.abs(helper.r - victim.r))).toBeLessThanOrEqual(3);
        } finally { performance.now = real; }
    });
});
