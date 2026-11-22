// The maimed, seen (systems/maimMarks.js visible, ui/maimLook.js): what shows of a body, the
// LPC layers it yields on each body, where they go in a look, and that every sheet they name
// was drawn (scripts/make_maim_layers.py → assets/lpc/Characters/Maimed).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadData } from './playtest/harness.js';
import { MaimMarks } from '../systems/maimMarks.js';
import { maimLayers, applyMaim, maimKey, buildOf, canCarry, bustCrop, keyOfPreset, EYE_PATCH_LAYER } from '../ui/maimLook.js';

beforeAll(async () => { await loadData(); });

const body = (parts, aids = {}, extra = {}) => ({ gender: 'male', maimed: { parts, log: [], aids, ...extra } });
const CHARS = path.resolve(__dirname, '../../assets/lpc/Characters');
const MALE = ['Body/Body 02 - Masculine, Thin/Ivory', 'Head/Head 02 - Masculine/Ivory', 'Head/Head Overlay - Eyes/Brown',
    'Clothing/Masculine, Thin/Legs/Pants 03 - Pants/Brown', 'Hair/Short 02 - Parted/Black'];
const FEMALE = ['Body/Body 01 - Feminine, Thin/Peach', 'Head/Head 01 - Feminine/Peach', 'Hair/Medium 03 - Idol/Blonde'];

describe('MaimMarks.visible — what shows of a body', () => {
    it('nothing for the whole, the tongueless, the gelded', () => {
        expect(MaimMarks.visible({})).toBe(null);
        expect(MaimMarks.visible(body({}))).toBe(null);
        expect(MaimMarks.visible(body({ tongue: 1, geld: 1 }))).toBe(null);
    });

    it('the right hand goes first; a hook goes on it', () => {
        expect(MaimMarks.visible(body({ hand: 1 })).hands).toEqual({ R: 'stump', L: null });
        expect(MaimMarks.visible(body({ hand: 1 }, { iron_hook: 5 })).hands).toEqual({ R: 'hook', L: null });
        expect(MaimMarks.visible(body({ hand: 2 }, { iron_hook: 5 })).hands).toEqual({ R: 'hook', L: 'stump' });
    });

    it('the left foot goes first; a wooden leg or a crutch', () => {
        expect(MaimMarks.visible(body({ foot: 1 })).feet).toEqual({ L: 'stump', R: null });
        const peg = MaimMarks.visible(body({ foot: 1 }, { wooden_leg: 3 }));
        expect(peg.feet).toEqual({ L: 'peg', R: null });
        expect(peg.crutch).toBe(null);
        const cr = MaimMarks.visible(body({ foot: 2 }, { crutch: 3 }));
        expect(cr.feet).toEqual({ L: 'stump', R: 'stump' });
        expect(cr.crutch).toBe('L');
    });

    it('an eye: the scar, the patch (worn, or a townsperson who covers it), blind', () => {
        expect(MaimMarks.visible(body({ eye: 1 })).eyes).toBe('scar');
        expect(MaimMarks.visible(body({ eye: 1 }, { eye_patch: 2 })).eyes).toBe('patch');
        expect(MaimMarks.visible(body({ eye: 1 }, {}, { npcPatch: true })).eyes).toBe('patch');
        expect(MaimMarks.visible(body({ eye: 2 }, { eye_patch: 2 })).eyes).toBe('blind');
    });

    it('ears, the nose (slit or copper), the brand', () => {
        const v = MaimMarks.visible(body({ ear: 2, nose: 1, brand: 1 }));
        expect(v.ears).toBe(2);
        expect(v.nose).toBe('slit');
        expect(v.brand).toBe(true);
        expect(MaimMarks.visible(body({ nose: 1 }, { false_nose: 9 })).nose).toBe('copper');
    });
});

