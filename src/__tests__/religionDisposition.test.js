// Hollow-mechanics fixes: religious building yields, inner-map NPC
// disposition/personality effects, the inventory cap, and the legacy
// dynasty-prestige migration into House Prestige.
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { PlayerInventory } from '../player/inventory.js';
import { Trading } from '../player/playerEconomy.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { NpcFamily } from '../systems/npcFamily.js';
import { House } from '../systems/house.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

/** A tiny world: a building at (0,0), a settlement at (1,0). */
function makeWorld(population = 1000) {
    const tiles = {
        '0,0': { q: 0, r: 0, terrain: { passable: true } },
        '1,0': { q: 1, r: 0, terrain: { passable: true }, settlement: { population } },
    };
    return { day: 1, getTile: (q, r) => tiles[`${q},${r}`] || null, tiles };
}

function buildAt(world, type, player) {
    player.gold = 100000;
    const res = PlayerReligion.buildReligiousBuilding(player, type, world.getTile(0, 0), world);
    expect(res.success).toBe(true);
    const b = world.getTile(0, 0).religiousBuilding;
    b.underConstruction = false;
    return b;
}

function makeReligiousPlayer() {
    return {
        gold: 0, karma: 0, renown: 0, faith: 0,
        religion: { name: 'Light', followers: 0, buildings: [], influence: 0 },
    };
}

describe('Religious building yields', () => {
    it('copies the special yields from the JSON definition', () => {
        const world = makeWorld();
        const p = makeReligiousPlayer();
        const oracle = buildAt(world, 'ORACLE_TOWER', p);
        expect(oracle.scholarshipBonus).toBe(5);

        const w2 = makeWorld();
        expect(buildAt(w2, 'PILGRIM_HOSPICE', makeReligiousPlayer()).incomeBonus).toBe(30);
        const w3 = makeWorld();
        expect(buildAt(w3, 'RELIQUARY_VAULT', makeReligiousPlayer()).renownPerDay).toBe(1);
    });

    it('backfills old-save buildings from their definition', () => {
        const old = { type: 'reliquary_vault', faithGain: 20, influenceRadius: 5, followers: 0 };
        PlayerReligion.ensureBuildingStats(old);
        expect(old.renownPerDay).toBe(1);
        expect(old.incomeBonus).toBe(0);
    });

    it('faithGain is applied: pilgrims per day plus scaled conversion', () => {
        const world = makeWorld(1000);
        const p = makeReligiousPlayer();
        const temple = buildAt(world, 'TEMPLE', p); // faithGain 15, radius 5
        const gained = PlayerReligion.spreadFaith(p, world);
        // 15 pilgrims + floor(1000 * 0.01 * (1 + 0.5 faith * 0.1) * 1.25) = 15 + 13
        expect(gained).toBe(28);
        expect(temple.followers).toBe(28);
        expect(p.religion.followers).toBe(28);
    });

    it('a cathedral converts faster than a shrine', () => {
        const wa = makeWorld(10000);
        const pa = makeReligiousPlayer();
        buildAt(wa, 'SHRINE', pa);
        const wb = makeWorld(10000);
        const pb = makeReligiousPlayer();
        buildAt(wb, 'CATHEDRAL', pb);
        expect(PlayerReligion.spreadFaith(pb, wb)).toBeGreaterThan(PlayerReligion.spreadFaith(pa, wa));
    });

    it('Pilgrim Hospice pays gold and Reliquary Vault grants renown daily', () => {
        const w1 = makeWorld();
        const p1 = makeReligiousPlayer();
        buildAt(w1, 'PILGRIM_HOSPICE', p1);
        p1.gold = 0;
        const y1 = PlayerReligion.applyBuildingYields(p1, w1);
        expect(y1.gold).toBe(3);
        expect(p1.gold).toBe(3);

        const w2 = makeWorld();
        const p2 = makeReligiousPlayer();
        buildAt(w2, 'RELIQUARY_VAULT', p2);
        PlayerReligion.applyBuildingYields(p2, w2);
        expect(p2.renown).toBe(1);
    });

    it('Oracle Tower advances current research in whole days', () => {
        const world = makeWorld();
        const p = makeReligiousPlayer();
        buildAt(world, 'ORACLE_TOWER', p);
        p.technology = { researched: [], currentResearch: { techId: 'x', progress: 0, totalDays: 20 } };
        let days = 0;
        for (let i = 0; i < 10; i++) days += PlayerReligion.applyBuildingYields(p, world).researchDays;
        // 5 scholarship * 2% = 0.1 day/day → 1 day after 10 days
        expect(days).toBe(1);
        expect(p.technology.currentResearch.progress).toBe(1);
    });

    it('buildings under construction yield nothing', () => {
        const world = makeWorld();
        const p = makeReligiousPlayer();
        const b = buildAt(world, 'PILGRIM_HOSPICE', p);
        b.underConstruction = true;
        p.gold = 0;
        expect(PlayerReligion.applyBuildingYields(p, world).gold).toBe(0);
        expect(PlayerReligion.spreadFaith(p, world)).toBe(0);
    });
});

