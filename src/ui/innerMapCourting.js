// ============================================
// INNER MAP COURTING — sweethearts on the street map
// ============================================
// The street map's half of systems/romance.js, while the player walks a town
// (where they go is world/innerMap/townCourting.js):
//
//   - a pair flirting who pass or stand near each other trade a line and a
//     blush ("Lovely morning, isn't it, Marta?" — "*blushes* Is it?");
//   - a courting pair together (walked out of an evening, sat at the tavern)
//     say sweet things, now and then a ♥ over one of them (sparingly);
//     flowers brought from the market are given; a pair who quarrelled
//     lately have words instead;
//   - the heartbroken sigh at the well;
//   - on a wedding day (the town's annals: a 'wed' today), in the daytime
//     hours, the couple walk to the church door (or the square) with their
//     kin and neighbours about them and the priest; with a church in town
//     they all go in for the service (the couple before the altar, the guests
//     in the pews, the priest's prayers and the vows: world/innerMap/
//     townScenes.js _sceneWedding, when the player is in there to see it),
//     then come out to the door: the guests cheer, the couple are happy,
//     then all go back to their day.
//
// Lines by temper and station: data/romance.json → lines. Barks go on
// npc._bark (drawn by ui/innerMapReactions.js). Picks are hashes of the
// clock and the people, never the shared RNG.

