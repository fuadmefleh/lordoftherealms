// Day banner — the dawn of each day announced across the top of the map, in
// place of a toast. A turn of the season or the year gets a larger card.
// One element, reused: fast-forwarded days update it in place, never stack.

const SEASON_ICON = { Spring: '🌱', Summer: '☀️', Autumn: '🍂', Fall: '🍂', Winter: '❄️' };

let el = null;
let hideTimer = 0;

function ensure() {
    if (el && document.body.contains(el)) return el;
    el = document.createElement('div');
    el.id = 'dayBanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="day-banner-kicker"></div><div class="day-banner-title"></div><div class="day-banner-rule"></div>';
    document.body.appendChild(el);
    return el;
}

/**
 * @param {object} o
 * @param {number} o.dayOfSeason  1-based day within the season
 * @param {string} o.season
 * @param {number} o.year
 * @param {'day'|'season'|'year'} [o.kind='day']
 */
export function showDayBanner({ dayOfSeason, season, year, kind = 'day' }) {
    const b = ensure();
    const icon = SEASON_ICON[season] || '☀️';
    const kicker = b.querySelector('.day-banner-kicker');
    const title = b.querySelector('.day-banner-title');

    if (kind === 'year') {
        kicker.textContent = `${icon} A new year dawns`;
        title.textContent = `The Year ${year}`;
    } else if (kind === 'season') {
        kicker.textContent = `Year ${year}`;
        title.textContent = `${icon} ${season} comes`;
    } else {
        kicker.textContent = `${season} · Year ${year}`;
        title.textContent = `Day ${dayOfSeason}`;
    }

    b.className = `kind-${kind}`;
    // Restart the animation even when a banner is already up
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => b.classList.remove('show'), kind === 'day' ? 1900 : 3400);
}