describe('NPC disposition & personality', () => {
    const npc = (extra = {}) => ({ id: 1, name: 'Ada', type: 'merchant', personalityTraits: [], ...extra });

    it('high disposition lowers prices and raises what they pay', () => {
        const friend = npc();
        NpcDisposition.getMemory(friend).disposition = 100;
        const foe = npc();
        NpcDisposition.getMemory(foe).disposition = 10;
        expect(NpcDisposition.buyPrice(friend, 100)).toBe(80);
        expect(NpcDisposition.buyPrice(foe, 100)).toBe(116);
        expect(NpcDisposition.sellPrice(friend, 100)).toBeGreaterThan(NpcDisposition.sellPrice(foe, 100));
    });

    it('personality traits shift prices', () => {
        const generous = npc({ personalityTraits: ['generous'] });
        const stern = npc({ personalityTraits: ['stern'] });
        expect(NpcDisposition.buyPrice(generous, 100)).toBe(92);
        expect(NpcDisposition.buyPrice(stern, 100)).toBe(105);
        expect(NpcDisposition.getPriceModifiers(generous).reasons[0].label).toBe('Generous');
    });

    it('gifts make future gains larger; threats make them smaller', () => {
        const a = npc();
        expect(NpcDisposition.adjustDisposition(a, 10)).toBe(10);
        for (let i = 0; i < 5; i++) NpcDisposition.recordGift(a);
        expect(NpcDisposition.adjustDisposition(a, 10)).toBe(15);

        const b = npc();
        NpcDisposition.getMemory(b).threatened = true;
        expect(NpcDisposition.adjustDisposition(b, 10)).toBe(5);
    });

    it('threatened NPCs distrust you, and refuse trade when they hate you', () => {
        const a = npc();
        const mem = NpcDisposition.getMemory(a);
        mem.threatened = true;
        mem.disposition = 50;
        expect(NpcDisposition.getPriceModifiers(a).buy).toBeCloseTo(1.1);
        mem.disposition = 20;
        expect(NpcDisposition.getPriceModifiers(a).refuses).toBe(true);
        expect(NpcDisposition.threatReaction(a)).toBeTruthy();
    });

    it('three gifts after a threat make amends', () => {
        const a = npc();
        NpcDisposition.getMemory(a).threatened = true;
        NpcDisposition.recordGift(a);
        NpcDisposition.recordGift(a);
        expect(NpcDisposition.recordGift(a).forgiven).toBe(true);
        expect(NpcDisposition.getMemory(a).threatened).toBe(false);
    });

    it('a successful threat hands over coin once', () => {
        Utils.setSeed(7);
        const player = { gold: 0 };
        const a = npc();
        const first = NpcDisposition.resolveThreat(a, player, true);
        expect(first.gold).toBeGreaterThanOrEqual(20);
        expect(player.gold).toBe(first.gold);
        const second = NpcDisposition.resolveThreat(a, player, true);
        expect(second.gold).toBe(0);
        expect(second.alreadyExtorted).toBe(true);
        expect(NpcDisposition.getMemory(a).threatened).toBe(true);
    });

    it('persuasion yields something concrete', () => {
        Utils.setSeed(3);
        const kingdom = { id: 'k1', name: 'Valdoria', military: 1200, treasury: 4300, wars: [] };
        for (let i = 0; i < 12; i++) {
            const player = { gold: 0, q: 0, r: 0, maps: [], learnAboutKingdom() {} };
            const tiles = {};
            const world = {
                day: 1, width: 0,
                getTile: (q, r) => (tiles[`${q},${r}`] ||= { q, r, explored: false, terrain: { passable: true } }),
            };
            const a = npc({ id: 100 + i });
            const s = NpcDisposition.persuadeSecret(a, { player, world, kingdom });
            expect(['map', 'cache', 'intel', 'discount']).toContain(s.kind);
            if (s.kind === 'cache') expect(player.gold).toBe(s.gold);
            if (s.kind === 'map') expect(s.tilesRevealed).toBeGreaterThan(0);
            if (s.kind === 'discount') expect(NpcDisposition.getMemory(a).discount).toBe(0.15);
            if (s.kind === 'intel') expect(s.text).toContain('Valdoria');
        }
    });

    it('a new player title is noticed once and liked', () => {
        const a = npc();
        const mem = NpcDisposition.getMemory(a);
        mem.timesSpoken = 2;
        mem.playerTitle = null;
        const before = mem.disposition;
        expect(NpcDisposition.notePlayerTitle(a, 'Baron').changed).toBe(true);
        expect(mem.disposition).toBe(before + 5);
        expect(NpcDisposition.notePlayerTitle(a, 'Baron').changed).toBe(false);
    });

    it('killing an NPC turns relatives against the player and binds the family', () => {
        NpcFamily.reset && NpcFamily.reset();
        const victim = { id: 1, name: 'Brom', spouseId: 2, childIds: [3], parentIds: [], siblingIds: [] };
        const spouse = { id: 2, name: 'Eva' };
        const child = { id: 3, name: 'Finn' };
        const stranger = { id: 4, name: 'Holt' };
        const all = [spouse, child, stranger];
        const res = NpcDisposition.onNpcHarmed(victim, all, 'murder');
        expect(res.affected.map(a => a.id).sort()).toEqual([2, 3]);
        expect(spouse._dialogMemory.disposition).toBeLessThan(10);
        expect(child._dialogMemory.grudge.severity).toBe('murder');
        expect(stranger._dialogMemory).toBeUndefined();
        expect(NpcFamily.getNpcRelationship(2, 3).score).toBeGreaterThan(0);
        expect(NpcDisposition.grudgeLine(spouse)).toContain('Brom');
    });
});

