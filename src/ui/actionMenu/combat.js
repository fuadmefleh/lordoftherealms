// ActionMenu — combat methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { Traits } from '../../systems/traits.js';
import { Ailments } from '../../systems/ailments.js';
import { Sieges } from '../../systems/sieges.js';
import { siegePanelHtml, siegeResultHtml } from './siegePanel.js';
import { FieldBattle } from '../../player/fieldBattle.js';
import { lede, chips, card, bullets, rowList, esc } from './uiKit.js';
import { InnerMapBattle } from '../innerMapBattle.js';
import { Arms } from '../../systems/arms.js';
import { openLordAudience, lordAudienceAct } from './lordAudience.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerEffects, Treasures } from './_imports.js';

/** Battle-report lines for soldiers saved by surgeons and a slain enemy commander. */
function battleExtrasHtml(result) {
    let html = '';
    if (result.wounded > 0) {
        html += `<div style="color: #8fd18a;">💊 Wounded but saved by your surgeons: ${result.wounded} (half strength for ${PlayerMilitary.WOUNDED_DAYS} days)</div>`;
    }
    if (result.navalSupport > 0) {
        html += result.theatre === 'sea'
            ? `<div style="color: #7cc7e8;">⛵ Your war galleys fought at sea (+${result.navalSupport} strength)</div>`
            : `<div style="color: #7cc7e8;">⛵ Your war galleys blockaded the harbour (+${result.navalSupport} strength)</div>`;
    }
    if (result.shipSupport > 0) {
        html += `<div style="color: #7cc7e8;">🚢 Your ship joined the fight (+${result.shipSupport} strength)</div>`;
    }
    if (result.commanderSlain) {
        html += `<div style="color: #ce93d8;">🗡️ Your assassins slew the enemy commander — their ranks broke!</div>`;
    }
    if (result.personalWound) {
        const w = result.personalWound;
        html += `<div style="color: #e0846a;">${w.icon} You were wounded in the fighting: ${w.name}${w.text ? ` (${w.text})` : ''}. See a physician.</div>`;
    }
    return html;
}

/** A result screen's head: a big glyph and the outcome in the display face. */
function _resultHead(icon, title, color, line) {
    return `<div style="text-align: center; margin: 2px 0 8px;"><div style="font-size: 44px; line-height: 1.1;">${icon}</div>`
        + `<div style="font-family: var(--font-display); font-size: 18px; color: ${color}; margin: 4px 0 2px;">${title}</div>`
        + `${line ? `<div style="font-size: 12px; color: #9d937c;">${line}</div>` : ''}</div>`;
}

/** The result screen's one way on: a Continue row. */
function _continue(act) {
    return rowList([{ icon: '➡️', name: 'Continue', act, tone: 'gold' }]);
}

/** A battle's tactics footnote, in words: how your companies matched theirs, the ground, the morale. */
function _tacticsHtml(t, broke) {
    const terrain = String(t.terrainId || 'mixed ground').replace(/_/g, ' ');
    let h = `📐 Your companies against theirs ×${t.playerCounterMult} · the ground (${terrain}) ×${t.playerTerrainMult} · your morale ${t.playerMorale}`;
    if (broke) h += `<br>${broke}`;
    return `<div style="margin-top: 8px; font-size: 11px; color: #9d937c;">${h}</div>`;
}

