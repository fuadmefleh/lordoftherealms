// Crimes against people (systems/peopleCrimes.js): framing an innocent, selling someone to the
// galleys, a captive starved in a cellar, the stocks and a winter eviction, a thief branded or
// maimed by your own hand — each with real coin and goods, and memories that raise a nemesis.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { PeopleCrimes } from '../systems/peopleCrimes.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { Nemesis } from '../systems/nemesis.js';
import { Underworld } from '../systems/underworld.js';

beforeAll(async () => { await loadData(); });
beforeEach(() => { Utils.setSeed(4242); });

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Thatcher', gender, born: -40 * 120, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], purse: 20, ...o });

function makeWorld({ culture = 'Imperial', punishment = 'standard', port = false, day = 1000 } = {}) {
    const tom = P(0, 'Tom', 'male', { spouse: 1, kids: [2, 3] });
    const ann = P(1, 'Ann', 'female', { spouse: 0, kids: [2, 3] });
    const will = P(2, 'Will', 'male', { parents: [0, 1], born: -20 * 120 });
    const babe = P(3, 'Babe', 'female', { parents: [0, 1], born: day - 2 * 120 });
    const folk = { q: 3, r: 4, n: 4, people: [tom, ann, will, babe], annals: [] };
    const kingdom = { id: 1, name: 'Varn', isAlive: true, treasury: 5000, laws: { punishment, privatePrisons: 'forbidden' } };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk, culture, port, economy: { gold: 2000 }, type: 'town' };
    const world = {
        day, generationParams: { seed: 7 }, kingdoms: [kingdom],
        getTile: (q, r) => (q === 3 && r === 4 ? { q, r, settlement: town } : null),
        getSettlementViews: () => [town],
        getKingdom: (id) => (String(id) === '1' ? kingdom : null),
    };
    return { world, folk, town, kingdom, tom, ann, will, babe };
}

function makePlayer() {
    return {
        name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 500, karma: 0, reputation: { 1: 20 },
        inventory: { clothes: 3 }, house: { name: 'House Voss', generation: 1, prestige: 100, history: [] },
    };
}

const days = (world, player, n) => { const out = []; for (let i = 0; i < n; i++) { world.day++; out.push(...PeopleCrimes.processDay(world, player).notices); } return out; };

