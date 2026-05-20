// ============================================
// INNER MAP CHARACTERS — LPC Animated Character Sprites
// Loads, composites, and animates multi-layer LPC character
// sprite sheets for NPC and player rendering on the inner map.
//
// Each character is composited from layers:
//   body → head → legs → torso → hair
// Layers are pre-rendered to offscreen canvases for performance.
// ============================================


export const InnerMapCharacters = {
    // ── Configuration (loaded from innerMapRenderer.json) ──
    _presets: {},        // presetId → { layers: [...paths] }
    _npcTypeMap: {},     // npcType → [presetId, ...]
    _basePath: 'assets/lpc/Characters/',

    // ── Sprite sheet cache ──
    _imageCache: new Map(),   // full path → HTMLImageElement
    _composited: new Map(),   // presetId → { walk: Canvas, idle: Canvas }

    // ── Animation constants ──
    FRAME_W: 64,
    FRAME_H: 64,
    WALK_FRAMES: 8,      // 8 frames per direction row
    IDLE_FRAMES: 3,      // 3 frames per direction row (1 is static pose)
    SLASH_FRAMES: 6,     // 6 frames per direction row (LPC 'Combat 1h - Slash')
    DIR_ROWS: 4,         // up=0, left=1, down=2, right=3
    WALK_FPS: 10,        // frames per second for walk cycle
    IDLE_FPS: 2,         // frames per second for idle cycle
    SLASH_FPS: 12,       // frames per second for slash/attack cycle

    // Extra animation types loaded from LPC sheets
    // key: internal anim key used by drawCharacter
    // file: LPC sprite sheet filename (without .png)
    // frames/fps: playback parameters
    _EXTRA_ANIMS: [
        { key: 'sitting',   file: 'Sitting',              frames: 3, fps: 2  },
        { key: 'emotes',    file: 'Emotes',               frames: 3, fps: 2  },
        { key: 'halfslash', file: 'Combat 1h - Halfslash', frames: 6, fps: 12 },
        { key: 'swing',     file: 'Legacy - Swing',        frames: 6, fps: 12 },
    ],

    // Map from object-definition animation name → internal drawCharacter anim key
    ANIM_KEY_MAP: {
        'combat_1h_slash': 'slash',
        'combat_1h_halfslash': 'halfslash',
        'legacy_swing': 'swing',
        'sitting': 'sitting',
        'emotes': 'emotes',
        'idle': 'idle',
        'climb': 'idle',  // climb has only 1 direction row; fall back to idle
    },

    // Animation types that don't deal damage to the object
    NON_DESTRUCTIVE_ANIMS: new Set(['sitting', 'emotes', 'idle']),

    // Direction constants
    DIR_UP: 0,
    DIR_LEFT: 1,
    DIR_DOWN: 2,
    DIR_RIGHT: 3,

    // ── State ──
    _loaded: false,
    _loading: false,

    // ══════════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════════

    /**
     * Load character configuration from renderer config data.
     * Called after innerMapRenderer.json is loaded.
     */
    configure(configData) {
        if (configData.characterPresets) {
            this._presets = {};
            for (const [k, v] of Object.entries(configData.characterPresets)) {
                if (!k.startsWith('_')) this._presets[k] = v;
            }
        }
        if (configData.npcAppearanceMap) {
            this._npcTypeMap = {};
            for (const [k, v] of Object.entries(configData.npcAppearanceMap)) {
                if (!k.startsWith('_')) this._npcTypeMap[k] = v;
            }
        }
        console.log(`InnerMapCharacters configured: ${Object.keys(this._presets).length} presets, ` +
            `${Object.keys(this._npcTypeMap).length} NPC type mappings`);
    },

    /**
     * Load and composite all character preset sprites.
     * Returns a Promise that resolves when all sheets are composited.
     */
    loadAll() {
        if (this._loaded || this._loading) return Promise.resolve();
        this._loading = true;

        // Collect all unique image paths needed
        const pathSet = new Set();
        for (const preset of Object.values(this._presets)) {
            if (!preset.layers) continue;
            for (const layerPath of preset.layers) {
                pathSet.add(this._basePath + layerPath + '/Walk.png');
                pathSet.add(this._basePath + layerPath + '/Idle.png');
                pathSet.add(this._basePath + layerPath + '/Combat 1h - Slash.png');
                for (const ea of this._EXTRA_ANIMS) {
                    pathSet.add(this._basePath + layerPath + '/' + ea.file + '.png');
                }
            }
        }

        // Load all images in parallel
        const promises = [];
        for (const fullPath of pathSet) {
            if (this._imageCache.has(fullPath)) continue;
            const img = new Image();
            const p = new Promise(resolve => {
                img.onload = () => {
                    this._imageCache.set(fullPath, img);
                    resolve();
                };
                img.onerror = () => {
                    // Gracefully skip missing layers
                    resolve();
                };
            });
            img.src = fullPath;
            promises.push(p);
        }

        return Promise.all(promises).then(() => {
            // Composite each preset
            for (const [presetId, preset] of Object.entries(this._presets)) {
                if (!preset.layers) continue;
                this._compositePreset(presetId, preset);
            }
            this._loaded = true;
            this._loading = false;
            console.log(`InnerMapCharacters loaded: ${this._imageCache.size} images, ` +
                `${this._composited.size} composited presets`);
        });
    },

    /**
     * Composite all layers for a preset into walk and idle offscreen canvases.
     */
    _compositePreset(presetId, preset) {
        const walkCanvas = this._compositeAnimation(preset.layers, 'Walk',
            this.WALK_FRAMES * this.FRAME_W, this.DIR_ROWS * this.FRAME_H);
        const idleCanvas = this._compositeAnimation(preset.layers, 'Idle',
            this.IDLE_FRAMES * this.FRAME_W, this.DIR_ROWS * this.FRAME_H);
        const slashCanvas = this._compositeAnimation(preset.layers, 'Combat 1h - Slash',
            this.SLASH_FRAMES * this.FRAME_W, this.DIR_ROWS * this.FRAME_H);

        if (walkCanvas || idleCanvas) {
            const entry = {
                walk: walkCanvas,
                idle: idleCanvas || walkCanvas,
                slash: slashCanvas || null,
            };
            // Composite extra animation types (sitting, emotes, halfslash, swing)
            for (const ea of this._EXTRA_ANIMS) {
                const canvas = this._compositeAnimation(preset.layers, ea.file,
                    ea.frames * this.FRAME_W, this.DIR_ROWS * this.FRAME_H);
                entry[ea.key] = canvas || null;
            }
            this._composited.set(presetId, entry);
        }
    },

    /**
     * Composite multiple layer images into a single offscreen canvas.
     * @param {string[]} layerPaths - Relative paths (within Characters/)
     * @param {string} animType - 'Walk' or 'Idle'
     * @param {number} width - Expected canvas width
     * @param {number} height - Expected canvas height
     * @returns {HTMLCanvasElement|null}
     */
    _compositeAnimation(layerPaths, animType, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        let anyLoaded = false;

        for (const layerPath of layerPaths) {
            const fullPath = this._basePath + layerPath + '/' + animType + '.png';
            const img = this._imageCache.get(fullPath);
            if (!img) continue;

            // Draw the layer — all LPC sheets are pre-aligned for compositing
            ctx.drawImage(img, 0, 0, Math.min(img.width, width), Math.min(img.height, height),
                0, 0, Math.min(img.width, width), Math.min(img.height, height));
            anyLoaded = true;
        }

        return anyLoaded ? canvas : null;
    },

    // ══════════════════════════════════════════════
    // APPEARANCE ASSIGNMENT
    // ══════════════════════════════════════════════

    /**
     * Get a character preset ID for an NPC based on type and seed.
     * @param {string} npcType - e.g. 'villager', 'guard'
     * @param {number} seed - Deterministic seed (e.g. npc.id)
     * @returns {string|null} Preset ID
     */
    getPresetForNPC(npcType, seed) {
        const presets = this._npcTypeMap[npcType];
        if (!presets || presets.length === 0) {
            // Fallback: pick from all presets
            const allKeys = Object.keys(this._presets);
            if (allKeys.length === 0) return null;
            return allKeys[Math.abs(seed) % allKeys.length];
        }
        return presets[Math.abs(seed) % presets.length];
    },

    // ══════════════════════════════════════════════
    // DIRECTION COMPUTATION
    // ══════════════════════════════════════════════

    /**
     * Compute facing direction from movement delta.
     * @param {number} dq - Column delta (positive = right)
     * @param {number} dr - Row delta (positive = down)
     * @returns {number} Direction row (0=up, 1=left, 2=down, 3=right)
     */
    getDirection(dq, dr) {
        if (Math.abs(dq) >= Math.abs(dr)) {
            return dq >= 0 ? this.DIR_RIGHT : this.DIR_LEFT;
        }
        return dr >= 0 ? this.DIR_DOWN : this.DIR_UP;
    },

    // ══════════════════════════════════════════════
    // FRAME RENDERING
    // ══════════════════════════════════════════════

    /**
     * Draw a character frame onto the given context.
     * @param {CanvasRenderingContext2D} ctx - Target context
     * @param {string} presetId - Character preset ID
     * @param {string} anim - 'walk' or 'idle'
     * @param {number} direction - 0=up, 1=left, 2=down, 3=right
     * @param {number} time - Current time in seconds (for frame cycling)
     * @param {number} dx - Destination X on canvas
     * @param {number} dy - Destination Y on canvas
     * @param {number} dw - Destination width
     * @param {number} dh - Destination height
     */
    drawCharacter(ctx, presetId, anim, direction, time, dx, dy, dw, dh) {
        const comp = this._composited.get(presetId);
        if (!comp) return false;

        // Check if this is an extra animation type (sitting, emotes, halfslash, swing)
        const extraDef = this._EXTRA_ANIMS.find(ea => ea.key === anim);

        // Resolve sheet — slash/extra anims fall back to walk if the asset is missing
        const isSlash = (anim === 'slash');
        const isWalk  = (anim === 'walk');
        let sheet;
        if (isSlash) {
            sheet = comp.slash || comp.walk || comp.idle;
        } else if (extraDef) {
            sheet = comp[anim] || comp.idle || comp.walk;
        } else {
            sheet = comp[anim] || comp.idle || comp.walk;
        }
        if (!sheet) return false;

        let totalFrames, fps;
        if (extraDef) {
            // Extra animation type — use its defined frame count and fps
            if (comp[anim]) {
                totalFrames = extraDef.frames;
                fps         = extraDef.fps;
            } else {
                // Fell back to idle/walk
                totalFrames = comp.idle === sheet ? this.IDLE_FRAMES : this.WALK_FRAMES;
                fps         = comp.idle === sheet ? this.IDLE_FPS : this.WALK_FPS;
            }
        } else if (isSlash) {
            if (comp.slash) {
                totalFrames = this.SLASH_FRAMES;
                fps         = this.SLASH_FPS;
            } else {
                totalFrames = this.WALK_FRAMES;
                fps         = this.WALK_FPS * 2;
            }
        } else if (isWalk) {
            totalFrames = this.WALK_FRAMES;
            fps         = this.WALK_FPS;
        } else {
            totalFrames = this.IDLE_FRAMES;
            fps         = this.IDLE_FPS;
        }

        // Compute current frame
        const frameIndex = Math.floor(time * fps) % totalFrames;

        // Source rectangle from the composited sheet
        const sx = frameIndex * this.FRAME_W;
        const sy = direction * this.FRAME_H;

        ctx.drawImage(sheet, sx, sy, this.FRAME_W, this.FRAME_H, dx, dy, dw, dh);
        return true;
    },

    /**
     * Check if character sprites are loaded and ready.
     */
    isReady() {
        return this._loaded && this._composited.size > 0;
    },

    /**
     * Get the composited canvas for direct access (e.g., test page).
     */
    getComposited(presetId) {
        return this._composited.get(presetId) || null;
    },
};
