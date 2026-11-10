// ActionMenu — road encounters and phased field battles.
//
// showEncounter: a hostile has closed in (Game._checkHostileEncounters); the
// player picks flee / pay toll (throw food) / parley (fire) / hide / fight,
// each with its odds shown (player/roadEncounters.js). encounterAct acts on
// the choice. showFieldBattle / battleAct fight a battle phase by phase: a
// stance before each phase with its estimated odds, Withdraw between phases
// (player/fieldBattle.js). The battle in progress lives on game._fieldBattle
// (with game._fieldBattleSource: 'attack' or 'encounter'); a battle or an
// encounter the player walks away from is settled with the defaults at the
// next day's encounter check (ui/game/combat.js).
//
// Buttons route through data-am-act → ActionMenu.encounterAct / battleAct.
import { ActionMenu } from './_ref.js';
import { Arms } from '../../systems/arms.js';
import { BTN_GOLD, esc, chips, lede, card, actRow, rowList } from './uiKit.js';
import { RoadEncounters } from '../../player/roadEncounters.js';
import { FieldBattle } from '../../player/fieldBattle.js';
import { Ailments } from '../../systems/ailments.js';
import { InnerMapBattle } from '../innerMapBattle.js';

const ODDS_COLOR = { 'very likely': '#8fd18a', likely: '#b5d77f', 'even odds': '#f0b35a', risky: '#e0a060', desperate: '#e0846a', certain: '#9ecbff' };

function _oddsHtml(chance) {
    const label = FieldBattle.oddsLabel(chance);
    const pct = chance === null || chance === undefined ? '' : ` ~${Math.round(chance * 100)}%`;
    return `<span style="color:${ODDS_COLOR[label] || '#ccc'}; font-weight:bold;">${label}${pct}</span>`;
}

