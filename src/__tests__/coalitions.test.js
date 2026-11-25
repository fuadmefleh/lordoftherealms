// Directed opposition: the realms weigh the player's power, swear leagues
// against an overmighty House (systems/coalitions.js), carry blood feuds down
// the generations (world/npcLords.js vendettas), and buy townsfolk in the
// player's towns (systems/rivalAgents.js). Played on real generated worlds
// (playtest/harness.js), since mock worlds hide the tile-held settlements.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Coalitions } from '../systems/coalitions.js';
import { RivalAgents } from '../systems/rivalAgents.js';
import { RealmWars } from '../systems/realmWars.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Holdings } from '../systems/holdings.js';
import { Schemes } from '../systems/schemes.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

const SEED = 4242;

/** The next day d ≥ from on which the weekly reckoning runs. */
function weekDay(from) {
    const C = Coalitions.config();
    let d = Math.max(1, from);
    while ((d + C.offset) % C.cadence !== 0) d++;
    return d;
}

/** Run the league's days (only Coalitions) from world.day to `until`. */
function runCoalitions(game, until, opts = {}) {
    const { world, player } = game;
    const notices = [];
    while (world.day < until) {
        world.day++;
        const out = Coalitions.processDay(world, player, opts);
        notices.push(...out.notices);
    }
    return notices;
}

/** A free land tile next to (q, r). */
function landBeside(world, q, r) {
    for (let rad = 1; rad <= 3; rad++) {
        for (let dq = -rad; dq <= rad; dq++) {
            for (let dr = -rad; dr <= rad; dr++) {
                const t = world.getTile(q + dq, r + dr);
                if (!t || t.settlement || !t.terrain || t.terrain.passable === false || /water|ocean|sea|lake/i.test(t.terrain.id || '')) continue;
                if (Array.isArray(t.playerProperties) && t.playerProperties.length) continue;
                return t;
            }
        }
    }
    return null;
}

/** Make the player overmighty: farms by the seats of `n` realms, a great army, chests, Prestige, renown. */
function makeStrong(game, n = 3) {
    const { world, player } = game;
    player.allegiance = null;
    const realms = world.kingdoms.filter(k => k.isAlive && k.capital).slice(0, n);
    for (const k of realms) {
        const t = landBeside(world, k.capital.q, k.capital.r);
        if (!t) continue;
        t.playerProperties = [{ type: 'farm', level: 2, storage: 0, cost: 500 }];
        player.properties.push({ q: t.q, r: t.r, type: 'farm' });
    }
    player.army = [{ id: 'u1', type: 'infantry', domain: 'land', strength: 2500, level: 1 }];
    player.gold = 120000;
    player.renown = 300;
    player.house.prestige = 400;
    return realms;
}

function seedNpcs() {
    const types = { villager: 6, merchant: 3, guard: 3, farmer: 2, priest: 1, blacksmith_npc: 1 };
    const npcs = [];
    let id = 0;
    for (const [type, n] of Object.entries(types)) for (let i = 0; i < n; i++) npcs.push({ id: id++, type, name: 'Ada', age: 30 + (i % 3) * 7 });
    return npcs;
}

/** A league sworn against a strong player (two reckonings past the mark). */
function swearLeague(game) {
    makeStrong(game);
    const d1 = weekDay(game.world.day + 1);
    runCoalitions(game, d1);
    const d2 = weekDay(d1 + 1);
    return runCoalitions(game, d2);
}

