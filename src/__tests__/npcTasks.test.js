// NPC tasks made concrete (systems/npcTasks.js + Quests): a named place, lair,
// band or person on the map, the thing carried back to the giver, a second
// way out, the townsfolk remembering; old saves' general tasks migrated; the
// quest board's targeted templates. Seeded worlds from the playtest harness.

import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { Quests } from '../systems/quests.js';
import { NpcTasks } from '../systems/npcTasks.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { NPC_QUEST_HOOKS } from '../ui/npcDialog.data.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

beforeAll(async () => { await loadData(); });

/** A seeded game a few days in (lairs have formed), standing in a town with a roster. */
function townGame(seed = 7, days = 3) {
    const game = newGame(seed);
    for (let i = 0; i < days; i++) endDay(game);
    const { world, player } = game;
    const tile = world.getTile(player.q, player.r);
    const s = tile.settlement;
    Townsfolk.attach(s, world, [
        { id: 1, type: 'farmer', name: 'Brom', age: 44, gender: 'male', childIds: [2], spouseId: 4 },
        { id: 2, type: 'villager', name: 'Finn', age: 15, gender: 'male', parentIds: [1, 4] },
        { id: 3, type: 'merchant', name: 'Ada', age: 30, gender: 'female' },
        { id: 4, type: 'villager', name: 'Greta', age: 41, gender: 'female', childIds: [2], spouseId: 1 },
        { id: 5, type: 'guard', name: 'Holt', age: 35, gender: 'male' },
    ], { q: s.q, r: s.r });
    const folk = s.folk;
    const person = (first) => folk.people.find(p => p.first === first);
    const npcFor = (p, type) => ({ id: `npc${p.id}`, uid: `${folk.q},${folk.r}#${p.id}`, name: p.first, fullName: Townsfolk.name(p), type: type || p.role, _person: p, _folk: folk });
    return { ...game, s, folk, person, npcFor };
}

function hook(task) {
    return Object.values(NPC_QUEST_HOOKS).flat().find(h => h.task === task);
}

describe('NPC requests name a real target', () => {
    it('every hook is a defined task, and each becomes concrete in a real world', () => {
        const g = townGame();
        const hooks = Object.values(NPC_QUEST_HOOKS).flat();
        expect(hooks.length).toBe(16);
        for (const h of hooks) {
            expect(NpcTasks.task(h.task), h.task).toBeTruthy();
            g.player.quests.active = [];
            const res = Quests.createNpcTask(g.player, h, g.npcFor(g.person('Brom')), g.world);
            expect(res.success, h.task).toBe(true);
            const q = res.quest;
            expect(q.v, h.task).toBe(2);
            const find = q.objectives[0];
            expect(['site_delved', 'lair_cleared', 'foe_slain', 'talk_to', 'deliver_item'], h.task).toContain(find.type);
            if (find.type !== 'deliver_item') expect(find.q != null && find.r != null, h.task).toBe(true);
            // A townsperson must be gone back to
            const ret = q.objectives.find(o => o.type === 'return_to');
            expect(ret && ret.uid, h.task).toBe(g.npcFor(g.person('Brom')).uid);
            expect(Quests.whereLine(find, g.player, g.world)).not.toBe('');
        }
    });

    it('is the same task for the same seed, and draws nothing from the shared dice', () => {
        const a = townGame(11);
        const b = townGame(11);
        Utils.setSeed(99);
        const ra = Quests.createNpcTask(a.player, hook('lost_locket'), a.npcFor(a.person('Greta')), a.world);
        const after = Utils.random();
        Utils.setSeed(99);
        const rb = Quests.createNpcTask(b.player, hook('lost_locket'), b.npcFor(b.person('Greta')), b.world);
        expect(Utils.random()).toBe(after);
        Utils.setSeed(99);
        expect(Utils.random()).toBe(after);
        const strip = q => q.objectives.map(o => ({ ...o }));
        expect(strip(rb.quest)).toEqual(strip(ra.quest));
    });

    it('a traveller (no home to go back to) completes on the target alone', () => {
        const g = townGame();
        const res = Quests.createNpcTask(g.player, hook('bounty_target'), { id: 77, name: 'Wend', type: 'traveler' }, g.world);
        const q = res.quest;
        expect(q.objectives.some(o => o.type === 'return_to')).toBe(false);
        const unit = NpcTasks.foeUnit(g.world, q.objectives[0].key);
        unit.destroyed = true; unit.slainByPlayer = true;
        const gold = g.player.gold;
        expect(Quests.updateProgress(g.player, g.world).map(x => x.id)).toContain(q.id);
        expect(g.player.gold).toBe(gold + q.rewards.gold);
    });
});

