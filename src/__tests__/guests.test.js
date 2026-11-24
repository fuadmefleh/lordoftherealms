// Being welcome as a guest (player/guests.js): the houses that take you in
// unasked (your parents', your kin's, a friend's), asking a stranger or a lord
// for a visit, a meal or a night, the welcome kept on player.guestAt as the
// furniture menu reads it and running out after the night, the meal out of
// the household's own larder (systems/townTrade.js serveGuest), and the
// welcome saved with the player.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Guests } from '../player/guests.js';
import { FurnitureActions } from '../player/furnitureActions.js';
import { Relationships } from '../systems/relationships.js';
import { TownTrade } from '../systems/townTrade.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const folk = { q: 7, r: 4, people: [], n: 0 };
const person = (id, extra = {}) => ({ id, first: `P${id}`, last: 'Reed', gender: 'female', born: -9000, died: null, role: 'villager', spouse: null, parents: [], kids: [], away: null, log: [], ...extra });
const world = (day = 100) => ({ day });
const player = (extra = {}) => {
    const needs = {};
    return { relationships: {}, renown: 0, title: 'Nobody', needs, modifyNeed(k, v) { needs[k] = (needs[k] || 0) + v; }, ...extra };
};
/** A relationship NPC bridged to p, with the player's regard. */
function bridge(pl, p, score, family = null) {
    const npc = { id: `rnpc_t${p.id}_${Math.floor(Utils.random() * 1e6)}`, folkUid: Relationships.folkUid(folk, p), firstName: p.first, isAlive: true };
    Relationships._npcs.push(npc);
    pl.relationships[npc.id] = { score, history: [], ...(family ? { family } : {}) };
    if (family) npc.kin = family;
    return npc;
}
const house = { type: 'house', name: 'Reed Cottage', q: 3, r: 5 };
const KEY = Guests.key(7, 4, house);

beforeEach(() => { Relationships._npcs = Relationships._npcs || []; });

describe('who takes you in unasked', () => {
    it('your parents (Born to a Family), unless they disowned you', () => {
        const mum = person(1), dad = person(2, { gender: 'male' });
        const pl = player({ parentage: { active: true, folk: { q: 7, r: 4, f: 2, m: 1 }, ended: null, disinherited: false } });
        const res = [{ name: 'Mum', _person: mum, _folk: folk }, { name: 'Dad', _person: dad, _folk: folk }];
        expect(Guests.welcomeIn(pl, world(), res)).toMatchObject({ ok: true, kind: 'parents' });
        pl.parentage.ended = { day: 90, how: 'disowned' };
        expect(Guests.welcomeIn(pl, world(), res).ok).toBe(false);
    });

    it('kin (a family tie) unless estranged; friends by regard or the street\'s good opinion', () => {
        const pl = player();
        const sis = person(10), pal = person(11), stranger = person(12), fan = person(13, { mem: { disposition: 85 } });
        bridge(pl, sis, 5, 'sibling');
        bridge(pl, pal, 55);
        bridge(pl, stranger, 10);
        expect(Guests.standingWith(pl, world(), folk, sis).kind).toBe('kin');
        expect(Guests.standingWith(pl, world(), folk, pal).kind).toBe('friend');
        expect(Guests.standingWith(pl, world(), folk, stranger).kind).toBeNull();
        expect(Guests.standingWith(pl, world(), folk, fan).kind).toBe('friend');
        // a kinsman you've fallen out with badly shuts the door
        const brother = person(14);
        bridge(pl, brother, -60, 'sibling');
        expect(Guests.standingWith(pl, world(), folk, brother).kind).toBeNull();
        // the best welcome in the house wins
        const w = Guests.welcomeIn(pl, world(), [{ _person: stranger, _folk: folk }, { _person: pal, _folk: folk }, { _person: sis, _folk: folk }]);
        expect(w).toMatchObject({ ok: true, kind: 'kin' });
    });

    it('a prince or princess is at home in the royal parents\' seat', () => {
        const pl = player({ parentage: { active: true, royal: { kid: 1 }, home: { q: 2, r: 2 }, ended: null } });
        const castle = { type: 'castle', q: 9, r: 9 };
        expect(Guests.welcomeIn(pl, world(), [], { building: castle, worldQ: 2, worldR: 2 }).kind).toBe('parents');
        expect(Guests.welcomeIn(pl, world(), [], { building: castle, worldQ: 3, worldR: 2 }).ok).toBe(false);
    });
});

