// Hollow-mechanics sweep of the modules landed since 2026-10-21: effects that
// were promised (data, UI text) or state that was written but never applied or
// read. One block per fix.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { TownEras } from '../world/townEras.js';
import { Sieges } from '../systems/sieges.js';
import { HoldingSieges } from '../systems/holdingSieges.js';
import { Fiscal } from '../systems/fiscal.js';
import { MetaLegacyStart } from '../systems/metaLegacyStart.js';
import { Crises } from '../systems/crises.js';
import { Hearsay } from '../systems/hearsay.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Hospitality } from '../systems/hospitality.js';
import { EstateSettlement } from '../player/estateSettlement.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Bonds } from '../systems/bonds.js';
import { Court } from '../systems/court.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { StreetFollowers } from '../systems/streetFollowers.js';
import { loadData } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('town walls hold in a siege (world/townEras.js → sieges)', () => {
    const world = { day: 100, kingdoms: [], getKingdom: () => null };
    it('a palisade or a stone wall adds to the town\'s walls, an open town nothing', () => {
        const open = { type: 'village', townEra: { walls: null } };
        const pal = { type: 'village', townEra: { walls: { kind: 'palisade', year: 300 } } };
        const stone = { type: 'village', townEra: { walls: { kind: 'stone', year: 600 } } };
        expect(TownEras.wallDefense(open)).toBe(0);
        expect(TownEras.wallDefense({ type: 'village' })).toBe(0);
        expect(Sieges.wallsOf(pal, world)).toBeGreaterThan(Sieges.wallsOf(open, world));
        expect(Sieges.wallsOf(stone, world)).toBeGreaterThan(Sieges.wallsOf(pal, world));
        expect(HoldingSieges.wallsOf(stone)).toBeCloseTo(TownEras.config().walls.defense.stone, 5);
        expect(HoldingSieges.wallsOf(open)).toBe(0);
    });
});

describe('a royal governor\'s order moves the province\'s mood (stewards → fiscal)', () => {
    it('a squeeze sours the town down to the band\'s floor; a kind order warms it to the ceiling', () => {
        const s = { happiness: 50 };
        Fiscal._provinceMood(s, { mood: -0.4, band: [35, 70] }, 7);
        expect(s.happiness).toBeCloseTo(47.2, 5);
        s.happiness = 36;
        Fiscal._provinceMood(s, { mood: -0.4, band: [35, 70] }, 7);
        expect(s.happiness).toBe(35);
        Fiscal._provinceMood(s, { mood: -0.4, band: [35, 70] }, 7);
        expect(s.happiness).toBe(35);
        s.happiness = 69;
        Fiscal._provinceMood(s, { mood: 0.4, band: [35, 70] }, 7);
        expect(s.happiness).toBe(70);
        // (a town already past the ceiling is not dragged down by a kind order)
        s.happiness = 80;
        Fiscal._provinceMood(s, { mood: 0.4, band: [35, 70] }, 7);
        expect(s.happiness).toBe(80);
    });
});

describe('legacy start goods use the inventory\'s ids (systems/metaLegacyStart.js)', () => {
    it('upper-case catalogue keys land as the lower-case goods', () => {
        const p = { inventory: {}, skills: {} };
        MetaLegacyStart._give(p, { items: { BOOK: 2, silver_jewellery: 1 } });
        expect(p.inventory.book).toBe(2);
        expect(p.inventory.silver_jewellery).toBe(1);
        expect(p.inventory.BOOK).toBeUndefined();
        const gd = DataLoader._gamedata.metaLegacy;
        const keys = JSON.stringify(gd).match(/"items":\s*\{[^}]*\}/g) || [];
        for (const k of keys) expect(k).not.toMatch(/"[A-Z_]{3,}":/);
    });
});

describe('the side you preached for in a schism (systems/crises.js)', () => {
    it('realms that declare later think better or worse of you, once', () => {
        const ks = [{ id: 'a', name: 'A', isAlive: true }, { id: 'b', name: 'B', isAlive: true }, { id: 'c', name: 'C', isAlive: true }];
        const world = { day: 10, kingdoms: ks, getKingdom: (id) => ks.find(k => k.id === id) || null };
        const player = { reputation: {} };
        const c = { uid: 7, kind: 'schism', data: { sides: { a: 'reformed' } } };
        Crises.playerState(player).sides[7] = 'reformed';
        // (a declared before the preaching: the preach itself told it)
        Crises.playerState(player).judged = { 7: ['a'] };
        c.data.sides.b = 'reformed';
        c.data.sides.c = 'orthodox';
        expect(Crises._judgeSides(world, player, c)).toBe(2);
        expect(player.reputation.b).toBe(3);
        expect(player.reputation.c).toBe(-3);
        expect(player.reputation.a).toBeUndefined();
        expect(Crises._judgeSides(world, player, c)).toBe(0);
        expect(player.reputation.b).toBe(3);
    });
});

describe('hearsay: broken promises and turned friends (systems/hearsay.js)', () => {
    it('the one whose promise you broke greets you with it, once, and thinks the less of you', () => {
        const player = { name: 'Bran', hearsay: null };
        Hearsay.state(player);
        const world = { day: 50 };
        const npc = { id: 'n1', name: 'Ada Reed', firstName: 'Ada', disposition: 50 };
        const key = Hearsay.keyOf(npc);
        const st = Hearsay.state(player);
        const rec = Hearsay._record(st, key, npc.name, '5,5', 'Ashford', 40);
        rec.broken = { d: 45, v: 'to pay back the loan' };
        const d0 = NpcDisposition.getMemory(npc).disposition;
        const line = Hearsay.greetLine(player, world, npc, '5,5');
        expect(line).toContain('to pay back the loan');
        expect(line).toMatch(/broke/);
        expect(NpcDisposition.getMemory(npc).disposition).toBeLessThan(d0);
        expect(Hearsay.greetLine(player, world, npc, '5,5') || '').not.toMatch(/broke it/);
    });
});

