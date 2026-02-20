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

        // Render encounters
        this.renderEncounters(ctx, camera);

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

                ctx.restore();

                // ── Building overlay ──
                if (tile.building && tile.visible && tileSprites) {
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

    /**
     * Render the HUD overlay for inner map
     */
    renderHUD(ctx, canvas) {
        const summary = InnerMap.getSummary();
        if (!summary) return;

        // Top bar background
        const barHeight = 44;
        ctx.fillStyle = 'rgba(16, 20, 28, 0.92)';
        ctx.fillRect(0, 0, canvas.width, barHeight);
        ctx.fillStyle = 'rgba(245,197,66,0.15)';
        ctx.fillRect(0, barHeight - 1, canvas.width, 1);

        // World tile info
        const worldTile = InnerMap.currentWorldTile;
        const terrainId = summary.parentTerrain;
        const terrainDef = Terrain.TYPES[terrainId.toUpperCase()] || {};

        ctx.font = '600 14px "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f5c542';
        ctx.fillText(`🗺️ Exploring: ${terrainDef.name || terrainId} (${worldTile.q}, ${worldTile.r})`, 16, barHeight / 2);

        // Exploration progress
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '500 13px "Inter", sans-serif';
        ctx.fillText(`Explored: ${summary.exploredPercent}%  |  Discoveries: ${summary.discoveredEncounters}/${summary.encounters}`,
            canvas.width / 2, barHeight / 2);

        // Exit instruction
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '500 12px "Inter", sans-serif';
        ctx.fillText('Press ESC or click 🔙 to return to world map', canvas.width - 16, barHeight / 2);
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
};
