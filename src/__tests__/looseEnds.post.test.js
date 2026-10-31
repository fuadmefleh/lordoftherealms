// The post's loose ends: a reply rides home as a messenger on the map (its
// purse can be taken on the road, the letter still comes); a letter or
// reply with no rider (an older save's) is given one where it would be by
// now; a house's rider waylaid on the map costs the house its bag at the
// week's reckoning; a famous visitor can turn a plea down outright; and a
// Royal Post the player proclaimed by edict becomes the next crown's grant
// once the player no longer rules.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { Couriers } from '../systems/couriers.js';
import { Mail } from '../systems/mail.js';
import { CourierRiders, RIDER_TYPE } from '../systems/courierRiders.js';
import { Fame } from '../systems/fame.js';
import { Quests } from '../systems/quests.js';
import { NpcTasks } from '../systems/npcTasks.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { loadData, newGame } from './playtest/harness.js';

let game;
let saved;
beforeAll(async () => {
    await loadData();
    game = newGame(4244);
    saved = JSON.parse(JSON.stringify({ cfg: Couriers.config(), riders: Couriers.data().riders }));
}, 60000);

function reset() {
    const { world, player } = game;
    world.post = null;
    world.units = (world.units || []).filter(u => u.type !== RIDER_TYPE && u.id !== 'test_band');
    player.mail = null;
    player.letters = null;
    player.gold = 5000;
    player.financeToday = { income: {}, expenses: {} };
    world.day = 50;
    Couriers.state(world);
    Couriers._seedHouses(world);
}

beforeEach(() => {
    reset();
    Object.assign(Couriers.config().mail, { delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0 });
    Object.assign(Couriers.data().riders, { robShare: 0, lairChance: 0, warIntercept: 0, warSeize: 0 });
});
afterEach(() => {
    const cfg = Couriers.config();
    for (const k of ['mail', 'danger', 'charter', 'events', 'npc']) Object.assign(cfg[k], saved.cfg[k]);
    Object.assign(Couriers.data().riders, saved.riders);
    vi.restoreAllMocks();
});

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

function farLord(from) {
    const { world, player } = game;
    return Mail.recipients(player, world).filter(r => r.type === 'lord' && r.kingdomId !== from.kingdomId)
        .map(r => ({ r, d: Hex.wrappingDistance(from.q, from.r, r.q, r.r, world.width) }))
        .sort((a, b) => b.d - a.d)[0].r;
}

/** A plain reply on its way back from a far lord to the town the player wrote from. */
function pendingReply(gold = 40, days = 5) {
    const { world, player } = game;
    const t = servedTown();
    player.q = t.q; player.r = t.r;
    const to = farLord(t);
    const R = {
        id: 900 + world.day, due: world.day + days, sentDay: world.day, kind: 'plain', tone: 'warm',
        from: { ...to }, back: { q: t.q, r: t.r, name: t.name, kingdomId: t.kingdomId },
        gold, subject: 'Re: your letter', body: 'We thank you for your courtesy.',
    };
    Mail.state(player).replies.push(R);
    return { t, to, R };
}

function day() {
    const { world, player } = game;
    world.day++;
    const r = CourierRiders.processDay(world, player);
    const m = Mail.processDay(world, player);
    return { notices: [...r.notices, ...m.notices], replies: m.replies };
}

describe('A reply rides home on the map', () => {
    it('a messenger leaves the answerer\'s town, reaches the player\'s on the reply\'s day, and the purse arrives', () => {
        const { world, player } = game;
        const { t, R } = pendingReply(40, 5);
        day();
        const u = CourierRiders.riderForReply(world, R.id);
        expect(u).toBeTruthy();
        expect(u).toBeInstanceOf(WorldUnit);
        expect(R.rider).toBe(u.id);
        const last = u.route.length / 2 - 1;
        expect([u.route[last * 2], u.route[last * 2 + 1]]).toEqual([t.q, t.r]);
        expect(u.inventory.gold).toBe(40);
        // Hailed, it says what it carries, and it cannot be robbed from the panel
        player.q = u.q; player.r = u.r;
        const v = CourierRiders.describe(world, player, u);
        expect(v.yourReply).toEqual({ from: R.from.name, gold: 40 });
        const gold0 = player.gold;
        let got = null;
        for (let i = 0; i < 8 && !got; i++) { const d = day(); if (d.replies.some(x => x.id === R.id)) got = d; }
        expect(got).toBeTruthy();
        expect(world.day).toBe(R.due);
        expect(player.gold).toBe(gold0 + 40);
        day();
        expect(u.destroyed).toBe(true);
    });

    it('robbers on its road take the purse; the letter still comes, saying so', () => {
        const { world, player } = game;
        Couriers.data().riders.robShare = 1;
        const { R } = pendingReply(60, 6);
        day();
        const u = CourierRiders.riderForReply(world, R.id);
        const at = Math.min(u.step + 2, u.route.length / 2 - 2);
        const band = Object.assign(Object.create(WorldUnit.prototype), { type: 'raider', id: 'test_band', name: 'The Test Band', q: u.route[at * 2], r: u.route[at * 2 + 1], strength: 1e6, population: 10, inventory: {}, destroyed: false, age: 0, maxAge: 1e9 });
        world.units.push(band);
        vi.spyOn(CourierRiders, '_dayRng').mockReturnValue(() => 0);
        let waylaid = null;
        for (let i = 0; i < 8 && !waylaid; i++) { const d = day(); waylaid = d.notices.find(n => n.title === 'A Messenger Waylaid'); }
        expect(waylaid).toBeTruthy();
        expect(waylaid.text).toContain('The Test Band');
        expect(band.inventory.gold).toBe(60);
        expect(R.gold).toBe(0);
        expect(u.destroyed).toBe(true);
        // No second messenger is sent: the letter arrives on its day, without the purse
        day();
        expect(CourierRiders.riderForReply(world, R.id)).toBeNull();
        const gold0 = player.gold;
        let got = null;
        for (let i = 0; i < 8 && !got; i++) { const d = day(); got = d.notices.find(n => n.title.includes('A Reply from')); }
        expect(got).toBeTruthy();
        expect(got.text).toMatch(/robbed by The Test Band/);
        expect(got.text).not.toMatch(/undefined|NaN/);
        expect(player.gold).toBe(gold0);
    });
});

