/**
 * The sea fight on the deck's map (ui/innerMapSeaFight.js): begun from the
 * pirates' battle phase, the crew to the guns, ships drawn on the water, a
 * grapple into the deck's own hand-to-hand (InnerMapDeck.startSeaBoarding),
 * and the end handed back into the pirates' scene; leaving the deck sails
 * it out.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Ships, CustomObjects, InnerMapDeck, InnerMapSeaFight, SeaFights, ActionMenu, sceneHandler;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Ships } = await import('../systems/ships.js'));
    ({ SeaFights } = await import('../systems/seaFights.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    ({ CustomObjects } = await import('../world/customObjects.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
    ({ InnerMapDeck } = await import('../ui/innerMapDeck.js'));
    ({ InnerMapSeaFight } = await import('../ui/innerMapSeaFight.js'));
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    ({ sceneHandler } = await import('../ui/actionMenu/choiceScenes.js'));
    await import('../ui/actionMenu/seaScenes.js');
}, 180000);

let savedChance;
beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(21);
    savedChance = DataLoader.ships.settings.voyage.eventChance;
    DataLoader.ships.settings.voyage.eventChance = 0;
});
afterEach(() => {
    DataLoader.ships.settings.voyage.eventChance = savedChance;
    if (InnerMapDeck) { InnerMapDeck._fight = null; InnerMapDeck._game = null; InnerMapDeck.situationOverride = null; }
    if (InnerMapSeaFight) { InnerMapSeaFight.fight = null; InnerMapSeaFight.ctx = null; InnerMapSeaFight._boarding = false; InnerMapSeaFight._hooked = false; }
    if (InnerMap) InnerMap.active = false;
});

const OCEAN = { id: 'ocean', passable: false };

function seaWorld() {
    const width = 40, height = 30;
    const tiles = new Map();
    return {
        width, height, day: 3, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 3 }, activeEvents: [], kingdoms: [],
        weather: null,
        getTile(q, r) {
            if (r < 0 || r >= height) return null;
            q = ((q % width) + width) % width;
            const key = `${q},${r}`;
            if (!tiles.has(key)) tiles.set(key, { q, r, terrain: OCEAN, elevation: 0.3, temperature: 0.5, moisture: 0.5, settlement: null });
            return tiles.get(key);
        },
        getSettlementViews: () => [],
        getKingdom: () => null,
    };
}

function sceneGame(typeId = 'caravel') {
    const w = seaWorld();
    const s = { id: 'ship_1', typeId, name: 'Gull', q: 12, r: 12, status: 'at_sea', condition: 100, customizations: [], cargo: { food: 200 }, crew: Ships.getShipEffectiveStats({ typeId }).crewRequired, morale: 70 };
    const p = { gold: 500, renown: 0, karma: 0, health: 100, maxHealth: 100, reputation: {}, inventory: {}, skills: {}, strength: 5, charisma: 5, luck: 5, ships: [s], army: [], q: 12, r: 12, boardedShip: 'ship_1', quests: { stats: {} } };
    const notes = [];
    const ui = {
        panel: null,
        showNotification: (title, body) => notes.push(`${title}: ${body}`),
        showCustomPanel(title, html) { this.panel = { title, html }; },
        hideCustomPanel() { this.panel = null; },
        updateStats() {},
    };
    const game = { world: w, player: p, ui, notes, enterInnerMap: async () => {}, exitInnerMap() { InnerMap.exit(game); } };
    InnerMap.enter(game, p.q, p.r);
    expect(InnerMapDeck.onEnter(game)).toBe(true);
    return { game, w, s, p };
}

const battleState = () => ({
    shipId: 'ship_1', kind: 'hunt', phase: 'battle', log: [],
    enemy: { type: 'pirate', captainId: null, name: 'a nameless rover', shipName: 'an unmarked sloop', shipType: 'sloop', temperament: 'greedy', strength: 10, str0: 10, speed: 5 },
});

describe('a sea fight on the deck', () => {
    it('the battle phase offers the fight under sail at sea', () => {
        const { game } = sceneGame();
        const v = sceneHandler('sea').view(game, battleState());
        expect(v.options[0].id).toBe('sail_fight');
    });

    it('begins on deck: the crew to the guns, the ships drawn on the water, the orders panel up', async () => {
        const { game } = sceneGame();
        expect(await InnerMapSeaFight.begin(game, { kind: 'pirates', state: battleState() })).toBe(true);
        expect(InnerMapSeaFight.active()).toBe(true);
        expect(InnerMapDeck.situationOverride).toMatchObject({ kind: 'battle' });
        expect(game.ui.panel.title).toMatch(/Sea Fight/);
        expect(game.ui.panel.html).toMatch(/Keep at range/);
        InnerMapDeck._refresh(game, true);
        expect(InnerMapDeck._sit.kind).toBe('battle');
        // A few seconds of sailing, then draw it all
        for (let i = 0; i < 40; i++) InnerMapSeaFight.update(0.25, game);
        const grad = { addColorStop() {} };
        const ctx = new Proxy({ canvas: { width: 800, height: 600 } }, {
            get(target, k) {
                if (k in target) return target[k];
                if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
                if (k === 'measureText') return () => ({ width: 10 });
                return () => {};
            },
            set(target, k, v) { target[k] = v; return true; },
        });
        const camera = { zoom: 2, worldToScreenFast: (x, y) => ({ x, y }) };
        const canvas = { width: 800, height: 600 };
        if (InnerMapSeaFight.active()) {
            expect(() => InnerMapSeaFight.render(ctx, camera, canvas)).not.toThrow();
            expect(() => InnerMapSeaFight.renderHud(ctx, camera, canvas)).not.toThrow();
        }
    });

    it('a grapple becomes the deck\'s hand-to-hand; its end goes back to the fight and on to the pirates\' aftermath', async () => {
        const { game, p } = sceneGame('galleon');
        await InnerMapSeaFight.begin(game, { kind: 'pirates', state: battleState() });
        const f = InnerMapSeaFight.fight;
        f.outcome = { kind: 'boarding', enemyId: 'e0', by: 'player' };
        InnerMapSeaFight.update(0.1, game);
        expect(InnerMapSeaFight._boarding).toBe(true);
        expect(InnerMapDeck._fight && InnerMapDeck._fight.onEnd).toBeTruthy();
        expect(InnerMap._deck.pirate).toBeTruthy();
        const gold = p.gold;
        InnerMapDeck._endFight(game, true);
        expect(InnerMapSeaFight.active()).toBe(false);
        expect(InnerMapDeck._fight).toBeNull();
        // Back in the pirates' scene: the crew's fate to decide
        expect(game._scene && game._scene.kind).toBe('sea');
        expect(game._scene.state.phase).toBe('aftermath_crew');
        expect(p.gold).toBeGreaterThan(gold);
        void ActionMenu;
    });

    it('leaving the deck mid-fight: the sailing master fights it out', async () => {
        const { game } = sceneGame();
        await InnerMapSeaFight.begin(game, { kind: 'pirates', state: battleState() });
        const f = InnerMapSeaFight.fight;
        InnerMapSeaFight.abandon(game);
        expect(InnerMapSeaFight.active()).toBe(false);
        expect(['victory', 'defeat', 'escaped', 'enemy_fled']).toContain(f.outcome.kind);
        expect(f.applied).toBe(true);
    });
});
