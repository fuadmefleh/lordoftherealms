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
