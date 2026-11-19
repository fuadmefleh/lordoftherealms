/**
 * Price news (systems/priceNews.js): word of the markets travels at the
 * pace of travellers. Notable moves become news that spreads town to town;
 * the player hears it where it has reached (dated, sourced, with a trust);
 * caravans act only on what their town has heard; price letters by courier
 * or merchant and correspondents arrive after the real travel, priced as of
 * the day written; rivals plant false talk and the player can too (fees go
 * to real purses, a lie is found out by a visit, a lure costs the rival);
 * save round trip; the world's half runs with no player.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { PriceKnowledge } from '../systems/priceKnowledge.js';
import { PriceNews } from '../systems/priceNews.js';
import { Underworld } from '../systems/underworld.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let _saved = null;
function tune(fn) {
    const d = DataLoader._gamedata.priceKnowledge;
    if (!_saved) _saved = JSON.parse(JSON.stringify(d));
    if (!d.news) d.news = {};
    fn(d.news);
}
afterEach(() => {
    if (_saved) DataLoader._gamedata.priceKnowledge = _saved;
    _saved = null;
    Utils.resetRng();
});

/** Towns in a row on plains, 4 hexes apart; the player stands in the first. */
function fixture(n = 6) {
    const towns = [];
    const tiles = new Map();
    const types = ['town', 'town', 'village', 'city', 'town', 'village', 'town', 'town'];
    for (let i = 0; i < n; i++) {
        const s = { name: `T${i}`, type: types[i % types.length], population: 3000 + i * 500, kingdom: 'k1', q: 2 + i * 4, r: 5, economy: { gold: 1000 } };
        SettlementMarket.ensure(s);
        towns.push(s);
        tiles.set(`${s.q},${s.r}`, { q: s.q, r: s.r, terrain: { id: 'plains', passable: true }, resource: null, settlement: s });
    }
    const kingdoms = [{ id: 'k1', name: 'Aster', isAlive: true, wars: [] }];
    const world = {
        width: 80, height: 40, day: 30, activeEvents: [], units: [], kingdoms, generationParams: { seed: 77 },
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || { q, r, terrain: { id: 'plains', passable: true } },
        getSettlementViews: () => towns, getAllSettlements: () => towns,
    };
    const player = { q: towns[0].q, r: towns[0].r, gold: 5000, inventory: {}, skills: { commerce: 0 }, reputation: {}, name: 'Tester', karma: 0, renown: 0 };
    return { world, player, towns };
}

const purses = (towns) => Utils.cents(towns.reduce((a, s) => a + s.economy.gold, 0));

/** Every town's grain at its target (nothing newsworthy), then a famine in one. */
function famine(towns, i) {
    for (const s of towns) for (const id of SettlementMarket.config().goodIds) if (s.market.stock[id] !== undefined) s.market.stock[id] = SettlementMarket.target(s, id);
    towns[i].market.stock.grain = 0;
}

function days(world, player, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        world.day++;
        out.push(PriceNews.processDay(world, player));
    }
    return out;
}

