// Renderer — overlays methods.
import { Renderer } from './core.js';
import { Hex, Religion, Economy, Infrastructure, WorldUnit, Hinterland } from './_imports.js';
import { drawGlyph } from '../icons.js';

/** Each unit type's glyph on its map token (ui/icons.js); unknown types keep their emoji. */
const UNIT_GLYPHS = {
    caravan: 'wagon', trade_caravan: 'wagon', raider: 'axe', patrol: 'helm', road_patrol: 'helm',
    settler: 'tent', ship: 'ship', trade_ship: 'ship', war_fleet: 'ship', pirate: 'skull',
    fishing_boat: 'boat', lord_party: 'crown', mercenary_band: 'swords', war_host: 'swords',
    lair_expedition: 'swords', pilgrim_group: 'chalice', smuggler: 'moon', refugee: 'sack',
    beast: 'paw', monster: 'claw', diplomatic_envoy: 'seal',
};

/** Token metal by allegiance: rim/glyph colour and the enamel behind it. */
const TOKEN_METALS = {
    hostile: { rim: '#e8604f', hi: '#4a1414', lo: '#1a0606' },
    merchant: { rim: '#ecc56e', hi: '#3a2f18', lo: '#140f06' },
    royal: { rim: '#ffe08a', hi: '#43301a', lo: '#170e05' },
    watch: { rim: '#8fb8ea', hi: '#1d2c48', lo: '#080e1a' },
    settler: { rim: '#a9da70', hi: '#203317', lo: '#081106' },
    common: { rim: '#e6dcc4', hi: '#2a2e3a', lo: '#0c0e14' },
};

