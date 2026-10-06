// ============================================
// MARKET DYNAMICS — the daily market tick and regional price reports
// ============================================
// Every settlement keeps one goods inventory (world/settlementMarket.js).
// This module drives its day: what each town brings to market (its land,
// map resources via Economy.calculateDetailedProduction, the player's
// properties nearby, its holdings), and the NPC trade that moves goods
// along the kingdoms' trade routes and between near neighbours — cut by
// war, blockades (world/kingdomNavy.js), sieges (systems/sieges.js,
// systems/holdingSieges.js), outlaw lairs (systems/outlawLairs.js) and
// raiders on the roads. getPrice / getPriceTrend / getMarketSummary report
// the same prices to caravans, the tavern and the market screens.
// Deterministic; draws no RNG.

import { PlayerEconomy } from '../player/playerEconomy.js';
import { Economy } from '../world/economy.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Seasons } from '../world/seasons.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Technology } from './technology.js';
import { Hex } from '../core/hex.js';
import { Councils } from './councils.js';
import { Titles } from './titles.js';
import { Utils } from '../core/utils.js';
import { Infrastructure } from './infrastructure.js';
import { OutlawLairs } from './outlawLairs.js';
import { Sieges } from './sieges.js';
import { HoldingSieges } from './holdingSieges.js';

const _key = (q, r) => `${q},${r}`;
/** Days a settlement's production profile holds before it is worked out again. */
const PROFILE_DAYS = 20;
/** Days the trade links hold before they are drawn again (towns founded meanwhile join then). */
const LINK_DAYS = 30;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Per-world caches rebuilt from world state (land around towns, trade links). */
const _caches = new WeakMap();

