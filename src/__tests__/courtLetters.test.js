// The lords remember, and they write: per-lord memory of the player's deeds
// (world/npcLords.js rememberDeed / memoryOf, read by getLordOpinion and
// RealmWars.hostility, half-inherited by an heir) and the court letters
// lords, the liege, rival Houses, the spouse and children abroad send
// (systems/courtLetters.js) — each answer moving real state.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { NPCLords, NpcLords } from '../world/npcLords.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { House } from '../systems/house.js';
import { Heirs } from '../systems/heirs.js';
import { RealmWars } from '../systems/realmWars.js';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const W = 30;
const H = 20;

function makeWorld(day = 40) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: { id: 'grassland', passable: true } });
        tiles.push(row);
    }
    const lord = (name, kid, traits, extra = {}) => ({ name, kingdomId: kid, age: 50, traits, honor: 6, martial: 5, diplomacy: 5, stewardship: 5, relationships: {}, goals: [], ...extra });
    const world = {
        day, width: W, height: H, tiles, units: [], events: [], generationParams: { seed: 4242 },
        kingdoms: [
            { id: 'k1', name: 'Arvenland', ruler: 'Queen Maud', isAlive: true, wars: ['k2'], allies: [], relations: {}, warState: {}, stability: 60, treasury: 3000, military: 200, culture: 'Imperial', territory: [],
                lord: lord('Queen Maud', 'k1', [{ id: 'honorable', name: 'Honorable' }]) },
            { id: 'k2', name: 'Belmarch', ruler: 'King Osric', isAlive: true, wars: ['k1'], allies: [], relations: {}, warState: {}, stability: 60, treasury: 2000, military: 180, culture: 'Imperial', territory: [],
                lord: lord('King Osric', 'k2', [{ id: 'brave', name: 'Brave' }]) },
            { id: 'k3', name: 'Corwen', ruler: 'Duke Alys', isAlive: true, wars: [], allies: [], relations: {}, warState: {}, stability: 60, treasury: 100, military: 90, culture: 'Imperial', territory: [],
                lord: lord('Duke Alys', 'k3', [{ id: 'greedy', name: 'Greedy' }]) },
        ],
        getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [],
        getAllSettlements: () => [],
    };
    return world;
}

function makePlayer(world) {
    const p = new Player();
    p.name = 'Aldric';
    p.lastName = 'Vane';
    p.q = 5; p.r = 5;
    p.gold = 2000;
    p.renown = 20;
    p.karma = 0;
    p.health = 100;
    p.reputation = { k1: 10, k2: 0, k3: 5 };
    p.relationships = {};
    p.children = [];
    p.army = [{ type: 'Spearman', strength: 5, morale: 70 }];
    House.initialize(p, world);
    return p;
}

function addChild(player, id, name, age = 18) {
    const c = { id, firstName: name, dynasty: 'Vane', isAlive: true, age, gender: 'female', traits: [], skills: {} };
    Upbringing.ensure(c).comeOfAge = true;
    player.children.push(c);
    return c;
}

/** A letter of `kind` from `ctx` straight into the inbox. */
function send(world, player, kind, ctx) {
    return CourtLetters.deliver(player, CourtLetters.compose(world, player, kind, ctx));
}

function lordCtx(k) {
    return { key: `lord:${k.id}`, from: { type: 'lord', kingdomId: k.id, name: `${k.lord.name} of ${k.name}` }, kingdom: k };
}

let world;
let player;
beforeEach(() => {
    Utils.setSeed(99);
    world = makeWorld();
    player = makePlayer(world);
});

