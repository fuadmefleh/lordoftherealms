/**
 * Hollow loot and resources, made real:
 *  - every loot id a world unit can carry (legendary-creature hoards, envoy
 *    gifts, pilgrim and smuggler goods) is a defined, sellable good, and the
 *    treasures among them do something (carried bonuses, lord gifts,
 *    House Prestige, consumables);
 *  - coal, oil and cattle produce goods and help the properties that use them;
 *  - the goods / military / trade / construction resource bonuses in
 *    data/economy.json are applied (settlement output, recruitment, trade
 *    income, build cost and time).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { WorldUnit } from '../world/units.js';
import { Economy } from '../world/economy.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Treasures } from '../player/treasures.js';
import { House } from '../systems/house.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Technology } from '../systems/technology.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

/** A small flat world; `resources` maps "q,r" → resource id. */
function makeWorld(resources = {}, { settlementAt = null, settlement = null } = {}) {
    const tiles = new Map();
    const tile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) {
            tiles.set(key, {
                q, r,
                terrain: { id: 'plains', passable: true },
                resource: resources[key] ? { id: resources[key] } : null,
                settlement: null, playerProperties: null, playerProperty: null, hasRiver: false,
            });
        }
        return tiles.get(key);
    };
    const world = { width: 60, height: 60, day: 1, events: [], units: [], getTile: tile, getKingdom: () => null };
    if (settlementAt) {
        const t = tile(settlementAt.q, settlementAt.r);
        t.settlement = { name: 'Testford', type: 'town', population: 2000, q: settlementAt.q, r: settlementAt.r, ...(settlement || {}) };
    }
    return world;
}

function makePlayer(overrides = {}) {
    return {
        name: 'Ash', q: 0, r: 0, gold: 100000, karma: 0, renown: 0, health: 50, maxHealth: 100,
        inventory: {}, properties: [], reputation: {}, blessings: {},
        skills: { combat: 1, commerce: 0, leadership: 1, diplomacy: 0, stealth: 1 },
        army: [], colonies: [],
        ...overrides,
    };
}

describe('loot items are real goods', () => {
    const lootIds = () => {
        const ids = new Set();
        for (const theme of Object.values(WorldUnit.THEMES)) {
            for (const [key, val] of Object.entries(theme)) {
                if (key === 'gold') continue;
                if (key === 'randomItem') val.choices.forEach(c => ids.add(c));
                else ids.add(key);
            }
        }
        return [...ids];
    };

    it('every item a world unit can carry has a name, icon and price', () => {
        const ids = lootIds();
        for (const id of ['dragon_scale', 'enchanted_weapon', 'ancient_artifact', 'royal_seal', 'treaty', 'gift_chest', 'fine_wine']) {
            expect(ids).toContain(id);
        }
        for (const id of ids) {
            const good = PlayerEconomy.GOODS[id.toUpperCase()];
            expect(good, id).toBeTruthy();
            expect(good.id).toBe(id);
            expect(good.name, id).toBeTruthy();
            expect(good.icon, id).toBeTruthy();
            expect(good.basePrice, id).toBeGreaterThan(0);
        }
    });

    it('legendary loot sells, and is worth more than common goods', () => {
        const player = makePlayer({ gold: 0, inventory: { dragon_scale: 2 } });
        const r = Trading.sellGoods(player, 'dragon_scale', 2, null);
        expect(r.success, r.reason).toBe(true);
        expect(r.earned).toBe(Math.floor(PlayerEconomy.GOODS.DRAGON_SCALE.basePrice * 0.7) * 2);
        expect(PlayerInventory.goodValue('enchanted_weapon')).toBeGreaterThan(PlayerInventory.goodValue('weapons'));
    });

    it('treasures each have at least one use besides selling', () => {
        for (const id of ['dragon_scale', 'enchanted_weapon', 'ancient_artifact', 'royal_seal', 'treaty', 'gift_chest', 'fine_wine', 'relics', 'holy_water']) {
            const info = Treasures.info(id);
            expect(info, id).toBeTruthy();
            expect(Treasures.describe(id).length, id).toBeGreaterThan(0);
        }
    });

    it('dragon scales can be forged into armour; rare herbs brewed; oil refined', () => {
        expect(PlayerEconomy.RECIPES.DRAGONSCALE_ARMOR.input).toBe('dragon_scale');
        expect(PlayerEconomy.PROPERTY_TYPES.BLACKSMITH.allowedRecipes).toContain('DRAGONSCALE_ARMOR');
        expect(PlayerEconomy.PROPERTY_TYPES.APOTHECARY.allowedRecipes).toContain('ELIXIR');
        expect(PlayerEconomy.PROPERTY_TYPES.CHANDLERY.allowedRecipes).toContain('LAMP_OIL');
    });
});

