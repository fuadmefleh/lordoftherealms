// ============================================================
// WILD TASKS — foraging, hunting, fishing, trapping, smuggling, pickpocketing
// ============================================================
// The old minigames of these activities, done in person on the inner map
// instead (ui/innerMapTasks.js runs them as `custom` tasks). Each one ends by
// calling back into the old reward handler, so the economy, the skills and
// the foraging / hunting / seasonal-work rules are unchanged; what the
// player does on the map decides which outcome they get.
//
//   forage      walk to the marked patches; search near cover for the rest
//               (a search finds a hidden patch beside you, or a sign of the
//               nearest one); wits and craft show more patches at the start
//   hunt        follow a trail of sign to the beast, creep up on it (walking
//               inside its alert ring alarms it, the longer you keep walking
//               the faster; standing still calms it), loose when close
//   fish        walk to the water's edge, cast, wait by the line, strike in
//               time when it bites; a few casts and the fish move along
//   trap        paw prints mark the game runs: set snares where you like
//               (on a run, under cover, takes most), then walk round and
//               check them — the catch is what the checked snares hold; a
//               trap line keeps its snares' spots, and tending it empties
//               only the snares you reach
//   iceFish     cut a hole in the ice (near the bank or out on thin ice)
//               and land the fish that bite
//   smuggle     carry the goods to the fence's door past the watch on its
//               rounds; inside a watchman's sight ring suspicion climbs
//   pickpocket  get beside the mark and hold still to lift the purse; when
//               they turn round, be out of their notice ring
//
// Rules and settings: systems/wildTasks.js, data/wildTasks.json.

import { InnerMap } from '../../world/innerMap.js';
import { CustomObjects } from '../../world/customObjects.js';
import { InnerMapTasks } from '../innerMapTasks.js';
import { MapTasks } from '../../systems/mapTasks.js';
import { WildTasks as Rules } from '../../systems/wildTasks.js';
import { Foraging, Hunting } from '../../player/foraging.js';
import { drawMapMarker } from '../mapInk.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _me = () => ({ q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR });
const _walking = () => !!InnerMap._playerWalking;
const fmt = (s, v) => Rules.fmt(s, v);
const _between = (rng, pair, d = 1) => (Array.isArray(pair) ? pair[0] + rng() * (pair[1] - pair[0]) : _num(pair, d));
const _int = (rng, pair, d = 1) => (Array.isArray(pair) ? pair[0] + Math.floor(rng() * (pair[1] - pair[0] + 1)) : _num(pair, d));
let _seq = 0;
/** "2 pelts, 1 meat" */
const _what = (items) => Object.entries(items || {}).filter(([, q]) => q > 0).map(([id, q]) => `${q} ${id.replace(/_/g, ' ')}`).join(', ');

/** The wild places of the current map (computed once per task). */
function _wild(ctx) {
    if (!ctx._wild) {
        ctx._wild = Rules.spots({ tiles: InnerMap.tiles, width: InnerMap.width, height: InnerMap.height }, (id) => {
            const d = CustomObjects.getDef ? CustomObjects.getDef(id) : null;
            return d ? d.objectType : null;
        });
    }
    return ctx._wild;
}

/** Where the water is when the map shows none: its edge toward `dir` ({x, y}). */
function _edgeToward(ctx, dir) {
    const W = InnerMap.width, H = InnerMap.height;
    const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
    const len = Math.hypot(dir.x, dir.y) || 1;
    const out = [];
    for (let side = -6; side <= 6; side += 3) {
        for (let k = Math.floor(Math.min(W, H) / 2) - 3; k > 4; k--) {
            const q = Math.round(cq + (dir.x / len) * k - (dir.y / len) * side);
            const r = Math.round(cr + (dir.y / len) * k + (dir.x / len) * side);
            if (ctx.spots.passable(q, r)) { out.push({ q, r }); break; }
        }
    }
    return out;
}

function _ring(ctx2d, camera, T, q, r, tiles, stroke, fill) {
    const s = camera.worldToScreen(q * T + T / 2, r * T + T / 2);
    const rad = tiles * T * camera.zoom;
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.ellipse(s.x, s.y, rad, rad, 0, 0, Math.PI * 2);
    if (fill) { ctx2d.fillStyle = fill; ctx2d.fill(); }
    ctx2d.strokeStyle = stroke; ctx2d.lineWidth = 3; ctx2d.setLineDash([8, 5]);
    ctx2d.stroke();
    ctx2d.restore();
}

function _arc(ctx2d, camera, T, q, r, frac, color) {
    const s = camera.worldToScreen(q * T + T / 2, r * T + T / 2);
    const ds = T * camera.zoom;
    ctx2d.save();
    ctx2d.strokeStyle = color; ctx2d.lineWidth = Math.max(3, ds * 0.08);
    ctx2d.beginPath();
    ctx2d.ellipse(s.x, s.y + ds * 0.25, ds * 0.45, ds * 0.2, 0, -Math.PI / 2, -Math.PI / 2 + Math.min(1, frac) * Math.PI * 2);
    ctx2d.stroke();
    ctx2d.restore();
}

/** Send a task's own NPC off the map (or drop it). */
function _release(npc) {
    if (!npc) return;
    npc._wildTask = false;
    const edge = InnerMap._findNearestEdgeTile ? InnerMap._findNearestEdgeTile(npc.q, npc.r) : null;
    const path = edge && InnerMap._findPath ? InnerMap._findPath(npc.q, npc.r, edge.q, edge.r) : null;
    if (path && path.length > 1) { npc.path = path.slice(1); npc.pathIndex = 0; npc.departing = true; npc.state = 'walking'; }
    else { const i = (InnerMap.npcs || []).indexOf(npc); if (i >= 0) InnerMap.npcs.splice(i, 1); }
}

/** A task NPC of a type, standing at `at`. */
function _spawnNpc(type, at, rng, name) {
    const npc = InnerMap._makeNpc ? InnerMap._makeNpc(type, 95000 + (++_seq), rng) : null;
    if (!npc) return null;
    Object.assign(npc, { q: at.q, r: at.r, targetQ: at.q, targetR: at.r, prevQ: at.q, prevR: at.r, path: null, state: 'idle', idleTimer: 1e9, _wildTask: true });
    if (name) npc.name = name;
    InnerMap.npcs.push(npc);
    return npc;
}

// ──────────────────────────────────────────────
// A line in the water: wait by it, strike when it bites
// ──────────────────────────────────────────────

/**
 * Put a line in at `spot`. `onBite(struck)` gets true (struck in time),
 * false (too slow) or null (nothing bit); `onLeave()` when you walk off.
 */
