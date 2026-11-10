// Real arms for the realms, arrows for the archers, gear for the rival
// retinues, and the hotbar's equip (world/realmArms.js, systems/arms.js ammo,
// systems/rivalHouses.js arms, Arms.toggleEquip). Seeded; every piece and
// coin is followed from where it comes to where it goes.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Arms } from '../systems/arms.js';
import { RealmArms } from '../world/realmArms.js';
import { CrownBooks } from '../world/crownBooks.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { HuntingBow } from '../player/huntingBow.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { RealmWars } from '../systems/realmWars.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => Utils.setSeed(2468));

const sum = (o) => Object.values(o || {}).reduce((s, v) => s + v, 0);

function realmGame(seed = 4242) {
    const game = newGame(seed);
    // (the towns open their markets on the first day)
    for (const v of game.world.getSettlementViews()) SettlementMarket.ensure(game.world.getTile(v.q, v.r).settlement);
    const k = game.world.kingdoms.find(x => x.isAlive && RealmArms._towns(x, game.world).length >= 2);
    return { ...game, k };
}

function townsGold(k, world) {
    for (const t of RealmArms._towns(k, world)) Economy.initSettlement(t.s);
    return RealmArms._towns(k, world).reduce((s, t) => s + (t.s.economy.gold || 0), 0);
}

function townsStock(k, world, ids) {
    return RealmArms._towns(k, world).reduce((s, t) => s + ids.reduce((a, id) => a + SettlementMarket.stock(t.s, id), 0), 0);
}

