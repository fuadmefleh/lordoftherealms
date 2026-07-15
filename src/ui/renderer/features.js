// Renderer — features methods.
import { Renderer } from './core.js';
import { Hex, Religion, Economy, Infrastructure } from './_imports.js';

// Vertical nudge (as a fraction of a hex's on-screen size) applied to building
// sprites so their base sits down on the hex tile instead of floating above it.
// Increase to push buildings lower, decrease to raise them. Scales with zoom.
const BUILDING_BASE_NUDGE = 0.14;

Object.assign(Renderer.prototype, {
    /**
     * Render territory border lines between different kingdoms
     */
    renderTerritoryBorders(ctx) {
        if (!this.world || !this.showTerritories) return;
        const bounds = this.camera.getVisibleBounds();
        const world = this.world;
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;
        const padding = 2;

        // Use same bound logic as renderHexGrid for consistency
        const startRow = Math.floor((bounds.top) / rowHeight) - padding;
        const endRow = Math.ceil((bounds.bottom) / rowHeight) + padding;

        const minR = Math.max(0, startRow);
        const maxR = Math.min(world.height - 1, endRow);

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Group edges by kingdom to draw them in batches for a "fully connected" look
        const kingdomEdges = new Map();

        for (let r = minR; r <= maxR; r++) {
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            const startCol = Math.floor((bounds.left - offsetX) / hexWidth) - padding;
            const endCol = Math.ceil((bounds.right - offsetX) / hexWidth) + padding;

            for (let q = startCol; q <= endCol; q++) {
                const wq = Hex.wrapQ(q, world.width);
                const tile = world.tiles[r][wq];

                if (!tile.kingdom || !tile.explored) continue;

                const px = q * hexWidth + offsetX;
                const py = r * rowHeight;
                const screen = this.camera.worldToScreen(px, py);
                const renderSize = size * this.camera.zoom;

                // Check each neighbor for border
                const corners = Hex.hexCorners(screen.x, screen.y, renderSize);
                const neighbors = Hex.neighbors(q, r);
                const neighborIndices = [0, 5, 4, 3, 2, 1];

                for (let i = 0; i < 6; i++) {
                    const neighborIdx = neighborIndices[i];
                    const n = neighbors[neighborIdx];
                    const nwq = Hex.wrapQ(n.q, world.width);

                    // Correct tile retrieval for neighbor
                    const nTile = world.getTile(nwq, n.r);

                    if (!nTile || nTile.kingdom !== tile.kingdom) {
                        if (!kingdomEdges.has(tile.kingdom)) {
                            kingdomEdges.set(tile.kingdom, []);
                        }
                        // Store edges as pairs of points
                        kingdomEdges.get(tile.kingdom).push({
                            v1: corners[i],
                            v2: corners[(i + 1) % 6]
                        });
                    }
                }
            }
        }

        // Draw each kingdom's boundary
        for (const [kingdomId, edges] of kingdomEdges) {
            const kingdom = world.getKingdom(kingdomId);
            if (!kingdom) continue;

            const color = kingdom.color;
            const zoom = this.camera.zoom;

            // 1. Draw "Glow" / Outer Stroke
            ctx.beginPath();
            for (const edge of edges) {
                ctx.moveTo(edge.v1.x, edge.v1.y);
                ctx.lineTo(edge.v2.x, edge.v2.y);
            }

            ctx.shadowBlur = 12 * zoom;
            ctx.shadowColor = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 4.5 * zoom;
            ctx.globalAlpha = 0.4;
            ctx.stroke();

            // 2. Draw Main Solid Border
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1.0;
            ctx.lineWidth = 2.5 * zoom;
            ctx.strokeStyle = color;
            ctx.stroke();

            // 3. Draw Inner Highlight (Inner Glow Effect)
            ctx.lineWidth = 1.0 * zoom;
            ctx.strokeStyle = '#ffffff';
            ctx.globalAlpha = 0.6;
            ctx.globalCompositeOperation = 'overlay';
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }

        ctx.restore();
    },

    /**
     * Render settlements (capitals, towns, villages)
     */
    renderSettlements(ctx) {
        const bounds = this.camera.getVisibleBounds();
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.settlement || !tile.explored) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
                if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

                const settlement = tile.settlement;
                let imageName = '', labelSize = 10;

                switch (settlement.type) {
                    case 'capital':
                        imageName = 'walledCity.png';
                        labelSize = 13;
                        break;
                    case 'town':
                        const townVariants = ['village00.png', 'village01.png', 'village02.png', 'village03.png'];
                        imageName = townVariants[(q + r) % townVariants.length];
                        labelSize = 11;
                        break;
                    case 'village':
                        const villageVariants = ['villageSmall00.png', 'villageSmall01.png', 'villageSmall02.png', 'villageSmall03.png'];
                        imageName = villageVariants[(q + r) % villageVariants.length];
                        labelSize = 10;
                        break;
                    default:
                        labelSize = 9;
                }

                // Draw Sprite
                const sprite = this.tileSprites.get(imageName);
                if (sprite) {
                    const imgW = renderSize * 2.3;
                    const imgH = imgW * (sprite.height / sprite.width);
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(sprite, screen.x - imgW / 2, screen.y - imgH / 2 + renderSize * BUILDING_BASE_NUDGE, imgW, imgH);
                } else {
                    // Fallback to icon if image failed to load
                    const icon = settlement.type === 'capital' ? '🏰' : (settlement.type === 'town' ? '🏘️' : '🏠');
                    const iconSize = Math.max(14, renderSize * 0.9);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(icon, screen.x, screen.y - renderSize * 0.15);
                }

                // Draw name label
                if (this.camera.zoom > 0.4) {
                    const fsize = Math.max(10, labelSize * 1.1 * this.camera.zoom);
                    const font = `700 ${fsize}px 'Cinzel', serif`;
                    
                    // Add to label queue with priority based on settlement type
                    let priority = 5; // Default
                    if (settlement.type === 'capital') priority = 9;
                    else if (settlement.type === 'town') priority = 7;
                    else if (settlement.type === 'village') priority = 5;

                    this.addLabel(
                        settlement.name,
                        screen.x,
                        screen.y + renderSize * 0.45,
                        priority,
                        {
                            font: font,
                            fillStyle: '#ffffff',
                            shadowColor: 'rgba(0,0,0,0.9)',
                            textAlign: 'center',
                            textBaseline: 'top'
                        }
                    );
                }
            }
        }
    },

    /**
     * Render improvements/POI
     */
    renderImprovements(ctx) {
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.improvement || !tile.explored) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
                if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

                const poi = tile.improvement;
                let imageName = '';

                switch (poi.type) {
                    case 'ruins':
                        if (tile.terrain.id === 'desert') imageName = 'desertRuins00.png';
                        else if (tile.terrain.id === 'forest') imageName = 'castleRuinForest.png';
                        else if (tile.terrain.id === 'swamp') imageName = 'castleRuinMarsh.png';
                        else if (tile.terrain.id.includes('mountain')) imageName = 'templeRuins.png';
                        else imageName = 'castleRuinDirt.png';
                        break;
                    case 'oasis':
                        imageName = (q + r) % 2 === 0 ? 'oasis00.png' : 'hexDesertDunesOasis00.png';
                        break;
                    case 'cave':
                        if (tile.terrain.id.includes('volcano')) imageName = 'volcanoCave.png';
                        else imageName = (q + r) % 2 === 0 ? 'hexMountainCave00.png' : 'hexMountainCave01.png';
                        break;
                    case 'monument':
                        imageName = (q + r) % 2 === 0 ? 'obelisk00.png' : 'standingStones.png';
                        break;
                    case 'shrine':
                        imageName = (q + r) % 2 === 0 ? 'hexDirtTemple00.png' : 'standingStonesMossy.png';
                        break;
                }

                // Draw Sprite
                const sprite = this.tileSprites.get(imageName);
                if (sprite) {
                    const imgW = renderSize * 1.8;
                    const imgH = imgW * (sprite.height / sprite.width);
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(sprite, screen.x - imgW / 2, screen.y - imgH * 0.7, imgW, imgH);
                } else {
                    // Fallback to Icon
                    const iconSize = Math.max(12, renderSize * 0.7);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.globalAlpha = 1.0;
                    ctx.fillText(poi.icon, screen.x, screen.y);
                }

                // Draw name label for POIs
                if (this.camera.zoom > 0.7) {
                    const fsize = Math.max(9, 10 * this.camera.zoom);
                    const font = `700 ${fsize}px 'Cinzel', serif`;
                    
                    // Add to label queue with medium priority
                    this.addLabel(
                        tile.improvement.name,
                        screen.x,
                        screen.y + renderSize * 0.35,
                        4, // POIs have priority 4
                        {
                            font: font,
                            fillStyle: '#ffffff',
                            shadowColor: 'rgba(0,0,0,0.9)',
                            textAlign: 'center',
                            textBaseline: 'top'
                        }
                    );
                }
            }
        }
    },

    /**
     * Render holy sites and cultural buildings on the map
     */
    renderHolySitesAndCulture(ctx) {
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.explored) continue;
                const hasHoly = !!tile.holySite;
                const hasCultural = !!tile.culturalBuilding;
                if (!hasHoly && !hasCultural) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -60 || screen.x > this.canvas.width + 60) continue;
                if (screen.y < -60 || screen.y > this.canvas.height + 60) continue;

                if (hasHoly) {
                    const site = tile.holySite;
                    // Glow effect for holy sites
                    ctx.save();
                    ctx.shadowColor = '#f5c542';
                    ctx.shadowBlur = renderSize * 0.6;
                    ctx.globalAlpha = 0.6;
                    ctx.beginPath();
                    ctx.arc(screen.x, screen.y, renderSize * 0.4, 0, Math.PI * 2);
                    ctx.fillStyle = '#f5c542';
                    ctx.fill();
                    ctx.restore();

                    // Icon
                    const iconSize = Math.max(14, renderSize * 0.85);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.globalAlpha = 1.0;
                    ctx.fillText(site.icon, screen.x, screen.y);

                    // Label
                    if (this.camera.zoom > 0.5) {
                        const fsize = Math.max(9, 10 * this.camera.zoom);
                        const font = `700 ${fsize}px 'Cinzel', serif`;
                        
                        // Add to label queue with high priority
                        this.addLabel(
                            site.name,
                            screen.x,
                            screen.y + renderSize * 0.4,
                            8, // Holy sites have high priority
                            {
                                font: font,
                                fillStyle: '#f5c542',
                                shadowColor: 'rgba(0,0,0,0.9)',
                                textAlign: 'center',
                                textBaseline: 'top'
                            }
                        );
                    }
                }

                if (hasCultural) {
                    const building = tile.culturalBuilding;
                    const iconSize = Math.max(12, renderSize * 0.7);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.globalAlpha = 1.0;
                    ctx.fillText(building.icon, screen.x, screen.y);

                    if (this.camera.zoom > 0.7) {
                        const fsize = Math.max(8, 9 * this.camera.zoom);
                        const font = `700 ${fsize}px 'Cinzel', serif`;
                        
                        // Add to label queue with low priority
                        this.addLabel(
                            building.name,
                            screen.x,
                            screen.y + renderSize * 0.35,
                            3, // Cultural buildings have lower priority
                            {
                                font: font,
                                fillStyle: '#ffffff',
                                shadowColor: 'rgba(0,0,0,0.9)',
                                textAlign: 'center',
                                textBaseline: 'top'
                            }
                        );
                    }
                }
            }
        }
    },

    /**
     * Render infrastructure (roads, bridges, irrigation channels)
     */
    renderInfrastructure(ctx) {
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.infrastructure || !tile.explored) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                // Culling
                if (screen.x < -100 || screen.x > this.canvas.width + 100) continue;
                if (screen.y < -100 || screen.y > this.canvas.height + 100) continue;

                const infra = tile.infrastructure;
                const isUnderConstruction = infra.underConstruction;

                // Dim infrastructure that is still under construction
                if (isUnderConstruction) {
                    ctx.globalAlpha = 0.4;
                }

                if (infra.id === 'dirt_road' || infra.id === 'stone_road') {
                    // Draw road segments to neighbors that also have roads
                    const neighbors = Hex.neighbors(q, r);
                    ctx.strokeStyle = infra.renderColor || '#8B7355';
                    ctx.lineWidth = (infra.renderWidth || 2) * this.camera.zoom;
                    ctx.lineCap = 'round';

                    let hasConnection = false;
                    for (const n of neighbors) {
                        const wq = Hex.wrapQ(n.q, world.width);
                        const wr = n.r;
                        if (wr < 0 || wr >= world.height) continue;

                        const nTile = world.getTile(wq, wr);
                        if (!nTile || !nTile.infrastructure) continue;
                        if (!['dirt_road', 'stone_road', 'bridge'].includes(nTile.infrastructure.id)) continue;

                        const nPos = this.getHexPixelPos(wq, wr);
                        const nScreen = this.camera.worldToScreen(nPos.x, nPos.y);

                        ctx.beginPath();
                        ctx.moveTo(screen.x, screen.y);
                        ctx.lineTo(nScreen.x, nScreen.y);
                        ctx.stroke();
                        hasConnection = true;
                    }

                    // Draw center dot if no connections (standalone road tile)
                    if (!hasConnection) {
                        ctx.beginPath();
                        ctx.arc(screen.x, screen.y, renderSize * 0.15, 0, Math.PI * 2);
                        ctx.fillStyle = infra.renderColor || '#8B7355';
                        ctx.fill();
                    }

                    // Dotted line pattern for dirt roads
                    if (infra.id === 'dirt_road') {
                        ctx.setLineDash([]);
                    }
                } else if (infra.id === 'bridge') {
                    // Draw bridge icon
                    ctx.font = `${Math.max(14, renderSize * 0.7)}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🌉', screen.x, screen.y - renderSize * 0.1);
                } else if (infra.id === 'irrigation_channel') {
                    // Draw irrigation - blue wavy lines
                    ctx.strokeStyle = infra.renderColor || '#4FC3F7';
                    ctx.lineWidth = (infra.renderWidth || 2) * this.camera.zoom;
                    ctx.globalAlpha = 0.7;

                    // Draw a small water channel pattern
                    const s = renderSize * 0.3;
                    ctx.beginPath();
                    ctx.moveTo(screen.x - s, screen.y + renderSize * 0.25);
                    ctx.quadraticCurveTo(screen.x - s * 0.5, screen.y + renderSize * 0.15, screen.x, screen.y + renderSize * 0.25);
                    ctx.quadraticCurveTo(screen.x + s * 0.5, screen.y + renderSize * 0.35, screen.x + s, screen.y + renderSize * 0.25);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;

                    // Small label
                    if (this.camera.zoom > 0.8) {
                        ctx.font = `${Math.max(10, renderSize * 0.35)}px serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('💧', screen.x, screen.y + renderSize * 0.45);
                    }
                }

                // Reset alpha after construction dimming
                if (isUnderConstruction) {
                    ctx.globalAlpha = 1.0;
                    // Draw construction indicator
                    ctx.font = `${Math.max(12, renderSize * 0.5)}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🔨', screen.x, screen.y - renderSize * 0.3);
                }

                // Draw infrastructure name label at higher zoom
                if (this.camera.zoom > 1.0) {
                    const fsize = Math.max(8, 9 * this.camera.zoom);
                    const font = `${fsize}px 'Cinzel', serif`;
                    
                    // Add to label queue with low priority
                    const labelText = isUnderConstruction
                        ? `${infra.name} (${infra.constructionDaysLeft}d)`
                        : infra.name;
                    this.addLabel(
                        labelText,
                        screen.x,
                        screen.y + renderSize * 0.55,
                        2, // Infrastructure has priority 2
                        {
                            font: font,
                            fillStyle: infra.renderColor || '#ccc',
                            shadowColor: 'rgba(0,0,0,0.7)',
                            textAlign: 'center',
                            textBaseline: 'top'
                        }
                    );
                }
            }
        }
    },

    /**
     * Render player built properties and religious buildings
     */
    renderBuiltStructures(ctx) {
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.explored) continue;
                const structure = tile.playerProperty || tile.religiousBuilding;
                if (!structure) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -100 || screen.x > this.canvas.width + 100) continue;
                if (screen.y < -100 || screen.y > this.canvas.height + 100) continue;

                let imageName = '';

                // If there's a settlement, don't draw the structure sprite on top of it
                // Instead, maybe we could draw a small indicator badge, but for now just skip the sprite
                if (tile.settlement) {
                    // Do nothing, let the settlement sprite be the main visual
                } else if (tile.playerProperty) {
                    switch (tile.playerProperty.type) {
                        case 'farm':
                            const farmVars = ['farm00.png', 'farm01.png', 'farm02.png', 'farm03.png'];
                            imageName = farmVars[(q + r) % farmVars.length];
                            break;
                        case 'mine':
                            const mineVars = ['mine00.png', 'mine01.png', 'mine02.png', 'mine03.png'];
                            imageName = mineVars[(q + r) % mineVars.length];
                            break;
                        case 'workshop': imageName = 'smithy.png'; break;
                        case 'trading_post': imageName = 'inn.png'; break;
                        case 'logging_camp':
                            const loggingVars = ['forester_hut00.png', 'forester_hut01.png', 'forester_hut02.png'];
                            imageName = loggingVars[(q + r) % loggingVars.length];
                            break;
                        case 'pasture':
                            const pastureVars = ['corral00.png', 'corral01.png', 'corral02.png'];
                            imageName = pastureVars[(q + r) % pastureVars.length];
                            break;
                    }
                } else if (tile.religiousBuilding) {
                    switch (tile.religiousBuilding.type) {
                        case 'shrine': imageName = 'standingStones.png'; break;
                        case 'temple': imageName = 'temple.png'; break;
                        case 'monastery': imageName = 'elvenLodge.png'; break;
                    }
                }

                const sprite = this.tileSprites.get(imageName);
                if (sprite) {
                    const imgW = renderSize * 1.9;
                    const imgH = imgW * (sprite.height / sprite.width);
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(sprite, screen.x - imgW / 2, screen.y - imgH * 0.7 + renderSize * BUILDING_BASE_NUDGE, imgW, imgH);
                } else {
                    // Fallback Icon
                    ctx.font = `${Math.max(14, renderSize * 0.8)}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(structure.icon, screen.x, screen.y - renderSize * 0.1);
                }

                // Draw name label
                if (this.camera.zoom > 0.6) {
                    const fsize = Math.max(9, 10 * this.camera.zoom);
                    const font = `600 ${fsize}px 'Cinzel', serif`;
                    
                    // Add to label queue with low priority
                    this.addLabel(
                        structure.name,
                        screen.x,
                        screen.y + renderSize * 0.4,
                        3, // Built structures have priority 3
                        {
                            font: font,
                            fillStyle: '#ffffff',
                            shadowColor: 'rgba(0,0,0,0.8)',
                            textAlign: 'center',
                            textBaseline: 'top'
                        }
                    );
                }
            }
        }
    },

    /**
     * Render resources on tiles
     */
    renderResources(ctx) {
        if (!this.showResources || this.camera.zoom < 0.8) return; // Only show if enabled and at closer zoom

        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.resource || !tile.visible) continue; // Resources only visible when in LOS

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
                if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

                // Small resource icon in corner of hex
                const iconSize = Math.max(9, renderSize * 0.4);
                ctx.font = `${iconSize}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Add shadow for visibility
                ctx.shadowColor = 'rgba(0,0,0,0.8)';
                ctx.shadowBlur = 4;
                ctx.fillStyle = '#ffffff';

                ctx.fillText(tile.resource.icon || '📦', screen.x + renderSize * 0.35, screen.y + renderSize * 0.35);

                // Reset shadow
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
            }
        }
    },

    /**
     * Render movement path
     */
    renderPath(ctx, path) {
        if (!path || path.length < 2) return;

        const size = this.hexSize;

        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
            const pos = this.getHexPixelPos(path[i].q, path[i].r);
            const screen = this.camera.worldToScreen(pos.x, pos.y);

            if (i === 0) {
                ctx.moveTo(screen.x, screen.y);
            } else {
                ctx.lineTo(screen.x, screen.y);
            }
        }

        ctx.strokeStyle = 'rgba(245, 197, 66, 0.6)';
        ctx.lineWidth = 3 * this.camera.zoom;
        ctx.setLineDash([8 * this.camera.zoom, 4 * this.camera.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Destination marker
        const lastHex = path[path.length - 1];
        const lastPos = this.getHexPixelPos(lastHex.q, lastHex.r);
        const lastScreen = this.camera.worldToScreen(lastPos.x, lastPos.y);

        const markerSize = 4 * this.camera.zoom;
        ctx.beginPath();
        ctx.arc(lastScreen.x, lastScreen.y, markerSize, 0, Math.PI * 2);
        ctx.fillStyle = '#f5c542';
        ctx.fill();
    },

    /**
     * Render reachable hex highlights
     */
    renderReachableHexes(ctx) {
        if (!this.reachableHexes) return;

        const size = this.hexSize;
        const pulse = Math.sin(this.time * 3) * 0.1 + 0.2;

        const yScaleR = Math.sqrt(3) / 2;

        for (const [key] of this.reachableHexes) {
            const [q, r] = key.split(',').map(Number);
            const pos = this.getHexPixelPos(q, r);
            const screen = this.camera.worldToScreen(pos.x, pos.y);
            const s = size * this.camera.zoom;

            if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
            if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

            const x = screen.x, y = screen.y;
            const X = 0.866 * s;
            const corners = [
                { x: x,     y: y - 0.732 * s },
                { x: x + X, y: y - 0.305 * s },
                { x: x + X, y: y + 0.567 * s },
                { x: x,     y: y + 1.000 * s },
                { x: x - X, y: y + 0.567 * s },
                { x: x - X, y: y - 0.305 * s },
            ];
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
            ctx.closePath();

            ctx.fillStyle = `rgba(245, 197, 66, ${pulse})`;
            ctx.fill();
        }
    },

    /**
     * Render hex highlight
     */
    renderHexHighlight(ctx, q, r, fillColor, strokeColor) {
        const size = this.hexSize;
        const pos = this.getHexPixelPos(q, r);
        const screen = this.camera.worldToScreen(pos.x, pos.y);
        const s = size * this.camera.zoom;
        const x = screen.x, y = screen.y;
        const X = 0.866 * s; // √3/2

        // Corner offsets measured from sprite pixel data (256×384 tile):
        //   Top (128,128), Upper corners (0/255,191), Lower corners (0/255,320), Bottom (128,383)
        // Converted to screen-space offsets from (cx, cy) in units of renderSize.
        const corners = [
            { x: x,     y: y - 0.732 * s },  // top
            { x: x + X, y: y - 0.305 * s },  // upper-right
            { x: x + X, y: y + 0.567 * s },  // lower-right
            { x: x,     y: y + 1.000 * s },  // bottom
            { x: x - X, y: y + 0.567 * s },  // lower-left
            { x: x - X, y: y - 0.305 * s },  // upper-left
        ];

        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();

        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2 * this.camera.zoom;
        ctx.stroke();
    },
});
