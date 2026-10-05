// Kingship (systems/kingship.js): the royal council, edicts, vassals,
// factions and revolts of a realm the player rules, royal petitions, and the
// kingdom AI's regard for a player-ruled realm.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { House } from '../systems/house.js';
import { Councils } from '../systems/councils.js';
import { Petitions } from '../systems/petitions.js';
import { Sieges } from '../systems/sieges.js';
import { Relationships } from '../systems/relationships.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(seed = 11) {
    Utils.setSeed(seed);
    const world = new World(40, 30);
    world.generate({ kingdomCount: 4 });
    world.day = 100;
    return world;
}

function makePlayer(world, extra = {}) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 30,
        gold: 20000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [],
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        relationships: {}, actionPoints: 10, army: [],
        ...extra,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    player.house.prestige = 300;
    return player;
}

/** The living kingdom with the most settlements. */
function target(world) {
    const all = world.getAllSettlements();
    const count = k => all.filter(s => s.kingdom === k.id).length;
    return world.kingdoms.filter(k => k.isAlive).sort((a, b) => count(b) - count(a))[0];
}

/** A crowned player whose court has opened (vassals sworn). */
function crowned(seed = 11) {
    const world = makeWorld(seed);
    const player = makePlayer(world);
    const k = target(world);
    Throne._takeThrone(player, world, k);
    k.treasury = 5000;
    Kingship.processDay(world, player);
    return { world, player, k, court: Kingship.court(player) };
}

/** The next draw of the RNG after `fn` runs from a fixed seed. */
function drawAfter(fn) {
    Utils.setSeed(4242);
    fn();
    return Utils.random();
}

describe('Kingship data (data/kingship.json)', () => {
    it('is registered and every office, edict and demand is well-formed', () => {
        expect(DataLoader.kingship).toBeTruthy();
        const offices = Kingship.offices();
        for (const o of Kingship.OFFICES) {
            expect(offices[o], o).toBeTruthy();
            expect(Object.keys(offices[o].mods).length, o).toBeGreaterThan(0);
        }
        const keys = new Set([...Object.keys(KingdomBonuses.LABELS)]);
        for (const [id, def] of Object.entries(Kingship.edicts())) {
            expect(def.label, id).toBeTruthy();
            for (const key of Object.keys(def.mods || {})) expect(keys.has(key), `${id} mod ${key}`).toBe(true);
            for (const f of Object.keys(def.factions || {})) expect(Councils.FACTIONS.some(x => x.id === f), `${id} faction ${f}`).toBe(true);
            for (const x of def.excludes || []) expect(Kingship.edicts()[x], `${id} excludes ${x}`).toBeTruthy();
        }
        for (const list of Object.values(Kingship.data().goalDemands)) {
            for (const [type, edict] of list) {
                expect(Kingship.data().demands[type], type).toBeTruthy();
                if (edict) expect(Kingship.edicts()[edict], edict).toBeTruthy();
            }
        }
    });
});

describe('No crown, no court', () => {
    it('draws no randomness and keeps no state while the player rules nothing', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const a = drawAfter(() => {});
        const b = drawAfter(() => Kingship.processDay(world, player));
        expect(b).toBe(a);
        expect(Kingship.court(player)).toBe(null);
        // ...and the kingdom AI's regard for a player realm draws nothing either
        const c = drawAfter(() => { for (const k of world.kingdoms) KingdomAI.considerPlayerRealm(k, world); });
        expect(c).toBe(a);
    });
});

