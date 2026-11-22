// The endgame soak: a crowned House played for a century, to tune the
// endgame's thresholds (data/lastCrisis.json, realmDecline.json,
// crownSuccession.json, highCrowns.json, namedLegacy.json). OPT-IN: it runs
// only with EG_SOAK=1 (a century costs 15–40 minutes a seed), so the normal
// suite skips it.
//
//   EG_SOAK=1            run it
//   EG_SEEDS=101,202     seeds (default 101)
//   EG_YEARS=100         years per run (default 100)
//   EG_MAP=default       default (80×60, 10 realms) | small (80×55, 4) | medium (120×80, 6)
//   EG_ORIGIN=monarch    the start (player/scenarios.js; default monarch)
//   EG_MODE=grow         grow: the playtest bot plus a conqueror's habits (wars on
//                        weaker realms, crowns dictated and accepted, viceroys, the
//                        Empire); rule: the playtest bot alone
//   EG_PREP=alt          yes | no | alt: crown the heir and take the lords' oaths
//                        (systems/crownSuccession.js) — alt does it in every other life
//   EG_THIRST=0          water and thirst switched off (data/water.json enabled: false)
//   EG_TRACE=1 / EG_DUMP=day / EG_VERBOSE=1   the purse's month; the towns' food that day; a starved life's last days
//   EG_CLAIMS=0 / EG_PROGRESS=0               grow mode without pressing claims for far crowns / without royal progresses
//   EG_OUT=dir           also write <dir>/eg_<map>_<mode>_<seed>.json (the yearly rows and events)
//
// Each run prints one line a year (dominance, the reckoning, the four strains,
// crowns, ms/day) and a summary: the last crisis (when, kind, outcome), when
// each strain bit, the successions (prepared or not, contested or not), far
// crowns broken away, AI law codes. Every five years it also probes the
// succession odds as they stand, unprepared and prepared.
//
// Run e.g.: EG_SOAK=1 EG_SEEDS=101 EG_YEARS=100 npx vitest run src/__tests__/endgame.soak.test.js
//
// EG_FAR=1 runs the far-crown soak instead (fast: a 60×40 world, only the world,
// Kingship and HighCrowns days): a ruler wins a second crown and keeps it for
// EG_FAR_YEARS (40) — neglected (never visits), light (a progress every second
// year), tended (a native viceroy, the charter, a progress every second year, the
// viceroy honoured yearly) — on EG_FAR_SEEDS (11,12,13,15,16,17,18,19), and tallies
// how each was lost: the viceroy's coup, the lords' revolt, or held.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Scenarios } from '../player/scenarios.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { HighCrowns } from '../systems/highCrowns.js';
import { CrownSuccession } from '../systems/crownSuccession.js';
import { LastCrisis } from '../systems/lastCrisis.js';
import { RealmDecline } from '../systems/realmDecline.js';
import { Crises } from '../systems/crises.js';
import { Relationships } from '../systems/relationships.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { House } from '../systems/house.js';
import { Espionage } from '../systems/espionage.js';
import { RealmEscort } from '../player/realmEscort.js';
import { Hex } from '../core/hex.js';
import { Trading } from '../player/playerEconomy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Thirst } from '../player/thirst.js';
import { Maiming } from '../systems/maiming.js';
import { PeasantRevolts } from '../systems/peasantRevolts.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.EG_SOAK;
const SEEDS = (ENV.EG_SEEDS || '101').split(',').map(Number);
const YEARS = Number(ENV.EG_YEARS) || 100;
const Y = 120;
const MAP = ENV.EG_MAP || 'default';
const MAPS = {
    default: {},
    small: { width: 80, height: 55, kingdomCount: 4 },
    medium: { width: 120, height: 80, kingdomCount: 6 },
};
const ORIGIN = ENV.EG_ORIGIN || 'monarch';
const MODE = ENV.EG_MODE || 'grow';
const PREP = ENV.EG_PREP || 'alt';
const STRAINS = ['graft', 'drift', 'soft', 'entrench'];

let logSpy;
let warnSpy;
let errorSpy;
beforeAll(async () => {
    if (!ON) return;
    await loadData();
    // EG_THIRST=0: the world without water and thirst (systems/water.js, player/thirst.js), to
    // measure the endgame while the bot cannot yet keep its skins filled
    if (ENV.EG_THIRST === '0' && DataLoader._gamedata && DataLoader._gamedata.water) DataLoader._gamedata.water = { ...DataLoader._gamedata.water, enabled: false };
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
    for (const s of [logSpy, warnSpy, errorSpy]) if (s) s.mockRestore();
});

const out = (s) => process.stdout.write(`${s}\n`);
const r2 = (v) => Math.round(v * 100) / 100;

