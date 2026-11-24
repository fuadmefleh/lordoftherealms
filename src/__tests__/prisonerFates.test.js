// No quarter: the fate of prisoners after a battle (player/prisonerFates.js). A beaten band leaves
// captives; each fate has real, read effects: ransoms paid out of a real treasury (never minted), men
// taken into service who may desert home, oaths kept or broken (and the breakers found out), slaughter
// that makes the enemy fight to the death, a blinded column that breaks a realm's heart, stakes on the
// road that turn invaders back and rot. Bandits yield prisoners too; the realms treat their own.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PrisonerFates } from '../player/prisonerFates.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { FieldBattle } from '../player/fieldBattle.js';
import { Interrogation } from '../systems/interrogation.js';
import { Atrocities } from '../systems/atrocities.js';
import { Devotion } from '../systems/devotion.js';
import { RealmWars } from '../systems/realmWars.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { WarStakes } from '../world/warStakes.js';
import { NPCLords } from '../world/npcLords.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) { DataLoader.clearCache(); await DataLoader.initializeAll(); }
});

let saved;
beforeEach(() => { Utils.setSeed(777); saved = DataLoader._gamedata.prisonerFates; });
afterEach(() => { DataLoader._gamedata.prisonerFates = saved; });

/** Tune data/prisonerFates.json for one test: tune({ service: { desert: 1 } }). */
function tune(over) {
    const d = JSON.parse(JSON.stringify(saved));
    for (const [k, v] of Object.entries(over)) d[k] = { ...d[k], ...v };
    DataLoader._gamedata.prisonerFates = d;
}

function lord(o = {}) {
    return { name: 'King', honor: 5, ambition: 5, traits: [], memory: [], relationships: {}, goals: [], ...o };
}

function kingdom(id, name, o = {}) {
    return {
        id, name, isAlive: true, treasury: 5000, military: 400, population: 8000, stability: 60, culture: 'Imperial',
        relations: {}, wars: [], allies: [], capital: { q: id * 10, r: 2 }, religion: { faithId: `faith${id}` }, lord: lord(), ...o,
    };
}

function makeWorld() {
    const k1 = kingdom(1, 'Varn');
    const k2 = kingdom(2, 'Esk');
    const k3 = kingdom(3, 'Morrow', { religion: { faithId: 'faith3' } });
    const towns = [
        { name: 'Varnhold', q: 10, r: 2, kingdom: 1, type: 'capital', population: 4000, economy: { gold: 2000 } },
        { name: 'Eskby', q: 20, r: 2, kingdom: 2, type: 'capital', population: 4000, economy: { gold: 2000 } },
        { name: 'Morrow', q: 30, r: 2, kingdom: 3, type: 'capital', population: 4000, economy: { gold: 2000 } },
        { name: 'Home', q: 2, r: 8, kingdom: null, type: 'town', population: 800, economy: { gold: 500 }, colony: { isPlayerColony: true, loyalty: 60 } },
    ];
    const at = {};
    for (const t of towns) at[`${t.q},${t.r}`] = t;
    const tiles = {};
    const world = {
        day: 500, width: 60, height: 40, generationParams: { seed: 31 }, events: [], units: [],
        kingdoms: [k1, k2, k3],
        getTile: (q, r) => tiles[`${q},${r}`] || (tiles[`${q},${r}`] = { q, r, visible: true, terrain: { id: 'plains', passable: true }, settlement: at[`${q},${r}`] || null }),
        getKingdom: (id) => [k1, k2, k3].find(k => String(k.id) === String(id)) || null,
        getSettlementViews: () => towns,
        getAllSettlements: () => towns,
    };
    world.captivesFeed = [];
    return { world, k1, k2, k3, towns };
}

function makePlayer(o = {}) {
    const army = [];
    for (let i = 0; i < 8; i++) army.push(PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('soldier')));
    return {
        name: 'Aldric Voss', gold: 1000, karma: 0, renown: 10, reputation: { 1: 0, 2: 0, 3: 0 }, q: 5, r: 5, army,
        skills: { combat: 1, leadership: 3, diplomacy: 3 }, inventory: {}, children: [], colonies: [{ q: 2, r: 8, name: 'Home' }],
        house: { name: 'House Voss', generation: 1, prestige: 100, history: [], rivals: {} }, ...o,
    };
}