describe('Lord memory (world/npcLords.js)', () => {
    it('remembers a data-driven deed, which fades by half each half-life', () => {
        const lord = world.kingdoms[0].lord;
        const def = NPCLords.deedDef('oath_broken');
        expect(def && def.weight).toBeLessThan(0);
        const e = NpcLords.rememberDeed(world, lord, 'oath_broken', { note: 'left at Brindle' });
        expect(e).toBeTruthy();
        const now = NpcLords.memoryOf(lord, world.day);
        expect(now[0]).toMatchObject({ key: 'oath_broken', note: 'left at Brindle', inherited: false });
        expect(now[0].weight).toBeCloseTo(def.weight, 5);
        const later = NpcLords.memoryOf(lord, world.day + def.halfLife);
        expect(later[0].weight).toBeCloseTo(def.weight / 2, 1);
        expect(NPCLords.rememberDeed(world, lord, 'no_such_deed')).toBeNull();
    });

    it('feeds getLordOpinion and caps the sum', () => {
        const lord = world.kingdoms[0].lord;
        const before = NPCLords.getLordOpinion(lord, player, world);
        NPCLords.rememberDeed(world, lord, 'gift_treasure');
        expect(NPCLords.getLordOpinion(lord, player, world)).toBe(before + NPCLords.deedDef('gift_treasure').weight);
        for (let i = 0; i < 10; i++) NPCLords.rememberDeed(world, lord, 'conquest', { note: `town ${i}` });
        expect(NPCLords.memoryOpinion(lord, world.day)).toBe(-NPCLords.memoryConfig().cap);
    });

    it('merges the same deed within a few days, up to its stack cap', () => {
        const lord = world.kingdoms[0].lord;
        for (let i = 0; i < 10; i++) NPCLords.rememberDeed(world, lord, 'gift');
        const mem = NPCLords.memoryOf(lord, world.day);
        expect(mem).toHaveLength(1);
        expect(mem[0].weight).toBeCloseTo(NPCLords.deedDef('gift').weight * NPCLords.memoryConfig().stackCap, 5);
    });

    it('an heir inherits part of a dead lord\'s memory: "my father spoke of you"', () => {
        const k = world.kingdoms[0];
        NPCLords.rememberDeed(world, k.lord, 'restored_crown');
        NPCLords.rememberDeed(world, k.lord, 'letter_ignored');
        const old = k.lord;
        NPCLords.lordDies(k, world);
        expect(k.lord).not.toBe(old);
        const mem = NPCLords.memoryOf(k.lord, world.day);
        const restored = mem.find(m => m.key === 'restored_crown');
        expect(restored).toMatchObject({ inherited: true, from: 'Queen Maud' });
        expect(restored.weight).toBeCloseTo(NPCLords.deedDef('restored_crown').weight * NPCLords.memoryConfig().inheritShare, 1);
        // A slight too small to pass on is forgotten with the lord
        expect(mem.find(m => m.key === 'letter_ignored')).toBeUndefined();
        expect(k.lord.memoryFrom).toBe('Queen Maud');
    });

    it('a remembered wrong makes a realm likelier to make war on you (RealmWars.hostility)', () => {
        const k = world.kingdoms[2];
        const before = RealmWars.hostility(player, k);
        NPCLords.rememberDeed(world, k.lord, 'conquest');
        expect(RealmWars.hostility(player, k)).toBeGreaterThan(before);
    });

    it('a child wed into a realm is remembered (Heirs.marryForAlliance)', () => {
        const c = addChild(player, 'c1', 'Elin');
        const res = Heirs.marryForAlliance(player, world, c.id, 'k3');
        expect(res.success).toBe(true);
        expect(NPCLords.memoryOf(world.kingdoms[2].lord).map(m => m.key)).toContain('child_wed');
    });

    it('memories travel with the kingdom in a save', () => {
        NPCLords.rememberDeed(world, world.kingdoms[1].lord, 'threat');
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializeKingdoms(world.kingdoms)));
        expect(saved[1].lord.memory[0].k).toBe('threat');
    });
});

