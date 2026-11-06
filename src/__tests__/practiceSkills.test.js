/**
 * Practised skills (systems/practiceSkills.js, data/practiceSkills.json):
 * levels earned by doing, for the player and NPCs; Diving as the first full
 * skill (breath by level, XP from dives, winded after a dive to the limit).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Diving } from '../player/diving.js';
import { Swimming } from '../player/swimming.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Townsfolk } from '../systems/townsfolk.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const summer = { season: 'Summer', day: 10 };
const never = () => 1; // no blackout rolls

const diver = (level = 1) => {
    const p = new Player();
    p.inventory = {};
    p.health = 100;
    p.age = 30;   // in their prime: age neither speeds nor slows the learning (systems/practiceSkills.js)
    p.gold = 0;
    if (p.needs) p.needs.energy = 100;
    if (level > 1) PracticeSkills.setLevel(p, 'diving', level);
    return p;
};

describe('levels and XP', () => {
    it('each level costs more than the last, and XP maps back to its level', () => {
        const max = PracticeSkills.maxLevel();
        expect(max).toBeGreaterThanOrEqual(5);
        for (let L = 2; L < max; L++) expect(PracticeSkills.stepXp(L)).toBeGreaterThan(PracticeSkills.stepXp(L - 1));
        for (let L = 1; L <= max; L++) {
            const at = PracticeSkills.xpForLevel(L);
            expect(PracticeSkills.levelForXp(at)).toBe(L);
            if (L > 1) expect(PracticeSkills.levelForXp(at - 0.01)).toBe(L - 1);
        }
        expect(PracticeSkills.levelForXp(1e9)).toBe(max);
    });

    it('a level crossed is an event telling what it gives', () => {
        const h = {};
        expect(PracticeSkills.level(h, 'diving')).toBe(1);
        expect(PracticeSkills.gain(h, 'diving', 1)).toBeNull();
        const ev = PracticeSkills.gain(h, 'diving', PracticeSkills.stepXp(1));
        expect(ev).toMatchObject({ skill: 'diving', from: 1, to: 2 });
        const b = PracticeSkills.def('diving').perks.breath.levels;
        expect(ev.text).toContain(`+${b[1] - b[0]}s of breath`);
        expect(ev.text).toMatch(/^Diving rose to level 2/);
        // capped at the top
        PracticeSkills.gain(h, 'diving', 1e9);
        expect(PracticeSkills.level(h, 'diving')).toBe(PracticeSkills.maxLevel());
        expect(PracticeSkills.progress(h, 'diving').max).toBe(true);
        expect(PracticeSkills.nextGains(h, 'diving')).toEqual([]);
    });

    it('the list shows level, progress and what the next level gives', () => {
        const h = {};
        PracticeSkills.gain(h, 'diving', PracticeSkills.stepXp(1) / 2);
        const d = PracticeSkills.list(h).find(s => s.id === 'diving');
        expect(d.level).toBe(1);
        expect(d.share).toBeCloseTo(0.5);
        expect(d.next.join(' ')).toMatch(/breath/);
        expect(d.perks.join(' ')).toMatch(/s of breath/);
    });
});

describe('diving by level', () => {
    it('breath, speed and the cold all follow the level', () => {
        const lo = diver(1), hi = diver(PracticeSkills.maxLevel());
        expect(Diving.breath(lo)).toBe(20);
        expect(Diving.breath(hi)).toBe(120);
        expect(Diving.speedMult(hi)).toBeGreaterThan(Diving.speedMult(lo));
        expect(Diving.coldBreathMult(hi)).toBeLessThan(Diving.coldBreathMult(lo));
    });

    it('pushing to the limit teaches more than an easy dive', () => {
        const easy = diver(); Diving.goUnder(easy, summer);
        Diving.tick(easy, summer, null, 10, never);
        const a = Diving.surface(easy);
        const hard = diver(); Diving.goUnder(hard, summer);
        Diving.tick(hard, summer, null, 19, never);
        const b = Diving.surface(hard);
        expect(b.limit).toBe(true);
        expect(b.xp / 19).toBeGreaterThan(a.xp / 10);
    });

    it('treasure off the bottom is a bonus', () => {
        const p = diver(); Diving.goUnder(p, summer);
        Diving.take(p, { item: 'pearls', qty: 1, rare: true });
        const res = Diving.surface(p);
        expect(res.xp).toBeGreaterThanOrEqual(PracticeSkills.def('diving').xp.treasure);
    });

    it('enough dives raise the level, and the next dive holds more breath', () => {
        const p = diver();
        const before = Diving.breath(p);
        let ups = [];
        for (let i = 0; i < 6 && !ups.length; i++) {
            p.breathRecovery = null;
            Diving.goUnder(p, summer);
            Diving.tick(p, summer, null, Diving.breath(p) - 1, never);
            ups = Diving.surface(p).levelUps.filter(u => u.skill === 'diving');
        }
        expect(ups.length).toBe(1);
        p.breathRecovery = null;
        Diving.goUnder(p, summer);
        expect(p.dive.max).toBeGreaterThan(before);
    });
});

describe('getting your breath back', () => {
    it('after a dive to the limit you are winded and cannot go under until it passes', () => {
        const p = diver();
        Diving.goUnder(p, summer);
        Diving.tick(p, summer, null, 19, never);       // 1s of 20 left: under 10%
        const res = Diving.surface(p);
        expect(res.recovery.winded).toBe(true);
        expect(res.recovery.seconds).toBe(PracticeSkills.perkAt('diving', 'winded', 1));
        const no = Diving.canDive(p);
        expect(no.ok).toBe(false);
        expect(no.recovering).toBe(true);
        expect(no.reason).toMatch(/Winded — catching your breath, \d+s/);
        expect(Diving.recoveryShare(p)).toBeLessThan(0.2);
        expect(Diving.recover(p, res.recovery.seconds / 2)).toBe(false);
        expect(Diving.canDive(p).ok).toBe(false);
        expect(Diving.recoveryShare(p)).toBeGreaterThan(0.4);
        expect(Diving.recover(p, res.recovery.seconds)).toBe(true);
        expect(Diving.canDive(p).ok).toBe(true);
    });

    it('an easy dive needs only a short breather; a blackout the longest', () => {
        const p = diver();
        Diving.goUnder(p, summer);
        Diving.tick(p, summer, null, 2, never);
        const easy = Diving.surface(p).recovery;
        expect(easy.winded).toBe(false);
        expect(easy.seconds).toBeLessThan(PracticeSkills.perkAt('diving', 'winded', 1) / 3);
        expect(Diving.recoveryText(p)).toMatch(/^Catching your breath — \d+s$/);
        p.breathRecovery = null;
        Diving.goUnder(p, summer);
        Diving.tick(p, summer, null, 25, never);
        const out = Diving.surface(p, { blackout: true }).recovery;
        expect(out.winded).toBe(true);
        expect(out.seconds).toBeGreaterThan(PracticeSkills.perkAt('diving', 'winded', 1));
    });

    it('a better diver recovers sooner', () => {
        const lo = Diving.recoveryFor(diver(1), 0.05);
        const hi = Diving.recoveryFor(diver(PracticeSkills.maxLevel()), 0.05);
        expect(hi.seconds).toBeLessThan(lo.seconds);
    });
});

describe('swimming', () => {
    it('strokes are swimming XP, and a level-up is told', () => {
        const p = diver();
        const need = PracticeSkills.stepXp(1) / PracticeSkills.def('swimming').xp.perStroke;
        let told = null;
        for (let i = 0; i < need + 1 && !told; i++) {
            const res = Swimming.stroke(p, summer, null);
            if (res.levelUp) told = res;
        }
        expect(told).toBeTruthy();
        expect(told.notices[0].text).toMatch(/Swimming rose to level 2/);
        expect(Swimming.speedBonus(p)).toBeGreaterThan(1);
    });
});

describe('save and load', () => {
    it('round-trips the skills', () => {
        const p = diver(4);
        PracticeSkills.gain(p, 'swimming', 33);
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(PracticeSkills.level(back, 'diving')).toBe(4);
        expect(PracticeSkills.xp(back, 'swimming')).toBeCloseTo(33);
    });

    it('keeps a winded diver winded through a save and load', () => {
        const p = diver();
        Diving.goUnder(p, summer);
        Diving.tick(p, summer, null, 19, never);
        Diving.surface(p);
        Diving.recover(p, 3);
        const left = p.breathRecovery.left;
        expect(Diving.recovering(p)).toBe(true);
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p))), back);
        expect(Diving.recovering(back)).toBe(true);
        expect(back.breathRecovery.left).toBeCloseTo(left);
        expect(Diving.canDive(back).ok).toBe(false);
        expect(Diving.recover(back, left + 1)).toBe(true);
        expect(Diving.recovering(back)).toBe(false);
    });

    it('an old save\'s swimming practice becomes XP, once', () => {
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify({ ...SaveLoad.serializePlayer(new Player()), swimPractice: 400 })), back);
        const rates = PracticeSkills.config().migrate.swimPractice;
        expect(PracticeSkills.xp(back, 'swimming')).toBe(400 * rates.swimming);
        expect(PracticeSkills.xp(back, 'diving')).toBe(400 * rates.diving);
        expect(back.swimPractice).toBeUndefined();
        expect(Diving.breath(back)).toBeGreaterThan(20);
        const again = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(back)));
        expect(again.swimPractice).toBeUndefined();
        expect(again.practiceSkills.diving).toBe(400 * rates.diving);
    });
});

describe('NPCs', () => {
    it('are seeded from who they are, the same every time', () => {
        const who = { key: '3,4#17', role: 'villager', age: 35, coastal: true };
        const a = {}, b = {};
        PracticeSkills.seedNpc(a, who);
        PracticeSkills.seedNpc(b, who);
        expect(a.practiceSkills).toEqual(b.practiceSkills);
        // a pearl diver dives far better than an inland beggar
        const pearl = {}, beggar = {};
        PracticeSkills.seedNpc(pearl, { key: 'x', role: 'pearl_diver', age: 30 });
        PracticeSkills.seedNpc(beggar, { key: 'x', role: 'beggar', age: 30 });
        expect(PracticeSkills.level(pearl, 'diving')).toBeGreaterThan(PracticeSkills.level(beggar, 'diving') + 3);
        expect(PracticeSkills.notable(pearl).map(s => s.id)).toContain('diving');
        // by the sea, some of the townsmen are fishers
        const trades = new Set();
        for (let i = 0; i < 60; i++) trades.add(PracticeSkills.tradeOf({ key: `c#${i}`, role: 'villager', coastal: true }));
        expect(trades.has('fisher')).toBe(true);
        expect(trades.has('villager')).toBe(true);
        expect(PracticeSkills.tradeOf({ key: 'c#1', role: 'villager', coastal: false })).toBe('villager');
    });

    it('grow by their work, a sailor at the water, a child not at all', () => {
        const sailor = {};
        PracticeSkills.seedNpc(sailor, { key: 's', role: 'sailor', age: 25 });
        const x0 = PracticeSkills.xp(sailor, 'swimming');
        PracticeSkills.growNpc(sailor, { key: 's', role: 'sailor', age: 25 }, 30);
        expect(PracticeSkills.xp(sailor, 'swimming')).toBeGreaterThan(x0);
        const kid = {};
        PracticeSkills.seedNpc(kid, { key: 'k', role: 'child', age: 8 });
        const k0 = JSON.stringify(kid.practiceSkills);
        PracticeSkills.growNpc(kid, { key: 'k', role: 'child', age: 8 }, 30);
        expect(JSON.stringify(kid.practiceSkills)).toBe(k0);
    });

    it('a townsperson is seeded once, by the sea or not, and kept on the person', () => {
        const sea = { day: 4000, getTile: (q) => ({ terrain: { id: q === 6 ? 'ocean' : 'grassland' } }) };
        const inland = { day: 4000, getTile: () => ({ terrain: { id: 'grassland' } }) };
        const person = () => ({ id: 9, role: 'villager', born: 4000 - 120 * 30 });
        const coast = person(), dry = person();
        Townsfolk.skillsOf({ q: 5, r: 5 }, coast, sea);
        Townsfolk.skillsOf({ q: 5, r: 5 }, dry, inland);
        expect(PracticeSkills.level(coast, 'swimming')).toBeGreaterThan(PracticeSkills.level(dry, 'swimming'));
        const kept = coast.practiceSkills;
        Townsfolk.skillsOf({ q: 5, r: 5 }, coast, sea);
        expect(coast.practiceSkills).toBe(kept);
    });

    it('an NPC seeded before newer skills existed has them filled in, and nothing else changed', () => {
        const who = { key: '7,2#41', role: 'smith', age: 40, coastal: false, mountain: true };
        const fresh = {};
        PracticeSkills.seedNpc(fresh, who);
        // An old save's townsperson: only diving/swimming, and some XP earned since
        const old = { practiceSkills: { diving: 5, swimming: 777 } };
        PracticeSkills.seedNpc(old, who);
        const s = old.practiceSkills;
        expect(s.diving).toBe(5);
        expect(s.swimming).toBe(777);
        for (const id of PracticeSkills.ids()) {
            if (id === 'diving' || id === 'swimming') continue;
            expect(PracticeSkills.level(old, id)).toBe(PracticeSkills.level(fresh, id));
        }
        expect(PracticeSkills.level(old, 'smithing')).toBeGreaterThan(1);
        expect(s._seed).toBe(PracticeSkills._seedSig());
        // Once up to date it is left alone
        PracticeSkills.gain(old, 'smithing', 50);
        const after = PracticeSkills.xp(old, 'smithing');
        PracticeSkills.seedNpc(old, who);
        expect(PracticeSkills.xp(old, 'smithing')).toBe(after);
        // A townsperson from an old save gets them on asking; a cached traveller too
        const p = { id: 3, role: 'villager', born: 4000 - 120 * 30, practiceSkills: { diving: 0 } };
        Townsfolk.skillsOf({ q: 1, r: 1 }, p, { day: 4000, getTile: () => ({ terrain: { id: 'grassland' } }) });
        expect(p.practiceSkills._seed).toBe(PracticeSkills._seedSig());
        const trav = { name: 'Odo', type: 'merchant', age: 40 };
        const h = Townsfolk.npcSkills(trav, null);
        h.practiceSkills = { swimming: 1 };
        Townsfolk.npcSkills(trav, null);
        expect(PracticeSkills.level(h, 'haggling')).toBeGreaterThan(1);
    });

    it('a ship\'s hand met on deck is a swimmer', () => {
        const hand = { name: 'Jory', deckRole: 'bosun', type: 'villager', age: 30 };
        const h = Townsfolk.npcSkills(hand, null);
        expect(PracticeSkills.level(h, 'swimming')).toBeGreaterThanOrEqual(5);
        expect(Townsfolk.npcSkills(hand, null)).toBe(h);
        expect(Object.keys(hand)).not.toContain('_skills');
    });
});
