// Pass 14 — gaps left by the previous pass, closed with real readers:
//   - the Crown monopolies edict lays real settlement.monopolies on the
//     realm's towns: prices rise, trading companies are barred, the markup
//     reaches the royal treasury, and they go with the edict or the crown
//   - the Famine dole answers actual hunger (the lean weeks, a famine event):
//     grain shipped, paid for in proportion, unrest, stability and the
//     famine's toll on the people relieved — and costs nothing in good times
//   - a lost crown's royal-court record survives in the House (crownLedger,
//     Deeds, the reign's Legacy record) and round-trips a save
//   - the quest board is refreshed weekly: stale postings come down and a
//     short board refills, deterministically

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Deeds } from '../systems/deeds.js';
import { Legacy } from '../systems/legacy.js';
import { Quests } from '../systems/quests.js';
import { Achievements } from '../systems/achievements.js';
import { Trading } from '../player/playerEconomy/trading.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    Utils.resetRng();
});

/** A crowned player (the realm with the most towns), court opened. */
function crowned(seed = 11) {
    const game = newGame(seed);
    const { world, player } = game;
    const all = world.getAllSettlements();
    const k = world.kingdoms.filter(x => x.isAlive)
        .sort((a, b) => all.filter(s => s.kingdom === b.id).length - all.filter(s => s.kingdom === a.id).length)[0];
    Throne._takeThrone(player, world, k);
    k.treasury = 20000;
    Kingship.processDay(world, player);
    const towns = Throne._settlementsOf(world, k);
    return { ...game, k, towns };
}

const crownMonos = (world) => world.getSettlementViews()
    .flatMap(s => Object.entries(s.monopolies || {}).filter(([, m]) => m.holder === 'crown').map(([g]) => ({ s, g })));

// ── 1. Crown monopolies ─────────────────────────────────────────────

describe('Crown monopolies are real monopolies', () => {
    it('the edict lays a crown monopoly on each of its goods in every town of the realm, and repeal lifts them', () => {
        const { world, player, k, towns } = crowned();
        const goods = Kingship.edicts().crown_monopolies.monopoly.goods;
        expect(goods.length).toBeGreaterThan(0);
        expect(crownMonos(world)).toHaveLength(0);
        expect(Kingship.passEdict(player, world, 'crown_monopolies').success).toBe(true);
        for (const e of towns) {
            for (const g of goods) {
                expect(Economy.monopolyHolder(e.settlement, g), `${e.settlement.name} ${g}`).toBe('crown');
                expect(e.settlement.monopolies[g].kingdomId).toBe(k.id);
            }
        }
        // Only the realm's towns
        expect(crownMonos(world).every(x => x.s.kingdom === k.id)).toBe(true);
        expect(KingdomBonuses.crownEffect(k, 'crownMonopoly')).toBeGreaterThan(0);
        Kingship.revokeEdict(player, world, 'crown_monopolies');
        expect(crownMonos(world)).toHaveLength(0);
    });

    it('a guild\'s or a house\'s charter already in a town stands', () => {
        const { world, player, towns } = crowned();
        const s = towns[0].settlement;
        s.monopolies = { salt: { holder: 'guild', holderName: 'The Salters', sinceDay: 0, untilDay: null } };
        Kingship.passEdict(player, world, 'crown_monopolies');
        expect(s.monopolies.salt.holder).toBe('guild');
        expect(s.monopolies.iron.holder).toBe('crown');
    });

    it('prices react: the market asks the markup more, and the player may still buy', () => {
        const { world, player, towns } = crowned();
        const e = towns.find(x => Trading.getAvailableGoods(x.settlement, x.tile, world).some(g => ['iron', 'salt', 'wine', 'tools', 'weapons', 'liquor'].includes(g.id)));
        expect(e).toBeTruthy();
        const pick = Trading.getAvailableGoods(e.settlement, e.tile, world).find(g => ['iron', 'salt', 'wine', 'tools', 'weapons', 'liquor'].includes(g.id));
        const before = pick.price;
        Kingship.passEdict(player, world, 'crown_monopolies');
        const after = Trading.getAvailableGoods(e.settlement, e.tile, world).find(g => g.id === pick.id);
        const markup = Kingship.edicts().crown_monopolies.monopoly.markup;
        expect(after.price).toBeGreaterThan(before);
        expect(after.price).toBeGreaterThanOrEqual(Math.floor(before * (1 + markup)) - 1);
        // The crown's monopoly is the player's own: no bar on the player's trade
        expect(Trading.monopolyBlock(e.settlement, pick.id)).toBe(null);
    });

    it('the markup the player pays reaches the royal treasury', () => {
        const { world, player, k, towns } = crowned();
        Kingship.passEdict(player, world, 'crown_monopolies');
        const e = towns.find(x => Trading.getAvailableGoods(x.settlement, x.tile, world).some(g => ['iron', 'salt', 'wine', 'tools', 'weapons', 'liquor'].includes(g.id) && g.quantity > 0));
        expect(e).toBeTruthy();
        const good = Trading.getAvailableGoods(e.settlement, e.tile, world).find(g => ['iron', 'salt', 'wine', 'tools', 'weapons', 'liquor'].includes(g.id) && g.quantity > 0);
        player.gold = 100000;
        const res = Trading.buyGoods(player, good, 1, e.settlement);
        expect(res.success).toBe(true);
        expect(e.settlement.monopolies[good.id].revenue).toBeGreaterThan(0);
        const t0 = k.treasury;
        const sync = Kingship.syncCrownMonopolies(player, world);
        expect(sync.revenue).toBeGreaterThan(0);
        expect(k.treasury).toBe(t0 + sync.revenue);
        expect(Kingship.court(player).stats.monopolyRevenue).toBe(sync.revenue);
        expect(e.settlement.monopolies[good.id].revenue).toBe(0);
    });

    it('a trading company may not deal in a crown good in the realm', () => {
        const { world, player, towns } = crowned();
        Kingship.passEdict(player, world, 'crown_monopolies');
        const e = towns[0];
        expect(MerchantHouses.factorBuyUnit(player, world, e.tile, 'iron')).toBe(null);
        expect(MerchantHouses.factorSaleUnit(player, world, e.tile, 'iron', 1)).toBe(0);
    });

    it('lapse with the crown: the weekly monopoly sweep clears crown monopolies once the realm is no longer ruled', () => {
        const { world, player, k } = crowned();
        Kingship.passEdict(player, world, 'crown_monopolies');
        expect(crownMonos(world).length).toBeGreaterThan(0);
        // The edict stays in force: the weekly sweep keeps them
        MerchantHouses.expireMonopolies(player, world);
        expect(crownMonos(world).length).toBeGreaterThan(0);
        Throne.abdicate(player, world);
        expect(KingdomBonuses.crownEffect(k, 'crownMonopoly')).toBe(0);
        MerchantHouses.expireMonopolies(player, world);
        expect(crownMonos(world)).toHaveLength(0);
    });

    it('crown monopolies survive a save', () => {
        const game = crowned();
        Kingship.passEdict(game.player, game.world, 'crown_monopolies');
        const n = crownMonos(game.world).length;
        const back = roundTrip(game);
        expect(crownMonos(back.world)).toHaveLength(n);
    });
});