function unitMetal(unit) {
    if (WorldUnit.HOSTILE_TYPES.includes(unit.type)) return TOKEN_METALS.hostile;
    switch (unit.type) {
        case 'caravan': case 'trade_caravan': case 'ship': case 'trade_ship': return TOKEN_METALS.merchant;
        case 'lord_party': return TOKEN_METALS.royal;
        case 'patrol': case 'road_patrol': case 'war_fleet': return TOKEN_METALS.watch;
        case 'settler': return TOKEN_METALS.settler;
        default: return TOKEN_METALS.common;
    }
}

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

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (!drawGlyph(ctx, 'ship', x, y, r * 1.35, '#ffe08a', 2)) {
                ctx.font = `${Math.max(10, r * 1.4)}px serif`;
                ctx.fillText('⛵', x, y);
            }
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
    /**
     * Falsehoods from doctored or propaganda maps the player has read
     * (player.mapDeceptions): drawn faintly on hexes the player can't see,
     * gone once they look for themselves (Cartography.exposeDeceptions).
     */
    renderMapDeceptions(ctx) {
        const decs = this.player && this.player.mapDeceptions;
        if (!decs || !this.world) return;
        const z = this.camera.zoom;
        const size = this.hexSize * z;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const d of Object.values(decs)) {
            const tile = this.world.getTile(d.q, d.r);
            if (!tile || tile.visible) continue;
            const pos = this.getHexPixelPos(d.q, d.r);
            const s = this.camera.worldToScreen(pos.x, pos.y);
            if (s.x < -60 || s.x > this.canvas.width + 60 || s.y < -60 || s.y > this.canvas.height + 60) continue;
            ctx.globalAlpha = 0.7;
            if (d.type === 'settlement') {
                ctx.font = `${Math.max(12, size * 0.8)}px serif`;
                ctx.fillText('🏘️', s.x, s.y);
                if (z > 0.6) {
                    ctx.font = `${Math.max(9, 11 * z)}px serif`;
                    ctx.fillStyle = 'rgba(240, 220, 170, 0.9)';
                    ctx.fillText(d.false_settlement, s.x, s.y + size * 0.75);
                }
            } else if (d.type === 'path') {
                ctx.strokeStyle = 'rgba(190, 150, 90, 0.8)';
                ctx.lineWidth = Math.max(1.5, 3 * z);
                ctx.setLineDash([4 * z, 3 * z]);
                ctx.beginPath();
                ctx.moveTo(s.x - size * 0.6, s.y);
                ctx.lineTo(s.x + size * 0.6, s.y);
                ctx.stroke();
                ctx.setLineDash([]);
            } else if (d.type === 'terrain') {
                const icon = { forest: '🌲', mountains: '⛰️', swamp: '🌿', desert: '🏜️' }[d.false_terrain] || '❔';
                ctx.font = `${Math.max(10, size * 0.6)}px serif`;
                ctx.fillText(icon, s.x, s.y);
            } else if (d.type === 'false_border') {
                const k = this.world.getKingdom(d.claimedKingdom);
                ctx.fillStyle = (k && k.color) || 'rgba(200, 60, 60, 1)';
                ctx.globalAlpha = 0.22;
                ctx.beginPath();
                ctx.arc(s.x, s.y, size * 0.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    },

    /**
     * Places on no map until found (player.discovery, systems/discovery.js):
     * found places with their name, a faint ❔ where a chart or rumour points.
     */
    renderDiscoveries(ctx) {
        const st = this.player && this.player.discovery;
        if (!st || !Array.isArray(st.sites) || !this.world) return;
        const z = this.camera.zoom;
        const size = this.hexSize * z;
        const ICON = { island: '🏝️', cove: '🌊', valley: '⛰️', reef: '🐚' };
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const site of st.sites) {
            let q = site.q;
            let r = site.r;
            let icon = ICON[site.kind] || '❔';
            if (!site.known) {
                if (!site.hint) continue;
                icon = '❔';
                if (site.hint === 'rumoured') { q = site.hintQ; r = site.hintR; }
            }
            const pos = this.getHexPixelPos(q, r);
            const s = this.camera.worldToScreen(pos.x, pos.y);
            if (s.x < -60 || s.x > this.canvas.width + 60 || s.y < -60 || s.y > this.canvas.height + 60) continue;
            ctx.globalAlpha = site.known ? 0.95 : 0.55;
            ctx.font = `${Math.max(10, size * 0.55)}px serif`;
            ctx.fillText(icon, s.x + size * 0.35, s.y - size * 0.35);
            if (site.known && z > 0.6) {
                ctx.font = `${Math.max(9, 10 * z)}px serif`;
                ctx.fillStyle = site.claim && site.claim.by === 'player' ? 'rgba(160, 230, 160, 0.95)' : 'rgba(240, 220, 170, 0.95)';
                ctx.fillText(site.name, s.x, s.y + size * 0.8);
            }
        }
        ctx.restore();
    },

    /**
     * Outlaw lairs the player knows of (player.outlawLairs, systems/outlawLairs.js):
     * the lair's icon with a red ring scaled by notoriety, its name and chief;
     * a faint ❔ where tavern talk places a lair not yet found; a gold ring
     * round a lair under a bargain (tribute or partnership).
     */
    renderOutlawLairs(ctx) {
        const st = this.player && this.player.outlawLairs;
        if (!st || !Array.isArray(st.lairs) || !this.world) return;
        const z = this.camera.zoom;
        const size = this.hexSize * z;
        const ICON = { bandit_camp: '🏕️', smugglers_den: '⚓', deserter_fort: '🏚️', cultist_grotto: '🕯️', beast_den: '🐺' };
        const day = this.world.day || 0;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const lair of st.lairs) {
            if (!lair || lair.status !== 'active' || !(lair.known || lair.rumoured)) continue;
            const q = lair.known ? lair.q : lair.hintQ;
            const r = lair.known ? lair.r : lair.hintR;
            const pos = this.getHexPixelPos(q, r);
            const s = this.camera.worldToScreen(pos.x, pos.y);
            if (s.x < -60 || s.x > this.canvas.width + 60 || s.y < -60 || s.y > this.canvas.height + 60) continue;
            if (!lair.known) {
                ctx.globalAlpha = 0.5;
                ctx.font = `${Math.max(10, size * 0.5)}px serif`;
                ctx.fillText('❔', s.x, s.y);
                continue;
            }
            const bargain = lair.allied || (lair.tribute && lair.tribute.until >= day);
            const n = Math.max(0, Math.min(100, lair.notoriety || 0));
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = bargain ? 'rgba(230, 190, 60, 0.9)' : `rgba(${150 + Math.round(n)}, 40, 30, 0.9)`;
            ctx.lineWidth = Math.max(1.5, (1.5 + n / 40) * z);
            ctx.beginPath();
            ctx.arc(s.x, s.y, size * 0.7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 0.95;
            ctx.font = `${Math.max(12, size * 0.7)}px serif`;
            ctx.fillText(ICON[lair.kind] || '🏕️', s.x, s.y);
            if (z > 0.55) {
                ctx.font = `bold ${Math.max(9, 10 * z)}px serif`;
                ctx.fillStyle = bargain ? 'rgba(240, 215, 130, 0.95)' : 'rgba(255, 170, 150, 0.95)';
                ctx.fillText(lair.name, s.x, s.y + size * 0.85);
                if (z > 0.9 && lair.leader) {
                    ctx.font = `${Math.max(8, 9 * z)}px serif`;
                    ctx.fillStyle = 'rgba(220, 200, 190, 0.85)';
                    ctx.fillText(lair.leader.slain ? 'leaderless' : lair.leader.name, s.x, s.y + size * 1.15);
                }
            }
        }
        ctx.restore();
    },

    /**
     * The hinterland's rural sites on explored hexes (world/hinterland.js):
     * the site's icon, small, with a deposit's reserve as a bar beneath it
     * (green, amber, red as it runs down), a grey cross over a worked-out
     * mine and a gold ring round the player's own leases.
     */
    renderHinterland(ctx) {
        const st = this.world && this.world.hinterland;
        if (!st || !Array.isArray(st.sites) || !st.sites.length) return;
        const z = this.camera.zoom;
        const M = Hinterland.config().markers;
        if (z < M.minZoom) return;
        const size = this.hexSize * z;
        const mine = new Set((st.concessions || []).filter(c => c.status === 'active' && c.holder === 'player').map(c => c.site));
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const site of st.sites) {
            const tile = this.world.getTile(site.q, site.r);
            if (!tile || !tile.explored) continue;
            const pos = this.getHexPixelPos(site.q, site.r);
            const s = this.camera.worldToScreen(pos.x, pos.y);
            if (s.x < -40 || s.x > this.canvas.width + 40 || s.y < -40 || s.y > this.canvas.height + 40) continue;
            const k = Hinterland.kind(site.kind);
            if (!k) continue;
            const x = s.x + size * 0.38, y = s.y - size * 0.38;
            ctx.globalAlpha = site.st === 'exhausted' ? 0.45 : 0.9;
            ctx.font = `${Math.max(9, size * 0.36)}px serif`;
            ctx.fillText(k.icon, x, y);
            if (mine.has(site.id)) {
                ctx.strokeStyle = 'rgba(240, 200, 70, 0.95)';
                ctx.lineWidth = Math.max(1.2, 1.5 * z);
                ctx.beginPath();
                ctx.arc(x, y, size * 0.26, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (site.st === 'exhausted') {
                ctx.strokeStyle = 'rgba(200, 200, 200, 0.9)';
                ctx.lineWidth = Math.max(1, z);
                const d = size * 0.15;
                ctx.beginPath();
                ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
                ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
                ctx.stroke();
            } else if (site.res0 > 0) {
                const f = Hinterland.reserveFrac(site);
                const w = size * 0.4, h = Math.max(2, 2.5 * z);
                ctx.globalAlpha = 0.85;
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(x - w / 2, y + size * 0.2, w, h);
                ctx.fillStyle = f > M.low ? '#5fbf6a' : f > M.critical ? '#e8a040' : '#e74c3c';
                ctx.fillRect(x - w / 2, y + size * 0.2, w * f, h);
            }
        }
        ctx.restore();
    },

    /**
     * Holdings under siege (player.realmWars.besieged, systems/holdingSieges.js):
     * a red ring on the hex, crossed swords and the day count of the siege.
     */
    renderHoldingSieges(ctx) {
        const b = this.player && this.player.realmWars && this.player.realmWars.besieged;
        if (!b || !this.world) return;
        const sieges = Object.values(b);
        if (!sieges.length) return;
        const z = this.camera.zoom;
        const size = this.hexSize * z;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const s of sieges) {
            const pos = this.getHexPixelPos(s.q, s.r);
            const p = this.camera.worldToScreen(pos.x, pos.y);
            if (p.x < -60 || p.x > this.canvas.width + 60 || p.y < -60 || p.y > this.canvas.height + 60) continue;
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = s.stores <= 0 ? 'rgba(255, 60, 40, 0.95)' : 'rgba(231, 76, 60, 0.85)';
            ctx.lineWidth = Math.max(2, 3 * z);
            if (ctx.setLineDash) ctx.setLineDash([6 * z, 4 * z]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, size * 0.85, 0, Math.PI * 2);
            ctx.stroke();
            if (ctx.setLineDash) ctx.setLineDash([]);
            this.drawMarkerPlate(ctx, p.x - size * 0.45, p.y - size * 0.45, Math.max(8, size * 0.28), '#e8604f');
            if (!drawGlyph(ctx, 'swords', p.x - size * 0.45, p.y - size * 0.45, Math.max(10, size * 0.36), '#ff8a78', 2.2)) {
                ctx.font = `${Math.max(10, size * 0.5)}px serif`;
                ctx.fillText('⚔️', p.x - size * 0.45, p.y - size * 0.45);
            }
            if (z > 0.5) {
                ctx.font = `bold ${Math.max(9, 10 * z)}px serif`;
                ctx.fillStyle = 'rgba(255, 190, 170, 0.95)';
                ctx.fillText(`Siege · day ${(this.world.day || 0) - s.startDay}`, p.x, p.y - size * 0.95);
            }
        }
        ctx.restore();
    },

    /** A small dark plate with a metal rim: the ground every map marker sits on. */
    drawMarkerPlate(ctx, x, y, r, rim = 'rgba(232, 192, 112, 0.6)') {
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = r * 0.6;
        ctx.shadowOffsetY = r * 0.12;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
        g.addColorStop(0, 'rgba(46, 54, 74, 0.95)');
        g.addColorStop(1, 'rgba(10, 13, 22, 0.95)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = Math.max(1, r * 0.13);
        ctx.strokeStyle = rim;
        ctx.stroke();
        ctx.restore();
    },

    /**
     * A unit as a struck token: an enamelled disc rimmed in its allegiance's
     * metal with the type's glyph engraved on it. Ships ride the swell, hostile
     * tokens smoulder, a caravan you guard wears a gold halo.
     */
    renderUnitToken(ctx, unit, x, y, renderSize) {
        const glyph = UNIT_GLYPHS[unit.type];
        const r = Math.max(9, renderSize * 0.34);
        const metal = unitMetal(unit);
        const hostile = metal === TOKEN_METALS.hostile;
        const phase = (unit.q * 7 + unit.r * 13) % 10;
        if (unit.domain === 'sea' || /ship|boat|fleet|pirate/.test(unit.type)) y += Math.sin(this.time * 1.6 + phase) * r * 0.08;

        ctx.save();
        // Shadow cast on the land
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.95, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();

        if (hostile || (unit.escort && unit.escort.by === 'player')) {
            const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + phase);
            ctx.shadowColor = metal.rim;
            ctx.shadowBlur = r * (0.6 + 0.6 * pulse);
        }
        // Enamel
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
        g.addColorStop(0, metal.hi);
        g.addColorStop(1, metal.lo);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Rim: dark bevel, the metal, an inner hairline
        ctx.lineWidth = Math.max(1.5, r * 0.16);
        ctx.strokeStyle = metal.rim;
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.arc(x, y, r + ctx.lineWidth + r * 0.06, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
        ctx.stroke();

        if (!glyph || !drawGlyph(ctx, glyph, x, y, r * 1.25, metal.rim, 2)) {
            ctx.font = `${r * 1.2}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(unit.icon, x, y + r * 0.05);
        }
        ctx.restore();
    },

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

            this.renderUnitToken(ctx, unit, screen.x, screen.y, renderSize);

            // Unit name label
            if (this.camera.zoom > 0.4) {
                const fsize = Math.max(8, 10 * this.camera.zoom);
                const font = `500 ${fsize}px 'Inter', sans-serif`;

                let color = '#ffffff';
                if (WorldUnit.HOSTILE_TYPES.includes(unit.type)) color = '#ff6666';
                if (unit.type === 'patrol' || unit.type === 'road_patrol') color = '#66ccff';
                // NPC merchants (systems/merchantCaravans.js): gold, brighter when you guard them
                if (unit.type === 'trade_caravan' || unit.type === 'trade_ship') color = unit.escort && unit.escort.by === 'player' ? '#ffe680' : '#e8c070';
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

    // renderWeather lives in renderer/atmosphere.js (animated rain, snow, lightning)

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

            case 'prices': {
                // The trade map: the land dimmed so the price markers stand out
                color = tile.settlement ? '#2a2318' : '#07080f';
                alpha = tile.settlement ? 0.25 : 0.4;
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
                // Roads by their state (world/transport.js bakes roadBand / roadTier)
                if (tile.hasRoad && tile.roadBand && tile.roadBand !== 'good') {
                    return tile.roadBand === 'closed' ? '#8fb4d8' : tile.roadBand === 'ruined' ? '#b0443a' : '#d08a3a';
                }
                if (tile.hasRoad && tile.roadTier === 'highway') return '#fff3b0';
                if (tile.hasRoad && tile.roadTier === 'track') return '#b8954a';
                if (tile.hasRoad || tile.infrastructure) return '#f5c542';
                if (tile.settlement) return '#e08e45';
                if (tile.resource) return '#d4a017';
                return tile.terrain.passable ? '#2a2520' : '#0a0a20';
            }

            case 'prices':
                return tile.settlement ? '#e08e45' : this.dimColor(tile.terrain.color, 0.35);

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
