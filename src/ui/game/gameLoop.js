// ============================================
// GAME LOOP & INPUT � gameLoop, input handlers, handleClick, handleDoubleClick
// ============================================

import { Camera, Renderer, Player, World, SaveLoad, Terrain, Banking, MarketDynamics, Taxation, Characters, Minimap, UI, Quests, Achievements, Technology, Relationships, Ships, Titles, Councils, InnerMap, InnerMapRenderer, InnerMapCharacters, InnerMapCombat, LightSystem, ModStore, audioManager, DataLoader, Hex, Utils, PlayerActions, PlayerEconomy, PlayerMilitary, ActionMenu, Housing, Espionage, Gossip, Tavern, Economy, TiledExport, CustomObjects, CustomBuildings, Hotbar, NpcDialog } from './_gameImports.js';

export function gameLoop(timestamp) {
    if (!this.isRunning) return;

    const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    // -- Inner Map Mode --
    if (InnerMap.active) {
        try {
        this.innerMapCamera.update(deltaTime);
        this.innerMapCamera.precomputeFrame();

        // Apply time speed multiplier for inner map simulation
        // speed 0 = paused, 1 = normal, 2 = fast (2×), 3 = ultra (4×)
        const innerSpeed = Number.isFinite(this.timeSpeed) ? this.timeSpeed : 1;
        const simDelta = deltaTime * (innerSpeed === 3 ? 4 : innerSpeed);

        // Update inner map hover
        InnerMapRenderer._hoveredInnerHex = InnerMapRenderer.getInnerHexAtScreen(
            this.mouseX, this.mouseY, this.innerMapCamera);

        // Update time system (1 hour per real minute)
        const prevHour = InnerMap.timeOfDay;
        const timeResult = InnerMap.updateTime(simDelta);

        // ── Hourly needs decay ──
        if (InnerMap.timeOfDay > prevHour && this.player && this.player.needs) {
            const context = {
                insideBuilding: !!InnerMap._insideBuilding,
                isNight: InnerMap.timeOfDay >= 21 || InnerMap.timeOfDay < 6,
                isRaining: !!(InnerMap._weather && InnerMap._weather.type === 'rain'),
                inOwnHouse: false,
            };
            // Check if inside player's own house
            if (InnerMap._insideBuilding && this.player.houses) {
                context.inOwnHouse = this.player.houses.some(h =>
                    h.q === this.player.q && h.r === this.player.r);
            }
            // Decay once per hour that passed
            const hoursPassed = InnerMap.timeOfDay - prevHour;
            for (let i = 0; i < hoursPassed; i++) {
                this.player.decayNeedsPerHour(context);
            }
            // Check for low-need warnings
            this._checkNeedWarnings();
        }

        if (timeResult === 'day_ended' && !this._innerMapDayEndShown) {
            this._innerMapDayEndShown = true;
            this._showInnerMapEndDayModal();
        }

        // Update top bar with inner map time
        const turnEl = document.getElementById('turnDisplay');
        if (turnEl) {
            const timeStr = InnerMap.getTimeString();
            const period = InnerMap.getTimePeriod();
            const periodIcons = { morning: '🌅', midday: '☀️', afternoon: '🌤️', evening: '🌆', night: '🌙' };
            const periodIcon = periodIcons[period] || '🕐';
            const dayInSeason = ((this.world.day - 1) % 30) + 1;
            const insideBldg = InnerMap._insideBuilding;
            const locationSuffix = insideBldg ? ` — Inside ${insideBldg.name}` : '';
            turnEl.textContent = `${periodIcon} ${timeStr} — Day ${dayInSeason}, ${this.world.season}, Year ${this.world.year}${locationSuffix}`;
        }

        // Update toolbar: show/hide "Exit Building" button
        this._updateBuildingExitButton();

        // Update player walking animation
        const playerStepResult = InnerMap.updatePlayer(simDelta);
        if (playerStepResult) {
            if (playerStepResult.moved) {
                const arrivedTile = InnerMap.getTile(InnerMap.playerInnerQ, InnerMap.playerInnerR);
                if (arrivedTile) {
                    this.ui.showInnerHexInfo(arrivedTile, InnerMap.playerInnerQ, InnerMap.playerInnerR);
                }

                if (playerStepResult.encounter) {
                    this._showEncounterNotification(playerStepResult.encounter);
                }

                // ── Auto-enter building when stepping on a door tile ──
                // Only triggers on tiles with an explicit _doorMarker set by the building editor.
                if (arrivedTile && !InnerMap._insideBuilding && arrivedTile._doorMarker) {
                    const autoEnterBuilding = InnerMap.getBuildingAt(arrivedTile._doorMarker.anchorQ, arrivedTile._doorMarker.anchorR);
                    if (autoEnterBuilding && typeof InnerMap.enterBuilding === 'function') {
                        InnerMap.cancelPlayerWalk();
                        InnerMap._pendingInteraction = null;
                        InnerMap._pendingCombat = null;
                        InnerMap._pendingDialog = null;
                        const success = InnerMap.enterBuilding(autoEnterBuilding, this);
                        if (success) {
                            if (typeof this._configureInnerMapCamera === 'function') {
                                this._configureInnerMapCamera('interior');
                            } else if (this.innerMapCamera) {
                                const tileSize = InnerMapRenderer.tileSize;
                                const innerPixelWidth = tileSize * InnerMap.width;
                                const innerPixelHeight = tileSize * InnerMap.height;
                                this.innerMapCamera.setWorldBounds(0, innerPixelHeight);
                                const canvasW = this.canvas.width;
                                const canvasH = this.canvas.height;
                                const fitZoom = Math.min(canvasW / innerPixelWidth, canvasH / innerPixelHeight);
                                const zoomLevel = (Number.isFinite(fitZoom) && fitZoom > 0) ? fitZoom * 0.9 : 1.5;
                                this.innerMapCamera.minZoom = Math.max(0.5, zoomLevel * 0.6);
                                this.innerMapCamera.maxZoom = Math.max(this.innerMapCamera.minZoom + 0.5, zoomLevel * 2.5);
                                this.innerMapCamera.zoom = zoomLevel;
                                this.innerMapCamera.targetZoom = zoomLevel;
                                const pWorld = InnerMap.getPlayerWorldPos();
                                this.innerMapCamera.centerOn(pWorld.x, pWorld.y);
                                this.innerMapCamera.precomputeFrame();
                            }
                            this.ui.showNotification(`🚪 Entered ${autoEnterBuilding.name}`, `You step inside ${autoEnterBuilding.name}. Press ESC or click "Exit" to leave.`, 'info');
                        }
                    }
                }

                // ── Trigger pending object interaction on arrival ──
                if (playerStepResult.arrived && InnerMap._pendingInteraction) {
                    const pi = InnerMap._pendingInteraction;
                    const piDef = typeof CustomObjects !== 'undefined' ? CustomObjects.getDef(pi.defId) : null;
                    InnerMap.startInteraction(pi.anchorQ, pi.anchorR, pi.defId,
                        InnerMap._computeObjectDamage(this.player, piDef));
                    // Face the object
                    const dir = InnerMap.getDirectionToward(pi.anchorQ, pi.anchorR);
                    InnerMapRenderer._playerFacing = dir;
                }
                // ── Trigger pending NPC combat on arrival ──
                if (playerStepResult.arrived && InnerMap._pendingCombat) {
                    const pc = InnerMap._pendingCombat;
                    InnerMap._pendingCombat = null;
                    if (pc.type === 'npc' && typeof InnerMapCombat !== 'undefined') {
                        const targetNpc = InnerMap.npcs && InnerMap.npcs.find(n => n.id === pc.npc.id);
                        if (targetNpc) InnerMapCombat._beginNPCAttack(pc.game || this, targetNpc);
                    }
                }
                // ── Trigger pending NPC dialog on arrival ──
                if (playerStepResult.arrived && InnerMap._pendingDialog) {
                    const pd = InnerMap._pendingDialog;
                    InnerMap._pendingDialog = null;
                    if (pd.npc) {
                        // Face the NPC
                        const dir = InnerMap.getDirectionToward(pd.npc.q, pd.npc.r);
                        InnerMapRenderer._playerFacing = dir;
                        NpcDialog.open(pd.game || this, pd.npc);
                    }
                }
            } else if (playerStepResult.blocked) {
                InnerMap._pendingInteraction = null;
                InnerMap._pendingCombat = null;
                // Unfreeze NPC if dialog walk was blocked
                if (InnerMap._pendingDialog) {
                    const pd = InnerMap._pendingDialog;
                    InnerMap._pendingDialog = null;
                    if (pd.npc) {
                        pd.npc._dialogFrozen = false;
                        if (pd.npc.state === 'dialog') {
                            pd.npc.state = 'idle';
                            pd.npc.idleTimer = 1;
                        }
                    }
                }
                this.ui.showNotification('Blocked', 'Path blocked — impassable terrain!', 'error');
            }
        }

        // ── Update active object interaction ──
        const interactionResult = InnerMap.updateInteraction(simDelta);
        if (interactionResult && interactionResult.hit && typeof InnerMapCombat !== 'undefined') {
            // Spawn floating damage number over object on each swing
            const ia = InnerMap._activeInteraction;
            if (ia) InnerMapCombat.onObjectHit(ia.anchorQ, ia.anchorR, interactionResult.damage, interactionResult.healthPct);
        }
        if (interactionResult && interactionResult.completed) {
            if (interactionResult.nonDestructive) {
                // Non-destructive interaction (sitting, emoting) — no resource, no removal
            } else if (interactionResult.resource) {
                const resType = interactionResult.resource.type;
                const resAmt = interactionResult.resource.amount || 1;
                if (resType === 'gold') {
                    this.player.gold += resAmt;
                } else {
                    if (!this.player.inventory) this.player.inventory = {};
                    this.player.inventory[resType] = (this.player.inventory[resType] || 0) + resAmt;
                }
                // Format resource name for display
                const displayName = resType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                this.ui.showNotification('Gathered', `+${resAmt} ${displayName}`, 'success');
            } else {
                this.ui.showNotification('Cleared', 'Object removed.', 'info');
            }
            // Clear selection if it was this object
            if (InnerMapRenderer._selectedObject &&
                InnerMapRenderer._selectedObject.anchorQ === interactionResult.anchorQ &&
                InnerMapRenderer._selectedObject.anchorR === interactionResult.anchorR) {
                InnerMapRenderer._selectedObject = null;
            }
        }

        // Always follow player with camera (camera is locked to player)
        const pWorld = InnerMap.getPlayerWorldPos();
        this.innerMapCamera.follow(pWorld.x, pWorld.y);

        // Update NPCs
        InnerMap.updateNPCs(simDelta);

        // ── Update combat system (NPC attacks, float numbers, hit flashes) ──
        if (typeof InnerMapCombat !== 'undefined') {
            InnerMapCombat.update(simDelta, this);
        }

        // Update light system from time of day
        if (typeof LightSystem !== 'undefined') {
            LightSystem.updateFromTime();
            LightSystem.collectLights(this.innerMapCamera);
        }

        // Render inner map
        InnerMapRenderer.render(this.renderer.ctx, this.canvas, this.innerMapCamera, deltaTime);

        // Render minimap for inner map
        this.minimap.render();

        } catch (innerErr) {
            console.error('CRASH in inner map branch of gameLoop:', innerErr);
        }
        requestAnimationFrame((t) => this.gameLoop(t));
        return;
    }

    // While inner map is loading, skip world-map updates/rendering.
    if (this._enteringInnerMap) {
        requestAnimationFrame((t) => this.gameLoop(t));
        return;
    }

    // Update camera (locked to player position)
    this.camera.update(deltaTime);
    this.camera.precomputeFrame();

    // Always follow the player on the world map
    {
        const pos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
        this.camera.follow(pos.x, pos.y);
    }

    // Update weather
    if (this.world && this.world.weather) {
        this.world.weather.update(deltaTime);
    }

    // Advance inner-map hour clock on the world map so time visibly progresses.
    // DISABLED: Inner map feature disabled
    // const speed = Number.isFinite(this.timeSpeed) ? this.timeSpeed : 1;
    // if (speed <= 0) {
    //     // paused — do nothing
    // } else if (!this.isProcessingTurn && this.player) {
    //     const simDelta = deltaTime * (speed === 3 ? 4 : speed);
    //     InnerMap._timeAccumulator += simDelta;
    //     if (InnerMap._timeAccumulator >= InnerMap.TIME_SCALE) {
    //         InnerMap._timeAccumulator -= InnerMap.TIME_SCALE;
    //         InnerMap.timeOfDay++;
    //     }
    //     // Update time cache for the player's current tile so the HUD reflects it
    //     const tileKey = `${this.player.q},${this.player.r}`;
    //     InnerMap._timeCache[tileKey] = {
    //         timeOfDay: InnerMap.timeOfDay,
    //         _timeAccumulator: InnerMap._timeAccumulator,
    //         dayEnded: InnerMap.dayEnded,
    //     };
    //     // When the clock hits 24, end the day and reset to 8 AM
    //     if (InnerMap.timeOfDay >= 24) {
    //         InnerMap.timeOfDay = 8;
    //         InnerMap._timeAccumulator = 0;
    //         InnerMap.dayEnded = false;
    //         this.endDay();
    //     }
    // }

    // Update player movement
    if (this.player.isMoving) {
        const moved = this.player.stepAlongPath(this.world, deltaTime);
        if (moved) {
            this.ui.updateStats(this.player, this.world);
            this.minimap.invalidate();

            // Check if arrived at destination
            if (!this.player.isMoving) {
                if (this.player.queuedPath) {
                    // Ran out of stamina mid-journey — auto-end day to continue
                    const dest = this.player.travelDestination;
                    const remaining = this.player.queuedPath.length - this.player.queuedPathIndex;
                    this.ui.showNotification('Resting for the Night',
                        `~${remaining} tiles remaining to destination. Press Escape to cancel.`, 'info');
                    this.endDay();
                } else {
                    this.onPlayerArrived();
                }
            }

            // Camera follows player while moving
            const pos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
            this.camera.follow(pos.x, pos.y);
        }
    }

    // Update hover hex
    this.updateHoveredHex();

    // Update stats display periodically (every ~0.5s) so clock is visible
    this._worldStatsTimer = (this._worldStatsTimer || 0) + deltaTime;
    if (this._worldStatsTimer >= 0.5) {
        this._worldStatsTimer = 0;
        this.ui.updateStats(this.player, this.world);
    }

    // Render
    this.renderer.render(deltaTime);

    // Render minimap (less frequently)
    this.minimap.render();

    requestAnimationFrame((t) => this.gameLoop(t));
}

