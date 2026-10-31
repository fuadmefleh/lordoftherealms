// ============================================
// INNER MAP � enter/exit inner map, inner map UI, tiled export/import
// ============================================

import { Camera, Renderer, Player, World, SaveLoad, Terrain, Banking, MarketDynamics, Taxation, Characters, Minimap, UI, Quests, Achievements, Technology, Relationships, Ships, Titles, Councils, InnerMap, InnerMapRenderer, InnerMapCharacters, InnerMapCombat, LightSystem, ModStore, audioManager, DataLoader, Hex, Utils, PlayerActions, PlayerEconomy, PlayerMilitary, ActionMenu, Housing, Espionage, Gossip, Tavern, Economy, TiledExport, CustomObjects, CustomBuildings, Hotbar, NpcDialog } from './_gameImports.js';
import { Wilds } from '../../player/wilds.js';
import { showWildsEncounter } from '../wildsEncounter.js';

export async function enterInnerMap(worldQ, worldR) {
    if (!this.world || !this.player) return;
    if (typeof InnerMap === 'undefined') return;
    if (InnerMap.active) return;

    // Prevent concurrent async entry — the await below creates a window
    // where a second click could pass the guard above and double-enter.
    if (this._enteringInnerMap) return;
    this._enteringInnerMap = true;

    try {
        const tile = this.world.getTile(worldQ, worldR);
        const isPlayerTile = this.player && this.player.q === worldQ && this.player.r === worldR;
        const isKnownTile = !!tile && (tile.explored || tile.visible || isPlayerTile);
        if (!isKnownTile) {
            this.ui.showNotification('Unexplored', 'You must explore this tile first!', 'error');
            return;
        }

        if (tile.visible && !tile.explored) {
            tile.explored = true;
        }

        // Only allow on passable land tiles
        if (!tile.terrain.passable) {
            this.ui.showNotification('Impassable', 'You cannot explore the interior of this terrain.', 'error');
            return;
        }

        // Show loading feedback while sprites load (first visit can take a moment)
        this.ui.showNotification('⏳ Loading', 'Preparing inner map…', 'info');

        // Give inner-map renderer access to sprites FIRST so CustomBuildings etc. are loaded
        // before InnerMap.enter() generates tile data (buildings are placed during generation).
        InnerMapRenderer.setRenderer(this.renderer);
        try {
            await InnerMapRenderer.whenLoaded();
        } catch (err) {
            console.warn('[Game] InnerMapRenderer assets failed to load fully; continuing with available assets.', err);
        }

        // Re-check after async gap — another code-path may have entered in the meantime
        if (InnerMap.active) return;

        const success = InnerMap.enter(this, worldQ, worldR);
        if (!success) {
            this.ui.showNotification('Error', 'Cannot enter this tile.', 'error');
            return;
        }

        if (!Array.isArray(InnerMap.tiles) || !InnerMap.tiles.length || !Array.isArray(InnerMap.tiles[0]) || !InnerMap.tiles[0].length) {
            this.ui.showNotification('Error', 'Inner map data failed to generate.', 'error');
            InnerMap.exit(this);
            return;
        }

        this.innerMapMode = true;
        this._innerMapDayEndShown = false;
        this._clearInnerMapSelection();
        // Remember the world zoom: both cameras listen to the wheel on this canvas
        this._worldZoomBeforeInner = { zoom: this.camera.zoom, targetZoom: this.camera.targetZoom };

        // Set up inner map camera bounds — no horizontal wrapping (unlike world map)
        const tileSize = InnerMapRenderer.tileSize;
        const mapWidth = InnerMap.width || InnerMap.tiles[0].length;
        const mapHeight = InnerMap.height || InnerMap.tiles.length;
        const innerPixelWidth = tileSize * mapWidth;
        const innerPixelHeight = tileSize * mapHeight;
        this.innerMapCamera.setWorldBounds(0, innerPixelHeight);  // width=0 disables X-wrap

        // Zoom level — lock to ~10 visible tiles for stable click/path feel
        const canvasW = this.canvas.width;
        const canvasH = this.canvas.height;
        const VISIBLE_TILES = 10;
        const zoomLevel = Math.min(canvasW, canvasH) / (VISIBLE_TILES * tileSize);
        const clampedZoom = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 2.0;
        this.innerMapCamera.minZoom = Math.max(0.5, clampedZoom * 0.5);
        this.innerMapCamera.maxZoom = clampedZoom * 2.0;
        this.innerMapCamera.zoom = clampedZoom;
        this.innerMapCamera.targetZoom = clampedZoom;

        // Center camera on the player position (camera is locked to player)
        const playerWorld = InnerMap.getPlayerWorldPos();
        this.innerMapCamera.centerOn(playerWorld.x, playerWorld.y);
        this.innerMapCamera.precomputeFrame();

        // Hide world map UI elements
        this._hideWorldMapUI();

        // Show inner map exit button
        this._showInnerMapExitButton();

        // Show hotbar
        Hotbar.init(this);
        Hotbar.show();

        // Notification
        const terrainName = tile.terrain.name || tile.terrain.id;
        if (tile.settlement) {
            this.ui.showNotification('🏘️ Entering Settlement',
                `Welcome to ${tile.settlement.name}! Time: ${InnerMap.getTimeString()}. Right-click buildings to interact.`, 'info');

            // Check guard hostility from gossip/rumors
            const hostility = Gossip.checkGuardHostility(this.player, worldQ, worldR, this.world);
            if (hostility.warrant || hostility.banned) {
                this.ui.showNotification(hostility.warrant ? '⚖️ Wanted!' : '🚫 Unwelcome',
                    `${hostility.warrant ? 'The crown has a warrant out for you.' : 'Word of your crimes has reached this place.'} Merchants and officials will turn you away until you settle with the guard tower${hostility.bountyTotal ? ` (bounty ${hostility.bountyTotal}g)` : ''}.`, 'error');
            } else if (hostility.hostile) {
                this.ui.showNotification('⚠️ Hostile Guards!',
                    `The guards here know about your crimes! Bounty: ${hostility.bountyTotal}g. Settle it at the guard tower.`, 'error');
            }
        } else {
            this.ui.showNotification('🗺️ Entering Inner Map',
                `Exploring the interior of ${terrainName}. Right-click to move, ESC to return.`, 'info');
        }
    } finally {
        this._enteringInnerMap = false;
        this.innerMapMode = !!InnerMap.active;
    }
}

