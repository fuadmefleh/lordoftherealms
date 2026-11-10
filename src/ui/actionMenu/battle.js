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
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, CARD, esc } from './uiKit.js';
import { RoadEncounters } from '../../player/roadEncounters.js';
import { FieldBattle } from '../../player/fieldBattle.js';
import { Ailments } from '../../systems/ailments.js';

const ODDS_COLOR = { 'very likely': '#7fd07f', likely: '#b5d77f', 'even odds': '#e0b040', risky: '#e08a50', desperate: '#e06060', certain: '#9ecbff' };

function _oddsHtml(chance) {
    const label = FieldBattle.oddsLabel(chance);
    const pct = chance === null || chance === undefined ? '' : ` ~${Math.round(chance * 100)}%`;
    return `<span style="color:${ODDS_COLOR[label] || '#ccc'}; font-weight:bold;">${label}${pct}</span>`;
}

function _bar(label, value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="margin:3px 0; font-size:12px;">${label}: <strong>${Math.round(value)}</strong> / ${Math.round(max)}
        <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin-top:2px;">
            <div style="width:${pct}%; height:100%; background:${color};"></div></div></div>`;
}

function _optionButton(act, args, o, subtitle) {
    const style = (o.can ? (o.isDefault ? BTN_GOLD : BTN_PLAIN) : BTN_OFF) + 'display:block; width:100%; text-align:left; padding:8px 10px; margin:5px 0 0;';
    const attrs = o.can ? `data-am-act="${act}" data-am-args='${esc(JSON.stringify(args))}'` : 'disabled';
    return `<button ${attrs} style="${style}">
        <div>${o.icon} ${esc(o.label || o.name)}${o.cost ? ` <span style="font-weight:normal; opacity:0.8;">(${esc(o.cost)})</span>` : ''} — ${o.can ? subtitle : `<span style="color:#e08a50;">${esc(o.reason)}</span>`}</div>
        <div style="font-weight:normal; font-size:11px; opacity:0.75; margin-top:2px;">${esc(o.hint || o.text || '')}</div>
    </button>`;
}

function _phaseLogHtml(log) {
    if (!log || !log.length) return '';
    return `<div style="${CARD}"><div style="font-size:11px; color:#888; text-transform:uppercase; margin-bottom:4px;">The battle so far</div>${log.map(e => {
        const feint = e.feint === true ? ' — they took the bait!' : e.feint === false ? ' — they did not bite' : '';
        const rout = e.routed === 'enemy' ? ' <span style="color:#7fd07f;">They break and run!</span>' : e.routed === 'player' ? ' <span style="color:#e06060;">Your line breaks!</span>' : '';
        const edge = e.phase === 'withdraw' ? '' : ` · your edge ${Math.round(e.share * 100)}%`;
        return `<div style="font-size:12px; margin:2px 0;">${e.icon} <strong>${esc(e.name)}</strong> (${esc(e.stanceName)})${edge} · you lost ${e.lost} unit${e.lost === 1 ? '' : 's'}${e.enemyLost ? `, they lost ~${e.enemyLost} strength` : ''}${feint}${rout}</div>`;
    }).join('')}</div>`;
}

Object.assign(ActionMenu, {
    /** A hostile has closed in: the choices, with their odds. */
    showEncounter(game, unitId) {
        const { player, world } = game;
        const unit = world.units.find(u => u.id === unitId && !u.destroyed);
        if (!unit) { game._pendingEncounter = null; return; }
        const opts = RoadEncounters.options(player, unit, world);
        const kind = RoadEncounters.kindOf(unit);
        let html = `<div style="padding:4px 2px;">
            <div style="text-align:center; margin-bottom:8px;"><span style="font-size:40px;">${unit.icon || '⚔️'}</span>
                <h3 style="margin:4px 0; color:#ff8a65;">${esc(unit.name)} ${kind === 'beast' ? 'on your trail' : 'bar the road'}</h3>
                <div style="font-size:12px; color:#aaa;">Their strength: <strong style="color:#ff8a65;">${unit.strength}</strong>
                ${opts.find(o => o.battle) ? '' : ' · You have no soldiers here'} · 💰 ${Math.floor(player.gold || 0)} gold · ❤️ ${Math.round(player.health || 0)}</div>
            </div>`;
        for (const o of opts) html += _optionButton('encounterAct', [unit.id, o.id], o, _oddsHtml(o.chance));
        html += `<div style="font-size:11px; color:#777; margin-top:8px;">Walk away from this and they fall on you at day's end.</div></div>`;
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
        const color = n.type === 'success' ? '#7fd07f' : n.type === 'warning' ? '#e0b040' : '#e06060';
        game.ui.showCustomPanel(n.title, `<div style="padding:8px;"><p style="color:${color}; line-height:1.5;">${esc(n.body)}</p>
            <button data-am-act="closePanelAndRefresh" style="${BTN_PLAIN}width:100%; padding:9px; margin-top:8px;">Continue</button></div>`);
        game.ui.showNotification(n.title, n.body, n.type);
    },

    /** The battle in progress: the field, the phases fought, the next choice. */
    showFieldBattle(game) {
        const b = game._fieldBattle;
        if (!b) { game.ui.hideCustomPanel(); return; }
        let html = `<div style="padding:4px 2px;">
            <div style="display:flex; gap:12px;"><div style="flex:1;">${_bar('⚔️ Your force', b.sim.pStr, b.pStr0, '#4fc3f7')}</div>
            <div style="flex:1;">${_bar(`${b.enemyIcon} ${esc(b.enemyName)}`, b.sim.eStr, b.eStr0, '#ff8a65')}</div></div>
            <div style="font-size:11px; color:#888; margin:4px 0;">📐 ${esc((b.terrainId || 'mixed ground').replace(/_/g, ' '))} · ${esc(b.weather || 'clear')} · counters ×${b.pCounter.toFixed(2)} vs ×${b.eCounter.toFixed(2)}${b.ambushed ? ' · <span style="color:#e08a50;">they caught you unready</span>' : ''}${b.commanderSlain ? ' · <span style="color:#ce93d8;">your assassins slew their commander</span>' : ''}</div>`;
        html += _phaseLogHtml(b.log);
        if (!b.done) {
            const ph = FieldBattle.currentPhase(b);
            html += `<div style="margin-top:8px; font-weight:bold; color:var(--gold);">${ph.icon} Phase ${b.sim.phase + 1} of ${FieldBattle.config().phases.length}: ${esc(ph.name)} — choose your stance</div>`;
            for (const o of FieldBattle.options(b)) {
                const sub = o.id === 'withdraw'
                    ? `<span style="color:#e0b040;">~${Math.round(o.loss * 100)}% of your force lost</span>`
                    : `win ${_oddsHtml(o.win)} · ~${Math.round((o.loss || 0) * 100)}% losses`;
                html += _optionButton('battleAct', [o.id], o, sub);
            }
        } else {
            const r = b.result || {};
            const title = r.withdrew ? '🏳️ You withdrew from the field' : r.victory ? '🏆 Victory!' : '💀 Defeat';
            const color = r.withdrew ? '#e0b040' : r.victory ? '#7fd07f' : '#e06060';
            html += `<div style="${CARD}"><h3 style="margin:2px 0 6px; color:${color};">${title}</h3>`;
            if (b.reportText) html += `<div style="font-size:12px; line-height:1.5;">${esc(b.reportText)}</div>`;
            else {
                if (r.loot > 0) html += `<div>💰 Gold looted: <strong style="color:#ffd700;">${r.loot}</strong></div>`;
                if (r.armsTaken) html += `<div>⚔️ Arms stripped from the fallen: ${Object.entries(r.armsTaken).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')}</div>`;
                html += `<div>⚔️ Lost ${r.casualties || 0} soldier${r.casualties === 1 ? '' : 's'}${r.wounded ? `; ${r.wounded} carried off wounded` : ''}.</div>`;
                if (r.karmaChange < 0) html += `<div style="color:#ff6666;">😈 Karma: ${r.karmaChange}</div>`;
                if (r.renownChange > 0) html += `<div style="color:#4fc3f7;">⭐ Renown +${r.renownChange}</div>`;
                if (r.captured) html += `<div style="color:#ff6666;">⛓️ Captured into servitude for ${r.servitudeDays} days. ${r.goldConfiscated || 0} gold confiscated.</div>`;
                if (r.personalWound) html += `<div style="color:#e57373;">${r.personalWound.icon} You were wounded: ${esc(r.personalWound.name)}.</div>`;
                for (const up of r.skillUps || []) html += `<div style="color:#9fd6a8;">${up.icon} ${esc(up.text)}</div>`;
            }
            html += '</div>';
            html += `<button data-am-act="closePanelAndRefresh" style="${BTN_PLAIN}width:100%; padding:9px; margin-top:8px;">Continue</button>`;
        }
        html += '</div>';
        game.ui.showCustomPanel(`⚔️ Battle: ${b.enemyName}`, html);
    },

    /** Fight the next phase with a stance, or withdraw. */
    battleAct(game, stance) {
        const b = game._fieldBattle;
        if (!b || b.done) { ActionMenu.showFieldBattle(game); return; }
        FieldBattle.play(game.player, b, stance, game.world);
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
