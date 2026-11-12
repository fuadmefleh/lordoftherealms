/**
 * The young and the old on the street map (world/innerMap/townKin.js,
 * ui/innerMapKin.js): pupils walk into the schoolroom of a morning, children
 * are drawn by their age, the old's hair greys.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, InnerMapKin, InnerMapCharacters, TownSchool;

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
    ({ InnerMapKin } = await import('../ui/innerMapKin.js'));
    ({ InnerMapCharacters } = await import('../ui/innerMapCharacters.js'));
    ({ TownSchool } = await import('../systems/townSchool.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function enter(hour, day = 8, type = 'city') {
    const settlement = { name: 'Testby', type, population: 6000, q: 5, r: 6 };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    const game = { world, player: {}, settlement, ui: { showNotification() {} } };
    InnerMap.enter(game, 5, 6);
    InnerMap.timeOfDay = hour;
    return game;
}

function run(game, seconds, step = 0.25) {
    for (let t = 0; t < seconds; t += step) {
        InnerMapKin.update(step, game);
        InnerMap.updateNPCs(step);
    }
}

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(5);
});

describe('The young and the old on the street map', () => {
    it('on a school-day morning the pupils go into the schoolroom, and are drawn by their age', () => {
        const game = enter(8.2, 8);
        const folk = game.settlement.folk;
        run(game, 1);
        const kids = InnerMap.npcs.filter(n => n._person && n.type === 'child');
        expect(kids.length).toBeGreaterThan(0);
        for (const k of kids) expect(k._scale).toBeLessThan(1);
        // Everyone free to choose picks again
        for (const n of InnerMap.npcs) if (n.state === 'idle') n.idleTimer = 0;
        run(game, 40);
        const pupils = kids.filter(k => TownSchool.inClass(game.world, game.settlement, folk, k._person, 8, 9) && !TownSchool.inClass(game.world, game.settlement, folk, k._person, 8, 9).truant
            && TownSchool.kindFor(game.world, game.settlement, folk, k._person, 8) !== 'tutor');
        if (pupils.length) {
            const school = new Set(['church', 'chapel', 'temple', 'library']);
            const inSchool = pupils.filter(k => (k.state === 'inside_building' && school.has(k.currentBuilding)) || (k._pupil && k.state === 'walking'));
            expect(inSchool.length).toBeGreaterThan(0);
        }
    });

    it('the old get a greyed copy of their look', () => {
        const base = 'male_light_1';
        if (!InnerMapCharacters._presets || !InnerMapCharacters._presets[base]) {
            InnerMapCharacters.configure(DataLoader._gamedata.innerMapRenderer || JSON.parse(fs.readFileSync('data/innerMapRenderer.json', 'utf8')));
        }
        const pre = InnerMapCharacters._presets[base];
        expect(pre).toBeTruthy();
        const id = InnerMapKin.agedPreset(base, 'White');
        expect(id).toBe(`aged:White:${base}`);
        const layers = InnerMapCharacters._presets[id].layers;
        for (const l of layers.filter(x => x.startsWith('Hair/'))) expect(l.endsWith('/White')).toBe(true);
        expect(layers.filter(x => !x.startsWith('Hair/'))).toEqual(pre.layers.filter(x => !x.startsWith('Hair/')));
    });

    it('a child of 5 is drawn smaller than a youth of 14', () => {
        expect(InnerMapKin.scaleFor(5)).toBeLessThan(InnerMapKin.scaleFor(14));
        expect(InnerMapKin.scaleFor(20)).toBe(null);
    });
    it('in an older era the greyed look wears that era\'s clothes', async () => {
        if (!InnerMapCharacters._presets || !InnerMapCharacters._presets.male_light_1) {
            InnerMapCharacters.configure(DataLoader._gamedata.innerMapRenderer || JSON.parse(fs.readFileSync('data/innerMapRenderer.json', 'utf8')));
        }
        const { EraWardrobe } = await import('../world/eraWardrobe.js');
        const eras = EraWardrobe.list().filter(e => typeof e.before === 'number' && !EraWardrobe.isModern(e));
        if (!eras.length) return;
        InnerMapCharacters.setYear(eras[0].before - 1);
        try {
            const era = InnerMapCharacters.getPresetForNPC('villager', 7, 'male');
            expect(era.startsWith('era:')).toBe(true);
            const id = InnerMapKin.agedPreset(era, 'Gray');
            expect(id).toContain(InnerMapCharacters.eraId());
            const m = /^era:[^:]+:(.+)#(\d+)$/.exec(era);
            const fitted = InnerMapCharacters.eraLayers(InnerMapCharacters._presets[m[1]].layers, m[1] + '#' + m[2]);
            const got = InnerMapCharacters._presets[id].layers;
            expect(got.filter(l => !l.startsWith('Hair/'))).toEqual(fitted.filter(l => !l.startsWith('Hair/')));
            for (const l of got.filter(x => x.startsWith('Hair/'))) expect(l.endsWith('/Gray')).toBe(true);
        } finally {
            InnerMapCharacters.setYear(null);
        }
    });

    it('a christening today gathers the parents, godparents and priest at the church door', () => {
        const game = enter(10, 8);
        const folk = game.settlement.folk;
        const mum = InnerMap.npcs.find(n => n._person && n._person.gender === 'female' && n.age >= 20 && n.age <= 40 && n.state !== 'inside_building');
        const god = InnerMap.npcs.find(n => n._person && n !== mum && n.age >= 20 && n.state !== 'inside_building' && n.type !== 'guard');
        expect(mum && god).toBeTruthy();
        const babe = { id: folk.n++, first: 'Wren', last: mum._person.last, gender: 'female', born: 5, died: null, role: 'child', traits: [], spouse: null, parents: [mum._person.id], kids: [], away: null, log: [], godparents: [god._person.id], christened: 8 };
        folk.people.push(babe);
        delete folk._index;
        folk.annals.push({ k: 'christened', a: babe.id, b: mum._person.id, d: 8 });
        // (the next look round is now, while they are out in the street)
        InnerMapKin._tick = 0;
        run(game, 0.5);
        expect(mum._wedding).toBeTruthy();
        expect(god._wedding).toBe(mum._wedding);
        run(game, 40);
        expect(mum._wedding).toBeFalsy();
    });
});
