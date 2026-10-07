// Underwriters (systems/underwriting.js, systems/lossBook.js): open cover
// priced from the real risk inputs (the season's storms, squadrons and
// pirates, raiders and lairs on the road, each store-room's thieves, sieges
// and crowns in crisis, the weather in the fields), claims paid on the losses
// the loss sites report (voyage events, storms, caravans taken, store-rooms
// robbed, works seized), the waiting period, war exclusions, investigated big
// claims, forged claims through the Thieves' Guild, underwriters failing,
// their books of other merchants' business, save round-trip with backfill,
// determinism — and that insurance is a fair bet the house wins.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Finance } from '../systems/finance.js';
import { Ships } from '../systems/ships.js';
import { Underworld } from '../systems/underworld.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { Underwriting } from '../systems/underwriting.js';
import { LossBook } from '../systems/lossBook.js';
import { Heralds } from '../systems/heralds.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { WorldUnit } from '../world/units.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

function fresh(seed = 4242) {
    const game = newGame(seed);
    game.world.day = 10;
    Finance.loadState(game.player, game.world);
    const st = Underwriting.state(game.player);
    Underwriting._init(game.world, game.player, st);
    game.player.gold = 50000;
    return game;
}

function bank(game) {
    return Finance.openBanks(game.player)[0];
}

function atBank(game, b = bank(game)) {
    game.player.q = b.q;
    game.player.r = b.r;
    return b;
}

/** Run the underwriting tick alone for n days. */
function tick(game, n = 1) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        game.world.day++;
        notices.push(...Underwriting.processDay(game.world, game.player).notices);
    }
    return notices;
}

function seaTile(game, near = null) {
    let best = null;
    for (const row of game.world.tiles) {
        for (const t of row) {
            if (!Ships.isWaterTile(t)) continue;
            const d = near ? Math.abs(t.q - near.q) + Math.abs(t.r - near.r) : 0;
            if (!best || d < best.d) best = { t, d };
        }
    }
    return best.t;
}

/** A ship of the player's out at sea, with cargo. */
function shipAtSea(game, cargo = { wine: 40, iron: 30 }, extra = {}) {
    const t = seaTile(game, { q: game.player.q, r: game.player.r });
    const ship = { id: `ship${(game.player.ships || []).length + 1}`, name: 'The Gull', typeId: 'cog', condition: 100, cargo: { ...cargo }, status: 'anchored', q: t.q, r: t.r, crew: 10, morale: 70, customizations: [], ...extra };
    game.player.ships = game.player.ships || [];
    game.player.ships.push(ship);
    return ship;
}

function open(game, kind, b = bank(game)) {
    atBank(game, b);
    const res = Underwriting.openCover(game.player, game.world, b.id, kind);
    expect(res.success, res.reason).toBe(true);
    return res.cover;
}

