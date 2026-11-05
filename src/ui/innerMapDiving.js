// ============================================================
// INNER MAP — diving: under the water, swimming about the bottom
// ============================================================
// On water deep enough to swim in (world/innerMap/swimming.js), Dive Under
// (the right-click menu, or V while swimming) takes the player below the
// surface. Under the water they move by clicking as ever, but through water
// only (InnerMap._underwater keeps their paths off land and the shallows) and
// slower than a swim. Breath drains as they go (player/diving.js): a bar over
// their head, red when it runs low; out of it they hurt, and may black out,
// coming up with nothing they picked up on this dive. Surface (the menu, the
// toolbar button, or V again) brings them up where they are, breath full.
//
// The bottom of each map is scattered with finds once a day (Diving.bedFor,
// kept here by world hex), seen only from under the water (drawn by
// ui/innerMapLayers/underwater.js): swim onto one, or right-click it and
// Pick Up. What is taken stays taken until the next day.
//
// Tables and numbers in data/diving.json.

import { InnerMap } from '../world/innerMap.js';
import { Diving } from '../player/diving.js';
import { Swimming } from '../player/swimming.js';
import { Hotbar } from './hotbar.js';

const BTN_ID = 'innerMapSurfaceBtn';

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

function _worldTile(game) {
    const at = InnerMap.currentWorldTile;
    return game && game.world && at ? game.world.getTile(at.q, at.r) : null;
}

function _mapKey() {
    const at = InnerMap.currentWorldTile;
    return at ? `${at.q},${at.r}` : null;
}

function _day(game) {
    return (game && game.world && game.world.day) || 0;
}

