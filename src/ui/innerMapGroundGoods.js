// ============================================
// INNER MAP — goods on the ground, as the world keeps them
// ============================================
// The street map's half of systems/groundGoods.js. What lies on a hex is the
// world's (world.groundGoods, saved); the street map is drawn afresh, so its
// piles are laid on it whenever its tiles change (entering the hex, a
// building's inside and back out, a new day) — each at the spot it was set
// down on, or the nearest clear ground (refuse in the street) — as a tile's
// groundItem carrying the pile's id (drawn as a sack or the good's own sprite,
// ui/innerMapLayers/entities.js).
//
// Setting goods down (the Inventory's Drop…, the hotbar's click on the
// ground) goes through dropAt; picking up (the ground's menu: all, one,
// half) through pickUp — someone else's goods just set down, with the owner
// about, are stolen (systems/containers.js stealGoods).
//
// Others take it here too: now and then a beggar, a ragpicker or a passer-by
// in reach walks to a pile, stoops a moment and carries it off (to the
// market, a house, their belly: GroundGoods.takeBy). The player sees it done
// to their own goods if they are near.
//
// Each frame from the game loop (update); no randomness of the shared RNG.

import { InnerMap } from '../world/innerMap.js';
import { GroundGoods } from '../systems/groundGoods.js';
import { Downed } from '../systems/downed.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { PlayerCoin } from '../player/playerCoin.js';

const _cheb = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _frac(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

function _note(game, title, text, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, kind);
}

const RING = [];
for (let d = 1; d <= 12; d++) {
    for (let dq = -d; dq <= d; dq++) for (let dr = -d; dr <= d; dr++) if (Math.max(Math.abs(dq), Math.abs(dr)) === d) RING.push([dq, dr]);
}

const BARKS = ['Finders keepers.', 'Nobody wants this, then.', 'Waste not.', 'That\'ll do me.', 'Left lying about…'];
const BACK_BARKS = ['There it is.', 'Still here, good.', 'Right, home with this.', 'Nobody\'s touched it.', 'Back to work.'];
// How a kind of pile shows (the street map's own words for it: ui/innerMapUI.js, innerMapDiving.js)
const KIND_PLACED = { meat: 'butcher', arrows: 'hunt', salvage: 'wreck' };
// Who in the street owns a set-down pile, by its kind
const OWNER_FIT = {
    stall: n => n.type === 'merchant' || (n._work && n._work.type === 'marketplace'),
    household: n => !!n._home && n.type !== 'traveler',
    harvest: n => n.type === 'farmer' || (n.activity && n.activity.type === 'field'),
    unload: n => n.job === 'carter' || n.job === 'caravan' || n.job === 'convoy' || n.type === 'traveler' || n.type === 'merchant',
    carter: n => n.job === 'carter' || n.job === 'caravan' || n.job === 'convoy' || n.type === 'traveler',
    camp: n => n.job === 'caravan' || n.job === 'convoy' || n.type === 'traveler',
};

