// Delves: the major points of interest (ruins, caves, and the tombs, sunken
// halls and abandoned mines they turn out to be) are multi-chamber
// expeditions instead of a single Explore roll.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Delves } from '../systems/delves.js';
import { Ailments } from '../systems/ailments.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Traits } from '../systems/traits.js';
import { Player } from '../player/player.js';
import { addWildernessActions } from '../player/actions/wildernessActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const T = (id) => ({ id, passable: true });

function makeWorld(day = 10) {
    const tiles = new Map();
    const world = {
        day, width: 40, height: 40, kingdoms: [], units: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: () => null,
        getAllSettlements: () => [],
        _tiles: tiles,
    };
    return world;
}

function addPoi(world, q, r, type, terrain = 'grassland', extra = {}) {
    const tile = { q, r, terrain: T(terrain), improvement: { type, name: `Test ${type}`, icon: '?', explored: false, founded: 300, ...extra } };
    world._tiles.set(`${q},${r}`, tile);
    return tile;
}

function makePlayer() {
    const p = new Player();
    p.maxHealth = 1000;
    p.health = 1000;
    p.movementRemaining = 50;
    p.q = 3; p.r = 3;
    p.inventory = {};
    return p;
}

/** Take the first affordable choice in every chamber, pressing on until the delve ends. */
function runToEnd(player, world) {
    let res = null;
    for (let i = 0; i < 10; i++) {
        const choices = Delves.describeChoices(player).filter(c => c.can.ok);
        res = Delves.choose(player, world, choices[0].id);
        expect(res.success).toBe(true);
        if (res.ended) return res;
        expect(Delves.pressOn(player).success).toBe(true);
    }
    return res;
}

beforeEach(() => {
    Delves._live = new Map();
});

describe('delve content (data/delves.json)', () => {
    it('is internally consistent: valid effect keys, items, stats, skills, traits, deeds', () => {
        expect(Delves.validate()).toEqual([]);
    });

    it('has about 30 regular chambers and 2–3 deep finales per kind', () => {
        const finales = new Set();
        const regular = new Set();
        for (const k of Object.values(Delves.KINDS)) {
            expect(k.finales.length).toBeGreaterThanOrEqual(2);
            expect(k.finales.length).toBeLessThanOrEqual(3);
            k.finales.forEach(f => finales.add(f));
            k.chambers.forEach(c => regular.add(c));
        }
        expect(regular.size).toBeGreaterThanOrEqual(28);
        // every chamber is reachable from some kind, and finales are not regular chambers
        for (const id of Object.keys(Delves.CHAMBERS)) expect(regular.has(id) || finales.has(id)).toBe(true);
        for (const f of finales) expect(regular.has(f)).toBe(false);
    });

    it('the cursed idol is a real good', () => {
        expect(PlayerInventory.goodValue('cursed_idol')).toBeGreaterThan(0);
    });
});

describe('delve sites', () => {
    it('maps POIs to delve kinds by type and terrain; minor POIs are not delves', () => {
        const w = makeWorld();
        expect(Delves.kindFor(addPoi(w, 1, 1, 'ruins', 'swamp'))).toBe('sunken');
        expect(Delves.kindFor(addPoi(w, 2, 1, 'ruins', 'desert'))).toBe('tomb');
        expect(Delves.kindFor(addPoi(w, 3, 1, 'ruins', 'grassland'))).toBe('ruins');
        expect(Delves.kindFor(addPoi(w, 4, 1, 'cave', 'mountain'))).toBe('mine');
        expect(Delves.kindFor(addPoi(w, 5, 1, 'cave', 'woodland'))).toBe('cave');
        for (const minor of ['shrine', 'oasis', 'monument', 'treasure_cache']) {
            expect(Delves.kindFor(addPoi(w, 6, 1, minor))).toBe(null);
        }
        expect(Delves.isDelveSite(addPoi(w, 7, 1, 'ruins', 'grassland', { explored: true }))).toBe(false);
    });

    it('offers Delve at major POIs and keeps Explore POI for minor ones', () => {
        const w = makeWorld();
        const p = makePlayer();
        const types = (tile) => {
            const actions = [];
            addWildernessActions(actions, p, tile, w);
            return actions.map(a => a.type);
        };
        const ruins = addPoi(w, 3, 3, 'ruins');
        expect(types(ruins)).toContain('delve');
        expect(types(ruins)).not.toContain('explore_poi');
        const shrine = addPoi(w, 4, 4, 'shrine');
        expect(types(shrine)).toContain('explore_poi');
        expect(types(shrine)).not.toContain('delve');
        // an unfinished delve offers a free resume
        Utils.setSeed(3);
        Delves.start(p, w, ruins);
        expect(types(ruins)).toContain('delve_resume');
    });
});

