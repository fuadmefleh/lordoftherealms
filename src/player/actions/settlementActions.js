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
import { RealmPolitics } from '../realmPolitics.js';
import { Throne } from '../../systems/throne.js';
import { PlayerReligion } from '../playerReligion.js';
import { SeasonalWork } from '../seasonalWork.js';
import { Underworld } from '../../systems/underworld.js';
import { Rivals } from '../../systems/rivals.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';
import { Ailments } from '../../systems/ailments.js';
import { Patronage } from '../../systems/patronage.js';
import { Finance } from '../../systems/finance.js';
import { Underwriting } from '../../systems/underwriting.js';
import { Bourse } from '../../systems/bourse.js';
import { Mints } from '../../systems/mints.js';

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

    // Denounce heresy — preach against the heretics troubling this realm
    const heresyHere = PlayerReligion.heresyAt(tile.settlement, world);
    if (heresyHere) {
        actions.push({
            type: 'denounce_heresy',
            label: 'Denounce Heresy',
            icon: '🔥',
            description: `Preach against the ${heresyHere.heresy.name} spreading through ${heresyHere.kingdom.name}`,
        });
    }

    // Physician / herbalist — when you or a companion need treatment (systems/ailments.js)
    if (Ailments.list(player).length > 0 || Ailments.sickCompanions(player).length > 0) {
        actions.push({
            type: 'seek_physician',
            label: isVillage ? 'See the Herbalist' : 'See a Physician',
            icon: '⚕️',
            description: 'Have your wounds and sickness treated (better in cities, and with medicine techs)'
        });
    }

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

    // Spring: sow a village's fields for a share of the harvest
    if (SeasonalWork.canSignPlantingContract(player, tile.settlement, world).ok) {
        actions.push({
            type: 'planting_contract',
            label: 'Planting Contract',
            icon: '🌱',
            description: 'Help sow the fields: a small advance now, a share of the harvest in autumn'
        });
    }

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

    // Wars of the realms — follow the wars, broker peace, campaign for your liege
    const allianceHere = tile.settlement.kingdom ? RealmPolitics.allianceCandidates(world, tile.settlement.kingdom).length > 0 : false;
    if (RealmPolitics.activeWars(world).length > 0 || RealmPolitics.truces(world).length > 0 || allianceHere) {
        const campaign = RealmPolitics.campaignOptions(player, world);
        actions.push({
            type: 'realm_wars',
            label: 'Wars of the Realm',
            icon: '⚔️',
            description: campaign
                ? `${campaign.liege.name} is at war — join the campaign, or broker peace between crowns`
                : allianceHere
                    ? 'Follow the wars between kingdoms, broker peace, or forge alliances'
                    : 'See the wars between kingdoms and try to broker peace',
        });
    }

    // A fallen kingdom's old town — fund the rising
    if (RealmPolitics.restorationTarget(player, world, tile)) {
        const t = RealmPolitics.restorationTarget(player, world, tile);
        actions.push({
            type: 'fund_restoration',
            label: `Restore ${t.fallen.name}`,
            icon: '🔥',
            description: `This town once belonged to the fallen ${t.fallen.name}. Fund a rising against ${t.occupier.name}.`,
        });
    }

    // Rival adventurers resting in town, and the Hall of Heroes (systems/rivals.js)
    const rivalsHere = Rivals.rivalsAt(player, world, tile.q, tile.r);
    if (rivalsHere.length) {
        actions.push({
            type: 'rivals_here',
            label: `Adventurers Here (${rivalsHere.length})`,
            icon: '🗡️',
            description: `${rivalsHere.map(r => r.name).join(', ')}: talk, duel, team up, hire, race or sabotage`,
        });
    }
    if (Rivals.state(player).initialized) {
        actions.push({
            type: 'hall_of_heroes',
            label: 'Hall of Heroes',
            icon: '🏆',
            description: 'Your renown ranked against the rival adventurers of the realm, and their latest deeds',
        });
    }

    // The trading company (systems/merchantHouses.js) — once there's one, a
    // charter or an office, or the purse to think about it
    const company = MerchantHouses.company(player);
    if (company || MerchantHouses.hasCharter(player) || MerchantHouses.officeCharter(player) || (player.gold || 0) >= 1500) {
        const post = company && MerchantHouses.postAt(player, tile.q, tile.r);
        actions.push({
            type: 'trading_company',
            label: company ? 'Trading Company' : 'Found a Trading Company',
            icon: '⚖️',
            description: company
                ? `${company.name}: ${company.posts.length} post(s), ${Math.round(company.capital)}g capital${post ? ' — your factor here' : ''}. Orders, ledger, contracts, rivals, investments`
                : 'Charter a merchant house: factors in towns, supply contracts, rival houses and royal ventures',
        });
    }

    // Patronage & Great Works (systems/patronage.js) — a town's salon, your
    // clients and Great Works, once there is a salon here or business to see to
    const pat = player.patronage;
    const patBusy = !!(pat && ((pat.clients || []).length || (pat.projects || []).length || (pat.gallery || []).some(g => !g.donatedTo)));
    if (patBusy || Patronage.hasSalon(tile) || Patronage.siteAt(player, world, tile.q, tile.r)) {
        const n = pat && pat.clients ? pat.clients.length : 0;
        actions.push({
            type: 'patronage',
            label: 'Patronage & Great Works',
            icon: '🎨',
            description: n
                ? `${n} client(s) in your service: commissions, Great Works, the gallery, the wonders of the world`
                : 'Take artists, scholars, architects, physicians and chroniclers into your service, and raise Great Works',
        });
    }

    // Banks, Credit & Coin (systems/finance.js) — a banking house's seat or one
    // of its branches in its realm's cities, or debts to see to anywhere
    const banksHere = Finance.banksAt(player, world, tile);
    const fin = player.finance;
    const owes = !!(fin && Array.isArray(fin.loans) && fin.loans.some(l => l && l.overdue > 0));
    if (banksHere.length || owes) {
        const b = banksHere[0];
        actions.push({
            type: 'bank',
            label: b ? b.name : 'Your Debts',
            icon: '🏦',
            description: b
                ? `Deposits, loans, royal bonds and your credit report${banksHere.length > 1 ? ` (${banksHere.length} houses here)` : ''}`
                : 'You are behind on a loan: pay before the bailiffs come',
        });
    }

    // Underwriters (systems/underwriting.js) — a banking house's desk or an
    // underwriters' guild at a great port; the Bourse (systems/bourse.js) in the greatest capitals
    const uwHere = Underwriting.underwritersAt(player, world, tile);
    if (uwHere.length) {
        const covers = Underwriting.summary(player, world).covers;
        actions.push({
            type: 'underwriter',
            label: 'Underwriters',
            icon: '🛡️',
            description: covers ? `${covers} cover(s) held: quotes, claims and the offices` : `Insure ships, caravans, stock, works and crops with ${uwHere[0].name}`,
        });
    }
    const exchange = Bourse.exchangeAt(player, world);
    if (exchange) {
        actions.push({
            type: 'bourse',
            label: `The Bourse of ${exchange.name}`,
            icon: '📈',
            description: 'Shares in the merchant houses, the banks and the chartered companies; float your own company',
        });
    }
    // The realm's mint at its capital (systems/mints.js): sell bullion, lease it, the coin of every realm
    const mintHere = Mints.enabled() ? Mints.mintAt(world, tile) : null;
    if (mintHere) {
        const pur = mintHere.kingdom.finance && mintHere.kingdom.finance.purity != null ? mintHere.kingdom.finance.purity : 1;
        actions.push({
            type: 'mint',
            label: `The Mint of ${mintHere.kingdom.name}`,
            icon: '💰',
            description: `Coin of ${Math.round(pur * 100)}% silver: sell gold and silver to the mint, lease it, and see every realm's coin and prices`,
        });
    }

    // Claims & Crowns — once there is a claim, a crisis, a war for a throne or a crown
    if (Throne.hasBusiness(player, world)) {
        const ruled = Throne.ruledKingdom(player, world);
        actions.push({
            type: 'claims_crowns',
            label: 'Claims & Crowns',
            icon: '👑',
            description: ruled ? `Rule ${ruled.name}: policies, levy and diplomacy` : 'Your claims on thrones, succession crises and the war for a crown',
        });
        if (ruled) {
            actions.push({
                type: 'royal_court',
                label: 'Royal Court',
                icon: '🏛️',
                description: `${ruled.name}'s council, edicts, vassals and factions`,
            });
        }
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

    if (isPlayerSettlement && playerSettlementCount >= 3 && !hasPlayerFoundedKingdom && !Throne.ruledKingdom(player, world)) {
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

    // The Underworld — guild jobs, the fence, the black market, cooling off
    {
        const uw = player.underworld;
        const inGuildTown = Underworld.hasGuildPresence(tile.settlement) && uw && (uw.guild.member || uw.guild.contactMet);
        const heat = Underworld.getHeat(player, tile.settlement.kingdom);
        if (inGuildTown || heat > 0) {
            actions.push({
                type: 'underworld',
                label: heat > 0 ? `Underworld (heat ${Math.round(heat)})` : 'Underworld',
                icon: '🗝️',
                description: inGuildTown
                    ? 'Guild jobs, the fence and the black market — and your heat in every realm'
                    : 'Your notoriety here: bribe the watch or lie low'
            });
        }
    }

    // The guildhall — the town's craft and merchant guilds (systems/guilds.js)
    if (tile.settlement.guilds && Object.keys(tile.settlement.guilds).length) {
        const n = Object.keys(tile.settlement.guilds).length;
        actions.push({
            type: 'guildhall',
            label: 'Guildhall',
            icon: '⚒️',
            description: `The town's ${n} guild${n === 1 ? '' : 's'}: join, rise to master, contracts, loans and elections`
        });
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
