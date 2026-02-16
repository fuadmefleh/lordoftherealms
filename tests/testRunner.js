// ============================================
// TEST RUNNER — Lightweight test framework
// ============================================

const TestRunner = {
    suites: [],
    results: {
        passed: 0,
        failed: 0,
        skipped: 0,
        errors: [],
    },

    /**
     * Register a test suite
     * @param {string} name - Suite name
     * @param {Function} fn - Function containing test definitions
     */
    describe(name, fn) {
        this.suites.push({ name, fn });
    },

    /**
     * Run all registered test suites
     * @returns {Object} Test results
     */
    async runAll() {
        this.results = { passed: 0, failed: 0, skipped: 0, errors: [] };
        const startTime = performance.now();

        for (const suite of this.suites) {
            console.log(`\n📋 Suite: ${suite.name}`);
            try {
                await suite.fn();
            } catch (error) {
                console.error(`  ❌ Suite "${suite.name}" threw: ${error.message}`);
                this.results.errors.push({
                    suite: suite.name,
                    test: '(suite setup)',
                    error: error.message,
                    stack: error.stack,
                });
                this.results.failed++;
            }
        }

        const elapsed = (performance.now() - startTime).toFixed(1);
        const total = this.results.passed + this.results.failed + this.results.skipped;

        console.log('\n' + '='.repeat(50));
        console.log(`Tests: ${total} total`);
        console.log(`  ✅ Passed:  ${this.results.passed}`);
        console.log(`  ❌ Failed:  ${this.results.failed}`);
        console.log(`  ⏭️  Skipped: ${this.results.skipped}`);
        console.log(`  ⏱️  Time:    ${elapsed}ms`);
        console.log('='.repeat(50));

        if (this.results.errors.length > 0) {
            console.log('\n❌ Failures:');
            for (const err of this.results.errors) {
                console.log(`  ${err.suite} > ${err.test}`);
                console.log(`    ${err.error}`);
            }
        }

        return this.results;
    },

    /**
     * Run a single test
     * @param {string} name - Test name
     * @param {Function} fn - Test function
     */
    async it(name, fn) {
        try {
            await fn();
            console.log(`  ✅ ${name}`);
            this.results.passed++;
        } catch (error) {
            console.log(`  ❌ ${name}: ${error.message}`);
            this.results.errors.push({
                suite: this._currentSuite || 'unknown',
                test: name,
                error: error.message,
                stack: error.stack,
            });
            this.results.failed++;
        }
    },

    /**
     * Skip a test
     * @param {string} name - Test name
     */
    skip(name) {
        console.log(`  ⏭️  ${name} (skipped)`);
        this.results.skipped++;
    },
};

// ── Assertion helpers ──

const assert = {
    equal(actual, expected, msg = '') {
        if (actual !== expected) {
            throw new Error(
                `${msg ? msg + ': ' : ''}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
            );
        }
    },

    deepEqual(actual, expected, msg = '') {
        const a = JSON.stringify(actual);
        const b = JSON.stringify(expected);
        if (a !== b) {
            throw new Error(`${msg ? msg + ': ' : ''}Objects not deep equal\n  Expected: ${b}\n  Actual:   ${a}`);
        }
    },

    notEqual(actual, expected, msg = '') {
        if (actual === expected) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected values to differ, both are ${JSON.stringify(actual)}`);
        }
    },

    ok(value, msg = '') {
        if (!value) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected truthy value, got ${JSON.stringify(value)}`);
        }
    },

    notOk(value, msg = '') {
        if (value) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected falsy value, got ${JSON.stringify(value)}`);
        }
    },

    throws(fn, msg = '') {
        let threw = false;
        try {
            fn();
        } catch (e) {
            threw = true;
        }
        if (!threw) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected function to throw`);
        }
    },

    isType(value, type, msg = '') {
        if (typeof value !== type) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected type "${type}", got "${typeof value}"`);
        }
    },

    isArray(value, msg = '') {
        if (!Array.isArray(value)) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected array, got ${typeof value}`);
        }
    },

    hasProperty(obj, prop, msg = '') {
        if (!(prop in obj)) {
            throw new Error(`${msg ? msg + ': ' : ''}Object missing property "${prop}"`);
        }
    },

    greaterThan(actual, expected, msg = '') {
        if (actual <= expected) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected ${actual} > ${expected}`);
        }
    },

    lessThan(actual, expected, msg = '') {
        if (actual >= expected) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected ${actual} < ${expected}`);
        }
    },

    includes(arr, item, msg = '') {
        if (!arr.includes(item)) {
            throw new Error(`${msg ? msg + ': ' : ''}Array does not include ${JSON.stringify(item)}`);
        }
    },

    lengthOf(arr, length, msg = '') {
        if (arr.length !== length) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected length ${length}, got ${arr.length}`);
        }
    },

    closeTo(actual, expected, delta = 0.001, msg = '') {
        if (Math.abs(actual - expected) > delta) {
            throw new Error(`${msg ? msg + ': ' : ''}Expected ${actual} to be within ${delta} of ${expected}`);
        }
    },
};