// ── 2. The famine dole ─────────────────────────────────────────────

describe('The famine dole answers real hunger', () => {
    function hungry(game, { lean = true } = {}) {
        const { world, towns } = game;
        world.day = lean ? 110 : 60; // day-of-year 106-120 is the lean season
        world.activeEvents = [];
        const e = towns[0];
        Economy.initSettlement(e.settlement);
        e.settlement.economy.food = 0;
        e.settlement.leanMood = 6;
        e.settlement.happiness = 40;
        for (const x of towns.slice(1)) { Economy.initSettlement(x.settlement); x.settlement.economy.food = 1e6; delete x.settlement.leanMood; }
        return e;
    }

    it('costs nothing and does nothing in good times', () => {
        const game = crowned();
        const { world, player, k, towns } = game;
        Kingship.passEdict(player, world, 'famine_dole');
        world.day = 60;
        world.activeEvents = [];
        for (const x of towns) { Economy.initSettlement(x.settlement); x.settlement.economy.food = 1e6; delete x.settlement.leanMood; }
        const t0 = k.treasury;
        const res = Kingship._famineDole(player, world, Kingship.court(player), k, { notices: [] });
        expect(res.grain).toBe(0);
        expect(k.treasury).toBe(t0);
    });

    it('in the lean weeks ships grain to a town short of stores, paid from the treasury, and eases its unrest', () => {
        const game = crowned();
        const { world, player, k } = game;
        const e = hungry(game);
        // Without the edict: no hunger relief
        expect(Kingship.hunger(world, e)).toBe('lean');
        const t0 = k.treasury;
        Kingship._famineDole(player, world, Kingship.court(player), k, { notices: [] });
        expect(k.treasury).toBe(t0);
        expect(e.settlement.economy.food).toBe(0);

        Kingship.passEdict(player, world, 'famine_dole');
        const t1 = k.treasury;
        const res = Kingship._famineDole(player, world, Kingship.court(player), k, { notices: [] });
        expect(res.towns).toBe(1);
        expect(res.grain).toBeGreaterThan(0);
        expect(e.settlement.economy.food).toBe(res.grain);
        const price = Kingship.edicts().famine_dole.dole.grainPrice;
        expect(res.gold).toBe(Math.ceil(res.grain * price));
        expect(k.treasury).toBe(t1 - res.gold);
        expect(e.settlement.leanMood).toBeLessThan(6);
        expect(e.settlement.happiness).toBeGreaterThan(40);
        expect(Kingship.court(player).stats.doleGrain).toBe(res.grain);
    });

    it('relief is proportional to what the treasury can pay', () => {
        const game = crowned();
        const { world, player, k } = game;
        const e = hungry(game);
        Kingship.passEdict(player, world, 'famine_dole');
        k.treasury = 3; // a few units of grain at most
        const out = { notices: [] };
        const res = Kingship._famineDole(player, world, Kingship.court(player), k, out);
        expect(res.short).toBe(true);
        expect(k.treasury).toBeGreaterThanOrEqual(0);
        expect(6 - (e.settlement.leanMood || 0)).toBeLessThan(1); // only part of a point eased
        expect(out.notices.some(n => n.title === 'The Dole Runs Short')).toBe(true);
    });

    it('in a famine it steadies the realm and gives back the famine\'s toll on the people', () => {
        const game = crowned();
        const { world, player, k, towns } = game;
        hungry(game, { lean: false });
        const e = towns[0];
        world.activeEvents = [{ id: 'famine', kingdomId: k.id, effects: { populationGrowth: -0.3, stability: -6 }, daysLeft: 10 }];
        expect(Kingship.hunger(world, e)).toBe('famine');
        // A stocked town in the famine still draws the day's bread
        expect(Kingship.hunger(world, towns[1])).toBe('famine');
        Kingship.passEdict(player, world, 'famine_dole');
        k.stability = 40;
        e.settlement.population = 100000;
        const pop0 = e.settlement.population;
        const res = Kingship._famineDole(player, world, Kingship.court(player), k, { notices: [] });
        expect(res.towns).toBe(towns.length);
        expect(res.gold).toBeGreaterThan(0);
        expect(k.stability).toBeGreaterThan(40);
        expect(e.settlement.population).toBeGreaterThan(pop0);
    });

    it('runs in the daily tick', () => {
        const game = crowned();
        const { world, player, k } = game;
        const e = hungry(game);
        Kingship.passEdict(player, world, 'famine_dole');
        Kingship.processDay(world, player);
        expect(e.settlement.economy.food).toBeGreaterThan(0);
        expect(Kingship.court(player).lastDole.grain).toBeGreaterThan(0);
        expect(k.treasury).toBeLessThan(20000);
    });
});

