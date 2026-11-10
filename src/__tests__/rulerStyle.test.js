// A crowned player's name and title (systems/throne.js, Kingdom.rulerStyle):
// the realm's own ruler title for the player's gender, and its proper name —
// "King of Valdoria", "Khatun of the Kharzun Khanate" — never "King of
// Khanate of …"; and a player with no surname is "Khan Wanderer", not
// "Khan Wanderer Wanderer".

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Kingdom } from '../world/kingdom.js';
import { Characters } from '../world/characters.js';
import { Throne } from '../systems/throne.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const realm = (name, culture = 'Imperial') => ({ name, culture });

describe('Kingdom.rulerStyle', () => {
    it('styles the ruler from the realm\'s type and proper name', () => {
        expect(Kingdom.rulerStyle(realm('Kingdom of Valdoria'), 'male').full).toBe('King of Valdoria');
        expect(Kingdom.rulerStyle(realm('Kingdom of Valdoria'), 'female').full).toBe('Queen of Valdoria');
        expect(Kingdom.rulerStyle(realm('Khanate of Kharzun', 'Nomadic'), 'male').full).toBe('Khan of the Kharzun Khanate');
        expect(Kingdom.rulerStyle(realm('Khanate of Kharzun', 'Nomadic'), 'female').full).toBe('Khatun of the Kharzun Khanate');
        expect(Kingdom.rulerStyle(realm('The Kharzun Khanate', 'Nomadic'), 'male').full).toBe('Khan of the Kharzun Khanate');
        expect(Kingdom.rulerStyle(realm('Sultanate of Ashkari', 'Desert'), 'female').full).toBe('Sultana of Ashkari');
        expect(Kingdom.rulerStyle(realm('Theocracy of Azurath', 'Religious'), 'female').full).toBe('High Priestess of the Azurath Theocracy');
        expect(Kingdom.rulerStyle(realm('Grand Duchy of Thornwall'), 'female').full).toBe('Grand Duchess of Thornwall');
        expect(Kingdom.rulerStyle(realm('Jarldom of Frostmark', 'Nordic'), 'male').full).toBe('Jarl of Frostmark');
    });

    it('a type with no title of its own, or no type at all, takes the culture\'s', () => {
        expect(Kingdom.rulerStyle(realm('Dominion of Miregloom', 'Swamp'), 'female').full).toBe('Witch-Queen of Miregloom');
        expect(Kingdom.rulerStyle(realm('Westmarch', 'Nomadic'), 'male').full).toBe('Khan of Westmarch');
        expect(Kingdom.rulerStyle(realm('Westmarch', 'Unknown'), 'female').full).toBe('Queen of Westmarch');
    });

    it('never doubles the realm\'s type into the title', () => {
        for (const k of DataLoader._gamedata.kingdoms.defaults) {
            for (const g of ['male', 'female']) {
                const s = Kingdom.rulerStyle(k, g).full;
                expect(s).not.toMatch(/ of (Kingdom|Khanate|Theocracy|Republic|Holds|Dominion|Conclave|Jarldom|Sultanate) of /);
                expect(s).not.toMatch(/ of (the )?(Kingdom|Khanate|Sultanate) of/);
            }
        }
    });
});

describe('a crowned player', () => {
    function crown(profile, culture, name) {
        Utils.setSeed(11);
        const world = new World(40, 30);
        world.generate({ kingdomCount: 4 });
        world.day = 100;
        const k = world.kingdoms.find(x => x.isAlive);
        k.name = name;
        k.culture = culture;
        const player = new Player(profile);
        player.gold = 20000;
        player.reputation = {};
        Relationships.initialize(player);
        House.initialize(player, world);
        Throne._takeThrone(player, world, k);
        return { world, player, k };
    }

    it('without a surname: "Khan Wanderer", titled Khan of the Kharzun Khanate', () => {
        const { player, k } = crown({ firstName: 'Wanderer', gender: 'male' }, 'Nomadic', 'Khanate of Kharzun');
        expect(player.house.name).toBe('House Wanderer');
        expect(k.ruler).toBe('Khan Wanderer');
        expect(Characters.getFullName(k.characterData.ruler)).toBe('Wanderer');
        expect(player.title).toBe('Khan of the Kharzun Khanate');
        expect(player.rulerTitle).toBe('Khan');
    });

    it('a queen of a kingdom, with her House name', () => {
        const { player, k, world } = crown({ firstName: 'Ysolde', lastName: 'Varn', gender: 'female' }, 'Imperial', 'Kingdom of Valdoria');
        expect(k.ruler).toBe('Queen Ysolde Varn');
        expect(player.title).toBe('Queen of Valdoria');
        // the daily tick keeps the style
        const out = { notices: [] };
        Throne._tickRuling(player, world, out);
        expect(player.title).toBe('Queen of Valdoria');
        expect(k.ruler).toBe('Queen Ysolde Varn');
    });

    it('a khatun, and the style survives a save', () => {
        const { player, k } = crown({ firstName: 'Borte', gender: 'female' }, 'Nomadic', 'Khanate of Kharzun');
        expect(k.ruler).toBe('Khatun Borte');
        expect(player.title).toBe('Khatun of the Kharzun Khanate');
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player))), back);
        expect(back.rulerTitle).toBe('Khatun');
    });
});
