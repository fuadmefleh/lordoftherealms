// Weapon smithing, shields and armour (systems/arms.js, data/arms.json):
// the catalogue, the smithing chain (ore → bars → blades and heads → hafted
// and hilted), the player's equipment and what it does in a duel and on the
// road, wear and mending, troops issued real kits from real stock, the town
// armourers and war demand, and orders placed with a town smith. Seeded.
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Grades } from '../core/grades.js';
import { DataLoader } from '../core/dataLoader.js';
import { Arms } from '../systems/arms.js';
import { Duels } from '../systems/duels.js';
import { Commissions } from '../systems/commissions.js';
import { Crafting } from '../player/crafting.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => Utils.setSeed(4321));

const G = () => DataLoader._gamedata.playerEconomy.GOODS;
const worth = (o) => Object.entries(o).reduce((s, [id, n]) => s + G()[id.toUpperCase()].basePrice * n, 0);

function fighter(over = {}) {
    return {
        name: 'Tester', gold: 2000, health: 100, maxHealth: 100, strength: 6, intelligence: 5, charisma: 5, luck: 5,
        inventory: {}, maxInventory: 60, skills: { combat: 3, leadership: 1 }, army: [], ...over,
    };
}

function atTown(type = 'town') {
    const game = newGame(4242, { terrainGen: 3 });
    const { world, player } = game;
    const s = world.getSettlementViews().find(x => x.type === type) || world.getSettlementViews()[0];
    player.q = s.q; player.r = s.r;
    const live = world.getTile(s.q, s.r).settlement;
    SettlementMarket.ensure(live);
    if (player.languages) for (const k of Object.keys(require('../../data/cultures.json').languages)) player.languages[k] = 100;
    return { ...game, s: live };
}

describe('the arms catalogue', () => {
    it('every piece is a good with a price, made by a recipe, with a slot, class and sprite type', () => {
        const recipes = Crafting.recipes();
        for (const [id, def] of Object.entries(Arms.items())) {
            expect(G()[id.toUpperCase()], id).toBeTruthy();
            expect(['main', 'off', 'head', 'body'], id).toContain(def.slot);
            expect(Arms.config().classes[def.class], id).toBeTruthy();
            const sp = Arms.spriteOf(id);
            expect(sp.weaponClass, id).toBeTruthy();
            if (id !== 'enchanted_weapon') expect(recipes.some(r => r.result && r.result[id] > 0), id).toBe(true);
        }
    });

    it('the LPC layers it names exist in assets/lpc/Characters', () => {
        const base = path.join(__dirname, '..', '..', 'assets', 'lpc', 'Characters');
        for (const id of Object.keys(Arms.items())) {
            for (const layer of Arms.spriteOf(id).layers) expect(fs.existsSync(path.join(base, layer)), `${id}: ${layer}`).toBe(true);
        }
    });

    it('arms work adds value: every arms recipe makes more than it uses, and the old pieces keep their duel numbers', () => {
        for (const r of Crafting.recipes('arms')) expect(worth(r.result), r.id).toBeGreaterThan(worth(r.ingredients));
        expect(Arms.stats('steel_sword').dmg).toBeCloseTo(3.8, 5);
        expect(Arms.stats('spear').dmg).toBeCloseTo(2.5, 5);
        expect(Arms.stats('weapons').dmg).toBeCloseTo(3, 5);
        expect(Arms.stats('chainmail').prot).toBeCloseTo(0.28, 5);
        // a mace bruises through mail, a sword is turned by it
        expect(Arms.stats('iron_mace').pen).toBeGreaterThan(Arms.stats('iron_sword').pen);
        expect(Arms.stats('chainmail').vs.cut).toBeGreaterThan(Arms.stats('chainmail').vs.blunt);
    });
});

