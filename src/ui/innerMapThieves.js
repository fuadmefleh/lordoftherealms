// ============================================
// INNER MAP THIEVES — burglars and cutpurses on the street map
// ============================================
// The UI half of systems/npcTheft.js, while the player walks a town:
//
//   BURGLARS — at night, tonight's burglary of the town (NpcTheft.planBurglary:
//   the same plan the day's end would resolve off the map) plays out: the
//   thief slips out of their home (or an outlaw creeps in from the edge),
//   creeps to the house's door and goes in, rummages, and comes out with the
//   goods (NpcTheft.commitBurglary) to slip away off the map. A guard who
//   sees them gives chase; a player who sees them gets the choice (the
//   'catch_thief' scene, ui/actionMenu/thiefScenes.js): seize them, shout
//   for the watch, fight them, or let it be. A house whose door was forced
//   shows its door splintered for some days.
//
//   CUTPURSES — by day, in a crowd (the market, the square), now and then a
//   crooked townsperson or a sly child sidles up to a mark — a townsperson or
//   the player — brushes past (✋) and lifts (NpcTheft.lift: their skill
//   against the mark's awareness; fewer where the watch walks). A townsperson
//   who notices cries "Thief!", the thief runs, the watch gives chase. The
//   player who notices gets the same choice; one who doesn't finds out a
//   little later ("Your purse feels light…").
//
// The chase: a guard runs the thief down (caught: the goods go back, the
// thief to the cells) or the thief reaches the map's edge. Everything goes
// on the town's record as the thief's crime (StreetCrime.recordNpcCrime).
// Rolls are hashes of the seed, the town, the day and the game clock, never
// the shared RNG.

import { InnerMap } from '../world/innerMap.js';
import { NpcTheft } from '../systems/npcTheft.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { ActionMenu } from './actionMenu.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const _seed = world => (world && world.generationParams && world.generationParams.seed) || 0;

function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _line(pool, key) {
    const list = (NpcTheft.config().barks || {})[pool] || [];
    return list.length ? list[Math.floor(_frac(key) * list.length) % list.length] : null;
}

