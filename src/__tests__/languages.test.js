/**
 * Cultures and languages (world/cultures.js, systems/languages.js): every
 * realm speaks its own tongue; the player and the rival Houses learn them by
 * living among speakers, talking and lessons, or hire interpreters; not
 * understanding costs at market, in conversation and at court; courts learn
 * each other's tongues; towns are built of their culture's materials.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';

let Cultures, Languages, Trading, newGame, Hex;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const h = await import('./playtest/harness.js');
    await h.loadData();
    newGame = h.newGame;
    ({ Cultures } = await import('../world/cultures.js'));
    ({ Languages } = await import('../systems/languages.js'));
    ({ Trading } = await import('../player/playerEconomy.js'));
    ({ Hex } = await import('../core/hex.js'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
}, 120000);

/** A settlement of another tongue than the player's, and its language */
function foreignTown(world, player) {
    for (const s of world.getSettlementViews()) {
        const lang = Languages.settlementLanguage(world, s);
        if (lang && Cultures.understands(player.languages, lang) < 20) return { s, lang };
    }
    return null;
}

describe('the model', () => {
    it('every culture speaks a known tongue; kindred tongues are partly understood', () => {
        for (const c of Cultures.cultureNames()) expect(Cultures.languageOfCulture(c), c).toBeTruthy();
        expect(new Set(Cultures.cultureNames().map(c => Cultures.languageOfCulture(c))).size).toBe(Cultures.cultureNames().length);
        // Vellish and Liturgic are kin: a fluent Vellish speaker gets 40% of Liturgic
        expect(Cultures.understands({ vellish: 100 }, 'liturgic')).toBe(40);
        expect(Cultures.understands({ vellish: 100 }, 'norrish')).toBe(0);
        expect(Cultures.level(35).id).toBe('broken');
        expect(Cultures.level(85).id).toBe('fluent');
    });

    it('speech as heard: the words you lack come out in the tongue, always the same way', () => {
        const line = 'Welcome to the market, traveller. *She smiles.* Bread is three coins today.';
        const none = Cultures.hear(line, 'norrish', 0);
        expect(none).not.toContain('Welcome');
        expect(none).toContain('*She smiles.*');
        expect(Cultures.hear(line, 'norrish', 0)).toBe(none);
        expect(Cultures.hear(line, 'norrish', 1)).toBe(line);
        const some = Cultures.hear(line, 'norrish', 0.5);
        const kept = line.split(' ').filter(w => some.includes(w.replace(/[.,*]/g, ''))).length;
        expect(kept).toBeGreaterThan(0);
        expect(some).not.toBe(line);
    });

    it('a generated world gives every settlement its culture, and its realm\'s at that', () => {
        const { world } = newGame(4242, { terrainGen: 3 });
        const views = world.getSettlementViews();
        expect(views.length).toBeGreaterThan(5);
        for (const s of views) {
            expect(s.culture, s.name).toBeTruthy();
            const k = s.kingdom ? world.getKingdom(s.kingdom) : null;
            if (k && s.type === 'capital') expect(s.culture).toBe(k.culture);
        }
    });
});

describe('the player\'s tongues', () => {
    it('you begin speaking the tongue of where you begin — and understand it fully', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        expect(player.nativeLanguage).toBeTruthy();
        expect(player.languages[player.nativeLanguage]).toBe(100);
        const here = Languages.here(player, world);
        if (here.lang) expect(here.lang === player.nativeLanguage || here.value >= 40).toBe(true);
    });

    it('a town of another tongue: worse prices, then better as you learn it', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const f = foreignTown(world, player);
        expect(f).toBeTruthy();
        const tile = world.getTile(f.s.q, f.s.r);
        const live = tile.settlement;
        const mod0 = Languages.tradeModifier(player, live, world);
        expect(mod0).toBeLessThan(0);
        const d0 = Trading.buyDiscount(player, live);
        player.languages[f.lang] = 60;
        expect(Languages.tradeModifier(player, live, world)).toBe(0);
        expect(Trading.buyDiscount(player, live)).toBeGreaterThan(d0);
        player.languages[f.lang] = 95;
        expect(Languages.tradeModifier(player, live, world)).toBeGreaterThan(0);
    });

    it('living among speakers teaches, slower the better you get; a level reached is announced', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const f = foreignTown(world, player);
        player.q = f.s.q; player.r = f.s.r;
        let notices = [];
        for (let d = 0; d < 40; d++) { world.day++; notices = notices.concat(Languages.processDay(player, world).notices); }
        const after40 = Languages.fluency(player, f.lang);
        expect(after40).toBeGreaterThan(20);
        expect(notices.some(n => /get by/.test(n.text))).toBe(true);
        // the next 40 days teach less than the first 40
        for (let d = 0; d < 40; d++) { world.day++; Languages.processDay(player, world); }
        expect(Languages.fluency(player, f.lang) - after40).toBeLessThan(after40);
    });

    it('a tutor: a lesson a day for a fee', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const f = foreignTown(world, player);
        player.q = f.s.q; player.r = f.s.r;
        player.gold = 100;
        const r1 = Languages.lesson(player, world, f.lang);
        expect(r1.success).toBe(true);
        expect(player.gold).toBe(100 - r1.spent);
        expect(Languages.fluency(player, f.lang)).toBeGreaterThan(0);
        expect(Languages.lesson(player, world, f.lang).success).toBe(false);
        world.day++;
        expect(Languages.lesson(player, world, f.lang).success).toBe(true);
    });

    it('an interpreter: hired in town, speaks its tongue and yours, paid daily, leaves when unpaid', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const f = foreignTown(world, player);
        player.q = f.s.q; player.r = f.s.r;
        player.gold = 200;
        const offer = Languages.translatorOffer(player, world);
        expect(offer.tongues).toContain(f.lang);
        expect(offer.tongues).toContain(player.nativeLanguage);
        expect(Languages.hireTranslator(player, world).success).toBe(true);
        expect(Languages.here(player, world).via).toBe('translator');
        expect(Languages.here(player, world).value).toBeGreaterThanOrEqual(70);
        const g = player.gold;
        world.day++;
        Languages.processDay(player, world);
        expect(player.gold).toBe(g - offer.wage);
        player.gold = 0;
        world.day++;
        const out = Languages.processDay(player, world);
        expect(player.translator).toBeNull();
        expect(out.notices.some(n => /leaves/.test(n.title))).toBe(true);
    });

    it('a court of another tongue will not hear you — until you learn it or bring an interpreter', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const k = world.kingdoms.find(x => Cultures.understands(player.languages, Cultures.languageOfCulture(x.culture)) < 20);
        expect(Languages.canAudience(player, world, k).ok).toBe(false);
        player.languages[Cultures.languageOfCulture(k.culture)] = 55;
        expect(Languages.canAudience(player, world, k).ok).toBe(true);
    });

    it('in conversation, without words only gestures are left', () => {
        expect(Languages.dialogChoices('none')).toEqual(expect.arrayContaining(['farewell', 'trade', 'give_gift']));
        expect(Languages.dialogChoices('none')).not.toContain('persuade');
        expect(Languages.dialogChoices('conversational')).toBeNull();
    });

    it('a character from before languages speaks where they stand, and gets by where they are known', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        delete player.languages;
        // (understood until the first day gives them their tongues)
        expect(Languages.comprehension(player, 'norrish').value).toBe(100);
        const k = world.kingdoms[1];
        player.reputation = { [k.id]: 30 };
        Languages.ensure(player, world);
        expect(Languages.fluency(player, Cultures.languageOfCulture(k.culture))).toBeGreaterThanOrEqual(60);
    });
});

