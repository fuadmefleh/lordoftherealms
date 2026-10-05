// World state a save/load round trip must keep: the world units (raiders,
// caravans, processions, guardians, war hosts, ...), the regional markets,
// the id counter, the player's temples and cultural buildings and cleared
// land. Older saves without units still regenerate them.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Terrain } from '../world/terrain.js';
import { WorldUnit } from '../world/units.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Delves } from '../systems/delves.js';
import { Relationships } from '../systems/relationships.js';
import { Espionage } from '../systems/espionage.js';
import { Cartography } from '../systems/cartography.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => logSpy && logSpy.mockRestore());

/** Save → JSON → load like roundTrip, letting the test edit the save (an "older" save). */
function reload(game, editSave) {
    Relationships.prepareForSave(game.player);
    Espionage.prepareForSave(game.player);
    const data = JSON.parse(JSON.stringify({
        world: SaveLoad.serializeWorld(game.world),
        player: SaveLoad.serializePlayer(game.player),
    }));
    if (editSave) editSave(data);
    const w2 = new World(data.world.width, data.world.height);
    w2.generate(data.world.generationParams || {});
    SaveLoad.restoreWorld(data.world, w2);
    Terrain.identifyRegions(w2.tiles, w2.width, w2.height);
    const p2 = new Player();
    SaveLoad.restorePlayer(data.player, p2, w2);
    return { ...game, world: w2, player: p2 };
}

const unitKey = (u) => `${u.id}:${u.type}@${u.q},${u.r}>${u.targetQ},${u.targetR}:${u.strength}:${u.age}:${JSON.stringify(u.inventory)}`;

describe('save/load keeps world state', () => {
    it('world units come back as they were, as WorldUnits', () => {
        let game = newGame(4242);
        for (let i = 0; i < 12; i++) endDay(game);
        const before = game.world.units.map(unitKey);
        expect(before.length).toBeGreaterThan(5);
        game = roundTrip(game);
        expect(game.world.units.map(unitKey)).toEqual(before);
        expect(game.world.units.every(u => u instanceof WorldUnit)).toBe(true);
        // ...and keep moving the next day
        expect(() => endDay(game)).not.toThrow();
    });

    it('restoring the units draws no randomness (no WorldUnit constructor runs)', () => {
        const game = newGame(77);
        for (let i = 0; i < 5; i++) endDay(game);
        const data = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(game.world)));
        const w2 = new World(data.width, data.height);
        w2.generate(data.generationParams || {});
        Utils.setSeed(999);
        SaveLoad.restoreWorld(data, w2);
        const afterRestore = Utils.random();
        Utils.setSeed(999);
        expect(afterRestore).toBe(Utils.random());
        expect(w2.units.length).toBe(game.world.units.length);
    });

    it('older saves without units regenerate them', () => {
        const game = newGame(4243);
        for (let i = 0; i < 3; i++) endDay(game);
        const g2 = reload(game, (data) => { delete data.world.units; });
        expect(g2.world.units.length).toBeGreaterThan(0);
        expect(g2.world.units.every(u => u instanceof WorldUnit)).toBe(true);
    });

    it("the player's caravan finds its unit after a load (it isn't written off as lost)", () => {
        let game = newGame(4244);
        const { world, player } = game;
        const from = world.getAllSettlements()[0];
        const to = world.getAllSettlements()[1];
        const unit = new WorldUnit('caravan', from.q, from.r, to.q, to.r);
        unit.playerOwned = true;
        unit.goods = { grain: 5 };
        world.units.push(unit);
        player.caravans = [{ from: from.name, to: to.name, fromPos: { q: from.q, r: from.r }, toPos: { q: to.q, r: to.r },
            goods: { grain: 5 }, expectedProfit: 10, status: 'traveling', unitId: unit.id }];
        game = roundTrip(game);
        const back = game.world.units.find(u => u.id === unit.id);
        expect(back).toBeTruthy();
        expect(back.playerOwned).toBe(true);
        expect(back.goods).toEqual({ grain: 5 });
        expect(game.player.caravans[0].unitId).toBe(unit.id);
    });

    it('an awakened delve guardian is not raised twice after a load', () => {
        let game = newGame(4245);
        const { world, player } = game;
        const st = Delves.getState(player);
        const rec = { id: st.nextGuardianId++, type: 'test', key: 'k', q: player.q, r: player.r, name: 'The Warden', icon: '👹',
            strength: 50, untilDay: world.day + 30, slain: false, gone: false };
        st.guardians.push(rec);
        Delves._spawnGuardian(world, rec);
        game = roundTrip(game);
        Delves.processDay(game.world, game.player);
        Delves.processDay(game.world, game.player);
        const live = game.world.units.filter(u => u.delveGuardianId === rec.id && !u.destroyed);
        expect(live.length).toBe(1);
        // ...and slaying it after the load still counts
        live[0].destroyed = true;
        const out = Delves.processDay(game.world, game.player);
        expect(out.slain).toContain('The Warden');
    });

    it('settlement markets and the id counter survive a load', () => {
        let game = newGame(4246);
        for (let i = 0; i < 6; i++) endDay(game);
        const marketsOf = (w) => JSON.stringify(w.getSettlementViews().map(s => [s.q, s.r, s.market]));
        const markets = marketsOf(game.world);
        expect(game.world.getSettlementViews().every(s => s.market && s.market.stock)).toBe(true);
        const map = Cartography.generateTreasureMap ? Cartography.generateTreasureMap(game.world) : null;
        const counter = Utils.getIdCounter();
        game = roundTrip(game);
        expect(marketsOf(game.world)).toBe(markets);
        expect(MarketDynamics.regionalMarkets).toEqual({});
        expect(Utils.getIdCounter()).toBe(counter);
        if (map) expect(map.id).not.toMatch(/\d{13}/); // no wall-clock ids
    });

    it("the player's temples, cultural buildings and cleared land survive a load", () => {
        let game = newGame(4247);
        const { world } = game;
        const t1 = world.getTile(game.player.q, game.player.r);
        t1.religiousBuilding = { type: 'shrine', name: 'Shrine', level: 1, followers: 3 };
        const t2 = world.getTile(game.player.q + 1, game.player.r);
        t2.culturalBuilding = { type: 'library', name: 'Library', owner: 'player', level: 2 };
        const t3 = world.getTile(game.player.q + 2, game.player.r);
        t3.terrain = Terrain.TYPES.GRASSLAND;
        t3.resource = null;
        t3.terraformed = true;
        game = roundTrip(game);
        expect(game.world.getTile(t1.q, t1.r).religiousBuilding).toMatchObject({ type: 'shrine', followers: 3 });
        expect(game.world.getTile(t2.q, t2.r).culturalBuilding).toMatchObject({ type: 'library', level: 2 });
        const back = game.world.getTile(t3.q, t3.r);
        expect(back.terrain.id).toBe(Terrain.TYPES.GRASSLAND.id);
        expect(back.resource).toBe(null);
    });
});

describe('deterministic ids', () => {
    it('a world numbers its characters from 1, the same every time', () => {
        const ids = () => {
            Utils.setSeed(5);
            const w = new World(40, 30);
            w.generate({ kingdomCount: 3 });
            return w.kingdoms.map(k => k.characterData && k.characterData.ruler && k.characterData.ruler.id);
        };
        const a = ids();
        const b = ids();
        expect(a).toEqual(b);
        expect(a.filter(Boolean).length).toBeGreaterThan(0);
        for (const id of a.filter(Boolean)) expect(id).toMatch(/^char_\d+$/);
    });
});
