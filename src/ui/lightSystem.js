// ============================================
// LIGHT SYSTEM — 2D dynamic lighting with day/night cycle
// Inspired by: https://pvigier.github.io/2019/07/28/vagabond-2d-light-system.html
//
// Technique:
//   1. Render an ambient darkness layer to an offscreen canvas
//   2. Cut out light volumes using 'destination-out' compositing
//   3. Add colored light tint using additive blend
//   4. Composite the result onto the main canvas
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
        // Player always carries a faint visibility light
        // At night it becomes a torch light
        const baseRadius = 80 * zoom;
        const nightBonus = darkness * 120 * zoom;
        const radius = baseRadius + nightBonus;

        // Warm torch color at night, subtle glow during day
        const color = darkness > 0.1
            ? { r: 255, g: 180, b: 80 }
            : { r: 255, g: 240, b: 200 };

        this.addLight(screenX, screenY, radius, color, 0.95, darkness > 0.1 ? 'torch' : 'point');
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
            tavern:      { radius: 100, color: { r: 255, g: 190, b: 90 },  intensity: 0.9, type: 'fire' },
            blacksmith:  { radius: 90,  color: { r: 255, g: 140, b: 40 },  intensity: 0.85, type: 'fire' },
            church:      { radius: 80,  color: { r: 255, g: 240, b: 200 }, intensity: 0.7, type: 'point' },
            temple:      { radius: 90,  color: { r: 220, g: 200, b: 255 }, intensity: 0.75, type: 'point' },
            town_hall:   { radius: 85,  color: { r: 255, g: 210, b: 120 }, intensity: 0.8, type: 'torch' },
            marketplace: { radius: 70,  color: { r: 255, g: 200, b: 100 }, intensity: 0.6, type: 'torch' },
            barracks:    { radius: 60,  color: { r: 255, g: 180, b: 80 },  intensity: 0.5, type: 'torch' },
            manor:       { radius: 100, color: { r: 255, g: 220, b: 150 }, intensity: 0.85, type: 'torch' },
            house:       { radius: 50,  color: { r: 255, g: 200, b: 120 }, intensity: 0.5, type: 'point' },
            farm:        { radius: 40,  color: { r: 255, g: 190, b: 100 }, intensity: 0.3, type: 'point' },
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
        this.addLight(screenX, screenY, 110 * zoom,
            { r: 255, g: 160, b: 50 }, 0.95, 'fire');
    },

    /**
     * Add a torch light (for roads, walls)
     */
    addTorchLight(screenX, screenY, zoom) {
        this.addLight(screenX, screenY, 55 * zoom,
            { r: 255, g: 170, b: 60 }, 0.75, 'torch');
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
        const numLights = lights.length;

        // ── Step 1: Fill shadow canvas with ambient darkness ──
        const ac = this.ambientColor;
        sctx.globalCompositeOperation = 'source-over';
        sctx.fillStyle = `rgba(${ac.r}, ${ac.g}, ${ac.b}, ${this.ambientDarkness.toFixed(3)})`;
        sctx.fillRect(0, 0, w, h);

        // ── Pre-compute flicker values for all lights (used in steps 2 & 3) ──
        // Store resolved radius and intensity to avoid duplicate trig in the color pass
        const resolvedRadius = new Float64Array(numLights);
        const resolvedIntensity = new Float64Array(numLights);

        for (let i = 0; i < numLights; i++) {
            const light = lights[i];
            let radius = light.radius;
            let intensity = light.intensity;

            if (light.flicker) {
                const flickerSpeed = light.type === 'fire' ? 8 : 6;
                const flickerAmt = light.type === 'fire' ? 0.12 : 0.08;
                const flicker = 1.0
                    + Math.sin(time * flickerSpeed + light.x * 0.1) * flickerAmt
                    + Math.sin(time * flickerSpeed * 1.7 + light.y * 0.13) * (flickerAmt * 0.5)
                    + Math.sin(time * flickerSpeed * 3.1) * (flickerAmt * 0.3);
                radius *= flicker;
                intensity *= (0.9 + Math.sin(time * flickerSpeed * 0.8) * 0.1);
            }

            resolvedRadius[i] = radius;
            resolvedIntensity[i] = intensity;
        }

        // ── Step 2: Cut out light volumes using 'destination-out' ──
        sctx.globalCompositeOperation = 'destination-out';

        for (let i = 0; i < numLights; i++) {
            const light = lights[i];
            const radius = resolvedRadius[i];
            const intensity = resolvedIntensity[i];

            // Skip lights entirely offscreen (cheap bounds check)
            if (light.x + radius < 0 || light.x - radius > w ||
                light.y + radius < 0 || light.y - radius > h) continue;

            const centerAlpha = Math.min(1, intensity);
            const grad = sctx.createRadialGradient(
                light.x, light.y, 0,
                light.x, light.y, radius
            );
            grad.addColorStop(0, `rgba(0,0,0,${centerAlpha.toFixed(3)})`);
            grad.addColorStop(0.3, `rgba(0,0,0,${(centerAlpha * 0.8).toFixed(3)})`);
            grad.addColorStop(0.6, `rgba(0,0,0,${(centerAlpha * 0.4).toFixed(3)})`);
            grad.addColorStop(0.85, `rgba(0,0,0,${(centerAlpha * 0.1).toFixed(3)})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');

            sctx.fillStyle = grad;
            sctx.beginPath();
            sctx.arc(light.x, light.y, radius, 0, Math.PI * 2);
            sctx.fill();
        }

        // ── Step 3: Add colored light tint where darkness was removed ──
        sctx.globalCompositeOperation = 'destination-over';

        for (let i = 0; i < numLights; i++) {
            const light = lights[i];
            const radius = resolvedRadius[i] * 0.8;

            // Skip lights entirely offscreen
            if (light.x + radius < 0 || light.x - radius > w ||
                light.y + radius < 0 || light.y - radius > h) continue;

            const c = light.color;
            const tintAlpha = 0.08 * resolvedIntensity[i] * this.ambientDarkness;
            if (tintAlpha < 0.005) continue;

            const grad = sctx.createRadialGradient(
                light.x, light.y, 0,
                light.x, light.y, radius
            );
            grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${tintAlpha.toFixed(3)})`);
            grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);

            sctx.fillStyle = grad;
            sctx.beginPath();
            sctx.arc(light.x, light.y, radius, 0, Math.PI * 2);
            sctx.fill();
        }

        // ── Step 4: Composite shadow canvas onto the main canvas ──
        sctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(this._shadowCanvas, 0, 0);
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

        // Indoor override: less darkness inside buildings (artificial light)
        if (InnerMap._insideBuilding) {
            this.ambientDarkness = Math.min(this.ambientDarkness, 0.3);
            this.ambientColor = { r: 20, g: 15, b: 10 };
        }
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

        // ── Road torches — place lights along roads at night ──
        if (this.ambientDarkness > 0.3 && InnerMap.roads && InnerMap.roads.length > 0) {
            for (let i = 0; i < InnerMap.roads.length; i += 4) {
                const road = InnerMap.roads[i];
                if (road.q < qMin - 1 || road.q > qMax + 1) continue;
                if (road.r < rMin - 1 || road.r > rMax + 1) continue;

                const screen = camera.worldToScreenFast(road.q * T + T / 2, road.r * T + T / 2);
                this.addTorchLight(screen.x, screen.y, camera.zoom);
            }
        }

        // ── NPC-carried lights at night ──
        if (this.ambientDarkness > 0.4 && InnerMap.npcs) {
            for (const npc of InnerMap.npcs) {
                if (npc.type === 'guard' || npc.type === 'merchant' || npc.type === 'innkeeper') {
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
                    this.addLight(screen.x, screen.y, 50 * camera.zoom,
                        { r: 255, g: 190, b: 90 }, 0.6, 'torch');
                }
            }
        }
    },
};
