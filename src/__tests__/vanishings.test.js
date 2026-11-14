// Companions who never came home (systems/vanishings.js): a townsperson lost on
// the road with the player is scored for suspicion; their kin and town remember
// it (NpcMemory), regard drops, foul play becomes an accusation (Gossip), others
// from the town are warier of joining, free talk brings it up, and bringing word
// home softens it.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Vanishings } from '../systems/vanishings.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { Companions } from '../systems/companions.js';
import { Relationships } from '../systems/relationships.js';
import { NpcChatImpact } from '../systems/npcChatImpact.js';

beforeAll(async () => { await loadData(); });

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Miller', gender, born: -3000, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], ...o });

let world, folk, town, player, hal, una, bran, tom;

function bridged(p, extra = {}) {
    const npc = {
        id: `rnpc_${p.id}`, folkUid: `3,4#${p.id}`, firstName: p.first, dynasty: p.last, gender: p.gender,
        isAlive: true, traits: [], occupation: 'artisan', settlementName: 'Ashford', settlementQ: 3, settlementR: 4, ...extra,
    };
    Relationships._npcs.push(npc);
    p.rnpc = npc.id;
    player.relationships[npc.id] = { score: 30, affection: 0, history: [] };
    return npc;
}

function join(npc) {
    player.travelParty.push(npc.id);
    Relationships._syncOne(player, world, npc);
}

beforeEach(() => {
    Relationships._npcs = [];
    // Bran (father) → Hal (son, wed to Una); Tom, Hal's brother; Wren (a neighbour)
    bran = P(0, 'Bran', 'male', { kids: [1, 3] });
    hal = P(1, 'Hal', 'male', { parents: [0], spouse: 2 });
    una = P(2, 'Una', 'female', { spouse: 1, last: 'Ash', mem: { disposition: 60, timesSpoken: 2 } });
    tom = P(3, 'Tom', 'male', { parents: [0] });
    const wren = P(4, 'Wren', 'female', { last: 'Cole' });
    folk = { q: 3, r: 4, n: 5, people: [bran, hal, una, tom, wren], annals: [] };
    town = { name: 'Ashford', q: 3, r: 4, kingdom: 0, folk };
    world = {
        day: 100, generationParams: { seed: 1 },
        getTile: (q, r) => (q === 3 && r === 4 ? { settlement: town } : null),
        getSettlementViews: () => [town],
        getKingdom: () => null,
    };
    player = { name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 500, karma: 0, renown: 10, q: 10, r: 10,
        house: { name: 'House Voss', generation: 1 }, relationships: {}, travelParty: [], reputation: {} };
});

describe('Vanishings — suspicion', () => {
    it('a death in open battle, others watching, is grief', () => {
        const npc = bridged(hal);
        const other = bridged(una);
        const s = Vanishings.suspicion(world, player, npc, { how: 'battle', witnesses: [other], home: { q: 3, r: 4 } });
        expect(s.tier).toBe('grief');
        expect(s.s).toBeLessThan(Vanishings.config().doubtAt);
    });

    it('unwitnessed, at odds, carrying coin, a criminal name and a pattern make it foul play', () => {
        const npc = bridged(hal, { purse: 40, companion: { approval: 10, values: [] } });
        player.relationships[npc.id].score = -50;
        player.karma = -60;
        Vanishings.state(player).list.push({ id: 9, d: 50, npcId: 'x', q: 3, r: 4, how: 'unknown', tier: 'doubt', s: 0.6 });
        const s = Vanishings.suspicion(world, player, npc, { how: 'unknown', witnesses: [], home: { q: 3, r: 4 } });
        expect(s.tier).toBe('foul');
        expect(s.parts).toEqual(expect.arrayContaining(['unwitnessed', 'low regard', 'quarrel', 'criminal', 'profit', 'pattern ×1']));
    });

    it('each earlier loss compounds, more so from the same town', () => {
        const npc = bridged(hal);
        const base = Vanishings.suspicion(world, player, npc, { how: 'sickness', witnesses: [], home: { q: 3, r: 4 } }).s;
        Vanishings.state(player).list.push({ id: 1, d: 90, npcId: 'a', q: 9, r: 9, how: 'battle' });
        const elsewhere = Vanishings.suspicion(world, player, npc, { how: 'sickness', witnesses: [], home: { q: 3, r: 4 } }).s;
        Vanishings.state(player).list.push({ id: 2, d: 95, npcId: 'b', q: 3, r: 4, how: 'battle' });
        const here = Vanishings.suspicion(world, player, npc, { how: 'sickness', witnesses: [], home: { q: 3, r: 4 } }).s;
        expect(elsewhere).toBeGreaterThan(base);
        expect(here - elsewhere).toBeGreaterThan(elsewhere - base);
    });
});