/**
 * Exit the inner map and return to the world map
 */
export function exitInnerMap(opts = {}) {
    if (!InnerMap.active) return;

    InnerMapRenderer.closeContextMenu();
    InnerMap.exit(this);
    this.innerMapMode = false;
    this._innerMapDayEndShown = false;
    this._clearInnerMapSelection();

    // Remove exit button
    this._hideInnerMapExitButton();

    // Hide hotbar
    Hotbar.hide();

    // Close any open dialog
    NpcDialog.close();

    // Restore world map UI
    this._showWorldMapUI();

    // The world camera shares the canvas, so the wheel zoomed it too while
    // inside: put back the zoom it had on entry
    const saved = this._worldZoomBeforeInner;
    if (saved) {
        this.camera.zoom = saved.zoom;
        this.camera.targetZoom = saved.targetZoom;
        this._worldZoomBeforeInner = null;
    }

    // Re-center world map camera on player (offset-grid position, as the renderer draws it)
    if (this.player) {
        const playerPos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
        this.camera.centerOn(playerPos.x, playerPos.y);
        this.camera.following = true;
    }

    // Restore normal turn display
    this.ui.updateStats(this.player, this.world);

    if (!opts.quiet) {
        this.ui.showNotification('🗺️ Returned to World Map', 'You returned to the world map.', 'info');
    }
}

/** Forget the inner map's hover, selected tile and selected object. */
export function _clearInnerMapSelection() {
    InnerMapRenderer._hoveredInnerHex = null;
    InnerMapRenderer._selectedInnerHex = null;
    InnerMapRenderer._selectedObject = null;
}

/**
 * An encounter in the wilds (player/wilds.js): the choice modal. Called when
 * the player steps onto one and from the Examine action. A resolved
 * encounter leaves the map; one left alone stays for later.
 */
