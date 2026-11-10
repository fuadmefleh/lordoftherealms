// The General's career in the long run (player/generalship.js, data/
// generalship.json): a seeded multi-day sim of the General start with a bot
// that serves as a general would — keeps the host fed, gives battle at the
// front, carries out the crown's orders (marching to the town it is told to
// hold or take), besieges and storms. Over months it checks that the
// commission neither bankrupts the crown (wages and bonuses a modest share of
// what the crown takes in) nor leaves the general with nothing (a living
// wage, merit, the realm's battles going better with them at the front), and
// that a siege takes days, not a season.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Scenarios } from '../player/scenarios.js';
import { Generalship } from '../player/generalship.js';
import { Economy } from '../world/economy.js';
import { CrownBooks } from '../world/crownBooks.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Hex } from '../core/hex.js';

beforeAll(async () => {
    await loadData();
});

const DAYS = Number(process.env.GEN_DAYS || 150);

/** Somewhere the host can stand beside (q, r): a passable land neighbour, or the tile itself. */
function beside(world, q, r) {
    for (const n of Hex.neighbors(q, r)) {
        const nq = Hex.wrapQ(n.q, world.width);
        const t = world.getTile(nq, n.r);
        if (t && t.terrain && t.terrain.passable && !t.settlement && !/water|ocean|sea|lake/.test(t.terrain.id)) return { q: nq, r: n.r };
    }
    return { q, r };
}

/** The bot's day as a general: feed the host, follow orders, fight. */
function serve(g, stats) {
    const { player: p, world: w } = g;
    const c = Generalship.state(p);
    if (!c) return;
    p.actionPoints = 10;
    if (p.needs) for (const k of Object.keys(p.needs)) p.needs[k] = 90;
    p.health = p.maxHealth || 100;
    if (Generalship.supplyDays(c) < 4) Generalship.requisition(p, w);
    const o = c.order;
    // March where the orders say (a day's march: the sim moves the host there)
    if (!c.siege && o) {
        if ((o.kind === 'besiege' || o.kind === 'defend') && o.target) {
            const at = o.kind === 'besiege' ? beside(w, o.target.q, o.target.r) : o.target;
            p.q = at.q; p.r = at.r;
        } else if (o.kind === 'patrol') {
            const next = (o.targets || []).find(t => !t.seen);
            if (next) { p.q = next.q; p.r = next.r; }
        } else if (o.kind === 'raid' || o.kind === 'battle') {
            const e = w.getKingdom ? w.getKingdom(o.enemyId) : null;
            const t = e && Economy.realmTowns(e, w).sort((a, b) => Hex.wrappingDistance(a.q, a.r, p.q, p.r, w.width) - Hex.wrappingDistance(b.q, b.r, p.q, p.r, w.width))[0];
            if (t) { const at = beside(w, t.q, t.r); p.q = at.q; p.r = at.r; }
        }
    }
    if (c.siege) {
        if (c.siege.progress >= 70 && c.lastBattleDay !== w.day) {
            const r = Generalship.assault(p, w);
            if (r.success) stats.assaults++;
        }
        return;
    }
    const near = Generalship._enemyTownNear(p, w, c);
    if (near && o && o.kind === 'besiege' && o.target.q === near.q && o.target.r === near.r) {
        if (Generalship.besiege(p, w, 'spare').success) stats.sieges.push({ start: w.day, name: near.s.name });
        return;
    }
    if (near && o && o.kind === 'raid') { Generalship.raid(p, w); return; }
    const front = Generalship.frontEnemies(p, w);
    // (a general gives battle when the odds favour it, not every day)
    const best = front.map(e => Generalship.prepareBattle(p, w, 'field', { enemyId: e.id }).spec).filter(Boolean).sort((a, b) => b.odds - a.odds)[0];
    if (best && best.odds >= 0.55 && c.lastBattleDay !== w.day && w.day % 2 === 0) {
        const res = Generalship.giveBattle(p, w, best.enemy.kingdomId);
        if (res.success) stats.battles++;
    }
}

