// Siege panel markup (systems/sieges.js). Pure HTML builders used by
// ActionMenu.showSiegePanel / siegeAct in ./combat.js; buttons route through
// data-am-act="siegeAct" with data-am-args='["act", "arg"]'.
import { Sieges } from '../../systems/sieges.js';

const CARD = 'background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;margin-bottom:10px;';
const MUTED = 'color:var(--text-secondary);font-size:11px;';
const BTN = 'padding:7px 10px;margin:3px 3px 0 0;border-radius:6px;cursor:pointer;font-family:var(--font-body);font-size:12px;color:#eee;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.25);';

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function _btn(label, act, arg, enabled = true, extra = '', title = '') {
    const args = JSON.stringify(arg == null ? [act] : [act, arg]);
    return `<button data-am-act="siegeAct" data-am-args='${args}' ${enabled ? '' : 'disabled'} title="${_esc(title)}" style="${BTN}${extra}${enabled ? '' : 'opacity:0.45;cursor:not-allowed;'}">${label}</button>`;
}

function _bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0));
    return `<div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;margin:2px 0 6px;"><div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div></div>`;
}

const pct = (x) => `${Math.round(x * 100)}%`;

/** The full siege panel for Sieges.describe(player, world). */
export function siegePanelHtml(player, info) {
    const s = info.siege;
    const C = Sieges.config();
    const ratio = info.army / Math.max(1, info.defense);
    let html = '<div style="max-height:520px;overflow-y:auto;font-size:12px;">';
    html += `<div style="${MUTED}margin-bottom:8px;">${_esc(s.type)}${s.kingdomName ? ` of ${_esc(s.kingdomName)}` : ' (independent)'}${s.civilWar ? ' · loyalist town in your war for the throne' : ''} · besieged since day ${s.startDay}</div>`;

    // Relief warning
    if (s.relief) {
        const r = s.relief;
        html += `<div style="${CARD}border:1px solid rgba(231,76,60,0.6);">`;
        html += r.arrived
            ? `<div style="color:#e74c3c;font-weight:bold;">🚩 ${_esc(r.name)} is here (strength ${r.strength}). Fight it or withdraw — it attacks your lines tomorrow.</div>`
            : `<div style="color:#e67e22;font-weight:bold;">🚩 ${_esc(r.name)} (strength ~${r.strength}) marches to relieve the town: ${info.reliefEta} day(s) away.</div>`;
        html += '</div>';
    }

    // The two sides
    html += `<div style="display:flex;gap:8px;margin-bottom:10px;">`;
    html += `<div style="${CARD}flex:1;margin:0;"><div style="color:#4fc3f7;font-weight:bold;margin-bottom:4px;">⛺ Your camp</div>`;
    html += `<div>Strength <strong>${info.army}</strong> · ${info.supply.units} companies</div>`;
    html += `<div>Morale ${Math.round(s.campMorale)}</div>${_bar(s.campMorale, 100, '#4fc3f7')}`;
    html += `<div>Food: needs ${info.supply.need}/day, foraged ${info.supply.forage}, packs ${info.supply.packs}</div>`;
    html += `<div style="${MUTED}">${info.campDaysLeft == null ? 'The land feeds the camp for now.' : `Packs last ~${info.campDaysLeft} day(s).`}${s.hungryDays ? ` <span style="color:#e57373;">Hungry ${s.hungryDays} day(s)!</span>` : ''}</div>`;
    if (s.campSick > 0) html += `<div style="color:#e57373;">🤒 Sickness in the camp (${s.campSick} day(s))</div>`;
    html += '</div>';
    html += `<div style="${CARD}flex:1;margin:0;"><div style="color:#e74c3c;font-weight:bold;margin-bottom:4px;">🏰 ${_esc(s.name)}</div>`;
    html += `<div>Garrison <strong>${Math.round(s.garrison)}</strong> · storm defence <strong>${info.defense}</strong></div>`;
    html += `<div>Morale ${Math.round(s.morale)}</div>${_bar(s.morale, 100, '#e74c3c')}`;
    html += `<div>Stores ${Math.round(s.stores)} days${info.storesDaysLeft != null ? ` (−${Math.round(info.eatsPerDay * 100) / 100}/day)` : ''}</div>${_bar(s.stores, s.storesStart, '#f1c40f')}`;
    html += `<div>Walls ${s.walls > 0 ? `+${pct(s.walls)} at ${Math.round(s.wallHp)}% → +${pct(info.effectiveWalls)}` : 'none'}</div>`;
    if (s.port) html += `<div style="${MUTED}">${info.navalBlockade ? '⛵ The harbour is blockaded — no food by sea.' : '⛵ Ships still bring food by sea (stores fall at half pace). Galleys or a blockading fleet would close the port.'}</div>`;
    if (s.townSick) html += `<div style="color:#e57373;">🤒 Disease rages inside the walls</div>`;
    if (s.stores <= 0) html += `<div style="color:#e57373;">The town is starving.</div>`;
    html += '</div></div>';
    html += `<div style="${MUTED}margin-bottom:8px;">Odds if you storm now: ${ratio >= 2 ? 'overwhelming' : ratio >= 1.3 ? 'favourable' : ratio >= 0.8 ? 'even' : ratio >= 0.5 ? 'poor' : 'hopeless'} (${info.army} vs ${info.defense}).</div>`;

    // Stance and works
    html += `<div style="${CARD}"><div style="font-weight:bold;color:var(--gold);margin-bottom:4px;">Today's work: ${s.stance === 'works' && s.building ? `building a ${_esc(C.works[s.building.id].name.toLowerCase())}` : s.stance === 'sap' ? 'sapping the walls' : 'tightening the blockade'}</div>`;
    const sel = (on) => (on ? 'border-color:var(--gold);color:var(--gold);' : '');
    html += _btn('🛡️ Blockade', 'stance', 'blockade', true, sel(s.stance === 'blockade'), 'Their stores fall faster and morale sinks.');
    html += _btn(`⛏️ Sap the walls (${Math.round(s.mine)}/${C.sap.days})`, 'stance', 'sap', s.walls > 0, sel(s.stance === 'sap'), `A finished mine brings down ${C.sap.breach}% of the wall. Countermines may cost a crew.`);
    html += '<div style="margin-top:6px;">';
    for (const w of info.works) {
        const label = w.built ? `${w.icon} ${_esc(w.name)} ✔` : w.building ? `${w.icon} ${_esc(w.name)} (${Math.round(w.progress)}/${w.days})` : `${w.icon} ${_esc(w.name)} — ${w.cost}g, ${w.days}d`;
        html += _btn(label, 'stance', `works:${w.id}`, !w.built && (w.can || w.building), sel(w.building && s.stance === 'works'), `${w.effect}${w.reason && !w.built ? ` (${w.reason})` : ''}`);
    }
    html += '</div></div>';

    // Actions
    const ap = player.actionPoints || 0;
    html += `<div style="${CARD}"><div style="font-weight:bold;color:var(--gold);margin-bottom:4px;">Actions <span style="${MUTED}">(${ap} AP)</span></div>`;
    html += _btn(`⚔️ Storm and hold (${C.storm.apCost} AP)`, 'storm', 'hold', ap >= C.storm.apCost, 'border-color:rgba(231,76,60,0.6);', 'A costly assault: walls still standing cost extra men.');
    html += _btn(`🔥 Storm and sack (${C.storm.apCost} AP)`, 'storm', 'sack', ap >= C.storm.apCost, 'border-color:rgba(230,126,34,0.6);', `Loot the town and leave it burning: karma ${C.sack.karma}, cruel deeds.`);
    if (s.relief && s.relief.arrived) html += _btn(`🚩 Fight the relief host (${C.storm.apCost} AP)`, 'relief', null, ap >= C.storm.apCost, 'border-color:rgba(231,76,60,0.6);');
    html += '<div style="margin-top:6px;">';
    const t = info.terms;
    const termLabel = {
        surrender: `🏳️ Demand surrender, safe passage (${pct(info.chances.surrender)})`,
        ransom: `💰 Ransom ${t.ransom}g (${pct(info.chances.ransom)})`,
        tribute: `📜 Tribute ${t.tributeUpfront}g + ${t.tributeWeekly}g/week × ${t.tributeWeeks} (${pct(info.chances.tribute)})`,
    };
    for (const term of Sieges.TERMS) {
        html += _btn(termLabel[term], 'terms', term, info.canParley && ap >= C.terms.apCost, '', `${C.terms.apCost} AP. Their morale, hunger, your strength, diplomacy, traits and court reputation weigh in.`);
    }
    if (!info.canParley) html += `<div style="${MUTED}">They will not parley again until day ${s.nextParleyDay}.</div>`;
    html += '</div><div style="margin-top:8px;">';
    html += _btn('⏳ Hold the siege (end day)', 'wait', null, true, 'border-color:rgba(79,195,247,0.6);');
    html += _btn('🏳️ Lift the siege', 'lift', null, true);
    html += '</div></div>';

    // Log
    if (s.log && s.log.length) {
        html += `<div style="${CARD}"><div style="font-weight:bold;margin-bottom:4px;">Siege journal</div>`;
        for (const e of s.log.slice().reverse()) html += `<div style="${MUTED}">Day ${e.day}: ${_esc(e.text)}</div>`;
        html += '</div>';
    }
    html += '</div>';
    return html;
}

