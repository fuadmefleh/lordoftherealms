// Personal quests from the House's own history (systems/houseQuests.js): made from
// what the world really remembers (townsfolk memories, a town's, a lord's, a lost
// heirloom), with objectives the engine checks and consequences written back into
// memory, Prestige, standing and feuds; the telling via LlmProse (facts only), with
// template fallbacks; paced for decades; saved with the player.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadData, newGame, roundTrip } from './playtest/harness.js';
import { HouseQuests } from '../systems/houseQuests.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { NPCLords } from '../world/npcLords.js';
import { Nemesis } from '../systems/nemesis.js';
import { Heirlooms } from '../systems/heirlooms.js';
import { LlmProse } from '../systems/llmProse.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { Utils } from '../core/utils.js';
import { houseQuestsHtml } from '../ui/houseQuestsPanel.js';

beforeAll(async () => { await loadData(); });
afterEach(() => { LlmProse._reset(); NpcBrain._reset(); vi.restoreAllMocks(); });

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Miller', gender, born: -4000, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], ...o });

/** Ashford (3,4) with Bran (dead grandfather line) → Hal (his son) → Wren; Thornby (8,2), the seat of realm 7. */
function makeWorld(day = 2000) {
    const bran = P(0, 'Bran', 'male', { kids: [2], died: 500 });
    const elsa = P(1, 'Elsa', 'female', { kids: [2] });
    const hal = P(2, 'Hal', 'male', { parents: [0, 1], kids: [4] });
    const una = P(3, 'Una', 'female', { last: 'Ash' });
    const wren = P(4, 'Wren', 'female', { parents: [2, 3], born: 0 });
    const folk = { q: 3, r: 4, n: 5, people: [bran, elsa, hal, una, wren], annals: [] };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 7, folk, economy: { gold: 500 } };
    const seat = { name: 'Thornby', q: 8, r: 2, kingdom: 7, folk: { q: 8, r: 2, n: 0, people: [], annals: [] }, economy: { gold: 900 } };
    const kingdom = { id: 7, name: 'Vale', isAlive: true, treasury: 1000, capital: { q: 8, r: 2 }, lord: { name: 'Lord Osric', kingdomId: 7, memory: [] } };
    const world = {
        day, generationParams: { seed: 11 }, kingdoms: [kingdom],
        getTile: (q, r) => (q === 3 && r === 4 ? { settlement: town, kingdom: 7 } : q === 8 && r === 2 ? { settlement: seat, kingdom: 7 } : null),
        getSettlementViews: () => [town, seat],
        getKingdom: (id) => (id === 7 ? kingdom : null),
    };
    return { world, folk, town, seat, kingdom, bran, elsa, hal, una, wren };
}

function makePlayer(gen = 3) {
    return {
        name: 'Edric Voss', firstName: 'Edric', gender: 'male', gold: 3000, renown: 0, karma: 0, q: 0, r: 0,
        reputation: {}, inventory: {}, skills: { diplomacy: 2 },
        house: { name: 'House Voss', generation: gen, prestige: 0, history: [], prestigeLog: [] },
    };
}

/** Grandfather Aldric (generation 1) hanged Bran: his son Hal holds it as a story about his father. */
function seedHanging(w, player, day = 400) {
    const grandfather = { name: 'Aldric Voss', gender: 'male', house: player.house.name, generation: 1 };
    NpcMemory.rememberKin(w.world, { folk: w.folk, person: w.bran }, { kind: 'hanged', by: grandfather.name, house: grandfather.house, generation: 1, sex: 'm', day });
}

