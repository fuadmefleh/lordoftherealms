// Hiding in cover on the street map (systems/stealthCover.js the odds,
// world/streetCover.js where cover is): the dark, a torch, Stealth, moving,
// the watch and the cover all weigh on being noticed; the first blow from
// cover is heavier and may fell; someone lies in wait more at night and with
// a price on your head; a town has bushes at its edge, by its roads and in
// its yards to hide behind, the same every time it is laid out.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, CustomBuildings, CustomObjects, DataLoader, StealthCover, StreetCover;

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
    ({ StealthCover } = await import('../systems/stealthCover.js'));
    ({ StreetCover } = await import('../world/streetCover.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
}, 120000);

function town(type, q = 9, r = 14) {
    const settlement = { name: `Test ${type}`, type, population: 2000, q, r };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.55, moisture: 0.5, settlement };
    const game = { world: { day: 1, season: 'Spring', generationParams: { seed: 5 }, activeEvents: [], getTile: () => worldTile, getKingdom: () => null } };
    InnerMap._cache = {};
    return InnerMap.generate(worldTile, q, r, game);
}

const base = { cover: 0.85, darkness: 0, stealth: 1, moving: false, armour: 0, watcher: {} };

describe('being noticed in cover', () => {
    it('falls with distance and is nothing out of sight', () => {
        const near = StealthCover.noticeRate({ ...base, dist: 2 });
        const far = StealthCover.noticeRate({ ...base, dist: 7 });
        expect(near).toBeGreaterThan(far);
        expect(far).toBeGreaterThan(0);
        expect(StealthCover.noticeRate({ ...base, dist: 30 })).toBe(0);
    });

    it('the dark hides you, a carried light gives you away, a torch most of all', () => {
        const day = StealthCover.noticeRate({ ...base, dist: 3 });
        const night = StealthCover.noticeRate({ ...base, dist: 3, darkness: 1 });
        const lantern = StealthCover.noticeRate({ ...base, dist: 3, darkness: 1, lit: true });
        const torch = StealthCover.noticeRate({ ...base, dist: 3, darkness: 1, lit: true, torch: true });
        expect(night).toBeLessThan(day * 0.5);
        expect(lantern).toBeGreaterThan(night);
        expect(torch).toBeGreaterThan(lantern);
        // at night out of reach of a short sight: nothing at all
        expect(StealthCover.noticeRate({ ...base, dist: 5, darkness: 1 })).toBe(0);
    });

    it('cover, Stealth and keeping still help; moving, armour and the watch tell against you', () => {
        const r = (o) => StealthCover.noticeRate({ ...base, dist: 3, ...o });
        expect(r({ cover: 0 })).toBeGreaterThan(r({}));
        expect(r({ stealth: 8 })).toBeLessThan(r({}));
        expect(r({ moving: true })).toBeGreaterThan(r({}));
        expect(r({ armour: 0.3 })).toBeGreaterThan(r({}));
        expect(r({ watcher: { guard: true } })).toBeGreaterThan(r({}));
        expect(r({ watcher: { guard: true, alert: true } })).toBeGreaterThan(r({ watcher: { guard: true } }));
        expect(r({ watcher: { child: true } })).toBeLessThan(r({}));
        expect(r({ watcher: { asleep: true } })).toBe(0);
        expect(r({ fog: 1 })).toBeLessThan(r({}));
    });

    it('brushing past, even the best cover may not save you', () => {
        expect(StealthCover.noticeRate({ ...base, dist: 1 })).toBeGreaterThan(StealthCover.noticeRate({ ...base, dist: 2 }));
        const p = StealthCover.noticeChance(StealthCover.noticeRate({ ...base, dist: 1 }), 2);
        expect(p).toBeGreaterThan(0.1);
        expect(p).toBeLessThan(1);
        expect(StealthCover.noticeChance(0, 5)).toBe(0);
    });

    it('a sharp eye (Stealth, the cunning) and a light of your own see a lurker sooner', () => {
        expect(StealthCover.perception(6, ['cunning'])).toBeGreaterThan(StealthCover.perception(1, []));
        const dark = { dist: 4, cover: 0.8, darkness: 1, stealth: 5, watcher: {} };
        expect(StealthCover.noticeRate({ ...dark, watcherLit: true })).toBeGreaterThan(StealthCover.noticeRate(dark));
    });
});

describe('the ambush', () => {
    it('a blow from cover is heavier and may fell; more so on the unaware, in the dark, with the fists', () => {
        const plain = StealthCover.surprise({ stealth: 1, darkness: 0, unaware: false });
        const best = StealthCover.surprise({ stealth: 8, darkness: 1, unaware: true, brawling: true });
        expect(plain.mult).toBeGreaterThan(1);
        expect(best.mult).toBeGreaterThan(plain.mult);
        expect(best.koChance).toBeGreaterThan(plain.koChance);
        expect(best.koChance).toBeLessThanOrEqual(0.8);
        expect(StealthCover.surprise({ stealth: 1, guard: true }).koChance).toBeLessThan(plain.koChance);
    });

    it('blindside: felled unaware, or struck unseen in the dark without a light', () => {
        expect(StealthCover.blindside({ unaware: true, felled: true })).toBe(true);
        expect(StealthCover.blindside({ unaware: true, darkness: 0.9, lit: false })).toBe(true);
        expect(StealthCover.blindside({ unaware: true, darkness: 0.9, lit: true })).toBe(false);
        expect(StealthCover.blindside({ unaware: false, felled: true })).toBe(false);
        expect(StealthCover.blindside({ unaware: true, darkness: 0 })).toBe(false);
    });

    it('seizing and robbing go better on the unaware, worse on the watch', () => {
        expect(StealthCover.grabChance({ unaware: true })).toBeGreaterThan(StealthCover.grabChance({}));
        expect(StealthCover.grabChance({ guard: true })).toBeLessThan(StealthCover.grabChance({}));
        expect(StealthCover.mugChance({ armed: true, unaware: true })).toBeGreaterThan(StealthCover.mugChance({}));
        expect(StealthCover.mugChance({ guard: true })).toBeLessThan(StealthCover.mugChance({}));
    });
});

