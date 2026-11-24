// ============================================
// SEA FIGHTS — ships under sail, broadsides and grappling
// ============================================
//
// A fight at sea as ships on the water rather than a menu roll. Each ship
// has a place (x, y in inner-map tiles), a heading and a speed that follows
// the wind (point of sail; galleys row and care less), a hull, rigging and
// crew. Guns fire as broadsides when an enemy lies on the beam within range
// and the guns are loaded; a ship that crosses another's bow or stern RAKES
// her (more damage, she cannot answer). Round shot breaks hulls, chain shot
// cuts rigging (and with it speed), grape clears decks of men. Hull gone,
// a ship sinks; beaten (hull or crew low), she strikes her colours. Ships
// ordered to grapple come alongside and lash on: the flagship grappling (or
// grappled) ends the sailing in a BOARDING, fought hand to hand on the deck
// (ui/innerMapDeck.js) — or rolled by the crews when nobody is watching.
//
// Sides: 'player' (your flagship, the ship you stand aboard, and your
// squadron: your other crewed ships in company and the war galleys of your
// army) and 'enemy' (a pirate, a merchantman and her escort, a navy
// detachment or a blockade squadron). Orders:
//   flagship  close · rake · broadside (keep at range) · grapple · flee · hold
//   squadron  follow (keep station on the flagship) · engage · hold
//   shot      round · chain · grape
// The enemy picks its own by kind (pirates love to board; navies stand off
// and pound; merchants run) and by how the fight goes.
//
// The fight is a plain object (`create`), advanced in fixed steps
// (`advance(fight, seconds)`), drawn by ui/innerMapSeaFight.js. Its dice
// are its own: a hash of the fight's seed and a counter, never Utils after
// `create` — the same orders give the same fight whatever the frame rate,
// and the world's random stream is untouched. `autoResolve` sails it out
// headless (the sailing master's own orders; a boarding rolled by crews),
// the fallback when the deck is left or the captain hands over.
// `applyToFleet` writes the damage back to your ships and galleys;
// `settlePirates` turns the end into the pirates' phased scene's own
// victory / defeat / aftermath (systems/pirates.js).
//
// Explicit params, no DOM, no globals.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Ships } from './ships.js';
import { Pirates } from './pirates.js';
import { Technology } from './technology.js';
import { Quests } from './quests.js';
import { ShipOfficers } from './shipOfficers.js';

const DEFAULTS = {
    step: 0.25,                  // seconds a step
    maxTime: 300,                // seconds of sailing before both sides break off
    speedPerKnot: 0.1,           // tiles a second per point of a ship type's speed
    accel: 0.6,
    turn: { base: 0.5, perGun: 0.006, min: 0.18 },
    pointOfSail: [[0, 0.8], [45, 0.95], [90, 1], [120, 0.82], [140, 0.5], [155, 0.22], [180, 0.1]],
    noSailHeadTo: 150,           // degrees off the wind's eye a sailing ship can point
    oared: ['war_galley', 'rowboat'],
    shot: {
        round: { range: 7, hull: 0.7, rig: 0.1, crew: 0.2 },
        chain: { range: 5, hull: 0.15, rig: 0.7, crew: 0.15 },
        grape: { range: 4, hull: 0.1, rig: 0.1, crew: 0.8 },
    },
    arc: [50, 130],              // degrees off the bow the broadside bears
    chase: { arc: 25, share: 0.2, range: 0.8 }, // bow and stern chasers: a few guns that bear fore and aft
    rakeArc: 30,                 // within this of her bow or stern: raking
    rakeMult: 1.8,
    reload: 7,                   // seconds for a full crew
    hit: { base: 0.85, range: 0.45, night: 0.15, fog: 0.2, storm: 0.12, skill: 0.02 },
    damageScale: 2.2,
    toughness: { base: 30, armor: 4, guns: 2 },
    strike: {
        checkEvery: 2,
        hull: 30, crew: 0.35, chance: 0.35,
        cruelHull: 12, cruelCrew: 0.15,
        navyHull: 20,
        merchantHull: 60, merchantCrew: 0.6,
        flagHull: 6,             // your flagship strikes (you are beaten) at this hull
    },
    grapple: { range: 1.6, speedDiff: 0.5, chance: 0.3, every: 1 },
    escapeRange: 24,
    start: { distance: 16, spread: 4 },
    keepRange: 5,
    stationAstern: 3.5,
    stationAbeam: 2.2,
    aiEvery: 1.5,
    navy: { perShip: 20, maxShips: 4 },
};

const DEG = Math.PI / 180;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

/** Smallest signed angle a − b, in (−π, π]. */
function _angDiff(a, b) {
    let d = (a - b) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d <= -Math.PI) d += 2 * Math.PI;
    return d;
}

function _hash32(a, b) {
    let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
}

let _cfg = null;
let _cfgSrc = null;