function run(seed, keepWar = true) {
    const g = newGame(seed);
    Scenarios.apply(g.player, g.world, { origin: 'general' });
    const c0 = Generalship.state(g.player);
    const k = g.world.getKingdom(c0.kingdomId);
    // A general's career is made in war: (in the war half of the runs) the realm kept at war
    // with its nearest neighbour; in the peace half it keeps the peace it has
    const war = () => {
        if ((k.wars || []).length) return;
        const foe = g.world.kingdoms.filter(x => x.id !== k.id && x.isAlive !== false && x.capital && Economy.realmTowns(x, g.world).length >= 2)
            .sort((a, b) => Hex.wrappingDistance(a.capital.q, a.capital.r, k.capital.q, k.capital.r, g.world.width) - Hex.wrappingDistance(b.capital.q, b.capital.r, k.capital.q, k.capital.r, g.world.width))[0];
        if (foe) KingdomAI.startWar(k, foe, g.world);
    };
    const stats = { seed, battles: 0, assaults: 0, sieges: [], revenue: 0, treasury0: Math.round(k.treasury), treasuryMin: Infinity, gold0: g.player.gold, mult: [], days: 0, bonus: 0, warDays: 0 };
    let lastTaken = 0;
    for (let d = 0; d < DAYS; d++) {
        if (keepWar) war();
        if ((k.wars || []).length) stats.warDays++;
        serve(g, stats);
        const goldBefore = g.player.gold;
        const cb = Generalship.state(g.player);
        const ordersBefore = cb ? cb.record.ordersDone : 0;
        const kindBefore = cb && cb.order ? cb.order.kind : null;
        endDay(g);
        stats.days++;
        const c = Generalship.state(g.player);
        if (!c) break;
        if (c.record.ordersDone > ordersBefore) {
            stats.bonus += Math.max(0, g.player.gold - goldBefore);
            stats.kinds = stats.kinds || {};
            stats.kinds[kindBefore] = (stats.kinds[kindBefore] || 0) + 1;
        }
        if (c.lieutenants && stats.firstRank3 == null && c.rank >= 3) stats.firstRank3 = g.world.day;
        stats.revenue += CrownBooks.lastRevenue(k) || 0;
        stats.treasuryMin = Math.min(stats.treasuryMin, k.treasury);
        if (k.fieldCommand && k.fieldCommand.mult > 1) stats.mult.push(k.fieldCommand.mult);
        if (c.record.townsTaken > lastTaken) {
            lastTaken = c.record.townsTaken;
            const sg = stats.sieges[stats.sieges.length - 1];
            if (sg && sg.end == null) sg.end = g.world.day;
        }
    }
    const c = Generalship.state(g.player) || {};
    const rec = c.record || (g.player.commissionPast && g.player.commissionPast[0] && g.player.commissionPast[0].record) || {};
    return {
        ...stats, ended: c.rank == null ? (g.player.commissionPast[0] || {}).how : null,
        rank: c.rank, merit: Math.round(c.merit || 0), favour: Math.round(c.favour || 0), owed: Math.round(c.owed || 0),
        wages: Math.round(rec.wages || 0), plunder: Math.round(rec.plunder || 0), bonus: Math.round(stats.bonus),
        won: rec.battlesWon || 0, lost: rec.battlesLost || 0, towns: rec.townsTaken || 0, realmWon: rec.realmWon || 0, realmLost: rec.realmLost || 0,
        ordersDone: rec.ordersDone || 0, ordersFailed: rec.ordersFailed || 0,
        treasuryEnd: Math.round(k.treasury), treasuryMin: Math.round(stats.treasuryMin), revenue: Math.round(stats.revenue),
        avgMult: stats.mult.length ? Math.round(stats.mult.reduce((s, x) => s + x, 0) / stats.mult.length * 100) / 100 : 1,
        siegeDays: stats.sieges.filter(s => s.end != null).map(s => s.end - s.start),
    };
}

describe('the General career over months', () => {
    const seeds = (process.env.GEN_SEEDS || '301,302,303').split(',').map(Number);
    const results = [];
    for (const seed of seeds) {
        it(`seed ${seed}: the crown is not bankrupted and the general is paid`, () => {
            const r = run(seed);
            results.push(r);
            console.log(`[general balance] ${JSON.stringify(r)}`);
            const paid = r.wages + r.bonus;
            // The crown: the general's pay is a small share of what it takes in
            if (r.revenue > 0) expect(paid / r.revenue).toBeLessThan(0.12);
            // The general: a living wage (paid or owed) and something to show for it
            expect((r.wages + r.owed) / Math.max(1, r.days)).toBeGreaterThan(5);
            expect(r.merit + (r.rank || 0) * 50).toBeGreaterThan(0);
            for (const d of r.siegeDays) expect(d).toBeLessThanOrEqual(30);
        }, 600000);
    }
});
