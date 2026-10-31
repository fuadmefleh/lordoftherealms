// The post: courier houses in the towns (systems/couriers.js) and the letters
// the player sends through them (systems/mail.js) — travel time, loss,
// robbery, interception, the recipient's reaction and reply, NPC houses
// founded, competing and failing, the player's own house and its weekly books,
// the Royal Post, save/load, the RNG streams and the Letters panel. Run on a
// real generated world (the playtest harness), where towns live on tiles.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { NPCLords } from '../world/npcLords.js';
import { Couriers } from '../systems/couriers.js';
import { Mail } from '../systems/mail.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Kingship } from '../systems/kingship.js';
import { Upbringing } from '../systems/upbringing.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { loadData, newGame } from './playtest/harness.js';

let game;
let saved;
beforeAll(async () => {
    await loadData();
    game = newGame(4242);
    saved = JSON.parse(JSON.stringify({ cfg: Couriers.config() }));
}, 60000);

/** A fresh post, a fresh mailbag, gold, and the player standing in a town that has a post. */
function reset() {
    const { world, player } = game;
    world.post = null;
    player.mail = null;
    player.letters = null;
    player.gold = 5000;
    player.financeToday = { income: {}, expenses: {} };
    world.day = 50;
    Couriers.state(world);
    Couriers._seedHouses(world);
}

function standAt(town) {
    game.player.q = town.q;
    game.player.r = town.r;
}

/** A town with at least one courier serving it, and a lord to write to elsewhere. */
function servedTown() {
    const { world } = game;
    for (const c of Couriers.alive(world)) {
        for (const s of c.stations) {
            const t = Couriers.town(world, s.key);
            if (t && Couriers.servingAt(world, t.key, t.kingdomId).length) return t;
        }
    }
    return null;
}

function lordRec(exceptKid) {
    const { world, player } = game;
    return Mail.recipients(player, world).find(r => r.type === 'lord' && r.kingdomId !== exceptKid);
}

/** Run the mail tick until the day (inclusive). */
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

function setMail(over) {
    Object.assign(Couriers.config().mail, over);
}

beforeEach(() => reset());
afterEach(() => {
    const cfg = Couriers.config();
    for (const k of ['mail', 'danger', 'charter', 'events', 'npc']) Object.assign(cfg[k], saved.cfg[k]);
    vi.restoreAllMocks();
});

describe('Courier houses (systems/couriers.js)', () => {
    it('are seeded one to a realm, with stations in nearby towns', () => {
        const { world } = game;
        const alive = Couriers.alive(world);
        const realms = world.kingdoms.filter(k => k.isAlive !== false && [...Couriers.towns(world).values()].some(t => t.kingdomId === k.id));
        expect(alive.length).toBe(realms.length);
        for (const c of alive) {
            expect(c.stations.length).toBeGreaterThanOrEqual(1);
            expect(c.riders).toBeGreaterThan(0);
            expect(c.name).toMatch(/\w/);
        }
    });

    it('the weekly tick runs on its own seeded stream (the main RNG is untouched) and is deterministic', () => {
        const { world, player } = game;
        Utils.setSeed(5);
        const expected = Utils.random();
        Utils.setSeed(5);
        for (let d = 51; d <= 120; d++) { world.day = d; Couriers.processDay(world, player); Mail.processDay(world, player); }
        expect(Utils.random()).toBe(expected);
        const a = JSON.stringify(Couriers.alive(world).map(c => [c.id, c.price, c.cash, c.stations.length]));
        reset();
        for (let d = 51; d <= 120; d++) { world.day = d; Couriers.processDay(world, player); }
        expect(JSON.stringify(Couriers.alive(world).map(c => [c.id, c.price, c.cash, c.stations.length]))).toBe(a);
    });

    it('split a town\'s mail by price and reputation; the cheaper house carries more', () => {
        const { world } = game;
        const t = servedTown();
        const a = Couriers.servingAt(world, t.key, t.kingdomId)[0];
        const b = Couriers._make(world, t, { cash: 500, reputation: a.reputation, price: a.price * 0.5 });
        b.riders = 2;
        Couriers._week(world, null, { notices: [] });
        expect(b.week.towns[t.key]).toBeGreaterThan(0);
        const share = (c) => c.history[0].letters;
        expect(b.history[0]).toBeTruthy();
        // b only serves this town; a's letters here are a part of its total
        expect(share(b)).toBeGreaterThan(0);
        const aHere = a.week.towns[t.key] / (a.price * Couriers.speed(a.speed).price);
        const bHere = b.week.towns[t.key] / (b.price * Couriers.speed(b.speed).price);
        expect(bHere).toBeGreaterThan(aHere);
    });

    it('go bankrupt when their cash runs out, and new houses are founded where towns go unserved', () => {
        const { world } = game;
        const c = Couriers.alive(world)[0];
        c.cash = -10000;
        Couriers._week(world, null, { notices: [] });
        expect(c.alive).toBe(false);
        expect(Couriers.state(world).news.some(n => /bankrupt/.test(n.text))).toBe(true);
        // A town nobody serves, unserved long enough
        const towns = Couriers.towns(world);
        const lonely = [...towns.values()].find(t => t.type !== 'village' && !Couriers.alive(world).some(o => Couriers.hasStation(o, t.key)) && !Couriers.charter(world, t.kingdomId));
        expect(lonely).toBeTruthy();
        Couriers.state(world).unserved[lonely.key] = 999;
        const before = Couriers.alive(world).length;
        Couriers._foundings(world, towns, { notices: [] }, null);
        expect(Couriers.alive(world).length).toBe(before + 1);
        expect(Couriers.alive(world).some(o => o.home === lonely.key)).toBe(true);
    });

    it('cut costs and prices when losing, never below their floor', () => {
        const { world } = game;
        const c = Couriers.alive(world)[0];
        c.week = { ...Couriers._blankWeek(), profit: -50 };
        c.lossWeeks = 5;
        c.price = 10;
        Couriers._npcTurn(world, c, Couriers.towns(world), { notices: [] }, null);
        expect(c.price).toBeLessThan(10);
        c.price = 0.1;
        c.week = { ...Couriers._blankWeek(), profit: -50 };
        c.lossWeeks = 5;
        Couriers._npcTurn(world, c, Couriers.towns(world), { notices: [] }, null);
        expect(c.price).toBeGreaterThanOrEqual(Couriers.config().price.base * Couriers.config().npc.minPriceMult);
    });
});

