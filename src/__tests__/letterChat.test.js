// Letters written freely (systems/letterChat.js): the player's own words sent
// by the post (systems/mail.js kind 'free'), answered by the AI brain in the
// recipient's voice — goodwill, offence, coin from their real purse, a
// meeting agreed — or, with the brain off or silent, as the nearest plain
// kind of letter. Run on a real generated world (the playtest harness).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { NPCLords } from '../world/npcLords.js';
import { Couriers } from '../systems/couriers.js';
import { Mail } from '../systems/mail.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { LetterChat } from '../systems/letterChat.js';
import { LlmClient } from '../systems/llmClient.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { loadData, newGame } from './playtest/harness.js';

let game;
let saved;
beforeAll(async () => {
    await loadData();
    game = newGame(4242);
    saved = JSON.parse(JSON.stringify({ mail: Couriers.config().mail, danger: Couriers.config().danger }));
}, 60000);

function reset() {
    const { world, player } = game;
    world.post = null;
    player.mail = null;
    player.letters = null;
    player.npcChat = null;
    player.gold = 5000;
    player.financeToday = { income: {}, expenses: {} };
    world.day = 50;
    Couriers.state(world);
    Couriers._seedHouses(world);
    // A sure road: no delay, loss, robbery or prying eyes
    Object.assign(Couriers.config().mail, { delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0, replyChance: 1 });
    Couriers.config().danger.robChance = 0;
    LetterChat._reset();
}

beforeEach(() => reset());
afterEach(() => {
    Object.assign(Couriers.config().mail, saved.mail);
    Object.assign(Couriers.config().danger, saved.danger);
    vi.restoreAllMocks();
    NpcBrain.enable(false);
    LetterChat._reset();
});

function lordRec() {
    const { world, player } = game;
    return Mail.recipients(player, world).find(r => r.type === 'lord');
}

function brainSays(text) {
    NpcBrain.enable(true);
    vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
    return vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: typeof text === 'string' ? text : JSON.stringify(text) });
}

function send(to, text, extra = {}) {
    const { world, player } = game;
    return Mail.send(player, world, { to: to.key, kind: 'free', courier: 'own', text, ...extra });
}

function runTo(day) {
    const { world, player } = game;
    const out = { notices: [], delivered: [], replies: [] };
    while (world.day < day) {
        world.day++;
        const r = Mail.processDay(world, player);
        out.notices.push(...r.notices);
        out.delivered.push(...r.delivered);
        out.replies.push(...r.replies);
    }
    return out;
}

const archive = () => CourtLetters.state(game.player).archive;

describe('Sending a letter in your own words', () => {
    it('is not one of the plain kinds, but can be sent to a lord with the words checked', () => {
        const { world, player } = game;
        const to = lordRec();
        expect(Mail.kindOptions(player, world, to).map(k => k.id)).not.toContain('free');
        expect(LetterChat.canWrite(player, world, to).ok).toBe(true);
        expect(send(to, '').success).toBe(false);
        expect(send(to, 'hi').success).toBe(false);
        const res = send(to, 'Your Grace, I write to ask after your health and your harvest.');
        expect(res.success).toBe(true);
        expect(res.letter.kind).toBe('free');
        expect(res.letter.text).toMatch(/your harvest/);
        expect(Mail.state(player).outbox).toHaveLength(1);
    });

    it('cannot go to a merchant house (no one there to answer in their own words)', () => {
        const { world, player } = game;
        expect(LetterChat.canWrite(player, world, { type: 'house', key: 'house:x' }).ok).toBe(false);
    });
});

describe('With the AI brain off', () => {
    it('a threat is read as a threat letter and answered by the usual writer', () => {
        const { world } = game;
        const to = lordRec();
        const k = world.getKingdom(to.kingdomId);
        const L = send(to, 'Pay me tribute or I will burn down your granaries, and watch your back.').letter;
        runTo(L.arriveDay);
        expect(NPCLords.memoryOf(k.lord, world.day).some(m => m.key === 'letter_threat')).toBe(true);
        expect(LetterChat.pending()).toBe(0);
    });

    it('picks the nearest kind: coin is a gift, an apology an apology, else courtesy', () => {
        const to = lordRec();
        expect(LetterChat.fallbackKind(to, { text: 'A token of my esteem.', gold: 25 })).toBe('gift');
        expect(LetterChat.fallbackKind(to, { text: 'Forgive me, I was wrong to speak so.' })).toBe('apology');
        expect(LetterChat.fallbackKind(to, { text: 'The roads are fair and the wheat is high.' })).toBe('courtesy');
    });
});

