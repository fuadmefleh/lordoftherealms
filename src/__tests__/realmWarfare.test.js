/**
 * Kingdom wars have a lifecycle (goals, tribute, truces, persistent armies)
 * instead of a daily grind to extinction, fallen realms can rise again, and
 * the player can broker peace, campaign for a liege, and fund restorations.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { RealmPolitics, REALM_POLITICS } from '../player/realmPolitics.js';
import { PlayerEffects } from '../player/playerEffects.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function kingdom(id, extra = {}) {
    return {
        id, name: `Realm ${id}`, isAlive: true, territory: [], wars: [], allies: [], relations: {},
        military: 500, treasury: 1000, population: 10000, stability: 60, ...extra,
    };
}

/** A tiny two-realm world: A holds column 0-1, B holds column 2-3, each with one town. */
function makeWorld() {
    const tiles = {};
    const a = kingdom('A');
    const b = kingdom('B');
    for (let q = 0; q < 4; q++) {
        for (let r = 0; r < 3; r++) {
            const owner = q < 2 ? a : b;
            tiles[`${q},${r}`] = { q, r, kingdom: owner.id, terrain: { id: 'plains', passable: true } };
            owner.territory.push({ q, r });
        }
    }
    tiles['0,1'].settlement = { name: 'Aton', type: 'capital', kingdom: 'A', population: 5000 };
    tiles['3,1'].settlement = { name: 'Bury', type: 'capital', kingdom: 'B', population: 5000 };
    a.capital = { q: 0, r: 1 };
    b.capital = { q: 3, r: 1 };
    const world = {
        day: 10, width: 100, height: 100, events: [], kingdoms: [a, b], tiles,
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: (id) => [a, b].find(k => k.id === id) || null,
        getAllSettlements: () => Object.values(tiles).filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
    };
    return { world, a, b };
}

beforeEach(() => Utils.setSeed(4242));

describe('war lifecycle', () => {
    it('a war ends with tribute once the aggressor meets its goal, then a truce holds', () => {
        const { world, a, b } = makeWorld();
        KingdomAI.startWar(a, b, world);
        const st = KingdomAI._warState(a, b.id, world);
        st.gains = st.goal;
        KingdomAI._resolveWar(a, b, world);
        expect(a.wars).not.toContain(b.id);
        expect(a.treasury).toBe(1200); // 20% of B's 1000
        expect(b.treasury).toBe(800);
        expect(KingdomAI.hasTruce(a, b, world)).toBe(true);
        expect(world.warHistory.at(-1)).toMatchObject({ victor: 'A', tribute: 200 });
    });

    it('a realm only falls with its last town, and its court flees first', () => {
        const { world, a, b } = makeWorld();
        // B's capital sits on the border; a village lies behind it
        delete world.tiles['3,1'].settlement;
        world.tiles['2,1'].settlement = { name: 'Bury', type: 'capital', kingdom: 'B', population: 5000 };
        world.tiles['3,2'].settlement = { name: 'Bramble', type: 'village', kingdom: 'B', population: 300 };
        b.capital = { q: 2, r: 1 };
        KingdomAI.startWar(a, b, world);
        // Strip B down to its capital and the village
        b.territory = [{ q: 2, r: 1 }, { q: 3, r: 2 }];
        a.military = 100000;
        b.military = 1;
        let guard = 0;
        while (b.isAlive && guard++ < 200) KingdomAI.simulateBattle(a, b, world);
        expect(b.isAlive).toBe(false);
        expect(world.events.some(e => /court flees/.test(e.text))).toBe(true);
        expect(world.tiles['2,1'].settlement.formerKingdom).toBe('B');
        expect(a.wars).not.toContain('B');
    });

    it('armies rebuild over time instead of resetting every day', () => {
        const { world, a } = makeWorld();
        KingdomAI.updateMilitary(a, world);
        const cap = a.military;
        a.military = Math.floor(cap / 2);
        KingdomAI.updateMilitary(a, world);
        expect(a.military).toBeGreaterThan(cap / 2);
        expect(a.military).toBeLessThan(cap);
    });

    it('no new war while a truce holds', () => {
        const { world, a, b } = makeWorld();
        a.relations.B = -90;
        KingdomAI.endWar(a, b, world);
        a.relations.B = -90;
        for (let i = 0; i < 50; i++) KingdomAI.considerWar(a, world);
        expect(a.wars).not.toContain('B');
    });

    it('a fallen realm can be restored in its old town', () => {
        const { world, a, b } = makeWorld();
        b.isAlive = false;
        b.conqueredDay = 0;
        b.territory = [];
        for (const t of Object.values(world.tiles)) {
            t.kingdom = 'A';
            if (t.settlement && t.settlement.kingdom === 'B') { t.settlement.kingdom = 'A'; t.settlement.formerKingdom = 'B'; }
        }
        const tile = world.tiles['3,1'];
        KingdomAI.restoreKingdom(b, a, { q: 3, r: 1, tile }, world);
        expect(b.isAlive).toBe(true);
        expect(tile.settlement.kingdom).toBe('B');
        expect(b.territory.length).toBeGreaterThan(0);
        expect(b.wars).toContain('A');
    });
});

