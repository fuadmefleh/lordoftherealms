// Letters from people (systems/mailVoice.js, written for systems/mail.js): a
// reply is a letter in its writer's voice — it answers what was sent, tells
// only what is true where they live, does not repeat itself to the same
// correspondent, follows a running thread to its end, comes through garbled
// in a tongue the player reads poorly, and is the same under the same seed.
// Correspondents write unbidden (condolence, news, a plea), and the hooks a
// letter carries (a request, an invitation) do something. Old saves without
// the new fields still load and render. Run on a real generated world.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Couriers } from '../systems/couriers.js';
import { Mail } from '../systems/mail.js';
import { MailVoice } from '../systems/mailVoice.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { LlmClient } from '../systems/llmClient.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { loadData, newGame } from './playtest/harness.js';

let game;
let saved;
beforeAll(async () => {
    await loadData();
    game = newGame(4242);
    saved = JSON.parse(JSON.stringify(Couriers.config().mail));
}, 60000);

beforeEach(() => {
    const { world, player } = game;
    Object.assign(Couriers.config().mail, JSON.parse(JSON.stringify(saved)), {
        delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0, replyChance: 1, perDay: 50, maxInTransit: 50,
    });
    Couriers.config().danger.robChance = 0;
    world.post = null;
    player.mail = null;
    player.letters = null;
    player.gold = 5000;
    player.financeToday = { income: {}, expenses: {} };
    world.day = 50;
    Couriers.state(world);
    Couriers._seedHouses(world);
    NpcBrain._reset();
});

const plainOf = (letter) => MailVoice.plain({ ...game.player, languages: null }, letter);

/** A townsperson the player knows (a recipient of type folk) in a town of another realm than the first. */
function folkFriend(role = 'farmer', disposition = 80) {
    const { world } = game;
    for (const s of world.getSettlementViews()) {
        if (!s || !s.kingdom) continue;
        const st = world.getTile(s.q, s.r).settlement;
        if (!st.folk) Townsfolk.seed(st, world);
        if (!st.folk) continue;
        const p = st.folk.people.find(x => x.died == null && !x.away && x.role === role && Townsfolk.age(x, world.day) >= 20);
        if (!p) continue;
        p.mem = { timesSpoken: 3, disposition, giftsReceived: 0, threatened: false };
        const to = Mail.recipients(game.player, world).find(r => r.type === 'folk' && r.personId === p.id && r.q === s.q && r.r === s.r);
        if (to) return { to, person: p, settlement: st };
    }
    return null;
}

function lordRec(i = 0) {
    return Mail.recipients(game.player, game.world).filter(r => r.type === 'lord')[i];
}

function run(days) {
    const { world, player } = game;
    const out = { notices: [], delivered: [], replies: [] };
    for (let i = 0; i < days; i++) {
        world.day++;
        const r = Mail.processDay(world, player);
        out.notices.push(...r.notices);
        out.replies.push(...r.replies);
    }
    return out;
}

/** Write a letter as Mail would, in a seeded stream. */
function write(to, spec, seed = 1) {
    const { world, player } = game;
    const s = Mail._subject(player, world, to);
    const L = { sentDay: world.day - 4, resolvedDay: world.day, from: { name: 'Ironhoof' } };
    return Utils.withRng(Utils.seededRandom(seed), () => MailVoice.compose(player, world, { to, s, kind: 'courtesy', outcome: 'warm', tone: 'warm', vars: {}, L, ...spec }));
}

