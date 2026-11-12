// ============================================
// INNER MAP CARRY — someone senseless over the player's shoulder
// ============================================
// A knocked-out NPC (ui/innerMapCombat.js _knockOutNPC) can be picked up and
// carried (systems/carrying.js has the rules):
//
//   - they lie over the player's shoulder and go where the player goes, the
//     walk slowed by their weight; orders that need free hands are refused
//   - through a door into a building (and its stairs) and back out, they
//     come too: the carried NPC is always on the map the player is on
//   - "Put Them Down" sets them on a free tile beside the player, still
//     senseless; "Lay Them on the Bed" lays them in a bed beside the player
//     (or the bed clicked). Left indoors, they lie in that room (npc._lyingIn)
//     until they come round, out of sight of the street
//   - coming round on the shoulder, they kick free, set down beside the
//     player, and react in fear (run) or anger (come at the player)
//   - those who see the player carrying them react as to a body carried
//     (InnerMapReactions._scanBodies, StreetCrime.foundReaction alive): the
//     watch comes to arrest, the ruler's own watch looks away
//
// Saves: the street maps are not saved — a town's people are dealt again from
// its roster on the next visit — so nothing about the carry is written; a load
// (or leaving the map) lets go (reset), and no one is left hanging in a list.

import { InnerMap } from '../world/innerMap.js';
import { Carrying } from '../systems/carrying.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapAnimals } from './innerMapAnimals.js';
import { Downed } from '../systems/downed.js';
import { Underworld } from '../systems/underworld.js';

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _note(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

const _cheb = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));

