// Outlaw Lairs (systems/outlawLairs.js): persistent strongholds of bandits,
// smugglers, deserters, cultists and beasts — content integrity, formation
// without RNG, growth, raiding parties and their real effects, realm
// pressure, clearing (assault, strike), tribute and partnership, bounties,
// heralds and chatter, save round-trip and determinism.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { World } from '../world/world.js';
import { KingdomStability } from '../world/kingdomState.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Player } from '../player/player.js';
import { Quests } from '../systems/quests.js';
import { House } from '../systems/house.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Heralds } from '../systems/heralds.js';
import { Chatter } from '../systems/chatter.js';
import { Holdings } from '../systems/holdings.js';
import { Counsel } from '../systems/counsel.js';
import { Deeds } from '../systems/deeds.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';

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

function genWorld(seed = 4242) {
    Utils.setSeed(seed);
    const w = new World(80, 60);
    w.generate({ kingdomCount: 10, seed });
    w.day = 1;
    return w;
}

function makePlayer(w) {
    const p = new Player({ firstName: 'Lair', lastName: 'Tester', gender: 'male', age: 25 });
    p.placeInWorld(w);
    Quests.initialize(p);
    House.initialize(p, w);
    p.gold = 5000;
    p.renown = 50;
    p.inventory = { food: 50 };
    p.army = [];
    return p;
}

function fresh(seed = 4242) {
    const w = genWorld(seed);
    return { w, p: makePlayer(w) };
}

/** Advance only the outlaw system (and the world's units) for n days. */
function runDays(w, p, n, opts = {}) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        w.day++;
        w.events = [];
        if (opts.units) for (const u of w.units) if (!u.destroyed) u.update(w, null);
        if (opts.units) w.units = w.units.filter(u => !u.destroyed);
        notices.push(...OutlawLairs.processDay(w, p).notices);
    }
    return notices;
}

function army(p, n = 20, strength = 12) {
    p.army = [];
    for (let i = 0; i < n; i++) p.army.push({ type: 'swordsman', name: 'Swordsman', strength, upkeep: 1, experience: 0, level: 1 });
}

function standAt(p, lair) {
    p.q = lair.q;
    p.r = lair.r;
}

describe('content', () => {
    it('validates: kinds, terrains, hoard goods, parties, leaders', () => {
        const terrains = Object.values(DataLoader._gamedata.terrain.types).map(t => t.id);
        const goods = Object.values(DataLoader._gamedata.playerEconomy.GOODS).map(g => g.id);
        expect(OutlawLairs.validate(terrains, goods)).toEqual([]);
        expect(Object.keys(OutlawLairs.kinds()).length).toBeGreaterThanOrEqual(5);
    });

    it('chatter and heralds content still validates with the outlaw lines', () => {
        expect(Chatter.validate()).toEqual([]);
        const tmpl = DataLoader.chatter.heralds.templates;
        expect(tmpl.lair_cleared.length).toBeGreaterThan(0);
        expect(tmpl.lair_risen.length).toBeGreaterThan(0);
    });
});

