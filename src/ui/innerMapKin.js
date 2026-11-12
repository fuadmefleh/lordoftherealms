// ============================================
// INNER MAP KIN — the young and the old on the street map
// ============================================
// The street map's half of systems/townFamily.js and systems/townSchool.js
// (where they go is world/innerMap/townKin.js):
//
//   - children are drawn by their age (npc._scale: a little one of 5 small,
//     a youth of 14 nearly grown); the old (65+) walk slower;
//   - hair greys with age (TownFamily.greyShade: the LPC hair's Gray, Silver,
//     White — a fitted copy of their look, swapped in once composited);
//   - children at play shout, at their chores mutter; truants whisper;
//   - in the schoolroom (the player inside with them) the pupils recite
//     ("A, B, C…", "Amo, amas, amat…") and the teacher keeps order;
//   - the old sit in the sun and tell of the old days, from the town's own
//     annals ("I remember it well. Old Brom died in the winter of 861…");
//   - folk pass on the town's family news: a new babe, someone expecting.
//
// Barks go on npc._bark (drawn by ui/innerMapReactions.js). Picks are hashes
// of the clock and the people, never the shared RNG.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { TownFamily } from '../systems/townFamily.js';
import { TownSchool } from '../systems/townSchool.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { EraWardrobe } from '../world/eraWardrobe.js';

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

const ACTS = {
    rest: { type: 'kin', icon: '☀️', label: 'Sitting in the sun', anim: 'sitting', quiet: true },
    water: { type: 'kin', icon: '💧', label: 'Fetching water', anim: 'idle' },
    hens: { type: 'kin', icon: '🐔', label: 'Feeding the hens', anim: 'idle' },
};