describe('Coalitions — the threat the realms see', () => {
    it('a weak wanderer never brings a league down on themselves', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        for (let i = 0; i < 35; i++) {
            player.health = 100;
            player.starvationDays = 0;
            player.inventory.bread = 40;
            endDay(game);
        }
        const st = Coalitions.state(player);
        expect(st.active).toBeNull();
        expect(st.pressure).toBe(0);
        expect(st.power.score).toBeLessThan(Coalitions.concernThreshold(player));
        // ...and on paper, a full year on: still nothing
        runCoalitions(game, world.day + 120);
        expect(Coalitions.state(player).active).toBeNull();
        expect(Coalitions.state(player).history).toHaveLength(0);
    });

    it('power is read from real state, and nearness and grudges make a realm hostile', () => {
        const game = newGame(SEED + 1);
        const { world, player } = game;
        const before = Coalitions.power(player, world).score;
        const realms = makeStrong(game, 2);
        const power = Coalitions.power(player, world);
        expect(power.score).toBeGreaterThan(before + 100);
        expect(power.parts.army).toBeGreaterThan(0);
        expect(power.parts.wealth).toBeGreaterThan(0);
        expect(power.parts.prestige).toBeGreaterThan(0);
        const all = Coalitions.assessAll(player, world, { power });
        const near = all.find(a => a.kingdomId === realms[0].id);
        const far = all.filter(a => !realms.some(k => k.id === a.kingdomId)).sort((a, b) => a.prox - b.prox)[0];
        expect(near.prox).toBeGreaterThan(far.prox);
        expect(near.fear).toBeGreaterThan(far.fear);
        // A grudge raises it further: a conquest remembered
        const h0 = near.hostility;
        NPCLords.rememberDeed(world, realms[0].lord, 'conquest', { note: 'Testholt' });
        const again = Coalitions.assess(player, world, realms[0], Coalitions.power(player, world), Coalitions._points(player, world, null), null);
        expect(again.vendetta).toBeGreaterThan(0);
        expect(again.hostility).toBeGreaterThanOrEqual(h0);
        expect(again.reasons.join(' ')).toMatch(/blood feud/);
    });
});