describe('The locket: run the thieves down, bring it home — or sell it', () => {
    function lockedTask() {
        const g = townGame();
        const greta = g.person('Greta');
        const npc = g.npcFor(greta);
        const res = Quests.createNpcTask(g.player, { ...hook('lost_locket'), task: 'lost_locket' }, npc, g.world);
        const q = res.quest;
        // Force the band version (a lair may be near in some seeds)
        if (q.objectives[0].type !== 'foe_slain') {
            const unit = NpcTasks.spawnFoe(g.world, 'thieves', g.s.q, g.s.r, `${q.id}|t`, `${q.id}|t`);
            q.objectives[0] = { type: 'foe_slain', key: `${q.id}|t`, foe: 'thieves', name: unit.name, homeQ: unit.q, homeR: unit.r, q: unit.q, r: unit.r, respawns: 0, target: 1, current: 0, text: 'Run down the thieves' };
        }
        return { g, greta, npc, q };
    }

    it('the band is a real hostile unit on the map, marked for the player', () => {
        const { g, q } = lockedTask();
        const o = q.objectives[0];
        const unit = g.world.units.find(u => u.questKey === o.key);
        expect(unit).toBeTruthy();
        expect(['raider', 'beast', 'monster']).toContain(unit.type);
        const m = Quests.taskMarkers(g.player, g.world).find(x => x.questId === q.id);
        expect(m).toMatchObject({ q: unit.q, r: unit.r });
    });

    it('if someone else scatters the band it regroups; beaten by the player, the locket is carried', () => {
        const { g, q } = lockedTask();
        const o = q.objectives[0];
        let unit = NpcTasks.foeUnit(g.world, o.key);
        unit.destroyed = true; // a patrol got them
        Quests.updateProgress(g.player, g.world);
        expect(o.current).toBe(0);
        const again = g.world.units.find(u => u.questKey === o.key && !u.destroyed);
        expect(again).toBeTruthy();
        expect(again).not.toBe(unit);
        unit = again;
        unit.destroyed = true; unit.slainByPlayer = true;
        const done = Quests.updateProgress(g.player, g.world);
        expect(done).toHaveLength(0); // not until it is handed back
        expect(q.carrying).toBe('the grandmother\'s locket');
        expect(Quests.takeNotices(g.player).some(n => /locket/i.test(n.text))).toBe(true);
    });

    it('handed back face to face: reward, thanks, the giver remembers', () => {
        const { g, greta, npc, q } = lockedTask();
        const unit = NpcTasks.foeUnit(g.world, q.objectives[0].key);
        unit.destroyed = true; unit.slainByPlayer = true;
        Quests.updateProgress(g.player, g.world);
        const opts = NpcTasks.talkOptions(g.player, npc, { q: g.player.q, r: g.player.r });
        expect(opts.map(o => o.kind)).toEqual(['return']);
        // Nobody else can take it in
        expect(NpcTasks.talkOptions(g.player, g.npcFor(g.person('Ada')), { q: g.player.q, r: g.player.r })).toHaveLength(0);
        const karma = g.player.karma;
        const res = Quests.handInNpcTask(g.player, g.world, q.id);
        expect(res.success).toBe(true);
        expect(res.line).toMatch(/locket/);
        expect(res.disposition).toBeGreaterThan(0);
        expect(q.status).toBe('completed');
        expect(q.outcome).toBe('returned');
        expect(g.player.quests.completed).toContain(q);
        expect(g.player.karma).toBe(karma + q.rewards.karma);
        expect(greta.log.some(e => e.k === 'favour')).toBe(true);
        // Thanked there and then — no second thanks owed
        expect(Quests.collectThanks(g.player, npc)).toBe(null);
    });

    it('sold to a fence from the journal instead: gold, and a grievance she voices next time', () => {
        const { g, greta, npc, q } = lockedTask();
        expect(Quests.resolveTaskAlt(g.player, g.world, q.id).success).toBe(false); // not found yet
        const unit = NpcTasks.foeUnit(g.world, q.objectives[0].key);
        unit.destroyed = true; unit.slainByPlayer = true;
        Quests.updateProgress(g.player, g.world);
        const gold = g.player.gold;
        const d0 = (greta.mem && greta.mem.disposition) || 50;
        const res = Quests.resolveTaskAlt(g.player, g.world, q.id);
        expect(res.success).toBe(true);
        expect(g.player.gold).toBe(gold + q.alt.gold);
        expect(q.outcome).toBe('sell');
        expect(greta.mem.disposition).toBeLessThan(d0);
        expect(greta.log.some(e => e.k === 'wronged')).toBe(true);
        const gr = Quests.collectGrievance(g.player, npc);
        expect(gr && gr.text).toMatch(/locket/);
        expect(Quests.collectGrievance(g.player, npc)).toBe(null);
    });
});