describe('The royal court opens', () => {
    it('the realm\'s lords become vassals with personalities, opinion and power', () => {
        const { world, k, court } = crowned();
        expect(court.initialized).toBe(true);
        expect(court.vassals.length).toBeGreaterThanOrEqual(Kingship.config().minVassals);
        const seats = court.vassals.filter(v => v.seat);
        expect(seats.length).toBeGreaterThan(0);
        for (const v of court.vassals) {
            expect(v.goals.length).toBeGreaterThan(0);
            expect(v.ambition).toBeGreaterThanOrEqual(1);
            expect(Number.isFinite(v.opinion)).toBe(true);
            const p = Kingship.power(world, v, k);
            expect(p).toBeGreaterThan(0);
            expect(p).toBeLessThanOrEqual(100);
        }
        // The capital is the crown's own
        expect(seats.some(v => v.seat.q === k.capital.q && v.seat.r === k.capital.r)).toBe(false);
    });
});

describe('The royal council', () => {
    it('candidates come from vassals, the old court, family and companions; offices feed the realm', () => {
        const { world, player, k } = crowned();
        const child = { id: 'kid1', firstName: 'Bryn', gender: 'female', age: 20, isAlive: true, upbringing: { comeOfAge: true },
            skills: { commerce: 5, combat: 1, leadership: 1, diplomacy: 2, stealth: 1, cartography: 0 }, intelligence: 12 };
        player.children.push(child);
        const cands = Kingship.candidates(player, world, 'steward');
        const kinds = new Set(cands.map(c => c.kind));
        expect(kinds.has('vassal')).toBe(true);
        expect(kinds.has('courtier')).toBe(true);
        expect(kinds.has('family')).toBe(true);
        const kid = cands.find(c => c.id === 'kid1');
        expect(kid.competence).toBe(Math.round(5 * 2 + 12 * 0.4));

        const before = KingdomBonuses.get(k, 'treasury');
        expect(Kingship.appoint(player, world, 'steward', 'family', 'kid1').success).toBe(true);
        expect(k.crown.mods.treasury).toBeGreaterThan(0);
        expect(KingdomBonuses.get(k, 'treasury')).toBeGreaterThan(before);

        // A disloyal steward gives less (and skims)
        const loyal = Kingship.court(player).mods.treasury;
        player.house.roleLoyalty = { kid1: 10 };
        Kingship.refresh(player, world);
        expect(Kingship.court(player).mods.treasury).toBeLessThan(loyal);

        // One office per person; a marshal speeds the army's regrowth
        const lord = Kingship.candidates(player, world, 'marshal').find(c => c.kind === 'vassal');
        expect(Kingship.appoint(player, world, 'marshal', 'vassal', lord.id).success).toBe(true);
        expect(Kingship.appoint(player, world, 'chancellor', 'vassal', lord.id).success).toBe(true);
        expect(Kingship.court(player).council.marshal).toBe(null);
        expect(Kingship.appoint(player, world, 'marshal', 'vassal', lord.id).success).toBe(true);
        expect(KingdomBonuses.get(k, 'militaryRegen')).toBeGreaterThan(0);
        // ...and a lord on the council thinks better of the crown
        const v = Kingship.vassal(player, lord.id);
        expect(Kingship.opinion(player, world, v).parts.some(p => p.label === 'A seat on the council')).toBe(true);
    });

    it('a chancellor improves the odds of peace; a high priest draws the faith together', () => {
        const { world, player, k, court } = crowned();
        const enemy = world.kingdoms.find(o => o !== k && o.isAlive);
        KingdomAI.startWar(k, enemy, world);
        const before = Throne.peaceChance(player, world, enemy.id);
        const best = Kingship.candidates(player, world, 'chancellor')[0];
        Kingship.appoint(player, world, 'chancellor', best.kind, best.id);
        expect(court.peaceChance).toBeGreaterThan(0);
        expect(Throne.peaceChance(player, world, enemy.id)).toBeGreaterThan(before);

        if (!k.religion) k.religion = { piety: 50 };
        k.religion.unity = 30;
        const hp = Kingship.candidates(player, world, 'highPriest').find(c => c.office == null);
        Kingship.appoint(player, world, 'highPriest', hp.kind, hp.id);
        Kingship.processDay(world, player);
        expect(k.religion.unity).toBeGreaterThan(30);
    });

    it('a seat empties when its holder can no longer serve', () => {
        const { world, player, court } = crowned();
        const child = { id: 'kid2', firstName: 'Cai', gender: 'male', age: 18, isAlive: true, upbringing: { comeOfAge: true }, skills: { stealth: 5 } };
        player.children.push(child);
        Kingship.appoint(player, world, 'spymaster', 'family', 'kid2');
        child.isAlive = false;
        const out = Kingship.processDay(world, player);
        expect(court.council.spymaster).toBe(null);
        expect(out.notices.some(n => n.title === 'Council Seat Empty')).toBe(true);
    });
});

