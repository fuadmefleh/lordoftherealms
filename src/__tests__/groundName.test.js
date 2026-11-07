/**
 * The ground a tile is called in menus (InnerMap.groundName): what is drawn
 * there, not the name the generation rolled off the hex's list ("Snow" on
 * green grass, "Forest" in a town square).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const rolled = (id, name, extra = {}) => ({ subTerrain: { id, name, icon: '❄️', passable: true }, parentTerrain: 'snow', ...extra });

describe('groundName', () => {
    it('names the drawn ground, not the roll', () => {
        InnerMap.season = 'Spring';
        expect(InnerMap._isRolledSub({ id: 'snow', name: 'Snow' })).toBe(true);
        expect(InnerMap.groundName(rolled('snow', 'Snow', { terrainDetail: { layer: 'grass' } })).name).toBe('Grass');
        expect(InnerMap.groundName(rolled('trees', 'Forest', { terrainDetail: {} })).name).toBe('Grass');
        expect(InnerMap.groundName(rolled('snow', 'Snow', { isRoad: true })).name).toMatch(/Road|Street/);
        expect(InnerMap.groundName(rolled('grass', 'Clearing', { _fieldSoil: true })).name).toBe('Field');
        // No grass layer: the bare fill
        expect(InnerMap.groundName({ subTerrain: { id: 'sand', name: 'Sand Dunes', passable: true }, parentTerrain: 'desert' }).name)
            .toBe(InnerMap._isRolledSub({ id: 'sand', name: 'Sand Dunes' }) ? 'Sand' : 'Sand Dunes');
        // In winter the grass lies under snow
        InnerMap.season = 'Winter';
        expect(InnerMap.groundName(rolled('trees', 'Forest', { parentTerrain: 'woodland', terrainDetail: { layer: 'grass' } })).name).toBe('Snowy Grass');
        // and on a snowfield it is just snow
        expect(InnerMap.groundName(rolled('snow', 'Snow', { terrainDetail: { layer: 'grass' } })).name).toBe('Snow');
        InnerMap.season = 'Spring';
    });

    it('keeps a name laid on purpose (water, a bridge, tilled soil)', () => {
        expect(InnerMap.groundName({ subTerrain: { id: 'pond', name: 'Pond', icon: '💧', passable: false } }).name).toBe('Pond');
        expect(InnerMap.groundName({ subTerrain: { id: 'bridge', name: 'Bridge', icon: '🌉', passable: true }, terrainDetail: { layer: 'grass' } }).name).toBe('Bridge');
    });
});
