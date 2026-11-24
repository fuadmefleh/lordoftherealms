// InnerMap — below decks: the rooms under your ship's deck, and the hands in them.
//
// Entered as a building (interiors.js enterBuilding) whose `_shipBelow` carries
// the plan and the hold's stowage worked out by the rules (systems/belowDecks.js,
// handed in by ui/innerMapBelowDecks.js): this lays them as tiles — plank
// bulkheads, a doorway between each room at the aisle, hammocks, the galley
// stove and mess table, the cargo in its crates, barrels and sacks, the
// cabin's cot and chart table, lanterns and the ladder up to the hatch — and
// puts the hands below where they are at the hour: asleep in their hammocks,
// at mess, at the stove, at the charts, at the sick. Leaving (the ladder, the
// Leave button, Esc) is exitBuilding, back onto the deck by the hatch.
//
// Geometry and walking only; who is below and doing what is the rules'.

import { InnerMap } from './_ref.js';
import { Utils } from './_imports.js';

const _key = (q, r) => `${q},${r}`;
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const CREW_ID_BASE = 70000;

/** A fresh floor or wall subTerrain (each tile its own: some code writes into them). */
function _floor() { return { id: 'wood_floor', name: 'Deck Planking', icon: '🌲', color: '#7a5e40', passable: true }; }
function _wall() { return { id: 'wall', name: 'Bulkhead', icon: '🧱', color: '#4a3524', passable: false }; }

