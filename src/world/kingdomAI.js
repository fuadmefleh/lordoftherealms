// ============================================
// KINGDOM AI — Kingdom behavior and simulation
// ============================================

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Economy, TradeRoutes } from './economy.js';
import { Kingdom } from './kingdom.js';
import { Religion } from '../systems/religion.js';
import { WorldEvents } from './worldEvents.js';
import { Colonization } from './colonization.js';
import { WEATHER_EFFECTS } from './weather.js';
import { Seasons } from './seasons.js';
import { KingdomBonuses, KingdomStability, KingdomCulture, LordInfluence } from './kingdomState.js';
import { KingdomAtlas } from './kingdomAtlas.js';
import { KingdomNavy } from './kingdomNavy.js';
import { EconomyIndex } from './economyIndex.js';
import { Harvests } from './harvests.js';
import { MoneySupply } from './moneySupply.js';

export const KingdomAI = {
    /**
     * AI personalities that affect behavior
     */
    // Optional behaviour fields (defaults in PERSONALITY_DEFAULTS):
    //   armySize       × the standing army the realm supports
    //   regen          × how fast that army rebuilds
    //   warRatio       how strong (vs the target) it must feel to declare war
    //   recklessChance chance to declare war anyway
    //   sueChance      × the chance it sues for peace when outmatched
    PERSONALITIES: {
        militaristic: {
            expansionChance: 0.3, warChance: 0.4, tradeChance: 0.2,
            armySize: 1.15, regen: 1.5, warRatio: 1.0, recklessChance: 0.02, sueChance: 0.5,
        },
        peaceful: { expansionChance: 0.1, warChance: 0.05, tradeChance: 0.5 },
        mercantile: { expansionChance: 0.15, warChance: 0.1, tradeChance: 0.6 },
        aggressive: { expansionChance: 0.4, warChance: 0.5, tradeChance: 0.1 },
        balanced: { expansionChance: 0.2, warChance: 0.2, tradeChance: 0.3 },
    },

    PERSONALITY_DEFAULTS: { armySize: 1, regen: 1, warRatio: 0.8, recklessChance: 0.1, sueChance: 1 },

    /**
     * Personality id from kingdom traits — pure, no RNG. An 'aggressive'
     * realm stays aggressive; a 'militaristic' one (and no 'aggressive')
     * is militaristic.
     */
    personalityId(kingdom) {
        const traits = (kingdom && kingdom.traits) || [];
        if (traits.includes('aggressive')) return 'aggressive';
        if (traits.includes('militaristic')) return 'militaristic';
        if (traits.includes('peaceful')) return 'peaceful';
        if (traits.includes('mercantile') || traits.includes('naval')) return 'mercantile';
        return 'balanced';
    },

    /**
     * Get AI personality from kingdom traits
     */
    getPersonality(kingdom) {
        const P = KingdomAI.PERSONALITIES;
        return P[KingdomAI.personalityId(kingdom)] || P.balanced;
    },

    /** One behaviour field of the kingdom's personality (with defaults). */
    personalityValue(kingdom, key) {
        const v = KingdomAI.getPersonality(kingdom)[key];
        return typeof v === 'number' ? v : KingdomAI.PERSONALITY_DEFAULTS[key];
    },

    /**
     * Process AI turn for a kingdom
     */
    processTurn(kingdom, world, playerBonuses = {}) {
        if (!kingdom.isAlive) return;

        const personality = KingdomAI.getPersonality(kingdom);

        // Update kingdom economy
        KingdomAI.updateEconomy(kingdom, world, playerBonuses);

        // Stability drifts toward its target; unrest may spark a rebellion
        KingdomStability.processDay(kingdom, world);

        // Faith, scholarship and culture from rulers, lords, traditions, events
        KingdomAI.updateInstitutions(kingdom, world);

        // Consider expansion (ambitious rulers and expansionist lords push out)
        const expansionChance = personality.expansionChance * Math.max(0, 1 + KingdomBonuses.get(kingdom, 'expansion'));
        if (Utils.random() < expansionChance) {
            KingdomAI.tryExpand(kingdom, world);
        }

        // Consider establishing trade routes (merchant princes, masters of trade)
        const tradeChance = personality.tradeChance
            * Math.max(0, 1 + KingdomBonuses.get(kingdom, 'tradeBonus') + KingdomBonuses.get(kingdom, 'caravanProfitBonus'));
        if (Utils.random() < tradeChance) {
            TradeRoutes.establishRoutes(kingdom, world);
        }

        // Consider diplomatic actions
        if (Utils.random() < 0.3) {
            KingdomAI.considerDiplomacy(kingdom, world);
        }

        // Consider war — summer and autumn are campaign season (the same one
        // draw either way, so the season never shifts the RNG stream here)
        if (Utils.random() < personality.warChance * Seasons.campaignFactor(Seasons.today(world))) {
            KingdomAI.considerWar(kingdom, world);
        }

        // A realm ruled by the player is a real power: rivals, balancing
        // alliances and wars of conquest (no RNG draws unless one exists)
        KingdomAI.considerPlayerRealm(kingdom, world);

        // Update military strength
        KingdomAI.updateMilitary(kingdom, world);

        // Build, pay for and lay up the royal fleet (no RNG draws)
        KingdomNavy.updateFleet(kingdom, world);
    },

    /**
     * Update kingdom economy from all settlements
     */
    updateEconomy(kingdom, world, playerBonuses = {}) {
        let totalGold = 0;
        let totalFood = 0;
        let totalGoods = 0;
        let totalPopulation = 0;

        const settlements = KingdomAI._settlementCopiesOf(kingdom, world);

        // Growth bonuses from healers/stewards; growth and food modifiers from events
        const growthBonus = KingdomBonuses.get(kingdom, 'population');
        const repairRate = 0.01 * Math.max(0.2, 1 + KingdomBonuses.get(kingdom, 'construction'));

        for (const settlement of settlements) {
            const tile = world.getTile(settlement.q, settlement.r);
            if (!tile) continue;
            // getAllSettlements returns copies — share the live economy object
            if (tile.settlement) {
                Economy.initSettlement(tile.settlement);
                settlement.economy = tile.settlement.economy;
            }

            const eventGrowth = WorldEvents.getModifier(world, 'populationGrowth', tile);
            const eventConsumption = WorldEvents.getModifier(world, 'foodConsumption', tile);

            // Process daily production
            Economy.produceDaily(settlement, tile, world, playerBonuses, {
                growth: growthBonus + eventGrowth,
                consumption: eventConsumption,
                damage: tile.settlement ? (tile.settlement.damage || 0) : 0,
                // Frontier colonies work to their policy (Exploitation strips the land)
                production: Colonization.getProductionBonus(tile.settlement, kingdom),
            });

            if (tile.settlement) {
                // The food model's growth or hunger sticks to the real settlement
                tile.settlement.population = settlement.population;
                // Lasting drift of the real settlement: gold rushes and refugee
                // waves swell it, plagues and strained granaries shrink it,
                // healers and stewards help (0.1%/day per +1.0 of modifier)
                const drift = (eventGrowth - eventConsumption * 0.5 + growthBonus * 0.5) * 0.001;
                if (drift !== 0 && tile.settlement.population > 0) {
                    tile.settlement.population = Math.max(10, Math.round(tile.settlement.population * (1 + drift)));
                    settlement.population = tile.settlement.population;
                }
                // Builders repair storm and quake damage
                if (tile.settlement.damage > 0) {
                    // ...faster with stone and timber close at hand
                    const rb = tile.settlement.economy && tile.settlement.economy.resourceBonuses;
                    const localRepair = repairRate * (1 + ((rb && rb.construction) || 0) * Economy.effectScale('repair'));
                    tile.settlement.damage = Math.max(0, Math.round((tile.settlement.damage - localRepair) * 1000) / 1000);
                }
            }

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
        kingdom.population = totalPopulation;
        kingdom.food = totalFood;
        kingdom.goods = totalGoods;

        // Treasury is a ledger: it gains the day's new settlement gold scaled by
        // stewardship, tax policy, events and stability, so spending elsewhere
        // (scandals, war upkeep, colonies, espionage) actually sticks.
        const mult = KingdomAI.incomeMultiplier(kingdom, world);
        if (typeof kingdom.treasuryIncomeBase !== 'number') {
            kingdom.treasury = Math.floor(totalGold * mult);
        } else {
            const income = totalGold - kingdom.treasuryIncomeBase;
            kingdom.treasury = Math.floor((kingdom.treasury || 0) + (income > 0 ? income * mult : income));
        }
        kingdom.treasuryIncomeBase = totalGold;

        // Armies in the field cost money (frugal rulers spend less; war events more)
        if (kingdom.wars && kingdom.wars.length > 0) {
            kingdom.treasury = Math.max(0, kingdom.treasury - KingdomAI.warUpkeep(kingdom, world));
        }
    },

    /** Multiplier on a kingdom's daily income. */
    incomeMultiplier(kingdom, world) {
        const capitalTile = kingdom.capital ? world.getTile(kingdom.capital.q, kingdom.capital.r) : null;
        const eventTax = WorldEvents.getModifier(world, 'taxIncome', capitalTile || { kingdom: kingdom.id });
        const bonus = KingdomBonuses.get(kingdom, 'treasury') + KingdomBonuses.get(kingdom, 'stewardship') * 0.5
            + KingdomBonuses.get(kingdom, 'tax') + eventTax
            + LordInfluence.incomeBonus(kingdom); // the lord's own stewardship
        return Math.max(0.1, 1 + bonus) * KingdomStability.incomeMultiplier(kingdom)
            * KingdomNavy.incomeFactor(kingdom) // a blockade strangles the port trade
            * MoneySupply.incomeFactor(world, kingdom); // a realm drained of coin yields less tax (world/moneySupply.js)
    },

    /** Daily gold spent keeping armies in the field while at war. */
    warUpkeep(kingdom, world) {
        const spending = WorldEvents.getModifier(world, 'militarySpending', { kingdom: kingdom.id });
        // A lord bent on survival keeps his armies lean (lordModifiers.upkeep)
        const factor = Math.max(0.2, 1 + KingdomBonuses.get(kingdom, 'upkeep') + spending + LordInfluence.mod(kingdom, 'upkeep'));
        return Math.floor((kingdom.military || 0) * 0.01 * factor);
    },

    /**
     * Piety, scholarship and cultural influence move with the realm's
     * leadership and with running events (comets fill temples, schisms breed
     * heresy). Royal weddings also warm relations between the two houses.
     */
    updateInstitutions(kingdom, world) {
        const ref = { kingdom: kingdom.id };
        if (kingdom.religion && typeof kingdom.religion.piety === 'number') {
            // Temples a pious lord funded keep filling the pews and the coffers
            const temples = KingdomAI.templeEffects(kingdom);
            if (temples.income) kingdom.treasury = (kingdom.treasury || 0) + temples.income;
            if (temples.scholarship && kingdom.cultureData && typeof kingdom.cultureData.scholarship === 'number') {
                kingdom.cultureData.scholarship = Math.min(100, kingdom.cultureData.scholarship + temples.scholarship);
            }
            const piety = KingdomBonuses.get(kingdom, 'faith') * 0.5 + WorldEvents.getModifier(world, 'piety', ref) + temples.piety;
            kingdom.religion.piety = Utils.clamp(kingdom.religion.piety + piety, 0, 100);
            const heresy = WorldEvents.getModifier(world, 'heresySpread', ref);
            if (heresy > 0 && Array.isArray(kingdom.religion.heresies) && typeof Religion !== 'undefined'
                && Utils.random() < heresy * 0.1) {
                Religion.spawnHeresy(kingdom, world);
            }
        }
        if (kingdom.cultureData) {
            const cd = kingdom.cultureData;
            if (typeof cd.scholarship === 'number') cd.scholarship = Math.min(100, cd.scholarship + KingdomBonuses.get(kingdom, 'research') * 0.2);
            if (typeof cd.influence === 'number') cd.influence = Math.min(100, cd.influence + KingdomBonuses.get(kingdom, 'culture') * 0.2);
            // Book fairs, exhibitions, spirit walks, ... while they run
            KingdomCulture.applyEvents(kingdom);
        }
        for (const ev of world.activeEvents || []) {
            if (ev.kingdomId !== kingdom.id || !ev.partnerKingdomId || !(ev.effects && ev.effects.relations)) continue;
            const partner = world.getKingdom(ev.partnerKingdomId);
            if (!partner) continue;
            if (!kingdom.relations) kingdom.relations = {};
            if (!partner.relations) partner.relations = {};
            kingdom.relations[partner.id] = Utils.clamp((kingdom.relations[partner.id] || 0) + ev.effects.relations, -100, 100);
            partner.relations[kingdom.id] = Utils.clamp((partner.relations[kingdom.id] || 0) + ev.effects.relations, -100, 100);
        }
    },

    // ══════════════════════════════════════════════
    // TEMPLES — funded by lords with a 'faith' goal
    // ══════════════════════════════════════════════

    /** Daily effect per pietyBonus / incomeBonus / scholarshipBonus point. */
    TEMPLE_RATES: { piety: 0.01, income: 0.1, scholarship: 0.01 },

    /** Daily piety, gold and scholarship from the realm's temples. */
    templeEffects(kingdom) {
        const out = { piety: 0, income: 0, scholarship: 0, unity: 0 };
        const temples = kingdom && kingdom.temples;
        if (!Array.isArray(temples) || !temples.length) return out;
        const types = (Religion && Religion.KINGDOM_BUILDING_TYPES) || {};
        const R = KingdomAI.TEMPLE_RATES;
        for (const t of temples) {
            const def = types[t.type];
            if (!def) continue;
            out.piety += (def.pietyBonus || 0) * R.piety;
            out.income += (def.incomeBonus || 0) * R.income;
            out.scholarship += (def.scholarshipBonus || 0) * R.scholarship;
        }
        out.income = Math.floor(out.income);
        // unityBonus raises the faith's unity (applied by Religion.processTurn)
        out.unity = Religion.templeUnity(kingdom);
        return out;
    },

    /**
     * Fund the next temple the realm lacks and can afford: a chapel per
     * settlement, up to two monasteries, one cathedral. Returns the temple.
     */
    fundTemple(kingdom, world) {
        if (!kingdom.religion) return null;
        const types = (Religion && Religion.KINGDOM_BUILDING_TYPES) || {};
        if (!Array.isArray(kingdom.temples)) kingdom.temples = [];
        const temples = kingdom.temples;
        const count = (type) => temples.filter(t => t.type === type).length;
        const towns = KingdomAI._settlementsOf(kingdom, world);
        const wants = [
            ['cathedral', count('cathedral') < 1 && towns.length >= 3],
            ['monastery_npc', count('monastery_npc') < 2],
            ['chapel', count('chapel') < towns.length],
        ];
        for (const [type, wanted] of wants) {
            const def = types[type];
            if (!wanted || !def) continue;
            // Never spend more than a third of the treasury on stone and bells
            if ((kingdom.treasury || 0) < def.cost * 3) continue;
            kingdom.treasury -= def.cost;
            const town = towns.length ? towns[temples.length % towns.length] : null;
            const temple = { type, day: KingdomAI._day(world), at: town ? town.settlement.name : null };
            temples.push(temple);
            if (Array.isArray(world.events)) {
                world.events.push({
                    text: `${def.icon} ${kingdom.name} raises a ${def.name.toLowerCase()}${temple.at ? ` in ${temple.at}` : ''}.`,
                    type: 'religious',
                    kingdom: kingdom.id,
                });
            }
            return temple;
        }
        return null;
    },

    /**
     * Try to expand territory
     */
    tryExpand(kingdom, world) {
        if (!kingdom.capital) return;

        // Find border tiles
        const borderTiles = [];
        const seen = new Set();
        for (const hex of kingdom.territory) {
            const neighbors = Hex.neighbors(hex.q, hex.r);
            for (const n of neighbors) {
                const tile = world.getTile(n.q, n.r);
                if (tile && tile.terrain.passable && !tile.kingdom) {
                    // Check if not already in list
                    const key = `${n.q},${n.r}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        borderTiles.push({ q: n.q, r: n.r, tile });
                    }
                }
            }
        }

        if (borderTiles.length === 0) return;

        // Claim a border tile — of the realm's favoured terrain when it can
        // (still one pick, so expansion draws no extra randomness)
        const favoured = borderTiles.filter(t => Kingdom.prefersTerrain(kingdom, t.tile.terrain && t.tile.terrain.id));
        const target = Utils.randPick(favoured.length ? favoured : borderTiles);
        target.tile.kingdom = kingdom.id;
        kingdom.territory.push({ q: target.q, r: target.r });

        // Small chance to found a new settlement
        // Master builders and stewards found more villages
        if (Utils.random() < 0.1 * Math.max(0.2, 1 + KingdomBonuses.get(kingdom, 'construction')) && !target.tile.settlement) {
            target.tile.settlement = {
                type: 'village',
                name: Kingdom.generateCityName(kingdom.culture, world),
                population: Utils.randInt(100, 500),
                level: 0,
                kingdom: kingdom.id,
            };
            if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
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
        // Diplomacy from ruler, chancellor, lord and tradition; succession
        // crises and crusades sour every envoy
        const diplomacy = KingdomBonuses.get(kingdom, 'diplomacy') + KingdomBonuses.get(kingdom, 'relations')
            + WorldEvents.getModifier(world, 'diplomacy', { kingdom: kingdom.id })
            + LordInfluence.diplomacyBonus(kingdom); // a shrewd lord's envoys
        if (diplomacy) change += Math.floor(diplomacy * 10);
        // Cultural pull: a far more influential realm is admired
        change += KingdomCulture.admiration(kingdom, target);
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

        // Break alliance if relations deteriorate (honorable lords stand by
        // their allies longer; faithless ones drop them at the first slight)
        if (kingdom.relations[target.id] < LordInfluence.allianceFloor(kingdom) && kingdom.allies.includes(target.id)) {
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
        // A player-ruled realm declares war only on its ruler's word, unless
        // the crown's war stance lets its marshals act (systems/throne.js)
        const crown = kingdom.crown;
        if (crown && crown.playerRuled && !(crown.policies && crown.policies.stance === 'aggressive')) return;
        const otherKingdoms = world.kingdoms.filter(k =>
            k.isAlive &&
            k.id !== kingdom.id &&
            !kingdom.allies.includes(k.id) &&
            !kingdom.wars.includes(k.id) &&
            !KingdomAI.hasTruce(kingdom, k, world) &&
            !KingdomAI.foundingPeace(kingdom, k, world)
        );
        // A realm already fighting two wars doesn't open a third
        if (kingdom.wars.length >= 2) return;

        if (otherKingdoms.length === 0) return;

        // Find kingdoms with poor relations
        const enemies = otherKingdoms.filter(k => (kingdom.relations[k.id] || 0) < -30);
        if (enemies.length === 0) return;

        // A realm whose cartographers have charted a rival marches on it first
        const target = Utils.randPick(KingdomAtlas.preferCharted(kingdom, enemies));

        // Only declare war if we're stronger or desperate. The lord's war
        // appetite (ambition, domination, honor) shifts how strong is enough.
        const ourStrength = (kingdom.military + kingdom.population * 0.1) * LordInfluence.warAppetite(kingdom);
        const theirStrength = target.military + target.population * 0.1;

        // A militaristic realm marches only when it is at least as strong
        // and seldom gambles; others accept 80% and take a 10% gamble
        const warRatio = KingdomAI.personalityValue(kingdom, 'warRatio');
        // Campaign season: dry roads and full granaries embolden a realm in
        // summer and autumn; few march into the winter mud and snow
        const season = Seasons.campaignFactor(Seasons.today(world));
        // ...and a realm whose bread is dear has little stomach for a war (world/economyIndex.js; 1 until measured)
        const confidence = (1 + (season - 1) * 0.5) * EconomyIndex.warConfidence(world, kingdom);
        const reckless = KingdomAI.personalityValue(kingdom, 'recklessChance') * season;
        if (ourStrength * confidence > theirStrength * warRatio || Utils.random() < reckless) {
            KingdomAI.startWar(kingdom, target, world);
            world.events.push({
                text: `⚔️ ${kingdom.name} has declared war on ${target.name}!`,
                type: 'military'
            });
        }
    },

    /** The living kingdom the player rules (kingdom.crown, systems/throne.js), or null. */
    playerRealm(world) {
        return ((world && world.kingdoms) || []).find(k => k.isAlive && k.crown && k.crown.playerRuled) || null;
    },

    /** A realm's rough might: its army plus a tenth of its people. */
    _might(kingdom) {
        return (kingdom.military || 0) + (kingdom.population || 0) * 0.1;
    },

    /**
     * Weekly regard for the player's realm (data/kingship.json → config.ai):
     *  - envy: a stronger crown nearby sours relations (more so for an ambitious lord);
     *  - bandwagoning: weaker peaceful or mercantile realms on good terms warm to it;
     *  - balancing: when it is the mightiest realm, wary realms ally against it;
     *  - conquest: a hostile neighbour marches on it when strong enough — and
     *    sooner when it is weak (a revolt, a civil war, low stability).
     * Draws no RNG unless the player rules a realm and it is this realm's day.
     */
    considerPlayerRealm(kingdom, world) {
        const realm = KingdomAI.playerRealm(world);
        if (!realm || realm === kingdom || !kingdom.isAlive) return;
        const A = (DataLoader.kingship && DataLoader.kingship.config && DataLoader.kingship.config.ai) || {};
        const cadence = A.cadence || 7;
        const idx = world.kingdoms.indexOf(kingdom);
        if (((world.day || 0) + idx) % cadence !== 0) return;
        if (!kingdom.relations) kingdom.relations = {};
        if (!realm.relations) realm.relations = {};
        const rel = kingdom.relations[realm.id] || 0;
        const ours = KingdomAI._might(kingdom) * LordInfluence.warAppetite(kingdom);
        const theirs = KingdomAI._might(realm);
        const ratio = theirs / Math.max(1, KingdomAI._might(kingdom));
        const near = kingdom.capital && realm.capital
            && Hex.wrappingDistance(kingdom.capital.q, kingdom.capital.r, realm.capital.q, realm.capital.r, world.width) <= (A.nearCapitals || 28);
        const allied = (kingdom.allies || []).includes(realm.id);
        const atWar = (kingdom.wars || []).includes(realm.id);
        const shift = (v) => { kingdom.relations[realm.id] = Utils.clamp((kingdom.relations[realm.id] || 0) + v, -100, 100); };

        if (!allied && !atWar && near && ratio > (A.envyRatio || 1.2)) {
            shift((A.envy || -2) + (LordInfluence.lean(kingdom, 'ambition') > 0 ? (A.ambitionEnvy || -1) : 0));
        }
        const pid = KingdomAI.personalityId(kingdom);
        if (!atWar && ratio > 1 && rel > (A.bandwagonRelations || 20) && (pid === 'peaceful' || pid === 'mercantile')) {
            shift(A.bandwagon || 2);
        }
        // Balance of power: ally with a like-minded realm against the mightiest crown
        if (!allied && rel < 0 && theirs >= Math.max(...world.kingdoms.filter(k => k.isAlive).map(KingdomAI._might))
            && ratio > (A.balanceRatio || 1.3)) {
            const partner = world.kingdoms
                .filter(k => k.isAlive && k !== kingdom && k !== realm && !(kingdom.allies || []).includes(k.id)
                    && !(kingdom.wars || []).includes(k.id) && (k.relations && (k.relations[realm.id] || 0) < 0)
                    && (kingdom.relations[k.id] || 0) >= (A.balanceMinRelations || 10))
                .sort((a, b) => (kingdom.relations[b.id] || 0) - (kingdom.relations[a.id] || 0))[0];
            if (partner && Utils.random() < (A.balanceChance || 0.2)) {
                kingdom.allies.push(partner.id);
                partner.allies.push(kingdom.id);
                kingdom.relations[partner.id] = Math.max(kingdom.relations[partner.id] || 0, 60);
                if (!partner.relations) partner.relations = {};
                partner.relations[kingdom.id] = Math.max(partner.relations[kingdom.id] || 0, 60);
                world.events.push({ text: `🤝 ${kingdom.name} and ${partner.name} ally against the might of ${realm.name}.`, type: 'diplomatic' });
            }
        }
        // Wars of conquest against the player's crown
        if (atWar || allied || !near || KingdomAI.hasTruce(kingdom, realm, world) || (kingdom.wars || []).length >= 2) return;
        if ((kingdom.relations[realm.id] || 0) >= (A.warRelations || -20)) return;
        const crown = realm.crown || {};
        const weak = !!crown.revolt || !!crown.civilWar || (typeof realm.stability === 'number' && realm.stability < (A.weakStability || 35));
        const need = weak ? (A.weakWarRatio || 0.6) : (A.warRatio || 0.9);
        if (ours > theirs * need && Utils.random() < (A.warChance || 0.25)) {
            KingdomAI.startWar(kingdom, realm, world);
            world.events.push({
                text: weak ? `⚔️ Scenting weakness, ${kingdom.name} marches on ${realm.name}!` : `⚔️ ${kingdom.name} declares a war of conquest on ${realm.name}!`,
                type: 'military', kingdom: realm.id,
            });
        }
    },

    /**
     * End a war between two kingdoms (pious lords sue for peace). Called by
     * NPCLords' 'peace' goal — it was referenced but never defined.
     */
    makePeace(kingdom, enemy, world) {
        if (!kingdom || !enemy) return false;
        if (!(kingdom.wars || []).includes(enemy.id)) return false;
        KingdomAI.endWar(kingdom, enemy, world, { text: `🕊️ ${kingdom.name} and ${enemy.name} have made peace.` });
        return true;
    },

    // ══════════════════════════════════════════════
    // WAR LIFECYCLE — goals, exhaustion, peace, truces
    // ══════════════════════════════════════════════

    /** Tuning for kingdom-vs-kingdom wars. */
    WAR: {
        battleChance: 0.3,        // a war sees a pitched battle about every third day
        truceDays: 180,           // no new war between the two for this long after peace
        goalTiles: [3, 8],        // tiles the aggressor wants before it settles
        weariness: 0.00006,       // daily peace chance grows by this per day of war
        maxWeariness: 0.02,
        sueRatio: 0.5,            // a side this outmatched may sue for peace
        sueChance: 0.06,
        tribute: 0.2,             // share of the loser's treasury paid to the victor
        settlementDefense: 1.25,  // defending a walled town
        capitalDefense: 1.5,      // defending the capital
        regen: 0.04,              // armies rebuild this share of the gap each day
        demob: 0.2,               // and shrink this fast when the realm can't support them
        // A realm down to its last town fights for its life, and may yet buy
        // its survival: when that town is about to fall it capitulates (the
        // victor's terms, this share of its treasury as tribute) with this
        // chance — less against an ambitious lord (docs/world-stability.md)
        foundingPeace: [45, 120],   // days: the first peace between each pair of realms
        lastStand: 1.5,
        capitulate: 0.8,
        capitulateTribute: 0.4,
    },

    _day(world) { return (world && world.day) || 0; },

    /**
     * The new crowns' first peace: no realm marches on another before day
     * WAR.foundingPeace[0]–[1] (a hash of the pair, so the first wars come
     * staggered), while the young realms of one or two towns found their
     * villages. Draws no RNG.
     */
    foundingPeace(a, b, world) {
        const [lo, hi] = KingdomAI.WAR.foundingPeace;
        const day = KingdomAI._day(world);
        if (day >= hi) return false;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        return day < lo + ((Utils.hashStr(`peace:${key}`) >>> 0) % Math.max(1, hi - lo));
    },

    /** True while a peace treaty forbids these two from fighting. */
    hasTruce(a, b, world) {
        const until = a.truces && a.truces[b.id];
        return !!until && until > KingdomAI._day(world);
    },

    /** Per-enemy war bookkeeping, created on first use (wars started anywhere). */
    _warState(kingdom, enemyId, world) {
        if (!kingdom.warState) kingdom.warState = {};
        if (!kingdom.warState[enemyId]) {
            const [lo, hi] = KingdomAI.WAR.goalTiles;
            kingdom.warState[enemyId] = { since: KingdomAI._day(world), gains: 0, goal: Utils.randInt(lo, hi) };
        }
        return kingdom.warState[enemyId];
    },

    /** Declare war between two kingdoms with fresh war goals. */
    startWar(kingdom, target, world) {
        if (!kingdom.wars.includes(target.id)) kingdom.wars.push(target.id);
        if (!target.wars.includes(kingdom.id)) target.wars.push(kingdom.id);
        if (kingdom.warState) delete kingdom.warState[target.id];
        if (target.warState) delete target.warState[kingdom.id];
        KingdomAI._warState(kingdom, target.id, world);
        KingdomAI._warState(target, kingdom.id, world);
        if (!kingdom.relations) kingdom.relations = {};
        if (!target.relations) target.relations = {};
        kingdom.relations[target.id] = -100;
        target.relations[kingdom.id] = -100;
    },

    /**
     * End a war: both sides sign a truce; a victor takes tribute from the
     * loser's treasury. opts: { victor, text }.
     */
    endWar(a, b, world, opts = {}) {
        a.wars = (a.wars || []).filter(id => id !== b.id);
        b.wars = (b.wars || []).filter(id => id !== a.id);
        if (a.warState) delete a.warState[b.id];
        if (b.warState) delete b.warState[a.id];
        const until = KingdomAI._day(world) + KingdomAI.WAR.truceDays;
        if (!a.truces) a.truces = {};
        if (!b.truces) b.truces = {};
        // Each side keeps the truce as long as its lord's honor allows
        // (never less than half the treaty)
        const minUntil = KingdomAI._day(world) + Math.floor(KingdomAI.WAR.truceDays / 2);
        a.truces[b.id] = Math.max(minUntil, until + LordInfluence.truceBonusDays(a));
        b.truces[a.id] = Math.max(minUntil, until + LordInfluence.truceBonusDays(b));
        if (!a.relations) a.relations = {};
        if (!b.relations) b.relations = {};
        a.relations[b.id] = Math.max(a.relations[b.id] || 0, -40);
        b.relations[a.id] = Math.max(b.relations[a.id] || 0, -40);

        let tribute = 0;
        const victor = opts.victor || null;
        if (victor) {
            const loser = victor === a ? b : a;
            tribute = Math.floor(Math.max(0, loser.treasury || 0) * (opts.tribute != null ? opts.tribute : KingdomAI.WAR.tribute));
            loser.treasury = (loser.treasury || 0) - tribute;
            victor.treasury = (victor.treasury || 0) + tribute;
            // The loser raises it from its people; the victor spends it: coin crosses the border (world/moneySupply.js)
            if (tribute > 0 && world) MoneySupply.transfer(world, loser.id, victor.id, tribute, 'tribute');
        }
        // Recent war outcomes (the player's share of a liege's victory reads these)
        if (world) {
            if (!Array.isArray(world.warHistory)) world.warHistory = [];
            world.warHistorySeq = (world.warHistorySeq || 0) + 1;
            world.warHistory.push({ id: world.warHistorySeq, day: KingdomAI._day(world), a: a.id, b: b.id, victor: victor ? victor.id : null, tribute });
            if (world.warHistory.length > 100) world.warHistory.splice(0, world.warHistory.length - 100);
        }
        if (world && Array.isArray(world.events)) {
            const loserName = victor ? (victor === a ? b.name : a.name) : null;
            const text = opts.text || (victor
                ? `🕊️ ${loserName} sues for peace with ${victor.name}${tribute ? `, paying ${tribute} gold in tribute` : ''}.`
                : `🕊️ Weary of war, ${a.name} and ${b.name} sign a truce.`);
            world.events.push({ text, type: 'diplomatic' });
        }
        return { tribute };
    },

    /** Daily check whether a war ends: goals met, the weak sue, or both tire. */
    _resolveWar(a, b, world) {
        const W = KingdomAI.WAR;
        const sa = KingdomAI._warState(a, b.id, world);
        const sb = KingdomAI._warState(b, a.id, world);
        // War goals met — the winner dictates terms
        if (sa.gains >= sa.goal) return KingdomAI.endWar(a, b, world, { victor: a });
        if (sb.gains >= sb.goal) return KingdomAI.endWar(a, b, world, { victor: b });
        // A badly outmatched side sues for peace
        for (const [weak, strong] of [[a, b], [b, a]]) {
            // Militaristic realms are slow to sue
            if ((weak.military || 0) < (strong.military || 0) * W.sueRatio
                && Utils.random() < W.sueChance * KingdomAI.personalityValue(weak, 'sueChance')) {
                return KingdomAI.endWar(a, b, world, { victor: strong });
            }
        }
        // Long wars wear both realms down
        const days = KingdomAI._day(world) - Math.min(sa.since, sb.since);
        if (Utils.random() < Math.min(W.maxWeariness, days * W.weariness)) {
            return KingdomAI.endWar(a, b, world);
        }
        return null;
    },

    /**
     * A realm whose last town is about to fall sues for terms: with
     * WAR.capitulate (less against an ambitious lord, more against an
     * honourable one) the victor takes WAR.capitulateTribute of its treasury
     * and a truce instead of the town. → true when the war ended so.
     */
    _capitulates(attacker, defender, world) {
        const W = KingdomAI.WAR;
        const chance = Utils.clamp(W.capitulate * (1 - LordInfluence.lean(attacker, 'ambition') * 0.3 + LordInfluence.lean(attacker, 'honor') * 0.2), 0, 0.9);
        if (!(chance > 0) || Utils.random() >= chance) return false;
        const town = (KingdomAI._settlementsOf(defender, world)[0] || {}).settlement;
        KingdomAI.endWar(attacker, defender, world, {
            victor: attacker, tribute: W.capitulateTribute,
            text: `🏳️ Besieged in ${town ? town.name : 'its last town'}, ${defender.name} capitulates to ${attacker.name} and pays for its survival.`,
        });
        return true;
    },

    /** A defeated realm leaves every war; its last tiles pass to the conqueror. */
    _collapse(defender, attacker, world) {
        defender.isAlive = false;
        defender.conqueredBy = attacker.id;
        defender.conqueredDay = KingdomAI._day(world);
        for (const t of defender.territory) {
            const tile = world.getTile(t.q, t.r);
            if (tile && tile.kingdom === defender.id) {
                tile.kingdom = attacker.id;
                attacker.territory.push(t);
            }
        }
        defender.territory = [];
        for (const k of world.kingdoms) {
            if (k.wars) k.wars = k.wars.filter(id => id !== defender.id);
            if (k.warState) delete k.warState[defender.id];
        }
        defender.wars = [];
        world.events.push({ text: `💀 ${defender.name} has been conquered by ${attacker.name}!`, type: 'military' });
    },

    /**
     * world.getAllSettlements().filter(s => s.kingdom === kingdom.id) — copies,
     * in map order — without copying every other realm's towns.
     */
    _settlementCopiesOf(kingdom, world) {
        if (typeof world.getSettlementsOf === 'function') return world.getSettlementsOf(kingdom.id);
        return world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
    },

    /** The same settlements, live and uncopied — for read-only use. */
    _settlementViewsOf(kingdom, world) {
        if (typeof world.getSettlementViews === 'function') return world.getSettlementViews().filter(s => s.kingdom === kingdom.id);
        return world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
    },

    /** Tiles of settlements still flying this kingdom's banner. */
    _settlementsOf(kingdom, world) {
        const out = [];
        for (const t of kingdom.territory) {
            const tile = world.getTile(t.q, t.r);
            if (tile && tile.settlement && tile.settlement.kingdom === kingdom.id) out.push({ q: t.q, r: t.r, settlement: tile.settlement });
        }
        return out;
    },

    // ══════════════════════════════════════════════
    // RESTORATION — fallen realms rise again
    // ══════════════════════════════════════════════

    // Daily chance per old town = chance × (calm − occupier stability) / 15,
    // capped at 3× — none under a content occupier (stability ≥ calm).
    // `unrest` marks a restless occupier (players funding a rising do better).
    RESTORATION: { calm: 75, chance: 0.0015, maxScale: 3, unrest: 45, minDays: 120, radius: 2 },

    /** Daily chance that an old town rises against an occupier at this stability. */
    restorationChance(occupier) {
        const R = KingdomAI.RESTORATION;
        const stability = occupier.stability != null ? occupier.stability : 60;
        return R.chance * Utils.clamp((R.calm - stability) / 15, 0, R.maxScale);
    },

    /**
     * A fallen kingdom's old settlement may throw off its occupier's rule and
     * restore the old crown — likelier the less content the occupier's realm.
     */
    processRestorations(world) {
        const R = KingdomAI.RESTORATION;
        const day = KingdomAI._day(world);
        for (const fallen of world.kingdoms) {
            if (fallen.isAlive || fallen.conqueredDay == null) continue;
            if (day - fallen.conqueredDay < R.minDays) continue;
            for (const s of (world.getSettlementViews ? world.getSettlementViews() : world.getAllSettlements())) {
                const tile = world.getTile(s.q, s.r);
                const live = tile && tile.settlement;
                if (!live || live.formerKingdom !== fallen.id) continue;
                const occupier = world.getKingdom(live.kingdom);
                if (!occupier || !occupier.isAlive) continue;
                const chance = KingdomAI.restorationChance(occupier);
                if (chance <= 0 || Utils.random() >= chance) continue;
                KingdomAI.restoreKingdom(fallen, occupier, { q: s.q, r: s.r, tile }, world);
                break;
            }
        }
    },

    /** Bring a fallen kingdom back around one of its old settlements. */
    restoreKingdom(fallen, occupier, seat, world) {
        const R = KingdomAI.RESTORATION;
        const { q: sq, r: sr, tile } = seat;
        fallen.isAlive = true;
        fallen.conqueredDay = null;
        fallen.conqueredBy = null;
        fallen.capital = { q: sq, r: sr };
        fallen.territory = [];
        const taken = new Set();
        for (const h of Hex.hexesInRange(sq, sr, R.radius)) {
            const q = Hex.wrapQ(h.q, world.width);
            const t = world.getTile(q, h.r);
            if (!t || t.kingdom !== occupier.id) continue;
            if (t.settlement && t !== tile) continue; // only the rising town itself changes hands
            t.kingdom = fallen.id;
            fallen.territory.push({ q, r: h.r });
            taken.add(`${q},${h.r}`);
        }
        occupier.territory = occupier.territory.filter(t => !taken.has(`${t.q},${t.r}`));
        tile.settlement.kingdom = fallen.id;
        delete tile.settlement.formerKingdom;
        fallen.population = tile.settlement.population || 0;
        fallen.military = Math.floor(fallen.population * 0.08);
        fallen._militaryInit = true;
        fallen.stability = 55;
        fallen.treasury = Math.max(fallen.treasury || 0, 200);
        fallen.wars = [];
        fallen.truces = {};
        fallen.navy = null; // the old fleet is long gone; a new one is counted tomorrow
        KingdomAI.startWar(fallen, occupier, world);
        world.events.push({ text: `🔥 ${tile.settlement.name} throws off ${occupier.name}'s rule — ${fallen.name} rises again!`, type: 'military' });
    },

    /**
     * Update military strength based on population and resources
     */
    updateMilitary(kingdom, world) {
        // Base military from population (5% of population)
        let military = Math.floor(kingdom.population * 0.05);

        // Iron and horses near any settlement arm the realm — once each (they
        // used to multiply per deposit per town, snowballing big kingdoms)
        const settlements = KingdomAI._settlementViewsOf(kingdom, world); // read-only: positions
        let hasIron = false, hasHorses = false;
        // Best recruiting ground in the realm: armies regrow faster where
        // iron, horses or coal are at hand (resourceBonuses.military)
        let recruiting = 0;
        for (const settlement of settlements) {
            const tile = world.getTile(settlement.q, settlement.r);
            if (!tile) continue;
            for (const res of Economy.getNearbyResources(settlement.q, settlement.r, world, 2)) {
                if (res.id === 'iron') hasIron = true;
                if (res.id === 'horses') hasHorses = true;
            }
            recruiting = Math.max(recruiting, Economy.resourceBonus(world, settlement.q, settlement.r, 'military'));
        }
        if (hasIron) military *= 1.2;
        if (hasHorses) military *= 1.15;

        // Ruler, generals and martial traditions
        military *= Math.max(0.1, 1 + KingdomBonuses.get(kingdom, 'military'));
        // A lord bent on domination keeps a larger standing army
        military *= Math.max(0.1, 1 + LordInfluence.mod(kingdom, 'military'));
        // So does a militaristic realm
        military *= KingdomAI.personalityValue(kingdom, 'armySize');

        // Blizzards and the like thin the ranks (hardy traditions endure)
        const attrition = WorldEvents.getModifier(world, 'unitAttrition', { kingdom: kingdom.id });
        if (attrition > 0) military *= 1 - Utils.clamp(attrition * (1 - KingdomBonuses.get(kingdom, 'endurance')), 0, 0.9);

        // The realm can support `military`; armies rebuild toward it over
        // time, so battle losses matter, and shed men fast when land is lost
        const cap = Math.floor(military);
        kingdom.militaryCap = cap;
        if (!kingdom._militaryInit) {
            kingdom.military = cap;
            kingdom._militaryInit = true;
        } else {
            const cur = Math.floor(kingdom.military || 0);
            if (cap > cur) {
                // Recruitment refills the ranks, never past what the realm
                // supports; good recruiting ground and drilled militaristic
                // realms refill them faster
                // ...and a royal Marshal or conscription (kingdom.crown, systems/kingship.js)
                const regen = Math.min(1, KingdomAI.WAR.regen * KingdomAI.personalityValue(kingdom, 'regen')
                    * (1 + recruiting * Economy.effectScale('armyRegen'))
                    * Math.max(0.2, 1 + KingdomBonuses.get(kingdom, 'militaryRegen')));
                kingdom.military = cur;
                Kingdom.recruitTroops(kingdom, (cap - cur) * regen);
            } else {
                kingdom.military = Math.floor(cur + (cap - cur) * KingdomAI.WAR.demob);
            }
            if (attrition > 0 && kingdom.military > cap) kingdom.military = cap;
        }
    },

    /**
     * How fit the season is for campaigning between two realms: the weather
     * at the defender's capital scales the day's battle chance by
     * 1 + travelSpeed (a blizzard halves it; fair skies leave it be).
     */
    campaignWeather(kingdom, enemy, world) {
        const front = enemy.capital || kingdom.capital;
        if (!world || !world.weather || !front) return 1;
        const fx = WEATHER_EFFECTS[world.weather.getWeather(front.q, front.r).type] || {};
        return Math.max(0.2, 1 + (fx.travelSpeed || 0));
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

                // Pitched battles every few days, not every day — and fewer
                // when snow, storms or heat bog down the campaign
                if (Utils.random() < KingdomAI.WAR.battleChance * KingdomAI.campaignWeather(kingdom, enemy, world)) {
                    KingdomAI.simulateBattle(kingdom, enemy, world);
                }
                // The fleets fight for the sea; the stronger blockades the other's ports
                if (kingdom.isAlive && enemy.isAlive && kingdom.wars.includes(enemy.id)) {
                    KingdomNavy.processWar(kingdom, enemy, world);
                }
                if (kingdom.isAlive && enemy.isAlive && kingdom.wars.includes(enemy.id)) {
                    KingdomAI._resolveWar(kingdom, enemy, world);
                }
            }
        }
    },

    _normalizeComposition(comp) {
        const c = {
            cavalry: Math.max(0, comp.cavalry || 0),
            archer: Math.max(0, comp.archer || 0),
            pikeman: Math.max(0, comp.pikeman || 0),
        };
        const total = c.cavalry + c.archer + c.pikeman;
        if (total <= 0) return { cavalry: 0.33, archer: 0.33, pikeman: 0.34 };
        c.cavalry /= total;
        c.archer /= total;
        c.pikeman /= total;
        return c;
    },

    /** Battle power on a kingdom's favoured terrain (preferredTerrain). */
    HOME_GROUND: 1.08,

    homeGroundMultiplier(kingdom, terrainId) {
        return Kingdom.prefersTerrain(kingdom, terrainId) ? KingdomAI.HOME_GROUND : 1;
    },

    _getKingdomComposition(kingdom) {
        const comp = { cavalry: 0.30, archer: 0.28, pikeman: 0.42 };
        const traits = kingdom.traits || [];
        // Cultures used to be checked against the trait list (where they
        // never appear); check both
        const culture = String(kingdom.culture || '').toLowerCase();
        const has = (...ids) => ids.some(id => traits.includes(id) || culture === id);

        if (has('nomadic', 'aggressive', 'mobile')) comp.cavalry += 0.12;
        if (has('woodland', 'maritime', 'naval', 'seafaring', 'nature-loving')) comp.archer += 0.10;
        if (has('imperial', 'religious', 'orderly', 'defensive', 'militaristic')) comp.pikeman += 0.10;
        // Steppe horse epics and sylvan archers shape the levy
        const tb = (kingdom.cultureData && kingdom.cultureData.tradition && kingdom.cultureData.tradition.bonuses) || {};
        if (tb.cavalry) comp.cavalry += tb.cavalry / 100;
        if (tb.archery) comp.archer += tb.archery / 100;

        return KingdomAI._normalizeComposition(comp);
    },

    _counterMultiplier(attackerComp, defenderComp) {
        const advantage =
            attackerComp.cavalry * defenderComp.archer +
            attackerComp.archer * defenderComp.pikeman +
            attackerComp.pikeman * defenderComp.cavalry;
        const disadvantage =
            defenderComp.cavalry * attackerComp.archer +
            defenderComp.archer * attackerComp.pikeman +
            defenderComp.pikeman * attackerComp.cavalry;

        const score = advantage - disadvantage;
        return Math.max(0.82, Math.min(1.22, 1 + score * 0.7));
    },

    _terrainMultiplier(terrainId, composition) {
        const hill = ['hills', 'highlands', 'foothills'].includes(terrainId);
        const plains = ['plains', 'grassland', 'steppe', 'savanna'].includes(terrainId);

        if (hill) return 1 + composition.archer * 0.16;
        if (plains) return 1 + composition.cavalry * 0.16;
        return 1;
    },

    _moraleValue(ownStrength, enemyStrength, bonus = 0) {
        const pressure = enemyStrength / Math.max(1, ownStrength);
        const morale = 1 - Math.max(0, pressure - 1) * 0.3 + bonus;
        return Math.max(0.48, Math.min(1.18, morale));
    },

    /** Morale bonus: military leadership, stability, and running events (points/100). */
    _moraleBonus(kingdom, world) {
        return (kingdom.characterBonuses?.military || 0)
            + KingdomStability.moraleBonus(kingdom)
            + KingdomCulture.moraleBonus(kingdom)
            + WorldEvents.getModifier(world, 'morale', { kingdom: kingdom.id }) / 100;
    },

    _checkMoraleBreak(ownStrength, enemyStrength, moraleValue) {
        const ratio = enemyStrength / Math.max(1, ownStrength);
        if (ratio < 1.8) return false;
        const chance = Math.max(0.06, Math.min(0.72, (ratio - 1.6) * 0.42 + (1 - moraleValue) * 0.55));
        return Utils.random() < chance;
    },

    /**
     * Simulate a battle between two kingdoms
     */
    simulateBattle(attacker, defender, world) {
        const frontline = KingdomAI._pickFrontline(attacker, defender, world);
        const battleTile = frontline ? world.getTile(frontline.q, frontline.r) : null;
        const terrainId = battleTile?.terrain?.id;
        // The fields where the armies meet are trampled and burned (world/harvests.js)
        Harvests.noteBattle(world, defender.id);

        const attackerComp = KingdomAI._getKingdomComposition(attacker);
        const defenderComp = KingdomAI._getKingdomComposition(defender);

        const attackerCounterMult = KingdomAI._counterMultiplier(attackerComp, defenderComp);
        const defenderCounterMult = KingdomAI._counterMultiplier(defenderComp, attackerComp);
        const attackerTerrainMult = KingdomAI._terrainMultiplier(terrainId, attackerComp);
        const defenderTerrainMult = KingdomAI._terrainMultiplier(terrainId, defenderComp);

        const attackerMorale = KingdomAI._moraleValue(attacker.military, defender.military, KingdomAI._moraleBonus(attacker, world));
        const defenderMorale = KingdomAI._moraleValue(defender.military, attacker.military, KingdomAI._moraleBonus(defender, world));

        let attackPower = attacker.military * Utils.randFloat(0.8, 1.2) * attackerCounterMult * attackerTerrainMult * attackerMorale;
        let defensePower = defender.military * Utils.randFloat(0.8, 1.2) * defenderCounterMult * defenderTerrainMult * defenderMorale;
        // Brilliant strategists and ruthless lords win battles; paranoid ones hold walls
        attackPower *= Math.max(0.2, 1 + KingdomBonuses.get(attacker, 'warBonus'));
        defensePower *= Math.max(0.2, 1 + KingdomBonuses.get(defender, 'warBonus') + KingdomBonuses.get(defender, 'defense')
            + LordInfluence.mod(defender, 'defense')); // a wary lord's fortifications
        // Home ground: each side fights better on terrain it favours
        attackPower *= KingdomAI.homeGroundMultiplier(attacker, terrainId);
        defensePower *= KingdomAI.homeGroundMultiplier(defender, terrainId);
        // Knowing the enemy's land (the royal archive's chart of it) wins
        // battles — and a doctored chart loses them
        attackPower *= KingdomAtlas.campaignMultiplier(attacker, defender.id);
        defensePower *= KingdomAtlas.campaignMultiplier(defender, attacker.id);
        // Walls: towns, and above all the capital, are hard to take
        let lastTown = false;
        if (battleTile && battleTile.settlement && battleTile.settlement.kingdom === defender.id) {
            const isCapital = defender.capital && defender.capital.q === frontline.q && defender.capital.r === frontline.r;
            defensePower *= isCapital ? KingdomAI.WAR.capitalDefense : KingdomAI.WAR.settlementDefense;
            // ...and a realm's last town is defended to the last
            lastTown = KingdomAI._settlementsOf(defender, world).length <= 1;
            if (lastTown) defensePower *= KingdomAI.WAR.lastStand;
            // A port cut off by the attacker's fleet starves faster
            attackPower *= KingdomNavy.siegeMultiplier(attacker, defender, world, frontline.q, frontline.r);
        }

        let moraleBreak = null;
        if (KingdomAI._checkMoraleBreak(attacker.military, defender.military, attackerMorale)) {
            moraleBreak = attacker.id;
            attackPower *= 0.55;
            defensePower *= 1.12;
        } else if (KingdomAI._checkMoraleBreak(defender.military, attacker.military, defenderMorale)) {
            moraleBreak = defender.id;
            defensePower *= 0.55;
            attackPower *= 1.12;
        }

        if (moraleBreak) {
            const fleeingName = moraleBreak === attacker.id ? attacker.name : defender.name;
            world.events.push({
                text: `😨 ${fleeingName}'s lines broke under pressure and began to flee!`,
                type: 'military'
            });
        }

        // Determine winner
        if (attackPower > defensePower && lastTown && KingdomAI._capitulates(attacker, defender, world)) {
            // The last town opens its gates on terms: the realm survives, poorer
            defender.military = Math.floor(defender.military * 0.85);
            attacker.military = Math.floor(attacker.military * 0.95);
        } else if (attackPower > defensePower) {
            // Attacker wins - take the contested tile
            const tile = frontline ? world.getTile(frontline.q, frontline.r) : null;
            if (tile && tile.kingdom === defender.id) {
                tile.kingdom = attacker.id;
                attacker.territory.push({ q: frontline.q, r: frontline.r });
                defender.territory = defender.territory.filter(t => t.q !== frontline.q || t.r !== frontline.r);
                const war = KingdomAI._warState(attacker, defender.id, world);
                war.gains++;

                // A captured settlement changes hands (and remembers its old crown)
                if (tile.settlement && tile.settlement.kingdom === defender.id) {
                    tile.settlement.kingdom = attacker.id;
                    if (!tile.settlement.formerKingdom) tile.settlement.formerKingdom = defender.id;
                    war.gains += 2; // towns count for more toward the war goal
                    world.events.push({ text: `🏰 ${attacker.name} captures ${tile.settlement.name} from ${defender.name}!`, type: 'military' });
                }
            }

            // Both armies bleed
            const defenderLossMult = moraleBreak === defender.id ? 0.82 : 0.9;
            const attackerLossMult = moraleBreak === defender.id ? 0.97 : 0.95;
            defender.military = Math.floor(defender.military * defenderLossMult);
            attacker.military = Math.floor(attacker.military * attackerLossMult);

            // A realm falls only when its last town does; a lost capital moves
            const towns = KingdomAI._settlementsOf(defender, world);
            if (towns.length === 0) {
                KingdomAI._collapse(defender, attacker, world);
            } else if (defender.capital && !towns.some(t => t.q === defender.capital.q && t.r === defender.capital.r)) {
                const seat = towns.reduce((a, b) => ((b.settlement.population || 0) > (a.settlement.population || 0) ? b : a));
                defender.capital = { q: seat.q, r: seat.r };
                world.events.push({ text: `👑 ${defender.name}'s court flees to ${seat.settlement.name}.`, type: 'military' });
            }
        } else {
            // Defender wins - attacker loses military
            const attackerLossMult = moraleBreak === attacker.id ? 0.78 : 0.85;
            const defenderLossMult = moraleBreak === attacker.id ? 0.98 : 0.95;
            attacker.military = Math.floor(attacker.military * attackerLossMult);
            defender.military = Math.floor(defender.military * defenderLossMult);
        }
    },

    /**
     * The tile a battle is fought over: a defender tile bordering the
     * attacker if there is one (wars are fought at the border), else any.
     */
    _pickFrontline(attacker, defender, world) {
        if (!defender.territory.length) return null;
        const mine = new Set(attacker.territory.map(t => `${t.q},${t.r}`));
        const border = [];
        for (const t of defender.territory) {
            for (const n of Hex.neighbors(t.q, t.r)) {
                if (mine.has(`${Hex.wrapQ(n.q, world.width)},${n.r}`)) { border.push(t); break; }
            }
        }
        return Utils.randPick(border.length ? border : defender.territory);
    },
};
