// A living world: townsfolk talk (systems/chatter.js), the heralds
// (systems/heralds.js), the tavern's regional news and the player's deeds
// spreading as gossip (systems/gossip.js deed rumours).

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Chatter } from '../systems/chatter.js';
import { Heralds } from '../systems/heralds.js';
import { Gossip } from '../systems/gossip.js';
import { Petitions } from '../systems/petitions.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { Tavern } from '../player/tavern.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const W = 60;
const H = 40;

/** Plains, two realms: Arvenland (k1) inland, Belmarch (k2) with a port. Day 40 (Summer). */
function makeWorld(day = 40) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: { id: 'grassland', passable: true } });
        tiles.push(row);
    }
    // Sea east of Saltmere
    for (let r = 0; r < H; r++) for (let q = 22; q < 26; q++) tiles[r][q].terrain = { id: 'ocean', passable: false };
    const k1Towns = [
        { q: 5, r: 5, name: 'Tallow', type: 'town', kingdom: 'k1', population: 800 },
        { q: 12, r: 6, name: 'Brindle', type: 'capital', kingdom: 'k1', population: 2000 },
    ];
    const k2Towns = [
        { q: 21, r: 10, name: 'Saltmere', type: 'town', kingdom: 'k2', population: 900 },
        { q: 50, r: 30, name: 'Farfield', type: 'capital', kingdom: 'k2', population: 1500 },
    ];
    for (const t of [...k1Towns, ...k2Towns]) {
        tiles[t.r][t.q].settlement = { ...t };
        tiles[t.r][t.q].kingdom = t.kingdom;
    }
    const world = {
        day, width: W, height: H, tiles, units: [], activeEvents: [], events: [],
        kingdoms: [
            { id: 'k1', name: 'Arvenland', ruler: 'Queen Maud', isAlive: true, wars: [], relations: {}, settlements: k1Towns, capital: { q: 12, r: 6 } },
            { id: 'k2', name: 'Belmarch', ruler: 'King Osric', isAlive: true, wars: [], relations: {}, settlements: k2Towns, capital: { q: 50, r: 30 } },
        ],
        getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
        getKingdom: id => world.kingdoms.find(k => k.id === id) || null,
        getAllSettlements() {
            return [...k1Towns, ...k2Towns].map(t => ({ ...t }));
        },
    };
    return world;
}

function makePlayer() {
    const p = new Player();
    p.name = 'Aldric';
    p.q = 5; p.r = 5;
    p.gold = 1000;
    p.renown = 10;
    p.karma = 0;
    p.inventory = {};
    p.army = [];
    return p;
}

const groupsFor = (world, player, opts) => new Set(Chatter.candidates(Chatter.context(world, player, opts)).map(c => c.groupId));

beforeEach(() => Utils.setSeed(4242));

describe('chatter data', () => {
    it('is valid: every condition, value and token checks out', () => {
        expect(Chatter.validate()).toEqual([]);
    });

    it('has a rich bank of lines across many conditions', () => {
        expect(Chatter.lineCount()).toBeGreaterThanOrEqual(150);
        const keys = new Set(Chatter.groups().flatMap(g => Object.keys(g.when || {})));
        for (const k of ['war', 'playerWar', 'blockade', 'siege', 'season', 'lean', 'event', 'revolt', 'saga', 'rival',
            'newRuler', 'proclamation', 'deed', 'trait', 'court', 'title', 'houseGen', 'occupation', 'personality']) {
            expect(keys.has(k), k).toBe(true);
        }
    });

    it('fills every line without leftover tokens when its conditions hold', () => {
        const ctx = {
            day: 40, q: 0, r: 0, settlementName: 'Tallow', kingdomName: 'Arvenland', ruler: 'Queen Maud',
            playerName: 'Aldric', houseName: 'House Aldric', season: 'Summer', titleLabel: 'Baron',
            enemy: 'Belmarch', blockader: 'Belmarch', siegeTown: 'Brindle', oldRuler: 'King Old',
            events: [{ id: 'plague', name: 'plague', place: 'Brindle' }],
            sagas: [{ id: 'wyrm_wakes', name: 'The Wyrm Wakes', villain: 'Vorth' }],
            rival: { name: 'Kael', news: 'Kael looted a tomb.' },
            proclamations: [{ kind: 'peace', text: 'Peace!' }],
            deeds: [{ type: 'sack', place: 'Brindle', victim: 'Kael' }],
        };
        for (const g of Chatter.groups()) {
            for (const line of g.lines) {
                expect(Chatter.fill(line, ctx, g.when), `${g.id}: ${line}`).not.toMatch(/\{\w+\}/);
            }
        }
    });
});

