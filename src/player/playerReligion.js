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
import { Ailments } from '../systems/ailments.js';
import { Ledger } from '../systems/ledger.js';
import { House } from '../systems/house.js';
import { DataLoader } from '../core/dataLoader.js';
import { TownLabour } from '../world/townLabour.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Economy } from '../world/economy.js';
import { Names } from '../core/names.js';

/** Fallback preaching tuning (data/religion.json → preaching overrides). */
const PREACH_DEFAULTS = {
    cooldownDays: 1, baseShare: 0.05, saturationPerSermon: 0.35, recoveryPerDay: 0.06, minEffect: 0.1,
    weakFaith: { pietyRef: 50, maxBonus: 0.5, noChurchBonus: 0.5 },
    alms: { perFollower: 0.02, perCharisma: 0.05 },
    hostility: {
        base: 0.04, perMilitancy: 0.07, perPiety: 0.003, perClergy: 1.5, perSaturation: 0.15, min: 0, max: 0.85,
        fineBase: 20, finePerPop: 0.01, fineMax: 400, reputationLoss: 3, banAfter: 3, banChancePerStrike: 0.25, banDays: 30, strikeDecayDays: 60,
    },
};

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
        // A Grand Cathedral (systems/patronage.js → player.patronage.fx) preaches too
        const fx = player && player.patronage && player.patronage.fx;
        const cathedral = fx && Number.isFinite(fx.conversion) ? fx.conversion : 0;
        return Math.max(0, 1 + PlayerReligion.tenetBonus(player, 'conversion'))
            * (1 + Religion.PLAYER_INFLUENCE.conversionBonus * PlayerReligion.influenceFactor(player))
            * (1 + cathedral);
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
            // (zealots resent a rival faith's devoted, never their own High Priest's)
            const zealous = faith && faith.virtues && faith.virtues.militancy >= cfg.militantMilitancy
                && faith.id !== religion.worldFaithId;
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
        // A High Priest's see (player/scenarios.js): the faithful realms tithe
        if (religion.worldFaithId) out.tithe = PlayerReligion.collectTithes(player, world);
        return out;
    },

    /**
     * The tithe to a High Priest's see: each living realm keeping the faith
     * the player heads pays a share (religion.titheShare) of its pilgrims'
     * gold that day (kingdom.religion.pilgrimIncome, Religion.processTurn)
     * and a small share (titheRevenueShare) of the crown's daily revenue
     * (world/crownBooks.js), out of its own treasury, never more than it holds. Real gold moving
     * from crowns to the see. Returns { gold, realms }.
     */
    collectTithes(player, world) {
        const out = { gold: 0, realms: 0 };
        const religion = player && player.religion;
        const fid = religion && religion.worldFaithId;
        if (!fid || !world || !Array.isArray(world.kingdoms)) return out;
        const share = Math.max(0, Math.min(1, Number(religion.titheShare) || 0));
        const revShare = Math.max(0, Math.min(0.2, Number(religion.titheRevenueShare) || 0));
        if (share <= 0 && revShare <= 0) return out;
        for (const k of world.kingdoms) {
            if (!k || !k.isAlive || !k.religion || k.religion.faithId !== fid) continue;
            // (the pilgrims' gold, and the tithe of the crown's own daily revenue)
            const due = Math.floor((Number(k.religion.pilgrimIncome) || 0) * share
                + (CrownBooks.enabled() ? CrownBooks.lastRevenue(k) : 0) * revShare);
            const paid = Math.max(0, Math.min(due, Math.floor(Number(k.treasury) || 0)));
            if (paid <= 0) continue;
            k.treasury -= paid;
            out.gold += paid;
            out.realms++;
        }
        if (out.gold > 0) {
            player.gold = (player.gold || 0) + out.gold;
            Ledger.record(player, 'faith', out.gold);
            religion.titheTotal = (religion.titheTotal || 0) + out.gold;
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
            icon: '🏛️',
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
    foundReligion(player, religionName, tenets, world = null) {
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

        // A faith founded is a deed for the House's name (systems/house.js)
        const prestige = House.recordPlayerDeed(player, world, 'religionFounded', {
            reason: `founded ${religionName}`,
            chronicle: `The House founded a faith: ${religionName}.`, tags: ['faith', 'religionFounded'],
        });

        return { success: true, religion: player.religion, prestige };
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
            return { success: false, reason: `Need ${building.cost} gold (have ${Math.floor(player.gold)})` };
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
        // A temple or monastery raised to the House's faith (a shrine is too small a thing)
        const prestige = building.id === 'temple' || building.id === 'monastery'
            ? House.recordPlayerDeed(player, world, 'templeRaised', { reason: `raised a ${building.name.toLowerCase()}` })
            : 0;

        return { success: true, building: tile.religiousBuilding, underConstruction: constructionDays > 0, constructionDays, prestige };
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
                // The pilgrims pay out of their own towns' purses, near the hospice
                const pilgrimMult = 1 + Math.min(2, (b.followers || 0) / 500);
                const due = Math.floor(b.incomeBonus * 0.1 * level * pilgrimMult);
                const towns = [];
                for (const h of Hex.hexesInRange(ref.q, ref.r, b.influenceRadius || 0)) {
                    const t = world.getTile(h.q, h.r);
                    const s = t && t.settlement;
                    if (s && s.population > 0 && !towns.some(e => e.settlement === s)) towns.push({ settlement: s, weight: s.population });
                }
                out.gold += Economy.drawTowns(towns, due, PlayerReligion.offeringsConfig().hospiceMaxPurseShare, { init: true }).paid;
            }
            if (b.renownPerDay) out.renown += b.renownPerDay * level;
            if (b.scholarshipBonus) scholarship += b.scholarshipBonus * level;
        }

        out.gold = Math.round(out.gold * 100) / 100;
        if (out.gold) player.gold = Math.round(((player.gold || 0) + out.gold) * 100) / 100;
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
            case 'healing': {
                player.health = player.maxHealth;
                // Every wound closes, every fever breaks (systems/ailments.js)
                const cured = Ailments.cureAll(player);
                result.effect = cured > 0
                    ? `Health fully restored, and ${cured} wound${cured > 1 ? 's and sicknesses' : ' or sickness'} lifted!`
                    : 'Health fully restored!';
                break;
            }

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
        // Word of a miracle lifts the House's name — a plague called down, not at all
        result.prestige = House.recordPlayerDeed(player, world, 'miracle', {
            scale: House.deedScale('miracle', miracle.id), reason: `miracle: ${miracle.name}`,
        });

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

    /** Preaching tuning (data/religion.json → preaching) over the defaults. */
    preachConfig() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.religion && gd.religion.preaching) || {};
        return {
            ...PREACH_DEFAULTS, ...d,
            weakFaith: { ...PREACH_DEFAULTS.weakFaith, ...(d.weakFaith || {}) },
            alms: { ...PREACH_DEFAULTS.alms, ...(d.alms || {}) },
            hostility: { ...PREACH_DEFAULTS.hostility, ...(d.hostility || {}) },
        };
    },

    /** How tired a town is of your sermons today (0..1), after its days of rest. */
    sermonSaturation(player, q, r, day) {
        const rec = player && player.religion && player.religion.sermons && player.religion.sermons[`${q},${r}`];
        if (!rec) return 0;
        const C = PlayerReligion.preachConfig();
        const rest = Number.isFinite(day) && Number.isFinite(rec.day) ? Math.max(0, day - rec.day) : 0;
        return Math.max(0, Math.min(1, (rec.sat || 0) - rest * C.recoveryPerDay));
    },

    /** The state church where a town stands: { kingdom, faith, piety, militancy } or null (no realm, no church, or a realm the player made). */
    stateChurchAt(settlement, world) {
        if (!settlement || !settlement.kingdom || !world || typeof world.getKingdom !== 'function') return null;
        const kingdom = world.getKingdom(settlement.kingdom);
        if (!kingdom || kingdom.isAlive === false || kingdom.createdByPlayer) return null;
        const faith = kingdom.religion ? Religion.getKingdomFaith(kingdom) : null;
        if (!faith) return null;
        const piety = Number.isFinite(kingdom.religion.piety) ? kingdom.religion.piety : 50;
        return { kingdom, faith, piety, militancy: (faith.virtues && faith.virtues.militancy) || 1 };
    },

    /** Is the player banned from preaching in this realm? Returns the day the ban lifts, or 0. */
    preachBan(player, kingdomId, day) {
        const bans = player && player.religion && player.religion.preachBans;
        const until = bans && kingdomId ? bans[kingdomId] : 0;
        return until && (!Number.isFinite(day) || day < until) ? until : 0;
    },

    /**
     * What a sermon here would do (no rolls): { effectiveness, saturation,
     * weakBonus, hostility (chance), church, cooldown, banned }.
     */
    sermonOutlook(player, settlement, tile, world = null) {
        const C = PlayerReligion.preachConfig();
        const day = world && Number.isFinite(world.day) ? world.day : null;
        const q = tile && tile.q != null ? tile.q : null;
        const r = tile && tile.r != null ? tile.r : null;
        const religion = player.religion;
        const saturation = q != null && day != null ? PlayerReligion.sermonSaturation(player, q, r, day) : 0;
        const church = PlayerReligion.stateChurchAt(settlement, world);
        const W = C.weakFaith;
        let weakBonus = 0;
        if (church) weakBonus = Math.max(0, (W.pietyRef - church.piety) / W.pietyRef) * W.maxBonus;
        else if (world && settlement && settlement.kingdom) weakBonus = W.noChurchBonus;
        const base = (1 + (player.charisma || 0) * 0.1 + (player.faith || 0) * 0.1) * PlayerReligion.conversionMultiplier(player);
        const effectiveness = base * Math.max(C.minEffect, 1 - saturation) * (1 + weakBonus);
        let hostility = 0;
        // The clergy of a realm keep their head's own faith: a High Priest preaches with their blessing
        if (church && !(religion && religion.worldFaithId && church.faith.id === religion.worldFaithId)) {
            const H = C.hostility;
            const pop = Math.max(1, settlement.population || 0);
            const clergyShare = (TownLabour.counts(settlement).clergy || 0) / pop;
            const presence = q != null ? Religion.getPresence(religion, q, r) : 0;
            hostility = (H.base + church.militancy * H.perMilitancy + church.piety * H.perPiety
                + clergyShare * H.perClergy + saturation * H.perSaturation) * (1 - presence);
            hostility = Math.max(H.min, Math.min(H.max, hostility));
        }
        const cooldown = day != null && Number.isFinite(religion && religion.lastPreachDay) && day - religion.lastPreachDay < C.cooldownDays;
        const banned = church ? PlayerReligion.preachBan(player, church.kingdom.id, day) : 0;
        return { effectiveness, saturation, weakBonus, hostility, church, cooldown, banned, day, q, r };
    },

    /**
     * Preach at a settlement: win followers, a share of the town, karma and
     * alms. One sermon a day; each town tires of the preacher (saturation
     * recovers over the following days); faith spreads best where the state
     * church is lax. A rival state clergy may answer: fines, lost standing
     * with the realm and, after repeated offences, a ban on preaching there.
     * `world` is optional (without it there's no cooldown, church or ban).
     */
    preach(player, settlement, tile, world = null) {
        if (!player.religion) {
            return { success: false, reason: 'Must found a religion first' };
        }
        const C = PlayerReligion.preachConfig();
        const religion = player.religion;
        const o = PlayerReligion.sermonOutlook(player, settlement, tile, world);
        if (o.cooldown) return { success: false, reason: 'Your voice is spent — you have already preached today.' };
        if (o.banned) return { success: false, reason: `The clergy of ${Names.realm(o.church.kingdom.name)} have banned your preaching until day ${o.banned}.` };

        const followersGained = Math.floor((settlement.population || 0) * C.baseShare * o.effectiveness);
        religion.followers = (religion.followers || 0) + followersGained;
        // A sermon wins over a share of the town itself
        if (o.q != null) {
            Religion.addPresence(religion, o.q, o.r, Religion.PLAYER_INFLUENCE.settlementGain * 5 * o.effectiveness);
            if (o.day != null) {
                if (!religion.sermons || typeof religion.sermons !== 'object') religion.sermons = {};
                religion.sermons[`${o.q},${o.r}`] = { sat: Math.round(Math.min(1, o.saturation + C.saturationPerSermon) * 1000) / 1000, day: o.day };
            }
        }
        if (o.day != null) religion.lastPreachDay = o.day;
        religion.influence = Math.floor(religion.followers / 100);

        // Gain karma
        const karmaGained = Math.floor(followersGained / 50);
        player.karma += karmaGained;
        Traits.recordDeeds(player, { zeal: 2, piety: 1 });

        // The faithful put coins in the bowl
        // (out of the town's own purse: a poor town has little to give)
        const asked = Math.floor(followersGained * C.alms.perFollower * (1 + (player.charisma || 0) * C.alms.perCharisma));
        if (settlement && !settlement.economy && settlement.population > 0) Economy.initSettlement(settlement);
        const purse = Economy.townPurse(settlement);
        const alms = Math.floor(Math.min(asked, purse == null ? asked : purse));
        if (alms > 0) Economy.drawTown(settlement, alms);
        if (alms > 0) {
            player.gold = (player.gold || 0) + alms;
            Ledger.record(player, 'faith', alms);
        }

        // Faith and charisma grow (less before a tired crowd)
        const learn = Math.max(C.minEffect, 1 - o.saturation);
        player.faith = Math.min(10, player.faith + 0.2 * learn);
        player.charisma = Math.min(10, player.charisma + 0.1 * learn);

        // The state church answers
        const clergy = o.church && o.hostility > 0 && Utils.random() < o.hostility
            ? PlayerReligion._clergyReaction(player, settlement, o, C.hostility) : null;

        return {
            success: true,
            followersGained,
            karmaGained,
            alms,
            saturation: o.saturation,
            weakBonus: o.weakBonus,
            clergy,
            totalFollowers: religion.followers,
        };
    },

    /** A rival clergy's answer to a sermon: a fine, lost standing, and in time a ban. */
    _clergyReaction(player, settlement, o, H) {
        const religion = player.religion;
        const kid = o.church.kingdom.id;
        if (!religion.preachStrikes || typeof religion.preachStrikes !== 'object') religion.preachStrikes = {};
        const prev = religion.preachStrikes[kid] || { n: 0, day: o.day };
        // Old offences are forgotten
        const stale = o.day != null && Number.isFinite(prev.day) && o.day - prev.day > H.strikeDecayDays;
        const strikes = (stale ? 0 : (prev.n || 0)) + 1;
        religion.preachStrikes[kid] = { n: strikes, day: o.day };
        const due = Math.min(H.fineMax, Math.round(H.fineBase + (settlement.population || 0) * H.finePerPop));
        const fine = Math.max(0, Math.min(Math.floor(player.gold || 0), due));
        if (fine > 0) {
            player.gold -= fine;
            Ledger.record(player, 'fines', -fine);
        }
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = (player.reputation[kid] || 0) - H.reputationLoss;
        let bannedUntil = 0;
        if (strikes >= H.banAfter || Utils.random() < H.banChancePerStrike * (strikes - 1)) {
            if (!religion.preachBans || typeof religion.preachBans !== 'object') religion.preachBans = {};
            bannedUntil = (o.day || 0) + H.banDays;
            religion.preachBans[kid] = bannedUntil;
            religion.preachStrikes[kid] = { n: 0, day: o.day };
        }
        const faithName = o.church.faith.name || 'state church';
        const realm = o.church.kingdom.name;
        return {
            kingdomId: kid, fine, reputationLoss: H.reputationLoss, strikes, bannedUntil,
            message: bannedUntil
                ? `The priests of the ${faithName} have you banned from preaching in ${realm} until day ${bannedUntil}${fine ? `, and fined ${fine} gold` : ''}.`
                : `The priests of the ${faithName} denounce you from the pulpit${fine ? ` and the magistrate fines you ${fine} gold` : ''}. (${realm} −${H.reputationLoss} reputation)`,
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

    /** data/religion.json offerings: how much of a town's coin its faithful give a day. */
    offeringsConfig() {
        return Religion.offeringsConfig();
    },

    /**
     * Where the faith's followers live: each town the faith has reached gives
     * by its faithful (presence share × people). With no presence recorded
     * (an old save), the towns around the faith's buildings. [{ settlement, weight }]
     */
    offeringTowns(player, world) {
        const religion = player && player.religion;
        if (!religion || !world || typeof world.getTile !== 'function') return [];
        const out = [];
        for (const [key, share] of Object.entries(religion.presence || {})) {
            if (!(share > 0)) continue;
            const [q, r] = key.split(',').map(Number);
            const t = world.getTile(q, r);
            const s = t && t.settlement;
            if (s && s.population > 0) out.push({ settlement: s, weight: share * s.population });
        }
        if (out.length) return out;
        const seen = new Set();
        for (const ref of religion.buildings || []) {
            const bt = world.getTile(ref.q, ref.r);
            const radius = (bt && bt.religiousBuilding && bt.religiousBuilding.influenceRadius) || 0;
            for (const h of Hex.hexesInRange(ref.q, ref.r, radius)) {
                const t = world.getTile(h.q, h.r);
                const s = t && t.settlement;
                if (!s || !(s.population > 0) || seen.has(s)) continue;
                seen.add(s);
                out.push({ settlement: s, weight: s.population });
            }
        }
        return out;
    },

    /**
     * Collect the day's offerings: what the followers owe (getFaithIncome) is
     * given out of the purses of the towns they live in, each town giving its
     * share by its faithful and at most offerings.maxPurseShare of its coin.
     * Real coin: the towns are poorer by exactly what the faith takes.
     * → the gold taken (whole coins and hundredths, like the towns' purses).
     */
    collectFaithIncome(player, world) {
        const owed = PlayerReligion.getFaithIncome(player);
        if (!(owed > 0) || !world) return 0;
        const cfg = PlayerReligion.offeringsConfig();
        const towns = PlayerReligion.offeringTowns(player, world);
        // Only the faithful who live in those towns give: the follower count
        // (every soul ever converted) can run past the towns' people
        const faithful = towns.reduce((s, e) => s + e.weight, 0);
        const followers = Math.max(1, player.religion.followers || 0);
        const due = Math.floor(owed * Math.min(1, faithful / followers) * 100) / 100;
        const res = Economy.drawTowns(towns, due, cfg.maxPurseShare, { init: true });
        const income = res.paid;
        player.religion.lastOffering = { owed, due, paid: income, towns: res.towns.length };
        // (the day's finance row takes it from the turn's results: ui/game/endDay.js)
        if (income > 0) player.gold = Math.round(((player.gold || 0) + income) * 100) / 100;
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
