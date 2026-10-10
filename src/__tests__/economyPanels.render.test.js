// Render audit of the economy panels and map overlays against REAL game
// states: the headless harness (playtest/harness.js) builds worlds the bot
// has played (early, late, broke, a founded company, covers, shares, leases,
// a guild membership, a crown), and every economy panel of the ActionMenu is
// opened on them. A small crawler then "clicks" every button the panel's HTML
// offers (data-am-act routes and the inline window._xxx / ActionMenu.xxx
// handlers), opening whatever comes next, so each tab and each action handler
// runs with the arguments the real buttons carry. Every panel must build
// without throwing, produce HTML, and leak no "undefined", "NaN",
// "[object Object]", "null" or raw long decimals into what the player reads
// (text, tooltips, notifications). The renderer's map modes (overlays,
// features, the trade map) draw against a stub 2D context that records the
// text it is asked to paint and any non-finite coordinate.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Finance } from '../systems/finance.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Underwriting, KINDS as COVER_KINDS } from '../systems/underwriting.js';
import { Bourse } from '../systems/bourse.js';
import { Guilds } from '../systems/guilds.js';
import { Concessions } from '../systems/concessions.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { Bills } from '../systems/bills.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Holdings } from '../systems/holdings.js';
import { Underworld } from '../systems/underworld.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { LandMarket } from '../systems/landMarket.js';
import { PuttingOut } from '../systems/puttingOut.js';
import { Estates } from '../world/estates.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';

let ActionMenu;
let Renderer;
let Camera;
let UI;
let logSpy;
let warnSpy;
let errSpy;
const savedDocument = globalThis.document;
const savedAddEventListener = globalThis.addEventListener;

// ── A minimal DOM: panels read their inputs back by id (merchantHouses'
// _val('mhCapital')), so getElementById answers from the last panel's HTML.
let _inputs = {};
function fakeEl(id = null) {
    const el = {
        id, value: id && _inputs[id] != null ? _inputs[id] : '', innerHTML: '', textContent: '', checked: false,
        style: {}, dataset: {}, children: [], options: [],
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, removeChild() {}, remove() {},
        setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, focus() {}, blur() {}, click() {}, select() {},
        querySelector() { return fakeEl(); }, querySelectorAll() { return []; }, closest() { return null; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }; },
        insertAdjacentHTML() {}, scrollIntoView() {}, getContext() { return stubCtx([]); },
    };
    return el;
}
function readInputs(html) {
    const out = {};
    for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
        const id = /\bid="([^"]+)"/.exec(m[1]);
        const val = /\bvalue="([^"]*)"/.exec(m[1]);
        if (id) out[id[1]] = val ? decode(val[1]) : '';
    }
    for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
        const id = /\bid="([^"]+)"/.exec(m[1]);
        if (!id) continue;
        const opts = [...m[2].matchAll(/<option\b([^>]*)>/g)].map(o => o[1]);
        const pick = opts.find(o => /\bselected\b/.test(o)) || opts[0];
        const val = pick && /\bvalue="([^"]*)"/.exec(pick);
        out[id[1]] = val ? decode(val[1]) : '';
    }
    return out;
}

// ── A stub 2D context: every call is a no-op; text painted is recorded, and
// so is any call handed a non-finite number.
function stubCtx(log) {
    const target = {
        canvas: { width: 1280, height: 800 },
        measureText: (t) => ({ width: String(t).length * 6 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        createPattern: () => ({}),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        getLineDash: () => [],
        isPointInPath: () => false,
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop === 'symbol') return undefined;
            return (...args) => {
                if (prop === 'fillText' || prop === 'strokeText') log.push({ text: String(args[0]), args });
                for (const a of args) {
                    if (typeof a === 'number' && !Number.isFinite(a)) log.push({ bad: `${String(prop)}(${args.map(String).join(', ')})` });
                }
            };
        },
        set(t, prop, v) {
            t[prop] = v;
            if (prop === 'font' || prop === 'fillStyle' || prop === 'strokeStyle') {
                if (/undefined|NaN/.test(String(v))) log.push({ bad: `${String(prop)} = ${v}` });
            }
            if ((prop === 'lineWidth' || prop === 'globalAlpha') && !Number.isFinite(v)) log.push({ bad: `${String(prop)} = ${v}` });
            return true;
        },
    });
}