describe('Court letters (systems/courtLetters.js)', () => {
    it('the daily tick delivers letters on its own seeded stream, rate-limited', () => {
        player.allegiance = 'k1';
        Utils.setSeed(5);
        const expected = Utils.random();
        Utils.setSeed(5);
        const arrived = [];
        for (let d = 1; d <= 60; d++) {
            world.day = d;
            arrived.push(...CourtLetters.processDay(world, player).arrived);
        }
        // The main stream is untouched by the tick
        expect(Utils.random()).toBe(expected);
        expect(arrived.length).toBeGreaterThan(3);
        expect(CourtLetters.open(player).length).toBeLessThanOrEqual(CourtLetters.config().maxOpen);
        const days = arrived.filter(l => l.kind !== 'loan_default').map(l => l.day);
        for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(CourtLetters.config().gap[0]);

        // Deterministic: the same world and seed bring the same letters
        const w2 = makeWorld();
        const p2 = makePlayer(w2);
        p2.allegiance = 'k1';
        const again = [];
        for (let d = 1; d <= 60; d++) {
            w2.day = d;
            again.push(...CourtLetters.processDay(w2, p2).arrived);
        }
        expect(again.map(l => `${l.day}:${l.kind}:${l.key}`)).toEqual(arrived.map(l => `${l.day}:${l.kind}:${l.key}`));
    });

    it('a call to arms: promise to ride, kept by a campaign win', () => {
        player.allegiance = 'k1';
        const cands = CourtLetters._candidates(world, player, 'call_to_arms');
        expect(cands).toHaveLength(1);
        const letter = send(world, player, 'call_to_arms', cands[0]);
        const res = CourtLetters.answer(player, world, letter.id, 'ride');
        expect(res.success).toBe(true);
        expect(CourtLetters.state(player).promises).toHaveLength(1);
        expect(NPCLords.memoryOf(world.kingdoms[0].lord).map(m => m.key)).toContain('call_answered');
        // Win a campaign battle (RealmPolitics merit) and the promise is kept
        player.politics = { merit: { 'k1:k2': 1 }, brokerCooldown: {} };
        world.day += 1;
        const out = CourtLetters.processDay(world, player);
        expect(out.notices.some(n => n.title === 'Your Word Kept')).toBe(true);
        expect(NPCLords.memoryOf(world.kingdoms[0].lord).map(m => m.key)).toContain('kept_promise');
        expect(CourtLetters.state(player).stats.kept).toBe(1);
    });

    it('a call to arms: a promise not kept is broken when the term runs out', () => {
        player.allegiance = 'k1';
        const letter = send(world, player, 'call_to_arms', CourtLetters._candidates(world, player, 'call_to_arms')[0]);
        CourtLetters.answer(player, world, letter.id, 'ride');
        world.day += 31;
        const rep = player.reputation.k1;
        CourtLetters.processDay(world, player);
        expect(CourtLetters.state(player).stats.broken).toBe(1);
        expect(player.reputation.k1).toBeLessThan(rep);
        expect(NPCLords.memoryOf(world.kingdoms[0].lord).map(m => m.key)).toContain('broken_promise');
    });

    it('a call to arms: gold goes to the war chest; silence is remembered worst of all', () => {
        player.allegiance = 'k1';
        const k1 = world.kingdoms[0];
        const letter = send(world, player, 'call_to_arms', CourtLetters._candidates(world, player, 'call_to_arms')[0]);
        const gold = player.gold;
        const chest = k1.treasury;
        expect(CourtLetters.answer(player, world, letter.id, 'gold').success).toBe(true);
        expect(player.gold).toBe(gold - letter.data.amount);
        expect(k1.treasury).toBe(chest + letter.data.amount);
        expect(player.financeToday.expenses.diplomacy).toBe(letter.data.amount);

        const w2 = makeWorld();
        const p2 = makePlayer(w2);
        p2.allegiance = 'k1';
        const l2 = send(w2, p2, 'call_to_arms', CourtLetters._candidates(w2, p2, 'call_to_arms')[0]);
        w2.day = l2.expires + 1;
        const rep = p2.reputation.k1;
        CourtLetters.processDay(w2, p2);
        expect(CourtLetters.open(p2).find(l => l.id === l2.id)).toBeUndefined();
        expect(p2.reputation.k1).toBeLessThan(rep);
        expect(NPCLords.memoryOf(w2.kingdoms[0].lord).map(m => m.key)).toContain('call_ignored');
        expect(CourtLetters.state(p2).archive[0].outcome).toBe('ignored');
    });

    it('a loan to a lord is repaid with interest through the ledger, or defaulted into a plea', () => {
        const k3 = world.kingdoms[2];
        const cand = CourtLetters._candidates(world, player, 'loan_request').find(c => c.kingdom === k3);
        expect(cand).toBeTruthy();
        const letter = send(world, player, 'loan_request', cand);
        const gold = player.gold;
        expect(CourtLetters.answer(player, world, letter.id, 'lend').success).toBe(true);
        expect(player.gold).toBe(gold - letter.data.amount);
        const loan = CourtLetters.state(player).loans[0];
        expect(loan.status).toBe('open');
        // No second loan request from a crown already in your debt
        expect(CourtLetters._candidates(world, player, 'loan_request').some(c => c.kingdom === k3)).toBe(false);

        k3.treasury = 0;
        k3.lord.honor = 0; // a poor, faithless crown
        world.day = loan.due;
        Utils.setSeed(1);
        let st = CourtLetters.state(player);
        for (let i = 0; i < 40 && st.loans[0].status === 'open'; i++) {
            st.loans[0].status = 'open';
            CourtLetters._loans(world, player, { notices: [], arrived: [] });
        }
        expect(['repaid', 'defaulted']).toContain(st.loans[0].status);
        if (st.loans[0].status === 'defaulted') {
            const plea = CourtLetters.open(player).find(l => l.kind === 'loan_default');
            expect(plea).toBeTruthy();
            expect(CourtLetters.answer(player, world, plea.id, 'forgive').success).toBe(true);
            expect(NPCLords.memoryOf(k3.lord).map(m => m.key)).toContain('loan_forgiven');
        }
        // A rich, honest crown repays
        const w2 = makeWorld();
        const p2 = makePlayer(w2);
        const l2 = send(w2, p2, 'loan_request', CourtLetters._candidates(w2, p2, 'loan_request').find(c => c.kingdom.id === 'k3'));
        CourtLetters.answer(p2, w2, l2.id, 'lend');
        w2.kingdoms[2].treasury = 100000;
        w2.kingdoms[2].lord.honor = 10;
        const owed = CourtLetters.state(p2).loans[0];
        w2.day = owed.due;
        const before = p2.gold;
        Utils.setSeed(3);
        CourtLetters._loans(w2, p2, { notices: [], arrived: [] });
        st = CourtLetters.state(p2);
        if (st.loans[0].status === 'repaid') {
            expect(p2.gold).toBe(before + owed.principal + owed.interest);
            expect(p2.financeToday.income.lordLoanInterest).toBe(owed.interest);
        }
    });

    it('rival House letters move the feud', () => {
        player.house.rivals = { k2: { kingdomId: 'k2', name: 'House Osric', feud: 55, lastActedDay: 0 } };
        const truce = CourtLetters._candidates(world, player, 'rival_truce')[0];
        expect(truce).toBeTruthy();
        const l1 = send(world, player, 'rival_truce', truce);
        CourtLetters.answer(player, world, l1.id, 'accept');
        expect(player.house.rivals.k2.feud).toBe(30);

        player.house.rivals.k2.feud = 60;
        const l2 = send(world, player, 'rival_tribute', CourtLetters._candidates(world, player, 'rival_tribute')[0]);
        const renown = player.renown;
        CourtLetters.answer(player, world, l2.id, 'insult');
        expect(player.house.rivals.k2.feud).toBe(80);
        expect(player.renown).toBeGreaterThan(renown);

        const c = addChild(player, 'c2', 'Brannagh');
        const l3 = send(world, player, 'rival_marriage', CourtLetters._candidates(world, player, 'rival_marriage')[0]);
        expect(l3.vars.child).toBe('Brannagh');
        CourtLetters.answer(player, world, l3.id, 'accept');
        expect(player.house.rivals.k2.feud).toBe(20);
        expect(Upbringing.ensure(c).spouse).toMatchObject({ kind: 'alliance', kingdomId: 'k2' });
    });

    it('a marriage proposal weds a grown child and brings a dowry', () => {
        const c = addChild(player, 'c3', 'Isolde');
        const cand = CourtLetters._candidates(world, player, 'marriage_proposal').find(x => x.kingdom.id === 'k3');
        const letter = send(world, player, 'marriage_proposal', cand);
        const gold = player.gold;
        expect(CourtLetters.answer(player, world, letter.id, 'accept').success).toBe(true);
        expect(player.gold).toBeGreaterThan(gold);
        expect(Upbringing.ensure(c).spouse.kingdomId).toBe('k3');
        expect(NPCLords.memoryOf(world.kingdoms[2].lord).map(m => m.key)).toContain('match_accepted');
        // The child is no longer free to be offered
        expect(CourtLetters._candidates(world, player, 'marriage_proposal')).toHaveLength(0);
    });

    it('the spouse pleads for their homeland at war; the answer moves their affection', () => {
        player.allegiance = 'k1';
        const npc = { id: 'npc_spouse_test', firstName: 'Rhosyn', dynasty: 'Osric', kingdomId: 'k2', isAlive: true };
        Relationships._npcs.push(npc);
        player.spouse = npc.id;
        player.marriageAllianceKingdom = 'k2';
        Relationships.getRelationship(player, npc.id).affection = 50;
        try {
            const cand = CourtLetters._candidates(world, player, 'spouse_plea');
            expect(cand).toHaveLength(1);
            const letter = send(world, player, 'spouse_plea', cand[0]);
            // "Offer terms" is only for the player's own war
            expect(CourtLetters.choicesFor(player, world, letter).map(c => c.id)).not.toContain('terms');
            CourtLetters.answer(player, world, letter.id, 'plead');
            expect(Relationships.getRelationship(player, npc.id).affection).toBe(62);
            expect(world.kingdoms[0].relations.k2).toBeGreaterThan(0);
            expect(NPCLords.memoryOf(world.kingdoms[1].lord).map(m => m.key)).toContain('spouse_kin_spoken');
        } finally {
            Relationships._npcs.splice(Relationships._npcs.indexOf(npc), 1);
        }
    });

    it('a child married abroad writes news, and fears for their safety when war comes', () => {
        const c = addChild(player, 'c4', 'Maren');
        Heirs.marryForAlliance(player, world, c.id, 'k3');
        const news = CourtLetters._candidates(world, player, 'child_news');
        expect(news).toHaveLength(1);
        const l1 = send(world, player, 'child_news', news[0]);
        expect(l1.body).toContain('treasury');
        const res = CourtLetters.answer(player, world, l1.id, 'intel');
        expect(res.success).toBe(true);
        expect(player.kingdomKnowledge.k3.military).toBe(true);

        // War between the player's liege and the child's new home
        player.allegiance = 'k1';
        world.kingdoms[0].wars.push('k3');
        world.kingdoms[2].wars.push('k1');
        expect(CourtLetters._candidates(world, player, 'child_news')).toHaveLength(0);
        const fear = CourtLetters._candidates(world, player, 'child_hostage');
        expect(fear).toHaveLength(1);
        const l2 = send(world, player, 'child_hostage', fear[0]);
        CourtLetters.answer(player, world, l2.id, 'recall');
        expect(Upbringing.ensure(c).recalledHome).toBeTruthy();
        expect(NPCLords.memoryOf(world.kingdoms[2].lord).map(m => m.key)).toContain('child_recalled');
        expect(CourtLetters._candidates(world, player, 'child_hostage')).toHaveLength(0);
    });

    it('a feast and a tournament by letter', () => {
        const k3 = world.kingdoms[2];
        const feast = send(world, player, 'feast_invite', lordCtx(k3));
        const renown = player.renown;
        CourtLetters.answer(player, world, feast.id, 'attend');
        expect(player.renown).toBeGreaterThan(renown);
        expect(NPCLords.memoryOf(k3.lord).map(m => m.key)).toContain('feast_attended');

        const tour = send(world, player, 'tournament_invite', lordCtx(k3));
        const res = CourtLetters.answer(player, world, tour.id, 'compete');
        expect(res.success).toBe(true);
        expect(res.lines.join(' ')).toMatch(/Champion|Runner-up|Unhorsed/);
        expect(NPCLords.memoryOf(k3.lord).some(m => m.key === 'tourney_attended' || m.key === 'tourney_champion')).toBe(true);
    });

    it('an office offered by the liege', () => {
        player.allegiance = 'k1';
        player.skills = { combat: 10, commerce: 10, leadership: 10, diplomacy: 10, stealth: 10, cartography: 10 };
        const t = CourtLetters.offerTitle(player, world);
        expect(t).toBeTruthy();
        const cand = CourtLetters._candidates(world, player, 'office_offer');
        expect(cand).toHaveLength(1);
        const letter = send(world, player, 'office_offer', cand[0]);
        const res = CourtLetters.answer(player, world, letter.id, 'accept');
        expect(res.success).toBe(true);
        expect(player.currentTitle).toBe(t.id);
    });

    it('a refused answer is refused (not enough gold) and the letter stays open', () => {
        const letter = send(world, player, 'feast_invite', lordCtx(world.kingdoms[2]));
        player.gold = 0;
        const res = CourtLetters.answer(player, world, letter.id, 'attend');
        expect(res.success).toBe(false);
        expect(CourtLetters.open(player).some(l => l.id === letter.id)).toBe(true);
    });

    it('the inbox saves and loads; older saves get a blank one', () => {
        send(world, player, 'feast_invite', lordCtx(world.kingdoms[2]));
        const saved = CourtLetters.serialize(player);
        const p2 = new Player();
        p2.letters = JSON.parse(JSON.stringify(saved));
        CourtLetters.loadState(p2);
        expect(p2.letters.inbox).toHaveLength(1);
        const p3 = new Player();
        delete p3.letters;
        CourtLetters.loadState(p3);
        expect(p3.letters.inbox).toEqual([]);
        expect(p3.letters.stats.received).toBe(0);
    });
});

