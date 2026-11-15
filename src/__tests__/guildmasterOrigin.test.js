// The Guildmaster origin's first election (2026-11-15). The origin seats the
// player as a freshly elected guildmaster with the masters' vote ~45 days on.
// Before this, the sitting player-master ran on standing alone against a
// challenger's 40..100 roll and lost the vote more than half the time, which
// wrecked the origin's opening. A sitting master now has an incumbency and a
// first-term grace (systems/guilds.js _election → Guilds.incumbency), docked by
// a poor record in the chair; a master who lets the guild down still loses.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Scenarios } from '../player/scenarios.js';
import { Guilds } from '../systems/guilds.js';

beforeAll(async () => {
    await loadData();
});

const SEEDS = [11, 23, 37, 41, 53, 67, 79, 83, 97, 103, 113, 127, 131, 149, 157, 163];

/** Start a Guildmaster game; `abuse(g, s, gid)` runs once at the start. Returns { won, standing, seat, feud } (seat: the chair's worth on the eve of the vote). */
function runVote(seed, abuse = null) {
    const g = newGame(seed);
    g.autoUpkeep = 'full';
    Scenarios.apply(g.player, g.world, { origin: 'guildmaster' });
    const st = g.player.scenario.start;
    if (!st || st.kind !== 'guildmaster') return null;
    const s = g.world.getTile(st.q, st.r).settlement;
    const gd = Guilds.guild(s, st.guild);
    if (abuse) abuse(g, s, st.guild);
    const vote = gd.nextElection;
    let seat = null, feud = 0;
    // (the vote runs on the guild's weekly turn on or after the day)
    for (let d = 0; d < 80 && Guilds.guild(s, st.guild) && Guilds.guild(s, st.guild).nextElection === vote; d++) {
        const m = Guilds.membership(g.player, s, st.guild);
        if (m) { seat = Guilds.incumbency(s, gd, m, g.world.day).total; feud = Math.round(gd.feud || 0); }
        g.player.health = 100;
        g.player.starvationDays = 0;
        endDay(g);
    }
    const after = Guilds.guild(s, st.guild);
    const m = Guilds.membership(g.player, s, st.guild);
    return { seed, won: !!(after && after.master && after.master.player), standing: m ? Math.round(m.standing) : null, seat, feud };
}

/** Neglect: two guild contracts taken on the hall's money and never delivered. */
function failContracts(g, s, gid) {
    const p = g.player;
    const tile = g.world.getTile(s.q, s.r);
    for (const o of Guilds.contractOffers(p, g.world, s, gid)) Guilds.takeContract(p, g.world, tile, gid, o.good);
    // (where the hall wants none of its inputs today, the same broken promise by hand)
    const st = Guilds.state(p);
    const key = Guilds.membership(p, s, gid).key;
    while (st.contracts.length < 2) {
        st.contracts.push({ id: st.nextId++, key, q: s.q, r: s.r, town: s.name, guild: gid, good: (Guilds.def(gid).inputs[st.contracts.length] || Guilds.def(gid).goods[0]), qty: 10, delivered: 0, unit: 1, escrow: 0, due: g.world.day + 14 });
    }
}

describe('the Guildmaster origin\'s first election', () => {
    it('a master who does no harm keeps the chair at the first vote (>= 85% of seeds)', () => {
        const rows = SEEDS.map(seed => runVote(seed)).filter(Boolean);
        const wins = rows.filter(r => r.won).length;
        console.log(`[guildmaster vote] idle: ${wins}/${rows.length} kept the chair`, rows.map(r => `${r.seed}:${r.won ? 'W' : 'L'}(s${r.standing} c${r.seat} f${r.feud})`).join(' '));
        expect(rows.length).toBeGreaterThanOrEqual(12);
        expect(wins / rows.length).toBeGreaterThanOrEqual(0.85);
    }, 900000);

    it('a master who breaks the hall\'s contracts can still lose it', () => {
        const rows = SEEDS.slice(0, 10).map(seed => runVote(seed, failContracts)).filter(Boolean);
        const wins = rows.filter(r => r.won).length;
        console.log(`[guildmaster vote] neglect: ${wins}/${rows.length} kept the chair`, rows.map(r => `${r.seed}:${r.won ? 'W' : 'L'}(s${r.standing} c${r.seat} f${r.feud})`).join(' '));
        expect(wins / rows.length).toBeLessThanOrEqual(0.6);
    }, 900000);
});
