/**
 * Ambient life on the inner map — the pure model (ui/ambientModel.js) read
 * with the real settings (data/ambient.json): which buildings and objects
 * give off what, the hours they burn, the wind, and particles that keep no
 * state (the same clock gives the same puff; a stopped clock, a still one).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    ambientConfig, curveAt, scheduleIntensity, emitterLevel, windFor, slotCount,
    particleAt, frameAt, chimneyTops, buildingEmitters, buildingBox,
} from '../ui/ambientModel.js';

const root = path.resolve(__dirname, '../..');
const cfg = ambientConfig(JSON.parse(fs.readFileSync(path.join(root, 'data/ambient.json'), 'utf8')));
const buildings = JSON.parse(fs.readFileSync(path.join(root, 'data/buildings.json'), 'utf8'));
const byType = t => buildings.filter(b => b.buildingType === t);
const hasChimney = b => (b.layers.overlay || []).some(c => /Chimney/.test(c.sheetPath));

describe('ambient settings', () => {
    it('every emitter names a kind that exists, every building spec a schedule', () => {
        for (const spec of [...Object.values(cfg.objects), ...Object.values(cfg.furniture)]) {
            for (const e of spec.emit || []) expect(cfg.kinds[e.kind], e.kind).toBeTruthy();
            if (spec.lit) expect(cfg.schedules[spec.lit], spec.lit).toBeTruthy();
        }
        for (const [type, spec] of Object.entries(cfg.buildings)) {
            expect(cfg.schedules[spec.schedule || 'allDay'], type).toBeTruthy();
            for (const e of [...(spec.chimney || []), ...(spec.roof || [])]) expect(cfg.kinds[e.kind], `${type}:${e.kind}`).toBeTruthy();
        }
    });

    it('the campfire plays the four flame frames its sheet holds', () => {
        const props = JSON.parse(fs.readFileSync(path.join(root, 'data/townProps.json'), 'utf8')).props;
        const fire = props.find(p => p.id === 'tp_campfire');
        const f = cfg.objects.tp_campfire.frames;
        expect(f.count).toBe(4);
        // (frames run right along the sheet's row: the last must be inside its 4 columns)
        expect(fire.rect[0] + (f.count - 1) * f.step[0]).toBeLessThan(4);
        const seen = new Set();
        for (let t = 0; t < 2; t += 0.05) seen.add(frameAt(f, t, 123));
        expect(seen.size).toBe(4);
    });
});

describe('what smokes', () => {
    it('a house with a chimney smokes from each chimney pot; one without, not at all', () => {
        const withC = byType('house').find(hasChimney);
        const without = byType('house').find(b => !hasChimney(b));
        const tops = chimneyTops(withC);
        const em = buildingEmitters(withC, cfg);
        expect(tops.length).toBeGreaterThan(0);
        expect(em.length).toBe(tops.length * cfg.buildings.house.chimney.length);
        // (the pot is above the roof: higher than any wall row)
        const box = buildingBox(withC);
        for (const e of em) expect(e.y).toBeLessThan(box.maxR);
        expect(buildingEmitters(without, cfg)).toEqual([]);
    });

    it('a smithy throws sparks with its smoke; a bathhouse steams with no chimney at all', () => {
        const smithy = byType('blacksmith').find(hasChimney);
        const kinds = new Set(buildingEmitters(smithy, cfg).map(e => e.kind));
        expect(kinds.has('spark')).toBe(true);
        expect(kinds.has('smokeDark')).toBe(true);
        const baths = byType('bathhouse')[0];
        const em = buildingEmitters(baths, cfg);
        expect(em.length).toBeGreaterThan(0);
        expect(em.every(e => e.kind === 'steam')).toBe(true);
    });
});

describe('the hours fires burn', () => {
    const at = (sched, hour, extra = {}) => scheduleIntensity(cfg.schedules[sched], { hour, season: 'Spring', celsius: 12, ...extra });

    it('curves are linear between their points', () => {
        expect(curveAt([[0, 0], [10, 1], [24, 1]], 5)).toBeCloseTo(0.5);
        expect(curveAt([[0, 0], [10, 1], [24, 1]], 30)).toBeCloseTo(0.6);   // (wraps the day)
    });

    it('hearths: morning and evening over midday and the small hours; more in winter and the cold', () => {
        expect(at('hearth', 7)).toBeGreaterThan(at('hearth', 13));
        expect(at('hearth', 19)).toBeGreaterThan(at('hearth', 3));
        expect(at('hearth', 13, { season: 'Winter' })).toBeGreaterThan(at('hearth', 13, { season: 'Summer' }));
        expect(at('hearth', 13, { celsius: -8 })).toBeGreaterThan(at('hearth', 13, { celsius: 20 }));
    });

    it('the forge works the day and is out at night; the bakery fires before dawn', () => {
        expect(at('forge', 10)).toBeCloseTo(1);
        expect(at('forge', 2)).toBe(0);
        expect(at('bakery', 4.5)).toBeGreaterThan(at('bakery', 22));
        expect(at('dark', 23)).toBe(1);
        expect(at('dark', 12)).toBe(0);
    });

    it('houses light one by one as the hour comes round, none at nought, all at full', () => {
        const lit = cov => Array.from({ length: 200 }, (_, i) => emitterLevel(cov, 1, i * 977)).filter(l => l > 0.02).length;
        expect(lit(0)).toBe(0);
        expect(lit(1)).toBe(200);
        const half = lit(0.5);
        expect(half).toBeGreaterThan(60);
        expect(half).toBeLessThan(140);
        expect(lit(0.3)).toBeLessThan(half);
    });
});

describe('wind and particles', () => {
    it('the wind holds for the day and blows harder in a storm', () => {
        const a = windFor(10, 20, 5, 'clear', cfg.wind), b = windFor(10, 20, 5, 'clear', cfg.wind);
        expect(a).toEqual(b);
        const s = windFor(10, 20, 5, 'storm', cfg.wind);
        expect(Math.hypot(s.x, s.y)).toBeGreaterThan(Math.hypot(a.x, a.y) * 1.5);
    });

    it('a particle is worked out from the clock: same moment, same puff; it rises as it ages', () => {
        const kind = cfg.kinds.smoke;
        const n = slotCount(kind, 2, cfg.maxSlots);
        const wind = { x: 0, y: 0 };
        let rose = 0, alive = 0;
        for (let slot = 0; slot < n; slot++) {
            const p = {}, q = {};
            particleAt(kind, 42, slot, n, 2, 100, wind, 1, p);
            particleAt(kind, 42, slot, n, 2, 100, wind, 1, q);
            expect(q).toEqual(p);
            if (!p.alive) continue;
            alive++;
            const y0 = p.y, u0 = p.u;
            particleAt(kind, 42, slot, n, 2, 100.3, wind, 1, q);
            if (q.alive && q.u > u0) { expect(q.y).toBeLessThan(y0); rose++; }
            expect(p.alpha).toBeGreaterThanOrEqual(0);
            expect(p.alpha).toBeLessThanOrEqual(kind.alpha + 1e-9);
        }
        expect(alive).toBeGreaterThan(n / 2);
        expect(rose).toBeGreaterThan(0);
    });

    it('the smoke leans with the wind', () => {
        const kind = cfg.kinds.smoke;
        const n = slotCount(kind, 2, cfg.maxSlots);
        const p = {};
        let sum = 0;
        for (let slot = 0; slot < n; slot++) {
            particleAt(kind, 7, slot, n, 2, 50, { x: 1, y: 0 }, 1, p);
            if (p.alive) sum += p.x;
        }
        expect(sum).toBeGreaterThan(0);
    });
});
