// Tech effects, office perks and theater morale that used to be advertised
// but never read. Each one is checked at its consumer, and checked to be a
// no-op for a player without the tech/title/building.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Technology } from '../systems/technology.js';
import { Titles } from '../systems/titles.js';
import { Culture } from '../systems/culture.js';
import { Ships } from '../systems/ships.js';
import { Economy } from '../world/economy.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { Tavern } from '../player/tavern.js';
import { Player } from '../player/player.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

afterEach(() => vi.restoreAllMocks());

function withTechs(techs = [], extra = {}) {
    const p = { gold: 100000, q: 5, r: 5, properties: [], inventory: {}, skills: { commerce: 0, combat: 0 }, ...extra };
    Technology.initPlayer(p);
    p.technology.implemented = techs;
    return p;
}

describe('Heavy Cavalry', () => {
    it('adds cavalryStrengthBonus to mounted units only', () => {
        const p = withTechs(['heavy_cavalry']);
        expect(Technology.getUnitStrengthBonus(p, 'knight')).toBeCloseTo(0.35);
        expect(Technology.getUnitStrengthBonus(p, 'heavy_cavalry')).toBeCloseTo(0.35);
        expect(Technology.getUnitStrengthBonus(p, 'archer')).toBe(0);
    });

    it('raises army strength of a mounted army', () => {
        const army = () => [{ type: 'knight', strength: 100, level: 1 }];
        const base = PlayerMilitary.getArmyStrength(withTechs([], { army: army() }));
        const boosted = PlayerMilitary.getArmyStrength(withTechs(['heavy_cavalry'], { army: army() }));
        expect(boosted).toBe(Math.floor(base * 1.35));
    });
});

describe('Steel Forging', () => {
    function forgeWeapons(techs) {
        const tile = { q: 3, r: 4, terrain: { id: 'plains', passable: true }, settlement: { name: 'Ironvale', type: 'town', population: 500 }, resource: null, hasRiver: false, playerProperties: null, playerProperty: null };
        const world = { tile, getTile: (q, r) => (q === 3 && r === 4 ? tile : null), width: 50 };
        const player = withTechs(techs);
        expect(PlayerEconomy.buildProperty(player, 'FORGE', tile, world).success).toBe(true);
        const forge = PlayerEconomy.findPropertyAt(tile, PlayerEconomy.PROPERTY_TYPES.FORGE.id);
        forge.underConstruction = false;
        tile.playerProperty = forge;
        expect(PlayerEconomy.setWorkshopRecipe(tile, 'WEAPONS', player).success).toBe(true);
        forge.retooling = false;
        forge.inputStorage = 100;
        return PlayerEconomy.produceGoods(player, world).weapons;
    }

    it('forges more weapons from the same iron', () => {
        expect(forgeWeapons([])).toBe(5);
        expect(forgeWeapons(['steel_forging'])).toBe(7);
    });
});

describe('Aqueducts', () => {
    function feed(colony, bonuses) {
        vi.spyOn(Economy, 'calculateProduction').mockReturnValue({ gold: 0, food: 100, goods: 0, breakdown: { items: {} } });
        const settlement = { population: 0, colony };
        Economy.produceDaily(settlement, {}, {}, bonuses);
        return settlement.economy.food;
    }

    it("boosts food in the player's own colonies only", () => {
        expect(feed({ isPlayerColony: true }, { colonyFood: 0.2 })).toBe(120);
        expect(feed({ isPlayerColony: false }, { colonyFood: 0.2 })).toBe(100);
        expect(feed(null, { colonyFood: 0.2 })).toBe(100);
        expect(feed({ isPlayerColony: true }, {})).toBe(100);
    });
});

describe('Naval Warfare and Lighthouse', () => {
    const ship = () => ({ id: 's1', name: 'Gull', typeId: 'galleon', status: 'docked', q: 5, r: 5, cargo: {}, condition: 100 });

    it('naval combat strength rises with navalCombatBonus', () => {
        const base = Ships._getShipCombatStrength(ship(), withTechs([]));
        expect(Ships._getShipCombatStrength(ship(), null)).toBe(base);
        expect(Ships._getShipCombatStrength(ship(), withTechs(['naval_warfare']))).toBe(Math.floor(base * 1.3));
    });

    it('port sales pay more with portTradeBonus', () => {
        const GRASS = { id: 'grassland', passable: true, moveCost: 1 };
        // A fresh port each sale: a cargo landed floods the town's stores (world/settlementMarket.js)
        const mkWorld = () => {
            const tile = { q: 5, r: 5, terrain: GRASS, settlement: { name: 'Saltmere', type: 'town' } };
            return { width: 20, height: 20, day: 1, getTile: (q, r) => (q === 5 && r === 5 ? tile : { q, r, terrain: { id: 'ocean', passable: false } }) };
        };
        const good = Ships.getPortMarket(mkWorld(), 5, 5)[0].id;
        const sell = (techs) => {
            const world = mkWorld();
            const p = withTechs(techs, { boardedShip: null, ships: [ship()] });
            p.ships[0].cargo[good] = 10;
            return Ships.sellTradeGood(p, world, 's1', good, 10).revenue;
        };
        const base = sell([]);
        expect(base).toBeGreaterThan(0);
        expect(sell(['lighthouse'])).toBeGreaterThan(base);
    });
});

