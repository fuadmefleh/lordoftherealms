// Weather with teeth: deterministic day-by-day fronts whose storms, snow and
// heat slow travel, hurt those sleeping rough, sway battles, wither or water
// farms, and batter ships at sea.

import { describe, it, expect } from 'vitest';
import { Utils } from '../core/utils.js';
import { WeatherSystem, WEATHER_EFFECTS } from '../world/weather.js';
import { WorldEvents } from '../world/worldEvents.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Ships } from '../systems/ships.js';
import { WorldUnit } from '../world/units.js';
import { KingdomAI } from '../world/kingdomAI.js';

const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };

function makeWorld({ temperature = 0.5, settlement = null, day = 10 } = {}) {
    const tiles = new Map();
    const world = {
        width: 40, height: 30, day, season: 'Spring', activeEvents: [],
        getTile(q, r) {
            if (r < 0 || r >= 30) return null;
            const key = `${((q % 40) + 40) % 40},${r}`;
            if (!tiles.has(key)) tiles.set(key, { q, r, terrain: GRASS, temperature, settlement });
            return tiles.get(key);
        },
    };
    world.weather = new WeatherSystem(world);
    return world;
}

// Pin the weather a test needs, regardless of the noise fields.
function forceWeather(world, type) {
    world.weather.getWeather = () => ({ type, intensity: 1 });
}

describe('WeatherSystem', () => {
    it('is a pure function of hex and day — reading it draws no randomness', () => {
        const world = makeWorld();
        Utils.setSeed(42);
        const before = Utils.random();
        Utils.setSeed(42);
        for (let d = 1; d < 50; d++) world.weather.getWeather(5, 5, d);
        expect(Utils.random()).toBe(before);

        const a = world.weather.getWeather(12, 7, 33).type;
        expect(world.weather.getWeather(12, 7, 33).type).toBe(a);
    });

    it('changes over the days and produces rain somewhere in a temperate land', () => {
        const world = makeWorld();
        const seen = new Set();
        for (let d = 1; d <= 120; d++) {
            for (let q = 0; q < 40; q += 5) seen.add(world.weather.getWeather(q, 10, d).type);
        }
        expect(seen.has('rain')).toBe(true);
        expect(seen.has('clear')).toBe(true);
    });

    it('snows in cold lands in winter but rains there in summer', () => {
        const world = makeWorld({ temperature: 0.4 });
        const types = (from) => {
            const s = new Set();
            for (let d = from; d < from + 30; d++) for (let q = 0; q < 40; q += 2) s.add(world.weather.getWeather(q, 12, d).type);
            return s;
        };
        expect(types(91).has('snow')).toBe(true);   // winter: 0.4 - 0.15 < 0.3
        expect(types(31).has('snow')).toBe(false);  // summer
    });

    it('survives a save round-trip with the same pattern', () => {
        const a = makeWorld();
        const b = makeWorld();
        b.weather.deserialize(a.weather.serialize());
        for (let d = 1; d < 20; d++) {
            expect(b.weather.getWeather(3, 9, d).type).toBe(a.weather.getWeather(3, 9, d).type);
        }
    });

    it('describes its effects and gives a forecast', () => {
        const world = makeWorld();
        expect(world.weather.describeEffects('snow')).toContain('Travel −25%');
        expect(world.weather.describeEffects('clear')).toBe('');
        expect(world.weather.getForecast(1, 1, 3)).toHaveLength(3);
    });
});

describe('Weather — the player on the road', () => {
    const makePlayer = (over = {}) => ({ q: 4, r: 4, health: 100, movementRemaining: 20, army: [], ...over });

    it('slows travel in snow, half as much on a road', () => {
        const world = makeWorld();
        forceWeather(world, 'snow');
        const p = makePlayer();
        WorldEvents.applyPlayerDailyEffects(world, p);
        expect(p.movementRemaining).toBe(15);

        world.getTile(4, 4).hasRoad = true;
        const onRoad = makePlayer();
        WorldEvents.applyPlayerDailyEffects(world, onRoad);
        expect(onRoad.movementRemaining).toBe(18);
    });

    it('a night in the open in a blizzard costs health; shelter or a camp helps', () => {
        const world = makeWorld();
        forceWeather(world, 'blizzard');
        const rough = makePlayer({ _lastRestType: 'outdoors' });
        const res = WorldEvents.applyPlayerDailyEffects(world, rough);
        expect(rough.health).toBe(100 - WEATHER_EFFECTS.blizzard.exposure);
        expect(res.weatherHealthLost).toBe(WEATHER_EFFECTS.blizzard.exposure);

        const camped = makePlayer({ _lastRestType: 'camp' });
        WorldEvents.applyPlayerDailyEffects(world, camped);
        expect(camped.health).toBe(100 - Math.ceil(WEATHER_EFFECTS.blizzard.exposure / 2));

        const housed = makePlayer({ _lastRestType: 'ownHouse' });
        WorldEvents.applyPlayerDailyEffects(world, housed);
        expect(housed.health).toBe(100);

        const town = makeWorld({ settlement: { name: 'Town' } });
        forceWeather(town, 'blizzard');
        const inTown = makePlayer({ _lastRestType: 'outdoors' });
        WorldEvents.applyPlayerDailyEffects(town, inTown);
        expect(inTown.health).toBe(100);
    });

    it('fair weather changes nothing', () => {
        const world = makeWorld();
        forceWeather(world, 'clear');
        const p = makePlayer();
        WorldEvents.applyPlayerDailyEffects(world, p);
        expect(p.movementRemaining).toBe(20);
        expect(p.health).toBe(100);
    });
});

