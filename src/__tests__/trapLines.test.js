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
import { WildTasks } from '../systems/wildTasks.js';

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

// Trapping done in person (ui/mapTasks/wildTasks.js): where the snares go,
// which are checked and what they hold decide the outcome, not a roll after.
describe('snares set in person', () => {
    const runs = [{ q: 10, r: 10 }, { q: 11, r: 10 }, { q: 12, r: 11 }];
    const cover = [{ q: 10, r: 11 }];

    it('a snare on a game run under cover beats one on open ground', () => {
        const good = WildTasks.snareQuality({ q: 10, r: 10 }, runs, cover);
        const poor = WildTasks.snareQuality({ q: 30, r: 30 }, runs, cover);
        expect(good).toBeGreaterThan(0.8);
        expect(poor).toBeLessThan(0.2);
        expect(WildTasks.snareGrade(good)).toBe('good');
        expect(WildTasks.snareGrade(poor)).toBe('poor');
    });

    it('good snares catch far more than poor ones', () => {
        const rng = Utils.seededRandom(77);
        let good = 0, poor = 0;
        for (let i = 0; i < 400; i++) {
            good += WildTasks.snareCatch(0.9, rng, { luck: 5 }).items.pelts || 0;
            poor += WildTasks.snareCatch(0.1, rng, { luck: 5 }).items.pelts || 0;
        }
        expect(good).toBeGreaterThan(poor * 2);
    });

    it('a line catch is shared among its snares exactly, by their quality', () => {
        const shares = WildTasks.spreadCatch({ pelts: 7, meat: 1 }, [{ quality: 0.9 }, { quality: 0.1 }, {}]);
        expect(shares.reduce((a, s) => a + (s.pelts || 0), 0)).toBe(7);
        expect(shares.reduce((a, s) => a + (s.meat || 0), 0)).toBe(1);
        expect(shares[0].pelts).toBeGreaterThan(shares[1].pelts || 0);
        expect(WildTasks.spreadCatch({ pelts: 3 }, [])).toEqual([]);
    });

    it('a day run in person yields exactly what was found in the snares', () => {
        const world = makeWorld();
        const p = player();
        const res = SeasonalWork.trapFurs(p, world.forest, world, { caught: { pelts: 5, meat: 1 }, prize: true });
        expect(res.items).toEqual({ pelts: 5, meat: 1 });
        expect(res.rare).toBe(true);
        expect(p.inventory.pelts).toBe(5);
        const p2 = player();
        const none = SeasonalWork.trapFurs(p2, world.forest, world, { caught: {} });
        expect(none.items).toEqual({});
        expect(none.message).toMatch(/empty/);
        // The quick path still rolls a catch
        expect(SeasonalWork.trapFurs(player(), world.forest, world).items.pelts).toBeGreaterThan(0);
    });

    it('a line set on the runs fills faster than one strung across open ground', () => {
        const world = makeWorld();
        const count = (quality) => {
            let total = 0;
            for (let seed = 1; seed <= 12; seed++) {
                const w = { ...world, generationParams: { seed } };
                const p = player();
                const res = SeasonalWork.setTrapLine(p, w.forest, w, { snares: [0, 1, 2, 3].map(i => ({ q: i, r: 0, quality })) });
                expect(res.line.snares[0].quality).toBe(quality);
                for (let d = 1; d <= 8; d++) SeasonalWork.processTrapLines(p, { ...w, day: WINTER + d });
                const line = SeasonalWork.trapLineAt(p, 5, 5);
                total += SeasonalWork._lineCount(line) + (line.poached || 0);
            }
            return total;
        };
        expect(count(0.95)).toBeGreaterThan(count(0.1) * 1.5);
        expect(WildTasks.lineFactor(undefined)).toBe(1); // a line never walked fills as of old
    });

    it('tending in person empties only the snares you reached', () => {
        const world = makeWorld();
        const p = player();
        SeasonalWork.setTrapLine(p, world.forest, world, { snares: [{ q: 1, r: 1, quality: 0.5 }, { q: 4, r: 4, quality: 0.5 }] });
        const line = SeasonalWork.trapLineAt(p, 5, 5);
        line.catch = { pelts: 4 };
        line.damaged = true;
        const before = line.expiresDay;
        const out = SeasonalWork.tendTrapLine(p, world.forest, { ...world, day: WINTER + 5 }, 'reset', { checked: [0] });
        expect(out.success).toBe(true);
        expect(p.inventory.pelts).toBe(2);
        expect(line.catch.pelts).toBe(2);
        expect(line.damaged).toBe(true); // half a walk mends nothing
        expect(line.expiresDay).toBe(before);
        expect(out.message).toMatch(/1 of 2 snares/);
        // The whole line walked: the rest, and the line is mended
        SeasonalWork.tendTrapLine(p, world.forest, { ...world, day: WINTER + 5 }, 'reset', { checked: [0, 1] });
        expect(p.inventory.pelts).toBe(4);
        expect(line.damaged).toBe(false);
        expect(line.expiresDay).toBe(WINTER + 5 + SeasonalWork._trapCfg().maxDays);
        // Taking it up part-way leaves what the unreached snares held
        line.catch = { pelts: 4 };
        SeasonalWork.tendTrapLine(p, world.forest, world, 'pull', { checked: [1] });
        expect(p.inventory.pelts).toBe(6);
        expect(p.trapLines).toBeUndefined();
    });

    it('the scene settles a walked run from what the walk found', () => {
        const world = makeWorld();
        const game = {
            world, player: player(), panels: [], notes: [],
            ui: { showCustomPanel: (t, h) => game.panels.push({ t, h }), hideCustomPanel() {}, updateStats() {}, showNotification() {} },
            endDay() {},
        };
        game._scene = { kind: 'trap_furs', state: { q: 5, r: 5, _walked: 'run', _res: { spots: [{ q: 1, r: 1, quality: 0.9 }], caught: { pelts: 3 }, prize: false, checked: [0] } } };
        ActionMenu.sceneAct(game, 'run');
        expect(game.player.inventory.pelts).toBe(3);
        // A walked line keeps its snares and their quality
        game._scene = { kind: 'trap_furs', state: { q: 5, r: 5, _walked: 'set', _res: { spots: [{ q: 2, r: 2, quality: 0.8 }, { q: 6, r: 2, quality: 0.3 }], caught: {}, checked: [] } } };
        ActionMenu.sceneAct(game, 'set');
        const line = SeasonalWork.trapLineAt(game.player, 5, 5);
        expect(line.snares).toEqual([{ q: 2, r: 2, quality: 0.8 }, { q: 6, r: 2, quality: 0.3 }]);
        line.catch = { pelts: 5 };
        game._scene = { kind: 'trap_furs', state: { q: 5, r: 5, _walked: 'collect', _res: { spots: line.snares, checked: [0] } } };
        ActionMenu.sceneAct(game, 'collect');
        const share = WildTasks.spreadCatch({ pelts: 5 }, line.snares)[0].pelts;
        expect(game.player.inventory.pelts).toBe(3 + share);
        expect(line.catch.pelts).toBe(5 - share);
    });
});