function host(o = {}) {
    return { id: 'wh_1', type: 'war_host', name: 'Varn War Host', kingdomId: 1, q: 6, r: 5, strength: 80, ...o };
}

/** A won battle against `unit`: the captives' column, awaiting your word. */
function win(player, world, unit, remaining = 50) {
    return PrisonerFates.afterBattle(player, world, unit, { victory: true, enemyStrength: unit.strength, enemyRemaining: remaining, casualties: 0, theatre: 'land', tactics: {} });
}

const coin = (player, world) => player.gold + world.kingdoms.reduce((t, k) => t + k.treasury, 0);

describe('PrisonerFates — the captives', () => {
    it('a realm\'s beaten host leaves a column and its men of rank in the dungeon', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        const out = win(player, world, host());
        expect(out.column).toBeTruthy();
        expect(out.column.men).toBe(40); // 50 survivors × 0.4, two men a strength point
        expect(out.column.nobles.length).toBeGreaterThanOrEqual(1);
        expect(Interrogation.state(player).pows.length).toBe(out.column.nobles.length);
        expect(PrisonerFates.options(player, world).map(o => o.id)).toEqual(PrisonerFates.REALM_FATES);
    });

    it('realm-less bands (bandits, raiders) yield prisoners too, and outlaw fates', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        const out = win(player, world, { id: 'r1', type: 'raider', name: 'Bandits', q: 6, r: 5, strength: 30 }, 25);
        expect(out.column).toBeTruthy();
        expect(out.column.outlaw).toBe(true);
        expect(out.column.nobles).toEqual([]);
        expect(PrisonerFates.options(player, world).map(o => o.id)).toEqual(PrisonerFates.OUTLAW_FATES);
        // Hanged: the nearest town's thieves are cowed, the outlaws fight harder after
        const r = PrisonerFates.decide(player, world, 'hang');
        expect(r.success).toBe(true);
        const home = world.getTile(2, 8).settlement;
        expect(home.gallowsFear.until).toBeGreaterThan(world.day);
        expect(PrisonerFates.foeSpirit(player, world, { type: 'raider', q: 0, r: 0 }).noRout).toBe(true);
    });

    it('left undecided, the captains send them home on oath at the next day', () => {
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        const mil = k1.military;
        world.day++;
        const out = PrisonerFates.processDay(world, player);
        expect(PrisonerFates.pending(player)).toBeNull();
        expect(out.notices.some(n => /Captains/.test(n.title))).toBe(true);
        expect(k1.military).toBe(mil + 20);
        expect(PrisonerFates.state(player).oaths).toHaveLength(1);
    });
});

