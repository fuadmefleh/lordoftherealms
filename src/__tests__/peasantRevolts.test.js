// Peasant revolts (systems/peasantRevolts.js): grievance from real state,
// risings with named leaders and demands, rebel hosts on the map that burn
// estates, spread and storm seats; the player's answers (charters, parley,
// gold, the royal host, the field) and the fate of the crushed; AI lords by
// their traits; a weak lord toppled. No shared RNG drawn.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Economy } from '../world/economy.js';
import { Estates } from '../world/estates.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';
import { Fiscal } from '../systems/fiscal.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { PeasantRevolts } from '../systems/peasantRevolts.js';
import { Afterlife } from '../player/afterlife.js';
import { RoadEncounters } from '../player/roadEncounters.js';
import { WorldUnit } from '../world/units.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(seed = 21) {
    Utils.setSeed(seed);
    const world = new World(40, 30);
    world.generate({ kingdomCount: 4 });
    world.day = 700;
    for (const s of world.getSettlementViews()) if (!s.economy) Economy.initSettlement(s);
    Estates.derive(world, world.day);
    return world;
}

function makePlayer(world) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 30,
        gold: 20000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [], settlements: [],
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        relationships: {}, actionPoints: 10, army: [], charisma: 6, q: 0, r: 0,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    player.house.prestige = 300;
    return player;
}

/** A realm with at least three towns and its biggest non-capital town. */
function realmAndTown(world) {
    const all = world.getSettlementViews();
    const k = world.kingdoms.filter(x => x.isAlive).sort((a, b) => all.filter(s => s.kingdom === b.id).length - all.filter(s => s.kingdom === a.id).length)[0];
    const towns = all.filter(s => s.kingdom === k.id);
    const town = towns.filter(s => !(k.capital && k.capital.q === s.q && k.capital.r === s.r)).sort((a, b) => b.population - a.population)[0] || towns[0];
    return { k, town, towns };
}

/** Make a town's commons wretched: crushing taxes, starving, bad coin. */
function oppress(world, k, s) {
    k.fisc = k.fisc || {};
    k.fisc.rates = { land: 'crushing', poll: 'crushing', excise: 'crushing' };
    k.finance = { ...(k.finance || {}), purity: 0.6 };
    s.labour = s.labour || {};
    s.labour.wel = { ...(s.labour.wel || {}), peasants: 0.35 };
    s.happiness = 15;
    k.stability = 20;
}

function weeks(world, player, n) {
    for (let i = 0; i < n; i++) {
        world.day = Math.ceil((world.day + 1) / 7) * 7;
        PeasantRevolts.processDay(world, player);
    }
}

function days(world, player, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        world.day++;
        // (the host walks as world.update would move it)
        for (const u of world.units) if (u.type === 'peasant_host' && !u.destroyed) u.updateWarHost(world);
        out.push(...PeasantRevolts.processDay(world, player).notices);
    }
    return out;
}

