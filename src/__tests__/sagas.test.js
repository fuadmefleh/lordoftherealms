// Sagas (systems/sagas.js): world-scale storylines in chapters, staged on
// the existing systems — content integrity, scheduling without early RNG,
// chapter progression, branching on the player's part, ignored resolution,
// hooks (tavern, petitions, quests) and save round-trips.

import { describe, it, expect, beforeAll, vi, afterAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Sagas } from '../systems/sagas.js';
import { Petitions } from '../systems/petitions.js';
import { Throne } from '../systems/throne.js';
import { Quests } from '../systems/quests.js';
import { House } from '../systems/house.js';
import { World } from '../world/world.js';
import { Player } from '../player/player.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => { if (logSpy) logSpy.mockRestore(); });

function genWorld(seed = 4242) {
    Utils.setSeed(seed);
    const w = new World(80, 60);
    w.generate({ kingdomCount: 10, seed });
    w.day = 1;
    return w;
}
function makePlayer(w) {
    const p = new Player({ firstName: 'Saga', lastName: 'Tester', gender: 'female', age: 25 });
    p.placeInWorld(w);
    Quests.initialize(p);
    House.initialize(p, w);
    p.gold = 5000;
    p.renown = 100;
    p.inventory = { food: 100 };
    p.army = [];
    return p;
}

/** Fresh world copy + player per test (sagas mutate kingdoms and tiles). */
function fresh(seed = 4242) {
    const w = genWorld(seed);
    return { w, p: makePlayer(w) };
}

function runDays(w, p, n, stop = null) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        w.day++;
        w.events = [];
        const out = Sagas.processDay(w, p);
        notices.push(...out.notices);
        if (stop && stop()) break;
    }
    return notices;
}

function moveTo(p, pt) {
    p.q = pt.q;
    p.r = pt.r;
}

describe('content', () => {
    it('validates: known effects, conditions, tokens, reachable chapters, ignored paths', () => {
        expect(Sagas.validate()).toEqual([]);
    });

    it('has 6–8 sagas, each with 3–5 story chapters and at least two endings', () => {
        const all = Object.entries(Sagas.templates());
        expect(all.length).toBeGreaterThanOrEqual(6);
        expect(all.length).toBeLessThanOrEqual(8);
        for (const [id, t] of all) {
            const chapters = Object.values(t.chapters);
            const story = chapters.filter(c => !c.end).length;
            expect(story, id).toBeGreaterThanOrEqual(3);
            expect(story, id).toBeLessThanOrEqual(5);
            expect(chapters.filter(c => c.end).length, id).toBeGreaterThanOrEqual(2);
        }
    });

    it('reward items are real goods and event effect keys are real modifiers', () => {
        const goods = new Set(Object.values(DataLoader._gamedata.playerEconomy.GOODS).map(g => g.id));
        const effects = [];
        for (const t of Object.values(Sagas.templates())) {
            for (const ch of Object.values(t.chapters)) {
                effects.push(...(ch.effects || []), ...(ch.daily || []));
                for (const a of ch.actions || []) {
                    effects.push(...(a.effects || []));
                    for (const item of Object.keys((a.cost && a.cost.items) || {})) expect(goods.has(item), item).toBe(true);
                }
            }
        }
        for (const e of effects) {
            expect(Sagas.EFFECTS, e.do).toHaveProperty(e.do);
            for (const item of Object.keys(e.items || {})) expect(goods.has(item), item).toBe(true);
        }
    });

    it('saga petitions use only Petitions effect keys and offer 2–4 choices', () => {
        for (const [id, t] of Object.entries(Sagas.templates())) {
            for (const [pid, def] of Object.entries(t.petitions || {})) {
                expect(def.choices.length, `${id}.${pid}`).toBeGreaterThanOrEqual(2);
                expect(def.choices.length, `${id}.${pid}`).toBeLessThanOrEqual(4);
                for (const ch of def.choices) {
                    for (const key of Object.keys(ch.effects || {})) expect(Petitions.EFFECTS, `${id}.${pid}.${ch.id}`).toHaveProperty(key);
                }
            }
        }
    });
});