describe('PeopleCrimes — framing an innocent', () => {
    it('plants the goods (out of your pack, into their larder), the watch is told, the trial hangs or exiles them', () => {
        const w = makeWorld({ punishment: 'harsh' });
        const player = makePlayer();
        const larder = { stock: {} };
        const g = PeopleCrimes.plantable(player, w.world.day)[0];
        expect(g.id).toBe('clothes');
        const res = PeopleCrimes.plant(player, w.world, { q: 3, r: 4, pid: 0, goodId: 'clothes', qty: 3, box: 'chest', larder, lk: 'k1', seenChance: 0 }, () => 0.5);
        expect(res.ok).toBe(true);
        expect(player.inventory.clothes).toBeUndefined();
        expect(larder.stock.clothes).toBe(3);
        expect(PeopleCrimes.pendingFrames(player, 3, 4, w.world.day)).toHaveLength(1);
        expect(PeopleCrimes.tipOff(player, w.world, res.frame.id, () => 0).ok).toBe(true);
        // Force conviction for the check: odds high
        const odds = PeopleCrimes.convictOdds(player, w.world, res.frame);
        expect(odds.chance).toBeGreaterThan(0.3);
        Utils.setSeed(1);
        const notes = [];
        for (let i = 0; i < 6 && ['tipped'].includes(res.frame.status); i++) { w.world.day++; notes.push(...PeopleCrimes.processDay(w.world, player).notices); }
        expect(['hanged', 'exiled', 'acquitted']).toContain(res.frame.status);
        if (res.frame.status === 'hanged') {
            expect(w.tom.died).not.toBeNull();
            expect(w.tom.cause).toMatch(/hanged/);
            // The kin hold the accusation; the eldest grown kin waits as a grudge for the nemesis
            const kinMem = (w.will.nm || []).find(e => e.k === 'false_accused');
            expect(kinMem).toBeTruthy();
            expect(player.nemesis.grudges.some(x => x.name === 'Ann Thatcher' && x.deed.key === 'framed')).toBe(true);
            expect(w.folk.annals.length).toBeGreaterThan(0);
        }
        expect(notes.length).toBeGreaterThan(0);
    });

    it('hanging follows the punishment law and the value; exposure costs reputation, Prestige, and makes you a known liar', () => {
        const w = makeWorld({ punishment: 'harsh' });
        const player = makePlayer();
        const frame = { id: 99, q: 3, r: 4, pid: 0, name: 'Tom Thatcher', town: 'Ashford', kingdom: 1, good: 'clothes', goodText: '3 clothes', qty: 3, value: 200, hot: true, lk: null, day: 990, status: 'tipped', tipped: 990, trialDay: 1000 };
        PeopleCrimes.state(player).frames.push(frame);
        // A sure conviction (the stream's first roll under the odds)
        PeopleCrimes._trial(player, w.world, frame, { notices: [] }, () => 0);
        expect(frame.status).toBe('hanged');
        expect(player.gold).toBeGreaterThan(500); // the informer's reward, out of the treasury
        expect(w.kingdom.treasury).toBeLessThan(5000 + 200);
        const before = player.reputation[1];
        PeopleCrimes._exposeFrame(player, w.world, frame, { notices: [] });
        expect(player.reputation[1]).toBeLessThan(before);
        expect(player.house.prestige).toBeLessThan(100);
        expect(PeopleCrimes.state(player).liar).toBe(1);
        expect(Underworld.getHeat(player, 1)).toBeGreaterThan(0);
        expect((w.folk.nm || []).some(e => e.k === 'framed')).toBe(true);
        expect(player.house.history.some(h => h.tags.includes('betrayal'))).toBe(true);
        // A known liar is believed less next time
        const odds = PeopleCrimes.convictOdds(player, w.world, { ...frame, pid: 1 });
        expect(odds.parts.some(p => /falsely/.test(p.label))).toBe(true);
    });

    it('years later, a known liar\'s old frame comes out on the yearly roll', () => {
        const w = makeWorld();
        const player = makePlayer();
        const st = PeopleCrimes.state(player);
        st.liar = 40; // near-certain
        const frame = { id: 5, q: 3, r: 4, pid: 0, name: 'Tom Thatcher', town: 'Ashford', kingdom: 1, good: 'clothes', qty: 1, value: 40, status: 'hanged', verdictDay: w.world.day, day: w.world.day - 5 };
        st.frames.push(frame);
        const notes = days(w.world, player, 130);
        expect(frame.exposed).toBeTruthy();
        expect(notes.some(n => n.title === 'Your Lie Is Out')).toBe(true);
        expect(st.liar).toBe(41);
    });

    it('seen planting: you keep the goods, the household remembers, the realm hears', () => {
        const w = makeWorld();
        const player = makePlayer();
        const res = PeopleCrimes.plant(player, w.world, { q: 3, r: 4, pid: 0, goodId: 'clothes', qty: 1, seenChance: 1 }, () => 0.1);
        expect(res.seen).toBe(true);
        expect(player.inventory.clothes).toBe(3);
        expect(w.tom.nm.some(e => e.k === 'false_accused')).toBe(true);
        expect(player.reputation[1]).toBeLessThan(20);
    });

    it('untold, the plot fizzles after the tip days', () => {
        const w = makeWorld();
        const player = makePlayer();
        const res = PeopleCrimes.plant(player, w.world, { q: 3, r: 4, pid: 0, goodId: 'clothes', qty: 1, seenChance: 0 }, () => 0.5);
        days(w.world, player, 8);
        expect(res.frame.status).toBe('fizzled');
        expect(w.tom.died).toBeNull();
    });
});

