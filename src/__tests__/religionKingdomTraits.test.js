// Hollow-mechanics fixes: the player's religion tenets and influence, the
// Missionary colony policy, kingdom temple unity, kingdom traits,
// preferredTerrain ids and the militaristic AI personality.
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Religion } from '../systems/religion.js';
import { Technology } from '../systems/technology.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Colonization } from '../world/colonization.js';
import { Kingdom } from '../world/kingdom.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses, KingdomStability } from '../world/kingdomState.js';
import { Terrain } from '../world/terrain.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const faithful = (tenets, extra = {}) => ({
    gold: 0, karma: 0, renown: 0, faith: 0, q: 0, r: 0,
    religion: { name: 'Light', tenets, followers: 0, buildings: [], influence: 0, presence: {} },
    ...extra,
});

/** A sparse world keyed by "q,r". */
function sparseWorld(tiles, kingdoms = []) {
    const map = {};
    for (const t of tiles) map[`${t.q},${t.r}`] = t;
    return {
        day: 1, width: 100, height: 100, events: [], kingdoms,
        getTile: (q, r) => map[`${q},${r}`] || null,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
    };
}

const town = (q, r, kingdom = 'k1', population = 1000) => ({ q, r, terrain: { passable: true }, settlement: { name: `T${q}${r}`, population, kingdom } });

// ─────────────────────────────────────────────
describe('player religion tenets', () => {
    it('every tenet has a summary and only effect keys something reads', () => {
        const known = ['conversion', 'faithIncome', 'karmaPerDay', 'reputationGain', 'kingdomRelations', 'research',
            'kingdomStability', 'battlePower', 'casualties', 'upkeep', 'propertyIncome', 'farmYield', 'negotiation', 'miracleCost'];
        const tenets = PlayerReligion.getTenetOptions();
        expect(tenets.map(t => t.id).sort()).toEqual(['Charity', 'Humility', 'Justice', 'Mysticism', 'Nature', 'Peace', 'Prosperity', 'Sovereignty', 'Valor', 'Wisdom']);
        for (const t of tenets) {
            expect(t.summary.length).toBeGreaterThan(5);
            const fx = Religion.PLAYER_TENETS[t.id].effects;
            expect(Object.keys(fx).length).toBeGreaterThan(0);
            for (const key of Object.keys(fx)) expect(known).toContain(key);
        }
    });

    it('no religion or no tenets means no effect', () => {
        expect(Religion.tenetBonus(null, 'research')).toBe(0);
        expect(Religion.tenetBonus({ name: 'x' }, 'research')).toBe(0);
        expect(PlayerEffects.farmProductionMultiplier({})).toBe(1);
        expect(PlayerEffects.faithBattleMultiplier({})).toBe(1);
    });

    it('Charity converts faster but tithes less; Prosperity tithes more', () => {
        const tiles = [{ q: 0, r: 0, terrain: { passable: true } }, town(1, 0, 'k1', 10000)];
        const spread = (tenets) => {
            const world = sparseWorld(JSON.parse(JSON.stringify(tiles)));
            const p = faithful(tenets, { gold: 10000 });
            PlayerReligion.buildReligiousBuilding(p, 'TEMPLE', world.getTile(0, 0), world);
            world.getTile(0, 0).religiousBuilding.underConstruction = false;
            return PlayerReligion.spreadFaith(p, world);
        };
        expect(spread(['Charity'])).toBeGreaterThan(spread(['Wisdom']));

        const income = (tenets) => { const p = faithful(tenets); p.religion.followers = 1000; return PlayerReligion.getFaithIncome(p); };
        expect(income([])).toBe(10);
        expect(income(['Charity'])).toBe(7);
        expect(income(['Prosperity'])).toBe(12);
    });

    it('Mysticism makes miracles cheaper', () => {
        const p = faithful(['Mysticism'], { karma: 9, health: 10, maxHealth: 100, faith: 0 });
        expect(PlayerReligion.miracleCost(p, PlayerReligion.MIRACLES.HEALING)).toBe(8);
        const res = PlayerReligion.performMiracle(p, 'healing');
        expect(res.success).toBe(true);
        expect(p.karma).toBe(1);
        expect(PlayerReligion.miracleCost(faithful([]), PlayerReligion.MIRACLES.HEALING)).toBe(10);
    });

    it('Nature, Prosperity, Valor, Peace and Sovereignty reach the player effect hub', () => {
        expect(PlayerEffects.farmProductionMultiplier(faithful(['Nature']))).toBeCloseTo(1.15);
        expect(PlayerEffects.propertyIncomeMultiplier(faithful(['Prosperity']))).toBeCloseTo(1.05);
        expect(PlayerEffects.casualtyMultiplier(faithful(['Valor']))).toBeCloseTo(0.9);
        expect(PlayerEffects.faithBattleMultiplier(faithful(['Valor']))).toBeCloseTo(1.05);
        expect(PlayerEffects.reputationGainMultiplier(faithful(['Peace'])) / PlayerEffects.reputationGainMultiplier(faithful([]))).toBeCloseTo(1.1);
        expect(PlayerEffects.negotiationBonus(faithful(['Sovereignty'])) - PlayerEffects.negotiationBonus(faithful([]))).toBeCloseTo(0.05);
    });

    it('Humility trims army upkeep; Wisdom speeds research', () => {
        const army = () => [{ upkeep: 10 }, { upkeep: 10 }];
        expect(PlayerMilitary.getUpkeepCost(faithful([], { army: army() }))).toBe(20);
        expect(PlayerMilitary.getUpkeepCost(faithful(['Humility'], { army: army() }))).toBe(18);

        const base = Technology.getResearchBonus(faithful([]));
        expect(Technology.getResearchBonus(faithful(['Wisdom'])) - base).toBeCloseTo(0.10);
    });

    it('Charity and Humility grant karma day by day', () => {
        const p = faithful(['Charity']);
        const world = sparseWorld([]);
        PlayerReligion.processDaily(p, world);
        expect(p.karma).toBe(0);
        PlayerReligion.processDaily(p, world);
        expect(p.karma).toBe(1);
    });
});