describe('the smithing chain', () => {
    it('ore is smelted to iron, copper and tin cast to bronze bars, and a dagger forged from a bar and a grip', () => {
        const p = fighter({ inventory: { ore: 4, coal: 2, copper: 3, tin: 1, wood: 1, leather: 1 }, skills: { combat: 1, smithing: 8 } });
        // (each attempt either makes the bar or spoils part of the stuff: never from nothing)
        const r1 = Crafting.craft(p, 'bloomery_coal', { forgeScore: 90 });
        expect(p.inventory.ore || 0).toBeLessThan(4);
        if (r1.success) expect(p.inventory.iron).toBe(1);
        const r2 = Crafting.craft(p, 'bronze_bar_cast', { forgeScore: 90 });
        expect(p.inventory.copper || 0).toBeLessThan(3);
        if (r2.success) expect(p.inventory.bronze_bar).toBe(1);
        p.inventory.bronze_bar = Math.max(1, p.inventory.bronze_bar || 0);
        p.inventory.grip = 1;
        Utils.setSeed(1);
        let made = null;
        for (let i = 0; i < 5 && !made; i++) {
            p.inventory.bronze_bar = Math.max(1, p.inventory.bronze_bar || 0);
            p.inventory.grip = Math.max(1, p.inventory.grip || 0);
            const res = Crafting.craft(p, 'forge_bronze_dagger', { forgeScore: 95 });
            if (res.success) made = res;
        }
        expect(made).toBeTruthy();
        expect(p.inventory.bronze_dagger).toBeGreaterThanOrEqual(1);
        expect(made.recipe.station).toBe('arms');
        expect(Crafting.skillOf(made.recipe)).toBe('smithing');
        expect(Grades.gradeable('bronze_dagger')).toBe(true);
    });

    it('better parts and a better forge make better arms', () => {
        const r = Crafting.recipe('forge_iron_sword');
        const base = fighter({ inventory: { iron: 3, grip: 1 } });
        const fine = fighter({ inventory: { iron: 3, grip: 1 } });
        Grades.add(fine, 'grip', 1, 'masterwork');
        expect(Crafting.odds(fine, r, {}).score).toBeGreaterThan(Crafting.odds(base, r, {}).score);
        expect(Crafting.odds(base, r, { forgeScore: 95 }).score).toBeGreaterThan(Crafting.odds(base, r, { forgeScore: 20 }).score);
    });
});

describe('equipment', () => {
    it('takes up the best carried piece, equips and puts away, and a two-hander leaves no hand for a shield', () => {
        const p = fighter({ inventory: { spear: 1, iron_sword: 1, shield: 1, gambeson: 1, chainmail: 1, helmet: 1 } });
        const lo = Arms.loadout(p);
        expect(lo.main.id).toBe('iron_sword');
        expect(lo.off.id).toBe('shield');
        expect(lo.body.id).toBe('chainmail');
        expect(lo.head.id).toBe('helmet');
        expect(Arms.equip(p, 'spear').success).toBe(true);
        expect(Arms.equipped(p, 'main').id).toBe('spear');
        p.inventory.halberd = 1;
        expect(Arms.equip(p, 'halberd').success).toBe(true);
        expect(Arms.equipped(p, 'off')).toBe(null);
        expect(Arms.equip(p, 'shield').success).toBe(false);
        Arms.unequip(p, 'main');
        expect(Duels.playerWeapon(p).id).toBe('fists');
        // a piece sold or lost empties its slot
        delete p.inventory.chainmail;
        expect(Arms.equipped(p, 'body').id).toBe('gambeson');
    });

    it('a duel reads the gear: harness by damage type, the weapon\'s reach and point, a heavy swing\'s breath', () => {
        const bare = Duels.fromPlayer(fighter(), { fresh: true });
        const armed = Duels.fromPlayer(fighter({ inventory: { iron_mace: 1, shield: 1, plate_armor: 1, steel_helm: 1 } }), { fresh: true });
        expect(armed.armour).toBeGreaterThan(0.35);
        expect(armed.armourVs.cut).toBeGreaterThan(armed.armourVs.blunt);
        expect(armed.pen).toBeGreaterThan(0.3);
        expect(armed.dtype).toBe('blunt');
        expect(armed.maxStamina).toBeLessThan(Duels.fromPlayer(fighter({ inventory: { iron_mace: 1 } }), { fresh: true }).maxStamina);
        expect(armed.power).toBeGreaterThan(bare.power);
        expect(armed.defense).toBeGreaterThan(bare.defense);
        const pike = Duels.fromPlayer(fighter({ inventory: { pike: 1 } }), { fresh: true });
        expect(pike.reach).toBeGreaterThan(armed.reach);
        expect(pike.strikeCost).toBe(1);
        // a Fine blade cuts deeper than a Common one
        const fineP = fighter({ inventory: { iron_sword: 1 } });
        Grades.add(fineP, 'iron_sword', 1, 'fine');
        expect(Duels.playerWeapon(fineP).dmg).toBeGreaterThan(Duels.playerWeapon(fighter({ inventory: { iron_sword: 1 } })).dmg);
    });

    it('armour turns harm on the road and wears for it', () => {
        const p = fighter({ inventory: { leather_armor: 1, helmet: 1, shield: 1 } });
        const m = PlayerEffects.personalDamageMultiplier(p);
        expect(m).toBeLessThan(0.65);
        expect(m).toBeGreaterThan(0.5);
        const before = Arms.equipped(p, 'body').cond;
        PlayerEffects.scaleDamage(p, 20);
        expect(Arms.equipped(p, 'body').cond).toBeLessThan(before);
    });
});

