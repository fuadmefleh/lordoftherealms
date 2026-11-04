// InnerMap — living animals (deer to begin with; data/animals.json).
// A wild hex with the right ground keeps a herd or two — a stag, his does and,
// in spring and summer, their fawns — on InnerMap.animals, a list of their own
// (not InnerMap.npcs: an animal is never talked to, robbed, jailed or counted
// as a townsman). Where the herds graze is a hash of the world seed and the hex,
// so a hex holds the same herd on every visit and no RNG stream is drawn at
// placement; how they wander and run is drawn from the map's own seeded stream
// (never Utils.random's shared one, so the world's other draws are untouched).
// They graze, amble about a home range, and bolt from the player who comes too
// near — the rest of the herd with them — then stop and stare and settle again.
// A deer killed (ui/innerMapAnimals.js → hunting) is gone from its hex's herd
// until world.wildlife says the herd has grown back (data: respawnDays).
import { InnerMap } from './_ref.js';
import { Utils, DataLoader } from './_imports.js';

/** A well-mixed 32-bit hash of the parts (as encounters.js). */
function _hash(...parts) {
    let h = Utils.hashStr(parts.join('|'));
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}
const _u = (h) => h / 4294967296;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _pair = (p, d) => (Array.isArray(p) ? p : [d, d]);

