// Companions with a life of their own: values & approval reacting to the
// player's deeds, wages, mood-scaled bonuses, personal quests through the
// quest machinery, bonds, desertion/betrayal, death in battle and save/load.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Companions } from '../systems/companions.js';
import { Relationships } from '../systems/relationships.js';
import { Traits } from '../systems/traits.js';
import { Quests } from '../systems/quests.js';
import { House } from '../systems/house.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Player } from '../player/player.js';
import { CompanionsPanel } from '../ui/companionsPanel.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

let world;
let player;

function makeNpc(id, occupation = 'knight', extra = {}) {
    const npc = {
        id, firstName: id.toUpperCase(), dynasty: 'Test', occupation, isAlive: true,
        kingdomId: 'k1', traits: [], ...extra,
    };
    Relationships._npcs.push(npc);
    player.relationships[id] = { score: 40, romantic: false, affection: 0, history: [] };
    return npc;
}

function recruit(npc, values = null) {
    player.travelParty.push(npc.id);
    const c = Companions.ensure(npc, world);
    if (values) c.values = values;
    return c;
}

function day(n = 1) {
    for (let i = 0; i < n; i++) {
        world.day++;
        Companions.processDay(player, world);
    }
}

beforeEach(() => {
    Relationships._npcs = [];
    world = {
        day: 10,
        kingdoms: [{ id: 'k1', name: 'Varr', isAlive: true, military: 500 }, { id: 'k2', name: 'Osk', isAlive: true, military: 400 }],
        getKingdom(id) { return this.kingdoms.find(k => k.id === id) || null; },
    };
    player = {
        id: 'p1', firstName: 'Ana', lastName: 'Ashborne', gold: 1000, karma: 0, renown: 10,
        reputation: { k1: 0, k2: 0 }, relationships: {}, travelParty: [], children: [], properties: [],
        health: 50, maxHealth: 100,
    };
    House.initialize(player, world);
    Quests.initialize(player);
});

describe('personality', () => {
    it('is generated deterministically from the id with 1–2 compatible values and a background', () => {
        const a = Companions.generatePersonality({ id: 'rnpc_7', occupation: 'merchant' });
        const b = Companions.generatePersonality({ id: 'rnpc_7', occupation: 'merchant' });
        expect(a).toEqual(b);
        const conflicts = DataLoader.companions.conflicts;
        for (let i = 1; i <= 40; i++) {
            const p = Companions.generatePersonality({ id: `rnpc_${i}`, occupation: 'healer' });
            expect(p.values.length).toBeGreaterThanOrEqual(1);
            expect(p.values.length).toBeLessThanOrEqual(2);
            for (const v of p.values) expect(Companions.values()[v]).toBeTruthy();
            if (p.values.length === 2) {
                expect(p.values[0]).not.toBe(p.values[1]);
                const clash = conflicts.some(c => c.includes(p.values[0]) && c.includes(p.values[1]));
                expect(clash).toBe(false);
            }
            expect(Companions.templates()[p.background]).toBeTruthy();
        }
    });

    it('does not draw from the RNG', () => {
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        Companions.ensure({ id: 'rnpc_99', occupation: 'guard' });
        expect(Utils.random()).toBe(before);
    });

    it('ships at least ten personal quest templates, each with a perk and objectives', () => {
        const tpl = Companions.templates();
        expect(Object.keys(tpl).length).toBeGreaterThanOrEqual(10);
        for (const def of Object.values(tpl)) {
            expect(Companions.perks()[def.perk]).toBeTruthy();
            expect(def.objectives.length).toBeGreaterThan(0);
            for (const o of def.objectives) expect(o.target).toBeGreaterThan(0);
        }
    });
});

