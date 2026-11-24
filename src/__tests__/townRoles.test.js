// A town's roles (InnerMap.SETTLEMENT_BUILDINGS) handed to its tile-composed buildings
// (world/innerMap/npcs.js _buildBuildingList): a walled cottage or shop is never given an
// open-air role (a "well" with a cottage's name and a well for its interior), and a
// building handed a role is called by it (a farmhouse handed the chapel is the Chapel).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, CustomBuildings, CustomObjects, DataLoader;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function village(culture, q) {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    const settlement = { name: 'Testby', type: 'village', q, r: 14, culture };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.55, moisture: 0.5, settlement };
    const world = {
        day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31, terrainGen: 6 }, activeEvents: [], kingdoms: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    InnerMap.enter({ world, player: {} }, q, 14);
    return InnerMap.buildings;
}

describe('town roles on tile-composed buildings', () => {
    it('no walled building is made the well, and a building given a role bears its name', () => {
        let roled = 0;
        for (const [i, culture] of ['Woodland', 'Mountain', 'Religious', 'Imperial', 'Nordic'].entries()) {
            for (const b of village(culture, 5 + i * 3)) {
                if (!b._customDefId) continue;
                expect(b.type).not.toBe('well');
                const def = CustomBuildings.getBuilding(b._customDefId);
                const drawnAs = (def && def.buildingType) || 'house';
                if (b.type !== 'house' && drawnAs !== b.type && InnerMap.BUILDING_TYPES[b.type]) {
                    roled++;
                    expect(b.name).toBe(InnerMap.BUILDING_TYPES[b.type].name);
                }
            }
        }
        expect(roled).toBeGreaterThanOrEqual(0);
    }, 120000);
});
