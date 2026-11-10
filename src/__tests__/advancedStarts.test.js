// Advanced starts (player/scenarios.js, data/scenarios.json group 'advanced'):
// the Monarch, the High Priest, the Great Lord and the Guildmaster each take
// over a real seat of the generated world (nothing minted, nothing doubled),
// play as that role from day one, carry a challenge scaled by difficulty,
// survive save/load, and hand on through heirs and new lives.

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { loadData, newGame, endDay, roundTrip, carryOn } from './playtest/harness.js';
import { Scenarios } from '../player/scenarios.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { Afterlife } from '../player/afterlife.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Victory } from '../systems/victory.js';
import { Religion } from '../systems/religion.js';
import { Devotion } from '../systems/devotion.js';
import { Guilds } from '../systems/guilds.js';
import { Relationships } from '../systems/relationships.js';
import { Laws } from '../systems/laws.js';
import { Estates } from '../world/estates.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { NPCLords } from '../world/npcLords.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Living rulers of a realm (its characterData.ruler and anyone else marked as ruling). */
function rulersOf(k) {
    const d = k.characterData || {};
    const all = [d.ruler, d.spouse, ...(d.children || []), ...Object.values(d.advisors || {})].filter(Boolean);
    return all.filter(c => c.isRuler && c.isAlive !== false);
}

function monarchGame(seed, opts = {}) {
    const g = newGame(seed);
    g.player.age = opts.age || 30;
    const military = {};
    const treasury = {};
    for (const k of g.world.kingdoms) { military[k.id] = k.military; treasury[k.id] = k.treasury; }
    const report = Scenarios.apply(g.player, g.world, { origin: 'monarch', difficulty: opts.difficulty });
    return { g, report, military, treasury };
}

describe('the new-game choices', () => {
    it('offers the advanced starts as their own group, with their suggested goals', () => {
        const c = Scenarios.choices();
        const adv = c.origins.filter(o => o.group === 'advanced').map(o => o.id);
        expect(adv).toEqual(['monarch', 'high_priest', 'great_lord', 'guildmaster', 'general', 'crime_lord']);
        expect(c.origins.find(o => o.id === 'wanderer').group).toBe('origin');
        expect(c.origins.find(o => o.id === 'monarch').suggestedVictory).toBe('empire');
        expect(c.origins.find(o => o.id === 'high_priest').suggestedVictory).toBe('faith');
        expect(c.victories.map(v => v.id)).toEqual(expect.arrayContaining(['empire', 'faith']));
        for (const o of c.origins.filter(x => x.group === 'advanced')) expect(o.blurb.length).toBeGreaterThan(40);
    });
});