describe('The player\'s courier house', () => {
    function foundHere() {
        const { world, player } = game;
        const t = [...Couriers.towns(world).values()].find(x => x.type !== 'village' && !Couriers.charter(world, x.kingdomId));
        standAt(t);
        return { t, res: Couriers.found(player, world, { name: 'Vane Post' }) };
    }

    it('is founded for its price and licence, through the Ledger', () => {
        const { world, player } = game;
        const { res } = foundHere();
        expect(res.success).toBe(true);
        const C = Couriers.config().costs;
        expect(player.gold).toBe(5000 - C.foundPrice - C.licence);
        expect(player.financeToday.income.courierCapital).toBe(-(C.foundPrice + C.licence));
        expect(Couriers.playerHouse(world).name).toBe('Vane Post');
        expect(Couriers.found(player, world).success).toBe(false); // one house only
    });

    it('opens stations, hires, sets its price and pace; the week settles takings and wages in the purse', () => {
        const { world, player } = game;
        foundHere();
        const opt = Couriers.stationOptions(world, player).find(o => o.ok);
        expect(Couriers.openStation(player, world, opt.town.key).success).toBe(true);
        expect(Couriers.staff(player, world, 'riders', 2).success).toBe(true);
        expect(Couriers.staff(player, world, 'guards', 1).success).toBe(true);
        expect(Couriers.staff(player, world, 'horses', 3).success).toBe(true);
        expect(Couriers.setPrice(player, world, 3).success).toBe(true);
        expect(Couriers.setSpeed(player, world, 'express').success).toBe(true);
        const c = Couriers.playerHouse(world);
        player.financeToday = { income: {}, expenses: {} };
        const gold = player.gold;
        Couriers._week(world, player, { notices: [] });
        const h = c.history[0];
        expect(h.revenue).toBeGreaterThan(0);
        expect(player.gold).toBe(gold + h.revenue - h.costs);
        expect(player.financeToday.income.courierHouse).toBe(h.revenue);
        expect(-(player.financeToday.expenses.courierCosts || 0) - (player.financeToday.expenses.royalPost || 0)).toBe(-h.costs);
    });

    it('a sealed letter in a rider\'s bag: read it and you learn the realm\'s affairs, at a risk', () => {
        const { world, player } = game;
        foundHere();
        Couriers.config().events.bagChance = 1;
        Couriers.config().events.sabotageChance = 0;
        Couriers._playerEvents(world, player, { notices: [] });
        const bag = CourtLetters.open(player).find(l => l.kind === 'courier_bag');
        expect(bag).toBeTruthy();
        const choices = CourtLetters.choicesFor(player, world, bag).map(c => c.id);
        expect(choices).toContain('read');
        vi.spyOn(Utils, 'random').mockReturnValue(0); // found out
        const k = world.getKingdom(bag.data.kingdomId);
        const res = CourtLetters.answer(player, world, bag.id, 'read');
        expect(res.success).toBe(true);
        expect(NPCLords.memoryOf(k.lord).some(m => m.key === 'mail_tampered')).toBe(true);
    });

    it('can win a Royal Post charter; the holder alone carries the realm\'s mail', () => {
        const { world, player } = game;
        const { t } = foundHere();
        const c = Couriers.playerHouse(world);
        const other = [...Couriers.towns(world).values()].find(x => x.kingdomId === t.kingdomId && x.key !== t.key);
        if (other) Couriers._addStation(c, other);
        const q = Couriers.bidQuote(player, world, t.kingdomId);
        if (!other) return; // a one-town realm can't hold a charter
        expect(q.ok).toBe(true);
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const res = Couriers.bidCharter(player, world, t.kingdomId);
        expect(res.won).toBe(true);
        vi.restoreAllMocks();
        expect(Couriers.charter(world, t.kingdomId).courierId).toBe(c.id);
        // The other houses with a station in the realm carry nothing there now
        const rival = Couriers.alive(world).find(o => o !== c && o.stations.some(s => s.kingdomId === t.kingdomId));
        Couriers._week(world, player, { notices: [] });
        if (rival) for (const s of rival.stations.filter(s => s.kingdomId === t.kingdomId)) expect(rival.week.towns[s.key] || 0).toBe(0);
        expect(c.week.fee).toBeGreaterThan(0);
        expect(player.financeToday.expenses.royalPost).toBeGreaterThan(0);
    });

    // (A player-king grants and revokes it as the Royal Post edict of the Royal
    // Court: systems/kingship.js, tested in courierRiders.test.js. Couriers.rulerGrant is gone.)
    it("NPC crowns grant the Royal Post to a strong house; it shows as the crown's policy", () => {
        const { world, player } = game;
        Couriers.config().charter.grantChance = 1;
        const c = Couriers.alive(world).find(x => x.stations.length >= 3) || Couriers.alive(world)[0];
        const kid = c.stations[0].kingdomId;
        const towns = [...Couriers.towns(world).values()].filter(x => x.kingdomId === kid);
        for (const t of towns.slice(0, 3)) Couriers._addStation(c, t);
        c.reputation = 99;
        if (Couriers.stationsIn(c, kid) < 3) return;
        Couriers._charters(world, player, { notices: [] });
        expect(Couriers.charter(world, kid)).toBeTruthy();
        expect(Couriers.charter(world, kid).by).toBe('crown');
        const pol = Kingship.crownPolicies(player, world, kid);
        expect(pol.find(x => x.id === 'royal_post').text).toContain(Couriers.get(world, Couriers.charter(world, kid).courierId).name);
    });
});