describe('A reply is a letter', () => {
    it('answers what was sent: the gift by its amount, in the writer\'s hand, with a salutation and a signature', () => {
        const { world, player } = game;
        const to = lordRec(0);
        const res = Mail.send(player, world, { to: to.key, kind: 'gift', courier: 'own', gold: 100 });
        expect(res.success).toBe(true);
        run(res.letter.days * 2 + 2);
        const filed = CourtLetters.state(player).archive.find(a => a.letter && a.from.name === to.name);
        expect(filed).toBeTruthy();
        const L = filed.letter;
        expect(L.salutation.length).toBeGreaterThan(1);
        expect(L.signature).toContain(world.getKingdom(to.kingdomId).lord.name);
        const text = plainOf(L);
        // the gift is named by its amount (or the letter says it came empty, if robbed — never here)
        expect(text).toMatch(/100 gold/);
        expect(text).not.toMatch(/\{\w+\}|undefined|NaN/);
    });

    it('names the enemy a warning was about', () => {
        const { world, player } = game;
        const [a, b] = world.kingdoms.filter(k => k && k.isAlive !== false && k.lord && Mail._seat(world, k.id));
        a.wars = [b.id];
        b.wars = [a.id];
        const to = Mail.recipient(player, world, `lord:${a.id}`);
        const res = Mail.send(player, world, { to: to.key, kind: 'warning', courier: 'own' });
        expect(res.success).toBe(true);
        run(res.letter.days * 2 + 2);
        const filed = CourtLetters.state(player).archive.find(x => x.letter && x.from.name === to.name);
        const text = plainOf(filed.letter);
        if (filed.letter.tone !== 'hostile') expect(text).toContain(b.name);
        a.wars = [];
        b.wars = [];
    });
});

describe('True to the world', () => {
    it('tells of a lord\'s illness only while it lasts, and says when it is over', () => {
        const { world, player } = game;
        const to = lordRec(1);
        const k = world.getKingdom(to.kingdomId);
        const ruler = k.characterData.ruler;
        ruler.isIll = false;
        Mail.state(player);
        let W = MailVoice.writer(player, world, to, Mail._subject(player, world, to));
        expect(MailVoice.facts(player, world, W).some(f => f.k === 'ruler_ill')).toBe(false);
        ruler.isIll = true;
        W = MailVoice.writer(player, world, to, Mail._subject(player, world, to));
        expect(MailVoice.facts(player, world, W).some(f => f.k === 'ruler_ill')).toBe(true);
        // Write until the illness is told: a thread begins
        const corr = MailVoice.corr(player, to.key);
        for (let i = 0; i < 25 && !corr.threads.ruler_ill; i++) { world.day += 1; write(to, {}, 100 + i); }
        expect(corr.threads.ruler_ill).toBeTruthy();
        // Recovered: the next letter says so
        ruler.isIll = false;
        world.day += 12;
        const L = write(to, {}, 999);
        const over = MailVoice.data().facts.ruler_ill_over.map(e => MailVoice.fill(e.t, {}));
        expect(over.some(t => L.paras.join(' ').includes(t))).toBe(true);
        expect(corr.threads.ruler_ill).toBeUndefined();
    });

    it('a townsperson\'s own life comes from their record: a wedding this season is told by the right name', () => {
        const { world, player } = game;
        const f = folkFriend('farmer');
        expect(f).toBeTruthy();
        const folk = f.settlement.folk;
        const spouse = folk.people.find(x => x.died == null && x.id !== f.person.id && x.gender !== f.person.gender);
        f.person.log = [{ d: world.day - 5, k: 'wed', o: spouse.id }];
        const W = MailVoice.writer(player, world, f.to, Mail._subject(player, world, f.to));
        const facts = MailVoice.facts(player, world, W);
        const wed = facts.find(x => x.k === 'life_wed');
        expect(wed.vars.first).toBe(spouse.first);
        // nothing told is invented: every fact the letter could draw on names real things
        for (const x of facts) for (const v of Object.values(x.vars)) expect(v).not.toBeUndefined();
    });

    it('never says what has no source: a fact line is only drawn when its facts fill it', () => {
        const D = MailVoice.data();
        const W = { register: 'low', group: 'low', persona: 'warm', type: 'folk', rel: null };
        // a dearth line needs {good}: without it, none of them fits
        for (const e of MailVoice._entries(D.facts.dearth)) expect(MailVoice._fits(e, W, { tone: 'warm', rank: 'common', flags: [], vars: { town: 'X' } })).toBe(false);
        expect(MailVoice.pick(D.facts.dearth, W, { tone: 'warm', rank: 'common', flags: [], vars: { town: 'X' }, usedNow: [] })).toBe('');
    });
});

