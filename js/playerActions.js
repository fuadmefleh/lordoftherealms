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
        }

        // 3. Building / Property Actions
        // Can build if tile is empty (no settlement, no existing property)
        // And terrain is valid (not water, etc. - checked in PlayerEconomy really, but roughly here)
        if (!tile.settlement && !tile.playerProperty && !tile.structure && !tile.improvement && tile.terrain.passable) {
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
        if (!tile.settlement && !tile.playerProperty && !tile.improvement && tile.terrain.passable) {
            actions.push({
                type: 'build_temple',
                label: 'Build Temple',
                icon: '⛩️',
                description: 'Construct a place of worship'
            });
        }

        // 5. Property Interaction
        if (tile.playerProperty) {
            // Collect goods if storage > 0
            if (tile.playerProperty.storage && tile.playerProperty.storage > 0) {
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
    }
};