describe('PrisonerFates — ransom', () => {
    it('ransom talks: the coin comes out of their treasury, never minted', () => {
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        expect(PrisonerFates.decideNobles(player, world, 'ransom').success).toBe(true);
        const w = Interrogation.state(player).pows[0];
        expect(w.talks.stage).toBe('asked');
        const before = coin(player, world);
        const treasury = k1.treasury;
        const gold = player.gold;
        for (let i = 0; i < 20 && Interrogation.state(player).pows.includes(w); i++) { world.day++; PrisonerFates.processDay(world, player); }
        expect(Interrogation.state(player).pows.includes(w)).toBe(false);
        const paid = player.gold - gold;
        expect(paid).toBeGreaterThan(0);
        expect(k1.treasury).toBe(treasury - paid - 0); // (other knights' talks run too: all of it out of Varn's treasury)
        expect(coin(player, world)).toBeCloseTo(before, 6);
        expect(PrisonerFates.state(player).stats.ransomGold).toBe(paid);
    });

    it('a ruinous ask is met with less; pressed too far they refuse, and the knight is sold to their enemy', () => {
        const { world, k1, k2 } = makeWorld();
        const player = makePlayer();
        win(player, world, host({ strength: 40 }), 40);
        PrisonerFates.decideNobles(player, world, 'dungeon');
        const w = Interrogation.state(player).pows[0];
        expect(PrisonerFates.openTalks(player, world, w.id, 'ruinous').success).toBe(true);
        world.day = w.talks.replyDay;
        PrisonerFates.processDay(world, player);
        expect(w.talks.stage).toBe('offered');
        expect(w.talks.offer).toBeLessThan(w.talks.ask);
        for (let i = 0; i < 3 && w.talks.stage !== 'refused'; i++) {
            PrisonerFates.press(player, world, w.id);
            if (w.talks.stage === 'asked') { world.day = w.talks.replyDay; PrisonerFates.processDay(world, player); }
        }
        expect(w.talks.stage).toBe('refused');
        // Esk is at war with Varn: it will buy him, out of its treasury
        k2.wars = [1];
        k1.wars = [2];
        const b = PrisonerFates.buyers(player, world, w);
        expect(b[0].kingdomId).toBe(2);
        const before = coin(player, world);
        const t2 = k2.treasury;
        const r = PrisonerFates.sell(player, world, w.id, 2);
        expect(r.success).toBe(true);
        expect(k2.treasury).toBe(t2 - r.paid);
        expect(coin(player, world)).toBeCloseTo(before, 6);
        expect(player.reputation[1]).toBeLessThan(0);
        expect(NPCLords.memoryOf(k1.lord, world.day).some(m => m.key === 'pow_sold')).toBe(true);
    });

    it('a knight left unransomed long enough may die in your dungeon', () => {
        tune({ ransom: { rotAfter: 10, rotChance: 1 } });
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        PrisonerFates.decideNobles(player, world, 'dungeon');
        const n = Interrogation.state(player).pows.length;
        for (let i = 0; i < 30; i++) { world.day++; PrisonerFates.processDay(world, player); }
        expect(Interrogation.state(player).pows.length).toBeLessThan(n);
        expect(PrisonerFates.state(player).stats.rotted).toBeGreaterThan(0);
        expect(NPCLords.memoryOf(k1.lord, world.day).some(m => m.key === 'pow_rotted')).toBe(true);
    });
});

