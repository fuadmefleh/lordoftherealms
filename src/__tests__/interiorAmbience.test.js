// The sound of the room you are in (ui/innerMapInteriorSound.js, systems/audio/interior.js)
// and the fade / door wipe in and out of places (ui/screenTransition.js).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InnerMap } from '../world/innerMap.js';
import { audioManager } from '../systems/audio.js';
import {
    interiorAmbienceSpec, interiorSoundKind, tavernBusyAt, nearestFire, smithAtWork, sameAmbience, InteriorAmbience,
} from '../ui/innerMapInteriorSound.js';
import { ScreenTransition, sceneKey, transitionKind, TRANSITION_MS } from '../ui/screenTransition.js';

const folk = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: i, type: 'commoner', state: 'idle', ...extra }));
const room = (w, h, furn = []) => {
    const tiles = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ subTerrain: { passable: true } })));
    for (const f of furn) tiles[f.r][f.q]._furniture = { type: f.type, name: f.name || f.type };
    return tiles;
};

describe('choosing the room\'s ambience', () => {
    it('knows a room by its building', () => {
        expect(interiorSoundKind({ type: 'tavern' })).toBe('tavern');
        expect(interiorSoundKind({ type: 'inn' })).toBe('tavern');
        expect(interiorSoundKind({ type: 'roadhouse' })).toBe('tavern');
        expect(interiorSoundKind({ type: 'chapel' })).toBe('church');
        expect(interiorSoundKind({ type: 'blacksmith' })).toBe('smithy');
        expect(interiorSoundKind({ type: 'player_manor' })).toBe('hall');
        expect(interiorSoundKind({ type: 'jail' })).toBe('cell');
        expect(interiorSoundKind({ type: 'mine', _underground: true })).toBe('cave');
        expect(interiorSoundKind({ type: 'house' })).toBe('house');
        expect(interiorSoundKind({ type: 'stable' })).toBe('house');
        expect(interiorSoundKind(null)).toBe(null);
        expect(interiorAmbienceSpec({ building: null })).toBe(null);
    });

    it('a tavern talks louder in the evening and the fuller it is; empty, it is quiet', () => {
        expect(tavernBusyAt(20)).toBeGreaterThan(tavernBusyAt(9));
        expect(tavernBusyAt(4)).toBeLessThan(tavernBusyAt(9));
        const at = (hour, n) => interiorAmbienceSpec({ building: { type: 'tavern' }, npcs: folk(n), tiles: room(8, 6), hour });
        expect(at(20, 6).layers.chatter).toBeGreaterThan(at(9, 6).layers.chatter);
        expect(at(20, 8).layers.chatter).toBeGreaterThan(at(20, 2).layers.chatter);
        expect(at(20, 0).layers.chatter).toBe(0);
        expect(at(20, 0).layers.room).toBeGreaterThan(0);
        // the crowd joins in only when the room is full
        expect(at(20, 2).layers.crowd).toBe(0);
        expect(at(20, 10).layers.crowd).toBeGreaterThan(0);
        // the dead and the knocked-down don't talk
        expect(interiorAmbienceSpec({ building: { type: 'tavern' }, npcs: folk(6, { dead: true }), hour: 20 }).layers.chatter).toBe(0);
        expect(at(20, 6).duck).toBe(true);
    });

    it('a fire crackles where the room has a hearth or an oven, louder the nearer you stand', () => {
        const tiles = room(12, 8, [{ q: 5, r: 1, type: 'fireplace', name: 'Hearth' }]);
        expect(nearestFire(tiles, 5, 6).dist).toBe(5);
        const near = interiorAmbienceSpec({ building: { type: 'house' }, npcs: [], tiles, hour: 20, playerQ: 5, playerR: 2 });
        const far = interiorAmbienceSpec({ building: { type: 'house' }, npcs: [], tiles, hour: 20, playerQ: 11, playerR: 7 });
        expect(near.layers.fire).toBeGreaterThan(far.layers.fire);
        expect(far.layers.fire).toBeGreaterThan(0);
        expect(interiorAmbienceSpec({ building: { type: 'house' }, npcs: [], tiles: room(8, 6), hour: 20 }).layers.fire).toBe(0);
        const oven = interiorAmbienceSpec({ building: { type: 'bakery' }, npcs: [], tiles: room(8, 6, [{ q: 1, r: 1, type: 'oven' }]), hour: 6, playerQ: 2, playerR: 3 });
        expect(oven.kind).toBe('bakery');
        expect(oven.layers.fire).toBeGreaterThan(0);
    });

    it('the smithy roars while the smith is at work, and is banked after hours', () => {
        const smith = [{ type: 'blacksmith_npc', state: 'idle', _scene: { phase: 'at' } }];
        const tiles = room(10, 7, [{ q: 4, r: 1, type: 'forge' }]);
        expect(smithAtWork(smith, 10)).toBe(true);
        expect(smithAtWork(smith, 22)).toBe(false);
        expect(smithAtWork([{ type: 'blacksmith_npc', state: 'idle' }], 10)).toBe(false);
        const day = interiorAmbienceSpec({ building: { type: 'blacksmith' }, npcs: smith, tiles, hour: 10, playerQ: 5, playerR: 5 });
        const night = interiorAmbienceSpec({ building: { type: 'blacksmith' }, npcs: smith, tiles, hour: 22, playerQ: 5, playerR: 5 });
        expect(day.layers.forge).toBeGreaterThan(0);
        expect(day.layers.fire).toBeGreaterThan(night.layers.fire);
        expect(night.layers.forge).toBe(0);
    });

    it('a church hums under its vault and echoes; a house is only its quiet', () => {
        const ch = interiorAmbienceSpec({ building: { type: 'church' }, npcs: folk(1), hour: 11 });
        expect(ch.layers.hum).toBeGreaterThan(0);
        expect(ch.echo).toBeGreaterThan(0.5);
        expect(ch.layers.chatter).toBe(0);
        const house = interiorAmbienceSpec({ building: { type: 'house' }, npcs: [], hour: 11 });
        expect(house.layers.room).toBe(1);
        expect(house.layers.chatter + house.layers.hum + house.layers.forge + house.layers.crowd).toBe(0);
        expect(house.echo).toBe(0);
        const cave = interiorAmbienceSpec({ building: { type: 'mine', _underground: true }, npcs: [], hour: 11 });
        expect(cave.layers.drip).toBeGreaterThan(0);
        expect(sameAmbience(house, interiorAmbienceSpec({ building: { type: 'house' }, npcs: [], hour: 15 }))).toBe(true);
        expect(sameAmbience(house, ch)).toBe(false);
    });
});

