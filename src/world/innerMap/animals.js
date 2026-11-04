// InnerMap — living animals (data/animals.json).
// A wild hex with the right ground keeps its beasts — deer herds, elk and
// reindeer, goats on the heights, rabbits and foxes, wolf packs, a bear, the
// big cats and elephants of hot country, polar bears on the ice — and a
// village keeps its flocks of sheep and highland cattle in its pastures. They
// live on InnerMap.animals, a list of their own (not InnerMap.npcs: an animal
// is never talked to, robbed, jailed or counted as a townsman). Where they
// graze is a hash of the world seed and the hex, so a hex holds the same
// beasts on every visit and no RNG stream is drawn at placement; how they
// wander, run and fight is drawn from the map's own seeded stream (never
// Utils.random's shared one, so the world's other draws are untouched).
//
// Prey graze, amble about a home range and bolt from the player who comes too
// near — the rest of the herd with them. The dangerous ones (data: temper)
// warn you off (territorial: bear, boar), or stalk and rush you (hunter:
// wolves in packs, the big cats, the polar bear — rolling their aggression,
// more by night), bite through an attack cycle and break off when hurt; a
// defensive beast (a stag, an elk, an elephant, a cow) turns and fights when
// struck or cornered. updateAnimals returns what happened — bites on the
// player among it — for the UI to apply (ui/innerMapAnimals.js). A beast
// killed plays its death and lies as a carcass where it fell (however it was
// killed: hunted, fought, slaughtered); it is gone from its hex's herd until
// world.wildlife.culled says it has grown back (data: respawnDays). The
// carcass itself is kept on world.wildlife.carcasses (saved with the world),
// so it is still there when the player comes back — rotting, by the day, until
// the scavengers have it (data: carcass). It can be carried (canCarryAnimal,
// by its weight) and is only butchered by hand (butcherAnimal).
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
/** States of a beast set on the player. */
const HOSTILE = new Set(['stalk', 'charge', 'attack']);

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