import { InnerMap } from '../world/innerMap.js';
import { Romance } from '../systems/romance.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownWorship } from '../systems/townWorship.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export const InnerMapCourting = {
    _tiles: null,
    _clock: 0,
    _tick: 0,
    _n: 0,
    // court id / npc id → clock time of the next line they may say
    _next: new Map(),
    // weddings staged on this map: key → { until, couple: [npc], guests: [npc], cheer }
    _weddings: new Map(),
    _done: new Set(),

    _town() {
        const ref = InnerMap._currentWorldTileRef;
        return ref && ref.settlement && ref.settlement.folk ? ref.settlement : null;
    },

    _reset() {
        this._tiles = InnerMap.tiles;
        this._next.clear();
        for (const w of this._weddings.values()) this._release(w);
        this._weddings.clear();
    },

    _roll(...parts) { return _frac(`${parts.join('|')}|${this._n++}|${Math.floor(this._clock * 10)}`); },

    _bark(npc, text, delay = 0, secs = 3.4) {
        if (!npc || !text) return;
        const now = _now();
        npc._bark = { text, until: now + delay * 1000 + secs * 1000, from: now + delay * 1000 };
    },

    _nearPlayer(npc, radius) {
        return _dist(npc, { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR }) <= radius;
    },

    _visible(npc) {
        if (!npc || npc.state === 'gone' || npc._dialogFrozen || npc._fight) return false;
        if (npc.state === 'inside_building') return !!InnerMap._insideBuilding;
        return !InnerMap._insideBuilding;
    },

    _ready(key, cfg) {
        const at = this._next.get(key);
        if (at != null && this._clock < at) return false;
        const [lo, hi] = Array.isArray(cfg.barkCooldown) ? cfg.barkCooldown : [18, 34];
        this._next.set(key, this._clock + lo + this._roll(key, 'cd') * (hi - lo));
        return true;
    },

    update(dt, game) {
        if (!InnerMap.active || !game || !game.world) return;
        if (this._tiles !== InnerMap.tiles) this._reset();
        const s = this._town();
        if (!s) return;
        this._clock += dt;
        this._runWeddings(game, s);
        this._tick -= dt;
        if (this._tick > 0) return;
        const M = Romance.config().onMap || {};
        const [lo, hi] = Array.isArray(M.scanEvery) ? M.scanEvery : [1.5, 3];
        this._tick = lo + this._roll('scan') * (hi - lo);
        const folk = s.folk;
        if (!folk.romance) return;
        const day = _num(game.world.day, 1);
        const byPid = new Map();
        for (const n of InnerMap.npcs || []) if (n._person && n._folk === folk && n.state !== 'gone') byPid.set(n._person.id, n);
        const radius = _num(M.playerRadius, 22);
        this._maybeWedding(game, s, folk, day, byPid, M);
        const busy = n => (n._bark && n._bark.until > _now()) || n._wedding;

        for (const c of folk.romance.list || []) {
            if (c.affair) continue;
            const a = byPid.get(c.a);
            const b = byPid.get(c.b);
            if (!a || !b || !this._visible(a) || !this._visible(b) || busy(a) || busy(b)) continue;
            if (!this._nearPlayer(a, radius)) continue;
            const idx = Romance.stageIndex(c.st);
            const d = _dist(a, b);
            if (a.state === 'inside_building' && (a._insideBuildingQ !== b._insideBuildingQ || a._insideBuildingR !== b._insideBuildingR)) continue;
            // Flowers given
            const giver = a._courtGift === 'give' && d <= 1 ? a : b._courtGift === 'give' && d <= 1 ? b : null;
            if (giver) {
                const taker = giver === a ? b : a;
                giver._courtGift = null;
                this._bark(giver, Romance.line('gift', giver._person, { name: taker._person.first }, `${c.id}|${day}|g`, giver.age));
                this._bark(taker, Romance.line('giftReply', taker._person, { name: giver._person.first }, `${c.id}|${day}|gr`, taker.age), 2.6);
                this._heartLater(taker, 5.6);
                continue;
            }
            if (idx === 1 && d <= _num(M.flirtRadius, 2) && this._ready(`c${c.id}`, M)) {
                // Flirting as they pass: a line and a blush
                const [x, y] = this._roll(c.id, 'who') < 0.5 ? [a, b] : [b, a];
                this._bark(x, Romance.line('flirt', x._person, { name: y._person.first }, `${c.id}|${day}|${this._n}|f`, x.age));
                this._bark(y, Romance.line('flirtReply', y._person, { name: x._person.first }, `${c.id}|${day}|${this._n}|fr`, y.age), 2.6);
                continue;
            }
            if (idx >= 2 && d <= 1 && a.state !== 'walking' && b.state !== 'walking' && this._ready(`c${c.id}`, M)) {
                const [x, y] = this._roll(c.id, 'who') < 0.5 ? [a, b] : [b, a];
                const quarrel = c.quarrel != null && day - c.quarrel <= _num((Romance.config().quarrel || {}).days, 3);
                const key = quarrel ? 'quarrel' : 'sweet';
                this._bark(x, Romance.line(key, x._person, { name: y._person.first }, `${c.id}|${day}|${this._n}|s`, x.age));
                this._bark(y, Romance.line(`${key}Reply`, y._person, { name: x._person.first }, `${c.id}|${day}|${this._n}|sr`, y.age), 2.6);
                if (!quarrel && this._roll(c.id, 'heart') < _num(M.heartChance, 0.3)) this._heartLater(this._roll(c.id, 'hw') < 0.5 ? x : y, 5.6);
                // (in each other's company the evening through)
                for (const n of [a, b]) if (n.state === 'idle') n.idleTimer = Math.max(n.idleTimer || 0, 8);
            }
        }

        // The heartbroken sigh
        for (const n of byPid.values()) {
            if (!n._moping || n.state !== 'idle' || busy(n) || !this._visible(n) || !this._nearPlayer(n, radius)) continue;
            const mood = Romance.mood(folk, n._person, day);
            if (!mood || mood.k !== 'broken') continue;
            if (!this._ready(`m${n.id}`, M)) continue;
            const o = Townsfolk.get(folk, mood.o);
            this._bark(n, Romance.line('mope', n._person, { name: o ? o.first : '' }, `${n.id}|${day}|${this._n}|m`, n.age));
        }
    },

    /** A small ♥ over someone after `delay` seconds. */
    _heartLater(npc, delay) {
        const lines = (Romance.config().lines || {}).heart;
        const t = Array.isArray(lines) && lines.length ? lines[Math.floor(this._roll(npc.id, 'h') * lines.length) % lines.length] : '♥';
        const now = _now();
        npc._bark = { text: t, until: now + (delay + 2.2) * 1000, from: now + delay * 1000 };
    },

    // ──────────── A WEDDING ────────────

    _maybeWedding(game, s, folk, day, byPid, M) {
        const hours = Array.isArray(M.weddingHours) ? M.weddingHours : [9, 17];
        const hour = _num(InnerMap.timeOfDay, 12);
        if (hour < hours[0] || hour >= hours[1] || InnerMap._insideBuilding) return;
        for (const w of Romance.weddingsOn(folk, day)) {
            const key = `${s.q},${s.r}|${day}|${w.a}|${w.b}`;
            if (this._done.has(key) || this._weddings.has(key)) continue;
            const a = byPid.get(w.a);
            const b = byPid.get(w.b);
            if (!a || !b || a.state === 'inside_building' || b.state === 'inside_building' || a._dialogFrozen || b._dialogFrozen) continue;
            this._done.add(key);
            this._stageWedding(game, folk, key, a, b, byPid, M);
        }
    },

    _stageWedding(game, folk, key, a, b, byPid, M) {
        const church = (InnerMap.buildings || []).find(x => x && (x.type === 'church' || x.type === 'temple'));
        const A = InnerMap.townArea && InnerMap.townArea();
        const door = church ? InnerMap._findPassableAdjacentTile(church.q, church.r) : (A && A.center) || { q: a.q, r: a.r };
        // The couple at the door, kin first among the guests, then neighbours
        const kinIds = new Set();
        for (const p of [a._person, b._person]) {
            for (const id of [...(p.parents || []), ...(p.kids || [])]) kinIds.add(id);
            for (const sib of Townsfolk.siblings(folk, p)) kinIds.add(sib.id);
        }
        const free = n => n && n !== a && n !== b && n.state !== 'inside_building' && !n._dialogFrozen && !n._fight && n.type !== 'guard' && !n._behindCounter && !n._wedding && !n._rite;
        const all = [...byPid.values()].filter(free);
        // The priest to marry them (the town's, on the street and free)
        const priest = church ? (InnerMap.npcs || []).find(n => n !== a && n !== b && n.state !== 'inside_building' && !n._dialogFrozen && !n._fight && !n._rite
            && (n.type === 'priest' || (n._person && n._person.job && n._person.job.id === 'priest'))) || null : null;
        const kin = all.filter(n => kinIds.has(n._person.id));
        const rest = all.filter(n => !kinIds.has(n._person.id)).sort((x, y) => _dist(x, door) - _dist(y, door));
        const guests = [...kin, ...rest].filter(n => n !== priest).slice(0, Math.max(0, _num(M.weddingGuests, 8)));
        const spots = this._ring(door, guests.length + 3);
        const place = (n, spot, role) => {
            if (!spot) return;
            if (InnerMap._sceneClear) InnerMap._sceneClear(n);
            n._wedding = key;
            n._weddingRole = role;
            n._rite = key;
            n._activity = null;
            n.path = null;
            n.state = 'idle';
            InnerMap._goStand(n, spot, 'wedding');
        };
        place(a, spots[0], 'couple');
        place(b, spots[1], 'couple');
        guests.forEach((g, i) => place(g, spots[i + 2], 'guest'));
        if (priest) place(priest, spots[guests.length + 2], 'priest');
        // With a church: gathered at the door, then in for the service, then out to cheers
        const svc = church ? _num(M.weddingService, 45) : 0;
        const gather = church ? _num(M.weddingGather, 10) : 0;
        const w = {
            until: this._clock + gather + svc + _num(M.weddingSeconds, 40), couple: [a, b], guests, priest, church, door,
            phase: church ? 'gather' : 'out', inAt: this._clock + gather, outAt: this._clock + gather + svc, svc,
            cheer: this._clock + gather + svc + 6,
        };
        this._weddings.set(key, w);
        if (game.ui && game.ui.showNotification && this._nearPlayer(a, 40)) {
            game.ui.showNotification('💒 A wedding', `${Townsfolk.name(a._person)} and ${Townsfolk.name(b._person)} are wed today${church ? ' — the town walks them to the church' : ''}.`, 'info');
        }
    },

    /** Free spots round a point, nearest first: [{ q, r }] */
    _ring(at, n) {
        const out = [];
        const seen = new Set();
        for (let rad = 0; rad <= 4 && out.length < n; rad++) {
            for (let dq = -rad; dq <= rad; dq++) {
                for (let dr = -rad; dr <= rad; dr++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const q = at.q + dq;
                    const r = at.r + dr;
                    const t = InnerMap.tiles && InnerMap.tiles[r] && InnerMap.tiles[r][q];
                    if (!t || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.isWater || seen.has(`${q},${r}`)) continue;
                    seen.add(`${q},${r}`);
                    out.push({ q, r });
                }
            }
        }
        return out;
    },

    _runWeddings(game, s) {
        for (const [key, w] of this._weddings) {
            // (the player in the church with them: the scene plays it; the street waits till they're out)
            const ib = InnerMap._insideBuilding;
            if (ib && w.church && ib.q === w.church.q && ib.r === w.church.r) {
                w.until = Math.max(w.until, this._clock + 20);
                w.outAt = Math.max(w.outAt || 0, this._clock + 2);
                continue;
            }
            if (this._clock >= w.until) { this._release(w); this._weddings.delete(key); continue; }
            if (w.phase === 'gather' && this._clock >= w.inAt) { this._goIn(game, key, w); continue; }
            if (w.phase === 'service' && this._clock >= w.outAt) { this._comeOut(game, key, w); continue; }
            if (w.phase === 'service' || w.phase === 'gather' || this._clock < w.cheer) continue;
            w.cheer = this._clock + 4 + this._roll(key, 'cheer') * 4;
            const here = [...w.guests].filter(g => g.state === 'idle' && _dist(g, w.door) <= 6 && !(g._bark && g._bark.until > _now()));
            if (here.length) {
                const g = here[Math.floor(this._roll(key, 'g') * here.length) % here.length];
                this._bark(g, Romance.line('weddingGuest', g._person, {}, `${key}|${this._n}`));
            }
            const [a, b] = w.couple;
            if (a.state === 'idle' && b.state === 'idle' && _dist(a, b) <= 2 && !(a._bark && a._bark.until > _now())) {
                if (this._roll(key, 'c') < 0.5) {
                    this._bark(a, Romance.line('weddingCouple', a._person, { name: b._person.first }, `${key}|${this._n}|c`));
                    this._heartLater(b, 2.8);
                } else {
                    this._heartLater(a, 0);
                }
            }
        }
    },

    /** The wedding party into the church for the service. */
    _goIn(game, key, w) {
        w.phase = 'service';
        if (InnerMap._insideBuilding) return;
        for (const n of [...w.couple, ...w.guests, w.priest]) {
            if (!n || n.state === 'gone' || n._fight || n._dialogFrozen || n.state === 'inside_building') continue;
            // (the priest the longest, the couple the shortest: they walk out first)
            const secs = w.svc + (n === w.priest ? 4 : w.couple.includes(n) ? 0 : 2);
            if (InnerMap._sceneGoInto) InnerMap._sceneGoInto(n, w.church, 'church', secs);
        }
        if (game.ui && game.ui.showNotification && this._nearPlayer(w.door, 40)) {
            const [a, b] = w.couple;
            game.ui.showNotification('💒 The wedding service', `${Townsfolk.name(a._person)} and ${Townsfolk.name(b._person)} go into the church to be wed.`, 'info');
        }
    },

    /** Out of the church, wed: to the door, the guests round the couple, the priest's blessing. */
    _comeOut(game, key, w) {
        w.phase = 'out';
        w.cheer = this._clock + 2;
        w.until = Math.max(w.until, this._clock + 20);
        const all = [...w.couple, ...w.guests, w.priest].filter(Boolean);
        const spots = this._ring(w.door, all.length + 1);
        all.forEach((n, i) => {
            if (n.state === 'gone' || n._fight || n._dialogFrozen) return;
            if (n.state === 'inside_building' && n._insideBuildingQ === w.church.q && n._insideBuildingR === w.church.r) {
                // (out of the door now, if the service ran on)
                n.state = 'idle';
                n.currentBuilding = null;
                n._insideBuildingQ = undefined;
                n._insideBuildingR = undefined;
                if (n._outsideQ != null) { n.q = n.prevQ = n._outsideQ; n.r = n.prevR = n._outsideR; }
                n._outsideQ = undefined;
                n._outsideR = undefined;
            }
            if (spots[i] && n.state !== 'inside_building') InnerMap._goStand(n, spots[i], 'wedding');
        });
        if (w.priest) this._bark(w.priest, this._worshipLine('weddingBlessing', key) || 'Go out wed, and be happy!', 0.5, 3.6);
        const [a, b] = w.couple;
        if (game.ui && game.ui.showNotification && this._nearPlayer(w.door, 40)) {
            game.ui.showNotification('💍 Wed', `${Townsfolk.name(a._person)} and ${Townsfolk.name(b._person)} come out of the church wed, and the town cheers them.`, 'info');
        }
    },

    /** A line from data/townWorship.json lines[key], by a hash of the wedding. */
    _worshipLine(key, salt) {
        const list = (TownWorship.config().lines || {})[key];
        return Array.isArray(list) && list.length ? list[Math.floor(this._roll(salt, key) * list.length) % list.length] : null;
    },

    _release(w) {
        for (const n of [...w.couple, ...w.guests, w.priest]) {
            if (!n) continue;
            n._wedding = null;
            n._weddingRole = null;
            n._rite = null;
            if (n.state === 'idle') n.idleTimer = Math.min(n.idleTimer || 0, 2);
        }
    },
};
