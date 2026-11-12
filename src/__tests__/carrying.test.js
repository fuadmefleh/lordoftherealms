// Carrying someone senseless over the shoulder, and the blood a body leaves
// (systems/carrying.js; the street's eyes: systems/streetCrime.js foundReaction).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Carrying } from '../systems/carrying.js';
import { StreetCrime } from '../systems/streetCrime.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});
beforeEach(() => Utils.setSeed(7));

let nextId = 1;
const npc = (extra = {}) => ({ id: nextId++, type: 'villager', name: 'Bram', personalityTraits: [], state: 'unconscious', q: 5, r: 5, ...extra });

describe('Picking someone up', () => {
    it('only the senseless, not one already carried, and only with free hands', () => {
        expect(Carrying.canPickUp(npc()).ok).toBe(true);
        expect(Carrying.canPickUp(npc({ state: 'idle' })).reason).toBe('awake');
        expect(Carrying.canPickUp(npc({ _carried: true })).ok).toBe(false);
        expect(Carrying.canPickUp(npc(), { handsFull: true }).reason).toBe('hands full');
        expect(Carrying.canPickUp(npc(), { playerOut: true }).ok).toBe(false);
        expect(Carrying.canPickUp(null).ok).toBe(false);
    });

    it('slows the walk: the strong less, a child less still, never past the cap', () => {
        const C = Carrying.config().speed;
        const weak = Carrying.speedFactor({ strength: 5 }, npc());
        const strong = Carrying.speedFactor({ strength: 9 }, npc());
        const child = Carrying.speedFactor({ strength: 5 }, npc({ type: 'child' }));
        expect(weak).toBeCloseTo(C.base, 5);
        expect(strong).toBeGreaterThan(weak);
        expect(child).toBeGreaterThan(weak);
        expect(Carrying.speedFactor({ strength: 40 }, npc())).toBeLessThanOrEqual(C.max);
        expect(weak).toBeLessThan(1);
    });

    it('blocks what needs free hands, not walking, talking or the door', () => {
        for (const a of ['attack_npc', 'harvest_object', 'dig_hole', 'pickup_ground_item', 'ko_rob', 'carry_body']) expect(Carrying.handsBlocked(a)).toBe(true);
        for (const a of ['move_here', 'talk_npc', 'enter_building', 'exit_building', 'carry_put_down', 'carry_lay_bed', 'drop_body', 'bury_body']) expect(Carrying.handsBlocked(a)).toBe(false);
    });
});

describe('Putting them down', () => {
    it('on a free tile beside the player: the one clicked if it is free and beside them, else the first free around', () => {
        const free = (q, r) => !(q === 5 && r === 6);   // (the tile below is taken)
        expect(Carrying.dropSpot(5, 5, free)).toEqual({ q: 6, r: 5 });
        expect(Carrying.dropSpot(5, 5, free, { q: 4, r: 4 })).toEqual({ q: 4, r: 4 });
        // (a tile two away is no drop spot)
        expect(Carrying.dropSpot(5, 5, free, { q: 8, r: 5 })).toEqual({ q: 6, r: 5 });
        expect(Carrying.dropSpot(5, 5, () => false)).toBeNull();
    });

    it('on a bed: one beside the player that no one lies in', () => {
        const beds = { '6,5': { type: 'bed' }, '4,5': { type: 'bed' }, '5,4': { type: 'table' } };
        const at = (q, r) => beds[`${q},${r}`] || null;
        expect(Carrying.bedSpot(5, 5, at, () => false)).toEqual({ q: 6, r: 5 });
        expect(Carrying.bedSpot(5, 5, at, (q, r) => q === 6 && r === 5)).toEqual({ q: 4, r: 5 });
        expect(Carrying.bedSpot(5, 5, at, () => false, { q: 4, r: 5 })).toEqual({ q: 4, r: 5 });
        expect(Carrying.bedSpot(5, 5, at, () => true)).toBeNull();
        expect(Carrying.bedSpot(9, 9, at, () => false)).toBeNull();
    });
});

describe('Coming round on the shoulder', () => {
    it('the bold kick free in anger, the rest in fear, the same way every time', () => {
        const bold = npc({ personalityTraits: ['bold'] });
        const meek = npc({ personalityTraits: ['quiet'] });
        expect(Carrying.struggle(bold, 'd1').mood).toBe('anger');
        expect(Carrying.struggle(meek, 'd1').mood).toBe('fear');
        expect(Carrying.struggle(npc({ type: 'child', personalityTraits: ['bold'] })).mood).toBe('fear');
        const a = Carrying.struggle(meek, 'd1'), b = Carrying.struggle(meek, 'd1');
        expect(a.bark).toBeTruthy();
        expect(a).toEqual(b);
        // (no draw on the shared stream)
        Utils.setSeed(3); const x = Utils.random();
        Utils.setSeed(3); Carrying.struggle(meek, 'd2'); expect(Utils.random()).toBe(x);
    });
});