describe('the player in the wars of the realm', () => {
    function player(extra = {}) {
        return { name: 'Hero', gold: 2000, renown: 0, reputation: {}, skills: { diplomacy: 5, stealth: 3, combat: 3, leadership: 3 }, army: [], ...extra };
    }

    it('lists wars with progress toward each goal', () => {
        const { world, a, b } = makeWorld();
        KingdomAI.startWar(a, b, world);
        const wars = RealmPolitics.activeWars(world);
        expect(wars).toHaveLength(1);
        expect(wars[0].aGoal).toBeGreaterThan(0);
    });

    it('brokering peace costs a fee and either ends the war or sets a cooldown', () => {
        const { world, a, b } = makeWorld();
        KingdomAI.startWar(a, b, world);
        const p = player();
        const res = RealmPolitics.brokerPeace(p, world, 'A', 'B');
        expect(res.success).toBe(true);
        expect(p.gold).toBe(2000 - REALM_POLITICS.broker.fee);
        if (res.failed) {
            expect(RealmPolitics.brokerPeace(p, world, 'A', 'B').success).toBe(false); // cooldown
        } else {
            expect(a.wars).not.toContain('B');
            expect(p.renown).toBe(REALM_POLITICS.broker.renown);
        }
    });

    it('a campaign victory advances the liege and pays a share of the tribute when it wins', () => {
        const { world, a, b } = makeWorld();
        KingdomAI.startWar(a, b, world);
        const p = player({ allegiance: 'A' });
        for (let i = 0; i < 8; i++) p.army.push({ type: 'knight', name: 'Knight', strength: 40, level: 3, experience: 0, upkeep: 1 });
        b.military = 100; // a weak enemy vanguard
        let wins = 0;
        for (let i = 0; i < 5; i++) {
            const res = RealmPolitics.joinCampaign(p, world, 'B');
            if (res.battle && res.battle.victory) wins++;
        }
        expect(wins).toBeGreaterThan(0);
        expect(KingdomAI._warState(a, 'B', world).gains).toBe(wins);

        const goldBefore = p.gold;
        KingdomAI.endWar(a, b, world, { victor: a });
        const spoils = RealmPolitics.processDaily(p, world);
        expect(spoils).toHaveLength(1);
        expect(p.gold).toBeGreaterThan(goldBefore);
        // paid once only
        expect(RealmPolitics.processDaily(p, world)).toHaveLength(0);
    });

    it('funding a restoration needs a fallen realm and is refused to the sworn', () => {
        const { world, a, b } = makeWorld();
        b.isAlive = false;
        b.conqueredDay = 0;
        const tile = world.tiles['3,1'];
        tile.settlement.kingdom = 'A';
        tile.settlement.formerKingdom = 'B';
        const sworn = player({ allegiance: 'A' });
        expect(RealmPolitics.fundRestoration(sworn, world, tile).success).toBe(false);

        const p = player();
        const t = RealmPolitics.restorationTarget(p, world, tile);
        expect(t.cost).toBe(REALM_POLITICS.restoration.cost.capital);
        const res = RealmPolitics.fundRestoration(p, world, tile);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(2000 - t.cost);
        if (!res.failed) expect(b.isAlive).toBe(true);
    });

    it("merchants of your liege's enemy charge more", () => {
        const { world, a, b } = makeWorld();
        KingdomAI.startWar(a, b, world);
        const p = player({ allegiance: 'A' });
        RealmPolitics.refreshLiegeRelations(p, world);
        expect(PlayerEffects.liegeTradeModifier(p, 'B')).toBeLessThan(0);
        expect(PlayerEffects.liegeTradeModifier(p, 'A')).toBe(0);
        expect(PlayerEffects.liegeTradeModifier(player(), 'B')).toBe(0);
    });
});
