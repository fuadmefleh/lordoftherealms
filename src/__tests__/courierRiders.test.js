// The post on the map (systems/courierRiders.js), companions away as mail
// recipients (systems/mail.js + systems/companions.js) and the Royal Post as
// an edict of the Royal Court (systems/kingship.js + systems/couriers.js):
// a letter's rider spawns, rides and arrives on the letter's day, is saved
// and loaded, is robbed or read where it is, can be robbed by the player; a
// companion away answers a letter with their approval and comes back when
// recalled; a player-king grants and revokes the Royal Post as an edict and
// its fee lands in the crown's books; every stream is the riders' own.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Couriers } from '../systems/couriers.js';
import { Mail } from '../systems/mail.js';
import { CourierRiders, RIDER_TYPE } from '../systems/courierRiders.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Companions } from '../systems/companions.js';
import { Relationships } from '../systems/relationships.js';
import { Underworld } from '../systems/underworld.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { loadData, newGame } from './playtest/harness.js';

let game;
let saved;
beforeAll(async () => {
    await loadData();
    game = newGame(4242);
    saved = JSON.parse(JSON.stringify({ cfg: Couriers.config(), riders: Couriers.data().riders }));
}, 60000);

function reset() {
    const { world, player } = game;
    world.post = null;
    world.units = (world.units || []).filter(u => u.type !== RIDER_TYPE);
    player.mail = null;
    player.letters = null;
    player.gold = 5000;
    player.financeToday = { income: {}, expenses: {} };
    world.day = 50;
    Couriers.state(world);
    Couriers._seedHouses(world);
}

/** No surprises on the road unless a test asks for them. */
function quiet() {
    Object.assign(Couriers.config().mail, { delay: 0, winterDelay: 0, lossShare: 0, intercept: 0, interceptPerEnemy: 0, interceptRival: 0 });
    Object.assign(Couriers.data().riders, { robShare: 0, lairChance: 0, warIntercept: 0, warSeize: 0 });
}

beforeEach(() => { reset(); quiet(); });
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

/** A lord far enough off for a ride of several days. */
function farLord(from) {
    const { world, player } = game;
    return Mail.recipients(player, world).filter(r => r.type === 'lord' && r.kingdomId !== from.kingdomId)
        .map(r => ({ r, d: Hex.wrappingDistance(from.q, from.r, r.q, r.r, world.width) }))
        .sort((a, b) => b.d - a.d)[0].r;
}

/** Send a courtesy letter from a served town, its rider dispatched as the Letters panel does. */
function sendWithRider(extra = {}) {
    const { world, player } = game;
    const t = servedTown();
    player.q = t.q;
    player.r = t.r;
    const to = extra.to || farLord(t);
    const opts = Mail.courierOptions(player, world, to);
    const courier = opts.find(o => o.id !== 'own') || opts[0];
    const res = Mail.send(player, world, { to: to.key, kind: extra.kind || 'courtesy', courier: courier.id, ...(extra.opts || {}) });
    expect(res.success).toBe(true);
    const u = CourierRiders.dispatchLetter(world, player, res.letter);
    return { t, to, L: res.letter, u };
}

/** One day: the riders ride (before Mail, as endDay.js runs them), then the letters. */
function day() {
    const { world, player } = game;
    world.day++;
    const r = CourierRiders.processDay(world, player);
    const m = Mail.processDay(world, player);
    return { notices: [...r.notices, ...m.notices], delivered: m.delivered };
}