export const InnerMapCarry = {
    // The NPC over the player's shoulder (npc._carried), or null
    person: null,
    _baseSpeed: null,
    _game: null,

    /** Is the player carrying anyone or anything (a person, a body, a carcass)? */
    handsFull() {
        return !!(this.person || InnerMapCombat._carrying || InnerMapAnimals._carry);
    },

    /** Let go of everything (a load, a new game): nothing about the carry outlives the map. */
    reset() {
        const npc = this.person;
        if (npc) { npc._carried = false; npc._carryBody = null; }
        this.person = null;
        if (this._baseSpeed != null) { InnerMap._playerSpeed = this._baseSpeed; this._baseSpeed = null; }
    },

    /** The room the player is in, for an NPC left lying there: { bq, br, floor } (null out on the street). */
    _room() {
        const b = InnerMap._insideBuilding;
        return b ? { bq: b.q, br: b.r, floor: InnerMap._floor || 0 } : null;
    },

    /** Mark someone left lying where they are (indoors: in that room, not out on the street). */
    markLying(npc) {
        if (npc) npc._lyingIn = this._room();
    },

    /** Is this NPC lying senseless in the room the player is in (or out on the street with them)? */
    lyingHere(npc) {
        const L = npc && npc._lyingIn;
        const room = this._room();
        if (!L) return !room;
        return !!room && L.bq === room.bq && L.br === room.br && L.floor === room.floor;
    },

    // ──────────── PICK UP, PUT DOWN ────────────

    /** Heave a senseless (or bound) NPC up over the shoulder — or, opts.drag, haul them along the ground by the heels. */
    pickUp(game, npc, opts = {}) {
        const chk = Carrying.canPickUp(npc, { handsFull: this.handsFull(), playerOut: InnerMapCombat.playerKnockedOut() });
        if (!chk.ok) {
            _note(game, '🙌 Can\'t lift them', chk.reason === 'hands full' ? 'Your hands are full.' : `You can't pick ${npc ? npc.name : 'them'} up just now.`, 'warning');
            return false;
        }
        this._game = game;
        this.person = npc;
        npc._carried = true;
        npc._dragged = !!opts.drag;
        this._trail = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        npc._lyingIn = null;
        npc._koBed = null;
        npc.path = null;
        npc.moveProgress = 0;
        // (a stable stand-in for the street's eyes: who has seen the player with them)
        npc._carryBody = { name: npc.name, type: npc.type, _npc: npc, _alive: true, at: _now(), key: InnerMapCombat._mapKey() };
        if (this._baseSpeed == null) this._baseSpeed = InnerMap._playerSpeed;
        InnerMap._playerSpeed = this._baseSpeed * (opts.drag ? Downed.dragSpeed() : Carrying.speedFactor(game && game.player, npc));
        if (opts.drag) { npc.q = npc.prevQ = npc.targetQ = npc.q; } else this._follow();
        if (opts.drag) _note(game, '🦶 Dragging', `You take ${npc.name} by the heels and haul them along the ground.`, 'info');
        else _note(game, '🚶 Over your shoulder', `You heave ${npc.name} up over your shoulder. Anyone who sees you will wonder why.`, 'info');
        return true;
    },

    /** Is (q, r) a free tile to lay someone on? */
    _freeTile(q, r) {
        const t = InnerMap.getTile(q, r);
        if (!t || !t.subTerrain || !t.subTerrain.passable || t._isDoor || t._stairs || t._furniture && !t._furniture.passable) return false;
        if (t.building || t.customObject || t.customObjectPart) return false;
        if (q === InnerMap.playerInnerQ && r === InnerMap.playerInnerR) return false;
        return !(InnerMap.npcs || []).some(n => n !== this.person && n.q === q && n.r === r && n.state !== 'gone');
    },

    /** Set them down beside the player, still senseless. Returns the spot, or null. */
    putDown(game, prefer = null) {
        const npc = this.person;
        if (!npc) return null;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const spot = Carrying.dropSpot(pq, pr, (q, r) => this._freeTile(q, r), prefer)
            || { q: pq, r: pr };   // (no room about them: at their feet)
        this._release(npc, spot);
        _note(game, '⬇️ Put down', `You lay ${npc.name} down on the ground.`, 'info');
        return spot;
    },

    /** Lay them in a bed beside the player (or the one clicked). */
    layInBed(game, prefer = null) {
        const npc = this.person;
        if (!npc) return null;
        const bed = this.bedNear(prefer);
        if (!bed) { _note(game, '🛏️ No bed', 'There is no free bed within reach.', 'warning'); return null; }
        this._release(npc, bed);
        npc._koBed = { q: bed.q, r: bed.r };
        _note(game, '🛏️ Laid in bed', `You lay ${npc.name} in the bed and draw the blanket over them. They sleep on, senseless.`, 'info');
        return bed;
    },

    /** A free bed beside the player (or `prefer`, the bed clicked). */
    bedNear(prefer = null) {
        if (!InnerMap._insideBuilding) return null;
        const furnitureAt = (q, r) => { const t = InnerMap.getTile(q, r); return t && t._furniture; };
        const occupied = (q, r) => (InnerMap.npcs || []).some(n => n !== this.person && n.q === q && n.r === r && (n._asleep || n._koBed || n.state === 'unconscious'));
        return Carrying.bedSpot(InnerMap.playerInnerQ, InnerMap.playerInnerR, furnitureAt, occupied, prefer);
    },

    /** Let go of them without setting them anywhere (into a hole: ui/innerMapDowned.js). */
    letGo() {
        const npc = this.person;
        if (!npc) return null;
        npc._carried = false;
        npc._dragged = false;
        npc._carryBody = null;
        this.person = null;
        if (this._baseSpeed != null) { InnerMap._playerSpeed = this._baseSpeed; this._baseSpeed = null; }
        return npc;
    },

    _release(npc, spot) {
        npc._carried = false;
        npc._dragged = false;
        npc._carryBody = null;
        npc.q = npc.prevQ = npc.targetQ = spot.q;
        npc.r = npc.prevR = npc.targetR = spot.r;
        npc.path = null;
        npc.moveProgress = 0;
        if (npc._ko) { npc._ko.at = _now(); npc._ko.side = spot.q < InnerMap.playerInnerQ ? -1 : 1; }
        this.markLying(npc);
        // Indoors: they stay with the town, lying in this room (the room's list goes when the player leaves)
        const outer = InnerMap._outerMapState && InnerMap._outerMapState.npcs;
        if (outer && !outer.includes(npc)) outer.push(npc);
        this.person = null;
        if (this._baseSpeed != null) { InnerMap._playerSpeed = this._baseSpeed; this._baseSpeed = null; }
    },

    // ──────────── HANDED TO THE WATCH ────────────

    /**
     * Lay the one carried in the gaol's cells (systems/carrying.js handOver): someone with a deed
     * against them is a citizen's arrest — the gaoler locks them up, the player is thanked; anyone
     * else is a kidnapping — the gaoler cuts them loose and the player is taken for it.
     * @returns {'arrest'|'kidnapping'|null}
     */
    handOver(game) {
        const npc = this.person;
        if (!npc || !game || !(InnerMap.inJail && InnerMap.inJail()) || InnerMap.jailLocked()) return null;
        const player = game.player, world = game.world;
        const day = (world && world.day) || 0;
        const wt = InnerMap.currentWorldTile || {};
        const settlement = (InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement) || wt.settlement || null;
        const vuid = StreetCrime.npcKey(npc);
        const npcCrime = settlement && Array.isArray(settlement.npcCrimes)
            ? settlement.npcCrimes.find(c => (c.byKey && c.byKey === vuid) || (npc._person && c.byPid != null && c.byPid === npc._person.id)) || null : null;
        const v = Carrying.handOver(npc, { npcCrime, seed: day });
        const H = Carrying.config().handOver;
        const gaoler = (InnerMap.npcs || []).find(n => n._gaoler && n.state !== 'unconscious' && n.state !== 'gone');
        if (gaoler && v.line) InnerMapReactions.bark(gaoler, v.line, 4);
        // Off the shoulder
        npc._carried = false;
        npc._dragged = false;
        npc._carryBody = null;
        this.person = null;
        if (this._baseSpeed != null) { InnerMap._playerSpeed = this._baseSpeed; this._baseSpeed = null; }
        if (v.verdict === 'arrest') {
            // Behind the bars: gone from the street (the town deals its people again on the next visit)
            npc._ko = null;
            npc._lyingIn = null;
            npc._handedToWatch = day;
            npc.state = 'gone';
            const A = H.arrest || {};
            if (player) {
                player.reputation = (player.reputation || 0) + (Number(A.reputation) || 0);
                player.karma = Math.min(100, (player.karma || 0) + (Number(A.karma) || 0));
            }
            _note(game, "⛓️ A citizen's arrest", `${gaoler ? gaoler.name : 'The gaoler'} takes ${npc.name} into the cells. ${v.why}`, 'success');
            return 'arrest';
        }
        // A kidnapping: the captive cut loose, the player taken
        npc._bound = false;
        npc._gagged = false;
        npc._ko = null;
        npc._lyingIn = null;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const spot = Carrying.dropSpot(pq, pr, (q, r) => this._freeTile(q, r)) || { q: pq, r: pr };
        npc.q = npc.prevQ = npc.targetQ = spot.q;
        npc.r = npc.prevR = npc.targetR = spot.r;
        npc.state = 'idle';
        npc.idleTimer = 2;
        npc._broke = true;
        NpcDisposition.adjustDisposition(npc, Number((H.kidnapping || {}).disposition) || -60, player);
        if (player && world) {
            Underworld.recordCrime(player, world, 'kidnapping', {
                kingdom: settlement ? settlement.kingdom : null, caught: true, q: wt.q, r: wt.r,
                victim: { name: npc.name || 'someone', type: npc.type || 'villager', icon: npc.icon },
            });
        }
        const arrest = player && world && settlement && !StreetCrime.aboveLaw(player, world, settlement)
            ? Underworld._arrest(player, world, settlement, 'kidnapping') : null;
        _note(game, '🚨 Kidnapping', `${v.why} The gaoler cuts ${npc.name} loose.${arrest ? ` ${arrest.text}` : ' He knows better than to lay hands on you.'}`, 'error');
        if (arrest && typeof game.enterJailMap === 'function') {
            game.enterJailMap().then(ok => { if (!ok && InnerMap.active && typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true }); });
        }
        return 'kidnapping';
    },

    // ──────────── COMING ROUND ────────────

    /** They come round over the player's shoulder: kick free, set down beside them, in fear or anger. */
    wakeOnShoulder(npc, game) {
        if (npc !== this.person) { npc._carried = false; return; }
        // Tied up: they wake where they are, and can do nothing but shout (ui/innerMapDowned.js)
        if (npc._bound) {
            npc._ko = null;
            npc.state = 'bound';
            const r = Carrying.struggle(npc, `${(game && game.world && game.world.day) || 0}`);
            if (r.bark) InnerMapReactions.bark(npc, r.bark, 4);
            _note(game, '💢 They come round', `${npc.name} wakes ${npc._dragged ? 'as you drag them' : 'over your shoulder'} and thrashes against the rope, but can't get free.`, 'warning');
            return;
        }
        const ko = npc._ko || {};
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const spot = Carrying.dropSpot(pq, pr, (q, r) => this._freeTile(q, r)) || { q: pq, r: pr };
        this._release(npc, spot);
        npc._ko = null;
        npc._lyingIn = null;
        npc.state = InnerMap._insideBuilding ? 'inside_building' : 'idle';
        if (InnerMap._insideBuilding) { npc._insideBuildingQ = InnerMap._insideBuilding.q; npc._insideBuildingR = InnerMap._insideBuilding.r; }
        npc.idleTimer = 2;
        const hp = InnerMapCombat._npcHealth.get(npc.id);
        if (hp) {
            hp.current = Math.max(1, Math.round(hp.max * (ko.hpShare || 0.25)));
            if (npc._person) Townsfolk.injure(npc._person, InnerMapCombat._day(game), hp.current, hp.max);
        }
        const day = (game && game.world && game.world.day) || 0;
        const r = Carrying.struggle(npc, `${day}`);
        npc.mood = r.mood;
        npc._broke = r.mood === 'fear';
        if (r.bark) InnerMapReactions.bark(npc, r.bark, 4);
        // They know who had them over their shoulder
        NpcDisposition.adjustDisposition(npc, -15, game && game.player);
        const incident = npc._incidentId != null && game && game.player ? StreetCrime._incident(game.player, npc._incidentId) : null;
        if (r.mood === 'anger') InnerMapReactions._respond(npc, 'fight', incident);
        else InnerMapReactions._flee(npc, { indoors: !!InnerMap._insideBuilding });
        _note(game, '💢 They come round', `${npc.name} wakes over your shoulder and ${r.mood === 'anger' ? 'fights free, furious' : 'struggles free in terror'}.`, 'warning');
    },

    /** Come round where they were laid (a bed, a room): up beside it, about the house again. */
    wokeWhereLaid(npc) {
        if (npc._koBed) {
            const bed = npc._koBed;
            npc._koBed = null;
            const spot = Carrying.dropSpot(bed.q, bed.r, (q, r) => this._freeTile(q, r));
            if (spot) { npc.q = npc.prevQ = npc.targetQ = spot.q; npc.r = npc.prevR = npc.targetR = spot.r; }
        }
        const L = npc._lyingIn;
        npc._lyingIn = null;
        // (one of those inside: when the player goes out, they stay in, not out on the street)
        if (L) { npc._insideBuildingQ = L.bq; npc._insideBuildingR = L.br; npc.state = 'inside_building'; }
    },

    // ──────────── EACH FRAME ────────────

    /** Each frame, from the game loop: keep the carried on the player's map and shoulder. */
    update(deltaTime, game) {
        this._game = game;
        // Those left lying in a room the player is not in come round in their own time, out of sight
        this._wakeOutOfSight(game);
        const npc = this.person;
        if (!npc) return;
        if (!InnerMap.active || InnerMapCombat.playerKnockedOut()) {
            // Off the map (to the world, a battle, the cells) or the player out cold: they are let go
            // (the town's people are dealt again from its roster on the next visit)
            if (InnerMap.active && InnerMapCombat.playerKnockedOut()) { this.putDown(game); return; }
            this.reset();
            return;
        }
        this._follow();
    },

    /** The carried NPC is on the player's map and tile: through doors and up stairs with them. */
    _follow() {
        const npc = this.person;
        if (!npc) return;
        const list = InnerMap.npcs || (InnerMap.npcs = []);
        if (!list.includes(npc)) {
            // (the street's list while indoors, the room's when back out: in one place only)
            const outer = InnerMap._outerMapState && InnerMap._outerMapState.npcs;
            if (outer) { const i = outer.indexOf(npc); if (i >= 0) outer.splice(i, 1); }
            list.push(npc);
        }
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        if (npc._dragged) {
            // Hauled along behind: on the tile the player has just left (a fresh map: at their feet)
            const tr = this._trail;
            if (!tr || Math.max(Math.abs(tr.q - pq), Math.abs(tr.r - pr)) > 1) this._trail = { q: pq, r: pr };
            else if (tr.q !== pq || tr.r !== pr) {
                npc.q = npc.prevQ = npc.targetQ = tr.q;
                npc.r = npc.prevR = npc.targetR = tr.r;
                this._trail = { q: pq, r: pr };
            }
            if (Math.max(Math.abs(npc.q - pq), Math.abs(npc.r - pr)) > 1) { npc.q = npc.prevQ = npc.targetQ = pq; npc.r = npc.prevR = npc.targetR = pr; }
        } else {
            npc.q = npc.prevQ = npc.targetQ = pq;
            npc.r = npc.prevR = npc.targetR = pr;
        }
        npc.path = null;
        npc.moveProgress = 0;
        if (npc._carryBody) { npc._carryBody.q = pq; npc._carryBody.r = pr; npc._carryBody.key = InnerMapCombat._mapKey(); }
        // Walked into the room they were left lying in: there they still lie
        this._bringLyingIn();
    },

    /** Indoors: those left lying in this room are in it (they are not among those inside on their feet). */
    _bringLyingIn() {
        const outer = InnerMap._outerMapState && InnerMap._outerMapState.npcs;
        if (!outer || !InnerMap._insideBuilding) return;
        const list = InnerMap.npcs;
        for (const n of outer) {
            if (n.state === 'unconscious' && n._lyingIn && !list.includes(n) && this.lyingHere(n)) list.push(n);
        }
    },

    _wakeOutOfSight(game) {
        // Indoors: the room's own are brought in (and wake by InnerMapCombat._updateKnockedOut)
        if (InnerMap._insideBuilding) this._bringLyingIn();
        const outer = InnerMap._insideBuilding ? (InnerMap._outerMapState && InnerMap._outerMapState.npcs) : InnerMap.npcs;
        if (!outer) return;
        const now = _now();
        for (const n of outer) {
            if (n.state !== 'unconscious' || !n._lyingIn || !n._ko || now < n._ko.until || this.lyingHere(n)) continue;
            // Come round in the room they were left in: about the house, as anyone inside it is
            const L = n._lyingIn;
            n._ko = null;
            n._lyingIn = null;
            n._koBed = null;
            n.state = 'inside_building';
            n._insideBuildingQ = L.bq;
            n._insideBuildingR = L.br;
            n.idleTimer = 2;
            n._broke = true;
            NpcDisposition.adjustDisposition(n, -10, game && game.player);
        }
    },

    // ──────────── THE MENU ────────────

    /** Menu entries: pick up someone senseless here; put down / lay in bed what the player carries. */
    menuItems(game, tile, q, r, npcsHere) {
        const out = [];
        const npc = this.person;
        if (npc) {
            out.push({ type: 'header', label: `${npc._dragged ? '🦶 Dragging' : '🚶 Carrying'} ${npc.name} (${Downed.label(npc) || 'awake'})` });
            const bed = tile && tile._furniture && tile._furniture.type === 'bed' ? this.bedNear({ q, r }) : this.bedNear();
            if (bed) out.push({ type: 'action', action: 'carry_lay_bed', label: 'Lay Them on the Bed', icon: '🛏️', desc: 'In the bed, under the blanket, still senseless', q: bed.q, r: bed.r });
            out.push({ type: 'action', action: npc._dragged ? 'carry_put_down' : 'carry_put_down', label: npc._dragged ? 'Let Go of Them' : 'Put Them Down', icon: '⬇️', desc: 'Set them on the ground beside you', q, r });
            // In the town's gaol (a visitor, not locked in): lay them in a cell — the watch takes them
            if (InnerMap.inJail && InnerMap.inJail() && !InnerMap.jailLocked()) {
                out.push({ type: 'action', action: 'carry_hand_over', label: 'Lay Them in a Cell', icon: '⛓️', desc: npc._bound ? "Hand your captive to the gaoler: a citizen's arrest, if they have done wrong" : "Hand them to the gaoler: a citizen's arrest, if they have done wrong" });
            }
        }
        for (const n of (npcsHere || []).filter(x => Downed.isDown(x) && !x._carried).slice(0, 2)) {
            if (this.handsFull()) out.push({ type: 'disabled', label: `Pick Up ${n.name}: your hands are full` });
            else out.push({ type: 'action', action: 'ko_carry', label: 'Pick Them Up', icon: '🚶', desc: 'Carry them over your shoulder (you walk slower, hands full)', npc: n });
        }
        return out;
    },

    /** Handle a carry order. Returns true when it was one. */
    handle(game, item) {
        switch (item.action) {
            case 'ko_carry': {
                const npc = item.npc;
                const act = () => { if (npc && Downed.isDown(npc) && !npc._carried) this.pickUp(game, npc); };
                if (npc && _cheb(npc.q, npc.r, InnerMap.playerInnerQ, InnerMap.playerInnerR) <= 1) { act(); return true; }
                const res = npc ? InnerMap.approachAndThen(npc.q, npc.r, act) : 'unreachable';
                if (res === 'unreachable') _note(game, 'Blocked', `You can't reach ${npc ? npc.name : 'them'}.`, 'error');
                return true;
            }
            case 'carry_put_down': this.putDown(game, item.q != null ? { q: item.q, r: item.r } : null); return true;
            case 'carry_lay_bed': this.layInBed(game, item.q != null ? { q: item.q, r: item.r } : null); return true;
            case 'carry_hand_over': this.handOver(game); return true;
            default: return false;
        }
    },
};
