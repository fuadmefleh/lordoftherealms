/**
 * Thieves on the street map (ui/innerMapThieves.js): a burglar creeps to a
 * door at night and comes out with the goods; a cutpurse's noticed lift is a
 * crime the watch gives chase over; a player who feels the hand gets the choice.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';

let InnerMap, InnerMapThieves, NpcTheft, ActionMenu, DataLoader;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapThieves } = await import('../ui/innerMapThieves.js'));
    ({ NpcTheft } = await import('../systems/npcTheft.js'));
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function enterTown() {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    const settlement = { name: 'Thieveby', type: 'town', population: 1500, q: 5, r: 6, economy: { gold: 3000 } };
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = { day: 12, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null };
    const notes = [];
    const game = { world, player: { name: 'Aldric', q: 5, r: 6, gold: 200, inventory: {}, intelligence: 5, strength: 5, skills: { stealth: 1 } }, settlement, ui: { showNotification: (t, b) => notes.push(`${t}: ${b}`), updateStats() {} } };
    InnerMap.enter(game, 5, 6);
    InnerMap._currentWorldTileRef = worldTile;
    InnerMapThieves._tiles = null;
    InnerMapThieves.update(0.6, game);
    return { game, settlement, world, notes };
}

/** A hash key under which a lift goes the asked way. */
function keyFor(skill, awareness, want) {
    for (let i = 0; i < 5000; i++) {
        const r = NpcTheft.lift(skill, awareness, `t|${i}`);
        if (want === 'noticed' ? r.noticed : (r.ok && !r.noticed)) return `t|${i}`;
    }
    throw new Error('no key');
}