describe('treasure effects', () => {
    it('carried dragon scale and enchanted weapon protect and strengthen (once per kind, capped)', () => {
        const bare = makePlayer();
        const armed = makePlayer({ inventory: { dragon_scale: 5, enchanted_weapon: 3 } });
        expect(PlayerEffects.personalDamageMultiplier(bare)).toBe(1);
        expect(PlayerEffects.personalDamageMultiplier(armed)).toBeCloseTo(0.9);
        expect(PlayerEffects.treasureBonus(armed, 'battlePower')).toBeCloseTo(0.05);
        const plated = makePlayer({ inventory: { dragon_scale: 1, dragonscale_armor: 1 } });
        expect(PlayerEffects.personalDamageMultiplier(plated)).toBeCloseTo(0.9 * 0.75);
    });

    it('a royal seal helps at the negotiating table', () => {
        const base = PlayerEffects.negotiationBonus(makePlayer());
        expect(PlayerEffects.negotiationBonus(makePlayer({ inventory: { royal_seal: 1 } }))).toBeCloseTo(base + 0.05);
    });

    it('battles read the enchanted weapon bonus', () => {
        const army = Array.from({ length: 10 }, (_, i) => ({ type: 'militia', name: `M${i}`, strength: 5, level: 1, upkeep: 1, experience: 0 }));
        const spy = vi.spyOn(PlayerEffects, 'treasureBonus');
        try {
            Utils.setSeed(7);
            PlayerMilitary.combat(makePlayer({ army, inventory: { enchanted_weapon: 1 } }), 40, 'Bandits');
            const call = spy.mock.calls.findIndex(c => c[1] === 'battlePower');
            expect(call).toBeGreaterThanOrEqual(0);
            expect(spy.mock.results[call].value).toBeCloseTo(0.05);
        } finally {
            spy.mockRestore();
        }
    });

    it('presenting a treasure to a lord raises reputation and uses up the item', () => {
        const player = makePlayer({ inventory: { gift_chest: 1, ancient_artifact: 1 } });
        const kingdom = { id: 'k1', name: 'Vale', lord: { name: 'Lord Vale', traits: [{ id: 'greedy' }] } };
        expect(Treasures.giftable(player).map(g => g.id)).toEqual(['gift_chest', 'ancient_artifact']);
        const r = Treasures.presentToLord(player, kingdom, 'gift_chest');
        expect(r.success).toBe(true);
        expect(r.reputation).toBe(25); // 20 × 1.25 for a greedy lord
        expect(player.reputation.k1).toBe(25);
        expect(player.inventory.gift_chest).toBeUndefined();
        expect(Treasures.presentToLord(player, kingdom, 'gift_chest').success).toBe(false);
        expect(Treasures.presentToLord(player, kingdom, 'stolen_goods').success).toBe(false);
    });

    it('enshrining an artifact earns House Prestige', () => {
        const player = makePlayer({ firstName: 'Ash', lastName: 'Vale', inventory: { ancient_artifact: 1 } });
        expect(Treasures.dedicate(player, 'ancient_artifact', 3).success).toBe(false); // no House yet
        House.initialize(player, { day: 1 });
        const before = player.house.prestige;
        const r = Treasures.dedicate(player, 'ancient_artifact', 3);
        expect(r.success).toBe(true);
        expect(player.house.prestige).toBe(before + 6);
        expect(player.inventory.ancient_artifact).toBeUndefined();
    });

    it('holy water heals and rum restores a step', () => {
        const player = makePlayer({ health: 50, movementRemaining: 0, inventory: { holy_water: 1, rum: 1 } });
        expect(Treasures.use(player, 'holy_water').health).toBe(10);
        expect(player.health).toBe(60);
        expect(Treasures.use(player, 'rum').movement).toBe(1);
        expect(player.movementRemaining).toBe(1);
        expect(Treasures.use(player, 'dragon_scale').success).toBe(false);
    });
});

