// ============================================
// WORLD EVENTS — Dynamic event system
// ============================================

const WorldEvents = {
    /**
     * Event categories
     */
    CATEGORIES: {
        POLITICAL: 'political',
        ECONOMIC: 'economic',
        MILITARY: 'military',
        NATURAL: 'natural',
        RELIGIOUS: 'religious',
    },

    /**
     * Generate random world events
     */
    generateEvents(world) {
        const events = [];

        // Political events (30% chance)
        if (Math.random() < 0.3) {
            const politicalEvent = WorldEvents.generatePoliticalEvent(world);
            if (politicalEvent) events.push(politicalEvent);
        }

        // Economic events (20% chance)
        if (Math.random() < 0.2) {
            const economicEvent = WorldEvents.generateEconomicEvent(world);
            if (economicEvent) events.push(economicEvent);
        }

        // Military events (15% chance)
        if (Math.random() < 0.15) {
            const militaryEvent = WorldEvents.generateMilitaryEvent(world);
            if (militaryEvent) events.push(militaryEvent);
        }

        // Natural disasters (10% chance)
        if (Math.random() < 0.1) {
            const naturalEvent = WorldEvents.generateNaturalEvent(world);
            if (naturalEvent) events.push(naturalEvent);
        }

        // Religious events (15% chance)
        if (Math.random() < 0.15) {
            const religiousEvent = WorldEvents.generateReligiousEvent(world);
            if (religiousEvent) events.push(religiousEvent);
        }

        return events;
    },

    /**
     * Generate political events
     */
    generatePoliticalEvent(world) {
        const livingKingdoms = world.kingdoms.filter(k => k.isAlive);
        if (livingKingdoms.length === 0) return null;

        const eventTypes = [
            'succession',
            'rebellion',
            'coronation',
            'scandal',
            'reform',
        ];

        const type = Utils.randPick(eventTypes);
        const kingdom = Utils.randPick(livingKingdoms);

        switch (type) {
            case 'succession':
                const oldRuler = kingdom.ruler;
                kingdom.ruler = Kingdom.generateRulerName(kingdom.culture);
                return {
                    category: WorldEvents.CATEGORIES.POLITICAL,
                    text: `${kingdom.name}: ${oldRuler} has died. ${kingdom.ruler} ascends to the throne.`,
                    kingdom: kingdom.id,
                    impact: 'neutral',
                };

            case 'rebellion':
                // Small rebellion reduces population
                const settlement = Utils.randPick(kingdom.settlements);
                if (settlement) {
                    const tile = world.getTile(settlement.q, settlement.r);
                    if (tile && tile.settlement) {
                        tile.settlement.population = Math.floor(tile.settlement.population * 0.9);
                        return {
                            category: WorldEvents.CATEGORIES.POLITICAL,
                            text: `${kingdom.name}: Rebellion in ${settlement.name}! Population reduced.`,
                            kingdom: kingdom.id,
                            impact: 'negative',
                        };
                    }
                }
                break;

            case 'coronation':
                return {
                    category: WorldEvents.CATEGORIES.POLITICAL,
                    text: `${kingdom.name}: Grand coronation ceremony for ${kingdom.ruler}. Morale boosted!`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };

            case 'scandal':
                kingdom.treasury = Math.floor(kingdom.treasury * 0.9);
                return {
                    category: WorldEvents.CATEGORIES.POLITICAL,
                    text: `${kingdom.name}: Political scandal rocks the court. Treasury reduced.`,
                    kingdom: kingdom.id,
                    impact: 'negative',
                };

            case 'reform':
                kingdom.treasury += 500;
                return {
                    category: WorldEvents.CATEGORIES.POLITICAL,
                    text: `${kingdom.name}: ${kingdom.ruler} enacts reforms. Economy improves!`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };
        }

        return null;
    },

    /**
     * Generate economic events
     */
    generateEconomicEvent(world) {
        const livingKingdoms = world.kingdoms.filter(k => k.isAlive);
        if (livingKingdoms.length === 0) return null;

        const eventTypes = [
            'boom',
            'recession',
            'trade_deal',
            'market_crash',
            'discovery',
        ];

        const type = Utils.randPick(eventTypes);
        const kingdom = Utils.randPick(livingKingdoms);

        switch (type) {
            case 'boom':
                kingdom.treasury += 1000;
                return {
                    category: WorldEvents.CATEGORIES.ECONOMIC,
                    text: `${kingdom.name}: Economic boom! Treasury increased by 1000 gold.`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };

            case 'recession':
                kingdom.treasury = Math.floor(kingdom.treasury * 0.8);
                return {
                    category: WorldEvents.CATEGORIES.ECONOMIC,
                    text: `${kingdom.name}: Economic recession. Treasury reduced by 20%.`,
                    kingdom: kingdom.id,
                    impact: 'negative',
                };

            case 'trade_deal':
                const partner = Utils.randPick(livingKingdoms.filter(k => k.id !== kingdom.id));
                if (partner) {
                    kingdom.treasury += 500;
                    partner.treasury += 500;
                    kingdom.relations[partner.id] = Math.min(100, (kingdom.relations[partner.id] || 0) + 10);
                    partner.relations[kingdom.id] = Math.min(100, (partner.relations[kingdom.id] || 0) + 10);
                    return {
                        category: WorldEvents.CATEGORIES.ECONOMIC,
                        text: `${kingdom.name} and ${partner.name} sign lucrative trade agreement.`,
                        kingdoms: [kingdom.id, partner.id],
                        impact: 'positive',
                    };
                }
                break;

            case 'market_crash':
                for (const k of livingKingdoms) {
                    k.treasury = Math.floor(k.treasury * 0.9);
                }
                return {
                    category: WorldEvents.CATEGORIES.ECONOMIC,
                    text: `Global market crash! All kingdoms lose 10% of their treasuries.`,
                    impact: 'negative',
                };

            case 'discovery':
                const settlement = Utils.randPick(kingdom.settlements);
                if (settlement) {
                    kingdom.treasury += 800;
                    return {
                        category: WorldEvents.CATEGORIES.ECONOMIC,
                        text: `${kingdom.name}: Rich mineral deposit discovered near ${settlement.name}!`,
                        kingdom: kingdom.id,
                        impact: 'positive',
                    };
                }
                break;
        }

        return null;
    },

    /**
     * Generate military events
     */
    generateMilitaryEvent(world) {
        const livingKingdoms = world.kingdoms.filter(k => k.isAlive);
        if (livingKingdoms.length === 0) return null;

        const eventTypes = [
            'training',
            'desertion',
            'recruitment_drive',
            'military_parade',
        ];

        const type = Utils.randPick(eventTypes);
        const kingdom = Utils.randPick(livingKingdoms);

        switch (type) {
            case 'training':
                kingdom.military = Math.floor(kingdom.military * 1.1);
                return {
                    category: WorldEvents.CATEGORIES.MILITARY,
                    text: `${kingdom.name}: Military training exercises. Army strength increased!`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };

            case 'desertion':
                kingdom.military = Math.floor(kingdom.military * 0.9);
                return {
                    category: WorldEvents.CATEGORIES.MILITARY,
                    text: `${kingdom.name}: Mass desertion! Military strength reduced.`,
                    kingdom: kingdom.id,
                    impact: 'negative',
                };

            case 'recruitment_drive':
                const increase = Math.floor(kingdom.population * 0.01);
                kingdom.military += increase;
                return {
                    category: WorldEvents.CATEGORIES.MILITARY,
                    text: `${kingdom.name}: Successful recruitment drive. +${increase} military strength.`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };

            case 'military_parade':
                return {
                    category: WorldEvents.CATEGORIES.MILITARY,
                    text: `${kingdom.name}: Grand military parade in the capital. Citizens impressed!`,
                    kingdom: kingdom.id,
                    impact: 'neutral',
                };
        }

        return null;
    },

    /**
     * Generate natural disaster events
     */
    generateNaturalEvent(world) {
        const livingKingdoms = world.kingdoms.filter(k => k.isAlive);
        if (livingKingdoms.length === 0) return null;

        const eventTypes = [
            'plague',
            'famine',
            'flood',
            'earthquake',
            'drought',
            'bountiful_harvest',
        ];

        const type = Utils.randPick(eventTypes);
        const kingdom = Utils.randPick(livingKingdoms);

        switch (type) {
            case 'plague':
                const settlement = Utils.randPick(kingdom.settlements);
                if (settlement) {
                    const tile = world.getTile(settlement.q, settlement.r);
                    if (tile && tile.settlement) {
                        tile.settlement.population = Math.floor(tile.settlement.population * 0.7);
                        kingdom.population = Math.floor(kingdom.population * 0.9);
                        return {
                            category: WorldEvents.CATEGORIES.NATURAL,
                            text: `${kingdom.name}: Plague strikes ${settlement.name}! Population devastated.`,
                            kingdom: kingdom.id,
                            impact: 'negative',
                        };
                    }
                }
                break;

            case 'famine':
                kingdom.population = Math.floor(kingdom.population * 0.95);
                kingdom.treasury = Math.floor(kingdom.treasury * 0.9);
                return {
                    category: WorldEvents.CATEGORIES.NATURAL,
                    text: `${kingdom.name}: Famine spreads across the land. Population and treasury reduced.`,
                    kingdom: kingdom.id,
                    impact: 'negative',
                };

            case 'flood':
                const floodSettlement = Utils.randPick(kingdom.settlements);
                if (floodSettlement) {
                    kingdom.treasury = Math.floor(kingdom.treasury * 0.85);
                    return {
                        category: WorldEvents.CATEGORIES.NATURAL,
                        text: `${kingdom.name}: Devastating floods near ${floodSettlement.name}. Infrastructure damaged.`,
                        kingdom: kingdom.id,
                        impact: 'negative',
                    };
                }
                break;

            case 'earthquake':
                kingdom.treasury = Math.floor(kingdom.treasury * 0.8);
                return {
                    category: WorldEvents.CATEGORIES.NATURAL,
                    text: `${kingdom.name}: Earthquake destroys buildings. Costly repairs needed.`,
                    kingdom: kingdom.id,
                    impact: 'negative',
                };

            case 'drought':
                kingdom.population = Math.floor(kingdom.population * 0.97);
                return {
                    category: WorldEvents.CATEGORIES.NATURAL,
                    text: `${kingdom.name}: Severe drought affects crops. Food shortage.`,
                    kingdom: kingdom.id,
                    impact: 'negative',
                };

            case 'bountiful_harvest':
                kingdom.population = Math.floor(kingdom.population * 1.05);
                kingdom.treasury += 300;
                return {
                    category: WorldEvents.CATEGORIES.NATURAL,
                    text: `${kingdom.name}: Bountiful harvest! Population and wealth increase.`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };
        }

        return null;
    },

    /**
     * Generate religious events
     */
    generateReligiousEvent(world) {
        const livingKingdoms = world.kingdoms.filter(k => k.isAlive);
        if (livingKingdoms.length === 0) return null;

        const eventTypes = [
            'festival',
            'pilgrimage',
            'heresy',
            'miracle',
            'schism',
        ];

        const type = Utils.randPick(eventTypes);
        const kingdom = Utils.randPick(livingKingdoms);

        switch (type) {
            case 'festival':
                kingdom.treasury -= 200;
                return {
                    category: WorldEvents.CATEGORIES.RELIGIOUS,
                    text: `${kingdom.name}: Grand religious festival celebrated. Morale boosted!`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };

            case 'pilgrimage':
                kingdom.treasury += 400;
                return {
                    category: WorldEvents.CATEGORIES.RELIGIOUS,
                    text: `${kingdom.name}: Pilgrims flock to holy sites. Tourism revenue increases.`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };

            case 'heresy':
                kingdom.population = Math.floor(kingdom.population * 0.98);
                return {
                    category: WorldEvents.CATEGORIES.RELIGIOUS,
                    text: `${kingdom.name}: Heretical movement suppressed. Some citizens flee.`,
                    kingdom: kingdom.id,
                    impact: 'negative',
                };

            case 'miracle':
                kingdom.population = Math.floor(kingdom.population * 1.03);
                return {
                    category: WorldEvents.CATEGORIES.RELIGIOUS,
                    text: `${kingdom.name}: Divine miracle reported! Faith strengthened, population grows.`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };

            case 'schism':
                kingdom.treasury = Math.floor(kingdom.treasury * 0.9);
                const other = Utils.randPick(livingKingdoms.filter(k => k.id !== kingdom.id));
                if (other) {
                    kingdom.relations[other.id] = Math.max(-100, (kingdom.relations[other.id] || 0) - 20);
                    other.relations[kingdom.id] = Math.max(-100, (other.relations[kingdom.id] || 0) - 20);
                    return {
                        category: WorldEvents.CATEGORIES.RELIGIOUS,
                        text: `Religious schism between ${kingdom.name} and ${other.name}. Relations deteriorate.`,
                        kingdoms: [kingdom.id, other.id],
                        impact: 'negative',
                    };
                }
                break;
        }

        return null;
    },

    /**
     * Apply event effects to player if relevant
     */
    applyPlayerEffects(event, player, world) {
        // If event affects a kingdom the player has high reputation with
        if (event.kingdom) {
            const rep = player.reputation[event.kingdom] || 0;

            if (rep > 50 && event.impact === 'positive') {
                // Player benefits from allied kingdom's good fortune
                player.gold += 50;
                return `Your allies prosper! +50 gold`;
            } else if (rep < -50 && event.impact === 'negative') {
                // Player benefits from enemy's misfortune
                player.renown += 5;
                return `Your enemies suffer! +5 renown`;
            }
        }

        return null;
    },
};
