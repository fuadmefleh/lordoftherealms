// ============================================
// NPC TASKS — the favours townsfolk ask, made concrete
// ============================================
// A task an NPC asks in conversation ("my grandmother's locket was taken by
// bandits", "my son went into the old forest") used to become a generic
// counter ("win any battle", "explore any ruin"). Here each request names a
// real target on the map and has to be brought home:
//
//   • a delve site (systems/delves.js) where the thing or the person is —
//     an unexplored ruin/cave/tomb near the giver, or one made for the task
//     on a free hex close by (a place nobody had found);
//   • an outlaw lair (systems/outlawLairs.js) that took it, revealed to the
//     player, which must be cleared by the player;
//   • a named band spawned for the task (a world unit tagged questKey) that
//     must be beaten by the player — if anyone else destroys it, it regroups;
//   • a named person in another town (a real townsperson from that town's
//     roster where it has one) to carry something to, or get something from;
//   • a specific good to bring.
//
// When the target is done the player carries the thing (quest.carrying) and
// must return to the giver — a townsperson, found again by their uid
// ("q,r#id", systems/townsfolk.js) — to hand it in (Quests.handInNpcTask).
// Some tasks have a second way out (sell the locket, let the son go, keep
// the strongbox) taken from the journal; the giver hears of it. Givers with
// no stable identity (travellers) complete on the target alone.
//
// No randomness from the shared stream: choices are hashes of the quest id,
// spawned bands are rolled inside a seeded stream (Utils.withRng). World,
// player and day are passed in. Content in data/npcTasks.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { Delves } from './delves.js';
import { OutlawLairs } from './outlawLairs.js';
import { Townsfolk } from './townsfolk.js';

const DEFAULT_CONFIG = {
    deadlineDays: 90,
    searchRadius: 14,
    siteMinDistance: 2,
    newSiteRange: [3, 7],
    foeRange: [3, 7],
    townRange: [3, 22],
    returnDisposition: 15,
    altDisposition: -30,
    failDisposition: -12,
    thanksDisposition: 15,
    maxFailed: 20,
};

const DEFAULT_FOE = { type: 'raider', name: '{leader}\'s Band', icon: '🏹', strength: [10, 16], population: [6, 12] };

/** The legacy hook type → the task a migrated old save's request becomes. */
const LEGACY_TASK = {
    escort_trade_caravan: 'missing_caravan',
    merchant_delivery: 'spice_supplier',
    clear_bandits: 'bandit_camp',
    fetch_item: 'lost_report',
    investigate_threat: 'livestock_killer',
    rescue_person: 'missing_son',
    retrieve_relic: 'stolen_relic',
    clear_undead: 'restless_dead',
    gather_resource: 'rare_ore',
    retrieve_item: 'stolen_sword',
    delivery: 'hermit_medicine',
    espionage: 'rival_documents',
    explore_ruins: 'ancient_ruins',
    bounty: 'bounty_target',
};

/** Objective types that point at a place on the map. */
export const TARGET_OBJECTIVES = ['site_delved', 'lair_cleared', 'foe_slain', 'talk_to', 'return_to', 'visit_towns'];

const SEARCH_ICON = { site_delved: 'ruin', lair_cleared: 'tent', foe_slain: 'swords', talk_to: 'scroll', return_to: 'house', visit_towns: 'compass', deliver_item: 'satchel' };

let _cfg = null;
let _cfgSrc;

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function _h(str) { return Utils.hashStr(String(str)) >>> 0; }
function _pickH(arr, h) { return arr && arr.length ? arr[h % arr.length] : null; }
function _day(world) { return world && Number.isFinite(world.day) ? world.day : 0; }
function _range(r, h) {
    if (!Array.isArray(r)) return _num(r);
    const lo = _num(r[0]), hi = _num(r[1], lo);
    return lo + (h % (Math.max(0, hi - lo) + 1));
}
function _dist(world, q1, r1, q2, r2) {
    const w = world && world.width;
    return w ? Hex.wrappingDistance(q1, r1, q2, r2, w) : Hex.distance(q1, r1, q2, r2);
}
function _tile(world, q, r) {
    if (!world) return null;
    if (typeof world.getTile === 'function') return world.getTile(q, r);
    return (world.tiles && world.tiles[r] && world.tiles[r][q]) || null;
}
function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}
function _views(world) {
    if (!world) return [];
    if (typeof world.getSettlementViews === 'function') return world.getSettlementViews() || [];
    if (typeof world.getAllSettlements === 'function') return world.getAllSettlements() || [];
    return [];
}

