// The town rosters and the player's known people are pruned, not kept for ever
// (systems/townsfolk.js _prune / _compact / playerRefs; systems/relationships/npcs.js pruneKnown).
import { describe, it, expect, beforeEach } from 'vitest';
import { Townsfolk } from '../systems/townsfolk.js';
import { Relationships } from '../systems/relationships.js';

const Y = 120;
const DAY = 100 * Y;

function person(id, o = {}) {
    return {
        id, first: `P${id}`, last: 'Stone', gender: id % 2 ? 'male' : 'female', born: DAY - 60 * Y, died: null, cause: null,
        role: 'villager', traits: ['kind'], spouse: null, parents: [], kids: [], away: null,
        log: [{ d: DAY - 50 * Y, k: 'grown' }], practiceSkills: { swimming: 40, _seed: 'x' }, imm: { pox: -1 }, job: { id: 'mill' }, purse: 7,
        ...o,
    };
}

function folkOf(people) {
    return { v: 1, q: 5, r: 7, n: 100, tick: DAY, people, annals: [] };
}

function worldWith(folk) {
    const s = { name: 'Ashford', q: 5, r: 7, folk };
    return { day: DAY, getTile: (q, r) => (q === 5 && r === 7 ? { settlement: s } : null), getSettlementViews: () => [s] };
}

const ids = folk => folk.people.map(p => p.id).sort((a, b) => a - b);

