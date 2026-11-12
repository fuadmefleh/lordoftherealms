// ============================================
// INNER MAP BRAWLS — townsfolk come to blows before the player's eyes
// ============================================
// The street-map half of systems/brawls.js:
//
//   - WHO: every few seconds the town near the player is looked over for a
//     pair with a reason — two with a grudge between them in sight of each
//     other (settlement.brawls.feuds), a cutpurse and the mark who noticed
//     them today (systems/npcTheft.js's case), two drinkers in the tavern of
//     an evening (or the tavern scene's own argument: world/innerMap/
//     townScenes.js calls InnerMap.onSceneArgue), a drunk in the street at
//     night, a haggle at the market. Brawls.startChance says how likely, a
//     hash stream rolls it. A thief the watch catches may resist (arrest).
//   - HOW: the one comes over to the other and they square up on
//     neighbouring tiles (never through a wall, never sliding — nobody moves
//     while swinging); words (barks from data), a shove, fists, steel only if
//     armed and serious. Each swing is the halfslash (fists) or the slash
//     (steel) anim timed to the blow; a hit flashes and knocks the other back
//     a fraction of a tile (drawn, not moved); 0 hp drops them senseless
//     (state 'unconscious', ui/innerMapCombat.js draws the fall) — and
//     rarely bleeding (systems/downed.js; ui/innerMapDowned.js runs it).
//   - THE CROWD: onlookers gather in a ring and cheer; kin and friends wade
//     in on their side; a kind soul (or the keeper) tries to pull them
//     apart; the watch comes running and takes the one who started it.
//   - THE STREET: while a fight is on, its ground (the fighters' tiles and
//     round them) is costly to walk (InnerMap._avoidTiles, read by
//     world/innerMap/movement.js _findPath): passers-by walk round it, and
//     anyone already on a path through it is set a new one.
//   - RIVAL HOUSES: two great Houses' retinues in the town at once
//     (systems/rivalHouses.js units) — a couple of each's men come into the
//     street and set about each other (retainers), told by the Houses' names.
//   - THE PLAYER (menuItems/handle): cheer a side, bet on it with someone in
//     the crowd (coin from and to their purse; Laws.gambling says whether it
//     is a quiet wager), break it up, or join a side — that is an assault
//     (InnerMapCombat.startAttackNPC: the watch, the crime, aboveLaw for a
//     ruler). Brawls.settle writes the aftermath when it ends.
//
// Each frame from InnerMapCombat.update. Rolls are hashes of the world seed,
// the town, the day and the fight (systems/brawls.js), not the shared RNG.

import { InnerMap } from '../world/innerMap.js';
import { Brawls } from '../systems/brawls.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Downed } from '../systems/downed.js';
import { Knockout } from '../systems/knockout.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Ledger } from '../systems/ledger.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCarry } from './innerMapCarry.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapRenderer } from './innerMapRenderer.js';

const DIRS4 = [[0, 1], [1, 0], [-1, 0], [0, -1]];
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = v => (Array.isArray(v) ? v : []);
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const _nowS = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) / 1000;
const _nowMs = () => _nowS() * 1000;
const _span = (range, u) => { const [a, b] = Array.isArray(range) ? range : [range, range]; return _num(a) + (_num(b, _num(a)) - _num(a)) * u; };
/** A fraction in [0, 1) from a string (FNV-1a): no shared RNG. */
const _hash01 = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const _fill = (t, vars) => { let s = String(t || ''); for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(v == null ? '' : v); return s; };
const STAGE_WORD = { words: 'hard words', shove: 'shoving', fists: 'fists', weapons: 'steel drawn' };

function _note(game, title, text, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, kind);
}

function _seed(game) {
    const w = game && game.world;
    return (w && w.generationParams && w.generationParams.seed) || 0;
}

