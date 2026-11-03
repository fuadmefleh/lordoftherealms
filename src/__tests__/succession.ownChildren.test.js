// A married heir comes to the seat with the children born in their marriage
// (Relationships._heirsOwnChildren). Before, an heir brought a spouse but no
// children, so a line went on only through the new ruler's late children and
// an heir who inherited at fifty ended it.
import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let n = 0;
function grown(extra = {}) {
    const c = {
        id: `own_${n++}`, firstName: 'Ada', dynasty: 'Harness', gender: 'female', age: 30, isAlive: true, traits: [],
        strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c).comeOfAge = true;
    return c;
}

function succeed(game, heir, roll) {
    const orig = Utils.random;
    Utils.random = () => roll;
    try {
        return Relationships.succeedAsHeir(game.player, heir.id, game.world, {});
    } finally {
        Utils.random = orig;
    }
}

describe('a married heir\'s own children', () => {
    it('come to the seat with them, of the ages they would be, as the ruler\'s own', () => {
        const game = newGame(81);
        const { player, world } = game;
        world.day = 120 * 30;
        const heir = grown({ age: 30 });
        // Wed ten years ago to a lord of a realm
        const k = world.kingdoms.find(x => x.isAlive);
        heir.upbringing.spouse = { kind: 'alliance', kingdomId: k.id, kingdomName: k.name, name: 'Bram of Somewhere', day: world.day - 120 * 10 };
        const sib = grown({ age: 25, firstName: 'Cass' });
        player.children = [heir, sib];
        const res = succeed(game, heir, 0); // every year's chance comes up
        expect(res.success).toBe(true);
        expect(player.spouse).toBeTruthy();
        const own = player.children.filter(c => !c.isSibling);
        expect(res.ownChildren.length).toBeGreaterThan(0);
        expect(own).toHaveLength(res.ownChildren.length);
        expect(own.length).toBeLessThanOrEqual(Relationships._getHeirSettings().maxChildren);
        // Born within the marriage: no older than the years wed
        for (const c of own) {
            expect(c.age).toBeGreaterThanOrEqual(1);
            expect(c.age).toBeLessThanOrEqual(10);
            expect(c.birthDay).toBe(world.day - c.age * 120);
        }
        // The sibling stays a sibling; the eldest own child is the heir
        expect(player.children.find(c => c.firstName === 'Cass').isSibling).toBe(true);
        expect(Relationships.getEligibleHeirs(player).map(c => c.firstName)).toEqual(['Cass']); // the children are too young yet
        expect(player.heir).toBe(own[0].id);
    }, 60000);

    it('come even when the spouse is gone (a townsperson since dead): the heir is widowed, not childless', () => {
        const game = newGame(85);
        const { player, world } = game;
        world.day = 120 * 40;
        const heir = grown({ age: 32, gender: 'male', firstName: 'Bram' });
        heir.upbringing.spouse = { kind: 'local', folkUid: '0,0#9999', townName: 'Nowhere', role: 'farmer', name: 'Edda Gone', day: world.day - 120 * 12 };
        player.children = [heir];
        const res = succeed(game, heir, 0);
        expect(player.spouse).toBeNull();
        expect(res.ownChildren.length).toBeGreaterThan(0);
        expect(player.children.filter(c => !c.isSibling)).toHaveLength(res.ownChildren.length);
    }, 60000);

    it('none for an unwed heir, or when the dice say no, or past the age for children', () => {
        const game = newGame(82);
        const { player, world } = game;
        world.day = 120 * 40;
        const single = grown({ age: 30 });
        player.children = [single];
        expect(succeed(game, single, 0).ownChildren).toEqual([]);

        const g2 = newGame(83);
        g2.world.day = 120 * 40;
        const k = g2.world.kingdoms.find(x => x.isAlive);
        const unlucky = grown({ age: 30 });
        unlucky.upbringing.spouse = { kind: 'alliance', kingdomId: k.id, kingdomName: k.name, name: 'Bram of Somewhere', day: g2.world.day - 120 * 10 };
        g2.player.children = [unlucky];
        expect(succeed(g2, unlucky, 0.99).ownChildren).toEqual([]);

        // Wed at 55 and inheriting at 60: past the age for children
        const g3 = newGame(84);
        g3.world.day = 120 * 40;
        const old = grown({ age: 60 });
        old.upbringing.spouse = { kind: 'alliance', kingdomId: k.id, kingdomName: k.name, name: 'Bram of Somewhere', day: g3.world.day - 120 * 5 };
        g3.player.children = [old];
        expect(succeed(g3, old, 0).ownChildren).toEqual([]);
    }, 60000);
});