describe('defeating a legendary creature', () => {
    function strongArmy() {
        return Array.from({ length: 30 }, (_, i) => ({ type: 'knight', name: `K${i}`, strength: 20, level: 3, upkeep: 1, experience: 0 }));
    }

    it('its coin goes to the purse and its hoard into the packs', () => {
        Utils.setSeed(21);
        const world = makeWorld();
        const player = makePlayer({ gold: 0, army: strongArmy() });
        const monster = new WorldUnit('monster', 0, 0);
        monster.strength = 1;
        monster.inventory = { gold: 900, dragon_scale: 2 };
        const res = PlayerMilitary.attackUnit(player, monster, world);
        expect(res.victory).toBe(true);
        expect(player.inventory.gold).toBeUndefined();
        expect(player.gold).toBeGreaterThanOrEqual(900);
        expect(player.inventory.dragon_scale).toBe(2);
        expect(res.inventoryLoot).toMatchObject({ gold: 900, dragon_scale: 2 });
    });

    it('a full pack leaves new treasure behind (slot cap respected)', () => {
        Utils.setSeed(21);
        const world = makeWorld();
        const player = makePlayer({ gold: 0, army: strongArmy(), maxInventory: 2, inventory: { grain: 1, wood: 1 } });
        const monster = new WorldUnit('monster', 0, 0);
        monster.strength = 1;
        monster.inventory = { gold: 500, enchanted_weapon: 1 };
        const res = PlayerMilitary.attackUnit(player, monster, world);
        expect(res.victory).toBe(true);
        expect(player.inventory.enchanted_weapon).toBeUndefined();
        expect(res.lootLeftBehind).toEqual({ enchanted_weapon: 1 });
        expect(player.gold).toBeGreaterThanOrEqual(500);
    });
});

