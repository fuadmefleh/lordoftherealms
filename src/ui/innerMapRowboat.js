// ============================================
// INNER MAP ROWBOAT — a boat of your own on the street map's water
// ============================================
// Your rowboats (player/rowboats.js: bought from a town's boatwright, built on
// a bank, each recorded by world hex and street-map cell) lie on the water of
// their map, made fast to the bank, until you come back for them.
//
//   • Board the Boat (right-click it: from the bank beside it, or Climb into
//     the Boat from the water). Aboard you are not swimming — dry, no strokes,
//     the packs safe — and your walk is the oars': over water only, deep or the
//     shallows it grounds in, at about a walk (InnerMap._aboardBoat / _rowSpeed,
//     read by world/innerMap/swimming.js and movement.js). The bank is reached
//     by Step Ashore / Row Ashore Here (or a click on dry land beside the water).
//   • Rest the oars on a river and the current carries you (world/innerMap/
//     currents.js driftPlayer: a boat adrift); Tie Up at a bank and it doesn't.
//     Carried (or rowed) to the map's edge where the river runs on, you go on
//     into the next hex's map still aboard (ui/game/gameLoop.js _crossEdge,
//     beforeCross / afterCross here), and the boat is tied up afresh there.
//   • From the boat: Fish Here casts from where you sit (castFrom, read by the
//     fish_here handler in innerMapUI.js); a throw to the fish is measured from
//     the boat (ui/innerMapFeedFish.js reads the player's cell); Dive from the
//     Boat leaves it moored where you went in (ui/innerMapDiving.js), and
//     surfacing beside it you climb back in.
//   • You are put ashore of yourself (the boat left where it lies): knocked
//     down, a battle on the map, a ship boarded, the map left, the water frozen.
//
//   update(dt, game)                   each frame: the boat kept under you, the checks
//   menuItems(game, tile, q, r)        board / tie up / cast off / ashore / dive / buy / build / sell
//   handle(game, item, q, r)           'rowboat_*' (and a click on land while aboard)
//   castFrom(q, r, reach)              the cell to fish from while aboard, or null
//   beforeCross(game) / afterCross(game, carry, at)   the boat through a river edge
//   collect(items, ctx, camera, T)     the moored boats (innerMapLayers/entities.js)
//   drawAboard(ctx, o)                 you in the boat at the oars (the player's pass)

import { InnerMap } from '../world/innerMap.js';
import { Rowboats } from '../player/rowboats.js';
import { Swimming } from '../player/swimming.js';
import { Diving } from '../player/diving.js';
import { Utils } from '../core/utils.js';
import { InnerMapBattle } from './innerMapBattle.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapCarry } from './innerMapCarry.js';
import { InnerMapCarts } from './innerMapCarts.js';
import { InnerMapPets } from './innerMapPets.js';
import { InnerMapDiving } from './innerMapDiving.js';
import { InnerMapCharacters } from './innerMapCharacters.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function _notify(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