function prepared(game) {
    if (PREP === 'yes') return true;
    if (PREP === 'no') return false;
    return game.lives % 2 === 1;
}

/** A conqueror's week: war on a weaker realm, crowns dictated and accepted, viceroys, the Empire. */
function growWeek(game, stats) {
    const { player, world } = game;
    const home = Throne.ruledKingdom(player, world);
    if (!home) return;
    const armyStrength = PlayerMilitary.getArmyStrength(player);
    // Dictate a crown to a beaten realm whose capital we stormed
    for (const kid of (home.wars || []).slice()) {
        if (HighCrowns.canDictate(player, world, kid, { armyStrength }).ok && HighCrowns.dictate(player, world, kid, { armyStrength }).success) stats.dictated = (stats.dictated || 0) + 1;
    }
    // A crown offered by blood
    for (const kid of Object.keys(HighCrowns.state(player).offers || {})) {
        if (HighCrowns.acceptOffer(player, world, kid).success) stats.accepted = (stats.accepted || 0) + 1;
    }
    // Viceroys for the far crowns
    for (const e of Object.values(HighCrowns.state(player).crowns || {})) {
        if (e.viceroy) continue;
        const c = (HighCrowns.candidates(player, world, e.kingdomId) || [])[0];
        if (c && HighCrowns.appoint(player, world, e.kingdomId, c.kind, c.id).success) stats.viceroys = (stats.viceroys || 0) + 1;
    }
    if (HighCrowns.proclaimStatus(player, world).ok && HighCrowns.proclaim(player, world).success) stats.proclaimed = (stats.proclaimed || 0) + 1;
    // A royal progress (EG_PROGRESS, default on; 0: never visits): every far crown is visited for
    // about a month every second year, the longest unvisited first (the bot's keepCourt rides there)
    if (ENV.EG_PROGRESS !== '0' && !(game.progress && world.day < game.progress.until)) {
        const due = Object.values(HighCrowns.state(player).crowns || {})
            .filter(e => world.day - (e.lastPresentDay || 0) > 240).sort((a, b) => (a.lastPresentDay || 0) - (b.lastPresentDay || 0))[0];
        if (due) {
            game.progress = { kingdomId: due.kingdomId, until: world.day + 75 };
            stats.progresses = (stats.progresses || 0) + 1;
        }
    }
    // One war at a time, on a realm we outweigh
    if ((home.wars || []).length === 0 && world.day % 28 === 3) {
        const ours = (home.military || 0) + armyStrength;
        const prey = world.kingdoms.filter(k => k && k.isAlive && k.id !== home.id && !(home.allies || []).includes(k.id)
            && !KingdomAI.hasTruce(home, k, world) && !HighCrowns.unionCrown(player, k.id) && (k.military || 0) * 1.3 < ours)
            .sort((a, b) => (a.military || 0) - (b.military || 0))[0];
        if (prey && Throne.declareRealmWar(player, world, prey.id).success) stats.warsDeclared = (stats.warsDeclared || 0) + 1;
    }
}

/**
 * A second crown by claim (EG_CLAIMS=1, on by default in grow mode): the ruler
 * picks the neighbouring realm that leans its way most, buys the heralds' links
 * with Prestige (Throne.purchaseClaim), has a spy forge charters
 * (Throne.forgeClaim), keeps soldiers enough to raise the banners, and presses
 * the claim (Throne.pressClaim) — a civil war the bot's throne() fights; won,
 * the crown joins the union (HighCrowns.addCrown via Throne._crown).
 * The canPress refusals are tallied (stats.pressNo_*), to see what holds it back.
 */
