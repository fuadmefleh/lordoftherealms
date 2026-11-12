// ============================================
// INNER MAP CARTS — handcarts and wagons in the street
// ============================================
// The street map's carts (rules: systems/carts.js; the ground they take:
// world/innerMap/carts.js; data/carts.json):
//
//   - carters: on a morning's work hours a carter (or a labourer, a farmer)
//     pulls a handcart loaded with goods from one of the town's stores to
//     another (the warehouse, the granary, the mill, the farms, the market),
//     unloads it there and wheels it back, and leaves it standing by the
//     store: a town cart, free for anyone to take (theft of its use);
//   - the death cart: a plague in town, in its hours, a cart goes house to
//     house to the doors marked with the red cross (ui/innerMapSickness.js
//     InnerMap._plagueDoors), its crier calling "Bring out your dead!"; the
//     town's dead of these days are loaded at the doors, and the cart goes to
//     the churchyard's gate, else to a plague pit out past the nearest gate.
//     It reads the sickness only (Illness.townSickness), never changes it;
//   - a caravan leaving today: a trade caravan set out from this town today
//     (systems/merchantCaravans.js, a trade_caravan on world.units): its
//     wagon is loaded at the market, porters bringing the sacks, the merchant
//     at the horse's head; then it rolls out by the nearest gate and is gone;
//   - the player: a handcart of their own (the market good `handcart`, bought
//     at a woodworker's stall or made at the bench) stands beside them on
//     every street map; any cart standing with no one at it may be taken by
//     the handles (not theirs: theft of its use, if seen). Hauled, it follows
//     them at a slow walk, through gateways but never through a door (going
//     in, they leave it at the step); someone carried senseless can be laid on
//     it ("Lay Them on the Cart") and wheeled about, and lifted off again.
//
// Carts block their ground: a parked one is gone round (InnerMap._findPath),
// a moving one is waited for, and a cart never rolls onto anyone. Nothing is
// saved: like the carry (ui/innerMapCarry.js), the street map is dealt again
// on the next visit; the player's own cart is the good in their pack. Picks
// are hashes of the clock and the people, never the shared RNG.

import { InnerMap } from '../world/innerMap.js';
import { Carts } from '../systems/carts.js';
import { Illness } from '../systems/illness.js';
import { Underworld } from '../systems/underworld.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { InnerMapCarry } from './innerMapCarry.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { Downed } from '../systems/downed.js';
import { InnerMapDigging } from './innerMapDigging.js';
import { InnerMapAnimals } from './innerMapAnimals.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const AROUND4 = [[0, 1], [1, 0], [-1, 0], [0, -1]];
const AROUND8 = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const STEP = [[0, -1], [-1, 0], [0, 1], [1, 0]];   // facing 0 up, 1 left, 2 down, 3 right

