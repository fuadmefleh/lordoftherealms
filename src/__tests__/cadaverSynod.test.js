// Putting a dead enemy on trial (systems/cadaverSynod.js): the dead lie in
// tombs (AI kings at their capitals, rival House heads at their seats); a
// ruler whose realm holds the town digs one up and tries him. His heirs' rule
// is called into question (stability, regard, a claim, a tainted succession),
// a rival House is shamed, the old line of your own realm declared bastard;
// the faith is outraged. Hard AI crowns do it too.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Upbringing } from '../systems/upbringing.js';
import { CrownSuccession } from '../systems/crownSuccession.js';
import { CadaverSynod } from '../systems/cadaverSynod.js';
import { loadData, newGame } from './playtest/harness.js';

let base = null;
beforeAll(async () => {
    await loadData();
    base = JSON.parse(JSON.stringify(DataLoader._gamedata.cadaverSynod));
});
beforeEach(() => {
    DataLoader._gamedata.cadaverSynod = JSON.parse(JSON.stringify(base));
});

function biggest(world) {
    const all = world.getAllSettlements();
    const count = k => all.filter(s => s.kingdom === k.id).length;
    return world.kingdoms.filter(k => k.isAlive).sort((a, b) => count(b) - count(a))[0];
}

function crowned(seed = 31) {
    const game = newGame(seed);
    const { world, player } = game;
    world.day = 2400;
    const k = biggest(world);
    Throne._takeThrone(player, world, k);
    k.treasury = 5000;
    k.stability = 60;
    Kingship.processDay(world, player);
    const town = world.getSettlementViews().find(s => s.kingdom === k.id && !(s.q === k.capital.q && s.r === k.capital.r));
    const other = world.kingdoms.find(x => x.isAlive && x.id !== k.id && x.characterData && x.characterData.dynasty);
    return { game, world, player, k, town, other };
}

describe('Data (data/cadaverSynod.json)', () => {
    it('is registered and merges over the defaults; the claim source is known to the Throne', () => {
        expect(DataLoader._gamedata.cadaverSynod).toBeTruthy();
        expect(CadaverSynod.config().cost).toBe(300);
        expect(CadaverSynod.config().sentences.river.scale).toBe(1);
        expect(Throne.sourceInfo('annulled').label).toMatch(/annulled/);
    });
});

describe('The tombs', () => {
    it('every AI king who dies is laid in a tomb at his capital, once', () => {
        const k = { id: 'k1', name: 'Arnor', isAlive: true, capital: { q: 2, r: 3 }, characterData: { dynasty: { name: 'Elend' } }, lastSuccession: { day: 90, oldRulerName: 'King Elros', heirName: 'Elrond Elend', type: 'heir' } };
        const town = { name: 'Annuminas', q: 2, r: 3, kingdom: 'k1' };
        const world = { day: 100, generationParams: { seed: 3 }, kingdoms: [k], getKingdom: () => k, getTile: (q, r) => (q === 2 && r === 3 ? { settlement: town } : null) };
        CadaverSynod.processDay(world, null);
        CadaverSynod.processDay(world, null);
        const t = CadaverSynod.state(world).tombs;
        expect(t).toHaveLength(1);
        expect(t[0]).toMatchObject({ kind: 'king', name: 'King Elros', dynasty: 'Elend', town: 'Annuminas', heir: 'Elrond Elend', died: 90 });
    });
});