// ── 3. A lost crown's record survives ───────────────────────────────

describe('The royal court\'s record outlives the crown', () => {
    it('abdicating files the reign in the House crown ledger and a chronicle entry', () => {
        const { world, player, k } = crowned();
        Kingship.passEdict(player, world, 'conscription');
        Kingship.court(player).stats.revoltsCrushed = 2;
        world.day += 30;
        expect(Throne.abdicate(player, world).success).toBe(true);
        expect(player.throne.ruling).toBe(null);
        const L = player.house.crownLedger;
        expect(L.records).toHaveLength(1);
        const rec = L.records[0];
        expect(rec.kingdomName).toBe(k.name);
        expect(rec.how).toBe('abdicated');
        expect(rec.stats.edictsPassed).toBe(1);
        expect(rec.stats.revoltsCrushed).toBe(2);
        expect(rec.edicts).toContain('conscription');
        expect(rec.days).toBeGreaterThanOrEqual(30);
        expect(L.totals.reignsEnded).toBe(1);
        expect(player.house.history.some(h => /reign over/.test(h.text) && h.tags.includes('court'))).toBe(true);
    });

    it('Deeds keeps the lifetime court tallies after the crown is gone', () => {
        const { world, player } = crowned();
        Kingship.passEdict(player, world, 'conscription');
        Kingship.court(player).stats.feasts = 3;
        const before = Deeds.collect(player);
        Throne.abdicate(player, world);
        const after = Deeds.collect(player);
        expect(after['kingship.edictsPassed']).toBe(before['kingship.edictsPassed']);
        expect(after['kingship.feasts']).toBe(3);
        expect(after['kingship.reignsEnded']).toBe(1);
        // ...and a second crown adds to them
        const k2 = world.kingdoms.find(x => x.isAlive && x.id !== player.house.crownLedger.records[0].kingdomId);
        Throne._takeThrone(player, world, k2);
        k2.treasury = 5000;
        Kingship.processDay(world, player);
        Kingship.passEdict(player, world, 'patronage');
        expect(Deeds.collect(player)['kingship.edictsPassed']).toBe(2);
    });

    it('a realm that falls files its reign too', () => {
        const { world, player, k } = crowned();
        Kingship.court(player).stats.lordsBroken = 1;
        k.isAlive = false;
        Throne.processDaily(player, world, {});
        expect(player.throne.ruling).toBe(null);
        expect(player.house.crownLedger.records[0].how).toBe('fell');
        expect(Deeds.collect(player)['kingship.lordsBroken']).toBe(1);
    });

    it('the reign\'s Legacy record carries the court it kept and the crown it lost', () => {
        const { world, player, k } = crowned();
        Legacy.openReign(player, world);
        Kingship.passEdict(player, world, 'conscription');
        Throne.abdicate(player, world);
        const rec = Legacy.summarize(player, world);
        expect(rec.court.edictsPassed).toBe(1);
        expect(rec.crownsLost).toEqual([expect.objectContaining({ kingdomName: k.name, how: 'abdicated' })]);
    });

    it('the ledger round-trips a save', () => {
        const game = crowned();
        Kingship.passEdict(game.player, game.world, 'conscription');
        Throne.abdicate(game.player, game.world);
        const back = roundTrip(game);
        expect(back.player.house.crownLedger).toEqual(game.player.house.crownLedger);
        expect(Deeds.collect(back.player)['kingship.edictsPassed']).toBe(1);
    });
});

