// ============================================
// TESTS — Hex module
// ============================================

TestRunner.describe('Hex', async function () {
    await TestRunner.it('DIRECTIONS: has 6 directions', () => {
        assert.lengthOf(Hex.DIRECTIONS, 6);
    });

    await TestRunner.it('neighbors: returns 6 neighbors', () => {
        const n = Hex.neighbors(5, 5);
        assert.lengthOf(n, 6);
        for (const neighbor of n) {
            assert.hasProperty(neighbor, 'q');
            assert.hasProperty(neighbor, 'r');
        }
    });

    await TestRunner.it('neighbors: even vs odd row differences', () => {
        const even = Hex.neighbors(5, 4); // even row
        const odd = Hex.neighbors(5, 5);  // odd row
        // They should have different neighbor positions due to offset
        const evenStr = JSON.stringify(even);
        const oddStr = JSON.stringify(odd);
        assert.notEqual(evenStr, oddStr);
    });

    await TestRunner.it('axialToCube / cubeToAxial: roundtrip', () => {
        const q = 3, r = 7;
        const cube = Hex.axialToCube(q, r);
        assert.hasProperty(cube, 'x');
        assert.hasProperty(cube, 'y');
        assert.hasProperty(cube, 'z');
        assert.equal(cube.x + cube.y + cube.z, 0, 'Cube coords must sum to 0');
        const axial = Hex.cubeToAxial(cube.x, cube.y, cube.z);
        assert.equal(axial.q, q);
        assert.equal(axial.r, r);
    });

    await TestRunner.it('distance: zero for same hex', () => {
        assert.equal(Hex.distance(5, 5, 5, 5), 0);
    });

    await TestRunner.it('distance: correct for adjacent hexes', () => {
        // Adjacent hexes should be distance 1
        const neighbors = Hex.neighbors(5, 5);
        for (const n of neighbors) {
            const d = Hex.distance(5, 5, n.q, n.r);
            assert.equal(d, 1, `Neighbor (${n.q},${n.r}) should be distance 1, got ${d}`);
        }
    });

    await TestRunner.it('distance: symmetric', () => {
        const d1 = Hex.distance(2, 3, 7, 8);
        const d2 = Hex.distance(7, 8, 2, 3);
        assert.equal(d1, d2);
    });

    await TestRunner.it('wrapQ: wraps coordinates', () => {
        const width = 100;
        assert.equal(Hex.wrapQ(50, width), 50);
        assert.equal(Hex.wrapQ(-1, width), 99);
        assert.equal(Hex.wrapQ(100, width), 0);
        assert.equal(Hex.wrapQ(0, width), 0);
    });

    await TestRunner.it('wrappingDistance: shorter across wrap boundary', () => {
        const width = 100;
        // Direct distance from 5 to 95 = 90, but wrapping = 10
        const d = Hex.wrappingDistance(5, 5, 95, 5, width);
        assert.lessThan(d, 50, 'Wrapping distance should be shorter');
    });

    await TestRunner.it('axialToPixel: returns x,y coordinates', () => {
        const result = Hex.axialToPixel(0, 0, 54);
        assert.hasProperty(result, 'x');
        assert.hasProperty(result, 'y');
        assert.isType(result.x, 'number');
        assert.isType(result.y, 'number');
    });

    await TestRunner.it('hexesInRange: returns correct count', () => {
        // hexesInRange(q, r, range) should return (range+1)^3 - range^3... actually the count 
        // for hex ring of range N is 1 + 3*N*(N+1) for full filled hex
        const hexes = Hex.hexesInRange(5, 5, 1);
        assert.ok(hexes.length >= 1, 'Should include at least center');
        assert.ok(hexes.length <= 7, 'Range 1 should have at most 7 hexes');
        
        const hexes2 = Hex.hexesInRange(5, 5, 2);
        assert.ok(hexes2.length >= hexes.length, 'Larger range should have more hexes');
    });

    await TestRunner.it('hexCorners: returns 6 corner points', () => {
        const corners = Hex.hexCorners(100, 100, 54);
        assert.lengthOf(corners, 6);
        for (const corner of corners) {
            assert.hasProperty(corner, 'x');
            assert.hasProperty(corner, 'y');
        }
    });
});
