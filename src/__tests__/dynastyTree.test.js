// The family tree: every generation kept across successions, spouses linked
// to the Houses they came from, the line of succession, and a pure build()
// the tree panel and the chronicle book read.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Relationships } from '../systems/relationships.js';
import { House } from '../systems/house.js';
import { DynastyTree } from '../systems/dynastyTree.js';

const npc = id => Relationships.getNPC(id);

function wed(game) {
    const s = game.world.getSettlementViews()[0];
    const tile = game.world.getTile(s.q, s.r);
    const spouse = Relationships.generateNPC(tile.settlement || { name: s.name, kingdom: s.kingdom }, game.world);
    if (!Relationships.getNPC(spouse.id)) Relationships._npcs.push(spouse);
    spouse.gender = game.player.gender === 'female' ? 'male' : 'female';
    game.player.spouse = spouse.id;
    game.player.marriageDay = game.world.day;
    return spouse;
}

function child(game, spouse, age) {
    const c = Relationships.generateChild(game.player, spouse, game.world, { quiet: true });
    c.age = age;
    c.birthDay = Math.max(1, game.world.day - age * 120);
    if (c.upbringing) c.upbringing.comeOfAge = age >= 16;
    return c;
}

beforeAll(async () => {
    await loadData();
});

describe('DynastyTree', () => {
    it('a new House is one ruler, and build() does not write the lineage', () => {
        const game = newGame(101);
        expect(game.player.house).toBeTruthy();
        const tree = DynastyTree.build(game.player, game.world);
        expect(game.player.house.lineage).toBeUndefined();
        expect(tree.nodes.length).toBeGreaterThanOrEqual(1);
        const me = tree.nodes.find(n => n.current);
        expect(me.ruler).toBe(true);
        expect(me.name).toBe(game.player.name);
        expect(tree.layout[me.id]).toBeTruthy();
    });

    it('keeps the spouse, the children and the line of succession', () => {
        const game = newGame(102);
        game.world.day = 2400;
        const spouse = wed(game);
        const a = child(game, spouse, 20);
        const b = child(game, spouse, 12);
        game.player.heir = b.id;
        DynastyTree.sync(game.player, game.world, { npc });
        const tree = DynastyTree.build(game.player, game.world);
        const me = tree.nodes.find(n => n.current);
        const sp = tree.nodes.find(n => n.kind === 'spouse');
        expect(sp.name).toContain(spouse.firstName);
        expect(me.spouses).toContain(sp.id);
        expect(tree.edges.some(e => e.kind === 'spouse')).toBe(true);
        const ka = tree.nodes.find(n => n.id === a.id);
        expect(ka.parents).toEqual([me.id, sp.id]);
        // the designated heir leads the line, then the eldest
        expect(tree.succession).toEqual([b.id, a.id]);
        expect(tree.nodes.find(n => n.id === b.id).successionRank).toBe(1);
        // children sit a row below their parents, the spouse beside the ruler
        expect(tree.layout[a.id].y).toBe(tree.layout[me.id].y + 1);
        expect(tree.layout[sp.id].y).toBe(tree.layout[me.id].y);
        expect(tree.layout[sp.id].x).not.toBe(tree.layout[me.id].x);
    });

    it('three generations survive two successions; the dead keep their reign and cause', () => {
        const game = newGame(103);
        game.world.day = 4000;
        const founder = game.player.name;
        let spouse = wed(game);
        const heir1 = child(game, spouse, 22);
        const sib = child(game, spouse, 18);
        sib.upbringing = sib.upbringing || {};
        sib.upbringing.spouse = { kind: 'alliance', kingdomId: game.world.kingdoms[0].id, kingdomName: game.world.kingdoms[0].name, name: 'Mira of Elsewhere', day: 3900 };
        DynastyTree.sync(game.player, game.world, { npc });
        const r1 = Relationships.succeedAsHeir(game.player, heir1.id, game.world, { cause: 'fever' });
        expect(r1.success).toBe(true);
        game.world.day = 6500;
        spouse = wed(game);
        const heir2 = child(game, spouse, 20);
        DynastyTree.sync(game.player, game.world, { npc });
        const r2 = Relationships.succeedAsHeir(game.player, heir2.id, game.world, { cause: 'slain in battle' });
        expect(r2.success).toBe(true);
        DynastyTree.sync(game.player, game.world, { npc });

        const tree = DynastyTree.build(game.player, game.world);
        expect(tree.rulers.length).toBe(3);
        const [g1, g2, g3] = tree.rulers.map(id => tree.nodes.find(n => n.id === id));
        expect(g1.name).toBe(founder);
        expect(g1.alive).toBe(false);
        expect(g1.cause).toBe('fever');
        expect(g1.reign && g1.reign.to).toBeGreaterThan(0);
        expect(g2.id).toBe(heir1.id);
        expect(g2.cause).toBe('slain in battle');
        expect(g3.id).toBe(heir2.id);
        expect(g3.current).toBe(true);
        expect(g3.parents).toContain(g2.id);
        expect(g2.parents).toContain(g1.id);
        // the sibling wed out: a cadet line, still in the line of succession
        const s = tree.nodes.find(n => n.id === sib.id);
        expect(s.branch).toMatch(/cadet line/);
        expect(s.spouses.length).toBe(1);
        expect(tree.nodes.find(n => n.id === s.spouses[0]).origin.kingdom).toBe(game.world.kingdoms[0].name);
        // generations stack: each ruler a row below the last
        expect(tree.layout[g2.id].y).toBe(tree.layout[g1.id].y + 1);
        expect(tree.layout[g3.id].y).toBe(tree.layout[g2.id].y + 1);
        // no two cards share a place
        const spots = new Set(Object.values(tree.layout).map(p => `${p.x}|${p.y}`));
        expect(spots.size).toBe(tree.nodes.length);
        // a life
        const life = DynastyTree.lifeSummary(game.player, game.world, g1.id);
        expect(life.lines.some(l => /^Died/.test(l.text))).toBe(true);
        expect(life.reignKey).toBeTruthy();
    });

    it('the lineage saves with the House', () => {
        const game = newGame(104);
        DynastyTree.sync(game.player, game.world, { npc });
        const data = House.serialize(game.player.house);
        const p2 = { ...game.player };
        House.deserialize(p2, game.world, data);
        expect(p2.house.lineage.currentId).toBe(game.player.house.lineage.currentId);
        expect(Object.keys(p2.house.lineage.people).length).toBe(Object.keys(game.player.house.lineage.people).length);
    });
});