describe('A letter rides as a rider on the map', () => {
    it('spawns at the town it was written in and reaches the recipient on the letter\'s arrival day', () => {
        const { world, player } = game;
        const { t, to, L, u } = sendWithRider();
        expect(u).toBeTruthy();
        expect(u.type).toBe(RIDER_TYPE);
        expect(u).toBeInstanceOf(WorldUnit);
        expect(world.units).toContain(u);
        expect(L.rider).toBe(u.id);
        expect([u.q, u.r]).toEqual([t.q, t.r]);
        const last = u.route.length / 2 - 1;
        expect([u.route[last * 2], u.route[last * 2 + 1]]).toEqual([to.q, to.r]);
        expect(L.days).toBeGreaterThan(1);
        const steps = [];
        while (world.day < L.arriveDay - 1) { day(); steps.push(u.step); }
        // It moves along the way, never past it, and is short of the gates the day before
        expect(steps[steps.length - 1]).toBeGreaterThan(0);
        expect(steps.every((s, i) => i === 0 || s >= steps[i - 1])).toBe(true);
        expect(u.step).toBeLessThan(last);
        // Its day: at the gates, and the letter is delivered
        world.day++;
        CourierRiders.processDay(world, player);
        expect(u.step).toBe(last);
        expect([u.q, u.r]).toEqual([to.q, to.r]);
        const m = Mail.processDay(world, player);
        expect(m.delivered.map(x => x.id)).toContain(L.id);
        // ...and the next day the rider is done
        day();
        expect(u.destroyed).toBe(true);
        expect(CourierRiders.riders(world).some(x => x.letterId === L.id)).toBe(false);
    });

    it('the headless path (no rider) keeps the abstract letter: Mail resolves it on the same day', () => {
        const { world, player } = game;
        const t = servedTown();
        player.q = t.q; player.r = t.r;
        const to = farLord(t);
        const c = Mail.courierOptions(player, world, to).find(o => o.id !== 'own');
        const L = Mail.send(player, world, { to: to.key, kind: 'courtesy', courier: c.id }).letter;
        expect(L.rider).toBeUndefined();
        while (world.day < L.arriveDay) { world.day++; Mail.processDay(world, player); }
        expect(Mail.state(player).sent[0].id).toBe(L.id);
        expect(CourierRiders.riders(world)).toHaveLength(0);
    });

    it('is saved with the world units and the post, and rides on after a load', () => {
        const { world, player } = game;
        const { L, u } = sendWithRider();
        day();
        day();
        const ws = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        const units = SaveLoad.restoreUnits(ws.units);
        const back = units.find(x => x.id === u.id);
        expect(back).toBeInstanceOf(WorldUnit);
        expect(back.letterId).toBe(L.id);
        expect(back.step).toBe(u.step);
        expect(back.route).toEqual(u.route);
        expect(ws.post.riders.seq).toBe(CourierRiders.state(world).seq);
        // The loaded rider keeps riding
        const before = back.step;
        world.units = world.units.map(x => (x.id === u.id ? back : x));
        world.day++;
        CourierRiders.processDay(world, player);
        expect(back.step).toBeGreaterThanOrEqual(before);
    });

    it('a letter held up on the road waits a hex short of the gates', () => {
        const { world, player } = game;
        const { L, u } = sendWithRider();
        const last = u.route.length / 2 - 1;
        L.delayed = true;
        L.arriveDay += 2;
        while (world.day < u.dueDay + 1) { world.day++; CourierRiders.processDay(world, player); }
        expect(u.step).toBe(last - 1);
        expect(u.destroyed).toBe(false);
    });
});