describe('HouseQuests — generation from the House\'s history', () => {
    it('makes a blood-price quest for the son of the man the grandfather hanged', () => {
        const w = makeWorld();
        const player = makePlayer();
        seedHanging(w, player);
        const q = HouseQuests.generate(w.world, player);
        expect(q).toBeTruthy();
        expect(q.kind).toBe('blood_price');
        expect(q.holder).toMatchObject({ ref: '3,4#2', name: 'Hal Miller', kin: 'son', victim: 'Bran Miller', victimRel: 'father' });
        expect(q.title).toBe('The Son of Bran Miller');
        expect(q.actor.word).toBe('your grandfather');
        expect(q.tell.hook).toMatch(/Hal Miller of Ashford/);
        expect(q.tell.line).toMatch(/^Your grandfather hanged my father Bran Miller\./);
        expect(q.target).toEqual({ q: 3, r: 4, place: 'Ashford' });
        expect(q.objectives.map(o => o.type)).toEqual(['reach', 'resolve']);
        expect(q.price).toBeGreaterThan(0);
        expect(HouseQuests.open(player)).toHaveLength(1);
        // The same memory is not offered twice
        expect(HouseQuests.generate(w.world, player)).toBe(null);
    });

    it('is deterministic for the same world and history, and draws no shared RNG', () => {
        const make = () => {
            const w = makeWorld();
            const player = makePlayer();
            seedHanging(w, player);
            NpcMemory.remember(w.world, { folk: w.folk, person: w.wren }, { kind: 'alms', by: 'Aldric Voss', house: 'House Voss', generation: 1, sex: 'm', day: 600 });
            return { w, player };
        };
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        const a = make(), b = make();
        const qa = [HouseQuests.generate(a.w.world, a.player), HouseQuests.generate(a.w.world, a.player)];
        const qb = [HouseQuests.generate(b.w.world, b.player), HouseQuests.generate(b.w.world, b.player)];
        expect(JSON.stringify(qa)).toBe(JSON.stringify(qb));
        expect(Utils.random()).toBe(before);
    });

    it('turns a remembered kindness into a favour asked of the House, with real goods', () => {
        const w = makeWorld();
        const player = makePlayer();
        NpcMemory.remember(w.world, { folk: w.folk, person: w.hal }, { kind: 'healed', by: 'Aldric Voss', house: 'House Voss', generation: 2, sex: 'm', day: 900 });
        const q = HouseQuests.generate(w.world, player, { kind: 'old_favour' });
        expect(q.kind).toBe('old_favour');
        expect(q.goods.qty).toBeGreaterThan(0);
        expect(q.tell.ask).toMatch(new RegExp(`Bring ${q.goods.qty} `));
        // Bring the goods: they leave the packs, the holder remembers it kindly
        player.inventory[q.goods.item] = q.goods.qty + 2;
        player.q = 3; player.r = 4;
        const r = HouseQuests.act(w.world, player, q.id, 'deliver');
        expect(r.success).toBe(true);
        expect(player.inventory[q.goods.item]).toBe(2);
        expect(w.hal.nm.some(e => e.k === 'kept_faith' && e.w > 0)).toBe(true);
        expect(player.house.prestige).toBeGreaterThan(0);
    });

    it('a town that remembers a raid and a lord with an inherited grievance each make quests', () => {
        const w = makeWorld();
        const player = makePlayer();
        NpcMemory.rememberTown(w.world, w.town, { kind: 'raided', by: 'Aldric Voss', house: 'House Voss', generation: 1, sex: 'm', day: 300 });
        w.kingdom.lord.memory.push({ k: 'oath_broken', w: -22, d: 1500, inh: true, from: 'King Garrick' });
        const t = HouseQuests.generate(w.world, player, { kind: 'town_amends' });
        expect(t.title).toBe('The Memory of Ashford');
        const l = HouseQuests.generate(w.world, player, { kind: 'lord_grievance' });
        expect(l.target.place).toBe('Thornby');
        expect(l.tell.hook).toMatch(/Lord Osric of Vale/);
        expect(l.tell.hook).toMatch(/King Garrick/);
    });
});

