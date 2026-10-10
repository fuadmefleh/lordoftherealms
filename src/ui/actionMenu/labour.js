// ActionMenu — the People of a town: its classes, hands, wages and welfare,
// refugees and strikes, and the hands the player hires there (opened from
// the trade window, the holdings panel and the Counsel). Logic lives in
// world/townLabour.js and systems/labour.js; this presents it.
import { ActionMenu } from './_ref.js';
import { TownLabour } from '../../world/townLabour.js';
import { Labour } from '../../systems/labour.js';
import { CARD } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const SECTOR = { land: '🌾 Land, mines & hauling', craft: '🔨 Trades & works', trade: '⚖️ Trade' };

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${Math.round(v * 100)}%`;

function bar(v, color) {
    const w = Math.max(0, Math.min(100, Math.round(v * 100)));
    return `<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin-top:2px;"><div style="width:${w}%; height:100%; background:${color};"></div></div>`;
}

/** A short line for other panels: welfare, idle hands, the craft wage. */
export function peopleLine(settlement, day = null) {
    const sum = TownLabour.summary(settlement, day);
    if (!sum) return '';
    const wl = TownLabour.welfareLabel(sum.welfare);
    const craft = sum.sectors.find(x => x.id === 'craft');
    const parts = [`<span style="color:${wl.color};">${wl.label}</span>`];
    parts.push(`${pct(sum.idle)} idle`);
    if (craft) parts.push(`artisans ${craft.wage.toFixed(2)}g/day`);
    if (sum.refugees >= 20) parts.push(`<span style="color:#e8a040;">${sum.refugees} refugees</span>`);
    if (sum.strike) parts.push('<span style="color:#e74c3c;">on strike</span>');
    return parts.join(' · ');
}

