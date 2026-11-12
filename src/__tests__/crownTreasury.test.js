// A crown the player holds, left to its officers: a ruler who keeps court in
// the capital and leaves the Treasury's levers alone must not watch the chests
// run dry and the realm sink into arrears and unrest within a few years.
// Before 2026-11 (seed 11, the greatest realm taken at the start) it did: the
// realm the player ruled was the one crown nobody reviewed (systems/fiscal.js
// _review: its taxes, court and army pay stayed where the coronation left them),
// it kept the deposed lord's temper for the whole reign (a Tyrant's -0.4 loyalty:
// -20 stability; systems/throne.js _dismissLordTemper), and a royal guard that
// starved away was sent afresh the next morning, drawn and armed anew out of the
// army at the crown's cost (player/realmEscort.js). Three years in: the chests
// empty on 75 days, soldiers in arrears, stability down to 38 — and in a longer
// run the spiral of arrears, corruption and the 'Empty treasury' mood took it
// to stability 3 by year six.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Throne } from '../systems/throne.js';
import { Fiscal } from '../systems/fiscal.js';
import { CrownBooks } from '../world/crownBooks.js';

const YEARS = 3;

function reign(seed) {
    const g = newGame(seed);
    const { world, player } = g;
    // The greatest realm, taken at the start
    const k = world.kingdoms.filter(x => x.isAlive)
        .sort((a, b) => (b.territory || []).length - (a.territory || []).length || String(a.id).localeCompare(String(b.id)))[0];
    Throne._takeThrone(player, world, k);
    // The ruler keeps court in the capital (the guard is fed there)
    player.q = k.capital.q;
    player.r = k.capital.r;
    let broke = 0, minStab = 100, rev = 0, exp = 0;
    const days = YEARS * 120;
    for (let d = 0; d < days; d++) {
        // (the king eats at his own table: the run is about the realm, not his larder)
        player.starvationDays = 0;
        player.health = Math.max(player.health || 0, 100);
        endDay(g);
        if (!(k.treasury > 0)) broke++;
        if (d >= 120) minStab = Math.min(minStab, k.stability);
        const last = CrownBooks.state(k).last || {};
        rev += CrownBooks.revenue(last);
        exp += CrownBooks.expense(last);
    }
    return { k, f: CrownBooks.state(k), broke, minStab, rev, exp, player };
}

describe('A crown left to its officers', () => {
    beforeAll(async () => { await loadData(); });

    it('holds its treasury and its stability through the years', () => {
        const r = reign(11);
        expect(r.k.isAlive).toBe(true);
        expect(r.k.crown && r.k.crown.playerRuled).toBe(true);
        // the old lord's temper went with him
        expect((r.k.lord && r.k.lord.traits) || []).toEqual([]);
        // the books balance: never long without coin, nothing owed at the end
        expect(r.rev).toBeGreaterThan(r.exp);
        expect(r.broke).toBeLessThan(YEARS * 120 * 0.05);
        expect(r.f.arrearsDays).toBe(0);
        expect(r.k.treasury).toBeGreaterThan(2000);
        // the realm stays settled (no slide into unrest)
        expect(r.minStab).toBeGreaterThan(40);
        expect(r.k.stability).toBeGreaterThan(50);
        // ...and the ruler was paid all along (the levy is a share of the revenue)
        expect(Throne.state(r.player).ruling.levyTotal).toBeGreaterThan(0);
    }, 600000);

    it('a lever set by hand is the ruler\'s; handed back, the treasurers keep it', () => {
        const g = newGame(5);
        const { world, player } = g;
        const k = world.kingdoms.find(x => x.isAlive);
        Throne._takeThrone(player, world, k);
        const f = CrownBooks.state(k);
        expect(Fiscal.setCourt(player, world, 'lavish').success).toBe(true);
        expect(Fiscal.held(player, world)).toEqual({ tax: false, court: true, army: false });
        // Broke and in arrears: the treasurers cut what they hold, never the ruler's lavish court
        k.treasury = 0;
        f.avg.exp = 500;
        f.arrearsDays = 3;
        const out = { notices: [] };
        Fiscal._review(world, Fiscal.state(world), k, f, world.day, { ruled: true, out });
        expect(f.courtLevel).toBe('lavish');
        expect(f.armyPay).toBe('half');
        expect(f.level).toBe('heavy');
        expect(out.notices.length).toBe(1);
        // Handed back, the court is theirs to cut; taxes never past heavy unbidden
        expect(Fiscal.setCourt(player, world, 'auto').success).toBe(true);
        for (let i = 0; i < 4; i++) Fiscal._review(world, Fiscal.state(world), k, f, world.day, { ruled: true, out });
        expect(f.courtLevel).toBe('frugal');
        expect(f.level).toBe('heavy');
        // Rich again: back to a standard court (not a lavish one), lighter taxes, full pay
        k.treasury = 500 * 400;
        f.arrearsDays = 0;
        for (let i = 0; i < 4; i++) Fiscal._review(world, Fiscal.state(world), k, f, world.day, { ruled: true, out });
        expect(f.courtLevel).toBe('standard');
        expect(f.armyPay).toBe('full');
        expect(f.level).toBe('light');
        // A tax set by hand stays
        expect(Fiscal.setRate(player, world, 'all', 'crushing').success).toBe(true);
        Fiscal._review(world, Fiscal.state(world), k, f, world.day, { ruled: true, out });
        expect(f.level).toBe('crushing');
    }, 120000);
});
