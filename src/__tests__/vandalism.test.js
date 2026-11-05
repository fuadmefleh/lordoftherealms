// Smashing the town's things (systems/streetCrime.js 'vandalism',
// ui/innerMapReactions.js onVandalism): the street sees it, the watch comes
// for you, and it is paid for with a fine or the cells. Only the town's
// things (not a tree in the wild, nor your own home), and once a thing a day.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapReactions } from '../ui/innerMapReactions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const towns = { '5,5': { q: 5, r: 5, settlement: { name: 'Ashford', kingdom: 'k1', type: 'town' } } };
function makeGame() {
    const notes = [];
    const world = {
        day: 10, width: 20, height: 20, generationParams: { seed: 7 },
        kingdoms: [{ id: 'k1', name: 'Kelmar' }],
        getTile: (q, r) => towns[`${q},${r}`] || null,
        getSettlementViews: () => [],
    };
    const player = { name: 'Aric', gold: 500, karma: 0, renown: 10, reputation: { k1: 0 }, skills: { stealth: 1 }, q: 5, r: 5 };
    return { world, player, notes, ui: { showNotification: (...a) => notes.push(a) } };
}

let _id = 1000;
const npc = (name, type, q, r) => ({ id: _id++, name, type, q, r, state: 'idle', personalityTraits: [] });

function street(npcs) {
    const tiles = [];
    for (let r = 0; r < 20; r++) {
        tiles[r] = [];
        for (let q = 0; q < 20; q++) tiles[r][q] = { q, r, subTerrain: { id: 'grass', passable: true }, _townCore: q < 15 };
    }
    InnerMap.active = true;
    InnerMap._insideBuilding = null;
    InnerMap.tiles = tiles;
    InnerMap.width = InnerMap.height = 20;
    InnerMap.npcs = npcs;
    InnerMap.currentWorldTile = { q: 5, r: 5 };
    InnerMap._currentWorldTileRef = towns['5,5'];
}

beforeEach(() => { InnerMapReactions._vandalised = new Set(); InnerMapReactions.reset && InnerMapReactions.reset(); });

describe('vandalism', () => {
    it('is a crime of the street: recorded, and paid for with a fine or the cells', () => {
        const g = makeGame();
        const guard = npc('Brom', 'guard', 6, 6);
        const res = StreetCrime.record(g.player, g.world, {
            crime: 'vandalism', victim: { id: 'thing:1', name: 'the well', type: 'property' },
            witnesses: StreetCrime.selectWitnesses([guard], { q: 5, r: 5 }, { id: 'thing:1' }), q: 5, r: 5, scene: { q: 5, r: 5 },
        });
        expect(res.incident.k).toBe('vandalism');
        const fine = StreetCrime.fineFor(g.player, g.world, res.incident);
        expect(fine).toBeGreaterThan(0);
        expect(StreetCrime.watchView(g.player, g.world, res.incident.id).stats[0]).toMatch(/Damage to the well/);
        const paid = StreetCrime.answerWatch(g.player, g.world, res.incident.id, 'fine');
        expect(paid.outcome).toBe('fined');
        expect(g.player.gold).toBe(500 - fine);
    });

    it('a guard who sees you smash the town’s well comes to arrest you', () => {
        const g = makeGame();
        const guard = npc('Brom', 'guard', 7, 5);
        const baker = npc('Hilda', 'villager', 4, 6);
        street([guard, baker]);
        const out = InnerMapReactions.onVandalism(g, 5, 5, 'tp_well');
        expect(out).toBeTruthy();
        expect(out.incident.k).toBe('vandalism');
        expect(out.witnesses.find(w => w.npc === guard).react.act).toBe('arrest');
        expect(InnerMapReactions._responders.get(guard.id).mode).toBe('arrest');
        expect(g.notes.some(n => /saw you smashing the /.test(n[1]) && /watch is coming/.test(n[1]))).toBe(true);
        // The same thing again: no second incident
        expect(InnerMapReactions.onVandalism(g, 5, 5, 'tp_well')).toBeNull();
    });

    it('not out in the wild, nor in your own home', () => {
        const g = makeGame();
        street([npc('Brom', 'guard', 7, 5)]);
        // Beyond the town's edge: a wild tree
        expect(InnerMapReactions.onVandalism(g, 18, 5, 'large_tree_1')).toBeNull();
        // A wild hex has no town at all
        InnerMap._currentWorldTileRef = { q: 9, r: 9 };
        expect(InnerMapReactions.onVandalism(g, 5, 5, 'tp_well')).toBeNull();
        // Your own house
        street([]);
        InnerMap._insideBuilding = { type: 'house', name: 'House (Yours)', q: 2, r: 2, isPlayerOwned: true };
        expect(InnerMapReactions.onVandalism(g, 3, 3, 'chest')).toBeNull();
        InnerMap._insideBuilding = null;
    });
});