describe('the crowns\' armouries', () => {
    it('a realm starts with its arsenals full: fighting at about its full worth', () => {
        const { k } = realmGame();
        delete k.armoury;
        const a = RealmArms.state(k);
        const need = RealmArms.need(k);
        expect(sum(a.stock)).toBeGreaterThan(0);
        expect(RealmArms.held(k).main.n).toBeCloseTo(need.slots.main, 1);
        expect(RealmArms.factor(k)).toBeGreaterThan(0.93);
        expect(RealmArms.factor(k)).toBeLessThanOrEqual(1.05);
    });

    it('an unarmed realm fights weaker, never below the floor; a realm in mail better', () => {
        const { k } = realmGame();
        RealmArms.state(k);
        const full = RealmArms.factor(k);
        k.armoury.stock = {};
        const bare = RealmArms.factor(k);
        expect(bare).toBeLessThan(full);
        expect(bare).toBeGreaterThanOrEqual(RealmArms.config().minFactor);
        const need = RealmArms.need(k);
        k.armoury.stock = { weapons: need.slots.main, bow: need.slots.ranged, shield: need.slots.off, helmet: need.kits, chainmail: need.kits, arrows: need.ammo };
        expect(RealmArms.factor(k)).toBeGreaterThan(full);
    });

    it('archers without arrows are sticks: the factor falls with the quivers', () => {
        const { k } = realmGame();
        RealmArms.state(k);
        const f = RealmArms.factor(k);
        k.armoury.stock.arrows = 0;
        k.armoury.stock.bolts = 0;
        expect(RealmArms.factor(k)).toBeLessThan(f);
    });

    it('the crown buys what its army lacks out of its own towns\' stock: the treasury pays the towns\' purses, booked on the arms line', () => {
        const { k, world } = realmGame();
        RealmArms.state(k);
        k.armoury.stock.weapons = 0;
        k.armoury.stock.spear = 0;
        k.treasury = 50000;
        const t0 = k.treasury, g0 = townsGold(k, world), s0 = townsStock(k, world, ['weapons', 'spear']);
        const lineBefore = CrownBooks.state(k).day.arms || 0;
        const r = RealmArms.buy(k, world);
        expect(r.cost).toBeGreaterThan(0);
        const got = (r.bought.weapons || 0) + (r.bought.spear || 0);
        expect(got).toBeGreaterThan(0);
        // the pieces moved from the stalls to the arsenal, the coin from the treasury to the towns
        expect(townsStock(k, world, ['weapons', 'spear'])).toBeCloseTo(s0 - got, 1);
        expect(k.treasury).toBeCloseTo(t0 - r.cost, 1);
        expect(townsGold(k, world)).toBeCloseTo(g0 + r.cost, 1);
        expect((CrownBooks.state(k).day.arms || 0) - lineBefore).toBeCloseTo(r.cost, 1);
        expect(RealmArms.held(k).main.n).toBeCloseTo(got, 1);
    });

    it('a broke crown buys nothing; and never more than its share of a town\'s stock at once', () => {
        const { k, world } = realmGame();
        RealmArms.state(k);
        k.armoury.stock = {};
        k.treasury = 10;
        expect(RealmArms.buy(k, world).cost).toBe(0);
        k.treasury = 1e7;
        const before = RealmArms._towns(k, world).map(t => SettlementMarket.stock(t.s, 'weapons'));
        RealmArms.buy(k, world);
        RealmArms._towns(k, world).forEach((t, i) => {
            if (before[i] >= 2) expect(SettlementMarket.stock(t.s, 'weapons')).toBeGreaterThan(0);
        });
    });

    it('a battle: the fallen\'s arms are lost, the victor gathers some and strips the beaten; arrows are loosed', () => {
        const { world } = realmGame();
        const [a, b] = world.kingdoms.filter(x => x.isAlive);
        RealmArms.state(a); RealmArms.state(b);
        const before = { [a.id]: a.military, [b.id]: b.military };
        const aHeld0 = sum(a.armoury.stock), bHeld0 = sum(b.armoury.stock);
        const bArrows0 = b.armoury.stock.arrows || 0;
        const aArrows0 = (a.armoury.stock.arrows || 0) + (a.armoury.stock.bolts || 0);
        a.military = Math.floor(a.military * 0.95);
        b.military = Math.floor(b.military * 0.8);
        const out = RealmArms.battle(a, b, before);
        expect(sum(out[b.id].lost)).toBeGreaterThan(0);
        expect(sum(b.armoury.stock)).toBeLessThan(bHeld0);
        expect(out[a.id].stripped).toBeGreaterThan(0);
        expect(out[a.id].stripped).toBeLessThan(sum(out[b.id].lost));
        expect(b.armoury.stock.arrows || 0).toBeLessThan(bArrows0);
        // (the winner lost 5% of its men and stripped 30% of the loser's 20%: its pieces about even)
        const pieces = (k) => sum(k.armoury.stock) - (k.armoury.stock.arrows || 0) - (k.armoury.stock.bolts || 0);
        expect(Math.abs(pieces(a) - (aHeld0 - aArrows0))).toBeLessThan((aHeld0 - aArrows0) * 0.2);
    });

    it('a surplus (a demobilised army) is sold back to its towns, paid from their purses', () => {
        const { k, world } = realmGame();
        RealmArms.state(k);
        const need = RealmArms.need(k);
        k.armoury.stock.weapons = need.slots.main * 3;
        const t0 = k.treasury, g0 = townsGold(k, world);
        const r = RealmArms.sellSurplus(k, world);
        expect(r.sold.weapons).toBeGreaterThan(0);
        expect(k.treasury - t0).toBeCloseTo(r.earned, 1);
        expect(g0 - townsGold(k, world)).toBeCloseTo(r.earned, 1);
    });

    it('a host takes its share of the armoury and brings back what survives', () => {
        const { k } = realmGame();
        RealmArms.state(k);
        const held0 = sum(k.armoury.stock);
        const men = Math.round(k.military * 0.1);
        k.military -= men;
        const arms = RealmArms.detach(k, men);
        expect(sum(arms.stock)).toBeCloseTo(held0 * 0.1, 0);
        expect(arms.armed).toBeGreaterThan(0.9);
        RealmArms.attach(k, arms, 0.8);
        expect(sum(k.armoury.stock)).toBeCloseTo(held0 - sum(arms.stock) * 0.2, 0);
    });

    it('a war host against the player carries its arms: its strength is its men as armed', () => {
        const { k, world, player } = realmGame();
        RealmArms.state(k);
        k.armoury.stock = {};
        const rec = { id: 'wh_t', name: 'Test Host', q: 1, r: 1, targetQ: 2, targetR: 2, strength: 100, armed: RealmArms.factor({ ...k, military: k.military + 100 }) };
        const unit = RealmWars._spawnUnit(world, k, rec);
        expect(unit.strength).toBeLessThan(100);
        expect(player).toBeTruthy();
    });

    it('the daily turn keeps a realm armed and books the arms (KingdomAI.updateMilitary)', () => {
        const game = realmGame();
        const { k, world } = game;
        for (let d = 0; d < 9; d++) endDay(game);
        expect(k.armoury).toBeTruthy();
        expect(k.armoury.factor).toBeGreaterThan(0.6);
        expect(typeof KingdomAI.updateMilitary).toBe('function');
        expect(world.kingdoms.filter(x => x.isAlive).every(x => x.armoury && x.armoury.stock)).toBe(true);
    });
});

