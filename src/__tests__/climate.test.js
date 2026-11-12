// Climate over centuries (world/climate.js): a seeded curve of eras that the
// weather, harvests, markets, sickness, migration, sea trade and the crises
// read; told in the Annals. The shared RNG is never drawn.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Afterlife } from '../player/afterlife.js';
import { Climate } from '../world/climate.js';
import { Harvests } from '../world/harvests.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Crises } from '../systems/crises.js';
import { Annals } from '../systems/annals.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Utils } from '../core/utils.js';
import { Ships } from '../systems/ships.js';

const YEAR = 120;

/** A bare world for the pure curve: just a seed, a size and tiles on demand. */
function bare(seed, opts = {}) {
    const H = opts.height || 60;
    const tiles = new Map();
    return {
        day: opts.day || 1, width: 80, height: H, baseYear: opts.baseYear || 900,
        generationParams: { seed },
        getTile(q, r) {
            if (r < 0 || r >= H) return null;
            const k = `${q},${r}`;
            if (!tiles.has(k)) {
                const lat = 1 - Math.abs(r / H - 0.5) * 2;
                tiles.set(k, { q, r, temperature: 0.1 + lat * 0.75, moisture: opts.moisture != null ? opts.moisture : 0.5, terrain: { id: 'plains', passable: true } });
            }
            return tiles.get(k);
        },
    };
}

/** The first day of game year y at which `kind` is at full strength, for a seed's era list. */
function eraOfKind(seed, kind) {
    const w = bare(seed);
    return Climate.eras(w, 2000).find(e => e.kind === kind);
}