describe('Inventory cap', () => {
    const full = (n) => {
        const inv = {};
        for (let i = 0; i < n; i++) inv[`item_${i}`] = 1;
        return inv;
    };

    it('caps distinct kinds of goods at maxInventory; stacks are unlimited', () => {
        const p = { maxInventory: 3, inventory: full(3) };
        expect(PlayerInventory.addItem(p, 'grain', 5).success).toBe(false);
        expect(p.inventory.grain).toBeUndefined();
        expect(PlayerInventory.addItem(p, 'item_0', 500).success).toBe(true);
        expect(p.inventory.item_0).toBe(501);
        expect(PlayerInventory.addItem(p, 'grain', 5, { force: true }).success).toBe(true);
    });

    it('a mount and houses add slots', () => {
        const p = { maxInventory: 20, mount: { name: 'Bess' }, houses: [{}, {}] };
        expect(PlayerInventory.getCapacity(p)).toBe(20 + 5 + 6);
    });

    it('addItems reports what was left behind', () => {
        const p = { maxInventory: 2, inventory: full(1) };
        const r = PlayerInventory.addItems(p, { a: 1, b: 2, item_0: 3 });
        expect(r.full).toBe(true);
        expect(Object.keys(r.added).length).toBe(2);
        expect(Object.keys(r.dropped).length).toBe(1);
    });

    it('market purchases respect the cap without charging', () => {
        const p = { gold: 1000, maxInventory: 1, inventory: { bread: 3 }, skills: { commerce: 0 } };
        const good = { id: 'iron', price: 10, quantity: 50 };
        const r = Trading.buyGoods(p, good, 5, { marketStock: {} });
        expect(r.success).toBe(false);
        expect(r.inventoryFull).toBe(true);
        expect(p.gold).toBe(1000);
        const ok = Trading.buyGoods(p, { id: 'bread', price: 2, quantity: 50 }, 5, { marketStock: {} });
        expect(ok.success).toBe(true);
        expect(p.inventory.bread).toBe(8);
    });
});

describe('Legacy dynasty prestige', () => {
    it('folds player.dynasty.prestige into House Prestige once', () => {
        const player = { lastName: 'Vale', dynasty: { name: 'Vale', founded: 1, prestige: 12 } };
        House.initialize(player, { day: 3 });
        expect(House.getPrestige(player)).toBe(12);
        expect(player.dynasty.prestige).toBeUndefined();
        House.migrateLegacyPrestige(player);
        expect(House.getPrestige(player)).toBe(12);
    });

    it('migrates on load from an old save', () => {
        const player = { lastName: 'Stone', dynasty: { name: 'Stone', prestige: 5 } };
        House.deserialize(player, null, { prestige: 10 });
        expect(House.getPrestige(player)).toBe(15);
    });
});