export const SeaFights = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.seaFights ? DataLoader._gamedata.seaFights.fight : null;
        if (!_cfg || _cfgSrc !== src) {
            _cfg = _merge(DEFAULTS, src || {});
            _cfgSrc = src;
        }
        return _cfg;
    },

    /** The fight's own dice: [0, 1). */
    _r(f) {
        f.n = (f.n || 0) + 1;
        return _hash32(f.seed >>> 0, f.n) / 4294967296;
    },

    // ──────────── SHIPS ────────────

    _typeOf(typeId) {
        return Ships.getShipType(typeId) || Ships.getShipType('sloop') || { id: 'sloop', speed: 5, combatStrength: 8, armor: 3, crewRequired: 4 };
    },

    _spec(o) {
        const C = SeaFights.config();
        const t = SeaFights._typeOf(o.typeId);
        const guns = Math.max(1, _num(o.guns, t.combatStrength));
        const crew0 = Math.max(1, Math.round(_num(o.crew0, t.crewRequired)));
        return {
            id: o.id, side: o.side, name: o.name || 'a ship', kind: o.kind || null,
            typeId: t.id, hullId: o.hullId || null, flagship: !!o.flagship,
            shipId: o.shipId == null ? null : o.shipId, unitId: o.unitId == null ? null : o.unitId,
            temperament: o.temperament || null,
            x: _num(o.x), y: _num(o.y), heading: _num(o.heading, Math.PI), speed: 0,
            maxSpeed: Math.max(0.2, _num(o.knots, t.speed) * C.speedPerKnot),
            turn: Math.max(C.turn.min, C.turn.base - guns * C.turn.perGun),
            oared: C.oared.includes(t.id),
            guns, guns0: guns, armor: Math.max(0, _num(o.armor, t.armor)),
            drill: _num(o.drill, 1),
            hull: _clamp(_num(o.hull, 100), 1, 100), hull0: _clamp(_num(o.hull, 100), 1, 100), rigging: 100,
            crew: Math.max(0, _num(o.crew, crew0)), crewStart: Math.max(0, _num(o.crew, crew0)), crew0,
            reloadLeft: 1 + (o.side === 'enemy' ? 1.5 : 0), shot: 'round',
            order: o.order || (o.side === 'player' ? 'close' : 'close'), target: null,
            struck: false, sunk: false, fled: false, taken: false, grappled: null,
            _ai: 0,
        };
    },

    active(s) {
        return !!s && !s.struck && !s.sunk && !s.fled && !s.taken;
    },

    ships(fight, side) {
        return fight.ships.filter(s => s.side === side);
    },

    flagship(fight) {
        return fight.ships.find(s => s.flagship) || null;
    },

    ship(fight, id) {
        return fight.ships.find(s => s.id === id) || null;
    },

    /**
     * Your side: the ship you are aboard, then your other crewed ships within
     * a hex (at sea or at anchor) and the war galleys of your army, up to
     * `max` consorts. → spec options for _spec
     */
    playerSide(player, world, max = 4) {
        const out = [];
        const flag = Ships.getShipById(player, player.boardedShip);
        if (!flag) return out;
        const drill = 1 + Technology.getEffectTotal(player, 'navalCombatBonus');
        const fromShip = (ship, i, flagship) => {
            const st = Ships.getShipEffectiveStats(ship);
            return {
                id: `p${i}`, side: 'player', name: ship.name, typeId: ship.typeId, flagship, shipId: ship.id,
                guns: st.combatStrength * drill, armor: st.armor, crew: Ships.getCrew(ship), crew0: st.crewRequired,
                knots: flagship ? Ships.getSailingSpeed(player, ship) : st.speed * Ships.getCrewSpeedFactor(ship),
                drill: Ships.getCrewCombatFactor(ship, player), hull: _num(ship.condition, 100),
                // her master gunner's eye (systems/shipOfficers.js)
                gunnery: flagship ? ShipOfficers.bonus(ship, 'gunnery', world) : 0,
            };
        };
        out.push(fromShip(flag, 0, true));
        const W = (world && world.width) || 0;
        const near = (q, r) => typeof q === 'number' && typeof r === 'number'
            && (W ? Hex.wrappingOffsetDistance(q, r, player.q, player.r, W) : Hex.offsetDistance(q, r, player.q, player.r)) <= 1;
        for (const s of player.ships || []) {
            if (out.length > max || s.id === flag.id) continue;
            if (!['at_sea', 'anchored', 'moving'].includes(s.status) || !near(s.q, s.r)) continue;
            if (Ships.crewSailReason(s)) continue;
            out.push(fromShip(s, out.length, false));
        }
        if (!(player.politics && player.politics.fleetService)) {
            for (const u of Ships.getSquadron(player)) {
                if (out.length > max) break;
                const lvl = 1 + (_num(u.level, 1) - 1) * 0.2;
                out.push({
                    id: `g${out.length}`, side: 'player', name: u.name || 'War Galley', typeId: 'war_galley', unitId: u.id,
                    guns: _num(u.strength, 20) * lvl * drill * (u.woundedDays > 0 ? 0.5 : 1), crew: 20, crew0: 20, drill: 1,
                    hull: u.woundedDays > 0 ? 60 : 100,
                });
            }
        }
        return out;
    },

    /** A pirate / hunter / merchant from the phased scene (systems/pirates.js state.enemy) as ships. */
    enemyFromPirates(e) {
        const kind = e.type === 'merchant' ? 'merchant' : e.type === 'hunters' ? 'navy' : 'pirate';
        const t = SeaFights._typeOf(e.shipType || (kind === 'navy' ? 'war_galley' : 'sloop'));
        const out = [];
        const str = Math.max(2, _num(e.strength, 10));
        const str0 = Math.max(str, _num(e.str0, str));
        const hull = _clamp(Math.round(100 * (0.4 + 0.6 * str / str0)), 30, 100);
        if (kind === 'merchant' && e.escort) {
            const own = Math.max(2, Math.round(str * 0.4));
            out.push({ id: 'e0', side: 'enemy', kind, name: e.name, typeId: t.id, guns: own, crew: t.crewRequired, hull });
            out.push({ id: 'e1', side: 'enemy', kind: 'navy', name: `${e.name}'s escort`, typeId: 'war_galley', guns: str - own, crew: 20, hull: 100 });
            return out;
        }
        out.push({
            id: 'e0', side: 'enemy', kind, name: e.shipName ? `the ${e.shipName}` : e.name, typeId: t.id, guns: str,
            crew: kind === 'pirate' ? Math.max(t.crewRequired, Math.round(str * 0.7)) : Math.max(t.crewRequired, Math.round(str * 0.5)),
            crew0: kind === 'pirate' ? Math.max(t.crewRequired, Math.round(str0 * 0.7)) : Math.max(t.crewRequired, Math.round(str0 * 0.5)),
            temperament: e.temperament || null, hull,
        });
        return out;
    },

    /** A royal squadron of `strength` as a line of warships (a blockade, a detachment). */
    enemyNavy(strength, name = 'the squadron') {
        const C = SeaFights.config();
        const n = _clamp(Math.round(strength / C.navy.perShip), 1, C.navy.maxShips);
        const out = [];
        for (let i = 0; i < n; i++) {
            const typeId = i === 0 && strength >= 60 ? 'galleon' : (i % 2 === 0 ? 'war_galley' : 'caravel');
            const t = SeaFights._typeOf(typeId);
            out.push({ id: `e${i}`, side: 'enemy', kind: 'navy', name: n > 1 ? `${name} (${i + 1} of ${n})` : name, typeId, guns: Math.max(3, strength / n), crew: t.crewRequired, hull: 100 });
        }
        return out;
    },

    /**
     * A new fight: your side's specs, the enemy's specs, and the sea.
     * opts: { night, weather, seed, context } — `seed` from the caller (a
     * Utils draw when absent: a player action). Your flagship sits at the
     * origin heading west; the enemy comes up from `start.distance` away.
     */
    create(playerSpecs, enemySpecs, opts = {}) {
        const C = SeaFights.config();
        const seed = (opts.seed != null ? opts.seed : Utils.randInt(1, 2147483646)) >>> 0;
        const f = { seed, n: 0, t: 0, acc: 0, ships: [], log: [], events: [], outcome: null, squadronOrder: 'follow', auto: false, context: opts.context || null };
        f.night = !!opts.night;
        // the flagship's master gunner lays your guns (playerSide: ShipOfficers 'gunnery')
        f.gunnery = _num(playerSpecs[0] && playerSpecs[0].gunnery);
        f.weather = opts.weather || 'clear';
        f.wind = { dir: SeaFights._r(f) * Math.PI * 2, strength: f.weather === 'storm' ? 1 : 0.6 };
        const bearing = Math.PI + (SeaFights._r(f) - 0.5) * Math.PI * 1.4; // they come up ahead, or on either beam
        playerSpecs.forEach((o, i) => {
            const side = i % 2 ? 1 : -1;
            const k = Math.ceil(i / 2);
            f.ships.push(SeaFights._spec({ ...o, x: i ? C.stationAstern * k : 0, y: i ? side * C.stationAbeam * k : 0, heading: Math.PI, order: i ? 'follow' : 'close' }));
        });
        enemySpecs.forEach((o, i) => {
            const d = C.start.distance + i * 1.5;
            const off = (i - (enemySpecs.length - 1) / 2) * C.start.spread / Math.max(1, enemySpecs.length);
            const bx = Math.cos(bearing) * d, by = Math.sin(bearing) * d;
            const s = SeaFights._spec({ ...o, x: bx - Math.sin(bearing) * off, y: by + Math.cos(bearing) * off, heading: bearing + Math.PI + (SeaFights._r(f) - 0.5) });
            f.ships.push(s);
        });
        for (const s of f.ships) s.speed = s.maxSpeed * 0.5;
        f.log.push(SeaFights._openingLine(f));
        return f;
    },

    _openingLine(f) {
        const enemies = SeaFights.ships(f, 'enemy');
        const lead = enemies[0];
        const more = enemies.length > 1 ? ` and ${enemies.length - 1} more` : '';
        return `⛵ ${lead ? lead.name : 'A sail'}${more} bearing down. The wind is ${f.wind.strength >= 1 ? 'a gale' : 'fair'}${f.night ? ', and it is dark' : ''}.`;
    },

    // ──────────── ORDERS ────────────

    /** The captain's orders to the flagship: close · rake · broadside · grapple · flee · hold. */
    orderFlagship(f, order, targetId = null) {
        const F = SeaFights.flagship(f);
        if (!F || !SeaFights.active(F) || f.outcome) return false;
        if (!['close', 'rake', 'broadside', 'grapple', 'flee', 'hold'].includes(order)) return false;
        F.order = order;
        if (targetId) F.target = targetId;
        f.auto = false;
        return true;
    },

    /** The squadron's orders: follow · engage · hold. */
    orderSquadron(f, order) {
        if (!['follow', 'engage', 'hold'].includes(order)) return false;
        f.squadronOrder = order;
        for (const s of SeaFights.ships(f, 'player')) if (!s.flagship) s.order = order;
        return true;
    },

    /** Shot for every gun on your side: round · chain · grape. */
    orderShot(f, shot) {
        if (!SeaFights.config().shot[shot]) return false;
        for (const s of SeaFights.ships(f, 'player')) s.shot = shot;
        return true;
    },

    /** The next enemy still fighting, after the flagship's current target. */
    cycleTarget(f) {
        const F = SeaFights.flagship(f);
        const live = SeaFights.ships(f, 'enemy').filter(SeaFights.active);
        if (!F || !live.length) return null;
        const i = live.findIndex(s => s.id === F.target);
        F.target = live[(i + 1) % live.length].id;
        return F.target;
    },

    /** Strike your colours: the fight is lost. */
    strike(f) {
        const F = SeaFights.flagship(f);
        if (!F || f.outcome) return false;
        F.struck = true;
        f.outcome = { kind: 'defeat', how: 'struck' };
        f.log.push('🏳️ You strike your colours.');
        return true;
    },

    // ──────────── SAILING ────────────

    /** Speed share on this heading for the wind (0..1). */
    sailFactor(f, s, heading = s.heading) {
        const C = SeaFights.config();
        const off = Math.abs(_angDiff(heading, f.wind.dir)) / DEG;
        const pts = C.pointOfSail;
        let v = pts[pts.length - 1][1];
        for (let i = 1; i < pts.length; i++) {
            if (off <= pts[i][0]) {
                const [a0, v0] = pts[i - 1];
                const [a1, v1] = pts[i];
                v = v0 + (v1 - v0) * ((off - a0) / Math.max(1e-6, a1 - a0));
                break;
            }
        }
        return s.oared ? 0.7 + 0.3 * v : v;
    },

    /** A heading a sailing ship can actually hold: no closer than noSailHeadTo off the wind's eye. */
    _tack(f, s, h) {
        if (s.oared) return h;
        const lim = SeaFights.config().noSailHeadTo * DEG;
        const d = _angDiff(h, f.wind.dir);
        if (Math.abs(d) <= lim) return h;
        return f.wind.dir + Math.sign(d || 1) * lim;
    },

    _dist(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y);
    },

    _bearing(a, b) {
        return Math.atan2(b.y - a.y, b.x - a.x);
    },

    /** Degrees off `s`'s bow at which `o` lies (0 ahead, 180 astern). */
    _offBow(s, o) {
        return Math.abs(_angDiff(SeaFights._bearing(s, o), s.heading)) / DEG;
    },

    _nearest(s, list) {
        let best = null;
        let bd = Infinity;
        for (const o of list) {
            const d = SeaFights._dist(s, o);
            if (d < bd) { bd = d; best = o; }
        }
        return best;
    },

    _foes(f, s) {
        return f.ships.filter(o => o.side !== s.side && SeaFights.active(o));
    },

    _targetOf(f, s) {
        const foes = SeaFights._foes(f, s);
        if (!foes.length) return null;
        const t = s.target ? foes.find(o => o.id === s.target) : null;
        if (t) return t;
        const flag = s.side === 'enemy' ? foes.find(o => o.flagship) : null;
        const pick = flag && SeaFights._dist(s, flag) < SeaFights._dist(s, SeaFights._nearest(s, foes)) * 1.8 ? flag : SeaFights._nearest(s, foes);
        s.target = pick ? pick.id : null;
        return pick;
    },

    /** Fighting power, for the enemy's choices: guns, crew and hull. */
    power(s) {
        return s.guns * s.drill * (0.4 + 0.6 * s.crew / s.crew0) * (0.3 + 0.7 * s.hull / 100);
    },

    /** The enemy (and the sailing master, and the squadron on 'engage'): what to do now. */
    _aiOrder(f, s) {
        const C = SeaFights.config();
        const t = SeaFights._targetOf(f, s);
        if (!t) return 'hold';
        const ratio = SeaFights.power(s) / Math.max(0.1, SeaFights.power(t));
        const crewEdge = s.crew / Math.max(1, t.crew);
        const kind = s.kind || (s.side === 'player' ? 'navy' : 'pirate');
        if (kind === 'merchant') return 'flee';
        // A ship running from you is chased down and boarded, not stood off from
        const running = t.kind === 'merchant' || t._aiPick === 'flee' || t.order === 'flee';
        if (running && ratio >= 0.6) return SeaFights._dist(s, t) > 3 ? 'close' : 'grapple';
        if (kind === 'pirate') {
            if (s.hull < 35 && s.temperament !== 'cruel' && ratio < 0.8) return 'flee';
            if ((crewEdge >= 1.5 && f.t > 15) || t.hull < 70 || t.rigging < 60) return 'grapple';
            return ratio >= 0.8 ? 'rake' : 'broadside';
        }
        // navy, hunters, the squadron, the sailing master
        if (s.hull < C.strike.navyHull + 8 && ratio < 0.7) return 'flee';
        if (t.hull < 45 || t.struck || (crewEdge >= 1.4 && ratio >= 1)) return 'grapple';
        return SeaFights._dist(s, t) > C.keepRange + 3 ? 'close' : (ratio >= 1.2 ? 'rake' : 'broadside');
    },

    /** Where `s` wants to head and how fast (share of its best) for its order. */
    _steer(f, s) {
        const C = SeaFights.config();
        const F = SeaFights.flagship(f);
        let order = s.order;
        if (s.side === 'player' && !s.flagship && order === 'engage') order = s._aiPick || 'broadside';
        if ((s.side === 'enemy' || (s.flagship && f.auto)) && s._aiPick) order = s._aiPick;
        if (s.side === 'player' && !s.flagship && order === 'follow' && F && SeaFights.active(F)) {
            const k = Math.ceil(_num(Number(String(s.id).replace(/\D/g, '')), 1) / 2) || 1;
            const side = (_num(Number(String(s.id).replace(/\D/g, '')), 1) % 2) ? 1 : -1;
            const back = { x: -Math.cos(F.heading), y: -Math.sin(F.heading) };
            const perp = { x: -back.y, y: back.x };
            const at = { x: F.x + back.x * C.stationAstern * k + perp.x * side * C.stationAbeam * k, y: F.y + back.y * C.stationAstern * k + perp.y * side * C.stationAbeam * k };
            const d = SeaFights._dist(s, at);
            const h = d > 0.6 ? SeaFights._bearing(s, at) : F.heading;
            // (out of station she crowds on sail to catch up)
            return { heading: h, want: d > 1.5 ? Math.min(1.25, 1 + d * 0.03) : Math.min(1, F.speed / Math.max(0.01, s.maxSpeed)) };
        }
        if (order === 'hold' || order === 'follow') {
            const foe = SeaFights._nearest(s, SeaFights._foes(f, s));
            if (!foe) return { heading: s.heading, want: 0.05 };
            const b = SeaFights._bearing(s, foe);
            const h1 = b + Math.PI / 2, h2 = b - Math.PI / 2;
            return { heading: Math.abs(_angDiff(h1, s.heading)) < Math.abs(_angDiff(h2, s.heading)) ? h1 : h2, want: 0.08 };
        }
        const t = SeaFights._targetOf(f, s);
        if (order === 'flee') {
            const foes = SeaFights._foes(f, s);
            let ax = 0, ay = 0;
            for (const o of foes) {
                const d = Math.max(0.5, SeaFights._dist(s, o));
                ax += (s.x - o.x) / (d * d);
                ay += (s.y - o.y) / (d * d);
            }
            const away = Math.atan2(ay, ax);
            let best = away;
            let bs = -Infinity;
            for (let i = 0; i < 12; i++) {
                const h = away + (i - 6) * 15 * DEG;
                const sc = Math.cos(_angDiff(h, away)) + SeaFights.sailFactor(f, s, h) * 0.9;
                if (sc > bs) { bs = sc; best = h; }
            }
            return { heading: best, want: 1 };
        }
        if (!t) return { heading: s.heading, want: 0.3 };
        const d = SeaFights._dist(s, t);
        if (order === 'close' || order === 'grapple') {
            const lead = Math.min(3, d / Math.max(0.3, s.maxSpeed));
            const at = { x: t.x + Math.cos(t.heading) * t.speed * lead, y: t.y + Math.sin(t.heading) * t.speed * lead };
            const want = order === 'grapple' && d < 3 ? Math.min(1, (t.speed + 0.2) / Math.max(0.01, s.maxSpeed)) : 1;
            return { heading: SeaFights._bearing(s, at), want };
        }
        if (order === 'rake') {
            const ahead = { x: t.x + Math.cos(t.heading) * 3.5, y: t.y + Math.sin(t.heading) * 3.5 };
            if (SeaFights._dist(s, ahead) > 2.5) return { heading: SeaFights._bearing(s, ahead), want: 1 };
            const h1 = t.heading + Math.PI / 2, h2 = t.heading - Math.PI / 2;
            return { heading: Math.abs(_angDiff(h1, s.heading)) < Math.abs(_angDiff(h2, s.heading)) ? h1 : h2, want: 0.7 };
        }
        // broadside: hold her abeam at the keeping range
        const b = SeaFights._bearing(s, t);
        const h1 = b + Math.PI / 2, h2 = b - Math.PI / 2;
        let h = Math.abs(_angDiff(h1, s.heading)) < Math.abs(_angDiff(h2, s.heading)) ? h1 : h2;
        const err = d - C.keepRange;
        if (Math.abs(err) > 1) h += Math.sign(_angDiff(b, h)) * Math.min(35, Math.abs(err) * 10) * DEG * Math.sign(err);
        return { heading: h, want: 0.85 };
    },

    _sail(f, s, dt) {
        const C = SeaFights.config();
        if (s.grappled) { s.speed = 0; return; }
        if (s.struck || s.sunk || s.taken) { s.speed *= 0.97; s.x += Math.cos(s.heading) * s.speed * dt; s.y += Math.sin(s.heading) * s.speed * dt; return; }
        const { heading, want } = SeaFights._steer(f, s);
        const h = SeaFights._tack(f, s, heading);
        const slow = 0.4 + 0.6 * Math.min(1, s.speed / Math.max(0.01, s.maxSpeed));
        const dh = _angDiff(h, s.heading);
        const turn = s.turn * slow * dt;
        s.heading += _clamp(dh, -turn, turn);
        const crew = 0.5 + 0.5 * Math.min(1, s.crew / s.crew0);
        const rig = 0.3 + 0.7 * s.rigging / 100;
        const gale = f.weather === 'storm' ? 0.85 : 1;
        const top = s.maxSpeed * SeaFights.sailFactor(f, s) * crew * rig * gale * (0.8 + 0.2 * f.wind.strength / 0.6);
        const target = top * _clamp(want, 0, 1.25);
        s.speed += (target - s.speed) * Math.min(1, C.accel * dt);
        s.x += Math.cos(s.heading) * s.speed * dt;
        s.y += Math.sin(s.heading) * s.speed * dt;
    },

    // ──────────── GUNS ────────────

    _fire(f, s, dt) {
        const C = SeaFights.config();
        if (!SeaFights.active(s) || s.grappled) return;
        s.reloadLeft -= dt;
        if (s.reloadLeft > 0) return;
        const shot = C.shot[s.shot] || C.shot.round;
        const [lo, hi] = C.arc;
        let best = null;
        let bd = Infinity;
        for (const o of SeaFights._foes(f, s)) {
            const d = SeaFights._dist(s, o);
            const off = SeaFights._offBow(s, o);
            if (d > shot.range || off < lo || off > hi) continue;
            const pref = o.id === s.target ? 0.6 : 1;
            if (d * pref < bd) { bd = d * pref; best = o; }
        }
        // Nothing on the beam: the chasers, fore and aft, at a foe dead ahead or astern
        let chase = false;
        if (!best) {
            for (const o of SeaFights._foes(f, s)) {
                const d = SeaFights._dist(s, o);
                const off = SeaFights._offBow(s, o);
                if (d > shot.range * C.chase.range || (off > C.chase.arc && off < 180 - C.chase.arc)) continue;
                if (d < bd) { bd = d; best = o; chase = true; }
            }
        }
        if (!best) { s.reloadLeft = 0.25; return; }
        const d = SeaFights._dist(s, best);
        const H = C.hit;
        let p = H.base - H.range * (d / shot.range);
        if (f.night) p -= H.night;
        if (f.weather === 'fog') p -= H.fog;
        if (f.weather === 'storm') p -= H.storm;
        if (s.side === 'player' && f.gunnery) p += f.gunnery * H.skill;
        const hitShare = _clamp(p + (SeaFights._r(f) - 0.5) * 0.4, 0, 1);
        // Across her bow or stern: a rake
        const theirOff = SeaFights._offBow(best, s);
        const rake = theirOff <= C.rakeArc || theirOff >= 180 - C.rakeArc;
        const crewF = 0.4 + 0.6 * Math.min(1, s.crew / s.crew0);
        const guns = s.guns * (0.5 + 0.5 * s.hull / 100) * (chase ? C.chase.share : 1);
        const power = guns * s.drill * crewF * hitShare * (rake ? C.rakeMult : 1) * C.damageScale;
        const T = C.toughness;
        const tough = T.base + T.armor * best.armor + T.guns * best.guns0;
        const hullDmg = power * shot.hull * (10 / (10 + best.armor)) / tough * 100;
        const rigDmg = power * shot.rig / tough * 120;
        const crewDmg = power * shot.crew / tough * best.crew0 * 0.9;
        best.hull = Math.max(0, best.hull - hullDmg);
        best.rigging = Math.max(0, best.rigging - rigDmg);
        best._crewF = _num(best._crewF) + crewDmg;
        const lost = Math.min(best.crew, Math.floor(best._crewF));
        best._crewF -= lost;
        best.crew -= lost;
        s.reloadLeft = C.reload * (chase ? 0.6 : 1) / (0.5 + 0.5 * Math.min(1, s.crew / s.crew0));
        const side = _angDiff(SeaFights._bearing(s, best), s.heading) > 0 ? 'starboard' : 'larboard';
        f.events.push({ type: chase ? 'chase' : 'broadside', from: s.id, to: best.id, side: chase ? 'bow' : side, hit: hitShare, rake, hull: hullDmg, rig: rigDmg, crew: lost, shot: s.shot });
        if (rake && (s.side === 'player' || best.flagship)) f.log.push(`💥 ${s.flagship ? 'You rake' : `${s.name} rakes`} ${best.flagship ? 'you' : best.name}${lost ? ` — ${lost} men down` : ''}.`);
        if (best.hull <= 0 && !best.flagship) {
            best.sunk = true;
            best.speed = 0;
            f.events.push({ type: 'sunk', id: best.id });
            f.log.push(`🌊 ${best.name} goes down.`);
        }
    },

    // ──────────── GRAPPLING, STRIKING, ESCAPE ────────────

    _grapple(f, s) {
        const C = SeaFights.config();
        if (!SeaFights.active(s) || s.grappled) return;
        const order = (s.side === 'enemy' || (s.flagship && f.auto) || (!s.flagship && s.order === 'engage')) ? (s._aiPick || s.order) : s.order;
        if (order !== 'grapple') return;
        const t = SeaFights._targetOf(f, s);
        if (!t || t.grappled) return;
        if (SeaFights._dist(s, t) > C.grapple.range) return;
        if (Math.abs(s.speed - t.speed) > C.grapple.speedDiff && !t.struck) return;
        s._grT = _num(s._grT) - C.grapple.every;
        if (s._grT > 0) return;
        s._grT = C.grapple.every * 3;
        if (SeaFights._r(f) >= C.grapple.chance * (0.5 + 0.5 * Math.min(1, s.crew / s.crew0))) return;
        s.grappled = t.id;
        t.grappled = s.id;
        f.events.push({ type: 'grapple', a: s.id, b: t.id });
        f.log.push(`⚓ Grapnels fly: ${s.flagship ? 'you lash on to' : s.name} ${t.flagship ? 'you' : t.name}.`);
        if (s.flagship || t.flagship) {
            const foe = s.flagship ? t : s;
            f.outcome = { kind: 'boarding', enemyId: foe.id, by: s.flagship ? 'player' : 'enemy' };
            return;
        }
        // Two other ships lashed together: the crews decide it
        const won = SeaFights._rollBoarding(f, s, t);
        const loser = won ? t : s;
        const winner = won ? s : t;
        s.grappled = null; t.grappled = null;
        if (loser.side === 'enemy') { loser.struck = true; f.log.push(`🏳️ ${loser.name} is carried by ${winner.name}'s boarders.`); }
        else { loser.taken = true; f.log.push(`🏴 ${loser.name} is carried by ${winner.name}'s boarders.`); }
        winner.crew = Math.max(1, winner.crew - Math.ceil(loser.crew * 0.3));
    },

    /** Hand to hand by the crews (no one watching): true when `a` carries `b`. */
    _rollBoarding(f, a, b) {
        const pa = Math.max(0.1, (a.crew + a.guns * 0.5) * a.drill * (0.6 + 0.4 * a.hull / 100)) ** 2;
        const pb = Math.max(0.1, (b.crew + b.guns * 0.5) * b.drill * (0.6 + 0.4 * b.hull / 100) * (b.struck ? 0.3 : 1)) ** 2;
        return SeaFights._r(f) < _clamp(pa / (pa + pb), 0.05, 0.95);
    },

    _strikeCheck(f, s) {
        const C = SeaFights.config().strike;
        if (!SeaFights.active(s)) return;
        const crewShare = s.crew / s.crew0;
        if (s.flagship) {
            if (s.hull <= C.flagHull || s.crew <= 0) {
                s.struck = true;
                f.log.push('🏳️ Shot to pieces, your colours come down.');
                f.outcome = { kind: 'defeat', how: 'beaten' };
            }
            return;
        }
        if (s.side === 'player') {
            if (s.hull <= C.flagHull || s.crew <= 0) { s.taken = true; f.log.push(`🏴 ${s.name} strikes and is lost to you.`); }
            return;
        }
        let beaten;
        if (s.kind === 'merchant') {
            const ran = SeaFights._foes(f, s).some(o => SeaFights._dist(s, o) < 3 && SeaFights.power(o) > SeaFights.power(s) * 1.5);
            beaten = s.hull < C.merchantHull || crewShare < C.merchantCrew || ran;
        }
        else if (s.kind === 'navy') beaten = s.hull < C.navyHull || crewShare < C.crew * 0.8;
        else if (s.temperament === 'cruel') beaten = s.hull < C.cruelHull || crewShare < C.cruelCrew;
        else beaten = s.hull < C.hull || crewShare < C.crew;
        if (s.crew <= 0) beaten = true;
        if (!beaten) return;
        // A merchant only strikes to guns close by; anyone strikes when there is no running
        const near = SeaFights._foes(f, s).some(o => SeaFights._dist(s, o) < 6);
        if (s.kind === 'merchant' && !near) return;
        if (SeaFights._r(f) < C.chance || s.crew <= 0) {
            s.struck = true;
            f.events.push({ type: 'struck', id: s.id });
            f.log.push(`🏳️ ${s.name} strikes her colours.`);
        }
    },

    _escapeCheck(f) {
        const C = SeaFights.config();
        const F = SeaFights.flagship(f);
        for (const s of f.ships) {
            if (!SeaFights.active(s) || s.grappled) continue;
            const foes = SeaFights._foes(f, s);
            if (!foes.length) continue;
            const far = foes.every(o => SeaFights._dist(s, o) > C.escapeRange);
            if (!far) continue;
            if (s === F) {
                f.outcome = { kind: 'escaped' };
                f.log.push('💨 You draw away and lose them over the horizon.');
                return;
            }
            if (s.side === 'enemy' && (s._aiPick === 'flee' || s.kind === 'merchant')) {
                s.fled = true;
                f.log.push(`💨 ${s.name} gets clean away.`);
            }
        }
    },

    _checkEnd(f) {
        if (f.outcome) return;
        const F = SeaFights.flagship(f);
        if (!F || !SeaFights.active(F)) { f.outcome = f.outcome || { kind: 'defeat', how: 'beaten' }; return; }
        const enemies = SeaFights.ships(f, 'enemy');
        if (enemies.every(s => !SeaFights.active(s))) {
            const beaten = enemies.some(s => s.struck || s.sunk);
            f.outcome = { kind: beaten ? 'victory' : 'enemy_fled' };
            return;
        }
        if (f.t >= SeaFights.config().maxTime) {
            f.outcome = { kind: 'escaped', how: 'drawn' };
            f.log.push('🌅 Both sides draw off, battered, as the light goes.');
        }
    },

    /** One fixed step of the fight. */
    _tick(f, dt) {
        const C = SeaFights.config();
        f.t += dt;
        // The wind backs and veers
        f._windT = _num(f._windT) + dt;
        if (f._windT >= 20) { f._windT = 0; f.wind.dir += (SeaFights._r(f) - 0.5) * 0.35; }
        for (const s of f.ships) {
            if (!SeaFights.active(s)) continue;
            s._ai = _num(s._ai) - dt;
            const thinks = s.side === 'enemy' || (s.flagship && f.auto) || (!s.flagship && s.side === 'player' && s.order === 'engage');
            if (thinks && s._ai <= 0) {
                s._ai = C.aiEvery;
                s._aiPick = SeaFights._aiOrder(f, s);
                if (s.side === 'enemy') s.shot = s._aiPick === 'grapple' && SeaFights._targetOf(f, s) && SeaFights._dist(s, SeaFights._targetOf(f, s)) < 4 ? 'grape' : (s.kind === 'merchant' ? 'chain' : 'round');
            }
        }
        for (const s of f.ships) SeaFights._sail(f, s, dt);
        // Ships don't sail through each other
        for (let i = 0; i < f.ships.length; i++) {
            for (let j = i + 1; j < f.ships.length; j++) {
                const a = f.ships[i], b = f.ships[j];
                if (a.grappled === b.id) continue;
                const d = SeaFights._dist(a, b);
                if (d < 1.1 && d > 1e-6) {
                    const push = (1.1 - d) / 2;
                    const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
                    a.x -= ux * push; a.y -= uy * push;
                    b.x += ux * push; b.y += uy * push;
                }
            }
        }
        for (const s of f.ships) SeaFights._fire(f, s, dt);
        for (const s of f.ships) { SeaFights._grapple(f, s); if (f.outcome) return; }
        f._strikeT = _num(f._strikeT) + dt;
        if (f._strikeT >= C.strike.checkEvery) {
            f._strikeT = 0;
            for (const s of f.ships) SeaFights._strikeCheck(f, s);
        }
        if (f.outcome) return;
        SeaFights._escapeCheck(f);
        SeaFights._checkEnd(f);
    },

    /** Advance the fight by `seconds` (in fixed steps). Returns the outcome once there is one. */
    advance(f, seconds) {
        if (!f || f.outcome) return f ? f.outcome : null;
        const C = SeaFights.config();
        f.acc = _num(f.acc) + Math.max(0, Math.min(1, _num(seconds)));
        while (f.acc >= C.step && !f.outcome) {
            f.acc -= C.step;
            SeaFights._tick(f, C.step);
        }
        if (f.log.length > 40) f.log.splice(0, f.log.length - 40);
        return f.outcome;
    },

    /**
     * Sail it out without the captain: the sailing master's orders, a
     * boarding rolled by the crews. Returns the outcome.
     */
    autoResolve(f) {
        if (!f) return null;
        const C = SeaFights.config();
        f.auto = true;
        if (f.squadronOrder === 'follow') SeaFights.orderSquadron(f, 'engage');
        let guard = Math.ceil(C.maxTime / C.step) + 10;
        while (!f.outcome && guard-- > 0) SeaFights._tick(f, C.step);
        if (!f.outcome) f.outcome = { kind: 'escaped', how: 'drawn' };
        if (f.outcome.kind === 'boarding') SeaFights.finishBoarding(f, null);
        return f.outcome;
    },

    /** Crew strength of an enemy for the hand-to-hand fight on deck (DeckLife.boardingParty reads `enemy`). */
    boardingStrength(f, enemyId) {
        const e = SeaFights.ship(f, enemyId);
        if (!e) return 10;
        return Math.max(6, Math.round(e.crew * 0.8 + e.guns * 0.15));
    },

    /**
     * The boarding decided: `won` true/false from the deck, or null to roll
     * it by the crews. Sets the outcome to victory or defeat.
     */
    finishBoarding(f, won = null) {
        const o = f && f.outcome;
        if (!o || o.kind !== 'boarding') return o;
        const F = SeaFights.flagship(f);
        const e = SeaFights.ship(f, o.enemyId);
        if (won === null || won === undefined) won = F && e ? SeaFights._rollBoarding(f, F, e) : false;
        if (F) F.grappled = null;
        if (e) e.grappled = null;
        if (won) {
            if (e) { e.struck = true; e.crew = Math.max(0, Math.floor(e.crew * 0.5)); }
            if (F) F.crew = Math.max(1, F.crew - Math.ceil((e ? e.crewStart : 4) * 0.12));
            f.log.push(`⚔️ Your boarders carry ${e ? e.name : 'her'}.`);
            f.outcome = { kind: 'victory', boarded: true, enemyId: o.enemyId };
        } else {
            if (F) { F.struck = true; F.crew = Math.max(0, Math.floor(F.crew * 0.6)); }
            f.log.push('🏴 They carry your deck.');
            f.outcome = { kind: 'defeat', how: 'boarded', enemyId: o.enemyId };
        }
        return f.outcome;
    },

    // ──────────── AFTERWARDS ────────────

    /**
     * Write the fight back to your ships and galleys: hulls, crews, ships
     * lost. Once per fight. → { lines, lost: [names] }
     */
    applyToFleet(player, world, f) {
        if (!f || f.applied) return { lines: [], lost: [] };
        f.applied = true;
        const lines = [];
        const lost = [];
        for (const s of SeaFights.ships(f, 'player')) {
            if (s.shipId != null) {
                const ship = Ships.getShipById(player, s.shipId);
                if (!ship) continue;
                if ((s.sunk || s.taken) && !s.flagship) {
                    Ships.wreckShip(player, ship.id);
                    lost.push(ship.name);
                    lines.push(`${s.sunk ? '🌊' : '🏴'} The ${ship.name} is ${s.sunk ? 'sunk' : 'taken'}.`);
                    continue;
                }
                // the surgeon saves some of the fallen; the officers remember the day (systems/shipOfficers.js)
                const fallen = Math.max(0, Math.round(s.crewStart - s.crew));
                if (fallen > 0) s.crew += Math.min(fallen, _num(ShipOfficers.tendWounded(ship, fallen)));
                if (f.outcome) ShipOfficers.noteBattle(ship, ['victory', 'enemy_fled'].includes(f.outcome.kind));
                const before = _num(ship.condition, 100);
                const after = Math.round(s.hull - (100 - s.rigging) * 0.08);
                ship.condition = _clamp(Math.min(before, after), 5, 100);
                if (Number.isFinite(ship.crew) || s.crew < s.crewStart) ship.crew = Math.max(0, Math.round(s.crew));
                const dCrew = s.crewStart - s.crew;
                if (before - ship.condition > 0 || dCrew > 0) lines.push(`🔧 ${ship.name}: hull ${ship.condition}%${dCrew > 0 ? `, ${dCrew} sailor${dCrew === 1 ? '' : 's'} lost` : ''}.`);
            } else if (s.unitId != null) {
                const army = player.army || [];
                const i = army.findIndex(u => u.id === s.unitId);
                if (i < 0) continue;
                if (s.sunk || s.taken) {
                    lost.push(army[i].name || 'a war galley');
                    lines.push(`🌊 ${army[i].name || 'A war galley'} is lost.`);
                    army.splice(i, 1);
                } else if (s.hull < 60 || s.crew < s.crewStart * 0.7) {
                    army[i].woundedDays = Math.max(_num(army[i].woundedDays), 5);
                }
            }
        }
        return { lines, lost };
    },

    /** Your losses and theirs, in a line. */
    summary(f) {
        const enemies = SeaFights.ships(f, 'enemy');
        const parts = [];
        const struck = enemies.filter(s => s.struck).length;
        const sunk = enemies.filter(s => s.sunk).length;
        const fled = enemies.filter(s => s.fled).length;
        if (struck) parts.push(`${struck} struck`);
        if (sunk) parts.push(`${sunk} sunk`);
        if (fled) parts.push(`${fled} got away`);
        return parts.join(', ');
    },

    /**
     * The end of a sea fight begun from the pirates' phased scene: into
     * that scene's own outcomes (systems/pirates.js) — the aftermath of a
     * victory (ransom, hang, prize...), a defeat, an escape. The fleet's
     * damage is applied first. → { state } to go on with the scene, or
     * { done, notification, log }.
     */
    settlePirates(player, world, state, f) {
        const fleet = SeaFights.applyToFleet(player, world, f);
        const ship = Ships.getShipById(player, state.shipId != null ? state.shipId : player.boardedShip);
        const o = f.outcome || { kind: 'escaped' };
        const e = state.enemy || {};
        const cap = e.captainId ? Pirates.captain(player, e.captainId) : null;
        const main = SeaFights.ship(f, 'e0');
        const log = [...(state.log || []), ...f.log.slice(-4), ...fleet.lines];
        if (!ship) return { done: true, notification: { title: '🌊 Lost at Sea', body: 'Your ship is gone from under you.', type: 'error' }, log };
        const left = main ? Math.max(1, Math.round(SeaFights.power(main))) : e.strength;
        const next = { ...state, enemy: { ...e, strength: left }, unready: false, log };
        if (o.kind === 'victory') {
            const lead = main && main.sunk ? `🌊 ${main.name} went down; you fish her survivors and her strongbox out of the water.` : (o.boarded ? `⚔️ Your boarders carried ${main ? main.name : 'her'}.` : `🏳️ ${main ? main.name : 'She'} struck to your guns.`);
            next.log = [...log, lead];
            Quests.track(player, 'sea_fights_won');
            return Pirates._victory(player, world, next, ship);
        }
        if (o.kind === 'defeat') {
            const lead = o.how === 'boarded' ? 'Their boarders carried your deck.' : (o.how === 'struck' ? 'You struck your colours.' : 'Shot to pieces, you struck.');
            const out = Pirates._defeat(player, world, next, ship, lead);
            return { ...out, log };
        }
        if (o.kind === 'enemy_fled') {
            if (cap) { cap.escaped++; Pirates._remember(cap, world, 'ran from your guns'); }
            return { done: true, log, notification: { title: '💨 They Ran', body: `${e.name} crowded on sail and got away from your guns.`, type: 'warning' } };
        }
        // escaped (you drew off, or both sides did)
        if (cap) { cap.escaped++; Pirates._remember(cap, world, 'saw you draw off'); }
        if (e.type === 'hunters') Pirates.state(player).lastHunterDay = (world.day || 0) - 2;
        return { done: true, log, notification: { title: o.how === 'drawn' ? '🌅 Drawn Off' : '💨 Away Clear', body: o.how === 'drawn' ? `You and ${e.name} drew off, both the worse for it.` : `You got clear of ${e.name}.`, type: 'info' } };
    },
};
