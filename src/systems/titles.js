// ============================================
// TITLES — Political Offices, Duties & Progression
// ============================================

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { House } from './house.js';
import { BountyHunting } from './bountyHunting.js';
import { Ledger } from './ledger.js';
import { Traits } from './traits.js';
import { CrownBooks } from '../world/crownBooks.js';

// Tax collection as a choice and its audit; the chaplain's blessing; tuning
// in data/titles.json → taxCollection / blessing (these are the defaults).
const TAX_DEFAULTS = {
    modes: {
        fair: { fee: 1, levy: 1, happiness: 0, rep: 1, karma: 0, renown: 0, resentment: 0, unrest: 0 },
        squeeze: { fee: 1.6, levy: 1.5, happiness: -8, rep: 2, karma: -1, renown: 0, resentment: 2, unrest: 8 },
        spare: { fee: 0.5, levy: 0.6, happiness: 5, rep: 0, karma: 1, renown: 1, resentment: -1, unrest: -3 },
        skim: { fee: 1, levy: 1, skim: 0.9, happiness: -1, rep: 1, karma: -1, renown: 0, resentment: 0, unrest: 0 },
    },
    resentmentDecayDays: 15, resentmentYield: 0.12, maxResentment: 6, minYield: 0.4,
    riotPerResentment: 0.08, riotHealth: [5, 12], riotHappiness: -4,
    unheldUnrestHappiness: 0.5, riotRevoltDays: 10,
    crownLines: { land: 0.5, poll: 0.25, excise: 0.25 },
    audit: { base: 0.1, perGold: 0.003, max: 0.85, commerce: 0.02, repay: 2, reputation: -15, renown: -3 },
};
const BLESSING_DEFAULTS = { days: 20, happiness: 3, sicknessMult: 0.6 };

