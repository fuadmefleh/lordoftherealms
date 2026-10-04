/**
 * The Peoples' flavour is real: values, traits, art forms, diaspora status,
 * homeland, cuisine, customs, quarters, hybrid traditions, evolution stage
 * and origin lore (data/peoples.json) all feed small modifiers that the
 * economy, recruitment, taxes, festivals, taverns, trade prices and the
 * kingdom AI actually read.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Peoples } from '../systems/peoples.js';
import { Festivals } from '../systems/festivals.js';
import { Taxation } from '../systems/marketDynamics.js';
import { Economy } from '../world/economy.js';
import { KingdomBonuses, KingdomStability } from '../world/kingdomState.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Tavern } from '../player/tavern.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const T = id => Peoples.TRIBAL_ROOTS[id];

/** A settlement made of the given [tribeId, share, extra] groups. */
function makeSettlement(groups, extra = {}) {
    const population = extra.population || 2000;
    const demographics = groups.map(([id, share, more = {}]) => ({
        tribe: T(id),
        share,
        population: Math.round(population * share),
        status: 'founding',
        sentiment: 60,
        influence: 50,
        ...more,
    }));
    return {
        name: extra.name || 'Testholm',
        type: extra.type || 'town',
        kingdom: extra.kingdom || 'k1',
        population,
        demographics,
        culturalHarmony: extra.culturalHarmony ?? 50,
        culturalIdentity: extra.culturalIdentity || null,
        culturalQuarters: extra.culturalQuarters || [],
        hybridTraditions: extra.hybridTraditions || [],
    };
}

/** A flat fake world of one terrain with the given settlements placed on it. */
function makeWorld(settlements = [], { terrain = 'plains', kingdoms = [{ id: 'k1', name: 'Kingdom One', isAlive: true }] } = {}) {
    const tiles = {};
    const key = (q, r) => `${q},${r}`;
    const world = {
        day: 1,
        year: 900,
        kingdoms,
        events: [],
        history: [],
        tribalHistory: [],
        getTile(q, r) {
            if (q < 0 || r < 0 || q > 30 || r > 30) return null;
            if (!tiles[key(q, r)]) tiles[key(q, r)] = { q, r, terrain: { id: terrain, passable: true } };
            return tiles[key(q, r)];
        },
        getKingdom(id) { return kingdoms.find(k => k.id === id) || null; },
        getAllSettlements() {
            const out = [];
            for (const t of Object.values(tiles)) if (t.settlement) out.push({ q: t.q, r: t.r, ...t.settlement });
            return out;
        },
    };
    settlements.forEach((s, i) => { world.getTile(5 + i * 4, 5).settlement = s; });
    return world;
}

beforeEach(() => Utils.setSeed(1234));

describe('effect tables load from data/peoples.json', () => {
    it('every value and trait of every people maps to an aspect', () => {
        const E = Peoples.EFFECTS;
        expect(E && E.aspects).toBeTruthy();
        for (const tribe of Object.values(Peoples.TRIBAL_ROOTS)) {
            for (const v of Object.keys(tribe.values)) expect(E.valueAspects[v], `${tribe.id} value ${v}`).toBeTruthy();
            for (const t of tribe.traits) expect(E.traitAspects[t], `${tribe.id} trait ${t}`).toBeTruthy();
            for (const a of tribe.artForms) expect(Peoples.artAspect(a), `${tribe.id} art ${a}`).toBeTruthy();
        }
    });

    it('art forms are classified by word, not substring', () => {
        expect(Peoples.artAspect('metalwork')).toBe('goods');
        expect(Peoples.artAspect('war chants')).toBe('martial');
        expect(Peoples.artAspect('thorn fence weaving')).toBe('goods'); // not "horn" music
        expect(Peoples.artAspect('gemstone enchanting')).toBe('goods'); // not "chant"
        expect(Peoples.artAspect('celestial cartography')).toBe('learning');
    });
});