describe('Edicts', () => {
    it('cost the treasury to proclaim, feed the bonuses and the council factions, and exclude their opposites', () => {
        const { world, player, k, court } = crowned();
        const commons = Councils._ensureState(player).factions.commons.support;
        const t0 = k.treasury;
        const res = Kingship.passEdict(player, world, 'conscription');
        expect(res.success).toBe(true);
        expect(k.treasury).toBe(t0 - Kingship.edicts().conscription.passCost);
        expect(k.crown.mods.military).toBeGreaterThanOrEqual(Kingship.edicts().conscription.mods.military);
        expect(Councils._ensureState(player).factions.commons.support).toBeLessThan(commons);
        expect(Kingship.passEdict(player, world, 'conscription').success).toBe(false);
        // Scutage excludes conscription
        expect(Kingship.passEdict(player, world, 'scutage').success).toBe(false);
        expect(Kingship.revokeEdict(player, world, 'conscription').success).toBe(true);
        expect(court.edicts.conscription).toBeUndefined();
        expect(Kingship.passEdict(player, world, 'scutage').success).toBe(true);
    });

    it('have daily upkeep, and lapse when the treasury cannot pay', () => {
        const { world, player, k, court } = crowned();
        expect(Kingship.passEdict(player, world, 'famine_dole').success).toBe(true);
        const before = KingdomBonuses.get(k, 'stability');
        expect(before).toBeGreaterThanOrEqual(Kingship.edicts().famine_dole.mods.stability - 0.5);
        const t = k.treasury;
        world.day++;
        Kingship.processDay(world, player);
        expect(k.treasury).toBe(t - Kingship.edicts().famine_dole.upkeep);
        k.treasury = 1;
        world.day++;
        const out = Kingship.processDay(world, player);
        expect(court.edicts.famine_dole).toBeUndefined();
        expect(out.notices.some(n => n.title === 'Edict Lapses')).toBe(true);
    });

    it('persecution unites the faith and sours minorities; vassals weigh edicts by their goals', () => {
        const { world, player, k, court } = crowned();
        if (!k.religion) k.religion = { piety: 50 };
        k.religion.unity = 50;
        const s = Throne._settlementsOf(world, k)[0].settlement;
        s.demographics = [{ tribe: { id: 'a' }, population: 100, sentiment: 50 }, { tribe: { id: 'b' }, population: 20, sentiment: 50 }];
        Kingship.passEdict(player, world, 'persecution');
        const since = player.throne.ruling.since;
        world.day = since + 7 * 10;
        Kingship.processDay(world, player);
        expect(k.religion.unity).toBeGreaterThan(50);
        expect(s.demographics[1].sentiment).toBeLessThan(50);
        expect(s.demographics[0].sentiment).toBe(50);

        const pious = court.vassals[0];
        pious.goals = [{ type: 'faith', priority: 'high' }];
        const trader = court.vassals[1];
        trader.goals = [{ type: 'trade', priority: 'high' }];
        const op = v => Kingship.opinion(player, world, v).parts.find(p => p.label === 'Your edicts');
        expect(op(pious).value).toBeGreaterThan(0);
        expect(op(trader).value).toBeLessThan(0);
    });
});

