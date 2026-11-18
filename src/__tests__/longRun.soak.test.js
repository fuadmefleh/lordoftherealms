// Long-run economy soak: the bot plays 80+ years (several heirs) and every
// LONGRUN_EVERY years (5) a row of the world's health is taken — coin and the
// part of it no book explains, who holds it (towns, crowns, guilds, banks,
// merchant houses, underwriters, rival Houses, NPC purses, the player), the
// guilds and their treasuries, towns and their people, living realms and
// wars, staple prices against their anchors, the player's dynasty, and the
// sim's ms/day. The run then asserts the healthy bands those curves were
// found to keep (2026-11-17). Skipped unless LONGRUN=1 (it takes ~30-60 min a seed).
//
//   LONGRUN=1 LONGRUN_SEEDS=101,202 LONGRUN_YEARS=85 LONGRUN_OUT=rows.jsonl npx vitest run src/__tests__/longRun.soak.test.js
//
// LONGRUN_OUT appends each row as a JSON line as it is taken (watch a run live).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import { loadData, newGame, endDay, roundTrip, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Trading, PlayerEconomy } from '../player/playerEconomy.js';
import { PriceAnchors } from '../world/priceAnchors.js';
import { SaveLoad } from '../systems/saveLoad.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.LONGRUN;
const SEEDS = ENV.LONGRUN_SEEDS ? ENV.LONGRUN_SEEDS.split(',').map(Number) : [101, 202];
const DAYS_PER_YEAR = 120;
const YEARS = Number(ENV.LONGRUN_YEARS) || 85;
const EVERY = (Number(ENV.LONGRUN_EVERY) || 5) * DAYS_PER_YEAR;
const SAVE_EVERY = 20 * DAYS_PER_YEAR;
const OUT = ENV.LONGRUN_OUT || null;
const JUMPS = !!ENV.LONGRUN_JUMPS;
const STAPLES = ['grain', 'bread', 'beer', 'iron', 'textiles', 'tools'];

let logSpy, warnSpy, errorSpy;
let consoleErrors = 0;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { consoleErrors++; });
});
afterAll(() => { logSpy?.mockRestore(); warnSpy?.mockRestore(); errorSpy?.mockRestore(); });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pos = (v) => Math.max(0, num(v));
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sum = (a, f) => a.reduce((t, x) => t + pos(f(x)), 0);
const r0 = Math.round;

/** The holder classes the brief asks for (finer than CoinCensus's kinds). */
function holders(world, player) {
    const views = world.getSettlementViews();
    const out = { towns: 0, folk: 0, guilds: 0, underworld: 0, inns: 0, roads: 0 };
    for (const v of views) {
        const t = world.getTile(v.q, v.r);
        const s = (t && t.settlement) || v;
        if (s.economy) out.towns += pos(s.economy.gold);
        if (s.folk && Array.isArray(s.folk.people)) out.folk += sum(s.folk.people, p => p && p.purse);
        if (s.guilds) out.guilds += sum(Object.values(s.guilds), g => g && g.treasury);
    }
    const alive = (world.kingdoms || []).filter(k => k && k.isAlive);
    out.crowns = sum(alive, k => k.treasury);
    out.royalBanks = sum(alive, k => k.royalBank && k.royalBank.treasury);
    const fin = player.finance;
    out.banks = sum(fin && Array.isArray(fin.banks) ? fin.banks.filter(b => b && b.status === 'open') : [], b => b.capital);
    const mer = player.merchant;
    out.merchants = sum(mer && Array.isArray(mer.rivals) ? mer.rivals.filter(r => r && !r.bankrupt) : [], r => r.capital);
    out.company = pos(mer && mer.company && mer.company.capital);
    out.underwriters = sum(player.underwriting && Array.isArray(player.underwriting.guilds) ? player.underwriting.guilds : [], g => g.capital);
    out.rivalHouses = sum(Object.values((player.house && player.house.rivals) || {}).filter(h => h && !h.extinct), h => h.gold);
    out.cadets = sum(((player.house && player.house.cadets) || []).filter(b => b && !b.ended), b => b.gold);
    const est = world.estates && world.estates.holders;
    out.estates = sum(Object.values(est || {}).filter(h => h && h.kind !== 'player' && h.kind !== 'crown'), h => h.purse);
    out.player = pos(player.gold);
    return out;
}