describe('PrisonerFates — the men', () => {
    it('taken into service: real companies on low loyalty, who may desert home', () => {
        tune({ service: { desert: 1, homeRadius: 100 } });
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        const n = player.army.length;
        expect(PrisonerFates.decide(player, world, 'service').success).toBe(true);
        const turned = PrisonerFates.turncoats(player);
        expect(turned.length).toBeGreaterThan(0);
        expect(player.army.length).toBe(n + turned.length);
        expect(turned[0].turncoat.loyalty).toBeLessThan(50);
        expect(PlayerMilitary.getUpkeepCost(player)).toBeGreaterThan(0);
        const mil = k1.military;
        world.day++;
        const out = PrisonerFates.processDay(world, player);
        expect(PrisonerFates.turncoats(player).length).toBeLessThan(turned.length);
        expect(k1.military).toBeGreaterThan(mil);
        expect(out.notices.some(x => /Desert/.test(x.title))).toBe(true);
    });

    it('released on oath: an honourable crown keeps them home; another marches them, and they are found out', () => {
        tune({ oath: { keepBase: 0, keepPerHonour: 0 }, impale: { stayHome: 0 } });
        const { world, k1, k2 } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        const mil = k1.military;
        PrisonerFates.decide(player, world, 'oath');
        expect(k1.military).toBe(mil + 20);
        expect(WarStakes.oathBound(k1, world.day)).toBe(40);
        expect(player.reputation[1]).toBeGreaterThan(0);
        // At war: the crown sends a host with oath-breakers in its ranks
        RealmWars.declareWar(player, world, k1, 'test');
        const war = player.realmWars.wars[1];
        war.lastHostDay = -999;
        const rec = RealmWars._dispatchHost(player, world, k1, war);
        expect(rec).toBeTruthy();
        expect(rec.oathBreakers).toBeGreaterThan(0);
        const unit = world.units.find(u => u.id === rec.id);
        expect(unit.oathBreakers).toBe(rec.oathBreakers);
        const spirit = PrisonerFates.foeSpirit(player, world, unit);
        expect(spirit.power).toBeGreaterThan(1);
        expect(spirit.moraleBonus).toBeLessThan(0);
        const rel = k2.relations[1] || 0;
        const out = win(player, world, unit, 60);
        expect(out.oathText).toMatch(/oath/);
        expect(PrisonerFates.state(player).oaths[0].broken).toBeGreaterThan(0);
        expect(k2.relations[1]).toBeLessThan(rel);
        // The oath-breakers among the captives hang by right: no stain of cruelty
        expect(PrisonerFates.view(player, world).title).toBe('Oath-Breakers');
        const butcher = Atrocities.butcher(player);
        expect(PrisonerFates.decideOathBreakers(player, world, true).success).toBe(true);
        expect(Atrocities.butcher(player)).toBe(butcher);
    });

    it('an honourable crown keeps sworn men home: fewer to march', () => {
        tune({ oath: { keepBase: 1 }, impale: { stayHome: 0 } });
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        PrisonerFates.decide(player, world, 'oath');
        RealmWars.declareWar(player, world, k1, 'test');
        const war = player.realmWars.wars[1];
        war.lastHostDay = -999;
        const rec = RealmWars._dispatchHost(player, world, k1, war);
        expect(rec).toBeTruthy();
        expect(rec.oathBreakers || 0).toBe(0);
    });

    it('cut down: their realm gives no quarter after — no rout, few captives — and the marks of it', () => {
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        PrisonerFates.decideNobles(player, world, 'share');
        expect(Interrogation.state(player).pows).toHaveLength(0);
        const faith = Devotion.standing(player, 'faith1');
        expect(PrisonerFates.decide(player, world, 'slaughter').success).toBe(true);
        expect(Atrocities.butcher(player)).toBeGreaterThan(0);
        expect(Atrocities.perfidy(player)).toBeGreaterThan(0);
        expect(player.reputation[1]).toBeLessThan(-20);
        expect(player.reputation[2]).toBeLessThan(0);
        expect(Devotion.standing(player, 'faith1')).toBeLessThan(faith);
        expect(NPCLords.memoryOf(k1.lord, world.day).some(m => m.key === 'pow_slaughtered')).toBe(true);
        expect(NPCLords.memoryOf(k1.lord, world.day).some(m => m.key === 'execution_highborn')).toBe(true);
        expect(player.house.history.some(h => /cut down/.test(h.text || h))).toBe(true);
        // Next time: they fight to the last
        const next = host({ id: 'wh_2' });
        const spirit = PrisonerFates.foeSpirit(player, world, next);
        expect(spirit.noRout).toBe(true);
        expect(spirit.moraleBonus).toBeGreaterThan(0);
        const battle = { noRout: true, eStr0: 100, pStr0: 100, leadership: 0, enemyMoraleBonus: 0 };
        expect(FieldBattle._routCheck(battle, { eStr: 40, pStr: 100 }, 0.7)).toBe(null); // would have routed at 45%
        expect(FieldBattle._routCheck(battle, { eStr: 10, pStr: 100 }, 0.7)).toBe('enemy');
        const again = win(player, world, next, 50);
        expect(again.column.men).toBeLessThan(10); // a remnant, not 40
        // ...and their lord, holding your men, pays it back in kind
        const held = PrisonerFates.afterBattle(player, world, host({ id: 'wh_3' }), { victory: false, casualties: 4, theatre: 'land' });
        expect(held.takenText).toBeTruthy();
        expect(PrisonerFates.state(player).history[0].fate).toMatch(/yours_(slaughter|blind|service|ransom)/);
    });

    it('one-shot combat: a foe given no quarter never breaks', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        let breaks = 0;
        for (let i = 0; i < 40; i++) {
            const r = PlayerMilitary.combat(player, 400, 'Varn War Host', { world, enemyNoRout: true });
            if (r.tactics && r.tactics.moraleBreak === 'enemy') breaks++;
            player.army = makePlayer().army;
        }
        expect(breaks).toBe(0);
    });

    it('blinded: the column walks home on the map, and the realm that sees it loses heart', () => {
        const { world, k1 } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        const f3 = Devotion.standing(player, 'faith3');
        expect(PrisonerFates.decide(player, world, 'blind').success).toBe(true);
        expect(Devotion.standing(player, 'faith3')).toBeLessThan(f3); // every faith
        const col = WarStakes.columns(world)[0];
        expect(col).toBeTruthy();
        expect(col.men).toBe(40);
        const before = KingdomAI._moraleBonus(k1, world);
        let days = 0;
        while (WarStakes.columns(world).length && days < 40) { world.day++; days++; PrisonerFates.processDay(world, player); }
        expect(days).toBeGreaterThan(1);
        expect(WarStakes.dismay(k1, world.day)).toBeGreaterThan(0);
        expect(KingdomAI._moraleBonus(k1, world)).toBeLessThan(before);
        expect(k1.stability).toBeLessThan(60);
        expect(PrisonerFates.foeSpirit(player, world, host({ id: 'wh_z' })).moraleBonus).toBeLessThan(0); // their men fight you with less heart
        // No heart for another host against you
        RealmWars.declareWar(player, world, k1, 'test');
        const war = player.realmWars.wars[1];
        war.lastHostDay = -999;
        expect(RealmWars._dispatchHost(player, world, k1, war)).toBeNull();
        expect(NPCLords.memoryOf(k1.lord, world.day).some(m => m.key === 'pow_blinded')).toBe(true);
        expect(Nemesis_grudge(player)).toMatch(/One-Eye/);
    });
});

