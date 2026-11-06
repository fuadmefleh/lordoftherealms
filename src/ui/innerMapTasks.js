// ============================================================
// INNER MAP TASKS — doing the work in person on the street map
// ============================================================
// Replaces the old minigames: a job is a task you walk through on the
// inner map. Its objectives are marked on the ground (an arrow at the screen
// edge points to the ones out of sight), a small tracker shows what's next,
// and when it's done the score (systems/mapTasks.js) goes to the same reward
// the minigame used to feed.
//
// Templates (data/mapTasks.json):
//   haul     carry loads from a pickup to a drop-off, trip after trip
//   work     put in work at several spots (dig, chop, scythe, shovel)
//   deliver  collect, then take parcels to doors (sneak: keep clear of guards)
//   cry      stand at the busy spots and cry out; a crowd gathers
//   tally    count the stock at the stores, then report the total
//   gather   pick herbs/fruit/seed at patches round the edge of town
//   herd     find the strays; they follow you back to the fold
//   catch    rats break from cover: corner them before they bolt
//   patrol   walk the round; trouble turns up and has to be dealt with
//   bout     a fight with an opponent in front of the crowd
//
// Other screens start tasks with InnerMapTasks.start(game, spec):
//   spec = { title, icon, say, plan (from MapTasks.jobPlan or hand-made),
//            onComplete(score 0–100, info), onAbandon?(info) }
// A spec may instead pass `custom` — { setup(ctx), tick?(dt, ctx), status(ctx) }
// — for tasks that are not one of the templates (see buildCustom below).
// A custom task may also have draw(ctx2d, camera, ctx, tileSize) for its own
// overlay and buttons(ctx) → [{ label, act, hot }] for HUD buttons
// (ui/mapTasks/wildTasks.js uses both).

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { MapTasks } from '../systems/mapTasks.js';
import { drawMapMarker } from './mapInk.js';
import { pictureIcon } from './icons.js';
import { Utils } from '../core/utils.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _ri = (rng, [a, b]) => a + Math.floor(rng() * (b - a + 1));
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

/** Game hours since the start of day 0 at this moment. */
function _clockHours(game) {
    const day = _num(game && game.world && game.world.day);
    // timeOfDay is the whole hour; the accumulator holds the seconds into it
    const frac = _num(InnerMap._timeAccumulator) / Math.max(1, _num(InnerMap.TIME_SCALE, 60));
    return day * 24 + Math.floor(_num(InnerMap.timeOfDay, 8)) + Math.min(0.999, frac);
}

