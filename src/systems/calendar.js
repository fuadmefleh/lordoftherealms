// ============================================
// CALENDAR — what day it is, and what the year holds
// ============================================
// A year is 120 days of four 30-day seasons (world/seasons.js). This module
// reads the date and gathers the days worth marking:
//   date(world)              today: day of the chronicle, of the year and of
//                            the season, the season and the year
//   daysPlayed(world)        days since the chronicle began (world.day 1)
//   yearMarks()              what every year holds, by day of the year: the
//                            fairs (systems/marketFairs.js), the lean weeks,
//                            the harvest coming in (world/harvests.js), the
//                            famine reckoning, the seasons' turns (each one a
//                            Season's Reckoning) and the day the family ages
//   upcoming(world, player)  the player's own dated matters ahead, soonest
//                            first: letters awaiting an answer, promises,
//                            petitions, ultimatums, quest deadlines, plots
//                            uncovered, children coming of age, a regency's
//                            end, birthdays
// Pure reads of other systems' state: no state of its own, no randomness.
// The panel is ui/actionMenu/calendar.js.

import { Seasons } from '../world/seasons.js';
import { MarketFairs } from './marketFairs.js';
import { CourtLetters } from './courtLetters.js';
import { Petitions } from './petitions.js';
import { Schemes } from './schemes.js';
import { Regency } from './regency.js';
import { Relationships } from './relationships.js';
import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _day = (world) => Math.max(1, Math.floor(_num(world && world.day, 1)));

/** Read one source; a broken or absent system marks nothing rather than breaking the calendar. */
function _safe(fn) {
    try {
        return fn() || [];
    } catch (e) {
        return [];
    }
}

