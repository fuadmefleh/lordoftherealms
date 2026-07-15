/**
 * Structural guards for the class splits World and AudioManager.
 * World -> world/{core,generation,runtime}.js (methods on the prototype).
 * AudioManager -> audio/{core,scenes,sfx,controls}.js, with the audioManager
 * singleton created in index.js after the prototype is assembled.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { World } from '../world/world.js';
import { AudioManager, audioManager } from '../systems/audio.js';

const WORLD = ['generate', 'loadFromEditorData', '_estimateElevation', '_estimateHeat', '_estimateMoisture', '_assignResources', 'placeIndependentSettlements', 'placePointsOfInterest', 'generateRoads', 'findRoadPath', 'getTile', 'getKingdom', 'advanceDay', 'spawnInitialUnits', 'processUnits', 'spawnUnits', 'generateEvents', 'isPassable', 'getAllSettlements'];
const AUDIO = ['init', 'setScene', 'playSFX', '_playTitle', '_windAmbience', '_sfxClick', 'setMasterVolume', 'setMusicVolume', 'toggleMute', 'updateSceneFromGameState', '_savePreferences', 'destroy'];

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('World split — structural equivalence', () => {
    it('all 19 methods live on World.prototype', () => {
        const missing = WORLD.filter((m) => typeof World.prototype[m] !== 'function');
        expect(missing).toEqual([]);
        expect(WORLD).toHaveLength(19);
    });

    it('constructs and getTile works', () => {
        const w = new World(12, 8);
        expect(w.width).toBe(12);
        expect(typeof w.getTile).toBe('function');
        expect(typeof w.advanceDay).toBe('function');
    });
});

describe('AudioManager split — structural equivalence', () => {
    it('sampled methods live on AudioManager.prototype', () => {
        const missing = AUDIO.filter((m) => typeof AudioManager.prototype[m] !== 'function');
        expect(missing).toEqual([]);
    });

    it('the audioManager singleton is a fully-assembled instance', () => {
        expect(audioManager).toBeInstanceOf(AudioManager);
        for (const m of AUDIO) expect(typeof audioManager[m], m).toBe('function');
    });
});