function guildStats(world) {
    const tre = [];
    let towns = 0;
    for (const v of world.getSettlementViews()) {
        const t = world.getTile(v.q, v.r);
        const s = (t && t.settlement) || v;
        const gs = s.guilds ? Object.values(s.guilds).filter(Boolean) : [];
        if (gs.length) towns++;
        for (const g of gs) tre.push(num(g.treasury));
    }
    return { n: tre.length, towns, total: r0(tre.reduce((a, b) => a + b, 0)), med: r0(median(tre)), max: r0(Math.max(0, ...tre)), broke: tre.filter(x => x < 5).length };
}

function townStats(world) {
    const views = world.getSettlementViews();
    const pops = views.map(v => num(v.population));
    const purses = [];
    for (const v of views) {
        const t = world.getTile(v.q, v.r);
        const s = (t && t.settlement) || v;
        if (s.economy && s.kingdom != null && !s.inKind) purses.push(num(s.economy.gold));
    }
    let rostered = 0, folkLive = 0, folkDead = 0;
    for (const v of views) {
        const t = world.getTile(v.q, v.r);
        const s = (t && t.settlement) || v;
        const ppl = s.folk && Array.isArray(s.folk.people) ? s.folk.people : null;
        if (!ppl) continue;
        rostered++;
        for (const p of ppl) if (p && p.died != null) folkDead++; else folkLive++;
    }
    const tot = purses.reduce((a, b) => a + b, 0);
    const top = purses.slice().sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    return {
        n: views.length, pop: r0(pops.reduce((a, b) => a + b, 0)), empty: pops.filter(p => p < 10).length,
        small: pops.filter(p => p < 50).length, purseMed: r0(median(purses)), broke: purses.filter(x => x < 20).length,
        top3Share: tot > 0 ? Math.round(top / tot * 1000) / 10 : 0,
        rostered, folkLive, folkDead,
    };
}

function priceStats(world) {
    const views = world.getSettlementViews();
    const acc = {};
    for (let i = 0; i < views.length; i += 3) {
        const t = world.getTile(views[i].q, views[i].r);
        if (!t || !t.settlement) continue;
        let goods;
        try { goods = Trading.getAvailableGoods(t.settlement, t, world); } catch (e) { continue; }
        for (const g of goods) if (STAPLES.includes(g.id) && Number.isFinite(g.price)) (acc[g.id] = acc[g.id] || []).push(g.price);
    }
    const out = {};
    for (const id of STAPLES) {
        const good = Object.values(PlayerEconomy.GOODS).find(g => g.id === id);
        const base = good ? good.basePrice : 0;
        const anchor = PriceAnchors.base(world, id, base);
        const med = median(acc[id] || []);
        out[id] = { med: Math.round(med * 10) / 10, anchor: Math.round(anchor * 10) / 10, vsBase: base ? Math.round(med / base * 100) / 100 : null };
    }
    return out;
}

function warStats(world) {
    const alive = (world.kingdoms || []).filter(k => k && k.isAlive);
    const wars = alive.reduce((a, k) => a + (k.wars || []).filter(id => alive.some(o => o.id === id)).length, 0) / 2;
    return { alive: alive.length, of: (world.kingdoms || []).length, wars, pop: r0(sum(alive, k => k.population)) };
}

