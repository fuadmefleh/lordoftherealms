// The Hall of Houses and Ironman (systems/metaLegacy.js, systems/metaLegacyStart.js,
// systems/saveLoad.js ironman slot): an ended House is filed in a profile kept
// outside the saves, tainted runs earn nothing, unlocks open from real tallies,
// a new game's legacy choices shape it modestly (and only when earned), and an
// Ironman run saves to its own slot every day and never after it is over.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { loadData, newGame, roundTrip } from './playtest/harness.js';
import { MetaLegacy } from '../systems/metaLegacy.js';
import { MetaLegacyStart } from '../systems/metaLegacyStart.js';
import { Legacy } from '../systems/legacy.js';
import { Throne } from '../systems/throne.js';
import { Heirlooms } from '../systems/heirlooms.js';
import { Traits } from '../systems/traits.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { DataLoader } from '../core/dataLoader.js';

function memStore() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
        _m: m,
    };
}

/** A filed House as the Hall keeps it. */
function entry(over = {}) {
    return {
        id: `e-${Math.floor(Math.abs(over.score || 1))}-${over.house || 'House Vael'}`,
        runId: 'run-x', house: 'House Vael', sigilIcon: '🦅', generations: 2, years: 30, score: 300,
        rank: 'A Storied Line', crowns: 0, peak: ['Lord of Ashford'], cause: 'old age', tainted: false, ironman: false,
        heirlooms: [{ name: 'Oathbrand', kind: 'sword', icon: '🗡️', legend: 9 }], endedAt: 1000, reigns: [],
        ...over,
    };
}

beforeAll(async () => {
    await loadData();
});

beforeEach(() => {
    MetaLegacy.storage = memStore();
});

afterEach(() => {
    MetaLegacy.storage = null;
});

describe('the Hall profile', () => {
    it('is blank when nothing is stored or it is unreadable, and round-trips', () => {
        expect(MetaLegacy.load().entries).toEqual([]);
        MetaLegacy.storage.setItem(MetaLegacy.config().storageKey, '{not json');
        expect(MetaLegacy.load().entries).toEqual([]);
        expect(MetaLegacy.save({ version: 1, entries: [entry()] })).toBe(true);
        expect(MetaLegacy.load().entries).toHaveLength(1);
    });

    it('survives storage that throws', () => {
        MetaLegacy.storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
        expect(MetaLegacy.load().entries).toEqual([]);
        expect(MetaLegacy.save({ entries: [entry()] })).toBe(false);
    });

    it('counts only untainted Houses towards unlocks', () => {
        const p = { entries: [entry({ score: 700, tainted: true, generations: 5, ironman: true }), entry({ score: 120, years: 12 })] };
        const st = MetaLegacy.stats(p);
        expect(st.housesEnded).toBe(1);
        expect(st.bestScore).toBe(120);
        expect(st.ironmanHouses).toBe(0);
        expect(st.tainted).toBe(1);
        const earned = MetaLegacy.earnedIds(p);
        expect(earned.has('remembered_name')).toBe(true);
        expect(earned.has('blood_of_the_brave')).toBe(false);
        expect(earned.has('ironsworn')).toBe(false);
        expect(MetaLegacy.lineages(p)).toHaveLength(1);
    });

    it('describes what a locked unlock needs', () => {
        expect(MetaLegacy.describeRequirement({ housesEnded: 2, bestScore: 250 })).toBe('2 Houses ended, a House of legacy 250');
    });
});