describe('Climate', () => {
    beforeAll(async () => { await loadData(); }, 60000);

    it('the curve is a pure function of the seed (no RNG drawn)', () => {
        Utils.setSeed(123);
        const before = Utils.random();
        Utils.setSeed(123);
        const a = Climate.eras(bare(42), 400).map(e => JSON.stringify(e));
        const b = Climate.eras(bare(42), 400).map(e => JSON.stringify(e));
        expect(a).toEqual(b);
        expect(Utils.random()).toBe(before);
        const c = Climate.eras(bare(43), 400).map(e => JSON.stringify(e));
        expect(c).not.toEqual(a);
        // Eras follow one another with quiet years between, and kinds vary
        const list = Climate.eras(bare(42), 400);
        for (let i = 1; i < list.length; i++) {
            expect(list[i].from).toBeGreaterThan(list[i - 1].to);
            expect(list[i].kind).not.toBe(list[i - 1].kind);
        }
        // Nothing in the opening years
        expect(list[0].from).toBeGreaterThanOrEqual(14);
        expect(Climate.eraAt(bare(42), 1)).toBe(null);
    });

    it('a 10,000-day game sees one to three notable eras', () => {
        const counts = [];
        for (let seed = 1; seed <= 200; seed++) {
            const w = bare(seed);
            const n = Climate.eras(w, 10000 / YEAR).filter(e => e.from < 10000 / YEAR - 2).length;
            counts.push(n);
        }
        const avg = counts.reduce((s, n) => s + n, 0) / counts.length;
        expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...counts)).toBeLessThanOrEqual(3);
        expect(avg).toBeGreaterThan(1.2);
        expect(avg).toBeLessThan(2.6);
    });

    it('a little ice age is colder and hardest at the poles; harvests and fuel follow', () => {
        let seed = 1, e = null;
        for (; seed < 200 && !e; seed++) e = eraOfKind(seed, 'cold');
        expect(e).toBeTruthy();
        const w = bare(seed - 1);
        const mid = Math.round(((e.from + e.to) / 2) * YEAR) + 1;
        const pole = w.getTile(10, 2), temperate = w.getTile(10, 20);
        expect(Climate.tempAt(w, pole, mid)).toBeLessThan(Climate.tempAt(w, temperate, mid));
        expect(Climate.tempAt(w, temperate, mid)).toBeLessThan(0);
        expect(Climate.yieldFactor(w, 10, 20, mid)).toBeLessThan(0.95);
        expect(Climate.yieldFactor(w, 10, 2, mid)).toBeLessThan(Climate.yieldFactor(w, 10, 30, mid));
        // Before it began: a settled age
        expect(Climate.yieldFactor(w, 10, 20, Math.round((e.from - 1) * YEAR))).toBe(1);
        // Harbours freeze further south in it than in an ordinary winter
        const winter = (d) => Math.floor((d - 1) / YEAR) * YEAR + 105;
        let iceNow = 0, iceBefore = 0;
        for (let r = 0; r < 60; r++) {
            if (Climate.icebound(w, 5, r, winter(mid))) iceNow++;
            if (Climate.icebound(w, 5, r, winter(Math.round((e.from - 2) * YEAR)))) iceBefore++;
        }
        expect(iceNow).toBeGreaterThan(iceBefore);
        // Sickness in winter rises
        expect(Climate.diseaseMult(w, 10, 20, winter(mid))).toBeGreaterThan(1);
        // The counsel line reads it
        const d = Climate.describe(w, 10, 20, mid);
        expect(d.text).toMatch(/harvests −\d+%/);
    });

    it('a drought strikes its band, dry margins worst; wet decades rot moist land', () => {
        let seed = 1, e = null;
        for (; seed < 300 && !e; seed++) e = eraOfKind(seed, 'drought');
        expect(e).toBeTruthy();
        const mid = Math.round(((e.from + e.to) / 2) * YEAR) + 1;
        const dry = bare(seed - 1, { moisture: 0.2 }), moist = bare(seed - 1, { moisture: 0.6 });
        const row = Math.round(e.band.c * 59);
        expect(Climate.wetAt(dry, 3, row, mid)).toBeLessThan(-0.05);
        expect(Climate.yieldFactor(dry, 3, row, mid)).toBeLessThan(Climate.yieldFactor(moist, 3, row, mid));
        expect(Climate.yieldFactor(moist, 3, row, mid)).toBeLessThan(0.95);
        // Outside its band the rains are as ever
        const far = e.band.c > 0.5 ? 0 : 59;
        expect(Climate.wetAt(dry, 3, far, mid)).toBe(0);
        // The crises tilt toward famine
        const bias = Climate.crisisWeights(dry, mid);
        expect(bias.famine).toBeGreaterThan(2);
        // People drift away from it (hardship), toward the spared
        expect(Climate.hardship(dry, 3, row, mid)).toBeGreaterThan(Climate.hardship(dry, 3, far, mid));
    });

    it('drives the real weather, harvests, cold prices, crises and the Annals in a world', () => {
        const { world, player } = newGame(7);
        for (let i = 0; i < 3; i++) Afterlife.passDay(world, null);
        // Find this world's first cold era (or any), and jump to its height
        const eras = Climate.eras(world, 400);
        const e = eras.find(x => x.kind === 'cold') || eras[0];
        const mid = Math.round(((e.from + e.to) / 2) * YEAR) + 1;
        const views = world.getSettlementViews();
        const s = views[0];
        const tile = world.getTile(s.q, s.r);
        // The weather's temperature carries the era
        expect(world.weather._seasonalTemp(tile, mid)).toBeCloseTo(Math.max(0, Math.min(1, tile.temperature + ({ Spring: 0.05, Summer: 0.15, Autumn: -0.05, Winter: -0.15 })[world.weather._seasonOf(mid)] + Climate.tempAt(world, tile, mid))), 5);
        if (e.kind === 'cold') {
            // Cold demand: more cold days over the year at its height than in a settled year
            const coldDays = (y0) => {
                let n = 0;
                for (let d = y0; d < y0 + YEAR; d += 3) {
                    world.day = d;
                    if (SettlementMarket.isCold(world, tile)) n++;
                }
                return n;
            };
            const keep = world.day;
            const yMid = Math.floor((mid - 1) / YEAR) * YEAR + 1;
            const before = coldDays(Math.round(Math.max(1, e.from - 3) * YEAR) + 1);
            const during = coldDays(yMid);
            world.day = keep;
            expect(during).toBeGreaterThanOrEqual(before);
        }
        // Harvests: a region's reckoning takes the climate factor
        const rec = { ws: 0, wn: 10, norm: 0, war: 0, battles: 0, raid: 0, blights: [], clim: 0.8 };
        const r1 = Harvests._reckon(rec, true);
        const r0 = Harvests._reckon({ ...rec, clim: undefined }, true);
        expect(r1.yields.grain).toBeCloseTo(r0.yields.grain * 0.8, 3);
        expect(r1.climate).toBe(0.8);
        expect(r0.climate).toBeUndefined();
        // The crises' weights tilt at its height
        const bias = Climate.crisisWeights(world, mid);
        expect(Object.keys(bias).length).toBeGreaterThan(0);
        // The world lives to the era: it is recorded, told and in the Annals
        world.day = Math.round(e.from * YEAR) + 3;
        let notices = [];
        for (let i = 0; i < 8; i++) { world.day++; notices = notices.concat(Climate.processDay(world, player).notices); }
        expect(notices.length).toBe(1);
        expect(Climate.history(world).map(x => x.id)).toContain(e.id);
        world.day = Math.round(e.to * YEAR) + 3;
        for (let i = 0; i < 8; i++) { world.day++; notices = notices.concat(Climate.processDay(world, player).notices); }
        const ch = Climate.annalChapters(world, 0).find(c => c.id === `age_${e.id}`);
        expect(ch).toBeTruthy();
        expect(ch.live).toBe(false);
        expect(ch.title).toMatch(new RegExp(`years ${Climate.calendarYear(world, e.from)}–${Climate.calendarYear(world, e.to)}`));
        expect(ch.paragraphs.length).toBeGreaterThanOrEqual(1);
        const book = Annals.compose(player, world);
        expect(book.ages.some(a => a.id === `age_${e.id}`)).toBe(true);
    }, 120000);

    it('a famine starts where the era bites hardest', () => {
        // Seed 7's first era is a little ice age (years 28–53): at its height the famine
        // centres on one of the five towns it hits hardest
        const { world } = newGame(7);
        for (let i = 0; i < 3; i++) Afterlife.passDay(world, null);
        const e = Climate.eras(world, 400)[0];
        expect(e.kind).toBe('cold');
        world.day = Math.round(((e.from + e.to) / 2) * YEAR) + 1;
        expect(Climate.eraAt(world, world.day).env).toBe(1);
        const harsh = Climate.harshest(world, world.getSettlementViews(), world.day, 5);
        expect(harsh.length).toBe(5);
        expect(world.harvests && world.harvests.cur && Object.keys(world.harvests.cur.regions).length).toBeGreaterThanOrEqual(2);
        const c = Crises.start(world, 'famine', { force: true });
        expect(c).toBeTruthy();
        expect(harsh.map(s => s.name)).toContain(c.data.center);
        // ...where, with no era, it could be anywhere (the harshest list is empty)
        expect(Climate.harshest(world, world.getSettlementViews(), 1, 5)).toEqual([]);
    }, 120000);

    it('a docked ship cannot put out of a frozen harbour; she sails at the thaw', () => {
        const tiles = new Map();
        const w = {
            width: 40, height: 30, day: 105, generationParams: { seed: 5 },
            getTile(q, r) {
                if (r < 0 || r >= 30) return null;
                q = ((q % 40) + 40) % 40;
                const k = `${q},${r}`;
                if (!tiles.has(k)) {
                    const town = k === '5,1' ? { q, r, name: 'Frostholm', type: 'town' } : k === '25,1' ? { q, r, name: 'Gullhaven', type: 'town' } : null;
                    tiles.set(k, { q, r, temperature: 0.05, terrain: town ? { id: 'plains', passable: true } : { id: 'ocean', passable: false }, settlement: town });
                }
                return tiles.get(k);
            },
        };
        const mk = () => ({ id: 'ship_1', typeId: 'cog', name: 'Gull', q: 5, r: 1, status: 'docked', condition: 100, customizations: [], cargo: {}, crew: Ships.getShipEffectiveStats({ typeId: 'cog' }).crewRequired, morale: 70 });
        const captain = (s) => ({ gold: 5000, renown: 0, karma: 0, health: 100, reputation: {}, inventory: {}, skills: {}, ships: [s], army: [], q: s.q, r: s.r, boardedShip: null });
        expect(Climate.icebound(w, 5, 1, 105)).toBe(true);
        // Midwinter: every way out is shut, and says why
        let s = mk(), p = captain(s);
        for (const res of [Ships.startVoyage(p, w, s.id, 25, 1, 'Gullhaven'), Ships.moveShip(p, s.id, 25, 1, 'Gullhaven', w), Ships.boardShip(p, s.id, w)]) {
            expect(res.success).toBe(false);
            expect(res.message).toMatch(/frozen in at Frostholm/);
        }
        expect(s.status).toBe('docked');
        expect(p.boardedShip).toBe(null);
        // Summer: she sails
        w.day = 45;
        s = mk(); p = captain(s);
        expect(Ships.startVoyage(p, w, s.id, 25, 1, 'Gullhaven').success).toBe(true);
        expect(s.status).toBe('at_sea');
    });

    it('a frozen port cuts its sea trade', () => {
        const w = bare(5);
        w.getTile(1, 0).temperature = 0.05; // the far north: frozen every winter
        const winterDay = 105;
        expect(Climate.icebound(w, 1, 0, winterDay)).toBe(true);
        expect(Climate.icebound(w, 1, 0, 45)).toBe(false); // summer
        const a = { q: 1, r: 0 }, b = { q: 1, r: 30 };
        const links = [{ a, b, sea: true, factor: 1, embody: true }, { a, b, sea: false, factor: 1, embody: true }];
        const n = MarketDynamics._ice(w, links, winterDay);
        expect(n).toBe(1);
        expect(links[0].factor).toBeCloseTo(Climate.config().ice.seaTrade, 5);
        expect(links[0].embody).toBe(false);
        expect(links[1].factor).toBe(1);
    });

    it('save and load keep the record and the curve', () => {
        const w = bare(9);
        const e = Climate.eras(w, 400)[0];
        w.day = Math.round(e.from * YEAR) + 10;
        for (let i = 0; i < 7; i++) { w.day++; Climate.processDay(w, null); }
        expect(Climate.history(w).length).toBe(1);
        const saved = JSON.parse(JSON.stringify(Climate.serialize(w)));
        const w2 = bare(9, { day: w.day });
        Climate.restore(saved, w2);
        expect(Climate.history(w2)).toEqual(Climate.history(w));
        expect(Climate.eras(w2, 400).map(x => x.id + x.from + x.kind)).toEqual(Climate.eras(w, 400).map(x => x.id + x.from + x.kind));
        expect(Climate.eraAt(w2, w2.day).era.id).toBe(e.id);
        // An older save (no record) past an era: recorded quietly, with its chapter
        const w3 = bare(9, { day: Math.round((e.to + 1) * YEAR) });
        Climate.restore(null, w3);
        let notices = [];
        for (let i = 0; i < 7; i++) { w3.day++; notices = notices.concat(Climate.processDay(w3, {}).notices); }
        expect(notices.length).toBe(0);
        expect(Climate.annalChapters(w3, 0).find(c => c.id === `age_${e.id}`)).toBeTruthy();
    });
});
