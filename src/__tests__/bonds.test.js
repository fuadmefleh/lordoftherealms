// Friends & Bonds (systems/bonds.js): friendships beyond romance — bonds that
// form from relationships, grow through shared deeds and fade with neglect;
// sworn kinship, mentors, protégés; friends who fight beside you, lend you
// coin, warn you and visit; betrayal both ways; old family friends for heirs.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Bonds } from '../systems/bonds.js';
import { Relationships } from '../systems/relationships.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Nemesis } from '../systems/nemesis.js';
import { Hearsay } from '../systems/hearsay.js';
import { NpcChat } from '../systems/npcChat.js';
import { Utils } from '../core/utils.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

let g;
let town;

function townTile(world) {
    const views = world.getSettlementViews();
    const s = views.find(v => v.type === 'town') || views[0];
    return world.getTile(s.q, s.r);
}

/** A relationship NPC in the town the player stands in, with a score. */
function friendHere(score = 50, extra = {}) {
    const npc = Relationships.generateNPC(town.settlement, g.world);
    npc.settlementQ = town.q;
    npc.settlementR = town.r;
    npc.age = 40;
    Object.assign(npc, extra);
    const rel = Relationships.getRelationship(g.player, npc.id);
    rel.score = score;
    return npc;
}

beforeEach(() => {
    g = newGame(777);
    town = townTile(g.world);
    g.player.q = town.q;
    g.player.r = town.r;
    g.player.gold = 500;
    g.player.bonds = null;
    g.player.travelParty = [];
});

afterEach(() => vi.restoreAllMocks());

describe('forming', () => {
    it('someone you know well becomes a friend; an old rival becomes a rival turned friend', () => {
        const a = friendHere(50);
        const b = friendHere(-40);
        const out = Bonds.processDay(g.world, g.player);
        expect(Bonds.get(g.player, a.id).kind).toBe('friend');
        expect(Bonds.get(g.player, b.id)).toBeNull();
        expect(out.notices.some(n => n.title === 'A New Friend')).toBe(true);
        g.player.relationships[b.id].score = 45;
        g.world.day++;
        const out2 = Bonds.processDay(g.world, g.player);
        expect(Bonds.get(g.player, b.id).kind).toBe('rival_friend');
        expect(out2.notices.some(n => n.title === 'Old Rivals, New Friends')).toBe(true);
    }, 120000);
});

describe('deeds and neglect', () => {
    it('drinking together grows the bond and pays the town; it fades when neglected and drifts apart', () => {
        const a = friendHere(50);
        Bonds.processDay(g.world, g.player);
        const b = Bonds.get(g.player, a.id);
        const before = b.strength;
        const gold = g.player.gold;
        const res = Bonds.drinkWith(g.player, g.world, a.id);
        expect(res.success).toBe(true);
        expect(b.strength).toBeGreaterThan(before);
        expect(g.player.gold).toBe(gold - Bonds.config().drink.cost);
        expect(Bonds.drinkWith(g.player, g.world, a.id).success).toBe(false); // once a day
        // Away for a long while
        g.player.q = -999;
        b.strength = 0.5;
        g.world.day += 60;
        const out = Bonds.processDay(g.world, g.player);
        g.world.day++;
        Bonds.processDay(g.world, g.player);
        g.world.day++;
        const out3 = Bonds.processDay(g.world, g.player);
        expect(Bonds.get(g.player, a.id)).toBeNull();
        expect([...out.notices, ...out3.notices].some(n => n.title === 'Drifted Apart')).toBe(true);
        expect(g.player.bonds.past[0].ended.how).toBe('drifted');
        expect(g.player.relationships[a.id].score).toBeLessThan(Bonds.config().formAt);
    }, 120000);

    it('drinking most of all makes a drinking companion', () => {
        const a = friendHere(50);
        Bonds.processDay(g.world, g.player);
        for (let i = 0; i < 5; i++) {
            Bonds.drinkWith(g.player, g.world, a.id);
            g.world.day++;
        }
        expect(Bonds.get(g.player, a.id).kind).toBe('drinking');
    }, 120000);
});