// ─────────────────────────────────────────────
describe('player religion influence', () => {
    it('influence has diminishing returns and raises conversion and tithes', () => {
        const p = faithful([]);
        expect(PlayerReligion.influenceFactor(p)).toBe(0);
        p.religion.influence = 100;
        expect(PlayerReligion.influenceFactor(p)).toBeCloseTo(0.5);
        expect(PlayerReligion.conversionMultiplier(p)).toBeCloseTo(1.25);
        p.religion.followers = 1000;
        expect(PlayerReligion.getFaithIncome(p)).toBe(12); // 10 × 1.25
    });

    it('buildings and sermons win over a share of each town', () => {
        const world = sparseWorld([{ q: 0, r: 0, terrain: { passable: true } }, town(1, 0)]);
        const p = faithful([], { gold: 10000 });
        PlayerReligion.buildReligiousBuilding(p, 'SHRINE', world.getTile(0, 0), world);
        world.getTile(0, 0).religiousBuilding.underConstruction = false;
        PlayerReligion.spreadFaith(p, world);
        const share = Religion.getPresence(p.religion, 1, 0);
        expect(share).toBeGreaterThan(0);
        p.charisma = 0;
        PlayerReligion.preach(p, world.getTile(1, 0).settlement, world.getTile(1, 0));
        expect(Religion.getPresence(p.religion, 1, 0)).toBeGreaterThan(share);
    });

    it('devoted towns spread the faith, warm their realm and (with Justice) steady it', () => {
        const k1 = { id: 'k1', isAlive: true, religion: { faithId: 'solaris' } };     // militancy 1
        const world = sparseWorld([town(0, 0), town(2, 0), town(10, 10)], [k1]);
        const p = faithful(['Justice', 'Sovereignty'], { reputation: {} });
        p.religion.presence['0,0'] = 0.5;
        for (let d = 0; d < 10; d++) PlayerReligion.processDaily(p, world);
        // The neighbour 2 hexes away is being won over; the far town isn't
        expect(Religion.getPresence(p.religion, 2, 0)).toBeGreaterThan(0);
        expect(Religion.getPresence(p.religion, 10, 10)).toBe(0);
        // 0.1 × (1 + Sovereignty 1.0) = 0.2 a day → 2 reputation in 10 days
        expect(p.reputation.k1).toBe(2);
        expect(k1.playerFaith).toEqual({ devoted: 1, stability: 1 });
        const target = KingdomStability.target(k1, world);
        expect(target.parts.some(x => x.label === 'Faithful towns' && x.value === 1)).toBe(true);
    });

    it('zealous realms resent a rival faith in their towns', () => {
        const k1 = { id: 'k1', isAlive: true, religion: { faithId: 'ironfaith' } }; // militancy 3
        const world = sparseWorld([town(0, 0)], [k1]);
        const p = faithful([], { reputation: { k1: 10 } });
        p.religion.presence['0,0'] = 0.9;
        for (let d = 0; d < 20; d++) PlayerReligion.processDaily(p, world);
        expect(p.reputation.k1).toBe(9);
        expect(k1.playerFaith.stability).toBe(0); // no Justice tenet
    });

    it('a devoted town gives the player better prices', () => {
        const p = faithful([]);
        p.religion.presence['3,4'] = 0.3;
        expect(PlayerEffects.faithTradeBonus(p, { q: 3, r: 4 })).toBeCloseTo(0.05);
        expect(PlayerEffects.faithTradeBonus(p, { q: 5, r: 4 })).toBe(0);
        // A live settlement object has no coordinates — use where the player stands
        expect(PlayerEffects.faithTradeBonus({ ...p, q: 3, r: 4 }, { name: 'x' })).toBeCloseTo(0.05);
    });
});

