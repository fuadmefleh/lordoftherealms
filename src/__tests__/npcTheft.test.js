// NPC theft (systems/npcTheft.js): burglars break into the townsfolk's houses
// and the player's own, cutpurses work the crowds — hash-driven, the goods
// really move, the town remembers, the watch catches some, the rest are fenced.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { NpcTheft } from '../systems/npcTheft.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Containers } from '../systems/containers.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Utils } from '../core/utils.js';
import { TownTrade } from '../systems/townTrade.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

function makeWorld(day = 10) {
    const towns = [
        { name: 'Ashford', type: 'city', q: 5, r: 7, kingdom: 'k1', economy: { gold: 5000 } },
        { name: 'Greymoor', type: 'town', q: 20, r: 3, kingdom: 'k1', economy: { gold: 2000 } },
    ];
    const tiles = new Map(towns.map(t => [`${t.q},${t.r}`, { q: t.q, r: t.r, settlement: t }]));
    const world = {
        day, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [], kingdoms: [], getKingdom: () => null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || null, getSettlementViews: () => towns,
    };
    for (const t of towns) { Townsfolk.seed(t, world, { q: t.q, r: t.r }); SettlementMarket.ensure(t); }
    return { world, ash: towns[0], grey: towns[1] };
}

function makePlayer(opts = {}) {
    return {
        name: 'Aldric', q: 40, r: 40, gold: 300, inventory: {}, skills: { stealth: 1 }, intelligence: 5, strength: 5, charisma: 5,
        houses: [{ q: 5, r: 7, typeId: 'townhouse', upgrades: opts.upgrades || [] }],
        homeFurnishings: { 'house:5,7': { name: 'Townhouse', pieces: [
            { uid: 'f1', id: 'iron_strongbox', look: { name: 'Iron-bound Strongbox' }, storage: { gold: 40, jewelry: 2 } },
            { uid: 'f2', id: null, look: { name: 'Chest' }, storage: { candles: 6, wine: 4, silk: 2 } },
        ] } },
    };
}

/** The first day from `from` with a burglary planned in the town. */
function nextPlan(world, s, from = 10, player = null) {
    for (let d = from; d < from + 400; d++) {
        world.day = d;
        const plan = NpcTheft.planBurglary(world, s, d, player);
        if (plan) return plan;
    }
    return null;
}

