// ============================================
// PLAYER ACTIONS — Contextual actions
// ============================================

const PlayerActions = {
    /**
     * Get available actions for a specific tile
     */
    getAvailableActions(player, tile, world) {
        const actions = [];

        // 1. Rest (always available)
        actions.push({
            type: 'rest',
            label: 'Rest / Camp',
            icon: '⛺',
            description: 'Recover stamina and wait for the next day'
        });

        const isSettlement = !!tile.settlement;
        const isCity = isSettlement && (tile.settlement.type === 'town' || tile.settlement.type === 'capital');
        const isVillage = isSettlement && tile.settlement.type === 'village';

        // 2. Settlement Actions
        if (isSettlement) {
            // Trade
            actions.push({
                type: 'trade',
                label: 'Trade Goods',
                icon: '⚖️',
                description: 'Buy and sell resources'
            });

            // Recruit
            if (isCity) {
                actions.push({
                    type: 'recruit',
                    label: 'Recruit Units',
                    icon: '⚔️',
                    description: 'Hire soldiers for your army'
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
            }

            // Preach
            actions.push({
                type: 'preach',
                label: 'Preach',
                icon: '🙏',
                description: 'Spread your faith and gain followers'
            });

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
            }
        }

        // 3. Building / Property Actions
        // Can build if tile is empty (no settlement, no existing property)
        // And terrain is valid (not water, etc. - checked in PlayerEconomy really, but roughly here)
        if ((!tile.settlement || tile.settlement.type) && !tile.playerProperty && !tile.structure && !tile.improvement && tile.terrain.passable) {
            actions.push({
                type: 'build_property',
                label: 'Build Property',
                icon: '🏗️',
                description: 'Construct a resource gathering building'
            });
        }

        // 4. Religious Actions
        // Build Temple (needs empty spot or inside own settlement?)
        // Let's say we can build temples in empty spots too, or perhaps specific spots.
        // For now, allow on empty tiles if player has a religion
        if ((!tile.settlement || tile.settlement.type) && !tile.playerProperty && !tile.improvement && tile.terrain.passable) {
            actions.push({
                type: 'build_temple',
                label: 'Build Temple',
                icon: '⛩️',
                description: 'Construct a place of worship'
            });
        }

        // 5. Property Interaction
        if (tile.playerProperty) {
            // Manage Action (covers collecting, upgrading, shipping)
            actions.push({
                type: 'manage_property',
                label: 'Manage Property',
                icon: '🛠️',
                description: 'Collect goods, upgrade, or send caravans'
            });

            // Collect goods shortcut (keep if convenient, or remove to force using manage)
            if (tile.playerProperty.produces && tile.playerProperty.storage && tile.playerProperty.storage > 0) {
                actions.push({
                    type: 'collect_goods',
                    label: 'Collect Goods',
                    icon: '📦',
                    description: `Collect stored ${tile.playerProperty.produces}`
                });
            }
        }

        // 6. Miracles (Global/Self action really, but put here if high karma?)
        if (player.karma >= 10) {
            actions.push({
                type: 'miracle',
                label: 'Perform Miracle',
                icon: '✨',
                description: 'Use karma to invoke divine intervention'
            });
        }

        return actions;
    },
    /**
     * Process end of day for player
     */
    endDay(player, world) {
        const results = {
            production: {},     // New production
            faithIncome: 0,
            upkeepCost: 0,
            caravansCompleted: [],
            contractUpdate: null,
            followersGained: 0,
            blessingsExpired: [],
        };

        // Produce goods from properties
        results.production = PlayerEconomy.produceGoods(player, world);

        // Collect faith income
        results.faithIncome = PlayerReligion.collectFaithIncome(player);

        // Pay army upkeep
        const upkeep = PlayerMilitary.payUpkeep(player);
        results.upkeepCost = upkeep.cost || 0;
        results.unitsLost = upkeep.unitsLost || 0;

        // Update caravans
        results.caravansCompleted = PlayerEconomy.updateCaravans(player, world);

        // Update contract
        results.contractUpdate = PlayerMilitary.updateContract(player);

        // Spread faith
        results.followersGained = PlayerReligion.spreadFaith(player, world);

        // Update blessings
        results.blessingsExpired = PlayerReligion.updateBlessings(player);

        return results;
    },
};
