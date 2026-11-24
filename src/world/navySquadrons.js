// ============================================
// NAVY SQUADRONS — royal fleets as ships on the map
// ============================================
//
// kingdom.navy (world/kingdomNavy.js) keeps a realm's fleet as one number.
// This shows it as ships: each realm's fleet is split into
//
//   blockade squadrons — on station off each blockaded port of an enemy
//                         realm (navy.blockades), a few hexes of water
//                         beside the harbour mouth, beating up and down;
//   patrol squadrons   — the rest of the fleet on a picket line out from
//                         its own ports (or between two of them), out and
//                         back along a sea route.
//
// Where a squadron is on a day is a pure function of the day and its route
// (a hash of its id staggers them), so nothing is saved and nothing draws
// from the shared RNG: the list is rebuilt once a day per world (cached in
// a WeakMap — no field on the world, nothing in the save) and the routes
// only when a realm's ports change. Cheap enough to ask every frame.
//
// slipChance() is the pure odds of a ship running past a blockade, by
// night, weather, speed and stealth (systems/blockadeRunning.js uses it).
// A patrol is what stops a ship at sea: each patrol's `swept` water (the
// hexes of its route it sailed through today) is matched against the
// ship's own day's path (patrolsAlong), and catchChance() is the odds of
// its lookouts having her — the slip odds' weather and stealth, closeness,
// sail on the picket line, her speed against theirs (systems/ships.js
// _interceptShips, systems/seaInterception.js).
//
// Explicit params, no globals, no RNG.

import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Terrain } from './terrain.js';
import { KingdomNavy } from './kingdomNavy.js';

const DEFAULTS = {
    minStrength: 8,          // a fleet smaller than this keeps to harbour (nothing shown)
    blockadeShare: 0.6,      // share of a blockading fleet on station off the enemy's ports
    maxBlockadedPorts: 3,    // ports of one realm held at once (capital first)
    perPatrol: 30,           // fleet strength per patrol squadron
    maxPatrols: 3,
    perShip: 12,             // strength a ship stands for (ships shown in a squadron)
    maxShips: 5,
    patrolReach: 7,          // hexes a picket line runs out from its port
    patrolSpeed: 2,          // hexes a day along the route
    maxSearch: 3000,         // nodes a route search may visit
    slip: {
        base: 0.3,
        night: 0.25,
        weather: { fog: 0.2, storm: 0.15, blizzard: 0.15, rain: 0.1, snow: 0.08, cloudy: 0.04 },
        speed: 0.05,         // per knot faster than the squadron
        stealth: 0.03,       // per point of the captain's stealth
        shipStealth: 0.05,   // per point of the ship's stealth fittings
        perShip: 0.04,       // per ship of the squadron beyond the first
        closed: 0.12,        // a tight blockade (the harbour shut) watches harder
        min: 0.05,
        max: 0.9,
    },
    squadronSpeed: { blockade: 5, patrol: 5 },
    intercept: {
        reach: 2,            // hexes from a patrol's swept water at which its lookouts can have a ship
        base: 0.5,           // the odds of a patrol bringing to a ship on its own water
        perHex: 0.15,        // ...less per hex she passes off its track
        perShip: 0.05,       // ...more per sail beyond the first (a wider net)
        night: 0.2,          // ...less sailing on through the dark (all night = 1)
        speed: 0.05,         // ...less per knot she is faster than the squadron
        peace: 0.2,          // ...less from a realm not at war with you (merely hostile)
        min: 0.03,
        max: 0.85,
    },
};

const _caches = new WeakMap();

function _hash(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    return h >>> 0;
}

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? _merge(base[k], v) : v;
    }
    return out;
}

let _cfg = null;
let _cfgSrc = null;

const _key = (q, r) => `${q},${r}`;

function _isWater(world, q, r) {
    const t = world.getTile(q, r);
    return !!(t && t.terrain && Terrain.isWaterId(t.terrain.id));
}