describe('starting and stopping it with the player', () => {
    let keep, calls, fakeAudio, now;
    beforeEach(() => {
        keep = {
            active: InnerMap.active, inside: InnerMap._insideBuilding, npcs: InnerMap.npcs, tiles: InnerMap.tiles,
            tod: InnerMap.timeOfDay, floor: InnerMap._floor, pq: InnerMap.playerInnerQ, pr: InnerMap.playerInnerR, audio: InteriorAmbience.audio,
        };
        calls = [];
        fakeAudio = { ready: true, ticks: 0,
            setInteriorAmbience(spec) { if (!this.ready) return false; calls.push(spec); return true; },
            interiorTick() { this.ticks++; } };
        InteriorAmbience.audio = fakeAudio;
        InteriorAmbience._applied = null; InteriorAmbience._key = null; InteriorAmbience._acc = 0;
        InnerMap.active = true;
        InnerMap._insideBuilding = null;
        InnerMap.npcs = folk(7);
        InnerMap.tiles = room(10, 8, [{ q: 4, r: 1, type: 'fireplace' }]);
        InnerMap.timeOfDay = 20;
        InnerMap._floor = 0;
        InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 6;
        now = 1000;
    });
    afterEach(() => {
        InteriorAmbience._stopWatch();
        InteriorAmbience._applied = null; InteriorAmbience._key = null;
        InteriorAmbience.audio = keep.audio;
        InnerMap.active = keep.active; InnerMap._insideBuilding = keep.inside; InnerMap.npcs = keep.npcs; InnerMap.tiles = keep.tiles;
        InnerMap.timeOfDay = keep.tod; InnerMap._floor = keep.floor; InnerMap.playerInnerQ = keep.pq; InnerMap.playerInnerR = keep.pr;
    });

    it('starts on entering, keeps quiet while nothing changes, stops on stepping out', () => {
        const game = { timeSpeed: 1 };
        InteriorAmbience.update(game, 0.016);
        expect(calls).toHaveLength(0);                      // on the street: nothing
        InnerMap._insideBuilding = { type: 'tavern', q: 3, r: 4 };
        InteriorAmbience.update(game, 0.016);
        expect(calls).toHaveLength(1);
        expect(calls[0].kind).toBe('tavern');
        expect(calls[0].layers.chatter).toBeGreaterThan(0);
        expect(calls[0].layers.fire).toBeGreaterThan(0);
        expect(fakeAudio.ticks).toBe(1);
        for (let i = 0; i < 60; i++) InteriorAmbience.update(game, 0.016);
        expect(calls).toHaveLength(1);                      // the same room: not re-sent
        // the room empties out: the murmur goes
        InnerMap.npcs = [];
        InteriorAmbience.update(game, 0.6);
        expect(calls).toHaveLength(2);
        expect(calls[1].layers.chatter).toBe(0);
        InnerMap._insideBuilding = null;
        InteriorAmbience.update(game, 0.016);
        expect(calls[calls.length - 1]).toBe(null);
        expect(InteriorAmbience._applied).toBe(null);
    });

    it('stops on leaving the town, on pausing, in the settings; resumes after', () => {
        const game = { timeSpeed: 1 };
        InnerMap._insideBuilding = { type: 'church', q: 1, r: 1 };
        InteriorAmbience.update(game, 0.016);
        expect(calls.at(-1).kind).toBe('church');
        game.timeSpeed = 0;
        InteriorAmbience.update(game, 0.016);
        expect(calls.at(-1)).toBe(null);
        game.timeSpeed = 1;
        InteriorAmbience.update(game, 0.016);
        expect(calls.at(-1).kind).toBe('church');
        InnerMap.active = false;                            // off the street map, back to the world
        InteriorAmbience.update(game, 0.016);
        expect(calls.at(-1)).toBe(null);
        const n = calls.length;
        InteriorAmbience.update(game, 0.016);
        expect(calls).toHaveLength(n);                      // silent stays silent, unasked
    });

    it('falls silent when the game loop stops calling; asks again while there is no audio yet', () => {
        const game = { timeSpeed: 1 };
        fakeAudio.ready = false;
        InnerMap._insideBuilding = { type: 'house', q: 2, r: 2 };
        InteriorAmbience.update(game, 0.016);
        expect(calls).toHaveLength(0);
        expect(InteriorAmbience._applied).toBe(null);
        fakeAudio.ready = true;
        InteriorAmbience.update(game, 0.016);
        expect(calls).toHaveLength(1);
        InteriorAmbience._watchdog(InteriorAmbience._lastUpdate + 100);
        expect(InteriorAmbience._applied).not.toBe(null);
        InteriorAmbience._watchdog(InteriorAmbience._lastUpdate + 5000);
        expect(calls.at(-1)).toBe(null);
        expect(InteriorAmbience._watch).toBe(null);
    });
});