describe('A synod of the bishops', () => {
    it('only a crown, and only where its realm holds the tomb', () => {
        const { world, player, k, town, other } = crowned();
        const far = world.getAllSettlements().find(s => s.kingdom === other.id);
        const near = CadaverSynod.bury(world, { kind: 'king', name: 'King Ugo', dynasty: _dyn(other), kingdomId: other.id, q: town.q, r: town.r, town: town.name, day: 100 });
        const beyond = CadaverSynod.bury(world, { kind: 'king', name: 'King Vash', dynasty: _dyn(other), kingdomId: other.id, q: far.q, r: far.r, town: far.name, day: 100 });
        expect(CadaverSynod.canTry(player, world, near.id).ok).toBe(true);
        expect(CadaverSynod.canTry(player, world, beyond.id).ok).toBe(false);
        k.treasury = 10;
        expect(CadaverSynod.canTry(player, world, near.id).reason).toMatch(/treasury/);
        player.throne.ruling = null;
        expect(CadaverSynod.canTry(player, world, near.id).reason).toMatch(/crown/);
    }, 60000);

    it('a king whose line still rules: his acts void, his heir\'s realm shaken, a claim for you, the faith outraged', () => {
        const { world, player, k, town, other } = crowned();
        const t = CadaverSynod.bury(world, { kind: 'king', name: 'King Ugo', dynasty: _dyn(other), kingdomId: other.id, q: town.q, r: town.r, town: town.name, day: 100, faith: other.religion });
        const stab = other.stability = 60;
        if (!other.relations) other.relations = {};
        other.relations[k.id] = 0;
        const treasury = k.treasury;
        const purse = town.economy ? town.economy.gold : null;
        player.karma = 0;
        const res = CadaverSynod.hold(player, world, t.id, 'river');
        expect(res.success).toBe(true);
        expect(res.text).toMatch(/fingers/);
        expect(k.treasury).toBe(treasury - 300);
        if (purse != null) expect(town.economy.gold).toBeGreaterThan(purse);
        expect(player.inventory.grave_goods).toBe(3);
        expect(other.stability).toBe(stab - 12);
        expect(other.relations[k.id]).toBeLessThanOrEqual(-40);
        expect(Throne.claimStrength(player, other.id)).toBeGreaterThanOrEqual(15);
        expect(other.synodTaint.until).toBeGreaterThan(world.day);
        expect(CadaverSynod.crisisMult(world, other)).toBe(2);
        expect(player.karma).toBe(-15);
        expect(t.tried.sentence).toBe('river');
        expect(CadaverSynod.hold(player, world, t.id, 'river').success).toBe(false);
        expect(player.house.history.some(h => /synod/.test(h.text))).toBe(true);
    }, 60000);

    it('unhallowed ground: half of it, and no goods', () => {
        const { world, player, town, other } = crowned();
        const t = CadaverSynod.bury(world, { kind: 'king', name: 'King Ugo', dynasty: _dyn(other), kingdomId: other.id, q: town.q, r: town.r, town: town.name, day: 100 });
        other.stability = 60;
        player.karma = 0;
        expect(CadaverSynod.hold(player, world, t.id, 'unhallowed').success).toBe(true);
        expect(other.stability).toBe(54);
        expect(player.karma).toBe(-7.5);
        expect(player.inventory && player.inventory.grave_goods).toBeFalsy();
    }, 60000);

    it('a king of the old line of your own realm: its pretender\'s blood declared bastard', () => {
        const { world, player, k, town } = crowned();
        const heir = { id: 'cs_h', firstName: 'Ada', dynasty: 'Harness', gender: 'female', age: 30, isAlive: true, traits: [], skills: {}, health: 100, maxHealth: 100 };
        Upbringing.ensure(heir);
        player.children = [heir];
        player.heir = heir.id;
        const pretender = () => (CrownSuccession.forecast(player, world).claimants.find(c => c.kind === 'pretender') || { strength: 0 }).strength;
        const before = pretender();
        expect(before).toBeGreaterThan(0);
        const t = CadaverSynod.bury(world, { kind: 'king', name: 'King Old', dynasty: _dyn(k), kingdomId: k.id, q: town.q, r: town.r, town: town.name, day: 100 });
        expect(CadaverSynod.forecast(player, world, t.id).own).toBe(true);
        CadaverSynod.hold(player, world, t.id, 'river');
        expect(CadaverSynod.annulled(world, k.id, _dyn(k))).toBe(true);
        expect(pretender()).toBeLessThan(before);
    }, 60000);

    it('a rival House head: the House shamed at every court, its feud hotter, a nemesis', () => {
        const { world, player, town, other } = crowned();
        player.house.rivals[other.id] = { kingdomId: other.id, name: `House ${_dyn(other)}`, feud: 10, standing: { [other.id]: 40 }, lastActedDay: 0 };
        const rival = player.house.rivals[other.id];
        const t = CadaverSynod.bury(world, { kind: 'lord', name: 'Lord Ugo', dynasty: _dyn(other), house: rival.name, kingdomId: other.id, q: town.q, r: town.r, town: town.name, day: 100 });
        expect(CadaverSynod.forecast(player, world, t.id).rival).toBe(rival.name);
        CadaverSynod.hold(player, world, t.id, 'river');
        expect(rival.feud).toBeGreaterThan(10);
        expect(rival.standing[other.id]).toBe(20);
        expect(rival.memory.some(m => m.kind === 'desecrated')).toBe(true);
        expect((player.nemesis && player.nemesis.grudges || []).some(g => g.deed.key === 'synod')).toBe(true);
    }, 60000);
});

describe('AI crowns', () => {
    it('a cruel crown that holds an enemy king\'s tomb tries him, without drawing the shared dice', () => {
        const dead = { id: 'k1', name: 'Arnor', isAlive: true, stability: 50, relations: { k2: -70 }, characterData: { dynasty: { name: 'Elend' }, ruler: { traits: [] } } };
        const holder = { id: 'k2', name: 'Angmar', ruler: 'King Witch', isAlive: true, stability: 50, relations: { k1: -70 }, characterData: { dynasty: { name: 'Dark' }, ruler: { traits: [{ id: 'cruel' }] } } };
        const town = { name: 'Fornost', q: 4, r: 4, kingdom: 'k2' };
        const world = { day: 360 * 5 + 200, generationParams: { seed: 1 }, kingdoms: [dead, holder], events: [], getKingdom: id => (id === 'k1' ? dead : id === 'k2' ? holder : null), getTile: (q, r) => (q === 4 && r === 4 ? { settlement: town } : null) };
        DataLoader._gamedata.cadaverSynod.ai = { ...base.ai, yearly: 1 };
        const t = CadaverSynod.bury(world, { kind: 'king', name: 'King Arvedui', dynasty: 'Elend', kingdomId: 'k1', q: 4, r: 4, town: 'Fornost', day: 100 });
        Utils.setSeed(4);
        CadaverSynod.processDay(world, null);
        const a = Utils.random();
        Utils.setSeed(4);
        expect(Utils.random()).toBe(a);
        expect(t.tried.ai).toBe(true);
        expect(dead.stability).toBe(38);
        expect(dead.synodTaint.by).toBe('k2');
        expect(world.events.some(e => /synod/.test(e.text))).toBe(true);
    });
});

function _dyn(k) {
    return k.characterData && k.characterData.dynasty && k.characterData.dynasty.name;
}
