// ============================================
// PLAYTEST METRICS — the long game's curves and its state's growth
// ============================================
// Off unless a soak asks (SOAK_METRICS=1 in playtest.soak.test.js):
//   - worldMetrics(): one cheap yearly row — people, towns by size class,
//     town purses, a few prices, world units, refugees, plague towns;
//   - stateSizes(): walks the save (SaveLoad.serialize*) and adds up, per
//     path (ids folded to '*', array items to '[]'), how many containers,
//     items and bytes sit there — two walks decades apart show what only grows;
//   - growthDiff(): the paths that grew the most between two walks.

import { Trading } from '../../player/playerEconomy.js';
import { Migration } from '../../systems/migration.js';
import { Plague } from '../../systems/plague.js';
import { CoinCensus } from '../../systems/coinCensus.js';

const PRICE_GOODS = ['grain', 'bread', 'iron', 'cloth', 'tools', 'wood'];

const median = (arr) => {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
};

/** The banks' hoard by holder, and the crowns' books (their last week, summed over the realms). */
export function moneyBooks(game) {
    const { world, player } = game;
    const realms = (world.kingdoms || []).filter(k => k && k.isAlive);
    const fin = player && player.finance;
    const open = fin && Array.isArray(fin.banks) ? fin.banks.filter(b => b && b.status === 'open') : [];
    const uw = player && player.underwriting && Array.isArray(player.underwriting.guilds) ? player.underwriting.guilds : [];
    const mer = player && player.merchant && Array.isArray(player.merchant.rivals) ? player.merchant.rivals.filter(r => r && r.seat && !r.bankrupt) : [];
    const sum = (arr, f) => Math.round(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));
    const banksBy = `vaults:${sum(open, b => b.capital)}(${open.length} base ${sum(open, b => b.baseCapital)}) uw:${sum(uw, g => g.capital)} merch:${sum(mer, r => r.capital)}(${mer.length})`;
    const wk = {};
    let debt = 0, arrears = 0, corr = 0, dem = 0, nf = 0;
    for (const k of realms) {
        const f = k.fisc;
        if (f && f.lastWeek) for (const [l, v] of Object.entries(f.lastWeek)) if (v) wk[l] = (wk[l] || 0) + v;
        if (f) { nf++; corr += Number(f.corruption) || 0; dem += Number(f.demesne) || 0; if (f.arrearsDays > 0) arrears++; }
        if (k.finance && Array.isArray(k.finance.debt)) debt += k.finance.debt.reduce((a, d) => a + (Number(d.owed) || 0), 0);
    }
    const fisc = `week[${Object.entries(wk).filter(([, v]) => Math.abs(v) >= 1).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).map(([l, v]) => `${l}:${Math.round(v)}`).join(' ')}] debt ${Math.round(debt)} arrears ${arrears} corr ${nf ? (corr / nf).toFixed(2) : 0} demesne ${nf ? (dem / nf).toFixed(2) : 0}`;
    return { banksBy, fisc };
}

