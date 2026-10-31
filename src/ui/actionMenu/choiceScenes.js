// ActionMenu — choice scenes: a small, shared modal for phased decisions.
//
// Several activities that used to be one automatic roll are now short
// scenes of choices with the odds shown (the road-encounter pattern of
// battle.js, generalised): a pirate sighting at sea (chase / flee / parley →
// boarding → aftermath), digging up a treasure map's cache (guardians,
// traps, rivals digging first), stealing a map from a named owner, the
// prison loop, a tax collector's round, a winter trap line, ice fishing.
//
// The domain module owns the scene's state and its rules; a UI handler,
// registered here under a kind, is a thin adapter:
//
//   registerScene(kind, {
//       view(game, state)  → { icon, title, text, lines?, stats?, log?, options, footer? } | null
//       act(game, state, choiceId) → { state?, notification?, invalid?, endDay?, after?(game) }
//       abandon?(game, state) → { notification? } | null   (the panel was walked away from)
//   });
//
// options: [{ id, icon, label, hint, chance (null = certain), can, reason, cost }]
// act() returning a `state` keeps the scene going (re-rendered); no state
// ends it with an outcome panel (Continue ends the day when endDay is set),
// or hands over to after(game) (another panel, e.g. the bounty decision).
//
// The live scene sits on game._scene = { kind, state }. A scene left open is
// settled with its handler's abandon() when another starts or the day ends
// (settleScene, called from ui/game/endDay.js).
//
// Buttons route through data-am-act → ActionMenu.sceneAct.
import { ActionMenu } from './_ref.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, CARD, esc } from './uiKit.js';
import { FieldBattle } from '../../player/fieldBattle.js';

const HANDLERS = {};

const ODDS_COLOR = { 'very likely': '#7fd07f', likely: '#b5d77f', 'even odds': '#e0b040', risky: '#e08a50', desperate: '#e06060', certain: '#9ecbff' };
const TYPE_COLOR = { success: '#7fd07f', warning: '#e0b040', error: '#e06060', info: '#9ecbff', default: '#ccc' };

/** Register the UI adapter of a scene kind. */
export function registerScene(kind, handler) {
    HANDLERS[kind] = handler;
}

/** The registered handler of a kind (tests). */
export function sceneHandler(kind) {
    return HANDLERS[kind] || null;
}

