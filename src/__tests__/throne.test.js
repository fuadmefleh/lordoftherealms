// Claims & Crowns (systems/throne.js): claims, succession crises, the war for
// a throne, ruling a realm, and founding one's own kingdom.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Characters } from '../world/characters.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { Throne } from '../systems/throne.js';
import { CrownBooks } from '../world/crownBooks.js';
import { House } from '../systems/house.js';
import { RealmWars } from '../systems/realmWars.js';
import { Relationships } from '../systems/relationships.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(seed = 11) {
    Utils.setSeed(seed);
    const world = new World(40, 30);
    world.generate({ kingdomCount: 4 });
    world.day = 100;
    return world;
}

function makePlayer(world, extra = {}) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 30,
        gold: 20000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [],
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        relationships: {}, actionPoints: 10, army: [],
        ...extra,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    player.house.prestige = 200;
    return player;
}

/** A living kingdom with at least two settlements. */
function target(world) {
    const all = world.getAllSettlements();
    return world.kingdoms.find(k => k.isAlive && all.filter(s => s.kingdom === k.id).length >= 2) || world.kingdoms[0];
}

describe('Throne data (data/throne.json)', () => {
    it('is registered with the DataLoader and drives the config', () => {
        expect(DataLoader.throne).toBeTruthy();
        const cfg = Throne.config();
        expect(cfg.pressMinStrength).toBe(DataLoader.throne.config.pressMinStrength);
        expect(cfg.lean.crownLoyalty).toBe(DataLoader.throne.config.lean.crownLoyalty);
        for (const axis of Throne.POLICY_AXES) {
            const def = Throne.policies()[axis];
            expect(def.options[def.default]).toBeTruthy();
        }
    });
});

describe('Claims', () => {
    it('sources stack into a capped strength; forgeries and heralds stack up to their caps', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const k = target(world);
        const cfg = Throne.config();
        Throne.grantClaim(player, world, k.id, 'conquest', cfg.conquestStrength);
        Throne.grantClaim(player, world, k.id, 'conquest', 5); // max mode keeps the larger
        expect(Throne.claimStrength(player, k.id)).toBe(cfg.conquestStrength);

        const p0 = player.house.prestige;
        expect(Throne.purchaseClaim(player, world, k.id).success).toBe(true);
        expect(player.house.prestige).toBe(p0 - cfg.purchasePrestige);
        expect(Throne.purchaseClaim(player, world, k.id).success).toBe(true);
        expect(Throne.purchaseClaim(player, world, k.id).success).toBe(false); // capped
        expect(Throne.claimStrength(player, k.id)).toBe(cfg.conquestStrength + cfg.purchaseCap);

        Throne.grantClaim(player, world, k.id, 'marriage', 80);
        expect(Throne.claimStrength(player, k.id)).toBe(cfg.maxClaimStrength);
        expect(Throne.claims(player, world)[0].label.label).toBe('Ironclad');
    });

    it('storming a capital, and holding a high office long enough, earn claims', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const k = target(world);
        expect(Throne.onCapitalCaptured(player, world, k.id)).toBe(Throne.config().conquestStrength);

        const other = world.kingdoms.find(x => x.isAlive && x.id !== k.id);
        player.allegiance = other.id;
        player.currentTitle = 'chancellor';
        player.titleAppointedDay = world.day - 10;
        Throne.processDaily(player, world);
        expect(Throne.claimStrength(player, other.id)).toBe(0);
        player.titleAppointedDay = world.day - 200;
        Throne.processDaily(player, world);
        expect(Throne.claimStrength(player, other.id)).toBe(Throne.config().officeClaims[4].strength);
    });

    it('forgeries need an idle spy; a caught forgery costs reputation', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const k = target(world);
        expect(Throne.forgeClaim(player, world, k.id).success).toBe(false);
        player.espionage = { spies: [{ id: 's1', name: 'Mole', level: 1, status: 'idle', loyalty: 70 }] };
        let forged = 0;
        let caught = 0;
        Utils.setSeed(3);
        for (let i = 0; i < 6; i++) {
            const before = player.reputation[k.id] || 0;
            const res = Throne.forgeClaim(player, world, k.id);
            if (!res.success) break;
            if (res.failed) { caught++; expect(player.reputation[k.id]).toBeLessThan(before); } else forged++;
        }
        expect(forged + caught).toBeGreaterThan(0);
        expect(Throne.claimStrength(player, k.id)).toBeLessThanOrEqual(Throne.config().forgeCap);
    });

    it('a royal match, once wed, gives a marriage claim that grows with children', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const k = target(world);
        Utils.setSeed(5);
        const princess = Characters.generateCharacter({ culture: k.culture, gender: 'female', age: 19, dynasty: k.characterData.dynasty.name });
        princess.kingdomId = k.id;
        k.characterData.children = [princess];
        player.reputation[k.id] = 10;
        expect(Throne.arrangeRoyalMatch(player, world, k.id).success).toBe(false); // reputation too low
        player.reputation[k.id] = 40;
        const res = Throne.arrangeRoyalMatch(player, world, k.id);
        expect(res.success).toBe(true);
        expect(res.npc.royal.kingdomId).toBe(k.id);
        expect(princess.spouseId).toBe('player');
        expect(Throne.royalMatchCandidates(world, k.id)).toHaveLength(0);

        expect(Relationships.marry(player, res.npc.id, world).success).toBe(true);
        Throne.processDaily(player, world);
        const cfg = Throne.config();
        expect(Throne.claimStrength(player, k.id)).toBe(cfg.marriageBase);
        player.children = [{ id: 'c1' }, { id: 'c2' }];
        Throne.processDaily(player, world);
        expect(Throne.claimStrength(player, k.id)).toBe(cfg.marriageBase + 2 * cfg.marriagePerChild);
    });
});

