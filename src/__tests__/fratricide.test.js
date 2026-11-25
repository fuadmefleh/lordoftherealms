// The law of fratricide (systems/fratricide.js): a succession law. On the
// player's succession the new ruler's brothers are condemned (no brother can
// rise for the crown) and strangled when the grace days run out, unless
// spared at a cost; under the cage they are shut up for life. Mothers at court
// scheme for their sons; AI realms strangle (or cage) their heirs' brothers,
// and no succession crisis comes of a brother.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Laws } from '../systems/laws.js';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { CrownSuccession } from '../systems/crownSuccession.js';
import { Fratricide } from '../systems/fratricide.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { loadData, newGame } from './playtest/harness.js';

let base = null;
beforeAll(async () => {
    await loadData();
    base = JSON.parse(JSON.stringify(DataLoader._gamedata.fratricide));
});
beforeEach(() => {
    DataLoader._gamedata.fratricide = JSON.parse(JSON.stringify(base));
});

let n = 0;
function kid(extra = {}) {
    const c = {
        id: `fr_kid_${n++}`, firstName: 'Wynn', dynasty: 'Harness', gender: 'male', age: 24, isAlive: true, traits: [],
        strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 2, diplomacy: 2, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    return c;
}

function biggest(world) {
    const all = world.getAllSettlements();
    const count = k => all.filter(s => s.kingdom === k.id).length;
    return world.kingdoms.filter(k => k.isAlive).sort((a, b) => count(b) - count(a))[0];
}

/** A crowned player with an heir, two younger sons and a daughter; the realm's law set. */
function crowned(law, seed = 31) {
    const game = newGame(seed);
    const { world, player } = game;
    world.day = 2400;
    const k = biggest(world);
    Throne._takeThrone(player, world, k);
    k.treasury = 5000;
    k.stability = 60;
    Kingship.processDay(world, player);
    player.gold = 20000;
    player.house.prestige = 100;
    if (!k.laws) k.laws = {};
    k.laws.succession = law;
    const heir = kid({ firstName: 'Edric', age: 30 });
    const bram = kid({ firstName: 'Bram', age: 26 });
    const col = kid({ firstName: 'Col', age: 3 });
    const ada = kid({ firstName: 'Ada', age: 22, gender: 'female' });
    player.children = [heir, bram, col, ada];
    player.heir = heir.id;
    return { game, world, player, k, heir, bram, col, ada, court: Kingship.court(player) };
}

function days(world, player, count) {
    const notices = [];
    for (let i = 0; i < count; i++) {
        world.day++;
        notices.push(...Fratricide.processDay(world, player).notices);
    }
    return notices;
}

describe('The law (data/laws.json succession, data/fratricide.json)', () => {
    it('is a realm law with three options, and its tunables merge over the defaults', () => {
        const L = Laws.law('succession');
        expect(L).toBeTruthy();
        expect(L.options.map(o => o.id)).toEqual(['mercy', 'cage', 'fratricide']);
        expect(DataLoader._gamedata.fratricide).toBeTruthy();
        expect(Fratricide.config().graceDays).toBe(3);
        expect(Fratricide.config().spare.prestige).toBe(10);
        expect(Fratricide.law({ kingdoms: [] }, null)).toBe('mercy');
    });
});

describe('Your heir takes the throne under the law of fratricide', () => {
    it('the brothers are condemned (not the sister), no brother rises, and the bowstring falls when the days run out', () => {
        const { world, player, heir, bram, col, ada } = crowned('fratricide');
        // A passed-over, ambitious, hungry brother — who would surely rise under mercy
        bram.traits = [{ id: 'ambitious' }];
        const res = Relationships.succeedAsHeir(player, heir.id, world, {});
        expect(res.success).toBe(true);
        expect(res.fratricide.condemned.sort()).toEqual(['Bram', 'Col']);
        expect(Fratricide.isCondemned(bram)).toBe(true);
        expect(Fratricide.isCondemned(ada)).toBe(false);
        // No claimant of the blood: the crown passes without a brother's war
        const brothers = (res.crown && res.crown.record && res.crown.record.claimants) || [];
        expect(brothers.some(c => c.kind === 'brother' && /Bram|Col/.test(c.name))).toBe(false);
        expect(Fratricide.state(player).pending.ids.length).toBe(2);
        const notices = days(world, player, 4);
        expect(notices.some(x => x.title === 'The Law of Fratricide')).toBe(true);
        expect(notices.some(x => x.title === 'The Bowstring')).toBe(true);
        expect(bram.isAlive).toBe(false);
        expect(col.isAlive).toBe(false);
        expect(bram.deathCause).toMatch(/bowstring/);
        expect(ada.isAlive).toBe(true);
        expect(Fratricide.state(player).pending).toBe(null);
        expect(Fratricide.state(player).stats.strangled).toBe(2);
        expect(player.house.history.some(h => /strangled with a silken bowstring/.test(h.text))).toBe(true);
    }, 60000);

    it('sparing a brother breaks the law: stability, Prestige and the lords\' opinion pay for it, and he lives', () => {
        const { world, player, heir, bram, col, k } = crowned('fratricide');
        Relationships.succeedAsHeir(player, heir.id, world, {});
        const court = Kingship.court(player);
        const opinion = court.vassals.map(v => v.opinion);
        const stab = k.stability;
        const prestige = player.house.prestige;
        const res = Fratricide.spare(player, world, bram.id);
        expect(res.success).toBe(true);
        expect(k.stability).toBe(Math.max(0, stab - 4));
        expect(player.house.prestige).toBe(prestige - 10);
        court.vassals.forEach((v, i) => expect(v.opinion).toBeLessThanOrEqual(opinion[i]));
        expect(Fratricide.spare(player, world, bram.id).success).toBe(false);
        days(world, player, 4);
        expect(bram.isAlive).toBe(true);
        expect(Fratricide.isSpared(bram)).toBe(true);
        expect(col.isAlive).toBe(false);
        expect(Fratricide.view(player, world).spared.map(s => s.name)).toEqual(['Bram']);
        // At the next succession he stands as an uncle, the stronger for it
        expect(Fratricide.barsClaim(bram)).toBe(false);
    }, 60000);

    it('the word given at once: the brother dies the same day', () => {
        const { world, player, heir, col } = crowned('fratricide');
        Relationships.succeedAsHeir(player, heir.id, world, {});
        const res = Fratricide.strangle(player, world, col.id);
        expect(res.success).toBe(true);
        expect(col.isAlive).toBe(false);
        expect(Fratricide.state(player).pending.ids.length).toBe(1);
    }, 60000);

    it('under the cage the brothers live, shut up, and raise no claim', () => {
        const { world, player, heir, bram, col } = crowned('cage');
        const res = Relationships.succeedAsHeir(player, heir.id, world, {});
        expect(res.fratricide.caged.sort()).toEqual(['Bram', 'Col']);
        expect(Fratricide.isCaged(bram)).toBe(true);
        expect(Fratricide.state(player).pending).toBe(null);
        days(world, player, 5);
        expect(bram.isAlive).toBe(true);
        expect(col.isAlive).toBe(true);
        expect(Fratricide.barsClaim(bram)).toBe(true);
    }, 60000);

    it('under mercy nothing is done to them', () => {
        const { world, player, heir, bram } = crowned('mercy');
        const res = Relationships.succeedAsHeir(player, heir.id, world, {});
        expect(res.fratricide).toBe(null);
        expect(bram.fratricide).toBeUndefined();
    }, 60000);
});

describe('The mothers at court', () => {
    it('a mother of a son not the heir schemes; revealed, a guard on the boy foils it', () => {
        const { world, player, heir, bram } = crowned('fratricide');
        DataLoader._gamedata.fratricide.mothers = { ...base.mothers, monthly: 1, revealDaily: 1, success: 1, leadMin: 5, leadMax: 5 };
        player.children = [heir, bram];
        heir.otherParentId = 'mother_a';
        bram.otherParentId = 'mother_b';
        while (world.day % 30 !== 14) world.day++;
        days(world, player, 2);
        const st = Fratricide.state(player);
        expect(st.schemes.length).toBe(1);
        const s = st.schemes[0];
        expect(s.forId).toBe(bram.id);
        expect(s.againstId).toBe(heir.id);
        expect(s.revealed).toBeTruthy();
        expect(Fratricide.guard(player, world, s.id).success).toBe(true);
        days(world, player, 6);
        expect(heir.isAlive).toBe(true);
        expect(s.ended.how).toBe('foiled');
    }, 60000);

    it('unguarded, the cup kills the heir', () => {
        const { world, player, heir, bram } = crowned('fratricide');
        DataLoader._gamedata.fratricide.mothers = { ...base.mothers, monthly: 1, revealDaily: 0, revealSpymaster: 0, success: 1, leadMin: 5, leadMax: 5 };
        player.children = [heir, bram];
        heir.otherParentId = 'mother_a';
        bram.otherParentId = 'mother_b';
        while (world.day % 30 !== 14) world.day++;
        days(world, player, 8);
        expect(heir.isAlive).toBe(false);
        expect(heir.fratricide.poisoned).toBeTruthy();
        expect(player.heir).toBe(null);
    }, 60000);

    it('under mercy no mother schemes', () => {
        const { world, player, heir, bram } = crowned('mercy');
        DataLoader._gamedata.fratricide.mothers = { ...base.mothers, monthly: 1 };
        heir.otherParentId = 'mother_a';
        bram.otherParentId = 'mother_b';
        days(world, player, 40);
        expect(Fratricide.state(player).schemes.length).toBe(0);
    }, 60000);
});

describe('AI realms', () => {
    function aiWorld(law) {
        const ruler = { id: 'r2', firstName: 'Otto', gender: 'male', isAlive: true, parentId: 'r1', traits: [] };
        const bro = { id: 'b1', firstName: 'Hugo', gender: 'male', isAlive: true, parentId: 'r1', age: 20 };
        const babe = { id: 'b2', firstName: 'Lothar', gender: 'male', isAlive: true, parentId: 'r1', age: 4 };
        const sis = { id: 's1', firstName: 'Gisela', gender: 'female', isAlive: true, parentId: 'r1', age: 18 };
        const k = {
            id: 'k9', name: 'Ostmark', isAlive: true, ruler: 'King Otto', laws: { succession: law }, stability: 50,
            characterData: { ruler, children: [ruler, bro, babe, sis], dynasty: { name: 'Ottonen' } },
            lastSuccession: { day: 500, type: 'heir', crisis: false, heirName: 'Otto Ottonen', oldRulerName: 'King Arnulf' },
        };
        const world = { day: 501, generationParams: { seed: 5 }, kingdoms: [k], events: [], getKingdom: id => (id === 'k9' ? k : null) };
        return { world, k, bro, babe, sis };
    }

    it('a fratricide realm strangles the new king\'s brothers, and no crisis comes of a brother', () => {
        const { world, k, bro, babe, sis } = aiWorld('fratricide');
        Utils.setSeed(11);
        Fratricide.processDay(world, null);
        const after = Utils.random();
        Utils.setSeed(11);
        expect(Utils.random()).toBe(after); // (no shared RNG drawn)
        expect(bro.isAlive).toBe(false);
        expect(babe.isAlive).toBe(false);
        expect(sis.isAlive).toBe(true);
        expect(world.events.some(e => /strangled/.test(e.text))).toBe(true);
        expect(Fratricide.quellsCrisis(world, k, k.lastSuccession)).toBe(true);
        // seen once only
        bro.isAlive = true;
        Fratricide.processDay(world, null);
        expect(bro.isAlive).toBe(true);
    });

    it('a caging realm shuts them up alive; a merciful one leaves them be', () => {
        const a = aiWorld('cage');
        Fratricide.processDay(a.world, null);
        expect(a.bro.isAlive).toBe(true);
        expect(a.bro.caged).toBe(500);
        const b = aiWorld('mercy');
        Fratricide.processDay(b.world, null);
        expect(b.bro.isAlive).toBe(true);
        expect(b.bro.caged).toBeUndefined();
        expect(Fratricide.quellsCrisis(b.world, b.k, b.k.lastSuccession)).toBe(false);
    });

    it('a cruel king come to the throne through a crisis may proclaim the bowstring', () => {
        DataLoader._gamedata.fratricide.ai = { ...base.ai, adoptOnCrisis: 1 };
        const { world, k } = aiWorld('mercy');
        k.characterData.ruler.traits = [{ id: 'cruel' }];
        k.lastSuccession.crisis = true;
        Fratricide.processDay(world, null);
        expect(Laws.value(world, k.id, 'succession')).toBe('fratricide');
        expect(k.laws.history.slice(-1)[0].by).toBe('crown');
    });

    it('the harems of a fratricide realm poison a younger son now and then', () => {
        DataLoader._gamedata.fratricide.ai = { ...base.ai, haremYearly: 1 };
        const { world, k } = aiWorld('fratricide');
        Fratricide.processDay(world, null);
        const ruler = k.characterData.ruler;
        const s1 = { id: 'c1', firstName: 'Konrad', gender: 'male', isAlive: true, parentId: ruler.id, age: 12 };
        const s2 = { id: 'c2', firstName: 'Bruno', gender: 'male', isAlive: true, parentId: ruler.id, age: 9 };
        k.characterData.children.push(s1, s2);
        world.day = 360 * 3 + 180;
        Fratricide.processDay(world, null);
        expect(s1.isAlive).toBe(true);
        expect(s2.isAlive).toBe(false);
        expect(Fratricide.worldState(world).log[0].kind).toBe('harem');
    });
});

describe('Saved', () => {
    it('the player\'s state rides with the player, the world\'s with the world', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('fratricide');
        const world = { day: 10, kingdoms: [] };
        Fratricide.worldState(world).seen.k1 = 9;
        const saved = Fratricide.serializeWorld(world);
        const w2 = { day: 10, kingdoms: [] };
        Fratricide.restoreWorld(saved, w2);
        expect(w2.fratricide.seen.k1).toBe(9);
        Fratricide.restoreWorld(undefined, w2);
        expect(w2.fratricide.seen).toEqual({});
    });
});