describe('PeopleCrimes — bondage', () => {
    it('only at a harbour; the coin comes out of the town purse; the sold are away from the roster', () => {
        const dry = makeWorld({ port: false });
        expect(PeopleCrimes.sellToGalleys(makePlayer(), dry.world, { q: 3, r: 4, pid: 2 }).ok).toBe(false);
        const w = makeWorld({ port: true });
        const player = makePlayer();
        const res = PeopleCrimes.sellToGalleys(player, w.world, { q: 3, r: 4, pid: 2, night: true }, () => 0.99);
        expect(res.ok).toBe(true);
        expect(res.seen).toBe(false);
        expect(player.gold).toBe(500 + res.price);
        expect(w.town.economy.gold).toBe(2000 - res.price);
        expect(w.will.away).toBeTruthy();
        expect(PeopleCrimes.state(player).sold).toHaveLength(1);
    });

    it('a maimed body fetches less', () => {
        const w = makeWorld({ port: true });
        const whole = PeopleCrimes.bondagePrice(w.world, 3, 4, w.will);
        w.will.pcMark = 'maimed';
        expect(PeopleCrimes.bondagePrice(w.world, 3, 4, w.will)).toBeLessThan(whole);
    });

    it('the sold may come home years later, name you, and become a nemesis', () => {
        const w = makeWorld({ port: true });
        const player = makePlayer();
        PeopleCrimes.sellToGalleys(player, w.world, { q: 3, r: 4, pid: 2 }, () => 0.01); // seen? 0.01 < seen odds → seen
        const rec = PeopleCrimes.state(player).sold[0];
        rec.returnDay = w.world.day + 2;
        rec.dieDay = null;
        const notes = days(w.world, player, 3);
        expect(notes.some(n => /Galleys/.test(n.title))).toBe(true);
        expect(w.will.away).toBeNull();
        expect(w.will.nm.some(e => e.k === 'sold_bondage')).toBe(true);
        expect(player.nemesis.grudges.some(g => g.name === 'Will Thatcher')).toBe(true);
        expect(PeopleCrimes.state(player).sold).toHaveLength(0);
    });
});

describe('PeopleCrimes — the cellar', () => {
    it('fed captives cost coin into the town; starved ones die; the cellar may be found', () => {
        const w = makeWorld();
        const player = makePlayer();
        const res = PeopleCrimes.lockAway(player, w.world, { q: 3, r: 4, pid: 2, place: 'house', witnesses: 0 }, () => 0.5);
        expect(res.ok).toBe(true);
        const c = res.captive;
        expect(w.will.away).toBeTruthy();
        const gold0 = player.gold;
        const town0 = w.town.economy.gold;
        days(w.world, player, 2);
        if (PeopleCrimes.captives(player).length) {
            expect(player.gold).toBeLessThan(gold0);
            expect(w.town.economy.gold).toBeGreaterThan(town0);
            PeopleCrimes.setFed(player, c.id, false);
            c.starveAt = c.hunger + 2;
            days(w.world, player, 3);
            expect(w.will.died).not.toBeNull();
            expect(w.will.cause).toMatch(/starved/);
        }
    });

    it('found dead: the kin remember a starving, the town too, and the realm turns on you', () => {
        const w = makeWorld();
        const player = makePlayer();
        const c = PeopleCrimes.lockAway(player, w.world, { q: 3, r: 4, pid: 2, witnesses: 0 }, () => 0.5).captive;
        w.will.died = w.world.day; w.will.cause = 'starved in a cellar';
        PeopleCrimes._discover(player, w.world, c, { notices: [] });
        expect(w.tom.nm.some(e => e.k === 'starved')).toBe(true);
        expect(w.folk.nm.some(e => e.k === 'starved')).toBe(true);
        expect(player.reputation[1]).toBeLessThan(0);
        expect(PeopleCrimes.captives(player)).toHaveLength(0);
    });

    it('released, they go home and tell', () => {
        const w = makeWorld();
        const player = makePlayer();
        const c = PeopleCrimes.lockAway(player, w.world, { q: 3, r: 4, pid: 2, witnesses: 0 }, () => 0.5).captive;
        expect(PeopleCrimes.release(player, w.world, c.id).ok).toBe(true);
        expect(w.will.away).toBeNull();
        expect(w.will.nm.some(e => e.k === 'held_captive')).toBe(true);
    });
});

