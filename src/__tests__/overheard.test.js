/**
 * Overheard talk (systems/overheard.js, ui/innerMapOverheard.js): two townsfolk
 * chatting near the player now and then talk about the player, from what the
 * world really holds (memories, rumours, bounties, tales, fame, town marks,
 * fights), in the speaker's own tone; slander names who is spreading it and
 * marks them for the free talk.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Overheard } from '../systems/overheard.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { NpcChatImpact } from '../systems/npcChatImpact.js';
import { Gossip } from '../systems/gossip.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const person = (id, first, last, extra = {}) => ({
    id, first, last, gender: 'male', born: -30 * 120, died: null, role: 'villager', traits: [],
    spouse: null, parents: [], kids: [], away: null, log: [], ...extra,
});

function town() {
    const people = [
        person(1, 'Brom', 'Reed'),
        person(2, 'Ada', 'Reed', { gender: 'female' }),
        person(3, 'Tam', 'Hale'),
        person(4, 'Wat', 'Cole', { role: 'blacksmith_npc' }),
    ];
    const folk = { v: 1, q: 3, r: 3, n: 5, people, annals: [] };
    const settlement = { name: 'Riptide', type: 'town', kingdom: 1, q: 3, r: 3, folk };
    const world = {
        day: 200, season: 'Spring', year: 853, generationParams: { seed: 7 },
        getTile: (q, r) => (q === 3 && r === 3 ? { settlement } : null),
        getSettlementViews: () => [settlement],
        getKingdom: () => null, kingdoms: [],
    };
    const player = { name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 100, renown: 0, karma: 0, reputation: {}, house: { name: 'House Voss', generation: 1 } };
    const [brom, ada, tam, wat] = people;
    return { world, settlement, folk, player, brom, ada, tam, wat };
}

const sides = (a, b, opts = {}) => ({ a: { p: a, npc: opts.an || null }, b: { p: b, npc: opts.bn || null } });

describe('Overheard — what is said', () => {
    let T;
    beforeEach(() => { T = town(); });

    it('a warm speaker praises a deed they remember, in their own words, and it is not slander', () => {
        const { world, settlement, folk, player, brom, ada } = T;
        NpcMemory.remember(world, { folk, person: brom }, { kind: 'burial', player, victimRel: 'father', victim: 'Old Reed' });
        brom.nm[0].vr = 'father';
        const res = Overheard.compose({ world, player, settlement, day: 200, salt: 's1', ...sides(brom, ada) });
        expect(res).toBeTruthy();
        expect(res.speaker.p).toBe(brom);
        expect(res.fact.src).toBe('memory');
        expect(res.frame).toBe('praise');
        expect(res.ill).toBe(false);
        expect(res.said).toMatch(/Aldric paid to bury my father/);
        expect(res.log).toMatch(/^Brom Reed \(.+\) to Ada Reed: "/);
    });

    it('a cold speaker slanders: the log names who is spreading it, and the mark reaches the free talk', () => {
        const { world, settlement, folk, player, brom, ada } = T;
        NpcMemory.remember(world, { folk, person: brom }, { kind: 'assaulted', player });
        const res = Overheard.compose({ world, player, settlement, day: 200, salt: 's2', ...sides(brom, ada) });
        expect(res.frame).toBe('slander');
        expect(res.ill).toBe(true);
        expect(res.said).toMatch(/Aldric beat me/);
        expect(res.log).toMatch(/Brom is spreading it about you/);
        Overheard.mark(res.speaker.p, res.said, 'Ada', res.ill, 200);
        expect(brom.ovh).toMatchObject({ d: 200, to: 'Ada', ill: true });
        const who = { npc: { _person: brom, _folk: folk }, key: 'k', place: 'Riptide', store: () => ({}) };
        const lines = NpcChatImpact.personaLines(player, world, who);
        expect(lines.join('\n')).toMatch(/OVERHEARD YOU SAY/);
        expect(lines.join('\n')).toMatch(/telling Ada that .*Aldric beat me/);
        // Long after, forgotten
        world.day = 200 + Overheard.config().markDays + 1;
        expect(Overheard.personaLines(player, world, brom)).toEqual([]);
    });

    it('relays what another resident remembers, naming them ("Wat the smith says…")', () => {
        const { world, settlement, folk, player, ada, tam, wat } = T;
        NpcMemory.remember(world, { folk, person: wat }, { kind: 'robbed', player });
        const res = Overheard.compose({ world, player, settlement, day: 200, salt: 's3', ...sides(ada, tam) });
        expect(res).toBeTruthy();
        expect(res.fact.from).toBe('Wat the smith');
        expect(res.said).toMatch(/Wat the smith/);
        expect(res.said).toMatch(/robbed Wat/);
        expect(res.ill).toBe(true);
        expect(res.log).toMatch(/had it from Wat the smith/);
    });

    it('tells a rumour as this town has it, and where it came from; a fond listener doubts it', () => {
        const { world, settlement, player, brom, ada } = T;
        Gossip.initializePlayer(player);
        player.gossip.rumors.push({
            id: 9, type: 'guard_murder', perpetrator: 'Aldric Voss', victim: { name: 'a guard' }, locationName: 'Ashby',
            dayCreated: 190, credibility: 0.9, severity: 60, witnessNames: [], spreadTo: ['5,5', '3,3'], expired: false,
        });
        const an = { _dialogMemory: { disposition: 50 } };
        const bn = { _dialogMemory: { disposition: 95 } };
        const res = Overheard.compose({ world, player, settlement, day: 200, salt: 's4', ...sides(brom, ada, { an, bn }) });
        expect(res.fact.src).toBe('rumour');
        expect(res.said).toMatch(/killed a guard in Ashby/);
        expect(res.fact.from).toMatch(/Ashby/);
        // Ada is fond of the player; she speaks for them if she speaks, else she doubts Brom
        if (res.speaker.p === brom) {
            expect(res.ill).toBe(true);
            expect(Overheard.data().replies.doubtIll.map(r => r.replace('{who}', 'Aldric'))).toContain(res.reply);
        } else {
            expect(res.frame).toBe('defend');
        }
    });

    it('a fond speaker defends against an ill rumour (not slander)', () => {
        const { world, settlement, player, brom, ada } = T;
        Gossip.initializePlayer(player);
        player.gossip.rumors.push({ id: 3, type: 'theft', perpetrator: 'Aldric Voss', victim: { name: 'the miller' }, locationName: 'Riptide', dayCreated: 199, credibility: 1, severity: 30, witnessNames: ['Tam Hale'], spreadTo: ['3,3'], expired: false });
        const an = { _dialogMemory: { disposition: 100 } };
        const bn = { _dialogMemory: { disposition: 100 } };
        const res = Overheard.compose({ world, player, settlement, day: 200, salt: 's5', ...sides(brom, ada, { an, bn }) });
        expect(res.frame).toBe('defend');
        expect(res.ill).toBe(false);
        expect(res.fact.from).toBe('Tam');
    });

    it('a bounty, the fame stage, the town\'s marks and a fight the player broke up are all talked of', () => {
        const { world, settlement, player, brom } = T;
        Gossip.initializePlayer(player);
        player.gossip.bounties.push({ rumorId: 1, kingdom: 1, gold: 120 });
        settlement.memory = { marks: [{ k: 'statue', house: 'House Voss', who: 'Aldric', state: 'standing', d: 50 }] };
        Overheard.noteBrawl(settlement, { k: 'parted', d: 195, a: 'Tam Hale', b: 'Wat Cole', place: 'tavern' });
        const facts = Overheard.facts(world, player, settlement, brom, 200, 'x');
        const by = Object.fromEntries(facts.map(f => [f.src, f]));
        expect(by.bounty.gist).toBe('has a price of 120 gold on his head');
        expect(by.brawl.gist).toBe('pulled Tam and Wat apart at the tavern');
        expect(by.brawl.v).toBe(1);
        if (by.town) expect(by.town.gist).toBe('has a statue in our square');
        // The same fight noted twice is one
        expect(Overheard.noteBrawl(settlement, { k: 'parted', d: 195, a: 'Tam Hale', b: 'Wat Cole' })).toBeNull();
    });

    it('a tale the player planted is heard travelling; nothing to say is null', () => {
        const { world, settlement, player, brom, ada } = T;
        expect(Overheard.compose({ world, player, settlement, day: 200, salt: 'n', ...sides(brom, ada) })).toBeNull();
        player.whispers = { nextId: 2, scandals: [{ id: 1, kind: 'bastard', subject: { type: 'ruler', name: 'King Oswin' }, kingdomId: 1, place: 'Ashby', spreadTo: ['3,3'], line: 0, heat: 20, state: 'live', planted: true, ends: 999, born: 190 }], stats: {} };
        const res = Overheard.compose({ world, player, settlement, day: 200, salt: 't', ...sides(brom, ada) });
        expect(res.fact.src).toBe('tale');
        expect(res.said).toMatch(/King Oswin/);
        expect(res.log).toMatch(/Your tale about King Oswin has reached Riptide/);
    });

    it('the town does not say the same thing again for repeatDays', () => {
        const { world, settlement, folk, player, brom, ada } = T;
        NpcMemory.remember(world, { folk, person: brom }, { kind: 'alms', player });
        expect(Overheard.compose({ world, player, settlement, day: 200, salt: 'a', ...sides(brom, ada) })).toBeTruthy();
        expect(Overheard.compose({ world, player, settlement, day: 201, salt: 'b', ...sides(brom, ada) })).toBeNull();
        const back = 200 + Overheard.config().repeatDays;
        expect(Overheard.compose({ world, player, settlement, day: back, salt: 'c', ...sides(brom, ada) })).toBeTruthy();
    });

    it('is the same for the same salt (hash picks, no shared RNG)', () => {
        const one = town();
        const two = town();
        for (const t of [one, two]) {
            NpcMemory.remember(t.world, { folk: t.folk, person: t.brom }, { kind: 'alms', player: t.player });
            NpcMemory.remember(t.world, { folk: t.folk, person: t.brom }, { kind: 'insulted', player: t.player });
        }
        const a = Overheard.compose({ world: one.world, player: one.player, settlement: one.settlement, day: 200, salt: 'same', ...sides(one.brom, one.ada) });
        const b = Overheard.compose({ world: two.world, player: two.player, settlement: two.settlement, day: 200, salt: 'same', ...sides(two.brom, two.ada) });
        expect(a.said).toBe(b.said);
        expect(a.reply).toBe(b.reply);
    });
});

describe('Overheard — throttles and bubbles', () => {
    it('allows perTownDay lines a town a day', () => {
        const { settlement } = town();
        const n = Overheard.config().perTownDay;
        for (let i = 0; i < n; i++) expect(Overheard.roomToday(settlement, 5, true)).toBe(true);
        expect(Overheard.roomToday(settlement, 5)).toBe(false);
        expect(Overheard.roomToday(settlement, 6)).toBe(true);
    });

    it('splits a long line into bubbles and cuts the tail', () => {
        const parts = Overheard.chunks('Had it from Wat the smith: Aldric robbed Wat, and walks about bold as brass in the square every market day.', 44, 2);
        expect(parts).toHaveLength(2);
        for (const p of parts) expect(p.length).toBeLessThanOrEqual(45);
        expect(parts[1].endsWith('…')).toBe(true);
        expect(Overheard.chunks('Short one.')).toEqual(['Short one.']);
    });
});

describe('Overheard — the model\'s retelling', () => {
    const res = { said: 'Aldric gave me alms, you know.', key: 'm:alms', frame: 'praise', fact: { who: 'Aldric', gist: 'gave me alms' } };
    const settlement = { q: 3, r: 3, name: 'Riptide' };

    function fakeProse(opts = {}) {
        const calls = [];
        return {
            calls,
            canWrite: () => opts.on !== false,
            pending: () => opts.pending || 0,
            status: () => null,
            written: (w, key) => (opts.text && opts.text[key]) || null,
            write: (w, o) => { calls.push(o); return o.fallback; },
        };
    }

    beforeEach(() => { Overheard._llm = { day: null, n: 0 }; });

    it('without prose, or off, or busy: the template, nothing asked', () => {
        const world = { day: 3 };
        expect(Overheard.voice(world, null, settlement, res)).toBe(res.said);
        const off = fakeProse({ on: false });
        expect(Overheard.voice(world, off, settlement, res)).toBe(res.said);
        const busy = fakeProse({ pending: 1 });
        Overheard.voice(world, busy, settlement, res);
        expect(off.calls.length + busy.calls.length).toBe(0);
    });

    it('idle: asks in the background at most llm.perDay a day, and uses a cached retelling', () => {
        const P = fakeProse();
        let asked = 0;
        for (let d = 1; d <= 20; d++) {
            for (let i = 0; i < 5; i++) Overheard.voice({ day: d }, P, settlement, { ...res, key: `k${d}_${i}` });
            asked = P.calls.length;
        }
        expect(asked).toBeGreaterThan(0);
        expect(asked).toBeLessThanOrEqual(20 * Overheard.config().llm.perDay);
        expect(P.calls[0].kind).toBe('overheard');
        expect(P.calls[0].fallback).toBe(res.said);
        const key = 'overheard:3,3:m:alms:praise';
        const cached = fakeProse({ text: { [key]: 'That Aldric put coin in my hand when I had none.' } });
        expect(Overheard.voice({ day: 1 }, cached, settlement, res)).toBe('That Aldric put coin in my hand when I had none.');
        expect(cached.calls).toHaveLength(0);
    });
});

describe('Overheard — on the street map (ui/innerMapOverheard.js)', () => {
    it('within earshot, a chat about the player puts bubbles over both and a line in the log; out of earshot, nothing', async () => {
        const { InnerMap } = await import('../world/innerMap.js');
        const { InnerMapOverheard } = await import('../ui/innerMapOverheard.js');
        const { world, settlement, folk, player, brom, ada } = town();
        NpcMemory.remember(world, { folk, person: brom }, { kind: 'assaulted', player });
        const toasts = [];
        const logged = [];
        const game = { world, player, ui: { showNotification: (t, m, k) => toasts.push([t, m, k]), _logNotification: (t, m) => logged.push([t, m]) } };
        const saved = { active: InnerMap.active, ref: InnerMap._currentWorldTileRef, q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR, inside: InnerMap._insideBuilding };
        try {
            InnerMap.active = true;
            InnerMap._currentWorldTileRef = { settlement };
            InnerMap._insideBuilding = null;
            InnerMap.playerInnerQ = 30; InnerMap.playerInnerR = 30;
            const a = { id: 'a', q: 10, r: 10, _person: brom, _folk: folk, state: 'idle', idleTimer: 5 };
            const b = { id: 'b', q: 11, r: 10, _person: ada, _folk: folk, state: 'idle', idleTimer: 5 };
            InnerMapOverheard.update(0, game);
            expect(InnerMap._overhearChat(a, b)).toBe(false); // too far off
            InnerMap.playerInnerQ = 12; InnerMap.playerInnerR = 11;
            let said = false;
            for (let i = 0; i < 40 && !said; i++) { InnerMapOverheard._nextAt = 0; said = InnerMap._overhearChat(a, b); }
            expect(said).toBe(true);
            expect(a._bark && a._bark.text).toMatch(/Aldric/);
            expect(a.idleTimer).toBeGreaterThan(5);
            expect(InnerMapOverheard._queue.some(q => q.npc === b)).toBe(true);
            expect(toasts).toHaveLength(1);
            expect(toasts[0][1]).toMatch(/Brom is spreading it about you/);
            expect(brom.ovh && brom.ovh.ill).toBe(true);
            // The cooldown holds the next one back
            expect(InnerMap._overhearChat(a, b)).toBe(false);
        } finally {
            InnerMap.active = saved.active; InnerMap._currentWorldTileRef = saved.ref;
            InnerMap.playerInnerQ = saved.q; InnerMap.playerInnerR = saved.r; InnerMap._insideBuilding = saved.inside;
        }
    });
});
