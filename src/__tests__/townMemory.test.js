// The world remembers physically (systems/townMemory.js, world/townMarks.js):
// fires burn through the timber houses and are rebuilt over years, often in
// stone; sacks leave ruins; statues are raised to a loved House and pulled
// down when it is hated or gone; battles leave cairns; wealth builds new
// quarters. Each mark matters (mood, wages, stores, renown) and shows on the
// town's street map.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, CustomBuildings, CustomObjects, DataLoader, TownMemory, TownMarks, TownLabour, Taxation, newGame;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const h = await import('./playtest/harness.js');
    await h.loadData();
    newGame = h.newGame;
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ TownMemory } = await import('../systems/townMemory.js'));
    ({ TownMarks } = await import('../world/townMarks.js'));
    ({ TownLabour } = await import('../world/townLabour.js'));
    ({ Taxation } = await import('../systems/marketDynamics.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
}, 180000);

/** A town's street map on `day`, with its settlement's marks. */
function townMap(settlement, day, extra = {}) {
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.55, moisture: 0.5, settlement };
    const game = { world: { day, season: 'Spring', generationParams: { seed: 5 }, activeEvents: [], getTile: () => worldTile, getKingdom: () => null, ...extra } };
    InnerMap._cache = {};
    return InnerMap.generate(worldTile, settlement.q, settlement.r, game);
}

function survey(tiles) {
    const out = { buildings: 0, burnt: 0, scorched: 0, stone: 0, props: {}, doorsOk: true, swapped: 0 };
    for (const row of tiles) for (const t of row) {
        if (t.customBuilding) {
            out.buildings++;
            const def = CustomBuildings.getBuilding(t.customBuilding.defId);
            if (t.customBuilding.ruin === 'burnt' || t.customBuilding.ruin === 'sacked') out.burnt++;
            if (t.customBuilding.ruin === 'scorched') out.scorched++;
            if (t.customBuilding.rebuilt != null) out.swapped++;
            if (TownMarks.isStone(def)) out.stone++;
            if (!t.customBuilding.ruin) {
                const door = (def.meta || []).find(m => m.door);
                if (door) {
                    const below = tiles[t.r + door.r + 1][t.q + door.q];
                    if (!below.isRoad) out.doorsOk = false;
                }
            }
        }
        if (t.customObject && /^tm_/.test(t.customObject.defId)) out.props[t.customObject.defId] = (out.props[t.customObject.defId] || 0) + 1;
    }
    return out;
}

