// ============================================
// INNER MAP — fish traps set in the edge water
// ============================================
// The street map's half of systems/fishTraps.js. With a wicker fish trap in
// the packs, click the edge water by a bank — the shallows, or the water a
// cell off dry land, in a river, a lake, a pond or the sea — and Set a Fish
// Trap Here. Click it again (or beside it) to Bait the Trap from the packs,
// Haul Up the Trap and take the catch, Mend the Trap once the wicker has
// worn, or Take Up the Trap. The catch comes hour by hour (FishTraps.settle:
// brought up to the hour as the clock runs here, and by the day's tick away).
//
// At night a poacher may come to a trap with fish in it. Here you can see
// him crouched at it (drawn by ui/innerMapLayers/fishTraps.js): come within
// scareReach cells while he is there and he runs, the fish left.
//
//   update(game)                   each frame on the street map (ui/game/gameLoop.js)
//   menuItems(game, tile, q, r)    the trap entries for a clicked cell
//   handle(game, item, q, r)       'fishtrap_*'

import { InnerMap } from '../world/innerMap.js';
import { FishTraps } from '../systems/fishTraps.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { DayClock } from './game/dayClock.js';
import { CarriedLight } from '../systems/carriedLight.js';
import { LightSystem } from './lightSystem.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _iced = t => !!(t && t.subTerrain && (t.subTerrain.frozen || /frozen|ice/.test(t.subTerrain.id || '')));

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

function _goodName(id) {
    const g = (PlayerEconomy.GOODS || {})[String(id).toUpperCase()];
    return (g && g.name) || String(id).replace(/_/g, ' ');
}

