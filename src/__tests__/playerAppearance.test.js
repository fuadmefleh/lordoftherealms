import { describe, it, expect } from 'vitest';
import {
    APPEARANCE_OPTIONS, appearanceLayers, appearancePresetId, buildForGender, cycleOption,
    defaultAppearance, optionLabel, randomAppearance,
} from '../ui/playerAppearance.js';

describe('playerAppearance', () => {
    it('the default look matches the old noble presets', () => {
        expect(appearanceLayers(defaultAppearance('male'))).toEqual([
            'Body/Body 02 - Masculine, Thin/Ivory',
            'Head/Head 02 - Masculine/Ivory',
            'Head/Head Overlay - Eyes/Brown',
            'Clothing/Masculine, Thin/Legs/Pants 03 - Pants/Midnight',
            'Clothing/Masculine, Thin/Torso/Shirt 02 - V-neck Longsleeve Shirt/Purple',
            'Hair/Short 02 - Parted/Black',
        ]);
        expect(defaultAppearance('female').build).toBe('feminine');
    });

    it('beard and hair share the hair colour; "none" drops the layer', () => {
        const look = { ...defaultAppearance('male'), beard: 'Facial Hair 06 - Trimmed Beard', hairColor: 'Red' };
        const layers = appearanceLayers(look);
        expect(layers).toContain('Hair/Facial Hair 06 - Trimmed Beard/Red');
        expect(layers).toContain('Hair/Short 02 - Parted/Red');
        expect(appearanceLayers({ ...look, hair: 'none', beard: 'none' }).some(l => l.startsWith('Hair/'))).toBe(false);
    });

    it('cycling wraps both ways', () => {
        const look = defaultAppearance('male');
        const skins = APPEARANCE_OPTIONS.skin;
        expect(cycleOption({ ...look, skin: skins[0] }, 'skin', -1).skin).toBe(skins[skins.length - 1]);
        expect(cycleOption({ ...look, skin: skins[skins.length - 1] }, 'skin', 1).skin).toBe(skins[0]);
        expect(cycleOption(look, 'build', 1).build).toBe('feminine');
    });

    it('gender picks the build; "other" keeps the current one', () => {
        expect(buildForGender('female')).toBe('feminine');
        expect(buildForGender('male', 'feminine')).toBe('masculine');
        expect(buildForGender('other', 'feminine')).toBe('feminine');
    });

    it('a random look only uses real options, and feminine builds go clean-shaven', () => {
        let x = 0.37;
        const rand = () => { x = (x * 9301 + 49297) % 233280 / 233280; return x; };
        for (let i = 0; i < 50; i++) {
            const look = randomAppearance('female', rand);
            expect(look.build).toBe('feminine');
            expect(look.beard).toBe('none');
            for (const [key, opts] of Object.entries(APPEARANCE_OPTIONS)) {
                const values = opts.map(o => (Array.isArray(o) ? o[0] : o));
                expect(values).toContain(look[key]);
            }
        }
    });

    it('labels drop the asset-pack numbering', () => {
        expect(optionLabel('beard', 'Facial Hair 03 - Handlebar Mustache')).toBe('Handlebar');
        expect(optionLabel('shirt', 'Shirt 07 - Buttoned Longsleeve Shirt')).toBe('Buttoned Longsleeve');
        expect(optionLabel('beard', 'none')).toBe('Clean-shaven');
        expect(optionLabel('build', 'masculine')).toBe('Masculine');
    });

    it('a changed look is a different preset', () => {
        const a = defaultAppearance('male');
        expect(appearancePresetId(a)).not.toBe(appearancePresetId({ ...a, eyes: 'Green' }));
    });
});