describe('Letters on the road with no rider get one', () => {
    it('a letter sent without a rider (an older save) is given one partway along, and arrives on its day', () => {
        const { world, player } = game;
        const t = servedTown();
        player.q = t.q; player.r = t.r;
        const to = farLord(t);
        const c = Mail.courierOptions(player, world, to).find(o => o.id !== 'own');
        const L = Mail.send(player, world, { to: to.key, kind: 'courtesy', courier: c.id }).letter;
        expect(L.days).toBeGreaterThan(2);
        // Two days ride abstractly (the save had no riders)
        for (let i = 0; i < 2; i++) { world.day++; Mail.processDay(world, player); }
        expect(L.rider).toBeUndefined();
        day();
        const u = CourierRiders.riderFor(world, L.id);
        expect(u).toBeTruthy();
        expect(u.step).toBeGreaterThan(0);
        expect(u.step).toBeLessThan(u.route.length / 2 - 1);
        let delivered = false;
        while (world.day < L.arriveDay) { world.day++; CourierRiders.processDay(world, player); delivered = Mail.processDay(world, player).delivered.some(x => x.id === L.id) || delivered; }
        expect(delivered).toBe(true);
    });

    it('a letter whose rider was lost from the map is given a new one', () => {
        const { world, player } = game;
        const t = servedTown();
        player.q = t.q; player.r = t.r;
        const to = farLord(t);
        const c = Mail.courierOptions(player, world, to).find(o => o.id !== 'own');
        const L = Mail.send(player, world, { to: to.key, kind: 'courtesy', courier: c.id }).letter;
        const u0 = CourierRiders.dispatchLetter(world, player, L);
        world.units = world.units.filter(x => x !== u0);
        day();
        const u = CourierRiders.riderFor(world, L.id);
        expect(u).toBeTruthy();
        expect(u.id).not.toBe(u0.id);
        expect(L.rider).toBe(u.id);
    });
});

describe('A house\'s rider waylaid on the map costs the house', () => {
    it('robbers: the bag\'s coin is booked against the house at the week\'s reckoning', () => {
        const { world, player } = game;
        Couriers.data().riders.robShare = 1;
        const c = Couriers.alive(world).find(x => x.owner !== 'player' && x.stations.length >= 2);
        const st = CourierRiders.state(world);
        const u = Utils.withRng(Utils.seededRandom(3), () => CourierRiders._spawnHouse(world, st, c, c.stations[0], c.stations[1]));
        u.inventory = { gold: 25 };
        u.bag.gold = 25;
        const at = Math.min(2, u.route.length / 2 - 2);
        const band = Object.assign(Object.create(WorldUnit.prototype), { type: 'raider', id: 'test_band', name: 'The Test Band', q: u.route[at * 2], r: u.route[at * 2 + 1], strength: 1e6, population: 10, inventory: {}, destroyed: false, age: 0, maxAge: 1e9 });
        world.units.push(band);
        vi.spyOn(CourierRiders, '_dayRng').mockReturnValue(() => 0);
        for (let i = 0; i < 8 && !u.destroyed; i++) { world.day++; CourierRiders.processDay(world, player); }
        expect(u.destroyed).toBe(true);
        expect(band.inventory.gold).toBe(25);
        expect(c.pendingLoss).toEqual({ gold: 25, robbed: 1, horses: 0 });
        // The week books it: the coin off the house's cash, the robbery in its history
        const spy = vi.spyOn(Couriers, '_npcTurn').mockImplementation(() => {});
        const cash0 = c.cash;
        Utils.withRng(Utils.seededRandom(5), () => {
            vi.spyOn(Couriers, '_robberies').mockImplementation(() => {});
            Couriers._week(world, player, { notices: [] });
        });
        expect(spy).toHaveBeenCalled();
        expect(c.pendingLoss).toBeNull();
        expect(c.week.robbed).toBe(1);
        expect(c.history[0].robbed).toBe(1);
        expect(c.cash).toBe(cash0 + c.week.profit - 25);
    });

    it('soldiers who seize a rider take its horse too; the player robbing one costs the house the bag', () => {
        const { world, player } = game;
        const c = Couriers.alive(world).find(x => x.owner !== 'player' && x.stations.length >= 2);
        Couriers.riderLost(world, c.id, 10, true);
        expect(c.pendingLoss).toEqual({ gold: 10, robbed: 1, horses: 1 });
        c.pendingLoss = null;
        const st = CourierRiders.state(world);
        const u = Utils.withRng(Utils.seededRandom(9), () => CourierRiders._spawnHouse(world, st, c, c.stations[0], c.stations[1]));
        u.inventory = { gold: 18 };
        player.q = u.q; player.r = u.r;
        PlayerMilitary.attackUnit(player, u, world, { combatResult: { victory: true, playerLosses: 0, enemyLosses: u.strength } });
        expect(u.destroyed).toBe(true);
        expect(c.pendingLoss).toEqual({ gold: 18, robbed: 1, horses: 0 });
    });
});

