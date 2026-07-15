/**
 * Behavioural verification for the redesigned HUD:
 *  - the new UI.prototype updaters populate the correct DOM element ids
 *  - the derivation helpers (alignment/stance/morale/mood/level) are correct
 *  - the pure Terrain.getRegionName helper + starter-quest grant work
 *
 * The engine renders the HUD imperatively by element id, so we drive the
 * updaters against a fake getElementById registry and assert the outputs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Terrain } from '../world/terrain.js';
import { Quests } from '../systems/quests.js';
import { Utils } from '../core/utils.js';

let UI;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ UI } = await import('../ui/ui.js'));
});

// ── Fake DOM element registry ──
function makeEl() {
    const classes = new Set();
    return {
        textContent: '',
        innerHTML: '',
        style: {},
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, f) => {
                const on = f === undefined ? !classes.has(c) : f;
                if (on) classes.add(c); else classes.delete(c);
                return on;
            },
            contains: (c) => classes.has(c),
        },
    };
}

let reg;
let origGetById;
beforeEach(() => {
    reg = {};
    origGetById = document.getElementById;
    document.getElementById = (id) => (reg[id] || (reg[id] = makeEl()));
});
afterEach(() => {
    document.getElementById = origGetById;
});

// ── Build a tiny world: woodland region (rows 1-4) bordering ocean (row 0) ──
function buildWorld() {
    const W = 5, H = 5;
    const WOOD = Terrain.TYPES.WOODLAND;
    const OCEAN = Terrain.TYPES.OCEAN;
    const grid = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const water = r === 0;
            row.push({ q, r, terrain: water ? OCEAN : WOOD, regionId: water ? 2 : 1, explored: false });
        }
        grid.push(row);
    }
    return {
        width: W, height: H, tiles: grid, day: 1, season: 'Spring', year: 853,
        getTile(q, r) {
            if (r < 0 || r >= H) return null;
            const wq = ((q % W) + W) % W;
            return grid[r][wq];
        },
        getKingdom() { return null; },
        kingdoms: [],
    };
}

function basePlayer() {
    return {
        name: 'Wanderer', firstName: 'Wanderer', icon: '🧑',
        q: 2, r: 2,
        gold: 10000, renown: 0, karma: 0, health: 100, maxHealth: 100,
        allegiance: null, kingdomTitle: null,
        army: [], skills: { commerce: 1, combat: 1 },
        financeHistory: [],
    };
}

function stubUI() {
    const ui = Object.create(UI.prototype);
    ui.notificationLog = [];
    ui.game = {};
    return ui;
}

describe('HUD redesign — top bar & character card', () => {
    it('updateTopBarResources writes gold, income and stars', () => {
        const ui = stubUI();
        const player = basePlayer();
        player.financeHistory = [{ netChange: 1250 }];
        ui.updateTopBarResources(player, buildWorld());

        expect(reg.tbGold.textContent).toBe(Utils.formatNumber(10000));
        expect(reg.tbIncome.textContent).toBe(`+${Utils.formatNumber(1250)}/d`);
        expect(reg.tbStars.textContent).toBe('0');
        // shields mirror between top bar and bottom bar
        expect(reg.tbShields.textContent).toBe(reg.bbShields.textContent);
    });

    it('negative income is flagged', () => {
        const ui = stubUI();
        const player = basePlayer();
        player.financeHistory = [{ netChange: -300 }];
        ui.updateTopBarResources(player, buildWorld());
        expect(reg.tbIncome.textContent).toBe(`−${Utils.formatNumber(300)}/d`);
        expect(reg.tbIncome.classList.contains('negative')).toBe(true);
    });

    it('updateCharacterCard derives name/alignment/morale/stance/level', () => {
        const ui = stubUI();
        ui.updateCharacterCard(basePlayer());
        expect(reg.charCardName.textContent).toBe('WANDERER');
        expect(reg.charCardAlignment.textContent).toBe('Unaligned');
        expect(reg.charCardMorale.textContent).toBe('100%');
        expect(reg.charCardStance.textContent).toBe('Neutral');
        expect(reg.charCardLevel.textContent).toBe('1');
    });

    it('stance and level shift with karma/renown', () => {
        const ui = stubUI();
        const p = basePlayer();
        p.karma = 40; p.renown = 250;
        ui.updateCharacterCard(p);
        expect(reg.charCardStance.textContent).toBe('Righteous');
        expect(reg.charCardLevel.textContent).toBe('3'); // 1 + floor(250/100)
        p.karma = -40;
        ui.updateCharacterCard(p);
        expect(reg.charCardStance.textContent).toBe('Ruthless');
    });

    it('updateMoodMeter reads ECSTATIC at full health', () => {
        const ui = stubUI();
        ui.updateMoodMeter(basePlayer());
        expect(reg.simsMoodLabel.textContent).toBe('ECSTATIC');
        expect(reg.moodMeterFill.style.width).toBe('100%');
    });
});

describe('HUD redesign — right rail', () => {
    it('objective panel binds to the starter quest as "0 / 2"', () => {
        const ui = stubUI();
        const player = basePlayer();
        const world = buildWorld();
        Quests.initialize(player);
        Quests.grantStarterQuest(player, world);

        ui.updateObjectivePanel(player);
        expect(reg.objectiveTitle.textContent).toBe('A New Beginning');
        expect(reg.objectiveProgress.textContent).toBe('0 / 2');
    });

    it('region panel shows terrain, move cost and a derived region name', () => {
        const ui = stubUI();
        const world = buildWorld();
        ui.updateRegionPanel(basePlayer(), world);
        expect(reg.regionTerrain.textContent).toBe('Woodland');
        expect(reg.regionMoveCost.textContent).toBe('2');
        expect(reg.regionName.textContent).toBe('Coastal Woodlands');
        expect(reg.regionSubtitle.textContent).toBe('Unclaimed Lands');
    });

    it('events panel renders recent notification log entries', () => {
        const ui = stubUI();
        ui.notificationLog = [{ title: 'Journey', message: 'The road awaits.', type: 'info', day: 1 }];
        ui.updateEventsPanel();
        expect(reg.eventsList.innerHTML).toContain('Journey');
        expect(reg.eventsList.innerHTML).toContain('Day 1');
    });
});

describe('HUD redesign — backing data', () => {
    it('Terrain.getRegionName is deterministic and coast-aware', () => {
        const world = buildWorld();
        const woodTile = world.getTile(2, 2);
        expect(Terrain.getRegionName(woodTile, world)).toBe('Coastal Woodlands');
        // Null-safe
        expect(Terrain.getRegionName(null, world)).toBe('Uncharted Lands');
    });

    it('grantStarterQuest adds one active quest with a captured baseline', () => {
        const player = basePlayer();
        const world = buildWorld();
        // Pretend 3 tiles already explored.
        world.tiles[1][1].explored = true;
        world.tiles[1][2].explored = true;
        world.tiles[2][1].explored = true;
        Quests.initialize(player);
        Quests.grantStarterQuest(player, world);

        const q = player.quests.active.find((x) => x.id === 'a_new_beginning');
        expect(q).toBeTruthy();
        expect(q.objectives[0].baseline).toBe(3);
        expect(q.objectives[0].current).toBe(0);
        // Idempotent
        Quests.grantStarterQuest(player, world);
        expect(player.quests.active.filter((x) => x.id === 'a_new_beginning')).toHaveLength(1);
    });
});
