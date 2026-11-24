// The scaffold on the street map (world/scaffolds.js, world/innerMap/scaffoldCrowd.js): a
// proclaimed execution raises the gallows, the block or the stake in the town's square until
// its day (systems/executions.js writes settlement.scaffold), and on the day the town's grown
// folk come and stand packed before it.
import { describe, it, expect, beforeAll } from 'vitest';

let DataLoader, CustomObjects, Scaffolds, InnerMap, Executions;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    ({ DataLoader } = await import('../core/dataLoader.js'));
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ Scaffolds } = await import('../world/scaffolds.js'));
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ Executions } = await import('../systems/executions.js'));
    CustomObjects.reset();
    await CustomObjects.loadAll();
}, 120000);

/** A 40x30 paved town with a square at (14..26, 8..20). */
function town() {
    const tiles = Array.from({ length: 30 }, (_, r) => Array.from({ length: 40 }, (_, q) => ({
        q, r, explored: true, visible: true, isRoad: true, subTerrain: { id: 'cobble', passable: true },
    })));
    return { tiles, plaza: { q: 14, r: 8, w: 12, h: 12 }, center: { q: 20, r: 14 } };
}

describe('the scaffold in the square', () => {
    it('the props are registered: gallows, block, stake', () => {
        for (const id of ['ex_gallows', 'ex_block', 'ex_stake', 'ex_pillory']) expect(CustomObjects.getDef(id), id).toBeTruthy();
    });

    it('stands from the proclamation to the day, by the manner: the gallows for a hanging, the stake for a burning', () => {
        const s = { name: 'Ashford', scaffold: { id: 'p1', from: 100, day: 102, method: 'hang', name: 'Nell Cole' } };
        expect(Scaffolds.current(s, 99)).toBe(null);
        expect(Scaffolds.stamp(s, 101)).toMatch(/ex_gallows/);
        expect(Scaffolds.isTheDay(s, 102)).toBe(true);
        expect(Scaffolds.stamp(s, 103)).toBe('');
        const { tiles, plaza, center } = town();
        const at = Scaffolds.lay(tiles, s, 101, { plaza, center });
        expect(at).toBeTruthy();
        expect(tiles[at.r][at.q].customObject.defId).toBe('ex_gallows');
        expect(tiles[at.r][at.q].customObject.scaffold).toBe('p1');
        // (in the square)
        expect(at.q).toBeGreaterThanOrEqual(plaza.q);
        expect(at.q).toBeLessThanOrEqual(plaza.q + plaza.w);
        expect(at.r).toBeLessThanOrEqual(plaza.r + plaza.h);
        const burn = town();
        s.scaffold.method = 'burn';
        const b = Scaffolds.lay(burn.tiles, s, 101, burn);
        expect(burn.tiles[b.r][b.q].customObject.defId).toBe('ex_stake');
    });

    it('on the day, townsfolk walk to the scaffold and stand before it facing it', () => {
        const s = { name: 'Ashford', scaffold: { id: 'p2', from: 50, day: 52, method: 'behead', name: 'Sir Odo' } };
        const { tiles, plaza, center } = town();
        const at = Scaffolds.lay(tiles, s, 52, { plaza, center });
        InnerMap.tiles = tiles;
        InnerMap.width = 40;
        InnerMap.height = 30;
        InnerMap.worldDay = 52;
        InnerMap.timeOfDay = 11;
        InnerMap._timeAccumulator = 0;
        InnerMap.playerInnerQ = 0;
        InnerMap.playerInnerR = 0;
        InnerMap.npcs = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, uid: `f${i}`, type: 'villager', q: 2 + (i % 10), r: 25 + Math.floor(i / 10), state: 'idle' }));
        let going = 0;
        for (const n of InnerMap.npcs) if (InnerMap._scaffoldPick(n)) going++;
        expect(going).toBeGreaterThan(10);
        const walker = InnerMap.npcs.find(n => n.state === 'walking');
        const goal = walker.path[walker.path.length - 1];
        expect(goal.r).toBeGreaterThan(at.r);
        expect(Math.abs(goal.q - (at.q + 1))).toBeLessThanOrEqual(8);
        // Standing in place: idle, facing the scaffold
        walker.q = goal.q; walker.r = goal.r;
        expect(InnerMap._scaffoldPick(walker)).toBe(true);
        expect(walker.state).toBe('idle');
        expect(walker.facing).toBe(0);
        // Not the day, and out of the hours: few or none
        InnerMap.timeOfDay = 20;
        expect(InnerMap.npcs.filter(n => InnerMap._scaffoldPick(n)).length).toBe(0);
    });

    it('proclaiming writes the scaffold on the town; a mercy before the day takes it down', async () => {
        const { Utils } = await import('../core/utils.js');
        Utils.setSeed(5);
        const folk = { q: 3, r: 4, n: 1, people: [{ id: 0, first: 'Nell', last: 'Cole', gender: 'female', born: -40 * 360, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [] }], annals: [] };
        const kingdom = { id: 1, name: 'Varn', isAlive: true, stability: 60, laws: {}, capital: { q: 3, r: 4 } };
        const s = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk, economy: { gold: 500 }, type: 'town', population: 600, happiness: 55 };
        const world = { day: 300, generationParams: { seed: 3 }, kingdoms: [kingdom], events: [], getTile: (q, r) => (q === 3 && r === 4 ? { q, r, settlement: s } : null), getSettlementViews: () => [s], getKingdom: (id) => (String(id) === '1' ? kingdom : null) };
        const p = { name: 'Aldric', gender: 'male', gold: 100, karma: 0, reputation: {}, q: 0, r: 0, house: { name: 'House V', prestige: 50, history: [], rivals: {} }, children: [], throne: { ruling: { kingdomId: 1 } } };
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 0 }, { crime: 'heresy', guilty: true, quiet: true });
        expect(Executions.proclaim(p, world, e.id, 'hang', '3,4').success).toBe(true);
        expect(s.scaffold.method).toBe('hang');
        expect(Scaffolds.current(s, 301)).toBeTruthy();
        expect(Executions.spare(p, world, e.id, 'pardon').success).toBe(true);
        expect(s.scaffold).toBeUndefined();
    });
});

