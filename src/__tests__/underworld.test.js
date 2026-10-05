// The Underworld: per-kingdom heat, the thieves' guild, contraband by culture
// and faith, hot goods and fences, and the hooks that make existing smuggling
// and piracy feed heat. All randomness is seeded through Utils.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { BASE_INVENTORY_SLOTS } from '../core/inventory.js';
import { Underworld } from '../systems/underworld.js';
import { Economy } from '../world/economy.js';
import { Gossip } from '../systems/gossip.js';
import { Traits } from '../systems/traits.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { Trading } from '../player/playerEconomy/trading.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { addSettlementActions } from '../player/actions/settlementActions.js';
import { Tavern } from '../player/tavern.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(1234));

const KINGDOMS = {
    azurath: { id: 'azurath', name: 'Theocracy of Azurath', culture: 'Religious', traits: ['religious', 'scholarly'], religion: { faithId: 'starseers', piety: 40 }, isAlive: true },
    merathis: { id: 'merathis', name: 'Republic of Merathis', culture: 'Maritime', traits: ['mercantile', 'naval'], religion: { faithId: 'tidemother', piety: 30 }, isAlive: true },
    valdoria: { id: 'valdoria', name: 'Kingdom of Valdoria', culture: 'Imperial', traits: ['militaristic', 'orderly'], religion: { faithId: 'solaris', piety: 80 }, isAlive: true },
};

/** A small world: a town per realm at (q, 0), plus a village and a capital in Merathis. */
function makeWorld(day = 50) {
    const tiles = {
        '0,0': { q: 0, r: 0, settlement: { name: 'Azur Town', type: 'town', population: 2000, kingdom: 'azurath' } },
        '1,0': { q: 1, r: 0, settlement: { name: 'Tidewatch', type: 'town', population: 2000, kingdom: 'merathis' } },
        '2,0': { q: 2, r: 0, settlement: { name: 'Valdor', type: 'town', population: 2000, kingdom: 'valdoria' } },
        '3,0': { q: 3, r: 0, settlement: { name: 'Fishhook', type: 'village', population: 200, kingdom: 'merathis' } },
        '4,0': { q: 4, r: 0, settlement: { name: 'Merath', type: 'capital', population: 8000, kingdom: 'merathis' } },
    };
    for (const t of Object.values(tiles)) t.terrain = { id: 'plains', passable: true };
    const kingdoms = JSON.parse(JSON.stringify(KINGDOMS));
    return {
        day,
        width: 10,
        kingdoms: Object.values(kingdoms),
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: id => kingdoms[id] || null,
        getAllSettlements: () => Object.values(tiles).filter(t => t.settlement).map(t => ({ q: t.q, r: t.r, ...t.settlement })),
        tiles,
    };
}

function makePlayer(extra = {}) {
    const p = new Player();
    p.gold = 5000;
    p.actionPoints = 100;
    p.inventory = {};
    Object.assign(p, extra);
    return p;
}

function member(p, rank = 0) {
    const st = Underworld.ensure(p);
    st.guild.contactMet = true;
    st.guild.member = true;
    st.guild.rank = rank;
    st.guild.standing = (Underworld.ranks()[rank] || {}).standing || 0;
    return st;
}

describe('content', () => {
    it('is loaded from data/underworld.json and registered in gamedata', () => {
        expect(DataLoader.underworld).toBeTruthy();
        expect(DataLoader.get('underworld').jobs.burglary).toBeTruthy();
        expect(Underworld.ranks().map(r => r.name)).toEqual(['Footpad', 'Cutpurse', 'Prowler', 'Shadow', 'Master Thief', 'Guildmaster']);
    });
});

