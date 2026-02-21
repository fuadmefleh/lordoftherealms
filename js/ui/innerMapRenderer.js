// ============================================
// INNER MAP RENDERER — Renders the inner map overlay
// Draws a detailed sub-hex-grid for exploring world tiles
// Uses the SAME PNG tile sprites as the world map renderer
// ============================================

const InnerMapRenderer = {
    hexSize: 54,  // Same as world map hex size

    /** Reference to the world-map Renderer (set via setRenderer) */
    _renderer: null,

    /**
     * Store a reference to the world-map Renderer so we can
     * access its tileSprites and getTileImage logic.
     */
    setRenderer(renderer) {
        this._renderer = renderer;
    },

    // ── Sub-terrain → sprite mapping ──────────────────────────
    // Maps each (parentTerrain, subTerrainId) pair to the same
    // PNG sprite filenames used by the world-map renderer.
    // Falls back to per-parent defaults when no specific entry exists.

    /** Default sprites per parent terrain (mirrors Renderer.getTileImage) */
    _parentDefaults: {
        grassland:           ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'],
        plains:              ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png', 'hexDirt01.png', 'hexDirt02.png'],
        woodland:            ['hexWoodlands01.png', 'hexWoodlands02.png', 'hexWoodlands03.png', 'hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        forest:              ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        dense_forest:        ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        seasonal_forest:     ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        boreal_forest:       ['cold/hexForestPine00.png', 'cold/hexForestPine01.png', 'cold/hexForestPine02.png', 'cold/hexForestPine03.png'],
        temperate_rainforest:['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        tropical_rainforest: ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        desert:              ['hexDesertDunes01.png', 'hexDesertDunes02.png', 'hexDesertDunes03.png'],
        savanna:             ['hexScrublands01.png', 'hexScrublands02.png', 'hexScrublands03.png'],
        mountain:            ['hexMountain01.png', 'hexMountain02.png', 'hexMountain03.png'],
        snow_peak:           ['cold/hexMountainSnow00.png', 'cold/hexMountainSnow01.png', 'cold/hexMountainSnow02.png', 'cold/hexMountainSnow03.png'],
        hills:               ['hexHills01.png', 'hexHills02.png', 'hexHills03.png'],
        highlands:           ['hexHighlands01.png', 'hexHighlands02.png', 'hexHighlands03.png'],
        swamp:               ['tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png', 'tropics_wetlands/hexSwamp02.png', 'tropics_wetlands/hexSwamp03.png'],
        tundra:              ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png', 'cold/hexPlainsCold02.png', 'cold/hexPlainsCold03.png'],
        snow:                ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png', 'cold/hexSnowField03.png'],
        ice:                 ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png', 'cold/hexSnowField03.png'],
        beach:               ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png', 'tropics_wetlands/hexSand02.png', 'tropics_wetlands/hexSand03.png'],
        island:              ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png', 'tropics_wetlands/hexSand02.png', 'tropics_wetlands/hexSand03.png'],
    },

    /** Per-subTerrain sprite overrides (keyed by subTerrain.id) */
    _subTerrainSprites: {
        // ── Grassland / Plains sub-terrains ──
        grass:           ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'],
        tall_grass:      ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'],
        flowers:         ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'],
        clearing:        ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'],
        dry_grass:       ['hexPlains01.png', 'hexDirt01.png', 'hexDirt02.png'],
        wheat_field:     ['hexPlains01.png', 'hexPlains02.png'],
        rocks:           ['hexDirt01.png', 'hexDirt02.png'],
        dirt_path:       ['hexDirt01.png', 'hexDirt02.png'],
        campsite:        ['hexDirt01.png', 'hexDirt02.png'],
        bush:            ['hexWoodlands01.png', 'hexWoodlands02.png', 'hexWoodlands03.png'],
        scrub:           ['hexScrublands01.png', 'hexScrublands02.png', 'hexScrublands03.png'],
        pond:            ['ocean/hexLake00.png', 'ocean/hexLake01.png', 'ocean/hexLake02.png'],
        watering_hole:   ['ocean/hexLake00.png', 'ocean/hexLake01.png', 'ocean/hexLake02.png'],
        stream:          ['ocean/hexLake00.png', 'ocean/hexLake01.png'],
        frozen_stream:   ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],

        // ── Woodland / Forest sub-terrains ──
        light_trees:     ['hexWoodlands01.png', 'hexWoodlands02.png', 'hexWoodlands03.png'],
        deciduous_trees: ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        dense_brush:     ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        thicket:         ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        underbrush:      ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        fallen_log:      ['hexWoodlands01.png', 'hexWoodlands02.png', 'hexWoodlands03.png'],
        mushrooms:       ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        fallen_leaves:   ['hexWoodlands01.png', 'hexWoodlands02.png'],
        fruit_trees:     ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        ancient_tree:    ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        bird_nest:       ['hexWoodlands01.png', 'hexWoodlands02.png'],
        hollow_tree:     ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],

        // ── Boreal / Cold forest sub-terrains ──
        pine_trees:      ['cold/hexForestPine00.png', 'cold/hexForestPine01.png', 'cold/hexForestPine02.png', 'cold/hexForestPine03.png'],
        fallen_pine:     ['cold/hexForestPine00.png', 'cold/hexForestPine01.png'],
        moss:            ['cold/hexForestPine00.png', 'cold/hexForestPine01.png'],
        bear_den:        ['cold/hexForestPine00.png', 'cold/hexForestPine01.png'],
        berries:         ['cold/hexForestPine00.png', 'cold/hexForestPine01.png'],
        snow_patch:      ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png'],
        pine_grove:      ['cold/hexForestPineSnowCovered00.png', 'cold/hexForestPineSnowCovered01.png'],

        // ── Tropical / Rainforest sub-terrains ──
        giant_ferns:     ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        moss_trees:      ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        vine_canopy:     ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        fungus:          ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        hollow:          ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        muddy_ground:    ['hexDirt01.png', 'hexDirt02.png'],
        waterfall:       ['ocean/hexLake00.png', 'ocean/hexLake01.png'],
        pool:            ['ocean/hexLake00.png', 'ocean/hexLake01.png'],
        jungle_thick:    ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
        jungle_floor:    ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        bamboo:          ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        ruins_overgrown: ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        canopy_gap:      ['hexPlains01.png', 'hexPlains02.png'],
        fruit_grove:     ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        vines:           ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        quicksand:       ['hexDirt01.png', 'hexDirt02.png'],
        river:           ['ocean/hexLake00.png', 'ocean/hexLake01.png'],

        // ── Desert sub-terrains ──
        sand_dunes:      ['hexDesertDunes01.png', 'hexDesertDunes02.png', 'hexDesertDunes03.png'],
        sand_flat:       ['hexDesertDunes01.png', 'hexDesertDunes02.png'],
        rocky_ground:    ['hexDesertDunes01.png', 'hexDirt01.png', 'hexDirt02.png'],
        cactus:          ['hexDesertRedForest00.png', 'hexDesertDunes01.png'],
        oasis_small:     ['ocean/hexLake00.png', 'ocean/hexLake01.png'],
        bleached_bones:  ['hexDesertDunes01.png', 'hexDesertDunes02.png'],
        sandstone:       ['hexDesertDunes01.png', 'hexDesertDunes02.png'],

        // ── Savanna sub-terrains ──
        acacia_tree:     ['hexScrublands01.png', 'hexScrublands02.png'],
        termite_mound:   ['hexScrublands01.png', 'hexScrublands02.png'],
        rocky_outcrop:   ['hexDirt01.png', 'hexDirt02.png'],
        dried_riverbed:  ['hexDirt01.png', 'hexDirt02.png'],
        animal_trail:    ['hexScrublands01.png', 'hexScrublands02.png'],

        // ── Mountain sub-terrains ──
        bare_rock:       ['hexMountain01.png', 'hexMountain02.png', 'hexMountain03.png'],
        scree:           ['hexMountain01.png', 'hexMountain02.png'],
        cliff_face:      ['hexMountain01.png', 'hexMountain02.png', 'hexMountain03.png'],
        ledge:           ['hexMountain01.png', 'hexMountain02.png'],
        mountain_stream: ['ocean/hexLake00.png', 'ocean/hexLake01.png'],
        cave_entrance:   ['hexMountain01.png', 'hexMountain02.png'],
        alpine_meadow:   ['hexPlains01.png', 'hexPlains02.png'],
        mineral_vein:    ['hexMountain01.png', 'hexMountain02.png'],
        snow_cap:        ['cold/hexMountainSnow00.png', 'cold/hexMountainSnow01.png', 'cold/hexMountainSnow02.png'],

        // ── Hills sub-terrains ──
        grassy_hill:     ['hexHills01.png', 'hexHills02.png', 'hexHills03.png'],
        rocky_hill:      ['hexHills01.png', 'hexHills02.png', 'hexHills03.png'],
        valley:          ['hexPlains01.png', 'hexPlains02.png'],
        brook:           ['ocean/hexLake00.png', 'ocean/hexLake01.png'],
        quarry:          ['hexHills01.png', 'hexHills02.png'],
        shepherds_rest:  ['hexHills01.png', 'hexHills02.png'],
        wildflowers:     ['hexPlains01.png', 'hexPlains02.png'],
        lookout_point:   ['hexHills01.png', 'hexHills02.png'],
        stone_circle:    ['hexHills01.png', 'hexHills02.png'],

        // ── Swamp sub-terrains ──
        murky_water:     ['tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png', 'tropics_wetlands/hexSwamp02.png'],
        bog:             ['tropics_wetlands/hexWetlands00.png', 'tropics_wetlands/hexWetlands01.png', 'tropics_wetlands/hexWetlands02.png'],
        dead_trees:      ['tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png'],
        moss_bank:       ['tropics_wetlands/hexWetlands00.png', 'tropics_wetlands/hexWetlands01.png'],
        lily_pads:       ['tropics_wetlands/hexWetlands00.png', 'tropics_wetlands/hexWetlands01.png'],
        mist_patch:      ['tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png'],
        dry_mound:       ['tropics_wetlands/hexWetlands00.png', 'tropics_wetlands/hexWetlands01.png'],
        will_o_wisp:     ['tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png'],

        // ── Tundra sub-terrains ──
        frozen_ground:   ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png', 'cold/hexPlainsCold02.png'],
        permafrost:      ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png'],
        lichen:          ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png'],
        frozen_pool:     ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        wind_swept:      ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png'],
        snow_drift:      ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        stone_cairn:     ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png'],
        reindeer_tracks: ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png'],

        // ── Snow sub-terrains ──
        snow_field:      ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png', 'cold/hexSnowField03.png'],
        ice_sheet:       ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        snow_bank:       ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png'],
        ice_cave:        ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        tracks:          ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        wind_shelter:    ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],

        // ── Ice sub-terrains ──
        thick_ice:       ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png'],
        crevasse:        ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        snow_cover:      ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png'],
        ice_spire:       ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        glacier:         ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        frozen_lake:     ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],
        wind_carved:     ['cold/hexSnowField00.png', 'cold/hexSnowField01.png'],

        // ── Highlands sub-terrains ──
        heather:         ['hexHighlands01.png', 'hexHighlands02.png', 'hexHighlands03.png'],
        rocky_terrain:   ['hexHighlands01.png', 'hexHighlands02.png'],
        hill_grass:      ['hexHighlands01.png', 'hexHighlands02.png', 'hexHighlands03.png'],
        bog_patch:       ['tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png'],
        stone_wall:      ['hexHighlands01.png', 'hexHighlands02.png'],
        spring:          ['ocean/hexLake00.png', 'ocean/hexLake01.png'],
        cairn:           ['hexHighlands01.png', 'hexHighlands02.png'],
        sheep_meadow:    ['hexHighlands01.png', 'hexHighlands02.png', 'hexHighlands03.png'],

        // ── Beach sub-terrains ──
        sand:            ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png', 'tropics_wetlands/hexSand02.png'],
        tide_pools:      ['ocean/hexLake00.png', 'ocean/hexLake01.png'],
        driftwood:       ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png'],
        seaweed:         ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png'],
        rocky_shore:     ['ocean/hexIslandRocky00.png', 'ocean/hexIslandRocky01.png'],
        shallow_water:   ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png'],
        palm_tree:       ['tropics_wetlands/hexSandPalms00.png', 'tropics_wetlands/hexSandPalms01.png', 'tropics_wetlands/hexSandPalms02.png'],
        shell_deposit:   ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png'],

        // ── Island sub-terrains ──
        palm_grove:      ['tropics_wetlands/hexSandPalms00.png', 'tropics_wetlands/hexSandPalms01.png', 'tropics_wetlands/hexSandPalms02.png'],
        lagoon:          ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png'],
        rocky_coast:     ['ocean/hexIslandRocky00.png', 'ocean/hexIslandRocky01.png'],
        tropical_bush:   ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png'],
        coconut_tree:    ['tropics_wetlands/hexSandPalms00.png', 'tropics_wetlands/hexSandPalms01.png'],
        campfire_ring:   ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png'],
        shipwreck:       ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png'],
    },

    /**
     * Get the sprite filename for an inner-map tile.
     * Uses subTerrain.id with a fallback to parentTerrain defaults.
     */
    _getInnerTileSprite(tile) {
        const subId = tile.subTerrain.id;
        const parent = tile.parentTerrain;

        // Deterministic hash from tile coords (same approach as world map)
        const hash = Math.abs((tile.q * 73856093 ^ tile.r * 19349663) % 100);

        // Try subTerrain-specific sprites first, then parent defaults
        const variants = this._subTerrainSprites[subId] || this._parentDefaults[parent];
        if (!variants || variants.length === 0) return null;

        const index = hash % variants.length;
        return variants[index];
    },

    /**
     * Render the inner map on the given canvas context
     * @param {CanvasRenderingContext2D} ctx
     * @param {HTMLCanvasElement} canvas
     * @param {Object} camera - Camera for inner map (pan/zoom)
     * @param {number} deltaTime
     */
    render(ctx, canvas, camera, deltaTime) {
        if (!InnerMap.active || !InnerMap.tiles) return;

        const w = canvas.width;
        const h = canvas.height;

        // Dark background
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, 0, w, h);

        ctx.save();

        // Render inner hex grid
        this.renderInnerHexGrid(ctx, camera);

        // Render roads
        this.renderRoads(ctx, camera);

        // Render encounters
        this.renderEncounters(ctx, camera);

        // Render building labels
        this.renderBuildingLabels(ctx, camera);

        // Render NPCs
        this.renderNPCs(ctx, camera, deltaTime);

        // Render player
        this.renderInnerPlayer(ctx, camera);

        // Render hover highlight
        if (this._hoveredInnerHex) {
            this.renderInnerHexHighlight(ctx, camera, this._hoveredInnerHex.q, this._hoveredInnerHex.r,
                'rgba(255,255,255,0.15)', 'rgba(255,255,255,0.4)');
        }

        // Render selected highlight
        if (this._selectedInnerHex) {
            this.renderInnerHexHighlight(ctx, camera, this._selectedInnerHex.q, this._selectedInnerHex.r,
                'rgba(245,197,66,0.15)', 'rgba(245,197,66,0.6)');
        }

        ctx.restore();

        // Time-of-day ambient overlay
        const ambientColor = InnerMap.getAmbientOverlay();
        if (ambientColor) {
            ctx.fillStyle = ambientColor;
            ctx.fillRect(0, 0, w, h);
        }

        // Weather tint overlay
        const weatherColor = InnerMap.getWeatherOverlay();
        if (weatherColor) {
            ctx.fillStyle = weatherColor;
            ctx.fillRect(0, 0, w, h);
        }

        // Temperature tint overlay
        const tempColor = InnerMap.getTemperatureOverlay();
        if (tempColor) {
            ctx.fillStyle = tempColor;
            ctx.fillRect(0, 0, w, h);
        }

        // Render weather particles (rain / snow)
        this.renderWeatherParticles(ctx, canvas, camera, deltaTime);

        // Render HUD overlay
        this.renderHUD(ctx, canvas);
    },

    /**
     * Get pixel position for an inner map hex
     */
    getInnerHexPixelPos(q, r) {
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;

        const px = q * hexWidth + ((r % 2 === 0) ? hexWidth / 2 : 0);
        const py = r * rowHeight;
        return { x: px, y: py };
    },

    /**
     * Render the inner hex grid using PNG tile sprites
     */
    renderInnerHexGrid(ctx, camera) {
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;
        const tileSprites = this._renderer ? this._renderer.tileSprites : null;

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];

                const pos = this.getInnerHexPixelPos(q, r);
                const screen = camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * camera.zoom;

                // Culling
                if (screen.x < -hexWidth * camera.zoom * 2 || screen.x > ctx.canvas.width + hexWidth * camera.zoom * 2) continue;
                if (screen.y < -hexHeight * camera.zoom * 2 || screen.y > ctx.canvas.height + hexHeight * camera.zoom * 2) continue;

                const corners = Hex.hexCorners(screen.x, screen.y, renderSize);

                // ── Unexplored fog-of-war ──
                if (!tile.explored) {
                    ctx.beginPath();
                    ctx.moveTo(corners[0].x, corners[0].y);
                    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
                    ctx.closePath();
                    ctx.fillStyle = '#0a0e17';
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                    continue;
                }

                // ── Resolve sprite ──
                const imgName = this._getInnerTileSprite(tile);
                const sprite  = (imgName && tileSprites) ? tileSprites.get(imgName) : null;

                ctx.save();

                if (sprite) {
                    // Draw sprite using the same approach as Renderer.renderSpriteHex:
                    // scale to cover hex, anchor at bottom, draw unclipped first.
                    const rHexW = hexWidth * camera.zoom;
                    const rHexH = hexHeight * camera.zoom;

                    let targetW = rHexW;
                    let targetH = targetW;

                    if (sprite.width && sprite.height) {
                        const scaleX = rHexW / sprite.width;
                        const scaleY = rHexH / sprite.height;
                        const scale  = Math.max(scaleX, scaleY);
                        targetW = sprite.width * scale;
                        targetH = sprite.height * scale;
                    }

                    const bottomY = screen.y + renderSize;
                    const drawX   = screen.x - targetW / 2;
                    const drawY   = bottomY - targetH;

                    ctx.drawImage(sprite, drawX, drawY, targetW, targetH);
                } else {
                    // Fallback: coloured hex fill (in case sprite not loaded)
                    ctx.beginPath();
                    ctx.moveTo(corners[0].x, corners[0].y);
                    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
                    ctx.closePath();
                    ctx.fillStyle = tile.subTerrain.color;
                    ctx.fill();
                }

                // ── Clip to hex shape for overlays ──
                ctx.beginPath();
                ctx.moveTo(corners[0].x, corners[0].y);
                for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
                ctx.closePath();
                ctx.clip();

                // Dim explored-but-not-visible tiles (fog of war)
                if (!tile.visible) {
                    ctx.fillStyle = 'rgba(10, 14, 23, 0.55)';
                    ctx.fill();
                }

                // Impassable tint
                if (!tile.subTerrain.passable && tile.visible) {
                    ctx.strokeStyle = 'rgba(255,80,80,0.3)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                // Per-tile weather / temperature tint (visible tiles only)
                if (tile.visible && tile.weatherType) {
                    if (tile.weatherType === 'snow') {
                        ctx.fillStyle = 'rgba(220, 230, 245, 0.12)';
                        ctx.fill();
                    } else if (tile.weatherType === 'rain' || tile.weatherType === 'storm') {
                        ctx.fillStyle = 'rgba(30, 50, 80, 0.08)';
                        ctx.fill();
                    }
                }
                // Subtle frost tint for very cold tiles
                if (tile.visible && tile.effectiveTemp !== undefined && tile.effectiveTemp < 0.2) {
                    const frostAlpha = (0.2 - tile.effectiveTemp) * 0.3;
                    ctx.fillStyle = `rgba(200, 220, 255, ${frostAlpha.toFixed(3)})`;
                    ctx.fill();
                }

                ctx.restore();

                // ── Building overlay ──
                if (tile.building && tile.visible && tileSprites) {
                    // Dim under-construction player properties
                    const isUnderConstruction = tile._propertyRef && tile._propertyRef.underConstruction;
                    if (isUnderConstruction) ctx.globalAlpha = 0.45;

                    const bldSprite = tileSprites.get(tile.building);
                    if (bldSprite && bldSprite.width && bldSprite.height) {
                        // Large sprites (256x384 villages etc) fill the hex tile.
                        // Small sprites (signs, wells, barns) stay proportionally smaller.
                        const refW = 256;
                        const refH = 384;
                        const isFullTile = (bldSprite.width >= refW && bldSprite.height >= refH);
                        if (isFullTile) {
                            // Same scaling as terrain sprites — fill the hex
                            const rHexW = hexWidth * camera.zoom;
                            const rHexH = hexHeight * camera.zoom;
                            const scX = rHexW / bldSprite.width;
                            const scY = rHexH / bldSprite.height;
                            const sc  = Math.max(scX, scY);
                            const bW = bldSprite.width  * sc;
                            const bH = bldSprite.height * sc;
                            const bBottomY = screen.y + renderSize;
                            ctx.drawImage(bldSprite, screen.x - bW / 2, bBottomY - bH, bW, bH);
                        } else {
                            // Small props: scale using reference so they stay proportional
                            const sc = Math.min(
                                (hexWidth  * camera.zoom * 0.70) / refW,
                                (hexHeight * camera.zoom * 0.70) / refH
                            );
                            const finalW = bldSprite.width  * sc;
                            const finalH = bldSprite.height * sc;
                            const bDrawX = screen.x - finalW / 2;
                            const bDrawY = screen.y + renderSize * 0.15 - finalH;
                            ctx.drawImage(bldSprite, bDrawX, bDrawY, finalW, finalH);
                        }
                    }

                    // Reset alpha and draw construction hammer for under-construction buildings
                    if (isUnderConstruction) {
                        ctx.globalAlpha = 1.0;
                        const hammerSize = Math.max(14, renderSize * 0.6);
                        ctx.font = `${hammerSize}px serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('🔨', screen.x, screen.y - renderSize * 0.2);
                    }
                }

                // ── Decoration overlays (small props scattered on tile) ──
                if (tile.decorations && tile.decorations.length > 0 && tile.visible && tileSprites) {
                    const refW = 256;
                    const refH = 384;
                    const hexW = hexWidth * camera.zoom;
                    const hexH = hexHeight * camera.zoom;
                    // Scale factor — decorations are smaller than main buildings
                    const decoScale = Math.min(
                        (hexW * 0.50) / refW,
                        (hexH * 0.50) / refH
                    );
                    for (const deco of tile.decorations) {
                        const decoSprite = tileSprites.get(deco.sprite);
                        if (!decoSprite || !decoSprite.width || !decoSprite.height) continue;
                        const dW = decoSprite.width  * decoScale;
                        const dH = decoSprite.height * decoScale;
                        const dX = screen.x + deco.ox * hexW - dW / 2;
                        const dY = screen.y + deco.oy * hexH - dH / 2;
                        ctx.drawImage(decoSprite, dX, dY, dW, dH);
                    }
                }

                // ── Hex border ──
                ctx.beginPath();
                ctx.moveTo(corners[0].x, corners[0].y);
                for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
                ctx.closePath();
                ctx.strokeStyle = tile.visible ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)';
                ctx.lineWidth = 0.6;
                ctx.stroke();


            }
        }
    },

    /**
     * Render encounters on the inner map
     */
    renderEncounters(ctx, camera) {
        const size = this.hexSize;

        for (let r = 0; r < InnerMap.height; r++) {
            for (let q = 0; q < InnerMap.width; q++) {
                const tile = InnerMap.tiles[r][q];
                if (!tile.visible || !tile.encounter) continue;

                const pos = this.getInnerHexPixelPos(q, r);
                const screen = camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * camera.zoom;

                if (tile.encounter.discovered) {
                    // Show discovered encounter icon
                    const iconSize = Math.max(14, renderSize * 0.5);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.globalAlpha = 0.85;
                    ctx.fillText(tile.encounter.icon, screen.x, screen.y - renderSize * 0.15);
                    ctx.globalAlpha = 1.0;

                    // Draw discovered label
                    if (camera.zoom > 0.7) {
                        const fontSize = Math.max(7, 8 * camera.zoom);
                        ctx.font = `600 ${fontSize}px 'Inter', sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.fillStyle = '#f5c542';
                        ctx.shadowColor = 'rgba(0,0,0,0.7)';
                        ctx.shadowBlur = 3;
                        ctx.fillText(tile.encounter.name, screen.x, screen.y + renderSize * 0.2);
                        ctx.shadowBlur = 0;
                    }
                } else {
                    // Undiscovered: show a subtle glimmer
                    ctx.beginPath();
                    ctx.arc(screen.x, screen.y - renderSize * 0.1, renderSize * 0.08, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(245,197,66,0.4)';
                    ctx.fill();
                }
            }
        }
    },

    /**
     * Render the player on the inner map
     */
    renderInnerPlayer(ctx, camera) {
        const pos = this.getInnerHexPixelPos(InnerMap.playerInnerQ, InnerMap.playerInnerR);
        const screen = camera.worldToScreen(pos.x, pos.y);
        const renderSize = this.hexSize * camera.zoom;

        // Player glow
        const gradient = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, renderSize * 0.6);
        gradient.addColorStop(0, 'rgba(245,197,66,0.3)');
        gradient.addColorStop(1, 'rgba(245,197,66,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, renderSize * 0.6, 0, Math.PI * 2);
        ctx.fill();

        // Player icon
        const iconSize = Math.max(16, renderSize * 0.65);
        ctx.font = `${iconSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('🧭', screen.x, screen.y);
        ctx.shadowBlur = 0;

        // "You" label
        if (camera.zoom > 0.5) {
            const fontSize = Math.max(8, 10 * camera.zoom);
            ctx.font = `700 ${fontSize}px 'Inter', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#f5c542';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText('You', screen.x, screen.y + renderSize * 0.4);
            ctx.shadowBlur = 0;
        }
    },

    /**
     * Render hex highlight
     */
    renderInnerHexHighlight(ctx, camera, q, r, fillColor, strokeColor) {
        const pos = this.getInnerHexPixelPos(q, r);
        const screen = camera.worldToScreen(pos.x, pos.y);
        const renderSize = this.hexSize * camera.zoom;

        const corners = Hex.hexCorners(screen.x, screen.y, renderSize);

        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();

        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();
    },

    // ══════════════════════════════════════════════
    // WEATHER PARTICLES — Rain / Snow over inner map
    // ══════════════════════════════════════════════

    /** Internal particle array — recycled each frame */
    _weatherParticles: [],
    _weatherParticleTimer: 0,

    /**
     * Render weather overlay particles (rain lines, snowflakes, storm flash).
     */
    renderWeatherParticles(ctx, canvas, camera, deltaTime) {
        const w = InnerMap.weather;
        if (!w || w.type === 'clear' || w.type === 'cloudy' || w.type === 'none') return;

        const cw = canvas.width;
        const ch = canvas.height;
        const intensity = Math.min(w.intensity, 1);

        if (w.type === 'rain' || w.type === 'storm') {
            // --- Rain ---
            const dropCount = Math.floor(40 + intensity * 80);
            ctx.save();
            ctx.strokeStyle = w.type === 'storm'
                ? 'rgba(160, 180, 220, 0.5)'
                : 'rgba(170, 195, 230, 0.35)';
            ctx.lineWidth = w.type === 'storm' ? 1.8 : 1.2;
            ctx.beginPath();

            // Deterministic-ish rain using time accumulator
            this._weatherParticleTimer += deltaTime;
            const t = this._weatherParticleTimer * 120;
            for (let i = 0; i < dropCount; i++) {
                const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
                const sx = ((seed * 1.17 + t * 0.7 + i * 37) % cw + cw) % cw;
                const sy = ((seed * 2.31 + t * 2.5 + i * 53) % ch + ch) % ch;
                const len = (8 + intensity * 8) * (w.type === 'storm' ? 1.4 : 1.0);
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx - 2, sy + len);
            }
            ctx.stroke();
            ctx.restore();

            // Storm lightning flash
            if (w.type === 'storm' && Math.random() < 0.008) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.fillRect(0, 0, cw, ch);
            }
        } else if (w.type === 'snow') {
            // --- Snow ---
            const flakeCount = Math.floor(30 + intensity * 60);
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
            this._weatherParticleTimer += deltaTime;
            const t = this._weatherParticleTimer * 40;
            ctx.beginPath();
            for (let i = 0; i < flakeCount; i++) {
                const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
                const sx = ((seed * 3.71 + t * 0.3 + i * 41 + Math.sin(t * 0.02 + i) * 20) % cw + cw) % cw;
                const sy = ((seed * 1.93 + t * 0.8 + i * 61) % ch + ch) % ch;
                const r = 1.2 + (Math.abs(seed * 7) % 2);
                ctx.moveTo(sx + r, sy);
                ctx.arc(sx, sy, r, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.restore();
        }
    },

    /**
     * Render the HUD overlay for inner map
     */
    renderHUD(ctx, canvas) {
        const summary = InnerMap.getSummary();
        if (!summary) return;

        // Top bar background
        const barHeight = 48;
        ctx.fillStyle = 'rgba(16, 20, 28, 0.92)';
        ctx.fillRect(0, 0, canvas.width, barHeight);
        ctx.fillStyle = 'rgba(245,197,66,0.15)';
        ctx.fillRect(0, barHeight - 1, canvas.width, 1);

        // World tile info
        const worldTile = InnerMap.currentWorldTile;
        const terrainId = summary.parentTerrain;
        const terrainDef = Terrain.TYPES[terrainId.toUpperCase()] || {};

        // Left side: location
        ctx.font = '600 13px "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f5c542';

        const settlement = InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement;
        const locationName = settlement ? settlement.name : (terrainDef.name || terrainId);
        ctx.fillText(`🗺️ ${locationName}`, 16, barHeight / 2 - 8);

        // Sub-info
        ctx.font = '400 11px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        const subInfo = settlement
            ? `${settlement.type} · Pop: ${Utils.formatNumber(settlement.population)}`
            : `${terrainDef.name || terrainId} (${worldTile.q}, ${worldTile.r})`;

        // Append weather / temperature snippet
        const wIcons = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '❄️' };
        const wt = InnerMap.weather;
        const tmp = InnerMap.temperature;
        let weatherStr = '';
        if (wt) weatherStr += ` · ${wIcons[wt.type] || ''} ${wt.type}`;
        if (tmp) weatherStr += ` ${tmp.celsius}°C`;
        ctx.fillText(subInfo + weatherStr, 16, barHeight / 2 + 8);

        // Center: time of day
        const timeStr = InnerMap.getTimeString();
        const period = InnerMap.getTimePeriod();
        const periodIcons = { morning: '🌅', midday: '☀️', afternoon: '🌤️', evening: '🌇', night: '🌙' };
        ctx.font = '700 15px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${periodIcons[period] || '⏰'} ${timeStr}`, canvas.width / 2, barHeight / 2 - 6);

        // Time progress bar
        const barWidth = 120;
        const barX = canvas.width / 2 - barWidth / 2;
        const barY = barHeight / 2 + 8;
        const progress = InnerMap.timeOfDay / 24;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(barX, barY, barWidth, 4);
        ctx.fillStyle = progress > 0.75 ? '#e74c3c' : progress > 0.5 ? '#f39c12' : '#4FC3F7';
        ctx.fillRect(barX, barY, barWidth * progress, 4);

        // Right: exploration / buildings info
        ctx.textAlign = 'right';
        ctx.font = '500 11px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        const buildingCount = InnerMap.buildings.length;
        const npcCount = InnerMap.npcs.length;
        if (buildingCount > 0) {
            ctx.fillText(`🏠 ${buildingCount} buildings  👥 ${npcCount} people`, canvas.width - 16, barHeight / 2 - 6);
        } else {
            ctx.fillText(`Explored: ${summary.exploredPercent}%  |  Discoveries: ${summary.discoveredEncounters}/${summary.encounters}`, canvas.width - 16, barHeight / 2 - 6);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '400 10px "Inter", sans-serif';
        ctx.fillText('ESC to return · Right-click to move/interact', canvas.width - 16, barHeight / 2 + 10);
    },

    /**
     * Get hex at screen position in inner map
     */
    getInnerHexAtScreen(screenX, screenY, camera) {
        const worldPos = camera.screenToWorld(screenX, screenY);

        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;

        const approxR = Math.round(worldPos.y / rowHeight);
        const approxQ = Math.round(worldPos.x / hexWidth);

        let bestHex = null;
        let minDistSq = Infinity;

        for (let r = approxR - 1; r <= approxR + 1; r++) {
            for (let q = approxQ - 1; q <= approxQ + 1; q++) {
                if (r < 0 || r >= InnerMap.height) continue;
                if (q < 0 || q >= InnerMap.width) continue;

                const px = q * hexWidth + ((r % 2 === 0) ? hexWidth / 2 : 0);
                const py = r * rowHeight;

                const distSq = (worldPos.x - px) ** 2 + (worldPos.y - py) ** 2;
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    bestHex = { q, r };
                }
            }
        }

        return bestHex;
    },

    // Hover/selection state for inner map
    _hoveredInnerHex: null,
    _selectedInnerHex: null,

    // ══════════════════════════════════════════════
    // ROAD RENDERING — Draw paths between buildings
    // ══════════════════════════════════════════════

    /**
     * Render roads using PNG road sprites on the inner map.
     * Mirrors the world-map road rendering:
     *   – build a 6-bit neighbour bitmask per road tile
     *   – look up the matching sprite from the world renderer's roadVariants
     *   – draw it as a full-hex overlay
     */
    renderRoads(ctx, camera) {
        if (!InnerMap.roads || InnerMap.roads.length === 0) return;
        if (!this._renderer || !this._renderer.roadVariants) return;

        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;
        const tileSprites = this._renderer.tileSprites;
        const roadVariants = this._renderer.roadVariants;

        // Build a fast lookup of road / building positions
        const roadSet = new Set(InnerMap.roads.map(r => `${r.q},${r.r}`));
        // Buildings also count as road endpoints
        if (InnerMap.buildings) {
            for (const b of InnerMap.buildings) {
                roadSet.add(`${b.q},${b.r}`);
            }
        }

        for (const road of InnerMap.roads) {
            const tile = InnerMap.getTile(road.q, road.r);
            if (!tile || !tile.visible) continue;
            // Never draw roads on impassable / water tiles
            if (!tile.subTerrain.passable) continue;
            // Never draw road sprites over tiles that have buildings
            if (tile.building) continue;

            const pos = this.getInnerHexPixelPos(road.q, road.r);
            const screen = camera.worldToScreen(pos.x, pos.y);
            const renderSize = size * camera.zoom;

            // Culling
            if (screen.x < -hexWidth * camera.zoom * 2 || screen.x > ctx.canvas.width + hexWidth * camera.zoom * 2) continue;
            if (screen.y < -hexHeight * camera.zoom * 2 || screen.y > ctx.canvas.height + hexHeight * camera.zoom * 2) continue;

            // Build 6-bit neighbour bitmask (same indexing as world map)
            const neighbors = Hex.neighbors(road.q, road.r);
            let mask = 0;
            for (let i = 0; i < 6; i++) {
                const n = neighbors[i];
                if (n.r < 0 || n.r >= InnerMap.height || n.q < 0 || n.q >= InnerMap.width) continue;
                if (roadSet.has(`${n.q},${n.r}`)) {
                    mask |= (1 << ((i + 3) % 6));
                }
            }

            if (mask === 0) continue;

            const key = mask.toString(2).padStart(6, '0');
            const variants = roadVariants.get(key);
            if (!variants || variants.length === 0) continue;

            // Pick a deterministic variant for this tile
            const hash = Math.abs((road.q * 73856093 ^ road.r * 19349663) % variants.length);
            const imgName = variants[hash];
            const sprite = tileSprites.get(imgName);
            if (!sprite || !sprite.width || !sprite.height) continue;

            // Scale to fill hex (same as world renderer)
            const rHexW = hexWidth * camera.zoom;
            const rHexH = hexHeight * camera.zoom;
            const scaleX = rHexW / sprite.width;
            const scaleY = rHexH / sprite.height;
            const scale = Math.max(scaleX, scaleY);
            const targetW = sprite.width * scale;
            const targetH = sprite.height * scale;

            const bottomY = screen.y + renderSize;
            const drawX = screen.x - targetW / 2;
            const drawY = bottomY - targetH;

            // Clip to hex boundary so road sprite doesn't bleed onto neighbours
            ctx.save();
            const corners = Hex.hexCorners(screen.x, screen.y, renderSize);
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            for (let ci = 1; ci < 6; ci++) ctx.lineTo(corners[ci].x, corners[ci].y);
            ctx.closePath();
            ctx.clip();

            ctx.drawImage(sprite, drawX, drawY, targetW, targetH);
            ctx.restore();
        }
    },

    // ══════════════════════════════════════════════
    // BUILDING LABEL RENDERING — Names above buildings
    // ══════════════════════════════════════════════

    /**
     * Render building name labels above building sprites
     */
    renderBuildingLabels(ctx, camera) {
        if (!InnerMap.buildings || InnerMap.buildings.length === 0) return;
        if (camera.zoom < 0.5) return; // Don't show labels when zoomed far out

        const size = this.hexSize;

        for (const bldg of InnerMap.buildings) {
            const tile = InnerMap.getTile(bldg.q, bldg.r);
            if (!tile || !tile.visible) continue;

            const pos = this.getInnerHexPixelPos(bldg.q, bldg.r);
            const screen = camera.worldToScreen(pos.x, pos.y);
            const renderSize = size * camera.zoom;

            // Building name label
            const fontSize = Math.max(8, 10 * camera.zoom);
            ctx.font = `600 ${fontSize}px 'Inter', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';

            // Background pill for label
            const labelText = `${bldg.icon} ${bldg.name}`;
            const metrics = ctx.measureText(labelText);
            const pillW = metrics.width + 10;
            const pillH = fontSize + 6;
            const pillX = screen.x - pillW / 2;
            const pillY = screen.y - renderSize * 1.0 - pillH;

            ctx.fillStyle = 'rgba(16, 20, 28, 0.85)';
            ctx.beginPath();
            const rad = 4;
            ctx.moveTo(pillX + rad, pillY);
            ctx.lineTo(pillX + pillW - rad, pillY);
            ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + rad);
            ctx.lineTo(pillX + pillW, pillY + pillH - rad);
            ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - rad, pillY + pillH);
            ctx.lineTo(pillX + rad, pillY + pillH);
            ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - rad);
            ctx.lineTo(pillX, pillY + rad);
            ctx.quadraticCurveTo(pillX, pillY, pillX + rad, pillY);
            ctx.closePath();
            ctx.fill();

            // Player properties get a green border; settlement buildings get gold
            // Under-construction player properties get orange border
            const isPlayerProp = bldg.isPlayerProperty;
            const isBuilding = isPlayerProp && bldg.propertyRef && bldg.propertyRef.underConstruction;
            if (isBuilding) {
                ctx.strokeStyle = 'rgba(245, 197, 66, 0.7)';
                ctx.lineWidth = 1.5;
            } else if (isPlayerProp) {
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.6)';
                ctx.lineWidth = 1.5;
            } else {
                ctx.strokeStyle = 'rgba(245, 197, 66, 0.4)';
                ctx.lineWidth = 1;
            }
            ctx.stroke();

            ctx.fillStyle = isBuilding ? '#e0a040' : (isPlayerProp ? '#2ecc71' : '#f5c542');
            ctx.fillText(labelText, screen.x, pillY + pillH - 3);
        }
    },

    // ══════════════════════════════════════════════
    // NPC RENDERING — Townspeople walking around
    // ══════════════════════════════════════════════

    /**
     * Render NPCs on the inner map
     */
    renderNPCs(ctx, camera, deltaTime) {
        if (!InnerMap.npcs || InnerMap.npcs.length === 0) return;

        const size = this.hexSize;

        for (const npc of InnerMap.npcs) {
            // Determine display position (interpolate for smooth walking)
            let displayQ = npc.q;
            let displayR = npc.r;

            if (npc.state === 'walking' && npc.path && npc.pathIndex < npc.path.length) {
                const target = npc.path[npc.pathIndex];
                const progress = npc.moveProgress;
                // Interpolate pixel positions
                const fromPos = this.getInnerHexPixelPos(npc.q, npc.r);
                const toPos = this.getInnerHexPixelPos(target.q, target.r);
                const interpX = fromPos.x + (toPos.x - fromPos.x) * progress;
                const interpY = fromPos.y + (toPos.y - fromPos.y) * progress;

                const screen = camera.worldToScreen(interpX, interpY);
                const renderSize = size * camera.zoom;

                // Culling
                if (screen.x < -renderSize * 2 || screen.x > ctx.canvas.width + renderSize * 2) continue;
                if (screen.y < -renderSize * 2 || screen.y > ctx.canvas.height + renderSize * 2) continue;

                this._drawNPC(ctx, npc, screen.x, screen.y, renderSize, camera.zoom);
                continue;
            }

            const pos = this.getInnerHexPixelPos(displayQ, displayR);
            const screen = camera.worldToScreen(pos.x, pos.y);
            const renderSize = size * camera.zoom;

            // Culling
            if (screen.x < -renderSize * 2 || screen.x > ctx.canvas.width + renderSize * 2) continue;
            if (screen.y < -renderSize * 2 || screen.y > ctx.canvas.height + renderSize * 2) continue;

            this._drawNPC(ctx, npc, screen.x, screen.y, renderSize, camera.zoom);
        }
    },

    /**
     * Draw a single NPC at a screen position
     */
    _drawNPC(ctx, npc, sx, sy, renderSize, zoom) {
        // NPC shadow
        ctx.beginPath();
        ctx.ellipse(sx, sy + renderSize * 0.3, renderSize * 0.15, renderSize * 0.06, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();

        // NPC icon
        const iconSize = Math.max(12, renderSize * 0.45);
        ctx.font = `${iconSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(npc.icon, sx, sy + renderSize * 0.05);

        // NPC name (only when zoomed in enough)
        if (zoom > 0.7) {
            const fontSize = Math.max(6, 7 * zoom);
            ctx.font = `500 ${fontSize}px 'Inter', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            ctx.shadowBlur = 2;
            ctx.fillText(npc.name, sx, sy + renderSize * 0.35);
            ctx.shadowBlur = 0;
        }
    },

    // ══════════════════════════════════════════════
    // CONTEXT MENU — Right-click building/NPC interaction
    // ══════════════════════════════════════════════

    /**
     * Show a context menu for an inner map tile (building/NPC/terrain)
     */
    showContextMenu(game, q, r, screenX, screenY) {
        // Remove any existing context menu
        this.closeContextMenu();

        const tile = InnerMap.getTile(q, r);
        if (!tile || !tile.visible) return;

        const building = InnerMap.getBuildingAt(q, r);
        const npcsHere = InnerMap.getNPCsAt(q, r);
        const isPlayerHere = (q === InnerMap.playerInnerQ && r === InnerMap.playerInnerR);

        // Build menu items
        const menuItems = [];

        // Building actions
        if (building) {
            const actions = InnerMap.getBuildingActions(building);
            menuItems.push({ type: 'header', label: `${building.icon} ${building.name}` });

            for (const action of actions) {
                if (action === 'closed') {
                    menuItems.push({ type: 'disabled', label: '🚫 Closed', desc: 'This place is closed for the night' });
                    continue;
                }
                const actionDef = this._getActionDef(action);
                menuItems.push({
                    type: 'action',
                    action: action,
                    label: actionDef.label,
                    icon: actionDef.icon,
                    desc: actionDef.desc,
                    building: building,
                });
            }
        }

        // NPC interactions
        if (npcsHere.length > 0) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            menuItems.push({ type: 'header', label: '👥 People Here' });
            for (const npc of npcsHere.slice(0, 5)) { // Max 5 NPCs shown
                const npcDef = InnerMap.NPC_TYPES[npc.type] || {};
                menuItems.push({
                    type: 'action',
                    action: 'talk_npc',
                    label: `Talk to ${npc.name}`,
                    icon: npc.icon,
                    desc: `${npcDef.name || npc.type}`,
                    npc: npc,
                });
            }
        }

        // Terrain actions (blank tile — no building)
        if (!building) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            menuItems.push({ type: 'header', label: `${tile.subTerrain.icon} ${tile.subTerrain.name}` });

            if (!isPlayerHere) {
                menuItems.push({ type: 'action', action: 'move_here', label: 'Move Here', icon: '🚶', desc: 'Walk to this spot' });
            }

            if (tile.encounter && tile.encounter.discovered) {
                menuItems.push({ type: 'action', action: 'examine', label: `Examine ${tile.encounter.name}`, icon: tile.encounter.icon, desc: tile.encounter.description });
            }

            // Build actions on blank passable tiles where the player stands
            if (isPlayerHere && tile.subTerrain.passable && !tile.building) {
                const worldTile = game.world ? game.world.getTile(game.player.q, game.player.r) : null;
                const isSettlement = worldTile && worldTile.settlement && worldTile.settlement.type;

                menuItems.push({ type: 'separator' });
                menuItems.push({ type: 'header', label: '🏗️ Build' });

                menuItems.push({
                    type: 'action', action: 'build_property',
                    label: 'Build Property', icon: '🏗️',
                    desc: 'Construct a farm, mine, workshop, etc.'
                });
                menuItems.push({
                    type: 'action', action: 'build_temple',
                    label: 'Build Temple', icon: '⛩️',
                    desc: 'Construct a place of worship'
                });
                menuItems.push({
                    type: 'action', action: 'build_cultural',
                    label: 'Build Cultural Building', icon: '📚',
                    desc: 'Library, theater, university, or monument'
                });
                menuItems.push({
                    type: 'action', action: 'build_infrastructure',
                    label: 'Build Infrastructure', icon: '🛤️',
                    desc: 'Roads, bridges, or irrigation'
                });

                if (isSettlement) {
                    menuItems.push({
                        type: 'action', action: 'buy_house',
                        label: 'Buy a House', icon: '🏠',
                        desc: 'Purchase a house in this settlement'
                    });
                }
            }

            // General actions on player's tile
            if (isPlayerHere) {
                menuItems.push({ type: 'separator' });
                menuItems.push({ type: 'header', label: '⚙️ General' });
                menuItems.push({
                    type: 'action', action: 'wait_here',
                    label: 'Wait', icon: '⏳',
                    desc: 'Wait and let time pass'
                });
                menuItems.push({
                    type: 'action', action: 'rest',
                    label: 'Rest', icon: '💤',
                    desc: 'Take a break and recover'
                });
            }
        }

        if (menuItems.length === 0) return;

        // Create DOM menu — matching world map action menu style
        const menu = document.createElement('div');
        menu.id = 'innerMapContextMenu';
        menu.style.cssText = `
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(16, 20, 28, 0.97);
            backdrop-filter: blur(14px);
            border: 1px solid rgba(245, 197, 66, 0.35);
            border-radius: 12px;
            z-index: 1300;
            box-shadow: 0 12px 48px rgba(0,0,0,0.85), 0 0 0 1px rgba(245,197,66,0.08);
            overflow: hidden;
            font-family: var(--font-body, 'Inter', sans-serif);
            display: flex;
            flex-direction: column;
            max-width: 92vw;
            max-height: 90vh;
            min-width: 280px;
        `;

        // ── Header ──
        const locationLabel = building ? `${building.icon} ${building.name}` :
            npcsHere.length > 0 ? `👥 People Here` :
            `${tile.subTerrain.icon} ${tile.subTerrain.name}`;

        const timeStr = InnerMap.getTimeString ? InnerMap.getTimeString() : '';

        let headerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;
                border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(245,197,66,0.04); flex-shrink: 0;">
                <div>
                    <div style="font-family: var(--font-display, 'Inter', sans-serif); font-size: 14px; color: var(--gold, #f5c542); letter-spacing: 0.5px;">Actions</div>
                    <div style="font-size: 11px; color: var(--text-secondary, rgba(255,255,255,0.5)); margin-top: 1px;">${locationLabel}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    ${timeStr ? `<span style="font-size: 11px; color: #f39c12; background: rgba(243,156,18,0.12); padding: 2px 8px; border-radius: 4px;">🕐 ${timeStr}</span>` : ''}
                    <button id="closeInnerContextMenu" style="background: none; border: none; color: rgba(255,255,255,0.4);
                        font-size: 18px; cursor: pointer; padding: 4px 6px; line-height: 1;
                        transition: color 0.15s;"
                        onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">✕</button>
                </div>
            </div>
        `;

        // ── Group items into categories ──
        const categories = [];
        let currentCat = null;

        for (const item of menuItems) {
            if (item.type === 'header') {
                currentCat = { label: item.label, items: [] };
                categories.push(currentCat);
            } else if (item.type === 'separator') {
                currentCat = null;
            } else if (currentCat) {
                currentCat.items.push(item);
            } else {
                // Uncategorized — create an implicit group
                currentCat = { label: '', items: [item] };
                categories.push(currentCat);
            }
        }

        // ── Render action tiles ──
        let bodyHTML = `<div style="padding: 6px; display: flex; flex-direction: column; gap: 3px;">`;

        for (const cat of categories) {
            if (cat.label) {
                bodyHTML += `<div style="padding: 7px 10px; font-size: 11px; font-family: var(--font-display, 'Inter', sans-serif);
                    color: var(--gold, #f5c542); letter-spacing: 1px; text-transform: uppercase;
                    border-bottom: 1px solid rgba(245,197,66,0.12); background: rgba(245,197,66,0.03);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 4px; margin-bottom: 3px;">
                    ${cat.label}
                </div>`;
            }
            for (const item of cat.items) {
                if (item.type === 'disabled') {
                    bodyHTML += `
                        <div style="display: flex; align-items: center; gap: 7px;
                            background: rgba(255,255,255,0.015);
                            border: 1px solid rgba(255,255,255,0.04);
                            padding: 6px 8px; border-radius: 5px;
                            color: rgba(255,255,255,0.3);
                            font-family: var(--font-body, 'Inter', sans-serif);
                            white-space: nowrap; min-width: 0;">
                            <span style="font-size: 16px; width: 22px; text-align: center; flex-shrink: 0;">🚫</span>
                            <span style="font-size: 12px; overflow: hidden; text-overflow: ellipsis;">${item.label}</span>
                        </div>`;
                } else {
                    const dataAttrs = `data-action="${item.action || ''}" data-idx="${cat.items.indexOf(item)}"`;
                    bodyHTML += `
                        <button class="inner-ctx-btn" ${dataAttrs}
                            style="
                                display: flex; align-items: center; gap: 7px;
                                background: rgba(255,255,255,0.025);
                                border: 1px solid rgba(255,255,255,0.05);
                                padding: 6px 8px;
                                border-radius: 5px;
                                color: var(--text-primary, #e0e0e0);
                                cursor: pointer;
                                text-align: left;
                                transition: background 0.12s, border-color 0.12s;
                                font-family: var(--font-body, 'Inter', sans-serif);
                                white-space: nowrap;
                                min-width: 0;
                                width: 100%;
                            " onmouseover="this.style.background='rgba(245,197,66,0.12)';this.style.borderColor='rgba(245,197,66,0.3)'"
                               onmouseout="this.style.background='rgba(255,255,255,0.025)';this.style.borderColor='rgba(255,255,255,0.05)'">
                            <span style="font-size: 16px; width: 22px; text-align: center; flex-shrink: 0;">${item.icon || '📋'}</span>
                            <div style="flex: 1; min-width: 0;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 12px; font-weight: 600; color: #e0e0e0; overflow: hidden; text-overflow: ellipsis;">${item.label}</span>
                                </div>
                                ${item.desc ? `<div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px;
                                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.desc}</div>` : ''}
                            </div>
                        </button>`;
                }
            }
        }
        bodyHTML += `</div>`;

        menu.innerHTML = headerHTML + bodyHTML;
        document.body.appendChild(menu);

        // ── Event listeners ──
        document.getElementById('closeInnerContextMenu').addEventListener('click', () => this.closeContextMenu());

        // Attach click handlers to action buttons, passing the original item data
        const allActionItems = [];
        for (const cat of categories) {
            for (const item of cat.items) {
                if (item.type !== 'disabled') allActionItems.push(item);
            }
        }

        const buttons = menu.querySelectorAll('.inner-ctx-btn');
        let actionIdx = 0;
        buttons.forEach(btn => {
            const item = allActionItems[actionIdx++];
            if (item) {
                btn.addEventListener('click', () => {
                    this.closeContextMenu();
                    this._handleContextAction(game, item, q, r);
                });
            }
        });

        // Close on click outside
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                this.closeContextMenu();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 50);
    },

    /**
     * Close the context menu
     */
    closeContextMenu() {
        const menu = document.getElementById('innerMapContextMenu');
        if (menu) menu.remove();
    },

    /**
     * Handle a context menu action
     */
    _handleContextAction(game, item, q, r) {
        const action = item.action;

        // First, move to the building/NPC if not adjacent
        const playerQ = InnerMap.playerInnerQ;
        const playerR = InnerMap.playerInnerR;
        const dist = Math.abs(playerQ - q) + Math.abs(playerR - r);

        if (action === 'move_here') {
            const result = InnerMap.movePlayerTo(q, r);
            if (result.moved) {
                const pos = this.getInnerHexPixelPos(InnerMap.playerInnerQ, InnerMap.playerInnerR);
                game.innerMapCamera.centerOn(pos.x, pos.y);
            }
            return;
        }

        // For building/NPC actions, move to the target first if needed
        if (dist > 1) {
            // Move toward the building
            const result = InnerMap.movePlayerTo(q, r);
            if (result.moved) {
                const pos = this.getInnerHexPixelPos(InnerMap.playerInnerQ, InnerMap.playerInnerR);
                game.innerMapCamera.centerOn(pos.x, pos.y);
            }
        }

        // Now execute the action
        switch (action) {
            case 'trade':
            case 'browse_goods':
            case 'buy_weapons':
            case 'buy_tools':
            case 'buy_food':
            case 'buy_drink': {
                // Open trade menu using existing ActionMenu system
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.showTradeMenu(game, worldTile);
                }
                break;
            }
            case 'talk_merchant':
            case 'talk_locals':
            case 'talk_priest':
            case 'talk_captain':
            case 'talk_guard':
            case 'talk_official':
            case 'ask_directions':
            case 'talk_npc': {
                const npc = item.npc;
                const name = npc ? npc.name : (item.building ? item.building.name : 'someone');
                const npcType = npc ? (InnerMap.NPC_TYPES[npc.type] || {}).name : '';
                const rumors = [
                    'I heard bandits on the road to the east.',
                    'The harvest was good this year, prices should be fair.',
                    'A traveling merchant passed through with exotic goods.',
                    'The lord has been raising taxes again...',
                    'Strange lights were seen in the forest last night.',
                    'A caravan from the capital is expected any day now.',
                    'The well water has been tasting odd lately.',
                    'They say there\'s treasure hidden in the old ruins.',
                    'Watch yourself at night, the guards are spread thin.',
                    'The blacksmith just got a shipment of fine ore.',
                ];
                const rumor = rumors[Math.floor(Math.random() * rumors.length)];
                game.ui.showNotification(
                    `💬 ${name}`,
                    `"${rumor}"`,
                    'info'
                );
                break;
            }
            case 'tavern': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.handleAction(game, worldTile, 'tavern');
                }
                break;
            }
            case 'rest': {
                game.ui.showNotification('💤 Rest', 'You rest for a while and recover some energy.', 'info');
                break;
            }
            case 'pray':
            case 'meditate': {
                game.ui.showNotification('🙏 Prayer', 'You spend time in quiet contemplation.', 'info');
                break;
            }
            case 'donate': {
                if (game.player.gold >= 10) {
                    game.player.gold -= 10;
                    game.ui.showNotification('💰 Donation', 'You donated 10 gold to the church. Your karma improves.', 'success');
                    game.player.karma = (game.player.karma || 0) + 1;
                    game.ui.updateStats(game.player, game.world);
                } else {
                    game.ui.showNotification('💰 Donation', 'You don\'t have enough gold to donate.', 'error');
                }
                break;
            }
            case 'recruit': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.handleAction(game, worldTile, 'recruit');
                }
                break;
            }
            case 'train_combat': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.handleAction(game, worldTile, 'train_combat');
                }
                break;
            }
            case 'repair': {
                game.ui.showNotification('🔧 Repair', 'The blacksmith can repair your equipment.', 'info');
                break;
            }
            case 'view_notices': {
                game.ui.showNotification('📜 Notice Board', 'Check back later for quests and bounties.', 'info');
                break;
            }
            case 'pay_taxes': {
                game.ui.showNotification('💰 Tax Office', 'Tax collection is handled automatically each week.', 'info');
                break;
            }
            case 'seek_blessing': {
                game.ui.showNotification('✨ Blessing', 'The priest offers a blessing for your journey.', 'info');
                break;
            }
            case 'seek_audience': {
                game.ui.showNotification('🏛️ Audience', 'The lord is not currently receiving visitors.', 'info');
                break;
            }
            case 'store_goods':
            case 'collect_goods': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.handleAction(game, worldTile, 'collect_goods');
                }
                break;
            }
            case 'buy_horse':
            case 'stable_horse': {
                game.ui.showNotification('🐴 Stable', 'Horse trading is not yet available.', 'info');
                break;
            }
            case 'report_crime': {
                game.ui.showNotification('🗼 Guards', 'The guards note your report. They\'ll look into it.', 'info');
                break;
            }
            case 'examine': {
                const tile = InnerMap.getTile(q, r);
                if (tile && tile.encounter) {
                    game.ui.showNotification(
                        `${tile.encounter.icon} ${tile.encounter.name}`,
                        tile.encounter.description,
                        'info'
                    );
                }
                break;
            }
            case 'build_property': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    // Store the inner map tile position so the property is placed here
                    InnerMap._pendingPropertyPosition = { q, r };
                    ActionMenu.handleAction(game, worldTile, 'build_property');
                }
                break;
            }
            case 'build_temple': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.handleAction(game, worldTile, 'build_temple');
                }
                break;
            }
            case 'build_cultural': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.handleAction(game, worldTile, 'build_cultural');
                }
                break;
            }
            case 'build_infrastructure': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.handleAction(game, worldTile, 'build_infrastructure');
                }
                break;
            }
            case 'buy_house': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') {
                    ActionMenu.handleAction(game, worldTile, 'buy_house');
                }
                break;
            }
            case 'wait_here': {
                // Advance time by 1 hour
                InnerMap._timeAccumulator = InnerMap.TIME_SCALE;
                game.ui.showNotification('⏳ Wait', 'You wait for an hour...', 'info');
                break;
            }
            default:
                game.ui.showNotification('ℹ️ Action', `${action} is not available right now.`, 'info');
                break;
        }
    },

    /**
     * Get UI label/icon for a building action
     */
    _getActionDef(action) {
        const defs = {
            trade:         { label: 'Trade Goods',      icon: '🛒', desc: 'Buy and sell goods' },
            browse_goods:  { label: 'Browse Goods',     icon: '👀', desc: 'See what\'s for sale' },
            buy_weapons:   { label: 'Buy Weapons',      icon: '⚔️', desc: 'Purchase weapons' },
            buy_tools:     { label: 'Buy Tools',        icon: '🔧', desc: 'Purchase tools' },
            buy_food:      { label: 'Buy Food',         icon: '🍞', desc: 'Purchase food supplies' },
            buy_drink:     { label: 'Buy a Drink',      icon: '🍺', desc: 'Enjoy a refreshment' },
            tavern:        { label: 'Enter Tavern',     icon: '🍺', desc: 'Visit the tavern' },
            rest:          { label: 'Rest Here',        icon: '💤', desc: 'Take a break' },
            pray:          { label: 'Pray',             icon: '🙏', desc: 'Pray at the altar' },
            meditate:      { label: 'Meditate',         icon: '🧘', desc: 'Quiet contemplation' },
            donate:        { label: 'Donate (10g)',     icon: '💰', desc: 'Give a donation' },
            recruit:       { label: 'Recruit',          icon: '⚔️', desc: 'Recruit soldiers' },
            train_combat:  { label: 'Train Combat',     icon: '🗡️', desc: 'Train your combat skills' },
            repair:        { label: 'Repair Equipment', icon: '🔧', desc: 'Fix your gear' },
            talk_merchant: { label: 'Talk to Merchant', icon: '💬', desc: 'Chat with the merchant' },
            talk_locals:   { label: 'Talk to Locals',   icon: '💬', desc: 'Hear the latest gossip' },
            talk_priest:   { label: 'Talk to Priest',   icon: '💬', desc: 'Seek counsel' },
            talk_captain:  { label: 'Talk to Captain',  icon: '💬', desc: 'Speak with the guard captain' },
            talk_guard:    { label: 'Talk to Guard',    icon: '💬', desc: 'Speak with a guard' },
            talk_official: { label: 'Talk to Official', icon: '💬', desc: 'Speak with an official' },
            ask_directions:{ label: 'Ask Directions',   icon: '🧭', desc: 'Get directions' },
            view_notices:  { label: 'View Notices',     icon: '📜', desc: 'Check the notice board' },
            pay_taxes:     { label: 'Pay Taxes',        icon: '💰', desc: 'Pay your dues' },
            seek_blessing: { label: 'Seek Blessing',    icon: '✨', desc: 'Request a holy blessing' },
            seek_audience: { label: 'Seek Audience',    icon: '🏛️', desc: 'Request an audience with the lord' },
            store_goods:   { label: 'Store Goods',      icon: '📦', desc: 'Store items here' },
            collect_goods: { label: 'Collect Goods',    icon: '📦', desc: 'Pick up stored items' },
            buy_horse:     { label: 'Buy Horse',        icon: '🐴', desc: 'Purchase a horse' },
            stable_horse:  { label: 'Stable Horse',     icon: '🐴', desc: 'Stable your horse' },
            report_crime:       { label: 'Report Crime',          icon: '🗼', desc: 'Report wrongdoing' },
            move_here:          { label: 'Move Here',             icon: '🚶', desc: 'Walk to this spot' },
            examine:            { label: 'Examine',              icon: '🔍', desc: 'Take a closer look' },
            build_property:     { label: 'Build Property',       icon: '🏗️', desc: 'Construct a resource building' },
            build_temple:       { label: 'Build Temple',         icon: '⛩️', desc: 'Construct a place of worship' },
            build_cultural:     { label: 'Build Cultural',       icon: '📚', desc: 'Library, theater, etc.' },
            build_infrastructure:{ label: 'Build Infrastructure', icon: '🛤️', desc: 'Roads, bridges, irrigation' },
            buy_house:          { label: 'Buy a House',          icon: '🏠', desc: 'Purchase a house' },
            wait_here:          { label: 'Wait',                 icon: '⏳', desc: 'Wait and let time pass' },
        };
        return defs[action] || { label: action, icon: '❓', desc: '' };
    },
};
