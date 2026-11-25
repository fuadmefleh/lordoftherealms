// Wiping a House's name from the world (systems/damnatio.js): a House your
// crown destroyed (the old line of the realm you took, a fallen realm whose old
// seat you hold) can be erased in four acts paid from the treasury — its tombs,
// its chronicles, its towns, its last sons. Its name leaves the Annals and the
// Timeline and its claim ends, unless a survivor remembers and restores it.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { House } from '../systems/house.js';
import { CrownSuccession } from '../systems/crownSuccession.js';
import { CadaverSynod } from '../systems/cadaverSynod.js';
import { Damnatio } from '../systems/damnatio.js';
import { Annals } from '../systems/annals.js';
import { loadData, newGame } from './playtest/harness.js';

let base = null;
beforeAll(async () => {
    await loadData();
    base = JSON.parse(JSON.stringify(DataLoader._gamedata.damnatio));
});
beforeEach(() => {
    DataLoader._gamedata.damnatio = JSON.parse(JSON.stringify(base));
});

function biggest(world) {
    const all = world.getAllSettlements();
    const count = k => all.filter(s => s.kingdom === k.id).length;
    return world.kingdoms.filter(k => k.isAlive).sort((a, b) => count(b) - count(a))[0];
}

/** A player who took a realm's crown from its old line; the line has two sons and a daughter. */
function usurper(seed = 31) {
    const game = newGame(seed);
    const { world, player } = game;
    world.day = 2400;
    const k = biggest(world);
    Throne._takeThrone(player, world, k);
    k.treasury = 20000;
    k.stability = 60;
    Kingship.processDay(world, player);
    const dyn = k.characterData.dynasty.name;
    const data = k.characterData;
    for (const c of data.children || []) c.isAlive = false;
    const sons = [
        { id: 'dm_s1', firstName: 'Aldred', dynasty: dyn, gender: 'male', age: 22, isAlive: true, traits: [] },
        { id: 'dm_s2', firstName: 'Osric', dynasty: dyn, gender: 'male', age: 9, isAlive: true, traits: [] },
    ];
    const daughter = { id: 'dm_d1', firstName: 'Hild', dynasty: dyn, gender: 'female', age: 17, isAlive: true, traits: [] };
    data.children = [...sons, daughter];
    const town = world.getSettlementViews().find(s => s.kingdom === k.id && !(s.q === k.capital.q && s.r === k.capital.r));
    town.name = `${dyn}ford`;
    return { game, world, player, k, dyn, sons, daughter, town };
}

describe('Data (data/damnatio.json)', () => {
    it('is registered with its four acts', () => {
        expect(DataLoader._gamedata.damnatio).toBeTruthy();
        expect(Object.keys(Damnatio.config().acts)).toEqual(['tombs', 'chronicles', 'towns', 'sons']);
        expect(Damnatio.config().acts.tombs.gold).toBe(250);
    });
});

