// ============================================
// MARKET DYNAMICS — Regional supply/demand pricing system
// ============================================

const MarketDynamics = {
    // Regional market state (per settlement)
    regionalMarkets: {}, // settlementId -> { supply: {}, demand: {}, prices: {} }
    
    /**
     * Initialize market with base prices from PlayerEconomy.GOODS
     */
    initialize() {
        this.regionalMarkets = {};
    },

    /**
     * Initialize or get market for a settlement
     */
    getOrCreateSettlementMarket(settlementId) {
        if (!this.regionalMarkets[settlementId]) {
            const market = {
                supply: {},
                demand: {},
                prices: {},
                priceHistory: {}
            };
            
            // Initialize with base prices
            if (typeof PlayerEconomy !== 'undefined' && PlayerEconomy.GOODS) {
                for (const [key, good] of Object.entries(PlayerEconomy.GOODS)) {
                    market.prices[good.id] = good.basePrice;
                    market.supply[good.id] = 50; // Neutral starting supply
                    market.demand[good.id] = 50; // Neutral starting demand
                    market.priceHistory[good.id] = [good.basePrice];
                }
            }
            
            this.regionalMarkets[settlementId] = market;
        }
        return this.regionalMarkets[settlementId];
    },

    /**
     * Update regional market prices based on local supply and demand
     */
    updatePrices(world) {
        const settlements = world.getAllSettlements();
        
        for (const settlement of settlements) {
            const settlementId = `${settlement.q}-${settlement.r}`;
            const market = this.getOrCreateSettlementMarket(settlementId);
            const tile = world.getTile(settlement.q, settlement.r);
            if (!tile) continue;

            const newSupply = {};
            const newDemand = {};

            // Initialize
            for (const goodId in market.prices) {
                newSupply[goodId] = 10; // Base local supply
                newDemand[goodId] = 10; // Base local demand
            }

            // Calculate local production from settlement
            const econ = Economy.getSummary(settlement, tile, world);
            if (econ.production.food > 0) {
                newSupply['grain'] = (newSupply['grain'] || 0) + econ.production.food * 0.5;
                newSupply['fish'] = (newSupply['fish'] || 0) + econ.production.food * 0.3;
            }
            if (econ.production.goods > 0) {
                // Distribute goods production across various goods
                newSupply['wood'] = (newSupply['wood'] || 0) + econ.production.goods * 0.2;
                newSupply['stone'] = (newSupply['stone'] || 0) + econ.production.goods * 0.15;
                newSupply['iron'] = (newSupply['iron'] || 0) + econ.production.goods * 0.1;
            }

            // Player properties in this region (within radius)
            const nearbyTiles = Hex.hexesInRange(settlement.q, settlement.r, 5);
            for (const hex of nearbyTiles) {
                const nearbyTile = world.getTile(hex.q, hex.r);
                if (!nearbyTile || !nearbyTile.playerProperties) continue;
                
                for (const prop of nearbyTile.playerProperties) {
                    if (prop.produces && prop.productionRate) {
                        newSupply[prop.produces] = (newSupply[prop.produces] || 0) + prop.productionRate;
                    }
                }
            }

            // Calculate demand based on population
            const popDemand = Math.floor(settlement.population / 100);
            newDemand['grain'] = (newDemand['grain'] || 0) + popDemand * 0.8;
            newDemand['bread'] = (newDemand['bread'] || 0) + popDemand * 0.6;
            newDemand['fish'] = (newDemand['fish'] || 0) + popDemand * 0.5;
            newDemand['wood'] = (newDemand['wood'] || 0) + popDemand * 0.4;
            newDemand['clothes'] = (newDemand['clothes'] || 0) + popDemand * 0.3;
            newDemand['tools'] = (newDemand['tools'] || 0) + popDemand * 0.2;

            // Smooth transition (70% old, 30% new)
            for (const goodId in market.prices) {
                market.supply[goodId] = Math.floor((market.supply[goodId] || 0) * 0.7 + (newSupply[goodId] || 0) * 0.3);
                market.demand[goodId] = Math.floor((market.demand[goodId] || 0) * 0.7 + (newDemand[goodId] || 0) * 0.3);

                // Calculate price based on supply/demand ratio
                const basePrice = PlayerEconomy.GOODS[goodId.toUpperCase()]?.basePrice || 10;
                const ratio = market.demand[goodId] / Math.max(1, market.supply[goodId]);

                // Price increases when demand > supply, decreases when supply > demand
                let newPrice = Math.floor(basePrice * ratio);

                // Clamp prices to reasonable range (40% to 400% of base for regional variance)
                newPrice = Math.max(Math.floor(basePrice * 0.4), Math.min(Math.floor(basePrice * 4), newPrice));

                // Smooth price changes (85% old, 15% new)
                market.prices[goodId] = Math.floor((market.prices[goodId] || basePrice) * 0.85 + newPrice * 0.15);

                // Track price history (last 30 days)
                if (!market.priceHistory[goodId]) market.priceHistory[goodId] = [];
                market.priceHistory[goodId].push(market.prices[goodId]);
                if (market.priceHistory[goodId].length > 30) {
                    market.priceHistory[goodId].shift();
                }
            }
        }
    },

    /**
     * Get current price for a good at a specific location
     */
    getPrice(goodId, q, r, world) {
        // Find nearest settlement
        const nearestSettlement = this.findNearestSettlement(q, r, world);
        if (!nearestSettlement) {
            // Return base price if no settlement nearby
            return PlayerEconomy.GOODS[goodId.toUpperCase()]?.basePrice || 10;
        }
        
        const settlementId = `${nearestSettlement.q}-${nearestSettlement.r}`;
        const market = this.getOrCreateSettlementMarket(settlementId);
        return market.prices[goodId] || PlayerEconomy.GOODS[goodId.toUpperCase()]?.basePrice || 10;
    },

    /**
     * Find nearest settlement to given coordinates
     */
    findNearestSettlement(q, r, world) {
        const settlements = world.getAllSettlements();
        let nearest = null;
        let minDist = Infinity;
        
        for (const settlement of settlements) {
            const dist = Hex.wrappingDistance(q, r, settlement.q, settlement.r, world.width);
            if (dist < minDist) {
                minDist = dist;
                nearest = settlement;
            }
        }
        
        return nearest;
    },

    /**
     * Get price trend (rising, falling, stable) at a location
     */
    getPriceTrend(goodId, q, r, world) {
        const nearestSettlement = this.findNearestSettlement(q, r, world);
        if (!nearestSettlement) return 'stable';
        
        const settlementId = `${nearestSettlement.q}-${nearestSettlement.r}`;
        const market = this.getOrCreateSettlementMarket(settlementId);
        const history = market.priceHistory[goodId];
        
        if (!history || history.length < 2) return 'stable';

        const recent = history.slice(-5);
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const current = history[history.length - 1];

        if (current > avg * 1.1) return 'rising';
        if (current < avg * 0.9) return 'falling';
        return 'stable';
    },

    /**
     * Get market summary for UI - shows player's local market
     */
    getMarketSummary(playerQ, playerR, world) {
        const nearestSettlement = this.findNearestSettlement(playerQ, playerR, world);
        
        if (!nearestSettlement) {
            // Return base prices if no settlement nearby
            const summary = [];
            for (const [key, good] of Object.entries(PlayerEconomy.GOODS || {})) {
                summary.push({
                    id: good.id,
                    name: good.name,
                    icon: good.icon,
                    price: good.basePrice,
                    basePrice: good.basePrice,
                    trend: 'stable',
                    supply: 50,
                    demand: 50,
                    priceChange: 0,
                    location: 'No market nearby'
                });
            }
            return summary;
        }
        
        const settlementId = `${nearestSettlement.q}-${nearestSettlement.r}`;
        const market = this.getOrCreateSettlementMarket(settlementId);
        const summary = [];
        
        for (const [key, good] of Object.entries(PlayerEconomy.GOODS || {})) {
            const price = market.prices[good.id] || good.basePrice;
            const history = market.priceHistory[good.id];
            let trend = 'stable';
            
            if (history && history.length >= 2) {
                const recent = history.slice(-5);
                const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
                const current = history[history.length - 1];
                if (current > avg * 1.1) trend = 'rising';
                else if (current < avg * 0.9) trend = 'falling';
            }
            
            summary.push({
                id: good.id,
                name: good.name,
                icon: good.icon,
                price,
                basePrice: good.basePrice,
                trend,
                supply: market.supply[good.id] || 0,
                demand: market.demand[good.id] || 0,
                priceChange: Math.round(((price - good.basePrice) / good.basePrice) * 100),
                location: nearestSettlement.name
            });
        }
        return summary;
    }
};