describe('Succession crises', () => {
    it('a ruler\'s death is recorded without drawing extra randomness', () => {
        const world = makeWorld();
        const k = target(world);
        Characters.handleSuccession(k, world);
        expect(k.lastSuccession.day).toBe(world.day);
        expect(typeof k.lastSuccession.type).toBe('string');
        expect(k.lastSuccession.heirName).toBeTruthy();
    });

    it('a disputed succession starts a crisis; backing the winner pays', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const k = target(world);
        k.lastSuccession = { day: world.day, type: 'distant_relative', crisis: true, heirName: 'Old Heir', heirAge: 40 };
        Utils.setSeed(9);
        const out = Throne.processDaily(player, world);
        expect(out.crises).toHaveLength(1);
        const crisis = out.crises[0];
        expect(crisis.cause).toBe('disputed');
        expect(k.crown && k.crown.crisis).toBe(true);
        expect(KingdomBonuses.get(k, 'stability')).toBeLessThan(KingdomBonuses.get({ ...k, crown: null }, 'stability'));

        // Pour gold into the rival until the outcome is all but certain
        expect(Throne.backClaimant(player, world, crisis.id, 'rival', 'gold', { amount: 100 }).success).toBe(false);
        expect(Throne.backClaimant(player, world, crisis.id, 'rival', 'gold', { amount: 10000 }).success).toBe(true);
        expect(Throne.backClaimant(player, world, crisis.id, 'incumbent', 'prestige').success).toBe(false); // one side only
        const rivalName = crisis.claimants.find(c => c.id === 'rival').name;
        const gold = player.gold;
        world.day = crisis.endDay;
        Utils.setSeed(1);
        const end = Throne.processDaily(player, world);
        expect(end.crisesResolved).toHaveLength(1);
        expect(end.crisesResolved[0].winner).toBe(rivalName);
        expect(player.gold).toBeGreaterThan(gold);
        expect(Characters.getFullName(k.characterData.ruler)).toBe(rivalName);
        expect(k.crown).toBeUndefined();
    });
});

