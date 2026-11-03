// ============================================
// LIGHT SYSTEM — 2D dynamic lighting with day/night cycle
// Inspired by: https://pvigier.github.io/2019/07/28/vagabond-2d-light-system.html
//
// Technique (a light map):
//   1. Fill an offscreen canvas with the ambient light colour: white by day,
//      a moonlit blue-grey at night, warm at dusk and dawn
//   2. Add each light on top ('lighter'): warm torch and window glows
//   3. Multiply the light map over the scene, so the street stays readable
//      in moonlight (darker, cooler) and lit places keep their true colours
//   4. A faint additive glow round each light, for warmth
//
// Integrated with InnerMap.timeOfDay for automatic day/night transitions.
// ============================================

import { InnerMap } from '../world/innerMap.js';


export const LightSystem = {
    // ── Offscreen canvas for the shadow map ──
    _shadowCanvas: null,
    _shadowCtx: null,

    // ── Registered light sources ──
    _lights: [],         // Array of { x, y, radius, color, intensity, flicker, type }
    _staticLights: [],   // Persistent lights from buildings etc.

    // ── Configuration ──
    enabled: true,
    ambientDarkness: 0,  // 0 = full daylight, 1 = pitch black night
    ambientColor: { r: 10, g: 10, b: 40 },  // Night tint color
    // The light map's base colour (multiplied over the scene): white by day
    ambientLight: { r: 255, g: 255, b: 255 },
    // Moonlight at the darkest of night, and the warm cast of dusk and dawn
    NIGHT_LIGHT: { r: 50, g: 60, b: 104 },
    DUSK_LIGHT: { r: 255, g: 156, b: 108 },
    INDOOR_NIGHT_LIGHT: { r: 120, g: 100, b: 84 },

    // ── Time-of-day lighting curve ──
    // Maps hour (0-24) to darkness level (0-1)
    // Smooth transitions at dawn and dusk
    _getDarknessForHour(hour, minuteFraction) {
        const t = hour + (minuteFraction || 0);

        // Dawn: 5:00–7:30 (darkness fades from 0.85 to 0)
        if (t >= 5 && t < 7.5) {
            return 0.85 * (1 - (t - 5) / 2.5);
        }
        // Full daylight: 7:30–17:00
        if (t >= 7.5 && t < 17) {
            return 0;
        }
        // Dusk: 17:00–20:00 (darkness rises from 0 to 0.85)
        if (t >= 17 && t < 20) {
            return 0.85 * ((t - 17) / 3);
        }
        // Night: 20:00–5:00
        return 0.85;
    },

    // Get ambient color based on time of day
    _getAmbientColorForHour(hour, minuteFraction) {
        const t = hour + (minuteFraction || 0);

        // Dawn: warm orange-pink
        if (t >= 5 && t < 7) {
            const p = (t - 5) / 2;
            return {
                r: Math.round(40 + (1 - p) * 60),   // 100 → 40
                g: Math.round(20 + (1 - p) * 30),    // 50 → 20
                b: Math.round(60 - (1 - p) * 20),    // 40 → 60
            };
        }
        // Dusk: deep orange to indigo
        if (t >= 17 && t < 20) {
            const p = (t - 17) / 3;
            return {
                r: Math.round(60 - p * 50),    // 60 → 10
                g: Math.round(30 - p * 20),    // 30 → 10
                b: Math.round(20 + p * 20),    // 20 → 40
            };
        }
        // Night
        if (t >= 20 || t < 5) {
            return { r: 10, g: 10, b: 40 };
        }
        // Day
        return { r: 0, g: 0, b: 0 };
    },

    // ══════════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════════

    init(width, height) {
        this._shadowCanvas = document.createElement('canvas');
        this._shadowCanvas.width = width;
        this._shadowCanvas.height = height;
        this._shadowCtx = this._shadowCanvas.getContext('2d');
        this._lights = [];
        this._staticLights = [];
    },

    /**
     * Ensure shadow canvas matches the main canvas size
     */
    _ensureSize(width, height) {
        if (!this._shadowCanvas) {
            this.init(width, height);
            return;
        }
        if (this._shadowCanvas.width !== width || this._shadowCanvas.height !== height) {
            this._shadowCanvas.width = width;
            this._shadowCanvas.height = height;
        }
    },

    // ══════════════════════════════════════════════
    // LIGHT SOURCES
    // ══════════════════════════════════════════════

    /**
     * Clear all dynamic lights (called each frame before collecting new ones)
     */
    clearLights() {
        this._lights.length = 0;
    },

    /**
     * Add a dynamic light source for this frame
     * @param {number} screenX - Screen X position
     * @param {number} screenY - Screen Y position
     * @param {number} radius - Light radius in screen pixels
     * @param {object} color - { r, g, b } light color
     * @param {number} intensity - Light intensity 0-1
     * @param {string} type - Light type: 'point', 'torch', 'fire', 'moon'
     */
    addLight(screenX, screenY, radius, color, intensity, type) {
        this._lights.push({
            x: screenX,
            y: screenY,
            radius: radius,
            color: color || { r: 255, g: 200, b: 100 },
            intensity: intensity || 1.0,
            type: type || 'point',
            flicker: (type === 'torch' || type === 'fire') ? true : false,
        });
    },

    /**
     * Add a player light (always present, larger during night)
     */
    addPlayerLight(screenX, screenY, zoom, darkness) {
        // Player carries a torch at night, subtle visibility during day
        const baseRadius = 60 * zoom;
        const nightBonus = darkness * 110 * zoom;
        const radius = baseRadius + nightBonus;

        const color = darkness > 0.1
            ? { r: 255, g: 180, b: 80 }
            : { r: 255, g: 240, b: 200 };

        this.addLight(screenX, screenY, radius, color, 0.8, darkness > 0.1 ? 'torch' : 'point');
    },

    /**
     * Add a building light source
     * @param {number} screenX - Screen X position
     * @param {number} screenY - Screen Y position
     * @param {number} zoom - Camera zoom
     * @param {string} buildingType - Type of building
     */
    addBuildingLight(screenX, screenY, zoom, buildingType) {
        // Different buildings emit different lights
        const configs = {
            tavern:      { radius: 120, color: { r: 255, g: 176, b: 84 },  intensity: 0.85, type: 'fire' },
            inn:         { radius: 110, color: { r: 255, g: 180, b: 90 },  intensity: 0.8, type: 'fire' },
            blacksmith:  { radius: 110, color: { r: 255, g: 130, b: 50 },  intensity: 0.8, type: 'fire' },
            church:      { radius: 95,  color: { r: 255, g: 226, b: 170 }, intensity: 0.65, type: 'point' },
            temple:      { radius: 100, color: { r: 230, g: 205, b: 255 }, intensity: 0.65, type: 'point' },
            town_hall:   { radius: 105, color: { r: 255, g: 196, b: 110 }, intensity: 0.75, type: 'torch' },
            marketplace: { radius: 100, color: { r: 255, g: 186, b: 96 },  intensity: 0.7, type: 'torch' },
            barracks:    { radius: 95,  color: { r: 255, g: 170, b: 80 },  intensity: 0.7, type: 'torch' },
            guard_tower: { radius: 95,  color: { r: 255, g: 170, b: 80 },  intensity: 0.7, type: 'torch' },
            manor:       { radius: 110, color: { r: 255, g: 206, b: 140 }, intensity: 0.75, type: 'torch' },
            castle:      { radius: 150, color: { r: 255, g: 196, b: 120 }, intensity: 0.85, type: 'torch' },
            house:       { radius: 75,  color: { r: 255, g: 188, b: 112 }, intensity: 0.55, type: 'point' },
            farm:        { radius: 60,  color: { r: 255, g: 180, b: 100 }, intensity: 0.4, type: 'point' },
        };

        // Fallback for unknown building types
        const cfg = configs[buildingType] || configs.house;

        this.addLight(
            screenX, screenY,
            cfg.radius * zoom,
            cfg.color,
            cfg.intensity,
            cfg.type
        );
    },

    /**
     * Add a fireplace / campfire light
     */
    addFireLight(screenX, screenY, zoom) {
        this.addLight(screenX, screenY, 70 * zoom,
            { r: 255, g: 160, b: 50 }, 0.75, 'fire');
    },

    /**
     * Add a torch light (for walls, posts)
     */
    addTorchLight(screenX, screenY, zoom) {
        this.addLight(screenX, screenY, 45 * zoom,
            { r: 255, g: 170, b: 60 }, 0.6, 'torch');
    },

    // ══════════════════════════════════════════════
    // RENDERING
    // ══════════════════════════════════════════════

    /**
     * Render the light/shadow overlay onto the main canvas.
     * Called after all game sprites have been drawn.
     *
     * @param {CanvasRenderingContext2D} ctx - Main canvas context
     * @param {HTMLCanvasElement} canvas - Main canvas element
     * @param {number} deltaTime - Frame time for flicker animation
     */
    render(ctx, canvas, deltaTime) {
        if (!this.enabled) return;
        if (this.ambientDarkness <= 0.01) return;  // Full daylight — skip entirely

        const w = canvas.width;
        const h = canvas.height;
        this._ensureSize(w, h);

        const sctx = this._shadowCtx;
        const time = performance.now() / 1000;
        const lights = this._lights;
        const dark = Math.min(1, this.ambientDarkness / 0.85);

        // ── Step 1: the ambient light (moonlight, dusk) ──
        const al = this.ambientLight;
        sctx.globalCompositeOperation = 'source-over';
        sctx.fillStyle = `rgb(${al.r}, ${al.g}, ${al.b})`;
        sctx.fillRect(0, 0, w, h);

        // ── Step 2: add each light (flickering torches and fires) ──
        sctx.globalCompositeOperation = 'lighter';
        const resolved = [];
        for (const light of lights) {
            let radius = light.radius;
            let intensity = light.intensity;
            if (light.flicker) {
                const speed = light.type === 'fire' ? 5 : 4;
                const amt = light.type === 'fire' ? 0.05 : 0.03;
                const f = 1 + Math.sin(time * speed + light.x * 0.1) * amt + Math.sin(time * speed * 1.7 + light.y * 0.13) * amt * 0.4;
                radius *= f;
                intensity *= 0.95 + Math.sin(time * speed * 0.8 + light.x) * 0.05;
            }
            if (light.x + radius < 0 || light.x - radius > w || light.y + radius < 0 || light.y - radius > h) continue;
            resolved.push({ light, radius, intensity });
            const c = light.color;
            const a = Math.min(1, intensity) * dark;
            const g = sctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, radius);
            g.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${a.toFixed(3)})`);
            g.addColorStop(0.35, `rgba(${c.r}, ${c.g}, ${c.b}, ${(a * 0.72).toFixed(3)})`);
            g.addColorStop(0.7, `rgba(${c.r}, ${c.g}, ${c.b}, ${(a * 0.28).toFixed(3)})`);
            g.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
            sctx.fillStyle = g;
            sctx.beginPath();
            sctx.arc(light.x, light.y, radius, 0, Math.PI * 2);
            sctx.fill();
        }
        sctx.globalCompositeOperation = 'source-over';

        // ── Step 3: multiply the light map over the scene ──
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(this._shadowCanvas, 0, 0);

        // ── Step 4: a faint glow round each light ──
        ctx.globalCompositeOperation = 'lighter';
        for (const { light, radius, intensity } of resolved) {
            const c = light.color;
            const a = 0.1 * intensity * dark;
            if (a < 0.01) continue;
            const r = radius * 0.55;
            const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
            g.addColorStop(0, `rgba(${c.r}, ${Math.round(c.g * 0.8)}, ${Math.round(c.b * 0.6)}, ${a.toFixed(3)})`);
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },

    // ══════════════════════════════════════════════
    // DAY/NIGHT INTEGRATION
    // ══════════════════════════════════════════════

    /**
     * Update ambient darkness from InnerMap time system.
     * Call this each frame before render().
     */
    updateFromTime() {
        if (typeof InnerMap === 'undefined' || !InnerMap.active) {
            this.ambientDarkness = 0;
            return;
        }

        const hour = InnerMap.timeOfDay;
        const minuteFraction = InnerMap._timeAccumulator / InnerMap.TIME_SCALE;

        this.ambientDarkness = this._getDarknessForHour(hour, minuteFraction);
        this.ambientColor = this._getAmbientColorForHour(hour, minuteFraction);

        // The light map's base: white by day toward moonlight by night; at
        // dusk and dawn (part dark) a warm cast in between
        const n = Math.min(1, this.ambientDarkness / 0.85);
        const lerp = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
        let light = lerp({ r: 255, g: 255, b: 255 }, this.NIGHT_LIGHT, n);
        light = lerp(light, this.DUSK_LIGHT, Math.sin(Math.PI * n) * 0.4);

        // Indoors: lamp-lit, never so dark
        if (InnerMap._insideBuilding) {
            this.ambientDarkness = Math.min(this.ambientDarkness, 0.3);
            this.ambientColor = { r: 20, g: 15, b: 10 };
            light = lerp({ r: 255, g: 255, b: 255 }, this.INDOOR_NIGHT_LIGHT, n);
        }
        this.ambientLight = light;
    },

    // ══════════════════════════════════════════════
    // SCENE LIGHT COLLECTION
    // ══════════════════════════════════════════════

    /**
     * Collect all light sources from the current inner map state.
     * Called each frame by the renderer.
     *
     * @param {Object} camera - The inner map camera
     */
    collectLights(camera) {
        this.clearLights();

        if (!InnerMap.active || !InnerMap.tiles) return;
        if (this.ambientDarkness <= 0.01) return;

        const T = 32; // TILE_SIZE
        const bounds = camera.getVisibleBounds();
        const qMin = Math.max(0, Math.floor(bounds.left / T) - 2);
        const qMax = Math.min(InnerMap.width - 1, Math.ceil(bounds.right / T) + 2);
        const rMin = Math.max(0, Math.floor(bounds.top / T) - 2);
        const rMax = Math.min(InnerMap.height - 1, Math.ceil(bounds.bottom / T) + 2);

        // ── Player light ──
        const playerPos = InnerMap.getPlayerWorldPos();
        const playerScreen = camera.worldToScreenFast(playerPos.x, playerPos.y);
        this.addPlayerLight(playerScreen.x, playerScreen.y, camera.zoom, this.ambientDarkness);

        // ── Building lights ──
        if (InnerMap.buildings) {
            for (const bldg of InnerMap.buildings) {
                if (bldg.q < qMin - 2 || bldg.q > qMax + 2) continue;
                if (bldg.r < rMin - 2 || bldg.r > rMax + 2) continue;

                const worldX = bldg.q * T + T / 2;
                const worldY = bldg.r * T + T / 2;
                const screen = camera.worldToScreenFast(worldX, worldY);
                // Capture before next call overwrites
                const bsx = screen.x, bsy = screen.y;

                // Extract base building type (strip "player_" prefix)
                let bType = bldg.type;
                if (bType.startsWith('player_')) bType = bType.slice(7);

                this.addBuildingLight(bsx, bsy, camera.zoom, bType);
            }
        }

        // ── Interior lights (when inside a building) ──
        if (InnerMap._insideBuilding) {
            for (let r = rMin; r <= rMax; r++) {
                for (let q = qMin; q <= qMax; q++) {
                    const tile = InnerMap.tiles[r] && InnerMap.tiles[r][q];
                    if (!tile || !tile._isInterior) continue;

                    if (tile._interiorMeta) {
                        const meta = tile._interiorMeta;
                        if (meta.furniture) {
                            const fType = meta.furniture.type;
                            if (fType === 'fireplace' || fType === 'forge') {
                                const screen = camera.worldToScreenFast(q * T + T / 2, r * T + T / 2);
                                this.addFireLight(screen.x, screen.y, camera.zoom);
                            } else if (fType === 'candle') {
                                const screen = camera.worldToScreenFast(q * T + T / 2, r * T + T / 2);
                                this.addLight(screen.x, screen.y, 45 * camera.zoom,
                                    { r: 255, g: 220, b: 140 }, 0.6, 'torch');
                            }
                        }
                    }
                }
            }
        }

        // ── NPC-carried lights at night ──
        if (this.ambientDarkness > 0.2 && InnerMap.npcs) {
            for (const npc of InnerMap.npcs) {
                    // Out on the street, and only the watch and one in three others carry a light
                    if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
                    if (npc.state === 'gone' || InnerMap._insideBuilding) continue;
                    if (npc.type !== 'guard' && (Number(npc.id) || 0) % 3 !== 0) continue;
                    let worldX, worldY;
                    if (npc.state === 'walking' && npc.path && npc.pathIndex < npc.path.length) {
                        const target = npc.path[npc.pathIndex];
                        const progress = npc.moveProgress;
                        worldX = npc.q * T + T / 2 + (target.q - npc.q) * T * progress;
                        worldY = npc.r * T + T / 2 + (target.r - npc.r) * T * progress;
                    } else {
                        worldX = npc.q * T + T / 2;
                        worldY = npc.r * T + T / 2;
                    }
                    const screen = camera.worldToScreenFast(worldX, worldY);
                    this.addLight(screen.x, screen.y, 75 * camera.zoom,
                        { r: 255, g: 180, b: 90 }, 0.7, 'torch');
            }
        }
    },
};
