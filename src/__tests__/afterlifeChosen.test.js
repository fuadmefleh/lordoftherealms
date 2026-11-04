// A new life in a settlement of the player's choosing (player/afterlife.js
// townChoices / candidatesAt): beside the random people on offer, the player
// picks any living town (or, at the Dawn of Man, a clan or its village) and is
// offered its own townsfolk, locals of its culture, and a newcomer arriving.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { Afterlife } from '../player/afterlife.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Cultures } from '../world/cultures.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

let shared = null;
/** One generated world for the read-only checks (each becomeStranger test makes its own). */
function world0() {
    if (!shared) shared = newGame(41);
    return shared;
}

/** A middling town of the first realm listed. */
function someTown(world) {
    const all = Afterlife.townChoices(world).filter(t => t.kingdom);
    return all.find(t => t.type === 'town') || all[0];
}

describe('choosing the settlement', () => {
    it('lists every living settlement once, by realm then size, with its culture and tongue', () => {
        const { world } = world0();
        const list = Afterlife.townChoices(world);
        const living = world.getSettlementViews().filter(v => (world.getTile(v.q, v.r).settlement || {}).population > 0);
        expect(list.length).toBe(living.length);
        expect(new Set(list.map(t => t.id)).size).toBe(list.length);
        for (const t of list) {
            expect(world.getTile(t.q, t.r).settlement.name).toBe(t.name);
            expect(t.culture).toBeTruthy();
            expect(t.population).toBeGreaterThan(0);
        }
        // Grouped by realm (the free lands last), largest first within one
        const realms = list.map(t => t.kingdom);
        const firstFree = realms.indexOf(null);
        if (firstFree >= 0) expect(realms.slice(firstFree).every(k => k === null)).toBe(true);
        for (let i = 1; i < list.length; i++) {
            if (list[i].kingdom === list[i - 1].kingdom) expect(list[i - 1].population).toBeGreaterThanOrEqual(list[i].population);
        }
        expect(Afterlife.townChoiceAt(world, list[0].q, list[0].r)).toMatchObject({ id: list[0].id });
    }, 240000);

    it('offers people of that town: its own folk first, locals, and a newcomer from elsewhere', () => {
        const { world } = world0();
        const C = Afterlife.config();
        const town = someTown(world);
        const live = world.getTile(town.q, town.r).settlement;
        const cands = Afterlife.candidatesAt(world, town);
        expect(cands.length).toBe(C.candidates + 1);
        expect(Afterlife.candidatesAt(world, town)).toEqual(cands);          // the same for the same day
        expect(Afterlife.candidatesAt(world, town, 1)).not.toEqual(cands);   // others on a reroll
        expect(new Set(cands.map(c => c.key)).size).toBe(cands.length);
        for (const c of cands) {
            expect([c.q, c.r]).toEqual([town.q, town.r]);
            expect(c.town).toBe(live.name);
            expect(c.chosen).toBe(true);
            expect(c.age).toBeGreaterThanOrEqual(C.minAge);
            expect(c.age).toBeLessThanOrEqual(C.maxAge);
            expect(c.gold).toBeGreaterThan(0);
            expect(C.stations[c.station]).toBeTruthy();
        }
        // A town never walked through gets its roster, and its real people are offered
        expect(live.folk).toBeTruthy();
        const own = cands.filter(c => c.folkId != null);
        expect(own.length).toBeGreaterThan(0);
        for (const c of own) {
            const p = Townsfolk.get(live.folk, c.folkId);
            expect(Townsfolk.isHere(p)).toBe(true);
            expect(`${p.first} ${p.last}`).toBe(`${c.first} ${c.last}`);
            expect(c.culture).toBe(town.culture);
            expect(c.native).toBe(Cultures.languageOfCulture(town.culture));
        }
        const comer = cands.at(-1);
        expect(comer.newcomer).toBeTruthy();
        expect(comer.newcomer.from).not.toBe(live.name);
        expect(comer.folkId).toBe(null);
    }, 240000);

    it('a town that is no more offers no one, and cannot be become', () => {
        const { world } = world0();
        const town = Afterlife.townChoices(world).at(-1);
        const live = world.getTile(town.q, town.r).settlement;
        const cand = Afterlife.candidatesAt(world, town)[0];
        const pop = live.population;
        live.population = 0;
        try {
            expect(Afterlife.townChoices(world).some(t => t.id === town.id)).toBe(false);
            expect(Afterlife.candidatesAt(world, town)).toEqual([]);
            expect(Afterlife.becomeStranger(null, world, cand).success).toBe(false);
        } finally {
            live.population = pop;
        }
    }, 240000);
});

