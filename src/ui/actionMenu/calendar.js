// ActionMenu — the Calendar: today's date and the days played, the year as a
// grid of four seasons of thirty days (today, the lean weeks, the fairs, the
// harvest, the seasons' turns and your own deadlines marked on it), and what
// is coming up. Opened from the bottom bar's date and Journal → Calendar.
// The dates come from systems/calendar.js.
import { ActionMenu } from './_ref.js';
import { Calendar } from '../../systems/calendar.js';
import { CARD, esc } from './uiKit.js';
import { Dawn } from '../../world/dawn.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const SEASON_TINT = { Spring: '#7bd88f', Summer: '#f5c542', Autumn: '#e08a3c', Winter: '#8fc4ff' };
const KIND_TINT = { fair: 'rgba(224,138,60,0.35)', lean: 'rgba(120,140,200,0.22)' };
const SHOWN_AHEAD = 60;
const SHOWN_ROWS = 16;

const _n = (v) => Math.round(v).toLocaleString();

/** "10 years, 34 days" from a count of days. */
function _span(days, perYear) {
    const y = Math.floor(days / perYear);
    const d = days % perYear;
    const parts = [];
    if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
    if (d || !y) parts.push(`${d} day${d === 1 ? '' : 's'}`);
    return parts.join(', ');
}

/** The date of a world day: { day, dayInSeason, season, year, ... }. */
function _dateOf(world, day) {
    return Calendar.date({ day, baseYear: world.baseYear });
}

/** "Day 12 of Summer" for a world day. */
function _short(world, day) {
    const d = _dateOf(world, day);
    return `Day ${d.dayInSeason} of ${d.season}`;
}

function _when(inDays) {
    return inDays === 0 ? 'today' : inDays === 1 ? 'tomorrow' : `in ${inDays} days`;
}

/** The year as four rows of thirty days. */
function _grid(world, today, marks, mine) {
    const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
    const yearStart = today.day - today.dayOfYear + 1;
    // This year's own deadlines, by day of the year
    const minePerDoy = {};
    for (const e of mine) {
        const doy = e.day - yearStart + 1;
        if (doy >= 1 && doy <= today.daysInYear) (minePerDoy[doy] = minePerDoy[doy] || []).push(e);
    }
    let html = '<div style="display:flex; flex-direction:column; gap:3px; margin:6px 0;">';
    seasons.forEach((season, si) => {
        html += `<div style="display:flex; align-items:center; gap:4px;">`;
        html += `<div style="width:62px; font-size:11px; color:${SEASON_TINT[season]}; font-weight:bold;">${esc(season)}</div>`;
        html += '<div style="display:grid; grid-template-columns:repeat(30, 1fr); gap:2px; flex:1;">';
        for (let d = 1; d <= today.daysInSeason; d++) {
            const doy = si * today.daysInSeason + d;
            const on = Calendar.marksOn(doy, marks);
            const own = minePerDoy[doy] || [];
            const isToday = doy === today.dayOfYear;
            const past = doy < today.dayOfYear;
            const tint = on.find(m => KIND_TINT[m.kind]);
            const bg = tint ? KIND_TINT[tint.kind] : 'rgba(255,255,255,0.05)';
            const dot = own.length ? '#e57373' : on.some(m => !KIND_TINT[m.kind]) ? '#f5c542' : null;
            const tip = [`Day ${d} of ${season} (day ${doy} of the year)`, ...on.map(m => `${m.icon} ${m.text}`), ...own.map(e => `${e.icon} ${e.text}`)].join('\n');
            html += `<div title="${esc(tip)}" style="position:relative; height:16px; border-radius:2px; background:${bg};`
                + `${isToday ? ' outline:2px solid var(--gold); outline-offset:0; z-index:1;' : ''}${past ? ' opacity:0.4;' : ''}`
                + ' font-size:8px; line-height:16px; text-align:center; color:#ccc;">'
                + `${d === 1 || d % 5 === 0 || isToday ? d : ''}`
                + (dot ? `<span style="position:absolute; right:1px; top:1px; width:4px; height:4px; border-radius:50%; background:${dot};"></span>` : '')
                + '</div>';
        }
        html += '</div></div>';
    });
    html += '</div>';
    html += `<div style="${NOTE} display:flex; flex-wrap:wrap; gap:10px; margin-bottom:4px;">`
        + '<span><span style="display:inline-block; width:10px; height:10px; outline:2px solid var(--gold); margin-right:4px;"></span>today</span>'
        + `<span><span style="display:inline-block; width:10px; height:10px; background:${KIND_TINT.fair}; margin-right:4px;"></span>fair</span>`
        + `<span><span style="display:inline-block; width:10px; height:10px; background:${KIND_TINT.lean}; margin-right:4px;"></span>lean weeks</span>`
        + '<span><span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#f5c542; margin-right:4px;"></span>the year\'s days</span>'
        + '<span><span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#e57373; margin-right:4px;"></span>your deadlines</span>'
        + '<span>Hover a day for what falls on it.</span></div>';
    return html;
}