/**
 * Set up mouse/click handlers
 */
export function _clientToCanvas(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const safeW = rect.width || 1;
    const safeH = rect.height || 1;
    const scaleX = this.canvas.width / safeW;
    const scaleY = this.canvas.height / safeH;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
    };
}

export function setupInputHandlers() {
    this.canvas.addEventListener('mousemove', (e) => {
        const p = this._clientToCanvas(e.clientX, e.clientY);
        this.mouseX = p.x;
        this.mouseY = p.y;
    });

    this.canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0 || e.button === 2) {
            this.mouseDown = true;
            this.mouseDownButton = e.button;
            this.mouseDownTime = Date.now();
            this.mouseDownX = e.clientX;
            this.mouseDownY = e.clientY;
        }
    });

    // Mouse up
    this.canvas.addEventListener('mouseup', (e) => {
        if (this.mouseDown && e.button === this.mouseDownButton) {
            const dist = Math.hypot(e.clientX - this.mouseDownX, e.clientY - this.mouseDownY);
            const timeDiff = Date.now() - this.mouseDownTime;
            if (dist < 5 && timeDiff < 500) {
                const p = this._clientToCanvas(e.clientX, e.clientY);
                // Left click = show info, Right click = move
                if (e.button === 0) {
                    this.handleClick(p.x, p.y, 'left');
                } else if (e.button === 2) {
                    this.handleClick(p.x, p.y, 'right');
                }
            }
            this.mouseDown = false;
        }
    });

    // Prevent context menu on right-click
    this.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });

    // Double-click for quick info
    this.canvas.addEventListener('dblclick', (e) => {
        const p = this._clientToCanvas(e.clientX, e.clientY);
        this.handleDoubleClick(p.x, p.y);
    });

    // Keyboard shortcut: M to cycle map modes
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.key === 'm' || e.key === 'M') {
            const modes = ['normal', 'political', 'religion', 'wealth', 'military', 'trade', 'culture'];
            const current = this.renderer.mapMode;
            const idx = modes.indexOf(current);
            const next = modes[(idx + 1) % modes.length];
            this.ui.setMapMode(next);
        }
        if (e.key === 'Escape') {
            // Exit inner map mode
            if (InnerMap.active) {
                // If inside a building, exit the building first
                if (InnerMap._insideBuilding) {
                    InnerMapRenderer.closeContextMenu();
                    InnerMap.exitBuilding(this);
                    // Re-setup the camera for the outer inner map
                    const tileSize = InnerMapRenderer.tileSize;
                    const innerPixelWidth = tileSize * InnerMap.width;
                    const innerPixelHeight = tileSize * InnerMap.height;
                    if (this.innerMapCamera) {
                        this.innerMapCamera.setWorldBounds(0, innerPixelHeight);
                        const canvasW = this.canvas.width;
                        const canvasH = this.canvas.height;
                        const VISIBLE_TILES = 10;
                        const zoomLevel = Math.min(canvasW, canvasH) / (VISIBLE_TILES * tileSize);
                        const clampedZoom = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 2.0;
                        this.innerMapCamera.minZoom = Math.max(0.5, clampedZoom * 0.5);
                        this.innerMapCamera.maxZoom = clampedZoom * 2.0;
                        this.innerMapCamera.zoom = clampedZoom;
                        this.innerMapCamera.targetZoom = clampedZoom;
                        // Center on player position (camera locked to player)
                        const pWorld = InnerMap.getPlayerWorldPos();
                        this.innerMapCamera.centerOn(pWorld.x, pWorld.y);
                        this.innerMapCamera.precomputeFrame();
                    }
                    this.ui.showNotification('🚪 Exited Building', 'You step back outside.', 'info');
                    return;
                }
                this.exitInnerMap();
                return;
            }
            if (this.player && (this.player.queuedPath || this.player.isMoving)) {
                this.player.cancelTravel();
                this.renderer.reachableHexes = this.player.getReachableHexes(this.world);
                this.ui.showNotification('Travel Cancelled', 'You stopped your journey.', 'default');
            }
        }
        // R key: rotate selected custom object (cycle rotation variants)
        if ((e.key === 'r' || e.key === 'R') && InnerMap.active) {
            const sel = InnerMapRenderer._selectedObject;
            if (sel && typeof CustomObjects !== 'undefined') {
                const def = CustomObjects.getDef(sel.defId);
                if (def && def.rotationVariants && def.rotationVariants.length > 0) {
                    const tile = InnerMap.getTile(sel.anchorQ, sel.anchorR);
                    if (tile && tile.customObject) {
                        const total = def.rotationVariants.length + 1; // +1 for default
                        tile.customObject.rotationIdx = ((tile.customObject.rotationIdx || 0) + 1) % total;
                    }
                }
            }
        }
        // T key: cycle color variants on selected custom object
        if ((e.key === 't' || e.key === 'T') && InnerMap.active) {
            const sel = InnerMapRenderer._selectedObject;
            if (sel && typeof CustomObjects !== 'undefined') {
                const def = CustomObjects.getDef(sel.defId);
                if (def && def.colorVariants && def.colorVariants.length > 0) {
                    const tile = InnerMap.getTile(sel.anchorQ, sel.anchorR);
                    if (tile && tile.customObject) {
                        const total = def.colorVariants.length + 1; // +1 for default
                        tile.customObject.colorVariantIdx = ((tile.customObject.colorVariantIdx || 0) + 1) % total;
                    }
                }
            }
        }
    });
}