describe('chatter context and selection', () => {
    it('a quiet world offers only seasonal small talk', () => {
        const world = makeWorld(40);
        const ids = groupsFor(world, makePlayer(), { q: 5, r: 5, occupation: 'villager' });
        expect([...ids].every(id => id.startsWith('season_'))).toBe(true);
        expect(ids.has('season_summer')).toBe(true);
    });

    it('a realm at war talks of the enemy, and soldiers and smiths in their own way', () => {
        const world = makeWorld();
        world.kingdoms[0].wars = ['k2'];
        world.kingdoms[1].wars = ['k1'];
        const player = makePlayer();
        const ctx = Chatter.context(world, player, { q: 5, r: 5, occupation: 'guard' });
        expect(ctx.war).toBe(true);
        expect(ctx.enemy).toBe('Belmarch');
        const ids = new Set(Chatter.candidates(ctx).map(c => c.groupId));
        expect(ids.has('war_any')).toBe(true);
        expect(ids.has('war_guard')).toBe(true);
        expect(ids.has('war_merchant')).toBe(false);
        const smith = groupsFor(world, player, { q: 5, r: 5, occupation: 'blacksmith_npc' });
        expect(smith.has('war_blacksmith')).toBe(true);
        // Specific lines win most of the time: the filled line names the enemy
        let named = 0;
        for (let i = 0; i < 40; i++) {
            const pick = Chatter.select(ctx, { roll: i / 40 });
            if (pick.text.includes('Belmarch')) named++;
            expect(pick.text).not.toMatch(/\{\w+\}/);
        }
        expect(named).toBeGreaterThan(20);
    });

    it('the player at war with the realm is noticed', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.realmWars = { wars: { k1: { kingdomId: 'k1' } }, ultimatums: {}, truces: {} };
        expect(groupsFor(world, player, { q: 5, r: 5 }).has('player_war')).toBe(true);
        expect(groupsFor(world, player, { q: 21, r: 10 }).has('player_war')).toBe(false);
    });

    it('a blockaded port talks of the enemy fleet; an inland town does not', () => {
        const world = makeWorld();
        world.kingdoms[1].navy = { blockades: { k1: 30 } };
        const player = makePlayer();
        const port = Chatter.context(world, player, { q: 21, r: 10, occupation: 'merchant' });
        expect(port.blockade).toBe(true);
        expect(port.blockader).toBe('Arvenland');
        expect(new Set(Chatter.candidates(port).map(c => c.groupId)).has('blockade_merchant')).toBe(true);
        const inland = Chatter.context(world, player, { q: 50, r: 30 });
        expect(inland.blockade).toBe(false);
    });

    it('a siege nearby — the player\'s own or one of a holding — is talked about', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.sieges = { active: { q: 12, r: 6, name: 'Brindle' }, history: [] };
        const ctx = Chatter.context(world, player, { q: 9, r: 6 });
        expect(ctx.siege).toBe(true);
        expect(ctx.siegeTown).toBe('Brindle');
        player.sieges.active = null;
        player.realmWars = { wars: {}, besieged: { '21,10': { q: 21, r: 10, name: 'Saltmere' } } };
        expect(Chatter.context(world, player, { q: 5, r: 5 }).siege).toBe(false);
        expect(Chatter.context(world, player, { q: 21, r: 12 }).siegeTown).toBe('Saltmere');
    });

    it('the lean weeks and the seasons', () => {
        const player = makePlayer();
        const lean = Chatter.context(makeWorld(110), player, { q: 5, r: 5, occupation: 'farmer' });
        expect(lean.season).toBe('Winter');
        expect(lean.lean).toBe(true);
        const ids = new Set(Chatter.candidates(lean).map(c => c.groupId));
        expect(ids.has('lean_any')).toBe(true);
        expect(ids.has('lean_farmer')).toBe(true);
        const harvest = groupsFor(makeWorld(75), player, { q: 5, r: 5, occupation: 'farmer' });
        expect(harvest.has('farmer_autumn')).toBe(true);
        expect(harvest.has('lean_any')).toBe(false);
    });

    it('plague and famine nearby, not across the world', () => {
        const world = makeWorld();
        world.activeEvents = [
            { id: 'plague', name: 'Plague', q: 12, r: 6, kingdomId: 'k1', settlementName: 'Brindle', regionName: 'Arvenland' },
            { id: 'famine', name: 'Hungry Months', q: 50, r: 30, kingdomId: 'k2', settlementName: 'Farfield', regionName: 'Belmarch' },
        ];
        const player = makePlayer();
        const near = Chatter.context(world, player, { q: 5, r: 5, occupation: 'priest' });
        expect(near.events.map(e => e.id)).toEqual(['plague']);
        const ids = new Set(Chatter.candidates(near).map(c => c.groupId));
        expect(ids.has('plague_any') && ids.has('plague_priest')).toBe(true);
        expect(ids.has('famine_any')).toBe(false);
        const line = Chatter.select(near, { filter: g => g.id === 'plague_any', roll: 0 });
        expect(line.text).toContain('Brindle');
        // The famine is in Belmarch: Saltmere (same realm) hears of it
        expect(groupsFor(world, player, { q: 21, r: 10 }).has('famine_any')).toBe(true);
    });

    it('a saga in the region, a rival who was here, a new ruler', () => {
        const world = makeWorld(40);
        const player = makePlayer();
        player.sagas = { active: [{ uid: 's1', id: 'wyrm_wakes', name: 'The Wyrm Wakes', chapter: 'raids', anchor: { kingdomId: 'k1', villain: 'Vorthax', settlement: { q: 12, r: 6, name: 'Brindle' } } }], done: [] };
        player.rivals = { list: [{ id: 3, name: 'Kael the Bold' }], news: [{ day: 36, q: 6, r: 5, rivalId: 3, text: 'Kael the Bold emptied the Old Keep.' }] };
        world.kingdoms[0].lastSuccession = { day: 30, oldRulerName: 'King Aldous', heirName: 'Queen Maud' };
        const ctx = Chatter.context(world, player, { q: 5, r: 5 });
        expect(ctx.sagas[0].id).toBe('wyrm_wakes');
        expect(ctx.rival.name).toBe('Kael the Bold');
        expect(ctx.newRuler).toBe(true);
        const ids = new Set(Chatter.candidates(ctx).map(c => c.groupId));
        for (const id of ['saga_any', 'saga_wyrm', 'rival_here', 'new_ruler']) expect(ids.has(id), id).toBe(true);
        expect(ids.has('saga_comet')).toBe(false);
        // Old news fades: the rival's visit and the new reign
        world.day = 80;
        const later = Chatter.context(world, player, { q: 5, r: 5 });
        expect(later.rival).toBe(null);
        expect(later.newRuler).toBe(false);
    });

    it('the player\'s traits, court reputation, titles and House', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.traits = { earned: { dread_lord: 1, pious: 1 }, progress: {} };
        player.petitions = { court: { mercy: 0, severity: 7, justice: 0, piety: 6, generosity: -3 } };
        player.throne = { ruling: { kingdomId: 'k1' }, civilWar: null, exile: {} };
        player.house = { name: 'House Aldric', generation: 3, prestige: 50 };
        const ids = groupsFor(world, player, { q: 5, r: 5, occupation: 'guard' });
        for (const id of ['trait_dread_lord', 'trait_dread_lord_guard', 'trait_pious', 'court_severity', 'court_piety',
            'title_our_king', 'title_our_king_guard', 'house_old', 'house_ancient']) expect(ids.has(id), id).toBe(true);
        expect(ids.has('court_mercy')).toBe(false);
        expect(ids.has('house_prestige')).toBe(false);
        // Abroad the player is a foreign king
        const abroad = groupsFor(world, player, { q: 21, r: 10 });
        expect(abroad.has('title_king')).toBe(true);
        expect(abroad.has('title_our_king')).toBe(false);
        // A pretender, an exile
        player.throne = { ruling: null, civilWar: { kingdomId: 'k1' }, exile: {} };
        expect(groupsFor(world, player, { q: 5, r: 5 }).has('title_pretender')).toBe(true);
        player.throne = { ruling: null, civilWar: null, exile: { k2: 400 } };
        expect(groupsFor(world, player, { q: 5, r: 5 }).has('title_exile')).toBe(true);
    });

    it('occupation and personality shape the line', () => {
        const world = makeWorld();
        world.kingdoms[0].wars = ['k2'];
        const npc = { id: 7, type: 'villager', personalityTraits: ['bold'] };
        const ids = groupsFor(world, makePlayer(), { q: 5, r: 5, npc });
        expect(ids.has('war_bold')).toBe(true);
        expect(ids.has('war_cautious')).toBe(false);
    });

    it('selection is deterministic, draws no RNG, and honours exclusions', () => {
        const world = makeWorld();
        world.kingdoms[0].wars = ['k2'];
        const player = makePlayer();
        const ctx = Chatter.context(world, player, { q: 5, r: 5, occupation: 'guard' });
        Utils.setSeed(99);
        const expected = Utils.random();
        Utils.setSeed(99);
        const a = Chatter.select(ctx, { seed: 'npc-1' });
        const b = Chatter.select(Chatter.context(world, player, { q: 5, r: 5, occupation: 'guard' }), { seed: 'npc-1' });
        Chatter.ambient(world, player, 5, 5);
        expect(Utils.random()).toBe(expected);
        expect(a).toEqual(b);
        const all = Chatter.candidates(ctx).map(c => c.id);
        const left = Chatter.select(ctx, { seed: 'npc-1', exclude: all.filter(id => id !== all[3]) });
        expect(left.id).toBe(all[3]);
        expect(Chatter.select(ctx, { exclude: all })).toBe(null);
    });

    it('an ambient remark needs something to talk about', () => {
        const world = makeWorld(40);
        const player = makePlayer();
        expect(Chatter.ambient(world, player, 5, 5)).toBe(null);
        world.kingdoms[0].wars = ['k2'];
        world.kingdoms[1].wars = ['k1'];
        const said = Chatter.ambient(world, player, 5, 5);
        expect(said && said.text.length > 0).toBe(true);
        expect(said.settlementName).toBe('Tallow');
    });

    it('feeds the same facts to the LLM voice prompt', () => {
        const world = makeWorld(110);
        world.kingdoms[0].wars = ['k2'];
        const player = makePlayer();
        player.traits = { earned: { dread_lord: 1 }, progress: {} };
        const facts = Chatter.promptFacts(Chatter.context(world, player, { q: 5, r: 5 }));
        expect(facts).toContain('at war with Belmarch');
        expect(facts).toContain('lean weeks');
        expect(facts).toContain('Dread');
        const prompt = NpcBrain._buildLinePrompt({ name: 'Bob' }, { topic: 'a greeting', worldContext: facts });
        expect(prompt[1].content).toContain('at war with Belmarch');
        expect(NpcBrain._lineKey({ id: 1 }, { worldContext: facts })).not.toBe(NpcBrain._lineKey({ id: 1 }, {}));
    });
});

