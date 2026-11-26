// AudioManager — core: constructor + module-scoped helpers. Instance/static methods
// are Object.assign'd onto AudioManager / AudioManager.prototype by the sibling modules.
import {  } from './_imports.js';

// ============================================
// AUDIO — recorded music, ambience beds and SFX
// (assets/audio/: audio/samples.js, beds.js, music.js),
// with the procedural Web Audio soundscapes kept as
// the fallback (and the sounds no file covers).
// ============================================

export class AudioManager {
    constructor() {
        this.ctx = null;           // AudioContext (created on first user interaction)
        this.masterGain = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.ambienceGain = null;

        // Volume levels (0–1)
        this.masterVolume = 0.5;
        this.musicVolume = 0.6;
        this.sfxVolume = 0.7;
        this.ambienceVolume = 0.4;
        this.muted = false;
        this.recordedSound = true;     // the recordings under assets/audio/ (false: synthesized only)
        this.listener = null;          // { q, r } on the street map (ui/soundscape.js)

        // State
        this.currentScene = 'none';    // title | explore | town | combat | night | ocean
        this.musicNodes = [];          // active oscillators/gains for cleanup
        this.ambienceNodes = [];
        this.musicLoopTimer = null;
        this.isPlaying = false;
        this.initialized = false;

        // Musical scales (MIDI note numbers — pentatonic & modal for medieval feel)
        this.scales = {
            aeolian:     [0, 2, 3, 5, 7, 8, 10],   // natural minor
            dorian:      [0, 2, 3, 5, 7, 9, 10],    // medieval dorian
            pentatonic:  [0, 2, 4, 7, 9],            // peaceful
            phrygian:    [0, 1, 3, 5, 7, 8, 10],    // dark/exotic
            mixolydian:  [0, 2, 4, 5, 7, 9, 10],    // bright/heroic
        };

        // Load saved preferences
        this._loadPreferences();
    }
}
