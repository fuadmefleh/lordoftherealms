// ActionMenu — combat methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerEffects } from './_imports.js';

/** Battle-report lines for soldiers saved by surgeons and a slain enemy commander. */
function battleExtrasHtml(result) {
    let html = '';
    if (result.wounded > 0) {
        html += `<div style="color: #81c784;">🩹 Wounded but saved by your surgeons: ${result.wounded} (half strength for ${PlayerMilitary.WOUNDED_DAYS} days)</div>`;
    }
    if (result.commanderSlain) {
        html += `<div style="color: #ce93d8;">🗡️ Your assassins slew the enemy commander — their ranks broke!</div>`;
    }
    return html;
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

        const playerStrength = PlayerMilitary.getArmyStrength(game.player);
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
        html += `<div style="color: #e74c3c; font-weight: bold; margin-bottom: 4px;">⚠️ Consequences of Attack</div>`;
        html += `<div style="color: var(--text-secondary); line-height: 1.5;">`;
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
                    ⚔️ SIEGE
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
     * Execute siege attack against a settlement
     */
    performSiege(game) {
        game.ui.hideCustomPanel();
        if (!ActionMenu.commitPendingAP(game)) return;

        const tile = game.world.getTile(game.player.q, game.player.r);
        if (!tile || !tile.settlement) {
            game.ui.showNotification('Error', 'No settlement here to attack.', 'error');
            return;
        }

        const settlement = tile.settlement;
        const result = PlayerMilitary.attackSettlement(game.player, settlement, tile, game.world);

        if (!result.success && result.reason) {
            game.ui.showNotification('Cannot Attack', result.reason, 'error');
            return;
        }

        let html = '<div style="padding: 10px;">';

        if (result.victory) {
            // Victory panel
            html += `<div style="text-align: center; margin-bottom: 12px;">
                <span style="font-size: 48px;">🏆</span>
                <h3 style="color: #66ff66; margin: 5px 0;">Settlement Conquered!</h3>
                <p style="color: #aaa;">You have taken ${settlement.name}!</p>
            </div>`;

            html += `<div style="background: rgba(46,204,113,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px;">`;
            html += `<div style="font-weight: bold; color: var(--gold); margin-bottom: 6px;">Battle Results</div>`;
            html += `<div style="font-size: 13px; line-height: 1.6;">`;
            html += `<div>💰 Gold plundered: <strong style="color: #ffd700;">${result.plunder}</strong></div>`;
            html += `<div>👑 New owner: <strong style="color: #4fc3f7;">${result.newOwner}</strong></div>`;
            if (result.renownChange > 0) {
                html += `<div>⭐ Renown: <strong style="color: #e67e22;">+${result.renownChange}</strong></div>`;
            }
            if (result.casualties > 0) {
                html += `<div style="color: #ff9800;">⚠️ Soldiers lost: ${result.casualties}</div>`;
            }
            html += battleExtrasHtml(result);
            html += `</div></div>`;

            if (result.capitalCaptured) {
                html += `<div style="padding: 8px; background: rgba(155,89,182,0.15); border: 1px solid rgba(155,89,182,0.3); border-radius: 4px; margin-bottom: 10px; font-size: 12px; color: #bb86fc;">
                    👑 You have captured their <strong>capital city</strong>!
                    ${result.kingdomDestroyed ? '<br>💀 <strong>The entire kingdom has fallen!</strong>' : '<br>The kingdom will relocate its capital.'}
                </div>`;
            }

            html += `<div style="font-size: 11px; color: #ff6666; padding: 6px; background: rgba(231,76,60,0.1); border-radius: 4px;">
                😈 Karma: ${result.karmaChange} | Reputation with all kingdoms damaged
            </div>`;

            if (result.tactics) {
                const terrain = result.tactics.terrainId || 'mixed ground';
                html += `<div style="margin-top:8px; font-size:11px; color:var(--text-secondary); padding:6px; background:rgba(79,195,247,0.08); border-radius:4px;">`;
                html += `📐 Tactical: counters x${result.tactics.playerCounterMult} • terrain x${result.tactics.playerTerrainMult} (${terrain}) • morale ${result.tactics.playerMorale}`;
                if (result.tactics.moraleBreak === 'enemy') html += `<br>😨 Defender morale broke and they fled.`;
                html += `</div>`;
            }
        } else {
            // Defeat panel
            html += `<div style="text-align: center; margin-bottom: 12px;">
                <span style="font-size: 48px;">💀</span>
                <h3 style="color: #ff6666; margin: 5px 0;">Siege Failed!</h3>
                <p style="color: #aaa;">The defenders of ${settlement.name} repelled your assault!</p>
            </div>`;

            html += `<div style="background: rgba(231,76,60,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px;">`;
            html += `<div style="font-size: 13px; line-height: 1.6;">`;
            html += `<div style="color: #ff9800;">⚠️ Soldiers lost: ${result.casualties}</div>`;
            html += battleExtrasHtml(result);
            html += `<div style="color: #ff6666;">😈 Karma: ${result.karmaChange}</div>`;
            if (result.captured) {
                html += `<div style="color: #ff6666; margin-top: 4px;">⛓️ You have been captured into indentured servitude for ${result.servitudeDays} days!</div>`;
                html += `<div style="color: #ffd700;">💰 ${result.goldConfiscated} gold confiscated.</div>`;
            }
            html += `</div></div>`;

            if (result.tactics) {
                const terrain = result.tactics.terrainId || 'mixed ground';
                html += `<div style="margin-top:8px; font-size:11px; color:var(--text-secondary); padding:6px; background:rgba(79,195,247,0.08); border-radius:4px;">`;
                html += `📐 Tactical: counters x${result.tactics.playerCounterMult} • terrain x${result.tactics.playerTerrainMult} (${terrain}) • morale ${result.tactics.playerMorale}`;
                if (result.tactics.moraleBreak === 'player') html += `<br>😨 Your line broke and fled under pressure.`;
                html += `</div>`;
            }
        }

        html += `<button data-am-act="closePanelAndRefresh" style="
            width: 100%; padding: 10px; margin-top: 10px;
            background: #444; border: 1px solid #666; border-radius: 6px;
            color: #eee; cursor: pointer; font-size: 14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel(result.victory ? '⚔️ Victory!' : '⚔️ Defeat', html);
        game.ui.updateStats(game.player, game.world);
        game.endDay();
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

        for (const unit of unitsOnTile) {
            const dangerColor = unit.strength > PlayerMilitary.getArmyStrength(game.player) ? '#ff6666' : '#66ff66';
            html += `<button data-am-act="performAttack" data-am-args='["${unit.id}"]' style="
                display:flex; align-items:center; gap:10px; width:100%; padding:10px;
                margin-bottom:8px; background:#2a2a2a; border:1px solid #555;
                border-radius:6px; cursor:pointer; color:#eee; text-align:left;
            ">
                <span style="font-size:28px;">${unit.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold;">${unit.name}</div>
                    <div style="font-size:12px; color:#aaa;">Population: ${unit.population} | Strength: <span style="color:${dangerColor}">${unit.strength}</span></div>
                    <div style="font-size:11px; color:#888;">${unit.type === 'caravan' || unit.type === 'ship' || unit.type === 'fishing_boat' ? '⚠️ Attacking traders hurts your karma' : unit.type === 'patrol' ? '⚠️ Attacking patrols angers kingdoms' : '💀 Hostile unit'}</div>
                </div>
            </button>`;
        }

        const playerStr = PlayerMilitary.getArmyStrength(game.player);
        html += `<div style="margin-top:8px; padding:8px; background:#1a1a2e; border-radius:4px; font-size:12px; color:#aaa;">
            Your army strength: <strong style="color:#4fc3f7;">${playerStr}</strong> (${game.player.army.length} units)
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

        const result = PlayerMilitary.attackUnit(game.player, unit, game.world);

        let html = '<div style="padding:10px;">';

        if (result.noArmy) {
            html += '<p style="color:#ff6666;">You have no army to fight with! Recruit soldiers first.</p>';
        } else if (result.victory) {
            html += `<div style="text-align:center; margin-bottom:10px;">
                <span style="font-size:48px;">🏆</span>
                <h3 style="color:#66ff66; margin:5px 0;">Victory!</h3>
                <p style="color:#aaa;">You defeated the ${result.enemyName}!</p>
            </div>`;
            html += `<div style="background:#1a2e1a; padding:8px; border-radius:4px; margin-bottom:8px;">`;
            html += `<div>💰 Gold looted: <strong style="color:#ffd700;">${result.loot}</strong></div>`;
            if (result.inventoryLoot && Object.keys(result.inventoryLoot).length > 0) {
                html += `<div style="margin-top:4px;">📦 Supplies captured:</div>`;
                for (const [item, qty] of Object.entries(result.inventoryLoot)) {
                    html += `<div style="margin-left:12px; color:#aaa;">• ${item}: ${qty}</div>`;
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
     * Show lord meeting menu — diplomatic audience with an NPC lord
     */
    showLordMeetingMenu(game, tile, actionType) {
        const player = game.player;
        const world = game.world;

        // Find the lord party unit from the action
        const lordUnit = world.units.find(u => u.type === 'lord_party' && u.id === actionType.unitId && !u.destroyed);
        if (!lordUnit) {
            game.ui.showCustomPanel('👑 Meeting', '<div style="padding:15px; color:#aaa;">The lord has already departed.</div>');
            return;
        }

        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) {
            game.ui.showCustomPanel('👑 Meeting', '<div style="padding:15px; color:#aaa;">This kingdom has no ruler.</div>');
            return;
        }

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;
        const isAllegianceKingdom = player.allegiance === kingdom.id;

        // Determine disposition label and color
        let dispositionLabel, dispositionColor;
        if (totalDisposition >= 50) { dispositionLabel = 'Warm & Welcoming'; dispositionColor = '#4caf50'; }
        else if (totalDisposition >= 20) { dispositionLabel = 'Favorable'; dispositionColor = '#8bc34a'; }
        else if (totalDisposition >= -10) { dispositionLabel = 'Neutral'; dispositionColor = '#ffd54f'; }
        else if (totalDisposition >= -40) { dispositionLabel = 'Cool'; dispositionColor = '#ff9800'; }
        else { dispositionLabel = 'Hostile'; dispositionColor = '#f44336'; }

        // Lord trait descriptions
        const traitNames = lord.traits.map(t => t.name).join(', ') || 'Unremarkable';

        let html = `<div style="padding:15px; max-height:500px; overflow-y:auto;">`;

        // Lord portrait and info
        html += `<div style="text-align:center; margin-bottom:12px;">
            <span style="font-size:48px;">👑</span>
            <h3 style="color:#ffd700; margin:5px 0;">${lord.name}</h3>
            <div style="color:#aaa;">Ruler of <span style="color:#4fc3f7;">${kingdom.name}</span></div>
            <div style="color:#888; font-size:12px;">Age ${lord.age} • ${traitNames}</div>
        </div>`;

        // Stats bar
        html += `<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; margin-bottom:12px; font-size:11px; text-align:center;">
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">⚔️ Martial: ${lord.martial}</div>
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">🗣️ Diplomacy: ${lord.diplomacy}</div>
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">📊 Steward: ${lord.stewardship}</div>
        </div>`;

        // Disposition
        html += `<div style="background:#1a1a2e; padding:8px; border-radius:6px; margin-bottom:12px; text-align:center;">
            <div style="color:#aaa; font-size:11px;">Disposition towards you</div>
            <div style="color:${dispositionColor}; font-size:16px; font-weight:bold;">${dispositionLabel}</div>
            <div style="color:#666; font-size:10px;">Opinion: ${opinion >= 0 ? '+' : ''}${opinion} | Reputation: ${reputation >= 0 ? '+' : ''}${reputation}</div>
        </div>`;

        // Diplomatic options
        html += `<div style="font-weight:bold; color:#ccc; margin-bottom:8px;">Diplomatic Options:</div>`;

        // 1. Improve Relations (always available)
        html += this._meetingOptionButton(
            '🤝', 'Improve Relations',
            'Offer a gift of gold to improve standing',
            `ActionMenu.meetingImproveRelations(game, '${lordUnit.id}')`,
            player.gold >= 50,
            player.gold < 50 ? 'Need at least 50 gold' : null
        );

        // 2. Request Trade Agreement (neutral+ required)
        html += this._meetingOptionButton(
            '⚖️', 'Request Trade Agreement',
            `Better prices in ${kingdom.name} settlements`,
            `ActionMenu.meetingRequestTrade(game, '${lordUnit.id}')`,
            totalDisposition >= -10,
            totalDisposition < -10 ? 'Disposition too low' : null
        );

        // 3. Pledge Allegiance (neutral+ required, not already pledged)
        if (!isAllegianceKingdom) {
            html += this._meetingOptionButton(
                '🏳️', `Pledge to ${kingdom.name}`,
                'Swear fealty — become a vassal of this kingdom',
                `ActionMenu.meetingPledgeAllegiance(game, '${lordUnit.id}')`,
                totalDisposition >= 0,
                totalDisposition < 0 ? 'Must be on neutral terms or better' : null
            );
        } else {
            html += this._meetingOptionButton(
                '🏳️', 'Renounce Allegiance',
                `Leave the service of ${kingdom.name}`,
                `ActionMenu.meetingRenounceAllegiance(game, '${lordUnit.id}')`,
                true, null
            );
        }

        // 4. Request Military Aid (favorable+ required, must be allied/vassal)
        if (isAllegianceKingdom && player.army && player.army.length > 0) {
            html += this._meetingOptionButton(
                '⚔️', 'Request Military Aid',
                'Ask for soldiers to bolster your army',
                `ActionMenu.meetingRequestAid(game, '${lordUnit.id}')`,
                totalDisposition >= 20,
                totalDisposition < 20 ? 'Need favorable disposition' : null
            );
        }

        // 5. Ask about the Realm (always available if not hostile)
        html += this._meetingOptionButton(
            '📜', 'Ask about the Realm',
            `Learn about ${kingdom.name}'s peoples, religion, and history`,
            `ActionMenu.meetingAskAboutRealm(game, '${lordUnit.id}')`,
            totalDisposition >= -40,
            totalDisposition < -40 ? 'Lord refuses to speak with you' : null
        );

        // 6. Demand Tribute (only if powerful army)
        const armyStrength = player.army ? player.army.reduce((s, u) => s + (u.strength || 1), 0) : 0;
        if (armyStrength >= 30) {
            html += this._meetingOptionButton(
                '💰', 'Demand Tribute',
                'Threaten the lord into paying tribute (risky)',
                `ActionMenu.meetingDemandTribute(game, '${lordUnit.id}')`,
                true, null
            );
        }

        // 7. Request Royal Office (must be pledged to this kingdom, no title yet)
        if (typeof Titles !== 'undefined' && isAllegianceKingdom && !player.currentTitle) {
            html += this._meetingOptionButton(
                '🏅', 'Request Royal Office',
                'Ask to be appointed to a political title',
                `ActionMenu.meetingRequestTitle(game, '${lordUnit.id}')`,
                totalDisposition >= 10,
                totalDisposition < 10 ? 'Need favorable disposition (10+)' : null
            );
        }

        // Close button
        html += `<button data-am-act="closePanel" style="
            width:100%; padding:10px; margin-top:12px;
            background:#333; border:1px solid #555; border-radius:6px;
            color:#aaa; cursor:pointer; font-size:14px;
        ">Take Your Leave</button>`;

        html += `</div>`;
        game.ui.showCustomPanel('👑 Royal Audience', html);
    },

    /** Helper to create meeting option buttons */
    _meetingOptionButton(icon, label, description, onclick, enabled, disabledReason) {
        const opacity = enabled ? '1' : '0.4';
        const cursor = enabled ? 'cursor:pointer;' : 'cursor:not-allowed;';
        const clickAttr = enabled ? `onclick="${onclick}"` : '';
        return `<button ${clickAttr} style="
            display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; margin-bottom:6px;
            background:#1a2a1a; border:1px solid #333; border-radius:6px;
            color:#ddd; font-size:13px; text-align:left; ${cursor} opacity:${opacity};
        ">
            <span style="font-size:20px;">${icon}</span>
            <div>
                <div style="font-weight:bold;">${label}</div>
                <div style="color:#888; font-size:11px;">${description}${disabledReason ? ' — <span style=color:#ff6666>' + disabledReason + '</span>' : ''}</div>
            </div>
        </button>`;
    },

    /**
     * Meeting action: Improve Relations — gift gold
     */
    meetingImproveRelations(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        // Gift tiers
        const giftAmount = Math.min(player.gold, Math.max(50, Math.floor(player.gold * 0.1)));
        player.gold -= giftAmount;

        // Reputation boost scales with gift
        // A skilled diplomat (or House Chancellor) makes a gift go further
        const repBoost = PlayerEffects.scaleReputationGain(player, Math.floor(giftAmount / 10));
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + repBoost;

        const lord = kingdom.lord;
        const newOpinion = NPCLords.getLordOpinion(lord, player) + (player.reputation[kingdom.id] || 0);

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">🤝</span>
            <h3 style="color:#4caf50;">Gift Accepted</h3>
            <p style="color:#aaa;">You present ${lord.name} with a gift of <span style="color:#ffd700;">${giftAmount} gold</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#4caf50;">📈 Reputation +${repBoost}</div>
            </div>`;

        // Trait-based flavor text
        if (lord.traits.some(t => t.id === 'greedy')) {
            html += `<p style="color:#ffd700; font-style:italic;">"Most generous... I shall remember this kindness."</p>`;
        } else if (lord.traits.some(t => t.id === 'honorable')) {
            html += `<p style="color:#4fc3f7; font-style:italic;">"I accept your gift in the spirit of friendship."</p>`;
        } else if (lord.traits.some(t => t.id === 'cruel')) {
            html += `<p style="color:#ff9800; font-style:italic;">"A wise tribute. See that it continues."</p>`;
        } else {
            html += `<p style="color:#aaa; font-style:italic;">"Thank you, traveler. You are welcome in our lands."</p>`;
        }

        html += `<button data-am-act="closePanelAndRefresh" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('🤝 Diplomacy', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Request Trade Agreement
     */
    meetingRequestTrade(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;

        // Success chance based on disposition + lord diplomacy
        const baseChance = 0.3 + (totalDisposition / 200) + (lord.diplomacy / 40) + PlayerEffects.negotiationBonus(player);
        const success = Math.random() < Math.min(0.9, Math.max(0.1, baseChance));

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            // Grant trade bonus — stored on player
            if (!player.tradeAgreements) player.tradeAgreements = {};
            player.tradeAgreements[kingdom.id] = { kingdom: kingdom.name, expires: world.day + 90 };

            // Small reputation boost
            if (!player.reputation) player.reputation = {};
            const tradeRep = PlayerEffects.scaleReputationGain(player, 5);
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + tradeRep;

            html += `<span style="font-size:42px;">⚖️</span>
                <h3 style="color:#4caf50;">Agreement Reached!</h3>
                <p style="color:#aaa;">${lord.name} agrees to favorable trade terms.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#4caf50;">📈 10% better prices in ${kingdom.name} for 90 days</div>
                    <div style="color:#4fc3f7;">📈 Reputation +${tradeRep}</div>
                </div>`;
        } else {
            html += `<span style="font-size:42px;">❌</span>
                <h3 style="color:#ff9800;">Declined</h3>
                <p style="color:#aaa;">${lord.name} is not interested in a trade agreement at this time.</p>`;

            if (lord.traits.some(t => t.id === 'cautious')) {
                html += `<p style="color:#ff9800; font-style:italic;">"I must consider the risks more carefully."</p>`;
            } else {
                html += `<p style="color:#aaa; font-style:italic;">"Perhaps another time, traveler."</p>`;
            }
        }

        html += `<button data-am-act="closePanel" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('⚖️ Trade Negotiation', html);
    },

    /**
     * Meeting action: Pledge Allegiance
     */
    meetingPledgeAllegiance(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const lord = kingdom.lord;

        // Set allegiance
        const oldAllegiance = player.allegiance;
        player.allegiance = kingdom.id;
        player.kingdomTitle = 'citizen';
        player.title = `Citizen of ${kingdom.name}`;

        // Initialize title fields
        if (typeof Titles !== 'undefined') Titles.initialize(player);

        // Big reputation boost
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + 20;

        // If they were pledged elsewhere, that kingdom dislikes it
        if (oldAllegiance && oldAllegiance !== kingdom.id) {
            player.reputation[oldAllegiance] = (player.reputation[oldAllegiance] || 0) - 15;
        }

        player.renown = (player.renown || 0) + 5;

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">🏳️</span>
            <h3 style="color:#4fc3f7;">Allegiance Sworn</h3>
            <p style="color:#aaa;">You kneel before ${lord.name} and swear fealty to <span style="color:#ffd700;">${kingdom.name}</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#4caf50;">📈 Reputation +20 with ${kingdom.name}</div>
                <div style="color:#4fc3f7;">⭐ Renown +5</div>`;
        if (oldAllegiance && oldAllegiance !== kingdom.id) {
            const oldKingdom = world.getKingdom(oldAllegiance);
            if (oldKingdom) {
                html += `<div style="color:#ff6666;">📉 Reputation -15 with ${oldKingdom.name}</div>`;
            }
        }
        html += `</div>`;

        if (lord.traits.some(t => t.id === 'honorable')) {
            html += `<p style="color:#4fc3f7; font-style:italic;">"Rise, friend. Your service honors us both."</p>`;
        } else if (lord.traits.some(t => t.id === 'ambitious')) {
            html += `<p style="color:#ffd700; font-style:italic;">"Good. Together we shall build an empire."</p>`;
        } else {
            html += `<p style="color:#aaa; font-style:italic;">"Welcome to our cause. Serve loyally and you will be rewarded."</p>`;
        }

        html += `<button data-am-act="closePanelAndRefresh" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('🏳️ Oath of Fealty', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Renounce Allegiance
     */
    meetingRenounceAllegiance(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const lord = kingdom.lord;

        // Strip any active title first
        if (typeof Titles !== 'undefined' && player.currentTitle) {
            Titles.resign(player, world);
        }

        player.allegiance = null;
        player.kingdomTitle = null;
        player.title = 'Wanderer';

        // Reputation hit
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 25;

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">💔</span>
            <h3 style="color:#ff6666;">Allegiance Renounced</h3>
            <p style="color:#aaa;">You declare your independence from <span style="color:#ffd700;">${kingdom.name}</span>.</p>
            <div style="background:#2e1a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#ff6666;">📉 Reputation -25 with ${kingdom.name}</div>
            </div>`;

        if (lord.traits.some(t => t.id === 'cruel')) {
            html += `<p style="color:#f44336; font-style:italic;">"You dare betray me? You will regret this."</p>`;
        } else {
            html += `<p style="color:#ff9800; font-style:italic;">"So be it. Leave, and do not expect our welcome again."</p>`;
        }

        html += `<button data-am-act="closePanelAndRefresh" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('💔 Renunciation', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Request Royal Office
     */
    meetingRequestTitle(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (typeof Titles === 'undefined') return;
        Titles.initialize(player);

        const lord = kingdom.lord;
        const tile = world.getTile(player.q, player.r);

        // Get available titles the player qualifies for
        const allTitles = Titles.getTitleDefinitions();
        const qualifying = [];
        for (const [id, def] of Object.entries(allTitles)) {
            const check = Titles.meetsRequirements(player, id, world);
            if (check.meets) qualifying.push({ id, ...def });
        }

        let html = `<div style="padding:15px;">
            <div style="text-align:center; margin-bottom:12px;">
                <span style="font-size:36px;">🏅</span>
                <h3 style="color:#ffd700;">Request Royal Office</h3>
                <p style="color:#aaa;">${lord.name} considers your request...</p>
            </div>`;

        if (qualifying.length === 0) {
            html += `<div style="background:#2e1a1a; padding:12px; border-radius:6px; text-align:center;">
                <p style="color:#ff9800; font-style:italic;">"You have not yet proven yourself worthy of any office. Gain more reputation and skill, then return."</p>
            </div>`;
        } else {
            html += `<p style="color:#aaa; font-size:12px; text-align:center; margin-bottom:10px;">The lord considers you for the following offices:</p>`;
            for (const t of qualifying) {
                html += `<div style="border:1px solid #4a6a4a; border-radius:8px; padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.02);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <span style="font-size:18px;">${t.icon || '🏅'}</span>
                            <span style="font-weight:bold; color:#ffd700; margin-left:6px;">${t.name}</span>
                        </div>
                        <span style="font-size:11px; color:#888;">💰 ${t.salary} gold/day</span>
                    </div>
                    <div style="font-size:12px; color:#aaa; margin:4px 0;">${t.description}</div>
                    <button data-am-act="_appointTitle" data-am-args='["${t.id}"]' style="
                        width:100%; padding:6px; margin-top:4px;
                        background:#2a4a2a; border:1px solid #4a6a4a; border-radius:4px;
                        color:#4caf50; cursor:pointer; font-size:12px;
                    ">Accept this Office</button>
                </div>`;
            }
        }

        html += `<button data-am-act="closePanel" style="
            width:100%; padding:8px; margin-top:6px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:13px;
        ">Decline</button></div>`;

        game.ui.showCustomPanel('🏅 Royal Appointment', html);
    },

    /**
     * Meeting action: Request Military Aid
     */
    meetingRequestAid(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const lord = kingdom.lord;
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisp = NPCLords.getLordOpinion(lord, player) + reputation;

        // Success chance scales with disposition and lord's martial
        const baseChance = 0.2 + (totalDisp / 150) + (lord.martial / 50) + PlayerEffects.negotiationBonus(player);
        const success = Math.random() < Math.min(0.8, Math.max(0.05, baseChance));

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            // Grant soldiers
            const soldierCount = Utils.randInt(3, 8 + Math.floor(lord.martial / 2));
            const soldierStrength = Utils.randInt(2, 4);
            for (let i = 0; i < soldierCount; i++) {
                player.army.push({
                    type: `${kingdom.name} Levy`,
                    strength: soldierStrength,
                    morale: 70 + Utils.randInt(0, 20),
                    upkeep: 1,
                });
            }

            // Small reputation cost (they gave you troops)
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 5;

            html += `<span style="font-size:42px;">⚔️</span>
                <h3 style="color:#4caf50;">Aid Granted!</h3>
                <p style="color:#aaa;">${lord.name} assigns ${soldierCount} soldiers to your command.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#4caf50;">+${soldierCount} ${kingdom.name} Levy (Str ${soldierStrength} each)</div>
                    <div style="color:#ff9800;">📉 Reputation -5 (favor spent)</div>
                </div>`;
        } else {
            html += `<span style="font-size:42px;">❌</span>
                <h3 style="color:#ff9800;">Request Denied</h3>
                <p style="color:#aaa;">${lord.name} cannot spare troops at this time.</p>`;

            if (lord.traits.some(t => t.id === 'cautious')) {
                html += `<p style="color:#ff9800; font-style:italic;">"Our own borders require protection. I cannot risk it."</p>`;
            } else {
                html += `<p style="color:#aaa; font-style:italic;">"I sympathize, but my duty is to my own people first."</p>`;
            }
        }

        html += `<button data-am-act="closePanelAndRefresh" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('⚔️ Military Aid', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Demand Tribute
     */
    meetingDemandTribute(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        const lord = kingdom.lord;
        const armyStrength = player.army ? player.army.reduce((s, u) => s + (u.strength || 1), 0) : 0;

        // Success depends on army strength vs kingdom military + lord bravery
        const lordResistance = (kingdom.military || 10) + (lord.martial * 3) + (lord.traits.some(t => t.id === 'brave') ? 20 : 0);
        const ratio = armyStrength / Math.max(1, lordResistance);
        const success = Math.random() < Math.min(0.85, ratio * 0.5);

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            const tributeGold = Utils.randInt(50, 200 + Math.floor(kingdom.treasury * 0.1));
            player.gold += tributeGold;
            kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - tributeGold);

            // Major reputation hit
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 30;
            player.karma = (player.karma || 0) - 5;

            html += `<span style="font-size:42px;">💰</span>
                <h3 style="color:#ffd700;">Tribute Paid!</h3>
                <p style="color:#aaa;">${lord.name} grudgingly hands over gold to avoid conflict.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#ffd700;">+${tributeGold} gold</div>
                    <div style="color:#ff6666;">📉 Reputation -30 with ${kingdom.name}</div>
                    <div style="color:#ff6666;">📉 Karma -5</div>
                </div>`;

            if (lord.traits.some(t => t.id === 'cruel')) {
                html += `<p style="color:#f44336; font-style:italic;">"You will pay for this humiliation... in time."</p>`;
            } else {
                html += `<p style="color:#ff9800; font-style:italic;">"Take it and be gone, brigand."</p>`;
            }
        } else {
            // Lord refuses — possible fight with escort
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 15;
            player.karma = (player.karma || 0) - 3;

            html += `<span style="font-size:42px;">⚔️</span>
                <h3 style="color:#f44336;">Refused!</h3>
                <p style="color:#aaa;">${lord.name} orders their guards to drive you away!</p>
                <div style="background:#2e1a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#ff6666;">📉 Reputation -15 with ${kingdom.name}</div>
                    <div style="color:#ff6666;">📉 Karma -3</div>
                </div>`;

            if (lord.traits.some(t => t.id === 'brave')) {
                html += `<p style="color:#4fc3f7; font-style:italic;">"You think I fear you? Guards! Remove this fool!"</p>`;
            } else {
                html += `<p style="color:#ff9800; font-style:italic;">"I... I will not be intimidated! Guards!"</p>`;
            }
        }

        html += `<button data-am-act="closePanelAndRefresh" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('💰 Tribute Demand', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Ask about the Realm — discover peoples, religion, and lore
     */
    meetingAskAboutRealm(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        // Meeting a lord and asking about their realm reveals ALL knowledge
        const learned = player.learnAboutKingdom(kingdom.id, ['basics', 'ruler', 'peoples', 'religion', 'military', 'diplomacy', 'economy']);
        if (learned.length > 0) {
            game.ui.showNotification('Knowledge Gained', `${kingdom.lord.name} has revealed much about ${kingdom.name}: ${learned.join(', ')}.`, 'info');
        }

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;

        // More info revealed at higher disposition
        const detailLevel = totalDisposition >= 50 ? 'full' : totalDisposition >= 10 ? 'good' : 'basic';

        let html = `<div style="padding:15px; max-height:550px; overflow-y:auto;">`;
        html += `<div style="text-align:center; margin-bottom:12px;">
            <span style="font-size:42px;">📜</span>
            <h3 style="color:#ffd700;">Tales of ${kingdom.name}</h3>
            <div style="color:#888; font-size:12px;">${lord.name} speaks of their realm</div>
        </div>`;

        // ── 1. The Peoples ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #4fc3f7;">`;
        html += `<div style="color:#4fc3f7; font-weight:bold; margin-bottom:6px;">🏛️ The Peoples of ${kingdom.name}</div>`;

        if (typeof Peoples !== 'undefined') {
            const tribes = Peoples.getTribesForCulture(kingdom.culture);
            if (tribes.length > 0) {
                html += `<div style="color:#aaa; font-size:12px; margin-bottom:6px;">"Our realm was founded by the union of ancient peoples..."</div>`;
                for (const tribe of tribes) {
                    html += `<div style="background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-bottom:4px;">`;
                    html += `<div style="color:#fff; font-size:13px;">${tribe.icon} <strong>${tribe.name}</strong></div>`;
                    html += `<div style="color:#888; font-size:11px;">Origin: ${tribe.origin} | Traits: ${tribe.traits.join(', ')}</div>`;
                    if (detailLevel !== 'basic') {
                        html += `<div style="color:#aaa; font-size:11px; font-style:italic; margin-top:2px;">"${tribe.proverb}"</div>`;
                    }
                    if (detailLevel === 'full') {
                        html += `<div style="color:#ffd700; font-size:10px; margin-top:2px;">🎨 ${tribe.artForms.join(', ')} | 🍲 ${tribe.cuisine.slice(0, 2).join(', ')}</div>`;
                    }
                    html += `</div>`;
                }
            } else {
                html += `<div style="color:#aaa; font-size:12px;">"Our people are of the <strong>${kingdom.culture}</strong> tradition."</div>`;
            }
        } else {
            html += `<div style="color:#aaa; font-size:12px;">"We are a proud <strong>${kingdom.culture}</strong> people."</div>`;
        }
        html += `</div>`;

        // ── 2. Religion ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #e6c84c;">`;
        html += `<div style="color:#e6c84c; font-weight:bold; margin-bottom:6px;">🙏 Faith of the Realm</div>`;

        if (kingdom.religion && typeof Religion !== 'undefined') {
            const faith = Religion.FAITHS ? Religion.FAITHS[kingdom.religion.faithId] : null;
            const faithIcon = faith ? faith.icon : '🙏';
            html += `<div style="color:#aaa; font-size:12px;">"We follow the ways of <span style='color:#ffd700;'>${faithIcon} ${kingdom.religion.name}</span>."</div>`;
            html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:6px; font-size:11px;">`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🕊️ Piety: ${Math.floor(kingdom.religion.piety)}/100</div>`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">⚖️ Unity: ${Math.floor(kingdom.religion.unity)}/100</div>`;
            html += `</div>`;
            if (detailLevel !== 'basic') {
                const holySiteCount = kingdom.religion.holySites ? kingdom.religion.holySites.length : 0;
                html += `<div style="color:#888; font-size:11px; margin-top:4px;">⛪ ${holySiteCount} holy site${holySiteCount !== 1 ? 's' : ''} under our protection.</div>`;
            }
            if (detailLevel === 'full' && kingdom.religion.heresies && kingdom.religion.heresies.length > 0) {
                html += `<div style="color:#e74c3c; font-size:11px; margin-top:4px;">⚠️ Heresies trouble the realm: ${kingdom.religion.heresies.map(h => h.name).join(', ')}</div>`;
            }
        } else {
            html += `<div style="color:#aaa; font-size:12px;">"Our people follow the old traditions, without a formal church."</div>`;
        }
        html += `</div>`;

        // ── 3. Kingdom Strength ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #4caf50;">`;
        html += `<div style="color:#4caf50; font-weight:bold; margin-bottom:6px;">⚔️ Strength of the Realm</div>`;

        const settlements = world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
        const totalPop = settlements.reduce((sum, s) => sum + s.population, 0);
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px;">`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🏘️ Settlements: ${settlements.length}</div>`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">👥 Population: ${Utils.formatNumber(totalPop)}</div>`;
        if (detailLevel !== 'basic') {
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🗺️ Territory: ${kingdom.territory ? kingdom.territory.length : 0} tiles</div>`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🛡️ Military: ${kingdom.military || 0}</div>`;
        }
        if (detailLevel === 'full') {
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">💰 Treasury: ~${Utils.formatNumber(Math.round((kingdom.treasury || 0) / 100) * 100)}</div>`;
            const wars = kingdom.wars || [];
            const allies = kingdom.allies || [];
            if (wars.length > 0) {
                const warNames = wars.map(wId => world.getKingdom(wId)?.name || 'Unknown').join(', ');
                html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#e74c3c;">⚔️ At war with: ${warNames}</div>`;
            }
            if (allies.length > 0) {
                const allyNames = allies.map(aId => world.getKingdom(aId)?.name || 'Unknown').join(', ');
                html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#4caf50;">🤝 Allies: ${allyNames}</div>`;
            }
        }
        html += `</div></div>`;

        // ── 4. Diplomacy with Other Kingdoms ──
        if (detailLevel !== 'basic') {
            const otherKingdoms = world.kingdoms.filter(k => k.id !== kingdom.id && k.isAlive);
            if (otherKingdoms.length > 0) {
                html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #9c27b0;">`;
                html += `<div style="color:#9c27b0; font-weight:bold; margin-bottom:6px;">🌍 Relations with Neighbors</div>`;
                for (const other of otherKingdoms) {
                    const rel = kingdom.relations[other.id] || 0;
                    const atWar = kingdom.wars && kingdom.wars.includes(other.id);
                    let relText, relColor;
                    if (atWar) { relText = '⚔️ At War'; relColor = '#e74c3c'; }
                    else if (rel > 50) { relText = '🤝 Allied'; relColor = '#4caf50'; }
                    else if (rel > 0) { relText = '😐 Neutral'; relColor = '#95a5a6'; }
                    else if (rel > -50) { relText = '😠 Tense'; relColor = '#e67e22'; }
                    else { relText = '💢 Hostile'; relColor = '#e74c3c'; }

                    html += `<div style="display:flex; justify-content:space-between; padding:2px 0; font-size:11px;">`;
                    html += `<span style="color:#aaa;"><span style="color:${other.color};">●</span> ${other.name}</span>`;
                    html += `<span style="color:${relColor};">${relText}</span>`;
                    html += `</div>`;
                }
                html += `</div>`;
            }
        }

        // ── 5. Discover World History Lore ──
        let discoveredEntries = [];
        if (typeof Peoples !== 'undefined') {
            // Lords share more lore at higher disposition: 1-3 entries
            const loreCount = detailLevel === 'full' ? 3 : detailLevel === 'good' ? 2 : 1;
            discoveredEntries = Peoples.discoverLore(player, world, {
                kingdom: kingdom.id,
                count: loreCount
            });
        }

        if (discoveredEntries.length > 0) {
            html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #ff9800;">`;
            html += `<div style="color:#ff9800; font-weight:bold; margin-bottom:6px;">📖 Histories Revealed (${discoveredEntries.length})</div>`;
            html += `<div style="color:#888; font-size:11px; margin-bottom:6px;">"Let me share some tales of our past..."</div>`;
            for (const entry of discoveredEntries) {
                html += `<div style="background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-bottom:4px;">`;
                html += `<div style="color:#ffd700; font-size:10px;">Year ${entry.year}</div>`;
                html += `<div style="color:#ddd; font-size:12px; line-height:1.4;">${entry.text}</div>`;
                html += `</div>`;
            }
            html += `<div style="color:#666; font-size:10px; font-style:italic; margin-top:4px;">View all in 📜 World History panel</div>`;
            html += `</div>`;
        }

        // Reputation boost for asking (small)
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + 2;

        // Flavor quote based on lord traits
        html += `<div style="text-align:center; padding:8px; color:#888; font-style:italic; font-size:12px;">`;
        if (lord.traits.some(t => t.id === 'pious')) {
            html += `"All that we are, we owe to the divine. Remember that, traveler."`;
        } else if (lord.traits.some(t => t.id === 'ambitious')) {
            html += `"Know that ${kingdom.name} grows stronger each day. We are destined for greatness."`;
        } else if (lord.traits.some(t => t.id === 'honorable')) {
            html += `"We are a people of honor. This you will see, should you travel our lands."`;
        } else if (lord.traits.some(t => t.id === 'cunning')) {
            html += `"Knowledge is the truest weapon. Use what I've told you wisely."`;
        } else {
            html += `"Now you know something of us. May it serve you well."`;
        }
        html += `</div>`;

        html += `<div style="display:flex; gap:8px;">`;
        html += `<button data-am-act="closePanelAndRefresh" style="
            flex:1; padding:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button>`;
        html += `</div></div>`;

        game.ui.showCustomPanel(`📜 The Realm of ${kingdom.name}`, html);
        game.ui.updateStats(player, world);
    },
});
