// Heirs, upbringing and legacy: an education focus and a tutor shape a
// child's stats; focus, tutor, childhood dilemmas and the parent's example
// grow their character; at 16 the childhood traits become real earned traits,
// which an heir carries into rule. Grown children can be matched or fostered.
// Each ruler's reign is filed in the House Chronicle; a line that ends gets an
// epitaph and a legacy score. Everything saves, and old saves backfill.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Player } from '../player/player.js';
import { House } from '../systems/house.js';
import { Traits } from '../systems/traits.js';
import { Relationships } from '../systems/relationships.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Upbringing } from '../systems/upbringing.js';
import { Heirs } from '../systems/heirs.js';
import { Legacy } from '../systems/legacy.js';
import { Throne } from '../systems/throne.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';

let baseConfig;
beforeAll(async () => {
    await loadData();
    baseConfig = { ...DataLoader.upbringing.config };
});
afterEach(() => {
    DataLoader.upbringing.config = { ...baseConfig };
});

const setConfig = (over) => {
    DataLoader.upbringing.config = { ...baseConfig, ...over };
};

let nextId = 1;
function makeChild(extra = {}) {
    return {
        id: `kid_${nextId++}`, firstName: 'Ada', dynasty: 'Vel', gender: 'female', age: 6, isAlive: true,
        birthDay: 0, traits: [], strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 },
        health: 100, maxHealth: 100, ...extra,
    };
}

function makeWorld(extra = {}) {
    const kingdoms = extra.kingdoms || [];
    return { day: 1, kingdoms, getKingdom: (id) => kingdoms.find(k => k.id === id) || null, ...extra };
}

function makePlayer(world, children = []) {
    const p = new Player();
    p.firstName = 'Old';
    p.lastName = 'Vel';
    p.name = 'Old Vel';
    p.gold = 5000;
    p.age = 50;
    House.initialize(p, world);
    p.children = children;
    for (const c of children) Upbringing.ensure(c);
    return p;
}

/** Run the upbringing tick over `days` days (ageing yearly as processAging does). */
function live(player, world, days) {
    const outs = [];
    for (let i = 0; i < days; i++) {
        world.day++;
        if (world.day % 120 === 0) for (const c of player.children) if (c.isAlive) c.age++;
        outs.push(Upbringing.processDay(player, world));
    }
    return outs;
}

describe('content', () => {
    it('loads focuses, tutors and events whose ids, defaults and seeds resolve', () => {
        const focuses = Upbringing.focuses();
        expect(Object.keys(focuses).sort()).toEqual(['diplomacy', 'intrigue', 'learning', 'martial', 'piety', 'stewardship']);
        for (const f of Object.values(focuses)) {
            for (const id of Object.keys(f.seeds || {})) expect(Traits.TRAITS[id], id).toBeTruthy();
        }
        for (const t of Upbringing.tutors()) if (t.focus) expect(focuses[t.focus], t.id).toBeTruthy();
        expect(Upbringing.events().length).toBeGreaterThanOrEqual(12);
        for (const ev of Upbringing.events()) {
            const def = ev.choices.find(c => c.id === ev.default);
            expect(def, `${ev.id} default`).toBeTruthy();
            expect(def.cost || 0, `${ev.id} default must be free`).toBe(0);
            for (const c of ev.choices) {
                const blocks = [c.effects, c.risk && c.risk.effects, c.contest && c.contest.win.effects, c.contest && c.contest.lose.effects];
                for (const b of blocks.filter(Boolean)) {
                    for (const id of Object.keys({ ...(b.seeds || {}), ...(b.siblingSeeds || {}) })) expect(Traits.TRAITS[id], `${ev.id}.${c.id} seed ${id}`).toBeTruthy();
                }
            }
        }
    });
});

describe('determinism', () => {
    it('draws no RNG without children, or with only infants', () => {
        const world = makeWorld();
        const p = makePlayer(world, []);
        Utils.setSeed(7);
        live(p, world, 300);
        const a = Utils.random();
        Utils.setSeed(7);
        const b = Utils.random();
        expect(a).toBe(b);

        const p2 = makePlayer(world, [makeChild({ age: 2 })]);
        Utils.setSeed(7);
        const w2 = makeWorld();
        for (let i = 0; i < 100; i++) { w2.day++; Upbringing.processDay(p2, w2); }
        expect(Utils.random()).toBe(b);
    });

    it('loadState backfills a default upbringing; grown children count as of age', () => {
        const p = { children: [makeChild({ age: 9 }), makeChild({ age: 20 })] };
        for (const c of p.children) delete c.upbringing;
        Upbringing.loadState(p);
        expect(p.children[0].upbringing.focus).toBe(null);
        expect(p.children[0].upbringing.comeOfAge).toBe(false);
        expect(p.children[1].upbringing.comeOfAge).toBe(true);
        expect(p.children[1].upbringing.adultTraits).toEqual([]);
    });
});