describe('The road happens to the rider where it is', () => {
    it('a raider band beside the road robs it there: the enclosure goes to the band', () => {
        const { world, player } = game;
        Couriers.data().riders.robShare = 1;
        const { L, u } = sendWithRider({ kind: 'gift', opts: { gold: 100 } });
        expect(u.inventory.gold).toBe(100);
        // A band two hexes up the road
        const at = Math.min(3, u.route.length / 2 - 2);
        const q = u.route[at * 2], r = u.route[at * 2 + 1];
        const band = Object.assign(Object.create(WorldUnit.prototype), { type: 'raider', id: 'test_band', name: 'The Test Band', q, r, strength: 1e6, population: 10, inventory: {}, destroyed: false, age: 0, maxAge: 1e9 });
        world.units.push(band);
        vi.spyOn(CourierRiders, '_dayRng').mockReturnValue(() => 0); // robbed, and the letter lost with it
        let out = null;
        for (let i = 0; i < 6 && !out; i++) { const d = day(); if (L.road && L.road.robbed) out = d; }
        expect(L.road.robbed.by).toBe('The Test Band');
        expect(Hex.wrappingDistance(L.road.robbed.q, L.road.robbed.r, q, r, world.width)).toBeLessThanOrEqual(1);
        expect(band.inventory.gold).toBe(100);
        expect(L.stolen.gold).toBe(100);
        expect(Mail.state(player).stats.robbed).toBe(1);
        expect(L.status).toBe('robbed');
        expect(u.destroyed).toBe(true);
        expect(out.notices.some(n => n.title === 'A Rider Robbed' && n.text.includes('The Test Band'))).toBe(true);
        world.units = world.units.filter(x => x !== band);
    });

    it('riding through the land of a realm at war with the recipient, its agents read the letter there', () => {
        const { world, player } = game;
        Couriers.data().riders.warIntercept = 1;
        const { L, u } = sendWithRider();
        // A realm the road crosses that is not the recipient's: at war with it
        let enemy = null;
        for (let i = 1; i < u.route.length / 2 - 1 && !enemy; i++) {
            const t = world.getTile(u.route[i * 2], u.route[i * 2 + 1]);
            if (t && t.kingdom != null && t.kingdom !== L.to.kingdomId && world.getKingdom(t.kingdom)) enemy = world.getKingdom(t.kingdom);
        }
        if (!enemy) return; // a road that never leaves the recipient's land (not on this seed)
        const k = world.getKingdom(L.to.kingdomId);
        const wars = k.wars;
        k.wars = [...(k.wars || []), enemy.id];
        while (world.day < L.arriveDay - 1) day();
        expect(L.road.intercepted.kingdomId).toBe(enemy.id);
        expect(world.getTile(L.road.intercepted.q, L.road.intercepted.r).kingdom).toBe(enemy.id);
        expect(u.met).toContain(`realm:${enemy.id}`);
        expect(CourierRiders.state(world).stats.intercepted).toBe(1);
        day();
        expect(Mail.state(player).stats.intercepted).toBe(1);
        expect(L.intercepted.kingdomId).toBe(enemy.id);
        k.wars = wars;
    });

    it('Mail does not roll the road\'s robbery for a letter that has a rider', () => {
        const { world, player } = game;
        Couriers.config().danger.robChance = 1;
        const { L } = sendWithRider({ kind: 'gift', opts: { gold: 50 } });
        L.danger = 1;
        while (world.day < L.arriveDay) day();
        expect(Mail.state(player).stats.robbed).toBe(0);
        expect(Mail.state(player).sent[0].status).toBe('delivered');
    });
});