// ── 4. The quest board refreshes ────────────────────────────────────

describe('The quest board refills and sheds stale postings', () => {
    it('postings are dated when the world is known, and come down after their time', () => {
        const game = newGame(7);
        const { world, player } = game;
        world.day = 10;
        Quests.updateProgress(player, world);
        const board = player.quests.available;
        expect(board.length).toBeGreaterThan(0);
        for (const q of board) expect(q.postedDay).toBe(10);
        const ids = board.filter(q => typeof q.expiresDay === 'number').map(q => q.id);
        expect(ids.length).toBeGreaterThan(0);
        // A week on, nothing stale yet
        world.day = 17;
        Quests.updateProgress(player, world);
        expect(player.quests.available.map(q => q.id)).toEqual(expect.arrayContaining(ids));
        // Past their time: down, resting, and the board refilled
        world.day = 10 + Quests.OFFER_TTL_DAYS + 1;
        Quests.updateProgress(player, world);
        const now = player.quests.available.map(q => q.id);
        for (const id of ids) {
            expect(now).not.toContain(id);
            expect(player.quests.expired[id]).toBeGreaterThan(world.day);
        }
        expect(now.length).toBeGreaterThan(0);
    });

    it('a short board is refilled at the weekly refresh, not only on accept/complete/drop', () => {
        const game = newGame(7);
        const { world, player } = game;
        world.day = 10;
        Quests.updateProgress(player, world);
        player.quests.available = player.quests.available.slice(0, 1);
        world.day = 12; // mid-week: no refresh
        Quests.updateProgress(player, world);
        expect(player.quests.available).toHaveLength(1);
        world.day = 17;
        Quests.updateProgress(player, world);
        expect(player.quests.available.length).toBeGreaterThan(1);
    });

    it('is deterministic for a seed', () => {
        const run = () => {
            const game = newGame(7);
            const { world, player } = game;
            for (let d = 10; d <= 80; d++) { world.day = d; Quests.updateProgress(player, world); }
            return player.quests.available.map(q => `${q.id}@${q.postedDay}`);
        };
        expect(run()).toEqual(run());
    });

    it('an accepted quest leaves its posting dates behind; the board state round-trips a save', () => {
        const game = newGame(7);
        const { world, player } = game;
        world.day = 10;
        Quests.updateProgress(player, world);
        const q = player.quests.available[0];
        Quests.acceptQuest(player, q.id, world);
        const active = player.quests.active.find(a => a.id === q.id);
        expect(active.expiresDay).toBeUndefined();
        world.day = 10 + Quests.OFFER_TTL_DAYS + 1;
        Quests.updateProgress(player, world);
        const back = roundTrip(game);
        expect(back.player.quests.lastBoardDay).toBe(player.quests.lastBoardDay);
        expect(back.player.quests.expired).toEqual(player.quests.expired);
        expect(back.player.quests.available.map(a => a.expiresDay)).toEqual(player.quests.available.map(a => a.expiresDay));
    });
});