describe('The old line of the realm you took', () => {
    it('is a House you may wipe out; a ruler of no realm may not', () => {
        const { world, player, k, dyn } = usurper();
        const c = Damnatio.candidates(player, world);
        expect(c.map(x => x.key)).toContain(`line:${k.id}`);
        expect(c.find(x => x.key === `line:${k.id}`).dynasty).toBe(dyn);
        player.throne.ruling = null;
        expect(Damnatio.candidates(player, world)).toEqual([]);
    }, 60000);

    it('four acts erase it: tombs, chronicles, towns, sons — the Annals forget it, its claim ends, a daughter remembers', () => {
        const { world, player, k, dyn, sons, daughter, town } = usurper();
        const key = `line:${k.id}`;
        House._chronicle(player.house, world, `Feasted with the envoys of House ${dyn} at the old palace.`, ['court']);
        const tomb = CadaverSynod.bury(world, { kind: 'king', name: 'King Old', dynasty: dyn, kingdomId: k.id, q: town.q, r: town.r, town: town.name, day: 100 });
        const treasury = k.treasury;
        const karma = player.karma = 0;
        // Tombs
        expect(Damnatio.act(player, world, key, 'tombs').success).toBe(true);
        expect(tomb.defaced).toBe(world.day);
        expect(CadaverSynod.canTry(player, world, tomb.id).ok).toBe(false);
        expect(k.treasury).toBe(treasury - 250);
        expect(player.karma).toBeLessThan(karma);
        expect(Damnatio.act(player, world, key, 'tombs').success).toBe(false);
        // Chronicles: the name is struck from the record
        expect(Damnatio.hides(world, `House ${dyn} feasted`)).toBe(false);
        expect(Damnatio.act(player, world, key, 'chronicles').success).toBe(true);
        expect(Damnatio.hides(world, `Feasted with the envoys of House ${dyn}`)).toBe(true);
        expect(Damnatio.hides(world, 'A quiet year in the hills.')).toBe(false);
        const book = JSON.stringify(Annals.compose(player, world));
        expect(book.includes(`envoys of House ${dyn}`)).toBe(false);
        // Towns
        const old = town.name;
        expect(Damnatio.act(player, world, key, 'towns').success).toBe(true);
        expect(town.name).not.toBe(old);
        expect(town.foundingName).toBe(old);
        expect(Damnatio.record(world, key).renamed.some(r => r.from === old)).toBe(true);
        // Sons
        expect(CrownSuccession.oldLine(player, world, k)).toBeTruthy();
        const res = Damnatio.act(player, world, key, 'sons', { how: 'kill' }, () => 0.99);
        expect(res.success).toBe(true);
        expect(sons.every(s => !s.isAlive)).toBe(true);
        expect(daughter.isAlive).toBe(true);
        expect(Damnatio.lineEnded(world, k.id)).toBe(true);
        expect(CrownSuccession.oldLine(player, world, k)).toBe(null);
        // Erased: but the daughter remembers
        const rec = Damnatio.record(world, key);
        expect(rec.erased).toBeTruthy();
        expect(res.erased).toBe(true);
        expect(rec.rememberer.kind).toBe('daughter');
        expect(rec.rememberer.charId).toBe(daughter.id);
    }, 60000);

    it('the one who remembers restores the name in time: the record and the claim return', () => {
        const { world, player, k, dyn } = usurper();
        const key = `line:${k.id}`;
        for (const a of ['tombs', 'chronicles', 'towns']) Damnatio.act(player, world, key, a);
        Damnatio.act(player, world, key, 'sons', { how: 'geld' }, () => 0.99);
        const rec = Damnatio.record(world, key);
        expect(rec.rememberer.kind).toBe('son');
        expect(rec.sons.every(s => s.how === 'geld')).toBe(true);
        rec.rememberer.restoreDay = world.day;
        while (world.day % 360 !== 269) world.day++;
        world.day++;
        const out = Damnatio.processDay(world, player);
        expect(rec.restored).toBeTruthy();
        expect(out.notices.some(x => x.title === 'A Name Restored')).toBe(true);
        expect(Damnatio.hides(world, `House ${dyn}`)).toBe(false);
        expect(Damnatio.lineEnded(world, k.id)).toBe(false);
        expect((player.nemesis.grudges || []).some(g => g.deed.key === 'damnatio')).toBe(true);
    }, 60000);

    it('silence the one who remembers, and the name dies with them', () => {
        const { world, player, k, daughter } = usurper();
        const key = `line:${k.id}`;
        for (const a of ['tombs', 'chronicles', 'towns']) Damnatio.act(player, world, key, a);
        Damnatio.act(player, world, key, 'sons', { how: 'kill' }, () => 0.99);
        player.gold = 1000;
        const res = Damnatio.silence(player, world, key, () => 0);
        expect(res.success).toBe(true);
        expect(daughter.isAlive).toBe(false);
        expect(Damnatio.record(world, key).rememberer).toBe(null);
        expect(player.gold).toBe(800);
    }, 60000);
});

describe('AI conquerors', () => {
    it('a cruel king who holds a fallen realm\'s old capital wipes its dynasty out, on its own stream', () => {
        const fallen = { id: 'k1', name: 'Arnor', isAlive: false, capital: { q: 2, r: 2 }, characterData: { dynasty: { name: 'Elend' }, children: [{ id: 'e1', firstName: 'Arahael', dynasty: 'Elend', gender: 'male', isAlive: true }] } };
        const holder = { id: 'k2', name: 'Angmar', ruler: 'King Witch', isAlive: true, characterData: { dynasty: { name: 'Morgul' }, ruler: { traits: [{ id: 'cruel' }] } } };
        const town = { name: 'Annuminas', q: 2, r: 2, kingdom: 'k2' };
        const world = {
            day: 20, generationParams: { seed: 9 }, kingdoms: [fallen, holder], events: [],
            getKingdom: id => (id === 'k1' ? fallen : id === 'k2' ? holder : null),
            getTile: (q, r) => (q === 2 && r === 2 ? { settlement: town } : null), getSettlementViews: () => [town],
        };
        DataLoader._gamedata.damnatio.ai = { ...base.ai, chance: 1 };
        Utils.setSeed(3);
        Damnatio.processDay(world, null);
        const a = Utils.random();
        Utils.setSeed(3);
        expect(Utils.random()).toBe(a);
        const rec = Damnatio.record(world, 'realm:k1');
        expect(rec.erased).toBeTruthy();
        expect(fallen.characterData.children[0].isAlive).toBe(false);
        expect(town.name).not.toBe('Annuminas');
        expect(town.foundingName).toBe('Annuminas');
        expect(Damnatio.hides(world, 'The kings of House Elend')).toBe(true);
        expect(world.events.some(e => /wiped/.test(e.text))).toBe(true);
    });
});

describe('Saved', () => {
    it('round-trips through serialize/restore', () => {
        const world = { day: 1, kingdoms: [] };
        Damnatio.state(world).houses['realm:x'] = { key: 'realm:x', name: 'House X', dynasty: 'X', steps: { chronicles: { day: 1 } }, restored: null };
        const w2 = { day: 1, kingdoms: [] };
        Damnatio.restoreState(Damnatio.serialize(world), w2);
        expect(Damnatio.hides(w2, 'House X')).toBe(true);
    });
});
