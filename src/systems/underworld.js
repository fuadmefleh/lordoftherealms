// ============================================
// THE UNDERWORLD — heat, the Thieves' Guild, contraband and fences
// ============================================
// A criminal path through the realms:
//
//   Heat       — per-kingdom notoriety (0-100). Crimes raise it; it cools a
//                little every day, faster while lying low, and bribes buy it
//                down. High heat brings guard searches at the gate (contraband
//                and hot goods confiscated, fines, arrest into the existing
//                jail), wanted posters (a Gossip bounty) and, higher still, a
//                kingdom warrant (Gossip.warrants).
//   The Guild  — met through a tavern contact in a town or city. Ranks run
//                Footpad → Guildmaster; jobs (pickpocketing, burglary,
//                protection rackets, planned heists) roll odds from stealth,
//                stats, earned traits (Cunning and Deceitful help) and the
//                place's guard strength. The Guildmaster takes a weekly cut.
//   Contraband — goods illegal or tariffed per kingdom, decided by culture and
//                faith (data/underworld.json → contraband). The black market
//                pays a premium, more under blockade and in the lean season.
//   Hot goods  — stolen goods stay "hot" for some days; only a fence buys them.
//
// Content lives in data/underworld.json (DataLoader.underworld). No import-time
// side effects; every roll goes through Utils.random. `world` / `player` are
// always passed in — no globals.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Seasons } from '../world/seasons.js';
import { Gossip } from './gossip.js';
import { Traits } from './traits.js';
import { Ships } from './ships.js';
import { Economy } from '../world/economy.js';
import { Quests } from './quests.js';

const LOG_CAP = 20;
const SETTLEMENT_ORDER = ['village', 'town', 'city', 'capital'];

/** Fallbacks so the system still works when the data file is missing. */
const DEFAULTS = {
    heat: {
        max: 100, decayPerDay: 1, lieLowDecayPerDay: 4, lieLowDays: 3,
        watchedAt: 25, posterAt: 50, arrestAt: 60, warrantAt: 80,
        posterBountyPerHeat: 4, searchBase: 0.15, searchPerHeat: 0.008, searchMax: 0.85,
        arrestChance: 0.45, searchFinePerHeat: 2, contrabandFineShare: 0.5, cleanSearchRelief: 3,
        jailBaseDays: 2, jailDaysPerHeat: 0.08, jailBailPerDay: 35,
    },
    odds: {
        min: 0.05, max: 0.95, stealthPerPoint: 0.04, statPerPoint: 0.015, rankPerLevel: 0.02,
        guardPenaltyPerPoint: 0.06, heatPenaltyPerPoint: 0.002, traits: { cunning: 0.08, deceitful: 0.06 },
    },
    guild: {
        name: "The Thieves' Guild", contactCost: 30, joinFee: 100,
        contactSettlementTypes: ['town', 'city', 'capital'],
        ranks: [{ id: 'footpad', name: 'Footpad', icon: '👣', standing: 0 }],
        knownMemberRank: 2, guildmasterCut: { base: 150, perRacket: 25 },
        bribeDiscountPerRank: 0.05, fenceRateBase: 0.5, fenceRatePerRank: 0.04,
    },
    bribe: { maxRelief: 30, goldPerHeatPerGuard: 2.5, failChance: 0.1, failHeat: 5, charismaPerPoint: 0.01 },
    blackMarket: {
        legal: 1.05, tariff: 1.35, illegal: 1.9, blockadeBonus: 0.5, closedPortBonus: 0.75,
        leanFoodBonus: 0.35, leanContrabandBonus: 0.15, catchBase: 0.08, catchPerGuard: 0.035,
        catchPerHeat: 0.003, catchBlockade: 0.15, catchLegalShare: 0.4, stealthRelief: 0.02,
        blockadeHeatMultiplier: 2,
    },
    hotDays: 10,
    racketBustChance: 0.25,
};

function _num(v, d = 0) {
    return typeof v === 'number' && isFinite(v) ? v : d;
}

function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function _key(q, r) {
    return `${q},${r}`;
}

function _label(id) {
    return String(id).replace(/_/g, ' ');
}