export const InnerMapDiving = {
    // The bottoms of the maps dived today, by world hex: { [key]: { day, finds } }
    _beds: {},
    // Under the water: { game, tiles, key, bed }
    _under: null,
    _keysBound: false,

    /** Is the player under the water? */
    isUnder() {
        return !!this._under;
    },

    /** The bottom of the map the player is under (null on the surface). */
    bed() {
        return this._under ? this._under.bed : null;
    },

    /** Is there wreckage on or under the water near (q, r)? */
    nearWreck(q, r) {
        const R = Math.max(0, Diving.config().wreckRange | 0);
        for (let dr = -R; dr <= R; dr++) {
            for (let dq = -R; dq <= R; dq++) {
                const t = InnerMap.getTile(q + dq, r + dr);
                if (t && (t._wreckSite || (t.groundItem && t.groundItem.placedBy === 'wreck'))) return true;
            }
        }
        return false;
    },

    /** Every cell of this map a diver can reach the bottom of, with its water. */
    _cells() {
        const out = [];
        const tiles = InnerMap.tiles || [];
        // Wreck sites first, so their reach is cheap to ask
        const wrecks = [];
        for (let r = 0; r < tiles.length; r++) {
            for (let q = 0; q < (tiles[r] || []).length; q++) {
                const t = tiles[r][q];
                if (t && (t._wreckSite || (t.groundItem && t.groundItem.placedBy === 'wreck'))) wrecks.push([q, r]);
            }
        }
        const R = Math.max(0, Diving.config().wreckRange | 0);
        for (let r = 0; r < tiles.length; r++) {
            for (let q = 0; q < (tiles[r] || []).length; q++) {
                if (!InnerMap.isDivable(q, r)) continue;
                const w = Diving.waterOf(tiles[r][q]);
                const nearWreck = wrecks.some(([x, y]) => Math.abs(x - q) <= R && Math.abs(y - r) <= R);
                out.push({ q, r, kind: w.kind, deep: w.deep, nearWreck });
            }
        }
        return out;
    },

    /** The bottom of this map today (scattered on the first dive of the day). */
    _bedHere(game) {
        const key = _mapKey();
        if (!key) return null;
        const day = _day(game);
        return Diving.bedFor(this._beds, key, day, () => this._cells(), { seed: Diving.bedSeed(game.world, key, day), player: game.player });
    },

    // ══════════════════════════════════════════════
    // THE MENU
    // ══════════════════════════════════════════════

    /** The diving entries for a tile. */
    menuItems(game, tile, q, r) {
        if (!game || !game.player || InnerMap._insideBuilding || !tile) return [];
        const here = InnerMap.playerInnerQ === q && InnerMap.playerInnerR === r;
        if (this._under) {
            const items = [];
            const f = Diving.findAt(this._under.bed, q, r);
            if (f) items.push({ type: 'action', action: 'dive_pickup', label: `Pick Up ${f.name}${f.qty > 1 ? ` ×${f.qty}` : ''}`, icon: f.rare ? '✨' : f.icon, desc: here ? 'Off the bottom and into your packs' : 'Swim to it and take it' });
            items.push({ type: 'action', action: 'dive_surface', label: 'Surface', icon: '⬆️', desc: 'Up for air where you are (V)' });
            return items;
        }
        // On the deck: over the side, toward the water clicked (the hull walls the deck in)
        if (this.onDeck()) return InnerMap.isSwimmable(q, r) ? this._overboardItems(game, q, r) : [];
        const climb = this._climbItems(game);
        if (!InnerMap.isDivable(q, r)) return climb;
        const ok = Diving.canDive(game.player);
        if (!ok.ok) return [{ type: 'disabled', label: `🤿 Dive — ${ok.reason}` }, ...climb];
        const water = Diving.waterOf(tile);
        const where = `the ${water.deep ? 'deep ' : ''}${water.kind} floor`;
        const breath = Diving.breath(game.player);
        return [{
            type: 'action', action: 'dive_under', icon: '🤿',
            label: here ? 'Dive Under' : 'Dive Under Here',
            desc: `${here ? '' : 'Swim out, then '}go under and search ${where}: ${breath}s of breath (V)`,
        }, ...climb];
    },

    // ── Over the side of a ship, and back aboard ──

    /** Is the player standing on a ship's deck? */
    onDeck() {
        const t = InnerMap.getTile(InnerMap.playerInnerQ, InnerMap.playerInnerR);
        return !!(t && t._deck);
    },

    /** Is (q, r) part of a ship (her deck, her hull)? */
    isShipAt(q, r) {
        const t = InnerMap.getTile(q, r);
        if (!t) return false;
        if (t._deck) return true;
        const at = t.customObject ? t : t.customObjectPart ? InnerMap.getTile(t.customObjectPart.anchorQ, t.customObjectPart.anchorR) : null;
        const o = at && at.customObject;
        return !!(o && (o.aboard || o.playerShip || o.harbour || /^hull_/.test(String(o.defId || ''))));
    },

    /**
     * The water just off the ship's side nearest the player, leaning toward
     * (towardQ, towardR): the first ring of swimmable water (deep enough to go
     * under in, when `deep`) out from where they stand, past the hull.
     */
    overboardSpot(towardQ, towardR, deep = false) {
        const q0 = InnerMap.playerInnerQ, r0 = InnerMap.playerInnerR;
        const ok = (q, r) => (deep ? InnerMap.isDivable(q, r) : InnerMap.isSwimmable(q, r));
        for (let d = 1; d <= 8; d++) {
            let best = null, bestD = Infinity;
            for (let r = r0 - d; r <= r0 + d; r++) {
                for (let q = q0 - d; q <= q0 + d; q++) {
                    if (Math.max(Math.abs(q - q0), Math.abs(r - r0)) !== d || !ok(q, r)) continue;
                    const dt = Math.hypot(q - towardQ, r - towardR);
                    if (dt < bestD) { bestD = dt; best = { q, r }; }
                }
            }
            if (best) return best;
        }
        return null;
    },

    /** The deck within reach of a swimmer alongside (a stroke or two off her side), or null. */
    aboardSpot() {
        const q0 = InnerMap.playerInnerQ, r0 = InnerMap.playerInnerR;
        let best = null, bestD = Infinity;
        for (let r = r0 - 3; r <= r0 + 3; r++) {
            for (let q = q0 - 3; q <= q0 + 3; q++) {
                const t = InnerMap.getTile(q, r);
                if (!t || !t._deck || !t.subTerrain || !t.subTerrain.passable) continue;
                if ((InnerMap.npcs || []).some(n => n.q === q && n.r === r)) continue;
                const d = Math.hypot(q - q0, r - r0);
                if (d < bestD) { bestD = d; best = { q, r }; }
            }
        }
        return best;
    },

    _overboardItems(game, q, r) {
        const items = [];
        const swim = Swimming.canSwim(game.player);
        if (!swim.ok) return [{ type: 'disabled', label: `🌊 Over the Side — ${swim.reason}` }];
        const dive = Diving.canDive(game.player);
        if (dive.ok && this.overboardSpot(q, r, true)) {
            items.push({ type: 'action', action: 'dive_overboard', towardQ: q, towardR: r, label: 'Dive Over the Side', icon: '🤿', desc: `Off the rail and straight down: ${Diving.breath(game.player)}s of breath (V to come up)` });
        } else if (!dive.ok) {
            items.push({ type: 'disabled', label: `🤿 Dive Over the Side — ${dive.reason}` });
        }
        if (this.overboardSpot(q, r, false)) items.push({ type: 'action', action: 'dive_jump', towardQ: q, towardR: r, label: 'Jump Over the Side', icon: '🌊', desc: 'Into the sea beside her, to swim' });
        return items;
    },

    _climbItems(game) {
        if (this._under || !InnerMap.isPlayerSwimming() || !this.aboardSpot()) return [];
        return [{ type: 'action', action: 'dive_climb', label: 'Climb Aboard', icon: '⬆️', desc: 'Haul yourself up her side onto the deck' }];
    },

    /** The ship's own menu (her deck or hull clicked): over the side from the deck, aboard from the water. */
    shipItems(game, q, r) {
        if (!game || !game.player || InnerMap._insideBuilding || this._under || !this.isShipAt(q, r)) return [];
        if (this.onDeck()) return this._overboardItems(game, q, r);
        return this._climbItems(game);
    },

    /** Over the side: into the water off her rail, and under if `dive`. */
    goOverboard(game, towardQ, towardR, dive) {
        if (!this.onDeck()) return false;
        const spot = this.overboardSpot(towardQ, towardR, dive);
        if (!spot) { _note(game, '🌊 Over the Side', 'There is no clear water off her side here.', 'warning'); return false; }
        const swim = Swimming.canSwim(game.player);
        if (!swim.ok) { _note(game, '🌊 Over the Side', swim.reason, 'warning'); return false; }
        InnerMap.cancelPlayerWalk();
        InnerMap._pendingAction = null;
        InnerMap.playerInnerQ = spot.q;
        InnerMap.playerInnerR = spot.r;
        if (dive) {
            if (!this.goUnder(game)) return true;
            _note(game, '🤿 Over the Side', 'You climb the rail and dive. The sea closes over you, cold and green.');
        } else {
            _note(game, '🌊 Over the Side', 'You swing over the rail and drop into the sea with a splash. Swim, or press V to go under.');
        }
        return true;
    },

    /** Back up her side onto the deck. */
    climbAboard(game) {
        if (this._under) { _note(game, '⬆️ Climb Aboard', 'Come up for air first (V).', 'warning'); return false; }
        const spot = this.aboardSpot();
        if (!spot) { _note(game, '⬆️ Climb Aboard', 'Swim in close alongside her first.', 'warning'); return false; }
        InnerMap.cancelPlayerWalk();
        InnerMap._pendingAction = null;
        InnerMap.playerInnerQ = spot.q;
        InnerMap.playerInnerR = spot.r;
        _note(game, '⬆️ Aboard', 'You catch a line and haul yourself up her side onto the deck, streaming water.');
        return true;
    },

    /** Carry out a dive_* action at (q, r). Returns true when it was one. */
    handle(game, item, q, r) {
        const action = item.action || '';
        if (!/^dive_/.test(action)) return false;
        if (action === 'dive_surface') { this.surface(game); return true; }
        if (action === 'dive_overboard' || action === 'dive_jump') {
            this.goOverboard(game, item.towardQ != null ? item.towardQ : q, item.towardR != null ? item.towardR : r, action === 'dive_overboard');
            return true;
        }
        if (action === 'dive_climb') { this.climbAboard(game); return true; }
        if (action === 'dive_pickup') {
            if (!this._under) return true;
            if (InnerMap.playerInnerQ === q && InnerMap.playerInnerR === r) { this._takeHere(game); return true; }
            InnerMap.cancelPlayerWalk();
            const walk = InnerMap.movePlayerTo(q, r);
            if (!walk || !walk.started) _note(game, '🤿 Out of Reach', 'You can\'t swim to it from here without coming up.', 'warning');
            return true;
        }
        if (action === 'dive_under') {
            if (!InnerMap.isDivable(q, r)) { _note(game, '🤿 Dive', 'The water here is too shallow to go under.', 'warning'); return true; }
            const ok = Diving.canDive(game.player);
            if (!ok.ok) { _note(game, '🤿 Dive', ok.reason, 'warning'); return true; }
            if (InnerMap.playerInnerQ === q && InnerMap.playerInnerR === r && !InnerMap._playerWalking) {
                this.goUnder(game);
                return true;
            }
            // Swim out to the spot first
            InnerMap.cancelPlayerWalk();
            const walk = InnerMap.movePlayerTo(q, r);
            if (walk && walk.started) {
                InnerMap._pendingAction = { q, r, run: () => this.goUnder(game) };
            } else {
                _note(game, '🤿 Dive', (walk && walk.refused) || 'You can\'t swim out to that spot.', 'warning');
            }
            return true;
        }
        return false;
    },

    // ══════════════════════════════════════════════
    // UNDER AND UP
    // ══════════════════════════════════════════════

    /** Fill your lungs and go under, where you are. */
    goUnder(game) {
        if (this._under || !game || !game.player) return false;
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        if (InnerMap._insideBuilding || !InnerMap.isDivable(q, r)) {
            _note(game, '🤿 Dive', 'Swim out into deeper water first.', 'warning');
            return false;
        }
        const ok = Diving.canDive(game.player);
        if (!ok.ok) { _note(game, '🤿 Dive', ok.reason, 'warning'); return false; }
        InnerMap.cancelPlayerWalk();
        const first = !game.player.dives;
        Diving.goUnder(game.player, game.world, _worldTile(game));
        InnerMap._underwater = true;
        InnerMap._underwaterSpeed = Number(Diving.config().underwaterSpeed) || 0.75;
        this._under = { game, tiles: InnerMap.tiles, key: _mapKey(), bed: this._bedHere(game) };
        this._takeHere(game);
        if (first) _note(game, '🤿 Under the Water', 'You fill your lungs and go under. Swim about the bottom and take what you find; watch your breath, and come up (V) before it runs out.');
        this._syncButton(game);
        return true;
    },

    /** Up for air where you are. `blackout`: you come up senseless, the haul let go. */
    surface(game, { blackout = false, quiet = false } = {}) {
        if (!this._under) return null;
        const player = game && game.player;
        this._under = null;
        InnerMap._underwater = false;
        const res = player ? Diving.surface(player, { blackout }) : null;
        this._syncButton(game);
        if (!res || quiet) return res;
        if (blackout) {
            _note(game, '😵 Blacked Out', res.lost
                ? 'The dark closes in. You come to at the surface, coughing up water, and whatever you held is gone to the bottom again.'
                : 'The dark closes in. You come to at the surface, coughing up water.', 'error');
        } else {
            const got = Object.entries(res.haul).length + (res.gold > 0 ? 1 : 0);
            _note(game, '🌊 Surfaced', got ? `You come up for air after ${res.seconds}s under, with your finds.` : `You come up for air after ${res.seconds}s under.`, 'info');
        }
        if (player && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        Hotbar.refresh();
        return res;
    },

    /** Take whatever lies on the bottom where the player is. */
    _takeHere(game) {
        const u = this._under;
        if (!u) return false;
        const f = Diving.findAt(u.bed, InnerMap.playerInnerQ, InnerMap.playerInnerR);
        if (!f) return false;
        if (f._full) return false; // (already told the packs are full; swim off and back to try again)
        const res = Diving.take(game.player, f);
        if (!res.ok) {
            f._full = true;
            _note(game, '🎒 Packs Full', `${f.icon} ${f.name}: ${res.reason}`, 'warning');
            return false;
        }
        Diving.removeFind(u.bed, f);
        if (f.rare) {
            _note(game, '✨ Treasure!', `${f.text || 'Something precious in the silt'}: ${f.icon} ${f.name}${f.gold ? ` (${f.gold} gold)` : f.qty > 1 ? ` ×${f.qty}` : ''}.`, 'success');
        } else {
            _note(game, '🤿 Found', `${f.icon} ${f.name}${f.qty > 1 ? ` ×${f.qty}` : ''}${f.text ? `: ${f.text}` : ''}.`, 'success');
        }
        if (typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        return true;
    },

    /** Each frame, from the game loop. */
    update(deltaTime, game) {
        this._bindKeys(game);
        const u = this._under;
        if (!u) {
            if (InnerMap._underwater) InnerMap._underwater = false;
            return;
        }
        const player = game && game.player;
        // Off this map, indoors, or somehow out of the deep water: simply back on the surface
        if (!player || !player.dive || !InnerMap.active || InnerMap._insideBuilding || InnerMap.tiles !== u.tiles
            || !InnerMap.isDivable(InnerMap.playerInnerQ, InnerMap.playerInnerR)) {
            this.surface(game, { quiet: true });
            return;
        }
        // Swim onto a find: it's yours (a full pack is told once; leave and come back to try again)
        for (const f of u.bed.finds) if (f._full && (f.q !== InnerMap.playerInnerQ || f.r !== InnerMap.playerInnerR)) f._full = false;
        this._takeHere(game);
        const res = Diving.tick(player, game.world, _worldTile(game), deltaTime);
        if (res.low) _note(game, '💨 Short of Breath', 'Your chest is tight. Make for the surface (V).', 'warning');
        if (res.outOfBreath) _note(game, '💨 Out of Breath', res.cold ? 'Your breath is gone, and the cold is crushing. Surface now!' : 'Your breath is gone. Surface now, before the dark takes you!', 'error');
        if (res.drowned) {
            this.surface(game, { blackout: true, quiet: true });
            _note(game, '🌊 Drowned', 'You stayed down too long. The light above goes out.', 'error');
            InnerMap.cancelPlayerWalk();
            if (typeof game._triggerDeath === 'function') setTimeout(() => game._triggerDeath('drowning'), 0);
            return;
        }
        if (res.blackout) {
            InnerMap.cancelPlayerWalk();
            this.surface(game, { blackout: true });
        }
    },

    // ══════════════════════════════════════════════
    // THE KEY AND THE BUTTON
    // ══════════════════════════════════════════════

    /** V: dive under while swimming, or come up while under. */
    toggle(game) {
        if (!game || !InnerMap.active || InnerMap._insideBuilding) return;
        if (this._under) { this.surface(game); return; }
        if (!InnerMap.isPlayerSwimming()) { _note(game, '🤿 Dive', 'Swim out into the water first (right-click it and Swim Here, or Dive Under Here).', 'info'); return; }
        this.goUnder(game);
    },

    _bindKeys(game) {
        if (this._keysBound || typeof window === 'undefined' || !window.addEventListener) return;
        this._keysBound = true;
        this._game = game;
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'v' && e.key !== 'V') return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
            const g = this._game;
            if (!g || !g.player || !InnerMap.active) return;
            this.toggle(g);
        });
    },

    /** The toolbar's Surface button, while under (as the Leave building button: ui/game/innerMap.js). */
    _syncButton(game) {
        if (typeof document === 'undefined') return;
        const toolbar = document.getElementById('innerMapToolbar');
        const btn = document.getElementById(BTN_ID);
        if (!this._under) { if (btn) btn.remove(); return; }
        if (!toolbar || btn) return;
        const b = document.createElement('button');
        b.id = BTN_ID;
        b.innerHTML = '⬆️ Surface (V)';
        b.style.cssText = `background: rgba(8, 40, 52, 0.88); border: 1px solid rgba(120, 210, 230, 0.45); color: #9fe6f5;
            padding: 6px 12px; border-radius: 7px; font-size: 12px; font-weight: 600; font-family: var(--font-body);
            cursor: pointer; letter-spacing: 0.5px; transition: all 0.2s ease;`;
        b.addEventListener('mouseenter', () => { b.style.borderColor = 'rgba(120, 210, 230, 0.9)'; });
        b.addEventListener('mouseleave', () => { b.style.borderColor = 'rgba(120, 210, 230, 0.45)'; });
        b.addEventListener('click', () => this.surface(game));
        const worldExitBtn = document.getElementById('innerMapExitBtn');
        if (worldExitBtn) toolbar.insertBefore(b, worldExitBtn);
        else toolbar.appendChild(b);
    },

    // ══════════════════════════════════════════════
    // THE DIVER
    // ══════════════════════════════════════════════

    /**
     * The player under the water (ui/innerMapLayers/entities.js, in place of the
     * swimmer): the whole body, sunk in a blue-green murk, bubbles rising off
     * them, and the breath bar over their head.
     * drawChar(ctx, x, y, w, h) draws the player's sprite.
     */
    drawUnder(ctx, px, py, ds, now, drawChar, charW, charH) {
        const player = this._under && this._under.game && this._under.game.player;
        const bob = Math.sin(now * 2) * ds * 0.05;
        const cx = px - charW / 2, cy = py - charH + ds * 0.35 + bob;
        // The body, tinted by the water over it (drawn apart, then washed)
        const w = Math.max(1, Math.ceil(charW)), h = Math.max(1, Math.ceil(charH));
        let off = this._off;
        if (typeof document !== 'undefined' && (!off || off.width !== w || off.height !== h)) {
            off = this._off = document.createElement('canvas');
            off.width = w;
            off.height = h;
        }
        if (off) {
            const o = off.getContext('2d');
            o.clearRect(0, 0, w, h);
            drawChar(o, 0, 0, charW, charH);
            o.globalCompositeOperation = 'source-atop';
            o.fillStyle = 'rgba(20, 110, 120, 0.45)';
            o.fillRect(0, 0, w, h);
            o.globalCompositeOperation = 'source-over';
            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.drawImage(off, Math.round(cx), Math.round(cy));
            ctx.restore();
        }
        ctx.save();
        // Bubbles off the diver's head
        const headY = cy + charH * 0.25;
        for (let i = 0; i < 5; i++) {
            const phase = (now * 0.7 + i / 5) % 1;
            const x = px + Math.sin(now * 2.1 + i * 1.9) * ds * 0.08 + (i % 2 ? ds * 0.06 : -ds * 0.04);
            const y = headY - phase * ds * 0.7;
            const rad = Math.max(1, ds * (0.02 + (i % 3) * 0.01) * (0.6 + phase * 0.7));
            ctx.strokeStyle = `rgba(225, 248, 255, ${0.8 * (1 - phase)})`;
            ctx.lineWidth = Math.max(1, ds / 40);
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.stroke();
        }
        // The breath bar
        if (player && player.dive) {
            const share = Diving.breathShare(player);
            const low = share <= (Number(Diving.config().lowBreath) || 0.25);
            const bw = ds * 0.9, bh = Math.max(3, ds * 0.08);
            const bx = px - bw / 2, by = cy - bh - ds * 0.12;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
            if (share > 0) {
                ctx.fillStyle = low ? '#e74c3c' : '#8fd3ff';
                ctx.fillRect(bx, by, bw * share, bh);
            } else if (Math.floor(now * 4) % 2) {
                ctx.fillStyle = '#e74c3c';
                ctx.fillRect(bx, by, bw, bh);
            }
        }
        ctx.restore();
    },
};
