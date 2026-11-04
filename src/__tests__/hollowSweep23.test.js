// Hollow-mechanics sweep 23: effects the recent features promised, now real —
// the punishment law deters street violence, theft answers to the law and the
// witnesses, the castle's and jail's chests hold what their names say, new
// money flows reach the ledger, and what the lots and the Dawn's realms wrote
// survives a save.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Laws } from '../systems/laws.js';
import { Knockout } from '../systems/knockout.js';
import { Containers } from '../systems/containers.js';
import { Commissions } from '../systems/commissions.js';
import { Languages } from '../systems/languages.js';
import { Lots } from '../systems/lots.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { Dawn } from '../world/dawn.js';
import { InnerMap } from '../world/innerMap.js';
import { theftScene } from '../ui/objectActions/contents.js';
import { Utils } from '../core/utils.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

/** A world of one realm whose punishment law is `law`. */
function realm(law = 'standard') {
    const k = { id: 'k1', name: 'Realm', treasury: 1000, stability: 60, isAlive: true, laws: { punishment: law } };
    return { day: 50, generationParams: { seed: 4242 }, kingdoms: [k], getKingdom: id => (id === 'k1' ? k : null), getTile: () => null };
}

describe('the punishment law deters street violence', () => {
    it('reads a deter multiplier for each option', () => {
        expect(Laws.punishment(realm('harsh'), 'k1').deter).toBeLessThan(1);
        expect(Laws.punishment(realm('standard'), 'k1').deter).toBe(1);
        expect(Laws.punishment(realm('lenient'), 'k1').deter).toBeGreaterThan(1);
        // Outside any realm (an independent town): the old custom, not a fine of nothing
        expect(Laws.punishment(realm(), null)).toEqual({ fine: 1, jail: 1, deter: 1 });
    });

    it('a harsh law makes the one who downs you less likely to finish or rob you', () => {
        const npc = { id: 7, name: 'Brute', type: 'villager', _dialogMemory: { disposition: 10, grudge: { victimName: 'Ann', severity: 'assault' } } };
        const player = { name: 'You', gold: 100 };
        const count = (deter) => {
            const tally = { finish: 0, rob: 0 };
            let s = 1;
            const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
            for (let i = 0; i < 2000; i++) {
                const v = Knockout.attackerVerdict(npc, player, { starter: 'npc', deter, rnd });
                if (tally[v.act] != null) tally[v.act]++;
            }
            return tally;
        };
        const soft = count(1.3), hard = count(0.6);
        expect(hard.finish).toBeLessThan(soft.finish);
        expect(count(0).finish).toBe(0);
        expect(count(0).rob).toBe(0);
    });

    it('a householder who hates you is held back by a law with no tolerance', () => {
        const npc = { id: 8, name: 'Hater', type: 'villager', _dialogMemory: { disposition: 5 } };
        expect(Knockout.householderAttacks(npc, () => 0.1, 1).attacks).toBe(true);
        expect(Knockout.householderAttacks(npc, () => 0.1, 0).attacks).toBe(false);
    });
});

describe('theft answers to the law', () => {
    const chest = { worldQ: 5, worldR: 7, q: 3, r: 2, furnitureType: 'chest', building: { type: 'bank', q: 40, r: 41, name: 'Bank' }, inSettlement: true, kingdom: 'k1', settlementName: 'Varrholt' };
    const stocked = (w) => {
        for (let i = 0; i < 60; i++) {
            const ctx = { ...chest, q: chest.q + i };
            if (Object.keys(Containers.contents(null, w, ctx)).length) return ctx;
        }
        throw new Error('no stocked chest');
    };
    const caughtThird = (law) => {
        const w = realm(law);
        const ctx = stocked(w);
        const good = Object.keys(Containers.contents(null, w, ctx))[0];
        const p = { gold: 5000, inventory: {}, skills: {}, reputation: { k1: 0 }, criminalRecord: { pickpocket: 0, smuggling: 0, theft: 2 } };
        const spy = vi.spyOn(Utils, 'random').mockReturnValue(0);
        const res = Containers.steal(p, w, ctx, good, 1, { witnesses: 3, guards: 1 });
        spy.mockRestore();
        return { res, p };
    };

    it('a harsh realm fines harder and jails longer; the fine reaches the ledger', () => {
        const std = caughtThird('standard');
        const harsh = caughtThird('harsh');
        expect(std.res.caught).toBe(true);
        expect(harsh.res.fine).toBeGreaterThanOrEqual(std.res.fine);
        expect(harsh.res.jailDays).toBeGreaterThan(std.res.jailDays);
        expect(harsh.p.jailState.daysRemaining).toBe(harsh.res.jailDays);
        expect(std.p.financeToday.expenses.fines).toBe(std.res.fine);
    });

    it('out on the street, folk indoors at their doors are no witnesses', () => {
        InnerMap.playerInnerQ = 10;
        InnerMap.playerInnerR = 10;
        InnerMap.npcs = [
            { id: 1, name: 'Sleeper', type: 'villager', q: 10, r: 11, state: 'inside_building' },
            { id: 2, name: 'Walker', type: 'villager', q: 11, r: 10, state: 'walking' },
        ];
        const street = theftScene({}, { building: null });
        expect(street.witnesses).toBe(1);
        expect(street.near.map(n => n.name)).toEqual(['Walker']);
        InnerMap.npcs = [];
    });
});

