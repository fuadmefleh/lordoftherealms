// ============================================
// PLAYER RELIGION — Religious path systems
// ============================================

import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Quests } from '../systems/quests.js';
import { Achievements } from '../systems/achievements.js';
import { Titles } from '../systems/titles.js';
import { Religion } from '../systems/religion.js';
import { Traits } from '../systems/traits.js';

export const PlayerReligion = {
    // ──────────── TENETS & INFLUENCE ────────────
    // Tenet effect tables and influence tuning live in Religion
    // (data/religion.json → playerTenets / playerInfluence).

    /** The tenets a founder can choose from: [{ id, icon, desc, summary }]. */
    getTenetOptions() {
        return Object.entries(Religion.PLAYER_TENETS || {}).map(([id, t]) => ({
            id, icon: t.icon || '', desc: t.desc || '', summary: t.summary || '',
        }));
    },

    /** Sum of one tenet effect key over the player's religion (0 without one). */
    tenetBonus(player, key) {
        return Religion.tenetBonus(player && player.religion, key);
    },

    /**
     * Influence as a 0..1 factor with diminishing returns:
     * influence / (influence + scale) — 100 influence is half the maximum.
     */
    influenceFactor(player) {
        const inf = (player && player.religion && player.religion.influence) || 0;
        if (inf <= 0) return 0;
        const scale = Religion.PLAYER_INFLUENCE.scale || 100;
        return inf / (inf + scale);
    },

    /** Multiplier on converting people (buildings, preaching): tenets × influence. */
    conversionMultiplier(player) {
        return Math.max(0, 1 + PlayerReligion.tenetBonus(player, 'conversion'))
            * (1 + Religion.PLAYER_INFLUENCE.conversionBonus * PlayerReligion.influenceFactor(player));
    },

    /** Settlements devoted to the player's faith (share ≥ devotedShare). [{ q, r, share }] */
    getDevotedSettlements(player) {
        const presence = player && player.religion && player.religion.presence;
        if (!presence) return [];
        const min = Religion.PLAYER_INFLUENCE.devotedShare;
        const out = [];
        for (const [key, share] of Object.entries(presence)) {
            if (share < min) continue;
            const [q, r] = key.split(',').map(Number);
            out.push({ q, r, share });
        }
        return out;
    },

    /** What the faith's influence currently does, for the religion panel. */
    influenceSummary(player) {
        const cfg = Religion.PLAYER_INFLUENCE;
        const f = PlayerReligion.influenceFactor(player);
        const presence = (player && player.religion && player.religion.presence) || {};
        return {
            factor: f,
            conversionBonus: cfg.conversionBonus * f,
            incomeBonus: cfg.incomeBonus * f,
            reached: Object.keys(presence).length,
            devoted: PlayerReligion.getDevotedSettlements(player).length,
        };
    },

    /**
     * Daily upkeep of the player's faith (call once a day, after spreadFaith):
     *  - tenet karma (Charity, Humility);
     *  - influence recomputed from followers (miracles and missions add them too);
     *  - organic spread: devoted settlements win over their neighbours, faster
     *    with more influence;
     *  - realms holding devoted towns warm to the player (Peace/Sovereignty
     *    speed it), except zealous faiths (militancy ≥ 3), who resent it;
     *  - with Justice, devoted towns steady their realm (kingdom.playerFaith,
     *    read by KingdomStability.target).
     * Returns { karma, spread, reputation: {kingdomId: delta} }.
     */
    processDaily(player, world) {
        const out = { karma: 0, spread: 0, reputation: {} };
        const religion = player && player.religion;
        if (!religion || !world) return out;
        const cfg = Religion.PLAYER_INFLUENCE;

        const karma = PlayerReligion.tenetBonus(player, 'karmaPerDay');
        if (karma > 0) {
            religion.karmaCarry = (religion.karmaCarry || 0) + karma;
            const whole = Math.floor(religion.karmaCarry + 1e-9);
            if (whole > 0) {
                player.karma = (player.karma || 0) + whole;
                religion.karmaCarry -= whole;
                out.karma = whole;
            }
        }

        religion.influence = Math.floor((religion.followers || 0) / 100);
        const factor = PlayerReligion.influenceFactor(player);

        // Organic spread from devoted towns to their neighbours
        const devoted = PlayerReligion.getDevotedSettlements(player);
        if (devoted.length && typeof world.getTile === 'function') {
            const amount = cfg.organicSpread * (1 + factor);
            for (const d of devoted) {
                for (const h of Hex.hexesInRange(d.q, d.r, cfg.organicRadius)) {
                    const t = world.getTile(h.q, h.r);
                    if (!t || !t.settlement || !(t.settlement.population > 0)) continue;
                    if (t.q === d.q && t.r === d.r) continue;
                    out.spread += Religion.addPresence(religion, t.q, t.r, amount);
                }
            }
        }

        // Realms that hold devoted towns
        const perKingdom = {};
        for (const d of PlayerReligion.getDevotedSettlements(player)) {
            const t = typeof world.getTile === 'function' ? world.getTile(d.q, d.r) : null;
            const kid = t && t.settlement && t.settlement.kingdom;
            if (kid) perKingdom[kid] = (perKingdom[kid] || 0) + 1;
        }
        const stabilityPer = PlayerReligion.tenetBonus(player, 'kingdomStability');
        const warmth = 1 + PlayerReligion.tenetBonus(player, 'kingdomRelations');
        for (const kingdom of world.kingdoms || []) {
            const n = perKingdom[kingdom.id] || 0;
            if (!n) {
                if (kingdom.playerFaith) delete kingdom.playerFaith;
                continue;
            }
            kingdom.playerFaith = {
                devoted: n,
                stability: Math.min(cfg.maxKingdomStability, n * stabilityPer),
            };
            if (!kingdom.isAlive) continue;
            const faith = Religion.getKingdomFaith(kingdom);
            const zealous = faith && faith.virtues && faith.virtues.militancy >= cfg.militantMilitancy;
            const delta = zealous
                ? -n * cfg.militantPenaltyPerDevoted
                : Math.min(cfg.maxReputationPerDay, n * cfg.reputationPerDevoted * warmth);
            if (!religion.reputationCarry) religion.reputationCarry = {};
            const carry = (religion.reputationCarry[kingdom.id] || 0) + delta;
            const whole = carry > 0 ? Math.floor(carry + 1e-9) : Math.ceil(carry - 1e-9);
            religion.reputationCarry[kingdom.id] = carry - whole;
            if (!whole) continue;
            if (!player.reputation) player.reputation = {};
            const before = player.reputation[kingdom.id] || 0;
            const after = whole > 0
                ? Math.max(before, Math.min(cfg.reputationCeiling, before + whole))
                : Math.min(before, Math.max(cfg.militantFloor, before + whole));
            if (after !== before) {
                player.reputation[kingdom.id] = after;
                out.reputation[kingdom.id] = after - before;
            }
        }
        return out;
    },

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
            presence: {},        // "q,r" → share of that settlement following the faith
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
            scholarshipBonus: building.scholarshipBonus || 0,
            incomeBonus: building.incomeBonus || 0,
            renownPerDay: building.renownPerDay || 0,
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
     * Look up a religious building definition by its id (e.g. 'oracle_tower').
     */
    getBuildingDef(typeId) {
        if (!typeId) return null;
        return Object.values(PlayerReligion.BUILDING_TYPES || {}).find(b => b.id === typeId) || null;
    },

    /**
     * Backfill stats onto a placed building from its definition. Older saves
     * only stored faithGain/influenceRadius/karmaBonus, dropping the special
     * yields (scholarship, pilgrim income, relic renown).
     */
    ensureBuildingStats(building) {
        if (!building || building._statsBackfilled) return building;
        const def = PlayerReligion.getBuildingDef(building.type);
        if (def) {
            for (const key of ['faithGain', 'influenceRadius', 'karmaBonus', 'scholarshipBonus', 'incomeBonus', 'renownPerDay']) {
                if (building[key] === undefined) building[key] = def[key] || 0;
            }
            building._statsBackfilled = true;
        }
        return building;
    },

    /**
     * Conversion multiplier from a building's faithGain. Buildings without a
     * faithGain (legacy fixtures) convert at the base rate.
     */
    faithMultiplier(building) {
        if (!building || !building.faithGain) return 1;
        return 0.5 + building.faithGain / 20; // shrine 0.75x, temple 1.25x, cathedral 2x
    },

    /**
     * Spread faith from religious buildings.
     * Each building draws `faithGain` pilgrims a day directly (the advertised
     * "+X/day") and converts settlement population in its influence radius,
     * scaled by faithGain.
     */
    spreadFaith(player, world) {
        if (!player.religion || player.religion.buildings.length === 0) return 0;

        let totalFollowersGained = 0;
        // A Court Chaplain's sermons carry further
        const title = Titles.getActiveTitle(player);
        const spreadBonus = (title && title.perks && title.perks.faithSpreadBonus) || 0;
        // Tenets (Charity) and the faith's influence speed conversion
        const faithMult = PlayerReligion.conversionMultiplier(player);
        const presenceGain = Religion.PLAYER_INFLUENCE.settlementGain * faithMult;

        for (const buildingRef of player.religion.buildings) {
            const tile = world.getTile(buildingRef.q, buildingRef.r);
            if (!tile || !tile.religiousBuilding) continue;

            const building = PlayerReligion.ensureBuildingStats(tile.religiousBuilding);
            if (building.underConstruction) continue; // Still being built
            const hexes = Hex.hexesInRange(buildingRef.q, buildingRef.r, building.influenceRadius || 0);
            const mult = PlayerReligion.faithMultiplier(building);

            // Pilgrims drawn to the building itself
            let gained = Math.floor((building.faithGain || 0) * (1 + spreadBonus));

            for (const hex of hexes) {
                const nearbyTile = world.getTile(hex.q, hex.r);
                if (!nearbyTile || !nearbyTile.settlement) continue;

                // Convert some population to followers
                const conversionRate = 0.01 * (1 + player.faith * 0.1) * (1 + spreadBonus) * mult * faithMult;
                gained += Math.floor(nearbyTile.settlement.population * conversionRate);
                // ...and the town's share of the faithful grows
                Religion.addPresence(player.religion, nearbyTile.q != null ? nearbyTile.q : hex.q,
                    nearbyTile.r != null ? nearbyTile.r : hex.r, presenceGain * mult);
            }

            building.followers += gained;
            totalFollowersGained += gained;

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
     * Daily special yields of finished religious buildings:
     *  - incomeBonus (Pilgrim Hospice): gold from pilgrims, growing with the building's followers
     *  - renownPerDay (Reliquary Vault): renown from relic veneration
     *  - scholarshipBonus (Oracle Tower): each point is 2% of a research day,
     *    banked as "oracle insight" (cap 5 days) and spent in whole days on the
     *    player's current research (completion is left to Technology.processResearch).
     */
    applyBuildingYields(player, world) {
        const out = { gold: 0, renown: 0, researchDays: 0 };
        if (!player.religion || !player.religion.buildings || !world) return out;

        let scholarship = 0;
        for (const ref of player.religion.buildings) {
            const tile = world.getTile(ref.q, ref.r);
            if (!tile || !tile.religiousBuilding) continue;
            const b = PlayerReligion.ensureBuildingStats(tile.religiousBuilding);
            if (b.underConstruction) continue;
            const level = b.level || 1;
            if (b.incomeBonus) {
                const pilgrimMult = 1 + Math.min(2, (b.followers || 0) / 500);
                out.gold += Math.floor(b.incomeBonus * 0.1 * level * pilgrimMult);
            }
            if (b.renownPerDay) out.renown += b.renownPerDay * level;
            if (b.scholarshipBonus) scholarship += b.scholarshipBonus * level;
        }

        if (out.gold) player.gold = (player.gold || 0) + out.gold;
        if (out.renown) player.renown = (player.renown || 0) + out.renown;

        if (scholarship > 0) {
            player.religion.oracleInsight = Math.min(5, (player.religion.oracleInsight || 0) + scholarship * 0.02);
            const research = player.technology && player.technology.currentResearch;
            if (research && player.religion.oracleInsight + 1e-9 >= 1) {
                const days = Math.floor(player.religion.oracleInsight + 1e-9);
                // Leave the final day to processResearch so completion is handled in one place
                const room = Math.max(0, (research.totalDays || 0) - 1 - (research.progress || 0));
                const applied = Math.min(days, room);
                if (applied > 0) {
                    research.progress = (research.progress || 0) + applied;
                    player.religion.oracleInsight = Math.max(0, player.religion.oracleInsight - applied);
                    out.researchDays = applied;
                }
            }
        }
        return out;
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

    /** Karma a miracle costs this player (Mysticism makes miracles cheaper). */
    miracleCost(player, miracle) {
        const base = (miracle && miracle.karmaCost) || 0;
        const mult = Math.max(0.5, 1 + PlayerReligion.tenetBonus(player, 'miracleCost'));
        return Math.max(1, Math.round(base * mult));
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

        const karmaCost = PlayerReligion.miracleCost(player, miracle);
        if (player.karma < karmaCost) {
            return { success: false, reason: `Need ${karmaCost} karma (have ${player.karma})` };
        }

        const cfg = PlayerReligion.MIRACLE_CONFIG;

        // Find and validate the target before spending karma
        const check = PlayerReligion.checkMiracleTarget(player, miracle.id, world);
        if (!check.ok) return { success: false, reason: check.reason };
        const target = check.target;

        player.karma -= karmaCost;

        // Apply miracle effect
        let result = { success: true, miracle, karmaCost };

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
        const effectiveness = (1 + player.charisma * 0.1 + player.faith * 0.1) * PlayerReligion.conversionMultiplier(player);
        const followersGained = Math.floor(settlement.population * 0.05 * effectiveness);

        player.religion.followers += followersGained;
        // A sermon wins over a share of the town itself
        if (tile && tile.q != null) {
            Religion.addPresence(player.religion, tile.q, tile.r, Religion.PLAYER_INFLUENCE.settlementGain * 5 * effectiveness);
        }
        player.religion.influence = Math.floor(player.religion.followers / 100);

        // Gain karma
        const karmaGained = Math.floor(followersGained / 50);
        player.karma += karmaGained;
        Traits.recordDeeds(player, { zeal: 2, piety: 1 });

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

    /** Tuning for denouncing heresy (preaching against a kingdom's heretics). */
    DENOUNCE_HERESY: { basePower: 6, perFaith: 1.5, perCharisma: 0.5, randomPower: 4, karma: 5, reputation: 5, renown: 5 },

    /**
     * The heresy the player could denounce in this settlement's kingdom, or null.
     * @returns {{ kingdom: Object, heresy: Object }|null}
     */
    heresyAt(settlement, world) {
        if (!settlement || !settlement.kingdom || !world || !world.getKingdom) return null;
        const kingdom = world.getKingdom(settlement.kingdom);
        if (!kingdom || kingdom.isAlive === false || !kingdom.religion) return null;
        const heresy = Religion.strongestHeresy(kingdom);
        return heresy ? { kingdom, heresy } : null;
    },

    /**
     * Preach against the strongest heresy troubling a settlement's kingdom.
     * Faith and charisma drive how much ground the heretics lose; driving a
     * heresy out suppresses it (Religion.suppressHeresy) and the crown and
     * clergy reward the player.
     */
    denounceHeresy(player, settlement, world) {
        const target = PlayerReligion.heresyAt(settlement, world);
        if (!target) return { success: false, reason: 'No heresy troubles this realm.' };
        const D = PlayerReligion.DENOUNCE_HERESY;
        const power = D.basePower + (player.faith || 0) * D.perFaith + (player.charisma || 0) * D.perCharisma
            + Utils.randInt(0, D.randomPower);
        const res = Religion.suppressHeresy(player, target.kingdom, world, power);
        player.faith = Math.min(10, (player.faith || 0) + 0.1);
        if (!res.suppressed) {
            return {
                success: true, suppressed: false, heresy: res.heresy, kingdom: target.kingdom,
                message: `Your sermon against the ${res.heresy.name} wins converts back to the faith. Its strength falls to ${res.remaining}.`,
            };
        }
        player.karma = (player.karma || 0) + D.karma;
        player.renown = (player.renown || 0) + D.renown;
        if (!player.reputation) player.reputation = {};
        player.reputation[target.kingdom.id] = (player.reputation[target.kingdom.id] || 0) + D.reputation;
        return {
            success: true, suppressed: true, heresy: res.heresy, kingdom: target.kingdom,
            message: `The ${res.heresy.name} is broken! ${target.kingdom.name} is grateful: +${D.reputation} reputation, +${D.karma} karma, +${D.renown} renown.`,
        };
    },

    /**
     * Get faith income from followers
     */
    getFaithIncome(player) {
        if (!player.religion) return 0;

        // Followers donate to the faith — more when the faith is influential;
        // Prosperity raises the tithe, Charity gives part of it away
        const mult = Math.max(0, 1 + PlayerReligion.tenetBonus(player, 'faithIncome'))
            * (1 + Religion.PLAYER_INFLUENCE.incomeBonus * PlayerReligion.influenceFactor(player));
        const income = Math.floor(player.religion.followers * 0.01 * mult);
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