export const InnerMapBrawls = {
    _fights: [],
    _tiles: null,
    _clock: 0,
    _scanIn: 3,
    _coolUntil: 0,
    _scanN: 0,
    _game: null,

    // ──────────── HELPERS ────────────

    _town() {
        const ref = InnerMap._currentWorldTileRef;
        return ref && ref.settlement && ref.settlement.folk ? ref.settlement : null;
    },

    _hour() {
        return InnerMap._sceneClock ? InnerMap._sceneClock() : _num(InnerMap.timeOfDay, 12);
    },

    _day(game) { return _num(game && game.world && game.world.day); },

    /** The kind of room the player is in (tavern, church…) when a town scene runs there. */
    _roomKind() {
        const I = InnerMap._scnIn;
        return InnerMap._insideBuilding && I && I.tiles === InnerMap.tiles ? I.kind : null;
    },

    _player() { return { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR }; },

    _roll(game, ...parts) { return Brawls.frac(_seed(game), ...parts); },

    /** A line from a data list, by a hash. */
    _line(list, ...salt) {
        const l = _arr(list);
        return l.length ? l[Math.floor(Brawls.frac(...salt, this._clock.toFixed(2)) * l.length) % l.length] : null;
    },

    _say(npc, text, secs = 2.6, delay = 0) {
        if (!npc || !text) return;
        const now = _nowMs();
        npc._bark = { text, from: delay > 0 ? now + delay * 1000 : undefined, until: now + (delay + secs) * 1000 };
    },

    /** A person old enough, awake, on their feet and not about something else. */
    _free(n) {
        if (!n || Downed.isDown(n) || n._carried || n._asleep || n._fight || n._dialogFrozen) return false;
        if (n.state === 'gone' || n.state === 'leaving_building' || n.state === 'dialog') return false;
        // (in a room the player is in, everyone there is 'inside_building'; out on the street, they're out of sight)
        if (n.state === 'inside_building' && !InnerMap._insideBuilding) return false;
        if (n.departing || n._thief || n._scav || n._graveRobber || n._outlaw || n._vending || n._behindCounter) return false;
        if (n.type === 'child' || (n._person && n._person.role === 'child')) return false;
        if (InnerMapReactions._responders && InnerMapReactions._responders.has(n.id)) return false;
        if (InnerMapReactions._fleeing && InnerMapReactions._fleeing.has(n.id)) return false;
        if (InnerMapCombat._npcReactions && InnerMapCombat._npcReactions.has(n.id)) return false;
        const ia = InnerMapCombat._attackState;
        if (ia && ia.npc === n) return false;
        return true;
    },

    _passable(q, r) {
        return InnerMap._scenePassable ? InnerMap._scenePassable(q, r) : !!(InnerMap.tiles[r] && InnerMap.tiles[r][q] && InnerMap.tiles[r][q].subTerrain.passable);
    },

    /** Tiles someone stands on (or walks to), the player's too. */
    _occupied(except = null) {
        const set = new Set([`${InnerMap.playerInnerQ},${InnerMap.playerInnerR}`]);
        for (const n of InnerMap.npcs || []) {
            if (!n || n === except || n.state === 'gone' || (n.state === 'inside_building' && !InnerMap._insideBuilding)) continue;
            set.add(`${n.q},${n.r}`);
            const end = n.path && n.path.length ? n.path[n.path.length - 1] : null;
            if (end) set.add(`${end.q},${end.r}`);
        }
        return set;
    },

    /** Squared up: on neighbouring tiles (side by side or one above the other), with no wall between. */
    _adjacent(a, b) {
        if (!a || !b) return false;
        if (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) !== 1) return false;
        return !(InnerMap._stepBlocked && InnerMap._stepBlocked(a.q, a.r, b.q, b.r));
    },

    /**
     * A free tile beside `target` that `who` can walk to (the nearest), or null. Side by side
     * first: one above the other, the nearer figure hides the other's body behind its head.
     */
    _spotBeside(target, who) {
        const occ = this._occupied(who);
        let best = null;
        for (const [dq, dr] of DIRS4) {
            const q = target.q + dq;
            const r = target.r + dr;
            if (!(q === who.q && r === who.r) && (occ.has(`${q},${r}`) || !this._passable(q, r))) continue;
            if (InnerMap._stepBlocked && InnerMap._stepBlocked(target.q, target.r, q, r)) continue;
            let len = dr !== 0 ? 6 : 0;
            if (!(q === who.q && r === who.r)) {
                const path = InnerMap._findPath(who.q, who.r, q, r);
                if (!path || path.length < 2 || path.length > 24) continue;
                len += path.length;
            }
            if (!best || len < best.len) best = { q, r, len };
        }
        return best;
    },

    _face(npc, target) {
        if (!npc || !target) return;
        const d = InnerMapCharacters.getDirection(target.q - npc.q, target.r - npc.r);
        npc.facing = d;
        if (npc._fight) npc._fight.facing = d;
    },

    /** Start walking (driven here: updateNPCs leaves anyone in a fight alone). */
    _walk(npc, q, r, run = 1) {
        if (npc.q === q && npc.r === r) { npc.path = null; npc.state = this._rest(npc); return true; }
        if (!InnerMap._npcWalkTo || !InnerMap._npcWalkTo(npc, q, r)) return false;
        if (!InnerMap._insideBuilding) npc.state = 'walking';
        if (npc._fight) npc._fight.run = run;
        return true;
    },

    /** One frame of a walk; true once there (or stopped). */
    _stepWalk(npc, dt) {
        if (!npc.path) { if (npc.state === 'walking') npc.state = this._rest(npc); return true; }
        const run = npc._fight ? _num(npc._fight.run, 1) : 1;
        const done = InnerMap._npcStep(npc, dt * run);
        if (done) { npc.path = null; npc.state = this._rest(npc); }
        return done;
    },

    // ──────────── TAKING PART ────────────

    _take(npc, F, role) {
        if (!npc._fight) npc._fight = { prevSpeed: npc.speed };
        Object.assign(npc._fight, { fid: F.fight.key, role, anim: role === 'ring' ? 'idle' : 'emotes', facing: npc.facing, swingAt: null, kb: null, run: 1 });
        npc.path = null;
        npc.moveProgress = 0;
        npc._pose = null;
        npc._swing = null;
        npc._chatWith = null;
        npc._activity = null;
        if (npc._seatOn && npc._scene && npc._scene.spot && npc._scene.spot.on) {
            // Up off the bench: stood beside it
            const off = this._spotBeside(npc, npc) || null;
            if (off) { npc.q = npc.prevQ = off.q; npc.r = npc.prevR = off.r; }
        }
        npc._seatOn = false;
        npc.state = this._rest(npc);
        npc.activity = role === 'ring'
            ? { type: 'brawl', icon: '👀', label: 'Watching the fight', anim: 'idle', quiet: true }
            : role === 'watch' ? { type: 'brawl', icon: '🛡️', label: 'Breaking up a fight', anim: 'ready', quiet: true }
                : role === 'peace' ? { type: 'brawl', icon: '🙌', label: 'Trying to stop a fight', anim: 'emotes', quiet: true }
                    : { type: 'brawl', icon: '💢', label: 'Fighting', anim: 'emotes', quiet: true };
    },

    /** Out of the fight: back to their day (a tavern seat, the street). leave: they go home / out. */
    _release(npc, leave = false) {
        if (!npc || !npc._fight) return;
        const prev = npc._fight.prevSpeed;
        npc._fight = null;
        if (prev != null) npc.speed = prev;
        if (npc.activity && npc.activity.type === 'brawl') npc.activity = null;
        if (Downed.isDown(npc)) return;
        npc.path = null;
        npc.moveProgress = 0;
        npc.state = this._rest(npc);
        npc.idleTimer = 1.5 + Brawls.frac('idle', npc.id, this._clock.toFixed(1)) * 2;
        const sc = npc._scene;
        if (sc && InnerMap._scnIn && InnerMap._scnIn.tiles === InnerMap.tiles) {
            if (leave) { sc.left = 0; sc.phase = 'at'; return; }
            const target = sc.spot && (sc.spot.on || sc.spot);
            if (target && (npc.q !== target.q || npc.r !== target.r) && InnerMap._npcWalkTo(npc, target.q, target.r)) sc.phase = 'go';
            else if (InnerMap._sceneSeat) InnerMap._sceneSeat(npc, InnerMap._scnIn);
        } else if (leave) {
            InnerMapReactions._flee(npc, { indoors: !!InnerMap._insideBuilding });
        }
    },

    _npcOf(F, f) { return F.npcs.get(f.key) || null; },

    /** Standing still: 'idle' on the street, 'inside_building' in the room the player is in (as interiors keep them). */
    _rest() { return InnerMap._insideBuilding ? 'inside_building' : 'idle'; },

    /** Taken by something else: the player's fight, the street's reactions, carried, gone. */
    _grabbed(n) {
        if (!n || n.state === 'gone' || Downed.isDown(n) || n._carried) return true;
        if (InnerMapCombat._npcReactions.has(n.id) || (InnerMapCombat._attackState && InnerMapCombat._attackState.npc === n)) return true;
        return !!((InnerMapReactions._responders && InnerMapReactions._responders.has(n.id)) || (InnerMapReactions._fleeing && InnerMapReactions._fleeing.has(n.id)));
    },

    /** Let go of someone without touching what they are doing now. */
    _drop(n) {
        if (!n || !n._fight) return;
        n._fight = null;
        if (n.activity && n.activity.type === 'brawl') n.activity = null;
    },

    _fighterFor(npc, game, drunk) {
        const f = Brawls.fighter(npc, { drunk });
        const h = InnerMapCombat._npcHealth.get(npc.id);
        if (h) f.hp = Math.max(1, Math.round(f.max * h.current / Math.max(1, h.max)));
        else if (npc._person) {
            const hurt = Townsfolk.injury(npc._person, this._day(game));
            if (hurt) f.hp = Math.max(1, Math.round(f.max * hurt.hp / Math.max(1, hurt.max)));
        }
        return f;
    },

    // ──────────── STARTING ────────────

    /**
     * Begin a fight between two NPCs on this map. a starts it. opts { cause, heat, drunk, place, said }.
     * → the live fight, or null.
     */
    start(game, a, b, opts = {}) {
        const s = this._town();
        if (!game || !game.world || !a || !b || a === b) return null;
        if (this._fights.length >= _num(Brawls.config().onMap.maxActive, 1)) return null;
        const day = this._day(game);
        const hour = this._hour();
        const room = this._roomKind();
        const place = opts.place || (room === 'tavern' ? 'tavern' : opts.cause === 'market' ? 'market' : 'street');
        const key = `${_seed(game)}|${s ? `${s.q},${s.r}` : 'x'}|${day}|${Math.floor(hour * 60)}|${this._scanN++}`;
        const fa = this._fighterFor(a, game, !!opts.drunk);
        const fb = this._fighterFor(b, game, !!opts.drunk && place === 'tavern');
        const fight = Brawls.begin(fa, fb, { key, cause: opts.cause || 'tavern', place, day, hour, town: s ? s.type : 'town', placeName: opts.placeName || null });
        fight.heat = _num(opts.heat);
        const F = {
            fight, npcs: new Map([[fa.key, a], [fb.key, b]]), tiles: InnerMap.tiles, indoors: !!InnerMap._insideBuilding, room,
            phase: 'approach', t: 0, stageT: 0, stageLeft: 0, ring: [], ringAt: null, watch: null, watchAt: null,
            peace: null, peaceAt: null, peaceTries: 0, joinAt: null, tendAt: null, said: 0, saidT: opts.said ? 1.8 : 0,
            next: new Map(), seen: false, bet: null, cheered: null, town: s, arrestee: null,
        };
        this._take(a, F, 'fighter');
        this._take(b, F, 'fighter');
        // Squared up: b comes to a (or a is already beside b)
        if (!this._adjacent(a, b)) {
            const spot = this._spotBeside(a, b);
            if (spot) this._walk(b, spot.q, spot.r);
            else {
                const spot2 = this._spotBeside(b, a);
                if (!spot2) { this._release(a); this._release(b); return null; }
                this._walk(a, spot2.q, spot2.r);
            }
        }
        this._fights.push(F);
        return F;
    },

    /** The tavern scene's argument (world/innerMap/townScenes.js): it may come to blows. */
    _sceneArgue(a, b) {
        const game = this._game;
        if (!game || !this._free(a) || !this._free(b)) return true;
        if (this._fights.length || this._clock < this._coolUntil) return true;
        const h = this._hour();
        this.start(game, a, b, { cause: 'tavern', drunk: h >= 20 || h < 4, said: true });
        return true;
    },

    /** Look the town over near the player for a pair with a reason. */
    _scan(game, s) {
        const C = Brawls.config();
        const M = C.onMap;
        const day = this._day(game);
        const hour = this._hour();
        const me = this._player();
        const room = this._roomKind();
        if (InnerMap._insideBuilding && room !== 'tavern') return;
        const near = (InnerMap.npcs || []).filter(n => this._free(n) && _cheb(n, me) <= _num(M.playerRadius, 20));
        if (near.length < 2) return;
        const tryPair = (cause, a, b, ctx, salt) => {
            const p = Brawls.startChance(cause, a, b, { hour, ...ctx });
            if (p <= 0) return false;
            if (this._roll(game, s.q, s.r, day, Math.floor(hour * 60), this._scanN, cause, salt) >= p) return false;
            const [x, y] = Brawls.temper(a.personalityTraits, a.type, ctx.drunkA) >= Brawls.temper(b.personalityTraits, b.type, ctx.drunkB) ? [a, b] : [b, a];
            return !!this.start(game, cause === 'cutpurse' ? a : x, cause === 'cutpurse' ? b : y, { cause, heat: ctx.heat, drunk: !!(ctx.drunkA || ctx.drunkB) });
        };
        this._scanN++;
        // 1. A grudge, in sight of each other
        const byPid = new Map(near.filter(n => n._person).map(n => [n._person.id, n]));
        const st = s.brawls;
        if (st && st.feuds) {
            for (const f of Object.values(st.feuds)) {
                const a = byPid.get(f.a);
                const b = byPid.get(f.b);
                if (!a || !b || _cheb(a, b) > _num(M.grudgeRadius, 8)) continue;
                if (tryPair('grudge', a, b, { heat: f.heat }, `${f.a}|${f.b}`)) return;
            }
        }
        // 2. A cutpurse the mark saw today
        const cases = s.npcTheft && Array.isArray(s.npcTheft.cases) ? s.npcTheft.cases : [];
        for (const c of cases) {
            if (!c || c.k !== 'pickpocket' || c.d !== day || !c.named || !c.thief || c.thief.pid == null || !c.victim || c.victim.pid == null || c._brawled) continue;
            const v = byPid.get(c.victim.pid);
            const t = byPid.get(c.thief.pid);
            if (!v || !t || _cheb(v, t) > _num(M.grudgeRadius, 8)) continue;
            c._brawled = true;
            if (tryPair('cutpurse', v, t, {}, `cp${c.id}`)) return;
        }
        // 3. The tavern of an evening: drinkers side by side
        const pairR = _num(M.pairRadius, 3);
        if (room === 'tavern') {
            const pats = near.filter(n => n._scene && n._scene.role === 'patron' && n._scene.phase === 'at');
            const drunk = hour >= 20 || hour < 4;
            for (let i = 0; i < pats.length; i++) {
                for (let j = i + 1; j < pats.length; j++) {
                    if (_cheb(pats[i], pats[j]) > pairR) continue;
                    if (tryPair('tavern', pats[i], pats[j], { drunkA: drunk, drunkB: drunk }, `${pats[i].id}|${pats[j].id}`)) return;
                }
            }
            return;
        }
        // 4. A drunk in the street at night
        for (const d of near.filter(n => n._drunk)) {
            const other = near.find(n => n !== d && _cheb(n, d) <= pairR);
            if (other && tryPair('drunk', d, other, { drunkA: true }, `${d.id}|${other.id}`)) return;
        }
        // 5. A haggle at the market gone wrong (a shopper at a stall, the one beside them)
        const shoppers = near.filter(n => n.activity && /haggl|brows|shop/i.test(n.activity.label || ''));
        for (const a of shoppers) {
            const b = near.find(n => n !== a && _cheb(n, a) <= 2);
            if (b && tryPair('market', a, b, {}, `${a.id}|${b.id}`)) return;
        }
    },

    /**
     * The watch has a thief (ui/innerMapScavengers.js): they may fight it rather than go quietly.
     * → true when a fight began (the caller leaves the thief to it).
     */
    resistArrest(game, thief, opts = {}) {
        if (!game || !thief || this._fights.length) return false;
        const guard = (InnerMap.npcs || []).filter(n => n.type === 'guard' && this._free(n) && _cheb(n, thief) <= 12)
            .sort((x, y) => _cheb(x, thief) - _cheb(y, thief))[0];
        if (!guard) return false;
        if (!Brawls.resists(game.world, thief, `${thief.id}|${this._day(game)}|${Math.floor(this._hour() * 60)}`)) return false;
        thief._scav = null;
        thief._graveRobber = false;
        thief._dialogFrozen = false;
        const F = this.start(game, thief, guard, { cause: 'watch' });
        if (!F) return false;
        F.fight.stage = 'fists';
        F.phase = 'approach';
        F.skipWords = true;
        F.watch = guard;   // (the guard is the watch: whoever wins, it ends as an arrest or an escape)
        // (the caller is told which: taken true, or false when the thief beat the guard and ran)
        if (typeof opts.onEnd === 'function') F.onEnd = opts.onEnd;
        return true;
    },

    // ──────────── EACH FRAME ────────────

    update(dt, game) {
        if (!game || !game.world || !InnerMap.active) return;
        this._game = game;
        InnerMap.onSceneArgue = (a, b) => this._sceneArgue(a, b);
        InnerMapCombat.onBrawlDeath = (npc, g) => this.onKilled(npc, g);
        if (this._tiles !== InnerMap.tiles) {
            // A new map (in at a door, out to the street): fights left behind are played out unseen
            for (const F of this._fights.slice()) this._abandon(F, game);
            this._fights = [];
            this._tiles = InnerMap.tiles;
            this._scanIn = 2;
        }
        if (!Brawls.config().enabled) return;
        this._clock += dt;
        const s = this._town();
        for (const F of this._fights.slice()) {
            try { this._tick(F, dt, game); } catch (e) { this._abandon(F, game); }
        }
        // The fight's ground: passers-by walk round it
        this._avoidIn = _num(this._avoidIn) - dt;
        if (this._avoidIn <= 0) { this._avoidIn = 0.5; this._keepClear(); }
        if (!s) return;
        // Two great Houses' men in town together: they may clash in the street
        if (!InnerMap._insideBuilding && !this._fights.length) this._maybeRetainers(game, s);
        this._scanIn -= dt;
        if (this._scanIn > 0) return;
        const M = Brawls.config().onMap;
        this._scanIn = _span(M.scanEvery, this._roll(game, 'scan', this._scanN));
        if (this._fights.length >= _num(M.maxActive, 1) || this._clock < this._coolUntil) return;
        this._scan(game, s);
    },

    // ──────────── THE STREET KEPT CLEAR ────────────

    /** Mark the active fights' ground for the pathfinder; re-path anyone walking through it. */
    _keepClear() {
        const live = this._fights.filter(F => F.tiles === InnerMap.tiles && !F.indoors);
        if (!live.length || InnerMap._insideBuilding) { InnerMap._avoidTiles = null; return; }
        const W = InnerMap.width, H = InnerMap.height;
        const set = new Set();
        set.w = W;
        const busy = new Set();
        for (const F of live) {
            for (const n of F.npcs.values()) {
                if (!n) continue;
                busy.add(n);
                for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
                    const q = n.q + dq, r = n.r + dr;
                    if (q >= 0 && r >= 0 && q < W && r < H) set.add(r * W + q);
                }
            }
            for (const n of [...F.ring, F.peace, F.watch]) if (n) busy.add(n);
        }
        InnerMap._avoidTiles = set;
        // (those already on their way through it: a new way round)
        for (const n of InnerMap.npcs || []) {
            if (busy.has(n) || n._fight || n.state !== 'walking' || !n.path || n.path.length < 2 || n.departing) continue;
            const end = n.path[n.path.length - 1];
            const ahead = n.path.slice(n.pathIndex || 0, (n.pathIndex || 0) + 6);
            if (!ahead.some(t => set.has(t.r * W + t.q) && !(t.q === end.q && t.r === end.r))) continue;
            const path = InnerMap._findPath(n.q, n.r, end.q, end.r);
            if (!path || path.length < 2) continue;
            n.path = path.slice(1);
            n.pathIndex = 0;
            n.moveProgress = 0;
            n.prevQ = n.q;
            n.prevR = n.r;
        }
    },

    // ──────────── RIVAL HOUSES' MEN ────────────

    /** Rival Houses' retinues in this town (systems/rivalHouses.js units), one per House: [unit]. */
    _retinuesHere(game, s) {
        const seen = new Set();
        const out = [];
        for (const u of Array.isArray(game.world.units) ? game.world.units : []) {
            if (!u || u.type !== 'rival_retinue' || u.destroyed || u.q !== s.q || u.r !== s.r) continue;
            const house = u.houseName || u.houseId || u.id;
            if (seen.has(house)) continue;
            seen.add(house);
            out.push(u);
        }
        return out;
    },

    _maybeRetainers(game, s) {
        const day = this._day(game);
        const key = `${s.q},${s.r}|${day}`;
        if (this._retainDay === key) return;
        this._retainDay = key;
        const units = this._retinuesHere(game, s);
        if (units.length < 2) return;
        const R = (Brawls.config().causes || {}).retainers || {};
        if (Brawls.frac('retainOnMap', _seed(game), key) >= _num(R.onMap, 0.6)) return;
        const men = [[], []];
        const per = Math.max(1, Math.round(_num(R.onMapMen, 2)));
        const me = this._player();
        let id = (InnerMap.npcs || []).reduce((m, n) => Math.max(m, _num(n.id)), 0) + 1;
        let u0 = 0;
        const rng = () => Brawls.frac('retainSpawn', key, u0++);
        for (let side = 0; side < 2; side++) {
            const u = units[side];
            const house = u.houseName || 'a great House';
            for (let i = 0; i < per; i++) {
                const npc = InnerMap._makeNpc ? InnerMap._makeNpc('guard', id++, rng) : null;
                if (!npc) continue;
                const spot = InnerMap.townSpot ? InnerMap.townSpot(rng, { q: me.q + (side ? 4 : -4), r: me.r + 2 }, 4) : null;
                if (spot) { npc.q = npc.prevQ = npc.targetQ = spot.q; npc.r = npc.prevR = npc.targetR = spot.r; }
                npc.roleTitle = `retainer of ${house}`;
                npc._retainerOf = u.id;
                npc.fullName = `${npc.name}, ${house}'s man`;
                npc.state = 'idle';
                npc.idleTimer = 30;
                InnerMap.npcs.push(npc);
                men[side].push(npc);
            }
        }
        if (!men[0].length || !men[1].length) { this._sendOff([...men[0], ...men[1]]); return; }
        const F = this.start(game, men[0][0], men[1][0], { cause: 'retainers', heat: 45 });
        if (!F) { this._sendOff([...men[0], ...men[1]]); return; }
        F.names = { a: units[0].houseName || 'a great House', b: units[1].houseName || 'another House' };
        F.retainers = [...men[0], ...men[1]];
        F.fight.stage = 'shove';
        for (const [side, list] of [[0, men[0].slice(1)], [1, men[1].slice(1)]]) {
            for (const n of list) {
                const f = this._fighterFor(n, game, false);
                if (!Brawls.join(F.fight, f, side)) continue;
                F.npcs.set(f.key, n);
                this._take(n, F, 'fighter');
            }
        }
        _note(game, '⚔️ Rival Houses', `Men of ${F.names.a} and ${F.names.b} meet in the street, and words become blows.`, 'warning');
    },

    /** Retainers done with the street: off out of the town (the downed are left lying). */
    _sendOff(list) {
        for (const n of list || []) {
            if (!n || n.state === 'gone' || Downed.isDown(n) || n._arrested) continue;
            n.departing = true;
            const edge = InnerMap._findNearestEdgeTile ? InnerMap._findNearestEdgeTile(n.q, n.r) : null;
            if (edge && InnerMap._npcWalkTo && InnerMap._npcWalkTo(n, edge.q, edge.r)) n.state = 'walking';
            else n.state = 'gone';
        }
    },

    _tick(F, dt, game) {
        const fight = F.fight;
        const C = Brawls.config();
        F.t += dt;
        F.stageT += dt;
        // Anyone taken out of it by something else (the player went at them, they were carried off…)
        for (const f of Brawls.fighters(fight)) {
            if (f.out) continue;
            const npc = this._npcOf(F, f);
            const gone = !npc || npc.state === 'gone' || !(InnerMap.npcs || []).includes(npc);
            const taken = npc && (InnerMapCombat._npcReactions.has(npc.id) || (InnerMapCombat._attackState && InnerMapCombat._attackState.npc === npc));
            const down = npc && Downed.isDown(npc) && npc._fight;
            if (gone || taken || down) {
                f.out = taken ? 'taken' : gone ? 'fled' : 'ko';
                if (npc && npc._fight) { npc._fight = null; if (npc.activity && npc.activity.type === 'brawl') npc.activity = null; }
                if (taken && !F.playerJoined) F.playerJoined = true;
                Brawls.checkEnd(fight);
            }
        }
        if (fight.ended) { this._finish(F, game); return; }
        // The crowd: anyone the street's own reactions took (fleeing the player, the watch after the player)
        for (const n of F.ring.slice()) {
            if (this._grabbed(n)) { this._drop(n); F.ring = F.ring.filter(x => x !== n); }
        }
        for (const k of ['peace', 'watch']) {
            if (F[k] && this._grabbed(F[k]) && !Brawls.fighters(fight).some(f => this._npcOf(F, f) === F[k])) { this._drop(F[k]); F[k] = null; if (k === 'watch') F.watchAt = F.t + 999; }
        }
        // Everyone walking somewhere in it
        for (const npc of F.npcs.values()) if (npc._fight && npc.path) this._stepWalk(npc, dt);
        for (const n of F.ring) if (n._fight && n.path) { if (this._stepWalk(n, dt)) this._faceCenter(F, n); }
        if (F.watch && F.watch._fight && F.watch.path) this._stepWalk(F.watch, dt);
        if (F.peace && F.peace._fight && F.peace.path) this._stepWalk(F.peace, dt);
        // Seen by the player?
        const me = this._player();
        const c = this._center(F);
        if (!F.seen && c && (F.indoors ? true : _cheb(c, me) <= _num(C.bystanders.ringRadius, 9) + 6)) F.seen = true;

        switch (F.phase) {
            case 'approach': this._approach(F, dt, game); break;
            case 'words': this._words(F, dt, game); break;
            case 'shove': this._shove(F, dt, game); break;
            default: this._blows(F, dt, game); break;
        }
        if (fight.ended) { this._finish(F, game); return; }
        if (STAGE_RANK(fight.stage) >= 2) {
            this._crowd(F, dt, game);
            this._allies(F, game);
            this._peacemaker(F, dt, game);
            this._theWatch(F, dt, game);
            this._tend(F, dt, game);
        }
        if (F.t > _num(C.fight.maxSeconds, 45) && !fight.ended) {
            // Worn out: they stagger apart
            Brawls.end(fight, 'parted', null, 'tired');
            fight.partedBy = 'tired';
        }
        if (fight.ended) this._finish(F, game);
    },

    _center(F) {
        const a = this._npcOf(F, Brawls.instigatorOf(F.fight));
        const b = this._npcOf(F, Brawls.foeOf(F.fight));
        if (!a && !b) return null;
        if (!a || !b) return { q: (a || b).q, r: (a || b).r };
        return { q: (a.q + b.q) / 2, r: (a.r + b.r) / 2 };
    },

    _faceCenter(F, n) {
        const c = this._center(F);
        if (c) this._face(n, { q: Math.round(c.q), r: Math.round(c.r) });
        if (n._fight) n._fight.anim = 'idle';
    },

    // The one comes over to the other
    _approach(F, dt, game) {
        const a = this._npcOf(F, Brawls.instigatorOf(F.fight));
        const b = this._npcOf(F, Brawls.foeOf(F.fight));
        if (!a || !b) { Brawls.end(F.fight, 'backDown', null); return; }
        if (!a.path && !b.path && this._adjacent(a, b) && a.r !== b.r && !F.vTried) {
            // One above the other: step round to stand side by side, if there is room
            F.vTried = true;
            const side = this._spotBeside(a, b);
            if (side && side.r === a.r && this._walk(b, side.q, side.r)) return;
        }
        if (!a.path && !b.path && this._adjacent(a, b)) {
            this._face(a, b);
            this._face(b, a);
            F.stageT = 0;
            if (F.skipWords) { F.phase = 'blows'; F.fight.stage = F.fight.stage === 'words' ? 'fists' : F.fight.stage; this._say(a, this._line(Brawls.config().barks.taunt, 'w', a.id), 2); return; }
            F.phase = 'words';
            F.stageLeft = _span(Brawls.config().escalation.seconds.words, this._roll(game, F.fight.key, 'words'));
            return;
        }
        // Stuck or too long: they shout across instead, and leave it
        if (F.stageT > 7 || (!a.path && !b.path && !this._adjacent(a, b))) {
            if (F.stageT > 7 || !this._reapproach(a, b)) {
                if (!F.said) this._sayPair(F, a, b, game);
                Brawls.end(F.fight, 'backDown', null);
            }
        }
    },

    _reapproach(a, b) {
        const spot = this._spotBeside(a, b);
        return !!(spot && this._walk(b, spot.q, spot.r));
    },

    /** The pair's opening exchange (data barks.words by cause). */
    _sayPair(F, a, b, game) {
        const W = Brawls.config().barks.words || {};
        const pool = _arr(W[F.fight.cause]).length ? W[F.fight.cause] : _arr(W.any);
        const pair = this._line(pool, F.fight.key, 'pair') || ['…', '…'];
        const feud = F.fight.cause === 'grudge' && a._person && b._person ? Brawls.feud(F.town, a._person.id, b._person.id) : null;
        const why = feud ? Brawls.whyText(feud) : 'what you did';
        this._say(a, _fill(pair[0], { name: (b.name || '').split(' ')[0], why }), 1.8);
        this._say(b, _fill(pair[1], { name: (a.name || '').split(' ')[0], why }), 2.4, 1.9);
        F.said++;
    },

    _words(F, dt, game) {
        const a = this._npcOf(F, Brawls.instigatorOf(F.fight));
        const b = this._npcOf(F, Brawls.foeOf(F.fight));
        for (const n of [a, b]) if (n && n._fight) n._fight.anim = 'emotes';
        F.saidT -= dt;
        if (F.saidT <= 0) {
            // (the pair's two lines one after the other: side by side, two bubbles at once overlap)
            const pair = !F.said;
            if (pair) this._sayPair(F, a, b, game);
            else this._say(F.said % 2 ? a : b, this._line(Brawls.config().barks.taunt, F.fight.key, F.said), 1.8);
            F.said++;
            F.saidT = pair ? 4.3 : 2.2;
        }
        if (F.stageT < F.stageLeft) return;
        const r = Brawls.escalate(F.fight);
        if (r.backDown) { this._say(F.said % 2 ? a : b, this._line(Brawls.config().barks.backDown, F.fight.key, 'bd'), 2.4); return; }
        F.phase = 'shove';
        F.stageT = 0;
        F.shoved = false;
        F.stageLeft = _span(Brawls.config().escalation.seconds.shove, this._roll(game, F.fight.key, 'shove'));
    },

    _shove(F, dt, game) {
        const a = this._npcOf(F, Brawls.instigatorOf(F.fight));
        const b = this._npcOf(F, Brawls.foeOf(F.fight));
        if (!F.shoved && a && b) {
            F.shoved = true;
            this._swing(a, b, 'halfslash');
            this._knock(b, a, 0.6);
            this._say(b, this._line(Brawls.config().barks.shove, F.fight.key, 'sh'), 1.8);
        }
        for (const n of [a, b]) if (n && n._fight && !this._swinging(n)) n._fight.anim = 'ready';
        if (F.stageT < F.stageLeft) return;
        const r = Brawls.escalate(F.fight);
        if (r.backDown) { this._say(a, this._line(Brawls.config().barks.backDown, F.fight.key, 'bd2'), 2.4); return; }
        F.phase = 'blows';
        F.stageT = 0;
        this._say(a, this._line(Brawls.config().barks.taunt, F.fight.key, 'go'), 1.8);
    },

    _swinging(n) {
        return !!(n._fight && n._fight.swingAt != null && _nowS() - n._fight.swingAt < 0.5);
    },

    /** The swing anim from its first frame, facing the one swung at. */
    _swing(npc, at, anim) {
        if (!npc._fight) return;
        this._face(npc, at);
        npc._fight.anim = anim;
        npc._fight.swingAt = _nowS();
    },

    /** Knocked back a fraction of a tile, away from the blow (drawn only: they stay on their tile). */
    _knock(npc, from, k = 1) {
        if (!npc || !npc._fight) return;
        const amt = _num(Brawls.config().fight.knockback, 0.16) * k;
        const dq = Math.sign(npc.q - from.q);
        const dr = Math.sign(npc.r - from.r);
        npc._fight.kb = { dx: dq * amt, dy: dr * amt, at: _nowS(), dur: 0.28 };
    },

    _blows(F, dt, game) {
        const fight = F.fight;
        const C = Brawls.config();
        const T = InnerMapRenderer.TILE_SIZE;
        for (const f of Brawls.fighters(fight)) {
            if (f.out) continue;
            const npc = this._npcOf(F, f);
            if (!npc || !npc._fight) continue;
            if (!this._swinging(npc)) npc._fight.anim = 'ready';
            if (npc.path) continue;   // (still coming in: no swinging on the move)
            const foes = Brawls.standing(fight, 1 - f.side).map(x => ({ x, n: this._npcOf(F, x) })).filter(o => o.n);
            if (!foes.length) continue;
            // Never two on one tile: one who finds another fighter on theirs steps off to a free one
            const shared = Brawls.fighters(fight).some(x => x !== f && !x.out && (() => { const o = this._npcOf(F, x); return o && !o.path && o.q === npc.q && o.r === npc.r; })());
            if (shared && f.side === 1) {
                const off = this._spotBeside(npc, npc);
                if (off) { this._walk(npc, off.q, off.r); continue; }
            }
            const adj = foes.find(o => this._adjacent(npc, o.n));
            if (!adj) {
                // Not beside a foe (an ally just come in, one stepped off): go to the nearest —
                // once they stand still (two closing at once would meet on one tile)
                const near = foes.slice().sort((p, q) => _cheb(npc, p.n) - _cheb(npc, q.n))[0];
                if (near.n.path) continue;
                const spot = this._spotBeside(near.n, npc);
                if (spot) this._walk(npc, spot.q, spot.r);
                continue;
            }
            if (!adj.n.path) this._face(npc, adj.n);
            let left = F.next.get(f.key);
            if (left == null) left = _span(C.fight.swingEvery, this._roll(game, fight.key, 'first', f.key)) * (f.side === 0 ? 0.4 : 1);
            left -= dt;
            if (left > 0) { F.next.set(f.key, left); continue; }
            F.next.set(f.key, _span(C.fight.swingEvery, this._roll(game, fight.key, 'next', f.key, F.t.toFixed(1))));
            if (adj.n.path) continue;   // (never strike one still walking)
            const steelBefore = fight.stage;
            this._swing(npc, adj.n, fight.stage === 'weapons' && f.armed ? 'slash' : 'halfslash');
            const res = Brawls.exchange(fight, f, adj.x);
            if (res.hit) {
                InnerMapCombat._spawnHitFlash(adj.n.q * T + T / 2, adj.n.r * T + T * 0.1);
                this._knock(adj.n, npc, 1);
                InnerMapCombat._npcHealth.set(adj.n.id, { current: Math.max(0, adj.x.hp), max: adj.x.max });
                if (!res.ko && !res.fled && this._roll(game, fight.key, 'ow', F.t.toFixed(1)) < 0.35) this._say(adj.n, this._line(C.barks.hurt, fight.key, adj.n.id), 1.4);
            } else if (this._roll(game, fight.key, 'tt', F.t.toFixed(1)) < 0.18) {
                this._say(npc, this._line(C.barks.taunt, fight.key, npc.id), 1.6);
            }
            if (res.ko) this._ko(adj.n, npc, F, res.bleed, game);
            else if (res.fled) this._fled(adj.n, F);
            if (fight.ended) return;
            if (steelBefore === 'fists' && Brawls.maybeSteel(fight)) {
                const armed = Brawls.fighters(fight).find(x => !x.out && x.armed);
                const an = armed && this._npcOf(F, armed);
                if (an) this._say(an, this._line(C.barks.steel, fight.key, 'steel'), 2.2);
                for (const r of F.ring) this._say(r, this._line(C.barks.cry, fight.key, r.id), 2, 0.5);
            }
        }
    },

    /** Senseless where they stand (systems/knockout.js wake; rarely bleeding: systems/downed.js). */
    _ko(npc, by, F, bleed, game) {
        const seq = [0, this._roll(game, F.fight.key, 'koS', npc.id), this._roll(game, F.fight.key, 'koB', npc.id)];
        let i = 0;
        const rnd = () => seq[Math.min(seq.length - 1, i++)];
        const wake = Knockout.npcWake(() => this._roll(game, F.fight.key, 'wake', npc.id));
        if (npc._fight) { npc._fight = null; }
        if (npc.activity && npc.activity.type === 'brawl') npc.activity = null;
        npc.state = 'unconscious';
        npc.path = null;
        npc.moveProgress = 0;
        npc._targetBuilding = null;
        npc._activity = null;
        npc._bark = null;
        npc._seatOn = false;
        npc._pose = null;
        npc._ko = { at: _nowMs(), until: _nowMs() + wake.seconds * 1000, hpShare: wake.hpShare, side: by && by.q > npc.q ? -1 : 1 };
        npc._downedBy = { name: by ? by.name : 'someone', pid: by && by._person ? by._person.id : null, fid: F.fight.key };
        InnerMapCarry.markLying(npc);
        // (no float: the combat's 'killed' banner reads "Defeated"; the fall and the stars say it)
        if (bleed) {
            // (the first roll is the bleed itself, already decided by the fight's stream)
            npc._bleed = Downed.rollBleed(_nowMs(), 1, rnd);
            if (npc._bleed) {
                InnerMapCombat._blood.push({ q: npc.q, r: npc.r, key: InnerMapCombat._mapKey(), at: _nowMs(), day: this._day(game), size: 0.85, name: npc.name, drip: false, victim: npc });
                F.tendAt = F.t + _span(Brawls.config().bystanders.tendAfter, this._roll(game, F.fight.key, 'tendAt'));
                if (F.seen) _note(game, '💧 Bleeding out', `${npc.name} is down and bleeding badly. Bind the wound, or they may die where they lie.`, 'warning');
            }
        }
        if (by) this._say(by, this._line(Brawls.config().barks.win, F.fight.key, 'win'), 2);
    },

    _fled(npc, F) {
        this._say(npc, this._line(Brawls.config().barks.flee, F.fight.key, 'fl'), 2.2);
        this._release(npc, true);
        if (!npc._scene) InnerMapReactions._flee(npc, { indoors: F.indoors });
    },

    // ──────────── THE CROWD ────────────

    _crowd(F, dt, game) {
        const B = Brawls.config().bystanders;
        const c = this._center(F);
        if (!c) return;
        // Gather once the fists fly, and top up now and then
        if (F.ringAt == null || F.t - F.ringAt > 4) {
            F.ringAt = F.t;
            const want = _num(B.ringMax, 7) - F.ring.length;
            if (want > 0) {
                const cands = (InnerMap.npcs || []).filter(n => this._free(n) && !F.ring.includes(n) && _cheb(n, c) <= _num(B.ringRadius, 9) && n.type !== 'guard'
                    && !(n._scene && (n._scene.role === 'staff' || n._scene.role === 'bard')))
                    .sort((x, y) => _cheb(x, c) - _cheb(y, c)).slice(0, want);
                for (const n of cands) {
                    const spot = this._ringSpot(F, n, c, game);
                    if (!spot) continue;
                    this._take(n, F, 'ring');
                    if (!this._walk(n, spot.q, spot.r)) { this._release(n); continue; }
                    F.ring.push(n);
                }
            }
        }
        // Cheers from the ring (and gasps)
        F.cheerT = _num(F.cheerT, 1) - dt;
        if (F.cheerT <= 0 && F.ring.length) {
            F.cheerT = 1.4 + this._roll(game, F.fight.key, 'cheerT', F.t.toFixed(1)) * 1.6;
            const who = F.ring[Math.floor(this._roll(game, F.fight.key, 'cheerW', F.t.toFixed(1)) * F.ring.length) % F.ring.length];
            if (who && !who.path) {
                const scared = this.peaceable(who) || F.fight.stage === 'weapons';
                this._say(who, this._line(scared ? Brawls.config().barks.cry : Brawls.config().barks.cheer, F.fight.key, who.id), 1.8);
                if (who._fight) { who._fight.anim = 'emotes'; who._fight.cheerUntil = _nowS() + 1.6; }
            }
        }
        for (const n of F.ring) if (n._fight && n._fight.cheerUntil && _nowS() > n._fight.cheerUntil) { n._fight.anim = 'idle'; n._fight.cheerUntil = null; }
    },

    peaceable(n) { return Brawls.peacemaker(n.personalityTraits, n.type); },

    /** A place in the ring round the fight: 2–3 tiles out, open, reachable (so never through a wall). */
    _ringSpot(F, n, c, game) {
        const B = Brawls.config().bystanders;
        const occ = this._occupied(n);
        const [d0, d1] = Array.isArray(B.ringDistance) ? B.ringDistance : [2, 3];
        const base = this._roll(game, F.fight.key, 'ring', n.id) * Math.PI * 2;
        for (let k = 0; k < 12; k++) {
            const ang = base + (k * Math.PI * 2) / 12;
            for (let d = d0; d <= d1; d++) {
                const q = Math.round(c.q + Math.cos(ang) * d);
                const r = Math.round(c.r + Math.sin(ang) * d);
                if (occ.has(`${q},${r}`) || !this._passable(q, r)) continue;
                // (a step back from every fighter: not in the swing)
                if ([...F.npcs.values()].some(m => m && !Downed.isDown(m) && _cheb(m, { q, r }) < 2)) continue;
                const path = InnerMap._findPath(n.q, n.r, q, r);
                if ((q !== n.q || r !== n.r) && (!path || path.length < 2 || path.length > 20)) continue;
                // (in the same room, by a path no longer than the way round: a wall between is too far)
                const cq = Math.round(c.q), cr = Math.round(c.r);
                const back = InnerMap._findPath(q, r, cq, cr);
                if (back && back.length > d + 4) continue;
                return { q, r };
            }
        }
        return null;
    },

    /** Kin and friends of a fighter wade in on their side. */
    _allies(F, game) {
        const B = Brawls.config().bystanders;
        if (F.joinAt == null) F.joinAt = F.t + _span(B.joinAfter, this._roll(game, F.fight.key, 'joinAt'));
        if (F.t < F.joinAt || F.joinDone) return;
        F.joinDone = true;
        const c = this._center(F);
        const pool = [...F.ring, ...(InnerMap.npcs || []).filter(n => this._free(n) && c && _cheb(n, c) <= _num(B.ringRadius, 9))];
        for (const n of pool) {
            if (!n || (n._fight && n._fight.role !== 'ring')) continue;
            for (const side of [0, 1]) {
                const mates = Brawls.standing(F.fight, side).map(f => this._npcOf(F, f)).filter(Boolean);
                const mate = mates.find(m => StreetCrime.relationTo(n, m));
                if (!mate) continue;
                const rel = StreetCrime.relationTo(n, mate);
                if (!Brawls.joinRoll(F.fight, rel.rel, n.id)) continue;
                const f = this._fighterFor(n, game, false);
                if (!Brawls.join(F.fight, f, side)) continue;
                F.ring = F.ring.filter(x => x !== n);
                F.npcs.set(f.key, n);
                this._take(n, F, 'fighter');
                const ally = _fill(this._line(Brawls.config().barks.ally, F.fight.key, n.id), { name: (mate.name || '').split(' ')[0], kin: rel.word || 'friend' });
                this._say(n, ally, 2.2);
                break;
            }
        }
    },

    /** A kind soul or the keeper steps in to part them. */
    _peacemaker(F, dt, game) {
        const B = Brawls.config().bystanders;
        if (F.peaceAt == null) F.peaceAt = F.t + _span(B.peacemakerAfter, this._roll(game, F.fight.key, 'peaceAt'));
        if (F.t < F.peaceAt || F.peaceTries >= 2) return;
        const fight = F.fight;
        if (!F.peace) {
            const keeper = F.room === 'tavern' ? (InnerMap.npcs || []).find(n => n._scene && n._scene.role === 'staff' && !Downed.isDown(n) && !n._fight) : null;
            const kind = F.ring.find(n => !n.path && this.peaceable(n));
            const who = keeper || kind;
            if (!who) { F.peaceTries = 2; return; }
            F.ring = F.ring.filter(x => x !== who);
            this._take(who, F, 'peace');
            F.peace = who;
            F.peaceKeeper = who === keeper;
            const target = this._npcOf(F, Brawls.standing(fight, 0)[0] || Brawls.instigatorOf(fight));
            const spot = target && this._spotBeside(target, who);
            if (spot) this._walk(who, spot.q, spot.r, 1.5);
            this._say(who, this._line(F.peaceKeeper ? Brawls.config().barks.keeper : Brawls.config().barks.peace, fight.key, who.id), 2.2);
            return;
        }
        const p = F.peace;
        if (p.path) return;
        const a = this._npcOf(F, Brawls.standing(fight, 0)[0] || Brawls.instigatorOf(fight));
        if (a) this._face(p, a);
        if (p._fight) p._fight.anim = 'emotes';
        F.peaceTries++;
        if (Brawls.separate(fight, F.peaceKeeper ? 'keeper' : 'peace')) {
            this._say(p, this._line(Brawls.config().barks.peace, fight.key, 'ok'), 2);
            return;
        }
        // Shoved off: back to the ring, maybe another go
        this._say(p, this._line(Brawls.config().barks.cry, fight.key, 'no'), 1.8);
        if (a) this._knock(p, a, 0.8);
        this._release(p);
        F.peace = null;
        F.peaceAt = F.t + 5;
    },

    /** The watch: the nearest guard hears it and comes running (indoors, one is fetched in). */
    _theWatch(F, dt, game) {
        const W = Brawls.config().watch;
        const fight = F.fight;
        const c = this._center(F);
        if (!c) return;
        if (!F.watch) {
            if (F.watchAt == null) F.watchAt = F.t + _span(F.indoors ? W.indoorDelay : W.hearDelay, this._roll(game, fight.key, 'watchAt'));
            if (F.t < F.watchAt) return;
            let g = (InnerMap.npcs || []).filter(n => n.type === 'guard' && this._free(n) && _cheb(n, c) <= _num(W.hearRadius, 20))
                .sort((x, y) => _cheb(x, c) - _cheb(y, c))[0];
            if (!g && F.indoors && F.room === 'tavern' && InnerMap._scenePullIn && InnerMap._scnIn) {
                // Someone ran for the watch: a guard comes in at the door
                const outer = (InnerMap._outerMapState && InnerMap._outerMapState.npcs) || [];
                const og = outer.filter(n => n.type === 'guard' && (n.state === 'idle' || n.state === 'walking') && !n._fight && !n._dialogFrozen && !Downed.isDown(n))[0];
                if (og) { InnerMap._scenePullIn(og, InnerMap._scnIn); g = og; }
            }
            if (!g) { F.watchAt = F.t + 999; return; }
            F.watch = g;
            this._take(g, F, 'watch');
            const target = this._npcOf(F, Brawls.instigatorOf(fight)) || this._npcOf(F, Brawls.standing(fight, 0)[0]);
            const spot = target && this._spotBeside(target, g);
            if (spot) this._walk(g, spot.q, spot.r, 2.2);
            this._say(g, this._line(Brawls.config().barks.watch, fight.key, 'w'), 2.4);
            return;
        }
        const g = F.watch;
        if (!g._fight) return;
        if (F.fight.cause === 'watch') return;   // (the guard is in the fight itself)
        if (g.path) {
            // Keep after them if they moved
            return;
        }
        const near = Brawls.fighters(fight).filter(f => !f.out).map(f => this._npcOf(F, f)).filter(Boolean).find(n => _cheb(n, g) <= 1);
        if (!near) {
            const target = this._npcOf(F, Brawls.standing(fight, 0)[0] || Brawls.standing(fight, 1)[0]);
            const spot = target && this._spotBeside(target, g);
            if (!spot || !this._walk(g, spot.q, spot.r, 2.2)) { Brawls.watchArrives(fight); }
            return;
        }
        this._face(g, near);
        this._say(g, this._line(Brawls.config().barks.watch, fight.key, 'stop'), 2.2);
        Brawls.watchArrives(fight);
    },

    /** Someone binds a bleeding fighter's wound in time — or doesn't. */
    _tend(F, dt, game) {
        if (F.tendAt == null || F.t < F.tendAt) return;
        F.tendAt = null;
        const bleeding = (InnerMap.npcs || []).filter(n => n._bleed && n._downedBy && n._downedBy.fid === F.fight.key);
        for (const n of bleeding) {
            const helper = F.ring.find(r => !r.path && (StreetCrime.relationTo(r, n) || this.peaceable(r))) || F.ring[0];
            if (!helper) continue;
            if (this._roll(game, F.fight.key, 'tend', n.id) >= _num(Brawls.config().bystanders.tendChance, 0.6)) continue;
            n._bleed = null;
            this._say(helper, this._line(Brawls.config().barks.tend, F.fight.key, n.id), 2.4);
        }
    },

    // ──────────── THE END ────────────

    _finish(F, game) {
        const i = this._fights.indexOf(F);
        if (i < 0) return;
        this._fights.splice(i, 1);
        const C = Brawls.config();
        const fight = F.fight;
        const s = F.town || this._town();
        const how = fight.ended ? fight.ended.how : 'parted';
        const inst = Brawls.instigatorOf(fight);
        const instNpc = this._npcOf(F, inst);
        const keeper = F.room === 'tavern' ? (InnerMap.npcs || []).find(n => n._scene && n._scene.role === 'staff' && !Downed.isDown(n)) : null;
        // The watch takes the one who started it (if still on their feet: the senseless too, carried off later)
        const watchCase = how === 'watch' || (fight.cause === 'watch');
        let arrestee = null;
        if (how === 'watch') arrestee = instNpc;
        else if (fight.cause === 'watch' && fight.ended && fight.ended.winner === 1) arrestee = instNpc;   // the thief beaten: taken
        const witnesses = F.ring.slice();
        const seenBy = witnesses.map(n => n.name).filter(Boolean);
        if (F.seen) seenBy.unshift('you');
        let res = null;
        if (s) {
            const bar = fight.place === 'tavern' && how !== 'backDown' && keeper ? null : false;
            const names = { ...(F.names || {}) };
            if (F.playerJoined && how !== 'backDown') fight.ended.how = fight.ended.winner != null ? 'joined' : fight.ended.how;
            res = Brawls.settle(game.world, s, fight, { day: this._day(game), seenBy, witnesses, arrest: watchCase ? !!arrestee : false, bar, names });
        }
        // Each in it: the winners stand, the losers go; the arrested are led away
        const fighters = Brawls.fighters(fight);
        for (const f of fighters) {
            const npc = this._npcOf(F, f);
            if (!npc) continue;
            if (Downed.isDown(npc)) continue;
            const lost = fight.ended && fight.ended.winner != null && f.side !== fight.ended.winner;
            const leave = lost || (res && res.barred && f.key === inst.key);
            if (npc === arrestee) continue;
            this._release(npc, leave);
            if (how === 'parted') this._say(npc, this._line(C.barks.parted, fight.key, npc.id), 2.2, 0.4);
        }
        // (a thief's arrest: whoever handed them over hears how it ended — taken, or beat the guard and ran)
        if (F.onEnd) { try { F.onEnd(!!arrestee || !!(res && res.arrested && fight.cause !== 'watch')); } catch (e) { /* the caller's own */ } F.onEnd = null; }
        if (F.retainers) this._sendOff(F.retainers);
        if (arrestee && !Downed.isDown(arrestee)) this._leadAway(arrestee, F.watch, F);
        else if (fight.cause === 'watch' && instNpc && !Downed.isDown(instNpc) && !instNpc._fight) InnerMapReactions._flee(instNpc, { indoors: F.indoors });
        if (res && res.barred && keeper) this._say(keeper, this._line(C.barks.barred, fight.key, 'barred'), 2.6, 0.6);
        for (const n of F.ring) this._release(n);
        if (F.peace) this._release(F.peace);
        if (F.watch && F.watch !== arrestee && !F.leading) this._release(F.watch);
        this._settleBet(F, game);
        this._coolUntil = this._clock + _span(C.onMap.cooldown, this._roll(game, fight.key, 'cool'));
        if (F.seen && res && how !== 'backDown') {
            const extra = [res.arrested ? `The watch takes ${inst.name}${res.fine ? ` (fined ${res.fine} gold)` : ''}.` : '', res.barred ? `${inst.name} is barred from the tavern.` : ''].filter(Boolean).join(' ');
            _note(game, '💢 A Brawl', `${res.line}${extra ? ` ${extra}` : ''}`, 'info');
        }
    },

    /** The watch leads the arrested off the map (or out of the door). */
    _leadAway(npc, guard, F) {
        this._release(npc);
        if (guard) this._say(guard, this._line(Brawls.config().barks.arrest, F.fight.key, 'arr'), 2.6);
        npc._dialogFrozen = false;
        if (F.indoors) {
            // Out of the door with the guard (a scene's patron walks out by the scene; anyone else goes)
            if (npc._scene) { npc._scene.left = 0; npc._scene.phase = 'at'; } else npc.state = 'leaving_building';
        } else {
            InnerMapReactions._flee(npc, { indoors: false });
            npc.speed = (npc._fight && npc._fight.prevSpeed) || npc.speed;
        }
        npc._arrested = true;
        if (guard && !F.indoors) {
            // The guard walks after them a little way, then back to the beat
            this._release(guard);
            const path = InnerMap._findPath(guard.q, guard.r, npc.q, npc.r);
            if (path && path.length > 1) { guard.path = path.slice(1); guard.pathIndex = 0; guard.moveProgress = 0; guard.state = 'walking'; }
        }
    },

    /** A fight left behind (the player went in or out): played out unseen and settled. */
    _abandon(F, game) {
        const i = this._fights.indexOf(F);
        if (i >= 0) this._fights.splice(i, 1);
        const fight = F.fight;
        if (!fight.ended) {
            if (fight.stage === 'words' || fight.stage === 'shove') Brawls.end(fight, 'parted', null, 'peace');
            else Brawls.simulate(fight, { town: F.town ? F.town.type : 'town' });
        }
        const s = F.town;
        if (s && game && game.world) Brawls.settle(game.world, s, fight, { day: this._day(game), seenBy: F.seen ? ['you'] : [], names: F.names || {} });
        if (F.onEnd) { try { F.onEnd(!!(fight.ended && fight.ended.winner === 1)); } catch (e) { /* the caller's own */ } F.onEnd = null; }
        if (F.retainers) this._sendOff(F.retainers);
        for (const npc of [...F.npcs.values(), ...F.ring, F.peace, F.watch]) {
            if (npc && npc._fight) { this._drop(npc); if (npc.state === 'walking' && !npc.path) npc.state = this._rest(npc); }
        }
        this._settleBet(F, game);
    },

    /** A brawler's victim bled out (ui/innerMapCombat.js _killNPC): the roster, the annals, the killer. */
    onKilled(npc, game) {
        const by = npc && npc._downedBy;
        const s = this._town();
        if (!by || !s || !game || !game.world) return;
        const day = this._day(game);
        if (npc._person) Brawls.recordDeath(game.world, s, npc._person.id, by.name, day);
        // The killer: the watch wants them for it
        if (by.pid != null && s.folk) {
            const k = Townsfolk.get(s.folk, by.pid);
            const W = Brawls.config().watch;
            if (k && k.died == null) {
                k.jailedUntil = Math.max(_num(k.jailedUntil), day + _num((W.jailDays || {}).death, 60));
                Townsfolk.note(k, day, 'jailed', null, `killing ${npc.name}`);
            }
        }
        _note(game, '💀 Killed in a Brawl', `${npc.name} has died of the beating ${by.name} gave them.`, 'warning');
    },

    // ──────────── THE PLAYER ────────────

    fightOf(npc) {
        if (!npc || !npc._fight) return null;
        return this._fights.find(F => F.fight.key === npc._fight.fid) || null;
    },

    /**
     * The bookie in the ring, taking bets (or null): once bookieRing are watching, in
     * bookieChance of fights (a hash of the fight), the best-pursed grown-up among them.
     * Kept on the fight while they stay in the ring.
     */
    _bookie(F) {
        if (F.bookie && F.ring.includes(F.bookie)) return F.bookie;
        F.bookie = null;
        const Bt = Brawls.config().betting || {};
        if (F.ring.length < _num(Bt.bookieRing, 4)) return null;
        if (F.noBookie == null) F.noBookie = _hash01(`bookie|${F.fight.key}`) >= _num(Bt.bookieChance, 0.85);
        if (F.noBookie) return null;
        const adult = n => n.type !== 'child' && !(n._person && Number(n._person.age) < 16);
        const pick = F.ring.filter(n => adult(n) && n._person).sort((a, b) => _num(b._person.purse) - _num(a._person.purse) || a.id - b.id)[0]
            || F.ring.find(adult) || null;
        if (!pick) return null;
        F.bookie = pick;
        pick.activity = { type: 'brawl', icon: '🎲', label: 'Taking bets on the fight', anim: 'emotes', quiet: true };
        return pick;
    },

    /** Menu entries when the player clicks someone in a fight or the ring round it. */
    menuItems(game, npcs) {
        const out = [];
        const F = (npcs || []).map(n => this.fightOf(n)).find(Boolean);
        if (!F || F.fight.ended || !game || !game.player) return out;
        const fight = F.fight;
        const A = this._npcOf(F, Brawls.instigatorOf(fight));
        const B = this._npcOf(F, Brawls.foeOf(fight));
        if (!A || !B) return out;
        const names = [A.name, B.name];
        out.push({ type: 'header', label: `💢 ${names[0]} and ${names[1]} — ${STAGE_WORD[fight.stage] || 'fighting'}` });
        for (const side of [0, 1]) {
            if (F.cheered === side) continue;
            out.push({ type: 'action', action: 'brawl_cheer', label: `Cheer for ${names[side]}`, icon: '📣', desc: `${names[side]} will like it; ${names[1 - side]} won't`, npc: side ? B : A, side });
        }
        const bookie = this._bookie(F);
        const Bt = Brawls.config().betting;
        const stake = _num(Bt.stake, 10);
        if (F.bet) {
            out.push({ type: 'disabled', label: `🎲 Your bet: ${F.bet.stake} gold at ${F.bet.odds}×`, desc: `With ${F.bet.bookie ? F.bet.bookie.name : 'the bookie'}, paid when it's over` });
        } else if (bookie) {
            const law = Brawls.betting(game.world, F.town);
            const short = _num(game.player.gold) < stake;
            for (const side of [0, 1]) {
                const o = Brawls.odds(fight, side);
                const label = `Bet ${stake} gold on ${names[side]} (${o.odds}×)`;
                if (!law.legal) out.push({ type: 'disabled', label: `🎲 ${label}`, desc: `${String(law.why || 'Gaming is forbidden here.').replace(/\.*$/, '.')} ${bookie.name} won't take it in the open.` });
                else if (short) out.push({ type: 'disabled', label: `🎲 ${label}`, desc: `Your purse is too light (${stake} gold)` });
                else out.push({ type: 'action', action: 'brawl_bet', label, icon: '🎲', desc: `${bookie.name} takes the bet`, npc: side ? B : A, side, stake });
            }
        }
        const ruler = StreetCrime.aboveLaw(game.player, game.world, F.town);
        const p = Brawls.breakUpChance(game.player, fight, { ruler });
        out.push({ type: 'action', action: 'brawl_break', label: 'Break It Up', icon: '✋', desc: `Step between them (${Math.round(p * 100)}%)`, npc: A });
        for (const side of [0, 1]) {
            out.push({ type: 'action', action: 'brawl_join', label: `Join ${names[side]}'s Side`, icon: '👊', desc: `Go at ${names[1 - side]}. It is assault: the watch will want you${ruler ? ' (not yours)' : ''}`, npc: side ? A : B, side });
        }
        return out;
    },

    /** Run a brawl_ menu action → true when handled. */
    handle(game, item) {
        if (!item || !/^brawl_/.test(item.action || '')) return false;
        const F = this.fightOf(item.npc) || this._fights.find(x => [...x.npcs.values()].includes(item.npc));
        if (!F || F.fight.ended) { _note(game, '💢 Too late', 'It is over.', 'info'); return true; }
        const fight = F.fight;
        const P = Brawls.config().player;
        const side = item.side;
        const sideNpcs = s => Brawls.standing(fight, s).map(f => this._npcOf(F, f)).filter(Boolean);
        switch (item.action) {
            case 'brawl_cheer': {
                F.cheered = side;
                for (const n of sideNpcs(side)) NpcDisposition.adjustDisposition(n, _num(P.cheer.side, 4), game.player);
                for (const n of sideNpcs(1 - side)) NpcDisposition.adjustDisposition(n, _num(P.cheer.foe, -4), game.player);
                for (const f of Brawls.standing(fight, side)) f.spirit = Math.min(0.2, _num(f.spirit) + _num(P.cheer.spirit, 0.06));
                const hero = sideNpcs(side)[0];
                if (hero) this._say(hero, this._line(Brawls.config().barks.taunt, fight.key, 'cheer'), 1.8);
                _note(game, '📣 You cheer', `You shout for ${hero ? hero.name : 'them'}. The crowd takes it up.`, 'info');
                return true;
            }
            case 'brawl_bet': {
                const bookie = this._bookie(F);
                const stake = _num(item.stake, _num(Brawls.config().betting.stake, 10));
                if (!bookie || _num(game.player.gold) < stake || !Brawls.betting(game.world, F.town).legal) { _note(game, '🎲 No bet', 'There is no one to take it, or your purse is too light.', 'info'); return true; }
                const o = Brawls.odds(fight, side);
                game.player.gold -= stake;
                Ledger.record(game.player, 'gambling', -stake);
                if (bookie._person && F.town) bookie._person.purse = Townsfolk.purse(F.town.folk, bookie._person, game.world) + stake;
                F.bet = { side, stake, odds: o.odds, bookie };
                this._say(bookie, this._line(Brawls.config().barks.bet, fight.key, 'bet'), 2);
                if (game.ui && game.ui.updateStats) game.ui.updateStats(game.player, game.world);
                _note(game, '🎲 A wager', `${stake} gold on ${this._npcOf(F, Brawls.standing(fight, side)[0] || (side ? Brawls.foeOf(fight) : Brawls.instigatorOf(fight))).name} at ${o.odds}×, with ${bookie.name}.`, 'info');
                return true;
            }
            case 'brawl_break': {
                const target = item.npc;
                const go = () => {
                    if (fight.ended) return;
                    const ruler = StreetCrime.aboveLaw(game.player, game.world, F.town);
                    const p = Brawls.breakUpChance(game.player, fight, { ruler });
                    if (Brawls.separate(fight, 'player', p)) {
                        for (const f of Brawls.fighters(fight)) { const n = this._npcOf(F, f); if (n && !f.out) NpcDisposition.adjustDisposition(n, _num(P.breakUp.thanks, 5), game.player); }
                        _note(game, '✋ Pulled apart', 'You step between them and shove them apart. It is over.', 'success');
                    } else {
                        const a = this._npcOf(F, Brawls.standing(fight, 0)[0]);
                        if (a) this._say(a, 'Out of the way!', 1.8);
                        _note(game, '✋ Shoved aside', 'They shove you off and go at it again.', 'warning');
                    }
                };
                const res = InnerMap.approachAndThen(target.q, target.r, go);
                if (res === 'unreachable') go();
                return true;
            }
            case 'brawl_join': {
                const foe = item.npc;   // the one the player goes at
                const mates = sideNpcs(side === 0 ? 0 : 1).filter(n => n !== foe);
                for (const n of mates) NpcDisposition.adjustDisposition(n, _num(P.join.side, 10), game.player);
                const f = Brawls.fighters(fight).find(x => this._npcOf(F, x) === foe);
                if (f && !f.out) {
                    f.out = 'taken';
                    if (foe._fight) { foe._fight = null; if (foe.activity && foe.activity.type === 'brawl') foe.activity = null; }
                    foe.state = this._rest(foe);
                    foe.path = null;
                }
                F.playerJoined = true;
                Brawls.checkEnd(fight);
                InnerMapCombat.startAttackNPC(game, foe);
                return true;
            }
            default: return false;
        }
    },

    _settleBet(F, game) {
        if (!F.bet || !game || !game.player) return;
        const bet = F.bet;
        F.bet = null;
        const r = Brawls.settleBet(bet, F.fight);
        const bookie = bet.bookie;
        const purse = bookie && bookie._person && F.town ? Townsfolk.purse(F.town.folk, bookie._person, game.world) : 0;
        if (r.void) {
            const back = Math.min(bet.stake, purse);
            if (bookie && bookie._person) bookie._person.purse = purse - back;
            game.player.gold += back;
            Ledger.record(game.player, 'gambling', back);
            _note(game, '🎲 No winner', `No one won it; ${bookie ? bookie.name : 'the bookie'} hands back ${back} gold.`, 'info');
        } else if (r.won) {
            const paid = Math.min(r.payout, purse);
            if (bookie && bookie._person) bookie._person.purse = purse - paid;
            game.player.gold += paid;
            Ledger.record(game.player, 'gambling', paid);
            _note(game, '🎲 You win the bet', paid < r.payout ? `${bookie.name} can only pay ${paid} of the ${r.payout} gold owed.` : `${bookie ? bookie.name : 'The bookie'} pays out ${paid} gold.`, 'success');
            if (paid < r.payout && bookie) NpcDisposition.adjustDisposition(bookie, -5, game.player);
        } else {
            _note(game, '🎲 You lose the bet', `Your ${bet.stake} gold stays with ${bookie ? bookie.name : 'the bookie'}.`, 'warning');
        }
        if (game.ui && game.ui.updateStats) game.ui.updateStats(game.player, game.world);
    },

    /** Forget the map's fights (a load, a new game). */
    reset() {
        for (const F of this._fights) for (const npc of [...F.npcs.values(), ...F.ring, F.peace, F.watch]) if (npc) npc._fight = null;
        this._fights = [];
        this._tiles = null;
        this._coolUntil = 0;
    },
};

function STAGE_RANK(stage) { return Brawls.STAGE_RANK[stage] != null ? Brawls.STAGE_RANK[stage] : 0; }