describe('approval reacts to deeds', () => {
    it('Traits deeds move a companion according to their values, with a comment', () => {
        const kind = makeNpc('a', 'healer');
        recruit(kind, ['compassion']);
        day(); // first snapshot
        const start = kind.companion.approval;
        Traits.recordDeed(player, 'cruelty', 3);
        day();
        expect(kind.companion.approval).toBeLessThan(start);
        const notes = Companions.drainNotices(player);
        expect(notes.some(n => n.title.includes('disapproves'))).toBe(true);

        const mid = kind.companion.approval;
        Traits.recordDeed(player, 'mercy', 3);
        day();
        expect(kind.companion.approval).toBeGreaterThan(mid);
    });

    it('a newly earned trait is noticed', () => {
        const knight = makeNpc('k', 'knight');
        recruit(knight, ['honour']);
        day();
        const start = knight.companion.approval;
        Traits.getState(player).earned.craven = { since: world.day };
        day();
        expect(knight.companion.approval).toBeLessThan(start);
    });

    it('court rulings, piracy and karma swings all register', () => {
        const npc = makeNpc('c', 'healer');
        recruit(npc, ['compassion']);
        player.petitions = { stats: { ruled: 0 }, history: [] };
        day();
        let a = npc.companion.approval;
        player.petitions.stats.ruled = 1;
        player.petitions.history.push({ outcome: 'ruled', title: 'The Thief', court: { mercy: 2 } });
        day();
        expect(npc.companion.approval).toBeGreaterThan(a);

        a = npc.companion.approval;
        Quests.track(player, 'piracy_committed');
        day();
        expect(npc.companion.approval).toBeLessThan(a);

        a = npc.companion.approval;
        player.karma -= 6;
        day();
        expect(npc.companion.approval).toBeLessThan(a);
    });

    it('battles won and lost move ambitious companions', () => {
        const npc = makeNpc('b', 'general');
        recruit(npc, ['ambition']);
        Utils.setRng(() => 0.99); // nobody dies
        const a = npc.companion.approval;
        Companions.onBattle(player, true, { enemyName: 'Bandits' }, world);
        expect(npc.companion.approval).toBeGreaterThan(a);
        const b = npc.companion.approval;
        Companions.onBattle(player, false, { enemyName: 'Bandits' }, world);
        expect(npc.companion.approval).toBeLessThan(b);
    });
});

describe('wages', () => {
    it('pays every interval; unpaid wages hurt and leave a gripe', () => {
        const npc = makeNpc('w', 'guard');
        recruit(npc, ['honour']);
        const interval = Companions.config().payInterval;
        day(interval + 1);
        expect(player.gold).toBeLessThan(1000);
        expect(npc.companion.unpaid).toBe(0);

        player.gold = 0;
        const a = npc.companion.approval;
        day(interval);
        expect(npc.companion.unpaid).toBe(1);
        expect(npc.companion.approval).toBeLessThan(a);
        expect(npc.companion.gripe.kind).toBe('unpaid');

        player.gold = 500;
        const r = Companions.payWages(player, 'w', world);
        expect(r.success).toBe(true);
        expect(npc.companion.gripe).toBeNull();
    });
});

describe('mood scales the bonus', () => {
    it('loyal > content > mutinous, and a devoted perk adds on top', () => {
        const npc = makeNpc('g', 'general');
        recruit(npc, ['ambition']);
        const at = (approval) => { npc.companion.approval = approval; return PlayerEffects.companionBonus(player, 'power'); };
        const mutinous = at(10);
        const content = at(50);
        const loyal = at(80);
        expect(content).toBeCloseTo(0.12, 5);
        expect(loyal).toBeGreaterThan(content);
        expect(mutinous).toBeLessThan(content);
        npc.companion.devoted = true;
        npc.companion.perk = 'sworn_blade';
        expect(PlayerEffects.companionBonus(player, 'power')).toBeCloseTo(0.12 * 1.5 + 0.08, 5);
    });
});