// ─────────────────────────────────────────────
describe('Missionary colony policy', () => {
    function colonyWorld(policy, isPlayerColony = true) {
        const colonyTile = town(0, 0, 'k1', 200);
        colonyTile.settlement.colony = { loyalty: 60, policy, isPlayerColony, garrisonStrength: 0 };
        const tribe = { q: 2, r: 0, terrain: { passable: true }, indigenous: { name: 'Folk', population: 100, relation: 0, hostility: 0.3 } };
        const kingdom = {
            id: 'k1', isAlive: true, capital: { q: 0, r: 1 }, territory: [],
            cultureData: { influence: 10, scholarship: 10 }, religion: { name: 'Solar', piety: 40 },
            colonization: { policy: 'coexistence', colonies: [{ q: 0, r: 0 }] },
        };
        const world = sparseWorld([colonyTile, tribe, town(3, 0, 'k2', 500)], [kingdom]);
        return { world, kingdom, colony: colonyTile.settlement.colony, ind: tribe.indigenous };
    }

    it('is defined in data and Coexistence has no missionary work', () => {
        expect(Colonization.POLICIES.missionary.missionaryWork).toBeTruthy();
        expect(Colonization.POLICIES.coexistence.missionaryWork).toBeUndefined();
    });

    it("a player's mission spreads their faith to towns and tribes", () => {
        const { world, kingdom, colony, ind } = colonyWorld('missionary');
        const player = faithful([]);
        for (let d = 0; d < 30; d++) Colonization.processKingdomColonies(kingdom, world, {}, player);
        expect(ind.relation).toBeGreaterThan(1);
        expect(ind.faith).toBe('Light');
        expect(ind.converted).toBeGreaterThan(0.2);
        expect(player.religion.followers).toBe(60); // 100 × 0.02 × 30
        expect(Religion.getPresence(player.religion, 3, 0)).toBeGreaterThan(0.05);
        expect(Religion.getPresence(player.religion, 0, 0)).toBeGreaterThan(0.05);
        expect(colony.missionary).toMatchObject({ tribes: 1, settlements: 2, faith: 'Light', converts: 60 });
        // The mother kingdom's culture and faith carry further
        expect(kingdom.cultureData.influence).toBeCloseTo(10.3);
        expect(kingdom.religion.piety).toBeCloseTo(40.3);
    });

    it('other policies do none of that', () => {
        const { world, kingdom, ind } = colonyWorld('coexistence');
        const player = faithful([]);
        for (let d = 0; d < 30; d++) Colonization.processKingdomColonies(kingdom, world, {}, player);
        expect(player.religion.followers).toBe(0);
        expect(ind.converted).toBeUndefined();
        expect(kingdom.cultureData.influence).toBe(10);
    });

    it("an AI realm's mission spreads the realm's own faith; religious realms send missions", () => {
        const { world, kingdom, ind } = colonyWorld('missionary', false);
        Colonization.processKingdomColonies(kingdom, world, {}, null);
        expect(ind.faith).toBe('Solar');
        expect(Colonization.defaultPolicy({ traits: ['religious', 'scholarly'] })).toBe('missionary');
        expect(Colonization.defaultPolicy({ traits: ['mercantile'] })).toBe('coexistence');
    });
});