describe('arrows and bolts', () => {
    function archers(over = {}) {
        return {
            name: 'Tester', gold: 2000, health: 100, maxHealth: 100, strength: 6, intelligence: 5, charisma: 5, luck: 5,
            inventory: {}, maxInventory: 60, skills: { combat: 3, leadership: 1 }, army: [], ...over,
        };
    }
    const unit = (type, ammo) => ({ ...PlayerMilitary.makeArmyUnit(PlayerMilitary.UNIT_TYPES[type.toUpperCase()]), ammo });

    it('archers shoot arrows, crossbowmen bolts; a soldier none; a bow issued makes a bowman', () => {
        expect(Arms.ammoGood({ type: 'archer' })).toBe('arrows');
        expect(Arms.ammoGood({ type: 'crossbowman' })).toBe('bolts');
        expect(Arms.ammoGood({ type: 'soldier' })).toBeNull();
        expect(Arms.ammoGood({ type: 'scout', kit: { main: 'bow' } })).toBe('arrows');
        expect(Arms.ammoGood({ type: 'crossbowman', kit: { main: 'crossbow' } })).toBe('bolts');
    });

    it('an archer out of arrows fights much weaker, and the army\'s strength shows it', () => {
        const p = archers({ army: [unit('archer', 16)] });
        const full = PlayerMilitary.getArmyStrength(p);
        p.army[0].ammo = 0;
        const dry = PlayerMilitary.getArmyStrength(p);
        expect(dry).toBeLessThan(full * 0.5);
        expect(Arms.ammoFactor(p.army[0])).toBeCloseTo(Arms.dryMult(), 5);
    });

    it('a battle looses the quivers; the packs refill them; a won field gives some back', () => {
        const p = archers({ army: [unit('archer', 16), unit('crossbowman', 12)], inventory: { arrows: 4 } });
        const r = Arms.spendQuivers(p, { victory: true });
        expect(r.loosed.arrows).toBe(8);
        expect(r.loosed.bolts).toBe(6);
        expect(r.recovered.arrows).toBe(2);
        // 8 left + the 4 in the packs + the 2 picked up
        expect(p.army[0].ammo).toBe(14);
        expect(p.inventory.arrows || 0).toBe(0);
        // 6 left + the one bolt picked up
        expect(p.army[1].ammo).toBe(7);
    });

    it('on the battlefield, each company spends what its volleys loosed', () => {
        const a = unit('archer', 16);
        const p = archers({ army: [a] });
        expect(Arms.fieldVolleys([a])).toBe(Math.floor(16 / Arms.config().ammo.fieldVolley));
        const r = Arms.spendQuivers(p, { volleys: [{ units: [a], n: 10 }] });
        expect(r.loosed.arrows).toBe(Math.round(10 * Arms.config().ammo.fieldVolley));
        const r2 = Arms.spendQuivers(p, { volleys: [] });
        expect(r2.loosed.arrows || 0).toBe(0);
    });

    it('quivers are bought from the town\'s stock at its price into its purse', () => {
        const game = newGame(4242);
        const s = game.world.getSettlementViews().find(x => x.type === 'town' || x.type === 'city');
        const live = game.world.getTile(s.q, s.r).settlement;
        SettlementMarket.ensure(live);
        Economy.initSettlement(live);
        live.market.stock.arrows = 100;
        const p = archers({ army: [unit('archer', 0)] });
        const g0 = live.economy.gold, gold0 = p.gold;
        const r = Arms.supplyQuivers(p, { settlement: live, world: game.world, buy: true });
        expect(r.bought.arrows).toBe(16);
        expect(live.market.stock.arrows).toBeCloseTo(84, 5);
        expect(gold0 - p.gold).toBe(r.cost);
        expect(live.economy.gold - g0).toBeCloseTo(r.cost, 5);
    });

    it('a recruited archer is issued his quiver; a veteran with no quiver record keeps his own', () => {
        const p = archers({ inventory: { bow: 1, arrows: 30 } });
        const u = PlayerMilitary.makeArmyUnit(PlayerMilitary.UNIT_TYPES.ARCHER);
        p.army.push(u);
        Arms.issueKit(p, u, { recruit: true });
        expect(u.ammo).toBe(16);
        expect(p.inventory.arrows).toBe(14);
        const old = PlayerMilitary.makeArmyUnit(PlayerMilitary.UNIT_TYPES.ARCHER);
        expect(Arms.ammoFactor(old)).toBe(1);
        Arms.supplyQuivers(p, { units: [old] });
        expect(old.ammo).toBe(16);
    });

    it('the town fletcher makes arrows of wood, feathers and iron; the bolter bolts; feathers are a market good', () => {
        const rc = DataLoader._gamedata.markets.recipes;
        const f = rc.find(r => r.id === 'fletcher');
        expect(f.in).toHaveProperty('feather');
        expect(f.out).toHaveProperty('arrows');
        expect(rc.find(r => r.id === 'bolter').out).toHaveProperty('bolts');
        expect(rc.find(r => r.id === 'bowyer').out).toHaveProperty('bow');
        expect(SettlementMarket.tracks('feather')).toBe(true);
        expect(SettlementMarket.tracks('bolts')).toBe(true);
        const craft = DataLoader._gamedata.crafting;
        const list = Array.isArray(craft) ? craft : (craft.recipes || []);
        expect(list.some(r => r.result && r.result.bolts > 0)).toBe(true);
    });

    it('a crossbow hunter shoots bolts, a bowman arrows', () => {
        const p = archers({ inventory: { crossbow: 1, bolts: 3 } });
        const g = HuntingBow.gear(p);
        expect(g.ok).toBe(true);
        expect(g.weapon.item).toBe('crossbow');
        expect(HuntingBow.ammoOf(g.weapon)).toBe('bolts');
        const r = HuntingBow.loose(p, { dist: 3, alert: 0, species: null }, () => 0.99);
        expect(r.ok).toBe(true);
        expect(p.inventory.bolts).toBe(2);
        const q = archers({ inventory: { bow: 1, arrows: 2 } });
        HuntingBow.loose(q, { dist: 3, alert: 0, species: null }, () => 0.99);
        expect(q.inventory.arrows).toBe(1);
    });
});