describe('heat', () => {
    it('crimes raise heat in the realm, and it cools every day', () => {
        const p = makePlayer();
        const w = makeWorld();
        Underworld.recordCrime(p, w, 'burglary', { kingdom: 'merathis' });
        expect(Underworld.getHeat(p, 'merathis')).toBe(8);
        expect(Underworld.getHeat(p, 'azurath')).toBe(0);
        Underworld.processDay(p, w);
        expect(Underworld.getHeat(p, 'merathis')).toBe(7);
    });

    it('lying low cools a realm faster', () => {
        const p = makePlayer();
        const w = makeWorld();
        Underworld.addHeat(p, 'merathis', 40, w);
        Underworld.addHeat(p, 'azurath', 40, w);
        Underworld.lieLow(p, w, w.getTile(1, 0));
        Underworld.processDay(p, w);
        expect(Underworld.getHeat(p, 'merathis')).toBe(36);
        expect(Underworld.getHeat(p, 'azurath')).toBe(39);
        expect(Underworld.availableJobs(member(p, 5) && p, w, w.getTile(1, 0)).every(j => j.locked)).toBe(true);
    });

    it('high heat puts up wanted posters (a Gossip bounty) and then a kingdom warrant', () => {
        const p = makePlayer();
        const w = makeWorld();
        Underworld.addHeat(p, 'merathis', 55, w);
        const bounty = p.gossip.bounties.find(b => b.kingdom === 'merathis');
        expect(bounty).toBeTruthy();
        expect(bounty.gold).toBeGreaterThan(0);
        expect(p.gossip.warrants && p.gossip.warrants.merathis).toBeFalsy();
        Underworld.addHeat(p, 'merathis', 30, w);
        expect(p.gossip.warrants.merathis).toBeTruthy();
        expect(Gossip.refusesService(p, 1, 0, w).refused).toBe(true);
        // Settling with the crown drops the warrant and cools the heat
        Gossip.settleWithKingdom(p, 'merathis');
        expect(Underworld.getHeat(p, 'merathis')).toBeLessThanOrEqual(20);
        expect(Gossip.refusesService(p, 1, 0, w).refused).toBe(false);
    });

    it('a bribe buys heat down; guild rank makes it cheaper', () => {
        const w = makeWorld();
        const tile = w.getTile(1, 0);
        const a = makePlayer();
        const b = makePlayer();
        Underworld.addHeat(a, 'merathis', 40, w);
        Underworld.addHeat(b, 'merathis', 40, w);
        member(b, 4);
        expect(Underworld.bribeCost(b, w, tile).gold).toBeLessThan(Underworld.bribeCost(a, w, tile).gold);
        Utils.setRng(() => 0.99); // the sergeant takes it
        const res = Underworld.bribeGuards(a, w, tile);
        expect(res.accepted).toBe(true);
        expect(Underworld.getHeat(a, 'merathis')).toBe(10);
        expect(Traits.getState(a).deeds.deceit).toBeGreaterThan(0);
    });
});

describe('guard searches at the gate', () => {
    it('warns at moderate heat and, when searched, confiscates contraband and fines', () => {
        const w = makeWorld();
        const tile = w.getTile(0, 0); // Azurath: liquor is banned
        const p = makePlayer({ inventory: { liquor: 3, grain: 5 } });
        Underworld.addHeat(p, 'azurath', 30, w);
        Utils.setRng(() => 0.99); // never searched
        let gate = Underworld.onEnterSettlement(p, w, tile);
        expect(gate.warning).toMatch(/watch/i);
        expect(gate.search).toBeNull();

        Utils.setRng(() => 0.01); // searched (and the arrest roll fails low too)
        const gold = p.gold;
        gate = Underworld.onEnterSettlement(p, w, tile);
        expect(gate.search.seized).toEqual({ liquor: 3 });
        expect(p.inventory.liquor).toBeUndefined();
        expect(p.inventory.grain).toBe(5);
        expect(p.gold).toBeLessThan(gold);
        expect(p.jailState).toBeTruthy(); // the existing jail mechanic
    });

    it('a clean search eases the heat a little', () => {
        const w = makeWorld();
        const p = makePlayer({ inventory: { grain: 5 } });
        Underworld.addHeat(p, 'merathis', 30, w);
        let calls = 0;
        Utils.setRng(() => (calls++ === 0 ? 0.0 : 0.99)); // searched, not arrested
        const gate = Underworld.onEnterSettlement(p, w, w.getTile(1, 0));
        expect(gate.search.arrested).toBe(false);
        expect(Underworld.getHeat(p, 'merathis')).toBe(27);
    });
});

