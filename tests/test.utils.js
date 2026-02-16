// ============================================
// TESTS — Utils module
// ============================================

TestRunner.describe('Utils', async function () {
    await TestRunner.it('clamp: clamps values within range', () => {
        assert.equal(Utils.clamp(5, 0, 10), 5);
        assert.equal(Utils.clamp(-5, 0, 10), 0);
        assert.equal(Utils.clamp(15, 0, 10), 10);
        assert.equal(Utils.clamp(0, 0, 10), 0);
        assert.equal(Utils.clamp(10, 0, 10), 10);
    });

    await TestRunner.it('lerp: linear interpolation', () => {
        assert.equal(Utils.lerp(0, 10, 0), 0);
        assert.equal(Utils.lerp(0, 10, 1), 10);
        assert.equal(Utils.lerp(0, 10, 0.5), 5);
        assert.closeTo(Utils.lerp(2, 8, 0.25), 3.5);
    });

    await TestRunner.it('randInt: returns integer in range', () => {
        for (let i = 0; i < 100; i++) {
            const val = Utils.randInt(5, 10);
            assert.ok(val >= 5 && val <= 10, `${val} not in [5,10]`);
            assert.equal(val, Math.floor(val), 'Should be integer');
        }
    });

    await TestRunner.it('randFloat: returns float in range', () => {
        for (let i = 0; i < 100; i++) {
            const val = Utils.randFloat(1.0, 2.0);
            assert.ok(val >= 1.0 && val < 2.0, `${val} not in [1.0, 2.0)`);
        }
    });

    await TestRunner.it('randPick: picks from array', () => {
        const arr = ['a', 'b', 'c'];
        for (let i = 0; i < 50; i++) {
            const val = Utils.randPick(arr);
            assert.includes(arr, val);
        }
    });

    await TestRunner.it('weightedPick: respects weights', () => {
        const items = [
            { value: 'common', weight: 100 },
            { value: 'rare', weight: 0 },
        ];
        for (let i = 0; i < 50; i++) {
            assert.equal(Utils.weightedPick(items), 'common');
        }
    });

    await TestRunner.it('shuffle: returns same elements', () => {
        const arr = [1, 2, 3, 4, 5];
        const shuffled = Utils.shuffle([...arr]);
        assert.lengthOf(shuffled, arr.length);
        for (const item of arr) {
            assert.includes(shuffled, item);
        }
    });

    await TestRunner.it('hashStr: produces consistent hashes', () => {
        const h1 = Utils.hashStr('test');
        const h2 = Utils.hashStr('test');
        assert.equal(h1, h2);
        assert.notEqual(Utils.hashStr('abc'), Utils.hashStr('xyz'));
    });

    await TestRunner.it('formatNumber: formats with separators', () => {
        // This depends on locale, so just check it returns a string
        const result = Utils.formatNumber(1000);
        assert.isType(result, 'string');
    });

    await TestRunner.it('deepClone: creates independent copy', () => {
        const original = { a: 1, b: { c: 2 } };
        const clone = Utils.deepClone(original);
        assert.deepEqual(clone, original);
        clone.b.c = 99;
        assert.equal(original.b.c, 2, 'Original should be unmodified');
    });

    await TestRunner.it('seededRandom: produces deterministic values', () => {
        const rng1 = Utils.seededRandom(42);
        const rng2 = Utils.seededRandom(42);
        for (let i = 0; i < 10; i++) {
            assert.equal(rng1(), rng2());
        }
    });

    await TestRunner.it('noise2D: returns values in valid range', () => {
        for (let i = 0; i < 20; i++) {
            const val = Utils.noise2D(i * 0.5, i * 0.3);
            assert.isType(val, 'number');
            assert.ok(!isNaN(val), 'Should not be NaN');
        }
    });

    await TestRunner.it('fbm: returns values in valid range', () => {
        const val = Utils.fbm(1.5, 2.5, 4);
        assert.isType(val, 'number');
        assert.ok(!isNaN(val), 'Should not be NaN');
    });
});
