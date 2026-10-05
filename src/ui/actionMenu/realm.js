// ActionMenu — realm methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { Ailments } from '../../systems/ailments.js';
import { Throne, PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, Festivals, PlayerEffects } from './_imports.js';

Object.assign(ActionMenu, {
    // ============================================
    // NEW ACTIONS — Donate, Allegiance, Feast, Tournament
    //               Pickpocket, Smuggle, Train, Meditate
    //               Fish, Prospect, Tame Horse, Campfire
    // ============================================
    /**
     * Show donation menu — give gold for karma + reputation
     */
    showDonateMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const maxDonate = Math.min(player.gold, 500);
        const kingdomId = settlement ? settlement.kingdom : null;
        const kingdomName = kingdomId ? (game.world.getKingdom(kingdomId)?.name || 'this realm') : 'the people';

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">💰 Make a Donation</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Donate gold to the people of <strong>${settlement ? settlement.name : 'this land'}</strong>. This earns you karma and reputation with ${kingdomName}.</p>`;
        html += `<p style="font-size: 12px; color: var(--gold);">Your gold: ${player.gold}</p>`;
        html += `<div style="margin: 12px 0;">`;
        html += `<label style="font-size: 12px;">Amount to donate:</label><br>`;
        html += `<input type="range" id="donateAmount" min="10" max="${maxDonate}" value="${Math.min(50, maxDonate)}" oninput="document.getElementById('donateLabel').textContent = this.value" style="width: 100%;">`;
        html += `<span id="donateLabel" style="color: var(--gold); font-weight: bold;">${Math.min(50, maxDonate)}</span> gold`;
        html += `</div>`;
        html += `<button onclick="window._doDonate()" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Donate</button>`;
        html += '</div>';

        game.ui.showCustomPanel('Donation', html);

        window._doDonate = () => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const amount = parseInt(document.getElementById('donateAmount')?.value || 10);
            if (amount > player.gold) {
                game.ui.showNotification('Not Enough', 'You can\'t afford that donation!', 'error');
                return;
            }

            player.gold -= amount;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.donation = (player.financeToday.expenses.donation || 0) + amount;
            }

            // Karma scales with amount
            const karmaGain = Math.floor(amount / 10) + 1;
            player.karma = (player.karma || 0) + karmaGain;

            // Reputation gain
            if (kingdomId && player.reputation) {
                player.reputation[kingdomId] = (player.reputation[kingdomId] || 0)
                    + PlayerEffects.scaleReputationGain(player, Math.floor(amount / 15) + 1);
            }

            // Renown for large donations
            let renownGain = 0;
            if (amount >= 100) {
                renownGain = Math.floor(amount / 50);
                player.renown = (player.renown || 0) + renownGain;
            }

            // Charisma might improve
            let charismaUp = false;
            if (amount >= 50 && Math.random() < 0.15) {
                player.charisma = (player.charisma || 5) + 1;
                charismaUp = true;
            }

            let msg = `You donated ${amount} gold. +${karmaGain} karma.`;
            if (kingdomId) msg += ` Reputation with ${kingdomName} improved.`;
            if (renownGain > 0) msg += ` +${renownGain} renown!`;
            if (charismaUp) msg += ' Your generosity has improved your charisma!';

            game.ui.showNotification('💰 Donation', msg, 'success');
            game.ui.hideCustomPanel();
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Pledge allegiance to the kingdom controlling this settlement
     */
    doPledgeAllegiance(game, tile) {
        const settlement = tile.settlement;
        if (!settlement || !settlement.kingdom) {
            game.ui.showNotification('No Kingdom', 'This settlement has no kingdom to pledge to.', 'error');
            return;
        }

        const oldAllegiance = game.player.allegiance;
        const result = game.player.pledgeAllegiance(settlement.kingdom, game.world);
        if (result.success) {
            const kingdom = result.kingdom;
            // Reputation bonus on pledge
            if (game.player.reputation) {
                game.player.reputation[settlement.kingdom] = (game.player.reputation[settlement.kingdom] || 0) + 5;
            }
            // Deserting another crown costs standing there (softened by Diplomacy Mastery)
            let desertion = '';
            if (oldAllegiance && oldAllegiance !== settlement.kingdom && game.player.reputation) {
                const penalty = Math.round(15 * Technology.getAllianceCostMultiplier(game.player));
                game.player.reputation[oldAllegiance] = (game.player.reputation[oldAllegiance] || 0) - penalty;
                const old = game.world.getKingdom(oldAllegiance);
                desertion = ` ${old ? old.name : 'Your former realm'} resents the desertion (−${penalty} reputation).`;
            }
            game.ui.showNotification('⚔️ Allegiance Pledged',
                `You have sworn allegiance to ${kingdom.name}. You are now a citizen of the realm. +5 reputation.${desertion}`, 'success');
            game.ui.updateStats(game.player, game.world);
        } else {
            game.ui.showNotification('Cannot Pledge', result.reason, 'error');
        }
    },

    /**
     * Renounce allegiance to current kingdom
     */
    doRenounceAllegiance(game, tile) {
        const player = game.player;
        if (!player.allegiance) {
            game.ui.showNotification('No Allegiance', 'You aren\'t pledged to any kingdom.', 'error');
            return;
        }

        const oldKingdomId = player.allegiance;
        const result = player.breakAllegiance(game.world);

        if (result.success) {
            // Reputation penalty
            if (player.reputation && oldKingdomId) {
                player.reputation[oldKingdomId] = (player.reputation[oldKingdomId] || 0) - 15;
            }
            // Karma hit
            player.karma = (player.karma || 0) - 3;

            const name = result.oldKingdom ? result.oldKingdom.name : 'your kingdom';
            game.ui.showNotification('💔 Allegiance Broken',
                `You have renounced your allegiance to ${name}. -15 reputation, -3 karma. You are once again a free wanderer.`, 'warning');
            game.ui.updateStats(player, game.world);
        } else {
            game.ui.showNotification('Error', result.reason, 'error');
        }
    },

    _getPlayerSettlementTiles(player, world) {
        const settlements = [];
        const seen = new Set();

        const addSettlement = (q, r) => {
            const key = `${q},${r}`;
            if (seen.has(key)) return;

            const tile = world.getTile(q, r);
            if (!tile || !tile.settlement) return;

            const listedInColonies = (player.colonies || []).some(c => c.q === q && c.r === r);
            const markedPlayerColony = !!tile.settlement.colony?.isPlayerColony;
            if (!listedInColonies && !markedPlayerColony) return;

            seen.add(key);
            settlements.push({ q, r, tile, settlement: tile.settlement });
        };

        for (const colony of (player.colonies || [])) {
            addSettlement(colony.q, colony.r);
        }

        const allSettlements = world.getAllSettlements();
        for (const settlement of allSettlements) {
            const settlementTile = world.getTile(settlement.q, settlement.r);
            if (settlementTile?.settlement?.colony?.isPlayerColony) {
                addSettlement(settlement.q, settlement.r);
            }
        }

        return settlements;
    },

    showFormKingdomMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const controlledSettlements = ActionMenu._getPlayerSettlementTiles(player, world);
        const activeSettlement = controlledSettlements.find(s => s.q === tile.q && s.r === tile.r) || controlledSettlements[0];
        const suggestedName = `Kingdom of ${activeSettlement?.settlement?.name || 'New Dawn'}`;

        const status = Throne.foundingStatus(player, world);
        const blocked = status.ok ? '' : `<p style="font-size: 12px; color: #ff6666; margin: 0 0 10px;">${status.reasons.join(' ')}</p>`;
        let html = `
            <div>
                <h4 style="margin: 0 0 10px;">👑 Proclaim a New Kingdom</h4>
                ${blocked}
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 10px;">Costs ${status.cost} Prestige. You will rule it: set its taxes, war stance and faith, and conduct its diplomacy from Claims & Crowns.</p>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 10px;">
                    You will unite <b>${controlledSettlements.length}</b> settlements under a new crown.
                </p>
                <p style="font-size: 12px; margin: 0 0 6px;"><b>Kingdom Name</b></p>
                <input id="newKingdomNameInput" type="text" maxlength="48" value="${suggestedName.replace(/"/g, '&quot;')}"
                    style="width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid #555; background: #222; color: #fff; margin-bottom: 10px;" />
                <div style="display:flex; gap:8px;">
                    <button onclick="window._confirmFormKingdom()"
                        style="flex:1; padding: 10px; background: #c89b3c; border: none; border-radius: 6px; color: #111; font-weight: 700; cursor: pointer;">
                        Found Kingdom
                    </button>
                    <button data-am-act="closePanel"
                        style="padding: 10px 12px; background: #444; border: none; border-radius: 6px; color: #ddd; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        game.ui.showCustomPanel('Form Kingdom', html);

        window._confirmFormKingdom = () => {
            const chosenName = document.getElementById('newKingdomNameInput')?.value || '';
            if (!ActionMenu.commitPendingAP(game)) return;
            game.ui.hideCustomPanel();
            ActionMenu.doFormKingdom(game, tile, chosenName);
        };
    },

    doFormKingdom(game, tile, customName) {
        // The founding itself lives in systems/throne.js (a real kingdom the
        // simulation treats normally, with a court, faith and fleet)
        const res = Throne.foundKingdom(game.player, game.world, { name: customName, seat: tile ? { q: tile.q, r: tile.r } : null });
        if (!res.success) {
            game.ui.showNotification('Cannot Form Kingdom', res.reason, 'error');
            return;
        }
        game.ui.showNotification('👑 Kingdom Founded', res.message, 'success');
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Host a feast at a settlement — costs gold, gains renown + reputation + diplomacy
     */
    showHostFeastMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const tier = settlement.type === 'capital' ? 'grand' : (settlement.type === 'town' ? 'fine' : 'modest');
        const costs = { modest: 200, fine: 400, grand: 800 };
        const cost = costs[tier];

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🍖 Host a Feast</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Host a ${tier} feast in <strong>${settlement.name}</strong>. The locals will remember your generosity.</p>`;
        html += `<div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px;">`;
        html += `<div>💰 Cost: <span style="color: var(--gold);">${cost} gold</span></div>`;
        html += `<div>📈 Expected: +renown, +reputation, +diplomacy skill</div>`;
        html += `<div>⏰ Takes the rest of the day</div>`;
        html += `</div>`;

        if (player.gold >= cost) {
            html += `<button onclick="window._doFeast(${cost}, '${tier}')" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Host the Feast (${cost}g)</button>`;
        } else {
            html += `<p style="color: #ff6666; font-size: 12px;">You need ${cost} gold to host this feast.</p>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Host Feast', html);

        window._doFeast = (feastCost, feastTier) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            if (player.gold < feastCost) {
                game.ui.showNotification('Not Enough Gold', 'You can\'t afford this feast!', 'error');
                return;
            }

            player.gold -= feastCost;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.feast = (player.financeToday.expenses.feast || 0) + feastCost;
            }

            // Renown
            const renownGain = { modest: 3, fine: 6, grand: 12 }[feastTier] || 3;
            player.renown = (player.renown || 0) + renownGain;

            // Karma
            const karmaGain = { modest: 2, fine: 4, grand: 7 }[feastTier] || 2;
            player.karma = (player.karma || 0) + karmaGain;

            // Reputation
            const kingdomId = settlement.kingdom;
            if (kingdomId && player.reputation) {
                const repGain = { modest: 3, fine: 6, grand: 10 }[feastTier] || 3;
                player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + repGain;
            }

            // Diplomacy skill up chance
            let diplomacyUp = false;
            const skillChance = { modest: 0.15, fine: 0.25, grand: 0.4 }[feastTier] || 0.15;
            if (Math.random() < skillChance && player.skills) {
                player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                diplomacyUp = true;
            }

            // Charisma up chance
            let charismaUp = false;
            if (Math.random() < 0.2) {
                player.charisma = (player.charisma || 5) + 1;
                charismaUp = true;
            }

            let msg = `You hosted a ${feastTier} feast! +${renownGain} renown, +${karmaGain} karma.`;
            if (diplomacyUp) msg += ' Diplomacy skill improved!';
            if (charismaUp) msg += ' Your charisma grew!';

            game.ui.hideCustomPanel();
            game.ui.showNotification('🍖 Feast Complete', msg, 'success');
            game.ui.updateStats(player, game.world);
            game.endDay();
        };
    },

    /**
     * Hold a tournament — combat competition for gold and renown
     */
    showTournamentMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const entryFee = settlement.type === 'capital' ? 300 : 200;
        const prizePool = entryFee * 4;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">⚔️ Hold a Tournament</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Organize a fighting tournament in ${settlement.name}! Champions from across the land will compete.</p>`;
        html += `<div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px;">`;
        html += `<div>💰 Entry/Organization cost: <span style="color: var(--gold);">${entryFee} gold</span></div>`;
        html += `<div>🏆 Prize pool: <span style="color: var(--gold);">${prizePool} gold</span></div>`;
        html += `<div>⚔️ Your combat skill: ${player.skills?.combat || 1} | Strength: ${player.strength || 5}</div>`;
        html += `<div>⏰ Takes the rest of the day</div>`;
        html += `</div>`;
        html += `<p style="font-size: 11px; color: #aaa;">You may compete yourself, or simply host and watch.</p>`;

        if (player.gold >= entryFee) {
            html += `<button onclick="window._doTournament(true)" style="width: 100%; padding: 10px; background: #c97d32; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 6px;">Compete (${entryFee}g)</button>`;
            html += `<button onclick="window._doTournament(false)" style="width: 100%; padding: 8px; background: #555; border: none; border-radius: 4px; cursor: pointer; color: #ccc;">Just Host & Spectate (${Math.floor(entryFee * 0.6)}g)</button>`;
        } else {
            html += `<p style="color: #ff6666; font-size: 12px;">You need ${entryFee} gold to organize a tournament.</p>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Tournament', html);

        window._doTournament = (compete) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const cost = compete ? entryFee : Math.floor(entryFee * 0.6);
            if (player.gold < cost) {
                game.ui.showNotification('Not Enough Gold', 'You can\'t afford to host this!', 'error');
                return;
            }

            player.gold -= cost;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.tournament = (player.financeToday.expenses.tournament || 0) + cost;
            }

            let resultHtml = '<div>';
            const renownGain = compete ? 5 : 3;
            player.renown = (player.renown || 0) + renownGain;

            if (compete) {
                // Combat rounds — player vs 3 opponents
                const combatSkill = (player.skills?.combat || 1);
                const strengthBonus = ((player.strength || 5) - 5) * 0.05;
                const playerPower = combatSkill * 2 + strengthBonus + (Math.random() * 5);

                const opponents = [
                    { name: 'Local Champion', power: 4 + Math.random() * 6 },
                    { name: 'Traveling Knight', power: 6 + Math.random() * 7 },
                    { name: 'Arena Veteran', power: 8 + Math.random() * 8 },
                ];

                let wins = 0;
                let healthLost = 0;
                resultHtml += '<h4 style="margin-top: 0;">⚔️ Tournament Results</h4>';

                for (const opp of opponents) {
                    const won = playerPower + Math.random() * 3 > opp.power;
                    if (won) {
                        wins++;
                        resultHtml += `<div style="color: #8f8;">✓ Defeated ${opp.name}!</div>`;
                    } else {
                        const dmg = Math.floor(Math.random() * 10) + 5;
                        healthLost += dmg;
                        resultHtml += `<div style="color: #f88;">✗ Lost to ${opp.name} (-${dmg} HP)</div>`;
                        // A lost bout can leave a real wound (systems/ailments.js)
                        const wound = Ailments.maybeWound(player, game.world, 'duel');
                        if (wound) resultHtml += `<div style="color: #e57373; margin-left: 12px;">${wound.icon} ${wound.name} (${wound.text})</div>`;
                    }
                }

                player.health = Math.max(1, player.health - healthLost);

                if (wins === 3) {
                    // Grand champion!
                    const winnings = prizePool;
                    player.gold += winnings;
                    if (player.financeToday) {
                        player.financeToday.income.tournament = (player.financeToday.income.tournament || 0) + winnings;
                    }
                    player.renown += 5; // Bonus renown
                    resultHtml += `<div style="color: var(--gold); font-weight: bold; margin-top: 8px;">🏆 GRAND CHAMPION! Won ${winnings} gold! +${renownGain + 5} total renown!</div>`;
                } else if (wins >= 2) {
                    const winnings = Math.floor(prizePool * 0.4);
                    player.gold += winnings;
                    if (player.financeToday) {
                        player.financeToday.income.tournament = (player.financeToday.income.tournament || 0) + winnings;
                    }
                    resultHtml += `<div style="color: #ccc; margin-top: 8px;">🥈 Runner-up! Won ${winnings} gold. +${renownGain} renown.</div>`;
                } else {
                    resultHtml += `<div style="color: #888; margin-top: 8px;">Eliminated early. +${renownGain} renown for participating.</div>`;
                }

                // Combat skill up chance
                if (Math.random() < 0.2 + wins * 0.1 && player.skills) {
                    player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
                    resultHtml += `<div style="color: #88f; margin-top: 4px;">Combat skill improved!</div>`;
                }

                if (healthLost > 0) {
                    resultHtml += `<div style="color: #f88; margin-top: 4px;">Total injuries: -${healthLost} HP</div>`;
                }
            } else {
                // Just hosting
                resultHtml += '<h4 style="margin-top: 0;">🏟️ Tournament Hosted</h4>';
                resultHtml += `<div>The tournament was a great success! The crowd cheered and the fighters put on a great show.</div>`;
                resultHtml += `<div style="color: var(--gold); margin-top: 8px;">+${renownGain} renown for hosting.</div>`;

                // Hosting chance for diplomacy
                if (Math.random() < 0.25 && player.skills) {
                    player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                    resultHtml += `<div style="color: #88f; margin-top: 4px;">Diplomacy improved from managing the event!</div>`;
                }
            }

            resultHtml += `<button data-am-act="closePanelAndEndDay" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            resultHtml += '</div>';

            game.ui.showCustomPanel('Tournament Results', resultHtml);
            game.ui.updateStats(player, game.world);
        };
    },

    showFestivalMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        if (typeof Festivals === 'undefined') {
            game.ui.showNotification('Unavailable', 'Festival system is unavailable.', 'error');
            return;
        }

        Festivals.initialize(player);
        const gate = Festivals.canHostFestival(player, game.world, tile);
        if (!gate.ok) {
            game.ui.showNotification('Cannot Host Festival', gate.reason, 'warning');
            return;
        }

        let selectedTier = 'modest';
        let selectedStance = 'diplomatic';
        const theme = Festivals.getSeasonTheme(game.world);
        let selectedContest = theme.recommendedContest;

        const render = () => {
            const options = Festivals.getBudgetOptions();
            const currentTier = options.find(o => o.id === selectedTier) || options[0];
            const canAfford = (player.gold || 0) >= currentTier.cost;

            let html = '<div style="max-width: 580px;">';
            html += `<h4 style="margin-top: 0;">${theme.icon} ${theme.name}</h4>`;
            html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">${game.world.season} festival season in ${settlement.name}. Recommended contest: <strong>${Festivals.CONTESTS[theme.recommendedContest].label}</strong>.</div>`;
            {
                const fame = Festivals.getReputation(player);
                const fs = player.festivals;
                const novelty = Festivals.noveltyMultiplier(player, settlement.name);
                const perks = [];
                if (fame.hostBonus) perks.push(`+${fame.hostBonus} renown`);
                if (fame.extraEnvoys) perks.push(`+${fame.extraEnvoys} envoy${fame.extraEnvoys > 1 ? 's' : ''}`);
                if (fame.contestVeteran) perks.push(`+${fame.contestVeteran.toFixed(1)} contest power`);
                if (fame.vigilance) perks.push(`−${Math.round(fame.vigilance * 100)}% sabotage`);
                if (fame.envoyGoodwill) perks.push(`+${fame.envoyGoodwill} envoy goodwill`);
                html += `<div style="font-size: 11px; color: #c9b27a; margin-bottom: 10px;">🎪 Record: ${fs.hosted} hosted · ${fs.successfulContests} podiums · ${fs.diplomacyEvents} envoys feted${perks.length ? ` — ${perks.join(', ')}` : ''}${novelty < 1 ? `<br><span style="color:#e67e22;">${settlement.name} has seen your festivals lately: renown ×${novelty.toFixed(1)}. Try another town.</span>` : ''}</div>`;
            }

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin-bottom: 6px;">Festival Scale</div>';
            for (const option of options) {
                const active = selectedTier === option.id;
                html += `
                    <button onclick="window._setFestivalTier('${option.id}')" style="width: 100%; text-align: left; margin-bottom: 6px; padding: 9px; border-radius: 6px; border: 1px solid ${active ? 'rgba(245,197,66,0.65)' : 'rgba(255,255,255,0.12)'}; background: ${active ? 'rgba(245,197,66,0.12)' : 'rgba(255,255,255,0.04)'}; color: #ddd; cursor: pointer;">
                        <div style="display:flex; justify-content: space-between;"><strong>${option.label}</strong><span style="color: var(--gold);">${option.cost}g</span></div>
                        <div style="font-size: 11px; color:#aaa; margin-top: 3px;">+${option.renown} base renown · +${Math.round(option.morale * 100)}% morale for ${option.moraleDays} days</div>
                    </button>
                `;
            }

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 6px;">Guest Policy</div>';
            const diplomaticActive = selectedStance === 'diplomatic';
            const securityActive = selectedStance === 'security';
            html += `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">
                    <button onclick="window._setFestivalStance('diplomatic')" style="padding: 8px; border-radius: 6px; border: 1px solid ${diplomaticActive ? 'rgba(52,152,219,0.7)' : 'rgba(255,255,255,0.12)'}; background: ${diplomaticActive ? 'rgba(52,152,219,0.2)' : 'rgba(255,255,255,0.04)'}; color:#dce8f5; cursor:pointer;">
                        🤝 Diplomatic Reception
                    </button>
                    <button onclick="window._setFestivalStance('security')" style="padding: 8px; border-radius: 6px; border: 1px solid ${securityActive ? 'rgba(231,76,60,0.7)' : 'rgba(255,255,255,0.12)'}; background: ${securityActive ? 'rgba(231,76,60,0.2)' : 'rgba(255,255,255,0.04)'}; color:#f5dfdf; cursor:pointer;">
                        🛡️ Tight Security
                    </button>
                </div>
            `;

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 6px;">Seasonal Contest</div>';
            for (const contest of Object.values(Festivals.CONTESTS)) {
                const active = selectedContest === contest.id;
                const recommended = theme.recommendedContest === contest.id;
                html += `
                    <button onclick="window._setFestivalContest('${contest.id}')" style="width: 100%; text-align: left; margin-bottom: 6px; padding: 8px; border-radius: 6px; border: 1px solid ${active ? 'rgba(46,204,113,0.65)' : 'rgba(255,255,255,0.12)'}; background: ${active ? 'rgba(46,204,113,0.16)' : 'rgba(255,255,255,0.04)'}; color:#ddd; cursor:pointer;">
                        ${contest.icon} <strong>${contest.label}</strong> ${recommended ? '<span style="font-size:10px; color:#2ecc71;">(Season Favored)</span>' : ''}
                    </button>
                `;
            }

            html += `<div style="font-size: 12px; color: ${canAfford ? '#bbb' : '#ff7878'}; margin: 8px 0;">Cost: ${currentTier.cost} gold · Your gold: ${player.gold}</div>`;
            html += `<button onclick="window._beginFestival()" ${!canAfford ? 'disabled' : ''} style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Begin Festival</button>`;
            html += '</div>';

            game.ui.showCustomPanel('Festival Planning', html);
        };

        window._setFestivalTier = (tierId) => { selectedTier = tierId; render(); };
        window._setFestivalStance = (stance) => { selectedStance = stance; render(); };
        window._setFestivalContest = (contest) => { selectedContest = contest; render(); };

        const finalizeFestival = (contestScore) => {
            const result = Festivals.hostFestival(player, game.world, tile, {
                tier: selectedTier,
                stance: selectedStance,
                contest: selectedContest,
                contestScore,
            });

            if (!result.success) {
                game.ui.showNotification('Festival Failed', result.reason, 'error');
                render();
                return;
            }

            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.festival = (player.financeToday.expenses.festival || 0) + result.tier.cost;
                if (result.contestPrize > 0) {
                    player.financeToday.income = player.financeToday.income || {};
                    player.financeToday.income.festival = (player.financeToday.income.festival || 0) + result.contestPrize;
                }
            }

            let summary = '<div style="max-width: 560px;">';
            summary += `<h4 style="margin-top: 0;">${result.seasonTheme.icon} Festival Completed</h4>`;
            summary += `<div style="margin-bottom: 8px;">${result.contestResult.text}</div>`;
            summary += `<div style="font-size: 12px; color: #ddd; margin-bottom: 8px;">+${result.renownGain} renown · Morale boost ${Math.round(result.moraleBoost * 100)}% for ${result.moraleDays} days</div>`;
            summary += `<div style="font-size: 11px; color: #aaa; margin-bottom: 10px;">Contest prize: ${result.contestPrize}g</div>`;
            const lc = result.localCustoms;
            if (lc && (lc.custom || lc.sentimentGain)) {
                summary += `<div style="font-size: 12px; color: #c5e1a5; margin-bottom: 10px;">🎊 ${lc.custom ? `The locals fold in their ${lc.custom}` : 'The local peoples join in'}${lc.renownBonus ? ` (+${lc.renownBonus} renown)` : ''} · every people here +${lc.sentimentGain} mood</div>`;
            }

            if (result.reputations.length > 0) {
                summary += '<div style="font-size: 11px; text-transform: uppercase; color: #3498db; letter-spacing: 1px; margin-bottom: 4px;">Diplomatic Outcomes</div>';
                for (const row of result.reputations) {
                    summary += `<div style="font-size: 12px; color:#b8d9f5;">🤝 ${row.rival}: +${row.repGain} reputation${row.relationGain ? `, +${row.relationGain} relations with your realm` : ''}</div>`;
                }
            }

            if (result.sabotage.length > 0) {
                summary += '<div style="font-size: 11px; text-transform: uppercase; color: #e67e22; letter-spacing: 1px; margin: 8px 0 4px;">Sabotage Attempts</div>';
                for (const row of result.sabotage) {
                    summary += row.caught
                        ? `<div style="font-size: 12px; color:#f3c998;">🛡️ Agents from ${row.rival} were caught before causing damage.</div>`
                        : `<div style="font-size: 12px; color:#f0b7aa;">⚠️ Operatives from ${row.rival} caused losses: -${row.goldLost}g.</div>`;
                }
            }

            summary += '<button data-am-act="closePanelAndEndDay" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Continue</button>';
            summary += '</div>';

            game.ui.showCustomPanel('Festival Results', summary);
            game.ui.updateStats(player, game.world);
        };

        window._beginFestival = () => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const tier = Festivals.BUDGET_TIERS[selectedTier] || Festivals.BUDGET_TIERS.modest;
            if (player.gold < tier.cost) {
                game.ui.showNotification('Not Enough Gold', `You need ${tier.cost} gold to host this festival.`, 'error');
                return;
            }

            if (selectedContest === 'jousting') {
                ActionMenu._runJoustingFestivalMinigame(game, finalizeFestival);
            } else {
                ActionMenu._runArcheryFestivalMinigame(game, finalizeFestival);
            }
        };

        render();
    },

    _runJoustingFestivalMinigame(game, onDone) {
        const lanes = ['Left', 'Center', 'Right'];
        const icons = { Left: '⬅️', Center: '⬆️', Right: '➡️' };
        const sequence = [Utils.randPick(lanes), Utils.randPick(lanes), Utils.randPick(lanes)];
        const picks = [];

        const showSequence = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🐎 Jousting Lists</h4>';
            html += '<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Memorize the charge pattern, then repeat it correctly.</div>';
            html += `<div style="font-size: 28px; letter-spacing: 8px; text-align:center; margin: 12px 0;">${sequence.map(s => icons[s]).join('')}</div>`;
            html += '<button onclick="window._startJoustInput()" style="width:100%; padding:10px; background:#c97d32; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">I Memorized It</button>';
            html += '</div>';
            game.ui.showCustomPanel('Jousting Contest', html);
        };

        const showInput = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🐎 Repeat the Pattern</h4>';
            html += `<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Step ${picks.length + 1}/3</div>`;
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">';
            for (const lane of lanes) {
                html += `<button onclick="window._pickJoustLane('${lane}')" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">${icons[lane]} ${lane}</button>`;
            }
            html += '</div>';
            html += '</div>';
            game.ui.showCustomPanel('Jousting Contest', html);
        };

        window._startJoustInput = () => showInput();
        window._pickJoustLane = (lane) => {
            picks.push(lane);
            if (picks.length < 3) {
                showInput();
                return;
            }

            let matches = 0;
            for (let i = 0; i < sequence.length; i++) {
                if (picks[i] === sequence[i]) matches++;
            }
            onDone(matches);
        };

        showSequence();
    },

    _runArcheryFestivalMinigame(game, onDone) {
        const drifts = [Utils.randPick([-1, 0, 1]), Utils.randPick([-1, 0, 1]), Utils.randPick([-1, 0, 1])];
        let shot = 0;
        let hits = 0;

        const windLabel = (val) => val === 0 ? 'Calm' : (val < 0 ? 'Wind Left' : 'Wind Right');
        const windIcon = (val) => val === 0 ? '⬆️' : (val < 0 ? '⬅️' : '➡️');

        const render = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🏹 Archery Contest</h4>';
            html += `<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Shot ${shot + 1}/3 — compensate for wind.</div>`;
            html += `<div style="font-size: 18px; margin: 8px 0; text-align:center;">${windIcon(drifts[shot])} ${windLabel(drifts[shot])}</div>`;
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">';
            html += '<button onclick="window._pickArchery(-1)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Left</button>';
            html += '<button onclick="window._pickArchery(0)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Center</button>';
            html += '<button onclick="window._pickArchery(1)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Right</button>';
            html += '</div>';
            html += '</div>';
            game.ui.showCustomPanel('Archery Contest', html);
        };

        window._pickArchery = (aim) => {
            if (aim + drifts[shot] === 0) hits++;
            shot++;

            if (shot >= drifts.length) {
                onDone(hits);
                return;
            }

            render();
        };

        render();
    },
});