describe('contraband by culture and faith', () => {
    it('reads bans and tariffs from culture, faith and piety', () => {
        const w = makeWorld();
        expect(Underworld.contrabandStatus(w.getKingdom('azurath'), 'liquor')).toBe('illegal');   // Religious culture
        expect(Underworld.contrabandStatus(w.getKingdom('azurath'), 'relics')).toBe('illegal');   // Starseers faith
        expect(Underworld.contrabandStatus(w.getKingdom('valdoria'), 'liquor')).toBe('illegal');  // pious realm (piety 80)
        expect(Underworld.contrabandStatus(w.getKingdom('valdoria'), 'weapons')).toBe('tariff');  // Imperial
        expect(Underworld.contrabandStatus(w.getKingdom('merathis'), 'liquor')).toBe('legal');
        expect(Underworld.contrabandStatus(w.getKingdom('merathis'), 'poison')).toBe('illegal');  // everywhere
        expect(Underworld.contrabandStatus(w.getKingdom('merathis'), 'grain')).toBe('legal');
        expect(Underworld.contrabandList(w.getKingdom('azurath')).illegal).toContain('liquor');
    });

    it('the legal market refuses contraband and takes a tariff cut', () => {
        const w = makeWorld();
        const p = makePlayer({ inventory: { liquor: 2, weapons: 2 } });
        const refused = Trading.sellGoods(p, 'liquor', 1, w.getTile(0, 0).settlement, w);
        expect(refused.success).toBe(false);
        expect(refused.reason).toMatch(/contraband/i);
        const taxed = Trading.sellGoods(p, 'weapons', 1, w.getTile(2, 0).settlement, w);
        const free = Trading.sellGoods(p, 'weapons', 1, w.getTile(1, 0).settlement, w);
        expect(taxed.success && free.success).toBe(true);
        expect(taxed.earned).toBeLessThan(free.earned);
    });

    it('the black market pays a premium for contraband, more under blockade and in the lean season', () => {
        const w = makeWorld(50);
        const tile = w.getTile(0, 0);
        // Liquor sold openly next door (Tidewatch's town market) caps the
        // premium: no buying it there and fencing it here at a profit
        const nextDoorAsk = Economy.marketAsk(w, w.getTile(1, 0), 'liquor');
        expect(Underworld.blackMarketPrice(w, tile, 'liquor')).toBeLessThanOrEqual(Math.floor(nextDoorAsk * 0.5));
        // With no open sale next door (a village), contraband fetches its premium
        w.tiles['1,0'].settlement.type = 'village';
        const legalPrice = Underworld.blackMarketPrice(w, w.getTile(1, 0), 'liquor');
        const banned = Underworld.blackMarketPrice(w, tile, 'liquor');
        expect(banned).toBeGreaterThan(legalPrice);
        w.getKingdom('azurath').navy = { strength: 10, blockades: { merathis: { since: 1 } } };
        const blockaded = Underworld.blackMarketPrice(w, tile, 'liquor');
        expect(blockaded).toBeGreaterThan(banned);
        w.day = 115; // lean weeks
        expect(Underworld.blackMarketPrice(w, tile, 'liquor')).toBeGreaterThan(blockaded);
        expect(Underworld.smugglingProfitMultiplier(w, tile)).toBeGreaterThan(1);
        expect(Underworld.smugglingCatchBonus(w, tile)).toBeGreaterThan(0);
    });

    it('a black-market sale feeds heat — double under blockade', () => {
        const w = makeWorld();
        const tile = w.getTile(0, 0);
        const a = makePlayer({ inventory: { liquor: 2 } });
        Utils.setRng(() => 0.99); // not caught
        const res = Underworld.sellBlackMarket(a, w, tile, 'liquor', 1);
        expect(res.success && !res.caught).toBe(true);
        const calm = Underworld.getHeat(a, 'azurath');
        expect(calm).toBeGreaterThan(0);
        w.getKingdom('azurath').navy = { strength: 10, blockades: { merathis: { since: 1 } } };
        const b = makePlayer({ inventory: { liquor: 2 } });
        Underworld.sellBlackMarket(b, w, tile, 'liquor', 1);
        expect(Underworld.getHeat(b, 'azurath')).toBe(calm * 2);
    });
});