describe('scheduling', () => {
    it('draws no RNG before the first saga starts, and starts one between day 60 and 120', () => {
        const { w, p } = fresh();
        w.day = 0;
        Utils.setSeed(77);
        const first = Sagas._firstStartDay(w);
        expect(first).toBeGreaterThanOrEqual(60);
        expect(first).toBeLessThanOrEqual(120);
        for (let d = 1; d < first; d++) {
            w.day = d;
            Sagas.processDay(w, p);
        }
        const drawn = Utils.random();
        Utils.setSeed(77);
        expect(drawn).toBe(Utils.random());
        expect(Sagas.active(p).length).toBe(0);
        w.day = first;
        Sagas.processDay(w, p);
        expect(Sagas.active(p).length).toBe(1);
        expect(Sagas.active(p)[0].history.length).toBe(1);
    });

    it('never runs more than two sagas at once over a long run', () => {
        const { w, p } = fresh();
        Utils.setSeed(9);
        w.day = 0;
        let max = 0;
        for (let d = 0; d < 700; d++) {
            w.day++;
            w.events = [];
            Sagas.processDay(w, p);
            max = Math.max(max, Sagas.active(p).length);
        }
        expect(max).toBeLessThanOrEqual(2);
        expect(Sagas.state(p).stats.started).toBeGreaterThanOrEqual(3);
        expect(Sagas.state(p).stats.ended).toBeGreaterThanOrEqual(2);
    });
});

describe('progression and ignored resolution', () => {
    it('every saga, left alone, runs through its chapters and resolves on its own', () => {
        const ids = Object.keys(Sagas.templates());
        for (const id of ids) {
            const { w, p } = fresh(5150);
            p.q = 0; p.r = 0; // far from it all
            Utils.setSeed(31);
            const saga = Sagas.start(p, w, id);
            expect(saga, id).toBeTruthy();
            runDays(w, p, 1);
            runDays(w, p, 500, () => !!saga.ended);
            expect(saga.ended, `${id} never ended`).toBeTruthy();
            expect(saga.involved).toBe(false);
            expect(saga.history.length, id).toBeGreaterThanOrEqual(3);
            expect(Sagas.state(p).done).toContain(saga);
            // Endings are news: the player hears how it ended, but gets no reward
            expect(saga.known).toBe(true);
            expect(saga.rewards).toEqual([]);
            // No saga units are left behind
            expect(w.units.filter(u => u.sagaKey && u.sagaKey.startsWith(saga.uid) && !u.destroyed)).toEqual([]);
        }
    });

    it('chapters write real state: the Long Winter starts a famine and hoarders drive up food prices', () => {
        const { w, p } = fresh();
        Utils.setSeed(3);
        const saga = Sagas.start(p, w, 'long_winter');
        runDays(w, p, 1);
        expect(saga.chapter).toBe('early_frost');
        expect(w.activeEvents.some(e => e.sagaUid === saga.uid && e.effects.farmProduction < 0)).toBe(true);
        runDays(w, p, 60, () => saga.chapter === 'hunger');
        expect(saga.chapter).toBe('hunger');
        const evs = w.activeEvents.filter(e => e.sagaUid === saga.uid);
        expect(evs.some(e => e.id === 'famine')).toBe(true);
        expect(evs.some(e => e.effects.foodPrices > 0)).toBe(true);
        const quest = p.quests.available.find(q => q.id === saga.questId);
        expect(quest).toBeTruthy();
        expect(saga.known).toBe(true); // a public chapter
    });
});