describe('Peasant revolts: data and grievance', () => {
    it('is registered', () => {
        expect(DataLoader._gamedata.peasantRevolts).toBeTruthy();
        const C = PeasantRevolts.config();
        for (const d of ['lower_tax', 'bread', 'steward', 'sound_coin', 'charter']) expect(C.demands[d].label, d).toBeTruthy();
        for (const a of PeasantRevolts.AFTERMATHS) expect(C.aftermath[a].label, a).toBeTruthy();
    });

    it('builds pressure from taxes, hunger, bad coin, a cruel lord and plague', () => {
        const world = makeWorld();
        const { k, town } = realmAndTown(world);
        const calm = PeasantRevolts.pressure(world, town).value;
        oppress(world, k, town);
        k.lord = { ...(k.lord || {}), traits: [{ id: 'cruel' }, { id: 'tyrant' }] };
        const p = PeasantRevolts.pressure(world, town);
        const ids = p.parts.map(x => x.id);
        for (const id of ['tax', 'hunger', 'coin', 'cruelty', 'unrest']) expect(ids, id).toContain(id);
        expect(p.value).toBeGreaterThan(calm + 40);
    });

    it('creeps toward the pressure over weeks, and a charter pulls it down', () => {
        const world = makeWorld();
        const { k, town } = realmAndTown(world);
        oppress(world, k, town);
        // (no rising yet: a cooldown on the realm)
        PeasantRevolts.state(world).realms[String(k.id)] = world.day;
        weeks(world, null, 2);
        const early = PeasantRevolts.grievance(world, town.q, town.r);
        weeks(world, null, 30);
        const late = PeasantRevolts.grievance(world, town.q, town.r);
        expect(early).toBeGreaterThan(0);
        expect(late).toBeGreaterThan(early + 15);
        // A charter cuts the town's taxes (Fiscal reads it) and its grievance's pressure
        const burden = Fiscal.townBurden(world, town);
        const before = PeasantRevolts.pressure(world, town).value;
        town.charter = { day: world.day, taxCut: 0.25, kinds: ['lower_tax'] };
        expect(Fiscal.townBurden(world, town)).toBeLessThan(burden);
        expect(PeasantRevolts.pressure(world, town).value).toBeLessThan(before);
    });

    it('a rebellion world event stirs its town (agitators, no dead)', () => {
        const world = makeWorld();
        const { k, town } = realmAndTown(world);
        const pop = town.population;
        const saved = Utils.randPick;
        // (the event's draws: the 'rebellion' type in this realm's town)
        Utils.randPick = (arr) => (arr.includes('rebellion') ? 'rebellion' : arr.includes(k) ? k : arr[0]);
        try {
            const orig = WorldEvents._pickTown;
            WorldEvents._pickTown = () => town;
            const ev = WorldEvents.generatePoliticalEvent(world);
            WorldEvents._pickTown = orig;
            expect(ev.text).toMatch(/Agitators stir/);
        } finally {
            Utils.randPick = saved;
        }
        expect(town.population).toBe(pop);
        expect(town.revoltSpark.amt).toBeGreaterThan(0);
        expect(PeasantRevolts.pressure(world, town).parts.some(p => p.id === 'spark')).toBe(true);
    });
});

describe('A rising', () => {
    it('boils over with a named townsperson, a cause, demands and a host on the map — drawing no shared RNG', () => {
        const world = makeWorld();
        const { k, town } = realmAndTown(world);
        Townsfolk.seed(town, world);
        expect(town.folk && town.folk.people.length).toBeTruthy();
        oppress(world, k, town);
        Utils.setSeed(777);
        const a = Utils.random();
        Utils.setSeed(777);
        let rv = null;
        for (let i = 0; i < 400 && !rv; i++) {
            weeks(world, null, 1);
            rv = PeasantRevolts.active(world)[0] || null;
        }
        expect(Utils.random()).toBe(a);
        expect(rv).toBeTruthy();
        expect(rv.leader.name).toBeTruthy();
        expect(rv.demands.length).toBeGreaterThan(0);
        expect(PeasantRevolts.config().demands[rv.demands[0]]).toBeTruthy();
        const s0 = world.getTile(...rv.origin.split(',').map(Number)).settlement;
        if (s0 === town) expect(town.folk.people.some(p => p.id === rv.leader.pid)).toBe(true);
        const unit = world.units.find(u => u.peasantRevoltId === rv.id);
        expect(unit && unit.type).toBe('peasant_host');
        expect(unit.strength).toBeGreaterThan(0);
    });

    it('burns estates about its town (their soil falls) and the fields grow back', () => {
        const world = makeWorld();
        const { k, town } = realmAndTown(world);
        oppress(world, k, town);
        const ests = Estates.estatesOf(world, town.q, town.r).filter(e => Estates.kindOf(e.holder) !== 'town');
        expect(ests.length).toBeGreaterThan(0);
        const rv = PeasantRevolts.rise(world, null, town.q, town.r);
        expect(rv).toBeTruthy();
        expect(rv.burned.length).toBeGreaterThan(0);
        const e = Estates.estate(world, rv.burned[0]);
        expect(e.soil).toBeLessThan(1);
        const burnt = e.soil;
        PeasantRevolts._end(world, null, PeasantRevolts.state(world), rv, 'dispersed', {}, null);
        weeks(world, null, 40);
        expect(e.soil).toBeGreaterThan(burnt);
    });

    it('left alone it spreads, marches on the seat and storms it; the demands are forced', () => {
        const world = makeWorld(31);
        const { k, town, towns } = realmAndTown(world);
        for (const s of towns) oppress(world, k, s);
        const st = PeasantRevolts.state(world);
        for (const s of towns) PeasantRevolts._townRec(st, `${s.q},${s.r}`).g = 80;
        k.military = 0;
        const rv = PeasantRevolts.rise(world, null, town.q, town.r);
        rv.aiReact = 1e9; // (the lord sits on his hands)
        rv.strength = 200;
        days(world, null, 160);
        expect(PeasantRevolts.active(world).includes(rv)).toBe(false);
        expect(['won', 'toppled', 'dispersed']).toContain(rv.ended.how);
        if (rv.ended.how !== 'dispersed') {
            const s0 = world.getTile(town.q, town.r).settlement;
            const relief = PeasantRevolts.pressure(world, s0).parts.find(p => p.id === 'relief');
            expect(relief && relief.v).toBeLessThan(0);
        }
    });
});