// Open water a float can sit on (not the wet, walkable shore at its edge)
const _isWater = (t) => !!(t && (t._sea || (t.subTerrain && /water/.test(t.subTerrain.id || '')) || (t._wet && t.subTerrain && !t.subTerrain.passable)));
// Any water you might choose to fish (Fish Here is offered on the wet shore too)
const _isWet = (t) => !!(t && (t._wet || _isWater(t)));
/** How far out a line is cast (tiles). */
const CAST_REACH = 3;

/** The water tile nearest a point (within 4), or null. */
function _nearestWater(me) {
    let best = Infinity, at = null;
    for (let dr = -4; dr <= 4; dr++) {
        for (let dq = -4; dq <= 4; dq++) {
            if (!_isWater(InnerMap.getTile(me.q + dq, me.r + dr))) continue;
            const d = Math.abs(dq) + Math.abs(dr);
            if (d && d < best) { best = d; at = { q: me.q + dq, r: me.r + dr }; }
        }
    }
    return at;
}

/**
 * Where the float lands: the water you chose (Fish Here on that tile) when
 * it is within a cast, else out past the nearest water, one to CAST_REACH
 * tiles from the bank, as far as the water goes that way.
 */
function _castTo(ctx) {
    const me = _me();
    const t = ctx.castTarget;
    if (t && Math.max(Math.abs(t.q - me.q), Math.abs(t.r - me.r)) <= CAST_REACH && _isWet(InnerMap.getTile(t.q, t.r))) return { q: t.q, r: t.r };
    const w = _nearestWater(me);
    if (!w) return null;
    const dq = Math.sign(w.q - me.q), dr = Math.sign(w.r - me.r);
    const want = 1 + Math.floor(ctx.rng() * CAST_REACH);
    let to = w;
    for (let k = 1; k <= CAST_REACH; k++) {
        const n = { q: me.q + dq * k, r: me.r + dr * k };
        if (k > want || !_isWater(InnerMap.getTile(n.q, n.r))) { if (k > 1) break; continue; }
        to = n;
    }
    return to;
}

/**
 * The rod in the player's hands while they fish (drawn by ui/innerMapLayers/entities.js
 * from assets/lpc/Tools/fishing_pole_cast_128.png): frame 0 raised, 1 the cast,
 * 3 the line out (the rod alone: the line is drawn from its tip out to the float,
 * where the cast landed, and a bite pulls the float under). Faces the water cast into.
 */
function _rodPose(ctx, dt) {
    ctx.rodT = (ctx.rodT || 0) + dt;
    const L = ctx.line;
    const castMark = ctx.marks.find(m => m.cast && m.held > 0);
    let frame = 0;
    if (L) frame = L.to ? 3 : 2;
    else if (castMark) frame = castMark.held / Math.max(0.1, _num(castMark.work, 1)) < 0.5 ? 0 : 1;
    const me = _me();
    const key = `${me.q},${me.r}`;
    if (ctx.rodFrom !== key) {
        ctx.rodFrom = key;
        const t = ctx.castTarget;
        ctx.rodToward = t && Math.max(Math.abs(t.q - me.q), Math.abs(t.r - me.r)) <= CAST_REACH ? t : _nearestWater(me);
    }
    const toward = (L && L.to) || ctx.rodToward;
    const bobber = L && L.to ? { q: L.to.q, r: L.to.r, bite: L.state === 'bite' } : null;
    InnerMap._rod = { frame, toward, bobber, at: Date.now() };
}

function _castLine(ctx, spot, luck, onBite, onLeave) {
    const c = Rules.cfg('fish');
    const mark = ctx.mark(spot, { glyph: c.glyph || 'fish', label: c.waiting, passive: true, line: true });
    ctx.line = { spot, to: _castTo(ctx), mark, state: 'wait', t: _between(ctx.rng, c.wait || [1.5, 4], 2.5), luck, onBite, onLeave };
}

function _endLine(ctx) {
    const L = ctx.line;
    ctx.line = null;
    if (L) ctx.marks = ctx.marks.filter(m => m !== L.mark);
    return L;
}

function _lineTick(ctx, dt) {
    const L = ctx.line;
    if (!L) return;
    const c = Rules.cfg('fish');
    if (Rules.dist(_me(), L.spot) > 1) {
        _endLine(ctx);
        ctx.note(c.left);
        if (L.onLeave) L.onLeave();
        return;
    }
    L.t -= dt;
    if (L.t > 0) return;
    if (L.state === 'wait') {
        if (ctx.rng() < Rules.biteChance(L.luck, c)) {
            L.state = 'bite';
            L.t = Rules.strikeWindow(L.luck, c);
            L.mark.glyph = c.biteGlyph || 'warning';
            L.mark.label = c.bite;
            ctx.note(c.bite);
        } else {
            _endLine(ctx);
            ctx.note(c.quiet);
            L.onBite(null);
        }
    } else if (L.state === 'bite') {
        _endLine(ctx);
        ctx.note(c.late);
        L.onBite(false);
    }
}

function _lineButtons(ctx) {
    const L = ctx.line;
    if (!L || L.state !== 'bite') return [];
    return [{ label: Rules.cfg('fish').strike, hot: true, act: () => { if (ctx.line === L) { _endLine(ctx); L.onBite(true); } } }];
}

// ──────────────────────────────────────────────
// The tasks
// ──────────────────────────────────────────────