describe('town memory on the street map', () => {
    it('a fire burns timber houses to shells, then cleared plots, then they are rebuilt (often in stone)', () => {
        const base = { name: 'Emberford', type: 'town', population: 2000, q: 9, r: 14 };
        const before = survey(townMap({ ...base }, 10));
        const s = { ...base };
        TownMarks.add(s, 'fire', { share: 0.35, stoneShare: 1, slow: 1 }, 5);
        const shell = survey(townMap(s, 20));
        expect(shell.burnt).toBeGreaterThan(2);
        expect(shell.buildings).toBe(before.buildings);

        const cleared = survey(townMap(s, 5 + 200));
        expect(cleared.buildings).toBeLessThan(before.buildings);
        expect(cleared.props.tm_charred || 0).toBeGreaterThan(0);

        const later = survey(townMap(s, 5 + 120 * 9));
        expect(later.burnt).toBe(0);
        expect(later.props.tm_charred || 0).toBe(0);
        expect(later.buildings).toBe(before.buildings);
        // Rebuilt in stone where the kit has a stone twin of the same footprint
        expect(later.stone).toBeGreaterThanOrEqual(before.stone);
        expect(later.doorsOk).toBe(true);
    });

    it('the same marks always lay the same way (hash-placed, the plan beneath untouched)', () => {
        const s = { name: 'Twicetold', type: 'town', population: 2000, q: 4, r: 6 };
        TownMarks.add(s, 'fire', { share: 0.3, stoneShare: 0.5 }, 3);
        const a = townMap(s, 100), b = townMap(s, 100);
        const sig = tiles => tiles.flat().filter(t => t.customBuilding || (t.customObject && /^tm_/.test(t.customObject.defId))).map(t => `${t.q},${t.r}:${t.customBuilding ? t.customBuilding.defId + (t.customBuilding.ruin || '') : t.customObject.defId}`).join('|');
        expect(sig(a)).toBe(sig(b));
    });

    it('a sack leaves ruins that a poor town never rebuilds', () => {
        const s = { name: 'Ashwall', type: 'town', population: 1500, q: 12, r: 3 };
        TownMarks.add(s, 'sack', { share: 0.4, never: 1 }, 2);
        const ruins = survey(townMap(s, 120 * 20));
        expect((ruins.props.tm_ruined_arch || 0) + (ruins.props.tm_broken_column || 0)).toBeGreaterThan(0);
    });

    it('statues stand in the square, cairns and mounds by the road out, a new quarter grows', () => {
        const s = { name: 'Gloria', type: 'town', population: 2000, q: 7, r: 7 };
        const plain = survey(townMap({ ...s }, 10));
        TownMarks.add(s, 'statue', { house: 'House Harness', who: 'Bot Harness', state: 'standing' }, 3);
        TownMarks.add(s, 'cairn', { dead: 500, victor: 'Arland' }, 4);
        TownMarks.add(s, 'name', { house: 'House Harness', name: 'Harness Square', state: 'kept' }, 5);
        TownMarks.add(s, 'district', { tier: 'rich' }, 6);
        const got = survey(townMap(s, 10));
        expect(got.props.tm_statue).toBe(1);
        expect(got.props.tm_cairn).toBe(1);
        expect(got.props.tm_mound).toBe(1);
        expect(got.props.tm_plaque).toBe(1);
        expect(got.buildings).toBeGreaterThan(plain.buildings);
        expect(got.doorsOk).toBe(true);
        // Toppled: the toppled statue's art
        TownMarks.marks(s, 'statue')[0].state = 'toppled';
        expect(survey(townMap(s, 10)).props.tm_statue_toppled).toBe(1);
    });

    it('a memorial a later pass cleared (a pier, the water) is stood again, and nothing is doubled', () => {
        const s = { name: 'Quaymourn', type: 'town', population: 2000, q: 8, r: 9 };
        TownMarks.add(s, 'statue', { house: 'House Harness', who: 'Bot Harness', state: 'standing' }, 3);
        TownMarks.add(s, 'cairn', { dead: 120 }, 4);
        const tiles = townMap(s, 10);
        const day = 10;
        // Already complete: nothing to put back
        expect(TownMarks.relay(tiles, s, day)).toEqual({ statues: 0, plaques: 0, cairns: 0 });
        // A later pass clears the cairn (as harbour.js / water.js do to what they run over)
        const at = TownMarks._memorialsOnMap(tiles).get(`${TownMarks.marks(s, 'cairn')[0].id}|tm_cairn`);
        expect(at).toBeTruthy();
        tiles[at.r][at.q].customObject = null;
        expect(survey(tiles).props.tm_cairn || 0).toBe(0);
        const back = TownMarks.relay(tiles, s, day);
        expect(back.cairns).toBe(1);
        const got = survey(tiles);
        expect(got.props.tm_cairn).toBe(1);
        expect(got.props.tm_statue).toBe(1);
        // Never on a building lot, nor across its front (where a house will want its door)
        for (const row of tiles) for (const t of row) {
            const part = t.customObjectPart;
            const anchor = part ? tiles[part.anchorR] && tiles[part.anchorR][part.anchorQ] : t;
            if (!anchor || !anchor.customObject || !anchor.customObject.memory) continue;
            for (let dr = 0; dr <= 2; dr++) expect(!!(tiles[t.r - dr] && tiles[t.r - dr][t.q]._lot)).toBe(false);
        }
    });

    it('the stamp changes when the marks change how the town looks', () => {
        const s = { name: 'Stampton', type: 'village', population: 300, q: 1, r: 1 };
        expect(TownMarks.stamp(s, 10)).toBe('');
        TownMarks.add(s, 'fire', { share: 0.2 }, 5);
        const a = TownMarks.stamp(s, 10);
        expect(a).not.toBe('');
        expect(TownMarks.stamp(s, 20)).toBe(a);
        expect(TownMarks.stamp(s, 300)).not.toBe(a);
    });
});