export const InnerMapGroundGoods = {
    _tiles: null,
    _scanT: 0,
    _game: null,

    reset() { this._tiles = null; this._scanT = 0; },

    /** The world hex whose map is up, or null. */
    hex() {
        const w = InnerMap.currentWorldTile;
        return InnerMap.active && w && Number.isFinite(w.q) ? w : null;
    },

    /** Which inside a pile belongs to (a building's), or null out in the open. */
    insideKey() {
        const b = InnerMap._insideBuilding;
        return b ? `${b.type}_${b.q}_${b.r}` : null;
    },

    /** Clear ground a pile can lie on. */
    _clear(t) {
        if (!t || !t.subTerrain || t.subTerrain.passable === false || t._wet || t._sea) return false;
        if (t.building || t.buildingInfo || t.customObject || t.customObjectPart || t.groundItem || t._dug) return false;
        return true;
    },

    /** The nearest clear tile to (q, r) (itself first). */
    _clearNear(q, r) {
        const t0 = InnerMap.getTile(q, r);
        if (this._clear(t0)) return t0;
        for (const [dq, dr] of RING) {
            const t = InnerMap.getTile(q + dq, r + dr);
            if (this._clear(t)) return t;
        }
        return null;
    },

    /** The groundItem a pile shows as. */
    _itemOf(pile) {
        const base = pile.label || `${pile.refuse ? 'Spoiled ' : ''}${GroundGoods.nameOf(pile.good)}`;
        const gi = {
            itemId: pile.good,
            name: pile.label && pile.qty > 1 && !pile.gold ? `${base} ×${pile.qty}` : base,
            icon: pile.icon || GroundGoods.iconOf(pile.good),
            quantity: pile.qty,
            placedBy: KIND_PLACED[pile.kind] || (pile.by === 'player' ? 'player' : pile.claim ? 'owned' : 'left'),
            pileId: pile.id,
            refuse: !!pile.refuse,
        };
        if (pile.kind) gi.kind = pile.kind;
        if (pile.salvage) gi.salvage = pile.salvage;
        if (pile.gold) gi.gold = pile.gold;
        return gi;
    },

    /** The street NPC who owns a set-down pile (bound once, kept while they are on the map). */
    _ownerOf(pile, taken) {
        const c = pile.claim;
        if (!c || pile.by === 'player' || !c.kind) return null;
        const npcs = InnerMap.npcs || [];
        if (c.npcId != null) {
            const n = npcs.find(x => x && x.id === c.npcId);
            if (n) return n;
        }
        const fit = OWNER_FIT[c.kind] || (() => true);
        const ok = n => n && n.name && !Downed.isDown(n) && n.state !== 'gone' && n.type !== 'guard' && n.type !== 'child' && !n._isPlayerCompanion && !taken.has(n.id);
        let pool = npcs.filter(n => ok(n) && fit(n));
        if (!pool.length) pool = npcs.filter(ok);
        if (!pool.length) return null;
        pool.sort((a, b) => _frac(`${pile.id}|${a.id}`) - _frac(`${pile.id}|${b.id}`));
        const n = pool[0];
        if (!c.role) c.role = c.name || null;
        c.npcId = n.id;
        c.name = n.name;
        return n;
    },

    /** Where a set-down pile goes: by the owner's door (washing, firewood), else beside the owner. */
    _ownerSpot(pile, n) {
        const home = pile.claim && pile.claim.kind === 'household' && n._home && Number.isFinite(n._home.q) ? n._home : null;
        return home ? this._clearNear(home.q, home.r + 1) : this._clearNear(Math.round(n.q) + 1, Math.round(n.r));
    },

    /**
     * Lay `qty` of a good on a street-map tile as a world pile (butchered meat,
     * a spent arrow, wreck salvage: o.kind, o.by, o.label, o.icon, o.salvage,
     * o.gold, o.src) — kept with the world, rotting and taken as any pile.
     * → the pile, or null (no world hex up, or the hex is full)
     */
    lay(game, tile, good, qty, o = {}) {
        game = game || this._game;
        const hex = this.hex();
        if (!hex || !tile || !game || !game.world) return null;
        if (this._tiles !== InnerMap.tiles) this.bind(game);
        const inside = this.insideKey();
        const pile = GroundGoods.leave(game.world, hex.q, hex.r, good, qty, { ...o, spot: { q: tile.q, r: tile.r }, day: _num(game.world.day), inside });
        if (!pile) return null;
        tile.groundItem = this._itemOf(pile);
        return pile;
    },

    /** Lay the hex's piles on the map up (and take off any the world no longer has). */
    bind(game) {
        const hex = this.hex();
        this._tiles = InnerMap.tiles;
        if (game) this._game = game;
        if (!hex || !game || !game.world || !Array.isArray(InnerMap.tiles)) return;
        for (const row of InnerMap.tiles) for (const t of row || []) if (t && t.groundItem && t.groundItem.pileId) delete t.groundItem;
        const inside = this.insideKey();
        const w = InnerMap.width || (InnerMap.tiles[0] || []).length, h = InnerMap.height || InnerMap.tiles.length;
        const owners = new Set();
        const day = _num(game.world.day);
        for (const pile of GroundGoods.at(game.world, hex.q, hex.r)) {
            if ((pile.inside || null) !== inside) continue;
            // Someone's set down for the day: they stand about it (bound to a street NPC, by their door or beside them)
            if (!inside && GroundGoods.claimed(pile, day, null)) {
                const n = this._ownerOf(pile, owners);
                if (n) {
                    owners.add(n.id);
                    if (!pile.spot) { const t0 = this._ownerSpot(pile, n); if (t0) pile.spot = { q: t0.q, r: t0.r }; }
                }
            }
            let at = pile.spot;
            if (!at) {
                // Refuse in the street; anything else about the middle of the map
                const roads = InnerMap.roads || [];
                if (pile.refuse && roads.length) at = roads[Math.floor(_frac(`${pile.id}|road`) * roads.length) % roads.length];
                else at = { q: Math.floor(w / 2) + Math.floor(_frac(`${pile.id}|q`) * 9) - 4, r: Math.floor(h / 2) + Math.floor(_frac(`${pile.id}|r`) * 9) - 4 };
            }
            // (its own spot, the shallows too, while nothing else lies there; else the nearest clear ground)
            const own = pile.spot ? InnerMap.getTile(pile.spot.q, pile.spot.r) : null;
            const keep = own && !own.groundItem && own.subTerrain && (own.subTerrain.passable !== false || pile.kind === 'salvage') && !own.building && !own.buildingInfo && !own.customObject && !own.customObjectPart;
            const t = keep ? own : this._clearNear(at.q, at.r);
            if (!t) continue;
            pile.spot = { q: t.q, r: t.r };
            t.groundItem = this._itemOf(pile);
        }
    },

    /** Lay the hex's piles again and tell the player, once, what was taken while they were away. */
    onEnter(game) {
        this.bind(game);
        const hex = this.hex();
        const line = hex ? GroundGoods.goneLine(game.world, hex.q, hex.r) : '';
        if (line) _note(game, '🖐️ Gone', line, 'warning');
    },

    /** Where to set a good down beside the player: their own pile of it near, or clear ground near. */
    spotBeside(itemId) {
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        if (!Number.isFinite(pq) || !Number.isFinite(pr)) return null;
        let free = null;
        for (const [dq, dr] of RING.slice(0, 24)) {
            const t = InnerMap.getTile(pq + dq, pr + dr);
            if (!t) continue;
            const gi = t.groundItem;
            if (gi && gi.pileId && gi.itemId === itemId && gi.placedBy === 'player' && !gi.kind) return t;
            if (!free && this._clear(t)) free = t;
        }
        return free;
    },

    /**
     * Set `qty` of a good down on the street map, at (q, r) or beside the
     * player. → { ok, n, pile, tile, reason }
     */
    dropAt(game, itemId, qty, q = null, r = null) {
        const hex = this.hex();
        if (!hex) return { ok: false, reason: 'There is no ground here to set it on.' };
        let tile;
        if (q != null) {
            tile = InnerMap.getTile(q, r);
            if (!tile) return { ok: false, reason: 'There is no ground there.' };
            const gi = tile.groundItem;
            if (gi && !(gi.pileId && gi.itemId === itemId && gi.placedBy === 'player' && !gi.kind)) return { ok: false, reason: 'Something lies there already.' };
            // (a click on the shallows sets it afloat there: drawn bobbing, ui/innerMapLayers/entities.js)
            const settable = tile.subTerrain && tile.subTerrain.passable !== false && !tile.building && !tile.buildingInfo && !tile.customObject && !tile.customObjectPart;
            if (!gi && !settable) return { ok: false, reason: 'There is no clear ground there to set it on.' };
        } else {
            tile = this.spotBeside(itemId);
            if (!tile) return { ok: false, reason: 'There is no clear ground beside you to set it on.' };
        }
        if (this._tiles !== InnerMap.tiles) this.bind(game);
        const inside = this.insideKey();
        const b = InnerMap._insideBuilding;
        const own = !!(b && (b.isPlayerOwned || b.isPlayerProperty || b.ownerId === 'player'));
        const res = GroundGoods.drop(game.world, game.player, itemId, qty, { q: hex.q, r: hex.r, spot: { q: tile.q, r: tile.r }, day: _num(game.world.day), inside, insideOwn: own });
        if (!res.ok) return res;
        // (a house standing empty, to let: nobody lives there to take it in)
        if (b && b._vacancy && !b.ownerId && res.pile) res.pile.insideVacant = true;
        tile.groundItem = this._itemOf(res.pile);
        return { ...res, tile };
    },

    /** Who sees the spot: { witnesses, guards, hour } for the theft roll. */
    _scene(q, r) {
        let witnesses = 0, guards = 0;
        for (const n of InnerMap.npcs || []) {
            if (!n || Downed.isDown(n) || n._asleep || n.state === 'inside_building' || n.state === 'gone') continue;
            if (_cheb(n.q, n.r, q, r) > 6) continue;
            if (n.type === 'guard') guards++; else witnesses++;
        }
        return { witnesses, guards, hour: _num(InnerMap.timeOfDay, 12) };
    },

    /** Pick up `qty` of the pile on tile (q, r) (null: all). → the result, told to the player */
    pickUp(game, q, r, qty = null) {
        const hex = this.hex();
        const tile = InnerMap.getTile(q, r);
        const gi = tile && tile.groundItem;
        if (!hex || !gi || !gi.pileId) return { ok: false, reason: 'There is nothing there.' };
        const pile = GroundGoods.find(game.world, hex.q, hex.r, gi.pileId);
        if (!pile) { delete tile.groundItem; return { ok: false, reason: 'It is gone.' }; }
        const day = _num(game.world.day);
        const ownerNear = this.ownerNear(game, pile, q, r);
        const res = GroundGoods.pickUp(game.world, game.player, hex.q, hex.r, pile.id, qty == null ? pile.qty : qty, { day, ownerNear, scene: this._scene(q, r) });
        const left = GroundGoods.find(game.world, hex.q, hex.r, pile.id);
        if (left) tile.groundItem = this._itemOf(left); else delete tile.groundItem;
        // (a wreck's strongbox was in no purse the books count: salvage, found)
        if (res.ok && res.gold > 0) PlayerCoin.found(game.world, game.player, res.gold, 'salvage', 'exploration');
        if (res.ok) _note(game, `${gi.icon || '📦'} ${gi.kind === 'salvage' ? 'Salvage' : 'Picked Up'}`, res.text, 'success');
        else _note(game, res.theft ? '🚨 Caught' : '🎒 Pick Up', res.text || res.reason, res.theft ? 'error' : 'warning');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        return res;
    },

    /** Is the owner of a pile someone set down about it (within ownerSight, up and awake)? */
    ownerNear(game, pile, q, r) {
        if (!GroundGoods.claimed(pile, _num(game.world.day))) return false;
        const C = GroundGoods.config();
        const c = pile.claim;
        const name = c.name || pile.byName;
        return (InnerMap.npcs || []).some(n => n && !Downed.isDown(n) && !n._asleep && n.state !== 'inside_building' && n.state !== 'gone'
            && (c.npcId != null ? n.id === c.npcId : (n.name && name && String(name).startsWith(n.name)))
            && _cheb(n.q, n.r, q, r) <= _num(C.ownerSight, 8));
    },

    /** The ground's menu for a pile on (q, r). */
    menuItems(game, q, r) {
        const hex = this.hex();
        const tile = InnerMap.getTile(q, r);
        const gi = tile && tile.groundItem;
        if (!hex || !gi || !gi.pileId) return [];
        const pile = GroundGoods.find(game.world, hex.q, hex.r, gi.pileId);
        if (!pile) return [];
        const theirs = GroundGoods.claimed(pile, _num(game.world.day));
        const near = theirs && this.ownerNear(game, pile, q, r);
        const who = theirs ? `${pile.claim.name || pile.byName || 'Someone'}${pile.claim.role && pile.claim.role !== pile.claim.name ? ` (${pile.claim.role})` : ''}` : '';
        const whose = pile.kind === 'salvage' ? 'Wreckage on the water: swim or wade out to it and haul it in'
            : pile.by === 'player' ? (pile.kind === 'meat' ? 'Yours: butchered here, and it will not keep' : pile.kind === 'arrows' ? 'Yours: a spent shot, whole' : 'Yours: set down here')
                : pile.refuse ? 'Thrown out in the street: anyone\'s for the taking'
                    : theirs ? (near ? `${who} set this down and is close by: taking it is theft` : `${who} set this down and has stepped away: no one is watching it`)
                        : 'Left lying here: anyone\'s for the taking';
        const out = [{ type: 'header', label: `${gi.icon} ${gi.name}${pile.label ? '' : ` ×${pile.qty}`}` }];
        if (pile.gold) {
            out.push({ type: 'action', action: 'gg_pickup', label: `Salvage ${gi.name}`, icon: '⚓', desc: whose, ggQ: q, ggR: r, ggQty: null });
            return out;
        }
        const verb = pile.kind === 'salvage' ? 'Salvage' : theirs ? 'Take' : 'Pick Up';
        out.push({ type: 'action', action: 'gg_pickup', label: pile.qty > 1 ? `${verb} All (${pile.qty})` : `${verb} ${gi.name}`, icon: pile.kind === 'salvage' ? '⚓' : theirs ? '🤏' : '🖐️', desc: whose, ggQ: q, ggR: r, ggQty: null });
        if (pile.qty > 1) out.push({ type: 'action', action: 'gg_pickup', label: `${verb} One`, icon: '☝️', desc: `Leave ${pile.qty - 1} on the ground`, ggQ: q, ggR: r, ggQty: 1 });
        if (pile.qty >= 4) out.push({ type: 'action', action: 'gg_pickup', label: `${verb} Half (${Math.floor(pile.qty / 2)})`, icon: '✌️', desc: 'Take half, leave half', ggQ: q, ggR: r, ggQty: Math.floor(pile.qty / 2) });
        return out;
    },

    /** Run a gg_ menu action → true when handled. */
    handle(game, item) {
        if (!item || item.action !== 'gg_pickup') return false;
        const go = () => this.pickUp(game, item.ggQ, item.ggR, item.ggQty);
        // (from where you stand if it is in reach; else walk over first)
        if (_cheb(InnerMap.playerInnerQ, InnerMap.playerInnerR, item.ggQ, item.ggR) <= 1 || typeof InnerMap.approachAndThen !== 'function') go();
        else if (InnerMap.approachAndThen(item.ggQ, item.ggR, go) === 'unreachable') go();
        return true;
    },

    // ══════════════════════════════════════════════
    // SCAVENGERS AT A PILE
    // ══════════════════════════════════════════════

    _freeNpc(n) {
        return !!n && !Downed.isDown(n) && n.state !== 'gone' && n.state !== 'inside_building' && n.state !== 'leaving_building'
            && !n._dialogFrozen && !n._carried && !n._asleep && !n._scav && !n._graveRobber && !n._gg && n.type !== 'guard' && !n._isPlayerCompanion;
    },

    _walkBeside(n, q, r) {
        if (_cheb(n.q, n.r, q, r) <= 1) return true;
        for (const [dq, dr] of RING.slice(0, 8)) {
            const t = InnerMap.getTile(q + dq, r + dr);
            if (!t || !t.subTerrain || !t.subTerrain.passable || t.building || t.customObject) continue;
            if (_cheb(n.q, n.r, t.q, t.r) === 0) return true;
            const path = InnerMap._findPath ? InnerMap._findPath(n.q, n.r, t.q, t.r) : null;
            if (!path || path.length < 2) continue;
            n.path = path.slice(1);
            n.pathIndex = 0;
            n.moveProgress = 0;
            n.prevQ = n.q;
            n.prevR = n.r;
            n.state = 'walking';
            n.departing = false;
            n._targetBuilding = null;
            return true;
        }
        return false;
    },

    _release(n) {
        n._gg = null;
        n._dialogFrozen = false;
        n.activity = null;
    },

    /** Each frame: piles laid when the map changes; a finder or two at work. */
    update(dt, game) {
        if (!game || !game.world || !InnerMap.active) return;
        this._game = game;
        try {
            if (this._tiles !== InnerMap.tiles) this.bind(game);
            if (InnerMap._insideBuilding) return;
            this._updateFinders(dt, game);
        } catch (e) { /* a finder never stops the game */ }
    },

    _updateFinders(dt, game) {
        const hex = this.hex();
        if (!hex) return;
        const C = GroundGoods.config();
        const day = _num(game.world.day);
        for (const n of InnerMap.npcs || []) {
            const job = n._gg;
            if (!job) continue;
            const tile = InnerMap.getTile(job.q, job.r);
            const gi = tile && tile.groundItem;
            if (!gi || gi.pileId !== job.pileId || Downed.isDown(n)) { this._release(n); continue; }
            if (job.phase === 'go') {
                if (_cheb(n.q, n.r, job.q, job.r) <= 1 && n.state !== 'walking') {
                    job.phase = 'stoop';
                    job.t = 0;
                    n.path = null;
                    n.state = 'idle';
                    n._dialogFrozen = true;
                    n.activity = { type: 'loot', anim: 'sitting' };
                    n.facing = InnerMapCharacters.getDirection(job.q - n.q, job.r - n.r);
                } else if (n.state !== 'walking' && (job.t += dt) > 4) {
                    job.t = 0;
                    if (++job.tries > 3 || !this._walkBeside(n, job.q, job.r)) this._release(n);
                }
                continue;
            }
            if ((job.t += dt) < _num(C.streetKneelSeconds, 2.5)) continue;
            this._take(game, n, job, tile, hex);
        }
        if ((this._scanT += dt) < _num(C.streetScanSeconds, 3)) return;
        this._scanT = 0;
        if ((InnerMap.npcs || []).some(n => n._gg)) return; // (one at a time)
        // An owner whose hour has come walks back for what they set down
        const hour = _num(InnerMap.timeOfDay, 12);
        for (const pile of GroundGoods.at(game.world, hex.q, hex.r)) {
            if (!pile.spot || pile.inside || !pile.claim || pile.claim.npcId == null || pile.by === 'player') continue;
            if (!GroundGoods.claimed(pile, day, null) || hour < _num(pile.claim.backHour, 16)) continue;
            const n = (InnerMap.npcs || []).find(x => x && x.id === pile.claim.npcId);
            if (!n || !this._freeNpc(n)) continue;
            n._gg = { pileId: pile.id, q: pile.spot.q, r: pile.spot.r, phase: 'go', t: 0, tries: 0, reclaim: true };
            if (!this._walkBeside(n, pile.spot.q, pile.spot.r)) { this._release(n); continue; }
            return;
        }
        const tile0 = game.world.getTile ? game.world.getTile(hex.q, hex.r) : null;
        const place = GroundGoods.placeOf(tile0);
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const slot = Math.floor(_num(InnerMap.timeOfDay, 12) * 60 / Math.max(1, _num(C.streetScanSeconds, 3)));
        for (const pile of GroundGoods.at(game.world, hex.q, hex.r)) {
            if (!pile.spot || (pile.inside || null) !== null || pile.gold) continue;
            if (GroundGoods.claimed(pile, day, null)) continue;
            // (your own just set down, with you standing by it: left alone)
            if (pile.by === 'player' && pile.day === day && _cheb(pq, pr, pile.spot.q, pile.spot.r) <= 10) continue;
            // The day's chance, spread over the scans of the hours folk are about (some 6 real minutes)
            const per = GroundGoods.takeChance(pile, place) * _num(C.streetScanSeconds, 3) / 360;
            if (_frac(`gg|${pile.id}|${day}|${slot}`) >= per) continue;
            const R = _num(C.streetRadius, 14);
            const near = (InnerMap.npcs || []).filter(n => this._freeNpc(n) && _cheb(n.q, n.r, pile.spot.q, pile.spot.r) <= R)
                .sort((a, b) => ((b.job === 'beggar') - (a.job === 'beggar')) || (_cheb(a.q, a.r, pile.spot.q, pile.spot.r) - _cheb(b.q, b.r, pile.spot.q, pile.spot.r)));
            const n = near[0];
            if (!n) continue;
            n._gg = { pileId: pile.id, q: pile.spot.q, r: pile.spot.r, phase: 'go', t: 0, tries: 0 };
            if (!this._walkBeside(n, pile.spot.q, pile.spot.r)) { this._release(n); continue; }
            break;
        }
    },

    _take(game, n, job, tile, hex) {
        if (job.reclaim) {
            const back = GroundGoods.reclaim(game.world, hex.q, hex.r, job.pileId);
            this._release(n);
            const left = GroundGoods.find(game.world, hex.q, hex.r, job.pileId);
            if (left) tile.groundItem = this._itemOf(left); else delete tile.groundItem;
            if (back) InnerMapReactions.bark(n, BACK_BARKS[Math.floor(_frac(`${n.id}|${job.pileId}|b`) * BACK_BARKS.length) % BACK_BARKS.length], 2.5);
            return;
        }
        const place = GroundGoods.placeOf(game.world.getTile ? game.world.getTile(hex.q, hex.r) : null);
        const res = GroundGoods.takeBy(game.world, hex.q, hex.r, job.pileId, null, { kind: place, name: n.name || null });
        this._release(n);
        const left = GroundGoods.find(game.world, hex.q, hex.r, job.pileId);
        if (left) tile.groundItem = this._itemOf(left); else delete tile.groundItem;
        if (!res) return;
        InnerMapReactions.bark(n, BARKS[Math.floor(_frac(`${n.id}|${job.pileId}`) * BARKS.length) % BARKS.length], 2.5);
        if (res.by === 'player' && _cheb(InnerMap.playerInnerQ, InnerMap.playerInnerR, job.q, job.r) <= 12) {
            _note(game, '🖐️ Your Goods', `${n.name || 'Someone'} picks up the ${GroundGoods.describe(res.good, res.n)} you left (${GroundGoods.whereWords(res)}).`, 'warning');
        }
    },
};