describe('With the AI brain on', () => {
    it('a lord answers in their voice, warms to you, and sends coin from the treasury that rides home with the reply', async () => {
        const { world, player } = game;
        const to = lordRec();
        const k = world.getKingdom(to.kingdomId);
        k.treasury = 4000;
        const chat = brainSays({ say: 'My friend,\nYour words gladden an old ruler. Take this for your road.\nGo with the gods.', feeling: { change: 4, why: 'kind' }, actions: [{ fn: 'send_coin', amount: 500, why: 'for the road' }, { fn: 'remember', fact: 'They asked after my harvest.' }] });
        const L = send(to, 'Your Grace, I hear your harvest was poor. I pray the spring is kinder to you.').letter;
        const out = runTo(L.arriveDay);
        expect(out.delivered).toHaveLength(1);
        await LetterChat._flush();
        expect(chat).toHaveBeenCalledTimes(1);
        const sys = chat.mock.calls[0][0][0].content;
        expect(sys).toMatch(/THIS IS A LETTER/);
        expect(chat.mock.calls[0][0][1].content).toMatch(/harvest was poor/);
        const R = Mail.state(player).replies[0];
        expect(R.free.state).toBe('done');
        // Capped at coin.cap.lord (200) and a quarter of the treasury
        expect(R.gold).toBe(200);
        expect(k.treasury).toBe(3800);
        expect(NPCLords.memoryOf(k.lord, world.day).some(m => m.key === 'letter_heartfelt')).toBe(true);
        expect(R.letter.paras).toContain('Your words gladden an old ruler. Take this for your road.');
        const gold = player.gold;
        const back = runTo(R.due);
        expect(back.replies).toHaveLength(1);
        expect(player.gold).toBe(gold + 200);
        const filed = archive()[0];
        expect(filed.kind).toBe('mail_reply');
        expect(filed.letter.free).toBe(true);
        expect(filed.letter.effects.join(' ')).toMatch(/200 gold/);
        // The exchange is remembered for next time
        expect(Mail.state(player).free.stores[to.key].memories.some(m => /harvest was poor/.test(m.text))).toBe(true);
    });

    it('an insult costs at least its floor, whatever the model felt', async () => {
        const { world } = game;
        const to = lordRec();
        const k = world.getKingdom(to.kingdomId);
        k.lord.memory = [];
        brainSays({ say: 'Ha, how amusing.', feeling: { change: 4, why: 'amused' }, actions: [] });
        const L = send(to, 'You are a useless, pathetic fool of a king.').letter;
        runTo(L.arriveDay);
        await LetterChat._flush();
        const mem = NPCLords.memoryOf(k.lord, world.day);
        expect(mem.some(m => m.key === 'letter_offence')).toBe(true);
        expect(mem.some(m => m.key === 'letter_heartfelt')).toBe(false);
    });

    it('a townsperson takes the coin you enclose, agrees to meet, and sends little from a small purse', async () => {
        const { world, player } = game;
        // Someone the player has spoken with, in a town with a roster
        let pick = null;
        for (const v of world.getSettlementViews()) {
            const s = world.getTile(v.q, v.r).settlement;
            if (!s.folk) Townsfolk.seed(s, world, { q: v.q, r: v.r });
            const folk = s.folk;
            const p = folk && (folk.people || []).find(x => x.died == null && !x.away && Townsfolk.age(x, world.day) >= 20);
            if (p) { pick = { folk, p, v }; break; }
        }
        expect(pick).toBeTruthy();
        pick.p.mem = { timesSpoken: 2, disposition: 60, giftsReceived: 0, threatened: false };
        pick.p.purse = 40;
        const to = Mail.recipients(player, world).find(r => r.type === 'folk' && r.personId === pick.p.id);
        expect(to).toBeTruthy();
        brainSays({ say: 'Dear friend, thank you for the coin. Come by when you pass through.', feeling: { change: 3, why: 'generous' }, actions: [{ fn: 'agree_to_meet', days: 20 }, { fn: 'send_coin', amount: 30 }] });
        const L = send(to, 'I hope the year treats you well. A little something for the winter; may I visit?', { gold: 25 }).letter;
        runTo(L.arriveDay);
        expect(pick.p.purse).toBe(65);
        await LetterChat._flush();
        const R = Mail.state(player).replies[0];
        expect(R.free.state).toBe('done');
        // A quarter of 65 is 16; the cap for townsfolk is 15
        expect(R.gold).toBe(15);
        expect(pick.p.purse).toBe(50);
        expect(pick.p.mem.disposition).toBeGreaterThan(60);
        const v = Mail.state(player).visits.find(x => x.key === to.key);
        expect(v).toBeTruthy();
        expect(v.until).toBe(R.due + 20);
    });

    it('if the model fails, the reply is written plainly when it is due', async () => {
        const { player } = game;
        const to = lordRec();
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: false, reason: 'timeout' });
        const L = send(to, 'Greetings, and news of the road: the bridges are mended.').letter;
        runTo(L.arriveDay);
        await LetterChat._flush();
        const R = Mail.state(player).replies[0];
        expect(R.free.state).toBe('failed');
        const back = runTo(R.due);
        expect(Mail.state(player).replies).toHaveLength(0);
        expect(back.replies.length + back.notices.length).toBeGreaterThan(0);
        expect(R.free.state).toBe('fallback');
        expect(R.letter && R.letter.free).toBeFalsy();
    });

    it('a reply still being written waits up to waitDays, then is answered plainly', () => {
        const { player } = game;
        const to = lordRec();
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockReturnValue(new Promise(() => {}));
        const L = send(to, 'Greetings, and news of the road: the bridges are mended.').letter;
        runTo(L.arriveDay);
        const R = Mail.state(player).replies[0];
        const due = R.due;
        runTo(due);
        expect(Mail.state(player).replies).toContain(R);
        expect(R.due).toBe(due + 1);
        runTo(due + LetterChat.config().waitDays);
        expect(Mail.state(player).replies).toHaveLength(0);
        expect(R.free.state).toBe('fallback');
    });

    it('a reply pending at a save is written again after the load', async () => {
        const { world, player } = game;
        const to = lordRec();
        const chat = brainSays({ say: 'Well met.', feeling: { change: 1, why: '-' }, actions: [] });
        const L = send(to, 'Greetings, and news of the road: the bridges are mended.').letter;
        runTo(L.arriveDay);
        await LetterChat._flush();
        // As if saved before the model answered, and loaded
        player.mail = JSON.parse(JSON.stringify(Mail.serialize(player)));
        const R = player.mail.replies[0];
        R.free.state = 'pending';
        delete R.letter;
        LetterChat._reset();
        Mail.processDay(world, player);
        expect(LetterChat.pending()).toBe(1);
        await LetterChat._flush();
        expect(R.free.state).toBe('done');
        expect(chat).toHaveBeenCalledTimes(2);
    });
});

