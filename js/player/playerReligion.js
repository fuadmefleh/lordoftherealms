// ============================================
// PLAYER RELIGION — Religious path systems
// ============================================

const PlayerReligion = {
    /**
     * Religious building types
     */
    BUILDING_TYPES: {
        SHRINE: {
            id: 'shrine',
            name: 'Shrine',
            icon: '⛩️',
            cost: 300,
            constructionDays: 3,
            faithGain: 5,
            influenceRadius: 3,
            description: 'Small place of worship, spreads faith locally'
        },
        TEMPLE: {
            id: 'temple',
            name: 'Temple',
            icon: '🛕',
            cost: 1000,
            constructionDays: 12,
            faithGain: 15,
            influenceRadius: 5,
            description: 'Grand temple, attracts many followers'
        },
        MONASTERY: {
            id: 'monastery',
            name: 'Monastery',
            icon: '🏛️',
            cost: 800,
            constructionDays: 9,
            faithGain: 10,
            influenceRadius: 4,
            karmaBonus: 2,
            description: 'Peaceful retreat, generates karma and faith'
        },
    },

    /**
     * Found a new religion
     */
    foundReligion(player, religionName, tenets) {
        if (player.karma < 10) {
            return { success: false, reason: 'Need at least 10 karma to found a religion' };
        }

        if (player.religion) {
            return { success: false, reason: 'Already founded a religion' };
        }

        player.religion = {
            name: religionName,
            tenets: tenets || ['Peace', 'Charity', 'Wisdom'],
            followers: 0,
            buildings: [],
            influence: 0,
            founded: true,
        };

        // Increase faith attribute
        player.faith = Math.min(10, player.faith + 2);

        return { success: true, religion: player.religion };
    },

    /**
     * Build a religious building
     */
    buildReligiousBuilding(player, buildingType, tile, world) {
        if (!player.religion) {
            return { success: false, reason: 'Must found a religion first' };
        }

        const building = PlayerReligion.BUILDING_TYPES[buildingType.toUpperCase()];
        if (!building) return { success: false, reason: 'Invalid building type' };

        // Check gold
        if (player.gold < building.cost) {
            return { success: false, reason: `Need ${building.cost} gold (have ${player.gold})` };
        }

        // Check if tile is suitable
        if (!tile.terrain.passable) {
            return { success: false, reason: 'Cannot build on this terrain' };
        }

        if (tile.playerProperty || tile.religiousBuilding) {
            return { success: false, reason: 'Tile already has a building' };
        }

        player.gold -= building.cost;

        // Create building
        const constructionDays = building.constructionDays || 0;
        tile.religiousBuilding = {
            type: building.id,
            name: building.name,
            icon: building.icon,
            religion: player.religion.name,
            faithGain: building.faithGain,
            influenceRadius: building.influenceRadius,
            karmaBonus: building.karmaBonus || 0,
            followers: 0,
            level: 1,
            underConstruction: constructionDays > 0,
            constructionDaysLeft: constructionDays,
            constructionDaysTotal: constructionDays,
        };

        // Add to player's buildings list
        player.religion.buildings.push({
            q: tile.q,
            r: tile.r,
            type: building.id,
        });

        // Increase faith
        player.faith = Math.min(10, player.faith + 0.5);

        return { success: true, building: tile.religiousBuilding, underConstruction: constructionDays > 0, constructionDays };
    },

    /**
     * Spread faith from religious buildings
     */
    spreadFaith(player, world) {
        if (!player.religion || player.religion.buildings.length === 0) return 0;

        let totalFollowersGained = 0;

        for (const buildingRef of player.religion.buildings) {
            const tile = world.getTile(buildingRef.q, buildingRef.r);
            if (!tile || !tile.religiousBuilding) continue;

            const building = tile.religiousBuilding;
            if (building.underConstruction) continue; // Still being built
            const hexes = Hex.hexesInRange(buildingRef.q, buildingRef.r, building.influenceRadius);

            for (const hex of hexes) {
                const nearbyTile = world.getTile(hex.q, hex.r);
                if (!nearbyTile || !nearbyTile.settlement) continue;

                // Convert some population to followers
                const conversionRate = 0.01 * (1 + player.faith * 0.1);
                const newFollowers = Math.floor(nearbyTile.settlement.population * conversionRate);

                building.followers += newFollowers;
                totalFollowersGained += newFollowers;
            }

            // Gain karma from monasteries
            if (building.karmaBonus) {
                player.karma += building.karmaBonus;
            }
        }

        player.religion.followers += totalFollowersGained;
        player.religion.influence = Math.floor(player.religion.followers / 100);

        return totalFollowersGained;
    },

    /**
     * Perform a miracle (costs karma, grants benefits)
     */
    MIRACLES: {
        HEALING: {
            id: 'healing',
            name: 'Divine Healing',
            icon: '✨',
            karmaCost: 10,
            effect: 'Restore full health',
            description: 'Invoke divine power to heal all wounds'
        },
        BLESSING: {
            id: 'blessing',
            name: 'Blessing of Prosperity',
            icon: '🌟',
            karmaCost: 15,
            effect: 'Double income for 5 days',
            description: 'Bless your properties with prosperity'
        },
        PROTECTION: {
            id: 'protection',
            name: 'Divine Protection',
            icon: '🛡️',
            karmaCost: 20,
            effect: 'Invulnerable for 3 days',
            description: 'Shield yourself from harm'
        },
        CONVERSION: {
            id: 'conversion',
            name: 'Mass Conversion',
            icon: '🙏',
            karmaCost: 25,
            effect: 'Gain 1000 followers instantly',
            description: 'Convert many to your faith at once'
        },
    },

    /**
     * Perform a miracle
     */
    performMiracle(player, miracleType) {
        if (!player.religion) {
            return { success: false, reason: 'Must found a religion first' };
        }

        const miracle = PlayerReligion.MIRACLES[miracleType.toUpperCase()];
        if (!miracle) return { success: false, reason: 'Invalid miracle' };

        if (player.karma < miracle.karmaCost) {
            return { success: false, reason: `Need ${miracle.karmaCost} karma (have ${player.karma})` };
        }

        player.karma -= miracle.karmaCost;

        // Apply miracle effect
        let result = { success: true, miracle };

        switch (miracle.id) {
            case 'healing':
                player.health = player.maxHealth;
                result.effect = 'Health fully restored!';
                break;

            case 'blessing':
                player.blessings = player.blessings || {};
                player.blessings.prosperity = 5; // 5 days
                result.effect = 'Income doubled for 5 days!';
                break;

            case 'protection':
                player.blessings = player.blessings || {};
                player.blessings.protection = 3; // 3 days
                result.effect = 'Protected from harm for 3 days!';
                break;

            case 'conversion':
                player.religion.followers += 1000;
                player.religion.influence = Math.floor(player.religion.followers / 100);
                result.effect = 'Gained 1000 followers!';
                break;
        }

        // Increase faith
        player.faith = Math.min(10, player.faith + 0.3);

        return result;
    },

    /**
     * Update blessings (called daily)
     */
    updateBlessings(player) {
        if (!player.blessings) return;

        const expired = [];

        for (const [blessing, days] of Object.entries(player.blessings)) {
            player.blessings[blessing]--;
            if (player.blessings[blessing] <= 0) {
                delete player.blessings[blessing];
                expired.push(blessing);
            }
        }

        return expired;
    },

    /**
     * Preach at a settlement (gain followers and karma)
     */
    preach(player, settlement, tile) {
        if (!player.religion) {
            return { success: false, reason: 'Must found a religion first' };
        }

        // Charisma affects preaching effectiveness
        const effectiveness = 1 + player.charisma * 0.1 + player.faith * 0.1;
        const followersGained = Math.floor(settlement.population * 0.05 * effectiveness);

        player.religion.followers += followersGained;
        player.religion.influence = Math.floor(player.religion.followers / 100);

        // Gain karma
        const karmaGained = Math.floor(followersGained / 50);
        player.karma += karmaGained;

        // Increase faith and charisma
        player.faith = Math.min(10, player.faith + 0.2);
        player.charisma = Math.min(10, player.charisma + 0.1);

        return {
            success: true,
            followersGained,
            karmaGained,
            totalFollowers: player.religion.followers,
        };
    },

    /**
     * Get faith income from followers
     */
    getFaithIncome(player) {
        if (!player.religion) return 0;

        // Followers donate to the faith
        const income = Math.floor(player.religion.followers * 0.01);
        return income;
    },

    /**
     * Collect faith income
     */
    collectFaithIncome(player) {
        const income = PlayerReligion.getFaithIncome(player);
        player.gold += income;
        return income;
    },

    /**
     * Get total religious influence
     */
    getInfluence(player) {
        if (!player.religion) return 0;
        return player.religion.influence;
    },
};