export function _showEncounterNotification(encounter) {
    if (!encounter || !this.player) return;
    const def = Wilds.def(encounter.id || encounter.key);
    if (!def || !Array.isArray(def.choices) || !def.choices.length) {
        this.ui.showNotification(`${encounter.icon} ${encounter.name}`, encounter.description || '', 'info');
        return;
    }
    if (!encounter._met) {
        encounter._met = true;
        Wilds.noteMet(this.player);
    }
    InnerMap.cancelPlayerWalk();
    const worldTile = this.world ? this.world.getTile(encounter.wq, encounter.wr) : null;
    showWildsEncounter(this, {
        ctx: {
            id: encounter.id || encounter.key,
            wq: encounter.wq, wr: encounter.wr, slot: encounter.slot,
            terrain: worldTile && worldTile.terrain ? worldTile.terrain.id : null,
        },
        onResolved: () => {
            const t = InnerMap.getTile(encounter.iq, encounter.ir);
            if (t && t.encounter === encounter) t.encounter = null;
            InnerMap._cachedSummary = null;
        },
    });
}

/**
 * Check for low-need warnings and show notifications
 */
export function _checkNeedWarnings() {
    if (!this.player || !this.player.needsEnabled || !this.player.needs) return;
    const warnings = this.player._needWarnings || (this.player._needWarnings = {});

    const needNames = {
        hunger:  { icon: '🍖', label: 'Hungry' },
        energy:  { icon: '💤', label: 'Exhausted' },
        social:  { icon: '💬', label: 'Lonely' },
        fun:     { icon: '🎭', label: 'Bored' },
        hygiene: { icon: '🧼', label: 'Dirty' },
        comfort: { icon: '🪑', label: 'Uncomfortable' },
    };

    for (const [need, info] of Object.entries(needNames)) {
        const val = this.player.needs[need];
        if (val <= 15 && !warnings[`${need}_critical`]) {
            warnings[`${need}_critical`] = true;
            this.ui.showNotification(
                `${info.icon} ${info.label}!`,
                `Your ${need} is critically low! Find a way to satisfy this need soon.`,
                'error'
            );
        } else if (val <= 30 && val > 15 && !warnings[`${need}_low`]) {
            warnings[`${need}_low`] = true;
            this.ui.showNotification(
                `${info.icon} ${info.label}`,
                `Your ${need} is getting low. Consider addressing it.`,
                'info'
            );
        }
    }

    // Update mood display on portrait
    const mood = this.player.getMood();
    const portraitIcon = document.getElementById('simsPortrait');
    if (portraitIcon) {
        portraitIcon.title = `Mood: ${mood.label} (${mood.score})`;
    }
}

/**
 * Show the end-of-day modal when inner map time runs out
 */
