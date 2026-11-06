/**
 * Combat pack (systems/combatSkills.js, data/skillPacks/combat.json): Blades,
 * Brawling, Archery and Sailing as practised skills — the old flat combat
 * number migrated and kept in step, the duel engine fighting by level,
 * moves at higher levels, NPC levels by role, and Sailing on a voyage.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { CombatSkills } from '../systems/combatSkills.js';
import { Duels } from '../systems/duels.js';
import { Ships } from '../systems/ships.js';
import { FieldBattle } from '../player/fieldBattle.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});
beforeEach(() => Utils.setSeed(777));

const fighter = (combat = 1, extra = {}) => ({
    name: 'You', strength: 5, luck: 5, health: 100, maxHealth: 100, inventory: {}, skills: { combat }, ...extra,
});

describe('the pack and the old combat number', () => {
    it('defines the four skills', () => {
        for (const id of ['blades', 'brawling', 'archery', 'sailing']) expect(PracticeSkills.def(id)).toBeTruthy();
    });

    it('an old flat combat skill becomes levels once, and later rises feed in as XP', () => {
        const p = fighter(5);
        expect(CombatSkills.level(p, 'blades')).toBe(5);
        expect(CombatSkills.level(p, 'brawling')).toBe(4);
        expect(CombatSkills.level(p, 'archery')).toBe(3);
        const before = PracticeSkills.xp(p, 'blades');
        p.skills.combat = 6; // a training bout, a bounty, a battle
        expect(CombatSkills.level(p, 'blades')).toBe(6);
        expect(PracticeSkills.xp(p, 'blades')).toBeGreaterThan(before);
        // Not counted twice
        const after = PracticeSkills.xp(p, 'blades');
        CombatSkills.sync(p);
        expect(PracticeSkills.xp(p, 'blades')).toBe(after);
    });

    it('a level earned by fighting keeps the old number up for everything that still reads it', () => {
        const p = fighter(1);
        CombatSkills.level(p, 'blades');
        let ev = null;
        for (let i = 0; i < 200 && !ev; i++) ev = CombatSkills.trainBy(p, 'brawling', 'hit');
        expect(ev).toMatchObject({ skill: 'brawling', from: 1, to: 2 });
        expect(ev.text).toMatch(/Brawling rose to level 2/);
        expect(p.skills.combat).toBeGreaterThanOrEqual(2);
        // ...and that lift is not fed back as more XP
        const xp = PracticeSkills.xp(p, 'blades');
        CombatSkills.sync(p);
        expect(PracticeSkills.xp(p, 'blades')).toBe(xp);
    });

    it('the weapon in hand picks the skill', () => {
        expect(CombatSkills.weaponSkill('fists')).toBe('brawling');
        expect(CombatSkills.weaponSkill('steel_sword')).toBe('blades');
        expect(CombatSkills.weaponSkill('spear')).toBe('blades');
    });
});

describe('duels fight by level', () => {
    it('the duel skill is the level of what you fight with', () => {
        const p = fighter(1);
        PracticeSkills.setLevel(p, 'blades', 7);
        PracticeSkills.setLevel(p, 'brawling', 2);
        CombatSkills.sync(p);
        const bare = Duels.fromPlayer(p, { fresh: true });
        expect(bare.fightSkill).toBe('brawling');
        expect(bare.skill).toBe(2);
        p.inventory.steel_sword = 1;
        const armed = Duels.fromPlayer(p, { fresh: true });
        expect(armed.fightSkill).toBe('blades');
        expect(armed.skill).toBe(7);
        expect(armed.moves.power).toBeGreaterThan(0);
    });

    it('a master swordsman beats a novice far more often than not', () => {
        const wins = (lv) => {
            let w = 0;
            for (let i = 0; i < 40; i++) {
                const p = fighter(1, { inventory: { steel_sword: 1 } });
                PracticeSkills.setLevel(p, 'blades', lv);
                CombatSkills.sync(p);
                const knight = Duels.fromProfile({ name: 'Ser Test', attack: 5, defense: 4, power: 7, hp: 30, stamina: 12 });
                if (Duels.autoResolve(Duels.fromPlayer(p, { fresh: true }), knight, { mode: 'firstBlood' }).playerWon) w++;
            }
            return w;
        };
        expect(wins(9)).toBeGreaterThan(wins(1) + 8);
    });

    it('a brawler\'s haymaker fells one already reeling', () => {
        const p = fighter(1);
        PracticeSkills.setLevel(p, 'brawling', 8);
        CombatSkills.sync(p);
        const a = Duels.fromPlayer(p, { fresh: true });
        const b = Duels.fromProfile({ name: 'Drunk', attack: 0, defense: 0, power: 4, hp: 40 });
        b.hp = 10; // 25% left: under the haymaker's line
        const state = Duels.create(a, b, { mode: 'toDeath' });
        const entry = { notes: [], dmgToA: 0, dmgToB: 0 };
        let i = 0;
        while (b.hp > 0 && i++ < 20) Duels._blow(state, 'a', 'thrust', 0.1, 1, () => 0.01, entry);
        expect(b.hp).toBe(0);
        expect(entry.notes.join(' ')).toMatch(/haymaker/i);
    });
});

describe('NPCs by role', () => {
    it('guards are better with a blade than villagers; bruisers brawl', () => {
        const avg = (role, id) => {
            let t = 0;
            for (let i = 0; i < 30; i++) t += CombatSkills.npcLevel({ id: `${role}${i}`, name: `${role}${i}`, type: role === 'bruiser' ? 'villager' : role, _skillRole: role === 'bruiser' ? 'bruiser' : undefined, age: 30 }, id);
            return t / 30;
        };
        expect(avg('guard', 'blades')).toBeGreaterThan(avg('villager', 'blades') + 2);
        expect(avg('bruiser', 'brawling')).toBeGreaterThan(avg('villager', 'brawling') + 3);
    });

    it('a sharper-than-usual guard gets a better duel profile', () => {
        const npc = { id: 'g1', name: 'Watchman', type: 'guard', age: 30 };
        const base = Duels.fromNpc(npc);
        PracticeSkills.setLevel(CombatSkills.npcHolder(npc), 'blades', 10);
        const vet = Duels.fromNpc(npc);
        expect(vet.attack).toBeGreaterThan(base.attack);
        expect(vet.skill).toBe(10);
        expect(vet.moves.power).toBeGreaterThan(0);
    });
});

describe('field battle: your own hand', () => {
    it('a beginner adds nothing; a master blade and a bow do', () => {
        const p = fighter(1);
        expect(FieldBattle.personalEdge(p)).toEqual({ opening: 1, melee: 1, pursuit: 1 });
        PracticeSkills.setLevel(p, 'brawling', 6);
        PracticeSkills.setLevel(p, 'archery', 8);
        p.inventory.bow = 1;
        const e = FieldBattle.personalEdge(p);
        expect(e.melee).toBeGreaterThan(1);
        expect(e.opening).toBeGreaterThan(1);
    });
});

describe('Sailing', () => {
    const OCEAN = { id: 'ocean', passable: false };
    const PLAINS = { id: 'plains', passable: true };
    const seaWorld = () => {
        const tiles = new Map();
        const land = { '5,10': { name: 'Saltmere', type: 'town' }, '35,10': { name: 'Gullhaven', type: 'town' } };
        return {
            width: 60, height: 30, day: 1,
            getTile(q, r) {
                if (r < 0 || r >= 30) return null;
                const key = `${q},${r}`;
                if (!tiles.has(key)) tiles.set(key, { q, r, terrain: land[key] ? PLAINS : OCEAN, settlement: land[key] ? { q, r, ...land[key] } : null });
                return tiles.get(key);
            },
        };
    };
    const voyage = (level) => {
        Utils.setSeed(99);
        const w = seaWorld();
        const s = { id: 'ship_1', typeId: 'cog', name: 'Gull', q: 5, r: 10, status: 'docked', condition: 100, customizations: [], cargo: { food: 80 }, crew: Ships.getShipEffectiveStats({ typeId: 'cog' }).crewRequired, morale: 70 };
        const p = { gold: 5000, renown: 0, karma: 0, health: 100, reputation: {}, inventory: {}, skills: {}, ships: [s], army: [], q: 5, r: 10, boardedShip: null };
        if (level > 1) PracticeSkills.setLevel(p, 'sailing', level);
        const saved = DataLoader.ships.settings.voyage.eventChance;
        DataLoader.ships.settings.voyage.eventChance = 0;
        Ships.startVoyage(p, w, s.id, 35, 10, 'Gullhaven');
        let days = 0;
        let ups = 0;
        while (Ships.getVoyage(p) && days < 80) {
            w.day++;
            days++;
            const out = Ships.processDaily(p, w);
            if (out.sailing) ups++;
        }
        DataLoader.ships.settings.voyage.eventChance = saved;
        return { days, p, ups };
    };

    it('a skilled captain makes the crossing in fewer days, and every day at sea teaches it', () => {
        const green = voyage(1);
        const old = voyage(10);
        expect(old.days).toBeLessThan(green.days);
        expect(PracticeSkills.xp(green.p, 'sailing')).toBeGreaterThan(0);
    });

    it('the perks only count aboard', () => {
        const p = { boardedShip: 'a' };
        PracticeSkills.setLevel(p, 'sailing', 8);
        expect(Ships.seamanship(p, { id: 'a' }, 'stormSafety')).toBeGreaterThan(0);
        expect(Ships.seamanship(p, { id: 'b' }, 'stormSafety')).toBe(0);
    });
});