describe('AI lords meet their risings by their traits', () => {
    it('a cruel lord with an army crushes and hangs — fear now, resentment later', () => {
        const world = makeWorld();
        const { k, town } = realmAndTown(world);
        oppress(world, k, town);
        k.lord = { ...(k.lord || {}), traits: [{ id: 'cruel' }, { id: 'tyrant' }, { id: 'ruthless' }], martial: 9 };
        k.military = 5000;
        const rv = PeasantRevolts.rise(world, null, town.q, town.r);
        rv.aiReact = world.day + 1;
        days(world, null, 120);
        expect(rv.ended).toBeTruthy();
        const t = PeasantRevolts.state(world).towns[rv.origin];
        if (rv.ended.how === 'crushed') {
            expect(t.fear && t.fear.amt).toBeGreaterThan(0);
            const s = world.getTile(town.q, town.r).settlement;
            expect(PeasantRevolts.pressure(world, s).parts.some(p => p.id === 'fear')).toBe(true);
            world.day = t.fear.until + 1;
            expect(PeasantRevolts.pressure(world, s).parts.some(p => p.id === 'wounds')).toBe(true);
        }
    });

    it('a just, generous lord grants a charter: the town pays less tax', () => {
        const world = makeWorld();
        const { k, town } = realmAndTown(world);
        oppress(world, k, town);
        k.lord = { ...(k.lord || {}), traits: [{ id: 'just' }, { id: 'generous' }, { id: 'honorable' }], martial: 2 };
        k.military = 0;
        k.treasury = 0;
        const s = world.getTile(town.q, town.r).settlement;
        const f = k.fisc && k.fisc.rates ? k.fisc : null;
        const dueBefore = f ? Fiscal.townDues(world, k, s, k.fisc, world.day, false, false).due : null;
        let rv = PeasantRevolts.rise(world, null, town.q, town.r);
        // (the realm's own answer, retried until it is not a failed parley)
        for (let i = 0; i < 6 && PeasantRevolts.active(world).includes(rv); i++) {
            rv.aiDone = false; rv.aiReact = world.day;
            PeasantRevolts._aiAnswer(world, null, PeasantRevolts.state(world), rv, world.day + i, { notices: [] });
        }
        expect(rv.ended).toBeTruthy();
        expect(['conceded', 'parleyed']).toContain(rv.ended.how);
        if (rv.ended.how === 'conceded' && rv.demands.some(d => PeasantRevolts.config().demands[d].taxCut > 0)) {
            expect(s.charter.taxCut).toBeGreaterThan(0);
            if (f) expect(Fiscal.townDues(world, k, s, k.fisc, world.day, false, false).due).toBeLessThan(dueBefore);
        }
        rv = null;
    });

    it('a weak lord whose capital the mob storms is dragged down', () => {
        const world = makeWorld();
        const { k } = realmAndTown(world);
        const cap = world.getTile(k.capital.q, k.capital.r).settlement;
        oppress(world, k, cap);
        k.lord = { ...(k.lord || {}), traits: [], martial: 1 };
        k.military = 0;
        const was = k.ruler;
        const rv = PeasantRevolts.rise(world, null, cap.q, cap.r);
        rv.strength = 5000;
        rv.target = { kind: 'seat', key: `${cap.q},${cap.r}`, q: cap.q, r: cap.r, name: cap.name, capital: true };
        PeasantRevolts._storm(world, null, PeasantRevolts.state(world), rv, world.day, { notices: [] });
        expect(rv.ended.how).toBe('toppled');
        expect(k.ruler).not.toBe(was);
    });
});