describe('formation', () => {
    it('places the first lairs lazily on the first tick, without drawing RNG', () => {
        const { w, p } = fresh();
        expect(p.outlawLairs).toBeUndefined();
        const before = Utils.random;
        let draws = 0;
        Utils.random = () => { draws++; return before(); };
        try {
            w.day = 1;
            const st = OutlawLairs.state(p);
            OutlawLairs._formation(w, st, 2);
        } finally {
            Utils.random = before;
        }
        expect(draws).toBe(0);
        const lairs = OutlawLairs.active(p);
        expect(lairs.length).toBe(2);
        for (const l of lairs) {
            const tile = w.getTile(l.q, l.r);
            expect(tile.terrain.passable).toBe(true);
            expect(tile.settlement).toBeFalsy();
            expect(tile.improvement).toBeFalsy();
            expect(OutlawLairs.kind(l.kind).terrains).toContain(tile.terrain.id);
            expect(l.leader.name).toBeTruthy();
            expect(l.strength).toBeGreaterThan(0);
            // A few days from the nearest town
            const nearest = Math.min(...w.getAllSettlements().map(s => Hex.wrappingDistance(s.q, s.r, l.q, l.r, w.width)));
            expect(nearest).toBeGreaterThanOrEqual(OutlawLairs.config().minTownDist);
            expect(nearest).toBeLessThanOrEqual(OutlawLairs.config().maxTownDist);
        }
    });

    it('prefers poorly policed country: lowering a realm\'s stability draws lairs to it', () => {
        const { w } = fresh();
        const st = OutlawLairs._blank();
        const base = OutlawLairs.candidates(w, st);
        expect(base.length).toBeGreaterThan(10);
        const target = w.kingdoms.find(k => k.isAlive && base.some(c => c.kingdomId === k.id && !c.wild));
        for (const k of w.kingdoms) k.stability = k === target ? 5 : 95;
        const after = OutlawLairs.candidates(w, st);
        expect(after[0].kingdomId === target.id || after[0].wild).toBe(true);
        const top = after.slice(0, 10).filter(c => !c.wild);
        expect(top.every(c => c.kingdomId === target.id)).toBe(true);
    });

    it('rolls its daily dice on its own stream: the main RNG is left untouched', () => {
        const { w, p } = fresh();
        runDays(w, p, 1);
        Utils.setSeed(9);
        const expected = [Utils.random(), Utils.random()];
        Utils.setSeed(9);
        runDays(w, p, 30);
        expect(OutlawLairs.state(p).stats.raids + OutlawLairs.active(p).reduce((n, l) => n + l.parties.length, 0)).toBeGreaterThan(0);
        expect([Utils.random(), Utils.random()]).toEqual(expected);
    });

    it('is deterministic for a seed, and forms more lairs over time up to the cap', () => {
        const a = fresh(777);
        const b = fresh(777);
        runDays(a.w, a.p, 60);
        runDays(b.w, b.p, 60);
        const sig = p => OutlawLairs.state(p).lairs.map(l => `${l.kind}@${l.q},${l.r}:${l.leader.name}:${l.strength}:${l.notoriety}`);
        expect(sig(a.p)).toEqual(sig(b.p));
        expect(OutlawLairs.state(a.p).lairs.length).toBeGreaterThan(OutlawLairs.config().initialLairs);
        expect(OutlawLairs.active(a.p).length).toBeLessThanOrEqual(OutlawLairs.config().maxLairs);
    });
});

