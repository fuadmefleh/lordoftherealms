// ============================================
// KINGDOM NAVY — royal fleets, sea control and blockades
// ============================================
//
// kingdom.navy = {
//     strength,      // fighting strength of the royal fleet
//     cap,           // what the realm can keep afloat: ports × perPort × traits, and the treasury
//     ports,         // port settlements (a settlement next to water)
//     settlements,   // all settlements (ports / settlements = how much trade goes by sea)
//     portSites,     // [{ q, r }] of the ports (interception reads these)
//     blockades,     // { enemyId: sinceDay } — enemy fleets holding this realm's ports
//     auxiliary,     // galleys a sworn player lends while the realm is at war (set daily by RealmPolitics)
//     auxResults,    // { enemyId: { won, lost } } sea battles fought with those galleys
//                    //   (RealmPolitics.processFleetService turns them into merit and wounds)
//     _init,
// }
//
// What it does:
//  • Realms with ports build a fleet up to their cap, paid from the treasury,
//    and pay upkeep for it; a realm that can't pay sees its fleet rot.
//  • In a war, fleets clash at sea and the stronger one (by a margin)
//    blockades the other side's ports: its income falls by the share that
//    comes from its ports, the attacker storms a blockaded port more easily
//    (KingdomAI.simulateBattle), and its port markets pay worse or close
//    (Ships.getPortMarket).
//  • Hostile fleets intercept the player's ships near their ports (Ships.processDaily).
//
// Every roll here is a deterministic hash of the day and the realms involved
// — no Utils draws — so the daily world simulation's random stream (and
// world generation) is unchanged.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Terrain } from './terrain.js';
import { CrownBooks } from './crownBooks.js';

/** Tuning; overridden from data/military.json → kingdomNavy. */
const CONFIG = {
    perPort: 10,               // fleet strength each port can keep afloat
    capitalPort: 5,            // extra if the capital itself is a port
    traitMultiplier: { naval: 1.5, seafaring: 1.4, mercantile: 1.15 },
    reservePerStrength: 120,   // treasury the realm wants in hand per point of fleet
    buildCost: 25,             // gold per point of new strength
    buildRate: 0.05,           // share of the gap to the cap built each day (at least 1)
    upkeep: 0.3,               // gold per point of strength per day
    unpaidDecay: 0.05,         // share lost each day the upkeep goes unpaid
    overCapDecay: 0.1,         // share of any excess over the cap laid up each day
    startShare: 0.5,           // share of the cap afloat when the fleet is first counted
    blockade: {
        minStrength: 8,        // a fleet this small can't hold a blockade
        superiority: 1.25,     // must outnumber the defender's fleet by this much
        incomeLoss: 0.25,      // income lost by an all-port realm under blockade (scaled by its port share)
        siegeBonus: 0.12,      // attack power storming a blockaded port
        tightRatio: 3,         // blockader ≥ this × the defender's fleet: the harbour is shut
        marketBuy: 1.25,       // port prices under a loose blockade
        marketSell: 0.8,
    },
    battle: {
        chance: 0.15,          // daily chance two warring fleets meet
        minStrength: 4,
        loserLoss: 0.2,
        winnerLoss: 0.08,
    },
    intercept: {
        radius: 3,             // hexes from a hostile port
        peaceChance: 0.04,     // daily chance a hostile (not warring) realm's fleet stops a ship
        warChance: 0.12,       // ...and one at war with the player or the player's liege
        hostileReputation: -50,
        detachmentShare: 0.3,  // share of the fleet that sails out
        minDetachment: 6,
        maxDetachment: 60,
        fleetLoss: 0.5,        // share of a beaten detachment that is lost
        cargoSeized: 0.3,      // share of each good in the hold taken by a victorious fleet
        renown: 2,
        warScore: 10,          // war score against a realm the player is fighting
    },
    liegeService: {
        share: 0.5,            // share of the player's squadron strength that counts in the liege's fleet
        wagePerGalley: 4,      // the liege's daily pay per galley
        woundDays: 5,          // a galley mauled when the liege's fleet loses a battle
    },
};

