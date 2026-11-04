// ============================================
// GAME LOOP & INPUT � gameLoop, input handlers, handleClick, handleDoubleClick
// ============================================

import { Camera, Renderer, Player, World, SaveLoad, Terrain, Banking, MarketDynamics, Taxation, Characters, Minimap, UI, Quests, Achievements, Technology, Relationships, Ships, Titles, Councils, InnerMap, InnerMapRenderer, InnerMapCharacters, InnerMapCombat, LightSystem, ModStore, audioManager, DataLoader, Hex, Utils, PlayerActions, PlayerEconomy, PlayerMilitary, ActionMenu, Housing, Espionage, Gossip, Tavern, Economy, TiledExport, CustomObjects, CustomBuildings, Hotbar, NpcDialog, PlayerInventory } from './_gameImports.js';
import { Afterlife } from '../../player/afterlife.js';
import { InnerMapTasks } from '../innerMapTasks.js';
import { InnerMapDigging } from '../innerMapDigging.js';
import { InnerMapJail } from '../innerMapJail.js';
import { InnerMapZones } from '../innerMapZones.js';
import { InnerMapDeck } from '../innerMapDeck.js';
import { InnerMapAnimals } from '../innerMapAnimals.js';
import { Swimming } from '../../player/swimming.js';

export function gameLoop(timestamp, loopId) {
    if (!this.isRunning) return;
    // One rAF chain per game: a fresh start (called without an id — new game,
    // resume, HMR recovery) supersedes any chain still pending, so re-entering
    // never leaves two loops ticking the simulation at double speed.
    if (loopId === undefined) loopId = this._loopId = (this._loopId || 0) + 1;
    else if (loopId !== this._loopId) return;

    const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    // -- Inner Map Mode --
    if (InnerMap.active) {
        // The world camera shares the canvas; keep it from panning in here
        this.camera.locked = true;
        try {
        this.innerMapCamera.update(deltaTime);
        this.innerMapCamera.precomputeFrame();

        // Apply time speed multiplier for inner map simulation
        // speed 0 = paused, 1 = normal, 2 = fast (2×), 3 = ultra (4×)
        const innerSpeed = Number.isFinite(this.timeSpeed) ? this.timeSpeed : 1;
        const simDelta = deltaTime * (innerSpeed === 3 ? 4 : innerSpeed);

        // Update inner map hover
        const hasMouse = this.mouseX !== null && this.mouseY !== null;
        InnerMapRenderer._hoveredInnerHex = hasMouse
            ? InnerMapRenderer.getInnerHexAtScreen(this.mouseX, this.mouseY, this.innerMapCamera)
            : null;
        InnerMapRenderer._mouseX = this.mouseX;
        InnerMapRenderer._mouseY = this.mouseY;

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

        // Midnight: the turn ends by itself and the clock runs on from 12:01 AM
        // (endDay sees the rollover and doesn't wake you at 8 — ui/game/endDay.js)
        if (timeResult === 'day_ended' && !this._innerMapDayEndShown && !this.isProcessingTurn) {
            this._innerMapDayEndShown = true;
            this._midnightRollover = true;
            this._endDayConfirmed = true;
            this.endDay();
            if (!this.isProcessingTurn) {
                // (the day couldn't end — dead, or between lives: leave the clock at midnight)
                this._midnightRollover = false;
                this._endDayConfirmed = false;
            }
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

        // May the player take to the water (player/swimming.js; world/innerMap/swimming.js)?
        const swimOk = Swimming.canSwim(this.player);
        InnerMap._swimAllowed = swimOk.ok || InnerMap.isPlayerSwimming(); // (already in: always on to the shore)
        InnerMap._swimRefusal = swimOk.ok ? null : swimOk.reason;
        InnerMap._swimSpeedBonus = Swimming.speedBonus(this.player);

        // Update player walking animation
        const preQ = InnerMap.playerInnerQ, preR = InnerMap.playerInnerR;
        const playerStepResult = InnerMap.updatePlayer(simDelta);
        // A stroke through the water: tiredness, the cold, a wash, going under
        if (InnerMap.playerInnerQ !== preQ || InnerMap.playerInnerR !== preR) {
            _swimStep(this);
        }
        // Wilderness encounters come into sight a few paces off (player/wilds.js)
        if (InnerMap._playerWalking || playerStepResult) {
            for (const e of InnerMap.spotWildEncounters(6)) {
                this.ui.showNotification(`${e.icon} ${e.name}`, `${e.description} (walk to it, or select it and Examine)`, 'info');
            }
        }
        if (playerStepResult) {
            if (playerStepResult.moved) {
                // (No tile panel on every step: it only cluttered the street view)
                const arrivedTile = InnerMap.getTile(InnerMap.playerInnerQ, InnerMap.playerInnerR);

                if (playerStepResult.encounter) {
                    this._showEncounterNotification(playerStepResult.encounter);
                } else if (arrivedTile && arrivedTile.encounter && arrivedTile.encounter.slot != null) {
                    // Walking onto an encounter already spotted from afar
                    this._showEncounterNotification(arrivedTile.encounter);
                }

                // ── Auto-enter building when stepping on a door tile ──
                // Only triggers on tiles with an explicit _doorMarker set by the building editor.
                if (arrivedTile && !InnerMap._insideBuilding && arrivedTile._doorMarker) {
                    const autoEnterBuilding = InnerMap.getBuildingAt(arrivedTile._doorMarker.anchorQ, arrivedTile._doorMarker.anchorR);
                    if (autoEnterBuilding && typeof InnerMap.enterBuilding === 'function') {
                        InnerMap.cancelPlayerWalk();
                        InnerMap._pendingInteraction = null;
                        InnerMap._pendingAction = null;
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
                        } else if (InnerMap._entryRefused) {
                            // Turned away at a lord's door (world/innerMap/seats.js): back off the step
                            const no = InnerMap._entryRefused;
                            InnerMap._entryRefused = null;
                            const back = InnerMap._findPassableAdjacentTile(autoEnterBuilding.q, autoEnterBuilding.r);
                            if (back) { InnerMap.playerInnerQ = back.q; InnerMap.playerInnerR = back.r; }
                            const who = no.by ? `${no.by.name}, ${no.by.roleTitle || 'Guard'}` : autoEnterBuilding.name;
                            this.ui.showNotification(no.by ? `💂 ${who}` : '🚪 Barred', no.by ? `"${no.text}"` : no.text, 'warning');
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
                // ── Use the furniture / object the player walked over to ──
                if (playerStepResult.arrived && InnerMap._pendingAction) {
                    InnerMap.runPendingAction();
                } else if (playerStepResult.arrived && !InnerMap._pendingInteraction && !InnerMap._pendingCombat) {
                    // ── Walked (or swam) to the map's edge: on into the next hex's map ──
                    _crossEdge(this);
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
                InnerMap._pendingAction = null;
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
            } else if (interactionResult.wreck) {
                // A ship struck down: she breaks up, her salvage floats free (world/innerMap/harbour.js);
                // your own ship leaves your fleet, her hold in the crates (systems/ships.js wreckShip)
                const w = interactionResult.wreck;
                let cargo = null;
                let lost = null;
                if (w.object && w.object.playerShip) {
                    const res = Ships.wreckShip(this.player, w.object.playerShip);
                    if (res.success) { cargo = res.cargo; lost = res.ship; }
                }
                const pieces = InnerMap.scatterWreck(w, { cargo });
                const name = lost ? `the ${lost.name}` : (w.object && w.object.label) || 'the ship';
                this.ui.showNotification(lost ? '⚓ Your Ship Is Lost' : '🪵 Wrecked',
                    `${name.charAt(0).toUpperCase()}${name.slice(1)} breaks up.${pieces.length ? ` ${pieces.length} pieces of wreckage float free — swim out and haul them in.` : ''}`,
                    lost ? 'warning' : 'info');
                if (lost) this.ui.updateStats(this.player, this.world);
            } else if (interactionResult.resource) {
                const resType = interactionResult.resource.type;
                const resAmt = interactionResult.resource.amount || 1;
                let gathered = true;
                if (resType === 'gold') {
                    this.player.gold += resAmt;
                } else {
                    gathered = PlayerInventory.addItem(this.player, resType, resAmt).success;
                }
                // Format resource name for display
                const displayName = resType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                if (gathered) {
                    this.ui.showNotification('Gathered', `+${resAmt} ${displayName}`, 'success');
                } else {
                    this.ui.showNotification('Packs Full', `${resAmt} ${displayName} left on the ground. ${PlayerInventory.fullMessage(this.player)}`, 'warning');
                }
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
        // The deer graze, wander and bolt (world/innerMap/animals.js)
        InnerMapAnimals.update(simDelta, this);

        // ── Update combat system (NPC attacks, float numbers, hit flashes) ──
        if (typeof InnerMapCombat !== 'undefined') {
            InnerMapCombat.update(simDelta, this);
            InnerMapJail.update(this);
            InnerMapZones.update(this);
        }
        // Jobs done in person on the street map (ui/innerMapTasks.js)
        InnerMapTasks.update(simDelta, this);
        // Digging, filling in, burying (ui/innerMapDigging.js)
        InnerMapDigging.update(simDelta, this);
        // Aboard ship: the crew, the sea's events, boarders (ui/innerMapDeck.js)
        InnerMapDeck.update(simDelta, this);

        // Update light system from time of day
        if (typeof LightSystem !== 'undefined') {
            LightSystem.updateFromTime();
            LightSystem.collectLights(this.innerMapCamera);
        }

        // Render inner map
        InnerMapRenderer.render(this.renderer.ctx, this.canvas, this.innerMapCamera, deltaTime);
        InnerMapTasks.render(this.renderer.ctx, this.innerMapCamera, this.canvas);
        InnerMapDeck.renderHud(this.renderer.ctx, this.innerMapCamera, this.canvas);

        // Render minimap for inner map
        this.minimap.render();

        } catch (innerErr) {
            console.error('CRASH in inner map branch of gameLoop:', innerErr);
        }
        requestAnimationFrame((t) => this.gameLoop(t, loopId));
        return;
    }

    // While inner map is loading, skip world-map updates/rendering.
    if (this._enteringInnerMap) {
        requestAnimationFrame((t) => this.gameLoop(t, loopId));
        return;
    }

    // A throw anywhere below must not end the rAF chain (a frozen game);
    // log it and draw the next frame, as the inner-map branch does.
    try {
    // Follow the player unless the camera was panned away (drag, keys, minimap)
    this.camera.locked = false;
    if (this.camera.following) {
        const pos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
        this.camera.follow(pos.x, pos.y);
    }
    this.camera.update(deltaTime);
    this.camera.precomputeFrame();

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

    // Standing cheats (infinite movement, god mode) hold every frame
    if (this._cheats) this.ui.applyCheats();

    // Update player movement
    if (this.player.isMoving) {
        const moved = this.player.stepAlongPath(this.world, deltaTime);
        if (moved) {
            if (this._cheats && this._cheats.fullVision) this.ui.applyCheats(true);
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

            // Camera follows player while moving (unless panned away)
            if (this.camera.following) {
                const pos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
                this.camera.follow(pos.x, pos.y);
            }
        } else if (!this.player.isMoving && this.player.queuedPath && !this.isProcessingTurn) {
            // Too spent for the next hex (or out of action points as you set out): the step queued
            // the way for tomorrow, so make camp and go on in the morning, as running out mid-step does
            if (this.player.autoChart) {
                this.ui.showNotification('🧭 Resting for the Night', 'You make camp and will go on charting in the morning. Press Escape to stop.', 'info');
            } else {
                const remaining = this.player.queuedPath.length - this.player.queuedPathIndex;
                this.ui.showNotification('🌙 Resting for the Night',
                    `You make camp and set off at first light: ~${remaining} tiles to go. Press Escape to cancel.`, 'info');
            }
            this.endDay();
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

    } catch (worldErr) {
        console.error('CRASH in world map branch of gameLoop:', worldErr);
    }
    requestAnimationFrame((t) => this.gameLoop(t, loopId));
}

/** Snap the world camera back onto the player and follow them again */
export function recenterCamera() {
    if (!this.player || !this.renderer) return;
    const pos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
    this.camera.centerOn(pos.x, pos.y);
    this.camera.following = true;
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

    // Clear hover when the cursor leaves the canvas so no stale highlight sticks
    this.canvas.addEventListener('mouseleave', () => {
        this.mouseX = null;
        this.mouseY = null;
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
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
        // Nothing to drive until a game is running (title/loading: no UI, world or player yet)
        if (!this.ui || !this.world || !this.player) return;
        // Cheats panel: ` or F9
        if (e.key === '`' || e.key === 'F9') {
            e.preventDefault();
            this.ui.toggleCheatsPanel();
            return;
        }
        if (e.key === 'Escape' && this._cheatTeleportArmed) {
            this._cheatTeleportArmed = false;
            this.ui.showNotification('🧪 Teleport', 'Cancelled', 'default');
            return;
        }
        // C: snap the world camera back to the player
        if ((e.key === 'c' || e.key === 'C') && !InnerMap.active && !e.ctrlKey && !e.metaKey) {
            this.recenterCamera();
        }
        if (e.key === 'm' || e.key === 'M') {
            const modes = ['normal', 'political', 'religion', 'wealth', 'military', 'trade', 'prices', 'culture'];
            const current = this.renderer.mapMode;
            const idx = modes.indexOf(current);
            const next = modes[(idx + 1) % modes.length];
            this.ui.setMapMode(next);
        }
        // The trade map: G steps through the goods (Shift+G back)
        if ((e.key === 'g' || e.key === 'G') && this.renderer.mapMode === 'prices') {
            const id = this.renderer.cycleTradeMapGood(e.shiftKey ? -1 : 1);
            if (this.minimap) this.minimap.invalidate();
            this.ui.showNotification('📈 Trade Map', `Showing ${id}`, 'info');
        }
        if (e.key === 'Escape') {
            // An open panel takes Escape first: close the topmost one rather
            // than also cancelling travel or leaving the inner map
            if (document.getElementById('actionMenu')) {
                ActionMenu.close();
                return;
            }
            const customPanel = document.getElementById('customPanel');
            if (customPanel) {
                // A locked panel (the death screen) closes only through its own buttons
                if (!customPanel._locked) this.ui.hideCustomPanel();
                return;
            }
            const openSide = ['characterPanel', 'kingdomPanel', 'hexInfoPanel'].find(id => {
                const el = document.getElementById(id);
                return el && !el.classList.contains('hidden');
            });
            if (openSide) {
                this.ui.hidePanel(openSide);
                return;
            }
            // Exit inner map mode
            if (InnerMap.active) {
                // If inside a building, exit the building first
                if (InnerMap._insideBuilding) {
                    InnerMapRenderer.closeContextMenu();
                    // (Re-sets the camera for the outer map; refuses in a locked cell)
                    this._leaveBuilding();
                    return;
                }
                this.exitInnerMap();
                return;
            }
            if (this.player && this.player.autoChart) this.stopAutoChart();
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
    const hasMouse = this.mouseX !== null && this.mouseY !== null;
    this.renderer.hoveredHex = hasMouse ? this.renderer.getHexAtScreen(this.mouseX, this.mouseY) : null;
    this.renderer.mouseX = this.mouseX;
    this.renderer.mouseY = this.mouseY;
    this._updateHoverRoute();
}

/**
 * The trip to the hovered hex: its route (drawn with the nights' camps) and
 * how long it takes, for the label by the cursor. Worked out again only when
 * the hex, your place, the day or your strength changes.
 */
export function _updateHoverRoute() {
    const r = this.renderer;
    const h = r.hoveredHex;
    const p = this.player;
    if (!h || !p || p.isMoving || this.isProcessingTurn) {
        r.hoverRoute = null;
        r.hoverRouteLabel = '';
        this._hoverRouteKey = null;
        return;
    }
    const key = `${h.q},${h.r}|${p.q},${p.r}|${this.world.day}|${p.actionPoints}|${p.movementRemaining}|${p.boardedShip || ''}`;
    if (key === this._hoverRouteKey) return;
    this._hoverRouteKey = key;
    const tile = this.world.getTile(h.q, h.r);
    const est = tile && tile.explored && typeof p.travelEstimate === 'function' ? p.travelEstimate(this.world, h.q, h.r) : null;
    r.hoverRoute = est;
    r.hoverRouteLabel = !est ? ''
        : est.days === 0 ? `${est.steps} hex${est.steps === 1 ? '' : 'es'}, today`
            : `${est.steps} hexes, ${est.days === 1 ? 'arrive tomorrow' : `${est.days + 1} days`}`;
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
            InnerMap._pendingAction = null;
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

    // Cheats: an armed teleport takes the next map click
    if (this._cheatTeleportArmed) {
        this.ui.cheatTeleportTo(hex.q, hex.r);
        return;
    }

    const tile = this.world.getTile(hex.q, hex.r);
    if (!tile) return;

    // Dead and waiting (player/afterlife.js): the map can be looked at, not walked
    if (Afterlife.active(this.player)) {
        this.renderer.selectedHex = hex;
        this.ui.showHexInfo(tile, hex.q, hex.r);
        return;
    }

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
        // Same rules the player's pathfinding uses (land vs. aboard a ship)
        const isAccessible = this.player._canEnterHex(hex.q, hex.r, this.world);

        // If clicking on an accessible, explored tile — try to move there
        if (isAccessible) {
            // Don't move if clicking current position
            if (hex.q === this.player.q && hex.r === this.player.r) {
                return;
            }

            // An order to go elsewhere ends a survey in hand (ui/game/autoChart.js)
            this.stopAutoChart('You leave off charting to go elsewhere.');
            const success = this.player.moveTo(hex.q, hex.r, this.world);
            if (success) {
                // Setting out brings the camera back to the player
                this.camera.following = true;
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

    // Double-click in inner map selects the tile (no tile-info panel on the street map)
    if (InnerMap.active) {
        const innerHex = InnerMapRenderer.getInnerHexAtScreen(screenX, screenY, this.innerMapCamera);
        if (innerHex) InnerMapRenderer._selectedInnerHex = innerHex;
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


/**
 * The player has moved a tile on the inner map: in deep water that is a
 * stroke (player/swimming.js — tired, cold, washed, going under), on land the
 * swim is over. Health gone in the water is drowning.
 */
function _swimStep(game) {
    const player = game.player;
    if (!player) return;
    if (!InnerMap.isPlayerSwimming()) {
        const strokes = Swimming.ashore(player);
        if (strokes && strokes > 3) game.ui.showNotification('🏖️ Ashore', 'You haul yourself out of the water, dripping.', 'info');
        return;
    }
    const wt = game.world && InnerMap.currentWorldTile ? game.world.getTile(InnerMap.currentWorldTile.q, InnerMap.currentWorldTile.r) : null;
    const res = Swimming.stroke(player, game.world, wt, { deep: true });
    for (const n of res.notices.slice(0, 2)) game.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
    if (typeof game.ui.updateStats === 'function' && (res.drowning || res.struggling || res.cold)) game.ui.updateStats(player, game.world);
    if (player.health <= 0 && typeof game._triggerDeath === 'function') {
        InnerMap.cancelPlayerWalk();
        setTimeout(() => game._triggerDeath('drowning'), 0);
    }
}

/**
 * The side of the world hex a map edge faces (Hex.neighbors order: E, NE, NW,
 * W, SW, SE) — the top and bottom edges are two sides each, split down the
 * middle (as rivers cross them: world/innerMap/water.js _riverGate). null
 * off the edge.
 */
export function edgeSide(q, r, W, H) {
    if (r <= 0) return q < W / 2 ? 2 : 1;
    if (r >= H - 1) return q < W / 2 ? 4 : 5;
    if (q <= 0) return 3;
    if (q >= W - 1) return 0;
    return null;
}

/** Where on the next hex's map you come in, crossing by `side` from (q, r) on this one. */
export function edgeEntry(side, q, r, W, H) {
    const half = Math.floor(W / 2);
    const clampQ = x => Math.max(0, Math.min(W - 1, x));
    switch (side) {
        case 0: return { q: 0, r };
        case 3: return { q: W - 1, r };
        // out by the north-east, in by the south-west: the right half of the top → the left half of the bottom
        case 1: return { q: clampQ(q - half), r: H - 1 };
        case 2: return { q: clampQ(q + half), r: H - 1 };
        case 4: return { q: clampQ(q + half), r: 0 };
        case 5: return { q: clampQ(q - half), r: 0 };
        default: return { q, r };
    }
}

/**
 * The player stands on the edge of the inner map: go on into the neighbouring
 * hex — onto the world hex itself, then its own map, coming in on the matching
 * edge, the clock running on. Not out of a building, off your ship's deck,
 * onto ground no one can walk, or out over the open sea.
 */
function _crossEdge(game) {
    if (!InnerMap.active || InnerMap._insideBuilding || game._crossingEdge) return;
    const W = InnerMap.width, H = InnerMap.height;
    const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
    const side = edgeSide(q, r, W, H);
    if (side === null) return;
    const player = game.player, world = game.world;
    if (InnerMap._deck || player.boardedShip) {
        game.ui.showNotification('⛵ Aboard', 'Your ship is here. Take the helm to sail on, or make for port.', 'info');
        return;
    }
    if (InnerMap.jailLocked && InnerMap.jailLocked()) return;
    const n = Hex.neighbors(player.q, player.r)[side];
    const nq = world.width ? Hex.wrapQ(n.q, world.width) : n.q;
    const nt = n.r >= 0 && n.r < world.height ? world.getTile(nq, n.r) : null;
    if (!nt) { game.ui.showNotification('🌫️ The Edge of the World', 'There is nothing beyond.', 'info'); return; }
    const water = Terrain.isWaterId(nt.terrain.id);
    if (water) {
        game.ui.showNotification('🌊 Open Water', `${nt.terrain.name || 'The sea'} stretches away — too far to swim. You need a ship.`, 'warning');
        return;
    }
    if (!nt.terrain.passable) {
        game.ui.showNotification('⛰️ No Way Through', `${nt.terrain.name || 'That ground'} lies beyond — there is no way on from here.`, 'warning');
        return;
    }
    // On to the next hex, the hour unchanged
    const clock = { timeOfDay: InnerMap.timeOfDay, acc: InnerMap._timeAccumulator };
    const entry = edgeEntry(side, q, r, W, H);
    game._crossingEdge = true;
    InnerMap.cancelPlayerWalk();
    game.exitInnerMap({ quiet: true });
    player.prevQ = player.q; player.prevR = player.r;
    player.q = nq; player.r = n.r;
    nt.explored = true;
    if (typeof player.revealArea === 'function') player.revealArea(world, 1);
    if (typeof player.updateVisibility === 'function') player.updateVisibility(world, 4);
    if (typeof game.onPlayerArrived === 'function') game.onPlayerArrived();
    Promise.resolve(game.enterInnerMap(nq, n.r)).then(() => {
        if (!InnerMap.active) return;
        InnerMap.timeOfDay = clock.timeOfDay;
        InnerMap._timeAccumulator = clock.acc;
        // In on the matching edge: there, or the nearest spot you can stand (or swim)
        let at = null;
        for (let d = 0; d <= 8 && !at; d++) {
            for (let dq = -d; dq <= d && !at; dq++) {
                for (let dr = -d; dr <= d && !at; dr++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== d) continue;
                    const x = entry.q + dq, y = entry.r + dr;
                    const t = InnerMap.tiles[y] && InnerMap.tiles[y][x];
                    if (t && !t.building && (t.subTerrain.passable || InnerMap.isSwimmable(x, y))) at = { q: x, r: y };
                }
            }
        }
        if (at) {
            InnerMap.playerInnerQ = at.q;
            InnerMap.playerInnerR = at.r;
            InnerMap.cancelPlayerWalk();
            if (InnerMap._revealAround) InnerMap._revealAround(InnerMap.tiles, at.q, at.r, 2);
            const pw = InnerMap.getPlayerWorldPos();
            game.innerMapCamera.centerOn(pw.x, pw.y);
            game.innerMapCamera.precomputeFrame();
        }
        game.ui.updateStats(player, world);
    }).finally(() => { game._crossingEdge = false; });
}
