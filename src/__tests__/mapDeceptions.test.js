// Doctored and propaganda maps plant falsehoods you believe until you see the land.

import { describe, it, expect } from 'vitest';
import { Utils } from '../core/utils.js';
import { Cartography } from '../systems/cartography.js';
import { KingdomStability } from '../world/kingdomState.js';

function makeWorld() {
    const tiles = new Map();
    return {
        width: 30, height: 30, day: 5,
        getKingdom: (id) => ({ id, name: 'Varn' }),
        getTile(q, r) {
            if (r < 0 || r >= 30) return null;
            const key = `${q},${r}`;
            if (!tiles.has(key)) tiles.set(key, { q, r, terrain: { id: 'grassland', passable: true }, explored: false, visible: false });
            return tiles.get(key);
        },
    };
}

const doctored = () => ({
    name: 'Old Survey', createdBy: 'A Stranger', type: 'regional', centerQ: 5, centerR: 5, radius: 0, accuracy: 0.6,
    deliberateErrors: [
        { q: 6, r: 6, type: 'settlement', false_settlement: 'Phantom Town' },
        { q: 7, r: 7, type: 'path', false_road: true },
    ],
});

describe('Map deceptions', () => {
    it('reading a doctored map plants its lies on unseen hexes', () => {
        const world = makeWorld();
        const player = { name: 'Me', skills: { cartography: 1 } };
        const res = Cartography.applyMap(player, doctored(), world);
        expect(res.deceptionsPlanted).toBe(2);
        expect(Cartography.getDeception(player, 6, 6).false_settlement).toBe('Phantom Town');
        expect(Cartography.describeDeception(Cartography.getDeception(player, 6, 6), world)).toContain('Phantom Town');
    });

    it('a lie is exposed once you see its hex', () => {
        const world = makeWorld();
        const player = { name: 'Me', skills: { cartography: 1 } };
        Cartography.applyMap(player, doctored(), world);
        world.getTile(6, 6).visible = true;
        const exposed = Cartography.exposeDeceptions(player, world);
        expect(exposed.map(d => d.type)).toEqual(['settlement']);
        expect(Cartography.getDeception(player, 6, 6)).toBeNull();
        expect(Cartography.getDeception(player, 7, 7)).toBeTruthy();
    });

    it('you are not fooled about what you can see, by your own maps, or once you have detected the alterations', () => {
        const world = makeWorld();
        world.getTile(6, 6).visible = true;
        const player = { name: 'Me', skills: { cartography: 1 } };
        expect(Cartography.applyMap(player, doctored(), world).deceptionsPlanted).toBe(1);
        const own = { ...doctored(), createdBy: 'Me' };
        expect(Cartography.applyMap({ name: 'Me', skills: {} }, own, world).deceptionsPlanted).toBe(0);
        expect(Cartography.applyMap({ name: 'Me', skills: {} }, doctored(), world, { detected: true }).deceptionsPlanted).toBe(0);
    });

    it('a master cartographer spots most alterations', () => {
        Utils.setSeed(4);
        let spotted = 0;
        for (let i = 0; i < 50; i++) {
            spotted += Cartography.applyMap({ name: 'Me', skills: { cartography: 10 } }, doctored(), makeWorld()).deceptionsSpotted;
        }
        expect(spotted).toBeGreaterThan(60);
    });

    it('wartime propaganda rallies a kingdom', () => {
        const k = { id: 'k', wars: ['x'], treasury: 100, cartography: { propagandaMaps: [{}, {}] } };
        const plain = { ...k, cartography: { propagandaMaps: [] } };
        const world = { day: 1, activeEvents: [], kingdoms: [], getKingdom: () => null };
        expect(KingdomStability.target(k, world).value).toBeCloseTo(KingdomStability.target(plain, world).value + 4);
        expect(KingdomStability.target(k, world).parts.some(p => p.label === 'Propaganda' || p[0] === 'Propaganda' || String(JSON.stringify(p)).includes('Propaganda'))).toBe(true);
    });
});