describe('education', () => {
    it('a focus grows its stats, and a matching tutor grows them faster', () => {
        setConfig({ eventChance: 0, parentRubOffChancePerYear: 0 });
        const world = makeWorld();
        const plain = makeChild();
        const taught = makeChild();
        const none = makeChild();
        const p = makePlayer(world, [plain, taught, none]);
        Upbringing.setFocus(p, plain.id, 'martial', world);
        Upbringing.setFocus(p, taught.id, 'martial', world);
        expect(Upbringing.hireCourtTutor(p, world, taught.id, 'master_at_arms').success).toBe(true);
        live(p, world, 120 * 10);
        expect(plain.upbringing.comeOfAge).toBe(true);
        expect(plain.strength).toBeGreaterThan(5 + 2);
        expect(plain.skills.combat).toBeGreaterThanOrEqual(4);
        expect(taught.skills.combat).toBeGreaterThan(plain.skills.combat);
        expect(none.skills.combat).toBeLessThan(plain.skills.combat);
        expect(none.strength).toBe(5);
        // The focus bred bravery; the tutor came off the payroll at 16
        expect(plain.upbringing.adultTraits).toContain('brave');
        expect(taught.upbringing.tutor).toBe(null);
    });

    it('unpaid court tutors leave; companions teach only while they travel with you', () => {
        setConfig({ eventChance: 0, parentRubOffChancePerYear: 0 });
        const world = makeWorld({ day: 0 });
        const a = makeChild();
        const b = makeChild();
        const p = makePlayer(world, [a, b]);
        Upbringing.hireCourtTutor(p, world, a.id, 'court_scholar');
        p.gold = 0;
        const npc = { id: 'npc_1', firstName: 'Bran', occupation: 'knight', companion: { values: ['honour'] } };
        expect(Upbringing.hireCompanionTutor(p, world, b.id, npc).success).toBe(false);
        p.travelParty = ['npc_1'];
        const res = Upbringing.hireCompanionTutor(p, world, b.id, npc, 1);
        expect(res.tutor.focus).toBe('martial');
        expect(res.tutor.seeds.honest).toBeGreaterThan(0);
        p.travelParty = [];
        const outs = live(p, world, 30);
        const left = outs.flatMap(o => o.tutorsLeft);
        expect(left.length).toBe(2);
        expect(a.upbringing.tutor).toBe(null);
        expect(b.upbringing.tutor).toBe(null);
    });

    it("the parent's earned traits rub off", () => {
        setConfig({ eventChance: 0, parentRubOffChancePerYear: 100 });
        const world = makeWorld({ day: 0 });
        const kid = makeChild();
        const p = makePlayer(world, [kid]);
        Traits.recordDeed(p, 'piety', 30);
        expect(Traits.has(p, 'pious')).toBe(true);
        const outs = live(p, world, 120);
        expect(outs.flatMap(o => o.rubOff).some(r => r.traitId === 'pious')).toBe(true);
        expect(Upbringing.childhoodTraits(kid)).toContain('pious');
    });

    it('childhood traits: strongest first, opposites resolved, capped', () => {
        const kid = makeChild();
        Upbringing.ensure(kid);
        kid.upbringing.seeds = { brave: 5, craven: 4, cunning: 3.5, honest: 3, pious: 2, scholar: 9 };
        expect(Upbringing.childhoodTraits(kid)).toEqual(['scholar', 'brave', 'cunning']);
        expect(Upbringing.leanings(kid).map(l => l.id)).toEqual(['honest', 'pious']);
    });
});

