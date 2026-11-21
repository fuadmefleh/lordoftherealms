/**
 * Haggling face to face at a market stall (player/haggling.js): the keeper's
 * asking price from the market's own and what moves it (margin, mood and
 * traits, stock, the hour, the tongue), counteroffers that cost patience,
 * a refusal remembered on the townsperson for the day, and a struck deal that
 * moves the goods and coin exactly as the stall's trade does — to the cent,
 * and never inside the market's buy-and-sell-back gap.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData } from './playtest/harness.js';

let Haggling, SettlementMarket, Trading, NpcDisposition, Utils;

beforeAll(async () => {
    await loadData();
    ({ Haggling } = await import('../player/haggling.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    ({ Trading } = await import('../player/playerEconomy.js'));
    ({ NpcDisposition } = await import('../systems/npcDisposition.js'));
    ({ Utils } = await import('../core/utils.js'));
}, 120000);

const town = (extra = {}) => {
    const s = { name: 'Ashford', type: 'city', population: 6000, happiness: 50, culture: 'Imperial', q: 4, r: 4, buildWealth: { score: 0.6 }, economy: { gold: 50000 }, ...extra };
    SettlementMarket.ensure(s);
    return s;
};
const plains = (s) => ({ q: s.q, r: s.r, terrain: { id: 'plains', passable: true }, resource: null, settlement: s });
const player = (extra = {}) => ({ gold: 10000, inventory: {}, maxInventory: 99, skills: { commerce: 0 }, charisma: 5, strength: 5, languages: { vellish: 100 }, nativeLanguage: 'vellish', ...extra });
const keeper = (extra = {}) => ({ id: 7, name: 'Marta Hale', type: 'merchant', personalityTraits: [], ...extra });
const world = (day = 100) => ({ day });

function ctxOf(o = {}) {
    const s = o.settlement || town();
    return {
        player: o.player || player(), world: o.world || world(), settlement: s, tile: plains(s),
        npc: o.npc || keeper(), tradeId: o.tradeId || 'baker', goodId: o.goodId || 'bread',
        side: o.side || 'buy', qty: o.qty || 5, hour: o.hour != null ? o.hour : 10,
    };
}

describe('Haggling: the asking price', () => {
    it("starts from the market's price: the keeper asks above it and will go below it, never under the bound", () => {
        const ctx = ctxOf();
        const m = Haggling.market(ctx);
        expect(m.error).toBeUndefined();
        expect(m.list).toBe(Trading.buyCost(ctx.player, m.entry, 5, ctx.settlement));
        const q = Haggling.quote(ctx);
        expect(q.ask).toBeGreaterThan(q.list);
        expect(q.floor).toBeLessThan(q.list);
        expect(q.floor).toBeGreaterThanOrEqual(q.bound);
        expect(Utils.isCents(q.ask) && Utils.isCents(q.floor)).toBe(true);
        expect(q.factors.some(f => f.label === 'Their margin')).toBe(true);
    });

    it('is moved by their temper and their mood: a greedy keeper who dislikes you asks more', () => {
        const fair = Haggling.quote(ctxOf()).ask;
        const greedy = Haggling.quote(ctxOf({ npc: keeper({ personalityTraits: ['greedy'] }) })).ask;
        const sour = keeper();
        NpcDisposition.getMemory(sour).disposition = 10;
        const disliked = Haggling.quote(ctxOf({ npc: sour })).ask;
        const fond = keeper();
        NpcDisposition.getMemory(fond).disposition = 95;
        const liked = Haggling.quote(ctxOf({ npc: fond })).ask;
        expect(greedy).toBeGreaterThan(fair);
        expect(disliked).toBeGreaterThan(fair);
        expect(liked).toBeLessThan(fair);
    });

    it('is moved by the stock: a glut gives more than a dearth', () => {
        const glut = town(); glut.market.stock.bread = SettlementMarket.stock(glut, 'bread') * 4;
        const dear = town(); dear.market.stock.bread = Math.max(8, Math.floor(SettlementMarket.stock(dear, 'bread') / 4));
        const qg = Haggling.quote(ctxOf({ settlement: glut }));
        const qd = Haggling.quote(ctxOf({ settlement: dear }));
        // (as a share of each market's own price)
        expect(qg.floor / qg.list).toBeLessThan(qd.floor / qd.list);
    });

    it('sells cheaper at the end of the market day, perishables most', () => {
        const morning = Haggling.quote(ctxOf({ hour: 10 }));
        const dusk = Haggling.quote(ctxOf({ hour: 17.8 }));
        expect(Haggling.lateness(10)).toBe(0);
        expect(Haggling.lateness(17.8)).toBeGreaterThan(0.8);
        expect(dusk.ask).toBeLessThan(morning.ask);
        expect(dusk.floor).toBeLessThan(morning.floor);
        expect(dusk.factors.some(f => /End of the market day/.test(f.label))).toBe(true);
        // (bread spoils, tools do not: the keeper gives more on bread at dusk — down to the bound)
        const toolsAm = Haggling.quote(ctxOf({ tradeId: 'ironmonger', goodId: 'tools', qty: 1, hour: 10 }));
        const toolsPm = Haggling.quote(ctxOf({ tradeId: 'ironmonger', goodId: 'tools', qty: 1, hour: 17.8 }));
        expect(toolsAm.error).toBeUndefined();
        expect(dusk.give - morning.give).toBeGreaterThan(toolsPm.give - toolsAm.give);
        expect(dusk.floor).toBeGreaterThanOrEqual(dusk.bound);
    });
});

describe('Haggling: counteroffers and patience', () => {
    it('a low offer costs patience and moves their ask toward it', () => {
        const ctx = ctxOf();
        const { session } = Haggling.start(ctx);
        const p0 = session.patience, a0 = session.ask;
        const r = Haggling.respond(session, 'mid', ctx);
        if (r.over === 'deal') return; // (their walk-away was under 85%)
        expect(session.patience).toBeLessThan(p0);
        expect(session.ask).toBeLessThan(a0);
        expect(session.ask).toBeGreaterThanOrEqual(session.floor);
        expect(r.reply.length).toBeGreaterThan(0);
    });

    it('an offer above their walk-away: countered halfway while their patience lasts, taken as it runs short', () => {
        const ctx = ctxOf();
        const { session } = Haggling.start(ctx);
        session.floor = session.bound; // (they could live with a lot less)
        const offer = Haggling.offerFor(session, 'mid');
        const a0 = session.ask;
        const r = Haggling.respond(session, 'mid', ctx);
        expect(r.over).toBeNull();
        expect(session.ask).toBe(Math.ceil(((a0 + offer) / 2) * 100 - 1e-7) / 100);
        session.patience = 1;
        const offer2 = Haggling.offerFor(session, 'half');
        const r2 = Haggling.respond(session, 'half', ctx);
        expect(r2.over).toBe('deal');
        expect(session.price).toBe(Utils.cents(offer2));
    });

    it('push past their patience and they refuse you for the day, remembered on the townsperson', () => {
        const ctx = ctxOf();
        const { session } = Haggling.start(ctx);
        session.floor = session.ask; // (a keeper who will not come down)
        session.bound = session.ask;
        let r;
        for (let i = 0; i < 20 && !session.over; i++) r = Haggling.respond(session, 'low', ctx);
        expect(r.over).toBe('refused');
        const mem = NpcDisposition.getMemory(ctx.npc);
        expect(mem.haggleSpurned).toBe(100);
        expect(Haggling.spurned(ctx.npc, ctx.world)).toBe(true);
        expect(Haggling.start(ctx).ok).toBe(false);
        // ...the stall's ordinary trade too, today
        expect(NpcDisposition.getPriceModifiers(ctx.npc, { player: ctx.player, world: ctx.world }).refuses).toBe(true);
        // ...and tomorrow is another day
        const next = { ...ctx, world: world(101) };
        expect(Haggling.spurned(ctx.npc, next.world)).toBe(false);
        expect(Haggling.start(next).ok).toBe(true);
    });

    it('walking away may call them back once, at a better price', () => {
        const ctx = ctxOf();
        const { session } = Haggling.start(ctx);
        const a0 = session.ask;
        const r = Haggling.respond(session, 'walk', ctx);
        expect(r.calledBack).toBe(true);
        expect(session.ask).toBeLessThan(a0);
        const r2 = Haggling.respond(session, 'walk', ctx);
        expect(r2.over).toBe('walked');
    });

    it('a hard bargain leaves them grudging, paying their price leaves them warm', () => {
        const a = ctxOf();
        const s1 = Haggling.start(a).session;
        Haggling.respond(s1, 'accept', a);
        expect(s1.over).toBe('deal');
        expect(s1.mood).toBe('warm');
        const b = ctxOf({ npc: keeper({ id: 8 }) });
        const s2 = Haggling.start(b).session;
        s2.floor = s2.bound;
        s2.ask = s2.bound; // (talked right down to their floor)
        Haggling.respond(s2, 'accept', b);
        expect(s2.mood).toBe('grudging');
    });

    it('a deal trains Haggling', () => {
        const ctx = ctxOf();
        const { session } = Haggling.start(ctx);
        Haggling.respond(session, 'accept', ctx);
        expect(session.xp.haggling).toBeGreaterThan(0);
    });
});

describe('Haggling: the coin and the goods', () => {
    it('a haggled buy moves the goods and coin between the stall and the player to the cent', () => {
        const ctx = ctxOf();
        const s = ctx.settlement;
        const gold0 = ctx.player.gold, purse0 = s.economy.gold, stock0 = SettlementMarket.stock(s, 'bread');
        const { session } = Haggling.start(ctx);
        Haggling.respond(session, 'half', ctx);
        if (!session.over) Haggling.respond(session, 'accept', ctx);
        expect(session.over).toBe('deal');
        const paid = session.price;
        expect(Utils.isCents(paid)).toBe(true);
        expect(paid).toBeGreaterThanOrEqual(session.bound);
        expect(Utils.cents(gold0 - ctx.player.gold)).toBe(paid);
        expect(Utils.cents(s.economy.gold - purse0)).toBe(paid);
        expect(Utils.cents(ctx.player.gold + s.economy.gold)).toBe(Utils.cents(gold0 + purse0));
        expect(ctx.player.inventory.bread).toBe(5);
        expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(stock0 - 5, 5);
    });

    it('a haggled sale moves them the other way, out of the town purse, to the cent', () => {
        const ctx = ctxOf({ side: 'sell', player: player({ inventory: { bread: 6 } }) });
        const s = ctx.settlement;
        const gold0 = ctx.player.gold, purse0 = s.economy.gold, stock0 = SettlementMarket.stock(s, 'bread');
        const { session } = Haggling.start(ctx);
        expect(session.ask).toBeLessThan(session.list);
        Haggling.respond(session, 'half', ctx);
        if (!session.over) Haggling.respond(session, 'accept', ctx);
        expect(session.over).toBe('deal');
        const got = session.price;
        expect(Utils.isCents(got)).toBe(true);
        expect(got).toBeLessThanOrEqual(session.bound);
        expect(Utils.cents(ctx.player.gold - gold0)).toBe(got);
        // (the town pays the price, and any duty or guild toll inside it: none here)
        expect(Utils.cents(purse0 - s.economy.gold)).toBe(got);
        expect(ctx.player.inventory.bread).toBe(1);
        expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(stock0 + 5, 5);
    });

    it('no loop: the best haggled buy costs more than the best haggled sale of the same lot fetches', () => {
        for (const [tradeId, goodId] of [['baker', 'bread'], ['baker', 'flour'], ['ironmonger', 'tools'], ['draper', 'linen']]) {
            const s = town();
            const p = player();
            const buy = Haggling.market(ctxOf({ settlement: s, player: p, tradeId, goodId, qty: 3 }));
            if (buy.error) continue;
            // buy the lot at the very least any haggle could reach...
            const res = Trading.buyGoods(p, buy.entry, 3, s, null, { totalCost: buy.bound });
            expect(res.success).toBe(true);
            // ...then sell it straight back at the most any haggle could reach
            const sell = Haggling.market(ctxOf({ settlement: s, player: p, tradeId, goodId, qty: 3, side: 'sell' }));
            expect(sell.error).toBeUndefined();
            expect(sell.bound).toBeLessThan(buy.bound);
        }
    });

    it('the keeper will not pay out more than the town purse holds', () => {
        const ctx = ctxOf({ side: 'sell', player: player({ inventory: { bread: 6 } }), settlement: town({ economy: { gold: 0 } }) });
        const r = Haggling.start(ctx);
        expect(r.ok).toBe(false);
    });
});

describe('Haggling: the tongue', () => {
    it('without the words: a foreigner\'s price, less patience, and no flattery or fault-finding', () => {
        const fluent = Haggling.start(ctxOf()).session;
        const foreign = Haggling.start(ctxOf({ player: player({ languages: { khaan: 100 }, nativeLanguage: 'khaan' }) })).session;
        expect(foreign.tongue.words).toBe(false);
        expect(foreign.ask).toBeGreaterThan(fluent.ask);
        expect(foreign.patience).toBeLessThan(fluent.patience);
        expect(foreign.factors.some(f => /foreigner/i.test(f.label))).toBe(true);
        const m = Haggling.moves(foreign);
        expect(m.find(x => x.id === 'flatter').off).toBe(true);
        expect(m.find(x => x.id === 'low').off).toBeFalsy();
        const r = Haggling.respond(foreign, 'flatter', ctxOf());
        expect(r.error).toBeTruthy();
        // (what they say comes out half in their tongue)
        expect(Haggling.heard(foreign, 'Fine bread, fresh today, and a fair price for it')).not.toBe('Fine bread, fresh today, and a fair price for it');
    });

    it('an interpreter gives you the words, at a cost to your flair', () => {
        const ctx = ctxOf({ player: player({ languages: { khaan: 100 }, nativeLanguage: 'khaan', translator: { name: 'Petra', tongues: ['vellish', 'khaan'], fluency: 70 } }) });
        const { session } = Haggling.start(ctx);
        expect(session.tongue.via).toBe('translator');
        expect(session.tongue.words).toBe(true);
        const fluentCtx = ctxOf();
        const fluent = Haggling.start(fluentCtx).session;
        expect(Haggling.tacticChance(session, 'flatter', ctx)).toBeLessThan(Haggling.tacticChance(fluent, 'flatter', fluentCtx));
    });
});

describe('Haggling: the panel at the stall', () => {
    it('lists the wares to haggle over, runs the exchange, says it over the keeper\'s head and strikes the deal', async () => {
        const { vi } = await import('vitest');
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const s = town();
        const tile = plains(s);
        const panels = [];
        const game = {
            player: player({ q: s.q, r: s.r, actionPoints: 10 }),
            world: { day: 100, getTile: () => tile, getKingdom: () => null },
            ui: { showNotification() {}, updateStats() {}, hideCustomPanel() {}, setPanelNav() {}, showCustomPanel: (t, html) => panels.push({ t: String(t), html: String(html) }) },
        };
        const npc = keeper({ q: 3, r: 3 });
        const stall = { key: 'o:3,2', trade: 'baker', keeper: npc, name: 'Marta\'s Bread Stall', indoor: false, q: 3, r: 2 };
        const spy = vi.spyOn(ActionMenu, 'showQuantityInput').mockImplementation((title, max, cb) => cb(Math.min(5, max)));
        ActionMenu.showHaggle(game, stall);
        expect(panels.at(-1).html).toContain('Haggle over Bread');
        ActionMenu.haggleAct(game, 'pick', 'buy', 'bread');
        expect(panels.at(-1).html).toContain('Offer 70%');
        expect(panels.at(-1).html).toContain('Meet them halfway');
        expect(npc._bark && npc._bark.text.length).toBeGreaterThan(0);
        ActionMenu.haggleAct(game, 'move', 'accept');
        expect(game.player.inventory.bread).toBe(5);
        expect(panels.at(-1).html).toContain('You paid');
        spy.mockRestore();
        ActionMenu.haggleAct(game, 'close');
    }, 120000);
});