describe('personal quests', () => {
    it('unlock at high approval, run as ordinary quests, and make the companion devoted', () => {
        const npc = makeNpc('q', 'knight');
        const c = recruit(npc, ['honour']);
        c.background = 'avenge_family';
        c.approval = 80;
        day(Companions.config().questMinDays);
        expect(c.quest && c.quest.status).toBe('offered');

        const r = Companions.acceptQuest(player, 'q', world);
        expect(r.success).toBe(true);
        expect(player.quests.active.some(q => q.id === r.quest.id && q.type === 'companion_quest')).toBe(true);

        Quests.track(player, 'battles_won', 3);
        const done = Quests.updateProgress(player, world);
        expect(done.map(q => q.id)).toContain(r.quest.id);
        day();
        expect(c.devoted).toBe(true);
        expect(c.perk).toBe('sworn_blade');
        expect(Companions.tier(npc).id).toBe('devoted');
        expect(player.house.history.some(h => (h.tags || []).includes('devoted'))).toBe(true);
    });

    it('a debt quest is paid down from the roster', () => {
        const npc = makeNpc('d', 'merchant');
        const c = recruit(npc, ['greed']);
        c.background = 'clear_debt';
        c.quest = { status: 'offered', day: world.day };
        const r = Companions.acceptQuest(player, 'd', world);
        expect(r.success).toBe(true);
        for (let i = 0; i < 6; i++) Companions.contribute(player, 'd', 50, world);
        expect(Companions.contribute(player, 'd', 50, world).success).toBe(false);
        expect(Quests.updateProgress(player, world).map(q => q.id)).toContain(r.quest.id);
        expect(player.gold).toBe(1000 - 300 + (Companions.templates().clear_debt.rewards.gold || 0));
    });

    it('a companion who leaves abandons their quest', () => {
        const npc = makeNpc('l', 'knight');
        const c = recruit(npc, ['honour']);
        c.background = 'avenge_family';
        c.quest = { status: 'offered', day: world.day };
        Companions.acceptQuest(player, 'l', world);
        Companions.dismiss(player, 'l', world);
        expect(player.quests.active.some(q => q.id.startsWith('companion_l_'))).toBe(false);
        expect(c.quest.status).toBe('abandoned');
    });
});

describe('low approval', () => {
    it('greedy companions demand a raise; granting it wins them back', () => {
        const npc = makeNpc('r', 'merchant');
        const c = recruit(npc, ['greed']);
        c.approval = 28;
        day();
        expect(c.gripe && c.gripe.kind).toBe('raise');
        const wage = c.wage;
        const r = Companions.grantRaise(player, 'r', world);
        expect(r.success).toBe(true);
        expect(c.wage).toBeGreaterThan(wage);
        expect(c.approval).toBeGreaterThan(28);
    });

    it('betrayal comes only after a warning', () => {
        const npc = makeNpc('t', 'spymaster');
        const c = recruit(npc, ['greed']);
        player.reputation = {};
        c.approval = 5;
        Utils.setRng(() => 0); // every roll succeeds
        day();
        expect(c.warnedDay).not.toBeNull();
        expect(player.travelParty).toContain('t');
        const notes = Companions.drainNotices(player);
        expect(notes.some(n => n.title.includes('Something is wrong'))).toBe(true);

        // Fixed salt decides theft vs. selling; with no rivals or realms it steals
        day(Companions.config().betrayWarnDays);
        expect(player.travelParty).not.toContain('t');
        expect(c.leftHow).toBe('betrayed');
        expect(player.companions.stats.betrayals).toBe(1);
    });

    it('unhappy companions may desert', () => {
        const npc = makeNpc('x', 'healer');
        const c = recruit(npc, ['compassion']);
        c.approval = 15;
        Utils.setRng(() => 0);
        day();
        expect(player.travelParty).not.toContain('x');
        expect(c.leftHow).toBe('deserted');
    });
});