describe('the audio side (systems/audio/interior.js)', () => {
    function fakeCtx() {
        const log = { started: 0, stopped: 0, targets: [], connects: 0 };
        const param = (v = 0) => ({ value: v, setTargetAtTime: (t) => log.targets.push(t), setValueAtTime() {}, exponentialRampToValueAtTime() {} });
        const node = () => ({ connect: () => log.connects++, disconnect() {}, gain: param(1), frequency: param(0), Q: param(1), delayTime: param(0), type: '' });
        const ctx = {
            currentTime: 1, sampleRate: 4000,
            createBuffer: (ch, n) => { const d = new Float32Array(n); return { getChannelData: () => d }; },
            createBufferSource: () => ({ connect: () => log.connects++, start: () => log.started++, stop: () => log.stopped++, loop: false, playbackRate: param(1) }),
            createOscillator: () => ({ connect: () => log.connects++, start: () => log.started++, stop: () => log.stopped++, frequency: param(0), type: '' }),
            createBiquadFilter: node, createGain: node, createDelay: node,
        };
        return { ctx, log };
    }
    let keep;
    beforeEach(() => {
        keep = { ctx: audioManager.ctx, master: audioManager.masterGain, music: audioManager.musicGain, amb: audioManager.ambienceGain, I: audioManager._interior, duck: audioManager._indoorDuck };
    });
    afterEach(() => {
        audioManager._interior = keep.I; audioManager._indoorDuck = keep.duck;
        audioManager.ctx = keep.ctx; audioManager.masterGain = keep.master; audioManager.musicGain = keep.music; audioManager.ambienceGain = keep.amb;
    });

    it('builds the layers asked for, ducks the street, and stops it all cleanly; never throws', () => {
        audioManager.ctx = null; audioManager._interior = null; audioManager._indoorDuck = false;
        const spec = interiorAmbienceSpec({ building: { type: 'tavern' }, npcs: folk(10), tiles: room(8, 6, [{ q: 1, r: 1, type: 'fireplace' }]), hour: 20, playerQ: 2, playerR: 3 });
        expect(audioManager.setInteriorAmbience(spec)).toBe(false);   // no audio yet: ask again
        expect(audioManager.setInteriorAmbience(null)).toBe(true);
        const { ctx, log } = fakeCtx();
        const musicTargets = [];
        audioManager.ctx = ctx;
        audioManager.masterGain = ctx.createGain();
        audioManager.ambienceGain = ctx.createGain();
        audioManager.musicGain = { connect() {}, gain: { setTargetAtTime: (v) => musicTargets.push(v), setValueAtTime: (v) => musicTargets.push(v) } };
        expect(audioManager.setInteriorAmbience(spec)).toBe(true);
        expect(audioManager.interiorAmbienceActive()).toBe(true);
        const layers = Object.keys(audioManager._interior.layers).sort();
        expect(layers).toEqual(['chatter', 'crowd', 'fire', 'room']);
        expect(log.started).toBeGreaterThan(0);
        expect(musicTargets.at(-1)).toBeLessThan(audioManager.musicVolume);          // the street's music ducked
        // a volume change keeps the duck
        audioManager.setMusicVolume(audioManager.musicVolume);
        expect(musicTargets.at(-1)).toBeLessThan(audioManager.musicVolume);
        // the one-shots run without throwing
        for (let i = 0; i < 50; i++) audioManager.interiorTick(0.2);
        const stoppedBefore = log.stopped;
        expect(audioManager.setInteriorAmbience(null)).toBe(true);
        expect(audioManager.interiorAmbienceActive()).toBe(false);
        expect(audioManager._interior).toBe(null);
        expect(log.stopped).toBeGreaterThan(stoppedBefore);                          // the loops are stopped
        expect(musicTargets.at(-1)).toBeCloseTo(audioManager.musicVolume);           // and the street back up
        // a broken context: best-effort
        audioManager.ctx = { currentTime: 0, createBufferSource() { throw new Error('closed'); } };
        expect(() => audioManager.setInteriorAmbience(spec)).not.toThrow();
        expect(() => audioManager.interiorTick(0.1)).not.toThrow();
    });
});

