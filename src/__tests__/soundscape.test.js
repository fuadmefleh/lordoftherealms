// Recorded sound: the bank and loader (systems/audio/samples.js), the ambience beds
// (systems/audio/beds.js), the music's moods (systems/audio/music.js), and the soundscape
// that chooses them by place, hour, season and weather (ui/soundscape.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { InnerMap } from '../world/innerMap.js';
import { audioManager } from '../systems/audio.js';
import { SAMPLE_BANK, SFX_SAMPLES, CORE_SAMPLES, distanceGain, decodeRateFor, BED_RATE, BED_RATE_HISS } from '../systems/audio/samples.js';
import { rainBedLevels } from '../systems/audio/beds.js';
import { MUSIC_TRACKS, MUSIC_REST, moodOfScene } from '../systems/audio/music.js';
import { recordedRoomBeds } from '../systems/audio/interior.js';
import { soundscapeSpec, stepSurface, hoofStep, daylight, nearness, streetBusyAt, Soundscape } from '../ui/soundscape.js';
import { townWorldSounds, TownWorldSound } from '../ui/townWorldSound.js';
import { interiorAmbienceSpec } from '../ui/innerMapInteriorSound.js';

const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(ROOT, 'assets', 'audio');

describe('the files', () => {
    it('every sound and track in the bank is on disk, and credited', () => {
        const credits = fs.readFileSync(path.join(AUDIO, 'CREDITS.md'), 'utf8');
        const files = new Set();
        for (const def of Object.values(SAMPLE_BANK)) for (const f of def.files) files.add(f);
        for (const list of Object.values(MUSIC_TRACKS)) for (const f of list) files.add(f);
        let bytes = 0;
        for (const f of files) {
            const p = path.join(AUDIO, f);
            expect(fs.existsSync(p), f).toBe(true);
            bytes += fs.statSync(p).size;
            // credited by name (a numbered set by its stem: step_wood_1..6)
            const base = path.basename(f, '.ogg');
            const stem = base.replace(/_\d+$/, '');
            expect(credits.includes(base) || credits.includes(stem + '_'), `${f} in CREDITS.md`).toBe(true);
        }
        expect(bytes).toBeLessThan(25 * 1024 * 1024);
        // the beds are made at the rate they're decoded at, mono (assets/audio/CREDITS.md)
        for (const [key, def] of Object.entries(SAMPLE_BANK)) {
            if (!def.loop) continue;
            const buf = fs.readFileSync(path.join(AUDIO, def.files[0]));
            const i = buf.indexOf(Buffer.from('\x01vorbis', 'latin1'));
            expect(buf[i + 11], `${key} mono`).toBe(1);
            expect(buf.readUInt32LE(i + 12), `${key} rate`).toBe(decodeRateFor(key));
        }
        // nothing on disk the game doesn't know about
        for (const dir of ['music', 'amb', 'sfx']) {
            for (const f of fs.readdirSync(path.join(AUDIO, dir))) expect(files.has(`${dir}/${f}`), `${dir}/${f} unused`).toBe(true);
        }
    });

    it('every playSFX kind a recording plays names a bank key; the core set is in the bank', () => {
        for (const [kind, key] of Object.entries(SFX_SAMPLES)) expect(SAMPLE_BANK[key], kind).toBeTruthy();
        for (const k of CORE_SAMPLES) expect(SAMPLE_BANK[k], k).toBeTruthy();
        for (const mood of Object.keys(MUSIC_TRACKS)) expect(MUSIC_REST[mood], mood).toBeTruthy();
    });
});

describe('decoding the beds small', () => {
    it('loops decode at a low rate (the hiss a little higher); one-shots at the device\'s', () => {
        expect(decodeRateFor('bed_tavern')).toBe(BED_RATE);
        expect(decodeRateFor('bed_rain_light')).toBe(BED_RATE_HISS);
        expect(decodeRateFor('step_grass')).toBe(null);
        expect(decodeRateFor('nope')).toBe(null);
    });

    it('a loop goes to a decoder at its rate when the context runs faster; else the live context', () => {
        const made = [];
        const was = globalThis.OfflineAudioContext;
        globalThis.OfflineAudioContext = function (ch, len, rate) { made.push(rate); this.sampleRate = rate; this.decodeAudioData = () => Promise.resolve(null); };
        const A = Object.create(Object.getPrototypeOf(audioManager));
        try {
            A.ctx = { sampleRate: 48000 };
            const d = A._decodeCtx(22050);
            expect(d && d.sampleRate).toBe(22050);
            expect(A._decodeCtx(22050)).toBe(d);          // (one each rate, kept)
            expect(A._decodeCtx(null)).toBe(null);
            A.ctx = { sampleRate: 22050 };                 // (a slow device: decode as it is)
            expect(A._decodeCtx(32000)).toBe(null);
            expect(made).toEqual([22050]);
        } finally {
            globalThis.OfflineAudioContext = was;
        }
    });
});