function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _note(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

export const InnerMapCarts = {
    _tiles: null,
    _clock: 0,
    _tick: 0,
    _n: 0,
    _seq: 0,
    _lastStart: -999,
    _plagueKey: null,
    _caravans: new Set(),
    // The cart the player hauls (cart.pusher === 'player'), and where they stood last frame
    pushing: null,
    _last: null,
    _baseSpeed: null,
    _imgs: new Map(),

    // ──────────── THE MAP ────────────

    /** A new street map (or a load): no carts, nothing hauled. */
    reset() {
        if (this.pushing) this._release(null, { quiet: true });
        for (const c of InnerMap.carts || []) this._freeDriver(c);
        if (this._tiles === InnerMap.tiles || InnerMap._cartsTiles === InnerMap.tiles) InnerMap._resetCarts();
        this._tiles = null;
        this._caravans.clear();
        this._plagueKey = null;
        this._lastStart = -999;
    },

    _town() {
        const ref = InnerMap._currentWorldTileRef;
        return ref && ref.settlement ? ref.settlement : null;
    },

    _newMap(game) {
        if (this.pushing) this._release(null, { quiet: true });
        InnerMap._resetCarts();
        this._tiles = InnerMap.tiles;
        this._caravans.clear();
        this._plagueKey = null;
        this._lastStart = -999;
        if (!Carts.on() || InnerMap._deck || InnerMap._underwater) return;
        // The player's own handcart stands beside them
        if (game && Carts.owns(game.player)) {
            const spot = this._freeBeside({ q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR }, AROUND8);
            if (spot) this._add('handcart', [spot], { owner: 'player', facing: 2 });
        }
        // The town's carts, standing by its stores
        if (InnerMap.townArea && InnerMap.townArea()) this._parkTownCarts();
    },

    _add(kind, behind, opts = {}) {
        const c = Carts.make(`cart${++this._seq}`, kind, behind, opts);
        InnerMap.carts.push(c);
        InnerMap._cartsChanged();
        return c;
    },

    _remove(c) {
        this._freeDriver(c);
        if (c.load) this._unload(c);
        const i = InnerMap.carts.indexOf(c);
        if (i >= 0) InnerMap.carts.splice(i, 1);
        InnerMap._cartsChanged();
    },

    /** A free tile for a cart beside `at`: open ground, no one on it, no cart, not a doorway. */
    _freeBeside(at, dirs = AROUND4) {
        for (const [dq, dr] of dirs) {
            const q = at.q + dq, r = at.r + dr;
            if (this._free(q, r)) return { q, r };
        }
        return null;
    },

    _free(q, r, except = null) {
        if (!InnerMap._cartGround(q, r)) return false;
        const t = InnerMap.tiles[r][q];
        if (t.customObject || InnerMap._isShutGateTile(t)) return false;
        if (InnerMap.cartAt(q, r)) return false;
        return !InnerMap._cartTileTaken(q, r, except);
    },

    _stores(types) {
        const want = new Set(types || []);
        return (InnerMap._townBuildings ? InnerMap._townBuildings() : []).filter(b => b && want.has(String(b.type).replace(/^player_/, '')));
    },

    /** The town's handcarts left standing by its stores (at most parkedMax). */
    _parkTownCarts() {
        const C = Carts.config().carters;
        const stores = this._stores([...(C.from || []), ...(C.to || [])]);
        const s = this._town();
        const salt = s ? `${s.q},${s.r}` : 'wild';
        const picked = stores.slice().sort((a, b) => _frac(`${salt}|${a.q},${a.r}`) - _frac(`${salt}|${b.q},${b.r}`)).slice(0, Math.max(0, _num(C.parkedMax, 2)));
        for (const b of picked) {
            const door = InnerMap._findPassableAdjacentTile(b.q, b.r);
            // (beside the door, not on it: the way in stays clear)
            const spot = this._freeBeside(door, [[1, 0], [-1, 0], [2, 0], [-2, 0], [1, 1], [-1, 1]]);
            if (spot) {
                const c = this._add('handcart', [spot], { owner: 'town', facing: _frac(`${salt}|${b.q}|f`) < 0.5 ? 1 : 3 });
                c.home = { q: spot.q, r: spot.r, facing: c.facing };
                c.store = b;
            }
        }
    },

    // ──────────── EACH FRAME ────────────

    update(dt, game) {
        if (!InnerMap.active) {
            if (this.pushing) this._release(game, { quiet: true });
            return;
        }
        // Indoors: the carts wait in the street (a cart never goes in); the one hauled is left at the step
        if (InnerMap._insideBuilding) {
            if (this.pushing) this._release(game, { at: 'door' });
            return;
        }
        if (InnerMap.tiles !== this._tiles) this._newMap(game);
        if (!Carts.on()) return;
        this._clock += dt;
        // (the hauled cart first: whoever lies on it is laid where it now stands)
        if (this.pushing) this._haul(game);
        const carts = InnerMap.streetCarts();
        for (const c of carts.slice()) {
            if (c.driver) this._drive(c, dt, game);
            else if (c.stopT > 0) c.stopT -= dt;
            this._checkLoad(c);
        }
        // No one stands on a cart; the carters walking to the handles, the wagon's talk
        this._shoo();
        this._fetchStep(dt, game);
        this._caravanTalk();
        this._tick -= dt;
        if (this._tick > 0) return;
        this._tick = 2;
        if (!game || !game.world || !InnerMap.townArea || !InnerMap.townArea()) return;
        const hour = _num(InnerMap.timeOfDay, 12);
        this._maybeCarter(game, hour);
        this._maybePlague(game, hour);
        this._maybeCaravan(game, hour);
    },

    /** The one laid on a cart: they lie on it while it rolls; they come round and climb off, or are lifted off. */
    _checkLoad(c) {
        const n = c.load;
        if (!n) return;
        if (n._carried || n.state === 'gone' || (n.state !== 'unconscious' && n.state !== 'bound')) {
            // (came round: off the cart, onto their feet from where it stands — ui/innerMapCombat.js woke them)
            n._onCart = null;
            c.load = null;
            return;
        }
        const t = c.trail[0];
        n.q = n.prevQ = n.targetQ = t.q;
        n.r = n.prevR = n.targetR = t.r;
        n.path = null;
        n.moveProgress = 0;
    },

    _unload(c) {
        const n = c.load;
        c.load = null;
        if (!n) return;
        n._onCart = null;
        const spot = this._freeBeside(c.trail[0], AROUND8) || c.trail[0];
        n.q = n.prevQ = n.targetQ = spot.q;
        n.r = n.prevR = n.targetR = spot.r;
    },

    // ──────────── DRIVEN BY A TOWNSPERSON ────────────

    _canDrive(n) {
        if (!n || n.state === 'gone' || n._dialogFrozen || n._fight || n._rite || n._wedding || n._mourning || n._carried) return false;
        if (n.type === 'guard' || n.type === 'child' || n._behindCounter || n.departing || n._cartDriver || n._onCart) return false;
        if (n._sick && n._sick.abed) return false;
        return n.state === 'idle' || n.state === 'walking';
    },

    /** Put `n` at `c`'s handles (from wherever they stand beside it), set going along `path`. */
    _takeHandles(c, n, label) {
        if (InnerMap._sceneClear) InnerMap._sceneClear(n);
        n._activity = null;
        n._cartDriver = c.id;
        n._cartPace = n._cartPace || n.speed || 1;
        n.activity = { type: 'cart', icon: Carts.kind(c.kind).icon || '🛒', label, anim: 'idle', _scene: true };
        n.path = null;
        n.moveProgress = 0;
        n.state = 'idle';
        c.driver = n;
        c.parked = false;
        c.blockT = 0;
        c.claim = [{ q: n.q, r: n.r }];
        InnerMap._cartsChanged();
    },

    _freeDriver(c) {
        const n = c && c.driver;
        if (!n) return;
        n._cartDriver = null;
        n._cartWait = 0;
        if (n.activity && n.activity.type === 'cart') n.activity = null;
        if (n._cartPace) { n.speed = n._cartPace; n._cartPace = null; }
        n.path = null;
        n.moveProgress = 0;
        if (n.state === 'walking') n.state = 'idle';
        n.idleTimer = Math.min(_num(n.idleTimer, 1), 1.5);
        c.driver = null;
        c.claim = null;
    },

    /** Set the cart's leader going to `to` (a path round the town's ground; the cart's own body may be crossed). */
    _routeTo(c, to) {
        const d = c.driver;
        if (!d || !to) return false;
        const path = InnerMap._findPath(d.q, d.r, to.q, to.r);
        if (!path || path.length < 2) { c.path = null; return false; }
        c.path = path.slice(1);
        c.pi = 0;
        c.dest = { q: to.q, r: to.r };
        return true;
    },

    /** A townsperson walks the cart along its path, a tile at a time, and never onto anyone. */
    _drive(c, dt, game) {
        const d = c.driver;
        if (!d || d.state === 'gone' || d._fight || d.state === 'unconscious' || d.state === 'bound' || d._carried || d._rite || d._wedding || d._mourning) {
            // (taken from it — a fight, a blow, gone: it stands where it is)
            this._freeDriver(c);
            c.parked = true;
            c.path = null;
            if (c.job === 'caravan') this._remove(c);
            else InnerMap._cartsChanged();
            return;
        }
        if (d._dialogFrozen) return;
        if (c.stopT > 0) {
            c.stopT -= dt;
            d.state = 'idle';
            d.path = null;
            if (c.stopT <= 0) this._stopDone(c, game);
            return;
        }
        if (!c.path || c.pi >= c.path.length) { this._arrived(c, game); return; }
        const next = c.path[c.pi];
        if (!d.path) {
            // A step begins: only onto ground the wheels can take, clear of everyone
            const ok = Carts.stepAllowed(c, next, {
                ground: (q, r) => InnerMap._cartGround(q, r),
                taken: (q, r) => InnerMap._cartTileTaken(q, r, d),
                cartAt: (q, r) => InnerMap.cartAt(q, r),
            });
            if (!ok) {
                d.state = 'idle';
                d.facing = Carts.facingOf(d, next);
                c.blockT = _num(c.blockT) + dt;
                // "Mind the cart!": whoever stands in the way steps aside; else round them, else it gives up
                if (c.blockT > 1.5 && this._ready(`blk${c.id}`, 4, 8)) {
                    this._say(d, Carts.line(Carts.config().carters.lines, `${c.id}|${this._n++}`));
                    this._nudge(next, c);
                }
                if (c.blockT > 4 && Math.floor(c.blockT / 4) !== Math.floor((c.blockT - dt) / 4) && c.dest) this._routeAround(c, next);
                if (c.blockT > 25) { c.path = null; this._arrived(c, game, true); }
                return;
            }
            c.blockT = 0;
            const t = InnerMap.tiles[next.r][next.q];
            if (InnerMap._isShutGateTile(t)) InnerMap._npcPassGate(d, t, next.q, next.r);
            d.path = [next];
            d.pathIndex = 0;
            d.moveProgress = 0;
            d.prevQ = d.q;
            d.prevR = d.r;
            d.state = 'walking';
            // (the ground it is about to take: no one steps in under it)
            c.claim = [{ q: d.q, r: d.r }, { q: next.q, r: next.r }];
        }
        d.moveProgress += dt * _num(d._cartPace, 1) * 2 * _num(Carts.kind(c.kind).speed, 0.8);
        if (d.moveProgress >= 1) {
            const from = { q: d.q, r: d.r };
            d.q = next.q;
            d.r = next.r;
            d.moveProgress = 0;
            d.path = null;
            d.facing = Carts.facingOf(from, next);
            Carts.follow(c, from, next);
            c.claim = [{ q: d.q, r: d.r }];
            c.pi++;
        }
    },

    /** Set the cart's leader going to its destination round the tile `avoid` (someone who won't move). */
    _routeAround(c, avoid) {
        const keep = InnerMap._cartParkedIdx;
        const W = InnerMap._cartsW || InnerMap.width;
        const set = new Set(keep || []);
        set.w = W;
        set.add(avoid.r * W + avoid.q);
        InnerMap._cartParkedIdx = set;
        try { return this._routeTo(c, c.dest); } finally { InnerMap._cartParkedIdx = keep; }
    },

    /** Someone standing on (q, r) (not in a talk or a fight) steps aside, off the cart's way. */
    _nudge(at, c) {
        for (const n of InnerMap.npcs || []) {
            if (n.q !== at.q || n.r !== at.r || n === c.driver || n.state === 'inside_building' || n.state === 'gone') continue;
            if (n._dialogFrozen || n._fight || n.state === 'unconscious' || n.state === 'bound' || n._cartDriver || n._carried) continue;
            const on = new Set((c.path || []).map(p => `${p.q},${p.r}`));
            const spot = AROUND8.map(([dq, dr]) => ({ q: at.q + dq, r: at.r + dr }))
                .find(p => !on.has(`${p.q},${p.r}`) && this._free(p.q, p.r, n) && InnerMap.tiles[p.r][p.q].subTerrain.passable);
            if (spot) this._stepAside(n, spot);
        }
    },

    _stepAside(n, spot) {
        n.q = n.prevQ = spot.q;
        n.r = n.prevR = spot.r;
        n.moveProgress = 0;
        if (n.state === 'walking') { n.path = null; n.state = 'idle'; n.idleTimer = 0.5; }
    },

    /**
     * Each frame: no one stands on a cart's body (someone come out of a house onto the step it
     * stands on, set down on it by a scene): they step off it.
     */
    _shoo() {
        for (const c of InnerMap.streetCarts()) {
            for (const t of c.trail) {
                for (const n of InnerMap.npcs || []) {
                    if (n.q !== t.q || n.r !== t.r || n === c.driver || n === c.load || n._onCart || n._carried) continue;
                    if (n.state === 'inside_building' || n.state === 'gone' || n.state === 'unconscious' || n.state === 'bound') continue;
                    const spot = AROUND8.map(([dq, dr]) => ({ q: t.q + dq, r: t.r + dr })).find(p => this._free(p.q, p.r, n) && InnerMap.tiles[p.r][p.q].subTerrain.passable);
                    if (spot) this._stepAside(n, spot);
                }
            }
        }
    },

    _arrived(c, game, gaveUp = false) {
        const d = c.driver;
        if (d) d.state = 'idle';
        c.path = null;
        if (c.job === 'carter') return this._carterArrived(c, game, gaveUp);
        if (c.job === 'plague') return this._plagueArrived(c, game, gaveUp);
        if (c.job === 'caravan') return this._caravanArrived(c, game, gaveUp);
        this._freeDriver(c);
        c.parked = true;
        InnerMap._cartsChanged();
    },

    _stopDone(c, game) {
        if (c.job === 'plague') return this._plagueNext(c, game);
        if (c.job === 'carter') return this._carterHome(c);
        if (c.job === 'caravan') return this._caravanLeave(c, game);
        return null;
    },

    // ──────────── CARTERS ────────────

    _maybeCarter(game, hour) {
        const C = Carts.config().carters;
        if (!Carts.inHours(hour, C.hours)) return;
        if (this._clock - this._lastStart < _num(C.gapSecs, 40)) return;
        const busy = InnerMap.streetCarts().filter(c => c.job === 'carter').length;
        if (busy >= _num(C.max, 2)) return;
        const from = this._stores(C.from), to = this._stores(C.to);
        if (from.length + to.length < _num(C.minStores, 2) || !from.length || !to.length) return;
        // A town cart standing by a store, else one wheeled out of a store's yard
        const parked = InnerMap.streetCarts().filter(c => c.owner === 'town' && c.parked && !c.driver && !c.load && !c._takenBy && c.kind === 'handcart' && !c.job);
        const jobs = new Set(C.jobs || []);
        const who = (InnerMap.npcs || []).filter(n => this._canDrive(n) && n._person && n._person.job && jobs.has(n._person.job.id) && n.state !== 'inside_building');
        if (!who.length) return;
        const k = Math.floor(this._roll('carter') * who.length) % who.length;
        const n = who[k];
        let c = parked.sort((a, b) => _cheb(a.trail[0], n) - _cheb(b.trail[0], n))[0] || null;
        let src = c ? c.store : null;
        if (!c) {
            src = from[Math.floor(this._roll('from') * from.length) % from.length];
            const door = InnerMap._findPassableAdjacentTile(src.q, src.r);
            const spot = this._freeBeside(door, [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]]);
            if (!spot) return;
            c = this._add('handcart', [spot], { owner: 'town', facing: 2 });
            c.home = { q: spot.q, r: spot.r, facing: 2 };
            c.store = src;
        }
        const dests = to.filter(b => b !== src);
        if (!dests.length) return;
        const dst = dests[Math.floor(this._roll('to') * dests.length) % dests.length];
        const handle = this._handleToward(c, dst);
        if (!handle) return;
        this._lastStart = this._clock;
        c.job = 'carter';
        c.variant = 'loaded';
        c.goods = ['grain', 'flour', 'wool', 'salt', 'cabbage', 'turnips'][Math.floor(this._roll('good') * 6) % 6];
        c.to = dst;
        c.phase = 'fetch';
        // The carter walks to the handles first
        c._handle = handle;
        c._waiting = n;
        n._cartDriver = null;
        if (InnerMap._sceneClear) InnerMap._sceneClear(n);
        InnerMap._goStand(n, handle, 'cart_fetch', Carts.facingOf(handle, c.trail[0]));
        c.fetchT = 0;
        // (watched each frame till they reach it: _fetchStep)
        if (!this._fetching) this._fetching = new Set();
        this._fetching.add(c);
    },

    /** A carter on the way to the handles: there, they take them and set off; not there in time, the job is dropped. */
    _fetchStep(dt, game) {
        if (!this._fetching || !this._fetching.size) return;
        for (const c of [...this._fetching]) {
            const n = c._waiting;
            c.fetchT = _num(c.fetchT) + dt;
            if (!n || n.state === 'gone' || n._fight || n._dialogFrozen || c._takenBy || c.driver || c.fetchT > 60) {
                this._fetching.delete(c);
                c._waiting = null;
                if (!c.driver) { c.job = null; c.variant = 'empty'; c.parked = true; InnerMap._cartsChanged(); }
                continue;
            }
            if (n.state === 'walking') continue;
            if (_cheb(n, c.trail[0]) > 1) {
                if (n.state === 'idle' && c.fetchT > 2) InnerMap._goStand(n, c._handle, 'cart_fetch');
                continue;
            }
            this._fetching.delete(c);
            c._waiting = null;
            this._takeHandles(c, n, `Pulling a cart of ${String(c.goods || 'goods').replace(/_/g, ' ')}`);
            const door = InnerMap._findPassableAdjacentTile(c.to.q, c.to.r);
            c.phase = 'deliver';
            if (!this._routeTo(c, this._stopBeside(door, c))) { this._freeDriver(c); c.job = null; c.variant = 'empty'; c.parked = true; InnerMap._cartsChanged(); continue; }
            if (this._near(n)) this._say(n, Carts.line(Carts.config().carters.lines, `${c.id}|go|${this._n++}`));
        }
    },

    /** The free tile at the cart's front, on the side toward where it goes (so it sets off without turning about). */
    _handleToward(c, to) {
        const t = c.trail[0];
        const dirs = AROUND4.slice().sort((a, b) => (Math.abs(t.q + a[0] - to.q) + Math.abs(t.r + a[1] - to.r)) - (Math.abs(t.q + b[0] - to.q) + Math.abs(t.r + b[1] - to.r)));
        return this._freeBeside(t, dirs);
    },

    /** Where to stop the leader by a door so the cart stands beside it, not across it. */
    _stopBeside(door, c) {
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [2, 0], [-2, 0]]) {
            const q = door.q + dq, r = door.r + dr;
            if (InnerMap._cartGround(q, r) && !InnerMap.tiles[r][q].customObject && (!InnerMap.cartAt(q, r) || InnerMap.cartAt(q, r) === c)) return { q, r };
        }
        return door;
    },

    _carterArrived(c, game, gaveUp) {
        if (c.phase === 'deliver' && !gaveUp) {
            // At the store: the sacks off, then back with it
            c.phase = 'unload';
            c.stopT = 6;
            if (c.driver && this._near(c.driver)) this._say(c.driver, 'Unloading!', true);
            return;
        }
        if (c.phase === 'home' || gaveUp) {
            // Back where it stands: left there, the carter about their day
            this._freeDriver(c);
            c.parked = true;
            c.job = null;
            c.variant = 'empty';
            InnerMap._cartsChanged();
        }
    },

    _carterHome(c) {
        c.variant = 'empty';
        c.phase = 'home';
        const home = c.home || null;
        if (!home || !this._routeTo(c, home)) this._carterArrived(c, null, true);
    },

    // ──────────── THE DEATH CART ────────────

    _maybePlague(game, hour) {
        const P = Carts.config().plague;
        if (!Carts.inHours(hour, P.hours) || !Illness.on()) return;
        const s = this._town();
        if (!s || !s.folk) return;
        const day = _num(game.world.day, 1);
        const key = `${s.q},${s.r}|${day}|${hour < 13 ? 'am' : 'pm'}`;
        if (this._plagueKey === key || InnerMap.streetCarts().some(c => c.job === 'plague' && c.driver)) return;
        const sk = Illness.townSickness(s, day);
        const plague = !!(sk && sk.k && (Illness.def(sk.k) || {}).plague);
        const homes = InnerMap._plagueDoors || [];
        if (!plague || !homes.length) return;
        this._plagueKey = key;
        this._startPlague(game, s, day, homes);
    },

    _startPlague(game, s, day, homes) {
        const P = Carts.config().plague;
        const A = InnerMap.townArea();
        const gate = (A.gates || []).slice().sort((a, b) => _cheb(a, A.center) - _cheb(b, A.center))[0] || A.center;
        const doors = homes.map(h => InnerMap._findPassableAdjacentTile(h.q, h.r));
        const round = Carts.plagueRound(doors, gate, _num(P.maxDoors, 8));
        if (!round.length) return null;
        // The carter: a labourer or carter of the town, else any grown townsman about, not sick
        const pool = (InnerMap.npcs || []).filter(n => this._canDrive(n) && n.state !== 'inside_building' && !n._sick && n._person
            && Townsfolk.age(n._person, day) >= 18);
        const jobs = ['labourer', 'carter', 'gravedigger'];
        pool.sort((a, b) => (jobs.includes((b._person.job || {}).id) ? 1 : 0) - (jobs.includes((a._person.job || {}).id) ? 1 : 0) || _cheb(a, round[0]) - _cheb(b, round[0]));
        const n = pool[0];
        if (!n) return null;
        // The cart is wheeled out beside them (behind them, as they face the first door)
        const away = AROUND4.slice().sort((a, b) => (Math.abs(n.q + b[0] - round[0].q) + Math.abs(n.r + b[1] - round[0].r)) - (Math.abs(n.q + a[0] - round[0].q) + Math.abs(n.r + a[1] - round[0].r)));
        const spot = this._freeBeside(n, away);
        if (!spot) return null;
        const c = this._add('handcart', [spot], { owner: 'town', facing: Carts.facingOf(spot, n), job: 'plague' });
        const dead = Carts.bodiesDue(s.folk, day, _num(P.bodyDays, 3), _num(P.maxBodies, 4)).length;
        c.round = round;
        c.ri = 0;
        c.dead = dead;
        c.bodies = 0;
        c.pit = this._pitSpot(gate);
        this._takeHandles(c, n, 'The death cart');
        n._crier = true;
        this._plagueGoNext(c);
        if (_cheb(n, { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR }) <= 40) {
            _note(game, '☠️ The death cart', 'A cart comes round the plague houses. "Bring out your dead!"', 'warning');
        }
        return c;
    },

    /** The churchyard's gate, else ground out past the town's gate (a plague pit). */
    _pitSpot(gate) {
        const yard = InnerMap.townYard ? InnerMap.townYard() : null;
        if (yard && yard.gate) return { q: yard.gate.q, r: yard.gate.r, yard: true };
        const [dq, dr] = STEP[_num(gate.face, 2)] || [0, 1];
        for (let k = 6; k >= 2; k--) {
            const q = gate.q + dq * k, r = gate.r + dr * k;
            if (InnerMap._cartGround(q, r) && !InnerMap.tiles[r][q].customObject) return { q, r, yard: false };
        }
        return { q: gate.q, r: gate.r, yard: false };
    },

    _plagueGoNext(c) {
        if (c.ri >= c.round.length) {
            c.phase = 'pit';
            if (!this._routeTo(c, c.pit)) this._plagueArrived(c, null, true);
            return;
        }
        c.phase = 'door';
        const door = c.round[c.ri];
        if (!this._routeTo(c, this._stopBeside(door, c))) { c.ri++; this._plagueGoNext(c); }
    },

    _plagueArrived(c, game, gaveUp) {
        const P = Carts.config().plague;
        const L = P.lines || {};
        const d = c.driver;
        if (c.phase === 'door' && !gaveUp) {
            // At a marked door: the cry, a wait; the dead of the house brought out
            c.stopT = _num(P.stopSecs, 7);
            const n = Carts.bodiesAt(c.ri, c.round.length, c.dead);
            if (d) this._say(d, Carts.line(L.cry, `${c.id}|cry|${c.ri}`), true);
            if (n > 0) {
                c.bodies += n;
                c.variant = 'plague';
                c._loadSay = Carts.line(L.load, `${c.id}|load|${c.ri}`);
            }
            return;
        }
        if (c.phase === 'pit' || gaveUp) {
            if (d && c.bodies > 0) this._say(d, Carts.line(L.pit, `${c.id}|pit`), true);
            c.phase = 'done';
            c.stopT = c.bodies > 0 ? 8 : 0;
            if (!c.stopT) this._plagueDone(c);
        }
    },

    _plagueNext(c) {
        if (c.phase === 'done') { this._plagueDone(c); return; }
        if (c._loadSay && c.driver) { this._say(c.driver, c._loadSay, true); c._loadSay = null; }
        c.ri++;
        this._plagueGoNext(c);
    },

    _plagueDone(c) {
        // Laid in the pit: the cart stands empty where it is, its man back to his day
        c.bodies = 0;
        c.variant = 'empty';
        if (c.driver) c.driver._crier = false;
        this._freeDriver(c);
        c.parked = true;
        c.job = 'plague_done';
        InnerMap._cartsChanged();
    },

    // ──────────── A CARAVAN LEAVING ────────────

    _maybeCaravan(game, hour) {
        const K = Carts.config().caravan;
        if (!Carts.inHours(hour, K.hours)) return;
        if (InnerMap.streetCarts().some(c => c.job === 'caravan')) return;
        const s = this._town();
        if (!s) return;
        const day = _num(game.world.day, 1);
        const unit = Carts.departingCaravan(game.world, s.q, s.r, day);
        if (!unit || this._caravans.has(unit.id)) return;
        this._caravans.add(unit.id);
        this._startCaravan(game, s, unit);
    },

    /** Three tiles in a row on open ground near `at` (the merchant's, the horse's, the wagon's), facing along them. */
    _wagonSpot(at) {
        for (let rad = 0; rad <= 8; rad++) {
            for (let dq = -rad; dq <= rad; dq++) {
                for (let dr = -rad; dr <= rad; dr++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    for (const f of [3, 1, 2, 0]) {
                        const [sq, sr] = STEP[f];
                        const lead = { q: at.q + dq, r: at.r + dr };
                        const t0 = { q: lead.q - sq, r: lead.r - sr }, t1 = { q: lead.q - 2 * sq, r: lead.r - 2 * sr };
                        if ([lead, t0, t1].every(p => this._free(p.q, p.r))) return { lead, trail: [t0, t1], facing: f };
                    }
                }
            }
        }
        return null;
    },

    _startCaravan(game, s, unit) {
        const K = Carts.config().caravan;
        const A = InnerMap.townArea();
        const market = this._stores(['marketplace'])[0];
        const at = market ? InnerMap._findPassableAdjacentTile(market.q, market.r) : A.center;
        const spot = this._wagonSpot(at);
        if (!spot) return null;
        const day = _num(game.world.day, 1);
        const free = (InnerMap.npcs || []).filter(n => this._canDrive(n) && n.state !== 'inside_building' && n._person && Townsfolk.age(n._person, day) >= 16);
        const isMerchant = n => n._person.job && n._person.job.id === 'merchant';
        free.sort((a, b) => (isMerchant(b) ? 1 : 0) - (isMerchant(a) ? 1 : 0) || _cheb(a, spot.lead) - _cheb(b, spot.lead));
        const merchant = free[0];
        if (!merchant) return null;
        const c = this._add('wagon', spot.trail, { owner: 'merchant', facing: spot.facing, job: 'caravan', variant: 'loaded' });
        c.unit = { id: unit.id, good: Carts.cargoWord(unit), to: unit.toName || 'the next town' };
        // The merchant stands at the horse's head; the porters bring the sacks to its side
        merchant.q = merchant.prevQ = spot.lead.q;
        merchant.r = merchant.prevR = spot.lead.r;
        this._takeHandles(c, merchant, `Loading the ${c.unit.good} wagon`);
        merchant.facing = spot.facing;
        c.phase = 'load';
        c.stopT = _num(K.loadSecs, 30);
        c.porters = free.filter(n => n !== merchant && !isMerchant(n)).slice(0, Math.max(0, _num(K.porters, 2)));
        c.porters.forEach((p, i) => {
            const side = this._freeBeside(c.trail[i % c.trail.length], [[0, 1], [0, -1], [1, 0], [-1, 0]]);
            p._carry = { good: unit.mainGood || 'grain', qty: 0 };
            p._cartPorter = c.id;
            if (side) InnerMap._goStand(p, side, 'cart_load', Carts.facingOf(side, c.trail[i % c.trail.length]));
        });
        c.sayAt = this._clock + 3;
        if (this._near(merchant)) _note(game, '🐴 A caravan loading', `${merchant.name} loads a wagon of ${c.unit.good} at the market, bound for ${c.unit.to}.`, 'info');
        return c;
    },

    /** Loaded: out by the nearest gate, and on out of the town. */
    _caravanLeave(c, game) {
        const K = Carts.config().caravan;
        for (const p of c.porters || []) { p._carry = null; p._cartPorter = null; if (p.state === 'idle') p.idleTimer = 1; }
        c.porters = [];
        const A = InnerMap.townArea();
        const d = c.driver;
        if (!A || !d) { this._remove(c); return; }
        const gate = (A.gates || []).slice().sort((a, b) => _cheb(a, d) - _cheb(b, d))[0];
        if (!gate) { this._remove(c); return; }
        if (this._near(d)) this._say(d, Carts.line((K.lines || {}).leave, `${c.id}|leave`, { to: c.unit.to }), true);
        d.activity.label = `Driving the wagon to ${c.unit.to}`;
        const [dq, dr] = STEP[_num(gate.face, 2)] || [0, 1];
        let out = gate;
        for (let k = 8; k >= 1; k--) {
            const q = gate.q + dq * k, r = gate.r + dr * k;
            if (InnerMap._cartGround(q, r)) { out = { q, r }; break; }
        }
        c.phase = 'out';
        if (!this._routeTo(c, out)) this._caravanArrived(c, game, true);
    },

    _caravanArrived(c, game, gaveUp) {
        if (c.phase === 'load') return;
        // Out of the gate and away: the wagon and its merchant gone on the road
        const d = c.driver;
        this._freeDriver(c);
        if (d && !gaveUp) d.state = 'gone';
        this._remove(c);
    },

    /** While a wagon loads: the porters' and merchant's words now and then. */
    _caravanTalk() {
        const K = Carts.config().caravan;
        for (const c of InnerMap.streetCarts()) {
            if (c.job !== 'caravan' || c.phase !== 'load' || this._clock < _num(c.sayAt)) continue;
            c.sayAt = this._clock + 6 + this._roll(c.id, 'say') * 4;
            const who = [c.driver, ...(c.porters || [])].filter(n => n && n.state !== 'gone' && this._near(n));
            if (!who.length) continue;
            const n = who[Math.floor(this._roll(c.id, 'who') * who.length) % who.length];
            this._say(n, Carts.line((K.lines || {}).load, `${c.id}|${this._n++}`, { good: c.unit.good }));
        }
    },

    // ──────────── THE PLAYER AT THE HANDLES ────────────

    /** Carts within the player's reach that they may use (not one being pulled), nearest first. */
    usableNear(reach = null) {
        const R = reach != null ? reach : _num(Carts.config().use.reach, 1);
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        return InnerMap.streetCarts().filter(c => Carts.canUse(c).ok && c.trail.some(t => _cheb(t, me) <= R))
            .sort((a, b) => _cheb(a.trail[0], me) - _cheb(b.trail[0], me));
    },

    /** Take hold of a cart's handles: it follows the player at a slow walk. */
    take(game, c) {
        const chk = Carts.canUse(c);
        if (!chk.ok) { _note(game, '🛒 Not that cart', `You can't take that cart: ${chk.reason}.`, 'warning'); return false; }
        if (InnerMapCarry.handsFull()) { _note(game, '🙌 Your hands are full', InnerMapCarry.person ? `Lay ${InnerMapCarry.person.name} on it, or put them down first.` : 'Put down what you carry first.', 'warning'); return false; }
        if (this.pushing && this.pushing !== c) this._release(game, { quiet: true });
        if (chk.theft) this._theft(game, c);
        c.pusher = 'player';
        c.parked = false;
        c.job = c.job === 'plague_done' ? null : c.job;
        this.pushing = c;
        this._last = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        if (this._baseSpeed == null) this._baseSpeed = InnerMap._playerSpeed;
        InnerMap._playerSpeed = this._baseSpeed * Carts.pushSpeed(game && game.player, c);
        InnerMap._cartsChanged();
        _note(game, '🛒 At the handles', c.owner === 'player' ? 'You take up your handcart.' : 'You take up the cart by its handles.', 'info');
        return true;
    },

    /** Someone sees the player take a cart that isn't theirs: a petty theft of its use. */
    _theft(game, c) {
        c._takenBy = 'player';
        const U = Carts.config().use;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const seen = Carts.witnesses(InnerMap.npcs, me, _num(U.seenWithin, 7)).sort((a, b) => _cheb(a, me) - _cheb(b, me));
        if (!seen.length) return false;
        const w = seen[0];
        InnerMapReactions.bark(w, Carts.line(Carts.config().lines.theft, `${c.id}|theft`), 3.5);
        const player = game && game.player, world = game && game.world;
        if (player) NpcDisposition.adjustDisposition(w, _num(U.disposition, -12), player);
        if (player && world) {
            const wt = InnerMap.currentWorldTile || {};
            const s = this._town();
            Underworld.recordCrime(player, world, 'theft', {
                kingdom: s ? s.kingdom : null, q: wt.q, r: wt.r, scale: _num(U.crimeScale, 0.4),
                victim: { name: 'the town', type: 'villager', icon: '🛒' },
            });
        }
        _note(game, '👀 Seen', `${w.name} saw you take a cart that isn't yours.`, 'warning');
        return true;
    },

    /** Let go of the handles: the cart stands where it is (opts.at 'door': left at the step going in). */
    _release(game, opts = {}) {
        const c = this.pushing;
        this.pushing = null;
        this._last = null;
        if (this._baseSpeed != null) { InnerMap._playerSpeed = this._baseSpeed; this._baseSpeed = null; }
        if (!c) return null;
        c.pusher = null;
        c.parked = true;
        InnerMap._cartsChanged();
        if (!opts.quiet) {
            if (opts.at === 'door') _note(game, '🛒 Left at the door', 'A cart won\'t go indoors: you leave it standing outside.', 'info');
            else _note(game, '🛒 Let go', 'You set the cart down where it stands.', 'info');
        }
        return c;
    },

    /**
     * Something taken up while hauling (someone, a body, a carcass): its walk was reckoned from the
     * cart's slow one — it is reckoned from the walk without the cart, which it gives back in the end.
     */
    _handOffSpeed() {
        const base = this._baseSpeed;
        if (base == null) return;
        const cur = InnerMap._playerSpeed;
        let k = null;
        if (InnerMapCarry._baseSpeed != null && InnerMapCarry._baseSpeed > 0) { k = cur / InnerMapCarry._baseSpeed; InnerMapCarry._baseSpeed = base; }
        else if (InnerMapDigging._baseSpeed != null && InnerMapDigging._baseSpeed > 0) { k = cur / InnerMapDigging._baseSpeed; InnerMapDigging._baseSpeed = base; }
        else if (InnerMapAnimals._carry && InnerMapAnimals._carry.base > 0) { k = cur / InnerMapAnimals._carry.base; InnerMapAnimals._carry.base = base; }
        InnerMap._playerSpeed = k != null ? base * k : base;
        this._baseSpeed = null;
    },

    /** Each frame: the hauled cart follows the player's steps (never through a door, never into the water). */
    _haul(game) {
        const c = this.pushing;
        if (!c || !InnerMap.carts.includes(c)) { this.pushing = null; return; }
        // A body or a carcass on the shoulder: the handles are let go
        if (InnerMapCarry.handsFull() || InnerMapCombat.playerKnockedOut()) {
            if (InnerMapCarry.handsFull()) this._handOffSpeed();
            this._release(game, { quiet: InnerMapCombat.playerKnockedOut() });
            return;
        }
        const P = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const last = this._last || P;
        if (P.q === last.q && P.r === last.r) return;
        this._last = P;
        // (a leap — a climb, a fall, a door to another place: let go)
        if (_cheb(P, last) > 1) { this._release(game); return; }
        // Onto ground the wheels can't take (a doorway, the water): the cart stays behind
        if (!InnerMap._cartGround(P.q, P.r) || InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming()) return;
        if (!InnerMap._cartGround(last.q, last.r)) return;
        Carts.follow(c, last, P);
    },

    // ──────────── SOMEONE ON THE CART ────────────

    /** Lay the one over the player's shoulder on the cart beside them. */
    layOn(game, c = null) {
        const npc = InnerMapCarry.person;
        if (!npc) return false;
        const cart = c || this.usableNear().find(x => !x.load) || (this.pushing && !this.pushing.load ? this.pushing : null);
        if (!cart || cart.load) { _note(game, '🛒 No cart', 'There is no free cart within reach.', 'warning'); return false; }
        const chk = Carts.canUse(cart);
        if (!chk.ok && cart !== this.pushing) { _note(game, '🛒 Not that cart', `You can't use that cart: ${chk.reason}.`, 'warning'); return false; }
        if (chk.theft && cart !== this.pushing) this._theft(game, cart);
        InnerMapCarry.letGo();
        cart.load = npc;
        npc._onCart = cart.id;
        npc._lyingIn = null;
        npc._koBed = null;
        const t = cart.trail[0];
        npc.q = npc.prevQ = npc.targetQ = t.q;
        npc.r = npc.prevR = npc.targetR = t.r;
        // (on the street's list: they lie on the cart in the street)
        const outer = InnerMap._outerMapState && InnerMap._insideBuilding ? InnerMap._outerMapState.npcs : InnerMap.npcs;
        if (outer && !outer.includes(npc)) outer.push(npc);
        _note(game, '🛒 On the cart', Carts.line(Carts.config().lines.laid, `${npc.id}`, { name: npc.name }) || `You lay ${npc.name} on the cart.`, 'info');
        return true;
    },

    /** Lift the one lying on a cart back onto the player's shoulder. */
    liftOff(game, c) {
        const npc = c && c.load;
        if (!npc) return false;
        if (this.pushing === c) this._release(game, { quiet: true });
        c.load = null;
        npc._onCart = null;
        return InnerMapCarry.pickUp(game, npc);
    },

    // ──────────── THE MENU ────────────

    /** Menu entries: the cart clicked or at hand, the one hauled, laying the carried on a cart. */
    menuItems(game, tile, q, r) {
        const out = [];
        if (!InnerMap.active || InnerMap._insideBuilding || !Carts.on()) return out;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const clicked = InnerMap.cartAt(q, r);
        const c = this.pushing;
        if (c) {
            out.push({ type: 'header', label: `🛒 Hauling ${c.owner === 'player' ? 'your handcart' : 'a handcart'}${c.load ? ` (${c.load.name} on it)` : ''}` });
            out.push({ type: 'action', action: 'cart_let_go', label: 'Let Go of the Cart', icon: '⬇️', desc: 'Set it down where it stands' });
            if (c.load && !InnerMapCarry.handsFull()) out.push({ type: 'action', action: 'cart_lift', label: 'Lift Them off the Cart', icon: '🚶', desc: `Over your shoulder again: ${c.load.name}`, cartId: c.id });
        }
        if (InnerMapCarry.person) {
            const free = this.usableNear().filter(x => !x.load);
            const cart = (c && !c.load) ? c : free[0];
            if (cart) out.push({ type: 'action', action: 'cart_lay', label: 'Lay Them on the Cart', icon: '🛒', desc: cart.owner === 'player' || cart === c ? 'On the cart, to wheel them along' : 'On the cart standing here (not yours: taking it is theft of its use)', cartId: cart.id });
        }
        if (clicked && clicked !== c) {
            const K = Carts.kind(clicked.kind);
            const whose = clicked.owner === 'player' ? 'Your handcart' : clicked.job === 'plague' || clicked.job === 'plague_done' ? 'The death cart' : clicked.kind === 'wagon' ? 'A merchant\'s wagon' : 'A town handcart';
            out.push({ type: 'header', label: `${K.icon || '🛒'} ${whose}${clicked.load ? ` — ${clicked.load.name} lies on it` : clicked.bodies > 0 ? ' — the dead on it' : ''}` });
            const chk = Carts.canUse(clicked);
            if (chk.ok && !c) {
                out.push({ type: 'action', action: 'cart_take', label: 'Take the Cart\'s Handles', icon: '🛒', desc: chk.theft ? 'Haul it off at a slow walk (not yours: theft of its use, if anyone sees)' : 'Haul it along at a slow walk', cartId: clicked.id });
            } else if (!chk.ok) out.push({ type: 'disabled', label: `Can't take it: ${chk.reason}` });
            if (clicked.load && !InnerMapCarry.handsFull() && _cheb(me, clicked.trail[0]) <= 1) {
                out.push({ type: 'action', action: 'cart_lift', label: 'Lift Them off the Cart', icon: '🚶', desc: `Over your shoulder: ${clicked.load.name} (${Downed.label(clicked.load) || 'senseless'})`, cartId: clicked.id });
            }
        }
        return out;
    },

    _byId(id) { return InnerMap.streetCarts().find(c => c.id === id) || null; },

    /** Handle a cart order. Returns true when it was one. */
    handle(game, item) {
        switch (item.action) {
            case 'cart_take': {
                const c = this._byId(item.cartId);
                if (!c) return true;
                const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
                const act = () => { if (InnerMap.carts.includes(c)) this.take(game, c); };
                if (c.trail.some(t => _cheb(t, me) <= 1)) { act(); return true; }
                const res = InnerMap.approachAndThen(c.trail[0].q, c.trail[0].r, act);
                if (res === 'unreachable') _note(game, 'Blocked', 'You can\'t reach the cart.', 'error');
                return true;
            }
            case 'cart_let_go': this._release(game); return true;
            case 'cart_lay': this.layOn(game, this._byId(item.cartId)); return true;
            case 'cart_lift': this.liftOff(game, this._byId(item.cartId)); return true;
            default: return false;
        }
    },

    // ──────────── LITTLE HELPERS ────────────

    _roll(...parts) { return _frac(`${parts.join('|')}|${this._n++}|${Math.floor(this._clock * 10)}`); },

    _next: new Map(),
    _ready(key, lo, hi) {
        const at = this._next.get(key);
        if (at != null && this._clock < at) return false;
        this._next.set(key, this._clock + lo + this._roll(key, 'cd') * (hi - lo));
        return true;
    },

    _near(n) { return !!n && _cheb(n, { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR }) <= 14; },

    /** A line over their head, when the player is near (force: a little further, a cry carries). */
    _say(n, text, force = false) {
        if (!n || !text) return;
        const far = _cheb(n, { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR });
        if (far > (force ? 24 : 14)) return;
        InnerMapReactions.bark(n, text, 3.4);
    },

    // ──────────── DRAWN ────────────

    _img(path) {
        if (!path || typeof Image === 'undefined') return null;
        let e = this._imgs.get(path);
        if (!e) {
            const img = new Image();
            e = { img, ok: false };
            img.onload = () => { e.ok = true; };
            img.src = path;
            this._imgs.set(path, e);
        }
        return e.ok ? e.img : null;
    },

    /** The cart's body's middle, drawn: between its tiles, slid on as its leader walks (world px). */
    _bodyPos(c, T) {
        const lead = this._leaderPos(c, T);
        const n = c.trail.length;
        const k = lead && lead.p > 0 ? lead.p : 0;
        // Each body tile slides toward the one ahead of it (the first toward the leader's tile)
        let x = 0, y = 0;
        for (let i = 0; i < n; i++) {
            const a = c.trail[i];
            const b = i === 0 ? (lead ? lead.from : a) : c.trail[i - 1];
            x += (a.q + (b.q - a.q) * k) * T + T / 2;
            y += (a.r + (b.r - a.r) * k) * T + T / 2;
        }
        return { x: x / n, y: y / n, lead };
    },

    /** Where the one leading the cart is drawn ({ x, y, from: their tile, p: the step's progress }), or null. */
    _leaderPos(c, T) {
        if (c.pusher === 'player') {
            const pos = InnerMap.getPlayerWorldPos();
            const from = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
            const p = pos.walking ? Math.max(0, Math.min(1, Math.hypot(pos.x - (from.q * T + T / 2), pos.y - (from.r * T + T / 2)) / T)) : 0;
            // (the cart only follows on ground it can take)
            return { x: pos.x, y: pos.y, from, p: InnerMap._cartGround(from.q, from.r) && pos.walking ? p : 0 };
        }
        const d = c.driver;
        if (!d) return null;
        const t = d.path && d.path[d.pathIndex || 0];
        const p = t && d.state === 'walking' ? _num(d.moveProgress) : 0;
        return {
            x: (d.q + (t ? (t.q - d.q) * p : 0)) * T + T / 2,
            y: (d.r + (t ? (t.r - d.r) * p : 0)) * T + T / 2,
            from: { q: d.q, r: d.r }, p,
        };
    },

    collect(items, ctx, camera, T) {
        if (!InnerMap.active || InnerMap._insideBuilding) return;
        const carts = InnerMap.streetCarts();
        if (!carts.length) return;
        const art = Carts.config().art || {};
        const ds = T * camera.zoom;
        for (const c of carts) {
            const A = art[c.kind];
            const img = A && this._img(A.sheet);
            const b = this._bodyPos(c, T);
            // Facing: from the body toward the one leading it (else as it stands)
            let face = c.facing;
            if (b.lead) {
                const dx = b.lead.x - b.x, dy = b.lead.y - b.y;
                if (Math.abs(dx) > 1 || Math.abs(dy) > 1) face = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 3 : 1) : (dy >= 0 ? 2 : 0);
            }
            const [fx, fy] = STEP[face];
            const cx = b.x + fx * _num(A && A.lead, 0.4) * T;
            const cy = b.y + fy * _num(A && A.lead, 0.4) * T - _num(A && A.lift, 0.2) * T;
            const s0 = camera.worldToScreenFast(cx, cy);
            const sc = { x: s0.x, y: s0.y };
            if (sc.x < -ds * 4 || sc.y < -ds * 4 || sc.x > ctx.canvas.width + ds * 4 || sc.y > ctx.canvas.height + ds * 4) continue;
            const maxR = Math.max(...c.trail.map(t => t.r));
            // (by the body's lowest row, before anyone standing on that row's foot)
            const sortY = Math.max(maxR * T + T / 2, b.y) + T / 2 - 1;
            const row = A && A.rows ? _num(A.rows[c.bodies > 0 ? 'plague' : c.variant], _num(A.rows.empty, 0)) : 0;
            const load = c.load;
            const lp = load ? camera.worldToScreenFast(b.x, b.y - T * 0.32) : null;
            const lx = lp ? lp.x : 0, ly = lp ? lp.y : 0;
            items.push({ sortY, zLayer: 2, sortX: c.trail[0].q, draw: () => {
                const size = _num(A && A.scale, 1.7) * ds;
                if (img) {
                    const cell = _num(A.cell, 68);
                    const smooth = ctx.imageSmoothingEnabled;
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, face * cell, row * cell, cell, cell, Math.round(sc.x - size / 2), Math.round(sc.y - size / 2), Math.round(size), Math.round(size));
                    ctx.imageSmoothingEnabled = smooth;
                } else {
                    // (the art not in yet: a plain plank box on two wheels)
                    ctx.save();
                    ctx.fillStyle = '#5b3a21';
                    ctx.fillRect(sc.x - ds * 0.45, sc.y - ds * 0.3, ds * 0.9, ds * 0.5);
                    ctx.fillStyle = '#2b2018';
                    ctx.beginPath(); ctx.arc(sc.x, sc.y + ds * 0.2, ds * 0.18, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
                // Someone laid on it: lying in the bed of the cart
                // (along the bed: across it when the cart goes east or west, lengthwise when up or down the street)
                if (load) InnerMapCombat.drawKnockedOut(ctx, camera, load, lx, ly, face === 0 || face === 2 ? { along: 'ns', headUp: face === 0 } : {});
            } });
        }
    },
};