// ── 5. Hollow sweep of the newest systems ───────────────────────────

describe('NPC tasks credit the giver and the realm', () => {
    function townGame() {
        const game = newGame(7);
        const { world, player } = game;
        const s = world.getAllSettlements().find(x => x.kingdom);
        player.q = s.q; player.r = s.r;
        return { ...game, kingdomId: s.kingdom };
    }

    it('a "reputation" task earns standing with the realm it was given in', () => {
        const { world, player, kingdomId } = townGame();
        const res = Quests.createNpcTask(player, { text: 'Spread the word.', type: 'explore_ruins', reward: 'reputation' }, { id: 41, name: 'Edda' }, world);
        expect(res.success).toBe(true);
        expect(res.quest.rewards.reputation).toEqual({ kingdomId, amount: Quests.NPC_TASK_REWARDS.reputation.reputation });
        expect(Quests.describeRewards(res.quest.rewards)).toMatch(/reputation/);
        const rep0 = (player.reputation && player.reputation[kingdomId]) || 0;
        Quests.track(player, 'ruins_explored');
        const done = Quests.updateProgress(player, world);
        expect(done.map(q => q.id)).toContain(res.quest.id);
        expect(player.reputation[kingdomId]).toBe(Math.min(100, rep0 + Quests.NPC_TASK_REWARDS.reputation.reputation));
    });

    it('outside any realm the standing is simply not offered', () => {
        const player = { quests: null, gold: 0, renown: 0, karma: 0, inventory: {} };
        const res = Quests.createNpcTask(player, { text: 'x', type: 'explore_ruins', reward: 'reputation' }, { id: 1, name: 'A' }, null);
        expect(res.quest.rewards.reputation).toBeUndefined();
    });

    it('the giver owes thanks once the task is done, collected the next time you speak', () => {
        const { world, player } = townGame();
        const res = Quests.createNpcTask(player, { text: 'x', type: 'explore_ruins', reward: 'gold' }, { id: 42, name: 'Bran' }, world);
        expect(Quests.collectThanks(player, { id: 42, name: 'Bran' })).toBe(null);
        Quests.track(player, 'ruins_explored');
        Quests.updateProgress(player, world);
        expect(Quests.collectThanks(player, { id: 42, name: 'Someone Else' })).toBe(null);
        const t = Quests.collectThanks(player, { id: 42, name: 'Bran' });
        expect(t).toEqual(expect.objectContaining({ name: 'Bran', title: res.quest.title }));
        expect(Quests.collectThanks(player, { id: 42, name: 'Bran' })).toBe(null);
    });
});

describe('Heralds, achievements and cultural buildings are read', () => {
    it('the heralds\' tallies show in Deeds & Records', () => {
        const player = { heralds: { stats: { proclaimed: 7, cried: 3 } } };
        const d = Deeds.collect(player);
        expect(d['heralds.proclaimed']).toBe(7);
        expect(d['heralds.cried']).toBe(3);
        const sec = Deeds.sections(player).find(s => s.id === 'heralds');
        expect(sec.empty).toBe(false);
    });

    it('an unlocked achievement records its day, and the listing reads it by tier', () => {
        const game = newGame(7);
        const { world, player } = game;
        world.day = 33;
        player.gold = 1500;
        const got = Achievements.checkAchievements(player, world);
        expect(got.some(a => a.id === 'first_fortune')).toBe(true);
        expect(player.achievements.progress.FIRST_FORTUNE.day).toBe(33);
        const list = Achievements.listing(player);
        expect(list.tiers.map(t => t.tier)).toEqual(Achievements.TIERS);
        const item = list.tiers.flatMap(t => t.items).find(i => i.key === 'FIRST_FORTUNE');
        expect(item).toEqual(expect.objectContaining({ unlocked: true, day: 33 }));
        expect(list.progress.unlocked).toBe(player.achievements.unlocked.length);
        // Every achievement appears once
        expect(list.tiers.reduce((s, t) => s + t.items.length, 0)).toBe(Object.keys(Achievements.ACHIEVEMENTS).length);
    });

    it('the player\'s cultural buildings survive a save (income, construction, Patron of the Arts)', () => {
        const game = newGame(7);
        game.player.culturalBuildings = [{ q: 3, r: 4, type: 'theater' }];
        const back = roundTrip(game);
        expect(back.player.culturalBuildings).toEqual([{ q: 3, r: 4, type: 'theater' }]);
    });
});
