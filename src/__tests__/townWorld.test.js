// The realm's affairs seen in a town's streets (systems/townWorld.js): what the
// state of the world says the street map shows — the crowns' banners, soldiers
// billeted in a war, a muster outside the walls, a siege's fires and fewer people
// out, the wounded near the front, crusaders and a preacher under an open call,
// an inquisitor's hearing, a conquered town's garrison, famine, the Church's ban,
// the news cried, who walks up to the player — and the heralds proclaiming holy
// wars and unions (systems/heralds.js).

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { TownWorld, townHash } from '../systems/townWorld.js';
import { HolyWars } from '../systems/holyWars.js';
import { Heralds } from '../systems/heralds.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Utils } from '../core/utils.js';

beforeAll(() => {
    DataLoader._gamedata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/gamedata.json'), 'utf-8'));
    DataLoader.chatter = DataLoader._gamedata.chatter;
});
afterEach(() => vi.restoreAllMocks());

/** Two realms side by side: Arvenland (towns at q 2..8) and Belmarch (towns at q 20..26). */
function makeWorld(day = 400) {
    const W = 80, H = 20;
    const k = (id, name, color, extra = {}) => ({ id, name, color, isAlive: true, wars: [], ruler: `King of ${name}`, territory: [], ...extra });
    const kingdoms = [k('k1', 'Kingdom of Arvenland', '#8a1f1f'), k('k2', 'Belmarch', '#1f3f8a'), k('k3', 'Corvath', '#2f6b2a')];
    const town = (name, q, r, kingdom, type = 'town') => ({ name, q, r, kingdom, type, population: 2000 });
    const towns = [
        town('Ashford', 2, 5, 'k1'), town('Brook', 8, 5, 'k1'), town('Arven', 4, 12, 'k1', 'capital'),
        town('Belgate', 20, 5, 'k2'), town('Belmar', 26, 5, 'k2', 'capital'),
    ];
    kingdoms[0].capital = { q: 4, r: 12 };
    kingdoms[1].capital = { q: 26, r: 5 };
    const tiles = {};
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) tiles[`${q},${r}`] = { q, r, kingdom: q < 14 ? 'k1' : q < 32 ? 'k2' : null, settlement: null };
    for (const s of towns) tiles[`${s.q},${s.r}`].settlement = s;
    const world = {
        day, width: W, height: H, units: [], events: [], activeEvents: [], kingdoms, generationParams: { seed: 77 },
        getKingdom: id => kingdoms.find(x => x.id === id) || null,
        getSettlementViews: () => towns,
        getTile: (q, r) => tiles[`${q},${r}`] || null,
    };
    return { world, kingdoms, towns, by: name => towns.find(t => t.name === name) };
}

const war = (a, b) => { a.wars.push(b.id); b.wars.push(a.id); };