describe('Coalitions — a league sworn, at war, and split', () => {
    it('a strong player triggers a named league whose terms come by letter, then real wars and a trade levy', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const notices = swearLeague(game);
        const c = Coalitions.active(player);
        expect(c).toBeTruthy();
        expect(c.stage).toBe('forming');
        expect(c.name).toMatch(/League|Compact|Concord|Pact|Alliance/);
        expect(Coalitions.members(player).length).toBeGreaterThanOrEqual(2);
        expect(c.members[c.leaderId].leader).toBe(true);
        expect(notices.some(n => /Is Sworn/.test(n.title))).toBe(true);
        // The terms as a court letter
        const letter = player.letters.inbox.find(l => l.kind === 'coalition_ultimatum');
        expect(letter).toBeTruthy();
        expect(letter.data.coalitionId).toBe(c.id);
        // Lords of the league are cold and will not receive the player
        const leader = world.getKingdom(c.leaderId);
        expect(NPCLords.coalitionChill(leader.lord, player)).toBeGreaterThan(0);
        expect(Coalitions.audienceRefused(player, world, leader.id)).toMatch(/will not receive/);

        // Throw the terms back
        const res = CourtLetters.answer(player, world, letter.id, 'defy');
        expect(res.success).toBe(true);
        expect(c.stage).toBe('active');
        const members = Coalitions.members(player);
        for (const m of members) {
            expect(RealmWars.atWarWith(player, m.kingdomId)).toBe(true);
            expect(TradePolicy.playerBar(player, m.kingdomId)).toBeTruthy();
        }
        // The levy: what the player sells in a member's town pays it
        const town = world.getSettlementsOf(members[0].kingdomId)[0];
        player.inventory.bread = 10;
        const check = TradePolicy.saleCheck(player, world, town, 'bread', 1);
        expect(check.rate).toBeGreaterThanOrEqual(Coalitions.config().embargoLevy - 1e-9);
        expect(check.barred).toBeTruthy();
        // ...and their war hosts march on the player's holdings (RealmWars' own machinery)
        let marching = 0;
        for (let i = 0; i < 6; i++) {
            world.day++;
            marching += RealmWars.processDaily(player, world).marching.length;
        }
        expect(marching).toBeGreaterThan(0);
    });

    it('buying a member out ends its war and its levy; the league breaks when too few remain', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        swearLeague(game);
        Coalitions.defy(player, world);
        const c = Coalitions.active(player);
        const [m] = Coalitions.members(player).filter(x => !x.leader);
        const price = Coalitions.buyOffPrice(player, world, m.kingdomId);
        expect(price).toBeGreaterThan(0);
        const gold0 = player.gold;
        const res = Coalitions.splitMember(player, world, m.kingdomId, 'gold');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold0 - price);
        expect(Coalitions.isMember(player, m.kingdomId)).toBe(false);
        expect(RealmWars.atWarWith(player, m.kingdomId)).toBe(false);
        expect(TradePolicy.playerBar(player, m.kingdomId)).toBeNull();
        expect(c.bought).toContain(m.kingdomId);
        // Split them all: the league is broken
        for (const x of Coalitions.members(player).filter(y => !y.leader)) Coalitions.splitMember(player, world, x.kingdomId, 'gold');
        const left = Coalitions.members(player);
        if (left.length) Coalitions.splitMember(player, world, left[0].kingdomId, 'gold');
        expect(Coalitions.active(player)).toBeNull();
        const hist = Coalitions.state(player).history[0];
        expect(hist.how).toBe('broken');
        expect(Coalitions.state(player).cooldownUntil).toBeGreaterThan(world.day);
    });

    it('conceding the terms (gold) stands the league down and pays its members', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        swearLeague(game);
        const c = Coalitions.active(player);
        const leader = world.getKingdom(c.leaderId);
        const t0 = leader.treasury || 0;
        const q = Coalitions.concessionQuote(player, world);
        const res = Coalitions.concede(player, world, 'gold');
        expect(res.success).toBe(true);
        expect(Coalitions.active(player)).toBeNull();
        expect(Coalitions.state(player).history[0].how).toBe('appeased');
        expect(leader.treasury).toBeGreaterThan(t0);
        expect(player.letters.inbox.some(l => l.kind === 'coalition_ultimatum')).toBe(false);
        expect(q.gold).toBeGreaterThan(0);
    });

    it('a league against a crowned player marches on the realm and embargoes it', () => {
        const game = newGame(SEED + 2);
        const { world, player } = game;
        // The player rules the realm farthest from the realms they press on
        const realms = makeStrong(game, 3);
        const crown = world.kingdoms.filter(k => k.isAlive && !realms.includes(k)).pop();
        crown.crown = { playerRuled: true, policies: {} };
        expect(KingdomAI.playerRealm(world)).toBe(crown);
        const d1 = weekDay(world.day + 1);
        runCoalitions(game, d1);
        runCoalitions(game, weekDay(d1 + 1));
        const c = Coalitions.active(player);
        expect(c).toBeTruthy();
        expect(['crown', 'power', 'vendetta', 'conquest']).toContain(c.cb);
        Coalitions.defy(player, world);
        const warred = Coalitions.members(player).filter(m => m.realmWar === crown.id);
        expect(warred.length).toBeGreaterThan(0);
        for (const m of warred) {
            const k = world.getKingdom(m.kingdomId);
            expect(k.wars).toContain(crown.id);
            expect(TradePolicy.embargoed(k, crown)).toBe(true);
        }
    });

    it('the league carries on against the heir, weaker', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        swearLeague(game);
        Coalitions.defy(player, world);
        const c = Coalitions.active(player);
        c.resolve = 80;
        player.house.generation = (player.house.generation || 1) + 1;
        const notices = runCoalitions(game, weekDay(world.day + 1));
        const now = Coalitions.active(player);
        if (now) {
            // 80 × heirShare, then the week's wear (a new member may add a little)
            expect(now.resolve).toBeLessThan(80 * Coalitions.config().heirShare + Coalitions.config().resolve.perMember);
            expect(notices.some(n => /Endures/.test(n.title))).toBe(true);
        } else {
            // ...or it falls apart outright when its quarrel died with the old head
            expect(Coalitions.state(player).history[0].how).toBe('broken');
        }
    });

    it('does nothing without a player (world-only days and the interregnum)', () => {
        const game = newGame(SEED);
        const out = Coalitions.processDay(game.world, null);
        expect(out.notices).toEqual([]);
        expect(RivalAgents.processDay(game.world, null).notices).toEqual([]);
        game.player.interregnum = { since: 1 };
        makeStrong(game);
        runCoalitions(game, weekDay(game.world.day + 20));
        expect(Coalitions.state(game.player).active).toBeNull();
    });
});