describe('the Monarch', () => {
    it('takes over a generated realm: its crown, treasury and host, one ruler only', () => {
        const { g, report, military, treasury } = monarchGame(61);
        const p = g.player;
        const k = Throne.ruledKingdom(p, g.world);
        expect(k).toBeTruthy();
        expect(k.id).toBe(p.scenario.realm);
        // The treasury is the realm's own, untouched; the guard came out of its host
        expect(k.treasury).toBe(treasury[k.id]);
        const guardStrength = p.army.reduce((s, u) => s + u.strength, 0);
        expect(p.army.length).toBe(7);
        expect(k.military).toBe(military[k.id] - guardStrength);
        // One ruler, and it is the player; the late monarch is dead
        const rulers = rulersOf(k);
        expect(rulers.length).toBe(1);
        expect(rulers[0].isPlayer).toBe(true);
        expect(k.characterData.ruler.isPlayer).toBe(true);
        expect(p.allegiance).toBe(k.id);
        expect(p.kingdomTitle).toBe('king');
        expect(k.crown.playerRuled).toBe(true);
        // At the capital, with the House's prestige and a welcome that names it all
        expect(p.q).toBe(k.capital.q);
        expect(p.r).toBe(k.capital.r);
        expect(p.house.prestige).toBeGreaterThanOrEqual(80);
        expect(report.welcome).not.toMatch(/\{\w+\}/);
        expect(report.welcome).toContain(p.scenario.start.oldRuler);
        // Not a rival House of its own realm
        expect(p.house.rivals[k.id]).toBeUndefined();
    }, 60000);

    it('holds a court: lords sworn, the old officers on the council, a pretender and restless lords', () => {
        const { g } = monarchGame(62);
        const p = g.player;
        const court = Kingship.court(p);
        expect(court.initialized).toBe(true);
        expect(court.vassals.length).toBeGreaterThanOrEqual(2);
        const seated = Kingship.OFFICES.filter(o => court.council[o]);
        expect(seated.length).toBeGreaterThanOrEqual(3);
        const pretender = court.vassals.find(v => v.pretender);
        expect(pretender).toBeTruthy();
        expect(pretender.opinion).toBeLessThan(-15);
        expect(p.scenario.start.pretender).toBe(Kingship.fullName(pretender));
        // A neighbour backs the pretender
        const rivals = Object.values(p.house.rivals).filter(r => r.feud >= 35);
        expect(rivals.length).toBeGreaterThanOrEqual(1);
        // A consort and an heir for a monarch of 30
        expect(p.spouse).toBeTruthy();
        expect((p.children || []).length).toBeGreaterThanOrEqual(1);
        expect(p.heir).toBeTruthy();
        // The realm's laws are the player's to proclaim
        expect(Laws.ruled(p, g.world).id).toBe(p.scenario.realm);
    }, 60000);

    it('the pretender bites harder on Brutal', () => {
        const normal = monarchGame(63).g;
        const brutal = monarchGame(63, { difficulty: 'brutal' }).g;
        const pn = Kingship.court(normal.player).vassals.find(v => v.pretender);
        const pb = Kingship.court(brutal.player).vassals.find(v => v.pretender);
        expect(pb.grudge).toBeLessThan(pn.grudge);
    }, 60000);

    it('the realm\'s AI no longer acts for it: no envoys, no lord\'s goals, no war on its own', () => {
        const { g } = monarchGame(64);
        const kid = g.player.scenario.realm;
        const dip = vi.spyOn(KingdomAI, 'considerDiplomacy');
        const goal = vi.spyOn(NPCLords, 'pursueGoal');
        for (let d = 0; d < 15; d++) endDay(g);
        expect(dip.mock.calls.some(([k]) => k.id === kid)).toBe(false);
        expect(goal.mock.calls.some(([k]) => k.id === kid)).toBe(false);
        // Other realms still run themselves
        expect(dip.mock.calls.length + goal.mock.calls.length).toBeGreaterThan(0);
        const k = Throne.ruledKingdom(g.player, g.world);
        expect(k.lord.goals).toEqual([]);
        expect(k.lordModifiers).toEqual({});
        // ...and no alliance was signed for it without the ruler
        const before = new Set(k.allies);
        expect([...before].every(id => g.world.kingdoms.find(x => x.id === id).allies.includes(k.id))).toBe(true);
        expect(rulersOf(k).length).toBe(1);
    }, 120000);

    it('saves and loads the crown, the court and the start', () => {
        const { g } = monarchGame(65);
        for (let d = 0; d < 3; d++) endDay(g);
        const back = roundTrip(g);
        const p = back.player;
        const k = Throne.ruledKingdom(p, back.world);
        expect(k && k.id).toBe(g.player.scenario.realm);
        expect(p.scenario.start).toEqual(g.player.scenario.start);
        expect(Kingship.court(p).vassals.length).toBe(Kingship.court(g.player).vassals.length);
        expect(Kingship.court(p).vassals.find(v => v.pretender)).toBeTruthy();
        expect(k.characterData.ruler.isPlayer).toBe(true);
        expect(k.characterData.ruler.isAlive).toBe(true);
        endDay(back);
        expect(Throne.ruledKingdom(back.player, back.world).id).toBe(k.id);
    }, 120000);

    it('an heir inherits the crown', () => {
        const { g } = monarchGame(66, { age: 45 });
        const p = g.player;
        const kid = p.scenario.realm;
        const child = p.children.find(c => c.id === p.heir);
        child.age = Math.max(child.age, Relationships._getHeirSettings().minAgeToPlay);
        const res = carryOn(g, 'old age');
        expect(res.how).toBe('heir');
        endDay(g);
        const k = Throne.ruledKingdom(g.player, g.world);
        expect(k && k.id).toBe(kid);
        expect(g.player.allegiance).toBe(kid);
        expect(k.ruler).toContain(child.firstName);
        expect(rulersOf(k).length).toBe(1);
    }, 120000);

    it('with no heir taken up, a new life hands the crown back to the realm', () => {
        const { g } = monarchGame(67, { age: 18 });
        const old = g.player;
        const kid = old.scenario.realm;
        Afterlife.begin(old, g.world, 'a fever');
        const cand = Afterlife.candidates(g.world)[0];
        const res = Afterlife.becomeStranger(old, g.world, cand);
        expect(res.success).toBe(true);
        const k = g.world.getKingdom(kid);
        expect(k.isAlive).toBe(true);
        expect(k.characterData.ruler.isPlayer).toBeFalsy();
        expect(rulersOf(k).length).toBe(1);
        expect(Throne.ruledKingdom(res.player, g.world)).toBeNull();
        expect(k.crown && k.crown.playerRuled).toBeFalsy();
    }, 120000);

    it('Empire: the goal reads the size of the realm ruled', () => {
        const { g } = monarchGame(68);
        const k = Throne.ruledKingdom(g.player, g.world);
        const pr = Victory.progress(g.player, g.world, 'empire');
        expect(pr.text).toContain(k.name);
        expect(pr.pct).toBeGreaterThan(0);
        expect(pr.done).toBe(Throne._settlementsOf(g.world, k).length >= Victory.def('empire').target);
    }, 60000);
});