describe('burglary in town', () => {
    it('happens: a poor or crooked thief, the household weighed by wealth and emptiness', () => {
        const { world, ash } = makeWorld();
        const plan = nextPlan(world, ash);
        expect(plan).toBeTruthy();
        expect(['night', 'day']).toContain(plan.when);
        const thief = Townsfolk.get(ash.folk, plan.thief.pid);
        expect(['beggar', 'villager', 'farmer']).toContain(thief.role);
        // The same answer every time it's asked
        expect(NpcTheft.planBurglary(world, ash, plan.day)).toEqual(plan);
        // Rich households are worth more; by day a working household's house stands empty
        const day = NpcTheft.targets(world, ash, plan.day, 'day');
        const night = NpcTheft.targets(world, ash, plan.day, 'night');
        const rich = day.filter(t => t.hh.wealth >= 4);
        const poor = day.filter(t => t.hh.wealth <= 1 && !t.empty);
        if (rich.length && poor.length) expect(Math.max(...rich.map(t => t.w))).toBeGreaterThan(Math.min(...poor.map(t => t.w)));
        const empty = day.find(t => t.empty);
        if (empty) expect(empty.w).toBeGreaterThan(night.find(t => t.hh.head.id === empty.hh.head.id).w);
    });

    it('never in an honest town with no lair near', () => {
        const { world, grey } = makeWorld();
        for (const p of grey.folk.people) p.traits = ['kind'];
        for (let d = 10; d < 400; d++) expect(NpcTheft.planBurglary(world, grey, d)).toBe(null);
    });

    it('moves the goods: out of the household\'s boxes and purse into the thief\'s hands, then fenced', () => {
        const { world, ash } = makeWorld();
        const plan = { ...nextPlan(world, ash), caught: false, seen: false };
        const head = Townsfolk.get(ash.folk, plan.target.pid);
        const purseBefore = Townsfolk.purse(ash.folk, head, world);
        const thief = Townsfolk.get(ash.folk, plan.thief.pid);
        const thiefBefore = Townsfolk.purse(ash.folk, thief, world);
        const { stores } = NpcTheft._houseStores(world, ash, head.id);
        const before = JSON.parse(JSON.stringify(stores.map(x => x.rec.stock)));
        const c = NpcTheft.commitBurglary(world, ash, plan);
        expect(c.status).toBe('open');
        expect(Townsfolk.purse(ash.folk, head, world)).toBe(purseBefore - c.purses[head.id]);
        expect(Townsfolk.purse(ash.folk, thief, world)).toBe(thiefBefore + c.coin);
        for (const [id, n] of Object.entries(c.goods)) {
            const was = before.reduce((t, s) => t + (s[id] || 0), 0);
            const now = stores.reduce((t, s) => t + (s.rec.stock[id] || 0), 0);
            expect(was - now).toBe(n);
        }
        // The household knows
        expect(head.log.some(e => e.k === 'robbed')).toBe(true);
        expect(Townsfolk.lifeText(ash.folk, head, head.log.find(e => e.k === 'robbed'), world)).toMatch(/broken into/);
        // Fenced: the goods into the town's market, the fence paying out of the town's purse
        const goods = { ...c.goods };
        const stock = Object.fromEntries(Object.keys(goods).map(id => [id, SettlementMarket.stock(ash, id)]));
        const townGold = ash.economy.gold;
        NpcTheft._fence(world, ash, c, null);
        expect(c.status).toBe('fenced');
        for (const [id, n] of Object.entries(goods)) if (SettlementMarket.tracks(id)) expect(SettlementMarket.stock(ash, id)).toBeCloseTo(stock[id] + n, 5);
        if (Object.keys(goods).length) expect(ash.economy.gold).toBeLessThanOrEqual(townGold);
    });

    it('a burglary seen goes on the town\'s record as the thief\'s crime, and the witnesses remember', () => {
        const { world, ash } = makeWorld();
        const plan = { ...nextPlan(world, ash), caught: false };
        const witness = { name: 'Old Brom', type: 'villager' };
        const c = NpcTheft.commitBurglary(world, ash, plan, null, { seenBy: ['Old Brom'], witnesses: [witness] });
        expect(c.named).toBe(true);
        const rec = ash.npcCrimes[ash.npcCrimes.length - 1];
        expect(rec.k).toBe('burglary');
        expect(rec.by).toBe(plan.thief.name);
        expect(rec.seenBy).toEqual(['Old Brom']);
        expect(witness._dialogMemory.sawNpc[0]).toMatchObject({ k: 'burglary', by: plan.thief.name });
        // The town talks of it
        const annal = ash.folk.annals.find(a => a.k === 'npcTheft');
        expect(Townsfolk.annalText(ash.folk, annal, world)).toMatch(/broken into .* folk say it was/);
    });

    it('caught: nothing moves, the thief sits out a while', () => {
        const { world, ash } = makeWorld();
        const plan = { ...nextPlan(world, ash), caught: true };
        const head = Townsfolk.get(ash.folk, plan.target.pid);
        const purse = Townsfolk.purse(ash.folk, head, world);
        const c = NpcTheft.commitBurglary(world, ash, plan);
        expect(c.status).toBe('caught');
        expect(c.coin).toBe(0);
        expect(Townsfolk.purse(ash.folk, head, world)).toBe(purse);
        const thief = Townsfolk.get(ash.folk, plan.thief.pid);
        expect(thief.jailedUntil).toBeGreaterThan(plan.day);
    });

    it('the watch catching the thief later gives the household its goods back', () => {
        const { world, ash } = makeWorld();
        const plan = { ...nextPlan(world, ash), caught: false };
        const head = Townsfolk.get(ash.folk, plan.target.pid);
        const purse = Townsfolk.purse(ash.folk, head, world);
        const { stores } = NpcTheft._houseStores(world, ash, head.id);
        const before = JSON.parse(JSON.stringify(stores.map(x => x.rec.stock)));
        const c = NpcTheft.commitBurglary(world, ash, plan);
        expect(NpcTheft.catchCase(world, ash, c)).toBe(true);
        expect(c.status).toBe('caught');
        expect(Townsfolk.purse(ash.folk, head, world)).toBe(purse);
        expect(stores.map(x => x.rec.stock)).toEqual(before);
    });
});

