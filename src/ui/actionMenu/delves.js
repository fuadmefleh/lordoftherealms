// ActionMenu — the Delve panel: step chamber by chamber through a great ruin
// or cave. Logic lives in systems/delves.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Delves, PlayerInventory } from './_imports.js';

const BTN = 'padding: 7px 10px; margin: 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; text-align: left; display: block; width: 100%;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_BACK = BTN + 'background: #5a3030; color: #eee;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const ODDS_COLOR = { 'very likely': '#7fd07f', likely: '#b5d77f', 'even odds': '#e0b040', risky: '#e08a50', desperate: '#e06060', certain: '#9ecbff' };

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _haulHtml(haul) {
    if (!haul) return '';
    const parts = [];
    if (haul.gold) parts.push(`💰 ${haul.gold} gold`);
    for (const [id, n] of Object.entries(haul.items || {})) parts.push(`${n} ${id.replace(/_/g, ' ')}`);
    if (haul.renown) parts.push(`⭐ ${haul.renown} renown`);
    if (haul.karma) parts.push(`🙏 ${haul.karma > 0 ? '+' : ''}${haul.karma} karma`);
    for (const f of haul.fragments || []) parts.push(`🧩 ${f}`);
    for (const m of haul.maps || []) parts.push(`🗺️ ${m}`);
    if ((haul.lore || []).length) parts.push(`📜 ${haul.lore.length} lore`);
    const bad = [];
    for (const [id, n] of Object.entries(haul.leftBehind || {})) bad.push(`${n} ${id.replace(/_/g, ' ')} left behind`);
    for (const i of haul.injuries || []) bad.push(`🩹 ${i}`);
    if (haul.curse) bad.push('🗿 cursed idol');
    if (haul.guardian) bad.push(`⚠️ ${haul.guardian} roams`);
    let html = `<div style="${CARD} border-color: rgba(245,197,66,0.3);"><div style="font-weight:bold; color:var(--gold); margin-bottom:4px;">🎒 Your Haul</div>`;
    html += `<div style="font-size:11px; color:#ddd; line-height:1.5;">${parts.length ? parts.map(_esc).join(' · ') : 'Nothing yet.'}</div>`;
    if (bad.length) html += `<div style="font-size:11px; color:#e0a070; margin-top:4px;">${bad.map(_esc).join(' · ')}</div>`;
    return html + '</div>';
}

function _statusHtml(player) {
    const free = PlayerInventory.getFreeSlots(player);
    return `<div style="display:flex; gap:10px; font-size:11px; color:#bbb; margin-bottom:6px;">` +
        `<span>❤️ ${Math.round(player.health || 0)}/${player.maxHealth || 100}</span>` +
        `<span>⚡ ${Math.max(0, player.movementRemaining || 0)} stamina</span>` +
        `<span>🎒 ${free} free slot${free === 1 ? '' : 's'}</span>` +
        (Delves.isCursed(player) ? '<span style="color:#c08080;">🗿 cursed</span>' : '') +
        '</div>';
}

function _depthBar(a) {
    let html = '<div style="display:flex; gap:3px; margin:4px 0 8px;">';
    for (let i = 0; i < a.plan.length; i++) {
        const done = i < a.index;
        const here = i === a.index;
        const deep = i === a.plan.length - 1;
        const bg = done ? 'var(--gold)' : here ? '#e0b040' : 'rgba(255,255,255,0.12)';
        html += `<div title="${deep ? 'The deep' : `Chamber ${i + 1}`}" style="flex:1; height:6px; border-radius:3px; background:${bg};${deep ? ' outline:1px solid #c0392b;' : ''}"></div>`;
    }
    return html + '</div>';
}

