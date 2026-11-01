// Hospitality end to end (systems/hospitality.js), headless on a generated
// world through the harness's real day (playtest/harness.js endDay — the
// property tick, construction, Hospitality.processDay, the Ledger's close):
// the player builds an inn from the build menu, waits out the builders, runs
// it from its panel (staff, prices, scrubbing), takes in guests, is paid
// through the Ledger, books a room at a rival house and wakes to the morning,
// and the whole of it survives a save and load and keeps running. Every
// lodging panel and the property panel render without throwing or leaking
// "undefined"/"NaN", and every lodging button they offer works.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hospitality } from '../systems/hospitality.js';
import { Ledger } from '../systems/ledger.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { PlayerActions } from '../player/playerActions.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let ActionMenu;
let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
}, 300000);
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

const LEAK = /undefined|NaN|\[object Object\]|\bnull\b|Infinity/;

function decode(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** What the player reads: text between tags, and the tooltips. */
function visible(html) {
    const titles = [...String(html).matchAll(/\btitle="([^"]*)"/g)].map(m => decode(m[1]));
    return `${decode(String(html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' '))} ${titles.join(' ')}`;
}

function unbalanced(html) {
    const out = [];
    for (const tag of ['div', 'span', 'button', 'b']) {
        const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
        const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
        if (open !== close) out.push(`<${tag}> ${open} opened, ${close} closed`);
    }
    return out;
}

/** A recording UI shell the panels talk to. */
function shell(game) {
    const rec = { panels: [], notices: [] };
    game.ui = new Proxy({
        showCustomPanel: (title, html) => rec.panels.push({ title: String(title), html: String(html) }),
        showNotification: (title, msg, type) => rec.notices.push({ title: String(title), msg: String(msg), type }),
    }, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop === 'symbol') return undefined;
            return () => {};
        },
    });
    game.endDay = () => {};
    return rec;
}

/** The last panel shown, checked for leaks and balance. */
function lastPanel(rec) {
    const p = rec.panels[rec.panels.length - 1];
    expect(p, 'a panel was shown').toBeTruthy();
    const text = visible(p.title + ' ' + p.html);
    expect(LEAK.exec(text), `leak in "${p.title}": ${text.slice(0, 400)}`).toBeNull();
    expect(unbalanced(p.html)).toEqual([]);
    return p;
}

/** Every lodgingAct button a panel offers, as its argument lists. */
function lodgingButtons(html) {
    return [...String(html).matchAll(/data-am-act="lodgingAct" data-am-args='([^']*)'/g)].map(m => JSON.parse(decode(m[1])));
}

/** A town whose houses include an inn, where the player may build one. */
function innTown(game) {
    const { world, player } = game;
    for (const s of world.getSettlementViews()) {
        const tile = world.getTile(s.q, s.r);
        if (!Hospitality.kindsFor(tile.settlement).includes('inn')) continue;
        if (PlayerEconomy.canBuildProperty(player, 'INN', tile, world).canBuild) return tile;
    }
    return null;
}

/** Keep the player alive, fed and in town through a long stay. */
function tend(game, tile) {
    const p = game.player;
    p.q = tile.q;
    p.r = tile.r;
    p.health = Math.max(p.health, 90);
    if (p.needs) for (const k of Object.keys(p.needs)) p.needs[k] = Math.max(p.needs[k], 80);
    p.jailState = null;
    if (p.gold < 3000) p.gold = 3000;
}