describe('values, traits, art forms and status → aspects', () => {
    it('craftsmen make goods, sailweavers trade, shieldfolk fight', () => {
        const forge = Peoples.computeEffects(makeSettlement([['ironborn', 0.8], ['crystalsmiths', 0.2]]));
        expect(forge.goods).toBeGreaterThan(0.03);
        expect(forge.goods).toBeLessThanOrEqual(Peoples.EFFECTS.aspects.goods.max);

        const port = Peoples.computeEffects(makeSettlement([['sailweavers', 1]]));
        expect(port.trade).toBeGreaterThan(0.05);

        const march = Peoples.computeEffects(makeSettlement([['shieldfolk', 1]]));
        expect(march.martial).toBeGreaterThan(0.05);
        expect(march.why.martial.join(' ')).toMatch(/Shieldfolk/);
    });

    it('effects scale with a people\'s share and are clamped', () => {
        const big = Peoples.computeEffects(makeSettlement([['ironborn', 0.9], ['shieldfolk', 0.1]]));
        const small = Peoples.computeEffects(makeSettlement([['shieldfolk', 0.9], ['ironborn', 0.1]]));
        expect(big.goods).toBeGreaterThan(small.goods);
        const all = Peoples.computeEffects(makeSettlement([['ironborn', 5]]));
        expect(all.goods).toBe(Peoples.EFFECTS.aspects.goods.max);
    });

    it('volatile and restless traits cost order; exiles too', () => {
        const calm = Peoples.computeEffects(makeSettlement([['mosswalkers', 1]]));
        const hot = Peoples.computeEffects(makeSettlement([['embersmiths', 1]]));
        expect(calm.stability).toBeGreaterThan(hot.stability);
        const exiled = Peoples.computeEffects(makeSettlement([['mosswalkers', 0.7], ['embersmiths', 0.3, { status: 'exile' }]]));
        const welcomed = Peoples.computeEffects(makeSettlement([['mosswalkers', 0.7], ['embersmiths', 0.3, { status: 'immigrant' }]]));
        expect(exiled.stability).toBeLessThan(welcomed.stability);
        expect(welcomed.growth).toBeGreaterThan(exiled.growth);
    });

    it('diaspora traders and pilgrims bring commerce and faith', () => {
        const base = Peoples.computeEffects(makeSettlement([['ironborn', 0.9], ['frostborn', 0.1]]));
        const traders = Peoples.computeEffects(makeSettlement([['ironborn', 0.9], ['frostborn', 0.1, { status: 'trader' }]]));
        const pilgrims = Peoples.computeEffects(makeSettlement([['ironborn', 0.9], ['frostborn', 0.1, { status: 'pilgrim' }]]));
        expect(traders.trade).toBeGreaterThan(base.trade);
        expect(pilgrims.faith).toBeGreaterThan(base.faith);
    });

    it('signature art and thriving quarters add; restless quarters cost order', () => {
        const plain = makeSettlement([['crownlanders', 1]]);
        const famous = makeSettlement([['crownlanders', 1]], { culturalIdentity: { signatureArt: 'metalwork' } });
        expect(Peoples.computeEffects(famous).goods).toBeGreaterThan(Peoples.computeEffects(plain).goods);

        const q = mood => makeSettlement([['crownlanders', 1]], {
            culturalQuarters: [{ name: 'Anvil Row', tribe: 'crownlanders', specialty: 'metalwork', mood }],
        });
        expect(Peoples.computeEffects(q('thriving')).goods).toBeGreaterThan(Peoples.computeEffects(q('content')).goods);
        expect(Peoples.computeEffects(q('restless')).stability).toBeLessThan(Peoples.computeEffects(q('content')).stability);
    });

    it('quarter mood follows its people\'s sentiment', () => {
        const s = makeSettlement([['crownlanders', 1, { sentiment: 20 }]], {
            culturalQuarters: [{ name: 'Crown Hill', tribe: 'crownlanders', specialty: 'calligraphy', mood: 'thriving' }],
        });
        Peoples.refreshEffects(s);
        expect(s.culturalQuarters[0].mood).toBe('restless');
    });

    it('many cuisines (and hybrid dishes) widen the larder', () => {
        const one = Peoples.computeEffects(makeSettlement([['ironborn', 1]]));
        const four = Peoples.computeEffects(makeSettlement([['ironborn', 0.25], ['windrunners', 0.25], ['tidecallers', 0.25], ['glowkin', 0.25]]));
        expect(four.why.food.join(' ')).toMatch(/varied larder/);
        const withHybrid = makeSettlement([['ironborn', 0.5], ['windrunners', 0.5]], { hybridTraditions: [{ name: 'X', cuisine: 'smoked jerky', parents: [] }] });
        const without = makeSettlement([['ironborn', 0.5], ['windrunners', 0.5]]);
        expect(Peoples.computeEffects(withHybrid).food).toBeGreaterThan(Peoples.computeEffects(without).food);
        expect(one.why.food || []).not.toContain('varied larder (1 cuisines)');
    });

    it('harmony adds or removes order', () => {
        const happy = Peoples.computeEffects(makeSettlement([['ironborn', 1]], { culturalHarmony: 90 }));
        const tense = Peoples.computeEffects(makeSettlement([['ironborn', 1]], { culturalHarmony: 20 }));
        expect(happy.stabilityFromHarmony).toBeGreaterThan(0);
        expect(tense.stabilityFromHarmony).toBeLessThan(0);
        expect(happy.stability).toBeGreaterThan(tense.stability);
    });
});

