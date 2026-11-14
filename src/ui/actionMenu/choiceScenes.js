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
// Drawn in the action menu's voice (ui/actionMenu/uiKit.js): the scene's text
// as a lede, its stats as chips, one row a choice with its odds at the right
// (greyed with its reason). Rows route through data-am-act → ActionMenu.sceneAct.
import { ActionMenu } from './_ref.js';
import { esc, lede, chips, card, actRow, rowList } from './uiKit.js';
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

/** One choice as an action-menu row: its odds at the right, greyed with its reason. */
function _optionHtml(o) {
    const off = o.can === false;
    return actRow({
        icon: o.icon || '•',
        name: `${esc(o.label)}${o.cost ? ` <span style="font-weight:normal; color:#9d937c;">(${esc(o.cost)})</span>` : ''}`,
        desc: esc(o.hint || ''), off, why: `${esc(o.reason || 'Not possible')}${o.hint ? ` — ${esc(o.hint)}` : ''}`,
        side: off || o.odds === false ? '' : _oddsHtml(o.chance),
        act: 'sceneAct', args: [o.id], tone: o.isDefault ? 'gold' : null,
        title: o.isDefault ? 'The usual choice' : '',
    });
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
        let html = '<div style="font-size:12px;">';
        html += chips((v.stats || []).map(esc));
        if (v.text) html += lede(esc(v.text));
        for (const line of v.lines || []) html += `<div style="font-size:12px; color:var(--text-secondary); margin:2px 0;">${esc(line)}</div>`;
        if ((v.log || []).length) {
            html += card(v.log.slice(-6).map(l => `<div style="font-size:12px; margin:2px 0;">${esc(l)}</div>`).join(''), { icon: '📜', title: 'So far' });
        }
        html += rowList((v.options || []).map(_optionHtml), (v.options || []).length > 1 ? 'What will you do?' : '');
        if (v.footer) html += `<div style="font-size:11px; color:#9d937c; margin-top:6px;">${esc(v.footer)}</div>`;
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
        game.ui.showCustomPanel(n.title, `<div style="font-size:12px;">
            ${(out.log || []).map(l => `<div style="font-size:12px; color:var(--text-secondary); margin:2px 0;">${esc(l)}</div>`).join('')}
            ${lede(`<span style="color:${color};">${esc(n.body)}</span>`)}
            ${rowList([{ icon: '➡️', name: 'Continue', desc: out.endDay ? 'The day ends' : '', act: next, tone: 'gold' }])}</div>`);
    },
});