describe('the High Priest', () => {
    function priest(seed) {
        const g = newGame(seed);
        const treasury = {};
        for (const k of g.world.kingdoms) treasury[k.id] = k.treasury;
        const report = Scenarios.apply(g.player, g.world, { origin: 'high_priest' });
        return { g, report, treasury };
    }

    it('heads a world faith from a holy city: the temple, the flock, the clergy, the ear of kings', () => {
        const { g, report } = priest(71);
        const p = g.player;
        const k = g.world.getKingdom(p.scenario.realm);
        const rel = p.religion;
        expect(rel.worldFaithId).toBe(k.religion.faithId);
        expect(rel.name).toBe(Religion.FAITHS[rel.worldFaithId].name);
        // The great temple of the see, at the capital
        const t = g.world.getTile(k.capital.q, k.capital.r);
        expect(t.religiousBuilding && t.religiousBuilding.see).toBe(true);
        expect(rel.buildings.length).toBe(1);
        expect(Religion.isDevoted(rel, k.capital.q, k.capital.r)).toBe(true);
        expect(rel.followers).toBeGreaterThan(0);
        // The creed is the world faith; the clergy know their head
        const creed = Devotion.creed(p);
        expect(creed.id).toBe(rel.worldFaithId);
        expect(Devotion.state(p).standing[rel.worldFaithId]).toBeGreaterThanOrEqual(60);
        expect(p.reputation[k.id]).toBeGreaterThanOrEqual(25);
        // Preaching in a realm of the faith draws no hostility from its clergy
        const o = PlayerReligion.sermonOutlook(p, t.settlement, t, g.world);
        expect(o.hostility).toBe(0);
        // The challenge: a heresy in the see's realm, a zealous rival faith
        expect(Religion.strongestHeresy(k)).toBeTruthy();
        expect(Object.values(p.house.rivals).some(r => r.feud >= 35)).toBe(true);
        expect(report.welcome).not.toMatch(/\{\w+\}/);
        expect(p.scenario.start.faithId).toBe(rel.worldFaithId);
    }, 60000);

    it('the tithe is gold that leaves the faithful realms\' treasuries', () => {
        const { g } = priest(72);
        const p = g.player;
        const fid = p.religion.worldFaithId;
        const realms = g.world.kingdoms.filter(k => k.isAlive && k.religion && k.religion.faithId === fid);
        for (const k of realms) k.religion.pilgrimIncome = 40;
        const before = realms.reduce((s, k) => s + k.treasury, 0);
        const gold = p.gold;
        const res = PlayerReligion.collectTithes(p, g.world);
        expect(res.gold).toBeGreaterThan(0);
        expect(p.gold - gold).toBe(res.gold);
        expect(before - realms.reduce((s, k) => s + k.treasury, 0)).toBe(res.gold);
        for (let d = 0; d < 10; d++) endDay(g);
        expect(p.religion.titheTotal).toBeGreaterThan(0);
    }, 120000);

    it('holds the church\'s estates at the see (rents from the town\'s coin)', () => {
        const { g } = priest(73);
        const mine = Estates.heldBy(g.world, 'player');
        expect(mine.length).toBe(g.player.scenario.start.estates);
        for (const e of mine) expect(e.church).toBe(true);
    }, 60000);

    it('saves and loads the see', () => {
        const { g } = priest(74);
        const back = roundTrip(g);
        const rel = back.player.religion;
        expect(rel.worldFaithId).toBe(g.player.religion.worldFaithId);
        expect(rel.see).toEqual(g.player.religion.see);
        expect(rel.titheShare).toBe(g.player.religion.titheShare);
        expect(Devotion.creed(back.player).id).toBe(rel.worldFaithId);
        const t = back.world.getTile(rel.see.q, rel.see.r);
        expect(t.religiousBuilding && t.religiousBuilding.see).toBe(true);
        expect(back.player.scenario.start).toEqual(g.player.scenario.start);
    }, 120000);

    it('Faith Ascendant: the goal counts the towns devoted to the faith', () => {
        const { g } = priest(75);
        const pr = Victory.progress(g.player, g.world, 'faith');
        expect(Victory.devotedTowns(g.player, g.world).length).toBeGreaterThanOrEqual(1);
        expect(pr.pct).toBeGreaterThan(0);
        expect(pr.done).toBe(false);
    }, 60000);
});