describe('growth and raids', () => {
    it('grows strength daily, faster where the realm is restless', () => {
        const { w, p } = fresh();
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p)[0];
        lair.parties = [];
        lair.nextRaidDay = 1e9;
        const k = w.getKingdom(lair.kingdomId);
        lair.wild = false;
        if (k) k.stability = 90;
        const s0 = lair.strength;
        runDays(w, p, 10);
        const calm = lair.strength - s0;
        expect(calm).toBeGreaterThan(0);
        if (k) k.stability = 5;
        const s1 = lair.strength;
        runDays(w, p, 10);
        expect(lair.strength - s1).toBeGreaterThan(calm);
    });

    it('sends real raiding parties that burn, kill, rob the treasury and bring the plunder home', () => {
        const { w, p } = fresh(99);
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p).find(l => l.kingdomId != null);
        lair.strength = 60;
        lair.nextRaidDay = w.day + 1;
        runDays(w, p, 1);
        expect(lair.parties.length).toBe(1);
        const party = lair.parties[0];
        const unit = w.units.find(u => u.id === party.unitId);
        expect(unit).toBeTruthy();
        expect(['raider', 'beast']).toContain(unit.type);
        expect(unit.lairId).toBe(lair.id);
        expect(OutlawLairs.garrison(lair)).toBe(Math.round(lair.strength - party.strength));

        // Point it at a realm's town nearby, and march it there
        const town = w.getAllSettlements().filter(x => x.kingdom && w.getKingdom(x.kingdom))
            .sort((a, b) => Hex.wrappingDistance(a.q, a.r, lair.q, lair.r, w.width) - Hex.wrappingDistance(b.q, b.r, lair.q, lair.r, w.width))[0];
        party.targetQ = town.q;
        party.targetR = town.r;
        const s = w.getTile(town.q, town.r).settlement;
        const k = w.getKingdom(s.kingdom);
        k.treasury = 5000;
        const pop0 = s.population;
        const dmg0 = s.damage || 0;
        const tre0 = k.treasury;
        const raids0 = lair.raids;
        unit.q = party.targetQ;
        unit.r = party.targetR;
        runDays(w, p, 1);
        expect(lair.raids).toBe(raids0 + 1);
        expect(s.population).toBeLessThan(pop0);
        expect(s.damage).toBeGreaterThan(dmg0);
        const kind = OutlawLairs.kind(lair.kind);
        if (kind.raid.loot[1] > 0) {
            expect(k.treasury).toBeLessThan(tre0);
            expect(unit.inventory.gold).toBe(tre0 - k.treasury);
        }
        expect(party.phase).toBe('home');

        // Home again: the coin goes into the hoard and the riders rejoin the garrison
        const hoard0 = lair.hoard.gold;
        const carried = unit.inventory.gold || 0;
        unit.q = lair.q;
        unit.r = lair.r;
        runDays(w, p, 1);
        expect(lair.parties.length).toBe(0);
        expect(unit.destroyed).toBe(true);
        expect(lair.hoard.gold).toBe(hoard0 + carried);
    });

    it('a party cut down by the player costs the lair its men; a bargain makes its riders spare the player', () => {
        const { w, p } = fresh(99);
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p).find(l => OutlawLairs.kind(l.kind).parley && l.kingdomId != null) || OutlawLairs.active(p)[0];
        lair.strength = 80;
        lair.nextRaidDay = w.day + 1;
        runDays(w, p, 1);
        const unit = w.units.find(u => u.lairId === lair.id);
        expect(unit.sparesPlayer).toBe(false);
        const s0 = lair.strength;
        const ps = lair.parties[0].strength;
        unit.destroyed = true;
        unit.slainByPlayer = true;
        runDays(w, p, 1);
        expect(lair.parties.length).toBe(0);
        expect(lair.strength).toBeLessThan(s0 - ps + 1);
        expect(OutlawLairs.state(p).stats.partiesBroken).toBe(1);
    });

    it('burdens its realm: a regional event lowers stability and land trade, and ends with the lair', () => {
        const { w, p } = fresh();
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p).find(l => l.kingdomId != null);
        lair.notoriety = 60;
        lair.nextRaidDay = 1e9;
        runDays(w, p, 1);
        const ev = w.activeEvents.find(e => e.lairId === lair.id);
        expect(ev).toBeTruthy();
        expect(ev.effects.stability).toBeLessThan(0);
        expect(ev.effects.landTradeIncome).toBeLessThan(0);
        const k = w.getKingdom(lair.kingdomId);
        expect(KingdomStability.eventMod(w, k, 'stability')).toBeLessThan(0);
        const town = w.getAllSettlements().find(s => s.kingdom === k.id);
        expect(WorldEvents.getModifier(w, 'landTradeIncome', w.getTile(town.q, town.r))).toBeLessThan(0);
        OutlawLairs._end(w, p, OutlawLairs.state(p), lair, 'dispersed', null, { notices: [] });
        expect(w.activeEvents.find(e => e.lairId === lair.id)).toBeUndefined();
    });

    it('raids a player holding through Holdings, unless tribute is paid', () => {
        const { w, p } = fresh(99);
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p).find(l => OutlawLairs.kind(l.kind).parley);
        lair.strength = 80;
        lair.nextRaidDay = w.day + 1;
        runDays(w, p, 1);
        const unit = w.units.find(u => u.lairId === lair.id);
        standAt(p, lair);
        p.gold = 99999;
        const res = OutlawLairs.payTribute(p, w, lair.id);
        expect(res.success).toBe(true);
        expect(unit.sparesPlayer).toBe(true);
        expect(OutlawLairs.sparesPlayer(lair, w.day)).toBe(true);
        // Holdings ignore riders under a bargain
        const s = w.getAllSettlements()[0];
        const live = w.getTile(s.q, s.r).settlement;
        live.holding = { unrest: 0, fx: { raidReduction: 0 }, queue: [], garrison: [] };
        unit.q = s.q; unit.r = s.r;
        const out = { raids: [], notices: [] };
        Holdings._raid(p, w, { q: s.q, r: s.r, settlement: live }, live.holding, out);
        expect(out.raids.length).toBe(0);
    });
});

