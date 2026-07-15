/**
 * Guard for the buildingCreator.js by-hand split. This was the hard case: ~1370
 * lines of interdependent functions over 21 mutable module `let` vars. Those
 * were first consolidated into a shared `bcState` object (so split modules can
 * mutate it), then the functions were split into buildingCreator/{resources,
 * paint,ui,build}.js + shared.js + the facade in index.js.
 *
 * A no-undef static pass over the split dir verified every cross-group
 * reference resolves. Here we check the facade + that the shared state object
 * carries all consolidated fields.
 */
import { describe, it, expect } from 'vitest';
import { BuildingCreator } from '../ui/buildingCreator.js';
import { bcState } from '../ui/buildingCreator/shared.js';

const STATE_KEYS = ['_overlay', '_game', '_anchorQ', '_anchorR', '_gridW', '_gridH', '_layers', '_meta', '_brushGroupMap', '_activeLayer', '_activeTool', '_activeBrush', '_activeStamp', '_panX', '_panY', '_buildingName', '_isOpen', '_phase', '_exteriorDef', '_cvs', '_ctx'];

describe('BuildingCreator split', () => {
    it('facade exposes its methods and isOpen reads shared state', () => {
        for (const m of ['open', 'close', 'isOpen', 'setBrushCost', 'getBrushCost']) {
            expect(typeof BuildingCreator[m], m).toBe('function');
        }
        expect(BuildingCreator.isOpen()).toBe(false);
    });

    it('brush-cost round-trips through the resources module (via the facade)', () => {
        BuildingCreator.setBrushCost('brushA', { gold: 7 });
        expect(BuildingCreator.getBrushCost('brushA')).toEqual({ gold: 7, resources: {} });
    });

    it('the shared bcState object carries all 21 consolidated fields', () => {
        const missing = STATE_KEYS.filter((k) => !(k in bcState));
        expect(missing).toEqual([]);
        expect(STATE_KEYS).toHaveLength(21);
    });
});