describe('coal, oil and cattle', () => {
    it('settlements on them produce coal, oil, and food plus hides', () => {
        const run = (res) => {
            const world = makeWorld({ '10,10': res }, { settlementAt: { q: 10, r: 10 } });
            const tile = world.getTile(10, 10);
            Economy.initSettlement(tile.settlement);
            return Economy.calculateDetailedProduction(tile.settlement, tile, world);
        };
        const none = run(null);
        expect(run('coal').items.coal).toBeGreaterThan(0);
        expect(run('oil').items.oil).toBeGreaterThan(0);
        expect(run('oil').gold).toBeGreaterThan(none.gold);
        const cattle = run('cattle');
        expect(cattle.items.hide).toBeGreaterThan(0);
        expect(cattle.items.food).toBeGreaterThan(0);
        expect(cattle.food).toBeGreaterThan(none.food);
    });

    it('a mine can work a coal seam; a pitch works an oil seep', () => {
        const world = makeWorld({ '5,5': 'coal', '8,8': 'oil' });
        const player = makePlayer();
        const mine = PlayerEconomy.buildProperty(player, 'MINE', world.getTile(5, 5), world);
        expect(mine.success, mine.reason).toBe(true);
        expect(mine.property.produces).toBe('coal');
        const pitch = PlayerEconomy.buildProperty(player, 'PITCH_WORKS', world.getTile(8, 8), world);
        expect(pitch.success, pitch.reason).toBe(true);
        expect(pitch.property.produces).toBe('oil');
    });

    it('a cattle ranch beside a herd yields 30% more', () => {
        const produce = (resources) => {
            const world = makeWorld(resources);
            delete world.day; // outside the calendar: no seasonal herd curve (see seasons.test.js)
            const player = makePlayer();
            const r = PlayerEconomy.buildProperty(player, 'CATTLE_RANCH', world.getTile(3, 3), world);
            expect(r.success, r.reason).toBe(true);
            r.property.underConstruction = false;
            return PlayerEconomy.produceGoods(player, world).meat || 0;
        };
        const plain = produce({});
        expect(produce({ '3,4': 'cattle' })).toBe(Math.floor(6 * 1.3));
        expect(plain).toBe(6);
    });

    it('a coal-fired forge turns out more from the same iron', () => {
        const forge = (resources) => {
            const world = makeWorld(resources, { settlementAt: { q: 3, r: 3 } });
            const tile = world.getTile(3, 3);
            const player = makePlayer();
            const r = PlayerEconomy.buildProperty(player, 'FORGE', tile, world);
            expect(r.success, r.reason).toBe(true);
            r.property.underConstruction = false;
            tile.playerProperty = r.property;
            expect(PlayerEconomy.setWorkshopRecipe(tile, 'TOOLS', player).success).toBe(true);
            r.property.retooling = false;
            let total = 0;
            for (let d = 0; d < 4; d++) {
                r.property.inputStorage = 100;
                total += PlayerEconomy.produceGoods(player, world).tools || 0;
            }
            return total;
        };
        const cold = forge({});
        const hot = forge({ '3,2': 'coal' });
        expect(cold).toBeGreaterThan(0);
        expect(hot).toBe(Math.floor(cold * 1.25));
        expect(Economy.propertyResourceBonus(makeWorld({ '0,1': 'coal' }), { q: 0, r: 0 }, 'blacksmith').resource).toBe('coal');
    });

    it('markets on coal and cattle stock them', () => {
        const world = makeWorld({ '1,1': 'coal', '2,2': 'cattle' });
        const town = { name: 'T', type: 'town', population: 2000 };
        const coalGoods = Trading.getAvailableGoods({ ...town }, world.getTile(1, 1)).map(g => g.id);
        expect(coalGoods).toContain('coal');
        const herdGoods = Trading.getAvailableGoods({ ...town }, world.getTile(2, 2)).map(g => g.id);
        expect(herdGoods).toEqual(expect.arrayContaining(['meat', 'hide']));
    });
});