describe('the AI', () => {
    it('courts: a common tongue helps, none hurts, and each contact teaches', () => {
        const a = { id: 'a', culture: 'Imperial' };
        const b = { id: 'b', culture: 'Nordic' };
        const c = { id: 'c', culture: 'Imperial' };
        expect(Cultures.realmDiplomacy(a, c)).toBe(2);
        expect(Cultures.realmDiplomacy(a, b)).toBe(-3);
        expect(a.tongues.norrish).toBeGreaterThan(0);
        for (let i = 0; i < 40; i++) Cultures.realmDiplomacy(a, b);
        expect(Cultures.realmDiplomacy(a, b)).toBeGreaterThan(-3);
    });

    it('a rival House abroad pays an interpreter when it can, else deals worse; and learns', () => {
        const { world, player } = newGame(4242, { terrainGen: 3 });
        const f = foreignTown(world, player);
        const rich = { gold: 1000, kingdomId: null };
        const v1 = Languages.rivalVisit(world, rich, world.getTile(f.s.q, f.s.r).settlement, 'Imperial' === f.s.culture ? 'Nordic' : 'Imperial');
        if (v1.lang !== Cultures.languageOfCulture(rich.languages && Object.keys(rich.languages)[0])) {
            expect(v1.paid).toBeGreaterThan(0);
            expect(rich.gold).toBe(1000 - v1.paid);
        }
        const poor = { gold: 0 };
        const v2 = Languages.rivalVisit(world, poor, world.getTile(f.s.q, f.s.r).settlement, f.s.culture === 'Imperial' ? 'Nordic' : 'Imperial');
        expect(v2.dealFactor).toBeLessThan(1);
        expect(v2.favourFactor).toBe(0.5);
        expect(poor.languages[v2.lang]).toBeGreaterThan(0);
    });
});

describe('how a culture builds', () => {
    it('a town is built of its culture\'s materials (worlds since terrainGen 3)', async () => {
        const { InnerMap } = await import('../world/innerMap.js');
        const { DataLoader } = await import('../core/dataLoader.js');
        const { CustomBuildings } = await import('../world/customBuildings.js');
        const { CustomObjects } = await import('../world/customObjects.js');
        CustomBuildings.reset(); await CustomBuildings.loadAll();
        CustomObjects.reset(); await CustomObjects.loadAll();
        const walls = (culture, gen) => {
            InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
            InnerMap._cache = {};
            const settlement = { name: 'Testby', type: 'town', population: 2000, q: 5, r: 6, culture };
            const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
            const world = {
                day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31, terrainGen: gen }, activeEvents: [], kingdoms: [],
                getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
            };
            InnerMap.enter({ world, player: {} }, 5, 6);
            const count = {};
            for (const row of InnerMap.tiles) for (const t of row) {
                const id = t.customBuilding && t.customBuilding.defId;
                const def = id ? CustomBuildings.getBuilding(id) : null;
                if (def && def.wall) count[def.wall] = (count[def.wall] || 0) + 1;
            }
            return count;
        };
        const share = (count, mats) => {
            const total = Object.values(count).reduce((a, b) => a + b, 0) || 1;
            return mats.reduce((a, m) => a + (count[m] || 0), 0) / total;
        };
        const desert = walls('Desert', 3);
        const nordic = walls('Nordic', 3);
        expect(share(desert, ['stone_ochre', 'plaster', 'stone_beige'])).toBeGreaterThan(share(nordic, ['stone_ochre', 'plaster', 'stone_beige']));
        expect(share(nordic, ['planks', 'timber', 'fieldstone'])).toBeGreaterThan(share(desert, ['planks', 'timber', 'fieldstone']));
    }, 120000);
});