/** The full panel body for a settlement (exported for tests). */
export function peopleHtml(game, settlement, q, r) {
    const { player, world } = game;
    const day = world.day;
    const sum = TownLabour.summary(settlement, day);
    if (!sum) return '<div style="color:#aaa;">No one has counted the people here yet. Come back after market day.</div>';
    const wl = TownLabour.welfareLabel(sum.welfare);
    let html = `<p style="margin:0 0 6px; color:var(--text-secondary);">${esc(settlement.name)} · ${esc(settlement.type)} · ${Math.round(settlement.population || 0).toLocaleString()} people · <b style="color:${wl.color};">${wl.label}</b> (${Math.round(sum.welfare * 100)})${sum.mood ? ` · mood ${sum.mood > 0 ? '+' : ''}${sum.mood.toFixed(1)}` : ''}</p>`;
    if (sum.strike) html += `<div style="${CARD} border-color:#c0392b;">✊ <b>The artisans are on strike</b> until day ${sum.strike}: the trades and the works stand idle.</div>`;

    // ── The classes ──
    html += `<div style="${CARD}"><b>The people</b>`;
    for (const st of sum.strata) {
        const l = TownLabour.welfareLabel(st.welfare);
        html += `<div style="display:grid; grid-template-columns: 1fr 70px 110px; gap:6px; align-items:center; margin-top:4px;">
            <span>${st.icon} ${esc(st.name)}</span><span style="text-align:right;">${st.count.toLocaleString()} <small style="color:#999;">${pct(st.share)}</small></span>
            <span><small style="color:${l.color};">${l.label}</small>${bar(st.welfare, l.color)}</span></div>`;
    }
    html += `<div style="${NOTE} margin-top:4px;">Nobles and merchants buy wine, spices and fine cloth; peasants grain, beer and firewood. Each class's welfare — its basket met, work, the wage against the price of bread, safety and taxes — draws people between towns.</div></div>`;

    // ── Work and wages ──
    html += `<div style="${CARD}"><b>Work and wages</b>`;
    for (const sec of sum.sectors) {
        const short = sec.fill < 0.97;
        const color = short ? '#e8a040' : sec.idle > 0.08 ? '#e67e22' : '#9fd59f';
        const wageRel = sec.base > 0 ? sec.wage / sec.base : 1;
        html += `<div style="margin-top:4px;">${SECTOR[sec.id]}: <b>${sec.hands.toLocaleString()}</b> hands for ${sec.jobs.toLocaleString()} places · <span style="color:${color};">${short ? `short of hands (${pct(sec.fill)} filled)` : `${pct(sec.idle)} idle`}</span> · wage <b>${sec.wage.toFixed(2)}g</b> a day <small style="color:#999;">(${wageRel >= 1 ? '+' : ''}${Math.round((wageRel - 1) * 100)}% on the usual)</small></div>`;
    }
    const crimeColor = sum.crime > 0.3 ? '#e74c3c' : sum.crime > 0.1 ? '#e8a040' : '#9fd59f';
    html += `<div style="margin-top:6px;">Crime <b style="color:${crimeColor};">${Math.round(sum.crime * 100)}</b> · danger ${Math.round(sum.danger * 100)}${sum.refugees ? ` · ${sum.refugees} refugees` : ''} · last week ${sum.moved.in || 0} came, ${sum.moved.out || 0} left</div>`;
    html += `<div style="${NOTE}">A town short of hands makes and reaps less, and its wages climb; idle hands breed thieves and unrest and sour the mood.</div></div>`;

    // ── The player's hands here ──
    const mine = [];
    const works = settlement.market && settlement.market.works;
    for (const [id, w] of Object.entries(works || {})) {
        if (!w || w.owner !== 'player') continue;
        mine.push(`works (${esc(id)}, level ${w.lvl}): ${TownLabour.worksHands(id, w.lvl)} artisans`);
    }
    for (const ref of player.properties || []) {
        const t = world.getTile(ref.q, ref.r);
        const prop = t && Array.isArray(t.playerProperties) ? t.playerProperties.find(x => x && x.type === ref.type) : null;
        const hire = prop && prop.hire;
        if (!hire || hire.q !== q || hire.r !== r) continue;
        mine.push(`${esc(prop.name || ref.type)}: ${hire.hands} ${hire.sector === 'craft' ? 'artisans' : 'labourers'} at ${Number(hire.wage || 0).toFixed(2)}g (${pct(hire.fill)} staffed)`);
    }
    if (mine.length) html += `<div style="${CARD}"><b>Your hands here</b><div style="${NOTE}">${mine.join('<br>')}</div></div>`;

    // ── News ──
    const news = Labour.recent(world, 40).slice(0, 4);
    if (news.length) {
        html += `<div style="${CARD}"><b>Word on the roads</b><div style="${NOTE}">`;
        html += news.map(n => n.kind === 'refugees' ? `Day ${n.day}: ${n.n} fled ${esc(n.place)} for ${esc(n.to)}.`
            : n.kind === 'strike' ? `Day ${n.day}: the artisans of ${esc(n.place)} struck.`
                : `Day ${n.day}: ${esc(n.place)} is booming.`).join('<br>');
        html += '</div></div>';
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The People panel for the settlement on `tile` (or at q, r; the player's own tile by default). */
    showTownPeople(game, tile = null, q = null, r = null) {
        const world = game.world;
        let t = tile && typeof tile === 'object' ? tile : null;
        if (!t && Number.isFinite(q) && Number.isFinite(r)) t = world.getTile(q, r);
        if (!t) t = world.getTile(game.player.q, game.player.r);
        const s = t && t.settlement;
        if (!s) {
            game.ui.showNotification('No Town', 'There are no townsfolk here to count.', 'info');
            return;
        }
        const html = `<div style="font-size:12px; max-height:620px; overflow-y:auto;">${peopleHtml(game, s, t.q, t.r)}</div>`;
        game.ui.showCustomPanel(`👥 The People of ${s.name}`, html);
    },
});
