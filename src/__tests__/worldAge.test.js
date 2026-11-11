// The world's age (world/worldAge.js): a start year between the dawn year and
// the mature year begins in a younger world — fewer and smaller places,
// smaller realms, fewer roads and ruins, a shorter history, nothing founded in
// the future — while the default year is the full-grown world byte for byte.

import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { WorldAge } from '../world/worldAge.js';
import { Hinterland } from '../world/hinterland.js';
import { Scenarios } from '../player/scenarios.js';
import { loadData, newGame, endDay, roundTrip, WORLD_W, WORLD_H } from './playtest/harness.js';

const SEED = 9137;
const GEN = { kingdomCount: 8, terrainGen: 6 };
const HUMAN_MADE = new Set(['ruins', 'shrine', 'monument']);

function make(gen) {
    Utils.setSeed(1);
    const w = new World(WORLD_W, WORLD_H);
    w.generate({ seed: SEED, ...GEN, ...gen });
    return w;
}

function summary(w) {
    const out = { settlements: 0, pop: 0, roads: 0, ruins: 0, natural: 0, claimed: 0, capitals: 0, towns: 0 };
    for (const row of w.tiles) {
        for (const t of row) {
            if (t.settlement) {
                out.settlements++;
                out.pop += t.settlement.population;
                if (t.settlement.type === 'capital') out.capitals++;
                if (t.settlement.type === 'town') out.towns++;
            }
            if (t.hasRoad) out.roads++;
            if (t.improvement && HUMAN_MADE.has(t.improvement.type)) out.ruins++;
            else if (t.improvement) out.natural++;
            if (t.kingdom) out.claimed++;
        }
    }
    out.history = w.history.length;
    out.holySites = w.tiles.flat().filter(t => t.holySite).length;
    return out;
}

/** The world's tiles, settlements, realms and history as one string. */
function fingerprint(w) {
    const tiles = w.tiles.flat().map(t => [t.terrain.id, t.kingdom, t.hasRoad ? t.roadLinks : 0, t.settlement ? JSON.stringify(t.settlement) : '', t.improvement ? JSON.stringify(t.improvement) : '', t.holySite ? t.holySite.name : ''].join('|'));
    const realms = w.kingdoms.map(k => [k.id, k.population, k.military, k.territory.length, k.treasury].join('|'));
    return Utils.hashStr(tiles.join(';')) + ':' + Utils.hashStr(realms.join(';')) + ':' + Utils.hashStr(JSON.stringify(w.history)) + ':' + w.units.length;
}

let worlds;
beforeAll(async () => {
    await loadData();
    worlds = {};
    for (const y of [250, 500, 700, 853]) worlds[y] = make({ startYear: y });
}, 120000);

