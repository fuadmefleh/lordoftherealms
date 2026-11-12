// Health check 2026-11 (docs/health-check-2026-11.md), the "Left open" table:
//   - a booked room, the night's rest type and the last one survive save/load
//   - pirate hunts, caravans and trade routes feel the difficulty
//   - the court scribe's retellings follow the chapter's text and the world
//   - a new life ends the old House's league at once
//   - rival agents' deeds and the trail a leak leaves are read
//   - the illness knob scales catching a sickness; the crown goal reads the origin's realm
//   - devotions carry the 'piety' tag; a pious name is told in the faith summary

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Difficulty } from '../core/difficulty.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Ships } from '../systems/ships.js';
import { Technology } from '../systems/technology.js';
import { Coalitions } from '../systems/coalitions.js';
import { RivalAgents } from '../systems/rivalAgents.js';
import { Ailments } from '../systems/ailments.js';
import { Victory } from '../systems/victory.js';
import { Annals } from '../systems/annals.js';
import { Traits } from '../systems/traits.js';
import { Scenarios } from '../player/scenarios.js';
import { Afterlife } from '../player/afterlife.js';
import { Player } from '../player/player.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { ActionMenu } from '../ui/actionMenu/index.js';
import { Hex } from '../core/hex.js';
import { loadData, newGame } from './playtest/harness.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

const SEED = 4242;

describe('health check left open — save/load', () => {
    it('keeps a booked room, the night\'s rest type and the last one slept', () => {
        const p = new Player();
        p.lodging = { id: 'inn1', name: 'The Gull', kind: 'inn', tier: 'room', stars: 2, night: 40, services: ['bath'], own: false };
        p._restTypeOverride = 'inn';
        p._lastRestType = 'inn';
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.lodging).toEqual(p.lodging);
        expect(back._restTypeOverride).toBe('inn');
        expect(back._lastRestType).toBe('inn');
    });
});

describe('health check left open — difficulty', () => {
    it('pirate hunts are won less often against tougher foes', () => {
        const wins = (difficulty) => {
            let n = 0;
            for (let seed = 1; seed <= 200; seed++) {
                Utils.setSeed(seed);
                const ship = { id: 'ship_1', typeId: 'sloop', name: 'Gull', q: 5, r: 5, status: 'at_sea', condition: 100, customizations: [], cargo: {}, crew: 4, morale: 70 };
                const p = { name: 'Hero', gold: 0, health: 100, maxHealth: 100, q: 5, r: 5, army: [], properties: [], ships: [ship], karma: 0, renown: 0, reputation: {}, skills: { combat: 0, leadership: 1, commerce: 0 }, scenario: { ...Difficulty.blank(), difficulty } };
                Technology.initPlayer(p);
                if (Ships.huntPirates(p, ship.id, null).type === 'success') n++;
            }
            return n;
        };
        const normal = wins('normal');
        expect(wins('brutal')).toBeLessThan(normal);
        expect(wins('easy')).toBeGreaterThan(normal);
    });

    it('a caravan\'s expected and paid takings carry the difficulty\'s sell price', () => {
        const run = (difficulty) => {
            const game = newGame(SEED);
            const { world, player } = game;
            player.scenario = { ...Difficulty.blank(), difficulty };
            const towns = world.getAllSettlements().filter(s => s.type !== 'village');
            let a = null;
            let b = null;
            for (const x of towns) {
                b = towns.find(y => y !== x && Hex.wrappingDistance(x.q, x.r, y.q, y.r, world.width) >= 4 && Hex.wrappingDistance(x.q, x.r, y.q, y.r, world.width) <= 14 && y.kingdom === x.kingdom);
                if (b) { a = x; break; }
            }
            expect(a && b).toBeTruthy();
            player.q = a.q; player.r = a.r;
            player.gold = 50000;
            player.inventory.grain = 40;
            Utils.setSeed(7);
            const res = PlayerEconomy.startCaravan(player, { q: a.q, r: a.r, name: a.name }, b, { grain: 40 }, world);
            expect(res.success, res.reason).toBe(true);
            res.caravan.daysRemaining = 1;
            Utils.setSeed(8);
            const done = PlayerEconomy.updateCaravans(player, world).find(c => c.to === b.name && c.finalProfit !== undefined);
            return { expected: res.caravan.expectedProfit, paid: done ? done.finalProfit : null };
        };
        const normal = run('normal');
        const brutal = run('brutal');
        expect(normal.expected).toBeGreaterThan(0);
        expect(brutal.expected).toBeLessThan(normal.expected);
        if (normal.paid > 0 && brutal.paid != null) expect(brutal.paid).toBeLessThan(normal.paid);
    });

    it('the illness knob scales how often a sickness is caught', () => {
        const caught = (difficulty) => {
            const game = newGame(SEED);
            const p = game.player;
            p.scenario = { ...Difficulty.blank(), difficulty };
            let n = 0;
            for (let seed = 1; seed <= 300; seed++) {
                Utils.setSeed(seed);
                if (p.ailments && Array.isArray(p.ailments.active)) p.ailments.active = [];
                if (p.ailments && p.ailments.list) p.ailments.list = [];
                const was = Ailments.has(p, 'flux');
                if (was) continue;
                if (Ailments._tryCatch(p, game.world, 'flux', 0.3, 'food', null)) n++;
                // forget it again for the next draw
                for (const k of Object.keys(p.ailments || {})) if (Array.isArray(p.ailments[k])) p.ailments[k] = p.ailments[k].filter(a => !a || a.id !== 'flux');
            }
            return n;
        };
        const normal = caught('normal');
        expect(normal).toBeGreaterThan(0);
        expect(caught('easy')).toBeLessThan(normal);
        expect(caught('brutal')).toBeGreaterThan(normal);
    });

    it('the crown goal names the realm an origin tied the life to', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const k = world.kingdoms.find(x => x.isAlive);
        player.scenario = { ...Difficulty.blank(), victory: 'crown', realm: k.id };
        const pr = Victory.progress(player, world, 'crown');
        expect(pr.done).toBe(false);
        expect(pr.lines[0]).toContain(k.name);
    });

    it('the New Game choices come from the data, with every difficulty and origin', () => {
        const c = Scenarios.choices();
        expect(c.origins[0].id).toBe('wanderer');
        expect(c.difficulties.map(d => d.id)).toEqual(expect.arrayContaining(['easy', 'normal', 'hard', 'brutal']));
        expect(c.victories.some(v => v.id === 'crown')).toBe(true);
    });
});