describe('the rival retinues in harness', () => {
    function rival() {
        return { kingdomId: 'k1', name: 'House Test', houseKey: 'k1:0', guard: 0, renown: 0, gold: 3000, head: { intrigue: 4, martial: 6, age: 40, traits: [] } };
    }

    it('a household starts armed; hired guards come bare until the purse buys them kits', () => {
        const r = rival();
        const s0 = RivalHouses.strength(r);
        expect(RivalHouses.armsFactor(r)).toBeGreaterThan(0.9);
        r.guard = 6;
        expect(RivalHouses.armsFactor(r)).toBeLessThan(0.8);
        r.arms.stock = {};
        expect(RivalHouses.strength({ ...r, guard: 0, arms: { stock: {} } })).toBeLessThan(s0);
    });

    it('in a town the House buys its men\'s arms out of the stock, paying the town', () => {
        const game = newGame(4242);
        const s = game.world.getSettlementViews().find(x => x.type === 'town' || x.type === 'city');
        const live = game.world.getTile(s.q, s.r).settlement;
        SettlementMarket.ensure(live);
        Economy.initSettlement(live);
        live.market.stock.weapons = 20; live.market.stock.shield = 20; live.market.stock.helmet = 20; live.market.stock.gambeson = 20;
        const r = rival();
        r.guard = 4;
        RivalHouses.arms(r);
        const f0 = RivalHouses.armsFactor(r), gold0 = r.gold, town0 = live.economy.gold;
        const spent = RivalHouses._buyArms(game.world, r, live);
        expect(spent).toBeGreaterThan(0);
        expect(gold0 - r.gold).toBe(spent);
        expect(live.economy.gold - town0).toBeCloseTo(spent, 5);
        expect(RivalHouses.armsFactor(r)).toBeGreaterThan(f0);
        expect(RivalHouses.kitView(r).main).toBeTruthy();
    });

    it('their arms wear out, and a beaten retinue leaves arms behind', () => {
        const r = rival();
        const before = sum(RivalHouses.arms(r).stock);
        RivalHouses._wearArms(r);
        expect(sum(r.arms.stock)).toBeLessThan(before);
        r.arms.stock = { weapons: 10, shield: 10 };
        const dropped = RivalHouses._loseArms(r, 0.3);
        expect(dropped.weapons).toBe(3);
        expect(r.arms.stock.weapons).toBe(7);
        const p = { inventory: {}, maxInventory: 60 };
        const got = RivalHouses._armsToPlayer(p, dropped);
        expect(p.inventory.weapons).toBe(3);
        expect(got.shield).toBe(3);
    });

    it('the head duels in the House\'s best blade and harness', () => {
        const r = rival();
        r.arms = { stock: { steel_sword: 1, chainmail: 1, steel_helm: 1 } };
        const d = RivalHouses.duelist(r);
        expect(d.weapon).toMatch(/longsword/i);
        expect(d.armour).toBeGreaterThan(0.15);
    });
});

