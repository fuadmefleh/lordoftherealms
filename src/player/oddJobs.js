// ============================================
// ODD JOBS — day labour in town, and the quick notices on the board
// ============================================
// The rules behind the Day Labour menu (ui/actionMenu/jobs.js only presents
// the jobs and runs the minigames, which give a 0–100 performance score).
//
//   Pay      the job's range (data/earlyJobs.json oddJobs) + the stat's
//            bonus, × performance, × the town's going wage for that kind of
//            work (world/townLabour.js: today's wage against the customary
//            one, a premium where the sector is short of hands) × the
//            season (harvest work pays with the size of the town's harvest,
//            world/harvests.js).
//   Training each job trains what it exercises (job.trains, or by its stat):
//            strength/intelligence/charisma build the attribute, combat and
//            stealth jobs the skill, a crier's day some commerce, a herald's
//            some diplomacy. XP accumulates on player.attrXp / player.skillXp;
//            each full measure raises the stat by 0.1 (cap 10). A job's
//            `practice` ({ smithing: 8 }) also gives practised-skill XP
//            (systems/practiceSkills.js) of that many per measure: the
//            smith's striker learns Smithing, the woodcutter Woodcutting, the
//            herb picker Foraging, a hauler Endurance (a gain { kind:
//            'practice', event } carries any level-up).
//   Labour   a land or craft job in a town short of hands does real work:
//            the goods it yields (job.good) join the town's market.
//   Bounties the board's instant notices are resolved here with the seeded
//            RNG (resolveInstantBounty).
// Every coin is recorded in the Ledger ('jobs', 'bounties').
// Domain rules: player / world / settlement are parameters; randomness via Utils.

import { Utils } from '../core/utils.js';
import { TownLabour } from '../world/townLabour.js';
import { Harvests } from '../world/harvests.js';
import { Seasons } from '../world/seasons.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Barter } from '../world/barter.js';
import { Ledger } from '../systems/ledger.js';
import { TradeSkills } from '../systems/tradeSkills.js';
import { Foraging, Hunting } from './foraging.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;

const ATTRS = ['strength', 'intelligence', 'charisma', 'faith', 'luck'];
const STAT_CAP = 10;

/** What a job exercises when it names no `trains` of its own. */
export const JOB_TRAINING = {
    strength: { attrs: { strength: 1 } },
    intelligence: { attrs: { intelligence: 1 } },
    charisma: { attrs: { charisma: 1 }, skills: { diplomacy: 0.3 } },
    stamina: { attrs: { strength: 0.6 } },
    combat: { skills: { combat: 1 }, attrs: { strength: 0.3 } },
    stealth: { skills: { stealth: 1 } },
};