function _stats(game) {
    if (game && game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
}

export const InnerMapRowboat = {
    aboard: null,     // the id of the boat you are in, or null
    tied: false,      // made fast to the bank while you sit in it (the current can't take it)
    _carry: null,     // { id, at } through a river-edge crossing
    _player: null,
    _map: null,
    _t: 0,

    // ── Where ──

    /** The world hex of the street map you are on (outdoors), or null. */
    hex() {
        if (!InnerMap.active || InnerMap._insideBuilding || !InnerMap.currentWorldTile) return null;
        const h = InnerMap.currentWorldTile;
        return Number.isFinite(h.q) && Number.isFinite(h.r) ? { q: h.q, r: h.r } : null;
    },

    /** Your boats on this map (the one you are in among them). */
    here(game) {
        const h = this.hex();
        return h && game && game.player ? Rowboats.boatsOn(game.player, h.q, h.r) : [];
    },

    /** The boat you sit in now, or null. */
    boat(game) {
        return this.aboard && game && game.player ? Rowboats.get(game.player, this.aboard) : null;
    },

    _tile(q, r) {
        return InnerMap.tiles && InnerMap.tiles[r] ? InnerMap.tiles[r][q] || null : null;
    },

    /** Ground you could step out onto from a boat: walkable (the shallows too), not a building, not up a crag. */
    isLanding(q, r) {
        const t = this._tile(q, r);
        if (!t || !t.subTerrain || !t.subTerrain.passable || t.building || t.customBuilding || t.customBuildingPart) return false;
        if (InnerMap.isDivable && InnerMap.isDivable(q, r)) return false;
        return !(typeof InnerMap.standLevel === 'function' && InnerMap.standLevel(t) !== 0);
    },

    /** Dry ground (not the shallows): what a boat is tied to. */
    isBank(q, r) {
        return this.isLanding(q, r) && !InnerMap.isSwimmable(q, r);
    },

    /** Water a boat floats on: deep, or the shallows. */
    isBoatWater(q, r) {
        return !!(InnerMap.isSwimmable && InnerMap.isSwimmable(q, r));
    },

    /** Water beside a bank (or a pier, a bridge): where a boat is tied up. */
    isMooring(q, r) {
        if (!this.isBoatWater(q, r)) return false;
        return N8.some(([a, b]) => {
            const t = this._tile(q + a, r + b);
            return !!(t && (this.isBank(q + a, r + b) || t._pier || t._bridge));
        });
    },

    /** The nearest dry landing beside (q, r) to `toward` (4-way first), or null. */
    landingBeside(q, r, toward = null) {
        let best = null, bestD = Infinity;
        N8.forEach(([a, b], i) => {
            const x = q + a, y = r + b;
            if (!this.isLanding(x, y)) return;
            if (InnerMap._stepBlocked && i < 4 && InnerMap._stepBlocked(q, r, x, y)) return;
            const d = (i < 4 ? 0 : 0.5) + (toward ? Math.hypot(x - toward.q, y - toward.r) * 2 : 0) + (this.isBank(x, y) ? 0 : 0.25);
            if (d < bestD) { bestD = d; best = { q: x, r: y }; }
        });
        return best;
    },

    // ── Aboard ──

    _set(id) {
        this.aboard = id || null;
        if (!id) this.tied = false;
        InnerMap._aboardBoat = !!id;
        InnerMap._boatTied = !!(id && this.tied);
        InnerMap._rowSpeed = Math.max(0.2, _num(Rowboats.config().rowSpeed, 0.9));
    },

    /** Why you couldn't get into this boat now (or null). */
    whyNotBoard(game, boat) {
        if (!boat || !game || !game.player) return 'You have no boat here.';
        if (this.aboard) return 'You are in a boat already.';
        if (!this.isBoatWater(boat.q, boat.r)) return 'She is frozen fast in the ice.';
        if (InnerMapDiving.isUnder && InnerMapDiving.isUnder()) return 'Come up for air first.';
        if (InnerMapPets.riding) return 'Get down from your horse first.';
        if (InnerMapCarry.handsFull() || InnerMapCarts.pushing) return 'Your hands are full: put down what you carry first.';
        if (InnerMapCombat.playerKnockedOut && InnerMapCombat.playerKnockedOut()) return 'You can barely stand.';
        if (InnerMapBattle.active || game.player.boardedShip) return 'Not now.';
        return null;
    },

    _beside(q, r) {
        return Math.max(Math.abs(q - InnerMap.playerInnerQ), Math.abs(r - InnerMap.playerInnerR)) <= 1;
    },

    /** Into the boat (walked or swum over to it first when it lies off). → true when under way or done */
    board(game, boat) {
        const why = this.whyNotBoard(game, boat);
        if (why) { _notify(game, '🛶 Not Now', why, 'warning'); return false; }
        const swimming = InnerMap.isPlayerSwimming();
        const up = () => {
            if (this.whyNotBoard(game, boat) || !this._beside(boat.q, boat.r)) return;
            InnerMap.cancelPlayerWalk();
            InnerMap.playerInnerQ = boat.q;
            InnerMap.playerInnerR = boat.r;
            InnerMap._playerPrevQ = boat.q;
            InnerMap._playerPrevR = boat.r;
            if (InnerMap._driftPx) { InnerMap._driftPx.x = 0; InnerMap._driftPx.y = 0; }
            Swimming.ashore(game.player);
            this.tied = this.isMooring(boat.q, boat.r);
            this._set(boat.id);
            this._map = InnerMap.tiles;
            _notify(game, `🛶 The ${boat.name}`, swimming
                ? `You haul yourself over the side into the ${boat.name}, streaming water.`
                : `You step down into the ${boat.name} and take up the oars. Click the water to row; Step Ashore at a bank.`, 'info');
        };
        if (this._beside(boat.q, boat.r)) { up(); return true; }
        // (from the bank beside her, or swum out to her)
        let res = InnerMap.approachAndThen ? InnerMap.approachAndThen(boat.q, boat.r, up) : 'unreachable';
        if (res === 'unreachable' && InnerMap._swimAllowed) {
            InnerMap.cancelPlayerWalk();
            const walk = InnerMap.movePlayerTo(boat.q, boat.r);
            if (walk && walk.started) { InnerMap._pendingAction = { q: boat.q, r: boat.r, run: up }; res = 'walking'; }
        }
        if (res === 'unreachable') { _notify(game, '🛶 Not Now', `You can't get to the ${boat.name} from here.`, 'warning'); return false; }
        return true;
    },

    /**
     * Out of the boat onto the bank beside it (`to`: the cell asked for, else the
     * nearest). The boat stays tied up where it lies. why: a word on it (none: quiet).
     */
    stepAshore(game, to = null, why = null) {
        const boat = this.boat(game);
        if (!boat) return false;
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        const spot = to && this.isLanding(to.q, to.r) && this._beside(to.q, to.r) ? to : this.landingBeside(q, r, to);
        if (!spot) { _notify(game, '🛶 No Bank Here', 'There is no ground to step onto here: row to the bank first.', 'warning'); return false; }
        this._moorHere(game, boat);
        this._set(null);
        InnerMap.cancelPlayerWalk();
        InnerMap.playerInnerQ = spot.q;
        InnerMap.playerInnerR = spot.r;
        InnerMap._playerPrevQ = spot.q;
        InnerMap._playerPrevR = spot.r;
        if (InnerMap._driftPx) { InnerMap._driftPx.x = 0; InnerMap._driftPx.y = 0; }
        if (InnerMap._revealAround) InnerMap._revealAround(InnerMap.tiles, spot.q, spot.r, 2);
        _notify(game, `🛶 The ${boat.name}`, why || `You ship the oars and step ashore. The ${boat.name} waits, tied to the bank.`, 'info');
        return true;
    },

    /** Over the side into the water (to swim, or to dive): the boat left lying where it is. */
    overSide(game, dive = false) {
        const boat = this.boat(game);
        if (!boat) return false;
        const swim = Swimming.canSwim(game.player);
        if (!swim.ok) { _notify(game, '🌊 Over the Side', swim.reason, 'warning'); return false; }
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        if (dive) {
            if (!InnerMap.isDivable(q, r)) { _notify(game, '🐚 Dive', 'The water here is too shallow to go under.', 'warning'); return false; }
            const ok = Diving.canDive(game.player);
            if (!ok.ok) { _notify(game, '🐚 Dive', ok.reason, 'warning'); return false; }
        }
        this._moorHere(game, boat);
        this._set(null);
        InnerMap.cancelPlayerWalk();
        if (dive) {
            if (InnerMapDiving.goUnder(game)) _notify(game, '🐚 Over the Side', `You go over the side of the ${boat.name} and down. She rocks on the water above you; come up beside her and Climb into the Boat.`, 'info');
        } else {
            _notify(game, '🌊 Over the Side', `You slip over the side of the ${boat.name} into the water. Swim back to her and Climb into the Boat.`, 'info');
        }
        return true;
    },

    tieUp(game) {
        const boat = this.boat(game);
        if (!boat) return false;
        if (!this.isMooring(InnerMap.playerInnerQ, InnerMap.playerInnerR)) { _notify(game, '🪢 Tie Up', 'There is no bank here to tie her to.', 'warning'); return false; }
        InnerMap.cancelPlayerWalk();
        this.tied = true;
        InnerMap._boatTied = true;
        _notify(game, '🪢 Tied Up', `You make the ${boat.name} fast to the bank: the current won't take her while you sit and fish.`, 'info');
        return true;
    },

    castOff(game) {
        if (!this.aboard) return false;
        this.tied = false;
        InnerMap._boatTied = false;
        _notify(game, '🛶 Cast Off', 'You cast off from the bank. Rest the oars on a river and the current takes you.', 'info');
        return true;
    },

    /** Record the boat at your cell (it is where you are while you sit in it). */
    _moorHere(game, boat) {
        const h = this.hex();
        if (!h || !boat) return;
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        if (!this.isBoatWater(q, r) && this._last) Rowboats.moor(game.player, boat.id, { hq: h.q, hr: h.r, q: this._last.q, r: this._last.r });
        else Rowboats.moor(game.player, boat.id, { hq: h.q, hr: h.r, q, r });
    },

    /** Fishing from the boat: the cell you cast from (your own) when (q, r) is within a cast, else null. */
    castFrom(q, r, reach = 3) {
        if (!this.aboard || !InnerMap._aboardBoat) return null;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        return Math.max(Math.abs(q - pq), Math.abs(r - pr)) <= reach ? { q: pq, r: pr } : null;
    },

    // ── Through a river's edge into the next hex ──

    /** Leaving by the river aboard: the boat goes too. → a carry token, or null */
    beforeCross(game) {
        if (!this.aboard || !this.boat(game)) return null;
        this._carry = { id: this.aboard, at: _now() };
        return this._carry;
    },

    /**
     * On the next hex's map: the boat comes in with you at `at` (still aboard,
     * in the river); with no water to come in on, it stays tied up on the old hex.
     */
    afterCross(game, carry, at) {
        if (!carry) return;
        if (this._carry === carry) this._carry = null;
        const boat = game && game.player ? Rowboats.get(game.player, carry.id) : null;
        const h = this.hex();
        if (!boat || !h || !at || !this.isBoatWater(at.q, at.r)) {
            this._set(null);
            if (boat) _notify(game, `🛶 The ${boat.name}`, `You had to leave the ${boat.name} behind, at the edge of the last map.`, 'warning');
            return;
        }
        Rowboats.moor(game.player, boat.id, { hq: h.q, hr: h.r, q: at.q, r: at.r });
        this._last = { q: at.q, r: at.r };
        this._map = InnerMap.tiles;
        this.tied = false;
        this._set(boat.id);
    },

    // ── Each frame ──

    update(dt, game) {
        const player = game && game.player;
        if (player !== this._player) { this._player = player; this._carry = null; this._set(null); }
        this._t += Math.max(0, Math.min(_num(dt), 0.1));
        if (this._carry) {
            // (between the two maps of a river crossing: the boat goes with you — unless it never arrives)
            if (_now() - this._carry.at > 15000) { this._carry = null; this._set(null); }
            return;
        }
        if (!this.aboard) { if (InnerMap._aboardBoat) this._set(null); return; }
        const boat = this.boat(game);
        if (!boat || !InnerMap.active || InnerMap.tiles !== this._map) { this._set(null); return; }
        if (InnerMap._insideBuilding) { this._set(null); return; }
        if (InnerMapBattle.active || player.boardedShip) { this._moorHere(game, boat); this._set(null); return; }
        if (InnerMapDiving.isUnder && InnerMapDiving.isUnder()) { this._moorHere(game, boat); this._set(null); return; }
        if (InnerMapCombat.playerKnockedOut && InnerMapCombat.playerKnockedOut()) {
            this._moorHere(game, boat);
            this._set(null);
            _notify(game, '🌊 Over the Side', `The blow knocks you out of the ${boat.name} into the water.`, 'warning');
            return;
        }
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        if (!this.isBoatWater(q, r)) {
            // (on dry ground, or the water turned to ice under her: out you get, the boat where she last floated)
            this._moorHere(game, boat);
            this._set(null);
            _notify(game, `🛶 The ${boat.name}`, `You climb out of the ${boat.name}.`, 'info');
            return;
        }
        const h = this.hex();
        if (h) { boat.hq = h.q; boat.hr = h.r; boat.q = q; boat.r = r; }
        this._last = { q, r };
        // (rowing off unties her)
        if (InnerMap._playerWalking && this.tied) { this.tied = false; InnerMap._boatTied = false; }
        InnerMap._aboardBoat = true;
    },

    // ── The menu ──

    menuItems(game, tile, q, r) {
        const out = [];
        const player = game && game.player;
        const h = this.hex();
        if (!player || !h || !tile || !Rowboats.config().enabled) return out;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const mine = Rowboats.boatAt(player, h.q, h.r, q, r);
        const inBoat = this.boat(game);
        if (inBoat) {
            if (q === pq && r === pr) {
                out.push({ type: 'header', label: `🛶 The ${inBoat.name}${this.tied ? ' — tied up' : ''}` });
                if (this.tied) out.push({ type: 'action', action: 'rowboat_untie', label: 'Cast Off', icon: '🛶', desc: 'Let go of the bank: row on, or rest the oars and let a river carry you' });
                else if (this.isMooring(q, r)) out.push({ type: 'action', action: 'rowboat_tie', label: 'Tie Up', icon: '🪢', desc: 'Make her fast to the bank: the current won\'t take you while you sit and fish' });
                else out.push({ type: 'disabled', label: '🪢 Tie Up — no bank here to tie to' });
                if (this.landingBeside(q, r)) out.push({ type: 'action', action: 'rowboat_ashore', label: 'Step Ashore', icon: '🦶', desc: `Out onto the bank; the ${inBoat.name} stays tied up here` });
                else out.push({ type: 'disabled', label: '🦶 Step Ashore — row to a bank first' });
                if (InnerMap.isDivable(q, r)) {
                    const ok = Diving.canDive(player);
                    if (ok.ok) out.push({ type: 'action', action: 'rowboat_dive', label: 'Dive from the Boat', icon: '🐚', desc: `Over the side and down; the ${inBoat.name} waits on the water above you` });
                    else out.push({ type: 'disabled', label: `🐚 Dive from the Boat — ${ok.reason}` });
                }
                out.push({ type: 'action', action: 'rowboat_overside', label: 'Slip Over the Side', icon: '🌊', desc: 'Into the water, to swim; climb back in beside her' });
                out.push({ type: 'separator' });
            } else if (this.isLanding(q, r) && !this.isBoatWater(q, r)) {
                out.push({ type: 'action', action: 'rowboat_landat', label: 'Row Ashore Here', icon: '🛶', desc: `Row in to the bank and step out here; the ${inBoat.name} stays tied up` });
            }
            return out;
        }
        if (mine) {
            out.push({ type: 'header', label: `🛶 Your Rowboat, the ${mine.name}` });
            const why = this.whyNotBoard(game, mine);
            const swimming = InnerMap.isPlayerSwimming();
            if (why) out.push({ type: 'disabled', label: `🛶 Board — ${why}` });
            else out.push({ type: 'action', action: 'rowboat_board', boatId: mine.id, label: swimming ? 'Climb into the Boat' : 'Board the Boat', icon: '🛶', desc: 'Take up the oars: row about the water, fish from her, drift down a river' });
            if (Rowboats.sellerHere(game.world, player)) {
                const v = Rowboats.saleValue(game.world, player);
                if (v > 0) out.push({ type: 'action', action: 'rowboat_sell', boatId: mine.id, label: `Sell Her to the Boatwright (${Utils.formatGold(v)}g)`, icon: '🪙', desc: 'The town\'s boatwright buys her back, out of the town\'s purse' });
            }
            out.push({ type: 'separator' });
            return out;
        }
        // A new boat, launched here: bought from the town's boatwright, or built on the bank
        if (this.isMooring(q, r) && !InnerMap.isPlayerSwimming() && !this.here(game).length) {
            const town = Rowboats.sellerHere(game.world, player);
            if (town) {
                const why = Rowboats.whyNotBuy(game.world, player);
                if (why) out.push({ type: 'disabled', label: `🛶 Buy a Rowboat — ${why}` });
                else out.push({ type: 'action', action: 'rowboat_buy', label: `Buy a Rowboat (${Utils.formatGold(Rowboats.price())}g)`, icon: '🛶', desc: `From the boatwright of ${town.name || 'the town'}: launched here and tied to the bank` });
            }
        }
        if (this.isMooring(q, r) && !InnerMap.isPlayerSwimming()) {
            const needs = Rowboats.buildNeeds(player);
            const whyB = Rowboats.whyNotBuild(player);
            const what = needs.map(n => `${n.need} ${n.id.replace(/_/g, ' ')}`).join(', ');
            if (!whyB) out.push({ type: 'action', action: 'rowboat_build', label: 'Build a Rowboat Here', icon: '🪚', desc: `${Rowboats.buildHours()} hours' work on the bank, from your packs: ${what}` });
            else if (needs.some(n => n.have > 0 && n.id === 'planks')) out.push({ type: 'disabled', label: `🪚 Build a Rowboat — ${whyB}` });
        }
        return out;
    },

    /** A menu choice of ours (or a click on dry land while you sit in the boat)? → true when handled */
    handle(game, item, q, r) {
        const action = item && item.action;
        if (!action) return false;
        if (action === 'move_here' && this.aboard && this.isLanding(q, r) && !this.isBoatWater(q, r)) return this._rowAshore(game, q, r);
        if (!/^rowboat_/.test(action)) return false;
        const player = game.player, world = game.world;
        const h = this.hex();
        switch (action) {
            case 'rowboat_board': {
                const boat = Rowboats.get(player, item.boatId);
                if (boat) this.board(game, boat);
                return true;
            }
            case 'rowboat_ashore': this.stepAshore(game); return true;
            case 'rowboat_landat': return this._rowAshore(game, q, r);
            case 'rowboat_tie': this.tieUp(game); return true;
            case 'rowboat_untie': this.castOff(game); return true;
            case 'rowboat_dive': this.overSide(game, true); return true;
            case 'rowboat_overside': this.overSide(game, false); return true;
            case 'rowboat_buy': {
                if (!h || !this.isMooring(q, r)) { _notify(game, '🛶 Not Here', 'Choose water beside the bank to launch her.', 'warning'); return true; }
                const res = Rowboats.buy(world, player, { hq: h.q, hr: h.r, q, r });
                _notify(game, res.success ? '🛶 A Boat of Your Own' : '🛶 Not Now', res.text, res.success ? 'success' : 'warning');
                _stats(game);
                return true;
            }
            case 'rowboat_build': {
                if (!h || !this.isMooring(q, r)) { _notify(game, '🪚 Not Here', 'Choose water beside the bank to launch her.', 'warning'); return true; }
                const res = Rowboats.build(world, player, { hq: h.q, hr: h.r, q, r });
                if (res.success && res.hours > 0 && typeof InnerMap.passHours === 'function') InnerMap.passHours(res.hours);
                _notify(game, res.success ? '🪚 Built' : '🪚 Not Now', res.text, res.success ? 'success' : 'warning');
                _stats(game);
                return true;
            }
            case 'rowboat_sell': {
                const res = Rowboats.sell(world, player, item.boatId);
                _notify(game, res.success ? '🪙 Sold' : '🛶 Not Now', res.text, res.success ? 'success' : 'warning');
                _stats(game);
                return true;
            }
            default: return false;
        }
    },

    /** Row to the water beside (q, r) on the bank, and step out there. */
    _rowAshore(game, q, r) {
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        if (this._beside(q, r)) { this.stepAshore(game, { q, r }); return true; }
        // the water beside that bank nearest you
        let best = null, bestD = Infinity;
        for (const [a, b] of N4) {
            const x = q + a, y = r + b;
            if (!this.isBoatWater(x, y)) continue;
            const d = Math.hypot(x - pq, y - pr);
            if (d < bestD) { bestD = d; best = { q: x, r: y }; }
        }
        if (!best) { _notify(game, '🛶 No Way In', 'There is no water beside that bank to row in on.', 'warning'); return true; }
        InnerMap.cancelPlayerWalk();
        const walk = InnerMap.movePlayerTo(best.q, best.r);
        if (!walk || !walk.started) { _notify(game, '🛶 No Way In', 'You can\'t row there from here.', 'warning'); return true; }
        InnerMap._pendingAction = { q, r, run: () => { if (this.aboard) this.stepAshore(game, { q, r }); } };
        return true;
    },

    // ── Drawing ──

    /** Which way a moored boat lies: along the bank beside it (true: lengthwise across the screen). */
    _lengthwise(b) {
        const land = (a, c) => this.isLanding(b.q + a, b.r + c);
        if (land(0, -1) || land(0, 1)) return true;
        if (land(-1, 0) || land(1, 0)) return false;
        return true;
    },

    collect(items, ctx, camera, T) {
        const game = this._player ? { player: this._player } : null;
        if (!game || !InnerMap.active || InnerMap._insideBuilding || InnerMapBattle.active) return;
        const boats = this.here(game);
        if (!boats.length) return;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        for (const b of boats) {
            if (b.id === this.aboard) continue;
            const t = this._tile(b.q, b.r);
            if (t && t.visible === false) continue;
            const wx = (b.q + 0.5) * T, wy = (b.r + 0.5) * T;
            const s = camera.worldToScreenFast(wx, wy);
            const sx = s.x, sy = s.y;
            if (sx < -ds * 3 || sx > W + ds * 3 || sy < -ds * 3 || sy > H + ds * 3) continue;
            const horiz = this._lengthwise(b);
            const frozen = !this.isBoatWater(b.q, b.r);
            const phase = (b.q * 1.7 + b.r * 0.9) % 6.28;
            items.push({ sortY: wy, zLayer: 1, sortX: wx / T, draw: () => {
                const bob = frozen ? 0 : Math.sin(this._t * 1.6 + phase) * ds * 0.025;
                this._drawHull(ctx, sx, sy + ds * 0.05 + bob, ds, horiz ? 1 : 0, { rowing: false, t: this._t + phase, moored: true, frozen });
            } });
        }
    },

    /**
     * The boat's hull, seen from above and a little to the front. `dir` 0..3 as
     * the characters' (up, left, down, right: the bow that way); 1/3 lie across
     * the screen, 0/2 up it. o: { rowing, t, moored, frozen, part: 'all'|'hull'|'front' }
     */
    _drawHull(ctx, cx, cy, ds, dir, o = {}) {
        const part = o.part || 'all';
        const across = dir === 1 || dir === 3;
        const L = ds * (across ? 1.62 : 1.38), B = ds * (across ? 0.6 : 0.66);
        const ang = dir === 3 ? 0 : dir === 1 ? Math.PI : dir === 2 ? Math.PI / 2 : -Math.PI / 2;
        const px = (v) => Math.round(v);
        ctx.save();
        if (part !== 'front') {
            // The water about her: a dark under-shadow and a ring at the waterline
            if (!o.frozen) {
                ctx.fillStyle = 'rgba(10,30,45,0.28)';
                ctx.beginPath();
                ctx.ellipse(px(cx), px(cy + ds * 0.08), (across ? L : B) * 0.56, (across ? B : L) * 0.5, 0, 0, Math.PI * 2);
                ctx.fill();
                const k = 0.5 + Math.sin(_num(o.t) * 2.2) * 0.08;
                ctx.strokeStyle = `rgba(225,242,255,${o.rowing ? 0.55 : 0.32})`;
                ctx.lineWidth = Math.max(1, ds / 22);
                ctx.beginPath();
                ctx.ellipse(px(cx), px(cy + ds * 0.06), (across ? L : B) * (0.55 + k * 0.08), (across ? B : L) * (0.5 + k * 0.07), 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.translate(px(cx), px(cy));
        ctx.rotate(ang);
        // (local frame: the bow toward +x, the beam along y)
        const hullPath = (s) => {
            const l = L * s, b = B * s;
            ctx.beginPath();
            ctx.moveTo(l / 2, 0);
            ctx.quadraticCurveTo(l * 0.36, -b * 0.52, l * 0.12, -b / 2);
            ctx.lineTo(-l * 0.42, -b * 0.46);
            ctx.quadraticCurveTo(-l / 2, -b * 0.44, -l / 2, -b * 0.3);
            ctx.lineTo(-l / 2, b * 0.3);
            ctx.quadraticCurveTo(-l / 2, b * 0.44, -l * 0.42, b * 0.46);
            ctx.lineTo(l * 0.12, b / 2);
            ctx.quadraticCurveTo(l * 0.36, b * 0.52, l / 2, 0);
            ctx.closePath();
        };
        const lw = Math.max(1, Math.round(ds / 16));
        if (part !== 'front') {
            // Outside of the hull: tarred planking, a dark outline
            hullPath(1);
            ctx.fillStyle = o.frozen ? '#6d5a4a' : '#6e4322';
            ctx.fill();
            ctx.lineWidth = lw;
            ctx.strokeStyle = '#2b180b';
            ctx.stroke();
            // Inside: the floorboards, lighter, with the plank seams
            hullPath(0.8);
            ctx.fillStyle = '#a7743f';
            ctx.fill();
            ctx.strokeStyle = '#4a2b14';
            ctx.lineWidth = Math.max(1, lw * 0.75);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(90,52,24,0.75)';
            ctx.lineWidth = Math.max(1, ds / 30);
            for (const f of [-0.17, 0.17]) {
                ctx.beginPath();
                ctx.moveTo(-L * 0.36, B * f);
                ctx.lineTo(L * 0.3, B * f * 0.8);
                ctx.stroke();
            }
            // The thwarts: a seat amidships and one in the stern
            ctx.fillStyle = '#5b3418';
            ctx.fillRect(-L * 0.06, -B * 0.4, L * 0.1, B * 0.8);
            ctx.fillRect(-L * 0.36, -B * 0.34, L * 0.08, B * 0.68);
            // A coil of rope at the bow when tied up, the painter run to the bank
            if (o.moored) {
                ctx.strokeStyle = '#d2b27a';
                ctx.lineWidth = Math.max(1, ds / 26);
                ctx.beginPath();
                ctx.arc(L * 0.28, 0, B * 0.11, 0, Math.PI * 2);
                ctx.stroke();
            }
            // Light along the gunwale's top edge
            ctx.strokeStyle = 'rgba(255,220,160,0.35)';
            ctx.lineWidth = Math.max(1, ds / 28);
            ctx.beginPath();
            ctx.moveTo(L * 0.4, -B * 0.16);
            ctx.quadraticCurveTo(L * 0.3, -B * 0.46, L * 0.1, -B * 0.47);
            ctx.lineTo(-L * 0.4, -B * 0.43);
            ctx.stroke();
            // Shipped oars lying along the thwarts while moored
            if (o.moored) {
                ctx.strokeStyle = '#c89a5c';
                ctx.lineWidth = Math.max(1, ds / 18);
                for (const f of [-0.12, 0.12]) {
                    ctx.beginPath();
                    ctx.moveTo(-L * 0.38, B * f);
                    ctx.lineTo(L * 0.22, B * f * 1.3);
                    ctx.stroke();
                }
            }
        }
        if (part === 'all' || part === 'front') {
            // The near gunwale (toward the viewer): drawn over a body sat in her
            ctx.strokeStyle = '#3a2210';
            ctx.lineWidth = Math.max(2, Math.round(ds / 10));
            ctx.beginPath();
            if (across) {
                // (the side facing down the screen: +y when the bow is right, -y when left)
                const sgn = dir === 3 ? 1 : -1;
                ctx.moveTo(L * 0.44, sgn * B * 0.12);
                ctx.quadraticCurveTo(L * 0.34, sgn * B * 0.5, L * 0.12, sgn * B * 0.5);
                ctx.lineTo(-L * 0.42, sgn * B * 0.46);
            } else {
                // (seen end-on: the near end's rim)
                const end = dir === 2 ? 1 : -1;
                ctx.moveTo(end * L * 0.42, -B * 0.44);
                ctx.quadraticCurveTo(end * L * 0.5, 0, end * L * 0.42, B * 0.44);
            }
            ctx.stroke();
            ctx.strokeStyle = '#8a5a2e';
            ctx.lineWidth = Math.max(1, Math.round(ds / 24));
            ctx.stroke();
        }
        ctx.restore();
    },

    /** An oar from its rowlock at (ox, oy), out to the side `side` (±1), swept by `sweep` (-1..1). */
    _drawOar(ctx, ox, oy, ds, across, side, sweep, rowing, t) {
        const reach = ds * 0.62;
        let ex, ey, hx, hy;
        if (across) {
            ex = ox + sweep * ds * 0.32; ey = oy + side * reach;
            hx = ox - sweep * ds * 0.12; hy = oy - side * ds * 0.18;
        } else {
            ex = ox + side * reach; ey = oy + sweep * ds * 0.3;
            hx = ox - side * ds * 0.18; hy = oy - sweep * ds * 0.1;
        }
        ctx.save();
        ctx.strokeStyle = '#2b180b';
        ctx.lineWidth = Math.max(2, Math.round(ds / 12));
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = '#c89a5c';
        ctx.lineWidth = Math.max(1, Math.round(ds / 22));
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
        // The blade
        ctx.fillStyle = '#b08048';
        ctx.strokeStyle = '#2b180b';
        ctx.lineWidth = Math.max(1, ds / 28);
        ctx.beginPath();
        ctx.ellipse(ex, ey, across ? ds * 0.07 : ds * 0.12, across ? ds * 0.12 : ds * 0.07, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        // (a splash as the blade bites the water)
        if (rowing) {
            const bite = Math.max(0, Math.cos(t));
            if (bite > 0.4) {
                ctx.strokeStyle = `rgba(235,248,255,${(bite - 0.4) * 1.2})`;
                ctx.lineWidth = Math.max(1, ds / 26);
                ctx.beginPath();
                ctx.ellipse(ex, ey + ds * 0.04, ds * 0.16 * bite, ds * 0.06 * bite, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();
    },

    /**
     * You in the boat (the player's pass, innerMapLayers/entities.js): the hull on
     * the water, you sat amidships — only the body above the gunwale — at the oars,
     * pulling while you row. o: { preset, px, py, ds, dir, rowing, now, rod?(bx, by, bw, bh) }.
     * False when it can't be drawn (the caller draws you as ever).
     */
    drawAboard(ctx, o) {
        if (!this.aboard || !o || !o.preset) return false;
        const { px, py, ds, dir, now } = o;
        const rowing = !!o.rowing;
        const UP = 0;
        const across = dir === 1 || dir === 3;
        const bob = Math.sin(_num(now) * 1.8) * ds * 0.025;
        const cx = px, cy = py + ds * 0.1 + bob;
        const t = this._t * 4.2;
        const sweep = rowing ? Math.sin(t) : 0.25;
        this._drawHull(ctx, cx, cy, ds, dir, { rowing, t: this._t, part: 'hull' });
        // The rowlocks amidships, either side
        const L = ds * (across ? 1.62 : 1.38), B = ds * (across ? 0.6 : 0.66);
        const mid = across ? { x: cx + (dir === 3 ? -1 : 1) * L * 0.01, y: cy } : { x: cx, y: cy };
        const locks = across
            ? [{ x: mid.x, y: mid.y - B * 0.47, side: -1 }, { x: mid.x, y: mid.y + B * 0.47, side: 1 }]
            : [{ x: mid.x - B * 0.47, y: mid.y, side: -1 }, { x: mid.x + B * 0.47, y: mid.y, side: 1 }];
        // (the blades sweep aft to pull: against the way she heads)
        const sw = (across ? (dir === 3 ? -1 : 1) : (dir === 2 ? -1 : 1)) * sweep;
        // (lying across the screen the far oar is under you and the near one over; up it, both at your sides)
        if (across) this._drawOar(ctx, locks[0].x, locks[0].y, ds, across, locks[0].side, sw, rowing, t);
        else for (const k of locks) this._drawOar(ctx, k.x, k.y, ds, across, k.side, sw, rowing, t);
        // You, sat on the thwart: only what shows above the gunwale
        const charW = ds * 1.2, charH = ds * 1.8;
        const hip = cy + ds * 0.02 + (rowing ? Math.sin(t) * ds * 0.03 : 0);
        const top = hip - 40 * (charH / 64);
        const bx = px - charW / 2;
        const drawBody = () => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(bx - ds, top - ds, charW + ds * 2, hip - top + ds + ds * 0.06);
            ctx.clip();
            InnerMapCharacters.drawCharacter(ctx, o.preset, 'idle', dir, now, bx, top, charW, charH);
            ctx.restore();
        };
        if (o.rod && dir === UP) o.rod(bx, top, charW, charH);
        drawBody();
        if (o.rod && dir !== UP) o.rod(bx, top, charW, charH);
        if (across) this._drawOar(ctx, locks[1].x, locks[1].y, ds, across, locks[1].side, sw, rowing, t);
        this._drawHull(ctx, cx, cy, ds, dir, { rowing, t: this._t, part: 'front' });
        return true;
    },
};