/** A small seeded stream (mulberry32) for the animals' own movement. */
function _stream(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const STEPS = [[0, -1, 'up'], [-1, 0, 'left'], [0, 1, 'down'], [1, 0, 'right']];

/** The facing for a step (dq, dr). */
function _facing(dq, dr, fallback = 'down') {
    if (!dq && !dr) return fallback;
    if (Math.abs(dq) >= Math.abs(dr)) return dq > 0 ? 'right' : 'left';
    return dr > 0 ? 'down' : 'up';
}

/** Built ground: a house, a street, a lot, the town's heart. */
function _isBuilt(t) {
    return !!(t && (t.building || t.customBuilding || t.customBuildingPart || t.isRoad || t._doorMarker
        || t.playerPropertyBuilding || t._townCore || t._lot));
}

let _seq = 0;

Object.assign(InnerMap, {
    /** The animals on the current map. */
    animals: [],

    _animalRng: null,
    _animalBuiltDist: null,

    /** data/animals.json */
    animalConfig() {
        return (DataLoader.get && DataLoader.get('animals')) || {};
    },

    animalSpecies(id, cfg = this.animalConfig()) {
        return (cfg.species && cfg.species[id]) || null;
    },

    /**
     * Chebyshev distance from each tile to the nearest built tile (a flat
     * array, r * W + q), or null when nothing is built on the map.
     */
    _builtDistance(tiles) {
        const H = tiles.length, W = H ? tiles[0].length : 0;
        const dist = new Uint16Array(W * H).fill(65535);
        const queue = [];
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (_isBuilt(tiles[r][q])) { dist[r * W + q] = 0; queue.push(r * W + q); }
            }
        }
        if (!queue.length) return null;
        for (let i = 0; i < queue.length; i++) {
            const at = queue[i], q = at % W, r = (at - q) / W, d = dist[at] + 1;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dq = -1; dq <= 1; dq++) {
                    const nq = q + dq, nr = r + dr;
                    if (nq < 0 || nr < 0 || nq >= W || nr >= H) continue;
                    const ni = nr * W + nq;
                    if (dist[ni] > d) { dist[ni] = d; queue.push(ni); }
                }
            }
        }
        return dist;
    },

    /** Open ground an animal can stand on: no water, wall, house, tree or street-front. */
    _animalGround(t) {
        return !!(t && t.subTerrain && t.subTerrain.passable && !t.building && !t.customBuilding && !t.customBuildingPart
            && !t.customObjectPart && !t._doorMarker && !t.playerPropertyBuilding && !t._isInterior);
    },

    /**
     * The herds of a hex: [{ id, species, herd, q, r, homeQ, homeR }]. Pure:
     * reads only the tiles and the seed.
     *   o.settlementType  the hex's settlement, if any (fewer herds; city and capital none)
     *   o.nearTown        a settlement next door (fewer herds)
     *   o.season          'Spring' … (fawns in spring and summer)
     *   o.culled          ids killed and not yet grown back
     *   o.people          [{ q, r }] folk on the map (a camp, a roadhouse): herds keep off
     *   o.builtDist       _builtDistance(tiles) (worked out when not given)
     */
    planHerds(tiles, terrainId, worldQ, worldR, seed, o = {}) {
        const cfg = o.cfg || this.animalConfig();
        const spot = cfg.terrain && cfg.terrain[terrainId];
        const H = tiles.length, W = H ? tiles[0].length : 0;
        if (!spot || !W) return [];
        const herdDef = cfg.herds && cfg.herds[spot.herd];
        if (!herdDef) return [];
        let chance = _num(spot.chance, 0);
        if (o.settlementType) chance *= _num((cfg.settlementFactor || {})[o.settlementType], 0);
        else if (o.nearTown) chance *= _num(cfg.nearTownFactor, 1);
        const s = String(seed == null ? 'world' : seed);
        if (chance <= 0 || _u(_hash(s, 'herds', worldQ, worldR)) >= chance) return [];
        const [hLo, hHi] = _pair(spot.herds, 1);
        const herds = hLo + (_hash(s, 'herdsN', worldQ, worldR) % Math.max(1, hHi - hLo + 1));
        const pl = { margin: 10, minFromCentre: 16, minApart: 22, builtMargin: 16, peopleMargin: 12, ...(cfg.placement || {}) };
        const builtDist = o.builtDist !== undefined ? o.builtDist : this._builtDistance(tiles);
        const culled = new Set(o.culled || []);
        const people = o.people || [];
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        const m = Math.min(pl.margin, Math.floor(W / 4));
        const span = (n) => Math.max(1, n - 2 * m);
        const ground = (q, r) => q >= 1 && r >= 1 && q < W - 1 && r < H - 1 && tiles[r] && this._animalGround(tiles[r][q])
            && !(builtDist && builtDist[r * W + q] < pl.builtMargin);
        const out = [];
        const homes = [];
        for (let h = 0; h < herds; h++) {
            // Where: the first open spot the hash lands on
            let home = null;
            for (let attempt = 0; attempt < 60 && !home; attempt++) {
                const q = m + (_hash(s, 'hq', worldQ, worldR, h, attempt) % span(W));
                const r = m + (_hash(s, 'hr', worldQ, worldR, h, attempt) % span(H));
                if (!ground(q, r)) continue;
                if (Math.max(Math.abs(q - cq), Math.abs(r - cr)) < pl.minFromCentre) continue;
                if (homes.some(p => Math.max(Math.abs(p.q - q), Math.abs(p.r - r)) < pl.minApart)) continue;
                if (people.some(p => Math.max(Math.abs(p.q - q), Math.abs(p.r - r)) < pl.peopleMargin)) continue;
                home = { q, r };
            }
            if (!home) continue;
            homes.push(home);
            // Who: a stag, his does, the year's fawns
            const members = [];
            for (const sp of Object.keys(herdDef)) {
                const def = herdDef[sp];
                if (!def || typeof def !== 'object' || !cfg.species || !cfg.species[sp]) continue;
                if (Array.isArray(def.seasons) && o.season && !def.seasons.includes(o.season)) continue;
                if (_u(_hash(s, 'hm', worldQ, worldR, h, sp)) >= _num(def.chance, 1)) continue;
                const [lo, hi] = _pair(def.count, 1);
                const n = lo + (_hash(s, 'hn', worldQ, worldR, h, sp) % Math.max(1, hi - lo + 1));
                for (let k = 0; k < n; k++) members.push({ sp, id: `${worldQ},${worldR}:${h}:${sp}${k}` });
            }
            // Each on open ground about the herd's home, none on another
            const spread = Math.max(1, _num(herdDef.spread, 3));
            const taken = new Set();
            members.forEach((mb, i) => {
                if (culled.has(mb.id)) return;
                for (let attempt = 0; attempt < 30; attempt++) {
                    const hq = _hash(s, 'mq', mb.id, attempt), hr = _hash(s, 'mr', mb.id, attempt);
                    const q = home.q + (i === 0 && attempt === 0 ? 0 : (hq % (2 * spread + 1)) - spread);
                    const r = home.r + (i === 0 && attempt === 0 ? 0 : (hr % (2 * spread + 1)) - spread);
                    const key = `${q},${r}`;
                    if (taken.has(key) || !ground(q, r)) continue;
                    taken.add(key);
                    out.push({ id: mb.id, species: mb.sp, herd: `${worldQ},${worldR}:${h}`, q, r, homeQ: home.q, homeR: home.r });
                    break;
                }
            });
        }
        return out;
    },

    /** The ids of a hex's animals killed and not yet grown back (world.wildlife). */
    culledAnimals(world, worldQ, worldR, cfg = this.animalConfig()) {
        const rec = world && world.wildlife && world.wildlife.culled && world.wildlife.culled[`${worldQ},${worldR}`];
        if (!Array.isArray(rec)) return [];
        const day = _num(world.day, 0), back = _num(cfg.respawnDays, 45);
        return rec.filter(c => c && day - _num(c.day, 0) < back).map(c => c.id);
    },

    /** A living animal from a plan entry. */
    _makeAnimal(p, cfg) {
        const sp = this.animalSpecies(p.species, cfg) || {};
        return {
            id: p.id, species: p.species, kind: sp.kind || p.species, herd: p.herd || null,
            q: p.q, r: p.r, homeQ: p.homeQ != null ? p.homeQ : p.q, homeR: p.homeR != null ? p.homeR : p.r,
            next: null, progress: 0, facing: 'down', state: 'graze', timer: 0, steps: 0, target: null,
            fleeT: 0, threat: null, animT: 0, hunted: false,
        };
    },

    /**
     * Put the hex's herds on the map just entered (enter() calls this, after
     * the townsfolk and any camp, so the herds keep off them). None at sea.
     */
    _spawnAnimals(game, worldTile, worldQ, worldR) {
        this.animals = [];
        this._animalBuiltDist = null;
        if (!worldTile || !Array.isArray(this.tiles) || !this.tiles.length) return;
        const cfg = this.animalConfig();
        const world = game && game.world;
        const terrainId = worldTile.terrain ? worldTile.terrain.id : null;
        const seed = world && world.generationParams ? world.generationParams.seed : null;
        // A settlement next door thins the herds (the square about the hex: near enough on an offset grid)
        let nearTown = false;
        if (!worldTile.settlement && world && typeof world.getTile === 'function') {
            for (let dr = -1; dr <= 1 && !nearTown; dr++) {
                for (let dq = -1; dq <= 1 && !nearTown; dq++) {
                    if (!dq && !dr) continue;
                    const n = world.getTile(worldQ + dq, worldR + dr);
                    if (n && n.settlement) nearTown = true;
                }
            }
        }
        const builtDist = this._builtDistance(this.tiles);
        this._animalBuiltDist = worldTile.settlement ? builtDist : null;
        const plan = this.planHerds(this.tiles, terrainId, worldQ, worldR, seed, {
            cfg, builtDist,
            settlementType: worldTile.settlement ? (worldTile.settlement.type || 'village') : null,
            nearTown,
            season: (world && world.season) || this.season || null,
            culled: this.culledAnimals(world, worldQ, worldR, cfg),
            people: (this.npcs || []).map(n => ({ q: n.q, r: n.r })),
        });
        this.animals = plan.map(p => this._makeAnimal(p, cfg));
        this._animalRng = _stream(_hash(String(seed == null ? 'world' : seed), 'animalMoves', worldQ, worldR, world ? world.day || 0 : 0));
        // Each starts at a different point of its grazing
        const g = _pair((cfg.behaviour || {}).grazeSeconds, 5);
        for (const a of this.animals) {
            a.timer = g[0] + this._animalRng() * (g[1] - g[0]);
            a.facing = STEPS[Math.floor(this._animalRng() * 4)][2];
        }
    },

    /** Can an animal step from (q, r) onto (nq, nr)? */
    _animalCanStep(q, r, nq, nr) {
        if (nq < 1 || nr < 1 || nq >= this.width - 1 || nr >= this.height - 1) return false;
        const t = this.tiles[nr] && this.tiles[nr][nq];
        if (!this._animalGround(t)) return false;
        // In a settlement's hex they keep clear of its streets and houses
        const bd = this._animalBuiltDist;
        if (bd && bd[nr * this.width + nq] < 5 && bd[nr * this.width + nq] <= bd[r * this.width + q]) return false;
        if (this._stepBlocked && this._stepBlocked(q, r, nq, nr)) return false;
        // Not onto another animal's tile (or where it is stepping)
        for (const o of this.animals) {
            if ((o.q === nq && o.r === nr) || (o.next && o.next.q === nq && o.next.r === nr)) return false;
        }
        return true;
    },

    /** The animal's position in tiles, between its tile and the one it is stepping to. */
    animalPos(a) {
        if (a.drawQ != null) return { q: a.drawQ, r: a.drawR };
        if (!a.next) return { q: a.q, r: a.r };
        return { q: a.q + (a.next.q - a.q) * a.progress, r: a.r + (a.next.r - a.r) * a.progress };
    },

    /** How near the player may come before an animal bolts. */
    animalNoticeRadius(a, o = {}, cfg = this.animalConfig()) {
        const b = cfg.behaviour || {};
        const sp = this.animalSpecies(a.species, cfg) || {};
        const base = Math.max(_num(b.noticeMin, 3), _num(b.noticeRadius, 7) - _num(o.stealth, 1) * _num(b.noticePerStealth, 0.3));
        return base * _num(sp.wary, 1) * (o.walking === false ? _num(b.noticeStill, 0.55) : 1);
    },

    /** Send an animal (and the rest of its herd near it) running from `from`. */
    alarmAnimal(a, from, cfg = this.animalConfig()) {
        if (!a || a.hunted) return;
        const b = cfg.behaviour || {};
        const start = (x) => {
            if (x.hunted) return;
            x.state = 'flee';
            x.threat = { q: from.q, r: from.r };
            x.fleeT = 0;
            x.steps = 0;
        };
        start(a);
        for (const o of this.animals) {
            if (o === a || o.state === 'flee' || !a.herd || o.herd !== a.herd) continue;
            if (Math.max(Math.abs(o.q - a.q), Math.abs(o.r - a.r)) <= _num(b.herdAlarm, 8)) start(o);
        }
    },

    /** The step that takes `a` furthest from its threat, or null when cornered. */
    _fleeStep(a) {
        const t = a.threat;
        const here = Math.hypot(a.q - t.q, a.r - t.r);
        let best = null, bestScore = -Infinity;
        for (const [dq, dr, dir] of STEPS) {
            const nq = a.q + dq, nr = a.r + dr;
            if (!this._animalCanStep(a.q, a.r, nq, nr)) continue;
            const d = Math.hypot(nq - t.q, nr - t.r);
            if (d < here - 0.35) continue;
            // keep running the way it was going, and a little at random so a herd fans out
            const score = d + (dir === a.facing ? 0.4 : 0) + this._animalRng() * 0.3;
            if (score > bestScore) { bestScore = score; best = { q: nq, r: nr, dir }; }
        }
        return best;
    },

    /** A step toward `a.target`, or null when none brings it nearer. */
    _walkStep(a) {
        const t = a.target;
        if (!t) return null;
        const here = Math.abs(a.q - t.q) + Math.abs(a.r - t.r);
        let best = null, bestD = here;
        for (const [dq, dr, dir] of STEPS) {
            const nq = a.q + dq, nr = a.r + dr;
            const d = Math.abs(nq - t.q) + Math.abs(nr - t.r);
            if (d >= bestD || !this._animalCanStep(a.q, a.r, nq, nr)) continue;
            bestD = d; best = { q: nq, r: nr, dir };
        }
        return best;
    },

    /**
     * One frame of the animals' lives.
     *   o.walking   the player is on the move (a still hunter is noticed nearer)
     *   o.stealth   the player's stealth (shrinks the ring they notice you in)
     *   o.player    { q, r } (default: the player's tile)
     */
    updateAnimals(dt, o = {}) {
        if (!this.active || this._insideBuilding || !this.animals || !this.animals.length) return;
        const cfg = this.animalConfig();
        const b = cfg.behaviour || {};
        const rng = this._animalRng || (this._animalRng = _stream(1));
        const me = o.player || { q: this.playerInnerQ, r: this.playerInnerR };
        for (const a of this.animals) {
            if (a.hunted) continue; // a hunt moves it (ui/mapTasks/wildTasks.js)
            const sp = this.animalSpecies(a.species, cfg) || {};
            const running = a.state === 'flee';
            a.animT += dt * (a.next ? 1 : 0);
            // Mid-step: carry on to the next tile
            if (a.next) {
                a.progress += dt * _num(running ? sp.fleeSpeed : sp.walkSpeed, running ? 5 : 1);
                if (a.progress < 1) continue;
                a.q = a.next.q; a.r = a.next.r;
                a.next = null; a.progress = 0;
            }
            const d = Math.hypot(a.q - me.q, a.r - me.r);
            // Noticed: it bolts, and its herd with it
            if (a.state !== 'flee' && d <= this.animalNoticeRadius(a, o, cfg)) {
                this.alarmAnimal(a, me, cfg);
            }
            switch (a.state) {
                case 'flee': {
                    a.threat = { q: me.q, r: me.r };
                    a.fleeT += dt;
                    const ran = a.fleeT >= _num(b.fleeSecondsMax, 7);
                    if (d >= _num(b.calmDistance, 15) || ran) {
                        this._animalStopAndStare(a, me, cfg);
                        break;
                    }
                    const step = this._fleeStep(a);
                    if (!step) { this._animalStopAndStare(a, me, cfg); break; }
                    a.next = { q: step.q, r: step.r };
                    a.facing = step.dir;
                    a.steps++;
                    break;
                }
                case 'alert':
                    a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
                    a.timer -= dt;
                    if (a.timer <= 0) this._animalGraze(a, cfg);
                    break;
                case 'walk': {
                    const step = a.steps > 0 ? this._walkStep(a) : null;
                    if (!step) { this._animalGraze(a, cfg); break; }
                    a.next = { q: step.q, r: step.r };
                    a.facing = step.dir;
                    a.steps--;
                    break;
                }
                default: { // graze
                    a.timer -= dt;
                    if (a.timer > 0) {
                        // now and then it turns its head to another quarter
                        if (rng() < dt * 0.08) a.facing = STEPS[Math.floor(rng() * 4)][2];
                        break;
                    }
                    const range = _num(b.homeRange, 9);
                    a.target = {
                        q: Math.round(a.homeQ + (rng() * 2 - 1) * range),
                        r: Math.round(a.homeR + (rng() * 2 - 1) * range),
                    };
                    const [lo, hi] = _pair(b.wanderSteps, 3);
                    a.steps = lo + Math.floor(rng() * (hi - lo + 1));
                    a.state = 'walk';
                }
            }
        }
    },

    _animalGraze(a, cfg) {
        const g = _pair((cfg.behaviour || {}).grazeSeconds, 5);
        a.state = 'graze';
        a.target = null;
        a.steps = 0;
        a.timer = g[0] + (this._animalRng ? this._animalRng() : 0.5) * (g[1] - g[0]);
    },

    /** It has run far enough: it stops, turns to look back, and makes this its ground now. */
    _animalStopAndStare(a, me, cfg) {
        const al = _pair((cfg.behaviour || {}).alertSeconds, 4);
        a.state = 'alert';
        a.threat = null;
        a.steps = 0;
        a.homeQ = a.q; a.homeR = a.r;
        a.timer = al[0] + (this._animalRng ? this._animalRng() : 0.5) * (al[1] - al[0]);
        a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
    },

    /** Animals whose body covers (q, r): standing on it, or the tile below (the sprite stands up from its feet). */
    getAnimalsNear(q, r, reach = 1) {
        const out = [];
        for (const a of this.animals || []) {
            const p = this.animalPos(a);
            const dq = Math.abs(p.q - q), dr = p.r - r;
            if (dq <= reach + 0.5 && dr >= -reach - 0.5 && dr <= reach + 1.5) out.push({ a, d: Math.hypot(dq, dr - 0.5) });
        }
        return out.sort((x, y) => x.d - y.d).map(x => x.a);
    },

    /** The nearest animal of a species (or kind) within `reach` of `at`. */
    nearestAnimal(species, at, reach = Infinity) {
        let best = null, bd = Infinity;
        for (const a of this.animals || []) {
            if (a.hunted || (species && a.species !== species && a.kind !== species)) continue;
            const d = Math.max(Math.abs(a.q - at.q), Math.abs(a.r - at.r));
            if (d <= reach && d < bd) { bd = d; best = a; }
        }
        return best;
    },

    /** A beast for a hunt to follow where the map has none of its kind: it lives only for the hunt. */
    addTaskAnimal(species, q, r) {
        if (!this.animalSpecies(species)) return null;
        const a = this._makeAnimal({ id: `task:${species}:${++_seq}`, species, q, r }, this.animalConfig());
        a.temporary = true;
        a.hunted = true;
        this.animals.push(a);
        return a;
    },

    removeAnimal(a) {
        const i = (this.animals || []).indexOf(a);
        if (i >= 0) this.animals.splice(i, 1);
    },

    /** A hunt is over and the beast lives: back to its own life (running, if it was put up). */
    releaseAnimal(a, from = null) {
        if (!a) return;
        a.hunted = false;
        a.drawQ = a.drawR = null;
        a.next = null; a.progress = 0;
        if (a.temporary) { this.removeAnimal(a); return; }
        a.homeQ = a.q; a.homeR = a.r;
        if (from) this.alarmAnimal(a, from);
        else this._animalGraze(a, this.animalConfig());
    },

    /** A kill: off the map, and gone from its hex's herd until the herd grows back. */
    cullAnimal(world, a) {
        if (!a) return;
        this.removeAnimal(a);
        if (a.temporary || !world || !this.currentWorldTile) return;
        if (!world.wildlife || typeof world.wildlife !== 'object') world.wildlife = {};
        if (!world.wildlife.culled) world.wildlife.culled = {};
        const key = `${this.currentWorldTile.q},${this.currentWorldTile.r}`;
        const list = (world.wildlife.culled[key] || []).filter(c => c && c.id !== a.id);
        list.push({ id: a.id, day: _num(world.day, 0) });
        world.wildlife.culled[key] = list;
    },

    /** The hunt moved its beast to (q, r), drawn at (fq, fr). */
    moveHuntedAnimal(a, q, r, fq, fr, dt = 0, running = false) {
        if (!a) return;
        if (q !== a.q || r !== a.r) a.facing = _facing(q - a.q, r - a.r, a.facing);
        a.q = q; a.r = r;
        a.drawQ = fq; a.drawR = fr;
        const moving = Math.abs(fq - q) + Math.abs(fr - r) > 0.04;
        a.moving = moving;
        a.state = running ? 'flee' : moving ? 'walk' : 'graze';
        if (moving) a.animT += dt;
    },
});