describe('Hospitality, the player\'s whole flow', () => {
    it('build, run, guests, income on the Ledger, a night at a rival house, save and load', () => {
        const game = newGame(5150);
        const { world, player } = game;
        player.gold = 20000;
        const tile = innTown(game);
        expect(tile, 'a town that keeps an inn').toBeTruthy();
        tend(game, tile);
        const rec = shell(game);

        // ── Build it from the build menu ──
        ActionMenu.showBuildPropertyMenu(game, tile);
        expect(rec.panels.length + rec.notices.length).toBeGreaterThan(0);
        const gold0 = player.gold;
        globalThis.window.buildProperty('INN');
        const prop = PlayerEconomy.findPropertyAt(tile, 'inn');
        expect(prop, `built: ${JSON.stringify(rec.notices.slice(-2))}`).toBeTruthy();
        expect(player.gold).toBeLessThan(gold0);
        const today = Ledger.today(player);
        expect((today.income.propertyBought || 0) - (today.expenses.propertyBought || 0)).toBeLessThan(0); // a capital outlay
        const id = `p:${tile.q},${tile.r}:inn`;

        // While the builders work: no guests, and the panel says so
        ActionMenu.lodgingAct(game, 'open', id);
        if (prop.underConstruction) expect(lastPanel(rec).html).toMatch(/builders/);

        // ── Wait out the builders on the harness's real day ──
        for (let d = 0; d < 90 && prop.underConstruction; d++) { tend(game, tile); endDay(game); }
        expect(prop.underConstruction).toBe(false);

        // ── Run it from its panel: hire, price, scrub ──
        ActionMenu.lodgingAct(game, 'tab', id, 'run');
        let run = lastPanel(rec);
        expect(run.html).toMatch(/Staff/);
        ActionMenu.lodgingAct(game, 'staff', id, 'maid', 1);
        ActionMenu.lodgingAct(game, 'staff', id, 'cook', 1);
        expect(prop.hosp.staff.maid).toBe(1);
        expect(prop.hosp.staff.cook).toBe(1);
        const steps = Hospitality.config().player.priceSteps;
        const cheaper = steps.filter(m => m < 1).pop();
        if (cheaper != null) {
            ActionMenu.lodgingAct(game, 'price', id, cheaper);
            expect(prop.hosp.priceMult).toBe(cheaper);
        }
        prop.hosp.clean = 50;
        ActionMenu.lodgingAct(game, 'scrub', id);
        expect(prop.hosp.clean).toBe(80);
        run = lastPanel(rec);

        // ── Four weeks of guests ──
        let guests = 0;
        let takings = 0;
        let costs = 0;
        for (let d = 0; d < 28; d++) {
            tend(game, tile);
            endDay(game);
            guests += prop.hosp.guests;
            takings += prop.hosp.takings;
            costs += prop.hosp.costs;
        }
        expect(guests).toBeGreaterThan(0);
        expect(takings).toBeGreaterThan(0);
        expect(costs).toBeGreaterThan(0); // the cook and the maid are paid
        expect(prop.hosp.history.length).toBeGreaterThanOrEqual(3); // a weekly occupancy
        expect(prop.hosp.lastWeek).toBeTruthy();
        expect(prop.daysOwned).toBeGreaterThanOrEqual(28);
        // The week's news went out through processDay (never piles up)
        expect(prop.hosp.notices.length).toBe(0);
        // Booked on the Ledger, day by day, and the books close with it
        const st = Ledger.statement(player, world, 28);
        const income = Ledger.total(player, world, 'hospitality', 28);
        expect(income).toBeGreaterThanOrEqual(takings);
        expect(Ledger.total(player, world, 'hospitalityCosts', 28)).toBeLessThan(0);
        expect(st).toBeTruthy();
        const rows = player.financeHistory.slice(-28);
        expect(rows.some(r => r.income && r.income.hospitality > 0)).toBe(true);

        // The property panel (Manage) and its link to the house
        ActionMenu.showManagePropertyMenu(game, tile);
        const manage = rec.panels[rec.panels.length - 1];
        expect(manage.html).toMatch(/Run the house/);
        expect(LEAK.exec(visible(manage.html))).toBeNull();
        expect(lodgingButtons(manage.html).length).toBeGreaterThan(0);

        // ── A night at a rival house in town, and the morning after ──
        const rival = Hospitality.listAt(world, player, tile.q, tile.r).find(v => v.owner === 'npc');
        expect(rival).toBeTruthy();
        ActionMenu.lodgingAct(game, 'open', rival.id);
        const stay = lastPanel(rec);
        const book = lodgingButtons(stay.html).find(a => a[0] === 'book');
        expect(book, `a room on offer: ${visible(stay.title + ' ' + stay.html).slice(0, 1500)} ${JSON.stringify(rec.notices.slice(-3))}`).toBeTruthy();
        const g = player.gold;
        ActionMenu.lodgingAct(game, ...book);
        expect(player.lodging).toBeTruthy();
        expect(player.gold).toBeLessThanOrEqual(g);
        const lodgingSpend = Ledger.today(player).expenses.lodging || 0;
        if (player.gold < g) expect(lodgingSpend).toBeGreaterThan(0);
        const service = lodgingButtons(lastPanel(rec).html).find(a => a[0] === 'service');
        if (service) ActionMenu.lodgingAct(game, ...service);
        tend(game, tile);
        endDay(game);
        expect(player.lodging).toBeNull(); // the morning was applied

        // ── Save and load: the house, its books and the town's houses ──
        const g2 = roundTrip(game);
        const tile2 = g2.world.getTile(tile.q, tile.r);
        const prop2 = PlayerEconomy.findPropertyAt(tile2, 'inn');
        expect(prop2).toBeTruthy();
        expect(prop2.hosp).toEqual(prop.hosp);
        expect(prop2.name).toBe(prop.name);
        expect(Object.keys(Hospitality.state(g2.world).houses).sort()).toEqual(Object.keys(Hospitality.state(world).houses).sort());
        expect(Hospitality.get(g2.world, g2.player, id).name).toBe(prop.name);
        // ...and it keeps running after the load
        const hist = prop2.hosp.history.length;
        let after = 0;
        for (let d = 0; d < 14; d++) {
            tend(g2, tile2);
            endDay(g2);
            after += prop2.hosp.guests;
        }
        expect(after).toBeGreaterThan(0);
        expect(prop2.hosp.history.length).toBeGreaterThan(hist);
    }, 240000);

    it('every lodging panel renders and every button it offers works', () => {
        const game = newGame(5151);
        const { world, player } = game;
        player.gold = 20000;
        const tile = innTown(game);
        tend(game, tile);
        const rec = shell(game);
        const res = PlayerEconomy.buildProperty(player, 'INN', tile, world);
        expect(res.success).toBe(true);
        res.property.underConstruction = false;
        res.property.constructionDaysLeft = 0;
        for (let d = 0; d < 8; d++) { tend(game, tile); endDay(game); }

        // The list of the town's houses
        ActionMenu.showLodgings(game, tile);
        const list = lastPanel(rec);
        const opens = lodgingButtons(list.html).filter(a => a[0] === 'open');
        expect(opens.length).toBe(Hospitality.listAt(world, player, tile.q, tile.r).length);

        // Crawl: open each house, click what it offers (but not the ones that end the day)
        const seen = new Set();
        // (the Stay / Run tabs ride the window's tab bar, not the panel's html)
        const queue = [...opens, ['tab', `p:${tile.q},${tile.r}:inn`, 'run'], ['tab', `p:${tile.q},${tile.r}:inn`, 'stay']];
        let clicks = 0;
        while (queue.length && clicks < 120) {
            const args = queue.shift();
            const key = JSON.stringify(args);
            if (seen.has(key) || args[0] === 'retire' || args[0] === 'sleep') continue;
            seen.add(key);
            player.gold = Math.max(player.gold, 5000);
            expect(() => ActionMenu.lodgingAct(game, ...args), `lodgingAct ${key}`).not.toThrow();
            clicks++;
            const p = lastPanel(rec);
            for (const b of lodgingButtons(p.html)) if (!seen.has(JSON.stringify(b))) queue.push(b);
        }
        expect(clicks).toBeGreaterThan(5);
        expect([...seen].some(k => k.includes('"run"'))).toBe(true);
        for (const n of rec.notices) expect(LEAK.exec(`${n.title} ${n.msg}`)).toBeNull();

        // The world action menu offers the lodgings and the running of the house
        const actions = PlayerActions.getAvailableActions(player, tile, world).map(a => a.type);
        expect(actions).toContain('lodging');
        expect(actions).toContain('manage_lodging');
    }, 240000);
});