Object.assign(ActionMenu, {
    /**
     * The delve panel. At an undelved site it shows the entrance (AP is paid
     * on descending); during a delve it shows the current chamber's choices
     * with odds hints, or the result of the last chamber with press on /
     * turn back; at the end, the haul.
     */
    showDelvePanel(game, tile, last = null) {
        const player = game.player;
        const world = game.world;
        const a = Delves.active(player);
        let html = '<div style="max-height: 480px; overflow-y: auto; font-size: 12px;">';

        const handlers = {
            descend: () => {
                if (!ActionMenu.commitPendingAP(game)) return;
                const res = Delves.start(player, world, tile);
                if (!res.success) {
                    game.ui.showNotification('🕯️ Delve', res.reason, 'error');
                    return;
                }
                ActionMenu.showDelvePanel(game, tile);
            },
            choose: (id) => {
                const res = Delves.choose(player, world, id);
                if (!res.success) {
                    game.ui.showNotification('🕯️ Delve', res.reason, 'error');
                    return;
                }
                game.ui.updateStats(player, world);
                ActionMenu.showDelvePanel(game, tile, res);
            },
            pressOn: () => {
                const res = Delves.pressOn(player);
                if (!res.success) game.ui.showNotification('🕯️ Delve', res.reason, 'error');
                ActionMenu.showDelvePanel(game, tile);
            },
            retreat: () => {
                const res = Delves.retreat(player, world);
                game.ui.updateStats(player, world);
                if (res.abandoned) {
                    game.ui.hideCustomPanel();
                    game.ui.showNotification('🕯️ Delve', 'You think better of it and leave the depths for another day.', 'info');
                    return;
                }
                ActionMenu.showDelvePanel(game, tile, { ended: 'retreat', result: res.result, lines: [], text: '' });
            },
        };
        window._delve = handlers;

        // ── The end: show the summary
        if (last && last.ended && last.result) {
            const r = last.result;
            const titles = {
                cleared: '🏆 You reached the bottom',
                retreat: '↩️ You turned back',
                collapse: '💀 You stagger out, barely alive',
                left: '↩️ You left the depths',
            };
            if (last.text || (last.lines && last.lines.length)) {
                html += `<div style="${CARD}"><div style="color:#ddd;">${_esc(last.text)}</div>`;
                if (last.lines && last.lines.length) html += `<div style="font-size:11px; color:#bbb; margin-top:4px;">${last.lines.map(_esc).join(' · ')}</div>`;
                html += '</div>';
            }
            html += `<div style="text-align:center; font-size:15px; font-weight:bold; color:var(--gold); margin:8px 0 2px;">${titles[r.reason] || 'The delve is over'}</div>`;
            html += `<div style="text-align:center; color:#aaa; margin-bottom:6px;">${_esc(r.name)} — ${r.chambers} of ${r.total} chambers explored</div>`;
            html += _haulHtml(r.haul);
            for (const line of r.extra || []) html += `<div style="color:#e0c070; font-size:11px;">${_esc(line)}</div>`;
            if (r.artifact && r.artifact.found) {
                const art = r.artifact;
                const t = art.type === 'artifact'
                    ? `${art.artifact.icon || '🏺'} ${art.artifact.name} recovered intact!`
                    : `🧩 ${art.artifact.name} fragment (${art.fragmentsOwned}/${art.fragmentsRequired})`;
                html += `<div style="${CARD} border-color: rgba(192,57,43,0.4); color:#f0a090;">${_esc(t)}<div style="font-size:10px; color:#aaa; font-style:italic;">${_esc(art.lore || '')}</div></div>`;
            }
            for (const l of (r.haul && r.haul.lore) || []) {
                html += `<div style="padding:8px; background:rgba(155,89,182,0.12); border-left:3px solid #9b59b6; margin:6px 0; font-size:11px; color:#ccc;">📜 <span style="color:var(--gold);">Year ${_esc(l.year)}</span> — ${_esc(l.text)}</div>`;
            }
            html += `<button data-am-act="closePanelAndEndDay" style="${BTN_GOLD} text-align:center;">Make camp outside (end the day)</button>`;
            html += '</div>';
            game.ui.showCustomPanel(`🕯️ ${r.name}`, html);
            game.ui.updateStats(player, world);
            return;
        }

        // ── The entrance
        if (!a) {
            const site = Delves.siteInfo(tile);
            if (!site || !Delves.isDelveSite(tile)) {
                game.ui.showNotification('🕯️ Delve', 'There is nothing here left to delve.', 'default');
                return;
            }
            html += `<div style="text-align:center; font-size:42px; margin:4px 0;">${site.icon}</div>`;
            html += `<div style="text-align:center; color:#aaa; margin-bottom:6px;">${_esc(site.name)}</div>`;
            html += `<div style="color:#ddd; line-height:1.5; margin-bottom:8px;">${_esc(site.intro || '')}</div>`;
            const picked = tile.improvement.rivalLooted;
            if (picked && picked.by) {
                html += `<div style="${CARD} border-color: rgba(224,138,80,0.4); color:#e0a070; font-size:11px;">🕯️ Fresh tracks and cold campfires: ${_esc(picked.by)} has already plundered part of this place (day ${picked.day}). Its hauls will be thinner (×${picked.lootFactor}).</div>`;
            }
            html += `<div style="${CARD} font-size:11px; color:#bbb; line-height:1.5;">A delve is 3–6 chambers deep; the last is the deep heart of the place. Each chamber offers choices that test your attributes, skills, gear, companions and character, and cost stamina and health. Between chambers you may turn back and keep everything you found. The deeper you go, the greater the danger — and the reward. You can delve here only once.</div>`;
            html += _statusHtml(player);
            html += `<button onclick="window._delve.descend()" style="${BTN_GOLD} text-align:center;">Descend (${ActionMenu.getAPCost('delve')} AP)</button>`;
            html += `<button data-am-act="closePanel" style="${BTN_DIM} text-align:center; cursor:pointer;">Not today</button>`;
            html += '</div>';
            game.ui.showCustomPanel(`🕯️ ${tile.improvement.name}`, html);
            return;
        }

        const kind = Delves.KINDS[a.kind] || {};
        html += `<div style="color:#aaa; font-size:11px;">${kind.icon || ''} ${_esc(kind.name || '')} — chamber ${Math.min(a.index + 1, a.plan.length)} of ${a.plan.length}</div>`;
        html += _depthBar(a);
        html += _statusHtml(player);

        // ── Between chambers: the last result, then press on / turn back
        if (a.phase === 'between') {
            if (last) {
                const ch = last.chamber || {};
                html += `<div style="${CARD} border-color:${last.passed ? 'rgba(127,208,127,0.4)' : 'rgba(224,96,96,0.4)'};">`;
                html += `<div style="font-weight:bold; color:${last.passed ? '#7fd07f' : '#e08080'};">${ch.icon || ''} ${_esc(ch.name)} — ${last.passed ? 'success' : 'failure'}</div>`;
                html += `<div style="color:#ddd; margin-top:3px;">${_esc(last.text)}</div>`;
                if (last.lines && last.lines.length) html += `<div style="font-size:11px; color:#bbb; margin-top:4px;">${last.lines.map(_esc).join(' · ')}</div>`;
                html += '</div>';
            }
            html += _haulHtml(a.haul);
            const deep = a.index === a.plan.length - 1;
            html += `<div style="font-size:11px; color:#aaa; margin:6px 0;">${deep ? 'The way ahead leads down into the deep heart of this place. Whatever waits there is the greatest prize — and the greatest danger.' : 'The passage leads deeper. Each chamber further is more dangerous, and richer.'}</div>`;
            html += `<button onclick="window._delve.pressOn()" style="${BTN_GOLD}">${deep ? '⬇️ Descend into the deep' : '⬇️ Press deeper'}</button>`;
            html += `<button onclick="window._delve.retreat()" style="${BTN_BACK}">↩️ Turn back with your haul</button>`;
            html += '</div>';
            game.ui.showCustomPanel(`🕯️ ${a.name}`, html);
            return;
        }

        // ── In a chamber: the situation and its choices
        const ch = Delves.currentChamber(player);
        if (ch) {
            html += `<div style="${CARD}${ch.deep ? ' border-color: rgba(192,57,43,0.5);' : ''}">`;
            html += `<div style="font-weight:bold; color:var(--gold); font-size:13px;">${ch.icon || ''} ${_esc(ch.name)}${ch.deep ? ' <span style="color:#e08080; font-size:10px;">THE DEEP</span>' : ''}</div>`;
            html += `<div style="color:#ddd; margin:4px 0 6px; line-height:1.45;">${_esc(ch.text)}</div>`;
            for (const c of Delves.describeChoices(player)) {
                const pct = c.chance === null ? '' : ` ~${Math.round(c.chance * 100)}%`;
                const sub = [`<span style="color:${ODDS_COLOR[c.odds] || '#ccc'};">${c.odds}${pct}</span>`];
                if (c.costText) sub.push(_esc(c.costText));
                if (c.hint) sub.push(_esc(c.hint));
                if (c.can.ok) {
                    html += `<button onclick="window._delve.choose('${c.id}')" style="${BTN_GOLD}">${_esc(c.label)}<div style="font-weight:normal; font-size:10px; opacity:0.85;">${sub.join(' · ')}</div></button>`;
                } else {
                    html += `<button disabled style="${BTN_DIM}">${_esc(c.label)}<div style="font-weight:normal; font-size:10px;">${_esc(c.can.reason)}</div></button>`;
                }
            }
            html += '</div>';
        }
        html += _haulHtml(a.haul);
        html += `<button onclick="window._delve.retreat()" style="${BTN_BACK}">↩️ ${a.index === 0 ? 'Turn back before you begin' : 'Turn back with your haul'}</button>`;
        html += '</div>';
        game.ui.showCustomPanel(`🕯️ ${a.name}`, html);
    },
});