describe('Thieves on the street map', () => {
    it('a burglar creeps to the door at night, goes in and comes out with the goods', () => {
        const { game, settlement } = enterTown();
        expect(settlement.folk).toBeTruthy();
        const st = NpcTheft.state(settlement);
        const homes = Object.entries(st.homes);
        expect(homes.length).toBeGreaterThan(0);
        const [pid, bkey] = homes[0];
        const house = InnerMap.buildings.find(b => `${b.type}@${b.q},${b.r}` === bkey);
        const thiefNpc = InnerMap.npcs.find(n => n._person && n._person.id !== Number(pid) && n.type !== 'guard' && n.type !== 'child');
        const thief = NpcTheft.thiefOf(settlement, thiefNpc._person, 12);
        const plan = { key: 'b|1', day: 12, thief, target: { pid: Number(pid), name: 'the household', wealth: 2, lock: 2 }, when: 'night', force: true, inside: false, caught: false, seen: false };
        const spy = vi.spyOn(NpcTheft, 'planBurglary').mockReturnValue(plan);
        // Keep the watch out of sight
        for (const g of InnerMap.npcs.filter(n => n.type === 'guard')) g.state = 'inside_building';
        InnerMap.playerInnerQ = 0; InnerMap.playerInnerR = 0;
        InnerMap.timeOfDay = 23;
        InnerMapThieves.update(0.6, game);
        spy.mockRestore();
        const a = InnerMapThieves._actors.get(thiefNpc.id);
        expect(a && a.mode).toBe('burgle');
        expect(thiefNpc._targetBuilding === house || thiefNpc.state === 'inside_building').toBe(true);
        // In at the door…
        thiefNpc.state = 'inside_building';
        thiefNpc._insideBuildingQ = house.q;
        thiefNpc._insideBuildingR = house.r;
        InnerMapThieves.update(0.6, game);
        expect(a.phase).toBe('inside');
        // …and out again with the goods
        const victim = settlement.folk.people.find(p => p.id === Number(pid));
        victim.purse = 30;
        const purseBefore = 30;
        thiefNpc.state = 'idle';
        InnerMapThieves.update(0.6, game);
        expect(a.phase).toBe('away');
        expect(a.case).toBeTruthy();
        expect(a.case.victim.pid).toBe(Number(pid));
        expect(settlement.folk.people.find(p => p.id === Number(pid)).purse).toBe(purseBefore - (a.case.purses[pid] || 0));
        expect(thiefNpc.departing).toBe(true);
        // The door shows forced for a while
        expect(NpcTheft.forcedDoor(settlement, bkey, 12)).toBeTruthy();
        expect(NpcTheft.forcedDoor(settlement, bkey, 40)).toBe(null);
    });

    it('a noticed lift: the mark cries out, the watch gives chase and runs the thief down', () => {
        const { game, settlement } = enterTown();
        InnerMap.timeOfDay = 11;
        const people = InnerMap.npcs.filter(n => n._person && n.type !== 'guard' && n.type !== 'child');
        const [thiefNpc, mark] = people;
        const guard = InnerMap.npcs.find(n => n.type === 'guard');
        mark.q = thiefNpc.q + 1; mark.r = thiefNpc.r;
        for (const n of [mark, thiefNpc, guard]) n.state = 'idle';
        guard.q = thiefNpc.q + 3; guard.r = thiefNpc.r;
        const thief = NpcTheft.thiefOf(settlement, thiefNpc._person, 12);
        const key = keyFor(thief.skill, NpcTheft.awareness(mark), 'noticed');
        const a = { mode: 'cutpurse', npcId: thiefNpc.id, mark: mark.id, key, phase: 'approach', t: 0, repath: 0, seenBy: [], witnesses: [], thief };
        InnerMapThieves._actors.set(thiefNpc.id, a);
        InnerMapThieves._liftNpc(game, settlement, thiefNpc, a, mark);
        expect(a.case.status).toBe('noticed');
        const rec = settlement.npcCrimes[settlement.npcCrimes.length - 1];
        expect(rec).toMatchObject({ k: 'pickpocket', by: thief.name, caught: false });
        expect(InnerMapThieves._chasers.has(guard.id)).toBe(true);
        expect(thiefNpc.departing).toBe(true);
        // The guard catches up
        guard.q = thiefNpc.q; guard.r = thiefNpc.r + 1;
        InnerMapThieves._runChases(game, settlement, 0.5);
        expect(InnerMapThieves._chasers.size).toBe(0);
        expect(a.case.status).toBe('caught');
        expect(settlement.npcCrimes[settlement.npcCrimes.length - 1]).toMatchObject({ k: 'pickpocket', caught: true });
        expect(thiefNpc._person.jailedUntil).toBeGreaterThan(12);
    });

    it('the player feels the hand: the choice of seizing them, shouting for the watch, fighting, or letting it be', () => {
        const { game, settlement } = enterTown();
        const thiefNpc = InnerMap.npcs.find(n => n._person && n.type !== 'guard' && n.type !== 'child');
        const thief = NpcTheft.thiefOf(settlement, thiefNpc._person, 12);
        const shown = vi.spyOn(ActionMenu, 'showScene').mockImplementation(() => {});
        const key = keyFor(thief.skill, NpcTheft.awareness('player', game.player, 12), 'noticed');
        const a = { mode: 'cutpurse', npcId: thiefNpc.id, mark: 'player', key, phase: 'approach', t: 0, repath: 0, seenBy: [], witnesses: [], thief };
        InnerMapThieves._actors.set(thiefNpc.id, a);
        InnerMapThieves._liftPlayer(game, settlement, thiefNpc, a);
        expect(shown).toHaveBeenCalledWith(game, 'catch_thief', expect.objectContaining({ npcId: thiefNpc.id, kind: 'pickpocket' }));
        const v = InnerMapThieves.view(game, { npcId: thiefNpc.id, kind: 'pickpocket' });
        expect(v.options.map(o => o.id)).toEqual(['grab', 'shout', 'fight', 'brand', 'maim', 'let']);
        expect(game.player.gold).toBe(200);
        // Shout: the watch gives chase
        const out = InnerMapThieves.act(game, { npcId: thiefNpc.id, kind: 'pickpocket' }, 'shout');
        expect(out.notification.title).toMatch(/Thief/);
        shown.mockRestore();
    });

    it('unnoticed, the player is told a little later that their purse is light', () => {
        const { game, settlement, notes } = enterTown();
        const thiefNpc = InnerMap.npcs.find(n => n._person && n.type !== 'guard' && n.type !== 'child');
        const thief = NpcTheft.thiefOf(settlement, thiefNpc._person, 12);
        const key = keyFor(thief.skill, NpcTheft.awareness('player', game.player, 12), 'ok');
        const a = { mode: 'cutpurse', npcId: thiefNpc.id, mark: 'player', key, phase: 'approach', t: 0, repath: 0, seenBy: [], witnesses: [], thief };
        InnerMapThieves._actors.set(thiefNpc.id, a);
        InnerMapThieves._liftPlayer(game, settlement, thiefNpc, a);
        expect(game.player.gold).toBeLessThan(200);
        expect(notes.some(n => /Purse Cut/.test(n))).toBe(false);
        InnerMapThieves._clock += 60;
        InnerMapThieves._tellDue(game);
        expect(notes.some(n => /Your purse feels light/.test(n))).toBe(true);
    });
});