describe('the Great Lord', () => {
    it('heads the realm\'s greatest noble house: its estates, household knights, a cadet claim, a jealous crown', () => {
        const g = newGame(81);
        const mil = {};
        for (const k of g.world.kingdoms) mil[k.id] = k.military;
        const r = Scenarios.apply(g.player, g.world, { origin: 'great_lord' });
        const p = g.player;
        const kid = p.scenario.realm;
        const k = g.world.getKingdom(kid);
        expect(p.allegiance).toBe(kid);
        expect(Throne.claimStrength(p, kid)).toBe(20);
        expect(Throne.ruledKingdom(p, g.world)).toBeNull();
        expect(p.house.rivals[kid].feud).toBeGreaterThanOrEqual(30);
        expect(k.military).toBe(mil[kid] - p.army.reduce((s, u) => s + u.strength, 0));
        const mine = Estates.heldBy(g.world, 'player');
        expect(mine.length).toBe(p.scenario.start.estates);
        // Every estate of that noble house is the player's now (no second holder)
        const st = Estates.state(g.world);
        expect(Object.values(st.estates).filter(e => e.holder === 'player').length).toBe(mine.length);
        expect(g.world.getTile(p.q, p.r).settlement.kingdom).toBe(kid);
        expect(r.welcome).not.toMatch(/\{\w+\}/);
        const back = roundTrip(g);
        expect(Estates.heldBy(back.world, 'player').length).toBe(mine.length);
        expect(back.player.scenario.start).toEqual(p.scenario.start);
    }, 120000);
});

describe('the Guildmaster', () => {
    it('is the elected master of a great guild, with an election coming', () => {
        const g = newGame(91);
        const r = Scenarios.apply(g.player, g.world, { origin: 'guildmaster' });
        const p = g.player;
        const st = p.scenario.start;
        const s = g.world.getTile(st.q, st.r).settlement;
        const gd = Guilds.guild(s, st.guild);
        expect(Guilds.rankOf(p, s, st.guild)).toBe(3);
        expect(gd.master.player).toBe(true);
        expect(gd.nextElection).toBeGreaterThan(g.world.day);
        expect(p.q).toBe(st.q);
        expect(r.welcome).not.toMatch(/\{\w+\}/);
        // A few weeks as guildmaster: the hall keeps its master until the vote
        for (let d = 0; d < 8; d++) endDay(g);
        expect(Guilds.guild(s, st.guild).master.player).toBe(true);
        const back = roundTrip(g);
        const s2 = back.world.getTile(st.q, st.r).settlement;
        expect(Guilds.rankOf(back.player, s2, st.guild)).toBe(3);
        expect(Guilds.guild(s2, st.guild).master.player).toBe(true);
    }, 120000);
});
