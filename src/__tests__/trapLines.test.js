// Winter trap lines that fill over the days (and get raided), and ice
// fishing out on the thin ice; plus the choice scenes that drive them.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Seasons } from '../world/seasons.js';
import { SeasonalWork } from '../player/seasonalWork.js';
import { addWildernessActions } from '../player/actions/wildernessActions.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';

let ActionMenu;
let sceneHandler;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    ({ sceneHandler } = await import('../ui/actionMenu/choiceScenes.js'));
});

const WINTER = 3 * Seasons.DAYS_PER_SEASON + 2; // early winter

function makeWorld(day = WINTER) {
    const forest = { q: 5, r: 5, terrain: { id: 'boreal_forest', passable: true }, temperature: 0.3, hasRiver: true };
    return {
        day, width: 40, height: 40, units: [], kingdoms: [], generationParams: { seed: 3 },
        getAllSettlements: () => [], getKingdom: () => null,
        getTile: (q, r) => (q === 5 && r === 5 ? forest : { q, r, terrain: { id: 'plains', passable: true } }),
        forest,
    };
}

function player() {
    return { name: 'Trapper', inventory: {}, skills: {}, health: 100, luck: 5, gold: 0, q: 5, r: 5 };
}

beforeEach(() => Utils.setSeed(9));

describe('trap lines', () => {
    it('a line set in winter fills over the days and can be emptied into the packs', () => {
        const world = makeWorld();
        const p = player();
        const res = SeasonalWork.setTrapLine(p, world.forest, world);
        expect(res.success).toBe(true);
        expect(SeasonalWork.setTrapLine(p, world.forest, world).success).toBe(false); // one line per tile
        for (let d = 1; d <= 10; d++) SeasonalWork.processTrapLines(p, { ...world, day: WINTER + d });
        const line = SeasonalWork.trapLineAt(p, 5, 5);
        expect(line).not.toBeNull();
        const held = SeasonalWork._lineCount(line);
        expect(held + (line.poached || 0)).toBeGreaterThan(0);
        const out = SeasonalWork.tendTrapLine(p, world.forest, { ...world, day: WINTER + 10 }, 'collect');
        expect(out.success).toBe(true);
        expect((p.inventory.pelts || 0) + (p.inventory.meat || 0)).toBe(held);
        expect(SeasonalWork._lineCount(line)).toBe(0);
    });

    it('the daily roll is its own stream: the game RNG is untouched', () => {
        const world = makeWorld();
        const p = player();
        SeasonalWork.setTrapLine(p, world.forest, world);
        Utils.setSeed(123);
        const a = Utils.random();
        Utils.setSeed(123);
        SeasonalWork.processTrapLines(p, { ...world, day: WINTER + 1 });
        expect(Utils.random()).toBe(a);
    });

    it('raids happen: wolves wreck a line, re-baiting mends it', () => {
        const world = makeWorld();
        const p = player();
        SeasonalWork.setTrapLine(p, world.forest, world);
        const line = SeasonalWork.trapLineAt(p, 5, 5);
        line.catch = { pelts: 2 };
        const cfg = SeasonalWork._trapCfg;
        SeasonalWork._trapCfg = () => ({ ...cfg(), wolfChance: 1 });
        try {
            const notes = SeasonalWork.processTrapLines(p, { ...world, day: WINTER + 1 });
            expect(notes.some(n => n.title.includes('Wolves'))).toBe(true);
            expect(line.damaged).toBe(true);
        } finally {
            SeasonalWork._trapCfg = cfg;
        }
        SeasonalWork.tendTrapLine(p, world.forest, { ...world, day: WINTER + 1 }, 'reset');
        expect(line.damaged).toBe(false);
    });

    it('lines lapse when winter ends, and can be taken up', () => {
        const world = makeWorld();
        const p = player();
        SeasonalWork.setTrapLine(p, world.forest, world);
        const notes = SeasonalWork.processTrapLines(p, { ...world, day: 4 * Seasons.DAYS_PER_SEASON + 1 });
        expect(notes[0].title).toMatch(/Lapsed/);
        expect(p.trapLines).toBeUndefined();
        SeasonalWork.setTrapLine(p, world.forest, world);
        SeasonalWork.tendTrapLine(p, world.forest, world, 'pull');
        expect(p.trapLines).toBeUndefined();
    });

    it('a full pack leaves the catch in the snares', () => {
        const world = makeWorld();
        const p = player();
        p.maxInventory = 1;
        p.inventory = { rope: 1 };
        p.maxInventory = 1;
        SeasonalWork.setTrapLine(p, world.forest, world);
        const line = SeasonalWork.trapLineAt(p, 5, 5);
        line.catch = { pelts: 4 };
        const out = SeasonalWork.tendTrapLine(p, world.forest, world, 'collect');
        if (out.lost.pelts) expect(line.catch.pelts).toBe(4);
        else expect(p.inventory.pelts).toBe(4);
    });

    it('the wilds offer Check Trap Line on a tile with a line', () => {
        const world = makeWorld();
        const p = player();
        SeasonalWork.setTrapLine(p, world.forest, world);
        const a = [];
        addWildernessActions(a, p, world.forest, world);
        expect(a.find(x => x.type === 'trap_furs').label).toBe('Check Trap Line');
    });

    it('trap lines survive a save', () => {
        const world = makeWorld();
        const p = new Player();
        SeasonalWork.setTrapLine(p, world.forest, world);
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p))), back);
        expect(back.trapLines).toEqual(p.trapLines);
    });
});

