// Tavern — intel members (split from the original monolith).
import { Tavern } from './_ref.js';
import { Utils, Hex, PlayerEconomy, MarketDynamics, Characters, Cartography, Religion, Gossip, Titles } from './_imports.js';
import { Chatter } from '../../systems/chatter.js';

Object.assign(Tavern, {
    // ────────────────────────────────────────────────────────────────────
    //  Rumor Generators
    // ────────────────────────────────────────────────────────────────────
    /**
     * Generate a random rumor
     */
    _generateRumor(type, tile, world, reliability, player = null) {
        const kingdoms = world.kingdoms.filter(k => k.isAlive);
        if (kingdoms.length === 0) return null;

        const accurate = Utils.random() < reliability.accuracy;

        switch (type) {
            case 'regional_news': {
                // What is happening in the region (systems/chatter.js): wars, a
                // blockade, sieges, plague and famine, sagas, rivals, new rulers,
                // revolts, proclamations. An inaccurate telling distorts it.
                const news = Chatter.tavernNews(world, player, tile, { accurate, roll: Utils.random(), pick: Utils.random() });
                if (!news) return null;
                return {
                    category: news.kind === 'war' || news.kind === 'siege' || news.kind === 'blockade' || news.kind === 'revolt'
                        ? Tavern.CATEGORIES.MILITARY : Tavern.CATEGORIES.RUMORS_GOSSIP,
                    icon: '🍺',
                    title: 'Talk of the Region',
                    text: news.text,
                    reliability, accurate,
                    day: world.day,
                    source: tile.settlement.name,
                };
            }

            case 'kingdom_gossip': {
                const k = Utils.randPick(kingdoms);
                const templates = [
                    () => `They say ${k.name} is ${accurate ? (k.treasury > 1000 ? 'swimming in gold' : 'struggling financially') : Utils.randPick(['swimming in gold', 'struggling financially'])}.`,
                    () => `I heard ${k.ruler} has been ${Utils.randPick(['making bold moves', 'acting strangely', 'strengthening the borders', 'hosting grand feasts', 'raising taxes'])}.`,
                    () => `People from ${k.name} say the kingdom is ${accurate ? (k.population > 5000 ? 'thriving' : 'barely getting by') : Utils.randPick(['thriving', 'barely getting by'])}.`,
                ];
                return {
                    category: Tavern.CATEGORIES.KINGDOM_AFFAIRS,
                    icon: '🏰',
                    title: `About ${k.name}`,
                    text: Utils.randPick(templates)(),
                    reliability, accurate,
                    day: world.day,
                    source: tile.settlement.name,
                };
            }

            case 'character_gossip': {
                const k = Utils.randPick(kingdoms);
                const cd = k.characterData;
                if (!cd || !cd.ruler) return null;
                const ruler = cd.ruler;

                const templates = [
                    () => `Word is that ${Characters.getFullName(ruler)} of ${k.name} is ${ruler.isIll ? 'gravely ill' : Utils.randPick(['in good health', 'looking tired lately', 'more paranoid than ever', 'celebrating a recent victory'])}.`,
                    () => cd.spouse && cd.spouse.isAlive
                        ? `${Characters.getFullName(ruler)}'s consort ${Characters.getFullName(cd.spouse)} is said to be ${Utils.randPick(['very influential at court', 'beloved by the people', 'plotting something', 'homesick for their homeland'])}.`
                        : `${Characters.getFullName(ruler)} remains unmarried. Many wonder who will be the next consort.`,
                    () => cd.children && cd.children.filter(c => c.isAlive).length > 0
                        ? `The heir of ${k.name}, ${Characters.getFullName(cd.children.find(c => c.isAlive))}, is said to be ${Utils.randPick(['a capable youth', 'wild and reckless', 'studying diligently', 'training with the guard'])}.`
                        : `${k.name} lacks a clear heir. Nobles are worried about succession.`,
                ];
                return {
                    category: Tavern.CATEGORIES.CHARACTER_LOCATION,
                    icon: '👑',
                    title: `Gossip: ${Characters.getFullName(ruler)}`,
                    text: Utils.randPick(templates)(),
                    reliability, accurate,
                    day: world.day,
                    source: tile.settlement.name,
                };
            }

            case 'price_hint': {
                return Tavern._generateRandomPriceHint(tile, world, reliability);
            }

            case 'trade_tip': {
                const goodKeys = Object.keys(PlayerEconomy.GOODS);
                const goodKey = Utils.randPick(goodKeys);
                const good = PlayerEconomy.GOODS[goodKey];

                const settlements = world.getAllSettlements().filter(s =>
                    s.q !== tile.q || s.r !== tile.r
                );
                if (settlements.length === 0) return null;
                const dest = Utils.randPick(settlements);

                const realPrice = MarketDynamics.getPrice(good.id, dest.q, dest.r, world);
                const reportedPrice = accurate ? realPrice : Math.floor(realPrice * Utils.randFloat(0.6, 1.5));
                const isProfitable = reportedPrice > good.basePrice;

                return {
                    category: Tavern.CATEGORIES.TRADE_OPPORTUNITIES,
                    icon: '💡',
                    title: `Trade Tip: ${good.name}`,
                    text: `A merchant mentions that ${good.icon} ${good.name} ${isProfitable ? 'sells well' : 'is cheap'} in ${dest.name} — around ${reportedPrice}g each.`,
                    reliability, accurate,
                    day: world.day,
                    source: tile.settlement.name,
                };
            }

            case 'local_rumor': {
                const flavorRumors = [
                    `A strange comet was seen in the sky last night. Some say it portends great change.`,
                    `Bandits have been spotted on the roads between here and the next town.`,
                    `A traveling bard sang of ancient ruins to the ${Utils.randPick(['north', 'south', 'east', 'west'])}.`,
                    `The harvest has been ${Utils.randPick(['bountiful', 'poor', 'average'])} this season.`,
                    `A mysterious traveler passed through last week, asking questions about the old temples.`,
                    `The local well water has been tasting strange. Some blame dark magic.`,
                    `A trader claims to have seen a sea serpent near the coast.`,
                    `There's talk of a hidden treasure buried somewhere in the ${Utils.randPick(['mountains', 'forest', 'desert', 'swamps'])}.`,
                    `The innkeeper says business has been ${Utils.randPick(['booming', 'slow', 'steady'])} lately.`,
                    `Wolves have been coming closer to the settlement at night.`,
                    `A preacher has been gathering followers in the town square, speaking of the end times.`,
                    `Horse prices have gone up because of the war effort.`,
                ];
                return {
                    category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                    icon: '🗨️',
                    title: 'Local Rumor',
                    text: Utils.randPick(flavorRumors),
                    reliability, accurate: true, // Flavor rumors are always "accurate"
                    day: world.day,
                    source: tile.settlement.name,
                };
            }

            case 'war_rumor': {
                const atWar = kingdoms.filter(k => k.wars && k.wars.length > 0);
                if (atWar.length === 0) {
                    return {
                        category: Tavern.CATEGORIES.MILITARY,
                        icon: '🕊️',
                        title: 'Peace Reigns',
                        text: 'The lands are at peace, for now. No wars rage between the kingdoms.',
                        reliability, accurate: true,
                        day: world.day,
                        source: tile.settlement.name,
                    };
                }
                const warK = Utils.randPick(atWar);
                const enemyId = Utils.randPick(warK.wars);
                const enemy = world.getKingdom(enemyId);
                if (!enemy) return null;

                return {
                    category: Tavern.CATEGORIES.MILITARY,
                    icon: '⚔️',
                    title: 'War News',
                    text: `${warK.name} and ${enemy.name} are locked in conflict. ${accurate ? (warK.military > enemy.military ? warK.name + ' seems to be winning.' : enemy.name + ' has the advantage.') : Utils.randPick([warK.name, enemy.name]) + ' seems to be winning.'}`,
                    reliability, accurate,
                    day: world.day,
                    source: tile.settlement.name,
                };
            }
        }

        return null;
    },

    /**
     * Generate price intel for a specific settlement
     */
    _generatePriceIntel(dest, fromTile, world, reliability) {
        const accurate = Utils.random() < reliability.accuracy;
        const distance = Hex.wrappingDistance(fromTile.q, fromTile.r, dest.q, dest.r, world.width);

        // Pick 3-5 goods to report on
        const goodKeys = Object.keys(PlayerEconomy.GOODS);
        const reportGoods = Utils.shuffle([...goodKeys]).slice(0, Utils.randInt(3, 5));

        const priceLines = [];
        for (const key of reportGoods) {
            const good = PlayerEconomy.GOODS[key];
            const realPrice = MarketDynamics.getPrice(good.id, dest.q, dest.r, world);

            // Further from source = less accurate even for merchant reports
            const distFactor = Math.min(distance / 30, 0.5);
            const reported = accurate
                ? Math.floor(realPrice * Utils.randFloat(1 - distFactor * 0.2, 1 + distFactor * 0.2))
                : Math.floor(realPrice * Utils.randFloat(0.5, 1.8));

            const trend = MarketDynamics.getPriceTrend(good.id, dest.q, dest.r, world);
            const trendIcon = trend === 'rising' ? '📈' : trend === 'falling' ? '📉' : '➡️';

            priceLines.push(`${good.icon} ${good.name}: ~${reported}g ${trendIcon}`);
        }

        return {
            category: Tavern.CATEGORIES.MARKET_PRICES,
            icon: '💰',
            title: `Prices in ${dest.name}`,
            text: priceLines.join('\n'),
            reliability, accurate,
            day: world.day,
            source: fromTile.settlement.name,
            relatedSettlement: { name: dest.name, q: dest.q, r: dest.r },
        };
    },

    /**
     * Generate a random price hint rumor
     */
    _generateRandomPriceHint(tile, world, reliability) {
        const accurate = Utils.random() < reliability.accuracy;
        const settlements = world.getAllSettlements().filter(s => s.q !== tile.q || s.r !== tile.r);
        if (settlements.length === 0) return null;

        const dest = Utils.randPick(settlements);
        const goodKeys = Object.keys(PlayerEconomy.GOODS);
        const goodKey = Utils.randPick(goodKeys);
        const good = PlayerEconomy.GOODS[goodKey];

        const realPrice = MarketDynamics.getPrice(good.id, dest.q, dest.r, world);
        const reported = accurate ? realPrice : Math.floor(realPrice * Utils.randFloat(0.5, 1.6));

        const comparison = reported > good.basePrice * 1.3 ? 'expensive' :
                          reported < good.basePrice * 0.7 ? 'cheap' : 'fairly priced';

        return {
            category: Tavern.CATEGORIES.MARKET_PRICES,
            icon: '💰',
            title: `Price Info: ${good.name}`,
            text: `Someone mentions ${good.icon} ${good.name} is ${comparison} in ${dest.name} — about ${reported}g.`,
            reliability, accurate,
            day: world.day,
            source: tile.settlement.name,
        };
    },

    /**
     * Generate a trade opportunity tip
     */
    _generateTradeOpportunity(fromTile, settlements, world) {
        // Find the best buy-here-sell-there opportunity
        let bestProfit = 0;
        let bestTip = null;

        const goodKeys = Object.keys(PlayerEconomy.GOODS);
        for (const key of goodKeys) {
            const good = PlayerEconomy.GOODS[key];
            const localPrice = MarketDynamics.getPrice(good.id, fromTile.q, fromTile.r, world);

            for (const dest of settlements) {
                const destPrice = MarketDynamics.getPrice(good.id, dest.q, dest.r, world);
                const profit = destPrice - localPrice;
                if (profit > bestProfit) {
                    bestProfit = profit;
                    bestTip = {
                        good: good,
                        dest: dest,
                        buyPrice: localPrice,
                        sellPrice: destPrice,
                        profit: profit,
                    };
                }
            }
        }

        if (!bestTip || bestProfit < 5) return null;

        return {
            category: Tavern.CATEGORIES.TRADE_OPPORTUNITIES,
            icon: '📊',
            title: 'Trade Opportunity',
            text: `Buy ${bestTip.good.icon} ${bestTip.good.name} here for ~${bestTip.buyPrice}g and sell in ${bestTip.dest.name} for ~${bestTip.sellPrice}g. Potential profit: ${bestTip.profit}g per unit!`,
            reliability: Tavern.RELIABILITY.MERCHANT_INFO,
            accurate: true,
            day: world.day,
            source: fromTile.settlement.name,
        };
    },

    /**
     * Generate character location intel
     */
    _generateCharacterIntel(kingdom, tile, world, reliability) {
        const cd = kingdom.characterData;
        if (!cd || !cd.ruler) return null;

        const ruler = cd.ruler;
        const accurate = Utils.random() < reliability.accuracy;

        let locationText = '';
        if (kingdom.capital) {
            const capitalTile = world.getTile(kingdom.capital.q, kingdom.capital.r);
            const capitalName = capitalTile && capitalTile.settlement ? capitalTile.settlement.name : 'the capital';
            locationText = accurate
                ? `${Characters.getDisplayName(ruler, kingdom)} was last seen at ${capitalName}.`
                : `${Characters.getDisplayName(ruler, kingdom)} is rumored to be ${Utils.randPick([`at ${capitalName}`, 'traveling the realm', 'visiting the border forts', 'on a diplomatic mission'])}.`;
        }

        // Additional details
        const details = [];
        if (ruler.isIll) {
            details.push(accurate ? 'They are said to be very ill.' : Utils.randPick(['They are said to be very ill.', 'They seem healthy and vigorous.']));
        }
        if (ruler.age > 60) {
            details.push(`At ${accurate ? ruler.age : ruler.age + Utils.randInt(-5, 5)} years old, many wonder about succession.`);
        }
        if (cd.children) {
            const livingHeirs = cd.children.filter(c => c.isAlive && c.age >= 16);
            if (livingHeirs.length > 0) {
                details.push(`They have ${accurate ? livingHeirs.length : Utils.randInt(1, 5)} eligible heirs.`);
            }
        }

        return {
            category: Tavern.CATEGORIES.CHARACTER_LOCATION,
            icon: '👑',
            title: `${Characters.getDisplayName(ruler, kingdom)}`,
            text: `${locationText} ${details.join(' ')}`.trim(),
            reliability, accurate,
            day: world.day,
            source: tile.settlement.name,
        };
    },

    /**
     * Generate advisor intel
     */
    _generateAdvisorIntel(kingdom, world, reliability) {
        const cd = kingdom.characterData;
        if (!cd || !cd.advisors) return null;

        const roleKeys = Object.keys(cd.advisors).filter(k => cd.advisors[k] && cd.advisors[k].isAlive);
        if (roleKeys.length === 0) return null;

        const roleId = Utils.randPick(roleKeys);
        const advisor = cd.advisors[roleId];
        const role = Characters.ADVISOR_ROLES[roleId];
        const accurate = Utils.random() < reliability.accuracy;

        const loyaltyDesc = accurate
            ? (advisor.loyalty > 70 ? 'deeply loyal' : advisor.loyalty > 40 ? 'dutiful' : 'discontented')
            : Utils.randPick(['deeply loyal', 'dutiful', 'discontented', 'scheming']);

        return {
            category: Tavern.CATEGORIES.CHARACTER_LOCATION,
            icon: role.icon,
            title: `${role.name} of ${kingdom.name}`,
            text: `${Characters.getFullName(advisor)} serves as ${role.name} of ${kingdom.name}. They are said to be ${loyaltyDesc}. Skill: ${accurate ? advisor.skills[role.primarySkill] : Utils.randInt(3, 18)}/20.`,
            reliability, accurate,
            day: world.day,
            source: 'bribe',
        };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Informant Daily Processing
    // ────────────────────────────────────────────────────────────────────
    /**
     * Process informants each day — they generate high-quality intel passively
     */
    processInformants(player, world) {
        if (!player.intel || !player.intel.informants) return { cost: 0, newRumors: [] };

        let totalCost = 0;
        const newRumors = [];
        const toRemove = [];
        // A Spymaster keeps a few informants on the crown's purse
        const title = Titles.getActiveTitle(player);
        const freeInformants = (title && title.perks && title.perks.freeInformants) || 0;

        for (let i = 0; i < player.intel.informants.length; i++) {
            const informant = player.intel.informants[i];

            // Pay upkeep (the first few are free for a Spymaster)
            const upkeep = i < freeInformants ? 0 : informant.upkeep;
            if (upkeep === 0 || player.gold >= upkeep) {
                player.gold -= upkeep;
                totalCost += upkeep;
            } else {
                // Can't pay — informant leaves
                toRemove.push(i);
                continue;
            }

            // Generate intel every 3 days
            if (world.day % 3 !== 0) continue;

            const tile = world.getTile(informant.q, informant.r);
            if (!tile || !tile.settlement) continue;

            // High quality intel from informant's location
            const reliability = Tavern.RELIABILITY.INFORMANT;

            // Price intel
            const priceRumor = Tavern._generatePriceIntel(
                { q: informant.q, r: informant.r, name: informant.settlementName },
                { q: player.q, r: player.r, settlement: { name: 'your informant' } },
                world,
                reliability
            );
            if (priceRumor) {
                priceRumor.source = `Informant in ${informant.settlementName}`;
                newRumors.push(priceRumor);
            }

            // Character/political intel if informant is in a kingdom
            if (informant.kingdom) {
                const kingdom = world.getKingdom(informant.kingdom);
                if (kingdom && kingdom.isAlive) {
                    const charRumor = Tavern._generateCharacterIntel(kingdom, tile, world, reliability);
                    if (charRumor) {
                        charRumor.source = `Informant in ${informant.settlementName}`;
                        newRumors.push(charRumor);
                    }
                }
            }
        }

        // Remove unpaid informants (iterate backwards)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            player.intel.informants.splice(toRemove[i], 1);
        }

        Tavern._storeRumors(player, newRumors);
        return { cost: totalCost, newRumors, lostInformants: toRemove.length };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Storage & Expiration
    // ────────────────────────────────────────────────────────────────────
    /**
     * Store rumors in player's intel log
     */
    _storeRumors(player, rumors) {
        if (!player.intel) player.intel = { rumors: [], informants: [] };
        if (!player.intel.rumors) player.intel.rumors = [];

        for (const rumor of rumors) {
            // Deduplicate: if a rumor with the same category + title exists,
            // replace the old one with the newer version
            const dupeIdx = player.intel.rumors.findIndex(r =>
                r.category === rumor.category && r.title === rumor.title
            );
            if (dupeIdx !== -1) {
                player.intel.rumors.splice(dupeIdx, 1);
            }
            player.intel.rumors.unshift(rumor); // newest first
        }

        // Cap max rumors
        if (player.intel.rumors.length > Tavern.MAX_RUMORS) {
            player.intel.rumors = player.intel.rumors.slice(0, Tavern.MAX_RUMORS);
        }
    },

    /**
     * Clean up stale intel
     */
    expireOldIntel(player, currentDay) {
        if (!player.intel || !player.intel.rumors) return;
        player.intel.rumors = player.intel.rumors.filter(r =>
            (currentDay - r.day) <= Tavern.INTEL_DECAY_DAYS
        );
    },

    /**
     * Get all current intel, sorted by category
     */
    getIntelByCategory(player) {
        if (!player.intel || !player.intel.rumors) return {};

        const byCategory = {};
        for (const rumor of player.intel.rumors) {
            if (!byCategory[rumor.category]) byCategory[rumor.category] = [];
            byCategory[rumor.category].push(rumor);
        }
        return byCategory;
    },

    /**
     * Get freshness label for a rumor
     */
    getFreshness(rumor, currentDay) {
        const age = currentDay - rumor.day;
        if (age <= 1) return { label: 'Fresh', color: '#27ae60' };
        if (age <= 7) return { label: 'Recent', color: '#f1c40f' };
        if (age <= 15) return { label: 'Aging', color: '#e67e22' };
        return { label: 'Stale', color: '#c0392b' };
    },

    /**
     * Buy maps at the tavern — opens the map trade menu via ActionMenu
     */
    _buyTavernMap(player, tile, world) {
        // This returns a special signal that the tavern UI should handle
        // by opening the map trade panel
        return [{
            text: '🗺️ A weathered cartographer spreads maps across the table...',
            category: 'TRADE_OPPORTUNITIES',
            reliability: Tavern.RELIABILITY.MERCHANT_INFO,
            day: world.day,
            openMapTrade: true,
        }];
    },
});
