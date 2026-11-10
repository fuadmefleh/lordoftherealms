// ActionMenu — combat methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { Traits } from '../../systems/traits.js';
import { Ailments } from '../../systems/ailments.js';
import { Sieges } from '../../systems/sieges.js';
import { siegePanelHtml, siegeResultHtml } from './siegePanel.js';
import { FieldBattle } from '../../player/fieldBattle.js';
import { fieldChoiceHtml } from './uiKit.js';
import { InnerMapBattle } from '../innerMapBattle.js';
import { Arms } from '../../systems/arms.js';
import { openLordAudience, lordAudienceAct } from './lordAudience.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerEffects, Treasures } from './_imports.js';

/** Battle-report lines for soldiers saved by surgeons and a slain enemy commander. */
function battleExtrasHtml(result) {
    let html = '';
    if (result.wounded > 0) {
        html += `<div style="color: #81c784;">💊 Wounded but saved by your surgeons: ${result.wounded} (half strength for ${PlayerMilitary.WOUNDED_DAYS} days)</div>`;
    }
    if (result.navalSupport > 0) {
        html += result.theatre === 'sea'
            ? `<div style="color: #4fc3f7;">⛵ Your war galleys fought at sea (+${result.navalSupport} strength)</div>`
            : `<div style="color: #4fc3f7;">⛵ Your war galleys blockaded the harbour (+${result.navalSupport} strength)</div>`;
    }
    if (result.shipSupport > 0) {
        html += `<div style="color: #4fc3f7;">🚢 Your ship joined the fight (+${result.shipSupport} strength)</div>`;
    }
    if (result.commanderSlain) {
        html += `<div style="color: #ce93d8;">🗡️ Your assassins slew the enemy commander — their ranks broke!</div>`;
    }
    if (result.personalWound) {
        const w = result.personalWound;
        html += `<div style="color: #e57373;">${w.icon} You were wounded in the fighting: ${w.name}${w.text ? ` (${w.text})` : ''}. See a physician.</div>`;
    }
    return html;
}

/** The estimated odds of a phased battle against `unit` (default stances; draws nothing). */
function _attackOddsHtml(game, unit) {
    const { enemy, ctx } = FieldBattle.unitEnemy(game.player, unit, game.world);
    const est = FieldBattle.preview(game.player, enemy, game.world, ctx);
    if (!est) return '';
    return `<div style="font-size:12px; color:#ccc;">Estimated: win ~${Math.round(est.win * 100)}% · ~${Math.round(est.loss * 100)}% of your force lost (default stances; you choose a stance each phase)</div>`;
}

/** You fought in the line yourself: maybe a wound (systems/ailments.js). */
function _rollBattleWound(game, result) {
    if (!result || result.noArmy || (result.success === false && result.reason)) return;
    result.personalWound = Ailments.afterBattle(game.player, game.world, !!result.victory, { sea: result.theatre === 'sea' });
}