describe('childhood events', () => {
    it('an event waits for a decision; choices cost gold and shape the child', () => {
        setConfig({ eventChance: 1, parentRubOffChancePerYear: 0 });
        Utils.setSeed(3);
        const world = makeWorld({ day: 0 });
        const kid = makeChild({ age: 8 });
        const p = makePlayer(world, [kid]);
        const outs = live(p, world, 40);
        const evs = outs.flatMap(o => o.events);
        expect(evs.length).toBe(1);
        const pending = Upbringing.pendingEvent(p, kid);
        expect(pending.text).not.toMatch(/\{/);
        // Force a known event to test choices
        kid.upbringing.pending = { eventId: 'bully', day: world.day, expires: world.day + 20 };
        p.gold = 5;
        expect(Upbringing.resolveEvent(p, world, kid.id, 'punish').success).toBe(false);
        const r = Upbringing.resolveEvent(p, world, kid.id, 'fight');
        expect(r.success).toBe(true);
        expect(kid.skills.combat).toBe(1);
        expect(kid.upbringing.seeds.brave).toBe(2);
        expect(kid.upbringing.events.at(-1).id).toBe('bully');
        expect(kid.upbringing.pending).toBe(null);
    });

    it('an unanswered event resolves itself with the default choice', () => {
        setConfig({ eventChance: 0, parentRubOffChancePerYear: 0 });
        const world = makeWorld({ day: 0 });
        const kid = makeChild({ age: 8 });
        const p = makePlayer(world, [kid]);
        kid.upbringing.pending = { eventId: 'lie_caught', day: 0, expires: 5 };
        const outs = live(p, world, 5);
        const res = outs.flatMap(o => o.resolved);
        expect(res.length).toBe(1);
        expect(res[0].choice.id).toBe('talk');
        expect(kid.upbringing.seeds.honest).toBe(2);
    });

    it('contests are seeded and reproducible', () => {
        const run = () => {
            Utils.setSeed(99);
            const world = makeWorld({ day: 10 });
            const kid = makeChild({ age: 13, strength: 9 });
            const p = makePlayer(world, [kid]);
            kid.upbringing.pending = { eventId: 'duel', day: 10, expires: 30 };
            return Upbringing.resolveEvent(p, world, kid.id, 'accept').text;
        };
        expect(run()).toBe(run());
    });
});

describe('coming of age and succession', () => {
    it('at 16 childhood traits become adult traits, and the heir carries them into rule', () => {
        const world = makeWorld({ day: 200 });
        const kid = makeChild({ age: 16, strength: 9 });
        const p = makePlayer(world, [kid]);
        kid.upbringing.seeds = { brave: 6, cunning: 4 };
        const outs = live(p, world, 1);
        expect(outs[0].comeOfAge.length).toBe(1);
        expect(kid.upbringing.adultTraits).toEqual(['brave', 'cunning']);
        expect(p.house.history.some(h => h.tags.includes('upbringing'))).toBe(true);

        Traits.recordDeed(p, 'piety', 30);
        const res = Relationships.succeedAsHeir(p, kid.id, world, { cause: 'old age' });
        expect(res.success).toBe(true);
        expect(res.heirTraits).toEqual(['brave', 'cunning']);
        expect(Traits.has(p, 'brave')).toBe(true);
        expect(Traits.has(p, 'pious')).toBe(false);
        expect(p.strength).toBe(9);
        // The late ruler's reign is filed; a new one is open
        expect(res.reign.name).toBe('Old Vel');
        expect(res.reign.traits).toContain('pious');
        expect(res.reign.cause).toBe('old age');
        expect(p.house.reigns.length).toBe(1);
        expect(p.house.currentReign.name).toBe(p.name);
        const d = Legacy.describe(p, world);
        expect(d.reigns.map(r => r.live)).toEqual([false, true]);
    });

    it('a regency heir is brought of age with the traits they had', () => {
        const world = makeWorld({ day: 50 });
        const kid = makeChild({ age: 10 });
        const p = makePlayer(world, [kid]);
        kid.upbringing.seeds = { scholar: 4 };
        const res = Relationships.succeedAsHeir(p, kid.id, world, { regency: true });
        expect(res.success).toBe(true);
        expect(Traits.has(p, 'scholar')).toBe(true);
    });
});

describe('placing grown children', () => {
    const kingdom = () => ({
        id: 'k1', name: 'Aster', isAlive: true, culture: 'Imperial',
        characterData: {
            ruler: { firstName: 'Odo', traits: [{ id: 'devout' }] },
            children: [{ id: 'roy_1', firstName: 'Lia', dynasty: 'Aster', age: 18, isAlive: true, spouseId: null }],
        },
    });

    it('alliance and royal matches cost a dowry and bring standing (and a claim)', () => {
        const k = kingdom();
        const world = makeWorld({ day: 300, kingdoms: [k] });
        const a = makeChild({ age: 17 });
        const b = makeChild({ age: 18, gender: 'male', firstName: 'Bo' });
        const young = makeChild({ age: 12 });
        const p = makePlayer(world, [a, b, young]);
        a.upbringing.comeOfAge = true;
        b.upbringing.comeOfAge = true;
        p.reputation = { k1: 30 };
        p.house.prestige = 50;

        expect(Heirs.marryForAlliance(p, world, young.id, 'k1').success).toBe(false);
        const gold = p.gold;
        const al = Heirs.marryForAlliance(p, world, a.id, 'k1');
        expect(al.success).toBe(true);
        expect(p.gold).toBe(gold - Heirs.config().allianceDowry);
        expect(p.reputation.k1).toBe(30 + Heirs.config().allianceReputation);
        expect(Heirs.marryForAlliance(p, world, a.id, 'k1').success).toBe(false);

        const roy = Heirs.arrangeRoyalMatch(p, world, b.id, 'k1');
        expect(roy.success).toBe(true);
        expect(k.characterData.children[0].spouseId).toBe(b.id);
        expect(Throne.claimStrength(p, 'k1')).toBeGreaterThan(0);
        expect(Heirs.arrangeRoyalMatch(p, world, a.id, 'k1').success).toBe(false);
    });

    it('a wed heir brings their spouse to the throne, and the match counts as a noble marriage', () => {
        const k = kingdom();
        const world = makeWorld({ day: 300, kingdoms: [k], getTile: () => null });
        const a = makeChild({ age: 18 });
        const p = makePlayer(world, [a]);
        a.upbringing.comeOfAge = true;
        p.reputation = { k1: 30 };
        p.house.prestige = 50;
        const before = (p.house.stats && p.house.stats.nobleMarriage) || 0;
        expect(Heirs.marryForAlliance(p, world, a.id, 'k1').success).toBe(true);
        expect(p.house.stats.nobleMarriage).toBe(before + 1);

        const res = Relationships.succeedAsHeir(p, a.id, world, { cause: 'old age' });
        expect(res.success).toBe(true);
        expect(p.spouse).toBeTruthy();
        const npc = Relationships.getNPC(p.spouse);
        expect(npc.isMarried).toBe(true);
        expect(npc.gender).toBe('male');
        expect(npc.kingdomId).toBe('k1');
        expect(p.marriageAllianceKingdom).toBe('k1');
    });

    it('an unwed heir inherits no spouse and no kinship', () => {
        const world = makeWorld({ day: 300, getTile: () => null });
        const a = makeChild({ age: 18 });
        const p = makePlayer(world, [a]);
        p.spouse = 'old_spouse';
        p.marriageAllianceKingdom = 'k9';
        Relationships.succeedAsHeir(p, a.id, world, { cause: 'old age' });
        expect(p.spouse).toBeNull();
        expect(p.marriageAllianceKingdom).toBeNull();
    });

    it("a ward is away for a season and returns with skills and the host's trait", () => {
        const k = kingdom();
        const world = makeWorld({ day: 300, kingdoms: [k] });
        const a = makeChild({ age: 16 });
        const p = makePlayer(world, [a]);
        a.upbringing.comeOfAge = true;
        p.house.roles.marshal = a.id;
        const res = Heirs.sendAsWard(p, world, a.id, 'k1');
        expect(res.success).toBe(true);
        expect(res.placement.trait).toBe('pious');
        expect(p.house.roles.marshal).toBe(null);
        expect(Upbringing.isAway(a)).toBe(true);
        expect(Heirs.marryForAlliance(p, world, a.id, 'k1').success).toBe(false);
        const outs = live(p, world, Heirs.config().wardDays);
        expect(outs.flatMap(o => o.wardsReturned).length).toBe(1);
        expect(Upbringing.isAway(a)).toBe(false);
        expect(a.upbringing.adultTraits).toContain('pious');
        expect(a.skills.leadership).toBe(1);
        expect(Heirs.sendAsWard(p, world, a.id, 'k1').success).toBe(false);
    });
});

describe('legacy', () => {
    it('the line ends with an epitaph and a legacy score', () => {
        const world = makeWorld({ day: 600 });
        const p = makePlayer(world, []);
        p.house.stats = { battleWon: 10, quest: 5 };
        p.house.prestige = 80;
        Traits.recordDeed(p, 'valor', 30);
        const e = Legacy.endDynasty(p, world, 'old age');
        expect(e.reigns.length).toBe(1);
        expect(e.reigns[0].battles).toBe(10);
        expect(e.reigns[0].epithet).toBe('the Brave');
        expect(e.score).toBeGreaterThan(80);
        expect(e.rank.label).toBeTruthy();
        expect(p.house.ended.lastRuler).toBe('Old Vel');
        // Idempotent
        expect(Legacy.endDynasty(p, world).reigns.length).toBe(1);
    });

    it('deeds are measured per reign against the snapshot taken when it opened', () => {
        const world = makeWorld({ day: 10 });
        const kid = makeChild({ age: 20 });
        const p = makePlayer(world, [kid]);
        p.house.stats = { battleWon: 4 };
        Upbringing.loadState(p);
        Relationships.succeedAsHeir(p, kid.id, world, {});
        p.house.stats.battleWon = 7;
        world.day = 250;
        const d = Legacy.describe(p, world);
        expect(d.reigns[0].battles).toBe(4);
        expect(d.reigns[1].battles).toBe(3);
        expect(d.reigns[1].years).toBeCloseTo(2, 0);
    });
});

describe('save and load', () => {
    it('round-trips upbringing and reigns; old saves backfill', () => {
        const world = makeWorld({ day: 40 });
        const kid = makeChild({ age: 9 });
        const p = makePlayer(world, [kid]);
        Upbringing.setFocus(p, kid.id, 'piety', world);
        Upbringing.hireCourtTutor(p, world, kid.id, 'chaplain');
        kid.upbringing.seeds = { pious: 2 };
        Legacy.ensure(p, world);
        p.house.reigns.push({ name: 'Elder', generation: 0, score: 12 });
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        const c = back.children[0];
        expect(c.upbringing.focus).toBe('piety');
        expect(c.upbringing.tutor.id).toBe('chaplain');
        expect(c.upbringing.seeds.pious).toBe(2);
        expect(back.house.reigns[0].name).toBe('Elder');
        expect(back.house.currentReign).toBeTruthy();

        delete json.children[0].upbringing;
        delete json.house.reigns;
        delete json.house.currentReign;
        const legacy = new Player();
        SaveLoad.restorePlayer(json, legacy);
        expect(legacy.children[0].upbringing.focus).toBe(null);
        expect(legacy.house.reigns).toEqual([]);
        expect(legacy.house.currentReign.snapshot.prestige).toBe(0);
    });
});

describe('in the daily turn', () => {
    it('children grow up through the harness turn and survive a save round trip', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            let game = newGame(4242);
            const p = game.player;
            p.gold = 3000;
            p.children = [makeChild({ age: 8, birthDay: 0 }), makeChild({ age: 15, firstName: 'Cal', gender: 'male' })];
            Upbringing.loadState(p);
            Upbringing.setFocus(p, p.children[0].id, 'learning', game.world);
            const stats = {};
            const day = () => {
                botDay(game, stats);
                expect(endDay(game).died).toBe(null);
            };
            for (let d = 0; d < 70; d++) day();
            game = roundTrip(game);
            for (let d = 0; d < 70; d++) day();
            expect(stats.focusesSet).toBeGreaterThanOrEqual(1);
            const kids = game.player.children;
            expect(kids[0].upbringing.focus).toBe('learning');
            expect(kids[0].upbringing.xp['stat:intelligence'] + kids[0].intelligence).toBeGreaterThan(5);
            expect(kids[0].upbringing.seeds.scholar).toBeGreaterThan(0);
            expect(kids[1].age).toBeGreaterThanOrEqual(16);
            expect(kids[1].upbringing.comeOfAge).toBe(true);
            expect(Number.isFinite(game.player.gold)).toBe(true);
        } finally {
            logSpy.mockRestore();
            warnSpy.mockRestore();
        }
    }, 60000);
});