describe('Variety', () => {
    it('does not send the same correspondent the same letter twice, and avoids repeating its lines', () => {
        const { world, player } = game;
        const to = lordRec(2);
        Mail.state(player);
        const texts = [];
        const openings = [];
        for (let i = 0; i < 8; i++) {
            world.day += 7;
            const L = write(to, {}, 500 + i);
            texts.push(plainOf(L));
            openings.push(L.paras[0]);
        }
        expect(new Set(texts).size).toBe(texts.length);
        // the first paragraph (receipt + answer) is fresh for the first four letters at least
        expect(new Set(openings.slice(0, 4)).size).toBe(4);
    });

    it('different personas write differently', () => {
        const D = MailVoice.data();
        const o = { tone: 'warm', rank: 'common', flags: ['reply'], vars: { gift: 'the 25 gold', town: 'Ashford' }, usedNow: [] };
        const blunt = new Set();
        const flowery = new Set();
        for (let i = 0; i < 20; i++) {
            Utils.withRng(Utils.seededRandom(i + 1), () => {
                blunt.add(MailVoice.pick(D.answers.gift.warm, { register: 'low', group: 'low', persona: 'blunt', type: 'folk' }, { ...o, usedNow: [] }));
                flowery.add(MailVoice.pick(D.answers.gift.warm, { register: 'high', group: 'high', persona: 'flowery', type: 'lord' }, { ...o, usedNow: [] }));
            });
        }
        const overlap = [...blunt].filter(x => flowery.has(x));
        expect(overlap.length).toBeLessThan(Math.min(blunt.size, flowery.size));
    });
});

describe('Determinism', () => {
    it('the same seed writes the same letter; the shared RNG is untouched by the daily post', () => {
        const { world, player } = game;
        const to = lordRec(3);
        const snap = JSON.stringify(player.mail || null);
        const a = write(to, {}, 4242);
        player.mail = JSON.parse(snap) || null;
        Mail.state(player);
        const b = write(to, {}, 4242);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        // A reply resolved by the daily tick leaves Utils.random where it was
        Mail.send(player, world, { to: to.key, kind: 'courtesy', courier: 'own' });
        Utils.setSeed(77);
        const before = Utils.random();
        Utils.setSeed(77);
        run(30);
        expect(Utils.random()).toBe(before);
    });
});

describe('A foreign hand', () => {
    it('comes through garbled in a tongue the player lacks — names and numbers kept — and clear with fluency', () => {
        const { world, player } = game;
        const f = folkFriend('priest');
        const W = MailVoice.writer(player, world, f.to, Mail._subject(player, world, f.to));
        const L = write(f.to, { kind: 'gift', outcome: 'warm', vars: { gift: 'the 25 gold', gold: 25 } }, 31);
        const native = player.nativeLanguage;
        const langs = player.languages;
        player.languages = { [native]: 100 };
        const foreign = W.lang && W.lang !== native;
        const heard = MailVoice.read(player, L);
        if (foreign) {
            expect(heard.garbled).toBe(true);
            expect(heard.notes.join(' ')).toMatch(/written in/);
            expect(heard.paras.join(' ')).toMatch(/25/);
        }
        player.languages = { [native]: 100, ...(W.lang ? { [W.lang]: 100 } : {}) };
        const clear = MailVoice.read(player, L);
        expect(clear.garbled).toBe(false);
        expect(clear.paras.join(' ')).toMatch(/25 gold/);
        player.languages = langs;
    });

    it('a lord\'s chancery writes in the player\'s tongue — unless it means a slight', () => {
        const { world, player } = game;
        const to = Mail.recipients(player, world).find(r => r.type === 'lord' && MailVoice.writer(player, world, r, Mail._subject(player, world, r)).lang !== player.nativeLanguage);
        if (!to) return;
        expect(write(to, { tone: 'cool', outcome: 'cool' }, 3).lang).toBe(player.nativeLanguage);
        expect(write(to, { kind: 'threat', tone: 'hostile', outcome: 'hostile' }, 4).lang).not.toBe(player.nativeLanguage);
    });
});