function claimWeek(game, stats) {
    const { player, world } = game;
    const home = Throne.ruledKingdom(player, world);
    const st = Throne.state(player);
    if (!home || st.civilWar || HighCrowns.crownsOf(player, world).length >= HighCrowns.config().maxCrowns) return;
    const armyStrength = PlayerMilitary.getArmyStrength(player);
    const open = world.kingdoms.filter(k => k && k.isAlive && k.id !== home.id && !HighCrowns.unionCrown(player, k.id)
        && !Throne.isExiledFrom(player, world, k.id) && k.capital);
    if (!open.length) return;
    let k = game.farTarget && open.find(x => x.id === game.farTarget);
    if (!k || world.day - (game.farTargetDay || 0) > 1800) {
        // (the realm whose people lean our way most, among the three nearest capitals)
        const near = open.map(x => ({ x, d: Hex.wrappingDistance(home.capital.q, home.capital.r, x.capital.q, x.capital.r, world.width) }))
            .sort((a, b) => a.d - b.d).slice(0, 3);
        k = near.map(n => ({ k: n.x, a: Throne.appeal(player, world, n.x, { armyStrength }).value })).sort((a, b) => b.a - a.a)[0].k;
        game.farTarget = k.id;
        game.farTargetDay = world.day;
    }
    // Heralds: Prestige for a link to its blood (keeping a cushion for the House)
    if (House.getPrestige(player) >= Throne.config().purchasePrestige + 60 && Throne.purchaseClaim(player, world, k.id).success) stats.claimsBought = (stats.claimsBought || 0) + 1;
    // A spy for the forgeries, while the purse allows
    const forged = ((st.claims[k.id] || {}).sources || {}).forged || 0;
    if (forged < Throne.config().forgeCap && player.gold >= 900) {
        Espionage.initPlayer(player);
        if (!player.espionage.spies.length) {
            const spy = Espionage.generateSpy(player, world);
            if (Espionage.recruitSpy(player, spy, world).success) stats.spiesHired = (stats.spiesHired || 0) + 1;
        }
        const f = Throne.forgeClaim(player, world, k.id);
        if (f.success) stats[f.failed ? 'forgeriesExposed' : 'claimsForged'] = (stats[f.failed ? 'forgeriesExposed' : 'claimsForged'] || 0) + 1;
    } else if (forged >= Throne.config().forgeCap && player.espionage && player.espionage.spies.length) {
        for (const spy of player.espionage.spies.slice()) Espionage.dismissSpy(player, spy.id);
    }
    // Men enough to raise the banners: the crown asked for a bigger royal guard (free to a
    // ruler, the treasury pays: player/realmEscort.js), then soldiers hired out of the purse
    const minArmy = Throne.config().pressMinArmy;
    if (Throne.claimStrength(player, k.id) >= Throne.config().pressMinStrength && armyStrength < minArmy + 20) {
        if (RealmEscort.askOdds(player, world).ok && RealmEscort.ask(player, world).success) stats.guardAsked = (stats.guardAsked || 0) + 1;
        const cap = home.capital ? world.getTile(home.capital.q, home.capital.r) : null;
        if (PlayerMilitary.getArmyStrength(player) < minArmy + 20 && player.gold >= 1200 && cap && cap.settlement && player.q === cap.q && player.r === cap.r) {
            for (let i = 0; i < 4 && player.gold >= 900; i++) {
                if (PlayerMilitary.recruitUnit(player, 'soldier', cap.settlement, { world }).success) stats.claimRecruits = (stats.claimRecruits || 0) + 1;
            }
        }
    }
    const strength = PlayerMilitary.getArmyStrength(player);
    const can = Throne.canPress(player, world, k.id, { armyStrength: strength });
    if (!can.ok) {
        const why = String(can.reason || '').replace(/[^a-z ]/gi, '').trim().split(' ').slice(0, 3).join('_');
        stats[`pressNo_${why}`] = (stats[`pressNo_${why}`] || 0) + 1;
        return;
    }
    if (Throne.pressClaim(player, world, k.id, { armyStrength: strength }).success) {
        stats.claimsPressed = (stats.claimsPressed || 0) + 1;
        ev0(game, 'claimPressed', { realm: k.name, claim: Throne.claimStrength(player, k.id), army: Math.round(strength) });
    }
}
const ev0 = (game, kind, data) => { if (game._ev) game._ev(kind, data); };

/** A careful ruler's preparation of the succession: name the heir, crown them, take the oaths. */
function prepWeek(game, stats) {
    const { player, world } = game;
    const home = Throne.ruledKingdom(player, world);
    if (!home) return;
    const kids = (player.children || []).filter(c => c && c.isAlive !== false && !c.isSibling).sort((a, b) => (b.age || 0) - (a.age || 0));
    if (!kids.length) return;
    if (!kids.some(c => c.id === player.heir)) Relationships.designateHeir(player, kids[0].id);
    if (CrownSuccession.crownHeir(player, world).success) stats.crowned = (stats.crowned || 0) + 1;
    if (CrownSuccession.takeOaths(player, world).success) stats.oaths = (stats.oaths || 0) + 1;
    // (a purse for the coronation: the bot keeps little coin)
}

/** The succession odds as they stand, as is and fully prepared. */
function probeSuccession(game) {
    const { player, world } = game;
    const k = Throne.ruledKingdom(player, world);
    if (!k) return null;
    const heir = CrownSuccession.likelyHeir(player);
    if (!heir) return { heir: null };
    const risk = (ctx) => {
        const standing = CrownSuccession.standing(player, world, k, ctx);
        let calm = 1;
        let top = null;
        for (const c of CrownSuccession.claimants(player, world, k, ctx)) {
            const p = CrownSuccession.riseChance(c.strength, standing.value);
            calm *= 1 - p;
            if (!top || p > top.p) top = { kind: c.kind, s: c.strength, p: r2(p) };
        }
        return { risk: r2(1 - calm), standing: standing.value, top };
    };
    const ctx = CrownSuccession.capture(player, world, heir, {});
    ctx.regency = ctx.minor;
    const court = Kingship.court(player);
    const bare = { ...ctx, crowned: false, oaths: [] };
    const full = { ...ctx, designated: true, crowned: !ctx.minor, oaths: court ? court.vassals.filter(v => !v.rebel && (v.opinion || 0) >= 0).map(v => v.id) : [] };
    const grownSons = (ctx.siblings || []).filter(s => !s.uncle && s.age >= 16).length;
    return { heirAge: Math.round(heir.age), minor: ctx.minor, grownSons, asIs: risk(ctx), bare: risk(bare), full: risk(full) };
}

