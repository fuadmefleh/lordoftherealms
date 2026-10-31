// The devotion, alms, pilgrimage, soul-pact and feast panels build on a real
// harness world and their buttons run without throwing or leaking
// undefined/NaN into what the player reads.
import { describe, it, expect, beforeAll } from 'vitest';
import { Devotion } from '../systems/devotion.js';
import { SoulPact } from '../systems/soulPact.js';
import { loadData, newGame } from './playtest/harness.js';

let DevotionPanel;
let FeastPanel;
let ActionMenu;
let game;
let panels;
let notes;

function stubGame() {
    const g = newGame(4242);
    g.player.gold = 3000;
    panels = [];
    notes = [];
    g.ui = {
        showCustomPanel: (title, html) => panels.push({ title, html }),
        hideCustomPanel: () => {},
        showNotification: (t, m) => notes.push(`${t} ${m}`),
        updateStats: () => {},
        setPanelNav: () => {},
    };
    g.endDay = () => {};
    return g;
}

function clean(text) {
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
}

function last() {
    const p = panels[panels.length - 1];
    clean(p.html);
    return p;
}

beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    ({ DevotionPanel } = await import('../ui/actionMenu/devotion.js'));
    ({ FeastPanel } = await import('../ui/actionMenu/feast.js'));
    game = stubGame();
    ActionMenu.commitPendingAP = () => true;
});

function town(world, type = null) {
    const s = world.getSettlementViews().find(v => !type || v.type === type) || world.getSettlementViews()[0];
    return world.getTile(s.q, s.r);
}

describe('devotion panels', () => {
    it('prayer result, journal, alms and the temple card render and act', () => {
        const tile = town(game.world);
        Devotion.state(game.player).offer = { day: game.world.day, ids: ['peace', 'alms'] };
        DevotionPanel.devote(game, tile, 'pray', { place: 'temple', endDay: false });
        last();
        window._devo.journal();
        expect(last().title).toMatch(/Devotions/);
        window._devo.vow('peace');
        DevotionPanel.showDonate(game, tile);
        last();
        window._devo.pick('poor');
        window._devo.give('poor');
        const card = DevotionPanel.templeCardHtml(game, tile);
        clean(card);
        DevotionPanel.bindTemple(game, tile);
        window._devo.templePray();
        last();
        for (const n of notes) clean(n);
    });

    it('the holy site panel kneels and swears', () => {
        const h = Devotion.holySites(game.world)[0];
        const tile = game.world.getTile(h.q, h.r);
        DevotionPanel.showPilgrimage(game, tile);
        last();
        window._devo.kneel('token');
        last();
        DevotionPanel.showJournal(game, town(game.world));
        const html = last().html;
        const m = /window\._devo\.swear\((\d+), (\d+)\)/.exec(html);
        if (m) window._devo.swear(Number(m[1]), Number(m[2]));
        for (const n of notes) clean(n);
    });

    it('the stranger: sell, the debt, refuse, and the temple redemption', () => {
        const tile = town(game.world);
        DevotionPanel.showSoulPact(game, tile);
        last();
        window._pact.sell();
        last();
        game.world.day = SoulPact.state(game.player).dueDay;
        SoulPact.processDay(game.world, game.player);
        DevotionPanel.showSoulPact(game, tile);
        last();
        window._pact.answer('refuse');
        last();
        clean(DevotionPanel.templeCardHtml(game, tile));
        DevotionPanel.bindTemple(game, tile);
        window._devo.redeem();
        expect(SoulPact.isSold(game.player)).toBe(false);
        for (const n of notes) clean(n);
    });

    it('the meditation action and the temple menu still open', () => {
        const tile = town(game.world);
        ActionMenu.showBlessingMenu(game, tile);
        last();
        ActionMenu.showDonateMenu(game, tile);
        last();
    });
});

describe('feast panel', () => {
    it('plans, toggles guests, hosts and shows the outcome', () => {
        const g = stubGame();
        const tile = town(g.world, 'capital');
        FeastPanel.show(g, tile);
        last();
        window._feast.guest(0);
        window._feast.menu('modest');
        window._feast.ent('minstrels');
        last();
        window._feast.host();
        const p = last();
        expect(p.title).toMatch(/Feast/);
        if (window._feast.calm && /Talk him down/.test(p.html)) window._feast.calm();
        for (const n of notes) clean(n);
    });
});