describe('Vanishings — a companion lost on the road', () => {
    it('Companions.fall in battle records it once; the kin grieve, the regard of a known one dips', () => {
        const npc = bridged(hal);
        const wife = bridged(una);
        join(npc);
        const before = player.relationships[wife.id].score;
        Companions.fall(player, npc, world, 'the Reavers');
        const [rec] = player.vanishings.list;
        expect(rec).toMatchObject({ name: 'Hal Miller', town: 'Ashford', how: 'battle', enemy: 'the Reavers', tier: 'grief' });
        // The roster catches up: Hal dies on the road, and is not recorded twice
        Relationships._syncOne(player, world, npc);
        expect(hal.died).toBe(100);
        expect(player.vanishings.list).toHaveLength(1);
        expect(bran.nm.map(e => e.k)).toEqual(['lost_with']);
        expect(una.nm[0]).toMatchObject({ k: 'lost_with', vn: 'Hal Miller', vr: 'husband' });
        expect(player.relationships[wife.id].score).toBe(before - Vanishings.tier('grief').regard);
        expect(folk.nm).toBeUndefined(); // grief is the family's, not the town's talk
    });

    it('a sickness no one else saw, of a companion at odds, is doubted; the town talks', () => {
        const npc = bridged(hal, { companion: { approval: 15, values: [] } });
        join(npc);
        Companions.fall(player, npc, world, 'marsh fever', { how: 'sickness' });
        const [rec] = player.vanishings.list;
        expect(rec).toMatchObject({ how: 'sickness', cause: 'marsh fever', tier: 'doubt' });
        expect(una.nm[0].k).toBe('vanished_with');
        expect(una.mem.disposition).toBe(60 - Vanishings.tier('doubt').disposition);
        expect(folk.nm.map(e => e.k)).toEqual(['vanished_with']);
        expect(player.gossip.rumors.some(r => r.type === 'vanished_talk' && r.victim.name === 'Hal Miller')).toBe(true);
        expect(NpcMemory.opinion(world, { folk, person: una }, player)).toBeLessThan(0);
    });

    it('foul play is an accusation, kept forever, and kin refuse to take the road', () => {
        const npc = bridged(hal, { purse: 30 });
        player.relationships[npc.id].score = -40;
        player.karma = -50;
        join(npc);
        npc.isAlive = false; // a death that did not say how
        Relationships._syncOne(player, world, npc);
        const [rec] = player.vanishings.list;
        expect(rec.how).toBe('unknown');
        expect(rec.tier).toBe('foul');
        const accusation = player.gossip.rumors.find(r => r.type === 'vanished_companion');
        expect(accusation).toBeTruthy();
        expect(accusation.credibility).toBeGreaterThanOrEqual(Vanishings.config().accuseBase);
        // Eighty years on, the family still holds it
        const later = { ...world, day: 100 + 120 * 80 };
        const m = NpcMemory.recall(later, { folk, person: tom }, { about: player, includeTown: false });
        expect(m[0].kind).toBe('foul_play');
        // Tom will not go with the player
        const brother = bridged(tom);
        const w = Vanishings.joinWariness(world, player, brother);
        expect(w.refuse).toMatch(/My brother Hal went with you/);
        const ask = Relationships.requestJoinTravelParty(player, brother.id, world);
        expect(ask.accepted).toBe(false);
        expect(ask.wary).toBe(true);
        // A neighbour is merely warier
        const wren = folk.people[4];
        const neighbour = bridged(wren);
        const nw = Vanishings.joinWariness(world, player, neighbour);
        expect(nw.refuse).toBeNull();
        expect(nw.penalty).toBeGreaterThan(0);
    });

    it('old age on the road (the aging tick) is recorded as such', () => {
        const npc = bridged(hal);
        join(npc);
        Vanishings.onPartyLoss(world, player, npc, { how: 'old_age', witnesses: [] });
        expect(player.vanishings.list[0]).toMatchObject({ how: 'old_age', tier: 'grief' });
    });

    it('a party member with no home roster or town is not recorded', () => {
        const npc = { id: 'drifter', firstName: 'Ned', isAlive: true };
        expect(Vanishings.onPartyLoss(world, player, npc, { how: 'battle' })).toBeNull();
    });
});

