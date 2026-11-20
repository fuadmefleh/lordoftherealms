// Stranger-lives probe: how long a "new life" (Afterlife.becomeStranger)
// lasts under the bot, and what kills it. Each seed plays a few days, then the
// player is made to die and come back as a stranger (the first candidate, as the
// harness's carryOn does); every later death is a stranger again, until
// PROBE_DAYS have passed. Each life's cause of death, days lived, starting purse
// and the last days before the end are printed (and appended to PROBE_OUT as
// JSON lines). Skipped unless PROBE_STRANGER=1.
//
//   PROBE_STRANGER=1 PROBE_SEEDS=101,202,303 PROBE_DAYS=2400 npx vitest run src/__tests__/strangerLives.probe.test.js

import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Ailments } from '../systems/ailments.js';
import { Delves } from '../systems/delves.js';
import { Hex } from '../core/hex.js';
import { Trading } from '../player/playerEconomy.js';
import { SettlementMarket } from '../world/settlementMarket.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.PROBE_STRANGER;
const SEEDS = ENV.PROBE_SEEDS ? ENV.PROBE_SEEDS.split(',').map(Number) : [101, 202, 303, 404, 505];
const DAYS = Number(ENV.PROBE_DAYS) || 2400;
const OUT = ENV.PROBE_OUT || null;

let spies = [];
beforeAll(async () => {
    await loadData();
    spies = ['log', 'warn', 'error'].map(k => vi.spyOn(console, k).mockImplementation(() => {}));
});
afterAll(() => spies.forEach(s => s.mockRestore()));

function snap(game) {
    const { player: p, world } = game;
    const t = world.getTile(p.q, p.r);
    return {
        d: world.day, hp: Math.round(p.health), g: Math.round(p.gold), f: p.getFoodCount(),
        hu: p.needs ? Math.round(p.needs.hunger) : null, town: !!(t && t.settlement), sd: p.starvationDays || 0,
        dest: game.dest ? `${game.dest.q},${game.dest.r}${game.dest.delve ? 'D' : ''}${game.dest.company ? 'C' : ''}` : null,
        trek: game.trek ? `${game.trek.q},${game.trek.r}` : null, at: `${p.q},${p.r}`, ter: t && t.terrain && t.terrain.id,
        cross: !!p.crossing, ap: p.actionPoints, tw: p.turnedAway ? `${p.turnedAway.q},${p.turnedAway.r}:${String(p.turnedAway.why || '').slice(0, 30)}` : null, mv: `${Math.round((p._dayMovement || 0) * 10) / 10}/${p._dayPace || 0}${p.crossing ? ' ' + Math.round(p.crossing.done * 10) / 10 + '/' + Math.round(p.crossing.need * 10) / 10 : ''}`, delve: !!Delves.active(p), army: (p.army || []).length, ship: !!p.boardedShip,
        town1: (() => { let b = null; for (const v of world.getSettlementViews()) { const d = Hex.wrappingDistance(p.q, p.r, v.q, v.r, world.width); if (d > 0 && (!b || d < b.d) && p._overlandReachable(v.q, v.r, world)) b = { d, at: `${v.q},${v.r}` }; } return b ? `${b.d}@${b.at}` : 'none'; })(),
        mkt: t && t.settlement && p.getFoodCount() <= 4 ? (() => {
            let goods = [];
            try { goods = Trading.getAvailableGoods(t.settlement, t, world) || []; } catch (e) { return 'err ' + e.message; }
            const ed = p.constructor.FOOD_TYPES || [];
            return goods.filter(x => ed.includes(x.id)).map(x => `${x.id}:${x.quantity}@${Math.round(x.price * 10) / 10}`).join(' ') || 'none';
        })() : undefined,
        ail: Ailments.list(p).map(a => `${a.id}${a.infected ? '!' : ''}${a.source ? '<' + a.source : ''}`).join(','),
    };
}

/** A new life's start: its purse, station, and the cheapest food on its town's stalls. */
function newLife(game) {
    const { player: p, world } = game;
    const t = world.getTile(p.q, p.r);
    let cheapest = null;
    if (t && t.settlement) {
        const ed = p.constructor.FOOD_TYPES || [];
        let goods = [];
        try { goods = Trading.getAvailableGoods(t.settlement, t, world) || []; } catch (e) { goods = []; }
        const c = goods.filter(x => ed.includes(x.id) && x.quantity > 0).sort((a, b) => a.price - b.price)[0];
        cheapest = c ? `${c.id}@${Math.round(c.price * 10) / 10}` : 'none';
    }
    return { start: world.day, gold0: Math.round(p.gold), station: p.origin && p.origin.station, hp0: p.health, food0: cheapest, tail: [] };
}

function probe(seed) {
    const game = newGame(seed);
    // (PROBE_LEGACY=1: the harness's old automatic road encounters, as before the bot read the odds)
    if (ENV.PROBE_LEGACY) game.legacyEncounters = true;
    const stats = {};
    const lives = [];
    for (let i = 0; i < 20; i++) { botDay(game, stats); endDay(game); }
    // The first life dies young: no heirs, a stranger after it
    let next = carryOn(game, 'probe');
    if (next.how !== 'stranger') return { seed, lives, note: `first carryOn: ${next.how}` };
    let life = newLife(game);
    const end = game.world.day + DAYS;
    while (game.world.day < end) {
        try { botDay(game, stats); } catch (e) { life.err = String(e).slice(0, 120); }
        let res = {};
        try { res = endDay(game) || {}; } catch (e) { life.err = String(e).slice(0, 120); }
        life.tail.push(snap(game));
        if (life.tail.length > 25) life.tail.shift();
        if (res.died) {
            life.cause = res.died;
            // (how many of the world's towns had food on their stalls that day)
            {
                const ed = game.player.constructor.FOOD_TYPES || [];
                const views = game.world.getSettlementViews();
                let fed = 0;
                for (const v of views) {
                    const t = game.world.getTile(v.q, v.r);
                    if (t && t.settlement && ed.some(id => SettlementMarket.available(t.settlement, id) >= 1)) fed++;
                }
                life.townsWithFood = `${fed}/${views.length}`;
            }
            life.days = game.world.day - life.start;
            lives.push(life);
            next = carryOn(game, res.died);
            if (next.how !== 'stranger') break;
            life = newLife(game);
        }
    }
    if (!life.cause) { life.days = game.world.day - life.start; life.cause = 'alive'; lives.push(life); }
    return { seed, lives, stats };
}

describe.skipIf(!ON)('stranger lives probe', () => {
    it('plays stranger lives across seeds', () => {
        const all = [];
        for (const seed of SEEDS) {
            const r = probe(seed);
            all.push(...r.lives);
            const line = r.lives.map(l => `${l.cause}@${l.days}d(${l.station},${l.gold0}g,${l.food0})`).join(' ');
            console.info(`seed ${seed}: ${line}${r.note ? ' ' + r.note : ''}`);
            if (OUT) {
                for (const l of r.lives) fs.appendFileSync(OUT, JSON.stringify({ seed, ...l }) + '\n');
                fs.appendFileSync(OUT, JSON.stringify({ seed, stats: r.stats }) + '\n');
            }
        }
        const dead = all.filter(l => l.cause !== 'alive');
        const by = {};
        for (const l of dead) by[l.cause] = (by[l.cause] || 0) + 1;
        const days = all.map(l => l.days).sort((a, b) => a - b);
        console.info(`TOTAL lives ${all.length}, deaths ${dead.length} ${JSON.stringify(by)}, median days ${days[Math.floor(days.length / 2)]}`);
    }, 4 * 3600 * 1000);
});