describe('the player\'s dealings', () => {
    function lairNextTo(seed = 4242) {
        const { w, p } = fresh(seed);
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p)[0];
        lair.nextRaidDay = 1e9;
        standAt(p, lair);
        return { w, p, lair };
    }

    it('finds a lair it walks up to', () => {
        const { w, p, lair } = lairNextTo();
        lair.known = false;
        const notices = runDays(w, p, 1);
        expect(lair.known).toBe(true);
        expect(notices.some(n => /Found/.test(n.title))).toBe(true);
        expect(OutlawLairs.lairNear(p, w, p.q, p.r, 1)).toBe(lair);
    });

    it('storms a lair with an army: three stages, then the hoard, renown, Prestige and the realm\'s thanks', () => {
        const { w, p, lair } = lairNextTo();
        lair.known = true;
        lair.strength = 30;
        lair.hoard = { gold: 250, goods: { weapons: 2 } };
        army(p, 30, 20);
        const gold0 = p.gold;
        const renown0 = p.renown;
        const prestige0 = p.house.prestige;
        Utils.setSeed(5);
        const res = OutlawLairs.assault(p, w, lair.id);
        expect(res.success).toBe(true);
        expect(res.stages.length).toBe(3);
        expect(res.cleared).toBe(true);
        expect(lair.status).toBe('cleared');
        expect(lair.leader.slainBy).toBe('player');
        expect(p.gold).toBeGreaterThanOrEqual(gold0 + 250);
        expect(p.inventory.weapons).toBe(2);
        expect(p.renown).toBeGreaterThan(renown0);
        expect(p.house.prestige).toBeGreaterThan(prestige0);
        if (lair.kingdomId != null) expect(p.reputation[lair.kingdomId]).toBeGreaterThan(0);
        expect(OutlawLairs.state(p).stats.clearedByPlayer).toBe(1);
        expect(OutlawLairs.state(p).history.some(h => h.kind === 'cleared' && h.own)).toBe(true);
    });

    it('cannot storm without an army, and a lost stage ends the assault and emboldens the lair', () => {
        const { w, p, lair } = lairNextTo();
        expect(OutlawLairs.assault(p, w, lair.id).success).toBe(false);
        lair.strength = 150;
        army(p, 2, 3);
        const n0 = lair.notoriety;
        const res = OutlawLairs.assault(p, w, lair.id);
        expect(res.success).toBe(true);
        expect(res.cleared).toBe(false);
        expect(res.stages[res.stages.length - 1].victory).toBe(false);
        expect(lair.status).toBe('active');
        expect(lair.notoriety).toBeGreaterThan(n0);
    });

    it('scouting reveals the garrison and makes the storm easier', () => {
        const { w, p, lair } = lairNextTo();
        lair.strength = 60;
        const stage = OutlawLairs.config().assault.stages[1];
        const before = OutlawLairs.stageStrength(p, w, lair, stage);
        p.skills.stealth = 10;
        let res;
        for (let i = 0; i < 20 && !lair.scouted; i++) res = OutlawLairs.scout(p, w, lair.id);
        expect(res.success).toBe(true);
        expect(lair.scouted).toBeTruthy();
        lair.alertUntil = null;
        expect(OutlawLairs.stageStrength(p, w, lair, stage)).toBeLessThan(before);
    });

    it('striking at the chief leaves the band leaderless until a new chief rises', () => {
        const { w, p, lair } = lairNextTo();
        lair.strength = 100;
        p.skills.stealth = 10;
        p.skills.combat = 10;
        let res;
        for (let i = 0; i < 30 && !lair.leader.slain; i++) res = OutlawLairs.strike(p, w, lair.id);
        expect(res.slain).toBe(true);
        expect(lair.leader.slainBy).toBe('player');
        expect(lair.strength).toBeLessThan(100);
        expect(lair.status).toBe('active');
        const gen = lair.leader.gen;
        w.day = lair.leaderlessUntil;
        OutlawLairs.state(p).lastDay = null;
        runDays(w, p, 1);
        expect(lair.leader.slain).toBe(false);
        expect(lair.leader.gen).toBe(gen + 1);
        expect(typeof lair.leader.name).toBe('string');
    });

    it('tribute costs gold that feeds the lair and lapses after its days', () => {
        const { w, p } = fresh(99);
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p).find(l => OutlawLairs.kind(l.kind).parley);
        lair.nextRaidDay = 1e9;
        standAt(p, lair);
        const price = OutlawLairs.tributePrice(p, lair);
        const gold0 = p.gold;
        const hoard0 = lair.hoard.gold;
        const s0 = lair.strength;
        expect(OutlawLairs.payTribute(p, w, lair.id).success).toBe(true);
        expect(p.gold).toBe(gold0 - price);
        expect(lair.hoard.gold).toBe(hoard0 + price);
        expect(lair.strength).toBeGreaterThan(s0);
        w.day = lair.tribute.until + 1;
        OutlawLairs.state(p).lastDay = null;
        const notices = OutlawLairs.processDay(w, p).notices;
        expect(lair.tribute).toBeNull();
        expect(notices.some(n => /Lapsed/.test(n.title))).toBe(true);
    });

    it('beasts take no tribute; partners must be rogues or guild men, and are paid a weekly cut with heat', () => {
        const { w, p } = fresh(99);
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p)[0];
        lair.nextRaidDay = 1e9;
        standAt(p, lair);
        lair.kind = 'beast_den';
        expect(OutlawLairs.payTribute(p, w, lair.id).success).toBe(false);
        lair.kind = 'bandit_camp';
        p.karma = 10;
        expect(OutlawLairs.canAlly(p, lair).ok).toBe(false);
        p.karma = -40;
        expect(OutlawLairs.ally(p, w, lair.id).success).toBe(true);
        lair.hoard.gold = 1000;
        const gold0 = p.gold;
        w.day += 7;
        OutlawLairs.state(p).lastDay = null;
        OutlawLairs.processDay(w, p);
        expect(p.gold).toBeGreaterThan(gold0);
        if (lair.kingdomId != null) expect(p.underworld.heat[lair.kingdomId]).toBeGreaterThan(0);
    });
});