export const Underworld = {
    // ──────────── DATA ────────────

    /** The underworld content (data/underworld.json), or {}. */
    data() {
        return DataLoader.underworld || (DataLoader.get && DataLoader.get('underworld')) || {};
    },

    /** A config block merged over its defaults (heat, odds, guild, bribe, blackMarket). */
    cfg(section) {
        const d = Underworld.data()[section];
        const base = DEFAULTS[section];
        if (base && typeof base === 'object' && !Array.isArray(base)) return { ...base, ...(d || {}) };
        return d !== undefined ? d : base;
    },

    crimeDef(id) {
        return (Underworld.data().crimes || {})[id] || { heat: 3, caughtHeat: 10, deeds: {}, karma: 0 };
    },

    jobDef(id) {
        return (Underworld.data().jobs || {})[id] || null;
    },

    ranks() {
        const r = Underworld.cfg('guild').ranks;
        return Array.isArray(r) && r.length ? r : DEFAULTS.guild.ranks;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            heat: {},
            posters: {},
            guild: { contactMet: false, member: false, joinedDay: null, standing: 0, rank: 0, exposed: false, jobsDone: {}, lastCutDay: null },
            hot: [],
            rackets: [],
            heist: null,
            lyingLow: null,
            log: [],
            stats: { crimes: 0, caught: 0, earned: 0 },
        };
    },

    /** Get (creating / backfilling) the player's underworld state. */
    ensure(player) {
        if (!player) return null;
        let st = player.underworld;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.underworld = Underworld._blank();
            return player.underworld;
        }
        const blank = Underworld._blank();
        if (!st.heat || typeof st.heat !== 'object') st.heat = {};
        if (!st.posters || typeof st.posters !== 'object') st.posters = {};
        st.guild = { ...blank.guild, ...(st.guild && typeof st.guild === 'object' ? st.guild : {}) };
        if (!st.guild.jobsDone || typeof st.guild.jobsDone !== 'object') st.guild.jobsDone = {};
        if (!Array.isArray(st.hot)) st.hot = [];
        if (!Array.isArray(st.rackets)) st.rackets = [];
        if (st.heist === undefined) st.heist = null;
        if (st.lyingLow === undefined) st.lyingLow = null;
        if (!Array.isArray(st.log)) st.log = [];
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        return st;
    },

    /** Restore after a load: backfills a blank record for saves from before the underworld. */
    loadState(player) {
        return Underworld.ensure(player);
    },

    serialize(player) {
        if (!player || !player.underworld) return null;
        return JSON.parse(JSON.stringify(player.underworld));
    },

    _log(player, world, text) {
        const st = Underworld.ensure(player);
        st.log.push({ day: (world && world.day) || 0, text });
        if (st.log.length > LOG_CAP) st.log.splice(0, st.log.length - LOG_CAP);
    },

    // ──────────── PLACES ────────────

    _settlementKingdom(world, settlement) {
        if (!settlement || !settlement.kingdom || !world || !world.getKingdom) return null;
        return world.getKingdom(settlement.kingdom) || null;
    },

    /**
     * Guard strength of a settlement: its size, the realm's character, and —
     * in one of the player's holdings — the watch they built (watchtower,
     * walls: holding.fx.raidReduction) and the troops they stationed there.
     */
    guardStrength(settlement, kingdom = null) {
        if (!settlement) return 0;
        const g = Underworld.data().guardStrength || {};
        let s = _num(g[settlement.type], { village: 1, town: 2, city: 3, capital: 4 }[settlement.type] || 1);
        for (const t of (kingdom && kingdom.traits) || []) s += _num((g.kingdomTraits || {})[t]);
        const h = Underworld._ownHolding(settlement);
        if (h) {
            s += Economy.holdingFx(settlement, 'raidReduction') * _num(g.holdingWatch, 2);
            s += Math.min(_num(g.holdingGarrisonMax, 1.5), (Array.isArray(h.garrison) ? h.garrison.length : 0) * _num(g.holdingGarrisonPer, 0.25));
        }
        return Math.max(0.5, s);
    },

    /** The development record of a settlement the player holds (systems/holdings.js), else null. */
    _ownHolding(settlement) {
        const h = settlement && settlement.holding;
        return h && typeof h === 'object' && !h.lost ? h : null;
    },

    _typeRank(type) {
        const i = SETTLEMENT_ORDER.indexOf(type);
        return i < 0 ? 0 : i;
    },

    /** Can a guild contact be found in this settlement? */
    hasGuildPresence(settlement) {
        if (!settlement) return false;
        return (Underworld.cfg('guild').contactSettlementTypes || []).includes(settlement.type);
    },

    // ──────────── HEAT ────────────

    getHeat(player, kingdomId) {
        if (!player || !kingdomId || !player.underworld) return 0;
        return _num(player.underworld.heat[kingdomId]);
    },

    /** 'clear' | 'watched' | 'poster' | 'warrant' */
    heatLevel(heat) {
        const h = Underworld.cfg('heat');
        if (heat >= h.warrantAt) return 'warrant';
        if (heat >= h.posterAt) return 'poster';
        if (heat >= h.watchedAt) return 'watched';
        return 'clear';
    },

    /**
     * Raise (or lower, with a negative amount) heat in a kingdom. Crossing the
     * poster line puts a bounty on the player through Gossip; crossing the
     * warrant line issues a kingdom warrant. Returns the new heat.
     */
    addHeat(player, kingdomId, amount, world = null) {
        if (!player || !kingdomId || !amount) return Underworld.getHeat(player, kingdomId);
        const st = Underworld.ensure(player);
        const h = Underworld.cfg('heat');
        const before = _num(st.heat[kingdomId]);
        const after = _clamp(before + amount, 0, h.max);
        if (after <= 0) delete st.heat[kingdomId];
        else st.heat[kingdomId] = Math.round(after * 100) / 100;
        if (amount > 0) Underworld._wantedCheck(player, kingdomId, after, world);
        if (after < h.posterAt) delete st.posters[kingdomId];
        return after;
    },

    _wantedCheck(player, kingdomId, heat, world) {
        const st = Underworld.ensure(player);
        const h = Underworld.cfg('heat');
        const day = (world && world.day) || 0;
        if (heat >= h.posterAt && !st.posters[kingdomId]) {
            st.posters[kingdomId] = day || 1;
            Gossip.initializePlayer(player);
            player.gossip.bounties = player.gossip.bounties.filter(b => !(b.kingdom === kingdomId && b.description === 'underworld'));
            player.gossip.bounties.push({
                rumorId: null,
                kingdom: kingdomId,
                gold: Math.round(heat * h.posterBountyPerHeat),
                issuedDay: day,
                description: 'underworld',
            });
            Underworld._log(player, world, `Wanted posters went up in ${Underworld._kingdomName(world, kingdomId)}.`);
        }
        if (heat >= h.warrantAt) {
            Gossip.initializePlayer(player);
            if (!player.gossip.warrants) player.gossip.warrants = {};
            if (!player.gossip.warrants[kingdomId]) {
                player.gossip.warrants[kingdomId] = { issuedDay: day, rumorId: null, source: 'underworld' };
                Underworld._log(player, world, `The crown of ${Underworld._kingdomName(world, kingdomId)} issued a warrant for you.`);
            }
        }
    },

    _kingdomName(world, kingdomId) {
        const k = world && world.getKingdom ? world.getKingdom(kingdomId) : null;
        return (k && k.name) || kingdomId;
    },

    /** Heat in every realm, hottest first: [{ kingdomId, name, heat, level }]. */
    heatTable(player, world) {
        const st = Underworld.ensure(player);
        return Object.entries(st.heat)
            .filter(([, v]) => v > 0)
            .map(([kingdomId, heat]) => ({ kingdomId, name: Underworld._kingdomName(world, kingdomId), heat: Math.round(heat), level: Underworld.heatLevel(heat) }))
            .sort((a, b) => b.heat - a.heat);
    },

    /**
     * Record a criminal deed: heat in the kingdom, Traits deeds, karma, and —
     * when caught — a theft rumour through Gossip and exposure as a guild man.
     * @param {object} opts { kingdom, caught, scale, q, r, location, victim }
     */
    recordCrime(player, world, crimeId, opts = {}) {
        if (!player) return { heat: 0 };
        const st = Underworld.ensure(player);
        const def = Underworld.crimeDef(crimeId);
        const scale = _num(opts.scale, 1);
        const kingdom = opts.kingdom || null;
        const heatGain = (opts.caught ? _num(def.caughtHeat, def.heat) : _num(def.heat)) * scale;
        const heat = kingdom ? Underworld.addHeat(player, kingdom, heatGain, world) : 0;
        const deeds = {};
        for (const [d, v] of Object.entries(def.deeds || {})) deeds[d] = _num(v) * scale;
        Traits.recordDeeds(player, deeds);
        if (def.karma) player.karma = Math.max(-100, (player.karma || 0) + Math.round(def.karma * scale));
        st.stats.crimes++;
        if (opts.caught) {
            st.stats.caught++;
            if (st.guild.member && st.guild.rank >= 1) st.guild.exposed = true;
            if (world && opts.q != null && opts.r != null) {
                Gossip.reportCrime(player, world, {
                    crimeType: 'theft',
                    victim: opts.victim || { name: 'the townsfolk', type: 'merchant', icon: '🧑' },
                    q: opts.q, r: opts.r,
                    // The watch that caught you are the witnesses
                    scene: { npcs: [{ name: 'the watch', type: 'guard', id: 'watch', q: 0, r: 0 }], q: 0, r: 0 },
                });
            }
        }
        return { heat };
    },

    // ──────────── ODDS ────────────

    /** Odds bonus from earned traits (Cunning, Deceitful help; Honest hinders). */
    traitBonus(player) {
        let b = 0;
        for (const [id, v] of Object.entries(Underworld.cfg('odds').traits || {})) {
            if (Traits.has(player, id)) b += _num(v);
        }
        return b;
    },

    /**
     * Chance a job succeeds at a settlement: the job's base, plus stealth, a
     * stat, guild rank and traits, minus guard strength and local heat.
     */
    jobOdds(player, world, settlement, jobId, extra = 0) {
        const job = Underworld.jobDef(jobId);
        const o = Underworld.cfg('odds');
        if (!job || !player) return 0;
        const st = Underworld.ensure(player);
        const kingdom = Underworld._settlementKingdom(world, settlement);
        const stealth = _num(player.skills && player.skills.stealth, 1);
        const stat = _num(player[job.stat], 5);
        let p = _num(job.base, 0.5)
            + stealth * o.stealthPerPoint
            + (stat - 5) * o.statPerPoint
            + st.guild.rank * o.rankPerLevel
            + Underworld.traitBonus(player)
            - Underworld.guardStrength(settlement, kingdom) * o.guardPenaltyPerPoint
            - Underworld.getHeat(player, settlement && settlement.kingdom) * o.heatPenaltyPerPoint
            + extra;
        return _clamp(p, o.min, o.max);
    },

    // ──────────── CONTRABAND ────────────

    /** 'illegal' | 'tariff' | 'legal' for a good in a kingdom (culture, faith, piety). */
    contrabandStatus(kingdom, goodId) {
        const c = Underworld.data().contraband || {};
        let status = 'legal';
        const apply = (table) => {
            const s = table && table[goodId];
            if (s === 'illegal') status = 'illegal';
            else if (s === 'tariff' && status === 'legal') status = 'tariff';
        };
        apply(c.global);
        if (kingdom) {
            apply((c.byCulture || {})[kingdom.culture]);
            const faith = kingdom.religion && kingdom.religion.faithId;
            if (faith) apply((c.byFaith || {})[faith]);
            const pious = c.pious;
            if (pious && kingdom.religion && _num(kingdom.religion.piety) >= _num(pious.pietyAtLeast, 101)) apply(pious.goods);
        }
        return status;
    },

    /** Every good a kingdom bans or tariffs: { illegal: [ids], tariff: [ids] }. */
    contrabandList(kingdom) {
        const c = Underworld.data().contraband || {};
        const ids = new Set(Object.keys(c.global || {}));
        if (kingdom) {
            for (const id of Object.keys((c.byCulture || {})[kingdom.culture] || {})) ids.add(id);
            const faith = kingdom.religion && kingdom.religion.faithId;
            for (const id of Object.keys((c.byFaith || {})[faith] || {})) ids.add(id);
            for (const id of Object.keys((c.pious && c.pious.goods) || {})) ids.add(id);
        }
        const out = { illegal: [], tariff: [] };
        for (const id of ids) {
            const s = Underworld.contrabandStatus(kingdom, id);
            if (s !== 'legal') out[s].push(id);
        }
        return out;
    },

    /**
     * May the player sell this good at the legal market here? Hot goods and
     * contraband are refused; tariffed goods sell at a cut.
     * @returns {{ ok: boolean, reason?: string, priceMult: number }}
     */
    legalSaleCheck(player, goodId, quantity, settlement, world) {
        const day = world && Number.isFinite(world.day) ? world.day : null;
        const held = _num(player && player.inventory && player.inventory[goodId]);
        const hot = Underworld.hotQty(player, goodId, day);
        if (hot > 0 && quantity > held - hot) {
            return { ok: false, reason: `${hot} of your ${_label(goodId)} are stolen and still hot — only a fence will take them.`, priceMult: 1 };
        }
        const kingdom = Underworld._settlementKingdom(world, settlement);
        const status = Underworld.contrabandStatus(kingdom, goodId);
        if (status === 'illegal' && kingdom) {
            return { ok: false, reason: `${_label(goodId)} is contraband in ${kingdom.name}. The black market will take it — at a risk.`, priceMult: 1 };
        }
        if (status === 'tariff' && kingdom) {
            const rate = _num((Underworld.data().contraband || {}).tariffRate, 0.25);
            return { ok: true, priceMult: 1 - rate, tariff: rate };
        }
        return { ok: true, priceMult: 1 };
    },

    // ──────────── HOT GOODS ────────────

    /** Mark stolen goods as hot until `day + hotDays`. */
    markHot(player, itemId, qty, day) {
        if (!player || !itemId || !(qty > 0)) return;
        const st = Underworld.ensure(player);
        const until = _num(day) + _num(Underworld.data().hotDays, DEFAULTS.hotDays);
        st.hot.push({ item: itemId, qty, untilDay: until });
    },

    /** Units of a good still hot (never more than the player carries). */
    hotQty(player, itemId, day = null) {
        if (!player || !player.underworld || !Array.isArray(player.underworld.hot)) return 0;
        let n = 0;
        for (const h of player.underworld.hot) {
            if (h.item !== itemId) continue;
            if (day != null && h.untilDay <= day) continue;
            n += _num(h.qty);
        }
        return Math.min(n, _num(player.inventory && player.inventory[itemId]));
    },

    /** Goods carried that are hot: [{ item, qty, daysLeft }]. */
    hotGoods(player, day) {
        const st = Underworld.ensure(player);
        const by = {};
        for (const h of st.hot) {
            if (day != null && h.untilDay <= day) continue;
            by[h.item] = by[h.item] || { item: h.item, qty: 0, daysLeft: 0 };
            by[h.item].qty += _num(h.qty);
            by[h.item].daysLeft = Math.max(by[h.item].daysLeft, h.untilDay - _num(day));
        }
        return Object.values(by)
            .map(g => ({ ...g, qty: Math.min(g.qty, _num(player.inventory && player.inventory[g.item])) }))
            .filter(g => g.qty > 0);
    },

    /** Remove `qty` units from the hot ledger (oldest first). */
    _consumeHot(player, itemId, qty) {
        const st = Underworld.ensure(player);
        let left = qty;
        for (const h of st.hot) {
            if (left <= 0) break;
            if (h.item !== itemId) continue;
            const take = Math.min(h.qty, left);
            h.qty -= take;
            left -= take;
        }
        st.hot = st.hot.filter(h => h.qty > 0);
    },

    _removeGoods(player, itemId, qty) {
        if (!player.inventory || !(player.inventory[itemId] > 0)) return 0;
        const take = Math.min(qty, player.inventory[itemId]);
        player.inventory[itemId] -= take;
        if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
        return take;
    },

    /** Add stolen loot through the capped inventory and mark what fit as hot. */
    _addLoot(player, world, items) {
        const added = {};
        const dropped = {};
        for (const [id, qty] of Object.entries(items)) {
            const res = PlayerInventory.addItem(player, id, qty);
            if (res.success) {
                added[id] = qty;
                Underworld.markHot(player, id, qty, (world && world.day) || 0);
            } else {
                dropped[id] = qty;
            }
        }
        return { added, dropped };
    },

    // ──────────── BLACK MARKET & FENCES ────────────

    _baseValue(goodId) {
        return PlayerInventory.goodValue(goodId) || 10;
    },

    /** Blockade on a settlement's realm and port: { blockaded, closedPort }. */
    blockadeAt(world, tile) {
        const settlement = tile && tile.settlement;
        const kingdom = Underworld._settlementKingdom(world, settlement);
        const blockaded = !!(kingdom && KingdomNavy.isBlockaded(kingdom));
        let closedPort = false;
        if (blockaded && tile && world && world.getTile) {
            const pb = KingdomNavy.portBlockade(world, tile.q, tile.r);
            closedPort = !!(pb && pb.closed);
        }
        return { blockaded, closedPort };
    },

    /** Multiplier on what the black market pays here for a good. */
    blackMarketMultiplier(world, tile, goodId) {
        const bm = Underworld.cfg('blackMarket');
        const kingdom = Underworld._settlementKingdom(world, tile && tile.settlement);
        const status = Underworld.contrabandStatus(kingdom, goodId);
        let mult = _num(bm[status], 1);
        const b = Underworld.blockadeAt(world, tile);
        if (b.blockaded) mult += bm.blockadeBonus;
        if (b.closedPort) mult += bm.closedPortBonus;
        const day = Seasons.today(world);
        if (Seasons.isLean(day)) {
            if (Seasons.priceGroup(goodId) === 'food') mult += bm.leanFoodBonus;
            if (status !== 'legal') mult += bm.leanContrabandBonus;
        }
        return mult;
    },

    blackMarketPrice(world, tile, goodId) {
        const price = Math.max(1, Math.floor(Underworld._baseValue(goodId) * Underworld.blackMarketMultiplier(world, tile, goodId)));
        return Math.min(price, Underworld.openSaleCap(world, tile, goodId));
    },

    /**
     * Ceiling on what the underworld pays per unit for goods sold openly on
     * this tile or in a settlement next door: half the open asking price
     * (market or port) — the least a player's discounts can buy them for —
     * so nothing bought here or next door sells straight back to a fence or
     * the black market at a profit. The contraband premium is for goods you
     * can't simply buy in the square.
     */
    openSaleCap(world, tile, goodId) {
        const settlement = tile && tile.settlement;
        if (!settlement) return Infinity;
        // Banned goods aren't on open sale here (Trading.getAvailableGoods skips them)
        const banned = Underworld.contrabandStatus(Underworld._settlementKingdom(world, settlement), goodId) === 'illegal';
        let ask = banned ? null : Economy.marketAsk(world, tile, goodId);
        if (world && typeof world.getTile === 'function') {
            const near = Ships.nearbyAsks(world, tile.q, tile.r, goodId, { skipHereMarket: banned });
            for (const a of [near.market, near.port]) {
                if (a != null) ask = ask == null ? a : Math.min(ask, a);
            }
        }
        return ask == null ? Infinity : Math.max(1, Math.floor(ask * 0.5));
    },

    /**
     * Multiplier on a smuggling route's take at its destination: a blockaded
     * realm and the lean season pay more for what slips through.
     */
    smugglingProfitMultiplier(world, tile) {
        const bm = Underworld.cfg('blackMarket');
        const b = Underworld.blockadeAt(world, tile);
        let mult = 1;
        if (b.blockaded) mult += bm.blockadeBonus;
        if (b.closedPort) mult += bm.closedPortBonus * 0.5;
        if (Seasons.isLean(Seasons.today(world))) mult += bm.leanContrabandBonus;
        return mult;
    },

    /** Extra chance a smuggling run into this settlement is caught (blockade patrols). */
    smugglingCatchBonus(world, tile) {
        return Underworld.blockadeAt(world, tile).blockaded ? Underworld.cfg('blackMarket').catchBlockade : 0;
    },

    /** Chance a black-market deal here goes wrong. */
    blackMarketCatchChance(player, world, tile, goodId) {
        const bm = Underworld.cfg('blackMarket');
        const settlement = tile && tile.settlement;
        const kingdom = Underworld._settlementKingdom(world, settlement);
        const status = Underworld.contrabandStatus(kingdom, goodId);
        let p = bm.catchBase
            + Underworld.guardStrength(settlement, kingdom) * bm.catchPerGuard
            + Underworld.getHeat(player, settlement && settlement.kingdom) * bm.catchPerHeat
            + (Underworld.blockadeAt(world, tile).blockaded ? bm.catchBlockade : 0)
            - _num(player.skills && player.skills.stealth, 1) * bm.stealthRelief
            - Underworld.traitBonus(player) * 0.5;
        if (status === 'legal') p *= bm.catchLegalShare;
        return _clamp(p, 0.02, 0.9);
    },

    /** What the black market here would pay for each good carried (hot goods excluded). */
    blackMarketOffers(player, world, tile) {
        const day = Seasons.today(world);
        const kingdom = Underworld._settlementKingdom(world, tile && tile.settlement);
        const out = [];
        for (const [id, qty] of Object.entries(player.inventory || {})) {
            if (id === 'gold' || !(qty > 0)) continue;
            const cool = qty - Underworld.hotQty(player, id, day);
            if (cool <= 0) continue;
            out.push({
                item: id, qty: cool,
                status: Underworld.contrabandStatus(kingdom, id),
                price: Underworld.blackMarketPrice(world, tile, id),
                risk: Underworld.blackMarketCatchChance(player, world, tile, id),
            });
        }
        return out.sort((a, b) => b.price - a.price);
    },

    /**
     * Sell goods on the black market: a premium price for a risk of being
     * caught (goods confiscated, a fine, heat, maybe arrest). Feeds heat even
     * when it goes well — more for contraband, double under blockade.
     */
    sellBlackMarket(player, world, tile, goodId, qty = 1) {
        const settlement = tile && tile.settlement;
        if (!settlement) return { success: false, reason: 'There is no black market out here.' };
        const day = Seasons.today(world);
        const held = _num(player.inventory && player.inventory[goodId]);
        const cool = held - Underworld.hotQty(player, goodId, day);
        if (!(qty > 0) || cool < qty) return { success: false, reason: 'You do not have that many to sell (hot goods go to a fence).' };
        if ((player.actionPoints || 0) < 1) return { success: false, reason: 'A deal costs 1 action point.' };
        player.actionPoints -= 1;
        const kingdom = Underworld._settlementKingdom(world, settlement);
        const status = Underworld.contrabandStatus(kingdom, goodId);
        const bm = Underworld.cfg('blackMarket');
        const blockade = Underworld.blockadeAt(world, tile).blockaded;
        const scale = (status === 'illegal' ? 2 : status === 'tariff' ? 1.25 : 0.5) * (blockade ? bm.blockadeHeatMultiplier : 1);
        const price = Underworld.blackMarketPrice(world, tile, goodId);
        const caught = Utils.random() < Underworld.blackMarketCatchChance(player, world, tile, goodId);
        Underworld._removeGoods(player, goodId, qty);
        if (caught) {
            const fine = Math.min(player.gold || 0, Math.floor(price * qty * 0.5));
            player.gold -= fine;
            Underworld.recordCrime(player, world, 'black_market', { kingdom: settlement.kingdom, caught: true, scale, q: tile.q, r: tile.r });
            const arrest = Underworld._maybeArrest(player, world, settlement, 'black-market dealing', 0.35);
            const text = `The watch raided the deal. ${qty} ${_label(goodId)} confiscated, fined ${fine}g.${arrest ? ` ${arrest.text}` : ''}`;
            Underworld._log(player, world, text);
            return { success: true, caught: true, fine, arrested: !!arrest, text };
        }
        const earned = price * qty;
        player.gold = (player.gold || 0) + earned;
        if (player.financeToday && player.financeToday.income) {
            player.financeToday.income.smuggling = (player.financeToday.income.smuggling || 0) + earned;
        }
        Underworld.ensure(player).stats.earned += earned;
        Underworld.recordCrime(player, world, 'black_market', { kingdom: settlement.kingdom, scale });
        if (blockade) Quests.track(player, 'blockade_runs');
        const text = `Sold ${qty} ${_label(goodId)} on the black market for ${earned}g${blockade ? ' — the blockade has the whole town paying double' : ''}.`;
        return { success: true, caught: false, earned, text };
    },

    /** Share of base value a fence pays (better with guild rank). */
    fenceRate(player) {
        const g = Underworld.cfg('guild');
        const rank = Underworld.ensure(player).guild.rank;
        return _clamp(g.fenceRateBase + rank * g.fenceRatePerRank, 0.1, 0.95);
    },

    fencePrice(player, goodId, world = null, tile = null) {
        const price = Math.max(1, Math.floor(Underworld._baseValue(goodId) * Underworld.fenceRate(player)));
        return Math.min(price, Underworld.openSaleCap(world, tile, goodId));
    },

    /** Can the player reach a fence here? (a guild member, or a contact met) */
    canUseFence(player, settlement) {
        const st = Underworld.ensure(player);
        return !!settlement && Underworld.hasGuildPresence(settlement) && (st.guild.member || st.guild.contactMet);
    },

    /** Sell goods — hot or not — to a fence: no questions asked, a poor price. */
    sellToFence(player, world, tile, goodId, qty = 1) {
        const settlement = tile && tile.settlement;
        if (!Underworld.canUseFence(player, settlement)) return { success: false, reason: 'You know no fence here.' };
        const held = _num(player.inventory && player.inventory[goodId]);
        if (!(qty > 0) || held < qty) return { success: false, reason: 'You do not have that many.' };
        const day = Seasons.today(world);
        const hot = Math.min(qty, Underworld.hotQty(player, goodId, day));
        const price = Underworld.fencePrice(player, goodId, world, tile);
        Underworld._removeGoods(player, goodId, qty);
        if (hot > 0) Underworld._consumeHot(player, goodId, hot);
        const earned = price * qty;
        player.gold = (player.gold || 0) + earned;
        if (player.financeToday && player.financeToday.income) {
            player.financeToday.income.theft = (player.financeToday.income.theft || 0) + earned;
        }
        Underworld.ensure(player).stats.earned += earned;
        Underworld.recordCrime(player, world, 'fence', { kingdom: settlement.kingdom, scale: hot > 0 ? 1 : 0.5 });
        if (hot > 0) Underworld._gainStanding(player, world, 1);
        return { success: true, earned, text: `The fence took ${qty} ${_label(goodId)} for ${earned}g, no questions asked.` };
    },

    // ──────────── THE GUILD ────────────

    getRank(player) {
        const ranks = Underworld.ranks();
        const st = Underworld.ensure(player);
        return ranks[_clamp(st.guild.rank, 0, ranks.length - 1)];
    },

    nextRank(player) {
        const ranks = Underworld.ranks();
        const st = Underworld.ensure(player);
        return ranks[st.guild.rank + 1] || null;
    },

    isGuildmaster(player) {
        const st = Underworld.ensure(player);
        return st.guild.member && st.guild.rank >= Underworld.ranks().length - 1;
    },

    /** Known as a guild man: exposed when caught at Cutpurse or above, or ranked high enough. */
    isKnownMember(player) {
        if (!player || !player.underworld) return false;
        const g = player.underworld.guild;
        if (!g || !g.member) return false;
        return !!g.exposed || g.rank >= _num(Underworld.cfg('guild').knownMemberRank, 2);
    },

    _gainStanding(player, world, amount) {
        const st = Underworld.ensure(player);
        if (!st.guild.member || !(amount > 0)) return null;
        st.guild.standing += amount;
        const ranks = Underworld.ranks();
        let promoted = null;
        while (ranks[st.guild.rank + 1] && st.guild.standing >= _num(ranks[st.guild.rank + 1].standing)) {
            st.guild.rank++;
            promoted = ranks[st.guild.rank];
        }
        if (promoted) Underworld._log(player, world, `Rose to ${promoted.name} in the guild.`);
        return promoted;
    },

    /** Find a guild contact through the tavern: a small price for a quiet word. */
    meetContact(player, world, tile) {
        const settlement = tile && tile.settlement;
        if (!Underworld.hasGuildPresence(settlement)) return { success: false, reason: 'No guild worth the name works a place this small.' };
        const st = Underworld.ensure(player);
        if (st.guild.contactMet || st.guild.member) return { success: true, already: true, text: 'Your contact nods from the corner booth.' };
        const cost = _num(Underworld.cfg('guild').contactCost, 30);
        if ((player.gold || 0) < cost) return { success: false, reason: `Loosening the right tongue costs ${cost}g.` };
        player.gold -= cost;
        st.guild.contactMet = true;
        Traits.recordDeed(player, 'cunning', 0.5);
        Underworld._log(player, world, `Met a guild contact in ${settlement.name}.`);
        return { success: true, text: `For ${cost}g the barkeep points you to a hooded figure in the back: a contact of ${Underworld.cfg('guild').name}. A fence and the black market are open to you now.` };
    },

    joinGuild(player, world, tile) {
        const st = Underworld.ensure(player);
        if (st.guild.member) return { success: false, reason: 'You are already one of us.' };
        if (!st.guild.contactMet) return { success: false, reason: 'You need a contact to vouch for you first.' };
        if (tile && !Underworld.hasGuildPresence(tile.settlement)) return { success: false, reason: 'The guild meets in towns and cities.' };
        const fee = _num(Underworld.cfg('guild').joinFee, 100);
        if ((player.gold || 0) < fee) return { success: false, reason: `The initiation costs ${fee}g.` };
        player.gold -= fee;
        st.guild.member = true;
        st.guild.joinedDay = (world && world.day) || 0;
        st.guild.rank = 0;
        Traits.recordDeeds(player, { deceit: 1, cunning: 1 });
        Underworld._log(player, world, `Joined ${Underworld.cfg('guild').name} as a ${Underworld.ranks()[0].name}.`);
        return { success: true, text: `You swear the oath over a guttering candle. Welcome, ${Underworld.ranks()[0].name}.` };
    },

    /** Jobs on offer here, with odds and lock reasons. */
    availableJobs(player, world, tile) {
        const st = Underworld.ensure(player);
        const settlement = tile && tile.settlement;
        const out = [];
        for (const [id, job] of Object.entries(Underworld.data().jobs || {})) {
            let locked = null;
            if (!st.guild.member) locked = 'Guild members only';
            else if (st.guild.rank < _num(job.rank)) locked = `Requires rank ${(Underworld.ranks()[job.rank] || {}).name || job.rank}`;
            else if (st.lyingLow && st.lyingLow.kingdom === (settlement && settlement.kingdom)) locked = 'You are lying low';
            else if (id === 'racket' && st.rackets.some(r => r.key === _key(tile.q, tile.r))) locked = 'You already run this town';
            else if (id === 'racket' && st.rackets.length >= Math.max(1, st.guild.rank)) locked = 'Your rank cannot hold more rackets';
            out.push({ id, ...job, odds: Underworld.jobOdds(player, world, settlement, id), locked });
        }
        return out;
    },

    _payGold(player, world, amount, kind = 'theft') {
        player.gold = (player.gold || 0) + amount;
        if (player.financeToday && player.financeToday.income) {
            player.financeToday.income[kind] = (player.financeToday.income[kind] || 0) + amount;
        }
        Underworld.ensure(player).stats.earned += amount;
    },

    /**
     * Arrest on a failed roll: a fine, contraband and hot goods taken, and a
     * stint in the existing jail (player.jailState). `chance` overrides the
     * heat config's arrest chance.
     */
    _maybeArrest(player, world, settlement, offense, chance = null) {
        const h = Underworld.cfg('heat');
        const p = chance != null ? chance : h.arrestChance;
        if (!(Utils.random() < p)) return null;
        return Underworld._arrest(player, world, settlement, offense);
    },

    _arrest(player, world, settlement, offense) {
        const h = Underworld.cfg('heat');
        const heat = Underworld.getHeat(player, settlement && settlement.kingdom);
        const days = Math.max(1, Math.round(h.jailBaseDays + heat * h.jailDaysPerHeat));
        player.jailState = {
            daysRemaining: days,
            totalDays: days,
            offense,
            offenseNumber: (Underworld.ensure(player).stats.caught || 0) + 1,
            settlement: (settlement && settlement.name) || 'the town',
            bailCost: days * h.jailBailPerDay,
            escapeChance: 0.08 + _num(player.skills && player.skills.stealth) * 0.03,
        };
        player.stamina = 0;
        player.movementRemaining = 0;
        if (Underworld.ensure(player).heist) Underworld.ensure(player).heist = null;
        return { days, text: `Arrested and jailed for ${days} day(s).` };
    },

    _spendAP(player, ap) {
        if ((player.actionPoints || 0) < ap) return false;
        player.actionPoints -= ap;
        return true;
    },

    /** Run a guild job (pickpocket, burglary, racket) here. */
    doJob(player, world, tile, jobId) {
        const settlement = tile && tile.settlement;
        if (!settlement) return { success: false, reason: 'Nothing to steal out here.' };
        const job = Underworld.jobDef(jobId);
        if (!job || jobId === 'heist') return { success: false, reason: 'Unknown job.' };
        const offer = Underworld.availableJobs(player, world, tile).find(j => j.id === jobId);
        if (!offer || offer.locked) return { success: false, reason: (offer && offer.locked) || 'Not available.' };
        if (!Underworld._spendAP(player, _num(job.ap, 2))) return { success: false, reason: `This job takes ${job.ap} action points.` };
        const st = Underworld.ensure(player);
        const kingdom = Underworld._settlementKingdom(world, settlement);
        const guard = Underworld.guardStrength(settlement, kingdom);
        const odds = offer.odds;
        const roll = Utils.random();
        st.guild.jobsDone[jobId] = (st.guild.jobsDone[jobId] || 0) + 1;
        const where = { kingdom: settlement.kingdom, q: tile.q, r: tile.r };

        if (roll < odds) {
            let gold = 0;
            let loot = { added: {}, dropped: {} };
            if (jobId === 'pickpocket' || jobId === 'burglary') {
                const [lo, hi] = job.gold || [5, 20];
                gold = Utils.randInt(lo, hi) + Math.round(guard * _num(job.goldPerGuard));
                if (jobId === 'burglary' && Array.isArray(job.loot) && job.loot.length) {
                    const [ql, qh] = job.lootQty || [1, 2];
                    loot = Underworld._addLoot(player, world, { [Utils.randPick(job.loot)]: Utils.randInt(ql, qh) });
                }
                Underworld._payGold(player, world, gold);
            } else if (jobId === 'racket') {
                const weekly = Math.round(_clamp(_num(settlement.population) * _num(job.weeklyPerPop, 0.04), _num(job.weeklyMin, 20), _num(job.weeklyMax, 160)));
                st.rackets.push({ key: _key(tile.q, tile.r), name: settlement.name, kingdom: settlement.kingdom, q: tile.q, r: tile.r, weekly, sinceDay: (world && world.day) || 0 });
            }
            Underworld.recordCrime(player, world, jobId, where);
            const promoted = Underworld._gainStanding(player, world, _num(job.standing, 1));
            if (Utils.random() < 0.1 && player.skills) player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 1);
            const lootText = Object.keys(loot.added).length ? ` and ${PlayerInventory.describe(loot.added)} (hot)` : '';
            const dropText = Object.keys(loot.dropped).length ? ` Your packs were too full for ${PlayerInventory.describe(loot.dropped)}.` : '';
            const text = jobId === 'racket'
                ? `The shopkeepers of ${settlement.name} will pay you ${st.rackets[st.rackets.length - 1].weekly}g a week to stay safe.`
                : `${job.name}: you got away with ${gold}g${lootText}.${dropText}`;
            return { success: true, outcome: 'success', gold, loot: loot.added, promoted, text: promoted ? `${text} You rise to ${promoted.name}!` : text };
        }

        // Failed — caught or simply came away empty-handed
        const caught = Utils.random() < _num(job.caughtShare, 0.5);
        if (!caught) {
            Underworld.recordCrime(player, world, jobId, { ...where, scale: 0.5 });
            return { success: true, outcome: 'empty', text: `${job.name}: it went sour and you slipped away with nothing.` };
        }
        Underworld.recordCrime(player, world, jobId, { ...where, caught: true });
        const fine = Math.min(player.gold || 0, Math.round(20 * guard));
        player.gold -= fine;
        const arrest = Underworld._maybeArrest(player, world, settlement, _label(jobId));
        const text = `${job.name}: caught in the act! Fined ${fine}g.${arrest ? ` ${arrest.text}` : ' You talked your way out of a cell.'}`;
        Underworld._log(player, world, text);
        return { success: true, outcome: 'caught', fine, arrested: !!arrest, text };
    },

    // ──────────── HEISTS ────────────

    heistTargets(settlement) {
        const out = [];
        for (const [id, t] of Object.entries(Underworld.data().heistTargets || {})) {
            if (settlement && Underworld._typeRank(settlement.type) >= Underworld._typeRank(t.minType || 'town')) out.push({ id, ...t });
        }
        return out;
    },

    /** Start planning a heist on a target in this settlement. */
    startHeist(player, world, tile, targetId) {
        const settlement = tile && tile.settlement;
        const st = Underworld.ensure(player);
        const offer = Underworld.availableJobs(player, world, tile).find(j => j.id === 'heist');
        if (!offer || offer.locked) return { success: false, reason: (offer && offer.locked) || 'Not available.' };
        if (st.heist) return { success: false, reason: `You are already planning a job on ${st.heist.name}.` };
        const target = Underworld.heistTargets(settlement).find(t => t.id === targetId);
        if (!target) return { success: false, reason: 'No such mark here.' };
        st.heist = {
            targetId, name: `${target.name} of ${settlement.name}`, key: _key(tile.q, tile.r),
            q: tile.q, r: tile.r, kingdom: settlement.kingdom, steps: [], startedDay: (world && world.day) || 0,
        };
        return { success: true, text: `You start planning a job on ${st.heist.name}. Finish it within ${_num(offer.planDays, 14)} days.` };
    },

    /** Steps already taken and those still open for the current heist. */
    heistPlan(player) {
        const st = Underworld.ensure(player);
        if (!st.heist) return null;
        const steps = Underworld.data().heistSteps || {};
        let bonus = 0;
        let escape = 0;
        for (const s of st.heist.steps) {
            bonus += _num(steps[s] && steps[s].bonus);
            escape = Math.max(escape, _num(steps[s] && steps[s].escape));
        }
        const open = Object.entries(steps).filter(([id]) => !st.heist.steps.includes(id)).map(([id, s]) => ({ id, ...s }));
        return { ...st.heist, bonus, escape, open };
    },

    /** Take one planning step (must be in the target town). */
    planStep(player, world, tile, stepId) {
        const st = Underworld.ensure(player);
        if (!st.heist) return { success: false, reason: 'You have no job planned.' };
        if (!tile || _key(tile.q, tile.r) !== st.heist.key) return { success: false, reason: 'You must be in the town you mean to rob.' };
        const step = (Underworld.data().heistSteps || {})[stepId];
        if (!step) return { success: false, reason: 'Unknown step.' };
        if (st.heist.steps.includes(stepId)) return { success: false, reason: 'Already done.' };
        if ((player.gold || 0) < _num(step.gold)) return { success: false, reason: `That costs ${step.gold}g.` };
        if (!Underworld._spendAP(player, _num(step.ap, 1))) return { success: false, reason: `That takes ${step.ap} action points.` };
        player.gold -= _num(step.gold);
        st.heist.steps.push(stepId);
        Traits.recordDeeds(player, { cunning: 0.5, ...(step.deeds || {}) });
        if (stepId === 'case' || stepId === 'inside_man') Underworld.addHeat(player, st.heist.kingdom, 1, world);
        return { success: true, text: `${step.icon || ''} ${step.name} — done. (+${Math.round(_num(step.bonus) * 100)}% odds)` };
    },

    heistOdds(player, world, tile) {
        const plan = Underworld.heistPlan(player);
        if (!plan) return 0;
        const target = (Underworld.data().heistTargets || {})[plan.targetId] || {};
        return Underworld.jobOdds(player, world, tile && tile.settlement, 'heist', plan.bonus - _num(target.difficulty));
    },

    /** Strike. Big gold, hot loot, heavy heat — or a cell. */
    executeHeist(player, world, tile) {
        const st = Underworld.ensure(player);
        const plan = Underworld.heistPlan(player);
        if (!plan) return { success: false, reason: 'You have no job planned.' };
        if (!tile || _key(tile.q, tile.r) !== plan.key) return { success: false, reason: 'You must be in the town you mean to rob.' };
        const job = Underworld.jobDef('heist') || {};
        if (!Underworld._spendAP(player, _num(job.ap, 6))) return { success: false, reason: `The job takes ${job.ap || 6} action points.` };
        const settlement = tile.settlement;
        const target = (Underworld.data().heistTargets || {})[plan.targetId] || {};
        const odds = Underworld.heistOdds(player, world, tile);
        st.heist = null;
        st.guild.jobsDone.heist = (st.guild.jobsDone.heist || 0) + 1;
        const where = { kingdom: settlement.kingdom, q: tile.q, r: tile.r };
        if (Utils.random() < odds) {
            const [lo, hi] = target.gold || [200, 400];
            const gold = Utils.randInt(lo, hi);
            Underworld._payGold(player, world, gold);
            let loot = { added: {}, dropped: {} };
            if (Array.isArray(target.loot) && target.loot.length) {
                const [ql, qh] = target.lootQty || [1, 2];
                loot = Underworld._addLoot(player, world, { [Utils.randPick(target.loot)]: Utils.randInt(ql, qh) });
            }
            Underworld.recordCrime(player, world, 'heist', where);
            if (target.karma) player.karma = Math.max(-100, (player.karma || 0) + target.karma);
            if (target.deeds) Traits.recordDeeds(player, target.deeds);
            const promoted = Underworld._gainStanding(player, world, _num(job.standing, 20));
            const lootText = Object.keys(loot.added).length ? ` and ${PlayerInventory.describe(loot.added)} (hot)` : '';
            const text = `The job on ${plan.name} goes like clockwork: ${gold}g${lootText}!${promoted ? ` You rise to ${promoted.name}!` : ''}`;
            Underworld._log(player, world, text);
            return { success: true, outcome: 'success', gold, loot: loot.added, promoted, text };
        }
        Underworld.recordCrime(player, world, 'heist', { ...where, caught: true });
        const arrestChance = Underworld.cfg('heat').arrestChance * (1 + _num(job.caughtShare, 0.7)) * (1 - plan.escape);
        const arrest = Underworld._maybeArrest(player, world, settlement, 'heist', _clamp(arrestChance, 0.05, 0.95));
        const text = `The job on ${plan.name} falls apart!${arrest ? ` ${arrest.text}` : ' You escape over the rooftops, empty-handed.'}`;
        Underworld._log(player, world, text);
        return { success: true, outcome: 'failed', arrested: !!arrest, text };
    },

    abandonHeist(player) {
        const st = Underworld.ensure(player);
        if (!st.heist) return { success: false, reason: 'No job planned.' };
        const name = st.heist.name;
        st.heist = null;
        return { success: true, text: `You call off the job on ${name}.` };
    },

    // ──────────── COOLING OFF ────────────

    /** Gold to bribe the watch here down by up to `maxRelief` heat. */
    bribeCost(player, world, tile) {
        const settlement = tile && tile.settlement;
        if (!settlement || !settlement.kingdom) return null;
        const b = Underworld.cfg('bribe');
        const heat = Underworld.getHeat(player, settlement.kingdom);
        if (heat <= 0) return null;
        const relief = Math.min(heat, b.maxRelief);
        const kingdom = Underworld._settlementKingdom(world, settlement);
        const discount = Underworld.ensure(player).guild.member
            ? Underworld.ensure(player).guild.rank * Underworld.cfg('guild').bribeDiscountPerRank : 0;
        const gold = Math.ceil(relief * b.goldPerHeatPerGuard * Underworld.guardStrength(settlement, kingdom) * Math.max(0.4, 1 - discount));
        const fail = _clamp(b.failChance * ((kingdom && (kingdom.traits || []).includes('orderly')) ? 1.5 : 1)
            - (_num(player.charisma, 5) - 5) * b.charismaPerPoint, 0.02, 0.5);
        return { gold, relief, fail };
    },

    bribeGuards(player, world, tile) {
        const quote = Underworld.bribeCost(player, world, tile);
        if (!quote) return { success: false, reason: 'The watch has nothing against you here.' };
        if ((player.gold || 0) < quote.gold) return { success: false, reason: `The sergeant wants ${quote.gold}g.` };
        if (!Underworld._spendAP(player, 1)) return { success: false, reason: 'A bribe takes 1 action point.' };
        const kingdomId = tile.settlement.kingdom;
        player.gold -= quote.gold;
        Traits.recordDeed(player, 'deceit', 1);
        if (Utils.random() < quote.fail) {
            Underworld.addHeat(player, kingdomId, Underworld.cfg('bribe').failHeat, world);
            return { success: true, accepted: false, text: `The sergeant pockets your ${quote.gold}g — and reports the attempt. (+heat)` };
        }
        Underworld.addHeat(player, kingdomId, -quote.relief, world);
        return { success: true, accepted: true, text: `${quote.gold}g changes hands. Certain reports go missing. (-${Math.round(quote.relief)} heat)` };
    },

    /** Lie low in this realm: no jobs here for a few days, heat cools fast. */
    lieLow(player, world, tile) {
        const settlement = tile && tile.settlement;
        if (!settlement || !settlement.kingdom) return { success: false, reason: 'Lie low where, exactly?' };
        const h = Underworld.cfg('heat');
        const day = (world && world.day) || 0;
        Underworld.ensure(player).lyingLow = { kingdom: settlement.kingdom, untilDay: day + _num(h.lieLowDays, 3) };
        return { success: true, text: `You keep your head down in ${settlement.name}. Heat in this realm will cool quickly for ${h.lieLowDays} days — but no jobs here till then.` };
    },

    // ──────────── THE GATE ────────────

    /**
     * Arriving at a settlement: a heat warning, and at high heat a guard
     * search — contraband and hot goods confiscated, a fine, perhaps arrest.
     * @returns {{ heat, level, warning: string|null, search: object|null }}
     */
    onEnterSettlement(player, world, tile) {
        const settlement = tile && tile.settlement;
        const none = { heat: 0, level: 'clear', warning: null, search: null };
        if (!player || !settlement || !settlement.kingdom || player.jailState) return none;
        const h = Underworld.cfg('heat');
        const heat = Underworld.getHeat(player, settlement.kingdom);
        const level = Underworld.heatLevel(heat);
        const warnings = Underworld.data().warnings || {};
        const warning = level === 'clear' ? null : (warnings[level] || null);
        if (heat < h.watchedAt) return { heat, level, warning, search: null };
        // Your own holding's watch answers to you: no search at your own gate
        if (Underworld._ownHolding(settlement)) return { heat, level, warning, search: null };

        const kingdom = Underworld._settlementKingdom(world, settlement);
        const guard = Underworld.guardStrength(settlement, kingdom);
        const chance = _clamp((h.searchBase + (heat - h.watchedAt) * h.searchPerHeat) * (guard / 2), 0, h.searchMax);
        if (!(Utils.random() < chance)) return { heat, level, warning, search: null };

        const day = Seasons.today(world);
        const seized = {};
        let value = 0;
        for (const [id, qty] of Object.entries({ ...(player.inventory || {}) })) {
            if (id === 'gold' || !(qty > 0)) continue;
            const hot = Underworld.hotQty(player, id, day);
            const illegal = Underworld.contrabandStatus(kingdom, id) === 'illegal';
            const take = illegal ? qty : hot;
            if (take > 0) {
                Underworld._removeGoods(player, id, take);
                if (hot > 0) Underworld._consumeHot(player, id, Math.min(hot, take));
                seized[id] = take;
                value += Underworld._baseValue(id) * take;
            }
        }
        const found = Object.keys(seized).length > 0;
        const fine = Math.min(player.gold || 0, Math.round(heat * h.searchFinePerHeat + (found ? value * h.contrabandFineShare : 0)));
        player.gold -= fine;
        let arrest = null;
        if (heat >= h.arrestAt || found) arrest = Underworld._maybeArrest(player, world, settlement, 'wanted by the watch', heat >= h.arrestAt ? h.arrestChance : h.arrestChance * 0.4);
        if (!found && !arrest) Underworld.addHeat(player, settlement.kingdom, -h.cleanSearchRelief, world);
        else Underworld.addHeat(player, settlement.kingdom, 5, world);
        const parts = [`The guards at ${settlement.name} search you.`];
        parts.push(found ? `They seize ${PlayerInventory.describe(seized)}.` : 'They find nothing.');
        if (fine > 0) parts.push(`Fined ${fine}g.`);
        if (arrest) parts.push(arrest.text);
        const text = parts.join(' ');
        Underworld._log(player, world, text);
        return { heat, level, warning, search: { seized, fine, arrested: !!arrest, text } };
    },

    // ──────────── HOOKS FROM OTHER SYSTEMS ────────────

    /** Piracy at sea: heat with the realm whose waters it was (the nearest settlement's crown). */
    recordPiracy(player, world, q, r) {
        const kingdomId = Underworld._nearestKingdom(world, q, r);
        if (!kingdomId) return null;
        Underworld.recordCrime(player, world, 'piracy', { kingdom: kingdomId });
        return kingdomId;
    },

    _nearestKingdom(world, q, r) {
        if (!world || q == null || r == null) return null;
        const tile = world.getTile ? world.getTile(q, r) : null;
        if (tile && tile.kingdom) return tile.kingdom;
        if (tile && tile.settlement && tile.settlement.kingdom) return tile.settlement.kingdom;
        let best = null;
        let bestD = Infinity;
        const all = typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        for (const s of all) {
            if (!s.kingdom) continue;
            const d = Math.abs(s.q - q) + Math.abs(s.r - r);
            if (d < bestD) { bestD = d; best = s.kingdom; }
        }
        return best;
    },

    /** Multiplier on an NPC's warming to a known guild member (guards cool, beggars warm). */
    npcWarmthFactor(player, npcType) {
        if (!Underworld.isKnownMember(player)) return 1;
        return _num((Underworld.data().npcReactions || {})[npcType], 1);
    },

    /** A lord's opinion adjustment for a known guild member, by the lord's traits. */
    lordOpinion(player, lord) {
        if (!Underworld.isKnownMember(player)) return 0;
        const table = Underworld.data().lordReactions || {};
        let total = 0;
        for (const t of (lord && lord.traits) || []) total += _num(table[(t && t.id) || t]);
        return total;
    },

    // ──────────── DAILY ────────────

    /**
     * Daily tick: heat cools (fast while lying low), hot goods cool, rackets
     * and the Guildmaster's cut pay weekly, stale heist plans lapse.
     * @returns {{ notices: string[], income: number }}
     */
    processDay(player, world) {
        const out = { notices: [], income: 0 };
        if (!player || !player.underworld) return out;
        const st = Underworld.ensure(player);
        const h = Underworld.cfg('heat');
        const day = (world && world.day) || 0;

        if (st.lyingLow && day >= st.lyingLow.untilDay) {
            out.notices.push(`You stop lying low in ${Underworld._kingdomName(world, st.lyingLow.kingdom)}.`);
            st.lyingLow = null;
        }
        for (const kingdomId of Object.keys(st.heat)) {
            const rate = st.lyingLow && st.lyingLow.kingdom === kingdomId ? h.lieLowDecayPerDay : h.decayPerDay;
            const before = st.heat[kingdomId];
            const after = Underworld.addHeat(player, kingdomId, -rate, world);
            if (before >= h.posterAt && after < h.posterAt) out.notices.push(`The wanted posters in ${Underworld._kingdomName(world, kingdomId)} are coming down.`);
        }

        st.hot = st.hot.filter(e => e.untilDay > day && e.qty > 0);

        if (st.heist) {
            const days = _num((Underworld.jobDef('heist') || {}).planDays, 14);
            if (day - st.heist.startedDay > days) {
                out.notices.push(`Your plans for ${st.heist.name} went stale — the job is off.`);
                st.heist = null;
            }
        }

        if (day > 0 && day % 7 === 0) {
            const job = Underworld.jobDef('racket') || {};
            const kept = [];
            for (const rk of st.rackets) {
                if (Underworld.getHeat(player, rk.kingdom) >= _num(job.bustHeat, 70) && Utils.random() < _num(Underworld.data().racketBustChance, 0.25)) {
                    out.notices.push(`The watch broke up your racket in ${rk.name}.`);
                    continue;
                }
                kept.push(rk);
                Underworld._payGold(player, world, rk.weekly, 'racket');
                out.income += rk.weekly;
                Underworld.recordCrime(player, world, 'racket_weekly', { kingdom: rk.kingdom });
            }
            st.rackets = kept;
            if (Underworld.isGuildmaster(player) && st.guild.lastCutDay !== day) {
                const c = Underworld.cfg('guild').guildmasterCut || {};
                const cut = Math.round(_num(c.base, 150) + st.rackets.length * _num(c.perRacket, 25));
                st.guild.lastCutDay = day;
                Underworld._payGold(player, world, cut, 'guild');
                out.income += cut;
                out.notices.push(`The guild pays its Guildmaster's cut: ${cut}g.`);
            }
            if (out.income > 0 && st.rackets.length) out.notices.push(`Protection money from ${st.rackets.length} racket(s) comes in.`);
        }
        return out;
    },

    // ──────────── UI SUMMARY ────────────

    summary(player, world) {
        const st = Underworld.ensure(player);
        const rank = Underworld.getRank(player);
        const next = Underworld.nextRank(player);
        return {
            guildName: Underworld.cfg('guild').name,
            member: st.guild.member,
            contactMet: st.guild.contactMet,
            rank, next, standing: st.guild.standing,
            known: Underworld.isKnownMember(player),
            heat: Underworld.heatTable(player, world),
            hot: Underworld.hotGoods(player, Seasons.today(world)),
            rackets: st.rackets.slice(),
            heist: Underworld.heistPlan(player),
            lyingLow: st.lyingLow,
            leanSeason: Seasons.isLean(Seasons.today(world)),
            log: st.log.slice(-8).reverse(),
            stats: { ...st.stats },
        };
    },
};