describe('the player\'s own home', () => {
    /** Days until the player's home is robbed (away the whole time). */
    function robbedDays(player, days = 600) {
        const { world } = makeWorld();
        let n = 0;
        for (let d = 10; d < 10 + days; d++) {
            world.day = d;
            for (const site of NpcTheft.playerSites(player, world)) {
                const plan = NpcTheft.planPlayerBurglary(world, player, site, d);
                if (plan) n++;
            }
        }
        return n;
    }

    it('is robbed while the player is away, and they are told on coming back, with clues', () => {
        const { world, ash } = makeWorld();
        const player = makePlayer();
        let entry = null;
        let d = 10;
        for (; d < 800 && !entry; d++) {
            world.day = d;
            const out = NpcTheft.processDay(world, player);
            const ev = out.events.find(e => e.kind === 'playerBurglary' && e.entry.status === 'open' && NpcTheft.describe(e.entry));
            if (ev) entry = ev.entry;
            expect(out.notices.filter(n => n.title === 'Robbed!').length).toBe(0);
        }
        expect(entry).toBeTruthy();
        expect(entry.told).toBe(false);
        // The goods really left the chest
        const chest = player.homeFurnishings['house:5,7'].pieces[1].storage;
        for (const [id, n] of Object.entries(entry.goods)) if (n) expect((chest[id] || 0) + n).toBeLessThanOrEqual({ candles: 6, wine: 4, silk: 2 }[id] || 99);
        // Home again
        player.q = ash.q; player.r = ash.r;
        world.day = d;
        const out = NpcTheft.processDay(world, player);
        const told = out.notices.find(n => n.title === 'Robbed!');
        expect(told).toBeTruthy();
        expect(told.text).toMatch(/robbed|broken into/);
        expect(entry.told).toBe(true);
        expect(NpcTheft.burglaryText(entry)).toContain(NpcTheft.describe(entry));
    });

    it('is left alone while the player is at home', () => {
        const { world, ash } = makeWorld();
        const player = makePlayer();
        player.q = ash.q; player.r = ash.r;
        for (let d = 10; d < 600; d++) {
            for (const site of NpcTheft.playerSites(player, world)) expect(NpcTheft.planPlayerBurglary(world, player, site, d)).toBe(null);
        }
    });

    it('a stout lock and a watchdog keep most thieves off; the strongbox holds against the unskilled', () => {
        const bare = robbedDays(makePlayer());
        const kept = robbedDays(makePlayer({ upgrades: ['stout_lock', 'watchdog'] }));
        expect(bare).toBeGreaterThan(0);
        expect(kept).toBeLessThan(bare);
        expect(NpcTheft.defencesAt(makePlayer({ upgrades: ['stout_lock'] }), 5, 7).door).toBeGreaterThan(NpcTheft.defencesAt(makePlayer(), 5, 7).door);
        // A clumsy thief can't open the iron-bound strongbox
        const { world, ash } = makeWorld();
        const player = makePlayer();
        const site = NpcTheft.playerSites(player, world)[0];
        const e = NpcTheft.commitPlayerBurglary(world, player, {
            key: 'k', day: 20, site, s: ash, thief: { name: 'Wat', kind: 'beggar', skill: 1 }, force: false, caught: false, defences: NpcTheft.defencesAt(player, 5, 7),
        });
        expect(site.pieces[0].storage).toEqual({ gold: 40, jewelry: 2 });
        expect(e.heldBox).toBe('Iron-bound Strongbox');
        expect(e.coin).toBe(0);
    });

    it('recovery: the watch catches the thief and the player gets the goods back in town', () => {
        const { world, ash } = makeWorld();
        const player = makePlayer();
        const site = NpcTheft.playerSites(player, world)[0];
        const thiefP = Townsfolk.residents(ash.folk).find(p => p.role === 'villager');
        const thief = NpcTheft.thiefOf(ash, thiefP, 20);
        const e = NpcTheft.commitPlayerBurglary(world, player, { key: 'k2', day: 20, site, s: ash, thief: { ...thief, skill: 9 }, force: true, caught: false, defences: NpcTheft.defencesAt(player, 5, 7) });
        const goods = { ...e.goods };
        const coin = e.coin;
        expect(coin).toBeGreaterThan(0); // the strongbox forced by a skilled hand
        expect(NpcTheft.report(player, world, e.id).ok).toBe(true);
        // Run the days until the watch has them (reported and named: likelier)
        e.named = true;
        for (let d = 21; d < 400 && e.status === 'open'; d++) { e.fenceDay = d + 5; NpcTheft._caseDay(world, ash, e, d, player, true); }
        expect(e.status).toBe('held');
        const gold = player.gold;
        player.q = ash.q; player.r = ash.r;
        e.told = true;
        const out = NpcTheft.processDay(world, player);
        expect(out.notices.some(n => n.title === 'Goods Returned')).toBe(true);
        expect(e.status).toBe('returned');
        expect(player.gold).toBe(gold + e.coin);
        for (const [id, n] of Object.entries(goods)) expect(player.inventory[id]).toBe(n);
    });

    it('a townsperson who saw the thief at the player\'s door tells them who', async () => {
        const { StreetCrime } = await import('../systems/streetCrime.js');
        const { world, ash } = makeWorld();
        const witness = { name: 'Old Brom', type: 'villager' };
        StreetCrime.recordNpcCrime(world, ash, { k: 'burglary', by: 'Wat Tyler', victim: 'Aldric', vuid: 'player', d: 20, seenBy: ['Old Brom'], witnesses: [witness] });
        expect(StreetCrime.npcCrimeLine(witness, makePlayer())).toMatch(/Wat Tyler/);
        expect(StreetCrime.npcCrimeLine(witness, makePlayer())).toBe(null); // told once
    });

    it('confronting a named thief in town', () => {
        const { world, ash } = makeWorld();
        const player = makePlayer();
        player.q = ash.q; player.r = ash.r;
        const thiefP = Townsfolk.residents(ash.folk).find(p => p.role === 'villager');
        const book = NpcTheft.book(player);
        const e = { id: book.nextId++, k: 'pickpocket', d: 20, q: ash.q, r: ash.r, town: ash.name, thief: NpcTheft.thiefOf(ash, thiefP, 20), coin: 5, goods: {}, status: 'open', named: true, clues: [] };
        book.entries.push(e);
        thiefP.purse = 20;
        expect(NpcTheft.canConfront(player, world, e)).toBe(true);
        const res = NpcTheft.confront(player, world, e.id);
        expect(['returned', 'open']).toContain(e.status);
        if (res.ok) expect(thiefP.purse).toBe(15);
        else expect(e.denied).toBe(true);
    });
});