describe('expeditions', () => {
    it('a realm sends wardens who march on the lair and settle it one way or the other', () => {
        const { w, p } = fresh();
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p).find(l => l.kingdomId != null);
        lair.notoriety = 90;
        lair.nextRaidDay = 1e9;
        const k = w.getKingdom(lair.kingdomId);
        k.treasury = 10000;
        k.military = 50000;
        let found = false;
        for (let i = 0; i < 200 && !found; i++) {
            lair.lastExpeditionCheck = -100;
            OutlawLairs._maybeExpedition(w, OutlawLairs.state(p), lair);
            found = OutlawLairs.state(p).expeditions.length > 0;
        }
        expect(found).toBe(true);
        const x = OutlawLairs.state(p).expeditions[0];
        const unit = w.units.find(u => u.id === x.unitId);
        expect(unit.type).toBe('lair_expedition');
        expect(k.military).toBeLessThan(50000);
        unit.q = lair.q; unit.r = lair.r;
        runDays(w, p, 1);
        expect(OutlawLairs.state(p).expeditions.length).toBe(0);
        expect(unit.destroyed).toBe(true);
        expect(['cleared', 'active']).toContain(lair.status);
        if (lair.status === 'cleared') {
            expect(lair.endedBy).toBe('realm');
            expect(OutlawLairs.state(p).stats.clearedByRealms).toBe(1);
        } else {
            expect(lair.notoriety).toBeGreaterThanOrEqual(90);
        }
    });
});

describe('bounties, news and counsel', () => {
    it('posts the chief on notice boards and pays the hunter who kills him', () => {
        const { w, p } = fresh();
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p)[0];
        lair.notoriety = 60;
        lair.nextRaidDay = 1e9;
        const town = w.getAllSettlements().sort((a, b) => Hex.wrappingDistance(a.q, a.r, lair.q, lair.r, w.width) - Hex.wrappingDistance(b.q, b.r, lair.q, lair.r, w.width))[0];
        const tile = w.getTile(town.q, town.r);
        const offers = BountyHunting.generateBoardOffers(p, w, tile, []);
        const offer = offers.find(o => o.type === 'lair_leader' && o.lairId === lair.id);
        expect(offer).toBeTruthy();
        p.activeBounties.push({ ...offer });
        lair.known = false;
        BountyHunting.processDaily(p, w);
        expect(lair.known).toBe(true);
        // Kill the chief
        standAt(p, lair);
        p.skills.stealth = 10; p.skills.combat = 10;
        lair.strength = 200;
        for (let i = 0; i < 30 && !lair.leader.slain; i++) OutlawLairs.strike(p, w, lair.id);
        expect(lair.leader.slain).toBe(true);
        const gold0 = p.gold;
        const up = BountyHunting.processDaily(p, w);
        expect(up.chiefs[0].outcome).toBe('slain');
        expect(p.gold).toBeGreaterThan(gold0);
        expect(p.activeBounties.some(b => b.type === 'lair_leader')).toBe(false);
        expect(Deeds.collect(p)['bounty.chiefs']).toBe(1);
        expect(Deeds.collect(p)['outlaws.leadersSlain']).toBe(1);
    });

    it('is talked of in taverns and by townsfolk, and cried by the heralds when infamous or cleared', () => {
        const { w, p } = fresh();
        runDays(w, p, 1);
        Heralds.processDay(w, p); // first tick takes the snapshot
        const lair = OutlawLairs.active(p)[0];
        lair.nextRaidDay = 1e9;
        lair.notoriety = 85;
        const town = w.getAllSettlements().sort((a, b) => Hex.wrappingDistance(a.q, a.r, lair.q, lair.r, w.width) - Hex.wrappingDistance(b.q, b.r, lair.q, lair.r, w.width))[0];
        const rumours = OutlawLairs.tavernRumors(p, w, w.getTile(town.q, town.r));
        expect(rumours.some(r => r.title.includes(lair.name))).toBe(true);
        expect(lair.known).toBe(true);
        const ctx = Chatter.context(w, p, { q: town.q, r: town.r });
        expect(ctx.outlaws && ctx.outlaws.name).toBe(lair.name);
        runDays(w, p, 1);
        Heralds.processDay(w, p);
        expect(p.heralds.list.some(x => x.kind === 'lair_risen')).toBe(true);
        OutlawLairs._end(w, p, OutlawLairs.state(p), lair, 'cleared', { by: 'realm', name: 'The Wardens' }, { notices: [] });
        w.day++;
        Heralds.processDay(w, p);
        expect(p.heralds.list.some(x => x.kind === 'lair_cleared')).toBe(true);
    });

    it('the Steward warns of a known lair near the player and offers it as a target', () => {
        const { w, p } = fresh();
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p)[0];
        lair.known = true;
        p.q = lair.q; p.r = lair.r;
        const scan = Counsel.scan(p, w, { fresh: true });
        const all = [...scan.threats, ...scan.opportunities];
        expect(all.some(i => i.id && i.id.startsWith('outlaw_'))).toBe(true);
    });
});