export const InnerMapKin = {
    _tiles: null,
    _clock: 0,
    _tick: 0,
    _n: 0,
    _next: new Map(),
    _told: new Set(),
    _aged: new Map(), // npc id → { id, shade } (a greyed look being composited)
    // christenings gathered at the church on this map: key → { until, people, priest, cheer }
    _rites: new Map(),
    _riteDone: new Set(),

    _town() {
        const ref = InnerMap._currentWorldTileRef;
        return ref && ref.settlement && ref.settlement.folk ? ref.settlement : null;
    },

    _roll(...parts) { return _frac(`${parts.join('|')}|${this._n++}|${Math.floor(this._clock * 10)}`); },

    _bark(npc, text, delay = 0, secs = 3.4) {
        if (!npc || !text) return;
        const now = _now();
        npc._bark = { text, until: now + (delay + secs) * 1000, from: now + delay * 1000 };
    },

    _ready(key, M) {
        const at = this._next.get(key);
        if (at != null && this._clock < at) return false;
        const [lo, hi] = Array.isArray(M.barkCooldown) ? M.barkCooldown : [20, 40];
        this._next.set(key, this._clock + lo + this._roll(key) * (hi - lo));
        return true;
    },

    /** How big to draw a person of this age (data onMap.scale), or null for the grown. */
    scaleFor(age) {
        const S = (TownFamily.config().onMap || {}).scale;
        const band = Array.isArray(S) ? S.find(b => age < _num(b.under, 16)) : null;
        return band ? _num(band.s, 0.7) : null;
    },

    /** The look `base` with its hair (and beard) in `shade`: an id to draw, registered once. */
    agedPreset(base, shade) {
        if (!base || !shade || String(base).startsWith('player:') || String(base).startsWith('aged:')) return null;
        // An era's fitting of a look (InnerMapCharacters._eraPreset: "era:<era>:<base>#<v>") is fitted
        // afresh to the current era from its plain preset, so the old wear their era's clothes too
        const m = /^era:([^:]+):(.+)#(\d+)$/.exec(String(base));
        const plain = m ? m[2] : base;
        const pre = InnerMapCharacters._presets && InnerMapCharacters._presets[plain];
        if (!pre || !Array.isArray(pre.layers) || !pre.layers.some(l => l.startsWith('Hair/'))) return null;
        const era = m && InnerMapCharacters.eraId ? InnerMapCharacters.eraId() : null;
        const id = era ? `aged:${shade}:${era}#${m[3]}:${plain}` : `aged:${shade}:${plain}`;
        if (!InnerMapCharacters._presets[id]) {
            const fitted = era && InnerMapCharacters.eraLayers ? InnerMapCharacters.eraLayers(pre.layers, `${plain}#${m[3]}`) : pre.layers;
            // (eyebrows too: they whiten with the rest)
            const layers = fitted.map(l => (l.startsWith('Hair/') ? l.split('/').slice(0, -1).concat(shade).join('/') : l));
            InnerMapCharacters.registerPreset(id, layers);
        }
        return id;
    },

    update(dt, game) {
        if (!InnerMap.active || !game || !game.world) return;
        // (the school's hashed rolls want the world: world/innerMap/townKin.js reads it)
        InnerMap._kinWorld = game.world;
        if (this._tiles !== InnerMap.tiles) { this._tiles = InnerMap.tiles; this._next.clear(); this._told.clear(); this._aged.clear(); for (const w of this._rites.values()) this._release(w); this._rites.clear(); }
        // (children spawned without a townsfolk record — a village's, a camp's — in a child look too)
        this._dressStrays();
        const s = this._town();
        if (!s) return;
        this._clock += dt;
        this._runRites();
        this._dressChildren(s.folk);
        this._tick -= dt;
        if (this._tick > 0) return;
        const M = TownFamily.config().onMap || {};
        const [lo, hi] = Array.isArray(M.scanEvery) ? M.scanEvery : [2, 4];
        this._tick = lo + this._roll('scan') * (hi - lo);
        const folk = s.folk;
        const world = game.world;
        const day = _num(world.day, 1);
        const player = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const radius = _num(M.playerRadius, 18);
        const busy = n => n._bark && n._bark.until > _now();
        const ready = InnerMapCharacters.isReady && InnerMapCharacters.isReady();
        let barks = 0;
        this._maybeChristening(world, folk, day);

        for (const npc of InnerMap.npcs || []) {
            const p = npc._person;
            if (!p || npc._folk !== folk || npc.state === 'gone') continue;
            const age = _num(npc.age, 30);
            // Drawn by their age; the old walk slower
            const sc = npc.type === 'child' ? (this._dressChild(npc, age, folk) || this.scaleFor(age)) : null;
            if (sc) npc._scale = sc; else if (npc._scale) delete npc._scale;
            if (age >= _num(M.elderAge, 65) && !npc._slowed && npc.speed) { npc.speed *= _num(M.elderSlow, 0.75); npc._slowed = true; }
            // Grey hair
            if (ready) this._grey(npc, world, folk, day);
            // What they're about, shown when they've got there
            this._activity(npc);

            if (barks >= 2 || busy(npc) || npc._dialogFrozen || _dist(npc, player) > radius) continue;
            const inside = npc.state === 'inside_building';
            if (inside !== !!InnerMap._insideBuilding) continue;
            const said = this._say(npc, world, folk, day, M);
            if (said) barks++;
        }
    },

    // ──────────── A CHRISTENING ────────────

    /** A christening today (TownFamily.christeningsOn): parents, godparents and the priest gather at the church door. */
    _maybeChristening(world, folk, day) {
        const hour = _num(InnerMap.timeOfDay, 12);
        if (hour < 9 || hour >= 16 || InnerMap._insideBuilding) return;
        for (const ch of TownFamily.christeningsOn(folk, day)) {
            const key = `${folk.q},${folk.r}|${day}|${ch.child.id}`;
            if (this._riteDone.has(key)) continue;
            this._riteDone.add(key);
            const byPid = new Map((InnerMap.npcs || []).filter(n => n._person && n._folk === folk && n.state !== 'gone').map(n => [n._person.id, n]));
            const free = n => n && n.state !== 'inside_building' && !n._dialogFrozen && !n._fight && !n._wedding && !n._behindCounter;
            const priestP = Townsfolk.residents(folk).find(p => p.role === 'priest' || (p.job && p.job.id === 'priest'));
            const priest = priestP ? byPid.get(priestP.id) : null;
            const people = [...ch.parents, ...ch.godparents].map(p => byPid.get(p.id)).filter(free);
            if (!people.length) continue;
            const church = (InnerMap.buildings || []).find(b => b && (b.type === 'church' || b.type === 'chapel' || b.type === 'temple'));
            const A = InnerMap.townArea && InnerMap.townArea();
            const door = church ? InnerMap._findPassableAdjacentTile(church.q, church.r) : (A && A.center);
            if (!door) continue;
            const all = free(priest) ? [priest, ...people] : people;
            const spots = this._ring(door, all.length);
            all.forEach((n, i) => {
                if (!spots[i]) return;
                if (InnerMap._sceneClear) InnerMap._sceneClear(n);
                n._wedding = key;
                n._activity = null; n.path = null; n.state = 'idle';
                InnerMap._goStand(n, spots[i], 'wedding');
            });
            this._rites.set(key, { until: this._clock + 30, people: all, priest: free(priest) ? priest : null, cheer: this._clock + 6, door, child: ch.child });
        }
    },

    _ring(at, n) {
        const out = [];
        for (let rad = 0; rad <= 3 && out.length < n; rad++) {
            for (let dq = -rad; dq <= rad; dq++) {
                for (let dr = -rad; dr <= rad; dr++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const t = InnerMap.tiles && InnerMap.tiles[at.r + dr] && InnerMap.tiles[at.r + dr][at.q + dq];
                    if (t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.isWater) out.push({ q: at.q + dq, r: at.r + dr });
                }
            }
        }
        return out;
    },

    _runRites() {
        for (const [key, w] of this._rites) {
            if (this._clock >= w.until) { this._release(w); this._rites.delete(key); continue; }
            if (this._clock < w.cheer) continue;
            w.cheer = this._clock + 5;
            const who = w.priest && this._roll(key, 'p') < 0.5 ? w.priest : w.people[Math.floor(this._roll(key, 'g') * w.people.length) % w.people.length];
            if (!who || who.state !== 'idle' || (who._bark && who._bark.until > _now())) continue;
            this._bark(who, TownFamily.line(who === w.priest ? 'christeningPriest' : 'christeningGuest', who._person, { name: w.child.first }, `${key}|${this._n}`), 0, 4);
        }
    },

    _release(w) {
        for (const n of w.people || []) { if (n) { n._wedding = null; if (n.state === 'idle') n.idleTimer = Math.min(n.idleTimer || 0, 2); } }
    },

    // ──────────── CHILDREN'S OWN SPRITES ────────────

    /** Every child of this town on the map in its child look, from the first frame it is drawn. */
    _dressChildren(folk) {
        let byId = null;
        for (const npc of InnerMap.npcs || []) {
            if (!npc._person || npc._folk !== folk || npc.state === 'gone') continue;
            const kid = npc.type === 'child' && InnerMapCharacters.isChildAge && InnerMapCharacters.isChildAge(_num(npc.age, 30));
            if (!kid && !npc._childLook && !String(npc.preset || '').startsWith('child:')) continue;
            if (kid && !npc._childLook) byId = byId || new Map((InnerMap.npcs || []).map(n => [n.id, n]));
            const sc = this._dressChild(npc, _num(npc.age, 30), folk, byId);
            if (sc) npc._scale = sc;
        }
    },

    /**
     * A child under the child sprites' age (InnerMapCharacters.childLooks) wears the LPC child look —
     * skin and hair from a parent on the map, clothes by the family's means — at its natural size by
     * age. → that scale once the look is drawn, else null (the old shrunken look meanwhile). One grown
     * past it goes back to a grown look.
     */
    _dressChild(npc, age, folk, byId = null) {
        const IMC = InnerMapCharacters;
        if (!IMC.childLook || npc.type !== 'child' || !IMC.isChildAge(age)) {
            if (String(npc.preset || '').startsWith('child:')) npc.preset = IMC.getPresetForNPC(npc.type, npc.id, npc.gender);
            if (npc._childLook) npc._childLook = null;
            return null;
        }
        // (dressed for the era it was made in: a new era dresses the child afresh — childLooks.eraWardrobe)
        if (npc._childLook && IMC.eraId && npc._childLookEra !== IMC.eraId()) npc._childLook = null;
        if (!npc._childLook) {
            npc._childLookEra = IMC.eraId ? IMC.eraId() : null;
            const p = npc._person;
            const map = byId || new Map((InnerMap.npcs || []).map(n => [n.id, n]));
            const parents = (npc.parentIds || []).map(id => map.get(id)).filter(Boolean)
                .map(n => n.preset || IMC.getPresetForNPC(n.type, n.id, n.gender)).filter(Boolean);
            const kin = p && folk ? (p.parents || []).map(id => Townsfolk.get(folk, id)).filter(Boolean) : [];
            const roles = kin.map(k => k.retired || k.role);
            const family = p && p.hh != null ? `hh${p.hh}` : p && (p.parents || []).length ? `of${p.parents.join(',')}` : null;
            const town = folk ? `${folk.q},${folk.r}` : '';
            const look = IMC.childLook({ seed: npc.uid || `${town}#${npc.id}`, gender: npc.gender, parents, family: family && `${town}|${family}`, roles });
            npc._childLook = IMC.childPresetId(look);
        }
        let id = npc._childLook;
        // (a pupil on a school day wears its satchel, once that look is drawn: no flash meanwhile)
        if (folk && npc._person && IMC.childWithSatchel && this.satchelOn(npc, folk)) {
            const bagId = IMC.childWithSatchel(id);
            if (IMC.getComposited(bagId)) id = bagId;
            else IMC.ensureChild(bagId);
        }
        if (IMC.getComposited(id)) {
            npc.preset = id;
            return IMC.childScale(age);
        }
        IMC.ensureChild(id);
        return null;
    },

    /** Is this child carrying its school satchel now (systems/townSchool.js carriesSatchel)? Asked once an hour. */
    satchelOn(npc, folk) {
        const day = _num(InnerMap.worldDay, 1), hour = Math.floor(_num(InnerMap.timeOfDay, 12));
        const key = `${day}|${hour}`;
        if (npc._satchelKey !== key) {
            npc._satchelKey = key;
            const settlement = InnerMap._currentWorldTileRef ? InnerMap._currentWorldTileRef.settlement : null;
            npc._satchel = !!TownSchool.carriesSatchel(InnerMap._kinWorld || null, settlement, folk, npc._person, day, hour);
        }
        return npc._satchel;
    },

    /**
     * A child on the map with no townsfolk record (spawned by type alone): the child look too, its
     * age its own (else a hash of who it is, 5–11), skin and hair from any parents on the map.
     */
    _dressStrays() {
        const IMC = InnerMapCharacters;
        if (!IMC.childLook || !IMC.isChildAge) return;
        let byId = null;
        for (const npc of InnerMap.npcs || []) {
            if (npc.type !== 'child' || npc._person || npc.state === 'gone') continue;
            if (!Number.isFinite(npc.age)) npc.age = 5 + (EraWardrobe._hash(`stray|${npc.uid || npc.id}`) % 7);
            if (!npc._childLook) byId = byId || new Map((InnerMap.npcs || []).map(n => [n.id, n]));
            const sc = this._dressChild(npc, npc.age, null, byId);
            if (sc) npc._scale = sc;
        }
    },

    _grey(npc, world, folk, day) {
        const shade = TownFamily.greyShade(world, folk, npc._person, day);
        if (!shade) return;
        if (!npc.preset) npc.preset = InnerMapCharacters.getPresetForNPC(npc.type, npc.id, npc.gender);
        const cur = String(npc.preset || '');
        if (cur.startsWith('player:')) return;
        // (their look as the current era would dress it — refitted when the era turns)
        const base = InnerMapCharacters.getPresetForNPC(npc.type, npc.id, npc.gender) || cur;
        const want = this.agedPreset(base, shade);
        if (!want || cur === want) return;
        const pend = this._aged.get(npc.id);
        const id = pend && pend.id === want ? pend.id : want;
        if (!id) return;
        this._aged.set(npc.id, { id, shade });
        if (InnerMapCharacters.getComposited(id)) { npc.preset = id; this._aged.delete(npc.id); }
    },

    _activity(npc) {
        const mine = npc.activity && npc.activity.type === 'kin';
        if (npc.state !== 'idle') { if (mine) npc.activity = null; return; }
        const want = npc._resting ? ACTS.rest : npc._chore ? ACTS[npc._chore] : null;
        if (want && !npc.activity) npc.activity = { ...want };
        else if (!want && mine) npc.activity = null;
        if (!npc._resting && !npc._chore && npc._pose != null && mine) npc._pose = null;
    },

    /** One line from this person, if they've something to say. → true when they spoke */
    _say(npc, world, folk, day, M) {
        const p = npc._person;
        const key = `${npc.id}`;
        // In the schoolroom with the player: lessons
        if (npc.state === 'inside_building' && InnerMap._insideBuilding) {
            if (npc._teaching && this._ready(key, M)) { this._bark(npc, TownSchool.line('teacher', `${day}|${this._n}|${npc.id}`)); return true; }
            if (npc._pupil && npc._pupil !== 'tutor' && this._ready(key, M)) {
                this._bark(npc, TownSchool.line(npc._pupil === 'grammar' ? 'grammar' : 'parish', `${day}|${this._n}|${npc.id}`));
                return true;
            }
            return false;
        }
        if (npc.type === 'child') {
            if (!this._ready(key, M)) return false;
            const k = npc._truant ? 'truant' : npc._chore && npc.state === 'idle' ? 'chore' : 'play';
            const t = k === 'truant' ? TownSchool.line('truant', `${day}|${npc.id}|${this._n}`) : TownFamily.line(k, p, {}, `${day}|${npc.id}|${this._n}`);
            this._bark(npc, t);
            return !!t;
        }
        // The old in the sun: the old days, from the town's own annals
        if (npc._resting && npc.state === 'idle' && this._ready(key, M)) {
            const story = this._roll(key, 'story') < _num(M.storyChance, 0.5) ? TownFamily.elderStory(folk, p, world, `${day}|${this._n}`) : null;
            this._bark(npc, story || TownFamily.line('elder', p, {}, `${day}|${npc.id}|${this._n}`), 0, story ? 6 : 3.4);
            return true;
        }
        // Grown folk pass on a new babe or a woman expecting, once each per visit
        if (npc.state === 'idle' && this._roll(key, 'news') < 0.15) {
            const news = TownFamily.familyNews(folk, world, _num(M.newsDays, 30)).filter(t => !this._told.has(t));
            if (news.length && this._ready(key, M)) {
                const t = news[0];
                this._told.add(t);
                this._bark(npc, t, 0, 4.5);
                return true;
            }
        }
        return false;
    },
};
