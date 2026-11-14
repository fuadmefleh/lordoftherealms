// Your travelling companions walk behind you on the street map
// (ui/innerMapCompanions.js), nearest first, and the household guard falls in
// behind them; out of sight indoors and when the party is empty.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';

let InnerMap, InnerMapCompanions, Companions, InnerMapAnimals, InnerMapCombat, InnerMapTasks;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapCompanions } = await import('../ui/innerMapCompanions.js'));
    ({ Companions } = await import('../systems/companions.js'));
    ({ InnerMapAnimals } = await import('../ui/innerMapAnimals.js'));
    ({ InnerMapCombat } = await import('../ui/innerMapCombat.js'));
    ({ InnerMapTasks } = await import('../ui/innerMapTasks.js'));
    for (const k of ['_mountHud', '_unmountHud', '_renderHud']) vi.spyOn(InnerMapTasks, k).mockImplementation(() => {});
});

const saved = {};
const KEYS = ['active', 'tiles', 'width', 'height', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_insideBuilding', 'animals', 'npcs'];
let pos = { x: 0, y: 0 };
function openMap() {
    for (const k of KEYS) saved[k] = InnerMap[k];
    Object.assign(InnerMap, { active: true, tiles: [[]], width: 128, height: 128, playerInnerQ: 64, playerInnerR: 64, _playerWalking: false, _insideBuilding: null, animals: [], npcs: [] });
    pos = { x: 64 * 32 + 16, y: 64 * 32 + 16 };
    vi.spyOn(InnerMap, 'getPlayerWorldPos').mockImplementation(() => ({ x: pos.x, y: pos.y }));
}
afterEach(() => {
    vi.restoreAllMocks();
    for (const k of ['_mountHud', '_unmountHud', '_renderHud']) vi.spyOn(InnerMapTasks, k).mockImplementation(() => {});
    InnerMapAnimals._fight = null;
    InnerMapCombat._npcReactions.clear();
    InnerMapCombat._npcHealth.clear();
    if (saved.tiles !== undefined) Object.assign(InnerMap, saved);
    Object.assign(InnerMapCompanions, { _men: [], _trail: [], _sig: '', _map: null, _shown: false });
});

const party = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, firstName: `Comp${i}`, gender: i % 2 ? 'female' : 'male', isAlive: true }));
const game = () => ({ player: { name: 'T', health: 100, maxHealth: 100, gold: 100, skills: {}, inventory: {}, reputation: {} }, world: { day: 1 }, ui: { showNotification() {}, updateStats() {} } });

/** Walk the player `tiles` tiles north, a frame at a time. */
function walk(g, tiles) {
    for (let i = 0; i < tiles * 10; i++) {
        pos.y -= 3.2;
        InnerMapCompanions.update(1 / 30, g);
    }
    for (let i = 0; i < 90; i++) InnerMapCompanions.update(1 / 30, g);
}

describe('companions on the street map', () => {
    it('follow behind the player in file, nearest first', () => {
        openMap();
        vi.spyOn(Companions, 'members').mockReturnValue(party(3));
        const g = game();
        walk(g, 8);
        const men = InnerMapCompanions._men;
        expect(men.length).toBe(3);
        expect(InnerMapCompanions.count()).toBe(3);
        // all behind (south of) the player, each further back than the one before
        let prev = pos.y;
        for (const m of men) {
            expect(m.y).toBeGreaterThan(prev);
            expect(m.y - pos.y).toBeLessThan(32 * 5);
            prev = m.y;
        }
        // and they keep up when the player walks on
        const before = men[0].y;
        walk(g, 6);
        expect(men[0].y).toBeLessThan(before - 32 * 4);
    });

    it('caps the file at four and shows none with an empty party', () => {
        openMap();
        const spy = vi.spyOn(Companions, 'members').mockReturnValue(party(6));
        InnerMapCompanions.update(1 / 30, game());
        expect(InnerMapCompanions._men.length).toBe(4);
        spy.mockReturnValue([]);
        InnerMapCompanions.update(1 / 30, game());
        expect(InnerMapCompanions.count()).toBe(0);
    });

    it('stays out of sight indoors', () => {
        openMap();
        vi.spyOn(Companions, 'members').mockReturnValue(party(2));
        InnerMapCompanions.update(1 / 30, game());
        expect(InnerMapCompanions.count()).toBe(2);
        InnerMap._insideBuilding = { id: 'b1' };
        InnerMapCompanions.update(1 / 30, game());
        expect(InnerMapCompanions.count()).toBe(0);
    });

    it('fight beside you: they close on whoever is fighting you and knock them down', () => {
        openMap();
        vi.spyOn(Companions, 'members').mockReturnValue(party(2));
        const g = game();
        const npc = { id: 'n1', name: 'Brute', type: 'villager', q: 66, r: 64, state: 'idle' };
        InnerMap.npcs = [npc];
        InnerMapCombat._npcHealth.set('n1', { current: 30, max: 60 });
        // not fighting you: left alone
        for (let i = 0; i < 60; i++) InnerMapCompanions.update(1 / 30, g);
        expect(InnerMapCompanions._men.some(m => m.fighting)).toBe(false);
        expect(InnerMapCombat._npcHealth.get('n1').current).toBe(30);
        InnerMapCombat._npcReactions.set('n1', { mode: 'fight', attackTimer: 1 });
        vi.spyOn(InnerMapCombat, '_knockOutNPC').mockImplementation(() => {});
        vi.spyOn(InnerMapCombat, '_maybeBreak').mockImplementation(() => {});
        for (let i = 0; i < 30 * 20; i++) InnerMapCompanions.update(1 / 30, g);
        expect(InnerMapCombat._npcHealth.get('n1').current).toBe(0);
        expect(InnerMapCombat._knockOutNPC).toHaveBeenCalled();
    });

    it('hit harder for a fighting role and a good mood', () => {
        const p = { name: 'T' };
        vi.spyOn(Companions, 'effectiveness').mockReturnValue(1);
        const baker = InnerMapCompanions.damageOf(p, { id: 'a', occupation: 'baker' });
        const knight = InnerMapCompanions.damageOf(p, { id: 'b', occupation: 'knight' });
        expect(knight).toBeGreaterThan(baker);
        Companions.effectiveness.mockReturnValue(0.5);
        expect(InnerMapCompanions.damageOf(p, { id: 'b', occupation: 'knight' })).toBeLessThan(knight);
    });
});
