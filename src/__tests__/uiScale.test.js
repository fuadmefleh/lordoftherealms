import { describe, it, expect } from 'vitest';
import { autoUiZoom, resolveUiZoom, UI_SCALE_OPTIONS } from '../ui/uiScale.js';

describe('uiScale', () => {
    it('auto never shrinks the interface below 100%', () => {
        expect(autoUiZoom(1280, 720)).toBe(1);
        expect(autoUiZoom(1600, 900)).toBe(1);
    });

    it('auto grows with the screen, limited by the shorter fit, and caps', () => {
        expect(autoUiZoom(2560, 1440)).toBeCloseTo(1.6);
        // a wide but short window is limited by its height
        expect(autoUiZoom(3440, 1080)).toBeCloseTo(1.2);
        expect(autoUiZoom(7680, 4320)).toBe(1.75);
    });

    it('a fixed preference wins over the screen size, within bounds', () => {
        expect(resolveUiZoom('1.3', 1280, 720)).toBe(1.3);
        expect(resolveUiZoom(1, 3840, 2160)).toBe(1);
        expect(resolveUiZoom('0.1', 1600, 900)).toBe(0.7);
        expect(resolveUiZoom('9', 1600, 900)).toBe(2.5);
    });

    it('auto, a missing or a garbled preference all fit the screen', () => {
        for (const pref of ['auto', undefined, null, 'big']) {
            expect(resolveUiZoom(pref, 2560, 1440)).toBeCloseTo(1.6);
        }
    });

    it('offers auto plus fixed sizes that all resolve to themselves', () => {
        expect(UI_SCALE_OPTIONS[0].value).toBe('auto');
        for (const o of UI_SCALE_OPTIONS.slice(1)) {
            expect(resolveUiZoom(o.value, 1600, 900)).toBe(parseFloat(o.value));
        }
    });
});
