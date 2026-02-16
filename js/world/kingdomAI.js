// ============================================
// KINGDOM AI — Kingdom behavior and simulation
// ============================================

const KingdomAI = {
    /**
     * AI personalities that affect behavior
     */
    PERSONALITIES: {
        militaristic: { expansionChance: 0.3, warChance: 0.4, tradeChance: 0.2 },
        peaceful: { expansionChance: 0.1, warChance: 0.05, tradeChance: 0.5 },
        mercantile: { expansionChance: 0.15, warChance: 0.1, tradeChance: 0.6 },
        aggressive: { expansionChance: 0.4, warChance: 0.5, tradeChance: 0.1 },
        balanced: { expansionChance: 0.2, warChance: 0.2, tradeChance: 0.3 },
    },

    /**
     * Get AI personality from kingdom traits
     */
    getPersonality(kingdom) {
        if (kingdom.traits.includes('militaristic') || kingdom.traits.includes('aggressive')) {
            return KingdomAI.PERSONALITIES.aggressive;
        }
        if (kingdom.traits.includes('peaceful')) {
            return KingdomAI.PERSONALITIES.peaceful;
        }
        if (kingdom.traits.includes('mercantile') || kingdom.traits.includes('naval')) {
            return KingdomAI.PERSONALITIES.mercantile;
        }
        return KingdomAI.PERSONALITIES.balanced;
    },

    /**
     * Process AI turn for a kingdom
     */
    processTurn(kingdom, world) {
        if (!kingdom.isAlive) return;

        const personality = KingdomAI.getPersonality(kingdom);

        // Update kingdom economy
        KingdomAI.updateEconomy(kingdom, world);

        // Consider expansion
        if (Math.random() < personality.expansionChance) {
            KingdomAI.tryExpand(kingdom, world);
        }

        // Consider establishing trade routes
        if (Math.random() < personality.tradeChance) {
            TradeRoutes.establishRoutes(kingdom, world);
        }

        // Consider diplomatic actions
        if (Math.random() < 0.3) {
            KingdomAI.considerDiplomacy(kingdom, world);
        }

        // Consider war
        if (Math.random() < personality.warChance) {
            KingdomAI.considerWar(kingdom, world);
        }

        // Update military strength
        KingdomAI.updateMilitary(kingdom, world);
    },

    /**
     * Update kingdom economy from all settlements
     */
    updateEconomy(kingdom, world) {
        let totalGold = 0;
        let totalFood = 0;
        let totalGoods = 0;
        let totalPopulation = 0;

        const settlements = world.getAllSettlements().filter(s => s.kingdom === kingdom.id);

        for (const settlement of settlements) {
            const tile = world.getTile(settlement.q, settlement.r);
            if (!tile) continue;

            // Process daily production
            Economy.produceDaily(settlement, tile, world);

            // Process trade
            Economy.processTrade(settlement);

            // Accumulate totals
            if (settlement.economy) {
                totalGold += settlement.economy.gold;
                totalFood += settlement.economy.food;
                totalGoods += settlement.economy.goods;
            }
            totalPopulation += settlement.population;
        }

        // Update kingdom totals
        kingdom.treasury = totalGold;
        kingdom.population = totalPopulation;
        kingdom.food = totalFood;
        kingdom.goods = totalGoods;

        // Apply character bonuses to treasury
        if (kingdom.characterBonuses) {
            const b = kingdom.characterBonuses;
            if (b.treasury) kingdom.treasury = Math.floor(kingdom.treasury * (1 + b.treasury));
            if (b.population) kingdom.population = Math.floor(kingdom.population * (1 + b.population));
        }
    },

    /**
     * Try to expand territory
     */
    tryExpand(kingdom, world) {
        if (!kingdom.capital) return;

        // Find border tiles
        const borderTiles = [];
        for (const hex of kingdom.territory) {
            const neighbors = Hex.neighbors(hex.q, hex.r);
            for (const n of neighbors) {
                const tile = world.getTile(n.q, n.r);
                if (tile && tile.terrain.passable && !tile.kingdom) {
                    // Check if not already in list
                    const key = `${n.q},${n.r}`;
                    if (!borderTiles.some(t => `${t.q},${t.r}` === key)) {
                        borderTiles.push({ q: n.q, r: n.r, tile });
                    }
                }
            }
        }

        if (borderTiles.length === 0) return;

        // Claim a random border tile
        const target = Utils.randPick(borderTiles);
        target.tile.kingdom = kingdom.id;
        kingdom.territory.push({ q: target.q, r: target.r });

        // Small chance to found a new settlement
        if (Math.random() < 0.1 && !target.tile.settlement) {
            target.tile.settlement = {
                type: 'village',
                name: Kingdom.generateCityName(kingdom.culture),
                population: Utils.randInt(100, 500),
                level: 0,
                kingdom: kingdom.id,
            };
            Economy.initSettlement(target.tile.settlement);
        }
    },

    /**
     * Consider diplomatic actions
     */
    considerDiplomacy(kingdom, world) {
        const otherKingdoms = world.kingdoms.filter(k => k.isAlive && k.id !== kingdom.id);
        if (otherKingdoms.length === 0) return;

        const target = Utils.randPick(otherKingdoms);
        const currentRelation = kingdom.relations[target.id] || 0;

        // Improve or worsen relations based on various factors
        let change = Utils.randInt(-5, 10);
        // Character diplomacy bonus
        if (kingdom.characterBonuses && kingdom.characterBonuses.diplomacy) {
            change += Math.floor(kingdom.characterBonuses.diplomacy * 10);
        }
        // Religious compatibility: same faith → +5, different militant faiths → penalty
        if (typeof Religion !== 'undefined') {
            change += Math.floor(Religion.faithCompatibility(kingdom, target) * 0.3);
        }
        kingdom.relations[target.id] = Utils.clamp(currentRelation + change, -100, 100);

        // Form alliance if relations are very good
        if (kingdom.relations[target.id] > 70 && !kingdom.allies.includes(target.id)) {
            kingdom.allies.push(target.id);
            target.allies.push(kingdom.id);

            world.events.push({
                text: `${kingdom.name} and ${target.name} have formed an alliance!`,
                type: 'diplomatic'
            });
        }

        // Break alliance if relations deteriorate
        if (kingdom.relations[target.id] < 30 && kingdom.allies.includes(target.id)) {
            kingdom.allies = kingdom.allies.filter(id => id !== target.id);
            target.allies = target.allies.filter(id => id !== kingdom.id);

            world.events.push({
                text: `The alliance between ${kingdom.name} and ${target.name} has dissolved.`,
                type: 'diplomatic'
            });
        }
    },

    /**
     * Consider declaring war
     */
    considerWar(kingdom, world) {
        const otherKingdoms = world.kingdoms.filter(k =>
            k.isAlive &&
            k.id !== kingdom.id &&
            !kingdom.allies.includes(k.id) &&
            !kingdom.wars.includes(k.id)
        );

        if (otherKingdoms.length === 0) return;

        // Find kingdoms with poor relations
        const enemies = otherKingdoms.filter(k => (kingdom.relations[k.id] || 0) < -30);
        if (enemies.length === 0) return;

        const target = Utils.randPick(enemies);

        // Only declare war if we're stronger or desperate
        const ourStrength = kingdom.military + kingdom.population * 0.1;
        const theirStrength = target.military + target.population * 0.1;

        if (ourStrength > theirStrength * 0.8 || Math.random() < 0.1) {
            kingdom.wars.push(target.id);
            target.wars.push(kingdom.id);

            world.events.push({
                text: `⚔️ ${kingdom.name} has declared war on ${target.name}!`,
                type: 'military'
            });

            // Worsen relations
            kingdom.relations[target.id] = -100;
            target.relations[kingdom.id] = -100;
        }
    },

    /**
     * Update military strength based on population and resources
     */
    updateMilitary(kingdom, world) {
        // Base military from population (5% of population)
        let military = Math.floor(kingdom.population * 0.05);

        // Bonus from iron and horses
        const settlements = world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
        for (const settlement of settlements) {
            const tile = world.getTile(settlement.q, settlement.r);
            if (!tile) continue;

            const nearbyResources = Economy.getNearbyResources(settlement.q, settlement.r, world, 2);
            for (const res of nearbyResources) {
                if (res.id === 'iron') military *= 1.2;
                if (res.id === 'horses') military *= 1.15;
            }
        }

        // Apply character bonuses to military
        if (kingdom.characterBonuses) {
            const b = kingdom.characterBonuses;
            if (b.military) military *= (1 + b.military);
        }

        kingdom.military = Math.floor(military);
    },

    /**
     * Process warfare between kingdoms
     */
    processWars(world) {
        const activeWars = [];

        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive) continue;

            for (const enemyId of kingdom.wars) {
                const enemy = world.getKingdom(enemyId);
                if (!enemy || !enemy.isAlive) continue;

                // Avoid processing the same war twice
                const warKey = [kingdom.id, enemyId].sort().join('_');
                if (activeWars.includes(warKey)) continue;
                activeWars.push(warKey);

                // Simulate battle
                KingdomAI.simulateBattle(kingdom, enemy, world);
            }
        }
    },

    /**
     * Simulate a battle between two kingdoms
     */
    simulateBattle(attacker, defender, world) {
        const attackPower = attacker.military * Utils.randFloat(0.8, 1.2);
        const defensePower = defender.military * Utils.randFloat(0.8, 1.2);

        // Determine winner
        if (attackPower > defensePower) {
            // Attacker wins - steal territory
            if (defender.territory.length > 0) {
                const stolenTile = Utils.randPick(defender.territory);
                const tile = world.getTile(stolenTile.q, stolenTile.r);

                if (tile) {
                    tile.kingdom = attacker.id;
                    attacker.territory.push(stolenTile);
                    defender.territory = defender.territory.filter(t =>
                        t.q !== stolenTile.q || t.r !== stolenTile.r
                    );

                    // If settlement was captured, change ownership
                    if (tile.settlement && tile.settlement.kingdom === defender.id) {
                        tile.settlement.kingdom = attacker.id;
                    }
                }

                // Reduce defender military
                defender.military = Math.floor(defender.military * 0.9);
                attacker.military = Math.floor(attacker.military * 0.95);

                // Check if defender is defeated
                if (defender.territory.length === 0) {
                    defender.isAlive = false;
                    world.events.push({
                        text: `💀 ${defender.name} has been conquered by ${attacker.name}!`,
                        type: 'military'
                    });

                    // End all wars involving the defeated kingdom
                    attacker.wars = attacker.wars.filter(id => id !== defender.id);
                }
            }
        } else {
            // Defender wins - attacker loses military
            attacker.military = Math.floor(attacker.military * 0.85);
            defender.military = Math.floor(defender.military * 0.95);

            // Small chance war ends
            if (Math.random() < 0.2) {
                attacker.wars = attacker.wars.filter(id => id !== defender.id);
                defender.wars = defender.wars.filter(id => id !== attacker.id);

                world.events.push({
                    text: `Peace treaty signed between ${attacker.name} and ${defender.name}.`,
                    type: 'diplomatic'
                });
            }
        }
    },
};
