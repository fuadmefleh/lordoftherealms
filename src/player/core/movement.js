// ============================================
// PLAYER MOVEMENT — Hex movement, pathfinding, visibility
// Mixed into the Player class via player/core/index.js.
// All methods use `this` to reference the player instance.
// ============================================

import { Hex } from '../../core/hex.js';
import { Dawn } from '../../world/dawn.js';
import { OceanCurrents } from '../../world/oceanCurrents.js';
import { Endurance } from '../endurance.js';
import { Utils } from '../../core/utils.js';
import { Infrastructure } from '../../systems/infrastructure.js';
import { PublicWorks } from '../../systems/publicWorks.js';
import { Titles } from '../../systems/titles.js';
import { Technology } from '../../systems/technology.js';
import { Housing } from '../../systems/housing.js';
import { Ships } from '../../systems/ships.js';
import { PlayerMilitary } from '../playerMilitary.js';

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
        // Cartography/espionage techs and watchtower-style house upgrades see further
        viewRadius += Technology.getVisionBonus(this) + Housing.getTotalBonuses(this).visibility;
        // Scouts riding with the army see further
        viewRadius += PlayerMilitary.getScoutVisionBonus(this);
        // A Royal Cartographer's trained eye charts further afield
        const title = Titles.getActiveTitle(this);
        viewRadius += (title && title.perks && title.perks.explorationBonus) || 0;
        // The Royal Observatory (systems/patronage.js → player.patronage.fx)
        const pfx = this.patronage && this.patronage.fx;
        viewRadius += (pfx && Number.isFinite(pfx.vision)) ? pfx.vision : 0;
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

        // Watchtowers you own keep watch around themselves
        for (const p of this.properties || []) {
            if (p.type !== 'watchtower') continue;
            const t = world.getTile(p.q, p.r);
            const tower = t && (t.playerProperties || [t.playerProperty]).find(x => x && x.type === 'watchtower');
            if (!tower || tower.underConstruction) continue;
            for (const hex of Hex.hexesInRange(p.q, p.r, 4)) {
                const wt = world.getTile(hex.q, hex.r);
                if (wt) { wt.explored = true; wt.visible = true; }
            }
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

    /** Terrain a boarded ship can sail on (beaches count, so you can wade ashore). */
    SHIP_TERRAINS: ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'],

    /**
     * Can the player enter hex (q, r) in their current mode? On land that's
     * plain terrain passability; aboard a ship it's water, beaches, coastal
     * settlements and jetties (to dock) and the hex they're already on.
     */
    _canEnterHex(q, r, world) {
        const tile = world.getTile(q, r);
        if (!tile) return false;
        if (!this.boardedShip) return !!tile.terrain.passable;
        if (q === this.q && r === this.r) return true;
        if (this.SHIP_TERRAINS.includes(tile.terrain.id)) return true;
        const jetty = tile.infrastructure && tile.infrastructure.id === 'jetty' && !tile.infrastructure.underConstruction;
        if (!tile.settlement && !jetty) return false;
        return Hex.neighbors(q, r).some(n => {
            if (n.r < 0 || n.r >= world.height) return false;
            const nTile = world.getTile(Hex.wrapQ(n.q, world.width), n.r);
            return !!nTile && this.SHIP_TERRAINS.includes(nTile.terrain.id);
        });
    },

    /**
     * Movement cost to enter a tile — sailing is 2 per hex (up to 4 when short-handed). On foot
     * travel is counted in days per hex (data/travel.json, Infrastructure.getPlayerHexDays: open
     * land ¾ of a day, a forest a day, a mountain three, roads quicker), worth the day's full
     * strength (_travelPace) each: a hex of more days than are left is crossed over several
     * (stepAlongPath, this.crossing).
     */
    _hexMoveCost(tile) {
        if (this.boardedShip) {
            // 2 per hex fully crewed; a short-handed ship is slower going
            const ship = Ships.getShipById(this, this.boardedShip);
            return ship ? Ships.getSailHexCost(ship) : 2;
        }
        const days = this._hexDays(tile);
        return Number.isFinite(days) ? days * this._travelPace() : Infinity;
    },

    /**
     * Aboard ship, the sea's current on a hex sailed from (fromQ, fromR) into
     * (toQ, toR): its cost times this — less going with the current, more
     * against it (world/oceanCurrents.js). 1 on foot, or with no current.
     */
    _sailCurrent(world, fromQ, fromR, toQ, toR) {
        if (!this.boardedShip || !world) return 1;
        const dir = OceanCurrents.sideTo(Hex.neighbors(fromQ, fromR), toQ, toR, world.width);
        return dir < 0 ? 1 : OceanCurrents.sailFactor(world, toQ, toR, dir);
    },

    /**
     * The night at sea: a ship lying at sea (not under way, not in a port)
     * is carried downstream by the current — driftPerDay x its strength of a
     * hex a night, a whole hex when that adds up to one (data/currents.json
     * sail). → { moved, q, r, dir, name } when carried a hex, else null.
     */
    driftWithCurrent(world) {
        if (!world || !this.boardedShip || this.isMoving || (this.queuedPath && this.queuedPath.length)) { this._currentDrift = 0; return null; }
        const tile = world.getTile(this.q, this.r);
        const cur = tile && !tile.settlement ? OceanCurrents.at(world, this.q, this.r) : null;
        if (!cur || !(cur.strength > 0)) { this._currentDrift = 0; return null; }
        const per = Number(OceanCurrents.config().sail.driftPerDay) || 0;
        this._currentDrift = (Number(this._currentDrift) || 0) + per * cur.strength;
        if (this._currentDrift < 1) return null;
        this._currentDrift -= 1;
        const n = Hex.neighbors(this.q, this.r)[cur.dir];
        const q = Hex.wrapQ(n.q, world.width), r = n.r;
        if (r < 0 || r >= world.height || !this._canEnterHex(q, r, world) || !OceanCurrents.isSea(world.getTile(q, r))) return null;
        this.prevQ = this.q;
        this.prevR = this.r;
        this.q = q;
        this.r = r;
        const t = world.getTile(q, r);
        if (t) { t.explored = true; t.visible = true; }
        this.revealArea(world, 4);
        this.updateVisibility(world, 4);
        return { moved: true, q, r, dir: cur.dir, name: cur.name };
    },

    /** Days to cross a tile on foot (or, aboard ship, its sailing cost as a share of the day). */
    _hexDays(tile) {
        if (this.boardedShip) return this._hexMoveCost(tile) / this._travelPace();
        return Infrastructure.getPlayerHexDays(tile, this);
    },

    /**
     * What a whole day of travel is worth in movement: the day's full,
     * unimpaired strength (set each morning by endDay; before the first
     * night, the stamina the player starts with).
     */
    _travelPace() {
        if (this._dayPace > 0) return this._dayPace;
        return Math.max(1, this.maxStamina || this.stamina || 10);
    },

    /** The day's full strength, for spreading a crossing over the days to come. */
    _fullDayMovement() {
        return Math.max(1e-6, this._dayMovement > 0 ? this._dayMovement : this._travelPace());
    },

    /** Floating-point slack when comparing movement against a hex's cost. */
    MOVE_EPS: 1e-6,

    /** The crossing under way into hex (q, r) from where the player stands, or null. */
    _crossingTo(q, r) {
        const c = this.crossing;
        if (!c || c.q !== q || c.r !== r || c.fromQ !== this.q || c.fromR !== this.r) return null;
        return c;
    },

    /**
     * A crossing under way: { name, day, days, done, need, q, r, longHex } with
     * `day` the day of it the next stretch falls on (world.day given), or null.
     */
    crossingStatus(world) {
        const c = this.crossing;
        if (!c || c.fromQ !== this.q || c.fromR !== this.r) return null;
        const today = world && Number.isFinite(world.day) ? world.day : c.lastDay;
        const day = (c.day || 1) + (today !== c.lastDay ? 1 : 0);
        return { name: c.name, day, days: Math.max(day, c.days || 1), done: c.done, need: c.need, q: c.q, r: c.r, longHex: !!c.longHex };
    },

    /** "crossing the mountains, day 2 of 3" (or "on the way across the woods" for a short hex). */
    crossingText(world) {
        const st = this.crossingStatus(world);
        if (!st) return '';
        return st.longHex ? `crossing ${st.name}, day ${st.day} of ${st.days}` : `on the way across ${st.name}`;
    },

    /** How far into the hex being crossed the player is (0..1), for drawing them on the way. */
    crossingProgress() {
        const c = this.crossing;
        if (!c || !(c.need > 0) || c.fromQ !== this.q || c.fromR !== this.r) return 0;
        return Math.max(0, Math.min(1, c.done / c.need));
    },

    /**
     * Extra route-planning weight for leaving the road. Stamina costs are
     * whole numbers (at least 1), so on open ground a road hex costs the same
     * as the grass beside it and the route ignored it; travellers keep to the
     * road unless going cross-country is clearly shorter. Planning only — the
     * stamina actually spent is still _hexMoveCost.
     */
    OFF_ROAD_PATH_PENALTY: 0.35,

    /** Is this hex on a finished road or bridge (world-built or the player's)? */
    _isRoadHex(tile) {
        if (!tile) return false;
        const inf = tile.infrastructure;
        if (inf && !inf.underConstruction) {
            return inf.id === 'dirt_road' || inf.id === 'stone_road' || inf.id === 'bridge';
        }
        return !!tile.hasRoad;
    },

    /** Route-planning cost of entering a tile: stamina plus the off-road weight on foot. */
    _hexPathCost(tile) {
        const cost = this._hexMoveCost(tile);
        if (this.boardedShip || !Number.isFinite(cost)) return cost;
        return this._isRoadHex(tile) ? cost : cost + this.OFF_ROAD_PATH_PENALTY;
    },

    /**
     * Request to move to target hex
     */
    moveTo(targetQ, targetR, world) {
        // Can't move during jail or indentured servitude
        if (this.jailState) return false;
        if (this.indenturedServitude) return false;

        const path = Hex.findPath(
            this.q, this.r,
            targetQ, targetR,
            world.width, world.height,
            (q, r) => this._canEnterHex(q, r, world),
            (q, r) => this._hexPathCost(world.getTile(q, r))
        );

        if (path && path.length > 1) {
            // Turning back (or anywhere else) gives up the crossing under way
            if (this.crossing && !this._crossingTo(path[1].q, path[1].r)) this.crossing = null;
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
     * How a trip to (q, r) would go, as stepAlongPath would walk it: the route,
     * its steps, and the days it takes — today's strength and action points
     * first, then a full day's each morning (camping where the day runs out).
     * → { path, steps, days, stops: [{q, r}] } (days 0 = arrive today), or
     * null when there is no way there (or the player can't travel).
     */
    travelEstimate(world, targetQ, targetR) {
        if (!world || this.jailState || this.indenturedServitude) return null;
        if (targetQ === this.q && targetR === this.r) return null;
        if (!this._canEnterHex(targetQ, targetR, world)) return null;
        const path = Hex.findPath(
            this.q, this.r, targetQ, targetR, world.width, world.height,
            (q, r) => this._canEnterHex(q, r, world),
            (q, r) => this._hexPathCost(world.getTile(q, r))
        );
        if (!path || path.length < 2) return null;
        const EPS = this.MOVE_EPS;
        const pace = this._travelPace();
        const fullMove = this._fullDayMovement();
        const fullAP = Math.max(1, this.maxActionPoints || 10);
        let move = Math.max(0, this.movementRemaining || 0);
        let ap = this.actionPoints || 0;
        let days = 0;
        let travelDays = 0;
        const stops = [];
        const crossings = [];
        // A night's camp: at the last hex, or part-way (t) into the next
        const camp = (from, to, t) => {
            days++;
            stops.push(to ? { q: from.q, r: from.r, toQ: to.q, toR: to.r, t } : { q: from.q, r: from.r });
            move = fullMove;
            ap = fullAP;
        };
        for (let i = 1; i < path.length && days <= 365; i++) {
            const tile = world.getTile(path[i].q, path[i].r);
            const under = i === 1 ? this._crossingTo(path[1].q, path[1].r) : null;
            const full = under ? under.need : (tile ? this._hexMoveCost(tile) * this._sailCurrent(world, path[i - 1].q, path[i - 1].r, path[i].q, path[i].r) : 1);
            let left = under ? Math.max(0, under.need - under.done) : full;
            travelDays += left / pace;
            // Setting out across a hex takes an action point (going on with one doesn't)
            if (!under) {
                if (ap < 1) camp(path[i - 1]);
                ap--;
            }
            // Aboard ship a hex is sailed whole: short of it, lie at anchor till morning
            if (this.boardedShip && move + EPS < left) camp(path[i - 1]);
            // Each night on the way across: a camp part-way into the hex
            while (move + EPS < left && days <= 365) {
                left -= move;
                camp(path[i - 1], path[i], Math.max(0, Math.min(1, (full - left) / Math.max(EPS, full))));
            }
            move = Math.max(0, move - left);
            const hexDays = full / pace;
            if (hexDays > 1 + EPS && tile) {
                crossings.push({ q: path[i].q, r: path[i].r, days: Math.round(hexDays * 100) / 100, name: Infrastructure.crossingName(tile.terrain) });
            }
        }
        return { path, steps: path.length - 1, days, stops, crossings, travelDays };
    },

    /**
     * Cancel any queued multi-day travel
     */
    cancelTravel() {
        this.queuedPath = null;
        this.queuedPathIndex = 0;
        this.travelDestination = null;
        // Turning back from a crossing: the way made into it is lost
        this.crossing = null;
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
     * A day of a crossing under way, without the walk animation (days let
     * pass, ui/timeSkip.js): the day's strength goes into the hex, arriving
     * when it is done. The rest of the trip stays queued.
     * → { arrived, name, day, days } or null when there is no crossing.
     */
    advanceCrossing(world) {
        const st = this.crossingStatus(world);
        if (!st || !this.queuedPath) return null;
        if (!this.resumeQueuedPath()) return null;
        this.moveAnimProgress = 1;
        const arrived = this.stepAlongPath(world, 0);
        if (this.isMoving && this.path) {
            this.queuedPath = this.path;
            this.queuedPathIndex = this.pathIndex;
            this.isMoving = false;
            this.path = null;
        }
        return { arrived, name: st.name, day: st.day, days: st.days };
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

            if (!this._canEnterHex(nextHex.q, nextHex.r, world)) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Travel is counted in days per hex (data/travel.json): what the
            // next hex still takes — all of it, or the rest of a crossing under
            // way. Setting out across a hex costs 1 AP; going on with one doesn't.
            const EPS = this.MOVE_EPS;
            const under = this.boardedShip ? null : this._crossingTo(nextHex.q, nextHex.r);
            const moveCost = under ? Math.max(0, under.need - under.done) : this._hexMoveCost(tile) * this._sailCurrent(world, this.q, this.r, nextHex.q, nextHex.r);
            const queueRest = () => {
                this.queuedPath = this.path;
                this.queuedPathIndex = this.pathIndex;
                this.isMoving = false;
                this.path = null;
                return false;
            };
            if (!under && (this.actionPoints || 0) < 1) return queueRest();
            if (this.movementRemaining + EPS < moveCost) {
                // A ship sails a hex whole, or waits for the morning wind (a full
                // day always carries it one hex, however short-handed)
                if (this.boardedShip) {
                    const freshDay = this._dayMovement > 0 && this.movementRemaining >= this._dayMovement;
                    if (!freshDay) return queueRest();
                } else {
                    // Not across by nightfall: the rest of the day goes into the
                    // hex, the traveller camps on the way and goes on in the
                    // morning; a mountain takes days ("crossing the mountains, day 2 of 3")
                    if (!(this.movementRemaining > EPS)) return queueRest();
                    const today = world && Number.isFinite(world.day) ? world.day : null;
                    let c = under;
                    if (!c) {
                        const full = this._fullDayMovement();
                        const spent = this.movementRemaining;
                        c = this.crossing = {
                            fromQ: this.q, fromR: this.r, q: nextHex.q, r: nextHex.r,
                            need: moveCost, done: 0, day: 1, lastDay: today,
                            days: 1 + Math.max(1, Math.ceil((moveCost - spent) / full - EPS)),
                            longHex: moveCost / this._travelPace() > 1 + EPS,
                            terrain: tile.terrain && tile.terrain.id,
                            name: Infrastructure.crossingName(tile.terrain),
                        };
                        this.actionPoints = Math.max(0, (this.actionPoints || 0) - 1);
                    } else if (c.lastDay !== today) {
                        c.day = (c.day || 1) + 1;
                        c.lastDay = today;
                        // (the reckoning of days held to what is now known: a hungry day is shorter)
                        c.days = Math.max(c.day, c.day - 1 + Math.ceil((c.need - c.done) / this._fullDayMovement() - EPS));
                    }
                    c.done += this.movementRemaining;
                    this.movementRemaining = 0;
                    return queueRest();
                }
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

            this.movementRemaining = Math.max(0, this.movementRemaining - moveCost);
            if (this.movementRemaining < EPS) this.movementRemaining = 0;
            if (!under) this.actionPoints = Math.max(0, (this.actionPoints || 0) - 1);
            this.crossing = null;
            // The Dawn of Man: a clan kept in step walks with you, hex for hex (world/dawn.js)
            if (this.dawnInStep) Dawn.keepStep(world, this);
            // The miles build Endurance (player/endurance.js)
            Endurance.walked(this, 'hex', 1);

            // A toll gate or a ferry on the road (systems/publicWorks.js)
            if (currentTile && (currentTile.tollGate || currentTile.roadCross === 'ferry')) PublicWorks.playerCrossing(world, this, currentTile);

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
    getReachableHexes(world, opts = {}) {
        const EPS = this.MOVE_EPS;
        const today = Math.max(0, this.movementRemaining || 0);
        const full = this._fullDayMovement();
        // The days after today, drawn faintly with their count (renderer
        // renderReachableHexes) — not when the day is boundless (a cheat)
        const moreDays = Number.isFinite(opts.days) ? Math.max(0, Math.floor(opts.days))
            : (today > full * 10 ? 0 : this.REACH_DAYS);
        const limit = today + moreDays * full;
        const best = new Map();
        const startKey = `${this.q},${this.r}`;
        best.set(startKey, 0);
        const queue = [{ q: this.q, r: this.r, cost: 0 }];

        while (queue.length > 0) {
            const current = queue.shift();
            if (current.cost > best.get(`${current.q},${current.r}`) + EPS) continue;
            const neighbors = Hex.neighbors(current.q, current.r);

            for (const n of neighbors) {
                const wq = Hex.wrapQ(n.q, world.width);
                const wr = n.r;
                if (wr < 0 || wr >= world.height) continue;

                // Same rules as actual movement, so the overlay shows water while sailing
                if (!this._canEnterHex(wq, wr, world)) continue;

                // A crossing under way: only what is left of it
                const under = current.cost === 0 && current.q === this.q && current.r === this.r ? this._crossingTo(wq, wr) : null;
                const step = under ? Math.max(0, under.need - under.done) : this._hexMoveCost(world.getTile(wq, wr)) * this._sailCurrent(world, current.q, current.r, wq, wr);
                const newCost = current.cost + step;
                const key = `${wq},${wr}`;

                if (newCost <= limit + EPS && (!best.has(key) || best.get(key) > newCost + EPS)) {
                    best.set(key, newCost);
                    queue.push({ q: wq, r: wr, cost: newCost });
                }
            }
        }

        // Today's hexes (key → movement spent); the later days on .days (key → 1, 2, …)
        const reachable = new Map();
        const days = new Map();
        for (const [key, cost] of best) {
            if (cost <= today + EPS) reachable.set(key, cost);
            else days.set(key, Math.max(1, Math.ceil((cost - today) / full - EPS)));
        }
        reachable.days = days;
        return reachable;
    },

    /** How many days beyond today the reachable-hex overlay shows. */
    REACH_DAYS: 2,
};