describe('choosing what is heard (pure)', () => {
    const street = (o = {}) => ({ mode: 'street', season: 'Summer', terrain: 'grassland', hour: 12, weather: {}, ...o });

    it('the day and the night', () => {
        expect(daylight(12)).toBe(1);
        expect(daylight(1)).toBe(0);
        expect(daylight(5)).toBeCloseTo(0.5);
        expect(daylight(20)).toBeCloseTo(0.5);
        expect(daylight(null)).toBe(1);   // the world map: no hour
        const noon = soundscapeSpec(street());
        expect(noon.beds.day_birds).toBeGreaterThan(0.5);
        expect(noon.beds.night_crickets || 0).toBe(0);
        expect(noon.mood).toBe('explore');
        const night = soundscapeSpec(street({ hour: 23 }));
        expect(night.beds.day_birds || 0).toBe(0);
        expect(night.beds.night_crickets).toBeGreaterThan(0.5);
        expect(night.events.owl).toBeGreaterThan(0);
        expect(night.mood).toBe('night');
    });

    it('the season: birds thin out and the crickets stop in winter; the wind rises', () => {
        const spring = soundscapeSpec(street({ season: 'Spring' }));
        const winter = soundscapeSpec(street({ season: 'Winter' }));
        expect(winter.beds.day_birds).toBeLessThan(spring.beds.day_birds);
        expect(soundscapeSpec(street({ season: 'Winter', hour: 23 })).beds.night_crickets || 0).toBe(0);
        expect(winter.beds.wind).toBeGreaterThan(spring.beds.wind);
    });

    it('the place: a forest, the heights, the shore, the sea', () => {
        const forest = soundscapeSpec(street({ terrain: 'seasonal_forest' }));
        expect(forest.beds.forest).toBeGreaterThan(0.5);
        expect(forest.beds.day_birds || 0).toBe(0);
        const hills = soundscapeSpec(street({ terrain: 'mountain' }));
        expect(hills.beds.wind).toBeGreaterThan(soundscapeSpec(street()).beds.wind);
        const shore = soundscapeSpec(street({ coast: 1 }));
        expect(shore.beds.surf).toBeGreaterThan(0.5);
        expect(shore.events.wave).toBeGreaterThan(0);
        expect(soundscapeSpec(street({ river: 1 })).beds.surf).toBeGreaterThan(0.3);
        const sea = soundscapeSpec({ mode: 'world', terrain: 'ocean', atSea: true, weather: {} });
        expect(sea.beds.sea).toBe(1);
        expect(sea.events.creak).toBeGreaterThan(0);
        expect(sea.beds.day_birds || 0).toBe(0);
    });

    it('the weather: rain hushes the birds, a gale blows', () => {
        const wet = soundscapeSpec(street({ weather: { rain: 1 } }));
        expect(wet.beds.day_birds).toBeLessThan(soundscapeSpec(street()).beds.day_birds);
        const gale = soundscapeSpec(street({ weather: { wind: 1, storm: true } }));
        expect(gale.beds.wind).toBe(1);
        expect(gale.beds.wind_gust).toBeGreaterThan(0.3);
        // the rain's own beds: light in a drizzle, heavy in a downpour
        expect(rainBedLevels(0)).toEqual({ rain_light: 0, rain_heavy: 0 });
        expect(rainBedLevels(0.2).rain_light).toBeGreaterThan(0);
        expect(rainBedLevels(0.2).rain_heavy).toBe(0);
        expect(rainBedLevels(1).rain_heavy).toBe(1);
    });

    it('the town: the street\'s murmur by day, the market near the stalls, a tavern at its door, the forge', () => {
        const near = { market: 3, tavern: 2, smithy: 4, church: null };
        const town = soundscapeSpec(street({ town: true, crowd: 12, near }));
        expect(town.mood).toBe('town');
        expect(town.beds.town_street).toBeGreaterThan(0.3);
        expect(town.beds.market).toBeGreaterThan(0.5);
        expect(town.events.anvil).toBeGreaterThan(0);
        expect(soundscapeSpec(street({ town: true, hour: 3, near })).beds.market || 0).toBe(0);   // the market is shut
        expect(soundscapeSpec(street({ town: true, near: { market: 40 } })).beds.market || 0).toBe(0);  // too far off
        const evening = soundscapeSpec(street({ town: true, hour: 20, near }));
        expect(evening.beds.tavern).toBeGreaterThan(soundscapeSpec(street({ town: true, hour: 9, near })).beds.tavern || 0);
        expect(streetBusyAt(3)).toBeLessThan(streetBusyAt(12));
        expect(nearness(null, 1, 5)).toBe(0);
        expect(nearness(0, 1, 5)).toBe(1);
        expect(nearness(3, 1, 5)).toBeGreaterThan(0);
    });

    it('indoors the street is muffled; a castle is the court; a fight is a battle', () => {
        const inside = soundscapeSpec(street({ town: true, inside: 'house' }));
        expect(inside.muffle).toBeGreaterThan(0.5);
        expect(inside.beds.town_street).toBeLessThan(soundscapeSpec(street({ town: true })).beds.town_street);
        expect(soundscapeSpec(street({ town: true, inside: 'hall', court: true })).mood).toBe('court');
        expect(soundscapeSpec(street({ combat: true, court: true })).mood).toBe('battle');
        expect(soundscapeSpec(street({ inside: 'tavern', hour: 23 })).mood).toBe('town');
        expect(moodOfScene('combat')).toBe('battle');
        expect(moodOfScene('ocean')).toBe('explore');
        expect(moodOfScene('title')).toBe('title');
    });

    it('the world map keeps the day clock: night beds and the night music out there too', () => {
        const world = (o = {}) => ({ mode: 'world', season: 'Summer', terrain: 'grassland', weather: {}, ...o });
        expect(soundscapeSpec(world()).beds.day_birds).toBeGreaterThan(0.5);   // (no hour known: day)
        const night = soundscapeSpec(world({ hour: 23 }));
        expect(night.beds.night_crickets).toBeGreaterThan(0.5);
        expect(night.beds.day_birds || 0).toBe(0);
        expect(night.events.owl).toBeGreaterThan(0);
        expect(night.mood).toBe('night');
        expect(soundscapeSpec(world({ hour: 23, town: true })).mood).toBe('night');
        expect(soundscapeSpec(world({ hour: 12, town: true })).mood).toBe('town');
    });

    it('the street\'s things: a rolling cart, the stables, the choir at a service', () => {
        const cart = soundscapeSpec(street({ town: true, carts: [2] }));
        expect(cart.beds.cart).toBeGreaterThan(0.5);
        expect(soundscapeSpec(street({ town: true, carts: [30] })).beds.cart || 0).toBe(0);
        const stable = soundscapeSpec(street({ town: true, near: { stable: 3 } }));
        expect(stable.events.snort).toBeGreaterThan(0);
        expect(soundscapeSpec(street({ town: true, inside: 'house', near: { stable: 3 } })).events.snort).toBe(0);
        expect(soundscapeSpec(street({ riding: true })).events.snort).toBeGreaterThan(0);
        const sung = soundscapeSpec(street({ town: true, service: true, near: { church: 4 } }));
        expect(sung.beds.choir).toBeGreaterThan(0.2);
        expect(sung.beds.choir).toBeLessThan(0.5);   // (through the walls)
        expect(soundscapeSpec(street({ town: true, near: { church: 4 } })).beds.choir || 0).toBe(0);
    });

    it('hoofbeats: a walk, a trot doubled, dulled on soft ground; none on foot', () => {
        expect(hoofStep({ speed: 0 })).toBe(null);
        const walk = hoofStep({ speed: 1.6, surface: 'stone' });
        expect(walk.double).toBe(false);
        expect(walk.lowpass).toBe(0);
        const trot = hoofStep({ speed: 1.6, run: true, surface: 'stone' });
        expect(trot.double).toBe(true);
        expect(trot.rate).toBeGreaterThan(walk.rate);
        expect(trot.gain).toBeGreaterThan(walk.gain);
        const grass = hoofStep({ speed: 1.6, surface: 'grass' });
        expect(grass.gain).toBeLessThan(walk.gain);
        expect(grass.lowpass).toBeGreaterThan(0);
    });

    it('a church at a service has the choir, the hum under it; none between services', () => {
        const b = { type: 'church', q: 0, r: 0 };
        const npcs = [{}, {}, {}, {}];
        const sung = interiorAmbienceSpec({ building: b, npcs, hour: 9, service: true });
        expect(sung.layers.choir).toBeGreaterThan(0.5);
        const quiet = interiorAmbienceSpec({ building: b, npcs, hour: 9 });
        expect(quiet.layers.choir).toBe(0);
        expect(sung.layers.hum).toBeLessThan(quiet.layers.hum);
        const rec = recordedRoomBeds(sung);
        expect(rec.beds.choir).toBeGreaterThan(0.5);
        expect(recordedRoomBeds(quiet).beds.choir || 0).toBe(0);
    });

    it('the town world\'s figures: the drill, the preacher, the camp, the crier', () => {
        const figs = [
            { kind: 'soldier', activity: { type: 'drill' }, q: 10, r: 10 },
            { kind: 'soldier', activity: { type: 'drill' }, q: 12, r: 10 },
            { kind: 'preacher', activity: { type: 'preach', label: 'Calling for the cross' }, q: 4, r: 4 },
            { kind: 'muster', activity: { type: 'camp' }, q: 40, r: 40 },
        ];
        const S = townWorldSounds(figs, { q: 41, r: 41 }, [{ q: 1, r: 1, crying: true }, { q: 2, r: 2, crying: false }]);
        expect(S.drill).toEqual({ q: 11, r: 10 });
        expect(S.preacher).toEqual({ q: 4, r: 4 });
        expect(S.camp).toEqual({ q: 41, r: 41 });
        expect(S.criers).toEqual([{ q: 1, r: 1 }]);
        const off = townWorldSounds([
            { kind: 'soldier', activity: { type: 'billet' }, q: 1, r: 1 },
            { kind: 'preacher', activity: { type: 'preach', label: 'At prayer' }, q: 4, r: 4 },
        ], { q: 41, r: 41 }, []);
        expect(off.drill).toBe(null);
        expect(off.preacher).toBe(null);
        expect(off.camp).toBe(null);     // (no host about the camp)
    });

    it('other systems can put a place-bound bed in', () => {
        const s = soundscapeSpec(street({ sources: [{ bed: 'market', level: 0.7 }] }));
        expect(s.beds.market).toBeCloseTo(0.7);
    });

    it('the room\'s recording, by its spec', () => {
        expect(recordedRoomBeds({ kind: 'tavern', layers: { chatter: 0.6, crowd: 0.8 } }).beds).toEqual({ tavern: 0.8 });
        expect(recordedRoomBeds({ kind: 'tavern', layers: { chatter: 0.6 } }).replaces).toContain('chatter');
        expect(recordedRoomBeds({ kind: 'cave', layers: { drip: 1 } }).beds.dungeon).toBeGreaterThan(0.5);
        expect(recordedRoomBeds({ kind: 'smithy', layers: {} }).beds).toEqual({});
        expect(recordedRoomBeds(null).beds).toEqual({});
    });

    it('the ground underfoot', () => {
        expect(stepSurface({ ground: 'street' })).toBe('stone');
        expect(stepSurface({ ground: 'road' })).toBe('dirt');
        expect(stepSurface({ ground: 'road', mud: 0.6 })).toBe('mud');
        expect(stepSurface({ ground: 'soft', mud: 0.5 })).toBe('mud');
        expect(stepSurface({ ground: 'open', sub: 'grass' })).toBe('grass');
        expect(stepSurface({ ground: 'open', sub: 'trees' })).toBe('leaves');
        expect(stepSurface({ ground: 'open', sub: 'grass', snow: 0.5 })).toBe('snow');
        expect(stepSurface({ ground: 'open', cold: true })).toBe('snow');
        expect(stepSurface({ ground: 'street', snow: 0.3 })).toBe('stone');   // the cleared streets
        expect(stepSurface({ ground: 'water' })).toBe('water');
        expect(stepSurface({ ground: 'ice' })).toBe('stone');
        expect(stepSurface({ inside: 'house' })).toBe('wood');
        expect(stepSurface({ inside: 'church' })).toBe('stone');
        expect(stepSurface({ riding: true })).toBe(null);
        expect(stepSurface({ rowing: true })).toBe(null);
        expect(stepSurface({ swimming: true })).toBe('water');
    });

    it('a sound with a place is as loud as it is near', () => {
        expect(distanceGain(0)).toBe(1);
        expect(distanceGain(8)).toBeGreaterThan(0);
        expect(distanceGain(8)).toBeLessThan(1);
        expect(distanceGain(30)).toBe(0);
    });
});