Object.assign(InnerMap, {
    /** Is the player below decks on their ship? */
    inBelowDecks() {
        return !!(this._insideBuilding && this._insideBuilding._shipBelow);
    },

    /**
     * The interior below decks (interiors.js _generateInterior hands it here):
     * the plan's walls, rooms and furniture, the hold's stowage laid in it.
     */
    _generateBelowDecks(building) {
        const B = building._shipBelow || {};
        const plan = B.plan;
        if (!plan) return null;
        const { w, h } = plan;
        const roomOf = (q) => {
            const rm = plan.rooms.find(x => q >= x.q0 && q <= x.q1);
            return rm ? rm.id : null;
        };
        const tiles = [];
        for (let r = 0; r < h; r++) {
            const row = [];
            for (let q = 0; q < w; q++) {
                const c = plan.cells[r][q];
                const wall = c === 'W';
                row.push({
                    q, r,
                    baseTerrain: wall ? 'wall' : 'wood_floor',
                    subTerrain: wall ? _wall() : _floor(),
                    explored: true, visible: true, parentTerrain: 'interior',
                    encounter: null, building: null,
                    _isInterior: true, _interiorBuildingType: building.type,
                    _wallMaterial: 'planks',
                    _furniture: null,
                    _belowRoom: wall ? null : roomOf(q),
                    ...(c === 'D' ? { _doorway: true } : {}),
                    effectiveTemp: 16, moisture: 0.5, weatherType: 'clear',
                });
            }
            tiles.push(row);
        }
        const lay = (f) => {
            const t = tiles[f.r] && tiles[f.r][f.q];
            if (!t || t.baseTerrain === 'wall') return;
            t._furniture = { type: f.type, name: f.name, icon: f.icon || '📦', passable: !!f.passable };
            if (f.art) t._furniture.art = f.art;
            if (f.lit != null) t._furniture.lit = f.lit;
            if (f.decor) t._decor = f.decor.slice();
            if (f.decorLit) t._decorLit = true;
            if (f._water) t._water = true;
            if (f.good) { t._cargo = { good: f.good, kind: f.kind, units: f.units }; t._furniture.noJoin = true; }
            if (f.type === 'ladder') t._ladder = true;
            if (!f.passable) {
                t.subTerrain = { id: `furniture_${f.type}`, name: f.name, icon: f.icon || '📦', color: (this.FURNITURE_COLORS || {})[f.type] || '#6a5a4a', passable: false };
            }
        };
        for (const f of plan.furniture || []) lay(f);
        for (const s of B.stowage || []) lay({ ...s, icon: s.kind === 'barrel' ? '🛢️' : s.kind === 'sack' ? '🌾' : '📦' });
        for (const d of plan.wallDecor || []) {
            const t = tiles[d.r] && tiles[d.r][d.q];
            if (!t) continue;
            t._wallDecor = d.id;
            // (the lanterns burn day and night down here: ui/interiorLight.js)
            if (d.lit) t._decorLit = true;
        }
        const ladder = plan.ladder;
        // A cot and the tables at their own size, where there's room (interiors.js)
        if (this._joinPieces) this._joinPieces(tiles, w, h, { q: ladder.q, r: ladder.r + 1 });
        return { tiles, width: w, height: h, door: { q: ladder.q, r: ladder.r + 1 }, _below: true };
    },

    /** The ladder's tile below decks, or null. */
    belowLadder() {
        if (!this.inBelowDecks() || !this.tiles) return null;
        for (const row of this.tiles) for (const t of row) if (t && t._ladder) return { q: t.q, r: t.r };
        return null;
    },

    /** The foot of the ladder (where you come down, and where hands come and go). */
    belowLanding() {
        const l = this.belowLadder();
        return l ? { q: l.q, r: l.r + 1 } : null;
    },

    /** Walkable cells of a room below (not the ladder, not a doorway). */
    _belowCells(room) {
        const out = [];
        for (const row of this.tiles || []) {
            for (const t of row) {
                if (!t || t._belowRoom !== room || t._ladder || t._doorway || !t.subTerrain || !t.subTerrain.passable) continue;
                out.push({ q: t.q, r: t.r });
            }
        }
        return out;
    },

    /** A free cell of a room, beside `near` where given; never where someone stands. */
    _belowSpot(room, { near = null, salt = 0, self = null, type = null } = {}) {
        const busy = new Set();
        for (const n of this.npcs || []) {
            if (n === self) continue;
            busy.add(_key(n.q, n.r));
            if (n._asleep) busy.add(_key(n._asleep.q, n._asleep.r));
            if (n.path && n.path.length) { const e = n.path[n.path.length - 1]; busy.add(_key(e.q, e.r)); }
        }
        busy.add(_key(this.playerInnerQ, this.playerInnerR));
        let cells = this._belowCells(room).filter(c => !busy.has(_key(c.q, c.r)));
        if (type) {
            const typed = cells.filter(c => { const t = this.tiles[c.r][c.q]; return t._furniture && t._furniture.type === type; });
            if (typed.length) cells = typed;
            else cells = cells.filter(c => !this.tiles[c.r][c.q]._furniture);
        } else cells = cells.filter(c => !this.tiles[c.r][c.q]._furniture);
        if (near) {
            const beside = cells.filter(c => _cheb(c, near) <= 1);
            if (beside.length) cells = beside;
        }
        if (!cells.length) return null;
        return cells[Math.abs(Math.floor(salt)) % cells.length];
    },

    /** Where a hand at a piece of work stands: by the stove, at the mess, at the chart table... */
    _belowPlaceFor(e, salt) {
        const find = (type) => {
            for (const row of this.tiles) for (const t of row) if (t && t._furniture && t._furniture.type === type && t._belowRoom === e.room) return { q: t.q, r: t.r };
            return null;
        };
        switch (e.act) {
            case 'eat': return this._belowSpot(e.room, { type: 'bench', salt }) || this._belowSpot(e.room, { near: find('table'), salt });
            case 'cook': return this._belowSpot(e.room, { near: find('oven') || find('cauldron'), salt });
            case 'charts': return this._belowSpot(e.room, { type: 'chair', salt }) || this._belowSpot(e.room, { near: find('desk'), salt });
            case 'stow': return this._belowSpot(e.room, { salt });
            default: return this._belowSpot(e.room, { salt });
        }
    },

    /** A hand below as a walking person (the same id, look and name as on deck). */
    _belowNpc(e, at) {
        const m = e.member;
        const typeDef = (this.NPC_TYPES && this.NPC_TYPES[m.type]) || { icon: '🧑', speed: 0.5 };
        return {
            id: CREW_ID_BASE + m.slot, type: m.type || 'villager', name: m.name, icon: typeDef.icon, speed: (typeDef.speed || 0.5) * 0.8,
            preset: null, facing: 2,
            q: at.q, r: at.r, targetQ: at.q, targetR: at.r, path: null, pathIndex: 0, moveProgress: 0, prevQ: at.q, prevR: at.r,
            idleTimer: 1 + Utils.random() * 3, state: 'idle', currentBuilding: null,
            destinations: [], visitsLeft: -1, departing: false, shopInventory: null,
            deckRole: m.role, crewSlot: m.slot, roleTitle: m.title, deckMember: m,
            _belowHand: true, belowRoom: e.room, belowAct: e.act,
            belowWork: { label: e.label, icon: e.icon, anim: e.anim || 'idle' },
        };
    },

    /** Lay a hand asleep (or sick) in a free hammock; false when there is none. */
    _belowLayDown(npc, e) {
        const taken = new Set((this.npcs || []).filter(n => n !== npc && n._asleep).map(n => _key(n._asleep.q, n._asleep.r)));
        const free = [];
        for (const row of this.tiles) for (const t of row) if (t && t._furniture && t._furniture.type === 'hammock' && !taken.has(_key(t.q, t.r))) free.push(t);
        if (!free.length) return false;
        const bed = free[npc.crewSlot % free.length];
        npc.q = npc.prevQ = npc.targetQ = bed.q;
        npc.r = npc.prevR = npc.targetR = bed.r;
        npc.path = null;
        npc.moveProgress = 0;
        npc._asleep = { q: bed.q, r: bed.r };
        npc.activity = { type: 'bed', icon: e.icon || '💤', label: e.label || 'asleep', anim: 'idle' };
        npc.facing = 2;
        npc.state = 'idle';
        npc.idleTimer = 60;
        return true;
    },

    /**
     * Put the hands below: [{ member, room, act, asleep, label, icon }]
     * (systems/belowDecks.js BelowDecks.below). Those already here at the
     * same work stay; those no longer below climb the ladder and are gone;
     * newcomers come down it to their place. `instant`: everyone straight to
     * their place (on first coming below). Returns the hands below.
     */
    _belowSync(list, instant = false) {
        if (!this.inBelowDecks()) return [];
        const landing = this.belowLanding() || { q: 1, r: 1 };
        const want = new Map((list || []).map(e => [e.member.slot, e]));
        const keep = [];
        for (const n of this.npcs || []) {
            if (!n._belowHand) { keep.push(n); continue; }
            const e = want.get(n.crewSlot);
            if (e && n.belowAct === e.act && !n._belowLeaving) { want.delete(n.crewSlot); keep.push(n); continue; }
            if (e && !n._belowLeaving) {
                // Same hand, new work: up out of the hammock, over to it
                this._belowRetask(n, e, instant);
                want.delete(n.crewSlot);
                keep.push(n);
                continue;
            }
            if (instant || n._belowLeaving === 'gone') continue;
            // Up the ladder to the deck
            if (!n._belowLeaving) {
                n._belowLeaving = true;
                n._asleep = null;
                n.activity = null;
                const path = this._findPath ? this._findPath(n.q, n.r, landing.q, landing.r) : null;
                if (path && path.length > 1) { n.path = path.slice(1); n.pathIndex = 0; n.moveProgress = 0; n.state = 'walking'; } else continue;
            }
            keep.push(n);
        }
        this.npcs = keep;
        let i = 0;
        for (const e of want.values()) {
            const start = instant ? null : landing;
            const npc = this._belowNpc(e, start || landing);
            this.npcs.push(npc);
            this._belowRetask(npc, e, instant, i++);
        }
        return this.npcs.filter(n => n._belowHand && !n._belowLeaving);
    },

    /** Set a hand below to a piece of work: lie down, or walk (or be put) to its place. */
    _belowRetask(npc, e, instant, salt = 0) {
        npc.belowRoom = e.room;
        npc.belowAct = e.act;
        npc.belowWork = { label: e.label, icon: e.icon, anim: e.anim || 'idle' };
        npc._asleep = null;
        npc.activity = null;
        if (e.asleep) {
            if (instant || !this._findPath) { if (this._belowLayDown(npc, e)) return; }
            else { npc._belowBed = e; }
        }
        const at = this._belowPlaceFor(e, npc.crewSlot + salt) || this.belowLanding();
        if (!at) return;
        if (instant) {
            npc.q = npc.prevQ = at.q;
            npc.r = npc.prevR = at.r;
            npc.path = null;
            npc.state = 'idle';
            npc.idleTimer = 0.2;
            return;
        }
        const path = this._findPath ? this._findPath(npc.q, npc.r, at.q, at.r) : null;
        if (path && path.length > 1) {
            npc.path = path.slice(1);
            npc.pathIndex = 0;
            npc.moveProgress = 0;
            npc.prevQ = npc.q;
            npc.prevR = npc.r;
            npc.state = 'walking';
        } else {
            npc.state = 'idle';
            npc.idleTimer = 0.2;
        }
    },

    /** Hands who have climbed out (at the ladder's foot, leaving): gone up. → how many */
    _belowClearLeavers() {
        const landing = this.belowLanding();
        if (!landing) return 0;
        const before = (this.npcs || []).length;
        this.npcs = (this.npcs || []).filter(n => !(n._belowHand && n._belowLeaving && n.state !== 'walking' && _cheb(n, landing) <= 1));
        return before - this.npcs.length;
    },

    /**
     * A hand's next move below (from _deckDestination → _npcPickDestination):
     * asleep, lie on; bound for a hammock, climb in; at work, keep at it, now
     * and then a step aside and back.
     */
    _belowDestination(npc) {
        if (npc._belowLeaving) { npc.state = 'idle'; npc.idleTimer = 0.3; return; }
        if (npc._asleep) { npc.state = 'idle'; npc.idleTimer = 60; return; }
        if (npc._belowBed) {
            const e = npc._belowBed;
            npc._belowBed = null;
            if (this._belowLayDown(npc, e)) return;
        }
        const w = npc.belowWork || null;
        const settled = ['eat', 'cook', 'charts', 'tend'].includes(npc.belowAct);
        if (!settled && Utils.random() < 0.3) {
            const to = this._belowSpot(npc.belowRoom, { near: npc, salt: Math.floor(Utils.random() * 1000), self: npc });
            const path = to && this._findPath ? this._findPath(npc.q, npc.r, to.q, to.r) : null;
            if (path && path.length > 1 && path.length < 6) {
                npc.path = path.slice(1);
                npc.pathIndex = 0;
                npc.moveProgress = 0;
                npc.prevQ = npc.q;
                npc.prevR = npc.r;
                npc.state = 'walking';
                npc.activity = null;
                return;
            }
        }
        npc.activity = w ? { type: npc.belowAct, icon: w.icon, label: w.label, anim: w.anim } : null;
        npc.state = 'idle';
        npc.idleTimer = 5 + Utils.random() * 8;
        // At mess and at the charts: face the table
        if (npc.belowAct === 'eat' || npc.belowAct === 'charts') {
            const t = this.tiles[npc.r + 1] && this.tiles[npc.r + 1][npc.q];
            npc.facing = t && t._furniture && (t._furniture.type === 'table' || t._furniture.type === 'desk') ? 2 : 0;
        }
    },
});