function _playerPos() {
    return { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
}

function _cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ──────────────────────────────────────────────
// Templates: each builds objectives in setup and reacts as they are met
// ──────────────────────────────────────────────

/** Places of a kind ({ doors, props, ground, roads, trees }) from the map's spots. */
function _placesFor(ctx, want) {
    const s = ctx.spots;
    let out = [];
    if (!want) return out;
    if (want.doors) out = out.concat(MapTasks.doorsOf(s, want.doors));
    if (want.props) out = out.concat(MapTasks.propsOf(s, want.props));
    if (want.trees) out = out.concat(s.props.filter(p => p.id === 'large_tree_1'));
    if (want.roads) out = out.concat(s.roads);
    if (want.ground === 'town') out = out.concat(s.ground.filter(g => g.town));
    if (want.ground === 'edge') out = out.concat(s.ground.filter(g => g.edge));
    if (want.ground === true) out = out.concat(s.ground);
    return out;
}

/** A place list with sensible fallbacks so a task can always be laid out. */
function _placesOr(ctx, want, fallback) {
    const a = _placesFor(ctx, want);
    if (a.length) return a;
    const b = _placesFor(ctx, fallback);
    if (b.length) return b;
    return ctx.spots.roads.length ? ctx.spots.roads : ctx.spots.ground;
}

const TEMPLATES = {
    haul: {
        setup(ctx) {
            const p = ctx.plan;
            ctx.total = _ri(ctx.rng, p.trips || [3, 5]);
            // A strong back carries more at once: fewer trips for the same work
            if (ctx.stat >= 8 && ctx.total > 2) ctx.total -= 1;
            const from = _placesOr(ctx, p.from, { props: ['tp_crate', 'tp_sacks', 'tp_barrel'], doors: ['warehouse', 'granary', 'marketplace'] });
            const to = _placesOr(ctx, p.to, { doors: ['marketplace', 'warehouse', 'house'] });
            const me = _playerPos();
            ctx.pickup = MapTasks.nearest(from, me.q, me.r);
            const far = to.filter(t => _dist(t, ctx.pickup) >= 10);
            ctx.drops = ctx.pickNear(far.length ? far : to, Math.min(3, ctx.total), 6);
            ctx.trip = 0;
            this._next(ctx);
        },
        _next(ctx) {
            ctx.clear();
            if (ctx.done >= ctx.total) return ctx.finish();
            if (!ctx.carrying) {
                ctx.mark(ctx.pickup, { glyph: ctx.plan.glyph || 'crate', label: `Pick up a ${ctx.plan.noun}`, work: ctx.plan.workSeconds, onDone: () => {
                    ctx.carrying = { glyph: ctx.plan.glyph || 'crate' };
                    this._next(ctx);
                } });
            } else {
                const drop = ctx.drops[ctx.trip % ctx.drops.length];
                ctx.mark(drop, { glyph: ctx.plan.dropGlyph || 'satchel', label: `Set down the ${ctx.plan.noun}${drop.name ? ` at the ${drop.name}` : ''}`, work: ctx.plan.workSeconds, onDone: () => {
                    ctx.carrying = null;
                    ctx.done++;
                    ctx.trip++;
                    this._next(ctx);
                } });
            }
        },
        status(ctx) { return `${_cap(ctx.plan.noun)}s carried ${ctx.done}/${ctx.total}`; },
    },

    work: {
        setup(ctx) {
            const p = ctx.plan;
            ctx.total = _ri(ctx.rng, p.count || [3, 5]);
            const places = _placesOr(ctx, p.at, { ground: 'town' });
            const picks = ctx.pickNear(places, ctx.total, 5);
            ctx.total = picks.length;
            const secs = _num(p.workSeconds, 3) * (ctx.stat >= 7 ? 0.8 : 1);
            for (const at of picks) {
                ctx.mark(at, { glyph: p.glyph || 'hammer', label: `${p.verb || 'Work'} here`, work: secs, onDone: () => {
                    ctx.done++;
                    if (ctx.done >= ctx.total) ctx.finish();
                } });
            }
        },
        status(ctx) { return `${ctx.plan.verb || 'Work'}: ${ctx.done}/${ctx.total} done`; },
    },

    deliver: {
        setup(ctx) {
            const p = ctx.plan;
            ctx.total = _ri(ctx.rng, p.count || [3, 5]);
            const to = _placesOr(ctx, p.to, { doors: ['house'] });
            const me = _playerPos();
            const far = to.filter(t => _dist(t, me) >= 8);
            ctx.targets = ctx.pickNear(far.length ? far : to, ctx.total, 8);
            ctx.total = ctx.targets.length;
            const from = p.from ? _placesFor(ctx, p.from) : [];
            if (from.length) {
                const at = MapTasks.nearest(from, me.q, me.r);
                ctx.mark(at, { glyph: 'satchel', label: `Collect the ${p.glyph === 'coins' ? 'tally roll' : 'parcels'}${at.name ? ` at the ${at.name}` : ''}`, work: 1, onDone: () => this._send(ctx) });
            } else {
                this._send(ctx);
            }
        },
        _send(ctx) {
            const p = ctx.plan;
            for (const t of ctx.targets) {
                ctx.mark(t, { glyph: p.glyph || 'seal', label: `${p.verb || 'Deliver'}${t.name && t.name !== 'House' ? ` at the ${t.name}` : ' here'}`, work: p.workSeconds || 0.6, onDone: () => {
                    // Seen by the watch on a hush-hush errand: the job is botched a little
                    if (p.sneak) {
                        const guards = (InnerMap.npcs || []).filter(n => /guard/.test(n.type) && _dist(n, t) <= 6);
                        if (guards.length) { ctx.quality = Math.max(0, ctx.quality - 0.5); ctx.note(`${guards[0].name} of the watch saw you at the door.`); }
                    }
                    ctx.done++;
                    if (ctx.done >= ctx.total) ctx.finish();
                } });
            }
        },
        status(ctx) { return `${ctx.plan.verb === 'Knock' ? 'Doors knocked' : 'Delivered'} ${ctx.done}/${ctx.total}`; },
    },

    cry: {
        setup(ctx) {
            const p = ctx.plan;
            ctx.total = _ri(ctx.rng, p.count || [3, 4]);
            const spots = [];
            if (ctx.spots.square) spots.push(ctx.spots.square);
            const crossings = ctx.spots.roads.filter(r => {
                const t = (q, rr) => ctx.spots.passable(q, rr) && InnerMap.tiles[rr][q].isRoad;
                return t(r.q + 3, r.r) && t(r.q - 3, r.r) && t(r.q, r.r + 3) && t(r.q, r.r - 3);
            });
            spots.push(...ctx.pickNear(crossings.length ? crossings : ctx.spots.roads, ctx.total, 10));
            ctx.crowds = [];
            for (const at of spots.slice(0, ctx.total)) {
                ctx.mark(at, { glyph: 'speech', label: 'Cry out here', work: _num(p.workSeconds, 4), onStart: () => this._draw(ctx, at), onDone: () => {
                    const crowd = (InnerMap.npcs || []).filter(n => _dist(n, at) <= _num(p.crowdRadius, 6)).length;
                    ctx.crowds.push(crowd);
                    ctx.done++;
                    if (ctx.done >= ctx.total) {
                        // A good crowd at each stop is the job done well
                        const avg = ctx.crowds.reduce((a, b) => a + b, 0) / ctx.crowds.length;
                        ctx.quality = Math.min(1, 0.3 + avg / 5 + ctx.stat / 30);
                        ctx.finish();
                    }
                } });
            }
            ctx.total = Math.min(ctx.total, spots.length);
        },
        /** Folk nearby drift over to listen. */
        _draw(ctx, at) {
            const pull = 6 + Math.floor(ctx.stat / 2);
            for (const n of InnerMap.npcs || []) {
                if (n._taskFoe || n.departing || _dist(n, at) > pull + 4) continue;
                const path = InnerMap._findPath(n.q, n.r, at.q + (ctx.rng() < 0.5 ? -2 : 2), at.r + (ctx.rng() < 0.5 ? -1 : 1));
                if (path && path.length > 1) { n.path = path.slice(1); n.pathIndex = 0; n.state = 'walking'; }
            }
        },
        status(ctx) { return `Corners cried ${ctx.done}/${ctx.total}`; },
    },

    tally: {
        setup(ctx) {
            const p = ctx.plan;
            ctx.total = _ri(ctx.rng, p.count || [3, 4]);
            let at = _placesOr(ctx, p.at, { props: ['tp_crate', 'tp_sacks', 'tp_barrel', 'tp_stall'] });
            // Few crates about: count the stock inside the stores too
            if (at.length < ctx.total + 2) at = at.concat(MapTasks.doorsOf(ctx.spots, ['warehouse', 'granary', 'marketplace', 'bakery', 'mill', 'blacksmith']));
            const picks = ctx.pickNear(at, ctx.total, 6);
            ctx.total = picks.length;
            ctx.counts = [];
            const nouns = ['sacks', 'crates', 'barrels', 'bolts of cloth', 'casks', 'baskets'];
            for (const s of picks) {
                const n = 3 + Math.floor(ctx.rng() * 13);
                const noun = nouns[Math.floor(ctx.rng() * nouns.length)];
                ctx.mark(s, { glyph: 'ledger', label: 'Count the stock', work: p.workSeconds || 1.5, onDone: () => {
                    ctx.counts.push(n);
                    ctx.note(`You count ${n} ${noun}${s.name ? ` at the ${s.name}` : ''}. Remember it.`);
                    ctx.done++;
                    if (ctx.done >= ctx.total) this._report(ctx);
                } });
            }
        },
        _report(ctx) {
            const rep = _placesOr(ctx, ctx.plan.report, { doors: ['guildhall', 'town_hall', 'marketplace'] });
            const me = _playerPos();
            const at = MapTasks.nearest(rep, me.q, me.r);
            ctx.reporting = true;
            ctx.mark(at, { glyph: 'quill', label: `Report the tally${at.name ? ` at the ${at.name}` : ''}`, work: 0.5, onDone: () => {
                const sum = ctx.counts.reduce((a, b) => a + b, 0);
                const wrong = [sum + 3, sum - 2, sum + 7].filter(x => x > 0);
                const choices = [sum, ...wrong];
                for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(ctx.rng() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
                // You have to carry the figures in your head; a sharp mind jots them down
                const jotted = ctx.stat >= 7 ? ` (Your notes: ${ctx.counts.join(' + ')}.)` : '';
                ctx.ask(`The clerk asks for the total of everything you counted.${jotted}`, choices.map(String), (pick) => {
                    ctx.quality = Number(pick) === sum ? 1 : 0.25;
                    if (Number(pick) !== sum) ctx.note(`Wrong: it was ${sum}. The clerk sighs and recounts.`);
                    ctx.finish();
                });
            } });
        },
        status(ctx) { return ctx.reporting ? 'Report the tally' : `Stores counted ${ctx.done}/${ctx.total}`; },
    },

    gather: {
        setup(ctx) {
            const p = ctx.plan;
            ctx.total = _ri(ctx.rng, p.count || [4, 6]);
            const edge = ctx.spots.ground.filter(g => g.edge);
            const picks = ctx.pickNear(edge.length ? edge : ctx.spots.ground, ctx.total, 5);
            ctx.total = picks.length;
            for (const at of picks) {
                ctx.mark(at, { glyph: p.glyph || 'wheat', label: `${p.verb || 'Pick'} here`, work: p.workSeconds || 2, onDone: () => {
                    ctx.done++;
                    if (ctx.done >= ctx.total) ctx.finish();
                } });
            }
        },
        status(ctx) { return `${ctx.plan.verb || 'Gathered'}: ${ctx.done}/${ctx.total}`; },
    },

    herd: {
        setup(ctx) {
            ctx.total = _ri(ctx.rng, ctx.plan.count || [3, 4]);
            const edge = ctx.spots.ground.filter(g => g.edge);
            const homes = ctx.pickNear(edge.length ? edge : ctx.spots.ground, ctx.total, 8);
            ctx.total = homes.length;
            for (const h of homes) ctx.addMover({ q: h.q, r: h.r, glyph: 'sheep', kind: 'stray' });
            const pens = MapTasks.propsOf(ctx.spots, ['tp_fence_gate', 'tp_hay']);
            const me = _playerPos();
            ctx.pen = (pens.length && MapTasks.nearest(pens, me.q, me.r)) || ctx.spots.square || me;
            ctx.penMark = ctx.mark(ctx.pen, { glyph: 'house', label: 'The fold', passive: true, name: 'Fold' });
            for (const m of ctx.movers) ctx.track(m, 'Find the stray');
        },
        tick(dt, ctx) {
            const me = _playerPos();
            // Once a stray is behind you, the fold is where you're headed: point the way
            const leading = ctx.movers.some(m => m.following && !m.penned);
            if (ctx.penMark) {
                ctx.penMark.guide = leading;
                ctx.penMark.label = leading ? 'Lead them back to the fold' : 'The fold';
            }
            for (const m of ctx.movers) {
                if (m.penned) continue;
                if (!m.following && _dist(m, me) <= 1) { m.following = true; ctx.untrack(m); ctx.note('A stray falls in behind you.'); }
                if (m.following) {
                    ctx.followPlayer(m, dt, 1 + ctx.movers.filter(x => x.following && !x.penned).indexOf(m));
                    if (_dist(m, ctx.pen) <= 2) {
                        m.penned = true; m.hidden = true; ctx.done++;
                        if (ctx.done >= ctx.total) ctx.finish();
                        else ctx.note(`Into the fold: ${ctx.done} of ${ctx.total}.`);
                    }
                } else {
                    ctx.wander(m, dt, 0.9);
                }
            }
        },
        status(ctx) {
            const f = ctx.movers.filter(m => m.following && !m.penned).length;
            return `In the fold ${ctx.done}/${ctx.total}${f ? ` · ${f} following` : ''}`;
        },
    },

    catch: {
        setup(ctx) {
            ctx.total = _ri(ctx.rng, ctx.plan.count || [3, 5]);
            const at = _placesOr(ctx, ctx.plan.at, { doors: ['granary', 'warehouse', 'house'] });
            const holes = ctx.pickNear(at, ctx.total, 6);
            ctx.total = holes.length;
            for (const h of holes) {
                const m = ctx.addMover({ q: h.q, r: h.r, glyph: 'paw', kind: 'rat', home: h });
                ctx.track(m, 'Catch the rat');
            }
            // Stealth lets you get closer before they bolt
            ctx.flee = Math.max(1.5, _num(ctx.plan.fleeRadius, 4) - ctx.stat * 0.25);
        },
        tick(dt, ctx) {
            const me = _playerPos();
            for (const m of ctx.movers) {
                if (m.caught) continue;
                const d = _dist(m, me);
                if (d <= 1 && !InnerMap._playerWalking) {
                    m.caught = true; m.hidden = true; ctx.untrack(m); ctx.done++;
                    ctx.note('Got it!');
                    if (ctx.done >= ctx.total) ctx.finish();
                    continue;
                }
                if (d <= 1) {
                    // Pounce: stop dead beside it and it's yours, unless it's quicker
                    m.wait = (m.wait || 0) + dt;
                    if (m.wait > 0.5) { m.caught = true; m.hidden = true; ctx.untrack(m); ctx.done++; ctx.note('Got it!'); if (ctx.done >= ctx.total) ctx.finish(); }
                    continue;
                }
                m.wait = 0;
                // It bolts, but never far from its hole, and no faster than you walk: corner it
                if (d <= ctx.flee) ctx.fleeFrom(m, me, dt, 0.32, m.home, 4);
                else ctx.wander(m, dt, 1.5, m.home, 3);
            }
        },
        status(ctx) { return `Rats caught ${ctx.done}/${ctx.total}`; },
    },

    patrol: {
        setup(ctx) {
            const p = ctx.plan;
            ctx.total = _ri(ctx.rng, p.count || [4, 5]);
            const places = _placesOr(ctx, p.at, { roads: true });
            const route = ctx.pickNear(places, ctx.total, 10);
            ctx.total = route.length;
            ctx.troubleAt = Math.floor(ctx.rng() * route.length);
            route.forEach((at, i) => {
                ctx.mark(at, { glyph: 'shield', label: 'Check this post', work: p.workSeconds || 1, onDone: () => {
                    ctx.done++;
                    if (i === ctx.troubleAt && !ctx.foeDone) ctx.spawnFoe(p.foe || 'cutpurse', at, () => { if (ctx.done >= ctx.total) ctx.finish(); });
                    else if (ctx.done >= ctx.total && (ctx.foeDone || ctx.troubleAt >= route.length)) ctx.finish();
                } });
            });
        },
        status(ctx) { return ctx.foe ? `Deal with the ${ctx.foe.name}` : `Posts checked ${ctx.done}/${ctx.total}`; },
    },

    bout: {
        setup(ctx) {
            ctx.total = 1;
            const at = ctx.spots.square || MapTasks.nearest(ctx.spots.roads, InnerMap.playerInnerQ, InnerMap.playerInnerR);
            ctx.mark(at, { glyph: 'swords', label: 'Step into the ring', work: 0.5, onDone: () => {
                ctx.spawnFoe(ctx.plan.foe || 'bruiser', at, () => { ctx.done = 1; ctx.finish(); });
            } });
        },
        status(ctx) { return ctx.foe ? `Beat the ${ctx.foe.name}` : 'Go to the ring'; },
    },
};

// ──────────────────────────────────────────────
// The runtime
// ──────────────────────────────────────────────

let _seq = 0;

export const InnerMapTasks = {
    active: null,
    TEMPLATES,

    isActive() { return !!this.active; },

    /**
     * Start a task on the current inner map. Make sure the player is on the
     * street map first (InnerMapTasks.ensureStreet).
     */
    start(game, spec) {
        if (this.active) this.abandon(true);
        if (!InnerMap.active) return false;
        const tpl = spec.custom || TEMPLATES[(spec.plan && spec.plan.template) || 'haul'];
        if (!tpl) return false;
        const seed = (_num(game.world && game.world.day) * 7919 + (++_seq) * 104729 + InnerMap.playerInnerQ * 31 + InnerMap.playerInnerR) >>> 0;
        const ctx = this._makeCtx(game, spec, tpl, Utils.seededRandom(seed % 233279 + 1));
        this.active = ctx;
        try {
            tpl.setup(ctx);
        } catch (e) {
            console.warn('[InnerMapTasks] setup failed', e);
            this.active = null;
            return false;
        }
        if (this.active !== ctx) return true; // finished during setup (nothing to do)
        this._mountHud(ctx);
        return true;
    },

    /**
     * Get onto the street map of the player's current world tile (out of any
     * building), then call `then()`.
     */
    async ensureStreet(game, then) {
        try {
            if (!InnerMap.active && game.enterInnerMap) await game.enterInnerMap(game.player.q, game.player.r);
            if (InnerMap._insideBuilding && InnerMap.exitBuilding) InnerMap.exitBuilding(game);
        } catch (e) {
            console.warn('[InnerMapTasks] could not reach the street map', e);
        }
        if (game.ui && game.ui.hideCustomPanel) game.ui.hideCustomPanel();
        if (InnerMap.active) then();
    },

    _makeCtx(game, spec, tpl, rng) {
        const self = this;
        const plan = spec.plan || {};
        const ctx = {
            game, spec, tpl, plan, rng,
            stat: _num(spec.stat, 5),
            spots: MapTasks.spots({ tiles: InnerMap.tiles, width: InnerMap.width, height: InnerMap.height, buildings: InnerMap.buildings || [] }),
            started: _clockHours(game),
            startPos: _playerPos(),
            done: 0, total: 1, quality: 1,
            marks: [], movers: [], notes: [],
            carrying: null, foe: null, foeDone: false,
            mark(at, o) {
                const m = { q: at.q, r: at.r, held: 0, ...o };
                ctx.marks.push(m);
                return m;
            },
            clear() { ctx.marks = []; },
            /** n spread-out picks, from the places within reach of where the job began. */
            pickNear(list, n, gap = 5, range = 28) {
                const start = ctx.startPos;
                const near = list.filter(p => _dist(p, start) <= range);
                const pool = near.length >= n * 2 ? near
                    : list.slice().sort((a, b) => _dist(a, start) - _dist(b, start)).slice(0, Math.max(n * 3, 12));
                return MapTasks.pickSpread(pool, n, ctx.rng, gap);
            },
            track(mover, label) { mover.tracked = label; },
            untrack(mover) { mover.tracked = null; },
            note(text) { ctx.notes.unshift(text); ctx.notes.length = Math.min(ctx.notes.length, 3); self._renderHud(ctx); },
            addMover(o) {
                const m = { fq: o.q, fr: o.r, step: 0, ...o };
                ctx.movers.push(m);
                return m;
            },
            /** Move a mover one tile toward (tq, tr) every `secs` seconds. */
            _stepToward(m, tq, tr, dt, secs, away = false, home = null, leash = 0) {
                m.step = (m.step || 0) + dt;
                if (m.step < secs) return;
                m.step = 0;
                const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dq, dr]) => ({ q: m.q + dq, r: m.r + dr }))
                    .filter(c => ctx.spots.passable(c.q, c.r) || (InnerMap.tiles[c.r] && InnerMap.tiles[c.r][c.q] && InnerMap.tiles[c.r][c.q].isRoad))
                    .filter(c => !home || (Math.abs(c.q - home.q) <= leash && Math.abs(c.r - home.r) <= leash));
                if (!opts.length) return;
                const here = Math.abs(m.q - tq) + Math.abs(m.r - tr);
                opts.sort((a, b) => {
                    const da = Math.abs(a.q - tq) + Math.abs(a.r - tr), db = Math.abs(b.q - tq) + Math.abs(b.r - tr);
                    return away ? db - da : da - db;
                });
                const c = opts[0];
                // Cornered: nowhere further from the threat within reach of home
                if (away && Math.abs(c.q - tq) + Math.abs(c.r - tr) <= here) return;
                m.q = c.q; m.r = c.r;
            },
            followPlayer(m, dt, place) {
                const me = _playerPos();
                const d = _dist(m, me);
                if (d <= place) { m.path = null; return; }
                // Fallen far behind (round a building): it trots up to you
                if (d > 14) {
                    const near = [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [2, 0]].map(([dq, dr]) => ({ q: me.q + dq, r: me.r + dr }))
                        .find(c => ctx.spots.passable(c.q, c.r) || (InnerMap.tiles[c.r] && InnerMap.tiles[c.r][c.q] && InnerMap.tiles[c.r][c.q].isRoad));
                    if (near) { m.q = near.q; m.r = near.r; m.fq = near.q; m.fr = near.r; m.path = null; }
                    return;
                }
                // Walk a real path round trees and houses, re-planned now and then
                m.repath = (m.repath || 0) - dt;
                if (!m.path || m.repath <= 0) {
                    const path = InnerMap._findPath ? InnerMap._findPath(m.q, m.r, me.q, me.r) : null;
                    m.path = path && path.length > 1 ? path.slice(1) : null;
                    m.repath = 1;
                }
                m.step = (m.step || 0) + dt;
                if (m.step < 0.24) return;
                m.step = 0;
                if (m.path && m.path.length > place) {
                    const nx = m.path.shift();
                    m.q = nx.q; m.r = nx.r;
                } else if (!m.path) {
                    ctx._stepToward(m, me.q, me.r, 0.24, 0);
                }
            },
            fleeFrom(m, from, dt, secs, home = null, leash = 0) { ctx._stepToward(m, from.q, from.r, dt, secs, true, home, leash); },
            wander(m, dt, secs, home = null, leash = 4) {
                m.step = (m.step || 0) + dt;
                if (m.step < secs) return;
                m.step = 0;
                let tq = m.q + Math.round((ctx.rng() - 0.5) * 4), tr = m.r + Math.round((ctx.rng() - 0.5) * 4);
                if (home && (Math.abs(tq - home.q) > leash || Math.abs(tr - home.r) > leash)) { tq = home.q; tr = home.r; }
                ctx._stepToward(m, tq, tr, secs, 0);
            },
            /** Put up a dialog with choices; resolve(pick). */
            ask(question, choices, resolve) { self._ask(ctx, question, choices, resolve); },
            /** Bring on an opponent beside `at`; `then` when they yield. */
            spawnFoe(foeKey, at, then) { self._spawnFoe(ctx, foeKey, at, then); },
            finish() { self._finish(ctx, false); },
        };
        return ctx;
    },

    // ── Per-frame ──

    update(dt, game) {
        const ctx = this.active;
        if (!ctx || !InnerMap.active) return;
        if (InnerMap._insideBuilding) return;
        const me = _playerPos();
        const walking = !!InnerMap._playerWalking;
        for (const m of ctx.marks.slice()) {
            if (m.done || m.passive) continue;
            const at = Math.max(Math.abs(m.q - me.q), Math.abs(m.r - me.r)) <= 1;
            if (!at) { m.held = 0; continue; }
            if (walking && m.work) continue;
            if (m.held === 0) {
                if (m.onStart) m.onStart();
                try {
                    InnerMapRenderer._playerFacing = InnerMap.getDirectionToward(m.q, m.r);
                    if (m.work >= 1.5 && InnerMap.startInteraction) InnerMap.startInteraction(m.q, m.r, null, 0, 'emotes');
                } catch (e) { /* cosmetic */ }
            }
            m.held += dt;
            if (m.held >= _num(m.work, 0)) {
                m.done = true;
                ctx.marks = ctx.marks.filter(x => x !== m);
                if (m.onDone) m.onDone();
                if (this.active !== ctx) return;
            }
        }
        if (ctx.tpl.tick) ctx.tpl.tick(dt, ctx);
        if (this.active !== ctx) return;
        // Smooth movers toward their tiles
        for (const m of ctx.movers) {
            m.fq += (m.q - m.fq) * Math.min(1, dt * 8);
            m.fr += (m.r - m.fr) * Math.min(1, dt * 8);
        }
        // A fight: beaten when the player is down to their last strength
        if (ctx.foe && game.player) {
            const beatenAt = _num(MapTasks.data().beatenAt, 0.15);
            const maxHp = _num(game.player.maxHealth, 100);
            if (_num(game.player.health, maxHp) <= maxHp * beatenAt) {
                ctx.note(`The ${ctx.foe.name} has the better of you.`);
                ctx.quality = 0.1;
                this._retireFoe(ctx, false);
                this._finish(ctx, false);
                return;
            }
        }
        ctx._hudTimer = (ctx._hudTimer || 0) + dt;
        if (ctx._hudTimer > 0.4) { ctx._hudTimer = 0; this._renderHud(ctx); }
    },

    // ── Fights ──

    _spawnFoe(ctx, key, at, then) {
        const def = (MapTasks.data().foes || {})[key] || { name: 'Troublemaker', type: 'villager', hp: 1 };
        const spot = [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1]].map(([dq, dr]) => ({ q: at.q + dq, r: at.r + dr }))
            .find(c => InnerMap.tiles[c.r] && InnerMap.tiles[c.r][c.q] && InnerMap.tiles[c.r][c.q].subTerrain.passable) || at;
        const npc = InnerMap._makeNpc ? InnerMap._makeNpc(def.type || 'villager', 90000 + (++_seq), ctx.rng) : null;
        if (!npc) { then(); return; }
        Object.assign(npc, { q: spot.q, r: spot.r, targetQ: spot.q, targetR: spot.r, prevQ: spot.q, prevR: spot.r, name: def.name, path: null, state: 'idle', idleTimer: 999 });
        // Their fighting levels by what they are (a pit bruiser brawls; data/skillPacks/combat.json npc.roles)
        npc._skillRole = key;
        npc._taskFoe = {
            onYield: () => {
                ctx.note(`The ${def.name} yields.`);
                this._retireFoe(ctx, true);
                then();
            },
        };
        InnerMap.npcs.push(npc);
        ctx.foe = npc;
        ctx.note(`${def.name}: "${def.line || 'Come on then.'}"`);
        // Set their strength for the bout and square up
        const base = InnerMapCombat.NPC_BASE_HEALTH && InnerMapCombat.NPC_BASE_HEALTH[npc.type] || 60;
        const hp = Math.round(base * _num(def.hp, 1));
        InnerMapCombat._npcHealth.set(npc.id, { current: hp, max: hp });
        ctx.mark(npc, { glyph: 'swords', label: `Fight the ${def.name}`, passive: true, follow: npc });
        this._renderHud(ctx);
        // You engage as soon as you close in
        const self = this;
        // Close with them and you square up — and again if you break off and come back
        const engage = () => {
            if (self.active !== ctx || ctx.foe !== npc) return;
            const busy = InnerMapCombat._attackState && InnerMapCombat._attackState.npc === npc;
            if (!busy && !InnerMap._playerWalking && _dist(npc, _playerPos()) <= 1) InnerMapCombat._beginNPCAttack(ctx.game, npc);
            setTimeout(engage, 300);
        };
        engage();
    },

    _retireFoe(ctx, won) {
        const npc = ctx.foe;
        if (!npc) return;
        ctx.foe = null;
        ctx.foeDone = true;
        ctx.marks = ctx.marks.filter(m => m.follow !== npc);
        if (InnerMapCombat._attackState && InnerMapCombat._attackState.npc === npc) InnerMapCombat.cancelAttack();
        InnerMapCombat._npcHealth.delete(npc.id);
        if (InnerMapCombat._npcReactions) InnerMapCombat._npcReactions.delete(npc.id);
        // They slope off: walk to the edge and away
        const edge = InnerMap._findNearestEdgeTile ? InnerMap._findNearestEdgeTile(npc.q, npc.r) : null;
        const path = edge ? InnerMap._findPath(npc.q, npc.r, edge.q, edge.r) : null;
        if (path && path.length > 1) { npc.path = path.slice(1); npc.pathIndex = 0; npc.departing = true; npc.state = 'walking'; }
        else { const i = InnerMap.npcs.indexOf(npc); if (i >= 0) InnerMap.npcs.splice(i, 1); }
        if (!won) ctx.quality = Math.min(ctx.quality, 0.1);
    },

    // ── Ending ──

    abandon(silent = false) {
        const ctx = this.active;
        if (!ctx) return;
        this._retireFoe(ctx, false);
        ctx.abandoned = true;
        this._finish(ctx, true, silent);
    },

    _finish(ctx, abandoned, silent = false) {
        if (this.active !== ctx) return;
        this.active = null;
        this._unmountHud();
        const elapsed = Math.max(0, _clockHours(ctx.game) - ctx.started);
        const parHours = _num(ctx.plan.parHours, 2);
        let score = MapTasks.score({ done: ctx.done, total: ctx.total, elapsedHours: elapsed, parHours, quality: ctx.quality });
        if (abandoned) score = Math.round(score * 0.5);
        const info = { done: ctx.done, total: ctx.total, elapsedHours: Math.round(elapsed * 10) / 10, parHours, quality: ctx.quality, abandoned, notes: ctx.notes.slice() };
        if (silent) return;
        if (abandoned && ctx.spec.onAbandon) { ctx.spec.onAbandon(info); return; }
        if (ctx.spec.onComplete) ctx.spec.onComplete(score, info);
    },

    // ── Drawing the marks ──

    render(ctx2d, camera, canvas) {
        const ctx = this.active;
        if (!ctx || !InnerMap.active || InnerMap._insideBuilding) return;
        const T = InnerMapRenderer.TILE_SIZE || 32;
        const ds = T * camera.zoom;
        const t = performance.now() / 1000;
        const W = canvas.width, H = canvas.height;
        const pad = 40;
        const items = [];
        // A guiding mark (where you're leading the flock) outranks the rest: its
        // arrow is the big green one, the others fade while it shows
        const guiding = ctx.marks.some(m => m.guide);
        for (const m of ctx.marks) {
            const q = m.follow ? m.follow.q : m.q, r = m.follow ? m.follow.r : m.r;
            items.push({ q, r, glyph: m.glyph, held: m.work ? Math.min(1, m.held / m.work) : 0, passive: m.passive && !m.guide, follow: !!m.follow, guide: !!m.guide, name: m.name });
        }
        for (const mv of ctx.movers) {
            if (mv.hidden || mv.following) continue;
            items.push({ q: mv.fq, r: mv.fr, glyph: mv.glyph, mover: true, tracked: !!mv.tracked, animal: !!mv.animal });
        }
        // Followers are drawn on screen only (no edge arrow: they're behind you)
        for (const mv of ctx.movers) {
            if (mv.hidden || !mv.following) continue;
            items.push({ q: mv.fq, r: mv.fr, glyph: mv.glyph, mover: true, tracked: false, noArrow: true });
        }
        const me = _playerPos();
        const safe = this._safeArea(canvas);
        for (const it of items) {
            const s = camera.worldToScreen(it.q * T + T / 2, it.r * T + T / 2);
            const on = s.x > -ds && s.y > -ds && s.x < W + ds && s.y < H + ds;
            if (on) {
                if (it.mover) {
                    // A living animal draws itself among the sprites (ui/innerMapAnimals.js)
                    if (it.animal) continue;
                    // A creature: a small token on the ground with a soft shadow
                    ctx2d.save();
                    ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = '#000';
                    ctx2d.beginPath(); ctx2d.ellipse(s.x, s.y + ds * 0.22, ds * 0.22, ds * 0.09, 0, 0, Math.PI * 2); ctx2d.fill();
                    ctx2d.restore();
                    drawMapMarker(ctx2d, it.glyph, s.x, s.y, Math.max(7, ds * 0.22), { rim: it.tracked ? 'rgba(245,197,66,0.9)' : 'rgba(200,200,200,0.6)' });
                    continue;
                }
                const pulse = 0.55 + 0.45 * Math.sin(t * 4);
                // A ring on the ground…
                ctx2d.save();
                ctx2d.strokeStyle = it.guide ? `rgba(93,219,106,${0.5 + 0.4 * pulse})` : it.passive ? 'rgba(160,200,255,0.7)' : `rgba(245,197,66,${0.45 + 0.4 * pulse})`;
                ctx2d.lineWidth = Math.max(2, ds * 0.06);
                ctx2d.beginPath(); ctx2d.ellipse(s.x, s.y + ds * 0.25, ds * 0.42, ds * 0.18, 0, 0, Math.PI * 2); ctx2d.stroke();
                if (it.held > 0) {
                    ctx2d.strokeStyle = 'rgba(93,219,106,0.95)';
                    ctx2d.lineWidth = Math.max(3, ds * 0.08);
                    ctx2d.beginPath(); ctx2d.ellipse(s.x, s.y + ds * 0.25, ds * 0.42, ds * 0.18, 0, -Math.PI / 2, -Math.PI / 2 + it.held * Math.PI * 2); ctx2d.stroke();
                }
                ctx2d.restore();
                // …and a marker bobbing above it
                const bob = Math.sin(t * 3) * ds * 0.06;
                drawMapMarker(ctx2d, it.glyph, s.x, s.y - ds * (it.follow ? 1.3 : 0.9) + bob, Math.max(8, ds * 0.24));
            } else if ((!it.passive || it.follow) && !it.noArrow) {
                // Off screen: an arrow at the edge pointing the way
                // Kept inside the part of the screen the HUD leaves free
                const cx = (safe.left + safe.right) / 2, cy = (safe.top + safe.bottom) / 2;
                const ang = Math.atan2(s.y - cy, s.x - cx);
                const big = (it.guide ? 1.5 : 1) * safe.zoom;
                const p = pad * big;
                const hw = Math.max(10, (safe.right - safe.left) / 2 - p), hh = Math.max(10, (safe.bottom - safe.top) / 2 - p);
                const k = Math.min(hw / Math.max(1e-6, Math.abs(Math.cos(ang))), hh / Math.max(1e-6, Math.abs(Math.sin(ang))));
                const ex = cx + Math.cos(ang) * k;
                const ey = cy + Math.sin(ang) * k;
                ctx2d.save();
                ctx2d.globalAlpha = guiding && !it.guide ? 0.4 : 1;
                ctx2d.translate(ex, ey); ctx2d.rotate(ang); ctx2d.scale(big, big);
                ctx2d.fillStyle = it.guide ? 'rgba(93,219,106,0.95)' : 'rgba(245,197,66,0.9)';
                ctx2d.strokeStyle = 'rgba(0,0,0,0.6)'; ctx2d.lineWidth = 2;
                ctx2d.beginPath(); ctx2d.moveTo(16, 0); ctx2d.lineTo(-8, -10); ctx2d.lineTo(-3, 0); ctx2d.lineTo(-8, 10); ctx2d.closePath();
                ctx2d.stroke(); ctx2d.fill();
                ctx2d.restore();
                const gx = ex - Math.cos(ang) * 26 * big, gy = ey - Math.sin(ang) * 26 * big;
                ctx2d.save();
                ctx2d.globalAlpha = guiding && !it.guide ? 0.4 : 1;
                drawMapMarker(ctx2d, it.glyph, gx, gy, 10 * big);
                ctx2d.restore();
                if (it.guide) {
                    // "Fold · 37" under the marker: where, and how far
                    const far = Math.round(_dist({ q: it.q, r: it.r }, me));
                    const text = `${it.name || 'Here'} · ${far}`;
                    ctx2d.save();
                    ctx2d.font = `bold ${Math.round(12 * safe.zoom)}px Inter, sans-serif`;
                    ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'top';
                    const tw = ctx2d.measureText(text).width + 10;
                    const ty = gy + 12 * big;
                    const tx = Math.max(tw / 2 + 4, Math.min(W - tw / 2 - 4, gx));
                    ctx2d.fillStyle = 'rgba(13,17,23,0.85)';
                    ctx2d.fillRect(tx - tw / 2, ty - 2 * safe.zoom, tw, 17 * safe.zoom);
                    ctx2d.fillStyle = '#9fe0a6';
                    ctx2d.fillText(text, tx, ty);
                    ctx2d.restore();
                }
            }
        }
        // A task's own overlay (sight rings, a stalked beast's alarm…)
        if (ctx.tpl.draw) {
            try { ctx.tpl.draw(ctx2d, camera, ctx, T); } catch (e) { /* cosmetic */ }
        }
        // What you're carrying, over your head
        if (ctx.carrying) {
            const p = camera.worldToScreen(InnerMap.playerInnerQ * T + T / 2, InnerMap.playerInnerR * T);
            drawMapMarker(ctx2d, ctx.carrying.glyph, p.x, p.y - ds * 0.85, Math.max(8, ds * 0.22));
        }
    },

    /** The canvas area not covered by the top bar, turn bar and side cards, in canvas pixels. */
    _safeArea(canvas) {
        const W = canvas.width, H = canvas.height;
        const area = { left: 0, top: 0, right: W, bottom: H, zoom: 1 };
        try {
            // Edge arrows match the HUD's size (styles.css zooms the HUD by --ui-zoom)
            area.zoom = Math.max(1, Math.min(2, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1));
            const cr = canvas.getBoundingClientRect();
            const sx = W / Math.max(1, cr.width), sy = H / Math.max(1, cr.height);
            const rect = id => { const el = document.getElementById(id); const r = el && el.getBoundingClientRect(); return r && r.width && r.height ? r : null; };
            const top = rect('topBar'), task = this._hud && this._hud.getBoundingClientRect();
            const bottom = rect('simsBottomHUD'), rail = rect('hudRightRail');
            if (top) area.top = Math.max(area.top, (top.bottom - cr.top) * sy);
            if (bottom) area.bottom = Math.min(area.bottom, (bottom.top - cr.top) * sy);
            if (rail) area.right = Math.min(area.right, (rail.left - cr.left) * sx);
            if (task && task.height) area.top = Math.max(area.top, Math.min((task.bottom - cr.top) * sy, H * 0.3));
        } catch (e) { /* no layout (tests): the whole canvas */ }
        return area;
    },

    // ── The tracker ──

    _mountHud(ctx) {
        this._unmountHud();
        const el = document.createElement('div');
        el.id = 'mapTaskHud';
        el.style.cssText = `position:fixed;top:86px;left:50%;transform:translateX(-50%);zoom:var(--ui-zoom,1);z-index:900;
            min-width:300px;max-width:440px;padding:10px 14px;border-radius:10px;
            background:rgba(13,17,23,0.92);border:1px solid rgba(245,197,66,0.55);box-shadow:0 6px 24px rgba(0,0,0,0.6);
            color:#e6e1d6;font-family:var(--font-body,'Inter',sans-serif);font-size:12px;pointer-events:auto;`;
        document.body.appendChild(el);
        this._hud = el;
        this._renderHud(ctx);
    },

    _unmountHud() {
        if (this._hud) { this._hud.remove(); this._hud = null; }
        const q = document.getElementById('mapTaskAsk');
        if (q) q.remove();
    },

    _renderHud(ctx) {
        if (!this._hud || this.active !== ctx) return;
        const elapsed = Math.max(0, _clockHours(ctx.game) - ctx.started);
        const par = _num(ctx.plan.parHours, 2);
        const next = ctx.marks.find(m => !m.passive || m.guide);
        const nextMover = ctx.movers.find(m => m.tracked && !m.hidden);
        const what = (next && next.label) || (nextMover && nextMover.tracked) || (ctx.marks[0] && ctx.marks[0].label) || '';
        const late = elapsed > par;
        const hrs = h => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
        this._hud.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:20px">${pictureIcon(ctx.spec.icon || '🔨', 22)}</span>
                <div style="flex:1;font-family:var(--font-display,'Cinzel',serif);color:var(--gold,#f5c542);font-size:14px">${ctx.spec.title || 'Task'}</div>
                <button id="mapTaskGiveUp" style="background:none;border:1px solid rgba(255,255,255,0.15);color:#aaa;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px">Give up</button>
            </div>
            ${ctx.spec.say && ctx.done === 0 && !ctx.carrying && !ctx.notes.length ? `<div style="color:#b8b2a4;margin-top:4px">${ctx.spec.say}</div>` : ''}
            <div style="margin-top:6px;display:flex;justify-content:space-between;gap:10px">
                <span>➜ ${what}</span>
                <span style="color:#9fe0a6;white-space:nowrap">${ctx.tpl.status ? ctx.tpl.status(ctx) : `${ctx.done}/${ctx.total}`}</span>
            </div>
            <div style="margin-top:3px;font-size:11px;color:${late ? '#e8a090' : '#8a8f98'}">Time ${hrs(elapsed)} · a good hand takes ${hrs(par)}</div>
            ${ctx.notes.length ? `<div style="margin-top:4px;font-size:11px;color:#c9b98a">${ctx.notes[0]}</div>` : ''}`;
        // A task's own buttons ({ label, act, hot }): pressed on pointerdown, as the HUD redraws often
        const btns = ctx.tpl.buttons ? (ctx.tpl.buttons(ctx) || []) : [];
        if (btns.length) {
            const row = document.createElement('div');
            row.style.cssText = 'margin-top:8px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap';
            for (const b of btns) {
                const el = document.createElement('button');
                el.className = 'map-task-btn';
                el.textContent = b.label;
                el.style.cssText = `padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;
                    border:1px solid ${b.hot ? '#f39c12' : 'rgba(245,197,66,0.5)'};background:${b.hot ? 'rgba(243,156,18,0.35)' : 'rgba(245,197,66,0.12)'};color:${b.hot ? '#fff' : '#f5c542'}`;
                el.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); if (this.active === ctx) b.act(); };
                row.appendChild(el);
            }
            this._hud.appendChild(row);
        }
        const btn = this._hud.querySelector('#mapTaskGiveUp');
        if (btn) btn.onclick = () => this.abandon();
    },

    _ask(ctx, question, choices, resolve) {
        const old = document.getElementById('mapTaskAsk');
        if (old) old.remove();
        const el = document.createElement('div');
        el.id = 'mapTaskAsk';
        el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);zoom:var(--ui-zoom,1);z-index:2000;
            min-width:320px;padding:16px 20px;border-radius:10px;background:rgba(13,17,23,0.97);border:2px solid var(--gold,#f5c542);
            color:#e6e1d6;font-family:var(--font-body,'Inter',sans-serif);box-shadow:0 12px 48px rgba(0,0,0,0.85);`;
        el.innerHTML = `<div style="margin-bottom:12px;font-size:13px">${question}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${choices.map((c, i) => `<button data-i="${i}" style="min-width:56px;padding:8px 14px;border-radius:6px;border:1px solid rgba(245,197,66,0.5);background:rgba(245,197,66,0.12);color:#f5c542;cursor:pointer;font-size:14px">${c}</button>`).join('')}</div>`;
        document.body.appendChild(el);
        el.querySelectorAll('button').forEach(b => {
            b.onclick = () => { el.remove(); resolve(choices[Number(b.dataset.i)]); };
        });
    },
};
