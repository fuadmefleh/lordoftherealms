// ActionMenu — the Delve panel: step chamber by chamber through a great ruin
// or cave. Logic lives in systems/delves.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Delves, PlayerInventory } from './_imports.js';
import { esc, lede, chips, card, rowList, more } from './uiKit.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): the chamber as a card,
// one row a choice with its odds at the right (greyed with its reason), the
// haul as chips. Clicks route through window._delve (set on each render).
const ODDS_COLOR = { 'very likely': '#7fd07f', likely: '#b5d77f', 'even odds': '#e0b040', risky: '#e08a50', desperate: '#e06060', certain: '#9ecbff' };
const NOTE = 'font-size:11px; color:#9d937c; margin:2px 0;';
const _esc = esc;

/** A row routed through window._delve: call = "choose('x')" etc. */
function _row(o, call) {
    return { ...o, attrs: o.off ? '' : `onclick="window._delve.${call}"` };
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
    for (const i of haul.injuries || []) bad.push(`🤕 ${i}`);
    if (haul.curse) bad.push('🗿 cursed idol');
    if (haul.guardian) bad.push(`⚠️ ${haul.guardian} roams`);
    let body = `<div style="font-size:11px; color:#ddd; line-height:1.5;">${parts.length ? parts.map(_esc).join(' · ') : 'Nothing yet.'}</div>`;
    if (bad.length) body += `<div style="font-size:11px; color:#e0a070; margin-top:4px;">${bad.map(_esc).join(' · ')}</div>`;
    return card(body, { icon: '🎒', title: 'Your haul' });
}