// A context good enough to decode and play (every node a stub that records what it's asked)
function fakeCtx() {
    const log = { started: [], stopped: 0, decoded: 0, targets: [] };
    const param = (v = 0) => ({ value: v, setTargetAtTime: (t) => log.targets.push(t), setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const node = () => ({ connect() {}, disconnect() {}, gain: param(1), frequency: param(0), Q: param(1), pan: param(0), delayTime: param(0), type: '' });
    const ctx = {
        currentTime: 0, sampleRate: 8000, state: 'running', destination: node(),
        createGain: node, createBiquadFilter: node, createStereoPanner: node, createDelay: node,
        createBuffer: (ch, n) => { const d = new Float32Array(n); return { getChannelData: () => d, length: n, numberOfChannels: ch, duration: n / 8000 }; },
        createBufferSource: () => {
            const s = { buffer: null, loop: false, playbackRate: param(1), connect() {}, disconnect() {}, stop: () => log.stopped++ };
            s.start = () => log.started.push(s);
            return s;
        },
        createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: param(0), type: '' }),
        decodeAudioData: (ab) => { log.decoded++; return Promise.resolve({ length: 800, numberOfChannels: 1, duration: 3, bytes: ab.byteLength }); },
        resume() { return Promise.resolve(); },
    };
    return { ctx, log };
}