Object.assign(ActionMenu, {
    /** The Calendar panel. */
    showCalendar(game) {
        if (!game || !game.world || !game.ui) return;
        const { world, player } = game;
        const today = Calendar.date(world);
        const played = Calendar.daysPlayed(world);
        const marks = Calendar.yearMarks();
        const mine = Calendar.upcoming(world, player, today.daysInYear * 20);

        let html = '<div style="max-height:var(--panel-max-h, 560px); overflow-y:auto; min-width:440px;">';
        html += `<div style="${CARD} display:flex; justify-content:space-between; align-items:center; gap:12px;">`;
        html += `<div><div style="font-family:var(--font-display); font-size:18px; color:var(--gold);">${today.icon} ${esc(Calendar.label(world))}</div>`;
        html += `<div style="${NOTE}">Day ${today.dayOfYear} of ${today.daysInYear} of the year · day ${today.dayInSeason} of ${today.daysInSeason} of ${esc(today.season)}${today.lean ? ' · the lean weeks' : ''}</div></div>`;
        html += `<div style="text-align:right;"><div style="font-size:16px; font-weight:bold;">${_n(played)}</div><div style="${NOTE}">days played (${esc(_span(played, today.daysInYear))})</div>`;
        if (player && Number.isFinite(player.age)) html += `<div style="${NOTE}">${esc(player.name || 'You')}: age ${player.age}</div>`;
        html += '</div></div>';

        // A world begun at the Dawn of Man names its age (world/dawn.js)
        const era = Dawn.eraName(world);
        html += `<div style="font-weight:bold; color:var(--gold); font-size:13px; margin-top:6px;">📅 Year ${today.year}${era ? ` <span style="${NOTE} font-weight:normal;">· ${esc(era.charAt(0).toUpperCase() + era.slice(1))}</span>` : ''}</div>`;
        html += _grid(world, today, marks, mine);

        // Your own matters first on a shared day, then the year's
        const ahead = [...Calendar.upcoming(world, player, SHOWN_AHEAD).map(e => ({ ...e, own: true })), ...Calendar.yearAhead(world, SHOWN_AHEAD)]
            .sort((a, b) => a.day - b.day || (a.own ? 0 : 1) - (b.own ? 0 : 1));
        html += `<div style="${CARD}"><div style="font-weight:bold; color:var(--gold); font-size:13px; margin-bottom:4px;">⏭️ Coming up (next ${SHOWN_AHEAD} days)</div>`;
        if (!ahead.length) html += `<div style="${NOTE}">Nothing marked in the next ${SHOWN_AHEAD} days.</div>`;
        for (const e of ahead.slice(0, SHOWN_ROWS)) {
            html += '<div style="display:flex; gap:8px; align-items:baseline; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.05);">'
                + `<span style="width:92px; flex:none; ${NOTE}">${esc(_when(e.inDays))}</span>`
                + `<span style="flex:1; font-size:12px; color:${e.own ? '#f2c4c4' : '#ddd'};">${esc(e.icon)} ${esc(e.text)}</span>`
                + `<span style="${NOTE} white-space:nowrap;">${esc(_short(world, e.day))}</span></div>`;
        }
        if (ahead.length > SHOWN_ROWS) html += `<div style="${NOTE} margin-top:4px;">…and ${ahead.length - SHOWN_ROWS} more.</div>`;
        html += '</div>';

        // Deadlines further off than the list shows (a child's coming of age, a regency's end)
        const later = mine.filter(e => e.inDays > SHOWN_AHEAD);
        if (later.length) {
            html += `<div style="${CARD}"><div style="font-weight:bold; color:var(--gold); font-size:13px; margin-bottom:4px;">🔭 Further off</div>`;
            for (const e of later.slice(0, 8)) {
                const yr = _dateOf(world, e.day).year;
                html += `<div style="font-size:12px; padding:1px 0;">${esc(e.icon)} ${esc(e.text)} <span style="${NOTE}">· ${esc(_short(world, e.day))}, Year ${yr}</span></div>`;
            }
            html += '</div>';
        }
        html += `<div style="${NOTE}">A year is ${today.daysInYear} days: four seasons of ${today.daysInSeason}. Everyone ages on the year's last day.</div>`;
        html += '</div>';
        game.ui.showCustomPanel('📅 Calendar', html);
    },
});