describe('chamber flow', () => {
    it('draws 3–6 chambers ending in a deep finale, and clears the site when done', () => {
        Utils.setSeed(11);
        const w = makeWorld();
        const p = makePlayer();
        const tile = addPoi(w, 3, 3, 'ruins');
        const start = Delves.start(p, w, tile);
        expect(start.success).toBe(true);
        const a = start.delve;
        expect(a.plan.length).toBeGreaterThanOrEqual(3);
        expect(a.plan.length).toBeLessThanOrEqual(6);
        expect(Delves.KINDS.ruins.finales).toContain(a.plan[a.plan.length - 1]);
        expect(new Set(a.plan).size).toBe(a.plan.length);

        const end = runToEnd(p, w);
        expect(end.ended).toBe('cleared');
        expect(end.result.chambers).toBe(a.plan.length);
        expect(Delves.active(p)).toBe(null);
        expect(tile.improvement.explored).toBe(true);
        expect(tile.improvement.delved.reason).toBe('cleared');
        expect(p.delves.completed).toContain('3,3');
        expect(p.delves.stats.cleared).toBe(1);
        // one time per POI
        expect(Delves.start(p, w, tile).success).toBe(false);
        expect(Delves.isDelveSite(tile)).toBe(false);
    });

    it('must press on (or turn back) between chambers', () => {
        Utils.setSeed(5);
        const w = makeWorld();
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'cave'));
        const first = Delves.describeChoices(p).find(c => c.can.ok);
        expect(Delves.choose(p, w, first.id).success).toBe(true);
        expect(Delves.choose(p, w, first.id).success).toBe(false);
        expect(Delves.pressOn(p).success).toBe(true);
        expect(Delves.pressOn(p).success).toBe(false);
    });

    it('a choice costs stamina, and missing stamina is paid in health', () => {
        Utils.setSeed(2);
        const w = makeWorld();
        const p = makePlayer();
        const tile = addPoi(w, 3, 3, 'ruins');
        Delves.start(p, w, tile);
        p.delves.active.plan[0] = 'collapsed_hall';
        p.movementRemaining = 0;
        const before = p.health;
        Delves.choose(p, w, 'clear'); // 2 stamina
        expect(p.movementRemaining).toBe(0);
        expect(p.health).toBeLessThanOrEqual(before - 2 * Delves.CONFIG.staminaShortfallHealth);
    });

    it('odds respond to attributes, gear, traits, depth and the curse', () => {
        const p = makePlayer();
        const choice = Delves.CHAMBERS.stone_guardian.choices.find(c => c.id === 'fight');
        const base = Delves.chance(p, choice, 0);
        p.strength = 9;
        const strong = Delves.chance(p, choice, 0);
        expect(strong).toBeGreaterThan(base);
        p.inventory.weapons = 2;
        expect(Delves.chance(p, choice, 0)).toBeGreaterThan(strong);
        Traits.getState(p).earned.brave = true;
        expect(Delves.chance(p, choice, 0)).toBeGreaterThan(strong);
        const shallow = Delves.chance(p, choice, 0);
        expect(Delves.chance(p, choice, 4)).toBeLessThan(shallow);
        p.inventory.cursed_idol = 1;
        expect(Delves.chance(p, choice, 0)).toBeLessThan(shallow);
        // clamped
        p.strength = 100;
        expect(Delves.chance(p, choice, 0)).toBe(Delves.CONFIG.maxChance);
        // a choice with no check always succeeds
        expect(Delves.chance(p, Delves.CHAMBERS.quiet_alcove.choices.find(c => c.id === 'press'), 0)).toBe(null);
    });

    it('records deeds of the choices taken', () => {
        Utils.setSeed(8);
        const w = makeWorld();
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'ruins'));
        p.delves.active.plan[0] = 'stone_guardian';
        Delves.choose(p, w, 'fight');
        expect(p.traits.deeds.valor).toBeGreaterThanOrEqual(1);
    });
});

