// InnerMapRenderer — entities render layer methods (mixed in via Object.assign).
import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { CustomObjects } from '../../world/customObjects.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { CustomInteriors } from '../../world/customInteriors.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';
import { InnerMapCombat } from '../innerMapCombat.js';
import { InnerMapDigging } from '../innerMapDigging.js';
import { InnerMapGraves } from '../innerMapGraves.js';
import { InnerMapDiving } from '../innerMapDiving.js';
import { InnerMapFarming } from '../innerMapFarming.js';
import { InnerMapAnimals } from '../innerMapAnimals.js';
import { InnerMapTasks } from '../innerMapTasks.js';
import { InnerMapSleepers } from '../innerMapSleepers.js';
import { InnerMapCarry } from '../innerMapCarry.js';
import { InnerMapCarts } from '../innerMapCarts.js';
import { InnerMapDowned } from '../innerMapDowned.js';
import { InnerMapFelling } from '../innerMapFelling.js';
import { InnerMapBattle } from '../innerMapBattle.js';
import { InnerMapEscort } from '../innerMapEscort.js';
import { InnerMapSickness } from '../innerMapSickness.js';
import { InnerMapRites } from '../innerMapRites.js';
import { glyphFor } from '../icons.js';
import { drawMapText, drawMapMarker, labelZoom } from '../mapInk.js';
import { BareBushes } from '../bareBushes.js';

// Where the rod's tip is in its line-out frame (frame 3 of
// assets/lpc/Tools/fishing_pole_cast_128.png, by scripts/make_rod_noline.py),
// in the 128px cell, by facing (up, left, down, right)
const ROD_TIPS = [[73, 44], [17, 68], [56, 81], [116, 67]];

