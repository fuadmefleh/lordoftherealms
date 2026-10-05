// ============================================
// MARKET DYNAMICS — Regional supply/demand pricing system
// ============================================

import { PlayerEconomy } from '../player/playerEconomy.js';
import { Economy } from '../world/economy.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Seasons } from '../world/seasons.js';
import { Technology } from './technology.js';
import { Hex } from '../core/hex.js';
import { Councils } from './councils.js';
import { Titles } from './titles.js';
import { Utils } from '../core/utils.js';


export const MarketDynamics = {
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
        // Tiles with player properties (few or none): settlements with none
        // within 5 hexes skip the 91-hex neighbourhood scan below
        const propertyTiles = MarketDynamics._propertyTiles(world);
        const basePrices = new Map();
        const basePriceOf = (goodId) => {
            let price = basePrices.get(goodId);
            if (price === undefined) {
                price = PlayerEconomy.GOODS[goodId.toUpperCase()]?.basePrice || 10;
                basePrices.set(goodId, price);
            }
            return price;
        };
        const hasOwn = Object.prototype.hasOwnProperty;

        for (const settlement of settlements) {
            const settlementId = `${settlement.q}-${settlement.r}`;
            const market = this.getOrCreateSettlementMarket(settlementId);
            const tile = world.getTile(settlement.q, settlement.r);
            if (!tile) continue;

            // Today's local supply and demand: 10 of every good the market
            // lists (the base), plus the amounts added below
            const newSupply = new Map();
            const newDemand = new Map();
            const add = (into, goodId, amount) => {
                const cur = into.has(goodId) ? into.get(goodId) : (hasOwn.call(market.prices, goodId) ? 10 : 0);
                into.set(goodId, (cur || 0) + amount);
            };

            // Calculate local production from settlement
            const econ = Economy.getSummary(settlement, tile, world);
            if (econ.production.food > 0) {
                add(newSupply, 'grain', econ.production.food * 0.5);
                add(newSupply, 'fish', econ.production.food * 0.3);
            }
            if (econ.production.goods > 0) {
                // Distribute goods production across various goods
                add(newSupply, 'wood', econ.production.goods * 0.2);
                add(newSupply, 'stone', econ.production.goods * 0.15);
                add(newSupply, 'iron', econ.production.goods * 0.1);
            }

            // Player properties in this region (within radius)
            const nearbyTiles = MarketDynamics._propertiesNear(propertyTiles, settlement, world)
                ? Hex.hexesInRange(settlement.q, settlement.r, 5) : [];
            for (const hex of nearbyTiles) {
                const nearbyTile = world.getTile(hex.q, hex.r);
                if (!nearbyTile || !nearbyTile.playerProperties) continue;
                
                for (const prop of nearbyTile.playerProperties) {
                    if (prop.produces && prop.productionRate) {
                        add(newSupply, prop.produces, prop.productionRate);
                    }
                }
            }

            // Calculate demand based on population
            const popDemand = Math.floor(settlement.population / 100);
            add(newDemand, 'grain', popDemand * 0.8);
            add(newDemand, 'bread', popDemand * 0.6);
            add(newDemand, 'fish', popDemand * 0.5);
            add(newDemand, 'wood', popDemand * 0.4);
            add(newDemand, 'clothes', popDemand * 0.3);
            add(newDemand, 'tools', popDemand * 0.2);

            // Smooth transition (70% old, 30% new). Most values settle, so a
            // store is skipped when it would write the same value back (these
            // big per-good tables are slow to write)
            const supplies = market.supply, demands = market.demand, prices = market.prices;
            for (const goodId in prices) {
                const todaySupply = newSupply.has(goodId) ? newSupply.get(goodId) : 10;
                const todayDemand = newDemand.has(goodId) ? newDemand.get(goodId) : 10;
                const oldSupply = supplies[goodId], oldDemand = demands[goodId];
                const supply = Math.floor((oldSupply || 0) * 0.7 + (todaySupply || 0) * 0.3);
                const demand = Math.floor((oldDemand || 0) * 0.7 + (todayDemand || 0) * 0.3);
                if (!Object.is(oldSupply, supply)) supplies[goodId] = supply;
                if (!Object.is(oldDemand, demand)) demands[goodId] = demand;

                // Calculate price based on supply/demand ratio
                const basePrice = basePriceOf(goodId);
                const ratio = demand / Math.max(1, supply);

                // Price increases when demand > supply, decreases when supply > demand
                let newPrice = Math.floor(basePrice * ratio);

                // Clamp prices to reasonable range (40% to 400% of base for regional variance)
                newPrice = Math.max(Math.floor(basePrice * 0.4), Math.min(Math.floor(basePrice * 4), newPrice));

                // Smooth price changes (85% old, 15% new)
                const oldPrice = prices[goodId];
                const price = Math.floor((oldPrice || basePrice) * 0.85 + newPrice * 0.15);
                if (!Object.is(oldPrice, price)) prices[goodId] = price;

                // Track price history (last 30 days): past 30, the oldest
                // drops out (shifted down in place)
                let history = market.priceHistory[goodId];
                if (!history) history = market.priceHistory[goodId] = [];
                const len = history.length;
                if (len >= 30) {
                    for (let i = 1; i < len; i++) history[i - 1] = history[i];
                    history[len - 1] = price;
                } else {
                    history.push(price);
                }
            }
        }
    },

    /**
     * [q, r] of every tile holding player properties, or null when the world
     * has no tile grid to scan (then every settlement scans its neighbourhood).
     */
    _propertyTiles(world) {
        if (!Array.isArray(world.tiles) || !(world.width > 10)) return null;
        const out = [];
        for (let r = 0; r < world.tiles.length; r++) {
            const row = world.tiles[r];
            if (!row) continue;
            for (let q = 0; q < row.length; q++) {
                if (row[q] && row[q].playerProperties) out.push([q, r]);
            }
        }
        return out;
    },

    /** Could a hex within 5 of the settlement hold player properties? */
    _propertiesNear(propertyTiles, settlement, world) {
        if (!propertyTiles) return true;
        for (const [q, r] of propertyTiles) {
            if (Hex.wrappingDistance(settlement.q, settlement.r, q, r, world.width) <= 5) return true;
        }
        return false;
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
        const price = market.prices[goodId] || PlayerEconomy.GOODS[goodId.toUpperCase()]?.basePrice || 10;
        // Timed world events (market crash, drought food prices, ...) near this market
        const tile = world && world.getTile ? world.getTile(nearestSettlement.q, nearestSettlement.r) : null;
        let mod = WorldEvents.getModifier(world, 'prices', tile);
        if (WorldEvents.FOOD_GOODS.includes(goodId)) mod += WorldEvents.getModifier(world, 'foodPrices', tile);
        // The agricultural year (cheap after the harvest, dear in the lean months)
        mod += Seasons.priceModifier(goodId, Seasons.today(world));
        return Math.max(1, Math.round(price * (1 + mod)));
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

export const Banking = {
    /** Fallback loan catalogue, used only when data/market.json has no loanOptions. */
    DEFAULT_LOAN_OPTIONS: [
        { id: 'small', name: 'Small Loan', amount: 500, interestRate: 0.10, duration: 30 },
        { id: 'medium', name: 'Medium Loan', amount: 2000, interestRate: 0.15, duration: 60 },
        { id: 'large', name: 'Large Loan', amount: 5000, interestRate: 0.20, duration: 90 },
    ],

    /** Loan catalogue from data/market.json (set by DataLoader). */
    _loanOptions: null,

    /**
     * Get loan options for player from a specific kingdom
     */
    getLoanOptions(player, kingdomId) {
        const maxLoan = Math.floor(player.gold * 2 + (player.properties?.length || 0) * 500);
        const catalogue = Array.isArray(this._loanOptions) && this._loanOptions.length > 0
            ? this._loanOptions
            : this.DEFAULT_LOAN_OPTIONS;

        return catalogue.map(opt => ({
            ...opt,
            available: maxLoan >= opt.amount,
            kingdomId,
        }));
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
        // Banking techs cut the interest on new loans
        const interestRate = loan.interestRate * Math.max(0, 1 - Technology.getEffectTotal(player, 'loanInterestReduction'));

        // Add loan to player's debts for this kingdom
        player.loans[kingdomId].push({
            id: Utils.random().toString(36).substr(2, 9),
            type: loanType,
            kingdomId,
            principal: loan.amount,
            interestRate,
            totalOwed: Math.floor(loan.amount * (1 + interestRate)),
            remainingDays: loan.duration,
            dailyPayment: Math.floor(loan.amount * (1 + interestRate) / loan.duration),
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

export const Taxation = {
    /** Weekly tax base per inhabitant, before the rate. */
    TAX_PER_HEAD: 0.25,

    TAX_RATES: {
        VERY_LOW: { id: 'very_low', name: 'Very Low (5%)', rate: 0.05, happinessBonus: 10, growthBonus: 0.05 },
        LOW: { id: 'low', name: 'Low (10%)', rate: 0.10, happinessBonus: 5, growthBonus: 0.02 },
        MODERATE: { id: 'moderate', name: 'Moderate (15%)', rate: 0.15, happinessBonus: 0, growthBonus: 0 },
        HIGH: { id: 'high', name: 'High (25%)', rate: 0.25, happinessBonus: -10, growthBonus: -0.05 },
        VERY_HIGH: { id: 'very_high', name: 'Very High (40%)', rate: 0.40, happinessBonus: -20, growthBonus: -0.10 }
    },

    /** Office perk (e.g. the Chancellor's +10%) on taxes from the player's settlements. */
    officeTaxMultiplier(player) {
        const title = Titles.getActiveTitle(player);
        const pct = (title && title.perks && title.perks.taxBonusPercent) || 0;
        return 1 + pct / 100;
    },

    /**
     * The settlements the player rules and taxes, as { q, r, settlement }:
     * colonies they founded or conquered (player.colonies) that are still
     * theirs, plus any explicit player.settlements refs. A colony counts while
     * it is marked as the player's, is independent, or sits in the player's
     * own realm; once another crown takes it, it no longer pays you.
     */
    getPlayerSettlements(player, world) {
        const out = [];
        if (!player || !world || typeof world.getTile !== 'function') return out;
        const seen = new Set();
        const add = (ref, requireOwnership) => {
            if (!ref || typeof ref.q !== 'number') return;
            const key = `${ref.q},${ref.r}`;
            if (seen.has(key)) return;
            const tile = world.getTile(ref.q, ref.r);
            const settlement = tile && tile.settlement;
            if (!settlement) return;
            if (requireOwnership) {
                const mine = (settlement.colony && settlement.colony.isPlayerColony)
                    || !settlement.kingdom
                    || (player.allegiance && settlement.kingdom === player.allegiance);
                if (!mine) return;
            }
            seen.add(key);
            out.push({ q: ref.q, r: ref.r, settlement });
        };
        for (const ref of player.settlements || []) add(ref, false);
        for (const ref of player.colonies || []) add(ref, true);
        return out;
    },

    /**
     * Collect taxes from the player's settlements (weekly).
     *
     * The rate sets each settlement's mood: happiness drifts toward
     * 50 + 1.5 × the policy's happiness bonus. Content people pay more
     * (×0.75 at 0 happiness … ×1.25 at 100), grow faster or slower by the
     * policy's yearly growth bonus, and — in conquered towns — warm to or
     * turn against your rule (colony loyalty).
     * Pass { dryRun: true } to estimate without changing anything.
     */
    collectTaxes(player, world, opts = {}) {
        if (!player.taxRate) player.taxRate = 'moderate';
        const dryRun = !!opts.dryRun;

        const taxPolicy = this.TAX_RATES[player.taxRate.toUpperCase()];
        if (!taxPolicy) return { collected: 0, settlements: [] };

        let totalCollected = 0;
        const settlements = [];

        // Collect from the player's settlements (founded/conquered colonies)
        for (const ref of Taxation.getPlayerSettlements(player, world)) {
            const tile = world.getTile(ref.q, ref.r);
            const settlement = ref.settlement;
            const happiness = Taxation.getHappiness(settlement);
            // A quarter of a gold piece per head a week before the rate: a town of
            // 2,000 at moderate taxes yields ~75g a week (docs/economy-balance.md)
            const taxBase = Math.floor(settlement.population * Taxation.TAX_PER_HEAD);
            const landBonus = 1 + (player.landTaxBonus || 0);
            // Rebellions and crises cut collections; gold rushes swell them
            const eventMult = Math.max(0, 1 + WorldEvents.getModifier(world, 'taxIncome', tile));
            const moodMult = 0.75 + happiness / 200;
            // Holdings development (systems/holdings.js): markets, harbours and a
            // good steward raise the take; a skimming governor or a revolt cuts it
            const holdingMult = Taxation.holdingFx(settlement, 'taxMult', 1);
            const taxCollected = Math.floor(taxBase * taxPolicy.rate * landBonus * Taxation.officeTaxMultiplier(player) * eventMult * moodMult * holdingMult);

            totalCollected += taxCollected;
            const growthRate = Taxation.getGrowthRate(settlement, taxPolicy);
            const projectedPopulation = Taxation.projectPopulation(settlement, 30, growthRate);
            const entry = {
                name: settlement.name,
                q: ref.q,
                r: ref.r,
                collected: taxCollected,
                population: settlement.population,
                happiness: Math.round(happiness),
                peoplesMood: Taxation.peoplesMood(settlement),
                growthRate,
                projectedPopulation,
                // Next month's weekly take, if the town grows (or shrinks) as projected
                projectedCollected: settlement.population > 0
                    ? Math.floor(taxCollected * projectedPopulation / settlement.population)
                    : taxCollected,
            };
            settlements.push(entry);
            if (!dryRun) Taxation._applyTaxMood(settlement, taxPolicy, entry);
        }

        if (!dryRun) player.gold += totalCollected;

        return { collected: totalCollected, settlements, policy: taxPolicy };
    },

    /** One cached holdings effect of a settlement (settlement.holding.fx, systems/holdings.js). */
    holdingFx(settlement, key, fallback = 0) {
        const fx = settlement && settlement.holding && settlement.holding.fx;
        const v = fx && fx[key];
        return typeof v === 'number' && isFinite(v) ? v : fallback;
    },

    /** Mood points a settlement's peoples add to its happiness target (systems/peoples). */
    peoplesMood(settlement) {
        return (settlement && settlement.peoplesEffects && settlement.peoplesEffects.stability) || 0;
    },

    /**
     * A settlement's yearly growth rate (fraction per 120-day year), as last
     * set by tax collection; falls back to the current policy's growth bonus.
     */
    getGrowthRate(settlement, taxPolicy = null) {
        if (settlement && typeof settlement.growthRate === 'number') return settlement.growthRate;
        return ((taxPolicy && taxPolicy.growthBonus) || 0) + Taxation.holdingFx(settlement, 'growth');
    },

    /** Population `days` from now at `growthRate` per year (defaults to the settlement's own). */
    projectPopulation(settlement, days = 30, growthRate = null) {
        const pop = (settlement && settlement.population) || 0;
        const rate = typeof growthRate === 'number' ? growthRate : Taxation.getGrowthRate(settlement);
        // Tax-driven decline never drops a town below 10 (see _applyTaxMood)
        return Math.max(Math.min(pop, 10), Math.round(pop * (1 + rate * days / 120)));
    },

    /** A settlement's happiness 0..100 (50 when never taxed). */
    getHappiness(settlement) {
        return typeof settlement.happiness === 'number' ? settlement.happiness : 50;
    },

    /** Weekly mood, growth and loyalty change from the tax policy. */
    _applyTaxMood(settlement, taxPolicy, entry) {
        // Orderly, harmonious peoples settle happier; restless ones less so
        const peoplesMood = Taxation.peoplesMood(settlement);
        // Taverns, temples and squares in a developed holding lift the mood
        const holdingMood = Taxation.holdingFx(settlement, 'happiness');
        const target = Math.max(0, Math.min(100, 50 + taxPolicy.happinessBonus * 1.5 + peoplesMood + holdingMood));
        const happiness = Taxation.getHappiness(settlement);
        settlement.happiness = Math.max(0, Math.min(100, happiness + (target - happiness) * 0.25));
        entry.happiness = Math.round(settlement.happiness);

        // growthBonus is per year (120 days); a collection covers a week
        settlement.growthRate = taxPolicy.growthBonus + Taxation.holdingFx(settlement, 'growth');
        const delta = Math.round(settlement.population * settlement.growthRate * 7 / 120);
        if (delta !== 0) settlement.population = Math.max(10, settlement.population + delta);
        entry.populationChange = delta;

        // Conquered towns warm to light taxes and resent heavy ones
        if (settlement.colony && typeof settlement.colony.loyalty === 'number') {
            const shift = (settlement.happiness - 50) / 25;
            settlement.colony.loyalty = Math.max(0, Math.min(100, settlement.colony.loyalty + shift));
            entry.loyaltyChange = Math.round(shift * 10) / 10;
        }
    },

    /**
     * Who may set tax rates: a lord of their own settlements, or a royal
     * official — the King, Chancellor or Tax Collector (Treasurer in old saves).
     */
    canSetTaxes(player) {
        if (!player) return false;
        if (player.settlements && player.settlements.length > 0) return true;
        if ((player.colonies || []).length > 0) return true;
        return !!(player.allegiance && ['king', 'chancellor', 'tax_collector', 'treasurer'].includes(player.kingdomTitle));
    },

    /**
     * Change tax rate
     */
    setTaxRate(player, newRate, world = null) {
        if (!Taxation.canSetTaxes(player)) {
            return { success: false, reason: 'Only a lord of settlements, the King, the Chancellor or the Tax Collector can set tax rates' };
        }

        const policy = this.TAX_RATES[newRate.toUpperCase()];
        if (!policy) return { success: false, reason: 'Invalid tax rate' };

        const currentPolicy = this.TAX_RATES[(player.taxRate || 'moderate').toUpperCase()] || this.TAX_RATES.MODERATE;
        // A sworn official answers to the council; an independent lord does not
        if (policy.rate > currentPolicy.rate && player.allegiance && typeof Councils !== 'undefined') {
            const approval = Councils.canRaiseTaxes(player, newRate, world);
            if (!approval.success) {
                return { success: false, reason: approval.reason };
            }
        }

        player.taxRate = newRate;
        return { success: true, policy };
    }
};