/** The world's yearly row. */
export function worldMetrics(game) {
    const { world, player } = game;
    const towns = world.getSettlementViews ? world.getSettlementViews() : world.getAllSettlements();
    const sizes = {};
    const typePop = {};
    let folk = 0;
    let folkDead = 0;
    let pop = 0;
    const purses = [];
    let nanPurse = 0;
    let negStock = 0;
    let nanStock = 0;
    let plague = 0;
    let gates = 0;
    let gangPurse = 0;
    let gangMax = 0;
    const gangIn = {};
    const prices = {};
    for (const s of towns) {
        sizes[s.type || '?'] = (sizes[s.type || '?'] || 0) + 1;
        typePop[s.type || '?'] = (typePop[s.type || '?'] || 0) + (Number(s.population) || 0);
        const people = s.folk && Array.isArray(s.folk.people) ? s.folk.people : null;
        if (people) { folk += people.length; folkDead += people.filter(p => p.died != null).length; }
        pop += Number(s.population) || 0;
        const g = s.economy && s.economy.gold;
        if (g != null) {
            if (Number.isFinite(g)) purses.push(g); else nanPurse++;
        }
        const st = s.market && s.market.stock;
        if (st) {
            for (const v of Object.values(st)) {
                const n = typeof v === 'number' ? v : v && typeof v.qty === 'number' ? v.qty : null;
                if (n == null) continue;
                if (!Number.isFinite(n)) nanStock++;
                else if (n < 0) negStock++;
            }
        }
        if (Plague.severityAt(world, s) > 0) plague++;
        const live = s.underworld && Array.isArray(s.underworld.gangs) ? s.underworld.gangs.filter(g => g && !g.dissolved) : [];
        for (const g of live) {
            gangPurse += Number(g.purse) || 0;
            gangMax = Math.max(gangMax, Number(g.purse) || 0);
            const all = g.books && g.books.all && g.books.all.in;
            for (const [k, v] of Object.entries(all || {})) gangIn[k] = (gangIn[k] || 0) + v;
        }
        if (s.plagueGate && s.plagueGate.shut) gates++;
    }
    // Prices: a sample of towns (every 4th), the ask the market shows the player
    for (let i = 0; i < towns.length; i += 4) {
        const s = towns[i];
        const tile = world.getTile(s.q, s.r);
        if (!tile || !tile.settlement) continue;
        let goods;
        try { goods = Trading.getAvailableGoods(tile.settlement, tile, world); } catch (e) { continue; }
        for (const g of goods) {
            if (!PRICE_GOODS.includes(g.id)) continue;
            (prices[g.id] = prices[g.id] || []).push(g.price);
        }
    }
    const units = world.units || [];
    const byType = {};
    for (const u of units) if (!u.destroyed) byType[u.type] = (byType[u.type] || 0) + 1;
    const columns = units.filter(u => Migration.isColumn(u)).length;
    const realms = (world.kingdoms || []).filter(k => k && k.isAlive);
    const census = CoinCensus.total(world, player);
    const { banksBy, fisc } = moneyBooks(game);
    return {
        coin: Math.round(census.total),
        banksBy, fisc,
        coinBy: Object.entries(census.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${Math.round(v)}`).join(' '),
        pop: Math.round(pop),
        realmPop: Math.round(realms.reduce((a, k) => a + (Number(k.population) || 0), 0)),
        realms: realms.length,
        towns: towns.length,
        sizes,
        avgPop: Object.fromEntries(Object.entries(typePop).map(([k, v]) => [k, Math.round(v / sizes[k])])),
        folk, folkDead,
        gangs: `${Math.round(gangPurse)}g max ${Math.round(gangMax)} in ${Object.entries(gangIn).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${Math.round(v)}`).join(' ')}`,
        purseMedian: Math.round(median(purses) || 0),
        purseTotal: Math.round(purses.reduce((a, b) => a + b, 0)),
        treasury: Math.round(realms.reduce((a, k) => a + (Number(k.treasury) || 0), 0)),
        nanPurse, nanStock, negStock, plague, gates,
        prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Math.round(median(v) * 10) / 10])),
        units: units.length,
        unitTypes: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' '),
        columns,
        gold: Math.round(player.gold || 0),
    };
}

/** Fold an object key that is an id (has a digit, or the object is a big map) to '*'. */
function foldKey(k, many) {
    return many || /\d/.test(k) ? '*' : k;
}

/**
 * Walk a (serialized) state tree: per folded path, the containers found, their
 * items (array length / key count) and bytes (only to depth `byteDepth`).
 */
export function stateSizes(root, opts = {}) {
    const maxDepth = opts.maxDepth || 8;
    const byteDepth = opts.byteDepth || 6;
    const acc = {};
    const walk = (node, path, depth) => {
        if (!node || typeof node !== 'object') return;
        const isArr = Array.isArray(node);
        const keys = isArr ? null : Object.keys(node);
        const e = acc[path] || (acc[path] = { n: 0, items: 0, bytes: 0 });
        e.n++;
        e.items += isArr ? node.length : keys.length;
        if (depth <= byteDepth) e.bytes += JSON.stringify(node).length;
        if (depth >= maxDepth) return;
        if (isArr) {
            for (const c of node) walk(c, `${path}[]`, depth + 1);
        } else {
            const many = depth >= 2 && keys.length > 60;
            for (const k of keys) walk(node[k], `${path}.${foldKey(k, many)}`, depth + 1);
        }
    };
    walk(root, opts.name || '$', 0);
    return acc;
}

/** The biggest paths of a walk, by bytes (where measured) then items. */
export function topSizes(acc, n = 25) {
    return Object.entries(acc)
        .filter(([, e]) => e.bytes > 0)
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .slice(0, n)
        .map(([p, e]) => `${p} ${Math.round(e.bytes / 1024)}KB items ${e.items}${e.n > 1 ? ` in ${e.n}` : ''}`);
}

/** Paths whose items grew the most between two walks (absolute and ratio). */
export function growthDiff(a, b, n = 30) {
    const rows = [];
    for (const [p, e] of Object.entries(b)) {
        const before = a[p] ? a[p].items : 0;
        const d = e.items - before;
        if (d <= 50) continue;
        rows.push({ p, before, after: e.items, d, bytes: e.bytes, ratio: before ? e.items / before : Infinity });
    }
    return rows.sort((x, y) => y.d - x.d).slice(0, n)
        .map(r => `${r.p}: ${r.before} → ${r.after} (+${r.d}${Number.isFinite(r.ratio) ? `, ×${r.ratio.toFixed(1)}` : ', new'})${r.bytes ? ` ${Math.round(r.bytes / 1024)}KB` : ''}`);
}
