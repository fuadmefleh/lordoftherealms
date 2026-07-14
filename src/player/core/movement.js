// ============================================
// PLAYER MOVEMENT — Hex movement, pathfinding, visibility
// Mixed into the Player class via player/core/index.js.
// All methods use `this` to reference the player instance.
// ============================================

import { Hex } from '../../core/hex.js';
import { Utils } from '../../core/utils.js';
import { Infrastructure } from '../../systems/infrastructure.js';
import { Titles } from '../../systems/titles.js';

export const PlayerMovementMethods = {
    /**
     * Reveal tiles around the player
     */
    revealArea(world, radius) {
        const currentTile = world.getTile(this.q, this.r);
        if (currentTile) {
            currentTile.explored = true;
            currentTile.visible = true;
        }

        const hexes = Hex.hexesInRange(this.q, this.r, radius);
        for (const hex of hexes) {
            const tile = world.getTile(hex.q, hex.r);
            if (tile) {
                tile.explored = true;
                tile.visible = true;
            }
        }
    },

    /**
     * Set visibility (fog of war update)
     */
    updateVisibility(world, viewRadius = 3) {
        // First, set all tiles to not visible
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                world.tiles[r][q].visible = false;
            }
        }

        const currentTile = world.getTile(this.q, this.r);
        if (currentTile) {
            currentTile.explored = true;
            currentTile.visible = true;
        }

        // Then reveal around player
        const hexes = Hex.hexesInRange(this.q, this.r, viewRadius);
        for (const hex of hexes) {
            const tile = world.getTile(hex.q, hex.r);
            if (tile) {
                tile.explored = true;
                tile.visible = true;
            }
        }
    },

    /**
     * Request to move to target hex
     */
    moveTo(targetQ, targetR, world) {
        // Can't move during jail or indentured servitude
        if (this.jailState) return false;
        if (this.indenturedServitude) return false;

        // Define passability based on whether player is on a ship
        const isPassable = (q, r) => {
            const tile = world.getTile(q, r);
            if (!tile) return false;

            if (this.boardedShip) {
                // On a ship: can move on water tiles and beaches/coasts
                const waterTiles = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'];
                if (waterTiles.includes(tile.terrain.id)) return true;

                // Allow starting position
                const isCurrentPos = (q === this.q && r === this.r);
                if (isCurrentPos) return true;

                // Allow coastal settlements (settlements adjacent to water) for docking
                if (tile.settlement) {
                    const neighbors = Hex.neighbors(q, r);
                    for (const n of neighbors) {
                        const nq = Hex.wrapQ(n.q, world.width);
                        if (n.r < 0 || n.r >= world.height) continue;
                        const nTile = world.getTile(nq, n.r);
                        if (nTile && waterTiles.includes(nTile.terrain.id)) {
                            return true; // Settlement is adjacent to water
                        }
                    }
                }

                return false;
            } else {
                // On land: use normal passability
                return tile.terrain.passable;
            }
        };

        const path = Hex.findPath(
            this.q, this.r,
            targetQ, targetR,
            world.width, world.height,
            isPassable,
            (q, r) => {
                const tile = world.getTile(q, r);
                if (this.boardedShip) {
                    // On a ship: water tiles have uniform movement cost
                    const waterTiles = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'];
                    if (waterTiles.includes(tile.terrain.id)) {
                        return 2; // Standard water movement cost
                    }
                    // Coastal settlements and starting position also cost 2
                    return 2;
                }
                return Infrastructure.getEffectiveMoveCost(tile);
            }
        );

        if (path && path.length > 1) {
            this.path = path;
            this.pathIndex = 1; // Skip first element (current position)
            this.isMoving = true;
            // Store destination for multi-day travel
            this.travelDestination = { q: targetQ, r: targetR };
            // Clear any previous queued path
            this.queuedPath = null;
            this.queuedPathIndex = 0;
            return true;
        }
        return false;
    },

    /**
     * Cancel any queued multi-day travel
     */
    cancelTravel() {
        this.queuedPath = null;
        this.queuedPathIndex = 0;
        this.travelDestination = null;
        if (this.isMoving) {
            this.isMoving = false;
            this.path = null;
        }
    },

    /**
     * Resume queued path after a new day (stamina restored)
     */
    resumeQueuedPath() {
        if (!this.queuedPath || this.queuedPathIndex >= this.queuedPath.length) {
            this.queuedPath = null;
            this.queuedPathIndex = 0;
            this.travelDestination = null;
            return false;
        }

        this.path = this.queuedPath;
        this.pathIndex = this.queuedPathIndex;
        this.isMoving = true;
        this.moveAnimProgress = 0;
        // Clear queued state (now active)
        this.queuedPath = null;
        this.queuedPathIndex = 0;
        return true;
    },

    /**
     * Step along path (called each frame during movement)
     */
    stepAlongPath(world, deltaTime) {
        if (!this.isMoving || !this.path || this.pathIndex >= this.path.length) {
            this.isMoving = false;
            this.path = null;
            return false;
        }

        // Animate movement
        this.moveAnimProgress += deltaTime * 4; // Speed of movement animation

        if (this.moveAnimProgress >= 1) {
            const nextHex = this.path[this.pathIndex];
            const tile = world.getTile(nextHex.q, nextHex.r);

            // Check if tile is accessible based on current mode (ship vs land)
            let isAccessible = false;
            if (this.boardedShip) {
                const waterTiles = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'];
                // Allow water tiles
                if (waterTiles.includes(tile.terrain.id)) {
                    isAccessible = true;
                }
                // Allow coastal settlements (for docking)
                else if (tile.settlement) {
                    const neighbors = Hex.neighbors(nextHex.q, nextHex.r);
                    for (const n of neighbors) {
                        const nq = Hex.wrapQ(n.q, world.width);
                        if (n.r < 0 || n.r >= world.height) continue;
                        const nTile = world.getTile(nq, n.r);
                        if (nTile && waterTiles.includes(nTile.terrain.id)) {
                            isAccessible = true;
                            break;
                        }
                    }
                }
            } else {
                isAccessible = tile.terrain.passable;
            }

            if (!tile || !isAccessible) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Check stamina
            let moveCost;
            if (this.boardedShip) {
                moveCost = 2; // Water movement cost
            } else {
                moveCost = (typeof Infrastructure !== 'undefined') ? Infrastructure.getEffectiveMoveCost(tile) : tile.terrain.moveCost;
            }
            if (this.movementRemaining < moveCost) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Check action points (each move step costs 1 AP)
            if ((this.actionPoints || 0) < 1) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Move
            this.prevQ = this.q;
            this.prevR = this.r;
            this.q = nextHex.q;
            this.r = nextHex.r;

            // Ensure q coordinate is wrapped (for world wrapping)
            if (typeof Hex !== 'undefined' && world.width) {
                this.q = Hex.wrapQ(this.q, world.width);
            }

            // Always mark the exact tile stepped on as explored.
            const currentTile = world.getTile(this.q, this.r);
            if (currentTile) {
                currentTile.explored = true;
                currentTile.visible = true;
            }

            this.movementRemaining -= moveCost;
            this.actionPoints = Math.max(0, (this.actionPoints || 0) - 1);

            // Reveal area
            this.revealArea(world, 4);
            this.updateVisibility(world, 4);

            // Discover holy sites on explored tiles
            this.discoverNearbyHolySites(world, 4);

            // Title hooks: marshal patrol & cartographer exploration
            if (typeof Titles !== 'undefined') {
                Titles.recordPatrolStep(this, this.q, this.r);
                Titles.recordExploration(this, 1);
            }

            // Check for improvements (POIs) - just track visitation, don't auto-reward
            // (Use the Explore action for full rewards)
            if (tile.improvement) {
                const impKey = `${tile.q},${tile.r}`;
                if (!this.visitedImprovements.has(impKey)) {
                    this.visitedImprovements.add(impKey);
                    // Discovery notification is now handled in game.js
                }
            }

            this.pathIndex++;
            this.moveAnimProgress = 0;

            if (this.pathIndex >= this.path.length) {
                // Arrived at destination
                this.isMoving = false;
                this.path = null;
                this.travelDestination = null;
            } else if (this.movementRemaining <= 0 || (this.actionPoints || 0) <= 0) {
                // Out of stamina or action points — queue remaining path for next day
                this.queuedPath = this.path;
                this.queuedPathIndex = this.pathIndex;
                this.isMoving = false;
                this.path = null;
            }

            return true; // Moved to new hex
        }

        return false;
    },

    /**
     * Get pixel position (interpolated during movement)
     */
    getPixelPos(hexSize) {
        const current = Hex.axialToPixel(this.q, this.r, hexSize);

        if (this.isMoving && this.path && this.pathIndex < this.path.length) {
            const next = Hex.axialToPixel(this.path[this.pathIndex].q, this.path[this.pathIndex].r, hexSize);
            return {
                x: Utils.lerp(current.x, next.x, this.moveAnimProgress),
                y: Utils.lerp(current.y, next.y, this.moveAnimProgress),
            };
        }

        return current;
    },

    /**
     * Get reachable hexes from current position with remaining movement
     */
    getReachableHexes(world) {
        const reachable = new Map();
        const queue = [{ q: this.q, r: this.r, cost: 0 }];
        reachable.set(`${this.q},${this.r}`, 0);

        while (queue.length > 0) {
            const current = queue.shift();
            const neighbors = Hex.neighbors(current.q, current.r);

            for (const n of neighbors) {
                const wq = Hex.wrapQ(n.q, world.width);
                const wr = n.r;
                if (wr < 0 || wr >= world.height) continue;

                const tile = world.getTile(wq, wr);
                if (!tile || !tile.terrain.passable) continue;

                const newCost = current.cost + ((typeof Infrastructure !== 'undefined') ? Infrastructure.getEffectiveMoveCost(tile) : tile.terrain.moveCost);
                const key = `${wq},${wr}`;

                if (newCost <= this.movementRemaining && (!reachable.has(key) || reachable.get(key) > newCost)) {
                    reachable.set(key, newCost);
                    queue.push({ q: wq, r: wr, cost: newCost });
                }
            }
        }

        return reachable;
    },
};
