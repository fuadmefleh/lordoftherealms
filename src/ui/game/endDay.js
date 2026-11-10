// ============================================
// END DAY � onPlayerArrived, endDay turn processing
// ============================================

import { Camera, Renderer, Player, World, SaveLoad, Terrain, Banking, MarketDynamics, Taxation, Characters, Minimap, UI, Quests, Achievements, Technology, Relationships, Ships, Titles, Councils, InnerMap, InnerMapRenderer, InnerMapCharacters, InnerMapCombat, LightSystem, ModStore, audioManager, DataLoader, Hex, Utils, PlayerActions, PlayerEconomy, PlayerMilitary, ActionMenu, Housing, House, Schemes, Petitions, RealmWars, Throne, Espionage, Gossip, Tavern, Economy, TiledExport, CustomObjects, CustomBuildings, Hotbar, NpcDialog, WorldEvents, WEATHER_TYPES, LegendaryArtifacts, Cartography } from './_gameImports.js';
import { DayClock } from './dayClock.js';
import { Infrastructure } from '../../systems/infrastructure.js';
import { BackRooms } from '../../systems/backRooms.js';
import { Afterlife } from '../../player/afterlife.js';
import { DawnBirth } from '../../player/dawnBirth.js';
import { Parentage } from '../../player/parentage.js';
import { AutoUpkeep } from '../../player/autoUpkeep.js';
import { Languages } from '../../systems/languages.js';
import { Commissions } from '../../systems/commissions.js';
import { Traits } from '../../systems/traits.js';
import { Hospitality } from '../../systems/hospitality.js';
import { Crops } from '../../systems/crops.js';
import { Delves } from '../../systems/delves.js';
import { Ailments } from '../../systems/ailments.js';
import { TownProps } from '../../world/townProps.js';
import { Underworld } from '../../systems/underworld.js';
import { Gangs } from '../../systems/gangs.js';
import { Holdings } from '../../systems/holdings.js';
import { Rivals } from '../../systems/rivals.js';
import { Upbringing } from '../../systems/upbringing.js';
import { HeirAgency } from '../../systems/heirAgency.js';
import { Regency } from '../../systems/regency.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { Lots } from '../../systems/lots.js';
import { Graveyards } from '../../systems/graveyards.js';
import { Livestock } from '../../systems/livestock.js';
import { Sagas } from '../../systems/sagas.js';
import { Whispers } from '../../systems/whispers.js';
import { Devotion } from '../../systems/devotion.js';
import { SoulPact } from '../../systems/soulPact.js';
import { CourtLetters } from '../../systems/courtLetters.js';
import { Couriers } from '../../systems/couriers.js';
import { Mail } from '../../systems/mail.js';
import { CourierRiders } from '../../systems/courierRiders.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { PanelRefresh } from '../panelRefresh.js';
import { Fame } from '../../systems/fame.js';
import { Demands } from '../../systems/demands.js';
import { Sieges } from '../../systems/sieges.js';
import { HoldingSieges } from '../../systems/holdingSieges.js';
import { Discovery } from '../../systems/discovery.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';
import { Kingship } from '../../systems/kingship.js';
import { Chatter } from '../../systems/chatter.js';
import { Heralds } from '../../systems/heralds.js';
import { Patronage } from '../../systems/patronage.js';
import { OutlawLairs } from '../../systems/outlawLairs.js';
import { MerchantCaravans } from '../../systems/merchantCaravans.js';
import { Finance } from '../../systems/finance.js';
import { Fiscal } from '../../systems/fiscal.js';
import { MarketFairs } from '../../systems/marketFairs.js';
import { MerchantPrince } from '../../systems/merchantPrince.js';
import { Labour } from '../../systems/labour.js';
import { Guilds } from '../../systems/guilds.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { Concessions } from '../../systems/concessions.js';
import { LandMarket } from '../../systems/landMarket.js';
import { PuttingOut } from '../../systems/puttingOut.js';
import { Harvests } from '../../world/harvests.js';
import { TradePolicy } from '../../systems/tradePolicy.js';
import { Coalitions } from '../../systems/coalitions.js';
import { RivalAgents } from '../../systems/rivalAgents.js';
import { EconomyChronicle } from '../../systems/economyChronicle.js';
import { Victory } from '../../systems/victory.js';
import { Ledger } from '../../systems/ledger.js';
import { Underwriting } from '../../systems/underwriting.js';
import { Bills } from '../../systems/bills.js';
import { Bourse } from '../../systems/bourse.js';
import { PublicWorks } from '../../systems/publicWorks.js';
import { Mints } from '../../systems/mints.js';
import { Engrossing } from '../../systems/engrossing.js';
import { FirstSteps } from '../../systems/firstSteps.js';
import { Reckoning } from '../../systems/reckoning.js';
import { onVoyageDay } from '../actionMenu/voyage.js';
import { showMorningBrief, updateCounselBadge } from '../actionMenu/counsel.js';
import { showDayBanner } from '../dayBanner.js';
import { settleScene } from '../actionMenu/choiceScenes.js';
import { Pirates } from '../../systems/pirates.js';
import { Landings } from '../../systems/landings.js';
import { MapTheft } from '../../systems/mapTheft.js';
import { checkMapAccusation } from '../actionMenu/treasureScenes.js';

