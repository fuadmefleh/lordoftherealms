// ============================================================
// PERFORM TASKS — busking, prayer rites and meditation in person
// ============================================================
// Templates for ui/innerMapTasks.js (passed as `custom`) that replace the old
// busking, prayer and meditation minigames:
//
//   perform   pick a pitch (the square, a busy crossing, the church steps),
//             then perform timed sets while the street gathers to watch;
//             what each set is worth is the listeners × how the act's choice
//             landed (a song for the hour, a fresh turn in the tale, a sermon
//             kept hot but not frightening, a juggler who doesn't fumble)
//   readings  fortune telling: walk up to the marked passers-by and read
//             their palms; the reading that fits their tell earns a coin
//   rite      light a candle at the church door, walk the circuit of
//             stations, kneel at the steps (passers-by break the prayer)
//   stillness meditation: choose a quiet spot and sit still for a while;
//             every passer-by and every time you get up costs focus
//
// The arithmetic lives in systems/performing.js; the text and settings in
// data/performTasks.json. Callers hand in what to do with the outcome, so
// this module never reaches into the reward screens (no import cycles):
//   PerformTasks.busk(game, { perfId, title, icon, stat, crowdMult, onScore, onAbandon })
//   PerformTasks.rite(game, { place, stat, title, icon, onQuality, onAbandon })
//   PerformTasks.meditate(game, { holy, stat, onQuality, onAbandon })

import { InnerMap } from '../../world/innerMap.js';
import { InnerMapTasks } from '../innerMapTasks.js';
import { MapTasks } from '../../systems/mapTasks.js';
import { Performing } from '../../systems/performing.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _ri = (rng, [a, b]) => a + Math.floor(rng() * (b - a + 1));
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const _me = () => ({ q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR });
const _line = (t, v) => Performing.line(t, v);

function _cfg() { return Performing.data(); }
function _busk() { return _cfg().busking || {}; }

/** Townsfolk out on the street (not indoors, not leaving, not a task's opponent). */
function _street() {
    return (InnerMap.npcs || []).filter(n => n && n.state !== 'inside_building' && n.state !== 'leaving_building'
        && n.state !== 'gone' && !n.departing && !n._taskFoe);
}

/** Folk within `radius` of `at` walk over to stand near it. */
function _pull(ctx, at, radius) {
    for (const n of _street()) {
        if (_dist(n, at) > radius || _dist(n, at) <= 2) continue;
        const dq = ctx.rng() < 0.5 ? -1 : 1, dr = ctx.rng() < 0.5 ? -1 : 1;
        const spread = 2 + Math.floor(ctx.rng() * 2);
        const tq = at.q + dq * spread, tr = at.r + dr * Math.floor(ctx.rng() * 3);
        const path = InnerMap._findPath ? InnerMap._findPath(n.q, n.r, tq, tr) : null;
        if (path && path.length > 1) { n.path = path.slice(1); n.pathIndex = 0; n.state = 'walking'; n._targetBuilding = null; }
    }
}

/** Keep listeners standing: an idle NPC near the pitch doesn't wander off yet. */
function _hold(n, secs = 2.5) {
    if (n.state === 'idle') n.idleTimer = Math.max(_num(n.idleTimer), secs);
}

function _isRoad(q, r) {
    return !!(InnerMap.tiles && InnerMap.tiles[r] && InnerMap.tiles[r][q] && InnerMap.tiles[r][q].isRoad);
}

/** Road crossings: road runs three tiles each way. */
function _crossings(ctx) {
    const t = (q, r) => ctx.spots.passable(q, r) && _isRoad(q, r);
    return ctx.spots.roads.filter(r => t(r.q + 3, r.r) && t(r.q - 3, r.r) && t(r.q, r.r + 3) && t(r.q, r.r - 3));
}

/** Somewhere to stand when the town gives nothing better. */
function _anywhere(ctx) {
    const me = _me();
    return MapTasks.nearest(ctx.spots.roads, me.q, me.r) || MapTasks.nearest(ctx.spots.ground, me.q, me.r) || me;
}

function _churches(ctx, types) {
    return MapTasks.doorsOf(ctx.spots, types || ['church', 'temple', 'cathedral', 'chapel', 'monastery', 'shrine']);
}

