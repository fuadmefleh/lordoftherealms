// ============================================
// CONTAINERS — what's inside, and helping yourself to it
// ============================================
// Every chest, crate, barrel, shelf and sack on an inner map holds something.
// What it holds is rolled from the world seed, the place (world tile, the
// building, the furniture's spot) and the restock period, so the same chest
// shows the same things every time you open it until the period turns. Only
// what the player has removed is stored: player.containerLoot[key] =
// { period, taken: { goodId: qty } } (saved with the player).
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
// Tables in data/containers.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Underworld } from './underworld.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';

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

    /** What the container was stocked with this period, before anything was taken. */
    stocked(world, ctx) {
        const rng = Utils.seededRandom((_hash(`${_seed(world)}:box:${Containers.key(ctx)}:${Containers.period(world)}`) % 233279) + 1);
        const out = {};
        for (const row of Containers.table(ctx)) {
            const [id, chance, min, max] = row;
            if (rng() >= _num(chance)) continue;
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
            rec = { period, taken: {} };
            player.containerLoot[k] = rec;
        }
        return rec;
    },

    /** What's in it now: { goodId: qty }. */
    contents(player, world, ctx) {
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
        const w = Math.max(0, _num(scene.witnesses));
        if (w) { c += w * T.perWitness; parts.push({ label: `${w} ${w === 1 ? 'person' : 'people'} nearby`, delta: w * T.perWitness }); }
        const g = Math.max(0, _num(scene.guards));
        if (g) { c += g * T.guardWitness; parts.push({ label: `${g} guard${g === 1 ? '' : 's'} in sight`, delta: g * T.guardWitness }); }
        if (scene.ownerInside) { c += T.ownerInside; parts.push({ label: 'The owner is here', delta: T.ownerInside }); }
        const h = _num(scene.hour, 12);
        if (h >= T.nightFrom || h < T.nightTo) { c += T.night; parts.push({ label: 'Dark of night', delta: T.night }); }
        if (!ctx.building && ctx.inSettlement) { c += T.outdoorsTown; parts.push({ label: 'Out in the street', delta: T.outdoorsTown }); }
        const stealth = _num(player && player.skills && player.skills.stealth);
        if (stealth) { c += stealth * T.perStealth; parts.push({ label: `Stealth ${Math.round(stealth * 10) / 10}`, delta: stealth * T.perStealth }); }
        const value = _num(Containers.good(goodId).basePrice) * Math.max(1, qty);
        if (value) { c += value * T.perValue; parts.push({ label: `Worth ${value}g`, delta: value * T.perValue }); }
        return { chance: Math.min(T.max, Math.max(T.min, c)), parts };
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
            const rec = Containers._record(player, world, ctx);
            rec.taken[goodId] = _num(rec.taken[goodId]) + n;
        }
        return res;
    },

    /**
     * The theft itself, of n of a good from wherever (a container, a field):
     * one roll from the game's RNG; caught → fine, standing, record, maybe the
     * cells; away → the goods, hot. → { ok, caught, qty, fine, jailDays, text }
     */
    stealGoods(player, world, ctx, goodId, n, scene = {}) {
        const T = Containers.cfg('theft');
        const g = Containers.good(goodId);
        const { chance } = Containers.stealOdds(player, ctx, goodId, n, scene);
        const kingdom = ctx.kingdom || null;
        if (!player.skills) player.skills = {};

        if (Utils.random() < chance) {
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
            player.skills.stealth = Math.min(10, _num(player.skills.stealth) + T.stealthXp / 3);
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

        Containers._give(player, goodId, n);
        Underworld.markHot(player, goodId, n, _day(world));
        Underworld.recordCrime(player, world, 'theft', { kingdom, caught: false, scale: Math.min(2, 0.5 + (_num(g.basePrice) * n) / 100) });
        player.skills.stealth = Math.min(10, _num(player.skills.stealth) + T.stealthXp);
        return { ok: true, caught: false, qty: n, text: `You slip ${n} ${g.name} into your pack unseen. Mind where you sell it: it's hot.` };
    },
};