describe('news of the markets', () => {
    it('a dearth becomes news that starts in its town and spreads at the pace of travellers', () => {
        const { world, towns } = fixture();
        famine(towns, 3);
        expect(PriceNews.scan(world)).toBeGreaterThan(0);
        const n = PriceNews.state(world).news.find(x => x.g === 'grain' && x.q === towns[3].q);
        expect(n).toBeTruthy();
        expect(n.k).toBe('dear');
        expect(n.f).toBe(0);
        expect(n.w).toBeGreaterThan(0);
        // Known at home at once; 12 hexes away only after ceil(12 / 2.5) = 5 days
        expect(PriceNews.knownAt(world, n, towns[3].q, towns[3].r, 30)).toBe(true);
        expect(PriceNews.arrives(world, n, towns[0].q, towns[0].r)).toBe(35);
        expect(PriceNews.knownAt(world, n, towns[0].q, towns[0].r, 34)).toBe(false);
        expect(PriceNews.knownAt(world, n, towns[0].q, towns[0].r, 35)).toBe(true);
        // A second look does not repeat the same news while it lasts
        PriceNews.scan(world);
        expect(PriceNews.state(world).news.filter(x => x.g === 'grain' && x.q === towns[3].q).length).toBe(1);
        // Over: the news goes out of date (still travelling)
        towns[3].market.stock.grain = SettlementMarket.target(towns[3], 'grain');
        PriceNews.scan(world);
        expect(n.ended).toBe(30);
    });

    it('the player hears it only once it has reached their town: dated as of the telling, sourced, trusted less', () => {
        const { world, player, towns } = fixture();
        famine(towns, 3);
        PriceNews.processDay(world, player);
        expect(PriceKnowledge.quote(player, world, towns[3].q, towns[3].r, 'grain')).toBe(null);
        const out = days(world, player, 5);
        const q = PriceKnowledge.quote(player, world, towns[3].q, towns[3].r, 'grain');
        expect(q).toBeTruthy();
        expect(q.src).toBe('r');
        expect(q.day).toBe(30);
        expect(q.age).toBe(5);
        expect(q.trust).toBeGreaterThanOrEqual(40);
        expect(q.trust).toBeLessThan(90);
        expect(q.via).toMatch(/T3/);
        expect(out.at(-1).notices.some(x => x.title === 'Word on the Road')).toBe(true);
        expect(PriceNews.playerState(player).heard.length).toBe(1);
        // A visit is trusted more than talk, and trust fades with age
        expect(PriceKnowledge.trust('v', 0)).toBe(100);
        expect(PriceKnowledge.trust('v', 60)).toBeLessThan(100);
    });

    it('caravans act only on what their town has heard: likelier on the road, and carrying a little more', () => {
        const { world, towns } = fixture();
        famine(towns, 3);
        towns[0].market.stock.grain = SettlementMarket.target(towns[0], 'grain') * 3;
        PriceNews.scan(world);
        // Not yet heard in T0 (5 days away)
        expect(PriceNews.linkFactor(world, towns[0], towns[3], 31)).toBe(1);
        expect(PriceNews.extraCargo(world, towns[0], towns[3], 31)).toEqual([]);
        // Heard: the road draws them, and grain is taken from T0's stalls for the trip
        expect(PriceNews.linkFactor(world, towns[0], towns[3], 35)).toBeGreaterThan(1);
        const before = SettlementMarket.stock(towns[0], 'grain');
        const extra = PriceNews.extraCargo(world, towns[0], towns[3], 35);
        expect(extra.length).toBe(1);
        expect(extra[0].good).toBe('grain');
        expect(extra[0].qty).toBeGreaterThan(0);
        expect(extra[0].cost).toBeGreaterThan(0);
        expect(Utils.cents(extra[0].cost)).toBe(extra[0].cost);
        expect(SettlementMarket.stock(towns[0], 'grain')).toBeCloseTo(before - extra[0].qty, 2);
        // Without news there is no effect at all
        const quiet = fixture();
        expect(PriceNews.linkFactor(quiet.world, quiet.towns[0], quiet.towns[3], 40)).toBe(1);
    });

    it('a town with grain to spare that heard of the dearth sends a caravan, off its usual links; the dear town pays on arrival', async () => {
        const { MerchantCaravans } = await import('../systems/merchantCaravans.js');
        const { world, towns } = fixture();
        famine(towns, 3);
        towns[1].market.stock.grain = SettlementMarket.target(towns[1], 'grain') * 3;
        PriceNews.scan(world);
        const n = PriceNews.state(world).news.find(x => x.g === 'grain' && x.q === towns[3].q);
        // Not yet heard in T1 (8 hexes: 4 days): no run
        expect(PriceNews.runCandidates(world, 31, 2).length).toBe(0);
        // Heard in T1 and T5 (both 8 hexes); T1 has the grain to spare
        const c = PriceNews.runCandidates(world, 34, 2);
        expect(c.length).toBe(1);
        expect(c[0].from).toBe(towns[1]);
        expect(c[0].to).toBe(towns[3]);
        expect(c[0].qty).toBeGreaterThan(0);
        // The caravan sets out (no trade link between T1 and T3 needed)
        world.day = 34;
        const stock0 = SettlementMarket.stock(towns[1], 'grain');
        const coin0 = purses(towns);
        const st = MerchantCaravans.state(world);
        expect(MerchantCaravans._newsRuns(world, null, st, 34)).toBe(1);
        const u = MerchantCaravans.traders(world)[0];
        expect(u.onNews.id).toBe(n.id);
        expect(u.cargo.grain).toBeGreaterThan(0);
        expect(MerchantCaravans.describe(u)).toMatch(/heard grain is dear there/);
        expect(SettlementMarket.stock(towns[1], 'grain')).toBeCloseTo(stock0 - u.cargo.grain, 2);
        expect(n.runs).toBe(1);
        expect(PriceNews.state(world).stats.runs).toBe(1);
        // Not again for runGap days
        expect(PriceNews.runCandidates(world, 35, 2).length).toBe(0);
        // Arrival: the grain lands in T3, which pays T1 (coin moves, none is made)
        const g3 = SettlementMarket.stock(towns[3], 'grain');
        const t1 = towns[1].economy.gold;
        MerchantCaravans._arrive(world, null, st, u, { notices: [] });
        expect(SettlementMarket.stock(towns[3], 'grain')).toBeGreaterThan(g3);
        expect(towns[1].economy.gold).toBeGreaterThan(t1);
        expect(purses(towns)).toBeCloseTo(coin0, 2);
    });
});