describe('Coalitions — a league against an overmighty AI realm', () => {
    /** One AI realm made dominant: a vast army, towns taken lately, its neighbours sour on it. */
    function dominant(game) {
        const { world } = game;
        const t = world.kingdoms.filter(k => k.isAlive && k.capital)
            .sort((a, b) => world.getSettlementsOf(b.id).length - world.getSettlementsOf(a.id).length)[0];
        t.military = 200000;
        t.conquests = [1, 2, 3, 4].map(i => ({ d: world.day, from: null, i }));
        for (const k of world.kingdoms) {
            if (k === t || !k.isAlive) continue;
            k.relations = k.relations || {};
            k.relations[t.id] = -100;
            k.truces = {};
            k.wars = (k.wars || []).filter(id => id !== t.id);
            k.restUntil = 0;
        }
        t.wars = [];
        t.truces = {};
        t.declaredOnDay = null;
        return t;
    }

    // (a small test world's biggest realm holds few towns: the mark is set just under its might,
    // the rule itself the player's — Coalitions.config().formAt)
    let formAt;
    beforeAll(() => { formAt = Coalitions.config().formAt; });
    afterAll(() => { Coalitions.config().formAt = formAt; });
    function lowerMark(world, t) {
        Coalitions.config().formAt = Math.min(formAt, Math.floor(Coalitions.realmPower(world, t).score) - 1);
    }

    /** Two weekly reckonings with no one alive: the league is sworn. */
    function swear(game) {
        const { world } = game;
        const t = dominant(game);
        lowerMark(world, t);
        const d2 = weekDay(weekDay(world.day + 1) + 1);
        while (world.day < d2) { world.day++; Coalitions.processDay(world, null); }
        return t;
    }

    it('the same might that brings a league on the player brings one on a dominant AI realm, with no one alive', () => {
        const game = newGame(SEED);
        const { world } = game;
        const t = swear(game);
        expect(Coalitions.realmPower(world, t).score).toBeGreaterThanOrEqual(Coalitions.config().formAt);
        const L = Coalitions.leagueAgainst(world, t.id);
        expect(L).toBeTruthy();
        expect(L.stage).toBe('forming');
        expect(Coalitions._realmMembers(L).length).toBeGreaterThanOrEqual(Coalitions.config().minMembers);
        expect(Object.keys(L.members)).not.toContain(String(t.id));
        expect(L.terms.gold).toBeGreaterThan(0);
        // (the player's own league is not touched)
        expect(Coalitions.active(game.player)).toBeNull();
        // only one at a time in the world
        expect(Coalitions.realmsState(world).active.length).toBe(1);
    });

    it('a realm that cannot pay or bow is marched on by every member; the league ends its wars when it breaks', () => {
        const game = newGame(SEED);
        const { world } = game;
        const t = swear(game);
        const L = Coalitions.leagueAgainst(world, t.id);
        t.treasury = 0;
        if (t.characterData && t.characterData.dynasty) t.characterData.dynasty.prestige = 0;
        while (world.day < L.dueDay) { world.day++; Coalitions.processDay(world, null); }
        expect(L.stage).toBe('active');
        expect(L.answer).toBe('defied');
        // (its host outweighs theirs: it fights whatever its means)
        expect(L.weighed.ratio).toBeGreaterThan(Coalitions.config().realms.answer.fightHi);
        const marching = Coalitions._realmMembers(L).filter(m => m.war);
        expect(marching.length).toBeGreaterThan(0);
        for (const m of marching) expect(world.getKingdom(m.kingdomId).wars).toContain(t.id);
        // its resolve spent, it breaks and its wars end
        L.resolve = 0.5;
        const d = weekDay(world.day + 1);
        while (world.day < d) { world.day++; Coalitions.processDay(world, null); }
        expect(Coalitions.leagueAgainst(world, t.id)).toBeNull();
        for (const m of marching) if (!m.prior) expect(world.getKingdom(m.kingdomId).wars || []).not.toContain(t.id);
        const st = Coalitions.realmsState(world);
        expect(st.history[0].targetId).toBe(t.id);
        expect(st.cooldown[t.id]).toBeGreaterThan(world.day);
    });

    it('a rich realm pays its terms into the members\' chests and the league stands down; the coin is conserved', () => {
        const game = newGame(SEED);
        const { world } = game;
        const t = swear(game);
        const L = Coalitions.leagueAgainst(world, t.id);
        if (t.characterData && t.characterData.dynasty) t.characterData.dynasty.prestige = 0;
        t.treasury = 1e6;
        // (no match for the members in the field now: it will not fight)
        t.military = 0;
        t.population = 0;
        const takers = Coalitions._realmMembers(L).map(m => world.getKingdom(m.kingdomId));
        const sum = () => t.treasury + takers.reduce((s, k) => s + k.treasury, 0);
        const before = sum();
        const theirs = takers.reduce((s, k) => s + k.treasury, 0);
        while (world.day < L.dueDay) { world.day++; Coalitions.processRealms(world, null); }
        expect(Coalitions.leagueAgainst(world, t.id)).toBeNull();
        expect(Coalitions.realmsState(world).history[0].how).toBe('appeased');
        expect(takers.reduce((s, k) => s + k.treasury, 0) - theirs).toBe(L.terms.gold);
        expect(sum()).toBeCloseTo(before, 6);
        for (const k of takers) expect(k.wars || []).not.toContain(t.id);
    });

    it('the terms follow the target\'s means, by one rule for an AI crown and the player', () => {
        const K = Coalitions.config().concession;
        const asked = Coalitions.terms(150, 3).gold;
        expect(asked).toBe(K.goldBase + 150 * K.goldPerPower + 3 * K.goldPerMember);
        // a poor target: revenueShare of a year's revenue + chestShare of its chests
        const poor = Coalitions.terms(150, 3, { revenue: 10, chests: 1000 });
        expect(poor.gold).toBe(Math.round(10 * K.means.yearDays * K.means.revenueShare + 1000 * K.means.chestShare));
        expect(poor.gold).toBeLessThan(asked);
        expect(poor.asked).toBe(asked);
        // a rich one is asked the full price; a beggar never less than the floor
        expect(Coalitions.terms(150, 3, { revenue: 1000, chests: 1e5 }).gold).toBe(asked);
        expect(Coalitions.terms(150, 3, { revenue: 0, chests: 0 }).gold).toBe(K.means.floor);
        // The player's quote: the same rule on the purse (and income, and a ruled crown's books)
        const game = newGame(SEED);
        const { world, player } = game;
        player.gold = 2000;
        const m = Coalitions.means(world, { player });
        expect(m.chests).toBeGreaterThanOrEqual(2000);
        expect(Coalitions.concessionQuote(player, world, { power: 150, members: 3 }).gold).toBe(Coalitions.terms(150, 3, m).gold);
        // An AI league's: the target crown's revenue and chests
        const t = swear(game);
        const L = Coalitions.leagueAgainst(world, t.id);
        expect(L.terms.gold).toBe(Coalitions.terms(L.powerAtForm, Coalitions._realmMembers(L).length, Coalitions.means(world, { kingdom: t })).gold);
        expect(L.terms.gold).toBeLessThanOrEqual(L.terms.asked);
    });

    /** Sworn against a realm with no host to speak of (it will not fight), its prestige and chests as given. */
    function weakTarget(game, { prestige = 0, treasury = 0 } = {}) {
        const { world } = game;
        const t = swear(game);
        const L = Coalitions.leagueAgainst(world, t.id);
        t.military = 0;
        t.population = 0;
        t.treasury = treasury;
        t.fisc = null;
        t.characterData = t.characterData || {};
        t.characterData.dynasty = { ...(t.characterData.dynasty || {}), prestige };
        return { t, L };
    }

    it('a weak realm with prestige to spare bows; with neither prestige nor coin it yields a border town a member held before', () => {
        const game = newGame(SEED);
        const { world } = game;
        const { t, L } = weakTarget(game, { prestige: 500 });
        while (world.day < L.dueDay) { world.day++; Coalitions.processRealms(world, null); }
        expect(L.answer).toBe('bowed');
        expect(t.characterData.dynasty.prestige).toBe(500 - L.terms.prestige);
        expect(Coalitions.realmsState(world).history[0].how).toBe('appeased');
        for (const m of Object.values(L.members)) expect(world.getKingdom(m.kingdomId).wars || []).not.toContain(t.id);

        const g2 = newGame(SEED);
        const w2 = g2.world;
        const b = weakTarget(g2);
        const member = w2.getKingdom(Coalitions._realmMembers(b.L).find(m => !m.leader).kingdomId);
        const towns = KingdomAI._settlementsOf(b.t, w2).filter(s => !(s.q === b.t.capital.q && s.r === b.t.capital.r));
        expect(towns.length).toBeGreaterThan(0);
        const disputed = towns[towns.length - 1];
        for (const s of towns) s.settlement.formerKingdom = null;
        disputed.settlement.formerKingdom = member.id;
        const n0 = KingdomAI._settlementsOf(b.t, w2).length;
        while (w2.day < b.L.dueDay) { w2.day++; Coalitions.processRealms(w2, null); }
        expect(b.L.answer).toBe('yielded');
        expect(w2.getTile(disputed.q, disputed.r).kingdom).toBe(member.id);
        expect(disputed.settlement.kingdom).toBe(member.id);
        expect(KingdomAI._settlementsOf(b.t, w2).length).toBe(n0 - 1);
        expect(b.t.capital).toBeTruthy();
        // (no war between them for it, nor a war's book left behind)
        expect(member.wars || []).not.toContain(b.t.id);
        expect(Coalitions.realmsState(w2).stats.yielded).toBe(1);
    });

    it('never targets the player\'s realm (its league is the player\'s own), and survives a save', () => {
        const game = newGame(SEED);
        const { world } = game;
        const t = dominant(game);
        lowerMark(world, t);
        t.crown = { ...(t.crown || {}), playerRuled: true };
        const d2 = weekDay(weekDay(world.day + 1) + 1);
        while (world.day < d2) { world.day++; Coalitions.processRealms(world, null); }
        expect(Coalitions.leagueAgainst(world, t.id)).toBeNull();
        delete t.crown.playerRuled;
        const d3 = weekDay(weekDay(world.day + 1) + 1);
        while (world.day < d3) { world.day++; Coalitions.processRealms(world, null); }
        expect(Coalitions.leagueAgainst(world, t.id)).toBeTruthy();
        const back = roundTrip(game);
        expect(Coalitions.leagueAgainst(back.world, t.id)).toBeTruthy();
        expect(back.world.getKingdom(t.id).conquests.length).toBe(4);
    });
});