function decode(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** What the player reads: the text between tags, and the tooltips. */
function visibleText(html) {
    const noStyle = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    const titles = [...noStyle.matchAll(/\btitle="([^"]*)"/g)].map(m => decode(m[1]));
    const text = decode(noStyle.replace(/<[^>]*>/g, ' '));
    return `${text} ${titles.join(' ')}`;
}

const LEAKS = [
    [/undefined/, 'undefined'],
    [/NaN/, 'NaN'],
    [/\[object Object\]/, '[object Object]'],
    [/\bnull\b/, 'null'],
    [/\bInfinity\b/, 'Infinity'],
    [/\d\.\d{4,}/, 'an unrounded decimal'],
    [/\$\{/, 'a raw template placeholder'],
];

/** Tags that must balance for the panel to lay out (an unclosed div swallows what follows). */
function unbalanced(html) {
    const out = [];
    for (const tag of ['div', 'p', 'span', 'table', 'tr', 'button', 'b', 'select']) {
        const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
        const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
        if (open !== close) out.push(`<${tag}> ${open} opened, ${close} closed`);
    }
    return out;
}
function leaksIn(text) {
    const out = [];
    for (const [re, label] of LEAKS) {
        const m = re.exec(text);
        if (m) out.push(`${label}: "…${text.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, ' ')}…"`);
    }
    return out;
}

// ── The game shell the panels talk to: a ui that records each panel and notice
function shell(game) {
    const rec = { panels: [], notices: [] };
    const ui = new Proxy({
        showCustomPanel: (title, html) => rec.panels.push({ title: String(title), html: String(html) }),
        showNotification: (title, msg) => rec.notices.push(`${title}: ${msg}`),
    }, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop === 'symbol') return undefined;
            return () => {};
        },
    });
    game.ui = ui;
    game.camera = { centerOn() {}, follow() {}, zoom: 1 };
    game.renderer = { hexSize: 54, getHexPixelPos: () => ({ x: 0, y: 0 }), tradeMapGood: null };
    game.endDay = () => {};
    game.isProcessingTurn = false;
    game.rec = rec;
    return rec;
}

const CAUGHT = [];
const STATS = { panels: 0, clicks: 0, byPanel: {} };
const DUMP = typeof process !== 'undefined' && process.env && process.env.AUDIT_DUMP;
const DUMPED = new Map();

const VERBOSE = typeof process !== 'undefined' && process.env && process.env.AUDIT_VERBOSE;