describe('House traffic and the player on the road', () => {
    it('houses send a capped sample of riders near the player, and the player\'s own house its riders anywhere', () => {
        const { world, player } = game;
        Object.assign(Couriers.data().riders, { npcChance: 1, ownHouseChance: 1 });
        const t = servedTown();
        player.q = t.q; player.r = t.r;
        const seen = new Set();
        for (let i = 0; i < 12; i++) {
            day();
            const npc = CourierRiders.riders(world).filter(u => u.letterId == null && !u.own);
            expect(npc.length).toBeLessThanOrEqual(CourierRiders.config().npcMax);
            const per = {};
            for (const u of npc) per[u.courierId] = (per[u.courierId] || 0) + 1;
            for (const n of Object.values(per)) expect(n).toBeLessThanOrEqual(CourierRiders.config().npcPerHouse);
            for (const u of npc) {
                seen.add(u.id);
                // Every one rides between two stations of its house, one end near the player
                const c = Couriers.get(world, u.courierId);
                expect(c.stations.some(s => s.q === u.sourceQ && s.r === u.sourceR)).toBe(true);
                expect(c.stations.some(s => s.q === u.targetQ && s.r === u.targetR)).toBe(true);
            }
        }
        expect(seen.size).toBeGreaterThan(0);
        expect(CourierRiders.state(world).stats.arrived).toBeGreaterThan(0);
    });

    it('the player\'s own house sends its riders wherever they are, and you can hail them but not rob them', async () => {
        const { world, player } = game;
        Object.assign(Couriers.data().riders, { npcChance: 0, ownHouseChance: 1 });
        const t = servedTown();
        player.q = t.q; player.r = t.r;
        expect(Couriers.found(player, world).success).toBe(true);
        const mine = Couriers.playerHouse(world);
        const other = [...Couriers.towns(world).values()].find(x => x.key !== t.key && x.type !== 'village');
        Couriers._addStation(mine, other);
        player.q = 0; player.r = 0; // far away: own riders ride anyway
        let own = [];
        for (let i = 0; i < 4 && !own.length; i++) { day(); own = CourierRiders.ownRiders(world); }
        expect(own.length).toBeGreaterThan(0);
        expect(own.length).toBeLessThanOrEqual(CourierRiders.config().ownHouseMax);
        expect(own.every(u => u.courierId === mine.id)).toBe(true);
        // The rider's panel: your house's rider, no robbing it
        const u = own[0];
        player.q = u.q; player.r = u.r;
        const { ActionMenu } = await import('../ui/actionMenu.js');
        let html = '';
        const g = { player, world, ui: { showCustomPanel: (t2, h) => { html = h; }, showNotification: () => {}, hideCustomPanel: () => {} } };
        ActionMenu.showRider(g, u.id);
        expect(html).toContain('your house');
        expect(html).not.toContain('Rob the mailbag');
        expect(html).not.toMatch(/undefined|NaN/);
    });

    it('robbing a house\'s rider: its coin is loot, a sealed letter comes to the inbox, heat and the realm\'s displeasure', () => {
        const { world, player } = game;
        const c = Couriers.alive(world).find(x => x.stations.length >= 2 && world.getKingdom(x.stations[0].kingdomId).lord);
        Couriers.data().riders.sealedChance = 1;
        const st = CourierRiders.state(world);
        const u = Utils.withRng(Utils.seededRandom(7), () => CourierRiders._spawnHouse(world, st, c, c.stations[0], c.stations[1]));
        expect(u.bag.sealed).toBeTruthy();
        player.q = u.q; player.r = u.r;
        expect(CourierRiders.meetable(player, world)).toContain(u);
        const kid = u.kingdomId;
        const rep0 = (player.reputation && player.reputation[kid]) || 0;
        const houseRep = c.reputation;
        const gold0 = player.gold;
        const coin = u.inventory.gold || 0;
        // The fight as the attack panel fights it (a won combat handed in)
        const res = PlayerMilitary.attackUnit(player, u, world, { combatResult: { victory: true, playerLosses: 0, enemyLosses: u.strength } });
        expect(res.victory).toBe(true);
        expect(u.destroyed).toBe(true);
        expect(player.gold).toBe(gold0 + coin);
        expect(player.reputation[kid]).toBeLessThanOrEqual(rep0 - CourierRiders.config().robbery.reputation);
        expect(Underworld.ensure(player).heat[kid]).toBeGreaterThan(0);
        expect(c.reputation).toBeLessThan(houseRep);
        const bag = CourtLetters.state(player).inbox.find(l => l.kind === 'stolen_mailbag');
        expect(bag).toBeTruthy();
        expect(bag.subject).not.toMatch(/\{|undefined/);
        // Burn it: no one ever knows
        expect(CourtLetters.answer(player, world, bag.id, 'burn').success).toBe(true);
    });
});

describe('Companions away receive letters', () => {
    function awayCompanion(approval = 70) {
        const { world, player } = game;
        const towns = [...Couriers.towns(world).values()];
        const home = towns.find(x => Hex.wrappingDistance(x.q, x.r, player.q, player.r, world.width) > 6) || towns[0];
        const npc = Relationships.generateNPC({ name: home.name, q: home.q, r: home.r, kingdom: home.kingdomId }, world);
        Relationships.getRelationship(player, npc.id).score = 30;
        Relationships.ensureTravelParty(player);
        player.travelParty.push(npc.id);
        npc.isTravelingWithPlayer = true;
        Companions.ensure(npc, world);
        expect(Companions.dismiss(player, npc.id, world).success).toBe(true);
        npc.companion.approval = approval;
        return npc;
    }

    it('are listed as recipients where they are, once (not twice as an acquaintance)', () => {
        const { world, player } = game;
        const npc = awayCompanion();
        const recs = Mail.recipients(player, world);
        const mine = recs.filter(r => r.npcId === npc.id);
        expect(mine).toHaveLength(1);
        expect(mine[0].type).toBe('companion');
        expect(mine[0].status).toBe('dismissed');
        expect([mine[0].q, mine[0].r]).toEqual([npc.settlementQ, npc.settlementR]);
        expect(Mail.regard(player, world, mine[0])).toBe(20);
        const kinds = Mail.kindOptions(player, world, mine[0]).map(k => k.id).sort();
        expect(kinds).toEqual(['courtesy', 'favour', 'gift', 'warning']);
    });

    it('a courtesy letter and a warning raise their approval; replies come back as usual', () => {
        const { world, player } = game;
        const npc = awayCompanion(60);
        const t = servedTown();
        player.q = t.q; player.r = t.r;
        const key = `companion:${npc.id}`;
        const to = Mail.recipient(player, world, key);
        const send = (kind) => Mail.send(player, world, { to: key, kind, courier: 'own' });
        expect(send('courtesy').success).toBe(true);
        expect(send('warning').success).toBe(true);
        const due = Math.max(...Mail.state(player).outbox.map(L => L.arriveDay));
        vi.spyOn(Utils, 'random').mockReturnValue(0.5); // no delay, no loss, no robbery, a reply
        while (world.day < due) { world.day++; Mail.processDay(world, player); }
        // (two letters the same day: each counts the other, so each helps half as much)
        expect(npc.companion.approval).toBeCloseTo(60 + 3 * 0.5 + 4 * 0.5, 5);
        expect(npc.companion.log.some(l => l.reason === 'a warning by letter')).toBe(true);
        expect(Mail.state(player).replies.length).toBeGreaterThan(0);
        while (Mail.state(player).replies.length && world.day < due + 30) { world.day++; Mail.processDay(world, player); }
        expect(CourtLetters.state(player).archive.some(a => a.kind === 'mail_reply' && a.from.name === to.name)).toBe(true);
    });

    it('a favour recalls them: those who approve answer, and sealing it brings them back to the party', () => {
        const { world, player } = game;
        const npc = awayCompanion(70);
        const key = `companion:${npc.id}`;
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        expect(Mail.send(player, world, { to: key, kind: 'favour', courier: 'own' }).success).toBe(true);
        const L = Mail.state(player).outbox[0];
        while (world.day < L.arriveDay + L.days + 1) { world.day++; Mail.processDay(world, player); }
        vi.restoreAllMocks();
        const letter = CourtLetters.state(player).inbox.find(l => l.kind === 'mail_proposal' && l.data.seal === 'rejoin');
        expect(letter).toBeTruthy();
        expect(Relationships.isInTravelParty(player, npc.id)).toBe(false);
        expect(CourtLetters.answer(player, world, letter.id, 'seal').success).toBe(true);
        expect(Relationships.isInTravelParty(player, npc.id)).toBe(true);
        expect(npc.companion.leftHow).toBeNull();
        expect(Mail.recipients(player, world).some(r => r.npcId === npc.id && r.type === 'companion')).toBe(false);
    });

    it('one who thinks little of you will not come, and thinks a little less of you', () => {
        const { world, player } = game;
        const npc = awayCompanion(30);
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        Mail.send(player, world, { to: `companion:${npc.id}`, kind: 'favour', courier: 'own' });
        const L = Mail.state(player).outbox[0];
        while (world.day < L.arriveDay) { world.day++; Mail.processDay(world, player); }
        expect(npc.companion.approval).toBe(28);
        expect(Mail.state(player).replies.every(r => r.kind !== 'mail_proposal')).toBe(true);
    });
});

describe('The Royal Post as an edict of the Royal Court', () => {
    let king;
    beforeAll(() => {
        king = newGame(4243);
        const { world } = king;
        world.day = 60;
        Couriers.state(world);
        Couriers._seedHouses(world);
    }, 60000);

    function crown() {
        const { world, player } = king;
        const k = world.kingdoms.filter(x => x.isAlive !== false)
            .find(x => Couriers.alive(world).some(c => Couriers.stationsIn(c, x.id) >= 1));
        Throne._takeThrone(player, world, k);
        k.treasury = 5000;
        Kingship.processDay(world, player);
        return k;
    }

    it('a predecessor\'s grant stands as the edict; the king transfers and revokes it; the fee lands on the demesne line', () => {
        const { world, player } = king;
        // The old crown granted its best house the charter before the player took the throne
        const k0 = world.kingdoms.filter(x => x.isAlive !== false)
            .find(x => Couriers.alive(world).some(c => Couriers.stationsIn(c, x.id) >= 1));
        const first = Couriers.alive(world).find(c => Couriers.stationsIn(c, k0.id) >= 1);
        Couriers.grant(world, k0.id, first.id, 'crown');
        const k = crown();
        expect(k.id).toBe(k0.id);
        const court = Kingship.court(player);
        expect(court.edicts.royal_post).toBeTruthy();
        expect(court.edicts.royal_post.courierId).toBe(first.id);
        expect(Couriers.charter(world, k.id).edict).toBe(true);
        expect(KingdomEffect(k)).toBe(1);
        // Revoke: no charter, any house may carry the mail
        expect(Kingship.revokeRoyalPost(player, world).success).toBe(true);
        expect(court.edicts.royal_post).toBeUndefined();
        expect(Couriers.charter(world, k.id)).toBeNull();
        expect(KingdomEffect(k)).toBe(0);
        // Grant: the edict is proclaimed (its cost from the treasury)
        const t0 = k.treasury;
        const cands = Kingship.royalPostCandidates(player, world);
        expect(cands.length).toBeGreaterThan(0);
        expect(Kingship.canPass(player, world, 'royal_post').ok).toBe(false); // it names its house
        const res = Kingship.grantRoyalPost(player, world, cands[0].id);
        expect(res.success).toBe(true);
        expect(k.treasury).toBe(t0 - Kingship.edicts().royal_post.passCost);
        expect(Couriers.charter(world, k.id).courierId).toBe(cands[0].id);
        expect(Couriers.charter(world, k.id).by).toBe('edict');
        // Another house with a station there: transfer, no new edict
        const other = cands.find(c => c.id !== cands[0].id);
        if (other) {
            const n = Object.keys(court.edicts).length;
            expect(Kingship.grantRoyalPost(player, world, other.id).success).toBe(true);
            expect(Couriers.charter(world, k.id).courierId).toBe(other.id);
            expect(Object.keys(court.edicts)).toHaveLength(n);
        }
        // The week's fee: into the treasury and onto the crown's books (demesne), not a free-floating add
        const fisc = CrownBooks.state(k);
        const dem0 = fisc.day.demesne || 0;
        const tr0 = k.treasury;
        Couriers._week(world, player, { notices: [] });
        const ch = Couriers.charter(world, k.id);
        expect(ch.fee).toBeGreaterThan(0);
        expect(k.treasury - tr0).toBeGreaterThanOrEqual(ch.fee);
        expect((fisc.day.demesne || 0) - dem0).toBe(ch.fee);
        expect(ch.paid).toBe(ch.fee);
        // The crown's policy, as the realm panel shows it
        expect(Kingship.crownPolicies(player, world, k.id).some(p => p.id === 'royal_post' && p.text.includes('by your edict'))).toBe(true);
    });

    it('the Royal Court\'s Edicts tab names the Royal Post\'s house, without leaking undefined/NaN', async () => {
        const { world, player } = king;
        const { ActionMenu } = await import('../ui/actionMenu.js');
        let html = '';
        const g = { player, world, ui: { showCustomPanel: (t, h) => { html = h; }, showNotification: () => {}, hideCustomPanel: () => {} } };
        ActionMenu.showRoyalCourt(g, null, 'edicts');
        expect(html).toContain('The Royal Post');
        expect(html).toMatch(/window\._court\.(royalPost|revoke)\(/);
        expect(html).not.toMatch(/undefined|NaN/);
    });

    it('an edict whose house fails lapses, and the charter with it', () => {
        const { world, player } = king;
        const k = Throne.ruledKingdom(player, world);
        const court = Kingship.court(player);
        if (!court.edicts.royal_post) Kingship.grantRoyalPost(player, world, Kingship.royalPostCandidates(player, world)[0].id);
        const c = Couriers.get(world, court.edicts.royal_post.courierId);
        Couriers._close(world, c, 'test');
        Kingship.syncRoyalPost(player, world);
        expect(court.edicts.royal_post).toBeUndefined();
        expect(Couriers.state(world).charters[k.id]).toBeUndefined();
        c.alive = true;
    });

    it('the NPC crowns\' charter roll still skips the player\'s own realm', () => {
        const { world, player } = king;
        const k = Throne.ruledKingdom(player, world);
        Couriers.config().charter.grantChance = 1;
        Couriers.config().charter.minReputation = 0;
        Couriers.config().charter.minStations = 1;
        delete Couriers.state(world).charters[k.id];
        Kingship.revokeRoyalPost(player, world);
        Couriers._charters(world, player, { notices: [] });
        expect(Couriers.state(world).charters[k.id]).toBeUndefined();
    });
});

function KingdomEffect(k) {
    return (k.crown && k.crown.effects && k.crown.effects.royalPost) || 0;
}

describe('RNG isolation', () => {
    it('the riders\' day draws only their own stream (the main RNG is untouched) and is deterministic', () => {
        const { world, player } = game;
        Object.assign(Couriers.data().riders, { npcChance: 1, ownHouseChance: 1, robShare: 0.7, lairChance: 0.35, warIntercept: 0.3, warSeize: 0.2 });
        const t = servedTown();
        player.q = t.q; player.r = t.r;
        sendWithRider();
        Utils.setSeed(9);
        const expected = Utils.random();
        Utils.setSeed(9);
        const snap = () => JSON.stringify(CourierRiders.riders(world).map(u => [u.id, u.q, u.r, u.step]));
        const trail = [];
        for (let d = 0; d < 10; d++) { world.day++; CourierRiders.processDay(world, player); trail.push(snap()); }
        expect(Utils.random()).toBe(expected);
        // Again from the same start: the same rides
        reset(); quiet();
        Object.assign(Couriers.data().riders, { npcChance: 1, ownHouseChance: 1, robShare: 0.7, lairChance: 0.35, warIntercept: 0.3, warSeize: 0.2 });
        player.q = t.q; player.r = t.r;
        sendWithRider();
        const again = [];
        for (let d = 0; d < 10; d++) { world.day++; CourierRiders.processDay(world, player); again.push(snap()); }
        expect(again).toEqual(trail);
        // Twice on one day is once
        const before = snap();
        CourierRiders.processDay(world, player);
        expect(snap()).toBe(before);
    });
});
