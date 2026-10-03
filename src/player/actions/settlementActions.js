// ============================================
// SETTLEMENT ACTIONS — Actions available inside settlements
// Called by PlayerActions.getAvailableActions in index.js.
// ctx = { isCity, isVillage, isEmptyColony, isPlayerSettlement, playerSettlementCount, playerKingdom, hasPlayerFoundedKingdom }
// ============================================

import { Hex } from '../../core/hex.js';
import { Colonization } from '../../world/colonization.js';
import { LegendaryArtifacts } from '../../systems/legendaryArtifacts.js';
import { Espionage } from '../../systems/espionage.js';
import { Ships } from '../../systems/ships.js';
import { Housing } from '../../systems/housing.js';
import { Titles } from '../../systems/titles.js';
import { Festivals } from '../../systems/festivals.js';

export function addSettlementActions(actions, player, tile, world, ctx) {
    const { isCity, isVillage, isPlayerSettlement, playerSettlementCount, playerKingdom, hasPlayerFoundedKingdom } = ctx;
    // Note: empty colony case is handled in index.js before this function is called.

    // ── Recruit for your colony (at OTHER settlements) ──
    if (typeof Colonization !== 'undefined' && player.colonies && player.colonies.length > 0) {
        const hasEmptyColony = player.colonies.some(c => {
            const ct = world.getTile(c.q, c.r);
            return ct && ct.settlement && ct.settlement.colony && ct.settlement.population < 50;
        });
        // Only show if not standing in own colony
        const isOwnColony = tile.settlement.colony && tile.settlement.colony.isPlayerColony;
        if (hasEmptyColony && !isOwnColony) {
            actions.push({
                type: 'recruit_settlers',
                label: 'Recruit Settlers',
                icon: '📢',
                description: 'Spread word of your settlement and convince people to move there'
            });
        }
    }

    // Trade
    actions.push({
        type: 'trade',
        label: 'Trade Goods',
        icon: '⚖️',
        description: 'Buy and sell resources'
    });

    // Recruit
    if (isCity || isVillage) {
        actions.push({
            type: 'recruit',
            label: 'Recruit Units',
            icon: '⚔️',
            description: isVillage ? 'Recruit local militia' : 'Hire soldiers for your army'
        });
    }

    // Contracts (Mercenaries)
    if (isCity || (isVillage && tile.settlement.population > 200)) {
        actions.push({
            type: 'contract',
            label: 'Mercenary Contracts',
            icon: '📜',
            description: 'Take on military work'
        });

        if (typeof LegendaryArtifacts !== 'undefined' && LegendaryArtifacts.hasForgeableArtifacts(player)) {
            actions.push({
                type: 'reforge_artifact',
                label: 'Reforge Artifacts',
                icon: '🛠️',
                description: 'Reforge legendary relics from recovered fragments'
            });
        }
    }

    // Preach
    actions.push({
        type: 'preach',
        label: 'Preach',
        icon: '🙏',
        description: 'Spread your faith and gain followers'
    });

    // Tavern / Talk to Locals
    if (isCity) {
        actions.push({
            type: 'tavern',
            label: 'Visit the Tavern',
            icon: '🍺',
            description: 'Buy drinks and gather rumors and intelligence'
        });
    } else {
        actions.push({
            type: 'talk_locals',
            label: 'Talk to Locals',
            icon: '🗣️',
            description: 'Chat with villagers to learn news'
        });
    }

    // Espionage — requires espionage tech, available at cities
    if (isCity && typeof Espionage !== 'undefined' && Espionage.hasEspionageTech(player)) {
        actions.push({
            type: 'espionage_menu',
            label: 'Espionage Network',
            icon: '🕵️',
            description: 'Recruit spies, assign missions, and manage your shadow network'
        });
    }

    // Manage Spies — available anywhere if player has spies
    if (typeof Espionage !== 'undefined' && Espionage.hasEspionageTech(player)) {
        Espionage.initPlayer(player);
        if (player.espionage.spies.length > 0 || player.espionage.activeMissions.length > 0) {
            actions.push({
                type: 'manage_spies',
                label: 'Manage Spies',
                icon: '👁️',
                description: `View spy roster and active missions (${player.espionage.spies.length} spies)`
            });
        }
    }

    // Ship Passage (Coastal Settlements)
    const isCoastal = Hex.neighbors(tile.q, tile.r).some(n => {
        const nt = world.getTile(n.q, n.r);
        return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
    });

    if (isCoastal) {
        actions.push({
            type: 'ship_passage',
            label: 'Pay for Passage',
            icon: '⛴️',
            description: 'Hire a ship to travel to another coastal settlement'
        });

        // Shipyard actions at coastal settlements
        if (typeof Ships !== 'undefined') {
            actions.push({
                type: 'visit_shipyard',
                label: 'Visit Shipyard',
                icon: '⚓',
                description: 'Buy, build, or manage ships at the docks'
            });
        }

        // Board own ship if docked here
        const dockedShips = typeof Ships !== 'undefined' ? Ships.getShipsAt(player, tile.q, tile.r) : [];
        if (dockedShips.length > 0) {
            actions.push({
                type: 'board_ship',
                label: 'Board Ship',
                icon: '🚢',
                description: 'Board one of your ships docked here'
            });
        }
    }

    // Housing actions at settlements
    if (typeof Housing !== 'undefined') {
        const ownedHere = Housing.getHouseAt(player, tile.q, tile.r);
        if (!ownedHere) {
            const available = Housing.getAvailableHouses(tile.settlement.type);
            if (available.length > 0) {
                actions.push({
                    type: 'buy_house',
                    label: 'Buy a House',
                    icon: '🏠',
                    description: 'Purchase a home in this settlement'
                });
            }
        } else {
            actions.push({
                type: 'manage_house',
                label: 'Manage House',
                icon: '🏠',
                description: 'Upgrade, repair, or sell your property'
            });
        }
    }

    // --- Early-Game Income: Settlement-based ---

    // Odd Jobs (always available in settlements)
    actions.push({
        type: 'odd_jobs',
        label: 'Look for Work',
        icon: '🔨',
        description: 'Take on a day job for modest pay'
    });

    // Bounty Board (settlements post small tasks)
    actions.push({
        type: 'bounty_board',
        label: 'Notice Board',
        icon: '📋',
        description: 'Check the notice board for paid tasks and bounties'
    });

    // Busking / Street Performance
    actions.push({
        type: 'busking',
        label: 'Street Performance',
        icon: '🎭',
        description: 'Perform in the streets for tips and coin'
    });

    // Gambling (taverns in cities, informal in villages)
    if (isCity) {
        actions.push({
            type: 'gambling',
            label: 'Gambling Den',
            icon: '🎲',
            description: 'Try your luck at games of chance'
        });
    } else if (isVillage) {
        actions.push({
            type: 'gambling',
            label: 'Dice Game',
            icon: '🎲',
            description: 'Join the locals for a friendly wager'
        });
    }

    // --- Social / Political ---

    // Donate / Charity (at settlements)
    if (player.gold >= 10) {
        actions.push({
            type: 'donate',
            label: 'Donate to the Poor',
            icon: '💝',
            description: 'Give gold to the less fortunate for karma and reputation'
        });
    }

    // Pledge Allegiance (at capitals, if unaligned)
    if (tile.settlement.kingdom && !player.allegiance) {
        actions.push({
            type: 'pledge_allegiance',
            label: 'Pledge Allegiance',
            icon: '🏛️',
            description: `Swear fealty to the kingdom of ${tile.settlement.name}`
        });
    }

    // Renounce Allegiance (at any settlement, if aligned)
    if (player.allegiance) {
        actions.push({
            type: 'renounce_allegiance',
            label: 'Renounce Allegiance',
            icon: '🚩',
            description: 'Break your oath and become a free agent'
        });
    }

    if (isPlayerSettlement && playerSettlementCount >= 3 && !hasPlayerFoundedKingdom) {
        const isSecession = !!(player.allegiance && (!playerKingdom || !playerKingdom.createdByPlayer));
        actions.push({
            type: 'form_kingdom',
            label: 'Form Kingdom',
            icon: '👑',
            description: isSecession
                ? `Proclaim independence with your ${playerSettlementCount} settlements and found your own realm`
                : `Unite your ${playerSettlementCount} settlements into a sovereign kingdom`
        });
    }

    // ── Title Duty Actions ──
    if (typeof Titles !== 'undefined' && player.currentTitle) {
        const titleDef = Titles.getActiveTitle(player);
        if (titleDef) {
            // Tax Collector — collect taxes at kingdom settlements
            if (player.currentTitle === 'tax_collector' && tile.settlement.kingdom === player.allegiance) {
                const sKey = `${tile.q},${tile.r}`;
                const alreadyCollected = player.titleProgress?.settlementsVisited?.includes(sKey);
                actions.push({
                    type: 'collect_tax',
                    label: '💰 Collect Taxes',
                    icon: '📜',
                    description: alreadyCollected ? 'Already collected here this month' : `Collect taxes for ${world.getKingdom(player.allegiance)?.name || 'the realm'}`,
                    disabled: alreadyCollected,
                });
            }

            // Jailer — hunt/capture fugitives
            if (player.currentTitle === 'jailer') {
                if (!player.activeFugitive) {
                    if (tile.settlement.kingdom === player.allegiance) {
                        actions.push({
                            type: 'request_bounty',
                            label: '🔍 Request Bounty',
                            icon: '📋',
                            description: 'Get assigned a fugitive to hunt down',
                        });
                    }
                } else {
                    const fug = player.activeFugitive;
                    const isOnFugitive = (player.q === fug.q && player.r === fug.r);
                    actions.push({
                        type: 'capture_fugitive',
                        label: isOnFugitive ? '⚔️ Capture Fugitive' : '🔍 Track Fugitive',
                        icon: '🔒',
                        description: isOnFugitive
                            ? `Attempt to capture ${fug.name} (difficulty ${fug.difficulty})`
                            : `${fug.name} was last seen near (${fug.q}, ${fug.r}). ${fug.daysRemaining} days left.`,
                        disabled: !isOnFugitive,
                    });
                }
            }

            // Court Chaplain — bless settlements
            if (player.currentTitle === 'court_chaplain' && tile.settlement.kingdom === player.allegiance) {
                const sKey = `${tile.q},${tile.r}`;
                const alreadyBlessed = player.titleProgress?.settlementsBlesssed?.includes(sKey);
                actions.push({
                    type: 'bless_settlement',
                    label: '🙏 Bless Settlement',
                    icon: '✨',
                    description: alreadyBlessed ? 'Already blessed this month' : `Give a blessing to ${tile.settlement.name}`,
                    disabled: alreadyBlessed,
                });
            }

            // Chancellor — hold council at capital
            if (player.currentTitle === 'chancellor' && tile.settlement.type === 'capital' && tile.settlement.kingdom === player.allegiance) {
                actions.push({
                    type: 'hold_council',
                    label: '👑 Hold Council',
                    icon: '🏛️',
                    description: player.titleProgress?.councilHeld ? 'Already held council this month' : 'Convene the royal council',
                    disabled: player.titleProgress?.councilHeld,
                });
            }

            // View Title Status (always available when holding a title)
            actions.push({
                type: 'view_title_status',
                label: `📋 ${titleDef.name} Duties`,
                icon: titleDef.icon || '🏅',
                description: 'View your title duties and progress',
            });
        }
    }

    // Seek Title (at own-kingdom settlements, if allegiance exists)
    if (typeof Titles !== 'undefined' && player.allegiance &&
        tile.settlement.kingdom === player.allegiance && !player.currentTitle) {
        actions.push({
            type: 'seek_title',
            label: 'Seek Royal Office',
            icon: '🏅',
            description: 'Request appointment to a political office'
        });
    }

    // Host Feast (at cities/towns, costs gold)
    if (isCity && player.gold >= 200) {
        actions.push({
            type: 'host_feast',
            label: 'Host a Feast',
            icon: '🍖',
            description: 'Throw a grand feast to boost renown and reputation (200+ gold)'
        });
    }

    // Hold Tournament (at cities, costs gold, need army or combat skill)
    if (isCity && player.gold >= 300 && (player.skills?.combat >= 2 || (player.army && player.army.length > 0))) {
        actions.push({
            type: 'hold_tournament',
            label: 'Hold Tournament',
            icon: '🏟️',
            description: 'Organize a grand tournament for renown, gold prizes, and combat experience'
        });
    }

    if (isCity && player.gold >= 260) {
        let festivalDesc = 'Host a seasonal celebration with contests, diplomacy, and morale boosts';
        if (typeof Festivals !== 'undefined') {
            Festivals.initialize(player);
            const gate = Festivals.canHostFestival(player, world, tile);
            if (!gate.ok) {
                festivalDesc = gate.reason;
            }
        }

        actions.push({
            type: 'host_festival',
            label: 'Host Festival',
            icon: '🎉',
            description: festivalDesc,
            disabled: typeof Festivals !== 'undefined' ? !Festivals.canHostFestival(player, world, tile).ok : false,
        });
    }

    // Pickpocket (stealth action at settlements)
    if (player.skills?.stealth >= 1) {
        actions.push({
            type: 'pickpocket',
            label: 'Pickpocket',
            icon: '🤏',
            description: 'Attempt to lift a purse from the crowd (risky)'
        });
    }

    // Smuggle Goods (at settlements with a kingdom border)
    if (tile.settlement.kingdom && player.skills?.stealth >= 2 && player.inventory) {
        const hasGoods = Object.keys(player.inventory).length > 0;
        if (hasGoods) {
            actions.push({
                type: 'smuggle',
                label: 'Smuggle Goods',
                icon: '🕵️',
                description: 'Sell goods on the black market for higher prices (risky)'
            });
        }
    }

    // Train / Spar (at settlements with military)
    if (isCity) {
        actions.push({
            type: 'train_combat',
            label: 'Train at Barracks',
            icon: '⚔️',
            description: 'Spar with soldiers to improve combat skill'
        });
    }

    // --- Relationships ---

    // Meet People / Socialize (at any settlement)
    actions.push({
        type: 'meet_people',
        label: 'Meet People',
        icon: '👥',
        description: 'Get to know the locals — make friends, rivals, or romantic interests'
    });

    // View Relationships (if player knows anyone)
    if (player.relationships && Object.keys(player.relationships).length > 0) {
        actions.push({
            type: 'view_relationships',
            label: 'Relationships',
            icon: '💕',
            description: 'View your friends, rivals, loved ones, and family'
        });
    }

    // Manage Family / Heirs (if player has children)
    if (player.children && player.children.length > 0) {
        actions.push({
            type: 'manage_dynasty',
            label: 'Dynasty & Heirs',
            icon: '👑',
            description: 'View your family tree and designate an heir'
        });
    }

    // Fleet overview (if player owns ships)
    if (typeof Ships !== 'undefined' && player.ships && player.ships.length > 0) {
        actions.push({
            type: 'manage_fleet',
            label: 'Fleet Overview',
            icon: '⚓',
            description: 'View the status of all your ships'
        });
    }
}