function _bar(label, value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="margin:3px 0; font-size:12px; color:#cbbf9f;">${label}: <strong style="color:#ece2c8;">${Math.round(value)}</strong> / ${Math.round(max)}
        <div style="height:5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; margin-top:3px;">
            <div style="width:${pct}%; height:100%; background:${color};"></div></div></div>`;
}

/** One choice as an action-menu row: its odds at the right, greyed with its reason when it can't be taken. */
function _optionRow(act, args, o, side) {
    const name = `${esc(o.label || o.name)}${o.cost ? ` <span style="font-weight:normal; color:#9d937c;">(${esc(o.cost)})</span>` : ''}`;
    const hint = esc(o.hint || o.text || '');
    return actRow({
        icon: o.icon, name, desc: hint, side: o.can ? side : '',
        off: !o.can, why: `${esc(o.reason)}${hint ? ` — ${hint}` : ''}`,
        act, args, tone: o.isDefault ? 'gold' : null,
        title: o.isDefault ? 'The usual choice' : '',
    });
}

function _phaseLogHtml(log) {
    if (!log || !log.length) return '';
    return card(log.map(e => {
        const feint = e.feint === true ? ' — they took the bait!' : e.feint === false ? ' — they did not bite' : '';
        const rout = e.routed === 'enemy' ? ' <span style="color:#8fd18a;">They break and run!</span>' : e.routed === 'player' ? ' <span style="color:#e0846a;">Your line breaks!</span>' : '';
        const edge = e.phase === 'withdraw' ? '' : ` · your edge ${Math.round(e.share * 100)}%`;
        return `<div style="font-size:12px; margin:2px 0; color:#cbbf9f;">${e.icon} <strong style="color:#ece2c8;">${esc(e.name)}</strong> (${esc(e.stanceName)})${edge} · you lost ${e.lost} unit${e.lost === 1 ? '' : 's'}${e.enemyLost ? `, they lost ~${e.enemyLost} strength` : ''}${feint}${rout}</div>`;
    }).join(''), { icon: '📜', title: 'The battle so far' });
}

Object.assign(ActionMenu, {
    /** A hostile has closed in: the choices, with their odds. */
    showEncounter(game, unitId) {
        const { player, world } = game;
        const unit = world.units.find(u => u.id === unitId && !u.destroyed);
        if (!unit) { game._pendingEncounter = null; return; }
        const opts = RoadEncounters.options(player, unit, world);
        const kind = RoadEncounters.kindOf(unit);
        let html = `<div>
            <div style="text-align:center; margin-bottom:6px;"><span style="font-size:40px;">${unit.icon || '⚔️'}</span>
                <div style="margin:4px 0; font-family:var(--font-display); font-size:16px; color:#e0a060;">${esc(unit.name)} ${kind === 'beast' ? 'on your trail' : 'bar the road'}</div></div>`;
        html += chips([
            { icon: '⚔️', label: 'Their strength', value: `<span style="color:#e0a060;">${unit.strength}</span>` },
            opts.find(o => o.battle) ? null : { icon: '⚔️', label: 'You have no soldiers here', cls: 'dim' },
            { icon: '💰', label: 'Gold', value: Math.floor(player.gold || 0), cls: 'gold' },
            ['❤️', 'Health', Math.round(player.health || 0)],
        ]);
        html += rowList(opts.map(o => _optionRow('encounterAct', [unit.id, o.id], o, _oddsHtml(o.chance))), 'What will you do?');
        html += `<div style="font-size:11px; color:#9d937c; margin-top:4px;">Walk away from this and they fall on you at day's end.</div></div>`;
        game.ui.showCustomPanel(`⚔️ ${unit.name}!`, html);
    },

    /** Act on an encounter choice. */
    encounterAct(game, unitId, choice) {
        const { player, world } = game;
        const unit = world.units.find(u => u.id === unitId && !u.destroyed);
        if (!unit || !game._pendingEncounter || game._pendingEncounter.unitId !== unitId) {
            game._pendingEncounter = null;
            game.ui.hideCustomPanel();
            return;
        }
        const out = RoadEncounters.resolve(player, unit, world, choice);
        if (out.kind === 'invalid') {
            game.ui.showNotification(out.notification.title, out.notification.body, 'error');
            return;
        }
        game._pendingEncounter = null;
        if (out.kind === 'battle') {
            game._fieldBattle = out.battle;
            game._fieldBattleSource = { kind: 'encounter', unitId };
            ActionMenu.showFieldBattle(game);
            return;
        }
        game.ui.updateStats(player, world);
        const n = out.notification;
        const color = n.type === 'success' ? '#8fd18a' : n.type === 'warning' ? '#f0b35a' : '#e0846a';
        game.ui.showCustomPanel(n.title, `<div>${lede(`<span style="color:${color}; line-height:1.5;">${esc(n.body)}</span>`)}
            <button data-am-act="closePanelAndRefresh" style="${BTN_GOLD}width:100%; padding:9px; margin-top:8px;">Continue</button></div>`);
        game.ui.showNotification(n.title, n.body, n.type);
    },

    /** The battle in progress: the field, the phases fought, the next choice. */
    showFieldBattle(game) {
        // (a battle fought to its end as the day closed: its report, redrawn on the new day)
        const b = game._fieldBattle || (game._fieldBattleDone && game._fieldBattleDone.done ? game._fieldBattleDone : null);
        if (!b) { game.ui.hideCustomPanel(); return; }
        let html = `<div>
            <div class="pk-card" style="display:flex; gap:14px;"><div style="flex:1;">${_bar('⚔️ Your force', b.sim.pStr, b.pStr0, '#7cc7e8')}</div>
            <div style="flex:1;">${_bar(`${b.enemyIcon} ${esc(b.enemyName)}`, b.sim.eStr, b.eStr0, '#e0a060')}</div></div>
            <div style="font-size:11px; color:#9d937c; margin:4px 0;">📐 ${esc((b.terrainId || 'mixed ground').replace(/_/g, ' '))} · ${esc(b.weather || 'clear')} · counters ×${b.pCounter.toFixed(2)} vs ×${b.eCounter.toFixed(2)}${b.ambushed ? ' · <span style="color:#e0a060;">they caught you unready</span>' : ''}${b.commanderSlain ? ' · <span style="color:#ce93d8;">your assassins slew their commander</span>' : ''}</div>`;
        html += _phaseLogHtml(b.log);
        if (!b.done && !b.log.length && b.theatre === 'land') {
            // Before the first blow: fight it on the ground yourself, or leave it to the captains
            const odds = FieldBattle.estimate(b, FieldBattle.defaultStance(b));
            html += rowList([
                { icon: '⚔️', name: 'Take the field — command the battle yourself', desc: 'Your companies drawn up on this very ground: march them, hold, charge, loose volleys, sound the retreat.', side: 'on the ground', tone: 'gold', act: 'battleAct', args: ['field'] },
                { icon: '🎲', name: 'Let the captains fight it', desc: 'Settled at once, with the usual stances.', side: `win ${_oddsHtml(odds.win)} · ~${Math.round((odds.loss || 0) * 100)}% losses`, act: 'battleAct', args: ['captains'] },
            ], 'Before the first blow');
            html += '<div style="font-size:11px; color:#9d937c; margin:-4px 0 4px;">Or call the stances phase by phase:</div>';
        }
        if (!b.done) {
            const ph = FieldBattle.currentPhase(b);
            html += rowList(FieldBattle.options(b).map(o => {
                const sub = o.id === 'withdraw'
                    ? `<span style="color:#f0b35a;">~${Math.round(o.loss * 100)}% of your force lost</span>`
                    : `win ${_oddsHtml(o.win)} · ~${Math.round((o.loss || 0) * 100)}% losses`;
                return _optionRow('battleAct', [o.id], o, sub);
            }), `${ph.icon} Phase ${b.sim.phase + 1} of ${FieldBattle.config().phases.length}: ${esc(ph.name)} — choose your stance`);
        } else {
            const r = b.result || {};
            const title = r.withdrew ? '🏳️ You withdrew from the field' : r.victory ? '🏆 Victory!' : '💀 Defeat';
            const color = r.withdrew ? '#f0b35a' : r.victory ? '#8fd18a' : '#e0846a';
            let rep = `<div style="font-family:var(--font-display); font-size:16px; margin:0 0 6px; color:${color};">${title}</div><div style="font-size:12px; line-height:1.6; color:#cbbf9f;">`;
            if (b.reportText) rep += `<div>${esc(b.reportText)}</div>`;
            else {
                if (r.loot > 0) rep += `<div>💰 Gold looted: <strong style="color:#ffcf6a;">${r.loot}</strong></div>`;
                if (r.armsTaken) rep += `<div>⚔️ Arms stripped from the fallen: ${Object.entries(r.armsTaken).map(([k, v]) => { const nm = Arms.nameOf(k).toLowerCase(); return `${v} ${nm}${v > 1 && !/s$/.test(nm) ? 's' : ''}`; }).join(', ')}</div>`;
                if (Arms.quiverNote(r.quivers)) rep += `<div>${esc(Arms.quiverNote(r.quivers))}</div>`;
                rep += `<div>⚔️ Lost ${r.casualties || 0} soldier${r.casualties === 1 ? '' : 's'}${r.wounded ? `; ${r.wounded} carried off wounded` : ''}.</div>`;
                if (r.karmaChange < 0) rep += `<div style="color:#e0846a;">😈 Karma: ${r.karmaChange}</div>`;
                if (r.renownChange > 0) rep += `<div style="color:#7cc7e8;">⭐ Renown +${r.renownChange}</div>`;
                if (r.captured) rep += `<div style="color:#e0846a;">⛓️ Captured into servitude for ${r.servitudeDays} days. ${r.goldConfiscated || 0} gold confiscated.</div>`;
                if (r.personalWound) rep += `<div style="color:#e0846a;">${r.personalWound.icon} You were wounded: ${esc(r.personalWound.name)}.</div>`;
                for (const up of r.skillUps || []) rep += `<div style="color:#9fd6a8;">${up.icon} ${esc(up.text)}</div>`;
            }
            rep += '</div>';
            html += card(rep, { tone: r.withdrew ? 'warn' : r.victory ? 'good' : 'bad' });
            html += `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD}width:100%; padding:9px; margin-top:8px;">Continue</button>`;
        }
        html += '</div>';
        game.ui.showCustomPanel(`⚔️ Battle: ${b.enemyName}`, html);
    },

    /** Fight the next phase with a stance, or withdraw. */
    battleAct(game, stance) {
        const b = game._fieldBattle;
        if (!b || b.done) { ActionMenu.showFieldBattle(game); return; }
        if (stance === 'field') {
            // On the ground (ui/innerMapBattle.js): the result comes back when the field is decided
            game.ui.hideCustomPanel();
            InnerMapBattle.open(game, b, {
                onDone: () => {
                    ActionMenu._settleFieldBattle(game);
                    game.ui.updateStats(game.player, game.world);
                    ActionMenu.showFieldBattle(game);
                    if (b.done && game._fieldBattleSource && game._fieldBattleSource.kind === 'attack' && !game.isProcessingTurn) game.endDay();
                },
            }).then((ok) => {
                // No map to fight on: the captains have it after all
                if (!ok && !b.done) ActionMenu.battleAct(game, 'captains');
            });
            return;
        }
        if (stance === 'captains') {
            FieldBattle.auto(game.player, b, game.world);
        } else FieldBattle.play(game.player, b, stance, game.world);
        if (b.done) ActionMenu._settleFieldBattle(game);
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showFieldBattle(game);
        // An attack you chose takes the day, as it always has
        if (b.done && game._fieldBattleSource && game._fieldBattleSource.kind === 'attack') game.endDay();
    },

    /**
     * A battle is over (fought out or auto-resolved): the wound roll, the
     * report, and the battle handed back. Returns the report text.
     */
    _settleFieldBattle(game) {
        const b = game._fieldBattle;
        if (!b || !b.done || b.settled) return b && b.reportText;
        b.settled = true;
        const src = game._fieldBattleSource || { kind: 'attack' };
        const r = b.result || {};
        if (src.kind === 'encounter') {
            const unit = game.world.units.find(u => u.id === src.unitId) || { name: b.enemyName };
            const out = RoadEncounters.battleOutcome(game.player, unit, game.world, r);
            b.reportText = out.notification.body;
            game.ui.showNotification(out.notification.title, out.notification.body, out.notification.type);
        } else {
            if (!r.withdrew) r.personalWound = Ailments.afterBattle(game.player, game.world, !!r.victory, { sea: r.theatre === 'sea' });
            const how = r.withdrew ? 'You withdrew' : r.victory ? 'Victory' : 'Defeat';
            game.ui.showNotification(r.withdrew ? '🏳️ Withdrawn' : r.victory ? '⚔️ Victory!' : '💀 Defeat',
                `${how} against the ${b.enemyName}: ${r.casualties || 0} soldiers lost${r.loot > 0 ? `, ${r.loot} gold looted` : ''}.`,
                r.withdrew ? 'warning' : r.victory ? 'success' : 'error');
        }
        return b.reportText;
    },
});
