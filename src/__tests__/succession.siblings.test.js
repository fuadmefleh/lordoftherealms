// After a succession the late ruler's other children stay in player.children
// as the new ruler's siblings (a grown sibling can be regent). They were not
// marked, so the death screen offered an aged sister as "one of your
// children" before the ruler's own, and they counted against the cap on
// children, so a ruler with several siblings could have none of their own.
import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let n = 0;
function kid(player, extra = {}) {
    const c = {
        id: `sib_${n++}`, firstName: 'Wynn', dynasty: 'Harness', gender: 'male', age: 20, isAlive: true, traits: [],
        strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    return c;
}

describe('siblings after a succession', () => {
    it('are marked, listed after the ruler\'s own children, and do not fill the nursery', () => {
        const game = newGame(77);
        const { player, world } = game;
        const heir = kid(player, { age: 30, firstName: 'Ada' });
        const elder = kid(player, { age: 45, firstName: 'Bram' });
        const younger = kid(player, { age: 25, firstName: 'Cass' });
        player.children = [heir, elder, younger];
        expect(Relationships.succeedAsHeir(player, heir.id, world, {}).success).toBe(true);
        expect(player.children.map(c => [c.firstName, c.isSibling])).toEqual([['Bram', true], ['Cass', true]]);

        // A child of the new ruler's own, younger than every sibling, still comes first
        const own = kid(player, { age: 17, firstName: 'Dara' });
        player.children.push(own);
        expect(Relationships.getEligibleHeirs(player).map(c => c.firstName)).toEqual(['Dara', 'Bram', 'Cass']);

        // Siblings don't count against maxChildren: with six of them a child can still be born
        for (let i = 0; i < 6; i++) player.children.push(kid(player, { isSibling: true }));
        const spouse = Relationships.generateNPC({ name: 'Town', kingdom: null }, world);
        spouse.gender = player.gender === 'male' ? 'female' : 'male';
        spouse.age = 30;
        player.age = 30;
        player.spouse = spouse.id;
        Relationships.getRelationship(player, spouse.id).affection = 100;
        world.day = 120 * 40;
        const orig = Utils.random;
        Utils.random = () => 0;
        let born;
        try { born = Relationships.checkChildbirth(player, world); } finally { Utils.random = orig; }
        expect(born).toBeTruthy();
    }, 60000);
});
