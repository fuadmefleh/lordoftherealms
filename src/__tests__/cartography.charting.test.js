// Maps are charted on foot (systems/cartography/charting.js): one action per
// tile underfoot into a draft, and once enough tiles are charted the draft is
// drawn up into a map of exactly those tiles.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Cartography } from '../systems/cartography.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { addWildernessActions } from '../player/actions/wildernessActions.js';
import { loadData, newGame } from './playtest/harness.js';

let ActionMenu;
beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
});

/** Passable land tiles in a walk from the player, first `n`. */
function landTiles(world, from, n) {
    const out = [];
    for (let r = 0; r < world.height && out.length < n; r++) {
        for (let q = 0; q < world.width && out.length < n; q++) {
            const t = world.getTile(q, r);
            if (t && t.terrain.passable) out.push({ q, r, t });
        }
    }
    return out;
}

function chartAt(player, world, q, r) {
    player.q = q;
    player.r = r;
    return Cartography.chartTile(player, world);
}

describe('charting a map', () => {
    it('charts one tile at a time, never the same tile twice', () => {
        const { player, world } = newGame(41);
        player.chartDraft = null;
        const [a, b] = landTiles(world, player, 2);
        expect(chartAt(player, world, a.q, a.r)).toMatchObject({ success: true, count: 1 });
        expect(Cartography.isCharted(player, a.q, a.r)).toBe(true);
        expect(chartAt(player, world, a.q, a.r).success).toBe(false);
        expect(chartAt(player, world, b.q, b.r)).toMatchObject({ success: true, count: 2 });
        expect(player.chartDraft.tiles[`${a.q},${a.r}`]).toMatchObject({ terrain: a.t.terrain.id });
        // A resource is named in the report, not printed as an object
        expect(Cartography._resourceName({ id: 'iron', name: 'Iron', icon: 'ore' })).toBe('Iron');
        const c = landTiles(world, player, 3)[2];
        world.getTile(c.q, c.r).resource = { id: 'iron', name: 'Iron', icon: 'ore' };
        expect(chartAt(player, world, c.q, c.r).resource).toBe('Iron');
    }, 60000);

    it('is offered as an action on the tile you stand on, until it is charted', () => {
        const { player, world } = newGame(45);
        player.chartDraft = null;
        const [a] = landTiles(world, player, 1);
        player.q = a.q;
        player.r = a.r;
        const tile = { ...world.getTile(a.q, a.r), q: a.q, r: a.r };
        const offered = () => { const acts = []; addWildernessActions(acts, player, tile, world); return acts.some(x => x.type === 'chart_tile'); };
        expect(offered()).toBe(true);
        Cartography.chartTile(player, world);
        expect(offered()).toBe(false);
    }, 60000);

    it('draws a map only once enough tiles are charted, of exactly those tiles', () => {
        const { player, world } = newGame(42);
        player.chartDraft = null;
        player.maps = [];
        const need = Cartography.CHARTING.minTiles.regional;
        const tiles = landTiles(world, player, need);
        for (const t of tiles.slice(0, need - 1)) chartAt(player, world, t.q, t.r);
        const reg = () => Cartography.drawOptions(player, world).find(o => o.type === 'regional');
        expect(reg().ready).toBe(false);
        expect(Cartography.drawMap(player, world, 'regional').success).toBe(false);
        chartAt(player, world, tiles[need - 1].q, tiles[need - 1].r);
        expect(reg().ready).toBe(true);
        expect(Cartography.drawOptions(player, world).find(o => o.type === 'survey').ready).toBe(false);

        const res = Cartography.drawMap(player, world, 'regional');
        expect(res.success).toBe(true);
        expect(res.map.tiles).toHaveLength(need);
        expect(res.map.charted).toBe(true);
        expect(player.maps).toContain(res.map);
        expect(player.chartDraft).toBeNull();

        // Reading it reveals exactly the charted tiles
        for (const t of tiles) world.getTile(t.q, t.r).explored = false;
        const read = Cartography.applyMap(player, res.map, world);
        expect(read.tilesRevealed).toBe(need);
    }, 60000);

    it('keeps the draft through a save', () => {
        const { player, world } = newGame(43);
        const [a] = landTiles(world, player, 1);
        chartAt(player, world, a.q, a.r);
        const saved = SaveLoad.serializePlayer(player);
        expect(saved.chartDraft.tiles[`${a.q},${a.r}`]).toBeTruthy();
    }, 60000);

    it('offers Chart This Tile in the panel flow and draws from the Cartography panel', () => {
        const game = newGame(44);
        const { player, world } = game;
        player.chartDraft = null;
        player.gold = 500;
        player.actionPoints = 50;
        game.ui = { showCustomPanel: vi.fn(), showNotification: vi.fn(), updateStats: vi.fn(), hideCustomPanel: vi.fn() };
        const need = Cartography.CHARTING.minTiles.regional;
        for (const t of landTiles(world, player, need)) {
            player.q = t.q;
            player.r = t.r;
            ActionMenu.doChartTile(game);
        }
        expect(Cartography.draftCount(player)).toBe(need);
        ActionMenu.showCartographyMenu(game, world.getTile(player.q, player.r));
        const html = game.ui.showCustomPanel.mock.calls.at(-1)[1];
        expect(html).toContain(`${need} tiles charted toward your next map`);
        const before = (player.maps || []).length;
        ActionMenu.createMap(game, 'regional');
        expect(player.maps.length).toBe(before + 1);
        expect(player.gold).toBe(500 - Cartography.CHARTING.inkCost.regional);
    }, 60000);
});

