// PlayerMilitary — recruitment members (split from the original monolith).
import { PlayerMilitary } from './_ref.js';
import { Utils, Technology, House, SettlementServices, PlayerEffects, Peoples } from './_imports.js';

Object.assign(PlayerMilitary, {
    /**
     * Unit types the player can recruit
     */
    UNIT_TYPES: {
        MILITIA: {
            id: 'militia',
            name: 'Militia',
            icon: '🗡️',
            cost: 50,
            upkeep: 2,
            strength: 5,
            description: 'Basic fighters, cheap but weak',
            minSettlement: 'village',  // available everywhere
            minPopulation: 0,
        },
        SOLDIER: {
            id: 'soldier',
            name: 'Soldier',
            icon: '⚔️',
            cost: 100,
            upkeep: 5,
            strength: 10,
            description: 'Trained warriors, reliable in battle',
            minSettlement: 'town',
            minPopulation: 0,
        },
        KNIGHT: {
            id: 'knight',
            name: 'Knight',
            icon: '🛡️',
            cost: 300,
            upkeep: 15,
            strength: 30,
            description: 'Elite cavalry, devastating in combat',
            minSettlement: 'capital',
            minPopulation: 3000,
        },
        ARCHER: {
            id: 'archer',
            name: 'Archer',
            icon: '🏹',
            cost: 80,
            upkeep: 4,
            strength: 8,
            description: 'Ranged attackers, good for defense',
            minSettlement: 'town',
            minPopulation: 0,
        },
        PIKEMAN: {
            id: 'pikeman',
            name: 'Pikeman',
            icon: '🪓',
            cost: 110,
            upkeep: 5,
            strength: 12,
            description: 'Anti-cavalry infantry formation specialist',
            minSettlement: 'town',
            minPopulation: 1000,
        },
    },

    FORMATION_ROLES: {
        cavalry: ['knight', 'cavalry', 'heavy_cavalry', 'war_elephant'],
        archer: ['archer', 'longbowman', 'crossbowman'],
        pikeman: ['pikeman', 'soldier', 'militia'],
    },

    // ──────────── UNIT SPECIAL STATS ────────────

    /** Per-type stats beyond strength/upkeep that a recruited unit carries. */
    UNIT_TRAIT_KEYS: ['siegeBonus', 'defenseBonus', 'rangeBonus', 'speed', 'sightRange',
        'specialAbility', 'commanderKillChance', 'spellPower'],

    /** Base sight radius and march speed a Scout's sightRange/speed improve on. */
    BASE_SIGHT_RANGE: 3,
    BASE_UNIT_SPEED: 4,

    /** Days a soldier saved by Surgery fights at half strength. */
    WOUNDED_DAYS: 5,

    /** Look up a unit type definition by id (recruitable or tech-unlocked). */
    getUnitDef(unitType) {
        if (!unitType) return null;
        const id = String(unitType).toLowerCase();
        for (const pool of [PlayerMilitary.UNIT_TYPES, Technology.TECH_UNITS]) {
            for (const def of Object.values(pool || {})) {
                if (def && def.id === id) return def;
            }
        }
        return null;
    },

    /** Build the army entry for a freshly recruited unit of type `def`. */
    makeArmyUnit(def) {
        const unit = {
            type: def.id,
            name: def.name,
            icon: def.icon,
            strength: def.strength,
            upkeep: def.upkeep,
            experience: 0,
            level: 1,
        };
        for (const key of PlayerMilitary.UNIT_TRAIT_KEYS) {
            if (def[key] !== undefined) unit[key] = def[key];
        }
        return unit;
    },

    /**
     * A unit's special stat. Units from older saves lack the copied fields,
     * so fall back to their type definition.
     */
    unitTrait(unit, key) {
        if (!unit) return undefined;
        if (unit[key] !== undefined) return unit[key];
        const def = PlayerMilitary.getUnitDef(unit.type);
        return def ? def[key] : undefined;
    },

    /** Summed special stats of the player's army (sight/speed: best unit). */
    getArmySpecials(player) {
        const out = { siegeBonus: 0, defenseBonus: 0, rangeBonus: 0, commanderKillChance: 0,
            spellPower: 0, sightRange: 0, speed: 0 };
        for (const unit of player.army || []) {
            for (const key of ['siegeBonus', 'defenseBonus', 'rangeBonus', 'commanderKillChance', 'spellPower']) {
                const v = PlayerMilitary.unitTrait(unit, key);
                if (typeof v === 'number') out[key] += v;
            }
            const sight = PlayerMilitary.unitTrait(unit, 'sightRange');
            if (typeof sight === 'number') out.sightRange = Math.max(out.sightRange, sight);
            const speed = PlayerMilitary.unitTrait(unit, 'speed');
            if (typeof speed === 'number') out.speed = Math.max(out.speed, speed);
        }
        return out;
    },

    /** Extra fog-of-war radius from Scouts riding with the army. */
    getScoutVisionBonus(player) {
        const sight = PlayerMilitary.getArmySpecials(player).sightRange;
        return Math.max(0, sight - PlayerMilitary.BASE_SIGHT_RANGE);
    },

    /** Extra daily movement from Scouts finding quick paths (+1 per 4 speed above base, max 2). */
    getScoutMovementBonus(player) {
        const speed = PlayerMilitary.getArmySpecials(player).speed;
        return Math.min(2, Math.max(0, Math.floor((speed - PlayerMilitary.BASE_UNIT_SPEED) / 4)));
    },

    /** Short summary of a unit type's specials, for recruit screens. */
    describeUnitTraits(def) {
        if (!def) return '';
        const parts = [];
        if (def.siegeBonus) parts.push(`Siege: +${def.siegeBonus}% army power vs settlements`);
        if (def.defenseBonus) parts.push(`Defending: +${def.defenseBonus / 2.5}% army power`);
        if (def.rangeBonus) parts.push(`Volleys: up to +${def.rangeBonus * 3}% vs melee`);
        if (def.sightRange) parts.push(`Vision +${Math.max(0, def.sightRange - PlayerMilitary.BASE_SIGHT_RANGE)}`);
        if (def.speed && def.speed > PlayerMilitary.BASE_UNIT_SPEED) {
            parts.push(`+${Math.min(2, Math.floor((def.speed - PlayerMilitary.BASE_UNIT_SPEED) / 4))} movement/day`);
        }
        if (def.commanderKillChance) parts.push(`${Math.round(def.commanderKillChance * 100)}% chance to slay the enemy commander`);
        if (def.spellPower) parts.push(`Spells: −${Math.round(def.spellPower * 100)}% enemy power`);
        return parts.join(' · ');
    },

    /**
     * Battle multipliers from unit specials and military techs:
     * siege engines (attacking settlements), shield walls (defending),
     * longbow volleys (vs melee), crossbow piercing (ranged share),
     * plate armour (enemy power and casualties), battle mages (area spells)
     * and assassins (chance to slay the enemy commander, breaking their morale).
     * Draws randomness only when the army has assassins.
     */
    getBattleSpecials(player, context, playerComp, enemyComp) {
        const sp = PlayerMilitary.getArmySpecials(player);
        let playerMult = 1;
        let enemyMult = 1;
        let casualtyMult = 1;
        if (context.siege && sp.siegeBonus > 0) playerMult *= 1 + Math.min(1, sp.siegeBonus / 100);
        if (context.defending && sp.defenseBonus > 0) playerMult *= 1 + Math.min(0.5, sp.defenseBonus / 250);
        if (sp.rangeBonus > 0) {
            const melee = (enemyComp.cavalry || 0) + (enemyComp.pikeman || 0);
            playerMult *= 1 + Math.min(0.3, sp.rangeBonus * 0.03) * melee;
        }
        const piercing = Technology.getEffectTotal(player, 'rangedPiercing');
        if (piercing > 0) playerMult *= 1 + piercing * (playerComp.archer || 0);
        const armour = Technology.getEffectTotal(player, 'unitDefenseBonus');
        if (armour > 0) {
            enemyMult *= Math.max(0.5, 1 - armour / 2);
            casualtyMult *= Math.max(0.5, 1 - armour / 2);
        }
        if (sp.spellPower > 0) enemyMult *= 1 - Math.min(0.3, sp.spellPower);
        let commanderSlain = false;
        if (sp.commanderKillChance > 0) {
            commanderSlain = Utils.random() < Math.min(0.6, sp.commanderKillChance);
        }
        return { playerMult, enemyMult, casualtyMult, commanderSlain };
    },

    /** Wounded soldiers heal a day at a time; returns how many recovered today. */
    tickWounded(player) {
        let healed = 0;
        for (const unit of player.army || []) {
            if (unit.woundedDays > 0) {
                unit.woundedDays--;
                if (unit.woundedDays === 0) { delete unit.woundedDays; healed++; }
            }
        }
        return healed;
    },

    _normalizeComposition(comp) {
        const c = {
            cavalry: Math.max(0, comp.cavalry || 0),
            archer: Math.max(0, comp.archer || 0),
            pikeman: Math.max(0, comp.pikeman || 0),
        };
        const total = c.cavalry + c.archer + c.pikeman;
        if (total <= 0) return { cavalry: 0.34, archer: 0.33, pikeman: 0.33 };
        c.cavalry /= total;
        c.archer /= total;
        c.pikeman /= total;
        return c;
    },

    _roleForUnitType(unitType) {
        for (const [role, types] of Object.entries(PlayerMilitary.FORMATION_ROLES)) {
            if (types.includes(unitType)) return role;
        }
        return 'pikeman';
    },

    getArmyComposition(player) {
        if (!player.army || player.army.length === 0) {
            return PlayerMilitary._normalizeComposition({});
        }

        const comp = { cavalry: 0, archer: 0, pikeman: 0 };
        for (const unit of player.army) {
            const role = PlayerMilitary._roleForUnitType(unit.type);
            const levelBonus = 1 + ((unit.level || 1) - 1) * 0.1;
            comp[role] += (unit.strength || 1) * levelBonus;
        }

        return PlayerMilitary._normalizeComposition(comp);
    },

    inferEnemyComposition(enemyStrength, enemyName = '', context = {}) {
        if (context.enemyComposition) {
            return PlayerMilitary._normalizeComposition(context.enemyComposition);
        }

        const name = (enemyName || '').toLowerCase();
        if (name.includes('raider') || name.includes('cavalry') || name.includes('knight')) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.55, archer: 0.15, pikeman: 0.30 });
        }
        if (name.includes('patrol')) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.35, archer: 0.30, pikeman: 0.35 });
        }
        if (name.includes('city') || name.includes('capital') || name.includes('garrison')) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.20, archer: 0.35, pikeman: 0.45 });
        }
        if (name.includes('bandit') || name.includes('pirate')) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.35, archer: 0.20, pikeman: 0.45 });
        }
        if (enemyStrength < 35) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.20, archer: 0.20, pikeman: 0.60 });
        }
        return PlayerMilitary._normalizeComposition({ cavalry: 0.30, archer: 0.30, pikeman: 0.40 });
    },

    _counterScore(attackerComp, defenderComp) {
        const advantage =
            attackerComp.cavalry * defenderComp.archer +
            attackerComp.archer * defenderComp.pikeman +
            attackerComp.pikeman * defenderComp.cavalry;

        const disadvantage =
            defenderComp.cavalry * attackerComp.archer +
            defenderComp.archer * attackerComp.pikeman +
            defenderComp.pikeman * attackerComp.cavalry;

        return advantage - disadvantage;
    },

    _counterMultiplier(attackerComp, defenderComp) {
        const score = PlayerMilitary._counterScore(attackerComp, defenderComp);
        return Math.max(0.8, Math.min(1.25, 1 + score * 0.75));
    },

    _terrainIsHills(terrainId = '') {
        return ['hills', 'highlands', 'foothills'].includes(terrainId);
    },

    _terrainIsPlains(terrainId = '') {
        return ['plains', 'grassland', 'steppe', 'savanna'].includes(terrainId);
    },

    _terrainMultiplier(terrainId, composition) {
        if (PlayerMilitary._terrainIsHills(terrainId)) {
            return 1 + composition.archer * 0.18;
        }
        if (PlayerMilitary._terrainIsPlains(terrainId)) {
            return 1 + composition.cavalry * 0.18;
        }
        return 1;
    },

    _moraleValue(ownStrength, enemyStrength, leadershipBonus = 0) {
        const ratio = enemyStrength / Math.max(1, ownStrength);
        const pressurePenalty = Math.max(0, ratio - 1) * 0.34;
        const morale = 1 - pressurePenalty + leadershipBonus;
        return Math.max(0.45, Math.min(1.2, morale));
    },

    _checkMoraleBreak(ownStrength, enemyStrength, moraleValue) {
        const outnumberedRatio = enemyStrength / Math.max(1, ownStrength);
        if (outnumberedRatio < 1.8) return false;
        const chance = Math.max(0.05, Math.min(0.75, (outnumberedRatio - 1.6) * 0.45 + (1 - moraleValue) * 0.6));
        return Utils.random() < chance;
    },

    _getSettlementComposition(settlement, tile) {
        const composition = { cavalry: 0.18, archer: 0.32, pikeman: 0.50 };
        if (settlement.type === 'capital') {
            composition.archer += 0.08;
            composition.pikeman += 0.04;
        } else if (settlement.type === 'city') {
            composition.archer += 0.05;
        } else if (settlement.type === 'village') {
            composition.pikeman += 0.08;
        }

        const terrainId = tile?.terrain?.id;
        if (PlayerMilitary._terrainIsPlains(terrainId)) {
            composition.cavalry += 0.08;
        } else if (PlayerMilitary._terrainIsHills(terrainId)) {
            composition.archer += 0.08;
        }

        return PlayerMilitary._normalizeComposition(composition);
    },

    _getWorldUnitComposition(worldUnit) {
        switch (worldUnit.type) {
            case 'raider':
                return { cavalry: 0.65, archer: 0.10, pikeman: 0.25 };
            case 'patrol':
                return { cavalry: 0.35, archer: 0.35, pikeman: 0.30 };
            case 'settler':
            case 'caravan':
            case 'ship':
            case 'fishing_boat':
                return { cavalry: 0.10, archer: 0.10, pikeman: 0.80 };
            case 'pirate':
                return { cavalry: 0.20, archer: 0.45, pikeman: 0.35 };
            default:
                return { cavalry: 0.30, archer: 0.25, pikeman: 0.45 };
        }
    },

    /**
     * Settlement tier hierarchy for recruitment checks
     */
    SETTLEMENT_TIER: { village: 1, town: 2, city: 3, capital: 4 },

    /**
     * Max units that can be recruited from a settlement based on population
     * (per visit / per day — resets each day)
     */
    getRecruitmentCapacity(settlement) {
        const pop = settlement.population || 0;
        // Can recruit roughly 1 per 50 people, minimum 1; martial peoples
        // (shieldfolk, refugees, ...) step forward more readily
        const { capacityMult } = Peoples.recruitModifiers(settlement);
        return Math.max(1, Math.floor((pop / 50) * capacityMult));
    },

    /**
     * Check if a unit type is available at a given settlement
     */
    isUnitAvailable(unit, settlement) {
        const tierMap = PlayerMilitary.SETTLEMENT_TIER;
        const settTier = tierMap[settlement.type] || 0;
        const reqTier = tierMap[unit.minSettlement || 'village'] || 1;
        if (settTier < reqTier) return { available: false, reason: `Requires ${unit.minSettlement || 'town'} or larger` };
        if (unit.minPopulation && (settlement.population || 0) < unit.minPopulation) {
            return { available: false, reason: `Requires population ≥ ${unit.minPopulation}` };
        }
        return { available: true };
    },

    /**
     * Check if a tech unit type is available at a given settlement
     */
    isTechUnitAvailable(unit, settlement) {
        const tierMap = PlayerMilitary.SETTLEMENT_TIER;
        const settTier = tierMap[settlement.type] || 0;
        // Longbowman: town+  |  Cavalry & Siege Engine: capital only
        if (unit.id === 'longbowman' && settTier < 2) return { available: false, reason: 'Requires town or larger' };
        if (unit.id === 'cavalry' && settTier < 3) return { available: false, reason: 'Requires city or capital' };
        if (unit.id === 'siege_engine' && settTier < 4) return { available: false, reason: 'Requires a capital' };
        return { available: true };
    },

    /**
     * Recruit a unit at a settlement
     */
    /**
     * Gold to recruit `unit`, after the Marshal's military discount and —
     * when recruiting at `settlement` — its martial peoples' discount.
     */
    getRecruitCost(player, unit, settlement = null) {
        const peoples = settlement ? Peoples.recruitModifiers(settlement).costMult : 1;
        return Math.round(unit.cost * PlayerEffects.recruitCostMultiplier(player) * peoples);
    },

    recruitUnit(player, unitType, settlement) {
        const unit = PlayerMilitary.UNIT_TYPES[unitType.toUpperCase()];
        if (!unit) return { success: false, reason: 'Invalid unit type' };
        const cost = PlayerMilitary.getRecruitCost(player, unit, settlement);

        // Check gold
        if (player.gold < cost) {
            return { success: false, reason: `Need ${cost} gold (have ${Math.floor(player.gold)})` };
        }

        // Check settlement requirements
        const avail = PlayerMilitary.isUnitAvailable(unit, settlement);
        if (!avail.available) {
            return { success: false, reason: avail.reason };
        }

        // Check recruitment capacity
        const capacity = PlayerMilitary.getRecruitmentCapacity(settlement);
        const recruited = player._recruitedThisTurn || 0;
        if (recruited >= capacity) {
            return { success: false, reason: `This settlement can only supply ${capacity} recruit${capacity > 1 ? 's' : ''} right now (pop: ${settlement.population})` };
        }

        player.gold -= cost;

        // Track recruitment count
        player._recruitedThisTurn = (player._recruitedThisTurn || 0) + 1;

        // Add to player's army (special stats travel with the unit)
        if (!player.army) player.army = [];
        player.army.push(PlayerMilitary.makeArmyUnit(unit));

        // Increase combat skill
        player.skills.combat = Math.min(10, player.skills.combat + 0.3);

        return { success: true, unit };
    },

    /**
     * Calculate total army strength
     */
    getArmyStrength(player) {
        if (!player.army || player.army.length === 0) return 0;

        let total = 0;
        for (const unit of player.army) {
            let strength = unit.strength;
            // Level bonus
            strength *= (1 + (unit.level - 1) * 0.2);
            // Wounded soldiers (saved by Surgery) fight at half strength
            if (unit.woundedDays > 0) strength *= 0.5;
            // Combat skill bonus
            strength *= (1 + player.skills.combat * 0.1);
            // Technology strength bonus
            if (typeof Technology !== 'undefined') {
                const techBonus = Technology.getUnitStrengthBonus(player, unit.type);
                if (techBonus > 0) strength *= (1 + techBonus);
            }
            total += strength;
        }
        // Arms honed by a blacksmith
        total *= SettlementServices.armyStrengthMultiplier(player);

        return Math.floor(total);
    },

    /**
     * Calculate daily upkeep cost
     */
    getUpkeepCost(player) {
        if (!player.army || player.army.length === 0) return 0;

        let total = 0;
        for (const unit of player.army) {
            total += unit.upkeep;
        }
        // A House Marshal lowers upkeep (multiplier is 1 when no Marshal serves).
        if (typeof House !== 'undefined' && player.house) {
            const mult = House.getRoleBonuses(player).armyUpkeepMult;
            if (mult != null) total = Math.round(total * mult);
        }
        return total;
    },

    /**
     * Pay army upkeep
     */
    payUpkeep(player, world = null) {
        PlayerMilitary._ensureMercenaryState(player);
        const woundedHealed = PlayerMilitary.tickWounded(player);
        const cost = PlayerMilitary.getUpkeepCost(player);
        const result = {
            woundedHealed,
            paid: true,
            cost: 0,
            unitsLost: 0,
            mercenaryWages: 0,
            mercenaryEvents: [],
        };

        if (player.gold < cost) {
            // Can't pay - lose some units
            const nonMercCount = (player.army || []).filter(unit => !unit.mercenary).length;
            const unitsLost = Math.max(1, Math.ceil(nonMercCount * 0.1));
            for (let i = 0; i < unitsLost; i++) {
                let removed = false;
                for (let index = player.army.length - 1; index >= 0; index--) {
                    if (!player.army[index].mercenary) {
                        player.army.splice(index, 1);
                        removed = true;
                        break;
                    }
                }
                if (!removed && player.army.length > 0) {
                    player.army.pop();
                }
            }
            result.paid = false;
            result.unitsLost = unitsLost;
        } else {
            player.gold -= cost;
            result.cost = cost;
        }

        const mercenaryUpdate = PlayerMilitary._processMercenaryCompanies(player, world);
        result.mercenaryWages = mercenaryUpdate.wagesPaid;
        result.mercenaryEvents = mercenaryUpdate.events;

        return result;
    },
});