describe('branching on the player\'s part', () => {
    it('slaying the wyrm ends The Wyrm Wakes in triumph, with scales and renown', () => {
        const { w, p } = fresh();
        Utils.setSeed(12);
        const saga = Sagas.start(p, w, 'wyrm_wakes');
        expect(saga).toBeTruthy();
        runDays(w, p, 1);
        Sagas._enter(p, w, saga, 'raids', () => {});
        const wyrm = w.units.find(u => u.sagaKey && u.sagaKey.startsWith(`${saga.uid}:boss`));
        expect(wyrm).toBeTruthy();
        expect(wyrm.strength).toBeGreaterThanOrEqual(110);
        // The lair is a real delve site
        const site = w.getTile(saga.anchor.site.q, saga.anchor.site.r);
        expect(site.improvement && site.improvement.explored).toBe(false);
        const renown = p.renown;
        wyrm.destroyed = true;
        wyrm.slainByPlayer = true;
        runDays(w, p, 1);
        expect(saga.ended && saga.ended.chapter).toBe('slain');
        expect(saga.involved).toBe(true);
        expect(p.inventory.dragon_scale).toBeGreaterThanOrEqual(4); // the ending's three + the carcass bounty (1–2)
        expect(p.renown).toBeGreaterThan(renown);
    });

    it('a patrol cannot kill the wyrm; if something else does, the story says so', () => {
        const { w, p } = fresh();
        Utils.setSeed(13);
        const saga = Sagas.start(p, w, 'wyrm_wakes');
        runDays(w, p, 1);
        Sagas._enter(p, w, saga, 'raids', () => {});
        const wyrm = w.units.find(u => u.sagaKey && u.sagaKey.startsWith(`${saga.uid}:boss`));
        wyrm.destroyed = true; // not by the player
        runDays(w, p, 1);
        expect(saga.ended && saga.ended.chapter).toBe('felled_by_others');
        expect(saga.involved).toBe(false);
    });

    it('feeding the hungry in the Long Winter brings the thaw early, with reputation', () => {
        const { w, p } = fresh();
        Utils.setSeed(4);
        const saga = Sagas.start(p, w, 'long_winter');
        runDays(w, p, 1);
        Sagas._enter(p, w, saga, 'hunger', () => {});
        moveTo(p, { q: (saga.anchor.settlement.q + 30) % w.width, r: saga.anchor.settlement.r });
        expect(Sagas.act(p, w, saga.uid, 'relief').success).toBe(false);
        moveTo(p, saga.anchor.settlement);
        const rep = (p.reputation[saga.anchor.kingdomId] || 0);
        const res = Sagas.act(p, w, saga.uid, 'relief');
        expect(res.success).toBe(true);
        expect(p.inventory.food).toBe(60);
        expect(saga.ended && saga.ended.chapter).toBe('thaw_relieved');
        expect(p.reputation[saga.anchor.kingdomId]).toBeGreaterThan(rep);
        expect(w.activeEvents.some(e => e.sagaUid === saga.uid)).toBe(false);
        expect(p.house.history.some(h => (h.tags || []).includes('saga'))).toBe(true);
    });

    it('profiting from the hoarders pays in gold and costs karma', () => {
        const { w, p } = fresh();
        Utils.setSeed(5);
        const saga = Sagas.start(p, w, 'long_winter');
        runDays(w, p, 1);
        Sagas._enter(p, w, saga, 'hunger', () => {});
        moveTo(p, saga.anchor.settlement);
        const karma = p.karma;
        expect(Sagas.act(p, w, saga.uid, 'profit').success).toBe(true);
        const gold = p.gold;
        runDays(w, p, 80, () => !!saga.ended);
        expect(saga.ended.chapter).toBe('thaw_profiteer');
        expect(p.gold).toBeGreaterThan(gold);
        expect(p.karma).toBeLessThan(karma);
    });

    it('The Lost Heir: a pretender sparks a real succession crisis; exposing them ends it', () => {
        const { w, p } = fresh();
        Utils.setSeed(6);
        const saga = Sagas.start(p, w, 'lost_heir');
        expect(saga).toBeTruthy();
        runDays(w, p, 1);
        moveTo(p, saga.anchor.settlement);
        expect(Sagas.act(p, w, saga.uid, 'seek').success).toBe(true);
        runDays(w, p, 60, () => saga.chapter === 'pretender');
        expect(saga.chapter).toBe('pretender');
        const crisis = Throne.crisisFor(p, saga.anchor.kingdomId);
        expect(crisis).toBeTruthy();
        expect(saga.anchor.villain).toBe(crisis.claimants.find(c => c.id === 'rival').name);
        const k = w.getKingdom(saga.anchor.kingdomId);
        moveTo(p, k.capital);
        const res = Sagas.act(p, w, saga.uid, 'expose');
        expect(res.success, res.reason).toBe(true);
        expect(saga.ended && saga.ended.chapter).toBe('exposed');
        expect(Throne.crisisFor(p, saga.anchor.kingdomId)).toBeNull();
    });

    it('The Lost Heir, left alone, waits on the crisis and ends with its verdict', () => {
        const { w, p } = fresh();
        Utils.setSeed(7);
        const saga = Sagas.start(p, w, 'lost_heir');
        runDays(w, p, 1);
        runDays(w, p, 200, () => !!saga.ended);
        expect(['crowned', 'pretender_falls']).toContain(saga.ended.chapter);
        const k = w.getKingdom(saga.anchor.kingdomId);
        if (saga.ended.chapter === 'crowned') expect(k.characterData.ruler.id).toBe(saga.anchor.pretenderId);
    });

    it('ruling a saga petition steers the saga and counts as taking part', () => {
        const { w, p } = fresh();
        Utils.setSeed(8);
        const saga = Sagas.start(p, w, 'long_winter');
        runDays(w, p, 1);
        Sagas._enter(p, w, saga, 'hunger', () => {});
        const def = Sagas._fillDeep(Sagas.template('long_winter').petitions.bread, saga);
        const pet = Petitions.spawnCustom(p, w, 'saga_long_winter_bread', def, { kind: 'house' });
        expect(pet).toBeTruthy();
        saga.petitions.push({ id: pet.id, key: 'bread', resolved: false });
        const res = Petitions.rule(p, w, pet.id, 'open_stores');
        expect(res.success, res.reason).toBe(true);
        runDays(w, p, 1);
        expect(saga.flags.petition_open_stores).toBe(true);
        expect(saga.involved).toBe(true);
        expect(saga.ended && saga.ended.chapter).toBe('thaw_relieved');
    });

    it('accepting the saga quest involves the player and a successful ending completes it', () => {
        const { w, p } = fresh();
        Utils.setSeed(10);
        const saga = Sagas.start(p, w, 'wyrm_wakes');
        runDays(w, p, 1);
        Sagas._enter(p, w, saga, 'raids', () => {});
        expect(Quests.acceptQuest(p, saga.questId).success).toBe(true);
        runDays(w, p, 1);
        expect(saga.involved).toBe(true);
        const wyrm = w.units.find(u => u.sagaKey && u.sagaKey.startsWith(`${saga.uid}:boss`));
        wyrm.destroyed = true;
        wyrm.slainByPlayer = true;
        runDays(w, p, 1);
        const done = Quests.updateProgress(p, w);
        expect(done.map(q => q.id)).toContain(saga.questId);
    });
});