describe('HouseQuests — objectives and consequences', () => {
    it('can only be settled at the place; paying the blood price moves coin, memory and Prestige', () => {
        const w = makeWorld();
        const player = makePlayer();
        seedHanging(w, player);
        const q = HouseQuests.generate(w.world, player);
        const pay = HouseQuests.options(w.world, player, q.id).find(o => o.id === 'pay');
        expect(pay.ok).toBe(false);
        expect(HouseQuests.act(w.world, player, q.id, 'pay').success).toBe(false);
        // Ride to Ashford: the day's check marks the place reached
        player.q = 3; player.r = 4;
        HouseQuests.processDay(w.world, player);
        expect(q.objectives[0].done).toBe(true);
        const gold = player.gold;
        const r = HouseQuests.act(w.world, player, q.id, 'pay');
        expect(r).toMatchObject({ success: true, outcome: 'settled' });
        expect(player.gold).toBe(gold - q.price);
        expect(w.hal.purse).toBe(q.price);
        expect(w.hal.nm.some(e => e.k === 'amends' && e.w > 0)).toBe(true);
        expect(player.house.prestige).toBeGreaterThan(0);
        expect(player.reputation[7]).toBeGreaterThan(0);
        expect(player.house.history.some(h => h.tags.includes('houseQuest'))).toBe(true);
        expect(HouseQuests.open(player)).toHaveLength(0);
        expect(HouseQuests.done(player)[0]).toMatchObject({ id: q.id, status: 'done', outcome: 'settled' });
        // Hal's view of the House is better for it
        const after = NpcMemory.opinion(w.world, { folk: w.folk, person: w.hal }, player);
        expect(after).toBeGreaterThan(-40);
    });

    it('facing them down makes a feud: a grudge waits among the nemeses', () => {
        const w = makeWorld();
        const player = makePlayer();
        seedHanging(w, player);
        const q = HouseQuests.generate(w.world, player);
        player.q = 3; player.r = 4;
        const r = HouseQuests.act(w.world, player, q.id, 'confront');
        expect(r.outcome).toBe('confronted');
        expect(w.hal.nm.some(e => e.k === 'threatened')).toBe(true);
        expect(Nemesis.state(player).grudges.some(g => g.ref.folkRef === '3,4#2')).toBe(true);
        expect(player.karma).toBeLessThan(0);
    });

    it('left past its deadline, the grudge hardens', () => {
        const w = makeWorld();
        const player = makePlayer();
        seedHanging(w, player);
        const q = HouseQuests.generate(w.world, player);
        w.world.day = q.deadline + 1;
        const out = HouseQuests.processDay(w.world, player);
        expect(out.ended[0]).toBe(q);
        expect(q).toMatchObject({ status: 'failed', outcome: 'lapsed' });
        expect(w.hal.nm.some(e => e.k === 'spurned' && e.w < 0)).toBe(true);
    });

    it('a plea for protection: reach the town in time and stand by them for days', () => {
        const w = makeWorld();
        const player = makePlayer();
        NpcMemory.remember(w.world, { folk: w.folk, person: w.hal }, { kind: 'burial', by: 'Aldric Voss', house: 'House Voss', generation: 1, sex: 'm', day: 500 });
        const q = HouseQuests.generate(w.world, player, { kind: 'protect' });
        expect(q.kind).toBe('protect');
        expect(q.objectives.map(o => o.type)).toEqual(['reach', 'stay']);
        player.q = 3; player.r = 4;
        for (let i = 0; i < q.stay && q.status === 'open'; i++) { HouseQuests.processDay(w.world, player); w.world.day++; }
        expect(q).toMatchObject({ status: 'done', outcome: 'protected' });
        expect(w.hal.nm.some(e => e.k === 'protected')).toBe(true);
        expect(player.renown).toBeGreaterThan(0);
    });

    it('a plea unanswered: the family is hurt and remembers', () => {
        const w = makeWorld();
        const player = makePlayer();
        NpcMemory.remember(w.world, { folk: w.folk, person: w.hal }, { kind: 'burial', by: 'Aldric Voss', house: 'House Voss', generation: 1, sex: 'm', day: 500 });
        const q = HouseQuests.generate(w.world, player, { kind: 'protect' });
        w.world.day = q.objectives[0].by + 1;
        HouseQuests.processDay(w.world, player);
        expect(q).toMatchObject({ status: 'failed', outcome: 'abandoned' });
        expect(w.hal.hurt).toBeTruthy();
        expect(w.hal.nm.some(e => e.k === 'abandoned')).toBe(true);
    });

    it('reparations to a lord go into the realm\'s treasury and his memory', () => {
        const w = makeWorld();
        const player = makePlayer();
        w.kingdom.lord.memory.push({ k: 'oath_broken', w: -22, d: 1500, inh: true, from: 'King Garrick' });
        const q = HouseQuests.generate(w.world, player, { kind: 'lord_grievance' });
        player.q = 8; player.r = 2;
        const before = NPCLords.memoryOpinion(w.kingdom.lord, w.world.day);
        const r = HouseQuests.act(w.world, player, q.id, 'pay');
        expect(r.outcome).toBe('lord_mended');
        expect(w.kingdom.treasury).toBe(1000 + q.price);
        expect(NPCLords.memoryOf(w.kingdom.lord, w.world.day).some(m => m.key === 'amends_made')).toBe(true);
        expect(NPCLords.memoryOpinion(w.kingdom.lord, w.world.day)).toBeGreaterThan(before);
    });

    it('an heirloom on a trail: home again when it is held', () => {
        const w = makeWorld();
        const player = makePlayer();
        const h = Heirlooms.create(player, w.world, { kind: 'sword', name: 'Oathbrand' });
        h.status = 'stolen';
        h.trail = { q: 3, r: 4, place: 'Ashford', holder: 'a fence', price: 300, since: 1800, how: 'stolen' };
        const q = HouseQuests.generate(w.world, player, { kind: 'heirloom' });
        expect(q.title).toBe('The Road to Oathbrand');
        expect(q.objectives.map(o => o.type)).toEqual(['reach', 'retrieve']);
        player.q = 3; player.r = 4;
        const buy = HouseQuests.options(w.world, player, q.id).find(o => o.id === 'buy');
        expect(buy.ok).toBe(true);
        const r = HouseQuests.act(w.world, player, q.id, 'buy');
        expect(r.outcome).toBe('recovered');
        expect(h.status).toBe('held');
        expect(player.house.prestige).toBeGreaterThan(0);
    });

    it('shows in the journal as a card with the ways to settle it, and past matters as rows', () => {
        const w = makeWorld();
        const player = makePlayer();
        seedHanging(w, player);
        const q = HouseQuests.generate(w.world, player);
        let html = houseQuestsHtml(w.world, player);
        expect(html).toContain('Unfinished Business of the House');
        expect(html).toContain('The Son of Bran Miller');
        expect(html).toContain('Go to Ashford first.');
        player.q = 3; player.r = 4;
        html = houseQuestsHtml(w.world, player);
        expect(html).toContain('data-ui-act="houseQuestAct"');
        expect(html).toContain('houseQuestDismiss');
        HouseQuests.act(w.world, player, q.id, 'pay');
        html = houseQuestsHtml(w.world, player);
        expect(html).toContain('Settled and Closed');
        expect(houseQuestsHtml(w.world, makePlayer())).toBe('');
    });

    it('is told again from the new ruler\'s side after a succession', () => {
        const w = makeWorld();
        const player = makePlayer(3);
        seedHanging(w, player);
        const q = HouseQuests.generate(w.world, player);
        expect(q.tell.line).toMatch(/^Your grandfather hanged/);
        // The heir takes up the mantle: the hanging is now their great-grandfather's
        player.house.generation = 4;
        player.name = 'Osric Voss';
        const v = HouseQuests.view(w.world, player);
        expect(v.open[0].line).toMatch(/^Your great-grandfather hanged my father Bran Miller/);
        expect(q.actor.word).toBe('your great-grandfather');
        expect(HouseQuests.dialogLine(w.world, player, '3,4#2')).toMatch(/great-grandfather/);
        expect(w.world.prose[`houseQuest:${q.id}:line`].facts.doneBy).toBe("the ruler's great-grandfather");
    });

    it('buying back an heirloom is booked in the Ledger', () => {
        const w = makeWorld();
        const player = makePlayer();
        const h = Heirlooms.create(player, w.world, { kind: 'ring', name: 'Greyband' });
        h.status = 'sold';
        h.trail = { q: 3, r: 4, place: 'Ashford', holder: 'a jeweller', price: 250, since: 1800, how: 'sold' };
        player.q = 3; player.r = 4;
        expect(Heirlooms.recover(player, w.world, h.id, 'buy').success).toBe(true);
        expect(player.financeToday.expenses.heirlooms).toBe(250);
    });

    it('the holder speaks of it in conversation', () => {
        const w = makeWorld();
        const player = makePlayer();
        seedHanging(w, player);
        HouseQuests.generate(w.world, player);
        expect(HouseQuests.dialogLine(w.world, player, '3,4#2')).toMatch(/Your grandfather hanged my father/);
        expect(HouseQuests.dialogLine(w.world, player, '3,4#4')).toBe(null);
    });
});

