// Meeting a rival lord as a person (systems/rivalAudience.js, systems/rivalHouses.js,
// ui/actionMenu/rivalAudience.js): a face and a manner, a mood from their own
// days, a memory of what you did to them, talk in their own words, and offers
// of their own — kept or broken by their honour.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { RivalHouses } from '../systems/rivalHouses.js';
import { RivalAudience } from '../systems/rivalAudience.js';
import { Schemes } from '../systems/schemes.js';
import { Estates } from '../world/estates.js';
import { Upbringing } from '../systems/upbringing.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let ActionMenu;
beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const rivalsOf = (game) => RivalHouses.rivals(game.player);

function days(game, n) {
    for (let i = 0; i < n; i++) endDay(game);
}

/** Put the player on a rival's retinue and return { rival, unit }. */
function meet(game, i = 0) {
    const rival = rivalsOf(game)[i];
    const unit = RivalHouses.retinueOf(game.world, rival);
    game.player.q = unit.q;
    game.player.r = unit.r;
    return { rival, unit };
}

/** A stand-in for the conversation stage: records what is said and offered. */
function fakeScene() {
    const s = {
        isOpen: true, said: [], notes: [], list: [], cfg: null,
        overlay: { querySelector: () => null },
        npc(t) { s.said.push(t); return s; }, player() { return s; }, note(h) { s.notes.push(h); return s; },
        seal() {}, setMood() {}, thinking() { return s; }, clearChoices() {}, skip() {}, leave() { s.isOpen = false; }, close() { s.isOpen = false; },
        exchange(line, fn) { fn(); }, afterSpoken(p, fn) { fn(); }, choices(list) { s.list = list; },
    };
    return s;
}

describe('the head as a person', () => {
    it('has a face, a passion and an honour fixed by their name, and a manner from their temper', () => {
        const game = newGame(351);
        days(game, 1);
        for (const r of rivalsOf(game)) {
            const p = r.head.persona;
            expect(p).toMatchObject({ build: expect.any(String), hair: expect.any(String), feature: expect.any(String) });
            expect(p.honour).toBeGreaterThanOrEqual(1);
            expect(p.honour).toBeLessThanOrEqual(9);
            expect(RivalHouses._persona(r, r.head)).toEqual(p);
            expect(RivalHouses.describe(r)).toMatch(new RegExp(`of ${r.head.age},`));
            expect(['haughty', 'silken', 'soft', 'brisk', 'plain']).toContain(RivalHouses.manner(r));
            expect(r.head.martial).toBeGreaterThanOrEqual(2);
        }
        const before = rivalsOf(game).map(r => JSON.stringify(r.head.persona));
        const again = roundTrip(game);
        expect(rivalsOf(again).map(r => JSON.stringify(r.head.persona))).toEqual(before);
    }, 120000);

    it('remembers what you did: a gift warms them, an insult chills them, and both fade', () => {
        const game = newGame(352);
        days(game, 1);
        const { player, world } = game;
        const { rival } = meet(game);
        rival.feud = 40;
        player.gold = 5000;
        const r0 = RivalHouses.regard(rival, world);
        expect(RivalHouses.gift(player, world, rival.kingdomId).success).toBe(true);
        const r1 = RivalHouses.regard(rival, world);
        expect(r1).toBeGreaterThan(r0);
        // A second gift within the month buys half as much
        const feud = rival.feud;
        const g2 = RivalHouses.gift(player, world, rival.kingdomId);
        expect(g2.again).toBe(true);
        expect(rival.feud).toBe(feud + Math.round(RivalHouses.config().meet.gift.feud / 2));
        world.day += 1;
        RivalHouses.insult(player, world, rival.kingdomId);
        expect(RivalHouses.memoryOf(rival, world)[0].kind).toBe('insult');
        // Faded over time
        const now = RivalHouses.memoryScore(rival, world);
        world.day += 480;
        expect(Math.abs(RivalHouses.memoryScore(rival, world))).toBeLessThan(Math.abs(now));
    }, 120000);

    it('their mood comes from their own days, and colours the greeting', () => {
        const game = newGame(353);
        days(game, 1);
        const { player, world } = game;
        const { rival } = meet(game);
        expect(RivalHouses.mood(rival, world).id).toBe('calm');
        RivalHouses.event(rival, world, 'wedding');
        expect(RivalHouses.mood(rival, world).id).toBe('wedding');
        expect(RivalAudience.greeting(player, world, rival)).toMatch(/wed/);
        RivalHouses.event(rival, world, 'attacked');
        expect(RivalHouses.mood(rival, world).label).toBe('Furious');
        world.day += 60;
        expect(RivalHouses.mood(rival, world).id).toBe('calm');
        // With no mood on them, a weighty memory opens the talk
        RivalHouses.remember(rival, world, 'attacked');
        expect(RivalAudience.greeting(player, world, rival)).toContain(RivalAudience.voice().recall.attacked);
    }, 120000);
});