describe('MaimLook — the layers', () => {
    it('knows the body from a look, and none for a child', () => {
        expect(buildOf(MALE)).toBe('Masculine');
        expect(buildOf(FEMALE)).toBe('Feminine');
        expect(buildOf(['Children/Body/Light'])).toBe(null);
        expect(buildOf([])).toBe(null);
    });

    it('each erase comes before what it makes room for', () => {
        const v = MaimMarks.visible(body({ hand: 1, foot: 1, eye: 2, nose: 1 }, { iron_hook: 1, wooden_leg: 1 }));
        const { face, limbs } = maimLayers(v, 'Feminine');
        expect(limbs).toEqual([
            'Maimed/Erase - Right Hand/Feminine', 'Maimed/Hook - Right Hand/Feminine',
            'Maimed/Erase - Left Leg/Feminine', 'Maimed/Peg - Left Leg/Feminine',
        ]);
        expect(face).toEqual(['Maimed/Blindfold/Feminine', 'Maimed/Slit Nose/Feminine']);
    });

    it('the patch is the LPC eyepatch; the face goes under a helmet, the limbs under what is carried', () => {
        const v = MaimMarks.visible(body({ eye: 1, hand: 1 }, { eye_patch: 1 }));
        const look = [...MALE, 'Head Accessories/Helm 03 - Norman/Iron', 'Props/Shield 01 - Heater Shield/Iron', 'Props/Sword 01 - Arming Sword/Iron'];
        const out = applyMaim(look, v);
        const at = (l) => out.indexOf(l);
        expect(at(EYE_PATCH_LAYER)).toBeGreaterThan(at('Hair/Short 02 - Parted/Black'));
        expect(at(EYE_PATCH_LAYER)).toBeLessThan(at('Head Accessories/Helm 03 - Norman/Iron'));
        expect(at('Maimed/Hook - Right Hand/Masculine')).toBe(-1);
        expect(at('Maimed/Erase - Right Hand/Masculine')).toBeGreaterThan(at('Head Accessories/Helm 03 - Norman/Iron'));
        // the sword hand is gone: the sword is stowed; the shield on the other arm stays, over the stump
        expect(at('Props/Sword 01 - Arming Sword/Iron')).toBe(-1);
        expect(at('Maimed/Stump - Right Hand/Masculine')).toBeLessThan(at('Props/Shield 01 - Heater Shield/Iron'));
        // applied twice, the same: an old patch or old marks are taken off first
        expect(applyMaim(out, v)).toEqual(out);
        // nothing shown: the look as it was given
        expect(applyMaim(look, null)).toEqual(look);
    });

    it('what a maimed body can still carry', () => {
        const one = { hands: { R: 'hook', L: null } };
        const both = { hands: { R: 'stump', L: 'stump' } };
        const whole = { hands: { R: null, L: null } };
        expect(canCarry('Props/Sword 01 - Arming Sword/Iron', whole)).toBe(true);
        expect(canCarry('Props/Sword 01 - Arming Sword/Iron', one)).toBe(false);
        expect(canCarry('Props/Shield 02 - Buckler/Wood', one)).toBe(true);
        expect(canCarry('Props/Bow/Wood', one)).toBe(false);
        expect(canCarry('Props/Shield 02 - Buckler/Wood', both)).toBe(false);
        expect(canCarry('Props/Sword 01 - Arming Sword/Iron', null)).toBe(true);
    });

    it('the bust drops lower to show a lost hand, lower still for a lost foot', () => {
        expect(bustCrop('male_noble')).toEqual({ x: 14, y: 10, size: 36 });
        expect(bustCrop('maim:es|male_noble')).toEqual({ x: 14, y: 10, size: 36 });
        expect(bustCrop('maim:hRh|male_noble').size).toBe(44);
        expect(bustCrop('maim:hRhfLp|era:dawn:male_noble#2').size).toBe(48);
        expect(keyOfPreset('player:masculine|Ivory|Brown|x|,,,,,,|hRsep')).toBe('hRsep');
        expect(bustCrop('player:masculine|Ivory|Brown|x|,,,,,,|cL').size).toBe(48);
        expect(keyOfPreset('player:masculine|Ivory|Brown|Black')).toBe('');
    });

    it('a key per look, empty when nothing shows', () => {
        expect(maimKey(null)).toBe('');
        const a = maimKey(MaimMarks.visible(body({ hand: 1 })));
        const b = maimKey(MaimMarks.visible(body({ hand: 1 }, { iron_hook: 1 })));
        const c = maimKey(MaimMarks.visible(body({ foot: 1 }, { crutch: 1 })));
        expect(new Set([a, b, c]).size).toBe(3);
        expect(maimKey(MaimMarks.visible(body({ hand: 2, foot: 2, eye: 1, ear: 1, nose: 1, brand: 1 }, { iron_hook: 1, wooden_leg: 1, false_nose: 1 })))).toBe('hRhhLsfLpfRsesa1ncb');
    });

    it('every sheet a body can ask for was drawn, on both bodies, walking and standing', () => {
        const every = body({ hand: 2, foot: 2, eye: 1, ear: 2, nose: 1, brand: 1 });
        const kinds = [
            MaimMarks.visible(every),
            MaimMarks.visible(body({ hand: 1, foot: 1, eye: 2, nose: 1 }, { iron_hook: 1, wooden_leg: 1, false_nose: 1 })),
            MaimMarks.visible(body({ foot: 1 }, { crutch: 1 })),
            { hands: { R: 'hook', L: 'hook' }, feet: { L: 'peg', R: 'peg' }, crutch: 'R', eyes: 'scar', ears: 0, nose: null, brand: false },
        ];
        const missing = [];
        for (const build of ['Masculine', 'Feminine']) {
            for (const v of kinds) {
                const { face, limbs } = maimLayers(v, build);
                for (const l of [...face, ...limbs]) {
                    for (const anim of ['Walk', 'Idle']) {
                        if (!fs.existsSync(path.join(CHARS, l, anim + '.png'))) missing.push(`${l}/${anim}`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