describe('panels', () => {
    it('render the child panel, the chronicle, the death screen and the epitaph', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const world = makeWorld({ day: 300, kingdoms: [{ id: 'k1', name: 'Aster', isAlive: true, characterData: { children: [] } }] });
        const kid = makeChild({ age: 9 });
        const grown = makeChild({ age: 18, firstName: 'Bo' });
        const p = makePlayer(world, [kid, grown]);
        grown.upbringing.comeOfAge = true;
        grown.upbringing.adultTraits = ['brave'];
        kid.upbringing.pending = { eventId: 'bully', day: 300, expires: 320 };
        const panels = [];
        const game = {
            player: p, world,
            ui: {
                showCustomPanel: (title, html) => panels.push({ title, html }),
                showNotification: () => {}, updateStats: () => {}, hideCustomPanel: () => {},
            },
        };
        ActionMenu.showChildPanel(game, kid.id);
        expect(panels.at(-1).html).toContain('The Bully');
        expect(panels.at(-1).html).toContain('Master-at-Arms');
        ActionMenu.showChildPanel(game, grown.id);
        expect(panels.at(-1).html).toContain('Alliance match');
        ActionMenu.showDeathScreen(game, 'old age');
        expect(panels.at(-1).html).toContain('Play as Bo');
        expect(panels.at(-1).html).toContain('Brave');
        ActionMenu.showHouseChronicle(game);
        expect(panels.at(-1).html).toContain('Old Vel');
        ActionMenu.showEpitaph(game, 'old age');
        expect(panels.at(-1).title).toContain('The Line Ends');
        expect(p.house.ended).toBeTruthy();
    });
});
