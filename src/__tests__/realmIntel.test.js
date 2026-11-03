// Who may read a realm's private books (systems/realmIntel.js), and the
// panels that show them: rulers, the realm's officers by office, royal kin,
// mint lessees and spies placed in the realm see the figures; everyone else
// hears the street's word, and nothing at all of a realm they know nothing of.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { RealmIntel } from '../systems/realmIntel.js';
import { loadData, newGame } from './playtest/harness.js';

let ActionMenu;
beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

function world2() {
    const tiles = new Map([['3,3', { settlement: { kingdom: 'k1', name: 'Varrholt' } }]]);
    const kingdoms = [{ id: 'k1', name: 'Varr', isAlive: true }, { id: 'k2', name: 'Osk', isAlive: true }];
    return {
        day: 10, kingdoms,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
    };
}

describe('who may read a realm\'s books', () => {
    it('a commoner reads nothing; the ruler reads everything of their own realm only', () => {
        const world = world2();
        const player = { id: 'p' };
        for (const kind of RealmIntel.KINDS) expect(RealmIntel.can(player, world, 'k1', kind)).toBe(false);
        player.throne = { ruling: { kingdomId: 'k1' } };
        for (const kind of RealmIntel.KINDS) expect(RealmIntel.why(player, world, 'k1', kind)).toBe('ruler');
        expect(RealmIntel.can(player, world, 'k2', 'books')).toBe(false);
        world.kingdoms[0].isAlive = false; // a fallen crown rules nothing
        expect(RealmIntel.can(player, world, 'k1', 'books')).toBe(false);
    });

    it('an office opens what it touches, and only at the court you are sworn to', () => {
        const world = world2();
        const player = { id: 'p', allegiance: 'k1', currentTitle: 'tax_collector' };
        expect(RealmIntel.can(player, world, 'k1', 'books')).toBe(true);
        expect(RealmIntel.can(player, world, 'k1', 'mint')).toBe(true);
        expect(RealmIntel.can(player, world, 'k1', 'military')).toBe(false);
        expect(RealmIntel.can(player, world, 'k1', 'court')).toBe(true);
        expect(RealmIntel.can(player, world, 'k2', 'books')).toBe(false);
        player.currentTitle = 'marshal';
        expect(RealmIntel.can(player, world, 'k1', 'military')).toBe(true);
        expect(RealmIntel.can(player, world, 'k1', 'books')).toBe(false);
        player.currentTitle = 'spymaster';
        for (const kind of RealmIntel.KINDS) expect(RealmIntel.can(player, world, 'k1', kind)).toBe(true);
        // Sworn but holding no office: a citizen, not an officer
        const citizen = { id: 'c', allegiance: 'k1', kingdomTitle: 'citizen' };
        expect(RealmIntel.can(citizen, world, 'k1', 'court')).toBe(false);
    });

    it('a spy placed in the realm or sent against it opens everything; a mint lease opens its mint', () => {
        const world = world2();
        const player = { id: 'p', espionage: { spies: [{ location: { q: 3, r: 3 } }], activeMissions: [] } };
        expect(RealmIntel.why(player, world, 'k1', 'books')).toBe('spy');
        expect(RealmIntel.can(player, world, 'k2', 'books')).toBe(false);
        player.espionage.activeMissions.push({ targetKingdom: 'k2' });
        expect(RealmIntel.can(player, world, 'k2', 'military')).toBe(true);
        const lessee = { id: 'l', mints: { lease: { kingdomId: 'k2' } } };
        expect(RealmIntel.why(lessee, world, 'k2', 'mint')).toBe('lease');
        expect(RealmIntel.can(lessee, world, 'k2', 'books')).toBe(false);
    });

    it('a child wed to a royal opens the court, not the books', () => {
        const world = world2();
        const player = { id: 'p', children: [{ isAlive: true, upbringing: { spouse: { kind: 'royal', kingdomId: 'k1' } } }] };
        expect(RealmIntel.why(player, world, 'k1', 'court')).toBe('kin');
        expect(RealmIntel.can(player, world, 'k1', 'books')).toBe(false);
    });

    it('turns a figure into the street\'s word, with a rough floor for rankings', () => {
        expect(RealmIntel.band('treasury', 300)).toBe('an empty chest');
        expect(RealmIntel.band('treasury', 1200)).toBe('lean coffers');
        expect(RealmIntel.band('treasury', 90000)).toBe('overflowing coffers');
        expect(RealmIntel.band('military', 250)).toBe('a strong army');
        expect(RealmIntel.estimate('treasury', 9000)).toBe(8000);
        expect(RealmIntel.estimate('treasury', 10)).toBe(0);
        const world = world2();
        const commoner = { id: 'p' };
        expect(RealmIntel.seen(commoner, world, 'k1', 'books', 'treasury', 9000, true)).toEqual({ value: 8000, text: 'a rich treasury', exact: false });
        expect(RealmIntel.seen(commoner, world, 'k1', 'books', 'treasury', 9000, false)).toEqual({ value: null, text: 'unknown', exact: false });
        const ruler = { id: 'r', throne: { ruling: { kingdomId: 'k1' } } };
        expect(RealmIntel.seen(ruler, world, 'k1', 'books', 'treasury', 9000, false)).toMatchObject({ value: 9000, exact: true });
    });
});

describe('the Crown\'s Treasury panel', () => {
    function show(game) {
        let shown = null;
        game.ui = { showCustomPanel: vi.fn((t, h) => { shown = h; }), showNotification: vi.fn(), setPanelNav: vi.fn() };
        ActionMenu.showTreasury(game, 'budget');
        return shown;
    }

    it('shows a commoner the posted taxes and a rumour; an officer of the realm reads the books', () => {
        const game = newGame(503);
        const { player, world } = game;
        // Stand in a town of a living realm
        const town = world.getSettlementViews().find(s => s.kingdom && world.getKingdom(s.kingdom) && world.getKingdom(s.kingdom).isAlive);
        player.q = town.q;
        player.r = town.r;
        const k = world.getKingdom(town.kingdom);
        k.treasury = 4321;
        player.learnAboutKingdom(k.id, ['economy']);
        let html = show(game);
        expect(html).toContain('Posted taxes');
        expect(html).toContain('comfortable coffers');
        expect(html).not.toContain('4,321');
        expect(html).toContain('🔒');

        player.allegiance = k.id;
        player.currentTitle = 'tax_collector';
        html = show(game);
        expect(html).toContain('4,321');
        expect(html).toContain('🔓');
    }, 120000);
});
