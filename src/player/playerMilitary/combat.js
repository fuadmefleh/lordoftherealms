// PlayerMilitary — combat members (split from the original monolith).
import { PlayerMilitary } from './_ref.js';
import { Traits } from '../../systems/traits.js';
import { Companions } from '../../systems/companions.js';
import { HeirAgency } from '../../systems/heirAgency.js';
import { SocialSkills } from '../../systems/socialSkills.js';
import { Underworld } from '../../systems/underworld.js';
import { Kingship } from '../../systems/kingship.js';
import { MerchantCaravans } from '../../systems/merchantCaravans.js';
import { CourierRiders } from '../../systems/courierRiders.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { NPCLords } from '../../world/npcLords.js';
import { RealmArms } from '../../world/realmArms.js';
import { Difficulty } from '../../core/difficulty.js';
import { Utils, Technology, House, Quests, RealmWars, Throne, PlayerEffects, Housing, Culture, PlayerReligion, PlayerInventory, WorldEvents, WEATHER_EFFECTS, Economy, Arms } from './_imports.js';

Object.assign(PlayerMilitary, {
    /**
     * Combat encounter (for random events or player-initiated)
     */
    combat(player, enemyStrength, enemyName = 'Bandits', context = {}) {
        // Who fights depends on the theatre: inland, war galleys stay at sea;
        // at a port they blockade; on the water they lead (see theatreWeights)
        const theatre = context.theatre || 'land';
        const strengthParts = PlayerMilitary.getTheatreStrengthBreakdown(player, theatre);
        const playerStrength = strengthParts.total;

        if (playerStrength === 0) {
            const onlyShips = theatre === 'land' && (player.army || []).length > 0
                && (player.army || []).every(u => PlayerMilitary.isNavalUnit(u));
            return {
                victory: false,
                reason: onlyShips ? 'Your war galleys cannot fight on land — recruit soldiers.' : 'No army to fight with!',
            };
        }

        const terrainId = context.terrainId || null;
        const playerComp = PlayerMilitary.getArmyComposition(player);
        const enemyComp = PlayerMilitary.inferEnemyComposition(enemyStrength, enemyName, context);

        const playerCounterMult = PlayerMilitary._counterMultiplier(playerComp, enemyComp);
        const enemyCounterMult = PlayerMilitary._counterMultiplier(enemyComp, playerComp);
        const playerTerrainMult = PlayerMilitary._terrainMultiplier(terrainId, playerComp);
        const enemyTerrainMult = PlayerMilitary._terrainMultiplier(terrainId, enemyComp);
        // Rain spoils bowstrings, snow bogs down horses — for both sides
        const weatherType = PlayerMilitary._battleWeather(player, context);
        const playerWeatherMult = PlayerMilitary._weatherMultiplier(weatherType, playerComp);
        const enemyWeatherMult = PlayerMilitary._weatherMultiplier(weatherType, enemyComp);

        const festivalMoraleBonus = (player.festivals?.moraleBoostDays > 0)
            ? (player.festivals?.moraleBoostValue || 0)
            : 0;
        // Theaters you own keep the troops' spirits up (needs context.world)
        const theaterMoraleBonus = Culture.getMoraleBonus(player, context.world);
        const leadership = (player.skills?.leadership || 1) * 0.015 + festivalMoraleBonus + theaterMoraleBonus
            + PlayerMilitary._worldEventMorale(player, context)
            + PlayerEffects.artifactBonus(player, 'moraleBonus');
        const playerMorale = PlayerMilitary._moraleValue(playerStrength, enemyStrength, leadership);
        const enemyMorale = PlayerMilitary._moraleValue(enemyStrength, playerStrength, context.enemyMoraleBonus || 0);

        // Combat calculation
        let playerPower = playerStrength * Utils.randFloat(0.8, 1.2) * playerCounterMult * playerTerrainMult * playerWeatherMult * playerMorale;
        // Fighting companions in the travel party
        playerPower *= 1 + PlayerEffects.companionBonus(player, 'power');
        // The Sword of the First King
        playerPower *= 1 + PlayerEffects.artifactBonus(player, 'battlePower');
        // An enchanted weapon from a legendary hoard
        playerPower *= 1 + PlayerEffects.treasureBonus(player, 'battlePower');
        // A commander in high spirits leads better; a miserable one worse
        playerPower *= PlayerEffects.moodCombatMultiplier(player);
        // The Valor tenet of the player's own faith
        playerPower *= PlayerEffects.faithBattleMultiplier(player);
        // Earned traits (Brave, Craven, Sea Wolf, Champion…)
        playerPower *= PlayerEffects.traitBattleMultiplier(player);
        // A child of the House commanding the company — or a regent's captains (systems/heirAgency.js)
        playerPower *= HeirAgency.commandMultiplier(player);
        // A wounded or fevered commander (systems/ailments.js)
        playerPower *= PlayerEffects.ailmentBattleMultiplier(player);
        // Leadership: men fight harder for a commander they follow (systems/socialSkills.js)
        playerPower *= 1 + SocialSkills.frac(player, 'leadership', 'power');
        // Fortification techs help when the player is the one attacked
        if (context.defending) playerPower *= 1 + Technology.getDefenseBonus(player);
        // A fortified house (watchtower, fortification upgrades) adds +1% per point of defense
        if (context.defending) playerPower *= 1 + Housing.getTotalBonuses(player).defense / 100;
        let enemyPower = enemyStrength * Utils.randFloat(0.8, 1.2) * enemyCounterMult * enemyTerrainMult * enemyWeatherMult * enemyMorale;
        enemyPower *= Difficulty.mult(player, 'enemyStrength'); // the difficulty (1 on Normal)

        // ── Unit specials & military techs ──
        // Siege engines, shield walls, longbow volleys, crossbow piercing,
        // plate armour, battle mages and assassins (see getBattleSpecials).
        const specials = PlayerMilitary.getBattleSpecials(player, context, playerComp, enemyComp);
        playerPower *= specials.playerMult;
        enemyPower *= specials.enemyMult;

        let moraleBreak = null;
        if (PlayerMilitary._checkMoraleBreak(playerStrength, enemyStrength, playerMorale)) {
            moraleBreak = 'player';
            Traits.recordDeed(player, 'cowardice', 2); // the army broke and ran
            playerPower *= 0.55;
            enemyPower *= 1.12;
        } else if (specials.commanderSlain || PlayerMilitary._checkMoraleBreak(enemyStrength, playerStrength, enemyMorale)) {
            moraleBreak = 'enemy';
            enemyPower *= 0.55;
            playerPower *= 1.12;
        }

        const victory = playerPower > enemyPower;
        // Leadership practice: every battle teaches, a victory more
        SocialSkills.trainBy(player, 'leadership', victory ? 'victory' : 'battle');
        // Travelling companions react to the outcome; with low odds one may fall
        Companions.onBattle(player, victory, { enemyName, roleOf: n => PlayerEffects.companionRole(n) }, context.world);
        // The commanding child's record and fate (wounded, captured, killed)
        HeirAgency.onBattle(player, context.world, victory, enemyName);

        // Calculate casualties
        let casualtyRate = victory ?
            Utils.randFloat(0.05, 0.15) :
            Utils.randFloat(0.2, 0.4);

        if (moraleBreak === 'enemy' && victory) casualtyRate *= 0.65;
        // Surgery saves soldiers who would otherwise be lost
        casualtyRate *= Math.max(0, 1 - Technology.getEffectTotal(player, 'battleCasualtyReduction'));
        if (moraleBreak === 'player' && !victory) casualtyRate *= 1.25;
        // Divine Protection: no one falls
        casualtyRate *= PlayerEffects.casualtyMultiplier(player);
        // Plate armour turns blows that would have killed
        casualtyRate *= specials.casualtyMult;

        // Only units that took the field can fall (galleys stay out of land battles)
        const fighting = () => player.army.filter(u => PlayerMilitary._theatreParticipant(u, theatre));
        const casualtyCount = Math.ceil(fighting().length * casualtyRate);
        const { casualties, woundedUnits } = PlayerMilitary._applyCasualties(player, theatre, casualtyCount);
        // The bowmen loosed their arrows (the fallen took theirs with them); a won field gives some back
        const quivers = Arms.spendQuivers(player, { units: fighting(), victory });

        // Rewards for victory (or, beaten and alone, capture)
        const spoils = PlayerMilitary._battleSpoils(player, victory, enemyStrength, context, enemyName);
        const loot = spoils.loot;
        if (spoils.captured) {
            return {
                victory: false,
                casualties,
                loot: 0,
                enemyName,
                playerStrength,
                enemyStrength,
                captured: true,
                servitudeDays: spoils.servitudeDays,
                goldConfiscated: spoils.goldConfiscated,
            };
        }

        return {
            victory,
            casualties,
            wounded: woundedUnits.length,
            loot,
            armsTaken: spoils.armsTaken || null,
            quivers,
            enemyName,
            playerStrength,
            enemyStrength,
            commanderSlain: specials.commanderSlain,
            theatre,
            navalSupport: strengthParts.naval,
            shipSupport: strengthParts.ship,
            tactics: {
                terrainId,
                weather: weatherType,
                moraleBreak,
                playerMorale: Number(playerMorale.toFixed(2)),
                enemyMorale: Number(enemyMorale.toFixed(2)),
                playerCounterMult: Number(playerCounterMult.toFixed(2)),
                enemyCounterMult: Number(enemyCounterMult.toFixed(2)),
                playerTerrainMult: Number(playerTerrainMult.toFixed(2)),
                enemyTerrainMult: Number(enemyTerrainMult.toFixed(2)),
            },
        };
    },

    /**
     * Take `count` casualties from the units that fought in `theatre` (the
     * last-recruited first). Surgery may carry each off wounded instead; the
     * dead are remembered for Resurrection. Shared by combat() and the phased
     * field battle (player/fieldBattle.js). Draws one roll per casualty only
     * when the army has surgeons. opts.pick: take these units (first first)
     * instead of the last-recruited (player/battlefield.js).
     */
    _applyCasualties(player, theatre, count, opts = {}) {
        // opts.pick: the units to take, in order (the battlefield's company that suffered the losses)
        const pick = Array.isArray(opts.pick) ? opts.pick.slice().reverse() : null;
        const fighting = pick
            ? () => pick.filter(u => player.army.includes(u))
            : () => player.army.filter(u => PlayerMilitary._theatreParticipant(u, theatre));
        // Surgery: each would-be casualty may be carried off wounded instead
        const woundedChance = Technology.getEffectTotal(player, 'woundedRecoveryBonus');
        const woundedUnits = [];
        let casualties = 0;
        for (let i = 0; i < count; i++) {
            const candidates = fighting();
            if (candidates.length === 0) break;
            const unit = candidates[candidates.length - 1];
            player.army.splice(player.army.lastIndexOf(unit), 1);
            if (woundedChance > 0 && Utils.random() < woundedChance) {
                unit.woundedDays = PlayerMilitary.WOUNDED_DAYS;
                woundedUnits.push(unit);
                continue;
            }
            casualties++;
            // The fallen are remembered — Resurrection can call them back
            PlayerReligion.recordFallenUnit(player, unit);
        }
        player.army.push(...woundedUnits.reverse());
        // The fighting knocks the survivors' arms about, and the commander's own (systems/arms.js)
        if (theatre !== 'sea') {
            Arms.wearKits(player);
            Arms.wearFromBattle(player);
        }
        return { casualties, woundedUnits };
    },

    /**
     * What the beaten carried in arms, for Arms.battleSpoils to strip: a
     * { good: pieces } object it takes out of (and so out of its owner):
     *   a rival House's retinue     its rival.arms stock
     *   a realm's war host          the arms it took from the armoury (rec.arms)
     *   a band with packs           the weapons/spears/shields in its inventory
     *   a realm's men / a town's    their share of the realm's armoury (kingdom.
     *   garrison                    armoury.stock: enemyStrength of its army)
     * else null: nothing to strip. → { from, commit(taken) } (commit takes a share's strip out of its owner).
     */
    _armsSource(player, context = {}, enemyStrength = 0) {
        // A host that marched with arms of its own (a siege's relief: context.armsFrom)
        if (context.armsFrom && typeof context.armsFrom === 'object') return { from: context.armsFrom };
        const unit = context.lootUnit;
        if (unit && unit.rivalId != null) {
            const rival = RivalHouses.rivalOfUnit(player, unit);
            if (rival) return { from: RivalHouses.arms(rival).stock };
        }
        if (unit && unit.type === 'war_host') {
            for (const war of Object.values((player.realmWars && player.realmWars.wars) || {})) {
                const rec = (war.hosts || []).find(h => h.id === unit.id);
                if (rec && rec.arms) return { from: rec.arms };
            }
        }
        const kingdom = context.lootKingdom
            || (context.lootTown && context.lootTown.kingdom != null && context.world && typeof context.world.getKingdom === 'function' ? context.world.getKingdom(context.lootTown.kingdom) : null);
        if (kingdom && kingdom.armoury) {
            // The fallen's share of the armoury: as many of its men as were beaten
            const stock = RealmArms.state(kingdom).stock;
            const share = Math.min(1, Math.max(0, Number(enemyStrength) || 0) / Math.max(1, (Number(kingdom.military) || 0) + (Number(enemyStrength) || 0)));
            const view = {};
            for (const [g, v] of Object.entries(stock)) view[g] = Math.floor((Number(v) || 0) * share);
            // (what Arms takes from the view leaves the armoury)
            return { from: view, commit: (taken) => { for (const [g, n] of Object.entries(taken || {})) stock[g] = Math.max(0, (Number(stock[g]) || 0) - n); } };
        }
        if (unit && unit.inventory) return { from: unit.inventory };
        return null;
    },

    /** The spoils source of a world unit: { lootPurse } (its inventory) or { lootKingdom }. */
    _unitLoot(unit, world) {
        if (unit && unit.inventory) return { lootPurse: unit.inventory, lootUnit: unit };
        const kid = unit && (unit.kingdomId != null ? unit.kingdomId : unit.kingdom);
        const k = kid != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
        return k ? { lootKingdom: k, lootUnit: unit } : { lootPurse: null, lootUnit: unit || null };
    },

    /**
     * Where a victory's coin comes from: { have, take(n) → taken } or null.
     *   context.lootPurse   what the beaten carried ({ gold }: a band's or a world
     *                       unit's inventory; null for nothing)
     *   context.lootTown    a town's purse (the plundered or stormed town; a real
     *                       town gets its economy record first)
     *   context.lootKingdom a realm's treasury (its army's war chest)
     * Without one the loot is nothing: no coin from nowhere.
     */
    _spoilsSource(context = {}) {
        if (context.lootPurse !== undefined) {
            const purse = context.lootPurse;
            const have = purse ? Math.max(0, Math.floor(Number(purse.gold) || 0)) : 0;
            return { have, take: (n) => { const t = Math.max(0, Math.min(have, Math.floor(n))); if (purse) purse.gold = have - t; return t; } };
        }
        const s = context.lootTown;
        if (s && typeof s === 'object') {
            if (!s.economy && (Number(s.population) || 0) > 0) Economy.initSettlement(s);
            const have = Math.floor(Economy.townPurse(s) || 0);
            return { have, take: (n) => Math.floor(Economy.drawTown(s, Math.max(0, Math.min(have, Math.floor(n))))) };
        }
        const k = context.lootKingdom;
        if (k && typeof k === 'object') {
            const have = Math.max(0, Math.floor(Number(k.treasury) || 0));
            return { have, take: (n) => { const t = Math.max(0, Math.min(have, Math.floor(n))); k.treasury = Math.round(((Number(k.treasury) || 0) - t) * 100) / 100; return t; } };
        }
        return null;
    },

    /**
     * After the fighting: a victory's loot, the survivors' experience, the
     * commander's combat skill and renown; a defeat with no army left may end
     * in capture and indentured servitude. Returns { loot } or
     * { loot: 0, captured: true, servitudeDays, goldConfiscated }.
     * The loot comes out of a real source (_spoilsSource) and no more.
     */
    _battleSpoils(player, victory, enemyStrength, context = {}, enemyName = 'Bandits') {
        const theatre = context.theatre || 'land';
        let loot = 0;
        if (victory) {
            const want = Math.floor(enemyStrength * Utils.randFloat(2, 5));
            const src = PlayerMilitary._spoilsSource(context);
            loot = src ? src.take(Math.min(want, src.have)) : 0;
            player.gold += loot;

            // Experience for the survivors who fought
            for (const unit of player.army.filter(u => PlayerMilitary._theatreParticipant(u, theatre))) {
                unit.experience += 5;
                if (unit.experience >= 100 && unit.level < 5) {
                    unit.level++;
                    unit.experience = 0;
                    unit.strength = Math.floor(unit.strength * 1.2);
                }
            }

            // Increase combat skill
            player.skills.combat = Math.min(10, player.skills.combat + 0.3);
            player.renown += Math.floor(enemyStrength / 10 * (1 + PlayerMilitary._worldEventRenownBonus(player, context)));
            // The beaten are stripped of their arms: spears, swords and shields off the field (systems/arms.js)
            const armsSrc = theatre === 'sea' ? null : PlayerMilitary._armsSource(player, context, enemyStrength);
            const armsTaken = armsSrc ? Arms.battleSpoils(player, enemyStrength, armsSrc.from) : {};
            if (armsSrc && armsSrc.commit) armsSrc.commit(armsTaken);
            if (Object.keys(armsTaken).length) return { loot, armsTaken };
        } else if (player.army.length === 0 && Utils.random() < 0.4) {
            // Defeat — the player is captured! Enter indentured servitude
            const servitudeDays = Utils.randInt(5, 15);
            player.indenturedServitude = {
                captor: enemyName,
                daysRemaining: servitudeDays,
                totalDays: servitudeDays,
                dailyWage: 0, // Captors take your labor
                goldConfiscated: Math.min(player.gold, Math.floor(player.gold * 0.3)),
                canBuyFreedom: true,
                freedomCost: 200 + Math.floor(enemyStrength * 2),
                escapeChance: 0.1 + (player.skills.stealth || 0) * 0.03,
            };
            player.gold -= player.indenturedServitude.goldConfiscated;
            return { loot: 0, captured: true, servitudeDays, goldConfiscated: player.indenturedServitude.goldConfiscated };
        }
        return { loot };
    },

    /**
     * Process daily indentured servitude
     */
    processServitude(player, world) {
        if (!player.indenturedServitude) return null;

        const servitude = player.indenturedServitude;
        servitude.daysRemaining--;

        // Player can attempt escape each day
        const escaped = false;

        // Captors may force you to work their properties (generate small gold for them)
        // Player earns nothing but may gain skills
        player.skills.commerce = Math.min(10, (player.skills.commerce || 1) + 0.05);
        player.strength = Math.min(20, (player.strength || 5) + 0.1);

        // Movement is locked during servitude
        player.stamina = 0;
        player.movementRemaining = 0;

        if (servitude.daysRemaining <= 0) {
            // Freedom! Servitude period over
            const result = {
                freed: true,
                type: 'served',
                message: `Your period of indentured servitude under ${servitude.captor} has ended. You are free once more.`,
                daysServed: servitude.totalDays,
            };
            player.indenturedServitude = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            player.karma += 2; // Sympathy karma
            return result;
        }

        return {
            freed: false,
            daysRemaining: servitude.daysRemaining,
            captor: servitude.captor,
            message: `You toil under ${servitude.captor}. ${servitude.daysRemaining} days of servitude remain.`,
        };
    },

    /**
     * Attempt to escape indentured servitude
     */
    attemptEscape(player) {
        if (!player.indenturedServitude) return { success: false, reason: 'Not in servitude' };

        const servitude = player.indenturedServitude;
        const roll = Utils.random();

        if (roll < servitude.escapeChance) {
            // Successful escape!
            const result = {
                success: true,
                message: `You slipped away in the night and escaped ${servitude.captor}! You are free, but they may seek revenge.`,
            };
            player.indenturedServitude = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            player.karma -= 1; // Minor karma hit for breaking contract
            Traits.recordDeed(player, 'deceit', 2);
            player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 0.5);
            return result;
        } else {
            // Failed escape — punishment
            servitude.daysRemaining += Utils.randInt(2, 5);
            servitude.escapeChance = Math.max(0.05, servitude.escapeChance - 0.02); // Harder next time
            player.health = Math.max(10, player.health - PlayerEffects.scaleDamage(player, Utils.randInt(5, 15)));
            return {
                success: false,
                message: `Your escape attempt failed! The guards caught you and beat you. +${servitude.daysRemaining - (servitude.totalDays - servitude.daysRemaining)} days added to your sentence.`,
                healthLost: true,
            };
        }
    },

    /**
     * Buy freedom from indentured servitude
     */
    buyFreedom(player) {
        if (!player.indenturedServitude) return { success: false, reason: 'Not in servitude' };
        if (!player.indenturedServitude.canBuyFreedom) return { success: false, reason: 'Captor refuses to negotiate' };

        const cost = player.indenturedServitude.freedomCost;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold (have ${Math.floor(player.gold)})` };

        player.gold -= cost;
        Traits.recordDeed(player, 'honesty', 1); // paid the debt rather than fled
        const captor = player.indenturedServitude.captor;
        player.indenturedServitude = null;
        player.stamina = player.maxStamina;
        player.movementRemaining = player.maxStamina;

        return {
            success: true,
            message: `You paid ${cost} gold to ${captor} for your freedom. You are no longer bound.`,
            cost,
        };
    },

    /** Days a raided settlement needs before it has anything worth taking again. */
    RAID_COOLDOWN_DAYS: 30,

    /** Share of the garrison that turns out to fight off a raid (vs. a full siege). */
    RAID_DEFENSE_SHARE: 0.5,

    /**
     * Raid a settlement: fight part of its garrison, plunder, and withdraw.
     * Cheaper in karma/reputation than a siege but takes no territory, and a
     * settlement can only be raided once per RAID_COOLDOWN_DAYS.
     */
    raidSettlement(player, settlement, tile, world) {
        // At a port, war galleys blockade the harbour and join the fight
        const theatre = PlayerMilitary.settlementTheatre(world, tile);
        const playerStrength = PlayerMilitary.getTheatreStrength(player, theatre);

        if (playerStrength < 30) {
            return { success: false, reason: 'Army too weak to raid (need 30+ strength)' };
        }
        const day = (world && world.day) || 0;
        if (settlement.lastRaidedDay != null && day - settlement.lastRaidedDay < PlayerMilitary.RAID_COOLDOWN_DAYS) {
            const wait = PlayerMilitary.RAID_COOLDOWN_DAYS - (day - settlement.lastRaidedDay);
            return { success: false, reason: `${settlement.name} was raided recently — nothing left to take for ${wait} more day(s)` };
        }

        const defenseStrength = Math.max(1, Math.floor(
            PlayerMilitary.getSettlementDefense(settlement, world) * PlayerMilitary.RAID_DEFENSE_SHARE));

        // Combat
        const result = PlayerMilitary.combat(player, defenseStrength, settlement.name, {
            terrainId: tile?.terrain?.id,
            enemyComposition: PlayerMilitary._getSettlementComposition(settlement, tile),
            world,
            siege: true, // siege engines batter the defences
            theatre,
            lootTown: settlement, // the defenders' spoils come out of the town's purse
        });

        result.defenseStrength = defenseStrength;
        if (result.victory) {
            // Successful raid: the plunder out of the town's purse, as much as is left in it
            const want = Math.floor(settlement.population * Utils.randFloat(0.5, 2));
            const plunder = PlayerMilitary._spoilsSource({ lootTown: settlement }).take(want);
            player.gold += plunder;
            result.plunder = plunder;
            settlement.lastRaidedDay = day;
            Quests.track(player, 'battles_won');

            // Negative karma and reputation
            player.karma -= 5;
            Traits.recordAggression(player, settlement.kingdom, { cruelty: 3, greed: 2, dread: 2 });
            if (settlement.kingdom) {
                player.reputation[settlement.kingdom] =
                    (player.reputation[settlement.kingdom] || 0) - 20;
            }

            // Reduce settlement population
            settlement.population = Math.floor(settlement.population * 0.9);
            House.accrueRivalFeud(player, world, settlement.kingdom, 10, `raided ${settlement.name}`);
            NPCLords.rememberRealm(world, settlement.kingdom, 'raid', { note: settlement.name });
        } else {
            // Failed raid - even worse reputation
            if (settlement.kingdom) {
                player.reputation[settlement.kingdom] =
                    (player.reputation[settlement.kingdom] || 0) - 30;
            }
            player.karma -= 3;
            NPCLords.rememberRealm(world, settlement.kingdom, 'raid_failed', { note: settlement.name });
            House.accrueRivalFeud(player, world, settlement.kingdom, 5, `attempted raid on ${settlement.name}`);
        }

        return result;
    },

    /**
     * Attack a settlement to conquer it.
     * Harder than raiding — the entire garrison must be defeated.
     */
    attackSettlement(player, settlement, tile, world) {
        // At a port, war galleys blockade the harbour and join the siege
        const theatre = PlayerMilitary.settlementTheatre(world, tile);
        const playerStrength = PlayerMilitary.getTheatreStrength(player, theatre);

        if (PlayerMilitary.getArmyStrength(player) === 0) {
            return { success: false, reason: 'You have no land army! Recruit soldiers first — galleys alone cannot take a town.' };
        }

        if (playerStrength < 50) {
            return { success: false, reason: 'Army too weak to siege a settlement (need 50+ strength)' };
        }

        // Settlement defense — stronger than raiding since garrison fights to the last
        const defenseMultiplier = {
            village: 0.8,
            town: 1.5,
            city: 3.0,
            capital: 5.0,
        };

        // Garrison = population-based defense + kingdom military contribution
        let garrisonStrength = Math.floor(
            settlement.population * 0.03 * (defenseMultiplier[settlement.type] || 1)
        );

        // Kingdom military reinforcements (if settlement belongs to a kingdom)
        if (settlement.kingdom) {
            const kingdom = world.getKingdom(settlement.kingdom);
            if (kingdom && kingdom.military > 0) {
                // Capital gets 40% of kingdom military, other settlements get 15%
                const militaryShare = settlement.type === 'capital' ? 0.4 : 0.15;
                garrisonStrength += Math.floor(kingdom.military * militaryShare);
            }
        }

        // Walls bonus for cities and capitals
        if (settlement.type === 'city' || settlement.type === 'capital') {
            garrisonStrength = Math.floor(garrisonStrength * 1.3); // 30% wall bonus
        }
        // Walls raised while it was a holding (systems/holdings.js) still stand
        const holdingWalls = Economy.holdingFx(settlement, 'defense');
        if (holdingWalls) garrisonStrength = Math.floor(garrisonStrength * (1 + holdingWalls));

        // Combat
        const result = PlayerMilitary.combat(player, garrisonStrength, settlement.name, {
            terrainId: tile?.terrain?.id,
            enemyComposition: PlayerMilitary._getSettlementComposition(settlement, tile),
            world,
            siege: true, // siege engines breach the walls
            theatre,
            enemyMoraleBonus: settlement.type === 'capital' ? 0.1 : 0,
            lootTown: settlement, // the garrison's spoils out of the town's purse
        });
        result.garrisonStrength = garrisonStrength;

        const previousKingdom = settlement.kingdom;

        if (result.victory) {
            PlayerMilitary.conquerSettlement(player, settlement, tile, world, result);
        } else {
            // --- DEFEAT ---
            result.conquered = false;

            // Reputation hit even for failed attack
            if (previousKingdom) {
                player.reputation[previousKingdom] =
                    (player.reputation[previousKingdom] || 0) - 30;
            }
            player.karma -= 5;
            result.karmaChange = -5;
            NPCLords.rememberRealm(world, previousKingdom, 'assault_failed', { note: settlement.name });
        }

        return result;
    },

    /**
     * Take a settlement: plunder, the old realm's losses (a capital moves or
     * the realm falls), the new owner (the player's liege, or the player's
     * own colony/holding when unsworn), karma, reputation, renown and House
     * deeds. Shared by attackSettlement and a siege that ends in capture or
     * surrender (systems/sieges.js). `opts` softens a negotiated surrender:
     * { plunder: [min, max] per head, popKeep, karma, reputationMult }.
     */
    conquerSettlement(player, settlement, tile, world, result = {}, opts = {}) {
        const previousKingdom = settlement.kingdom;
        {
            // --- CONQUEST ---
            result.conquered = true;
            Quests.track(player, 'settlements_captured');

            // Plunder gold out of the settlement's purse (as much as it holds)
            const range = opts.plunder || [1, 3];
            const want = Math.floor(settlement.population * Utils.randFloat(range[0], range[1]));
            const plunder = PlayerMilitary._spoilsSource({ lootTown: settlement }).take(want);
            player.gold += plunder;
            result.plunder = plunder;

            // Population suffers from the siege
            settlement.population = Math.floor(settlement.population * (opts.popKeep != null ? opts.popKeep : 0.7));

            // Remove settlement from old kingdom
            if (previousKingdom) {
                const oldKingdom = world.getKingdom(previousKingdom);
                if (oldKingdom) {
                    // Remove from kingdom territory
                    oldKingdom.territory = oldKingdom.territory.filter(t =>
                        t.q !== tile.q || t.r !== tile.r
                    );
                    // Take military losses
                    const militaryLoss = settlement.type === 'capital' ? 0.3 : 0.1;
                    oldKingdom.military = Math.floor(oldKingdom.military * (1 - militaryLoss));
                    // Update population
                    oldKingdom.population = Math.max(0, oldKingdom.population - settlement.population);

                    // Check if this was their capital
                    if (oldKingdom.capital && oldKingdom.capital.q === tile.q && oldKingdom.capital.r === tile.r) {
                        result.capitalCaptured = true;
                        // Try to relocate capital to another settlement
                        const remainingSettlements = [];
                        for (const t of oldKingdom.territory) {
                            const kt = world.getTile(t.q, t.r);
                            if (kt && kt.settlement && kt.settlement.kingdom === previousKingdom) {
                                remainingSettlements.push(t);
                            }
                        }
                        if (remainingSettlements.length > 0) {
                            oldKingdom.capital = remainingSettlements[0];
                        } else {
                            // Kingdom destroyed!
                            oldKingdom.isAlive = false;
                            result.kingdomDestroyed = true;
                        }
                    }
                }
            }

            // Transfer ownership to the player's kingdom, or make independent
            if (player.allegiance) {
                settlement.kingdom = player.allegiance;
                tile.kingdom = player.allegiance;
                const playerKingdom = world.getKingdom(player.allegiance);
                if (playerKingdom) {
                    playerKingdom.territory.push({ q: tile.q, r: tile.r });
                    playerKingdom.population += settlement.population;
                }
                result.newOwner = playerKingdom ? playerKingdom.name : 'your kingdom';
            } else {
                // No allegiance — settlement becomes a player colony
                settlement.kingdom = null;
                tile.kingdom = null;
                if (!settlement.colony) settlement.colony = {};
                settlement.colony.isPlayerColony = true;
                settlement.colony.foundedDay = world.day;
                settlement.colony.loyalty = 30; // Low initial loyalty after conquest
                if (!player.colonies) player.colonies = [];
                player.colonies.push({ q: tile.q, r: tile.r, name: settlement.name, foundedDay: world.day });
                result.newOwner = 'you (independent colony)';
            }

            // The market's stores are looted (world/settlementMarket.js)
            SettlementMarket.loot(settlement, 0.5);

            // Massive karma and reputation hit (less for a town that opened its gates)
            const karma = opts.karma != null ? opts.karma : -10;
            player.karma += karma;
            if (karma <= -10) Traits.recordAggression(player, previousKingdom, { cruelty: 2 });
            result.karmaChange = karma;

            // Reputation with ALL kingdoms drops
            const repMult = opts.reputationMult != null ? opts.reputationMult : 1;
            for (const k of world.kingdoms) {
                if (!k.isAlive) continue;
                const penalty = Math.round((k.id === previousKingdom ? -50 : -10) * repMult);
                player.reputation[k.id] = (player.reputation[k.id] || 0) + penalty;
            }
            // The crown that lost the town will not forget it
            if (previousKingdom) {
                const def = NPCLords.deedDef('conquest');
                NPCLords.rememberRealm(world, previousKingdom, 'conquest', { note: settlement.name, weight: def ? def.weight * Math.max(0.25, repMult) : undefined });
            }

            // Renown boost
            const renownGain = settlement.type === 'capital' ? 50 :
                               settlement.type === 'city' ? 30 :
                               settlement.type === 'town' ? 15 : 5;
            player.renown += renownGain;
            result.renownChange = renownGain;

            // House Prestige — taking a settlement is a major dynastic deed.
            House.recordPlayerDeed(player, world, 'settlementHeld', {
                reason: `conquered ${settlement.name}`,
                chronicle: `${player.house ? player.house.name : 'The House'} conquers ${settlement.name}.`,
                tags: ['conquest', 'war'],
            });
            // Taking a kingdom's settlement inflames its rival House.
            House.accrueRivalFeud(player, world, previousKingdom, 25, `conquered ${settlement.name}`);
            // Storming a living realm's capital gives a claim on its throne
            if (result.capitalCaptured && !result.kingdomDestroyed && previousKingdom) {
                result.throneClaim = Throne.onCapitalCaptured(player, world, previousKingdom);
            }

            world.events.push({
                text: `⚔️ ${player.name} has conquered ${settlement.name}!`,
                type: 'military'
            });
        }
        return result;
    },

    /**
     * Get the garrison strength of a settlement for display purposes
     */
    getSettlementDefense(settlement, world) {
        const defenseMultiplier = {
            village: 0.8,
            town: 1.5,
            city: 3.0,
            capital: 5.0,
        };

        let garrisonStrength = Math.floor(
            settlement.population * 0.03 * (defenseMultiplier[settlement.type] || 1)
        );

        if (settlement.kingdom) {
            const kingdom = world.getKingdom(settlement.kingdom);
            if (kingdom && kingdom.military > 0) {
                const militaryShare = settlement.type === 'capital' ? 0.4 : 0.15;
                garrisonStrength += Math.floor(kingdom.military * militaryShare);
            }
        }

        if (settlement.type === 'city' || settlement.type === 'capital') {
            garrisonStrength = Math.floor(garrisonStrength * 1.3);
        }
        // Walls raised while it was a holding (systems/holdings.js) still stand
        const walls = Economy.holdingFx(settlement, 'defense');
        if (walls) garrisonStrength = Math.floor(garrisonStrength * (1 + walls));

        return garrisonStrength;
    },

    /**
     * Attack a world unit on the player's tile. opts: { defending, combatResult }
     * — a combatResult already fought (the phased field battle) skips the roll.
     */
    attackUnit(player, worldUnit, world, opts = {}) {
        const unitTile = world.getTile(worldUnit.q, worldUnit.r);
        // A phased field battle (player/fieldBattle.js) hands in its own result
        const combatResult = opts.combatResult || PlayerMilitary.combat(player, worldUnit.strength, worldUnit.name, {
            terrainId: unitTile?.terrain?.id,
            enemyComposition: PlayerMilitary._getWorldUnitComposition(worldUnit),
            world,
            defending: !!opts.defending,
            // The spoils are what the unit carried (the rest of its inventory follows below);
            // a realm's men with no chest of their own: out of its treasury
            ...PlayerMilitary._unitLoot(worldUnit, world),
            // Aboard ship or on the water the fight is at sea
            theatre: PlayerMilitary.tileTheatre(
                typeof player.q === 'number' ? world.getTile(player.q, player.r) : unitTile, player),
        });

        // Handle no-army edge case
        if (combatResult.reason) {
            return {
                ...combatResult,
                noArmy: true,
                enemyName: worldUnit.name,
                karmaChange: 0,
                renownChange: 0,
                inventoryLoot: {},
            };
        }

        let karmaChange = 0;
        let renownChange = 0;
        let inventoryLoot = {};
        let lootLeftBehind = null;

        if (combatResult.victory) {
            // Transfer unit inventory to player
            if (worldUnit.inventory) {
                // Coin goes straight to the purse (it used to sit in the packs as
                // an 'item' nothing ever spent)
                const { gold: coin = 0, ...goods } = worldUnit.inventory;
                if (coin > 0) player.gold = (player.gold || 0) + coin;
                // Loot that doesn't fit in the player's packs is left behind
                const loot = PlayerInventory.addItems(player, goods);
                inventoryLoot = coin > 0 ? { gold: coin, ...loot.added } : loot.added;
                if (loot.full) lootLeftBehind = loot.dropped;
            }

            // Destroy the unit
            worldUnit.destroyed = true;
            worldUnit.slainByPlayer = true; // sagas tell your kill from a patrol's (systems/sagas.js)
            if (worldUnit.type === 'war_host') {
                // A rebel host against your own crown (systems/kingship.js), or a realm's
                if (worldUnit.revoltId) Kingship.onRebelHostDefeated(player, world, worldUnit);
                else RealmWars.onHostDefeated(player, world, worldUnit);
            }
            // Beating raiders, pirates, monsters (saga beasts among them) and sellswords
            // is a battle won for the House's legacy ("the Warlike"); war hosts are
            // counted by RealmWars, and robbing caravans and boats is no glory.
            if (['raider', 'pirate', 'monster', 'mercenary'].includes(worldUnit.type) || worldUnit.sagaKey) {
                House.recordPlayerDeed(player, world, 'battleWon', { reason: `defeated ${worldUnit.name || 'a foe'}` });
            }

            Quests.track(player, 'battles_won');
            if (worldUnit.type === 'raider' || worldUnit.type === 'pirate') Quests.track(player, 'raiders_defeated');
            if (worldUnit.type === 'pirate') Quests.track(player, 'pirates_defeated');
            if (worldUnit.type === 'monster') Quests.track(player, 'special_creatures_defeated');
            // A win while badly hurt counts as a close call
            if (player.health < (player.maxHealth || 100) * 0.2) Quests.track(player, 'close_calls');

            // Karma/reputation effects by unit type
            switch (worldUnit.type) {
                case 'caravan':
                case 'ship':
                case 'fishing_boat':
                    karmaChange = -3;
                    Traits.recordDeeds(player, { greed: 2, cruelty: 1, seafaring: worldUnit.type === 'caravan' ? 0 : 2 }); // piracy
                    Quests.track(player, 'piracy_committed'); // companions with values notice
                    // Banditry and piracy against a realm's traders: underworld heat
                    if (worldUnit.type === 'caravan') Underworld.recordCrime(player, world, 'theft', { kingdom: worldUnit.kingdom || worldUnit.kingdomId || Underworld._nearestKingdom(world, worldUnit.q, worldUnit.r), scale: 2 });
                    else Underworld.recordPiracy(player, world, worldUnit.q, worldUnit.r);
                    player.karma += karmaChange;
                    break;
                case 'settler':
                    karmaChange = -5;
                    Traits.recordDeed(player, 'cruelty', 2);
                    player.karma += karmaChange;
                    break;
                case 'raider':
                case 'pirate':
                    karmaChange = 1;
                    renownChange = Math.floor(worldUnit.strength / 5) + 2;
                    player.karma += karmaChange;
                    player.renown += renownChange;
                    break;
                case 'trade_caravan':
                case 'trade_ship': {
                    // An NPC merchant's caravan or ship (systems/merchantCaravans.js):
                    // hot goods, heat and a witnessed crime, the realm's displeasure
                    const before = player.karma || 0;
                    MerchantCaravans.onRobbed(player, world, worldUnit, inventoryLoot);
                    karmaChange = (player.karma || 0) - before;
                    Quests.track(player, 'piracy_committed');
                    break;
                }
                case 'courier_rider': {
                    // A post rider (systems/courierRiders.js): the bag's coin is loot; a
                    // sealed letter to the inbox, heat and the realm's displeasure
                    const before = player.karma || 0;
                    CourierRiders.onRobbed(player, world, worldUnit, inventoryLoot);
                    karmaChange = (player.karma || 0) - before;
                    break;
                }
                case 'rival_retinue': {
                    // A rival House's head on the road (systems/rivalHouses.js): their purse, their blood, the feud
                    const before = player.karma || 0;
                    const text = RivalHouses.onAttacked(player, world, worldUnit, true);
                    karmaChange = (player.karma || 0) - before;
                    if (text && world.events) world.events.push({ text, type: 'military' });
                    break;
                }
                case 'patrol':
                case 'road_patrol':
                    karmaChange = -2;
                    Traits.recordAggression(player, worldUnit.kingdom, { dread: 1 });
                    player.karma += karmaChange;
                    // Anger the patrol's kingdom
                    if (worldUnit.kingdom) {
                        player.reputation[worldUnit.kingdom] =
                            (player.reputation[worldUnit.kingdom] || 0) - 25;
                        NPCLords.rememberRealm(world, worldUnit.kingdom, 'patrol_attacked');
                    }
                    break;
                case 'pilgrim_group':
                case 'refugee':
                case 'diplomatic_envoy':
                    // Preying on the defenceless or on envoys is dishonourable
                    karmaChange = -8;
                    Traits.recordDeeds(player, { cruelty: 4, dread: 1 });
                    player.karma += karmaChange;
                    break;
                case 'smuggler':
                    karmaChange = 1;
                    player.karma += karmaChange;
                    break;
                case 'beast':
                    renownChange = Math.floor(worldUnit.strength / 6) + 1;
                    player.renown += renownChange;
                    break;
                case 'monster':
                    karmaChange = 3;
                    renownChange = 40;
                    player.karma += karmaChange;
                    player.renown += renownChange;
                    break;
            }

            // Log event
            if (world.events) {
                world.events.push({
                    text: `${player.name || 'The player'} defeated a ${worldUnit.name}!`,
                    type: 'military'
                });
            }
        } else {
            // Beaten off by a merchant's guards: they saw your face
            if (MerchantCaravans.isTrader(worldUnit)) MerchantCaravans.onRobberyFailed(player, world, worldUnit);
            if (CourierRiders.isRider(worldUnit)) CourierRiders.onRobberyFailed(player, world, worldUnit);
            if (RivalHouses.isRetinue(worldUnit)) RivalHouses.onAttacked(player, world, worldUnit, false);
            // Log defeat event
            if (world.events) {
                world.events.push({
                    text: `${player.name || 'The player'} was defeated by a ${worldUnit.name}!`,
                    type: 'military'
                });
            }
        }

        return {
            ...combatResult,
            enemyName: combatResult.enemyName || worldUnit.name,
            karmaChange,
            renownChange,
            inventoryLoot,
            lootLeftBehind,
        };
    },

    // ── Weather on the battlefield ─────────────────────────────────────
    /** Weather type at the player's position (context.weather overrides). */
    _battleWeather(player, context = {}) {
        if (context.weather) return context.weather;
        const world = context.world;
        if (!world || !world.weather || typeof player.q !== 'number') return 'clear';
        return world.weather.getWeather(player.q, player.r).type;
    },

    /** Power multiplier for an army's composition fighting in this weather. */
    _weatherMultiplier(weatherType, composition) {
        const fx = WEATHER_EFFECTS[weatherType];
        if (!fx || !composition) return 1;
        const mult = 1 + (fx.archerPower || 0) * (composition.archer || 0)
            + (fx.cavalryPower || 0) * (composition.cavalry || 0);
        return Math.max(0.5, mult);
    },

    // ── World-event effects on battle (data/worldEvents.json) ──────────
    /** Morale from running events at the player's tile (festival +0.2, plague -0.2). */
    _worldEventMorale(player, context = {}) {
        return context.world ? WorldEvents.playerMoraleBonus(context.world, player) : 0;
    },

    /** Extra renown for victories while a monster sighting has the land on edge. */
    _worldEventRenownBonus(player, context = {}) {
        const world = context.world;
        if (!world || !world.getTile) return 0;
        return Math.max(0, WorldEvents.getModifier(world, 'renownBonus', world.getTile(player.q, player.r)));
    },
});