// ============================================
// BANKING SYSTEM — Loans and savings
// ============================================

const Banking = {
    /**
     * Get loan options for player from a specific kingdom
     */
    getLoanOptions(player, kingdomId) {
        const maxLoan = Math.floor(player.gold * 2 + player.properties.length * 500);

        return [
            {
                id: 'small',
                name: 'Small Loan',
                amount: 500,
                interestRate: 0.10, // 10% interest
                duration: 30, // days
                available: maxLoan >= 500,
                kingdomId
            },
            {
                id: 'medium',
                name: 'Medium Loan',
                amount: 2000,
                interestRate: 0.15,
                duration: 60,
                available: maxLoan >= 2000,
                kingdomId
            },
            {
                id: 'large',
                name: 'Large Loan',
                amount: 5000,
                interestRate: 0.20,
                duration: 90,
                available: maxLoan >= 5000,
                kingdomId
            }
        ];
    },

    /**
     * Take out a loan from a specific kingdom's royal bank
     */
    takeLoan(player, loanType, kingdomId) {
        if (!kingdomId) {
            return { success: false, reason: 'Must specify which kingdom to borrow from' };
        }

        const options = this.getLoanOptions(player, kingdomId);
        const loan = options.find(l => l.id === loanType);

        if (!loan || !loan.available) {
            return { success: false, reason: 'Loan not available' };
        }

        // Initialize loans object if needed
        if (!player.loans) player.loans = {};
        if (!player.loans[kingdomId]) player.loans[kingdomId] = [];

        // Check if player already has too many loans from this kingdom
        if (player.loans[kingdomId].length >= 3) {
            return { success: false, reason: `Too many active loans from this kingdom` };
        }

        // Give player the money
        player.gold += loan.amount;

        // Add loan to player's debts for this kingdom
        player.loans[kingdomId].push({
            id: Math.random().toString(36).substr(2, 9),
            type: loanType,
            kingdomId,
            principal: loan.amount,
            interestRate: loan.interestRate,
            totalOwed: Math.floor(loan.amount * (1 + loan.interestRate)),
            remainingDays: loan.duration,
            dailyPayment: Math.floor(loan.amount * (1 + loan.interestRate) / loan.duration),
            daysTaken: 0
        });

        return { success: true, loan: player.loans[kingdomId][player.loans[kingdomId].length - 1] };
    },

    /**
     * Process daily loan payments
     */
    processLoans(player, world) {
        if (!player.loans || Object.keys(player.loans).length === 0) {
            return { paid: 0, defaulted: [] };
        }

        let totalPaid = 0;
        const defaulted = [];

        // Process loans for each kingdom
        for (const [kingdomId, loans] of Object.entries(player.loans)) {
            if (!loans || loans.length === 0) continue;

            for (let i = loans.length - 1; i >= 0; i--) {
                const loan = loans[i];
                loan.daysTaken++;

                // Try to collect daily payment
                if (player.gold >= loan.dailyPayment) {
                    player.gold -= loan.dailyPayment;
                    loan.totalOwed -= loan.dailyPayment;
                    loan.remainingDays--;
                    totalPaid += loan.dailyPayment;

                    // Loan paid off
                    if (loan.remainingDays <= 0 || loan.totalOwed <= 0) {
                        loans.splice(i, 1);
                    }
                } else {
                    // Can't pay - add penalty
                    loan.totalOwed = Math.floor(loan.totalOwed * 1.05); // 5% penalty
                    loan.remainingDays++;
                    defaulted.push({ ...loan, kingdomId });

                    // If defaulted for too long, seize property
                    if (loan.daysTaken > loan.remainingDays * 1.5 && player.properties.length > 0) {
                        const seized = player.properties.pop(); // Takes the last one (most recent usually)

                        // Remove from world map
                        if (world) {
                            const tile = world.getTile(seized.q, seized.r);
                            if (tile) {
                                if (tile.playerProperties) {
                                    // Find and remove the specific property type
                                    const idx = tile.playerProperties.findIndex(p => p.type === seized.type);
                                    if (idx !== -1) {
                                        tile.playerProperties.splice(idx, 1);
                                    }

                                    // Update legacy reference or clear if empty
                                    if (tile.playerProperties.length > 0) {
                                        tile.playerProperty = tile.playerProperties[0];
                                    } else {
                                        tile.playerProperty = null;
                                        tile.playerProperties = null;
                                    }
                                } else {
                                    // Fallback for legacy
                                    tile.playerProperty = null;
                                }
                            }
                        }

                        defaulted.push({ ...loan, kingdomId, seizedProperty: seized });
                        loans.splice(i, 1);
                    }
                }
            }

            // Clean up empty kingdom loan arrays
            if (loans.length === 0) {
                delete player.loans[kingdomId];
            }
        }

        return { paid: totalPaid, defaulted };
    },

    /**
     * Repay loan early
     */
    repayLoan(player, loanId) {
        if (!player.loans) return { success: false, reason: 'No active loans' };

        // Find the loan across all kingdoms
        let foundLoan = null;
        let foundKingdomId = null;
        let loanIndex = -1;

        for (const [kingdomId, loans] of Object.entries(player.loans)) {
            loanIndex = loans.findIndex(l => l.id === loanId);
            if (loanIndex !== -1) {
                foundLoan = loans[loanIndex];
                foundKingdomId = kingdomId;
                break;
            }
        }

        if (!foundLoan) return { success: false, reason: 'Loan not found' };

        if (player.gold < foundLoan.totalOwed) {
            return { success: false, reason: `Need ${foundLoan.totalOwed} gold` };
        }

        player.gold -= foundLoan.totalOwed;
        player.loans[foundKingdomId].splice(loanIndex, 1);

        // Clean up empty kingdom loan array
        if (player.loans[foundKingdomId].length === 0) {
            delete player.loans[foundKingdomId];
        }

        return { success: true, amount: foundLoan.totalOwed };
    }
};