describe('milestones', () => {
    it('sworn kinship by oath before a church, with them beside you', () => {
        const a = friendHere(80, { gender: 'female' });
        Bonds.processDay(g.world, g.player);
        const b = Bonds.get(g.player, a.id);
        b.strength = 60;
        expect(Bonds.swearOath(g.player, g.world, a.id).success).toBe(false);
        b.strength = 85;
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const res = Bonds.swearOath(g.player, g.world, a.id);
        expect(res.success).toBe(true);
        expect(res.sworn).toBe(true);
        expect(b.sworn.place).toMatch(/church|chapel|cathedral|hearth/);
        expect(Bonds.label(b, a)).toBe('Sworn Sister');
    }, 120000);

    it('a mentor teaches you their skill each day you keep company', () => {
        const a = friendHere(60, { occupation: 'blacksmith' });
        Bonds.processDay(g.world, g.player);
        const b = Bonds.get(g.player, a.id);
        b.strength = 50;
        const res = Bonds.askMentor(g.player, g.world, a.id);
        expect(res.success).toBe(true);
        const skill = b.mentor.skill;
        const xp0 = PracticeSkills.xp(g.player, skill);
        g.world.day++;
        Bonds.processDay(g.world, g.player);
        expect(PracticeSkills.xp(g.player, skill)).toBeGreaterThan(xp0);
        expect(b.mentor.days).toBe(1);
    }, 120000);

    it('a protégé taught for years grows into a capable, loyal ally you can take into service', () => {
        const s = town.settlement;
        if (!s.folk) Townsfolk.seed(s, g.world);
        const day = g.world.day;
        const Y = Townsfolk.config().daysPerYear;
        const p = s.folk.people.find(x => x.died == null && !x.away);
        p.born = day - 12 * Y;
        PracticeSkills.setLevel(g.player, 'blades', 5);
        const c = Bonds.protegeCandidates(g.player, g.world).find(x => x.p === p);
        expect(c).toBeTruthy();
        const res = Bonds.takeProtege(g.player, g.world, c.uid);
        expect(res.success).toBe(true);
        const pr = g.player.bonds.proteges[0];
        expect(pr.skill).toBe('blades');
        g.world.day++;
        Bonds.processDay(g.world, g.player);
        expect(pr.taught).toBe(1);
        expect(PracticeSkills.xp(p, 'blades')).toBeGreaterThan(0);
        // Years later: grown, and taught long enough
        p.born = g.world.day - 18 * Y;
        if (p.role === 'child') p.role = 'villager';
        pr.taught = Bonds.config().protege.daysToGrow - 1;
        g.world.day++;
        const out = Bonds.processDay(g.world, g.player);
        expect(pr.grown).toBe(g.world.day);
        const npc = Relationships.getNPC(pr.npcId);
        expect(npc.loyalty).toBeGreaterThanOrEqual(90);
        expect(Bonds.get(g.player, npc.id).kind).toBe('protege');
        expect(out.notices.some(n => n.title === 'A Protégé Comes of Age')).toBe(true);
        g.player.house = null;
        const sv = Bonds.takeIntoService(g.player, g.world, npc.id);
        expect(sv.success).toBe(true);
        expect(g.player.travelParty).toContain(npc.id);
    }, 120000);
});

describe('friends act', () => {
    it('a strong friend in your party fights beside you, and the battle binds you', () => {
        const a = friendHere(70);
        Bonds.processDay(g.world, g.player);
        const b = Bonds.get(g.player, a.id);
        b.strength = 80;
        g.player.travelParty.push(a.id);
        const aid = Bonds.battleAid(g.player, g.world);
        expect(aid.mult).toBeGreaterThan(1);
        expect(aid.names).toContain(a.firstName);
        const s0 = b.strength;
        Bonds.onBattle(g.player, g.world, true, 'Bandits');
        expect(b.strength).toBeGreaterThan(s0);
        expect(b.deeds.battle).toBe(1);
    }, 120000);

    it('a friend lends you coin from their own purse when yours is empty, and you repay it', () => {
        const a = friendHere(80);
        Bonds.processDay(g.world, g.player);
        const b = Bonds.get(g.player, a.id);
        b.strength = 70;
        a.purse = 200;
        g.player.gold = 0;
        g.world.day++;
        const out = Bonds.processDay(g.world, g.player);
        expect(g.player.gold).toBeGreaterThan(0);
        expect(b.owed.amount).toBe(g.player.gold);
        expect(a.purse).toBe(200 - b.owed.amount);
        expect(out.notices.some(n => n.title === 'A Friend in Need')).toBe(true);
        const r = Bonds.repay(g.player, g.world, a.id);
        expect(r.success).toBe(true);
        expect(g.player.gold).toBe(0);
        expect(a.purse).toBe(200);
    }, 120000);

    it('a friend warns you of an enemy\'s blow (pure, deterministic)', () => {
        const a = friendHere(90);
        Bonds.processDay(g.world, g.player);
        const b = Bonds.get(g.player, a.id);
        b.strength = 100;
        b.sworn = { day: 1, place: 'the church' };
        let hit = null;
        for (let i = 0; i < 20 && !hit; i++) { g.world.day++; hit = Bonds.forewarn(g.player, g.world, 'Lord Vex', 'assassin'); }
        expect(hit).toBeTruthy();
        expect(hit.text).toMatch(/Lord Vex/);
        // the same day asks the same dice
        const again = Bonds.forewarn(g.player, g.world, 'Lord Vex', 'assassin');
        expect(!!again).toBe(true);
    }, 120000);

    it('a friend vouches for you before their realm', () => {
        const a = friendHere(80);
        Bonds.processDay(g.world, g.player);
        Bonds.get(g.player, a.id).strength = 70;
        a.kingdomId = a.kingdomId != null ? a.kingdomId : g.world.kingdoms[0].id;
        g.player.reputation = g.player.reputation || {};
        const before = g.player.reputation[a.kingdomId] || 0;
        const r = Bonds.askVouch(g.player, g.world, a.id);
        expect(r.success).toBe(true);
        expect(g.player.reputation[a.kingdomId]).toBeGreaterThan(before);
        expect(Bonds.askVouch(g.player, g.world, a.id).success).toBe(false);
    }, 120000);
});