/** The estimated odds of a phased battle against `unit` (default stances; draws nothing). */
function _attackOddsHtml(game, unit) {
    const { enemy, ctx } = FieldBattle.unitEnemy(game.player, unit, game.world);
    const est = FieldBattle.preview(game.player, enemy, game.world, ctx);
    if (!est) return '';
    return `Win ~${Math.round(est.win * 100)}% · ~${Math.round(est.loss * 100)}% of your force lost (with the usual stances)`;
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
        if (ratio >= 2.0) { oddsLabel = 'Overwhelming Advantage'; oddsColor = '#8fd18a'; }
        else if (ratio >= 1.3) { oddsLabel = 'Favorable Odds'; oddsColor = '#8fd18a'; }
        else if (ratio >= 0.8) { oddsLabel = 'Even Fight'; oddsColor = '#ffcf6a'; }
        else if (ratio >= 0.5) { oddsLabel = 'Risky — Outmatched'; oddsColor = '#f0b35a'; }
        else { oddsLabel = 'Suicidal — Heavily Outmatched'; oddsColor = '#e0846a'; }

        const kingdom = settlement.kingdom ? game.world.getKingdom(settlement.kingdom) : null;
        const typeIcon = settlement.type === 'capital' ? '🏰' : settlement.type === 'city' ? '🏙️' : settlement.type === 'town' ? '🏘️' : '🏠';

        const typeName = settlement.type.charAt(0).toUpperCase() + settlement.type.slice(1);
        let html = '<div style="max-height: 500px; overflow-y: auto;">';

        // The place and the two sides
        html += lede(`${typeIcon} <b>${settlement.name}</b>, ${typeName}${kingdom ? ` — ${kingdom.name}` : ' — Independent'}. Pop: ${Utils.formatNumber(settlement.population)}.`);
        html += chips([
            { icon: '⚔️', label: 'Your army', value: `<span style="color: #7cc7e8;">${playerStrength}</span>` },
            ['👥', 'Companies', game.player.army.length],
            { icon: '🛡️', label: 'Garrison', value: `<span style="color: #e0846a;">${garrisonStrength}</span>` },
            { icon: '⚖️', label: '', value: `<span style="color: ${oddsColor};">${oddsLabel}</span>` },
        ]);
        if (strengthParts.naval > 0) html += `<div style="font-size: 11px; color: #7cc7e8; margin: 2px 0;">⛵ incl. ${strengthParts.naval} from galleys blockading the harbour</div>`;
        if (theatre === 'land' && PlayerMilitary.getNavalStrength(game.player) > 0) html += '<div style="font-size: 11px; color: #9d937c; margin: 2px 0;">⛵ Inland — your galleys cannot join</div>';

        // Warnings
        const C = Sieges.config();
        const owner = kingdom ? kingdom.name : 'the defenders';
        const warn = [
            'You camp before the walls and take it day by day: starve it, build engines, dig mines, storm it or offer terms.',
            `The camp eats ${Math.ceil(PlayerMilitary.getArmyStrength(game.player) > 0 ? game.player.army.length / C.camp.rationsPerUnits : 0)} food a day beyond what it forages; hungry, it sickens and deserts. ${kingdom ? esc(kingdom.name) : 'The owner'} may send a relief army.`,
            `Laying siege: reputation ${C.investReputation} with ${esc(owner)}, karma ${C.investKarma}.`,
            `Taking it by storm: karma −10, reputation falls with every realm${settlement.kingdom ? ` (−50 with ${esc(owner)})` : ''}, and the town loses 30% of its people.`,
            settlement.type === 'capital' ? '<span style="color: #e0846a; font-weight: bold;">A capital: expect its fiercest resistance.</span>' : null,
        ];
        html += card(`<div style="font-size: 12px; color: #cbbf9f;">${bullets(warn)}</div>`, { icon: '⚠️', title: 'What a siege costs', tone: 'bad' });

        // Raid option: hit and run instead of a full siege
        const raidStrength = Math.max(1, Math.floor(garrisonStrength * PlayerMilitary.RAID_DEFENSE_SHARE));
        const raidedAgo = settlement.lastRaidedDay != null ? (game.world.day || 0) - settlement.lastRaidedDay : null;
        const raidReady = raidedAgo === null || raidedAgo >= PlayerMilitary.RAID_COOLDOWN_DAYS;
        const raidDesc = `Plunder and withdraw — only part of the garrison (${raidStrength}) turns out. No conquest. Karma -5, reputation with ${kingdom ? kingdom.name : 'the defenders'} -20 (-30 if it fails), population -10%.`;

        // The choice
        html += rowList([
            { icon: '🏰', name: 'Lay siege', desc: 'Invest the town and camp before its walls', side: `vs ${garrisonStrength}`, tone: 'bad', act: 'performSiege' },
            {
                icon: '🔥', name: 'Or raid it', desc: raidDesc, side: `vs ${raidStrength}`, tone: 'warn', act: 'performRaid',
                off: !raidReady,
                why: raidReady ? '' : `${raidDesc} Raided ${raidedAgo} day(s) ago — nothing worth taking for ${PlayerMilitary.RAID_COOLDOWN_DAYS - raidedAgo} more.`,
            },
            { icon: '🏳️', name: 'Retreat', desc: 'Leave the walls in peace', act: 'closePanel' },
        ], 'Your orders');

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

        let html = '<div>';
        html += result.victory
            ? _resultHead('🔥', 'Raid Successful', '#f0b35a', `Your soldiers sack ${settlement.name} and ride off before help arrives.`)
            : _resultHead('💀', 'Raid Repelled', '#e0846a', `The defenders of ${settlement.name} drive you off.`);
        html += chips([
            result.victory ? { icon: '💰', label: 'Plunder', value: result.plunder, cls: 'gold' } : null,
            result.casualties > 0 ? { icon: '⚠️', label: 'Soldiers lost', value: `<span style="color: #f0b35a;">${result.casualties}</span>` } : null,
        ]);
        let body = battleExtrasHtml(result);
        body += `<div style="color: #e0846a;">😈 Karma and reputation with ${settlement.name}'s kingdom suffer.</div>`;
        html += card(`<div style="font-size: 12px; line-height: 1.6;">${body}</div>`, { tone: result.victory ? 'warn' : 'bad' });
        html += `${_continue('closePanelAndRefresh')}</div>`;

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
            game.ui.showCustomPanel(act === 'storm' ? `⚔️ Storm ${s.name}` : '🚩 The Relief Host', rowList([
                {
                    icon: '⚔️', name: 'Take the field — command them yourself', tone: 'gold',
                    desc: act === 'storm' ? `Fought in ${esc(s.name)}'s own streets: the garrison holds them, your army comes on from outside the walls.` : 'Your companies drawn up on the ground where it happens: march, hold, charge, loose, sound the retreat.',
                    act: 'siegeAct', args: [act === 'storm' ? 'stormField' : 'reliefField', arg0],
                },
                { icon: '🎲', name: 'Let the captains fight it', desc: 'Settled at once on the odds.', act: 'siegeAct', args: [act, `${arg0}|captains`] },
            ]));
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

        // On the water your galleys (and the ship you're aboard) fight; ashore only soldiers
        const hereTile = game.world.getTile(game.player.q, game.player.r);
        const theatre = PlayerMilitary.tileTheatre(hereTile);
        const playerStr = PlayerMilitary.getTheatreStrength(game.player, theatre);

        let html = '<div>';
        html += lede(`Who here will you fall on? ${theatre === 'sea' ? 'At sea your galleys fight at full strength, soldiers from the decks at half.' : 'You choose a stance for each phase of the battle.'}`);
        html += chips([
            { icon: '⚔️', label: `Your ${theatre === 'sea' ? 'strength at sea' : 'army strength'}`, value: playerStr, cls: 'gold' },
            ['👥', 'Companies', game.player.army.length],
        ]);
        if (theatre === 'land' && PlayerMilitary.getNavalStrength(game.player) > 0) html += '<div style="font-size: 11px; color: #9d937c; margin: 2px 0;">⛵ Your war galleys cannot fight on land.</div>';

        html += rowList(unitsOnTile.map(unit => {
            const stronger = unit.strength > playerStr;
            const warn = unit.type === 'caravan' || unit.type === 'ship' || unit.type === 'fishing_boat' ? '⚠️ Attacking traders hurts your karma' : unit.type === 'patrol' ? '⚠️ Attacking patrols angers kingdoms' : '💀 Hostile unit';
            return {
                icon: unit.icon, name: unit.name,
                desc: _attackOddsHtml(game, unit) || `${unit.population} strong`,
                note: `<span style="color: #c98a6a;">${warn}</span>`,
                side: `Strength ${unit.strength}`, tone: stronger ? 'bad' : 'good',
                act: 'performAttack', args: [unit.id],
            };
        }), 'Targets');
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

        let html = '<div>';

        if (result.noArmy) {
            html += lede(`<span style="color: #e0846a;">${result.reason || 'You have no army to fight with! Recruit soldiers first.'}</span>`);
        } else if (result.victory) {
            html += _resultHead('🏆', 'Victory!', '#8fd18a', `You defeated the ${result.enemyName}!`);
            html += chips([
                { icon: '💰', label: 'Gold looted', value: result.loot, cls: 'gold' },
                result.casualties > 0 ? { icon: '⚠️', label: 'Soldiers lost', value: `<span style="color: #f0b35a;">${result.casualties}</span>` } : null,
                result.karmaChange < 0 ? { icon: '😈', label: 'Karma', value: `<span style="color: #e0846a;">${result.karmaChange}</span>` } : null,
                result.renownChange > 0 ? { icon: '⭐', label: 'Renown', value: `+${result.renownChange}` } : null,
            ]);
            let spoils = '';
            if (result.armsTaken) spoils += `<div>⚔️ Arms stripped from the fallen: ${Object.entries(result.armsTaken).map(([k, v]) => { const nm = Arms.nameOf(k).toLowerCase(); return `${v} ${nm}${v > 1 && !/s$/.test(nm) ? 's' : ''}`; }).join(', ')}</div>`;
            if (Arms.quiverNote(result.quivers)) spoils += `<div style="margin-top: 4px;">${Arms.quiverNote(result.quivers)}</div>`;
            if (result.inventoryLoot && Object.keys(result.inventoryLoot).length > 0) {
                spoils += '<div style="margin-top: 4px;">📦 Supplies captured:</div>';
                for (const [item, qty] of Object.entries(result.inventoryLoot)) {
                    const good = PlayerEconomy.GOODS[item.toUpperCase()];
                    const label = item === 'gold' ? '💰 Coin' : good ? `${good.icon} ${good.name}` : item.replace(/_/g, ' ');
                    const hint = Treasures.info(item) ? ' <span style="color: #ce93d8; font-size: 11px;">(treasure — see Inventory)</span>' : '';
                    spoils += `<div style="margin-left: 12px; color: #cbbf9f;">• ${label}: ${qty}${hint}</div>`;
                }
            }
            if (result.lootLeftBehind && Object.keys(result.lootLeftBehind).length > 0) {
                spoils += `<div style="margin-top: 4px; color: #f0b35a;">🎒 Packs full — left behind: ${Object.entries(result.lootLeftBehind).map(([k, v]) => `${v} ${k}`).join(', ')}</div>`;
            }
            if (result.casualties > 0) spoils += `<div style="color: #f0b35a; margin-top: 4px;">⚠️ You lost ${result.casualties} soldier${result.casualties > 1 ? 's' : ''} in the battle.</div>`;
            spoils += battleExtrasHtml(result);
            if (spoils) html += card(`<div style="font-size: 12px; line-height: 1.6;">${spoils}</div>`, { icon: '🎖️', title: 'The spoils', tone: 'good' });
            if (result.tactics) html += _tacticsHtml(result.tactics, result.tactics.moraleBreak === 'enemy' ? '😨 Enemy morale broke and they fled.' : '');
        } else {
            html += _resultHead('💀', 'Defeat!', '#e0846a', `The ${result.enemyName} overpowered you!`);
            let body = `<div style="color: #f0b35a;">Lost ${result.casualties} soldier${result.casualties > 1 ? 's' : ''}.</div>`;
            if (result.captured) {
                body += `<div style="color: #e0846a; margin-top: 4px;">⛓️ You have been captured into indentured servitude for ${result.servitudeDays} days!</div>`;
                body += `<div style="color: #ffcf6a;">💰 ${result.goldConfiscated} gold confiscated.</div>`;
            }
            body += battleExtrasHtml(result);
            html += card(`<div style="font-size: 12px; line-height: 1.6;">${body}</div>`, { tone: 'bad' });
            if (result.tactics) html += _tacticsHtml(result.tactics, result.tactics.moraleBreak === 'player' ? '😨 Your force broke and fled.' : '');
        }

        html += `${_continue('closePanelAndRefresh')}</div>`;

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