describe('quotes follow the real risk', () => {
    it('banking houses keep insurance desks and the great ports an underwriters\' guild', () => {
        const game = fresh();
        const all = Underwriting.underwriters(game.player);
        expect(all.filter(u => u.type === 'bank').length).toBe(Finance.openBanks(game.player).length);
        expect(all.filter(u => u.type === 'guild').length).toBeGreaterThan(0);
        const g = all.find(u => u.type === 'guild');
        expect(Ships.isPortTile(game.world, g.q, g.r)).toBe(true);
        expect(Underwriting.underwritersAt(game.player, game.world, game.world.getTile(g.q, g.r)).some(u => u.id === g.id)).toBe(true);
        // The same world places the same guilds
        const again = fresh();
        expect(Underwriting.underwriters(again.player).map(u => `${u.id}:${u.seat}:${Math.round(u.ref.capital)}`))
            .toEqual(all.map(u => `${u.id}:${u.seat}:${Math.round(u.ref.capital)}`));
    });

    it('marine cover prices storms, a worn hull, a voyage and pirates nearby', () => {
        const game = fresh();
        const ship = shipAtSea(game);
        const base = Underwriting.quote(game.player, game.world, 'marine');
        expect(base.items.length).toBe(1);
        expect(base.value).toBeGreaterThan(Ships.getShipValue(ship));
        expect(base.premium).toBeGreaterThan(0);
        // A docked ship is not at risk at sea
        ship.status = 'docked';
        expect(Underwriting.quote(game.player, game.world, 'marine').items.length).toBe(0);
        ship.status = 'anchored';
        // A leaking hull loses more to storms (Ships.leakFactor, read by the storms themselves)
        ship.condition = 20;
        expect(Ships.leakFactor(ship)).toBeGreaterThan(1);
        const worn = Underwriting.quote(game.player, game.world, 'marine');
        expect(worn.expected / worn.value).toBeGreaterThan(base.expected / base.value);
        ship.condition = 100;
        // Events at sea come with a voyage
        ship.voyage = { route: [], step: 0 };
        expect(Underwriting.quote(game.player, game.world, 'marine').expected).toBeGreaterThan(base.expected);
        delete ship.voyage;
        // Pirates in these waters
        const pirate = new WorldUnit('pirate', ship.q, ship.r, ship.q, ship.r);
        game.world.units.push(pirate);
        expect(Underwriting.quote(game.player, game.world, 'marine').expected).toBeGreaterThan(base.expected);
    });

    it('caravan cover prices raiders and lairs along the road; road wardens halve it', () => {
        const game = fresh();
        const s = game.world.getSettlementViews()[0];
        game.world.units = game.world.units.filter(u => u.type !== 'raider' && u.type !== 'pirate');
        game.player.caravans = [{ from: 'A', to: 'B', status: 'traveling', goods: { wine: 50 }, currentPos: { q: s.q, r: s.r }, fromPos: { q: s.q, r: s.r }, toPos: { q: s.q, r: s.r } }];
        const quiet = Underwriting.quote(game.player, game.world, 'caravan');
        game.world.units.push(new WorldUnit('raider', s.q + 1, s.r, s.q, s.r));
        const raided = Underwriting.quote(game.player, game.world, 'caravan');
        expect(raided.premium).toBeGreaterThan(quiet.premium * 3);
        game.player.caravans[0].roadLinked = true;
        expect(Underwriting.quote(game.player, game.world, 'caravan').premium).toBeCloseTo(raided.premium / 2, 5);
    });

    it('stock cover is each store-room\'s own theft chance: heat raises it', () => {
        const game = fresh();
        const s = game.world.getSettlementViews().find(x => x.kingdom != null);
        const mp = MerchantPrince.state(game.player);
        mp.warehouses.push({ id: 1, q: s.q, r: s.r, town: s.name, size: 'small', goods: { wine: 100 }, since: 0, nextRent: 99, unpaid: 0, arrears: 0 });
        const q1 = Underwriting.quote(game.player, game.world, 'stock');
        const p1 = MerchantPrince.theftChance(game.player, game.world, mp.warehouses[0]);
        Underworld.addHeat(game.player, s.kingdom, 80, game.world);
        const p2 = MerchantPrince.theftChance(game.player, game.world, mp.warehouses[0]);
        const q2 = Underwriting.quote(game.player, game.world, 'stock');
        expect(p2).toBeGreaterThan(p1);
        expect(q2.premium / q1.premium).toBeCloseTo(p2 / p1, 2);
        // The premium is the expected loss with the loading on top
        expect(q1.premium).toBeCloseTo(q1.expected * Underwriting.config().loading, 1);
    });

    it('crop cover prices the season and any drought on the land', () => {
        const game = fresh();
        const tile = game.world.getSettlementViews().map(s => game.world.getTile(s.q + 1, s.r)).find(t => t && t.terrain.passable && !t.settlement);
        const prop = { type: 'farm', productionRate: 6, level: 1, produces: 'grain' };
        tile.playerProperty = prop;
        game.player.properties = [{ q: tile.q, r: tile.r, type: 'farm' }];
        const at = (day) => { game.world.day = day; return Underwriting.quote(game.player, game.world, 'crop'); };
        const summer = at(45);
        const winter = at(105);
        expect(summer.items.length).toBe(1);
        // Winter's crop is small but its share lost to snow is large
        expect(winter.expected / winter.value).toBeGreaterThan(summer.expected / summer.value);
        game.world.day = 45;
        game.world.activeEvents = [{ id: 'drought', effects: { farmProduction: -0.4 }, global: true }];
        const dry = Underwriting.quote(game.player, game.world, 'crop');
        expect(dry.expected).toBeGreaterThan(summer.expected * 5);
    });

    it('your own recent claims put a surcharge on every premium', () => {
        const game = fresh();
        shipAtSea(game);
        const before = Underwriting.quote(game.player, game.world, 'marine').premium;
        const st = Underwriting.state(game.player);
        st.claims.push({ id: 'x1', status: 'paid', day: game.world.day, kind: 'marine' }, { id: 'x2', status: 'paid', day: game.world.day, kind: 'caravan' });
        const after = Underwriting.quote(game.player, game.world, 'marine').premium;
        expect(after / before).toBeCloseTo(1 + 2 * Underwriting.config().surchargePerClaim, 2);
    });
});