describe('Vassals: grants, feasts, favours and breaking them', () => {
    it('grants raise favour and power; a heavy levy lowers opinion', () => {
        const { world, player, k, court } = crowned();
        const v = court.vassals[0];
        const p0 = Kingship.power(world, v, k);
        expect(Kingship.grantGold(player, world, v.id).success).toBe(true);
        expect(v.favour).toBeGreaterThan(0);
        expect(Kingship.grantTitle(player, world, v.id).success).toBe(true);
        expect(Kingship.grantLand(player, world, v.id).success).toBe(true);
        expect(Kingship.power(world, v, k)).toBeGreaterThan(p0);
        expect(k.crown.mods.tax).toBeLessThan(0); // the crown's demesne shrinks
        const light = Kingship.opinion(player, world, v).target;
        Throne.setPolicy(player, world, 'tax', 'heavy');
        expect(Kingship.opinion(player, world, v).target).toBeLessThan(light);
    });

    it('a feast warms every lord on a cooldown; a favour angers the neighbour', () => {
        const { world, player, k, court } = crowned();
        expect(Kingship.holdFeast(player, world).success).toBe(true);
        expect(court.vassals.every(v => v.favour >= Kingship.config().grants.feast.favour)).toBe(true);
        expect(Kingship.holdFeast(player, world).success).toBe(false);
        const seated = court.vassals.filter(v => v.seat);
        if (seated.length >= 2) {
            const before = seated.map(v => v.favour);
            expect(Kingship.grantFavour(player, world, seated[0].id).success).toBe(true);
            expect(seated[0].favour).toBeGreaterThan(before[0]);
            expect(seated.slice(1).some((v, i) => v.favour < before[i + 1])).toBe(true);
        }
        expect(k.treasury).toBeLessThan(5000);
    });

    it('a marriage binds a lord\'s house to yours', () => {
        const { world, player, court } = crowned();
        const v = court.vassals[0];
        expect(Kingship.arrangeMarriage(player, world, v.id).success).toBe(false); // no child to offer
        player.children.push({ id: 'kid3', firstName: 'Dara', gender: 'female', age: 19, isAlive: true, upbringing: { comeOfAge: true }, skills: {} });
        const res = Kingship.arrangeMarriage(player, world, v.id);
        expect(res.success).toBe(true);
        expect(v.kin).toBe(true);
        expect(player.children[0].upbringing.spouse.kind).toBe('vassal');
        expect(Kingship.opinion(player, world, v).parts.some(p => p.label === 'Kinship with your House')).toBe(true);
    });

    it('a weak lord can be broken; the others take note', () => {
        const { world, player, k, court } = crowned();
        k.military = 2000;
        const v = court.vassals[0];
        const others = court.vassals.slice(1).map(o => o.grudge);
        const res = Kingship.breakVassal(player, world, v.id);
        expect(res.success).toBe(true);
        expect(v.powerMult).toBeLessThan(1);
        expect(v.grudge).toBeLessThan(0);
        expect(v.cowedUntil).toBeGreaterThan(world.day);
        expect(court.vassals.slice(1).every((o, i) => o.grudge < others[i] || others[i] == null)).toBe(true);
        // ...but not a lord stronger than the crown
        k.military = 0;
        for (const o of court.vassals) o.opinion = -50;
        const big = court.vassals[1];
        big.lands = 5; big.titles = 5;
        expect(Kingship.canBreak(player, world, big.id).ok).toBe(false);
    });
});

/** Make every lord bitter, ambitious and strong. */
function sour(world, player, k, court) {
    k.military = 0;
    Throne.setPolicy(player, world, 'tax', 'heavy');
    for (const v of court.vassals) {
        v.opinion = -90; v.grudge = -100; v.ambition = 10; v.lands = 2; v.titles = 3;
        v.goals = [{ type: 'wealth', priority: 'high' }];
    }
}

