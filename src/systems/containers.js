// ============================================
// CONTAINERS — what's inside, and helping yourself to it
// ============================================
// Every chest, crate, barrel, shelf and sack on an inner map holds something.
// What the place wants in it is rolled from the world seed, the place (world
// tile, the building, the furniture's spot) and the restock period.
//   - Unclaimed containers (the wilds, ruins, lairs) hold that roll: finds
//     from nature. What the player removed is stored on player.containerLoot
//     [key] = { period, taken: { goodId: qty } } (saved with the player).
//   - Someone else's (a town's houses, shops and streets) hold what the owner
//     has really got (larder()): each period the household or business tops
//     it up to the roll out of the town's market stock (bought from the town's
//     own sellers: the coin stays in the town's purse, the goods leave the
//     market), as far as the market has them. Goods no market trades, and
//     boxes out of town, are heirlooms: there from the first look, never
//     replaced. What is stolen is gone from the owner's store; the owner buys
//     it again from the market at the next restock.
//
// Whether you may simply take something depends on where it is (access()):
//   own    a building you own                  → take freely
//   free   the wilds, ruins, camps, lairs       → take freely
//   steal  anyone else's house, shop or street  → steal: a roll against being
//          seen. Witnesses nearby, the owner at home, a guard in sight and
//          the value of the thing raise the odds of being caught; night and
//          stealth lower them (stealOdds()).
//
// Caught: you keep nothing, pay a fine, lose standing in the realm, and the
// Underworld records a caught theft (heat, gossip); from the third offence the
// watch jails you. Got away: the goods are yours and hot (Underworld.markHot,
// so the open market shuns them and the fence wants them) and the deed adds
// heat in the realm.
//
// No import-time effects; randomness only through Utils (the contents roll
// from their own seeded stream, the theft roll from the game's stream).
// Tables in data/containers.json; a row's good may be '@pool', one of a pool's
// goods in the season (the stall's fruit: apples in autumn, cherries in summer).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Underworld } from './underworld.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';
import { SocialSkills } from './socialSkills.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const DEFAULTS = {
    restockDays: 14,
    containerTypes: ['chest', 'crate', 'barrel', 'shelf', 'bookshelf', 'sack', 'rack', 'desk', 'stall', 'cauldron', 'oven'],
    loot: {},
    byBuilding: {},
    outdoors: {},
    pools: {},
    publicBuildings: ['ruin', 'abandoned', 'camp', 'cave', 'lair'],
    theft: {
        base: 0.18, perWitness: 0.16, witnessRange: 6, ownerInside: 0.12, guardWitness: 0.2,
        night: -0.1, nightFrom: 22, nightTo: 5, perStealth: -0.04, perValue: 0.0015, outdoorsTown: 0.06,
        min: 0.04, max: 0.92, fineMult: 2, fineMin: 10, reputation: 4, jailFrom: 3, jailDays: [2, 4, 7, 10],
        bailPerDay: 25, stealthXp: 0.15,
    },
};

function _goods() {
    const pe = DataLoader.get && DataLoader.get('playerEconomy');
    const G = (pe && pe.GOODS) || {};
    const byId = {};
    for (const g of Object.values(G)) if (g && g.id) byId[g.id] = g;
    return byId;
}

function _bType(building) {
    return building ? String(building.type || '').replace(/^player_/, '') : null;
}