describe('a regular books for the season (systems/hospitality.js)', () => {
    it('the "regular" week event pays the booked nights', () => {
        const E = Hospitality.config().player.events;
        const saved = { ...E };
        try {
            for (const k of Object.keys(E)) if (E[k] && typeof E[k] === 'object' && k !== 'regular') E[k] = { ...E[k], weight: 0 };
            E.chance = 1;
            const player = { gold: 0 };
            const property = { type: 'inn', name: 'The Bell' };
            const view = { id: 'v1', stars: 2, rooms: 6 };
            Hospitality._playerWeekEvent({ day: 14, seed: 3 }, player, null, property, view);
            const per = Hospitality.revenuePerGuest('inn', 2, 1);
            expect(player.gold).toBe(Math.round(per * E.regular.nights * E.regular.rate));
            expect(player.gold).toBeGreaterThan(0);
            const n = property.hosp.notices[property.hosp.notices.length - 1];
            expect(n.text).toContain(`${player.gold} gold`);
        } finally {
            for (const k of Object.keys(E)) delete E[k];
            Object.assign(E, saved);
        }
    });
});

describe('an heirless estate tells where the rest went (player/estateSettlement.js)', () => {
    it('breakdown lists coin lost with banks, bills, cancelled bonds and unsold goods', () => {
        const rows = EstateSettlement.breakdown({
            assets: { gold: 100 }, claims: [], lost: { deposits: 40, bills: 0, bonds: 12, shares: 0 },
            cancelledBonds: 30, unsoldGoods: 3, land: 0,
        });
        const labels = rows.map(r => r.label).join(' | ');
        expect(labels).toMatch(/broken bank/);
        expect(labels).toMatch(/Bonds unredeemed/);
        expect(labels).toMatch(/cancelled/);
        expect(labels).toMatch(/no one would buy/);
        expect(labels).not.toMatch(/Bills not met/);
    });
});

describe('an outlaw chief\'s bounty is paid by the realm that posted it (systems/bountyHunting.js)', () => {
    it('draws the coin from the crown\'s treasury, then the notice town\'s purse', () => {
        const k = { id: 'k1', isAlive: true, treasury: 50 };
        const town = { name: 'Ashford', economy: { gold: 500 } };
        const world = { kingdoms: [k], getTile: (q, r) => (q === 3 && r === 4 ? { settlement: town } : null) };
        const got = BountyHunting._payLairBounty(world, { kingdomId: 'k1', fromQ: 3, fromR: 4 }, 120);
        expect(got).toBe(120);
        expect(k.treasury).toBe(0);
        expect(town.economy.gold).toBe(430);
    });
});

describe('a friend you sold out remembers (systems/bonds.js → court, npc chat)', () => {
    it('never serves at your court and says so in their persona', () => {
        const npc = { id: 'n9', firstName: 'Wat', age: 30, isAlive: true, betrayedByPlayer: 12 };
        const player = { name: 'Bran', house: { id: 'h' }, relationships: { n9: { score: 0 } }, bonds: null };
        expect(Court._barred(player, { day: 20 }, npc)).toMatch(/sold them out/);
        const lines = Bonds.personaLines(player, { day: 20 }, { npc, key: 'n9' });
        expect(lines.join(' ')).toMatch(/sold you/);
    });
    it('friends who fight beside you are named in the battle report', () => {
        expect(Bonds.aidLine(['Ada', 'Bran', 'Cole'])).toBe('Ada, Bran and Cole took up arms beside you.');
        expect(Bonds.aidLine([])).toBe('');
    });
});

describe('a dog that barks at a cutpurse is named (systems/animalCompanions.js)', () => {
    it('theftWarner is the walking dog with the warning; none when it stays behind', () => {
        const player = { q: 1, r: 1 };
        const st = AnimalCompanions.state(player);
        expect(AnimalCompanions.theftWarner(player)).toBeNull();
        const a = { id: 'a1', name: 'Rex', species: 'dog', bond: 90, health: 100, hunger: 90 };
        st.list.push(a);
        expect(AnimalCompanions.theftWarning(player)).toBeGreaterThan(0);
        expect(AnimalCompanions.theftWarner(player)).toBe(a);
        expect(AnimalCompanions.line('warnedThief', { name: 'Rex' })).toContain('Rex');
        StreetFollowers.set(player, StreetFollowers.animalKey('a1'), false);
        expect(AnimalCompanions.theftWarner(player)).toBeNull();
    });
});

describe('the lair deeds\' AP comes from data/outlawLairs.json', () => {
    it('getAPCost reads config.<deed>.ap', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const C = DataLoader._gamedata.outlawLairs.config;
        const was = C.scout.ap;
        try {
            C.scout.ap = 5;
            expect(ActionMenu.getAPCost('lair_scout')).toBe(5);
            expect(ActionMenu.getAPCost('lair_assault')).toBe(C.assault.ap);
        } finally { C.scout.ap = was; }
    }, 60000);
});

void Utils;
