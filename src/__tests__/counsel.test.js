// The Steward's Counsel (systems/counsel.js): a read-only advisor that ranks
// threats, opportunities and goals from data rules (data/counsel.json).
// Unit tests for a handful of rules and the engine, plus a playtest run: the
// counsel reads the harness game every day for a few hundred days and must
// never throw, always return well-formed items, and never change the game.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Counsel, GROUPS, SEVERITIES, fillTemplate } from '../systems/counsel.js';
import { House } from '../systems/house.js';
import { Seasons } from '../world/seasons.js';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    if (!DataLoader.counsel) DataLoader.counsel = DataLoader._gamedata.counsel;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
});

/** A small flat world: no tiles beyond what a test adds, a day and a width. */
function fakeWorld(extra = {}) {
    return {
        day: 40, width: 40, height: 40, units: [], kingdoms: [],
        getTile: () => null, getKingdom: () => null,
        ...extra,
    };
}

function freshPlayer() {
    const p = new Player({ firstName: 'Test', lastName: 'Steward', gender: 'male', age: 25 });
    p.q = 10;
    p.r = 10;
    p.gold = 100;
    p.inventory = { bread: 20 };
    return p;
}

const ids = (list) => list.map(i => i.rule);

/** Every item has the documented shape. */
function assertWellFormed(scan, where = '') {
    expect(Array.isArray(scan.items), where).toBe(true);
    for (const g of ['threats', 'opportunities', 'goals']) expect(Array.isArray(scan[g]), where).toBe(true);
    expect(scan.threats.length + scan.opportunities.length + scan.goals.length).toBe(scan.items.length);
    const seen = new Set();
    for (const i of scan.items) {
        expect(typeof i.id, where).toBe('string');
        expect(seen.has(i.id), `${where} duplicate id ${i.id}`).toBe(false);
        seen.add(i.id);
        expect(GROUPS, where).toContain(i.group);
        expect(Object.keys(SEVERITIES), where).toContain(i.severity);
        expect(Number.isFinite(i.priority), `${where} ${i.id} priority`).toBe(true);
        expect(typeof i.text, where).toBe('string');
        expect(i.text.length, `${where} ${i.id} empty text`).toBeGreaterThan(0);
        expect(i.text, `${where} ${i.id} unfilled placeholder`).not.toMatch(/\{\w+\}|undefined|NaN|\[object/);
        expect(typeof i.icon, where).toBe('string');
        expect(i.action && typeof i.action === 'object', where).toBe(true);
        expect(i.action.panel === null || typeof i.action.panel === 'string', where).toBe(true);
        expect(i.action.q === null || Number.isFinite(i.action.q), where).toBe(true);
        expect(i.action.r === null || Number.isFinite(i.action.r), where).toBe(true);
    }
}

describe('Counsel engine', () => {
    it('fills templates, rounding numbers and blanking missing keys', () => {
        expect(fillTemplate('{a} has {n} days{x}', { a: 'Avel', n: 2.6 })).toBe('Avel has 3 days');
    });

    it('every data rule names a known reader and group', () => {
        const rules = Counsel.rules();
        expect(rules.length).toBeGreaterThanOrEqual(30);
        for (const r of rules) {
            expect(typeof Counsel.READERS[r.reader], r.id).toBe('function');
            expect(GROUPS).toContain(r.group);
            expect(typeof r.text).toBe('string');
        }
        expect(new Set(rules.map(r => r.id)).size).toBe(rules.length);
    });

    it('never throws on partial state: empty objects, nulls, garbage fields', () => {
        const garbage = {
            q: 'x', r: null, gold: 'lots', inventory: 7, realmWars: { besieged: 5, wars: [null] }, ailments: { list: [null, { kind: 'disease', id: 'nope' }] },
            petitions: { pending: [{}] }, ships: [null, {}], travelParty: [null], rivals: { list: [{}] }, sagas: { active: [{ known: true, units: [null] }] },
            throne: { ruling: { court: { factions: 3 } }, claims: { x: null } }, children: [{ upbringing: { comeOfAge: true } }],
            house: { ambition: { id: 'nope' } }, traits: { progress: null }, bountyHunter: { rank: 'a' }, underworld: { heat: { k: 'hot' }, guild: { member: true } },
            quests: { active: [{ objectives: [null, { target: 0 }] }] }, discovery: { sites: [null, { hint: 'rumoured' }] }, merchant: { company: { contracts: [null] } },
        };
        for (const [p, w] of [[null, null], [{}, null], [{}, {}], [garbage, fakeWorld()], [garbage, {}], [freshPlayer(), null]]) {
            const s = Counsel.scan(p, w, { fresh: true });
            assertWellFormed(s);
        }
    });

    it('memoises per day; fresh re-reads; a rule added in data needs no code beyond its reader', () => {
        const saved = DataLoader.counsel;
        let calls = 0;
        Counsel.READERS.__probe = (ctx, params) => { calls++; return [{ n: params.n, q: 1, r: 2 }]; };
        Counsel.READERS.__heavy = () => { calls += 100; return [{}]; };
        DataLoader.counsel = { rules: [
            { id: 'probe', group: 'opportunity', reader: '__probe', priority: 5, text: 'Probe {n}', params: { n: 7 }, panel: 'quests' },
            { id: 'heavy', group: 'goal', reader: '__heavy', priority: 1, text: 'Heavy', heavy: true },
            { id: 'off', group: 'goal', reader: '__probe', text: 'Off', enabled: false },
        ] };
        try {
            const p = freshPlayer();
            const w = fakeWorld();
            const s = Counsel.scan(p, w);
            expect(s.opportunities[0]).toMatchObject({ id: 'probe', text: 'Probe 7', action: { panel: 'quests', q: 1, r: 2 } });
            expect(ids(s.goals)).toEqual(['heavy']);
            expect(calls).toBe(101);
            Counsel.scan(p, w);
            expect(calls).toBe(101); // memoised for the day
            Counsel.scan(p, w, { fresh: true });
            expect(calls).toBe(102); // fresh: the light rule re-reads, the heavy one waits for tomorrow
            w.day++;
            Counsel.scan(p, w);
            expect(calls).toBe(203);
        } finally {
            DataLoader.counsel = saved;
            delete Counsel.READERS.__probe;
            delete Counsel.READERS.__heavy;
        }
    });

    it('a reader that throws is skipped, not fatal', () => {
        const saved = DataLoader.counsel;
        Counsel.READERS.__boom = () => { throw new Error('boom'); };
        DataLoader.counsel = { rules: [{ id: 'boom', group: 'threat', reader: '__boom', text: 'x' }] };
        try {
            expect(Counsel.scan(freshPlayer(), fakeWorld(), { fresh: true }).items).toEqual([]);
        } finally {
            DataLoader.counsel = saved;
            delete Counsel.READERS.__boom;
        }
    });

    it('ranks by severity then priority; the brief takes threats first', () => {
        const p = freshPlayer();
        p.inventory = {};
        p.realmWars = { besieged: { '3,4': { key: '3,4', q: 3, r: 4, name: 'Oakvale', kingdomName: 'Varn', stores: 20, startDay: 30 } } };
        p.house = { ambition: null };
        const s = Counsel.scan(p, fakeWorld(), { fresh: true });
        expect(s.threats[0].rule).toBe('starvation'); // critical (no food) outranks a warning siege
        expect(s.threats[0].severity).toBe('critical');
        const brief = Counsel.brief(p, fakeWorld());
        expect(brief.length).toBeLessThanOrEqual(3);
        expect(brief[0].group).toBe('threat');
        expect(Counsel.threatCount(p, fakeWorld())).toBe(s.threats.length);
    });
});

describe('Counsel rules', () => {
    it('holding_siege: a besieged holding, critical when stores run low, with its hex', () => {
        const p = freshPlayer();
        p.realmWars = { besieged: { '3,4': { key: '3,4', q: 3, r: 4, name: 'Oakvale', kingdomName: 'Varn', stores: 5, startDay: 30 } } };
        const item = Counsel.scan(p, fakeWorld(), { fresh: true }).threats.find(i => i.rule === 'holding_siege');
        expect(item).toMatchObject({ severity: 'critical', action: { panel: 'holdingSieges', q: 3, r: 4 } });
        expect(item.text).toBe('Oakvale is besieged by Varn: 5 days of food left');
    });

    it('deadly_disease: only a stage that can kill raises it', () => {
        const p = freshPlayer();
        p.ailments = { list: [{ key: 'd1', id: 'lung_fever', kind: 'disease', stage: 0, dayInStage: 0, stageDays: 3 }] };
        const defs = DataLoader._gamedata.ailments;
        const diseaseId = Object.keys(defs.diseases || defs.ailments || {}).find(id => {
            const st = ((defs.diseases || defs.ailments)[id] || {}).stages || [];
            return st.length > 1 && !st[0].deathChance && st.some(x => x.deathChance > 0);
        });
        expect(diseaseId).toBeTruthy();
        const stages = (defs.diseases || defs.ailments)[diseaseId].stages;
        p.ailments.list[0].id = diseaseId;
        expect(ids(Counsel.scan(p, fakeWorld(), { fresh: true }).threats)).not.toContain('deadly_disease');
        p.ailments.list[0].stage = stages.findIndex(x => x.deathChance > 0);
        const item = Counsel.scan(p, fakeWorld(), { fresh: true }).threats.find(i => i.rule === 'deadly_disease');
        expect(item.severity).toBe('critical');
        expect(item.action.panel).toBe('physician');
    });

    it('starvation: low food warns, starving is critical, at sea is the hold\'s business', () => {
        const p = freshPlayer();
        p.inventory = { bread: 2 };
        expect(Counsel.scan(p, fakeWorld(), { fresh: true }).threats.find(i => i.rule === 'starvation').text).toBe('Only 2 days of food left in your pack');
        p.starvationDays = 2;
        expect(Counsel.scan(p, fakeWorld(), { fresh: true }).threats.find(i => i.rule === 'starvation').severity).toBe('critical');
        p.starvationDays = 0;
        p.boardedShip = 's1';
        expect(ids(Counsel.scan(p, fakeWorld(), { fresh: true }).threats)).not.toContain('starvation');
    });

    it('petition_expiring: a petition about to lapse', () => {
        const p = freshPlayer();
        p.petitions = { pending: [{ id: 'p1', title: 'The Miller\'s Dam', icon: '⚖️', arrivedDay: 31, expiresDay: 41 }, { id: 'p2', title: 'Far Off', expiresDay: 60 }] };
        const items = Counsel.scan(p, fakeWorld(), { fresh: true }).threats.filter(i => i.rule === 'petition_expiring');
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe('The petition "The Miller\'s Dam" lapses in 1 day');
        expect(items[0].severity).toBe('critical');
    });

    it('unpaid: a mercenary company the purse cannot pay', () => {
        const p = freshPlayer();
        p.gold = 10;
        p.mercenaryCompanies = [{ id: 'm1', name: 'The Grey Lances', dailyWage: 25, loyalty: 70 }];
        const item = Counsel.scan(p, fakeWorld(), { fresh: true }).threats.find(i => i.rule === 'unpaid');
        expect(item.text).toBe('The Grey Lances cannot be paid their 25 gold a day');
        expect(item.severity).toBe('critical');
    });

    it('cheap_harvest: autumn food prices, not spring', () => {
        const p = freshPlayer();
        const autumn = Array.from({ length: 120 }, (_, i) => i + 1).find(d => Seasons.priceModifier('grain', d) <= -0.2 && Seasons.priceTrend('grain', d) !== 'falling');
        expect(autumn).toBeTruthy();
        expect(ids(Counsel.scan(p, fakeWorld({ day: autumn }), { fresh: true }).opportunities)).toContain('cheap_harvest');
        expect(ids(Counsel.scan(p, fakeWorld({ day: 10 }), { fresh: true }).opportunities)).not.toContain('cheap_harvest');
    });

    it('heir_of_age and quest_near: grown children to place, quests nearly done', () => {
        const p = freshPlayer();
        p.children = [
            { id: 'c1', firstName: 'Ada', age: 17, isAlive: true, upbringing: { comeOfAge: true } },
            { id: 'c2', firstName: 'Bram', age: 9, isAlive: true, upbringing: {} },
        ];
        p.quests = { active: [{ id: 'q1', title: 'Grain for Hollin', objectives: [{ target: 10, current: 8 }] }, { id: 'q2', title: 'Far', objectives: [{ target: 10, current: 1 }] }] };
        const s = Counsel.scan(p, fakeWorld(), { fresh: true });
        const heir = s.opportunities.find(i => i.rule === 'heir_of_age');
        expect(heir).toMatchObject({ text: 'Ada (17) has come of age: find them a match or a court', action: { panel: 'child', arg: 'c1' } });
        expect(s.opportunities.filter(i => i.rule === 'quest_near').map(i => i.text)).toEqual(['Grain for Hollin is 80% done']);
    });

    it('house_ambition and next_trait: the next milestone and the nearest trait', () => {
        const p = freshPlayer();
        House.initialize(p, fakeWorld());
        House.chooseAmbition(p.house, House.ambitions()[0].id, 1);
        const traitId = Object.keys(DataLoader._gamedata.traits.traits)[0];
        const def = DataLoader._gamedata.traits.traits[traitId];
        p.traits = { deeds: {}, progress: { [traitId]: def.threshold * 0.8 }, earned: {}, notices: [] };
        const goals = Counsel.scan(p, fakeWorld(), { fresh: true }).goals;
        expect(goals.find(i => i.rule === 'house_ambition').text).toMatch(/\(0\/3\): next, /);
        expect(goals.find(i => i.rule === 'next_trait').text).toBe(`${def.name} is 80% earned`);
    });

    it('is read-only: a scan leaves the player untouched', () => {
        const p = freshPlayer();
        p.throne = { ruling: { kingdomId: 'k1', court: {} } }; // a half-formed court Kingship.court would backfill
        p.house = { name: 'Test', reigns: [], currentReign: undefined };
        const before = JSON.stringify(p);
        Counsel.scan(p, fakeWorld(), { fresh: true });
        expect(JSON.stringify(p)).toBe(before);
    });
});

describe('Counsel over a played game', () => {
    it('reads the playtest game every day for 300 days: never throws, well-formed, read-only, no RNG', () => {
        const game = newGame(4242);
        const stats = {};
        const seenRules = new Set();
        let maxItems = 0;
        for (let i = 0; i < 300; i++) {
            botDay(game, stats);
            const res = endDay(game);
            const { player, world } = game;
            const where = `day ${world.day}`;

            const check = i % 50 === 25;
            const before = check ? JSON.stringify({ w: SaveLoad.serializeWorld(world), p: SaveLoad.serializePlayer(player) }) : null;
            const rng = vi.spyOn(Utils, 'random');
            let scan;
            try {
                scan = Counsel.scan(player, world, { fresh: true });
                Counsel.brief(player, world);
                Counsel.threatCount(player, world);
            } catch (e) {
                throw new Error(`${where}: counsel threw: ${e.stack}`);
            } finally {
                expect(rng, `${where}: counsel drew randomness`).not.toHaveBeenCalled();
                rng.mockRestore();
            }
            assertWellFormed(scan, where);
            if (check) {
                const after = JSON.stringify({ w: SaveLoad.serializeWorld(world), p: SaveLoad.serializePlayer(player) });
                expect(after === before, `${where}: counsel changed the game`).toBe(true);
            }
            for (const it of scan.items) seenRules.add(it.rule);
            maxItems = Math.max(maxItems, scan.items.length);
            if (res.died) break;
        }
        // The advisor actually says things over a played game
        expect(seenRules.size).toBeGreaterThan(2);
        expect(seenRules.has('legacy')).toBe(true); // scored on a shadow House, so even a new game's line counts
        expect(maxItems).toBeGreaterThan(0);
    }, 120000);
});
