// ============================================
// INNER MAP CHARACTERS — LPC Animated Character Sprites
// Loads, composites, and animates multi-layer LPC character
// sprite sheets for NPC and player rendering on the inner map.
//
// Each character is composited from layers:
//   body → head → legs → torso → hair
// Layers are pre-rendered to offscreen canvases for performance.
// ============================================

import { EraWardrobe } from '../world/eraWardrobe.js';

export const InnerMapCharacters = {
    // ── Configuration (loaded from innerMapRenderer.json) ──
    _presets: {},        // presetId → { layers: [...paths] }
    _npcTypeMap: {},     // npcType → [presetId, ...]
    _basePath: 'assets/lpc/Characters/',
    playerPreset: null,  // the player's own sprite, set from the HUD portrait

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
        // On guard: sword and shield held ready (a guard at their post)
        { key: 'ready',     file: 'Combat 1h - Idle',      frames: 2, fps: 1.5 },
        // On a rock face (ui/innerMapClimbing.js): the sheet has one row, the back turned
        { key: 'climb',     file: 'Climb',                 frames: 6, fps: 8, rows: 1 },
        // Drawing and loosing a bow or crossbow: only the bow's own sheet (Props/Bow/Wood/Shoot.png,
        // scripts/make_arms_shoot.py); every other layer is cut from frames it already has (SHOOT_PICK).
        // Played by frame (InnerMapBattle times it to the volley): time = frame index
        { key: 'shoot',     file: 'Shoot',                 frames: 6, fps: 1, pick: true },
        // Struck down: a child falls and lies on its back (only the child sprites have the sheet,
        // CHILD_FILES; ui/innerMapCombat.js draws its last frame for a child knocked out or dead).
        // Played by frame: time = frame index
        { key: 'hurt',      file: 'Hurt',                  frames: 6, fps: 1, rows: 1, childOnly: true },
    ],

    // The body's frame in each of the 6 shoot frames, per facing row (up, left, down, right):
    // side-on the ready stance, then the swing frames where the front arm comes up and reaches out
    // toward the facing; toward or away from the eye, the halfslash frames with the fist before the
    // chest. Must match BODY in scripts/make_arms_shoot.py, which placed the bow in those fists.
    SHOOT_PICK: (() => {
        const ud = [['Combat 1h - Idle', 0], ['Combat 1h - Halfslash', 1], ['Combat 1h - Halfslash', 2],
            ['Combat 1h - Halfslash', 3], ['Combat 1h - Halfslash', 3], ['Combat 1h - Halfslash', 2]];
        const side = [['Combat 1h - Idle', 0], ['Legacy - Swing', 3], ['Legacy - Swing', 4],
            ['Legacy - Swing', 5], ['Legacy - Swing', 5], ['Legacy - Swing', 5]];
        return [ud, side, ud, side];
    })(),

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

    // ── The era's wardrobe (world/eraWardrobe.js, data/eras.json) ──
    // The game sets the world's year each frame (setYear). In a younger world
    // an NPC's look is its preset fitted to the era — 'era:<era>:<preset>#<variant>',
    // composited on first need; the mature world (the default) draws the presets as they are.
    _era: null,          // the current era's record, or null (mature / no game)
    _year: null,
    _eraBases: new Set(),  // the configured NPC presets (fitted when the era asks)
    _eraPending: new Set(),

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
            this._eraBases = new Set();
            for (const [k, v] of Object.entries(configData.characterPresets)) {
                if (!k.startsWith('_')) { this._presets[k] = v; this._eraBases.add(k); }
            }
        }
        if (configData.childLooks && typeof configData.childLooks === 'object') this._childCfg = configData.childLooks;
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
                for (const anim of ['Walk', 'Idle', 'Combat 1h - Slash', ...this._EXTRA_ANIMS.map(ea => ea.file)]) {
                    const ea = this._EXTRA_ANIMS.find(e => e.file === anim);
                    if (ea && ea.pick && !layerPath.startsWith('Props/')) continue;
                    const path = this._sheetPath(layerPath, anim);
                    if (path) pathSet.add(path);
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
     * Add (or replace) one preset at runtime and composite it — the player's
     * own look from character creation. Loads only the sheets it needs, so it
     * works before (or without) loadAll. Resolves true once it can be drawn.
     */
    registerPreset(presetId, layers) {
        const preset = { layers: layers.slice() };
        this._presets[presetId] = preset;
        const anims = ['Walk', 'Idle', 'Combat 1h - Slash', ...this._EXTRA_ANIMS.map(ea => ea.file)];
        const picked = new Set(this._EXTRA_ANIMS.filter(ea => ea.pick).map(ea => ea.file));
        const promises = [];
        for (const layerPath of layers) {
            for (const anim of anims) {
                if (picked.has(anim) && !layerPath.startsWith('Props/')) continue;
                const fullPath = this._sheetPath(layerPath, anim);
                if (!fullPath || this._imageCache.has(fullPath)) continue;
                promises.push(new Promise(resolve => {
                    const img = new Image();
                    img.onload = () => { this._imageCache.set(fullPath, img); resolve(); };
                    img.onerror = () => resolve();
                    img.src = fullPath;
                }));
            }
        }
        return Promise.all(promises).then(() => {
            // A newer look may have replaced this one while the sheets loaded
            if (this._presets[presetId] !== preset) return false;
            this._compositePreset(presetId, preset);
            return this._composited.has(presetId);
        });
    },

    /**
     * Composite all layers for a preset into walk and idle offscreen canvases.
     */
    _compositePreset(presetId, preset) {
        // A long weapon (a spear, a pike, a polearm, a great axe) reaches past the 64px
        // frame: such a look keeps the whole 128px cell round the body
        const cell = preset.layers.some(l => this.LONG_PROPS.test(l)) ? this.FRAME_W * 2 : this.FRAME_W;
        const walkCanvas = this._compositeAnimation(preset.layers, 'Walk',
            this.WALK_FRAMES * cell, this.DIR_ROWS * cell, cell);
        const idleCanvas = this._compositeAnimation(preset.layers, 'Idle',
            this.IDLE_FRAMES * cell, this.DIR_ROWS * cell, cell);
        const slashCanvas = this._compositeAnimation(preset.layers, 'Combat 1h - Slash',
            this.SLASH_FRAMES * cell, this.DIR_ROWS * cell, cell);

        if (walkCanvas || idleCanvas) {
            const entry = {
                cell,
                walk: walkCanvas,
                idle: idleCanvas || walkCanvas,
                slash: slashCanvas || null,
            };
            // Composite extra animation types (sitting, emotes, halfslash, swing)
            for (const ea of this._EXTRA_ANIMS) {
                const canvas = ea.pick
                    ? this._compositePicked(preset.layers, ea.file, this.SHOOT_PICK, ea.frames, cell)
                    : this._compositeAnimation(preset.layers, ea.file, ea.frames * cell, this.DIR_ROWS * cell, cell);
                entry[ea.key] = canvas || null;
            }
            this._composited.set(presetId, entry);
        }
    },

    // Prop layers whose weapon reaches out of the 64px frame (scripts/make_arms_layers.py)
    LONG_PROPS: /^Props\/(Spear|Pike|Bill|Halberd|Dane Axe)\//,

    /**
     * Composite multiple layer images into a single offscreen canvas.
     * @param {string[]} layerPaths - Relative paths (within Characters/)
     * @param {string} animType - 'Walk' or 'Idle'
     * @param {number} width - Expected canvas width
     * @param {number} height - Expected canvas height
     * @returns {HTMLCanvasElement|null}
     */
    _compositeAnimation(layerPaths, animType, width, height, cellSize = this.FRAME_W) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        let anyLoaded = false;
        const cols = Math.round(width / cellSize), rows = Math.round(height / cellSize);

        for (const layerPath of layerPaths) {
            const fullPath = this._sheetPath(layerPath, animType);
            const img = fullPath ? this._imageCache.get(fullPath) : null;
            const prop = layerPath.startsWith('Props/');
            // Gear carried (a sword, a shield) has sheets only for combat: on the
            // walk, hold its ready-stance frame steady in the hand
            if (!img && prop && animType === this.PROP_CARRY_ANIM) {
                const ready = this._imageCache.get(this._basePath + layerPath + '/' + this.PROP_READY_FILE + '.png');
                if (ready) this._drawPropCarried(ctx, ready, cols, rows, cellSize);
                continue;
            }
            if (!img) continue;

            // Each source cell (64px, or 128px round the 64px figure for weapon sheets)
            // laid centred in each of ours: a 64px look crops a big cell's middle, a
            // 128px look keeps it whole and sets the 64px sheets in its middle
            const k = Math.max(1, Math.round(img.height / (rows * this.FRAME_H)));
            const src = this.FRAME_W * k;
            // (a sheet of one frame, as a child's standing pose: held across every frame of the row,
            // so no frame of the cycle is left empty)
            const one = Math.floor(img.width / src) === 1;
            const n = one ? cols : Math.min(cols, Math.floor(img.width / src)), m = Math.min(rows, Math.floor(img.height / src));
            const take = Math.min(src, cellSize);
            const so = (src - take) / 2, doff = (cellSize - take) / 2;
            for (let r = 0; r < m; r++) {
                for (let f = 0; f < n; f++) {
                    ctx.drawImage(img, (one ? 0 : f) * src + so, r * src + so, take, take,
                        f * cellSize + doff, r * cellSize + doff, take, take);
                }
            }
            anyLoaded = true;
        }

        return anyLoaded ? canvas : null;
    },

    /**
     * An animation no LPC body sheet has (the bow's shoot): a prop layer with its own sheet
     * (`file`) draws it whole; a prop without one is left out; every other layer takes, for
     * frame f of row r, frame pick[r][f][1] of its sheet pick[r][f][0]. Null when no prop
     * layer has the sheet (nothing to shoot with).
     */
    _compositePicked(layerPaths, file, pick, frames, cellSize = this.FRAME_W) {
        const own = layerPaths.filter(l => l.startsWith('Props/') && this._imageCache.get(this._basePath + l + '/' + file + '.png'));
        if (!own.length) return null;
        const canvas = document.createElement('canvas');
        canvas.width = frames * cellSize;
        canvas.height = this.DIR_ROWS * cellSize;
        const ctx = canvas.getContext('2d');
        const cellOf = (img, f, r, df, dr) => {
            const k = Math.max(1, Math.round(img.height / (this.DIR_ROWS * this.FRAME_H)));
            const src = this.FRAME_W * k;
            if ((f + 1) * src > img.width || (r + 1) * src > img.height) return;
            const take = Math.min(src, cellSize);
            const so = (src - take) / 2, doff = (cellSize - take) / 2;
            ctx.drawImage(img, f * src + so, r * src + so, take, take, df * cellSize + doff, dr * cellSize + doff, take, take);
        };
        for (const layerPath of layerPaths) {
            if (layerPath.startsWith('Props/')) {
                const img = this._imageCache.get(this._basePath + layerPath + '/' + file + '.png');
                if (!img) continue;
                for (let r = 0; r < this.DIR_ROWS; r++) for (let f = 0; f < frames; f++) cellOf(img, f, r, f, r);
                continue;
            }
            for (let r = 0; r < this.DIR_ROWS; r++) {
                for (let f = 0; f < frames; f++) {
                    const [anim, sf] = pick[r][f];
                    const path = this._sheetPath(layerPath, anim);
                    const img = path ? this._imageCache.get(path) : null;
                    if (img) cellOf(img, sf, r, f, r);
                }
            }
        }
        return canvas;
    },

    // Gear's ready-stance sheet ('Combat 1h - Idle'), and the animation it is carried through
    PROP_READY_FILE: 'Combat 1h - Idle',
    PROP_CARRY_ANIM: 'Walk',
    // How far (px) the hand rises on each of the 8 walk frames, so the gear moves with the stride
    WALK_BOB: [0, -1, -1, 0, 0, -1, -1, 0],

    /** A prop's first ready frame per direction, repeated across a walk sheet with the stride's bob. */
    _drawPropCarried(ctx, ready, cols, rows, cellSize = this.FRAME_W) {
        const k = Math.max(1, Math.round(ready.height / (rows * this.FRAME_H)));
        const src = this.FRAME_W * k;
        const take = Math.min(src, cellSize);
        const so = (src - take) / 2, doff = (cellSize - take) / 2;
        for (let r = 0; r < rows; r++) {
            for (let f = 0; f < cols; f++) {
                const bob = this.WALK_BOB[f % this.WALK_BOB.length] || 0;
                ctx.drawImage(ready, so, r * src + so, take, take,
                    f * cellSize + doff, r * cellSize + doff + bob, take, take);
            }
        }
    },

    // ══════════════════════════════════════════════
    // SHEET PATHS
    // ══════════════════════════════════════════════

    // The child sprites (assets/lpc/Characters/Children, scripts in the credits there) keep their
    // sheets in lowercase and have only these animations; every other one falls back to idle/walk
    CHILD_ROOT: 'Children/',
    CHILD_FILES: { Walk: 'walk', Idle: 'idle', Sitting: 'sit', Hurt: 'hurt' },

    /** The sheet of `anim` ('Walk', 'Sitting', …) for a layer, or null when that layer has none. */
    _sheetPath(layerPath, anim) {
        if (layerPath.startsWith(this.CHILD_ROOT)) {
            const f = this.CHILD_FILES[anim];
            return f ? `${this._basePath}${layerPath}/${f}.png` : null;
        }
        // (a sheet only the child sprites have is never fetched for a grown look)
        if (this._EXTRA_ANIMS.some(ea => ea.childOnly && ea.file === anim)) return null;
        return `${this._basePath}${layerPath}/${anim}.png`;
    },

    // ══════════════════════════════════════════════
    // CHILDREN'S LOOKS
    // ══════════════════════════════════════════════
    // A child under childLooks.under (data/innerMapRenderer.json) is drawn with the LPC child
    // body, head, pants or skirt, shirt and hair, barefoot. Its look is a self-describing id —
    // 'child:<skin>|<hair style>|<hair colour>|<shirt>|<Pants or Skirt>/<colour>' — registered
    // on first need, so a save holding one draws it again.

    _childCfg: null,
    _childPending: new Set(),

    /** data/innerMapRenderer.json childLooks (empty when not configured). */
    childConfig() {
        return this._childCfg || {};
    },

    /** Whether someone of `age` is drawn with the child sprites. */
    isChildAge(age) {
        const under = Number(this.childConfig().under);
        return Number.isFinite(age) && Number.isFinite(under) && age < under;
    },

    /** How big to draw a child sprite of `age` (1 its natural size), or null past the child sprites. */
    childScale(age) {
        if (!this.isChildAge(age)) return null;
        const S = this.childConfig().scale;
        const band = Array.isArray(S) ? S.find(b => age < Number(b.under)) : null;
        const s = band ? Number(band.s) : 1;
        return Number.isFinite(s) && s > 0 ? s : 1;
    },

    /** How big to draw someone (1 the grown): their own scale by age (npc._scale), else a child 0.7. */
    drawScale(who) {
        const n = who && who._npc ? who._npc : who;   // (a body left where they fell keeps its NPC)
        if (n && typeof n._scale === 'number' && n._scale > 0) return n._scale;
        return who && who.type === 'child' ? 0.7 : 1;
    },

    /** The layers of a child look { skin, hairStyle, hair, shirt, legs }. */
    childLayers(look) {
        return [
            `Children/Body/${look.skin}`,
            `Children/Head/Head 01 - Default/${look.skin}`,
            `Children/Clothing/${look.legs}`,
            `Children/Clothing/Shirt/${look.shirt}`,
            // (a pupil's satchel on a school day: strap over the shirt, under the hair)
            ...(look.bag ? [`Children/Satchel/${look.bag}`] : []),
            `Children/Hair/${look.hairStyle}/${look.hair}`,
        ];
    },

    childPresetId(look) {
        const id = `child:${[look.skin, look.hairStyle, look.hair, look.shirt, look.legs].join('|')}`;
        return look.bag ? `${id}|bag:${look.bag}` : id;
    },

    /** The same child look with a school satchel (`bag` its colour), or without one (bag null). */
    childWithSatchel(id, bag = 'Brown') {
        const look = this.childLookOf(id);
        if (!look) return id;
        return this.childPresetId({ ...look, bag: bag || null });
    },

    /** The look a child id names, or null. */
    childLookOf(id) {
        if (typeof id !== 'string' || !id.startsWith('child:')) return null;
        const [skin, hairStyle, hair, shirt, legs, extra] = id.slice(6).split('|');
        if (!skin || !hairStyle || !hair || !shirt || !legs || !/^(Pants|Skirt)\//.test(legs)) return null;
        const bag = extra && /^bag:/.test(extra) ? extra.slice(4) : null;
        return bag ? { skin, hairStyle, hair, shirt, legs, bag } : { skin, hairStyle, hair, shirt, legs };
    },

    /** Register (once) and composite a child look by its id. Resolves true once it can be drawn. */
    ensureChild(id) {
        if (this._composited.has(id)) return Promise.resolve(true);
        const look = this.childLookOf(id);
        if (!look || this._childPending.has(id)) return Promise.resolve(false);
        this._childPending.add(id);
        return this.registerPreset(id, this.childLayers(look)).finally(() => this._childPending.delete(id));
    },

    /** Skin and natural hair colour of a look (an adult preset, its era or greyed fitting, a child id). */
    looksOf(presetId) {
        const kid = this.childLookOf(presetId);
        if (kid) return { skin: kid.skin, hair: kid.hair };
        let base = String(presetId || '');
        let m = /^aged:[^:]+:(?:[^:]+#\d+:)?(.+)$/.exec(base);
        if (m) base = m[1];
        m = /^era:[^:]+:(.+)#\d+$/.exec(base);
        if (m) base = m[1];
        const pre = this._presets[base];
        if (!pre || !Array.isArray(pre.layers)) return null;
        const body = pre.layers.find(l => l.startsWith('Body/'));
        const hair = pre.layers.find(l => l.startsWith('Hair/') && !/^Hair\/(Eyebrows|Facial)/.test(l));
        const last = l => (l ? l.split('/').pop() : null);
        return { skin: last(body), hair: last(hair) };
    },

    /**
     * The look of a child: skin and hair colour from a parent (their presets, `parents`), else
     * from the household (`family`, a key siblings share); hair style by gender; clothes from the
     * family's means (`roles`: the parents' trades → childLooks.wealthByRole → wardrobe), in the cloth
     * of the era (`era`, else the current one → childLooks.eraWardrobe). Picks are hashes of `seed`,
     * never the RNG.
     */
    childLook({ seed = 0, gender = null, parents = [], family = null, roles = [], era = null } = {}) {
        const C = this.childConfig();
        const arr = v => (Array.isArray(v) ? v : []);
        const frac = (...k) => EraWardrobe._hash(k.join('|')) / 4294967296;
        const pick = (list, ...k) => (list.length ? list[Math.floor(frac(...k) * list.length) % list.length] : null);
        const skins = arr(C.skins), colours = arr(C.hairColours);
        const famKey = family != null ? String(family) : String(seed);
        const parentLooks = arr(parents).map(p => this.looksOf(p)).filter(Boolean);
        // Skin: a parent's (each child of the two takes after one), else the household's
        const fromSkin = pick(parentLooks.filter(l => skins.includes(l.skin)), seed, 'skin');
        const skin = (fromSkin && fromSkin.skin) || pick(skins, famKey, 'skin') || 'Peach';
        // Hair: a parent's natural colour (the grey of their age not passed on)
        const grey = C.greyHairBecomes || {};
        const fromHair = pick(parentLooks.filter(l => l.hair), seed, 'hair');
        let hair = fromHair ? (grey[fromHair.hair] || fromHair.hair) : pick(arr(C.familyHair), famKey, 'hair');
        if (!colours.includes(hair)) hair = colours.includes(C.defaultHair) ? C.defaultHair : (colours[0] || 'Brown');
        const g = gender === 'female' ? 'female' : 'male';
        const styles = arr((C.hairStyles || {})[g]);
        const hairStyle = pick(styles, seed, 'style') || 'Swoop';
        // Clothes by the family's means: the best-off parent's trade
        const rank = { common: 0, comfortable: 1, noble: 2 };
        const byRole = C.wealthByRole || {};
        let wealth = 'common';
        for (const r of arr(roles)) {
            const w = byRole[r];
            if (w && (rank[w] || 0) > (rank[wealth] || 0)) wealth = w;
        }
        // (an era before the mature world dresses its children in its own cloth: childLooks.eraWardrobe,
        // by the family's means or one wardrobe for all — the Dawn's earthy undyed tunics)
        const EW = (C.eraWardrobe || {})[era || this.eraId()];
        const eraW = EW ? (EW[wealth] || EW.common || (Array.isArray(EW.shirts) ? EW : null)) : null;
        const W = eraW || (C.wardrobe || {})[wealth] || (C.wardrobe || {}).common || {};
        const skirt = frac(seed, 'skirt') < Number((C.skirtChance || {})[g] || 0) && arr(W.skirts).length;
        const shirt = pick(arr(W.shirts), seed, 'shirt') || 'White';
        const legs = skirt ? `Skirt/${pick(arr(W.skirts), seed, 'legs')}` : `Pants/${pick(arr(W.pants), seed, 'legs') || 'Brown'}`;
        return { skin, hairStyle, hair, shirt, legs };
    },

    // ══════════════════════════════════════════════
    // APPEARANCE ASSIGNMENT
    // ══════════════════════════════════════════════

    /**
     * Get a character preset ID for an NPC based on type and seed.
     * @param {string} npcType - e.g. 'villager', 'guard'
     * @param {number} seed - Deterministic seed (e.g. npc.id)
     * @param {string} [gender] - 'male' / 'female' to prefer that gender's presets
     * @returns {string|null} Preset ID
     */
    getPresetForNPC(npcType, seed, gender = null) {
        let presets = this._npcTypeMap[npcType];
        // A known gender picks among that gender's looks, when the type has any
        if (gender && presets) {
            const own = presets.filter(id => id.startsWith(`${gender}_`));
            if (own.length) presets = own;
        }
        if (!presets || presets.length === 0) {
            // Fallback: pick from all presets — but never the player's own
            // look (registerPreset 'player:…'), or a stranger wears your face
            // (nor an era's fitting of a preset: the preset itself is fitted below)
            const allKeys = Object.keys(this._presets).filter(id => !id.startsWith('player:') && !id.startsWith('era:') && !id.startsWith('child:'));
            if (allKeys.length === 0) return null;
            return this._eraPreset(allKeys[Math.abs(seed) % allKeys.length], seed);
        }
        return this._eraPreset(presets[Math.abs(seed) % presets.length], seed);
    },

    // ══════════════════════════════════════════════
    // THE ERA'S WARDROBE
    // ══════════════════════════════════════════════

    /** The world's current year (from the game loop): picks the era the looks are fitted to. */
    setYear(year) {
        if (year === this._year) return;
        this._year = year;
        const era = year == null ? null : EraWardrobe.eraOf(year);
        this._era = era && !EraWardrobe.isModern(era) ? era : null;
    },

    /** The current era's id ('late' in the mature world). */
    eraId() {
        return this._era ? this._era.id : 'late';
    },

    /** A layer recipe fitted to the current era, for a wearer named by `seed` (as it is in the mature world). */
    eraLayers(layers, seed = 0) {
        return this._era ? EraWardrobe.fit(layers, this._era, seed) : layers;
    },

    /** An NPC preset as the era's wearer `seed` wears it (the preset itself in the mature world). */
    _eraPreset(base, seed) {
        if (!this._era || !base || !this._eraBases.has(base)) return base;
        const v = EraWardrobe._hash(String(seed)) % EraWardrobe.variants();
        return `era:${this._era.id}:${base}#${v}`;
    },

    /**
     * The preset to draw for an id: an era look made in another era (the
     * centuries passed, or a save from another age) is re-fitted to this one,
     * a plain NPC preset is fitted when the era asks. A fitted look not yet
     * composited is started, and its plain preset drawn meanwhile.
     */
    _live(presetId) {
        if (typeof presetId !== 'string') return presetId;
        // A child's look (childPresetId) is made from its own id: one from a save, or not yet composited, is started
        if (presetId.startsWith('child:')) { if (!this._composited.has(presetId)) this.ensureChild(presetId); return presetId; }
        let base = null, v = 0;
        if (presetId.startsWith('era:')) {
            const m = /^era:([^:]+):(.+)#(\d+)$/.exec(presetId);
            if (!m) return presetId;
            base = m[2]; v = Number(m[3]);
            if (!this._era) return base;
            if (m[1] === this._era.id && this._composited.has(presetId)) return presetId;
        } else {
            if (!this._era || !this._eraBases.has(presetId)) return presetId;
            base = presetId;
        }
        if (!this._presets[base]) return presetId;
        const id = `era:${this._era.id}:${base}#${v}`;
        if (this._composited.has(id)) return id;
        if (!this._eraPending.has(id)) {
            this._eraPending.add(id);
            const layers = EraWardrobe.fit(this._presets[base].layers || [], this._era, `${base}#${v}`);
            this.registerPreset(id, layers).finally(() => this._eraPending.delete(id));
        }
        return base;
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
        presetId = this._live(presetId);
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

        // Source rectangle from the composited sheet (a long weapon's look has 128px
        // cells round the figure: drawn twice the size, about the same middle)
        const cell = comp.cell || this.FRAME_W;
        const sx = frameIndex * cell;
        const sy = (extraDef && extraDef.rows === 1 && comp[anim] ? 0 : direction) * cell;
        if (cell !== this.FRAME_W) {
            const k = cell / this.FRAME_W;
            ctx.drawImage(sheet, sx, sy, cell, cell, dx - dw * (k - 1) / 2, dy - dh * (k - 1) / 2, dw * k, dh * k);
            return true;
        }
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
        return this._composited.get(this._live(presetId)) || null;
    },

    /** Whether a look has the fall-and-lie sheet (the child sprites): drawn lying, not turned on its side. */
    hasHurt(presetId) {
        const comp = this.getComposited(presetId);
        return !!(comp && comp.hurt);
    },
};