describe('tavern talk of the region', () => {
    it('tells true news, or a distorted telling when the source is unreliable', () => {
        const world = makeWorld();
        const player = makePlayer();
        const tile = world.getTile(5, 5);
        expect(Chatter.tavernNews(world, player, tile)).toBe(null);
        world.kingdoms[0].wars = ['k2'];
        const t = Chatter.tavernNews(world, player, tile, { accurate: true });
        const f = Chatter.tavernNews(world, player, tile, { accurate: false });
        expect(t.kind).toBe('war');
        expect(Chatter.data().tavern.war.true.map(s => s.replace(/\{\w+\}/g, ''))).toContain(t.text.replace(/Arvenland|Belmarch/g, ''));
        expect(f.text).not.toBe(t.text);
        expect(f.accurate).toBe(false);
    });

    it('a regional_news rumour carries the reliability and accuracy of its source', () => {
        const world = makeWorld();
        world.activeEvents = [{ id: 'plague', name: 'Plague', q: 12, r: 6, kingdomId: 'k1', settlementName: 'Brindle' }];
        const player = makePlayer();
        const tile = world.getTile(5, 5);
        let sawTrue = false;
        let sawFalse = false;
        for (let i = 0; i < 30; i++) {
            const rumor = Tavern._generateRumor('regional_news', tile, world, Tavern.RELIABILITY.TAVERN_GOSSIP, player);
            expect(rumor.reliability).toBe(Tavern.RELIABILITY.TAVERN_GOSSIP);
            expect(rumor.text).toContain('Brindle');
            if (rumor.accurate) sawTrue = true; else sawFalse = true;
        }
        expect(sawTrue && sawFalse).toBe(true);
    });

    it('the notice board carries the heralds\' proclamations', () => {
        const world = makeWorld();
        const player = makePlayer();
        Heralds.processDay(world, player);
        world.day++;
        world.kingdoms[0].ruler = 'King Edric';
        Heralds.processDay(world, player);
        const board = Tavern._checkRumorBoard(player, world.getTile(5, 5), world);
        expect(board.some(r => r.title === 'Proclamation' && r.text.includes('King Edric'))).toBe(true);
    });
});

