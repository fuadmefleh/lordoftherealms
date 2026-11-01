// A royal family's records stay bounded over a long game (world/characters/succession.js
// pruneFamily): every child ever born stayed in characterData.children and
// every birth linked itself to every living sibling, so a century of births
// grew the lists without end (and the sibling links quadratically).
import { describe, it, expect } from 'vitest';
import { Characters } from '../world/characters/index.js';

function family(day) {
    const kid = (id, extra = {}) => ({ id, isAlive: true, siblingIds: [], ...extra });
    const data = {
        ruler: { id: 'ruler' },
        dynasty: { members: ['ruler'] },
        children: [
            kid('long_dead', { isAlive: false, deathDay: day - 1000 }),
            kid('just_dead', { isAlive: false, deathDay: day - 30 }),
            kid('no_day', { isAlive: false }),
            kid('wed_player', { isAlive: false, deathDay: day - 5000, spouseId: 'player' }),
            kid('alive'),
        ],
    };
    data.children.find(c => c.id === 'alive').siblingIds = ['long_dead', 'just_dead', 'no_day', 'wed_player'];
    return data;
}

describe('Characters.pruneFamily', () => {
    it('keeps the living, the newly dead and the player\'s royal spouse; drops the long dead', () => {
        const data = family(2000);
        Characters.pruneFamily(data, 2000);
        expect(data.children.map(c => c.id)).toEqual(['just_dead', 'no_day', 'wed_player', 'alive']);
        // The living forget the dropped
        expect(data.children.find(c => c.id === 'alive').siblingIds).toEqual(['just_dead', 'no_day', 'wed_player']);
        // A death without a day starts its mourning now, and is dropped once it ends
        expect(data.children.find(c => c.id === 'no_day').deathDay).toBe(2000);
        Characters.pruneFamily(data, 2400);
        expect(data.children.map(c => c.id)).toEqual(['wed_player', 'alive']);
    });

    it('caps the dynasty roll, keeping the ruler', () => {
        const data = family(10);
        for (let i = 0; i < 300; i++) data.dynasty.members.push(`m${i}`);
        Characters.pruneFamily(data, 10);
        expect(data.dynasty.members.length).toBe(120);
        expect(data.dynasty.members[0]).toBe('ruler');
        expect(data.dynasty.members[119]).toBe('m299');
    });
});
