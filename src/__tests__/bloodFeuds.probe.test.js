// A probe, not a spec: BF_PROBE=1 runs the playtest bot for a few years on a
// seed (deaths carried on to heirs) and reports the blood feuds of the world
// (systems/bloodFeuds.js): how many are open each year, the killings they
// cause among the townsfolk and Houses, the blows against the House and the
// blood prices paid — the check that feuds never become a bloodbath.
// BF_YEARS (default 4) and BF_SEEDS (default 101) tune it. Skipped otherwise.

import { describe, it, expect, beforeAll } from 'vitest';
import { BloodFeuds } from '../systems/bloodFeuds.js';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.BF_PROBE;
const YEARS = Number(ENV.BF_YEARS) || 4;
const SEEDS = ENV.BF_SEEDS ? ENV.BF_SEEDS.split(',').map(Number) : [101];

beforeAll(async () => {
    if (ON) await loadData();
});

function feudDeaths(world) {
    let n = 0;
    for (const s of world.getSettlementViews()) {
        for (const p of (s.folk && s.folk.people) || []) if (p.died != null && /blood feud|old grudge/.test(String(p.cause))) n++;
    }
    return n;
}

function run(seed) {
    const game = newGame(seed);
    const stats = {};
    const years = [];
    let blows = 0;
    for (let i = 0; i < YEARS * 120; i++) {
        // BF_SEED_FEUD: on day 200, a townsperson's family is given blood against the House (to watch the bot meet it)
        if (ENV.BF_SEED_FEUD && game.world.day === 200) {
            for (const s of game.world.getSettlementViews()) {
                const folk = s.folk;
                const p = folk && (folk.people || []).find(x => x.died == null && !x.away && x.last && folk.people.filter(y => y !== x && y.died == null && !y.away && y.last === x.last).length >= 2);
                if (p && BloodFeuds.onKinMemory(game.world, game.player, folk, p, 'murdered')) { console.warn(`seeded a feud with the ${p.last} family of ${s.name}`); break; }
            }
        }
        botDay(game, stats);
        const res = endDay(game);
        for (const n of (game.bloodFeudsDay && game.bloodFeudsDay.notices) || []) if (/Vengeance|Driven Off|Avenger Slain/.test(n.title)) blows++;
        if (res.died) {
            const next = carryOn(game, res.died);
            if (!next.how) break;
        }
        if (game.world.day % 120 === 0) {
            const st = BloodFeuds.state(game.world);
            const views = game.world.getSettlementViews();
            const rosters = views.filter(s => s.folk && Array.isArray(s.folk.people));
            let hot = 0;
            let grudges = 0;
            let violent = 0;
            for (const s of rosters) {
                for (const g of Object.values((s.brawls && s.brawls.feuds) || {})) { grudges++; hot = Math.max(hot, g.heat || 0); }
                for (const p of s.folk.people) if (p.died != null && /brawl|killed|murder|hanged|gallows/.test(String(p.cause))) { violent++; if (ENV.BF_CAUSES) console.warn(`death: ${p.first} ${p.last}: ${p.cause}`); }
            }
            years.push({ day: game.world.day, open: st.list.length, mine: BloodFeuds.ofPlayer(game.world).length, past: st.past.length, feudDeaths: feudDeaths(game.world), rosters: rosters.length, grudges, hot: Math.round(hot), violent });
        }
    }
    return { seed, years, blows, stats: Object.fromEntries(Object.entries(stats).filter(([k]) => /^feud/.test(k))) };
}

describe.skipIf(!ON)('blood feuds probe', () => {
    it('reports the feuds of a few years', () => {
        for (const seed of SEEDS) {
            const r = run(seed);
            console.warn(JSON.stringify(r, null, 1));
            const last = r.years[r.years.length - 1] || { feudDeaths: 0, open: 0 };
            expect(last.open).toBeLessThanOrEqual(BloodFeuds.config().maxOpen);
            // (one world killing every worldKillGap days at most, plus the brawls' own)
            expect(last.feudDeaths).toBeLessThanOrEqual(Math.ceil((YEARS * 120) / BloodFeuds.config().npc.worldKillGap) + 2);
        }
    }, 1800000);
});