describe('equipping from the hotbar and the packs', () => {
    const p = () => ({ name: 'T', gold: 0, inventory: { iron_sword: 1, shield: 1, dane_axe: 1, helmet: 1, leather_cap: 1 }, maxInventory: 60 });

    it('a click takes a piece up in its slot; a second click puts it away', () => {
        const player = p();
        // (the best carried is worn of itself: the helm)
        expect(Arms.isEquipped(player, 'helmet')).toBe(true);
        const r0 = Arms.toggleEquip(player, 'leather_cap');
        expect(r0.success && r0.equipped).toBe(true);
        expect(Arms.isEquipped(player, 'helmet')).toBe(false);
        const r = Arms.toggleEquip(player, 'helmet');
        expect(r.success).toBe(true);
        expect(r.equipped).toBe(true);
        expect(r.text).toMatch(/head/);
        expect(Arms.isEquipped(player, 'helmet')).toBe(true);
        const r2 = Arms.toggleEquip(player, 'helmet');
        expect(r2.equipped).toBe(false);
        expect(Arms.equipped(player, 'head')).toBeNull();
    });

    it('a two-hander clears the shield and says so; a shield will not go on with it', () => {
        const player = p();
        Arms.equip(player, 'iron_sword');
        Arms.equip(player, 'shield');
        expect(Arms.isEquipped(player, 'shield')).toBe(true);
        const r = Arms.toggleEquip(player, 'dane_axe');
        expect(r.success).toBe(true);
        expect(r.text).toMatch(/both hands/);
        expect(Arms.equipped(player, 'off')).toBeNull();
        const r2 = Arms.toggleEquip(player, 'shield');
        expect(r2.success).toBe(false);
        expect(r2.reason).toMatch(/both hands/);
    });

    it('not arms: no equip', () => {
        expect(Arms.toggleEquip(p(), 'bread').success).toBe(false);
    });
});