describe('Letters panel', () => {
    it('renders every tab with letters of every kind, without leaking undefined/NaN', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        player.allegiance = 'k1';
        player.house.rivals = { k2: { kingdomId: 'k2', name: 'House Osric', feud: 70, lastActedDay: 0 } };
        addChild(player, 'c9', 'Wynn');
        for (const kind of Object.keys(CourtLetters.kinds())) {
            if (kind === 'loan_default') continue;
            const c = CourtLetters._candidates(world, player, kind)[0];
            if (c) send(world, player, kind, c);
        }
        send(world, player, 'loan_default', { ...lordCtx(world.kingdoms[2]), amount: 300, loanId: 'Lx' });
        NPCLords.rememberDeed(world, world.kingdoms[0].lord, 'oath_sworn');
        const shown = [];
        const game = {
            player, world,
            ui: {
                showCustomPanel: (title, html) => shown.push(html),
                showNotification: () => {}, updateStats: () => {}, hideCustomPanel: () => {},
            },
        };
        for (const tab of ['inbox', 'answered', 'accounts', 'memory']) {
            ActionMenu.lettersAct(game, 'tab', tab);
        }
        const first = CourtLetters.open(player)[0];
        ActionMenu.lettersAct(game, 'tab', 'inbox');
        ActionMenu.lettersAct(game, 'answer', first.id, CourtLetters.choicesFor(player, world, first)[0].id);
        ActionMenu.lettersAct(game, 'tab', 'answered');
        expect(shown.length).toBeGreaterThanOrEqual(6);
        for (const html of shown) {
            const text = html.replace(/<[^>]*>/g, ' ');
            expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
            expect(html).not.toMatch(/\{(from|realm|child|amount|enemy|title)\}/);
        }
        ActionMenu.lettersAct(game, 'tab', 'inbox');
    });
});