describe('Pressing a claim', () => {
    function pretender(world) {
        const player = makePlayer(world);
        const k = target(world);
        Throne.grantClaim(player, world, k.id, 'conquest', 60);
        player.reputation[k.id] = 50;
        return { player, k };
    }

    it('the forecast is deterministic and draws no randomness', () => {
        const world = makeWorld();
        const { player, k } = pretender(world);
        Utils.setSeed(42);
        const a = Throne.forecast(player, world, k.id, { armyStrength: 100 });
        const next = Utils.random();
        Utils.setSeed(42);
        const b = Throne.forecast(player, world, k.id, { armyStrength: 100 });
        expect(Utils.random()).toBe(next);
        expect(b).toEqual(a);
        expect(a.settlements.length).toBeGreaterThan(0);
        expect(a.rebelShare).toBeGreaterThanOrEqual(0);
        // The court holds the capital at the outset, whatever its mood
        for (const s of a.settlements.filter(x => x.isCapital)) expect(s.side).toBe('loyalist');
        // A stronger claim and better standing swing more of the realm
        Throne.grantClaim(player, world, k.id, 'marriage', 40);
        player.reputation[k.id] = 100;
        const c = Throne.forecast(player, world, k.id, { armyStrength: 300 });
        expect(c.appeal.value).toBeGreaterThan(a.appeal.value);
        expect(c.rebelShare).toBeGreaterThanOrEqual(a.rebelShare);
    });

    it('needs a strong enough claim, an army and gold', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const k = target(world);
        expect(Throne.canPress(player, world, k.id, { armyStrength: 100 }).ok).toBe(false);
        Throne.grantClaim(player, world, k.id, 'conquest', 30);
        expect(Throne.canPress(player, world, k.id, { armyStrength: 10 }).ok).toBe(false);
        expect(Throne.canPress(player, world, k.id, { armyStrength: 100 }).ok).toBe(true);
    });

    it('raising the banners splits the realm into a civil war fought through RealmWars', () => {
        const world = makeWorld();
        const { player, k } = pretender(world);
        player.allegiance = k.id;
        const military = k.military;
        const res = Throne.pressClaim(player, world, k.id, { armyStrength: 200 });
        expect(res.success).toBe(true);
        const cw = player.throne.civilWar;
        expect(player.allegiance).toBe(null);
        expect(k.military).toBe(military - cw.levies);
        expect(RealmWars.atWarWith(player, k.id)).toBe(true);
        expect(player.realmWars.wars[k.id].civilWar).toBe(true);
        expect(RealmWars.sueForPeace(player, world, k.id).success).toBe(false);
        expect(k.crown.civilWar).toBe(true);
        // The fight runs day by day
        for (let i = 0; i < 10; i++) { world.day++; Throne.processDaily(player, world, { armyStrength: 200 }); }
        expect(player.throne.civilWar || player.throne.ruling || player.throne.exile[k.id]).toBeTruthy();
    });

    it('victory crowns the player: the realm, its title and its AI now answer to them', () => {
        const world = makeWorld();
        const { player, k } = pretender(world);
        Throne.pressClaim(player, world, k.id, { armyStrength: 200 });
        const prestige = player.house.prestige;
        player.throne.civilWar.momentum = 500;
        world.day++;
        const out = Throne.processDaily(player, world, { armyStrength: 200 });
        expect(out.civilWar.ended).toBe('crowned');
        expect(player.throne.ruling.kingdomId).toBe(k.id);
        expect(player.allegiance).toBe(k.id);
        expect(player.kingdomTitle).toBe('king');
        expect(k.characterData.ruler.isPlayer).toBe(true);
        expect(k.ruler).toContain('Ash');
        expect(k.crown.playerRuled).toBe(true);
        expect(RealmWars.atWarWith(player, k.id)).toBe(false);
        expect(player.house.prestige).toBeGreaterThan(prestige);
        expect(Throne.claimStrength(player, k.id)).toBe(0);
    });

    it('defeat means exile: the claim is lost, Prestige falls and the realm stays closed', () => {
        const world = makeWorld();
        const { player, k } = pretender(world);
        Throne.pressClaim(player, world, k.id, { armyStrength: 200 });
        const prestige = player.house.prestige;
        const cw = player.throne.civilWar;
        for (const key of Object.keys(cw.sides)) cw.sides[key] = 'loyalist';
        cw.momentum = -500;
        world.day++;
        const out = Throne.processDaily(player, world, { armyStrength: 200 });
        expect(out.civilWar.ended).toBe('exile');
        expect(player.throne.civilWar).toBe(null);
        expect(Throne.claimStrength(player, k.id)).toBe(0);
        expect(player.house.prestige).toBe(prestige - Throne.config().exilePrestigeLoss);
        expect(player.reputation[k.id]).toBeLessThanOrEqual(Throne.config().exileReputation);
        expect(Throne.isExiledFrom(player, world, k.id)).toBe(true);
        expect(Throne.purchaseClaim(player, world, k.id).success).toBe(false);
        expect(RealmWars.atWarWith(player, k.id)).toBe(false);
    });

    it('battles fought by the player move the momentum', () => {
        const world = makeWorld();
        const { player, k } = pretender(world);
        Throne.pressClaim(player, world, k.id, { armyStrength: 200 });
        const m = player.throne.civilWar.momentum;
        expect(Throne.loyalistVanguard(player, world)).toBeGreaterThan(0);
        Throne.recordThroneBattle(player, world, true);
        expect(player.throne.civilWar.momentum).toBe(m + Throne.config().civilWar.vanguardWin);
        Throne.recordThroneBattle(player, world, false);
        expect(player.throne.civilWar.momentum).toBe(m + Throne.config().civilWar.vanguardWin + Throne.config().civilWar.vanguardLoss);
    });
});