describe('filing an ended House', () => {
    it('Legacy.endDynasty files nothing without a run record, and once with one', () => {
        const g = newGame(71);
        Legacy.endDynasty(g.player, g.world, 'old age');
        expect(MetaLegacy.load().entries).toHaveLength(0);

        const h = newGame(72);
        h.world.run = MetaLegacy.newRun({ ironman: true, seed: 72, now: 5000 });
        h.world.run.tainted = { day: 3, why: 'cheats' };
        const epitaph = Legacy.endDynasty(h.player, h.world, 'battle');
        expect(epitaph).toBeTruthy();
        Legacy.endDynasty(h.player, h.world, 'battle'); // idempotent
        const list = MetaLegacy.load().entries;
        expect(list).toHaveLength(1);
        const e = list[0];
        expect(e.house).toBe(h.player.house.name);
        expect(e.ironman).toBe(true);
        expect(e.tainted).toBe(true);
        expect(e.cause).toBe('battle');
        expect(e.runId).toBe(h.world.run.id);
        expect(typeof e.score).toBe('number');
        expect(MetaLegacy.lastEntryFor(h.world.run.id, h.player.house.name).id).toBe(e.id);
    });

    it('keeps the House\'s held heirlooms and crowns as peak titles', () => {
        const g = newGame(73);
        g.world.run = MetaLegacy.newRun({ seed: 73, now: 1 });
        Heirlooms.create(g.player, g.world, { kind: 'ring', name: 'the Ring of Test' });
        const e = MetaLegacy.entryFor(g.player, g.world, {
            houseName: 'House Test', reigns: [{ name: 'A', crown: 'Vael', title: 'Duke' }, { name: 'B', title: 'Duke' }],
            generations: 2, years: 40, score: 500, rank: { label: 'Great', icon: '👑' },
        }, 'old age', 9);
        expect(e.peak).toEqual(['Crown of Vael', 'Duke']);
        expect(e.heirlooms.map(h => h.name)).toContain('the Ring of Test');
    });
});

describe('a new game from the Hall', () => {
    it('ignores choices the Hall has not earned', () => {
        const g = newGame(81);
        const gold = g.player.gold;
        const out = MetaLegacyStart.apply(g.player, g.world, { lineage: 'nope', boon: 'blood_of_the_brave', origin: 'scion' }, { entries: [] });
        expect(out.applied).toEqual({ lineage: null, boon: null, origin: null });
        expect(g.player.gold).toBe(gold);
        expect(g.world.run.legacy.lineage).toBe(null);
    });

    it('a lineage is remembered: lore in the chronicle, a grudge, and a weak claim for a crowned line', () => {
        const g = newGame(82);
        const crowned = entry({ id: 'crowned', house: 'House Ormond', crowns: 1, peak: ['Crown of Old Ormond'], score: 260 });
        const profile = { entries: [crowned] };
        const out = MetaLegacyStart.apply(g.player, g.world, { lineage: 'crowned' }, profile);
        const lin = out.applied.lineage;
        expect(lin.house).toBe('House Ormond');
        expect(g.world.run.legacy.lineage.house).toBe('House Ormond');
        expect((g.player.house.history || []).some(h => (h.tags || []).includes('lineage'))).toBe(true);
        expect(g.player.house.rivals[lin.rivalKingdom].feud).toBe(MetaLegacy.config().lineage.rivalFeud);
        expect(lin.claimKingdom).not.toBe(null);
        expect(lin.claimKingdom).not.toBe(lin.rivalKingdom);
        // weak: well below what an origin's blood claim gives
        expect(Throne.claimStrength(g.player, lin.claimKingdom)).toBeLessThanOrEqual(MetaLegacy.config().lineage.claimStrength + 1);
    });

    it('no claim without a crown in the lineage', () => {
        const g = newGame(83);
        const out = MetaLegacyStart.apply(g.player, g.world, { lineage: 'plain' }, { entries: [entry({ id: 'plain', score: 260 }), entry({ id: 'k', house: 'House K', crowns: 1, score: 10 })] });
        expect(out.applied.lineage.claimKingdom).toBe(null);
    });

    it('the Grandsire\'s Blade is the old House\'s own sword, as an heirloom', () => {
        const g = newGame(84);
        const out = MetaLegacyStart.apply(g.player, g.world, { lineage: 'e1', boon: 'grandsires_blade' }, { entries: [entry({ id: 'e1', score: 300 })] });
        expect(out.applied.boon).toBe('grandsires_blade');
        const held = Heirlooms.list(g.player);
        expect(held.some(h => h.name === 'Oathbrand' && h.kind === 'sword')).toBe(true);
    });

    it('a trait boon and a legacy start, scaled by difficulty', () => {
        const g = newGame(85);
        if (!Traits.TRAITS.brave) Traits.load(DataLoader._gamedata.traits);
        g.player.scenario = { id: 'wanderer', difficulty: 'hard', victory: 'none' };
        const profile = { entries: [entry({ id: 'a', score: 700, generations: 3 })] };
        const out = MetaLegacyStart.apply(g.player, g.world, { boon: 'blood_of_the_brave', origin: 'scion' }, profile);
        expect(out.applied.origin).toBe('scion');
        // a scion is a lineage by nature: the latest House
        expect(out.applied.lineage.house).toBe('House Vael');
        expect(g.player.gold).toBe(Math.round(400 * 0.6));
        expect(Traits.getEarned(g.player)).toContain('brave');
        expect(out.welcome).toContain('House Vael');
    });
});

