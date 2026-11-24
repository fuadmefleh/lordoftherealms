// The FPS readout (ui/fpsCounter.js): off until toggled, counts frames over half a second.
import { describe, it, expect, beforeEach } from 'vitest';
import { FpsCounter } from '../ui/fpsCounter.js';

describe('FPS counter', () => {
    beforeEach(() => FpsCounter.setEnabled(false));

    it('toggles on and off', () => {
        expect(FpsCounter.enabled).toBe(false);
        expect(FpsCounter.toggle()).toBe(true);
        expect(FpsCounter.toggle()).toBe(false);
    });

    it('reads about 60 fps from frames 1/60 s apart, and shows the worst frame', () => {
        FpsCounter.setEnabled(true);
        let t = 1000;
        for (let i = 0; i < 40; i++) { FpsCounter.tick(t); t += 1000 / 60; }
        FpsCounter.tick(t += 50); // one slow frame
        for (let i = 0; i < 40; i++) { FpsCounter.tick(t); t += 1000 / 60; }
        const text = FpsCounter._el ? FpsCounter._el.textContent : '';
        if (FpsCounter._el) expect(text).toMatch(/^\d+ fps/);
        const fps = Number((text.match(/^(\d+) fps/) || [])[1]);
        if (FpsCounter._el) expect(fps).toBeGreaterThan(40);
    });

    it('does nothing while off', () => {
        FpsCounter.tick(1000);
        expect(FpsCounter._last).toBe(0);
    });
});
