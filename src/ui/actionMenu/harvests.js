// ActionMenu — the Harvest panel: the coming harvest where the player stands
// and what the crop reports say of the other regions, the town's fields (crop
// mix and soil), the harvests reckoned, and the player's farms with their
// rotation. Opened from the trade window and the Counsel. Logic lives in
// world/harvests.js; this presents it. Buttons route through data-am-act →
// ActionMenu.harvestAct.
import { ActionMenu } from './_ref.js';
import { Harvests } from '../../world/harvests.js';
import { Seasons } from '../../world/seasons.js';
import { Engrossing } from '../../systems/engrossing.js';
import { BTN_GOLD, BTN_DIM, CARD } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const CROP_LABEL = { grain: '🌾 Grain', veg: '🥕 Vegetables & legumes', fibre: '🌿 Flax', vine: '🍇 Vines & orchards', fallow: '🐑 Fallow & hay' };

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${Math.round(v * 100)}%`;
const tone = (v) => (v < 0.85 ? '#e74c3c' : v > 1.1 ? '#5fbf6a' : 'var(--text-primary)');

function act(label, args, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="harvestAct" data-am-args='${esc(JSON.stringify(args))}' style="${BTN_GOLD}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function hereHtml(game, tile) {
    const { world, player } = game;
    const id = Harvests.regionOf(world, tile ? tile.q : player.q, tile ? tile.r : player.r);
    const f = Harvests.forecast(world, id);
    const name = Harvests.regionName(world, id);
    if (!f) return `<div style="${CARD}"><b>${esc(name)}</b><div style="${NOTE}">No harvest is reckoned here yet: the fields are sown at the turn of the year.</div></div>`;
    const doy = Seasons.dayOfYear(world.day);
    let html = `<div style="${CARD}"><div><b>${esc(name)}</b> · ${f.settled ? `the harvest of year ${f.year + 1} is in` : `the crop of year ${f.year + 1} in the fields (day ${doy} of the year)`}: <b style="color:${tone(f.est)};">${pct(f.est)}</b> of a normal year${f.settled ? '' : ` · ${pct(f.conf)} of the season seen`}</div>`;
    const parts = [`weather ${pct(f.weather)}`];
    if (f.war > 0.005) parts.push(`war −${pct(f.war)}`);
    for (const b of f.blights || []) parts.push(`<span style="color:#e74c3c;">${esc(Harvests.blightName(b))}</span>`);
    html += `<div style="${NOTE}">${parts.join(' · ')}</div>`;
    if (f.yields) html += `<div style="${NOTE}">Grain ${pct(f.yields.grain)} · vegetables ${pct(f.yields.veg)} · flax ${pct(f.yields.fibre)} · vines ${pct(f.yields.vine)} · herds ${pct(f.yields.stock)}</div>`;
    return html + '</div>';
}

function townHtml(game, tile) {
    const s = tile && tile.settlement;
    const farm = s && s.farm;
    if (!farm || !farm.mix) return '';
    const y = Harvests.townYield(s);
    const reaped = Harvests.townHarvestYear(s);
    const f = Harvests.forecast(game.world, Harvests.regionOfTown(game.world, s));
    let html = `<div style="${CARD}"><div><b>The fields of ${esc(s.name)}</b> · soil ${pct(farm.soil || 1)}</div>`;
    html += `<div style="${NOTE}">Sown this year: ${Harvests.CROPS.map(c => `${CROP_LABEL[c]} ${pct(farm.mix[c] || 0)}`).join(' · ')}</div>`;
    // The yields are the town's last reckoned harvest — the grain now in its
    // markets — not the crop in the fields; say which year each figure is.
    if (reaped == null) {
        html += `<div style="${NOTE}">No harvest reaped here yet: the markets sell at a normal year's grain.</div>`;
    } else {
        html += `<div style="${NOTE}"><b>Last harvest (year ${reaped + 1}), now in the markets:</b> ${Harvests.CROPS.filter(c => c !== 'fallow').map(c => `${CROP_LABEL[c]} ${pct(y[c])}`).join(' · ')} · grain to market ×${Harvests.grainFactor(s).toFixed(2)}</div>`;
    }
    if (f && !f.settled) {
        html += `<div style="${NOTE}"><b>This year's crop (year ${f.year + 1}), still in the fields:</b> the region's forecast <b style="color:${tone(f.est)};">${pct(f.est)}</b>${f.yields ? ` · grain ${pct(f.yields.grain)}` : ''} · it reaches the markets at the reckoning.</div>`;
    }
    const loft = Engrossing.held(s);
    if (loft >= 1) html += `<div style="${NOTE}">🏚️ The grain dealers hold ${Math.round(loft)} grain in their lofts, bought against a poor harvest, to sell when bread is dearest.</div>`;
    else if (s.kingdom != null && Engrossing.banned(game.world, s.kingdom)) html += `<div style="${NOTE}">📜 An edict of the crown forbids engrossing grain here.</div>`;
    html += '<div style="' + NOTE + '">The farmers sow more of what sells dear here and what the climate favours; over-cropping thins the soil, fallow and legumes restore it.</div></div>';
    return html;
}