Object.assign(ActionMenu, {
    /**
     * Show siege confirmation panel for attacking a settlement
     */
    showSiegeConfirm(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) {
            game.ui.showNotification('No Settlement', 'There is no settlement here to attack.', 'default');
            return;
        }
        // A siege in progress here: the siege panel (no AP for opening it)
        if (Sieges.activeAt(game.player, tile.q, tile.r)) {
            ActionMenu._pendingAP = null;
            ActionMenu.showSiegePanel(game);
            return;
        }

        // At a port your war galleys blockade the harbour and add to the assault
        const theatre = PlayerMilitary.settlementTheatre(game.world, tile);
        const strengthParts = PlayerMilitary.getTheatreStrengthBreakdown(game.player, theatre);
        const playerStrength = strengthParts.total;
        const garrisonStrength = PlayerMilitary.getSettlementDefense(settlement, game.world);
        const ratio = playerStrength / Math.max(1, garrisonStrength);

        // Odds assessment
        let oddsLabel, oddsColor;
        if (ratio >= 2.0) { oddsLabel = 'Overwhelming Advantage'; oddsColor = '#2ecc71'; }
        else if (ratio >= 1.3) { oddsLabel = 'Favorable Odds'; oddsColor = '#27ae60'; }
        else if (ratio >= 0.8) { oddsLabel = 'Even Fight'; oddsColor = '#f1c40f'; }
        else if (ratio >= 0.5) { oddsLabel = 'Risky — Outmatched'; oddsColor = '#e67e22'; }
        else { oddsLabel = 'Suicidal — Heavily Outmatched'; oddsColor = '#e74c3c'; }

        const kingdom = settlement.kingdom ? game.world.getKingdom(settlement.kingdom) : null;
        const typeIcon = settlement.type === 'capital' ? '🏰' : settlement.type === 'city' ? '🏙️' : settlement.type === 'town' ? '🏘️' : '🏠';

        let html = '<div style="max-height: 500px; overflow-y: auto;">';

        // Settlement info
        html += `
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 48px; margin-bottom: 8px;">${typeIcon}</div>
                <h3 style="color: var(--gold); margin: 4px 0;">${settlement.name}</h3>
                <div style="color: var(--text-secondary); font-size: 12px;">
                    ${settlement.type.charAt(0).toUpperCase() + settlement.type.slice(1)}
                    ${kingdom ? ` — ${kingdom.name}` : ' — Independent'}
                </div>
            </div>
        `;

        // Strength comparison
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <div style="text-align: center; flex: 1;">
                        <div style="color: #4fc3f7; font-size: 11px; margin-bottom: 4px;">YOUR ARMY</div>
                        <div style="font-size: 24px; font-weight: bold; color: #4fc3f7;">${playerStrength}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">${game.player.army.length} units</div>
                        ${strengthParts.naval > 0 ? `<div style="font-size: 11px; color: #4fc3f7;">⛵ incl. ${strengthParts.naval} from galleys blockading the harbour</div>` : ''}
                        ${theatre === 'land' && PlayerMilitary.getNavalStrength(game.player) > 0 ? '<div style="font-size: 11px; color: var(--text-secondary);">⛵ Inland — your galleys cannot join</div>' : ''}
                    </div>
                    <div style="display: flex; align-items: center; color: var(--text-secondary); font-size: 24px;">⚔️</div>
                    <div style="text-align: center; flex: 1;">
                        <div style="color: #e74c3c; font-size: 11px; margin-bottom: 4px;">GARRISON</div>
                        <div style="font-size: 24px; font-weight: bold; color: #e74c3c;">${garrisonStrength}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">Pop: ${Utils.formatNumber(settlement.population)}</div>
                    </div>
                </div>
                <div style="text-align: center; padding: 6px; background: rgba(0,0,0,0.3); border-radius: 4px;">
                    <span style="color: ${oddsColor}; font-weight: bold; font-size: 13px;">${oddsLabel}</span>
                </div>
            </div>
        `;

        // Warnings
        html += `<div style="padding: 10px; background: rgba(231,76,60,0.1); border-left: 3px solid #e74c3c; border-radius: 0 4px 4px 0; margin-bottom: 12px; font-size: 12px;">`;
        html += `<div style="color: #e74c3c; font-weight: bold; margin-bottom: 4px;">⚠️ Consequences of a Siege</div>`;
        html += `<div style="color: var(--text-secondary); line-height: 1.5;">`;
        html += `• Your army camps before the walls: starve the town, build engines, dig mines, storm it or offer terms — day by day<br>`;
        html += `• The camp eats ${Math.ceil(PlayerMilitary.getArmyStrength(game.player) > 0 ? game.player.army.length / Sieges.config().camp.rationsPerUnits : 0)} food a day beyond what it forages; it may sicken and desert<br>`;
        html += `• ${kingdom ? kingdom.name : 'The owner'} may send a relief army<br>`;
        html += `• Investing: reputation ${Sieges.config().investReputation} with ${kingdom ? kingdom.name : 'the defenders'}, karma ${Sieges.config().investKarma}. Taking it by storm:<br>`;
        html += `• Massive karma penalty (-10)<br>`;
        html += `• Reputation with <strong>ALL</strong> kingdoms drops<br>`;
        if (settlement.kingdom) {
            html += `• Reputation with ${kingdom ? kingdom.name : 'defender'} drops by -50<br>`;
        }
        html += `• Settlement population suffers (-30%)<br>`;
        if (settlement.type === 'capital') {
            html += `• <span style="color: #e74c3c; font-weight: bold;">This is a CAPITAL — expect maximum resistance!</span><br>`;
        }
        html += `</div></div>`;

        // Raid option: hit and run instead of a full siege
        const raidStrength = Math.max(1, Math.floor(garrisonStrength * PlayerMilitary.RAID_DEFENSE_SHARE));
        const raidedAgo = settlement.lastRaidedDay != null ? (game.world.day || 0) - settlement.lastRaidedDay : null;
        const raidReady = raidedAgo === null || raidedAgo >= PlayerMilitary.RAID_COOLDOWN_DAYS;
        html += `<div style="padding: 10px; background: rgba(230,126,34,0.1); border-left: 3px solid #e67e22; border-radius: 0 4px 4px 0; margin-bottom: 12px; font-size: 12px;">`;
        html += `<div style="color: #e67e22; font-weight: bold; margin-bottom: 4px;">🔥 Or raid it</div>`;
        html += `<div style="color: var(--text-secondary); line-height: 1.5;">Plunder and withdraw — only part of the garrison (${raidStrength}) turns out. `;
        html += `No conquest. Karma -5, reputation with ${kingdom ? kingdom.name : 'the defenders'} -20 (-30 if it fails), population -10%.`;
        if (!raidReady) html += `<br><span style="color: #e57373;">Raided ${raidedAgo} day(s) ago — nothing worth taking for ${PlayerMilitary.RAID_COOLDOWN_DAYS - raidedAgo} more.</span>`;
        html += `</div></div>`;

        // Buttons
        html += `
            <div style="display: flex; gap: 8px;">
                <button data-am-act="closePanel" style="
                    flex: 1; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px; cursor: pointer; color: white; font-family: var(--font-body); font-size: 13px;">
                    Retreat
                </button>
                <button data-am-act="performRaid" ${raidReady ? '' : 'disabled'} style="
                    flex: 1; padding: 10px; background: rgba(230,126,34,0.25); border: 1px solid rgba(230,126,34,0.6);
                    border-radius: 6px; cursor: ${raidReady ? 'pointer' : 'not-allowed'}; color: #ffb74d; font-weight: bold; font-family: var(--font-body); font-size: 13px; ${raidReady ? '' : 'opacity: 0.5;'}">
                    🔥 RAID
                </button>
                <button data-am-act="performSiege" style="
                    flex: 1; padding: 10px; background: rgba(231,76,60,0.3); border: 1px solid rgba(231,76,60,0.6);
                    border-radius: 6px; cursor: pointer; color: #ff6666; font-weight: bold; font-family: var(--font-body); font-size: 13px;">
                    🏰 LAY SIEGE
                </button>
            </div>
        `;

        html += '</div>';
        game.ui.showCustomPanel(`🏰 Siege — ${settlement.name}`, html);
    },

    /**
     * Raid the settlement on the player's tile: plunder and withdraw.
     */
    performRaid(game) {
        game.ui.hideCustomPanel();
        const tile = game.world.getTile(game.player.q, game.player.r);
        if (!tile || !tile.settlement) {
            game.ui.showNotification('Error', 'No settlement here to raid.', 'error');
            return;
        }
        if (!ActionMenu.commitPendingAP(game)) return;

        const settlement = tile.settlement;
        const result = PlayerMilitary.raidSettlement(game.player, settlement, tile, game.world);
        if (result.success === false && result.reason) {
            game.ui.showNotification('Cannot Raid', result.reason, 'error');
            return;
        }
        _rollBattleWound(game, result);

        let html = '<div style="padding: 10px; text-align: center;">';
        if (result.victory) {
            html += `<span style="font-size: 48px;">🔥</span><h3 style="color: #ffb74d; margin: 5px 0;">Raid Successful</h3>`;
            html += `<p style="color: #aaa;">Your soldiers sack ${settlement.name} and ride off before help arrives.</p>`;
            html += `<div style="font-size: 13px; line-height: 1.6; text-align: left; background: rgba(230,126,34,0.1); padding: 10px; border-radius: 6px;">`;
            html += `<div>💰 Plunder: <strong style="color: #ffd700;">${result.plunder}</strong></div>`;
        } else {
            html += `<span style="font-size: 48px;">💀</span><h3 style="color: #ff6666; margin: 5px 0;">Raid Repelled</h3>`;
            html += `<p style="color: #aaa;">The defenders of ${settlement.name} drive you off.</p>`;
            html += `<div style="font-size: 13px; line-height: 1.6; text-align: left; background: rgba(231,76,60,0.1); padding: 10px; border-radius: 6px;">`;
        }
        if (result.casualties > 0) html += `<div style="color: #ff9800;">⚠️ Soldiers lost: ${result.casualties}</div>`;
        html += battleExtrasHtml(result);
        html += `<div style="color: #ff6666;">😈 Karma and reputation with ${settlement.name}'s kingdom suffer.</div>`;
        html += `</div><button data-am-act="closePanelAndRefresh" style="width: 100%; padding: 10px; margin-top: 10px; background: #444; border: 1px solid #666; border-radius: 6px; color: #eee; cursor: pointer; font-size: 14px;">Continue</button></div>`;

        game.ui.showCustomPanel(result.victory ? '🔥 Raid' : '⚔️ Defeat', html);
        game.ui.updateStats(game.player, game.world);
        game.endDay();
    },

    /**
     * Invest the settlement on the player's tile: the siege begins
     * (systems/sieges.js), then the siege panel opens.
     */
    performSiege(game) {
        game.ui.hideCustomPanel();
        const tile = game.world.getTile(game.player.q, game.player.r);
        if (!tile || !tile.settlement) {
            game.ui.showNotification('Error', 'No settlement here to attack.', 'error');
            return;
        }
        const check = Sieges.canInvest(game.player, game.world, tile);
        if (!check.ok) {
            ActionMenu._pendingAP = null;
            game.ui.showNotification('Cannot Besiege', check.reason, 'error');
            return;
        }
        if (!ActionMenu.commitPendingAP(game)) return;
        const res = Sieges.invest(game.player, game.world, tile);
        if (!res.success) {
            game.ui.showNotification('Cannot Besiege', res.reason, 'error');
            return;
        }
        if (res.siege.relief) {
            game.ui.showNotification('🚩 Relief Expected', `Scouts report ${res.siege.relief.name} gathering to relieve ${res.siege.name}.`, 'warning');
        }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showSiegePanel(game);
    },

    /** The siege panel: both sides' state, the stance, works, terms and the relief warning. */
    showSiegePanel(game) {
        const info = Sieges.describe(game.player, game.world);
        if (!info) {
            game.ui.showNotification('No Siege', 'You are not besieging anything.', 'default');
            return;
        }
        game.ui.showCustomPanel(`🏰 Siege of ${info.siege.name} — day ${info.day}`, siegePanelHtml(game.player, info));
    },

    /** Buttons of the siege panel: data-am-act="siegeAct" data-am-args='["act", "arg"]'. */
    siegeAct(game, act, arg = null) {
        const player = game.player;
        const world = game.world;
        const s = Sieges.active(player);
        if (!s) { game.ui.hideCustomPanel(); return; }
        const C = Sieges.config();
        const spend = (cost) => {
            if ((player.actionPoints || 0) < cost) {
                game.ui.showNotification('⚡ Not Enough Action Points', `This needs ${cost} AP but you have ${player.actionPoints || 0}. Wait a day.`, 'error');
                return false;
            }
            player.actionPoints -= cost;
            return true;
        };
        if (act === 'stance') {
            const [stance, work] = String(arg).split(':');
            const res = Sieges.setStance(player, world, stance, work || null);
            if (!res.success) game.ui.showNotification('🏰 Siege', res.reason, 'error');
            game.ui.updateStats(player, world);
            ActionMenu.showSiegePanel(game);
            return;
        }
        if (act === 'wait') {
            game.ui.hideCustomPanel();
            game.endDay();
            if (Sieges.active(player)) ActionMenu.showSiegePanel(game);
            return;
        }
        if (act === 'lift') {
            const res = Sieges.lift(player, world);
            game.ui.hideCustomPanel();
            game.ui.showNotification('🏳️ Siege Lifted', res.text || 'You march away.', 'info');
            return;
        }
        // Storming the walls or meeting the relief: in the streets / on the ground yourself, or the captains' roll
        const [arg0, how] = String(arg == null ? '' : arg).split('|');
        if ((act === 'storm' || act === 'relief') && how !== 'captains') {
            if ((player.actionPoints || 0) < C.storm.apCost) { spend(C.storm.apCost); return; }
            game.ui.showCustomPanel(act === 'storm' ? `⚔️ Storm ${s.name}` : '🚩 The Relief Host', fieldChoiceHtml(
                ['siegeAct', act === 'storm' ? 'stormField' : 'reliefField', arg0],
                ['siegeAct', act, `${arg0}|captains`],
                act === 'storm' ? `Fought in ${s.name}'s own streets: the garrison holds them, your army comes on from outside the walls.` : undefined));
            return;
        }
        if (act === 'stormField' || act === 'reliefField') {
            const storm = act === 'stormField';
            const fight = storm ? Sieges.stormBattle(player, world) : Sieges.reliefBattle(player, world);
            if (!fight) { game.ui.showNotification('🏰 Siege', storm ? 'There is no siege to storm.' : 'The relief host is not within reach.', 'error'); return; }
            if (!spend(C.storm.apCost)) return;
            const done = (fought) => {
                const r = storm ? Sieges.storm(player, world, { sack: arg0 === 'sack', combatResult: fought })
                    : Sieges.fightRelief(player, world, { combatResult: fought });
                if (r.success === false) { game.ui.showNotification('🏰 Siege', r.reason, 'error'); return; }
                _rollBattleWound(game, r);
                game.ui.updateStats(player, world);
                game.ui.showCustomPanel(storm ? (r.victory ? '⚔️ The Walls Are Carried' : '⚔️ Assault Repelled') : (r.victory ? '🚩 Relief Host Broken' : '🚩 Driven Off'),
                    siegeResultHtml(r, battleExtrasHtml(r), !!Sieges.active(player)));
            };
            InnerMapBattle.start(game, {
                ...fight, layout: storm ? 'assault' : null,
                title: storm ? `The storming of ${s.name}` : `Against ${fight.enemy.name}`,
                onDone: (fought) => { if (fought) done(fought); },
            }).then((ok) => {
                // No ground to fight on: the captains' roll after all
                if (!ok) done(null);
            });
            return;
        }
        let title = '🏰 Siege';
        let result;
        if (act === 'storm') {
            if (!spend(C.storm.apCost)) return;
            result = Sieges.storm(player, world, { sack: arg0 === 'sack' });
            if (result.success === false) { game.ui.showNotification('Cannot Storm', result.reason, 'error'); return; }
            _rollBattleWound(game, result);
            title = result.victory ? '⚔️ The Walls Are Carried' : '⚔️ Assault Repelled';
        } else if (act === 'terms') {
            if (!spend(C.terms.apCost)) return;
            result = Sieges.negotiate(player, world, arg);
            if (result.success === false) { game.ui.showNotification('🕊️ Parley', result.reason, 'error'); return; }
            title = result.accepted ? '🕊️ Terms Accepted' : '🕊️ Terms Refused';
        } else if (act === 'relief') {
            if (!spend(C.storm.apCost)) return;
            result = Sieges.fightRelief(player, world);
            if (result.success === false) { game.ui.showNotification('🚩 Relief', result.reason, 'error'); return; }
            _rollBattleWound(game, result);
            title = result.victory ? '🚩 Relief Host Broken' : '🚩 Driven Off';
        } else {
            return;
        }
        game.ui.updateStats(player, world);
        const html = siegeResultHtml(result, battleExtrasHtml(result), !!Sieges.active(player));
        game.ui.showCustomPanel(title, html);
    },

    /**
     * Show attack confirmation for a world unit
     */
    showAttackConfirm(game, tile, actionType) {
        // Find units on this tile
        const unitsOnTile = game.world.units.filter(u => u.q === game.player.q && u.r === game.player.r && !u.destroyed);
        if (unitsOnTile.length === 0) {
            game.ui.showNotification('No Target', 'There are no units here to attack.', 'default');
            return;
        }

        let html = '<div style="padding:10px;">';
        html += '<p style="margin-bottom:10px;color:#ccc;">Choose a target to engage in combat:</p>';

        // On the water your galleys (and the ship you're aboard) fight; ashore only soldiers
        const hereTile = game.world.getTile(game.player.q, game.player.r);
        const theatre = PlayerMilitary.tileTheatre(hereTile);
        const playerStr = PlayerMilitary.getTheatreStrength(game.player, theatre);
        for (const unit of unitsOnTile) {
            const dangerColor = unit.strength > playerStr ? '#ff6666' : '#66ff66';
            html += `<button data-am-act="performAttack" data-am-args='["${unit.id}"]' style="
                display:flex; align-items:center; gap:10px; width:100%; padding:10px;
                margin-bottom:8px; background:#2a2a2a; border:1px solid #555;
                border-radius:6px; cursor:pointer; color:#eee; text-align:left;
            ">
                <span style="font-size:28px;">${unit.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold;">${unit.name}</div>
                    <div style="font-size:12px; color:#aaa;">Population: ${unit.population} | Strength: <span style="color:${dangerColor}">${unit.strength}</span></div>
                    ${_attackOddsHtml(game, unit)}
                    <div style="font-size:11px; color:#888;">${unit.type === 'caravan' || unit.type === 'ship' || unit.type === 'fishing_boat' ? '⚠️ Attacking traders hurts your karma' : unit.type === 'patrol' ? '⚠️ Attacking patrols angers kingdoms' : '💀 Hostile unit'}</div>
                </div>
            </button>`;
        }

        html += `<div style="margin-top:8px; padding:8px; background:#1a1a2e; border-radius:4px; font-size:12px; color:#aaa;">
            Your ${theatre === 'sea' ? 'strength at sea' : 'army strength'}: <strong style="color:#4fc3f7;">${playerStr}</strong> (${game.player.army.length} units)
            ${theatre === 'land' && PlayerMilitary.getNavalStrength(game.player) > 0 ? '<br>⛵ Your war galleys cannot fight on land.' : ''}
            ${theatre === 'sea' ? '<br>⛵ At sea your galleys fight at full strength, soldiers from the decks at half.' : ''}
        </div>`;
        html += '</div>';

        game.ui.showCustomPanel('⚔️ Attack Unit', html);
    },

    /**
     * Execute attack against a world unit
     */
    performAttack(game, unitId) {
        game.ui.hideCustomPanel();
        if (!ActionMenu.commitPendingAP(game)) return;

        const unit = game.world.units.find(u => u.id === unitId && !u.destroyed);
        if (!unit) {
            game.ui.showNotification('Target Gone', 'The unit is no longer here.', 'default');
            return;
        }

        // Your own battle is fought in phases, a stance before each (player/fieldBattle.js)
        if (game._fieldBattle && !game._fieldBattle.done) {
            FieldBattle.auto(game.player, game._fieldBattle, game.world);
            ActionMenu._settleFieldBattle(game);
        }
        const { enemy, ctx } = FieldBattle.unitEnemy(game.player, unit, game.world);
        const battle = FieldBattle.start(game.player, enemy, game.world, ctx);
        if (battle.success !== false) {
            game._fieldBattle = battle;
            game._fieldBattleSource = { kind: 'attack', unitId: unit.id };
            ActionMenu.showFieldBattle(game);
            return;
        }

        const result = PlayerMilitary.attackUnit(game.player, unit, game.world);
        _rollBattleWound(game, result);

        let html = '<div style="padding:10px;">';

        if (result.noArmy) {
            html += `<p style="color:#ff6666;">${result.reason || 'You have no army to fight with! Recruit soldiers first.'}</p>`;
        } else if (result.victory) {
            html += `<div style="text-align:center; margin-bottom:10px;">
                <span style="font-size:48px;">🏆</span>
                <h3 style="color:#66ff66; margin:5px 0;">Victory!</h3>
                <p style="color:#aaa;">You defeated the ${result.enemyName}!</p>
            </div>`;
            html += `<div style="background:#1a2e1a; padding:8px; border-radius:4px; margin-bottom:8px;">`;
            html += `<div>💰 Gold looted: <strong style="color:#ffd700;">${result.loot}</strong></div>`;
            if (result.armsTaken) html += `<div style="margin-top:4px;">⚔️ Arms stripped from the fallen: ${Object.entries(result.armsTaken).map(([k, v]) => { const nm = Arms.nameOf(k).toLowerCase(); return `${v} ${nm}${v > 1 && !/s$/.test(nm) ? 's' : ''}`; }).join(', ')}</div>`;
            if (Arms.quiverNote(result.quivers)) html += `<div style="margin-top:4px;">${Arms.quiverNote(result.quivers)}</div>`;
            if (result.inventoryLoot && Object.keys(result.inventoryLoot).length > 0) {
                html += `<div style="margin-top:4px;">📦 Supplies captured:</div>`;
                for (const [item, qty] of Object.entries(result.inventoryLoot)) {
                    const good = PlayerEconomy.GOODS[item.toUpperCase()];
                    const label = item === 'gold' ? '💰 Coin' : good ? `${good.icon} ${good.name}` : item.replace(/_/g, ' ');
                    const hint = Treasures.info(item) ? ' <span style="color:#ce93d8; font-size:11px;">(treasure — see Inventory)</span>' : '';
                    html += `<div style="margin-left:12px; color:#aaa;">• ${label}: ${qty}${hint}</div>`;
                }
            }
            if (result.lootLeftBehind && Object.keys(result.lootLeftBehind).length > 0) {
                html += `<div style="margin-top:4px; color:#ff9800;">🎒 Packs full — left behind: ${Object.entries(result.lootLeftBehind).map(([k, v]) => `${v} ${k}`).join(', ')}</div>`;
            }
            html += `</div>`;
            if (result.casualties > 0) {
                html += `<div style="color:#ff9800;">⚠️ You lost ${result.casualties} soldier${result.casualties > 1 ? 's' : ''} in the battle.</div>`;
            }
            html += battleExtrasHtml(result);
            if (result.karmaChange < 0) {
                html += `<div style="color:#ff6666;">😈 Karma: ${result.karmaChange}</div>`;
            }
            if (result.renownChange > 0) {
                html += `<div style="color:#4fc3f7;">⭐ Renown +${result.renownChange}</div>`;
            }

            if (result.tactics) {
                const terrain = result.tactics.terrainId || 'mixed ground';
                html += `<div style="margin-top:8px; font-size:11px; color:var(--text-secondary); padding:6px; background:rgba(79,195,247,0.08); border-radius:4px;">`;
                html += `📐 Tactical: counters x${result.tactics.playerCounterMult} • terrain x${result.tactics.playerTerrainMult} (${terrain}) • morale ${result.tactics.playerMorale}`;
                if (result.tactics.moraleBreak === 'enemy') html += `<br>😨 Enemy morale broke and they fled.`;
                html += `</div>`;
            }
        } else {
            html += `<div style="text-align:center; margin-bottom:10px;">
                <span style="font-size:48px;">💀</span>
                <h3 style="color:#ff6666;">Defeat!</h3>
                <p style="color:#aaa;">The ${result.enemyName} overpowered you!</p>
            </div>`;
            html += `<div style="background:#2e1a1a; padding:8px; border-radius:4px; margin-bottom:8px;">`;
            html += `<div style="color:#ff9800;">Lost ${result.casualties} soldier${result.casualties > 1 ? 's' : ''}.</div>`;
            if (result.captured) {
                html += `<div style="color:#ff6666; margin-top:4px;">⛓️ You have been captured into indentured servitude for ${result.servitudeDays} days!</div>`;
                html += `<div style="color:#ffd700;">💰 ${result.goldConfiscated} gold confiscated.</div>`;
            }
            html += battleExtrasHtml(result);
            html += `</div>`;

            if (result.tactics) {
                const terrain = result.tactics.terrainId || 'mixed ground';
                html += `<div style="margin-top:8px; font-size:11px; color:var(--text-secondary); padding:6px; background:rgba(79,195,247,0.08); border-radius:4px;">`;
                html += `📐 Tactical: counters x${result.tactics.playerCounterMult} • terrain x${result.tactics.playerTerrainMult} (${terrain}) • morale ${result.tactics.playerMorale}`;
                if (result.tactics.moraleBreak === 'player') html += `<br>😨 Your force broke and fled.`;
                html += `</div>`;
            }
        }

        html += `<button data-am-act="closePanelAndRefresh" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel(result.victory ? '⚔️ Victory!' : '⚔️ Defeat', html);
        game.ui.updateStats(game.player, game.world);
        game.endDay();
    },

    /**
     * Royal Audience with a lord's party on the road — a ConversationScene
     * (lordAudience.js). The meeting* methods are its acts, kept as entry points.
     */
    showLordMeetingMenu(game, tile, actionType) {
        openLordAudience(game, actionType.unitId);
    },

    meetingImproveRelations(game, lordUnitId) { lordAudienceAct(game, lordUnitId, 'gold'); },
    meetingPresentTreasure(game, lordUnitId, itemId) { lordAudienceAct(game, lordUnitId, `t:${itemId}`); },
    meetingRequestTrade(game, lordUnitId) { lordAudienceAct(game, lordUnitId, 'trade'); },
    meetingPledgeAllegiance(game, lordUnitId) { lordAudienceAct(game, lordUnitId, 'oath'); },
    meetingRenounceAllegiance(game, lordUnitId) { lordAudienceAct(game, lordUnitId, 'oath'); },
    meetingRequestTitle(game, lordUnitId) { lordAudienceAct(game, lordUnitId, 'office'); },
    meetingRequestAid(game, lordUnitId) { lordAudienceAct(game, lordUnitId, 'aid'); },
    meetingDemandTribute(game, lordUnitId) { lordAudienceAct(game, lordUnitId, 'tribute'); },
    meetingAskAboutRealm(game, lordUnitId) { lordAudienceAct(game, lordUnitId, 'realm'); },
});
