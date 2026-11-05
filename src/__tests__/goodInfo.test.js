/**
 * A good's "i" (ui/goodInfo.js): every good has a description to read, and the
 * card says what it is worth, what it is made from and what it goes into.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { goodInfo, goodInfoIcon, goodUses } from '../ui/goodInfo.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

describe('what a good is', () => {
    it('every good has a description', () => {
        const missing = Object.values(PlayerEconomy.GOODS).filter(g => !g.description).map(g => g.id);
        expect(missing).toEqual([]);
    });

    it('the card: its description, its worth, what it comes from and goes into', () => {
        const card = goodInfo('flour');
        expect(card.title).toMatch(/Flour/);
        expect(card.value).toMatch(/mill/i);
        expect(card.rows[0][1]).toMatch(/g each/);
        const { from, into } = goodUses('flour');
        expect(from.some(t => /Grain/.test(t))).toBe(true);
        expect(into.some(t => /Bread/.test(t))).toBe(true);
        expect(card.notes.some(n => /^Made from/.test(n))).toBe(true);
        expect(card.notes.some(n => /^Used to make/.test(n))).toBe(true);
    });

    it('an unknown thing still gets a card', () => {
        expect(goodInfo('mystery_box').title).toMatch(/Mystery Box/);
    });

    it('the i opens its card on hover', () => {
        const html = goodInfoIcon('grain');
        expect(html).toMatch(/data-hover="1"/);
        expect(html).toMatch(/class="why-i good-i"/);
        expect(html).toMatch(/data-why=/);
    });
});