function Nemesis_grudge(player) {
    const g = player.nemesis && player.nemesis.grudges && player.nemesis.grudges[0];
    return g ? g.name : '';
}

describe('PrisonerFates — a forest of stakes', () => {
    it('stakes along the road into your realm: hosts turn back, crowns dread a war, your lords are cowed, and it rots', () => {
        tune({ impale: { turnBack: 1 } });
        const { world, k1, k2 } = makeWorld();
        const player = makePlayer({ throne: { ruling: { kingdomId: 9, court: { vassals: [{ id: 'v1', name: 'Lord Ash', opinion: 0, grudge: 0, cowedUntil: 0 }] } } } });
        win(player, world, host());
        const renown = player.renown;
        expect(PrisonerFates.decide(player, world, 'impale').success).toBe(true);
        const s = WarStakes.stakes(world)[0];
        expect(s.byPlayer).toBe(true);
        expect(s.tiles.length).toBeGreaterThan(1);
        // toward your holding (Home at 2,8) from the field (6,5)
        expect(s.tiles[s.tiles.length - 1].r).toBeGreaterThan(5);
        expect(player.renown).toBeGreaterThan(renown + 20);
        expect(Atrocities.butcher(player)).toBeGreaterThanOrEqual(40);
        expect(player.reputation[2]).toBeLessThan(0);
        expect(player.throne.ruling.court.vassals[0].cowedUntil).toBeGreaterThan(world.day);
        expect(WarStakes.fears(k1, 'player', world.day)).toBe(true);
        expect(WarStakes.dreadAt(world, s.q, s.r, 6)).toBe(1);
        // A war host marching past the stakes turns back
        RealmWars.declareWar(player, world, k1, 'test');
        const war = player.realmWars.wars[1];
        world.units.push(Object.assign(RealmWars._spawnUnit(world, k1, { id: 'wh_x', name: 'Varn War Host', q: s.q, r: s.r, targetQ: 2, targetR: 8, strength: 60, target: { kind: 'colony', q: 2, r: 8 } }), {}));
        war.hosts.push({ id: 'wh_x', name: 'Varn War Host', q: s.q, r: s.r, targetQ: 2, targetR: 8, strength: 60, target: { kind: 'colony', q: 2, r: 8 } });
        war.lastHostDay = world.day;
        const mil = k1.military;
        const out = { ultimatums: [], declared: [], marching: [], struck: [], ended: [] };
        RealmWars._tickWar(player, world, k1, war, out);
        expect(war.hosts.find(h => h.id === 'wh_x')).toBeFalsy();
        expect(k1.military).toBe(mil + 60);
        expect(out.struck.some(x => /stakes/.test(x.text))).toBe(true);
        // A crown that dreads you does not open a war of conquest; KingdomAI.considerWar passes over a feared foe
        const c = WarStakes.captivity(k2); c.fearOf[3] = world.day + 50;
        expect(WarStakes.fears(k2, 3, world.day)).toBe(true);
        // The stakes rot: fresh falls to nothing, then they are gone
        world.day += s.rotDays;
        expect(WarStakes.fresh(s, world.day)).toBe(0);
        expect(WarStakes.dreadAt(world, s.q, s.r, 6)).toBe(0);
        world.day += s.rotDays;
        PrisonerFates.processDay(world, player);
        expect(WarStakes.stakes(world)).toHaveLength(0);
    });
});

