// ============================================
// END DAY � onPlayerArrived, endDay turn processing
// ============================================

import { Camera, Renderer, Player, World, SaveLoad, Terrain, Banking, MarketDynamics, Taxation, Characters, Minimap, UI, Quests, Achievements, Technology, Relationships, Ships, Titles, Councils, InnerMap, InnerMapRenderer, InnerMapCharacters, InnerMapCombat, LightSystem, ModStore, audioManager, DataLoader, Hex, Utils, PlayerActions, PlayerEconomy, PlayerMilitary, ActionMenu, Housing, House, Espionage, Gossip, Tavern, Economy, TiledExport, CustomObjects, CustomBuildings, Hotbar, NpcDialog } from './_gameImports.js';

export function onPlayerArrived() {
    const tile = this.world.getTile(this.player.q, this.player.r);
    if (!tile) return;

    // Update music scene based on new terrain
    audioManager.updateSceneFromGameState(this);

    // Show reachable hexes
    this.renderer.reachableHexes = this.player.getReachableHexes(this.world);

    // If arrived at a settlement
    if (tile.settlement) {
        const sType = tile.settlement.type;
        this.ui.showNotification(
            `Arrived at ${tile.settlement.name}`,
            `You have arrived at this ${sType}. Population: ${Utils.formatNumber(tile.settlement.population)}.`,
            'success'
        );
        // Discover basic kingdom knowledge by visiting a settlement
        if (tile.settlement.kingdom) {
            const learned = this.player.learnAboutKingdom(tile.settlement.kingdom, 'basics');
            if (learned.length > 0) {
                const k = this.world.getKingdom(tile.settlement.kingdom);
                if (k) this.ui.showNotification('Knowledge Gained', `You have learned about the realm of ${k.name}.`, 'info');
            }
        }
    }

    // If arrived at a point of interest
    if (tile.improvement && !tile.improvement.explored) {
        // Just notify discovery, don't mark as explored (use Explore action for full rewards)
        this.ui.showNotification(
            'Location Discovered',
            `You found ${tile.improvement.name}! ${tile.improvement.icon} Use the Explore action to investigate.`,
            'info'
        );
    }

    // If tile has resources
    if (tile.resource) {
        this.ui.showNotification(
            'Resources Found',
            `This area has ${tile.resource.name} ${tile.resource.icon}`,
            'info'
        );
    }
}

/**
 * End the current day
 */
