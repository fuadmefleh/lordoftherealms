// Herald cries name realms as a sentence does: "the Kingdom of Valdoria",
// capitalised at the head of a sentence, bare names left alone.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Heralds } from '../systems/heralds.js';

const world = { day: 10 };
const st = () => ({ nextId: 1, list: [], stats: { proclaimed: 0 } });

describe('herald cries name realms properly', () => {
    afterEach(() => vi.restoreAllMocks());

    it('gives a styled realm "the" inside a sentence and capitalises it at the head', () => {
        vi.spyOn(Heralds, 'data').mockReturnValue({ templates: {
            t1: ['Hear ye! {head} calls the faithful against {target}!'],
            t2: ['{kingdom} and {other} have made peace.'],
        } });
        const a = Heralds._proclaim(st(), world, 't1', { head: 'Pontiff Clement IV', target: 'Kingdom of Valdoria' }, null);
        expect(a.text).toBe('Hear ye! Pontiff Clement IV calls the faithful against the Kingdom of Valdoria!');
        const b = Heralds._proclaim(st(), world, 't2', { kingdom: 'Kingdom of Valdoria', other: 'Westmarch' }, null);
        expect(b.text).toBe('The Kingdom of Valdoria and Westmarch have made peace.');
    });
});
