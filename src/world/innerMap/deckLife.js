// InnerMap — the deck of your ship at sea, and the people on it.
//
// harbour.js lays the open sea with your ship in the middle and its deck
// walkable (tiles flagged `_deck`). This finds the stations on that deck —
// the helm at the stern, the lookout's place at the bow, the foot of each
// mast, the hatch amidships, the rails — and puts the crew there: who they
// are (the roster), where each goes and what they do there (npc.deckStation,
// npc.deckWork) are decided by the rules (systems/deckLife.js) and set by the
// deck scene (ui/innerMapDeck.js); this only walks them about.
// A pirate hull can be laid alongside for a boarding, and cleared after.
//
// Geometry only; the masts come from the hull's own drawing (data/shipHulls.json).

import { InnerMap } from './_ref.js';
import { CustomObjects, DataLoader, Utils } from './_imports.js';
import { ShipHulls } from '../shipHulls.js';

const CREW_ID_BASE = 70000;
const BOARDER_ID_BASE = 71000;

const _key = (q, r) => `${q},${r}`;
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

/**
 * The masts of a hull (its 'masts' layer): [{ col, top }] — the column each
 * stands on and the row of its head, relative to the hull's anchor.
 */
function _masts(hullId) {
    const g = DataLoader._gamedata;
    const ship = g && g.shipHulls && Array.isArray(g.shipHulls.ships) ? g.shipHulls.ships.find(s => s.id === hullId) : null;
    if (!ship) return [];
    const mastTiles = ship.tiles.filter(t => t.layer === 'masts');
    const cols = [...new Set(mastTiles.map(t => t.col))].sort((a, b) => a - b);
    const groups = [];
    for (const c of cols) {
        const last = groups[groups.length - 1];
        if (last && c - last[last.length - 1] <= 1) last.push(c);
        else groups.push([c]);
    }
    return groups.map(g2 => {
        const col = g2[Math.floor(g2.length / 2)];
        const rows = mastTiles.filter(t => g2.includes(t.col)).map(t => t.row);
        return { col, top: Math.min(...rows) - (ship.waterline || 0) };
    });
}

