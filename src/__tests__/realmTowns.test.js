// Generated worlds keep towns on their map tiles and leave kingdom.settlements
// empty. These checks run on a real generated world, where hand-made mock
// worlds (which do fill the list) would hide the bug.
import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Heralds } from '../systems/heralds.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { loadData, newGame } from './playtest/harness.js';

let game;
beforeAll(async () => {
    await loadData();
    game = newGame(4242);
}, 60000);

describe('realm towns in a generated world', () => {
    it('really does leave kingdom.settlements empty', () => {
        const k = game.world.kingdoms.find(k => k.isAlive);
        expect((k.settlements || []).length).toBe(0);
        expect(WorldEvents._townsOf(game.world, k).length).toBeGreaterThan(0);
    });

    it('plague, flood, rebellion and discovery strike named towns', () => {
        Utils.setSeed(7);
        const seen = new Set();
        const marks = { plague: /Plague strikes/, flood: /floods near/, rebellion: /Rebellion in/, discovery: /deposit discovered near/ };
        for (let i = 0; i < 300; i++) {
            for (const gen of ['generateNaturalEvent', 'generatePoliticalEvent', 'generateEconomicEvent']) {
                const ev = WorldEvents[gen](game.world);
                for (const [id, re] of Object.entries(marks)) if (ev && re.test(ev.text)) seen.add(id);
            }
        }
        expect([...seen].sort()).toEqual(['discovery', 'flood', 'plague', 'rebellion']);
    });

    it('heralds find a town by name and a capital-less realm by its towns', () => {
        const w = game.world;
        const k = w.kingdoms.find(k => k.isAlive);
        const town = WorldEvents._townsOf(w, k)[0];
        expect(Heralds._placeByName(w, town.name)).toEqual({ q: town.q, r: town.r });
        expect(Heralds._capital(w, { id: k.id })).toEqual({ q: town.q, r: town.r });
    });

    it('a trading licence costs more in a realm with more towns', () => {
        const w = game.world;
        const p = game.player;
        const [a, b] = w.kingdoms.filter(k => k.isAlive)
            .map(k => ({ k, n: WorldEvents._townsOf(w, k).length }))
            .sort((x, y) => x.n - y.n).filter((x, i, arr) => i === 0 || i === arr.length - 1);
        expect(b.n).toBeGreaterThan(a.n);
        p.reputation = { ...p.reputation, [a.k.id]: 100, [b.k.id]: 100 };
        const qa = TradePolicy.licenceQuote(p, w, a.k.id);
        const qb = TradePolicy.licenceQuote(p, w, b.k.id);
        expect(qa.ok && qb.ok).toBe(true);
        expect(qb.cost).toBeGreaterThan(qa.cost);
    });
});