describe('Letters nobody asked for, and hooks that do something', () => {
    it('a friend writes to condole when a child of the House dies', () => {
        const { world, player } = game;
        const f = folkFriend('merchant', 95);
        const st = Mail.state(player);
        MailVoice.corr(player, f.to.key).n = 2;
        player.q = f.to.q + 3;
        player.r = f.to.r;
        const child = { id: 'kid_dead', firstName: 'Oswin', gender: 'male', age: 8, isAlive: false, deathDay: world.day };
        player.children = [child];
        st.heard.scan = world.day - 1;
        run(40);
        const filed = CourtLetters.state(player).archive.find(a => a.letter && /Oswin/.test(a.subject || ''));
        expect(filed).toBeTruthy();
        expect(plainOf(filed.letter)).toMatch(/Oswin/);
        player.children = [];
    });

    it('a plea from a town in want: coin sent goes into their purse and they remember it', () => {
        const { world, player } = game;
        const f = folkFriend('villager', 90);
        const R = { id: 900, due: world.day, sentDay: world.day, from: { ...f.to }, kind: 'plain', tone: 'warm', unprompted: true, reason: 'request', subject: 'A plea', vars: {}, answerVars: {}, body: '' };
        // Their market is short of grain
        const m = f.settlement.market || {};
        f.settlement.market = { ...m, stock: { ...(m.stock || {}), grain: 0, bread: 0 }, short: { ...(m.short || {}), food: 1 } };
        Utils.withRng(Utils.seededRandom(9), () => Mail._write(world, player, R, { to: f.to }));
        if (R.kind !== 'mail_request') return; // (no food good tracked in this town's market)
        Mail.state(player).replies.push(R);
        run(1);
        const letter = CourtLetters.state(player).inbox.find(l => l.kind === 'mail_request');
        expect(letter).toBeTruthy();
        expect(letter.letter).toBeTruthy();
        const purse = Townsfolk.purse(f.settlement.folk, f.person, world);
        const disp = f.person.mem.disposition;
        const gold = player.gold;
        const ans = CourtLetters.answer(player, world, letter.id, 'coin');
        expect(ans.success).toBe(true);
        expect(player.gold).toBe(gold - letter.data.request.gold);
        expect(f.person.purse).toBe(purse + letter.data.request.gold);
        expect(f.person.mem.disposition).toBeGreaterThan(disp);
    });

    it('an invitation promised is kept by coming to their town in time', () => {
        const { world, player } = game;
        const f = folkFriend('farmer', 90);
        const st = Mail.state(player);
        st.visits.push({ key: f.to.key, type: 'folk', name: f.to.name, q: f.to.q, r: f.to.r, town: f.to.place, until: world.day + 10, personId: f.person.id });
        const disp = f.person.mem.disposition;
        player.q = f.to.q;
        player.r = f.to.r;
        const out = run(1);
        expect(st.visits).toHaveLength(0);
        expect(out.notices.some(n => /Welcomes You/.test(n.title))).toBe(true);
        expect(f.person.mem.disposition).toBeGreaterThan(disp);
    });
});