export const MarketDynamics = {
    // Old saves carried a separate supply/demand table here; prices now live
    // on each settlement's market. Kept (empty) for callers and old saves.
    regionalMarkets: {},

    /** What the last daily tick moved: { moved, value, gold }. */
    lastFlow: null,

    initialize() {
        this.regionalMarkets = {};
        this.lastFlow = null;
    },

    _cache(world) {
        let c = _caches.get(world);
        if (!c) {
            c = { land: new Map(), links: null };
            _caches.set(world, c);
        }
        return c;
    },

    /**
     * The daily market tick (after the world's day, from endDay): every
     * settlement produces, works up and consumes its goods
     * (SettlementMarket.processSettlement), then NPC traders move goods
     * along the trade links (SettlementMarket.flows). `player` supplies the
     * player-side disruptions (lairs, sieges). @returns {{ moved, value, gold }}
     */
    updatePrices(world, player = null) {
        if (!world || typeof world.getTile !== 'function') return null;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        const cache = this._cache(world);
        const day = Seasons.today(world);
        const foodSeason = SettlementMarket.seasonalFood(day);
        let spill = null;
        const k = SettlementMarket.tickDays();
        const turn = Number.isFinite(day) ? ((day % k) + k) % k : 0;
        const lives = [];
        for (const s of views) {
            const tile = world.getTile(s.q, s.r);
            const live = tile && tile.settlement;
            if (!live) continue;
            if (live.q !== s.q || live.r !== s.r) { live.q = s.q; live.r = s.r; }
            Economy.initSettlement(live);
            lives.push(live);
            const m = SettlementMarket.ensure(live);
            // Markets take their turns (every tickDays, staggered by place)
            if (k > 1 && Number.isFinite(day) && SettlementMarket.slot(s.q, s.r) !== turn) continue;
            // What the town brings to market, worked out afresh every few days
            // (kept on the market, so a loaded game carries on identically)
            const bucket = Math.floor(_num(day) / PROFILE_DAYS);
            if (!Array.isArray(m.prod) || m.prodAt !== bucket || m.prod.length !== SettlementMarket.config().goodIds.length) {
                if (!spill) spill = this._propertySpill(world, views);
                const land = this._land(world, cache, tile, day);
                // The breakdown produceDaily stored today (kingdom towns), else worked out fresh
                const stored = live.kingdom && live.economy.production && live.economy.production.breakdown;
                const bd = stored || Economy.calculateDetailedProduction(live, tile, world);
                const rates = Economy.PRODUCTION_RATES[live.type] || Economy.PRODUCTION_RATES.village;
                const foodBase = rates.baseFood * (1 + (_num(live.population) / 10000) * 0.5);
                const prod = SettlementMarket.production(live, land, bd, foodBase, spill.get(_key(s.q, s.r)) || null);
                m.prod = SettlementMarket.productionList(prod);
                m.prodAt = bucket;
            }
            SettlementMarket.processSettlement(live, m.prod, {
                day,
                days: Number.isFinite(day) ? k : 1,
                cold: SettlementMarket.isCold(world, tile),
                foodMult: foodSeason * Math.max(0, 1 + WorldEvents.getModifier(world, 'farmProduction', tile)),
                mineMult: Math.max(0, 1 + WorldEvents.getModifier(world, 'mineProduction', tile)),
                intact: 1 - Math.min(0.9, Math.max(0, _num(live.damage))),
                goodsMult: 1 + Economy.holdingFx(live, 'goods'),
            });
        }
        const links = this._links(world, cache, lives, day);
        for (const live of lives) if (live.market && live.market.trade) live.market.trade.cut = 0;
        this._disrupt(world, player, links, k > 1 && Number.isFinite(day) ? turn : null);
        const flow = SettlementMarket.flows(links, this._basePrices(), day);
        // Independent towns have no realm treasury pass to bank their trade (KingdomAI.updateEconomy)
        for (const live of lives) if (!live.kingdom) Economy.processTrade(live);
        this.lastFlow = flow;
        return flow;
    },

    /** Land profile of a settlement's hex, recomputed each 30-day stretch (terraforming is rare). */
    _land(world, cache, tile, day) {
        const k = _key(tile.q, tile.r);
        const bucket = Math.floor(_num(day) / 30);
        const hit = cache.land.get(k);
        if (hit && hit.bucket === bucket) return hit.land;
        const land = SettlementMarket.landProfile(world, tile.q, tile.r);
        cache.land.set(k, { bucket, land });
        return land;
    },

    /** Base prices of the goods the markets trade (data/playerEconomy.json GOODS). */
    _basePrices() {
        const out = {};
        for (const id of SettlementMarket.config().goodIds) {
            const g = PlayerEconomy.GOODS && PlayerEconomy.GOODS[id.toUpperCase()];
            out[id] = g ? g.basePrice : 0;
        }
        return out;
    },

    /**
     * Goods the player's working properties near each settlement add to its
     * market (data/markets.json propertySpill): Map 'q,r' → { goodId: units }.
     */
    _propertySpill(world, views) {
        const out = new Map();
        const tiles = this._propertyTiles(world);
        if (tiles && tiles.length === 0) return out;
        const P = SettlementMarket.config().propertySpill;
        const radius = _num(P.radius, 3);
        const share = _num(P.share, 0.25);
        const list = tiles || [];
        for (const [q, r] of list) {
            const t = world.getTile(q, r);
            if (!t || !Array.isArray(t.playerProperties)) continue;
            for (const prop of t.playerProperties) {
                if (!prop || prop.underConstruction || !prop.produces || !(prop.productionRate > 0)) continue;
                if (!SettlementMarket.tracks(prop.produces)) continue;
                for (const s of views) {
                    if (Math.abs(s.r - r) > radius) continue;
                    if (Hex.wrappingDistance(s.q, s.r, q, r, world.width) > radius) continue;
                    const k = _key(s.q, s.r);
                    const m = out.get(k) || {};
                    m[prop.produces] = (m[prop.produces] || 0) + prop.productionRate * share;
                    out.set(k, m);
                }
            }
        }
        return out;
    },

    /**
     * [q, r] of every tile holding player properties, or null when the world
     * has no tile grid to scan.
     */
    _propertyTiles(world) {
        if (!Array.isArray(world.tiles)) return null;
        const out = [];
        for (let r = 0; r < world.tiles.length; r++) {
            const row = world.tiles[r];
            if (!row) continue;
            for (let q = 0; q < row.length; q++) {
                if (row[q] && row[q].playerProperties) out.push([q, r]);
            }
        }
        return out;
    },

    // ── Trade links ───────────────────────────────────────

    /**
     * The trade links between settlements: each town's kingdom trade routes
     * and its nearest neighbours by land (same region) or by sea (port to
     * port), up to `partners` each. Drawn every LINK_DAYS days or when a
     * town is founded or lost, and saved on the markets (market.links) so a
     * loaded game trades on the same ones; a link knows its distance, road,
     * sea leg, routes, friction and capacity.
     */
    _links(world, cache, lives, day) {
        const T = SettlementMarket.config().trade;
        const n = lives.length;
        const bucket = Math.floor(_num(day) / LINK_DAYS);
        // Towns founded meanwhile join the trade when the links are next drawn
        if (cache.links && cache.links.bucket === bucket) return cache.links.list;
        const make = (a, b, d, sea, road, nRoutes) => {
            const friction = T.perHex * Math.max(1, d) * (road ? T.roadFactor : 1) * (sea ? T.seaFactor : 1);
            const base = T.capacity + T.perRoute * Math.min(nRoutes, T.maxRoutes);
            return {
                a, b, dist: d, sea, road, routes: nRoutes, friction, base, capacity: base, factor: 1,
                slot: SettlementMarket.slot(a.q + b.q, a.r + b.r),
            };
        };
        // A loaded game picks up the links its towns were trading on (saved on
        // each market), so it carries on exactly as it would have
        const drawn = (s) => s.market && s.market.linksAt === bucket;
        if (!cache.links && lives.some(drawn) && lives.every(s => drawn(s) || !s.market || s.market.linksAt === undefined)) {
            const at = new Map();
            lives.forEach(s => at.set(_key(s.q, s.r), s));
            const list = [];
            for (const a of lives) {
                for (const [q, r, d, sea, road, nRoutes] of a.market.links || []) {
                    const b = at.get(_key(q, r));
                    if (b) list.push(make(a, b, d, !!sea, !!road, nRoutes));
                }
            }
            cache.links = { bucket, lives: lives.slice(), list };
            return list;
        }
        // Who could trade with whom (distance, land or sea)
        const tiles = lives.map(s => world.getTile(s.q, s.r));
        const port = lives.map(s => KingdomNavy.isPortTile(world, s.q, s.r));
        const cands = [];
        for (let i = 0; i < n; i++) {
            const a = lives[i];
            const list = [];
            for (let j = 0; j < n; j++) {
                if (j === i) continue;
                const b = lives[j];
                if (Math.abs(a.r - b.r) > T.maxRange) continue;
                const d = Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
                if (d > T.maxRange) continue;
                const sameLand = !!(tiles[i] && tiles[j] && tiles[i].regionId !== undefined && tiles[i].regionId === tiles[j].regionId);
                if (!sameLand && !(port[i] && port[j])) continue;
                list.push({ j, d, sea: !sameLand, near: sameLand ? d <= T.localRange : d <= T.seaRange });
            }
            list.sort((x, y) => (x.d - y.d) || (x.j - y.j));
            cands.push(list);
        }
        // The kingdoms' trade routes between them
        const byName = new Map();
        lives.forEach((s, i) => { if (s.name && !byName.has(s.name)) byName.set(s.name, i); });
        const pairKey = (i, j) => (i < j ? i * 100000 + j : j * 100000 + i);
        const routeCount = new Map();
        for (let i = 0; i < n; i++) {
            const rs = lives[i].economy && lives[i].economy.tradeRoutes;
            if (!Array.isArray(rs)) continue;
            for (const rt of rs) {
                const j = byName.get(rt && rt.to);
                if (j === undefined || j === i) continue;
                const k = pairKey(i, j);
                routeCount.set(k, (routeCount.get(k) || 0) + 1);
            }
        }
        // Each town's partners: its routed towns first, then its nearest neighbours
        const pairs = new Map();
        for (let i = 0; i < n; i++) {
            const picks = [];
            for (const c of cands[i]) if (routeCount.has(pairKey(i, c.j))) picks.push(c);
            for (const c of cands[i]) if (c.near && !routeCount.has(pairKey(i, c.j))) picks.push(c);
            for (const c of picks.slice(0, T.partners)) {
                const k = pairKey(i, c.j);
                if (!pairs.has(k)) pairs.set(k, { i: Math.min(i, c.j), j: Math.max(i, c.j), d: c.d, sea: c.sea });
            }
        }
        // A road the whole way (towns on one network share its flood; the
        // floods are kept for a month — new roads are rare)
        const month = Math.floor(_num(day) / 30);
        if (!cache.reach || cache.reach.month !== month) cache.reach = { month, map: new Map() };
        const reached = cache.reach.map;
        const reach = (s) => {
            const key = _key(s.q, s.r);
            let r = reached.get(key);
            if (!r) {
                r = Infrastructure._roadReach(world, s.q, s.r);
                reached.set(key, r);
                for (const t of lives) {
                    const tk = _key(t.q, t.r);
                    if (r.has(tk) && !reached.has(tk)) reached.set(tk, r);
                }
            }
            return r;
        };
        const list = [];
        const saved = new Map(lives.map(s => [s, []]));
        for (const [k, p] of [...pairs.entries()].sort((x, y) => x[0] - y[0])) {
            const a = lives[p.i], b = lives[p.j];
            const road = !p.sea && reach(a).has(_key(b.q, b.r));
            const nRoutes = routeCount.get(k) || 0;
            list.push(make(a, b, p.d, p.sea, road, nRoutes));
            saved.get(a).push([b.q, b.r, p.d, p.sea ? 1 : 0, road ? 1 : 0, nRoutes]);
        }
        for (const s of lives) {
            if (!s.market) continue;
            s.market.links = saved.get(s);
            s.market.linksAt = bucket;
        }
        cache.links = { bucket, lives: lives.slice(), list };
        return list;
    },

    /**
     * Today's disruption of each link (link.factor, 1 = open, 0 = cut):
     * war between the two realms, a realm at war at all, a blockade of
     * either port (sea legs), a siege of either town, outlaw lairs and
     * raider bands near the road, and world events on trade.
     */
    _disrupt(world, player, links, turn = null) {
        const T = SettlementMarket.config().trade;
        const W = world.width;
        const kingdomOf = (s) => (s.kingdom && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null);
        const besieged = new Set();
        const siege = player ? Sieges.active(player) : null;
        if (siege && Number.isFinite(siege.q)) besieged.add(_key(siege.q, siege.r));
        for (const hs of player ? HoldingSieges.list(player) : []) if (hs && Number.isFinite(hs.q)) besieged.add(_key(hs.q, hs.r));
        const lairs = player ? OutlawLairs.active(player).filter(l => Number.isFinite(l.q)) : [];
        const raiders = (world.units || []).filter(u => u && !u.destroyed && u.type === 'raider');
        const blockade = new Map();
        const portBlock = (s) => {
            const k = _key(s.q, s.r);
            if (!blockade.has(k)) blockade.set(k, KingdomNavy.portBlockade(world, s.q, s.r));
            return blockade.get(k);
        };
        const near = (q, r, a, b, mid, radius) => {
            if (Math.abs(r - mid.r) > radius + Math.abs(a.r - b.r) / 2 + 1) return false;
            return Hex.wrappingDistance(q, r, a.q, a.r, W) <= radius
                || Hex.wrappingDistance(q, r, b.q, b.r, W) <= radius
                || Hex.wrappingDistance(q, r, mid.q, mid.r, W) <= radius;
        };
        for (const link of links) {
            const { a, b } = link;
            // Only the links taking their turn today
            if (turn !== null && link.slot !== turn) { link.factor = 0; continue; }
            // A town razed or abandoned since the links were drawn trades no more
            const ta = world.getTile(a.q, a.r), tb = world.getTile(b.q, b.r);
            if (!ta || ta.settlement !== a || !tb || tb.settlement !== b) { link.factor = 0; continue; }
            // Bigger towns trade more
            link.capacity = link.base * (0.5 + 0.5 * Math.min(_num(T.sizeMax, 3), (_num(a.population) + _num(b.population)) / _num(T.sizePop, 5000)));
            let f = 1;
            const ka = kingdomOf(a), kb = kingdomOf(b);
            if (ka && kb && ka !== kb && Array.isArray(ka.wars) && ka.wars.includes(kb.id)) f *= 1 - T.warCut;
            if ((ka && Array.isArray(ka.wars) && ka.wars.length) || (kb && Array.isArray(kb.wars) && kb.wars.length)) f *= T.atWarFactor;
            if (link.sea) {
                for (const s of [a, b]) {
                    const bl = portBlock(s);
                    if (bl) f *= bl.closed ? 0 : 0.5;
                }
            }
            if (besieged.size && (besieged.has(_key(a.q, a.r)) || besieged.has(_key(b.q, b.r)))) f *= 1 - T.siegeCut;
            if (f > 0 && (lairs.length || raiders.length)) {
                let dq = b.q - a.q;
                if (W && Math.abs(dq) > W / 2) dq -= Math.sign(dq) * W;
                const mid = { q: Math.round(a.q + dq / 2), r: Math.round((a.r + b.r) / 2) };
                if (W) mid.q = Hex.wrapQ(mid.q, W);
                for (const l of lairs) {
                    if (near(l.q, l.r, a, b, mid, T.lairRadius)) f *= 1 - T.lairCut * Math.max(0.3, Math.min(1, _num(l.strength) / 60));
                }
                for (const u of raiders) {
                    if (near(u.q, u.r, a, b, mid, T.raiderRadius)) f *= 1 - T.raiderCut;
                }
            }
            if (f > 0 && Array.isArray(world.activeEvents) && world.activeEvents.length) {
                const mod = WorldEvents.getModifier(world, 'tradeIncome', ta)
                    + WorldEvents.getModifier(world, link.sea ? 'seaTradeIncome' : 'landTradeIncome', ta);
                f *= Math.max(0, 1 + mod);
            }
            link.factor = Math.max(0, Math.min(2, f));
            if (link.factor < 0.5) {
                for (const s of [a, b]) if (s.market && s.market.trade) s.market.trade.cut = _num(s.market.trade.cut) + 1;
            }
        }
    },

    // ── Reports ───────────────────────────────────────────

    /** The settlement on (q, r), or the nearest one: { settlement, tile } or null. */
    _marketAt(q, r, world) {
        if (!world) return null;
        const tile = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (tile && tile.settlement) return { settlement: tile.settlement, tile };
        const nearest = this.findNearestSettlement(q, r, world);
        if (!nearest) return null;
        const t = typeof world.getTile === 'function' ? world.getTile(nearest.q, nearest.r) : null;
        return { settlement: (t && t.settlement) || nearest, tile: t || { q: nearest.q, r: nearest.r } };
    },

    /**
     * What a good is worth at the market on (or nearest) (q, r) today: its
     * base × the town's scarcity × season × cold demand × world events
     * (SettlementMarket.value) — the price before a market's own markup.
     */
    getPrice(goodId, q, r, world) {
        const base = PlayerEconomy.GOODS[String(goodId).toUpperCase()]?.basePrice || 10;
        const at = this._marketAt(q, r, world);
        if (!at) return base;
        return Math.max(1, Math.round(SettlementMarket.value(world, at.settlement, at.tile, goodId, base)));
    },

    /**
     * Find nearest settlement to given coordinates
     */
    findNearestSettlement(q, r, world) {
        const settlements = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        let nearest = null;
        let minDist = Infinity;

        for (const settlement of settlements) {
            const dist = Hex.wrappingDistance(q, r, settlement.q, settlement.r, world.width);
            if (dist < minDist) {
                minDist = dist;
                nearest = settlement;
            }
        }

        return nearest;
    },

    /** Where the good's price is heading at the market on (or nearest) (q, r): 'rising' | 'falling' | 'stable'. */
    getPriceTrend(goodId, q, r, world) {
        const at = this._marketAt(q, r, world);
        return at ? SettlementMarket.trend(at.settlement, goodId) : 'stable';
    },

    /**
     * The market nearest the player, good by good, for the UI: price, base,
     * trend, stock (supply), daily need (demand), days of need in store,
     * stock label and the change against the base price.
     */
    getMarketSummary(playerQ, playerR, world) {
        const at = this._marketAt(playerQ, playerR, world);
        const summary = [];
        for (const id of SettlementMarket.config().goodIds) {
            const good = PlayerEconomy.GOODS && PlayerEconomy.GOODS[id.toUpperCase()];
            if (!good) continue;
            if (!at) {
                summary.push({
                    id: good.id, name: good.name, icon: good.icon, price: good.basePrice, basePrice: good.basePrice,
                    trend: 'stable', supply: 0, demand: 0, priceChange: 0, location: 'No market nearby',
                });
                continue;
            }
            const info = SettlementMarket.info(at.settlement, id);
            if (!(info.stock > 0) && !(info.need > 0)) continue;
            const price = this.getPrice(id, at.tile.q, at.tile.r, world);
            summary.push({
                id: good.id,
                name: good.name,
                icon: good.icon,
                price,
                basePrice: good.basePrice,
                trend: info.trend,
                supply: Math.floor(info.stock),
                demand: Math.round(info.need * 10) / 10,
                days: info.days,
                label: info.label,
                color: info.color,
                priceChange: Math.round(((price - good.basePrice) / good.basePrice) * 100),
                location: at.settlement.name,
            });
        }
        return summary;
    },
};

