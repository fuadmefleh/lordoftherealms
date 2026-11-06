// ActionMenu — the duel panel: one interactive face for the shared duel
// engine (systems/duels.js). Combat training, tournament bouts and rival
// duels open it: both combatants (health pool, breath, weapon, how the
// opponent fights), the four moves with their breath cost, Yield, "fight on
// instinct" (auto-finish), and the narration of the last exchanges. The
// engine decides everything; this file only draws it and routes the clicks.
import { Duels } from '../../systems/duels.js';
import { CombatSkills } from '../../systems/combatSkills.js';
import { BTN, BTN_GOLD, BTN_DARK, BTN_RED, CARD, esc } from './uiKit.js';

function _bar(cur, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((cur / Math.max(1, max)) * 100)));
    return `<div style="background: rgba(255,255,255,0.08); border-radius: 4px; height: 7px; overflow: hidden; margin: 2px 0;">
        <div style="width: ${pct}%; height: 100%; background: ${color};"></div></div>`;
}

function _card(c, isPlayer) {
    const T = Duels.temperament(c.temperament);
    let h = `<div style="${CARD} flex: 1; margin: 0; text-align: left;">`;
    h += `<div style="font-size: 13px;"><span style="font-size: 18px;">${c.icon}</span> <b>${esc(c.name)}</b></div>`;
    if (c.title) h += `<div style="font-size: 10px; color: var(--text-muted);">${esc(c.title)}</div>`;
    // The practised skill they fight with and its level (systems/combatSkills.js)
    if (c.fightSkill) h += `<div style="font-size: 10px; color: #9fd6a8;">${c.fightSkill === 'brawling' ? '✊ Brawling' : '⚔️ Blades'} ${Math.round(c.skill)}</div>`;
    h += `<div style="font-size: 10px; color: var(--text-secondary); margin: 2px 0;">${esc(c.weapon)}${c.shield ? ` · ${esc(c.shield)}` : ''}${c.armour > 0.01 ? ` · armour ${Math.round(c.armour * 100)}%` : ''}</div>`;
    if (!isPlayer) h += `<div style="font-size: 10px; color: #c9a86a;">${T.icon || ''} Fights ${esc(String(T.label || 'steady').toLowerCase())}</div>`;
    h += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">❤️ ${c.hp}/${c.maxHp}</div>`;
    h += _bar(c.hp, c.maxHp, c.hp / c.maxHp < 0.3 ? '#e74c3c' : '#2ecc71');
    h += `<div style="font-size: 10px; color: var(--text-muted);">💨 ${c.stamina}/${c.maxStamina}</div>`;
    h += _bar(c.stamina, c.maxStamina, '#3498db');
    h += '</div>';
    return h;
}

function _entryHtml(state, e, faded) {
    const ma = Duels.move(e.aMove);
    const mb = Duels.move(e.bMove);
    const vs = ma && mb ? `${ma.icon} ${esc(ma.label)} <span style="color: var(--gold);">vs</span> ${mb.icon} ${esc(mb.label)} — ` : '';
    const notes = e.notes && e.notes.length ? ` <span style="color: var(--text-muted);">${e.notes.map(esc).join(' ')}</span>` : '';
    return `<div style="font-size: ${faded ? 10 : 12}px; ${faded ? 'opacity: 0.6;' : ''} margin: 3px 0;">
        <b>R${e.round}</b> ${vs}${esc(e.text)}${notes}</div>`;
}

/**
 * What the player's side learned from the bout: Blades or Brawling XP for
 * every exchange that drew blood, more for the win; a level-up announced.
 */