describe('screen transitions (ui/screenTransition.js)', () => {
    let keep;
    beforeEach(() => {
        keep = { enabled: ScreenTransition.enabled, reduced: ScreenTransition.reducedMotion };
        ScreenTransition.configure({ enabled: true, reducedMotion: false });
        ScreenTransition._key = null;
        ScreenTransition._end();
    });
    afterEach(() => {
        ScreenTransition.enabled = keep.enabled; ScreenTransition.reducedMotion = keep.reduced;
        ScreenTransition._key = null; ScreenTransition._end();
    });

    const M = (over = {}) => ({ active: true, currentWorldTile: { q: 4, r: 7 }, _insideBuilding: null, _floor: 0, ...over });

    it('knows the places and what passing between them looks like', () => {
        expect(sceneKey({ active: false })).toBe('world');
        expect(sceneKey(M())).toBe('street:4,7');
        expect(sceneKey(M({ _insideBuilding: { type: 'inn', q: 2, r: 3 }, _floor: 1 }))).toBe('in:inn@2,3#1');
        expect(transitionKind('street:4,7', 'in:inn@2,3#0')).toBe('door');
        expect(transitionKind('in:inn@2,3#0', 'street:4,7')).toBe('fade');
        expect(transitionKind('world', 'street:4,7')).toBe('fade');
        expect(transitionKind('street:4,7', 'world')).toBe('fade');
        expect(transitionKind('in:inn@2,3#0', 'in:inn@2,3#1')).toBe('stairs');
        expect(transitionKind('street:4,7', 'street:5,7')).toBe(null);
        expect(transitionKind('world', 'world')).toBe(null);
    });

    it('plays through and ends within its time; never holds input', () => {
        const game = {};
        ScreenTransition.update(game, M(), 0.016);          // (the first frame only learns where it is)
        expect(ScreenTransition.active).toBe(false);
        ScreenTransition.update(game, M({ _insideBuilding: { type: 'inn', q: 2, r: 3 } }), 0.016);
        expect(ScreenTransition.active).toBe(true);
        expect(ScreenTransition._kind).toBe('door');
        expect(ScreenTransition.progress()).toBe(0);        // its first frame fully covered
        expect(ScreenTransition.blocksInput()).toBe(false);
        let frames = 0;
        while (ScreenTransition.active && frames < 100) {
            ScreenTransition.update(game, M({ _insideBuilding: { type: 'inn', q: 2, r: 3 } }), 0.016);
            expect(ScreenTransition.blocksInput()).toBe(false);
            frames++;
        }
        expect(ScreenTransition.active).toBe(false);
        expect(frames * 16).toBeLessThanOrEqual(TRANSITION_MS.door + 32);
        // out again: a fade
        ScreenTransition.update(game, M(), 0.016);
        expect(ScreenTransition._kind).toBe('fade');
        // a long hitch (the next map built) ends it, never strands it
        ScreenTransition.update(game, M(), 0.1);
        ScreenTransition.update(game, M(), 5);
        expect(ScreenTransition.active).toBe(false);
    });

    it('draws over the canvas: covered at the start, clear at the end', () => {
        const fills = [];
        const ctx = { save() {}, restore() {}, setTransform() {}, fillRect: (x, y, w, h) => fills.push({ x, y, w, h, style: ctx.fillStyle }), fillStyle: '', globalAlpha: 1 };
        const canvas = { width: 800, height: 600 };
        ScreenTransition.draw(ctx, canvas);
        expect(fills).toHaveLength(0);                      // nothing playing: nothing drawn
        ScreenTransition.start('fade');
        ScreenTransition.draw(ctx, canvas);
        expect(fills[0]).toMatchObject({ x: 0, y: 0, w: 800, h: 600 });
        expect(fills[0].style).toContain(',1.000)');
        ScreenTransition.start('door');
        fills.length = 0;
        ScreenTransition.draw(ctx, canvas);
        expect(fills[0].w + fills[1].w).toBeGreaterThanOrEqual(800);   // the two leaves shut
    });

    it('is off when the setting is off; reduced motion makes the door a fade; no fade at a hex edge', () => {
        const game = {};
        ScreenTransition.configure({ enabled: false });
        ScreenTransition.update(game, M(), 0.016);
        ScreenTransition.update(game, M({ _insideBuilding: { type: 'inn', q: 2, r: 3 } }), 0.016);
        expect(ScreenTransition.active).toBe(false);
        ScreenTransition.configure({ enabled: true, reducedMotion: true });
        ScreenTransition.update(game, M(), 0.016);
        ScreenTransition.update(game, M({ _insideBuilding: { type: 'inn', q: 2, r: 3 } }), 0.016);
        expect(ScreenTransition._kind).toBe('fade');
        ScreenTransition._end();
        // crossing a street map's edge: off one map and onto the next, unfaded
        ScreenTransition.configure({ reducedMotion: false });
        ScreenTransition.update(game, M(), 0.016);          // (back out on the street)
        ScreenTransition._end();
        const crossing = { _crossingEdge: true };
        ScreenTransition.update(crossing, { active: false }, 0.016);
        ScreenTransition.update(crossing, M({ currentWorldTile: { q: 5, r: 7 } }), 0.016);
        ScreenTransition.update(game, M({ currentWorldTile: { q: 5, r: 7 } }), 0.016);
        expect(ScreenTransition.active).toBe(false);
    });
});
