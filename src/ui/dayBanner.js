// Day banner — the dawn of each day announced across the top of the map, in
// place of a toast. A turn of the season or the year gets a larger card.
// One element, reused: fast-forwarded days update it in place, never stack.

const SEASON_ICON = { Spring: '🌱', Summer: '☀️', Autumn: '🍂', Fall: '🍂', Winter: '❄️' };

let el = null;
let hideTimer = 0;
let showSeq = 0;

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
    // Restart the animation even when a banner is already up: shown again two frames on, once
    // the style without it has been drawn (reading offsetWidth here forced a layout of the whole
    // page at every day's end)
    b.classList.remove('show');
    const seq = ++showSeq;
    const show = () => { if (seq === showSeq) b.classList.add('show'); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(show));
    else show();

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (seq === showSeq) b.classList.remove('show'); }, kind === 'day' ? 1900 : 3400);
}