describe('heralds', () => {
    it('the first tick only takes a snapshot', () => {
        const world = makeWorld();
        world.kingdoms[0].wars = ['k2'];
        world.kingdoms[1].wars = ['k1'];
        const player = makePlayer();
        expect(Heralds.processDay(world, player).notices).toEqual([]);
        expect(player.heralds.list).toEqual([]);
    });

    it('cries a coronation, a peace and a fallen realm, throttled', () => {
        const world = makeWorld();
        world.kingdoms[0].wars = ['k2'];
        world.kingdoms[1].wars = ['k1'];
        world.kingdoms[1].capital = { q: 14, r: 7 };
        const player = makePlayer();
        player.q = 12; player.r = 6;
        Heralds.processDay(world, player);

        world.day++;
        world.kingdoms[0].ruler = 'King Edric';
        world.kingdoms[0].wars = [];
        world.kingdoms[1].wars = [];
        const day1 = Heralds.processDay(world, player);
        const kinds = player.heralds.list.map(p => p.kind).sort();
        expect(kinds).toEqual(['coronation', 'peace']);
        // One notice a day, the gravest first
        expect(day1.notices.length).toBe(1);
        expect(day1.notices[0].kind).toBe('coronation');
        expect(day1.notices[0].text).toContain('King Edric');

        // The next day is inside the gap; a realm falling still gets through
        world.day++;
        world.kingdoms[1].isAlive = false;
        const day2 = Heralds.processDay(world, player);
        expect(day2.notices.map(n => n.kind)).toEqual(['realm_fallen']);
        expect(day2.notices[0].text).toContain('Belmarch');
        // Nothing new, nothing cried
        world.day++;
        expect(Heralds.processDay(world, player).notices).toEqual([]);
    });

    it('news travels: a far town hears it days later, the near one at once', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.q = 5; player.r = 5;
        Heralds.processDay(world, player);
        world.day++;
        world.kingdoms[1].ruler = 'Queen Ysolde'; // crowned at Farfield (50,30), far from the player
        expect(Heralds.processDay(world, player).notices).toEqual([]);
        expect(Heralds.heardAt(player, world, 50, 30).length).toBe(1);
        expect(Heralds.heardAt(player, world, 5, 5).length).toBe(0);
        let cried = [];
        for (let i = 0; i < 8 && !cried.length; i++) {
            world.day++;
            cried = Heralds.processDay(world, player).notices;
        }
        expect(cried.length).toBe(1);
        expect(cried[0].text).toContain('Queen Ysolde');
        // Townsfolk repeat it
        expect(groupsFor(world, player, { q: 5, r: 5 }).has('heard_coronation')).toBe(true);
    });

    it('proclaims a saga\'s end, a named land, and the player\'s siege without crying it at them', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.discovery = { sites: [{ id: 1, name: 'Old Isle', q: 6, r: 6, discovered: { by: 'player' } }] };
        Heralds.processDay(world, player);
        world.day++;
        player.sagas = { active: [], done: [{ uid: 's1', name: 'The Comet', anchor: { settlement: { q: 6, r: 5 } }, ended: { day: world.day, title: 'The Sky Clears' } }] };
        player.discovery.sites.push({ id: 2, name: 'Gull Rock', q: 7, r: 7, discovered: { by: 9, byName: 'Kael' } });
        player.sieges = { history: [{ name: 'Brindle', outcome: 'captured', days: 9, day: world.day }] };
        const out = Heralds.processDay(world, player);
        const kinds = player.heralds.list.map(p => p.kind).sort();
        expect(kinds).toEqual(['discovery', 'saga_end', 'siege_won']);
        expect(player.heralds.list.find(p => p.kind === 'siege_won').own).toBe(true);
        expect(out.notices.length).toBe(1);
        expect(out.notices[0].kind).not.toBe('siege_won');
        // Not proclaimed twice
        world.day++;
        Heralds.processDay(world, player);
        expect(player.heralds.list.length).toBe(3);
    });

    it('draws no RNG, survives a save, and forgets old news', () => {
        const world = makeWorld();
        const player = makePlayer();
        Utils.setSeed(7);
        const expected = [Utils.random(), Utils.random()];
        Utils.setSeed(7);
        Heralds.processDay(world, player);
        world.day++;
        world.kingdoms[0].ruler = 'King Edric';
        Heralds.processDay(world, player);
        expect([Utils.random(), Utils.random()]).toEqual(expected);

        const saved = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        expect(saved.heralds.list.length).toBe(1);
        const back = new Player();
        SaveLoad.restorePlayer(saved, back, world);
        expect(back.heralds.list[0].kind).toBe('coronation');

        world.day += Heralds.config().lifeDays + 1;
        Heralds.processDay(world, back);
        expect(back.heralds.list).toEqual([]);
    });
});