function _hourText(h) {
    const hh = ((Math.floor(_num(h, 8)) % 24) + 24) % 24;
    return `${hh}:00`;
}

// ──────────────────────────────────────────────
// Busking: sets at a pitch
// ──────────────────────────────────────────────

const PERFORM = {
    setup(ctx) {
        const p = ctx.plan;
        ctx.total = Math.max(1, _num(p.sets, 3));
        ctx.values = [];
        ctx.audience = new Set();
        ctx.used = [];
        ctx.prev = null;
        ctx.fervor = _num((_busk().fervor || {}).start, 30);
        const me = _me();
        const labels = _busk().pitchLabels || {};
        const picks = [];
        for (const kind of p.pitch || ['square', 'crossing']) {
            let at = null;
            if (kind === 'square') at = ctx.spots.square;
            else if (kind === 'church') at = MapTasks.nearest(_churches(ctx), me.q, me.r);
            else if (kind === 'crossing') {
                const away = _crossings(ctx).filter(c => !ctx.spots.square || _dist(c, ctx.spots.square) >= 8);
                at = MapTasks.nearest(away.length ? away : _crossings(ctx), me.q, me.r);
            }
            if (at && !picks.some(x => _dist(x.at, at) < 4)) picks.push({ kind, at });
        }
        if (!picks.length) picks.push({ kind: 'crossing', at: _anywhere(ctx) });
        for (const { kind, at } of picks) {
            ctx.mark(at, { glyph: p.glyph || 'speech', label: `${labels[kind] || 'Set up your pitch here'}${at.name && kind === 'church' ? ` (${at.name})` : ''}`, work: 0.5, onDone: () => {
                ctx.pitch = { q: at.q, r: at.r };
                ctx.pitchKind = kind;
                ctx.clear();
                ctx.note(_line((_busk().lines || {}).pitchSet, { pitch: kind === 'church' ? 'church steps' : kind }));
                _pull(ctx, ctx.pitch, this._radius(ctx));
                this._beforeSet(ctx);
            } });
        }
    },

    /** The act's choice for the next set, then the set itself. */
    _beforeSet(ctx) {
        const p = ctx.plan;
        const b = _busk();
        const L = b.lines || {};
        ctx.setMult = 1;
        if (p.choose === 'songs') {
            const hour = _num(InnerMap.timeOfDay, 12);
            const songs = b.songs || [];
            ctx.ask(_line(L.askSong, { hour: _hourText(hour) }), songs.map(s => s.label), (label) => {
                const song = songs.find(s => s.label === label) || songs[0];
                ctx.setMult = Performing.songMult(song, hour, ctx.prev, b.songFit);
                ctx.note(Performing.inHours(song.hours, hour) ? L.songFits : L.songOff);
                ctx.prev = song.id;
                this._markSet(ctx);
            });
            return;
        }
        if (p.choose === 'beats') {
            const beats = Performing.pickBeats(b.beats || [], 3, ctx.rng);
            ctx.ask(L.askBeat, beats.map(x => x.label), (label) => {
                const beat = beats.find(x => x.label === label) || beats[0];
                ctx.setMult = Performing.beatMult(beat.mood, ctx.prev, ctx.used, b.beatFit);
                if (ctx.prev === beat.mood) ctx.note(L.beatRepeat);
                else if (!ctx.used.includes(beat.mood)) ctx.note(L.beatFresh);
                ctx.prev = beat.mood;
                ctx.used.push(beat.mood);
                this._markSet(ctx);
            });
            return;
        }
        if (p.choose === 'tones') {
            const tones = b.tones || [];
            ctx.ask(_line(L.askTone, { fervor: Math.round(ctx.fervor) }), tones.map(t => t.label), (label) => {
                const tone = tones.find(t => t.label === label) || tones[0];
                const r = Performing.fervorStep(ctx.fervor, tone, b.fervor);
                ctx.fervor = r.fervor;
                ctx.setMult = r.mult;
                ctx.note({ cold: L.fervorCold, sweet: L.fervorSweet, frightened: L.fervorFrightened }[r.mood] || `Fervour ${Math.round(r.fervor)}.`);
                if (r.mood === 'frightened') this._scatter(ctx);
                this._markSet(ctx);
            });
            return;
        }
        this._markSet(ctx);
    },

    _markSet(ctx) {
        const p = ctx.plan;
        ctx.listeners = new Set();
        ctx.dropAt = null;
        const secs = _num(p.setSeconds, 6);
        ctx.setMark = ctx.mark(ctx.pitch, { glyph: p.glyph || 'speech', label: `${p.setLabel || 'Perform'} (${ctx.done + 1}/${ctx.total})`, work: secs, onStart: () => {
            _pull(ctx, ctx.pitch, this._radius(ctx));
            ctx.pullTimer = 0;
            if (p.drops && ctx.rng() < Performing.dropChance(ctx.stat, _busk().dropChance)) ctx.dropAt = secs * (0.25 + ctx.rng() * 0.6);
        }, onDone: () => {
            const L = _busk().lines || {};
            const n = ctx.listeners.size;
            const value = n * ctx.setMult;
            ctx.values.push(value);
            if (ctx.spec.state) ctx.spec.state.values = ctx.values.slice();
            ctx.note(n ? _line(L.setDone, { n }) : L.setEmpty);
            ctx.setMark = null;
            ctx.done++;
            if (ctx.done >= ctx.total) {
                ctx.quality = Performing.crowdQuality(ctx.values, ctx.plan.expected);
                ctx.finish();
                return;
            }
            this._beforeSet(ctx);
        } });
    },

    /** How far the act carries: further each set as word spreads. */
    _radius(ctx) {
        return _num(ctx.plan.pull, 12) + ctx.done * _num(_busk().pullGrowth, 4) + Math.floor(ctx.stat / 2);
    },

    /** A sermon too hot: the nearest folk back off. */
    _scatter(ctx) {
        for (const n of _street()) {
            if (_dist(n, ctx.pitch) > 7) continue;
            ctx.audience.delete(n.id);
            const dq = Math.sign(n.q - ctx.pitch.q) || 1, dr = Math.sign(n.r - ctx.pitch.r) || 1;
            const path = InnerMap._findPath ? InnerMap._findPath(n.q, n.r, n.q + dq * 8, n.r + dr * 8) : null;
            if (path && path.length > 1) { n.path = path.slice(1); n.pathIndex = 0; n.state = 'walking'; }
        }
    },

    tick(dt, ctx) {
        if (!ctx.pitch) return;
        const p = ctx.plan;
        const m = ctx.setMark;
        const performing = !!(m && m.held > 0);
        const listen = _num(p.listen, 5);
        for (const n of _street()) {
            const near = _dist(n, ctx.pitch) <= listen;
            if (near && performing) {
                ctx.listeners.add(n.id);
                ctx.audience.add(n.id);
            }
            // Listeners stay for the set; a tale's listeners stay for the end
            if (near && (performing || (p.keepsCrowd && ctx.audience.has(n.id)))) _hold(n);
        }
        // While you perform, passers-by keep turning their heads
        if (performing) {
            ctx.pullTimer = (ctx.pullTimer || 0) + dt;
            if (ctx.pullTimer >= _num(_busk().pullEvery, 2)) { ctx.pullTimer = 0; _pull(ctx, ctx.pitch, this._radius(ctx)); }
        }
        if (performing && ctx.dropAt != null && m.held >= ctx.dropAt) {
            ctx.dropAt = null;
            const d = _busk().dropChance || {};
            ctx.setMult *= _num(d.mult, 0.6);
            ctx.note((_busk().lines || {}).drop);
        }
    },

    status(ctx) {
        if (!ctx.pitch) return 'Choose a pitch';
        const watching = _street().filter(n => _dist(n, ctx.pitch) <= _num(ctx.plan.listen, 5)).length;
        const extra = ctx.plan.choose === 'tones' ? ` · fervour ${Math.round(ctx.fervor)}` : '';
        return `Sets ${ctx.done}/${ctx.total} · ${watching} watching${extra}`;
    },
};

