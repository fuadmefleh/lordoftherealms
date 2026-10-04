// ============================================
// WORLD EVENTS — Dynamic event system
// ============================================

import { Utils } from '../core/utils.js';
import { Kingdom } from './kingdom.js';
import { WEATHER_EFFECTS } from './weather.js';

export const WorldEvents = {
    /**
     * Generate initial world history
     */
    generateHistory(world) {
        const history = [];
        const startYear = 1;
        const currentYear = world.year || 853;

        // Key historical milestones
        history.push({ year: 1, text: "The Great Awakening: The first civilizations emerge from the chaos." });

        // Generate random history between start and now
        for (let y = startYear + 20; y < currentYear; y += Utils.randInt(10, 50)) {
            const event = this.generateHistoricalEvent(world, y);
            if (event) {
                history.push(event);
            }
        }

        return history;
    },

    /**
     * Generate a single historical event
     */
    generateHistoricalEvent(world, year) {
        const types = ['war', 'plague', 'founding', 'disaster', 'discovery', 'golden_age'];
        const type = Utils.randPick(types);

        const kingdom = Utils.randPick(world.kingdoms);
        if (!kingdom) return null;

        let text = "";

        switch (type) {
            case 'war':
                const enemy = Utils.randPick(world.kingdoms.filter(k => k.id !== kingdom.id));
                if (enemy) {
                    text = `The ${Utils.randPick(['Great', 'Bloody', 'Long', 'Bitter'])} War between ${kingdom.name} and ${enemy.name} began.`;
                } else {
                    text = `${kingdom.name} faced a massive internal rebellion.`;
                }
                break;
            case 'plague':
                text = `The ${Utils.randPick(['Red', 'Black', 'Blue', 'Shadow'])} Plague ravaged the lands of ${kingdom.name}.`;
                break;
            case 'founding':
                text = `${kingdom.name} established a new major settlement during a period of expansion.`;
                break;
            case 'disaster':
                text = `A massive ${Utils.randPick(['earthquake', 'flood', 'volcanic eruption', 'drought'])} struck ${kingdom.name}.`;
                break;
            case 'discovery':
                text = `Scholars in ${kingdom.name} discovered ${Utils.randPick(['ancient texts', 'new agricultural techniques', 'a new star', 'magical artifacts'])}.`;
                break;
            case 'golden_age':
                text = `${kingdom.name} entered a Golden Age of prosperity and art.`;
                break;
        }

        return { year, text };
    },

    /** Shift a kingdom's stability (KingdomStability) by a one-off amount. */
    _nudgeStability(kingdom, amount) {
        const s = typeof kingdom.stability === 'number' ? kingdom.stability : 60;
        kingdom.stability = Utils.clamp(s + amount, 0, 100);
    },

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
        if (Utils.random() < 0.3) {
            const politicalEvent = WorldEvents.generatePoliticalEvent(world);
            if (politicalEvent) events.push(politicalEvent);
        }

        // Economic events (20% chance)
        if (Utils.random() < 0.2) {
            const economicEvent = WorldEvents.generateEconomicEvent(world);
            if (economicEvent) events.push(economicEvent);
        }

        // Military events (15% chance)
        if (Utils.random() < 0.15) {
            const militaryEvent = WorldEvents.generateMilitaryEvent(world);
            if (militaryEvent) events.push(militaryEvent);
        }

        // Natural disasters (10% chance)
        if (Utils.random() < 0.1) {
            const naturalEvent = WorldEvents.generateNaturalEvent(world);
            if (naturalEvent) events.push(naturalEvent);
        }

        // Religious events (15% chance)
        if (Utils.random() < 0.15) {
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
                if (kingdom.settlements && kingdom.settlements.length > 0) {
                    const settlement = Utils.randPick(kingdom.settlements);
                    if (settlement) {
                        const tile = world.getTile(settlement.q, settlement.r);
                        if (tile && tile.settlement) {
                            tile.settlement.population = Math.floor(tile.settlement.population * 0.9);
                            WorldEvents._nudgeStability(kingdom, -8);
                            return {
                                category: WorldEvents.CATEGORIES.POLITICAL,
                                text: `${kingdom.name}: Rebellion in ${settlement.name}! Population reduced.`,
                                kingdom: kingdom.id,
                                impact: 'negative',
                            };
                        }
                    }
                }
                break;

            case 'coronation':
                WorldEvents._nudgeStability(kingdom, 5);
                return {
                    category: WorldEvents.CATEGORIES.POLITICAL,
                    text: `${kingdom.name}: Grand coronation ceremony for ${kingdom.ruler}. Morale boosted!`,
                    kingdom: kingdom.id,
                    impact: 'positive',
                };

            case 'scandal':
                kingdom.treasury = Math.floor(kingdom.treasury * 0.9);
                WorldEvents._nudgeStability(kingdom, -5);
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
                if (kingdom.settlements && kingdom.settlements.length > 0) {
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
                WorldEvents._nudgeStability(kingdom, 2);
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
                if (kingdom.settlements && kingdom.settlements.length > 0) {
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
                if (kingdom.settlements && kingdom.settlements.length > 0) {
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
                WorldEvents._nudgeStability(kingdom, 4);
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
                WorldEvents._nudgeStability(kingdom, -3);
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

    // ── Timed events (data/worldEvents.json eventTemplates) ─────────────

    /** Timed event templates, installed by DataLoader. */
    TEMPLATES: {},

    /** At most this many timed events run at once. */
    MAX_ACTIVE_EVENTS: 4,

    /** Daily chance that a new timed event starts (when there's room). */
    DAILY_EVENT_CHANCE: 0.08,

    /** Goods whose price follows `foodPrices` effects. */
    FOOD_GOODS: ['grain', 'flour', 'bread', 'fish', 'preserved_fish', 'meat', 'dried_meat', 'cheese', 'fruit', 'berries', 'honey'],

    /**
     * Every effect key a template may use, how it reads in the UI, and what
     * consumes it. A key missing here is a hollow effect — the data test
     * fails on it. `pct`: shown as a percentage; otherwise as points.
     */
    EFFECT_KEYS: {
        farmProduction: { label: 'Farm output', pct: true },          // player farms (playerEconomy/property)
        mineProduction: { label: 'Mine output', pct: true },          // player mines/quarries
        population: { label: 'Population (on strike)', pct: true },  // one-off loss when the event begins
        populationGrowth: { label: 'Population growth', pct: true },  // Economy.produceDaily via KingdomAI
        foodConsumption: { label: 'Food consumption', pct: true },    // Economy.produceDaily via KingdomAI
        buildingDamage: { label: 'Buildings damaged', pct: true },    // settlement.damage on strike → production
        foodPrices: { label: 'Food prices', pct: true },              // MarketDynamics
        prices: { label: 'Prices', pct: true },                       // MarketDynamics
        tradeIncome: { label: 'Trade income', pct: true },            // caravans, ships
        landTradeIncome: { label: 'Land trade', pct: true },          // caravans
        seaTradeIncome: { label: 'Sea trade', pct: true },            // ships
        caravanFrequency: { label: 'Caravan traffic', pct: true },    // World.spawnUnits
        raiderSpawnRate: { label: 'Bandit activity', pct: true },     // World.spawnUnits
        pirateSpawnRate: { label: 'Pirate activity', pct: true },     // World.spawnUnits
        navalCost: { label: 'Ship upkeep', pct: true },               // Ships.processDaily
        taxIncome: { label: 'Tax income', pct: true },                // kingdom treasury + player taxes
        militarySpending: { label: 'War spending', pct: true },       // kingdom war upkeep
        travelSpeed: { label: 'Travel speed', pct: true },            // player movement (applyPlayerDailyEffects)
        unitAttrition: { label: 'Army attrition', pct: true },        // player army + kingdom military
        morale: { label: 'Morale' },                                  // battles (player + kingdom), stability target
        stability: { label: 'Stability' },                            // KingdomStability target
        diplomacy: { label: 'Diplomacy', pct: true },                 // KingdomAI.considerDiplomacy
        relations: { label: 'Relations/day' },                        // partner kingdoms' relations
        piety: { label: 'Piety/day' },                                // kingdom.religion.piety
        heresySpread: { label: 'Heresy risk', pct: true },            // Religion.spawnHeresy roll
        renownBonus: { label: 'Renown from victories', pct: true },   // PlayerMilitary.combat
    },

    /**
     * Advance timed events one day: count down and expire running ones, and
     * maybe start a new one (one roll for whether, one weighted pick for
     * which). Events in a region affect that kingdom; events whose text names
     * no place are realm-wide. Returns { started, ended } for notifications.
     */
    processTimedEvents(world) {
        if (!Array.isArray(world.activeEvents)) world.activeEvents = [];
        const ended = [];
        world.activeEvents = world.activeEvents.filter(ev => {
            ev.daysLeft--;
            if (ev.daysLeft <= 0) {
                ended.push(ev);
                return false;
            }
            return true;
        });
        // An event-started war ends with the event: the exhausted realms sign a truce
        for (const ev of ended) {
            if (ev.startedWar && ev.kingdomId && ev.partnerKingdomId && world.getKingdom) {
                const a = world.getKingdom(ev.kingdomId);
                const b = world.getKingdom(ev.partnerKingdomId);
                if (a && b && (a.wars || []).includes(b.id)) {
                    a.wars = a.wars.filter(id => id !== b.id);
                    b.wars = (b.wars || []).filter(id => id !== a.id);
                    if (a.relations) a.relations[b.id] = Math.max(a.relations[b.id] || 0, -40);
                    if (b.relations) b.relations[a.id] = Math.max(b.relations[a.id] || 0, -40);
                    // Same truce terms as a negotiated peace (KingdomAI.WAR.truceDays)
                    const until = (world.day || 0) + 180;
                    a.truces = { ...(a.truces || {}), [b.id]: until };
                    b.truces = { ...(b.truces || {}), [a.id]: until };
                    if (a.warState) delete a.warState[b.id];
                    if (b.warState) delete b.warState[a.id];
                    ev.truce = true;
                }
            }
        }

        const started = [];
        const templates = Object.values(WorldEvents.TEMPLATES || {})
            .filter(t => !world.activeEvents.some(ev => ev.id === t.id));
        if (world.activeEvents.length < WorldEvents.MAX_ACTIVE_EVENTS && templates.length > 0
            && Utils.random() < WorldEvents.DAILY_EVENT_CHANCE) {
            const total = templates.reduce((s, t) => s + (t.chance || 0.01), 0);
            let roll = Utils.random() * total;
            let template = templates[templates.length - 1];
            for (const t of templates) {
                roll -= (t.chance || 0.01);
                if (roll <= 0) { template = t; break; }
            }
            const ev = WorldEvents._startTimedEvent(world, template);
            if (ev) started.push(ev);
        }
        return { started, ended };
    },

    /**
     * Start a specific event now (e.g. a rebellion born of low stability).
     * opts.kingdomId pins a regional event to that kingdom.
     */
    startEvent(world, id, opts = {}) {
        const template = Object.values(WorldEvents.TEMPLATES || {}).find(t => t.id === id);
        if (!template) return null;
        if (!Array.isArray(world.activeEvents)) world.activeEvents = [];
        return WorldEvents._startTimedEvent(world, template, opts);
    },

    /** Create and register one timed event from a template. */
    _startTimedEvent(world, template, opts = {}) {
        const text0 = template.text || '';
        const regional = /\{(settlement|region|kingdom|kingdom1|faith)\}/.test(text0);
        const paired = /\{kingdom2\}/.test(text0);
        let settlement = null;
        let kingdom = null;
        if (regional) {
            let settlements = (world.getAllSettlements ? world.getAllSettlements() : []).filter(s => s.kingdom);
            if (opts.kingdomId) settlements = settlements.filter(s => s.kingdom === opts.kingdomId);
            if (settlements.length === 0) return null;
            settlement = settlements[Utils.randInt(0, settlements.length - 1)];
            kingdom = world.getKingdom ? world.getKingdom(settlement.kingdom) : null;
        }
        // Two-kingdom events (wars, royal weddings) pick a partner realm
        let partner = null;
        if (paired && kingdom && Array.isArray(world.kingdoms)) {
            const war = template.onStart === 'declareWar';
            const pool = world.kingdoms.filter(k => k.isAlive && k.id !== kingdom.id
                && !(kingdom.wars || []).includes(k.id)
                // no war while a peace treaty holds
                && !(war && ((kingdom.truces || {})[k.id] || 0) > (world.day || 0))
                // wars break out between realms already on poor terms
                && (!war || (!(kingdom.allies || []).includes(k.id) && ((kingdom.relations || {})[k.id] || 0) <= 0)));
            if (pool.length === 0) return null;
            partner = pool[Utils.randInt(0, pool.length - 1)];
        }
        const dur = template.duration || { min: 5, max: 10 };
        const regionName = partner ? `${kingdom.name} & ${partner.name}`
            : (kingdom ? kingdom.name : (settlement ? settlement.name : 'the realm'));
        const kingdomName = kingdom ? kingdom.name : regionName;
        const faithName = (kingdom && kingdom.religion && kingdom.religion.name) || 'faith';
        const text = (template.text || template.description || template.name)
            .replace(/\{settlement\}/g, settlement ? settlement.name : 'the realm')
            .replace(/\{region\}/g, regionName)
            .replace(/\{kingdom1?\}/g, kingdomName)
            .replace(/\{kingdom2\}/g, partner ? partner.name : 'its rivals')
            .replace(/\{faith\}/g, faithName);
        const ev = {
            id: template.id,
            name: template.name,
            icon: template.icon || '📜',
            severity: template.severity,
            effects: { ...(template.effects || {}) },
            kingdomId: settlement ? settlement.kingdom : null,
            partnerKingdomId: partner ? partner.id : null,
            regionName,
            settlementName: settlement ? settlement.name : null,
            q: settlement ? settlement.q : null,
            r: settlement ? settlement.r : null,
            daysLeft: Utils.randInt(dur.min, dur.max),
            text,
        };
        WorldEvents._applyStrike(world, ev, settlement, kingdom, partner, template);
        world.activeEvents.push(ev);
        return ev;
    },

    /** One-off effects that land the moment an event strikes. */
    _applyStrike(world, ev, settlement, kingdom, partner, template) {
        // The live settlement on the map (getAllSettlements returns copies)
        let live = settlement;
        if (settlement && world.getTile) {
            const tile = world.getTile(settlement.q, settlement.r);
            if (tile && tile.settlement) live = tile.settlement;
        }
        if (live && ev.effects.population < 0) {
            live.population = Math.max(10, Math.floor(live.population * (1 + ev.effects.population)));
            if (live !== settlement) settlement.population = live.population;
        }
        // Damaged buildings cut the settlement's output until repaired
        if (live && ev.effects.buildingDamage > 0) {
            live.damage = Math.min(0.9, (live.damage || 0) + ev.effects.buildingDamage);
        }
        if (kingdom && partner) {
            if (!kingdom.relations) kingdom.relations = {};
            if (!partner.relations) partner.relations = {};
            if (template.onStart === 'declareWar') {
                ev.startedWar = true;
                if (!kingdom.wars) kingdom.wars = [];
                if (!partner.wars) partner.wars = [];
                if (!kingdom.wars.includes(partner.id)) kingdom.wars.push(partner.id);
                if (!partner.wars.includes(kingdom.id)) partner.wars.push(kingdom.id);
                kingdom.relations[partner.id] = -100;
                partner.relations[kingdom.id] = -100;
            } else if (template.onStart === 'marriage') {
                kingdom.relations[partner.id] = Utils.clamp((kingdom.relations[partner.id] || 0) + 15, -100, 100);
                partner.relations[kingdom.id] = Utils.clamp((partner.relations[kingdom.id] || 0) + 15, -100, 100);
            }
        }
    },

    /** Does a running event reach this tile? (null tile → realm-wide only) */
    _eventReaches(ev, tile) {
        if (!ev.kingdomId) return true;
        if (!tile) return false;
        const kingdomId = tile.kingdom || (tile.settlement && tile.settlement.kingdom);
        return kingdomId === ev.kingdomId || (!!ev.partnerKingdomId && kingdomId === ev.partnerKingdomId);
    },

    /**
     * Summed modifier for an effect key from running events that reach the
     * tile, e.g. -0.4 for a drought's farmProduction. 0 when none apply.
     */
    getModifier(world, key, tile = null) {
        let total = 0;
        for (const ev of (world && world.activeEvents) || []) {
            if (ev.effects && typeof ev.effects[key] === 'number' && WorldEvents._eventReaches(ev, tile)) total += ev.effects[key];
        }
        return total;
    },

    /**
     * Modifier summed over every running event wherever it is — for
     * world-wide spawn pressure (a regional bandit uprising still adds
     * bandits to the world; hotspots() says where to put them).
     */
    getModifierAnywhere(world, key) {
        let total = 0;
        for (const ev of (world && world.activeEvents) || []) {
            if (ev.effects && typeof ev.effects[key] === 'number') total += ev.effects[key];
        }
        return total;
    },

    /** Settlement coordinates of regional events with a positive `key`. */
    hotspots(world, key) {
        return ((world && world.activeEvents) || [])
            .filter(ev => ev.effects && ev.effects[key] > 0 && typeof ev.q === 'number')
            .map(ev => ({ q: ev.q, r: ev.r }));
    },

    /** Running events that reach a tile, for UI. */
    getEventsAt(world, tile) {
        return ((world && world.activeEvents) || []).filter(ev => WorldEvents._eventReaches(ev, tile));
    },

    /** "Stability −25 · Tax income −30%" for tooltips and the hex panel. */
    describeEffects(ev) {
        const parts = [];
        for (const [key, val] of Object.entries((ev && ev.effects) || {})) {
            const def = WorldEvents.EFFECT_KEYS[key];
            if (!def || typeof val !== 'number' || val === 0) continue;
            const sign = val > 0 ? '+' : '−';
            const mag = def.pct ? `${Math.round(Math.abs(val) * 100)}%` : `${Math.round(Math.abs(val) * 10) / 10}`;
            parts.push(`${def.label} ${sign}${mag}`);
        }
        return parts.join(' · ');
    },

    /**
     * Battle morale shift for the player from events at their tile:
     * morale points / 100 (a festival's +20 → +0.2).
     */
    playerMoraleBonus(world, player) {
        if (!world || !player || !world.getTile) return 0;
        const tile = world.getTile(player.q, player.r);
        return WorldEvents.getModifier(world, 'morale', tile) / 100;
    },

    /**
     * The day's event effects on the player, applied after their stamina is
     * restored: blizzards and floods slow travel; armies camped outside a
     * settlement in a blizzard lose men. Returns { movementChange, unitsLost }.
     */
    applyPlayerDailyEffects(world, player) {
        const result = { movementChange: 0, unitsLost: 0 };
        if (!world || !player || !world.getTile) return result;
        const tile = world.getTile(player.q, player.r);

        const speed = WorldEvents.getModifier(world, 'travelSpeed', tile);
        if (speed !== 0 && player.movementRemaining > 0) {
            const before = player.movementRemaining;
            player.movementRemaining = Math.max(1, Math.round(before * Math.max(0.1, 1 + speed)));
            result.movementChange = player.movementRemaining - before;
        }

        // Attrition: expected daily losses = army × attrition × 20%, rounded
        // stochastically; shelter in a settlement protects the troops.
        const attrition = WorldEvents.getModifier(world, 'unitAttrition', tile);
        const army = player.army || [];
        if (attrition > 0 && army.length > 0 && !(tile && tile.settlement)) {
            const lost = Math.min(army.length, Math.floor(army.length * attrition * 0.2 + Utils.random()));
            for (let i = 0; i < lost; i++) army.pop();
            result.unitsLost = lost;
        }

        WorldEvents._applyPlayerWeather(world, player, tile, result);
        return result;
    },

    /**
     * The weather where the player woke up: storms and snow cost stamina
     * (a road halves the penalty), and a night in the open in a storm,
     * blizzard or heat wave costs health and comfort. Shelter — a settlement,
     * your own house, a ship's cabin — protects you; a deliberate camp halves it.
     */
    _applyPlayerWeather(world, player, tile, result) {
        if (!world.weather || !tile) return;
        const weather = world.weather.getWeather(player.q, player.r);
        const fx = WEATHER_EFFECTS[weather.type] || {};
        result.weather = weather.type;
        result.weatherHealthLost = 0;

        if (fx.travelSpeed && !player.boardedShip && player.movementRemaining > 0) {
            const slow = tile.hasRoad ? fx.travelSpeed / 2 : fx.travelSpeed;
            const before = player.movementRemaining;
            player.movementRemaining = Math.max(1, Math.round(before * (1 + slow)));
            result.movementChange += player.movementRemaining - before;
        }

        if (fx.exposure && !player.boardedShip && !tile.settlement) {
            const rest = player._lastRestType || 'outdoors';
            const sheltered = rest === 'inn' || rest === 'ownHouse';
            if (!sheltered) {
                const lost = rest === 'camp' ? Math.ceil(fx.exposure / 2) : fx.exposure;
                player.health = Math.max(1, (player.health || 0) - lost);
                if (typeof player.modifyNeed === 'function' && player.needs) player.modifyNeed('comfort', -lost * 3);
                result.weatherHealthLost = lost;
            }
        }
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