export function endDay() {
    if (!this.world || !this.player) return;
    if (this.isProcessingTurn) return;

    // Play end-turn SFX
    audioManager.playSFX('turn');

    // Confirm end day if enabled
    if (this.ui && this.ui._confirmEndDay && !this._endDayConfirmed) {
        this._showEndDayConfirm();
        return;
    }
    this._endDayConfirmed = false;

    this.isProcessingTurn = true;
    document.body.style.cursor = 'wait';

    // Use setTimeout to allow UI to update (show loading state) before heavy processing
    setTimeout(() => {
        try {
            // Process player's daily activities
            const playerResults = PlayerActions.endDay(this.player, this.world);

            // Show jail update notifications
            if (playerResults.jailUpdate) {
                if (playerResults.jailUpdate.freed) {
                    this.ui.showNotification('🔓 Released!', playerResults.jailUpdate.message, 'success');
                }
            }

            // Show title update notifications
            if (playerResults.titleUpdate) {
                const tu = playerResults.titleUpdate;
                if (tu.salary > 0) {
                    // Silent salary — don't spam every day
                }
                if (tu.fugitiveUpdate) {
                    if (tu.fugitiveUpdate.escaped) {
                        this.ui.showNotification('💨 Fugitive Escaped!', tu.fugitiveUpdate.message, 'error');
                    } else if (tu.fugitiveUpdate.warning) {
                        this.ui.showNotification('⚠️ Fugitive Alert', tu.fugitiveUpdate.message, 'warning');
                    }
                }
                if (tu.evaluation) {
                    if (tu.evaluation.passed) {
                        this.ui.showNotification('✅ Duties Fulfilled!', `${tu.evaluation.progress} — Well done! Your service continues.`, 'success');
                    } else {
                        this.ui.showNotification('❌ Duties Failed!', `${tu.evaluation.progress} — Your performance was lacking.`, 'error');
                    }
                }
                if (tu.stripped) {
                    this.ui.showNotification('🏅 Title Stripped!', tu.strippedMessage, 'error');
                }
            }

            // Process world turn
            const result = this.world.advanceDay(this.player);
            this.player.endDay();
            this.player.updateVisibility(this.world, 4);

            // ── Check for hostile unit encounters (raiders/pirates) ──
            this._checkHostileEncounters();

            // Apply spy-revealed vision tiles (after normal visibility reset)
            if (typeof Espionage !== 'undefined') {
                Espionage.applySpyVision(this.player, this.world);
            }

            // ── Starvation check ─────────────────────────────
            if (this.player.health <= 0 && this.player.starvationDays > 0) {
                // Player starved to death — play death animation then show screen
                this._triggerDeath('starvation');
                return; // Stop processing — death animation + screen handles continuation
            }

            // Show starvation warnings
            if (this.player.starvationDays > 0) {
                const days = this.player.starvationDays;
                if (days >= 5) {
                    this.ui.showNotification('💀 Starving!',
                        `${days} days without food! Health: ${this.player.health}/${this.player.maxHealth}. Find food or you will die!`, 'error');
                } else if (days >= 3) {
                    this.ui.showNotification('⚠️ Starving',
                        `${days} days without food. Health: ${this.player.health}/${this.player.maxHealth}. Buy food at a settlement!`, 'error');
                } else {
                    this.ui.showNotification('🍽️ Hungry',
                        `No food! Day ${days} without eating. Health: ${this.player.health}/${this.player.maxHealth}`, 'warning');
                }
            }

            // Process housing maintenance
            if (typeof Housing !== 'undefined') {
                Housing.processDaily(this.player, this.world);
            }

            // Process ship daily events
            if (typeof Ships !== 'undefined') {
                // Capture ship statuses before processing
                const shipsBefore = (this.player.ships || []).map(s => ({ id: s.id, status: s.status, name: s.name, buildDaysLeft: s.buildDaysLeft, travelDaysLeft: s.travelDaysLeft }));
                Ships.processDaily(this.player, this.world);
                // Check for completed builds or arrived ships
                for (const before of shipsBefore) {
                    const after = Ships.getShipById(this.player, before.id);
                    if (!after) continue;
                    if (before.status === 'building' && after.status === 'docked') {
                        this.ui.showNotification('🔨 Ship Complete!', `${after.name} has been built and is ready at ${after.dockedAt}!`, 'success');
                    } else if (before.status === 'moving' && after.status === 'docked') {
                        this.ui.showNotification('⚓ Ship Arrived', `${after.name} has arrived at ${after.dockedAt}.`, 'info');
                    }
                }
            }

            // Process building construction progress
            if (this.player.properties) {
                for (const propRef of this.player.properties) {
                    const pTile = this.world.getTile(propRef.q, propRef.r);
                    if (!pTile) continue;

                    // Check playerProperties array
                    if (pTile.playerProperties) {
                        for (const prop of pTile.playerProperties) {
                            if (prop.underConstruction && prop.constructionDaysLeft > 0) {
                                prop.constructionDaysLeft--;
                                if (prop.constructionDaysLeft <= 0) {
                                    prop.underConstruction = false;
                                    this.ui.showNotification('🏗️ Construction Complete!',
                                        `Your ${prop.name} is now operational!`, 'success');
                                }
                            }
                        }
                    }

                    // Also sync playerProperty (backwards compat reference)
                    if (pTile.playerProperty && pTile.playerProperty.underConstruction && pTile.playerProperty.constructionDaysLeft > 0) {
                        // Already handled above if in playerProperties array
                        if (!pTile.playerProperties || !pTile.playerProperties.includes(pTile.playerProperty)) {
                            pTile.playerProperty.constructionDaysLeft--;
                            if (pTile.playerProperty.constructionDaysLeft <= 0) {
                                pTile.playerProperty.underConstruction = false;
                                this.ui.showNotification('🏗️ Construction Complete!',
                                    `Your ${pTile.playerProperty.name} is now operational!`, 'success');
                            }
                        }
                    }
                }
            }

            // Process religious building construction
            if (this.player.religion && this.player.religion.buildings) {
                for (const bRef of this.player.religion.buildings) {
                    const bTile = this.world.getTile(bRef.q, bRef.r);
                    if (!bTile || !bTile.religiousBuilding) continue;
                    const rb = bTile.religiousBuilding;
                    if (rb.underConstruction && rb.constructionDaysLeft > 0) {
                        rb.constructionDaysLeft--;
                        if (rb.constructionDaysLeft <= 0) {
                            rb.underConstruction = false;
                            this.ui.showNotification('🏗️ Construction Complete!',
                                `Your ${rb.name} is now complete and will spread your faith!`, 'success');
                        }
                    }
                }
            }

            // Process infrastructure construction
            if (this.player.infrastructureUnderConstruction) {
                for (let i = this.player.infrastructureUnderConstruction.length - 1; i >= 0; i--) {
                    const ref = this.player.infrastructureUnderConstruction[i];
                    const iTile = this.world.getTile(ref.q, ref.r);
                    if (!iTile || !iTile.infrastructure || !iTile.infrastructure.underConstruction) {
                        this.player.infrastructureUnderConstruction.splice(i, 1);
                        continue;
                    }
                    iTile.infrastructure.constructionDaysLeft--;
                    if (iTile.infrastructure.constructionDaysLeft <= 0) {
                        iTile.infrastructure.underConstruction = false;
                        this.ui.showNotification('🏗️ Construction Complete!',
                            `Your ${iTile.infrastructure.name} is now operational!`, 'success');
                        this.player.infrastructureUnderConstruction.splice(i, 1);
                        // Recalculate reachable hexes now that infra is active
                        this.renderer.reachableHexes = this.player.getReachableHexes(this.world);
                    }
                }
            }

            // Process cultural building construction
            if (this.player.culturalBuildings) {
                for (const bRef of this.player.culturalBuildings) {
                    const cTile = this.world.getTile(bRef.q, bRef.r);
                    if (!cTile || !cTile.culturalBuilding) continue;
                    const cb = cTile.culturalBuilding;
                    if (cb.underConstruction && cb.constructionDaysLeft > 0) {
                        cb.constructionDaysLeft--;
                        if (cb.constructionDaysLeft <= 0) {
                            cb.underConstruction = false;
                            this.ui.showNotification('🏗️ Construction Complete!',
                                `Your ${cb.name} is now operational!`, 'success');
                        }
                    }
                }
            }

            // Process relationships, aging, and dynasty
            if (typeof Relationships !== 'undefined') {
                // Daily relationship events (marriage events, NPC courtship, childbirth)
                const relEvents = Relationships.processDailyEvents(this.player, this.world);
                for (const evt of relEvents) {
                    if (evt.type === 'childbirth') {
                        this.ui.showNotification('🎉 New Child!', evt.text, 'success');
                    } else if (evt.type === 'marriage') {
                        const notifType = evt.impact === 'positive' ? 'info' : 'warning';
                        this.ui.showNotification('💍 Marriage', evt.text, notifType);
                    } else if (evt.type === 'court') {
                        this.ui.showNotification('💕 Romance', evt.text, 'info');
                    }
                }

                // Aging (yearly check — every 120 days)
                const agingResult = Relationships.processAging(this.player, this.world);
                if (agingResult) {
                    if (agingResult.died) {
                        // Player has died of old age — play death animation then show screen
                        this._triggerDeath();
                        return; // Stop processing — death animation + screen handles continuation
                    } else {
                        this.ui.showNotification('🎂 Birthday', `You are now ${agingResult.age} years old.`, 'info');
                    }
                }

                // Prepare relationship data for save
                Relationships.prepareForSave(this.player);
            }

            // Process the House (dynasty spine) — Phase 0: no-op tick
            if (typeof House !== 'undefined') {
                House.processDaily(this.player, this.world);
            }

            // Update market prices
            MarketDynamics.updatePrices(this.world);

            // Process informants and expire old intel
            let intelResult = { cost: 0 };
            if (typeof Tavern !== 'undefined') {
                Tavern.expireOldIntel(this.player, this.world.day);
                intelResult = Tavern.processInformants(this.player, this.world);
                if (intelResult.cost > 0) {
                    this.ui.showNotification('Informants', `-${intelResult.cost}g upkeep`, 'default');
                }
                if (intelResult.lostInformants > 0) {
                    this.ui.showNotification('Informant Lost', `${intelResult.lostInformants} informant(s) left — couldn't pay`, 'error');
                }
                if (intelResult.newRumors && intelResult.newRumors.length > 0) {
                    this.ui.showNotification('New Intel', `${intelResult.newRumors.length} new report(s) from informants`, 'info');
                }
            }

            // Process espionage daily
            if (typeof Espionage !== 'undefined') {
                const espResult = Espionage.processDaily(this.player, this.world);
                if (espResult.upkeepPaid > 0) {
                    this.ui.showNotification('🕵️ Spy Network', `-${espResult.upkeepPaid}g upkeep`, 'default');
                }
                if (espResult.lostSpies > 0) {
                    this.ui.showNotification('🕵️ Spy Deserted!', `${espResult.lostSpies} spy(s) left due to low loyalty or unpaid wages.`, 'error');
                }
                for (const mission of espResult.completedMissions) {
                    const outcomeData = mission.outcomeData || {};
                    const notifType = mission.outcome === 'captured' ? 'error' :
                        mission.outcome === 'failure' ? 'warning' :
                        mission.outcome === 'criticalSuccess' ? 'success' : 'info';
                    this.ui.showNotification(
                        `${outcomeData.icon || '📋'} ${outcomeData.label || 'Mission Complete'}`,
                        mission.text,
                        notifType
                    );
                    if (mission.levelUp) {
                        this.ui.showNotification('⬆️ Spy Level Up!', `${mission.spyName} reached level ${mission.newLevel}!`, 'success');
                    }
                }
                for (const reb of espResult.rebellionUpdates) {
                    if (reb.ended) {
                        const k = this.world.getKingdom(reb.kingdomId);
                        this.ui.showNotification('🔥 Rebellion Ended', `The rebellion in ${k ? k.name : 'a kingdom'} has subsided.`, 'info');
                    }
                }
                Espionage.prepareForSave(this.player);
            }

            // Process gossip / rumors
            {
                const gossipResult = Gossip.processDaily(this.player, this.world);
                for (const c of gossipResult.newConsequences) {
                    if (c.consequence === 'bounty') {
                        this.ui.showNotification('⚠️ Bounty Issued!', `A bounty has been placed on you in ${c.settlementName} for ${c.rumorType}.`, 'error');
                    } else if (c.consequence === 'warrant') {
                        this.ui.showNotification('🚨 Kingdom Warrant!', `A kingdom-wide warrant for your arrest has been issued near ${c.settlementName}!`, 'error');
                    }
                }
            }

            // Process loans
            const loanResults = Banking.processLoans(this.player, this.world);
            if (loanResults.paid > 0) {
                this.ui.showNotification('Loan Payment', `-${loanResults.paid} gold`, 'default');
            }
            for (const defaulted of loanResults.defaulted) {
                if (defaulted.seizedProperty) {
                    this.ui.showNotification('Property Seized!', `Couldn't pay loan - property confiscated!`, 'error');
                } else {
                    this.ui.showNotification('Loan Default', `Missed payment! +5% penalty`, 'error');
                }
            }

            // Collect taxes (every 7 days)
            let taxCollected = 0;
            if (this.world.day % 7 === 0) {
                const taxResults = Taxation.collectTaxes(this.player, this.world);
                taxCollected = taxResults.collected || 0;
                if (taxCollected > 0) {
                    this.ui.showNotification('Tax Collection', `+${taxCollected} gold from settlements`, 'success');
                }
            }

            // Resume queued multi-day travel if any
            if (this.player.queuedPath) {
                const resumed = this.player.resumeQueuedPath();
                if (resumed) {
                    const dest = this.player.travelDestination;
                    const remaining = this.player.path.length - this.player.pathIndex;
                    this.ui.showNotification('Resuming Travel',
                        `Continuing journey${dest ? ` to (${dest.q}, ${dest.r})` : ''} — ~${remaining} tiles remaining`, 'info');
                }
            }

            // Show reachable hexes for the new day
            this.renderer.reachableHexes = this.player.getReachableHexes(this.world);

            this.ui.updateStats(this.player, this.world);
            this.minimap.invalidate();

            // Show player production notifications
            if (playerResults.production && Object.keys(playerResults.production).length > 0) {
                let msg = 'Produced: ';
                const parts = [];
                for (const [good, amount] of Object.entries(playerResults.production)) {
                    if (amount > 0) {
                        const icon = PlayerEconomy.GOODS[good.toUpperCase()] ? PlayerEconomy.GOODS[good.toUpperCase()].icon : '';
                        const name = PlayerEconomy.GOODS[good.toUpperCase()] ? PlayerEconomy.GOODS[good.toUpperCase()].name : good;
                        parts.push(`${icon} ${amount} ${name}`);
                    }
                }
                if (parts.length > 0) {
                    this.ui.showNotification('Production', msg + parts.join(', '), 'success');
                    this.ui.showNotification('Storage', 'Visit properties to collect produced goods', 'info');
                }
            }

            if (playerResults.faithIncome > 0) {
                this.ui.showNotification('Faith Income', `+${playerResults.faithIncome} gold from followers`, 'success');
            }

            // Chance for traveling merchants
            PlayerEconomy.spawnTravelingMerchant(this.player, this.world);

            if (playerResults.upkeepCost > 0) {
                this.ui.showNotification('Army Upkeep', `-${playerResults.upkeepCost} gold`, 'default');
            }

            if (playerResults.mercenaryWages > 0) {
                this.ui.showNotification('Mercenary Wages', `-${playerResults.mercenaryWages} gold`, 'default');
            }

            if (playerResults.unitsLost > 0) {
                this.ui.showNotification('Desertion!', `Lost ${playerResults.unitsLost} units (couldn't pay upkeep)`, 'error');
            }

            if (playerResults.mercenaryEvents && playerResults.mercenaryEvents.length > 0) {
                for (const event of playerResults.mercenaryEvents) {
                    if (event.type === 'outbid_switch') {
                        this.ui.showNotification('💰 Mercenaries Defected!', event.text, 'error');
                    } else if (event.type === 'contract_expired') {
                        this.ui.showNotification('📜 Mercenary Contract Ended', event.text, 'default');
                    } else if (event.type === 'loyalty_warning') {
                        this.ui.showNotification('⚠️ Mercenary Loyalty', event.text, 'warning');
                    }
                }
            }

            // Caravan completions
            for (const caravan of playerResults.caravansCompleted) {
                if (caravan.eventType === 'auction') {
                    this.ui.showNotification(caravan.title || 'Auction', caravan.message || '', caravan.severity || 'default');
                    continue;
                }

                if (caravan.status === 'lost') {
                    this.ui.showNotification('Caravan Lost', caravan.message || `${caravan.from} → ${caravan.to} was lost on the road.`, 'error');
                } else if (caravan.status === 'smuggling_caught') {
                    this.ui.showNotification('Smuggling Intercepted', `${caravan.from} → ${caravan.to}: +${caravan.finalProfit} gold after confiscation`, 'default');
                } else {
                    this.ui.showNotification('Caravan Arrived!', `${caravan.from} → ${caravan.to}: +${caravan.finalProfit} gold`, 'success');
                }
            }

            // Contract updates
            if (playerResults.contractUpdate && playerResults.contractUpdate.completed) {
                const c = playerResults.contractUpdate;
                if (c.casualties > 0) {
                    this.ui.showNotification('Contract Complete', `${c.contract.name} finished. Lost ${c.casualties} units. +${c.payment} gold`, 'default');
                } else {
                    this.ui.showNotification('Contract Complete!', `${c.contract.name} finished successfully! +${c.payment} gold`, 'success');
                }
            }

            // Faith spread
            if (playerResults.followersGained > 0) {
                this.ui.showNotification('Faith Spreads', `+${playerResults.followersGained} followers`, 'info');
            }

            // Blessings expired
            for (const blessing of playerResults.blessingsExpired) {
                this.ui.showNotification('Blessing Faded', `${blessing} blessing has expired`, 'default');
            }

            // Technology research progress
            if (playerResults.researchUpdate) {
                if (playerResults.researchUpdate.completed) {
                    this.ui.showNotification('Research Complete!', `🔬 ${playerResults.researchUpdate.tech.name} blueprint acquired! Craft parts to implement.`, 'success');
                } else if (playerResults.researchUpdate.remaining) {
                    if (playerResults.researchUpdate.remaining <= 1) {
                        this.ui.showNotification('Research', `Almost done! 1 day remaining`, 'info');
                    }
                }
            }

            // Parts crafting progress
            if (playerResults.craftingUpdate) {
                if (playerResults.craftingUpdate.completed) {
                    this.ui.showNotification('Crafting Complete!', `🔧 ${playerResults.craftingUpdate.quantity}x parts crafted and added to inventory!`, 'success');
                } else if (playerResults.craftingUpdate.remaining) {
                    if (playerResults.craftingUpdate.remaining <= 1) {
                        this.ui.showNotification('Crafting', `Parts almost ready! 1 day remaining`, 'info');
                    }
                }
            }

            // Cultural building income
            if (playerResults.cultureIncome > 0) {
                this.ui.showNotification('Cultural Income', `+${playerResults.cultureIncome} gold from cultural buildings`, 'success');
            }
            if (playerResults.cultureRenown > 0) {
                this.ui.showNotification('Cultural Renown', `+${playerResults.cultureRenown} renown from monuments`, 'info');
            }

            if (playerResults.festivalUpdate) {
                const fu = playerResults.festivalUpdate;
                if (fu.moraleExpired) {
                    this.ui.showNotification('Festival Spirit Fades', 'Your recent celebration morale bonus has ended.', 'default');
                } else if (fu.moraleDaysLeft > 0) {
                    this.ui.showNotification('Festival Morale', `Army morale boosted by ${Math.round((fu.moraleValue || 0) * 100)}% for ${fu.moraleDaysLeft} more day(s).`, 'info');
                }
            }

            // Indentured servitude updates
            if (playerResults.servitudeUpdate) {
                const su = playerResults.servitudeUpdate;
                if (su.freed) {
                    this.ui.showNotification('Freedom!', su.message, 'success');
                } else {
                    this.ui.showNotification('Indentured Servitude', su.message, 'default');
                }
            }

            // Bounty hunting updates
            if (playerResults.bountyTracking && playerResults.bountyTracking.escalated && playerResults.bountyTracking.escalated.length > 0) {
                for (const update of playerResults.bountyTracking.escalated) {
                    this.ui.showNotification('Bounty Escalated', `${update.targetName} has grown more dangerous (difficulty ${update.difficulty}).`, 'warning');
                }
            }

            // Bounties expired
            if (playerResults.bountiesExpired && playerResults.bountiesExpired.length > 0) {
                for (const bounty of playerResults.bountiesExpired) {
                    this.ui.showNotification('Bounty Expired', `${bounty.icon} ${bounty.name} — time ran out!`, 'error');
                }
            }

            // Show day events
            if (result.events.length > 0) {
                for (const event of result.events) {
                    this.ui.showNotification('World Event', event.text, 'info');
                }
            }

            // Check for completed quests
            const completedQuests = Quests.updateProgress(this.player, this.world);
            for (const quest of completedQuests) {
                this.ui.showNotification('Quest Complete!', `${quest.title} - Rewards: ${JSON.stringify(quest.rewards)}`, 'success');
            }

            // Check for new achievements
            const newAchievements = Achievements.checkAchievements(this.player, this.world);
            for (const achievement of newAchievements) {
                this.ui.showNotification('Achievement Unlocked!', `${achievement.icon} ${achievement.name}: ${achievement.description}`, 'success');
            }

            // Auto-save every N days (0 = disabled)
            if (SaveLoad.AUTO_SAVE_INTERVAL > 0 && this.world.day % SaveLoad.AUTO_SAVE_INTERVAL === 0) {
                const result = SaveLoad.saveGame(this);
                if (result.success) {
                    this.ui.showNotification('Auto-Saved', 'Game progress saved', 'default');
                }
            }

            // ── Record daily finances ──────────────────────────────
            const dayFinance = {
                day: this.world.day,
                season: this.world.season,
                year: this.world.year,
                goldEnd: this.player.gold,
                income: {},
                expenses: {},
            };

            // Income sources
            if (playerResults.faithIncome > 0) dayFinance.income.faith = playerResults.faithIncome;
            if (playerResults.cultureIncome > 0) dayFinance.income.culture = playerResults.cultureIncome;

            // Caravan profits
            let caravanProfit = 0;
            for (const c of playerResults.caravansCompleted) {
                if (c.eventType) continue;
                caravanProfit += c.finalProfit || 0;
            }
            if (caravanProfit > 0) dayFinance.income.caravans = caravanProfit;

            // Contract payment
            if (playerResults.contractUpdate && playerResults.contractUpdate.completed) {
                dayFinance.income.contracts = playerResults.contractUpdate.payment || 0;
            }

            // Tax income
            if (taxCollected > 0) dayFinance.income.taxes = taxCollected;

            // Expense sources
            if (playerResults.upkeepCost > 0) dayFinance.expenses.armyUpkeep = playerResults.upkeepCost;
            if (playerResults.mercenaryWages > 0) dayFinance.expenses.mercenaryWages = playerResults.mercenaryWages;
            if (loanResults && loanResults.paid > 0) dayFinance.expenses.loanPayments = loanResults.paid;
            if (typeof Tavern !== 'undefined' && intelResult && intelResult.cost > 0) dayFinance.expenses.informants = intelResult.cost;

            // Property upkeep (calculated from properties)
            let propertyUpkeep = 0;
            if (this.player.properties) {
                for (const prop of this.player.properties) {
                    const tile = this.world.getTile(prop.q, prop.r);
                    if (tile && tile.playerProperty) {
                        propertyUpkeep += (tile.playerProperty.upkeep || 0) * (tile.playerProperty.level || 1);
                    }
                }
            }
            if (propertyUpkeep > 0) dayFinance.expenses.propertyUpkeep = propertyUpkeep;

            // Calculate totals
            dayFinance.totalIncome = Object.values(dayFinance.income).reduce((a, b) => a + b, 0);
            dayFinance.totalExpenses = Object.values(dayFinance.expenses).reduce((a, b) => a + b, 0);
            dayFinance.netChange = dayFinance.totalIncome - dayFinance.totalExpenses;

            // Store — keep last 90 days
            if (!this.player.financeHistory) this.player.financeHistory = [];
            this.player.financeHistory.push(dayFinance);
            if (this.player.financeHistory.length > 90) {
                this.player.financeHistory = this.player.financeHistory.slice(-90);
            }

            // Reset inner map time if the day was ended while on the inner map
            if (this.innerMapMode && typeof InnerMap !== 'undefined') {
                InnerMap.timeOfDay = 8;
                InnerMap._timeAccumulator = 0;
                InnerMap.dayEnded = false;
                this._innerMapDayEndShown = false;
            }

            this.ui.showNotification('New Day', `Day ${((this.world.day - 1) % 30) + 1} of ${this.world.season}, Year ${this.world.year}`, 'default');
        } catch (e) {
            console.error("Error ending day:", e);
            this.ui.showNotification('Error', 'Failed to end day. Check console.', 'error');
        } finally {
            this.isProcessingTurn = false;
            document.body.style.cursor = 'default';
        }
    }, 50);
}

/**
 * Player prays (gain karma)
 */