function runLong(seed) {
    let game = newGame(seed);
    game.timing = {};
    const rows = [];
    const errors = [];
    const dyn = { heir: 0, cadet: 0, stranger: 0, end: 0, deaths: [] };
    // (the towns' purses are set up on the first day: the books open after it)
    let c0 = null;
    let b0 = 0;
    let lastDrift = 0;
    let lastU = null;
    const jumps = [];
    let winStart = performance.now();
    let lastTiming = {};
    const days = YEARS * DAYS_PER_YEAR;
    for (let i = 0; i < days; i++) {
        try { botDay(game, {}); } catch (e) { errors.push(`bot d${game.world.day}: ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); }
        let res = {};
        try { res = endDay(game) || {}; } catch (e) { errors.push(`endDay d${game.world.day}: ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); }
        if (res.died) {
            const age = r0(game.player.age);
            const next = carryOn(game, res.died);
            dyn[next.how || 'end']++;
            dyn.deaths.push(`${res.died}@${age} d${game.world.day}→${next.how || 'end'}`);
            if (!next.how) break;
        }
        if (c0 == null) { c0 = CoinCensus.total(game.world, game.player).total; b0 = MoneySupply.bookedChange(game.world); }
        // (a day the unbooked coin jumps: what happened that day — LONGRUN_JUMPS=1, a census a day)
        if (JUMPS) {
            const u = CoinCensus.total(game.world, game.player).total - MoneySupply.bookedChange(game.world);
            if (lastU != null && Math.abs(u - lastU) > 300) {
                const evs = (game.world.events || []).slice(-4).map(e => String(e.text || e).slice(0, 80));
                jumps.push(`d${game.world.day} ${r0(u - lastU)}${res.died ? ' (death)' : ''}: ${evs.join(' / ')}`);
            }
            lastU = u;
        }
        if (i > 0 && i % SAVE_EVERY === 0) { game = roundTrip(game); lastU = null; }
        if ((i + 1) % EVERY === 0) {
            const now = performance.now();
            const { world, player } = game;
            const census = CoinCensus.total(world, player);
            const booked = MoneySupply.bookedChange(world) - b0;
            const drift = (census.total - c0) - booked;
            const tdelta = Object.entries(game.timing).map(([k, v]) => [k, (v - (lastTiming[k] || 0)) / EVERY]).sort((a, b) => b[1] - a[1]);
            lastTiming = { ...game.timing };
            const leaks = Object.fromEntries(Object.entries((world.money && world.money.leaks) || {}).filter(([, v]) => Math.abs(v) >= 1).map(([k, v]) => [k, r0(v)]));
            const row = {
                seed, year: (i + 1) / DAYS_PER_YEAR, day: world.day,
                coin: r0(census.total), booked: r0(booked), drift: r0(drift), driftWin: r0(drift - lastDrift),
                byKind: Object.fromEntries(Object.entries(census.byKind).map(([k, v]) => [k, r0(v)])),
                hold: Object.fromEntries(Object.entries(holders(world, player)).map(([k, v]) => [k, r0(v)])),
                leaks,
                guilds: guildStats(world), towns: townStats(world), realms: warStats(world), prices: priceStats(world),
                dyn: { gen: (player.house && player.house.generation) || 1, heir: dyn.heir, cadet: dyn.cadet, stranger: dyn.stranger, name: player.name, age: r0(player.age), kids: (player.children || []).filter(c => c && !c.isSibling && c.isAlive !== false).length },
                msDay: r0((now - winStart) / EVERY), top: tdelta.slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(1)}`),
                saveKB: r0(JSON.stringify({ w: SaveLoad.serializeWorld(world), p: SaveLoad.serializePlayer(player) }).length / 1024),
                errors: errors.length, consoleErrors, jumps: jumps.splice(0),
            };
            lastDrift = drift;
            rows.push(row);
            if (OUT) fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
            winStart = performance.now();
        }
    }
    if (OUT && errors.length) fs.appendFileSync(OUT, JSON.stringify({ seed, errors: errors.slice(0, 20), deaths: dyn.deaths }) + '\n');
    else if (OUT) fs.appendFileSync(OUT, JSON.stringify({ seed, deaths: dyn.deaths }) + '\n');
    return { rows, errors, dyn };
}

describe.skipIf(!ON)('long-run economy soak (LONGRUN=1)', () => {
    for (const seed of SEEDS) {
        it(`seed ${seed}: ${YEARS} years keep the economy in its healthy bands`, () => {
            const { rows, errors } = runLong(seed);
            expect(errors.slice(0, 5), errors.slice(0, 5).join('\n')).toEqual([]);
            expect(rows.length).toBe(Math.floor(YEARS * DAYS_PER_YEAR / EVERY));
            const first = rows[0];
            const last = rows[rows.length - 1];
            for (const r of rows) {
                const at = `seed ${seed} y${r.year}`;
                // The census closes: what no book explains stays a sliver of the coin
                // (before 2026-11-17: +86k of 1.37M on seed 202 by year 85 — fallen realms'
                // royal banks refilled by a reload, pruned NPCs' purses lost)
                expect(Math.abs(r.drift), `${at}: unbooked drift ${r.drift} of ${r.coin}`).toBeLessThan(Math.max(2000, r.coin * 0.004));
                // No one holder class piles up the world's coin. The banking houses hold about
                // half of it from the world's making (their vaults, out of circulation); the
                // landholders' coffers a few percent (before: a third by year 85 on seed 202)
                const tot = Object.values(r.hold).reduce((a, b) => a + b, 0) || 1;
                const share = (k) => (r.hold[k] || 0) / tot;
                expect(share('banks') + share('royalBanks'), `${at}: banks ${r.hold.banks}+${r.hold.royalBanks} of ${tot}`).toBeLessThan(0.65);
                expect(share('estates'), `${at}: coffers ${r.hold.estates} of ${tot}`).toBeLessThan(0.12);
                expect(share('rivalHouses') + share('cadets'), `${at}: rival Houses`).toBeLessThan(0.1);
                expect(share('merchants') + share('underwriters'), `${at}: merchant houses + underwriters`).toBeLessThan(0.15);
                for (const k of ['towns', 'crowns', 'guilds', 'folk', 'player']) expect(share(k), `${at}: ${k} holds ${r.hold[k]} of ${tot}`).toBeLessThan(0.4);
                expect(share('towns'), `${at}: the towns are drained (${r.hold.towns} of ${tot})`).toBeGreaterThan(0.06);
                // Guilds neither vanish nor hoard (a guild holds a few hundred to a few thousand)
                expect(r.guilds.n, `${at}: guilds`).toBeGreaterThan(5);
                expect(r.guilds.med, `${at}: guild median`).toBeLessThan(20000);
                // Staples stay within a band of their data price
                for (const id of ['grain', 'bread', 'beer', 'iron']) {
                    const p = r.prices[id];
                    if (p && p.vsBase != null && p.med > 0) {
                        expect(p.vsBase, `${at}: ${id} ×${p.vsBase}`).toBeGreaterThan(0.25);
                        expect(p.vsBase, `${at}: ${id} ×${p.vsBase}`).toBeLessThan(4);
                    }
                }
                // Realms neither all die nor freeze; towns keep their people
                expect(r.realms.alive, `${at}: realms`).toBeGreaterThan(2);
                expect(r.towns.empty / r.towns.n, `${at}: empty towns`).toBeLessThan(0.2);
            }
            // The merchant houses never die out for good (with no company, ruined ones weren't replaced)
            expect(rows.filter(r => r.hold.merchants > 0).length / rows.length, 'years with merchant houses').toBeGreaterThan(0.8);
            // People neither collapse nor explode across the run
            expect(last.towns.pop / first.towns.pop).toBeGreaterThan(0.5);
            expect(last.towns.pop / first.towns.pop).toBeLessThan(5);
            // The sim doesn't slow down without bound
            expect(last.msDay, `ms/day ${first.msDay} → ${last.msDay}`).toBeLessThan(Math.max(400, first.msDay * 4));
        }, 6 * 3600 * 1000);
    }
});