describe('price news by post', () => {
    it('a price letter by your own rider: paid to real purses, written the day it reaches the town, home after the ride back', () => {
        const { world, player, towns } = fixture();
        const opts = PriceNews.letterOptions(player, world, towns[2].q, towns[2].r);
        const own = opts.find(o => o.id === 'own');
        expect(own).toBeTruthy();
        expect(own.out).toBeGreaterThan(0);
        const coin0 = Utils.cents(player.gold + purses(towns));
        const res = PriceNews.orderLetter(player, world, towns[2].q, towns[2].r, 'own');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(Utils.cents(5000 - own.price));
        expect(Utils.cents(player.gold + purses(towns))).toBe(coin0);
        // The market moves before the request arrives: the letter tells the day it was written
        towns[2].market.stock.grain = 0;
        const L = PriceNews.playerState(player).letters[0];
        let got = null;
        for (let i = 0; i < own.days + 1 && !got; i++) {
            world.day++;
            const out = PriceNews.processDay(world, player);
            if (out.letters.length) got = { day: world.day, out };
        }
        expect(got).toBeTruthy();
        expect(got.day).toBe(30 + own.days);
        const q = PriceKnowledge.quote(player, world, towns[2].q, towns[2].r, 'grain');
        expect(q.src).toBe('l');
        expect(q.day).toBe(L.writeDay);
        expect(L.writeDay).toBe(30 + own.out);
        expect(q.scarcity).toBeGreaterThan(1.5);
    });

    it("a merchant's letter is written there today and travels at a merchant's pace; out of range it is refused", () => {
        const { world, player, towns } = fixture(8);
        const m = PriceNews.letterOptions(player, world, towns[3].q, towns[3].r).find(o => o.id === 'merchant');
        expect(m.ok).toBe(true);
        expect(m.out).toBe(0);
        const res = PriceNews.orderLetter(player, world, towns[3].q, towns[3].r, 'merchant');
        expect(res.success).toBe(true);
        const L = PriceNews.playerState(player).letters[0];
        expect(L.writeDay).toBe(30);
        expect(L.snap).toBeTruthy();
        const far = PriceNews.letterOptions(player, world, towns[7].q, towns[7].r).find(o => o.id === 'merchant');
        expect(far.ok).toBe(false);
        expect(PriceNews.orderLetter(player, world, towns[7].q, towns[7].r, 'merchant').success).toBe(false);
    });

    it('a correspondent writes on schedule wherever the player is, paid into their town; unpaid they quit', () => {
        const { world, player, towns } = fixture();
        expect(PriceNews.hireCorrespondent(player, world, 7).success).toBe(true);
        player.q = towns[2].q;
        const wage = PriceNews.wage(towns[0].type);
        const t0 = towns[0].economy.gold;
        const outs = days(world, player, 12);
        expect(towns[0].economy.gold).toBe(Utils.cents(t0 + wage));
        expect(outs.some(o => o.letters.some(L => L.kind === 'corr'))).toBe(true);
        expect(PriceKnowledge.quote(player, world, towns[0].q, towns[0].r, 'grain').src).toBe('k');
        player.gold = 0;
        days(world, player, 14);
        expect(PriceNews.correspondents(player).length).toBe(0);
    });
});