describe('The royal audience remembers', () => {
    it('lists what the lord remembers and opens with it; an heir speaks of a parent', async () => {
        const { ConversationScene } = await import('../ui/conversationScene.js');
        const { openLordAudience } = await import('../ui/actionMenu/lordAudience.js');
        const k = world.kingdoms[0];
        world.units.push({ id: 'lp1', type: 'lord_party', kingdomId: 'k1', q: 5, r: 5 });
        NPCLords.rememberDeed(world, k.lord, 'oath_broken');
        let cfg = null;
        const scene = { isOpen: true, overlay: { querySelector: () => null }, choices() {}, afterSpoken() {}, setMood() {}, npc() {}, leave() {} };
        const spy = vi.spyOn(ConversationScene, 'open').mockImplementation((c) => { cfg = c; return scene; });
        const game = { player, world, ui: { showNotification() {}, updateStats() {} } };
        try {
            openLordAudience(game, 'lp1');
            expect(cfg.facts).toContain('remembers the oath you renounced');
            expect(cfg.greeting).toContain(NPCLords.deedDef('oath_broken').recall);
            NPCLords.lordDies(k, world);
            k.lord.name = 'King Edric';
            openLordAudience(game, 'lp1');
            expect(cfg.facts).toMatch(/spoke of the oath you renounced/);
            expect(cfg.greeting).toMatch(/Queen Maud, spoke of you/);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('The price of silence (lapseCosts, senderScale, withdrawn offers, grievances)', () => {
    const lapseAll = (w, p, letter) => { w.day = letter.expires + 1; return CourtLetters.processDay(w, p); };

    it('a feast left unanswered costs opinion and reputation, withdraws the invitation, and says so', () => {
        const k3 = world.kingdoms[2];
        const letter = send(world, player, 'feast_invite', lordCtx(k3));
        const preview = CourtLetters.view(player, world).open.find(l => l.id === letter.id);
        expect(preview.ifIgnored.join(' ')).toMatch(/opinion with Duke Alys/);
        expect(preview.since).toBe(letter.day);
        expect(preview.due).toBe(letter.expires);
        const rep = player.reputation.k3;
        const out = lapseAll(world, player, letter);
        expect(NPCLords.memoryOf(k3.lord, world.day).map(m => m.key)).toContain('feast_snubbed');
        expect(player.reputation.k3).toBeLessThan(rep);
        const notice = out.notices.find(n => n.title === 'A Letter Unanswered');
        expect(notice.text).toMatch(/Cost: .*opinion with Duke Alys/);
        const filed = CourtLetters.state(player).archive[0];
        expect(filed).toMatchObject({ outcome: 'ignored', lapsed: world.day });
        expect(filed.waited).toBe(world.day - letter.day);
        expect(filed.costs.length).toBeGreaterThan(0);
        // The lost offer: that court sends no feast invitation for a while (read by the daily tick)
        expect(CourtLetters.isWithdrawn(player, 'feast_invite', letter.from, world.day)).toBe(true);
        expect(CourtLetters.isWithdrawn(player, 'tournament_invite', letter.from, world.day)).toBe(false);
        expect(CourtLetters.isWithdrawn(player, 'feast_invite', letter.from, world.day + 400)).toBe(false);
    });

    it('scales with the sender: snubbing your liege costs more than a lesser lord, a child least', () => {
        player.allegiance = 'k1';
        const liegeLetter = CourtLetters.compose(world, player, 'feast_invite', lordCtx(world.kingdoms[0]));
        const lordLetter = CourtLetters.compose(world, player, 'feast_invite', lordCtx(world.kingdoms[2]));
        const liege = CourtLetters.senderScale(world, player, liegeLetter);
        const lord = CourtLetters.senderScale(world, player, lordLetter);
        expect(liege.type).toBe('liege');
        expect(liege.scale).toBeGreaterThan(lord.scale);
        const child = CourtLetters.senderScale(world, player, { from: { type: 'child', childId: 'c1', kingdomId: 'k3', name: 'Ada' } });
        expect(child.scale).toBeLessThan(liege.scale);
        const cl = CourtLetters.lapseCosts(world, player, liegeLetter).effects.find(e => e.type === 'deed');
        const cs = CourtLetters.lapseCosts(world, player, lordLetter).effects.find(e => e.type === 'deed');
        expect(cl.n).toBeLessThan(cs.n); // more negative
    });

    it('each silence toward the same court weighs more, and the third brings a grievance', () => {
        const k3 = world.kingdoms[2];
        const scales = [];
        let last;
        for (let i = 0; i < 3; i++) {
            const letter = send(world, player, 'loan_request', { ...lordCtx(k3), amount: 100 });
            scales.push(CourtLetters.senderScale(world, player, letter).scale);
            last = lapseAll(world, player, letter);
        }
        expect(scales[1]).toBeGreaterThan(scales[0]);
        expect(scales[2]).toBeGreaterThan(scales[1]);
        expect(NPCLords.memoryOf(k3.lord, world.day).map(m => m.key)).toContain('letters_scorned');
        expect(CourtLetters.state(player).stats.grievances).toBe(1);
        expect(last.notices.some(n => n.title === 'A Letter Unanswered' && /grievance/.test(n.text))).toBe(true);
    });

    it('a withdrawn offer keeps that sender out of the daily draw', () => {
        const k3 = world.kingdoms[2];
        const st = CourtLetters.state(player);
        st.withdrawn[`feast_invite|lord:${k3.id}`] = world.day + 100;
        st.withdrawn[`tournament_invite|lord:${k3.id}`] = world.day + 100;
        st.withdrawn[`loan_request|lord:${k3.id}`] = world.day + 100;
        for (let d = 0; d < 60; d++) {
            world.day++;
            CourtLetters.processDay(world, player);
            for (const l of CourtLetters.open(player)) {
                if (l.from.kingdomId === 'k3') expect(['feast_invite', 'tournament_invite', 'loan_request']).not.toContain(l.kind);
                CourtLetters.state(player).inbox = [];
            }
        }
    });

    it('silence toward your spouse and a rival House still costs affection and feud; old saves gain the new state', () => {
        const old = { inbox: [], archive: [], stats: { received: 1 } };
        player.letters = old;
        const st = CourtLetters.state(player);
        expect(st.snubs).toEqual({});
        expect(st.withdrawn).toEqual({});
        const truce = CourtLetters.compose(world, player, 'rival_truce', { key: 'rival:k2', from: { type: 'rival', kingdomId: 'k2', name: 'House Osric' }, kingdom: world.kingdoms[1] });
        const c = CourtLetters.lapseCosts(world, player, truce);
        expect(c.effects.map(e => e.type)).toEqual(expect.arrayContaining(['feud', 'withdraw']));
        const plea = CourtLetters.lapseCosts(world, player, { kind: 'spouse_plea', vars: {}, data: {}, from: { type: 'spouse', npcId: 'n1', kingdomId: 'k2', name: 'Elsa' } });
        expect(plea.effects).toEqual([expect.objectContaining({ type: 'affection', n: -20 })]);
        expect(CourtLetters.lapseCosts(world, player, { kind: 'family_report', vars: {}, data: {}, from: { type: 'child' } }).special).toBe('none');
    });
});
