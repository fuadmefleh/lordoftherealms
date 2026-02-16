// ============================================
// TAVERN & INTELLIGENCE — Information gathering system
// ============================================

const Tavern = {

    // ── Cost & Configuration ───────────────────────────────────────────
    DRINK_COST: 5,           // Cost of a drink to loosen tongues
    BRIBE_COST: 50,          // Cost to bribe for specific intel
    HIRE_INFORMANT_COST: 200, // Cost to hire a standing informant in a city

    INTEL_DECAY_DAYS: 30,    // How many days before intel becomes stale
    MAX_RUMORS: 40,          // Max stored rumors before oldest drop off

    // Reliability tiers (how accurate the info is)
    RELIABILITY: {
        TAVERN_GOSSIP: { accuracy: 0.55, label: 'Tavern Gossip', color: '#9a8e7e' },
        LOCAL_TALK:    { accuracy: 0.70, label: 'Local Talk', color: '#f1c40f' },
        MERCHANT_INFO: { accuracy: 0.85, label: 'Merchant Report', color: '#27ae60' },
        INFORMANT:     { accuracy: 0.95, label: 'Informant', color: '#3498db' },
    },

    // ── Rumor Categories ───────────────────────────────────────────────
    CATEGORIES: {
        MARKET_PRICES: 'market_prices',
        CHARACTER_LOCATION: 'character_location',
        KINGDOM_AFFAIRS: 'kingdom_affairs',
        MILITARY: 'military',
        RUMORS_GOSSIP: 'rumors_gossip',
        TRADE_OPPORTUNITIES: 'trade_opportunities',
    },

    // ────────────────────────────────────────────────────────────────────
    //  Tavern Interaction
    // ────────────────────────────────────────────────────────────────────

    /**
     * Get the menu options available at a tavern
     */
    getTavernOptions(player, tile, world) {
        const options = [];
        const settlement = tile.settlement;
        if (!settlement) return options;

        const isCity = settlement.type === 'town' || settlement.type === 'capital';

        // 1. Buy a round of drinks for local gossip
        options.push({
            id: 'buy_drinks',
            label: `Buy a round of drinks`,
            icon: '🍺',
            cost: Tavern.DRINK_COST,
            description: `Spend ${Tavern.DRINK_COST} gold to hear what locals are talking about`,
            available: player.gold >= Tavern.DRINK_COST,
        });

        // 2. Talk to travelers about nearby market prices
        options.push({
            id: 'ask_merchants',
            label: 'Talk to traveling merchants',
            icon: '🧳',
            cost: Tavern.DRINK_COST * 2,
            description: `Learn about prices in nearby settlements (${Tavern.DRINK_COST * 2}g)`,
            available: player.gold >= Tavern.DRINK_COST * 2,
        });

        // 3. Ask about important characters
        options.push({
            id: 'ask_characters',
            label: 'Ask about notable figures',
            icon: '👑',
            cost: Tavern.BRIBE_COST,
            description: `Bribe someone for info about rulers and advisors (${Tavern.BRIBE_COST}g)`,
            available: player.gold >= Tavern.BRIBE_COST,
        });

        // 4. Ask about military movements
        if (isCity) {
            options.push({
                id: 'ask_military',
                label: 'Ask about troop movements',
                icon: '⚔️',
                cost: Tavern.BRIBE_COST,
                description: `Learn about wars and military strength (${Tavern.BRIBE_COST}g)`,
                available: player.gold >= Tavern.BRIBE_COST,
            });
        }

        // 5. Hire an informant (cities only, expensive)
        if (isCity) {
            const alreadyHasInformant = player.intel && player.intel.informants &&
                player.intel.informants.some(i => i.q === tile.q && i.r === tile.r);
            if (!alreadyHasInformant) {
                options.push({
                    id: 'hire_informant',
                    label: 'Hire a local informant',
                    icon: '🕵️',
                    cost: Tavern.HIRE_INFORMANT_COST,
                    description: `Place a permanent informant here. Costs ${Tavern.HIRE_INFORMANT_COST}g + 10g/day upkeep.`,
                    available: player.gold >= Tavern.HIRE_INFORMANT_COST,
                });
            }
        }

        // 6. Check rumor board (free)
        options.push({
            id: 'rumor_board',
            label: 'Check the notice board',
            icon: '📋',
            cost: 0,
            description: 'See posted notices and job listings (free)',
            available: true,
        });

        // 7. Sell Your Soul (dark pact for gold — repeatable once per day)
        const alreadySoldToday = player.lastSoulSoldDay === world.day;
        options.push({
            id: 'sell_soul',
            label: 'Sell Your Soul',
            icon: '🔥',
            cost: 0,
            description: alreadySoldToday
                ? 'The shadowy figure waves you off. "Come back tomorrow..."'
                : 'A shadowy figure offers a dark bargain — a pittance of gold for a piece of your soul. Lowers karma and renown.',
            available: !alreadySoldToday,
        });

        return options;
    },

    /**
     * Handle a tavern action choice
     */
    handleAction(actionId, player, tile, world) {
        const settlement = tile.settlement;
        if (!settlement) return [];

        switch (actionId) {
            case 'buy_drinks':
                return Tavern._buyDrinks(player, tile, world);
            case 'ask_merchants':
                return Tavern._askMerchants(player, tile, world);
            case 'ask_characters':
                return Tavern._askCharacters(player, tile, world);
            case 'ask_military':
                return Tavern._askMilitary(player, tile, world);
            case 'hire_informant':
                return Tavern._hireInformant(player, tile, world);
            case 'rumor_board':
                return Tavern._checkRumorBoard(player, tile, world);
            case 'sell_soul':
                return Tavern._sellSoul(player, tile, world);
            default:
                return [];
        }
    },

    // ────────────────────────────────────────────────────────────────────
    //  Intel Gathering Actions
    // ────────────────────────────────────────────────────────────────────

    /**
     * Buy a round of drinks — hear random gossip
     */
    _buyDrinks(player, tile, world) {
        player.gold -= Tavern.DRINK_COST;
        const rumors = [];
        const numRumors = Utils.randInt(1, 3);

        for (let i = 0; i < numRumors; i++) {
            const rumorType = Utils.randPick([
                'kingdom_gossip', 'character_gossip', 'price_hint', 'trade_tip', 'local_rumor', 'war_rumor'
            ]);
            const rumor = Tavern._generateRumor(rumorType, tile, world, Tavern.RELIABILITY.TAVERN_GOSSIP);
            if (rumor) rumors.push(rumor);
        }

        Tavern._storeRumors(player, rumors);
        return rumors;
    },

    /**
     * Talk to traveling merchants — get price intel for nearby cities
     */
    _askMerchants(player, tile, world) {
        player.gold -= Tavern.DRINK_COST * 2;
        const rumors = [];

        // Find nearby settlements (within 20 hex distance)
        const settlements = world.getAllSettlements();
        const nearby = settlements.filter(s => {
            if (s.q === tile.q && s.r === tile.r) return false;
            return Hex.wrappingDistance(tile.q, tile.r, s.q, s.r, world.width) <= 20;
        });

        // Pick 2-4 settlements to report on
        const reportCount = Math.min(nearby.length, Utils.randInt(2, 4));
        const chosen = Utils.shuffle([...nearby]).slice(0, reportCount);

        for (const dest of chosen) {
            const rumor = Tavern._generatePriceIntel(dest, tile, world, Tavern.RELIABILITY.MERCHANT_INFO);
            if (rumor) rumors.push(rumor);
        }

        // Maybe also a trade opportunity tip
        if (Math.random() < 0.5 && chosen.length > 0) {
            const tip = Tavern._generateTradeOpportunity(tile, chosen, world);
            if (tip) rumors.push(tip);
        }

        Tavern._storeRumors(player, rumors);
        return rumors;
    },

    /**
     * Ask about notable characters — where are rulers, what are they doing
     */
    _askCharacters(player, tile, world) {
        player.gold -= Tavern.BRIBE_COST;
        const rumors = [];

        // Get kingdoms sorted by proximity
        const kingdoms = world.kingdoms.filter(k => k.isAlive);
        const withDist = kingdoms.map(k => ({
            kingdom: k,
            dist: k.capital ? Hex.wrappingDistance(tile.q, tile.r, k.capital.q, k.capital.r, world.width) : 999
        })).sort((a, b) => a.dist - b.dist);

        // Report on 2-3 closest kingdoms' rulers
        const reportCount = Math.min(withDist.length, Utils.randInt(2, 3));
        for (let i = 0; i < reportCount; i++) {
            const k = withDist[i].kingdom;
            const rumor = Tavern._generateCharacterIntel(k, tile, world, Tavern.RELIABILITY.LOCAL_TALK);
            if (rumor) rumors.push(rumor);
        }

        // Maybe an advisor rumor
        if (Math.random() < 0.4 && withDist.length > 0) {
            const k = withDist[0].kingdom;
            const advisorRumor = Tavern._generateAdvisorIntel(k, world, Tavern.RELIABILITY.LOCAL_TALK);
            if (advisorRumor) rumors.push(advisorRumor);
        }

        Tavern._storeRumors(player, rumors);
        return rumors;
    },

    /**
     * Ask about military movements
     */
    _askMilitary(player, tile, world) {
        player.gold -= Tavern.BRIBE_COST;
        const rumors = [];

        const kingdoms = world.kingdoms.filter(k => k.isAlive);

        // Report active wars
        const atWar = kingdoms.filter(k => k.wars && k.wars.length > 0);
        for (const k of atWar.slice(0, 3)) {
            for (const enemyId of k.wars.slice(0, 1)) {
                const enemy = world.getKingdom(enemyId);
                if (!enemy) continue;

                const reliability = Tavern.RELIABILITY.LOCAL_TALK;
                const accurate = Math.random() < reliability.accuracy;

                // Real or distorted military strength
                const kStr = accurate ? k.military : Math.floor(k.military * Utils.randFloat(0.5, 1.8));
                const eStr = accurate ? enemy.military : Math.floor(enemy.military * Utils.randFloat(0.5, 1.8));

                const winning = kStr > eStr ? k.name : enemy.name;

                rumors.push({
                    category: Tavern.CATEGORIES.MILITARY,
                    icon: '⚔️',
                    title: `War: ${k.name} vs ${enemy.name}`,
                    text: `${k.name} is at war with ${enemy.name}. ${winning} appears to have the upper hand with roughly ${Utils.formatNumber(kStr > eStr ? kStr : eStr)} troops.`,
                    reliability: reliability,
                    accurate,
                    day: world.day,
                    source: tile.settlement.name,
                });
            }
        }

        // Report kingdom military strengths (approximate)
        const nearby = kingdoms.sort((a, b) => {
            const da = a.capital ? Hex.wrappingDistance(tile.q, tile.r, a.capital.q, a.capital.r, world.width) : 999;
            const db = b.capital ? Hex.wrappingDistance(tile.q, tile.r, b.capital.q, b.capital.r, world.width) : 999;
            return da - db;
        }).slice(0, 3);

        for (const k of nearby) {
            const reliability = Tavern.RELIABILITY.TAVERN_GOSSIP;
            const accurate = Math.random() < reliability.accuracy;
            const reported = accurate ? k.military : Math.floor(k.military * Utils.randFloat(0.4, 2.0));

            const statusWords = reported > 500 ? 'strong' : reported > 200 ? 'moderate' : 'weak';

            rumors.push({
                category: Tavern.CATEGORIES.MILITARY,
                icon: '🛡️',
                title: `${k.name} — Military`,
                text: `${k.name} is said to have a ${statusWords} military force of around ${Utils.formatNumber(reported)} troops.`,
                reliability: reliability,
                accurate,
                day: world.day,
                source: tile.settlement.name,
            });
        }

        Tavern._storeRumors(player, rumors);
        return rumors;
    },

    /**
     * Hire an informant — places a permanent spy in this city
     */
    _hireInformant(player, tile, world) {
        player.gold -= Tavern.HIRE_INFORMANT_COST;

        if (!player.intel) player.intel = { rumors: [], informants: [] };
        if (!player.intel.informants) player.intel.informants = [];

        player.intel.informants.push({
            q: tile.q,
            r: tile.r,
            settlementName: tile.settlement.name,
            kingdom: tile.kingdom || null,
            hiredDay: world.day,
            upkeep: 10, // gold per day
        });

        return [{
            category: Tavern.CATEGORIES.RUMORS_GOSSIP,
            icon: '🕵️',
            title: 'Informant Hired',
            text: `You've placed an informant in ${tile.settlement.name}. They will feed you intelligence daily for 10 gold/day.`,
            reliability: Tavern.RELIABILITY.INFORMANT,
            accurate: true,
            day: world.day,
            source: tile.settlement.name,
        }];
    },

    /**
     * Check the notice board — free, gives quest-like info
     */
    _checkRumorBoard(player, tile, world) {
        const rumors = [];

        // Notices about local kingdom decrees
        if (tile.kingdom) {
            const kingdom = world.getKingdom(tile.kingdom);
            if (kingdom) {
                const cd = kingdom.characterData;
                if (cd && cd.ruler) {
                    rumors.push({
                        category: Tavern.CATEGORIES.KINGDOM_AFFAIRS,
                        icon: '📜',
                        title: `Royal Decree — ${kingdom.name}`,
                        text: `By order of ${Characters.getDisplayName(cd.ruler, kingdom)}: The kingdom seeks loyal subjects. Current tax policy and military readiness are priorities.`,
                        reliability: Tavern.RELIABILITY.INFORMANT,
                        accurate: true,
                        day: world.day,
                        source: tile.settlement.name,
                    });
                }

                // Report relations summary
                const friendlyKingdoms = world.kingdoms.filter(k =>
                    k.isAlive && k.id !== kingdom.id && (kingdom.relations[k.id] || 0) > 30
                );
                const hostileKingdoms = world.kingdoms.filter(k =>
                    k.isAlive && k.id !== kingdom.id && (kingdom.relations[k.id] || 0) < -30
                );

                if (friendlyKingdoms.length > 0) {
                    rumors.push({
                        category: Tavern.CATEGORIES.KINGDOM_AFFAIRS,
                        icon: '🤝',
                        title: `Friends of ${kingdom.name}`,
                        text: `${kingdom.name} maintains good relations with ${friendlyKingdoms.map(k => k.name).join(', ')}.`,
                        reliability: Tavern.RELIABILITY.INFORMANT,
                        accurate: true,
                        day: world.day,
                        source: tile.settlement.name,
                    });
                }

                if (hostileKingdoms.length > 0) {
                    rumors.push({
                        category: Tavern.CATEGORIES.KINGDOM_AFFAIRS,
                        icon: '😤',
                        title: `Tensions`,
                        text: `Locals speak nervously about poor relations with ${hostileKingdoms.map(k => k.name).join(', ')}.`,
                        reliability: Tavern.RELIABILITY.LOCAL_TALK,
                        accurate: true,
                        day: world.day,
                        source: tile.settlement.name,
                    });
                }
            }
        }

        // Settlement-specific info
        rumors.push({
            category: Tavern.CATEGORIES.RUMORS_GOSSIP,
            icon: '🏘️',
            title: `About ${tile.settlement.name}`,
            text: `${tile.settlement.name} is a ${tile.settlement.type} with a population of ${Utils.formatNumber(tile.settlement.population)}.${tile.kingdom ? ` Part of ${world.getKingdom(tile.kingdom)?.name || 'an unknown kingdom'}.` : ' An independent settlement.'}`,
            reliability: Tavern.RELIABILITY.INFORMANT,
            accurate: true,
            day: world.day,
            source: tile.settlement.name,
        });

        Tavern._storeRumors(player, rumors);
        return rumors;
    },

    /**
     * Sell Your Soul — repeatable dark pact, once per day, small gold, costs karma & renown
     */
    _sellSoul(player, tile, world) {
        // Once per day check
        if (player.lastSoulSoldDay === world.day) {
            return [{
                category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                icon: '🔥',
                title: 'Come Back Tomorrow',
                text: 'The shadowy figure waves you off. "Patience... come back tomorrow. Your soul needs time to regrow what I\'ve taken."',
                reliability: Tavern.RELIABILITY.INFORMANT,
                accurate: true,
                day: world.day,
                source: tile.settlement.name,
            }];
        }

        // Track how many times soul has been sold
        player.soulSoldCount = (player.soulSoldCount || 0) + 1;
        player.lastSoulSoldDay = world.day;

        // Gold reward: 5-10 gold
        const goldReward = Utils.randInt(5, 10);

        // Karma and renown penalties scale slightly with how often you do it
        const karmaPenalty = 1 + Math.floor(player.soulSoldCount / 5);
        const renownPenalty = 1 + Math.floor(player.soulSoldCount / 3);

        player.gold += goldReward;
        player.karma -= karmaPenalty;
        player.renown = Math.max(0, (player.renown || 0) - renownPenalty);

        // Flavor text varies with how many times you've sold
        const count = player.soulSoldCount;
        let flavorText;
        if (count === 1) {
            flavorText = `A shadowy figure in the corner beckoned you over. "Just a sliver of your soul... nothing you\'ll miss." You shook the cold hand.`;
        } else if (count < 5) {
            flavorText = `The shadowy figure grins as you approach. "Back again? Of course you are." The exchange is quick. You feel a little emptier.`;
        } else if (count < 15) {
            flavorText = `The figure barely looks up. "The usual?" They slide the coins across the table. Your hands tremble slightly.`;
        } else if (count < 30) {
            flavorText = `You sit down before the figure even notices. The coins appear. You don\'t remember agreeing. Does it matter anymore?`;
        } else {
            flavorText = `The figure looks almost pitiful. "There\'s barely anything left, you know." The coins feel heavier each time. Or maybe you\'re just weaker.`;
        }

        return [{
            category: Tavern.CATEGORIES.RUMORS_GOSSIP,
            icon: '🔥',
            title: `Soul Sold (×${count})`,
            text: `${flavorText} +${goldReward} gold. Karma −${karmaPenalty}. Renown −${renownPenalty}.`,
            reliability: Tavern.RELIABILITY.INFORMANT,
            accurate: true,
            day: world.day,
            source: tile.settlement.name,
        }];
    },

    // ────────────────────────────────────────────────────────────────────
    //  Rumor Generators
    // ────────────────────────────────────────────────────────────────────

    /**
     * Generate a random rumor
     */
    _generateRumor(type, tile, world, reliability) {
        const kingdoms = world.kingdoms.filter(k => k.isAlive);
        if (kingdoms.length === 0) return null;

        const accurate = Math.random() < reliability.accuracy;

        switch (type) {
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
        const accurate = Math.random() < reliability.accuracy;
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
        const accurate = Math.random() < reliability.accuracy;
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
            icon: '🪙',
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
        const accurate = Math.random() < reliability.accuracy;

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
        const accurate = Math.random() < reliability.accuracy;

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

        for (let i = 0; i < player.intel.informants.length; i++) {
            const informant = player.intel.informants[i];

            // Pay upkeep
            if (player.gold >= informant.upkeep) {
                player.gold -= informant.upkeep;
                totalCost += informant.upkeep;
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
};