function _statusHtml(player) {
    const free = PlayerInventory.getFreeSlots(player);
    return chips([
        ['❤️', 'Health', `${Math.round(player.health || 0)}/${player.maxHealth || 100}`],
        ['⚡', 'Stamina', Math.max(0, player.movementRemaining || 0)],
        { icon: '🎒', label: 'Free slots', value: free, cls: free ? '' : 'dim' },
        Delves.isCursed(player) ? { icon: '🗿', label: 'Cursed', cls: 'dim' } : null,
    ]);
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
        let html = '<div style="font-size: 12px;">';

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
                html += lede(`${_esc(last.text)}${last.lines && last.lines.length ? `<br><span style="font-size:11px; color:#bbb;">${last.lines.map(_esc).join(' · ')}</span>` : ''}`);
            }
            html += card(`<div style="${NOTE}">${r.chambers} of ${r.total} chambers explored</div>`, { title: titles[r.reason] || 'The delve is over', side: _esc(r.name), tone: r.reason === 'collapse' ? 'bad' : r.reason === 'cleared' ? 'good' : null });
            html += _haulHtml(r.haul);
            for (const line of r.extra || []) html += `<div style="color:#e0c070; font-size:11px;">${_esc(line)}</div>`;
            if (r.artifact && r.artifact.found) {
                const art = r.artifact;
                const t = art.type === 'artifact'
                    ? `${art.artifact.icon || '🏺'} ${art.artifact.name} recovered intact!`
                    : `🧩 ${art.artifact.name} fragment (${art.fragmentsOwned}/${art.fragmentsRequired})`;
                html += card(`<div style="font-size:11px; color:#aaa; font-style:italic;">${_esc(art.lore || '')}</div>`, { title: _esc(t), tone: 'warn' });
            }
            const lore = (r.haul && r.haul.lore) || [];
            if (lore.length) {
                html += more(`📜 Lore found (${lore.length})`, lore.map(l => `<div style="${NOTE}"><span style="color:var(--gold);">Year ${_esc(l.year)}</span> — ${_esc(l.text)}</div>`).join(''));
            }
            html += rowList([{ icon: '🏕️', name: 'Make camp outside', desc: 'The day ends', act: 'closePanelAndEndDay', tone: 'gold' }]);
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
            html += lede(`${site.icon} ${_esc(site.intro || site.name)}`);
            const picked = tile.improvement.rivalLooted;
            if (picked && picked.by) {
                html += card(`<div style="${NOTE}">Fresh tracks and cold campfires: ${_esc(picked.by)} plundered part of this place on day ${picked.day}. What is left is thinner (×${picked.lootFactor}).</div>`, { icon: '🕯️', title: 'Someone was here first', tone: 'warn' });
            }
            html += _statusHtml(player);
            html += rowList([
                _row({
                    icon: '⬇️', name: 'Descend', tone: 'gold', side: `${ActionMenu.getAPCost('delve')} AP`,
                    desc: '3–6 chambers, the last the deep heart. Each tests you and costs stamina and health; between them you may turn back with all you found. Once only.',
                }, 'descend()'),
                { icon: '↩️', name: 'Not today', act: 'closePanel' },
            ]);
            html += '</div>';
            game.ui.showCustomPanel(`🕯️ ${tile.improvement.name}`, html);
            return;
        }

        const kind = Delves.KINDS[a.kind] || {};
        html += `<div style="${NOTE}">${kind.icon || ''} ${_esc(kind.name || '')} — chamber ${Math.min(a.index + 1, a.plan.length)} of ${a.plan.length}</div>`;
        html += _depthBar(a);
        html += _statusHtml(player);

        // ── Between chambers: the last result, then press on / turn back
        if (a.phase === 'between') {
            if (last) {
                const ch = last.chamber || {};
                const lines = last.lines && last.lines.length ? `<div style="font-size:11px; color:#bbb; margin-top:4px;">${last.lines.map(_esc).join(' · ')}</div>` : '';
                html += card(`<div style="color:#ddd;">${_esc(last.text)}</div>${lines}`, { icon: ch.icon || '', title: _esc(ch.name), side: last.passed ? 'success' : 'failure', tone: last.passed ? 'good' : 'bad' });
            }
            html += _haulHtml(a.haul);
            const deep = a.index === a.plan.length - 1;
            html += rowList([
                _row({ icon: '⬇️', name: deep ? 'Descend into the deep' : 'Press deeper', desc: deep ? 'The deep heart of this place: the greatest prize, and the greatest danger.' : 'Each chamber further is more dangerous, and richer.', tone: deep ? 'bad' : 'gold' }, 'pressOn()'),
                _row({ icon: '↩️', name: 'Turn back with your haul', desc: 'Keep everything you found' }, 'retreat()'),
            ]);
            html += '</div>';
            game.ui.showCustomPanel(`🕯️ ${a.name}`, html);
            return;
        }

        // ── In a chamber: the situation and its choices
        const ch = Delves.currentChamber(player);
        if (ch) {
            html += card(`<div style="color:#ddd; line-height:1.45;">${_esc(ch.text)}</div>`, { icon: ch.icon || '', title: _esc(ch.name), side: ch.deep ? 'THE DEEP' : '', tone: ch.deep ? 'bad' : null });
            html += rowList(Delves.describeChoices(player).map(c => {
                const pct = c.chance === null ? '' : ` ~${Math.round(c.chance * 100)}%`;
                const desc = [c.costText, c.hint].filter(Boolean).map(_esc).join(' · ');
                return _row({
                    icon: '▸', name: _esc(c.label), desc, off: !c.can.ok, why: _esc(c.can.reason || ''),
                    side: c.can.ok ? `<span style="color:${ODDS_COLOR[c.odds] || '#ccc'};">${c.odds}${pct}</span>` : '',
                }, `choose('${c.id}')`);
            }), 'What will you do?');
        }
        html += _haulHtml(a.haul);
        html += rowList([_row({ icon: '↩️', name: a.index === 0 ? 'Turn back before you begin' : 'Turn back with your haul' }, 'retreat()')]);
        html += '</div>';
        game.ui.showCustomPanel(`🕯️ ${a.name}`, html);
    },
});