describe('claims on real losses', () => {
    it('cargo lost at sea is paid, less the deductible, from the underwriter\'s reserves', () => {
        const game = fresh();
        const ship = shipAtSea(game, { wine: 100 });
        const b = bank(game);
        open(game, 'marine', b);
        tick(game, 2);
        const gold = game.player.gold;
        const cap = b.capital;
        // A voyage event washes a quarter of the cargo over the side (systems/shipVoyages.js)
        Ships._applyVoyageOutcome(game.player, game.world, ship, { loseCargo: 0.25 }, [], 0);
        expect(ship.cargo.wine).toBe(75);
        const loss = LossBook.saleValue({ wine: 25 });
        const notes = tick(game, 1);
        const st = Underwriting.state(game.player);
        const claim = st.claims[st.claims.length - 1];
        expect(claim.status).toBe('paid');
        expect(claim.amount).toBeCloseTo(loss * (1 - Underwriting.config().deductible), 1);
        expect(notes.some(n => n.title === 'Claim Paid')).toBe(true);
        // The player is paid; the house's reserves carry it (less today's premium coming in)
        const premium = Underwriting.cover(game.player, 'marine').paid;
        expect(game.player.gold).toBeGreaterThan(gold);
        expect(b.capital).toBeLessThan(cap + premium);
    });

    it('a caravan taken on the road is paid; nothing is paid before the cover attaches', () => {
        const game = fresh();
        const s = game.world.getSettlementViews()[0];
        const caravan = () => ({ from: 'A', to: 'B', status: 'traveling', goods: { grain: 60 }, unitId: 'gone', currentPos: { q: s.q, r: s.r }, fromPos: { q: s.q, r: s.r }, toPos: { q: s.q, r: s.r } });
        open(game, 'caravan');
        // Lost on the day the cover is bought: not covered
        game.player.caravans = [caravan()];
        PlayerEconomy.updateCaravans(game.player, game.world);
        tick(game, 1);
        expect(Underwriting.state(game.player).claims.length).toBe(0);
        // Lost once it has attached: covered
        game.world.day++;
        game.player.caravans = [caravan()];
        PlayerEconomy.updateCaravans(game.player, game.world);
        tick(game, 1);
        const claims = Underwriting.state(game.player).claims;
        expect(claims.length).toBe(1);
        expect(claims[0].kind).toBe('caravan');
        expect(claims[0].status).toBe('paid');
    });

    it('a works seized by a crown in crisis is covered; war and a hostile town are not', () => {
        const game = fresh();
        open(game, 'works');
        tick(game, 4);
        for (const cause of ['war', 'expropriated', 'crisis']) LossBook.report(game.player, game.world, { kind: 'works', cause, value: 500 });
        tick(game, 1);
        const claims = Underwriting.state(game.player).claims;
        expect(claims.length).toBe(1);
        expect(claims[0].cause).toBe('crisis');
    });

    it('a big claim goes to the assessors first and is paid when they report', () => {
        const game = fresh();
        open(game, 'stock');
        tick(game, 3);
        LossBook.report(game.player, game.world, { kind: 'stock', cause: 'thieves', value: 3000 });
        tick(game, 1);
        const claim = Underwriting.state(game.player).claims[0];
        expect(claim.status).toBe('pending');
        const gold = game.player.gold;
        tick(game, claim.dueDay - game.world.day);
        expect(claim.status).toBe('paid');
        expect(game.player.gold - gold).toBeCloseTo(2700, 0);
    });

    it('losses with no cover are only losses', () => {
        const game = fresh();
        LossBook.report(game.player, game.world, { kind: 'marine', cause: 'storm', value: 400 });
        tick(game, 1);
        expect(Underwriting.state(game.player).claims.length).toBe(0);
        expect(LossBook.state(game.player).queue.length).toBe(0);
    });
});