function aiCodes(world) {
    const out = [];
    for (const k of world.kingdoms || []) {
        const c = k && k.laws && k.laws.code;
        if (c && c.name) out.push(`${k.id}:${c.name}:${c.houseId ? 'house' : 'ai'}`);
    }
    return out;
}

// (each maiming on the road, with the life's age: systems/maiming.js roadMaim)
let _maimGame = null;
const _roadMaim = Maiming.roadMaim;
Maiming.roadMaim = function (player, world, attacker, how) {
    const r = _roadMaim.call(Maiming, player, world, attacker, how);
    if (r && _maimGame) (_maimGame._roadMaims || (_maimGame._roadMaims = [])).push({ y: r2(world.day / Y), who: player.name, age: Math.round(player.age || 0), how, by: attacker && (attacker.type || attacker.name) });
    return r;
};

function runOne(seed) {
    const gen = MAPS[MAP] || {};
    let game = newGame(seed, gen);
    _maimGame = game;
    game.endgame = true;
    game.lives = 0;
    // EG_TIMING=1: ms a day by step (harness mark()); the endgame's share is in the summary
    if (ENV.EG_TIMING) game.timing = {};
    Scenarios.apply(game.player, game.world, { origin: ORIGIN });
    const stats = {};
    const rows = [];
    const events = [];
    const ev = (kind, data) => { const e = { y: r2(game.world.day / Y), ...data, kind }; events.push(e); out(`  [${seed}] y${e.y.toFixed(1)} ${kind} ${JSON.stringify(data)}`); };
    game._ev = ev;
    const seenCodes = new Set(aiCodes(game.world));
    let lastPhase = LastCrisis.state(game.world).phase;
    let succSeen = CrownSuccession.state(game.player).history.length;
    let hcStats = { ...HighCrowns.state(game.player).stats };
    const bit = {};
    const probes = [];
    const hist = [];
    const realmsAtStart = game.world.kingdoms.filter(k => k && k.isAlive).length;
    let t0 = performance.now();
    let msYear = [];
    for (let i = 0; i < YEARS * Y; i++) {
        const { world } = game;
        botDay(game, stats);
        if (world.day % 7 === 3) {
            if (MODE === 'grow') growWeek(game, stats);
            if (MODE === 'grow' && ENV.EG_CLAIMS !== '0') claimWeek(game, stats);
            if (prepared(game)) prepWeek(game, stats);
        }
        const res = endDay(game);
        const player = game.player;
        // The dangers of a long life: kin accused, wagers, champions wanted (player/ordeals.js)
        for (const n of (game.ordealsDay && game.ordealsDay.notices) || []) {
            const key = `ordeal:${n.title}`;
            stats[key] = (stats[key] || 0) + 1;
        }
        // (the last days of a life, to see how a starvation came about — EG_VERBOSE)
        hist.push(`d${world.day} g${Math.round(player.gold)} h${Math.round(player.health)} f${player.getFoodCount()} s${player.starvationDays || 0} hu${player.needs ? Math.round(player.needs.hunger) : '-'} th${(() => { try { const w = Thirst.state(player); return `${Math.round(w.thirst)}/${w.held}`; } catch (e) { return '-'; } })()}${player.jailState ? ' JAIL' : ''}${player.boardedShip != null ? ' SHIP' : ''}${game.trek ? ' trek' : ''} @${player.q},${player.r}${(() => { const t = world.getTile(player.q, player.r); if (!t || !t.settlement) return '';
            // (in town: what bread and grain stand on the stalls, and at what price)
            let m = '';
            try {
                const goods = Trading.getAvailableGoods(t.settlement, t, world);
                m = ['bread', 'grain', 'fish'].map(id => { const g = goods.find(x => x.id === id); return g ? `${id[0]}${g.quantity}@${Math.round(g.price)}` : `${id[0]}-`; }).join(',');
            } catch (e) { m = 'err'; }
            return `(${t.settlement.type} ${m})`; })()} bought${stats.foodBought || 0}`);
        if (hist.length > 14) hist.shift();
        // ── events ──
        const lc = LastCrisis.state(world);
        if (lc.phase !== lastPhase) {
            const m = LastCrisis.measure(world, player);
            ev('lastCrisis', { from: lastPhase, to: lc.phase, what: lc.trial ? lc.trial.kind : null, age: lc.age ? `${lc.age.kind}:${lc.age.name}` : null, townShare: m.townShare, mightShare: m.mightShare });
            lastPhase = lc.phase;
        }
        const cs = CrownSuccession.state(player);
        if (cs.history.length !== succSeen) {
            for (const rec of cs.history.slice(Math.max(0, succSeen > cs.history.length ? 0 : succSeen))) {
                // (the succession is the late ruler's: was the dying life the preparing kind, and did it prepare?)
                ev('succession', { outcome: rec.outcome, standing: rec.standing, claimant: rec.claimant ? `${rec.claimant.kind}:${rec.claimant.strength}` : null, prepared: game.diedPrepared || null });
            }
            succSeen = cs.history.length;
        }
        const cw = Throne.state(player).civilWar;
        if (!!cw !== !!game._cwWas) { ev(cw ? 'civilWar.begun' : 'civilWar.ended', { realm: cw ? cw.kingdomName : game._cwWas, crowns: HighCrowns.crownsOf(player, world).length }); game._cwWas = cw ? cw.kingdomName : null; }
        const hs = HighCrowns.state(player).stats;
        for (const key of ['won', 'broken', 'usurped', 'released', 'partitioned', 'coronations']) {
            if ((hs[key] || 0) > (hcStats[key] || 0)) ev(`farCrown.${key}`, { n: hs[key] });
        }
        hcStats = { ...hs };
        if (world.day % 30 === 0) {
            for (const c of aiCodes(world)) if (!seenCodes.has(c)) { seenCodes.add(c); ev('lawCode', { code: c }); }
        }
        if (res.died) {
            const before = player.name;
            const diedAge = Math.round(player.age || 0);
            const crowned = !!Throne.ruledKingdom(player, world);
            const pre = prepared(game);
            // (what the dying ruler had readied: the heir crowned, lords sworn)
            const home0 = Throne.ruledKingdom(player, world);
            const prep0 = home0 ? CrownSuccession.prep(player, home0.id) : null;
            const court0 = Kingship.court(player);
            game.diedPrepared = home0 ? { mode: pre, crowned: !!(prep0 && prep0.crowned), sworn: court0 ? court0.vassals.filter(v => v.heirOath).length : 0, lords: court0 ? court0.vassals.length : 0, grownSons: (player.children || []).filter(c => c && c.isAlive !== false && !c.isSibling && c.id !== player.heir && (c.age || 0) >= 16).length } : null;
            const next = carryOn(game, res.died);
            game.lives++;
            ev('death', { who: before, age: diedAge, crowned, cause: res.died, next: next.how, prepared: pre });
            if (ENV.EG_VERBOSE && (res.died === 'starvation' || res.died === 'thirst')) out(`  [${seed}] last days: ${hist.join(' | ')}`);
            hist.length = 0;
            if (!next.how) break;
            if (game.player !== player) { succSeen = CrownSuccession.state(game.player).history.length; hcStats = { ...HighCrowns.state(game.player).stats }; }
        }
        // EG_TRACE=1: the purse's month, by what moved it (harness and bot ledger), where and with whom
        if (ENV.EG_TRACE && world.day % 30 === 0) {
            const p = game.player;
            const L = game.ledger || {};
            const last = game._ledgerLast || {};
            const moved = Object.keys(L).map(k => [k, (L[k] || 0) - (last[k] || 0)]).filter(([, v]) => v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10);
            game._ledgerLast = { ...L };
            const hk = Throne.ruledKingdom(p, world);
            const dCap = hk && hk.capital ? Hex.wrappingDistance(p.q, p.r, hk.capital.q, hk.capital.r, world.width) : '-';
            const guard = (p.army || []).filter(u => u && u.realmGuard != null).length;
            const far = Object.values(HighCrowns.state(p).crowns || {}).map(e => { const fk = world.getKingdom(e.kingdomId); return `${e.kingdomId}:sep${Math.round(e.separatism)}/seen${world.day - (e.lastPresentDay || 0)}d/d${fk && fk.capital ? Hex.wrappingDistance(p.q, p.r, fk.capital.q, fk.capital.r, world.width) : '-'}`; }).join(' ');
            out(`  [${seed}] T d${world.day} ${far ? `FAR[${far}] prog ${game.progress ? `${game.progress.kingdomId}<${game.progress.until}` : '-'} pd${stats.progressDays || 0}/nw${stats.progressNoWay || 0} ` : ''}${Math.round(p.gold)}g f${p.getFoodCount()} h${Math.round(p.health)} dCap ${dCap} army ${(p.army || []).length}(${guard}g) treas ${hk ? Math.round(hk.treasury) : '-'}${hk ? (() => { const l = CrownBooks.lines(hk, 'last'); const top = Object.entries(l).filter(([, v]) => typeof v === 'number' && Math.abs(v) >= 1).map(([k, v]) => `${k}:${Math.round(v)}`).join(' '); return ` rev ${Math.round(CrownBooks.lastRevenue(hk))} upk ${Math.round(CrownBooks.upkeep(hk))} lvl ${CrownBooks.state(hk).level} court ${CrownBooks.state(hk).courtLevel} wars ${(hk.wars || []).length} mil ${Math.round(hk.military)} [${top}]`; })() : ''} | ${moved.map(([k, v]) => `${k} ${v}`).join(', ')}`);
        }
        // EG_DUMP=day: the home realm's towns' food on that day (a dearth, or the bot's?)
        if (ENV.EG_DUMP && world.day === Number(ENV.EG_DUMP)) {
            const p = game.player;
            const hk = Throne.ruledKingdom(p, world);
            const edible = p.constructor.FOOD_TYPES || [];
            out(`  [${seed}] DUMP d${world.day} at ${p.q},${p.r} home ${hk ? hk.name : '-'} cap ${hk && hk.capital ? `${hk.capital.q},${hk.capital.r}` : '-'} houses ${(p.houses || []).map(h => `${h.q},${h.r}${h.keptBy != null ? 'K' : ''}`).join(' ')} larders ${Object.values((p.household && p.household.homes) || {}).map(h => `${h.q},${h.r}:${JSON.stringify(h.larder)}`).join(' ')} crisis ${Crises.active(world) ? JSON.stringify(Crises.state(world).active.kind) : '-'}`);
            for (const sv of world.getSettlementViews()) {
                const t = world.getTile(sv.q, sv.r);
                if (!t || !t.settlement || (hk && t.settlement.kingdom !== hk.id && Hex.wrappingDistance(p.q, p.r, sv.q, sv.r, world.width) > 8)) continue;
                const st = t.settlement;
                const food = edible.filter(id => SettlementMarket.stock(st, id) > 0).map(id => `${id}:${Math.round(SettlementMarket.stock(st, id))}`).join(',');
                out(`    ${sv.q},${sv.r} ${st.type} ${st.name} k${st.kingdom} pop ${Math.round(st.population)} d${Hex.wrappingDistance(p.q, p.r, sv.q, sv.r, world.width)} food[${food}]`);
            }
        }
        // ── the year ──
        if ((i + 1) % Y === 0) {
            const now = performance.now();
            const ms = (now - t0) / Y;
            msYear.push(ms);
            t0 = now;
            const p = game.player;
            const w = game.world;
            const year = (i + 1) / Y;
            const m = LastCrisis.measure(w, p);
            const st = LastCrisis.state(w);
            const home = Throne.ruledKingdom(p, w);
            const rd = home ? RealmDecline.state(p) : null;
            const reignY = home && p.throne && p.throne.ruling ? r2((w.day - (p.throne.ruling.since || 0)) / Y) : null;
            const strains = rd ? Object.fromEntries(STRAINS.map(id => [id, Math.round(rd.strains[id])])) : null;
            if (strains) {
                for (const id of STRAINS) {
                    for (const at of [20, 40, 70]) {
                        const key = `${id}@${at}`;
                        if (!bit[key] && strains[id] >= at) { bit[key] = { year, reignY }; }
                    }
                }
            }
            const crowns = HighCrowns.crownsOf(p, w);
            const sep = crowns.filter(c => !c.home).map(c => Math.round(c.separatism));
            const aiDecl = w.kingdoms.filter(k => k && k.isAlive && k.decline && !k.decline.player).map(k => Math.round(k.decline.s || 0));
            const row = {
                year, ms: Math.round(ms), realms: w.kingdoms.filter(k => k && k.isAlive).length, home: home ? home.name : null, reignY,
                towns: `${m.myTowns}/${m.allTowns}`, townShare: m.townShare, mightShare: m.mightShare, prog: m.progress, dom: m.dominant,
                held: Math.round((st.held || 0) / Y * 10) / 10, need: Math.round((st.need || 0) / Y * 10) / 10, phase: st.phase,
                strains, crowns: crowns.length, sep, emperor: HighCrowns.isEmperor(p), crisis: Crises.active(w) ? (Crises.state(w).active.kind || 'yes') : null,
                aiDecl: aiDecl.length ? `${Math.min(...aiDecl)}-${Math.max(...aiDecl)}` : '', stab: home ? Math.round(home.stability) : null,
                mil: home ? Math.round(home.military) : null,
                gold: Math.round(p.gold || 0), army: Math.round(PlayerMilitary.getArmyStrength(p)), prestige: Math.round(House.getPrestige(p)), age: Math.round(p.age || 0),
                lead: m.lead, rivalTowns: m.rivalTowns, power: Math.round(m.power || 0),
                pressure: rd ? Object.fromEntries(STRAINS.map(id => [id, Math.round(rd.pressure[id] || 0)])) : null,
                parts: home && rd ? (() => {
                    try {
                        const P = RealmDecline.pressures(p, w, home);
                        return Object.fromEntries(STRAINS.map(id => [id, (P[id].parts || []).map(x => `${x.label.replace(/\s*\(.*\)/, '').slice(0, 24)}=${x.value}`).join('; ')]));
                    } catch (e) { return null; }
                })() : null,
            };
            rows.push(row);
            out(`[${seed}] y${year} ${row.ms}ms realms ${row.realms} ${row.home || '-'} r${reignY} towns ${row.towns} (rival ${row.rivalTowns}, lead ${row.lead}) ts ${row.townShare} ms ${row.mightShare} prog ${row.prog}${row.dom ? ' DOM' : ''} held ${row.held}/${row.need} ${row.phase} | ${strains ? STRAINS.map(id => `${id[0]}${strains[id]}/${row.pressure[id]}`).join(' ') : '-'} stab ${row.stab} | crowns ${row.crowns}${sep.length ? ` sep ${sep.join(',')}` : ''}${row.emperor ? ' EMP' : ''}${row.crisis ? ` crisis:${row.crisis}` : ''} ai ${row.aiDecl} | ${row.gold}g army ${row.army} pr ${row.prestige} age ${row.age}`);
            if (year % 5 === 0) {
                const pr = probeSuccession(game);
                if (pr) { probes.push({ year, ...pr }); out(`  [${seed}] probe y${year} ${JSON.stringify(pr)}`); }
            }
        }
    }
    // Peasant risings across the world (systems/peasantRevolts.js), by realm
    const pr = PeasantRevolts.state(game.world);
    const byRealm = {};
    for (const h of pr.history || []) { const k = h.kingdomId || h.realm || h.kingdom || '?'; byRealm[k] = (byRealm[k] || 0) + (h.kind === 'risen' || h.kind === 'rise' || /ris/.test(String(h.kind)) ? 1 : 0); }
    const summary = {
        risings: { ...pr.stats, realms: realmsAtStart, perRealmCentury: r2((pr.stats.risen || 0) / Math.max(1, realmsAtStart) / Math.max(0.01, rows.length / 100)), byRealm },
        roadMaims: game._roadMaims || [],
        seed, map: MAP, mode: MODE, prep: PREP, realmsAtStart, years: rows.length,
        msPerDay: Math.round(msYear.reduce((a, b) => a + b, 0) / Math.max(1, msYear.length)),
        lastMs: Math.round(msYear.slice(-10).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(10, msYear.length))),
        firstDominantYear: (rows.find(r => r.dom) || {}).year || null,
        dominantYears: rows.filter(r => r.dom).length,
        peakTownShare: Math.max(0, ...rows.map(r => r.townShare)),
        bit,
        lastCrisis: events.filter(e => e.kind === 'lastCrisis'),
        successions: events.filter(e => e.kind === 'succession'),
        far: events.filter(e => e.kind.startsWith('farCrown')),
        codes: events.filter(e => e.kind === 'lawCode').length,
        deaths: events.filter(e => e.kind === 'death').length,
        stats,
        timing: game.timing ? Object.fromEntries(Object.entries(game.timing).filter(([k]) => /LastCrisis|RealmDecline|HighCrowns|CrownSuccession|NamedLegacy|Kingship|world.advanceDay/.test(k)).map(([k, v]) => [k, r2(v / Math.max(1, rows.length * Y))])) : null,
    };
    out(`SUMMARY ${JSON.stringify(summary)}`);
    if (ENV.EG_OUT) {
        try {
            fs.mkdirSync(ENV.EG_OUT, { recursive: true });
            fs.writeFileSync(path.join(ENV.EG_OUT, `eg_${MAP}_${MODE}_${ORIGIN}_${PREP}_${seed}.json`), JSON.stringify({ summary, rows, events, probes }, null, 1));
        } catch (e) { out(`(could not write: ${e.message})`); }
    }
    return summary;
}