function _clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _num0(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function _strHash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}


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
    meetsRequirements(player, titleId, world, opts = {}) {
        const waive = opts.waive || [];
        const titles = Titles.getTitleDefinitions();
        const title = titles[titleId];
        if (!title) return { meets: false, reason: 'Unknown title.' };

        // Must be pledged to a kingdom
        if (!player.allegiance) return { meets: false, reason: 'You must be pledged to a kingdom.' };

        const reqs = title.requirements;
        const kingdomRep = (player.reputation && player.reputation[player.allegiance]) || 0;

        if (reqs.reputation && !waive.includes('reputation') && kingdomRep < reqs.reputation) {
            return { meets: false, reason: `Need ${reqs.reputation} reputation (have ${kingdomRep}).` };
        }
        if (reqs.renown && !waive.includes('renown') && (player.renown || 0) < reqs.renown) {
            return { meets: false, reason: `Need ${reqs.renown} renown (have ${player.renown || 0}).` };
        }
        if (reqs.skills) {
            for (const [skill, level] of Object.entries(reqs.skills)) {
                let playerSkill = (player.skills && player.skills[skill]) || 0;
                // A House Chancellor's counsel counts toward diplomacy requirements
                if (skill === 'diplomacy' && player.house) playerSkill += House.getRoleBonuses(player).diplomacyBonus || 0;
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
    appoint(player, titleId, world, opts = {}) {
        const titles = Titles.getTitleDefinitions();
        const title = titles[titleId];
        if (!title) return { success: false, reason: 'Unknown title.' };

        const check = Titles.meetsRequirements(player, titleId, world, opts);
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

        // House Prestige — earning an office is a notable dynastic deed.
        House.recordPlayerDeed(player, world, 'titleGained', {
            reason: `appointed ${title.name}`,
            chronicle: `${player.house ? player.house.name : 'The House'} gains the office of ${title.name}.`,
            tags: ['title'],
        });

        return { success: true, title };
    },

    /** Requirements a House Prestige claim can set aside (skills still count). */
    CLAIM_WAIVES: ['reputation', 'renown'],

    /**
     * The next office up that a Prestige claim could secure: the lowest-ranked
     * title above the current one that the player fails only on reputation
     * or renown. Returns { titleId, title } or { reason }.
     */
    getClaimableTitle(player, world) {
        if (!player.allegiance) return { reason: 'You must be pledged to a kingdom to press a claim.' };
        const titles = Titles.getTitleDefinitions();
        const currentRank = player.currentTitle && titles[player.currentTitle] ? titles[player.currentTitle].rank : 0;
        const ranks = [...new Set(Object.values(titles).map(t => t.rank).filter(r => r > currentRank))].sort((a, b) => a - b);
        if (ranks.length === 0) return { reason: 'You already hold the highest office.' };
        const nextRank = Object.entries(titles).filter(([, t]) => t.rank === ranks[0]);
        for (const [id, t] of nextRank) {
            if (Titles.meetsRequirements(player, id, world).meets) {
                return { reason: `You already qualify for ${t.name} — seek the appointment directly.` };
            }
        }
        for (const [id, t] of nextRank) {
            if (Titles.meetsRequirements(player, id, world, { waive: Titles.CLAIM_WAIVES }).meets) return { titleId: id, title: t };
        }
        return { reason: 'No office is within reach of a claim — you lack the skills for the next rank.' };
    },

    /**
     * Spend House Prestige to press a claim to the next office, waiving its
     * reputation and renown requirements.
     */
    pressClaim(player, world) {
        const claim = Titles.getClaimableTitle(player, world);
        if (!claim.titleId) return { success: false, reason: claim.reason };
        const paid = House.pressClaim(player, world, {
            chronicle: `${player.house ? player.house.name : 'The House'} presses its claim to the office of ${claim.title.name}.`,
            tags: ['claim', 'title'],
        });
        if (!paid.success) return { success: false, reason: paid.reason === 'Not enough Prestige' ? `Need ${paid.cost} Prestige (have ${paid.have}).` : paid.reason };
        return Titles.appoint(player, claim.titleId, world, { waive: Titles.CLAIM_WAIVES });
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

    // ── Tax collection: a choice ──

    _taxCfg() {
        const d = (Titles._getData() || {}).taxCollection || {};
        const modes = {};
        for (const [k, v] of Object.entries(TAX_DEFAULTS.modes)) modes[k] = { ...v, ...((d.modes || {})[k] || {}) };
        return { ...TAX_DEFAULTS, ...d, modes, audit: { ...TAX_DEFAULTS.audit, ...(d.audit || {}) } };
    },

    /** How much a settlement still resents the last hard collection (decays with time). */
    taxResentment(settlement, day) {
        const rec = settlement && settlement.crownLevy;
        if (!rec || !(rec.resentment > 0)) return 0;
        const cfg = Titles._taxCfg();
        const faded = Number.isFinite(day) && Number.isFinite(rec.day) ? Math.floor((day - rec.day) / Math.max(1, cfg.resentmentDecayDays)) : 0;
        return Math.max(0, rec.resentment - faded);
    },

    /** Yield multiplier of a settlement: its mood and its resentment of the collector. */
    taxYieldMult(settlement, day) {
        const cfg = Titles._taxCfg();
        const happiness = typeof settlement.happiness === 'number' ? settlement.happiness : 50;
        const mood = 0.75 + happiness / 200;
        const resent = _clampN(1 - cfg.resentmentYield * Titles.taxResentment(settlement, day), cfg.minYield, 1);
        return mood * resent;
    },

    /** Why the tax collector cannot collect here, or null. */
    _taxBlock(player, tile) {
        if (player.currentTitle !== 'tax_collector') return 'You are not the Tax Collector.';
        if (!tile || !tile.settlement || tile.settlement.kingdom !== player.allegiance) return 'This is not a settlement of your kingdom.';
        const sKey = `${tile.q},${tile.r}`;
        if (player.titleProgress && (player.titleProgress.settlementsVisited || []).includes(sKey)) return 'You already collected taxes here this month.';
        return null;
    },

    /**
     * Assess a settlement before collecting: the collector's fee (rolled
     * once), the crown's levy, the town's mood and grudges. Returns null when
     * no collection is possible here.
     */
    taxAssessment(player, tile, world) {
        if (Titles._taxBlock(player, tile)) return null;
        const perks = Titles.getTitleDefinitions().tax_collector.perks;
        const collected = Utils.randInt(perks.goldPerCollection.min, perks.goldPerCollection.max);
        const sizeMult = { village: 0.6, town: 1.0, city: 1.5, capital: 2.0 };
        const s = tile.settlement;
        const day = world ? world.day : null;
        const fee = collected * (sizeMult[s.type] || 1);
        return {
            q: tile.q, r: tile.r, settlement: s.name,
            fee, levy: fee * 4, mult: Titles.taxYieldMult(s, day),
            resentment: Titles.taxResentment(s, day),
            happiness: Math.round(typeof s.happiness === 'number' ? s.happiness : 50),
        };
    },

    /** The ways to collect, with the gold each brings: [{ id, fee, skim, levy, riotChance, happiness }]. */
    taxOptions(player, assessment) {
        const cfg = Titles._taxCfg();
        return Object.entries(cfg.modes).map(([id, m]) => ({
            id,
            fee: Math.max(1, Math.round(assessment.fee * m.fee * assessment.mult)),
            skim: m.skim ? Math.round(assessment.fee * m.skim * assessment.mult) : 0,
            levy: Math.round(assessment.levy * m.levy * assessment.mult),
            riotChance: id === 'squeeze' ? Math.min(0.6, cfg.riotPerResentment * assessment.resentment) : 0,
            happiness: m.happiness,
        }));
    },

    /**
     * Tax Collector: collect taxes at a settlement. mode: 'fair' (as of old),
     * 'squeeze' (more for the crown and you; the town is angered and stays
     * resentful — later collections there yield less and may riot), 'spare'
     * (spare the poor: less gold, the town warms to you), 'skim' (pocket
     * extra beyond your fee — the month's audit may find it). The collector
     * keeps the fee; the levy goes to the crown.
     */
    collectTaxAtSettlement(player, tile, world, mode = 'fair', assessment = null) {
        const block = Titles._taxBlock(player, tile);
        if (block) return { success: false, reason: block };
        const cfg = Titles._taxCfg();
        const m = cfg.modes[mode];
        if (!m) return { success: false, reason: 'Unknown way of collecting.' };
        const a = assessment || Titles.taxAssessment(player, tile, world);
        const opt = Titles.taxOptions(player, a).find(o => o.id === mode);
        const s = tile.settlement;
        const day = world && Number.isFinite(world.day) ? world.day : 0;
        const progress = player.titleProgress;
        const perks = Titles.getTitleDefinitions().tax_collector.perks;

        let fee = opt.fee;
        let riot = null;
        if (opt.riotChance > 0 && Utils.random() < opt.riotChance) {
            // The town has had enough: a crowd at the tax-house door
            fee = Math.round(fee / 2);
            const hurt = Utils.randInt(cfg.riotHealth[0], cfg.riotHealth[1]);
            player.health = Math.max(1, (player.health || 100) - hurt);
            s.happiness = _clampN((typeof s.happiness === 'number' ? s.happiness : 50) + cfg.riotHappiness, 0, 100);
            riot = { healthLost: hurt };
        }
        // A town with books can only pay what its purse holds: the fee comes first, then any skim
        let skim = opt.skim;
        const purse = s.economy && Number.isFinite(s.economy.gold) ? Math.max(0, Math.floor(s.economy.gold)) : null;
        if (purse != null) {
            fee = Math.min(fee, purse);
            skim = Math.min(skim, purse - fee);
        }
        player.gold += fee;
        Ledger.record(player, 'officeFees', fee);
        if (skim > 0) {
            player.gold += skim;
            progress.skimmed = (progress.skimmed || 0) + skim;
            Ledger.record(player, 'embezzlement', skim);
            Traits.recordDeeds(player, { greed: 1, deceit: 1 });
        }
        if (mode === 'squeeze') Traits.recordDeeds(player, { greed: 0.5, cruelty: 0.5 });
        if (mode === 'spare') Traits.recordDeeds(player, { mercy: 1 });

        // The town remembers
        s.happiness = _clampN((typeof s.happiness === 'number' ? s.happiness : 50) + m.happiness, 0, 100);
        const resentment = _clampN(Titles.taxResentment(s, day) + m.resentment, 0, cfg.maxResentment);
        s.crownLevy = { day, mode, resentment, by: player.name || 'the collector' };
        if (m.unrest && s.holding && typeof s.holding.unrest === 'number') s.holding.unrest = _clampN(s.holding.unrest + m.unrest, 0, 100);
        // A town the player does not hold has no holding unrest: the anger lands on its mood
        else if (m.unrest) s.happiness = _clampN(s.happiness - m.unrest * _num0(cfg.unheldUnrestHappiness), 0, 100);
        // A riot shuts the tax-house: the crown's own collectors are refused for a while (systems/fiscal.js reads taxRevolt)
        if (riot && cfg.riotRevoltDays > 0) s.taxRevolt = Math.max(_num0(s.taxRevolt), day + cfg.riotRevoltDays);

        // The crown's share reaches the treasury, out of the town's purse (no coin is minted):
        // the collector's fee is taken first, a skim comes out of the crown's levy
        const crown = Titles._payCrown(world, s, riot ? Math.round(opt.levy / 2) : opt.levy, fee, skim);

        if (player.reputation && m.rep) player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) + m.rep * (perks.reputationGain || 1);
        if (m.karma) player.karma = (player.karma || 0) + m.karma;
        if (m.renown) player.renown = (player.renown || 0) + m.renown;

        if (!progress.settlementsVisited) progress.settlementsVisited = [];
        progress.settlementsVisited.push(`${tile.q},${tile.r}`);
        progress.collectionsCompleted = (progress.collectionsCompleted || 0) + 1;
        progress.levyRaised = (progress.levyRaised || 0) + (riot ? Math.round(opt.levy / 2) : opt.levy);
        progress.crownPaid = (progress.crownPaid || 0) + crown;

        return {
            success: true, mode, gold: fee + skim, fee, skim, levy: opt.levy, crown,
            settlement: s.name, count: progress.collectionsCompleted, riot,
            happiness: Math.round(s.happiness), resentment,
        };
    },

    /**
     * Pay the crown its share of a collection: drawn from the town's purse
     * (settlement.economy.gold, as systems/fiscal.js collects) after the
     * collector's fee, less what was skimmed; credited to the kingdom's
     * treasury and booked on its tax lines (world/crownBooks.js). Returns the
     * gold the crown received.
     */
    _payCrown(world, s, levy, fee, skim) {
        const k = world && s && s.kingdom != null ? ((typeof world.getKingdom === 'function' && world.getKingdom(s.kingdom))
            || (world.kingdoms || []).find(x => x && x.id === s.kingdom)) : null;
        if (!k || !(levy > 0)) return 0;
        const e = s.economy;
        const purse = e && Number.isFinite(e.gold) ? Math.max(0, e.gold) : null;
        const cut = Math.max(0, _num0(fee)) + Math.max(0, _num0(skim));
        const want = Math.max(0, levy - Math.max(0, _num0(skim)));
        // The town pays the levy and the fee; a town without books pays what the rolls say
        const take = purse == null ? want + cut : Math.min(purse, want + cut);
        if (purse != null) e.gold = Math.round((purse - take) * 100) / 100;
        const paid = Math.max(0, Math.min(want, take - cut));
        if (!(paid > 0)) return 0;
        k.treasury = (Number.isFinite(k.treasury) ? k.treasury : 0) + paid;
        const lines = Titles._taxCfg().crownLines || {};
        const total = Object.values(lines).reduce((a, v) => a + (v > 0 ? v : 0), 0) || 1;
        for (const [line, w] of Object.entries(lines)) if (w > 0) CrownBooks.note(k, line, paid * w / total);
        return Math.round(paid);
    },

    /**
     * The month's audit of a collector who skimmed (rolled on its own seeded
     * stream). Exposed: repay (twice over), reputation and renown lost, and
     * it counts as a failed month. Returns null when nothing was skimmed.
     */
    _audit(player, world) {
        const skimmed = (player.titleProgress && player.titleProgress.skimmed) || 0;
        if (!(skimmed > 0)) return null;
        const A = Titles._taxCfg().audit;
        const commerce = (player.skills && player.skills.commerce) || 0;
        const chance = _clampN(A.base + skimmed * A.perGold - commerce * A.commerce, 0.02, A.max);
        const seed = (world && world.generationParams && world.generationParams.seed) || 0;
        const rng = Utils.seededRandom((_strHash(`${seed}:audit:${world ? world.day : 0}:${skimmed}`) % 233279) + 1);
        const exposed = rng() < chance;
        if (!exposed) return { exposed: false, skimmed, chance };
        const owed = skimmed * A.repay;
        const paid = Math.min(Math.max(0, Math.floor(player.gold || 0)), owed);
        player.gold -= paid;
        Ledger.record(player, 'fines', -paid);
        if (player.reputation && player.allegiance) {
            const short = owed > 0 ? (owed - paid) / owed : 0;
            player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) + Math.round(A.reputation * (1 + short));
        }
        player.renown = Math.max(0, (player.renown || 0) + A.renown);
        Traits.recordDeeds(player, { deceit: 1 });
        return { exposed: true, skimmed, owed, paid, chance };
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

        const perks = (Titles.getTitleDefinitions().jailer || {}).perks || {};
        const gp = perks.goldPerCapture || { min: 25, max: 60 };
        player.activeFugitive = {
            ...template,
            q: fq,
            r: fr,
            spawnDay: world.day,
            daysRemaining: 20 + Utils.randInt(0, 10),
            // The crown's warrant: paid on delivery (with the hunter's rank bonus, systems/bountyHunting.js)
            pay: Utils.randInt(gp.min, gp.max) + (template.reward || 0),
            warrantId: `warrant_${world.day}_${fq}_${fr}`,
            escapes: 0,
        };

        return { success: true, fugitive: player.activeFugitive };
    },

    /**
     * The jailer's fugitive as a BountyHunting criminal hunt (jailerWarrant):
     * captured with BountyHunting.attemptCapture and judged with its turn-in
     * or recruit choice (resolveCapturedTarget credits the jailer's duty).
     */
    fugitiveBounty(player, fug) {
        const perks = (Titles.getTitleDefinitions().jailer || {}).perks || {};
        const difficulty = Math.max(1, Math.min(10, fug.difficulty || 5));
        return {
            id: fug.warrantId || `warrant_${fug.spawnDay || 0}_${fug.q}_${fug.r}`,
            type: 'criminal_hunt',
            icon: fug.icon || '⛓️',
            name: `Warrant: ${fug.name}`,
            targetName: fug.name,
            targetBackstory: fug.backstory || `Wanted by the crown for ${fug.crime || 'crimes against the realm'}; the dungeons want them back.`,
            crime: fug.crime || 'crimes against the realm',
            notoriety: difficulty >= 8 ? 'dangerous' : 'wanted',
            difficulty,
            actualPay: fug.pay || ((perks.goldPerCapture && perks.goldPerCapture.min) || 25) + (fug.reward || 0),
            daysLimit: fug.daysRemaining || 10,
            daysElapsed: 0,
            fromSettlement: 'the royal dungeons',
            targetQ: fug.q, targetR: fug.r, lastKnownQ: fug.q, lastKnownR: fug.r,
            status: 'active',
            escapes: fug.escapes || 0,
            canRecruit: true,
            recruitedUnit: { name: fug.name, icon: fug.icon || '⛓️', strength: 8 + difficulty * 2, upkeep: 6 + Math.floor(difficulty / 2) },
            jailerWarrant: { karma: perks.karmaGain || 1, renown: perks.renownGain || 2, recruitKarma: 3 },
            description: `${fug.name} escaped the crown's dungeons.`,
        };
    },

    /**
     * Jailer: attempt to capture the fugitive (player must be on their tile),
     * as a bounty hunter would (BountyHunting.attemptCapture). Taken, the
     * fugitive awaits judgment among the player's bounties: turn them in
     * (the duty, the bounty, the jailer's perks) or recruit them.
     */
    captureFugitive(player, world) {
        if (!player.activeFugitive) return { success: false, reason: 'No active fugitive to capture.' };

        const fug = player.activeFugitive;
        if (player.q !== fug.q || player.r !== fug.r) {
            return { success: false, reason: `The fugitive is not here. Last seen near (${fug.q}, ${fug.r}).` };
        }

        const bounty = Titles.fugitiveBounty(player, fug);
        const capture = BountyHunting.attemptCapture(player, bounty, world);
        if (!capture.success) {
            // Fled: the hunt goes on where they ran
            fug.q = bounty.targetQ;
            fug.r = bounty.targetR;
            fug.escapes = bounty.escapes;
            return { success: false, escaped: true, reason: capture.reason || `${fug.name} fought free and fled toward (${fug.q}, ${fug.r}).` };
        }

        BountyHunting.initialize(player);
        player.activeBounties.push(bounty);
        player.activeFugitive = null;
        return { success: true, captured: true, bounty, fugitive: { ...fug } };
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

    _blessCfg() {
        return { ...BLESSING_DEFAULTS, ...((Titles._getData() || {}).blessing || {}) };
    },

    /** Is this settlement under a chaplain's blessing on `day`? */
    isBlessed(settlement, day) {
        const b = settlement && settlement.blessing;
        return !!(b && Number.isFinite(day) && day <= b.until);
    },

    /**
     * Sickness multiplier for someone in this settlement (read by
     * systems/ailments.js): a blessed town catches fewer fevers.
     */
    blessingSicknessMult(settlement, day) {
        return Titles.isBlessed(settlement, day) ? Titles._blessCfg().sicknessMult : 1;
    },

    /**
     * Court Chaplain: bless a settlement — its mood lifts and for a while its
     * people (and you among them) fall sick less often.
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

        const perks = (Titles.getActiveTitle(player) || {}).perks || {};
        player.karma = (player.karma || 0) + (perks.karmaPerBlessing || 2);
        player.renown = (player.renown || 0) + 1;

        if (!progress.settlementsBlesssed) progress.settlementsBlesssed = [];
        progress.settlementsBlesssed.push(sKey);

        if (player.reputation) {
            player.reputation[player.allegiance] = (player.reputation[player.allegiance] || 0) + 1;
        }

        // The town itself: happier, and spared some sickness for a while
        const cfg = Titles._blessCfg();
        const s = tile.settlement;
        const day = world && Number.isFinite(world.day) ? world.day : 0;
        s.happiness = _clampN((typeof s.happiness === 'number' ? s.happiness : 50) + cfg.happiness, 0, 100);
        s.blessing = { day, until: day + cfg.days, sicknessMult: cfg.sicknessMult, by: player.name || 'the chaplain' };

        return { success: true, settlement: s.name, count: progress.settlementsBlesssed.length, happiness: cfg.happiness, days: cfg.days, until: s.blessing.until };
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
     * Royal Cartographer: the crown pays a commission for each survey map drawn.
     * Returns the gold paid, or 0 when the player holds no such perk.
     */
    recordSurvey(player) {
        const title = Titles.getActiveTitle(player);
        const pay = title && title.perks && title.perks.goldPerSurvey;
        if (!pay) return 0;
        const gold = Utils.randInt(pay.min, pay.max);
        player.gold += gold;
        return gold;
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
        // The Chancellor's office raises its own pay ("allSalaryBonus")
        results.salary = Math.round((title.salary || 0) * (1 + ((title.perks && title.perks.allSalaryBonus) || 0)));
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
            // A collector who skimmed faces the month's audit (its own seeded stream)
            const audit = player.currentTitle === 'tax_collector' ? Titles._audit(player, world) : null;
            if (audit) results.audit = audit;
            const evaluation = Titles._evaluateDuties(player, title, world);
            if (audit && audit.exposed) {
                evaluation.passed = false;
                evaluation.progress = `${evaluation.progress || ''} — the audit found ${audit.skimmed} gold missing from the crown's books`.replace(/^ — /, '');
            }
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
    getDutyProgress(player, world = null) {
        if (!player.currentTitle) return null;
        const titles = Titles.getTitleDefinitions();
        const title = titles[player.currentTitle];
        if (!title) return null;

        const eval_ = Titles._evaluateDuties(player, title, { day: 0 });
        const daysLeft = Math.max(0, (player.titleDutyDeadline || 0) - (world ? world.day : 0));

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