describe('fraud', () => {
    function rogue(game, rank = 2) {
        const g = Underworld.ensure(game.player).guild;
        g.member = true;
        g.rank = rank;
    }

    it('needs the Thieves\' Guild and something covered to claim on', () => {
        const game = fresh();
        open(game, 'marine');
        tick(game, 2);
        atBank(game);
        expect(Underwriting.falseClaim(game.player, game.world, 'marine', 300).success).toBe(false);
        rogue(game);
        expect(Underwriting.falseClaim(game.player, game.world, 'marine', 300).success).toBe(false); // no ship at sea
        shipAtSea(game, { wine: 200 });
        const res = Underwriting.falseClaim(game.player, game.world, 'marine', 300);
        expect(res.success, res.reason).toBe(true);
        expect(res.fee).toBe(Math.ceil(300 * Underwriting.config().fraud.forgerFee));
        expect(res.claim.status).toBe('pending');
    });

    it('found out: no pay, a fine, heat, the cover cancelled and the office closed to you', () => {
        const game = fresh();
        const F = Underwriting.config().fraud;
        const saved = { ...F };
        try {
            F.caught = 1; F.minCaught = 1; F.maxCaught = 1;
            rogue(game);
            shipAtSea(game, { wine: 200 });
            const b = bank(game);
            open(game, 'marine', b);
            tick(game, 2);
            atBank(game, b);
            const res = Underwriting.falseClaim(game.player, game.world, 'marine', 300);
            const gold = game.player.gold;
            const heat = Underworld.getHeat(game.player, b.kingdomId);
            tick(game, res.claim.dueDay - game.world.day);
            expect(res.claim.status).toBe('denied');
            expect(game.player.gold).toBeLessThan(gold - 250); // the fine (premiums are small)
            expect(Underworld.getHeat(game.player, b.kingdomId)).toBeGreaterThan(heat);
            expect(Underwriting.cover(game.player, 'marine')).toBe(null);
            expect(Underwriting.banned(game.player, b.id, game.world.day)).toBe(true);
            atBank(game, b);
            expect(Underwriting.openCover(game.player, game.world, b.id, 'marine').success).toBe(false);
        } finally {
            Object.assign(F, saved);
        }
    });

    it('not found out: the forged loss is paid, and each claim makes the next riskier', () => {
        const game = fresh();
        const F = Underwriting.config().fraud;
        const saved = { ...F };
        try {
            F.caught = 0; F.minCaught = 0; F.perClaim = 0; F.bigShare = 0; F.perRank = 0;
            rogue(game);
            shipAtSea(game, { wine: 200 });
            open(game, 'marine');
            tick(game, 2);
            atBank(game);
            const res = Underwriting.falseClaim(game.player, game.world, 'marine', 300);
            tick(game, res.claim.dueDay - game.world.day);
            expect(res.claim.status).toBe('paid');
            expect(res.claim.paid).toBeCloseTo(300, 0);
        } finally {
            Object.assign(F, saved);
        }
        // The odds of being caught rise with the claims on your record
        const st = Underwriting.state(game.player);
        expect(st.stats.fraudPaid).toBeGreaterThan(0);
        expect(F.perClaim).toBeGreaterThan(0);
    });
});

describe('underwriters fail', () => {
    it('a guild that cannot meet a claim pays what it has and fails; its covers lapse; the heralds cry it', () => {
        const game = fresh();
        const g = Underwriting.underwriters(game.player).find(u => u.type === 'guild');
        game.player.q = g.q;
        game.player.r = g.r;
        expect(Underwriting.openCover(game.player, game.world, g.id, 'stock').success).toBe(true);
        tick(game, 3);
        g.ref.capital = 300;
        const gold = game.player.gold;
        LossBook.report(game.player, game.world, { kind: 'stock', cause: 'thieves', value: 600 });
        tick(game, 1);
        expect(g.ref.status).toBe('failed');
        expect(game.player.gold - gold).toBeCloseTo(300, 0);
        tick(game, 1);
        expect(Underwriting.cover(game.player, 'stock')).toBe(null);
        const st = Underwriting.state(game.player);
        expect(st.history.some(h => h.kind === 'underwriter_failed')).toBe(true);
        expect(Heralds._records(game.player).bourse.some(x => x.h.kind === 'underwriter_failed')).toBe(true);
        // A new guild opens at the seat after a while
        tick(game, Underwriting.config().guild.refoundDays + 1);
        expect(st.guilds.filter(x => x.status === 'open' && x.q === g.q && x.r === g.r).length).toBe(1);
    });

    it('their books bleed in war and a great storm; a guild run dry fails', () => {
        const game = fresh();
        const st = Underwriting.state(game.player);
        const g = st.guilds[0];
        const k = game.world.getKingdom(g.kingdomId);
        const peace = Underwriting._bookRisk(game.world, { kingdomId: k.id, q: g.q, r: g.r });
        k.wars = [...(k.wars || []), 'x', 'y'];
        expect(Underwriting._bookRisk(game.world, { kingdomId: k.id, q: g.q, r: g.r })).toBeGreaterThan(peace);
        const B = Underwriting.config().book.catastrophe;
        const saved = { ...B };
        try {
            B.chance = 1; B.loss = [0.9, 0.9];
            const out = { notices: [] };
            Utils.setSeed(5);
            Underwriting._bookWeek(game.world, game.player, st, out);
        } finally {
            Object.assign(B, saved);
        }
        expect(g.status).toBe('failed');
        expect(st.history.some(h => h.kind === 'catastrophe')).toBe(true);
    });

    it('a banking house\'s desk pays from its reserves: claims can empty them and start a run', () => {
        const game = fresh();
        const b = bank(game);
        open(game, 'stock', b);
        tick(game, 3);
        b.capital = 1000;
        LossBook.report(game.player, game.world, { kind: 'stock', cause: 'thieves', value: 600 });
        tick(game, 1);
        expect(b.capital).toBeLessThan(1000);
        b.capital = -5;
        Underwriting._bookWeek(game.world, game.player, Underwriting.state(game.player), { notices: [] });
        expect(Finance.inPanic(b, game.world.day) || b.status !== 'open').toBe(true);
    });
});

