// ============================================
// PLAYER ACTIONS — Contextual actions index
// Orchestrates action building and exports PlayerActions.
// Settlement actions → settlementActions.js
// Wilderness/anywhere actions → wildernessActions.js
// ============================================

import { BountyHunting } from '../../systems/bountyHunting.js';
import { Hex } from '../../core/hex.js';
import { Colonization } from '../../world/colonization.js';
import { LegendaryArtifacts } from '../../systems/legendaryArtifacts.js';
import { Espionage } from '../../systems/espionage.js';
import { Ships } from '../../systems/ships.js';
import { Housing } from '../../systems/housing.js';
import { Cartography } from '../../systems/cartography.js';
import { Religion } from '../../systems/religion.js';
import { Titles } from '../../systems/titles.js';
import { Festivals } from '../../systems/festivals.js';
import { Infrastructure } from '../../systems/infrastructure.js';
import { Technology } from '../../systems/technology.js';
import { PlayerEffects } from '../playerEffects.js';
import { Culture } from '../../systems/culture.js';
import { PlayerEconomy } from '../playerEconomy.js';
import { PlayerMilitary } from '../playerMilitary.js';
import { PlayerReligion } from '../playerReligion.js';
import { Quests } from '../../systems/quests.js';
import { Achievements } from '../../systems/achievements.js';
import { Petitions } from '../../systems/petitions.js';

import { RealmPolitics } from '../realmPolitics.js';
import { addSettlementActions } from './settlementActions.js';
import { addWildernessActions } from './wildernessActions.js';