describe('Ruling a realm', () => {
    function crowned(world) {
        const player = makePlayer(world);
        const k = target(world);
        Throne._takeThrone(player, world, k);
        return { player, k };
    }

    it('policies feed the kingdom bonuses the AI reads', () => {
        const world = makeWorld();
        const { player, k } = crowned(world);
        const base = KingdomBonuses.get(k, 'tax');
        expect(Throne.setPolicy(player, world, 'tax', 'heavy').success).toBe(true);
        expect(KingdomBonuses.get(k, 'tax')).toBeCloseTo(base + Throne.policies().tax.options.heavy.mods.tax);
        expect(Throne.setPolicy(player, world, 'faith', 'zealous').success).toBe(true);
        expect(k.crown.mods.faith).toBeGreaterThan(0);
        expect(Throne.setPolicy(player, world, 'tax', 'nonsense').success).toBe(false);
    });

    it('the AI declares no wars unless the war stance allows it', () => {
        const world = makeWorld();
        const { player, k } = crowned(world);
        for (const o of world.kingdoms) if (o !== k) { k.relations[o.id] = -100; o.military = 1; }
        k.military = 100000;
        KingdomAI.considerWar(k, world);
        expect(k.wars).toHaveLength(0);
        Throne.setPolicy(player, world, 'stance', 'aggressive');
        KingdomAI.considerWar(k, world);
        expect(k.wars.length).toBeGreaterThan(0);
    });

    it('the levy fills the ruler\'s purse; diplomacy acts for the realm', () => {
        const world = makeWorld();
        const { player, k } = crowned(world);
        k.treasury = 11000;
        // The levy is a share of yesterday's taxes and dues (the Crown's Purse, world/crownBooks.js)
        const books = CrownBooks.state(k);
        books.avg = { rev: 1000, exp: 0, n: 5 };
        const gold = player.gold;
        Throne.processDaily(player, world);
        const levy = player.gold - gold;
        expect(levy).toBe(Math.floor(1000 * Throne.levyRate(player)));
        expect(k.treasury).toBe(11000 - levy);
        expect(books.day.purse).toBe(levy);
        // A day without taxes pays nothing; the levy is capped
        books.avg.rev = 0;
        const g2 = player.gold;
        Throne.processDaily(player, world);
        expect(player.gold).toBe(g2);
        k.treasury += 1e7;
        books.avg.rev = 1e7;
        Throne.processDaily(player, world);
        expect(player.gold - g2).toBe(Throne.config().ruling.levyCap);

        const foe = world.kingdoms.find(o => o.isAlive && o.id !== k.id && !(k.allies || []).includes(o.id));
        delete (k.truces || {})[foe.id];
        expect(Throne.declareRealmWar(player, world, foe.id).success).toBe(true);
        expect(k.wars).toContain(foe.id);
        k.military = 1e6;
        Utils.setSeed(2);
        expect(Throne.proposePeace(player, world, foe.id).success).toBe(true);
    });

    it('the player\'s stand-in on the throne never dies of NPC old age', () => {
        const world = makeWorld();
        const { k } = crowned(world);
        k.characterData.ruler.age = 200;
        for (let d = 0; d < 3; d++) {
            world.day = 120 * (d + 2);
            Characters.processKingdomCharacters(k, world);
        }
        expect(k.characterData.ruler.isAlive).toBe(true);
        expect(k.characterData.ruler.isPlayer).toBe(true);
    });

    it('an heir who succeeds keeps the crown', () => {
        const world = makeWorld();
        const { player, k } = crowned(world);
        player.allegiance = null;
        player.kingdomTitle = null;
        player.firstName = 'Bryn';
        Throne.processDaily(player, world);
        expect(player.allegiance).toBe(k.id);
        expect(player.kingdomTitle).toBe('king');
        expect(k.ruler).toContain('Bryn');
    });
});