Object.assign(InnerMapRenderer, {
    /**
     * A fishing line from the rod's tip (tx, ty on screen) to the float on its
     * water tile: a slack curve, the float bobbing on the ripples, pulled
     * under (and the line drawn taut) when a fish bites.
     */
    _drawFishingLine(ctx, camera, T, ds, now, tx, ty, bobber) {
        const at = camera.worldToScreenFast(bobber.q * T + T / 2, bobber.r * T + T / 2);
        const bite = !!bobber.bite;
        const bob = bite ? ds * 0.06 + Math.sin(now * 22) * ds * 0.03 : Math.sin(now * 2.2) * ds * 0.025;
        const bx = at.x + (bite ? Math.sin(now * 17) * ds * 0.04 : 0), by = at.y + bob;
        // A light droop below the straight line from tip to float (taut when a fish pulls)
        const sag = bite ? 0 : Math.min(ds * 0.35, Math.hypot(bx - tx, by - ty) * 0.08);
        ctx.save();
        ctx.strokeStyle = 'rgba(232, 226, 210, 0.85)';
        ctx.lineWidth = Math.max(1, ds * 0.02);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo((tx + bx) / 2, (ty + by) / 2 + sag * 2, bx, by);
        ctx.stroke();
        // Ripples round the float
        const rr = ds * (0.12 + ((now * 0.8) % 1) * 0.18);
        ctx.strokeStyle = `rgba(255, 255, 255, ${bite ? 0.55 : 0.35 * (1 - ((now * 0.8) % 1))})`;
        ctx.beginPath();
        ctx.ellipse(at.x, at.y + ds * 0.04, rr, rr * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
        // The float: red over white, half under when a fish has it
        const fr = Math.max(2.5, ds * 0.07);
        ctx.fillStyle = '#f4efe4';
        ctx.beginPath();
        ctx.arc(bx, by, fr, 0, Math.PI);
        ctx.fill();
        if (!bite) {
            ctx.fillStyle = '#c8402e';
            ctx.beginPath();
            ctx.arc(bx, by, fr, Math.PI, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = 'rgba(30, 20, 15, 0.8)';
        ctx.lineWidth = Math.max(1, ds * 0.015);
        ctx.beginPath();
        ctx.arc(bx, by, fr, 0, bite ? Math.PI : Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    },

    /** Small bobbing marker over an NPC using furniture (a tankard drinking, a hammer at the anvil…). */
    _drawNpcActivity(ctx, npc, sx, sy, ds, now) {
        const charScale = npc._scale || (npc.type === 'child' ? 0.7 : 1.0);
        const bob = Math.sin(now * 2.5 + npc.id) * ds * 0.05;
        const y = sy - ds * 1.55 * charScale + bob;
        const r = Math.max(8, ds * 0.24);
        drawMapMarker(ctx, glyphFor(npc.activity.icon) || 'speech', sx, y, r);
    },

    /** An NPC drawn as a token while the character sprites load. */
    _drawNpcStandIn(ctx, npc, sx, sy, ds) {
        ctx.beginPath();
        ctx.ellipse(sx, sy + ds * 0.25, ds * 0.12, ds * 0.05, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();
        drawMapMarker(ctx, glyphFor(npc.icon) || 'person', sx, sy, Math.max(8, ds * 0.22));
    },

    /**
     * Where a piece of furniture is drawn, in world px: { x, y, w, h, art, img } — a big piece
     * (world/innerMap/interiors.js _joinPieces) from its head tile at its own art's size, bottom
     * aligned as ui/innerMapLayers/terrainRoads.js draws it; a tile's piece filling its tile.
     */
    _pieceRect(at, T) {
        const tile = InnerMap.getTile(at.q, at.r);
        const f = tile && tile._furniture;
        if (!f) return null;
        const pc = f.piece;
        const fa = (this._interiorArt && this._interiorArt.furniture) || {};
        const big = pc && ((f.art && fa[`${f.art}_${pc.w}x${pc.h}`]) || fa[`${f.type}_${pc.w}x${pc.h}`]);
        const art = big || (f.art && fa[f.art]) || (f.facing === 'up' && fa[`${f.type}_back`]) || fa[f.type] || null;
        const q0 = pc ? pc.q : at.q, r0 = pc ? pc.r : at.r, w = pc ? pc.w : 1, h = pc ? pc.h : 1;
        const dw = big ? art.sw * T / 48 : T, dh = big ? art.sh * T / 48 : T;
        const img = art && this._getSheetByPath(art.sheet);
        return { x: q0 * T + (w * T - dw) / 2, y: (r0 + h) * T - dh, w: dw, h: dh, art, img };
    },

    /**
     * Someone lying in a bed, awake: their head on its pillow, the bed's covers drawn up over
     * them (the bed's own art again, from its covers' edge down — art.pillow / art.cover).
     */
    _drawInBed(ctx, npc, p, x, y, sc, ds) {
        const A = p.art || {};
        const top = y, w = p.w * sc, h = p.h * sc, left = x - w / 2;
        const useSprite = npc.preset && InnerMapCharacters.isReady() && InnerMapCharacters.getComposited(npc.preset);
        const cw = ds * 1.2 * 0.8, ch = ds * 1.8 * 0.8;
        const headY = top + h * (A.pillow || 0.2);
        // A piece with no covers of its own (a straw pallet) lays its own plain blanket over them
        if (!A.cover && A.blanket) {
            // (a pallet one tile long: they lie across it, head to one end — a body won't fit along it)
            if (h < ds * 1.3) {
                ctx.save();
                ctx.translate(x, top + h * 0.55);
                ctx.rotate(-Math.PI / 2);
                const k = 0.72, bw = cw * k, bh = ch * k;
                if (useSprite) InnerMapCharacters.drawCharacter(ctx, npc.preset, 'idle', InnerMapCharacters.DIR_DOWN, 0, -bw / 2, -bh / 2, bw, bh);
                if (A.blanket !== 'none') InnerMapSleepers.drawWool(ctx, -bw * 0.34, -bh / 2 + bh * 0.45, bw * 0.68, bh * 0.47, A.blanket, ds, npc.id || 0, true);
                ctx.restore();
                return;
            }
            // (a long pallet: head at its top end, the blanket low and flat over them from the shoulders down)
            if (useSprite) InnerMapCharacters.drawCharacter(ctx, npc.preset, 'idle', InnerMapCharacters.DIR_DOWN, 0, x - cw / 2, headY - ch * 0.3, cw, ch);
            if (A.blanket !== 'none') InnerMapSleepers.drawWool(ctx, left + w * 0.12, top + h * (A.blanketTop || 0.3), w * 0.76, h * (0.93 - (A.blanketTop || 0.3)), A.blanket, ds, npc.id || 0, true);
            return;
        }
        if (useSprite) InnerMapCharacters.drawCharacter(ctx, npc.preset, 'idle', InnerMapCharacters.DIR_DOWN, 0, x - cw / 2, headY - ch * 0.3, cw, ch);
        if (p.img && A.sw) {
            const k = this._sheetScale(p.img), cut = A.cover || 0.35;
            ctx.drawImage(p.img, A.sx * k, (A.sy + A.sh * cut) * k, A.sw * k, A.sh * (1 - cut) * k, left, top + h * cut, w, h * (1 - cut));
        }
    },

    /** A townsfolk's name under their feet. */
    _drawNpcName(ctx, name, sx, sy, ds, zoom) {
        drawMapText(ctx, name, sx, sy + ds * 0.3, {
            size: 10.5 * labelZoom(zoom), min: 10, weight: 600, family: 'body', baseline: 'top', color: 'rgba(244, 239, 228, 0.92)',
        });
    },

    /** The player while the sprites load: a struck token (a skull once dead). */
    _drawPlayerStandIn(ctx, dead, x, y, ds) {
        drawMapMarker(ctx, dead ? 'skull' : 'compass', x, y, Math.max(10, ds * 0.3),
            dead ? { rim: '#e8604f', color: '#e8604f' } : { rim: '#f5c542', color: '#ffe08a' });
    },

    /** "You" (or "Dead") under the player. */
    _drawPlayerTag(ctx, dead, x, y, ds, zoom) {
        drawMapText(ctx, dead ? 'Dead' : 'You', x, y + ds * 0.35, {
            size: 12 * labelZoom(zoom), weight: 700, family: 'body', baseline: 'top', color: dead ? '#e8604f' : '#f5c542',
        });
    },

    // ══════════════════════════════════════════════
    // LAYER 6 — NPCs
    // ══════════════════════════════════════════════
    _renderNPCLayer(ctx, camera, deltaTime) {
        if (!InnerMap.npcs || InnerMap.npcs.length === 0) return;

        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const now = performance.now() / 1000;  // current time in seconds
        const charReady = InnerMapCharacters.isReady();

        for (const npc of InnerMap.npcs) {
            // Skip NPCs that are hidden inside a building (on outdoor map)
            if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
            // Lazy preset assignment — runs once per NPC after characters are loaded
            if (charReady && !npc.preset) {
                npc.preset = InnerMapCharacters.getPresetForNPC(npc.type, npc.id, npc.gender);
            }
            let worldX, worldY;
            let anim = 'idle';
            let direction = npc.facing != null ? npc.facing : InnerMapCharacters.DIR_DOWN;

            if ((npc.state === 'walking' || npc.state === 'inside_building') && npc.path && npc.pathIndex < npc.path.length) {
                const target = npc.path[npc.pathIndex];
                const progress = npc.moveProgress;
                const fx = npc.q * T + T / 2, fy = npc.r * T + T / 2;
                const tx = target.q * T + T / 2, ty = target.r * T + T / 2;
                worldX = fx + (tx - fx) * progress;
                worldY = fy + (ty - fy) * progress;
                anim = 'walk';

                // Compute facing direction from movement
                const dq = target.q - npc.q;
                const dr = target.r - npc.r;
                direction = InnerMapCharacters.getDirection(dq, dr);
                npc.facing = direction;
            } else {
                worldX = npc.q * T + T / 2;
                worldY = npc.r * T + T / 2;
                if (npc.activity) anim = npc.activity.anim || 'idle';
            }

            const screen = camera.worldToScreenFast(worldX, worldY);
            const screenX = screen.x;
            const screenY = screen.y;

            if (screenX < -ds * 2 || screenX > ctx.canvas.width + ds * 2) continue;
            if (screenY < -ds * 2 || screenY > ctx.canvas.height + ds * 2) continue;

            // Draw LPC character sprite if available
            const useSprite = charReady && npc.preset && InnerMapCharacters.getComposited(npc.preset);
            if (useSprite) {
                // Character sprite: 64×64 source drawn at 1.5 tiles high, centered on tile
                const charW = ds * 1.2;
                const charH = ds * 1.8;
                const charScale = npc._scale || (npc.type === 'child' ? 0.7 : 1.0);
                const cw = charW * charScale;
                const ch = charH * charScale;
                const cx = screenX - cw / 2;
                const cy = screenY - ch + ds * 0.3;

                // Shadow
                ctx.beginPath();
                ctx.ellipse(screenX, screenY + ds * 0.15, cw * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fill();

                // Stagger animation time per NPC so they don't all step in sync
                const npcTime = now + npc.id * 0.37;
                InnerMapCharacters.drawCharacter(ctx, npc.preset, anim, direction, npcTime, cx, cy, cw, ch);
            } else {
                // Stand-in token while the sprites load
                this._drawNpcStandIn(ctx, npc, screenX, screenY, ds);
            }

            // Name label
            if (camera.zoom > 0.7) this._drawNpcName(ctx, npc.name, screenX, screenY, ds, camera.zoom);
            if (npc.activity) this._drawNpcActivity(ctx, npc, screenX, screenY, ds, now);
        }
    },

    // ══════════════════════════════════════════════
    // LAYER 7 — PLAYER
    // ══════════════════════════════════════════════
    _renderPlayerLayer(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const now = performance.now() / 1000;
        const charReady = InnerMapCharacters.isReady();
        const deathState = this._getDeathAnimState(now);

        // Get interpolated player position (smooth walking)
        const pos = InnerMap.getPlayerWorldPos();
        const screen = camera.worldToScreenFast(pos.x, pos.y);
        const screenPX = screen.x, screenPY = screen.y;

        // Determine animation and facing direction
        let anim = 'idle';
        let direction = this._playerFacing != null ? this._playerFacing : InnerMapCharacters.DIR_DOWN;

        if (!deathState) {
            if (pos.climbing) {
                anim = 'climb';
                direction = InnerMapCharacters.DIR_UP;
                this._playerFacing = direction;
            } else if (pos.walking) {
                anim = 'walk';
                direction = InnerMapCharacters.getDirection(pos.dq, pos.dr);
                this._playerFacing = direction;
            } else if (InnerMap._activeInteraction && !InnerMap._activeInteraction.done) {
                anim = InnerMap._activeInteraction.animKey || 'idle';
                direction = InnerMap.getDirectionTowardObject(
                    InnerMap._activeInteraction.anchorQ,
                    InnerMap._activeInteraction.anchorR,
                    CustomObjects.getDef(InnerMap._activeInteraction.defId)
                );
                this._playerFacing = direction;
            }
        }

        // Glow — turns red during death
        const glowR = deathState ? 200 : 245;
        const glowG = deathState ? 50 : 197;
        const glowB = deathState ? 50 : 66;
        const gradient = ctx.createRadialGradient(screenPX, screenPY, 0, screenPX, screenPY, ds * 0.5);
        gradient.addColorStop(0, `rgba(${glowR},${glowG},${glowB},0.3)`);
        gradient.addColorStop(1, `rgba(${glowR},${glowG},${glowB},0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screenPX, screenPY, ds * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Draw player as LPC character if available
        const playerPreset = this._playerPreset || InnerMapCharacters.playerPreset || 'male_noble';

        if (charReady && InnerMapCharacters.getComposited(playerPreset)) {
            const charW = ds * 1.2;
            const charH = ds * 1.8;

            if (deathState) {
                // ── Death animation: rotate character to fall over ──
                ctx.save();
                // Pivot at the character's feet
                ctx.translate(screenPX, screenPY + ds * 0.15);
                ctx.rotate(deathState.rotation);

                // Shadow — elongates as character falls
                const shadowStretch = 1 + deathState.rotation / (Math.PI / 2) * 2;
                ctx.beginPath();
                ctx.ellipse(0, 0, charW * 0.2 * shadowStretch, ds * 0.06, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fill();

                // Draw the character rotated (idle frame, facing down)
                const cx = -charW / 2;
                const cy = -charH + ds * 0.15;
                InnerMapCharacters.drawCharacter(ctx, playerPreset, 'idle', direction, 0,
                    cx, cy, charW, charH);

                // Red death tint overlay on the character
                if (deathState.tint > 0) {
                    ctx.globalAlpha = deathState.tint;
                    ctx.fillStyle = 'rgba(139, 0, 0, 0.5)';
                    ctx.fillRect(cx, cy, charW, charH);
                    ctx.globalAlpha = 1;
                }

                ctx.restore();

                // Dead plumbob (red, no bob)
                this._drawDeadPlumbob(ctx, screenPX, screenPY - charH + ds * 0.1, ds);
            } else {
                const cx = screenPX - charW / 2;
                const cy = screenPY - charH + ds * 0.3;

                // Shadow
                ctx.beginPath();
                ctx.ellipse(screenPX, screenPY + ds * 0.15, charW * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fill();

                InnerMapCharacters.drawCharacter(ctx, playerPreset, anim, direction, now,
                    cx, cy, charW, charH);

                // ── Plumbob (green diamond above player's head) ──
                this._drawPlumbob(ctx, screenPX, cy - ds * 0.05, ds, now);
            }
        } else {
            // Stand-in token (a skull if dead)
            this._drawPlayerStandIn(ctx, deathState, screenPX, screenPY, ds);

            if (deathState) {
                this._drawDeadPlumbob(ctx, screenPX, screenPY - ds * 0.5, ds);
            } else {
                this._drawPlumbob(ctx, screenPX, screenPY - ds * 0.5, ds, now);
            }
        }

        // Label
        if (camera.zoom > 0.5) this._drawPlayerTag(ctx, deathState, screenPX, screenPY, ds, camera.zoom);
    },

    /**
     * Draw a Sims-style plumbob (green diamond) floating above the player.
     * Gently bobs up and down and pulses glow.
     */
    _drawPlumbob(ctx, x, topY, ds, now) {
        const size = Math.max(6, ds * 0.22);
        // gentle bob
        const bob = Math.sin(now * 2.5) * size * 0.25;
        const cy = topY + bob;

        ctx.save();

        // glow
        const glowAlpha = 0.25 + Math.sin(now * 3) * 0.1;
        ctx.shadowColor = `rgba(46, 204, 113, ${glowAlpha + 0.3})`;
        ctx.shadowBlur = size * 1.2;

        // diamond shape
        ctx.beginPath();
        ctx.moveTo(x, cy - size);          // top
        ctx.lineTo(x + size * 0.6, cy);    // right
        ctx.lineTo(x, cy + size);          // bottom
        ctx.lineTo(x - size * 0.6, cy);    // left
        ctx.closePath();

        // gradient fill
        const grad = ctx.createLinearGradient(x, cy - size, x, cy + size);
        grad.addColorStop(0, '#5dfc8a');
        grad.addColorStop(0.45, '#2ecc71');
        grad.addColorStop(1, '#1a9c52');
        ctx.fillStyle = grad;
        ctx.fill();

        // highlight edge
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // inner shine line (top-left facet)
        ctx.beginPath();
        ctx.moveTo(x, cy - size * 0.7);
        ctx.lineTo(x - size * 0.3, cy);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.restore();
    },

    /**
     * Draw a red "dead" plumbob — static, no bob.
     */
    _drawDeadPlumbob(ctx, x, topY, ds) {
        const size = Math.max(6, ds * 0.22);
        ctx.save();
        ctx.shadowColor = 'rgba(200, 30, 30, 0.6)';
        ctx.shadowBlur = size * 1.5;

        ctx.beginPath();
        ctx.moveTo(x, topY - size);
        ctx.lineTo(x + size * 0.6, topY);
        ctx.lineTo(x, topY + size);
        ctx.lineTo(x - size * 0.6, topY);
        ctx.closePath();

        const grad = ctx.createLinearGradient(x, topY - size, x, topY + size);
        grad.addColorStop(0, '#ff4444');
        grad.addColorStop(0.45, '#cc2222');
        grad.addColorStop(1, '#881111');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    },

    // ══════════════════════════════════════════════
    // GROUND OVERLAYS — flat water / ice / waterfall tints
    // Drawn BEFORE the depth-sorted pass so they sit on the ground.
    // ══════════════════════════════════════════════
    _renderGroundOverlays(ctx, camera) {
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        // Pre-compute origin
        const origin = camera.worldToScreenFast(qMin * T, rMin * T);
        const originX = origin.x;
        const originY = origin.y;

        for (let r = rMin; r <= rMax; r++) {
            const row = InnerMap.tiles[r];
            const dy0 = originY + (r - rMin) * ds;
            const dyFloor = Math.floor(dy0);
            const sz = Math.ceil(ds) + 1;

            if (dyFloor + sz < 0 || dyFloor > canvasH) continue;

            for (let q = qMin; q <= qMax; q++) {
                const tile = row[q];
                if (!tile.explored || !tile.visible) continue;
                if (tile.building || tile.customObjectPart || tile.customObject) continue;

                const o = this._getObjectOverlay(tile);
                if (!o) continue;
                if (o.type !== 'water_overlay' && o.type !== 'ice_overlay' && o.type !== 'waterfall') continue;

                const dx = Math.floor(originX + (q - qMin) * ds);
                const dy = dyFloor;

                if (dx + sz < 0 || dx > canvasW) continue;

                if (o.type === 'water_overlay' || o.type === 'ice_overlay') {
                    ctx.fillStyle = o.tint;
                    ctx.fillRect(dx, dy, sz, sz);
                    if (o.type === 'water_overlay' && this._sheets.has('water_ripple')) {
                        const rippleSheet = this._sheets.get('water_ripple');
                        const hash = (Math.abs((q * 73856093 ^ r * 19349663))) >>> 0;
                        const frame = hash % 4;
                        ctx.globalAlpha = 0.6;
                        ctx.drawImage(rippleSheet, frame * 32, 0, 32, 32, dx, dy, sz, sz);
                        ctx.globalAlpha = 1.0;
                    }
                } else { // waterfall
                    const sheet = this._sheets.get(o.sheet);
                    if (sheet) {
                        const scale = ds / o.sw;
                        ctx.drawImage(sheet, o.sx, o.sy, o.sw, o.sh, dx, dy + ds - o.sh * scale, ds, o.sh * scale);
                    } else {
                        ctx.fillStyle = 'rgba(42,133,152,0.55)';
                        ctx.fillRect(dx, dy, sz, sz);
                    }
                }
            }
        }
    },

    // ─────────────────────────────────────────────────────────────────
    // Helper: return the tile array for a custom object based on its
    // current health percentage (supports healthStates damage stages).
    // Falls back to def.tiles when no health states are defined.
    // ─────────────────────────────────────────────────────────────────
    /**
     * Flatten an objLayers structure { base:[], detail:[], top:[] } into
     * a single draw-order array (base first, then detail, then top).
     * Returns null if layerObj is empty/missing.
     */
    _flattenObjLayers(layerObj) {
        if (!layerObj) return null;
        const out = [];
        for (const ln of ['base', 'detail', 'top']) {
            const arr = layerObj[ln];
            if (Array.isArray(arr)) for (const t of arr) out.push(t);
        }
        return out.length > 0 ? out : null;
    },

    _getActiveObjectTiles(def, customObjData) {
        // Color variants — use variant's tiles/rotations/seasons instead of base def
        if (def.colorVariants && def.colorVariants.length > 0 && customObjData) {
            const cvIdx = customObjData.colorVariantIdx || 0;
            if (cvIdx > 0 && cvIdx <= def.colorVariants.length) {
                const cv = def.colorVariants[cvIdx - 1];
                // Build a temporary def overlay with the color variant's data
                def = {
                    ...def,
                    tiles: cv.tiles || def.tiles,
                    objLayers: cv.objLayers || def.objLayers,
                    rotationVariants: cv.rotationVariants || [],
                    seasonVariants: cv.seasonVariants || null,
                };
            }
        }
        const hPct = (customObjData && customObjData.currentHealthPct != null)
            ? customObjData.currentHealthPct
            : 100;
        // Health states take priority (damage stages override everything)
        const states = def.healthStates;
        if (states && states.length > 0) {
            let best = states[0];
            for (const hs of states) {
                if (hPct >= hs.minHealthPct && hs.minHealthPct >= best.minHealthPct) {
                    best = hs;
                }
            }
            if (best) {
                const layered = this._flattenObjLayers(best.objLayers);
                if (layered) return layered;
                if (best.tiles && best.tiles.length > 0) return best.tiles;
            }
        }
        // Growth stages — age-based appearance (computed from days elapsed since planting)
        if (def.growthStates && def.growthStates.length > 0) {
            const worldDay = (typeof InnerMap !== 'undefined' ? (InnerMap.worldDay || 0) : 0);
            const dayPlanted = (customObjData && customObjData.growthDayPlanted != null)
                ? customObjData.growthDayPlanted : worldDay;
            const daysElapsed = worldDay - dayPlanted;
            // Pick the last stage where daysToReach <= daysElapsed
            let activeStage = def.growthStates[0];
            for (const gs of def.growthStates) {
                if (daysElapsed >= gs.daysToReach) activeStage = gs;
            }
            if (activeStage) {
                const layered = this._flattenObjLayers(activeStage.objLayers);
                if (layered) return layered;
                if (activeStage.tiles && activeStage.tiles.length > 0) return activeStage.tiles;
            }
        }
        // Season variants — healthy appearance per season
        if (def.seasonVariants) {
            const season = (typeof InnerMap !== 'undefined' ? (InnerMap.season || 'Summer') : 'Summer');
            const sv = def.seasonVariants[season.toLowerCase()];
            if (sv && sv.length > 0) return sv;
        }
        // Rotation variants — user-facing rotation states (cycled with R key)
        if (def.rotationVariants && def.rotationVariants.length > 0 && customObjData) {
            const idx = customObjData.rotationIdx || 0;
            if (idx > 0 && idx <= def.rotationVariants.length) {
                const rv = def.rotationVariants[idx - 1];
                if (rv) {
                    const layered = this._flattenObjLayers(rv.objLayers);
                    if (layered) return layered;
                    if (rv.tiles && rv.tiles.length > 0) return rv.tiles;
                }
            }
            // idx 0 = default tiles (fall through)
        }
        // Default: prefer objLayers over merged tiles
        const layered = this._flattenObjLayers(def.objLayers);
        if (layered) return layered;
        return def.tiles;
    },

    // ══════════════════════════════════════════════════════════════════
    // DEPTH-SORTED SPRITES
    // Merges objects, buildings (legacy + custom), NPCs, and the player
    // into one Y-sorted pass so characters walk behind / in front of
    // tall scenery based on their relative Y position.
    // ══════════════════════════════════════════════════════════════════
    _renderDepthSortedSprites(ctx, camera, deltaTime) {
        const T    = this.TILE_SIZE;
        const ds   = T * camera.zoom;
        const cs   = Math.ceil(ds) + 1;  // integer tile size — eliminates sub-pixel seams
        const now  = performance.now() / 1000;
        const charReady = typeof InnerMapCharacters !== 'undefined' && InnerMapCharacters.isReady();
        const self = this;
        const items = []; // { sortY, draw() }
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;

        // Pre-compute origin screen position for incremental tile positioning
        const origin = camera.worldToScreenFast(qMin * T, rMin * T);
        const originX = origin.x;
        const originY = origin.y;

        // ── Phase 1: Collect objects (trees, plants, rocks, custom objects) ──────
        // A custom object is anchored at its bottom-left and reaches right and up, so a
        // big one (a ship is ~40 tiles long) shows while its anchor is off the view:
        // the scan runs on past the view's left and bottom for anchors only
        const SPAN = 48;
        const mapH = InnerMap.tiles.length, mapW = mapH ? InnerMap.tiles[0].length : 0;
        const qScan = Math.max(0, qMin - SPAN), rScan = Math.min(mapH - 1, rMax + SPAN);
        const seen = (t) => !!(t && t.explored && t.visible);
        for (let r = rMin; r <= rScan; r++) {
            for (let q = qScan; q <= qMax; q++) {
                const tile = InnerMap.tiles[r][q];
                if (r > rMax || q < qMin) {
                    // off the view: only an object that reaches into it, and has been seen
                    if (!tile.customObject || typeof CustomObjects === 'undefined') continue;
                    const xdef = CustomObjects.getDef(tile.customObject.defId);
                    if (!xdef) continue;
                    const ext = self._objectExtent(xdef);
                    if (q + ext.w <= qMin || r - ext.h > rMax) continue;
                    const midRow = InnerMap.tiles[Math.max(0, r - (ext.h >> 1))];
                    if (!seen(tile) && !seen(midRow && midRow[Math.min(mapW - 1, q + (ext.w >> 1))])) continue;
                } else if (!tile.explored || !tile.visible) continue;
                if (tile.building) continue;
                if (tile.customObjectPart) continue;

                // Custom editor objects (anchor tile)
                // Whole object sorted by origin row — if origin is below
                // another sprite's origin, the entire object draws on top.
                if (tile.customObject && typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded()) {
                    const def = CustomObjects.getDef(tile.customObject.defId);
                    if (def) {
                        const singleImg = def.sheetPath ? CustomObjects.getImage(def.sheetPath) : null;
                        // For single-sheet objects, skip if image missing; for multi-sheet, check per-tile
                        if (def.sheetPath && (!singleImg || !singleImg.complete)) { continue; }
                        // Sort by origin row (bottom of anchor tile) so objects
                        // whose origin is lower draw entirely in front.
                        // (a ship sorts by its deck: someone on deck or on the pier before it is drawn in front)
                        const sortY = (r + 1 + (def.sortRow || 0)) * T;
                        const sortH = def.bounds
                            ? (def.bounds.maxRow - def.bounds.minRow + 1) : 1;
                        const sortX = q;
                        const oq = q, or2 = r;
                        const customObjRef = tile.customObject;  // capture for health-state lookup

                        // Check if this object is being interacted with
                        const ia = InnerMap._activeInteraction;
                        // (only an object being struck shakes and fades: washing at a well, sitting on
                        //  a bench and the like leave it still — they keep no swing timers, and the
                        //  shake would come out NaN and blank the object for the whole animation)
                        const isInteracting = ia && !ia.done && !ia.nonDestructive && ia.anchorQ === q && ia.anchorR === r;
                        // A tree (or stump) being chopped shudders at each blow instead, its crown
                        // swaying more than its trunk (ui/innerMapFelling.js)
                        const chopped = InnerMapFelling.isChopped(def);

                        items.push({ sortY, zLayer: 1, sortH, sortX, draw() {
                            // Apply shake and fade if being interacted with
                            let shakeX = 0, shakeY = 0, alpha = 1.0;
                            if (isInteracting && !chopped) {
                                if (ia.fading) {
                                    // Fade phase: shake intensifies + fade out
                                    const fadeProgress = Math.min(1, ia.swingTimer / ia.fadeDuration);
                                    alpha = Math.max(0, 1.0 - fadeProgress);
                                    const intensity = 4 + fadeProgress * 6;
                                    shakeX = Math.sin(ia.swingTimer * 45) * intensity;
                                    shakeY = Math.cos(ia.swingTimer * 35) * intensity * 0.3;
                                } else {
                                    // Swing phase: shake builds within each 0.5s interval then resets
                                    const swingProgress = ia.swingTimer / ia.swingInterval;
                                    const intensity = 1 + swingProgress * 3;
                                    shakeX = Math.sin(ia.swingTimer * 30) * intensity;
                                    shakeY = Math.cos(ia.swingTimer * 25) * intensity * 0.2;
                                }
                                if (alpha < 1.0) ctx.globalAlpha = alpha;
                            }

                            // Anchor-relative positioning: keep the anchor as a
                            // fractional screen coord and place each sub-tile on the
                            // true grid (spacing = ds), flooring per tile. Stepping by
                            // the integer cs instead would make sub-tiles snap relative
                            // to the terrain whenever ds crosses an integer during the
                            // zoom lerp — the visible jitter. Size stays cs so adjacent
                            // tiles still overlap a pixel and show no seams.
                            const anchorScreen = camera.worldToScreenFast(oq * T, or2 * T);
                            const ax = anchorScreen.x;
                            const ay = anchorScreen.y;

                            // Resolve tile set based on current health (supports damage stages)
                            const activeTiles = self._getActiveObjectTiles(def, customObjRef);
                            // Diving: the veil (innerMapLayers/underwater.js) dims the world above the
                            // water tile by tile, but an object reaching out over the water (a ship's
                            // mast and sail, a tree leaning over the pond) stands on those dim tiles and
                            // is above the water too — its parts over the water are dimmed here alike
                            const uw = InnerMap._underwater && !InnerMap._insideBuilding;
                            const smooth0 = ctx.imageSmoothingEnabled;
                            // A bush picked bare by a town herbalist (world/innerMap/townHerbalists.js), till it
                            // grows back: its berries and blossoms gone, an herb cut back (ui/bareBushes.js)
                            const bare = def.objectType === 'plant' && customObjRef.pickedDay != null && InnerMap._bushReady && !InnerMap._bushReady(customObjRef)
                                ? BareBushes.get(`${def.id}|${InnerMap.season || ''}`, activeTiles, 96,
                                    td => (td.sheetPath ? CustomObjects.getImage(td.sheetPath) : singleImg), im => self._sheetScale(im))
                                : null;
                            if (bare) {
                                // (an herb cut back: the plant itself kept to `cut` of its height, its top taken off)
                                const cut = BareBushes.cutTo(def.resource && def.resource.type);
                                const keep = 1 - (1 - bare.top) * (1 - cut);   // share of the cell kept, from the bottom
                                const w = bare.cols * ds, h = bare.rows * ds;
                                const bottom = Math.floor(ay + (bare.minRow + bare.rows) * ds) + shakeY;
                                ctx.imageSmoothingEnabled = true;
                                ctx.drawImage(bare.canvas, 0, bare.canvas.height * (1 - keep), bare.canvas.width, bare.canvas.height * keep,
                                    Math.floor(ax + bare.minCol * ds) + shakeX, bottom - h * keep, w, h * keep);
                            }
                            // A burning campfire plays the flame frames its sheet holds beside it (data/ambient.json `frames`)
                            const anim = self._ambientAnim ? self._ambientAnim(def.id) : null;
                            const afr = anim ? self._ambientFrameOf(anim, oq, or2) : 0;
                            const fdx = anim ? afr * (anim.step ? anim.step[0] : 1) * 32 : 0;
                            const fdy = anim ? afr * (anim.step ? anim.step[1] : 0) * 32 : 0;
                            for (const td of bare ? [] : activeTiles) {
                                const img = td.sheetPath ? CustomObjects.getImage(td.sheetPath) : singleImg;
                                if (!img || !img.complete) continue;
                                const tdx = Math.floor(ax + td.localCol * ds) + shakeX + (chopped ? InnerMapFelling.shakeAt(oq, or2, td.localRow, ds) : 0);
                                const tdy = Math.floor(ay + td.localRow * ds) + shakeY;
                                if (tdx + cs < 0 || tdx > ctx.canvas.width + cs) continue;
                                if (tdy + cs < 0 || tdy > ctx.canvas.height + cs) continue;
                                const k = self._sheetScale(img);   // (a high-res sheet: ui/sheetScale.js)
                                const veiled = uw && !self._veiledTile(oq + td.localCol, or2 + td.localRow)
                                    ? self._veiledSprite(img, (td.sx + fdx) * k, (td.sy + fdy) * k, td.sw * k, td.sh * k) : null;
                                ctx.imageSmoothingEnabled = k > 1;   // (a painted sheet draws smooth, pixel art crisp)
                                if (veiled) ctx.drawImage(veiled, tdx, tdy, cs, cs);
                                else ctx.drawImage(img, (td.sx + fdx) * k, (td.sy + fdy) * k, td.sw * k, td.sh * k, tdx, tdy, cs, cs);
                            }
                            ctx.imageSmoothingEnabled = smooth0;

                            if (isInteracting && !chopped && alpha < 1.0) ctx.globalAlpha = 1.0;
                            // ── Object health bar (shown when object has taken damage) ──
                            if (typeof InnerMapCombat !== 'undefined' && customObjRef.currentHealthPct != null && customObjRef.currentHealthPct < 100) {
                                InnerMapCombat.renderObjectHealthBar(ctx, camera, oq, or2, customObjRef.currentHealthPct);
                            }
                        }});
                    }
                    continue;
                }

                // ── Wreckage afloat (a struck ship's salvage, world/innerMap/harbour.js scatterWreck) ──
                if (tile.groundItem && tile.groundItem.salvage) {
                    const gq = q, gr = r, sv = tile.groundItem.salvage;
                    items.push({ sortY: (r + 0.4) * T, zLayer: 0, sortX: q, draw: () => this._drawSalvage(ctx, camera, gq, gr, sv, cs, now, T) });
                } else
                // ── Ground items (placed from hotbar) ──
                if (tile.groundItem) {
                    const gq = q, gr = r;
                    const gIcon = glyphFor(tile.groundItem.icon) || 'satchel';
                    const sortY = (r + 0.5) * T; // slightly above ground
                    items.push({ sortY, zLayer: 0, sortX: q, draw() {
                        const screen = camera.worldToScreenFast(gq * T, gr * T);
                        const dx = Math.floor(screen.x);
                        const dy = Math.floor(screen.y);
                        // Draw a subtle shadow ellipse under the item
                        const cx = dx + cs / 2;
                        const cy = dy + cs * 0.6;
                        const rad = cs * 0.28;
                        ctx.save();
                        ctx.globalAlpha = 0.35;
                        ctx.fillStyle = '#000';
                        ctx.beginPath();
                        ctx.ellipse(cx, cy, rad, rad * 0.5, 0, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                        // The item, as a small token on the ground
                        drawMapMarker(ctx, gIcon, cx, dy + cs * 0.45, Math.max(8, cs * 0.22));
                    }});
                }
            }
        }

        // ── Trees coming down (world/innerMap/felling.js; drawn by ui/innerMapFelling.js):
        //    sorted just in front of the stump they leave ──
        // ── Moving parts — a waterwheel, sails, a pennant — from their art (innerMapLayers/ambient.js) ──
        if (this._ambientSortItems) this._ambientSortItems(items, ctx, camera);

        for (const f of InnerMap._fallingTrees || []) {
            if (f.r < rMin - 1 || f.r > rMax + 1) continue;
            const ff = f;
            items.push({ sortY: (f.r + 1) * T + 0.5, zLayer: 1, sortX: f.q, draw() { InnerMapFelling.drawFalling(ctx, camera, ff, self); } });
        }

        // ── Phase 2: Collect buildings (legacy + custom) ────────────────────────
        for (let r = rMin; r <= rMax; r++) {
            for (let q = qMin; q <= qMax; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.visible) continue;

                if (tile.building) {
                    const screen = camera.worldToScreenFast(q * T, r * T);
                    const dx = Math.floor(screen.x), dy = Math.floor(screen.y);
                    if (dx + ds * 4 < 0 || dx > ctx.canvas.width + ds * 4) continue;
                    if (dy + ds * 4 < 0 || dy > ctx.canvas.height + ds * 4) continue;

                    const sortY = (r + 1) * T;
                    const bq = q, br = r;
                    items.push({ sortY, zLayer: 1, sortH: 3, sortX: q, draw() {
                        const isUnder = tile._propertyRef && tile._propertyRef.underConstruction;
                        if (isUnder) ctx.globalAlpha = 0.45;
                        self._drawLPCBuilding(ctx, tile.building, dx, dy, ds);
                        if (isUnder) {
                            ctx.globalAlpha = 1.0;
                            drawMapMarker(ctx, 'hammer', dx + ds / 2, dy + ds / 2, Math.max(10, ds * 0.22));
                        }
                        const bldg = tile.buildingInfo;
                        if (bldg && camera.zoom > 0.4) {
                            self._drawBuildingLabel(ctx, camera, bldg, bq, br);
                        }
                    }});
                }

                if (tile.customBuilding && typeof CustomBuildings !== 'undefined' && CustomBuildings.isLoaded()) {
                    const def = CustomBuildings.getBuilding(tile.customBuilding.defId);
                    if (def) {
                        const screen = camera.worldToScreenFast(q * T, r * T);
                        const dx = Math.floor(screen.x), dy = Math.floor(screen.y);
                        if (dx + ds * 4 < 0 || dx > ctx.canvas.width + ds * 4) continue;
                        if (dy + ds * 4 < 0 || dy > ctx.canvas.height + ds * 4) continue;

                        // Sort by origin row so the whole building draws
                        // in front of / behind other sprites based on origin Y
                        const sortY = (r + 1) * T;
                        const bldgH = def.bounds
                            ? (def.bounds.maxRow - def.bounds.minRow + 1) : 3;
                        const cq = q, cr = r;
                        items.push({ sortY, zLayer: 1, sortH: bldgH, sortX: q, draw() {
                            self._drawCustomBuilding(ctx, camera, def, cq, cr, ds);
                        }});
                    }
                }
            }
        }

        // ── Phase 2a: Dug ground (holes, turned earth, graves): flat, under every sprite ──
        InnerMapDigging.renderGround(ctx, camera, this._frameRange, T);
        // ── Graves: a fresh grave's mound, a cleared grave's open pit (ui/innerMapGraves.js) ──
        InnerMapGraves.renderGround(ctx, camera, this._frameRange, T);
        // ── Blood on the ground: where the dead fell, drops where a body was carried (ui/innerMapCombat.js) ──
        InnerMapCombat.renderBlood(ctx, camera, T);
        // ── A mound with someone living under it: the earth stirring, muffled cries (ui/innerMapDowned.js) ──
        InnerMapDowned.renderMounds(ctx, camera, T);

        // ── Phase 2b: The dead, lying where they fell (under anyone standing on that row) ──
        for (const body of InnerMapCombat.corpsesHere()) {
            if (body === InnerMapCombat._carrying) {
                // Over the player's shoulders (drawn just after the player)
                const pos = InnerMap.getPlayerWorldPos();
                // (worldToScreenFast reuses one object: copy the numbers out now)
                const ps = camera.worldToScreenFast(pos.x, pos.y);
                const px = ps.x, py = ps.y;
                // (over one shoulder: half hangs down the player's back, drawn before them, half down the front)
                const face = self._playerFacing != null ? self._playerFacing : InnerMapCharacters.DIR_DOWN;
                items.push({ sortY: pos.y + T / 2 - 0.5, zLayer: 2, draw() { InnerMapCombat.drawCarriedCorpse(ctx, camera, body, px, py, face, 'back'); } });
                items.push({ sortY: pos.y + T / 2 + 0.5, zLayer: 2, draw() { InnerMapCombat.drawCarriedCorpse(ctx, camera, body, px, py, face, 'front'); } });
                continue;
            }
            const screen = camera.worldToScreenFast(body.q * T + T / 2, body.r * T + T / 2);
            const bx = screen.x, by = screen.y;
            if (bx < -ds * 2 || bx > ctx.canvas.width + ds * 2) continue;
            if (by < -ds * 2 || by > ctx.canvas.height + ds * 2) continue;
            items.push({ sortY: body.r * T + T / 2, zLayer: 0, draw() {
                InnerMapCombat.drawCorpse(ctx, camera, body, bx, by);
            }});
        }

        // ── Phase 3: Collect NPCs ───────────────────────────────────────────────
        if (InnerMap.npcs && InnerMap.npcs.length > 0) {
            for (const npc of InnerMap.npcs) {
                // Skip NPCs that are hidden inside a building (on outdoor map)
                if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
                if (charReady && !npc.preset) {
                    npc.preset = InnerMapCharacters.getPresetForNPC(npc.type, npc.id, npc.gender);
                }
                // Asleep in bed, under the blanket (world/innerMap/floors.js, ui/innerMapSleepers.js)
                if (npc._asleep && InnerMap._insideBuilding) {
                    // (in a bed of two tiles: under its own covers, as anyone lying in it)
                    const bedP = !npc._asleep.bedroll && self._pieceRect({ q: npc.q, r: npc.r }, T);
                    if (bedP && bedP.art && (bedP.art.cover || bedP.art.blanket)) {
                        const bs = camera.worldToScreenFast(bedP.x + bedP.w / 2, bedP.y);
                        const zRef = npc, bx = bs.x, by = bs.y;
                        items.push({ sortY: bedP.y + bedP.h - 1, zLayer: 2, draw() {
                            self._drawInBed(ctx, zRef, bedP, bx, by, ds / T, ds);
                            InnerMapSleepers.drawZs(ctx, zRef, bx, by + bedP.h * (ds / T) * (bedP.art.pillow || 0.2), ds);
                        } });
                        continue;
                    }
                    const zs = camera.worldToScreenFast(npc.q * T + T / 2, npc.r * T + T / 2);
                    const zx = zs.x, zy = zs.y;
                    const zRef = npc, zArt = bedP && bedP.art;
                    items.push({ sortY: npc.r * T + T / 2, zLayer: 0, draw() { InnerMapSleepers.draw(ctx, zRef, zx, zy, ds, undefined, zArt); } });
                    continue;
                }
                // Sleeping rough in a doorway, on straw under a blanket (world/innerMap/townWork.js)
                if (npc._roughSleep && npc.state === 'idle' && npc.activity && npc.activity.type === 'rough' && !InnerMap._insideBuilding) {
                    const rs = camera.worldToScreenFast(npc.q * T + T / 2, npc.r * T + T / 2);
                    const rx = rs.x, ry = rs.y;
                    const rRef = { id: npc.id, preset: npc.preset, type: npc.type, _asleep: { bedroll: true } };
                    items.push({ sortY: npc.r * T + T / 2, zLayer: 0, draw() { InnerMapSleepers.draw(ctx, rRef, rx, ry, ds); } });
                    continue;
                }
                // Beaten senseless: lying where they fell, under anyone standing on that row
                // (and the bound, awake but tied hand and foot; and anyone the player carries or drags — ui/innerMapDowned.js)
                if (npc.state === 'unconscious' || npc.state === 'bound' || npc._carried) {
                    // Laid on a cart: drawn lying on it (ui/innerMapCarts.js collect)
                    if (npc._onCart) continue;
                    // Over the player's shoulder (ui/innerMapCarry.js): drawn just after the player, as a body carried is
                    if (npc._carried && !npc._dragged) {
                        const pos = InnerMap.getPlayerWorldPos();
                        const ps = camera.worldToScreenFast(pos.x, pos.y);
                        const px = ps.x, py = ps.y, cRef = npc;
                        const face = self._playerFacing != null ? self._playerFacing : InnerMapCharacters.DIR_DOWN;
                        const carried = { preset: cRef.preset, type: cRef.type, alive: true, bound: cRef._bound, gagged: cRef._gagged };
                        items.push({ sortY: pos.y + T / 2 - 0.5, zLayer: 2, draw() { InnerMapCombat.drawCarriedCorpse(ctx, camera, carried, px, py, face, 'back'); } });
                        items.push({ sortY: pos.y + T / 2 + 0.5, zLayer: 2, draw() { InnerMapCombat.drawCarriedCorpse(ctx, camera, carried, px, py, face, 'front'); } });
                        continue;
                    }
                    // Left lying in a room the player isn't in: not here
                    if (!npc._carried && !InnerMapCarry.lyingHere(npc)) continue;
                    // Laid in a bed: under its covers, as a sleeper lies (no z's — they're out cold)
                    const koBed = npc._koBed && InnerMap._insideBuilding ? self._pieceRect({ q: npc.q, r: npc.r }, T) : null;
                    if (koBed) {
                        const kRef = npc;
                        if (koBed.art && (koBed.art.cover || koBed.art.blanket)) {
                            const bs = camera.worldToScreenFast(koBed.x + koBed.w / 2, koBed.y);
                            const bx = bs.x, by = bs.y;
                            items.push({ sortY: koBed.y + koBed.h - 1, zLayer: 2, draw() { self._drawInBed(ctx, kRef, koBed, bx, by, ds / T, ds); } });
                        } else {
                            const zs = camera.worldToScreenFast(npc.q * T + T / 2, npc.r * T + T / 2);
                            const zx = zs.x, zy = zs.y, zArt = koBed.art;
                            items.push({ sortY: npc.r * T + T / 2, zLayer: 0, draw() { InnerMapSleepers.draw(ctx, kRef, zx, zy, ds, undefined, zArt, { still: true }); } });
                        }
                        continue;
                    }
                    const ks = camera.worldToScreenFast(npc.q * T + T / 2, npc.r * T + T / 2);
                    const kx = ks.x, ky = ks.y;
                    if (kx < -ds * 2 || kx > ctx.canvas.width + ds * 2 || ky < -ds * 2 || ky > ctx.canvas.height + ds * 2) continue;
                    const kRef = npc;
                    items.push({ sortY: npc.r * T + T / 2, zLayer: 0, draw() {
                        InnerMapCombat.drawKnockedOut(ctx, camera, kRef, kx, ky);
                    }});
                    continue;
                }
                let worldX, worldY;
                let anim = 'idle';
                let seatArt = null, onPiece = null, soakAt = null;
                let direction = npc.facing != null ? npc.facing : InnerMapCharacters.DIR_DOWN;

                if ((npc.state === 'walking' || npc.state === 'inside_building') && npc.path && npc.pathIndex < npc.path.length) {
                    const target = npc.path[npc.pathIndex];
                    const progress = npc.moveProgress;
                    const fx = npc.q * T + T / 2, fy = npc.r * T + T / 2;
                    const tx = target.q * T + T / 2, ty = target.r * T + T / 2;
                    worldX = fx + (tx - fx) * progress;
                    worldY = fy + (ty - fy) * progress;
                    anim = 'walk';
                    const dq = target.q - npc.q;
                    const dr = target.r - npc.r;
                    direction = InnerMapCharacters.getDirection(dq, dr);
                    npc.facing = direction;
                } else {
                    worldX = npc.q * T + T / 2;
                    worldY = npc.r * T + T / 2;
                    if (npc.activity) anim = npc.activity.anim || 'idle';
                    // Sat at a table (world/innerMap/furnitureUse.js activity.seat): on a stool,
                    // drawn up to the table's edge rather than out in the room
                    if (npc.activity && npc.activity.seat && npc.activity.at && anim === 'sitting') {
                        seatArt = self._interiorArt && self._interiorArt.furniture && self._interiorArt.furniture[npc.activity.seat];
                        worldX += Math.sign(npc.activity.at.q - npc.q) * T * 0.22;
                        worldY += Math.sign(npc.activity.at.r - npc.r) * T * 0.22;
                    }
                    // On the piece itself (world/innerMap/furnitureUse.js _onPiece): sat on the pew or
                    // throne at its seat, in the bath up to the rim, or lain in the bed under its covers
                    onPiece = npc.activity && npc.activity.on && npc.activity.at ? self._pieceRect(npc.activity.at, T) : null;
                    if (onPiece) {
                        const mode = npc.activity.on, A = onPiece.art || {};
                        worldX = onPiece.x + onPiece.w / 2;
                        if (mode === 'sit') worldY = onPiece.y + (A.seat || 0.6) * onPiece.h + T * 0.38;
                        else if (mode === 'soak') { soakAt = onPiece.y + (A.rim || 0.4) * onPiece.h; worldY = soakAt + T * (A.sink != null ? A.sink : 0.42); }   // (sink: how deep they sit below the rim)
                        else if (mode === 'lie') {
                            const ls = camera.worldToScreenFast(worldX, onPiece.y);
                            const lRef = npc, lp = onPiece, lx = ls.x, ly = ls.y;
                            items.push({ sortY: lp.y + lp.h - 1, zLayer: 2, draw() { self._drawInBed(ctx, lRef, lp, lx, ly, ds / T, ds); } });
                            continue;
                        }
                    }
                    // The watch stands on guard, sword and shield held ready
                    else if (npc.type === 'guard' && !npc._dialogFrozen) anim = 'ready';
                    // Swinging at the player (InnerMapCombat._updateNPCReactions)
                    if (npc._swingAt && performance.now() - npc._swingAt < 500) {
                        anim = 'halfslash';
                        direction = InnerMapCharacters.getDirection(InnerMap.playerInnerQ - npc.q, InnerMap.playerInnerR - npc.r);
                        npc.facing = direction;
                    }
                    // Squared up in a fight between townsfolk, or watching it (ui/innerMapBrawls.js): the
                    // stance, the swing from its first frame, facing the other
                    if (npc._fight && npc._fight.anim) {
                        anim = npc._fight.anim;
                        if (npc._fight.facing != null) { direction = npc._fight.facing; npc.facing = direction; }
                    }
                }

                const screen = camera.worldToScreenFast(worldX, worldY);
                // A town scene (world/innerMap/townScenes.js): a vendor stands behind the stall's
                // counter (drawn over the stall, the counter hiding their feet); a drunk sways home
                const counter = npc._behindCounter;
                // (a blow in a brawl knocks them back a fraction of a tile, drawn only: they keep their tile)
                const fkb = npc._fight && npc._fight.kb;
                const kbK = fkb ? Math.max(0, 1 - (now - fkb.at) / (fkb.dur || 0.28)) : 0;
                const sx = screen.x + (npc._drunk && anim === 'walk' ? Math.sin(now * 3.1 + npc.id) * ds * 0.12 : 0) + (kbK ? fkb.dx * kbK * ds : 0);
                // (the stall's art: its counter top a tile above the anchor row's foot, the awning above that)
                const stallFoot = counter ? camera.worldToScreenFast(worldX, (counter.row + 1) * T).y : 0;
                // (a stall of two tiles: they stand in it, face under the awning, the counter before them)
                const stallBox = counter && counter.piece ? self._pieceRect(counter.piece, T) : null;
                // (copied: worldToScreenFast hands back one shared object, overwritten before this deferred draw runs —
                // the stall would be drawn wherever the last thing (the player) was put)
                const stallS0 = stallBox ? camera.worldToScreenFast(stallBox.x, stallBox.y) : null;
                const stallScr = stallS0 ? { x: stallS0.x, y: stallS0.y } : null;
                // (a hall stall: head and shoulders over the counter, before the awning's valance — the gap under
                // the awning is too narrow for a face, and any lower the counter and its wares hide them whole)
                const sy = stallBox ? stallFoot - ds * 0.45 : counter ? stallFoot - ds * 0.6 : screen.y + (kbK ? fkb.dy * kbK * ds : 0);
                if (sx < -ds * 2 || sx > ctx.canvas.width + ds * 2) continue;
                if (sy < -ds * 2 || sy > ctx.canvas.height + ds * 2) continue;
                // (sat in a pew facing the altar: its back hides them below the shoulders)
                const pewT = !counter && npc._seatOn ? InnerMap.getTile(npc.q, npc.r) : null;
                const pewBack = !!(pewT && pewT._furniture && pewT._furniture.type === 'pew' && pewT._furniture.facing === 'up');
                const clipY = stallBox ? stallFoot : counter ? stallFoot - ds * 0.95
                    : soakAt != null ? camera.worldToScreenFast(worldX, soakAt).y
                    : pewBack ? camera.worldToScreenFast(worldX, npc.r * T).y + ds * 0.54 : null;

                const sortY = stallBox ? (counter.row + 1) * T - 0.5 : counter ? (counter.row + 1) * T + 0.5 : onPiece ? onPiece.y + onPiece.h - 0.5 : worldY + T / 2;   // bottom-of-tile for consistent depth sort
                // A town woodcutter at a tree (world/innerMap/townWoodcutters.js): the swing timed to
                // the blows, the axe in hand (ui/innerMapFelling.js)
                const chopRec = npc._chop;
                const chopP = chopRec && !chopRec.going && npc.activity && npc.activity.type === 'chop' && anim === 'slash'
                    ? Math.max(0, Math.min(0.999, chopRec.timer / (chopRec.interval || 1))) : null;
                const carryAxe = !!(chopRec && chopRec.going);
                const chopTool = (chopRec && chopRec.tool) || 'axe';
                // A smith's hammer at the anvil (world/innerMap/townScenes.js _swing), swung like the axe
                const swingRec = chopP == null && npc._swing && anim === 'slash' ? npc._swing : null;
                const swingP = swingRec ? Math.max(0, Math.min(0.999, swingRec.t / (swingRec.interval || 1))) : null;
                // Held in one frame of the anim (sat on the bench, kneeling at prayer)
                const poseDef = npc._pose != null ? InnerMapCharacters._EXTRA_ANIMS.find(e => e.key === anim) : null;
                const nRef = npc, nAnim = anim, nDir = direction;
                // (the name: over the stall's awning or the head behind a counter, clear of the marker and the
                // customers; under the piece they sit or lie on)
                const labelY = stallBox ? stallScr.y - ds * 0.55 : counter ? sy - ds * 2.25 : onPiece ? camera.worldToScreenFast(worldX, onPiece.y + onPiece.h).y - ds * 0.3 : sy;

                items.push({ sortY, zLayer: 2, draw() {
                    if (clipY != null) { ctx.save(); ctx.beginPath(); ctx.rect(-1e4, -1e4, 2e4, clipY + 1e4); ctx.clip(); }
                    const useSprite = charReady && nRef.preset && InnerMapCharacters.getComposited(nRef.preset);
                    if (useSprite) {
                        const charW = ds * 1.2, charH = ds * 1.8;
                        const charScale = nRef._scale || (nRef.type === 'child' ? 0.7 : 1.0);
                        const cw = charW * charScale, ch = charH * charScale;
                        const cx = sx - cw / 2, cy = sy - ch + ds * 0.3;
                        const seatImg = seatArt && self._getSheetByPath(seatArt.sheet);
                        if (seatImg) {
                            const ks = self._sheetScale(seatImg);
                            ctx.drawImage(seatImg, seatArt.sx * ks, seatArt.sy * ks, (seatArt.sw || 32) * ks, (seatArt.sh || 32) * ks, sx - ds / 2, sy - ds * 0.68, ds, ds);
                        }
                        ctx.beginPath();
                        ctx.ellipse(sx, sy + ds * 0.15, cw * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.25)';
                        ctx.fill();
                        const npcTime = now + nRef.id * 0.37;
                        // A tool in hand at field work (world/innerMap/townLife.js): posed per frame
                        // of the swing (scripts/make_farm_tools.py), behind them when they face away
                        const tool = nRef.activity && nRef.activity.tool;
                        const toolSheet = tool && self._sheets && self._sheets.get('tool_' + tool);
                        const comp = toolSheet && InnerMapCharacters.getComposited(nRef.preset);
                        const extra = comp && comp[nAnim] && InnerMapCharacters._EXTRA_ANIMS.find(e => e.key === nAnim);
                        const drawTool = () => {
                            const frame = Math.floor(npcTime * extra.fps) % extra.frames;
                            ctx.drawImage(toolSheet, frame * 128, nDir * 128, 128, 128, cx - cw / 2, cy - ch / 2, cw * 2, ch * 2);
                        };
                        // A sack of the harvest carried to the granary (world/innerMap/townLife.js _carry),
                        // held before them: behind their back when they walk away from us
                        const logs = !!(nRef._carry && (nRef._carry.good === 'wood' || nRef._carry.good === 'firewood'));
                        // a basket: a miner's stone, a herbalist's herbs, berries or flowers
                        const basket = !!(nRef._carry && ['stone', 'herbs', 'berries', 'flowers'].includes(nRef._carry.good));
                        const sackSheet = nRef._carry && !logs && !basket && self._sheets && self._sheets.get('carry_sack');
                        // logs a woodcutter felled (world/innerMap/townWoodcutters.js), on the shoulder
                        const logSheet = logs && self._sheets && self._sheets.get('lumber');
                        const drawLogs = () => {
                            const w = ds * 0.95 * charScale, h = w * 0.5;
                            const bob = nAnim === 'walk' ? Math.abs(Math.sin(npcTime * 9)) * ds * 0.03 : 0;
                            const k = self._sheetScale(logSheet);   // (the log pile, Lumber.png cells (2-3, 2))
                            ctx.drawImage(logSheet, 64 * k, 64 * k, 64 * k, 32 * k, sx - w / 2, cy + ch * 0.4 - h / 2 - bob, w, h);
                        };
                        const drawSack = () => {
                            const s = ds * 0.6 * charScale;
                            const side = nDir === InnerMapCharacters.DIR_LEFT ? -1 : nDir === InnerMapCharacters.DIR_RIGHT ? 1 : 0;
                            const bob = nAnim === 'walk' ? Math.abs(Math.sin(npcTime * 9)) * ds * 0.03 : 0;
                            const k = self._sheetScale(sackSheet);   // (the grain sack, farming_fishing cell (1, 2-3))
                            ctx.drawImage(sackSheet, 32 * k, 92 * k, 32 * k, 36 * k, sx - s / 2 + side * cw * 0.22, cy + ch * 0.42 - s / 2 - bob, s, s);
                        };
                        if (sackSheet && nDir === InnerMapCharacters.DIR_UP) drawSack();
                        if (basket && nDir === InnerMapCharacters.DIR_UP) InnerMapFelling.drawCarriedStone(ctx, sx, sy, ds, nDir, nAnim === 'walk' ? Math.abs(Math.sin(npcTime * 9)) * ds * 0.03 : 0, nRef._carry.good);
                        if (extra && nDir === InnerMapCharacters.DIR_UP) drawTool();
                        if (chopP != null) InnerMapFelling.drawAxe(ctx, sx, sy, ds, nDir, chopP, true, chopTool);
                        if (swingP != null) InnerMapFelling.drawAxe(ctx, sx, sy, ds, nDir, swingP, true, swingRec.tool);
                        const stepBob = nAnim === 'walk' ? Math.abs(Math.sin(npcTime * 9)) * ds * 0.03 : 0;
                        if (carryAxe) InnerMapFelling.drawCarriedAxe(ctx, sx, sy, ds, nDir, true, stepBob, chopTool);
                        const fightSw = nRef._fight && nRef._fight.swingAt != null && (nAnim === 'halfslash' || nAnim === 'slash') ? Math.min(0.499, now - nRef._fight.swingAt) : null;
                        const bodyTime = fightSw != null ? fightSw : chopP != null ? InnerMapFelling.swingTime(chopP, InnerMapCharacters.SLASH_FPS)
                            : swingP != null ? InnerMapFelling.swingTime(swingP, InnerMapCharacters.SLASH_FPS)
                                : poseDef ? (nRef._pose + 0.5) / poseDef.fps : npcTime;
                        // (the sick look pale and wan: ui/innerMapSickness.js marks them)
                        const pale = nRef._sick && typeof ctx.filter === 'string';
                        if (pale) ctx.filter = nRef._sick.abed ? 'saturate(0.35) brightness(1.08) sepia(0.25)' : 'saturate(0.6) brightness(1.05) sepia(0.15)';
                        InnerMapCharacters.drawCharacter(ctx, nRef.preset, nAnim, nDir, bodyTime, cx, cy, cw, ch);
                        if (pale) ctx.filter = 'none';
                        if (chopP != null) InnerMapFelling.drawAxe(ctx, sx, sy, ds, nDir, chopP, false, chopTool);
                        if (swingP != null) InnerMapFelling.drawAxe(ctx, sx, sy, ds, nDir, swingP, false, swingRec.tool);
                        // on the way out to the tree, the axe over the shoulder
                        if (carryAxe) InnerMapFelling.drawCarriedAxe(ctx, sx, sy, ds, nDir, false, stepBob, chopTool);
                        // a miner's basket of stone (world/innerMap/townMiners.js), before the chest
                        if (basket && nDir !== InnerMapCharacters.DIR_UP) InnerMapFelling.drawCarriedStone(ctx, sx, sy, ds, nDir, stepBob, nRef._carry.good);
                        if (extra && nDir !== InnerMapCharacters.DIR_UP) drawTool();
                        if (sackSheet && nDir !== InnerMapCharacters.DIR_UP) drawSack();
                        if (logSheet) drawLogs();
                    } else {
                        self._drawNpcStandIn(ctx, nRef, sx, sy, ds);
                    }
                    if (clipY != null) ctx.restore();
                    if (stallBox && stallBox.img) {
                        // Only the wares and the counter over them (the art's lower part, below the gap under the
                        // awning: assets/buildingKit/stalls_trade.png): the whole stall again would hide them entirely
                        const sc = ds / T, k = self._sheetScale(stallBox.img), a = stallBox.art;
                        const cut = 0.43, dTop = Math.round(stallScr.y + stallBox.h * sc * cut);
                        ctx.drawImage(stallBox.img, a.sx * k, (a.sy + a.sh * cut) * k, a.sw * k, a.sh * (1 - cut) * k,
                            Math.round(stallScr.x), dTop, Math.round(stallBox.w * sc), Math.round(stallScr.y + stallBox.h * sc) - dTop);
                    }
                    // (behind a counter their feet are hidden: the name goes over their head, clear of the
                    // customers before the stall)
                    if (camera.zoom > 0.7) self._drawNpcName(ctx, nRef.name, sx, labelY, ds, camera.zoom);
                    // (not over a woodcutter at work: the axe swung up over the head says it, and would be hidden)
                    // (nor over every drinker or worshipper sat in a scene: activity.quiet)
                    // (a stall keeper's marker goes over their name, both above the awning)
                    if (nRef.activity && !nRef.activity.quiet && chopP == null && swingP == null) self._drawNpcActivity(ctx, nRef, sx, stallBox ? labelY - ds * 0.05 + ds * 1.55 * (nRef._scale || (nRef.type === 'child' ? 0.7 : 1)) - ds * 0.3 : sy, ds, now);
                    // ── Health bar (only shown when NPC has taken damage) ──
                    if (typeof InnerMapCombat !== 'undefined') {
                        const nHealth = InnerMapCombat.getNPCHealth(nRef.id);
                        if (nHealth) {
                            const charScale = nRef._scale || (nRef.type === 'child' ? 0.7 : 1.0);
                            const charH = ds * 1.8 * charScale;
                            InnerMapCombat.renderHealthBar(ctx, camera, worldX, worldY, nHealth.current, nHealth.max, charH);
                        }
                    }
                }});
            }
        }

        // ── Phase 3b: The deer (world/innerMap/animals.js; ui/innerMapAnimals.js) ──
        InnerMapAnimals.collect(items, ctx, camera, T);
        // ── The plague crosses on the doors (ui/innerMapSickness.js) ──
        InnerMapSickness.collect(items, ctx, camera, T);
        // ── A bier on its bearers' shoulders (ui/innerMapRites.js) ──
        InnerMapRites.collect(items, ctx, camera, T);
        // ── Phase 3c: The player's crops (ui/innerMapFarming.js) ──
        InnerMapFarming.collect(items, ctx, camera, T);
        // ── Phase 3d: A job's heaps and strays (ui/innerMapTasks.js) ──
        InnerMapTasks.collect(items, ctx, camera, T);
        // ── Phase 3e: A battle on this ground — the companies and the fallen (ui/innerMapBattle.js) ──
        InnerMapBattle.collect(items, ctx, camera, T);
        // ── Phase 3f: The realm's household guard behind you (ui/innerMapEscort.js) ──
        InnerMapEscort.collect(items, ctx, camera, T);
        // ── Phase 3g: Handcarts and wagons, and whoever lies on one (ui/innerMapCarts.js) ──
        InnerMapCarts.collect(items, ctx, camera, T);

        // ── Phase 4: Collect Player ─────────────────────────────────────────────
        {
            const pos = InnerMap.getPlayerWorldPos();
            const screen = camera.worldToScreenFast(pos.x, pos.y);
            const deathState = this._getDeathAnimState(now);
            let anim = 'idle';
            let direction = this._playerFacing != null ? this._playerFacing : InnerMapCharacters.DIR_DOWN;
            const digging = InnerMapDigging.playerAnim();
            if (!deathState) {
                if (pos.climbing) {
                    // On the rock, facing it (ui/innerMapClimbing.js)
                    anim = 'climb';
                    direction = InnerMapCharacters.DIR_UP;
                    this._playerFacing = direction;
                } else if (pos.walking) {
                    anim = 'walk';
                    direction = InnerMapCharacters.getDirection(pos.dq, pos.dr);
                    this._playerFacing = direction;
                } else if (digging) {
                    anim = digging.anim;
                    direction = digging.direction;
                    this._playerFacing = direction;
                } else if (typeof InnerMapCombat !== 'undefined' && InnerMapCombat._attackState && !InnerMapCombat._attackState.pending) {
                    anim = 'slash';
                    const ia = InnerMapCombat._attackState;
                    if (ia.targetType === 'npc' && ia.npc) {
                        const dq = ia.npc.q - InnerMap.playerInnerQ;
                        const dr = ia.npc.r - InnerMap.playerInnerR;
                        direction = InnerMapCharacters.getDirection(dq, dr);
                    } else if (ia.targetType === 'object') {
                        direction = InnerMap.getDirectionTowardObject(ia.targetQ, ia.targetR, CustomObjects.getDef(ia.defId));
                    }
                    this._playerFacing = direction;
                } else if (InnerMap._activeInteraction && !InnerMap._activeInteraction.done) {
                    anim = InnerMap._activeInteraction.animKey || 'slash';
                    direction = InnerMap.getDirectionTowardObject(
                        InnerMap._activeInteraction.anchorQ,
                        InnerMap._activeInteraction.anchorR,
                        CustomObjects.getDef(InnerMap._activeInteraction.defId)
                    );
                    this._playerFacing = direction;
                }
            }
            // Fishing: the rod in hand, turned to the water (ui/mapTasks/wildTasks.js _rodPose)
            const rodPose = InnerMap._rod;
            const pRod = !deathState && !pos.walking && rodPose && Date.now() - rodPose.at < 600
                && !(typeof InnerMap.isPlayerSwimming === 'function' && InnerMap.isPlayerSwimming()) ? rodPose : null;
            if (pRod) {
                anim = 'idle';
                if (pRod.toward) direction = InnerMap.getDirectionToward(pRod.toward.q, pRod.toward.r);
                this._playerFacing = direction;
            }
            // Chopping (ui/innerMapFelling.js): the slash frames timed to the blows, the axe in hand
            const chopP = !deathState && !pos.walking && (anim === 'slash' || anim === 'halfslash') ? InnerMapFelling.swingPhase() : null;
            if (chopP != null) anim = 'slash';
            const sortY = pos.y + T / 2;
            const px = screen.x, py = screen.y;
            const pAnim = anim, pDir = direction;
            const pTime = chopP != null ? InnerMapFelling.swingTime(chopP, InnerMapCharacters.SLASH_FPS) : null;
            const playerPreset = this._playerPreset || InnerMapCharacters.playerPreset || 'male_noble';
            const pDeathState = deathState; // capture for closure
            const pSwimming = !deathState && typeof InnerMap.isPlayerSwimming === 'function' && InnerMap.isPlayerSwimming();

            items.push({ sortY, zLayer: 2, draw: () => {
                // Glow — turns red during death
                const glR = pDeathState ? 200 : 245, glG = pDeathState ? 50 : 197, glB = pDeathState ? 50 : 66;
                const gradient = ctx.createRadialGradient(px, py, 0, px, py, ds * 0.5);
                gradient.addColorStop(0, `rgba(${glR},${glG},${glB},0.3)`);
                gradient.addColorStop(1, `rgba(${glR},${glG},${glB},0)`);
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(px, py, ds * 0.5, 0, Math.PI * 2);
                ctx.fill();

                if (charReady && InnerMapCharacters.getComposited(playerPreset)) {
                    const charW = ds * 1.2, charH = ds * 1.8;

                    if (pDeathState) {
                        // Death: rotate character to fall over
                        ctx.save();
                        ctx.translate(px, py + ds * 0.15);
                        ctx.rotate(pDeathState.rotation);
                        const shadowStretch = 1 + pDeathState.rotation / (Math.PI / 2) * 2;
                        ctx.beginPath();
                        ctx.ellipse(0, 0, charW * 0.2 * shadowStretch, ds * 0.06, 0, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.3)';
                        ctx.fill();
                        const cx = -charW / 2, cy = -charH + ds * 0.15;
                        InnerMapCharacters.drawCharacter(ctx, playerPreset, 'idle', pDir, 0, cx, cy, charW, charH);
                        if (pDeathState.tint > 0) {
                            ctx.globalAlpha = pDeathState.tint;
                            ctx.fillStyle = 'rgba(139, 0, 0, 0.5)';
                            ctx.fillRect(cx, cy, charW, charH);
                            ctx.globalAlpha = 1;
                        }
                        ctx.restore();
                        this._drawDeadPlumbob(ctx, px, py - charH + ds * 0.1, ds);
                    } else if (pSwimming && InnerMapDiving.isUnder()) {
                        // Under the water, diving (ui/innerMapDiving.js): the whole body, sunk in the murk
                        InnerMapDiving.drawUnder(ctx, px, py, ds, now,
                            (c, x, y, w, h) => InnerMapCharacters.drawCharacter(c, playerPreset, pAnim, pDir, now, x, y, w, h), charW, charH);
                    } else if (pSwimming) {
                        // In the water (world/innerMap/swimming.js): head and shoulders
                        // above it, bobbing, the water ringing out round them
                        const bob = Math.sin(now * 3.2) * ds * 0.04;
                        const cx = px - charW / 2, cy = py - charH + ds * 0.62 + bob;
                        const waterY = py - ds * 0.38;
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(cx - ds, cy - ds, charW + ds * 2, waterY - (cy - ds));
                        ctx.clip();
                        InnerMapCharacters.drawCharacter(ctx, playerPreset, pAnim, pDir, now, cx, cy, charW, charH);
                        ctx.restore();
                        const ripple = this._sheets && this._sheets.get('water_ripple');
                        if (ripple) {
                            const fr = Math.floor(now * 6) % 4;
                            const rw = ds * 1.3;
                            ctx.drawImage(ripple, fr * 32, 0, 32, 32, Math.round(px - rw / 2), Math.round(waterY - rw * 0.62), Math.round(rw), Math.round(rw));
                        } else {
                            ctx.strokeStyle = 'rgba(230,245,255,0.7)';
                            ctx.lineWidth = Math.max(1, ds / 20);
                            ctx.beginPath();
                            ctx.ellipse(px, waterY, charW * 0.32, ds * 0.08, 0, 0, Math.PI * 2);
                            ctx.stroke();
                        }
                    } else {
                        const cx = px - charW / 2, cy = py - charH + ds * 0.3;
                        ctx.beginPath();
                        ctx.ellipse(px, py + ds * 0.15, charW * 0.2, ds * 0.06, 0, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.25)';
                        ctx.fill();
                        // The rod: behind you when you face away, in your hands otherwise
                        const rodSheet = pRod && this._sheets && this._sheets.get('fishing_pole_cast');
                        const drawRod = () => {
                            // 128px cells with the 64px body frame at their middle: twice the body's box
                            const ox = cx - charW / 2, oy = cy - charH / 2, sx = charW * 2 / 128, sy = charH * 2 / 128;
                            ctx.drawImage(rodSheet, pRod.frame * 128, pDir * 128, 128, 128, ox, oy, charW * 2, charH * 2);
                            // The line out: from the rod's tip to the float where the cast landed
                            const tip = pRod.frame === 3 && pRod.bobber && ROD_TIPS[pDir];
                            if (tip) self._drawFishingLine(ctx, camera, T, ds, now, ox + tip[0] * sx, oy + tip[1] * sy, pRod.bobber);
                        };
                        if (rodSheet && pDir === InnerMapCharacters.DIR_UP) drawRod();
                        // A job's load or tool (ui/innerMapTasks.js): behind the body or in front, by facing
                        InnerMapTasks.drawCarried(ctx, px, py, ds, pDir, pAnim, now, true);
                        if (chopP != null) InnerMapFelling.drawAxe(ctx, px, py, ds, pDir, chopP, true);
                        InnerMapCharacters.drawCharacter(ctx, playerPreset, pAnim, pDir, pTime != null ? pTime : now, cx, cy, charW, charH);
                        if (chopP != null) InnerMapFelling.drawAxe(ctx, px, py, ds, pDir, chopP, false);
                        InnerMapTasks.drawCarried(ctx, px, py, ds, pDir, pAnim, now, false);
                        if (rodSheet && pDir !== InnerMapCharacters.DIR_UP) drawRod();
                    }
                } else {
                    self._drawPlayerStandIn(ctx, pDeathState, px, py, ds);
                }
                if (camera.zoom > 0.5) self._drawPlayerTag(ctx, pDeathState, px, py, ds, camera.zoom);
                // Getting their breath back after a dive: the bar over their head fills (ui/innerMapDiving.js)
                if (!pDeathState && charReady) {
                    const g = InnerMapDiving._game;
                    InnerMapDiving.drawRecovery(ctx, px, py - ds * 1.8 + ds * (pSwimming ? 0.62 : 0.3), ds, g && g.player);
                }
            }});
        }

        // ── Phase 5: Sort by Y and draw ─────────────────────────────────────────
        // Primary: Y position (bottom of origin row)
        // Then: zLayer (objects=1 < characters=2)
        // Then: smaller height on top (drawn later)
        // Then: rightmost X on top (drawn later)
        items.sort((a, b) =>
            (a.sortY - b.sortY)
            || (a.zLayer - b.zLayer)
            || ((b.sortH || 0) - (a.sortH || 0))
            || ((a.sortX || 0) - (b.sortX || 0))
        );
        for (const item of items) item.draw();

        // ── Phase 6: Combat overlays (hit flashes + floating damage numbers) ──
        // Always rendered on top of all sprites.
        // The chips, leaves and dust of the felling, and the XP it earned (ui/innerMapFelling.js)
        InnerMapFelling.drawParticles(ctx, camera);
        if (typeof InnerMapCombat !== 'undefined') {
            InnerMapCombat.render(ctx, camera);
        }
        // Arrows in flight, dust, blood, the companies' plates and orders (ui/innerMapBattle.js)
        InnerMapBattle.renderOverlay(ctx, camera);
    },

    /**
     * A piece of wreckage afloat: planks, a crate, a strongbox (the LPC lumber,
     * crate and chest sheets), a coil of rope or a scrap of sail, bobbing on
     * the water with a ripple round it — and a little marker so you know it's
     * there for the taking.
     */
    _drawSalvage(ctx, camera, q, r, sv, cs, now, T) {
        const screen = camera.worldToScreenFast(q * T, r * T);
        const ph = sv.phase || 0;
        const bob = Math.sin(now * 1.8 + ph) * cs * 0.04;
        const cx = Math.floor(screen.x) + cs / 2, cy = Math.floor(screen.y) + cs * 0.55 + bob;
        const ripple = this._sheets && this._sheets.get('water_ripple');
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        if (ripple) {
            const fr = Math.floor(now * 4 + ph) % 4;
            ctx.globalAlpha = 0.8;
            ctx.drawImage(ripple, fr * 32, 0, 32, 32, Math.round(cx - cs * 0.55), Math.round(cy - cs * 0.62), Math.round(cs * 1.1), Math.round(cs * 1.1));
            ctx.globalAlpha = 1;
        }
        const sheet = (k) => this._sheets && this._sheets.get(k);
        const tilt = Math.sin(now * 1.3 + ph) * 0.06;
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        const sz = cs * 0.8;
        if (sv.kind === 'planks' && sheet('lumber')) {
            // one of the first row's loose planks
            const k = this._sheetScale(sheet('lumber'));
            ctx.drawImage(sheet('lumber'), (sv.frame % 10) * 32 * k, 0, 32 * k, 32 * k, -sz / 2, -sz * 0.7, sz, sz);
        } else if (sv.kind === 'crate' && sheet('crate')) {
            const k = this._sheetScale(sheet('crate'));
            ctx.drawImage(sheet('crate'), 0, 32 * k, 32 * k, 32 * k, -sz / 2, -sz * 0.75, sz, sz);
        } else if (sv.kind === 'chest' && sheet('chest')) {
            const k = this._sheetScale(sheet('chest'));
            ctx.drawImage(sheet('chest'), 64 * k, 0, 32 * k, 32 * k, -sz / 2, -sz * 0.75, sz, sz);
        } else if (sv.kind === 'sail') {
            ctx.fillStyle = 'rgba(232,224,204,0.95)';
            ctx.beginPath();
            ctx.moveTo(-sz * 0.4, -sz * 0.1); ctx.lineTo(sz * 0.35, -sz * 0.25); ctx.lineTo(sz * 0.42, sz * 0.05); ctx.lineTo(-sz * 0.3, sz * 0.12);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = 'rgba(120,100,70,0.7)'; ctx.lineWidth = Math.max(1, cs / 32); ctx.stroke();
        } else {
            // a coil of rope (or anything without its own art)
            ctx.strokeStyle = '#a07a4a'; ctx.lineWidth = Math.max(2, cs / 14);
            for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(0, -sz * 0.05, sz * (0.32 - i * 0.08), sz * (0.14 - i * 0.035), 0, 0, Math.PI * 2); ctx.stroke(); }
        }
        ctx.restore();
        // Something to haul in
        if (camera.zoom > 0.6) drawMapMarker(ctx, 'satchel', cx + cs * 0.32, cy - cs * 0.55, Math.max(6, cs * 0.14));
    },
});