describe('Old saves and the panel', () => {
    it('a mailbag from before letters had voices loads, and its pending reply is filed as before', () => {
        const { world, player } = game;
        const to = lordRec(0);
        player.mail = {
            outbox: [], sent: [], recent: {}, favours: {}, nextId: 5, today: { day: -1, n: 0 }, stats: { sent: 1 },
            replies: [{ id: 4, due: world.day + 1, sentDay: world.day, from: { ...to }, kind: 'plain', tone: 'warm', body: 'Lord X writes back warmly.', subject: 'Re: A letter of courtesy' }],
        };
        Mail.loadState(player);
        expect(player.mail.corr).toEqual({});
        expect(player.mail.visits).toEqual([]);
        run(2);
        const filed = CourtLetters.state(player).archive[0];
        expect(filed.text).toMatch(/writes back warmly/);
        expect(filed.letter).toBeUndefined();
        // Saved and restored with the new fields
        Mail.send(player, world, { to: to.key, kind: 'courtesy', courier: 'own' });
        run(40);
        const ps = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const p2 = new Player();
        SaveLoad.restorePlayer(ps, p2, world);
        expect(Object.keys(p2.mail.corr).length).toBeGreaterThan(0);
        expect(p2.letters.archive.some(a => a.letter && Array.isArray(a.letter.paras))).toBe(true);
    });

    it('the Letters panel shows a letter in full, garbled notes and all, without leaking undefined', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { world, player } = game;
        const to = lordRec(1);
        Mail.send(player, world, { to: to.key, kind: 'gift', courier: 'own', gold: 25 });
        run(40);
        CourtLetters.state(player).archive.push({ id: 9999, kind: 'mail_reply', day: 1, from: { name: 'Old' }, subject: 'An old reply', outcome: 'reply', text: 'Short.' });
        const shown = [];
        const g = { player, world, ui: { showCustomPanel: (t, html) => shown.push(html), showNotification: () => {}, updateStats: () => {}, hideCustomPanel: () => {} } };
        const filed = CourtLetters.state(player).archive.find(a => a.letter);
        ActionMenu.lettersAct(g, 'tab', 'answered');
        ActionMenu.lettersAct(g, 'read', filed.id);
        ActionMenu.lettersAct(g, 'tab', 'inbox');
        ActionMenu.lettersAct(g, 'tab', 'accounts');
        const html = shown.join('');
        expect(html).toContain(filed.letter.signature);
        for (const h of shown) expect(h).not.toMatch(/undefined|NaN|could not be drawn/);
    });
});

describe('The LLM voice', () => {
    it('only takes a rewrite that keeps every number and brings no new name', async () => {
        expect(NpcBrain._letterOk(['We thank you for the 100 gold. Valdoria is grateful.'], ['Our thanks for the 100 gold; Valdoria is grateful indeed.'])).toBe(true);
        expect(NpcBrain._letterOk(['We thank you for the 100 gold.'], ['We thank you for the 200 gold.'])).toBe(false);
        expect(NpcBrain._letterOk(['We thank you for the 100 gold.'], ['We thank you, and Sir Bertram, for the 100 gold.'])).toBe(false);
        expect(NpcBrain._letterOk(['We thank you for the 100 gold.'], ['Ormond thanks you for the 100 gold.'])).toBe(false);
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: '{"paras": ["Your 100 gold came, and Mosswood rejoices, as does Duke Ormond."]}' });
        const letter = { major: true, paras: ['Your 100 gold came to Mosswood.'], from: 'Queen Elara', persona: 'warm', tone: 'warm' };
        expect(await MailVoice.voice(letter)).toBe(false);
        expect(letter.voiced).toBeUndefined();
        LlmClient.chat.mockResolvedValue({ ok: true, text: '{"paras": ["The 100 gold reached Mosswood, and gladdened us."]}' });
        expect(await MailVoice.voice(letter)).toBe(true);
        expect(letter.voiced.paras[0]).toMatch(/100 gold/);
        // The written letter stands beside it
        expect(letter.paras[0]).toBe('Your 100 gold came to Mosswood.');
    });
});