describe('the world\'s age', () => {
    it('grows with the start year: places, people, roads, ruins, claimed land, history', () => {
        const s = Object.fromEntries(Object.entries(worlds).map(([y, w]) => [y, summary(w)]));
        if (process.env.AGE_VERBOSE) console.log(JSON.stringify(s, null, 1));
        const years = [250, 500, 700, 853];
        for (let i = 1; i < years.length; i++) {
            const a = s[years[i - 1]], b = s[years[i]];
            for (const k of ['settlements', 'pop', 'roads', 'ruins', 'claimed', 'history']) expect(b[k], `${k} ${years[i - 1]}→${years[i]}`).toBeGreaterThanOrEqual(a[k]);
        }
        // ...and a young world is markedly younger
        expect(s[250].settlements).toBeLessThan(s[853].settlements * 0.6);
        expect(s[250].pop).toBeLessThan(s[853].pop * 0.5);
        expect(s[250].roads).toBeLessThan(s[853].roads);
        expect(s[250].ruins).toBeLessThan(s[853].ruins);
        expect(s[250].claimed).toBeLessThan(s[853].claimed);
        expect(s[250].history).toBeLessThan(s[853].history);
        // Nature's wonders stand however young the world
        expect(s[250].natural).toBe(s[853].natural);
    });

    it('keeps every capital, and founds nothing at or after the start year', () => {
        for (const [y, w] of Object.entries(worlds)) {
            const year = Number(y);
            expect(summary(w).capitals).toBe(w.kingdoms.length);
            for (const k of w.kingdoms) {
                const cap = w.getTile(k.capital.q, k.capital.r);
                expect(cap.settlement && cap.settlement.type).toBe('capital');
                expect(cap.kingdom).toBe(k.id);
                // A realm's population is its settlements'
                const pop = w.getSettlementsOf(k.id).filter(s => w.getTile(s.q, s.r).kingdom === k.id).reduce((n, s) => n + s.population, 0);
                expect(k.population).toBe(pop);
            }
            for (const s of w.getSettlementViews()) {
                expect(s.founded, `${s.name} in year ${year}`).toBeLessThan(year);
                expect(s.founded).toBeGreaterThan(0);
            }
            for (const t of w.tiles.flat()) if (t.improvement && t.improvement.founded != null) expect(t.improvement.founded).toBeLessThan(year);
            for (const h of w.history) expect(h.year).toBeLessThan(year);
            // A realm's towns stand on its land
            for (const s of w.getSettlementViews()) if (s.kingdom) expect(w.getTile(s.q, s.r).kingdom).toBe(s.kingdom);
        }
        // The oldest place still standing is older than any of a young world's history
        const young = worlds[250];
        const oldest = Math.min(...young.getSettlementViews().map(s => s.founded));
        expect(oldest).toBeGreaterThanOrEqual(200);
    });

    it('the default year is the full-grown world exactly, and keeps no age snapshot', () => {
        const plain = make({});
        expect(fingerprint(worlds[853])).toBe(fingerprint(plain));
        expect(plain.generationParams.worldAge).toBeUndefined();
        // A world made before terrainGen 6 (an older save) is never aged back
        const old = make({ startYear: 400, terrainGen: 5 });
        expect(old.generationParams.worldAge).toBeUndefined();
        expect(summary(old).settlements).toBe(summary(plain).settlements);
    });

    it('a young world regenerates the same from its saved params, even if the data is retuned', () => {
        const w = worlds[500];
        expect(w.generationParams.worldAge).toBeTruthy();
        const params = JSON.parse(JSON.stringify(w.generationParams));
        const age = WorldAge.forParams(params);
        expect(age.t).toBeGreaterThan(0.4);
        expect(age.t).toBeLessThan(0.5);
        // (seeded outside too: the first units' moves read the caller's RNG — not the age's doing)
        Utils.setSeed(1);
        const again = new World(WORLD_W, WORLD_H);
        again.generate(params);
        expect(fingerprint(again)).toBe(fingerprint(w));
        // Retuning data/dawn.json doesn't change a saved world: the snapshot rules
        const snap = { ...params.worldAge, population: { at0: 0.9, pow: 1 } };
        expect(WorldAge.forParams({ ...params, worldAge: snap }).cfg.population.at0).toBe(0.9);
        expect(WorldAge.forParams(params).cfg.population.at0).toBe(params.worldAge.population.at0);
    });

    it('a young world\'s towns work fewer rural sites', () => {
        const young = worlds[250];
        const full = worlds[853];
        Hinterland.derive(young);
        Hinterland.derive(full);
        const per = w => Hinterland.sites(w).length / Math.max(1, w.getSettlementViews().length);
        expect(per(young)).toBeLessThan(per(full));
        expect(WorldAge.scaleNow(full, 'hinterland')).toBe(1);
        expect(WorldAge.scaleNow(young, 'hinterland')).toBeLessThan(1);
    });

    it('tells the New Game screen what a year means', () => {
        expect(WorldAge.band(100).dawn).toBe(true);
        expect(WorldAge.band(250).label).toBe('a young world');
        expect(WorldAge.band(250).hint).toMatch(/few towns/);
        expect(WorldAge.band(853).label).toBe('a mature world');
        expect(WorldAge.band(1500).label).toBe('a mature world');
    });
});

describe('origins in a young world', () => {
    it('every origin still finds its realm, its town and its people', () => {
        for (const id of Object.keys(Scenarios.origins())) {
            const g = newGame(77, { startYear: 220, terrainGen: 6 });
            const report = Scenarios.apply(g.player, g.world, { origin: id });
            expect(report.origin, id).toBe(id);
            // Every {town}, {kingdom}, ... of its welcome was filled in
            expect(report.welcome, id).not.toMatch(/\{\w+\}/);
            expect(g.world.getTile(g.player.q, g.player.r), id).toBeTruthy();
        }
    }, 240000);
});

describe('playing a young world', () => {
    it('runs a season and survives a save and reload', () => {
        const g = newGame(78, { startYear: 260, terrainGen: 6 });
        const before = g.world.getSettlementViews().length;
        for (let i = 0; i < 40; i++) endDay(g);
        expect(g.world.getSettlementViews().length).toBeGreaterThanOrEqual(before - 1);
        const back = roundTrip(g);
        expect(back.world.generationParams.worldAge).toBeTruthy();
        expect(back.world.getSettlementViews().length).toBe(g.world.getSettlementViews().length);
    }, 240000);
});
