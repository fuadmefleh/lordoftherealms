// Renderer — world methods.
import { Renderer } from './core.js';
import { Hex, Religion, Economy, Infrastructure } from './_imports.js';

// The water a lake's edge runs on into (renderLakeHex)
const Terrain_WATER = new Set(['lake', 'ocean', 'deep_ocean', 'coast', 'sea']);
import { drawHoverCoords } from '../hoverCoords.js';
import { resetCanvasTransform } from '../hiDpi.js';
import { drawIcon } from '../icons.js';
import { fontPx, readableFont, inkText, drawMapText } from '../mapInk.js';
import { TILE_SIG_UNSEEN } from './terrainCache.js';
import { textWidth } from '../textMeasure.js';

// Open water drawn seamless (renderSpriteHex): the sea's own art, not a lake's
const OPEN_SEA = new Set(['ocean', 'deep_ocean', 'sea', 'coast']);
// ...drawn this much larger than the hex and clipped to it, so its painted rim falls outside
const SEA_BIG = 1.16;

Object.assign(Renderer.prototype, {
    /**
     * Main render loop call
     */
    render(deltaTime) {
        this.time += deltaTime;
        this.waterAnimFrame = Math.floor(this.time / this.waterAnimInterval);
        const ctx = this.ctx;
        resetCanvasTransform(ctx);
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, 0, w, h);

        if (!this.world) return;

        // The inner map draws pixel art with smoothing off on this same context
        // (outside its save/restore); hex sprites are meant to be smoothed
        ctx.imageSmoothingEnabled = true;

        ctx.save();
        // A layer that throws must not leave the context transformed/clipped
        // for every later frame, nor let the label queue grow without end
        try {

        // The cloud sea over the uncharted world (renderer/fog.js)
        this.renderUncharted(ctx);

        // Render hex grid
        this.renderHexGrid(ctx);

        // Render rivers
        this.renderRivers(ctx);

        // The set of the sea: streaks drifting with each sea hex's current (renderer/currents.js)
        this.renderOceanCurrents(ctx);
        // (the Currents & Rivers map: an arrow for each sea hex's current and each river's run, renderer/flowMap.js)
        this.renderFlowArrows(ctx);

        // Render territory borders
        this.renderTerritoryBorders(ctx);

        // Render trade route lines (map mode)
        this.renderTradeRoutes(ctx);

        // Mines, quarries, ranches and the estates' farms about the towns, as buildings (beneath the towns)
        this.renderRuralSites(ctx);
        // Roadhouses on the open road, as buildings beside it (systems/hospitality.js; their names later)
        this.renderRoadhouseBuildings(ctx);

        // Faint old roads between ruins and passes (renderer/oldRoads.js, terrainGen 17)
        this.renderOldRoads(ctx);

        // Render settlements
        this.renderSettlements(ctx);

        // Render improvements / POI
        this.renderImprovements(ctx);

        // Render holy sites & cultural buildings
        this.renderHolySitesAndCulture(ctx);

        // Render Great Works standing and rising (systems/patronage.js)
        this.renderGreatWorks(ctx);

        // The dead on show: a pike with a head on it by the towns that keep them (systems/gibbets.js)
        this.renderDeadDisplays(ctx);

        // Render infrastructure (roads, bridges, irrigation)
        this.renderInfrastructure(ctx);

        // The roads' tier and repair, closed passes, fords, toll gates, canals, works (world/transport.js)
        this.renderRoadState(ctx);

        // Ferries over the great rivers and the straits, fishing boats off the towns, barges with the river trade (renderer/waterTraffic.js)
        if (this.renderWaterTraffic) this.renderWaterTraffic(ctx);

        // Render player-built structures (Farms, Mines, Temples)
        this.renderBuiltStructures(ctx);

        // Render resources
        this.renderResources(ctx);

        // Cloud banks along the edge of the known world (renderer/fog.js)
        this.renderFrontierFog(ctx);

        // The season's light over the land; units, labels and marks stay true-coloured (renderer/atmosphere.js)
        this.renderSeasonGrade(ctx);

        // Mines, quarries, sheep runs around the towns and their deposits (world/hinterland.js) —
        // under the route and the player, since the site's badge sits mid-hex
        this.renderHinterland(ctx);
        // Villages and fields burned by harriers in war (systems/harrying.js), then captives on stakes
        // along the roads and blinded columns walking home (renderer/warStakes.js): under the path,
        // the player and the units, which often stand on the very hex
        this.renderHarried(ctx);
        this.renderWarStakes(ctx);

        // Render path preview
        if (this.player && this.player.path) {
            this.renderPath(ctx, this.player.path);
        } else if (this.player && this.player.queuedPath) {
            // Camped for the night: the rest of the way, taken up in the morning
            this.renderPath(ctx, [{ q: this.player.q, r: this.player.r }, ...this.player.queuedPath.slice(this.player.queuedPathIndex || 0)]);
        }
        // A line of works being surveyed (ui/actionMenu/roadPlan.js): shown while its panel is open
        if (this.roadPlan) {
            if (typeof document !== 'undefined' && document.getElementById && !document.getElementById('customPanel')) this.roadPlan = null;
            else this.renderRoadPlan(ctx, this.roadPlan);
        }
        // Where a right-click would take you, with the nights' camps (ui/game/gameLoop.js _updateHoverRoute)
        if (this.hoverRoute && this.player && !this.player.isMoving) {
            this.renderRoutePreview(ctx, this.hoverRoute);
        }

        // Render reachable hexes
        if (this.reachableHexes) {
            this.renderReachableHexes(ctx);
        }

        // Render player (and their waiting ships, beneath the player icon)
        if (this.player) {
            this.renderPlayerShips(ctx);
            this.renderPlayer(ctx);
        }
        // Storms crossing the sea, the major ports' lighthouses, the wind by your ship (renderer/seaWeather.js)
        this.renderSeaWeather(ctx);

        // Render hover highlight
        if (this.hoveredHex) {
            this.renderHoverMark(ctx, this.hoveredHex.q, this.hoveredHex.r);
        }

        // Render selected highlight
        if (this.selectedHex) {
            this.renderSelectionMark(ctx, this.selectedHex.q, this.selectedHex.r);
        }

        // What your (possibly doctored) maps claim about unseen land
        this.renderMapDeceptions(ctx);
        // Uncharted places you have found or heard of (systems/discovery.js)
        this.renderDiscoveries(ctx);
        // Outlaw lairs you have found or heard of (systems/outlawLairs.js)
        this.renderOutlawLairs(ctx);
        // Pirate havens you know of, and captains lately sighted (systems/pirates.js)
        this.renderPirateHavens(ctx);
        // Roadhouses on the open road (systems/hospitality.js)
        this.renderRoadhouses(ctx);
        // Regions and seas named after a House (systems/namedLegacy.js)
        this.renderNamedPlaces(ctx);
        // Where your quests send you next (systems/npcTasks.js)
        this.renderQuestMarkers(ctx);
        // Your holdings under siege (systems/holdingSieges.js)
        this.renderHoldingSieges(ctx);
        // ...and the fronts of the wars between crowns (world/kingdomAI.js noteFront)
        this.renderWarFronts(ctx);

        // Royal squadrons at sea: blockades on station, patrols (renderer/navySquadrons.js)
        this.renderNavySquadrons(ctx);

        // Render units
        this.renderUnits(ctx);

        // Render caravans
        this.renderCaravans(ctx);

        // The trade map: known prices of one good (map mode 'prices', renderer/tradeMap.js)
        this.renderTradeMap(ctx);
        // The Ore map: the minerals towns are known to have plenty of or want (renderer/oreMap.js)
        this.renderOreTowns(ctx);

        // Render weather (renderer/atmosphere.js), then frame the map
        this.renderWeather(ctx);
        this.renderVignette(ctx);

        // The names of the land and the water, like an atlas, kept clear of the labels queued (renderer/geoLabels.js)
        this.renderGeoLabels(ctx);

        // Render all labels (with collision detection)
        this.renderLabels(ctx);

        // Hovered tile coordinates next to the cursor
        if (this.hoveredHex) {
            drawHoverCoords(ctx, this.canvas, this.mouseX, this.mouseY, this.hoveredHex.q, this.hoveredHex.r, this.hoverRouteLabel || '');
        }

        } finally {
            ctx.restore();
            this.labels.length = 0;
        }
    },

    /**
     * Add a label to the render queue with priority
     * @param {string} text - The label text
     * @param {number} x - Screen x position
     * @param {number} y - Screen y position
     * @param {number} priority - Higher priority labels are rendered first (1-10)
     * @param {object} style - Text style (font, fillStyle, strokeStyle, etc.)
     */
    addLabel(text, x, y, priority, style) {
        if (text == null || text === '') return;
        this.labels.push({ text: String(text), x, y, priority, style: { ...style, font: readableFont(style.font) } });
    },

    /**
     * Text on the map, inked so it reads over any terrain: a dark rounded halo
     * under the letters and a soft shadow round that. Every label and number
     * drawn on the world goes through here.
     * opts: size, weight, family ('display' Cinzel | 'body' Inter), color,
     * align, baseline, alpha, halo (colour).
     */
    drawMapText(ctx, text, x, y, opts = {}) {
        drawMapText(ctx, text, x, y, opts);
    },

    /**
     * Check if two label bounds overlap
     */
    labelsOverlap(label1, label2) {
        const padding = this.labelPadding;
        return !(
            label1.right + padding < label2.left - padding ||
            label1.left - padding > label2.right + padding ||
            label1.bottom + padding < label2.top - padding ||
            label1.top - padding > label2.bottom + padding
        );
    },

    /**
     * Measure and get bounds for a label
     */
    getLabelBounds(ctx, label) {
        // (the width remembered by font and text: ui/textMeasure.js)
        const textW = textWidth(ctx, label.style.font, label.text);
        // The font's pixel size (a leading weight like "700 13px" is not the size)
        const height = fontPx(label.style.font) || 12;
        const pad = label.style.plaque ? height * 0.6 : height * 0.15;
        const width = textW + pad * 2;
        const top = label.style.textBaseline === 'top' ? label.y - pad * 0.4 : label.y - height / 2 - pad * 0.4;

        return {
            left: label.x - width / 2,
            right: label.x + width / 2,
            top,
            bottom: top + height + pad * 0.8
        };
    },

    /**
     * A small banner behind a place name: dark plate, a gold hairline, the
     * owning realm's colour down the left edge, and a crown for a capital.
     */
    drawLabelPlaque(ctx, b, plaque) {
        const w = b.right - b.left, h = b.bottom - b.top;
        const r = Math.min(4, h / 2);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(b.left + r, b.top);
        ctx.arcTo(b.right, b.top, b.right, b.bottom, r);
        ctx.arcTo(b.right, b.bottom, b.left, b.bottom, r);
        ctx.arcTo(b.left, b.bottom, b.left, b.top, r);
        ctx.arcTo(b.left, b.top, b.right, b.top, r);
        ctx.closePath();
        ctx.fillStyle = 'rgba(12, 15, 22, 0.78)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = plaque.capital ? 'rgba(245, 197, 66, 0.85)' : 'rgba(245, 197, 66, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (plaque.accent) {
            ctx.clip();
            ctx.fillStyle = plaque.accent;
            ctx.fillRect(b.left, b.top, Math.max(3, h * 0.18), h);
        }
        ctx.restore();
        if (plaque.capital) {
            // A crown resting on the banner's top edge
            const cs = Math.max(12, h * 0.85);
            drawIcon(ctx, 'crown', (b.left + b.right) / 2, b.top - cs * 0.32, cs, '#f5c542', 2.2);
        }
    },

    /**
     * Render all non-overlapping labels based on priority
     */
    renderLabels(ctx) {
        if (this.labels.length === 0) return;

        // Sort labels by priority (highest first)
        this.labels.sort((a, b) => b.priority - a.priority);

        const renderedLabels = [];

        // Render labels that don't overlap with higher priority ones
        for (const label of this.labels) {
            // (the box renderGeoLabels measured this frame, when it did)
            const bounds = label._bounds || this.getLabelBounds(ctx, label);

            // Check if this label overlaps with any already rendered label
            // (the boxes compared as they are: no copies of every pair, each frame)
            let overlaps = false;
            for (const rendered of renderedLabels) {
                if (this.labelsOverlap(bounds, rendered.bounds)) {
                    overlaps = true;
                    break;
                }
            }

            // If no overlap, render this label
            if (!overlaps) {
                // Apply style
                ctx.font = label.style.font;
                ctx.textAlign = label.style.textAlign || 'center';
                ctx.textBaseline = label.style.textBaseline || 'middle';

                if (label.style.plaque) this.drawLabelPlaque(ctx, bounds, label.style.plaque);

                inkText(ctx, label.text, label.x, label.y, fontPx(label.style.font), label.style.fillStyle,
                    label.style.plaque ? 'rgba(6, 8, 12, 0.75)' : null);

                // Save this label as rendered
                renderedLabels.push({ bounds });
            }
        }

        // Clear labels for next frame
        this.labels = [];
    },

    /**
     * Render active caravans
     */
    renderCaravans(ctx) {
        if (!this.player || !this.player.caravans) return;

        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const worldWidthPx = hexWidth * this.world.width;

        for (const caravan of this.player.caravans) {
            if (caravan.status !== 'traveling') continue;

            const start = this.getHexPixelPos(caravan.fromPos.q, caravan.fromPos.r);
            const end = this.getHexPixelPos(caravan.toPos.q, caravan.toPos.r);

            // Handle wrapping logic for shortest path interpolation
            let sx = start.x;
            let ex = end.x;
            const sy = start.y;
            const ey = end.y;

            if (Math.abs(ex - sx) > worldWidthPx / 2) {
                if (ex > sx) ex -= worldWidthPx;
                else ex += worldWidthPx;
            }

            const totalDays = Math.max(1, Math.ceil(caravan.distance / 2));
            const progress = 1 - (caravan.daysRemaining / totalDays);

            // Interpolate
            const cx = sx + (ex - sx) * progress;
            const cy = sy + (ey - sy) * progress;

            // Get screen position
            const screen = this.camera.worldToScreen(cx, cy);

            // Check visibility
            if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
            if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

            const renderSize = size * this.camera.zoom;

            // Your caravan: a merchant token with a gold halo
            this.renderUnitToken(ctx, { type: 'trade_caravan', q: 0, r: 0, escort: { by: 'player' }, icon: '🐪' }, screen.x, screen.y, renderSize);

            // Draw Label
            if (this.camera.zoom > 0.6) {
                this.drawMapText(ctx, `${caravan.daysRemaining} days`, screen.x, screen.y - renderSize * 0.6, {
                    size: 12, family: 'body', color: '#ffd75e',
                });
            }
        }
    },

    /**
     * Get pixel position of a hex (Offset Coordinates)
     */
    getHexPixelPos(q, r) {
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;

        const px = q * hexWidth + ((r % 2 === 0) ? hexWidth / 2 : 0);
        const py = r * rowHeight;
        return { x: px, y: py };
    },

    /**
     * fn(tile, q, r) for every tile whose grid point may lie within `pad`
     * screen px of the view, row by row and left to right on screen; q is the
     * wrapped column, each tile at most once. A superset of what is on screen
     * (callers keep their own exact cull), so the map's passes walk the few
     * hundred hexes in view rather than every tile of the world each frame.
     */
    forEachTileInView(pad, fn) {
        const world = this.world;
        const W = world.width, H = world.height;
        if (!(W > 0) || !(H > 0)) return;
        // (a camera that can't say what it sees, as in the tests' stand-ins: every tile)
        if (typeof this.camera.getVisibleBounds !== 'function') {
            for (let r = 0; r < H; r++) {
                const row = world.tiles[r];
                if (row) for (let q = 0; q < W; q++) if (row[q]) fn(row[q], q, r);
            }
            return;
        }
        const b = this.camera.getVisibleBounds();
        const hexWidth = Math.sqrt(3) * this.hexSize;
        const rowHeight = hexWidth * 0.75;
        const padW = pad / (this.camera.zoom || 1) + hexWidth;
        const minR = Math.max(0, Math.floor((b.top - padW) / rowHeight));
        const maxR = Math.min(H - 1, Math.ceil((b.bottom + padW) / rowHeight));
        for (let r = minR; r <= maxR; r++) {
            const row = world.tiles[r];
            if (!row) continue;
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            let q0 = Math.floor((b.left - padW - offsetX) / hexWidth);
            let q1 = Math.ceil((b.right + padW - offsetX) / hexWidth);
            if (q1 - q0 + 1 >= W) { q0 = 0; q1 = W - 1; }
            for (let q = q0; q <= q1; q++) {
                const wq = ((q % W) + W) % W;
                const tile = row[wq];
                if (tile) fn(tile, wq, r);
            }
        }
    },

    /**
     * Render the hex grid terrain. While the view holds its zoom the terrain is kept in a
     * canvas of its own and only copied here, panned by whole pixels with the newly bared
     * edge drawn (renderer/terrainCache.js); while zooming, and in the map modes, it is
     * drawn hex by hex as before.
     */
    renderHexGrid(ctx) {
        if (this.drawTerrainCached && this.drawTerrainCached(ctx)) return;
        this._terrainPass(ctx, null);
        this.renderFogFaces(ctx);
    },

    /**
     * The terrain pass: each explored hex's art (with its river, road or bridge) row by
     * row onto `ctx`, the frontier noted and the faces out of sight gathered for
     * renderFogFaces. `v` null: the map as the camera sees it. Else a view of its own
     * (renderer/terrainCache.js): { ox, oy, z } the world point at the canvas centre and
     * the zoom, [x0, x1) × [y0, y1) the screen box to cover, `sigs` the tile signatures
     * noted (`changed` set when one differs from the last noted), `frontierOnly` to note
     * only the frontier (the camera's view, nothing drawn).
     */
    _terrainPass(ctx, v, frontierOnly = false) {
        const cam = this.camera;
        const world = this.world;
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;
        const rowHeight = hexWidth * 0.75;
        const zoom = v ? v.z : cam.zoom;
        const cw = this.canvas.width, ch = this.canvas.height;
        const halfW = cw / 2, halfH = ch / 2;
        const ox = v ? v.ox : cam.x, oy = v ? v.oy : cam.y;
        const x0 = v ? v.x0 : 0, x1 = v ? v.x1 : cw;
        const y0 = v ? v.y0 : 0, y1 = v ? v.y1 : ch;
        const wpw = cam.worldPixelWidth;
        const sigs = v && v.sigs;
        const W = world.width;

        // The world box in view (camera.getVisibleBounds, for a box of the canvas)
        let bounds;
        if (v) bounds = { left: ox + (x0 - halfW) / zoom, right: ox + (x1 - halfW) / zoom, top: oy + (y0 - halfH) / zoom, bottom: oy + (y1 - halfH) / zoom };
        else bounds = cam.getVisibleBounds();

        // Approximate visible range
        const padding = 2;
        const startRow = Math.floor((bounds.top) / rowHeight) - padding;
        const endRow = Math.ceil((bounds.bottom) / rowHeight) + padding;

        const minR = Math.max(0, startRow);
        const maxR = Math.min(world.height - 1, endRow);
        if (!v || frontierOnly) this._frontier = [];
        // Faces of explored hexes out of sight: darkened in one pass after all the terrain
        if (!frontierOnly) this._fogFaces = [];
        const cullX = hexWidth * zoom, cullY = hexHeight * zoom;
        const renderSize = size * zoom;

        for (let r = minR; r <= maxR; r++) {
            // Apply Even-row offset (C# logic: y % 2 == 0 -> offset)
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;

            const minQ = Math.floor((bounds.left - offsetX) / hexWidth) - padding;
            const maxQ = Math.ceil((bounds.right - offsetX) / hexWidth) + padding;
            const row = world.tiles[r];

            for (let q = minQ; q <= maxQ; q++) {
                // Handle wrapping
                const wq = Hex.wrapQ(q, W);
                const tile = row[wq];
                if (sigs) {
                    const s = this._tileSig(tile), i = r * W + wq;
                    if (sigs[i] !== s) {
                        if (sigs[i] !== TILE_SIG_UNSEEN) v.changed = true;
                        sigs[i] = s;
                    }
                }

                // q is column (x), r is row (y); on screen as camera.worldToScreen puts it
                const px = q * hexWidth + offsetX;
                const py = r * rowHeight;
                let dx = px - ox;
                if (wpw > 0) {
                    if (dx > wpw / 2) dx -= wpw;
                    if (dx < -wpw / 2) dx += wpw;
                }
                const sx = halfW + dx * zoom;
                const sy = halfH + (py - oy) * zoom;

                // Cull if off-screen (extra check)
                if (sx < x0 - cullX || sx > x1 + cullX) continue;
                if (sy < y0 - cullY || sy > y1 + cullY) continue;

                if (!tile.explored) {
                    // FOW: nothing is drawn here — the cloud sea beneath shows through,
                    // and frontier hexes get a bank of cloud over the edge (renderer/fog.js)
                    if (!v || frontierOnly) this.noteFrontierHex(q, r, wq, sx, sy);
                    continue;
                }
                if (frontierOnly) continue;

                // Check if we have a PNG sprite for this terrain
                const imgName = this.getTileImage(tile);

                // Log missing assets (once per session)
                if (!this.missingAssets) this.missingAssets = new Set();

                if (!imgName) {
                    if (!this.missingAssets.has(`TERRAIN_${tile.terrain.id}`)) {
                        console.warn(`[Renderer] No image mapping for terrain: ${tile.terrain.id}`);
                        this.missingAssets.add(`TERRAIN_${tile.terrain.id}`);
                    }
                } else if (!this.tileSprites.has(imgName)) {
                    if (!this.missingAssets.has(imgName)) {
                        console.warn(`[Renderer] Image asset missing: ${imgName} (for ${tile.terrain.id})`);
                        this.missingAssets.add(imgName);
                    }
                }

                const sprite = imgName ? this.tileSprites.get(imgName) : null;

                // Check for bridge first (road + river overlap)
                const bridgeImgName = this.getBridgeImage(tile, q, r, world.width, world.height);
                const bridgeSprite = bridgeImgName ? this.tileSprites.get(bridgeImgName) : null;

                // If we have a bridge, use it instead of separate river and road
                let riverSprite = null;
                let roadSprite = null;

                // The river is always drawn; a bridge (road and bridge
                // only) goes over it in place of the plain road
                const riverImgName = this.getRiverImage(tile, q, r, world.width, world.height);
                riverSprite = riverImgName ? this.tileSprites.get(riverImgName) : null;
                roadSprite = bridgeSprite;
                if (!roadSprite) {
                    const roadImgName = this.getRoadImage(tile, q, r, world.width, world.height);
                    roadSprite = roadImgName ? this.tileSprites.get(roadImgName) : null;
                }

                if (sprite || riverSprite || roadSprite) {
                    this.renderSpriteHex(ctx, sx, sy, renderSize, sprite, tile, riverSprite, roadSprite);
                }
            }
        }
    },

    /**
     * Fog of war (explored but out of sight), as one pass over the finished
     * terrain: the faces of the unseen hexes filled together as a single
     * path. The tile art is taller than its face (trees and peaks rise into
     * the row behind), so darkening per tile, either as a fill clipped to the
     * face as each tile was drawn (the next row then painted bright art over
     * it) or by darkening each tile's whole sprite (its dark peaks poking into
     * the lit row behind), left a stepped, hex-shaped zigzag along the edge.
     * Done after all of it, whatever art lies inside an unseen face is dark
     * and nothing in a seen one is, so the edge runs on the hex lines. One
     * path, one fill: neighbouring faces share edges and never double up.
     */
    renderFogFaces(ctx) {
        const faces = this._fogFaces;
        if (!faces || !faces.length) return;
        ctx.save();
        ctx.beginPath();
        // (no closePath: fill() closes every subpath itself, and closePath on a path of
        // thousands of faces cost more than the rest of the terrain pass)
        for (const c of faces) {
            ctx.moveTo(c[0].x, c[0].y);
            for (let i = 1; i < 6; i++) ctx.lineTo(c[i].x, c[i].y);
        }
        ctx.fillStyle = 'rgba(10, 14, 23, 0.55)'; // dark blue-black
        ctx.fill('nonzero');
        ctx.restore();
        this._fogFaces = [];
    },

    /**
     * Render a hex with a solid color fill
     */
    renderColoredHex(ctx, cx, cy, size, tile) {
        const corners = Hex.hexCorners(cx, cy, size);

        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();

        // Fill with terrain color
        let fillColor = tile.terrain.color;

        // Dim if not currently visible (explored but not in LOS)
        if (!tile.visible) {
            fillColor = this.dimColor(fillColor, 0.45);
        }

        // Kingdom territory tint
        if (tile.kingdom && tile.visible) {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                // Blend territory color
                ctx.fillStyle = fillColor;
                ctx.fill();

                ctx.fillStyle = kingdom.colorLight;
                ctx.fill();

                // Subtle internal hex outline
                ctx.strokeStyle = this.dimColor(kingdom.color, 0.2);
                ctx.lineWidth = 0.5;
                ctx.stroke();
                return;
            }
        }

        ctx.fillStyle = fillColor;
        ctx.fill();

        // Subtle hex border
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    },

    /**
     * A lake hex with a shore. The hex is laid with the land of the country
     * round it (grass, tundra or sand, by its neighbours), and the water is a
     * rounded pool on it: each edge that meets more water (lake or sea) runs
     * the water out to that edge, so a lake of many hexes reads as one body;
     * each edge that meets land keeps a thin curving shore just inside the
     * hex's edge (the water fills the tile), a strand of pale sand and a
     * darker wet line. The water is the lake art,
     * clipped to the pool.
     */
    renderLakeHex(ctx, tile, waterSprite, corners, cx, cy, size, drawX, drawY, tw, th) {
        const w = this.world;
        const WATER = Terrain_WATER;
        const nb = Hex.neighbors(tile.q, tile.r).map(n =>
            (n.r < 0 || n.r >= w.height) ? null : w.tiles[n.r][Hex.wrapQ(n.q, w.width)]);
        // the shore's ground: the country round the lake
        let ground = 'grassland';
        for (const n of nb) {
            if (!n || !n.terrain) continue;
            const id = n.terrain.id;
            if (['snow', 'ice', 'tundra', 'snow_peak', 'glacier'].includes(id)) { ground = 'tundra'; break; }
            if (['desert'].includes(id)) ground = 'desert';
            else if (id === 'savanna' && ground === 'grassland') ground = 'savanna';
        }
        const gName = this.getTileImage({ q: tile.q, r: tile.r, terrain: { id: ground }, temperature: tile.temperature, moisture: tile.moisture, elevation: 0.5 });
        const gSprite = gName ? this.tileSprites.get(gName) : null;
        // (clipped to this hex: the art is scaled to cover and spills past the face, and the
        // next lake hex's land painted over this one's water drew a sandy rim between them)
        ctx.save();
        ctx.beginPath();
        corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
        ctx.closePath();
        ctx.clip();
        if (gSprite) ctx.drawImage(gSprite, drawX, drawY, tw, th);
        else ctx.drawImage(waterSprite, drawX, drawY, tw, th);
        ctx.restore();

        // edge i of the face (corners i..i+1) faces neighbour EDGE_NBR[i]
        const EDGE_NBR = [1, 0, 5, 4, 3, 2];
        const open = EDGE_NBR.map(d => !!(nb[d] && nb[d].terrain && WATER.has(nb[d].terrain.id)));
        // a river meeting the lake across an edge (running in, or out of it): the water opens a
        // mouth there, out to the edge where the river's own art ends, so the two run together
        const nbHex = Hex.neighbors(tile.q, tile.r);
        const inlet = EDGE_NBR.map((d, i) => {
            const n = nb[d];
            if (open[i] || !n || !n.hasRiver) return false;
            const back = (d + 3) % 6;
            return n.riverDir === back || this.lakeOutletDir(n, Hex.wrapQ(nbHex[d].q, w.width), nbHex[d].r, w.width, w.height) === back;
        });
        const mx = cx, my = cy + 0.134 * size;      // the middle of the face
        const toward = (p, k) => ({ x: mx + (p.x - mx) * k, y: my + (p.y - my) * k });
        const edgeAt = (i, t) => {
            const a = corners[i], b = corners[(i + 1) % 6];
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        };
        const MOUTH = 0.17;       // half the mouth's width, as a share of the edge
        // (an edge open to more water runs a hair past the hex's edge, so no thread of
        // the shore's ground shows between two lake hexes where the clip is smoothed)
        const OVER = 1.03;
        // The water takes the whole tile: an edge facing land keeps only a strand of beach
        // along the hex's own edge (it used to pull in to a small pool, and the strands of
        // two lake hexes pinched together in the middle of a lake)
        const LAND_MID = 0.9, CORNER_ONE = 0.97, CORNER_LAND = 0.88;
        const mid = (i) => open[i] ? toward(edgeAt(i, 0.5), OVER) : toward(edgeAt(i, 0.5), LAND_MID);
        // where the outline reaches edge i coming round from corner i, and leaves it for corner i+1
        const reach = (i) => inlet[i] ? edgeAt(i, 0.5 - MOUTH) : mid(i);
        const leave = (i) => inlet[i] ? edgeAt(i, 0.5 + MOUTH) : mid(i);
        const corner = (i) => {
            // corner i lies between edge i-1 and edge i
            const both = open[(i + 5) % 6] && open[i];
            const one = open[(i + 5) % 6] || open[i];
            return toward(corners[i], both ? OVER : one ? CORNER_ONE : CORNER_LAND);
        };
        // Round corner i, from where the outline leaves edge i-1 to where it reaches edge i.
        // Water on both sides: right into the corner. Land on both: a rounded shore. Water on
        // one side only: the water runs along that edge right into the corner (the next lake
        // hex meets it there), and the shore curves from the corner along the land edge —
        // the strand starts at the corner, never out along the edge two lake hexes share.
        // `shore(i)` gives that shore part as [from, control, to], or null.
        const shore = (i) => {
            const pOpen = open[(i + 5) % 6], nOpen = open[i];
            if (pOpen && nOpen) return null;
            if (!pOpen && !nOpen) return [leave((i + 5) % 6), corner(i), reach(i)];
            const v = toward(corners[i], OVER);
            if (pOpen) return [v, toward(edgeAt(i, 0.25), (OVER + LAND_MID) / 2), reach(i)];
            return [leave((i + 5) % 6), toward(edgeAt((i + 5) % 6, 0.75), (OVER + LAND_MID) / 2), v];
        };
        const pool = () => {
            ctx.beginPath();
            const start = leave(5);
            ctx.moveTo(start.x, start.y);
            for (let i = 0; i < 6; i++) {
                const m = reach(i), sh = shore(i);
                if (!sh) { const c = corner(i); ctx.lineTo(c.x, c.y); ctx.lineTo(m.x, m.y); }
                else if (open[(i + 5) % 6]) { ctx.lineTo(sh[0].x, sh[0].y); ctx.quadraticCurveTo(sh[1].x, sh[1].y, sh[2].x, sh[2].y); }
                else { ctx.quadraticCurveTo(sh[1].x, sh[1].y, sh[2].x, sh[2].y); if (open[i]) ctx.lineTo(m.x, m.y); }
                if (inlet[i]) { const l = leave(i); ctx.lineTo(l.x, l.y); }
            }
            ctx.closePath();
        };
        if (gSprite && open.some(o => !o)) {
            // the strand and the wet line along the shore (only where the pool meets land; a
            // river's mouth is left open, its banks running down to the water)
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const sh = shore(i);
                if (!sh) continue;
                ctx.moveTo(sh[0].x, sh[0].y);
                ctx.quadraticCurveTo(sh[1].x, sh[1].y, sh[2].x, sh[2].y);
            }
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(222, 205, 150, 0.9)';
            ctx.lineWidth = Math.max(2, size * 0.16);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(60, 70, 50, 0.45)';
            ctx.lineWidth = Math.max(1, size * 0.05);
            ctx.stroke();
        }
        ctx.save();
        pool();
        ctx.clip();
        // (the water art a little larger than the hex, so the rim painted round the tile's
        // edge falls outside the pool and a lake of many hexes shows no seams)
        const BIG = 1.16;
        ctx.drawImage(waterSprite, mx - (mx - drawX) * BIG, my - (my - drawY) * BIG, tw * BIG, th * BIG);
        ctx.restore();
    },

    /**
     * A sea sprite as renderSpriteHex lays it: the art SEA_BIG times larger about
     * the face's centre, clipped to the face, in a canvas of the sprite's size
     * (the tile frame, so it is drawn with the same rectangle as the sprite).
     * Made once per sprite; null where there is no canvas.
     */
    _seaFace(sprite) {
        if (!this._seaFaces) this._seaFaces = new WeakMap();
        let c = this._seaFaces.get(sprite);
        if (c !== undefined) return c;
        c = null;
        try {
            const w = sprite.width, h = sprite.height;
            if (typeof document !== 'undefined' && w > 0 && h > 0) {
                const cv = document.createElement('canvas');
                cv.width = w;
                cv.height = h;
                const g = cv.getContext('2d');
                if (g && typeof g.clip === 'function') {
                    // the frame at scale 1: drawX = 0, drawY = 0 (renderSpriteHex's cover fit)
                    const size = Math.min(w / Math.sqrt(3), h / 2);
                    const cx = w / 2, cy = h - size, sX = 0.866 * size;
                    g.beginPath();
                    g.moveTo(cx, cy - 0.732 * size);
                    g.lineTo(cx + sX, cy - 0.299 * size);
                    g.lineTo(cx + sX, cy + 0.567 * size);
                    g.lineTo(cx, cy + size);
                    g.lineTo(cx - sX, cy + 0.567 * size);
                    g.lineTo(cx - sX, cy - 0.299 * size);
                    g.closePath();
                    g.clip();
                    const mx = cx, my = cy + 0.134 * size;
                    g.drawImage(sprite, mx - mx * SEA_BIG, my - my * SEA_BIG, w * SEA_BIG, h * SEA_BIG);
                    c = cv;
                }
            }
        } catch { c = null; }
        this._seaFaces.set(sprite, c);
        return c;
    },

    /**
     * Render a hex with a PNG sprite (clipped to hex shape)
     */
    renderSpriteHex(ctx, cx, cy, size, sprite, tile, overlaySprite = null, roadSprite = null) {
        // The tile's top face: a pointy hex √3·size wide and tall (rows are
        // 0.75·√3·size apart), bottom point at cy + size. Exact, so neighbouring
        // faces share edges and translucent overlays neither overlap nor gap.
        const sX = 0.866 * size;
        // (the topographic, Currents & Rivers and Ore maps leave the tile art off:
        // renderer/topography.js, flowMap.js and oreMap.js paint the face)
        const topo = this.mapMode === 'topo';
        const flow = this.mapMode === 'flow';
        const ores = this.mapMode === 'ores';
        const bare = topo || flow || ores;
        const terrainId = tile.terrain && tile.terrain.id;
        const lake = !!(sprite && !bare && terrainId === 'lake' && this.world);
        const sea = !!(sprite && !bare && !lake && OPEN_SEA.has(terrainId));
        // Anything drawn over the face, clipped to it: a realm's tint, a map mode's colour.
        // Most hexes have none, and then no clip is set (a path and a clip per hex, for
        // nothing, was a good part of the terrain pass)
        const tint = !!(this.showTerritories && tile.kingdom && tile.visible && this.mapMode === 'normal');
        const overlay = tint || bare || this.mapMode !== 'normal';
        // (the face's corners only where something needs them)
        const corners = (overlay || lake || sea || (!tile.visible && this._fogFaces)) ? [
            { x: cx,       y: cy - 0.732 * size },
            { x: cx + sX,  y: cy - 0.299 * size },
            { x: cx + sX,  y: cy + 0.567 * size },
            { x: cx,       y: cy + 1.000 * size },
            { x: cx - sX,  y: cy + 0.567 * size },
            { x: cx - sX,  y: cy - 0.299 * size },
        ] : null;

        // Draw sprite (Unclipped to allow overlap)
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;

        let targetWidth = hexWidth;
        let targetHeight = targetWidth;

        // Scale to COVER hex (max of width/height ratios)
        if (sprite && sprite.width && sprite.height) {
            const scaleX = (hexWidth / sprite.width);
            const scaleY = (hexHeight / sprite.height);
            const scale = Math.max(scaleX, scaleY); // fit exact

            targetWidth = sprite.width * scale;
            targetHeight = sprite.height * scale;
        }

        // Anchor sprite at bottom of hex (cy + size)
        const bottomY = cy + size;
        const drawX = cx - targetWidth / 2;
        const drawY = bottomY - targetHeight;

        // Fog of war: this face is darkened with the others after all the terrain (renderFogFaces)
        if (!tile.visible && this._fogFaces) this._fogFaces.push(corners);

        if (sprite && !bare) {
            // A lake is drawn with a shore: the land around it, and its water rounded off
            // toward the land and running on into the water beside it (renderLakeHex)
            // (in a save of its own: the shore's strokes set the line style)
            if (lake) {
                ctx.save();
                this.renderLakeHex(ctx, tile, sprite, corners, cx, cy, size, drawX, drawY, targetWidth, targetHeight);
                ctx.restore();
            }
            else if (sea) {
                // The sea: its art drawn a little larger and clipped to the hex, so the rim painted
                // round the tile's edge falls outside and open water shows no grid of hex outlines
                // (cut once into a canvas of the sprite's own size and kept: a clip per sea hex, each
                // frame, cost more than the drawing; the old way stays where there is no canvas)
                const face = this._seaFace(sprite);
                if (face) ctx.drawImage(face, drawX, drawY, targetWidth, targetHeight);
                else {
                    const BIG = SEA_BIG, mx = cx, my = cy + 0.134 * size;
                    ctx.save();
                    ctx.beginPath();
                    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(sprite, mx - (mx - drawX) * BIG, my - (my - drawY) * BIG, targetWidth * BIG, targetHeight * BIG);
                    ctx.restore();
                }
            } else ctx.drawImage(sprite, drawX, drawY, targetWidth, targetHeight);
        }

        // River first, then the road (or bridge) over it, so a road
        // crossing water reads as crossing it. Same frame as the base sprite
        // so the overlays line up whatever their transparency.
        if (overlaySprite && !bare) {
            ctx.drawImage(overlaySprite, drawX, drawY, targetWidth, targetHeight);
        }

        if (roadSprite && !bare) {
            ctx.drawImage(roadSprite, drawX, drawY, targetWidth, targetHeight);
        }

        if (!overlay) return;
        ctx.save();

        // Clip to hex shape for overlays
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
        ctx.clip();

        // Kingdom tint (overlay if visible and territory)
        if (this.showTerritories && tile.kingdom && tile.visible && this.mapMode === 'normal') {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                ctx.globalCompositeOperation = 'overlay';
                ctx.fillStyle = kingdom.colorLight;
                ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
            }
        }

        // Map mode overlay
        if (topo) this.renderTopoHex(ctx, tile, corners, size);
        else if (flow) this.renderFlowHex(ctx, tile, corners);
        else if (ores) this.renderOreHex(ctx, tile, corners);
        else if (this.mapMode !== 'normal') {
            this.renderMapModeOverlay(ctx, tile);
        }

        ctx.restore();
    },
});