describe('Townsfolk._prune — the dead let go sooner, a short record kept where it is asked for', () => {
    it('forgets the dead of more than pruneDeadAfterYears no one names; keeps the recent dead', () => {
        const folk = folkOf([
            person(1, { died: DAY - 8 * Y, cause: 'a fever' }),     // long dead, no one names them
            person(2, { died: DAY - 2 * Y, cause: 'a fever' }),     // lately dead
            person(3),                                              // living
        ]);
        Townsfolk._prune(folk, DAY, { name: 'Player' }, worldWith(folk));
        expect(ids(folk)).toEqual([2, 3]);
    });

    it('a moved household\'s forwarding record and the plain departed go as the dead do, unless something names their uid', () => {
        const mig = (d) => ({ d, to: 'Greymoor', mig: 1, q: 20, r: 3, nid: 9 });
        const folk = folkOf([
            person(1, { away: mig(DAY - 8 * Y) }),
            person(2, { away: mig(DAY - 8 * Y) }),
            person(3, { away: { d: DAY - 8 * Y, to: 'the wider world' } }),
            person(4, { away: { d: DAY - 8 * Y, to: 'the wider world' } }),
            // (away with the player, or missing: not gone for good)
            person(5, { away: { d: DAY - 8 * Y, to: 'the road', withPlayer: 'party' } }),
            person(6, { away: { d: DAY - 8 * Y, to: 'the wilds', missing: true } }),
        ]);
        Townsfolk._prune(folk, DAY + 4, { name: 'Player', bonds: { list: [{ folkUid: '5,7#2' }, { folkUid: '5,7#4' }] } }, worldWith(folk));
        expect(ids(folk)).toEqual([2, 4, 5, 6]);
    });

    it('those gone for good name no one: an emigrant family lets each other go; a resident\'s departed child is kept', () => {
        const mig = { d: DAY - 8 * Y, to: 'Greymoor', mig: 1, q: 20, r: 3 };
        const folk = folkOf([
            person(1, { away: { ...mig }, spouse: 2, kids: [3] }),
            person(2, { away: { ...mig }, spouse: 1, kids: [3] }),
            person(3, { away: { ...mig }, parents: [1, 2] }),
            person(4, { died: DAY - 9 * Y, kids: [3] }),                   // named only by the emigrants
            person(5, { kids: [6] }),                                       // here
            person(6, { away: { d: DAY - 8 * Y, to: 'the wider world' }, parents: [5] }),
        ]);
        Townsfolk._prune(folk, DAY + 5, { name: 'Player' }, worldWith(folk));
        expect(ids(folk)).toEqual([5, 6]);
    });

    it('compacts the departed a year gone, but not a captive the player holds, nor one away with the player', () => {
        const folk = folkOf([
            person(1, { away: { d: DAY - 2 * Y, to: 'the wider world' } }),
            person(2, { away: { d: DAY - 2 * Y, to: 'no one knows where' } }),
            person(3, { away: { d: DAY - 2 * Y, to: 'the road', withPlayer: 'party' } }),
            person(4, { away: { d: DAY - 10, to: 'the wider world' } }),
        ]);
        Townsfolk._prune(folk, DAY + 6, { name: 'Player', peopleCrimes: { captives: [{ q: 5, r: 7, pid: 2 }] } }, worldWith(folk));
        const [a, b, c, d] = [1, 2, 3, 4].map(id => Townsfolk.get(folk, id));
        expect(a.cmp).toBe(1);
        expect(a.practiceSkills).toBeUndefined();
        expect(a.log).toEqual([]);
        expect(a.away.to).toBe('the wider world');
        for (const p of [b, c, d]) { expect(p.cmp).toBeUndefined(); expect(p.practiceSkills).toBeDefined(); }
        // (in an interregnum the plain departed wait: no player state to ask)
        const f2 = folkOf([person(1, { away: { d: DAY - 2 * Y, to: 'no one knows where' } })]);
        Townsfolk._prune(f2, DAY + 6, null, worldWith(f2));
        expect(f2.people[0].cmp).toBeUndefined();
    });

    it('without a player to ask (the interregnum) only the old forty-year horizon holds', () => {
        const folk = folkOf([person(1, { died: DAY - 8 * Y }), person(2, { died: DAY - 41 * Y })]);
        Townsfolk._prune(folk, DAY, null, worldWith(folk));
        expect(ids(folk)).toEqual([1]);
    });

    it('keeps the long dead the living name: parents, grandparents, spouse, namesake, a line of their life', () => {
        const folk = folkOf([
            person(1, { died: DAY - 30 * Y }),                      // grandparent of 4
            person(2, { died: DAY - 20 * Y, parents: [1] }),        // parent of 4
            person(3, { died: DAY - 20 * Y }),                      // first spouse of 5 (in 5's life)
            person(4, { parents: [2], namedFor: 1 }),
            person(5, { log: [{ d: DAY - 20 * Y, k: 'widowed', o: 3 }] }),
            person(6, { died: DAY - 20 * Y }),                      // no one's
        ]);
        Townsfolk._prune(folk, DAY, { name: 'Player' }, worldWith(folk));
        expect(ids(folk)).toEqual([1, 2, 3, 4, 5]);
    });

    it('keeps whoever the player state names: hearsay, bonds, blood debts ("q,r#id"), captives ({q, r, pid}), the spoken-with', () => {
        const folk = folkOf([
            person(1, { died: DAY - 9 * Y }), person(2, { died: DAY - 9 * Y }), person(3, { died: DAY - 9 * Y }),
            person(4, { died: DAY - 9 * Y, mem: { timesSpoken: 2 } }), person(5, { died: DAY - 9 * Y }),
        ]);
        const player = {
            name: 'Player',
            hearsay: { npcs: { '5,7#1': { talks: [] } } },
            wanted: { debts: [{ folkRef: '5,7#2' }] },
            peopleCrimes: { captives: [{ q: 5, r: 7, pid: 3 }] },
        };
        Townsfolk._prune(folk, DAY + 1, player, worldWith(folk));
        expect(ids(folk)).toEqual([1, 2, 3, 4]);
    });

    it('keeps the dead in a grave the player leases until it lapses', () => {
        const folk = folkOf([person(1, { died: DAY - 9 * Y }), person(2, { died: DAY - 9 * Y })]);
        const world = worldWith(folk);
        world.getTile(5, 7).settlement.graveyard = { v: 1, grounds: { lot1: { id: 'lot1', owner: 'player', plots: [{ pid: 1, lapsed: null }, { pid: 2, lapsed: DAY - 1 }] } } };
        Townsfolk._prune(folk, DAY + 2, { name: 'Player' }, world);
        expect(ids(folk)).toEqual([1]);
    });

    it('compacts the year-dead and a moved household\'s forwarding record, keeping name, dates, kin and purse', () => {
        const folk = folkOf([
            person(1, { died: DAY - 2 * Y, cause: 'a fever', spouse: 3 }),
            person(2, { away: { d: DAY - 2 * Y, to: 'Greymoor', mig: 1, q: 20, r: 3, nid: 9 } }),
            person(3, { spouse: 1 }),
            person(4, { died: DAY - 10, cause: 'a fall' }),           // dead too lately to compact
            person(5, { died: DAY - 3 * Y, mem: { timesSpoken: 1 } }), // spoken with: their life stays
        ]);
        Townsfolk._prune(folk, DAY + 3, { name: 'Player' }, worldWith(folk));
        const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(id => Townsfolk.get(folk, id));
        for (const p of [a, b]) {
            expect(p.practiceSkills).toBeUndefined();
            expect(p.imm).toBeUndefined();
            expect(p.job).toBeUndefined();
            expect(p.log).toEqual([]);
            expect(p.purse).toBe(7);
            expect(p.first).toBe(`P${p.id}`);
        }
        expect(a.died).toBe(DAY - 2 * Y);
        expect(a.cause).toBe('a fever');
        expect(a.spouse).toBe(3);
        expect(b.away.nid).toBe(9);
        expect(c.practiceSkills).toBeDefined();
        expect(d.practiceSkills).toBeDefined();
        expect(e.practiceSkills).toBeUndefined();
        expect(e.log.length).toBe(1);
        // (and the record still reads: status, age)
        expect(Townsfolk.status(a, { day: DAY }).kind).toBe('dead');
    });
});