function hash01(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
        h ^= h >>> 13;
    }
    return ((h >>> 0) % 100000) / 100000;
}

const day = (world) => (world && world.day) || 0;

export const KingdomNavy = {
    CONFIG,

    /** Deterministic roll in [0, 1) for these parts. */
    roll: hash01,

    /** Ensure kingdom.navy exists with every field (old saves too). */
    ensure(kingdom) {
        if (!kingdom.navy || typeof kingdom.navy !== 'object') kingdom.navy = {};
        const n = kingdom.navy;
        for (const key of ['strength', 'cap', 'ports', 'settlements', 'auxiliary']) {
            if (typeof n[key] !== 'number' || !Number.isFinite(n[key])) n[key] = 0;
        }
        if (!n.blockades || typeof n.blockades !== 'object') n.blockades = {};
        if (!Array.isArray(n.portSites)) n.portSites = [];
        if (!n.auxResults || typeof n.auxResults !== 'object') n.auxResults = {};
        if (typeof n._init !== 'boolean') n._init = false;
        return n;
    },

    /** A settlement on the water. */
    isPortTile(world, q, r) {
        const tile = world.getTile(q, r);
        if (!tile || !tile.settlement) return false;
        return Hex.neighbors(q, r).some(n => {
            const t = world.getTile(n.q, n.r);
            return !!(t && t.terrain && Terrain.isWaterId(t.terrain.id));
        });
    },

    /** The realm's settlements and which of them are ports. */
    survey(kingdom, world) {
        const ports = [];
        let settlements = 0;
        for (const t of kingdom.territory || []) {
            const tile = world.getTile(t.q, t.r);
            if (!tile || !tile.settlement || tile.settlement.kingdom !== kingdom.id) continue;
            settlements++;
            if (KingdomNavy.isPortTile(world, t.q, t.r)) ports.push({ q: t.q, r: t.r });
        }
        return { ports, settlements };
    },

    traitMultiplier(kingdom) {
        let m = 1;
        for (const t of (kingdom && kingdom.traits) || []) {
            const v = CONFIG.traitMultiplier[t];
            if (typeof v === 'number') m = Math.max(m, v);
        }
        return m;
    },

    /** Fleet the realm's harbours can keep afloat (ignoring the treasury). */
    portCap(kingdom, ports) {
        if (!ports.length) return 0;
        const cap = kingdom.capital && ports.some(p => p.q === kingdom.capital.q && p.r === kingdom.capital.r);
        return Math.floor((ports.length * CONFIG.perPort + (cap ? CONFIG.capitalPort : 0)) * KingdomNavy.traitMultiplier(kingdom));
    },

    /**
     * Daily: count ports, set the cap, pay upkeep, build toward the cap or lay
     * up ships over it, and drop blockades that no longer apply.
     */
    updateFleet(kingdom, world) {
        const n = KingdomNavy.ensure(kingdom);
        const { ports, settlements } = KingdomNavy.survey(kingdom, world);
        n.ports = ports.length;
        n.settlements = settlements;
        n.portSites = ports;
        const treasuryCap = Math.max(0, Math.floor((kingdom.treasury || 0) / CONFIG.reservePerStrength));
        n.cap = Math.min(KingdomNavy.portCap(kingdom, ports), treasuryCap);

        if (!n._init) {
            n.strength = Math.floor(n.cap * CONFIG.startShare);
            n._init = true;
        }

        // Upkeep — an unpaid fleet rots at its moorings
        const upkeep = Math.ceil(n.strength * CONFIG.upkeep);
        if (upkeep > 0) {
            if ((kingdom.treasury || 0) >= upkeep) { kingdom.treasury -= upkeep; CrownBooks.note(kingdom, 'army', upkeep); }
            else n.strength = Math.floor(n.strength * (1 - CONFIG.unpaidDecay));
        }

        if (n.strength > n.cap) {
            n.strength -= Math.max(1, Math.ceil((n.strength - n.cap) * CONFIG.overCapDecay));
            n.strength = Math.max(n.cap, n.strength);
        } else if (n.strength < n.cap) {
            const want = Math.min(n.cap - n.strength, Math.max(1, Math.ceil((n.cap - n.strength) * CONFIG.buildRate)));
            const cost = want * CONFIG.buildCost;
            if ((kingdom.treasury || 0) >= cost) {
                kingdom.treasury -= cost;
                n.strength += want;
            }
        }

        // Blockades end with the war, or when there are no ports left to hold
        for (const enemyId of Object.keys(n.blockades)) {
            if (!n.ports || !(kingdom.wars || []).includes(enemyId)) delete n.blockades[enemyId];
        }
        return n;
    },

    /** Fleet strength in battle: the royal fleet plus any galleys lent by a sworn player. */
    effectiveStrength(kingdom) {
        const n = kingdom && kingdom.navy;
        if (!n) return 0;
        return Math.max(0, (n.strength || 0) + (n.auxiliary || 0));
    },

    isBlockaded(kingdom) {
        const b = kingdom && kingdom.navy && kingdom.navy.blockades;
        return !!b && Object.keys(b).length > 0;
    },

    blockaders(kingdom) {
        const b = kingdom && kingdom.navy && kingdom.navy.blockades;
        return b ? Object.keys(b) : [];
    },

    /** Share of the realm's settlements that are ports (0-1). */
    portShare(kingdom) {
        const n = kingdom && kingdom.navy;
        if (!n || !n.settlements) return 0;
        return Utils.clamp(n.ports / n.settlements, 0, 1);
    },

    /** Multiplier on the realm's daily income: a blockade cuts its sea trade. */
    incomeFactor(kingdom) {
        if (!KingdomNavy.isBlockaded(kingdom)) return 1;
        return 1 - CONFIG.blockade.incomeLoss * KingdomNavy.portShare(kingdom);
    },

    /** Attack-power multiplier for storming a port the attacker's fleet blockades. */
    siegeMultiplier(attacker, defender, world, q, r) {
        const b = defender && defender.navy && defender.navy.blockades;
        if (!b || b[attacker.id] == null) return 1;
        return KingdomNavy.isPortTile(world, q, r) ? 1 + CONFIG.blockade.siegeBonus : 1;
    },

    /**
     * A fleet battle between two warring realms. Deterministic: the day and
     * the pair decide whether they meet and how the luck falls.
     * @returns {{ winner, loser } | null}
     */
    fleetBattle(a, b, world) {
        const B = CONFIG.battle;
        const sa = KingdomNavy.effectiveStrength(a);
        const sb = KingdomNavy.effectiveStrength(b);
        if (sa < B.minStrength || sb < B.minStrength) return null;
        const d = day(world);
        const pa = sa * (0.8 + 0.4 * hash01('fleet', d, a.id, b.id));
        const pb = sb * (0.8 + 0.4 * hash01('fleet', d, b.id, a.id));
        const [winner, loser] = pa >= pb ? [a, b] : [b, a];
        const wn = KingdomNavy.ensure(winner);
        const ln = KingdomNavy.ensure(loser);
        // Only the royal fleets bleed; lent galleys are wounded by the player side
        ln.strength = Math.floor(ln.strength * (1 - B.loserLoss));
        wn.strength = Math.floor(wn.strength * (1 - B.winnerLoss));
        // Battles the sworn player's galleys fought in (RealmPolitics.processFleetService reads them)
        if (wn.auxiliary > 0) KingdomNavy._auxResult(wn, loser.id).won += 1;
        if (ln.auxiliary > 0) KingdomNavy._auxResult(ln, winner.id).lost += 1;
        if (world && Array.isArray(world.events)) {
            world.events.push({ text: `⚓ ${winner.name}'s fleet defeats ${loser.name}'s at sea.`, type: 'military' });
        }
        return { winner, loser };
    },

    /**
     * One day of a war at sea: the fleets may clash, then whoever holds the
     * sea by a clear margin blockades the other side's ports.
     */
    processWar(a, b, world) {
        KingdomNavy.ensure(a);
        KingdomNavy.ensure(b);
        if (hash01('meet', day(world), [a.id, b.id].sort().join('_')) < CONFIG.battle.chance) {
            KingdomNavy.fleetBattle(a, b, world);
        }
        for (const [x, y] of [[a, b], [b, a]]) KingdomNavy._updateBlockade(x, y, world);
    },

    _auxResult(navy, enemyId) {
        if (!navy.auxResults || typeof navy.auxResults !== 'object') navy.auxResults = {};
        if (!navy.auxResults[enemyId]) navy.auxResults[enemyId] = { won: 0, lost: 0 };
        return navy.auxResults[enemyId];
    },

    _updateBlockade(blockader, target, world) {
        const B = CONFIG.blockade;
        const tn = KingdomNavy.ensure(target);
        const sx = KingdomNavy.effectiveStrength(blockader);
        const holds = tn.ports > 0 && sx >= B.minStrength && sx >= KingdomNavy.effectiveStrength(target) * B.superiority;
        const had = tn.blockades[blockader.id] != null;
        if (holds && !had) {
            tn.blockades[blockader.id] = day(world);
            if (world && Array.isArray(world.events)) {
                world.events.push({ text: `⚓ ${blockader.name}'s fleet blockades the ports of ${target.name}.`, type: 'military' });
            }
        } else if (!holds && had) {
            delete tn.blockades[blockader.id];
            if (world && Array.isArray(world.events)) {
                world.events.push({ text: `⛵ The blockade of ${target.name}'s ports is broken.`, type: 'military' });
            }
        }
    },

    /**
     * The blockade over the port at (q, r), if its realm is blockaded:
     * { kingdom, blockaders: [kingdom], closed } — closed when the blockading
     * fleets dwarf the realm's own (tightRatio), otherwise prices suffer.
     */
    portBlockade(world, q, r) {
        const tile = world && world.getTile ? world.getTile(q, r) : null;
        const owner = tile && tile.settlement && tile.settlement.kingdom && world.getKingdom
            ? world.getKingdom(tile.settlement.kingdom) : null;
        if (!owner || !owner.isAlive || !KingdomNavy.isBlockaded(owner)) return null;
        if (!KingdomNavy.isPortTile(world, q, r)) return null;
        const blockaders = KingdomNavy.blockaders(owner).map(id => world.getKingdom(id)).filter(Boolean);
        if (!blockaders.length) return null;
        const strongest = Math.max(...blockaders.map(k => KingdomNavy.effectiveStrength(k)));
        const closed = strongest >= KingdomNavy.effectiveStrength(owner) * CONFIG.blockade.tightRatio;
        return { kingdom: owner, blockaders, closed };
    },

    /**
     * Royal fleets near (q, r): realms with a port within `radius` hexes
     * and a fleet strong enough to send a detachment.
     * @returns {{ kingdom, distance }[]} nearest first
     */
    fleetsNear(world, q, r, radius = CONFIG.intercept.radius) {
        const out = [];
        for (const k of (world && world.kingdoms) || []) {
            if (!k.isAlive || !k.navy || (k.navy.strength || 0) < CONFIG.intercept.minDetachment) continue;
            let best = Infinity;
            for (const p of k.navy.portSites || []) {
                best = Math.min(best, Hex.wrappingDistance(q, r, p.q, p.r, world.width));
            }
            if (best <= radius) out.push({ kingdom: k, distance: best });
        }
        return out.sort((x, y) => x.distance - y.distance);
    },

    /** Strength of the detachment a fleet sends after a ship. */
    detachment(kingdom) {
        const I = CONFIG.intercept;
        return Utils.clamp(Math.round(((kingdom.navy && kingdom.navy.strength) || 0) * I.detachmentShare), I.minDetachment, I.maxDetachment);
    },
};
