// The Fighting Pit's panel (ui/actionMenu/pitFights.js): it draws the card,
// the book, the fighters and the beasts without holes, and its buttons bet,
// watch, sign and buy through the system (systems/pitFights.js).

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { PitFights } from '../systems/pitFights.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PitRing } from '../world/pitRing.js';
import { Player } from '../player/player.js';

let ActionMenu;

beforeAll(async () => {
    if (!DataLoader._gamedata) { DataLoader.clearCache(); await DataLoader.initializeAll(); }
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
}, 120000);

function makeGame() {
    Utils.setSeed(77);
    const kingdom = { id: 'k1', name: 'Testmark', isAlive: true, treasury: 3000, laws: { bloodSports: 'open' }, territory: [] };
    const s = { name: 'Bigtown', type: 'city', population: 6000, kingdom: 'k1', economy: { gold: 20000 }, ordinances: { bloodSports: 'follow' }, q: 0, r: 0 };
    const tile = { q: 0, r: 0, terrain: { id: 'plains', passable: true }, settlement: s };
    const world = { day: 10, generationParams: { seed: 515 }, kingdoms: [kingdom], getTile: (q, r) => (q === 0 && r === 0 ? tile : null), getKingdom: id => (id === 'k1' ? kingdom : null), getSettlementViews: () => [s] };
    Townsfolk.seed(s, world, { q: 0, r: 0 });
    SettlementMarket.ensure(s);
    while (!PitRing.nightOf(s, world.day).fight) world.day++;
    const player = new Player();
    player.gold = 500; player.q = 0; player.r = 0;
    const panels = [];
    const game = { world, player, ui: { showCustomPanel: (t, h) => panels.push({ t, h }), showNotification() {}, updateStats() {}, hideCustomPanel() {} } };
    return { game, s, panels };
}

const clean = (h) => !/undefined|NaN|\[object/.test(h.replace(/data-am-args="[^"]*"/g, ''));

describe('the pit panel', () => {
    it('draws tonight\'s card, the fighters and the beasts; bets, watches and signs through the system', () => {
        const { game, s, panels } = makeGame();
        ActionMenu.showPit(game);
        let p = panels.pop();
        expect(p.t).toMatch(/Pit/);
        expect(p.h).toMatch(/Tonight's card/);
        expect(p.h).toMatch(/The fighters/);
        expect(clean(p.h)).toBe(true);
        ActionMenu.pitAct(game, 'betPanel', 0);
        p = panels.pop();
        expect(p.h).toMatch(/to 1/);
        expect(clean(p.h)).toBe(true);
        const gold = game.player.gold;
        const j = PitFights.card(game.world, s).bouts.findIndex(b => b.kind === 'men');
        ActionMenu.pitAct(game, 'bet', j, 'a', 10);
        expect(game.player.gold).toBe(gold - 10);
        ActionMenu.pitAct(game, 'watch');
        p = panels.pop();
        expect(p.h).toMatch(/are fought/);
        expect(clean(p.h)).toBe(true);
        const f = PitFights.stable(game.world, s)[0];
        ActionMenu.pitAct(game, 'fighter', f.rec.pid);
        expect(clean(panels.pop().h)).toBe(true);
        ActionMenu.pitAct(game, 'sign', f.rec.pid);
        expect(s.pit.fighters[f.rec.pid].owner).toBe('player');
        expect(clean(panels.pop().h)).toBe(true);
    });
});
