// ============================================
// TITLES — Political Offices, Duties & Progression
// ============================================

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';


export const Titles = {

    // ── Data Access ──

    _getData() {
        return (typeof DataLoader !== 'undefined' && DataLoader.titles) ? DataLoader.titles : null;
    },

    getTitleDefinitions() {
        const data = Titles._getData();
        return data ? data.titles : {};
    },

    getFugitivePool() {
        const data = Titles._getData();
        return data ? (data.fugitives || []) : [];
    },

    // ── Core API ──

    /**
     * Initialize player title fields if not present
     */
    initialize(player) {
        if (!player.currentTitle) player.currentTitle = null;     // title ID string
        if (!player.titleProgress) player.titleProgress = {};     // duty progress tracking
        if (!player.titleHistory) player.titleHistory = [];       // past titles held
        if (!player.activeFugitive) player.activeFugitive = null; // for jailer duty
        if (!player.titleDutyDeadline) player.titleDutyDeadline = 0;
    },

    /**
     * Get the player's active title definition (or null)
     */
    getActiveTitle(player) {
        if (!player.currentTitle) return null;
        const titles = Titles.getTitleDefinitions();
        return titles[player.currentTitle] || null;
    },

    /**
     * Check if a player qualifies for a specific title
     */
    meetsRequirements(player, titleId, world) {
        const titles = Titles.getTitleDefinitions();
        const title = titles[titleId];
        if (!title) return { meets: false, reason: 'Unknown title.' };

        // Must be pledged to a kingdom
        if (!player.allegiance) return { meets: false, reason: 'You must be pledged to a kingdom.' };

        const reqs = title.requirements;
        const kingdomRep = (player.reputation && player.reputation[player.allegiance]) || 0;

        if (reqs.reputation && kingdomRep < reqs.reputation) {
            return { meets: false, reason: `Need ${reqs.reputation} reputation (have ${kingdomRep}).` };
        }
        if (reqs.renown && (player.renown || 0) < reqs.renown) {
            return { meets: false, reason: `Need ${reqs.renown} renown (have ${player.renown || 0}).` };
        }
        if (reqs.skills) {
            for (const [skill, level] of Object.entries(reqs.skills)) {
                const playerSkill = (player.skills && player.skills[skill]) || 0;
                if (playerSkill < level) {
                    return { meets: false, reason: `Need ${skill} ${level} (have ${playerSkill}).` };
                }
            }
        }
        if (reqs.attributes) {
            for (const [attr, level] of Object.entries(reqs.attributes)) {
                const playerAttr = player[attr] || 0;
                if (playerAttr < level) {
                    return { meets: false, reason: `Need ${attr} ${level} (have ${playerAttr}).` };
                }
            }
        }

        // Can't hold a title if already holding one of equal or higher rank
        if (player.currentTitle) {
            const currentDef = titles[player.currentTitle];
            if (currentDef && currentDef.rank >= title.rank) {
                return { meets: false, reason: `You already hold the office of ${currentDef.name}. Resign first or seek a higher office.` };
            }
        }

        return { meets: true };
    },

    /**
     * Appoint player to a title
     */
    appoint(player, titleId, world) {
        const titles = Titles.getTitleDefinitions();
        const title = titles[titleId];
        if (!title) return { success: false, reason: 'Unknown title.' };

        const check = Titles.meetsRequirements(player, titleId, world);
        if (!check.meets) return { success: false, reason: check.reason };

        // If upgrading from lower title, archive old
        if (player.currentTitle) {
            const oldTitle = titles[player.currentTitle];
            player.titleHistory.push({
                titleId: player.currentTitle,
                name: oldTitle ? oldTitle.name : player.currentTitle,
                appointedDay: player.titleAppointedDay || 0,
                resignedDay: world.day,
                reason: 'promoted',
            });
        }

        player.currentTitle = titleId;
        player.kingdomTitle = title.name.toLowerCase().replace(/\s+/g, '_');
        player.title = `${title.name} of ${world.getKingdom(player.allegiance)?.name || 'the Realm'}`;
        player.titleAppointedDay = world.day;
        player.titleDutyDeadline = world.day + (title.duties.deadlineDays || 30);
        player.titleProgress = Titles._resetProgress(titleId);
        player.activeFugitive = null;

        return { success: true, title };
    },

    /**
     * Resign from current title
     */
    resign(player, world) {
        if (!player.currentTitle) return { success: false, reason: 'You hold no office.' };
        const titles = Titles.getTitleDefinitions();
        const oldTitle = titles[player.currentTitle];

        player.titleHistory.push({
            titleId: player.currentTitle,
            name: oldTitle ? oldTitle.name : player.currentTitle,
            appointedDay: player.titleAppointedDay || 0,
            resignedDay: world.day,
            reason: 'resigned',
        });

        const result = { success: true, oldTitle: oldTitle, name: oldTitle ? oldTitle.name : player.currentTitle };
        player.currentTitle = null;
        player.kingdomTitle = 'citizen';
        player.title = `Citizen of ${world.getKingdom(player.allegiance)?.name || 'the Realm'}`;
        player.titleProgress = {};
        player.titleDutyDeadline = 0;
        player.activeFugitive = null;

        // Reputation penalty for abandoning office
        if (player.allegiance && player.reputation) {
            player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) - 5;
        }

        return result;
    },

    /**
     * Reset duty progress for a title
     */
    _resetProgress(titleId) {
        const titles = Titles.getTitleDefinitions();
        const title = titles[titleId];
        if (!title) return {};

        const duty = title.duties;
        switch (duty.type) {
            case 'visit_settlements':
                return { settlementsVisited: [], collectionsCompleted: 0 };
            case 'capture_fugitives':
                return { capturesMade: 0 };
            case 'patrol_territory':
                return { patrolsCompleted: 0, patrolTilesVisited: new Set() };
            case 'gather_intel':
                return { intelGathered: 0 };
            case 'bless_settlements':
                return { settlementsBlesssed: [] };
            case 'trade_missions':
                return { missionsCompleted: 0 };
            case 'survey_territory':
                return { tilesExplored: 0 };
            case 'maintain_order':
                return { councilHeld: false };
            default:
                return {};
        }
    },

    // ── Duty Actions ──

    /**
     * Tax Collector: collect taxes at a settlement
     */
    collectTaxAtSettlement(player, tile, world) {
        if (player.currentTitle !== 'tax_collector') return { success: false, reason: 'You are not the Tax Collector.' };
        if (!tile.settlement || tile.settlement.kingdom !== player.allegiance) {
            return { success: false, reason: 'This is not a settlement of your kingdom.' };
        }

        const progress = player.titleProgress;
        const sKey = `${tile.q},${tile.r}`;
        if (progress.settlementsVisited && progress.settlementsVisited.includes(sKey)) {
            return { success: false, reason: 'You already collected taxes here this month.' };
        }

        const title = Titles.getTitleDefinitions().tax_collector;
        const perks = title.perks;
        const collected = Utils.randInt(perks.goldPerCollection.min, perks.goldPerCollection.max);

        // Scale by settlement size
        const sizeMult = { village: 0.6, town: 1.0, city: 1.5, capital: 2.0 };
        const finalGold = Math.round(collected * (sizeMult[tile.settlement.type] || 1));
        player.gold += finalGold;

        if (!progress.settlementsVisited) progress.settlementsVisited = [];
        progress.settlementsVisited.push(sKey);
        progress.collectionsCompleted = (progress.collectionsCompleted || 0) + 1;

        // Small rep gain
        if (player.reputation) {
            player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) + (perks.reputationGain || 1);
        }

        return { success: true, gold: finalGold, settlement: tile.settlement.name, count: progress.collectionsCompleted };
    },

    /**
     * Jailer: spawn a fugitive to hunt
     */
    spawnFugitive(player, world) {
        if (player.currentTitle !== 'jailer') return { success: false, reason: 'Not the Jailer.' };
        if (player.activeFugitive) return { success: false, reason: 'Already tracking a fugitive.' };

        const pool = Titles.getFugitivePool();
        if (pool.length === 0) return { success: false, reason: 'No fugitives available.' };

        const template = Utils.randPick(pool);

        // Place the fugitive on a random non-ocean explored tile
        let attempts = 0;
        let fq, fr;
        do {
            fq = Utils.randInt(0, world.width - 1);
            fr = Utils.randInt(0, world.height - 1);
            attempts++;
        } while (attempts < 200 && (!world.tiles[fr] || !world.tiles[fr][fq] ||
            !world.tiles[fr][fq].terrain.passable));

        player.activeFugitive = {
            ...template,
            q: fq,
            r: fr,
            spawnDay: world.day,
            daysRemaining: 20 + Utils.randInt(0, 10),
        };

        return { success: true, fugitive: player.activeFugitive };
    },

    /**
     * Jailer: attempt to capture a fugitive (player must be on their tile)
     */
    captureFugitive(player, world) {
        if (!player.activeFugitive) return { success: false, reason: 'No active fugitive to capture.' };

        const fug = player.activeFugitive;
        if (player.q !== fug.q || player.r !== fug.r) {
            return { success: false, reason: `The fugitive is not here. Last seen near (${fug.q}, ${fug.r}).` };
        }

        // Combat check
        const combatSkill = (player.skills && player.skills.combat) || 1;
        const roll = Utils.randInt(1, 10) + combatSkill;
        if (roll < fug.difficulty) {
            // Fugitive escapes — relocate them
            let nq, nr, attempts = 0;
            do {
                nq = Utils.randInt(Math.max(0, fug.q - 5), Math.min(world.width - 1, fug.q + 5));
                nr = Utils.randInt(Math.max(0, fug.r - 5), Math.min(world.height - 1, fug.r + 5));
                attempts++;
            } while (attempts < 50 && (!world.tiles[nr] || !world.tiles[nr][nq] || !world.tiles[nr][nq].terrain.passable));

            fug.q = nq;
            fug.r = nr;
            return { success: false, escaped: true, reason: `${fug.name} fought back and escaped! Last seen heading toward (${nq}, ${nr}).` };
        }

        // Success
        const title = Titles.getTitleDefinitions().jailer;
        const gold = Utils.randInt(title.perks.goldPerCapture.min, title.perks.goldPerCapture.max);
        player.gold += gold;
        player.karma = (player.karma || 0) + (title.perks.karmaGain || 1);
        player.renown = (player.renown || 0) + (title.perks.renownGain || 2);

        const progress = player.titleProgress;
        progress.capturesMade = (progress.capturesMade || 0) + 1;
        const captured = { ...fug };
        player.activeFugitive = null;

        return { success: true, fugitive: captured, gold, captureCount: progress.capturesMade };
    },

    /**
     * Marshal: complete a patrol (track tiles visited this period)
     */
    recordPatrolStep(player, q, r) {
        if (player.currentTitle !== 'marshal') return;
        if (!player.titleProgress.patrolTilesVisited) {
            player.titleProgress.patrolTilesVisited = new Set();
        }
        player.titleProgress.patrolTilesVisited.add(`${q},${r}`);

        // Every 8 unique tiles = 1 patrol completed
        if (player.titleProgress.patrolTilesVisited.size >= 8) {
            player.titleProgress.patrolsCompleted = (player.titleProgress.patrolsCompleted || 0) + 1;
            player.titleProgress.patrolTilesVisited = new Set();

            const title = Titles.getTitleDefinitions().marshal;
            if (title) {
                const gold = Utils.randInt(title.perks.goldPerPatrol.min, title.perks.goldPerPatrol.max);
                player.gold += gold;
                player.renown = (player.renown || 0) + 1;
                return { patrolCompleted: true, gold, count: player.titleProgress.patrolsCompleted };
            }
        }
        return null;
    },

    /**
     * Spymaster: gather intel (triggered when getting tavern rumors in foreign territory)
     */
    recordIntelGathered(player) {
        if (player.currentTitle !== 'spymaster') return;
        const progress = player.titleProgress;
        progress.intelGathered = (progress.intelGathered || 0) + 1;

        const title = Titles.getTitleDefinitions().spymaster;
        if (title) {
            const gold = Utils.randInt(title.perks.goldPerIntel.min, title.perks.goldPerIntel.max);
            player.gold += gold;
            return { gold, count: progress.intelGathered };
        }
        return null;
    },

    /**
     * Court Chaplain: bless a settlement
     */
    blessSettlement(player, tile, world) {
        if (player.currentTitle !== 'court_chaplain') return { success: false, reason: 'You are not the Court Chaplain.' };
        if (!tile.settlement || tile.settlement.kingdom !== player.allegiance) {
            return { success: false, reason: 'This is not a settlement of your kingdom.' };
        }

        const progress = player.titleProgress;
        const sKey = `${tile.q},${tile.r}`;
        if (progress.settlementsBlesssed && progress.settlementsBlesssed.includes(sKey)) {
            return { success: false, reason: 'You already blessed this settlement this month.' };
        }

        player.karma = (player.karma || 0) + 2;
        player.renown = (player.renown || 0) + 1;

        if (!progress.settlementsBlesssed) progress.settlementsBlesssed = [];
        progress.settlementsBlesssed.push(sKey);

        if (player.reputation) {
            player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) + 1;
        }

        return { success: true, settlement: tile.settlement.name, count: progress.settlementsBlesssed.length };
    },

    /**
     * Trade Envoy: complete a trade mission (triggered when trading at foreign settlement)
     */
    recordTradeMission(player) {
        if (player.currentTitle !== 'trade_envoy') return;
        const progress = player.titleProgress;
        progress.missionsCompleted = (progress.missionsCompleted || 0) + 1;

        const title = Titles.getTitleDefinitions().trade_envoy;
        if (title) {
            const gold = Utils.randInt(title.perks.goldPerDeal.min, title.perks.goldPerDeal.max);
            player.gold += gold;
            player.renown = (player.renown || 0) + 1;
            return { gold, count: progress.missionsCompleted };
        }
        return null;
    },

    /**
     * Royal Cartographer: record tiles explored
     */
    recordExploration(player, count) {
        if (player.currentTitle !== 'royal_cartographer') return;
        const progress = player.titleProgress;
        progress.tilesExplored = (progress.tilesExplored || 0) + count;
    },

    /**
     * Chancellor: hold council
     */
    holdCouncil(player, tile, world) {
        if (player.currentTitle !== 'chancellor') return { success: false, reason: 'You are not the Chancellor.' };
        if (!tile.settlement || tile.settlement.type !== 'capital' || tile.settlement.kingdom !== player.allegiance) {
            return { success: false, reason: 'You must hold council at your kingdom\'s capital.' };
        }

        const progress = player.titleProgress;
        if (progress.councilHeld) {
            return { success: false, reason: 'You already held council this month.' };
        }

        progress.councilHeld = true;
        player.renown = (player.renown || 0) + 5;

        if (player.reputation) {
            player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) + 3;
        }

        return { success: true, settlement: tile.settlement.name };
    },

    // ── Daily Processing ──

    /**
     * Process daily title events (called from game.endDay)
     */
    processDaily(player, world) {
        if (!player.currentTitle) return null;

        const titles = Titles.getTitleDefinitions();
        const title = titles[player.currentTitle];
        if (!title) return null;

        const results = { salary: 0, dutyFailed: false, fugitiveUpdate: null };

        // Pay daily salary
        results.salary = title.salary || 0;
        player.gold += results.salary;

        // Check fugitive timer (jailer)
        if (player.currentTitle === 'jailer' && player.activeFugitive) {
            player.activeFugitive.daysRemaining--;
            if (player.activeFugitive.daysRemaining <= 0) {
                // Fugitive escaped
                results.fugitiveUpdate = {
                    escaped: true,
                    name: player.activeFugitive.name,
                    message: `${player.activeFugitive.name} has fled the realm! You failed to capture them.`,
                };
                player.activeFugitive = null;
            } else if (player.activeFugitive.daysRemaining <= 5) {
                results.fugitiveUpdate = {
                    warning: true,
                    name: player.activeFugitive.name,
                    daysLeft: player.activeFugitive.daysRemaining,
                    message: `${player.activeFugitive.name} may escape soon! ${player.activeFugitive.daysRemaining} days left.`,
                };

                // Fugitive moves randomly
                const fug = player.activeFugitive;
                let nq, nr, attempts = 0;
                do {
                    nq = Utils.randInt(Math.max(0, fug.q - 3), Math.min(world.width - 1, fug.q + 3));
                    nr = Utils.randInt(Math.max(0, fug.r - 3), Math.min(world.height - 1, fug.r + 3));
                    attempts++;
                } while (attempts < 30 && (!world.tiles[nr] || !world.tiles[nr][nq] || !world.tiles[nr][nq].terrain.passable));
                fug.q = nq;
                fug.r = nr;
            }
        }

        // Check monthly deadline
        if (world.day >= player.titleDutyDeadline) {
            const evaluation = Titles._evaluateDuties(player, title, world);
            results.evaluation = evaluation;

            if (evaluation.passed) {
                // Award completion bonuses
                player.renown = (player.renown || 0) + (title.perks.renownGain || 1);
                if (player.reputation) {
                    player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) + (title.perks.reputationGain || 1);
                }
            } else {
                // Apply failure penalties
                results.dutyFailed = true;
                const penalty = title.duties.failurePenalty || {};
                if (penalty.reputation && player.reputation) {
                    player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) + penalty.reputation;
                }
                if (penalty.renown) {
                    player.renown = Math.max(0, (player.renown || 0) + penalty.renown);
                }
                if (penalty.karma) {
                    player.karma = (player.karma || 0) + penalty.karma;
                }

                // Two consecutive failures = stripped of title
                player._dutyFailures = (player._dutyFailures || 0) + 1;
                if (player._dutyFailures >= 2) {
                    results.stripped = true;
                    Titles.resign(player, world);
                    results.strippedMessage = `You have been stripped of your title for failing your duties twice in a row!`;
                    player._dutyFailures = 0;
                    return results;
                }
            }

            if (evaluation.passed) player._dutyFailures = 0;

            // Reset for next period
            player.titleProgress = Titles._resetProgress(player.currentTitle);
            player.titleDutyDeadline = world.day + (title.duties.deadlineDays || 30);
        }

        return results;
    },

    /**
     * Evaluate if duties were fulfilled
     */
    _evaluateDuties(player, title, world) {
        const duty = title.duties;
        const progress = player.titleProgress;

        switch (duty.type) {
            case 'visit_settlements': {
                const count = progress.collectionsCompleted || 0;
                const required = duty.settlementsRequired || 3;
                return {
                    passed: count >= required,
                    progress: `${count}/${required} settlements visited`,
                    count, required,
                };
            }
            case 'capture_fugitives': {
                const count = progress.capturesMade || 0;
                const required = duty.capturesRequired || 1;
                return {
                    passed: count >= required,
                    progress: `${count}/${required} fugitives captured`,
                    count, required,
                };
            }
            case 'patrol_territory': {
                const count = progress.patrolsCompleted || 0;
                const required = duty.patrolsRequired || 4;
                return {
                    passed: count >= required,
                    progress: `${count}/${required} patrols completed`,
                    count, required,
                };
            }
            case 'gather_intel': {
                const count = progress.intelGathered || 0;
                const required = duty.intelRequired || 2;
                return {
                    passed: count >= required,
                    progress: `${count}/${required} intelligence gathered`,
                    count, required,
                };
            }
            case 'bless_settlements': {
                const count = progress.settlementsBlesssed ? progress.settlementsBlesssed.length : 0;
                const required = duty.blessingsRequired || 2;
                return {
                    passed: count >= required,
                    progress: `${count}/${required} settlements blessed`,
                    count, required,
                };
            }
            case 'trade_missions': {
                const count = progress.missionsCompleted || 0;
                const required = duty.missionsRequired || 2;
                return {
                    passed: count >= required,
                    progress: `${count}/${required} trade missions`,
                    count, required,
                };
            }
            case 'survey_territory': {
                const count = progress.tilesExplored || 0;
                const required = duty.tilesRequired || 20;
                return {
                    passed: count >= required,
                    progress: `${count}/${required} tiles surveyed`,
                    count, required,
                };
            }
            case 'maintain_order': {
                const held = progress.councilHeld || false;
                return {
                    passed: held,
                    progress: held ? 'Council held' : 'Council not held',
                    count: held ? 1 : 0, required: 1,
                };
            }
            default:
                return { passed: true, progress: 'N/A' };
        }
    },

    // ── Serialization helpers ──

    serializeProgress(progress) {
        if (!progress) return {};
        const out = { ...progress };
        // Convert Sets to Arrays for JSON
        if (out.patrolTilesVisited instanceof Set) {
            out.patrolTilesVisited = Array.from(out.patrolTilesVisited);
        }
        return out;
    },

    deserializeProgress(progress) {
        if (!progress) return {};
        const out = { ...progress };
        if (Array.isArray(out.patrolTilesVisited)) {
            out.patrolTilesVisited = new Set(out.patrolTilesVisited);
        }
        return out;
    },

    /**
     * Get available titles the player can seek at a settlement
     */
    getAvailableTitles(player, tile, world) {
        if (!player.allegiance) return [];
        if (!tile.settlement || tile.settlement.kingdom !== player.allegiance) return [];

        const titles = Titles.getTitleDefinitions();
        const available = [];

        for (const [id, title] of Object.entries(titles)) {
            if (player.currentTitle === id) continue; // Already have this one
            const check = Titles.meetsRequirements(player, id, world);
            available.push({
                id,
                ...title,
                meetsRequirements: check.meets,
                reason: check.reason || null,
            });
        }

        // Sort: qualified first, then by rank
        available.sort((a, b) => {
            if (a.meetsRequirements !== b.meetsRequirements) return a.meetsRequirements ? -1 : 1;
            return a.rank - b.rank;
        });

        return available;
    },

    /**
     * Get duty progress summary for display
     */
    getDutyProgress(player) {
        if (!player.currentTitle) return null;
        const titles = Titles.getTitleDefinitions();
        const title = titles[player.currentTitle];
        if (!title) return null;

        const eval_ = Titles._evaluateDuties(player, title, { day: 0 });
        const daysLeft = Math.max(0, (player.titleDutyDeadline || 0) - (typeof game !== 'undefined' ? game.world.day : 0));

        return {
            titleId: player.currentTitle,
            title: title,
            progress: eval_.progress,
            passed: eval_.passed,
            count: eval_.count,
            required: eval_.required,
            daysLeft,
            deadline: player.titleDutyDeadline,
        };
    },
};