describe('talk', () => {
    it('answers each topic in their own words, once a day', () => {
        const game = newGame(354);
        days(game, 10);
        const { player, world } = game;
        const { rival } = meet(game);
        rival.feud = 10;
        const ids = RivalAudience.topics(player, world, rival).map(t => t.id);
        expect(ids).toEqual(expect.arrayContaining(['business', 'news', 'family', 'you', 'passion']));
        for (const id of ids) {
            const { lines } = RivalAudience.topic(player, world, rival, id);
            expect(lines.length).toBeGreaterThan(0);
            for (const l of lines) expect(l).not.toMatch(/\{\w+\}/); // every placeholder filled
        }
        expect(RivalAudience.topics(player, world, rival)).toHaveLength(0);
        world.day += 1;
        expect(RivalAudience.topics(player, world, rival).length).toBe(ids.length);
    }, 120000);

    it('says why they think ill of you, and grants you your kindnesses apart', () => {
        const game = newGame(363);
        days(game, 1);
        const { player, world } = game;
        const { rival } = meet(game);
        rival.feud = 50; // cold: they will say why (a hostile head will not)
        RivalHouses.remember(rival, world, 'insult');
        RivalHouses.remember(rival, world, 'gift', '80g');
        const lines = RivalAudience.topic(player, world, rival, 'you').lines.join(' ');
        expect(lines).toMatch(/Shall I tell you why\? Your insult before the crowd\./);
        expect(lines).toMatch(/Though I grant you your gift of gold \(80g\)\./);
    }, 120000);

    it('speaks of other Houses as they regard them', () => {
        const game = newGame(355);
        days(game, 1);
        const { player, world } = game;
        const [a, b] = rivalsOf(game);
        RivalHouses.bond(a, b, -200);
        expect(RivalAudience.houseLine(player, world, a, b)).toMatch(/snakes/);
        RivalHouses.bond(a, b, 300);
        expect(RivalAudience.houseLine(player, world, a, b)).toMatch(/Family/);
    }, 120000);
});