describe('cutpurses', () => {
    it('a lift resolves the same under the seed, and never touches the shared dice', () => {
        Utils.setSeed(9);
        const first = Utils.random();
        Utils.setSeed(9);
        const a = NpcTheft.lift(4, 0.3, 'key|1');
        expect(NpcTheft.lift(4, 0.3, 'key|1')).toEqual(a);
        const { world } = makeWorld();
        const player = makePlayer();
        for (let d = 10; d < 60; d++) { world.day = d; NpcTheft.processDay(world, player); }
        expect(Utils.random()).toBe(first);
    });

    it('robbing the player moves the coin to the thief, and the player is told', () => {
        const { world, ash } = makeWorld();
        const player = makePlayer();
        const thiefP = Townsfolk.residents(ash.folk).find(p => p.role === 'villager');
        const thief = NpcTheft.thiefOf(ash, thiefP, 10);
        const before = Townsfolk.purse(ash.folk, thiefP, world);
        const res = NpcTheft.liftFromPlayer(world, player, ash, thief, 'k', { result: { ok: true, noticed: false } });
        expect(res.coin).toBeGreaterThan(0);
        expect(player.gold).toBe(300 - res.coin);
        expect(Townsfolk.purse(ash.folk, thiefP, world)).toBe(before + res.coin);
        expect(res.text).toMatch(/Your purse feels light… \d+ gold/);
        expect(NpcTheft.openCases(player, ash.q, ash.r)[0].k).toBe('pickpocket');
        // Wary after: harder to rob again for a while
        expect(NpcTheft.awareness('player', player, world.day)).toBeGreaterThan(NpcTheft.awareness('player', makePlayer(), world.day));
    });

    it('a noticed lift is the thief\'s crime on the town\'s record; the mark remembers', () => {
        const { world, ash } = makeWorld();
        const thiefP = Townsfolk.residents(ash.folk).find(p => p.role === 'villager');
        const mark = Townsfolk.residents(ash.folk).find(p => p.role === 'merchant' && p !== thiefP);
        const purse = Townsfolk.purse(ash.folk, mark, world);
        const c = NpcTheft.liftFromNpc(world, ash, { thief: NpcTheft.thiefOf(ash, thiefP, 10), mark, key: 'n', result: { ok: false, noticed: true }, caught: false });
        expect(c.status).toBe('noticed');
        expect(Townsfolk.purse(ash.folk, mark, world)).toBe(purse);
        expect(ash.npcCrimes[ash.npcCrimes.length - 1]).toMatchObject({ k: 'pickpocket', by: Townsfolk.name(thiefP), caught: false });
        expect(mark.log.some(e => e.k === 'pickpocketed')).toBe(true);
        // Unnoticed: the coin moves, mark to thief
        const c2 = NpcTheft.liftFromNpc(world, ash, { thief: NpcTheft.thiefOf(ash, thiefP, 10), mark, key: 'n2', result: { ok: true, noticed: false } });
        expect(c2.status).toBe(c2.coin > 0 ? 'done' : 'failed');
        expect(Townsfolk.purse(ash.folk, mark, world)).toBe(purse - c2.coin);
    });

    it('fewer where the watch walks, and in a crackdown', () => {
        const { ash } = makeWorld();
        expect(NpcTheft.watchFactor(ash, 6)).toBeLessThan(NpcTheft.watchFactor(ash, 0));
        const calm = NpcTheft.watchFactor(ash);
        NpcTheft.state(ash).heat = 20;
        expect(NpcTheft.watchFactor(ash)).toBeLessThan(calm);
    });

    it('the background rate stays quiet: a few lifts a season, and the town talks of it only now and then', () => {
        const { world, ash } = makeWorld();
        let lifts = 0;
        for (let d = 10; d < 130; d++) { world.day = d; if (NpcTheft.pickNpcs(world, ash, d)) lifts++; }
        expect(lifts).toBeLessThan(60);
        const talk = ash.folk.annals.filter(a => a.k === 'npcTheft' && /Cutpurses/.test(a.x));
        expect(talk.length).toBeLessThanOrEqual(4);
    });
});

