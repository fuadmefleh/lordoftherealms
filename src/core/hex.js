// ============================================
// HEX — Hex grid coordinate system & math
// Uses axial coordinates (q, r) with cube helpers
// Pointy-top hexagons
// ============================================

import { Utils } from './utils.js';

export const Hex = {
    // Hex directions for pointy-top hexagons (axial)
    // For even-q offset or axial coordinates
    DIRECTIONS: [
        { q: +1, r: 0 }, // East
        { q: +1, r: -1 }, // NE
        { q: 0, r: -1 }, // NW
        { q: -1, r: 0 }, // West
        { q: -1, r: +1 }, // SW
        { q: 0, r: +1 }, // SE
    ],

    /**
     * Get the 6 neighbors of a hex (supports even-row offset coordinates)
     */
    neighbors(q, r) {
        // Even-row offset neighbor logic (pointy-top)
        // Order: E, NE, NW, W, SW, SE (Matches renderer bitmask order)
        if (r % 2 === 0) {
            // Even rows are shifted right (+0.5 hexWidth)
            return [
                { q: q + 1, r: r },     // E
                { q: q + 1, r: r - 1 }, // NE
                { q: q, r: r - 1 },     // NW
                { q: q - 1, r: r },     // W
                { q: q, r: r + 1 },     // SW
                { q: q + 1, r: r + 1 }  // SE
            ];
        } else {
            // Odd rows are NOT shifted
            return [
                { q: q + 1, r: r },     // E
                { q: q, r: r - 1 },     // NE
                { q: q - 1, r: r - 1 }, // NW
                { q: q - 1, r: r },     // W
                { q: q - 1, r: r + 1 }, // SW
                { q: q, r: r + 1 }      // SE
            ];
        }
    },

    /**
     * Axial to cube coordinates
     */
    axialToCube(q, r) {
        return { x: q, y: -q - r, z: r };
    },

    /**
     * Cube to axial coordinates
     */
    cubeToAxial(x, y, z) {
        return { q: x, r: z };
    },

    /**
     * Steps between two hexes on the world grid (even-row offset
     * coordinates, see neighbors()): converted to cube coordinates first.
     * Runs in nearly every per-day loop, so no cube objects.
     *
     * The old version read the offset coordinates as axial, which is wrong
     * by up to half the rows on a diagonal. Regenerating a world saved
     * before the fix (generationParams.terrainGen < 3) runs under
     * Hex.withLegacyMetric so the same seed lays the same map.
     */
    distance(q1, r1, q2, r2) {
        if (Hex._legacy > 0) return Hex.axialDistance(q1, r1, q2, r2);
        const dx = (q1 - ((r1 + (r1 & 1)) >> 1)) - (q2 - ((r2 + (r2 & 1)) >> 1));
        const dz = r1 - r2;
        const a = dx < 0 ? -dx : dx;
        const b = dz < 0 ? -dz : dz;
        const c = dx + dz < 0 ? -(dx + dz) : dx + dz;
        return a > b ? (a > c ? a : c) : (b > c ? b : c);
    },

    /** The old metric: (q, r) read as axial. Only for regenerating old worlds. */
    axialDistance(q1, r1, q2, r2) {
        return Math.max(
            Math.abs(q1 - q2),
            Math.abs((-q1 - r1) - (-q2 - r2)),
            Math.abs(r1 - r2)
        );
    },

    /** >0 while an old world is regenerated (withLegacyMetric) */
    _legacy: 0,

    /** Run fn with the old axial metric (distance, hexesInRange, lineDraw) */
    withLegacyMetric(fn) {
        Hex._legacy++;
        try { return fn(); } finally { Hex._legacy--; }
    },

    /** offset (q, r) → cube x (z is r) */
    _cubeX(q, r) {
        return q - ((r + (r & 1)) >> 1);
    },

    /** cube (x, z) → offset q */
    _offsetQ(x, z) {
        return x + ((z + (z & 1)) >> 1);
    },

    /**
     * Distance on a wrapping map (wraps horizontally)
     */
    wrappingDistance(q1, r1, q2, r2, mapWidth) {
        // Try direct and wrapped
        const direct = Hex.distance(q1, r1, q2, r2);

        // Wrap around — shift q2 by mapWidth in both directions
        const wrapLeft = Hex.distance(q1, r1, q2 - mapWidth, r2);
        const wrapRight = Hex.distance(q1, r1, q2 + mapWidth, r2);

        return Math.min(direct, wrapLeft, wrapRight);
    },

    /**
     * True step distance on the world grid. The map stores even-row offset
     * coordinates (see neighbors()), which `distance` reads as axial — off by
     * up to half the row span on diagonals. Road and river routing use this.
     */
    offsetDistance(q1, r1, q2, r2) {
        const dx = Hex._cubeX(q1, r1) - Hex._cubeX(q2, r2);
        const dz = r1 - r2;
        return Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dx + dz));
    },

    /** offsetDistance on a map that wraps east–west */
    wrappingOffsetDistance(q1, r1, q2, r2, mapWidth) {
        return Math.min(
            Hex.offsetDistance(q1, r1, q2, r2),
            Hex.offsetDistance(q1, r1, q2 - mapWidth, r2),
            Hex.offsetDistance(q1, r1, q2 + mapWidth, r2),
        );
    },

    /**
     * Which neighbor direction (0..5, the neighbors() order) leads from
     * (q1, r1) to the adjacent hex (q2, r2) on a wrapping map; -1 if not adjacent.
     */
    directionTo(q1, r1, q2, r2, mapWidth) {
        const ns = Hex.neighbors(q1, r1);
        const tq = mapWidth ? Hex.wrapQ(q2, mapWidth) : q2;
        for (let i = 0; i < 6; i++) {
            const nq = mapWidth ? Hex.wrapQ(ns[i].q, mapWidth) : ns[i].q;
            if (nq === tq && ns[i].r === r2) return i;
        }
        return -1;
    },

    /**
     * Convert axial hex coordinate to pixel position (pointy-top)
     * @param {number} q - Axial q
     * @param {number} r - Axial r
     * @param {number} size - Hex radius (center to vertex)
     * @returns {{x: number, y: number}}
     */
    axialToPixel(q, r, size) {
        const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
        const y = size * (3 / 2 * r);
        return { x, y };
    },

    /**
     * Convert pixel position to axial hex coordinate (pointy-top)
     * @param {number} px - Pixel x
     * @param {number} py - Pixel y
     * @param {number} size - Hex radius
     * @returns {{q: number, r: number}}
     */
    pixelToAxial(px, py, size) {
        const q = (Math.sqrt(3) / 3 * px - 1 / 3 * py) / size;
        const r = (2 / 3 * py) / size;
        return Hex.axialRound(q, r);
    },

    /**
     * Round fractional axial coordinates to nearest hex
     */
    axialRound(q, r) {
        const cube = Hex.axialToCube(q, r);
        let rx = Math.round(cube.x);
        let ry = Math.round(cube.y);
        let rz = Math.round(cube.z);

        const xDiff = Math.abs(rx - cube.x);
        const yDiff = Math.abs(ry - cube.y);
        const zDiff = Math.abs(rz - cube.z);

        if (xDiff > yDiff && xDiff > zDiff) {
            rx = -ry - rz;
        } else if (yDiff > zDiff) {
            ry = -rx - rz;
        } else {
            rz = -rx - ry;
        }

        return Hex.cubeToAxial(rx, ry, rz);
    },

    /**
     * Get the 6 corner points of a hex (pointy-top)
     * @param {number} cx - Center x pixel
     * @param {number} cy - Center y pixel
     * @param {number} size - Hex radius
     * @returns {Array<{x: number, y: number}>}
     */
    hexCorners(cx, cy, size) {
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (60 * i - 30);
            corners.push({
                x: cx + size * Math.cos(angle),
                y: cy + size * Math.sin(angle)
            });
        }
        return corners;
    },

    /**
     * Wrap q coordinate to stay within map width
     */
    wrapQ(q, mapWidth) {
        return ((q % mapWidth) + mapWidth) % mapWidth;
    },

    /**
     * Get hexes within a radius from center
     */
    hexesInRange(centerQ, centerR, range) {
        const results = [];
        if (Hex._legacy === 0) {
            // Every hex within `range` steps: walk the cube ring rows
            const cx = Hex._cubeX(centerQ, centerR);
            for (let dz = -range; dz <= range; dz++) {
                const z = centerR + dz;
                for (let dx = Math.max(-range, -dz - range); dx <= Math.min(range, -dz + range); dx++) {
                    results.push({ q: Hex._offsetQ(cx + dx, z), r: z });
                }
            }
            return results;
        }
        for (let dq = -range; dq <= range; dq++) {
            for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
                results.push({ q: centerQ + dq, r: centerR + dr });
            }
        }
        return results;
    },

    /**
     * Line between two hexes (for pathfinding visualization)
     */
    lineDraw(q1, r1, q2, r2) {
        const N = Hex.distance(q1, r1, q2, r2);
        if (N === 0) return [{ q: q1, r: r1 }];
        if (Hex._legacy === 0) {
            // Interpolate in cube space, round, and back to offset coordinates
            const x1 = Hex._cubeX(q1, r1), x2 = Hex._cubeX(q2, r2);
            const out = [];
            for (let i = 0; i <= N; i++) {
                const t = i / N;
                const c = Hex.axialRound(Utils.lerp(x1 + 1e-6, x2 + 1e-6, t), Utils.lerp(r1 + 1e-6, r2 + 1e-6, t));
                out.push({ q: Hex._offsetQ(c.q, c.r), r: c.r });
            }
            return out;
        }

        const results = [];
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const q = Utils.lerp(q1 + 1e-6, q2 + 1e-6, t);
            const r = Utils.lerp(r1 + 1e-6, r2 + 1e-6, t);
            results.push(Hex.axialRound(q, r));
        }
        return results;
    },

    /**
     * A* pathfinding on hex grid with wrapping (heavily optimized)
     */
    findPath(startQ, startR, endQ, endR, mapWidth, mapHeight, isPassable, getCost) {
        const startTime = performance.now();

        // Wrap the end coordinate
        const wrappedEnd = { q: Hex.wrapQ(endQ, mapWidth), r: endR };

        if (!isPassable(wrappedEnd.q, wrappedEnd.r)) {
            return null;
        }

        // Quick distance check - reject paths that are too far
        const estimatedDistance = Hex.wrappingDistance(startQ, startR, wrappedEnd.q, wrappedEnd.r, mapWidth);

        if (estimatedDistance > 50) {
            console.warn('Path too far, distance:', estimatedDistance);
            return null; // Too far, don't even try
        }

        const startKey = `${startQ},${startR}`;
        const endKey = `${wrappedEnd.q},${wrappedEnd.r}`;

        // Priority queue (min-heap) for efficient lowest-fScore retrieval.
        // A node whose score improves is pushed again; the stale entry is
        // skipped when it surfaces (lazy deletion) — without that, a node
        // kept its first, worse priority and the search settled for worse
        // paths (e.g. ignoring a road it had already found)
        const openSet = new MinHeap((a, b) => a.f < b.f);
        const closedSet = new Set(); // Track explored nodes
        const cameFrom = new Map();
        const gScore = new Map();

        gScore.set(startKey, 0);
        openSet.push({ key: startKey, f: estimatedDistance, g: 0 });

        let iterations = 0;
        const maxIterations = 6000; // Strict limit to prevent freezing

        while (openSet.size() > 0 && iterations < maxIterations) {
            const current = openSet.pop();
            const currentKey = current.key;
            if (closedSet.has(currentKey) || current.g > gScore.get(currentKey)) continue;
            iterations++;

            if (currentKey === endKey) {
                // Reconstruct path
                const path = [];
                let node = currentKey;
                while (node) {
                    const [q, r] = node.split(',').map(Number);
                    path.unshift({ q, r });
                    node = cameFrom.get(node);
                }
                return path;
            }

            closedSet.add(currentKey);
            const [cq, cr] = currentKey.split(',').map(Number);

            const neighbors = Hex.neighbors(cq, cr);
            for (const n of neighbors) {
                const nq = Hex.wrapQ(n.q, mapWidth);
                const nr = n.r;

                // Bounds check (r does not wrap)
                if (nr < 0 || nr >= mapHeight) continue;

                const nKey = `${nq},${nr}`;

                // Skip if already explored
                if (closedSet.has(nKey)) continue;

                if (!isPassable(nq, nr)) continue;

                // Use actual movement cost if provided, otherwise default to 1
                const moveCost = getCost ? getCost(nq, nr) : 1;
                const tentG = current.g + moveCost;

                if (tentG < (gScore.has(nKey) ? gScore.get(nKey) : Infinity)) {
                    cameFrom.set(nKey, currentKey);
                    gScore.set(nKey, tentG);
                    const nF = tentG + Hex.wrappingDistance(nq, nr, wrappedEnd.q, wrappedEnd.r, mapWidth);
                    openSet.push({ key: nKey, f: nF, g: tentG });
                }
            }
        }

        const elapsed = performance.now() - startTime;
        console.warn(`[PATHFIND] FAILED after ${iterations} iterations, ${elapsed.toFixed(2)}ms`);
        return null; // No path found
    }
};

// ============================================
// MIN-HEAP — Priority queue for A* pathfinding
// ============================================

export class MinHeap {
    constructor(compareFn) {
        this.heap = [];
        this.compare = compareFn; // (a, b) => true if a has higher priority than b
    }

    size() {
        return this.heap.length;
    }

    push(item) {
        this.heap.push(item);
        this._bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        if (this.heap.length === 1) return this.heap.pop();

        const top = this.heap[0];
        this.heap[0] = this.heap.pop();
        this._bubbleDown(0);
        return top;
    }

    _bubbleUp(index) {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (!this.compare(this.heap[index], this.heap[parentIndex])) break;

            [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
            index = parentIndex;
        }
    }

    _bubbleDown(index) {
        while (true) {
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;
            let smallest = index;

            if (leftChild < this.heap.length && this.compare(this.heap[leftChild], this.heap[smallest])) {
                smallest = leftChild;
            }
            if (rightChild < this.heap.length && this.compare(this.heap[rightChild], this.heap[smallest])) {
                smallest = rightChild;
            }

            if (smallest === index) break;

            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }
}