describe('Vendettas — grudges across generations', () => {
    it('a dying lord swears his blood feud to his heir nearly whole; lesser memories halve', () => {
        const game = newGame(SEED);
        const { world } = game;
        const k = world.kingdoms.find(x => x.isAlive && x.lord);
        const old = k.lord;
        old.memory = [];
        NPCLords.rememberDeed(world, old, 'conquest', { note: 'Ashford' });
        NPCLords.rememberDeed(world, old, 'gift');
        const heir = { name: 'Young Lord', kingdomId: k.id, traits: [] };
        NPCLords.inheritMemory(old, heir, world.day);
        const conquest = heir.memory.find(e => e.k === 'conquest');
        const gift = heir.memory.find(e => e.k === 'gift');
        expect(conquest.vd).toBe(1);
        expect(Math.abs(conquest.w)).toBeCloseTo(30 * NPCLords.memoryConfig().vendettaShare, 0);
        expect(gift ? gift.vd : undefined).toBeUndefined();
        const v = NPCLords.vendettaOf(heir, world.day);
        expect(v.weight).toBeGreaterThan(20);
        expect(v.generations).toBe(1);
        // A second generation keeps counting
        const grandson = { name: 'Grandson', kingdomId: k.id, traits: [] };
        NPCLords.inheritMemory(heir, grandson, world.day);
        expect(NPCLords.vendettaOf(grandson, world.day).generations).toBe(2);
    });

    it('a realm owing blood is sworn as a rival House with a hot feud', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const k = world.kingdoms.find(x => x.isAlive && x.lord && !player.house.rivals[x.id]);
        k.lord.memory = [];
        NPCLords.rememberDeed(world, k.lord, 'kin_slain', { note: 'the old king' });
        runCoalitions(game, weekDay(world.day + 1));
        const rival = player.house.rivals[k.id];
        expect(rival).toBeTruthy();
        expect(rival.vendetta).toBe(true);
        expect(rival.feud).toBeGreaterThanOrEqual(30);
        expect(player.house.history.some(h => (h.tags || []).includes('vendetta'))).toBe(true);
    });
});