describe('Sending mail (systems/mail.js)', () => {
    function sendCourtesy(kind = 'courtesy', extra = {}) {
        const { world, player } = game;
        const t = servedTown();
        standAt(t);
        const to = extra.to || lordRec(t.kingdomId);
        const opts = Mail.courierOptions(player, world, to);
        const courier = opts.find(o => o.id !== 'own') || opts[0];
        const res = Mail.send(player, world, { to: to.key, kind, courier: courier.id, ...extra.opts });
        return { t, to, courier, res };
    }

    it('rides for the days its courier quotes, by distance and road; postage through the Ledger', () => {
        const { world, player } = game;
        setMail({ delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0, replyChance: 1 });
        const { to, courier, res } = sendCourtesy();
        expect(res.success).toBe(true);
        const L = res.letter;
        expect(L.arriveDay).toBe(50 + courier.days);
        expect(courier.days).toBeGreaterThanOrEqual(1);
        expect(player.financeToday.expenses.postage).toBe(courier.price);
        // Faster riders get there sooner (or as soon)
        const far = Hex.wrappingDistance(L.from.q, L.from.r, to.q, to.r, world.width);
        expect(Couriers.travelDays(world, L.from, to, 16)).toBeLessThanOrEqual(Couriers.travelDays(world, L.from, to, 7));
        expect(far).toBeGreaterThanOrEqual(0);
        // Not before its day
        const early = runTo(L.arriveDay - 1);
        expect(early.delivered).toHaveLength(0);
        Couriers.config().danger.robChance = 0;
        const on = runTo(L.arriveDay);
        expect(on.delivered).toHaveLength(1);
        const k = world.getKingdom(to.kingdomId);
        expect(NPCLords.memoryOf(k.lord).some(m => m.key === 'letter_kind') || on.delivered[0].tone === 'hostile').toBe(true);
    });

    it('the reply rides back and is filed in the Letters archive', () => {
        setMail({ delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0, replyChance: 1 });
        Couriers.config().danger.robChance = 0;
        const { player } = game;
        const { res } = sendCourtesy();
        const L = res.letter;
        runTo(L.arriveDay);
        const st = Mail.state(player);
        expect(st.replies).toHaveLength(1);
        const out = runTo(L.arriveDay + L.days);
        expect(out.replies).toHaveLength(1);
        expect(CourtLetters.state(player).archive[0].outcome).toBe('reply');
        expect(st.sent[0].status).toBe('delivered');
    });

    it('can be lost on the road', () => {
        setMail({ delay: 0, winterDelay: 0, lossShare: 100 });
        const { res } = sendCourtesy();
        const out = runTo(res.letter.arriveDay);
        expect(Mail.state(game.player).sent[0].status).toBe('lost');
        expect(out.notices.some(n => /Lost/.test(n.title))).toBe(true);
    });

    it('can be robbed on dangerous roads: what it carries is stolen', () => {
        setMail({ delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0 });
        Couriers.config().danger.robChance = 1000;
        const { player } = game;
        const { res } = sendCourtesy('gift', { opts: { gold: 100 } });
        expect(res.success).toBe(true);
        expect(player.financeToday.expenses.mailGifts).toBe(100);
        res.letter.danger = 0.9;
        res.letter.courier.guardCover = 0;
        runTo(res.letter.arriveDay);
        expect(res.letter.stolen.gold).toBe(100);
        expect(['robbed', 'delivered']).toContain(Mail.state(player).sent[0].status);
    });

    it('a warning read by the enemy it warns of: that enemy remembers', () => {
        setMail({ delay: 0, winterDelay: 0, lossShare: 0, intercept: 1, interceptMax: 1 });
        Couriers.config().danger.robChance = 0;
        const { world, player } = game;
        const t = servedTown();
        standAt(t);
        const to = Mail.recipients(player, world).find(r => r.type === 'lord' && (r.enemies || []).length);
        if (!to) return; // no war in this world today
        const opts = Mail.courierOptions(player, world, to);
        const res = Mail.send(player, world, { to: to.key, kind: 'warning', courier: opts[0].id });
        expect(res.success).toBe(true);
        runTo(res.letter.arriveDay);
        const by = res.letter.intercepted;
        expect(by).toBeTruthy();
        if (by.kind === 'realm') expect(NPCLords.memoryOf(world.getKingdom(by.kingdomId).lord).some(m => m.key === 'letter_read_by_enemy')).toBe(true);
    });

    it('courtesy only helps so much: the third letter in a season is tiresome', () => {
        setMail({ delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0, perDay: 10, maxInTransit: 10 });
        Couriers.config().danger.robChance = 0;
        const { player } = game;
        const first = sendCourtesy();
        sendCourtesy('courtesy', { to: first.to });
        const third = sendCourtesy('courtesy', { to: first.to });
        runTo(third.res.letter.arriveDay);
        const sent = Mail.state(player).sent.filter(s => s.id === third.res.letter.id)[0];
        expect(sent.text).toMatch(/great many letters/);
    });

    it('is rate-limited: letters a day and letters on the road', () => {
        const { player } = game;
        const M = Mail.config();
        for (let i = 0; i < M.perDay; i++) expect(sendCourtesy().res.success).toBe(true);
        const r = sendCourtesy().res;
        expect(r.success).toBe(false);
        expect(Mail.state(player).outbox.length).toBe(M.perDay);
    });

    it('negotiates a held child\'s release: the price comes back, paying frees the child', () => {
        setMail({ delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0, freeReleaseRegard: 999 });
        Couriers.config().danger.robChance = 0;
        const { world, player } = game;
        const t = servedTown();
        standAt(t);
        const k = world.kingdoms.find(x => x.isAlive !== false && x.lord && x.id !== t.kingdomId && Mail._seat(world, x.id));
        const child = { id: 'kid1', firstName: 'Wynn', isAlive: true, age: 18 };
        player.children = [child];
        Upbringing.ensure(child).heldBy = { kingdomId: k.id, day: 10 };
        const to = Mail.recipient(player, world, `lord:${k.id}`);
        expect(Mail.kindOptions(player, world, to).map(o => o.id)).toContain('ransom');
        const res = Mail.send(player, world, { to: to.key, kind: 'ransom', courier: Mail.courierOptions(player, world, to)[0].id });
        expect(res.success).toBe(true);
        runTo(res.letter.arriveDay + res.letter.days);
        const offer = CourtLetters.open(player).find(l => l.kind === 'mail_ransom');
        expect(offer).toBeTruthy();
        const gold = player.gold;
        const ans = CourtLetters.answer(player, world, offer.id, 'pay');
        expect(ans.success).toBe(true);
        expect(player.gold).toBe(gold - offer.data.amount);
        expect(Upbringing.ensure(child).heldBy).toBeUndefined();
        player.children = [];
    });

    it('a married soul\'s love letter, opened on the way, is a scandal or a blackmailer\'s letter', () => {
        setMail({ delay: 0, winterDelay: 0, lossShare: 0, intercept: 1, interceptMax: 1 });
        Couriers.config().danger.robChance = 0;
        const { world, player } = game;
        const t = servedTown();
        standAt(t);
        const L = {
            id: 99, kind: 'love', to: { key: 'npc:x', type: 'npc', name: 'Ada Ashborne', q: t.q, r: t.r, place: t.name, kingdomId: t.kingdomId },
            courier: { id: 'own', name: 'Your own rider', reliability: 0.85, guardCover: 0 }, intercepted: { kind: 'busybody', name: 'a busybody' },
        };
        player.spouse = 'sp1';
        player.relationships = player.relationships || {};
        player.relationships.sp1 = { score: 50, affection: 60, romantic: true, history: [] };
        const out = { notices: [] };
        Mail._intercepted(world, player, L, out);
        const blackmail = CourtLetters.open(player).find(l => l.kind === 'mail_blackmail');
        expect(!!blackmail || player.relationships.sp1.affection < 60).toBe(true);
        if (blackmail) {
            CourtLetters.answer(player, world, blackmail.id, 'refuse');
            expect(player.relationships.sp1.affection).toBeLessThan(60);
        }
        player.spouse = null;
        delete player.relationships.sp1;
    });
});

