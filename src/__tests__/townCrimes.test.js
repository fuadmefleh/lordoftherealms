// Deplorable acts against a town (systems/townCrimes.js): a poisoned well
// sickens the roster and idles hands; a plague lie keeps the traders away and
// sends folk to the next town; a burnt granary destroys real stores and the
// crown buys grain dear; grain hoarded in a hungry town is bought and sold
// against the real market — and the town remembers. Seeded: the dice are
// passed in (or hashes of the world seed and day).
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { TownCrimes } from '../systems/townCrimes.js';
import { TownMemory } from '../systems/townMemory.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Illness } from '../systems/illness.js';
import { Underworld } from '../systems/underworld.js';
import { TownMarks } from '../world/townMarks.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { TownLabour } from '../world/townLabour.js';

const NEVER = () => 0.99; // never seen, never spreads
const ALWAYS = () => 0; // always seen, always named

function setup(seed = 21, withFolk = true) {
    const g = newGame(seed);
    const { world, player } = g;
    const towns = world.getSettlementViews().filter(s => s && s.kingdom && s.population >= 400).sort((a, b) => b.population - a.population);
    const s = towns[0];
    const other = towns.find(o => o !== s);
    Economy.initSettlement(s);
    SettlementMarket.ensure(s);
    if (!Number.isFinite(s.happiness)) s.happiness = 60;
    if (withFolk) Townsfolk.seed(s, world);
    player.q = s.q; player.r = s.r;
    player.gold = 2000;
    player.inventory = player.inventory || {};
    if (typeof player.actionPoints === 'number') player.actionPoints = 50;
    return { world, player, s, other };
}

function sickOf(s) {
    return Townsfolk.residents(s.folk).filter(p => p.ill && p.ill.k === 'flux').length;
}

