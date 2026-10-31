// ============================================
// SEASONAL WORK — what each season offers the player
// ============================================
//
//   Spring  planting contracts: help a village sow, take a small advance
//           now and a share of the crop in gold when the harvest comes in
//   Summer  campaign season (kingdom wars, world/seasons.js), summer jobs
//   Autumn  harvest-labour jobs that pay well (data/earlyJobs.json
//           oddJobs.seasonal_jobs)
//   Winter  fur trapping and ice fishing on cold ground: a day running the
//           traps, or a trap line left set that fills over the days
//           (wolves and poachers may raid it; processTrapLines on its own
//           seeded stream), and ice fishing near the shore or out on
//           thinner ice (fishFarOut)
//
// Tuning lives in data/economy.json "seasons" (plantingContract, winterWork)
// and the seasonal odd jobs in data/earlyJobs.json. All randomness comes
// from Utils; world and player are explicit parameters.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Harvests } from '../world/harvests.js';
import { PlayerInventory } from './inventory.js';
import { Ailments } from '../systems/ailments.js';

const range = (pair, fallback) => (Array.isArray(pair) && pair.length === 2 ? pair : fallback);

// Trap lines and far-out ice fishing (data/economy.json seasons.winterWork
// trapLine / iceFishing.far override these)
const TRAP_LINE_DEFAULTS = {
    maxLines: 3, maxDays: 20, maxCatch: 12,
    peltChance: 0.55, pelts: [1, 2], meatChance: 0.25, rareChance: 0.03,
    wolfChance: 0.05, poacherChance: 0.02, poacherPerPelt: 0.006, poacherShare: 0.5,
};
const ICE_DEFAULTS = {
    far: { breakChance: 0.12, lateWinterDay: 22, lateWinter: 0.08, survivalSkill: 0.01, health: [8, 16], chillChance: 0.6, fish: [4, 7], bigChance: 0.45 },
};

/**
 * Where a settlement stands. Settlement objects on tiles carry no q/r of their
 * own, so look for the tile holding it (the same object, or failing that one
 * with its name — contracts from older saves stored no position).
 */