describe('their offers', () => {
    it('a blood price buys a truce: no waylaying, no plots, until it ends', () => {
        const game = newGame(356);
        days(game, 1);
        const { player, world } = game;
        const { rival } = meet(game);
        rival.feud = 90;
        player.gold = 10000;
        player.army = [];
        rival.lastWaylayDay = null;
        const o = RivalAudience.allOffers(player, world, rival).find(x => x.kind === 'bloodPrice');
        expect(o.gold).toBe(RivalAudience.bloodPrice(rival));
        const res = RivalAudience.accept(player, world, rival, o);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(10000 - o.gold);
        expect(rival.feud).toBe(60);
        expect(RivalHouses.inTruce(rival, world)).toBe(true);
        rival.feud = 95;
        expect(RivalHouses.canWaylay(player, world, rival)).toBe(false);
        for (const r of rivalsOf(game)) if (r !== rival) r.truceUntil = world.day + 999;
        player.house.schemes = [];
        for (let i = 0; i < 30; i++) expect(Schemes._plot(player, world)).toBe(null);
        expect(RivalHouses._payPlot(player, world, rival)).toBe(null);
    }, 120000);

    it('a loan is repaid with interest by an honest House, and refused by a slippery one you can then press', () => {
        const game = newGame(357);
        days(game, 1);
        const { player, world } = game;
        const { rival } = meet(game);
        rival.feud = 20;
        rival.gold = 300;
        player.gold = 5000;
        const o = RivalAudience.allOffers(player, world, rival).find(x => x.kind === 'loan');
        expect(o).toBeTruthy();
        expect(RivalAudience.accept(player, world, rival, o).success).toBe(true);
        expect(rival.loans).toHaveLength(1);
        // Honest and able: repaid on the day
        rival.head.persona.honour = 8;
        rival.gold = 5000;
        world.day = rival.loans[0].due;
        const gold = player.gold;
        const out = { notices: [] };
        RivalHouses._dealsDay(player, world, rival, out);
        expect(player.gold).toBe(gold + o.owed);
        expect(out.notices.some(n => n.title === 'A Debt Repaid')).toBe(true);
        // Slippery and bitter: refused, and pressed for later
        rival.loans = [{ amount: 300, owed: 360, due: world.day, lent: 0 }];
        rival.head.persona.honour = 2;
        rival.feud = 70;
        RivalHouses._dealsDay(player, world, rival, out);
        expect(rival.loans[0].defaulted).toBe(world.day);
        expect(RivalAudience.owed(rival)).toBe(360);
        expect(RivalHouses.honourWord(rival)).toMatch(/broken their word/);
        const pressed = RivalAudience.demandRepayment(player, world, rival);
        expect(pressed.success).toBe(true);
        expect(RivalAudience.demandRepayment(player, world, rival).success).toBe(false); // once a day
    }, 120000);

    it('asks you to act against a House they hate, and is glad when you do', () => {
        const game = newGame(358);
        days(game, 1);
        const { player, world } = game;
        const [a, b] = rivalsOf(game);
        RivalHouses.bond(a, b, -200);
        a.feud = 50;
        meet(game, 0);
        const o = RivalAudience.allOffers(player, world, a).find(x => x.kind === 'against');
        expect(o && o.target).toBe(b.kingdomId);
        RivalAudience.accept(player, world, a, o);
        expect(a.ask.target).toBe(b.kingdomId);
        // Shame b's lord to their face
        meet(game, 1);
        world.day += 1;
        expect(RivalHouses.insult(player, world, b.kingdomId).success).toBe(true);
        expect(a.ask).toBe(null);
        expect(a.feud).toBeLessThanOrEqual(20); // −30 for the favour (and their enemy shamed pleases them a little more)
        const out = { notices: [] };
        RivalHouses._dealsDay(player, world, a, out);
        expect(out.notices.some(n => n.title === 'A Favour Done')).toBe(true);
    }, 120000);

    it('buys an estate of yours, and proposes a match without dowry', () => {
        const game = newGame(359);
        days(game, 35);
        const { player, world } = game;
        const { rival } = meet(game);
        rival.feud = 20;
        rival.gold = 100000;
        rival.ambition = { id: 'land', since: world.day, target: 3 };
        const e = Object.values(world.estates.estates).find(x => Estates.kindOf(x.holder) === 'noble');
        Estates.setHolder(world, e, 'player');
        const buy = RivalAudience.allOffers(player, world, rival).find(x => x.kind === 'buyEstate');
        expect(buy && buy.estateId).toBe(e.id);
        const gold = player.gold;
        expect(RivalAudience.accept(player, world, rival, buy).success).toBe(true);
        expect(e.holder).toBe(RivalHouses.holderId(rival));
        expect(player.gold).toBe(gold + buy.gold);

        const child = { id: 'c-ada', firstName: 'Ada', gender: 'female', age: 19, isAlive: true, traits: [], skills: {} };
        Upbringing.ensure(child);
        child.upbringing.comeOfAge = true;
        player.children = [child];
        rival.head.children = [{ firstName: 'Bertram', gender: 'male', age: 21 }];
        const m = RivalAudience.allOffers(player, world, rival).find(x => x.kind === 'match');
        expect(m).toMatchObject({ yourChild: 'Ada', theirChild: 'Bertram' });
        const g = player.gold;
        expect(RivalAudience.accept(player, world, rival, m).success).toBe(true);
        expect(player.gold).toBe(g); // no dowry
        expect(child.upbringing.spouse.name).toMatch(/^Bertram /);
    }, 120000);

    it('a proud head challenges you after an insult; the duel settles honour either way; a refused offer is remembered', () => {
        const game = newGame(360);
        days(game, 1);
        const { player, world } = game;
        const { rival } = meet(game);
        rival.head.traits = ['proud', 'courtly'];
        rival.feud = 60;
        RivalHouses.remember(rival, world, 'insult');
        const duel = RivalAudience.allOffers(player, world, rival).find(x => x.kind === 'duel');
        expect(duel).toBeTruthy();
        const res = RivalHouses.settleDuel(player, world, rival.kingdomId, { playerWon: true, aLost: 0.2 });
        expect(res.success).toBe(true);
        expect(rival.feud).toBe(40);
        expect(RivalAudience.allOffers(player, world, rival).some(x => x.kind === 'duel')).toBe(false); // not again so soon
        // Declining: not raised again for a month, and remembered
        rival.feud = 60;
        const bp = RivalAudience.allOffers(player, world, rival).find(x => x.kind === 'bloodPrice');
        RivalAudience.decline(player, world, rival, bp);
        expect(RivalAudience.allOffers(player, world, rival).some(x => x.kind === 'bloodPrice')).toBe(false);
        expect(RivalHouses.recalls(rival, world, 'declined', 1)).toBe(true);
    }, 120000);

    it('a slippery House sick with hatred may break a truce', () => {
        const game = newGame(361);
        days(game, 1);
        const { player, world } = game;
        const rival = rivalsOf(game)[0];
        rival.truceUntil = world.day + 100;
        rival.head.persona.honour = 1;
        rival.feud = 90;
        const C = RivalHouses.config();
        const spy = vi.spyOn(RivalHouses, 'config').mockReturnValue({ ...C, deals: { ...C.deals, breakChance: 1 } });
        try {
            const out = { notices: [] };
            RivalHouses._dealsDay(player, world, rival, out);
            expect(RivalHouses.inTruce(rival, world)).toBe(false);
            expect(out.notices.some(n => n.title === 'A Truce Broken')).toBe(true);
        } finally {
            spy.mockRestore();
        }
    }, 120000);
});