describe('Office perks', () => {
    it('Spymaster keeps freeInformants on the crown purse', () => {
        const informants = () => [1, 2, 3].map(i => ({ q: i, r: 0, upkeep: 10 }));
        const world = { day: 1, getTile: () => null };
        const plain = { gold: 1000, intel: { informants: informants() } };
        expect(Tavern.processInformants(plain, world).cost).toBe(30);
        const spy = { gold: 1000, currentTitle: 'spymaster', intel: { informants: informants() } };
        expect(Tavern.processInformants(spy, world).cost).toBe(10);
        expect(spy.gold).toBe(990);
    });

    it('Court Chaplain spreads faith further and earns karmaPerBlessing', () => {
        const settlementTile = { q: 0, r: 0, settlement: { population: 10000, kingdom: 'k1' } };
        const temple = { underConstruction: false, influenceRadius: 0, followers: 0 };
        const world = { getTile: (q, r) => (q === 0 && r === 0 ? Object.assign(settlementTile, { religiousBuilding: temple }) : null) };
        const spread = (title) => {
            temple.followers = 0;
            const p = { faith: 0, karma: 0, currentTitle: title, religion: { buildings: [{ q: 0, r: 0 }], followers: 0 } };
            return PlayerReligion.spreadFaith(p, world);
        };
        expect(spread(null)).toBe(100);
        expect(spread('court_chaplain')).toBe(125);

        const chaplain = { karma: 0, renown: 0, currentTitle: 'court_chaplain', allegiance: 'k1', titleProgress: {} };
        expect(Titles.blessSettlement(chaplain, settlementTile, world).success).toBe(true);
        expect(chaplain.karma).toBe(Titles.getTitleDefinitions().court_chaplain.perks.karmaPerBlessing);
    });

    it('Royal Cartographer sees further and is paid per survey', () => {
        const tiles = [];
        for (let r = 0; r < 21; r++) {
            tiles.push([]);
            for (let q = 0; q < 21; q++) tiles[r].push({ q, r, visible: false, explored: false });
        }
        const world = { width: 21, height: 21, tiles, getTile: (q, r) => (tiles[r] && tiles[r][q]) || null };
        const seen = (title) => {
            for (const row of tiles) for (const t of row) t.visible = false;
            const p = new Player();
            p.q = 10; p.r = 10;
            p.currentTitle = title;
            p.updateVisibility(world, 3);
            return tiles.flat().filter(t => t.visible).length;
        };
        expect(seen('royal_cartographer')).toBeGreaterThan(seen(null));

        expect(Titles.recordSurvey({ gold: 0 })).toBe(0);
        const carto = { gold: 0, currentTitle: 'royal_cartographer' };
        const paid = Titles.recordSurvey(carto);
        expect(paid).toBeGreaterThanOrEqual(10);
        expect(paid).toBeLessThanOrEqual(30);
        expect(carto.gold).toBe(paid);
    });
});

describe('Theater morale', () => {
    it('finished theaters add a small, capped morale bonus', () => {
        const theater = (underConstruction = false) => ({ culturalBuilding: { type: 'theater', moraleBonus: 10, underConstruction } });
        const worldOf = (list) => ({ getTile: (q) => list[q] || null });
        const refs = (n) => Array.from({ length: n }, (_, q) => ({ q, r: 0, type: 'theater' }));

        expect(Culture.getMoraleBonus({}, worldOf([]))).toBe(0);
        expect(Culture.getMoraleBonus({ culturalBuildings: refs(1) }, null)).toBe(0);
        expect(Culture.getMoraleBonus({ culturalBuildings: refs(1) }, worldOf([theater(true)]))).toBe(0);
        expect(Culture.getMoraleBonus({ culturalBuildings: refs(1) }, worldOf([theater()]))).toBeCloseTo(0.02);
        const many = [theater(), theater(), theater(), theater(), theater()];
        expect(Culture.getMoraleBonus({ culturalBuildings: refs(5) }, worldOf(many))).toBeCloseTo(0.06);
    });
});