// ─────────────────────────────────────────────
describe('kingdom temple unity', () => {
    it('temples add unity, capped', () => {
        expect(Religion.templeUnity({ temples: [] })).toBe(0);
        expect(Religion.templeUnity({ temples: [{ type: 'chapel' }, { type: 'cathedral' }] })).toBeCloseTo(6.5);
        expect(Religion.templeUnity({ temples: Array(20).fill({ type: 'cathedral' }) })).toBe(15);
        expect(KingdomAI.templeEffects({ temples: [{ type: 'monastery_npc' }] }).unity).toBeCloseTo(2.5);
    });

    it("the realm's unity (and so its stability) rises with its temples", () => {
        const make = (temples) => ({
            id: 'k', isAlive: true, treasury: 0, relations: {}, temples,
            religion: { faithId: 'solaris', piety: 50, unity: 50, heresies: [], holySites: [] },
        });
        const run = (k) => {
            Utils.setSeed(5);
            Religion.processTurn({ kingdoms: [k], events: [], getTile: () => null, getKingdom: () => null });
            return k.religion.unity;
        };
        const plain = make([]);
        const devout = make([{ type: 'cathedral' }]);
        expect(run(devout) - run(plain)).toBeCloseTo(5);
        devout.stability = plain.stability = 60;
        const world = { activeEvents: [] };
        expect(KingdomStability.target(devout, world).value).toBeGreaterThan(KingdomStability.target(plain, world).value);
    });
});

// ─────────────────────────────────────────────
describe('kingdom traits', () => {
    it('every trait a kingdom can have does something readable', () => {
        const traits = new Set();
        for (const k of Kingdom.DEFAULTS) for (const t of k.traits) traits.add(t);
        ['militaristic', 'orderly', 'peaceful', 'nature-loving', 'aggressive', 'mobile', 'religious', 'scholarly',
            'mercantile', 'naval', 'defensive', 'industrious', 'secretive', 'alchemical', 'arcane', 'seafaring', 'resilient']
            .forEach(t => traits.add(t));
        for (const t of traits) {
            const def = KingdomBonuses.TRAITS[t];
            expect(def, t).toBeTruthy();
            expect(def.summary.length).toBeGreaterThan(5);
            for (const key of Object.keys(def.bonuses)) expect(KingdomBonuses.LABELS[key], `${t}.${key}`).toBeTruthy();
        }
    });

    it('traits feed KingdomBonuses and so stability, research and war', () => {
        expect(KingdomBonuses.get({ traits: ['scholarly'] }, 'research')).toBeCloseTo(0.25);
        expect(KingdomBonuses.get({ traits: ['scholarly', 'arcane'] }, 'research')).toBeCloseTo(0.45);
        expect(KingdomBonuses.get({ traits: ['defensive'] }, 'defense')).toBeCloseTo(0.15);
        const world = { activeEvents: [] };
        const orderly = KingdomStability.target({ id: 'a', traits: ['orderly'], treasury: 100 }, world).value;
        const plain = KingdomStability.target({ id: 'b', traits: [], treasury: 100 }, world).value;
        expect(orderly - plain).toBeCloseTo(6);
        expect(KingdomBonuses.describeTraits({ traits: ['orderly'] })[0]).toMatchObject({ id: 'orderly', label: 'Orderly' });
    });

    it('trait-driven army composition (mobile → cavalry, naval → archers)', () => {
        const base = KingdomAI._getKingdomComposition({ traits: [] });
        expect(KingdomAI._getKingdomComposition({ traits: ['mobile'] }).cavalry).toBeGreaterThan(base.cavalry);
        expect(KingdomAI._getKingdomComposition({ traits: ['naval'] }).archer).toBeGreaterThan(base.archer);
        expect(KingdomAI._getKingdomComposition({ traits: [], culture: 'Nomadic' }).cavalry).toBeGreaterThan(base.cavalry);
    });
});