describe('the loader and the beds (systems/audio)', () => {
    let keep;
    beforeEach(() => {
        keep = {};
        for (const k of ['_interior', '_indoorDuck', 'ctx', 'masterGain', 'musicGain', 'sfxGain', 'ambienceGain', 'initialized', 'muted', '_samples', '_samplesCtx', '_bedGroups', '_bedGroupsCtx', '_rainWant', '_rain', 'recordedSound', 'listener']) keep[k] = audioManager[k];
        const { ctx, log } = fakeCtx();
        audioManager.ctx = ctx;
        audioManager.initialized = true;
        audioManager.muted = false;
        audioManager.recordedSound = true;
        audioManager.masterGain = ctx.createGain();
        audioManager.musicGain = ctx.createGain();
        audioManager.sfxGain = ctx.createGain();
        audioManager.ambienceGain = ctx.createGain();
        audioManager._samples = null;
        audioManager._bedGroups = null;
        audioManager._rainWant = null;
        audioManager._rain = null;
        audioManager.listener = null;
        keep.log = log;
        // the files from disk, as the browser would fetch them
        keep.fetch = globalThis.fetch;
        globalThis.fetch = async (url) => {
            const p = path.resolve(ROOT, String(url));
            if (!fs.existsSync(p)) return { ok: false, status: 404 };
            const b = fs.readFileSync(p);
            return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
        };
    });
    afterEach(() => {
        globalThis.fetch = keep.fetch;
        for (const [k, v] of Object.entries(keep)) if (k !== 'log' && k !== 'fetch') audioManager[k] = v;
    });

    it('fetches and decodes a sound once, then plays it; a missing file is remembered and the synth stands in', async () => {
        const log = keep.log;
        expect(audioManager.recordedOn()).toBe(true);
        expect(audioManager.playSample('door_open')).toBe(false);          // not loaded yet: fetched
        await audioManager.loadSample('door_open');
        expect(audioManager.sampleReady('door_open')).toBe(true);
        expect(log.decoded).toBe(SAMPLE_BANK.door_open.files.length);
        expect(audioManager.playSample('door_open')).toBe(true);
        await audioManager.loadSample('door_open');
        expect(log.decoded).toBe(SAMPLE_BANK.door_open.files.length);       // cached: no second fetch
        // a key whose file is missing: failed, never fetched again, and playSFX falls back to the synthesizer
        SAMPLE_BANK._test_missing = { files: ['sfx/no_such_file.ogg'], gain: 1 };
        const synth = vi.spyOn(audioManager, '_sfxClick').mockImplementation(() => {});
        const bankClick = SFX_SAMPLES.click;
        SFX_SAMPLES.click = '_test_missing';
        try {
            await audioManager.loadSample('_test_missing');
            expect(audioManager.sampleFailed('_test_missing')).toBe(true);
            audioManager.playSFX('click');
            expect(synth).toHaveBeenCalled();
        } finally {
            SFX_SAMPLES.click = bankClick;
            delete SAMPLE_BANK._test_missing;
            synth.mockRestore();
        }
    });

    it('a sound with a place on the street plays by the listener\'s distance; too far, not at all', async () => {
        await audioManager.loadSample('anvil');
        audioManager.setListener(10, 10);
        audioManager.playSFX('anvil', { q: 11, r: 10 });
        const near = audioManager._lastSample.gain;
        audioManager.playSFX('anvil', { q: 20, r: 10 });
        const far = audioManager._lastSample.gain;
        expect(far).toBeLessThan(near);
        const at = audioManager._lastSample.at;
        audioManager.playSFX('anvil', { q: 60, r: 10 });
        expect(audioManager._lastSample.at).toBe(at);                       // (unheard: nothing played)
    });

    it('beds come in when loaded, glide to their level, and stop when long silent; the rain folds in', async () => {
        const log = keep.log;
        expect(audioManager.setAmbienceBeds({ day_birds: 0.8, wind: 0.3 }, { muffle: 0 })).toBe(true);
        await audioManager.loadSample('bed_day_birds');
        await audioManager.loadSample('bed_wind');
        await Promise.resolve();
        let st = audioManager.bedStats();
        expect(st.outdoor.day_birds).toBe(0.8);
        expect(st.outdoor.wind).toBe(0.3);
        // the rain: recorded beds instead of the synthesized hiss
        expect(audioManager.setRain(0.9, false)).toBe(true);
        await audioManager.loadSample('bed_rain_light');
        await audioManager.loadSample('bed_rain_heavy');
        await Promise.resolve();
        st = audioManager.bedStats();
        expect(st.outdoor.rain_heavy).toBeGreaterThan(0);
        expect(audioManager._rain).toBeFalsy();
        // silence a bed: it stops after a while
        audioManager.setAmbienceBeds({ wind: 0.3 }, {});
        const b = audioManager._bedGroups.outdoor.beds.day_birds;
        b.zeroSince = Date.now() - 60000;
        const stopped = log.stopped;
        audioManager.bedsTick(0.1);
        expect(audioManager._bedGroups.outdoor.beds.day_birds).toBeUndefined();
        expect(log.stopped).toBeGreaterThan(stopped);
        // indoors, muffled
        audioManager.setAmbienceBeds({ wind: 0.3 }, { muffle: 1 });
        expect(audioManager.bedStats().muffle).toBe(1);
        // the room's own recording on the indoor group
        audioManager.setInteriorAmbience({ kind: 'tavern', layers: { room: 0.8, chatter: 0.7, crowd: 0.5 }, echo: 0, duck: true });
        expect(audioManager._interiorError || null).toBe(null);
        await audioManager.loadSample('bed_tavern');
        await Promise.resolve();
        expect(audioManager.bedStats().indoor.tavern).toBe(0.7);
        expect(audioManager._interior.layers.chatter ? audioManager._interior.layers.chatter.level : 0).toBe(0);  // the synthesized murmur gives way
        audioManager.setInteriorAmbience(null);
        expect(audioManager.bedStats().indoorWant).toEqual({});
        expect(() => audioManager.stopAmbienceBeds()).not.toThrow();
    });

    it('nothing is fetched or played with recorded sound off (the synthesized sounds stay)', () => {
        audioManager.recordedSound = false;
        expect(audioManager.recordedOn()).toBe(false);
        expect(audioManager.playSample('door_open')).toBe(false);
        expect(audioManager.setAmbienceBeds({ wind: 1 })).toBe(false);
        expect(audioManager.setMusicMood('town')).toBe(false);
    });
});