describe('bonds and the fallen', () => {
    it('companions who travel together long enough become friends or rivals', () => {
        const a = makeNpc('fa', 'knight');
        const b = makeNpc('fb', 'guard');
        recruit(a, ['honour']);
        recruit(b, ['honour']);
        day(Companions.config().bondDays + 1);
        const bond = player.companions.bonds[Companions._bondKey('fa', 'fb')];
        expect(bond.kind).toBe('friends');
        expect(Companions.bondBalance(player, a)).toBe(1);
        expect(Companions.effectiveness(player, a)).toBeGreaterThan(Companions.tier(a).effectiveness);
    });

    it('a companion can fall in battle and is mourned in the chronicle', () => {
        const npc = makeNpc('dd', 'knight');
        recruit(npc, ['honour']);
        Utils.setRng(() => 0);
        const r = Companions.onBattle(player, false, { enemyName: 'Raiders', roleOf: n => PlayerEffects.companionRole(n) }, world);
        expect(r.fallen).toEqual(['DD']);
        expect(npc.isAlive).toBe(false);
        expect(player.travelParty).not.toContain('dd');
        expect(player.companions.mourned[0].name).toContain('DD');
        expect(player.house.history.some(h => (h.tags || []).includes('mourning'))).toBe(true);
    });

    it('an empty party draws no randomness in battle or by day', () => {
        Utils.setSeed(11);
        const expected = [Utils.random(), Utils.random()];
        Utils.setSeed(11);
        Companions.onBattle(player, false, { enemyName: 'X' }, world);
        day(3);
        expect([Utils.random(), Utils.random()]).toEqual(expected);
    });
});

describe('roster actions', () => {
    it('talk and gift raise approval with cooldowns', () => {
        const npc = makeNpc('ta', 'merchant');
        const c = recruit(npc, ['greed']);
        const a = c.approval;
        expect(Companions.talk(player, 'ta', world).success).toBe(true);
        expect(Companions.talk(player, 'ta', world).success).toBe(false);
        expect(c.approval).toBeGreaterThan(a);
        const g = Companions.gift(player, 'ta', world);
        expect(g.success).toBe(true);
        expect(g.gain).toBe(Companions.config().giftApproval + Companions.config().giftGreedBonus);
        expect(Companions.gift(player, 'ta', world).success).toBe(false);
        const d = Companions.describe(player, npc);
        expect(d.values[0].id).toBe('greed');
        expect(d.tier.label).toBeTruthy();
    });
});

describe('roster panel', () => {
    it('renders mood, values, gripe and quest, and its actions work', () => {
        const npc = makeNpc('ui', 'merchant');
        const c = recruit(npc, ['greed']);
        c.background = 'clear_debt';
        c.quest = { status: 'offered', day: world.day };
        c.gripe = { kind: 'raise', day: world.day, demand: 9, text: 'Demands a raise to 9 gold a day.' };
        const notes = [];
        const game = { player, world, ui: { showNotification: (t, x, k) => notes.push({ t, x, k }) } };
        const html = CompanionsPanel.rosterHtml(game);
        expect(html).toContain('UI Test');
        expect(html).toContain('Greed');
        expect(html).toContain('Demands a raise');
        expect(html).toContain('Hear them out');
        let refreshed = 0;
        CompanionsPanel.bind(game, () => { refreshed++; });
        window._companionAct('raise', 'ui');
        window._companionAct('quest', 'ui');
        expect(refreshed).toBe(2);
        expect(c.wage).toBe(9);
        expect(c.quest.status).toBe('active');
        expect(CompanionsPanel.rosterHtml(game)).toContain('Give 50g');
    });
});

describe('save / load', () => {
    it('round-trips companion state and backfills personalities for old companions', () => {
        const p = new Player();
        const npc = { id: 'rnpc_42', firstName: 'Old', dynasty: 'Hand', occupation: 'hunter', isAlive: true };
        p._relationshipNpcs = [npc];
        p.travelParty = ['rnpc_42'];
        p.companions = { snap: null, notices: [], bonds: { 'a|b': { days: 30, kind: 'rivals' } }, mourned: [{ name: 'Gone', day: 3 }], lastPayDay: 5 };

        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        expect(json.companions.bonds['a|b'].kind).toBe('rivals');
        delete json._relationshipNpcs[0].companion; // a save from before personalities
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.companions.bonds['a|b'].kind).toBe('rivals');
        expect(back.companions.mourned[0].name).toBe('Gone');
        const restored = back._relationshipNpcs[0].companion;
        expect(restored).toBeTruthy();
        expect(restored.values).toEqual(Companions.generatePersonality(npc).values);
        expect(restored.background).toBe(Companions.generatePersonality(npc).background);

        // A save from before companions existed at all
        delete json.companions;
        const older = new Player();
        SaveLoad.restorePlayer(json, older);
        expect(older.companions.bonds).toEqual({});
    });
});