function _notify(game, n) {
    if (n && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(n.title, n.body, n.type || 'info');
}

/**
 * A scene the player walked away from: its handler settles it (the default
 * outcome, or nothing at all). Called when another scene starts and at the
 * end of the day.
 */
export function settleScene(game) {
    const sc = game && game._scene;
    if (!sc) return null;
    game._scene = null;
    const h = HANDLERS[sc.kind];
    const out = h && typeof h.abandon === 'function' ? h.abandon(game, sc.state) : null;
    if (out && out.notification) _notify(game, out.notification);
    return out;
}

function _oddsHtml(chance) {
    const label = FieldBattle.oddsLabel(chance);
    const pct = chance === null || chance === undefined ? '' : ` ~${Math.round(chance * 100)}%`;
    return `<span style="color:${ODDS_COLOR[label] || '#ccc'}; font-weight:bold;">${label}${pct}</span>`;
}

function _optionHtml(o) {
    const style = (o.can === false ? BTN_OFF : (o.isDefault ? BTN_GOLD : BTN_PLAIN)) + 'display:block; width:100%; text-align:left; padding:8px 10px; margin:5px 0 0;';
    const attrs = o.can === false ? 'disabled' : `data-am-act="sceneAct" data-am-args='${esc(JSON.stringify([o.id]))}'`;
    const sub = o.can === false ? `<span style="color:#e08a50;">${esc(o.reason || 'Not possible')}</span>` : (o.odds === false ? '' : _oddsHtml(o.chance));
    return `<button ${attrs} style="${style}">
        <div>${o.icon || '•'} ${esc(o.label)}${o.cost ? ` <span style="font-weight:normal; opacity:0.8;">(${esc(o.cost)})</span>` : ''}${sub ? ` — ${sub}` : ''}</div>
        ${o.hint ? `<div style="font-weight:normal; font-size:11px; opacity:0.75; margin-top:2px;">${esc(o.hint)}</div>` : ''}
    </button>`;
}

Object.assign(ActionMenu, {
    /**
     * Show the live scene, or start one: showScene(game, kind, state). A
     * different scene still open is settled first.
     */
    showScene(game, kind = null, state = null) {
        if (kind) {
            if (game._scene && game._scene.state !== state) settleScene(game);
            game._scene = { kind, state };
        }
        const sc = game._scene;
        const h = sc && HANDLERS[sc.kind];
        const v = h ? h.view(game, sc.state) : null;
        if (!v) {
            game._scene = null;
            game.ui.hideCustomPanel();
            return;
        }
        let html = '<div style="padding:4px 2px;">';
        html += `<div style="text-align:center; margin-bottom:6px;"><span style="font-size:38px;">${v.icon || '❔'}</span>
            <h3 style="margin:4px 0; color:var(--gold);">${esc(v.title)}</h3>
            ${(v.stats || []).length ? `<div style="font-size:12px; color:#aaa;">${v.stats.map(esc).join(' · ')}</div>` : ''}</div>`;
        if (v.text) html += `<p style="font-size:13px; line-height:1.5; margin:6px 0;">${esc(v.text)}</p>`;
        for (const line of v.lines || []) html += `<div style="font-size:12px; color:var(--text-secondary); margin:2px 0;">${esc(line)}</div>`;
        if ((v.log || []).length) {
            html += `<div style="${CARD}"><div style="font-size:11px; color:#888; text-transform:uppercase; margin-bottom:4px;">So far</div>${v.log.slice(-6).map(l => `<div style="font-size:12px; margin:2px 0;">${esc(l)}</div>`).join('')}</div>`;
        }
        for (const o of v.options || []) html += _optionHtml(o);
        if (v.footer) html += `<div style="font-size:11px; color:#777; margin-top:8px;">${esc(v.footer)}</div>`;
        html += '</div>';
        game.ui.showCustomPanel(v.panelTitle || `${v.icon || ''} ${v.title}`.trim(), html);
    },

    /** Act on a scene choice. */
    sceneAct(game, choice) {
        const sc = game._scene;
        const h = sc && HANDLERS[sc.kind];
        if (!h) {
            game._scene = null;
            game.ui.hideCustomPanel();
            return;
        }
        const out = h.act(game, sc.state, choice) || {};
        if (out.invalid) {
            _notify(game, out.notification || { title: 'Not Possible', body: 'That cannot be done now.', type: 'error' });
            return;
        }
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        if (out.state) {
            sc.state = out.state;
            if (out.notification && out.notify) _notify(game, out.notification);
            ActionMenu.showScene(game);
            return;
        }
        game._scene = null;
        if (out.notification) _notify(game, out.notification);
        if (typeof out.after === 'function') {
            out.after(game);
            return;
        }
        const n = out.notification || { title: 'Done', body: '', type: 'info' };
        const color = TYPE_COLOR[n.type] || TYPE_COLOR.default;
        const next = out.endDay ? 'closePanelAndEndDay' : 'closePanelAndRefresh';
        game.ui.showCustomPanel(n.title, `<div style="padding:8px;">
            ${(out.log || []).map(l => `<div style="font-size:12px; color:var(--text-secondary); margin:2px 0;">${esc(l)}</div>`).join('')}
            <p style="color:${color}; line-height:1.5;">${esc(n.body)}</p>
            <button data-am-act="${next}" style="${BTN_PLAIN}width:100%; padding:9px; margin-top:8px;">${out.endDay ? 'Continue (ends the day)' : 'Continue'}</button></div>`);
    },
});