export const PlayerActions = {
    /**
     * Get available actions for a specific tile.
     * Jail/servitude states short-circuit the full list.
     * Settlement block is delegated to addSettlementActions.
     * Wilderness/anywhere block is delegated to addWildernessActions.
     */
    getAvailableActions(player, tile, world) {
        const actions = [];

        // ── Jail: only jail actions ──
        if (player.jailState) {
            const jail = player.jailState;
            actions.push({
                type: 'jail_wait',
                label: 'Serve Time',
                icon: '🔒',
                description: `${jail.daysRemaining} day(s) remain in jail. Offense #${jail.offenseNumber}.`
            });
            if (jail.bailCost && player.gold >= jail.bailCost) {
                actions.push({
                    type: 'jail_bail',
                    label: 'Post Bail',
                    icon: '💰',
                    description: `Pay ${jail.bailCost} gold to get out of jail immediately.`
                });
            }
            actions.push({
                type: 'jail_escape',
                label: 'Attempt Jailbreak',
                icon: '🏃',
                description: `Try to escape (${Math.floor((jail.escapeChance || 0.1) * 100)}% chance). Failure adds more time.`
            });
            return actions;
        }

        // ── Indentured Servitude: only servitude actions ──
        if (player.indenturedServitude) {
            const servitude = player.indenturedServitude;
            actions.push({
                type: 'servitude_wait',
                label: 'Endure Servitude',
                icon: '⛓️',
                description: `${servitude.daysRemaining} days remain under ${servitude.captor}. Work and wait for freedom.`
            });
            actions.push({
                type: 'servitude_escape',
                label: 'Attempt Escape',
                icon: '🏃',
                description: `Try to slip away (${Math.floor(servitude.escapeChance * 100)}% chance). Failure means punishment and extra days.`
            });
            if (servitude.canBuyFreedom && player.gold >= servitude.freedomCost) {
                actions.push({
                    type: 'servitude_buy_freedom',
                    label: 'Buy Your Freedom',
                    icon: '💰',
                    description: `Pay ${servitude.freedomCost} gold to end your servitude immediately.`
                });
            }
            return actions;
        }

        // ── Base actions (always available) ──
        actions.push({
            type: 'rest',
            label: 'Rest / Camp',
            icon: '⛺',
            description: 'Recover stamina and wait for the next day'
        });

        // Eat from the pack when hungry (the daily ration alone won't keep up
        // with a hungry day on the road)
        if (player.needsEnabled && player.needs && player.needs.hunger < 85
            && player.getFoodCount && player.getFoodCount() > 0) {
            actions.push({
                type: 'eat_meal',
                label: 'Eat a Meal',
                icon: '🍖',
                description: `Eat from your pack (hunger ${Math.round(player.needs.hunger)}%)`
            });
        }

        // Disembark from ship
        if (player.boardedShip && tile.terrain.passable) {
            actions.push({
                type: 'disembark',
                label: 'Disembark',
                icon: '🚶',
                description: 'Leave your ship and return to land'
            });
        }

        // Row ashore from the ship onto undeveloped coast (no port needed)
        if (player.boardedShip && !tile.terrain.passable && Ships.getRowAshoreTargets(world, player.q, player.r).length > 0) {
            actions.push({
                type: 'row_ashore',
                label: 'Row Ashore',
                icon: '🚣',
                description: `Anchor here and row to shore — without a port or jetty only ${Ships.LANDING_BOAT_CAPACITY} cargo comes ashore`
            });
        }

        // Move goods between your pack and a ship's hold (docked here or anchored offshore)
        if (Ships.getShipsWithHoldAccess(player).length > 0) {
            actions.push({
                type: 'ship_hold',
                label: "Ship's Hold",
                icon: '📦',
                description: 'Load goods into your ship or unload them — unlimited at a port or jetty, a boat-load a day elsewhere'
            });
        }

        // Port market: trade goods by the shipload with a ship docked here
        if (!player.boardedShip && Ships.isPortTile(world, player.q, player.r)
            && Ships.getShipsWithHoldAccess(player).some(s => s.status === 'docked')) {
            actions.push({
                type: 'port_market',
                label: 'Port Market',
                icon: '⚓',
                description: 'Buy goods into your hold here, sell them where they fetch more'
            });
        }

        // Activities on the open sea
        if (player.boardedShip && Ships.isWaterTile(tile)) {
            actions.push(
                { type: 'explore_ocean', label: 'Explore the Waters', icon: '🧭', description: 'Search for wrecks, islands and trouble' },
                { type: 'hunt_pirates', label: 'Hunt Pirates', icon: '⚔️', description: 'Patrol for pirates — bounty, renown and karma if you win' },
                { type: 'commit_piracy', label: 'Turn Pirate', icon: '🏴‍☠️', description: 'Raid a merchant ship — gold, but karma and reputation suffer' }
            );
        }

        // Row back out to a ship anchored offshore
        if (!player.boardedShip && Ships.getAnchoredShipsNear(player, player.q, player.r).length > 0) {
            actions.push({
                type: 'row_to_ship',
                label: 'Row Out to Ship',
                icon: '🚣',
                description: 'Row back out to your anchored ship and go aboard'
            });
        }

        // Bounty hunting
        const pendingCapturedBounty = (player.activeBounties || []).find(b =>
            b.type === 'criminal_hunt' && b.status === 'captured_pending_decision'
        );
        if (pendingCapturedBounty) {
            actions.push({
                type: 'capture_criminal',
                label: 'Judge Captured Criminal',
                icon: '⛓️',
                description: `${pendingCapturedBounty.targetName} awaits your decision: turn in or recruit.`
            });
        } else if (typeof BountyHunting !== 'undefined') {
            const criminalTarget = BountyHunting.getBountyTargetAtPlayer(player);
            if (criminalTarget) {
                actions.push({
                    type: 'capture_criminal',
                    label: 'Capture Wanted Criminal',
                    icon: '🎯',
                    description: `Attempt to capture ${criminalTarget.targetName} (${criminalTarget.notoriety || 'wanted'}, difficulty ${criminalTarget.difficulty}).`
                });
            }
        }

        // Court — hear the petitions brought to your holdings
        if (Petitions.canHoldCourtAt(player, world, tile)) {
            const waiting = Petitions.pending(player).length;
            actions.push({
                type: 'hold_court',
                label: waiting ? `Hold Court (${waiting} waiting)` : 'Hold Court',
                icon: '⚖️',
                description: waiting
                    ? `${waiting} petition(s) await your ruling — each choice has a price, and ignoring them does too`
                    : 'Review your court: past rulings and the reputation they earned you'
            });
        }

        // ── Shared tile context ──
        const isSettlement = !!tile.settlement;
        const isCity = isSettlement && (tile.settlement.type === 'town' || tile.settlement.type === 'capital');
        const isVillage = isSettlement && tile.settlement.type === 'village';
        const isEmptyColony = isSettlement && tile.settlement.colony && tile.settlement.colony.isPlayerColony && tile.settlement.population < 10;
        const isPlayerSettlement = isSettlement && (
            (tile.settlement.colony && tile.settlement.colony.isPlayerColony) ||
            ((player.colonies || []).some(c => c.q === tile.q && c.r === tile.r))
        );
        const playerSettlementCount = (player.colonies || []).reduce((count, c) => {
            const colonyTile = world.getTile(c.q, c.r);
            if (!colonyTile || !colonyTile.settlement) return count;
            return count + 1;
        }, 0);
        const playerKingdom = player.allegiance ? world.getKingdom(player.allegiance) : null;
        const hasPlayerFoundedKingdom = !!(playerKingdom && playerKingdom.createdByPlayer);

        // ── Settlement branch ──
        if (isSettlement) {
            // Empty player colony: restricted menu, skip wilderness actions
            if (isEmptyColony) {
                actions.push({
                    type: 'manage_colony',
                    label: 'Manage Colony',
                    icon: '📋',
                    description: `Manage ${tile.settlement.name} — recruit settlers, set incentives`
                });
                if (!tile.settlement.colony.recruitment?.signboard) {
                    actions.push({
                        type: 'post_signboard',
                        label: 'Post Signboard',
                        icon: '📋',
                        description: 'Erect a signboard to attract passing travelers (20g)'
                    });
                }
                if (!tile.structure && !tile.improvement && tile.terrain.passable) {
                    actions.push({
                        type: 'build_property',
                        label: 'Build Property',
                        icon: '🏗️',
                        description: 'Construct a resource gathering building'
                    });
                }
                const emptyPopInfo = tile.settlement.population === 0 ? ' (uninhabited)' : ` (${tile.settlement.population} settlers)`;
                actions.push({
                    type: 'wait_here',
                    label: `Survey Settlement${emptyPopInfo}`,
                    icon: '👁️',
                    description: 'Your settlement needs people. Visit other towns to recruit settlers or set incentives at the colony panel.'
                });
                return actions;
            }

            // Normal settlement actions
            addSettlementActions(actions, player, tile, world, {
                isCity,
                isVillage,
                isPlayerSettlement,
                playerSettlementCount,
                playerKingdom,
                hasPlayerFoundedKingdom
            });
        }

        // ── Wilderness & Anywhere Actions ──
        addWildernessActions(actions, player, tile, world);

        return actions;
    },

    /**
     * Process end of day for player — jail, servitude, production, upkeep, research, culture, bounties.
     * Called by game.js during the daily turn cycle.
     */
    endDay(player, world) {
        const results = {
            production: {},
            faithIncome: 0,
            upkeepCost: 0,
            mercenaryWages: 0,
            mercenaryEvents: [],
            unitsLost: 0,
            caravansCompleted: [],
            contractUpdate: null,
            followersGained: 0,
            blessingsExpired: [],
            researchUpdate: null,
            craftingUpdate: null,
            cultureIncome: 0,
            cultureRenown: 0,
            servitudeUpdate: null,
            jailUpdate: null,
            bountyTracking: null,
            festivalUpdate: null,
        };

        // Process jail sentence if active
        if (player.jailState) {
            player.jailState.daysRemaining--;
            player.stamina = 0;
            player.movementRemaining = 0;
            if (player.jailState.daysRemaining <= 0) {
                const settlement = player.jailState.settlement;
                player.jailState = null;
                player.stamina = player.maxStamina;
                player.movementRemaining = player.maxStamina;
                results.jailUpdate = { freed: true, message: `You have served your sentence and are released from jail in ${settlement}.` };
            } else {
                results.jailUpdate = { freed: false, daysRemaining: player.jailState.daysRemaining, message: `${player.jailState.daysRemaining} day(s) of jail time remain.` };
            }
        }

        // Process indentured servitude if active
        if (player.indenturedServitude) {
            results.servitudeUpdate = PlayerMilitary.processServitude(player, world);
        }

        // Produce goods from properties
        results.production = PlayerEconomy.produceGoods(player, world);

        // Collect faith income
        results.faithIncome = PlayerReligion.collectFaithIncome(player);

        // Pay army upkeep
        const upkeep = PlayerMilitary.payUpkeep(player, world);
        results.upkeepCost = upkeep.cost || 0;
        results.mercenaryWages = upkeep.mercenaryWages || 0;
        results.mercenaryEvents = upkeep.mercenaryEvents || [];
        results.unitsLost = upkeep.unitsLost || 0;

        // Update caravans
        results.caravansCompleted = PlayerEconomy.updateCaravans(player, world);

        // Update contract
        results.contractUpdate = PlayerMilitary.updateContract(player);

        // Spread faith
        results.followersGained = PlayerReligion.spreadFaith(player, world);

        // Tenet karma, influence, faith spreading town to town, realms' regard
        results.faithDaily = PlayerReligion.processDaily(player, world);

        // Religious building yields (pilgrim gold, relic renown, oracle scholarship)
        results.religiousYields = PlayerReligion.applyBuildingYields(player, world);

        // Update blessings
        results.blessingsExpired = PlayerReligion.updateBlessings(player);

        // Travel companions heal the player and grow closer
        results.companions = PlayerEffects.processCompanions(player, world);

        // Galleys lent to the liege's fleet: wages, merit, wounds
        results.fleetService = RealmPolitics.processFleetService(player, world);

        // A share of the tribute when a liege you fought for wins its war
        results.warSpoils = RealmPolitics.processDaily(player, world);

        // Lord trade agreements run for a fixed term
        results.tradeAgreementsExpired = PlayerEffects.expireTradeAgreements(player, world.day || 0);

        // Process technology research
        if (typeof Technology !== 'undefined') {
            results.researchUpdate = Technology.processResearch(player);
        results.techDaily = Technology.applyDailyEffects(player, world);
            results.craftingUpdate = Technology.processCrafting(player);
        }

        // Process cultural buildings income & renown
        if (typeof Culture !== 'undefined') {
            const cultureResult = Culture.processPlayerCulture(player, world);
            results.cultureIncome = cultureResult.income;
            results.cultureRenown = cultureResult.renown;
            // Already applied to research time via Technology.getResearchBonus
            results.cultureResearchBonus = cultureResult.researchBonus;
        }

        if (typeof Festivals !== 'undefined') {
            results.festivalUpdate = Festivals.processDaily(player, world);
        }

        // Process active bounties — tick down timers and expire old ones
        if (player.activeBounties && player.activeBounties.length > 0) {
            if (typeof BountyHunting !== 'undefined') {
                results.bountyTracking = BountyHunting.processDaily(player, world);
            }

            const expired = [];
            for (let i = player.activeBounties.length - 1; i >= 0; i--) {
                const bounty = player.activeBounties[i];
                if (bounty.status !== 'active') continue;
                bounty.daysElapsed = (bounty.daysElapsed || 0) + 1;
                if (bounty.daysElapsed >= bounty.daysLimit) {
                    expired.push(bounty);
                    player.activeBounties.splice(i, 1);
                }
            }
            results.bountiesExpired = expired;
        }

        // Process title duties daily
        if (typeof Titles !== 'undefined' && player.currentTitle) {
            Titles.initialize(player);
            results.titleUpdate = Titles.processDaily(player, world);
        }

        return results;
    }
};