describe('the panel', () => {
    it('lists known lairs and runs a deed from the action menu', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { w, p } = fresh();
        runDays(w, p, 1);
        const lair = OutlawLairs.active(p)[0];
        lair.known = true;
        lair.nextRaidDay = 1e9;
        standAt(p, lair);
        p.actionPoints = 20;
        let html = '';
        const game = {
            player: p, world: w,
            ui: {
                showCustomPanel: (title, h) => { html = h; },
                showNotification: () => {},
                updateStats: () => {},
                hideCustomPanel: () => {},
            },
        };
        ActionMenu.showOutlawLairs(game, lair.id);
        expect(html).toContain(lair.name);
        expect(html).toContain('Scout');
        window._lairs.act(lair.id, 'scout');
        expect(p.actionPoints).toBe(20 - ActionMenu.getAPCost('lair_scout'));
        expect(html).toContain(lair.name);
        // The action is offered beside the lair
        const actions = [];
        const { addWildernessActions } = await import('../player/actions/wildernessActions.js');
        addWildernessActions(actions, p, w.getTile(p.q, p.r), w);
        expect(actions.some(a => a.type === 'outlaw_lair')).toBe(true);
    });
});

describe('saving', () => {
    it('round-trips lairs, parties and bargains through a save, and keeps running', async () => {
        const game = newGame(31337);
        const stats = {};
        for (let i = 0; i < 25; i++) { botDay(game, stats); endDay(game); }
        const st = OutlawLairs.state(game.player);
        expect(st.lairs.length).toBeGreaterThan(0);
        const before = JSON.stringify(st);
        const g2 = roundTrip(game);
        expect(JSON.stringify(OutlawLairs.state(g2.player))).toBe(before);
        // Party units come back with the world, still tagged
        for (const l of OutlawLairs.active(g2.player)) {
            for (const party of l.parties) expect(g2.world.units.some(u => u.id === party.unitId && u.lairId === l.id)).toBe(true);
        }
        for (let i = 0; i < 10; i++) { botDay(g2, stats); endDay(g2); }
        expect(OutlawLairs.state(g2.player).lastDay).toBe(g2.world.day);
    });

    it('old saves without lairs get a blank record', () => {
        const p = makePlayer(genWorld());
        delete p.outlawLairs;
        OutlawLairs.loadState(p);
        expect(p.outlawLairs.lairs).toEqual([]);
        expect(p.outlawLairs.initialized).toBe(false);
        expect(SaveLoad).toBeTruthy();
    });

    it('a full game is deterministic for a seed with the lairs running', () => {
        const run = () => {
            const g = newGame(2024);
            const stats = {};
            for (let i = 0; i < 40; i++) { botDay(g, stats); endDay(g); }
            return JSON.stringify(OutlawLairs.state(g.player).lairs.map(l => [l.name, l.strength, l.notoriety, l.raids, l.status, l.hoard.gold]));
        };
        expect(run()).toBe(run());
    });
});