describe('retreat', () => {
    it('keeps the haul and ends the delve', () => {
        Utils.setSeed(21);
        const w = makeWorld();
        const p = makePlayer();
        const tile = addPoi(w, 3, 3, 'ruins');
        Delves.start(p, w, tile);
        p.delves.active.plan[0] = 'treasury_vault';
        const gold0 = p.gold;
        Delves.choose(p, w, 'pick');
        const haulGold = p.delves.active.haul.gold;
        expect(haulGold).toBeGreaterThan(0);
        const r = Delves.retreat(p, w);
        expect(r.success).toBe(true);
        expect(r.result.reason).toBe('retreat');
        expect(r.result.haul.gold).toBe(haulGold);
        expect(p.gold).toBeGreaterThanOrEqual(gold0 + haulGold);
        expect(tile.improvement.explored).toBe(true);
        expect(p.delves.stats.retreats).toBe(1);
    });

    it('turning back before the first chamber leaves the site untouched', () => {
        Utils.setSeed(4);
        const w = makeWorld();
        const p = makePlayer();
        const tile = addPoi(w, 3, 3, 'cave');
        Delves.start(p, w, tile);
        const r = Delves.retreat(p, w);
        expect(r.abandoned).toBe(true);
        expect(tile.improvement.explored).toBe(false);
        expect(Delves.isDelveSite(tile)).toBe(true);
    });

    it('an unfinished delve ends at day\'s end, keeping the haul', () => {
        Utils.setSeed(9);
        const w = makeWorld();
        const p = makePlayer();
        const tile = addPoi(w, 3, 3, 'ruins');
        Delves.start(p, w, tile);
        Delves.choose(p, w, Delves.describeChoices(p).find(c => c.can.ok).id);
        const out = Delves.processDay(w, p);
        expect(out.ended.reason).toBe('retreat');
        expect(Delves.active(p)).toBe(null);
        expect(tile.improvement.explored).toBe(true);
    });

    it('pushing deeper pays more: rewards scale with depth', () => {
        const p = makePlayer();
        const w = makeWorld();
        Utils.setSeed(1);
        Delves.start(p, w, addPoi(w, 3, 3, 'ruins'));
        Utils.setSeed(50);
        const shallow = Delves._applyOutcome(p, w, { gold: [100, 100] }, 0);
        Utils.setSeed(50);
        const deep = Delves._applyOutcome(p, w, { gold: [100, 100] }, 4);
        expect(shallow.lines[0]).toBe('+100 gold');
        expect(deep.lines[0]).toBe(`+${100 * (1 + 4 * Delves.CONFIG.depthReward)} gold`);
    });
});

describe('inventory cap', () => {
    it('loot that does not fit is left behind, never overfilling the packs', () => {
        Utils.setSeed(3);
        const w = makeWorld();
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'ruins'));
        const cap = PlayerInventory.getCapacity(p);
        const goods = ['grain', 'flour', 'bread', 'fish', 'wood', 'firewood', 'wool', 'textiles', 'clothes', 'stone',
            'iron', 'tools', 'weapons', 'gold_ore', 'iron_ingot', 'gold_bar', 'ivory', 'spices', 'horses', 'beer',
            'liquor', 'luxuries', 'herbs', 'pelts', 'berries', 'mushrooms', 'meat', 'hide', 'antler', 'feather'];
        for (const g of goods.slice(0, cap)) p.inventory[g] = 1;
        expect(PlayerInventory.getFreeSlots(p)).toBe(0);
        const out = Delves._applyOutcome(p, w, { items: { gems: [2, 2], iron: [3, 3] } }, 0);
        expect(p.inventory.gems).toBeUndefined();
        expect(p.delves.active.haul.leftBehind.gems).toBe(2);
        expect(p.inventory.iron).toBe(4); // an existing stack still grows
        expect(PlayerInventory.getUsedSlots(p)).toBe(cap);
        expect(out.lines.some(l => l.includes('left behind'))).toBe(true);
    });
});