Object.assign(InnerMap, {
    /** The ship you are aboard on this map: { q, r, def, shipId } or null */
    _aboardShipObject(tiles = this.tiles) {
        if (!tiles) return null;
        for (let r = 0; r < tiles.length; r++) {
            for (let q = 0; q < tiles[r].length; q++) {
                const o = tiles[r][q].customObject;
                if (o && o.aboard) {
                    const def = CustomObjects.getDef(o.defId);
                    return def ? { q, r, def, shipId: o.playerShip || null } : null;
                }
            }
        }
        return null;
    },

    /**
     * Find the stations on the deck and remember them (this._deck). Marks
     * the helm (`_helm`) and the hatch (`_hatch`) tiles. Returns the layout,
     * or null on a map with no deck.
     */
    _deckLayout() {
        const tiles = this.tiles;
        const ship = this._aboardShipObject(tiles);
        if (!ship) { this._deck = null; return null; }
        const cells = [];
        for (const m of ShipHulls.footprint(ship.def)) {
            const q = ship.q + m.localCol, r = ship.r + m.localRow;
            const t = tiles[r] && tiles[r][q];
            if (t && t._deck && t.subTerrain && t.subTerrain.passable) cells.push({ q, r });
        }
        if (!cells.length) { this._deck = null; return null; }
        const minQ = Math.min(...cells.map(c => c.q)), maxQ = Math.max(...cells.map(c => c.q));
        const midRowOf = (list) => {
            const rows = list.map(c => c.r).sort((a, b) => a - b);
            const mid = rows[Math.floor(rows.length / 2)];
            return list.find(c => c.r === mid) || list[0];
        };
        const colCells = (q) => cells.filter(c => c.q === q);
        const nearestCol = (q) => {
            for (let d = 0; d <= maxQ - minQ; d++) {
                if (colCells(q - d).length) return q - d;
                if (colCells(q + d).length) return q + d;
            }
            return minQ;
        };
        // The stern is the high-column end (the LPC ships face west): the helm a step in from it
        const helm = midRowOf(colCells(nearestCol(maxQ - 1)));
        const bow = midRowOf(colCells(nearestCol(minQ + 1)));
        const center = {
            q: Math.round(cells.reduce((a, c) => a + c.q, 0) / cells.length),
            r: Math.round(cells.reduce((a, c) => a + c.r, 0) / cells.length),
        };
        const hatch = cells.reduce((best, c) => (_cheb(c, center) < _cheb(best, center) ? c : best), cells[0]);
        const mastDefs = _masts(ship.def.id);
        const masts = mastDefs.map(m => midRowOf(colCells(nearestCol(ship.q + m.col)))).filter(Boolean);
        // (the mast heads, for what is drawn aloft: St Elmo's fire)
        const mastTops = mastDefs.map(m => ({ q: ship.q + m.col, r: ship.r + m.top }));
        if (!masts.length) masts.push(hatch);
        // The rails: the top and bottom edge of each column of deck
        const railN = [], railS = [];
        for (let q = minQ; q <= maxQ; q++) {
            const col = colCells(q);
            if (!col.length) continue;
            railN.push(col.reduce((a, c) => (c.r < a.r ? c : a), col[0]));
            railS.push(col.reduce((a, c) => (c.r > a.r ? c : a), col[0]));
        }
        const span = maxQ - minQ;
        const near = (pts, rad) => cells.filter(c => pts.some(p => _cheb(c, p) <= rad));
        const not = (list, ...ex) => list.filter(c => !ex.some(e => e && e.q === c.q && e.r === c.r));
        const rails = [...railN, ...railS];
        const stations = {
            helm: [helm],
            quarterdeck: not(cells.filter(c => c.q >= maxQ - Math.max(3, Math.round(span * 0.2))), helm),
            bow: [bow, ...not(near([bow], 1), bow)].slice(0, 3),
            mast: not(near(masts, 1), ...masts),
            hatch: not(near([hatch], 1), hatch),
            pump: not(near([hatch], 2), hatch),
            rail: rails,
            fishing: rails,
            rest: rails.filter(c => c.q > minQ + span * 0.25 && c.q < maxQ - span * 0.25),
            pray: near([masts[Math.floor(masts.length / 2)]], 3),
            wounded: not(near([hatch], 2), hatch),
            deck: cells,
        };
        for (const k of Object.keys(stations)) if (!stations[k].length) stations[k] = cells;
        for (const c of cells) {
            const t = tiles[c.r][c.q];
            t._helm = c.q === helm.q && c.r === helm.r;
            t._hatch = c.q === hatch.q && c.r === hatch.r;
        }
        this._deck = {
            anchor: { q: ship.q, r: ship.r }, defId: ship.def.id, shipId: ship.shipId,
            cells, cellSet: new Set(cells.map(c => _key(c.q, c.r))),
            helm, bow, hatch, masts, mastTops, railN, railS, stations, minQ, maxQ,
            minR: Math.min(...cells.map(c => c.r)), maxR: Math.max(...cells.map(c => c.r)),
            pirate: this._deck && this._deck.pirate && this._deck.anchor && this._deck.anchor.q === ship.q && this._deck.anchor.r === ship.r ? this._deck.pirate : null,
        };
        return this._deck;
    },

    /** Is (q, r) on the deck? */
    isOnDeck(q, r) {
        return !!(this._deck && this._deck.cellSet.has(_key(q, r)));
    },

    /** The cells of a station (falls back to the whole deck). */
    _deckStationCells(station) {
        const L = this._deck;
        if (!L) return [];
        return (L.stations[station] && L.stations[station].length ? L.stations[station] : L.cells);
    },

    /**
     * A free cell of a station: not where someone else stands or is going
     * (or the player). `salt` picks steadily; without it, at random.
     */
    _deckSpot(station, salt = null, self = null) {
        const cells = this._deckStationCells(station);
        if (!cells.length) return null;
        const taken = new Set();
        for (const n of this.npcs || []) {
            if (n === self) continue;
            taken.add(_key(n.q, n.r));
            if (n.path && n.path.length) { const e = n.path[n.path.length - 1]; taken.add(_key(e.q, e.r)); }
        }
        taken.add(_key(this.playerInnerQ, this.playerInnerR));
        const free = cells.filter(c => !taken.has(_key(c.q, c.r)));
        const pool = free.length ? free : cells;
        const i = salt == null ? Math.floor(Utils.random() * pool.length) : Math.abs(salt) % pool.length;
        return pool[i];
    },

    /** A walking person of the deck (crew or boarder) at (q, r). */
    _deckNpc({ id, type = 'villager', name, q, r, speed = 0.5 }) {
        const typeDef = (this.NPC_TYPES && this.NPC_TYPES[type]) || { icon: '🧑', speed };
        return {
            id, type, name, icon: typeDef.icon, speed: typeDef.speed || speed,
            preset: null, facing: 2,
            q, r, targetQ: q, targetR: r, path: null, pathIndex: 0, moveProgress: 0, prevQ: q, prevR: r,
            idleTimer: 0.5 + Utils.random() * 2, state: 'idle', currentBuilding: null,
            destinations: [], visitsLeft: -1, departing: false, shopInventory: null,
        };
    },

    /**
     * Put the crew on deck: one walking person per member of the roster
     * (systems/deckLife.js DeckLife.roster), each at their station. Any crew
     * or boarders from before are taken off first. Returns the crew placed.
     */
    _manDeck(roster) {
        const L = this._deckLayout();
        this.npcs = (this.npcs || []).filter(n => !n.deckRole && !n._boarder);
        if (!L) return [];
        const out = [];
        for (const m of roster || []) {
            const spot = this._deckSpot(m.station, m.slot) || L.hatch;
            const npc = this._deckNpc({ id: CREW_ID_BASE + m.slot, type: m.type, name: m.name, q: spot.q, r: spot.r });
            npc.deckRole = m.role;
            npc.crewSlot = m.slot;
            npc.roleTitle = m.title;
            npc.deckStation = m.station;
            npc.deckMember = m;
            this.npcs.push(npc);
            out.push(npc);
        }
        // Nothing hides on the open sea: all of it in sight
        for (const row of this.tiles) for (const t of row) { t.explored = true; t.visible = true; }
        return out;
    },

    /**
     * A hand's next move (from _npcPickDestination): at their station, work
     * there a while (npc.deckWork: its label, anim and seconds); elsewhere,
     * walk to a free cell of it — or to npc.deckTarget (a fight) when set.
     */
    _deckDestination(npc) {
        if (!this._deck) { npc.state = 'idle'; npc.idleTimer = 3; return; }
        const go = (to) => {
            const path = to ? this._findPath(npc.q, npc.r, to.q, to.r) : null;
            if (path && path.length > 1) {
                npc.path = path.slice(1);
                npc.pathIndex = 0;
                npc.moveProgress = 0;
                npc.prevQ = npc.q;
                npc.prevR = npc.r;
                npc.state = 'walking';
                npc.activity = null;
                return true;
            }
            return false;
        };
        if (npc.deckTarget) {
            if (_cheb(npc, npc.deckTarget) > 1 && go(this._deckSpotBeside(npc.deckTarget, npc) || npc.deckTarget)) return;
            npc.state = 'idle';
            npc.idleTimer = 0.4;
            return;
        }
        const cells = this._deckStationCells(npc.deckStation);
        const here = cells.some(c => c.q === npc.q && c.r === npc.r);
        if (!here || (cells.length > 1 && Utils.random() < 0.3)) {
            if (go(this._deckSpot(npc.deckStation, null, npc))) return;
        }
        const w = npc.deckWork || null;
        npc.activity = w ? { type: npc.deckStation, icon: w.icon, label: w.label, anim: w.anim } : null;
        npc.state = 'idle';
        const secs = w && Array.isArray(w.secs) ? w.secs : [5, 10];
        npc.idleTimer = secs[0] + Utils.random() * Math.max(0, secs[1] - secs[0]);
        // The lookout faces the sea ahead (west), the helmsman the bow
        if (npc.deckStation === 'bow' || npc.deckStation === 'helm') npc.facing = 1;
    },

    /** A free deck cell next to (q, r), for closing with someone. */
    _deckSpotBeside(at, self = null) {
        const L = this._deck;
        if (!L) return null;
        const taken = new Set((this.npcs || []).filter(n => n !== self).map(n => _key(n.q, n.r)));
        let best = null;
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const c = { q: at.q + dq, r: at.r + dr };
            if (!L.cellSet.has(_key(c.q, c.r)) || taken.has(_key(c.q, c.r))) continue;
            if (!best || (self && _cheb(c, self) < _cheb(best, self))) best = c;
        }
        return best;
    },

    /* ── Boarders ────────────────────────────────────────────── */

    /**
     * A pirate ship alongside: a hull moored on the open water beside yours
     * (north of it, or south where there is no room). → { q, r, side } or null
     */
    _layPirateHull(hullId = 'hull_sloop') {
        const L = this._deck || this._deckLayout();
        const def = CustomObjects.getDef(hullId) || CustomObjects.getDef('hull_sloop');
        if (!L || !def || !this._berth) return null;
        this._clearPirateHull();
        const foot = ShipHulls.footprint(def);
        const h = foot.length ? Math.max(...foot.map(m => -m.localRow)) + 1 : 6;
        let at = null;
        for (const near of [{ q: L.anchor.q, r: L.minR - 3 }, { q: L.anchor.q, r: L.maxR + h + 3 }]) {
            at = this._berth(this.tiles, def, near, 12);
            if (at) break;
        }
        if (!at) return null;
        this._moorShip(this.tiles, def, at.q, at.r, { pirateShip: true, label: 'Pirates' });
        L.pirate = { q: at.q, r: at.r, defId: def.id, side: at.r < L.anchor.r ? 'N' : 'S' };
        return L.pirate;
    },

    /** Take the pirate ship away again. */
    _clearPirateHull() {
        const tiles = this.tiles;
        if (!tiles) return;
        for (let r = 0; r < tiles.length; r++) {
            for (let q = 0; q < tiles[r].length; q++) {
                const o = tiles[r][q].customObject;
                if (o && o.pirateShip && this._unmoor) this._unmoor(tiles, q, r);
            }
        }
        if (this._deck) this._deck.pirate = null;
    },

    /** Where `n` boarders come over the rail: the rail facing the pirate ship, spread along it. */
    _boarderSpots(n) {
        const L = this._deck;
        if (!L || n <= 0) return [];
        const rail = (L.pirate && L.pirate.side === 'S') ? L.railS : L.railN;
        const usable = rail.filter(c => !(c.q === L.helm.q && c.r === L.helm.r));
        const list = usable.length ? usable : L.cells;
        const out = [];
        for (let i = 0; i < n; i++) out.push(list[Math.floor(((i + 0.5) / n) * list.length) % list.length]);
        return out;
    },

    /** Put boarders on deck: [{ name, hp }] → the people placed (marked `_boarder`). */
    _spawnBoarders(party) {
        const spots = this._boarderSpots(party.length);
        const out = [];
        party.forEach((b, i) => {
            const at = spots[i];
            if (!at) return;
            const npc = this._deckNpc({ id: BOARDER_ID_BASE + i, type: 'traveler', name: b.name, q: at.q, r: at.r, speed: 0.6 });
            npc._boarder = true;
            npc.roleTitle = 'boarder';
            npc.idleTimer = 0.6 + i * 0.2;
            npc.activity = { type: 'boarder', icon: '⚔️', label: 'Boarding', anim: 'ready' };
            this.npcs.push(npc);
            out.push(npc);
        });
        return out;
    },
});
