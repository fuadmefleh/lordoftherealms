/**
 * Personal crafting (player/crafting.js), odd jobs (player/oddJobs.js),
 * mercenary contracts (player/mercContracts.js) and preaching
 * (PlayerReligion.preach). All seeded.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Crafting } from '../player/crafting.js';
import { OddJobs } from '../player/oddJobs.js';
import { MercContracts } from '../player/mercContracts.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Ailments } from '../systems/ailments.js';
import { Religion } from '../systems/religion.js';
import { Seasons } from '../world/seasons.js';
import { TownLabour } from '../world/townLabour.js';
import { SettlementMarket } from '../world/settlementMarket.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(4242));

function crafter(over = {}) {
    return {
        gold: 100, health: 60, maxHealth: 100, strength: 5, intelligence: 5, charisma: 5, faith: 5, luck: 5,
        renown: 0, karma: 0, inventory: {}, maxInventory: 20, reputation: {},
        skills: { commerce: 1, combat: 1, leadership: 1, diplomacy: 1, stealth: 1, cartography: 0 },
        ...over,
    };
}

// ── Crafting ──────────────────────────────────────────

describe('crafting recipes are data-driven', () => {
    it('loads every station from data/crafting.json', () => {
        for (const st of ['cook', 'craft', 'smelt', 'brew', 'tan']) expect(Crafting.recipes(st).length, st).toBeGreaterThan(0);
        expect(Crafting.recipes().length).toBeGreaterThanOrEqual(35);
    });

    it('the antidote is its own remedy, not a healing potion', () => {
        expect(Crafting.recipe('antidote').result).toEqual({ antidote: 1 });
        expect(Crafting.recipe('cooked_fish').result).toEqual({ cooked_fish: 1 });
        const rem = Ailments.cfg().remedies.antidote;
        expect(rem.cures).toContain('flux');
    });

    it('new recipes use the economy\'s goods (leather, linen, bronze, tools)', () => {
        const outs = Crafting.recipes().flatMap(r => Object.keys(r.result));
        for (const g of ['leather', 'linen', 'bronze', 'tools', 'clothes', 'textiles']) expect(outs, g).toContain(g);
    });
});

describe('crafting odds, failure and quality', () => {
    it('rank, workshop, tools and the forge raise quality and cut failure', () => {
        const r = Crafting.recipe('weapons_forge');
        const novice = Crafting.odds(crafter(), r, { forgeScore: 10 });
        const master = Crafting.odds(crafter({ crafting: { xp: 400 }, inventory: { tools: 1 } }), r, { building: { type: 'blacksmith', isPlayerOwned: true }, forgeScore: 95 });
        expect(master.fail).toBeLessThan(novice.fail);
        expect(master.score).toBeGreaterThan(novice.score + 2);
        expect(master.tier).toBeGreaterThan(novice.tier);
        expect(Crafting.rank(crafter({ crafting: { xp: 400 } })).name).toBe('Master Artisan');
    });

    it('a failed attempt wastes part of the inputs; a success yields goods at a tier', () => {
        let failures = 0, successes = 0;
        for (let i = 0; i < 40; i++) {
            const p = crafter({ inventory: { iron_ingot: 1, wood: 1 } });
            const res = Crafting.craft(p, 'weapons_forge', { forgeScore: 20 });
            if (res.failed) {
                failures++;
                expect(Object.keys(res.lost).length).toBeGreaterThan(0);
                expect(p.inventory.weapons).toBeUndefined();
                expect(p.crafting.xp).toBeGreaterThan(0);
            } else {
                successes++;
                expect(p.inventory.weapons).toBe(2);
                expect(p.inventory.iron_ingot).toBeUndefined();
                expect(p.craftQuality.weapons.n).toBe(2);
            }
        }
        expect(failures).toBeGreaterThan(0);
        expect(successes).toBeGreaterThan(0);
    });

    it('is reproducible for a seed', () => {
        const run = () => {
            Utils.setSeed(99);
            const p = crafter({ inventory: { herbs: 20, mushrooms: 10 } });
            const out = [];
            for (let i = 0; i < 6; i++) { const r = Crafting.craft(p, 'antidote'); out.push(r.failed ? 'x' : r.tier); }
            return out.join(',');
        };
        expect(run()).toBe(run());
    });

    it('an undone craft (packs full) loses nothing', () => {
        const p = crafter();
        let res;
        for (let s = 1; s < 50; s++) {
            Utils.setSeed(s);
            p.inventory = { hide: 4, salt: 2, wood: 1 };
            p.maxInventory = 3;
            res = Crafting.craft(p, 'tan_hides');
            if (!res.failed) break;
        }
        expect(res.full).toBe(true);
        expect(p.inventory).toEqual({ hide: 4, salt: 2, wood: 1 });
    });

    it('quality prices sales and scales effects; units drawn down pro rata', () => {
        const p = crafter({ inventory: { leather_armor: 1 } });
        const common = PlayerEffects.personalDamageMultiplier(p);
        p.inventory.leather_armor = 0;
        p.inventory.leather_armor = 1;
        Crafting.noteQuality(p, 'leather_armor', 1, 3);
        expect(Crafting.saleMult(p, 'leather_armor')).toBeCloseTo(1.8);
        expect(Crafting.qualityLabel(p, 'leather_armor')).toBe('Masterwork');
        expect(PlayerEffects.personalDamageMultiplier(p)).toBeLessThan(common);
        // Half the stack ordinary: the average falls between
        p.inventory.leather_armor = 2;
        expect(Crafting.averageTier(p, 'leather_armor')).toBeCloseTo(2);
        expect(Crafting.takeForSale(p, 'leather_armor', 1)).toBeGreaterThan(1);
        expect(p.craftQuality.leather_armor.n).toBeCloseTo(0.5);
    });

    it('an antidote purges the flux outright', () => {
        const p = crafter({ inventory: { antidote: 1 } });
        const world = { day: 5 };
        Ailments.inflict(p, world, 'flux');
        const rec = Ailments.list(p).find(a => a.id === 'flux');
        expect(rec).toBeTruthy();
        const res = Ailments.useRemedy(p, world, 'antidote', rec.key);
        expect(res.success).toBe(true);
        expect(res.cured).toBe(true);
        expect(Ailments.has(p, 'flux')).toBe(false);
        expect(p.inventory.antidote).toBeUndefined();
    });
});

// ── Odd jobs ──────────────────────────────────────────

function town(over = {}) {
    const s = { name: 'Testford', type: 'town', population: 2000, kingdom: null, ...over };
    TownLabour.ensure(s);
    return s;
}

describe('odd jobs', () => {
    it('train the attribute or skill the job uses', () => {
        const p = crafter();
        const job = { id: 'mason_helper', stat: 'strength', difficulty: 5, pay: { min: 20, max: 40 } };
        for (let i = 0; i < 6; i++) OddJobs.train(p, job, 80);
        expect(p.strength).toBeGreaterThan(5);
        const fighter = crafter();
        for (let i = 0; i < 6; i++) OddJobs.train(fighter, { stat: 'combat', difficulty: 6 }, 80);
        expect(fighter.skills.combat).toBeGreaterThan(1);
        const crier = crafter();
        const jobs = DataLoader.earlyJobs.oddJobs.settlement_jobs.town;
        const mc = jobs.find(j => j.id === 'market_crier');
        for (let i = 0; i < 10; i++) OddJobs.train(crier, mc, 90);
        expect(crier.charisma).toBeGreaterThan(5);
        expect(crier.skills.commerce).toBeGreaterThan(1);
    });

    it('pay follows the town\'s going wage', () => {
        const job = { stat: 'strength', sector: 'craft', difficulty: 3, pay: { min: 20, max: 20 } };
        const cheap = town();
        const dear = town();
        dear.labour.wage.craft = TownLabour.baseWage('town', 'craft') * 1.8;
        dear.labour.fill.craft = 0.6;
        const a = OddJobs.payFor(crafter(), { day: 1 }, cheap, job, 60).pay;
        const b = OddJobs.payFor(crafter(), { day: 1 }, dear, job, 60).pay;
        expect(b).toBeGreaterThan(a * 1.5);
    });

    it('harvest work in autumn pays with the harvest', () => {
        let autumn = 1;
        while (Seasons.seasonOf(autumn) !== 'Autumn') autumn++;
        const s = town({ farm: { mix: { grain: 1, veg: 0 }, ref: { grain: 1, veg: 0 }, y: { grain: 1.3, veg: 1 } } });
        const reaper = { harvest: true };
        expect(OddJobs.seasonFactor({ day: autumn }, s, reaper)).toBeGreaterThan(1);
        expect(OddJobs.seasonFactor({ day: autumn }, s, {})).toBe(1);
        expect(OddJobs.seasonFactor({ day: 1 }, s, reaper)).toBe(1);
    });

    it('a short-handed town gets the goods of your labour; the Ledger records the pay', () => {
        const s = town();
        SettlementMarket.ensure(s);
        s.labour.fill.land = 0.5;
        const before = SettlementMarket.stock ? SettlementMarket.stock(s, 'grain') : (s.market.stock.grain || 0);
        const p = crafter();
        const res = OddJobs.complete(p, { day: 3 }, s, { stat: 'strength', sector: 'land', good: 'grain', output: 2, difficulty: 3, pay: { min: 10, max: 20 } }, 70);
        expect(res.contribution).toBeTruthy();
        expect((s.market.stock.grain || 0)).toBeGreaterThan(before);
        expect(p.financeToday.income.jobs).toBe(res.pay);
        expect(p.jobsCompleted).toBe(1);
        // A town with hands to spare gets nothing extra
        const full = town();
        expect(OddJobs.contribute(full, { good: 'grain', sector: 'land' }, 70)).toBe(null);
    });

    it('instant bounties roll on the seeded RNG', () => {
        const run = () => {
            Utils.setSeed(7);
            const p = crafter();
            return [0, 1, 2, 3, 4].map(() => OddJobs.resolveInstantBounty(p, { actualPay: 30, stat: 'combat' }).success).join();
        };
        expect(run()).toBe(run());
        Utils.setSeed(3);
        const strong = crafter({ skills: { combat: 10 } });
        const res = OddJobs.resolveInstantBounty(strong, { actualPay: 30, stat: 'combat' });
        expect(res.success).toBe(true);
        expect(strong.financeToday.income.bounties).toBe(30);
    });
});

// ── Mercenary contracts ───────────────────────────────

function soldier(strength = 10) {
    return { type: 'infantry', domain: 'land', strength, level: 1, experience: 0, upkeep: 1 };
}

function army(n, str = 10) {
    return Array.from({ length: n }, () => soldier(str));
}

const sumStrength = (p) => p.army.reduce((a, u) => a + u.strength, 0);
const BANDITS = { id: 'bandit_hunt', name: 'Bandit Hunt', icon: '🗡️', payment: 200, duration: 5, minStrength: 50, risk: 0.3 };

function runContract(p, world, contract = BANDITS) {
    const res0 = MercContracts.accept(p, contract, { name: 'Testford', kingdom: 'k1' }, sumStrength(p));
    expect(res0.success).toBe(true);
    let res = null;
    for (let d = 0; d < 20 && p.activeContract; d++) {
        world.day++;
        res = MercContracts.tick(p, world, sumStrength);
    }
    return res;
}

describe('mercenary contracts', () => {
    it('resolve by army strength against the opposition', () => {
        let strongWins = 0, weakWins = 0, strongLost = 0, weakLost = 0;
        for (let s = 1; s <= 30; s++) {
            const k1 = { id: 'k1', name: 'Kingdom One', treasury: 100000 };
            const world = { day: 0, getKingdom: id => (id === 'k1' ? k1 : null) };
            Utils.setSeed(s);
            const strong = crafter({ army: army(20, 10) });
            const a = runContract(strong, world);
            if (a.success) strongWins++;
            strongLost += a.casualties;
            Utils.setSeed(s);
            const weak = crafter({ army: army(5, 10) });
            const b = runContract(weak, world);
            if (b.success) weakWins++;
            weakLost += b.casualties / 5;
        }
        expect(strongWins).toBeGreaterThan(weakWins + 6);
        expect(weakLost).toBeGreaterThan(strongLost / 20);
    });

    it('pays into the Ledger and builds standing with the employer', () => {
        Utils.setSeed(11);
        const k1 = { id: 'k1', name: 'Kingdom One', treasury: 100000 };
        const world = { day: 0, getKingdom: id => (id === 'k1' ? k1 : null) };
        const p = crafter({ army: army(30, 10) });
        const res = runContract(p, world);
        expect(res.completed).toBe(true);
        if (res.success) {
            expect(p.mercRep.k1).toBeGreaterThan(0);
            expect(res.payment).toBeGreaterThan(0);
        }
        expect(p.financeToday.income.contracts).toBe(res.payment + res.loot);
        expect(k1.treasury).toBe(100000 - res.payment);
    });

    it('a realm with a grudge will not hire you; a good name raises the fee', () => {
        const p = crafter({ army: army(10), mercRep: { k1: -40 } });
        expect(MercContracts.accept(p, BANDITS, { name: 'X', kingdom: 'k1' }, 100).success).toBe(false);
        const q = MercContracts.quote(crafter({ mercRep: { k1: 20 } }), BANDITS, { kingdom: 'k1' });
        expect(q.payment).toBeGreaterThan(BANDITS.payment);
    });

    it('events happen on the march, and an army wiped out abandons the contract', () => {
        let events = 0;
        for (let s = 1; s <= 20; s++) {
            Utils.setSeed(s);
            const world = { day: 0, getKingdom: () => null };
            const p = crafter({ army: army(12, 10) });
            MercContracts.accept(p, { ...BANDITS, duration: 10, risk: 0.6 }, { name: 'X', kingdom: null }, sumStrength(p));
            for (let d = 0; d < 9; d++) {
                const r = MercContracts.tick(p, world, sumStrength);
                if (r && r.event) events++;
                if (!p.activeContract) break;
            }
        }
        expect(events).toBeGreaterThan(5);
        const p = crafter({ army: army(6) });
        MercContracts.accept(p, BANDITS, { name: 'X', kingdom: 'k1' }, 60);
        p.army = [];
        const r = MercContracts.tick(p, { day: 1 }, sumStrength);
        expect(r.outcome).toBe('abandoned');
        expect(p.mercRep.k1).toBeLessThan(0);
    });

    it('PlayerMilitary.updateContract drives it to the end', () => {
        Utils.setSeed(5);
        const p = crafter({ army: army(20, 10) });
        expect(PlayerMilitary.acceptContract(p, 'guard_duty', { name: 'Testford', kingdom: null }).success).toBe(true);
        let res = null;
        for (let i = 0; i < 10 && p.activeContract; i++) res = PlayerMilitary.updateContract(p, { day: i });
        expect(res.completed).toBe(true);
        expect(p.activeContract).toBe(null);
    });
});

// ── Preaching ─────────────────────────────────────────

function believer(over = {}) {
    return crafter({ religion: { name: 'The Way', followers: 0, influence: 0, tenets: [], presence: {} }, ...over });
}

function preachWorld(kingdom) {
    const s = { name: 'Abbeyton', type: 'town', population: 3000, kingdom: kingdom ? kingdom.id : null };
    const tile = { q: 3, r: 4, settlement: s };
    const world = { day: 10, getKingdom: id => (kingdom && id === kingdom.id ? kingdom : null), getTile: () => tile };
    return { s, tile, world };
}

function faithBy(pick) {
    const ids = Object.keys(Religion.FAITHS || {});
    return ids.sort((a, b) => pick * ((Religion.FAITHS[a].virtues.militancy || 0) - (Religion.FAITHS[b].virtues.militancy || 0)))[0];
}

describe('preaching', () => {
    it('one sermon a day, and a town tires of the same preacher', () => {
        const { s, tile, world } = preachWorld(null);
        const p = believer();
        const first = PlayerReligion.preach(p, s, tile, world);
        expect(first.success).toBe(true);
        expect(PlayerReligion.preach(p, s, tile, world).success).toBe(false);
        world.day += 1;
        const second = PlayerReligion.preach(p, s, tile, world);
        expect(second.success).toBe(true);
        expect(second.followersGained).toBeLessThan(first.followersGained);
        // Rest restores the crowd
        world.day += 40;
        expect(PlayerReligion.sermonSaturation(p, tile.q, tile.r, world.day)).toBe(0);
    });

    it('faith spreads best where the state church is lax', () => {
        const fid = faithBy(1);
        const lax = { id: 'k1', name: 'Lax', isAlive: true, religion: { faithId: fid, piety: 5 } };
        const zealous = { id: 'k1', name: 'Zealous', isAlive: true, religion: { faithId: fid, piety: 95 } };
        const a = preachWorld(lax);
        const b = preachWorld(zealous);
        Utils.setSeed(1);
        const ra = PlayerReligion.preach(believer({ gold: 0 }), a.s, a.tile, a.world);
        Utils.setSeed(1);
        const rb = PlayerReligion.preach(believer({ gold: 0 }), b.s, b.tile, b.world);
        expect(ra.followersGained).toBeGreaterThan(rb.followersGained);
        expect(ra.alms).toBeGreaterThanOrEqual(0);
    });

    it('a militant clergy fines, denounces and in the end bans the preacher', () => {
        const fid = faithBy(-1);
        const k = { id: 'k9', name: 'Holy Realm', isAlive: true, religion: { faithId: fid, piety: 90 } };
        const { s, tile, world } = preachWorld(k);
        const p = believer({ gold: 5000 });
        let fined = 0, banned = false;
        for (let d = 0; d < 60 && !banned; d++) {
            world.day++;
            const r = PlayerReligion.preach(p, s, tile, world);
            if (!r.success) { banned = /banned/.test(r.reason); continue; }
            if (r.clergy) {
                fined += r.clergy.fine;
                if (r.clergy.bannedUntil) banned = true;
            }
        }
        expect(fined).toBeGreaterThan(0);
        expect(banned).toBe(true);
        expect(p.reputation.k9).toBeLessThan(0);
        expect(p.financeToday.expenses.fines).toBe(fined);
        const r = PlayerReligion.preach(p, s, tile, { ...world, day: world.day + 1 });
        expect(r.success).toBe(false);
    });

    it('still works without a world (no cooldown or church)', () => {
        const { s, tile } = preachWorld(null);
        const p = believer();
        expect(PlayerReligion.preach(p, s, tile).success).toBe(true);
        expect(PlayerReligion.preach(p, s, tile).success).toBe(true);
    });
});
