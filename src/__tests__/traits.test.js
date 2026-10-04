// Earned character traits: deeds past a threshold earn a trait, opposite
// traits displace each other, contrary deeds erode a trait, traits carry
// effects, and on succession only a fading dynasty echo survives.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Traits } from '../systems/traits.js';
import { Quests } from '../systems/quests.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Councils } from '../systems/councils.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const makePlayer = () => ({ gold: 0, karma: 0, renown: 0, skills: {}, reputation: {} });

describe('trait content', () => {
    it('loads about twenty traits whose deeds and opposites resolve', () => {
        const ids = Object.keys(Traits.TRAITS);
        expect(ids.length).toBeGreaterThanOrEqual(20);
        for (const [id, def] of Object.entries(Traits.TRAITS)) {
            expect(def.threshold).toBeGreaterThan(0);
            for (const deed of [...Object.keys(def.deeds), ...Object.keys(def.erodedBy || {})]) {
                expect(Traits.DEEDS[deed], `${id} uses unknown deed ${deed}`).toBeTruthy();
            }
            if (def.opposite) expect(Traits.TRAITS[def.opposite].opposite).toBe(id);
        }
    });
});

describe('thresholds', () => {
    it('earns a trait only once its deeds reach the threshold', () => {
        const p = makePlayer();
        const need = Traits.TRAITS.brave.threshold;
        for (let i = 0; i < need - 1; i++) Traits.recordDeed(p, 'valor');
        expect(Traits.has(p, 'brave')).toBe(false);
        const r = Traits.recordDeed(p, 'valor');
        expect(r.gained).toEqual(['brave']);
        expect(Traits.has(p, 'brave')).toBe(true);
        expect(p.traits.deeds.valor).toBe(need);
        const notices = Traits.drainNotices(p);
        expect(notices[0].kind).toBe('gained');
        expect(notices[0].title).toContain('Brave');
        expect(Traits.drainNotices(p)).toEqual([]);
    });

    it('Quests.track counters feed deeds (battles won → Brave)', () => {
        const p = makePlayer();
        Quests.initialize(p);
        Quests.track(p, 'battles_won', Traits.TRAITS.brave.threshold);
        expect(Traits.has(p, 'brave')).toBe(true);
        Quests.track(p, 'trade_profit', Traits.TRAITS.merchant_prince.threshold);
        expect(Traits.has(p, 'merchant_prince')).toBe(true);
    });

    it('violence against the realm you married into makes a Kinslayer', () => {
        const p = makePlayer();
        p.marriageAllianceKingdom = 'k1';
        Traits.recordAggression(p, 'k2', { cruelty: 1 });
        expect(p.traits.deeds.kinslaying).toBeUndefined();
        Traits.recordAggression(p, 'k1', { cunning: 1 }); // spying is not violence
        expect(p.traits.deeds.kinslaying).toBeUndefined();
        for (let i = 0; i < Traits.TRAITS.kinslayer.threshold; i++) Traits.recordAggression(p, 'k1', { cruelty: 1 });
        expect(Traits.has(p, 'kinslayer')).toBe(true);
    });
});

describe('opposites', () => {
    it('earning a trait displaces its opposite', () => {
        const p = makePlayer();
        Traits.recordDeed(p, 'generosity', Traits.TRAITS.generous.threshold);
        expect(Traits.has(p, 'generous')).toBe(true);
        // Greed erodes Generous along the way; enough of it flips the character
        Traits.recordDeed(p, 'greed', Traits.TRAITS.greedy.threshold * 2);
        expect(Traits.has(p, 'greedy')).toBe(true);
        expect(Traits.has(p, 'generous')).toBe(false);
    });

    it('opposites never coexist even when both are pushed directly', () => {
        const p = makePlayer();
        Traits.recordDeed(p, 'valor', 100);
        Traits.getState(p).progress.craven = 100;
        Traits.recordDeed(p, 'cowardice', 0.001);
        expect(Traits.has(p, 'brave') && Traits.has(p, 'craven')).toBe(false);
        expect(Traits.has(p, 'craven')).toBe(true);
    });
});