describe.skipIf(!ON)('endgame soak (EG_SOAK=1)', () => {
    for (const seed of SEEDS) {
        it(`seed ${seed}: ${YEARS} years, ${MAP} map, ${ORIGIN}, ${MODE}`, () => {
            const s = runOne(seed);
            expect(s.years).toBeGreaterThan(0);
        }, Math.max(600000, YEARS * Y * 600));
    }
});

// ── The far-crown soak (EG_FAR=1) ──
const FAR = !!ENV.EG_FAR;
const FY = Number(ENV.EG_FAR_YEARS || 40);

function farRun(seed, mode) {
    Utils.setSeed(seed);
    const world = new World(60, 40);
    world.generate({ kingdomCount: 5 });
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 30,
        gold: 50000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [],
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        relationships: {}, actionPoints: 10, army: [], q: -999, r: -999,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    player.house.prestige = 400;
    const all = world.getAllSettlements();
    const rs = world.kingdoms.filter(k => k.isAlive && all.filter(s => s.kingdom === k.id).length >= 2);
    const [home, far] = rs;
    Throne._takeThrone(player, world, home);
    player.q = home.capital.q; player.r = home.capital.r;
    Throne.state(player).civilWar = { kingdomId: far.id, levies: 0 };
    Throne._crown(player, world, far, ENV.EG_FAR_HOW || 'won');
    const entry = () => HighCrowns.unionCrown(player, far.id);
    if (mode === 'tend') {
        const c = HighCrowns.candidates(player, world, far.id).find(x => x.kind === 'native') || HighCrowns.candidates(player, world, far.id)[0];
        if (c) HighCrowns.appoint(player, world, far.id, c.kind, c.id);
        HighCrowns.proclaimDecree(player, world, far.id, 'charter');
    }
    const st = HighCrowns.state(player);
    let maxSep = 0, minLoy = 100, rows = [];
    let outcome = 'held', when = null;
    const startDay = world.day;
    for (let d = 0; d < FY * 120; d++) {
        if (mode === 'tend' || mode === 'light') {
            // a royal progress: 30 days in the far capital every second year; honour the viceroy each year
            const y = Math.floor(d / 120);
            const inFar = y % 2 === 1 && d % 120 < 30;
            const at = inFar ? far.capital : home.capital;
            player.q = at.q; player.r = at.r;
            if (mode === 'tend' && d % 120 === 60 && entry()) HighCrowns.favour(player, world, far.id, 'honour');
            player.house.prestige = Math.max(player.house.prestige, 300);
        }
        world.advanceDay(player);
        Kingship.processDay(world, player);
        HighCrowns.processDay(world, player);
        const e = entry();
        if (!e) {
            outcome = st.stats.usurped ? 'coup' : st.stats.broken ? 'lords' : 'gone';
            when = Math.round((world.day - startDay) / 12) / 10;
            break;
        }
        maxSep = Math.max(maxSep, e.separatism);
        if (e.viceroy) minLoy = Math.min(minLoy, e.viceroy.loyalty);
        if (d % 240 === 0) {
            const c = e.court || {};
            rows.push(`y${d / 120}:sep${Math.round(e.separatism)} loy${e.viceroy ? e.viceroy.loyalty : '-'}/amb${e.viceroy ? Math.round(e.viceroy.ambition) : '-'} plot${e.viceroy ? Math.round(e.viceroy.plot || 0) : '-'} fac${(c.factions || []).length}${(c.factions || []).some(f => f.demand && f.demand.type === 'nativeKing') ? 'N' : ''}${c.revolt ? 'R' : ''} op${c.vassals && c.vassals.length ? Math.round(c.vassals.reduce((s, v) => s + (v.opinion || 0), 0) / c.vassals.length) : '-'} stab${Math.round(far.stability)}`);
        }
    }
    process.stdout.write(`FAR seed ${seed} ${mode} → ${outcome}${when != null ? ` at y${when}` : ''} (vk ${st.crowns && Object.values(st.crowns)[0] ? (Object.values(st.crowns)[0].viceroy || {}).kind : '-'}) maxSep ${Math.round(maxSep)} minLoy ${minLoy} | ${rows.join(' ')}\n`);
    return outcome;
}


describe.skipIf(!FAR)('far-crown soak (EG_FAR=1)', () => {
    beforeAll(async () => {
        if (!DataLoader._gamedata) { DataLoader.clearCache(); await DataLoader.initializeAll(); }
        logSpy = logSpy || vi.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = warnSpy || vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    it('neglected, lightly kept and tended far crowns', () => {
        const tally = {};
        for (const mode of (ENV.EG_FAR_MODES || 'neglect,light,tend').split(',')) {
            for (const s of (ENV.EG_FAR_SEEDS || '11,12,13,15,16,17,18,19').split(',').map(Number)) {
                const o = farRun(s, mode);
                tally[`${mode}:${o}`] = (tally[`${mode}:${o}`] || 0) + 1;
            }
        }
        process.stdout.write(`TALLY ${JSON.stringify(tally)}
`);
        expect(Object.keys(tally).length).toBeGreaterThan(0);
    }, 3600000);
});