describe('castle and jail chests', () => {
    it('the castle treasury holds treasure, and the jail\'s water barrel no beer', () => {
        const castle = Containers.table({ furnitureType: 'chest', building: { type: 'castle' } }).map(r => r[0]);
        expect(castle).toContain('ancient_coin');
        expect(castle).toContain('gold_bar');
        expect(Containers.table({ furnitureType: 'stall', building: { type: 'castle' } }).map(r => r[0])).not.toContain('cheese');
        expect(Containers.table({ furnitureType: 'barrel', building: { type: 'jail' } })).toEqual([]);
        expect(Containers.table({ furnitureType: 'chest', building: { type: 'jail' } }).map(r => r[0])).toContain('weapons');
    });
});

describe('new money flows reach the ledger', () => {
    it('lessons, interpreters, lots, rent and hired work are booked', () => {
        const s = { name: 'Varrholt', type: 'town', q: 1, r: 1, kingdom: null };
        const world = { day: 9, kingdoms: [], getKingdom: () => null, getTile: () => ({ settlement: s }), getSettlementViews: () => [] };
        const p = new Player();
        p.q = 1; p.r = 1; p.gold = 5000;
        p.languages = {};
        const hired = Languages.hireTranslator(p, world);
        expect(hired.success).toBe(true);
        expect(p.financeToday.expenses.languages).toBeGreaterThan(0);

        const bought = Lots.buyLot(p, world, s, { id: 'lot0', w: 6, h: 6 });
        expect(bought.success).toBe(true);
        expect(p.financeToday.income.townLand).toBe(-bought.price);
        Lots.rentHouse(p, world, s, '3,4', 'the cottage');
        expect(p.financeToday.expenses.townRent).toBeGreaterThan(0);

        const offer = Commissions.offers(world, s).find(o => o.kind === 'craft');
        if (offer) {
            for (const [g, n] of Object.entries(offer.in)) p.inventory[g] = n * 4;
            const res = Commissions.commission(p, world, offer.id, 2, 'fee');
            expect(res.success).toBe(true);
            expect(p.financeToday.expenses.hiredWork).toBe(res.job.fee);
        }
    });
});

describe('what was written survives a save', () => {
    it('the player\'s lots and rented houses are kept, so rent day still comes', () => {
        const p = new Player();
        p.lotHoldings = [{ kind: 'rent', q: 1, r: 1, key: '3,4', town: 'Varrholt', rent: 2, name: 'the cottage' }];
        p.lastJailRelease = { how: 'served', day: 4, settlement: 'Varrholt' };
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p))), back);
        expect(back.lotHoldings).toEqual(p.lotHoldings);
        expect(back.lastJailRelease).toEqual(p.lastJailRelease);
    });

    it('a realm risen at the Dawn keeps its shipcraft, tongues, founding day and colours', () => {
        const k = {
            id: 'dawn_realm_1', name: 'Chiefdom of Ash', culture: 'Imperial', isAlive: true, dawnBorn: true,
            shipcraft: ['shipbuilding'], tongues: { vellish: 100, norrish: 12 }, foundedDay: 420,
            colorLight: 'rgba(1, 2, 3, 0.2)', preferredTerrain: ['plains'], characterData: null,
        };
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializeKingdoms([k])[0]));
        expect(saved.shipcraft).toEqual(['shipbuilding']);
        expect(saved.tongues).toEqual({ vellish: 100, norrish: 12 });
        expect(saved.foundedDay).toBe(420);
        expect(saved.dawnBorn).toBe(true);
        expect(saved.colorLight).toBe('rgba(1, 2, 3, 0.2)');
        // An ordinary realm (whole craft known) stays as it was
        const plain = SaveLoad.serializeKingdoms([{ id: 'k1', name: 'Old Realm', isAlive: true }])[0];
        expect(plain.shipcraft).toBeUndefined();
        expect(plain.dawnBorn).toBeUndefined();
    });
});