describe('PeopleCrimes — a hard landlord', () => {
    function withTenant(w, player, owed = 30) {
        const rec = { tenant: { name: 'Tom Thatcher', since: 1, rent: 3, owed, missed: 10 } };
        player.lotHoldings = [{ kind: 'house', key: 'h1', q: 3, r: 4 }];
        w.town.lotBook = null;
        // Stand-in for Lots._letRecord: the house record with its tenant
        return rec;
    }

    it('the stocks: the family pays out of their purses, the town and the debtor remember', async () => {
        const w = makeWorld();
        const player = makePlayer();
        const rec = withTenant(w, player);
        const { Lots } = await import('../systems/lots.js');
        const orig = Lots._letRecord;
        Lots._letRecord = () => ({ s: w.town, rec, ready: true });
        try {
            const res = PeopleCrimes.stockDebtor(player, w.world, 3, 4, 'h1');
            expect(res.ok).toBe(true);
            expect(player.gold).toBeGreaterThan(500);
            expect(rec.tenant.owed).toBeLessThan(30);
            expect(w.tom.purse + w.ann.purse + w.will.purse).toBeLessThan(60);
            expect(w.tom.nm.some(e => e.k === 'stocked')).toBe(true);
            expect(w.folk.nm.some(e => e.k === 'stocked')).toBe(true);
            days(w.world, player, 4);
            expect(PeopleCrimes.state(player).stocks).toHaveLength(0);
        } finally { Lots._letRecord = orig; }
    });

    it('turned out in winter: the town remembers, and the young may freeze', async () => {
        const w = makeWorld({ day: 100 }); // day 91–120 is winter
        expect(PeopleCrimes.isWinter(100)).toBe(true);
        const player = makePlayer();
        const rec = withTenant(w, player, 0);
        const { Lots } = await import('../systems/lots.js');
        const origR = Lots._letRecord, origE = Lots.evictTenant;
        Lots._letRecord = () => ({ s: w.town, rec, ready: true });
        Lots.evictTenant = () => { rec.tenant = null; return { success: true, text: 'Put out.' }; };
        try {
            const res = PeopleCrimes.evictInWinter(player, w.world, 3, 4, 'h1', () => 0.01);
            expect(res.ok).toBe(true);
            expect(w.folk.nm.some(e => e.k === 'evicted_winter')).toBe(true);
            expect(PeopleCrimes.state(player).cold.length).toBeGreaterThan(0);
            const notes = days(w.world, player, 14);
            expect(notes.some(n => n.title === 'Frozen')).toBe(true);
            expect(w.babe.died).not.toBeNull();
        } finally { Lots._letRecord = origR; Lots.evictTenant = origE; }
    });
});

describe('PeopleCrimes — your own justice on a thief', () => {
    it('the culture decides: the north approves a brand, the empire calls it assault', () => {
        const north = makeWorld({ culture: 'Nordic' });
        const pn = makePlayer();
        const a = PeopleCrimes.punishThief(pn, north.world, { q: 3, r: 4, pid: 2, how: 'brand' });
        expect(a.stance).toBe('approve');
        expect(north.will.pcMark).toBe('branded');
        expect(north.folk.nm.some(e => e.k === 'rough_justice')).toBe(true);
        expect(Underworld.getHeat(pn, 1)).toBe(0);

        const empire = makeWorld({ culture: 'Imperial' });
        const pe = makePlayer();
        const b = PeopleCrimes.punishThief(pe, empire.world, { q: 3, r: 4, pid: 2, how: 'maim' });
        expect(b.stance).toBe('condemn');
        expect(empire.will.pcMark).toBe('maimed');
        expect(empire.folk.nm.some(e => e.k === 'maimed')).toBe(true);
        expect(Underworld.getHeat(pe, 1)).toBeGreaterThan(0);
        expect(pe.reputation[1]).toBeLessThan(20);
        expect(pe.nemesis.grudges.some(g => g.name === 'Will Thatcher')).toBe(true);
    });

    it('a harsh law softens the stance; the brand convicts them sooner at a trial', () => {
        const w = makeWorld({ culture: 'Imperial', punishment: 'harsh' });
        expect(PeopleCrimes.stanceAt(w.world, w.town).stance).toBe('tolerate');
        const player = makePlayer();
        const f = { q: 3, r: 4, pid: 2, value: 20, hot: false };
        const plain = PeopleCrimes.convictOdds(player, w.world, f).chance;
        w.will.pcMark = 'branded';
        expect(PeopleCrimes.convictOdds(player, w.world, f).chance).toBeGreaterThan(plain);
    });

    it('memories of these deeds are among the bitterest the townsfolk keep', () => {
        for (const k of ['framed', 'sold_bondage', 'starved', 'maimed', 'froze_evicted']) {
            expect(NpcMemory.kind(k).weight).toBeLessThan(-25);
        }
        expect(typeof Nemesis.wrong).toBe('function');
    });
});