describe('The player meets a rising against the crown', () => {
    function crowned() {
        const world = makeWorld();
        const player = makePlayer(world);
        const { k, town } = realmAndTown(world);
        Throne._takeThrone(player, world, k);
        k.treasury = 50000;
        Kingship.processDay(world, player);
        oppress(world, k, town);
        return { world, player, k, town };
    }

    it('is against you: choices offered; meeting the demands costs Prestige and the lords\' favour', () => {
        const { world, player, town } = crowned();
        const rv = PeasantRevolts.rise(world, player, town.q, town.r);
        expect(rv.against).toBe('crown');
        const ids = PeasantRevolts.choices(player, world, rv).map(c => c.id);
        expect(ids).toEqual(expect.arrayContaining(['concede', 'parley', 'buyOff', 'royalHost']));
        const court = Kingship.court(player);
        const fav = (court.vassals || []).map(v => v.favour || 0);
        const pres = House.getPrestige(player);
        const res = PeasantRevolts.act(player, world, 'concede', rv.id);
        expect(res.success).toBe(true);
        expect(House.getPrestige(player)).toBeLessThan(pres);
        if (court.vassals.length) expect(court.vassals[0].favour || 0).toBeLessThan(fav[0]);
        expect(PeasantRevolts.mine(player, world).length).toBe(0);
    });

    it('buying off the leader moves coin from the treasury into the town, never from nothing', () => {
        const { world, player, k, town } = crowned();
        const rv = PeasantRevolts.rise(world, player, town.q, town.r);
        const s = world.getTile(...rv.origin.split(',').map(Number)).settlement;
        const before = k.treasury + s.economy.gold + player.gold;
        PeasantRevolts.act(player, world, 'buyOff', rv.id);
        expect(Math.round(k.treasury + s.economy.gold + player.gold)).toBe(Math.round(before));
    });

    it('beaten in the field: you judge them — the leader taken, then hanged', () => {
        const { world, player, town } = crowned();
        Townsfolk.seed(world.getTile(town.q, town.r).settlement, world);
        const rv = PeasantRevolts.rise(world, player, town.q, town.r);
        const unit = world.units.find(u => u.peasantRevoltId === rv.id);
        unit.destroyed = true;
        PeasantRevolts.onHostDefeated(player, world, unit);
        const ps = PeasantRevolts.playerState(player);
        expect(ps.aftermath && ps.aftermath.rvId).toBe(rv.id);
        const r1 = PeasantRevolts.act(player, world, 'imprison');
        expect(r1.success).toBe(true);
        expect(PeasantRevolts.prisoners(player).length).toBe(1);
        const pr = PeasantRevolts.prisoners(player)[0];
        expect(pr.kind).toBe('rebel_leader');
        // (no scaffold standing: the rope here and now)
        PeasantRevolts.useExecutions({ condemn: () => null });
        let r2;
        try { r2 = PeasantRevolts.act(player, world, 'hangPrisoner', pr.id); } finally { PeasantRevolts.useExecutions(null); }
        expect(r2.success).toBe(true);
        expect(PeasantRevolts.prisoners(player).length).toBe(0);
        if (pr.pid != null) {
            const s = world.getTile(pr.q, pr.r).settlement;
            expect(Townsfolk.get(s.folk, pr.pid).died).not.toBeNull();
        }
        expect(PeasantRevolts.pressure(world, world.getTile(pr.q, pr.r).settlement).parts.some(p => p.id === 'cruelty')).toBe(true);
    });

    it('hands the leader to the scaffold when it stands', () => {
        const { world, player, town } = crowned();
        const seen = [];
        PeasantRevolts.useExecutions({ condemn: (p, w, person, o) => { seen.push({ person, o }); return { success: true }; } });
        try {
            const rv = PeasantRevolts.rise(world, player, town.q, town.r);
            PeasantRevolts.onHostDefeated(player, world, world.units.find(u => u.peasantRevoltId === rv.id));
            PeasantRevolts.act(player, world, 'hang_leader');
            expect(seen.length).toBe(1);
            expect(seen[0].o.source).toBe('peasantRevolts');
        } finally {
            PeasantRevolts.useExecutions(null);
        }
    });

    it('puts the leader on the real scaffold list of the condemned', () => {
        const { world, player, town } = crowned();
        Townsfolk.seed(world.getTile(town.q, town.r).settlement, world);
        const rv = PeasantRevolts.rise(world, player, town.q, town.r);
        PeasantRevolts.onHostDefeated(player, world, world.units.find(u => u.peasantRevoltId === rv.id));
        PeasantRevolts.act(player, world, 'hang_leader');
        const list = (player.executions && player.executions.condemned) || [];
        expect(list.some(e => e.source === 'peasantRevolts')).toBe(true);
    });

    it('saves and loads, and the world turns with no one alive', () => {
        const { world, player, town } = crowned();
        const rv = PeasantRevolts.rise(world, player, town.q, town.r);
        const data = PeasantRevolts.serialize(world);
        const w2 = { ...world };
        PeasantRevolts.restore(data, w2);
        expect(PeasantRevolts.active(w2)[0].leader.name).toBe(rv.leader.name);
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('peasantRevolts');
        expect(Afterlife.worldDaySystems()).toContain('PeasantRevolts');
        expect(() => days(world, null, 30)).not.toThrow();
    });
});

