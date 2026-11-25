// The war for your own crown (systems/crownSuccession.js): when the player
// rules a realm and the seat passes, claimants weigh their strength against the
// heir's standing; one who rises is backed by named lords of the royal court and
// makes war on the Kingship revolt machinery; lost, the realm splits (or the
// crown goes). Preparation in life lowers the odds, every factor with its weight.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { CrownSuccession } from '../systems/crownSuccession.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Afterlife } from '../player/afterlife.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let n = 0;
function kid(extra = {}) {
    const c = {
        id: `cs_kid_${n++}`, firstName: 'Wynn', dynasty: 'Harness', gender: 'male', age: 24, isAlive: true, traits: [],
        strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 2, diplomacy: 2, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    return c;
}

/** The living kingdom with the most settlements. */
function biggest(world) {
    const all = world.getAllSettlements();
    const count = k => all.filter(s => s.kingdom === k.id).length;
    return world.kingdoms.filter(k => k.isAlive).sort((a, b) => count(b) - count(a))[0];
}

/** A crowned player whose court has opened, with an heir and a younger son. */
function crowned(seed = 31, opts = {}) {
    const game = newGame(seed);
    const { world, player } = game;
    world.day = 2400;
    const k = biggest(world);
    Throne._takeThrone(player, world, k);
    k.treasury = 5000;
    // (the brothers live by the realm's law: under fratricide or the cage no brother rises — systems/fratricide.js)
    k.laws = { ...(k.laws || {}), succession: 'mercy' };
    Kingship.processDay(world, player);
    player.gold = 20000;
    player.house.prestige = opts.prestige != null ? opts.prestige : 100;
    const heir = kid({ firstName: 'Ada', age: 30, gender: 'female' });
    const younger = kid({ firstName: 'Bram', age: 26, gender: 'male', ...(opts.younger || {}) });
    player.children = [heir, younger];
    player.heir = heir.id;
    return { game, world, player, k, heir, younger, court: Kingship.court(player) };
}

/** Make the realm's lords hate the crown and the son hungry: a contest is near certain. */
function sour(world, court, k, younger) {
    for (const v of court.vassals) { v.opinion = -70; v.ambition = 9; v.honor = 2; }
    k.stability = 20;
    younger.traits = [{ id: 'ambitious' }];
    younger.age = 40; // older than the heir: passed over
}

describe('Crown succession data (data/crownSuccession.json)', () => {
    it('is registered, and its tunables merge over the code defaults', () => {
        expect(DataLoader._gamedata.crownSuccession).toBeTruthy();
        const C = CrownSuccession.config();
        expect(C.claimants.brother.son).toBe(30);
        expect(C.standing.crowned).toBe(24);
        expect(C.prep.coronation.prestige).toBe(25);
        expect(C.split.claimStrength).toBe(40);
        expect(Kingship.demandText({ type: 'crown', claimant: 'Bram' }).label).toBe('the crown for Bram');
    });
});

describe('No crown, nothing', () => {
    it('captures nothing, contests nothing and draws nothing while the player rules no realm', () => {
        const game = newGame(5);
        const { world, player } = game;
        const c = kid();
        player.children = [c];
        expect(CrownSuccession.capture(player, world, c, {})).toBe(null);
        expect(CrownSuccession.onSuccession(player, world, null)).toBe(null);
        expect(CrownSuccession.forecast(player, world)).toBe(null);
        Utils.setSeed(9);
        CrownSuccession.processDay(world, player);
        const a = Utils.random();
        Utils.setSeed(9);
        const b = Utils.random();
        expect(a).toBe(b);
    }, 60000);
});

describe('The Succession card', () => {
    it('shows the heir\'s standing and each claimant with every factor\'s weight', () => {
        const { world, player, heir, younger } = crowned();
        const f = CrownSuccession.forecast(player, world);
        expect(f.heir.id).toBe(heir.id);
        expect(f.standing.parts.find(p => p.label === 'Named heir in life').value).toBe(12);
        const bram = f.claimants.find(c => c.ref === younger.id);
        expect(bram).toBeTruthy();
        expect(bram.kind).toBe('brother');
        expect(bram.parts.find(p => p.label === 'A son of the blood').value).toBe(30);
        expect(bram.strength).toBe(bram.parts.reduce((s, p) => s + p.value, 0));
        expect(bram.chance).toBeGreaterThanOrEqual(0);
        expect(bram.sides.lordPower).toBeGreaterThan(0);
        expect(f.risk).toBeGreaterThanOrEqual(bram.chance);
    }, 60000);

    it('a portion buys a son off, holy orders and a marriage abroad end his claim', () => {
        const { world, player, younger, k } = crowned();
        const before = CrownSuccession.forecast(player, world).claimants.find(c => c.ref === younger.id).strength;
        const gold = player.gold;
        for (let i = 0; i < 4; i++) expect(CrownSuccession.givePortion(player, world, younger.id).success).toBe(true);
        expect(younger.purse).toBe(1000);
        expect(player.gold).toBe(gold - 1000);
        const bought = CrownSuccession.forecast(player, world).claimants.find(c => c.ref === younger.id);
        expect(bought.strength).toBeLessThan(before * 0.4);
        expect(bought.parts.some(p => p.label.startsWith('A portion'))).toBe(true);

        // Abroad: wed into another realm
        younger.upbringing.spouse = { kind: 'alliance', kingdomId: world.kingdoms.find(o => o.id !== k.id).id, name: 'x' };
        expect(CrownSuccession.forecast(player, world).claimants.find(c => c.ref === younger.id)).toBeFalsy();
        younger.upbringing.spouse = null;

        // Holy orders: alms paid into the capital's purse
        const cap = world.getTile(k.capital.q, k.capital.r).settlement;
        const purse = cap.economy ? cap.economy.gold : null;
        const res = CrownSuccession.sendToChurch(player, world, younger.id);
        expect(res.success).toBe(true);
        if (purse != null) expect(cap.economy.gold).toBeCloseTo(purse + CrownSuccession.config().prep.orders.gold, 2);
        expect(CrownSuccession.forecast(player, world).claimants.find(c => c.ref === younger.id)).toBeFalsy();
        expect(CrownSuccession.sendToChurch(player, world, younger.id).success).toBe(false);
    }, 60000);

    it('crowning the heir and the lords\' oaths raise the standing', () => {
        const { world, player, heir, court } = crowned();
        const before = CrownSuccession.forecast(player, world).standing.value;
        const p0 = player.house.prestige;
        expect(CrownSuccession.crownHeir(player, world).success).toBe(true);
        expect(player.house.prestige).toBe(p0 - 25);
        expect(CrownSuccession.crownHeir(player, world).success).toBe(false);
        for (const v of court.vassals) v.opinion = 30;
        const sw = CrownSuccession.takeOaths(player, world);
        expect(sw.success).toBe(true);
        expect(sw.sworn).toBe(court.vassals.length);
        expect(court.vassals.every(v => v.heirOath && v.heirOath.heirId === heir.id)).toBe(true);
        expect(CrownSuccession.takeOaths(player, world).success).toBe(false); // (cooldown)
        const after = CrownSuccession.forecast(player, world);
        expect(after.standing.parts.find(p => p.label.startsWith('Crowned')).value).toBe(24);
        expect(after.standing.parts.find(p => p.label.startsWith('Oaths')).value).toBe(20);
        expect(after.standing.value).toBeGreaterThan(before + 45);
        expect(after.sworn).toBe(court.vassals.length);
    }, 60000);
});

describe('At the succession', () => {
    it('a well-prepared heir takes the crown unopposed; the oaths and crowning are spent', () => {
        const { world, player, heir, court } = crowned(31, { prestige: 400, younger: { age: 14 } });
        for (const v of court.vassals) v.opinion = 40;
        CrownSuccession.crownHeir(player, world);
        CrownSuccession.takeOaths(player, world);
        const res = Relationships.succeedAsHeir(player, heir.id, world, {});
        expect(res.success).toBe(true);
        expect(res.crown).toBeTruthy();
        expect(res.crown.contested).toBe(false);
        expect(Kingship.revolt(player)).toBe(null);
        expect(court.vassals.some(v => v.heirOath)).toBe(false);
        expect(CrownSuccession.state(player).history.slice(-1)[0].outcome).toBe('peaceful');
    }, 60000);

    it('a soured realm rises for the passed-over son: named lords back him and the war begins', () => {
        const { world, player, heir, younger, court, k } = crowned(31, { prestige: 0 });
        sour(world, court, k, younger);
        const res = Relationships.succeedAsHeir(player, heir.id, world, {});
        expect(res.success).toBe(true);
        expect(res.crown.contested).toBe(true);
        expect(res.crown.war).toBe(true);
        const rv = Kingship.revolt(player);
        expect(rv && rv.succession).toBeTruthy();
        expect(rv.succession.claimant.ref).toBe(younger.id);
        expect(rv.succession.backers.length).toBeGreaterThan(0);
        expect(rv.succession.support.claimant).toBeGreaterThan(0);
        for (const b of rv.succession.backers) expect(court.vassals.find(v => v.id === b.id).rebel).toBe(true);
        expect(rv.leaderName).toBe('Bram Harness');
        expect(Kingship.demandText(rv.demand).label).toBe('the crown for Bram Harness');
    }, 60000);

    it('the same world and choices give the same contest (its own stream; the shared one untouched)', () => {
        const run = () => {
            const { world, player, heir, younger, court, k } = crowned(44, { prestige: 0 });
            sour(world, court, k, younger);
            Utils.setSeed(777);
            const res = Relationships.succeedAsHeir(player, heir.id, world, {});
            const rv = Kingship.revolt(player);
            return { war: !!res.crown.war, backers: rv ? rv.succession.backers.map(b => b.id) : [], momentum: rv ? rv.momentum : null };
        };
        expect(run()).toEqual(run());
    }, 120000);

    it('crushed: the claimant is exiled and claims no more', () => {
        const { world, player, heir, younger, court, k } = crowned(31, { prestige: 0 });
        sour(world, court, k, younger);
        Relationships.succeedAsHeir(player, heir.id, world, {});
        const rv = Kingship.revolt(player);
        expect(rv.succession).toBeTruthy();
        Kingship._endRevolt(player, world, court, k, 'crushed', { notices: [] });
        expect(Kingship.revolt(player)).toBe(null);
        expect(younger.crownSuccession.exiled).toBeTruthy();
        expect(CrownSuccession.state(player).history.slice(-1)[0].outcome).toBe('held');
        expect(CrownSuccession.forecast(player, world).claimants.find(c => c.ref === younger.id)).toBeFalsy();
    }, 60000);

    it('lost: the realm splits — his seats become a rival kingdom with a claim on yours, and you on it', () => {
        const { world, player, heir, younger, court, k } = crowned(31, { prestige: 0 });
        sour(world, court, k, younger);
        Relationships.succeedAsHeir(player, heir.id, world, {});
        const rv = Kingship.revolt(player);
        const seats = rv.seats.slice();
        const capKey = `${k.capital.q},${k.capital.r}`;
        expect(seats.includes(capKey)).toBe(false);
        const kingdoms = world.kingdoms.length;
        const out = { notices: [] };
        Kingship._endRevolt(player, world, court, k, 'conceded', out);
        expect(world.kingdoms.length).toBe(kingdoms + 1);
        const nk = world.kingdoms[world.kingdoms.length - 1];
        expect(nk.crownClaim.on).toBe(k.id);
        expect(nk.ruler).toContain('Bram');
        for (const key of seats) {
            const [q, r] = key.split(',').map(Number);
            expect(world.getTile(q, r).settlement.kingdom).toBe(nk.id);
        }
        expect(nk.truces[k.id]).toBeGreaterThan(world.day);
        expect(Throne.claimStrength(player, nk.id)).toBeGreaterThanOrEqual(40);
        expect(court.vassals.some(v => rv.members.includes(v.id))).toBe(false);
        expect(player.children.some(c => c.id === younger.id)).toBe(false);
        expect(Throne.ruledKingdom(player, world)).toBe(k);
        expect(out.notices.some(x => x.title === 'The Realm Is Split')).toBe(true);
        expect(CrownSuccession.state(player).splits.length).toBe(1);

        // The breakaway goes to war for the rest once its truce runs out and its host is strong
        nk.truces[k.id] = 0;
        k.truces[nk.id] = 0;
        nk.military = Math.max(nk.military, k.military);
        world.day = Math.ceil((world.day + 1) / 120) * 120;
        const day = CrownSuccession.processDay(world, player);
        expect(nk.wars).toContain(k.id);
        expect(day.notices.some(x => x.title === 'The Breakaway Strikes')).toBe(true);

        // ...and if it falls, the realm is whole again
        nk.isAlive = false;
        const p0 = player.house.prestige;
        const whole = CrownSuccession.processDay(world, player);
        expect(whole.notices.some(x => x.title === 'The Realm Made Whole')).toBe(true);
        expect(player.house.prestige).toBe(p0 + 30);
    }, 60000);

    it('the capital taken: the crown itself passes to the claimant, and the heir keeps a blood claim', () => {
        const { world, player, heir, younger, court, k } = crowned(31, { prestige: 0 });
        sour(world, court, k, younger);
        Relationships.succeedAsHeir(player, heir.id, world, {});
        const rv = Kingship.revolt(player);
        rv.seats.push(`${k.capital.q},${k.capital.r}`);
        Kingship._endRevolt(player, world, court, k, 'conceded', { notices: [] });
        expect(Throne.ruledKingdom(player, world)).toBe(null);
        expect(k.ruler).toContain('Bram');
        expect(Throne.claimStrength(player, k.id)).toBeGreaterThanOrEqual(55);
        expect(CrownSuccession.state(player).history.slice(-1)[0].outcome).toBe('usurped');
    }, 60000);

    it('a child heir under a regency stands weaker', () => {
        const { world, player, k } = crowned(31);
        const child = kid({ firstName: 'Tam', age: 8 });
        player.children.push(child);
        player.heir = child.id;
        const adult = CrownSuccession.standing(player, world, k, { ...CrownSuccession.capture(player, world, player.children[0], {}), designated: true });
        const minor = CrownSuccession.forecast(player, world).standing;
        expect(minor.parts.find(p => p.label === 'A child of 8').value).toBe(-18);
        expect(minor.value).toBeLessThan(adult.value);
    }, 60000);

    it('the founding tale told for the heir steadies the standing; an heir born in the purple weakens it', () => {
        const { world, player, k, heir } = crowned(31);
        const base = CrownSuccession.forecast(player, world).standing.value;
        // the House's founding myth invoked for legitimacy (systems/namedLegacy.js)
        player.house.namedLegacy = { myth: null, chapters: [], heirBoon: null, invoked: {}, legitimacy: { until: world.day + 400 } };
        const told = CrownSuccession.forecast(player, world).standing;
        expect(told.parts.find(p => p.label === 'The House\'s founding tale told for the heir').value).toBe(12);
        expect(told.value).toBe(base + 12);
        player.house.namedLegacy.legitimacy = null;
        // soft from the court (systems/realmDecline.js → upbringing.purple), unless hardened since
        heir.upbringing.purple = 80;
        const soft = CrownSuccession.forecast(player, world).standing;
        expect(soft.parts.find(p => p.label.startsWith('Born in the purple')).value).toBe(-9);
        heir.upbringing.hardened = true;
        expect(CrownSuccession.forecast(player, world).standing.value).toBe(base);
    }, 60000);

    it('a child in holy orders is passed over as the likely heir', () => {
        const { player, heir, younger } = crowned(31);
        player.heir = null;
        heir.crownSuccession = { orders: 10 };
        expect(CrownSuccession.likelyHeir(player).id).toBe(younger.id);
    }, 60000);

    it('after a long interregnum a risen claimant has taken the empty throne', () => {
        const { world, player, heir, younger, court, k } = crowned(31, { prestige: 0 });
        sour(world, court, k, younger);
        Afterlife.begin(player, world, 'old age');
        world.day += 120 * 6;
        // the rise itself is a roll (at most 90%): make it certain, so the test doesn't hang on the stream
        const rise = vi.spyOn(CrownSuccession, 'riseChance').mockReturnValue(1);
        const res = Afterlife.returnAsHeir(player, world, heir.id);
        rise.mockRestore();
        expect(res.success).toBe(true);
        expect(res.crown.usurped).toBe(true);
        expect(Throne.ruledKingdom(player, world)).toBe(null);
        expect(Throne.claimStrength(player, k.id)).toBeGreaterThanOrEqual(55);
    }, 60000);
});

describe('The old line', () => {
    it('a crown taken (not founded) has a pretender, quieted by a pension or broken by a cloister', () => {
        const { world, player, k } = crowned();
        const f = CrownSuccession.forecast(player, world);
        const line = f.claimants.find(c => c.kind === 'pretender');
        expect(line).toBeTruthy();
        expect(line.parts[0].value).toBe(38);
        const gold = player.gold;
        expect(CrownSuccession.pensionOldLine(player, world).success).toBe(true);
        expect(player.gold).toBe(gold - 500);
        const quiet = CrownSuccession.forecast(player, world).claimants.find(c => c.kind === 'pretender');
        expect(!quiet || quiet.strength < line.strength).toBe(true);
        expect(CrownSuccession.cloisterOldLine(player, world).success).toBe(true);
        expect(CrownSuccession.forecast(player, world).claimants.find(c => c.kind === 'pretender')).toBeFalsy();
        expect(CrownSuccession.oldLine(player, world, k)).toBe(null);
    }, 60000);
});

describe('Save and the wait', () => {
    it('rides with the player in the save, and is player-held in the interregnum', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('crownSuccession');
        expect(Object.keys(Afterlife.worldDaySkipped())).toContain('CrownSuccession');
        const { world, player } = crowned();
        CrownSuccession.state(player).history.push({ id: 'x', day: 1, text: 'a record' });
        const copy = JSON.parse(JSON.stringify(CrownSuccession.serialize(player)));
        const p2 = { crownSuccession: copy };
        CrownSuccession.loadState(p2);
        expect(p2.crownSuccession.history[0].text).toBe('a record');
        expect(CrownSuccession.processDay(world, null).notices).toEqual([]);
    }, 60000);
});