describe('The Letters panel', () => {
    it('offers a letter in your own words, keeps the page across redraws, sends it, and shows the answer', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { world, player } = game;
        const to = lordRec();
        const shown = [];
        const g = { player, world, ui: { showCustomPanel: (t, html) => shown.push(html), showNotification: () => {}, updateStats: () => {}, hideCustomPanel: () => {} } };
        ActionMenu.lettersAct(g, 'pick', to.key);
        expect(shown[shown.length - 1]).toMatch(/A letter in your own words/);
        ActionMenu.lettersAct(g, 'kind', 'free');
        expect(shown[shown.length - 1]).toMatch(/id="freeLetterText"/);
        const page = { value: 'Your Grace, the wheat is high and the roads are fair this year.' };
        const orig = document.getElementById;
        document.getElementById = (id) => (id === 'freeLetterText' ? page : (orig ? orig.call(document, id) : null));
        try {
            ActionMenu.lettersAct(g, 'courier', 'own');
            expect(shown[shown.length - 1]).toMatch(/the wheat is high/);
            ActionMenu.lettersAct(g, 'send');
        } finally { document.getElementById = orig; }
        const L = Mail.state(player).outbox[0];
        expect(L && L.kind).toBe('free');
        brainSays({ say: 'Good news indeed.\nFarewell.', feeling: { change: 2, why: 'pleasant' }, actions: [] });
        runTo(L.arriveDay);
        await LetterChat._flush();
        runTo(Mail.state(player).replies[0].due);
        const filed = archive()[0];
        ActionMenu.lettersAct(g, 'read', filed.id);
        const html = shown[shown.length - 1];
        expect(html).toMatch(/Good news indeed/);
        expect(html).toMatch(/In answer to yours/);
        for (const h of shown) expect(h).not.toMatch(/undefined|NaN|could not be drawn/);
    });
});