describe('a fair bet the house wins', () => {
    it('over a long run, premiums beat claims at sea and in the fields, and losses are paid', () => {
        const game = newGame(6060);
        Finance.loadState(game.player, game.world);
        game.player.gold = 1e6;
        const ship = shipAtSea(game, { wine: 150, iron: 100, cloth: 80 }, { status: 'anchored' });
        const tile = game.world.getSettlementViews().map(s => game.world.getTile(s.q + 1, s.r)).find(t => t && t.terrain.passable && !t.settlement);
        tile.playerProperty = { type: 'farm', productionRate: 6, level: 1, produces: 'grain' };
        game.player.properties = [{ q: tile.q, r: tile.r, type: 'farm' }];
        const st = Underwriting.state(game.player);
        for (let i = 0; i < 360; i++) {
            game.player.health = 100;
            game.player.starvationDays = 0;
            game.player.gold = 1e6;
            if (i === 1) {
                Underwriting._init(game.world, game.player, st);
                open(game, 'marine');
                open(game, 'crop');
            }
            // Keep the hold full and the hull sound, so every day carries the same risk
            ship.cargo = { wine: 150, iron: 100, cloth: 80 };
            ship.condition = 100;
            ship.status = 'anchored';
            endDay(game);
        }
        const byKind = st.stats.byKind;
        for (const kind of ['marine', 'crop']) {
            expect(byKind[kind].claims, `${kind} paid nothing`).toBeGreaterThan(0);
            expect(byKind[kind].claims, `${kind}: claims ${byKind[kind].claims} vs premiums ${byKind[kind].premium}`).toBeLessThan(byKind[kind].premium);
        }
    }, 120000);

    it('insuring and then losing on purpose never pays: the payout is under the loss', () => {
        const game = fresh();
        const ship = shipAtSea(game, { wine: 100 });
        open(game, 'marine');
        tick(game, 2);
        const worth = game.player.gold + LossBook.saleValue(ship.cargo);
        Ships._applyVoyageOutcome(game.player, game.world, ship, { loseCargo: 1 }, [], 0);
        tick(game, 1);
        expect(game.player.gold + LossBook.saleValue(ship.cargo)).toBeLessThan(worth);
    });
});

describe('save, load and determinism', () => {
    it('covers, claims and guilds survive a save round trip; an old save gets a fresh record', () => {
        const game = fresh();
        shipAtSea(game);
        open(game, 'marine');
        tick(game, 3);
        const before = JSON.stringify(game.player.underwriting);
        const g2 = roundTrip(game);
        expect(JSON.stringify(g2.player.underwriting)).toBe(before);
        // An old save: no underwriting record at all
        g2.player.underwriting = undefined;
        g2.player.lossBook = undefined;
        expect(Underwriting.loadState(g2.player, g2.world)).toBe(null);
        g2.world.day++;
        Underwriting.processDay(g2.world, g2.player);
        expect(Underwriting.state(g2.player).guilds.length).toBeGreaterThan(0);
    });

    it('the same seed books the same weeks, and the tick leaves the shared dice alone', () => {
        const run = () => {
            const game = fresh(919);
            Utils.setSeed(1);
            tick(game, 30);
            return { books: JSON.stringify(Underwriting.state(game.player).books), next: Utils.random() };
        };
        const a = run();
        const b = run();
        expect(a.books).toBe(b.books);
        Utils.setSeed(1);
        expect(a.next).toBe(Utils.random());
    });
});