// ──────────────────────────────────────────────
// Fortune telling: read the passers-by
// ──────────────────────────────────────────────

const READINGS = {
    setup(ctx) {
        const p = ctx.plan;
        ctx.total = _ri(ctx.rng, p.count || [4, 5]);
        ctx.read = new Set();
        ctx.frozen = new Set();
        if (ctx.spec.state) ctx.spec.state.frozen = ctx.frozen;
        ctx.worth = 0;
        const me = _me();
        const folk = _street().filter(n => _dist(n, me) <= 45).sort((a, b) => _dist(a, me) - _dist(b, me));
        const picks = folk.slice(0, ctx.total);
        ctx.total = Math.max(1, picks.length);
        if (!picks.length) {
            ctx.note('The street is empty. Nobody to read for.');
            ctx.finish();
            return;
        }
        for (const npc of picks) this._markFor(ctx, npc);
    },

    _markFor(ctx, npc) {
        ctx.mark(npc, { glyph: ctx.plan.glyph || 'orb', label: `Read ${npc.name}'s fortune`, work: _num(ctx.plan.workSeconds, 1.5), follow: npc, npc, onDone: () => this._read(ctx, npc) });
    },

    _read(ctx, npc) {
        const b = _busk();
        const L = b.lines || {};
        const type = npc.type || 'villager';
        const tell = (b.tells || {})[type] || 'An ordinary face.';
        const choices = Performing.fortuneChoices(b.fortunes || [], type, ctx.rng);
        ctx.read.add(npc.id);
        npc._dialogFrozen = true;
        ctx.frozen.add(npc);
        const typeName = type.replace(/_npc$/, '').replace(/_/g, ' ');
        ctx.ask(_line(b.readingAsk, { name: npc.name, type: typeName, tell }), choices.map(f => f.text), (text) => {
            const f = choices.find(c => c.text === text);
            const fits = Performing.fortuneFits(f, type);
            const rf = b.readingFit || {};
            ctx.worth += fits ? _num(rf.fits, 1) : _num(rf.misses, 0.3);
            if (ctx.spec.state) ctx.spec.state.worth = ctx.worth;
            ctx.note(fits ? L.readFits : L.readMisses);
            npc._dialogFrozen = false;
            ctx.frozen.delete(npc);
            ctx.done++;
            if (ctx.done >= ctx.total) {
                ctx.quality = Math.max(0, Math.min(1, ctx.worth / ctx.total));
                ctx.finish();
            }
        });
    },

    tick(dt, ctx) {
        const me = _me();
        const street = new Set(_street());
        for (const m of ctx.marks.slice()) {
            const npc = m.npc;
            if (!npc) continue;
            if (!street.has(npc)) {
                // Gone indoors: someone else takes their place in the queue
                ctx.marks = ctx.marks.filter(x => x !== m);
                const taken = new Set([...ctx.read, ...ctx.marks.map(x => x.npc && x.npc.id)]);
                const next = [...street].filter(n => !taken.has(n.id)).sort((a, b) => _dist(a, me) - _dist(b, me))[0];
                if (next) this._markFor(ctx, next);
                else { ctx.total = Math.max(ctx.done, ctx.total - 1); if (ctx.done >= ctx.total) { ctx.quality = ctx.total ? Math.min(1, ctx.worth / ctx.total) : 0; ctx.finish(); return; } }
                continue;
            }
            m.q = npc.q; m.r = npc.r;
            // They stop for you when you come up to them
            const close = _dist(npc, me) <= 2;
            if (close && !npc._dialogFrozen) { npc._dialogFrozen = true; ctx.frozen.add(npc); }
            else if (!close && ctx.frozen.has(npc) && !m.held) { npc._dialogFrozen = false; ctx.frozen.delete(npc); }
        }
    },

    status(ctx) { return `Fortunes read ${ctx.done}/${ctx.total}`; },
};