describe('Vanishings — word brought home, or none', () => {
    it('standing in their town tells the family: the suspicion softens and they remember the word', () => {
        const npc = bridged(hal, { companion: { approval: 15, values: [] } });
        join(npc);
        Companions.fall(player, npc, world, 'marsh fever', { how: 'sickness' });
        const before = NpcMemory.opinion(world, { folk, person: una }, player, { includeTown: false });
        world.day = 110;
        player.q = 3; player.r = 4;
        const out = Vanishings.processDay(world, player);
        expect(out.notices.some(n => /Word brought to Ashford/.test(n.title))).toBe(true);
        expect(player.vanishings.list[0].told).toBe(110);
        expect(una.nm.map(e => e.k)).toEqual(expect.arrayContaining(['vanished_with', 'brought_word']));
        const after = NpcMemory.opinion(world, { folk, person: una }, player, { includeTown: false });
        expect(after).toBeGreaterThan(before);
    });

    it('no word in time hardens it, and a doubtful loss can turn to foul play', () => {
        const npc = bridged(hal, { companion: { approval: 15, values: [] } });
        player.karma = -40;
        join(npc);
        Companions.fall(player, npc, world, 'marsh fever', { how: 'sickness' });
        const rec = player.vanishings.list[0];
        rec.s = Vanishings.config().foulAt - 0.1; rec.tier = 'doubt';
        Vanishings.processDay(world, player);
        world.day = 100 + Vanishings.config().noWordDays;
        const out = Vanishings.processDay(world, player);
        expect(rec.nw).toBe(world.day);
        expect(rec.tier).toBe('foul');
        expect(una.nm.map(e => e.k)).toEqual(expect.arrayContaining(['no_word', 'foul_play']));
        expect(player.gossip.rumors.some(r => r.type === 'vanished_companion')).toBe(true);
        expect(out.notices.some(n => /No word in Ashford/.test(n.title))).toBe(true);
    });
});

describe('Vanishings — free talk', () => {
    it('kin speak of the one lost; the town whispers to the rest', () => {
        const npc = bridged(hal, { companion: { approval: 15, values: [] } });
        join(npc);
        Companions.fall(player, npc, world, 'marsh fever', { how: 'sickness' });
        const kin = Vanishings.personaLines(world, player, folk, una);
        expect(kin.join(' ')).toMatch(/Your husband Hal left with Aldric Voss on the road .* never came home/);
        expect(kin.join(' ')).toMatch(/has never come to tell/);
        const other = Vanishings.personaLines(world, player, folk, folk.people[4]);
        expect(other.join(' ')).toMatch(/Hal Miller left with Aldric Voss and never came back/);
        // Read into the free-talk character sheet
        const who = { key: 'k', npc: { _person: una, _folk: folk }, store: () => ({}) };
        expect(NpcChatImpact.personaLines(player, world, who).join('\n')).toMatch(/Your husband Hal left with Aldric Voss/);
    });

    it('saves with the player', () => {
        const npc = bridged(hal);
        join(npc);
        Companions.fall(player, npc, world, 'the Reavers');
        const copy = Vanishings.serialize(player);
        expect(copy.list[0].name).toBe('Hal Miller');
        expect(copy).not.toBe(player.vanishings);
    });
});