describe('asking', () => {
    it('a stranger says yes by their regard: certain, never, or a seeded roll between', () => {
        const pl = player();
        const p = person(20);
        expect(Guests.hostChance(pl, { disposition: 90 })).toBe(1);
        expect(Guests.hostChance(pl, { disposition: 30 })).toBe(0);
        const mid = Guests.hostChance(pl, { disposition: 64 });
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(1);
        expect(Guests.ask(pl, world(), 'stay', { p, folk, key: KEY, disposition: 30 }).ok).toBe(false);
        // the roll is the seeded stream's: the same seed, the same answer
        Utils.setSeed(4242);
        const a = Guests.willHost(pl, world(), { disposition: 64 }).yes;
        Utils.setSeed(4242);
        expect(Guests.willHost(pl, world(), { disposition: 64 }).yes).toBe(a);
    });

    it('a night\'s stay is kept on player.guestAt as the furniture menu reads it, and runs out', () => {
        const pl = player();
        const p = person(21);
        const r = Guests.ask(pl, world(100), 'stay', { p, folk, key: KEY, disposition: 90, name: 'Ada' });
        expect(r.ok).toBe(true);
        // (the key ui/objectActions/furniture.js builds: `${worldQ},${worldR}|${type}@${q},${r}`)
        expect(pl.guestAt).toContain('7,4|house@3,5');
        expect(pl.guestStays[KEY]).toMatchObject({ host: 'Ada', kind: 'stay', until: 100 });
        expect(Guests.sleepsAt(pl, world(100), KEY)).toBe(true);
        expect(Guests.mayStay(pl, world(100), { key: KEY }).ok).toBe(true);
        // the bed is the household's guest bed, not a trespass
        const ctx = { building: house, permitted: Guests.mayStay(pl, world(100), { key: KEY }).ok, player: pl, world: world(100) };
        expect(FurnitureActions.bedAccess(ctx).mode).toBe('permitted');
        expect(FurnitureActions.check('sleep', ctx).ok).toBe(true);
        // the next night it's gone again
        expect(Guests.sleepsAt(pl, world(102), KEY)).toBe(false);
        expect(pl.guestAt).not.toContain(KEY);
        expect(FurnitureActions.bedAccess({ ...ctx, permitted: Guests.mayStay(pl, world(102), { key: KEY }).ok }).mode).toBe('trespass');
    });

    it('a visit is company and goodwill, but not a bed; a stay outlasts a later visit', () => {
        const pl = player();
        const p = person(22);
        const v = Guests.ask(pl, world(), 'visit', { p, folk, key: KEY, disposition: 90, atHome: true, name: 'Ada' });
        expect(v.ok).toBe(true);
        expect(v.hours).toBeGreaterThan(0);
        expect(pl.needs.social).toBeGreaterThan(0);
        expect(Guests.sleepsAt(pl, world(), KEY)).toBe(false);
        Guests.ask(pl, world(), 'stay', { p, folk, key: KEY, disposition: 90 });
        Guests.ask(pl, world(), 'visit', { p, folk, key: KEY, disposition: 90 });
        expect(Guests.sleepsAt(pl, world(), KEY)).toBe(true);
    });

    it('kin need not be asked, and say so', () => {
        const pl = player();
        const cousin = person(23);
        bridge(pl, cousin, 0, 'cousin');
        const r = Guests.ask(pl, world(), 'stay', { p: cousin, folk, key: KEY, disposition: 20 });
        expect(r.ok).toBe(true);
        expect(r.text).toBe(Guests.cfg().lines.kin);
    });

    it('a lord takes in a guest of standing, not a nobody', () => {
        const seat = { type: 'manor', q: 1, r: 1 };
        const key = Guests.key(7, 4, seat);
        expect(Guests.ask(player(), world(), 'stay', { key, disposition: 50, lord: true }).ok).toBe(false);
        const knight = player({ title: 'Knight', renown: 80 });
        const r = Guests.ask(knight, world(), 'stay', { key, disposition: 50, lord: true, name: 'Lord Ash' });
        expect(r.ok).toBe(true);
        expect(r.text).toContain('Lord Ash');
        expect(Guests.sleepsAt(knight, world(), key)).toBe(true);
    });

    it('no house of theirs here: nothing to ask into', () => {
        expect(Guests.ask(player(), world(), 'stay', { p: person(24), folk, key: null, disposition: 99 }).ok).toBe(false);
    });
});

describe('a meal at their table', () => {
    it('comes out of the household\'s own larder, booked as eaten', () => {
        const day = 100;
        const p = person(30, { born: day - 30 * Townsfolk.config().daysPerYear });
        const s = { name: 'Oakby', population: 400, folk: { q: 7, r: 4, people: [p], n: 31 } };
        const st = TownTrade.state(s, day);
        const key = TownTrade.hhKey(s.folk, p, day);
        const food = TownTrade.rates(s).find(r => r.group === 'food');
        expect(food).toBeTruthy();
        st.hh[key] = { l: { [food.g]: 3 }, since: day };
        const pl = player();
        const r = Guests.ask(pl, world(day), 'meal', { p, folk: s.folk, key: KEY, disposition: 90, atHome: true, settlement: s });
        expect(r.ok).toBe(true);
        expect(r.served.units).toBeCloseTo(Guests.cfg().meal.portion, 5);
        expect(st.hh[key].l[food.g]).toBeCloseTo(3 - Guests.cfg().meal.portion, 5);
        expect(pl.needs.hunger).toBe(Guests.cfg().meal.effects.hunger);
        // a bare larder shares what it has: the thin meal
        st.hh[key].l = {};
        const pl2 = player();
        const thin = Guests.ask(pl2, world(day), 'meal', { p, folk: s.folk, key: KEY, disposition: 90, atHome: true, settlement: s });
        expect(thin.ok).toBe(true);
        expect(thin.served.units).toBe(0);
        expect(pl2.needs.hunger).toBe(Guests.cfg().meal.thin.hunger);
    });
});

describe('saved with the player', () => {
    it('guestAt and guestStays travel in the save', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('guestAt');
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('guestStays');
        const pl = player();
        Guests.invite(pl, world(5), KEY, { host: 'Ada', kind: 'stay' });
        const picked = SaveLoad._pickDefined(pl, SaveLoad.EXTRA_PLAYER_FIELDS);
        const back = JSON.parse(JSON.stringify(picked));
        expect(back.guestAt).toEqual([KEY]);
        expect(back.guestStays[KEY]).toMatchObject({ host: 'Ada', until: 5 });
        expect(Guests.sleepsAt(back, world(5), KEY)).toBe(true);
    });
});