/**
 * Update the hovered hex based on mouse position
 */
export function updateHoveredHex() {
    if (!this.world) return;
    const hex = this.renderer.getHexAtScreen(this.mouseX, this.mouseY);
    this.renderer.hoveredHex = hex;
}

/**
 * Handle click on the map
 */
export function handleClick(screenX, screenY, button = 'left') {
    if (!this.world || !this.player) return;

    // Block clicks while inner map is loading
    if (this._enteringInnerMap) return;

    // Block clicks while NPC dialog is open
    if (NpcDialog.active) return;

    // -- Inner Map Mode clicks --
    if (InnerMap.active) {
        const innerHex = InnerMapRenderer.getInnerHexAtScreen(screenX, screenY, this.innerMapCamera);
        if (!innerHex) return;

        if (button === 'left') {
            // ── Hotbar placement on left-click ──
            if (Hotbar.activeItemId) {
                Hotbar.useActiveItem(innerHex.q, innerHex.r);
                return;
            }

            InnerMapRenderer._selectedInnerHex = innerHex;
            InnerMapRenderer.closeContextMenu();
            const innerTile = InnerMap.getTile(innerHex.q, innerHex.r);
            const isPlayerTile = (innerHex.q === InnerMap.playerInnerQ && innerHex.r === InnerMap.playerInnerR);

            // ── Resolve custom object selection (anchor or footprint part) ──
            let objAnchor = null;
            if (innerTile) {
                if (innerTile.customObject) {
                    objAnchor = { anchorQ: innerHex.q, anchorR: innerHex.r, defId: innerTile.customObject.defId };
                } else if (innerTile.customObjectPart) {
                    const p = innerTile.customObjectPart;
                    const anchorTile = InnerMap.getTile(p.anchorQ, p.anchorR);
                    if (anchorTile && anchorTile.customObject) {
                        objAnchor = { anchorQ: p.anchorQ, anchorR: p.anchorR, defId: anchorTile.customObject.defId };
                    }
                }
            }
            InnerMapRenderer._selectedObject = objAnchor;

            // Always show context menu on left-click (terrain, objects, buildings)
            if (innerTile) {
                InnerMapRenderer.showContextMenu(this, innerHex.q, innerHex.r, screenX, screenY);
            }
        } else if (button === 'right') {
            // Right click = walk player to target tile (or interact with object)
            InnerMapRenderer.closeContextMenu();
            InnerMapRenderer._selectedObject = null;

            // Cancel any current walk / interaction
            InnerMap.cancelPlayerWalk();
            InnerMap._pendingInteraction = null;
            InnerMap._activeInteraction = null;

            // Unfreeze NPC if we were walking to talk
            if (InnerMap._pendingDialog) {
                const pd = InnerMap._pendingDialog;
                InnerMap._pendingDialog = null;
                if (pd.npc) {
                    pd.npc._dialogFrozen = false;
                    if (pd.npc.state === 'dialog') {
                        pd.npc.state = 'idle';
                        pd.npc.idleTimer = 1;
                    }
                }
            }

            // Check if the clicked tile has a custom object with a resource
            // AND the clicked tile is an interaction point on that object
            let objAnchorQ = null, objAnchorR = null, objDef = null;
            let clickedLocalCol = 0, clickedLocalRow = 0;
            const innerTile = InnerMap.getTile(innerHex.q, innerHex.r);
            if (innerTile) {
                if (innerTile.customObject) {
                    objAnchorQ = innerHex.q;
                    objAnchorR = innerHex.r;
                    clickedLocalCol = 0;
                    clickedLocalRow = 0;
                } else if (innerTile.customObjectPart) {
                    objAnchorQ = innerTile.customObjectPart.anchorQ;
                    objAnchorR = innerTile.customObjectPart.anchorR;
                    clickedLocalCol = innerHex.q - objAnchorQ;
                    clickedLocalRow = innerHex.r - objAnchorR;
                }
                if (objAnchorQ != null) {
                    const at = InnerMap.getTile(objAnchorQ, objAnchorR);
                    if (at && at.customObject && typeof CustomObjects !== 'undefined') {
                        objDef = CustomObjects.getDef(at.customObject.defId);
                    }
                }
            }

            // Only allow interaction if the clicked tile is an interactionPoint
            let clickedInteractTile = false;
            if (objDef && objDef.meta) {
                for (const m of objDef.meta) {
                    if (m.interactionPoint &&
                        m.localCol === clickedLocalCol &&
                        m.localRow === clickedLocalRow) {
                        clickedInteractTile = true;
                        break;
                    }
                }
            }

            if (objDef && objDef.resource && clickedInteractTile) {
                // ── Object interaction: walk to adjacent tile, then interact ──
                const adj = InnerMap.findAdjacentToObject(objAnchorQ, objAnchorR, objDef);
                if (adj) {
                    // If player is already at the adjacent tile, start immediately
                    if (InnerMap.playerInnerQ === adj.q && InnerMap.playerInnerR === adj.r) {
                        InnerMap.startInteraction(objAnchorQ, objAnchorR, objDef.id,
                            InnerMap._computeObjectDamage(this.player, objDef));
                        // Face the object
                        const dir = InnerMap.getDirectionToward(objAnchorQ, objAnchorR);
                        InnerMapRenderer._playerFacing = dir;
                    } else {
                        InnerMap._pendingInteraction = { anchorQ: objAnchorQ, anchorR: objAnchorR, defId: objDef.id };
                        const walkResult = InnerMap.movePlayerTo(adj.q, adj.r);
                        if (!walkResult.started) {
                            InnerMap._pendingInteraction = null;
                            this.ui.showNotification('Blocked', 'Cannot reach that object!', 'error');
                        }
                    }
                } else {
                    this.ui.showNotification('Blocked', 'Cannot reach that object!', 'error');
                }
            } else {
                // Normal walk
                const result = InnerMap.movePlayerTo(innerHex.q, innerHex.r);
                if (!result.started && !result.outOfBounds) {
                    this.ui.showNotification('Blocked', 'Cannot move there — impassable terrain!', 'error');
                }
            }
        }
        return;
    }

    const hex = this.renderer.getHexAtScreen(screenX, screenY);
    if (!hex) return;

    const tile = this.world.getTile(hex.q, hex.r);
    if (!tile) return;

    // Left click on current tile = show info/action menu
    if (button === 'left') {
        if (!(this.player.q === hex.q && this.player.r === hex.r)) {
            // For movement consistency with the manual, regular click moves.
            // Detailed tile info is still available via double-click.
            button = 'right';
        } else {
            this.renderer.selectedHex = hex;
            this.ui.showHexInfo(tile, hex.q, hex.r);

            // If clicking on self, open action menu
            if (this.player.q === hex.q && this.player.r === hex.r) {
                ActionMenu.show(this, tile);
            }
            return;
        }
    }

    // Right click (and non-self left click) = move
    if (button === 'right') {
        // Check if tile is accessible based on player's current state
        let isAccessible = false;
        if (this.player.boardedShip) {
            const waterTiles = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'];
            // Allow water tiles
            if (waterTiles.includes(tile.terrain.id)) {
                isAccessible = true;
            }
            // Allow current position
            else if (hex.q === this.player.q && hex.r === this.player.r) {
                isAccessible = true;
            }
            // Allow coastal settlements (for docking)
            else if (tile.settlement) {
                const neighbors = Hex.neighbors(hex.q, hex.r);
                for (const n of neighbors) {
                    const nq = Hex.wrapQ(n.q, this.world.width);
                    if (n.r < 0 || n.r >= this.world.height) continue;
                    const nTile = this.world.getTile(nq, n.r);
                    if (nTile && waterTiles.includes(nTile.terrain.id)) {
                        isAccessible = true;
                        break;
                    }
                }
            }
        } else {
            isAccessible = tile.terrain.passable;
        }

        // If clicking on an accessible, explored tile — try to move there
        if (isAccessible) {
            // Don't move if clicking current position
            if (hex.q === this.player.q && hex.r === this.player.r) {
                return;
            }

            const success = this.player.moveTo(hex.q, hex.r, this.world);
            if (success) {
                // Check if low on food and at a settlement — offer auto-purchase
                const pathLen = this.player.path ? this.player.path.length - 1 : 0;
                const foodCount = this.player.getFoodCount();
                const currentTile = this.world.getTile(this.player.q, this.player.r);
                const atSettlement = currentTile && currentTile.settlement;

                if (foodCount < pathLen && atSettlement) {
                    // At a settlement with insufficient food — show buy modal
                    this._showFoodPurchaseModal(pathLen, foodCount, currentTile, hex);
                } else if (foodCount < pathLen) {
                    // Not at a settlement — just warn
                    const deficit = pathLen - foodCount;
                    if (foodCount === 0) {
                        this.ui.showNotification('⚠️ No Food!',
                            `You have no food! You will lose health traveling ${pathLen} tiles. Buy food at a settlement.`, 'error');
                    } else {
                        this.ui.showNotification('⚠️ Low Food',
                            `You have ${foodCount} food for a ${pathLen}-tile journey. You\'ll starve for the last ${deficit} tiles.`, 'error');
                    }
                }
                this.renderer.selectedHex = null;
                // Update reachable hexes
                this.renderer.reachableHexes = null;
            } else {
                this.ui.showNotification('No Path', 'Cannot reach that location!', 'error');
            }
        } else {
            this.ui.showNotification('Cannot Move', 'That tile is not accessible!', 'error');
        }
    }
}