describe('the run record and Ironman saves', () => {
    let realLS;
    beforeEach(() => {
        realLS = globalThis.localStorage;
        globalThis.localStorage = memStore();
    });
    afterEach(() => {
        globalThis.localStorage = realLS;
    });

    it('world.run survives a save round trip; older saves get an ordinary one', () => {
        const g = newGame(91);
        g.world.run = MetaLegacy.newRun({ ironman: true, seed: 91, now: 42 });
        const back = roundTrip(g);
        expect(back.world.run.ironman).toBe(true);
        expect(back.world.run.id).toBe(g.world.run.id);
        const old = newGame(92);
        old.world.run = null;
        expect(MetaLegacy.ensureRun(old.world).ironman).toBe(false);
    });

    it('an Ironman game saves to its own slot every day, and not once the run is over', () => {
        const world = { day: 3, run: MetaLegacy.newRun({ ironman: true }) };
        const game = { world, player: null };
        expect(SaveLoad.slotKey(game)).toBe(SaveLoad.IRONMAN_KEY);
        expect(SaveLoad.shouldAutoSave(game)).toBe(true);
        const plain = { world: { day: 3, run: MetaLegacy.newRun({}) } };
        expect(SaveLoad.slotKey(plain)).toBe(SaveLoad.SAVE_KEY);
        expect(SaveLoad.shouldAutoSave(plain)).toBe(SaveLoad.AUTO_SAVE_INTERVAL > 0 && 3 % SaveLoad.AUTO_SAVE_INTERVAL === 0);
        MetaLegacy.finalize(world);
        expect(SaveLoad.shouldAutoSave(game)).toBe(false);
        expect(SaveLoad.saveGame(game).success).toBe(false);
    });

    it('the save list marks the Ironman save', () => {
        const save = (ironman, t) => JSON.stringify({ version: '1.0', timestamp: t, meta: { ironman, tainted: false, playerName: 'Ada', houseName: 'House Ada' }, world: { day: 5, year: 900 }, player: { gold: 1 } });
        localStorage.setItem(SaveLoad.SAVE_KEY, save(false, 1));
        localStorage.setItem(SaveLoad.IRONMAN_KEY, save(true, 2));
        const list = SaveLoad.listSaves();
        expect(list.map(s => s.key)).toEqual([SaveLoad.IRONMAN_KEY, SaveLoad.SAVE_KEY]);
        expect(list[0].ironman).toBe(true);
        expect(list[1].ironman).toBe(false);
        expect(SaveLoad.hasSave()).toBe(true);
        SaveLoad.deleteSave(SaveLoad.IRONMAN_KEY);
        expect(SaveLoad.listSaves()).toHaveLength(1);
    });

    it('a cheat taints the run once', () => {
        const world = { day: 9, run: MetaLegacy.newRun({ ironman: true }) };
        expect(MetaLegacy.taint(world, 'cheats', 9)).toBe(true);
        expect(MetaLegacy.taint(world, 'cheats', 10)).toBe(false);
        expect(world.run.tainted.day).toBe(9);
        expect(MetaLegacy.isTainted(world)).toBe(true);
    });
});
