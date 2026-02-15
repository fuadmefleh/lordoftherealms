// ============================================
// HEX — Hex grid coordinate system & math
// Uses axial coordinates (q, r) with cube helpers
// Pointy-top hexagons
// ============================================

const Hex = {
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
     * Distance between two hexes (axial)
     */
    distance(q1, r1, q2, r2) {
        const c1 = Hex.axialToCube(q1, r1);
        const c2 = Hex.axialToCube(q2, r2);
        return Math.max(
            Math.abs(c1.x - c2.x),
            Math.abs(c1.y - c2.y),
            Math.abs(c1.z - c2.z)
        );
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
    findPath(startQ, startR, endQ, endR, mapWidth, mapHeight, isPassable) {
        const startTime = performance.now();
        console.log(`[PATHFIND] Start: (${startQ},${startR}) -> (${endQ},${endR})`);

        // Wrap the end coordinate
        const wrappedEnd = { q: Hex.wrapQ(endQ, mapWidth), r: endR };

        if (!isPassable(wrappedEnd.q, wrappedEnd.r)) {
            console.log('[PATHFIND] Target not passable');
            return null;
        }

        // Quick distance check - reject paths that are too far
        const estimatedDistance = Hex.wrappingDistance(startQ, startR, wrappedEnd.q, wrappedEnd.r, mapWidth);
        console.log(`[PATHFIND] Estimated distance: ${estimatedDistance}`);

        if (estimatedDistance > 50) {
            console.warn('Path too far, distance:', estimatedDistance);
            return null; // Too far, don't even try
        }

        const startKey = `${startQ},${startR}`;
        const endKey = `${wrappedEnd.q},${wrappedEnd.r}`;

        // Priority queue (min-heap) for efficient lowest-fScore retrieval
        const openSet = new MinHeap((a, b) => a.f < b.f);
        const openSetKeys = new Set([startKey]); // Track what's in the heap
        const closedSet = new Set(); // Track explored nodes
        const cameFrom = new Map();
        const gScore = new Map();

        gScore.set(startKey, 0);
        openSet.push({ key: startKey, f: estimatedDistance });

        let iterations = 0;
        const maxIterations = 1000; // Strict limit to prevent freezing

        while (openSet.size() > 0 && iterations < maxIterations) {
            iterations++;

            // Get node with lowest fScore (O(log n) instead of O(n))
            const current = openSet.pop();
            const currentKey = current.key;
            openSetKeys.delete(currentKey);

            if (currentKey === endKey) {
                // Reconstruct path
                const path = [];
                let node = currentKey;
                while (node) {
                    const [q, r] = node.split(',').map(Number);
                    path.unshift({ q, r });
                    node = cameFrom.get(node);
                }
                const elapsed = performance.now() - startTime;
                console.log(`[PATHFIND] SUCCESS in ${iterations} iterations, ${path.length} steps, ${elapsed.toFixed(2)}ms`);
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

                const tentG = (gScore.get(currentKey) || 0) + 1; // uniform cost for now

                if (tentG < (gScore.get(nKey) || Infinity)) {
                    cameFrom.set(nKey, currentKey);
                    gScore.set(nKey, tentG);
                    const nF = tentG + Hex.wrappingDistance(nq, nr, wrappedEnd.q, wrappedEnd.r, mapWidth);

                    if (!openSetKeys.has(nKey)) {
                        openSet.push({ key: nKey, f: nF });
                        openSetKeys.add(nKey);
                    }
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

class MinHeap {
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
};