export const InnerMapFishTraps = {
    _world: null,
    _lastHour: null,
    _nowH: 0,
    /** A poacher at one of your traps this hour: { trapId, hour, x, y } | null (drawn by the layer) */
    poacher: null,

    /** The world clock in hours */
    now(game) {
        const w = game && game.world;
        return (w && Number.isFinite(w.day) ? w.day : 0) * 24 + DayClock.now();
    },

    _hex() {
        const at = InnerMap.currentWorldTile;
        return at && Number.isFinite(at.q) ? { q: at.q, r: at.r } : null;
    },

    /** The traps on this map */
    here(world = this._world) {
        const hex = this._hex();
        return hex && world ? FishTraps.at(world, hex.q, hex.r) : [];
    },

    /** The street map's own ice for a trap on this map (else the world's reckoning) */
    _ctx() {
        const hex = this._hex();
        return {
            frozen: (trap) => {
                if (!hex || trap.q !== hex.q || trap.r !== hex.r) return null;
                const t = InnerMap.getTile ? InnerMap.getTile(trap.x, trap.y) : null;
                return t ? _iced(t) : null;
            },
        };
    },

    _settleHere(game) {
        const world = game && game.world;
        if (!world) return;
        const now = this.now(game);
        for (const trap of this.here(world).slice()) {
            for (const n of FishTraps.settle(world, trap, now, this._ctx()).notices) _note(game, `${n.icon} ${n.title}`, n.text, n.type);
        }
    },

    _playerDist(x, y) {
        return Math.max(Math.abs(x - InnerMap.playerInnerQ), Math.abs(y - InnerMap.playerInnerR));
    },

    /** Where a poacher would crouch: the dry cell next to the trap nearest the bank, else the trap */
    _bankBy(trap) {
        for (let d = 1; d <= 2; d++) {
            for (let dy = -d; dy <= d; dy++) {
                for (let dx = -d; dx <= d; dx++) {
                    const t = InnerMap.getTile(trap.x + dx, trap.y + dy);
                    if (t && !t._wet && !t._sea && t.subTerrain && t.subTerrain.passable && !t.building) return { x: trap.x + dx, y: trap.y + dy };
                }
            }
        }
        return { x: trap.x, y: trap.y };
    },

    /** Each frame on the street map: the traps here brought up to the hour; a poacher seen, and seen off */
    update(game) {
        if (!game || !game.world || !InnerMap.active || !FishTraps.config().enabled) { this.poacher = null; return; }
        this._world = game.world;
        if (!this.here(game.world).length) { this.poacher = null; return; }
        this._nowH = this.now(game);
        const hour = Math.floor(this._nowH);
        if (hour !== this._lastHour) {
            this._lastHour = hour;
            this._settleHere(game);
            this.poacher = null;
            for (const trap of this.here(game.world)) {
                if (FishTraps.poacherAt(game.world, trap, hour) >= 0 && trap.scared !== hour) {
                    const at = this._bankBy(trap);
                    this.poacher = { trapId: trap.id, hour, x: at.x, y: at.y };
                    break;
                }
            }
        }
        const P = this.poacher;
        if (P && !InnerMap._insideBuilding && !InnerMap._underwater) {
            const trap = FishTraps.find(game.world, P.trapId);
            if (!trap) { this.poacher = null; return; }
            // (a light carried at night: he sees it coming from far off — systems/carriedLight.js)
            const base = Math.max(1, _num(FishTraps.config().scareReach, 5));
            const reach = CarriedLight.scareReach(base, game.player, LightSystem.ambientDarkness);
            if (this._playerDist(trap.x, trap.y) <= reach) {
                FishTraps.scare(game.world, trap, P.hour);
                this.poacher = null;
                _note(game, '🧺 A Poacher', reach > base
                    ? 'Someone is crouched at your fish trap in the dark, arm in the water. He sees your light coming along the bank, lets it drop and runs off into the night. The fish are still in it.'
                    : 'Someone is crouched at your fish trap in the dark, arm in the water. He sees you, lets it drop and runs off into the night. The fish are still in it.', 'info');
            }
        }
    },

    // ── The menu ──

    menuItems(game, tile, q, r) {
        if (!game || !game.player || !game.world || !FishTraps.config().enabled) return [];
        if (InnerMap._insideBuilding || InnerMap._underwater) return [];
        const hex = this._hex();
        if (!hex) return [];
        this._world = game.world;
        const world = game.world, player = game.player;
        const trap = FishTraps.near(world, hex.q, hex.r, q, r, 1);
        const out = [];
        if (trap) {
            this._settleHere(game);
            if (!FishTraps.find(world, trap.id)) return out;
            const n = FishTraps.count(trap);
            const broken = FishTraps.isBroken(trap);
            const now = this.now(game);
            const baited = FishTraps.baited(trap, now);
            const state = `${broken ? ', fallen apart' : trap.wear >= 0.5 ? ', the wicker worn' : ''}${baited ? ', baited' : ''}`;
            if (n) out.push({ type: 'action', action: 'fishtrap_haul', icon: '🧺', trapId: trap.id, label: `Haul Up the Trap (${n})`, desc: `${FishTraps.isFull(trap) ? 'Full: it takes no more till emptied' : 'See what has swum in'}${state}. It goes back in the water.` });
            else out.push({ type: 'disabled', label: `🧺 Your trap is empty${state}` });
            if (!baited && !broken) {
                const baits = FishTraps.baitsInPacks(player);
                if (baits.length) {
                    for (const b of baits.slice(0, 3)) {
                        out.push({ type: 'action', action: 'fishtrap_bait', icon: '🪱', trapId: trap.id, bait: b.id, label: `Bait the Trap (${_goodName(b.id)})`, desc: `${b.what} in the mouth of it (×${b.have} in your packs): more fish come in for a day and a half` });
                    }
                } else out.push({ type: 'disabled', label: '🪱 Bait the Trap — nothing in your packs for bait (bread, meat, cheese, a small fry…)' });
            }
            if (trap.wear >= 0.5) {
                const cost = Object.entries(FishTraps.config().mendCost || {}).map(([g, k]) => `${k} ${_goodName(g).toLowerCase()}`).join(', ');
                out.push({ type: 'action', action: 'fishtrap_mend', icon: '🧶', trapId: trap.id, label: 'Mend the Trap', desc: `Weave in fresh wicker (${cost || 'nothing'})` });
            }
            out.push({ type: 'action', action: 'fishtrap_up', icon: '🧺', trapId: trap.id, label: 'Take Up the Trap', desc: 'Out of the water, catch and all, back into your packs' });
            return out;
        }
        if (!(tile && (tile._wet || tile._sea))) return out;
        if (!(_num((player.inventory || {}).fish_trap) >= 1)) return out;
        const spot = FishTraps.spotAt(InnerMap.tiles, q, r, { traps: this.here(world) });
        if (spot.ok) {
            out.push({ type: 'action', action: 'fishtrap_set', icon: '🧺', label: 'Set a Fish Trap Here', desc: spot.water === 'river' ? 'Weight it on the bed by the bank, mouth downstream: the fish running up the edge swim in' : 'Sink it in the edge water by the bank, a stake to mark it: come back and haul it up' });
        } else if (spot.why && spot.why !== 'not in water') {
            out.push({ type: 'disabled', label: `🧺 Set a Fish Trap — ${spot.why}` });
        }
        return out;
    },

    /** Walk within reach of (q, r) and then do it */
    _reachThen(game, q, r, fn) {
        const reach = Math.max(1, _num(FishTraps.config().reach, 2));
        if (this._playerDist(q, r) <= reach) { fn(); return; }
        const how = InnerMap.approachAndThen(q, r, () => {
            if (this._playerDist(q, r) <= reach + 0.5) fn();
            else _note(game, '🧺 Too Far', 'You can\'t get close enough to the trap.', 'warning');
        });
        if (how === 'unreachable') _note(game, '🧺 Too Far', 'You can\'t get to that water from here.', 'warning');
    },

    handle(game, item, q, r) {
        if (!item || !/^fishtrap_/.test(item.action || '')) return false;
        const world = game && game.world, player = game && game.player;
        if (!world || !player) return true;
        const refresh = () => { if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world); };
        if (item.action === 'fishtrap_set') {
            this._reachThen(game, q, r, () => {
                const hex = this._hex();
                if (!hex) return;
                const spot = FishTraps.spotAt(InnerMap.tiles, q, r, { traps: this.here(world) });
                const res = FishTraps.lay(world, player, hex.q, hex.r, q, r, spot, this.now(game));
                if (!res.ok) { _note(game, '🧺 Not Here', res.reason, 'warning'); return; }
                _note(game, '🧺 Trap Set', res.trap.water === 'river'
                    ? 'You weight the wicker trap on the bed by the bank, mouth downstream, and push a stake in beside it to mark it. Come back at dawn or dusk and see what has swum in.'
                    : 'You sink the wicker trap in the edge water and push a stake in beside it. Bait it, and come back in a day.', 'success');
                refresh();
            });
            return true;
        }
        const trap = item.trapId ? FishTraps.find(world, item.trapId) : null;
        if (!trap) { _note(game, '🧺 Gone', 'The trap is gone.', 'warning'); return true; }
        if (item.action === 'fishtrap_bait') {
            this._reachThen(game, trap.x, trap.y, () => {
                const res = FishTraps.bait(world, player, trap.id, item.bait, this.now(game));
                if (!res.ok) { _note(game, '🪱 Bait', res.reason, 'warning'); return; }
                _note(game, '🪱 Baited', `You lift the trap, push ${res.what} into it and let it down again.`, 'success');
                refresh();
            });
            return true;
        }
        if (item.action === 'fishtrap_haul') { this._reachThen(game, trap.x, trap.y, () => this._haul(game, trap.id, false)); return true; }
        if (item.action === 'fishtrap_up') { this._reachThen(game, trap.x, trap.y, () => this._haul(game, trap.id, true)); return true; }
        if (item.action === 'fishtrap_mend') {
            this._reachThen(game, trap.x, trap.y, () => {
                const res = FishTraps.mend(world, player, trap.id);
                if (!res.ok) { _note(game, '🧶 Mend', res.reason, 'warning'); return; }
                _note(game, '🧶 Mended', 'You weave fresh wicker into the torn sides. It will hold fish again.', 'success');
                refresh();
            });
            return true;
        }
        return false;
    },

    _haul(game, id, takeUp) {
        const world = game.world, player = game.player;
        this._settleHere(game);
        const res = takeUp ? FishTraps.takeUp(world, player, id, this.now(game)) : FishTraps.haul(world, player, id, this.now(game));
        if (!res.ok && !res.got) { _note(game, '🧺 Gone', res.reason || 'The trap is gone.', 'warning'); return; }
        const list = Object.entries(res.got || {}).map(([k, n]) => (n > 1 ? `${n} × ${_goodName(k)}` : _goodName(k))).join(', ');
        let text = list ? `You haul the dripping trap up: ${list}.` : 'You haul the trap up. Nothing in it but weed and water.';
        if (res.news && res.news.length) text += ` ${res.news.join(' ')}`;
        if (res.left) text += ` (${res.left} left in it: your packs are full.)`;
        if (res.ok && res.back === 'fish_trap') text += ' The trap is back in your packs.';
        else if (res.ok && res.back === 'reeds') text += ' It is past mending: only the reeds are worth keeping.';
        else if (!takeUp) text += ' You let it down again.';
        _note(game, '🧺 The Trap', text, list ? 'success' : 'info');
        if (!res.ok && res.reason) _note(game, '🧺 Not Yet', res.reason, 'warning');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
    },
};