describe('Rival agents — rival Houses act through townsfolk', () => {
    function setupTown(game) {
        const { world, player } = game;
        const s = world.getSettlementViews().find(x => x.kingdom && x.kingdom !== player.allegiance);
        const tile = world.getTile(s.q, s.r);
        Townsfolk.attach(tile.settlement, world, seedNpcs(), { q: s.q, r: s.r, target: 18 });
        // Held in the player's own name (a holding), with a farm beside it
        player.settlements = [{ q: s.q, r: s.r }];
        const t = landBeside(world, s.q, s.r);
        t.playerProperties = [{ type: 'farm', level: 2, storage: 0, cost: 500 }];
        player.properties.push({ q: t.q, r: t.r, type: 'farm' });
        const rivalId = Object.keys(player.house.rivals)[0];
        player.house.rivals[rivalId].feud = 80;
        return { tile, settlement: tile.settlement, farm: t.playerProperties[0], rivalId };
    }

    it('a bribed official skims the holding; exposing them drives them out and ends it', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const { settlement, rivalId } = setupTown(game);
        const rng0 = Utils.random;
        const a = RivalAgents.recruit(player, world, rivalId, { kind: 'official' });
        expect(a).toBeTruthy();
        expect(a.kind).toBe('official');
        expect(Holdings.computeFx(settlement).skim).toBeGreaterThanOrEqual(RivalAgents.kind('official').skim - 1e-9);
        expect(settlement.folk.annals.some(e => e.k === 'rivalMen')).toBe(true);
        // Not known yet: it can't be exposed
        expect(RivalAgents.expose(player, world, a.id).success).toBe(false);
        // Ask around town until the name comes out
        player.q = a.q; player.r = a.r; player.gold = 1000;
        a.suspicion = 70;
        const inq = RivalAgents.inquire(player, world, a.q, a.r);
        expect(inq.success).toBe(true);
        expect(a.known).toBe(true);
        const res = RivalAgents.expose(player, world, a.id);
        expect(res.success).toBe(true);
        const person = Townsfolk.get(settlement.folk, a.pid);
        expect(Townsfolk.isHere(person)).toBe(false);
        expect(settlement.holding.bribed).toBeUndefined();
        expect(Holdings.computeFx(settlement).skim).toBe(0);
        expect(RivalAgents.list(player)).toHaveLength(0);
        expect(Utils.random).toBe(rng0);
    });

    it('an informant hides its master\'s plots; turned, it reveals them', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const { rivalId } = setupTown(game);
        const scheme = { id: 99, rivalId, type: 'slander' };
        const base = Schemes.revealChance(player, scheme, world.day);
        const a = RivalAgents.recruit(player, world, rivalId, { kind: 'informant' });
        expect(a.kind).toBe('informant');
        expect(Schemes.revealChance(player, scheme, world.day)).toBeLessThan(base);
        a.known = true;
        player.gold = 5000;
        const res = RivalAgents.turn(player, world, a.id);
        expect(res.success).toBe(true);
        expect(a.turned).toBe(true);
        expect(player.house.informants[rivalId]).toBeTruthy();
        expect(Schemes.revealChance(player, scheme, world.day)).toBeGreaterThan(base);
    });

    it('a saboteur idles the player\'s farm on its own stream, and the weekly tick recruits on its own', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const { farm, rivalId } = setupTown(game);
        const a = RivalAgents.recruit(player, world, rivalId, { kind: 'saboteur' });
        expect(a.kind).toBe('saboteur');
        let hit = false;
        for (let i = 0; i < 40 && !hit; i++) {
            world.day++;
            const out = { notices: [] };
            RivalAgents._act(player, world, a, out);
            hit = farm.sabotagedDays > 0;
            if (hit) expect(out.notices[0].title).toMatch(/Sabotage/);
        }
        expect(hit).toBe(true);
        // The weekly tick (recruitment by hash) — run a season of weeks
        const st = RivalAgents.state(player);
        const n0 = st.agents.length;
        for (let i = 0; i < 120; i++) { world.day++; RivalAgents.processDay(world, player); }
        expect(st.agents.length).toBeGreaterThanOrEqual(n0);
        expect(st.stats.recruited).toBeGreaterThan(1);
    });
});