describe('town memory in the world', () => {
    it('a fire kills, drives out, burns the stores; rebuilding hires hands and eats timber; grief lowers the mood', () => {
        const { world } = newGame(31);
        const s = world.getSettlementViews().find(x => x.type === 'town') || world.getSettlementViews()[0];
        const pop = s.population;
        TownLabour.update(s, {});
        const craftJobs = s.labour && s.labour.jobs ? s.labour.jobs.craft : 0;
        const m = TownMemory.mark(s, 'fire', { share: 0.4 }, world);
        expect(m.great).toBe(true);
        expect(s.population).toBeLessThan(pop);
        expect(m.homeless).toBeGreaterThan(0);
        TownMemory._rebuild(s, world.day + 30);
        expect(s.memory.rebuildHands).toBeGreaterThan(0);
        TownLabour.update(s, {});
        expect(s.labour.jobs.craft).toBeGreaterThan(craftJobs);
        TownMemory._mood(s, world.day + 30);
        expect(Taxation.memoryMood(s)).toBeLessThan(0);
        // ...fading over the years
        TownMemory._mood(s, world.day + 120 * 30);
        expect(Taxation.memoryMood(s)).toBe(0);
    });

    it('fires are rolled from hashes: the same world burns the same way, a few times a century', () => {
        const run = () => {
            const { world } = newGame(32);
            const views = world.getSettlementViews();
            let fires = 0;
            for (let d = 1; d <= 120 * 25; d++) {
                world.day = d;
                TownMemory.processDay(world, null);
            }
            for (const s of views) fires += TownMarks.marks(s, 'fire').length;
            return { fires, towns: views.length };
        };
        const a = run(), b = run();
        expect(a).toEqual(b);
        // ~1–2 fires a century per town: over 25 years, well under one per town
        expect(a.fires).toBeGreaterThan(0);
        expect(a.fires).toBeLessThan(a.towns);
    }, 120000);

    it('a famous House gets a statue in a capital; it is defaced and pulled down when the realm hates it', () => {
        const { world, player } = newGame(33);
        const cap = world.getSettlementViews().find(x => x.type === 'capital');
        expect(cap).toBeTruthy();
        player.renown = 2000;
        const renown = player.renown;
        const out = { notices: [] };
        TownMemory._monuments(world, cap, { player, held: null }, 300, out);
        const st = TownMarks.marks(cap, 'statue');
        expect(st.length).toBe(1);
        expect(st[0].house).toBe(player.house.name);
        expect(player.renown).toBeGreaterThan(renown);
        // Hated now
        player.renown = 0;
        player.reputation = { [cap.kingdom]: -5000 };
        TownMemory._monuments(world, cap, { player, held: null }, 330, out);
        expect(st[0].state).toBe('defaced');
        TownMemory._monuments(world, cap, { player, held: null }, 330 + 120 * 3, out);
        expect(st[0].state).toBe('toppled');
    });

    it('a statue to a House that has fallen is defaced and toppled in the years after', () => {
        const { world } = newGame(34);
        const s = world.getSettlementViews()[0];
        TownMemory.mark(s, 'statue', { house: 'House Gone', who: 'Old Lord', state: 'standing' }, world);
        const st = TownMarks.marks(s, 'statue')[0];
        const out = { notices: [] };
        TownMemory._monuments(world, s, { player: null }, 100, out);
        expect(st.state || 'standing').toBe('standing');
        TownMemory._monuments(world, s, { player: null }, 100 + 120 * 3, out);
        expect(st.state).toBe('defaced');
        TownMemory._monuments(world, s, { player: null }, 100 + 120 * 6, out);
        expect(st.state).toBe('toppled');
    });

    it('battles leave cairns by the town or on the open field; the dead of a second battle join the first', () => {
        const { world, player } = newGame(35);
        const s = world.getSettlementViews()[0];
        expect(TownMarks.noteBattle(world, s.q, s.r, { dead: 10 })).toBeNull();
        const m = TownMarks.noteBattle(world, s.q, s.r, { dead: 120, victor: 'A', loser: 'B', day: 50 });
        TownMarks.noteBattle(world, s.q, s.r, { dead: 200, day: 90 });
        expect(TownMarks.marks(s, 'cairn').length).toBe(1);
        expect(m.dead).toBe(320);
        // An empty hex
        let open = null;
        for (let r = 0; r < world.height && !open; r++) for (let q = 0; q < world.width && !open; q++) {
            let near = false;
            for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) { const t = world.getTile(q + dq, r + dr); if (t && t.settlement) near = true; }
            if (!near) open = { q, r };
        }
        TownMarks.noteBattle(world, open.q, open.r, { dead: 400, day: 60 });
        expect(TownMarks.fieldMarks(world, open.q, open.r).length).toBe(1);
        // Respects: karma, once a year
        world.day = 100;
        const k = player.karma || 0;
        expect(TownMemory.respects(player, world, s, m.id).ok).toBe(true);
        expect(player.karma).toBe(k + 1);
        expect(TownMemory.respects(player, world, s, m.id).ok).toBe(false);
    });

    it('a new quarter is built after years of wealth and growth', () => {
        const { world } = newGame(36);
        const s = world.getSettlementViews().find(x => x.type === 'city' || x.type === 'capital');
        const mem = TownMarks.memory(s, true);
        mem.basePop = s.population;
        mem.since = 0;
        s.population = s.population * 2;
        s.economy = { ...(s.economy || {}), gold: s.population * 50 };
        TownMemory._district(world, s, mem, 120 * 13, { notices: [] }, false);
        expect(TownMarks.marks(s, 'district').length).toBe(1);
    });

    it('the history and inscriptions are templates, or the LLM prose under town:<id>:mark:<markId>', () => {
        const { world } = newGame(37);
        const s = world.getSettlementViews()[0];
        const m = TownMemory.mark(s, 'cairn', { dead: 90 }, world);
        expect(TownMemory.inscription(s, m, world)).toMatch(/90/);
        const asked = [];
        TownMemory.setProse({ write: (w, req) => { asked.push(req.key); }, text: (w, key, fb) => (key.endsWith(`:mark:${m.id}`) ? 'Carved by a poet.' : fb) });
        try {
            TownMemory.mark(s, 'fire', { share: 0.1 }, world);
            expect(asked.some(k => /^town:.+:mark:m\d+$/.test(k))).toBe(true);
            expect(TownMemory.inscription(s, m, world)).toBe('Carved by a poet.');
            expect(TownMemory.describe(s, world).length).toBeGreaterThanOrEqual(2);
        } finally {
            TownMemory.setProse(null);
        }
    });
});