// ──────────────────────────────────────────────
// Prayer rite: candle, circuit, kneel
// ──────────────────────────────────────────────

const RITE = {
    setup(ctx) {
        const c = _cfg().rite || {};
        const L = c.lines || {};
        const me = _me();
        const church = MapTasks.nearest(_churches(ctx, c.churchDoors), me.q, me.r);
        ctx.center = church || ctx.spots.square || _anywhere(ctx);
        const kind = ctx.plan.place === 'holy' ? 'holy' : church ? 'church' : 'wayside';
        ctx.spec.say = (c.say || {})[kind];
        ctx.stationsTotal = Math.max(1, _num(c.stations, 3));
        ctx.total = 1 + ctx.stationsTotal + 1; // candle, stations, kneel
        ctx.knelt = 0;
        ctx.disturbances = 0;
        ctx.near = new Set();
        ctx.mark(ctx.center, { glyph: 'candle', label: `${L.candle || 'Light a candle'}${church && church.name ? ` at the ${church.name}` : ''}`, work: _num(c.candleSeconds, 2), onDone: () => {
            ctx.done++;
            ctx.note(L.candleLit);
            ctx.stations = this._stations(ctx, c);
            ctx.stationsTotal = ctx.stations.length;
            ctx.total = 1 + ctx.stationsTotal + 1;
            this._nextStation(ctx, 0);
        } });
    },

    /** Stations round the centre, in walking order (by angle from where you stand). */
    _stations(ctx, c) {
        const [lo, hi] = c.stationGap || [4, 9];
        const pool = [...ctx.spots.plaza, ...ctx.spots.roads, ...ctx.spots.ground].filter(s => {
            const d = _dist(s, ctx.center);
            return d >= lo && d <= hi;
        });
        const picks = MapTasks.pickSpread(pool.length ? pool : ctx.spots.roads, ctx.stationsTotal, ctx.rng, Math.max(3, lo));
        const ang = s => Math.atan2(s.r - ctx.center.r, s.q - ctx.center.q);
        const start = ang(_me());
        const rel = s => ((ang(s) - start) + Math.PI * 4) % (Math.PI * 2);
        return picks.sort((a, b) => rel(a) - rel(b));
    },

    _nextStation(ctx, i) {
        const c = _cfg().rite || {};
        const L = c.lines || {};
        if (i >= ctx.stations.length) { this._kneel(ctx); return; }
        ctx.mark(ctx.stations[i], { glyph: 'temple', label: _line(L.station, { i: i + 1, n: ctx.stations.length }), work: _num(c.stationSeconds, 1.5), onDone: () => {
            ctx.done++;
            this._nextStation(ctx, i + 1);
        } });
    },

    _kneel(ctx) {
        const L = (_cfg().rite || {}).lines || {};
        ctx.kneeling = true;
        ctx.mark(ctx.center, { glyph: 'candle', label: L.kneel || 'Kneel and pray', passive: true });
    },

    tick(dt, ctx) {
        if (!ctx.kneeling) return;
        const c = _cfg().rite || {};
        const me = _me();
        const at = _dist(me, ctx.center) <= 1 && !InnerMap._playerWalking;
        if (!at) { ctx.near.clear(); ctx._settled = false; return; }
        if (!ctx._settled) {
            ctx._settled = true;
            try { if (InnerMap.startInteraction) InnerMap.startInteraction(ctx.center.q, ctx.center.r, null, 0, 'emotes'); } catch (e) { /* cosmetic */ }
            // Whoever is already standing here doesn't count against you
            for (const n of _street()) if (_dist(n, me) <= _num(c.disturbRadius, 2)) ctx.near.add(n.id);
        }
        ctx.knelt += dt;
        for (const n of _street()) {
            const close = _dist(n, me) <= _num(c.disturbRadius, 2);
            if (close && !ctx.near.has(n.id)) {
                ctx.disturbances++;
                ctx.note(_line((c.lines || {}).disturbed, { name: n.name || 'Someone' }));
            }
            if (close) ctx.near.add(n.id); else ctx.near.delete(n.id);
        }
        if (ctx.knelt >= _num(c.kneelSeconds, 10)) {
            ctx.done++;
            ctx.kneeling = false;
            ctx.spec.state.disturbances = ctx.disturbances;
            ctx.quality = Math.max(0.4, 1 - ctx.disturbances * _num(c.perDisturb, 0.08));
            ctx.finish();
        }
    },

    status(ctx) {
        if (ctx.kneeling) return `Kneeling ${Math.floor(ctx.knelt)}/${_num((_cfg().rite || {}).kneelSeconds, 10)}s${ctx.disturbances ? ` · disturbed ${ctx.disturbances}×` : ''}`;
        if (!ctx.stations) return 'The candle';
        return `Stations ${Math.max(0, ctx.done - 1)}/${ctx.stations.length}`;
    },
};