describe('goods, military, trade and construction bonuses are applied', () => {
    it('reads direct resources in full, nearby at half, capped', () => {
        const world = makeWorld({ '0,0': 'stone', '1,0': 'timber' });
        const b = Economy.resourceBonuses(world, 0, 0);
        expect(b.construction).toBeCloseTo(0.5); // 0.5 + 0.15, capped at 0.5
        expect(b.goods).toBeCloseTo(0.1 + 0.1);
        expect(Economy.resourceBonuses(makeWorld(), 0, 0).construction).toBe(0);
    });

    it('goods: iron near a town lifts its goods output', () => {
        const run = (resources) => {
            const world = makeWorld(resources, { settlementAt: { q: 10, r: 10 } });
            const tile = world.getTile(10, 10);
            Economy.initSettlement(tile.settlement);
            return Economy.calculateDetailedProduction(tile.settlement, tile, world).items.textiles;
        };
        expect(run({ '11,10': 'iron' })).toBeGreaterThan(run({}));
    });

    it('military: recruiting near iron and horses is cheaper', () => {
        const unit = Object.values(PlayerMilitary.UNIT_TYPES)[0];
        const player = makePlayer();
        const plainWorld = makeWorld({}, { settlementAt: { q: 4, r: 4 } });
        const armsWorld = makeWorld({ '4,4': 'horses', '5,4': 'iron' }, { settlementAt: { q: 4, r: 4 } });
        const plain = PlayerMilitary.getRecruitCost(player, unit, plainWorld.getTile(4, 4).settlement, plainWorld);
        const cheap = PlayerMilitary.getRecruitCost(player, unit, armsWorld.getTile(4, 4).settlement, armsWorld);
        expect(cheap).toBeLessThan(plain);
        // Without a world the daily cache is used
        const s = armsWorld.getTile(4, 4).settlement;
        Economy.initSettlement(s);
        Economy.calculateProduction(s, armsWorld.getTile(4, 4), armsWorld);
        expect(PlayerMilitary.getRecruitCost(player, unit, s)).toBe(cheap);
    });

    it('trade: route income rises at a settlement near spices', () => {
        const income = (resources) => {
            const world = makeWorld(resources, { settlementAt: { q: 6, r: 6 } });
            const tile = world.getTile(6, 6);
            const s = tile.settlement;
            Economy.initSettlement(s);
            Economy.calculateProduction(s, tile, world);
            s.economy.tradeRoutes.push({ profit: 40, active: true });
            return Economy.processTrade(s);
        };
        expect(income({})).toBe(40);
        expect(income({ '6,6': 'spices' })).toBe(Math.round(40 * 1.4));
    });

    it('trade: caravans earn more selling where merchants gather', () => {
        expect(Economy.caravanProfitMultiplier(makeWorld({ '2,2': 'gems' }), { q: 2, r: 2 })).toBeCloseTo(1.1);
        expect(Economy.caravanProfitMultiplier(makeWorld(), { q: 2, r: 2 })).toBe(1);
    });

    it('construction: stone nearby cuts property cost and build time', () => {
        const player = makePlayer();
        const def = PlayerEconomy.PROPERTY_TYPES.MINE;
        const plainWorld = makeWorld({ '0,0': 'iron' });
        const stoneWorld = makeWorld({ '0,0': 'iron', '0,1': 'stone' });
        const reduction = Technology.getBuildingCostReduction(player);
        expect(PlayerEconomy.getBuildCost(player, def, plainWorld.getTile(0, 0), plainWorld)).toBe(Math.round(def.cost * (1 - reduction)));
        const cheap = PlayerEconomy.getBuildCost(player, def, stoneWorld.getTile(0, 0), stoneWorld);
        expect(cheap).toBe(Math.round(def.cost * (1 - reduction) * (1 - 0.25 * 0.5)));
        const built = PlayerEconomy.buildProperty(player, 'MINE', stoneWorld.getTile(0, 0), stoneWorld);
        expect(built.constructionDays).toBeLessThan(def.constructionDays);
    });

    it('construction: roads cost less and go up faster beside a quarry stone', () => {
        const player = makePlayer();
        const stub = { isImplemented: Technology.isImplemented };
        Technology.isImplemented = () => true;
        try {
            const plainWorld = makeWorld();
            const stoneWorld = makeWorld({ '0,0': 'stone' });
            const plain = Infrastructure.canBuild(player, 'STONE_ROAD', plainWorld.getTile(0, 0), plainWorld);
            const cheap = Infrastructure.canBuild(player, 'STONE_ROAD', stoneWorld.getTile(0, 0), stoneWorld);
            expect(plain.can, plain.reason).toBe(true);
            expect(cheap.cost).toBeLessThan(plain.cost);
            expect(cheap.buildDays).toBeLessThanOrEqual(plain.buildDays);
        } finally {
            Technology.isImplemented = stub.isImplemented;
        }
    });
});
