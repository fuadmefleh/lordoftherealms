// The realm's household guard fights at the player's side on the street map
// (ui/innerMapEscort.js, data/escort.json → fight): the beast you fight, a
// beast charging you, whoever is fighting you — never a job's opponent.
// And they walk in stride while following (judged by how far they moved).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';

let InnerMap, InnerMapAnimals, InnerMapCombat, InnerMapEscort, InnerMapTasks;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapAnimals } = await import('../ui/innerMapAnimals.js'));
    ({ InnerMapCombat } = await import('../ui/innerMapCombat.js'));
    ({ InnerMapEscort } = await import('../ui/innerMapEscort.js'));
    ({ InnerMapTasks } = await import('../ui/innerMapTasks.js'));
    for (const k of ['_mountHud', '_unmountHud', '_renderHud']) vi.spyOn(InnerMapTasks, k).mockImplementation(() => {});
});

function openTiles(W = 128, H = 128) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, subTerrain: { id: 'grass', passable: true }, visible: true, explored: true });
        tiles.push(row);
    }
    return tiles;
}

const saved = {};
const KEYS = ['active', 'tiles', 'width', 'height', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_insideBuilding', 'buildings', 'animals', 'npcs', 'timeOfDay'];
function openMap(at = { q: 64, r: 64 }) {
    for (const k of KEYS) saved[k] = InnerMap[k];
    const tiles = openTiles();
    Object.assign(InnerMap, {
        active: true, tiles, width: 128, height: 128, playerInnerQ: at.q, playerInnerR: at.r,
        _playerWalking: false, _insideBuilding: null, buildings: [], animals: [], npcs: [], timeOfDay: 12,
    });
}
afterEach(() => {
    if (saved.tiles !== undefined) Object.assign(InnerMap, saved);
    InnerMapAnimals._fight = null;
    InnerMapCombat._npcReactions.clear();
    InnerMapCombat._npcHealth.clear();
    InnerMapCombat._attackState = null;
    InnerMapEscort._men = [];
});

function stubGame() {
    const notes = [];
    const player = { name: 'T', health: 100, maxHealth: 100, gold: 100, strength: 6, skills: {}, inventory: {}, reputation: {} };
    return { player, world: { day: 10 }, notes, ui: { showNotification: (t, b, k) => notes.push({ t, b, k }), updateStats() {} } };
}

const T_PX = 32;
const px = (q, r) => ({ x: q * T_PX + T_PX / 2, y: r * T_PX + T_PX / 2 });
const man = (type, at) => ({ unit: { type, realmGuard: 1 }, preset: null, horse: type === 'knight', ...at, dir: 2, moving: false, t: 0 });

describe('the guard in a fight', () => {
    it('falls on the beast you are fighting and helps bring it down', () => {
        openMap();
        const game = stubGame();
        const doe = InnerMap._makeAnimal({ id: 'd', species: 'doe', q: 65, r: 64 }, DataLoader.get('animals'));
        InnerMap.animals = [doe];
        InnerMapAnimals._fight = { a: doe, swingT: 0, chaseT: 0, path: null };
        const foe = InnerMapEscort._foe(game);
        expect(foe && foe.kind).toBe('beast');
        expect(foe.a).toBe(doe);
        const m = man('soldier', px(66, 64));
        const hp = doe.hp;
        InnerMapEscort._strike(game, m, foe);
        expect(doe.hp).toBeLessThan(hp);
        for (let i = 0; i < 40 && doe.state !== 'dead'; i++) InnerMapEscort._strike(game, m, foe);
        expect(doe.state).toBe('dead');
        expect(InnerMapAnimals._fight).toBe(null);
    });

    it('comes to you when a beast charges you, not to one grazing off', () => {
        openMap();
        const game = stubGame();
        const C = DataLoader.get('animals');
        const bear = InnerMap._makeAnimal({ id: 'b', species: 'bear', q: 66, r: 64 }, C);
        const far = InnerMap._makeAnimal({ id: 'f', species: 'doe', q: 90, r: 90 }, C);
        InnerMap.animals = [far, bear];
        expect(InnerMapEscort._foe(game)).toBe(null);
        bear.state = 'charge';
        expect(InnerMapEscort._foe(game).a).toBe(bear);
    });

    it('fights whoever is fighting you, and knocks them senseless', () => {
        openMap();
        const game = stubGame();
        const npc = { id: 'n1', name: 'Brute', type: 'villager', q: 65, r: 64, state: 'idle' };
        InnerMap.npcs = [npc];
        InnerMapCombat._npcHealth.set('n1', { current: 20, max: 60 });
        expect(InnerMapEscort._foe(game)).toBe(null); // not fighting: left alone
        InnerMapCombat._npcReactions.set('n1', { mode: 'fight', attackTimer: 1 });
        const foe = InnerMapEscort._foe(game);
        expect(foe && foe.npc).toBe(npc);
        const m = man('knight', px(66, 64));
        for (let i = 0; i < 10 && npc.state !== 'unconscious'; i++) InnerMapEscort._strike(game, m, foe);
        expect(npc.state).toBe('unconscious');
        expect(InnerMapEscort._foe(game)).toBe(null);
    });

    it('stands aside for the law: the town watch, the gaoler, a castle guard', () => {
        openMap();
        const game = stubGame();
        const law = [
            { id: 'w1', name: 'Watchman', type: 'guard', q: 65, r: 64, state: 'idle' },
            { id: 'g1', name: 'Gaoler', type: 'villager', _gaoler: true, q: 63, r: 64, state: 'idle' },
            { id: 'c1', name: 'Castle Guard', type: 'villager', _castleGuard: true, q: 64, r: 65, state: 'idle' },
        ];
        InnerMap.npcs = law.slice();
        for (const n of law) {
            InnerMapCombat._npcHealth.set(n.id, { current: 100, max: 100 });
            InnerMapCombat._npcReactions.set(n.id, { mode: 'fight', attackTimer: 1 });
        }
        expect(InnerMapEscort._foe(game)).toBe(null);
        // ...but a brawler joining the fight is still met
        const thug = { id: 't1', name: 'Thug', type: 'villager', q: 64, r: 63, state: 'idle' };
        InnerMap.npcs.push(thug);
        InnerMapCombat._npcHealth.set('t1', { current: 30, max: 60 });
        InnerMapCombat._npcReactions.set('t1', { mode: 'fight', attackTimer: 1 });
        expect(InnerMapEscort._foe(game).npc).toBe(thug);
    });

    it('keeps out of a job\'s fair fight (an arena bout, a brawler on the watch round)', () => {
        openMap();
        const game = stubGame();
        const npc = { id: 'n2', name: 'Champion', type: 'villager', q: 65, r: 64, state: 'idle', _taskFoe: { onYield() {} } };
        InnerMap.npcs = [npc];
        InnerMapCombat._npcHealth.set('n2', { current: 60, max: 60 });
        InnerMapCombat._npcReactions.set('n2', { mode: 'fight', attackTimer: 1 });
        expect(InnerMapEscort._foe(game)).toBe(null);
    });
});