describe('Founding a kingdom', () => {
    function settler(world) {
        const player = makePlayer(world);
        const free = world.getAllSettlements().slice(0, 3);
        for (const s of free) {
            const tile = world.getTile(s.q, s.r);
            tile.settlement.colony = { isPlayerColony: true, loyalty: 60 };
            player.colonies.push({ q: s.q, r: s.r, name: s.name });
        }
        return player;
    }

    it('needs settlements and Prestige', () => {
        const world = makeWorld();
        const player = settler(world);
        player.house.prestige = 10;
        const st = Throne.foundingStatus(player, world);
        expect(st.ok).toBe(false);
        expect(Throne.foundKingdom(player, world, {}).success).toBe(false);
    });

    it('registers a real kingdom that the simulation runs and saves', () => {
        const world = makeWorld();
        const player = settler(world);
        const n = world.kingdoms.length;
        const res = Throne.foundKingdom(player, world, { name: 'Realm of Ash' });
        expect(res.success).toBe(true);
        const k = res.kingdom;
        expect(world.kingdoms).toHaveLength(n + 1);
        expect(k.name).toBe('Realm of Ash');
        expect(k.territory.length).toBeGreaterThan(0);
        expect(k.characterData.ruler.isPlayer).toBe(true);
        expect(player.throne.ruling.founded).toBe(true);
        expect(world.getAllSettlements().filter(s => s.kingdom === k.id)).toHaveLength(3);

        // The world runs with it (AI turns, characters, colonies, religion, ...)
        for (let i = 0; i < 15; i++) { world.advanceDay(null); Throne.processDaily(player, world); }
        expect(k.isAlive).toBe(true);
        expect(Number.isFinite(k.treasury)).toBe(true);

        // Save and load: the founded realm and the crown survive
        const saved = JSON.parse(JSON.stringify({
            world: SaveLoad.serializeWorld(world),
            player: SaveLoad.serializePlayer(player),
        }));
        Utils.setSeed(11);
        const fresh = new World(40, 30);
        fresh.generate({ kingdomCount: 4 });
        SaveLoad.restoreWorld(saved.world, fresh);
        const back = fresh.getKingdom(k.id);
        expect(back).toBeTruthy();
        expect(back.createdByPlayer).toBe(true);
        expect(back.characterData.ruler.isPlayer).toBe(true);
        const p2 = makePlayer(fresh);
        SaveLoad.restorePlayer(saved.player, p2, fresh);
        expect(p2.throne.ruling.kingdomId).toBe(k.id);
        expect(back.crown.playerRuled).toBe(true);
    });
});

describe('Old saves', () => {
    it('backfill a blank throne record, and a crown for a realm founded the old way', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        delete player.throne;
        Throne.load(player, world);
        expect(player.throne.claims).toEqual({});
        expect(player.throne.ruling).toBe(null);

        const k = target(world);
        k.createdByPlayer = true;
        const p2 = makePlayer(world, { allegiance: k.id, kingdomTitle: 'king' });
        Throne.load(p2, world);
        expect(p2.throne.ruling.kingdomId).toBe(k.id);
        expect(k.crown.playerRuled).toBe(true);
    });
});