describe('the economy reads the peoples', () => {
    it('crafts, enterprise and husbandry raise production', () => {
        const world = makeWorld([]);
        const tile = world.getTile(5, 5);
        const s = { name: 'A', type: 'town', population: 3000 };
        const before = Economy.calculateDetailedProduction(s, tile, world);
        s.peoplesEffects = { gold: 0.08, food: 0.05, goods: 0.1 };
        const after = Economy.calculateDetailedProduction(s, tile, world);
        expect(after.gold).toBeGreaterThan(before.gold);
        expect(after.food).toBeGreaterThan(before.food);
        expect(after.items.textiles).toBeGreaterThan(before.items.textiles);
    });

    it('commerce raises trade-route profit', () => {
        const mk = trade => ({ economy: { gold: 0, tradeRoutes: [{ active: true, profit: 40 }] }, peoplesEffects: { trade } });
        const a = mk(0); const b = mk(0.1);
        expect(Economy.processTrade(a)).toBe(40);
        expect(Economy.processTrade(b)).toBe(44);
    });

    it('kinship speeds population growth', () => {
        const world = makeWorld([]);
        const grow = growth => {
            const s = { name: 'G', type: 'village', population: 400, peoplesEffects: { growth } };
            for (let i = 0; i < 30; i++) Economy.produceDaily(s, world.getTile(5, 5), world);
            return s.population + s.economy.popCarry;
        };
        const plain = grow(0);
        expect(plain).toBeGreaterThan(400);
        // +15% growth rate (compounding makes it a hair more over a month)
        expect(grow(0.15) - 400).toBeCloseTo((plain - 400) * 1.15, 2);
    });
});

describe('recruitment, taxes and trade prices', () => {
    it('martial peoples supply more and cheaper recruits', () => {
        const civic = { name: 'C', type: 'town', population: 1000, peoplesEffects: { martial: 0 } };
        const martial = { name: 'M', type: 'town', population: 1000, peoplesEffects: { martial: 0.1 } };
        expect(PlayerMilitary.getRecruitmentCapacity(martial)).toBeGreaterThan(PlayerMilitary.getRecruitmentCapacity(civic));
        const unit = PlayerMilitary.UNIT_TYPES.SOLDIER;
        const player = {};
        expect(PlayerMilitary.getRecruitCost(player, unit, martial)).toBeLessThan(PlayerMilitary.getRecruitCost(player, unit, civic));
        expect(PlayerMilitary.getRecruitCost(player, unit)).toBe(PlayerMilitary.getRecruitCost(player, unit, civic));
    });

    it('orderly peoples lift a ruled settlement\'s mood under the same taxes', () => {
        const run = stability => {
            const s = { name: 'T', population: 1000, happiness: 50, peoplesEffects: { stability } };
            Taxation._applyTaxMood(s, Taxation.TAX_RATES.MODERATE, {});
            return s.happiness;
        };
        expect(run(4)).toBeGreaterThan(run(0));
        expect(run(-3)).toBeLessThan(run(0));
    });

    it('mercantile peoples and known heritage improve the player\'s prices', () => {
        const player = { skills: {}, peoplesHeritage: {} };
        const s = makeSettlement([['crownlanders', 1]]);
        Peoples.refreshEffects(s);
        const base = PlayerEffects.tradeBonus(player, s);
        s.peoplesEffects.trade = 0.1;
        expect(PlayerEffects.tradeBonus(player, s)).toBeCloseTo(base + 0.1 * Peoples.EFFECTS.playerTradeShare, 5);
        player.peoplesHeritage.crownlanders = true;
        expect(PlayerEffects.tradeBonus(player, s)).toBeGreaterThan(base + 0.05 - 1e-9);
    });
});

