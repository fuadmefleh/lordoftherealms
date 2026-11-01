// ============================================
// PRESTIGE CHIP — the House's standing on the top bar
// ============================================
// A compact counter beside Gold / Renown / Military Strength
// (components/TopBar.jsx #tbPrestige): the House's Prestige (systems/house.js),
// its trend over the last month (the prestigeLog), and a tooltip with the
// current Ambition and how far along it is. A click opens the House panel
// (ActionMenu.showHousePanel, wired in ui/ui/hud.js _setupHudNav). Hidden
// while there is no House (the interregnum, before the game is set up).
//
// It lives in the top bar and so inherits the HUD's --ui-zoom; it sets no
// viewport sizes or pixel positions of its own — the tooltip is the native
// title attribute.

import { House } from '../systems/house.js';

const TREND_DAYS = 30;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * What the chip shows, as plain data (no DOM):
 * { visible, value, trend, trendText, negative, ambition, title }.
 */
export function prestigeChipView(player, world) {
    const house = player && player.house;
    if (!house || player.interregnum) return { visible: false, value: 0, trend: 0, trendText: '', negative: false, ambition: null, title: '' };
    const day = _num(world && world.day);
    const value = Math.round(_num(house.prestige));
    const log = Array.isArray(house.prestigeLog) ? house.prestigeLog : [];
    const trend = Math.round(log.filter(e => e && day - _num(e.day) < TREND_DAYS).reduce((s, e) => s + _num(e.delta), 0));
    const trendText = `${trend >= 0 ? '+' : '−'}${Math.abs(trend)}/mo`;

    let ambition = null;
    if (house.ambition && house.ambition.id) {
        const def = House._getAmbitionDef(house.ambition.id);
        const ms = Array.isArray(house.ambition.milestones) ? house.ambition.milestones : [];
        ambition = {
            id: house.ambition.id,
            name: (def && def.name) || house.ambition.id,
            done: ms.filter(m => m && m.done).length,
            total: ms.length,
            capstoneDone: !!house.ambition.capstoneDone,
        };
    }
    const lines = [
        `${house.name || 'Your House'} — Prestige ${value}`,
        `Last ${TREND_DAYS} days: ${trend >= 0 ? '+' : '−'}${Math.abs(trend)}`,
        ambition
            ? `Ambition: ${ambition.name} (${ambition.capstoneDone ? 'fulfilled' : `${ambition.done}/${ambition.total} milestones`})`
            : 'Ambition: none chosen',
        'Click to open the House',
    ];
    return { visible: true, value, trend, trendText, negative: trend < 0, ambition, title: lines.join('\n') };
}

/** Refresh the chip in the top bar (cheap: touches the DOM only on change). */
export function updatePrestigeChip(player, world) {
    if (typeof document === 'undefined') return;
    const chip = document.getElementById('tbPrestige');
    if (!chip) return;
    const v = prestigeChipView(player, world);
    const display = v.visible ? '' : 'none';
    if (chip.style.display !== display) chip.style.display = display;
    if (!v.visible) return;
    if (chip.title !== v.title) chip.title = v.title;
    const val = document.getElementById('tbPrestigeVal');
    if (val && val.textContent !== String(v.value)) val.textContent = String(v.value);
    const sub = document.getElementById('tbPrestigeTrend');
    if (sub) {
        if (sub.textContent !== v.trendText) sub.textContent = v.trendText;
        sub.classList.toggle('negative', v.negative);
    }
}
