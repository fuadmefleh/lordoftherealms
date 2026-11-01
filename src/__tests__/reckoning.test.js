// The Season's Reckoning (systems/reckoning.js): the snapshot at a season's
// start, the tally through it (trades, world events), the report at its
// turn (money by source, markets moved, lords won and lost with their
// deeds, Prestige, holdings, wars), save/load with a legacy backfill — and
// the panels that show it, with the "Why?" ⓘs, render without leaking
// undefined/NaN.
import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { Reckoning } from '../systems/reckoning.js';
import { Ledger } from '../systems/ledger.js';
import { House } from '../systems/house.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { NPCLords } from '../world/npcLords.js';
import { Trading } from '../player/playerEconomy.js';
import { Causes } from '../player/causes.js';
import { whyIcon, priceWhy, sellWhy, opinionWhy, stabilityWhy, taxWhy } from '../ui/whyPopover.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

let ActionMenu;
let reckoningHtml;

beforeAll(async () => {
    await loadData();
}, 60000);

function clean(text) {
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
}

/** A market town with something on its stalls. */
function market(world) {
    for (const v of world.getSettlementViews()) {
        const tile = world.getTile(v.q, v.r);
        if (!tile || !tile.settlement || !tile.settlement.market) continue;
        const goods = Trading.getAvailableGoods(tile.settlement, tile, world).filter(g => g.quantity >= 5 && g.price > 0);
        if (goods.length) return { tile, s: tile.settlement, good: goods[0] };
    }
    return null;
}

/** Jump the calendar to the next season (what World.advanceDay does to the clock). */
function nextSeason(world) {
    const order = ['Spring', 'Summer', 'Autumn', 'Winter'];
    const i = order.indexOf(world.season);
    world.day += 30;
    world.season = order[(i + 1) % 4];
    if (world.season === 'Spring') world.year = (world.year || 1) + 1;
}

describe('Season\'s Reckoning', () => {
    it('snapshots at the start, tallies the season and reports at its turn', () => {
        const g = newGame(31);
        const { world, player } = g;
        endDay(g);
        const st = Reckoning.state(player);
        expect(st.start).toBeTruthy();
        expect(st.start.season).toBe(world.season);
        const start = st.start;

        // The season's doings: trade, money, Prestige, a deed a lord remembers
        player.gold = 5000;
        const m = market(world);
        expect(m).toBeTruthy();
        const bought = Trading.buyGoods(player, Trading.getAvailableGoods(m.s, m.tile, world).find(x => x.id === m.good.id), 4, m.s);
        expect(bought.success).toBe(true);
        const t = st.cur.towns[m.s.name];
        expect(t.goods[m.good.id].bought).toBe(4);
        world.day += 1; // (the season's days come after the snapshot's)
        Ledger.record(player, 'stalls', 120);
        Ledger.closeDay(player, world);
        House.award(player.house, 15, 'tournament: the joust', world.day);
        const k = world.kingdoms.find(x => x.isAlive !== false && x.lord);
        const deed = Object.keys(NPCLords.deedDefs())[0];
        NPCLords.rememberDeed(world, k.lord, deed, { day: world.day });
        world.activeEvents = [...(world.activeEvents || []), { id: 'plague', name: 'Plague', icon: '☠️', severity: 'catastrophic', effects: {}, kingdomId: null, daysLeft: 9, text: 'Plague sweeps the land' }];

        // Mid-season: no report, the event is noted
        expect(Reckoning.processDay(world, player).report).toBeNull();
        expect(st.cur.events.some(e => /Plague/.test(e.text))).toBe(true);
        const sofar = Reckoning.report(world, player);
        expect(sofar.towns[0].name).toBe(m.s.name);

        // The season turns
        world.day += 1;
        Ledger.record(player, 'stalls', 30);
        Ledger.closeDay(player, world);
        nextSeason(world);
        const { report } = Reckoning.processDay(world, player);
        expect(report).toBeTruthy();
        expect(report.season).toBe(start.season);
        expect(report.fromDay).toBe(start.day);
        expect(report.money.change).toBe(Math.round(player.gold) - start.gold);
        expect(report.money.income.find(l => l.id === 'stalls').amount).toBeGreaterThanOrEqual(150);
        expect(report.towns[0].goods[0]).toMatchObject({ id: m.good.id, bought: 4 });
        expect(report.towns[0].goods[0].stockTo).toBeLessThanOrEqual(report.towns[0].goods[0].stockFrom);
        expect(report.prestige.delta).toBe(Math.round(House.getPrestige(player)) - start.prestige);
        expect(report.prestige.reasons.some(r => r.reason === 'tournament')).toBe(true);
        const lord = report.lords.find(l => String(l.kingdomId) === String(k.id));
        expect(lord).toBeTruthy();
        expect(lord.deeds.length).toBeGreaterThan(0);
        expect(report.events.some(e => /Plague/.test(e.text))).toBe(true);
        clean(report.headline);

        // A new season begins: fresh start and tally; the report is kept
        expect(st.start.season).toBe(world.season);
        expect(Object.keys(st.cur.towns)).toHaveLength(0);
        expect(st.last).toBe(report);
        expect(st.history).toHaveLength(1);
    });

    it('draws no RNG', () => {
        const g = newGame(32);
        endDay(g);
        Utils.setSeed(5);
        const r0 = Utils.random();
        Utils.setSeed(5);
        Reckoning.processDay(g.world, g.player);
        nextSeason(g.world);
        Reckoning.processDay(g.world, g.player);
        Reckoning.report(g.world, g.player);
        expect(Utils.random()).toBe(r0);
    });

    it('saves and loads; an older save starts its record on load', () => {
        const g = newGame(33);
        endDay(g);
        nextSeason(g.world);
        Reckoning.processDay(g.world, g.player);
        const data = SaveLoad.serializePlayer(g.player);
        expect(data.reckoning && data.reckoning.last).toBeTruthy();
        const copy = JSON.parse(JSON.stringify(data));
        const p2 = { ...{} };
        SaveLoad.restorePlayer(copy, p2, g.world);
        expect(p2.reckoning.last.season).toBe(g.player.reckoning.last.season);
        // legacy: no record at all
        const legacy = JSON.parse(JSON.stringify(data));
        delete legacy.reckoning;
        const p3 = {};
        SaveLoad.restorePlayer(legacy, p3, g.world);
        expect(p3.reckoning.start).toBeTruthy();
        expect(p3.reckoning.history).toEqual([]);
    });
});