export const WildTaskRunner = {
    /** Can this game put the player on the inner map? (a headless game can't) */
    inWorld(game) {
        return !!(game && (typeof game.enterInnerMap === 'function' || InnerMap.active));
    },

    /**
     * Go yourself, or the quick plain result.
     * o: { title, icon, description, baseText, onGo, onQuick }
     */
    choose(game, o) {
        const p = Rules.data().prompt || {};
        const btn = (id, icon, label, hint, gold) => `<button onclick="window.${id}()"
            style="flex:1;padding:14px 10px;border-radius:10px;cursor:pointer;text-align:center;color:var(--text-primary);
                   background:${gold ? 'rgba(46,204,113,0.1)' : 'rgba(255,255,255,0.04)'};border:${gold ? '2px solid #2ecc71' : '1px solid rgba(255,255,255,0.12)'};">
            <div style="font-size:22px;margin-bottom:4px">${icon}</div>
            <div style="font-weight:bold;font-size:14px;color:${gold ? '#2ecc71' : 'var(--text-secondary)'}">${label}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:4px">${hint}</div></button>`;
        let html = `<div style="text-align:center;"><div style="font-size:44px;margin:10px 0">${o.icon}</div>
            <h4 style="margin:0 0 6px">${o.title}</h4>
            ${o.description ? `<p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px">${o.description}</p>` : ''}
            <div style="display:flex;gap:12px;margin-bottom:12px">
                ${btn('_wildGo', '🚶', p.inPerson || 'Go yourself', p.inPersonHint || '', true)}
                ${btn('_wildQuick', '⏭️', p.quick || 'Quick', p.quickHint || '', false)}
            </div>`;
        if (o.baseText) html += `<div style="padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:11px;color:var(--text-muted)"><span style="color:var(--text-secondary)">${p.base || 'Plain result'}:</span> ${o.baseText}</div>`;
        html += `<button data-am-act="closePanel" style="margin-top:8px;padding:6px 16px;background:none;border:1px solid rgba(255,255,255,0.08);border-radius:6px;cursor:pointer;color:var(--text-muted);font-size:11px">Cancel</button></div>`;
        game.ui.showCustomPanel(o.title, html);
        window._wildGo = () => { window._wildGo = null; o.onGo(); };
        window._wildQuick = () => { window._wildQuick = null; o.onQuick(); };
    },

    /** Get onto the inner map and start the task; `fallback()` if it can't be done there. */
    async run(game, spec, fallback) {
        let started = false;
        await InnerMapTasks.ensureStreet(game, () => { started = InnerMapTasks.start(game, spec); });
        if (!started && fallback) fallback();
    },

    // ── Foraging ──

    /**
     * o: { player, table }. onDone(found [{ entry, qty }]) when the searches
     * are spent, you call it a day, or give up (you keep what you picked).
     */
    forage(game, o, onDone) {
        const c = Rules.cfg('forage');
        const player = o.player;
        const found = [];
        const custom = {
            setup(ctx) {
                const w = _wild(ctx);
                const me = _me();
                let cands = [].concat(w.plants, w.trees, w.rocks, w.shore, w.open.filter((p, i) => i % 3 === 0));
                cands = Rules.near(cands, me, _num(c.radius, 22), 30).filter(p => Rules.dist(p, me) >= 2);
                const sites = MapTasks.pickSpread(cands, _num(c.sites, 16), ctx.rng, _num(c.minGap, 4));
                ctx.patches = [];
                // Every site is a patch searched in the old field: most hold nothing
                for (const s of sites) {
                    const entry = Foraging.rollFind(o.table, player);
                    if (entry) ctx.patches.push({ q: s.q, r: s.r, entry });
                }
                ctx.left = Foraging.searches(player);
                ctx.total = ctx.left;
                ctx.hint = _num(c.hintRadius, 5) + Foraging.skill(player).level;
                const seen = Rules.patchesSeen(player.intelligence, Foraging.skill(player).level);
                ctx.patches.slice(0, seen).forEach(p => this._reveal(ctx, p));
            },
            _reveal(ctx, p) {
                p.shown = true;
                ctx.mark(p, { glyph: c.glyph || 'wheat', label: fmt(c.pick, { name: p.entry.name }), work: _num(c.pickSeconds, 1.8), patch: p, onDone: () => this._take(ctx, p) });
            },
            _take(ctx, p) {
                p.found = true;
                ctx.left--;
                ctx.done++;
                const qty = Foraging.rollQty(p.entry, player);
                found.push({ entry: p.entry, qty });
                ctx.note(fmt(c.found, { icon: p.entry.icon || '🌿', name: p.entry.name, qty }));
                if (ctx.left <= 0) ctx.finish();
            },
            _search(ctx) {
                if (ctx.searching || ctx.left <= 0) return;
                const at = _me();
                ctx.searching = ctx.mark(at, { glyph: c.searchGlyph || 'magnifier', label: c.searching, work: _num(c.searchSeconds, 1.6), onDone: () => {
                    ctx.searching = null;
                    const res = Rules.search(at, ctx.patches.filter(p => !p.shown), ctx.hint);
                    if (res.hit) {
                        res.hit.shown = true;
                        this._take(ctx, res.hit);
                        return;
                    }
                    ctx.left--;
                    if (res.near) {
                        this._reveal(ctx, res.near);
                        ctx.note(fmt(c.nearby, { dir: res.dir }));
                    } else {
                        ctx.note(c.nothing);
                    }
                    if (ctx.left <= 0) ctx.finish();
                } });
            },
            tick(dt, ctx) {
                // Walked off mid-search: it never happened
                if (ctx.searching && Rules.dist(ctx.searching, _me()) > 1) {
                    ctx.marks = ctx.marks.filter(m => m !== ctx.searching);
                    ctx.searching = null;
                }
            },
            buttons(ctx) {
                return [
                    { label: c.search, act: () => this._search(ctx) },
                    { label: c.done, act: () => ctx.finish() },
                ];
            },
            status(ctx) { return fmt(c.status, { left: ctx.left, finds: found.length }); },
        };
        return this.run(game, {
            title: c.title, icon: c.icon, say: c.say, plan: { parHours: c.parHours }, custom,
            onComplete: () => onDone(found),
            onAbandon: () => onDone(found),
        }, () => onDone(null));
    },

    // ── Hunting ──

    /** The beast a hunt follows, by the name of its loot (data: hunt.beasts). */
    beastName(prey) {
        const n = (prey && prey.name) || 'quarry';
        return (Rules.cfg('hunt').beasts || {})[n] || n.toLowerCase();
    },

    /**
     * o: { player, prey, animal? }. onDone(outcome): { result: 'shot', accuracy, dist }
     * | { result: 'fled' } | { result: 'abandoned' }, each with `animal` — the
     * living beast hunted (InnerMap.animals) when there was one: a deer the
     * player picked out (o.animal: no trail, straight to the stalk), the
     * nearest of the beast's kind grazing on the map (the trail leads to it),
     * or one put on the map for the hunt (its walk sheet in place of a paw
     * token: data/animals.json huntBeasts). onDone(null): couldn't start.
     */
    hunt(game, o, onDone) {
        const c = Rules.cfg('hunt');
        const player = o.player;
        const name = o.animal ? this.animalName(o.animal) : this.beastName(o.prey);
        const stealth = (player.skills && player.skills.stealth) || 1;
        const rank = Hunting.skill(player).level;
        const reads = Array.isArray(c.read) && c.read.length ? c.read : ['Fresh tracks.'];
        const species = o.animal ? o.animal.species : ((InnerMap.animalConfig ? InnerMap.animalConfig().huntBeasts : null) || {})[name] || null;
        let target = o.animal || null;
        let beast = null; // the animal on the map the stalk is of (target, or one put there for the hunt)
        let outcome = null;
        const custom = {
            setup(ctx) {
                const me = _me();
                ctx.radius = Rules.alertRadius(stealth, rank, c);
                ctx.st = { alert: 0, pace: 0 };
                ctx.bolts = 0;
                // A deer picked out where it grazes: straight to the stalk
                if (target) {
                    target.hunted = true;
                    ctx.home = { q: target.q, r: target.r };
                    ctx.trail = [ctx.home];
                    ctx.total = 1;
                    ctx.ti = 0;
                    this._sight(ctx);
                    return;
                }
                // One of its kind grazing on this map: the sign leads to it (it holds its ground while you track)
                target = species && InnerMap.nearestAnimal ? InnerMap.nearestAnimal(species, me, 48) : null;
                if (target) target.hunted = true;
                const w = _wild(ctx);
                const pool = [].concat(w.open, w.plants, w.trees);
                const [lo, hi] = c.trackTo || [18, 26];
                const ring = pool.filter(p => { const d = Rules.dist(p, me); return d >= lo && d <= hi; });
                const home = target ? { q: target.q, r: target.r } : ring.length ? ring[Math.floor(ctx.rng() * ring.length)]
                    : Rules.near(pool, me, hi, 1).sort((a, b) => Rules.dist(b, me) - Rules.dist(a, me))[0] || me;
                ctx.home = { q: home.q, r: home.r };
                // The sign runs out where the beast comes in sight, outside its alert ring
                const signs = Rules.trail(me, ctx.home, _int(ctx.rng, c.trackMarks, 6), ctx.rng, (q, r) => ctx.spots.passable(q, r));
                const before = signs.filter(p => Rules.dist(p, ctx.home) > ctx.radius + _num(c.sightMargin, 3));
                ctx.trail = (before.length ? before : signs.slice(0, 1)).concat([ctx.home]);
                ctx.total = Math.max(1, ctx.trail.length - 1);
                ctx.ti = 0;
                ctx.phase = 'track';
                this._nextSign(ctx);
            },
            _nextSign(ctx) {
                ctx.marks = ctx.marks.filter(m => !m.sign);
                if (ctx.ti >= ctx.trail.length - 1) { this._sight(ctx); return; }
                ctx.mark(ctx.trail[ctx.ti], { glyph: c.trackGlyph || 'paw', label: c.track, work: _num(c.readSeconds, 0.7), sign: true, onDone: () => {
                    ctx.done++;
                    ctx.note(reads[Math.floor(ctx.rng() * reads.length)]);
                    ctx.ti++;
                    this._nextSign(ctx);
                } });
                // A tracker reads the sign further ahead
                const ahead = ctx.trail[ctx.ti + 1];
                if (rank >= 1 && ahead && ctx.ti + 1 < ctx.trail.length - 1) ctx.mark(ahead, { glyph: c.trackGlyph || 'paw', label: c.track, passive: true, sign: true });
            },
            _sight(ctx) {
                ctx.phase = 'stalk';
                // The beast itself, drawn from its walk sheet where it has one
                ctx.animal = target || (species && InnerMap.addTaskAnimal ? InnerMap.addTaskAnimal(species, ctx.home.q, ctx.home.r) : null);
                beast = ctx.animal;
                if (target) ctx.home = { q: target.q, r: target.r };
                ctx.beast = ctx.addMover({ q: ctx.home.q, r: ctx.home.r, glyph: c.glyph || 'paw', kind: 'prey', animal: ctx.animal });
                ctx.track(ctx.beast, fmt(c.stalk, { name }));
                ctx.note(fmt(c.sighted, { name }));
            },
            tick(dt, ctx) {
                const b = ctx.beast;
                if (!b) return;
                this._move(dt, ctx);
                if (ctx.animal && b.animal) InnerMap.moveHuntedAnimal(ctx.animal, b.q, b.r, b.fq, b.fr, dt, ctx.phase === 'bolting');
            },
            _move(dt, ctx) {
                const b = ctx.beast;
                const me = _me();
                if (ctx.phase === 'bolting') {
                    ctx.boltT -= dt;
                    ctx.fleeFrom(b, me, dt, 0.15);
                    if (ctx.boltT <= 0) {
                        ctx.phase = 'stalk';
                        ctx.home = { q: b.q, r: b.r };
                        ctx.st = { alert: 0.3, pace: 0 };
                    }
                    return;
                }
                if (ctx.phase !== 'stalk') return;
                const d = Rules.dist(b, me);
                ctx.st = Rules.stalkStep(ctx.st, { dist: d, radius: ctx.radius, walking: _walking(), dt }, c);
                if (ctx.st.bolt) {
                    ctx.bolts++;
                    if (ctx.bolts > _num(c.bolts, 1)) {
                        outcome = { result: 'fled', animal: ctx.animal };
                        ctx.note(fmt(c.gone, { name }));
                        b.hidden = true;
                        if (ctx.animal && ctx.animal.temporary) InnerMap.removeAnimal(ctx.animal);
                        b.animal = null;
                        ctx.finish();
                        return;
                    }
                    ctx.phase = 'bolting';
                    ctx.boltT = _num(c.boltSeconds, 3);
                    ctx.note(fmt(c.bolted, { name }));
                    return;
                }
                ctx.wander(b, dt, 2.5, ctx.home, 3);
            },
            _shoot(ctx) {
                const d = Rules.dist(ctx.beast, _me());
                outcome = { result: 'shot', accuracy: Rules.shotAccuracy(d, ctx.st.alert, ctx.rng()), dist: d, animal: ctx.animal };
                ctx.done = ctx.total;
                ctx.finish();
            },
            buttons(ctx) {
                if (ctx.phase !== 'stalk' || !ctx.beast || _walking()) return [];
                if (Rules.dist(ctx.beast, _me()) > _num(c.shootRange, 4)) return [];
                return [{ label: c.shoot, hot: true, act: () => this._shoot(ctx) }];
            },
            draw(ctx2d, camera, ctx, T) {
                if (!ctx.beast || ctx.beast.hidden || (ctx.phase !== 'stalk' && ctx.phase !== 'bolting')) return;
                const lvl = Rules.alertLevel(ctx.st.alert);
                const col = ['rgba(93,219,106,0.75)', 'rgba(243,190,60,0.85)', 'rgba(231,76,60,0.9)'][lvl];
                const fill = ['rgba(93,219,106,0.06)', 'rgba(243,190,60,0.08)', 'rgba(231,76,60,0.1)'][lvl];
                _ring(ctx2d, camera, T, ctx.beast.fq, ctx.beast.fr, ctx.radius, col, fill);
                if (ctx.st.alert > 0.02) _arc(ctx2d, camera, T, ctx.beast.fq, ctx.beast.fr, ctx.st.alert, col);
            },
            status(ctx) {
                if (ctx.phase === 'track') return `${ctx.done}/${ctx.total}`;
                const states = c.states || ['Calm', 'Wary', 'Alarmed'];
                return fmt(c.status, { name, state: states[Rules.alertLevel(ctx.st.alert)], dist: ctx.beast ? Rules.dist(ctx.beast, _me()) : '?' });
            },
        };
        return this.run(game, {
            title: `${c.title} — ${name}`, icon: c.icon, say: fmt(c.say, { name }), plan: { parHours: c.parHours }, custom,
            onComplete: () => onDone(outcome || { result: 'fled', animal: beast || target }),
            onAbandon: () => onDone({ result: 'abandoned', animal: beast || target }),
        }, () => { if (target && InnerMap.releaseAnimal) InnerMap.releaseAnimal(target); onDone(null); });
    },

    /** A living animal's name for the hunt ('stag', 'doe'). */
    animalName(animal) {
        const sp = InnerMap.animalSpecies ? InnerMap.animalSpecies(animal.species) : null;
        return String((sp && sp.name) || animal.species || 'quarry').toLowerCase();
    },

    // ── Fishing ──

    /**
     * o: { player, casts, rollFish() → fish, waterDir? {x, y}, spots?, target? {q, r} (the water to cast into) }.
     * onDone(catches) at the end (or on giving up, with what you have);
     * onDone(null) when it couldn't start.
     */
    fish(game, o, onDone) {
        const c = Rules.cfg('fish');
        const player = o.player;
        const luck = _num(player.luck, 5);
        const str = _num(player.strength, 5);
        const catches = [];
        const custom = {
            setup(ctx) {
                const w = _wild(ctx);
                const me = _me();
                // (Fish Here on the town map: the bank by the water picked)
                let water = Array.isArray(o.spots) && o.spots.length ? o.spots.slice() : Rules.near(w.shore, me, _num(c.radius, 26), 0);
                if (!water.length) water = Rules.near(w.ice, me, _num(c.radius, 26), 0);
                if (!water.length && o.waterDir) water = _edgeToward(ctx, o.waterDir);
                if (!water.length) water = Rules.near(w.shore.concat(w.ice), me, 999, 6);
                if (!water.length) water = Rules.near(w.open, me, 12, 4);
                ctx.fishSpots = MapTasks.pickSpread(water, Math.max(1, _num(c.spots, 2)), ctx.rng, 6);
                // The water you chose to fish (Fish Here): the float lands there
                ctx.castTarget = o.target ? { q: o.target.q, r: o.target.r } : null;
                ctx.total = Math.max(1, _num(o.casts, 3));
                ctx.si = 0;
                ctx.here = 0;
                this._markSpot(ctx);
            },
            _markSpot(ctx) {
                ctx.marks = ctx.marks.filter(m => !m.cast);
                if (ctx.done >= ctx.total) { ctx.finish(); return; }
                const spot = ctx.fishSpots[ctx.si % ctx.fishSpots.length];
                ctx.mark(spot, { glyph: c.glyph || 'fish', label: c.cast, work: _num(c.castSeconds, 1), cast: true, onDone: () => this._cast(ctx, spot) });
            },
            _cast(ctx, spot) {
                _castLine(ctx, spot, luck, (bite) => {
                    ctx.done++;
                    ctx.here++;
                    if (bite === true) {
                        const f = o.rollFish();
                        if (f.rarity === 'junk' || ctx.rng() < Rules.landChance(f.fight, str)) {
                            catches.push(f);
                            ctx.note(fmt(c.caught, { icon: f.icon, name: f.label }));
                        } else {
                            ctx.note(fmt(c.snapped, { name: f.label }));
                        }
                    }
                    if (ctx.here >= _num(c.castsPerSpot, 2) && ctx.fishSpots.length > 1 && ctx.done < ctx.total) {
                        ctx.si++;
                        ctx.here = 0;
                        ctx.note(c.shy);
                    }
                    this._markSpot(ctx);
                }, () => this._markSpot(ctx));
            },
            tick(dt, ctx) { _lineTick(ctx, dt); _rodPose(ctx, dt); },
            buttons(ctx) { return _lineButtons(ctx); },
            status(ctx) { return fmt(c.status, { done: ctx.done, total: ctx.total, catch: catches.length }); },
        };
        return this.run(game, {
            title: c.title, icon: c.icon, say: c.say, plan: { parHours: c.parHours }, custom,
            onComplete: () => { InnerMap._rod = null; onDone(catches); },
            onAbandon: () => { InnerMap._rod = null; onDone(catches); },
        }, () => onDone(null));
    },

    // ── Winter: trapping ──

    /**
     * o: { mode: 'run' | 'set' | 'collect' | 'reset' | 'pull', line?, player? }.
     *   run       paw prints mark the game runs: set snares where you choose
     *             (on a run, under cover is best), then walk round and check
     *             them; each snare checked is rolled for its spot
     *   set       set the snares of a trap line the same way (their spots and
     *             quality go on the line and shape what it takes each day)
     *   collect / reset / pull   walk the line: only the snares you reach
     *             are emptied (their share of what the line holds)
     * onDone({ spots, caught, prize, checked }) when the walk is done;
     * onAbandon() on giving up.
     */
    trap(game, o, onDone, onAbandon) {
        const c = Rules.cfg('trap');
        const mode = o.mode || 'run';
        const player = o.player || (game && game.player) || {};
        const luck = _num(player.luck, 5);
        const skill = Math.min(2, Math.floor(_num(player.skills && player.skills.combat) / 4));
        const tend = ['collect', 'reset', 'pull'].includes(mode);
        const snares = [];
        const caught = {};
        const checked = [];
        let prize = false;
        let shares = [];
        const custom = {
            setup(ctx) {
                const w = _wild(ctx);
                const me = _me();
                ctx.cover = [].concat(w.plants, w.trees, w.rocks);
                if (tend) {
                    const line = o.line || {};
                    const laid = line.snares || [];
                    const keep = laid.filter(p => ctx.spots.passable(p.q, p.r));
                    if (keep.length && keep.length === laid.length) {
                        keep.forEach(p => snares.push({ q: p.q, r: p.r, quality: p.quality }));
                    } else {
                        const pool = Rules.near([].concat(ctx.cover, w.open.filter((p, i) => i % 4 === 0)), me, _num(c.radius, 20), 20)
                            .filter(p => Rules.dist(p, me) >= 3);
                        MapTasks.pickSpread(pool, laid.length || _int(ctx.rng, c.lineRuns, 4), ctx.rng, 6)
                            .forEach((p, i) => snares.push({ q: p.q, r: p.r, quality: laid[i] ? laid[i].quality : undefined }));
                    }
                    if (!snares.length) snares.push({ q: me.q, r: me.r });
                    // What each snare holds of the line's catch (the same sharing tendTrapLine uses)
                    shares = Rules.spreadCatch(line.catch || {}, snares);
                    ctx.total = snares.length;
                    ctx.phase = 'tend';
                    this._lay(ctx);
                    return;
                }
                // The game runs: trails of sign between patches of cover
                const runs = [];
                const anchors = Rules.near(ctx.cover.length >= 4 ? ctx.cover : ctx.cover.concat(w.open), me, _num(c.radius, 20), 12)
                    .filter(p => Rules.dist(p, me) >= 3);
                const pass = (q, r) => ctx.spots.passable(q, r);
                const nLines = _int(ctx.rng, c.runLines, 2);
                for (let i = 0; i < nLines && anchors.length >= 2; i++) {
                    const ends = MapTasks.pickSpread(anchors, 2, ctx.rng, 6);
                    if (ends.length < 2) break;
                    for (const p of Rules.trail(ends[0], ends[1], _int(ctx.rng, c.runSigns, 5), ctx.rng, pass)) {
                        if (!runs.some(x => x.q === p.q && x.r === p.r)) runs.push(p);
                    }
                }
                if (!runs.length) runs.push(...MapTasks.pickSpread(anchors.length ? anchors : [me], 4, ctx.rng, 3));
                ctx.runs = runs;
                // Sign to walk to (arrows lead there); once seen it stays on the ground
                runs.forEach(p => ctx.mark(p, { glyph: c.glyph || 'paw', label: c.runSign, work: 0.3, run: true,
                    onDone: () => ctx.mark(p, { glyph: c.glyph || 'paw', label: c.runSign, passive: true, run: true }) }));
                ctx.want = Math.max(1, _int(ctx.rng, mode === 'run' ? c.runs : c.lineRuns, 4));
                ctx.total = ctx.want * (mode === 'run' ? 2 : 1);
                ctx.phase = 'set';
            },
            /** Set a snare where you stand. */
            _set(ctx) {
                if (ctx.phase !== 'set' || ctx.setting || snares.length >= ctx.want) return;
                const at = _me();
                if (snares.some(s => Rules.dist(s, at) <= _num(c.snareGap, 1))) { ctx.note(c.tooClose); return; }
                ctx.setting = ctx.mark(at, { glyph: c.snareGlyph || 'target', label: c.setting, work: _num(c.setSeconds, 2.2), onDone: () => {
                    ctx.setting = null;
                    const quality = Rules.snareQuality(at, ctx.runs, ctx.cover, c);
                    const s = { q: at.q, r: at.r, quality };
                    s.mark = ctx.mark(at, { glyph: c.snareGlyph || 'target', label: c.set, passive: true });
                    snares.push(s);
                    ctx.done++;
                    ctx.note((c.setNote || {})[Rules.snareGrade(quality)] || '');
                    if (snares.length >= ctx.want) this._setDone(ctx);
                } });
            },
            _setDone(ctx) {
                if (ctx.phase !== 'set' || !snares.length) return;
                if (mode !== 'run') { ctx.finish(); return; }
                ctx.phase = 'check';
                ctx.total = snares.length * 2;
                ctx.note(c.allSet);
                ctx.marks = ctx.marks.filter(m => !snares.some(s => s.mark === m) && !(m.run && !m.passive));
                this._lay(ctx);
            },
            _lay(ctx) {
                const label = ctx.phase === 'tend' ? (c.tend || {})[mode] || c.check : c.check;
                const secs = ctx.phase === 'tend' ? (mode === 'reset' ? c.resetSeconds : c.checkSeconds) : c.checkSeconds;
                snares.forEach((s, i) => {
                    ctx.mark(s, { glyph: c.snareGlyph || 'target', label, work: _num(secs, 1), onDone: () => {
                        ctx.done++;
                        checked.push(i);
                        const got = ctx.phase === 'tend' ? (shares[i] || {}) : this._roll(ctx, s);
                        let say = Object.keys(got).length ? fmt(c.caught, { what: _what(got) }) : c.empty;
                        if (ctx.phase !== 'tend' && got.pelts >= 4) say += ` ${c.prize}`;
                        ctx.note(say);
                        if (checked.length >= snares.length) ctx.finish();
                    } });
                });
            },
            _roll(ctx, s) {
                const r = Rules.snareCatch(s.quality, ctx.rng, { luck, skill }, c);
                for (const [id, q] of Object.entries(r.items)) caught[id] = (caught[id] || 0) + q;
                if (r.prize) prize = true;
                return r.items;
            },
            tick(dt, ctx) {
                // Walked off mid-setting: it never happened
                if (ctx.setting && Rules.dist(ctx.setting, _me()) > 1) {
                    ctx.marks = ctx.marks.filter(m => m !== ctx.setting);
                    ctx.setting = null;
                }
            },
            buttons(ctx) {
                if (ctx.phase === 'set') {
                    const b = [];
                    if (snares.length < ctx.want) b.push({ label: c.setHere, hot: true, act: () => this._set(ctx) });
                    if (snares.length) b.push({ label: c.doneSetting, act: () => this._setDone(ctx) });
                    return b;
                }
                return checked.length ? [{ label: c.doneChecking, act: () => ctx.finish() }] : [];
            },
            // Set: snares set of those wanted. Check / tend: snares reached of those laid.
            status(ctx) {
                if (ctx.phase === 'set') return fmt(c.status, { done: snares.length, total: ctx.want });
                return fmt(c.statusCheck || c.status, { done: checked.length, total: snares.length });
            },
        };
        const say = mode === 'run' ? c.runSay : mode === 'set' ? c.setSay : c.tendSay;
        const spots = () => snares.map(s => ({ q: s.q, r: s.r, quality: s.quality }));
        return this.run(game, {
            title: c.title, icon: c.icon, say, plan: { parHours: c.parHours }, custom,
            // What you set, where, and what you found in the snares you checked decide the day
            // (ui/actionMenu/winterScenes.js → SeasonalWork.trapFurs / setTrapLine / tendTrapLine)
            onComplete: () => onDone({ spots: spots(), caught: { ...caught }, prize, checked: checked.slice() }),
            onAbandon: () => onAbandon && onAbandon(),
        }, () => onDone(null));
    },

    // ── Winter: ice fishing ──

    /**
     * o: { player, where: 'shore' | 'far' | 'deeper' }. Cut a hole and land
     * the bites. onDone() when done; onAbandon() on giving up.
     */
    iceFish(game, o, onDone, onAbandon) {
        const c = Rules.cfg('iceFish');
        const luck = _num(o.player && o.player.luck, 5);
        const where = o.where || 'shore';
        const custom = {
            setup(ctx) {
                const w = _wild(ctx);
                const me = _me();
                const reach = _num(c.radius, 24) * (where === 'deeper' ? 1.5 : 1);
                let pool = Rules.near(w.ice, me, reach, 0);
                if (!pool.length) pool = Rules.near(w.shore, me, reach, 0);
                if (!pool.length) pool = Rules.near(w.ice.concat(w.shore), me, 999, 8);
                if (!pool.length) pool = Rules.near(w.open, me, 14, 6);
                pool = pool.filter(p => Rules.dist(p, me) >= 3).concat(pool.length ? [] : [me]);
                const byDist = pool.slice().sort((a, b) => Rules.dist(a, me) - Rules.dist(b, me));
                const hole = where === 'shore' ? byDist[0] : byDist[byDist.length - 1];
                ctx.hole = hole || me;
                ctx.total = Math.max(1, _num((c.bites || {})[where === 'shore' ? 'shore' : 'far'], 1));
                ctx.mark(ctx.hole, { glyph: c.glyph || 'snowflake', label: where === 'shore' ? c.cutShore : c.cutFar, work: _num(c.cutSeconds, 3),
                    onStart: () => { if (where !== 'shore') ctx.note(c.creak); },
                    onDone: () => this._fish(ctx) });
            },
            _fish(ctx) {
                _castLine(ctx, ctx.hole, luck, (bite) => {
                    if (bite === true) {
                        ctx.done++;
                        if (ctx.done >= ctx.total) { ctx.finish(); return; }
                    }
                    this._fish(ctx);
                }, () => {
                    ctx.mark(ctx.hole, { glyph: c.glyph || 'snowflake', label: Rules.cfg('fish').cast, work: 0.5, onDone: () => this._fish(ctx) });
                });
            },
            tick(dt, ctx) { _lineTick(ctx, dt); },
            buttons(ctx) { return _lineButtons(ctx); },
            status(ctx) { return fmt(c.status, { done: ctx.done, total: ctx.total }); },
        };
        return this.run(game, {
            title: c.title, icon: c.icon, say: where === 'shore' ? c.shoreSay : c.farSay, plan: { parHours: c.parHours }, custom,
            // The fish you landed on the map are yours: the scene's catch is never less (ui/actionMenu/winterScenes.js)
            onComplete: (_score, info) => onDone({ landed: _num(info && info.done, 0) }),
            onAbandon: () => onAbandon && onAbandon(),
        }, () => onDone());
    },

    // ── Smuggling ──

    /**
     * o: { player, settlement, item }. onDone(true) handed over, onDone(false)
     * caught; onAbandon() on giving up; onDone(null) when it couldn't start.
     */
    smuggle(game, o, onDone, onAbandon) {
        const c = Rules.cfg('smuggle');
        const stealth = (o.player.skills && o.player.skills.stealth) || 1;
        let result = null;
        let guards = [];
        const done = () => { for (const g of guards) _release(g.npc); guards = []; };
        const custom = {
            setup(ctx) {
                const me = _me();
                const doors = MapTasks.doorsOf(ctx.spots, ['house', 'tavern', 'warehouse', 'inn', 'roadhouse']);
                const far = doors.filter(d => Rules.dist(d, me) >= _num(c.fenceFrom, 14));
                const pool = far.length ? far : (doors.length ? doors : ctx.spots.roads);
                const fence = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : me;
                ctx.fence = fence;
                ctx.total = 1;
                ctx.susp = 0;
                ctx.carrying = { glyph: c.glyph || 'satchel' };
                ctx.radius = Rules.sightRadius(stealth, c);
                ctx.mark(fence, { glyph: c.doorGlyph || 'mask', label: c.hand, work: _num(c.handSeconds, 1.5), onDone: () => {
                    result = true;
                    ctx.done = 1;
                    ctx.carrying = null;
                    ctx.finish();
                } });
                // The watch walks its rounds across the way to the fence
                const n = _num((c.patrols || {})[(o.settlement && o.settlement.type) || 'town'], 3);
                // Posts stand off the fence's door, so there is a gap in the rounds to slip in
                const roads = ctx.spots.roads.filter(p => Rules.dist(p, me) >= 6 && Rules.dist(p, fence) >= _num(c.postsFromFence, 6));
                const along = roads.filter(p => {
                    const t = Math.max(0, Math.min(1, ((p.q - me.q) * (fence.q - me.q) + (p.r - me.r) * (fence.r - me.r)) / Math.max(1, (fence.q - me.q) ** 2 + (fence.r - me.r) ** 2)));
                    const x = me.q + (fence.q - me.q) * t, y = me.r + (fence.r - me.r) * t;
                    return Math.hypot(p.q - x, p.r - y) <= 8;
                });
                const posts = MapTasks.pickSpread(along.length >= n ? along : roads, n * 2, ctx.rng, 5);
                for (let i = 0; i < n && posts.length; i++) {
                    const a = posts[i * 2 % posts.length], b = posts[(i * 2 + 1) % posts.length];
                    const npc = _spawnNpc('guard', a, ctx.rng);
                    if (npc) guards.push({ npc, wps: [a, b], wi: 1, pause: 1 + ctx.rng() * 2 });
                }
                ctx.guards = guards;
            },
            tick(dt, ctx) {
                for (const g of guards) {
                    const npc = g.npc;
                    if (npc.state !== 'idle') continue;
                    npc.idleTimer = 1e9;
                    g.pause -= dt;
                    if (g.pause > 0) continue;
                    const wp = g.wps[g.wi % g.wps.length];
                    g.wi++;
                    g.pause = 1.5;
                    const path = InnerMap._findPath ? InnerMap._findPath(npc.q, npc.r, wp.q, wp.r) : null;
                    if (path && path.length > 1) { npc.path = path.slice(1); npc.pathIndex = 0; npc.state = 'walking'; }
                }
                const me = _me();
                const watchers = guards.map(g => ({ q: g.npc.q, r: g.npc.r, name: g.npc.name, radius: ctx.radius }));
                for (const n of InnerMap.npcs || []) {
                    if (n.type === 'guard' && !n._wildTask && n.state !== 'inside_building' && n.state !== 'gone') {
                        watchers.push({ q: n.q, r: n.r, name: n.name, radius: Math.max(1, ctx.radius + _num(c.townGuardSight, -1)) });
                    }
                }
                const seen = Rules.inSight(watchers, me, ctx.radius);
                ctx.susp = Rules.suspicionStep(ctx.susp, { seen: !!seen, dist: seen ? Math.hypot(seen.q - me.q, seen.r - me.r) : 0, radius: seen ? seen.radius : ctx.radius, walking: _walking(), dt }, c);
                if (seen && !ctx.wasSeen) ctx.note(fmt(c.seen, { name: seen.name || 'A watchman' }));
                ctx.wasSeen = !!seen;
                if (ctx.susp >= 100) { result = false; ctx.finish(); }
            },
            draw(ctx2d, camera, ctx, T) {
                for (const g of guards) _ring(ctx2d, camera, T, g.npc.q, g.npc.r, ctx.radius, 'rgba(231,76,60,0.9)', ctx.wasSeen ? 'rgba(231,76,60,0.22)' : 'rgba(231,76,60,0.12)');
                for (const n of InnerMap.npcs || []) {
                    if (n.type === 'guard' && !n._wildTask && n.state !== 'inside_building') _ring(ctx2d, camera, T, n.q, n.r, Math.max(1, ctx.radius + _num(c.townGuardSight, -1)), 'rgba(231,76,60,0.6)', 'rgba(231,76,60,0.06)');
                }
            },
            status(ctx) { return fmt(c.status, { pct: Math.round(ctx.susp) }); },
        };
        return this.run(game, {
            title: `${c.title}: ${o.item}`, icon: c.icon, say: fmt(c.say, { item: o.item }), plan: { parHours: c.parHours }, custom,
            onComplete: () => { done(); onDone(result === true); },
            onAbandon: () => { done(); if (onAbandon) onAbandon(); },
        }, () => { done(); onDone(null); });
    },

    // ── Pickpocketing ──

    /**
     * o: { player, target { type, name, awareness } }. onDone('lifted' |
     * 'caught'); onAbandon() on walking away; onDone(null) when it couldn't start.
     */
    pickpocket(game, o, onDone, onAbandon) {
        const c = Rules.cfg('pickpocket');
        const t = o.target;
        const aw = _num(t.awareness, 0.3);
        const stealth = (o.player.skills && o.player.skills.stealth) || 1;
        const sense = Rules.markSense(aw, stealth, c);
        let result = null;
        let npc = null;
        const custom = {
            setup(ctx) {
                const me = _me();
                const [lo, hi] = c.from || [7, 14];
                const pool = ctx.spots.plaza.concat(ctx.spots.roads).filter(p => { const d = Rules.dist(p, me); return d >= lo && d <= hi; });
                const at = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : (Rules.near(ctx.spots.roads, me, 99, 1)[0] || me);
                npc = _spawnNpc((c.types || {})[t.type] || 'villager', at, ctx.rng);
                if (!npc) throw new Error('no mark');
                ctx.npc = npc;
                ctx.total = 1;
                ctx.susp = 0;
                ctx.lift = 0;
                ctx.mk = ctx.mark(npc, { glyph: c.glyph || 'coins', label: fmt(c.lift, { name: t.name }), passive: true, follow: npc });
                ctx.g = { phase: 'calm', t: this._calm(ctx) };
            },
            _calm(ctx) { return Math.max(1.5, sense.every + ctx.rng() * _num(c.glanceJitter, 2)); },
            tick(dt, ctx) {
                const me = _me();
                const d = Rules.dist(npc, me);
                const walking = _walking();
                npc.state = 'idle';
                npc.idleTimer = 1e9;
                const g = ctx.g;
                g.t -= dt;
                if (g.t <= 0) {
                    if (g.phase === 'calm') {
                        g.phase = 'warn'; g.t = _num(c.warnSeconds, 0.8);
                        ctx.mk.glyph = c.warnGlyph || 'warning';
                        ctx.note(c.warn);
                    } else if (g.phase === 'warn') {
                        g.phase = 'look'; g.t = _between(ctx.rng, c.glanceSeconds || [1.2, 2], 1.5);
                        ctx.mk.glyph = c.lookGlyph || 'eye';
                        try { npc.facing = Math.abs(me.q - npc.q) >= Math.abs(me.r - npc.r) ? (me.q >= npc.q ? 3 : 1) : (me.r >= npc.r ? 2 : 0); } catch (e) { /* cosmetic */ }
                        // Caught with your hand in the pocket
                        if (d <= 1) {
                            ctx.susp += _num(c.spike, 25) + aw * _num(c.spikeAwareness, 15);
                            ctx.note(c.felt);
                        } else {
                            ctx.note(c.look);
                        }
                    } else {
                        g.phase = 'calm'; g.t = this._calm(ctx);
                        ctx.mk.glyph = c.glyph || 'coins';
                    }
                }
                if (g.phase === 'look' && d <= sense.notice) {
                    ctx.susp += dt * (_num(c.seenPerSecond, 45) + aw * _num(c.seenAwareness, 40)) * (walking ? 1.3 : 1);
                } else if (d <= 1) {
                    ctx.susp += dt * (_num(c.closePerSecond, 0.7) + aw * _num(c.closeAwareness, 1.25));
                } else {
                    ctx.susp = Math.max(0, ctx.susp - dt * _num(c.fallPerSecond, 4));
                }
                if (d <= 1 && !walking && g.phase !== 'look') ctx.lift += dt;
                if (ctx.susp >= 100) { result = 'caught'; ctx.finish(); return; }
                if (ctx.lift >= sense.lift) { result = 'lifted'; ctx.done = 1; ctx.finish(); }
            },
            draw(ctx2d, camera, ctx, T) {
                if (!npc) return;
                const ph = ctx.g.phase;
                if (ph !== 'calm') _ring(ctx2d, camera, T, npc.q, npc.r, sense.notice, ph === 'look' ? 'rgba(231,76,60,0.9)' : 'rgba(243,190,60,0.85)', ph === 'look' ? 'rgba(231,76,60,0.12)' : null);
                if (ctx.lift > 0) _arc(ctx2d, camera, T, npc.q, npc.r, ctx.lift / sense.lift, 'rgba(93,219,106,0.95)');
            },
            status(ctx) { return fmt(c.status, { pct: Math.round(ctx.susp), lift: Math.round(100 * ctx.lift / sense.lift) }); },
        };
        return this.run(game, {
            title: `${c.title}: ${t.name}`, icon: c.icon, say: fmt(c.say, { name: t.name }), plan: { parHours: c.parHours }, custom,
            onComplete: () => { _release(npc); onDone(result || 'caught'); },
            onAbandon: () => { _release(npc); if (onAbandon) onAbandon(); },
        }, () => { _release(npc); onDone(null); });
    },
};