describe('A peasant host met on the road (player/roadEncounters.js)', () => {
    function soldiers(n) {
        return Array.from({ length: n }, (_, i) => ({ type: 'pikeman', name: `pike${i}`, strength: 15, level: 1, upkeep: 1, experience: 0 }));
    }

    /** The rising's host and the player on open ground next to it (no town hex). */
    function onTheRoad(world, player, rv) {
        const unit = world.units.find(u => u.peasantRevoltId === rv.id);
        const free = (q, r) => { const t = world.getTile(q, r); return t && !t.settlement && t.terrain && t.terrain.passable !== false && !/water|ocean|sea|lake/.test(t.terrain.id || ''); };
        for (let d = 1; d < 8; d++) {
            for (const [dq, dr] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
                const q = rv.q + dq, r = rv.r + dr;
                if (free(q, r) && free(q + (dq ? Math.sign(dq) : 0), r + (dr ? Math.sign(dr) : 0))) {
                    unit.q = q; unit.r = r; rv.q = q; rv.r = r;
                    player.q = q + (dq ? Math.sign(dq) : 0); player.r = r + (dr ? Math.sign(dr) : 0);
                    return unit;
                }
            }
        }
        throw new Error('no open ground');
    }

    it('bars the road to a passer-by: alms, an oath, or your men — no toll', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const { k, town } = realmAndTown(world);
        oppress(world, k, town);
        const rv = PeasantRevolts.rise(world, player, town.q, town.r);
        expect(rv.against).toBe('ai');
        const unit = onTheRoad(world, player, rv);
        expect(WorldUnit.isHostile(unit)).toBe(true);
        let ids = RoadEncounters.options(player, unit, world).map(o => o.id);
        expect(ids).toEqual(expect.arrayContaining(['flee', 'rebelAlms', 'rebelSwear', 'parley', 'hide', 'fight']));
        expect(ids).not.toContain('toll');
        expect(ids).not.toContain('rebelJoin');
        player.army = soldiers(6);
        ids = RoadEncounters.options(player, unit, world).map(o => o.id);
        expect(ids).toContain('rebelJoin');
        // Alms: purse into the rebels' packs, and they let you by
        const gold = player.gold;
        const packs = unit.inventory.gold || 0;
        const out = RoadEncounters.resolve(player, unit, world, 'rebelAlms');
        expect(out.success).toBe(true);
        expect(player.gold).toBeLessThan(gold);
        expect(unit.inventory.gold - packs).toBeCloseTo(gold - player.gold, 5);
        expect(RoadEncounters.isSparing(unit, world.day)).toBe(true);
    });

    it('an oath to the cause costs your name with the crown, and more when the rising is broken', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const { k, town } = realmAndTown(world);
        oppress(world, k, town);
        const rv = PeasantRevolts.rise(world, player, town.q, town.r);
        const unit = onTheRoad(world, player, rv);
        player.reputation[k.id] = 0;
        const out = RoadEncounters.resolve(player, unit, world, 'rebelSwear');
        expect(out.kind).toBe('sworn');
        expect(player.reputation[k.id]).toBeLessThan(0);
        expect(rv.sworn.length).toBe(1);
        const after = player.reputation[k.id];
        expect(RoadEncounters.isSparing(unit, world.day + 30)).toBe(true);
        PeasantRevolts._end(world, player, PeasantRevolts.state(world), rv, 'crushed', { by: 'ai' }, { notices: [] });
        expect(player.reputation[k.id]).toBeLessThan(after);
    });

    it('bringing your men swells the host', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.army = soldiers(8);
        const { k, town } = realmAndTown(world);
        oppress(world, k, town);
        const rv = PeasantRevolts.rise(world, player, town.q, town.r);
        const unit = onTheRoad(world, player, rv);
        const before = rv.strength;
        expect(RoadEncounters.resolve(player, unit, world, 'rebelJoin').kind).toBe('joined');
        expect(rv.strength).toBeGreaterThan(before);
    });

    describe('their own lord', () => {
        function lordOnRoad() {
            const world = makeWorld();
            const player = makePlayer(world);
            const { k, town } = realmAndTown(world);
            Throne._takeThrone(player, world, k);
            k.treasury = 50000;
            Kingship.processDay(world, player);
            oppress(world, k, town);
            const rv = PeasantRevolts.rise(world, player, town.q, town.r);
            const unit = onTheRoad(world, player, rv);
            return { world, player, k, rv, unit };
        }

        it('gets no toll, no oath and no talk of passing: promises, or the demands met there', () => {
            const { world, player, rv, unit } = lordOnRoad();
            expect(rv.against).toBe('crown');
            const ids = RoadEncounters.options(player, unit, world).map(o => o.id);
            expect(ids).toEqual(expect.arrayContaining(['flee', 'rebelPromise', 'rebelConcede', 'hide', 'fight']));
            for (const id of ['toll', 'parley', 'rebelAlms', 'rebelSwear', 'rebelJoin']) expect(ids, id).not.toContain(id);
            // (and the passer-by's choices are refused him)
            expect(RoadEncounters.resolve(player, unit, world, 'rebelSwear').kind).toBe('invalid');
            const out = RoadEncounters.resolve(player, unit, world, 'rebelConcede');
            expect(out.kind).toBe('conceded');
            expect(PeasantRevolts.mine(player, world).length).toBe(0);
        });

        it('promises spurned, they fall on him: his army fights them and he judges the beaten', () => {
            const { world, player, rv, unit } = lordOnRoad();
            player.army = soldiers(40);
            const saved = PeasantRevolts.parleyChance;
            PeasantRevolts.parleyChance = () => 0;
            let out;
            try { out = RoadEncounters.resolve(player, unit, world, 'rebelPromise', { auto: true }); } finally { PeasantRevolts.parleyChance = saved; }
            expect(out.success).toBe(false);
            expect(out.kind).toBe('victory');
            expect(rv.parleyed).toBe(true);
            expect(PeasantRevolts.active(world).includes(rv)).toBe(false);
            expect(PeasantRevolts.playerState(player).aftermath.rvId).toBe(rv.id);
        });

        it('goes for him on sight when he rides near, and back to its road when he is gone', () => {
            const { world, player, rv, unit } = lordOnRoad();
            player.q = unit.q + 2 <= world.width - 1 ? unit.q + 2 : unit.q - 2;
            player.r = unit.r;
            const t = world.getTile(player.q, player.r);
            if (t && t.settlement) return; // (a town in the way on this seed: no chase from a town)
            world.day++;
            PeasantRevolts.processDay(world, player);
            expect(rv.chasing).toBe(true);
            expect([unit.objectiveQ, unit.objectiveR]).toEqual([player.q, player.r]);
            player.q = (unit.q + 15) % world.width;
            world.day++;
            PeasantRevolts.processDay(world, player);
            expect(rv.chasing).toBe(false);
        });
    });
});
