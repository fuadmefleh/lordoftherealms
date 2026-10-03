// Witnesses to a crime are the bystanders on the inner map near the player.
// The caller passes that scene in; without one, nobody saw anything.

import { describe, it, expect } from 'vitest';
import { Gossip } from '../systems/gossip.js';

const victim = { name: 'Aldric', type: 'farmer' };

describe('Gossip witnesses', () => {
    it('counts nearby NPCs, not the victim or distant ones', () => {
        const scene = {
            q: 10, r: 10,
            npcs: [
                { id: 1, name: 'Aldric', type: 'farmer', q: 10, r: 11 },  // the victim
                { id: 2, name: 'Mira', type: 'merchant', q: 12, r: 9 },   // 2 tiles away
                { id: 3, name: 'Tobin', type: 'guard', q: 30, r: 30 },    // far away
            ],
        };
        const witnesses = Gossip._detectWitnesses(victim, 5, scene);
        expect(witnesses.map(w => w.name)).toEqual(['Mira']);
        expect(witnesses[0].distance).toBe(2);
    });

    it('returns no witnesses (rather than undefined) without a scene', () => {
        expect(Gossip._detectWitnesses(victim, 5)).toEqual([]);
    });
});
