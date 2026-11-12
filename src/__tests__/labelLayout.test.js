// The inner map's NPC names: laid out so none is drawn over another (ui/labelLayout.js)
import { describe, it, expect } from 'vitest';
import { layoutLabels, labelPriority } from '../ui/labelLayout.js';

const box = l => ({ x0: l.x - l.w / 2, x1: l.x + l.w / 2, y0: l.y + l.dy, y1: l.y + l.dy + l.h });
const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('layoutLabels', () => {
    it('leaves labels that are clear of each other where they are', () => {
        const out = layoutLabels([{ x: 0, y: 0, w: 40, h: 12 }, { x: 200, y: 0, w: 40, h: 12 }]);
        expect(out.map(l => [l.dy, l.hidden])).toEqual([[0, false], [0, false]]);
    });

    it('steps a crowded label a line down, then up, and none of the shown ones overlap', () => {
        const crowd = [];
        for (let i = 0; i < 6; i++) crowd.push({ x: 100 + i * 4, y: 50, w: 50, h: 12, priority: 10 - i });
        const out = layoutLabels(crowd, { gap: 1, steps: 2, pad: 0 });
        expect(out[0].dy).toBe(0);
        expect(out[1].dy).toBe(13);
        expect(out[2].dy).toBe(-13);
        const shown = out.filter(l => !l.hidden);
        expect(shown.length).toBe(5);
        expect(out[5].hidden).toBe(true);
        for (let i = 0; i < shown.length; i++) {
            for (let j = i + 1; j < shown.length; j++) expect(hit(box(shown[i]), box(shown[j]))).toBe(false);
        }
    });

    it('places the higher priority first and always shows the hovered one in its own spot', () => {
        const out = layoutLabels([
            { x: 0, y: 0, w: 40, h: 12, priority: 5, id: 'far' },
            { x: 2, y: 0, w: 40, h: 12, priority: 1, always: true, id: 'hovered' },
        ], { steps: 0 });
        expect(out[1]).toMatchObject({ id: 'hovered', dy: 0, hidden: false });
        expect(out[0]).toMatchObject({ id: 'far', hidden: true });
    });

    it('ranks the hovered, then the near, then the far', () => {
        expect(labelPriority(30, { hovered: true })).toBeGreaterThan(labelPriority(0));
        expect(labelPriority(1)).toBeGreaterThan(labelPriority(8));
        expect(labelPriority(5, { keeper: true })).toBeGreaterThan(labelPriority(5));
    });

    it('copes with nothing to lay out', () => {
        expect(layoutLabels([])).toEqual([]);
        expect(layoutLabels(null)).toEqual([]);
    });
});