export function onPlayerArrived() {
    const tile = this.world.getTile(this.player.q, this.player.r);
    if (!tile) return;

    // Update music scene based on new terrain
    audioManager.updateSceneFromGameState(this);

    // Show reachable hexes
    this.renderer.reachableHexes = this.player.getReachableHexes(this.world);

    // Seeing land for yourself exposes the lies on your maps
    this._reportExposedDeceptions();

    // If arrived at a settlement
    if (tile.settlement) {
        Quests.trackSettlementVisited(this.player, tile.settlement.name);
        // A map-owner you robbed is waiting for you here (systems/mapTheft.js)
        checkMapAccusation(this);
        // Townsfolk talk of what is happening here (systems/chatter.js), now and then
        if (this.ui._townChatter !== false) {
            const key = `${this.player.q},${this.player.r}`;
            if (!this._chatterHeard) this._chatterHeard = {};
            const last = this._chatterHeard[key];
            if (last == null || this.world.day - last >= Chatter.config().ambientCooldownDays) {
                const said = Chatter.ambient(this.world, this.player, this.player.q, this.player.r);
                if (said) {
                    this._chatterHeard[key] = this.world.day;
                    const who = said.who.charAt(0).toUpperCase() + said.who.slice(1);
                    this.ui.showNotification(`🗣️ Overheard in ${said.settlementName}`, `${who}: "${said.text}"`, 'default');
                }
            }
        }
        // Kingdoms visited, for the Globe Trotter achievement
        const kId = tile.settlement.kingdom;
        if (kId) {
            if (!this.player.kingdomsVisited) this.player.kingdomsVisited = [];
            if (!this.player.kingdomsVisited.includes(kId)) this.player.kingdomsVisited.push(kId);
        }
        const sType = tile.settlement.type;
        this.ui.showNotification(
            `Arrived at ${tile.settlement.name}`,
            `You have arrived at this ${sType}. Population: ${Utils.formatNumber(tile.settlement.population)}.`,
            'success'
        );
        // Underworld heat: a warning at the gate, and perhaps a guard search
        const gate = Underworld.onEnterSettlement(this.player, this.world, tile);
        if (gate.warning) {
            this.ui.showNotification(`🔥 Heat ${Math.round(gate.heat)}`, gate.warning, gate.level === 'watched' ? 'warning' : 'error');
        }
        if (gate.search) {
            this.ui.showNotification(gate.search.arrested ? '🚔 Arrested at the Gate' : '🛂 Guard Search', gate.search.text,
                gate.search.arrested || gate.search.fine > 0 ? 'error' : 'warning');
            this.ui.updateStats(this.player, this.world);
        }
        // Your name here (systems/fame.js): crowds and gifts for the celebrated, guards for the shunned
        for (const n of Fame.onEnterSettlement(this.player, this.world, tile)) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
        // Discover basic kingdom knowledge by visiting a settlement
        if (tile.settlement.kingdom) {
            const learned = this.player.learnAboutKingdom(tile.settlement.kingdom, 'basics');
            if (learned.length > 0) {
                const k = this.world.getKingdom(tile.settlement.kingdom);
                if (k) this.ui.showNotification('Knowledge Gained', `You have learned about the realm of ${k.name}.`, 'info');
            }
        }
        // Rival adventurers resting here (systems/rivals.js)
        for (const m of Rivals.onPlayerArrived(this.player, this.world, tile)) {
            const att = Rivals.attitudeOf(m.rival);
            this.ui.showNotification(`${m.rival.icon} ${m.first ? 'You meet ' : ''}${m.rival.name}`,
                `${m.first ? `${Rivals.archetype(m.rival.archetype).label}, renown ${m.rival.renown}. ` : `${att.icon} ${att.label}. `}"${m.line}" (Adventurers here, in the action menu)`, 'info');
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

    // A site a rival adventurer got to first
    if (tile.improvement && tile.improvement.lootedBy) {
        this.ui.showNotification('🕯️ Already Looted', `${tile.improvement.name} has been stripped bare — ${tile.improvement.lootedBy} got here first.`, 'default');
    }

    // If tile has resources
    if (tile.resource) {
        this.ui.showNotification(
            'Resources Found',
            `This area has ${tile.resource.name} ${tile.resource.icon}`,
            'info'
        );
    }

    // A standing order to chart the area walks on from here (ui/game/autoChart.js)
    if (this.player.autoChart) this._autoChartStep();
}

/**
 * End the current day
 */
export function endDay() {
    if (!this.world || !this.player) return;
    if (this.isProcessingTurn) return;
    // Dead and waiting: End Day lets a day of the world pass without the player (player/afterlife.js)
    if (Afterlife.active(this.player)) {
        ActionMenu.passInterregnumDays(this, 1);
        return;
    }

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
    // The panel open as the day ends redraws with the new day's values (ui/panelRefresh.js)
    const panelBefore = PanelRefresh.snapshot(this.ui);

    // Use setTimeout to allow UI to update (show loading state) before heavy processing
    setTimeout(() => {
        let heldScan = false;
        try {
            // A choice scene left open (sea, digs, prison, duties) is settled first (ui/actionMenu/choiceScenes.js)
            settleScene(this);
            // The day's last hours: points left over go on the character's own
            // upkeep — a wash, clean clothes, a bed, an evening's company
            // (player/autoUpkeep.js; Settings → The Day's Last Hours)
            const upkeep = AutoUpkeep.run(this.player, this.world, { mode: this.ui && this.ui._autoUpkeep });
            if (upkeep) this.ui.showNotification('🌙 The Day\'s Last Hours', upkeep.text, 'info');
            // Process player's daily activities
            const playerResults = PlayerActions.endDay(this.player, this.world);
            // A night between: whatever a deep dive took, the breath is back (player/diving.js)
            if (this.player.breathRecovery && !this.player.dive) this.player.breathRecovery = null;

            // Show jail update notifications
            if (playerResults.jailUpdate) {
                if (playerResults.jailUpdate.freed) {
                    this.ui.showNotification('🔓 Released!', playerResults.jailUpdate.message, 'success');
                }
                // A night in the cell: tools smuggled in, a snitch, a search (player/prison.js)
                for (const n of playerResults.jailUpdate.notices || []) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
                // A day's march in chains: what happened on the road, or the jail at the end of it
                const march = playerResults.jailUpdate.march;
                if (march) setTimeout(() => ActionMenu.showMarch(this, march), 0);
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
                if (tu.audit) {
                    if (tu.audit.exposed) this.ui.showNotification('🧾 Audit: Caught Skimming!', `The crown's auditors found ${tu.audit.skimmed} gold missing from your collections. You repaid ${tu.audit.paid} of the ${tu.audit.owed} gold owed; your name is blackened at court.`, 'error');
                    else this.ui.showNotification('🧾 Audit Passed', `The crown's auditors went through your books and found nothing amiss (${tu.audit.skimmed} gold slipped past them).`, 'warning');
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

            // The council's factions drift with how you govern
            if (typeof Councils !== 'undefined') {
                const council = Councils.processDaily(this.player, this.world);
                if (council.warning) this.ui.showNotification('🏛️ Council in Uproar', council.warning, 'warning');
                if (council.removed) this.ui.showNotification('🏛️ No Confidence', 'The council has voted you out of office.', 'error');
            }

            // Process world turn
            // Aqueducts/herbalism/plague prevention grow your colonies;
            // philosophy/printing press steady them
            // (the day's settlement scan is kept for the systems below; released in finally)
            if (typeof this.world.holdSettlementScan === 'function') { this.world.holdSettlementScan(); heldScan = true; }
            const result = this.world.advanceDay(this.player, {
                playerBonuses: {
                    colonyGrowth: Technology.getEffectTotal(this.player, 'settlementGrowthBonus')
                        + Technology.getEffectTotal(this.player, 'populationGrowthBonus'),
                    colonyLoyalty: 0.1 * Technology.getEffectTotal(this.player, 'stabilityBonus'),
                    colonyFood: Technology.getEffectTotal(this.player, 'settlementFoodBonus'),
                },
            });
            this.player.endDay(this.world);
            // Low needs nag once per day on the world map too
            if (typeof this._checkNeedWarnings === 'function') this._checkNeedWarnings();
            // World events on the player's tile: blizzards slow travel and
            // freeze armies camped in the open
            const eventEffects = WorldEvents.applyPlayerDailyEffects(this.world, this.player);
            if (eventEffects.unitsLost > 0) {
                this.ui.showNotification('❄️ Attrition', `The harsh conditions claimed ${eventEffects.unitsLost} of your soldiers. Shelter in a settlement to stop the losses.`, 'warning');
            }
            this._reportWeather(eventEffects);

            // Wounds and sickness: mend or fester, pass or worsen; new illness
            // from the night's exposure, the food, the swamp, plague or the sea
            const ailmentDay = Ailments.processDay(this.world, this.player, {
                exposure: eventEffects.weatherHealthLost || 0,
                weather: eventEffects.weather,
            });
            this._reportAilments(ailmentDay);
            if (ailmentDay.died) {
                this._triggerDeath(ailmentDay.died.cause);
                return;
            }
            this.player.updateVisibility(this.world, 4);
            this._reportExposedDeceptions();

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

            // The kin's pot at the dawn (player/dawnBirth.js): fed, turned away, or repaid
            const kinMeal = this.player._kinMeal;
            if (kinMeal && kinMeal.text && !kinMeal.earned) {
                this.ui.showNotification(kinMeal.refused ? '🍲 Nothing in the Pot' : kinMeal.qty ? '🍲 To the Pot' : '🍲 Your Kin Share',
                    kinMeal.text, kinMeal.refused ? 'warning' : 'info');
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

            // Reforged relics' daily blessings
            LegendaryArtifacts.processDaily(this.player);

            // Process housing maintenance
            if (typeof Housing !== 'undefined') {
                Housing.processDaily(this.player, this.world);
            }

            // Process ship daily events
            if (typeof Ships !== 'undefined') {
                // Capture ship statuses before processing
                const shipsBefore = (this.player.ships || []).map(s => ({ id: s.id, status: s.status, name: s.name, buildDaysLeft: s.buildDaysLeft, travelDaysLeft: s.travelDaysLeft }));
                const shipDay = Ships.processDaily(this.player, this.world);
                // A voyage under way: its day goes to the voyage panel once the day is done
                this._voyageDay = (shipDay && shipDay.voyage) || null;
                for (const rep of (shipDay && shipDay.stormReports) || []) {
                    const wx = WEATHER_TYPES[rep.weather] || { icon: '⛈️', name: 'Storm' };
                    let text = `${rep.name} was caught in a ${wx.name.toLowerCase()} at sea (hull −${rep.damage}%).`;
                    if (rep.delayed) text += ' The voyage is held back a day.';
                    if (rep.cargoLost) text += ` ${rep.cargoLost.qty} ${rep.cargoLost.good} washed overboard.`;
                    if (rep.crewLost) text += ' A sailor was lost overboard.';
                    this.ui.showNotification(`${wx.icon} Storm at Sea`, text, 'warning');
                }
                // Sailing rose a level (systems/ships.js _sailingDay); on a voyage it is in the log too
                if (shipDay && shipDay.sailing) this.ui.showNotification(`${shipDay.sailing.icon} ${shipDay.sailing.name} Improved`, shipDay.sailing.text, 'success');
                const crewDay = shipDay && shipDay.crew;
                if (crewDay && !crewDay.paid) {
                    this.ui.showNotification('👥 Wages Unpaid',
                        `You couldn't pay your sailors ${crewDay.wages}g today. Their morale is falling — unpaid crews desert.`, 'warning');
                }
                // Royal fleets stop ships near hostile ports
                for (const ic of (shipDay && shipDay.interceptions) || []) {
                    this.ui.showNotification(ic.won ? '⚓ Squadron Beaten Off' : '⚓ Ship Intercepted', ic.text, ic.won ? 'success' : 'error');
                }
                for (const d of (crewDay && crewDay.deserted) || []) {
                    this.ui.showNotification('👥 Desertion',
                        `${d.count} sailor${d.count === 1 ? '' : 's'} deserted the ${d.name} — morale had collapsed.`, 'error');
                }
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

                    // Each ref is one property — tick only that one, not every
                    // property sharing the tile
                    const prop = PlayerEconomy.findPropertyAt(pTile, propRef.type);
                    if (prop && prop.underConstruction && prop.constructionDaysLeft > 0) {
                        prop.constructionDaysLeft--;
                        if (prop.constructionDaysLeft <= 0) {
                            prop.underConstruction = false;
                            Quests.track(this.player, 'buildings_constructed');
                            this.ui.showNotification('🏗️ Construction Complete!',
                                `Your ${prop.name} is now operational!`, 'success');
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
                            Quests.track(this.player, 'buildings_constructed');
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
                        Infrastructure.finishConstruction(this.world, iTile);
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
                            Quests.track(this.player, 'buildings_constructed');
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
                    } else if (evt.type === 'matter') {
                        // Someone you know has something to settle with you (systems/relationships/matters.js)
                        this.ui.showNotification(`${evt.icon} ${evt.title}`, evt.text, evt.ignored ? 'warning' : 'info');
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
                    for (const npc of (agingResult.deaths || [])) {
                        const who = `${npc.firstName} ${npc.dynasty || ''}`.trim();
                        this.ui.showNotification('🕯️ A Death', `${who} of ${npc.settlementName || 'the realm'} has died, aged ${npc.age}.`, 'warning');
                    }
                }

                // Raising the heirs — growth, tutors, childhood events, coming of age
                this._reportUpbringing(Upbringing.processDay(this.player, this.world));
                // Children abroad and at work (fosterings, betrothals, embassies, a commander's wounds),
                // and a child's reign under a regent (systems/heirAgency.js, systems/regency.js)
                for (const n of HeirAgency.processDay(this.player, this.world).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
                for (const n of Regency.processDay(this.player, this.world).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

                // The townsfolk live a season: births, deaths, weddings, comings and goings.
                // Building lots and houses to let: rent day, and the town's other buyers (systems/lots.js)
                for (const n of Lots.processDay(this.world, this.player).notices.slice(0, 3)) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
                // The dead to the ground: burials, leases run out and renewed, bone mills, ossuaries, your own dead (systems/graveyards.js)
                for (const n of Graveyards.processDay(this.world, this.player).notices.slice(0, 3)) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

                // Word reaches the player of the people they have met.
                const folkIcons = { died: '🕯️', wed: '💍', born: '👶', left: '🧳', arrived: '🏘️' };
                for (const n of Townsfolk.processDay(this.world, this.player).slice(0, 4)) {
                    if (!n.text) continue;
                    const town = this.world.getTile && this.world.getTile(n.folk.q, n.folk.r);
                    const where = town && town.settlement ? town.settlement.name : 'afar';
                    this.ui.showNotification(`${folkIcons[n.kind] || '📜'} Word from ${where}`, n.text, n.kind === 'died' ? 'warning' : 'info');
                }
                // Townsfolk who are friends, lovers, companions or kin by marriage
                Relationships.syncFolk(this.player, this.world);

                // Prepare relationship data for save
                Relationships.prepareForSave(this.player);
            }

            // Process the House (dynasty spine) — Prestige decay + ambitions
            if (typeof House !== 'undefined') {
                const houseResult = House.processDaily(this.player, this.world);
                if (houseResult.ambition) {
                    const def = House._getAmbitionDef(houseResult.ambition.ambitionId);
                    const aName = def ? def.name : 'your ambition';
                    for (const msId of houseResult.ambition.milestonesCompleted) {
                        const msDef = def && def.milestones.find(x => x.id === msId);
                        this.ui.showNotification('🏛️ Ambition Advanced',
                            `${aName}: ${msDef ? msDef.label : 'milestone reached'} (+Prestige)`, 'success');
                    }
                    if (houseResult.ambition.capstoneCompleted) {
                        const got = houseResult.ambition.reward || [];
                        const next = houseResult.ambition.unlocked || [];
                        this.ui.showNotification('👑 Ambition Fulfilled!',
                            `${this.player.house.name} has achieved "${aName}"!${got.length ? ` ${got.join(', ')}.` : ''}${next.length ? ` A greater ambition opens: ${next.join(', ')}.` : ''} Choose a new ambition.`, 'success');
                    }
                }
                if (houseResult.rival) {
                    this.ui.showNotification('⚔️ Rival House',
                        `${houseResult.rival.name} covets your holdings, biding its time.`, 'warning');
                }
                // The House's court: stipends unpaid, courtiers leaving or dying, an officer's hand in the coffers (systems/court.js)
                for (const n of ((houseResult.court && houseResult.court.notices) || []).slice(0, 3)) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

                // Rival Houses in the flesh — their heads ride, trade, sit at court, age and die (systems/rivalHouses.js)
                for (const n of RivalHouses.processDay(this.player, this.world).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

                // Rival schemes — plots revealed, plots striking
                const plots = Schemes.processDaily(this.player, this.world);
                for (const name of plots.replaced) {
                    this.ui.showNotification('⚔️ Rival Fallen', `${name} has fallen — a new House rises to rival yours.`, 'info');
                }
                for (const s of plots.revealed) {
                    this.ui.showNotification('🕵️ Plot Uncovered',
                        `${Schemes.describe(s)} in ${s.dueDay - this.world.day} day(s)! Respond from Dynasty → House.`, 'warning');
                }
                for (const r of plots.resolved) {
                    if (r.outcome === 'struck') {
                        this.ui.showNotification(r.revealed ? '🗡️ Scheme Strikes' : '🗡️ Struck Without Warning',
                            `${r.scheme.rivalName}: ${r.text}`, 'error');
                    } else if (r.outcome === 'foiled') {
                        this.ui.showNotification('🛡️ Plot Foiled', r.text, 'success');
                    }
                }

                // Demands on a rich House — the crown's benevolences and forced loans, guilds, rival tribute (systems/demands.js)
                const demandDay = Demands.processDay(this.world, this.player);
                for (const n of demandDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            }

            // Court petitions — dilemmas brought to your holdings; unanswered ones expire
            const court = Petitions.processDay(this.player, this.world);
            for (const pet of court.expired) {
                this.ui.showNotification('⚖️ Petition Ignored',
                    `${pet.petition.title}: ${pet.text}${pet.effects.length ? ` (${pet.effects.join(', ')})` : ''}`, 'warning');
            }
            for (const pet of court.arrived) {
                const where = pet.ctx && pet.ctx.settlementName ? ` at ${pet.ctx.settlementName}` : '';
                this.ui.showNotification(`${pet.icon} Petitioners${where}`,
                    `${pet.title} — hear them at Court (action menu at your holdings) within ${Petitions.daysLeft(pet, this.world)} day(s).`, 'info');
            }

            // Delves — an unfinished delve ends, injuries mend, a cursed idol bites,
            // awakened guardians roam until slain or their time passes
            const delveDay = Delves.processDay(this.world, this.player);
            if (delveDay.ended) {
                this.ui.showNotification('🕯️ Delve Ended',
                    `You leave ${delveDay.ended.name} with your haul (${delveDay.ended.chambers} of ${delveDay.ended.total} chambers).`, 'info');
            }
            for (const name of delveDay.healed) this.ui.showNotification('🤕 Mended', `Your ${name.toLowerCase()} has healed.`, 'success');
            if (delveDay.curse && delveDay.curse.health > 0) {
                this.ui.showNotification('🗿 Cursed', `The idol in your packs saps you (-${delveDay.curse.health} health, -${delveDay.curse.karma} karma). Sell it or be rid of it.`, 'warning');
            }
            for (const name of delveDay.slain) this.ui.showNotification('⚔️ Guardian Slain', `${name} will trouble the land no more.`, 'success');
            for (const name of delveDay.faded) this.ui.showNotification('🌫️ Guardian Returns', `${name} has gone back to the depths.`, 'info');

            // Rival adventurers — their deeds near you, races, ambushes, slander
            const rivalDay = Rivals.processDay(this.world, this.player);
            for (const n of rivalDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Sagas — world storylines turning a chapter (systems/sagas.js)
            const sagaDay = Sagas.processDay(this.world, this.player);
            for (const n of sagaDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Whispers — court scandals hatching, spreading, proven or debunked; your planted tales traced (systems/whispers.js)
            const whisperDay = Whispers.processDay(this.world, this.player);
            for (const n of whisperDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Devotion — vows kept or broken, pilgrimages overdue (systems/devotion.js); the soul pact's debt (systems/soulPact.js)
            for (const n of Devotion.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            for (const n of SoulPact.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Stolen maps found out: bounties, heat, an owner waiting in his town (systems/mapTheft.js)
            for (const n of MapTheft.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Court letters — lords, liege, rival Houses and family write; loans fall due, promises judged (systems/courtLetters.js)
            const letterDay = CourtLetters.processDay(this.world, this.player);
            for (const n of letterDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // The post — courier houses' week, Royal Post charters (systems/couriers.js); the player's
            // letters arrive, are lost, robbed or read, and replies come home (systems/mail.js)
            for (const n of Couriers.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // ...the riders on the map ride first, so a letter's rider is at its gates on its day (systems/courierRiders.js;
            // the headless harness skips it: its letters stay abstract)
            for (const n of CourierRiders.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            for (const n of Mail.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // Hospitality — the morning after a night's lodging, your houses' week, the town houses' prices (systems/hospitality.js)
            for (const n of Hospitality.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // Your beasts: fodder, eggs and milk, births, sickness, wolves (systems/livestock.js)
            for (const n of Livestock.processDay(this.world, this.player).notices.slice(0, 4)) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // Your own fields: crops grow, thirst, ripen, freeze or rot (systems/crops.js)
            for (const n of Crops.processDay(this.world, this.player).notices.slice(0, 3)) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // Hired work finished in a town's mill, bakery, smithy… (systems/commissions.js)
            for (const n of Commissions.processDay(this.player, this.world).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // Tongues: living among speakers teaches; the interpreter is paid (systems/languages.js)
            for (const n of Languages.processDay(this.player, this.world).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // The Dawn of Man: the player's clan made camp for good — the family moves in (player/dawnBirth.js)
            {
                const settled = DawnBirth.sync(this.player, this.world);
                if (settled) this.ui.showNotification('🔥 Home', settled, 'success');
            }
            // Under your parents' roof: curfew, the leash, duties, allowance, trust, coming of age (player/parentage.js)
            for (const n of Parentage.processDay(this.player, this.world).notices.slice(0, 4)) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            if (ActionMenu.updateLettersBadge) ActionMenu.updateLettersBadge(this);

            // The towns' gangs — protection, dens, the black market, wages, smuggling, wars, raids, betrayals (systems/gangs.js)
            for (const n of Gangs.processDay(this.world, this.player).notices.slice(0, 5)) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // A back room in a tavern of yours, where gaming is forbidden: the watch may find it (systems/backRooms.js)
            for (const n of BackRooms.processDay(this.player, this.world).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Outlaw lairs — formation, growth, raiding parties, realm expeditions (systems/outlawLairs.js)
            const lairDay = OutlawLairs.processDay(this.world, this.player);
            for (const n of lairDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Uncharted lands — sightings at sea, finds close by, rivals' finds, claims (systems/discovery.js)
            const discoveryDay = Discovery.processDay(this.world, this.player);
            for (const n of discoveryDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Sea rovers — named captains grow and are replaced, infamy cools; at sea, hunters or a vengeful captain may come for you (systems/pirates.js)
            const pirateDay = Pirates.processDay(this.world, this.player);
            for (const n of pirateDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            if (pirateDay.threat) {
                const encounter = Pirates.startThreat(this.player, this.world, pirateDay.threat);
                if (encounter && typeof document !== 'undefined') ActionMenu.showScene(this, 'sea', encounter);
                else if (encounter) Pirates.autoResolve(this.player, this.world, encounter);
            }
            // Sea reavers come ashore on your coastal holdings near their havens (systems/landings.js)
            const landingDay = Landings.processDay(this.world, this.player);
            for (const n of landingDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Kingdoms at war with the player — ultimatums, war hosts, sieges
            const war = RealmWars.processDaily(this.player, this.world);
            for (const u of war.ultimatums) {
                this.ui.showNotification('📜 Ultimatum',
                    `${u.name} demands ${u.tribute} gold within ${u.dueDay - this.world.day} days, or it means war. Respond from Dynasty → House.`, 'warning');
            }
            for (const w of war.declared) {
                this.ui.showNotification('⚔️ War Declared!', `${w.name} has declared war on you! Its armies will march on your holdings.`, 'error');
            }
            for (const m of war.marching) {
                const t = m.host.target;
                this.ui.showNotification('🚩 War Host Marching',
                    `${m.host.name} (strength ${m.host.strength}) marches on your ${t.kind === 'colony' ? `colony ${t.name}` : `${t.type}`} at (${t.q}, ${t.r}). Meet it in the field to stop it.`, 'warning');
            }
            for (const s of war.struck) {
                this.ui.showNotification(s.siege ? '🏰 Holding Besieged' : '🔥 Holding Attacked', s.text, 'error');
            }
            for (const e of war.ended) {
                if (e) this.ui.showNotification('🕊️ Peace', `The war with ${e.war.name} is over.`, 'info');
            }
            // Sieges of your holdings — stores, works, storms, convoys, endings (systems/holdingSieges.js)
            const holdingSiegeDay = HoldingSieges.processDay(this.world, this.player);
            for (const n of holdingSiegeDay.notices) this.ui.showNotification(n.title, n.text, n.type);
            // Directed opposition — the realms weigh your power; leagues form, march, break (systems/coalitions.js);
            // rival Houses' bought townsfolk inform, sabotage, skim (systems/rivalAgents.js)
            for (const n of Coalitions.processDay(this.world, this.player, { armyStrength: PlayerMilitary.getArmyStrength(this.player) }).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            for (const n of RivalAgents.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Claims & Crowns — succession crises, a war for a throne, the realm you rule
            const throne = Throne.processDaily(this.player, this.world, { armyStrength: PlayerMilitary.getArmyStrength(this.player) });
            for (const c of throne.crises) {
                this.ui.showNotification(`👑 ${c.causeLabel}`, `${c.text} Back a claimant from Dynasty → Claims & Crowns within ${c.endDay - this.world.day} days.`, 'warning');
            }
            for (const r of throne.crisesResolved) {
                const tail = r.rewards && r.rewards.gold ? ` Your reward: ${r.rewards.gold}g and the new ruler's favour.` : (r.backed ? ' The claimant you backed has lost.' : '');
                this.ui.showNotification('👑 Crisis Ends', `${r.winner} holds the throne of ${r.kingdomName}.${tail}`, r.rewards && r.rewards.gold ? 'success' : 'info');
            }
            for (const b of throne.battles) {
                this.ui.showNotification(b.won ? '🚩 Battle Won' : '🚩 Battle Lost',
                    `${b.won ? 'Your banners carry the field' : 'The loyalists carry the field'}${b.flipped ? ` — ${b.flipped} ${b.won ? 'declares for you' : 'returns to the crown'}` : ''}.`, b.won ? 'success' : 'warning');
            }
            if (throne.civilWar) {
                const cw = throne.civilWar;
                this.ui.showNotification(cw.ended === 'crowned' ? '👑 Crowned!' : (cw.ended === 'exile' ? '🥀 Exile' : '🚩 War Ends'),
                    cw.message || `Your war for ${cw.kingdomName} is over.`, cw.ended === 'crowned' ? 'success' : 'error');
            }
            if (throne.ruling && throne.ruling.lost) {
                this.ui.showNotification('💀 Crown Lost', `${throne.ruling.kingdomName} has fallen, and your crown with it.`, 'error');
            }
            for (const name of throne.peace) {
                this.ui.showNotification('🕊️ Royal Envoys', `Your envoys win peace with ${name}.`, 'info');
            }
            // The royal court — council, edicts, vassals, factions and revolts (systems/kingship.js)
            const courtDay = Kingship.processDay(this.world, this.player);
            for (const n of courtDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Sieges — the siege in progress, tribute owed (systems/sieges.js)
            const siegeDay = Sieges.processDay(this.world, this.player);
            for (const n of siegeDay.notices) this.ui.showNotification(n.title, n.text, n.type);

            // Holdings — construction, governors, garrisons, unrest and rebellion, bandit raids
            const holdingsDay = Holdings.processDay(this.player, this.world);
            for (const c of holdingsDay.completed) this.ui.showNotification('🏗️ Project Finished', c.text, 'success');
            for (const r of holdingsDay.raids) this.ui.showNotification(r.repelled ? '🛡️ Raid Repelled' : '🔥 Holding Raided', r.text, r.repelled ? 'success' : 'error');
            for (const r of holdingsDay.rebellions) this.ui.showNotification('🔥 Rebellion!', r.text, 'error');
            for (const l of holdingsDay.lost) this.ui.showNotification('🏴 Holding Lost', l.text, 'error');
            for (const text of holdingsDay.notices) this.ui.showNotification('🏰 Holdings', text, 'warning');

            // The trading company — factors' weekly trade, convoys, contracts, rival houses, ventures
            const companyDay = MerchantHouses.processDay(this.player, this.world);
            for (const n of companyDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Patronage — clients' works, stipends, rival offers; Great Works and the
            // kingdoms' wonders (systems/patronage.js)
            const patronageDay = Patronage.processDay(this.world, this.player);
            for (const n of patronageDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // The heralds cry the great news of the day as it reaches you (systems/heralds.js)
            const heraldDay = Heralds.processDay(this.world, this.player);
            if (this.ui._heralds !== false) {
                for (const n of heraldDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            }

            // Merchant caravans and trading ships on the roads: tolls, ambushes,
            // escorts, road wardens; cargo lands on arrival (systems/merchantCaravans.js)
            const caravanDay = MerchantCaravans.processDay(this.world, this.player);
            for (const n of caravanDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Fairs open and close, and the week's market news goes to the heralds (systems/marketFairs.js)
            const fairDay = MarketFairs.processDay(this.world, this.player);
            for (const n of fairDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // The harvests: the growing season's weather, war and blights; the harvest is
            // reckoned at summer's end and sizes the towns' crops for the year (world/harvests.js)
            const harvestDay = Harvests.processDay(this.world, this.player);
            for (const n of harvestDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // The grain dealers buy into a failing harvest and sell at the peak; crowns may forbid it (systems/engrossing.js)
            for (const n of Engrossing.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // The hinterland: the rural sites around the towns dig and send their goods to
            // market on its day, deposits run down and veins are struck; mining leases
            // are paid, auctioned and revoked (world/hinterland.js, systems/concessions.js)
            const hinterlandDay = Concessions.processDay(this.world, this.player);
            for (const n of hinterlandDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // The land: each town's month of rents, tenants and land values, estates changing
            // hands; the cottagers' putting-out work (systems/landMarket.js, systems/puttingOut.js)
            for (const sys of [LandMarket, PuttingOut]) {
                for (const n of sys.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            }
            // The crowns' trade policy: tariffs, export bans, embargoes, treaties,
            // trade wars and granaries, each realm on its weekly turn (systems/tradePolicy.js)
            const tradePolicyDay = TradePolicy.processDay(this.world, this.player);
            for (const n of tradePolicyDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // The roads: wear, the realms' upkeep, washouts and snowbound passes; public works
            // (roads, bridges, canals, harbours) buying their stone and hiring hands (systems/publicWorks.js)
            const worksDay = PublicWorks.processDay(this.world, this.player);
            for (const n of worksDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // The settlement markets' day: production, consumption, NPC trade
            // (world/settlementMarket.js; lairs and sieges disrupt the roads)
            MarketDynamics.updatePrices(this.world, this.player);

            // Labour: each town's classes, hands, wages and welfare on its market day;
            // weekly migration, refugees, strikes and booms (systems/labour.js)
            const labourDay = Labour.processDay(this.world, this.player);
            for (const n of labourDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Merchant Prince: the works' pay on market day, seizures; store-rooms'
            // spoilage, rent and thieves; forward contracts due (systems/merchantPrince.js)
            const princeDay = MerchantPrince.processDay(this.player, this.world);
            for (const n of princeDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Town guilds: each town's weekly turn (formation, dues, strikes, elections,
            // lobbying, feuds); the player's dues, guild loans and contracts (systems/guilds.js)
            const guildDay = Guilds.processDay(this.world, this.player);
            for (const n of guildDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // The player's price book: the market they stand in, merchants met,
            // their factors' and stewards' reports (systems/priceKnowledge.js)
            PriceKnowledge.processDay(this.player, this.world, {
                posts: (MerchantHouses.company(this.player) || {}).posts || [],
                holdings: Holdings.list(this.player, this.world),
                traders: MerchantCaravans.traders(this.world),
            });
            // The Economic Chronicle: the realms' weekly indices, the fashions at court,
            // the gazette where the player stands, their net worth (systems/economyChronicle.js)
            EconomyChronicle.processDay(this.world, this.player);
            // The game's victory goal (systems/victory.js): met once, celebrated, and play goes on
            {
                const won = Victory.check(this.player, this.world);
                if (won) {
                    this.ui.showNotification(`${won.icon} ${won.name}`, won.text, 'success');
                    if (typeof document !== 'undefined') setTimeout(() => ActionMenu.showVictoryScene(this, won), 600);
                }
            }

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
                    if (mission.ultimatum) {
                        const u = mission.ultimatum;
                        this.ui.showNotification('📜 Ultimatum!', `${u.name} knows of your spies. Pay ${u.tribute}g in tribute by day ${u.dueDay}, or face war.`, 'error');
                    }
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
                    } else if (c.consequence === 'reputation') {
                        this.ui.showNotification('🗣️ Your Name Suffers', `Talk of your ${String(c.rumorType).replace(/_/g, ' ')} has reached ${c.settlementName}: reputation ${c.repLoss} in that realm.`, 'warning');
                    }
                }
            }

            // The Crown's Purse — every realm's taxes, wages and books; tax farms,
            // tax revolts and its tax review weekly (systems/fiscal.js; before Finance,
            // which borrows, levies and debases on the books it closes)
            for (const n of Fiscal.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Banks, Credit & Coin — deposit interest, loan payments and what a
            // missed one brings, bond coupons, the crowns' debts and coin, panics
            // (systems/finance.js; runs the loans the old Banking.processLoans did)
            const financeDay = Finance.processDay(this.world, this.player);
            if (financeDay.paid > 0) {
                this.ui.showNotification('Loan Payment', `-${financeDay.paid} gold`, 'default');
            }
            for (const n of financeDay.notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // Underwriters (premiums, claims on the day's losses, their books), bills of
            // exchange (stolen ones cashed, failed houses), the Bourse (prices, dividends, manias)
            for (const sys of [Underwriting, Bills, Bourse]) {
                for (const n of sys.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            }
            // Specie & mints: the realms' coin, its flows and price levels (weekly), recoinages,
            // the player's mint lease, the money changers at a border (systems/mints.js, world/moneySupply.js)
            for (const n of Mints.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Collect taxes (every 7 days)
            let taxCollected = 0;
            if (this.world.day % 7 === 0) {
                const taxResults = Taxation.collectTaxes(this.player, this.world);
                taxCollected = taxResults.collected || 0;
                if (taxCollected > 0) {
                    this.ui.showNotification('Tax Collection', `+${taxCollected} gold from settlements`, 'success');
                }
            }

            // Resume queued multi-day travel if any (not while a band stands in the
            // way: the journey goes on once that is settled, ActionMenu._resumeHeldJourney)
            if (this.player.queuedPath && !this._pendingEncounter) {
                const resumed = this.player.resumeQueuedPath();
                if (resumed) {
                    const dest = this.player.travelDestination;
                    const remaining = this.player.path.length - this.player.pathIndex;
                    this.ui.showNotification('Resuming Travel',
                        `Continuing journey${dest ? ` to (${dest.q}, ${dest.r})` : ''} — ~${remaining} tiles remaining`, 'info');
                }
            }

            // The day's visibility pass re-fogs the map; standing cheats put it back
            if (this._cheats) this.ui.applyCheats(true);

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
                this.ui.showNotification('Faith Income', `+${Math.floor(playerResults.faithIncome)} gold from followers`, 'success');
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
                // House Prestige for fulfilling a contract (not for a rout).
                if (typeof House !== 'undefined' && c.success !== false) {
                    House.recordPlayerDeed(this.player, this.world, 'contract', { reason: `contract: ${c.contract.name}` });
                }
                const kind = c.success === false ? 'error' : (c.casualties > 0 ? 'default' : 'success');
                const title = c.outcome === 'defeat' ? 'Contract Failed' : c.outcome === 'abandoned' ? 'Contract Abandoned' : 'Contract Complete';
                this.ui.showNotification(`${c.contract.icon || '⚔️'} ${title}`, c.message || `${c.contract.name} finished. +${c.payment} gold`, kind);
            } else if (playerResults.contractUpdate && playerResults.contractUpdate.event) {
                const ev = playerResults.contractUpdate.event;
                this.ui.showNotification(ev.type === 'loot' ? '💰 Plunder' : ev.type === 'ambush' ? '⚔️ Ambush!' : '🏃 Desertion', ev.text, ev.type === 'loot' ? 'success' : 'warning');
            }

            // Faith spread
            if (playerResults.followersGained > 0) {
                this.ui.showNotification('Faith Spreads', `+${playerResults.followersGained} followers`, 'info');
            }

            // Religious building yields
            const ry = playerResults.religiousYields;
            if (ry && (ry.gold || ry.renown || ry.researchDays)) {
                const parts = [];
                if (ry.gold) parts.push(`+${Math.floor(ry.gold)} pilgrim gold`);
                if (ry.renown) parts.push(`+${ry.renown} renown`);
                if (ry.researchDays) parts.push(`oracles advance research by ${ry.researchDays} day${ry.researchDays > 1 ? 's' : ''}`);
                this.ui.showNotification('Sacred Buildings', parts.join(', '), 'info');
            }

            // Blessings expired
            const blessingNames = {
                prosperity: 'Your Blessing of Prosperity has faded.',
                protection: 'Divine Protection no longer shields you.',
                honed_arms: "Your army's honed edges have dulled.",
                temple_blessing: "The priest's blessing for the road has worn off.",
                harvest: 'The Bountiful Harvest has run its course.',
                sanctuary: 'Your Holy Sanctuary is no longer consecrated ground.',
            };
            for (const blessing of (playerResults.blessingsExpired || [])) {
                this.ui.showNotification('Blessing Faded', blessingNames[blessing] || `${blessing} blessing has expired`, 'default');
            }
            for (const kingdomName of (playerResults.tradeAgreementsExpired || [])) {
                this.ui.showNotification('Trade Agreement Ended', `Your trade agreement with ${kingdomName} has expired.`, 'default');
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
                } else if (playerResults.craftingUpdate.waitingForRoom) {
                    this.ui.showNotification('🔧 Parts Ready', `Your ${playerResults.craftingUpdate.quantity}x parts are finished but waiting at the workshop. ${playerResults.craftingUpdate.message}`, 'warning');
                } else if (playerResults.craftingUpdate.remaining) {
                    if (playerResults.craftingUpdate.remaining <= 1) {
                        this.ui.showNotification('Crafting', `Parts almost ready! 1 day remaining`, 'info');
                    }
                }
            }

            // Galleys serving with the liege's fleet
            const fs = playerResults.fleetService;
            if (fs) {
                if (fs.victories) this.ui.showNotification('⚓ Victory at Sea', `Your liege's fleet won ${fs.victories} sea battle${fs.victories === 1 ? '' : 's'} with your galleys in the line. Your merit grows.`, 'success');
                if (fs.defeats) this.ui.showNotification('⚓ Defeat at Sea', `Your liege's fleet was beaten at sea${fs.wounded ? `; ${fs.wounded} of your galleys limp home damaged` : ''}.`, 'warning');
                if (fs.ended) this.ui.showNotification('⛵ Fleet Service Ends', fs.ended, 'info');
            }

            // Winter trap lines raided or lapsed (player/seasonalWork.js)
            for (const n of (playerResults.trapLines || [])) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

            // Spring planting contracts come due at the harvest
            for (const pc of (playerResults.plantingContracts || [])) {
                if (pc.lost) {
                    this.ui.showNotification('🌾 Contract Void', `${pc.settlementName} is gone — no harvest share from your planting contract.`, 'warning');
                } else {
                    const how = pc.factor > 1.05 ? ' A bountiful crop!' : pc.factor < 0.95 ? ' A poor crop cut your share.' : '';
                    this.ui.showNotification('🌾 Harvest Share', `${pc.settlementName} pays ${pc.paid} gold for the fields you sowed in spring.${how}`, 'success');
                }
            }

            // Your liege won a war you fought in
            // A commission in a realm's army (player/generalship.js)
            for (const n of ((playerResults.generalship && playerResults.generalship.notices) || [])) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            // The household guard a realm keeps for you (player/realmEscort.js)
            for (const n of ((playerResults.realmEscort && playerResults.realmEscort.notices) || [])) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            for (const sp of (playerResults.warSpoils || [])) {
                this.ui.showNotification('🎖️ Spoils of War', `Your liege has humbled ${sp.enemy}. For your service: ${sp.gold} gold and ${sp.renown} renown.`, 'success');
            }

            // Plague — on the player, their soldiers, and their colonies
            const td = playerResults.techDaily;
            if (td && td.plague && td.plague.healthLost > 0) {
                const resist = td.plague.resistance > 0 ? ` Your medicine spared you ${Math.round(td.plague.resistance * 100)}% of it.` : '';
                this.ui.showNotification('☠️ Plague', `The sickness here costs you ${td.plague.healthLost} health${td.plague.unitsLost ? ` and ${td.plague.unitsLost} soldier(s)` : ''}.${resist}`, 'warning');
            }
            if (td && td.colonyPlague) {
                for (const hit of td.colonyPlague) {
                    if (hit.lost > 0 || hit.loyaltyLost > 0) {
                        this.ui.showNotification('☠️ Plague in ' + hit.name, `${hit.lost} settlers died and loyalty fell by ${hit.loyaltyLost}.`, 'warning');
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
            // Saga beasts on the hunter's list (systems/bountyHunting.js)
            for (const b of (playerResults.bountyTracking && playerResults.bountyTracking.beasts) || []) {
                if (b.outcome === 'slain') {
                    this.ui.showNotification('🎯 Notice Honoured', `You took the notice on ${b.targetName}: +${b.bonus} gold as the hunter's fee.${b.promoted ? ` Promoted to ${b.promoted.title}!` : ''}`, 'success');
                } else {
                    this.ui.showNotification('🎯 Notice Lapsed', `${b.targetName} is beyond reach now; the notice is taken down.`, 'info');
                }
            }
            // Outlaw chiefs on the hunter's list (systems/outlawLairs.js)
            for (const b of (playerResults.bountyTracking && playerResults.bountyTracking.chiefs) || []) {
                if (b.outcome === 'slain') {
                    this.ui.showNotification('🎯 Bounty Paid', `The price on ${b.targetName}'s head is yours: +${b.pay} gold.${b.promoted ? ` Promoted to ${b.promoted.title}!` : ''}`, 'success');
                } else {
                    this.ui.showNotification('🎯 Notice Lapsed', `${b.targetName} is beyond your reach now; the notice is taken down.`, 'info');
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
                    // Allies' fortune and enemies' misfortune can reach the player
                    const effect = WorldEvents.applyPlayerEffects(event, this.player, this.world);
                    this.ui.showNotification('World Event', effect ? `${event.text} ${effect}` : event.text, effect ? 'success' : 'info');
                }
            }

            // Check for completed quests
            const completedQuests = Quests.updateProgress(this.player, this.world);
            for (const quest of completedQuests) {
                const sold = quest.overflowSold ? ` (no room in your packs — sold for ${quest.overflowSold.gold}g)` : '';
                this.ui.showNotification('Quest Complete!', `${quest.title} — Rewards: ${Quests.describeRewards(quest.rewards)}${sold}`, 'success');
                // House Prestige for finishing a quest.
                if (typeof House !== 'undefined') {
                    House.recordPlayerDeed(this.player, this.world, 'quest', { reason: `quest: ${quest.title}` });
                }
            }
            // Tasks: a thing found, a task failed (systems/quests.js)
            for (const n of Quests.takeNotices(this.player)) this.ui.showNotification(n.title, n.text, n.type);

            // Earned traits: habits fade, tax policy reads as greed or goodwill,
            // the dynasty echo fades (gain/loss notices are shown by updateStats)
            Traits.processDay(this.player, this.world);

            // The underworld: heat cools, hot goods cool, rackets and the Guildmaster's cut pay weekly
            {
                const uw = Underworld.processDay(this.player, this.world);
                for (const text of uw.notices) this.ui.showNotification('🗝️ Underworld', text, 'info');
            }

            // First Steps — the guided first month: steps the day completed (a night at an inn, the day itself) (systems/firstSteps.js)
            for (const n of FirstSteps.processDay(this.world, this.player).notices) this.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);

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
            if (playerResults.religiousYields && playerResults.religiousYields.gold > 0) {
                dayFinance.income.faith = (dayFinance.income.faith || 0) + playerResults.religiousYields.gold;
            }

            // Caravan profits
            let caravanProfit = 0;
            for (const c of playerResults.caravansCompleted) {
                if (c.eventType) continue;
                caravanProfit += c.finalProfit || 0;
            }
            if (caravanProfit > 0) dayFinance.income.caravans = caravanProfit;

            // (contract fees and plunder are in the ledger: MercContracts records them)

            // Tax income
            if (taxCollected > 0) dayFinance.income.taxes = taxCollected;

            // Expense sources
            if (playerResults.upkeepCost > 0) dayFinance.expenses.armyUpkeep = playerResults.upkeepCost;
            if (holdingsDay.upkeep > 0) dayFinance.expenses.holdings = holdingsDay.upkeep;
            if (playerResults.mercenaryWages > 0) dayFinance.expenses.mercenaryWages = playerResults.mercenaryWages;
            // (loan payments are in the ledger as interest and principal: Finance records them)
            if (princeDay.income > 0) dayFinance.income.industry = princeDay.income;
            if (princeDay.rent > 0) dayFinance.expenses.warehouseRent = princeDay.rent;
            if (princeDay.wages > 0) dayFinance.expenses.worksWages = princeDay.wages;
            if (guildDay.income > 0) dayFinance.income.guilds = guildDay.income;
            if (guildDay.expenses > 0) dayFinance.expenses.guildDues = guildDay.expenses;
            if (typeof Tavern !== 'undefined' && intelResult && intelResult.cost > 0) dayFinance.expenses.informants = intelResult.cost;

            // Property upkeep (calculated from properties)
            let propertyUpkeep = 0;
            if (this.player.properties) {
                for (const prop of this.player.properties) {
                    const owned = PlayerEconomy.findPropertyAt(this.world.getTile(prop.q, prop.r), prop.type);
                    if (owned) {
                        // (wages at the local rate — world/townLabour.js — and the admin overhead)
                        propertyUpkeep += PlayerEconomy.getPropertyUpkeep(this.player, owned);
                    }
                }
            }
            if (propertyUpkeep > 0) dayFinance.expenses.propertyUpkeep = propertyUpkeep;

            // Close the day's books: every flow the systems recorded today joins the
            // row, the totals are set and the last 120 days kept (systems/ledger.js)
            Ledger.closeDay(this.player, this.world, dayFinance);
            // The Season's Reckoning: at a season's turn, what the player's doings changed
            // (systems/reckoning.js; shown unless switched off in Settings — always in the Journal)
            const reckoning = Reckoning.processDay(this.world, this.player);
            if (reckoning.report && this.ui._seasonReckoning !== false) {
                if (this._voyageDay) this.ui.showNotification('⏳ The Season’s Reckoning',`${reckoning.report.headline}. Read it in Journal → Season's Reckoning.`, 'info');
                else setTimeout(() => ActionMenu.showReckoning(this, 'last'), 0);
            }

            // The day's clock for the new day (one clock, on the map or off it: ui/game/dayClock.js):
            // the day ended at midnight runs straight on (12:01 AM); a day ended by going to bed
            // (End Turn) wakes at 8
            if (typeof InnerMap !== 'undefined') {
                if (this._midnightRollover) {
                    InnerMap.timeOfDay = 0;
                    InnerMap._timeAccumulator = InnerMap.TIME_SCALE / 60; // one minute past
                    InnerMap._midnightDay = this.world.day;
                } else {
                    DayClock.wake();
                }
                InnerMap.dayEnded = false;
                this._innerMapDayEndShown = false;
                // The town's fields grow on to the new day (world/townProps.js)
                if (InnerMap.tiles && InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement) {
                    InnerMap.worldDay = this.world.day;
                    TownProps.growFields(InnerMap.tiles, this.world.day);
                }
            }
            this._midnightRollover = false;

            // The new day is announced across the map (ui/dayBanner.js); a new season or year gets the larger card
            const prevSeason = this._bannerSeason, prevYear = this._bannerYear;
            this._bannerSeason = this.world.season;
            this._bannerYear = this.world.year;
            showDayBanner({
                dayOfSeason: ((this.world.day - 1) % 30) + 1,
                season: this.world.season,
                year: this.world.year,
                kind: prevYear != null && prevYear !== this.world.year ? 'year'
                    : prevSeason != null && prevSeason !== this.world.season ? 'season' : 'day',
            });
            // The Steward's morning brief: the top three matters (setting: morningBrief)
            showMorningBrief(this);
            updateCounselBadge(this);
            // Waking in the town of a map-owner you robbed: he finds you at breakfast, not only on arrival (systems/mapTheft.js)
            if (!this._voyageDay) checkMapAccusation(this);

            // At sea: show the voyage log, then sail on or wait for orders (ui/actionMenu/voyage.js)
            if (this._voyageDay) {
                const voyageDay = this._voyageDay;
                this._voyageDay = null;
                setTimeout(() => onVoyageDay(this, voyageDay), 0);
            }
        } catch (e) {
            console.error("Error ending day:", e);
            this.ui.showNotification('Error', 'Failed to end day. Check console.', 'error');
        } finally {
            if (heldScan) this.world.releaseSettlementScan();
            this.isProcessingTurn = false;
            document.body.style.cursor = 'default';
            PanelRefresh.refreshAfterDay(this.ui, panelBefore);
            // A standing order to chart the area goes on in the morning (ui/game/autoChart.js)
            if (this.player && this.player.autoChart && !this.player.isMoving) setTimeout(() => this._autoChartStep(), 0);
        }
    }, 50);
}

/**
 * Player prays (gain karma)
 */


/**
 * Tell the player when the weather turns where they are, and what it costs.
 * Quiet on fair days and while the weather holds.
 */
export function _reportWeather(fx) {
    if (!fx || !fx.weather || !this.world.weather) return;
    const prev = this._lastReportedWeather;
    this._lastReportedWeather = fx.weather;
    const info = WEATHER_TYPES[fx.weather];
    if (!info) return;
    if (fx.weather !== prev && !['clear', 'cloudy'].includes(fx.weather)) {
        const effects = this.world.weather.describeEffects(fx.weather);
        this.ui.showNotification(`${info.icon} ${info.name}`, effects || 'The weather has turned.', 'info');
    }
    if (fx.weatherHealthLost > 0) {
        this.ui.showNotification(`${info.icon} Exposure`,
            `A night in the open in the ${info.name.toLowerCase()} cost you ${fx.weatherHealthLost} health. Shelter in a settlement, an inn or your own house.`, 'warning');
    }
}

/** Notices for the day's wounds and sickness (systems/ailments.js). */
export function _reportAilments(out) {
    if (!out) return;
    const n = (title, text, type) => this.ui.showNotification(title, text, type);
    const SOURCE = {
        exposure: 'A night in the open has made you ill',
        food: 'Something you ate has turned your stomach',
        swamp: 'The fen air has given you a fever',
        plague: 'You have caught the plague',
        lean: 'The fevers of the lean months have reached you',
        sea: 'Weeks at sea without fresh food are telling on you',
        companion: 'You have caught it from a companion',
    };
    for (const c of out.caught || []) {
        const from = c.from ? ` (from ${c.from})` : '';
        n(`${c.icon} ${c.name}`, `${SOURCE[c.source] || 'You have fallen ill'}${from}: ${c.text}. Rest indoors and see a physician.`, 'warning');
    }
    for (const c of out.crises || []) n('💀 A Bad Crisis', `Your ${c.name.toLowerCase()} nearly took you in the night (−${c.blow} health). Once you are weakened, the next crisis may kill. See a physician.`, 'error');
    for (const w of out.worsened || []) n(`${w.icon} ${w.stage}`, `Your ${w.name.toLowerCase()} has worsened. Rest at an inn or at home, and get it treated.`, 'error');
    for (const name of out.healed || []) n('🤕 Recovered', `Your ${name.toLowerCase()} has passed.`, 'success');
    for (const name of out.infected || []) n('🧫 Infection', `Your ${name.toLowerCase()} has turned infected and stopped mending. A physician or a healing salve can save it.`, 'error');
    for (const f of out.festered || []) n(`${f.icon} ${f.name}`, `Your infected ${f.wound.toLowerCase()} has poisoned your blood.`, 'error');
    for (const s of out.scarred || []) {
        const t = (s.traits || []).length ? ' You are now ' + s.traits.map(id => (Traits.TRAITS[id] || {}).name || id).join(', ') + '.' : '';
        n('💊 A Lasting Mark', `Your ${s.wound.toLowerCase()} has healed, but it left its mark.${t}`, 'warning');
    }
    for (const c of out.companions || []) {
        if (c.event === 'caught') n('🤒 Companion Ill', `${c.name} has caught your ${c.disease.toLowerCase()}.`, 'warning');
        else if (c.event === 'recovered') n('🤕 Companion Recovered', `${c.name} is over the ${c.disease.toLowerCase()}.`, 'success');
    }
    for (const c of out.crews || []) {
        if (c.event === 'outbreak') n('🤒 Sickness Aboard', `${c.disease} has broken out among the crew of the ${c.name}. Put into port to let it pass.`, 'warning');
        else if (c.event === 'sailorDied') n('⚓ Burial at Sea', `A sailor of the ${c.name} has died of ${c.disease.toLowerCase()}.`, 'warning');
        else if (c.event === 'over') n('⚓ Crew Recovered', `The sickness aboard the ${c.name} has run its course.`, 'info');
    }
}

/** Notices for the heirs' upbringing (systems/upbringing.js). */
export function _reportUpbringing(out) {
    if (!out) return;
    const n = (title, text, type) => this.ui.showNotification(title, text, type);
    for (const e of out.events || []) {
        if (e.event) n(`${e.event.icon} ${e.child.firstName}: ${e.event.title}`, `${e.event.text} Decide from Dynasty → ${e.child.firstName} within ${Math.max(0, e.event.expires - this.world.day)} days.`, 'info');
    }
    for (const r of out.resolved || []) n(`${r.event.icon || '📜'} ${r.child.firstName}`, `Left to the household: ${r.text}`, r.died ? 'error' : 'info');
    for (const t of out.tutorsLeft || []) n('👨‍🏫 Tutor Gone', t.text, 'warning');
    for (const c of out.comeOfAge || []) n('🎓 Coming of Age', `${c.text} Give them an office, a match or a wardship from the Dynasty menu.`, 'success');
    for (const w of out.wardsReturned || []) n('🏰 A Ward Returns', w.text, 'success');
    // Your example rubbing off on a child (Upbringing._growthTick)
    const byChild = new Map();
    for (const r of out.rubOff || []) {
        if (!r || !r.child) continue;
        if (!byChild.has(r.child)) byChild.set(r.child, []);
        byChild.get(r.child).push((Traits.TRAITS[r.traitId] || {}).name || r.traitId);
    }
    for (const [child, names] of byChild) {
        n(`👪 ${child.firstName} Watches You`, `${child.firstName} is picking up your ways: ${names.join(', ').toLowerCase()}.`, 'info');
    }
}

/** Tell the player when what they see contradicts a doctored map they trusted. */
export function _reportExposedDeceptions() {
    const exposed = Cartography.exposeDeceptions(this.player, this.world);
    if (exposed.length === 0) return;
    const first = exposed[0];
    const what = Cartography.describeDeception(first, this.world);
    const more = exposed.length > 1 ? ` (and ${exposed.length - 1} other falsehood${exposed.length > 2 ? 's' : ''})` : '';
    this.ui.showNotification('🗺️ The Map Lied',
        `Your "${first.mapName}" showed ${what} at (${first.q}, ${first.r}) — there is no such thing${more}.`, 'warning');
}