describe('the Dawn names its age', () => {
    it('for the calendar', () => {
        expect(Dawn.eraName({ dawn: { over: false, realmsBorn: 0 } })).toBe('the Dawn Age');
        expect(Dawn.eraName({ dawn: { over: true } })).toBe(null);
    });
});

describe('second batch: promises the dynasty, rival and road features made', () => {
    it('a rival under a truce leaks no plot through its informant; one that does pays for it', async () => {
        const { RivalAgents } = await import('../systems/rivalAgents.js');
        const { Schemes } = await import('../systems/schemes.js');
        const world = { day: 400, generationParams: { seed: 7 }, getTile: () => null };
        const mk = (truceUntil) => {
            const rival = { kingdomId: 'k9', name: 'House Vane', feud: 80, gold: 1000, truceUntil, stats: { plotsPaid: 0 } };
            const player = { house: { rivals: { k9: rival }, schemes: [] } };
            const agent = { id: 'a1', kind: 'informant', rivalId: 'k9', rivalName: 'House Vane', name: 'Ned', lastAct: -999, acts: 0, q: 0, r: 0 };
            return { rival, player, agent };
        };
        const elig = vi.spyOn(Schemes, 'eligibleTypes').mockReturnValue(['theft']);
        const hatch = vi.spyOn(Schemes, 'hatch').mockReturnValue({ dueDay: 999 });
        const t = mk(500);
        RivalAgents._act(t.player, world, t.agent, { notices: [] });
        expect(hatch).not.toHaveBeenCalled();
        const f = mk(null);
        RivalAgents._act(f.player, world, f.agent, { notices: [] });
        expect(hatch).toHaveBeenCalledTimes(1);
        expect(f.rival.gold).toBeLessThan(1000);
        expect(f.rival.stats.plotsPaid).toBe(1);
        elig.mockRestore();
        hatch.mockRestore();
    });

    it('a child under a regent may not raise banners for a claim', async () => {
        const { Throne } = await import('../systems/throne.js');
        const { Regency } = await import('../systems/regency.js');
        const spy = vi.spyOn(Regency, 'forbids').mockReturnValue('You are not of age.');
        const k = { id: 'k1', name: 'R', isAlive: true };
        const world = { day: 1, kingdoms: [k], getKingdom: () => k };
        const res = Throne.canPress({ gold: 1e6 }, world, 'k1', { armyStrength: 1e6 });
        expect(res.ok).toBe(false);
        expect(res.reason).toMatch(/not of age/);
        spy.mockRestore();
    });

    it('the royal spouse an heir brings to the throne keeps the royal link claims read', async () => {
        const { Relationships } = await import('../systems/relationships.js');
        const s = { name: 'Varrholt', type: 'capital', q: 1, r: 1, kingdom: 'k1' };
        const world = { day: 10, kingdoms: [], getKingdom: () => ({ id: 'k1', name: 'R', capital: { q: 1, r: 1 } }), getTile: () => ({ settlement: s }) };
        const p = new Player();
        const child = { id: 'c1', firstName: 'Ada', gender: 'female', age: 20, upbringing: { spouse: { kind: 'royal', kingdomId: 'k1', royalId: 'r5', name: 'Prince Olm Vane', day: 3 } } };
        const npc = Relationships._seatHeirSpouse(p, child, world);
        expect(npc.royal).toMatchObject({ kingdomId: 'k1', charId: 'r5' });
    });

    it('commandMinAge is the age a child may lead the company', async () => {
        const { HeirAgency } = await import('../systems/heirAgency.js');
        const spy = vi.spyOn(HeirAgency, '_grownAtHome').mockReturnValue(null);
        const young = { id: 'c1', firstName: 'Tam', age: 12, upbringing: {} };
        const res = HeirAgency.giveCommand({ children: [young] }, { day: 1 }, 'c1');
        expect(res.success).toBe(false);
        expect(res.reason).toMatch(/too young/);
        spy.mockRestore();
    });

    it('ice fished in person: the day\'s catch is never less than the fish you landed', async () => {
        const { SeasonalWork } = await import('../player/seasonalWork.js');
        const can = vi.spyOn(SeasonalWork, 'canIceFish').mockReturnValue(true);
        const p = new Player();
        p.inventory = {};
        const res = SeasonalWork.iceFish(p, {}, { day: 1 }, { landed: 40 });
        expect(res.success).toBe(true);
        expect((res.items.fish || 0) + (res.lost.fish || 0)).toBe(40);
        can.mockRestore();
    });
});