describe('origin lore → heritage', () => {
    it('discovering a people\'s origin story records their heritage', () => {
        const world = makeWorld([]);
        world.tribalHistory = [{ year: 10, type: 'tribal_origin', tribe: 'ironborn', text: T('ironborn').ancestralMemory }];
        const player = { discoveredLore: new Set() };
        Peoples.discoverLore(player, world);
        expect(player.peoplesHeritage).toEqual({ ironborn: true });
        const s = makeSettlement([['ironborn', 0.5], ['shieldfolk', 0.5]]);
        const h = Peoples.heritageTradeBonus(player, s);
        expect(h.bonus).toBeCloseTo(0.02, 5);
        expect(h.peoples[0].proverb).toBe(T('ironborn').proverb);
        const lines = Peoples.describeEffects((Peoples.refreshEffects(s), s), player);
        expect(lines.some(l => l.label === 'Heritage')).toBe(true);
    });
});

describe('daily processing', () => {
    it('peoples on their homeland grow content every 10 days', () => {
        const s = makeSettlement([['windrunners', 0.6], ['frostborn', 0.4]]);
        const world = makeWorld([s], { terrain: 'plains' });
        world.day = 10;
        Peoples.applyHomeland(s, 5, 5, world);
        expect(s.demographics[0].atHome).toBe(true);   // windrunners: plains
        expect(s.demographics[1].atHome).toBe(false);  // frostborn: tundra
        expect(s.demographics[0].sentiment).toBe(61);
        expect(s.demographics[1].sentiment).toBe(60);
        world.day = 11;
        Peoples.applyHomeland(s, 5, 5, world);
        expect(s.demographics[0].sentiment).toBe(61);
        expect(Peoples.homelandLabel(s.demographics[0])).toMatch(/at home/);
    });

    it('larger settlements (later evolution stages) mingle more often', () => {
        expect(Peoples.getEvolutionStage(3000).stage.id).toBe('town');
        expect(Peoples.interactionChance({ population: 20000 })).toBeGreaterThan(Peoples.interactionChance({ population: 600 }));
    });

    it('hybrid traditions add harmony (capped)', () => {
        const s = makeSettlement([['ironborn', 1]]);
        expect(Peoples.hybridHarmonyBonus(s)).toBe(0);
        s.hybridTraditions = new Array(9).fill({ name: 'x' });
        expect(Peoples.hybridHarmonyBonus(s)).toBe(Peoples.EFFECTS.harmony.hybridMax);
    });

    it('processTurn caches settlement effects and the kingdom\'s population-weighted bonuses', () => {
        const a = makeSettlement([['shieldfolk', 1]], { population: 3000 });
        const b = makeSettlement([['sunweavers', 1]], { population: 1000 });
        const world = makeWorld([a, b]);
        Peoples.processTurn(world);
        expect(a.peoplesEffects.martial).toBeGreaterThan(0);
        expect(b.peoplesEffects.faith).toBeGreaterThan(0);
        const k = world.kingdoms[0];
        expect(k.peoples.bonuses.military).toBeGreaterThan(0);
        expect(k.peoples.bonuses.faith).toBeGreaterThan(0);
        expect(typeof k.peoples.stability).toBe('number');
    });

    it('generated quarters use the data file\'s names for every people', () => {
        const s = makeSettlement([['marshborn', 1]], { population: 2000 });
        const quarters = Peoples.generateQuarters(s, s.demographics);
        expect(Peoples._quarterNames.marshborn).toContain(quarters[0].name);
    });
});