describe('TownWorld.view — who rules', () => {
    it('a town at peace flies its own crown and shows nothing else', () => {
        const { world, by } = makeWorld();
        const v = TownWorld.view(world, null, by('Ashford'));
        expect(v.crowns.map(c => c.kingdomId)).toEqual(['k1']);
        expect(v.crowns[0].color).toBe('#8a1f1f');
        expect(v.billet).toBe(0);
        expect(v.muster).toBeNull();
        expect(v.siege).toBeNull();
        expect(v.holy).toBeNull();
        expect(v.conquered).toBeNull();
        expect(v.famine).toBe(false);
        expect(v.stay).toBe(0);
    });

    it('a union\'s junior realm flies both crowns; the senior only its own', () => {
        const { world, kingdoms, by } = makeWorld();
        kingdoms[0].personalUnion = { partnerId: 'k2', role: 'senior' };
        kingdoms[1].personalUnion = { partnerId: 'k1', role: 'junior' };
        expect(TownWorld.view(world, null, by('Belgate')).crowns.map(c => [c.kingdomId, c.role])).toEqual([['k2', 'own'], ['k1', 'senior']]);
        expect(TownWorld.view(world, null, by('Ashford')).crowns.map(c => c.kingdomId)).toEqual(['k1']);
    });

    it('a town lately taken has the new crown\'s garrison; one taken long ago does not', () => {
        const { world, kingdoms, by } = makeWorld(400);
        const s = by('Belgate');
        kingdoms[2].lostTowns = [{ q: s.q, r: s.r, name: s.name, by: 'k2', byName: 'Belmarch', day: 380, capital: false, native: true }];
        const v = TownWorld.view(world, null, s);
        expect(v.conquered).toMatchObject({ from: 'k3', fromName: 'Corvath', by: 'k2' });
        expect(v.conquered.garrison).toBeGreaterThan(0);
        // the lines speak of the old crown
        expect(TownWorld.line('grumble_conquered', 'x', { old: 'Corvath', new: 'Belmarch' })).not.toMatch(/\{/);
        kingdoms[2].lostTowns[0].day = 400 - TownWorld.config().conquered.days - 5;
        expect(TownWorld.view(world, null, s).conquered).toBeNull();
        // (reading it never writes a lostTowns list onto a realm)
        expect(kingdoms[0].lostTowns).toBeUndefined();
    });
});

describe('TownWorld.view — war', () => {
    it('a realm at war billets soldiers in every town; its town nearest the foe\'s seat is the muster', () => {
        const { world, kingdoms, by } = makeWorld();
        war(kingdoms[0], kingdoms[1]);
        const brook = TownWorld.view(world, null, by('Brook'));
        const ash = TownWorld.view(world, null, by('Ashford'));
        expect(brook.billet).toBe(TownWorld.config().war.billet.town);
        expect(ash.billet).toBe(brook.billet);
        expect(brook.foes).toEqual([{ id: 'k2', name: 'Belmarch' }]);
        // Brook (q 8) is nearest Belmar (q 26): the host gathers there
        expect(brook.muster).toMatchObject({ kingdomId: 'k1', foe: 'Belmarch', holy: false });
        expect(brook.muster.tents).toBeGreaterThan(0);
        expect(ash.muster).toBeNull();
        expect(brook.key).not.toBe(ash.key);
    });

    it('a realm\'s war host beside a town gathers there', () => {
        const { world, kingdoms, by } = makeWorld();
        war(kingdoms[0], kingdoms[1]);
        world.units.push({ type: 'war_host', kingdomId: 'k1', q: 3, r: 5 });
        expect(TownWorld.view(world, null, by('Ashford')).muster).not.toBeNull();
    });

    it('a foe\'s host before the walls is a siege: fires, fewer out, the wounded', () => {
        const { world, kingdoms, by } = makeWorld();
        war(kingdoms[0], kingdoms[1]);
        world.units.push({ type: 'war_host', kingdomId: 'k2', q: 2, r: 6 });
        const v = TownWorld.view(world, null, by('Ashford'));
        expect(v.siege).toMatchObject({ kingdomId: 'k2', name: 'Belmarch', source: 'host' });
        expect(v.siege.fires).toBeGreaterThan(0);
        expect(v.muster).toBeNull();
        expect(v.stay).toBe(TownWorld.config().war.stay.siege);
        expect(v.front).toBe(true);
        expect(v.wounded).toBeGreaterThan(0);
    });

    it('the player\'s own holding under siege reads from systems/holdingSieges.js', () => {
        const { world, by } = makeWorld();
        const s = by('Ashford');
        const player = { realmWars: { besieged: { '2,5': { q: 2, r: 5, kingdomId: 'k3', kingdomName: 'Corvath' } } } };
        const v = TownWorld.view(world, player, s);
        expect(v.siege).toMatchObject({ kingdomId: 'k3', source: 'holding' });
        expect(v.stay).toBeGreaterThan(0);
    });

    it('a town by the front (the foe\'s land within reach) has wounded at the temple; one far from it does not', () => {
        const { world, kingdoms, towns } = makeWorld();
        war(kingdoms[0], kingdoms[1]);
        const near = { name: 'Edge', q: 12, r: 8, kingdom: 'k1', type: 'village' };
        towns.push(near);
        world.getTile(12, 8).settlement = near;
        const vn = TownWorld.view(world, null, near);
        expect(vn.front).toBe(true);
        expect(vn.wounded).toBe(TownWorld.config().war.wounded.village);
        const vf = TownWorld.view(world, null, towns.find(t => t.name === 'Ashford'));
        expect(vf.front).toBe(false);
        expect(vf.wounded).toBe(0);
    });

    it('a fresh battle cairn by a town at war brings the wounded', () => {
        const { world, kingdoms, by } = makeWorld(400);
        war(kingdoms[0], kingdoms[1]);
        const s = by('Ashford');
        s.memory = { marks: [{ id: 'm1', k: 'cairn', d: 390, dead: 80 }], seq: 1 };
        expect(TownWorld.view(world, null, s).wounded).toBeGreaterThan(0);
        s.memory.marks[0].d = 300;
        expect(TownWorld.view(world, null, s).wounded).toBe(0);
    });
});

describe('TownWorld.view — the fronts of wars between crowns (KingdomAI.noteFront)', () => {
    /** makeWorld plus Lowmere (k1, q 10 r 16) facing Southgate (k2, q 20 r 16), territories filled, Arvenland at war with Belmarch. */
    function front(day = 400) {
        const m = makeWorld(day);
        const { world, kingdoms, towns } = m;
        const add = (name, q, r, kingdom) => { const s = { name, q, r, kingdom, type: 'town', population: 1500 }; towns.push(s); world.getTile(q, r).settlement = s; return s; };
        add('Lowmere', 10, 16, 'k1');
        add('Southgate', 20, 16, 'k2');
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const t = world.getTile(q, r);
                const k = kingdoms.find(x => x.id === t.kingdom);
                if (k) k.territory.push({ q, r });
            }
        }
        war(kingdoms[0], kingdoms[1]);
        kingdoms[0].warState = { k2: { since: day - 20, gains: 0, goal: 5 } };
        kingdoms[1].warState = { k1: { since: day - 20, gains: 0, goal: 5 } };
        return m;
    }

    it('a battle won beside a foe\'s town lays siege to it: siege lines in its streets, the host mustering in the town facing it', () => {
        const { world, kingdoms, by } = front();
        const f = KingdomAI.noteFront(kingdoms[0], kingdoms[1], world, 19, 16, true);
        expect(f).toMatchObject({ q: 20, r: 16, name: 'Southgate', since: 400, siege: true });
        const v = TownWorld.view(world, null, by('Southgate'));
        expect(v.siege).toMatchObject({ kingdomId: 'k1', name: 'Kingdom of Arvenland', source: 'front', since: 400 });
        expect(v.siege.fires).toBeGreaterThan(0);
        expect(v.stay).toBe(TownWorld.config().war.stay.siege);
        expect(v.wounded).toBeGreaterThan(0);
        // the attacker's host gathers in its town nearest the front, not nearest the foe's seat
        expect(TownWorld.view(world, null, by('Lowmere')).muster).toMatchObject({ kingdomId: 'k1', foe: 'Belmarch' });
        expect(TownWorld.view(world, null, by('Brook')).muster).toBeNull();
        // (saved on the war's own record: nothing new to save)
        expect(kingdoms[0].warState.k2.front).toBe(f);
    });

    it('a battle a few hexes off threatens the town (fewer out, the war talked of) without a siege; a rout lifts a siege', () => {
        const { world, kingdoms, by } = front();
        KingdomAI.noteFront(kingdoms[0], kingdoms[1], world, 17, 16, false);
        const v = TownWorld.view(world, null, by('Southgate'));
        expect(v.siege).toBeNull();
        expect(v.threat).toMatchObject({ kingdomId: 'k1', name: 'Kingdom of Arvenland' });
        expect(v.front).toBe(true);
        expect(v.stay).toBe(TownWorld.config().war.stay.threat);
        expect(v.key).not.toBe(TownWorld.view(world, null, by('Belgate')).key);
        // at the walls: a siege, the same front (its first day kept)
        world.day = 405;
        expect(KingdomAI.noteFront(kingdoms[0], kingdoms[1], world, 20, 16, false)).toMatchObject({ since: 400, last: 405, siege: true });
        expect(KingdomAI.noteFront(kingdoms[0], kingdoms[1], world, 20, 16, false, true).siege).toBe(false);
    });

    it('a front goes cold, ends with the town\'s fall or the war, and is never made where no war is kept', () => {
        const { world, kingdoms, by } = front();
        KingdomAI.noteFront(kingdoms[0], kingdoms[1], world, 20, 16, true);
        world.day = 400 + KingdomAI.WAR.frontDays + 1;
        expect(KingdomAI.frontOf(kingdoms[0], 'k2', world)).toBeNull();
        expect(TownWorld.view(world, null, by('Southgate')).siege).toBeNull();
        world.day = 401;
        expect(KingdomAI.frontOf(kingdoms[0], 'k2', world)).not.toBeNull();
        // taken: no front on it
        by('Southgate').kingdom = 'k1';
        expect(KingdomAI.frontOf(kingdoms[0], 'k2', world)).toBeNull();
        by('Southgate').kingdom = 'k2';
        // the war over
        kingdoms[0].wars = [];
        expect(KingdomAI.frontOf(kingdoms[0], 'k2', world)).toBeNull();
        // far from any of its towns: no front; no warState: nothing made, no RNG drawn
        kingdoms[0].wars = ['k2'];
        kingdoms[0].warState.k2.front = null;
        expect(KingdomAI.noteFront(kingdoms[0], kingdoms[1], world, 31, 0, true)).toBeNull();
        const spy = vi.spyOn(Utils, 'random');
        expect(KingdomAI.noteFront(kingdoms[1], kingdoms[2], world, 20, 16, true)).toBeNull();
        expect(kingdoms[1].warState.k3).toBeUndefined();
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('TownWorld — the muster\'s supply train and the drill', () => {
    it('a train is due on its clock, in its hours, once the last has gone', () => {
        const C = TownWorld.config().war.train;
        expect(TownWorld.trainDue(10, 6, 9, 0, C)).toBe(true);
        expect(TownWorld.trainDue(5, 6, 9, 0, C)).toBe(false);
        expect(TownWorld.trainDue(10, 6, 9, 2, C)).toBe(false);
        expect(TownWorld.trainDue(10, 6, 23, 0, C)).toBe(false);
        expect(C.wagons).toBeGreaterThan(1);
        expect(C.unloadSecs).toBeGreaterThan(0);
    });

    it('the drill keeps one beat for every man: on guard, thrust (its frames held in turn), recover, a step forward then back', () => {
        const D = TownWorld.config().war.drillBeat;
        const at = t => ({ ...TownWorld.drillBeat(t, {}, D) });
        expect(at(0.2)).toMatchObject({ beat: 'ready', frame: -1, late: false, cycle: 0 });
        const frames = [];
        for (let t = D.thrust; t < D.recover; t += 0.02) frames.push(at(t).frame);
        expect(new Set(frames)).toEqual(new Set([1, 2, 3, 4]));
        expect(frames[0]).toBe(1);
        expect(frames[frames.length - 1]).toBe(4);
        expect(at(D.recover + 0.1).beat).toBe('recover');
        expect(at(D.step + 0.1)).toMatchObject({ beat: 'step', late: true });
        expect(at(D.cycle - 0.1)).toMatchObject({ beat: 'ready', late: true, cycle: 0 });
        expect(at(D.cycle + D.step + 0.1)).toMatchObject({ beat: 'step', cycle: 1 });
        // (the out object is reused: nothing allocated per frame)
        const o = {};
        expect(TownWorld.drillBeat(1.5, o, D)).toBe(o);
        expect(TownWorld.config().drillCalls.thrust).toBeTruthy();
    });
});

describe('TownWorld.view — the cross', () => {
    function holy(world, extra = {}) {
        world.holyWars = { v: 1, sees: {}, past: [], log: [], wars: [{ id: 4, seeKey: 'solaris|orthodox', faithId: 'solaris', head: 'Pontiff Clement', phase: 'call', invited: ['k1'], answered: [], refused: [], members: [], target: 'k2', targetName: 'Belmarch', towns0: [{ q: 26, r: 5, name: 'Belmar' }], crusaders: [], ...extra }] };
    }

    it('an open call to a holy war of the realm\'s faith: a preacher in the square', () => {
        const { world, by } = makeWorld();
        holy(world);
        const v = TownWorld.view(world, null, by('Ashford'));
        expect(v.holy.preach).toMatchObject({ warId: 4, head: 'Pontiff Clement', target: 'Belmarch' });
        expect(v.holy.crusaders).toBe(0);
        // never in the target's own towns
        expect(TownWorld.view(world, null, by('Belgate')).holy).toBeNull();
    });

    it('a crown has answered: crusaders on the road near the muster, a camp at the muster itself', () => {
        const { world, by } = makeWorld();
        holy(world, { phase: 'war', members: ['k1'] });
        const muster = HolyWars.musterOf(world, world.holyWars.wars[0]);
        expect(muster.town).toBe('Brook');
        const at = TownWorld.view(world, null, by('Brook'));
        expect(at.holy.musterHere).toBe(true);
        expect(at.holy.crusaders).toBe(TownWorld.config().holy.musterCrusaders);
        expect(at.holy.preach).toBeNull();
        expect(at.muster).not.toBeNull();
        const road = TownWorld.view(world, null, by('Ashford'));
        expect(road.holy.crusaders).toBe(TownWorld.config().holy.crusaders);
        expect(road.holy.muster).toBe('Brook');
    });

    it('an inquisitor sitting a hearing stands in the square; one resting or riding does not', () => {
        const { world, by } = makeWorld();
        const s = by('Ashford');
        world.inquisition = { v: 1, n: 2, list: [{ id: 9, name: 'Brother Bernard', q: 2, r: 5, phase: 'hearing', zeal: 0.8 }], towns: [], log: [], past: [] };
        expect(TownWorld.view(world, null, s).inquisition).toMatchObject({ id: 9, name: 'Brother Bernard' });
        world.inquisition.list[0].phase = 'rest';
        expect(TownWorld.view(world, null, s).inquisition).toBeNull();
    });

    it('a realm under the Church\'s ban has its temple shut', () => {
        const { world, by } = makeWorld();
        vi.spyOn(HolyWars, 'banOf').mockImplementation((w, k) => (k && k.id === 'k1' ? { see: { key: 'solaris|orthodox', faithId: 'solaris', head: { name: 'Clement' } }, ban: { day: 300 } } : null));
        expect(TownWorld.view(world, null, by('Ashford')).banned).not.toBeNull();
        expect(TownWorld.view(world, null, by('Belgate')).banned).toBeNull();
    });
});

describe('TownWorld.view — hard times and news', () => {
    it('famine on the realm: beggars, bare stalls, fewer out', () => {
        const { world, by } = makeWorld();
        world.activeEvents.push({ id: 'famine', kingdomId: 'k1' });
        const v = TownWorld.view(world, null, by('Ashford'));
        expect(v.famine).toBe(true);
        expect(v.beggars).toBe(TownWorld.config().famine.beggars.town);
        expect(v.famineStalls).toBeGreaterThan(0);
        expect(v.stay).toBe(TownWorld.config().famine.stay);
        // the signs that read in every era, stalls or none: a bread line, empty baskets
        expect(v.breadLine).toBe(TownWorld.config().famine.breadLine.town);
        expect(v.baskets).toBe(TownWorld.config().famine.baskets.town);
        expect(TownWorld.view(world, null, by('Belgate')).famine).toBe(false);
        expect(TownWorld.view(world, null, by('Belgate')).breadLine).toBe(0);
        expect(TownWorld.line('bread_line', 'x')).toBeTruthy();
        expect(TownWorld.line('granary_guard', 'x')).toBeTruthy();
    });

    it('the news cried is what the heralds have brought to the town these days', () => {
        const { world, by } = makeWorld(400);
        const player = { heralds: { list: [
            { id: 1, kind: 'war', day: 399, text: 'War between Arvenland and Belmarch!', q: 2, r: 5 },
            { id: 2, kind: 'peace', day: 380, text: 'Old peace.', q: 2, r: 5 },
            { id: 3, kind: 'coronation', day: 400, text: 'A king crowned far away.', q: 39, r: 19 },
        ] } };
        const v = TownWorld.view(world, player, by('Ashford'));
        expect(v.news.map(n => n.text)).toEqual(['War between Arvenland and Belmarch!']);
        // (the news never changes what the streets are planned to show)
        expect(v.key).toBe(TownWorld.view(world, null, by('Ashford')).key);
    });

    it('who walks up: a hash of the day and town; a letter first, then a petition, then a beggar', () => {
        const day = Array.from({ length: 50 }, (_, i) => 400 + i).find(d => townHash('approach', d, '2,5') < TownWorld.config().approach.chance);
        expect(day).toBeDefined();
        expect(TownWorld.approacher(day, '2,5', { letterDay: day - 1, petitions: 2, holdsCourt: true, gold: 500, hardTimes: true })).toBe('messenger');
        expect(TownWorld.approacher(day, '2,5', { letterDay: day - 20, petitions: 2, holdsCourt: true, gold: 500, hardTimes: true })).toBe('petitioner');
        expect(TownWorld.approacher(day, '2,5', { petitions: 2, holdsCourt: false, gold: 500, hardTimes: true })).toBe('beggar');
        expect(TownWorld.approacher(day, '2,5', { gold: 5, hardTimes: true })).toBeNull();
        const quiet = Array.from({ length: 50 }, (_, i) => 400 + i).find(d => townHash('approach', d, '2,5') >= TownWorld.config().approach.chance);
        expect(TownWorld.approacher(quiet, '2,5', { letterDay: quiet })).toBeNull();
    });

    it('drill hours and lines read from data', () => {
        expect(TownWorld.inHours(8, TownWorld.config().war.drill)).toBe(true);
        expect(TownWorld.inHours(12, TownWorld.config().war.drill)).toBe(false);
        expect(TownWorld.line('preacher', 1, { head: 'Clement', target: 'Belmarch' })).toMatch(/Clement|Belmarch|cross|vow/i);
        expect(Array.isArray(TownWorld.config().looks.preacher)).toBe(true);
    });
});

describe('Heralds — holy wars and unions are cried', () => {
    it('a holy war called and a union formed become proclamations', () => {
        const { world, kingdoms } = makeWorld(400);
        const player = { q: 2, r: 5 };
        Heralds.processDay(world, player);   // (the first tick only takes the snapshot)
        world.day = 401;
        world.holyWars = { v: 1, sees: { 'solaris|orthodox': { q: 4, r: 12 } }, past: [], wars: [{ id: 4, head: 'Pontiff Clement', target: 'k2', targetName: 'Belmarch' }], log: [{ day: 401, kind: 'call', war: 4, key: 'solaris|orthodox', text: 'called' }] };
        world.realmUnions = { seq: 1, refused: {}, history: [{ id: 1, senior: { id: 'k1', name: kingdoms[0].name }, junior: { id: 'k2', name: 'Belmarch' }, monarch: 'King Aldric', from: 401 }] };
        Heralds.processDay(world, player);
        const kinds = player.heralds.list.map(p => p.kind);
        expect(kinds).toContain('holy_war');
        expect(kinds).toContain('union');
        const hw = player.heralds.list.find(p => p.kind === 'holy_war');
        expect(hw.text).toMatch(/Pontiff Clement/);
        expect(hw.text).toMatch(/Belmarch/);
        // once only
        world.day = 402;
        Heralds.processDay(world, player);
        expect(player.heralds.list.filter(p => p.kind === 'holy_war').length).toBe(1);
    });
});