export const OddJobs = {
    ATTRS,

    /** A stat's value the way the job menu reads it (attribute, skill, or an alias). */
    statValue(player, stat) {
        if (!player) return 5;
        if (player[stat] !== undefined && typeof player[stat] === 'number') return player[stat];
        if (player.skills && player.skills[stat] !== undefined) return player.skills[stat];
        if (stat === 'stamina') return _num(player.maxStamina, 5);
        if (stat === 'dexterity') return _num(player.luck, 5);
        return 5;
    },

    /** { attrs: { id: weight }, skills: { id: weight } } the job trains. */
    trainingFor(job) {
        if (job && job.trains && typeof job.trains === 'object') return job.trains;
        return JOB_TRAINING[job && job.stat] || JOB_TRAINING.strength;
    },

    /**
     * Experience for a day's work: difficulty × (0.5 + performance), spread
     * over what the job trains. Returns [{ id, kind, by }] for each stat that
     * rose.
     */
    train(player, job, scorePercent) {
        const amount = Math.max(1, _num(job && job.difficulty, 3)) * (0.5 + _clamp(_num(scorePercent), 0, 100) / 100) * 0.5;
        const gains = OddJobs.gainXp(player, OddJobs.trainingFor(job), amount);
        for (const [id, w] of Object.entries((job && job.practice) || {})) {
            const xp = _r2(amount * _num(w));
            if (!(xp > 0)) continue;
            // An old save's foraging / hunting trips count first, so this XP adds to them
            if (id === 'foraging') Foraging.skill(player);
            else if (id === 'hunting') Hunting.skill(player);
            const event = TradeSkills.gain(player, id, xp);
            gains.push({ id, kind: 'practice', by: xp, event });
        }
        return gains;
    },

    /** Add `amount` × weight XP to each trained stat; each measure (2 + value × 0.5) raises it by 0.1. */
    gainXp(player, trains, amount) {
        const gains = [];
        if (!player || !trains || !(amount > 0)) return gains;
        const bump = (kind, id, w) => {
            if (!(w > 0)) return;
            const holder = kind === 'attr' ? player : (player.skills || (player.skills = {}));
            const book = kind === 'attr'
                ? (player.attrXp || (player.attrXp = {}))
                : (player.skillXp || (player.skillXp = {}));
            book[id] = _r2(_num(book[id]) + amount * w);
            let by = 0;
            for (let guard = 0; guard < 20; guard++) {
                const value = _num(holder[id], kind === 'attr' ? 5 : 1);
                if (value >= STAT_CAP) { book[id] = 0; break; }
                const need = 2 + value * 0.5;
                if (book[id] < need) break;
                book[id] = _r2(book[id] - need);
                holder[id] = Math.min(STAT_CAP, Math.round((value + 0.1) * 100) / 100);
                by = _r2(by + 0.1);
            }
            if (by > 0) gains.push({ id, kind, by });
        };
        for (const [id, w] of Object.entries(trains.attrs || {})) if (ATTRS.includes(id)) bump('attr', id, _num(w));
        for (const [id, w] of Object.entries(trains.skills || {})) bump('skill', id, _num(w));
        return gains;
    },

    /**
     * What the town pays for this kind of work against the customary wage:
     * today's sector wage ÷ its base (0.6..2), × a premium where the sector
     * is short of hands. Jobs with no sector follow the artisans' wage index.
     */
    wageFactor(settlement, sector) {
        if (!settlement) return 1;
        const lab = settlement.labour;
        if (sector && lab && lab.wage && Number.isFinite(lab.wage[sector])) {
            const base = TownLabour.baseWage(settlement.type, sector);
            let f = base > 0 ? _clamp(lab.wage[sector] / base, 0.6, 2) : 1;
            const fill = lab.fill && Number.isFinite(lab.fill[sector]) ? lab.fill[sector] : 1;
            if (fill < 1) f *= 1 + (1 - fill) * 0.5;
            return _r2(f);
        }
        if (Number.isFinite(settlement.wageIndex)) return _r2(_clamp(settlement.wageIndex, 0.6, 2));
        return 1;
    },

    /** Harvest work in autumn pays with the size of the town's harvest (a bumper year wants more hands). */
    seasonFactor(world, settlement, job) {
        if (!job || !job.harvest || !world || !Number.isFinite(world.day)) return 1;
        if (Seasons.seasonOf(world.day) !== 'Autumn') return 1;
        return _r2(_clamp(Harvests.grainFactor(settlement), 0.6, 1.5));
    },

    /** The day's pay: { pay, base, statBonus, quality, wage, season }. Draws one roll (Utils). */
    payFor(player, world, settlement, job, scorePercent) {
        const min = Math.max(1, Math.floor(_num(job && job.pay && job.pay.min, 10)));
        const max = Math.max(min, Math.floor(_num(job && job.pay && job.pay.max, min)));
        const base = Utils.randInt(min, max);
        const statBonus = Math.floor(OddJobs.statValue(player, job.stat) * 1.5);
        const quality = 0.3 + _clamp(_num(scorePercent), 0, 100) / 100;
        const wage = OddJobs.wageFactor(settlement, job.sector);
        const season = OddJobs.seasonFactor(world, settlement, job);
        const pay = Math.max(1, Math.floor((base + statBonus) * quality * wage * season));
        return { pay, base, statBonus, quality: _r2(quality), wage, season };
    },

    /**
     * A day's labour in a town short of hands is real work: the job's goods
     * (job.good × job.output, scaled by performance) join the town's market.
     * Returns { good, qty } or null.
     */
    contribute(settlement, job, scorePercent) {
        if (!settlement || !job || !job.good || !job.sector) return null;
        const lab = settlement.labour;
        const fill = lab && lab.fill && Number.isFinite(lab.fill[job.sector]) ? lab.fill[job.sector] : 1;
        if (fill >= 1) return null; // enough hands already: you only took a local's place
        const qty = _r2(Math.max(1, _num(job.output, 1)) * (0.5 + _clamp(_num(scorePercent), 0, 100) / 100));
        return SettlementMarket.add(settlement, job.good, qty) > 0 ? { good: job.good, qty } : null;
    },

    /**
     * Finish a day's labour: pay (into the Ledger as 'jobs'), renown for good
     * work, training, the town's own gain. Returns { pay, factors, gains,
     * contribution, renown }.
     */
    complete(player, world, settlement, job, scorePercent) {
        const factors = OddJobs.payFor(player, world, settlement, job, scorePercent);
        // The town's employers pay out of its purse: a broke town pays what it can
        const owed = factors.pay;
        if (Barter.paysInKind(player, settlement)) {
            // A barter town pays in goods out of its stores (world/barter.js)
            factors.pay = Math.floor(Barter.townPays(player, settlement, owed));
        } else {
            const can = Economy.townPurse(settlement);
            factors.pay = can == null ? owed : Math.min(owed, Math.floor(can));
            Economy.drawTown(settlement, factors.pay);
            player.gold = _num(player.gold) + factors.pay;
        }
        if (factors.pay < owed) factors.short = owed - factors.pay;
        if (factors.pay > 0) Ledger.record(player, 'jobs', factors.pay);
        const renown = scorePercent >= 40 ? 1 : 0;
        player.renown = _num(player.renown) + renown;
        player.jobsCompleted = _num(player.jobsCompleted) + 1;
        const gains = OddJobs.train(player, job, scorePercent);
        const contribution = OddJobs.contribute(settlement, job, scorePercent);
        return { pay: factors.pay, factors, gains, contribution, renown };
    },

    /**
     * What a town can pay of `amount` (whole gold): its purse, or all of it
     * when the place keeps no purse.
     */
    townCanPay(settlement, amount) {
        const want = Math.max(0, Math.floor(_num(amount)));
        const can = Economy.townPurse(settlement);
        return can == null ? want : Math.min(want, Math.floor(can));
    },

    /**
     * A town pays the player (a bounty, a busker's hat, a reward): out of its
     * purse, as much as it holds. → the gold paid.
     */
    payFromTown(player, settlement, amount) {
        // (a barter town pays in goods out of its stores: world/barter.js)
        if (Barter.paysInKind(player, settlement)) return Math.floor(Barter.townPays(player, settlement, Math.max(0, Math.floor(_num(amount)))));
        const pay = OddJobs.townCanPay(settlement, amount);
        if (!(pay > 0)) return 0;
        Economy.drawTown(settlement, pay);
        player.gold = _num(player.gold) + pay;
        return pay;
    },

    /**
     * An instant notice (pests in the granary…): a roll of d10 under the
     * stat + 3. Success pays (Ledger 'bounties') and +2 renown; failure
     * costs 5–14 health. Returns { success, pay, damage, statVal }.
     */
    resolveInstantBounty(player, bounty, settlement = null) {
        const stat = (bounty && bounty.stat) || 'combat';
        const statVal = OddJobs.statValue(player, stat);
        const success = Utils.random() * 10 < statVal + 3;
        if (success) {
            // (the town that posted the notice pays, out of its purse)
            const pay = OddJobs.payFromTown(player, settlement, Math.max(0, Math.floor(_num(bounty.actualPay))));
            player.renown = _num(player.renown) + 2;
            Ledger.record(player, 'bounties', pay);
            OddJobs.gainXp(player, JOB_TRAINING[stat] || JOB_TRAINING.combat, 1);
            return { success: true, pay, damage: 0, statVal };
        }
        const damage = Utils.randInt(5, 14);
        player.health = Math.max(1, _num(player.health, 100) - damage);
        return { success: false, pay: 0, damage, statVal };
    },
};