describe('the stage', () => {
    it('opens with their face, mood and memories, offers talk and their proposals, and answers', async () => {
        const { ConversationScene } = await import('../ui/conversationScene.js');
        const game = newGame(362);
        days(game, 1);
        const { player, world } = game;
        const { rival, unit } = meet(game);
        rival.feud = 70;
        RivalHouses.remember(rival, world, 'insult');
        const scene = fakeScene();
        const spy = vi.spyOn(ConversationScene, 'open').mockImplementation((c) => { scene.cfg = c; return scene; });
        game.ui = { showNotification: vi.fn(), updateStats: vi.fn(), showCustomPanel: vi.fn(), hideCustomPanel: vi.fn() };
        try {
            ActionMenu.showRivalHead(game, unit.id);
            expect(scene.cfg.name).toBe(RivalHouses.headName(rival));
            expect(scene.cfg.greeting.length).toBeGreaterThan(10);
            expect(scene.cfg.facts).toContain('Remembers your insult before the crowd');
            expect(scene.cfg.facts).toContain(rival.head.persona.feature);
            const labels = scene.list.map(c => c.label);
            expect(labels).toContain('What do you think of me, truly?');
            expect(labels.some(l => /blood price/.test(l))).toBe(true);
            // Ask what they think of you: they say it
            const n = scene.said.length;
            scene.list.find(c => c.label === 'What do you think of me, truly?').onPick();
            expect(scene.said.length).toBeGreaterThan(n);
            // A pitch, then accept
            player.gold = 99999;
            scene.list.find(c => /blood price/.test(c.label)).onPick();
            scene.list.find(c => c.label === 'Agreed.').onPick();
            expect(RivalHouses.inTruce(rival, world)).toBe(true);
            // The overview still renders with the people in it
            let shown = null;
            game.ui.showCustomPanel = (t, html) => { shown = html; };
            ActionMenu.showRivalHouses(game);
            for (const r of rivalsOf(game)) expect(shown).toContain(r.head.firstName);
        } finally {
            spy.mockRestore();
        }
    }, 120000);
});