export function _showInnerMapEndDayModal() {
    const overlay = document.createElement('div');
    overlay.id = 'innerMapEndDayOverlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 1300;
        background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);
        display: flex; justify-content: center; align-items: center;
    `;

    const worldTile = this.world ? this.world.getTile(this.player.q, this.player.r) : null;
    const settlementName = worldTile && worldTile.settlement ? worldTile.settlement.name : 'this area';
    const day = this.world ? this.world.day : 0;
    const season = this.world ? this.world.season : 'Spring';
    const year = this.world ? this.world.year : 853;

    const box = document.createElement('div');
    box.style.cssText = `
        background: rgba(16, 20, 28, 0.98);
        border: 1px solid rgba(245, 197, 66, 0.4);
        border-radius: 14px; padding: 28px 36px;
        max-width: 420px; text-align: center;
        box-shadow: 0 16px 64px rgba(0,0,0,0.9);
        font-family: var(--font-body);
    `;

    box.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 12px;">🌙</div>
        <div style="font-family: var(--font-display); font-size: 22px; color: var(--gold); margin-bottom: 6px;">
            Day's End
        </div>
        <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.6;">
            Night has fallen over ${settlementName}. The day draws to a close.
        </div>
        <div style="
            background: rgba(255,255,255,0.05);
            border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;
            text-align: left; font-size: 12px; color: rgba(255,255,255,0.7);
        ">
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>📅 Day</span><span style="color:#f5c542;">${day}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>🌿 Season</span><span style="color:#f5c542;">${season}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>📜 Year</span><span style="color:#f5c542;">${year}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>💰 Gold</span><span style="color:#f5c542;">${this.player.gold}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>❤️ Health</span><span style="color:#f5c542;">${this.player.health}/${this.player.maxHealth}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
                <span>🍞 Food</span><span style="color:#f5c542;">${this.player.getFoodCount ? this.player.getFoodCount() : '?'}</span>
            </div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: center;">
            <button id="innerEndDayRest" style="
                background: linear-gradient(135deg, #f5c542, #d4a843);
                color: #1a1a2e; border: none; padding: 10px 24px;
                border-radius: 6px; font-weight: 700; cursor: pointer;
                font-size: 13px; font-family: var(--font-body);
            ">🛏️ Rest & End Day</button>
            <button id="innerEndDayLeave" style="
                background: rgba(255,255,255,0.08);
                color: #e0e0e0; border: 1px solid rgba(255,255,255,0.15);
                padding: 10px 20px; border-radius: 6px;
                font-weight: 600; cursor: pointer;
                font-size: 13px; font-family: var(--font-body);
            ">🚶 Leave & End Day</button>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const restBtn = box.querySelector('#innerEndDayRest');
    const leaveBtn = box.querySelector('#innerEndDayLeave');

    restBtn.addEventListener('click', () => {
        overlay.remove();
        // Stay on inner map, advance game day, reset inner map time.
        // The choice here is the confirmation: without this, the "confirm end
        // day" setting pops a second dialog whose Cancel left the clock reset
        // but the day un-ended.
        if (!this.isProcessingTurn) this._endDayConfirmed = true;
        this.endDay();
        InnerMap.timeOfDay = 8;
        InnerMap._timeAccumulator = 0;
        InnerMap.dayEnded = false;
        this._innerMapDayEndShown = false;
        this.ui.showNotification('🌅 New Day', `A new day dawns. Time: ${InnerMap.getTimeString()}`, 'info');
    });

    leaveBtn.addEventListener('click', () => {
        overlay.remove();
        // End the day and exit to world map
        this.exitInnerMap();
        if (!this.isProcessingTurn) this._endDayConfirmed = true;
        this.endDay();
    });

    // Hover effects
    restBtn.addEventListener('mouseenter', () => restBtn.style.transform = 'scale(1.04)');
    restBtn.addEventListener('mouseleave', () => restBtn.style.transform = 'scale(1)');
    leaveBtn.addEventListener('mouseenter', () => leaveBtn.style.background = 'rgba(255,255,255,0.12)');
    leaveBtn.addEventListener('mouseleave', () => leaveBtn.style.background = 'rgba(255,255,255,0.08)');
}

/**
 * Show info about an inner map tile (delegates to ui.showInnerHexInfo)
 */
export function _showInnerTileInfo(tile, q, r) {
    if (!tile || !this.ui) return;
    this.ui.showInnerHexInfo(tile, q, r);
}

/**
 * Show the inner map exit button
 */
export function _showInnerMapExitButton() {
    // Remove existing button if any
    this._hideInnerMapExitButton();

    const btnStyle = `
        background: linear-gradient(135deg, rgba(16, 20, 28, 0.95), rgba(30, 35, 50, 0.95));
        border: 1px solid rgba(245, 197, 66, 0.4);
        color: #f5c542; padding: 10px 20px;
        border-radius: 8px; font-weight: 600; cursor: pointer;
        font-size: 13px; font-family: var(--font-body);
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        transition: all 0.2s ease;
    `;
    const hoverIn = (el) => { el.style.borderColor = 'rgba(245, 197, 66, 0.8)'; el.style.transform = 'scale(1.03)'; };
    const hoverOut = (el) => { el.style.borderColor = 'rgba(245, 197, 66, 0.4)'; el.style.transform = 'scale(1)'; };

    // Container for inner map toolbar
    const toolbar = document.createElement('div');
    toolbar.id = 'innerMapToolbar';
    // Sit left of #hudRightRail (12px gutter + 306px wide) so it never covers the cards
    toolbar.style.cssText = `position: fixed; top: 60px; right: 330px; z-index: 1100; display: flex; gap: 8px; align-items: center;`;

    // ── Export to Tiled button ──
    const exportBtn = document.createElement('button');
    exportBtn.id = 'innerMapExportBtn';
    exportBtn.innerHTML = '📥 Export .tmj';
    exportBtn.title = 'Download map as Tiled Editor JSON (.tmj)';
    exportBtn.style.cssText = btnStyle + 'padding: 8px 14px; font-size: 12px;';
    exportBtn.addEventListener('mouseenter', () => hoverIn(exportBtn));
    exportBtn.addEventListener('mouseleave', () => hoverOut(exportBtn));
    exportBtn.addEventListener('click', () => this._exportInnerMapTiled());
    toolbar.appendChild(exportBtn);

    // ── Import from Tiled button ──
    const importBtn = document.createElement('button');
    importBtn.id = 'innerMapImportBtn';
    importBtn.innerHTML = '📤 Import .tmj';
    importBtn.title = 'Import a Tiled Editor JSON map (.tmj/.json)';
    importBtn.style.cssText = btnStyle + 'padding: 8px 14px; font-size: 12px;';
    importBtn.addEventListener('mouseenter', () => hoverIn(importBtn));
    importBtn.addEventListener('mouseleave', () => hoverOut(importBtn));
    importBtn.addEventListener('click', () => this._importInnerMapTiled());
    toolbar.appendChild(importBtn);

    // ── Exit button ──
    const btn = document.createElement('button');
    btn.id = 'innerMapExitBtn';
    btn.innerHTML = '🔙 Return to World Map';
    btn.style.cssText = btnStyle;
    btn.addEventListener('mouseenter', () => hoverIn(btn));
    btn.addEventListener('mouseleave', () => hoverOut(btn));
    btn.addEventListener('click', () => this.exitInnerMap());
    toolbar.appendChild(btn);

    document.body.appendChild(toolbar);
}

/**
 * Configure the inner-map camera for the given context.
 * Called by innerMapUI.js when entering/exiting building interiors.
 * @param {'outer'|'interior'} mode
 */
export function _configureInnerMapCamera(mode) {
    // Entering or leaving an interior swaps the tile grid: the old hover,
    // selection and selected object point at tiles of the other map
    this._clearInnerMapSelection();
    if (!this.innerMapCamera) return;
    const tileSize = InnerMapRenderer.tileSize;
    const innerPixelHeight = tileSize * InnerMap.height;
    this.innerMapCamera.setWorldBounds(0, innerPixelHeight);

    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;

    if (mode === 'interior') {
        const innerPixelWidth = tileSize * InnerMap.width;
        const fitZoom = Math.min(canvasW / innerPixelWidth, canvasH / innerPixelHeight);
        const zoomLevel = (Number.isFinite(fitZoom) && fitZoom > 0) ? fitZoom * 0.9 : 1.5;
        this.innerMapCamera.minZoom = Math.max(0.5, zoomLevel * 0.6);
        this.innerMapCamera.maxZoom = Math.max(this.innerMapCamera.minZoom + 0.5, zoomLevel * 2.5);
        this.innerMapCamera.zoom = zoomLevel;
        this.innerMapCamera.targetZoom = zoomLevel;
    } else {
        // Outer inner-map (settlement / wilderness)
        const VISIBLE_TILES = 10;
        const zoomLevel = Math.min(canvasW, canvasH) / (VISIBLE_TILES * tileSize);
        const clampedZoom = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 2.0;
        this.innerMapCamera.minZoom = Math.max(0.5, clampedZoom * 0.5);
        this.innerMapCamera.maxZoom = clampedZoom * 2.0;
        this.innerMapCamera.zoom = clampedZoom;
        this.innerMapCamera.targetZoom = clampedZoom;
    }

    const pWorld = InnerMap.getPlayerWorldPos();
    this.innerMapCamera.centerOn(pWorld.x, pWorld.y);
    this.innerMapCamera.precomputeFrame();
}

/**
 * Hide the inner map exit button
 */
export function _hideInnerMapExitButton() {
    const toolbar = document.getElementById('innerMapToolbar');
    if (toolbar) toolbar.remove();
    const btn = document.getElementById('innerMapExitBtn');
    if (btn) btn.remove();
}

/**
 * Update the "Exit Building" button in the toolbar based on interior state
 */
export function _updateBuildingExitButton() {
    const toolbar = document.getElementById('innerMapToolbar');
    if (!toolbar) return;

    const existingBtn = document.getElementById('innerMapExitBuildingBtn');
    const insideBuilding = InnerMap._insideBuilding;

    if (insideBuilding && !existingBtn) {
        // Add "Exit Building" button
        const btnStyle = `
            background: rgba(16, 20, 28, 0.92);
            border: 1px solid rgba(245, 197, 66, 0.4);
            color: #f5c542;
            padding: 10px 18px;
            border-radius: 8px;
            font-size: 13px;
            font-family: var(--font-display, 'Inter', sans-serif);
            cursor: pointer;
            letter-spacing: 0.5px;
            transition: all 0.2s ease;
        `;
        const exitBldgBtn = document.createElement('button');
        exitBldgBtn.id = 'innerMapExitBuildingBtn';
        exitBldgBtn.innerHTML = `🚪 Exit ${insideBuilding.name}`;
        exitBldgBtn.style.cssText = btnStyle;
        exitBldgBtn.addEventListener('mouseenter', () => {
            exitBldgBtn.style.borderColor = 'rgba(245, 197, 66, 0.8)';
            exitBldgBtn.style.transform = 'scale(1.03)';
        });
        exitBldgBtn.addEventListener('mouseleave', () => {
            exitBldgBtn.style.borderColor = 'rgba(245, 197, 66, 0.4)';
            exitBldgBtn.style.transform = 'scale(1)';
        });
        exitBldgBtn.addEventListener('click', () => {
            InnerMapRenderer.closeContextMenu();
            InnerMap.exitBuilding(this);
            this._configureInnerMapCamera('outer');
            this.ui.showNotification('🚪 Exited Building', 'You step back outside.', 'info');
        });
        // Insert before the world map exit button
        const worldExitBtn = document.getElementById('innerMapExitBtn');
        if (worldExitBtn) {
            toolbar.insertBefore(exitBldgBtn, worldExitBtn);
        } else {
            toolbar.appendChild(exitBldgBtn);
        }
    } else if (!insideBuilding && existingBtn) {
        // Remove the button when no longer inside
        existingBtn.remove();
    }
}

/**
 * Export current inner map as Tiled JSON (.tmj) file
 */
export function _exportInnerMapTiled() {
    if (!InnerMap.active || !InnerMap.tiles) {
        this.ui.showNotification('Export Error', 'No inner map is active.', 'error');
        return;
    }

    try {
        const worldTile = InnerMap.currentWorldTile || { q: 0, r: 0 };
        const terrainId = InnerMap.tiles[0] && InnerMap.tiles[0][0]
            ? InnerMap.tiles[0][0].parentTerrain : 'grassland';

        TiledExport.downloadTiled(InnerMap.tiles, {
            season: InnerMap.season || 'Summer',
            parentTerrain: terrainId,
            worldQ: worldTile.q,
            worldR: worldTile.r
        });

        this.ui.showNotification('📥 Exported', 'Inner map downloaded as Tiled .tmj file.', 'success');
    } catch (e) {
        console.error('Tiled export error:', e);
        this.ui.showNotification('Export Error', e.message, 'error');
    }
}

/**
 * Import a Tiled JSON (.tmj) file and apply it to the current inner map
 */
export function _importInnerMapTiled() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tmj,.json';
    input.style.display = 'none';

    input.addEventListener('change', async () => {
        if (!input.files || input.files.length === 0) return;

        try {
            const imported = await TiledExport.importFromFile(input.files[0]);

            // Apply to current world tile position
            const worldTile = InnerMap.currentWorldTile || { q: 0, r: 0 };
            TiledExport.applyImport(imported, {
                worldQ: worldTile.q,
                worldR: worldTile.r
            });

            // Reload the inner map view
            InnerMap.tiles = imported.tiles;
            InnerMap.width = imported.width;
            InnerMap.height = imported.height;

            this.ui.showNotification('📤 Imported',
                `Tiled map loaded: ${imported.width}×${imported.height}, terrain: ${imported.parentTerrain}`, 'success');
        } catch (e) {
            console.error('Tiled import error:', e);
            this.ui.showNotification('Import Error', e.message, 'error');
        }

        input.remove();
    });

    document.body.appendChild(input);
    input.click();
}

/**
 * Hide world map UI elements when entering inner map
 */
export function _hideWorldMapUI() {
    // Hide hex info panel
    const hexPanel = document.getElementById('hexInfoPanel');
    if (hexPanel) hexPanel.classList.add('hidden');

    // Hide kingdom panel
    const kingdomPanel = document.getElementById('kingdomPanel');
    if (kingdomPanel) kingdomPanel.classList.add('hidden');

    // Close action menu if open
    if (typeof ActionMenu !== 'undefined') ActionMenu.close();
}

/**
 * Show world map UI elements when exiting inner map
 */
export function _showWorldMapUI() {
    // Minimap stays visible (it switches between world/inner map view automatically)
}

/**
 * Player arrived at destination
 */