describe('Blood', () => {
    it('the pool is laid where they fell and stays there when the body is moved', () => {
        const body = { name: 'Bram', q: 3, r: 4, key: 'k', _npc: { id: 1 } };
        const pool = Carrying.bloodPool(body, 1000, 12);
        body.q = 9; body.r = 9;   // carried off
        expect(pool).toMatchObject({ q: 3, r: 4, key: 'k', day: 12, name: 'Bram', drip: false });
        expect(pool.victim).toBe(body._npc);
        expect(Carrying.bloodKept(pool, 12 + Carrying.config().blood.keepDays)).toBe(true);
        expect(Carrying.bloodKept(pool, 13 + Carrying.config().blood.keepDays)).toBe(false);
    });

    it('a fresh body drips every few steps; an old one does not', () => {
        const B = Carrying.config().blood;
        const body = { at: 0 };
        let drops = 0;
        for (let i = 0; i < 10; i++) if (Carrying.drips(body, 1000)) drops++;
        expect(drops).toBe(Math.floor(10 / B.dripEvery));
        expect(Carrying.drips({ at: 0 }, (B.dripSeconds + 1) * 1000)).toBe(false);
    });
});

describe('Seen carrying', () => {
    const victim = { id: 99, name: 'Bram', type: 'villager' };
    it('the watch who sees someone carried off senseless arrests, and says so in the carrying words', () => {
        const guard = { id: 5, type: 'guard', name: 'Watchman', personalityTraits: [] };
        const r = StreetCrime.foundReaction(guard, { name: 'Bram', _npc: victim }, { carried: true, alive: true, seed: 's' });
        expect(r.act).toBe('arrest');
        expect(r.implicates).toBe(true);
        const pool = StreetCrime.config().found.barks.carriedAlive.guard.map(l => l.replace('{victim}', 'Bram'));
        expect(pool).toContain(r.bark);
    });

    it('the ruler\'s own watch looks away', () => {
        const guard = { id: 6, type: 'guard', name: 'Watchman', personalityTraits: [] };
        const r = StreetCrime.foundReaction(guard, { name: 'Bram', _npc: victim }, { carried: true, alive: true, royal: true, seed: 's' });
        expect(r.act).toBe('stare');
    });

    it('blood with no body: the watch looks into it, folk stare or back away; standing in it implicates', () => {
        const guard = { id: 7, type: 'guard', name: 'Watchman', personalityTraits: [] };
        const folk = { id: 8, type: 'villager', name: 'Ada', personalityTraits: ['cautious'] };
        const g = StreetCrime.foundReaction(guard, { name: 'Bram', _npc: victim, _blood: true }, { blood: true, seed: 's' });
        expect(g.act).toBe('investigate');
        expect(g.implicates).toBe(false);
        expect(StreetCrime.config().found.barks.blood.guard).toContain(g.bark);
        expect(['flee', 'cower']).toContain(StreetCrime.foundReaction(folk, { name: 'Bram', _blood: true }, { blood: true, seed: 's' }).act);
        expect(StreetCrime.foundReaction(guard, { name: 'Bram', _blood: true }, { blood: true, playerOver: true, seed: 's' }).act).toBe('arrest');
    });
});

describe('Laid in the gaol\'s cells', () => {
    it('one who set on the player, a thief, an outlaw or one the town names is a citizen\'s arrest', () => {
        expect(Carrying.handOver(npc({ _struckPlayerFirst: true })).verdict).toBe('arrest');
        expect(Carrying.handOver(npc({ _thief: true })).verdict).toBe('arrest');
        expect(Carrying.handOver(npc({ _graveRobber: true })).verdict).toBe('arrest');
        expect(Carrying.handOver(npc({ type: 'bandit' })).verdict).toBe('arrest');
        expect(Carrying.handOver(npc(), { npcCrime: { k: 'loot' } }).verdict).toBe('arrest');
    });

    it('anyone else is a kidnapping — always a child or one of the watch, whatever they did', () => {
        expect(Carrying.handOver(npc()).verdict).toBe('kidnapping');
        expect(Carrying.handOver(npc({ type: 'child', _thief: true })).verdict).toBe('kidnapping');
        expect(Carrying.handOver(npc({ type: 'guard', _struckPlayerFirst: true })).verdict).toBe('kidnapping');
        expect(Carrying.handOver(null).verdict).toBe('kidnapping');
    });

    it('the gaoler says so in the words of data/carrying.json, the same each time', () => {
        const H = DataLoader._gamedata.carrying.handOver;
        const a = Carrying.handOver(npc({ id: 77, _thief: true }), { seed: 4 });
        expect(H.lines.arrest).toContain(a.line);
        expect(Carrying.handOver(npc({ id: 77, _thief: true }), { seed: 4 }).line).toBe(a.line);
        expect(H.lines.kidnapping).toContain(Carrying.handOver(npc({ id: 78 }), { seed: 4 }).line);
    });
});