describe('erosion', () => {
    it('acting against a trait for long enough erodes it', () => {
        const p = makePlayer();
        const def = Traits.TRAITS.honest;
        Traits.recordDeed(p, 'honesty', def.threshold);
        expect(Traits.has(p, 'honest')).toBe(true);
        // A single lie dents it but does not undo a reputation
        Traits.recordDeed(p, 'deceit', 1);
        expect(Traits.has(p, 'honest')).toBe(true);
        let lost = false;
        for (let i = 0; i < 20 && !lost; i++) lost = Traits.recordDeed(p, 'deceit', 1).lost.includes('honest');
        expect(lost).toBe(true);
        expect(Traits.has(p, 'honest')).toBe(false);
    });

    it('a deeply held trait takes longer to erode, but progress is capped', () => {
        const p = makePlayer();
        Traits.recordDeed(p, 'valor', 1000);
        expect(Traits.strength(p, 'brave')).toBe(Traits.CONFIG.maxFraction);
    });

    it('habits fade without practice', () => {
        const p = makePlayer();
        Traits.recordDeed(p, 'drinking', Traits.TRAITS.drunkard.threshold);
        expect(Traits.has(p, 'drunkard')).toBe(true);
        for (let d = 0; d < 200; d++) Traits.processDay(p, { day: d });
        expect(Traits.has(p, 'drunkard')).toBe(false);
    });

    it('heavy taxes on your own lands read as greed', () => {
        const p = makePlayer();
        p.colonies = [{ q: 0, r: 0 }];
        p.taxRate = 'very_high';
        Traits.processDay(p, { day: 1 });
        expect(p.traits.deeds.greed).toBeGreaterThan(0);
    });
});

describe('effects', () => {
    it('no traits means no change anywhere', () => {
        const p = makePlayer();
        expect(PlayerEffects.traitBattleMultiplier(p)).toBe(1);
        expect(Traits.npcWarmthMultiplier(p)).toBe(1);
        expect(Traits.lordOpinion(p, { traits: [{ id: 'pious' }] })).toBe(0);
    });

    it('Brave fights harder; Merchant Prince trades better', () => {
        const p = makePlayer();
        const tradeBefore = PlayerEffects.tradeBonus(p, null);
        Traits.recordDeed(p, 'valor', 50);
        Traits.recordDeed(p, 'trade', 10000);
        expect(PlayerEffects.traitBattleMultiplier(p)).toBeCloseTo(1 + Traits.TRAITS.brave.effects.battlePower);
        expect(PlayerEffects.tradeBonus(p, null)).toBeCloseTo(tradeBefore + Traits.TRAITS.merchant_prince.effects.tradeBonus);
    });

    it('Honest negotiates better; Deceitful worse', () => {
        const honest = makePlayer();
        const base = PlayerEffects.negotiationBonus(honest);
        Traits.recordDeed(honest, 'honesty', 100);
        expect(PlayerEffects.negotiationBonus(honest)).toBeGreaterThan(base);
        const liar = makePlayer();
        Traits.recordDeed(liar, 'deceit', 100);
        expect(PlayerEffects.negotiationBonus(liar)).toBeLessThan(base);
    });

    it('a Dread Lord intimidates easily but is loved by none', () => {
        const p = makePlayer();
        Traits.recordDeed(p, 'dread', 100);
        expect(Traits.has(p, 'dread_lord')).toBe(true);
        const npc = { type: 'villager' };
        expect(NpcDisposition.threatDifficulty(npc, 4, p)).toBeLessThan(NpcDisposition.threatDifficulty(npc, 4));
        const a = { type: 'villager' };
        const b = { type: 'villager' };
        const warm = NpcDisposition.adjustDisposition(a, 10);
        const cold = NpcDisposition.adjustDisposition(b, 10, p);
        expect(cold).toBeLessThan(warm);
    });

    it('threats and gifts are recorded as deeds', () => {
        const p = makePlayer();
        NpcDisposition.resolveThreat({ type: 'guard' }, p, false);
        expect(p.traits.deeds.dread).toBeGreaterThan(0);
        NpcDisposition.recordGift({ type: 'beggar' }, p);
        expect(p.traits.deeds.generosity).toBeGreaterThan(0);
        expect(p.traits.deeds.mercy).toBeGreaterThan(0);
    });

    it('a Pious player has the clergy and pious lords on side', () => {
        const p = makePlayer();
        const before = Councils.factionTargets(p, null).clergy;
        Traits.recordDeed(p, 'piety', 100);
        expect(Councils.factionTargets(p, null).clergy).toBeGreaterThan(before);
        expect(Traits.lordOpinion(p, { traits: [{ id: 'pious' }] })).toBeGreaterThan(0);
    });

    it('offers a flavoured greeting only when the roll allows', () => {
        const p = makePlayer();
        expect(Traits.greetingLine(p, 0)).toBeNull();
        Traits.recordDeed(p, 'dread', 100);
        expect(typeof Traits.greetingLine(p, 0, 0)).toBe('string');
        expect(Traits.greetingLine(p, 0.99, 0)).toBeNull();
    });
});