describe('The missing son: a real child of the giver, brought home or let go', () => {
    function sonTask() {
        const g = townGame();
        const brom = g.person('Brom');
        const finn = g.person('Finn');
        const npc = g.npcFor(brom);
        const q = Quests.createNpcTask(g.player, hook('missing_son'), npc, g.world).quest;
        return { g, brom, finn, npc, q };
    }

    function delve(g, o) {
        const poi = g.world.getTile(o.q, o.r).improvement;
        poi.explored = true;
        poi.delved = { day: g.world.day, depth: 2, of: 4, reason: 'retreat' };
        g.player.delves = { active: null, completed: [`${o.q},${o.r}`], injuries: [], guardians: [], stats: {} };
    }

    it('names the son, takes him out of town while missing, and points at a delve site', () => {
        const { g, finn, q } = sonTask();
        expect(q.person).toMatchObject({ name: 'Finn', real: true });
        expect(finn.away && finn.away.missing).toBe(true);
        expect(Townsfolk.isHere(finn)).toBe(false);
        expect(q.objectives[0].type).toBe('site_delved');
        expect(q.objectives[0].text).toMatch(/Finn/);
    });

    it('turning back at the mouth of the place fails the task; the father is let down', () => {
        const { g, npc, q } = sonTask();
        const o = q.objectives[0];
        const poi = g.world.getTile(o.q, o.r).improvement;
        poi.explored = true;
        poi.delved = { day: g.world.day, depth: 0, of: 4, reason: 'retreat' };
        g.player.delves = { active: null, completed: [`${o.q},${o.r}`], injuries: [], guardians: [], stats: {} };
        Quests.updateProgress(g.player, g.world);
        expect(q.status).toBe('failed');
        expect(g.player.quests.failed).toContain(q);
        expect(Quests.collectGrievance(g.player, npc)).toMatchObject({ kind: 'letDown' });
    });

    it('brought home: he is back in town and remembers it', () => {
        const { g, finn, q } = sonTask();
        delve(g, q.objectives[0]);
        Quests.updateProgress(g.player, g.world);
        expect(q.carrying).toBe('Finn');
        expect(Quests.handInNpcTask(g.player, g.world, q.id).success).toBe(true);
        expect(finn.away).toBe(null);
        expect(Townsfolk.isHere(finn)).toBe(true);
        expect(finn.log.some(e => e.k === 'rescued')).toBe(true);
    });

    it('let go: he goes off to another town, and his parents note it', () => {
        const { g, brom, finn, q } = sonTask();
        delve(g, q.objectives[0]);
        Quests.updateProgress(g.player, g.world);
        const renown = g.player.renown;
        expect(Quests.resolveTaskAlt(g.player, g.world, q.id).success).toBe(true);
        expect(finn.away && finn.away.missing).toBeFalsy();
        expect(typeof finn.away.to).toBe('string');
        expect(brom.log.some(e => e.k === 'kidLeft' && e.o === finn.id)).toBe(true);
        expect(g.player.renown).toBe(renown + q.rewards.renown); // the deed is still known
    });
});