describe('A famous visitor may turn a plea down', () => {
    it('the plea leaves the journal; the asker is let down less than by a lapsed one; other tasks cannot be declined', () => {
        const { world, player } = game;
        const views = world.getSettlementViews();
        const s = views.find(v => v.kingdom != null);
        const tile = world.getTile(s.q, s.r);
        player.q = s.q; player.r = s.r;
        player.renown = 400;
        player.reputation = { ...(player.reputation || {}), [tile.settlement.kingdom]: 90 };
        player.karma = 20;
        if (player.fame) player.fame.lastRequest = null;
        let got = null;
        for (let d = 0; d < 400 && !got; d++) { world.day = 200 + d; got = Fame.townRequest(player, world, tile); }
        expect(got).toBeTruthy();
        const q = player.quests.active.find(x => x.id === got.questId);
        // An ordinary task cannot be declined this way
        const other = { id: 'not_a_plea', giver: { id: 'x', name: 'X' } };
        player.quests.active.push(other);
        expect(Quests.declinePlea(player, world, other.id).success).toBe(false);
        player.quests.active = player.quests.active.filter(x => x !== other);
        const res = Quests.declinePlea(player, world, q.id);
        expect(res.success).toBe(true);
        expect(res.message).toContain(q.giver.name);
        expect(player.quests.active).not.toContain(q);
        expect(q.status).toBe('declined');
        expect(Fame.openRequests(player)).toHaveLength(0);
        const g = player.quests.grievances[q.giver.id];
        expect(g.delta).toBe(Math.round(NpcTasks.config().failDisposition / 8));
        expect(Math.abs(g.delta)).toBeLessThan(Math.abs(Math.round(NpcTasks.config().failDisposition / 4)));
        expect(Quests.declinePlea(player, world, q.id).success).toBe(false);
    });
});

describe('A Royal Post edict outlives the crown only as the next crown\'s grant', () => {
    it('after abdication the charter stands, no longer an edict; a later king adopts it again', () => {
        const { world, player } = game;
        world.day = 400;
        const k = world.kingdoms.filter(x => x.isAlive !== false)
            .find(x => Couriers.alive(world).some(c => Couriers.stationsIn(c, x.id) >= 1));
        Throne._takeThrone(player, world, k);
        k.treasury = 5000;
        Kingship.processDay(world, player);
        const cands = Kingship.royalPostCandidates(player, world);
        expect(Kingship.grantRoyalPost(player, world, cands[0].id).success).toBe(true);
        expect(Couriers.charter(world, k.id).edict).toBe(true);
        // While the player rules, the day leaves the edict alone
        Couriers.processDay(world, player);
        expect(Couriers.charter(world, k.id).edict).toBe(true);
        expect(Throne.abdicate(player, world).success).toBe(true);
        Couriers.processDay(world, player);
        const ch = Couriers.charter(world, k.id);
        expect(ch.courierId).toBe(cands[0].id);
        expect(ch.edict).toBe(false);
        expect(ch.by).toBe('crown');
        expect(Kingship.crownPolicies(player, world, k.id).find(p => p.id === 'royal_post').text).toContain('by the crown\'s grant');
        // The NPC crown's charter roll now reviews it like any grant
        expect(Couriers.state(world).news.some(n => String(n.text || n).includes('new crown lets'))).toBe(true);
        // Crowned again: the standing grant is adopted as the edict
        Throne._takeThrone(player, world, k);
        Kingship.processDay(world, player);
        expect(Kingship.court(player).edicts.royal_post.adopted).toBe(true);
        expect(Couriers.charter(world, k.id).edict).toBe(true);
    });
});