// ─────────────────────────────────────────────
describe('preferredTerrain', () => {
    const terrainIds = () => new Set(Object.values(Terrain.TYPES).map(t => t.id));

    it('every preferred and placement terrain id is a real terrain', () => {
        const ids = terrainIds();
        for (const k of Kingdom.DEFAULTS) {
            for (const id of k.preferredTerrain) expect(ids.has(id), `${k.id}: ${id}`).toBe(true);
            for (const id of k.placementTerrain || []) {
                expect(ids.has(id), `${k.id}: ${id}`).toBe(true);
                expect(k.preferredTerrain).toContain(id);
            }
        }
    });

    it('expansion claims favoured terrain first', () => {
        const grass = { id: 'grassland', passable: true };
        const swamp = { id: 'swamp', passable: true };
        const tiles = {};
        const put = (q, r, terrain, kingdom = null) => { tiles[`${q},${r}`] = { q, r, terrain, kingdom }; };
        put(5, 5, grass, 'k');
        // Every neighbour is grassland except one swamp
        let first = true;
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
            put(5 + dq, 5 + dr, first ? swamp : grass);
            first = false;
        }
        const world = { getTile: (q, r) => tiles[`${q},${r}`] || null };
        for (let i = 0; i < 5; i++) {
            const k = { id: 'k', capital: { q: 5, r: 5 }, territory: [{ q: 5, r: 5 }], preferredTerrain: ['swamp'], culture: 'Swamp' };
            tiles['6,5'].kingdom = null;
            Utils.setSeed(i);
            KingdomAI.tryExpand(k, world);
            expect(k.territory[1]).toEqual({ q: 6, r: 5 });
        }
    });

    it('a realm fights better on its home ground', () => {
        expect(KingdomAI.homeGroundMultiplier({ preferredTerrain: ['hills'] }, 'hills')).toBeCloseTo(1.08);
        expect(KingdomAI.homeGroundMultiplier({ preferredTerrain: ['hills'] }, 'swamp')).toBe(1);
    });
});

// ─────────────────────────────────────────────
describe('militaristic AI personality', () => {
    it('is selectable from traits without randomness', () => {
        expect(KingdomAI.personalityId({ traits: ['militaristic', 'orderly'] })).toBe('militaristic');
        expect(KingdomAI.personalityId({ traits: ['militaristic', 'aggressive'] })).toBe('aggressive');
        expect(KingdomAI.personalityId({ traits: ['aggressive', 'mobile'] })).toBe('aggressive');
        expect(KingdomAI.personalityId({})).toBe('balanced');
        const valdoria = Kingdom.DEFAULTS.find(k => k.id === 'valdoria');
        expect(KingdomAI.getPersonality(valdoria)).toBe(KingdomAI.PERSONALITIES.militaristic);
        expect(KingdomAI.PERSONALITIES.militaristic.label).toBe('Militaristic');
    });

    it('keeps a larger standing army that rebuilds faster', () => {
        const world = { getAllSettlements: () => [], activeEvents: [], getTile: () => null };
        const make = (traits) => ({ id: 'x', traits, population: 10000, _militaryInit: true, military: 0 });
        const mil = make(['militaristic']);
        const bal = make([]);
        KingdomAI.updateMilitary(mil, world);
        KingdomAI.updateMilitary(bal, world);
        expect(mil.militaryCap).toBeGreaterThan(bal.militaryCap);
        // regen: 4% × 1.5 of a larger gap
        expect(mil.military).toBe(Math.floor(mil.militaryCap * 0.06));
        expect(bal.military).toBe(Math.floor(bal.militaryCap * 0.04));
    });

    it('marches only when at least as strong (balanced realms accept 80%)', () => {
        const mk = (id, traits, military) => ({
            id, traits, military, population: 0, isAlive: true, allies: [], wars: [], relations: {}, territory: [],
        });
        const attempt = (traits) => {
            const a = mk('a', traits, 90);
            const b = mk('b', [], 100);
            a.relations.b = -80;
            const world = { kingdoms: [a, b], events: [], day: 121 }; // day 1 of the second year: past the realms' first peace
            // Seed so the reckless roll fails for both (0.1 and 0.02 thresholds)
            Utils.setSeed(3);
            KingdomAI.considerWar(a, world);
            return a.wars.includes('b');
        };
        expect(attempt([])).toBe(true);
        expect(attempt(['militaristic'])).toBe(false);
    });

    it('defaults keep the other personalities unchanged', () => {
        expect(KingdomAI.personalityValue({ traits: ['peaceful'] }, 'warRatio')).toBe(0.8);
        expect(KingdomAI.personalityValue({ traits: ['peaceful'] }, 'armySize')).toBe(1);
        expect(KingdomAI.personalityValue({ traits: ['militaristic'] }, 'sueChance')).toBe(0.5);
    });
});