describe('HouseQuests — pacing over decades', () => {
    function soak(renown, days = 1200) {
        const w = makeWorld(100);
        const player = makePlayer();
        player.renown = renown;
        // A long history: every grown townsperson holds something of the House
        for (let i = 0; i < 40; i++) {
            const p = P(100 + i, `Tam${i}`, i % 2 ? 'female' : 'male', { born: -3000 });
            w.folk.people.push(p);
            NpcMemory.remember(w.world, { folk: w.folk, person: p }, { kind: i % 3 ? 'robbed' : 'alms', by: 'Aldric Voss', house: 'House Voss', generation: 1, sex: 'm', day: 50 });
        }
        let started = 0;
        for (let d = 100; d < 100 + days; d++) {
            w.world.day = d;
            const out = HouseQuests.processDay(w.world, player);
            started += out.started.length;
            for (const q of [...HouseQuests.open(player)]) HouseQuests.dismiss(w.world, player, q.id);
        }
        return started;
    }

    it('a few a year, more for a famous House', () => {
        const plain = soak(0);
        const famous = soak(1200);
        // 10 years of 120 days
        expect(plain).toBeGreaterThanOrEqual(10);
        expect(plain).toBeLessThanOrEqual(30);
        expect(famous).toBeGreaterThan(plain);
    });
});