function _nbrs(world, q, r) {
    const W = world.width || 0;
    const H = world.height || 0;
    const out = [];
    for (const n of Hex.neighbors(q, r)) {
        const nq = W ? Hex.wrapQ(n.q, W) : n.q;
        if (H && (n.r < 0 || n.r >= H)) continue;
        out.push({ q: nq, r: n.r });
    }
    return out;
}

/** Back and forth along a route of `len` cells: the index at step `s`. */
function _pingPong(s, len) {
    if (len <= 1) return 0;
    const period = 2 * (len - 1);
    const m = ((s % period) + period) % period;
    return m < len ? m : period - m;
}

export const NavySquadrons = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.seaFights ? DataLoader._gamedata.seaFights.squadrons : null;
        if (!_cfg || _cfgSrc !== src) {
            _cfg = _merge(DEFAULTS, src || {});
            _cfgSrc = src;
        }
        return _cfg;
    },

    /** Drop the cached list and routes (tests, a loaded game). */
    reset(world) {
        if (world) _caches.delete(world);
    },

    _cache(world) {
        let c = _caches.get(world);
        if (!c) { c = { day: null, sig: null, list: [], routes: new Map() }; _caches.set(world, c); }
        return c;
    },

    /** The water hexes beside a port, steadily ordered (its harbour mouth). */
    _mouth(world, port) {
        return _nbrs(world, port.q, port.r).filter(n => _isWater(world, n.q, n.r));
    },

    /**
     * Breadth-first over open water from `from`: to `to` when given (the
     * path, from excluded), else out to `reach` hexes (the path to the
     * farthest water reached — a picket line).
     */
    _seaRoute(world, from, to = null, reach = 7) {
        const max = NavySquadrons.config().maxSearch;
        const start = { q: from.q, r: from.r, d: 0, prev: null };
        const seen = new Map([[_key(from.q, from.r), start]]);
        const queue = [start];
        let far = start;
        for (let i = 0; i < queue.length && seen.size < max; i++) {
            const cur = queue[i];
            if (!to && cur.d >= reach) continue;
            for (const n of _nbrs(world, cur.q, cur.r)) {
                const k = _key(n.q, n.r);
                if (seen.has(k) || !_isWater(world, n.q, n.r)) continue;
                const node = { q: n.q, r: n.r, d: cur.d + 1, prev: cur };
                seen.set(k, node);
                if (to && n.q === to.q && n.r === to.r) { far = node; i = queue.length; break; }
                if (node.d > far.d) far = node;
                queue.push(node);
            }
        }
        if (to && (far.q !== to.q || far.r !== to.r)) return null;
        const path = [];
        for (let n = far; n; n = n.prev) path.push({ q: n.q, r: n.r });
        return path.reverse();
    },

    /** A patrol's route: between two of the realm's ports by sea, else a picket line out from one. */
    _patrolRoute(world, k, i, cache) {
        const ports = (k.navy && k.navy.portSites) || [];
        const sig = `${k.id}|${i}|${ports.map(p => _key(p.q, p.r)).join(';')}`;
        if (cache.routes.has(sig)) return cache.routes.get(sig);
        const C = NavySquadrons.config();
        let route = null;
        const a = ports[i % ports.length];
        const mouthA = a ? NavySquadrons._mouth(world, a) : [];
        if (ports.length >= 2 && mouthA.length) {
            const b = ports[(i + 1 + Math.floor(ports.length / 2)) % ports.length];
            const mouthB = b && (b.q !== a.q || b.r !== a.r) ? NavySquadrons._mouth(world, b) : [];
            if (mouthB.length) {
                const r = NavySquadrons._seaRoute(world, mouthA[0], mouthB[0]);
                if (r && r.length <= C.patrolReach * 4) route = r;
            }
        }
        if (!route && mouthA.length) {
            const from = mouthA[_hash(k.id, i) % mouthA.length];
            route = NavySquadrons._seaRoute(world, from, null, C.patrolReach);
        }
        cache.routes.set(sig, route || []);
        return route || [];
    },

    /** Ships a squadron of this strength stands for. */
    shipsFor(strength) {
        const C = NavySquadrons.config();
        return Math.max(1, Math.min(C.maxShips, Math.round(strength / C.perShip)));
    },

    _sig(world) {
        let s = '';
        for (const k of world.kingdoms || []) {
            if (!k || !k.isAlive || !k.navy) continue;
            s += `${k.id}:${Math.round(k.navy.strength || 0)}:${(k.navy.portSites || []).length}:${Object.keys(k.navy.blockades || {}).join(',')};`;
        }
        return s;
    },

    /**
     * Every royal squadron at sea today:
     * [{ id, kind: 'blockade'|'patrol', kingdomId, kingdomName, color, targetId?, port?,
     *    q, r, strength, ships, name, route }]
     */
    list(world) {
        if (!world || typeof world.getTile !== 'function') return [];
        const c = NavySquadrons._cache(world);
        const day = world.day || 0;
        const sig = NavySquadrons._sig(world);
        if (c.day === day && c.sig === sig) return c.list;
        const C = NavySquadrons.config();
        const out = [];
        const kingdoms = (world.kingdoms || []).filter(k => k && k.isAlive && k.navy);
        for (const k of kingdoms) {
            const n = k.navy;
            const strength = KingdomNavy.effectiveStrength(k);
            if (strength < C.minStrength || !(n.portSites || []).length) continue;
            // The blockades this realm holds: on station off the enemy's ports
            const held = kingdoms.filter(t => t !== k && t.navy.blockades && t.navy.blockades[k.id] != null && (t.navy.portSites || []).length);
            const onStation = held.length ? strength * C.blockadeShare : 0;
            for (const t of held) {
                const ports = [...t.navy.portSites]
                    .sort((p1, p2) => (t.capital && p2.q === t.capital.q && p2.r === t.capital.r ? 1 : 0) - (t.capital && p1.q === t.capital.q && p1.r === t.capital.r ? 1 : 0))
                    .slice(0, C.maxBlockadedPorts);
                const per = onStation / (held.length * ports.length);
                for (const p of ports) {
                    const mouth = NavySquadrons._mouth(world, p);
                    if (!mouth.length) continue;
                    const id = `b:${k.id}:${t.id}:${p.q},${p.r}`;
                    const at = mouth[_pingPong(day + (_hash(id) % 7), mouth.length)];
                    const tile = world.getTile(p.q, p.r);
                    const portName = (tile && tile.settlement && tile.settlement.name) || 'the port';
                    out.push({
                        id, kind: 'blockade', kingdomId: k.id, kingdomName: k.name, color: k.color || '#8fb8ea',
                        targetId: t.id, targetName: t.name, port: { q: p.q, r: p.r }, portName,
                        q: at.q, r: at.r, strength: Math.round(per), ships: NavySquadrons.shipsFor(per),
                        speed: C.squadronSpeed.blockade, since: t.navy.blockades[k.id],
                        name: `${k.name}'s blockade off ${portName}`, route: mouth,
                    });
                }
            }
            // The rest of the fleet on patrol
            const rest = strength - onStation;
            const count = rest >= C.minStrength ? Math.max(1, Math.min(C.maxPatrols, Math.floor(rest / C.perPatrol))) : 0;
            // Squadrons that would sail the same water are one squadron (a lone port's pickets can coincide)
            const routes = [];
            const routeKeys = new Set();
            for (let i = 0; i < count; i++) {
                const route = NavySquadrons._patrolRoute(world, k, i, c);
                const rk = route.map(h => _key(h.q, h.r)).join(';');
                if (!route.length || routeKeys.has(rk)) continue;
                routeKeys.add(rk);
                routes.push(route);
            }
            for (let i = 0; i < routes.length; i++) {
                const route = routes[i];
                const id = `p:${k.id}:${i}`;
                const step = day * C.patrolSpeed + (_hash(id) % Math.max(1, route.length * 2));
                const at = route[_pingPong(step, route.length)];
                const per = rest / routes.length;
                // the water it sailed through today: yesterday's place to today's
                const swept = [];
                const seenSw = new Set();
                for (let b = C.patrolSpeed; b >= 0; b--) {
                    const h = route[_pingPong(step - b, route.length)];
                    const hk = _key(h.q, h.r);
                    if (!seenSw.has(hk)) { seenSw.add(hk); swept.push({ q: h.q, r: h.r }); }
                }
                out.push({
                    id, kind: 'patrol', kingdomId: k.id, kingdomName: k.name, color: k.color || '#8fb8ea',
                    q: at.q, r: at.r, strength: Math.round(per), ships: NavySquadrons.shipsFor(per),
                    speed: C.squadronSpeed.patrol,
                    name: `${k.name}'s ${['home', 'coast', 'channel'][i] || 'sea'} squadron`, route, swept,
                });
            }
        }
        c.day = day;
        c.sig = sig;
        c.list = out;
        return out;
    },

    get(world, id) {
        return NavySquadrons.list(world).find(s => s.id === id) || null;
    },

    /** Squadrons within `radius` hexes of (q, r), nearest first: [{ squadron, distance }]. */
    near(world, q, r, radius = 1) {
        const W = (world && world.width) || 0;
        const out = [];
        for (const s of NavySquadrons.list(world)) {
            const d = W ? Hex.wrappingOffsetDistance(q, r, s.q, s.r, W) : Hex.offsetDistance(q, r, s.q, s.r);
            if (d <= radius) out.push({ squadron: s, distance: d });
        }
        return out.sort((a, b) => a.distance - b.distance);
    },

    /**
     * Patrol squadrons whose water today (their `swept` hexes) comes within
     * `reach` hexes of a ship's day's path ([{ q, r }]), nearest first:
     * [{ squadron, distance }]. Blockades keep their station (holdsShip).
     */
    patrolsAlong(world, path, reach = NavySquadrons.config().intercept.reach) {
        const cells = (path || []).filter(h => h && typeof h.q === 'number' && typeof h.r === 'number');
        if (!world || !cells.length) return [];
        const W = world.width || 0;
        const dist = (a, b) => (W ? Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, W) : Hex.offsetDistance(a.q, a.r, b.q, b.r));
        const out = [];
        for (const s of NavySquadrons.list(world)) {
            if (s.kind !== 'patrol') continue;
            let best = Infinity;
            for (const w of s.swept && s.swept.length ? s.swept : [{ q: s.q, r: s.r }]) {
                for (const c of cells) best = Math.min(best, dist(c, w));
                if (best === 0) break;
            }
            if (best <= reach) out.push({ squadron: s, distance: best });
        }
        return out.sort((a, b) => a.distance - b.distance);
    },

    /**
     * The odds a patrol brings a ship to (0..1), pure:
     * { distance, night (0..1 of the day's run in the dark), weather, speed,
     *   squadronSpeed, stealth, shipStealth, ships, war }. The weather and
     * stealth terms are slipChance's. → { chance, parts: [{ label, value }] }
     */
    catchChance(o = {}) {
        const C = NavySquadrons.config();
        const I = C.intercept;
        const S = C.slip;
        const parts = [{ label: 'Their lookouts', value: I.base }];
        const d = Math.max(0, Number(o.distance) || 0);
        if (d) parts.push({ label: `${d} league${d === 1 ? '' : 's'} off their track`, value: -d * I.perHex });
        const extra = Math.max(0, (Number(o.ships) || 1) - 1);
        if (extra) parts.push({ label: `${o.ships} sail on the picket`, value: extra * I.perShip });
        const night = Math.max(0, Math.min(1, Number(o.night) || 0));
        if (night) parts.push({ label: 'Running on in the dark', value: -night * I.night });
        const wx = o.weather && S.weather[o.weather];
        if (wx) parts.push({ label: o.weather === 'fog' ? 'Fog' : `The ${o.weather}`, value: -wx });
        const knots = (Number(o.speed) || 0) - (Number(o.squadronSpeed) || 0);
        if (knots) parts.push({ label: knots > 0 ? 'Your speed' : 'Their speed', value: -knots * I.speed });
        if (o.stealth) parts.push({ label: 'Your stealth', value: -o.stealth * S.stealth });
        if (o.shipStealth) parts.push({ label: 'A quiet ship', value: -o.shipStealth * S.shipStealth });
        if (!o.war) parts.push({ label: 'Not at war', value: -I.peace });
        const raw = parts.reduce((a, p) => a + p.value, 0);
        return { chance: Math.max(I.min, Math.min(I.max, raw)), parts };
    },

    /**
     * The blockade squadron guarding the port at (q, r) — the strongest when
     * several realms hold it — with whether the harbour is shut. Null when
     * the port is not held.
     */
    guarding(world, q, r) {
        const W = (world && world.width) || 0;
        const qq = W ? Hex.wrapQ(q, W) : q;
        const here = NavySquadrons.list(world).filter(s => s.kind === 'blockade' && s.port.q === qq && s.port.r === r);
        if (!here.length) return null;
        const squadron = here.reduce((a, b) => (b.strength > a.strength ? b : a));
        const pb = KingdomNavy.portBlockade(world, qq, r);
        return { squadron, closed: !!(pb && pb.closed), all: here };
    },

    /**
     * Does a blockade hold this player's ship at the port (q, r)? Ships of
     * the blockading realm and its allies (the player's allegiance) pass;
     * everyone else is stopped. → the guarding() record, or null.
     */
    holdsShip(world, player, q, r) {
        const g = NavySquadrons.guarding(world, q, r);
        if (!g) return null;
        const own = player && player.allegiance;
        if (own) {
            const friends = g.all.every(s => {
                if (s.kingdomId === own) return true;
                const k = world.getKingdom ? world.getKingdom(s.kingdomId) : null;
                return !!(k && (k.allies || []).includes(own));
            });
            if (friends) return null;
        }
        return g;
    },

    /**
     * The odds of slipping past a blockade squadron unseen (0..1), pure:
     * { night, weather, speed, squadronSpeed, stealth, shipStealth, ships, closed }.
     * Also the parts, for the panel: → { chance, parts: [{ label, value }] }
     */
    slipChance(o = {}) {
        const S = NavySquadrons.config().slip;
        const parts = [{ label: 'Lookouts', value: S.base }];
        if (o.night) parts.push({ label: 'Dark', value: S.night });
        const wx = o.weather && S.weather[o.weather];
        if (wx) parts.push({ label: o.weather === 'fog' ? 'Fog' : `The ${o.weather}`, value: wx });
        const knots = (Number(o.speed) || 0) - (Number(o.squadronSpeed) || 0);
        if (knots) parts.push({ label: knots > 0 ? 'Your speed' : 'Their speed', value: knots * S.speed });
        if (o.stealth) parts.push({ label: 'Your stealth', value: o.stealth * S.stealth });
        if (o.shipStealth) parts.push({ label: 'A quiet ship', value: o.shipStealth * S.shipStealth });
        const extra = Math.max(0, (Number(o.ships) || 1) - 1);
        if (extra) parts.push({ label: `${o.ships} sail on watch`, value: -extra * S.perShip });
        if (o.closed) parts.push({ label: 'A close blockade', value: -S.closed });
        const raw = parts.reduce((a, p) => a + p.value, 0);
        return { chance: Math.max(S.min, Math.min(S.max, raw)), parts };
    },
};