export const InnerMapThieves = {
    _tiles: null,
    _clock: 0,
    _tick: 0,
    _nextPick: null,
    // npc.id → actor { mode: 'burgle'|'cutpurse', ... }
    _actors: new Map(),
    // guard id → { thiefId, left, repath, speed }
    _chasers: new Map(),
    // delayed word to the player: [{ at, title, text, entry }]
    _tells: [],
    // thieves the watch is leading off: [{ npc, at }]
    _taken: [],

    _town() {
        const ref = InnerMap._currentWorldTileRef;
        return ref && ref.settlement && ref.settlement.folk ? ref.settlement : null;
    },

    _npc(id) {
        return (InnerMap.npcs || []).find(n => n && n.id === id) || null;
    },

    _player() {
        return { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
    },

    /** A new map: forget the last one's thieves, and learn who lives where. */
    _reset(s) {
        this._tiles = InnerMap.tiles;
        this._actors.clear();
        this._chasers.clear();
        this._taken = [];
        this._nextPick = null;
        if (!s) return;
        for (const b of InnerMap.buildings || []) {
            if (!b || b.type !== 'house' || b.ownerId == null || b.isPlayerOwned) continue;
            const npc = this._npc(b.ownerId);
            if (npc && npc._person) NpcTheft.noteHome(s, npc._person.id, b);
        }
    },

    update(dt, game) {
        if (!InnerMap.active || !game || !game.world) return;
        const s = this._town();
        if (this._tiles !== InnerMap.tiles) this._reset(s);
        if (!s) return;
        this._clock += dt;
        this._day = _num(game.world.day);
        this._tellDue(game);
        if (this._taken.length) {
            for (const t of this._taken) if (this._clock >= t.at) t.npc.state = 'gone';
            this._taken = this._taken.filter(t => this._clock < t.at);
        }
        this._tick -= dt;
        if (this._tick > 0) return;
        this._tick = 0.5;
        this._runChases(game, s, 0.5);
        for (const [id, a] of [...this._actors]) {
            const npc = this._npc(id);
            if (!npc || npc.state === 'gone') { this._lost(game, s, a); this._actors.delete(id); continue; }
            if (a.mode === 'burgle') this._burgleStep(game, s, npc, a);
            else this._cutpurseStep(game, s, npc, a);
        }
        if (InnerMap._insideBuilding) return;
        const night = NpcTheft.isNight(InnerMap.timeOfDay);
        if (night) this._maybeBurgle(game, s);
        else this._maybeCutpurse(game, s);
    },

    // ──────────── BURGLARS ────────────

    _maybeBurgle(game, s) {
        if ([...this._actors.values()].some(a => a.mode === 'burgle')) return;
        const world = game.world;
        const day = _num(world.day);
        const plan = NpcTheft.planBurglary(world, s, day, game.player);
        if (!plan || this._triedNight === `${s.q},${s.r}|${day}`) return;
        this._triedNight = `${s.q},${s.r}|${day}`;
        const st = NpcTheft.state(s);
        const bkey = st.homes[plan.target.pid];
        const house = bkey ? (InnerMap.buildings || []).find(b => `${b.type}@${b.q},${b.r}` === bkey) : null;
        if (!house) return; // (not on this map: the day's end resolves it)
        let npc = plan.thief.pid != null ? (InnerMap.npcs || []).find(n => n._person && n._person.id === plan.thief.pid && n.state !== 'gone') : null;
        if (!npc && plan.thief.kind === 'outlaw') npc = this._spawnOutlaw(plan);
        if (!npc) return;
        // Out of bed and into the night
        if (npc.state === 'inside_building') {
            if (npc._outsideQ != null) { npc.q = npc.prevQ = npc._outsideQ; npc.r = npc.prevR = npc._outsideR; }
            npc.state = 'idle';
            npc.currentBuilding = null;
            npc._insideBuildingQ = undefined;
            npc._insideBuildingR = undefined;
            npc._asleep = false;
        }
        npc._thief = true;
        const a = { mode: 'burgle', npcId: npc.id, plan, house, phase: 'creep', tries: 0, t: 0, seenBy: [], witnesses: [], playerSaw: false, case: null };
        this._actors.set(npc.id, a);
        this._goDoor(npc, a);
        InnerMapReactions.bark(npc, _line('creep', `${plan.key}|creep`), 2.5);
    },

    _spawnOutlaw(plan) {
        let x = (_frac(`${plan.key}|spawn`) * 1e9) >>> 0;
        const rng = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
        const id = (InnerMap.npcs || []).reduce((m, n) => Math.max(m, _num(n.id)), 0) + 1;
        const npc = InnerMap._makeNpc && InnerMap._makeNpc('villager', id, rng);
        if (!npc) return null;
        const edge = InnerMap._findNearestEdgeTile(npc.q, npc.r);
        if (edge) { npc.q = npc.prevQ = edge.q; npc.r = npc.prevR = edge.r; }
        npc.name = 'Hooded stranger';
        npc.roleTitle = 'Outlaw';
        npc._outlaw = true;
        InnerMap.npcs.push(npc);
        return npc;
    },

    _goDoor(npc, a) {
        a.tries++;
        npc.path = null;
        if (!InnerMap._goInto(npc, a.house, 'burgle')) return false;
        npc._stayFor = _num(NpcTheft.config().burglary.rummageSeconds, 10);
        return true;
    },

    _atHouse(npc, a) {
        return npc.state === 'inside_building' && npc._insideBuildingQ === a.house.q && npc._insideBuildingR === a.house.r;
    },

    _burgleStep(game, s, npc, a) {
        a.t += 0.5;
        if (a.phase === 'creep') {
            if (this._atHouse(npc, a)) { a.phase = 'inside'; a.t = 0; return; }
            if (npc.state === 'idle') {
                if (a.tries > 4) { this._abandon(game, s, npc, a); return; }
                this._goDoor(npc, a);
            }
            if (a.t > 90) { this._abandon(game, s, npc, a); return; }
        } else if (a.phase === 'inside') {
            // Out again with the goods
            if (!this._atHouse(npc, a)) {
                a.case = NpcTheft.commitBurglary(game.world, s, a.plan, game.player, { caught: false, seenBy: a.seenBy, witnesses: a.witnesses });
                a.phase = 'away';
                this._leave(npc, false);
            }
            return;
        } else if (a.phase === 'away') {
            if (npc.state === 'idle' && !npc.departing) this._leave(npc, false);
        }
        this._watchFor(game, s, npc, a, 'burglary');
    },

    /** Someone sees the thief outdoors: a guard gives chase, the player gets the choice. */
    _watchFor(game, s, npc, a, kind) {
        if (npc.state === 'inside_building' || a.chased) return;
        const radius = _num(StreetCrime.config().sight && StreetCrime.config().sight.radius, 7);
        for (const g of InnerMap.npcs || []) {
            if (!g || g.type !== 'guard' || g.state === 'inside_building' || g.state === 'gone' || g._dialogFrozen) continue;
            if (_dist(g, npc) > radius) continue;
            a.seenBy.push(g.name);
            a.witnesses.push(g);
            this._chase(game, s, g, npc, a);
            return;
        }
        if (!a.playerSaw && _dist(this._player(), npc) <= radius && !game._scene) {
            a.playerSaw = true;
            a.seenBy.push(game.player.name || 'you');
            ActionMenu.showScene(game, 'catch_thief', { npcId: npc.id, kind, name: npc.name || 'someone', phase: a.phase });
        }
    },

    _leave(npc, run) {
        if (run) { InnerMapReactions._flee(npc, { indoors: false }); return; }
        const edge = InnerMap._findNearestEdgeTile(npc.q, npc.r);
        const path = edge ? InnerMap._findPath(npc.q, npc.r, edge.q, edge.r) : null;
        if (!path || path.length < 2) { npc.state = 'gone'; return; }
        npc.departing = true;
        npc.path = path.slice(1);
        npc.pathIndex = 0;
        npc.moveProgress = 0;
        npc.prevQ = npc.q;
        npc.prevR = npc.r;
        npc.state = 'walking';
    },

    /** The thief gives up (spotted before they got in, or no way to the door): nothing taken tonight. */
    _abandon(game, s, npc, a) {
        const st = NpcTheft.state(s);
        st.night = a.plan.day;
        if (a.seenBy.length) {
            StreetCrime.recordNpcCrime(game.world, s, { k: 'burglary', by: a.plan.thief.name, byPid: a.plan.thief.pid, victim: a.plan.target.name, vuid: `pid${a.plan.target.pid}`, d: a.plan.day, seenBy: a.seenBy, witnesses: a.witnesses, caught: false });
        }
        npc._thief = false;
        a.phase = 'done';
        this._actors.delete(npc.id);
        if (npc._outlaw) this._leave(npc, true);
    },

    // ──────────── CUTPURSES ────────────

    _maybeCutpurse(game, s) {
        if ([...this._actors.values()].some(a => a.mode === 'cutpurse')) return;
        const P = NpcTheft.config().pickpocket;
        const world = game.world;
        const day = _num(world.day);
        const sec = Math.floor(this._clock);
        if (this._nextPick == null) {
            const [lo, hi] = P.everySeconds || [25, 55];
            this._nextPick = this._clock + lo + _frac(`${_seed(world)}|cpNext|${s.q},${s.r}|${day}|${sec}`) * (hi - lo);
            return;
        }
        if (this._clock < this._nextPick) return;
        this._nextPick = null;
        const npcs = (InnerMap.npcs || []).filter(n => n && n.state !== 'gone' && n.state !== 'inside_building' && !n._dialogFrozen && !n._thief && !n._taskFoe && !n.departing);
        const thieves = npcs.filter(n => n._person && n.type !== 'guard' && NpcTheft.isCutpurse(s, n._person, world, day));
        if (!thieves.length) return;
        const key = `${_seed(world)}|cpOn|${s.q},${s.r}|${day}|${sec}`;
        const thief = thieves[Math.floor(_frac(`${key}|who`) * thieves.length) % thieves.length];
        // Marks in a crowd, weighed by how rich they look and how few of the watch are near
        const guards = npcs.filter(n => n.type === 'guard');
        const crowd = m => npcs.filter(n => n !== m && _dist(n, m) <= 5).length;
        const watchNear = m => guards.filter(g => _dist(g, m) <= _num(P.watchRadius, 6)).length;
        const W = NpcTheft.config().roleWealth;
        const marks = [];
        for (const m of npcs) {
            if (m === thief || !m._person || m.type === 'guard' || m.type === 'child' || m.type === 'beggar') continue;
            if (crowd(m) < _num(P.crowdMin, 4)) continue;
            marks.push({ w: (1 + _num(W[m._person.role], 1) * 2) * NpcTheft.watchFactor(s, watchNear(m)), m });
        }
        const pl = this._player();
        if (_num(game.player.gold) > 0 && npcs.filter(n => _dist(n, pl) <= 5).length >= _num(P.crowdMin, 4)) {
            const looks = Math.min(3, 0.5 + _num(game.player.gold) / Math.max(1, _num(P.playerGoldLooks, 400)));
            const royal = StreetCrime.aboveLaw(game.player, world, s) ? _num(P.rulerWatchMult, 0.5) : 1;
            marks.push({ w: (1 + 4 * looks) * NpcTheft.watchFactor(s, watchNear(pl)) * royal, m: 'player' });
        }
        if (!marks.length) return;
        const total = marks.reduce((t, x) => t + x.w, 0);
        // The watch's presence, the hour: most chances come to nothing
        if (_frac(`${key}|go`) >= Math.min(0.6, 0.08 * total / marks.length)) return;
        let f = _frac(`${key}|mark`) * total;
        let pick = marks[marks.length - 1];
        for (const x of marks) { f -= x.w; if (f < 0) { pick = x; break; } }
        thief._thief = true;
        const a = { mode: 'cutpurse', npcId: thief.id, mark: pick.m === 'player' ? 'player' : pick.m.id, key, phase: 'approach', t: 0, repath: 0, seenBy: [], witnesses: [], thief: NpcTheft.thiefOf(s, thief._person, day) };
        this._actors.set(thief.id, a);
    },

    _markOf(a) {
        return a.mark === 'player' ? this._player() : this._npc(a.mark);
    },

    _cutpurseStep(game, s, npc, a) {
        a.t += 0.5;
        if (a.phase === 'done') return;
        if (a.phase === 'away') {
            if (npc.state === 'gone' || a.t > 30) { npc._thief = false; this._actors.delete(npc.id); }
            return;
        }
        const mark = this._markOf(a);
        if (!mark || (mark.state && (mark.state === 'gone' || mark.state === 'inside_building')) || a.t > 25) {
            npc._thief = false;
            this._actors.delete(npc.id);
            return;
        }
        if (_dist(npc, mark) > 1) {
            a.repath -= 0.5;
            if (a.repath <= 0 || npc.state === 'idle') {
                a.repath = 1.5;
                const spot = InnerMap._findPassableAdjacentTile(mark.q, mark.r);
                if (spot) { npc._activity = null; InnerMap._walkTo(npc, spot); }
            }
            return;
        }
        // The brush past, and the hand
        npc.path = null;
        npc.state = 'idle';
        npc.idleTimer = 3;
        InnerMapReactions.bark(npc, _line('sleight', `${a.key}|sl`) || '✋', 1.2);
        a.phase = 'done';
        if (a.mark === 'player') this._liftPlayer(game, s, npc, a);
        else this._liftNpc(game, s, npc, a, mark);
    },

    _liftPlayer(game, s, npc, a) {
        const world = game.world;
        const res = NpcTheft.lift(a.thief.skill, NpcTheft.awareness('player', game.player, _num(world.day)), a.key);
        if (res.noticed) {
            npc._dialogFrozen = true;
            a.phase = 'caught_in_act';
            ActionMenu.showScene(game, 'catch_thief', { npcId: npc.id, kind: 'pickpocket', name: npc.name || 'someone', key: a.key });
            return;
        }
        if (!res.ok) { this._release(npc, a); return; }
        // Who saw it: anyone near enough who'd tell the player later
        const near = (InnerMap.npcs || []).filter(n => n !== npc && n._person && n.state !== 'inside_building' && _dist(n, npc) <= 3 && n.type !== 'child');
        const seenBy = near.length && _frac(`${a.key}|seen`) < 0.3 ? [near[0].name] : [];
        const out = NpcTheft.liftFromPlayer(world, game.player, s, a.thief, a.key, { result: res, seenBy, named: seenBy.length > 0 });
        if (out.entry) {
            const [lo, hi] = NpcTheft.config().pickpocket.tellAfterSeconds || [15, 40];
            this._tells.push({ at: this._clock + lo + _frac(`${a.key}|tell`) * (hi - lo), entry: out.entry, text: out.text });
        }
        this._release(npc, a);
    },

    _liftNpc(game, s, npc, a, mark) {
        const world = game.world;
        const res = NpcTheft.lift(a.thief.skill, NpcTheft.awareness(mark), a.key);
        let witnesses = [];
        if (res.noticed) witnesses = StreetCrime.selectWitnesses(InnerMap.npcs || [], { q: mark.q, r: mark.r, indoors: false }, mark).filter(w => w.seen && w.npc !== npc).map(w => w.npc);
        const c = NpcTheft.liftFromNpc(world, s, { thief: a.thief, mark: mark._person, key: a.key, result: res, caught: false, seenBy: [mark.name, ...witnesses.slice(0, 2).map(n => n.name)], witnesses });
        if (!res.noticed) { this._release(npc, a); return; }
        InnerMapReactions.bark(mark, _line('victim', `${a.key}|v`) || 'Thief!', 3);
        a.case = c;
        this._fleeFrom(game, s, npc, a, { q: mark.q, r: mark.r });
    },

    _release(npc, a) {
        npc._thief = false;
        a.phase = 'away';
        a.t = 0;
        npc.state = 'idle';
        npc.idleTimer = 1;
    },

    /** The thief runs; the watch within earshot gives chase. */
    _fleeFrom(game, s, npc, a, at) {
        npc._dialogFrozen = false;
        a.phase = 'away';
        a.t = 0;
        a.fled = true;
        InnerMapReactions.bark(npc, _line('flee', `${a.key || a.plan && a.plan.key}|fl`), 2);
        InnerMapReactions._flee(npc, { indoors: false });
        const hear = _num(NpcTheft.config().pickpocket.hearRadius, 12);
        const guards = (InnerMap.npcs || []).filter(g => g.type === 'guard' && g.state !== 'inside_building' && g.state !== 'gone' && !g._dialogFrozen && _dist(g, at) <= hear)
            .sort((x, y) => _dist(x, at) - _dist(y, at));
        for (const g of guards.slice(0, 2)) this._chase(game, s, g, npc, a);
        return guards.length;
    },

    // ──────────── THE CHASE ────────────

    _chase(game, s, guard, thief, a) {
        if (this._chasers.has(guard.id)) return;
        a.chased = true;
        this._chasers.set(guard.id, { thiefId: thief.id, left: 30, repath: 0, speed: guard.speed });
        guard.speed = (guard.speed || 0.3) * 2.6;
        InnerMapReactions.bark(guard, _line('guard', `${guard.id}|${thief.id}`) || 'Halt, thief!', 2.5);
        if (!thief.departing) InnerMapReactions._flee(thief, { indoors: false });
    },

    _runChases(game, s, dt) {
        for (const [gid, ch] of [...this._chasers]) {
            const g = this._npc(gid);
            const t = this._npc(ch.thiefId);
            const a = this._actors.get(ch.thiefId);
            ch.left -= dt;
            const end = () => { if (g) g.speed = ch.speed; this._chasers.delete(gid); };
            if (!g || g.state === 'gone') { end(); continue; }
            if (!t || t.state === 'gone' || ch.left <= 0) { end(); continue; }
            if (_dist(g, t) <= 1) {
                end();
                for (const [oid, o] of [...this._chasers]) if (o.thiefId === ch.thiefId) { const og = this._npc(oid); if (og) og.speed = o.speed; this._chasers.delete(oid); }
                this._caught(game, s, t, a, g.name);
                continue;
            }
            ch.repath -= dt;
            if (ch.repath <= 0) {
                ch.repath = 1;
                const path = InnerMap._findPath(g.q, g.r, t.q, t.r);
                if (path && path.length > 1) {
                    g.path = path.slice(1);
                    g.pathIndex = 0;
                    g.moveProgress = 0;
                    g.prevQ = g.q;
                    g.prevR = g.r;
                    g.state = 'walking';
                    g._activity = null;
                }
            }
        }
    },

    /** Run down (or seized): the goods go back, the thief to the cells — off the map. */
    _caught(game, s, thief, a, by) {
        const world = game.world;
        thief.path = null;
        thief.departing = false;
        thief.state = 'idle';
        thief.idleTimer = 3;
        thief._dialogFrozen = false;
        InnerMapReactions.bark(thief, _line('caught', `${thief.id}|c`) || 'Let go of me!', 2.5);
        if (a) {
            const tdata = a.thief || (a.plan && a.plan.thief);
            if (a.mode === 'burgle') {
                if (a.case) NpcTheft.catchCase(world, s, a.case, game.player);
                else {
                    a.case = NpcTheft.commitBurglary(world, s, a.plan, game.player, { caught: true, seenBy: [...a.seenBy, by].filter(Boolean), witnesses: a.witnesses });
                }
            } else if (a.case && a.case.status === 'done') {
                NpcTheft.catchCase(world, s, a.case, game.player);
            } else if (tdata) {
                const victim = a.mark === 'player' ? (game.player.name || 'you') : (a.case && a.case.victim.name) || 'someone';
                NpcTheft.thiefCaught(world, s, tdata, victim, a.mark === 'player' ? 'player' : `pid${a.mark}`, [by].filter(Boolean), a.witnesses);
                if (a.case && a.case.status === 'noticed') a.case.status = 'caught';
            }
            a.phase = 'done';
            this._actors.delete(thief.id);
        }
        // Taken away by the watch
        this._taken.push({ npc: thief, at: this._clock + 2.5 });
        thief._thief = false;
    },

    _lost(game, s, a) {
        // A burglar gone off the map before they got in: the night is spent
        if (a.mode === 'burgle' && a.phase === 'creep') NpcTheft.state(s).night = a.plan.day;
    },

    // ──────────── THE PLAYER'S CHOICE ────────────

    /** The 'catch_thief' scene's options (ui/actionMenu/thiefScenes.js). */
    view(game, st) {
        const npc = this._npc(st.npcId);
        const a = npc && this._actors.get(npc.id);
        if (!npc || !a || npc.state === 'gone') return null;
        const s = this._town();
        const thief = a.thief || (a.plan && a.plan.thief) || { skill: 3 };
        const pick = st.kind === 'pickpocket';
        const near = _dist(this._player(), npc) <= 2;
        return {
            icon: pick ? '👛' : '🚪',
            title: pick ? 'A Hand at Your Purse' : 'A Figure at the Door',
            stats: [npc.name || 'someone', (s && s.name) || 'town'],
            text: pick
                ? `You feel fingers at your purse and turn — ${npc.name || 'someone'} is right there, hand still out.`
                : `In the dark, ${npc.name || 'someone'} is ${a.phase === 'away' ? 'slipping away from' : 'at'} the door of ${a.plan.target.name}'s house${a.plan.force ? ', working at it with a bar' : ''}.`,
            options: [
                { id: 'grab', icon: '✊', label: 'Seize them', hint: near ? 'Grab them and hold on until the watch comes.' : 'Run at them and grab hold.', chance: NpcTheft.grabChance(game.player, thief) },
                { id: 'shout', icon: '📣', label: 'Shout "Thief!"', hint: 'Raise the alarm: the watch gives chase.', chance: null, odds: false },
                { id: 'fight', icon: '⚔️', label: 'Fight them', hint: 'A thief caught in the act is fair game.', chance: null, odds: false },
                { id: 'let', icon: '🤷', label: 'Let it be', hint: pick ? 'Let them go.' : 'Not your house, not your business.', chance: null, odds: false },
            ],
        };
    },

    act(game, st, choice) {
        const npc = this._npc(st.npcId);
        const a = npc && this._actors.get(npc.id);
        const s = this._town();
        if (!npc || !a || !s) return { notification: { title: 'Gone', body: 'They have slipped away.', type: 'info' } };
        const thief = a.thief || (a.plan && a.plan.thief) || { name: npc.name, skill: 3 };
        const pick = st.kind === 'pickpocket';
        switch (choice) {
            case 'grab': {
                if (_frac(`${a.key || a.plan.key}|grab|${Math.floor(this._clock)}`) < NpcTheft.grabChance(game.player, thief)) {
                    a.seenBy.push(game.player.name || 'you');
                    this._caught(game, s, npc, a, game.player.name || 'you');
                    return { notification: { title: '✊ Caught!', body: `You seize ${npc.name} and hold on until the watch comes to take them.${pick ? ' Your purse is safe.' : ''}`, type: 'success' } };
                }
                this._fleeFrom(game, s, npc, a, { q: npc.q, r: npc.r });
                return { notification: { title: '🏃 Slipped Away', body: `${npc.name} twists out of your grip and runs.`, type: 'warning' } };
            }
            case 'shout': {
                const n = this._fleeFrom(game, s, npc, a, this._player());
                return { notification: { title: '📣 "Thief!"', body: n ? 'The watch comes running after them.' : 'You shout, but no one of the watch is near enough to hear.', type: n ? 'info' : 'warning' } };
            }
            case 'fight': {
                npc._dialogFrozen = false;
                npc._taskFoe = { onYield: () => { npc._taskFoe = null; this._caught(game, s, npc, a, game.player.name || 'you'); } };
                InnerMapCombat.startAttackNPC(game, npc);
                return { notification: { title: '⚔️ Have at the Thief', body: `You go for ${npc.name}.`, type: 'info' } };
            }
            default: return this.letBe(game, st);
        }
    },

    /** Let them go: a cutpurse slinks off, a burglar goes on. */
    letBe(game, st) {
        const npc = this._npc(st.npcId);
        const a = npc && this._actors.get(npc.id);
        if (!npc || !a) return null;
        npc._dialogFrozen = false;
        if (a.mode === 'cutpurse') { this._release(npc, a); this._leave(npc, false); }
        return { notification: { title: 'Let Be', body: 'You let it go.', type: 'info' } };
    },

    // ──────────── WORD LATER ────────────

    _tellDue(game) {
        if (!this._tells.length) return;
        const due = this._tells.filter(t => this._clock >= t.at);
        if (!due.length) return;
        this._tells = this._tells.filter(t => this._clock < t.at);
        for (const t of due) {
            if (t.entry) t.entry.told = true;
            if (game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification('👛 Purse Cut', t.text, 'warning');
            if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        }
    },

    // ──────────── DRAWING ────────────

    /** Splintered doors: a house broken into lately. */
    render(ctx, camera) {
        if (!InnerMap.active || InnerMap._insideBuilding) return;
        const s = this._town();
        const st = s && s.npcTheft;
        if (!st) return;
        const day = _num(this._day);
        const T = InnerMapRenderer.TILE_SIZE;
        const z = camera.zoom;
        for (const b of InnerMap.buildings || []) {
            if (!b) continue;
            const forced = b.isPlayerOwned
                ? (st.playerDoor && day - _num(st.playerDoor.d) <= _num(NpcTheft.config().burglary.forcedDays, 6))
                : NpcTheft.forcedDoor(s, `${b.type}@${b.q},${b.r}`, day);
            if (!forced) continue;
            const p = camera.worldToScreen(b.q * T + T / 2, b.r * T + T * 0.55);
            ctx.save();
            ctx.strokeStyle = 'rgba(70, 40, 15, 0.95)';
            ctx.lineWidth = Math.max(1.5, 2.2 * z);
            const w = T * z * 0.32;
            ctx.beginPath();
            ctx.moveTo(p.x - w, p.y - w); ctx.lineTo(p.x + w * 0.2, p.y + w * 0.1);
            ctx.moveTo(p.x + w, p.y - w * 0.8); ctx.lineTo(p.x - w * 0.1, p.y + w * 0.3);
            ctx.moveTo(p.x - w * 0.6, p.y + w); ctx.lineTo(p.x + w * 0.7, p.y + w * 0.4);
            ctx.stroke();
            ctx.restore();
        }
    },
};
