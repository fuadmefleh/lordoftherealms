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
//   EG_RUN=n             a second run of the same seed: the bot's own steps (botDay, growWeek,
//                        claimWeek, prepWeek) draw from a stream salted by n, the world's day
//                        from the seed's (the same map and realms, a different life); 0/unset as before
//   EG_MILTRACE=1        each year, who moved the home realm's soldiers, people, treasury and
//                        towns (setters on kingdom.military / treasury, settlement.population /
//                        kingdom, tallied by caller) beside the AI realms' average; its wars (who
//                        declared, battles won and lost), every realm's regard for it, its coin by
//                        holder (CoinCensus), its towns' purses and the court NPCs' purses (slow: ~3x)
//   EG_DAYLOG=from-to    the bot's day, step by step, between those days (where, fed, headed, counted)
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
import { MoneySupply } from '../world/moneySupply.js';
import { Fiscal } from '../systems/fiscal.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { RealmArms } from '../world/realmArms.js';
import { KingdomBonuses, LordInfluence } from '../world/kingdomState.js';
import { KingdomAtlas } from '../world/kingdomAtlas.js';

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
const RUN = Math.floor(Number(ENV.EG_RUN) || 0);
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
    // One war at a time, on a near realm we clearly outweigh, from a realm ready for it: its
    // ranks refilled, its chests a month deep, its people settled, no claim's war afoot, and a
    // season since its last war. (Before 2026-11-24 it marched every fourth week on any realm
    // whose army was a little smaller, counting neither its people — what refills an army —
    // nor the walls it must storm: its realm was at war two days in three, and bled.)
    const free = (home.wars || []).length === 0 && !Throne.state(player).civilWar;
    if (!free) game.lastWarDay = world.day;
    if (free && world.day % 28 === 3 && world.day - (game.lastWarDay || 0) >= 120) {
        const might = (k) => (k.military || 0) + (k.population || 0) * 0.1;
        const ready = (home.military || 0) >= 0.85 * (home.militaryCap || 0) && (home.stability || 0) >= 45 && Fiscal.reserveDays(home) >= 30;
        const ours = might(home) + armyStrength;
        const near = (k) => home.capital && k.capital && Hex.wrappingDistance(home.capital.q, home.capital.r, k.capital.q, k.capital.r, world.width) <= 28;
        const prey = ready ? world.kingdoms.filter(k => k && k.isAlive && k.id !== home.id && !(home.allies || []).includes(k.id) && near(k)
            && !KingdomAI.hasTruce(home, k, world) && !HighCrowns.unionCrown(player, k.id) && might(k) * 1.6 < ours && (k.wars || []).length < 2)
            .sort((a, b) => might(a) - might(b))[0] : null;
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
    // (the banners only from a realm at peace and ready for a war: ranks near full, a fortnight's
    // spending in the chests, its people settled — the claim's civil war is a war, and its guard
    // fights it. Before 2026-11-25 the bot raised them whenever the claim allowed, its own realm
    // at war or bled white: a seed-303 king fought a far crown's loyalists while a holy war took
    // his own capital.)
    const notReady = (home.wars || []).length ? 'atWar' : (home.military || 0) < 0.8 * (home.militaryCap || 0) ? 'ranks'
        : (home.stability || 0) < 45 ? 'unrest' : Fiscal.reserveDays(home) < 15 ? 'chests' : null;
    if (notReady) { stats[`pressNo_home_${notReady}`] = (stats[`pressNo_home_${notReady}`] || 0) + 1; return; }
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

// EG_MILTRACE=1: who moves each realm's soldiers (kingdom.military) and people
// (settlement.population), tallied by caller over each year — the home realm
// beside the AI realms' average — and the realms' books at each year's end
const _frame = (l) => {
    const m = /at (?:(\S+) )?\(?(?:.*[\\/])?([^\\/]+?):(\d+):\d+\)?$/.exec(String(l || '').trim());
    return m ? `${m[1] || '?'}@${m[2]}:${m[3]}` : String(l || '').trim();
};
const _who = () => { const s = new Error().stack.split('\n'); return `${_frame(s[3])} < ${_frame(s[4])}`; };
let _mtGame = null;
function _mtPatch() {
    if (KingdomAI._mtPatched) return;
    KingdomAI._mtPatched = true;
    const homeId = () => { const g = _mtGame; const h = g && Throne.ruledKingdom(g.player, g.world); return h ? h.id : null; };
    const tally = (key, n = 1) => { const T = _mtGame && _mtGame._milT; if (T) T.war[key] = (T.war[key] || 0) + n; };
    const sw = KingdomAI.startWar;
    KingdomAI.startWar = function (a, b, world) {
        const h = homeId();
        // every realm's new wars by target (the home realm's rate beside an AI realm's)
        if (h != null && !(a.wars || []).includes(b.id)) {
            const T = _mtGame && _mtGame._milT;
            if (T) {
                if (!T.declOn) T.declOn = {};
                const f = _frame(new Error().stack.split('\n')[2]).replace(/^Object\./, '').replace(/@.*$/, '');
                const e = T.declOn[b.id] || (T.declOn[b.id] = { n: 0 });
                e.n++;
                e[f] = (e[f] || 0) + 1;
            }
        }
        if (h != null && (a.id === h || b.id === h) && !(a.wars || []).includes(b.id)) {
            tally(`${a.id === h ? 'homeDeclared' : 'declaredOnHome'} ${_frame(new Error().stack.split('\n')[2])}`);
            tally(`war vs ${a.id === h ? b.id : a.id}`);
        }
        return sw.call(KingdomAI, a, b, world);
    };
    const ew = KingdomAI.endWar;
    KingdomAI.endWar = function (a, b, world, opts = {}) {
        const h = homeId();
        if (h != null && (a.id === h || b.id === h)) tally(`end ${opts.victor ? (opts.victor.id === h ? 'homeWon' : 'homeLost') : 'white'}${opts.tribute ? ' capit' : ''}`);
        return ew.call(KingdomAI, a, b, world, opts);
    };
    const sb = KingdomAI.simulateBattle;
    KingdomAI.simulateBattle = function (att, def, world) {
        const h = homeId();
        const side = h == null ? null : att.id === h ? 'att' : def.id === h ? 'def' : null;
        if (!side) { tally('aiBattles'); return sb.call(KingdomAI, att, def, world); }
        const ma = att.military, md = def.military;
        // the battle's multipliers, home beside its foe (summed; the year's line divides by the count)
        {
            const T = _mtGame._milT;
            const hk = side === 'att' ? att : def;
            const fk = side === 'att' ? def : att;
            const f = (k, o) => ({
                arms: RealmArms.factor(k), cmd: KingdomAI.fieldCommandMult(k, world), morale: KingdomAI._moraleBonus(k, world),
                war: 1 + KingdomBonuses.get(k, 'warBonus'), defense: KingdomBonuses.get(k, 'defense') + LordInfluence.mod(k, 'defense'),
                atlas: KingdomAtlas.campaignMultiplier(k, o.id), appetite: LordInfluence.warAppetite(k),
            });
            const bf = T.bf || (T.bf = { n: 0, home: {}, foe: {} });
            bf.n++;
            for (const [who, k, o] of [['home', hk, fk], ['foe', fk, hk]]) for (const [key, v] of Object.entries(f(k, o))) bf[who][key] = (bf[who][key] || 0) + (Number(v) || 0);
        }
        const r = sb.call(KingdomAI, att, def, world);
        // (the attacker keeps ≥95% of its men when it wins, ≤85% when it loses)
        const attWon = ma > 0 ? att.military / ma > 0.9 : false;
        const won = side === 'att' ? attWon : !attWon;
        tally(`battle ${side} ${won ? 'won' : 'lost'}`);
        tally(`battle ratio x100 ${side}`, Math.round(100 * (side === 'att' ? ma / Math.max(1, md) : md / Math.max(1, ma))));
        return r;
    };
    const dw = Throne.declareRealmWar;
    Throne.declareRealmWar = function (...args) { const r = dw.apply(Throne, args); if (r && r.success) tally('bot growWeek declares'); return r; };
}
function milTraceHook(game) {
    _mtGame = game;
    _mtPatch();
    const T = game._milT || (game._milT = { mil: {}, pop: {}, war: {} });
    if (!T.war) T.war = {};
    const hk = Throne.ruledKingdom(game.player, game.world);
    // (the home armoury's body armour, by who moves it: a Proxy on its stock — the slot most often short)
    if (hk) {
        const a = RealmArms.state(hk);
        if (!game._armProxied) game._armProxied = new WeakSet();
        if (!game._armProxied.has(a.stock)) {
            const body = new Set((RealmArms.config().slots || {}).body || []);
            const raw = a.stock;
            a.stock = new Proxy(raw, {
                set(t, key, v) {
                    if (body.has(key)) {
                        const d = (Number(v) || 0) - (Number(t[key]) || 0);
                        if (d && Number.isFinite(d)) { if (!T.armBody) T.armBody = {}; const kk = `${d > 0 ? '+' : '-'} ${_who()}`; T.armBody[kk] = (T.armBody[kk] || 0) + d; }
                    }
                    t[key] = v;
                    return true;
                },
            });
            game._armProxied.add(a.stock);
        }
    }
    // (every realm's regard for the home realm, by who moves it: a Proxy on each relations book)
    if (!T.rel) T.rel = {};
    if (!game._relProxied) game._relProxied = new WeakSet();
    for (const k of game.world.kingdoms || []) {
        if (!k || !k.relations || game._relProxied.has(k.relations)) continue;
        const book = new Proxy(k.relations, {
            set(o, key, nv) {
                const h = Throne.ruledKingdom(game.player, game.world);
                if (h && String(key) === String(h.id) && k.id !== h.id) {
                    const d = (Number(nv) || 0) - (Number(o[key]) || 0);
                    if (d) { const w = _who(); T.rel[w] = (T.rel[w] || 0) + d; }
                }
                o[key] = nv;
                return true;
            },
        });
        game._relProxied.add(book);
        k.relations = book;
    }
    if (!T.wd) T.wd = {};
    for (const k of game.world.kingdoms || []) if (k && k.isAlive && (k.wars || []).length) T.wd[k.id] = (T.wd[k.id] || 0) + 1;
    if (hk && (hk.wars || []).length) T.war.homeWarDays = (T.war.homeWarDays || 0) + 1;
    if (hk && (hk.wars || []).length > 1) T.war.homeMultiWarDays = (T.war.homeMultiWarDays || 0) + 1;
    const w = game.world;
    const home = () => { const h = Throne.ruledKingdom(game.player, game.world); return h ? h.id : null; };
    const side = (kid) => (kid != null && kid === home() ? 'home' : 'ai');
    const add = (bag, key, d) => { bag[key] = (bag[key] || 0) + d; };
    for (const k of w.kingdoms || []) {
        if (!k || Object.prototype.hasOwnProperty.call(k, '_milHook')) continue;
        let v = k.military;
        Object.defineProperty(k, '_milHook', { value: true, enumerable: false });
        Object.defineProperty(k, 'military', {
            enumerable: true, configurable: true,
            get() { return v; },
            set(nv) {
                const d = (Number(nv) || 0) - (Number(v) || 0);
                if (d && Number.isFinite(d)) add(T.mil[side(k.id)] || (T.mil[side(k.id)] = {}), _who(), d);
                v = nv;
            },
        });
        let tv = k.treasury;
        Object.defineProperty(k, 'treasury', {
            enumerable: true, configurable: true,
            get() { return tv; },
            set(nv) {
                const d = (Number(nv) || 0) - (Number(tv) || 0);
                if (d && Number.isFinite(d)) { if (!T.gold) T.gold = {}; add(T.gold[side(k.id)] || (T.gold[side(k.id)] = {}), _who(), d); }
                tv = nv;
            },
        });
    }
    if (w.day % 30 !== 0 && game._milPopHooked) return;
    game._milPopHooked = true;
    for (let r = 0; r < w.height; r++) {
        for (let q = 0; q < w.width; q++) {
            const t = w.tiles[r] && w.tiles[r][q];
            const s = t && t.settlement;
            if (!s || Object.prototype.hasOwnProperty.call(s, '_popHook')) continue;
            let v = s.population;
            Object.defineProperty(s, '_popHook', { value: true, enumerable: false });
            Object.defineProperty(s, 'population', {
                enumerable: true, configurable: true,
                get() { return v; },
                set(nv) {
                    const d = (Number(nv) || 0) - (Number(v) || 0);
                    if (d && Number.isFinite(d)) add(T.pop[side(s.kingdom)] || (T.pop[side(s.kingdom)] = {}), _who(), d);
                    v = nv;
                },
            });
            // (a town changing hands: who handed it over, and its people)
            let kv = s.kingdom;
            Object.defineProperty(s, 'kingdom', {
                enumerable: true, configurable: true,
                get() { return kv; },
                set(nv) {
                    const h = home();
                    if (h != null && nv !== kv && (kv === h || nv === h)) {
                        if (!T.towns) T.towns = {};
                        const key = `${kv === h ? 'LOST' : 'GAINED'} ${_who()}`;
                        T.towns[key] = (T.towns[key] || 0) + Math.round(Number(v) || 0);
                    }
                    kv = nv;
                },
            });
        }
    }
}
function milTraceYear(game, seed, year) {
    const T = game._milT;
    if (!T) return;
    const w = game.world;
    const h = Throne.ruledKingdom(game.player, w);
    const ais = w.kingdoms.filter(k => k && k.isAlive && (!h || k.id !== h.id)).length || 1;
    const towns = (kid) => w.getSettlementViews().filter(s => s.kingdom === kid && s.type !== 'village').length;
    const books = (k) => { const f = k.fisc || {}; return `${k.id} pop ${Math.round(k.population)} towns ${towns(k.id)} mil ${Math.round(k.military)} cap ${k.militaryCap} af ${r2(CrownBooks.armyFactor(k))} pay ${f.armyPay} arr ${f.arrearsDays} lvl ${f.level} treas ${Math.round(k.treasury)} stab ${Math.round(k.stability)} wars ${(k.wars || []).length} coin ${(() => { const R = MoneySupply.realm(w, k.id); return R ? Math.round(R.coin || 0) : '-'; })()} levy ${Math.round((Throne.state(game.player).ruling || {}).levyTotal || 0)} corr ${r2(f.corruption || 0)} mult ${r2(f.mult || 0)} farms ${w.getSettlementViews().filter(v => { const t = w.getTile(v.q, v.r); return t && t.settlement && t.settlement.kingdom === k.id && t.settlement.taxFarm; }).length} st ${JSON.stringify(f.stats || {})}`; };
    out(`  [${seed}] MT y${year} HOME ${h ? books(h) : '-'}`);
    if (h) {
        const R = MoneySupply.realm(w, h.id) || {};
        out(`  [${seed}] MT y${year} HOMECOIN ${JSON.stringify(Object.fromEntries(['coin', 'level', 'towns', 'folk', 'held', 'coffers', 'banks', 'purse', 'pop'].map(x => [x, Math.round((R[x] || 0) * 100) / 100])))}`);
        try {
            const cc = CoinCensus.count(w, game.player);
            const fmt = (o) => Object.entries(o || {}).filter(([, x]) => x >= 1).map(([a, x]) => `${a}:${Math.round(x)}`).join(' ');
            out(`  [${seed}] MT y${year} HOLDERS home ${fmt(cc.get(h.id))}`);
            for (const k of w.kingdoms) if (k && k.isAlive && k !== h) out(`  [${seed}] MT y${year} HOLDERS ${k.id} ${fmt(cc.get(k.id))}`);
            const npcs = Array.isArray(Relationships._npcs) && Relationships._npcs.length ? Relationships._npcs : (game.player._relationshipNpcs || []);
            const top = npcs.filter(n => n && n.isAlive !== false && !n.dead && n.purse > 0).sort((a, b) => b.purse - a.purse).slice(0, 8);
            out(`  [${seed}] MT y${year} NPCPURSES n${npcs.length} ${top.map(n => `${n.name}|${n.occupation || n.role || '-'}|${n.courtOffice || n.office || n.relationshipType || n.relation || '-'}|k${n.kingdomId}|${Math.round(n.purse)}`).join('  ')}`);
            if (!game._purseHooked) game._purseHooked = new WeakSet();
            for (const n of npcs) {
                if (!n || game._purseHooked.has(n)) continue;
                game._purseHooked.add(n);
                let pv = n.purse;
                Object.defineProperty(n, 'purse', {
                    enumerable: true, configurable: true,
                    get() { return pv; },
                    set(nv) { const d = (Number(nv) || 0) - (Number(pv) || 0); if (d && Number.isFinite(d)) { if (!game._milT.npcPurse) game._milT.npcPurse = {}; const k = `${d > 0 ? '+' : '-'} ${_who()}`; game._milT.npcPurse[k] = (game._milT.npcPurse[k] || 0) + d; } pv = nv; },
                });
            }
            out(`  [${seed}] MT y${year} NPCPURSE moves ${Object.entries(game._milT.npcPurse || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 14).map(([k, v]) => `${Math.round(v)} ${k}`).join(' | ')}`);
            game._milT.npcPurse = {};
        } catch (e) { out(`holders: ${e.message}`); }
        const f = h.fisc || {};
        for (const v of w.getSettlementViews()) {
            const t = w.getTile(v.q, v.r);
            const s = t && t.settlement;
            if (!s || s.kingdom !== h.id) continue;
            const key = `${v.q},${v.r}`;
            out(`  [${seed}] MT y${year}   town ${s.name} ${s.type} pop ${Math.round(s.population)} purse ${Math.round((s.economy || {}).gold || 0)} due/d ${r2((f.towns || {})[key] || 0)} happy ${Math.round(s.happiness || 0)} revolt ${s.taxRevolt > w.day ? 'Y' : '-'} pf ${s.provinceFx ? JSON.stringify(s.provinceFx).slice(0, 80) : '-'} farm ${s.taxFarm ? 'Y' : '-'} dmg ${r2(s.damage || 0)}`);
        }
    }
    for (const k of w.kingdoms) if (k && k.isAlive && k !== h) out(`  [${seed}] MT y${year}   ai ${books(k)}`);
    for (const kind of ['mil', 'pop', 'gold']) {
        for (const sd of ['home', 'ai']) {
            const bag = (T[kind] || {})[sd] || {};
            const div = sd === 'ai' ? ais : 1;
            const top = Object.entries(bag).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 14)
                .map(([k, v]) => `${Math.round(v / div)} ${k}`);
            const net = Math.round(Object.values(bag).reduce((a, b) => a + b, 0) / div);
            out(`  [${seed}] MT y${year} ${kind} ${sd}${sd === 'ai' ? '/realm' : ''} net ${net}:\n      ${top.join('\n      ')}`);
        }
    }
    out(`  [${seed}] MT y${year} war ${JSON.stringify(T.war)}`);
    if (h) {
        const others = w.kingdoms.filter(k => k && k.isAlive && k !== h);
        const toHome = others.map(k => Math.round((k.relations || {})[h.id] || 0));
        const amongAi = [];
        for (const a of others) for (const b of others) if (a !== b) amongAi.push((a.relations || {})[b.id] || 0);
        out(`  [${seed}] MT y${year} rel toHome [${toHome.join(',')}] avgAI-AI ${Math.round(amongAi.reduce((s, v) => s + v, 0) / Math.max(1, amongAi.length))}`);
        out(`  [${seed}] MT y${year} rel moves: ${Object.entries(T.rel || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 12).map(([k, v]) => `${Math.round(v)} ${k}`).join(' | ')}`);
    }
    out(`  [${seed}] MT y${year} townsMoved ${JSON.stringify(T.towns || {})}`);
    T.towns = {};
    out(`  [${seed}] MT y${year} warDays ${JSON.stringify(T.wd || {})}`);
    out(`  [${seed}] MT y${year} declOn ${JSON.stringify(T.declOn || {})}`);
    if (T.bf && T.bf.n) {
        const avg = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(100 * v / T.bf.n) / 100]));
        out(`  [${seed}] MT y${year} battleFactors n${T.bf.n} home ${JSON.stringify(avg(T.bf.home))} foe ${JSON.stringify(avg(T.bf.foe))}`);
    }
    T.bf = null;
    // the armouries: the home realm's beside the AI realms' (factor, men, kits held vs needed, coin spent, pieces bought / lost / stripped)
    {
        const arm = (k) => {
            const a = k.armoury || {};
            const st = a.stats || {};
            const prev = (T.armPrev || (T.armPrev = {}))[k.id] || {};
            const d = (x) => Math.round((st[x] || 0) - (prev[x] || 0));
            T.armPrev[k.id] = { ...st };
            const need = RealmArms.need(k);
            const held = RealmArms.held(k);
            return `${k.id}:f${RealmArms.factor(k)} men${Math.round(k.military || 0)} towns${towns(k.id)} treas${Math.round(k.treasury || 0)} body${Math.round(held.body.n)}/${Math.round(need.kits)} spent${d('spent')} bought${d('bought')} lost${d('lost')} strip${d('stripped')} worn${d('worn')} imp${d('imported')} short${JSON.stringify(Object.fromEntries(Object.entries(RealmArms.deficits(k)).filter(([, v]) => v > 0)))}`;
        };
        const ai = w.kingdoms.filter(k => k && k.isAlive && k !== h);
        out(`  [${seed}] MT y${year} ARMS home ${h ? arm(h) : '-'} | ai ${ai.map(arm).join(' ')}`);
        out(`  [${seed}] MT y${year} ARMSBODY ${Object.entries(T.armBody || {}).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 12).map(([k, v]) => `${Math.round(v)} ${k}`).join(' | ')}`);
        T.armBody = {};
        if (h) {
            const m = Kingship.councillor(game.player, w, 'marshal');
            const be = Kingship.battleEffect(game.player, w);
            out(`  [${seed}] MT y${year} MARSHAL ${m ? `${m.name} (${m.kind}) comp ${m.competence} loy ${m.loyalty} war +${r2(be.marshal.warBonus)} def +${r2(be.marshal.defense)}` : 'vacant'} | ruler martial ${be.ruler.martial} war +${r2(be.ruler.warBonus)} def +${r2(be.ruler.defense)}`);
        }
    }
    // each realm's foes (realms whose regard of it is under considerWar's −30) and allies, to set the
    // home realm's wars beside an AI realm's in the same plight
    {
        const alive = w.kingdoms.filter(k => k && k.isAlive);
        const foes = {};
        for (const k of alive) foes[k.id] = `${alive.filter(o => o !== k && ((o.relations || {})[k.id] || 0) < -30).length}f/${(k.allies || []).length}a`;
        out(`  [${seed}] MT y${year} foes ${JSON.stringify(foes)}`);
    }
    T.declOn = {};
    T.mil = {}; T.pop = {}; T.gold = {}; T.war = {}; T.rel = {}; T.wd = {};
}