describe('wear and mending', () => {
    it('blows dull the blade; a whetstone puts the edge back; a piece worn to nothing breaks', () => {
        const p = fighter({ inventory: { iron_sword: 1, whetstone: 3, iron: 2, leather_armor: 1 } });
        const dmg0 = Duels.playerWeapon(p).dmg;
        Arms.wearFromDuel(p, { landed: 10, taken: 0 });
        expect(Arms.equipped(p, 'main').edge).toBeLessThan(100);
        expect(Duels.playerWeapon(p).dmg).toBeLessThan(dmg0);
        expect(Arms.sharpen(p).success).toBe(true);
        expect(Arms.equipped(p, 'main').edge).toBe(100);
        Arms.wear(p, 'main', 60);
        expect(Arms.mend(p, 'main', { self: true }).success).toBe(true);
        expect(Arms.equipped(p, 'main').cond).toBe(100);
        expect(p.inventory.iron).toBe(1);
        const r = Arms.wear(p, 'body', 500);
        expect(r.broke).toBe(true);
        expect(p.inventory.leather_armor || 0).toBe(0);
        expect(Arms.equipped(p, 'body')).toBe(null);
    });

    it('a finished duel wears the player\'s gear once', () => {
        const p = fighter({ inventory: { iron_sword: 1, gambeson: 1 } });
        const a = Duels.fromPlayer(p, { fresh: true });
        const b = Duels.fromProfile({ name: 'Brute', attack: 3, defense: 2, power: 7, hp: 30 });
        const res = Duels.autoResolve(a, b, { mode: 'toDeath' });
        expect(res.dealt + res.taken).toBeGreaterThan(0);
        const eq = p.equipment;
        expect(eq.main.edge < 100 || eq.body.cond < 100).toBe(true);
        const snap = JSON.stringify(eq);
        Duels.result(Duels.create(a, b)); // an unfinished bout wears nothing
        expect(JSON.stringify(p.equipment)).toBe(snap);
    });
});

