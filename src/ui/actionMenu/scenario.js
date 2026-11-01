// ActionMenu — Ambition of this Life (Dynasty → 🏆): the game's Origin, its
// difficulty, and the victory goal with its progress; pick or change the
// goal here. And the victory scene, shown once when the goal is met
// (ui/game/endDay.js → Victory.check), with "Continue playing" and, when the
// Annals panel exists, "Read the Annals".
// Rules live in systems/victory.js, core/difficulty.js and player/scenarios.js.
import { ActionMenu } from './_ref.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DARK, CARD, esc } from './uiKit.js';
import { registerScene } from './choiceScenes.js';
import { Victory } from '../../systems/victory.js';
import { Difficulty } from '../../core/difficulty.js';
import { Scenarios } from '../../player/scenarios.js';

const KNOB_LABELS = {
    startGold: 'Starting purse',
    buyPrice: 'Prices you pay',
    sellPrice: 'Prices you are paid',
    hostility: 'Realms\' hostility',
    enemyStrength: 'Foes in battle',
    illness: 'Wounds & sickness',
};

/** The Annals panel, when the Annals feature provides one. */
function annalsOpener() {
    for (const m of ['showAnnals', 'showAnnalsPanel']) if (typeof ActionMenu[m] === 'function') return m;
    return null;
}

function bar(pct) {
    const w = Math.round(Math.max(0, Math.min(1, pct)) * 100);
    return `<div style="background:rgba(255,255,255,0.08); border-radius:4px; height:10px; overflow:hidden; margin:6px 0;"><div style="width:${w}%; height:100%; background:var(--gold);"></div></div>`;
}

Object.assign(ActionMenu, {
    /** Dynasty → Ambition of this Life. */
    showAmbitionPanel(game) {
        const player = game.player;
        const world = game.world;
        const sc = Difficulty.state(player);
        const origin = Scenarios.origin(sc.id);
        const lvl = Difficulty.level(player);
        const p = Victory.progress(player, world);

        let html = '<div style="font-size:12px; min-width:340px; max-height:560px; overflow-y:auto;">';
        // The goal
        html += `<div style="${CARD}">`;
        html += `<div style="font-size:11px; color:#888; text-transform:uppercase;">Ambition of this life</div>`;
        html += `<div style="font-size:15px; font-weight:bold; color:var(--gold); margin-top:2px;">${p.icon || ''} ${esc(p.name)}</div>`;
        html += `<div style="color:#aaa; margin-top:2px;">${esc(p.blurb)}</div>`;
        if (p.id !== 'none') {
            html += bar(p.pct);
            html += `<div>${esc(p.text)}</div>`;
            for (const l of p.lines) html += `<div style="color:#999; font-size:11px;">· ${esc(l)}</div>`;
        }
        if (sc.victoryAchieved) {
            html += `<div style="color:#7fd07f; margin-top:6px; font-weight:bold;">🏆 Achieved on day ${sc.victoryAchieved.day} by ${esc(sc.victoryAchieved.by || player.name)}.</div>`;
        }
        for (const v of sc.pastVictories || []) {
            html += `<div style="color:#8a8; font-size:11px;">🏆 ${Victory.wonThisLife(sc, v) ? 'Won earlier in this life' : 'In a past life'}: ${esc(v.name)} (day ${v.day}, ${esc(v.by || '')})</div>`;
        }
        html += '</div>';

        // Choose / change the goal
        html += `<div style="${CARD}"><div style="font-size:11px; color:#888; text-transform:uppercase; margin-bottom:4px;">Set your ambition</div>`;
        for (const v of Object.values(Victory.defs())) {
            const on = v.id === sc.victory;
            html += `<button ${on ? 'disabled' : `data-am-act="setVictoryGoal" data-am-args='${esc(JSON.stringify([v.id]))}'`} style="${on ? BTN_GOLD : BTN_PLAIN} display:block; width:100%; text-align:left;" title="${esc(v.blurb)}">${v.icon} ${esc(v.name)}${on ? ' — current' : ''}<div style="font-weight:normal; font-size:11px; opacity:0.75;">${esc(v.blurb)}</div></button>`;
        }
        html += '<div style="font-size:11px; color:#777; margin-top:4px;">Changing your ambition starts it afresh.</div></div>';

        // Origin & difficulty
        html += `<div style="${CARD}">`;
        html += `<div><b>Origin:</b> ${origin ? `${origin.icon || ''} ${esc(origin.name)}` : (sc.id === 'stranger' ? '🌱 A new life in the world' : esc(sc.id))}</div>`;
        html += `<div style="margin-top:2px;"><b>Difficulty:</b> ${esc(lvl.name)}${lvl.blurb ? ` <span style="color:#999;">— ${esc(lvl.blurb)}</span>` : ''}</div>`;
        if (lvl.key !== 'normal') {
            for (const k of Difficulty.KNOBS) {
                const m = lvl[k];
                if (m === 1) continue;
                html += `<div style="font-size:11px; color:#aaa;">· ${KNOB_LABELS[k] || k}: ×${m}</div>`;
            }
        }
        html += '</div>';
        html += `<button data-am-act="openTileMenu" data-am-args='["showDynastyMenu"]' style="${BTN_DARK} width:100%; margin-top:6px;">← Back to Dynasty</button>`;
        html += '</div>';
        game.ui.showCustomPanel('🏆 Ambition of this Life', html);
    },

    setVictoryGoal(game, id) {
        const res = Victory.setGoal(game.player, id);
        if (!res.success && game.ui) game.ui.showNotification('Ambition', res.reason, 'error');
        ActionMenu.showAmbitionPanel(game);
    },

    /** The victory scene (from ui/game/endDay.js when Victory.check reports a win). */
    showVictoryScene(game, won) {
        if (!won) return;
        ActionMenu.showScene(game, 'victory', { won });
    },
});

registerScene('victory', {
    view(game, state) {
        const w = state && state.won;
        if (!w) return null;
        const player = game.player;
        const house = player && player.house;
        const sc = player && player.scenario;
        const lvl = Difficulty.level(player);
        const opener = annalsOpener();
        const options = [{ id: 'continue', icon: '▶️', label: 'Continue playing', hint: 'The world goes on. Your victory stands in the House Chronicle.', odds: false, isDefault: true }];
        if (opener) options.push({ id: 'annals', icon: '📜', label: 'Read the Annals', hint: 'The story of your House so far.', odds: false });
        return {
            icon: '🏆',
            title: `${w.icon} ${w.name}`,
            panelTitle: '🏆 Victory',
            stats: [`Day ${w.day}`, lvl ? `${lvl.name} difficulty` : '', house ? `${house.name}, generation ${house.generation || 1}` : ''].filter(Boolean),
            text: `${w.by || (player && player.name) || 'You'} has done what few ever do. ${w.text}`,
            lines: sc && Scenarios.origin(sc.id) ? [`Origin: ${Scenarios.origin(sc.id).name}`] : [],
            options,
        };
    },
    act(game, state, choice) {
        if (choice === 'annals') {
            const opener = annalsOpener();
            return { after: (g) => { if (opener) ActionMenu[opener](g); else g.ui.hideCustomPanel(); } };
        }
        return { after: (g) => g.ui.hideCustomPanel() };
    },
});
