/**
 * The action points chip beside the clock on the top bar (ui/apChip.js,
 * TopBar.jsx #tbAP): count and pips, a tooltip that says when the hours left
 * are what limit the points, a clear "end the day" state at none, and the DOM
 * touched only when something shown changes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let apChipView, updateAPChip, InnerMap, DayClock;

beforeAll(async () => {
    const { DataLoader } = await import('../core/dataLoader.js');
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DayClock } = await import('../ui/game/dayClock.js'));
    ({ apChipView, updateAPChip } = await import('../ui/apChip.js'));
}, 120000);

const player = (ap, max = 10) => ({ actionPoints: ap, maxActionPoints: max });
const morning = { hoursLeft: 16, timeAllows: 10, hoursPerAP: 1.5 };

describe('apChipView', () => {
    it('full points at the start of the day', () => {
        const v = apChipView(player(10), morning);
        expect(v.visible).toBe(true);
        expect(v.text).toBe('10 / 10 AP');
        expect(v.pips).toEqual(Array(10).fill('on'));
        expect(v.timeLimited).toBe(false);
        expect(v.title).toMatch(/^10 of 10 action points left today/);
    });

    it('spent points are hollow pips, the hour\'s are dark, and the tooltip says the day is getting on', () => {
        const v = apChipView(player(6), { hoursLeft: 10.5, timeAllows: 7, hoursPerAP: 1.5, lost: 3 });
        expect(v.text).toBe('6 / 10 AP');
        expect(v.pips).toEqual([...Array(6).fill('on'), 'spent', 'night', 'night', 'night']);
        expect(v.title).toMatch(/3 lost to the hour today/);
        // points only spent (the clock moved with them): hollow pips, none dark
        expect(apChipView(player(8), { hoursLeft: 13, timeAllows: 8, hoursPerAP: 1.5, lost: 0 }).pips.filter(p => p === 'night')).toHaveLength(0);
        expect(v.timeLimited).toBe(true);
        expect(v.title).toMatch(/^6 of 10 action points left — the day is getting on: 10\.5 hours till midnight/);
        expect(v.level).toBe('');
    });

    it('none left reads as "end the day"', () => {
        const v = apChipView(player(0), { hoursLeft: 4, timeAllows: 2, hoursPerAP: 1.5 });
        expect(v.empty).toBe(true);
        expect(v.text).toBe('No AP — end the day');
        expect(v.title).toMatch(/^No action points left — end the day/);
        expect(apChipView(player(0), { hoursLeft: 1, timeAllows: 0, hoursPerAP: 1.5 }).title).toMatch(/Midnight is near/);
    });

    it('few points left are marked low; no player hides it', () => {
        expect(apChipView(player(3), morning).level).toBe('low');
        expect(apChipView(null, morning).visible).toBe(false);
        expect(apChipView({ interregnum: true, actionPoints: 5 }, morning).visible).toBe(false);
    });

    it('reads the day clock by default', () => {
        InnerMap.timeOfDay = 14;          // 10 hours left → room for 6 points
        InnerMap._timeAccumulator = 0;
        const v = apChipView(player(6));
        expect(v.allowed).toBe(DayClock.pointsTimeAllows());
        expect(v.allowed).toBe(6);
        expect(v.title).toMatch(/10 hours till midnight/);
        InnerMap.timeOfDay = 8;
    });
});

describe('updateAPChip', () => {
    let reg, orig, writes;
    function makeEl(id) {
        const classes = new Set();
        let text = '', html = '';
        return {
            id, title: '', style: { display: 'none' },
            setAttribute() {},
            get textContent() { return text; },
            set textContent(t) { writes++; text = t; },
            get innerHTML() { return html; },
            set innerHTML(h) { writes++; html = h; },
            classList: {
                toggle: (c, f) => { if (f) classes.add(c); else classes.delete(c); },
                contains: (c) => classes.has(c),
            },
        };
    }
    beforeEach(() => {
        reg = {}; writes = 0;
        orig = document.getElementById;
        document.getElementById = (id) => (reg[id] || (reg[id] = makeEl(id)));
    });
    afterEach(() => { document.getElementById = orig; });

    it('fills the chip, and leaves the DOM alone while nothing changes', () => {
        updateAPChip(player(7), morning);
        expect(reg.tbAP.style.display).toBe('');
        expect(reg.tbAPVal.textContent).toBe('7 / 10 AP');
        expect((reg.tbAPPips.innerHTML.match(/tb-ap-pip--on/g) || []).length).toBe(7);
        const after = writes;
        for (let i = 0; i < 50; i++) updateAPChip(player(7), morning);   // 50 frames, nothing new
        expect(writes).toBe(after);
        updateAPChip(player(0), { hoursLeft: 3, timeAllows: 2, hoursPerAP: 1.5 });
        expect(reg.tbAPVal.textContent).toBe('No AP — end the day');
        expect(reg.tbAP.classList.contains('tb-ap--empty')).toBe(true);
        expect(reg.tbAP.title).toMatch(/end the day/);
    });

    it('the top bar has the chip on the date line, and the loop and updateStats refresh it', () => {
        const root = resolve(__dirname, '..');
        const topBar = readFileSync(resolve(root, 'components/TopBar.jsx'), 'utf8');
        expect(topBar).toMatch(/id="tbAP"/);
        expect(topBar).toMatch(/id="tbAPVal"/);
        expect(topBar).toMatch(/id="tbAPPips"/);
        expect(readFileSync(resolve(root, 'ui/game/gameLoop.js'), 'utf8')).toMatch(/updateAPChip\(this\.player\)/);
        expect(readFileSync(resolve(root, 'ui/ui/hud.js'), 'utf8')).toMatch(/updateAPChip\(player\)/);
    });
});