describe('those who lie in wait', () => {
    it('more at night, in the wilds, with a bounty, a feud or an assassin sent', () => {
        const day = StealthCover.lurkChance({});
        expect(StealthCover.lurkChance({ night: true })).toBeGreaterThan(day);
        expect(StealthCover.lurkChance({ wilds: true })).toBeGreaterThan(day);
        expect(StealthCover.lurkChance({ bounty: 300 })).toBeGreaterThan(day);
        expect(StealthCover.lurkChance({ feud: 80 })).toBeGreaterThan(day);
        expect(StealthCover.lurkChance({ assassinPlot: true })).toBeGreaterThan(day);
        expect(StealthCover.lurkChance({ night: true, bounty: 5000, feud: 100, assassinPlot: true, nemesis: true, poor: true, lair: true })).toBeLessThanOrEqual(1);
    });

    it('who it is follows what drew them', () => {
        const kinds = (o) => new Set(Array.from({ length: 50 }, (_, i) => StealthCover.lurkKind(i / 50, o)));
        expect(kinds({ wilds: true }).has('outlaw')).toBe(true);
        expect(kinds({ night: true, assassinPlot: true }).has('assassin')).toBe(true);
        expect(kinds({ bounty: 400 }).has('hunter')).toBe(true);
        // no cutthroats by day
        expect(kinds({ night: false }).has('cutthroat')).toBe(false);
        expect(StealthCover.lurkDef('assassin').kill).toBeGreaterThan(StealthCover.lurkDef('footpad').kill);
    });
});

describe('cover on the street map', () => {
    it('a dark corner between two walls is cover only at night', () => {
        const T = (o = {}) => ({ subTerrain: { id: 'dirt', passable: true }, ...o });
        const wall = T({ customBuildingPart: { anchorQ: 0, anchorR: 0 } });
        const tiles = [
            [T(), wall, T()],
            [wall, T(), T()],
            [T(), T(), T()],
        ];
        expect(StreetCover.coverAt(tiles, 1, 1, { darkness: 0 })).toBe(null);
        const c = StreetCover.coverAt(tiles, 1, 1, { darkness: 0.9 });
        expect(c && c.kind).toBe('alley');
        expect(StreetCover.coverAt(tiles, 2, 2, { darkness: 0.9 })).toBe(null);
    });

    it('a town has bushes to hide behind, off its roads and clear of its doors, laid out the same each time', () => {
        const tiles = town('town');
        let bushes = 0, onRoad = 0;
        for (const row of tiles) for (const t of row) {
            if (!t.customObject || !String(t.customObject.defId).startsWith('tp_bush_')) continue;
            const def = CustomObjects.getDef(t.customObject.defId);
            if (!(def.tags || []).includes('bush')) continue;
            bushes++;
            for (const m of def.tiles) { const u = tiles[t.r + m.localRow][t.q + m.localCol]; if (u.isRoad) onRoad++; }
        }
        expect(bushes).toBeGreaterThanOrEqual(12);
        expect(onRoad).toBe(0);
        const spots = StreetCover.spots(tiles);
        const kinds = new Set(spots.map(s => s.kind));
        expect(kinds.has('bush')).toBe(true);
        expect(spots.filter(s => s.kind === 'bush').length).toBeGreaterThan(20);
        // the cells behind a bush are cover, and Hide in the Bush finds them
        const b = spots.find(s => s.kind === 'bush');
        const c = StreetCover.coverAt(tiles, b.q, b.r, {});
        expect(c.kind).toBe('bush');
        expect(c.anchor).toBeTruthy();
        expect(StreetCover.cellsOf(tiles, c.anchor.q, c.anchor.r).some(x => x.q === b.q && x.r === b.r)).toBe(true);
        // the same town again: the same bushes in the same places
        const again = town('town');
        const at = (ts) => { const out = []; for (const row of ts) for (const t of row) if (t.customObject && /^tp_bush_/.test(t.customObject.defId)) out.push(`${t.q},${t.r},${t.customObject.defId}`); return out.join('|'); };
        expect(at(again)).toBe(at(tiles));
    });
});

describe('the street map side', () => {
    it('loads with the game loop and the menus, and does nothing off the map', async () => {
        const { InnerMapHiding } = await import('../ui/innerMapHiding.js');
        await import('../ui/game/gameLoop.js');
        await import('../ui/innerMapUI.js');
        expect(InnerMapHiding.selfItems(null)).toEqual([]);
        expect(InnerMapHiding.personItems({ player: {} }, [])).toEqual([]);
        expect(InnerMapHiding.unseenLurker({ _lurk: { seen: false, sprung: false } })).toBe(true);
        expect(InnerMapHiding.unseenLurker({ _lurk: { seen: true, sprung: false } })).toBe(false);
        expect(InnerMapHiding.listenBoost()).toEqual({ chance: 1, radius: 0 });
        InnerMap.active = false;
        InnerMapHiding.update(0.1, { player: {}, world: {} });
        expect(InnerMapHiding.hidden).toBe(null);
    });
});
