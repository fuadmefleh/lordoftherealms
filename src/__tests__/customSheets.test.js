/**
 * CustomSheets — sheets a modder imports in the editors live under made-up
 * custom/ paths with the pixels in the mod store; the game's image loaders
 * resolve those paths to the stored data URLs. Without it, tiles painted
 * from an imported sheet load a path that does not exist and draw nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CustomSheets } from '../core/customSheets.js';

describe('CustomSheets', () => {
    beforeEach(() => CustomSheets.clear());

    it('resolves a registered custom/ path to its data URL', () => {
        expect(CustomSheets.register([{ name: 'Mud', assetPath: 'custom/1_mud.png', dataUrl: 'data:image/png;base64,AAA' }])).toBe(1);
        expect(CustomSheets.resolve('custom/1_mud.png')).toBe('data:image/png;base64,AAA');
        expect(CustomSheets.has('custom/1_mud.png')).toBe(true);
    });

    it('passes ordinary and unknown paths through unchanged', () => {
        expect(CustomSheets.resolve('assets/lpc/Terrain/terrain_summer.png')).toBe('assets/lpc/Terrain/terrain_summer.png');
        expect(CustomSheets.resolve('custom/missing.png')).toBe('custom/missing.png');
        expect(CustomSheets.resolve(undefined)).toBeUndefined();
    });

    it('skips malformed entries', () => {
        expect(CustomSheets.register([null, { assetPath: 'custom/x.png' }, { dataUrl: 'data:' }])).toBe(0);
        expect(CustomSheets.size).toBe(0);
    });
});
