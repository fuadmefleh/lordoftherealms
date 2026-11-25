// A household guard drawn out of a realm's army (player/realmEscort.js) is
// held to the rules every realm's army keeps (world/realmArms.js,
// KingdomAI.updateMilitary): its men count against the realm's army cap
// (kingdom.menAway, world/kingdom.js) so the recruiters do not raise a second
// army behind it to be kitted out of the same armoury; a guard cut down to
// the last man is not sent again, men and kits, the next morning; and the
// kits of its fallen on a field held are gathered back as any realm's are.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { RealmEscort } from '../player/realmEscort.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Titles } from '../systems/titles.js';
import { RealmArms } from '../world/realmArms.js';
import { Economy } from '../world/economy.js';
import { Kingdom } from '../world/kingdom.js';
import { KingdomAI } from '../world/kingdomAI.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const _num = v => (Number.isFinite(v) ? v : 0);

/** A realm of 2+ towns, rich and well manned, the player its Marshal, standing in its capital. */
function marshalOf(seed = 301) {
    const g = newGame(seed);
    const w = g.world;
    const k = w.kingdoms.find(x => x.isAlive !== false && Economy.realmTowns(x, w).length >= 2);
    k.military = Math.max(_num(k.military), 3000);
    k.treasury = Math.max(_num(k.treasury), 20000);
    const p = g.player;
    p.allegiance = k.id;
    p.reputation = { ...(p.reputation || {}), [k.id]: 50 };
    p.q = k.capital.q;
    p.r = k.capital.r;
    const s = w.getTile(k.capital.q, k.capital.r).settlement;
    if (!s.economy) Economy.initSettlement(s);
    Titles.initialize(p);
    p.currentTitle = 'marshal';
    return { g, w, k, p };
}

describe('men away from the army (Kingdom.menAway)', () => {
    it('counts a booking renewed since yesterday, not a stale one; 0 clears it', () => {
        const k = { id: 'x' };
        expect(Kingdom.menAway(k, 10)).toBe(0);
        Kingdom.setMenAway(k, 'guard', 120, 10);
        expect(Kingdom.menAway(k, 10)).toBe(120);
        expect(Kingdom.menAway(k, 11)).toBe(120);
        // (the holder stopped renewing it: the guard ended, its lord died)
        expect(Kingdom.menAway(k, 13)).toBe(0);
        Kingdom.setMenAway(k, 'guard', 0, 13);
        expect(Kingdom.menAway(k, 10)).toBe(0);
    });

    it('a realm fills its ranks only to its cap less its men away — as every realm does', () => {
        const { w, k } = marshalOf();
        KingdomAI.updateMilitary(k, w);
        const cap = k.militaryCap;
        expect(cap).toBeGreaterThan(200);
        // Two copies of the same realm, one with 150 men away in a guard, both short of their cap
        const away = 150;
        k.military = Math.floor(cap * 0.5);
        const twin = { ...k, armoury: k.armoury ? { ...k.armoury, stock: { ...k.armoury.stock } } : undefined };
        Kingdom.setMenAway(k, 'guard', away, w.day);
        for (let d = 0; d < 400; d++) {
            KingdomAI.updateMilitary(k, w);
            KingdomAI.updateMilitary(twin, w);
        }
        // (the twin refills to its cap; the realm with men away to the cap less them)
        expect(twin.military).toBeGreaterThan(cap * 0.97);
        expect(k.military + away).toBeLessThanOrEqual(cap + 1);
        expect(k.military + away).toBeGreaterThan(cap * 0.97);
        expect(twin.military - k.military).toBeGreaterThan(away * 0.8);
    });
});

describe('the guard by the army\'s rules', () => {
    it('a guard riding books its men away from the realm; ended, the booking goes', () => {
        const { w, k, p } = marshalOf();
        RealmEscort.processDay(p, w);
        RealmEscort.processDay(p, w);
        const men = RealmEscort.men(p, k.id);
        expect(men).toBeGreaterThan(0);
        expect(Kingdom.menAway(k, w.day)).toBe(men);
        RealmEscort.sendHome(p, w);
        expect(Kingdom.menAway(k, w.day)).toBe(0);
    });

    it('a guard cut down to the last man is not sent again — men and kits — the next morning', () => {
        const { w, k, p } = marshalOf();
        RealmEscort.processDay(p, w);
        expect(RealmEscort.units(p).length).toBeGreaterThan(0);
        // The whole guard falls
        PlayerMilitary._applyCasualties(p, 'land', 99, { pick: RealmEscort.units(p) });
        const out = RealmEscort.processDay(p, w);
        expect(RealmEscort.guard(p)).toBe(null);
        expect(out.notices.some(n => /cut down to the last man/.test(n.text))).toBe(true);
        const stock = JSON.stringify(RealmArms.state(k).stock);
        const mil = k.military;
        w.day += 1;
        RealmEscort.processDay(p, w);
        // (no fresh guard drawn out of the army and armed out of the armoury)
        expect(RealmEscort.units(p).length).toBe(0);
        expect(k.military).toBe(mil);
        expect(JSON.stringify(RealmArms.state(k).stock)).toBe(stock);
        // ...until the days are out (data/escort.json cut.days)
        w.day += _num((RealmEscort.config().cut || {}).days) || 30;
        RealmEscort.processDay(p, w);
        expect(RealmEscort.units(p).length).toBeGreaterThan(0);
    });

    it('the kits of the guard\'s fallen on a field held: recoverOwn of them back into the armoury', () => {
        const { w, k, p } = marshalOf();
        RealmEscort.processDay(p, w);
        const slotOf = u => (u.kit ? ['main', 'off', 'head', 'body', 'legs', 'feet', 'hands'].find(s => u.kit[s]) : null);
        const unit = RealmEscort.units(p).find(slotOf);
        expect(unit).toBeTruthy();
        const body = unit.kit[slotOf(unit)];
        const before = _num(RealmArms.state(k).stock[body]);
        const n = PlayerMilitary._gatherGuardKits([unit], w);
        expect(n).toBeGreaterThan(0);
        expect(RealmArms.state(k).stock[body]).toBeCloseTo(before + RealmArms.config().recoverOwn, 2);
        // (a company of no realm's guard gives nothing back to any armoury)
        const own = { ...unit, realmGuard: undefined };
        expect(PlayerMilitary._gatherGuardKits([own], w)).toBe(0);
    });

    it('a company takes only its men\'s share of a scarce slot: the last pieces of a bare army stay with it', () => {
        const { k } = marshalOf();
        k.military = 1000;
        RealmArms.state(k);
        const need = RealmArms.need(k);
        // The army holds a tenth of the body armour it needs, the rest in full
        k.armoury.stock = { weapons: need.slots.main, bow: need.slots.ranged, shield: need.slots.off, helmet: need.kits, gambeson: Math.round(need.kits * 0.1), arrows: need.ammo };
        const soldier = PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('soldier'));
        RealmEscort._armFromArmoury(k, soldier);
        // (ten men's share of a tenth: a tenth of a jerkin — none issued, the armoury keeps it)
        expect(soldier.kit.body).toBeFalsy();
        expect(soldier.kit.main).toBeTruthy();
        expect(k.armoury.stock.gambeson).toBe(Math.round(need.kits * 0.1));
        // Thirty knights' share of a fifth of the mail-and-padding is more than half a piece
        k.armoury.stock.chainmail = Math.round(need.kits * 0.2);
        k.armoury.stock.gambeson = 0;
        const knight = PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('knight'));
        RealmEscort._armFromArmoury(k, knight);
        expect(knight.kit.body).toBe('chainmail');
    });
});