describe('HouseQuests — the telling', () => {
    function mockClient(reply) {
        return { isAvailable: vi.fn(async () => true), chat: vi.fn(async (messages) => ({ ok: true, text: reply(messages) })) };
    }

    it('with the model off, the template stands and the facts are recorded', () => {
        const w = makeWorld();
        const player = makePlayer();
        seedHanging(w, player);
        const q = HouseQuests.generate(w.world, player);
        const key = `houseQuest:${q.id}:hook`;
        expect(LlmProse.status(w.world, key)).toBe('off');
        expect(HouseQuests.text(w.world, q, 'hook')).toBe(q.tell.hook);
        const f = w.world.prose[key].facts;
        expect(f).toMatchObject({ holder: 'Hal Miller', place: 'Ashford', victim: 'Bran Miller', ruler: 'Edric Voss' });
    });

    it('the model\'s retelling is used when it keeps to the facts, refused when it invents', async () => {
        LlmProse._setEnabled(true);
        const client = mockClient((m) => (m[1].content.includes('spoken sentences')
            ? 'Morgath the Black told me your House would pay.'
            : 'Hal Miller of Ashford still mourns Bran Miller.'));
        LlmProse._setClient(client);
        const w = makeWorld();
        const player = makePlayer();
        seedHanging(w, player);
        const q = HouseQuests.generate(w.world, player);
        await LlmProse._flush();
        await LlmProse._flush();
        expect(HouseQuests.text(w.world, q, 'hook')).toBe('Hal Miller of Ashford still mourns Bran Miller.');
        // An invented name is thrown away: the template line stands
        expect(LlmProse.status(w.world, `houseQuest:${q.id}:line`)).toBe('rejected');
        expect(HouseQuests.text(w.world, q, 'line')).toBe(q.tell.line);
        // The prompt carries only the facts, under the rule to invent nothing
        const prompt = client.chat.mock.calls[0][0].map(m => m.content).join('\n');
        expect(prompt).toMatch(/Invent nothing/);
        expect(prompt).toMatch(/Hal Miller/);
    });
});

describe('HouseQuests — saved with the player', () => {
    it('survives a save and load', () => {
        const game = newGame(4242);
        const { world, player } = game;
        const s = world.getSettlementViews()[0];
        const p = P(1, 'Hal', 'male', { born: world.day - 4000 });
        s.folk = { q: s.q, r: s.r, n: 2, people: [p], annals: [] };
        if (!player.house) player.house = { name: 'House Test', generation: 3, prestige: 0, history: [], prestigeLog: [] };
        player.house.generation = 3;
        NpcMemory.remember(world, { folk: s.folk, person: p }, { kind: 'wages_unpaid', by: 'Aldric', house: player.house.name, generation: 1, sex: 'm', day: world.day - 200 });
        const q = HouseQuests.generate(world, player);
        expect(q).toBeTruthy();
        const g2 = roundTrip(game);
        const back = HouseQuests.get(g2.player, q.id);
        expect(back).toMatchObject({ kind: q.kind, title: q.title, price: q.price, target: q.target });
        expect(back.tell.hook).toBe(q.tell.hook);
        expect(g2.player.houseQuests.seen[q.src]).toBe(q.day);
    });
});