describe('Factions', () => {
    it('the discontented band together in secret; the spymaster reveals them; conceding disbands them', () => {
        const { world, player, k, court } = crowned();
        sour(world, player, k, court);
        const since = player.throne.ruling.since;
        let tick = 1;
        while (!court.factions.length && tick < 20) {
            world.day = since + 7 * tick++;
            Kingship._vassalWeek(player, world, court, k, { notices: [] });
        }
        expect(court.factions.length).toBe(1);
        const f = court.factions[0];
        expect(f.demand.type).toBe('lowerLevy');
        expect(f.revealed).toBe(false);
        expect(Kingship.factions(player, world, { revealedOnly: true })).toHaveLength(0);
        expect(Kingship.concede(player, world, f.id).success).toBe(false); // can't answer what you can't see

        // A master spymaster finds it
        const sm = Kingship.candidates(player, world, 'spymaster')[0];
        Kingship.appoint(player, world, 'spymaster', sm.kind, sm.id);
        for (let i = 0; i < 200 && !f.revealed; i++) Kingship._revealPlots(player, world, court, { notices: [] });
        expect(f.revealed).toBe(true);
        expect(court.stats.plotsRevealed).toBe(1);

        expect(Kingship.concede(player, world, f.id).success).toBe(true);
        expect(player.throne.ruling.policies.tax).toBe('standard');
        expect(court.factions).toHaveLength(0);
    });

    it('an ignored ultimatum ends in refused levies or revolt', () => {
        const { world, player, k, court } = crowned();
        sour(world, player, k, court);
        const f = { id: 'faction_x', key: 'lowerLevy:', demand: { type: 'lowerLevy' }, leaderId: court.vassals[0].id,
            members: [court.vassals[0].id], formedDay: world.day, revealed: true, ultimatum: { dueDay: world.day }, refusedDay: -999 };
        court.vassals[0].factionId = f.id;
        court.factions.push(f);
        // A weak faction against a strong crown: levies refused
        k.military = 100000;
        const out = { notices: [] };
        Kingship._resolveUltimatums(player, world, court, k, out);
        expect(court.vassals[0].refusingUntil).toBeGreaterThan(world.day);
        expect(out.notices.some(n => n.title === 'Levies Refused')).toBe(true);
        Kingship.refresh(player, world);
        expect(k.crown.mods.military).toBeLessThan(0);

        // Everyone, against nothing: revolt
        k.military = 0;
        f.members = court.vassals.map(v => v.id);
        for (const v of court.vassals) v.factionId = f.id;
        f.ultimatum = { dueDay: world.day };
        Kingship._resolveUltimatums(player, world, court, k, out);
        expect(court.revolt).toBeTruthy();
        expect(k.crown.revolt).toBeUndefined(); // set on the next sync
        Kingship.refresh(player, world);
        expect(k.crown.revolt).toBe(true);
    });

    it('arresting a faction\'s leader scatters it', () => {
        const { world, player, k, court } = crowned();
        k.military = 5000;
        const [a, b] = court.vassals;
        const f = { id: 'faction_y', key: 'lowerLevy:', demand: { type: 'lowerLevy' }, leaderId: a.id, members: [a.id, b.id],
            formedDay: world.day, revealed: true, ultimatum: null, refusedDay: -999 };
        a.factionId = f.id; b.factionId = f.id;
        court.factions.push(f);
        Throne.setPolicy(player, world, 'tax', 'heavy');
        const g = b.grudge;
        expect(Kingship.arrestLeader(player, world, f.id).success).toBe(true);
        expect(court.factions).toHaveLength(0);
        expect(a.powerMult).toBeLessThan(1);
        expect(b.grudge).toBeLessThan(g);
    });
});

/** Start a revolt of every lord. */
function revolt(world, player, k, court) {
    sour(world, player, k, court);
    const f = { id: 'faction_r', key: 'lowerLevy:', demand: { type: 'lowerLevy' }, leaderId: court.vassals[0].id,
        members: court.vassals.map(v => v.id), formedDay: world.day, revealed: true, ultimatum: null, refusedDay: -999 };
    court.factions.push(f);
    Kingship._startRevolt(player, world, court, k, f, { notices: [] });
    return court.revolt;
}