export const NpcTasks = {
    LEGACY_TASK,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.npcTasks : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                ...DEFAULT_CONFIG, ...(_obj(d.config) || {}),
                foes: _obj(d.foes) || {},
                tasks: _obj(d.tasks) || {},
                leaders: Array.isArray(d.leaders) && d.leaders.length ? d.leaders : ['Black Hob', 'Ned Tallow', 'Red Maud'],
                newSites: _obj(d.newSites) || { ruins: ['The Old Barrow'], cave: ['The Weeping Cave'] },
            };
        }
        return _cfg;
    },

    task(id) { return NpcTasks.config().tasks[id] || null; },

    /** The task a hook asks for: its own `task` id, else the default for its type. */
    taskFor(hook) {
        if (!hook) return null;
        if (hook.task && NpcTasks.task(hook.task)) return hook.task;
        const id = LEGACY_TASK[hook.type];
        return id && NpcTasks.task(id) ? id : null;
    },

    // ──────────── PLACES AND WORDS ────────────

    /** Compass word from one hex to another as the map draws them (offset rows). */
    direction(world, fq, fr, tq, tr) {
        let dq = tq - fq;
        const W = world && world.width;
        if (W) { if (dq > W / 2) dq -= W; if (dq < -W / 2) dq += W; }
        const x = dq + ((tr % 2 === 0 ? 0.5 : 0) - (fr % 2 === 0 ? 0.5 : 0));
        const y = (tr - fr) * 0.75;
        if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) return null;
        const ang = (Math.atan2(-y, x) * 180 / Math.PI + 360) % 360;
        return ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][Math.round(ang / 45) % 8];
    },

    /** "7 hexes north-east" / "right here". */
    whereText(world, fq, fr, q, r) {
        if (q == null || r == null || fq == null) return '';
        const d = _dist(world, fq, fr, q, r);
        if (d === 0) return 'right here';
        const dir = NpcTasks.direction(world, fq, fr, q, r);
        return `${d} ${d === 1 ? 'hex' : 'hexes'}${dir ? ' ' + dir : ''}`;
    },

    /** How far a place is, the way townsfolk put it. */
    distanceWords(d) {
        if (d <= 1) return 'just outside town';
        if (d <= 3) return 'close by';
        if (d <= 6) return 'a few days off';
        if (d <= 12) return 'a long way off';
        return 'far away';
    },

    /** "q,r#id" → { q, r, pid } or null. */
    parseUid(uid) {
        const m = typeof uid === 'string' ? /^(-?\d+),(-?\d+)#(\d+)$/.exec(uid) : null;
        return m ? { q: +m[1], r: +m[2], pid: +m[3] } : null;
    },

    /** The townsperson behind a uid: { person, folk, settlement } or null. */
    personByUid(world, uid) {
        const at = NpcTasks.parseUid(uid);
        if (!at) return null;
        const tile = _tile(world, at.q, at.r);
        const settlement = tile && tile.settlement;
        const folk = settlement && settlement.folk;
        const person = folk ? Townsfolk.get(folk, at.pid) : null;
        return person ? { person, folk, settlement } : null;
    },

    // ──────────── FINDING TARGETS ────────────

    /** Sites already somebody's target (other active quests), as "q,r" keys. */
    _claimed(player) {
        const out = new Set();
        for (const q of (player && player.quests && player.quests.active) || []) {
            for (const o of q.objectives || []) if (o && o.q != null && (o.type === 'site_delved' || o.type === 'lair_cleared')) out.add(`${o.q},${o.r}`);
        }
        return out;
    },

    /** Unexplored delve sites within `radius`, nearest first: [{ q, r, name, kind, d }]. */
    delveSites(world, q, r, radius, kinds = null) {
        const out = [];
        if (!world || !Array.isArray(world.tiles)) return out;
        for (let tr = 0; tr < world.tiles.length; tr++) {
            const row = world.tiles[tr] || [];
            for (let tq = 0; tq < row.length; tq++) {
                const t = row[tq];
                if (!t || !t.improvement || t.improvement.explored) continue;
                const d = _dist(world, q, r, tq, tr);
                if (d > radius) continue;
                const kind = Delves.isDelveSite(t) ? Delves.kindFor(t) : null;
                if (!kind || (kinds && !kinds.includes(kind))) continue;
                out.push({ q: tq, r: tr, name: t.improvement.name || (Delves.KINDS[kind] || {}).name || 'the old place', kind, d });
            }
        }
        return out.sort((a, b) => a.d - b.d || a.r - b.r || a.q - b.q);
    },

    findSite(world, player, q, r, kinds = null, radius = null) {
        const C = NpcTasks.config();
        const claimed = NpcTasks._claimed(player);
        const active = player && player.delves && player.delves.active;
        return NpcTasks.delveSites(world, q, r, radius != null ? radius : C.searchRadius, kinds)
            .find(s => s.d >= C.siteMinDistance && !claimed.has(`${s.q},${s.r}`) && !(active && active.q === s.q && active.r === s.r)) || null;
    },

    /** A free, passable hex at distance [lo, hi] from (q, r), chosen by hash; null when none. */
    freeHex(world, q, r, range, seed, test = null) {
        if (!world || !world.width) return null;
        const [lo, hi] = Array.isArray(range) ? range : [2, 5];
        const spots = [];
        for (const h of Hex.hexesInRange(q, r, hi)) {
            const tq = Hex.wrapQ(h.q, world.width);
            const t = _tile(world, tq, h.r);
            if (!t || !t.terrain || !t.terrain.passable || t.settlement || t.improvement) continue;
            const d = _dist(world, q, r, tq, h.r);
            if (d < lo || d > hi) continue;
            if (test && !test(t)) continue;
            spots.push({ q: tq, r: h.r });
        }
        return spots.length ? spots[_h(seed) % spots.length] : null;
    },

    /** Raise a forgotten place for a task on a free hex near (q, r): a ruin or cave nobody had found. */
    makeSite(world, q, r, poiType, seed) {
        const C = NpcTasks.config();
        const spot = NpcTasks.freeHex(world, q, r, C.newSiteRange, `${seed}|site`, t => {
            const probe = { terrain: t.terrain, improvement: { type: poiType } };
            return !!Delves.kindFor(probe);
        });
        if (!spot) return null;
        const tile = _tile(world, spot.q, spot.r);
        const names = C.newSites[poiType] || C.newSites.ruins || ['The Old Barrow'];
        tile.improvement = {
            type: poiType,
            icon: poiType === 'cave' ? '🕳️' : '🏚️',
            name: _pickH(names, _h(`${seed}|name`)),
            explored: false,
            founded: Math.max(1, _num(world.year, 900) - 200),
            questSite: true,
        };
        if (!Delves.isDelveSite(tile)) { delete tile.improvement; return null; }
        return { q: spot.q, r: spot.r, name: tile.improvement.name, kind: Delves.kindFor(tile), d: _dist(world, q, r, spot.q, spot.r), made: true };
    },

    /** The nearest standing lair within `radius` (of the given kinds), or null. */
    findLair(player, world, q, r, kinds = null, radius = null) {
        const C = NpcTasks.config();
        const claimed = NpcTasks._claimed(player);
        let best = null;
        for (const l of OutlawLairs.active(player)) {
            if (kinds && !kinds.includes(l.kind)) continue;
            if (claimed.has(`${l.q},${l.r}`)) continue;
            const d = _dist(world, q, r, l.q, l.r);
            if (d > (radius != null ? radius : C.searchRadius)) continue;
            if (!best || d < best.d || (d === best.d && l.id < best.lair.id)) best = { lair: l, d };
        }
        return best ? best.lair : null;
    },

    _live: new Map(),

    /** The band a task spawned, if it still walks the world (rebuilt from world.units after a load). */
    foeUnit(world, key) {
        let u = NpcTasks._live.get(key);
        if (u && world && Array.isArray(world.units) && !world.units.includes(u) && !u.destroyed) u = null;
        if (!u && world && Array.isArray(world.units)) {
            u = world.units.find(x => x && x.questKey === key) || null;
            if (u) NpcTasks._live.set(key, u);
        }
        return u || null;
    },

    /** Put a task's band on the map near (q, r). Rolled in its own seeded stream. */
    spawnFoe(world, foeId, q, r, key, seed, vars = {}, range = null) {
        if (!world || !Array.isArray(world.units)) return null;
        const C = NpcTasks.config();
        const spec = C.foes[foeId] || DEFAULT_FOE;
        const spot = NpcTasks.freeHex(world, q, r, range || C.foeRange, `${seed}|foe`);
        if (!spot) return null;
        const h = _h(`${seed}|band`);
        const leader = vars.leader || _pickH(C.leaders, h);
        const rng = Utils.seededRandom((h % 233279) + 1);
        const unit = Utils.withRng(rng, () => new WorldUnit(spec.type || 'raider', spot.q, spot.r));
        unit.id = `qt_${(h % 1e9).toString(36)}`;
        unit.name = _fill(spec.name || DEFAULT_FOE.name, { leader, town: vars.town || 'the town', place: vars.town || 'the hills' });
        unit.icon = spec.icon || unit.icon;
        unit.strength = _range(spec.strength || DEFAULT_FOE.strength, h >>> 3);
        unit.population = Math.max(1, _range(spec.population || DEFAULT_FOE.population, h >>> 5));
        unit.maxAge = 1e9;
        unit.questKey = key;
        unit.pursuitRange = 3;
        unit.inventory = { gold: 10 + (h % 30) };
        world.units.push(unit);
        NpcTasks._live.set(key, unit);
        return unit;
    },

    /** A town at distance `range` from (q, r) other than the giver's, preferring known rosters; by hash. */
    findTown(world, q, r, opts = {}) {
        const C = NpcTasks.config();
        const [lo, hi] = opts.range || C.townRange;
        const towns = _views(world).filter(s => s && s.q != null && !(s.q === q && s.r === r))
            .map(s => ({ s, d: _dist(world, q, r, s.q, s.r) }))
            .filter(x => x.d >= lo && x.d <= hi);
        if (!towns.length) return null;
        const small = (t) => ['village', 'hamlet'].includes(t.s.type);
        const score = (t) => (t.s.folk ? 0 : 20) + (opts.small && !small(t) ? 10 : 0) + t.d;
        towns.sort((a, b) => score(a) - score(b) || a.s.r - b.s.r || a.s.q - b.s.q);
        const pool = towns.slice(0, 4);
        return pool[_h(`${opts.seed}|town`) % pool.length].s;
    },

    /**
     * Someone in a town to carry to / fetch from: a real townsperson when the
     * town keeps a roster (role-matched), else a named stranger the town will
     * know. → { uid, name, role, real }
     */
    pickPerson(world, town, role, seed, excludeUid = null) {
        const folk = town && town.folk;
        if (folk && Array.isArray(folk.people)) {
            const day = _day(world) || 1;
            const adults = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= 16 && `${folk.q},${folk.r}#${p.id}` !== excludeUid);
            const matched = role && role !== 'any' ? adults.filter(p => p.role === role) : [];
            const pool = matched.length ? matched : adults.filter(p => p.role !== 'child');
            if (pool.length) {
                const p = pool[_h(`${seed}|person`) % pool.length];
                return { uid: `${folk.q},${folk.r}#${p.id}`, name: Townsfolk.name(p), role: Townsfolk.roleTitle(p), real: true };
            }
        }
        const T = Townsfolk.config();
        const h = _h(`${seed}|stranger`);
        const gender = h % 2 ? 'female' : 'male';
        const first = _pickH(T.names[gender] || ['Ada'], h >>> 2);
        const last = _pickH(T.lastNames || ['Millbrook'], h >>> 4);
        const title = role && role !== 'any' ? Townsfolk.title(role, gender) : (gender === 'female' ? 'townswoman' : 'townsman');
        return { uid: null, name: `${role === 'noble' ? (gender === 'female' ? 'Lady ' : 'Lord ') : ''}${first} ${last}`, role: title, real: false };
    },

    /** The giver's own child for a "find my son" task: a son of 8+ from the roster, else one named by hash. */
    pickKid(world, giver, seed) {
        const at = NpcTasks.personByUid(world, giver && giver.uid);
        const day = _day(world) || 1;
        if (at) {
            const kids = (at.person.kids || []).map(id => Townsfolk.get(at.folk, id))
                .filter(k => k && Townsfolk.isHere(k) && Townsfolk.age(k, day) >= 8);
            const sons = kids.filter(k => k.gender === 'male');
            const k = (sons.length ? sons : kids)[0];
            if (k) return { uid: `${at.folk.q},${at.folk.r}#${k.id}`, name: k.first, full: Townsfolk.name(k), gender: k.gender, real: true };
        }
        const T = Townsfolk.config();
        const first = _pickH(T.names.male || ['Tam'], _h(`${seed}|kid`));
        return { uid: null, name: first, full: first, gender: 'male', real: false };
    },

    // ──────────── BUILDING A TASK ────────────

    /**
     * The objectives of an NPC task, made concrete from where the giver lives.
     * @param {object} ctx { player, world, giver, quest id (seed) }
     * @returns {{ objectives, carrying?, person?, alt?, findKind }|null} null when nothing concrete fits
     */
    build(taskId, ctx) {
        const def = NpcTasks.task(taskId);
        const { player, world, giver } = ctx;
        if (!def || !world || !giver || giver.q == null) return null;
        const seed = ctx.seed || taskId;
        const C = NpcTasks.config();
        const vars = { giver: giver.name, town: giver.town || 'town' };
        const objectives = [];
        let person = null;

        if (def.person === 'kid') {
            person = NpcTasks.pickKid(world, giver, seed);
            vars.person = person.name;
        }

        let find = null;
        if (def.deliver || def.fetch) {
            const spec = def.deliver || def.fetch;
            const town = spec.sameTown
                ? _tile(world, giver.q, giver.r) && _tile(world, giver.q, giver.r).settlement
                : NpcTasks.findTown(world, giver.q, giver.r, { seed, small: !!spec.small });
            if (!town) return null;
            const who = NpcTasks.pickPerson(world, town, spec.role, seed, giver.uid);
            vars.person = who.name; vars.role = who.role; vars.target = town.name;
            find = {
                type: 'talk_to', mode: def.deliver ? 'deliver' : 'fetch', uid: who.uid, person: who.name, role: who.role, real: who.real,
                town: town.name, q: town.q, r: town.r, item: def.item || null, reply: spec.reply || null, guarded: !!spec.guarded,
                target: 1, current: 0,
                text: _fill(def.deliver ? def.deliverText : def.fetchText, vars),
            };
        } else {
            for (const opt of def.find || []) {
                const [kind, arg] = String(opt).split(':');
                const args = arg ? arg.split(',') : null;
                if (kind === 'site' || kind === 'newsite') {
                    const site = kind === 'site'
                        ? NpcTasks.findSite(world, player, giver.q, giver.r, args)
                        : NpcTasks.makeSite(world, giver.q, giver.r, (args && args[0]) || 'ruins', seed);
                    if (!site) continue;
                    vars.target = site.name;
                    find = { type: 'site_delved', q: site.q, r: site.r, name: site.name, kind: site.kind, made: !!site.made, target: 1, current: 0, text: _fill((def.findText || {}).site, vars) };
                } else if (kind === 'lair') {
                    const lair = NpcTasks.findLair(player, world, giver.q, giver.r, args);
                    if (!lair) continue;
                    OutlawLairs.reveal(player, lair.id);
                    vars.target = lair.name;
                    find = { type: 'lair_cleared', lairId: lair.id, q: lair.q, r: lair.r, name: lair.name, target: 1, current: 0, text: _fill((def.findText || {}).lair, vars) };
                } else if (kind === 'foe') {
                    const key = `${seed}`;
                    const unit = NpcTasks.spawnFoe(world, args ? args[0] : 'outlaws', giver.q, giver.r, key, seed, { town: giver.town });
                    if (!unit) continue;
                    vars.target = unit.name;
                    find = { type: 'foe_slain', key, foe: args ? args[0] : 'outlaws', name: unit.name, homeQ: unit.q, homeR: unit.r, q: unit.q, r: unit.r, respawns: 0, target: 1, current: 0, text: _fill((def.findText || {}).foe, vars) };
                } else if (kind === 'bring') {
                    const n = Math.max(1, _num(+(args && args[1]), 1));
                    vars.target = `${n} ${args[0]}`;
                    find = { type: 'deliver_item', item: args[0], target: n, current: 0, text: _fill((def.findText || {}).bring, vars) };
                }
                if (find) break;
            }
        }
        if (!find) return null;
        objectives.push(find);
        if (giver.uid) {
            objectives.push({
                type: 'return_to', uid: giver.uid, giver: giver.name, town: giver.town, q: giver.q, r: giver.r,
                target: 1, current: 0, text: _fill(def.returnText, vars),
            });
        }
        let alt = null;
        if (def.alt && giver.uid) {
            alt = { ...def.alt, label: _fill(def.alt.label, { ...vars, gold: def.alt.gold }), text: _fill(def.alt.text, { ...vars, gold: def.alt.gold }), grievance: _fill(def.alt.grievance, vars) };
        }
        return {
            objectives,
            carrying: null,
            item: find.type === 'deliver_item' ? null : (def.item || (person ? person.name : null)),
            person,
            alt,
            vars,
            deadline: _day(world) + _num(C.deadlineDays, 90),
        };
    },

    // ──────────── QUEST-BOARD TARGETS ────────────

    /**
     * Resolve a quest-board objective spec (a template objective with a
     * `fallback`) into a concrete target around the player, or null.
     */
    resolveBoard(spec, player, world, seed) {
        if (!spec || !world || !player || player.q == null) return null;
        const q = player.q, r = player.r;
        const radius = _num(spec.radius, 30);
        const vars = {};
        if (spec.type === 'site_delved') {
            const site = NpcTasks.findSite(world, player, q, r, spec.kinds || null, radius);
            if (!site) return null;
            vars.target = site.name;
            return { type: 'site_delved', q: site.q, r: site.r, name: site.name, kind: site.kind, cleared: !!spec.cleared, target: 1, current: 0, text: _fill(spec.text, vars), resolved: true };
        }
        if (spec.type === 'lair_cleared') {
            const lair = NpcTasks.findLair(player, world, q, r, spec.kinds || null, radius);
            if (!lair) return null;
            OutlawLairs.reveal(player, lair.id);
            vars.target = lair.name;
            return { type: 'lair_cleared', lairId: lair.id, q: lair.q, r: lair.r, name: lair.name, target: 1, current: 0, text: _fill(spec.text, vars), resolved: true };
        }
        if (spec.type === 'foe_slain') {
            const key = `board_${seed}_${_day(world)}`;
            const near = _tile(world, q, r);
            const unit = NpcTasks.spawnFoe(world, spec.foe || 'outlaws', q, r, key, key,
                { town: (near && near.settlement && near.settlement.name) || 'the hills' }, spec.range || null);
            if (!unit) return null;
            vars.target = unit.name;
            return { type: 'foe_slain', key, foe: spec.foe || 'outlaws', name: unit.name, homeQ: unit.q, homeR: unit.r, q: unit.q, r: unit.r, respawns: 0, target: 1, current: 0, text: _fill(spec.text, vars), resolved: true };
        }
        if (spec.type === 'deliver_item' && spec.town) {
            const town = NpcTasks.findTown(world, q, r, { seed, range: spec.townRange || [2, 16] });
            if (!town) return null;
            vars.target = town.name;
            return { type: 'deliver_item', item: spec.item, target: spec.target, current: 0, atQ: town.q, atR: town.r, q: town.q, r: town.r, town: town.name, text: _fill(spec.text, vars), resolved: true };
        }
        if (spec.type === 'visit_towns') {
            const seen = (player.quests && player.quests.settlementsVisited) || new Set();
            const towns = _views(world).filter(s => s && s.q != null && s.name && !seen.has(s.name))
                .map(s => ({ s, d: _dist(world, q, r, s.q, s.r) })).filter(x => x.d > 0)
                .sort((a, b) => a.d - b.d || a.s.r - b.s.r || a.s.q - b.s.q)
                .slice(0, Math.max(1, _num(spec.count, 3)));
            if (towns.length < Math.max(1, _num(spec.count, 3))) return null;
            const list = towns.map(x => ({ name: x.s.name, q: x.s.q, r: x.s.r }));
            vars.target = list.map(t => t.name).join(', ');
            return { type: 'visit_towns', towns: list, target: list.length, current: 0, text: _fill(spec.text, vars), resolved: true };
        }
        return null;
    },

    // ──────────── PROGRESS ────────────

    /**
     * Read a concrete objective's state from the world: { current, failed? }.
     * talk_to / return_to are set by conversation and only read here.
     */
    evaluate(obj, player, world) {
        switch (obj.type) {
            case 'site_delved': {
                const t = _tile(world, obj.q, obj.r);
                const poi = t && t.improvement;
                const done = player && player.delves && Array.isArray(player.delves.completed) && player.delves.completed.includes(`${obj.q},${obj.r}`);
                if (poi && poi.delved) {
                    const ok = obj.cleared ? poi.delved.reason === 'cleared' : _num(poi.delved.depth) >= 1 || poi.delved.reason === 'cleared';
                    if (ok && done) return { current: 1 };
                    return { current: 0, failed: obj.cleared ? `${obj.name} was left before its deepest chamber` : `you turned back at the mouth of ${obj.name}` };
                }
                if (poi && poi.explored && !done) return { current: 0, failed: `${obj.name} was emptied by someone else` };
                if (!poi && !done && world && Array.isArray(world.tiles) && world.tiles.length) return { current: 0, failed: `${obj.name} is gone` };
                return { current: done ? 1 : 0 };
            }
            case 'lair_cleared': {
                const lair = OutlawLairs.find(player, obj.lairId);
                if (!lair) return { current: 0 };
                if (lair.status === 'cleared' && lair.endedBy === 'player') return { current: 1 };
                if (lair.status !== 'active') return { current: 0, failed: `${obj.name} was ${lair.status === 'cleared' ? `burned by ${lair.endedByName || 'others'}` : 'abandoned'} before you got there` };
                return { current: 0 };
            }
            case 'foe_slain': {
                if (obj.current >= 1) return { current: 1 };
                const u = NpcTasks.foeUnit(world, obj.key);
                if (u && u.destroyed && u.slainByPlayer) { NpcTasks._live.delete(obj.key); return { current: 1 }; }
                if (!u || u.destroyed) {
                    // Scattered by someone else (or lost with an old save): they regroup near their old haunt
                    obj.respawns = _num(obj.respawns) + 1;
                    if (obj.respawns > 3) return { current: 0, failed: `${obj.name} scattered to the winds` };
                    if (u) NpcTasks._live.delete(obj.key);
                    const nu = NpcTasks.spawnFoe(world, obj.foe, _num(obj.homeQ, obj.q), _num(obj.homeR, obj.r), obj.key, `${obj.key}|re${obj.respawns}`);
                    if (nu) { nu.name = obj.name; obj.q = nu.q; obj.r = nu.r; }
                    return { current: 0 };
                }
                obj.q = u.q; obj.r = u.r;
                return { current: 0 };
            }
            case 'visit_towns': {
                const seen = (player && player.quests && player.quests.settlementsVisited) || new Set();
                return { current: (obj.towns || []).filter(t => seen.has(t.name)).length };
            }
            default:
                return { current: _num(obj.current) };
        }
    },

    /** Live position of a band target (for the map marker). */
    livePos(world, obj) {
        if (obj.type !== 'foe_slain') return { q: obj.q, r: obj.r };
        const u = NpcTasks.foeUnit(world, obj.key);
        return u && !u.destroyed ? { q: u.q, r: u.r } : { q: obj.q, r: obj.r };
    },

    /** The first objective still to do, and whether everything before it is done. */
    nextObjective(quest) {
        for (const o of quest.objectives || []) if (!(o.current >= o.target)) return o;
        return null;
    },

    /**
     * Where an objective points, for the journal: "Mysterious Cave — 7 hexes
     * north-east". Empty when it points nowhere.
     */
    whereLine(obj, player, world) {
        if (!obj || !player) return '';
        if (obj.type === 'visit_towns') {
            const seen = (player.quests && player.quests.settlementsVisited) || new Set();
            return (obj.towns || []).filter(t => !seen.has(t.name)).map(t => `${t.name} (${NpcTasks.whereText(world, player.q, player.r, t.q, t.r)})`).join(', ');
        }
        const pos = NpcTasks.livePos(world, obj);
        if (pos.q == null) return '';
        const name = obj.type === 'talk_to' || obj.type === 'return_to' || obj.type === 'deliver_item' ? obj.town : obj.name;
        return `${name || 'there'} — ${NpcTasks.whereText(world, player.q, player.r, pos.q, pos.r)}`;
    },

    /** Map markers for every active quest's next target: [{ q, r, icon, label, questId }]. */
    markers(player, world) {
        const out = [];
        for (const quest of (player && player.quests && player.quests.active) || []) {
            const o = NpcTasks.nextObjective(quest);
            if (!o) continue;
            if (o.type === 'visit_towns') {
                const seen = (player.quests.settlementsVisited) || new Set();
                for (const t of o.towns || []) if (!seen.has(t.name)) out.push({ q: t.q, r: t.r, icon: SEARCH_ICON.visit_towns, label: t.name, questId: quest.id });
                continue;
            }
            if (!TARGET_OBJECTIVES.includes(o.type) && !(o.type === 'deliver_item' && o.q != null)) continue;
            const pos = NpcTasks.livePos(world, o);
            if (pos.q == null) continue;
            const label = o.type === 'talk_to' ? o.person : o.type === 'return_to' ? o.giver : (o.name || o.town || quest.title);
            out.push({ q: pos.q, r: pos.r, icon: SEARCH_ICON[o.type] || 'help', label, questId: quest.id, kind: o.type });
        }
        return out;
    },

    // ──────────── CONVERSATION ────────────

    /** Does this inner-map NPC stand for the person an objective names? */
    isPerson(npc, uid, name) {
        if (!npc) return false;
        if (uid) return npc.uid === uid;
        return !!name && (npc.fullName === name || npc.name === name);
    },

    /**
     * What this NPC can do with the player's tasks right now:
     * [{ kind: 'return'|'deliver'|'fetch'|'proxy', quest, obj }].
     * `here` = { q, r } of the town; `present` = uids of the NPCs on the map.
     */
    talkOptions(player, npc, here, present = null) {
        const out = [];
        for (const quest of (player && player.quests && player.quests.active) || []) {
            if (quest.v !== 2) continue;
            const o = NpcTasks.nextObjective(quest);
            if (!o) continue;
            if (o.type === 'return_to' && NpcTasks.isPerson(npc, o.uid, o.giver)) {
                out.push({ kind: 'return', quest, obj: o });
            } else if (o.type === 'talk_to' && here && here.q === o.q && here.r === o.r) {
                if (NpcTasks.isPerson(npc, o.uid, o.person)) out.push({ kind: o.mode, quest, obj: o });
                else if (npc && npc._person && npc.type !== 'child' && !(present && o.uid && present.has(o.uid))) {
                    // The person isn't about (or no one here knows them by sight): a townsperson takes it
                    out.push({ kind: o.mode === 'deliver' ? 'proxy' : 'proxy_fetch', quest, obj: o });
                }
            }
        }
        return out;
    },

    /** Is this NPC waiting on a task the player has not finished? (the giver asks after it) */
    pendingFor(player, npc) {
        for (const quest of (player && player.quests && player.quests.active) || []) {
            if (quest.v !== 2 || !quest.giver) continue;
            if (!NpcTasks.isPerson(npc, quest.giver.uid, quest.giver.name)) continue;
            const o = NpcTasks.nextObjective(quest);
            if (o && o.type !== 'return_to') return quest;
        }
        return null;
    },

    // ──────────── THE TOWNSFOLK REMEMBER ────────────

    /** Record a task on a townsperson's life (their log; their memory of the player). */
    remember(world, uid, kind, text, disposition = 0) {
        const at = NpcTasks.personByUid(world, uid);
        if (!at) return null;
        const p = at.person;
        const day = _day(world) || 1;
        Townsfolk._log(p, day, kind, null, text);
        if (disposition) {
            if (!p.mem) p.mem = { timesSpoken: 0, disposition: 50, lastAction: null, giftsReceived: 0, threatened: false, flattered: false, questOffered: false, rumorsTold: 0, playerTitle: null };
            p.mem.disposition = Math.max(0, Math.min(100, _num(p.mem.disposition, 50) + disposition));
        }
        return p;
    },

    /** A child found (or let go): back home, or away to another town. */
    settleKid(world, person, home, toTown) {
        if (!person || !person.uid) return;
        const at = NpcTasks.personByUid(world, person.uid);
        if (!at) return;
        const kid = at.person;
        const day = _day(world) || 1;
        if (home) {
            kid.away = null;
            Townsfolk._log(kid, day, 'rescued', null, null);
        } else {
            kid.away = { d: day, to: toTown || 'the wider world' };
            Townsfolk._log(kid, day, 'left', null, kid.away.to);
            for (const pid of kid.parents || []) Townsfolk._log(Townsfolk.get(at.folk, pid), day, 'kidLeft', kid.id, kid.away.to);
        }
    },

    /** The missing child is gone from town while the task runs. */
    hideKid(world, person, where) {
        if (!person || !person.uid) return;
        const at = NpcTasks.personByUid(world, person.uid);
        if (at && !at.person.away) at.person.away = { d: _day(world) || 1, to: where || 'the wilds', missing: true };
    },
};