export const Containers = {
    data() {
        return (DataLoader.get && DataLoader.get('containers')) || {};
    },

    cfg(key) {
        const d = Containers.data();
        if (key === 'theft') return { ...DEFAULTS.theft, ...(d.theft || {}) };
        return d[key] != null ? d[key] : DEFAULTS[key];
    },

    /** Is this furniture type something with an inside? */
    isContainer(furnitureType) {
        return !!furnitureType && Containers.cfg('containerTypes').includes(furnitureType);
    },

    /** A good's name, icon and base price ({ id, name, icon, basePrice }). */
    good(id) {
        const g = _goods()[id];
        return g || { id, name: String(id).replace(/_/g, ' '), icon: '📦', basePrice: 5 };
    },

    /**
     * The stable key of one container.
     * ctx: { worldQ, worldR, building: { type, q, r, name } | null, q, r, furnitureType }
     */
    key(ctx) {
        const b = ctx.building;
        const where = b ? `${_bType(b)}@${_num(b.q)},${_num(b.r)}` : 'out';
        return `${_num(ctx.worldQ)},${_num(ctx.worldR)}|${where}|${_num(ctx.q)},${_num(ctx.r)}|${ctx.furnitureType || '?'}`;
    },

    /** The loot table a container draws from. */
    table(ctx) {
        const type = ctx.furnitureType;
        if (!ctx.building) {
            const out = Containers.cfg('outdoors');
            if (out[type]) return out[type];
        }
        const bt = _bType(ctx.building);
        const by = Containers.cfg('byBuilding');
        if (bt && by[bt] && by[bt][type]) return by[bt][type];
        return Containers.cfg('loot')[type] || [];
    },

    /** The restock period a day falls in. */
    period(world) {
        return Math.floor(_day(world) / Math.max(1, _num(Containers.cfg('restockDays'), 14)));
    },

    /**
     * The season a restock period was stocked in (the season of its first day), so a
     * box keeps the same things all period.
     */
    periodSeason(world) {
        return Seasons.seasonOf(Containers.period(world) * Math.max(1, _num(Containers.cfg('restockDays'), 14)) + 1);
    },

    /**
     * A loot row's good: its id, or for '@pool' one of that pool's goods in the
     * season (data/containers.json pools: { pool: { Season: [[goodId, weight], ...] } }),
     * drawn from the box's own stream; null when the pool has nothing that season.
     */
    resolveGood(id, season, rng) {
        if (typeof id !== 'string' || id[0] !== '@') return id;
        const pool = (Containers.cfg('pools') || {})[id.slice(1)];
        const rows = (pool && (pool[season] || pool.all)) || [];
        const total = rows.reduce((s, r) => s + Math.max(0, _num(r[1])), 0);
        if (!(total > 0)) return null;
        let x = rng() * total;
        for (const r of rows) {
            x -= Math.max(0, _num(r[1]));
            if (x < 0) return r[0];
        }
        return rows[rows.length - 1][0];
    },

    /** What the container was stocked with this period, before anything was taken. */
    stocked(world, ctx) {
        const rng = Utils.seededRandom((_hash(`${_seed(world)}:box:${Containers.key(ctx)}:${Containers.period(world)}`) % 233279) + 1);
        const out = {};
        let season = null;
        for (const row of Containers.table(ctx)) {
            const [rowId, chance, min, max] = row;
            let id = rowId;
            if (rng() >= _num(chance)) continue;
            // (a pool's good for the season: the stall's fruit is apples in autumn, cherries in summer)
            if (typeof id === 'string' && id[0] === '@') {
                if (!season) season = Containers.periodSeason(world);
                id = Containers.resolveGood(id, season, rng);
                if (!id) continue;
            }
            const lo = Math.max(1, _num(min, 1));
            const hi = Math.max(lo, _num(max, lo));
            out[id] = (out[id] || 0) + lo + Math.floor(rng() * (hi - lo + 1));
        }
        return out;
    },

    /** The player's record of what they've removed from this container (this period). */
    _record(player, world, ctx) {
        if (!player.containerLoot) player.containerLoot = {};
        const k = Containers.key(ctx);
        const period = Containers.period(world);
        let rec = player.containerLoot[k];
        if (!rec || rec.period !== period) {
            // (an out-of-town owner's store outlives the period: nothing restocks it)
            rec = rec && rec.larder ? { period, taken: {}, larder: rec.larder } : { period, taken: {} };
            player.containerLoot[k] = rec;
        }
        return rec;
    },

    /** The town whose townsfolk own a container (its house, shop or street), or null. */
    town(world, ctx) {
        if (!ctx || !ctx.inSettlement || !world || typeof world.getTile !== 'function') return null;
        const t = world.getTile(ctx.worldQ, ctx.worldR);
        return (t && t.settlement) || null;
    },

    /**
     * The owner's store in someone else's container: { period, stock, stolen,
     * bought } (whole units). What the place wants is the roll (stocked());
     * the owner gets it from real sources:
     *   in a town  — at each restock period the household or business tops
     *                the box up to that out of the town's market stock
     *                (SettlementMarket.take: bought from the town's own
     *                sellers, so the coin stays in the town's purse); a market
     *                short of a good leaves the box short. Kept on the
     *                settlement (settlement.larders[key], saved with the tile).
     *   heirlooms  — goods no market trades (old coins, an amulet), and
     *                everything in a building out of town, are there from the
     *                first look and never replaced: kept on the player's record.
     * Stolen goods leave the store for good; the owner buys again from the
     * market at the next restock, so a theft takes goods out of the town.
     * Null when there is nowhere to keep it (no town, no player: a preview).
     */
    larder(player, world, ctx) {
        const s = Containers.town(world, ctx);
        const k = Containers.key(ctx);
        let rec;
        if (s) {
            if (!s.larders || typeof s.larders !== 'object') s.larders = {};
            rec = s.larders[k];
            if (!rec) rec = s.larders[k] = { period: null, stock: {}, stolen: {}, bought: 0 };
        } else if (player) {
            if (!player.containerLoot) player.containerLoot = {};
            const pr = player.containerLoot[k] || (player.containerLoot[k] = { period: Containers.period(world), taken: {} });
            rec = pr.larder;
            if (!rec) rec = pr.larder = { period: null, stock: {}, stolen: {}, bought: 0 };
        } else {
            return null;
        }
        const period = Containers.period(world);
        if (rec.period === period) return rec;
        const first = rec.period == null;
        // Out of town nothing is replaced once it's gone: only the first look stocks it
        if (!s && !first) { rec.period = period; return rec; }
        for (const [id, n] of Object.entries(Containers.stocked(world, ctx))) {
            const have = _num(rec.stock[id]);
            if (have >= n) continue;
            if (s && SettlementMarket.tracks(id)) {
                const want = Math.min(n - have, SettlementMarket.available(s, id));
                const got = want > 0 ? Math.floor(SettlementMarket.take(s, id, want) + 1e-9) : 0;
                if (got > 0) {
                    rec.stock[id] = have + got;
                    rec.bought = _num(rec.bought) + got;
                }
            } else if (first) {
                rec.stock[id] = n;
            }
        }
        rec.period = period;
        return rec;
    },

    /** What's in it now: { goodId: qty }. */
    contents(player, world, ctx) {
        if (Containers.access(ctx) === 'steal') {
            const rec = Containers.larder(player, world, ctx);
            if (!rec) return Containers.stocked(world, ctx);
            const out = {};
            for (const [id, n] of Object.entries(rec.stock)) if (_num(n) >= 1) out[id] = Math.floor(n);
            return out;
        }
        const stock = Containers.stocked(world, ctx);
        const k = Containers.key(ctx);
        const rec = player && player.containerLoot && player.containerLoot[k];
        if (rec && rec.period === Containers.period(world)) {
            for (const [id, n] of Object.entries(rec.taken || {})) {
                stock[id] = Math.max(0, _num(stock[id]) - _num(n));
                if (!stock[id]) delete stock[id];
            }
        }
        return stock;
    },

    /**
     * May the player simply take from here? → 'own' | 'free' | 'steal'.
     * ctx.inSettlement: whether the world tile is a settlement.
     */
    access(ctx) {
        const b = ctx.building;
        if (b && (b.isPlayerOwned || b.isPlayerProperty || String(b.type || '').startsWith('player_'))) return 'own';
        const bt = _bType(b);
        if (bt && Containers.cfg('publicBuildings').includes(bt)) return 'free';
        if (!b && !ctx.inSettlement) return 'free';
        return 'steal';
    },

    /**
     * Odds of being caught lifting `qty` of `goodId`.
     * scene: { witnesses, guards, ownerInside, hour }
     * → { chance, parts: [{ label, delta }] } (chance in 0..1)
     */
    stealOdds(player, ctx, goodId, qty = 1, scene = {}) {
        const T = Containers.cfg('theft');
        const parts = [];
        let c = _num(T.base);
        parts.push({ label: 'Base risk', delta: c });
        // Stealth (systems/socialSkills.js): onlookers slower to notice, and less risk all told
        const levelled = SocialSkills.has('stealth');
        const unseen = levelled ? Math.max(0, Math.min(0.9, SocialSkills.frac(player, 'stealth', 'noticed'))) : 0;
        const w = Math.max(0, _num(scene.witnesses));
        if (w) { const dw = w * T.perWitness * (1 - unseen); c += dw; parts.push({ label: `${w} ${w === 1 ? 'person' : 'people'} nearby`, delta: dw }); }
        const g = Math.max(0, _num(scene.guards));
        if (g) { const dg = g * T.guardWitness * (1 - unseen); c += dg; parts.push({ label: `${g} guard${g === 1 ? '' : 's'} in sight`, delta: dg }); }
        if (scene.ownerInside) { const dO = T.ownerInside * (1 - unseen); c += dO; parts.push({ label: 'The owner is here', delta: dO }); }
        const h = _num(scene.hour, 12);
        if (h >= T.nightFrom || h < T.nightTo) { c += T.night; parts.push({ label: 'Dark of night', delta: T.night }); }
        if (!ctx.building && ctx.inSettlement) { c += T.outdoorsTown; parts.push({ label: 'Out in the street', delta: T.outdoorsTown }); }
        if (levelled && player) {
            const risk = -SocialSkills.perk(player, 'stealth', 'theftRisk') / 100;
            const lv = SocialSkills.level(player, 'stealth');
            if (risk) { c += risk; parts.push({ label: `Stealth ${lv}${unseen ? ` (onlookers ${Math.round(unseen * 100)}% slower)` : ''}`, delta: risk }); }
        } else {
            const stealth = _num(player && player.skills && player.skills.stealth);
            if (stealth) { c += stealth * T.perStealth; parts.push({ label: `Stealth ${Math.round(stealth * 10) / 10}`, delta: stealth * T.perStealth }); }
        }
        const value = _num(Containers.good(goodId).basePrice) * Math.max(1, qty);
        if (value) { c += value * T.perValue; parts.push({ label: `Worth ${value}g`, delta: value * T.perValue }); }
        return { chance: Math.min(T.max, Math.max(T.min, c)), parts };
    },

    /** Stealth for a theft (systems/socialSkills.js; the old flat number without the skill pack). */
    _stealthXp(player, kind, value) {
        if (!SocialSkills.has('stealth')) {
            const T = Containers.cfg('theft');
            player.skills.stealth = Math.min(10, _num(player.skills.stealth) + (kind === 'caught' ? T.stealthXp / 3 : T.stealthXp));
            return null;
        }
        const X = (SocialSkills.xpFor('stealth', 'stealMax') || 30);
        const xp = kind === 'steal'
            ? Math.min(X, SocialSkills.xpFor('stealth', 'steal') + value * SocialSkills.xpFor('stealth', 'stealPerGold'))
            : SocialSkills.xpFor('stealth', kind);
        return SocialSkills.train(player, 'stealth', xp);
    },

    _give(player, goodId, qty) {
        if (!player.inventory) player.inventory = {};
        player.inventory[goodId] = _num(player.inventory[goodId]) + qty;
    },

    /** Take freely (own or free containers). → { ok, text } */
    take(player, world, ctx, goodId, qty = 1) {
        if (Containers.access(ctx) === 'steal') return { ok: false, text: 'That isn\'t yours to take. You would have to steal it.' };
        const have = _num(Containers.contents(player, world, ctx)[goodId]);
        const n = Math.min(have, Math.max(1, Math.floor(qty)));
        if (n <= 0) return { ok: false, text: 'There is none left.' };
        const rec = Containers._record(player, world, ctx);
        rec.taken[goodId] = _num(rec.taken[goodId]) + n;
        Containers._give(player, goodId, n);
        const g = Containers.good(goodId);
        return { ok: true, qty: n, text: `You take ${n} ${g.name}.` };
    },

    /**
     * Try to steal. Draws one roll from the game's RNG (Utils.random).
     * ctx also carries { kingdom, settlementName, worldQ, worldR }.
     * → { ok, caught, qty, fine, jailDays, text }
     */
    steal(player, world, ctx, goodId, qty = 1, scene = {}) {
        if (Containers.access(ctx) !== 'steal') return Containers.take(player, world, ctx, goodId, qty);
        const have = _num(Containers.contents(player, world, ctx)[goodId]);
        const n = Math.min(have, Math.max(1, Math.floor(qty)));
        if (n <= 0) return { ok: false, caught: false, text: 'There is none left.' };
        const res = Containers.stealGoods(player, world, ctx, goodId, n, scene);
        if (res.ok) {
            // Out of the owner's store for good: the owner is that much poorer
            const rec = Containers.larder(player, world, ctx);
            if (rec) {
                rec.stock[goodId] = Math.max(0, _num(rec.stock[goodId]) - n);
                if (!rec.stock[goodId]) delete rec.stock[goodId];
                if (!rec.stolen) rec.stolen = {};
                rec.stolen[goodId] = _num(rec.stolen[goodId]) + n;
            }
        }
        return res;
    },

    /**
     * The theft itself, of n of a good from wherever (a container, a field):
     * one roll from the game's RNG; caught → fine, standing, record, maybe the
     * cells; away → the goods, hot. → { ok, caught, qty, fine, jailDays, text }
     */
    stealGoods(player, world, ctx, goodId, n, scene = {}) {
        const g = Containers.good(goodId);
        const { chance } = Containers.stealOdds(player, ctx, goodId, n, scene);
        const kingdom = ctx.kingdom || null;
        if (!player.skills) player.skills = {};

        if (Utils.random() < chance) return Containers.punishTheft(player, world, ctx, goodId, n);

        Containers._give(player, goodId, n);
        Underworld.markHot(player, goodId, n, _day(world));
        Underworld.recordCrime(player, world, 'theft', { kingdom, caught: false, scale: Math.min(2, 0.5 + (_num(g.basePrice) * n) / 100) });
        Containers._stealthXp(player, ctx.furnitureType === 'field' ? 'fieldSteal' : 'steal', _num(g.basePrice) * n);
        return { ok: true, caught: false, qty: n, text: `You slip ${n} ${g.name} into your pack unseen. Mind where you sell it: it's hot.` };
    },

    /**
     * Would a theft be seen here (one roll from the game's RNG, the theft odds)? For a deed
     * that takes nothing (a grave dug open and found bare): caught → punishTheft as for the good.
     */
    caughtAt(player, ctx, goodId, n, scene = {}) {
        const { chance } = Containers.stealOdds(player, ctx, goodId, n, scene);
        return Utils.random() < chance;
    },

    /** Caught stealing: the fine, the standing, the record, maybe the cells. → { ok:false, caught:true, fine, jailDays, text } */
    punishTheft(player, world, ctx, goodId, n) {
        const T = Containers.cfg('theft');
        const g = Containers.good(goodId);
        const kingdom = ctx.kingdom || null;
        if (!player.skills) player.skills = {};
        {
            const value = _num(g.basePrice) * n;
            // The realm's law on punishment scales the fine and the days in the cells (systems/laws.js)
            const law = Laws.punishment(world, kingdom);
            const fine = Math.min(_num(player.gold), Math.max(_num(T.fineMin), Math.round(value * _num(T.fineMult) * law.fine)));
            player.gold = _num(player.gold) - fine;
            Ledger.record(player, 'fines', -fine);
            if (kingdom && player.reputation) player.reputation[kingdom] = _num(player.reputation[kingdom]) - _num(T.reputation);
            if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
            player.criminalRecord.theft = _num(player.criminalRecord.theft) + 1;
            Underworld.recordCrime(player, world, 'theft', {
                kingdom, caught: true, q: ctx.worldQ, r: ctx.worldR,
                victim: { name: ctx.ownerName || (ctx.building && ctx.building.name) || 'the townsfolk', type: 'merchant', icon: '🧑' },
            });
            Containers._stealthXp(player, 'caught', 0);
            let jailDays = 0;
            const offences = player.criminalRecord.theft;
            if (offences >= _num(T.jailFrom, 3) && ctx.inSettlement) {
                const ladder = Array.isArray(T.jailDays) && T.jailDays.length ? T.jailDays : [2, 4, 7, 10];
                jailDays = Math.max(1, Math.round(ladder[Math.min(ladder.length - 1, offences - _num(T.jailFrom, 3))] * law.jail));
                player.jailState = {
                    daysRemaining: jailDays,
                    totalDays: jailDays,
                    offense: 'theft',
                    offenseNumber: offences,
                    settlement: ctx.settlementName || 'the town',
                    bailCost: jailDays * _num(T.bailPerDay, 25),
                    escapeChance: 0.08 + _num(player.skills.stealth) * 0.03,
                };
                player.stamina = 0;
                player.movementRemaining = 0;
            }
            const rep = kingdom ? `, −${T.reputation} standing in the realm` : '';
            const jail = jailDays ? ` Theft number ${offences}: the watch hauls you off for ${jailDays} days.` : '';
            return { ok: false, caught: true, fine, jailDays, text: `Caught with your hand in it! The ${g.name} goes back. Fined ${fine}g${rep}.${jail}` };
        }
    },
};