describe('Revolt', () => {
    it('rebel seats withhold their dues; hosts march and can be broken in the field', () => {
        const { world, player, k, court } = crowned();
        const rv = revolt(world, player, k, court);
        expect(rv.seats.length).toBeGreaterThan(0);
        expect(court.vassals.every(v => v.rebel)).toBe(true);
        Kingship.refresh(player, world);
        expect(k.crown.mods.stability).toBeLessThan(0);
        expect(k.crown.mods.tax).toBeLessThan(0);
        // Hosts march within days
        let host = null;
        for (let i = 0; i < 20 && !host; i++) {
            world.day++;
            if (!court.revolt) break;
            Kingship._tickRevolt(player, world, court, k, { notices: [] });
            host = court.revolt && court.revolt.hosts[0];
        }
        expect(host).toBeTruthy();
        const unit = world.units.find(u => u.id === host.id);
        expect(unit.type).toBe('war_host');
        expect(unit.revoltId).toBe(rv.id);
        const m = court.revolt.momentum;
        expect(Kingship.onRebelHostDefeated(player, world, unit)).toBeTruthy();
        expect(court.revolt.momentum).toBe(m + Kingship.config().revolt.hostDefeated);
    });

    it('a rebel seat can be besieged and retaken; its lord is broken', () => {
        const { world, player, k, court } = crowned();
        const rv = revolt(world, player, k, court);
        const [q, r] = rv.seats[0].split(',').map(Number);
        const tile = world.getTile(q, r);
        player.army = [{ type: 'knight', strength: 500, hp: 100, maxHp: 100 }];
        const can = Sieges.canInvest(player, world, tile);
        expect(can.reason || '').not.toMatch(/liege/);
        const taken = Kingship.onRebelSeatTaken(player, world, q, r);
        expect(taken.gain).toBeGreaterThan(0);
        expect(Kingship.isRebelSeat(player, q, r)).toBe(false);
        expect(taken.lord).toBeTruthy();
    });

    it('a crushed revolt breaks its lords and wins Prestige; a parley grants the demand', () => {
        let { world, player, k, court } = crowned();
        revolt(world, player, k, court);
        const p0 = House.getPrestige(player);
        court.revolt.momentum = 200;
        Kingship._tickRevolt(player, world, court, k, { notices: [] });
        expect(court.revolt).toBe(null);
        expect(court.stats.revoltsCrushed).toBe(1);
        expect(House.getPrestige(player)).toBeGreaterThan(p0);
        expect(court.vassals.every(v => !v.rebel && v.powerMult < 1)).toBe(true);

        ({ world, player, k, court } = crowned(12));
        revolt(world, player, k, court);
        k.treasury = 100000;
        const res = Kingship.parley(player, world);
        expect(res.success).toBe(true);
        expect(court.revolt).toBe(null);
        expect(player.throne.ruling.policies.tax).toBe('standard');
        expect(court.vassals.every(v => !v.rebel)).toBe(true);
    });

    it('rebel hosts vanish if the crown is lost', () => {
        const { world, player, k, court } = crowned();
        revolt(world, player, k, court);
        for (let i = 0; i < 20 && !court.revolt.hosts.length; i++) { world.day++; Kingship._tickRevolt(player, world, court, k, { notices: [] }); if (!court.revolt) break; }
        const ids = (court.revolt ? court.revolt.hosts : []).map(h => h.id);
        Throne.abdicate(player, world);
        Kingship.processDay(world, player);
        for (const id of ids) expect(world.units.find(u => u.id === id).destroyed).toBe(true);
    });
});