describe('Save / load and the panel', () => {
    it('the post and the mailbag survive a save and load', () => {
        const { world, player } = game;
        const t = servedTown();
        standAt(t);
        Couriers.found(player, world);
        const to = lordRec(t.kingdomId);
        Mail.send(player, world, { to: to.key, kind: 'courtesy', courier: 'own' });
        const ws = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        expect(ws.post.couriers.length).toBe(Couriers.all(world).length);
        const back = { post: null };
        Couriers.restore(ws.post, back);
        expect(JSON.stringify(back.post)).toBe(JSON.stringify(world.post));
        Couriers.restore(undefined, back); // an older save
        expect(back.post.couriers).toEqual([]);
        const ps = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const p2 = new Player();
        SaveLoad.restorePlayer(ps, p2, world);
        expect(p2.mail.outbox).toHaveLength(1);
        expect(p2.mail.outbox[0].to.key).toBe(to.key);
        const p3 = new Player();
        delete ps.mail;
        SaveLoad.restorePlayer(ps, p3, world);
        expect(p3.mail.outbox).toEqual([]);
    });

    it('every Letters tab renders without throwing or leaking undefined/NaN', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { world, player } = game;
        const t = servedTown();
        standAt(t);
        Couriers.found(player, world);
        const to = lordRec(t.kingdomId);
        Mail.send(player, world, { to: to.key, kind: 'courtesy', courier: 'own' });
        const shown = [];
        const g = {
            player, world,
            ui: { showCustomPanel: (title, html) => shown.push(html), showNotification: () => {}, updateStats: () => {}, hideCustomPanel: () => {} },
        };
        for (const tab of ['inbox', 'write', 'transit', 'post', 'answered', 'accounts', 'memory']) ActionMenu.lettersAct(g, 'tab', tab);
        ActionMenu.lettersAct(g, 'pick', to.key);
        ActionMenu.lettersAct(g, 'kind', 'gift');
        ActionMenu.lettersAct(g, 'gold', 25);
        ActionMenu.lettersAct(g, 'courier', 'own');
        ActionMenu.lettersAct(g, 'send');
        ActionMenu.lettersAct(g, 'staff', 'riders', 1);
        ActionMenu.lettersAct(g, 'price', 5);
        ActionMenu.lettersAct(g, 'tab', 'post');
        expect(shown.length).toBeGreaterThanOrEqual(10);
        for (const html of shown) {
            expect(html).not.toMatch(/undefined|NaN|could not be drawn/);
        }
        expect(shown.join('')).toMatch(/Your courier house/);
        expect(Mail.state(player).outbox.length).toBe(2);
    });
});
