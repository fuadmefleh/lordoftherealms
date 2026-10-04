// Every terrain an indigenous tribe lives on must be a real terrain id —
// tribes are seeded by matching tile.terrain.id, so a typo'd id silently
// means that tribe never appears there.

import { describe, it, expect } from 'vitest';
import terrainData from '../../data/terrain.json';
import colonizationData from '../../data/colonization.json';

describe('indigenous tribe terrains', () => {
    const ids = new Set(Object.entries(terrainData.types).map(([k, v]) => v.id || k));

    for (const tribe of colonizationData.indigenousTribes) {
        it(`${tribe.id} lists only real terrain ids`, () => {
            expect(tribe.terrains.filter(t => !ids.has(t))).toEqual([]);
        });
    }
});