/**
 * Handle double-click — show detailed info or enter inner map
 */
export function handleDoubleClick(screenX, screenY) {
    if (!this.world) return;

    // Block clicks while inner map is loading
    if (this._enteringInnerMap) return;

    // Double-click in inner map shows detailed tile info
    if (InnerMap.active) {
        const innerHex = InnerMapRenderer.getInnerHexAtScreen(screenX, screenY, this.innerMapCamera);
        if (!innerHex) return;
        InnerMapRenderer._selectedInnerHex = innerHex;
        const innerTile = InnerMap.getTile(innerHex.q, innerHex.r);
        if (innerTile) {
            this.ui.showInnerHexInfo(innerTile, innerHex.q, innerHex.r);
        }
        return;
    }

    const hex = this.renderer.getHexAtScreen(screenX, screenY);
    if (!hex) return;

    const tile = this.world.getTile(hex.q, hex.r);
    if (!tile || !tile.explored) return;

    this.renderer.selectedHex = hex;
    this.ui.showHexInfo(tile, hex.q, hex.r);

    // If tile belongs to a kingdom, also show kingdom panel
    if (tile.kingdom) {
        const kingdom = this.world.getKingdom(tile.kingdom);
        if (kingdom) {
            this.ui.showKingdomInfo(kingdom);
        }
    }
}

// ═══════════════════════════════════════
// INNER MAP — Explore the interior of a world tile
// ═══════════════════════════════════════

/**
 * Enter the inner map for a given world tile
 */