describe('hot goods and fences', () => {
    it('stolen goods are hot: only a fence buys them until they cool', () => {
        const w = makeWorld(50);
        const p = makePlayer({ inventory: { silk: 1 } });
        Underworld.markHot(p, 'silk', 2, w.day);
        p.inventory.silk = 3;
        expect(Underworld.hotQty(p, 'silk', w.day)).toBe(2);
        // One cool unit may go to market; the hot two may not
        expect(Trading.sellGoods(p, 'silk', 2, w.getTile(1, 0).settlement, w).success).toBe(false);
        expect(Trading.sellGoods(p, 'silk', 1, w.getTile(1, 0).settlement, w).success).toBe(true);
        // The fence takes hot goods
        member(p, 0);
        const res = Underworld.sellToFence(p, w, w.getTile(1, 0), 'silk', 2);
        expect(res.success).toBe(true);
        expect(p.inventory.silk).toBeUndefined();
        expect(Underworld.hotGoods(p, w.day)).toEqual([]);
    });

    it('hot goods cool after the configured days', () => {
        const w = makeWorld(50);
        const p = makePlayer({ inventory: { gems: 1 } });
        Underworld.markHot(p, 'gems', 1, 50);
        w.day = 50 + DataLoader.underworld.hotDays;
        Underworld.processDay(p, w);
        expect(Underworld.hotQty(p, 'gems', w.day)).toBe(0);
        expect(Trading.sellGoods(p, 'gems', 1, w.getTile(1, 0).settlement, w).success).toBe(true);
    });

    it('burglary loot goes through the capped inventory and is marked hot', () => {
        const w = makeWorld();
        const tile = w.getTile(1, 0);
        const p = makePlayer();
        member(p, 1);
        Utils.setRng(() => 0.0); // success, first loot pick, minimum qty
        const res = Underworld.doJob(p, w, tile, 'burglary');
        expect(res.outcome).toBe('success');
        const [item] = Object.keys(res.loot);
        expect(Underworld.hotQty(p, item, w.day)).toBe(res.loot[item]);

        // A full pack leaves the loot behind instead of overfilling
        const full = makePlayer();
        for (let i = 0; i < BASE_INVENTORY_SLOTS; i++) full.inventory[`good_${i}`] = 1;
        member(full, 1);
        const r2 = Underworld.doJob(full, w, tile, 'burglary');
        expect(r2.loot).toEqual({});
        expect(Object.keys(full.inventory)).toHaveLength(BASE_INVENTORY_SLOTS);
    });
});

