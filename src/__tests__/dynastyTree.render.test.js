// The Family Tree and Heirlooms panels build on a real harness world, their
// buttons run without throwing, and nothing undefined/NaN reaches the player.
// The canvas painter draws a three-generation tree into a recording context.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Relationships } from '../systems/relationships.js';
import { DynastyTree } from '../systems/dynastyTree.js';
import { Heirlooms } from '../systems/heirlooms.js';

let ActionMenu;
let drawTree;
let hitNode;
let nodeRect;
let panels;
let notes;

function stubGame(seed) {
    const g = newGame(seed);
    g.player.gold = 5000;
    panels = [];
    notes = [];
    g.ui = {
        showCustomPanel: (title, html) => panels.push({ title, html }),
        hideCustomPanel: () => {},
        showNotification: (t, m) => notes.push(`${t} ${m}`),
        updateStats: () => {},
        setPanelNav: () => {},
    };
    g.endDay = () => {};
    return g;
}

function clean(text) {
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
}

function last() {
    const p = panels[panels.length - 1];
    clean(p.html);
    clean(p.title);
    return p;
}

function recordingCtx() {
    const calls = [];
    const handler = {
        get(t, k) {
            if (k === 'canvas') return { width: 900, height: 460 };
            if (k === 'measureText') return s => ({ width: String(s).length * 6 });
            if (k in t) return t[k];
            return (...args) => { calls.push([k, ...args]); };
        },
        set(t, k, v) { t[k] = v; return true; },
    };
    return { ctx: new Proxy({}, handler), calls };
}

function family(game) {
    game.world.day = 4000;
    const s = game.world.getSettlementViews()[0];
    const tile = game.world.getTile(s.q, s.r);
    const wed = () => {
        const sp = Relationships.generateNPC(tile.settlement || { name: s.name, kingdom: s.kingdom }, game.world);
        if (!Relationships.getNPC(sp.id)) Relationships._npcs.push(sp);
        game.player.spouse = sp.id;
        return sp;
    };
    let sp = wed();
    const kid = (age) => {
        const c = Relationships.generateChild(game.player, sp, game.world, { quiet: true });
        c.age = age;
        c.birthDay = Math.max(1, game.world.day - age * 120);
        return c;
    };
    const h1 = kid(20);
    kid(15);
    Heirlooms.create(game.player, game.world, { kind: 'crown' });
    Heirlooms.create(game.player, game.world, { kind: 'sword' });
    DynastyTree.sync(game.player, game.world, { npc: id => Relationships.getNPC(id) });
    Relationships.succeedAsHeir(game.player, h1.id, game.world, { cause: 'a fall from a horse' });
    game.world.day = 6000;
    sp = wed();
    kid(10);
    DynastyTree.sync(game.player, game.world, { npc: id => Relationships.getNPC(id) });
}

beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    ({ drawTree, hitNode, nodeRect } = await import('../ui/actionMenu/dynastyTree.js'));
    ActionMenu.commitPendingAP = () => true;
}, 180000);

describe('family tree & heirloom panels', () => {
    it('the tree panel renders every generation and each person\'s life', () => {
        const game = stubGame(301);
        family(game);
        ActionMenu.showDynastyTree(game);
        const p = last();
        expect(p.title).toMatch(/Family Tree/);
        expect(p.html).toContain('dtCanvas');
        expect(p.html).toMatch(/Generations/);
        const tree = DynastyTree.build(game.player, game.world);
        for (const n of tree.nodes) {
            ActionMenu.dynastyTreeSelect(game, n.id);
            const html = last().html;
            expect(html).toContain(n.name.split(' ')[0]);
        }
        // the dead founder's card tells the cause
        const founder = tree.nodes.find(n => n.id === tree.rulers[0]);
        ActionMenu.showDynastyTree(game, { focus: founder.id });
        expect(last().html).toMatch(/a fall from a horse/);
    });

    it('the heirlooms panels render and their actions run', () => {
        const game = stubGame(302);
        family(game);
        ActionMenu.showHeirlooms(game);
        expect(last().html).toMatch(/In hand/);
        const [crown] = Heirlooms.list(game.player);
        ActionMenu.showHeirloom(game, crown.id);
        expect(last().html).toMatch(/Its story/);
        expect(last().html).toMatch(/Passed to/);
        const kid = game.player.children.find(c => !c.isSibling && c.isAlive !== false);
        ActionMenu.heirloomAct(game, crown.id, 'give', kid.id);
        last();
        ActionMenu.heirloomAct(game, crown.id, 'takeBack');
        last();
        const s = game.world.getSettlementViews()[0];
        game.player.q = s.q; game.player.r = s.r;
        ActionMenu.heirloomAct(game, crown.id, 'pawn');
        last();
        ActionMenu.heirloomAct(game, crown.id, 'redeem');
        last();
        game.player.inventory.relics = 1;
        ActionMenu.heirloomForge(game, 'relics');
        last();
        for (const n of notes) clean(n);
    });

    it('the painter draws cards, lines and portraits, and clicks find people', () => {
        const game = stubGame(303);
        family(game);
        const tree = DynastyTree.build(game.player, game.world);
        const { ctx, calls } = recordingCtx();
        let portraits = 0;
        drawTree(ctx, tree, { scale: 1, ox: 0, oy: 0, selected: tree.current }, { portrait: () => { portraits++; return false; } });
        expect(portraits).toBe(tree.nodes.length);
        const texts = calls.filter(c => c[0] === 'fillText').map(c => String(c[1]));
        for (const t of texts) clean(t);
        expect(texts.some(t => t.includes('†'))).toBe(true);
        expect(calls.filter(c => c[0] === 'lineTo').length).toBeGreaterThan(tree.nodes.length);
        const r = nodeRect(tree, tree.current);
        expect(hitNode(tree, r.x + 5, r.y + 5).id).toBe(tree.current);
        expect(hitNode(tree, -100, -100)).toBeNull();
    });
});