describe('false news', () => {
    it('a rival House with a grudge plants a lie near the player; the player hears it; a visit finds it out', () => {
        tune(n => { n.rivalPlants = { chance: 1, everyDays: 7 }; });
        const { world, player, towns } = fixture();
        player.house = { rivals: { k9: { kingdomId: 'k9', name: 'House Vane', feud: 60, gold: 5000 } } };
        const t0 = towns[0].economy.gold;
        const out = PriceNews.processDay(world, player);
        const lie = PriceNews.state(world).news.find(n => n.f);
        expect(lie).toBeTruthy();
        expect(lie.by).toBe('House Vane');
        expect(lie.on).toBe('T0');
        // Paid for: out of the rival's purse into the town where it was put about
        expect(player.house.rivals.k9.gold).toBe(Utils.cents(5000 - 20));
        expect(towns[0].economy.gold).toBe(Utils.cents(t0 + 20));
        // Heard at once (it was planted where the player stands), as word on the road
        expect(out.heard.some(n => n.id === lie.id)).toBe(true);
        const q = PriceKnowledge.quote(player, world, lie.q, lie.r, lie.g);
        expect(q.src).toBe('r');
        expect(q.via).toMatch(/T0/);
        // The player goes to see for themselves
        const target = towns.find(s => s.q === lie.q);
        player.q = target.q;
        world.day++;
        PriceKnowledge.processDay(player, world);
        const res = PriceNews.processDay(world, player);
        const found = res.notices.find(x => x.title === 'False Price Talk');
        expect(found).toBeTruthy();
        expect(found.text).toMatch(/House Vane/);
        expect(PriceNews.playerState(player).stats.liesFound).toBe(1);
    });

    it('the player plants false talk: a fee to the town, a lure that costs the rival house, and maybe a trace', () => {
        tune(n => { n.plant = { caughtChance: 0, tracedChance: 1 }; });
        const { world, player, towns } = fixture();
        player.merchant = { rivals: [{ id: 'r1', name: 'Grey & Sons', status: 'active', capital: 10000, rivalry: 0, seat: { q: towns[1].q, r: towns[1].r }, posts: [] }] };
        // Too near to fool anyone
        expect(PriceNews.canPlant(player, world, player.q, player.r, 'grain', 'dear').ok).toBe(false);
        expect(PriceNews.canPlant(player, world, towns[1].q, towns[1].r, 'grain', 'dear').ok).toBe(true);
        const coin0 = Utils.cents(player.gold + purses(towns));
        const res = PriceNews.plant(player, world, towns[3].q, towns[3].r, 'grain', 'dear');
        expect(res.success).toBe(true);
        expect(Utils.cents(player.gold + purses(towns))).toBe(coin0);
        expect(res.news.f).toBe(1);
        expect(res.news.by).toBe('player');
        // Not news to the player, and no second lie before the talkers forget
        PriceNews.processDay(world, player);
        expect(PriceKnowledge.quote(player, world, towns[3].q, towns[3].r, 'grain')).toBe(null);
        expect(PriceNews.canPlant(player, world, towns[2].q, towns[2].r, 'grain', 'dear').ok).toBe(false);
        // After lureDays the rival who heard it has lost on the trip, its coin spent in its towns
        const coin1 = Utils.cents(player.gold + purses(towns) + player.merchant.rivals[0].capital);
        const outs = days(world, player, 15);
        const r = player.merchant.rivals[0];
        expect(r.capital).toBeLessThan(10000);
        expect(Utils.cents(player.gold + purses(towns) + r.capital)).toBe(coin1);
        expect(outs.some(o => o.notices.some(x => x.title === 'The Lure Worked'))).toBe(true);
        // Traced: heat in the realm and the rival house's anger
        expect(outs.some(o => o.notices.some(x => x.title === 'Traced to You'))).toBe(true);
        expect(Underworld.getHeat(player, 'k1')).toBeGreaterThan(0);
        expect(r.rivalry).toBeGreaterThan(0);
    });
});

describe('the price book shows age, source and trust', () => {
    it('tavern talk, merchants met and rumours each carry a trust; letters and visits are surest', () => {
        const { world, player, towns } = fixture();
        PriceKnowledge.learn(player, world, towns[1], 'grain', 3, 30, 't');
        PriceKnowledge.learn(player, world, towns[2], 'grain', 3, 30, 'r', null, { trust: 61, via: 'talk heard in T0', news: 9 });
        const k = Object.fromEntries(PriceKnowledge.known(player, world, 'grain').map(x => [x.name, x]));
        expect(k.T1.trust).toBe(40);
        expect(k.T2.trust).toBe(61);
        expect(k.T2.via).toBe('talk heard in T0');
        expect(k.T2.news).toBe(9);
        expect(PriceKnowledge.sourceInfo('l').name).toMatch(/letter/);
        expect(PriceNews.trustWord(95)).toBe('sure');
        expect(PriceNews.trustWord(30)).toBe('idle talk');
    });
});

describe('a real world', () => {
    it('news is found weekly, the world half runs with no player, and it all survives a save', () => {
        const game = newGame(9191);
        for (let i = 0; i < 15; i++) endDay(game);
        const st = game.world.priceNews;
        expect(st).toBeTruthy();
        expect(st.lastScan).not.toBe(null);
        expect(st.stats.found).toBeGreaterThan(0);
        // (the afterlife's world tick: no player)
        game.world.day += 7;
        PriceNews.processDay(game.world, null);
        expect(game.world.priceNews.lastScan).toBe(game.world.day);
        game.world.day -= 7;
        game.player.priceLetters = PriceNews._blankPlayer();
        game.player.priceLetters.corr.push({ id: 1, q: 0, r: 0, n: 'X', t: 'town', every: 7, nextDay: 99, unpaid: 0, since: 1, letters: 0 });
        const back = roundTrip(game);
        expect(JSON.stringify(back.world.priceNews)).toBe(JSON.stringify(game.world.priceNews));
        expect(back.player.priceLetters.corr.length).toBe(1);
    });
});
