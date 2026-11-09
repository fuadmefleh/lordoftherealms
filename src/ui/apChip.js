// ============================================
// ACTION POINTS CHIP — the day's points on the top bar
// ============================================
// Beside the clock on the date line (components/TopBar.jsx #tbAP): "⚡ 7 / 10 AP"
// and a pip for each point — lit while it is yours to spend, hollow once spent,
// and dark when the hour has taken it (the hours left before midnight allow
// only so many: ui/game/dayClock.js pointsTimeAllows / lostToday). Its tooltip
// says when the hours left are what limit them; at none it reads "No AP — end
// the day".
//
// The game loop calls updateAPChip every frame (the clock may lower the points
// on the town map at any moment); it compares a key and touches the DOM only
// when something shown has changed. Plain DOM, no React re-render.
//
// It lives in the top bar and so inherits the HUD's --ui-zoom; it sets no
// viewport sizes or pixel positions of its own — the tooltip is the native
// title attribute.

import { DayClock } from './game/dayClock.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _hours = (h) => {
    const r = Math.round(h * 2) / 2;
    return `${Number.isInteger(r) ? r : r.toFixed(1)} hour${r === 1 ? '' : 's'}`;
};

/**
 * What the chip shows, as plain data (no DOM):
 * { visible, ap, max, allowed, timeLimited, empty, level, text, pips, title }.
 * `clock` = { hoursLeft, timeAllows, hoursPerAP, lost } (from DayClock by default;
 * lost = points the hour has taken today, DayClock.lostToday).
 * pips: one per max point, 'on' | 'spent' | 'night' (taken by the hour).
 */
export function apChipView(player, clock) {
    if (!player || player.interregnum || !Number.isFinite(player.actionPoints)) {
        return { visible: false, ap: 0, max: 0, allowed: 0, timeLimited: false, empty: false, level: '', text: '', pips: [], title: '' };
    }
    const c = clock || {
        hoursLeft: DayClock.hoursLeft(),
        timeAllows: DayClock.pointsTimeAllows(),
        hoursPerAP: DayClock.config().hoursPerAP,
        lost: DayClock.lostToday,
    };
    const max = Math.max(1, Math.round(_num(player.maxActionPoints, 10)));
    const ap = Math.max(0, Math.floor(_num(player.actionPoints)));
    const hoursLeft = Math.max(0, _num(c.hoursLeft, 24));
    const allowed = Math.max(0, Math.min(max, Math.floor(_num(c.timeAllows, max))));
    const timeLimited = allowed < max;
    const empty = ap < 1;
    const level = empty ? 'empty' : ap <= 3 ? 'low' : '';

    const pips = [];
    // the hour's take sits at the end of the row, the points spent between
    const night = Math.min(max - Math.min(ap, max), Math.max(0, Math.floor(_num(c.lost))));
    for (let i = 0; i < max; i++) pips.push(i < ap ? 'on' : i < max - night ? 'spent' : 'night');

    const per = _num(c.hoursPerAP, 1.5);
    const perText = per === 1.5 ? '1½ hours' : _hours(per);
    let title;
    if (empty) {
        title = timeLimited && allowed < 1
            ? `No action points left — end the day.\nMidnight is near: ${_hours(hoursLeft)} left, too few for any work.`
            : 'No action points left — end the day.';
        title += '\nClick End Day (or press Enter) to rest; the new day brings them back.';
    } else if (timeLimited) {
        title = `${ap} of ${max} action points left — the day is getting on: ${_hours(hoursLeft)} till midnight.`;
        if (ap < allowed) title += `\nThe hours left allow ${allowed}.`;
        if (night > 0) title += `\n${night} lost to the hour today (the dark pips).`;
        title += `\nEach point spent passes ${perText}; time spent walking a map costs points too.`;
    } else {
        title = `${ap} of ${max} action points left today.\nEach point spent (travel, work, trade, an audience) passes ${perText}.`;
    }
    const text = empty ? 'No AP — end the day' : `${ap} / ${max} AP`;
    return { visible: true, ap, max, allowed, timeLimited, empty, level, text, pips, title };
}

/** Refresh the chip in the top bar (cheap: touches the DOM only on change). */
export function updateAPChip(player, clock) {
    if (typeof document === 'undefined') return;
    const chip = document.getElementById('tbAP');
    if (!chip) return;
    const v = apChipView(player, clock);
    const key = v.visible ? `${v.text}|${v.pips.join(',')}|${v.title}` : 'hidden';
    if (chip._apKey === key) return;   // (kept on the element: a remounted top bar redraws)
    chip._apKey = key;
    const display = v.visible ? '' : 'none';
    if (chip.style.display !== display) chip.style.display = display;
    if (!v.visible) return;
    chip.title = v.title;
    if (chip.setAttribute) chip.setAttribute('aria-label', v.title.split('\n')[0]);
    chip.classList.toggle('tb-ap--low', v.level === 'low');
    chip.classList.toggle('tb-ap--empty', v.empty);
    chip.classList.toggle('tb-ap--late', v.timeLimited);
    const val = document.getElementById('tbAPVal');
    if (val) val.textContent = v.text;
    const pipsEl = document.getElementById('tbAPPips');
    if (pipsEl) pipsEl.innerHTML = v.pips.map(p => `<i class="tb-ap-pip tb-ap-pip--${p}"></i>`).join('');
}