function reportsHtml(game) {
    const known = Harvests.known(game.player, game.world);
    if (!known.length) return `<div style="${NOTE}">No crop reports yet. Market towns post them weekly from late spring; you see your own region's fields wherever you stand.</div>`;
    let html = `<div style="${CARD}"><div><b>📜 Crop reports</b></div>`;
    for (const k of known.slice(0, 14)) {
        const age = game.world.day - (k.day || 0);
        html += `<div style="${NOTE}"><b style="color:${tone(k.est)};">${pct(k.est)}</b> ${esc(k.name)}${k.settled ? ' (in)' : ''}${(k.blights || []).length ? ` · ${k.blights.map(b => esc(Harvests.blightName(b))).join(', ')}` : ''} · ${k.src === 'local' ? 'seen' : 'reported'} ${age <= 0 ? 'today' : `${age} day(s) ago`}</div>`;
    }
    return html + `<div style="${NOTE}">A failing harvest means dear bread there by spring: grain bought cheap now and carried in sells well. A bumper one gluts its markets.</div></div>`;
}

function farmsHtml(game) {
    const { player, world } = game;
    const C = Harvests.config();
    const rows = [];
    for (const ref of player.properties || []) {
        if (!ref || !C.propertyCrops[ref.type]) continue;
        const tile = world.getTile(ref.q, ref.r);
        const prop = tile && Array.isArray(tile.playerProperties) ? tile.playerProperties.find(p => p && p.type === ref.type) : null;
        if (!prop) continue;
        const herd = C.propertyCrops[ref.type] === 'stock';
        const rot = Harvests.rotation(prop);
        let row = `<div style="${CARD}"><div><b>${esc(prop.name || ref.type)}</b> at (${ref.q}, ${ref.r}) · this year's harvest ×${Harvests.propertyFactor(world, tile, prop).toFixed(2)}${herd ? '' : ` · soil ${pct(prop.soil || 1)} · ${esc(rot.label)}`}</div>`;
        if (!herd) {
            row += `<div style="${NOTE}">${esc(rot.note || '')}</div><div>`;
            for (const [id, r] of Object.entries(C.rotations)) {
                row += act(`${esc(r.label)} (×${r.yield}, soil → ${pct(r.soil)})`, ['rotation', ref.q, ref.r, ref.type, id], id !== rot.id, id === rot.id ? 'The rotation it follows' : '');
            }
            row += '</div>';
        }
        rows.push(row + '</div>');
    }
    if (!rows.length) return '';
    return `<div style="margin-top:6px;"><b>Your farms</b></div>${rows.join('')}`;
}

Object.assign(ActionMenu, {
    /** The Harvest panel for the region of `tile` (the player's own tile by default). */
    showHarvests(game, tile = null) {
        const world = game.world;
        const t = tile && typeof tile === 'object' ? tile : world.getTile(game.player.q, game.player.r);
        const html = `<div style="font-size:12px; max-height:620px; overflow-y:auto;">${hereHtml(game, t)}${townHtml(game, t)}${reportsHtml(game)}${farmsHtml(game)}</div>`;
        game.ui.showCustomPanel('🌾 The Harvest', html);
    },

    /** The panel's buttons: op + its arguments. */
    harvestAct(game, op, a = null, b = null, c = null, d = null) {
        const { player, world } = game;
        let res = null;
        if (op === 'rotation') res = Harvests.setRotation(player, world, a, b, c, d);
        if (res) game.ui.showNotification('🌾 Harvest', res.message, res.success ? 'success' : 'error');
        ActionMenu.showHarvests(game, world.getTile(player.q, player.r));
    },
});
