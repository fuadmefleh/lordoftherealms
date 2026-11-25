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

    it('either side of a war can take the field, by its share of the armies — not the realm listed first', () => {
        const { world, a, b } = makeWorld();
        // Even armies: both sides attack about half the time
        const count = (ka, kb, n = 2000) => {
            let first = 0;
            for (let i = 0; i < n; i++) if (KingdomAI.battleInitiative(ka, kb)[0] === ka) first++;
            return first / n;
        };
        expect(count(a, b)).toBeGreaterThan(0.45);
        expect(count(a, b)).toBeLessThan(0.55);
        // A far stronger realm presses most battles, but never all (WAR.initiative)
        b.military = 5000;
        const [lo, hi] = KingdomAI.WAR.initiative;
        expect(count(b, a)).toBeGreaterThan(hi - 0.05);
        expect(count(a, b)).toBeGreaterThan(lo - 0.05);
        expect(count(a, b)).toBeLessThan(lo + 0.05);
        // ...and the war's battles go both ways: the realm late in world.kingdoms
        // (B) wins ground off the first one when it is the stronger
        KingdomAI.startWar(a, b, world);
        let guard = 0;
        while (a.isAlive && (b.wars || []).includes('A') && guard++ < 400) KingdomAI.processWars(world);
        expect(b.territory.length).toBeGreaterThan(6);
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

    it('old towns rise more readily under a restless occupier, never under a content one', () => {
        expect(KingdomAI.restorationChance({ stability: 90 })).toBe(0);
        const calm = KingdomAI.restorationChance({ stability: 60 });
        const restless = KingdomAI.restorationChance({ stability: 30 });
        expect(calm).toBeGreaterThan(0);
        expect(restless).toBeGreaterThan(calm);
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

describe('the limits every aggressor keeps (KingdomAI.mayOpenWar)', () => {
    function threeRealms() {
        const { world, a, b } = makeWorld();
        const c = kingdom('C');
        const d = kingdom('D');
        world.kingdoms.push(c, d);
        world.getKingdom = (id) => world.kingdoms.find(k => k.id === id) || null;
        world.day = 1000; // past the founding peace
        return { world, a, b, c, d };
    }

    it('a realm already fighting maxWarsOn wars is not set upon by a third', () => {
        const { world, a, b, c, d } = threeRealms();
        expect(KingdomAI.mayOpenWar(a, b, world)).toBe(true);
        KingdomAI.startWar(c, b, world);
        world.day += KingdomAI.WAR.besetDays;
        KingdomAI.startWar(d, b, world);
        world.day += KingdomAI.WAR.besetDays;
        expect(b.wars).toHaveLength(KingdomAI.WAR.maxWarsOn);
        expect(KingdomAI.mayOpenWar(a, b, world)).toBe(false);
        // (a crusade or a league may bring one more)
        expect(KingdomAI.mayOpenWar(a, b, world, { maxOn: KingdomAI.WAR.maxWarsOn + 1 })).toBe(true);
    });

    it('a war declared of late keeps the other courts back a while', () => {
        const { world, a, b, c } = threeRealms();
        KingdomAI.startWar(c, b, world);
        expect(KingdomAI.mayOpenWar(a, b, world)).toBe(false);
        world.day += KingdomAI.WAR.besetDays;
        expect(KingdomAI.mayOpenWar(a, b, world)).toBe(true);
    });

    it('war weariness: a realm whose war just ended does not open another at once, the longer the war the longer', () => {
        const { world, a, b, c } = threeRealms();
        KingdomAI.startWar(a, b, world);
        world.day += 200;
        KingdomAI.endWar(a, b, world);
        const W = KingdomAI.WAR;
        expect(a.restUntil).toBe(world.day + Math.round(W.restDays + Math.min(W.restMax, 200 * W.restPerWarDay)));
        expect(KingdomAI.mayOpenWar(a, c, world)).toBe(false);
        expect(KingdomAI.mayOpenWar(a, c, world, { rested: false })).toBe(true);
        world.day = a.restUntil;
        expect(KingdomAI.mayOpenWar(a, c, world)).toBe(true);
        // (the truce with the old foe still holds)
        expect(KingdomAI.mayOpenWar(a, b, world)).toBe(false);
    });

    it('a war won sates the victor: its regard for the loser no longer calls for war', () => {
        const { world, a, b } = threeRealms();
        KingdomAI.startWar(a, b, world);
        KingdomAI.endWar(a, b, world, { victor: a });
        expect(a.relations[b.id]).toBe(KingdomAI.WAR.sated);
        expect(b.relations[a.id]).toBe(-40);
    });
});