describe('Townsfolk.playerRefs', () => {
    it('finds folk uids and rnpc ids by value, by key and as {q, r, pid}; not from the relationships or ended bonds', () => {
        const player = {
            spouse: 'rnpc_3', travelParty: ['rnpc_4'], bonds: { list: [{ npcId: 'rnpc_5' }], past: [{ npcId: 'rnpc_6' }] },
            relationships: { rnpc_7: { score: 1 } }, _relationshipNpcs: [{ id: 'rnpc_7', folkUid: '1,2#3' }],
            schemes: [{ agent: { q: -4, r: 9, pid: 12 } }], grievances: { '8,8#8': 1 },
        };
        const r = Townsfolk.playerRefs(player, 77);
        expect([...r.rnpcs].sort()).toEqual(['rnpc_3', 'rnpc_4', 'rnpc_5']);
        expect([...r.uids].sort()).toEqual(['-4,9#12', '1,2#3', '8,8#8']);
    });
});

describe('Relationships.pruneKnown — the known-NPC list is pruned, never of those tied to the player', () => {
    let player;
    let world;
    beforeEach(() => {
        player = { name: 'Player', relationships: {}, travelParty: [], spouse: null, _relationshipNpcs: [] };
        world = { day: DAY, getTile: () => null };
        Relationships._npcs = player._relationshipNpcs;
    });
    const npc = (id, o = {}) => {
        const n = { id, firstName: id, isAlive: true, metDay: DAY - 30 * Y, lastInteraction: DAY - 30 * Y, ...o };
        Relationships._npcs.push(n);
        return n;
    };

    it('lets go the long dead and the long unseen, with their relationship entries; keeps the recent', () => {
        npc('rnpc_1', { isAlive: false, deathDay: DAY - 6 * Y });
        npc('rnpc_2', { isAlive: false, deathDay: DAY - 2 * Y });
        npc('rnpc_3');
        npc('rnpc_4', { lastShown: DAY - 3 * Y });
        player.relationships.rnpc_3 = { score: 5, history: [{ day: DAY - 30 * Y }] };
        expect(Relationships.pruneKnown(player, world)).toBe(2);
        expect(player._relationshipNpcs.map(n => n.id)).toEqual(['rnpc_2', 'rnpc_4']);
        expect(Relationships._npcs).toBe(player._relationshipNpcs);
        expect(player.relationships.rnpc_3).toBeUndefined();
    });

    it('never lets go of the spouse, the party, a romance, kin, court, friends and rivals, or anyone the player state names', () => {
        const old = { isAlive: false, deathDay: DAY - 50 * Y };
        npc('rnpc_1', old); player.spouse = 'rnpc_1';
        npc('rnpc_2'); player.travelParty.push('rnpc_2');
        npc('rnpc_3'); player.relationships.rnpc_3 = { score: 0, romantic: true, history: [] };
        npc('rnpc_4', { ...old, kin: 'brother' });
        npc('rnpc_5', { atCourt: 'h1' });
        npc('rnpc_6'); player.relationships.rnpc_6 = { score: -70, history: [] };   // nemesis-grade rival
        npc('rnpc_7'); player.relationships.rnpc_7 = { score: 45, history: [] };    // a friend
        npc('rnpc_8', old); player.bonds = { list: [{ npcId: 'rnpc_8', sworn: { day: 1 } }] };
        npc('rnpc_9'); player.bonds.proteges = [{ npcId: 'rnpc_9' }];
        npc('rnpc_10', old); player.nemesis = { grudges: [{ npcId: 'rnpc_10' }] };
        npc('rnpc_11'); player.wanted = { debts: [{ npcId: 'rnpc_11' }] };
        npc('rnpc_12', { protegeOf: 'House Stone' });
        npc('rnpc_13'); // no tie
        Relationships.pruneKnown(player, { ...world, day: DAY + 1 });
        expect(player._relationshipNpcs.map(n => n.id)).toEqual(['rnpc_1', 'rnpc_2', 'rnpc_3', 'rnpc_4', 'rnpc_5', 'rnpc_6', 'rnpc_7', 'rnpc_8', 'rnpc_9', 'rnpc_10', 'rnpc_11', 'rnpc_12']);
    });

    it('one never met (no dates) is given its reckoning from first sight, not let go at once', () => {
        const n = npc('rnpc_1', { metDay: 0, lastInteraction: 0 });
        Relationships.pruneKnown(player, { ...world, day: DAY + 2 });
        expect(player._relationshipNpcs.length).toBe(1);
        expect(n.pruneSeen).toBe(DAY + 2);
        Relationships.pruneKnown(player, { ...world, day: DAY + 2 + 16 * Y });
        expect(player._relationshipNpcs.length).toBe(0);
    });

    it('a townsperson let go is unlinked from their roster', () => {
        const p = person(4, { rnpc: 'rnpc_1' });
        const folk = folkOf([p]);
        const w = { ...worldWith(folk), day: DAY + 3 };
        npc('rnpc_1', { folkUid: '5,7#4' });
        Relationships.pruneKnown(player, w);
        expect(player._relationshipNpcs.length).toBe(0);
        expect(p.rnpc).toBeUndefined();
    });
});