function locateSettlement(world, settlement, name = settlement && settlement.name) {
    if (settlement && Number.isFinite(settlement.q) && Number.isFinite(settlement.r)) return { q: settlement.q, r: settlement.r };
    if (!world || !Array.isArray(world.tiles)) return null;
    let byName = null;
    for (let r = 0; r < world.tiles.length; r++) {
        const row = world.tiles[r] || [];
        for (let q = 0; q < row.length; q++) {
            const s = row[q] && row[q].settlement;
            if (!s) continue;
            if (settlement && s === settlement) return { q, r };
            if (!byName && name && s.name === name) byName = { q, r };
        }
    }
    return byName;
}

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

    // ── Trap lines (set once, checked on later days) ──────

    _trapCfg() {
        const c = SeasonalWork._winter().trapLine || {};
        return { ...TRAP_LINE_DEFAULTS, ...c };
    },

    /** The player's trap lines (lazily created). */
    trapLines(player) {
        if (!Array.isArray(player.trapLines)) player.trapLines = [];
        return player.trapLines;
    },

    /** The trap line set on this tile, or null. */
    trapLineAt(player, q, r) {
        return (Array.isArray(player && player.trapLines) ? player.trapLines : []).find(l => l.q === q && l.r === r) || null;
    },

    /** Can a new line be set here? { ok, reason } */
    canSetTrapLine(player, tile, world) {
        if (!SeasonalWork.canTrapFurs(tile, world)) return { ok: false, reason: 'Trap lines need cold winter ground in the wilds.' };
        if (SeasonalWork.trapLineAt(player, tile.q, tile.r)) return { ok: false, reason: 'You already have a trap line here.' };
        const max = SeasonalWork._trapCfg().maxLines;
        if (SeasonalWork.trapLines(player).length >= max) return { ok: false, reason: `You can tend at most ${max} trap lines.` };
        return { ok: true };
    },

    /**
     * Lay a trap line on this tile: snares and deadfalls left to fill over
     * the coming days (SeasonalWork.processTrapLines). Takes the day.
     */
    setTrapLine(player, tile, world) {
        const check = SeasonalWork.canSetTrapLine(player, tile, world);
        if (!check.ok) return { success: false, reason: check.reason };
        const cfg = SeasonalWork._trapCfg();
        const day = Seasons.today(world);
        const line = {
            q: tile.q, r: tile.r, setDay: day, lastDay: day,
            expiresDay: day + cfg.maxDays,
            catch: {}, damaged: false, raids: 0,
        };
        SeasonalWork.trapLines(player).push(line);
        player.huntingTrips = (player.huntingTrips || 0) + 1;
        return { success: true, line, message: `You lay a trap line through the snow. Come back in a few days to see what it holds (it lapses after ${cfg.maxDays} days or when winter ends).` };
    },

    /** Units held by a line. */
    _lineCount(line) {
        return Object.values(line.catch || {}).reduce((a, b) => a + (b > 0 ? b : 0), 0);
    },

    /** A dedicated stream for the lines' day (never the game RNG). */
    _trapRng(player, world, day) {
        const seed = (world && world.generationParams && world.generationParams.seed) || 0;
        const s = `${seed}:traplines:${day}:${player && player.name ? player.name : ''}`;
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return Utils.seededRandom(((h >>> 0) % 233279) + 1);
    },

    /**
     * The lines' day: game walks into the snares, wolves and poachers may
     * raid a line, lines lapse at winter's end or after maxDays (what they
     * held is lost). Called once a day from PlayerActions.endDay.
     * Returns [{ icon, title, text, type }].
     */
    processTrapLines(player, world) {
        const lines = player && Array.isArray(player.trapLines) ? player.trapLines : null;
        if (!lines || !lines.length) return [];
        const day = Seasons.today(world);
        if (!Number.isFinite(day)) return [];
        const cfg = SeasonalWork._trapCfg();
        const notes = [];
        Utils.withRng(SeasonalWork._trapRng(player, world, day), () => {
            player.trapLines = lines.filter(line => {
                if (Seasons.seasonOf(day) !== 'Winter' || day > line.expiresDay) {
                    const left = SeasonalWork._lineCount(line);
                    notes.push({ icon: '🕸️', title: 'Trap Line Lapsed', text: `Your trap line at (${line.q}, ${line.r}) has gone untended${left ? ` — ${SeasonalWork._describe(line.catch)} left in the snares rots or is carried off` : ''}.`, type: 'warning' });
                    return false;
                }
                if (line.lastDay >= day) return true;
                line.lastDay = day;
                if (line.damaged) return true;
                const c = line.catch || (line.catch = {});
                const held = SeasonalWork._lineCount(line);
                if (held < cfg.maxCatch) {
                    if (Utils.random() < cfg.peltChance) c.pelts = (c.pelts || 0) + Utils.randInt(cfg.pelts[0], cfg.pelts[1]);
                    if (Utils.random() < cfg.meatChance) c.meat = (c.meat || 0) + 1;
                    if (Utils.random() < cfg.rareChance) {
                        c.pelts = (c.pelts || 0) + 3;
                        line.prize = true;
                    }
                }
                // Raiders come for a full line
                const full = SeasonalWork._lineCount(line);
                const wolf = cfg.wolfChance * (full > 0 ? 1 : 0.3);
                const poach = cfg.poacherChance + cfg.poacherPerPelt * (c.pelts || 0);
                const roll = Utils.random();
                if (roll < wolf) {
                    const lost = Math.min(c.pelts || 0, Utils.randInt(1, 2));
                    delete c.meat;
                    if (lost) c.pelts -= lost;
                    line.damaged = true;
                    line.raids++;
                    notes.push({ icon: '🐺', title: 'Wolves at the Snares', text: `Wolves tore through your trap line at (${line.q}, ${line.r})${lost ? `, savaging ${lost} pelt${lost === 1 ? '' : 's'}` : ''}. The snares are wrecked — reset them.`, type: 'warning' });
                } else if (roll < wolf + poach && (c.pelts || 0) > 0) {
                    const taken = Math.max(1, Math.ceil((c.pelts || 0) * cfg.poacherShare));
                    c.pelts -= taken;
                    line.raids++;
                    line.poached = (line.poached || 0) + taken;
                    notes.push({ icon: '🦹', title: 'Poachers', text: `Someone has been emptying your snares at (${line.q}, ${line.r}): ${taken} pelt${taken === 1 ? '' : 's'} gone, and fresh boot-prints in the snow.`, type: 'warning' });
                }
                if (c.pelts <= 0) delete c.pelts;
                return true;
            });
        });
        if (!player.trapLines.length) delete player.trapLines;
        return notes;
    },

    /**
     * Visit a line: 'collect' (empty it, leave it set), 'reset' (empty it,
     * mend and re-bait — runs another maxDays), 'pull' (empty it and take it
     * up). What does not fit in the packs stays in the snares.
     */
    tendTrapLine(player, tile, world, how = 'collect') {
        const line = tile ? SeasonalWork.trapLineAt(player, tile.q, tile.r) : null;
        if (!line) return { success: false, reason: 'You have no trap line here.' };
        const cfg = SeasonalWork._trapCfg();
        const { kept, lost } = SeasonalWork._bag(player, line.catch || {});
        line.catch = lost;
        const day = Seasons.today(world);
        let message = Object.keys(kept).length ? `You empty the snares: ${SeasonalWork._describe(kept)}.` : 'The snares hold nothing yet.';
        if (line.prize && kept.pelts) message += ' A prize fur among them!';
        line.prize = false;
        if (Object.keys(lost).length) message += ` No room for ${SeasonalWork._describe(lost)} — it stays in the snares.`;
        if (how === 'reset') {
            line.damaged = false;
            line.expiresDay = (Number.isFinite(day) ? day : line.setDay) + cfg.maxDays;
            message += ' You mend and re-bait the line.';
        } else if (how === 'pull') {
            player.trapLines = SeasonalWork.trapLines(player).filter(l => l !== line);
            if (!player.trapLines.length) delete player.trapLines;
            message += ' You take the line up.';
        } else if (line.damaged) {
            message += ' The snares are still wrecked: reset them or they catch nothing.';
        }
        return { success: true, items: kept, lost, message };
    },

    // ── Ice fishing out on the ice ────────────────────────

    _iceCfg() {
        const c = SeasonalWork._winter().iceFishing || {};
        return { ...ICE_DEFAULTS, ...c, far: { ...ICE_DEFAULTS.far, ...(c.far || {}) } };
    },

    /** Chance of going through the ice at a step out ('far' 1, 'deep' 2). */
    thinIceChance(player, world, step = 1) {
        const f = SeasonalWork._iceCfg().far;
        const day = Seasons.today(world);
        let c = f.breakChance * step;
        // The ice is thinnest at the turn of the season
        if (Number.isFinite(day) && Seasons.dayInSeason(day) >= f.lateWinterDay) c += f.lateWinter * step;
        c -= ((player.skills && player.skills.survival) || 0) * f.survivalSkill;
        if (player.luck) c -= (player.luck - 5) * 0.005;
        return Math.max(0.03, Math.min(0.7, c));
    },

    /**
     * Walk further out on the ice for a bigger catch. Returns { fell, items }.
     * Through the ice: health lost, often a chill (systems/ailments.js), and
     * the catch so far is gone. Nothing is bagged here: the caller banks the
     * catch with _bag when the player heads back.
     */
    fishFarOut(player, world, step = 1) {
        const f = SeasonalWork._iceCfg().far;
        if (Utils.random() < SeasonalWork.thinIceChance(player, world, step)) {
            const hurt = Utils.randInt(f.health[0], f.health[1]) * step;
            player.health = Math.max(1, (player.health || 100) - hurt);
            let chill = null;
            if (Utils.random() < f.chillChance) chill = Ailments.inflict(player, world, 'chill', { source: 'ice' });
            return { fell: true, healthLost: hurt, chill, items: {} };
        }
        const items = { fish: Utils.randInt(f.fish[0], f.fish[1]) * step };
        if (Utils.random() < f.bigChance) items.large_fish = step;
        return { fell: false, items };
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
        const at = locateSettlement(world, settlement) || {};
        const contract = {
            settlementName: settlement.name,
            q: at.q, r: at.r,
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
            const at = Number.isFinite(c.q) && Number.isFinite(c.r) ? c : locateSettlement(world, null, c.settlementName);
            const tile = at && world && typeof world.getTile === 'function' ? world.getTile(at.q, at.r) : null;
            if (!tile || !tile.settlement || tile.settlement.name !== c.settlementName) {
                paid.push({ settlementName: c.settlementName, paid: 0, factor: 0, lost: true });
                return false;
            }
            // ...and the share is of the year's real harvest there (world/harvests.js)
            const factor = Utils.clamp((1 + WorldEvents.getModifier(world, 'farmProduction', tile)) * Harvests.grainFactor(tile.settlement), 0.3, 1.6);
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