describe('panels render', () => {
    beforeAll(async () => {
        ({ ActionMenu } = await import('../ui/actionMenu.js'));
        ({ reckoningHtml } = await import('../ui/actionMenu/reckoning.js'));
    }, 60000);

    it('the Reckoning panel, every tab', () => {
        const g = newGame(34);
        const panels = [];
        g.ui = { showCustomPanel: (title, html) => panels.push({ title, html }), showNotification: () => {}, setPanelNav: () => {}, hideCustomPanel: () => {} };
        for (let i = 0; i < 3; i++) endDay(g);
        ActionMenu.showReckoning(g, 'last');
        clean(panels[panels.length - 1].html);
        nextSeason(g.world);
        Reckoning.processDay(g.world, g.player);
        for (const tab of ['last', 'now', 'past']) {
            ActionMenu.showReckoning(g, tab);
            clean(panels[panels.length - 1].html);
        }
        clean(reckoningHtml(g.player.reckoning.last));
    });

    it('the market window carries a "Why?" for its prices, and every explainer renders clean', () => {
        const g = newGame(35);
        const panels = [];
        g.ui = { showCustomPanel: (title, html) => panels.push({ title, html }), showNotification: () => {}, setPanelNav: () => {}, hideCustomPanel: () => {}, _tradeTab: 'buy' };
        for (let i = 0; i < 3; i++) endDay(g);
        const m = market(g.world);
        g.player.inventory = { ...(g.player.inventory || {}), [m.good.id]: 3 };
        ActionMenu.showTradeMenu(g, m.tile, 'buy');
        const html = panels[panels.length - 1].html;
        clean(html);
        expect(html).toMatch(/data-why="/);
        const e = Causes.price(g.world, m.s, m.good.id, g.player, m.tile);
        for (const p of [priceWhy(e), sellWhy(e)]) {
            if (!p) continue;
            clean(JSON.stringify(p));
            clean(whyIcon(p));
        }
        for (const k of g.world.kingdoms.filter(x => x.lord).slice(0, 3)) {
            clean(JSON.stringify(opinionWhy(Causes.lordOpinion(g.world, k, g.player))));
            clean(JSON.stringify(stabilityWhy(Causes.stability(k, g.world))));
        }
        clean(JSON.stringify(taxWhy(Causes.tax(g.world, g.player, m.s))));
    });
});
