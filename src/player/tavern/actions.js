// Tavern — actions members (split from the original monolith).
import { Tavern } from './_ref.js';
import { Traits } from '../../systems/traits.js';
import { Underworld } from '../../systems/underworld.js';
import { Utils, Hex, PlayerEconomy, MarketDynamics, Characters, Cartography, Religion, Gossip, Quests, Peoples, Sagas } from './_imports.js';

Object.assign(Tavern, {
    // ── Cost & Configuration ───────────────────────────────────────────
    DRINK_COST: 5,

    // Cost of a drink to loosen tongues
    BRIBE_COST: 50,

    // Cost to bribe for specific intel
    HIRE_INFORMANT_COST: 200,

    // Cost to hire a standing informant in a city
    INTEL_DECAY_DAYS: 30,

    // How many days before intel becomes stale
    MAX_RUMORS: 40,

    // Max stored rumors before oldest drop off
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

        // ── Needs-satisfying actions ──────────────────────────

        // Buy a hot meal (hunger) — the local peoples' signature dish comforts more
        const mealCost = 8;
        const localMeal = Peoples.mealBonus(tile.settlement);
        options.push({
            id: 'buy_meal',
            label: localMeal.dish ? `Buy a hot meal (${localMeal.dish})` : 'Buy a hot meal',
            icon: '🍖',
            cost: mealCost,
            description: localMeal.comfort > 0
                ? `The house serves the local ${localMeal.dish || localMeal.hybridDish} (${mealCost}g). Satisfies hunger; +${localMeal.comfort} extra comfort.`
                : `A hearty stew and fresh bread (${mealCost}g). Satisfies hunger and comfort.`,
            available: player.gold >= mealCost,
        });

        // Take a bath / wash up (hygiene)
        const bathCost = 6;
        options.push({
            id: 'take_bath',
            label: 'Wash up at the basin',
            icon: '🧼',
            cost: bathCost,
            description: `Use the tavern's wash basin (${bathCost}g). Restores hygiene.`,
            available: player.gold >= bathCost,
        });

        // Rest at the inn (energy)
        const innCost = 15;
        options.push({
            id: 'rest_at_inn',
            label: 'Rent a room to rest',
            icon: '🛏️',
            cost: innCost,
            description: `Rest in a private room (${innCost}g). Restores energy and comfort.`,
            available: player.gold >= innCost,
        });

        // Play dice (fun + social)
        const diceBet = 10;
        options.push({
            id: 'play_dice',
            label: 'Play a game of dice',
            icon: '🎲',
            cost: diceBet,
            description: `Join a dice game with the locals (${diceBet}g bet). Win or lose, it's fun.`,
            available: player.gold >= diceBet,
        });

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

        // 8. Buy maps from a shady cartographer (if Cartography is loaded)
        if (typeof Cartography !== 'undefined') {
            options.push({
                id: 'buy_tavern_map',
                label: 'Browse maps from a traveler',
                icon: '🗺️',
                cost: 0,
                description: 'A wandering cartographer has maps for sale — regional charts, treasure maps, and ancient fragments',
                available: true,
            });
        }

        // 9. Ask about religious lore (holy sites & extinct faiths)
        if (typeof Religion !== 'undefined') {
            options.push({
                id: 'ask_religious_lore',
                label: 'Ask about sacred places',
                icon: '⛲',
                cost: Tavern.BRIBE_COST,
                description: `Seek knowledge of holy sites and ancient faiths (${Tavern.BRIBE_COST}g)`,
                available: player.gold >= Tavern.BRIBE_COST,
            });
        }

        // 10. Listen for gossip about your crimes
        const gossipItems = Gossip.getTavernGossip(player, tile.q, tile.r, world);
        if (gossipItems.length > 0) {
            options.push({
                id: 'listen_gossip',
                label: 'Listen for gossip about you',
                icon: '👂',
                cost: 0,
                description: `People are whispering... ${gossipItems.length} rumor${gossipItems.length > 1 ? 's' : ''} circulating here.`,
                available: true,
            });
        }

        // 11. A quiet word with the barkeep: the thieves' guild contact
        if (Underworld.hasGuildPresence(settlement)) {
            const uw = Underworld.ensure(player);
            const known = uw.guild.contactMet || uw.guild.member;
            const cost = known ? 0 : Underworld.cfg('guild').contactCost;
            options.push({
                id: 'underworld_contact',
                label: known ? 'Slip into the back room' : 'Ask the barkeep about "special work"',
                icon: '🗝️',
                cost,
                description: known
                    ? 'Your guild contact waits: jobs, the fence and the black market'
                    : `Find a contact of the thieves' guild (${cost}g)`,
                available: known || (player.gold || 0) >= cost,
            });
        }

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
                // Drinking satisfies social and fun
                if (player.modifyNeed) {
                    player.modifyNeed('social', 15);
                    player.modifyNeed('fun', 10);
                    player.modifyNeed('comfort', 5);
                }
                return Tavern._buyDrinks(player, tile, world);
            case 'buy_meal':
                return Tavern._buyMeal(player, tile, world);
            case 'take_bath':
                return Tavern._takeBath(player, tile, world);
            case 'rest_at_inn':
                return Tavern._restAtInn(player, tile, world);
            case 'play_dice':
                return Tavern._playDice(player, tile, world);
            case 'ask_merchants':
                if (player.modifyNeed) player.modifyNeed('social', 8);
                return Tavern._askMerchants(player, tile, world);
            case 'ask_characters':
                if (player.modifyNeed) player.modifyNeed('social', 8);
                return Tavern._askCharacters(player, tile, world);
            case 'ask_military':
                if (player.modifyNeed) player.modifyNeed('social', 5);
                return Tavern._askMilitary(player, tile, world);
            case 'hire_informant':
                if (player.modifyNeed) player.modifyNeed('social', 5);
                return Tavern._hireInformant(player, tile, world);
            case 'rumor_board':
                if (player.modifyNeed) player.modifyNeed('fun', 5);
                return Tavern._checkRumorBoard(player, tile, world);
            case 'sell_soul':
                return Tavern._sellSoul(player, tile, world);
            case 'buy_tavern_map':
                return Tavern._buyTavernMap(player, tile, world);
            case 'ask_religious_lore':
                if (player.modifyNeed) player.modifyNeed('social', 5);
                return Tavern._askReligiousLore(player, tile, world);
            case 'listen_gossip':
                return Tavern._listenForGossip(player, tile, world);
            case 'underworld_contact': {
                const res = Underworld.meetContact(player, world, tile);
                return [{
                    category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                    icon: '🗝️',
                    title: 'The Back Room',
                    text: res.success ? res.text : res.reason,
                    reliability: Tavern.RELIABILITY.TAVERN_GOSSIP,
                    openUnderworld: !!res.success,
                }];
            }
            default:
                return [];
        }
    },

    // ────────────────────────────────────────────────────────────────────
    //  Needs-Satisfying Actions
    // ────────────────────────────────────────────────────────────────────
    /**
     * Buy a hot meal — restores hunger and provides comfort
     */
    _buyMeal(player, tile, world) {
        const cost = 8;
        player.gold -= cost;
        const meal = Peoples.mealBonus(tile.settlement);
        if (player.modifyNeed) {
            player.modifyNeed('hunger', 35);
            player.modifyNeed('comfort', 10 + meal.comfort);
            player.modifyNeed('energy', 5);
        }
        const dish = meal.dish || meal.hybridDish;
        return [{
            category: Tavern.CATEGORIES.RUMORS_GOSSIP,
            icon: '🍖',
            title: 'Hot Meal',
            text: dish
                ? `You dine on ${dish}, the local favourite at ${tile.settlement.name}${meal.hybridDish && meal.dish ? `, with a side of ${meal.hybridDish}` : ''}. A taste of home for the folk here — and a comfort to you (+${meal.comfort}).`
                : `You enjoy a hearty stew with bread and ale at ${tile.settlement.name}. Your belly is full and your spirits lifted.`,
            reliability: Tavern.RELIABILITY.TAVERN_GOSSIP,
            accurate: true,
            day: world.day,
            source: tile.settlement.name,
        }];
    },

    /**
     * Wash up at the basin — restores hygiene
     */
    _takeBath(player, tile, world) {
        const cost = 6;
        player.gold -= cost;
        if (player.modifyNeed) {
            player.modifyNeed('hygiene', 40);
            player.modifyNeed('comfort', 8);
        }
        return [{
            category: Tavern.CATEGORIES.RUMORS_GOSSIP,
            icon: '🧼',
            title: 'Washed Up',
            text: `You scrub the road dust off at the wash basin. You feel clean and refreshed.`,
            reliability: Tavern.RELIABILITY.TAVERN_GOSSIP,
            accurate: true,
            day: world.day,
            source: tile.settlement.name,
        }];
    },

    /**
     * Rest at the inn — restores energy and comfort, sets rest type override
     */
    _restAtInn(player, tile, world) {
        const cost = 15;
        player.gold -= cost;
        if (player.modifyNeed) {
            player.modifyNeed('energy', 50);
            player.modifyNeed('comfort', 30);
            player.modifyNeed('hunger', -10); // sleeping makes you hungry
        }
        // Mark for overnight rest quality
        player._restTypeOverride = 'inn';
        return [{
            category: Tavern.CATEGORIES.RUMORS_GOSSIP,
            icon: '🛏️',
            title: 'Well Rested',
            text: `You rent a private room at the inn in ${tile.settlement.name}. A real bed makes all the difference.`,
            reliability: Tavern.RELIABILITY.TAVERN_GOSSIP,
            accurate: true,
            day: world.day,
            source: tile.settlement.name,
        }];
    },

    /**
     * Play dice — fun and social, with a chance to win or lose gold
     */
    _playDice(player, tile, world) {
        const bet = 10;
        player.gold -= bet;

        // 45% win, 55% lose (house edge); a seasoned Gambler reads the table better
        const roll = Utils.random() - Traits.effect(player, 'gamblingLuck');
        Traits.recordDeed(player, 'gambling');
        let winnings = 0;
        let resultText = '';

        if (roll < 0.20) {
            // Big win
            winnings = bet * 3;
            resultText = `Lady Luck smiles on you! You win ${winnings} gold with a spectacular roll!`;
        } else if (roll < 0.45) {
            // Small win
            winnings = bet * 2;
            resultText = `A good round! You pocket ${winnings} gold.`;
        } else if (roll < 0.75) {
            // Lose
            resultText = `Bad luck — the dice weren't in your favor. You lose your ${bet} gold bet.`;
        } else {
            // Big loss (lose extra)
            const extraLoss = Math.min(player.gold, 5);
            player.gold -= extraLoss;
            resultText = `Terrible rolls! You lose your bet and ${extraLoss} extra gold in a double-or-nothing gone wrong.`;
        }

        if (winnings > 0) player.gold += winnings;

        if (player.modifyNeed) {
            player.modifyNeed('fun', 20);
            player.modifyNeed('social', 15);
            if (winnings > 0) player.modifyNeed('comfort', 5);
        }

        return [{
            category: Tavern.CATEGORIES.RUMORS_GOSSIP,
            icon: '🎲',
            title: winnings > 0 ? 'Dice — Winner!' : 'Dice — Unlucky',
            text: resultText,
            reliability: Tavern.RELIABILITY.TAVERN_GOSSIP,
            accurate: true,
            day: world.day,
            source: tile.settlement.name,
        }];
    },

    // ────────────────────────────────────────────────────────────────────
    //  Intel Gathering Actions
    // ────────────────────────────────────────────────────────────────────
    /**
     * Buy a round of drinks — hear random gossip
     */
    _buyDrinks(player, tile, world) {
        player.gold -= Tavern.DRINK_COST;
        Traits.recordDeeds(player, { drinking: 1.5, generosity: 0.5 }); // a round for the house
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
        if (Utils.random() < 0.5 && chosen.length > 0) {
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
        if (Utils.random() < 0.4 && withDist.length > 0) {
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
                const accurate = Utils.random() < reliability.accuracy;

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
            const accurate = Utils.random() < reliability.accuracy;
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
        Quests.track(player, 'informants_hired');

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

        // Talk of the sagas unfolding within earshot (systems/sagas.js)
        for (const s of Sagas.tavernRumors(player, world, tile)) {
            rumors.push({
                category: Tavern.CATEGORIES.KINGDOM_AFFAIRS,
                icon: s.icon,
                title: s.title,
                text: `${s.text} (Journal → Sagas)`,
                reliability: Tavern.RELIABILITY.TAVERN_GOSSIP,
                accurate: true,
                day: world.day,
                source: tile.settlement.name,
            });
        }

        Tavern._storeRumors(player, rumors);
        return rumors;
    },

    /**
     * Ask about religious lore — discover holy sites and extinct faiths
     */
    _askReligiousLore(player, tile, world) {
        player.gold -= Tavern.BRIBE_COST;
        Traits.recordDeed(player, 'learning');
        const rumors = [];

        if (!player.discoveredHolySites) player.discoveredHolySites = new Set();
        if (!player.discoveredExtinctFaiths) player.discoveredExtinctFaiths = new Set();

        // Find undiscovered holy sites
        const undiscoveredSites = [];
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const t = world.getTile(q, r);
                if (t && t.holySite && !player.discoveredHolySites.has(`${q},${r}`)) {
                    undiscoveredSites.push({ q, r, site: t.holySite });
                }
            }
        }

        // Reveal 1-3 holy sites, biased toward closer ones
        const revealCount = Math.min(undiscoveredSites.length, Utils.randInt(1, 3));
        const sorted = undiscoveredSites.sort((a, b) => {
            const dA = Hex.wrappingDistance(tile.q, tile.r, a.q, a.r, world.width);
            const dB = Hex.wrappingDistance(tile.q, tile.r, b.q, b.r, world.width);
            return dA - dB;
        });
        // Weight towards closer sites but allow distant ones
        const candidates = sorted.slice(0, Math.max(revealCount * 2, sorted.length));
        const revealed = Utils.shuffle(candidates).slice(0, revealCount);

        for (const hs of revealed) {
            player.discoveredHolySites.add(`${hs.q},${hs.r}`);
            rumors.push({
                category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                icon: hs.site.icon,
                title: `Holy Site Discovered: ${hs.site.name}`,
                text: `"There is a sacred place called ${hs.site.name} at (${hs.q}, ${hs.r}). ${hs.site.description}."`,
                reliability: Tavern.RELIABILITY.LOCAL_TALK,
                day: world.day,
            });

            // If associated with an extinct faith, discover that too
            if (hs.site.faithId && Religion.FAITHS[hs.site.faithId]?.extinct) {
                const faith = Religion.FAITHS[hs.site.faithId];
                if (player.discoverExtinctFaith(faith.id)) {
                    rumors.push({
                        category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                        icon: faith.icon,
                        title: `Ancient Faith Uncovered: ${faith.name}`,
                        text: `"The site was sacred to the followers of ${faith.name}, a faith that vanished around year ${faith.extinctYear}. ${faith.description}."`,
                        reliability: Tavern.RELIABILITY.LOCAL_TALK,
                        day: world.day,
                    });
                }
            }
        }

        // Also chance to discover extinct faiths not tied to known holy sites
        const undiscoveredFaiths = Object.values(Religion.FAITHS).filter(f => f.extinct && !player.discoveredExtinctFaiths.has(f.id));
        if (undiscoveredFaiths.length > 0 && Utils.random() < 0.5) {
            const faith = Utils.randPick(undiscoveredFaiths);
            if (player.discoverExtinctFaith(faith.id)) {
                rumors.push({
                    category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                    icon: faith.icon,
                    title: `Ancient Faith Uncovered: ${faith.name}`,
                    text: `An elderly scholar whispers: "Long ago, the ${faith.name} held sway. Founded in year ${faith.founded}, it perished by ${faith.extinctYear}. ${faith.description}."`,
                    reliability: Tavern.RELIABILITY.LOCAL_TALK,
                    day: world.day,
                });
            }
        }

        if (rumors.length === 0) {
            rumors.push({
                category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                icon: '⛲',
                title: 'Nothing New',
                text: '"I\'ve told you everything I know about the sacred places of this land. Perhaps try exploring further afield."',
                reliability: 1.0,
                day: world.day,
            });
        }

        Tavern._storeRumors(player, rumors);
        return rumors;
    },

    /**
     * Listen for gossip about your crimes — shows what people are saying about you
     */
    _listenForGossip(player, tile, world) {
        const gossipItems = Gossip.getTavernGossip(player, tile.q, tile.r, world);
        const rumors = [];

        if (gossipItems.length === 0) {
            rumors.push({
                category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                icon: '👂',
                title: 'No Gossip',
                text: '"Nobody seems to be talking about you here."',
                reliability: 1.0,
                day: world.day,
            });
        } else {
            for (const item of gossipItems) {
                let text = `"${item.text}"`;
                if (item.hasBounty) {
                    text += ` (Bounty: ${item.bountyGold}g)`;
                }
                rumors.push({
                    category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                    icon: item.icon || '🗣️',
                    title: `${item.freshness}: ${item.hasBounty ? '⚠️ ' : ''}Crime Rumor`,
                    text,
                    reliability: Tavern.RELIABILITY.TAVERN_GOSSIP,
                    day: world.day,
                });
            }

            // Show notoriety summary
            const notoriety = Gossip.getPlayerNotoriety(player);
            if (notoriety.totalBounty > 0) {
                rumors.push({
                    category: Tavern.CATEGORIES.RUMORS_GOSSIP,
                    icon: '💰',
                    title: `Your Notoriety: ${notoriety.notoriety}`,
                    text: `Total bounty on your head: ${notoriety.totalBounty}g across ${notoriety.activeBounties} jurisdiction${notoriety.activeBounties !== 1 ? 's' : ''}.`,
                    reliability: 1.0,
                    day: world.day,
                });
            }
        }

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
        Traits.recordDeed(player, 'greed', 2); // a soul for a handful of coin

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
});
