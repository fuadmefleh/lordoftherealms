// The laws of the realms (systems/laws.js): old custom until a ruler sets
// them, the ruler's proclamation (cost, stability, a wait), and each law read
// by the game — private prisons (knockout), land for foreigners (lots),
// punishment (street crime).
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Laws } from '../systems/laws.js';
import { Knockout } from '../systems/knockout.js';
import { Lots } from '../systems/lots.js';
import { StreetCrime } from '../systems/streetCrime.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function world(n = 3) {
    const kingdoms = Array.from({ length: n }, (_, i) => ({ id: `k${i}`, name: `Realm ${i}`, ruler: `Ruler ${i}`, treasury: 1000, stability: 60, isAlive: true }));
    return { day: 100, kingdoms, getKingdom: id => kingdoms.find(k => k.id === id) || null, getTile: () => null };
}

describe('Laws of the realms', () => {
    it('every realm keeps a law on each matter by old custom, the same each time', () => {
        const w = world(60);
        const seen = {};
        for (const k of w.kingdoms) for (const { law, option } of Laws.of(w, k.id)) {
            expect(option).toBeTruthy();
            (seen[law.id] = seen[law.id] || new Set()).add(option.id);
            expect(Laws.value(w, k.id, law.id)).toBe(option.id);
        }
        // Realms differ: each law has more than one custom among them
        for (const ids of Object.values(seen)) expect(ids.size).toBeGreaterThan(1);
    });

    it('only the ruler proclaims a law: it costs the treasury and stability, and must wait to change again', () => {
        const w = world();
        const k = w.kingdoms[0];
        const subject = { allegiance: 'k0' };
        expect(Laws.enact(subject, w, 'punishment', 'harsh').success).toBe(false);
        const ruler = { throne: { ruling: { kingdomId: 'k0' } } };
        const target = Laws.value(w, 'k0', 'punishment') === 'harsh' ? 'lenient' : 'harsh';
        const res = Laws.enact(ruler, w, 'punishment', target);
        expect(res.success).toBe(true);
        expect(Laws.value(w, 'k0', 'punishment')).toBe(target);
        expect(k.treasury).toBeLessThan(1000);
        expect(k.stability).toBeLessThan(60);
        // Too soon to change it back
        const back = Laws.enact(ruler, w, 'punishment', 'standard');
        expect(back.success).toBe(false);
        expect(back.reason).toMatch(/day/);
        w.day += Laws.config().cooldownDays;
        expect(Laws.enact(ruler, w, 'punishment', 'standard').success).toBe(true);
        expect(k.laws.history.length).toBe(2);
    });

    it('private prisons: the knockout reads the realm\'s law', () => {
        const w = world();
        const k = w.kingdoms[1];
        k.laws = { privatePrisons: 'allowed' };
        expect(Knockout.privatePrisonsAllowed(w, 'k1')).toBe(true);
        k.laws = { privatePrisons: 'forbidden' };
        expect(Knockout.privatePrisonsAllowed(w, 'k1')).toBe(false);
        expect(Knockout.privatePrisonsAllowed(w, null)).toBe(false);
    });

    it('land for foreigners: where only subjects may hold land, a stranger can\'t buy a lot or rent a house', () => {
        const w = world();
        w.kingdoms[2].laws = { foreignLand: 'subjects' };
        const settlement = { name: 'Moorend', type: 'town', q: 1, r: 1, kingdom: 'k2' };
        const stranger = { gold: 5000, name: 'Ada' };
        const lot = { id: 'lot0', w: 6, h: 5 };
        const no = Lots.buyLot(stranger, w, settlement, lot);
        expect(no.success).toBe(false);
        expect(no.reason).toMatch(/subjects/);
        expect(Lots.rentHouse(stranger, w, settlement, '3,4').success).toBe(false);
        const subject = { gold: 5000, name: 'Bo', allegiance: 'k2' };
        expect(Lots.buyLot(subject, w, settlement, lot).success).toBe(true);
        w.kingdoms[2].laws = { foreignLand: 'open' };
        expect(Lots.rentHouse(stranger, w, settlement, '3,4').success).toBe(true);
    });

    it('punishment: a harsh realm fines a brawler more than a lenient one', () => {
        const w = world();
        w.getTile = () => ({ settlement: { type: 'town' } });
        const inc = { k: 'assault', key: '1,1', kingdom: 'k0' };
        const player = {};
        w.kingdoms[0].laws = { punishment: 'lenient' };
        const lenient = StreetCrime.fineFor(player, w, inc);
        w.kingdoms[0].laws = { punishment: 'harsh' };
        const harsh = StreetCrime.fineFor(player, w, inc);
        expect(harsh).toBeGreaterThan(lenient);
        expect(Laws.punishment(w, 'k0').jail).toBeGreaterThan(1);
    });
});