function _duelXp(game, state) {
    const me = state && state.a;
    const player = game && game.player;
    if (!me || me.kind !== 'player' || !me.fightSkill || !player) return;
    const hits = state.log.filter(e => e.dmgToB > 0).length;
    const xp = CombatSkills.xpFor(me.fightSkill, 'duelHit', hits) + (state.winner === 'a' ? CombatSkills.xpFor(me.fightSkill, 'duelWin') : 0);
    const ev = CombatSkills.train(player, me.fightSkill, xp);
    if (ev && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(`${ev.icon} ${ev.name} Improved`, ev.text, 'success');
}

export const DuelPanel = {
    /**
     * Open an interactive duel.
     *   a, b      — combatants (Duels.fromPlayer / fromRival / fromNpc / ...)
     *   mode      — 'spar' | 'tournament' | 'firstBlood' | 'toDeath' | 'ambush'
     *   title     — window title; intro — a line of HTML under it
     *   onFinish(result, close) — called once when the player continues past
     *               the result; render your own follow-up panel there
     * Returns the duel state.
     */
    open(game, { a, b, mode = 'firstBlood', rounds, title = '⚔️ Duel', intro = '', onFinish, continueLabel = 'Continue' }) {
        const state = Duels.create(a, b, { mode, rounds });
        let finished = false;

        const render = () => {
            let h = '<div style="max-width: 460px;">';
            if (intro) h += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; text-align: center;">${intro}</div>`;
            const modeLabel = (Duels.mode(state.mode) || {}).label;
            h += `<div style="font-size: 10px; color: var(--text-muted); text-align: center; margin-bottom: 4px;">${modeLabel ? `${esc(modeLabel)} · ` : ''}Round ${Math.min(state.round + (state.over ? 0 : 1), state.maxRounds)} of ${state.maxRounds}</div>`;
            h += `<div style="display: flex; gap: 8px;">${_card(state.a, true)}${_card(state.b, false)}</div>`;

            const last = state.log[state.log.length - 1];
            h += `<div style="${CARD} min-height: 34px;">`;
            if (last) {
                h += _entryHtml(state, last, false);
                for (const e of state.log.slice(-4, -1).reverse()) h += _entryHtml(state, e, true);
            } else {
                h += `<div style="font-size: 12px; color: var(--text-secondary);">You face ${esc(state.b.name)}. Choose your opening.</div>`;
            }
            h += '</div>';

            if (!state.over) {
                h += '<div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">';
                for (const id of Duels.MOVES) {
                    const m = Duels.move(id);
                    const cost = m.cost || 0;
                    const tired = cost > 0 && state.a.stamina < cost;
                    h += `<button onclick="window._duel.move('${id}')" title="${esc(m.hint || '')}"
                        style="${BTN} flex: 1; min-width: 84px; padding: 10px 6px; background: rgba(255,255,255,0.05); border: 1px solid ${tired ? '#7a3030' : 'rgba(255,255,255,0.15)'}; color: var(--text-primary);">
                        <div style="font-size: 22px;">${m.icon}</div>
                        <div>${esc(m.label)}</div>
                        <div style="font-size: 9px; color: ${tired ? '#e08080' : 'var(--text-muted)'}; font-weight: normal;">${cost > 0 ? `${cost} breath` : `+${-cost} breath`}</div>
                    </button>`;
                }
                h += '</div>';
                h += '<div style="display: flex; gap: 6px; margin-top: 6px;">';
                h += `<button onclick="window._duel.auto()" style="${BTN_DARK} flex: 1;">⚡ Fight on instinct</button>`;
                if (state.canYield || state.mode === 'toDeath') h += `<button onclick="window._duel.yield()" style="${BTN_RED} flex: 1;">🏳️ Yield</button>`;
                h += '</div>';
                h += `<div style="font-size: 9px; color: var(--text-muted); margin-top: 6px; text-align: center;">Strike beats Thrust · Thrust beats Feint · Feint beats Guard · Guard beats Strike</div>`;
            } else {
                const r = Duels.result(state);
                const color = r.draw ? '#f39c12' : r.playerWon ? '#2ecc71' : '#e74c3c';
                const word = r.draw ? 'A draw' : r.playerWon ? (r.yielded === 'b' ? `${esc(state.b.name)} yields!` : 'Victory!') : (r.yielded === 'a' ? 'You yield.' : 'Defeated!');
                h += `<div style="text-align: center; font-size: 18px; font-weight: bold; color: ${color}; margin: 6px 0;">${r.draw ? '🤝' : r.playerWon ? '🏆' : '😤'} ${word}</div>`;
                h += `<div style="text-align: center; font-size: 11px; color: var(--text-secondary);">${r.rounds} exchange${r.rounds === 1 ? '' : 's'} · dealt ${r.dealt} · took ${r.taken}</div>`;
                h += `<button onclick="window._duel.done()" style="${BTN_GOLD} width: 100%; margin-top: 8px; padding: 10px;">${esc(continueLabel)}</button>`;
            }
            h += '</div>';
            game.ui.showCustomPanel(title, h);
        };

        window._duel = {
            move: (id) => {
                if (state.over) return;
                Duels.exchange(state, id);
                render();
            },
            auto: () => {
                if (state.over) return;
                Duels.autoFinish(state);
                render();
            },
            yield: () => {
                if (state.over) return;
                Duels.exchange(state, 'yield');
                render();
            },
            done: () => {
                if (!state.over || finished) return;
                finished = true;
                _duelXp(game, state);
                if (typeof onFinish === 'function') onFinish(Duels.result(state));
                else if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
            },
        };
        render();
        return state;
    },
};