describe('health check left open — the court scribe\'s cache', () => {
    // The scribe's retellings now live on the world (world.prose, systems/llmProse.js):
    // they follow the chapter's text, and a load or new game (another world) carries none over.
    it('follows the chapter\'s text and is forgotten with the world', async () => {
        const { LlmProse } = await import('../systems/llmProse.js');
        const chapter = { id: 'g1_0', text: 'In the year 1, Ada founded House Gull.', paragraphs: [] };
        const game = { world: { day: 1 }, player: { house: { id: 'h1', name: 'Gull' } } };
        LlmProse._setClient({ isAvailable: async () => true, chat: async () => ({ ok: true, text: 'so it was written of those days.' }) });
        LlmProse._setEnabled(true);
        try {
            const key = Annals.chapterKey(game.player, chapter);
            LlmProse.write(game.world, { kind: 'annals', key, facts: Annals.chapterFacts(chapter), fallback: chapter.text });
            await LlmProse._flush();
            const s = ActionMenu.annalsScribeFor(game, chapter);
            expect(s && s.status, JSON.stringify(game.world.prose)).toBe('done');
            expect(s.stale).toBe(false);
            // The live chapter moves on: the old telling is marked out of date
            expect(ActionMenu.annalsScribeFor(game, { ...chapter, text: `${chapter.text} Later, more.` }).stale).toBe(true);
            // A load or new game (another world): nothing carries over
            game.world = { day: 1 };
            expect(ActionMenu.annalsScribeFor(game, chapter)).toBeNull();
            ActionMenu.clearAnnalsScribe(game);
            expect(game._annalsScribe).toBeNull();
        } finally {
            LlmProse._reset();
        }
    });
});

describe('health check left open — a new life ends the old league', () => {
    it('becomeStranger disbands the league against the old House', () => {
        const game = newGame(SEED);
        const { world } = game;
        const old = game.player;
        const st = Coalitions.state(old);
        const k = world.kingdoms.find(x => x.isAlive);
        st.active = {
            id: 1, name: 'The League of Test', leaderName: k.name, casusBelli: 'test', stage: 'active', formed: world.day, resolve: 40,
            members: { [k.id]: { kingdomId: k.id, name: k.name, leader: true } }, generation: 1, log: [],
        };
        expect(Coalitions.active(old)).toBeTruthy();
        Afterlife.begin(old, world, 'old age');
        const cand = Afterlife.candidates(world)[0];
        const res = Afterlife.becomeStranger(old, world, cand);
        expect(res.success).toBe(true);
        expect(Coalitions.active(old)).toBeNull();
        expect(old.coalitions.history[0].name).toBe('The League of Test');
        expect(old.coalitions.active).toBeNull();
    });
});

describe('health check left open — rival agents', () => {
    it('an informant\'s leak leaves a trail; the deed is told', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const st = RivalAgents.state(player);
        const a = { id: 99, rivalId: 'nobody', rivalName: 'House Nobody', kind: 'informant', q: 0, r: 0, pid: -1, name: 'Wat', role: 'merchant', town: 'Testby', day: 0, suspicion: 0, known: false, turned: false, lastAct: -1000, acts: 0 };
        st.agents.push(a);
        world.day = 100;
        RivalAgents._act(player, world, a, { notices: [] });
        expect(a.acts).toBe(1);
        expect(a.suspicion).toBe(RivalAgents.config().suspicion.afterAct);
        expect(RivalAgents.deed(player, a)).toContain(player.house.name);
        const out = { notices: [] };
        RivalAgents._reveal(player, world, a, out);
        expect(out.notices[0].text).toContain(RivalAgents.deed(player, a));
        const t = RivalAgents.tally(player, world);
        expect(t.leaks).toBeGreaterThanOrEqual(1);
        expect(t.text).toContain('leak');
    });
});

describe('health check left open — faith in the Annals', () => {
    it('a pilgrimage carries the piety tag; a pious name is told under faith', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        world.day = 50;
        player.devotion = { ...(player.devotion || {}), pilgrimages: { '3,4': { n: 1, day: 20, name: 'the Shrine of Testing' } } };
        const reign = { name: player.name, generation: 1, startDay: 0, live: true, traits: ['pious'], gender: player.gender };
        const events = Annals._events(player, world, reign, { index: 0, prevReign: null });
        const pil = events.find(e => /Shrine of Testing/.test(e.text));
        expect(pil && pil.tags).toContain('piety');
        expect(pil.theme).toBe('faith');
        const ch = Annals._chapter(player, world, reign, { index: 0, prevReign: null });
        const faith = ch.paragraphs.filter(p => p.theme === 'faith').map(p => p.text).join(' ');
        expect(faith).toContain(Traits.TRAITS.pious.name);
    });
});