describe('saves', () => {
    it('old saves: no theft state anywhere still runs; a world day with no player too', () => {
        const { world, ash } = makeWorld();
        delete ash.npcTheft;
        const player = { name: 'Old', q: 1, r: 1, gold: 10, inventory: {} };
        expect(() => NpcTheft.processDay(world, player)).not.toThrow();
        expect(() => NpcTheft.processDay(world, null)).not.toThrow();
        expect(NpcTheft.book(player).entries).toEqual([]);
        expect(JSON.parse(JSON.stringify(ash.npcTheft)).cases).toBeDefined();
    });

    it('the strongbox of a household is a real container store, stocked from the market', () => {
        const { world, ash } = makeWorld();
        const pid = ash.folk.people[0].id;
        const { stores } = NpcTheft._houseStores(world, ash, pid);
        expect(stores.length).toBe(1);
        expect(ash.larders[stores[0].key]).toBe(stores[0].rec);
        for (const id of Object.keys(stores[0].rec.stock)) expect(Containers.good(id).basePrice).toBeGreaterThan(0);
    });
});

describe('the household\'s pantry (systems/townTrade.js larders and purses)', () => {
    /** A roster town whose households have shopped a few times (their larders stocked, their purses full). */
    function stocked() {
        const { world, ash } = makeWorld(40);
        ash.population = 3000;
        for (const id of SettlementMarket.config().goodIds) if (SettlementMarket.tracks(id)) ash.market.stock[id] = SettlementMarket.target(ash, id) * 2;
        for (const p of ash.folk.people) p.purse = Townsfolk.age(p, world.day) >= 16 ? 40 : 0;
        for (let i = 0; i < 3; i++) { TownTrade.step(world, ash, world.day); world.day += 4; }
        return { world, ash };
    }
    /** A plan aimed at a household with food in its larder (never the thief's own). */
    function planAtPantry(world, ash) {
        const plan = { ...nextPlan(world, ash, world.day), caught: false, seen: false };
        const thief = Townsfolk.get(ash.folk, plan.thief.pid);
        const tkey = thief ? TownTrade.hhKey(ash.folk, thief, world.day) : null;
        const head = Townsfolk.residents(ash.folk).find(p => {
            if (Townsfolk.age(p, world.day) < 16 || p.id === plan.thief.pid) return false;
            const pan = TownTrade.pantryOf(ash, p, world.day);
            return pan && pan.key !== tkey && pan.H && Object.values(pan.H.l).some(n => n > 0.005) && pan.hh.adults.length >= 1;
        });
        world.day = plan.day;
        return { plan: { ...plan, target: { ...plan.target, pid: head.id } }, head };
    }
    const goods = (s, cases = []) => {
        const o = {};
        const add = (id, n) => { o[id] = (o[id] || 0) + n; };
        for (const [id, n] of Object.entries((s.market && s.market.stock) || {})) add(id, n);
        const h = TownTrade.holdings(s);
        for (const [id, n] of Object.entries(h.goods)) add(id, n);
        for (const [id, n] of Object.entries(h.gone)) add(id, n);
        for (const rec of Object.values(s.larders || {})) for (const [id, n] of Object.entries(rec.stock || {})) add(id, n);
        for (const c of cases) if (c.status === 'open') for (const [id, n] of Object.entries(c.goods || {})) add(id, n);
        return o;
    };
    const coin = (s) => s.economy.gold + TownTrade.holdings(s).coin + s.folk.people.reduce((t, p) => t + (typeof p.purse === 'number' ? p.purse : 0), 0);

    it('a burglar takes food and small goods out of the larder and coin from everyone who eats there; nothing is made or lost', () => {
        const { world, ash } = stocked();
        const { plan, head } = planAtPantry(world, ash);
        const pan = TownTrade.pantryOf(ash, head, plan.day);
        NpcTheft._houseStores(world, ash, head.id);
        const larder0 = { ...pan.H.l };
        const g0 = goods(ash), c0 = coin(ash);
        const c = NpcTheft.commitBurglary(world, ash, plan);
        expect(c.status).toBe('open');
        const fromPantry = c.from[`tt|${pan.key}`];
        expect(fromPantry).toBeTruthy();
        for (const [id, n] of Object.entries(fromPantry)) {
            expect(n).toBeGreaterThan(0);
            expect(larder0[id] - (pan.H.l[id] || 0)).toBeCloseTo(n, 6);
        }
        expect(pan.H.robbed).toBe(plan.day);
        // Coin from the purses of the household's grown people, all of them
        for (const id of Object.keys(c.purses)) expect(pan.hh.adults.some(a => a.id === Number(id)) || Number(id) === head.spouse).toBe(true);
        // Conserved: the goods in the thief's hands, the coin in the thief's purse
        const g1 = goods(ash, [c]);
        for (const id of Object.keys({ ...g0, ...g1 })) expect(g1[id] || 0, id).toBeCloseTo(g0[id] || 0, 6);
        expect(coin(ash)).toBeCloseTo(c0, 6);
        // Fenced into the market as before (the fence paid out of the town's purse): still nothing made
        NpcTheft._fence(world, ash, c, null);
        const g2 = goods(ash, [c]);
        for (const id of Object.keys({ ...g0, ...g2 })) expect(g2[id] || 0, id).toBeCloseTo(g0[id] || 0, 1);
        expect(coin(ash)).toBeCloseTo(c0, 6);
    });

    it('the household goes short and buys it again at its next market step', () => {
        const { world, ash } = stocked();
        const { plan, head } = planAtPantry(world, ash);
        const pan = TownTrade.pantryOf(ash, head, plan.day);
        const c = NpcTheft.commitBurglary(world, ash, plan);
        const taken = c.from[`tt|${pan.key}`] || {};
        const id = Object.keys(taken)[0];
        expect(id).toBeTruthy();
        const short = pan.H.l[id] || 0;
        ash.market.stock[id] = SettlementMarket.target(ash, id) * 2;
        const bought = ash.townTrade.book.bought || 0;
        world.day = plan.day + 4;
        TownTrade.step(world, ash, world.day);
        expect(ash.townTrade.book.bought).toBeGreaterThan(bought);
        expect(TownTrade.pantryOf(ash, head, world.day).H.l[id] || 0).toBeGreaterThan(short);
    });

    it('caught later, the watch puts the goods back in the larder', () => {
        const { world, ash } = stocked();
        const { plan, head } = planAtPantry(world, ash);
        const pan = TownTrade.pantryOf(ash, head, plan.day);
        const before = { ...pan.H.l };
        const c = NpcTheft.commitBurglary(world, ash, plan);
        expect(NpcTheft.catchCase(world, ash, c)).toBe(true);
        for (const [id, n] of Object.entries(before)) expect(pan.H.l[id] || 0, id).toBeCloseTo(n, 6);
    });

    it('a town that keeps no trade yet (an old save) is robbed as before', () => {
        const { world, ash } = makeWorld();
        const plan = { ...nextPlan(world, ash), caught: false };
        const { pantry } = NpcTheft._houseStores(world, ash, plan.target.pid);
        expect(pantry).toBe(null);
        const c = NpcTheft.commitBurglary(world, ash, plan);
        expect(Object.keys(c.from).some(k => k.startsWith('tt|'))).toBe(false);
    });
});

describe('no thieves in a hamlet, nor in a village at the dawn', () => {
    it('hasThieves weighs the size and the age', async () => {
        const { NpcTheft: T } = await import('../systems/npcTheft.js');
        expect(T.hasThieves({}, { type: 'village', population: 60 })).toBe(false);
        expect(T.hasThieves({}, { type: 'village', population: 300 })).toBe(true);
        expect(T.hasThieves({ dawn: true }, { type: 'village', population: 300 })).toBe(false);
        expect(T.hasThieves({ dawn: true }, { type: 'town', population: 250 })).toBe(false);
        expect(T.hasThieves({ dawn: true }, { type: 'town', population: 900 })).toBe(true);
        expect(T.hasThieves({}, { type: 'city' })).toBe(true);
    });
});