describe('consequences', () => {
    it('injuries are ailments: they lower an attribute until they mend', () => {
        Utils.setSeed(12);
        const w = makeWorld(10);
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'ruins'));
        const stats0 = { strength: p.strength, intelligence: p.intelligence, charisma: p.charisma, faith: p.faith };
        const out = Delves._applyOutcome(p, w, { injury: 1 }, 0);
        expect(p.delves.injuries).toEqual([]);
        const inj = Ailments.list(p)[0];
        expect(inj).toBeDefined();
        expect(inj.kind).toBe('wound');
        expect(inj.source).toBe('delve');
        expect(out.lines.some(l => l.startsWith('Injured:'))).toBe(true);
        const [stat, amount] = Object.entries(inj.applied.attrs)[0];
        expect(p[stat]).toBe(stats0[stat] - amount);
        Delves.retreat(p, w);
        // Mend it day by day: an inn bed, and treated so it cannot fester
        p._lastRestType = 'inn';
        inj.treated = 1;
        let healed = [];
        for (let d = 0; d < 40 && Ailments.list(p).length; d++) {
            w.day++;
            healed = healed.concat(Ailments.processDay(w, p).healed);
        }
        expect(healed).toContain(inj.name);
        expect(p[stat]).toBe(stats0[stat]);
    });

    it('legacy delve injuries are folded into ailments on load', () => {
        const p = makePlayer();
        p.strength = 4;
        p.delves = { completed: [], injuries: [{ id: 'broken_arm', name: 'Broken Arm', stat: 'strength', amount: 1, untilDay: 20 }] };
        Delves.loadState(p);
        Ailments.loadState(p, makeWorld(10));
        expect(p.delves.injuries).toEqual([]);
        const rec = Ailments.list(p)[0];
        expect(rec.id).toBe('broken_arm');
        expect(rec.daysLeft).toBe(10);
        Ailments.cureAll(p);
        expect(p.strength).toBe(5);
    });

    it('a cursed idol clings even to full packs and saps health and karma daily', () => {
        Utils.setSeed(13);
        const w = makeWorld();
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'ruins'));
        p.maxInventory = 0;
        Delves._applyOutcome(p, w, { curse: 1 }, 0);
        expect(p.inventory.cursed_idol).toBe(1);
        Delves.retreat(p, w);
        const hp = p.health, karma = p.karma;
        const out = Delves.processDay(w, p);
        expect(out.curse).not.toBe(null);
        expect(p.health).toBe(hp - Delves.CONFIG.curseHealthPerDay);
        expect(p.karma).toBe(karma - Delves.CONFIG.curseKarmaPerDay);
    });

    it('an awakened guardian roams as a world unit, returns after a load, and can be slain', () => {
        Utils.setSeed(14);
        const w = makeWorld();
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'ruins'));
        Delves._applyOutcome(p, w, { guardian: 'stone_sentinel' }, 0);
        const unit = w.units.find(u => u.delveGuardianId);
        expect(unit).toBeDefined();
        expect(unit.type).toBe('monster');
        expect(unit.name).toBe(Delves.GUARDIANS.stone_sentinel.name);
        Delves.retreat(p, w);

        // Units are not saved: after a load the guardian is raised again
        Delves.loadState(p);
        w.units = [];
        Delves.processDay(w, p);
        const again = w.units.find(u => u.delveGuardianId);
        expect(again).toBeDefined();

        again.destroyed = true; // slain in battle
        const out = Delves.processDay(w, p);
        expect(out.slain).toContain(Delves.GUARDIANS.stone_sentinel.name);
        expect(p.delves.guardians[0].slain).toBe(true);
    });

    it('a guardian goes back to the depths when its time passes', () => {
        Utils.setSeed(15);
        const w = makeWorld(10);
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'cave'));
        Delves._applyOutcome(p, w, { guardian: 'cave_horror' }, 0);
        Delves.retreat(p, w);
        w.day = 10 + Delves.CONFIG.guardianDays;
        const out = Delves.processDay(w, p);
        expect(out.faded).toHaveLength(1);
        expect(w.units.find(u => u.delveGuardianId).destroyed).toBe(true);
    });

    it('deep finales can yield legendary artifact fragments', () => {
        Utils.setSeed(16);
        const w = makeWorld();
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'ruins'));
        Delves._applyOutcome(p, w, { fragment: 1 }, 5);
        const total = Object.values(p.artifacts.fragments).reduce((s, n) => s + n, 0);
        expect(total).toBe(1);
        expect(p.delves.active.haul.fragments).toHaveLength(1);
    });
});

describe('determinism', () => {
    it('the same seed gives the same plan, rolls and haul', () => {
        const run = () => {
            Utils.setSeed(777);
            Delves._live = new Map();
            const w = makeWorld();
            const p = makePlayer();
            Delves.start(p, w, addPoi(w, 3, 3, 'ruins', 'desert'));
            const plan = p.delves.active.plan.slice();
            const end = runToEnd(p, w);
            return JSON.stringify({ plan, haul: end.result.haul, gold: p.gold, health: p.health, inv: p.inventory, log: p.delves.stats });
        };
        expect(run()).toBe(run());
    });
});

describe('save & load', () => {
    it('round-trips an in-progress delve and delved sites', () => {
        Utils.setSeed(31);
        const w = makeWorld();
        const p = makePlayer();
        Delves.start(p, w, addPoi(w, 3, 3, 'ruins'));
        Delves.choose(p, w, Delves.describeChoices(p).find(c => c.can.ok).id);
        p.delves.completed.push('9,9');
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.delves.active.plan).toEqual(p.delves.active.plan);
        expect(back.delves.active.index).toBe(1);
        expect(back.delves.active.phase).toBe('between');
        expect(back.delves.completed).toContain('9,9');
        expect(Delves.pressOn(back).success).toBe(true);
    });

    it('older saves without delves are backfilled', () => {
        const data = SaveLoad.serializePlayer(new Player());
        delete data.delves;
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(back.delves.active).toBe(null);
        expect(back.delves.completed).toEqual([]);
        expect(back.delves.stats.delves).toBe(0);

        const partial = new Player();
        partial.delves = { completed: ['1,1'] };
        Delves.loadState(partial);
        expect(partial.delves.injuries).toEqual([]);
        expect(partial.delves.guardians).toEqual([]);
        expect(partial.delves.completed).toEqual(['1,1']);
    });
});