describe('TownCrimes', () => {
    beforeAll(async () => { await loadData(); }, 60000);

    it('poisoning the well sickens the roster, keeps striking while foul, and the town remembers', () => {
        const { world, player, s } = setup(21);
        player.inventory.poison = 1;
        const happy = s.happiness;
        const res = TownCrimes.poisonWell(player, world, s, NEVER);
        expect(res.success).toBe(true);
        expect(res.named).toBe(false);
        expect(player.inventory.poison || 0).toBe(0);
        const first = sickOf(s);
        expect(first).toBeGreaterThan(0);
        expect(s.happiness).toBeLessThan(happy);
        expect(TownCrimes.wellFoul(s, world.day)).toBe(true);
        // A second dose is refused while it is foul
        player.inventory.poison = 1;
        expect(TownCrimes.poisonWell(player, world, s, NEVER).success).toBe(false);
        // The town's history keeps it (unnamed), and it weighs on its mood
        const mark = TownMarks.marks(s, 'crime')[0];
        expect(mark && mark.crime).toBe('well');
        expect(mark.by == null).toBe(true);
        expect(TownMemory.describe(s, world).some(l => /well of .* was poisoned/.test(l.text))).toBe(true);
        expect(TownMemory._mood(s, world.day)).toBeLessThan(0);
        // The hunt is on, but nobody saw: no name
        expect(s.townCrimes.hunt.seen).toBe(false);
        // The foul days strike more
        const struck = s.townCrimes.well.struck;
        for (let i = 0; i < 4; i++) { world.day++; TownCrimes.processDay(world, player); }
        expect(s.townCrimes.well.struck).toBeGreaterThan(struck);
    }, 120000);

    it('a town without a roster keeps an abstract sickness whose share idles its hands', () => {
        const { world, player, s } = setup(22, false);
        delete s.folk;
        player.inventory.meat = 4;
        const res = TownCrimes.poisonWell(player, world, s, NEVER);
        expect(res.success).toBe(true);
        expect(s.sickness && s.sickness.abs && s.sickness.k).toBe('flux');
        expect(s.sickness.share).toBeGreaterThan(0);
        expect(Illness.townSickness(s, world.day)).toBeTruthy();
        s.labour = s.labour || null;
        if (s.labour && s.labour.fill) {
            const f = TownLabour.factors(s, world.day);
            expect(f.craft).toBeLessThan(1);
        }
    }, 120000);

    it('named for the well: heat, a rumour, the town and the sick remember, the House pays in Prestige', () => {
        const { world, player, s } = setup(23);
        player.inventory.poison = 1;
        player.house.prestige = 100;
        const heat0 = Underworld.getHeat(player, s.kingdom);
        const res = TownCrimes.poisonWell(player, world, s, ALWAYS);
        expect(res.named).toBe(true);
        expect(Underworld.getHeat(player, s.kingdom)).toBeGreaterThan(heat0);
        expect(player.house.prestige).toBeLessThan(100);
        expect(player.house.history.some(h => (h.tags || []).includes('townCrime'))).toBe(true);
        expect((s.folk.nm || []).some(e => e.k === 'well_poisoned')).toBe(true);
        const sickRemember = s.townCrimes.well.cases.map(id => Townsfolk.get(s.folk, id)).filter(p => p && (p.nm || []).some(e => e.k === 'well_poisoned'));
        expect(sickRemember.length).toBeGreaterThan(0);
        expect((player.gossip.activeRumors || player.gossip.rumors || []).some(r => r.type === 'well_poisoning')).toBe(true);
        expect(TownMarks.marks(s, 'crime')[0].by).toBe(player.name);
        expect(s.townCrimes.hunt.named).toBe(true);
        // Staying in town, the watch takes you
        let taken = false;
        for (let i = 0; i < 40 && !taken; i++) { world.day++; TownCrimes.processDay(world, player); taken = !!player.jailState; }
        expect(taken).toBe(true);
    }, 120000);

    it('a plague lie keeps the traders away, sends folk to the next town, and they come home when it ends', () => {
        const { world, player, s, other } = setup(24);
        const pop = s.population;
        const popOther = (TownCrimes._nearestTown(world, s) || other).population;
        const gold = player.gold;
        const res = TownCrimes.spreadScare(player, world, s, NEVER);
        expect(res.success).toBe(true);
        expect(res.fled).toBeGreaterThan(0);
        expect(s.population).toBe(pop - res.fled);
        const to = TownCrimes._nearestTown(world, s);
        expect(to.population).toBe(popOther + res.fled);
        expect(player.gold).toBe(gold - TownCrimes.config().scare.cost); // the criers' pay (into the town's purse)
        expect(TownCrimes.shunFactor(world, { a: s, b: to })).toBeLessThan(0.5);
        // Fewer mouths over the same stores: bread is no dearer
        // (not marked in the town's history until it is known for a lie)
        expect(TownMarks.marks(s, 'crime').length).toBe(0);
        // Run its course
        s.townCrimes.scare.until = world.day;
        world.day++;
        TownCrimes.processDay(world, player);
        expect(s.townCrimes && s.townCrimes.scare).toBeFalsy();
        expect(s.population).toBe(pop);
        expect(TownCrimes.shunFactor(world, { a: s, b: to })).toBe(1);
    }, 120000);

    it('burning the granary destroys real stores; the crown buys grain at a premium from its treasury', () => {
        const { world, player, s } = setup(25);
        player.inventory.lamp_oil = 1;
        s.economy.food = 600;
        SettlementMarket.add(s, 'grain', 100);
        const grain0 = SettlementMarket.stock(s, 'grain');
        const res = TownCrimes.burnGranary(player, world, s, NEVER);
        expect(res.success).toBe(true);
        expect(s.economy.food).toBeLessThan(600 * 0.5);
        expect(SettlementMarket.stock(s, 'grain')).toBeLessThan(grain0);
        expect(TownMarks.marks(s, 'crime').some(m => m.crime === 'granary')).toBe(true);
        expect(TownCrimes.hungry(world, s)).toBeTruthy();
        const k = world.getKingdom(s.kingdom);
        k.treasury = 5000;
        expect(TownCrimes.crownWants(world, s)).toBeGreaterThan(1);
        player.inventory.grain = 10;
        const gold = player.gold;
        const stock = SettlementMarket.stock(s, 'grain');
        const sale = TownCrimes.sellToCrown(player, world, s, 10);
        expect(sale.success).toBe(true);
        expect(player.gold - gold).toBe(sale.earned);
        expect(k.treasury).toBe(5000 - sale.earned);
        expect(sale.earned).toBeGreaterThan(10 * TownCrimes.grainPrice(world, s) * 0.9);
        expect(SettlementMarket.stock(s, 'grain')).toBeCloseTo(stock + 10, 1);
        expect(player.inventory.grain || 0).toBe(0);
    }, 120000);

    it('grain hoarded in a hungry town is real stock bought and sold; selling it dear earns a lasting grudge', () => {
        const { world, player, s } = setup(26);
        // Not hungry: no point hoarding
        s.market.short = { ...(s.market.short || {}), food: 0 };
        expect(TownCrimes.canHoard(player, world, s).ok).toBe(false);
        // A dearth
        s.market.short.food = 0.95;
        SettlementMarket.add(s, 'grain', 200);
        const stock = SettlementMarket.stock(s, 'grain');
        const gold = player.gold;
        const purse = Economy.townPurse(s);
        const res = TownCrimes.hoardGrain(player, world, s, 40);
        expect(res.success).toBe(true);
        expect(res.bought).toBe(40);
        expect(SettlementMarket.stock(s, 'grain')).toBeCloseTo(stock - 40, 1);
        expect(gold - player.gold).toBe(res.spent);
        expect(Economy.townPurse(s) - purse).toBeCloseTo(res.spent, 1);
        const loft = TownCrimes.hoardAt(player, s);
        expect(loft.grain).toBe(40);
        // Bought cheap long ago: sold back dear in the dearth
        loft.paid = 20;
        s.economy.gold = 100000;
        const sale = TownCrimes.sellHoard(player, world, s, 40);
        expect(sale.success).toBe(true);
        expect(sale.grudge).toBe(true);
        expect((s.folk.nm || []).some(e => e.k === 'grain_hoarded')).toBe(true);
        expect(TownCrimes.hoardAt(player, s)).toBe(null);
    }, 120000);

    it('a crown ban on engrossing throws the loft open', () => {
        const { world, player, s } = setup(27);
        s.market.short = { ...(s.market.short || {}), food: 0.95 };
        SettlementMarket.add(s, 'grain', 200);
        expect(TownCrimes.hoardGrain(player, world, s, 30).success).toBe(true);
        world.engrossing = world.engrossing || {};
        world.engrossing.bans = { ...(world.engrossing.bans || {}), [s.kingdom]: world.day + 100 };
        expect(TownCrimes.canHoard(player, world, s).ok).toBe(false);
        const stock = SettlementMarket.stock(s, 'grain');
        world.day += 7;
        const out = TownCrimes.processDay(world, player);
        expect(TownCrimes.hoardAt(player, s)).toBe(null);
        expect(SettlementMarket.stock(s, 'grain')).toBeGreaterThan(stock + 25);
        expect(out.notices.some(n => /Loft/.test(n.title))).toBe(true);
    }, 120000);

    it('is reproducible for a seed', () => {
        const run = () => {
            const { world, player, s } = setup(28);
            player.inventory.poison = 1;
            let k = 0;
            const rnd = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
            const r = TownCrimes.poisonWell(player, world, s, rnd);
            for (let i = 0; i < 5; i++) { world.day++; TownCrimes.processDay(world, player); }
            return [r.seen, r.named, s.townCrimes.well.struck, sickOf(s)];
        };
        expect(run()).toEqual(run());
    }, 240000);
});