describe('auto-charting an area', () => {
    /** A land tile with plenty of land around it. */
    function inland(world) {
        for (let r = 4; r < world.height - 4; r++) {
            for (let q = 0; q < world.width; q++) {
                const t = world.getTile(q, r);
                if (!t || !t.terrain.passable) continue;
                const ring = Cartography._autoTargets({ chartDraft: null }, world, q, r, 2);
                if (ring.length >= 19) return { q, r };
            }
        }
        return null;
    }

    it('walks to the nearest uncharted tile and charts every tile in the area', () => {
        const { player, world } = newGame(46);
        player.chartDraft = null;
        const at = inland(world);
        player.q = at.q; player.r = at.r;
        const start = Cartography.startAutoChart(player, world, 2);
        expect(start).toMatchObject({ success: true, tiles: 19 });
        let steps = 0;
        let res;
        do {
            player.actionPoints = 10;
            res = Cartography.autoChartNext(player, world);
            if (res.next) {
                // the next tile is always the nearest one left
                const d = (t) => Math.abs(t.q - player.q) + Math.abs(t.r - player.r);
                expect(res.next).toBeTruthy();
                player.q = res.next.q; player.r = res.next.r; // walked there
                expect(d(res.next)).toBe(0);
            }
        } while (!res.done && ++steps < 100);
        expect(res.done).toBe(true);
        expect(player.autoChart).toBeNull();
        expect(Cartography.draftCount(player)).toBe(19);
        expect(Cartography.drawOptions(player, world).find(o => o.type === 'regional').ready).toBe(true);
    }, 60000);

    it('charts a tile for 1 AP, and not without one', () => {
        const { player, world } = newGame(47);
        player.chartDraft = null;
        const at = inland(world);
        player.q = at.q; player.r = at.r;
        Cartography.startAutoChart(player, world, 2);
        player.actionPoints = 0;
        expect(Cartography.autoChartNext(player, world).charted).toBeNull();
        player.actionPoints = 3;
        expect(Cartography.autoChartNext(player, world).charted).toBeTruthy();
        expect(player.actionPoints).toBe(2);
    }, 60000);

    it('stops when hurt or starving, refuses an area already charted, and is kept in a save', () => {
        const { player, world } = newGame(48);
        player.chartDraft = null;
        const at = inland(world);
        player.q = at.q; player.r = at.r;
        Cartography.startAutoChart(player, world, 2);
        expect(SaveLoad.serializePlayer(player).autoChart).toMatchObject({ radius: 2, q: at.q, r: at.r });
        expect(Cartography.autoChartHalt(player)).toBeNull();
        player.health = 10;
        expect(Cartography.autoChartHalt(player)).toMatch(/hurt/);
        player.health = 100;
        player.needs.hunger = 5;
        player.inventory = {};
        expect(Cartography.autoChartHalt(player)).toMatch(/starving/);
        player.needs.hunger = 80;
        player.needs.energy = 5;
        expect(Cartography.autoChartHalt(player)).toMatch(/exhausted/);
        // Weeks alone in the wilds: miserable enough that a mood drains health
        Object.assign(player.needs, { energy: 30, social: 0, fun: 0, hygiene: 0, comfort: 20 });
        expect(Cartography.autoChartHalt(player)).toMatch(/miserable/);
        expect(Cartography.stopAutoChart(player)).toBe(0);
        // Chart all of it, then ask again
        for (const t of Cartography._autoTargets(player, world, at.q, at.r, 2)) chartAt(player, world, t.q, t.r);
        player.q = at.q; player.r = at.r;
        expect(Cartography.startAutoChart(player, world, 2).success).toBe(false);
        expect(Cartography.startAutoChart(player, world, 7).success).toBe(false); // not an offered size
    }, 60000);

    it('the game loop walks the order: charts underfoot, sets off for the next tile, rests when spent', async () => {
        const { _autoChartStep, startAutoChart } = await import('../ui/game/autoChart.js');
        const game = newGame(49);
        const { player, world } = game;
        player.chartDraft = null;
        const at = inland(world);
        player.q = at.q; player.r = at.r;
        const host = {
            player, world, isProcessingTurn: false, camera: {},
            ui: { showNotification: vi.fn(), updateStats: vi.fn(), hideCustomPanel: vi.fn() },
            endDay: vi.fn(),
        };
        host._autoChartStep = _autoChartStep;
        player.actionPoints = 10;
        startAutoChart.call(host, 2);
        expect(Cartography.isCharted(player, at.q, at.r)).toBe(true); // charted where it stood
        expect(player.isMoving).toBe(true); // and set off for the next
        // Arrive (as the loop would) with no strength left: it rests
        player.isMoving = false;
        player.q = player.path[player.path.length - 1].q;
        player.r = player.path[player.path.length - 1].r;
        player.path = null;
        player.actionPoints = 0;
        host._autoChartStep();
        expect(host.endDay).toHaveBeenCalled();
        expect(player.autoChart).toBeTruthy();
    }, 60000);

    it('offers the order in the Cartography panel, and a way to stop it', () => {
        const game = newGame(50);
        const { player, world } = game;
        player.chartDraft = null;
        const at = inland(world);
        player.q = at.q; player.r = at.r;
        game.ui = { showCustomPanel: vi.fn(), showNotification: vi.fn(), updateStats: vi.fn(), hideCustomPanel: vi.fn() };
        ActionMenu.showCartographyMenu(game, world.getTile(at.q, at.r));
        let html = game.ui.showCustomPanel.mock.calls.at(-1)[1];
        expect(html).toContain('data-am-act="autoChartArea"');
        expect(html).toMatch(/19 to chart/);
        Cartography.startAutoChart(player, world, 3);
        ActionMenu.showCartographyMenu(game, world.getTile(at.q, at.r));
        html = game.ui.showCustomPanel.mock.calls.at(-1)[1];
        expect(html).toContain('data-am-act="stopAutoChartArea"');
    }, 60000);
});