const ON_CLICK_FAMILY = /^\s*(window\._[A-Za-z]+\.[A-Za-z]+\(|window\.ActionMenu\.|ActionMenu\.)/;

/**
 * Open a panel, then click through every button it offers (breadth first, up
 * to `budget` clicks), checking each panel and notice. Returns the problems.
 */
function crawl(game, label, open, budget = 60) {
    const rec = game.rec;
    const problems = [];
    const seen = new Set();
    const queue = [];
    const check = (where) => {
        const p = rec.panels[rec.panels.length - 1];
        if (!p) return;
        if (!p.html || p.html.replace(/<[^>]*>/g, '').trim().length === 0) problems.push(`${where}: empty panel "${p.title}"`);
        for (const l of leaksIn(visibleText(p.html) + ' ' + p.title)) problems.push(`${where}: ${l}`);
        for (const u of unbalanced(p.html)) problems.push(`${where}: unbalanced ${u}`);
        // The purse is kept to the copper; panels show it in whole gold
        const gold = game.player.gold;
        if (Number.isFinite(gold) && gold >= 1000 && gold !== Math.floor(gold)) {
            const vis = visibleText(p.html);
            for (const raw of [String(gold), gold.toLocaleString()]) {
                const re = new RegExp(`(^|[^\\d.,])${raw.replace(/[.,]/g, '\\$&')}(g\\b| gold)`);
                if (raw.includes('.') && re.test(vis)) problems.push(`${where}: shows the purse unrounded (${raw})`);
            }
        }
        if (DUMP) {
            const dk = where.replace(/^.*?@\S+ /, '').replace(/(am:\w+:\["tab","[^"]*"|am:\w+:\["(?!tab")[^"]*")[^\]]*\]/, '$1');
            const body = visibleText(p.html.replace(/<(?:div|p|br|tr|h\d)\b[^>]*>/g, '\n')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
            DUMPED.set(dk, `\n===== ${where} — ${p.title}\n${body}`);
        }
        _inputs = readInputs(p.html);
        // Buttons to click next
        for (const m of p.html.matchAll(/<[a-z]+\b([^>]*)>/g)) {
            const attrs = m[1];
            if (/\bdisabled\b/.test(attrs.replace(/"[^"]*"|'[^']*'/g, ''))) continue;
            const act = /data-am-act="(\w+)"/.exec(attrs);
            if (act) {
                const raw = /data-am-args='([^']*)'/.exec(attrs) || /data-am-args="([^"]*)"/.exec(attrs);
                let args = [];
                try { args = raw ? JSON.parse(decode(raw[1])) : []; } catch (e) { problems.push(`${where}: bad data-am-args ${raw[1]}`); }
                if (typeof ActionMenu[act[1]] !== 'function') problems.push(`${where}: data-am-act "${act[1]}" is not an ActionMenu method`);
                const key = `am:${act[1]}:${JSON.stringify(args)}`;
                if (!seen.has(key)) { seen.add(key); queue.push({ key, run: () => ActionMenu[act[1]](game, ...args) }); }
                continue;
            }
            const ui = /data-ui-act="(\w+)"/.exec(attrs);
            if (ui && typeof UI.prototype[ui[1]] !== 'function') problems.push(`${where}: data-ui-act "${ui[1]}" is not a UI method`);
            const oc = /\bonclick="([^"]*)"/.exec(attrs);
            if (oc) {
                const code = decode(oc[1]);
                // The handler a click would run must exist now
                const fam = /window\.(_[A-Za-z]+)\.([A-Za-z]+)\(/.exec(code);
                const glob = /^\s*window\.([A-Za-z]\w*)\(/.exec(code);
                const am = /ActionMenu\.(\w+)\(/.exec(code);
                if (fam && !(window[fam[1]] && typeof window[fam[1]][fam[2]] === 'function')) problems.push(`${where}: onclick names missing window.${fam[1]}.${fam[2]}`);
                if (glob && typeof window[glob[1]] !== 'function') problems.push(`${where}: onclick names missing window.${glob[1]}`);
                if (am && typeof ActionMenu[am[1]] !== 'function') problems.push(`${where}: onclick names missing ActionMenu.${am[1]}`);
                if (ON_CLICK_FAMILY.test(code)) {
                    const key = `oc:${code}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        // (bind the handler table now: the next panel replaces window._xxx)
                        const tables = {};
                        for (const n of Object.keys(window).filter(k => /^_[A-Za-z]+$/.test(k))) tables[n] = window[n];
                        queue.push({ key, run: () => {
                            const now = {};
                            for (const n of Object.keys(tables)) { now[n] = window[n]; window[n] = tables[n]; }
                            try {
                                new Function('event', code).call(fakeEl(), { preventDefault() {}, stopPropagation() {}, target: fakeEl() });
                            } finally {
                                for (const n of Object.keys(now)) if (window[n] === tables[n]) window[n] = now[n];
                            }
                        } });
                    }
                }
            }
        }
    };
    const before = rec.panels.length;
    const n0 = rec.notices.length;
    try {
        open();
    } catch (e) {
        problems.push(`${label}: open threw ${e.stack.split('\n').slice(0, 4).join(' | ')}`);
        return problems;
    }
    if (rec.panels.length === before) {
        problems.push(`${label}: opened no panel`);
        return problems;
    }
    while (CAUGHT.length) problems.push(`${label}: swallowed ${CAUGHT.shift()}`);
    check(label);
    let clicks = 0;
    while (queue.length && clicks < budget) {
        const { key, run } = queue.shift();
        clicks++;
        const nP = rec.panels.length;
        try {
            run();
        } catch (e) {
            problems.push(`${label} → ${key}: threw ${e.stack.split('\n').slice(0, 4).join(' | ')}`);
            continue;
        }
        STATS.clicks++;
        while (CAUGHT.length) problems.push(`${label} → ${key}: swallowed ${CAUGHT.shift()}`);
        if (rec.panels.length > nP) { STATS.panels++; check(`${label} → ${key}`); }
    }
    const name = label.split(' ').pop();
    STATS.byPanel[name] = (STATS.byPanel[name] || 0) + clicks;
    for (const n of rec.notices.slice(n0)) {
        for (const l of leaksIn(n)) problems.push(`${label} notice: ${l}`);
    }
    return problems;
}

// ── The states ────────────────────────────────────────────────────────────

function play(seed, days) {
    const game = newGame(seed);
    const stats = {};
    for (let i = 0; i < days; i++) {
        botDay(game, stats);
        const r = endDay(game);
        if (r.died) break;
    }
    shell(game);
    return game;
}

function moveTo(game, tile) {
    game.player.q = tile.q;
    game.player.r = tile.r;
    game.player.isMoving = false;
    game.player.path = null;
}

/** The towns worth opening the panels in: here, a bank's seat, the biggest city, a guild town, a port. */
function tilesOfInterest(game) {
    const { world, player } = game;
    const out = [];
    const add = (t) => { if (t && t.settlement && !out.includes(t)) out.push(t); };
    add(world.getTile(player.q, player.r));
    const bank = Finance.openBanks(player)[0];
    if (bank) add(world.getTile(bank.q, bank.r));
    const views = world.getSettlementViews();
    const biggest = views.slice().sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    if (biggest) add(world.getTile(biggest.q, biggest.r));
    const guildTown = views.find(s => s.guilds && Object.keys(s.guilds).length);
    if (guildTown) add(world.getTile(guildTown.q, guildTown.r));
    return out;
}

/** Every economy panel, opened on `tile` (the player standing there). */
function panelsAt(game, tile) {
    const g = game;
    const list = [
        ['showBank', () => ActionMenu.showBank(g, tile)],
        ['showUnderwriter', () => ActionMenu.showUnderwriter(g, tile)],
        ['showBourse', () => ActionMenu.showBourse(g)],
        ['showMerchantPrince', () => ActionMenu.showMerchantPrince(g, tile)],
        ['showMerchantLedger', () => ActionMenu.showMerchantLedger(g)],
        ['showGuildhall', () => ActionMenu.showGuildhall(g, tile)],
        ['showTownPeople', () => ActionMenu.showTownPeople(g, tile)],
        ['showHinterland', () => ActionMenu.showHinterland(g, tile)],
        ['showTradePolicy', () => ActionMenu.showTradePolicy(g)],
        ['showEconomy', () => ActionMenu.showEconomy(g)],
        ['showHarvests', () => ActionMenu.showHarvests(g, tile)],
        ['showPatronage', () => ActionMenu.showPatronage(g, tile)],
        ['showOutlawLairs', () => ActionMenu.showOutlawLairs(g)],
        ['showTradingCompany', () => ActionMenu.showTradingCompany(g, tile)],
        ['showCounsel', () => ActionMenu.showCounsel(g)],
        ['showTradeMenu', () => ActionMenu.showTradeMenu(g, tile)],
        ['showPublicWorks', () => ActionMenu.showPublicWorks(g, tile)],
        ['showMint', () => ActionMenu.showMint(g, tile)],
        ['showEstates', () => ActionMenu.showEstates(g, tile, 'here')],
        ['showEstates(mine)', () => ActionMenu.showEstates(g, tile, 'mine')],
        ['showEstates(market)', () => ActionMenu.showEstates(g, tile, 'market')],
        ['showPuttingOut', () => ActionMenu.showPuttingOut(g, tile)],
    ];
    if (Throne.ruledKingdom(g.player, g.world)) list.push(['showRoyalCourt', () => ActionMenu.showRoyalCourt(g, tile)]);
    const lair = (OutlawLairs.known ? OutlawLairs.known(g.player, g.world) : [])[0];
    if (lair) list.push(['showOutlawLairs(lair)', () => ActionMenu.showOutlawLairs(g, lair.id)]);
    const trader = MerchantCaravans.traders(g.world).slice().sort((a, b) =>
        Hex.wrappingDistance(a.q, a.r, tile.q, tile.r, g.world.width) - Hex.wrappingDistance(b.q, b.r, tile.q, tile.r, g.world.width))[0];
    if (trader) list.push(['showTrader', () => ActionMenu.showTrader(g, trader.id)]);
    for (const h of Holdings.list(g.player, g.world).slice(0, 1)) {
        const ht = g.world.getTile(h.q, h.r);
        if (ht) list.push(['showHoldingPanel', () => ActionMenu.showHoldingPanel(g, ht)]);
    }
    if ((g.player.properties || []).length) {
        const p = g.player.properties[0];
        const pt = g.world.getTile(p.q, p.r);
        if (pt) list.push(['showManagePropertyMenu', () => { moveTo(g, pt); ActionMenu.showManagePropertyMenu(g, pt); }]);
    }
    return list;
}

function auditPanels(game, label, budget = 40) {
    const problems = [];
    for (const tile of tilesOfInterest(game)) {
        moveTo(game, tile);
        for (const [name, open] of panelsAt(game, tile)) {
            moveTo(game, tile);
            problems.push(...crawl(game, `${label} @${tile.settlement.name} ${name}`, open, budget));
        }
    }
    return problems;
}

/** Hand the player the whole economy: gold, a company, covers, shares, a lease bid, a guild, bills, a store-room. */
function tycoon(game) {
    const { world, player } = game;
    player.gold = 120000.37;
    const bank = Finance.openBanks(player)[0];
    const tile = bank ? world.getTile(bank.q, bank.r) : world.getTile(player.q, player.r);
    moveTo(game, tile);
    if (!MerchantHouses.company(player)) {
        if (!MerchantHouses.hasCharter(player) && !MerchantHouses.officeCharter(player)) MerchantHouses.buyCharter(player, world, tile);
        MerchantHouses.found(player, world, { capital: 8000 });
    }
    if (MerchantHouses.company(player) && !MerchantHouses.postAt(player, tile.q, tile.r)) MerchantHouses.openPost(player, world, tile, 0);
    const post = MerchantHouses.postAt(player, tile.q, tile.r);
    if (post && !post.orders.length) {
        const g = Trading.getAvailableGoods(tile.settlement, tile, world).find(x => x.quantity > 5);
        if (g) MerchantHouses.setOrder(player, post.id, { good: g.id, buyBelow: Math.floor(g.price), buyQty: 10, sellAbove: Math.ceil(g.price * 1.3), sellQty: 10, keep: 0 });
    }
    const m = MerchantHouses.state(player);
    const offer = (m.board || [])[0];
    if (offer) MerchantHouses.acceptContract(player, world, offer.id);
    const rival = MerchantHouses.activeRivals(player)[0];
    if (rival) MerchantHouses.buyShares(player, world, rival.id, 5);
    if (bank) {
        Finance.deposit(player, world, bank.id, 5000);
        const loan = Finance.loanOffers(player, world, bank.id).find(o => o.available);
        if (loan) Finance.takeLoan(player, world, bank.id, loan.id);
        const bond = Finance.bondOffers(player, world).find(x => x.room >= 1000);
        if (bond) Finance.buyBond(player, world, bond.kingdomId, 1000);
        const to = Bills.payees(player, bank.id)[0];
        if (to) Bills.draw(player, world, bank.id, to.id, 3000);
    }
    const uw = Underwriting.underwritersAt(player, world, tile)[0];
    if (uw) for (const kind of COVER_KINDS) Underwriting.openCover(player, world, uw.id, kind);
    if (Bourse.exchangeAt(player, world)) {
        for (const l of Bourse.listed(player).filter(x => x.price > 0).slice(0, 3)) Bourse.buy(player, world, l.id, 5);
    }
    if (tile.settlement.guilds) {
        for (const gid of Object.keys(tile.settlement.guilds)) if (Guilds.join(player, world, tile, gid).success) break;
    }
    if (tile.settlement.type === 'city' || tile.settlement.type === 'capital') MerchantPrince.rentWarehouse(player, world, tile, 'small');
    for (const id of ['bakery', 'brewery', 'mill', 'charcoal']) {
        if (MerchantPrince.invest(player, world, tile, id).success) break;
    }
    for (const { a } of Concessions.auctionsNear(world, tile.q, tile.r, 12).slice(0, 1)) {
        const q = Concessions.leaseQuote(player, world, a.siteId || (a.site && a.site.id));
        Concessions.bid(player, world, a.id, Math.max((q && q.minBid) || 0, 500));
    }
    // A farm near town (the Harvest panel's rotations, crop cover)
    let farmed = (player.properties || []).some(p => p.type === 'farm');
    for (let dr = -8; dr <= 8 && !farmed; dr++) {
        for (let dq = -8; dq <= 8 && !farmed; dq++) {
            const t = world.getTile(Hex.wrapQ(tile.q + dq, world.width), tile.r + dr);
            if (t && PlayerEconomy.buildProperty(player, 'FARM', t, world).success) farmed = true;
        }
    }
    // An estate here (the Estates panel's rents, works, sales, dowry) and wool put out to the cottagers
    for (const e of Estates.estatesOf(world, tile.q, tile.r)) if (LandMarket.buy(player, world, e.id).success) break;
    player.inventory.wool = (player.inventory.wool || 0) + 40;
    PuttingOut.putOut(player, world, tile, 'wool', 20, 'fair');
    const ug = Underworld.ensure(player);
    if (ug.guild && !ug.guild.member) ug.guild.member = true;
    if (ug.guild) ug.guild.rank = Math.max(ug.guild.rank || 0, 3);
    return tile;
}

function crown(game) {
    const { world, player } = game;
    const all = world.getAllSettlements();
    const k = world.kingdoms.filter(x => x.isAlive).sort((a, b) =>
        all.filter(s => s.kingdom === b.id).length - all.filter(s => s.kingdom === a.id).length)[0];
    Throne._takeThrone(player, world, k);
    k.treasury = Math.max(k.treasury || 0, 5000);
    Kingship.processDay(world, player);
    const cap = all.find(s => s.kingdom === k.id && (s.type === 'capital' || s.isCapital)) || all.find(s => s.kingdom === k.id);
    if (cap) moveTo(game, world.getTile(cap.q, cap.r));
    return k;
}

// ── The renderer ──────────────────────────────────────────────────────────

const MAP_MODES = ['normal', 'political', 'religion', 'wealth', 'military', 'trade', 'prices', 'culture'];

function renderAudit(game, label) {
    const problems = [];
    const log = [];
    const ctx = stubCtx(log);
    const canvas = { width: 1280, height: 800, getContext: () => ctx, addEventListener() {}, style: {} };
    const r = Object.create(Renderer.prototype);
    Object.assign(r, {
        canvas, ctx, hexSize: 54, world: null, player: null, hoveredHex: null, selectedHex: null, reachableHexes: null,
        terrainCache: new Map(), tileSprites: new Map(), imagesLoaded: false, time: 0, waterAnimInterval: 1.2, waterAnimFrame: 0,
        showResources: true, showTerritories: true, mapMode: 'normal', labels: [], labelPadding: 5,
    });
    r.hexWidth = Math.sqrt(3) * r.hexSize;
    r.hexHeight = 2 * r.hexSize;
    const camera = new Camera(canvas);
    r.camera = camera;
    r.setWorld(game.world);
    r.setPlayer(game.player);
    camera.setWorldBounds(Math.sqrt(3) * r.hexSize * game.world.width, 1.5 * r.hexSize * game.world.height);
    // Look at the player's town, then at the busiest-known town and a bank
    const spots = [{ q: game.player.q, r: game.player.r }];
    for (const t of tilesOfInterest(game)) spots.push({ q: t.q, r: t.r });
    for (const zoom of [0.55, 1, 1.5]) {
        for (const spot of spots.slice(0, 3)) {
            const pos = r.getHexPixelPos(spot.q, spot.r);
            camera.centerOn(pos.x, pos.y);
            camera.zoom = zoom;
            for (const mode of MAP_MODES) {
                r.mapMode = mode;
                r.hoveredHex = { q: spot.q, r: spot.r };
                log.length = 0;
                try {
                    camera.precomputeFrame();
                    r.render(0.016);
                } catch (e) {
                    problems.push(`${label} render ${mode} z${zoom}: threw ${e.stack.split('\n').slice(0, 4).join(' | ')}`);
                    continue;
                }
                for (const entry of log) {
                    if (entry.bad) problems.push(`${label} render ${mode} z${zoom}: non-finite ${entry.bad}`);
                    else for (const l of leaksIn(entry.text)) problems.push(`${label} render ${mode} z${zoom}: fillText ${l}`);
                }
            }
        }
    }
    // The trade map steps through the goods the player knows
    r.mapMode = 'prices';
    for (let i = 0; i < 4; i++) {
        r.cycleTradeMapGood(1);
        log.length = 0;
        try { camera.precomputeFrame(); r.renderTradeMap(ctx); } catch (e) { problems.push(`${label} trade map ${r.tradeMapGood}: threw ${e.message}`); }
        for (const entry of log) {
            if (entry.bad) problems.push(`${label} trade map ${r.tradeMapGood}: non-finite ${entry.bad}`);
            else for (const l of leaksIn(entry.text)) problems.push(`${label} trade map: fillText ${l}`);
        }
    }
    return [...new Set(problems)];
}

// ── The suite ─────────────────────────────────────────────────────────────

beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // A panel that swallows its own exception (try { … } catch (e) { console.warn(…, e) }) still fails the audit
    const keep = (...args) => { const e = args.find(a => a instanceof Error); if (e) CAUGHT.push(`${args.filter(a => typeof a === 'string').join(' ')} ${e.stack.split('\n').slice(0, 3).join(' | ')}`); };
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(keep);
    errSpy = vi.spyOn(console, 'error').mockImplementation(keep);
    globalThis.document = {
        getElementById: (id) => fakeEl(id),
        createElement: () => fakeEl(),
        querySelector: () => fakeEl(),
        querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {},
        body: fakeEl(), head: fakeEl(), documentElement: fakeEl(),
    };
    if (typeof globalThis.addEventListener !== 'function') globalThis.addEventListener = () => {};
    globalThis.innerWidth = globalThis.innerWidth || 1280;
    globalThis.innerHeight = globalThis.innerHeight || 800;
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    ({ Renderer } = await import('../ui/renderer.js'));
    ({ Camera } = await import('../ui/camera.js'));
    ({ UI } = await import('../ui/ui.js'));
});
afterAll(() => {
    if (DUMP) fs.writeFileSync(DUMP, [...DUMPED.values()].join('\n'));
    if (VERBOSE) process.stdout.write(`render audit: ${JSON.stringify(STATS)}\n`);
    globalThis.document = savedDocument;
    globalThis.addEventListener = savedAddEventListener;
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
    if (errSpy) errSpy.mockRestore();
});

const report = (problems) => [...new Set(problems)].slice(0, 40).join('\n');

describe('economy panels render on real game states', () => {
    it('early game (day 5), two seeds: every panel and button', () => {
        const problems = [];
        for (const seed of [101, 202]) {
            const game = play(seed, 5);
            problems.push(...auditPanels(game, `seed ${seed} day ${game.world.day}`));
            problems.push(...renderAudit(game, `seed ${seed} day ${game.world.day}`));
        }
        expect(problems, report(problems)).toEqual([]);
    }, 180000);

    // (each state is built by the bot playing real days — the costly part — so
    // the states are few, and each is audited as played, then pushed to its edges)
    const lapper = () => {
        let t = performance.now();
        return (what) => { if (VERBOSE) process.stdout.write(`${what} ${Math.round(performance.now() - t)}ms\n`); t = performance.now(); };
    };

    it('late game (day 300 after the bot has played): as played, broke, then a tycoon', () => {
        const problems = [];
        const lap = lapper();
        const game = play(303, 300);
        lap('play');
        const at = `seed 303 day ${game.world.day}`;
        problems.push(...auditPanels(game, at, 30));
        problems.push(...renderAudit(game, at));
        lap('as played');
        // Broke: no gold at all
        game.player.gold = 0;
        problems.push(...auditPanels(game, `${at} broke`, 20));
        lap('broke');
        // Rich: a company, covers, shares, a lease bid, a guild, bills, a store-room
        tycoon(game);
        for (let i = 0; i < 8; i++) endDay(game);
        shell(game);
        problems.push(...auditPanels(game, `${at} tycoon`, 45));
        problems.push(...renderAudit(game, `${at} tycoon`));
        lap('tycoon');
        expect(problems, report(problems)).toEqual([]);
    }, 600000);

    it('mid game (day 150), then crowned: the Royal Court, trade policy and the realm\'s books', () => {
        const problems = [];
        const lap = lapper();
        const game = play(101, 150);
        lap('play');
        const at = `seed 101 day ${game.world.day}`;
        problems.push(...auditPanels(game, at, 30));
        lap('as played');
        tycoon(game);
        crown(game);
        for (let i = 0; i < 3; i++) endDay(game);
        shell(game);
        problems.push(...auditPanels(game, `${at} ruler`, 45));
        problems.push(...renderAudit(game, `${at} ruler`));
        lap('ruler');
        expect(problems, report(problems)).toEqual([]);
    }, 600000);

    it('the leak detector itself catches what it should', () => {
        expect(leaksIn(visibleText('<div title="x">Price: undefinedg</div>')).length).toBe(1);
        expect(leaksIn(visibleText('<b>NaN</b> gold')).length).toBe(1);
        expect(leaksIn(visibleText('<span data-x="null">ok 12.5g</span>'))).toEqual([]);
        expect(leaksIn(visibleText('worth 3.14159g')).length).toBe(1);
        expect(unbalanced('<div><p>text</div>')).toEqual(['<p> 1 opened, 0 closed']);
    });
});