describe('the thieves\' guild', () => {
    it('is found through a tavern contact in towns and cities', () => {
        const w = makeWorld();
        const p = makePlayer();
        const town = w.getTile(1, 0);
        expect(Tavern.getTavernOptions(p, town, w).some(o => o.id === 'underworld_contact')).toBe(true);
        expect(Underworld.hasGuildPresence(w.getTile(3, 0).settlement)).toBe(false);
        const out = Tavern.handleAction('underworld_contact', p, town, w);
        expect(out[0].openUnderworld).toBe(true);
        expect(p.underworld.guild.contactMet).toBe(true);
        expect(Underworld.joinGuild(p, w, town).success).toBe(true);
        expect(Underworld.getRank(p).name).toBe('Footpad');
        // The settlement action menu now offers the Underworld
        const actions = [];
        addSettlementActions(actions, p, town, w, { isCity: true });
        expect(actions.some(a => a.type === 'underworld')).toBe(true);
    });

    it('locks jobs by rank and promotes on standing', () => {
        const w = makeWorld();
        const p = makePlayer();
        member(p, 0);
        const jobs = Underworld.availableJobs(p, w, w.getTile(1, 0));
        expect(jobs.find(j => j.id === 'pickpocket').locked).toBeNull();
        expect(jobs.find(j => j.id === 'burglary').locked).toMatch(/Cutpurse/);
        expect(jobs.find(j => j.id === 'heist').locked).toMatch(/Shadow/);
        const promoted = Underworld._gainStanding(p, w, 60);
        expect(promoted.name).toBe('Prowler');
    });

    it('odds rise with Cunning and Deceitful and fall with guard strength', () => {
        const w = makeWorld();
        const p = makePlayer();
        member(p, 0);
        const village = w.getTile(3, 0).settlement;
        const capital = w.getTile(4, 0).settlement;
        expect(Underworld.jobOdds(p, w, capital, 'pickpocket')).toBeLessThan(Underworld.jobOdds(p, w, village, 'pickpocket'));
        const plain = Underworld.jobOdds(p, w, capital, 'pickpocket');
        Traits.getState(p).earned.cunning = true;
        Traits.getState(p).earned.deceitful = true;
        expect(Underworld.jobOdds(p, w, capital, 'pickpocket')).toBeCloseTo(plain + 0.14, 5);
    });

    it('criminal deeds feed traits and karma; getting caught spreads gossip and exposes the member', () => {
        const w = makeWorld();
        const p = makePlayer({ karma: 0 });
        member(p, 1);
        Utils.setRng(() => 0.0);
        Underworld.doJob(p, w, w.getTile(1, 0), 'pickpocket');
        expect(Traits.getState(p).deeds.cunning).toBeGreaterThan(0);
        expect(p.karma).toBeLessThan(0);
        Utils.setRng(() => 0.99); // the job fails, but not caught: away empty-handed
        expect(Underworld.doJob(p, w, w.getTile(1, 0), 'pickpocket').outcome).toBe('empty');
        let n = 0;
        Utils.setRng(() => (n++ === 0 ? 0.99 : 0.0)); // fail the job, get caught, arrested
        const caught = Underworld.doJob(p, w, w.getTile(1, 0), 'pickpocket');
        expect(caught.outcome).toBe('caught');
        expect(p.jailState).toBeTruthy();
        expect(p.gossip.rumors.some(r => r.type === 'theft')).toBe(true);
        expect(Underworld.isKnownMember(p)).toBe(true);
    });

    it('a known member is greeted differently by lords and townsfolk', () => {
        const p = makePlayer();
        member(p, 3);
        const honorable = { traits: ['honorable'] };
        const cunning = { traits: ['cunning'] };
        expect(PlayerEffects.lordOpinionBonus(p, honorable)).toBeLessThan(0);
        expect(PlayerEffects.lordOpinionBonus(p, cunning)).toBeGreaterThan(0);
        const guard = { type: 'guard' };
        const beggar = { type: 'beggar' };
        expect(NpcDisposition.gainMultiplier(guard, p)).toBeLessThan(NpcDisposition.gainMultiplier(beggar, p));
        const stranger = makePlayer();
        expect(PlayerEffects.lordOpinionBonus(stranger, honorable)).toBe(0);
    });

    it('rackets pay weekly; the Guildmaster takes a weekly cut', () => {
        const w = makeWorld(48);
        const p = makePlayer();
        member(p, 5);
        Utils.setRng(() => 0.0);
        const res = Underworld.doJob(p, w, w.getTile(1, 0), 'racket');
        expect(res.outcome).toBe('success');
        const gold = p.gold;
        w.day = 49;
        const tick = Underworld.processDay(p, w);
        const weekly = p.underworld.rackets[0].weekly;
        expect(tick.income).toBe(weekly + 150 + 25);
        expect(p.gold).toBe(gold + tick.income);
        w.day = 50;
        expect(Underworld.processDay(p, w).income).toBe(0);
    });

    it('a heist is planned step by step, then struck', () => {
        const w = makeWorld();
        const tile = w.getTile(4, 0);
        const p = makePlayer();
        member(p, 3);
        expect(Underworld.startHeist(p, w, tile, 'royal_treasury').success).toBe(true);
        const before = Underworld.heistOdds(p, w, tile);
        expect(Underworld.planStep(p, w, tile, 'case').success).toBe(true);
        expect(Underworld.planStep(p, w, tile, 'crew').success).toBe(true);
        expect(Underworld.planStep(p, w, w.getTile(1, 0), 'tools').success).toBe(false); // wrong town
        expect(Underworld.heistOdds(p, w, tile)).toBeGreaterThan(before);
        Utils.setRng(() => 0.0);
        const gold = p.gold;
        const res = Underworld.executeHeist(p, w, tile);
        expect(res.outcome).toBe('success');
        expect(p.gold).toBeGreaterThan(gold);
        expect(Underworld.getHeat(p, 'merathis')).toBeGreaterThanOrEqual(25);
        expect(p.underworld.heist).toBeNull();
    });

    it('is deterministic for a fixed seed', () => {
        const run = () => {
            Utils.setSeed(99);
            const w = makeWorld();
            const p = makePlayer();
            member(p, 1);
            const out = [];
            for (let i = 0; i < 6; i++) out.push(Underworld.doJob(p, w, w.getTile(1, 0), i % 2 ? 'burglary' : 'pickpocket').text);
            return out;
        };
        expect(run()).toEqual(run());
    });
});