describe('betrayal', () => {
    it('you betray a friend: the fee from real coin, a grudge, a rumour, the bond ended', () => {
        const a = friendHere(70);
        Bonds.processDay(g.world, g.player);
        const k = g.world.kingdoms.find(x => x && x.id === a.kingdomId) || g.world.kingdoms[0];
        a.kingdomId = k.id;
        k.treasury = 5000;
        const gold = g.player.gold;
        const res = Bonds.betray(g.player, g.world, a.id);
        expect(res.success).toBe(true);
        expect(g.player.gold).toBe(gold + res.paid);
        expect(k.treasury).toBe(5000 - res.paid);
        expect(Bonds.get(g.player, a.id)).toBeNull();
        expect(Nemesis.state(g.player).grudges.some(x => x.deed.key === 'betrayal')).toBe(true);
        expect(Hearsay.state(g.player).rumours.some(r => r.k === 'betrayal')).toBe(true);
        // never again
        g.player.relationships[a.id].score = 90;
        g.world.day++;
        Bonds.processDay(g.world, g.player);
        expect(Bonds.get(g.player, a.id)).toBeNull();
    }, 120000);

    it('a slighted friend turns on you', () => {
        const a = friendHere(60);
        Bonds.processDay(g.world, g.player);
        const b = Bonds.get(g.player, a.id);
        b.grievance = 80;
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        while (g.world.day % 7 !== 0) g.world.day++;
        const out = Bonds.processDay(g.world, g.player);
        expect(Bonds.get(g.player, a.id)).toBeNull();
        expect(a.betrayedPlayer).toBe(g.world.day);
        expect(out.notices.some(n => n.title === 'A Friend Turns')).toBe(true);
    }, 120000);
});

describe('heirs, the LLM persona, saves', () => {
    it('at a succession strong bonds pass on as old family friends', () => {
        const a = friendHere(80);
        const w = friendHere(45);
        Bonds.processDay(g.world, g.player);
        Bonds.get(g.player, a.id).strength = 80;
        Bonds.get(g.player, w.id).strength = 10;
        g.player.house = g.player.house || { name: 'House Test', generation: 1, rivals: {} };
        g.world.day++;
        Bonds.processDay(g.world, g.player);
        g.player.house.generation = (g.player.house.generation || 1) + 1;
        g.player.name = 'Newhead Test';
        g.player.relationships = {};
        g.world.day++;
        const out = Bonds.processDay(g.world, g.player);
        const b = Bonds.get(g.player, a.id);
        expect(b.kind).toBe('family_friend');
        expect(b.strength).toBe(40);
        expect(g.player.relationships[a.id].score).toBeGreaterThan(0);
        expect(Bonds.get(g.player, w.id)).toBeNull();
        expect(out.notices.some(n => n.title === 'Old Family Friends')).toBe(true);
    }, 120000);

    it('the free-talk persona carries a line about the bond', () => {
        const a = friendHere(80);
        Bonds.processDay(g.world, g.player);
        Bonds.get(g.player, a.id).sworn = { day: 3, place: 'the church of Here' };
        const who = NpcChat.relationshipSubject(g.player, a);
        const lines = Bonds.personaLines(g.player, g.world, who);
        expect(lines[0]).toMatch(/sworn kin/);
        expect(NpcChat.persona(g.player, g.world, who)).toMatch(/sworn kin/);
    }, 120000);

    it('bonds survive a save and load', () => {
        const a = friendHere(70);
        Bonds.processDay(g.world, g.player);
        Bonds.drinkWith(g.player, g.world, a.id);
        const s = Bonds.get(g.player, a.id).strength;
        const g2 = roundTrip(g);
        const b2 = Bonds.get(g2.player, a.id);
        expect(b2).toBeTruthy();
        expect(b2.strength).toBe(s);
        expect(b2.deeds.drink).toBe(1);
    }, 120000);
});

describe('the Friends & Bonds panel', () => {
    it('renders bonds, actions and protégé candidates, and routes an action', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const a = friendHere(80);
        Bonds.processDay(g.world, g.player);
        Bonds.get(g.player, a.id).strength = 80;
        let shown = null;
        const notes = [];
        const game = {
            player: g.player, world: g.world,
            ui: { showCustomPanel: (t, h) => { shown = { t, h }; }, showNotification: (...x) => notes.push(x), updateStats: () => {} },
        };
        ActionMenu.showBondsPanel(game);
        expect(shown.t).toMatch(/Friends & Bonds/);
        expect(shown.h).toContain(a.firstName);
        expect(shown.h).toContain('Swear kinship');
        expect(shown.h).toContain('Drink together');
        ActionMenu.bondsAct(game, 'drink', a.id);
        expect(Bonds.get(g.player, a.id).deeds.drink).toBe(1);
        expect(notes.length).toBe(0);
        ActionMenu.bondsAct(game, 'betrayAsk', a.id);
        expect(shown.h).toContain('Sell them out');
    }, 120000);
});