describe('arming troops', () => {
    it('a kit from the packs: Common iron is the old strength, a bare man less, Fine steel more', () => {
        const p = fighter({ inventory: { weapons: 1, shield: 1, helmet: 1, gambeson: 1 } });
        const unit = { type: 'soldier', strength: 10, level: 1 };
        const r = Arms.issueKit(p, unit, {});
        expect(Object.keys(r.fromPack).length).toBe(4);
        expect(p.inventory.weapons || 0).toBe(0);
        const f = Arms.unitFactor(unit);
        expect(f).toBeGreaterThan(0.9);
        expect(f).toBeLessThan(1.05);
        expect(Arms.unitFactor({ type: 'soldier', kit: { g: {} } })).toBeCloseTo(Arms.kitSpec('soldier').bare, 5);
        expect(Arms.unitFactor({ type: 'soldier' })).toBe(1);
        const steel = { type: 'soldier', kit: { main: 'steel_arming_sword', off: 'heater_shield', head: 'steel_helm', body: 'brigandine', g: { main: 2, off: 2, head: 2, body: 2 }, cond: 100 } };
        expect(Arms.unitFactor(steel)).toBeGreaterThan(1.15);
        // the army's strength follows the kits
        const army = fighter({ army: [{ type: 'soldier', strength: 10, level: 1, kit: { g: {} } }] });
        const armed = fighter({ army: [{ type: 'soldier', strength: 10, level: 1, kit: steel.kit }] });
        expect(PlayerMilitary.getArmyStrength(armed)).toBeGreaterThan(PlayerMilitary.getArmyStrength(army) * 2);
    });

    it('recruits are armed out of the town\'s armourers\' stock at its price, the coin to the town', () => {
        const { world, player, s } = atTown('town');
        player.gold = 5000;
        player.inventory = {};
        player.army = [];
        player.skills = player.skills || {};
        player.skills.combat = player.skills.combat || 1;
        for (const g of ['weapons', 'spear', 'shield', 'gambeson', 'helmet', 'leather_armor']) s.market.stock[g] = 30;
        const stock0 = s.market.stock.shield;
        Economy.initSettlement(s);
        const purse0 = s.economy.gold;
        const gold0 = player.gold;
        const res = PlayerMilitary.recruitUnit(player, 'soldier', s, { world });
        expect(res.success).toBe(true);
        const unit = player.army[player.army.length - 1];
        expect(unit.kit).toBeTruthy();
        expect(res.arms.cost).toBeGreaterThan(0);
        expect(s.market.stock.shield).toBe(stock0 - 1);
        // the bounty and the arms both went to the town
        expect(Math.round(s.economy.gold - purse0)).toBe(Math.round(gold0 - player.gold));
        expect(Arms.unitFactor(unit)).toBeGreaterThan(0.9);
        // without arms to buy, he comes with what he owns
        for (const g of ['weapons', 'spear', 'shield', 'gambeson', 'helmet', 'leather_armor', 'chainmail']) s.market.stock[g] = 0;
        player._recruitedThisTurn = 0;
        PlayerMilitary.recruitUnit(player, 'soldier', s, { world });
        const bare = player.army[player.army.length - 1];
        expect(Arms.unitFactor(bare)).toBeCloseTo(Arms.kitSpec('soldier').bare, 5);
        // re-armed later from the packs
        player.inventory.weapons = 1;
        const armed = Arms.armArmy(player, {});
        expect(armed.units).toBe(1);
        expect(Arms.unitFactor(bare)).toBeGreaterThan(Arms.kitSpec('soldier').bare);
    });

    it('battles knock the kits about; the smiths mend them for coin and iron out of the town\'s stock', () => {
        const { world, player, s } = atTown('town');
        player.gold = 5000;
        player.army = [{ type: 'soldier', strength: 10, level: 1, kit: { main: 'weapons', off: 'shield', g: {}, cond: 100 } }];
        Arms.wearKits(player, 70);
        expect(player.army[0].kit.cond).toBe(30);
        const f = Arms.unitFactor(player.army[0]);
        s.market.stock.iron = 20;
        const iron0 = s.market.stock.iron;
        const r = Arms.mendKits(player, s, world);
        expect(r.success).toBe(true);
        expect(player.army[0].kit.cond).toBe(100);
        expect(Arms.unitFactor(player.army[0])).toBeGreaterThan(f);
        expect(s.market.stock.iron).toBeLessThan(iron0);
    });

    it('a won battle strips the beaten of their arms', () => {
        const p = fighter();
        const got = Arms.battleSpoils(p, 130);
        expect(got.weapons).toBe(3);
        expect(p.inventory.spear).toBe(3);
    });
});

