// ============================================
// PLAYER RELIGION — Religious path systems
// ============================================

import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Quests } from '../systems/quests.js';
import { Achievements } from '../systems/achievements.js';
import { Titles } from '../systems/titles.js';

export const PlayerReligion = {
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

        if (building.id === 'temple') Quests.trackTempleBuilt(player);

        return { success: true, building: tile.religiousBuilding, underConstruction: constructionDays > 0, constructionDays };
    },

    /**
     * Spread faith from religious buildings
     */
    spreadFaith(player, world) {
        if (!player.religion || player.religion.buildings.length === 0) return 0;

        let totalFollowersGained = 0;
        // A Court Chaplain's sermons carry further
        const title = Titles.getActiveTitle(player);
        const spreadBonus = (title && title.perks && title.perks.faithSpreadBonus) || 0;

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
                const conversionRate = 0.01 * (1 + player.faith * 0.1) * (1 + spreadBonus);
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
        HARVEST: {
            id: 'harvest',
            name: 'Bountiful Harvest',
            icon: '🌾',
            karmaCost: 12,
            effect: 'All farms produce triple for 3 days',
            description: 'Invoke divine fertility upon the land'
        },
        SMITE: {
            id: 'smite',
            name: 'Divine Smite',
            icon: '⚡',
            karmaCost: 30,
            effect: 'Deal massive damage to an enemy unit',
            description: 'Call down divine wrath upon your enemies'
        },
        REVELATION: {
            id: 'revelation',
            name: 'Revelation',
            icon: '👁️',
            karmaCost: 18,
            effect: 'Reveal all tiles in a large radius',
            description: 'The divine grants sight beyond mortal ken'
        },
        SANCTUARY: {
            id: 'sanctuary',
            name: 'Holy Sanctuary',
            icon: '🕊️',
            karmaCost: 22,
            effect: 'Create a safe zone where no combat can occur for 5 days',
            description: 'Consecrate the ground so no blood may be shed upon it'
        },
        RESURRECTION: {
            id: 'resurrection',
            name: 'Resurrection',
            icon: '💫',
            karmaCost: 40,
            effect: 'Restore a destroyed unit to full strength',
            description: 'Call the fallen back from beyond the veil'
        },
        PLAGUE: {
            id: 'plague',
            name: 'Divine Plague',
            icon: '☠️',
            karmaCost: 35,
            effect: 'Enemy settlement loses 30% population',
            description: 'Unleash a terrible pestilence upon the unfaithful'
        },
    },

    /** Tuning for the targeted / area miracles */
    MIRACLE_CONFIG: {
        harvestDays: 3,
        smiteRange: 3,
        smiteDamage: { min: 35, max: 50 },  // strength removed outright
        smiteSurvivorShare: 0.4,            // a foe too strong to destroy keeps at most 40%
        revelationRadius: 10,
        sanctuaryRadius: 3,
        sanctuaryDays: 5,
        maxFallenUnits: 10,
        plagueLoss: 0.3,
        plagueReputationLoss: 25,
        plagueKarmaLoss: 10,
    },

    /** Unit types Divine Smite may strike (mirrors WorldUnit.HOSTILE_TYPES) */
    SMITE_TARGET_TYPES: ['raider', 'pirate', 'beast', 'monster', 'war_host'],

    /**
     * Perform a miracle. `world` is needed by the targeted / area miracles
     * (Smite, Revelation, Sanctuary, Plague); targets are validated before
     * any karma is spent, so a failed miracle costs nothing.
     */
    performMiracle(player, miracleType, world = null) {
        if (!player.religion) {
            return { success: false, reason: 'Must found a religion first' };
        }

        const miracle = PlayerReligion.MIRACLES[miracleType.toUpperCase()];
        if (!miracle) return { success: false, reason: 'Invalid miracle' };

        if (player.karma < miracle.karmaCost) {
            return { success: false, reason: `Need ${miracle.karmaCost} karma (have ${player.karma})` };
        }

        const cfg = PlayerReligion.MIRACLE_CONFIG;

        // Find and validate the target before spending karma
        const check = PlayerReligion.checkMiracleTarget(player, miracle.id, world);
        if (!check.ok) return { success: false, reason: check.reason };
        const target = check.target;

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

            case 'harvest':
                // Read by PlayerEffects.farmProductionMultiplier
                player.blessings = player.blessings || {};
                player.blessings.harvest = cfg.harvestDays;
                result.effect = `Your farms yield triple for ${cfg.harvestDays} days!`;
                break;

            case 'smite': {
                const damage = Utils.randInt(cfg.smiteDamage.min, cfg.smiteDamage.max);
                result.target = target;
                if (target.strength <= damage) {
                    target.destroyed = true;
                    result.destroyed = true;
                    result.effect = `Divine wrath obliterates the ${target.name}!`;
                } else {
                    // Very strong foes survive, but broken
                    const before = target.strength;
                    target.strength = Math.max(1, Math.floor(Math.min(before - damage, before * cfg.smiteSurvivorShare)));
                    if (target.population) {
                        target.population = Math.max(1, Math.floor(target.population * cfg.smiteSurvivorShare));
                    }
                    result.destroyed = false;
                    result.effect = `Lightning sears the ${target.name}! Strength ${before} → ${target.strength}.`;
                }
                if (world.events) {
                    world.events.push({ text: `Divine wrath struck the ${target.name}.`, type: 'military' });
                }
                break;
            }

            case 'revelation': {
                let revealed = 0;
                for (const hex of Hex.hexesInRange(player.q, player.r, cfg.revelationRadius)) {
                    const tile = world.getTile(hex.q, hex.r);
                    if (!tile) continue;
                    if (!tile.explored) revealed++;
                    tile.explored = true;
                    tile.visible = true;
                }
                result.revealed = revealed;
                result.effect = `The veil lifts: ${revealed} new tiles revealed within ${cfg.revelationRadius} hexes!`;
                break;
            }

            case 'sanctuary':
                // Counted down by updateBlessings; honoured by hostile units
                // (WorldUnit.updateRaider) and the encounter check (Game._checkHostileEncounters)
                player.sanctuary = { q: player.q, r: player.r, radius: cfg.sanctuaryRadius, days: cfg.sanctuaryDays };
                result.effect = `Holy ground: no foe may attack you within ${cfg.sanctuaryRadius} hexes of here for ${cfg.sanctuaryDays} days!`;
                break;

            case 'resurrection': {
                // Most recent casualty returns whole
                const unit = player.fallenUnits.pop();
                if (unit.maxStrength) unit.strength = unit.maxStrength;
                if (unit.maxHealth) unit.health = unit.maxHealth;
                if (!player.army) player.army = [];
                player.army.push(unit);
                result.unit = unit;
                result.effect = `${unit.icon || '⚔️'} ${unit.name || 'A fallen unit'} rises again to rejoin your army!`;
                break;
            }

            case 'plague': {
                const { settlement } = target;
                const lost = Math.floor(settlement.population * cfg.plagueLoss);
                settlement.population -= lost;
                // Pestilence is a dark act: the realm remembers, and so do the heavens
                if (settlement.kingdom) {
                    player.reputation = player.reputation || {};
                    player.reputation[settlement.kingdom] = (player.reputation[settlement.kingdom] || 0) - cfg.plagueReputationLoss;
                }
                player.karma = Math.max(0, player.karma - cfg.plagueKarmaLoss);
                if (world.events) {
                    world.events.push({ text: `A terrible plague swept through ${settlement.name}, claiming ${lost} lives.`, type: 'disaster' });
                }
                result.settlement = settlement;
                result.populationLost = lost;
                result.effect = `Pestilence ravages ${settlement.name}: ${lost} perish. ` +
                    (settlement.kingdom ? `(-${cfg.plagueReputationLoss} reputation with its realm, ` : '(') +
                    `-${cfg.plagueKarmaLoss} karma)`;
                break;
            }
        }

        // Increase faith
        player.faith = Math.min(10, player.faith + 0.3);

        Quests.track(player, 'miracles_performed');
        Achievements.trackMiracle(player);

        return result;
    },

    /**
     * Does this miracle have what it needs (a target, a fallen unit, a world)?
     * Side-effect free, so the UI can also use it to label / pre-check.
     * @returns {{ok:boolean, reason?:string, target?:object}}
     */
    checkMiracleTarget(player, miracleId, world) {
        const cfg = PlayerReligion.MIRACLE_CONFIG;
        switch (miracleId) {
            case 'smite': {
                const target = world ? PlayerReligion.findSmiteTarget(player, world) : null;
                if (!target) return { ok: false, reason: `No enemy unit within ${cfg.smiteRange} hexes to smite` };
                return { ok: true, target };
            }
            case 'revelation':
            case 'sanctuary':
                if (!world) return { ok: false, reason: 'The miracle has no land to touch' };
                return { ok: true };
            case 'resurrection':
                if (!player.fallenUnits || player.fallenUnits.length === 0) {
                    return { ok: false, reason: 'None of your soldiers have fallen in battle' };
                }
                return { ok: true, target: player.fallenUnits[player.fallenUnits.length - 1] };
            case 'plague': {
                const target = world ? PlayerReligion.findPlagueTarget(player, world) : null;
                if (!target) return { ok: false, reason: 'No enemy settlement on or next to your tile' };
                return { ok: true, target };
            }
            default:
                return { ok: true };
        }
    },

    /**
     * Nearest hostile world unit within smite range of the player (ties go to
     * the stronger unit), or null.
     */
    findSmiteTarget(player, world) {
        const range = PlayerReligion.MIRACLE_CONFIG.smiteRange;
        let best = null;
        let bestDist = Infinity;
        for (const unit of world.units || []) {
            if (unit.destroyed || !PlayerReligion.SMITE_TARGET_TYPES.includes(unit.type)) continue;
            const dist = Hex.wrappingDistance(unit.q, unit.r, player.q, player.r, world.width);
            if (dist > range) continue;
            if (dist < bestDist || (dist === bestDist && unit.strength > best.strength)) {
                best = unit;
                bestDist = dist;
            }
        }
        return best;
    },

    /**
     * A populated settlement on or adjacent to the player's tile that is not
     * of the player's own realm nor one of the player's colonies, or null.
     * @returns {{settlement:object, tile:object}|null}
     */
    findPlagueTarget(player, world) {
        const hexes = [{ q: player.q, r: player.r }, ...Hex.neighbors(player.q, player.r)];
        for (const hex of hexes) {
            const tile = world.getTile(hex.q, hex.r);
            const settlement = tile && tile.settlement;
            if (!settlement || !(settlement.population > 0)) continue;
            if (player.allegiance && settlement.kingdom === player.allegiance) continue;
            if ((player.colonies || []).some(c => c.q === tile.q && c.r === tile.r)) continue;
            return { settlement, tile };
        }
        return null;
    },

    /**
     * Is hex (q, r) inside the player's active Holy Sanctuary?
     */
    isInSanctuary(player, q, r, mapWidth) {
        const s = player && player.sanctuary;
        if (!s || !(s.days > 0)) return false;
        return Hex.wrappingDistance(s.q, s.r, q, r, mapWidth) <= s.radius;
    },

    /**
     * Remember a unit lost in battle so Resurrection can bring it back
     * (newest last, oldest dropped past the cap).
     */
    recordFallenUnit(player, unit) {
        if (!unit) return;
        if (!player.fallenUnits) player.fallenUnits = [];
        player.fallenUnits.push(unit);
        const max = PlayerReligion.MIRACLE_CONFIG.maxFallenUnits;
        if (player.fallenUnits.length > max) player.fallenUnits.splice(0, player.fallenUnits.length - max);
    },

    /**
     * Update blessings (called daily). Also counts down the Holy Sanctuary,
     * reported as an expired 'sanctuary' blessing when it lapses.
     */
    updateBlessings(player) {
        const expired = [];

        if (player.sanctuary) {
            player.sanctuary.days--;
            if (player.sanctuary.days <= 0) {
                player.sanctuary = null;
                expired.push('sanctuary');
            }
        }

        if (!player.blessings) return expired;

        for (const [blessing] of Object.entries(player.blessings)) {
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
