// ============================================
// SEASONAL WORK — what each season offers the player
// ============================================
//
//   Spring  planting contracts: help a village sow, take a small advance
//           now and a share of the crop in gold when the harvest comes in
//   Summer  campaign season (kingdom wars, world/seasons.js), summer jobs
//   Autumn  harvest-labour jobs that pay well (data/earlyJobs.json
//           oddJobs.seasonal_jobs)
//   Winter  fur trapping and ice fishing on cold ground
//
// Tuning lives in data/economy.json "seasons" (plantingContract, winterWork)
// and the seasonal odd jobs in data/earlyJobs.json. All randomness comes
// from Utils; world and player are explicit parameters.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { WorldEvents } from '../world/worldEvents.js';
import { PlayerInventory } from './inventory.js';

const range = (pair, fallback) => (Array.isArray(pair) && pair.length === 2 ? pair : fallback);

export const SeasonalWork = {
    // ── Seasonal odd jobs ─────────────────────────────────

    /**
     * Seasonal day jobs on offer at a settlement tier this season, from
     * `jobData.seasonal_jobs` (data/earlyJobs.json oddJobs). Each entry
     * names its `seasons` and `tiers`.
     */
    jobsFor(tier, day, jobData) {
        const list = (jobData && Array.isArray(jobData.seasonal_jobs)) ? jobData.seasonal_jobs : [];
        if (!Number.isFinite(day)) return [];
        const season = Seasons.seasonOf(day);
        return list.filter(j => (j.seasons || []).includes(season) && (!j.tiers || j.tiers.includes(tier)))
            .map(j => ({ ...j, seasonal: true }));
    },

    // ── Winter work ───────────────────────────────────────

    _winter() {
        return Seasons.CONFIG.winterWork || {};
    },

    /** Can the player set traps here today? (winter, cold wild ground with game) */
    canTrapFurs(tile, world) {
        if (!tile || tile.settlement || !tile.terrain || !tile.terrain.passable) return false;
        const terrains = (SeasonalWork._winter().trapping || {}).terrains || [];
        return terrains.includes(tile.terrain.id) && Seasons.isColdTile(tile, world);
    },

    /** Can the player cut a hole in the ice here today? (winter, cold, on a river or beside a lake) */
    canIceFish(tile, world) {
        if (!tile || !tile.terrain || !tile.terrain.passable || !Seasons.isColdTile(tile, world)) return false;
        if (tile.hasRiver || tile.terrain.id === 'ice') return true;
        if (!world || typeof world.getTile !== 'function') return false;
        return Hex.neighbors(tile.q, tile.r).some(n => {
            const t = world.getTile(n.q, n.r);
            return t && t.terrain && t.terrain.id === 'lake';
        });
    },

    /** Add a catch to the packs; returns what fitted and what was left behind. */
    _bag(player, items) {
        const kept = {};
        const lost = {};
        for (const [id, qty] of Object.entries(items)) {
            if (!(qty > 0)) continue;
            if (PlayerInventory.addItem(player, id, qty).success) kept[id] = qty;
            else lost[id] = qty;
        }
        return { kept, lost };
    },

    _describe(items) {
        return Object.entries(items).map(([id, q]) => `${q} ${id.replace(/_/g, ' ')}`).join(', ');
    },

    /**
     * A day running a trap line in the snow: pelts (winter coats are thick),
     * sometimes meat, now and then a prize fur. Skilled fighters and lucky
     * trappers do better.
     */
    trapFurs(player, tile, world) {
        if (!SeasonalWork.canTrapFurs(tile, world)) {
            return { success: false, reason: 'Trapping needs cold winter ground in the wilds.' };
        }
        const cfg = SeasonalWork._winter().trapping || {};
        const [lo, hi] = range(cfg.pelts, [1, 3]);
        const skill = Math.min(2, Math.floor(((player.skills && player.skills.combat) || 0) / 4));
        const items = { pelts: Utils.randInt(lo, hi) + skill };
        if (Utils.random() < (cfg.meatChance ?? 0.4)) items.meat = Utils.randInt(1, 3);
        let rare = false;
        if (Utils.random() < (cfg.rareChance ?? 0.08) * (1 + ((player.luck || 5) - 5) * 0.05)) {
            items.pelts += 3; // a silver fox or a wolverine
            rare = true;
        }
        player.huntingTrips = (player.huntingTrips || 0) + 1;
        const { kept, lost } = SeasonalWork._bag(player, items);
        const got = SeasonalWork._describe(kept);
        let message = got ? `Your trap line yields ${got}.` : 'Your traps came up empty.';
        if (rare) message += ' A prize fur among them!';
        if (Object.keys(lost).length) message += ` No room for ${SeasonalWork._describe(lost)}.`;
        return { success: true, items: kept, lost, rare, message };
    },

    /** A day fishing through the ice: a steady catch, sometimes a big one. */
    iceFish(player, tile, world) {
        if (!SeasonalWork.canIceFish(tile, world)) {
            return { success: false, reason: 'Ice fishing needs a frozen river or lake in winter.' };
        }
        const cfg = SeasonalWork._winter().iceFishing || {};
        const [lo, hi] = range(cfg.fish, [2, 5]);
        const items = { fish: Utils.randInt(lo, hi) };
        if (Utils.random() < (cfg.bigChance ?? 0.15)) items.large_fish = 1;
        const { kept, lost } = SeasonalWork._bag(player, items);
        const got = SeasonalWork._describe(kept);
        let message = got ? `Through the ice you pull up ${got}.` : 'Nothing bites under the ice today.';
        if (Object.keys(lost).length) message += ` No room for ${SeasonalWork._describe(lost)}.`;
        return { success: true, items: kept, lost, message };
    },

    // ── Spring planting contracts ─────────────────────────

    _contractCfg() {
        return Seasons.CONFIG.plantingContract || {};
    },

    /** First day of this year's autumn (the harvest), for a day in spring. */
    harvestDay(day) {
        const yearStart = day - Seasons.dayOfYear(day) + 1;
        return yearStart + 2 * Seasons.DAYS_PER_SEASON + 4; // a few days into autumn
    },

    /** Can the player sign a planting contract at this settlement today? */
    canSignPlantingContract(player, settlement, world) {
        const day = Seasons.today(world);
        if (!settlement) return { ok: false, reason: 'No settlement here.' };
        if (!Number.isFinite(day) || Seasons.seasonOf(day) !== 'Spring') return { ok: false, reason: 'Planting contracts are signed in spring.' };
        if (!['village', 'town'].includes(settlement.type)) return { ok: false, reason: 'Only villages and towns hire planting hands.' };
        const contracts = player.plantingContracts || [];
        const max = SeasonalWork._contractCfg().maxActive || 3;
        if (contracts.length >= max) return { ok: false, reason: `You already hold ${max} planting contracts.` };
        const due = SeasonalWork.harvestDay(day);
        if (contracts.some(c => c.settlementName === settlement.name && c.dueDay === due)) {
            return { ok: false, reason: `You already sowed ${settlement.name}'s fields this year.` };
        }
        return { ok: true };
    },

    /**
     * Sign on to sow a settlement's fields: a small advance now, and a share
     * of the crop paid in gold a few days into autumn. A drought or flood
     * there at harvest time shrinks the share; a bountiful harvest swells it.
     */
    signPlantingContract(player, settlement, world) {
        const check = SeasonalWork.canSignPlantingContract(player, settlement, world);
        if (!check.ok) return { success: false, reason: check.reason };
        const cfg = SeasonalWork._contractCfg();
        const [alo, ahi] = range(cfg.advance, [8, 15]);
        const [plo, phi] = range(cfg.payout, [45, 80]);
        const advance = Utils.randInt(alo, ahi);
        const size = settlement.type === 'town' ? 1.25 : 1;
        const payout = Math.round(Utils.randInt(plo, phi) * size);
        const day = Seasons.today(world);
        const contract = {
            settlementName: settlement.name,
            q: settlement.q, r: settlement.r,
            signedDay: day,
            dueDay: SeasonalWork.harvestDay(day),
            payout,
        };
        if (!player.plantingContracts) player.plantingContracts = [];
        player.plantingContracts.push(contract);
        player.gold = (player.gold || 0) + advance;
        player.jobsCompleted = (player.jobsCompleted || 0) + 1;
        return {
            success: true, advance, contract,
            message: `You sow ${settlement.name}'s fields for ${advance} gold now and a share of the harvest (about ${payout} gold) on day ${Seasons.dayInSeason(contract.dueDay)} of autumn.`,
        };
    },

    /**
     * Pay out planting contracts whose harvest has come in. Called once a
     * day from PlayerActions.endDay. Returns [{ settlementName, paid, factor }].
     */
    processDaily(player, world) {
        const contracts = player && player.plantingContracts;
        if (!Array.isArray(contracts) || contracts.length === 0) return [];
        const day = Seasons.today(world);
        if (!Number.isFinite(day)) return [];
        const paid = [];
        player.plantingContracts = contracts.filter(c => {
            if (day < c.dueDay) return true;
            const tile = world && typeof world.getTile === 'function' ? world.getTile(c.q, c.r) : null;
            if (!tile || !tile.settlement || tile.settlement.name !== c.settlementName) {
                paid.push({ settlementName: c.settlementName, paid: 0, factor: 0, lost: true });
                return false;
            }
            const factor = Utils.clamp(1 + WorldEvents.getModifier(world, 'farmProduction', tile), 0.3, 1.6);
            const gold = Math.round(c.payout * factor);
            player.gold = (player.gold || 0) + gold;
            if (player.financeToday && player.financeToday.income) {
                player.financeToday.income.jobs = (player.financeToday.income.jobs || 0) + gold;
            }
            paid.push({ settlementName: c.settlementName, paid: gold, factor });
            return false;
        });
        if (player.plantingContracts.length === 0) delete player.plantingContracts;
        return paid;
    },
};