// ============================================
// BANKING — moved to systems/finance.js (Banks, Credit & Coin); re-exported
// here so existing imports keep working
// ============================================

export { Banking } from './finance.js';

// ============================================
// TAXATION SYSTEM
// ============================================

export const Taxation = {
    /** Weekly tax base per inhabitant, before the rate. */
    TAX_PER_HEAD: 0.25,

    TAX_RATES: {
        VERY_LOW: { id: 'very_low', name: 'Very Low (5%)', rate: 0.05, happinessBonus: 10, growthBonus: 0.05 },
        LOW: { id: 'low', name: 'Low (10%)', rate: 0.10, happinessBonus: 5, growthBonus: 0.02 },
        MODERATE: { id: 'moderate', name: 'Moderate (15%)', rate: 0.15, happinessBonus: 0, growthBonus: 0 },
        HIGH: { id: 'high', name: 'High (25%)', rate: 0.25, happinessBonus: -10, growthBonus: -0.05 },
        VERY_HIGH: { id: 'very_high', name: 'Very High (40%)', rate: 0.40, happinessBonus: -20, growthBonus: -0.10 }
    },

    /** Office perk (e.g. the Chancellor's +10%) on taxes from the player's settlements. */
    officeTaxMultiplier(player) {
        const title = Titles.getActiveTitle(player);
        const pct = (title && title.perks && title.perks.taxBonusPercent) || 0;
        return 1 + pct / 100;
    },

    /**
     * The settlements the player rules and taxes, as { q, r, settlement }:
     * colonies they founded or conquered (player.colonies) that are still
     * theirs, plus any explicit player.settlements refs. A colony counts while
     * it is marked as the player's, is independent, or sits in the player's
     * own realm; once another crown takes it, it no longer pays you.
     */
    getPlayerSettlements(player, world) {
        const out = [];
        if (!player || !world || typeof world.getTile !== 'function') return out;
        const seen = new Set();
        const add = (ref, requireOwnership) => {
            if (!ref || typeof ref.q !== 'number') return;
            const key = `${ref.q},${ref.r}`;
            if (seen.has(key)) return;
            const tile = world.getTile(ref.q, ref.r);
            const settlement = tile && tile.settlement;
            if (!settlement) return;
            if (requireOwnership) {
                const mine = (settlement.colony && settlement.colony.isPlayerColony)
                    || !settlement.kingdom
                    || (player.allegiance && settlement.kingdom === player.allegiance);
                if (!mine) return;
            }
            seen.add(key);
            out.push({ q: ref.q, r: ref.r, settlement });
        };
        for (const ref of player.settlements || []) add(ref, false);
        for (const ref of player.colonies || []) add(ref, true);
        return out;
    },

    /**
     * Collect taxes from the player's settlements (weekly).
     *
     * The rate sets each settlement's mood: happiness drifts toward
     * 50 + 1.5 × the policy's happiness bonus. Content people pay more
     * (×0.75 at 0 happiness … ×1.25 at 100), grow faster or slower by the
     * policy's yearly growth bonus, and — in conquered towns — warm to or
     * turn against your rule (colony loyalty).
     * Pass { dryRun: true } to estimate without changing anything.
     */
    collectTaxes(player, world, opts = {}) {
        if (!player.taxRate) player.taxRate = 'moderate';
        const dryRun = !!opts.dryRun;

        const taxPolicy = this.TAX_RATES[player.taxRate.toUpperCase()];
        if (!taxPolicy) return { collected: 0, settlements: [] };

        let totalCollected = 0;
        const settlements = [];

        // Collect from the player's settlements (founded/conquered colonies)
        for (const ref of Taxation.getPlayerSettlements(player, world)) {
            const tile = world.getTile(ref.q, ref.r);
            const settlement = ref.settlement;
            const happiness = Taxation.getHappiness(settlement);
            // A quarter of a gold piece per head a week before the rate: a town of
            // 2,000 at moderate taxes yields ~75g a week (docs/economy-balance.md)
            const taxBase = Math.floor(settlement.population * Taxation.TAX_PER_HEAD);
            const landBonus = 1 + (player.landTaxBonus || 0);
            // Rebellions and crises cut collections; gold rushes swell them
            const eventMult = Math.max(0, 1 + WorldEvents.getModifier(world, 'taxIncome', tile));
            const moodMult = 0.75 + happiness / 200;
            // Holdings development (systems/holdings.js): markets, harbours and a
            // good steward raise the take; a skimming governor or a revolt cuts it
            const holdingMult = Taxation.holdingFx(settlement, 'taxMult', 1);
            const taxCollected = Math.floor(taxBase * taxPolicy.rate * landBonus * Taxation.officeTaxMultiplier(player) * eventMult * moodMult * holdingMult);

            totalCollected += taxCollected;
            const growthRate = Taxation.getGrowthRate(settlement, taxPolicy);
            const projectedPopulation = Taxation.projectPopulation(settlement, 30, growthRate);
            const entry = {
                name: settlement.name,
                q: ref.q,
                r: ref.r,
                collected: taxCollected,
                population: settlement.population,
                happiness: Math.round(happiness),
                peoplesMood: Taxation.peoplesMood(settlement),
                growthRate,
                projectedPopulation,
                // Next month's weekly take, if the town grows (or shrinks) as projected
                projectedCollected: settlement.population > 0
                    ? Math.floor(taxCollected * projectedPopulation / settlement.population)
                    : taxCollected,
            };
            settlements.push(entry);
            if (!dryRun) Taxation._applyTaxMood(settlement, taxPolicy, entry);
        }

        if (!dryRun) player.gold += totalCollected;

        return { collected: totalCollected, settlements, policy: taxPolicy };
    },

    /** One cached holdings effect of a settlement (settlement.holding.fx, systems/holdings.js). */
    holdingFx(settlement, key, fallback = 0) {
        const fx = settlement && settlement.holding && settlement.holding.fx;
        const v = fx && fx[key];
        return typeof v === 'number' && isFinite(v) ? v : fallback;
    },

    /** Mood points a town's great works and donated art add (systems/patronage.js). */
    patronageMood(settlement) {
        const v = settlement && settlement.patronage && settlement.patronage.mood;
        return typeof v === 'number' && isFinite(v) ? v : 0;
    },

    /** Mood points a settlement's peoples add to its happiness target (systems/peoples). */
    peoplesMood(settlement) {
        return (settlement && settlement.peoplesEffects && settlement.peoplesEffects.stability) || 0;
    },

    /**
     * A settlement's yearly growth rate (fraction per 120-day year), as last
     * set by tax collection; falls back to the current policy's growth bonus.
     */
    getGrowthRate(settlement, taxPolicy = null) {
        if (settlement && typeof settlement.growthRate === 'number') return settlement.growthRate;
        return ((taxPolicy && taxPolicy.growthBonus) || 0) + Taxation.holdingFx(settlement, 'growth');
    },

    /** Population `days` from now at `growthRate` per year (defaults to the settlement's own). */
    projectPopulation(settlement, days = 30, growthRate = null) {
        const pop = (settlement && settlement.population) || 0;
        const rate = typeof growthRate === 'number' ? growthRate : Taxation.getGrowthRate(settlement);
        // Tax-driven decline never drops a town below 10 (see _applyTaxMood)
        return Math.max(Math.min(pop, 10), Math.round(pop * (1 + rate * days / 120)));
    },

    /** A settlement's happiness 0..100 (50 when never taxed). */
    getHappiness(settlement) {
        return typeof settlement.happiness === 'number' ? settlement.happiness : 50;
    },

    /** Weekly mood, growth and loyalty change from the tax policy. */
    _applyTaxMood(settlement, taxPolicy, entry) {
        // Orderly, harmonious peoples settle happier; restless ones less so
        const peoplesMood = Taxation.peoplesMood(settlement);
        // Taverns, temples and squares in a developed holding lift the mood
        const holdingMood = Taxation.holdingFx(settlement, 'happiness');
        // Great works and donated art (systems/patronage.js → settlement.patronage)
        const target = Math.max(0, Math.min(100, 50 + taxPolicy.happinessBonus * 1.5 + peoplesMood + holdingMood + Taxation.patronageMood(settlement)));
        const happiness = Taxation.getHappiness(settlement);
        settlement.happiness = Math.max(0, Math.min(100, happiness + (target - happiness) * 0.25));
        entry.happiness = Math.round(settlement.happiness);

        // growthBonus is per year (120 days); a collection covers a week
        settlement.growthRate = taxPolicy.growthBonus + Taxation.holdingFx(settlement, 'growth');
        const delta = Math.round(settlement.population * settlement.growthRate * 7 / 120);
        if (delta !== 0) settlement.population = Math.max(10, settlement.population + delta);
        entry.populationChange = delta;

        // Conquered towns warm to light taxes and resent heavy ones
        if (settlement.colony && typeof settlement.colony.loyalty === 'number') {
            const shift = (settlement.happiness - 50) / 25;
            settlement.colony.loyalty = Math.max(0, Math.min(100, settlement.colony.loyalty + shift));
            entry.loyaltyChange = Math.round(shift * 10) / 10;
        }
    },

    /**
     * Who may set tax rates: a lord of their own settlements, or a royal
     * official — the King, Chancellor or Tax Collector (Treasurer in old saves).
     */
    canSetTaxes(player) {
        if (!player) return false;
        if (player.settlements && player.settlements.length > 0) return true;
        if ((player.colonies || []).length > 0) return true;
        return !!(player.allegiance && ['king', 'chancellor', 'tax_collector', 'treasurer'].includes(player.kingdomTitle));
    },

    /**
     * Change tax rate
     */
    setTaxRate(player, newRate, world = null) {
        if (!Taxation.canSetTaxes(player)) {
            return { success: false, reason: 'Only a lord of settlements, the King, the Chancellor or the Tax Collector can set tax rates' };
        }

        const policy = this.TAX_RATES[newRate.toUpperCase()];
        if (!policy) return { success: false, reason: 'Invalid tax rate' };

        const currentPolicy = this.TAX_RATES[(player.taxRate || 'moderate').toUpperCase()] || this.TAX_RATES.MODERATE;
        // A sworn official answers to the council; an independent lord does not
        if (policy.rate > currentPolicy.rate && player.allegiance && typeof Councils !== 'undefined') {
            const approval = Councils.canRaiseTaxes(player, newRate, world);
            if (!approval.success) {
                return { success: false, reason: approval.reason };
            }
        }

        player.taxRate = newRate;
        return { success: true, policy };
    }
};