describe('Weather — battles', () => {
    it('rain blunts archers and snow bogs down cavalry', () => {
        const archers = { archer: 1, cavalry: 0, pikeman: 0 };
        const horse = { archer: 0, cavalry: 1, pikeman: 0 };
        const pikes = { archer: 0, cavalry: 0, pikeman: 1 };
        expect(PlayerMilitary._weatherMultiplier('rain', archers)).toBeCloseTo(0.85);
        expect(PlayerMilitary._weatherMultiplier('snow', horse)).toBeCloseTo(0.8);
        expect(PlayerMilitary._weatherMultiplier('storm', pikes)).toBe(1);
        expect(PlayerMilitary._weatherMultiplier('clear', archers)).toBe(1);
    });

    it('reads the weather at the player for the battle report', () => {
        const world = makeWorld();
        forceWeather(world, 'storm');
        const player = { q: 1, r: 1 };
        expect(PlayerMilitary._battleWeather(player, { world })).toBe('storm');
        expect(PlayerMilitary._battleWeather(player, {})).toBe('clear');
    });
});

describe('Weather — storms at sea', () => {
    const makePlayer = (status) => ({
        gold: 1000,
        ships: [{ id: 's1', name: 'Gull', typeId: 'cog', status, q: 2, r: 2, destQ: 9, destR: 2, travelDaysLeft: 3, condition: 100, cargo: { timber: 20 } }],
    });

    it('batters ships under way and can hold them back', () => {
        Utils.setSeed(3);
        const world = makeWorld();
        forceWeather(world, 'storm');
        let delayed = 0;
        let damaged = 0;
        for (let i = 0; i < 20; i++) {
            const player = makePlayer('moving');
            const res = Ships.processDaily(player, world);
            const ship = player.ships[0];
            if (ship.condition < 100) damaged++;
            if (ship.travelDaysLeft === 3) delayed++;
            expect(res.stormReports).toHaveLength(1);
        }
        expect(damaged).toBe(20);
        expect(delayed).toBeGreaterThan(0);
        expect(delayed).toBeLessThan(20);
    });

    it('a docked ship rides out the storm in harbour', () => {
        const world = makeWorld();
        forceWeather(world, 'storm');
        const player = makePlayer('docked');
        const res = Ships.processDaily(player, world);
        expect(res.stormReports).toHaveLength(0);
        expect(player.ships[0].condition).toBeGreaterThanOrEqual(99);
    });
});

describe('Weather — world units and kingdom campaigns', () => {
    it('blizzards halve a marching unit; storms slow ships; fair weather changes nothing', () => {
        const world = makeWorld();
        const caravan = new WorldUnit('caravan', 3, 3, 9, 3);
        caravan.speed = 4;
        forceWeather(world, 'blizzard');
        expect(caravan.stepsToday(world)).toBe(2);
        const ship = new WorldUnit('ship', 3, 3, 9, 3);
        ship.speed = 6;
        forceWeather(world, 'storm');
        expect(ship.stepsToday(world)).toBe(3);
        forceWeather(world, 'clear');
        expect(caravan.stepsToday(world)).toBe(4);
        expect(caravan.stepsToday(null)).toBe(4);
    });

    it('snow at the front makes pitched battles rarer', () => {
        const world = makeWorld();
        const a = { capital: { q: 1, r: 1 } };
        const b = { capital: { q: 5, r: 5 } };
        forceWeather(world, 'snow');
        expect(KingdomAI.campaignWeather(a, b, world)).toBeCloseTo(0.75);
        forceWeather(world, 'clear');
        expect(KingdomAI.campaignWeather(a, b, world)).toBe(1);
    });
});