describe('the town armourers and war', () => {
    it('a town at war needs more arms: the price of a spear climbs', () => {
        const { world, s } = atTown('town');
        s.market.stock.spear = SettlementMarket.target(s, 'spear');
        const need = SettlementMarket.need(s, 'spear');
        const price = SettlementMarket.value(world, s, null, 'spear', 35);
        s.market.war = 1;
        expect(SettlementMarket.need(s, 'spear')).toBeCloseTo(need * 4, 6);
        expect(SettlementMarket.value(world, s, null, 'spear', 35)).toBeGreaterThan(price);
        delete s.market.war;
    });

    it('the spearmaker, shieldwright and helm-smith are town trades on the town\'s iron and wood', () => {
        const rc = DataLoader._gamedata.markets.recipes;
        for (const id of ['spearmaker', 'shieldwright', 'helmsmith', 'leather_armourer', 'quilter']) expect(rc.some(r => r.id === id), id).toBe(true);
        expect(SettlementMarket.recipeGoods('spearmaker', 'in')).toHaveProperty('iron');
    });

    it('an order with the town smith: the stuff (down to the grip\'s wood and leather) bought out of the town\'s stock', () => {
        const { world, player, s } = atTown('town');
        player.gold = 5000;
        for (const g of ['iron', 'wood', 'leather']) s.market.stock[g] = 50;
        const offer = Commissions.offers(world, s).find(o => o.id === 'craft:forge_iron_sword');
        expect(offer).toBeTruthy();
        const q = Commissions.quote(player, world, s, offer, 1, 'fee', { supply: true });
        expect(q.materials.iron).toBe(3);
        expect(q.materials.wood).toBe(1);
        expect(q.materials.leather).toBe(1);
        const iron0 = s.market.stock.iron;
        Economy.initSettlement(s);
        const purse0 = s.economy.gold;
        const res = Commissions.commission(player, world, offer.id, 1, 'fee', { supply: true });
        expect(res.success).toBe(true);
        expect(s.market.stock.iron).toBe(iron0 - 3);
        expect(s.economy.gold).toBeCloseTo(purse0 + q.total, 2);
        world.day = (world.day || 0) + 5;
        expect(Commissions.collect(player, world).success).toBe(true);
        expect(player.inventory.iron_sword).toBe(1);
    });
});

describe('soldiers look the part', () => {
    it('a battle recipe follows the issued kit: the sword\'s metal, no shield or helm when none was issued', () => {
        const recipe = [
            'Props/Sword 01 - Arming Sword/_Behind/Steel', 'Props/Shield 01 - Heater Shield/Wood/Oak',
            'Body/Body 02 - Masculine, Thin/Peach', 'Head Accessories/Helm 03 - Norman/Steel', 'Props/Sword 01 - Arming Sword/Steel',
        ];
        const iron = Arms.lookLayers(recipe, { main: 'iron_sword', off: null, head: 'steel_helm', body: null });
        expect(iron).toContain('Props/Sword 01 - Arming Sword/Iron');
        expect(iron).toContain('Props/Sword 01 - Arming Sword/_Behind/Iron');
        expect(iron.some(l => l.includes('Shield'))).toBe(false);
        expect(iron).toContain('Head Accessories/Helm 02 - Bascinet, Closed/Steel');
        const bare = Arms.lookLayers(recipe, { main: null, off: 'shield', head: null, body: null });
        expect(bare.some(l => l.includes('Sword') || l.includes('Helm'))).toBe(false);
        expect(bare.some(l => l.includes('Shield'))).toBe(true);
    });
});