describe('Save and load', () => {
    it('a league, the realms\' regard and rival agents survive a round trip', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        swearLeague(game);
        Coalitions.defy(player, world);
        const name = Coalitions.active(player).name;
        const rivalId = Object.keys(player.house.rivals)[0];
        player.house.rivals[rivalId].feud = 80;
        const g2 = roundTrip(game);
        const c2 = Coalitions.active(g2.player);
        expect(c2).toBeTruthy();
        expect(c2.name).toBe(name);
        expect(c2.stage).toBe('active');
        expect(Object.keys(Coalitions.state(g2.player).realms).length).toBeGreaterThan(0);
        for (const m of Coalitions.members(g2.player)) expect(TradePolicy.playerBar(g2.player, m.kingdomId)).toBeTruthy();
        expect(RivalAgents.state(g2.player).agents).toEqual(RivalAgents.state(player).agents);
        // An old save without the records gets blank ones
        const p3 = { ...g2.player, coalitions: null, rivalAgents: undefined };
        Coalitions.loadState(p3);
        RivalAgents.loadState(p3);
        expect(p3.coalitions.active).toBeNull();
        expect(p3.rivalAgents.agents).toEqual([]);
    });
});

describe('The Threats panel', () => {
    it('renders the power, the league with its offers, the realms and the unmasked agents', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const game = newGame(SEED);
        const { world, player } = game;
        swearLeague(game);
        const rivalId = Object.keys(player.house.rivals)[0];
        player.house.rivals[rivalId].feud = 80;
        let shown = null;
        const notes = [];
        game.ui = {
            showCustomPanel: (title, html) => { shown = { title, html }; },
            showNotification: (...a) => notes.push(a),
            updateStats: () => {},
        };
        ActionMenu.showThreatsPanel(game);
        const c = Coalitions.active(player);
        expect(shown.title).toMatch(/Threats/);
        expect(shown.html).toContain(c.name.replace(/'/g, '&#39;'));
        expect(shown.html).toMatch(/Buy out/);
        expect(shown.html).toMatch(/hostility/);
        // A button routes through threatsAct: defy the terms
        ActionMenu.threatsAct(game, 'defy');
        expect(Coalitions.active(player).stage).toBe('active');
        expect(shown.html).toMatch(/at war/);
    });
});