describe('hearing', () => {
    it('tavern talk in the saga\'s kingdom tells the player, and the journal lists it', () => {
        const { w, p } = fresh();
        Utils.setSeed(14);
        const saga = Sagas.start(p, w, 'grey_cough');
        p.q = 0; p.r = 0;
        runDays(w, p, 1);
        expect(saga.known).toBe(false);
        expect(Sagas.journal(p).active).toEqual([]);
        const s = saga.anchor.settlement;
        const rumors = Sagas.tavernRumors(p, w, w.getTile(s.q, s.r));
        expect(rumors.length).toBe(1);
        expect(saga.known).toBe(true);
        expect(saga.heard.length).toBeGreaterThan(0);
        expect(Sagas.journal(p).active).toContain(saga);
        expect(Sagas.actions(p, w, saga).map(a => a.id)).toContain('physicians');
    });

    it('a chapter turning near the player is an end-of-day notice', () => {
        const { w, p } = fresh();
        Utils.setSeed(15);
        const saga = Sagas.start(p, w, 'iron_company');
        moveTo(p, saga.anchor.settlement);
        const notices = runDays(w, p, 40, () => saga.chapter === 'rogue');
        expect(saga.known).toBe(true);
        expect(notices.some(n => n.title.includes('The Iron Company'))).toBe(true);
    });
});

describe('save and load', () => {
    it('saga state survives JSON, and saga units come back after a load', () => {
        const { w, p } = fresh();
        Utils.setSeed(16);
        const saga = Sagas.start(p, w, 'sea_reavers');
        expect(saga).toBeTruthy();
        runDays(w, p, 1);
        Sagas._enter(p, w, saga, 'fleet', () => {});
        const before = JSON.parse(JSON.stringify(Sagas.serialize(p)));
        const p2 = makePlayer(w);
        p2.sagas = JSON.parse(JSON.stringify(Sagas.serialize(p)));
        Sagas.loadState(p2);
        expect(Sagas.serialize(p2)).toEqual(before);
        // A load rebuilds world.units without the saga's ships
        w.units = w.units.filter(u => !u.sagaKey);
        runDays(w, p2, 1);
        const s2 = Sagas.active(p2)[0];
        const live = w.units.filter(u => u.sagaKey && u.sagaKey.startsWith(s2.uid) && !u.destroyed);
        expect(live.length).toBe(s2.units.filter(u => !u.slain && !u.gone).length);
        expect(live.length).toBeGreaterThan(0);
    });

    it('an old save without sagas is backfilled', () => {
        const p = new Player();
        p.sagas = undefined;
        Sagas.loadState(p);
        expect(p.sagas.active).toEqual([]);
        expect(p.sagas.nextStartDay).toBeNull();
    });

    it('a full save → load round trip mid-saga keeps the story going', () => {
        const game = newGame(424242);
        const { world: w, player: p } = game;
        Utils.setSeed(17);
        const saga = Sagas.start(p, w, 'the_comet');
        expect(saga).toBeTruthy();
        // The idle test player is no fighter; keep it alive so the story is what's tested
        // (world units now survive the load, so the raiders that ambushed it stay close)
        // (and fed: how soon an idle player starves depends on the whole world's run)
        const keepAlive = (g) => {
            g.player.health = g.player.maxHealth || 100;
            g.player.starvationDays = 0;
            g.player.inventory = g.player.inventory || {};
            g.player.inventory.food = Math.max(g.player.inventory.food || 0, 20);
        };
        for (let i = 0; i < 15; i++) { keepAlive(game); endDay(game); }
        const g2 = roundTrip(game);
        expect(Sagas.serialize(g2.player)).toEqual(Sagas.serialize(p));
        for (let i = 0; i < 200 && Sagas.active(g2.player).some(s => s.uid === saga.uid); i++) { keepAlive(g2); endDay(g2); }
        const s2 = Sagas.get(g2.player, saga.uid);
        expect(s2.ended).toBeTruthy();
        // Its events and its crater were saved with the world
        if (s2.anchor.site) expect(g2.world.getTile(s2.anchor.site.q, s2.anchor.site.r).improvement.sagaUid).toBe(saga.uid);
    });
});