describe('Hospitality, what the run-through turned up', () => {
    it('a full inn still lets its best room (an inn has no suite)', () => {
        const game = newGame(5150);
        const { world, player } = game;
        const tile = innTown(game);
        tend(game, tile);
        const inn = Hospitality.listAt(world, player, tile.q, tile.r).find(v => v.owner === 'npc' && v.kind === 'inn');
        expect(inn).toBeTruthy();
        const spy = vi.spyOn(Hospitality, 'noVacancy').mockReturnValue(true);
        try {
            const q = Hospitality.quote(world, player, inn.id);
            expect(q.full).toBe(true);
            expect(q.tiers.find(t => t.id === 'common').ok).toBe(false);
            expect(q.tiers.find(t => t.id === 'private').ok).toBe(true);
            expect(Hospitality.book(world, player, inn.id, 'private').ok).toBe(true);
        } finally {
            spy.mockRestore();
        }
    }, 240000);

    it('a valet\'s grooming is +1 charisma for the day, gone the next morning', async () => {
        const { PlayerEffects } = await import('../player/playerEffects.js');
        const game = newGame(5150);
        const { world, player } = game;
        let hotel = null;
        for (const s of world.getSettlementViews()) {
            hotel = Hospitality.townHouses(world, s.q, s.r).find(h => h.kind === 'hotel');
            if (hotel) break;
        }
        expect(hotel, 'a city with a grand hotel').toBeTruthy();
        player.q = hotel.q;
        player.r = hotel.r;
        player.gold = 5000;
        const before = PlayerEffects.moodCharisma(player);
        const res = Hospitality.buyService(world, player, hotel.id, 'valet');
        expect(res.ok, res.text).toBe(true);
        expect(PlayerEffects.moodCharisma(player)).toBe(before + 1);
        Hospitality.processDay(world, player); // the same day: it holds
        expect(PlayerEffects.moodCharisma(player)).toBe(before + 1);
        world.day++;
        Hospitality.processDay(world, player);
        expect(player.valet).toBeNull();
        expect(PlayerEffects.moodCharisma(player)).toBe(before);
    }, 240000);
});