describe('existing crimes feed heat', () => {
    it('piracy heats the realm whose waters it was', () => {
        const w = makeWorld();
        const p = makePlayer();
        expect(Underworld.recordPiracy(p, w, 4, 1)).toBe('merathis');
        expect(Underworld.getHeat(p, 'merathis')).toBeGreaterThan(0);
    });

    it('the smuggling, piracy and pickpocket paths call into the underworld', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = rel => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
        expect(src('player/playerEconomy/caravans.js')).toMatch(/Underworld\.recordCrime\(player, world, 'smuggling_route'/);
        expect(src('systems/ships.js')).toMatch(/Underworld\.recordPiracy\(/);
        expect(src('player/playerMilitary/combat.js')).toMatch(/Underworld\.record(Crime|Piracy)\(/);
        expect(src('ui/actionMenu/skills.js')).toMatch(/Underworld\.recordCrime\(player, game\.world, 'smuggling'/);
        expect(src('ui/game/endDay.js')).toMatch(/Underworld\.onEnterSettlement\(/);
        expect(src('ui/game/endDay.js')).toMatch(/Underworld\.processDay\(/);
    });
});

describe('save and load', () => {
    it('round-trips the underworld state', () => {
        const w = makeWorld();
        const p = makePlayer();
        member(p, 2);
        Underworld.addHeat(p, 'merathis', 33, w);
        Underworld.markHot(p, 'silk', 2, 50);
        p.underworld.rackets.push({ key: '1,0', name: 'Tidewatch', kingdom: 'merathis', q: 1, r: 0, weekly: 80, sinceDay: 10 });
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(Underworld.getHeat(back, 'merathis')).toBe(33);
        expect(back.underworld.guild.rank).toBe(2);
        expect(back.underworld.hot).toEqual([{ item: 'silk', qty: 2, untilDay: 50 + DataLoader.underworld.hotDays }]);
        expect(back.underworld.rackets[0].weekly).toBe(80);
    });

    it('backfills a blank record for older saves', () => {
        const data = SaveLoad.serializePlayer(new Player());
        delete data.underworld;
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(back.underworld.heat).toEqual({});
        expect(back.underworld.guild.member).toBe(false);
        expect(Array.isArray(back.underworld.hot)).toBe(true);
    });
});
