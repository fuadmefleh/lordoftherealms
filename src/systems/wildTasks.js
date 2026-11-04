// ============================================
// WILD TASKS — the rules of work done in person in the wilds
// ============================================
// Foraging, hunting, fishing, winter trapping and ice fishing, smuggling and
// pickpocketing are walked through on the inner map (ui/mapTasks/wildTasks.js
// runs them). This module is the part that can be reasoned about without a
// screen: where in the wilds things are, which way a hint points, how fast
// a stalked beast grows alarmed, how true an arrow flies, who is in sight.
// Settings and wording live in data/wildTasks.json.
//
// Pure: everything is a parameter; randomness only from an rng passed in.

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Sub-terrains that are open water (or ice you can fish through). */
const WATER_IDS = new Set(['pond_water', 'river_water', 'lake_water', 'sea_water', 'water', 'shallow_water', 'murky_water', 'pond', 'stream', 'river', 'pool', 'lake', 'bog', 'frozen_pool', 'frozen_lake', 'frozen_stream']);
const ICE_IDS = new Set(['ice', 'thick_ice', 'ice_sheet', 'frozen_pool', 'frozen_lake', 'frozen_stream']);

function _data() {
    return (DataLoader.get && DataLoader.get('wildTasks')) || {};
}

export const WildTasks = {
    WATER_IDS,
    ICE_IDS,
    data: _data,

    /** One task's settings ('forage', 'hunt', …). */
    cfg(kind) {
        return _data()[kind] || {};
    },

    /** Fill {name} style fields. Unknown fields are left as they are. */
    fmt(str, vars = {}) {
        return String(str == null ? '' : str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
    },

    /** Chebyshev distance: tiles a walker crosses, diagonals included. */
    dist(a, b) {
        return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
    },

    /**
     * The wild places of an inner map a task can send you to. Each is the
     * tile you stand on.
     *   trees / rocks / plants   beside a scattered object of that type
     *   shore                    walkable ground beside open water
     *   ice                      walkable ice
     *   open                     walkable ground with nothing on it
     * @param {object} map { tiles, width, height }
     * @param {function} typeOf defId → objectType ('tree', 'rock', 'plant', …) or null
     */
    spots(map, typeOf = () => null) {
        const { tiles, width: W, height: H } = map;
        const out = { trees: [], rocks: [], plants: [], shore: [], ice: [], open: [] };
        const tile = (q, r) => (q >= 0 && r >= 0 && q < W && r < H && tiles[r] ? tiles[r][q] : null);
        const free = (t) => !!(t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart
            && !t.customBuilding && !t.customBuildingPart && !t.building && !t._doorMarker);
        const isWater = (t) => !!(t && t.subTerrain && WATER_IDS.has(t.subTerrain.id) && !t.subTerrain.passable);
        const seenStand = { trees: new Set(), rocks: new Set(), plants: new Set() };
        const N4 = [[0, 1], [-1, 0], [1, 0], [0, -1]];
        for (let r = 1; r < H - 1; r++) {
            for (let q = 1; q < W - 1; q++) {
                const t = tile(q, r);
                if (!t) continue;
                if (t.customObject && t.customObject.defId) {
                    const ty = typeOf(t.customObject.defId);
                    const key = ty === 'tree' ? 'trees' : ty === 'rock' ? 'rocks' : ty === 'plant' ? 'plants' : null;
                    if (key) {
                        const stand = N4.map(([dq, dr]) => [q + dq, r + dr]).find(([a, b]) => free(tile(a, b)));
                        const k = stand && `${stand[0]},${stand[1]}`;
                        if (stand && !seenStand[key].has(k)) {
                            seenStand[key].add(k);
                            out[key].push({ q: stand[0], r: stand[1], atQ: q, atR: r, id: t.customObject.defId });
                        }
                    }
                }
                if (!free(t) || t.isRoad) continue;
                const id = t.subTerrain.id;
                if (ICE_IDS.has(id)) out.ice.push({ q, r });
                // the bank: dry ground beside the water or its shallows (never the shallows themselves)
                if (!t._wet && N4.some(([dq, dr]) => { const n = tile(q + dq, r + dr); return isWater(n) || !!(n && n._wet); })) out.shore.push({ q, r });
                else if (!ICE_IDS.has(id)) out.open.push({ q, r });
            }
        }
        return out;
    },

    /** Places within `radius` of `at`, else the `min` nearest. */
    near(list, at, radius, min = 0) {
        const inside = list.filter(p => WildTasks.dist(p, at) <= radius);
        if (inside.length >= min) return inside;
        return list.slice().sort((a, b) => WildTasks.dist(a, at) - WildTasks.dist(b, at)).slice(0, Math.max(min, inside.length));
    },

    /** Compass word for the way from `from` to `to` (map north is up). */
    compass(from, to) {
        const dq = to.q - from.q, dr = to.r - from.r;
        if (!dq && !dr) return 'here';
        const ang = Math.atan2(-dr, dq) * 180 / Math.PI; // 0 = east, 90 = north
        const names = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
        return names[((Math.round(ang / 45) % 8) + 8) % 8];
    },

    /**
     * Searching a spot for hidden patches: a patch within reach is found;
     * else the nearest within `hintRadius` gives itself away.
     * @returns {{ hit: object|null, near: object|null, dir: string|null }}
     */
    search(at, hidden, hintRadius = 5) {
        const live = (hidden || []).filter(p => !p.found);
        const hit = live.find(p => WildTasks.dist(p, at) <= 1) || null;
        if (hit) return { hit, near: null, dir: null };
        let near = null, nd = Infinity;
        for (const p of live) {
            const d = WildTasks.dist(p, at);
            if (d <= hintRadius && d < nd) { nd = d; near = p; }
        }
        return { hit: null, near, dir: near ? WildTasks.compass(at, near) : null };
    },

    /** How many hidden patches a forager sees at a glance: wits and craft. */
    patchesSeen(intelligence, craftLevel) {
        return 1 + Math.floor(_num(intelligence, 5) / 4) + Math.max(0, Math.floor(_num(craftLevel)));
    },

    /**
     * A trail of sign from `from` to `to`: `n` points spaced along the line,
     * each nudged sideways (rng) and snapped to somewhere walkable.
     */
    trail(from, to, n, rng, passable = () => true) {
        const pts = [];
        const steps = Math.max(1, n);
        const dq = to.q - from.q, dr = to.r - from.r;
        const len = Math.max(1, Math.hypot(dq, dr));
        const nq = -dr / len, nr = dq / len; // sideways
        for (let i = 1; i <= steps; i++) {
            const f = i / steps;
            const side = (rng() - 0.5) * 4 * (i === steps ? 0 : 1);
            const q = Math.round(from.q + dq * f + nq * side);
            const r = Math.round(from.r + dr * f + nr * side);
            pts.push(WildTasks._snap({ q, r }, passable) || { q, r });
        }
        return pts;
    },

    /** The nearest walkable tile to `p` (spiral search), or null. */
    _snap(p, passable, reach = 4) {
        if (passable(p.q, p.r)) return { q: p.q, r: p.r };
        for (let d = 1; d <= reach; d++) {
            for (let a = -d; a <= d; a++) {
                for (const [q, r] of [[p.q + a, p.r - d], [p.q + a, p.r + d], [p.q - d, p.r + a], [p.q + d, p.r + a]]) {
                    if (passable(q, r)) return { q, r };
                }
            }
        }
        return null;
    },

    // ── Hunting ──

    /** How near you can come before a beast takes notice: stealth and craft shrink it. */
    alertRadius(stealth, huntRank, c = WildTasks.cfg('hunt')) {
        return Math.max(_num(c.alertMin, 3), _num(c.alertBase, 8) - _num(stealth, 1) * _num(c.alertPerStealth, 0.4) - _num(huntRank) * _num(c.alertPerRank, 0.3));
    },

    /**
     * One tick of a stalk. Walking within the alert radius raises the beast's
     * alarm, faster the closer you are and the longer you keep walking (pace);
     * standing still lets it calm and your pace settle.
     * @param {object} s { alert 0..1, pace }
     * @param {object} o { dist, radius, walking, dt }
     * @returns {{ alert, pace, bolt }} bolt when alarmed, or you blunder right up to it
     */
    stalkStep(s, o, c = WildTasks.cfg('hunt')) {
        const dt = Math.max(0, _num(o.dt));
        let alert = _num(s.alert), pace = _num(s.pace);
        const inside = o.dist <= o.radius;
        if (o.walking) pace = Math.min(_num(c.paceMax, 2), pace + dt * _num(c.pacePerSecond, 0.6));
        else pace = Math.max(0, pace - dt * 2);
        if (inside && o.walking) {
            const close = 1 + (o.radius - o.dist) / Math.max(1, o.radius); // 1 at the edge, 2 on top of it
            alert += dt * _num(c.gainPerSecond, 0.45) * close * (1 + pace);
        } else {
            alert -= dt * _num(c.calmPerSecond, 0.25);
        }
        alert = _clamp(alert, 0, 1);
        const bolt = alert >= 1 || (o.walking && o.dist <= _num(c.spookRadius, 1));
        return { alert, pace, bolt };
    },

    /**
     * The loot table of a living animal hunted (data/animals.json species.loot:
     * [{ name, chance?, qty? }] or names): each the hunting table's own entry
     * of that name (data/earlyJobs.json hunting.loot_table, any terrain), with
     * the species' chance and qty in place of the terrain's — or, named with
     * an `item` (and icon, sellPrice), an entry of its own. The first is the
     * sure one (Hunting.strikeLoot always gives it).
     */
    animalLoot(species, lootTables) {
        const all = [];
        for (const list of Object.values(lootTables || {})) if (Array.isArray(list)) all.push(...list);
        const out = [];
        for (const spec of (species && species.loot) || []) {
            const want = typeof spec === 'string' ? { name: spec } : spec || {};
            // An entry of its own (a sheep's fleece, a lion's pelt) where the hunting table has none of the name
            const base = all.find(e => e && e.name === want.name)
                || (want.item ? { item: want.item, name: want.name || want.item, icon: want.icon || '🥩', sellPrice: _num(want.sellPrice, 0) } : null);
            if (!base || out.some(e => e.name === base.name)) continue;
            const entry = { ...base };
            if (typeof want.chance === 'number') entry.chance = want.chance;
            if (want.qty) entry.qty = { ...want.qty };
            out.push(entry);
        }
        return out;
    },

    /** 0 calm, 1 wary, 2 alarmed. */
    alertLevel(alert) {
        return alert < 0.35 ? 0 : alert < 0.7 ? 1 : 2;
    },

    /**
     * How true a loosed arrow flies, 0–100 (compared with Hunting.hitThreshold).
     * Close and calm is best; `roll` is 0..1 from the rng.
     */
    shotAccuracy(dist, alert, roll) {
        return Math.round(_clamp(100 - Math.max(0, dist - 1) * 12 - _num(alert) * 35 - (1 - _num(roll, 0.5)) * 30, 0, 100));
    },

    // ── Fishing ──

    /** Chance that a cast gets a bite. */
    biteChance(luck, c = WildTasks.cfg('fish')) {
        return _clamp(_num(c.biteBase, 0.65) + _num(luck, 5) * _num(c.bitePerLuck, 0.03), 0, 0.97);
    },

    /** Seconds you have to strike once it bites. */
    strikeWindow(luck, c = WildTasks.cfg('fish')) {
        return _num(c.windowBase, 1.4) + _num(luck, 5) * _num(c.windowPerLuck, 0.05);
    },

    /** Chance to land a hooked fish: strength against its fight. */
    landChance(fight, strength) {
        return _clamp(0.55 + _num(strength, 5) * 0.05 - _num(fight, 2) * 0.06, 0.2, 0.97);
    },

    // ── Trapping ──
    // A snare is only as good as where it is set: on a game run, under cover,
    // it takes something most days; out on open ground little passes by.

    /** Nearest distance from `at` to any of `list` (Infinity when empty). */
    _nearest(at, list) {
        let d = Infinity;
        for (const p of list || []) d = Math.min(d, WildTasks.dist(p, at));
        return d;
    },

    /**
     * How good a snare spot is, 0..1: how near a game run (`runs`, the sign
     * points) and how near cover (`cover`, tiles beside trees / brush / rocks).
     */
    snareQuality(at, runs, cover, c = WildTasks.cfg('trap')) {
        const k = c.quality || {};
        const dRun = WildTasks._nearest(at, runs);
        const dCover = WildTasks._nearest(at, cover);
        let v = _num(k.base, 0.1);
        if (dRun <= 0) v += _num(k.onRun, 0.5);
        else if (dRun <= 1) v += _num(k.byRun, 0.4);
        else if (dRun <= 2) v += _num(k.nearRun, 0.2);
        if (dCover <= 1) v += _num(k.cover, 0.3);
        else if (dCover <= 2) v += _num(k.nearCover, 0.15);
        return Math.round(_clamp(v, 0, 1) * 100) / 100;
    },

    /** Word for a snare spot's quality ('good' | 'fair' | 'poor'). */
    snareGrade(quality) {
        return quality >= 0.65 ? 'good' : quality >= 0.35 ? 'fair' : 'poor';
    },

    /**
     * What one snare holds when checked at the end of a day's trapping.
     * o: { luck, skill (0..2) }. Returns { items, prize }.
     */
    snareCatch(quality, rng, o = {}, c = WildTasks.cfg('trap')) {
        const k = c.catch || {};
        const skill = _num(o.skill);
        const chance = _clamp(_num(k.base, 0.2) + _num(quality, 0.5) * _num(k.perQuality, 0.6)
            + (_num(o.luck, 5) - 5) * _num(k.perLuck, 0.02) + skill * _num(k.perSkill, 0.05), 0, 0.95);
        const items = {};
        let prize = false;
        if (rng() < chance) {
            items.pelts = 1 + (rng() < _num(k.extraPelt, 0.25) + skill * 0.1 ? 1 : 0);
            if (rng() < _num(k.rareChance, 0.03)) { items.pelts += 3; prize = true; }
        }
        if (rng() < _num(k.meatChance, 0.15) * (0.5 + _num(quality, 0.5))) items.meat = 1;
        return { items, prize };
    },

    /** Snare weight for sharing out a line's catch (an unrated snare is middling). */
    _snareWeight(s) {
        return Math.max(0.05, _num(s && s.quality, 0.5));
    },

    /**
     * How a line's snares shape what it catches each day: the mean quality
     * of its snares (1 for a line laid without walking it).
     */
    lineFactor(snares, c = WildTasks.cfg('trap')) {
        const rated = (snares || []).filter(s => s && typeof s.quality === 'number');
        if (!rated.length) return 1;
        const avg = rated.reduce((a, s) => a + s.quality, 0) / rated.length;
        const k = c.line || {};
        return _clamp(_num(k.base, 0.4) + avg * _num(k.perQuality, 1.2), _num(k.min, 0.3), _num(k.max, 1.5));
    },

    /**
     * Which snare holds what: a line's catch shared among its snares by their
     * weight (largest remainder, so the shares add up exactly). Deterministic.
     * @returns {object[]} one item map per snare
     */
    spreadCatch(items, snares) {
        const n = (snares || []).length;
        const out = Array.from({ length: n }, () => ({}));
        if (!n) return out;
        const w = snares.map(s => WildTasks._snareWeight(s));
        const sum = w.reduce((a, b) => a + b, 0);
        for (const [id, qty] of Object.entries(items || {})) {
            if (!(qty > 0)) continue;
            const exact = w.map(x => (qty * x) / sum);
            const base = exact.map(Math.floor);
            let left = qty - base.reduce((a, b) => a + b, 0);
            const order = exact.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
            for (let j = 0; left > 0; j = (j + 1) % n, left--) base[order[j][1]]++;
            base.forEach((v, i) => { if (v > 0) out[i][id] = v; });
        }
        return out;
    },

    // ── Watchers: smuggling and pickpocketing ──

    /** How far the watch sees a smuggler: stealth narrows it. */
    sightRadius(stealth, c = WildTasks.cfg('smuggle')) {
        return Math.max(_num(c.sightMin, 2), _num(c.sightBase, 4) - _num(stealth, 1) * _num(c.sightPerStealth, 0.25));
    },

    /** The nearest watcher with `pos` inside its radius (w.radius or `radius`), or null. */
    inSight(watchers, pos, radius) {
        let best = null, bd = Infinity;
        for (const w of watchers || []) {
            if (!w) continue;
            const d = Math.hypot(w.q - pos.q, w.r - pos.r);
            const rad = _num(w.radius, radius);
            if (d <= rad && d < bd) { bd = d; best = w; }
        }
        return best;
    },

    /**
     * One tick of suspicion while carrying contraband: in sight it rises
     * (faster when close, and when walking about); out of sight it ebbs.
     */
    suspicionStep(susp, o, c = WildTasks.cfg('smuggle')) {
        const dt = Math.max(0, _num(o.dt));
        let s = _num(susp);
        if (o.seen) {
            const close = 1 + Math.max(0, 1 - _num(o.dist) / Math.max(1, _num(o.radius, 1)));
            s += dt * _num(c.risePerSecond, 25) * close * (o.walking ? _num(c.walkMult, 1.5) : 1) / 2;
        } else {
            s -= dt * _num(c.fallPerSecond, 8);
        }
        return _clamp(s, 0, 100);
    },

    /** A pickpocket's mark: how far they notice you, and how long the lift takes. */
    markSense(awareness, stealth, c = WildTasks.cfg('pickpocket')) {
        const aw = _num(awareness, 0.3), st = _num(stealth, 1);
        return {
            notice: Math.max(_num(c.noticeMin, 1.5), _num(c.noticeBase, 2) + aw * _num(c.noticePerAwareness, 4) - st * _num(c.noticePerStealth, 0.2)),
            lift: Math.max(_num(c.liftMin, 1.2), _num(c.liftBase, 2.5) + aw * _num(c.liftPerAwareness, 3) - st * _num(c.liftPerStealth, 0.15)),
            every: _num((c.glanceEvery || [])[0], 4.5) - aw * _num((c.glanceEvery || [])[1], 2.5),
        };
    },
};