describe('succession echo', () => {
    it('traits are not inherited; the House keeps a fading echo of the two strongest', () => {
        const p = makePlayer();
        House.initialize(p, { day: 0 });
        Traits.recordDeed(p, 'valor', 1000);     // Brave, max strength
        Traits.recordDeed(p, 'dread', 30);       // Dread Lord, strong
        Traits.recordDeed(p, 'learning', 12);    // Scholar, just earned
        const echo = Traits.onSuccession(p, { day: 10 }, 'Old Lord');
        expect(echo.map(e => e.id)).toEqual(['brave', 'dread_lord']);
        expect(Traits.getEarned(p)).toEqual([]);
        expect(p.house.traitEcho).toHaveLength(2);
        expect(p.house.traitEcho[0].strength).toBeCloseTo(Traits.CONFIG.echoStrength);

        // The echo colours reactions (social keys) but not personal prowess
        expect(PlayerEffects.traitBattleMultiplier(p)).toBe(1);
        expect(Traits.npcWarmthMultiplier(p)).toBeLessThan(1);
        expect(Traits.effect(p, 'intimidation')).toBeLessThan(0);

        // ...and fades away
        const s0 = p.house.traitEcho[0].strength;
        Traits.processDay(p, { day: 11 });
        expect(p.house.traitEcho[0].strength).toBeLessThan(s0);
        for (let d = 12; d < 400; d++) Traits.processDay(p, { day: d });
        expect(p.house.traitEcho).toEqual([]);
    });

    it('Relationships.succeedAsHeir hands the echo to the House', () => {
        const p = new Player();
        House.initialize(p, { day: 0 });
        p.children = [{ id: 'c1', firstName: 'Ana', dynasty: 'Vel', age: 20, isAlive: true, gender: 'female' }];
        Traits.recordDeed(p, 'piety', 100);
        const res = Relationships.succeedAsHeir(p, 'c1', { day: 5, kingdoms: [] });
        expect(res.success).toBe(true);
        expect(res.traitEcho.map(e => e.id)).toEqual(['pious']);
        expect(Traits.has(p, 'pious')).toBe(false);
        expect(Traits.getEcho(p)[0].id).toBe('pious');
    });
});

describe('save/load', () => {
    it('round-trips traits and the echo; old saves backfill a blank record', () => {
        const p = new Player();
        House.initialize(p, { day: 0 });
        Traits.recordDeed(p, 'valor', 20);
        p.house.traitEcho = [{ id: 'cruel', strength: 0.3, from: 'Grandsire', day: 1 }];
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(Traits.has(back, 'brave')).toBe(true);
        expect(back.traits.deeds.valor).toBe(20);
        expect(Traits.getEcho(back)[0].id).toBe('cruel');

        delete json.traits;
        const legacy = new Player();
        SaveLoad.restorePlayer(json, legacy);
        expect(legacy.traits).toEqual({ deeds: {}, progress: {}, earned: {}, notices: [] });
    });
});