describe('Carrying to a named person in another town', () => {
    it('the letter goes to the person (or a townsperson for them), the reply back to the giver', () => {
        const g = townGame();
        const ada = g.person('Ada');
        const q = Quests.createNpcTask(g.player, hook('spice_supplier'), g.npcFor(ada), g.world).quest;
        const o = q.objectives[0];
        expect(o.type).toBe('talk_to');
        expect(o.mode).toBe('deliver');
        expect(o.town).not.toBe(g.s.name);
        // Not deliverable at home
        expect(NpcTasks.talkOptions(g.player, g.npcFor(g.person('Holt')), { q: g.player.q, r: g.player.r })).toHaveLength(0);
        // At the other town: the named person, else any townsperson there
        const recipient = { id: 'r1', uid: o.uid, name: o.person.split(' ')[0], fullName: o.person, type: 'merchant', _person: {} };
        const opt = NpcTasks.talkOptions(g.player, recipient, { q: o.q, r: o.r })[0];
        expect(['deliver', 'proxy']).toContain(opt.kind);
        g.player.q = o.q; g.player.r = o.r;
        const res = Quests.talkToTask(g.player, g.world, q.id, 'ask');
        expect(res.success).toBe(true);
        expect(q.carrying).toBe('a sealed reply');
        expect(NpcTasks.nextObjective(q).type).toBe('return_to');
        expect(Quests.handInNpcTask(g.player, g.world, q.id).success).toBe(true);
    });

    it('a guarded holder refuses; the papers can be bought — or a theft caught', () => {
        const g = townGame();
        const q = Quests.createNpcTask(g.player, hook('rival_documents'), g.npcFor(g.person('Ada')), g.world).quest;
        expect(q.objectives[0]).toMatchObject({ type: 'talk_to', mode: 'fetch', guarded: true });
        expect(Quests.talkToTask(g.player, g.world, q.id, 'ask')).toMatchObject({ success: false, refused: true });
        expect(Quests.talkToTask(g.player, g.world, q.id, 'steal', false)).toMatchObject({ success: false, caught: true });
        g.player.gold = 100;
        const res = Quests.talkToTask(g.player, g.world, q.id, 'bribe');
        expect(res.success).toBe(true);
        expect(g.player.gold).toBe(20);
        expect(q.carrying).toBe('the rival\'s documents');
    });
});

describe('Deadlines and old saves', () => {
    it('a task left too long fails', () => {
        const g = townGame();
        const q = Quests.createNpcTask(g.player, hook('bandit_camp'), g.npcFor(g.person('Holt')), g.world).quest;
        g.world.day = q.deadlineDay + 1;
        Quests.updateProgress(g.player, g.world);
        expect(q.status).toBe('failed');
        expect(q.failReason).toMatch(/time/);
    });

    it('an old save\'s general task is given a real target from its giver\'s home', () => {
        const g = townGame();
        const legacy = Quests.createNpcTask(g.player, { text: 'My grandmother\'s locket was taken by those awful bandits.', type: 'retrieve_item', reward: 'gratitude' }, { id: 9, name: 'Greta' }, null).quest;
        expect(legacy.v).toBeUndefined();
        legacy.giver.id = g.npcFor(g.person('Greta')).uid; // what older saves stored
        Quests.updateProgress(g.player, g.world);
        expect(legacy.v).toBe(2);
        expect(legacy.migrated).toBe(true);
        expect(legacy.task).toBe('lost_locket');
        expect(legacy.objectives.some(o => o.type === 'return_to')).toBe(true);
    });

    it('without a world to place it in, an old task keeps working as before', () => {
        const player = { gold: 0, karma: 0, renown: 0, inventory: {}, reputation: {} };
        const res = Quests.createNpcTask(player, hook('ancient_ruins'), { id: 3, name: 'Edda' }, null);
        expect(res.quest.v).toBeUndefined();
        Quests.track(player, 'ruins_explored');
        expect(Quests.updateProgress(player, { width: 0, height: 0, tiles: [] }).map(q => q.id)).toContain(res.quest.id);
    });
});

