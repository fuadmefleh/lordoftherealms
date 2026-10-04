// Renderer — overlays methods.
import { Renderer } from './core.js';
import { Hex, Religion, Economy, Infrastructure, WorldUnit } from './_imports.js';

Object.assign(Renderer.prototype, {
    /**
     * Render the player character
     */
    renderPlayer(ctx) {
        const size = this.hexSize;
        const pixelPos = this.getHexPixelPos(this.player.q, this.player.r);
        const screen = this.camera.worldToScreen(pixelPos.x, pixelPos.y);
        const renderSize = size * this.camera.zoom;
        const isDead = !!this.player._isDead;

        // Player glow
        const glowPulse = Math.sin(this.time * 2) * 0.2 + 0.4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, renderSize * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = isDead
            ? `rgba(200, 30, 30, ${glowPulse * 0.2})`
            : `rgba(255, 255, 255, ${glowPulse * 0.15})`;
        ctx.fill();

        // Player circle
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, renderSize * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = isDead ? '#2e0a0a' : '#1a1a2e';
        ctx.fill();
        ctx.strokeStyle = isDead ? '#aa3333' : '#ffffff';
        ctx.lineWidth = 2.5 * this.camera.zoom;
        ctx.stroke();

        // Player icon
        const iconSize = Math.max(14, renderSize * 0.65);
        ctx.font = `${iconSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (isDead) {
            ctx.fillText('💀', screen.x, screen.y);
        } else {
            const displayIcon = this.player.boardedShip ? '⛵' : '👤';
            ctx.fillText(displayIcon, screen.x, screen.y);
        }

        // Plumbob above player on world map
        if (isDead) {
            this._drawWorldDeadPlumbob(ctx, screen.x, screen.y - renderSize * 0.55, renderSize);
        } else {
            this._drawWorldPlumbob(ctx, screen.x, screen.y - renderSize * 0.55, renderSize);
        }

        // Direction indicator / name
        if (this.camera.zoom > 0.7) {
            const fsize = Math.max(9, 11 * this.camera.zoom);
            const font = `700 ${fsize}px 'Inter', sans-serif`;
            
            // Add to label queue with highest priority
            this.addLabel(
                isDead ? 'Dead' : this.player.name,
                screen.x,
                screen.y + renderSize * 0.55,
                10,
                {
                    font: font,
                    fillStyle: isDead ? '#aa3333' : '#ffffff',
                    shadowColor: 'rgba(0,0,0,0.6)',
                    textAlign: 'center',
                    textBaseline: 'top'
                }
            );
        }
    },

    /**
     * Render the player's ships that are waiting somewhere — anchored offshore
     * after rowing ashore, or docked. The boarded ship is drawn as the player
     * icon itself, and ships under construction or sailing alone are skipped.
     */
    renderPlayerShips(ctx) {
        const ships = this.player.ships || [];
        const renderSize = this.hexSize * this.camera.zoom;
        for (const ship of ships) {
            if (ship.id === this.player.boardedShip) continue;
            if (ship.status !== 'anchored' && ship.status !== 'docked') continue;

            const pos = this.getHexPixelPos(ship.q, ship.r);
            const screen = this.camera.worldToScreen(pos.x, pos.y);
            // Docked ships sit beside the settlement icon; anchored ones own their hex
            const anchored = ship.status === 'anchored';
            const x = anchored ? screen.x : screen.x + renderSize * 0.42;
            const y = anchored ? screen.y : screen.y + renderSize * 0.3;
            const r = renderSize * (anchored ? 0.34 : 0.24);

            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(16, 32, 56, 0.85)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(245,197,66,0.8)';
            ctx.lineWidth = 1.5 * this.camera.zoom;
            ctx.stroke();

            ctx.font = `${Math.max(10, r * 1.4)}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⛵', x, y);
            if (anchored) {
                ctx.font = `${Math.max(8, r * 0.8)}px serif`;
                ctx.fillText('⚓', x + r * 0.8, y + r * 0.7);
            }

            if (anchored && this.camera.zoom > 0.7) {
                this.addLabel(ship.name, x, y + r + 2, 5, {
                    font: `600 ${Math.max(8, 10 * this.camera.zoom)}px 'Inter', sans-serif`,
                    fillStyle: '#f5c542',
                    shadowColor: 'rgba(0,0,0,0.6)',
                    textAlign: 'center',
                    textBaseline: 'top',
                });
            }
        }
    },

    /**
     * Draw a Sims plumbob (green diamond) above the player on the world map
     */
    _drawWorldPlumbob(ctx, x, topY, renderSize) {
        const size = Math.max(5, renderSize * 0.2);
        const now = performance.now() / 1000;
        const bob = Math.sin(now * 2.5) * size * 0.25;
        const cy = topY + bob;

        ctx.save();
        const glowAlpha = 0.25 + Math.sin(now * 3) * 0.1;
        ctx.shadowColor = `rgba(46, 204, 113, ${glowAlpha + 0.3})`;
        ctx.shadowBlur = size * 1.2;

        ctx.beginPath();
        ctx.moveTo(x, cy - size);
        ctx.lineTo(x + size * 0.6, cy);
        ctx.lineTo(x, cy + size);
        ctx.lineTo(x - size * 0.6, cy);
        ctx.closePath();

        const grad = ctx.createLinearGradient(x, cy - size, x, cy + size);
        grad.addColorStop(0, '#5dfc8a');
        grad.addColorStop(0.45, '#2ecc71');
        grad.addColorStop(1, '#1a9c52');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    },

    /**
     * Draw a red "dead" plumbob — static, no bob — on the world map.
     */
    _drawWorldDeadPlumbob(ctx, x, topY, renderSize) {
        const size = Math.max(5, renderSize * 0.2);
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

    /**
     * Get hex at screen position
     */
    getHexAtScreen(screenX, screenY) {
        const worldPos = this.camera.screenToWorld(screenX, screenY);

        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        // Reverting to 0.75 width spacing (perspective view) to match tiles
        const rowHeight = hexWidth * 0.75;

        // Estimate row and column
        const approxR = Math.round(worldPos.y / rowHeight);
        const approxQ = Math.round(worldPos.x / hexWidth);

        let bestHex = null;
        let minDistSq = Infinity;

        // Check neighborhood (R-1 to R+1, Q-1 to Q+1)
        for (let r = approxR - 1; r <= approxR + 1; r++) {
            for (let q = approxQ - 1; q <= approxQ + 1; q++) {
                // Check bounds (rows do not wrap)
                if (r < 0 || r >= this.world.height) continue;

                // Wrap Q
                const wq = Hex.wrapQ(q, this.world.width);

                // Get EXACT center of this candidate hex
                // We use the raw 'q' here to calculate position in unwrapped world space close to mouse
                const px = q * hexWidth + ((r % 2 === 0) ? hexWidth / 2 : 0);
                const py = r * rowHeight;

                const distSq = (worldPos.x - px) ** 2 + (worldPos.y - py) ** 2;

                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    bestHex = { q: wq, r: r };
                }
            }
        }

        return bestHex;
    },

    /**
     * Dim a hex color string
     */
    dimColor(colorStr, factor) {
        // Parse hex color
        const hex = colorStr.replace('#', '');
        const r = Math.floor(parseInt(hex.substr(0, 2), 16) * factor);
        const g = Math.floor(parseInt(hex.substr(2, 2), 16) * factor);
        const b = Math.floor(parseInt(hex.substr(4, 2), 16) * factor);
        return `rgb(${r},${g},${b})`;
    },

    /**
     * Render rivers
     */
    renderRivers(ctx) {
        // Rivers are now rendered as overlays in renderHexGrid
    },

    /**
     * Render dynamic world units
     */
    renderUnits(ctx) {
        if (!this.world || !this.world.units) return;

        const bounds = this.camera.getVisibleBounds();
        const size = this.hexSize;

        for (const unit of this.world.units) {
            // FOW: only show units on tiles the player can currently see
            const unitTile = this.world.getTile(unit.q, unit.r);
            if (!unitTile || !unitTile.visible) continue;

            const pos = this.getHexPixelPos(unit.q, unit.r);
            const screen = this.camera.worldToScreen(pos.x, pos.y);
            const renderSize = size * this.camera.zoom;

            // Simple culling
            if (screen.x < -100 || screen.x > this.canvas.width + 100) continue;
            if (screen.y < -100 || screen.y > this.canvas.height + 100) continue;

            const iconSize = Math.max(14, renderSize * 0.85);
            ctx.font = `${iconSize}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Draw unit icon
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 6;
            ctx.fillText(unit.icon, screen.x, screen.y);
            ctx.restore();

            // Unit name label
            if (this.camera.zoom > 0.4) {
                const fsize = Math.max(8, 10 * this.camera.zoom);
                const font = `500 ${fsize}px 'Inter', sans-serif`;

                let color = '#ffffff';
                if (WorldUnit.HOSTILE_TYPES.includes(unit.type)) color = '#ff6666';
                if (unit.type === 'patrol') color = '#66ccff';
                if (unit.type === 'settler') color = '#ccff66';

                // Add to label queue with medium-low priority
                this.addLabel(
                    unit.name,
                    screen.x,
                    screen.y + renderSize * 0.4,
                    3, // Units have priority 3
                    {
                        font: font,
                        fillStyle: color,
                        shadowColor: 'rgba(0,0,0,0.7)',
                        textAlign: 'center',
                        textBaseline: 'top'
                    }
                );
            }
        }
    },

    /**
     * Render weather overlay
     */
    renderWeather(ctx) {
        if (!this.world || !this.world.weather) return;

        const bounds = this.camera.getVisibleBounds();
        const width = this.world.width;
        const height = this.world.height;
        const size = this.hexSize;
        const zoom = this.camera.zoom;

        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;
        const padding = 1;

        const startRow = Math.floor((bounds.top) / rowHeight) - padding;
        const endRow = Math.ceil((bounds.bottom) / rowHeight) + padding;
        const minR = Math.max(0, startRow);
        const maxR = Math.min(height - 1, endRow);

        // Batched drawing for performance
        // Rain
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(180, 200, 255, 0.4)';
        ctx.lineWidth = 1 * zoom;

        // Snow
        const snowParticles = []; // Store centers

        // Storm
        let hasStorm = false;

        for (let r = minR; r <= maxR; r++) {
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            const startCol = Math.floor((bounds.left - offsetX) / hexWidth) - padding;
            const endCol = Math.ceil((bounds.right - offsetX) / hexWidth) + padding;

            for (let q = startCol; q <= endCol; q++) {
                const wq = Hex.wrapQ(q, width);
                const weather = this.world.weather.getWeather(wq, r);

                if (weather.type === 'clear' || weather.type === 'heatwave') continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);

                // Random seed for this tile's particles
                const seed = (Math.sin(q * 12.9898 + r * 78.233) * 43758.5453);

                if (weather.type === 'rain' || weather.type === 'storm') {
                    // Draw rain lines
                    for (let i = 0; i < 3; i++) {
                        const rx = (seed * (i + 1) % 40) - 20;
                        const ry = (seed * (i + 2) % 40) - 20;
                        ctx.moveTo(screen.x + rx, screen.y + ry);
                        ctx.lineTo(screen.x + rx - 5 * zoom, screen.y + ry + 10 * zoom);
                    }
                    if (weather.type === 'storm') hasStorm = true;
                } else if (weather.type === 'snow' || weather.type === 'blizzard') {
                    // Collect snow
                    for (let i = 0; i < 3; i++) {
                        const rx = (seed * (i + 1) % 40) - 20;
                        const ry = (seed * (i + 2) % 40) - 20;
                        // Deterministic snow?
                        if (Math.abs((seed * (i + 3)) % 1) < 0.5) snowParticles.push({ x: screen.x + rx, y: screen.y + ry });
                    }
                }
            }
        }
        ctx.stroke(); // Draw all rain

        // Draw Snow
        if (snowParticles.length > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.beginPath();
            for (const p of snowParticles) {
                ctx.moveTo(p.x, p.y);
                ctx.arc(p.x, p.y, 1.5 * zoom, 0, Math.PI * 2);
            }
            ctx.fill();
        }

        // Global Storm Overlay (Lightning flash)
        if (hasStorm) {
            // Random flash
            if (Math.random() < 0.01) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
            // Darken
            ctx.fillStyle = 'rgba(0, 0, 20, 0.15)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    },

    // ============================================
    // MAP MODE OVERLAY SYSTEM
    // ============================================
    /**
     * Render a map-mode colour overlay on a single hex.
     * Called inside renderSpriteHex after the hex clip path is set.
     */
    renderMapModeOverlay(ctx, tile) {
        let color = null;
        let alpha = 0.45;

        switch (this.mapMode) {
            case 'political': {
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k) color = k.color;
                    alpha = 0.35;
                } else {
                    color = '#222';
                    alpha = 0.15;
                }
                break;
            }

            case 'religion': {
                let faithId = null;
                if (tile.holySite) {
                    faithId = tile.holySite.faithId;
                    alpha = 0.65;
                } else if (tile.religiousBuilding) {
                    faithId = tile.religiousBuilding.faithId || (tile.kingdom && this.world.getKingdom(tile.kingdom)?.religion?.faithId);
                    alpha = 0.55;
                } else if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    faithId = k?.religion?.faithId;
                    alpha = 0.30;
                }
                if (faithId && Religion.FAITHS[faithId]) {
                    color = Religion.FAITHS[faithId].holyColor;
                } else {
                    color = '#1a1a2e';
                    alpha = 0.20;
                }
                break;
            }

            case 'wealth': {
                if (tile.settlement) {
                    const prod = Economy.calculateDetailedProduction(tile.settlement, tile, this.world);
                    const gold = prod ? prod.gold : 0;
                    // Scale: 0→red, 50→yellow, 150+→green
                    const t = Math.min(1, gold / 150);
                    const r = Math.round(255 * (1 - t));
                    const g = Math.round(200 * t);
                    color = `rgb(${r},${g},40)`;
                    alpha = 0.55;
                } else if (tile.resource) {
                    color = '#d4a017';
                    alpha = 0.30;
                } else if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k) {
                        const wealthPerHex = k.treasury / Math.max(1, k.territory.length);
                        const t = Math.min(1, wealthPerHex / 30);
                        const r = Math.round(200 * (1 - t));
                        const g = Math.round(180 * t);
                        color = `rgb(${r},${g},50)`;
                        alpha = 0.25;
                    }
                } else {
                    color = '#111';
                    alpha = 0.15;
                }
                break;
            }

            case 'military': {
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k) {
                        // Normalise military 0-5000 → intensity
                        const ratio = Math.min(1, k.military / 5000);
                        const r = Math.round(255 * ratio);
                        const g = Math.round(60 * (1 - ratio));
                        color = `rgb(${r},${g},30)`;
                        alpha = 0.35;
                        // Capital gets stronger tint
                        if (k.capital && tile.settlement && tile.settlement.type === 'capital') alpha = 0.55;
                    }
                } else {
                    color = '#111';
                    alpha = 0.10;
                }
                break;
            }

            case 'trade': {
                if (tile.hasRoad || (tile.infrastructure && tile.infrastructure.id)) {
                    color = '#f5c542';
                    alpha = 0.50;
                } else if (tile.settlement) {
                    color = '#e08e45';
                    alpha = 0.45;
                } else if (tile.resource) {
                    color = '#d4a017';
                    alpha = 0.30;
                } else if (tile.terrain && !tile.terrain.passable) {
                    color = '#0a0a20';
                    alpha = 0.40;
                } else {
                    color = '#111';
                    alpha = 0.10;
                }
                break;
            }

            case 'culture': {
                if (tile.culturalBuilding) {
                    const owner = tile.culturalBuilding.owner;
                    if (owner) {
                        const k = this.world.getKingdom(owner);
                        color = k ? k.color : '#9b59b6';
                    } else {
                        color = '#9b59b6';
                    }
                    alpha = 0.60;
                } else if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k && k.cultureData) {
                        const influence = k.cultureData.influence || 0;
                        const t = Math.min(1, influence / 100);
                        const r = Math.round(100 + 155 * t);
                        const g = Math.round(60 * (1 - t));
                        const b = Math.round(120 + 60 * t);
                        color = `rgb(${r},${g},${b})`;
                        alpha = 0.30;
                    }
                } else {
                    color = '#111';
                    alpha = 0.10;
                }
                break;
            }
        }

        if (color) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }
    },

    /**
     * Render trade route lines between settlements (used in 'trade' map mode)
     */
    renderTradeRoutes(ctx) {
        if (this.mapMode !== 'trade' || !this.world) return;

        const settlements = this.world.getAllSettlements();
        if (!settlements || settlements.length < 2) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(245, 197, 66, 0.25)';
        ctx.lineWidth = 2 * this.camera.zoom;
        ctx.setLineDash([6 * this.camera.zoom, 4 * this.camera.zoom]);

        // Draw connections between settlements within the same kingdom
        for (let i = 0; i < settlements.length; i++) {
            for (let j = i + 1; j < settlements.length; j++) {
                const a = settlements[i];
                const b = settlements[j];
                if (a.kingdom !== b.kingdom) continue;

                const dist = Hex.wrappingDistance(a.q, a.r, b.q, b.r, this.world.width);
                if (dist > 12) continue; // Only show nearby trade links

                const posA = this.getHexPixelPos(a.q, a.r);
                const posB = this.getHexPixelPos(b.q, b.r);
                const screenA = this.camera.worldToScreen(posA.x, posA.y);
                const screenB = this.camera.worldToScreen(posB.x, posB.y);

                ctx.beginPath();
                ctx.moveTo(screenA.x, screenA.y);
                ctx.lineTo(screenB.x, screenB.y);
                ctx.stroke();
            }
        }

        // Also draw pilgrim routes if Religion system shows them
        if (typeof Religion !== 'undefined' && Religion.PILGRIM_ROUTES) {
            ctx.strokeStyle = 'rgba(200, 160, 255, 0.30)';
            ctx.lineWidth = 2.5 * this.camera.zoom;
            ctx.setLineDash([4 * this.camera.zoom, 6 * this.camera.zoom]);

            for (const route of Religion.PILGRIM_ROUTES) {
                if (!route.from || !route.to) continue;
                const posA = this.getHexPixelPos(route.from.q, route.from.r);
                const posB = this.getHexPixelPos(route.to.q, route.to.r);
                const screenA = this.camera.worldToScreen(posA.x, posA.y);
                const screenB = this.camera.worldToScreen(posB.x, posB.y);

                ctx.beginPath();
                ctx.moveTo(screenA.x, screenA.y);
                ctx.lineTo(screenB.x, screenB.y);
                ctx.stroke();
            }
        }

        ctx.setLineDash([]);
        ctx.restore();
    },

    /**
     * Get colour for a tile based on current map mode (used by Minimap)
     */
    getMapModeColor(tile) {
        switch (this.mapMode) {
            case 'political':
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    return k ? k.color : tile.terrain.color;
                }
                return this.dimColor(tile.terrain.color, 0.5);

            case 'religion': {
                let faithId = null;
                if (tile.holySite) faithId = tile.holySite.faithId;
                else if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    faithId = k?.religion?.faithId;
                }
                if (faithId && Religion.FAITHS[faithId]) return Religion.FAITHS[faithId].holyColor;
                return '#1a1a2e';
            }

            case 'wealth': {
                if (tile.settlement) {
                    const prod = Economy.calculateDetailedProduction(tile.settlement, tile, this.world);
                    const g = prod ? prod.gold : 0;
                    const t = Math.min(1, g / 150);
                    return `rgb(${Math.round(255*(1-t))},${Math.round(200*t)},40)`;
                }
                if (tile.resource) return '#d4a017';
                if (tile.kingdom) return '#4a3520';
                return '#111';
            }

            case 'military': {
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k) {
                        const ratio = Math.min(1, k.military / 5000);
                        return `rgb(${Math.round(255*ratio)},${Math.round(60*(1-ratio))},30)`;
                    }
                }
                return '#111';
            }

            case 'trade': {
                if (tile.hasRoad || tile.infrastructure) return '#f5c542';
                if (tile.settlement) return '#e08e45';
                if (tile.resource) return '#d4a017';
                return tile.terrain.passable ? '#2a2520' : '#0a0a20';
            }

            case 'culture': {
                if (tile.culturalBuilding) return '#9b59b6';
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k && k.cultureData) {
                        const inf = Math.min(1, (k.cultureData.influence || 0) / 100);
                        return `rgb(${Math.round(100+155*inf)},${Math.round(60*(1-inf))},${Math.round(120+60*inf)})`;
                    }
                }
                return '#111';
            }

            default:
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    return k ? k.color : tile.terrain.color;
                }
                return tile.terrain.color;
        }
    },
});