describe('the pillory and the scaffold up close', () => {
    function setting() {
        const folk = { q: 3, r: 4, n: 1, people: [{ id: 0, first: 'Nell', last: 'Cole', gender: 'female', born: -40 * 360, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [] }], annals: [] };
        const kingdom = { id: 1, name: 'Varn', isAlive: true, stability: 60, laws: { mutilation: 'old', punishment: 'harsh' }, capital: { q: 3, r: 4 } };
        const s = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk, economy: { gold: 500 }, type: 'town', population: 600, happiness: 55 };
        const world = { day: 300, generationParams: { seed: 3 }, kingdoms: [kingdom], events: [], getTile: (q, r) => (q === 3 && r === 4 ? { q, r, settlement: s } : null), getSettlementViews: () => [s], getKingdom: (id) => (String(id) === '1' ? kingdom : null) };
        const p = { name: 'Aldric', gender: 'male', gold: 100, karma: 0, reputation: {}, q: 3, r: 4, house: { name: 'House V', prestige: 50, history: [], rivals: {} }, children: [], throne: { ruling: { kingdomId: 1 } } };
        return { s, world, p, kingdom };
    }

    it('the pillory stands in the square while someone sits in the stocks, beside the scaffold', () => {
        const s = { name: 'Ashford', scaffold: { id: 'p1', from: 100, day: 102, method: 'hang', name: 'Nell Cole' }, pillory: { ref: 'h1', name: 'Tam Reed', from: 100, until: 103 } };
        expect(Scaffolds.stamp(s, 101)).toMatch(/pil:h1/);
        expect(Scaffolds.stamp(s, 104)).toBe('');
        const { tiles, plaza, center } = town();
        const at = Scaffolds.lay(tiles, s, 101, { plaza, center });
        expect(tiles[at.r][at.q].customObject.defId).toBe('ex_gallows');
        const pl = Scaffolds.pilloryAt(tiles);
        expect(pl).toBeTruthy();
        expect(tiles[pl.r][pl.q].customObject.defId).toBe('ex_pillory');
        expect(tiles[pl.r][pl.q].customObject.pillory).toBe('h1');
        // (no one in the stocks: no pillory)
        const bare = town();
        Scaffolds.lay(bare.tiles, { name: 'Ashford', pillory: { ref: 'h1', from: 1, until: 3 } }, 9, bare);
        expect(Scaffolds.pilloryAt(bare.tiles)).toBe(null);
    });

    it('atTown names the condemned here, the deaths the faith allows and the realm\'s punishments', () => {
        const { world, p } = setting();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 0 }, { crime: 'murder', guilty: true, quiet: true });
        Executions.proclaim(p, world, e.id, 'hang', '3,4');
        Executions.worldState(world).public.push({ id: 77, q: 3, r: 4, town: 'Ashford', kingdomId: 1, day: 300, name: 'Wat Fen', crime: 'theft', crimeLabel: 'theft', method: 'hang', resolved: false });
        const at = Executions.atTown(p, world, 3, 4);
        expect(at.town).toBe('Ashford');
        expect(at.realm).toBe('Varn');
        expect(at.condemned.map(c => c.name)).toEqual(['Wat Fen', 'Nell Cole']);
        expect(at.condemned[0].today).toBe(true);
        expect(at.condemned[1].kind).toBe('yours');
        expect(at.methods.map(m => m.id)).toEqual(expect.arrayContaining(['hang', 'behead', 'burn', 'quarter']));
        expect(at.methods.find(m => m.id === 'hang').ok).toBe(true);
        expect(at.mutilation.id).toBe('old');
        expect(at.punishment.id).toBe('harsh');
        expect(at.fear).toBe(1);
    });

    it('clicking the scaffold on the street map gives a menu, and its rows reach the crowd and the panel', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { InnerMapScaffold } = await import('../ui/innerMapScaffold.js');
        const { world, p } = setting();
        Executions.worldState(world).public.push({ id: 78, q: 3, r: 4, town: 'Ashford', kingdomId: 1, day: 300, name: 'Wat Fen', crime: 'theft', crimeLabel: 'theft', method: 'hang', resolved: false, guilty: true, pid: null });
        const { tiles, plaza, center } = town();
        const s = { name: 'Ashford', scaffold: { id: 'a78', from: 298, day: 300, method: 'hang', name: 'Wat Fen' } };
        const at = Scaffolds.lay(tiles, s, 300, { plaza, center });
        InnerMap.tiles = tiles; InnerMap.width = 40; InnerMap.height = 30;
        const panels = [], notes = [];
        const game = { player: p, world, ui: { showCustomPanel: (t, h) => panels.push({ t: String(t), h: String(h) }), showNotification: (...a) => notes.push(a), hideCustomPanel() {}, updateStats() {} } };
        const items = InnerMapScaffold.menuItems(game, CustomObjects.getDef('ex_gallows'), at.q, at.r);
        expect(items.some(i => i.type === 'disabled' && /Wat Fen/.test(i.label))).toBe(true);
        const watch = items.find(i => i.action === 'scaffold_watch');
        expect(watch).toBeTruthy();
        expect(items.find(i => i.action === 'scaffold_panel')).toBeTruthy();
        // (nothing for a plain prop)
        expect(InnerMapScaffold.menuItems(game, { id: 'tp_bench' }, at.q, at.r)).toEqual([]);
        InnerMapScaffold.handle(game, items.find(i => i.action === 'scaffold_panel'));
        expect(panels[panels.length - 1].t).toContain('Ashford');
        expect(panels[panels.length - 1].h).toContain('Wat Fen');
        expect(panels[panels.length - 1].h).toContain('Mutilation');
        expect(InnerMapScaffold.handle(game, watch)).toBe(true);
        expect(Executions.worldState(world).public.find(e => e.id === 78).resolved).toBe(true);
        expect(ActionMenu.showScaffoldHere).toBeTypeOf('function');
    }, 120000);

    it('the playtest bot joins the crowd on the day and gives its word on the long-waiting condemned', async () => {
        const { scaffoldDay } = await import('./playtest/bot.js');
        const { world, p } = setting();
        Executions.worldState(world).public.push({ id: 79, q: 3, r: 4, town: 'Ashford', kingdomId: 1, day: 300, name: 'Wat Fen', crime: 'theft', crimeLabel: 'theft', method: 'hang', resolved: false, guilty: true, pid: null });
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 0 }, { crime: 'murder', guilty: true, quiet: true });
        const stats = {};
        scaffoldDay({ player: p, world }, stats);
        expect((stats.scaffoldWatched || 0) + (stats.scaffoldMercyCries || 0)).toBe(1);
        // (not yet a fortnight in the cells: no word given)
        expect(Executions.get(p, e.id).proclaimed).toBeFalsy();
        world.day += 14;
        scaffoldDay({ player: p, world }, stats);
        const after = Executions.get(p, e.id);
        expect(Boolean(after && after.proclaimed) || (stats.scaffoldPardoned || 0) > 0).toBe(true);
    }, 120000);
});