describe('A body carried through a door', () => {
    it('comes too: it lies on the map the player is on, not left at the door', async () => {
        const { InnerMap } = await import('../world/innerMap.js');
        const { InnerMapCombat } = await import('../ui/innerMapCombat.js');
        const { InnerMapDigging } = await import('../ui/innerMapDigging.js');
        const keep = { active: InnerMap.active, wt: InnerMap.currentWorldTile, b: InnerMap._insideBuilding, q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        try {
            InnerMap.active = true;
            InnerMap.currentWorldTile = { q: 4, r: 9 };
            InnerMap._insideBuilding = null;
            InnerMap.playerInnerQ = 10; InnerMap.playerInnerR = 12;
            const body = { name: 'Odo', type: 'villager', q: 10, r: 12, at: 0, day: 0, key: InnerMapCombat._mapKey() };
            InnerMapCombat._corpses.push(body);
            InnerMapDigging.carry(body);
            // Through the door of a house
            InnerMap._insideBuilding = { q: 11, r: 12 };
            InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 8;
            InnerMapDigging._updateCarry();
            expect(InnerMapCombat._carrying).toBe(body);
            expect(body.key).toBe(InnerMapCombat._mapKey());
            expect(InnerMapCombat.corpsesHere()).toContain(body);
            expect([body.q, body.r]).toEqual([5, 8]);
            // Off the town map altogether: left behind
            InnerMap.active = false;
            InnerMapDigging._updateCarry();
            expect(InnerMapCombat._carrying).toBe(null);
        } finally {
            InnerMap.active = keep.active; InnerMap.currentWorldTile = keep.wt; InnerMap._insideBuilding = keep.b;
            InnerMap.playerInnerQ = keep.q; InnerMap.playerInnerR = keep.r;
        }
    });
});

describe('Laying a captive in a cell on the gaol map', () => {
    it('a thief is taken in; an innocent bound is cut loose and the player jailed for kidnapping', async () => {
        const { InnerMap } = await import('../world/innerMap.js');
        const { InnerMapCarry } = await import('../ui/innerMapCarry.js');
        const keep = { active: InnerMap.active, jail: InnerMap._jail, b: InnerMap._insideBuilding, wt: InnerMap.currentWorldTile, ref: InnerMap._currentWorldTileRef, npcs: InnerMap.npcs };
        const settlement = { name: 'Testby', type: 'town', kingdom: null, q: 3, r: 3 };
        const tile = { q: 3, r: 3, settlement };
        const world = { day: 12, getTile: () => tile, getKingdom: () => null, getSettlementViews: () => [settlement] };
        const notes = [];
        const game = { world, player: { name: 'Ada', gold: 50, reputation: 0, karma: 0, q: 3, r: 3, skills: {} }, ui: { showNotification: (t) => notes.push(t) } };
        try {
            InnerMap.active = true;
            InnerMap._jail = { visitor: true, locked: false };
            InnerMap._insideBuilding = { q: 6, r: 6, _jail: true };
            InnerMap.currentWorldTile = tile;
            InnerMap._currentWorldTileRef = tile;
            InnerMap.npcs = [];
            InnerMap.playerInnerQ = 8; InnerMap.playerInnerR = 8;
            // The menu offers the cell to a visitor carrying someone
            const thief = npc({ id: 501, _thief: true, _carried: true, _bound: true });
            InnerMapCarry.person = thief;
            expect(InnerMapCarry.menuItems(game, null, 8, 8, []).some(i => i.action === 'carry_hand_over')).toBe(true);
            expect(InnerMapCarry.handOver(game)).toBe('arrest');
            expect(thief.state).toBe('gone');
            expect(InnerMapCarry.person).toBe(null);
            expect(game.player.reputation).toBe(DataLoader._gamedata.carrying.handOver.arrest.reputation);
            // An innocent townsman, bound and carried in
            const man = npc({ id: 502, _carried: true, _bound: true, _gagged: true });
            InnerMap.npcs.push(man);
            InnerMapCarry.person = man;
            expect(InnerMapCarry.handOver(game)).toBe('kidnapping');
            expect(man._bound).toBe(false);
            expect(man.state).toBe('idle');
            expect(game.player.jailState && game.player.jailState.offense).toBe('kidnapping');
        } finally {
            InnerMapCarry.reset();
            InnerMap.active = keep.active; InnerMap._jail = keep.jail; InnerMap._insideBuilding = keep.b;
            InnerMap.currentWorldTile = keep.wt; InnerMap._currentWorldTileRef = keep.ref; InnerMap.npcs = keep.npcs;
        }
    });
});