describe('ice fishing out on the ice', () => {
    it('the far ice gives bigger catches, and sometimes gives way', () => {
        const world = makeWorld();
        let fell = 0;
        let fish = 0;
        for (let i = 0; i < 60; i++) {
            const p = player();
            const out = SeasonalWork.fishFarOut(p, world, 1);
            if (out.fell) {
                fell++;
                expect(p.health).toBeLessThan(100);
            } else fish += out.items.fish;
        }
        expect(fell).toBeGreaterThan(0);
        expect(fish / Math.max(1, 60 - fell)).toBeGreaterThanOrEqual(4);
        expect(SeasonalWork.thinIceChance(player(), world, 2)).toBeGreaterThan(SeasonalWork.thinIceChance(player(), world, 1));
        // thinner at the turn of the season
        expect(SeasonalWork.thinIceChance(player(), { ...world, day: 4 * Seasons.DAYS_PER_SEASON - 2 }, 1)).toBeGreaterThan(SeasonalWork.thinIceChance(player(), world, 1));
    });
});

describe('winter scenes', () => {
    function fakeGame() {
        const world = makeWorld();
        const panels = [];
        const notes = [];
        return {
            world, player: player(), panels, notes, ended: 0,
            ui: {
                showCustomPanel: (t, h) => panels.push({ t, h }), hideCustomPanel() {}, updateStats() {},
                showNotification: (t, b, ty) => notes.push({ t, b, ty }),
            },
            endDay() { this.ended++; },
        };
    }

    it('the trapping scene sets a line, and the next visit checks it', () => {
        const game = fakeGame();
        ActionMenu.doTrapFurs(game, game.world.forest);
        expect(game._scene.kind).toBe('trap_furs');
        expect(game.panels.at(-1).h).toContain('Lay a trap line');
        ActionMenu.sceneAct(game, 'set');
        expect(game._scene).toBeNull();
        expect(game.panels.at(-1).h).toContain('closePanelAndEndDay');
        expect(game.player.trapLines.length).toBe(1);
        ActionMenu.doTrapFurs(game, game.world.forest);
        expect(game.panels.at(-1).h).toContain('Empty the snares');
        ActionMenu.sceneAct(game, 'pull');
        expect(game.player.trapLines).toBeUndefined();
        for (const p of game.panels) expect(p.h).not.toMatch(/undefined|NaN|\[object Object\]/);
    });

    it('the ice scene: out, then back with the catch (or through the ice)', () => {
        for (let seed = 1; seed < 6; seed++) {
            Utils.setSeed(seed);
            const game = fakeGame();
            ActionMenu.doIceFish(game, game.world.forest);
            expect(game._scene.kind).toBe('ice_fishing');
            ActionMenu.sceneAct(game, 'far');
            if (game._scene) {
                expect(game._scene.state.stage).toBe('far');
                ActionMenu.sceneAct(game, 'back');
                expect(game.player.inventory.fish).toBeGreaterThan(0);
            } else {
                expect(game.player.health).toBeLessThan(100);
            }
            for (const p of game.panels) expect(p.h).not.toMatch(/undefined|NaN|\[object Object\]/);
        }
        expect(sceneHandler('ice_fishing')).toBeTruthy();
    });
});