/** Result of a storm, parley or relief battle. */
export function siegeResultHtml(result, extrasHtml, ongoing) {
    let html = '<div style="padding:10px;font-size:13px;line-height:1.6;">';
    if (result.message) html += `<div>${_esc(result.message)}</div>`;
    if (result.outcome && result.outcome.text) html += `<div style="color:var(--gold);">${_esc(result.outcome.text)}</div>`;
    if (result.plunder) html += `<div>💰 Plunder: <strong style="color:#ffd700;">${result.plunder}</strong></div>`;
    if (result.gold) html += `<div>💰 Gold received: <strong style="color:#ffd700;">${result.gold}</strong></div>`;
    if (result.renownChange) html += `<div>⭐ Renown +${result.renownChange}</div>`;
    if (result.karmaChange) html += `<div style="color:#ff6666;">😈 Karma ${result.karmaChange}</div>`;
    if (result.casualties > 0) html += `<div style="color:#ff9800;">⚠️ Soldiers lost: ${result.casualties}</div>`;
    if (result.stormLosses > 0) html += `<div style="color:#ff9800;">🧗 Lost on the walls: ${result.stormLosses}</div>`;
    if (result.capitalCaptured) html += `<div style="color:#bb86fc;">👑 You hold their capital!${result.kingdomDestroyed ? ' The kingdom has fallen.' : ''}${result.throneClaim ? ` A claim on the throne (strength ${result.throneClaim}).` : ''}</div>`;
    if (result.captured) html += `<div style="color:#ff6666;">⛓️ You are captured into servitude for ${result.servitudeDays} days.</div>`;
    if (result.chance != null && result.accepted === false) html += `<div style="color:var(--text-secondary);">They refused (chance was ${Math.round(result.chance * 100)}%). Their spirits rise a little.</div>`;
    html += extrasHtml || '';
    html += ongoing
        ? '<button data-am-act="showSiegePanel" style="width:100%;padding:10px;margin-top:10px;background:#444;border:1px solid #666;border-radius:6px;color:#eee;cursor:pointer;">Back to the siege</button>'
        : '<button data-am-act="closePanelAndRefresh" style="width:100%;padding:10px;margin-top:10px;background:#444;border:1px solid #666;border-radius:6px;color:#eee;cursor:pointer;">Continue</button>';
    html += '</div>';
    return html;
}