describe('the panels', () => {
    it('the new-life panel offers the random people and the choose-a-settlement path', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { world, player } = world0();
        const panels = [];
        const notes = [];
        const game = {
            player, world,
            ui: {
                showCustomPanel: (title, html) => panels.push({ title, html }),
                showNotification: (t, m) => notes.push(m), updateStats: () => {}, hideCustomPanel: () => {},
            },
        };
        ActionMenu.showNewLife(game, 0, 'old age');
        const first = panels.at(-1).html;
        expect((first.match(/window\._afterlifeBecome\(/g) || []).length).toBe(Afterlife.config().candidates);
        expect(first).toContain('window._afterlifeChooseTown()');
        expect(first).toContain('Choose a settlement');

        window._afterlifeChooseTown();
        const list = panels.at(-1);
        const town = someTown(world);
        expect(list.html).toContain(`window._afterlifeTown('${town.id}')`);
        expect(list.html).toContain(town.kingdom);

        window._afterlifeTown(town.id);
        const at = panels.at(-1);
        expect(at.title).toContain(town.name);
        expect((at.html.match(/window\._afterlifeBecome\(/g) || []).length).toBe(Afterlife.config().candidates + 1);
        expect(at.html).toContain('Just arrived');
        expect(typeof window._afterlifeOtherTown).toBe('function');
        expect(notes).toEqual([]);
    }, 240000);
});

describe('a new life begun there', () => {
    it('places the new character in the chosen town, speaking its tongue, and saves and loads', () => {
        const game = newGame(42);
        const { world } = game;
        const old = game.player;
        const town = someTown(world);
        const live = world.getTile(town.q, town.r).settlement;
        const cands = Afterlife.candidatesAt(world, town);
        const cand = cands.find(c => c.folkId != null) || cands[0];
        Afterlife.begin(old, world, 'a fall');
        const res = Afterlife.becomeStranger(old, world, cand);
        expect(res.success).toBe(true);
        const me = res.player;
        expect([me.q, me.r]).toEqual([town.q, town.r]);
        expect(world.getTile(me.q, me.r).settlement).toBe(live);
        expect(me.name).toBe(`${cand.first} ${cand.last}`);
        expect(me.gold).toBe(cand.gold);
        expect(me.origin).toMatchObject({ town: live.name, q: town.q, r: town.r, chosen: true });
        expect(me.nativeLanguage).toBe(cand.native);
        expect(me.languages[cand.native]).toBe(100);
        if (live.kingdom) expect(me.kingdomsVisited).toContain(live.kingdom);
        // The townsperson left the roster to become you
        if (cand.folkId != null) expect(Townsfolk.isHere(Townsfolk.get(live.folk, cand.folkId))).toBe(false);

        game.player = me;
        const back = roundTrip(game);
        expect([back.player.q, back.player.r]).toEqual([town.q, town.r]);
        expect(back.player.name).toBe(me.name);
        expect(back.player.origin).toMatchObject({ town: live.name, chosen: true });
        expect(back.player.nativeLanguage).toBe(cand.native);
        expect(back.world.getTile(town.q, town.r).settlement.name).toBe(live.name);
        // ...and the days go on
        for (let d = 0; d < 5; d++) endDay(back);
    }, 300000);

    it('a newcomer arrives with a mother tongue of their own and their realm yet to learn', () => {
        const game = newGame(43);
        const { world } = game;
        const town = someTown(world);
        const comer = Afterlife.candidatesAt(world, town).find(c => c.newcomer);
        Afterlife.begin(game.player, world, 'old age');
        const res = Afterlife.becomeStranger(game.player, world, comer);
        expect(res.success).toBe(true);
        expect([res.player.q, res.player.r]).toEqual([town.q, town.r]);
        expect(res.player.nativeLanguage).toBe(comer.native);
        expect(res.player.origin.cameFrom).toBe(comer.newcomer.from);
        expect(res.player.kingdomsVisited || []).not.toContain(world.getTile(town.q, town.r).settlement.kingdom);
    }, 300000);

    it('at the Dawn of Man, a chosen clan gives children born into it', () => {
        const game = newGame(808, { startYear: 1, terrainGen: 3, kingdomCount: 3 });
        const { world } = game;
        const list = Afterlife.townChoices(world);
        const clan = list.find(t => t.type === 'clan');
        expect(clan).toBeTruthy();
        expect(list.every(t => t.type === 'clan' || world.getTile(t.q, t.r).settlement.dawnBorn)).toBe(true);
        const cands = Afterlife.candidatesAt(world, clan);
        expect(cands.length).toBeGreaterThan(0);
        for (const c of cands) {
            expect(c.dawn).toEqual({ clanId: clan.clanId });
            expect(c.last).toMatch(/^of the /);
        }
        Afterlife.begin(game.player, world, 'test');
        const res = Afterlife.becomeStranger(game.player, world, cands[0]);
        expect(res.success).toBe(true);
        expect(res.player.dawnClan).toBe(clan.clanId);
    }, 300000);
});