// ──────────────────────────────────────────────
// Meditation: a quiet spot, sat still
// ──────────────────────────────────────────────

/** How busy a place is now: folk within 6 tiles, and the square counts as busy. */
function _busyness(ctx, at) {
    let n = _street().filter(x => _dist(x, at) <= 6).length;
    if (ctx.spots.square && _dist(at, ctx.spots.square) <= 8) n += 3;
    return n;
}

const STILLNESS = {
    setup(ctx) {
        const c = _cfg().meditation || {};
        const L = c.lines || {};
        const me = _me();
        ctx.total = 1;
        ctx.sat = 0;
        ctx.disturbances = 0;
        ctx.breaks = 0;
        ctx.near = new Set();
        const options = [];
        for (const def of c.spots || []) {
            let places = [];
            if (def.props) places = places.concat(MapTasks.propsOf(ctx.spots, def.props));
            if (def.doors) places = places.concat(MapTasks.doorsOf(ctx.spots, def.doors));
            if (def.ground === 'edge') places = places.concat(MapTasks.pickSpread(ctx.spots.ground.filter(g => g.edge), 12, ctx.rng, 6));
            // The quietest of its kind that isn't a long walk away
            const ranked = places.filter(p => _dist(p, me) <= 50).map(p => ({ p, busy: _busyness(ctx, p) + _dist(p, me) / 15 })).sort((a, b) => a.busy - b.busy);
            if (ranked.length) options.push({ at: ranked[0].p, label: def.label, busy: ranked[0].busy });
        }
        options.sort((a, b) => a.busy - b.busy);
        const chosen = [];
        for (const o of options) {
            if (chosen.length >= _num(c.candidates, 3)) break;
            if (!chosen.some(x => _dist(x.at, o.at) < 5)) chosen.push(o);
        }
        if (!chosen.length) chosen.push({ at: _anywhere(ctx), label: L.sit || 'Sit here' });
        for (const o of chosen) {
            ctx.mark(o.at, { glyph: 'chair', label: o.label, work: 0.5, onDone: () => {
                ctx.clear();
                ctx.seat = { q: o.at.q, r: o.at.r };
                ctx.mark(ctx.seat, { glyph: 'chair', label: L.sit || 'Sit still and breathe', passive: true });
                ctx.note(L.sitting);
            } });
        }
    },

    tick(dt, ctx) {
        if (!ctx.seat) return;
        const c = _cfg().meditation || {};
        const L = c.lines || {};
        const me = _me();
        const at = _dist(me, ctx.seat) <= 1 && !InnerMap._playerWalking;
        if (!at) {
            if (ctx._settled) { ctx.breaks++; ctx.note(L.broke); }
            ctx._settled = false;
            ctx.near.clear();
            return;
        }
        if (!ctx._settled) {
            ctx._settled = true;
            try { if (InnerMap.startInteraction) InnerMap.startInteraction(ctx.seat.q, ctx.seat.r, null, 0, 'emotes'); } catch (e) { /* cosmetic */ }
            for (const n of _street()) if (_dist(n, me) <= _num(c.disturbRadius, 3)) ctx.near.add(n.id);
        }
        ctx.sat += dt;
        for (const n of _street()) {
            const close = _dist(n, me) <= _num(c.disturbRadius, 3);
            if (close && !ctx.near.has(n.id)) {
                ctx.disturbances++;
                ctx.note(_line(L.disturbed, { name: n.name || 'Someone' }));
            }
            if (close) ctx.near.add(n.id); else ctx.near.delete(n.id);
        }
        const needed = _num(c.sitSeconds, 30);
        if (ctx.sat >= needed) {
            ctx.done = 1;
            const st = ctx.spec.state;
            Object.assign(st, { sat: ctx.sat, needed, disturbances: ctx.disturbances, breaks: ctx.breaks });
            ctx.quality = Performing.stillnessQuality({ ...st, stat: ctx.stat, holy: !!ctx.plan.holy }, c);
            ctx.finish();
        }
    },

    status(ctx) {
        if (!ctx.seat) return 'Find a quiet spot';
        const needed = _num((_cfg().meditation || {}).sitSeconds, 30);
        return `Stillness ${Math.floor(ctx.sat)}/${needed}s${ctx.disturbances ? ` · disturbed ${ctx.disturbances}×` : ''}`;
    },
};