// ============================================
// TAXATION SYSTEM
// ============================================

const Taxation = {
    TAX_RATES: {
        VERY_LOW: { id: 'very_low', name: 'Very Low (5%)', rate: 0.05, happinessBonus: 10, growthBonus: 0.05 },
        LOW: { id: 'low', name: 'Low (10%)', rate: 0.10, happinessBonus: 5, growthBonus: 0.02 },
        MODERATE: { id: 'moderate', name: 'Moderate (15%)', rate: 0.15, happinessBonus: 0, growthBonus: 0 },
        HIGH: { id: 'high', name: 'High (25%)', rate: 0.25, happinessBonus: -10, growthBonus: -0.05 },
        VERY_HIGH: { id: 'very_high', name: 'Very High (40%)', rate: 0.40, happinessBonus: -20, growthBonus: -0.10 }
    },

    /**
     * Collect taxes from settlements
     */
    collectTaxes(player, world) {
        if (!player.taxRate) player.taxRate = 'moderate';

        const taxPolicy = this.TAX_RATES[player.taxRate.toUpperCase()];
        if (!taxPolicy) return { collected: 0, settlements: [] };

        let totalCollected = 0;
        const settlements = [];

        // Collect from player's settlements (if they own any)
        if (player.settlements) {
            for (const settlementRef of player.settlements) {
                const tile = world.getTile(settlementRef.q, settlementRef.r);
                if (!tile || !tile.settlement) continue;

                const settlement = tile.settlement;
                const taxBase = Math.floor(settlement.population * 0.1); // 0.1 gold per person base
                const taxCollected = Math.floor(taxBase * taxPolicy.rate);

                totalCollected += taxCollected;
                settlements.push({
                    name: settlement.name,
                    collected: taxCollected,
                    population: settlement.population
                });

                // Apply happiness and growth effects
                settlement.happiness = (settlement.happiness || 50) + taxPolicy.happinessBonus * 0.1;
                settlement.growthRate = (settlement.growthRate || 1) * (1 + taxPolicy.growthBonus);
            }
        }

        player.gold += totalCollected;

        return { collected: totalCollected, settlements, policy: taxPolicy };
    },

    /**
     * Change tax rate
     */
    setTaxRate(player, newRate) {
        // Check if player has authority to change tax rates
        if (!player.allegiance) {
            return { success: false, reason: 'You must be part of a kingdom to set tax rates' };
        }

        // Only king or treasurer can change tax rates
        if (player.kingdomTitle !== 'king' && player.kingdomTitle !== 'treasurer') {
            return { success: false, reason: 'Only the King or Treasurer can change tax rates' };
        }

        const policy = this.TAX_RATES[newRate.toUpperCase()];
        if (!policy) return { success: false, reason: 'Invalid tax rate' };

        player.taxRate = newRate;
        return { success: true, policy };
    }
};

window.MarketDynamics = MarketDynamics;
window.Banking = Banking;
window.Taxation = Taxation;
