/**
 * The battlefield's odds against the phased battle's (player/battlefield.js
 * vs player/fieldBattle.js): the same battle, drawn up from the same seed,
 * fought out on the field with both sides in the captains' hands and settled
 * by FieldBattle.auto, over many seeds. Their win rates should agree within
 * about ten points across even, lopsided, horse-heavy and archer-heavy
 * matchups — the field is the phased battle fought out, not a different game.
 * (Tuning: data/military.json → battlefield.)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { FieldBattle } from '../player/fieldBattle.js';
import { Battlefield } from '../player/battlefield.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld() {
    const tiles = new Map();
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) tiles.set(key, { q, r, terrain: { id: 'plains', passable: true }, settlement: null });
        return tiles.get(key);
    };
    return { width: 60, height: 60, day: 10, events: [], units: [], kingdoms: [], getTile, getKingdom: () => null };
}

function makePlayer(spec) {
    const army = [];
    for (const [type, n, strength] of spec) {
        for (let i = 0; i < n; i++) army.push({ type, name: `${type}${i}`, strength, level: 1, upkeep: 1, experience: 0 });
    }
    return {
        name: 'Ash', q: 0, r: 0, gold: 0, karma: 0, renown: 0, health: 100, maxHealth: 100, strength: 5, charisma: 5,
        inventory: {}, properties: [], reputation: {}, blessings: {},
        skills: { combat: 1, commerce: 1, leadership: 1, diplomacy: 1, stealth: 1 },
        army, colonies: [],
    };
}

const MIXED = { pikeman: 0.55, archer: 0.3, cavalry: 0.15 };

const MATCHUPS = {
    even: { army: [['soldier', 6, 10], ['archer', 3, 8], ['cavalry', 1, 18]], enemy: 100, comp: MIXED },
    favoured: { army: [['soldier', 6, 10], ['archer', 3, 8], ['cavalry', 1, 18]], enemy: 70, comp: MIXED },
    outnumbered: { army: [['soldier', 6, 10], ['archer', 3, 8], ['cavalry', 1, 18]], enemy: 140, comp: MIXED },
    horseHeavy: { army: [['cavalry', 5, 18], ['soldier', 2, 10]], enemy: 105, comp: MIXED },
    archerHeavy: { army: [['archer', 10, 8], ['soldier', 3, 10]], enemy: 105, comp: MIXED },
};

/** One seed's battle settled both ways: { auto, field } (true = the player won). */
function both(m, seed) {
    const enemy = { strength: m.enemy, name: 'Brigands', type: 'raider', composition: m.comp, purse: null };
    // The phased battle, auto-resolved
    Utils.setSeed(seed);
    let world = makeWorld();
    let player = makePlayer(m.army);
    const b1 = FieldBattle.start(player, enemy, world, { terrainId: 'plains' });
    const auto = !!FieldBattle.auto(player, b1, world).victory;
    // The same battle on the field, both sides the captains'
    Utils.setSeed(seed);
    world = makeWorld();
    player = makePlayer(m.army);
    const b2 = FieldBattle.start(player, enemy, world, { terrainId: 'plains' });
    const bf = Battlefield.create(player, b2, Battlefield.openField(64, 40), { world });
    const over = Battlefield.fightOut(bf);
    return { auto, field: over.winner === 'player' };
}

/** Win rates over `n` seeds: { auto, field }. */
export function rates(m, n = 40, from = 1000) {
    let a = 0, f = 0;
    for (let i = 0; i < n; i++) {
        const r = both(m, from + i * 7);
        if (r.auto) a++;
        if (r.field) f++;
    }
    return { auto: a / n, field: f / n };
}

describe('the field battle and the phased battle give the same odds', () => {
    for (const [name, m] of Object.entries(MATCHUPS)) {
        it(`${name}: win rates within ten points`, () => {
            const r = rates(m);
            console.log(`[battlefield balance] ${name}: auto ${(r.auto * 100).toFixed(0)}% · field ${(r.field * 100).toFixed(0)}%`);
            expect(Math.abs(r.auto - r.field)).toBeLessThanOrEqual(0.1 + 1e-9);
        }, 120000);
    }
});