function runOne(seed) {
    const gen = MAPS[MAP] || {};
    let game = newGame(seed, gen);
    _maimGame = game;
    game.endgame = true;
    game.lives = 0;
    // EG_TIMING=1: ms a day by step (harness mark()); the endgame's share is in the summary
    if (ENV.EG_TIMING) game.timing = {};
    Scenarios.apply(game.player, game.world, { origin: ORIGIN });
    { const h0 = Throne.ruledKingdom(game.player, game.world); game.realm0 = h0 ? h0.id : null; }
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
    // (EG_RUN: the bot's steps on their own salted stream — Utils.withRng puts the world's back)
    const botRng = RUN ? Utils.seededRandom(seed * 7919 + RUN * 104729) : null;
    const asBot = (fn) => (botRng ? Utils.withRng(botRng, fn) : fn());
    let t0 = performance.now();
    let msYear = [];
    for (let i = 0; i < YEARS * Y; i++) {
        const { world } = game;
        if (ENV.EG_MILTRACE) milTraceHook(game);
        // EG_DAYLOG=from-to: the bot's day, step by step (where, fed, headed, what it counted)
        const dl = ENV.EG_DAYLOG ? ENV.EG_DAYLOG.split('-').map(Number) : null;
        const logDay = dl && world.day >= dl[0] && world.day <= dl[1];
        const st0 = logDay ? { ...stats } : null;
        asBot(() => botDay(game, stats));
        if (logDay) {
            const p = game.player;
            const t = world.getTile(p.q, p.r);
            const moved = Object.keys(stats).filter(k => stats[k] !== st0[k]).map(k => `${k}+${Math.round((stats[k] || 0) - (st0[k] || 0))}`).join(',');
            out(`  [${seed}] DAY d${world.day} @${p.q},${p.r}${t && t.settlement ? `(${t.settlement.type} ${t.settlement.name})` : ''} f${p.getFoodCount()} g${Math.round(p.gold)} h${Math.round(p.health)} dest ${game.dest ? `${game.dest.q},${game.dest.r}${game.dest.court ? 'C' : ''}` : '-'} head ${game.headingTo ? `${game.headingTo.q},${game.headingTo.r}` : '-'} cw ${Throne.state(p).civilWar ? 'Y' : '-'} prog ${game.progress ? game.progress.kingdomId : '-'} army ${(p.army || []).length} | ${moved}`);
        }
        if (world.day % 7 === 3) {
            asBot(() => {
                if (MODE === 'grow') growWeek(game, stats);
                if (MODE === 'grow' && ENV.EG_CLAIMS !== '0') claimWeek(game, stats);
                if (prepared(game)) prepWeek(game, stats);
            });
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
                // (the realm the run began in, crowned or not — a life lost with no heir loses the
                // crown, not the realm: its towns and soldiers are counted on)
                realm0: (() => {
                    const k0 = game.realm0 != null ? w.getKingdom(game.realm0) : null;
                    if (!k0) return null;
                    const views = w.getSettlementViews().filter(v => v.kingdom === k0.id);
                    return { alive: k0.isAlive !== false, towns: views.length, pop: Math.round(views.reduce((a, v) => a + (v.population || 0), 0)), mil: Math.round(k0.military || 0), ruled: !!home && home.id === k0.id };
                })(),
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
            if (ENV.EG_MILTRACE) milTraceYear(game, seed, year);
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
            fs.writeFileSync(path.join(ENV.EG_OUT, `eg_${MAP}_${MODE}_${ORIGIN}_${PREP}_${seed}${RUN ? `_r${RUN}` : ''}.json`), JSON.stringify({ summary, rows, events, probes }, null, 1));
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