describe('the kingdom AI reads the realm\'s peoples', () => {
    it('KingdomBonuses folds in kingdom.peoples bonuses', () => {
        const k = { id: 'k', peoples: { bonuses: { diplomacy: 0.05, faith: 0.04 }, stability: 3 } };
        expect(KingdomBonuses.get(k, 'diplomacy')).toBeCloseTo(0.05);
        expect(KingdomBonuses.get(k, 'faith')).toBeCloseTo(0.04);
        expect(KingdomBonuses.get({ id: 'x' }, 'diplomacy')).toBe(0);
    });

    it('stability target names the peoples', () => {
        const world = { day: 1, activeEvents: [], kingdoms: [] };
        const k = { id: 'k', treasury: 100, wars: [], peoples: { bonuses: {}, stability: 3 } };
        const without = KingdomStability.target({ ...k, peoples: null }, world).value;
        const t = KingdomStability.target(k, world);
        expect(t.value).toBeCloseTo(without + 3, 5);
        expect(t.parts.some(p => p.label === 'Peoples & harmony' && p.value === 3)).toBe(true);
    });
});

describe('customs, festivals and cuisine', () => {
    const player = (over = {}) => ({ gold: 5000, renown: 0, karma: 0, skills: { combat: 3, leadership: 3, diplomacy: 1 }, reputation: {}, ...over });
    const fworld = { day: 100, season: 'Spring', width: 40, getAllSettlements: () => [], getKingdom: () => null };

    it('a festival honours the local signature festival: renown and mood', () => {
        const local = makeSettlement([['sunweavers', 0.6], ['canopiers', 0.4]], { culturalIdentity: { signatureFestival: 'Sky Dances' } });
        Peoples.refreshEffects(local);
        Utils.setSeed(2);
        const plain = Festivals.hostFestival(player(), { ...fworld }, { q: 1, r: 1, settlement: { name: 'Holt', type: 'town' } }, { tier: 'modest' });
        Utils.setSeed(2);
        const honoured = Festivals.hostFestival(player(), { ...fworld }, { q: 1, r: 1, settlement: local }, { tier: 'modest' });
        expect(plain.localCustoms.renownBonus).toBe(0);
        expect(honoured.localCustoms.custom).toBe('Sky Dances');
        expect(honoured.localCustoms.renownBonus).toBeGreaterThanOrEqual(1);
        expect(honoured.renownGain).toBe(plain.renownGain + honoured.localCustoms.renownBonus);
        expect(local.demographics[0].sentiment).toBe(60 + Peoples.EFFECTS.festival.sentimentGain);
    });

    it('a tavern meal serves the signature dish and comforts more', () => {
        const s = makeSettlement([['ironborn', 1]], {
            culturalIdentity: { signatureDish: 'smoked meats' },
            hybridTraditions: [{ name: 'X', cuisine: 'honeyed stew', parents: [] }],
        });
        const needs = {};
        const p = { gold: 100, modifyNeed(k, v) { needs[k] = (needs[k] || 0) + v; } };
        const plain = {};
        const q = { gold: 100, modifyNeed(k, v) { plain[k] = (plain[k] || 0) + v; } };
        const world = makeWorld([]);
        const out = Tavern._buyMeal(p, { settlement: s }, world);
        Tavern._buyMeal(q, { settlement: { name: 'Plainville' } }, world);
        expect(out[0].text).toMatch(/smoked meats/);
        expect(needs.comfort).toBe(plain.comfort + Peoples.EFFECTS.tavern.signatureComfort + Peoples.EFFECTS.tavern.hybridComfort);
        const opt = Tavern.getTavernOptions({ gold: 100 }, { q: 5, r: 5, settlement: s }, world).find(o => o.id === 'buy_meal');
        expect(opt.label).toMatch(/smoked meats/);
    });

    it('the panel lists what the peoples do, with numbers', () => {
        const s = makeSettlement([['ironborn', 0.7], ['sailweavers', 0.3]], {
            culturalIdentity: { signatureDish: 'smoked meats', signatureFestival: 'Anvil Oaths', signatureArt: 'metalwork', dominantValues: [] },
        });
        Peoples.refreshEffects(s);
        const html = Peoples.buildDemographicsHTML(s, null);
        expect(html).toContain('What the Peoples Bring');
        expect(html).toMatch(/Crafts<\/strong> \+\d+% goods production/);
        expect(html).toContain('Anvil Oaths');
    });
});