const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

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

    /** A terrain's herd groups: [{ herd, chance, herds, minTemp?, maxTemp? }] (one object or a list). */
    _terrainGroups(cfg, terrainId) {
        const spot = cfg.terrain && cfg.terrain[terrainId];
        if (!spot) return [];
        return (Array.isArray(spot) ? spot : [spot]).filter(g => g && cfg.herds && cfg.herds[g.herd]);
    },

    /** How likely a group's herd is in this hex: its chance, thinned by a settlement or one next door. */
    _groupChance(cfg, group, herdDef, o) {
        let chance = _num(group.chance, 0);
        if (o.temperature != null) {
            if (group.minTemp != null && o.temperature < group.minTemp) return 0;
            if (group.maxTemp != null && o.temperature > group.maxTemp) return 0;
        }
        if (herdDef.livestock) {
            const L = cfg.livestock || {};
            if (o.settlementType) return chance * _num((L.settlementFactor || {})[o.settlementType], 0);
            if (o.nearTown) return chance * _num(L.nearTownFactor, 0.8);
            return chance * _num(L.wildFactor, 0);
        }
        if (o.settlementType) return herdDef.wild ? 0 : chance * _num((cfg.settlementFactor || {})[o.settlementType], 0);
        if (o.nearTown) return chance * (herdDef.wild ? _num(cfg.wildNearTownFactor, 0.4) : _num(cfg.nearTownFactor, 1));
        return chance;
    },

    /**
     * The beasts of a hex: [{ id, species, herd, q, r, homeQ, homeR, livestock? }].
     * Pure: reads only the tiles and the seed.
     *   o.settlementType  the hex's settlement, if any (fewer wild herds; flocks in its pastures; city and capital none)
     *   o.nearTown        a settlement next door (fewer wild herds; flocks)
     *   o.temperature     the hex's warmth 0..1 (lions and elephants where it is hot, reindeer where cold)
     *   o.season          'Spring' … (fawns in spring and summer)
     *   o.culled          ids killed and not yet grown back
     *   o.people          [{ q, r }] folk on the map (a camp, a roadhouse): herds keep off
     *   o.encounters      [{ id, slot, q, r }] wilderness encounters on the map: a "wolf" one brings its pack
     *   o.builtDist       _builtDistance(tiles) (worked out when not given)
     */
    planHerds(tiles, terrainId, worldQ, worldR, seed, o = {}) {
        const cfg = o.cfg || this.animalConfig();
        const H = tiles.length, W = H ? tiles[0].length : 0;
        if (!W) return [];
        const groups = this._terrainGroups(cfg, terrainId);
        const s = String(seed == null ? 'world' : seed);
        const pl = { margin: 10, minFromCentre: 16, minApart: 22, builtMargin: 16, peopleMargin: 12, ...(cfg.placement || {}) };
        const builtDist = o.builtDist !== undefined ? o.builtDist : this._builtDistance(tiles);
        const culled = new Set(o.culled || []);
        const people = o.people || [];
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        const m = Math.min(pl.margin, Math.floor(W / 4));
        const span = (n) => Math.max(1, n - 2 * m);
        const inside = (q, r) => q >= 1 && r >= 1 && q < W - 1 && r < H - 1 && tiles[r] && this._animalGround(tiles[r][q]);
        const wildGround = (q, r) => inside(q, r) && !(builtDist && builtDist[r * W + q] < pl.builtMargin);
        // A village's flocks graze its pastures: near the houses, not among them
        const [nbLo, nbHi] = _pair((cfg.livestock || {}).nearBuilt, 6);
        const pasture = (q, r) => inside(q, r) && (!builtDist || (builtDist[r * W + q] >= nbLo && builtDist[r * W + q] <= nbHi));
        const out = [];
        const homes = [];
        const taken = new Set();
        groups.forEach((group, gi) => {
            const herdDef = cfg.herds[group.herd];
            const chance = this._groupChance(cfg, group, herdDef, o);
            // The first deer group keeps the hashes (and ids) the deer have always had
            const legacy = group.herd === 'deer' && groups.findIndex(g => g.herd === 'deer') === gi;
            const tag = legacy ? [] : [group.herd];
            if (chance <= 0 || _u(_hash(s, 'herds', ...tag, worldQ, worldR)) >= chance) return;
            const [hLo, hHi] = _pair(group.herds, 1);
            const herds = hLo + (_hash(s, 'herdsN', ...tag, worldQ, worldR) % Math.max(1, hHi - hLo + 1));
            const ground = herdDef.livestock && o.settlementType ? pasture : wildGround;
            for (let h = 0; h < herds; h++) {
                // Where: the first open spot the hash lands on
                let home = null;
                for (let attempt = 0; attempt < 60 && !home; attempt++) {
                    const q = m + (_hash(s, 'hq', ...tag, worldQ, worldR, h, attempt) % span(W));
                    const r = m + (_hash(s, 'hr', ...tag, worldQ, worldR, h, attempt) % span(H));
                    if (!ground(q, r)) continue;
                    if (Math.max(Math.abs(q - cq), Math.abs(r - cr)) < pl.minFromCentre) continue;
                    if (homes.some(p => Math.max(Math.abs(p.q - q), Math.abs(p.r - r)) < pl.minApart)) continue;
                    if (!herdDef.livestock && people.some(p => Math.max(Math.abs(p.q - q), Math.abs(p.r - r)) < pl.peopleMargin)) continue;
                    home = { q, r };
                }
                if (!home) continue;
                homes.push(home);
                const key = legacy ? `${worldQ},${worldR}:${h}` : `${worldQ},${worldR}:${group.herd}${h}`;
                this._placeHerd(out, herdDef, key, home, ground, { s, cfg, culled, taken, season: o.season });
            }
        });
        // An encounter that names a beast (a wolf pack, a bear) brings the beasts themselves
        for (const e of o.encounters || []) {
            const herdName = (cfg.encounterHerds || {})[e.id];
            const herdDef = herdName && cfg.herds && cfg.herds[herdName];
            if (!herdDef || !inside(e.q, e.r)) continue;
            this._placeHerd(out, herdDef, `${worldQ},${worldR}:enc${e.slot}`, { q: e.q, r: e.r }, inside, { s, cfg, culled, taken, season: o.season, skipHome: true });
        }
        return out;
    },

    /** The members of one herd about its home, each on open ground and none on another. */
    _placeHerd(out, herdDef, key, home, ground, c) {
        const members = [];
        // hashed as the deer always were: (q, r, herd index, species)
        const [qr, hk] = key.split(':');
        const kp = [...qr.split(','), hk];
        for (const sp of Object.keys(herdDef)) {
            const def = herdDef[sp];
            if (!def || typeof def !== 'object' || Array.isArray(def) || !c.cfg.species || !c.cfg.species[sp]) continue;
            if (Array.isArray(def.seasons) && c.season && !def.seasons.includes(c.season)) continue;
            if (_u(_hash(c.s, 'hm', ...kp, sp)) >= _num(def.chance, 1)) continue;
            const [lo, hi] = _pair(def.count, 1);
            const n = lo + (_hash(c.s, 'hn', ...kp, sp) % Math.max(1, hi - lo + 1));
            for (let k = 0; k < n; k++) members.push({ sp, id: `${key}:${sp}${k}` });
        }
        const spread = Math.max(1, _num(herdDef.spread, 3));
        members.forEach((mb, i) => {
            if (c.culled.has(mb.id)) return;
            for (let attempt = 0; attempt < 30; attempt++) {
                const hq = _hash(c.s, 'mq', mb.id, attempt), hr = _hash(c.s, 'mr', mb.id, attempt);
                const first = i === 0 && attempt === 0 && !c.skipHome;
                const q = home.q + (first ? 0 : (hq % (2 * spread + 1)) - spread);
                const r = home.r + (first ? 0 : (hr % (2 * spread + 1)) - spread);
                const k = `${q},${r}`;
                if (c.taken.has(k) || !ground(q, r) || (c.skipHome && q === home.q && r === home.r)) continue;
                c.taken.add(k);
                const p = { id: mb.id, species: mb.sp, herd: key, q, r, homeQ: home.q, homeR: home.r };
                if (herdDef.livestock) p.livestock = true;
                out.push(p);
                break;
            }
        });
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
        const hp = Math.max(1, _num(sp.hp, 30));
        return {
            id: p.id, species: p.species, kind: sp.kind || p.species, herd: p.herd || null,
            q: p.q, r: p.r, homeQ: p.homeQ != null ? p.homeQ : p.q, homeR: p.homeR != null ? p.homeR : p.r,
            next: null, progress: 0, facing: 'down', state: 'graze', timer: 0, steps: 0, target: null,
            fleeT: 0, threat: null, animT: 0, hunted: false,
            hp, maxHp: hp, livestock: !!(p.livestock || sp.livestock), owner: p.owner || null,
            aggro: null, cool: 0, chaseT: 0, atkT: 0, bit: false, bites: 0, stuckT: 0,
        };
    },

    /**
     * Put the hex's beasts on the map just entered (enter() calls this, after
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
        let near = null;
        if (!worldTile.settlement && world && typeof world.getTile === 'function') {
            for (let dr = -1; dr <= 1 && !near; dr++) {
                for (let dq = -1; dq <= 1 && !near; dq++) {
                    if (!dq && !dr) continue;
                    const n = world.getTile(worldQ + dq, worldR + dr);
                    if (n && n.settlement) near = n.settlement;
                }
            }
        }
        // The wilderness encounters on the map that name a beast
        const encounters = [];
        if (!worldTile.settlement && cfg.encounterHerds) {
            for (let r = 0; r < this.tiles.length; r++) {
                const row = this.tiles[r];
                for (let q = 0; q < row.length; q++) {
                    const e = row[q] && row[q].encounter;
                    if (e && e.slot != null && cfg.encounterHerds[e.id]) encounters.push({ id: e.id, slot: e.slot, q, r });
                }
            }
        }
        const builtDist = this._builtDistance(this.tiles);
        this._animalBuiltDist = worldTile.settlement ? builtDist : null;
        const plan = this.planHerds(this.tiles, terrainId, worldQ, worldR, seed, {
            cfg, builtDist,
            settlementType: worldTile.settlement ? (worldTile.settlement.type || 'village') : null,
            nearTown: !!near,
            temperature: typeof worldTile.temperature === 'number' ? worldTile.temperature : null,
            season: (world && world.season) || this.season || null,
            culled: this.culledAnimals(world, worldQ, worldR, cfg),
            people: (this.npcs || []).map(n => ({ q: n.q, r: n.r })),
            encounters,
        });
        const owner = worldTile.settlement || near;
        this.animals = plan.map(p => this._makeAnimal({ ...p, owner: p.livestock && owner ? { name: owner.name || null, kingdom: owner.kingdom != null ? owner.kingdom : null } : null }, cfg));
        this._animalRng = _stream(_hash(String(seed == null ? 'world' : seed), 'animalMoves', worldQ, worldR, world ? world.day || 0 : 0));
        // Each starts at a different point of its grazing
        const g = _pair((cfg.behaviour || {}).grazeSeconds, 5);
        for (const a of this.animals) {
            a.timer = g[0] + this._animalRng() * (g[1] - g[0]);
            a.facing = STEPS[Math.floor(this._animalRng() * 4)][2];
        }
        // The kills left lying here (and not yet rotted away)
        this._restoreCarcasses(world, worldQ, worldR, cfg);
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

    /** How near the player may come before an animal notices. */
    animalNoticeRadius(a, o = {}, cfg = this.animalConfig()) {
        const b = cfg.behaviour || {};
        const sp = this.animalSpecies(a.species, cfg) || {};
        const base = Math.max(_num(b.noticeMin, 3), _num(b.noticeRadius, 7) - _num(o.stealth, 1) * _num(b.noticePerStealth, 0.3));
        return base * _num(sp.wary, 1) * (o.walking === false ? _num(b.noticeStill, 0.55) : 1);
    },

    /** Send an animal (and the rest of its herd near it) running from `from`. */
    alarmAnimal(a, from, cfg = this.animalConfig()) {
        if (!a || a.hunted || a.state === 'dead') return;
        const b = cfg.behaviour || {};
        const start = (x) => {
            if (x.hunted || x.state === 'dead') return;
            x.state = 'flee';
            x.threat = { q: from.q, r: from.r };
            x.fleeT = 0;
            x.steps = 0;
        };
        start(a);
        for (const o of this.animals) {
            if (o === a || o.state === 'flee' || HOSTILE.has(o.state) || !a.herd || o.herd !== a.herd) continue;
            if (Math.max(Math.abs(o.q - a.q), Math.abs(o.r - a.r)) <= _num(b.herdAlarm, 8)) start(o);
        }
    },

    /** How many beasts are set on the player just now. */
    _attackers() {
        let n = 0;
        for (const a of this.animals) if (HOSTILE.has(a.state)) n++;
        return n;
    },

    /** Set on the player: rushing in (and its pack with it). */
    _animalCharge(a, me, events, cfg, pack = false) {
        const b = cfg.behaviour || {};
        if (a.state === 'dead' || a.hunted) return;
        if (!HOSTILE.has(a.state) && this._attackers() >= _num(b.maxAttackers, 3)) { this._animalStopAndStare(a, me, cfg); return; }
        const was = a.state;
        a.state = 'charge';
        a.chaseT = 0;
        a.stuckT = 0;
        a.target = null;
        a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
        if (was !== 'charge' && was !== 'attack' && events) events.push({ type: 'charge', a });
        if (!pack || !a.herd) return;
        for (const o of this.animals) {
            if (o === a || o.herd !== a.herd || o.state === 'dead' || o.hunted || HOSTILE.has(o.state)) continue;
            const osp = this.animalSpecies(o.species, cfg) || {};
            if (!(_num(osp.fightChance, 0) > 0) || o.hp / o.maxHp < _num(osp.fleeBelow, 0.4)) continue;
            if (_cheb(o, a) <= _num(b.herdAlarm, 8)) this._animalCharge(o, me, events, cfg, false);
        }
    },

    /** It has had enough (bitten its fill, chased too long, or lost you): it backs off, and leaves you be a while. */
    _animalBackOff(a, me, events, cfg) {
        const b = cfg.behaviour || {};
        a.cool = _num(b.calmSeconds, 25);
        a.bites = 0;
        a.atkT = 0;
        a.bit = false;
        a.state = 'flee';
        a.threat = { q: me.q, r: me.r };
        a.fleeT = Math.max(0, _num(b.fleeSecondsMax, 7) - 3);
        a.steps = 0;
        if (events) events.push({ type: 'backsOff', a });
    },

    /**
     * It has noticed the player: what it does by its temper (data: notice) —
     * flee (and its herd), watch, warn you off, or stalk you.
     */
    _animalNotice(a, me, d, o, events, cfg) {
        const sp = this.animalSpecies(a.species, cfg) || {};
        const b = cfg.behaviour || {};
        let mode = sp.notice || 'flee';
        if ((a.cool > 0 || o.noTarget) && mode !== 'flee') mode = 'watch';
        if (mode === 'threat') {
            if (d <= _num(sp.threatRadius, 5)) {
                a.state = 'threat';
                a.timer = 0;
                a.target = null;
                a.steps = 0;
                a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
                events.push({ type: 'threat', a });
            } else mode = 'watch';
        }
        if (mode === 'stalk') {
            // The pack decides together, once a visit: hunt the stranger, or let them pass
            if (a.aggro == null) {
                const p = _num(sp.aggression, 0) * (o.night ? _num(b.nightAggression, 1.5) : 1);
                const yes = this._animalRng() < p;
                for (const x of this.animals) if (x === a || (a.herd && x.herd === a.herd && x.aggro == null)) x.aggro = yes;
            }
            if (a.aggro && this._attackers() < _num(b.maxAttackers, 3)) {
                const pack = this.animals.filter(x => x === a || (a.herd && x.herd === a.herd && !HOSTILE.has(x.state) && x.state !== 'dead' && !x.hunted && x.cool <= 0));
                for (const x of pack) {
                    if (this._attackers() >= _num(b.maxAttackers, 3)) break;
                    x.state = 'stalk';
                    x.target = null;
                    x.steps = 0;
                    x.chaseT = 0;
                }
                events.push({ type: 'stalk', a });
                return;
            }
            mode = 'watch';
        }
        if (mode === 'watch') {
            if (a.state !== 'alert') {
                const al = _pair(b.alertSeconds, 4);
                a.state = 'alert';
                a.steps = 0;
                a.target = null;
                a.timer = al[0] + this._animalRng() * (al[1] - al[0]);
            }
            return;
        }
        if (mode === 'flee') this.alarmAnimal(a, me, cfg);
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

    /** A step closing on the player (round a snag where it must), never onto their tile; null when none. */
    _chaseStep(a, me) {
        const here = Math.hypot(a.q - me.q, a.r - me.r);
        let best = null, bestD = Infinity;
        for (const [dq, dr, dir] of STEPS) {
            const nq = a.q + dq, nr = a.r + dr;
            if ((nq === me.q && nr === me.r) || (a.prev && a.prev.q === nq && a.prev.r === nr)) continue;
            if (!this._animalCanStep(a.q, a.r, nq, nr)) continue;
            const d = Math.hypot(nq - me.q, nr - me.r);
            if (d > here + 0.75) continue;
            if (d < bestD) { bestD = d; best = { q: nq, r: nr, dir }; }
        }
        return best;
    },

    /**
     * One frame of the animals' lives. Returns what happened that the UI must
     * answer: [{ type: 'bite', a, dmg } | { type: 'threat' | 'stalk' | 'charge' | 'backsOff', a }].
     *   o.walking   the player is on the move (a still hunter is noticed nearer)
     *   o.stealth   the player's stealth (shrinks the ring they notice you in)
     *   o.player    { q, r } (default: the player's tile)
     *   o.night     it is dark (the hunters are bolder)
     *   o.noTarget  the player is not to be set on (out cold, at a task's mercy): beasts only watch
     */
    updateAnimals(dt, o = {}) {
        const events = [];
        if (!this.active || this._insideBuilding || !this.animals || !this.animals.length) return events;
        const cfg = this.animalConfig();
        const b = cfg.behaviour || {};
        const rng = this._animalRng || (this._animalRng = _stream(1));
        const me = o.player || { q: this.playerInnerQ, r: this.playerInnerR };
        for (const a of this.animals.slice()) {
            const sp = this.animalSpecies(a.species, cfg) || {};
            // A carcass lies where it fell until butchered (then it soon fades)
            if (a.state === 'dead') {
                a.deadT = _num(a.deadT) + dt;
                if (a.butchered) {
                    a.fadeT = _num(a.fadeT) + dt;
                    if (a.fadeT >= _num(b.butcheredSeconds, 20)) this.removeAnimal(a);
                }
                continue;
            }
            if (a.hunted) continue; // a hunt moves it (ui/mapTasks/wildTasks.js)
            if (a.cool > 0) a.cool = Math.max(0, a.cool - dt);
            const running = a.state === 'flee';
            a.animT += dt * (a.next ? 1 : 0);
            // Mid-step: carry on to the next tile
            if (a.next) {
                const speed = running ? _num(sp.fleeSpeed, 5)
                    : a.state === 'charge' ? _num(sp.chargeSpeed, _num(sp.fleeSpeed, 5))
                        : a.state === 'stalk' ? _num(sp.walkSpeed, 1) * _num(b.stalkSpeed, 1.6)
                            : _num(sp.walkSpeed, 1);
                a.progress += dt * speed;
                if (a.progress < 1) continue;
                a.prev = { q: a.q, r: a.r };
                a.q = a.next.q; a.r = a.next.r;
                a.next = null; a.progress = 0;
            }
            const d = Math.hypot(a.q - me.q, a.r - me.r);
            const near = _cheb(a, me);
            // Noticed: it flees, watches, warns or stalks, by its temper
            if ((a.state === 'graze' || a.state === 'walk' || a.state === 'alert') && d <= this.animalNoticeRadius(a, o, cfg)) {
                this._animalNotice(a, me, d, o, events, cfg);
            }
            // The player is down (or not to be had): the hunt is off
            if (o.noTarget && HOSTILE.has(a.state)) { this._animalStopAndStare(a, me, cfg); a.cool = _num(b.calmSeconds, 25); }
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
                    if (!step) {
                        // Cornered: one with fight in it may turn on you (it makes up its mind once, then
                        // leaves you be a while either way — no rolling the dice every frame)
                        const turns = !o.noTarget && near <= 2 && a.cool <= 0 && rng() < _num(sp.fightChance, 0) * 0.5
                            && a.hp / a.maxHp >= _num(sp.fleeBelow, 0.5);
                        if (near <= 2 && a.cool <= 0) a.cool = _num(b.calmSeconds, 25);
                        if (turns) this._animalCharge(a, me, events, cfg);
                        else this._animalStopAndStare(a, me, cfg);
                        break;
                    }
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
                case 'threat': {
                    // Standing its ground, roaring: come nearer, or stay, and it comes for you
                    a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
                    a.timer += dt;
                    if (d > _num(sp.threatRadius, 5) * 1.6) { this._animalStopAndStare(a, me, cfg); break; }
                    if (d <= _num(sp.chargeRadius, 2.5) || (a.timer >= _num(b.threatSeconds, 4) && d <= _num(sp.threatRadius, 5))) {
                        this._animalCharge(a, me, events, cfg);
                    }
                    break;
                }
                case 'stalk': {
                    // Coming on low and slow, then the rush
                    a.chaseT += dt;
                    if (d > _num(b.giveUpDistance, 20) || a.chaseT > _num(b.chaseSeconds, 14) * 2) { this._animalBackOff(a, me, events, cfg); break; }
                    if (d <= _num(sp.chargeRadius, 3)) { this._animalCharge(a, me, events, cfg, true); break; }
                    const step = this._chaseStep(a, me);
                    if (step) { a.next = { q: step.q, r: step.r }; a.facing = step.dir; } else a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
                    break;
                }
                case 'charge': {
                    a.chaseT += dt;
                    if (d > _num(b.giveUpDistance, 20) || a.chaseT > _num(b.chaseSeconds, 14)) { this._animalBackOff(a, me, events, cfg); break; }
                    if (near <= 1) {
                        a.state = 'attack';
                        a.atkT = 0;
                        a.bit = false;
                        a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
                        break;
                    }
                    const step = this._chaseStep(a, me);
                    if (!step) {
                        a.stuckT += dt;
                        if (a.stuckT > 2.5) this._animalBackOff(a, me, events, cfg);
                        break;
                    }
                    a.stuckT = 0;
                    a.next = { q: step.q, r: step.r };
                    a.facing = step.dir;
                    break;
                }
                case 'attack': {
                    if (near > 1) { a.state = 'charge'; a.atkT = 0; a.bit = false; break; }
                    a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
                    a.atkT += dt;
                    const swing = 4 / Math.max(1, _num(sp.attackFps, 8));
                    // The blow lands mid-swing
                    if (!a.bit && a.atkT >= swing * 0.5) {
                        a.bit = true;
                        a.bites++;
                        a.chaseT = 0;
                        const [lo, hi] = _pair(sp.bite, 3);
                        events.push({ type: 'bite', a, dmg: Math.max(0, Math.round(lo + rng() * (hi - lo))) });
                    }
                    if (a.atkT >= Math.max(swing, _num(sp.attackEvery, 1.3))) {
                        a.atkT = 0;
                        a.bit = false;
                        if (_num(sp.maxBites, 0) > 0 && a.bites >= _num(sp.maxBites, 0)) this._animalBackOff(a, me, events, cfg);
                    }
                    break;
                }
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
        return events;
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
        a.atkT = 0;
        a.bit = false;
        a.homeQ = a.q; a.homeR = a.r;
        a.timer = al[0] + (this._animalRng ? this._animalRng() : 0.5) * (al[1] - al[0]);
        a.facing = _facing(me.q - a.q, me.r - a.r, a.facing);
    },

    /**
     * The player strikes it (a blow, an arrow): its blood is down by `dmg`.
     * Killed, it falls (killAnimal); else, by its temper, it turns on `from`
     * (its pack with it), or breaks off and runs once badly hurt. Returns
     * { killed, events }.
     */
    hurtAnimal(world, a, dmg, from, cfg = this.animalConfig()) {
        const events = [];
        if (!a || a.state === 'dead') return { killed: false, events };
        a.hp = Math.max(0, _num(a.hp, 1) - Math.max(0, _num(dmg, 0)));
        if (a.hp <= 0) { this.killAnimal(world, a); return { killed: true, events }; }
        this.provokeAnimal(a, from, 'struck', events, cfg);
        return { killed: false, events };
    },

    /**
     * Something the player did set it off: 'struck' (a blow or a hit), 'shot'
     * (an arrow that missed), or 'near' (a hunter came too close). It fights
     * (data: fightChance; never once beaten below fleeBelow) or runs.
     */
    provokeAnimal(a, from, how = 'struck', events = [], cfg = this.animalConfig()) {
        if (!a || a.state === 'dead' || !from) return events;
        if (!this._animalRng) this._animalRng = _stream(1);
        const sp = this.animalSpecies(a.species, cfg) || {};
        const hurt = a.hp / Math.max(1, a.maxHp);
        a.cool = 0;
        if (how === 'near') {
            const d = Math.hypot(a.q - from.q, a.r - from.r);
            this._animalNotice(a, from, Math.min(d, _num(sp.threatRadius, d)), { noTarget: false }, events, cfg);
            return events;
        }
        const fight = _num(sp.fightChance, 0) * (how === 'shot' && sp.temper !== 'territorial' && sp.temper !== 'hunter' ? 0.5 : 1);
        if (hurt >= _num(sp.fleeBelow, 0.4) && fight > 0 && (fight >= 1 || HOSTILE.has(a.state) || this._animalRng() < fight)) {
            this._animalCharge(a, from, events, cfg, sp.temper === 'hunter');
        } else {
            a.cool = _num((cfg.behaviour || {}).calmSeconds, 25);
            this.alarmAnimal(a, from, cfg);
        }
        return events;
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

    /** The nearest living animal of a species (or kind) within `reach` of `at`. */
    nearestAnimal(species, at, reach = Infinity) {
        let best = null, bd = Infinity;
        for (const a of this.animals || []) {
            if (a.hunted || a.state === 'dead' || (species && a.species !== species && a.kind !== species)) continue;
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

    /**
     * A hunt is over and the beast lives: back to its own life — running, if
     * it was put up; turning on the hunter, if it is the kind (o.provoked:
     * 'shot' an arrow missed it, 'near' it was crept up on). A beast put on
     * the map only for the hunt goes with it, unless it has turned to fight.
     */
    releaseAnimal(a, from = null, o = {}) {
        if (!a) return;
        a.hunted = false;
        a.drawQ = a.drawR = null;
        a.next = null; a.progress = 0;
        if (a.state === 'dead') return;
        a.homeQ = a.q; a.homeR = a.r;
        if (from && o.provoked) {
            this.provokeAnimal(a, from, o.provoked, o.events || []);
            if (a.temporary && !HOSTILE.has(a.state) && a.state !== 'threat') this.removeAnimal(a);
            return;
        }
        if (a.temporary) { this.removeAnimal(a); return; }
        if (from) this.alarmAnimal(a, from);
        else this._animalGraze(a, this.animalConfig());
    },

    /** Note a kill on its hex: gone from the herd until it grows back. */
    _recordCull(world, a) {
        if (!a || a.temporary || !world || !this.currentWorldTile) return;
        if (!world.wildlife || typeof world.wildlife !== 'object') world.wildlife = {};
        if (!world.wildlife.culled) world.wildlife.culled = {};
        const key = `${this.currentWorldTile.q},${this.currentWorldTile.r}`;
        const list = (world.wildlife.culled[key] || []).filter(c => c && c.id !== a.id);
        list.push({ id: a.id, day: _num(world.day, 0) });
        world.wildlife.culled[key] = list;
    },

    /** A kill taken away at once: off the map, and gone from its hex's herd until the herd grows back. */
    cullAnimal(world, a) {
        if (!a) return;
        this.removeAnimal(a);
        this._recordCull(world, a);
    },

    /**
     * It dies where it stands: the death plays and it lies as a carcass to
     * butcher by hand (butcherAnimal), culled from its hex's herd, and kept
     * on world.wildlife.carcasses so it lies there still when the player
     * comes back. o.butchered: nothing left on it worth taking (it soon goes).
     */
    killAnimal(world, a, o = {}) {
        if (!a || a.state === 'dead') return;
        if (a.drawQ != null) { a.q = Math.round(a.drawQ); a.r = Math.round(a.drawR); }
        a.drawQ = a.drawR = null;
        a.hunted = false;
        a.next = null; a.progress = 0;
        a.state = 'dead';
        a.hp = 0;
        a.deadT = 0;
        a.fadeT = 0;
        a.butchered = !!o.butchered;
        a.diedDay = _num(world && world.day, 0);
        this._recordCull(world, a);
        if (!a.butchered) this._recordCarcass(world, a);
    },

    /**
     * Butcher a carcass (once): true when it was there to butcher. It is
     * gone from world.wildlife.carcasses (and fades off the map soon after).
     */
    butcherAnimal(a, world = null) {
        if (!a || a.state !== 'dead' || a.butchered) return false;
        a.butchered = true;
        a.fadeT = 0;
        a.carried = false;
        a.drawQ = a.drawR = null;
        this.forgetCarcass(world, a);
        return true;
    },

    // ── Carcasses: where they lie, how long they keep, who can carry one ──

    /** data/animals.json carcass, with its defaults. */
    carcassConfig(cfg = this.animalConfig()) {
        return {
            lifetimeDays: 6, freshDays: 1, rotPerDay: 0.2, minYield: 0.25,
            maxCarry: 200, perStrength: 10, shoulderKg: 70, slowPerKg: 0.0035, minSpeed: 0.3,
            secondsBase: 2, secondsPerKg: 0.02, secondsMax: 10, minutesBase: 10, minutesPerKg: 0.4, minutesMax: 240,
            ...(cfg.carcass || {}),
        };
    },

    /** A hex's list of carcasses on world.wildlife.carcasses (made when `make`), or null. */
    _carcassList(world, key, make = false) {
        if (!world || !key) return null;
        if (!world.wildlife || typeof world.wildlife !== 'object') {
            if (!make) return null;
            world.wildlife = {};
        }
        if (!world.wildlife.carcasses || typeof world.wildlife.carcasses !== 'object') {
            if (!make) return null;
            world.wildlife.carcasses = {};
        }
        const all = world.wildlife.carcasses;
        if (!Array.isArray(all[key])) {
            if (!make) return null;
            all[key] = [];
        }
        return all[key];
    },

    _hexKey() {
        const t = this.currentWorldTile;
        return t && t.q != null ? `${t.q},${t.r}` : null;
    },

    /** Keep a fresh kill on its hex (world.wildlife.carcasses), so it lies there on the next visit. */
    _recordCarcass(world, a) {
        const key = this._hexKey();
        const list = this._carcassList(world, key, true);
        if (!list) return;
        if (!a.carcassId) {
            world.wildlife.carcassSeq = _num(world.wildlife.carcassSeq, 0) + 1;
            a.carcassId = `c${world.wildlife.carcassSeq}`;
        }
        a.carcassHex = key;
        const rec = { id: a.carcassId, animal: a.id, species: a.species, q: a.q, r: a.r, facing: a.facing, day: _num(a.diedDay, _num(world.day, 0)) };
        if (a.livestock) rec.livestock = true;
        if (a.owner) rec.owner = { ...a.owner };
        const i = list.findIndex(c => c && c.id === a.carcassId);
        if (i >= 0) list[i] = rec;
        else list.push(rec);
        this._pruneCarcasses(world);
    },

    /** The carcass was moved (carried, put down): keep where it lies now. */
    noteCarcassMoved(world, a) {
        if (!a || !a.carcassId || a.butchered) return;
        const list = this._carcassList(world, a.carcassHex || this._hexKey());
        const rec = list && list.find(c => c && c.id === a.carcassId);
        if (!rec) return;
        rec.q = a.q; rec.r = a.r; rec.facing = a.facing;
    },

    /** Off the books: butchered, or gone. */
    forgetCarcass(world, a) {
        if (!a || !a.carcassId) return;
        const key = a.carcassHex || this._hexKey();
        const list = this._carcassList(world, key);
        if (!list) return;
        const left = list.filter(c => c && c.id !== a.carcassId);
        if (left.length) world.wildlife.carcasses[key] = left;
        else delete world.wildlife.carcasses[key];
    },

    /** How many whole days since it was killed. */
    carcassAge(world, a) {
        const died = a && (a.diedDay != null ? a.diedDay : a.day);
        return Math.max(0, _num(world && world.day, 0) - _num(died, 0));
    },

    /** The share of a whole carcass's yield still worth taking: 1 fresh, falling by the day as it rots. */
    carcassYield(world, a, cfg = this.animalConfig()) {
        const C = this.carcassConfig(cfg);
        const stale = Math.max(0, this.carcassAge(world, a) - _num(C.freshDays, 1));
        return Math.max(_num(C.minYield, 0.25), Math.min(1, 1 - stale * _num(C.rotPerDay, 0.2)));
    },

    /** Drop the carcasses the scavengers have had (lifetimeDays old), on every hex. */
    _pruneCarcasses(world, cfg = this.animalConfig()) {
        const all = world && world.wildlife && world.wildlife.carcasses;
        if (!all || typeof all !== 'object') return;
        const life = _num(this.carcassConfig(cfg).lifetimeDays, 6);
        const day = _num(world.day, 0);
        for (const key of Object.keys(all)) {
            const left = Array.isArray(all[key]) ? all[key].filter(c => c && day - _num(c.day, 0) < life) : [];
            if (left.length) all[key] = left;
            else delete all[key];
        }
    },

    /** The carcasses kept on this hex, back on the map as they lay (the fall long since played). */
    _restoreCarcasses(world, worldQ, worldR, cfg = this.animalConfig()) {
        this._pruneCarcasses(world, cfg);
        const key = `${worldQ},${worldR}`;
        const list = this._carcassList(world, key);
        if (!list) return;
        for (const rec of list) {
            if (!rec || !this.animalSpecies(rec.species, cfg)) continue;
            if (!(rec.q >= 0 && rec.r >= 0 && rec.q < this.width && rec.r < this.height)) continue;
            const a = this._makeAnimal({ id: rec.animal || rec.id, species: rec.species, q: rec.q, r: rec.r, livestock: rec.livestock, owner: rec.owner || null }, cfg);
            a.state = 'dead';
            a.hp = 0;
            a.deadT = 999;
            a.fadeT = 0;
            a.butchered = false;
            a.facing = rec.facing || 'down';
            a.diedDay = _num(rec.day, 0);
            a.carcassId = rec.id;
            a.carcassHex = key;
            this.animals.push(a);
        }
    },

    /** A beast's weight in kg (data: species.weight). */
    animalWeight(a, cfg = this.animalConfig()) {
        const sp = (a && this.animalSpecies(a.species, cfg)) || {};
        return Math.max(0, _num(sp.weight, 50));
    },

    /** The most a player of this strength can carry or drag, in kg. */
    carryLimit(strength = 5, cfg = this.animalConfig()) {
        const C = this.carcassConfig(cfg);
        return Math.max(0, _num(C.maxCarry, 200) + (_num(strength, 5) - 5) * _num(C.perStrength, 10));
    },

    /**
     * Can the player carry this carcass? { ok, kg, limit, how: 'shoulder' | 'drag',
     * speed (the walk's multiplier while carrying it), reason? }
     */
    canCarryAnimal(a, strength = 5, cfg = this.animalConfig()) {
        const C = this.carcassConfig(cfg);
        const kg = this.animalWeight(a, cfg);
        const limit = this.carryLimit(strength, cfg);
        const how = kg <= _num(C.shoulderKg, 70) ? 'shoulder' : 'drag';
        const speed = Math.max(_num(C.minSpeed, 0.3), Math.min(1, 1 - kg * _num(C.slowPerKg, 0.0035)));
        if (!a || a.state !== 'dead' || a.butchered) return { ok: false, kg, limit, how, speed, reason: 'nothing to carry' };
        if (kg > limit) return { ok: false, kg, limit, how, speed, reason: 'too heavy' };
        return { ok: true, kg, limit, how, speed };
    },

    /** How long butchering it takes: seconds of work at the spot, minutes on the clock. */
    butcherTime(a, cfg = this.animalConfig()) {
        const C = this.carcassConfig(cfg);
        const kg = this.animalWeight(a, cfg);
        return {
            seconds: Math.min(_num(C.secondsMax, 10), _num(C.secondsBase, 2) + kg * _num(C.secondsPerKg, 0.02)),
            minutes: Math.round(Math.min(_num(C.minutesMax, 240), _num(C.minutesBase, 10) + kg * _num(C.minutesPerKg, 0.4))),
        };
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