export const Calendar = {
    /** Today: { day, year, season, icon, dayOfYear, dayInSeason, daysInYear, daysInSeason, lean }. */
    date(world) {
        const day = _day(world);
        const season = Seasons.seasonOf(day);
        // As World.advanceDay counts it: baseYear + whole years since day 1
        const yearsIn = Math.floor((day - 1) / Seasons.DAYS_PER_YEAR);
        const year = world && Number.isFinite(world.baseYear) ? world.baseYear + yearsIn
            : world && Number.isFinite(world.year) ? world.year : 1 + yearsIn;
        return {
            day, year, season, icon: Seasons.ICONS[season] || '',
            dayOfYear: Seasons.dayOfYear(day), dayInSeason: Seasons.dayInSeason(day),
            daysInYear: Seasons.DAYS_PER_YEAR, daysInSeason: Seasons.DAYS_PER_SEASON,
            lean: Seasons.isLean(day),
        };
    },

    /** Days played: the days of the chronicle, counting today. */
    daysPlayed(world) {
        return _day(world);
    },

    /** "Day 21 of Spring, Year 853" */
    label(world) {
        const d = Calendar.date(world);
        return `Day ${d.dayInSeason} of ${d.season}, Year ${d.year}`;
    },

    /** The world day of the next `dayOfYear` (today counts if `today` is set). */
    nextOn(world, dayOfYear, today = false) {
        const day = _day(world);
        let d = dayOfYear - Seasons.dayOfYear(day);
        if (d < 0 || (d === 0 && !today)) d += Seasons.DAYS_PER_YEAR;
        return day + d;
    },

    /** The world day everyone in the family ages a year (Relationships.processAging, the year's last day). */
    agingDay(world) {
        const Y = Seasons.DAYS_PER_YEAR;
        return Math.floor(_day(world) / Y) * Y + Y;
    },

    /**
     * What every year holds, by day of the year:
     * [{ from, to, icon, text, kind }] (from..to inclusive, days of the year).
     */
    yearMarks() {
        const out = [];
        for (const f of _safe(() => MarketFairs.list())) {
            const len = Math.max(1, _num(f.days, 7));
            const sites = _arr(f.sites).map(s => (s === 'capital' ? 'capitals' : s === 'city' ? 'cities' : `${s}s`)).join(' and ');
            out.push({ from: f.day, to: Math.min(Seasons.DAYS_PER_YEAR, f.day + len - 1), icon: '🎪', text: `${f.name || 'Fair'}${sites ? ` in the ${sites}` : ''}`, kind: 'fair' });
        }
        const lean = (Seasons.CONFIG.lean && Seasons.CONFIG.lean.windows) || [];
        for (const [a, b] of lean) out.push({ from: a, to: b, icon: '🥣', text: 'The lean weeks: bread is dear and thin stores hurt', kind: 'lean' });
        const H = (DataLoader._gamedata && DataLoader._gamedata.harvests) || {};
        const settle = _num(H.growing && H.growing.settleDay, 60);
        out.push({ from: settle, to: settle, icon: '🌾', text: 'The harvest is in: crop reports settle and grain turns cheap', kind: 'harvest' });
        const famine = H.famine && _num(H.famine.day, null);
        if (famine != null) out.push({ from: famine, to: famine, icon: '⚖️', text: 'Granaries reckoned: a failed harvest can bring famine', kind: 'famine' });
        Seasons.NAMES.forEach((name, i) => {
            const d = i * Seasons.DAYS_PER_SEASON + 1;
            out.push({ from: d, to: d, icon: Seasons.ICONS[name] || '📅', text: `${name} begins (the Season's Reckoning)`, kind: 'season' });
        });
        out.push({ from: Seasons.DAYS_PER_YEAR, to: Seasons.DAYS_PER_YEAR, icon: '🎂', text: 'Year\'s end: you and your family each grow a year older', kind: 'birthday' });
        return out;
    },

    /** The year's marks on one day of the year. */
    marksOn(dayOfYear, marks = Calendar.yearMarks()) {
        return marks.filter(m => dayOfYear >= m.from && dayOfYear <= m.to);
    },

    /**
     * The player's dated matters from today through `ahead` days, soonest
     * first: [{ day, inDays, icon, text, kind }].
     */
    upcoming(world, player, ahead = Seasons.DAYS_PER_YEAR) {
        const today = _day(world);
        const out = [];
        const add = (day, icon, text, kind) => {
            const d = Math.floor(_num(day, NaN));
            if (!Number.isFinite(d) || d < today || d > today + ahead) return;
            out.push({ day: d, inDays: d - today, icon, text, kind });
        };
        if (!player) return out;

        // Letters awaiting an answer, and promises made in answering them
        const letters = _safe(() => [CourtLetters.view(player, world)])[0];
        if (letters) {
            for (const l of _arr(letters.open)) add(today + _num(l.daysLeft), l.icon || '✉️', `Answer ${l.from}: ${l.subject}`, 'letter');
            for (const p of _arr(letters.promises)) add(today + _num(p.daysLeft), '🤝', p.text || p.label || 'A promise falls due', 'promise');
        }
        // Petitions at court
        for (const p of _safe(() => Petitions.pending(player))) add(p.expiresDay, p.icon || '⚖️', `Petition: ${p.title || 'a matter at court'}`, 'petition');
        // Ultimatums: tribute or war
        const ult = (player.realmWars && player.realmWars.ultimatums) || {};
        for (const u of Object.values(ult)) {
            if (u) add(u.dueDay, '📜', `${u.name || 'A realm'} wants ${_num(u.tribute)} gold tribute, or war`, 'ultimatum');
        }
        // Quest deadlines
        for (const q of _arr(player.quests && player.quests.active)) {
            if (Number.isFinite(q.deadlineDay)) add(q.deadlineDay, '📌', `Quest due: ${q.title || 'a task'}`, 'quest');
        }
        // Plots the player has uncovered
        for (const s of _safe(() => Schemes.known(player))) add(s.dueDay, '🗡️', `${s.rivalName || 'A rival'}'s plot strikes: ${(s.target && s.target.label) || 'unknown'}`, 'scheme');
        // Birthdays, a regency's end, children coming of age (all on the year's last day)
        const age = (n) => Calendar.agingDay(world) + Math.max(0, n - 1) * Seasons.DAYS_PER_YEAR;
        if (Number.isFinite(player.age)) add(age(1), '🎂', `Your birthday: you turn ${player.age + 1}`, 'birthday');
        const reg = _safe(() => [Regency.view(player, world)])[0];
        if (reg && reg.active && Number.isFinite(reg.yearsLeft) && reg.yearsLeft > 0) {
            add(age(reg.yearsLeft), '👑', `You come of age at ${reg.majority}: the regency ends`, 'regency');
        }
        const minAge = _num(_safe(() => [Relationships._getHeirSettings()])[0] && Relationships._getHeirSettings().minAgeToPlay, 16);
        for (const c of _arr(player.children)) {
            if (!c || c.isAlive === false || c.isSibling || !Number.isFinite(c.age) || c.age >= minAge) continue;
            add(age(minAge - c.age), '🧒', `${c.firstName || 'Your child'} comes of age (${minAge})`, 'child');
        }
        return out.sort((a, b) => a.day - b.day || (a.text < b.text ? -1 : 1));
    },

    /**
     * The coming days of the year's marks, as dated entries like upcoming():
     * each mark's next start within `ahead` days (or today, if under way).
     */
    yearAhead(world, ahead = Seasons.DAYS_PER_YEAR) {
        const today = _day(world);
        const doy = Seasons.dayOfYear(today);
        const out = [];
        for (const m of Calendar.yearMarks()) {
            const onNow = doy >= m.from && doy <= m.to;
            const day = onNow ? today : Calendar.nextOn(world, m.from);
            if (day - today > ahead) continue;
            out.push({ day, inDays: day - today, icon: m.icon, text: onNow && m.to > m.from ? `${m.text} (until day ${m.to} of the year)` : m.text, kind: m.kind, now: onNow });
        }
        return out.sort((a, b) => a.day - b.day || (a.text < b.text ? -1 : 1));
    },
};