describe('Royal petitions', () => {
    it('come to the crown\'s capital and move the treasury, the lords and foreign crowns', () => {
        const { world, player, k, court } = crowned();
        const bases = Petitions.holdingContexts(player, world);
        expect(bases.some(b => b.kind === 'crown' && b.kingdomId === k.id)).toBe(true);
        const pet = Petitions.spawn(player, world, 'royal_foreign_envoy');
        expect(pet).toBeTruthy();
        expect(pet.ctx.rivalRealmId).toBeTruthy();
        expect(pet.title).not.toMatch(/\{/);
        const rival = world.getKingdom(pet.ctx.rivalRealmId);
        const rel = rival.relations[k.id] || 0;
        const t = k.treasury;
        expect(Petitions.rule(player, world, pet.id, 'pay').success).toBe(true);
        expect(k.treasury).toBe(t - 400);
        expect(rival.relations[k.id]).toBeGreaterThan(rel);

        const p2 = Petitions.spawn(player, world, 'royal_succession_worries');
        const f0 = court.vassals.map(v => v.favour);
        Petitions.rule(player, world, p2.id, 'feast');
        expect(court.vassals.every((v, i) => v.favour > f0[i])).toBe(true);
    });

    it('never come to a player without a crown', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        expect(Petitions.holdingContexts(player, world).some(b => b.kind === 'crown')).toBe(false);
        expect(Petitions.spawn(player, world, 'royal_plague')).toBe(null);
    });
});

describe('The kingdom AI and a player-ruled realm', () => {
    it('a hostile neighbour marches on a weak crown', () => {
        const { world, player, k, court } = crowned();
        revolt(world, player, k, court);
        Kingship.refresh(player, world);
        k.military = 10;
        k.stability = 20;
        let declared = false;
        for (const o of world.kingdoms) {
            if (o === k || !o.isAlive) continue;
            o.relations[k.id] = -80;
            o.military = 5000;
            o.wars = [];
            o.capital = { ...k.capital };
            for (let d = 0; d < 7 * 40 && !declared; d++) {
                world.day++;
                KingdomAI.considerPlayerRealm(o, world);
                declared = o.wars.includes(k.id);
            }
            if (declared) break;
        }
        expect(declared).toBe(true);
        expect(world.events.some(e => /marches on|war of conquest/.test(e.text))).toBe(true);
    });

    it('a mighty crown is envied by its neighbours', () => {
        const { world, k } = crowned();
        const o = world.kingdoms.find(x => x !== k && x.isAlive);
        o.capital = { ...k.capital };
        o.allies = []; o.wars = [];
        k.military = 100000;
        o.relations[k.id] = 0;
        for (let d = 0; d < 70; d++) { world.day++; KingdomAI.considerPlayerRealm(o, world); }
        expect(o.relations[k.id]).toBeLessThan(0);
    });
});

describe('Saving and loading', () => {
    it('the court rides inside the throne record and comes back whole; old crowns backfill', () => {
        const { world, player, court } = crowned();
        Kingship.passEdict(player, world, 'road_programme');
        const best = Kingship.candidates(player, world, 'steward')[0];
        Kingship.appoint(player, world, 'steward', best.kind, best.id);
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const p2 = makePlayer(world);
        SaveLoad.restorePlayer(saved, p2, world);
        const c2 = Kingship.court(p2);
        expect(c2.vassals.map(v => v.id)).toEqual(court.vassals.map(v => v.id));
        expect(c2.edicts.road_programme).toBeTruthy();
        expect(c2.council.steward.id).toBe(best.id);
        expect(c2.mods).toEqual(court.mods);

        // A crown from before the court existed
        delete p2.throne.ruling.court;
        Kingship.load(p2, world);
        const fresh = Kingship.court(p2);
        expect(fresh.initialized).toBe(false);
        expect(fresh.vassals).toEqual([]);
        Kingship.processDay(world, p2);
        expect(fresh.vassals.length).toBeGreaterThan(0);
    });
});