describe('PrisonerFates — your men, and the realms\' own captives', () => {
    it('your men held for ransom: bought back out of your purse into their treasury', () => {
        const { world, k1 } = makeWorld();
        k1.lord = lord({ traits: [{ id: 'greedy' }] });
        const player = makePlayer();
        let h = null;
        for (let i = 0; i < 10 && !h; i++) {
            PrisonerFates.afterBattle(player, world, host({ id: `h${i}` }), { victory: false, casualties: 6, theatre: 'land' });
            h = PrisonerFates.state(player).held.find(x => x.fate === 'ransom');
            world.day++;
        }
        expect(h).toBeTruthy();
        const before = coin(player, world);
        const n = player.army.length;
        const r = PrisonerFates.buyBack(player, world, h.id);
        expect(r.success).toBe(true);
        expect(player.army.length).toBe(n + h.units);
        expect(coin(player, world)).toBeCloseTo(before, 6);
    });

    it('the realms ransom, spare and butcher each other\'s men', () => {
        tune({ ai: { weights: { ransom: 1 }, cruel: {}, honourable: {} } });
        const { world, k1, k2 } = makeWorld();
        world.captivesFeed.push({ day: world.day, victor: 1, loser: 2, q: 15, r: 2, lost: 200 });
        const before = k1.treasury + k2.treasury;
        const m2 = k2.military;
        PrisonerFates.processDay(world, null);
        expect(k1.treasury).toBeGreaterThan(5000);
        expect(k1.treasury + k2.treasury).toBe(before);
        expect(k2.military).toBe(m2 + 60);
        tune({ ai: { weights: { impale: 1 }, cruel: {}, honourable: {} } });
        world.captivesFeed.push({ day: world.day, victor: 1, loser: 2, q: 15, r: 2, lost: 200 });
        PrisonerFates.processDay(world, null);
        expect(WarStakes.stakes(world).some(s => !s.byPlayer && s.by === 'Varn')).toBe(true);
        expect(WarStakes.fears(k2, 1, world.day)).toBe(true);
        expect(world.events.some(e => /stakes/.test(e.text))).toBe(true);
    });

    it('KingdomAI feeds the captives\' inbox from its battles', () => {
        const { world, k1, k2 } = makeWorld();
        k1.wars = [2]; k2.wars = [1];
        k1.territory = [{ q: 10, r: 2 }]; k2.territory = [{ q: 20, r: 2 }];
        KingdomAI.simulateBattle(k1, k2, world);
        expect(world.captivesFeed).toHaveLength(1);
        const b = world.captivesFeed[0];
        expect([1, 2]).toContain(b.victor);
        expect(b.lost).toBeGreaterThan(0);
    });

    it('saved and loaded: the player\'s record, the kingdom\'s captivity, the stakes on the world', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('prisonerFates');
        const { world, k1 } = makeWorld();
        WarStakes.captivity(k1).dismay = { until: 900, m: 0.1 };
        const ks = SaveLoad.serializeKingdoms([k1]);
        expect(ks[0].captivity.dismay.m).toBe(0.1);
    });
});

describe('PrisonerFates — the scene', () => {
    it('walks the knights then the men, and ends with an outcome', () => {
        const { world } = makeWorld();
        const player = makePlayer();
        win(player, world, host());
        let v = PrisonerFates.view(player, world);
        expect(v.title).toBe('The Men of Rank');
        let out = PrisonerFates.act(player, world, { log: [] }, 'nobles_dungeon');
        expect(out.state).toBeTruthy();
        v = PrisonerFates.view(player, world);
        expect(v.title).toBe('The Fate of the Captives');
        expect(v.options.find(o => o.isDefault).id).toBe('oath');
        out = PrisonerFates.act(player, world, out.state, 'release');
        expect(out.notification.body).toMatch(/home/);
        expect(PrisonerFates.view(player, world)).toBeNull();
    });
});
