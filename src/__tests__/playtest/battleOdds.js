// The same battle settled two ways, over many seeds: FieldBattle.auto (the
// phased battle on its default stances) and the battlefield fought out with
// both sides in the captains' hands (Battlefield.fightOut). Used by
// battlefieldBalance.test.js to hold their odds together.
import { Utils } from '../../core/utils.js';
import { FieldBattle } from '../../player/fieldBattle.js';
import { Battlefield } from '../../player/battlefield.js';

export function makeWorld() {
    const tiles = new Map();
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) tiles.set(key, { q, r, terrain: { id: 'plains', passable: true }, settlement: null });
        return tiles.get(key);
    };
    return { width: 60, height: 60, day: 10, events: [], units: [], kingdoms: [], getTile, getKingdom: () => null };
}

export function makePlayer(spec) {
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

/** One seed's battle settled both ways: { auto, field } (true = the player won). */
export function both(m, seed) {
    const enemy = { strength: m.enemy, name: 'Brigands', type: 'raider', composition: m.comp, purse: null };
    Utils.setSeed(seed);
    let world = makeWorld();
    let player = makePlayer(m.army);
    const b1 = FieldBattle.start(player, enemy, world, { terrainId: 'plains' });
    const auto = !!FieldBattle.auto(player, b1, world).victory;
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