describe('gossip carries the player\'s deeds', () => {
    it('a deed spreads, carries no bounty or reputation loss, and fades', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.reputation = { k1: 10 };
        const rumor = Gossip.spreadDeed(player, world, 'sack', { q: 12, r: 6, location: 'Brindle', kingdom: 'k1' });
        expect(rumor.spreadTo).toEqual(['12,6']);
        expect(Gossip.spreadDeed(player, world, 'sack', { q: 12, r: 6, location: 'Brindle' })).toBe(rumor);
        for (let i = 0; i < 20; i++) { world.day++; Gossip.processDaily(player, world); }
        expect(player.reputation.k1).toBe(10);
        expect(player.gossip.bounties).toEqual([]);
        expect(Gossip.checkGuardHostility(player, 12, 6, world).hostile).toBe(false);
        expect(Gossip.getPlayerNotoriety(player).activeRumors).toBe(0);
        const heard = Gossip.getTavernGossip(player, 12, 6, world);
        expect(heard[0].deed).toBe(true);
        // Townsfolk where it is known talk of it
        const ctx = Chatter.context(world, player, { q: 12, r: 6 });
        expect(ctx.deeds[0].type).toBe('sack');
        const line = Chatter.select(ctx, { filter: g => g.id === 'deed_sack', roll: 0 });
        expect(line.text).toContain('Brindle');
        // ...until it fades
        for (let i = 0; i < 80; i++) { world.day++; Gossip.processDaily(player, world); }
        expect(rumor.expired).toBe(true);
        expect(Chatter.context(world, player, { q: 12, r: 6 }).deeds).toEqual([]);
    });

    it('a duel away from town is talked of in the nearest settlement', () => {
        const world = makeWorld();
        const player = makePlayer();
        const rumor = Gossip.spreadDeed(player, world, 'duel_won', { q: 6, r: 6, victim: 'Kael' });
        expect(rumor.locationName).toBe('Tallow');
        expect(rumor.victim.name).toBe('Kael');
        expect(Gossip.spreadDeed(player, world, 'murder', { q: 6, r: 6 })).toBe(null);
    });

    it('a famine dole ruled at court becomes a rumour', () => {
        const world = makeWorld(100);
        const player = makePlayer();
        const settlement = world.getTile(5, 5).settlement;
        const pet = Petitions.spawn(player, world, 'famine_plea', { kind: 'settlement', q: 5, r: 5, settlement });
        expect(pet).toBeTruthy();
        const res = Petitions.rule(player, world, pet.id, 'open');
        expect(res.success).toBe(true);
        const rumor = player.gossip.rumors.find(r => r.type === 'famine_dole');
        expect(rumor).toBeTruthy();
        expect(rumor.locationName).toBe('Tallow');
    });
});