describe('the soundscape with the player (ui/soundscape.js)', () => {
    let keep, calls;
    const fake = () => ({
        ctx: {}, recordedOn: () => true,
        setListener: (q, r) => calls.push(['listener', q, r]),
        setMusicMood: (m) => calls.push(['mood', m]),
        setAmbienceBeds: (b, o) => calls.push(['beds', b, o]),
        bedsTick() {},
        playSFX: (k, o) => calls.push(['sfx', k, o]),
    });
    const grid = (w, h, f = () => ({})) => Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, q) => ({ q, r, baseTerrain: 'dirt', terrainDetail: { layer: 'grass' }, subTerrain: { id: 'grass', passable: true }, ...f(q, r) })));
    beforeEach(() => {
        calls = [];
        keep = { audio: Soundscape.audio };
        for (const k of ['active', 'tiles', 'buildings', 'npcs', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_playerMoveProgress', '_insideBuilding', 'currentWorldTile', 'timeOfDay', '_timeAccumulator', '_sw', '_ss', '_deck', '_rideSpeed', '_aboardBoat']) keep['im_' + k] = InnerMap[k];
        Soundscape.audio = fake();
        Soundscape._walk = null; Soundscape._inside = undefined; Soundscape._acc = 1; Soundscape._steps = 0; Soundscape._nearKey = null;
        InnerMap.active = true;
        InnerMap.tiles = grid(30, 30, (q) => (q >= 26 ? { _wet: true, _waterKind: 'sea', subTerrain: { id: 'water', passable: false } } : {}));
        InnerMap.buildings = [{ q: 5, r: 5, type: 'tavern' }, { q: 8, r: 5, type: 'blacksmith' }];
        InnerMap.npcs = [];
        InnerMap.playerInnerQ = 6; InnerMap.playerInnerR = 6;
        InnerMap._playerWalking = false; InnerMap._playerMoveProgress = 0;
        InnerMap._insideBuilding = null;
        InnerMap.currentWorldTile = { q: 3, r: 4, terrain: { id: 'grassland' }, settlement: { name: 'Testby' } };
        InnerMap.timeOfDay = 20; InnerMap._timeAccumulator = 0;
        InnerMap._sw = null; InnerMap._ss = null; InnerMap._deck = null; InnerMap._rideSpeed = 0; InnerMap._aboardBoat = false;
    });
    afterEach(() => {
        Soundscape.audio = keep.audio;
        for (const [k, v] of Object.entries(keep)) if (k.startsWith('im_')) InnerMap[k.slice(3)] = v;
        Soundscape._stopWatch();
        Soundscape._live = false;
    });
    const game = { world: { season: 'Summer', day: 10 }, player: {} };

    it('chooses the mood and beds from the map: a town of an evening, near the tavern and the forge, the sea off the east edge', () => {
        Soundscape.update(game, 0.6);
        const mood = calls.filter(c => c[0] === 'mood').at(-1);
        expect(mood[1]).toBe('town');
        const beds = calls.filter(c => c[0] === 'beds').at(-1)[1];
        expect(beds.tavern).toBeGreaterThan(0.2);
        expect(beds.town_street).toBeGreaterThan(0);
        expect(beds.surf || 0).toBe(0);        // the sea is 20 cells off
        InnerMap.playerInnerQ = 22;
        Soundscape.update(game, 0.6);
        expect(calls.filter(c => c[0] === 'beds').at(-1)[1].surf).toBeGreaterThan(0.3);
        InnerMap.timeOfDay = 23;
        Soundscape.update(game, 0.6);
        expect(calls.filter(c => c[0] === 'mood').at(-1)[1]).toBe('night');
        expect(Soundscape.debug().spec).toBeTruthy();
    });

    it('two footsteps to a tile on the ground underfoot; hooves on horseback; a door on going in', () => {
        InnerMap._playerWalking = true;
        const steps = () => calls.filter(c => c[0] === 'sfx' && /^step_/.test(c[1]));
        Soundscape.update(game, 0.016);                                   // the walk begins
        InnerMap._playerMoveProgress = 0.55; Soundscape.update(game, 0.016);
        expect(steps().length).toBe(1);
        InnerMap._playerMoveProgress = 0.8; Soundscape.update(game, 0.016);
        expect(steps().length).toBe(1);                                   // (not again within the half)
        InnerMap.playerInnerQ = 7; InnerMap._playerMoveProgress = 0.05; Soundscape.update(game, 0.016);
        expect(steps().length).toBe(2);
        expect(steps()[0][1]).toBe('step_grass');
        // a paved street
        InnerMap.tiles[6][7].paving = true;
        InnerMap._playerMoveProgress = 0.6; Soundscape.update(game, 0.016);
        expect(steps().at(-1)[1]).toBe('step_stone');
        // on horseback: no footsteps, the hooves
        InnerMap._rideSpeed = 2;
        InnerMap.playerInnerQ = 8; InnerMap._playerMoveProgress = 0.1; Soundscape.update(game, 0.016);
        expect(steps().length).toBe(3);
        expect(calls.filter(c => c[0] === 'sfx' && c[1] === 'hoof').length).toBe(1);
        InnerMap._rideSpeed = 0;
        // going in
        InnerMap._insideBuilding = { type: 'tavern', q: 5, r: 5 };
        Soundscape.update(game, 0.016);
        expect(calls.some(c => c[0] === 'sfx' && c[1] === 'door_open')).toBe(true);
    });

    it('falls silent when the loop stops calling', () => {
        Soundscape.update(game, 0.6);
        calls.length = 0;
        Soundscape._watchdog(Soundscape._lastUpdate + 5000);
        const beds = calls.filter(c => c[0] === 'beds').at(-1);
        expect(beds[1]).toEqual({});
    });

    it('riding on the world map: a clip-clop every half second while the horse goes', () => {
        InnerMap.active = false;
        const rider = { world: { season: 'Summer', getTile: () => null }, player: { isMoving: true, mount: { name: 'Bess' } } };
        for (let i = 0; i < 20; i++) Soundscape.update(rider, 0.1);
        const n = calls.filter(c => c[0] === 'sfx' && c[1] === 'hoof').length;
        expect(n).toBeGreaterThanOrEqual(3);
        expect(n).toBeLessThanOrEqual(5);
        calls.length = 0;
        rider.player.mount = null;   // (on foot: no hooves)
        for (let i = 0; i < 20; i++) Soundscape.update(rider, 0.1);
        expect(calls.some(c => c[0] === 'sfx' && c[1] === 'hoof')).toBe(false);
        // the world map's hour is the day clock's
        InnerMap.timeOfDay = 23;
        Soundscape._acc = 1;
        Soundscape.update(rider, 0.6);
        expect(Soundscape.debug().inputs.hour).toBeGreaterThanOrEqual(23);
        expect(calls.filter(c => c[0] === 'mood').at(-1)[1]).toBe('night');
    });

    it('a crowd watching: its roar placed on the street, a cheer', () => {
        Soundscape.crowd('scaffold', { q: 6, r: 8, ttl: 30, level: 0.8, cheer: true });
        expect(calls.some(c => c[0] === 'sfx' && c[1] === 'crowd_cheer')).toBe(true);
        Soundscape.update(game, 0.6);
        expect(calls.filter(c => c[0] === 'beds').at(-1)[1].crowd).toBeGreaterThan(0.5);
        Soundscape.removeSource('scaffold');
    });

    it('the town world\'s sounds go to the soundscape: beds at the figures, the drill\'s shout, the crier\'s bell', () => {
        const keepTw = { audio: TownWorldSound.audio, scape: TownWorldSound.scape };
        const added = [];
        TownWorldSound.audio = { playSFX: (k, o) => calls.push(['sfx', k, o]) };
        TownWorldSound.scape = { addSource: (id, o) => added.push([id, o.bed]) };
        TownWorldSound._shoutAt = 1;   // (the first shout is due)
        TownWorldSound._criers.clear();
        InnerMap.npcs = [{ id: 'crier', _crier: true, q: 3, r: 3, activity: { type: 'cry' } }];
        try {
            const tw = { _figs: [
                { _tw: { kind: 'soldier' }, activity: { type: 'drill' }, q: 10, r: 10 },
                { _tw: { kind: 'soldier' }, activity: { type: 'drill' }, q: 11, r: 10 },
                { _tw: { kind: 'preacher' }, activity: { type: 'preach', label: 'Calling for the cross' }, q: 4, r: 4 },
            ], _camp: null };
            TownWorldSound.update(tw);
            expect(added.map(a => a[1]).sort()).toEqual(['drill', 'sermon']);
            expect(calls.some(c => c[0] === 'sfx' && c[1] === 'drill_shout')).toBe(true);
            expect(calls.filter(c => c[0] === 'sfx' && c[1] === 'handbell').length).toBe(1);
            TownWorldSound.update(tw);   // (the bell not again at once)
            expect(calls.filter(c => c[0] === 'sfx' && c[1] === 'handbell').length).toBe(1);
        } finally {
            TownWorldSound.audio = keepTw.audio;
            TownWorldSound.scape = keepTw.scape;
        }
    });

    it('a place-bound bed from another system is heard by its distance, and lapses', () => {
        Soundscape.addSource('feast', { bed: 'hall_murmur', q: 6, r: 7, level: 1, ttl: 60 });
        Soundscape.update(game, 0.6);
        expect(calls.filter(c => c[0] === 'beds').at(-1)[1].hall_murmur).toBeGreaterThan(0.5);
        Soundscape.removeSource('feast');
        Soundscape.update(game, 0.6);
        expect(calls.filter(c => c[0] === 'beds').at(-1)[1].hall_murmur || 0).toBe(0);
    });
});
