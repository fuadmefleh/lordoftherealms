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
import { CrownBooks } from './crownBooks.js';
import { Cultures } from './cultures.js';
import { RealmArms } from './realmArms.js';
import { TownMarks } from './townMarks.js';
import { WaterSources } from './waterSources.js';
import { TownSiting } from './townSiting.js';
import { WarStakes } from './warStakes.js';
import { Revanche } from './revanche.js';

const _fy = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** The distant years' survey of each realm's recruiting ground (updateMilitary): kingdom → { world, day, … }. */
const _distantGround = new WeakMap();

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
    /**
     * `days` (the distant years: world/world/runtime.js runs each realm's turn
     * once every realmEvery days, staggered): that many days of it at once —
     * the economy's output, food and growth, stability, institutions, the
     * court's daily rolls and the armies' and fleet's upkeep a day at a time
     * on one survey of the realm. 1 in the ordinary day.
     */
    processTurn(kingdom, world, playerBonuses = {}, days = 1) {
        if (!kingdom.isAlive) return;

        const personality = KingdomAI.getPersonality(kingdom);
        const n = days > 1 ? Math.floor(days) : 1;

        // Update kingdom economy
        KingdomAI.updateEconomy(kingdom, world, playerBonuses, n);

        for (let d = 0; d < n; d++) {
            // Stability drifts toward its target; unrest may spark a rebellion
            KingdomStability.processDay(kingdom, world);

            // Faith, scholarship and culture from rulers, lords, traditions, events
            KingdomAI.updateInstitutions(kingdom, world);
        }

        for (let d = 0; d < n; d++) {
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

            // Consider diplomatic actions — a realm the player rules sends envoys
            // only on its ruler's word (Throne: alliances, gifts, peace), so the
            // draw is kept (the stream stays put) but its court does not act
            if (Utils.random() < 0.3 && !KingdomAI.isPlayerRuled(kingdom)) {
                KingdomAI.considerDiplomacy(kingdom, world);
            }

            // Consider war — summer and autumn are campaign season (the same one
            // draw either way, so the season never shifts the RNG stream here)
            if (Utils.random() < personality.warChance * Seasons.campaignFactor(Seasons.today(world))) {
                KingdomAI.considerWar(kingdom, world);
            }

            // Its regard for its neighbours, weekly: envy of the mighty, bandwagoning,
            // balancing alliances — for every realm alike, the player's or not (no RNG draws)
            KingdomAI.considerNeighbours(kingdom, world);
        }

        // Update military strength
        KingdomAI.updateMilitary(kingdom, world, n);

        // Build, pay for and lay up the royal fleet (no RNG draws)
        KingdomNavy.updateFleet(kingdom, world, n);
    },

    /**
     * Update kingdom economy from all settlements
     */
    updateEconomy(kingdom, world, playerBonuses = {}, days = 1) {
        const n = days > 1 ? Math.floor(days) : 1;
        let totalGold = 0;
        let totalFood = 0;
        let totalGoods = 0;
        let totalPopulation = 0;

        const settlements = KingdomAI._settlementCopiesOf(kingdom, world);
        // The Crown's Purse (systems/fiscal.js) taxes the towns' real income instead
        const books = CrownBooks.enabled();

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
                ...(n > 1 ? { days: n } : {}),
            });

            if (tile.settlement) {
                // The food model's growth or hunger sticks to the real settlement
                tile.settlement.population = settlement.population;
                // Lasting drift of the real settlement: gold rushes and refugee
                // waves swell it, plagues and strained granaries shrink it,
                // healers and stewards help (0.1%/day per +1.0 of modifier)
                // (a swelling tapers as the place nears what its land can feed, as the food's
                // growth does — Economy.growthRoom; untapered, the healers' bonus alone grew
                // every capital a percent a year for ever)
                const drift = (eventGrowth - eventConsumption * 0.5 + growthBonus * 0.5) * 0.001;
                for (let d = 0; d < n; d++) {
                    if (drift !== 0 && tile.settlement.population > 0) {
                        const rate = drift > 0 ? drift * Economy.growthRoom(tile.settlement) : drift;
                        tile.settlement.population = Math.max(10, Math.round(tile.settlement.population * (1 + rate)));
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
            }

            // Process trade
            const traded = Economy.processTrade(settlement);
            // The day's taxable output for the Crown's Purse (systems/fiscal.js reads and clears it)
            if (books && settlement.economy) {
                const e = settlement.economy;
                e.fyProd = Math.round((_fy(e.fyProd) + Math.max(0, (e.production && e.production.gold) || 0) * n) * 100) / 100;
                e.fyTrade = Math.round((_fy(e.fyTrade) + Math.max(0, traded || 0)) * 100) / 100;
            }

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
        if (books) {
            // (the treasury moves by its budget lines: taxes in, wages and upkeep out;
            // the collectors' efficiency today is kept for systems/fiscal.js)
            CrownBooks.state(kingdom).mult = mult;
        } else if (typeof kingdom.treasuryIncomeBase !== 'number') {
            kingdom.treasury = Math.floor(totalGold * mult);
        } else {
            const income = totalGold - kingdom.treasuryIncomeBase;
            kingdom.treasury = Math.floor((kingdom.treasury || 0) + (income > 0 ? income * mult : income));
        }
        kingdom.treasuryIncomeBase = totalGold;

        // Armies in the field cost money (frugal rulers spend less; war events more)
        // — with the Crown's Purse, their field pay is the budget's army line
        // (the soldiers spend their pay where they are quartered: the capital's purse)
        if (!books && kingdom.wars && kingdom.wars.length > 0) {
            const due = n > 1 ? KingdomAI.warUpkeep(kingdom, world) * n : KingdomAI.warUpkeep(kingdom, world);
            const paid = Math.min(Math.max(0, kingdom.treasury || 0), due);
            kingdom.treasury = (kingdom.treasury || 0) - paid;
            CrownBooks.spendAtCapital(world, kingdom, paid);
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
            // (the offerings come out of the realm's own towns' purses: real coin)
            if (temples.income) {
                kingdom.treasury = (kingdom.treasury || 0)
                    + Religion.offeringsFromRealm(kingdom, world, temples.income, 'templeMaxPurseShare');
            }
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
            CrownBooks.spendAtCapital(world, kingdom, def.cost); // (the masons are paid)
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

    /** A small string hash (FNV-1a) for picks that must not touch the shared dice. */
    _hash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    },

    /**
     * Where a new village's settlers come from, or null when it can't be
     * founded on `target`: another settlement within minSpacing hexes, a realm
     * already holding a settlement per hexesPerSettlement of its land, or none
     * of its own settlements within donorRange with more than donorMinPop people.
     * Reads only — no randomness. → the donor settlement | null
     */
    _villageDonor(kingdom, world, target, G = {}) {
        const spacing = Number.isFinite(G.minSpacing) ? G.minSpacing : 3;
        const perHexes = Number.isFinite(G.hexesPerSettlement) ? G.hexesPerSettlement : 14;
        const range = Number.isFinite(G.donorRange) ? G.donorRange : 10;
        const minPop = Number.isFinite(G.donorMinPop) ? G.donorMinPop : 300;
        const W = world.width || 0;
        const dist = (a, b) => (W && typeof Hex.wrappingDistance === 'function' ? Hex.wrappingDistance(a.q, a.r, b.q, b.r, W) : Hex.distance(a.q, a.r, b.q, b.r));
        // (read only: the live towns, not a copy of every one — World.getSettlementViews)
        const all = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        if (all.length) {
            if (all.some(s => s && Number.isFinite(s.q) && dist(s, target) <= spacing)) return null;
            const own = all.filter(s => s && s.kingdom === kingdom.id);
            if (own.length >= Math.max(1, Math.floor((kingdom.territory || []).length / perHexes))) return null;
        }
        let best = null;
        for (const s of all) {
            if (!s || s.kingdom !== kingdom.id || !Number.isFinite(s.q) || dist(s, target) > range) continue;
            const live = world.getTile ? (world.getTile(s.q, s.r) || {}).settlement : null;
            const t = live || s;
            if (!(t.population > minPop)) continue;
            if (!best || t.population > best.population) best = t;
        }
        // (a bare test world with no settlement list: the capital sends them, if it has the people)
        if (!best && !all.length && kingdom.capital && world.getTile) {
            const cap = (world.getTile(kingdom.capital.q, kingdom.capital.r) || {}).settlement;
            if (cap && cap.population > minPop) best = cap;
        }
        return best;
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

        let target;
        let inside = false;
        if (borderTiles.length === 0) {
            // Hemmed in: the realm fills its own land instead — a site inside its borders to settle
            const inner = [];
            for (const hex of kingdom.territory) {
                const t = world.getTile(hex.q, hex.r);
                if (t && t.terrain && t.terrain.passable && !t.settlement) inner.push({ q: hex.q, r: hex.r, tile: t });
            }
            if (!inner.length) return;
            // (a hashed pick and chance, not the shared dice: a hemmed-in realm used to draw nothing here)
            const h = KingdomAI._hash(`${world.day || 0}|${kingdom.id}|inner`);
            target = inner[h % inner.length];
            inside = true;
        } else {
            // Claim a border tile — of the realm's favoured terrain when it can
            // (still one pick, so expansion draws no extra randomness)
            const favoured = borderTiles.filter(t => Kingdom.prefersTerrain(kingdom, t.tile.terrain && t.tile.terrain.id));
            target = Utils.randPick(favoured.length ? favoured : borderTiles);
            target.tile.kingdom = kingdom.id;
            kingdom.territory.push({ q: target.q, r: target.r });
        }

        // Small chance to found a new settlement
        // Master builders and stewards found more villages
        // (data/realmGrowth.json: room around it, a realm not yet crowded, and settlers from its own towns)
        const G = (DataLoader._gamedata && DataLoader._gamedata.realmGrowth) || {};
        const foundChance = Number.isFinite(G.foundChance) ? G.foundChance : 0.1;
        const roll = inside ? (KingdomAI._hash(`${world.day || 0}|${kingdom.id}|found`) % 10000) / 10000 : Utils.random();
        if (roll < foundChance * Math.max(0.2, 1 + KingdomBonuses.get(kingdom, 'construction')) && !target.tile.settlement) {
            // (the same draw the old 100-500 souls took, so the dice run on as before)
            const draw = inside ? 100 + KingdomAI._hash(`${world.day || 0}|${kingdom.id}|souls`) % 401 : Utils.randInt(100, 500);
            // Since terrainGen 16 the settlers take the best site of the realm's own
            // land near the hex it claimed, where a town would grow (world/townSiting.js;
            // the spacing, crowding and donor rules as before) — and none at all when
            // even that is ground no one would farm. No extra dice either way. (A village
            // is founded only when one could be on the claimed hex, as before: the site
            // moves, the pace of founding does not.)
            const sited = TownSiting.forWorld(world);
            if (sited) {
                if (!KingdomAI._villageDonor(kingdom, world, target, G)) return;
                const F = TownSiting.founded('expand');
                const pick = TownSiting.bestNear(world, target.q, target.r, Number.isFinite(F.radius) ? F.radius : 3,
                    (t) => t.kingdom === kingdom.id && t.terrain.passable && !t.settlement && !!KingdomAI._villageDonor(kingdom, world, t, G),
                    { map: sited, distWeight: F.distWeight, kind: 'village' });
                if (!pick || pick.score < (Number.isFinite(F.minScore) ? F.minScore : -1)) return;
                target = { q: pick.q, r: pick.r, tile: pick.tile };
            }
            const donor = KingdomAI._villageDonor(kingdom, world, target, G);
            if (!donor) return;
            const S = G.settlers || {};
            const lo = Number.isFinite(S.min) ? S.min : 30, hi = Number.isFinite(S.max) ? S.max : 80;
            const settlers = Math.min(lo + ((draw - 100) % (hi - lo + 1)), Math.max(0, donor.population - 1));
            donor.population -= settlers;
            target.tile.settlement = {
                type: 'village',
                name: Kingdom.generateCityName(kingdom.culture, world),
                population: settlers,
                level: 0,
                kingdom: kingdom.id,
                founded: world.year,
            };
            if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
            // (a new village has no coin it wasn't given: the settlers bring their share of
            // the mother town's purse, by heads — never a starting purse from nothing)
            Economy.initSettlement(target.tile.settlement, { fresh: true });
            const have = Economy.townPurse(donor);
            if (have > 0 && settlers > 0) {
                const take = Math.floor(have * settlers / Math.max(1, donor.population + settlers) * 100) / 100;
                Economy.payTown(target.tile.settlement, Economy.drawTown(donor, take));
            }
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
        // A common tongue: envoys who can't make themselves understood get
        // less done, and each contact teaches the courts a little (world/cultures.js)
        change += Cultures.realmDiplomacy(kingdom, target);
        // Religious compatibility: same faith → +5, different militant faiths → penalty
        if (typeof Religion !== 'undefined') {
            change += Math.floor(Religion.faithCompatibility(kingdom, target) * 0.3);
        }
        kingdom.relations[target.id] = Utils.clamp(currentRelation + change, -100, 100);

        // Form alliance if relations are very good (never with the player's
        // realm: its ruler signs alliances in person, Throne.proposeAlliance)
        if (kingdom.relations[target.id] > 70 && !kingdom.allies.includes(target.id) && !KingdomAI.isPlayerRuled(target)) {
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
        // ...and so does a realm the player wears in personal union, ruled by a viceroy (systems/highCrowns.js)
        if (crown && crown.union && !(crown.policies && crown.policies.stance === 'aggressive')) return;
        // ...and the junior crown of a personal union between AI realms: its king abroad
        // speaks for it, and it joins his wars (systems/realmUnions.js)
        if (kingdom.personalUnion && kingdom.personalUnion.role === 'junior' && KingdomAI.unionPartner(kingdom, world)) return;
        const otherKingdoms = world.kingdoms.filter(k =>
            k.isAlive &&
            k.id !== kingdom.id &&
            !kingdom.allies.includes(k.id) &&
            KingdomAI.mayOpenWar(kingdom, k, world)
        );
        // A realm already fighting two wars doesn't open a third
        if (kingdom.wars.length >= 2) return;

        if (otherKingdoms.length === 0) return;

        // Find kingdoms with poor relations (but not one whose stakes it still dreads: world/warStakes.js)
        // (a realm that holds towns this one lost is a just foe: the grudge runs warmer — world/revanche.js)
        const claim = (k) => Revanche.claimOn(world, kingdom, k);
        const enemies = otherKingdoms.filter(k => (kingdom.relations[k.id] || 0) < -30 + Revanche.grudge(claim(k)) && !WarStakes.fears(kingdom, k.id, world.day));
        if (enemies.length === 0) return;

        // A realm whose cartographers have charted a rival marches on it first
        // ...and one that holds its lost towns before any other (the same one draw)
        const holders = enemies.filter(k => claim(k) > 0);
        const target = Utils.randPick(KingdomAtlas.preferCharted(kingdom, holders.length ? holders : enemies));

        // Only declare war if we're stronger or desperate. The lord's war
        // appetite (ambition, domination, honor) shifts how strong is enough.
        // (two crowns in personal union fight as one: each weighed with its partner's host)
        const ourStrength = KingdomAI.unionMight(kingdom, world) * LordInfluence.warAppetite(kingdom);
        // (a realm in revolt, civil war or disorder tempts its neighbours sooner)
        const theirStrength = KingdomAI.unionMight(target, world) * (KingdomAI.isWeak(target) ? KingdomAI.WAR.weakRatio : 1);

        // A militaristic realm marches only when it is at least as strong
        // and seldom gambles; others accept 80% and take a 10% gamble
        const warRatio = KingdomAI.personalityValue(kingdom, 'warRatio');
        // Campaign season: dry roads and full granaries embolden a realm in
        // summer and autumn; few march into the winter mud and snow
        const season = Seasons.campaignFactor(Seasons.today(world));
        // ...and a realm whose bread is dear has little stomach for a war (world/economyIndex.js; 1 until measured)
        const confidence = (1 + (season - 1) * 0.5) * EconomyIndex.warConfidence(world, kingdom);
        const reckless = KingdomAI.personalityValue(kingdom, 'recklessChance') * season;
        // (to win back its own towns a court marches at a lesser strength: world/revanche.js)
        const ease = Revanche.ease(claim(target));
        if (ourStrength * confidence > theirStrength * warRatio * (1 - ease) || Utils.random() < reckless) {
            KingdomAI.startWar(kingdom, target, world);
            const lost = Revanche.claimedFrom(world, kingdom, target)[0];
            world.events.push({
                text: lost
                    ? `⚔️ ${kingdom.name} has declared war on ${target.name} to win back ${lost.rec.name}!`
                    : `⚔️ ${kingdom.name} has declared war on ${target.name}!`,
                type: 'military'
            });
        }
    },

    /**
     * The realm's partner in a personal union between AI realms (kingdom.personalUnion,
     * kept by systems/realmUnions.js), alive, or null.
     */
    unionPartner(kingdom, world) {
        const u = kingdom && kingdom.personalUnion;
        if (!u || u.partnerId == null || !world) return null;
        const p = (world.kingdoms || []).find(k => k && String(k.id) === String(u.partnerId));
        return p && p.isAlive && p.personalUnion && String(p.personalUnion.partnerId) === String(kingdom.id) ? p : null;
    },

    /** A realm's army plus a tenth of its people, with its union partner's (they fight as one). */
    unionMight(kingdom, world) {
        const own = (kingdom.military || 0) + (kingdom.population || 0) * 0.1;
        const p = KingdomAI.unionPartner(kingdom, world);
        return p ? own + (p.military || 0) + (p.population || 0) * 0.1 : own;
    },

    /** Does the player sit this realm's throne (kingdom.crown, systems/throne.js)? */
    isPlayerRuled(kingdom) {
        return !!(kingdom && kingdom.crown && kingdom.crown.playerRuled);
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
     * Weekly regard among the realms (data/kingship.json → config.ai), every
     * crown's for every other, whoever rules it:
     *  - envy: a stronger crown nearby sours relations (more so for an ambitious lord);
     *  - bandwagoning: weaker peaceful or mercantile realms on good terms warm to it;
     *  - balancing: against the mightiest realm, wary realms ally with each other;
     *  - reciprocity: the player's court sends no envoys, so its regard for a realm
     *    follows that realm's regard for it.
     * Wars come through considerWar, as on any realm. Draws no RNG (the
     * balancing alliance rolls on a hash of the day and the pair).
     * (Before 2026-11-25 this ran for the player's realm alone: AI crowns envied
     * only it, never a mighty AI neighbour, and a seed-101 home realm took −7,000
     * of regard from envy in 40 years while the AI realms' regard of each other
     * climbed to +70; it drew three and four times the wars of any AI realm.)
     */
    considerNeighbours(kingdom, world) {
        if (!kingdom || !kingdom.isAlive || !Array.isArray(world.kingdoms)) return;
        const A = (DataLoader.kingship && DataLoader.kingship.config && DataLoader.kingship.config.ai) || {};
        const cadence = A.cadence || 7;
        const idx = world.kingdoms.indexOf(kingdom);
        if (((world.day || 0) + idx) % cadence !== 0) return;
        if (!kingdom.relations) kingdom.relations = {};
        const alive = world.kingdoms.filter(k => k && k.isAlive);
        if (alive.length < 2) return;
        const ownMight = Math.max(1, KingdomAI._might(kingdom));
        const mightiest = Math.max(...alive.map(KingdomAI._might));
        const pid = KingdomAI.personalityId(kingdom);
        const ambitious = LordInfluence.lean(kingdom, 'ambition') > 0;
        // (the player's own court: its regard is the ruler's, moved only by reciprocity below)
        const ruled = KingdomAI.isPlayerRuled(kingdom);
        let balanced = false;
        for (const other of alive) {
            if (other === kingdom) continue;
            if (!other.relations) other.relations = {};
            const rel = kingdom.relations[other.id] || 0;
            const theirs = KingdomAI._might(other);
            const ratio = theirs / ownMight;
            const allied = (kingdom.allies || []).includes(other.id);
            const atWar = (kingdom.wars || []).includes(other.id);
            if (!ruled) {
                const near = kingdom.capital && other.capital
                    && Hex.wrappingDistance(kingdom.capital.q, kingdom.capital.r, other.capital.q, other.capital.r, world.width) <= (A.nearCapitals || 28);
                const shift = (v) => { kingdom.relations[other.id] = Utils.clamp((kingdom.relations[other.id] || 0) + v, -100, 100); };
                if (!allied && !atWar && near && ratio > (A.envyRatio || 1.2)) {
                    shift((A.envy || -2) + (ambitious ? (A.ambitionEnvy || -1) : 0));
                }
                // A realm that holds towns it lost: its court's regard sours a little each week,
                // the more the heavier the claim (never below the floor: world/revanche.js)
                if (!atWar && !allied && Array.isArray(kingdom.lostTowns) && kingdom.lostTowns.length) {
                    const sour = Revanche.sour(Revanche.claimOn(world, kingdom, other));
                    const floor = Revanche.config().sourFloor;
                    const now = kingdom.relations[other.id] || 0;
                    if (sour < 0 && now > floor) kingdom.relations[other.id] = Math.max(floor, now + sour);
                }
                if (!atWar && ratio > 1 && rel > (A.bandwagonRelations || 20) && (pid === 'peaceful' || pid === 'mercantile')) {
                    shift(A.bandwagon || 2);
                }
                // Balance of power: ally with a like-minded realm against the mightiest crown
                // (an alliance with the player's realm is signed by its ruler in person)
                if (!balanced && !allied && rel < 0 && theirs >= mightiest && ratio > (A.balanceRatio || 1.3)) {
                    balanced = true;
                    const partner = alive
                        .filter(k => k !== kingdom && k !== other && !KingdomAI.isPlayerRuled(k) && !(kingdom.allies || []).includes(k.id)
                            && !(kingdom.wars || []).includes(k.id) && (k.relations && (k.relations[other.id] || 0) < 0)
                            && (kingdom.relations[k.id] || 0) >= (A.balanceMinRelations || 10))
                        .sort((a, b) => (kingdom.relations[b.id] || 0) - (kingdom.relations[a.id] || 0))[0];
                    const roll = ((Utils.hashStr(`balance:${world.day || 0}:${kingdom.id}:${other.id}`) >>> 0) % 10000) / 10000;
                    if (partner && roll < (A.balanceChance || 0.2)) {
                        if (!Array.isArray(kingdom.allies)) kingdom.allies = [];
                        if (!Array.isArray(partner.allies)) partner.allies = [];
                        kingdom.allies.push(partner.id);
                        partner.allies.push(kingdom.id);
                        kingdom.relations[partner.id] = Math.max(kingdom.relations[partner.id] || 0, 60);
                        if (!partner.relations) partner.relations = {};
                        partner.relations[kingdom.id] = Math.max(partner.relations[kingdom.id] || 0, 60);
                        if (Array.isArray(world.events)) world.events.push({ text: `🤝 ${kingdom.name} and ${partner.name} ally against the might of ${other.name}.`, type: 'diplomatic' });
                    }
                }
            }
            // The player's court sends no envoys of its own, but its regard for a realm at peace
            // with it follows that realm's regard for it, a little a week (data/kingship.json
            // config.ai.reciprocity). (Before 2026-11-24 it never moved: every war left the
            // player's realm at −40 to its foe for good, below the warmth an alliance asks of both
            // sides — Throne.proposeAlliance — so it could never ally with a realm it had once
            // fought, while the AI realms mended their quarrels by envoy and allied among
            // themselves, and the one realm left outside every alliance drew most of the wars.)
            if (KingdomAI.isPlayerRuled(other) && !atWar) {
                const mine = other.relations[kingdom.id] || 0;
                const step = A.reciprocity != null ? A.reciprocity : 3;
                const back = kingdom.relations[other.id] || 0;
                if (step > 0 && mine !== back) other.relations[kingdom.id] = mine < back ? Math.min(back, mine + step) : Math.max(back, mine - step);
            }
        }
        // (No war of its own on the player's crown here: its wars come through considerWar, as
        // on any realm, under the same limits — KingdomAI.mayOpenWar — and a weak crown tempts
        // its neighbours there as a weak AI realm does, WAR.weakRatio. Before 2026-11-24 this
        // was a second weekly roll for war on the player's realm alone, at a laxer grudge (−20)
        // and a laxer strength (0.9, 0.6 when weak) than any AI realm was held to.)
    },

    /**
     * End a war between two kingdoms (pious lords sue for peace). Called by
     * NPCLords' 'peace' goal — it was referenced but never defined.
     */
    makePeace(kingdom, enemy, world) {
        if (!kingdom || !enemy) return false;
        if (!(kingdom.wars || []).includes(enemy.id)) return false;
        if (KingdomAI.isSworn(kingdom, enemy, world)) return false;
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
        // Who carries the fight to whom in a battle: each side by its share of
        // the two armies, never less than initiative[0] nor more than [1]. (Only
        // the side on the attack can take ground; the war used to make the realm
        // listed first in world.kingdoms the attacker in every battle, so the
        // realms late in the list could only ever lose towns — 2026-11-24.)
        initiative: [0.25, 0.75],
        // Limits every aggressor keeps, the AI's realms and the player's alike
        // (mayOpenWar): a realm already fighting maxWarsOn wars is not set upon by
        // a fresh one (a crusade may bring one more); and a realm whose war has
        // just ended does not open another for restDays, plus restPerWarDay for
        // each day the war ran (up to restMax) — war weariness. (Before
        // 2026-11-24 a small realm of a disliked faith had three to five wars a
        // year declared on it, two and three at once, and was gone by year 20.)
        maxWarsOn: 2,
        // ...and a realm a fresh war was declared on in the last besetDays is let be
        // by its other neighbours' courts a while (they wait to see how it goes): the
        // ordinary wars of considerWar, not a crusade, a league or a crisis
        besetDays: 90,
        restDays: 45,
        restPerWarDay: 0.5,
        restMax: 180,
        // A realm in revolt, in civil war or of low stability tempts its
        // neighbours: they march at this share of the strength they'd want
        weakStability: 35,
        weakRatio: 0.67,
        // A war won sates the victor: its regard for the loser rises to at least
        // this (above considerWar's −30 grudge), so it does not march again the
        // day the truce runs out; its envoys sour it again in their own time
        sated: -10,
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

    /**
     * May `kingdom` open a fresh war on `target`? The limits every aggressor
     * keeps (WAR.maxWarsOn, the truce, the founding peace, war weariness:
     * kingdom.restUntil, set by endWar). opts: { maxOn (wars the target may
     * already fight), rested: false to ignore the aggressor's weariness,
     * founding: false to ignore the founding peace, beset: false to ignore a
     * war declared on the target of late (target.declaredOnDay, WAR.besetDays) }.
     * Draws no RNG.
     */
    mayOpenWar(kingdom, target, world, opts = {}) {
        const W = KingdomAI.WAR;
        if (!kingdom || !target || kingdom === target || !target.isAlive) return false;
        if ((kingdom.wars || []).includes(target.id)) return false;
        // (two crowns on one head never war on each other: systems/realmUnions.js)
        if (KingdomAI.unionPartner(kingdom, world) === target) return false;
        if (KingdomAI.hasTruce(kingdom, target, world)) return false;
        if (opts.founding !== false && KingdomAI.foundingPeace(kingdom, target, world)) return false;
        if (opts.rested !== false && (kingdom.restUntil || 0) > KingdomAI._day(world)) return false;
        if (opts.beset !== false && target.declaredOnDay != null && KingdomAI._day(world) - target.declaredOnDay < W.besetDays) return false;
        const maxOn = opts.maxOn != null ? opts.maxOn : W.maxWarsOn;
        return (target.wars || []).filter(id => id !== kingdom.id).length < maxOn;
    },

    /** Is a realm weak enough to tempt its neighbours (a revolt, a civil war, low stability)? */
    isWeak(kingdom) {
        const crown = (kingdom && kingdom.crown) || {};
        return !!crown.revolt || !!crown.civilWar || (typeof kingdom.stability === 'number' && kingdom.stability < KingdomAI.WAR.weakStability);
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
        if (!kingdom.wars.includes(target.id)) {
            kingdom.wars.push(target.id);
            target.declaredOnDay = KingdomAI._day(world);
        }
        if (!target.wars.includes(kingdom.id)) target.wars.push(kingdom.id);
        if (kingdom.warState) delete kingdom.warState[target.id];
        if (target.warState) delete target.warState[kingdom.id];
        const ws = KingdomAI._warState(kingdom, target.id, world);
        KingdomAI._warState(target, kingdom.id, world);
        // A war on the holder of towns it lost is a reclaim war: won once they are retaken (world/revanche.js)
        if (Revanche.claimOn(world, kingdom, target) > 0) ws.reclaim = true;
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
        // War weariness: neither opens a fresh war for a while, the longer the war the longer
        {
            const W = KingdomAI.WAR;
            const day = KingdomAI._day(world);
            const s1 = a.warState && a.warState[b.id];
            const s2 = b.warState && b.warState[a.id];
            const since = Math.min(s1 && s1.since != null ? s1.since : day, s2 && s2.since != null ? s2.since : day);
            const rest = Math.round(W.restDays + Math.min(W.restMax, Math.max(0, day - since) * W.restPerWarDay));
            a.restUntil = Math.max(a.restUntil || 0, day + rest);
            b.restUntil = Math.max(b.restUntil || 0, day + rest);
        }
        // (which side fought to win back its towns: the victor's peace may return one, below)
        const reclaimOf = { [a.id]: !!(a.warState && a.warState[b.id] && a.warState[b.id].reclaim), [b.id]: !!(b.warState && b.warState[a.id] && b.warState[a.id].reclaim) };
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
            victor.relations[loser.id] = Math.max(victor.relations[loser.id] || 0, KingdomAI.WAR.sated);
            tribute = Math.floor(Math.max(0, loser.treasury || 0) * (opts.tribute != null ? opts.tribute : KingdomAI.WAR.tribute));
            loser.treasury = (loser.treasury || 0) - tribute;
            victor.treasury = (victor.treasury || 0) + tribute;
            // The loser raises it from its people; the victor spends it: coin crosses the border (world/moneySupply.js)
            if (tribute > 0 && world) MoneySupply.transfer(world, loser.id, victor.id, tribute, 'tribute');
            // The peace may return a town the victor lost to the loser (world/revanche.js)
            if (world && opts.returnTown !== false) KingdomAI.peaceReturn(victor, loser, world, reclaimOf[victor.id]);
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

    /**
     * A sworn war (warState[enemy].sworn: the day until which it holds) is not
     * ended by the lords' peace, a weak side suing or weariness: a holy war or
     * a pretender's war of the last crisis (systems/lastCrisis.js) is fought
     * out and ended by its own verdict.
     */
    isSworn(a, b, world) {
        const day = KingdomAI._day(world);
        const s1 = a && a.warState && b ? a.warState[b.id] : null;
        const s2 = b && b.warState && a ? b.warState[a.id] : null;
        return !!((s1 && s1.sworn > day) || (s2 && s2.sworn > day));
    },

    /** Swear a war: neither side makes peace before `until` but by the war's own end. */
    swearWar(a, b, world, until) {
        if (!a || !b || !(a.wars || []).includes(b.id)) return false;
        KingdomAI._warState(a, b.id, world).sworn = until;
        KingdomAI._warState(b, a.id, world).sworn = until;
        return true;
    },

    /** Daily check whether a war ends: goals met, the weak sue, or both tire. */
    _resolveWar(a, b, world) {
        const W = KingdomAI.WAR;
        if (KingdomAI.isSworn(a, b, world)) return null;
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
        // A realm a holy war is waged on sends to the see first (systems/holyWars.js sets
        // defender.holyPlea and answers it the same day): the gates stay shut while its
        // envoys ride. Once a war — refused, it capitulates as any realm would.
        const plea = defender && defender.holyPlea;
        if (plea && !plea.refused && Array.isArray(plea.foes) && plea.foes.includes(attacker.id)) {
            const day = KingdomAI._day(world);
            if (plea.asked == null) {
                plea.asked = day;
                if (Array.isArray(world.events)) world.events.push({ text: `🕊️ Besieged in its last town, ${defender.name} sends envoys to the Church to sue for terms.`, type: 'diplomatic' });
            }
            if (plea.asked === day) return true;
        }
        const chance = Utils.clamp(W.capitulate * (1 - LordInfluence.lean(attacker, 'ambition') * 0.3 + LordInfluence.lean(attacker, 'honor') * 0.2), 0, 0.9);
        if (!(chance > 0) || Utils.random() >= chance) return false;
        const town = (KingdomAI._settlementsOf(defender, world)[0] || {}).settlement;
        KingdomAI.endWar(attacker, defender, world, {
            victor: attacker, tribute: W.capitulateTribute,
            text: `🏳️ Besieged in ${town ? town.name : 'its last town'}, ${defender.name} capitulates to ${attacker.name} and pays for its survival.`,
        });
        return true;
    },

    /**
     * A fallen crown's chests — its treasury and its royal bank's — pass to
     * `heir` (the conqueror's treasury), or with none into `town`'s purse (the
     * court's coin scattered in the town that fell): a dead realm's coin is
     * counted nowhere, so none may stay in it. → the coin moved.
     */
    seizeChests(fallen, heir, world, town = null) {
        if (!fallen) return 0;
        let coin = Math.max(0, Number(fallen.treasury) || 0);
        fallen.treasury = 0;
        const bank = fallen.royalBank;
        if (bank && Number(bank.treasury) > 0) { coin += Number(bank.treasury); bank.treasury = 0; }
        coin = Math.round(coin * 100) / 100;
        if (!(coin > 0)) return 0;
        if (heir && heir !== fallen) {
            heir.treasury = Math.round(((Number(heir.treasury) || 0) + coin) * 100) / 100;
            return coin;
        }
        return town ? Economy.payTown(town, coin) : 0;
    },

    /** A defeated realm leaves every war; its last tiles pass to the conqueror, and its chests. */
    _collapse(defender, attacker, world) {
        // (booked across the border while both still stand: world/moneySupply.js)
        const chests = Math.max(0, Number(defender.treasury) || 0);
        if (chests > 0) MoneySupply.transfer(world, defender.id, attacker.id, chests, 'plunder');
        KingdomAI.seizeChests(defender, attacker, world);
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
        // Its arsenals fall to the conqueror (world/realmArms.js)
        if (defender.armoury && defender.armoury.stock) {
            RealmArms.attach(attacker, defender.armoury, 1);
            defender.armoury.stock = {};
        }
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
            if (fallen.isAlive) continue;
            // (coin that still finds its way into a fallen crown's chests — a due owed it, a
            // fine — is in no counted purse there: it goes on to its conqueror, else is spent
            // in the town nearest its old seat)
            if (_fy(Number(fallen.treasury)) > 0 || (fallen.royalBank && _fy(Number(fallen.royalBank.treasury)) > 0)) {
                const heir = fallen.conqueredBy != null && world.getKingdom ? world.getKingdom(fallen.conqueredBy) : null;
                const live = heir && heir.isAlive ? heir : null;
                const town = !live && fallen.capital ? Economy.nearestPurse(world, fallen.capital.q, fallen.capital.r) : null;
                if (live || town) KingdomAI.seizeChests(fallen, live, world, town);
            }
            if (fallen.conqueredDay == null) continue;
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
        // (the occupier remembers the town it lost; the risen crown has it back: world/revanche.js)
        Revanche.record(world, occupier, fallen, tile.settlement, sq, sr);
        Revanche.regained(world, fallen, sq, sr);
        tile.settlement.kingdom = fallen.id;
        delete tile.settlement.formerKingdom;
        fallen.population = tile.settlement.population || 0;
        fallen.military = Math.floor(fallen.population * 0.08);
        fallen._militaryInit = true;
        fallen.stability = 55;
        // The rising's war chest: what the old crown kept (none: its chests went to the
        // conqueror), else raised from the town that rises
        if (!((fallen.treasury || 0) >= 200)) fallen.treasury = (fallen.treasury || 0) + Economy.drawTown(tile.settlement, 200 - Math.max(0, fallen.treasury || 0));
        fallen.wars = [];
        fallen.truces = {};
        fallen.navy = null; // the old fleet is long gone; a new one is counted tomorrow
        // The rising arms itself out of the town's own stalls (world/realmArms.js)
        RealmArms.seizeTown(fallen, tile.settlement);
        KingdomAI.startWar(fallen, occupier, world);
        world.events.push({ text: `🔥 ${tile.settlement.name} throws off ${occupier.name}'s rule — ${fallen.name} rises again!`, type: 'military' });
    },

    /**
     * Update military strength based on population and resources
     */
    updateMilitary(kingdom, world, days = 1) {
        const n = days > 1 ? Math.floor(days) : 1;
        // Base military from population (5% of population)
        let military = Math.floor(kingdom.population * 0.05);

        // Iron and horses near any settlement arm the realm — once each (they
        // used to multiply per deposit per town, snowballing big kingdoms)
        let hasIron = false, hasHorses = false;
        // Best recruiting ground in the realm: armies regrow faster where
        // iron, horses or coal are at hand (resourceBonuses.military)
        let recruiting = 0;
        // (the distant years, player/afterlife.js: the realm's ground is surveyed once
        // every realmEvery days — the deposits around its towns hardly move)
        const D = world && world._distant;
        const every = D ? Math.floor(Number(D.realmEvery) || 0) : 0;
        const held = every > 1 ? _distantGround.get(kingdom) : null;
        if (held && held.world === world && world.day >= held.day && world.day - held.day < every) {
            ({ hasIron, hasHorses, recruiting } = held);
        } else {
            const settlements = KingdomAI._settlementViewsOf(kingdom, world); // read-only: positions
            for (const settlement of settlements) {
                const tile = world.getTile(settlement.q, settlement.r);
                if (!tile) continue;
                for (const res of Economy.getNearbyResources(settlement.q, settlement.r, world, 2)) {
                    if (res.id === 'iron') hasIron = true;
                    if (res.id === 'horses') hasHorses = true;
                }
                recruiting = Math.max(recruiting, Economy.resourceBonus(world, settlement.q, settlement.r, 'military'));
            }
            if (every > 1) _distantGround.set(kingdom, { world, day: world.day, hasIron, hasHorses, recruiting });
        }
        if (hasIron) military *= 1.2;
        if (hasHorses) military *= 1.15;

        // Ruler, generals and martial traditions
        military *= Math.max(0.1, 1 + KingdomBonuses.get(kingdom, 'military'));
        // A lord bent on domination keeps a larger standing army
        military *= Math.max(0.1, 1 + LordInfluence.mod(kingdom, 'military'));
        // So does a militaristic realm
        military *= KingdomAI.personalityValue(kingdom, 'armySize');
        // Unpaid soldiers desert (the Crown's Purse: world/crownBooks.js; 1 when paid)
        military *= CrownBooks.armyFactor(kingdom);

        // Blizzards and the like thin the ranks (hardy traditions endure)
        const attrition = WorldEvents.getModifier(world, 'unitAttrition', { kingdom: kingdom.id });
        if (attrition > 0) military *= 1 - Utils.clamp(attrition * (1 - KingdomBonuses.get(kingdom, 'endurance')), 0, 0.9);

        // The realm can support `military`; armies rebuild toward it over
        // time, so battle losses matter, and shed men fast when land is lost
        const cap = Math.floor(military);
        kingdom.militaryCap = cap;
        // (its men serving away — a household guard drawn out of the army, world/kingdom.js
        // menAway — are its soldiers still: the ranks are filled to the cap less them)
        const target = Math.max(0, cap - Math.floor(Kingdom.menAway(kingdom, KingdomAI._day(world))));
        // (`days`: the distant years — the ranks refill or thin a day at a time on one survey)
        for (let d = 0; d < n; d++) {
        if (!kingdom._militaryInit) {
            kingdom.military = cap;
            kingdom._militaryInit = true;
        } else {
            const cur = Math.floor(kingdom.military || 0);
            if (target > cur) {
                // Recruitment refills the ranks, never past what the realm
                // supports; good recruiting ground and drilled militaristic
                // realms refill them faster
                // ...and a royal Marshal or conscription (kingdom.crown, systems/kingship.js)
                const regen = Math.min(1, KingdomAI.WAR.regen * KingdomAI.personalityValue(kingdom, 'regen')
                    * (1 + recruiting * Economy.effectScale('armyRegen'))
                    * Math.max(0.2, 1 + KingdomBonuses.get(kingdom, 'militaryRegen')));
                kingdom.military = cur;
                // (at least a man a day: recruitTroops takes whole men, and a share of a gap
                // under 1/regen men — 25 at the usual pace — floored to none, so every army
                // stood that far short of its cap for good: a tenth of a small realm's, seed
                // 202's home army 324 of 373 for years)
                Kingdom.recruitTroops(kingdom, Math.max(1, (target - cur) * regen));
            } else {
                kingdom.military = Math.floor(cur + (target - cur) * KingdomAI.WAR.demob);
            }
            if (attrition > 0 && kingdom.military > target) kingdom.military = target;
        }
        }
        // Arm the men it keeps: kits bought from its own towns' stock, worn out,
        // the surplus sold back (world/realmArms.js; draws no RNG)
        RealmArms.daily(kingdom, world, KingdomAI._getKingdomComposition(kingdom), n);
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
     * Which side takes the field as attacker in a war's battle: either realm,
     * with a chance by its share of the two armies (clamped to WAR.initiative),
     * so both sides of a war can win ground. Draws one RNG. → [attacker, defender]
     */
    battleInitiative(a, b) {
        const [lo, hi] = KingdomAI.WAR.initiative;
        const ma = Math.max(0, a.military || 0);
        const mb = Math.max(0, b.military || 0);
        const p = Utils.clamp(ma + mb > 0 ? ma / (ma + mb) : 0.5, lo, hi);
        return Utils.random() < p ? [a, b] : [b, a];
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
                    const [att, def] = KingdomAI.battleInitiative(kingdom, enemy);
                    KingdomAI.simulateBattle(att, def, world);
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
            + WorldEvents.getModifier(world, 'morale', { kingdom: kingdom.id }) / 100
            // A blinded army come home: the realm has lost heart (world/warStakes.js, player/prisonerFates.js)
            - WarStakes.dismay(kingdom, world && world.day);
    },

    /** Does a side break? mult scales the chance (a decimated army's steel: kingdom.decimation, _breakMult). */
    _checkMoraleBreak(ownStrength, enemyStrength, moraleValue, mult = 1) {
        const ratio = enemyStrength / Math.max(1, ownStrength);
        if (ratio < 1.8) return false;
        const chance = Math.max(0.06, Math.min(0.72, (ratio - 1.6) * 0.42 + (1 - moraleValue) * 0.55));
        return Utils.random() < chance * (Number.isFinite(mult) ? mult : 1);
    },

    /** A realm that decimated its broken companies breaks less for a while (player/decimation.js writes kingdom.decimation). */
    _breakMult(kingdom, world) {
        const d = kingdom && kingdom.decimation;
        return d && typeof d === 'object' && (d.until || 0) > ((world && world.day) || 0) && Number.isFinite(d.breakMult) ? d.breakMult : 1;
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
        // A commissioned general in the field (player/generalship.js: kingdom.fieldCommand)
        attackPower *= KingdomAI.fieldCommandMult(attacker, world);
        defensePower *= KingdomAI.fieldCommandMult(defender, world);
        // Home ground: each side fights better on terrain it favours
        attackPower *= KingdomAI.homeGroundMultiplier(attacker, terrainId);
        defensePower *= KingdomAI.homeGroundMultiplier(defender, terrainId);
        // The arms they carry: a realm short of weapons, harness or arrows fights
        // weaker, one in mail better (world/realmArms.js)
        attackPower *= RealmArms.factor(attacker);
        defensePower *= RealmArms.factor(defender);
        // Water (world/waterSources.js; data/water.json aiArmy): a host campaigning in dry
        // country thirsts — weaker, and some of its men fall away; a town with no clean
        // well (fouled, run dry, no river) holds out the worse
        if (frontline) {
            const WA = (DataLoader._gamedata && DataLoader._gamedata.water && DataLoader._gamedata.water.aiArmy) || {};
            if (!(battleTile && battleTile.settlement) && !WaterSources.nearFresh(world, frontline.q, frontline.r)) {
                attackPower *= Number.isFinite(WA.dryAttack) ? WA.dryAttack : 0.9;
                attacker.military = Math.max(0, Math.floor((attacker.military || 0) * (1 - (Number.isFinite(WA.dryAttrition) ? WA.dryAttrition : 0.004))));
            }
            if (battleTile && battleTile.settlement && WaterSources.townDry(world, battleTile.settlement)) defensePower *= Number.isFinite(WA.dryDefense) ? WA.dryDefense : 0.8;
        }
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
        if (KingdomAI._checkMoraleBreak(attacker.military, defender.military, attackerMorale, KingdomAI._breakMult(attacker, world))) {
            moraleBreak = attacker.id;
            attackPower *= 0.55;
            defensePower *= 1.12;
        } else if (KingdomAI._checkMoraleBreak(defender.military, attacker.military, defenderMorale, KingdomAI._breakMult(defender, world))) {
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
            // Its lord may decimate the companies that ran (player/decimation.js reads the inbox)
            if (Array.isArray(world.routFeed) && world.routFeed.length < 40) world.routFeed.push({ day: world.day, kingdomId: moraleBreak, foe: moraleBreak === attacker.id ? defender.id : attacker.id });
        }

        // The general in the field hears how the day went (player/generalship.js reads the log)
        KingdomAI._noteFieldCommand(attacker, world, attackPower > defensePower, defender.id);
        KingdomAI._noteFieldCommand(defender, world, attackPower <= defensePower, attacker.id);

        // Determine winner (the men each side had, for the arms of the fallen)
        const menBefore = { [attacker.id]: attacker.military, [defender.id]: defender.military };
        if (attackPower > defensePower && lastTown && KingdomAI._capitulates(attacker, defender, world)) {
            // The last town opens its gates on terms: the realm survives, poorer
            defender.military = Math.floor(defender.military * 0.85);
            attacker.military = Math.floor(attacker.military * 0.95);
        } else if (attackPower > defensePower) {
            // Attacker wins - take the contested tile
            if (frontline) KingdomAI.takeTile(attacker, defender, world, frontline.q, frontline.r);

            // Both armies bleed
            const defenderLossMult = moraleBreak === defender.id ? 0.82 : 0.9;
            const attackerLossMult = moraleBreak === defender.id ? 0.97 : 0.95;
            defender.military = Math.floor(defender.military * defenderLossMult);
            attacker.military = Math.floor(attacker.military * attackerLossMult);

            KingdomAI.afterTownLoss(defender, attacker, world);
        } else {
            // Defender wins - attacker loses military
            const attackerLossMult = moraleBreak === attacker.id ? 0.78 : 0.85;
            const defenderLossMult = moraleBreak === attacker.id ? 0.98 : 0.95;
            attacker.military = Math.floor(attacker.military * attackerLossMult);
            defender.military = Math.floor(defender.military * defenderLossMult);
        }
        // The fallen's arms are lost; the field's holder gathers its own and strips the beaten
        const won = attackPower > defensePower;
        RealmArms.battle(won ? attacker : defender, won ? defender : attacker, menBefore);
        // A cairn where they fell, by the town fought over or out on the field (world/townMarks.js)
        if (frontline) {
            const dead = Math.max(0, menBefore[attacker.id] - attacker.military) + Math.max(0, menBefore[defender.id] - defender.military);
            TownMarks.noteBattle(world, frontline.q, frontline.r, { dead, victor: (won ? attacker : defender).name, loser: (won ? defender : attacker).name, day: world.day });
            // The beaten's captives, for the victor to treat (player/prisonerFates.js reads the inbox daily)
            if (Array.isArray(world.captivesFeed) && world.captivesFeed.length < 40) {
                const loser = won ? defender : attacker;
                world.captivesFeed.push({ day: world.day, victor: (won ? attacker : defender).id, loser: loser.id, q: frontline.q, r: frontline.r, lost: Math.max(0, menBefore[loser.id] - loser.military) });
            }
        }
    },

    /**
     * A tile of `defender` passes to `attacker` (a won battle, a town taken by
     * a general's siege): the territory, the war goal (a town counts for 3),
     * a captured town's crown (it remembers the old one). Draws no RNG beyond
     * a first war goal. → { taken, town } (town: the settlement, or null).
     */
    takeTile(attacker, defender, world, q, r) {
        const out = { taken: false, town: null };
        const tile = world.getTile(q, r);
        if (!tile || tile.kingdom !== defender.id) return out;
        tile.kingdom = attacker.id;
        attacker.territory.push({ q, r });
        defender.territory = defender.territory.filter(t => t.q !== q || t.r !== r);
        const war = KingdomAI._warState(attacker, defender.id, world);
        war.gains++;
        out.taken = true;
        // A captured settlement changes hands (and remembers its old crown)
        if (tile.settlement && tile.settlement.kingdom === defender.id) {
            // (the loser remembers it — who took it, when, its seat or not: world/revanche.js)
            Revanche.record(world, defender, attacker, tile.settlement, q, r);
            tile.settlement.kingdom = attacker.id;
            if (!tile.settlement.formerKingdom) tile.settlement.formerKingdom = defender.id;
            war.gains += 2; // towns count for more toward the war goal
            // (the towns a crown took lately: a conqueror's might, as the lords' 'conquest'
            // memories are the player's — systems/coalitions.js realmPower)
            KingdomAI.noteConquest(attacker, defender, world);
            // A town of its own won back: it counts double, and a reclaim war is won
            // once every town it claimed of the defender is home
            const back = Revanche.regained(world, attacker, q, r);
            if (back) {
                war.gains += 3;
                if (war.reclaim && !Revanche.claimedFrom(world, attacker, defender).length) war.gains = Math.max(war.gains, war.goal);
                out.reclaimed = true;
            }
            world.events.push({ text: back ? `🏰 ${attacker.name} wins back ${tile.settlement.name} from ${defender.name}!` : `🏰 ${attacker.name} captures ${tile.settlement.name} from ${defender.name}!`, type: 'military' });
            out.town = tile.settlement;
        }
        return out;
    },

    /**
     * Book a town taken on the conqueror's record (kingdom.conquests: [{ d, from }],
     * the last 720 days, at most 24): read by the leagues against an overmighty
     * realm (systems/coalitions.js). Draws no RNG.
     */
    noteConquest(attacker, defender, world) {
        if (!attacker) return;
        const day = KingdomAI._day(world);
        const list = Array.isArray(attacker.conquests) ? attacker.conquests.filter(e => e && day - (Number(e.d) || 0) <= 720) : [];
        list.push({ d: day, from: defender ? defender.id : null });
        if (list.length > 24) list.splice(0, list.length - 24);
        attacker.conquests = list;
    },

    /** Towns a realm has taken in the last `days` days (kingdom.conquests). */
    conquestsOf(kingdom, world, days = 360) {
        const day = KingdomAI._day(world);
        return (Array.isArray(kingdom && kingdom.conquests) ? kingdom.conquests : []).filter(e => e && day - (Number(e.d) || 0) <= days).length;
    },

    /**
     * The victor's peace returns a town it lost to the loser (world/revanche.js):
     * the heaviest it claims of the loser's, never the loser's last; certain
     * after a reclaim war (reclaimReturn), else by a hashed peaceReturn roll.
     * Draws no RNG. → the settlement returned, or null.
     */
    peaceReturn(victor, loser, world, reclaimWar = false) {
        if (!victor || !loser || !victor.isAlive || !loser.isAlive || !world || typeof world.getTile !== 'function') return null;
        const claimed = Revanche.claimedFrom(world, victor, loser);
        if (!claimed.length) return null;
        const towns = KingdomAI._settlementsOf(loser, world);
        if (towns.length < 2) return null;
        const pick = claimed.find(c => towns.some(t => t.q === c.rec.q && t.r === c.rec.r));
        if (!pick || !Revanche.peaceRolls(world, victor, loser, reclaimWar)) return null;
        const s = KingdomAI.cedeTown(loser, victor, world, pick.rec.q, pick.rec.r);
        if (s && Array.isArray(world.events)) world.events.push({ text: `📜 By the terms of the peace, ${loser.name} returns ${s.name} to ${victor.name}.`, type: 'diplomatic' });
        return s;
    },

    /**
     * A town (and the open land about it the giver holds) passes by treaty from
     * `from` to `to`: no battle, no war goal. The giver remembers it
     * (world/revanche.js); its court moves if it was the seat. Draws no RNG.
     * → the settlement, or null.
     */
    cedeTown(from, to, world, q, r) {
        const tile = world.getTile(q, r);
        if (!tile || !tile.settlement || tile.settlement.kingdom !== from.id) return null;
        const s = tile.settlement;
        Revanche.record(world, from, to, s, q, r);
        Revanche.regained(world, to, q, r);
        const moved = new Set();
        for (const h of [{ q, r }, ...Hex.neighbors(q, r)]) {
            const hq = Hex.wrapQ(h.q, world.width);
            const t = world.getTile(hq, h.r);
            if (!t || t.kingdom !== from.id) continue;
            if (t !== tile && t.settlement) continue;
            t.kingdom = to.id;
            moved.add(`${hq},${h.r}`);
            if (!(to.territory || []).some(p => p.q === hq && p.r === h.r)) (to.territory = to.territory || []).push({ q: hq, r: h.r });
        }
        from.territory = (from.territory || []).filter(t => !moved.has(`${t.q},${t.r}`));
        s.kingdom = to.id;
        if (!s.formerKingdom) s.formerKingdom = from.id;
        KingdomAI.afterTownLoss(from, to, world);
        return s;
    },

    /** A realm falls only when its last town does; a lost capital moves. */
    afterTownLoss(defender, attacker, world) {
        const towns = KingdomAI._settlementsOf(defender, world);
        if (towns.length === 0) {
            KingdomAI._collapse(defender, attacker, world);
            return 'collapsed';
        }
        if (defender.capital && !towns.some(t => t.q === defender.capital.q && t.r === defender.capital.r)) {
            const seat = towns.reduce((a, b) => ((b.settlement.population || 0) > (a.settlement.population || 0) ? b : a));
            defender.capital = { q: seat.q, r: seat.r };
            world.events.push({ text: `👑 ${defender.name}'s court flees to ${seat.settlement.name}.`, type: 'military' });
            return 'fled';
        }
        return null;
    },

    /**
     * The battle multiplier of a realm whose commissioned general is with the
     * army (kingdom.fieldCommand, written each day by player/generalship.js).
     * 1 when none is, or the record is stale (the general dead or gone).
     */
    fieldCommandMult(kingdom, world) {
        const fc = kingdom && kingdom.fieldCommand;
        if (!fc || !(fc.mult > 0) || fc.day < KingdomAI._day(world) - 1) return 1;
        return fc.mult;
    },

    _noteFieldCommand(kingdom, world, won, enemyId) {
        const fc = kingdom && kingdom.fieldCommand;
        if (!fc || KingdomAI.fieldCommandMult(kingdom, world) === 1) return;
        if (!Array.isArray(fc.log)) fc.log = [];
        fc.log.push({ day: KingdomAI._day(world), won: !!won, enemyId });
        if (fc.log.length > 20) fc.log.shift();
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