export const PERFORM_TEMPLATES = { perform: PERFORM, readings: READINGS, rite: RITE, stillness: STILLNESS };

// ──────────────────────────────────────────────
// Starting them
// ──────────────────────────────────────────────

/** Start on the street, or run `fallback` when there is no street to go to. */
function _run(game, makeSpec, fallback) {
    if (!InnerMap.active && !(game && game.enterInnerMap)) { fallback(); return; }
    InnerMapTasks.ensureStreet(game, () => {
        const ok = InnerMapTasks.start(game, makeSpec());
        if (!ok) fallback();
    });
}

/** Let go of anyone a fortune teller stopped in the street. */
function _release(state) {
    for (const n of (state && state.frozen) || []) n._dialogFrozen = false;
    if (state && state.frozen) state.frozen.clear();
}

export const PerformTasks = {
    TEMPLATES: PERFORM_TEMPLATES,

    /**
     * Busk in person. onScore(0–100) gets the score for the busking reward;
     * onAbandon(partialScore, info) when they pack up early.
     */
    busk(game, { perfId, title, icon, stat = 5, crowdMult = 1, onScore, onAbandon }) {
        const act = Performing.act(perfId) || { sets: 3, setSeconds: 6, pull: 12, listen: 5, parHours: 1.5 };
        const plan = { ...act, expected: Performing.expectedCrowd(crowdMult, _busk()) };
        const tpl = act.mode === 'readings' ? READINGS : PERFORM;
        const state = {};
        _run(game, () => ({
            title, icon, say: act.say, plan, stat, custom: tpl, state,
            onComplete: (score, info) => { _release(state); onScore(Performing.performScore(info), info); },
            onAbandon: (info) => {
                _release(state);
                if (!onAbandon) return;
                // Packed up early: paid for the sets done, at half rate
                const quality = act.mode === 'readings'
                    ? (info.done ? Math.min(1, _num(state.worth) / info.done) : 0)
                    : Performing.crowdQuality(state.values || [], plan.expected);
                onAbandon(info.done > 0 ? Math.round(Performing.performScore({ ...info, quality }) * 0.5) : 0, info);
            },
        }), () => onScore(40, null));
    },

    /**
     * A prayer rite in person at the church (or shrine, or the square).
     * onQuality(0..1) gets the rite's quality for the devotion model.
     */
    rite(game, { place = 'temple', stat = 5, title = 'Prayer', icon = '🙏', onQuality, onAbandon }) {
        const c = _cfg().rite || {};
        const state = {};
        _run(game, () => ({
            title, icon, plan: { parHours: _num(c.parHours, 1), place }, stat, custom: RITE, state,
            onComplete: (score, info) => onQuality(Performing.riteQuality({ ...info, disturbances: state.disturbances || 0, stat, perDisturb: c.perDisturb }), info),
            onAbandon: (info) => { if (onAbandon) onAbandon(info); },
        }), () => onQuality(0.5, null));
    },

    /** Meditate in person at a quiet spot. onQuality(0..1) for the devotion model. */
    meditate(game, { holy = false, stat = 5, onQuality, onAbandon }) {
        const c = _cfg().meditation || {};
        const state = {};
        _run(game, () => ({
            title: 'Meditation', icon: '🧘',
            say: (c.say || {})[holy ? 'holy' : 'field'],
            plan: { parHours: _num(c.parHours, 1.5), holy }, stat, custom: STILLNESS, state,
            onComplete: (score, info) => onQuality(info.quality, info),
            onAbandon: (info) => { if (onAbandon) onAbandon(info); },
        }), () => onQuality(0.5, null));
    },
};