describe('Quest-board templates with named targets', () => {
    const TARGETED = ['TOMB_OF_THE_OLD_KINGS', 'THE_DEEP_SEAM', 'THE_BLIND_DARK', 'THE_DROWNED_HALLS', 'RUINS_EXPLORER',
        'BANDIT_SLAYER', 'PHYSICIANS_HERBS', 'FURS_FOR_WINTER', 'DRAGON_HUNTER', 'WORLD_TRAVELER'];

    it('at least ten templates name a target, each with a general fallback', () => {
        for (const key of TARGETED) {
            const t = Quests.QUEST_TEMPLATES[key];
            const spec = t.objectives.find(o => o.fallback);
            expect(spec, key).toBeTruthy();
            expect(spec.fallback.type, key).toBeTruthy();
        }
    });

    it('taken in a world, they point at real places; taken nowhere, they fall back', () => {
        const g = townGame();
        let concrete = 0;
        for (const key of TARGETED) {
            g.player.quests.active = [];
            g.player.quests.available = [Quests.createQuest(key, g.player)];
            const id = Quests.QUEST_TEMPLATES[key].id;
            const quest = Quests.acceptQuest(g.player, id, g.world).quest;
            expect(quest.objectives.some(o => o.fallback), key).toBe(false);
            if (quest.objectives.some(o => o.resolved)) concrete++;
        }
        expect(concrete).toBeGreaterThanOrEqual(6);
        const bare = { gold: 0, karma: 0, renown: 0, inventory: {}, reputation: {} };
        Quests.initialize(bare);
        bare.quests.available = [Quests.createQuest('BANDIT_SLAYER', bare)];
        const q = Quests.acceptQuest(bare, 'bandit_slayer').quest;
        expect(q.objectives[0].type).toBe('raiders_defeated');
    });

    it('Bandit Slayer names a lair, reveals it, and completes when the player clears it', () => {
        const g = townGame(7, 3);
        g.player.quests.available = [Quests.createQuest('BANDIT_SLAYER', g.player)];
        g.player.quests.active = [];
        const q = Quests.acceptQuest(g.player, 'bandit_slayer', g.world).quest;
        const o = q.objectives[0];
        expect(o.type).toBe('lair_cleared');
        const lair = OutlawLairs.find(g.player, o.lairId);
        expect(lair.known).toBe(true);
        lair.status = 'cleared'; lair.endedBy = 'player';
        expect(Quests.updateProgress(g.player, g.world).map(x => x.id)).toContain('bandit_slayer');
    });

    it('World Traveler names towns not yet visited and counts them', () => {
        const g = townGame();
        g.player.quests.available = [Quests.createQuest('WORLD_TRAVELER', g.player)];
        g.player.quests.active = [];
        const q = Quests.acceptQuest(g.player, 'world_traveler', g.world).quest;
        const o = q.objectives[0];
        expect(o.type).toBe('visit_towns');
        expect(o.towns).toHaveLength(5);
        Quests.trackSettlementVisited(g.player, o.towns[0].name);
        Quests.updateProgress(g.player, g.world);
        expect(o.current).toBe(1);
        expect(Quests.taskMarkers(g.player, g.world).filter(m => m.questId === q.id)).toHaveLength(4);
    });

    it('goods for a named town count only once they are there', () => {
        const g = townGame();
        g.player.quests.available = [Quests.createQuest('PHYSICIANS_HERBS', g.player)];
        g.player.quests.active = [];
        const q = Quests.acceptQuest(g.player, 'physicians_herbs', g.world).quest;
        const o = q.objectives.find(x => x.type === 'deliver_item');
        expect(o.atQ).toBeTypeOf('number');
        g.player.foragingTrips = (g.player.foragingTrips || 0) + 5;
        g.player.inventory.herbs = 6;
        Quests.updateProgress(g.player, g.world);
        expect(o.completed).toBe(false);
        g.player.q = o.atQ; g.player.r = o.atR;
        Quests.updateProgress(g.player, g.world);
        expect(o.completed).toBe(true);
    });
});
