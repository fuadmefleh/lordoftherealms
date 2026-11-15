// The 2026-11-14 playability follow-ups (TODO.md "From the playability pass"):
//   - a landed origin keeps a home at its seat (player/scenarios.js _home →
//     systems/housing.js grantHouse): it sleeps under its own roof, not an
//     inn's; a royal residence is kept by the treasury, a guildmaster's house
//     by the hall;
//   - a small map's great lord has lands worth a great lord's (_makeUpLands);
//   - a long wait stops only for a letter that will not wait (CourtLetters.pressing);
//   - a band takes what it can carry off, not a share of any fortune, and the
//     coin is the band's; bounty hunters take you, not your purse;
//   - the crown's House shows its role; rival retinues buy boots, leg harness
//     and gloves.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Scenarios } from '../player/scenarios.js';
import { Housing } from '../systems/housing.js';
import { Estates } from '../world/estates.js';
import { Throne } from '../systems/throne.js';
import { Guilds } from '../systems/guilds.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { TimeSkip } from '../ui/timeSkip.js';
import { RoadEncounters } from '../player/roadEncounters.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { Arms } from '../systems/arms.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function origin(seed, id, kingdomCount = 4) {
    const g = newGame(seed, { kingdomCount });
    const report = Scenarios.apply(g.player, g.world, { origin: id });
    return { g, p: g.player, w: g.world, report };
}

const estRent = (w, e) => {
    const t = Estates._liveOfKey(w, e.town);
    return (Number(t && t.population) || 0) * e.share * 0.3;
};

describe('a home at the seat', () => {
    it('the great lord sleeps in the family manor, free of an inn; its upkeep goes to the town', () => {
        const { g, p, w, report } = origin(33, 'great_lord');
        const seat = p.scenario.start.seat;
        const house = Housing.getHouseAt(p, seat.q, seat.r);
        expect(house).toBeTruthy();
        expect(p.q).toBe(seat.q);
        expect(TimeSkip.lodgingPlan(g).kind).toBe('house');
        expect(report.welcome).toMatch(/your own roof/);
        const tile = w.getTile(seat.q, seat.r);
        Economy.initSettlement(tile.settlement);
        const gold0 = p.gold, town0 = tile.settlement.economy.gold;
        Housing.processDaily(p, w);
        const paid = gold0 - p.gold;
        expect(paid).toBeGreaterThan(0);
        expect(tile.settlement.economy.gold - town0).toBeCloseTo(paid, 5);
    });

    it('the monarch\'s royal apartments are kept by the treasury, and are not the monarch\'s to sell', () => {
        const { g, p, w } = origin(61, 'monarch', 10);
        const k = Throne.ruledKingdom(p, w);
        const house = Housing.getHouseAt(p, k.capital.q, k.capital.r);
        expect(house).toBeTruthy();
        expect(house.keptBy).toBe(k.id);
        expect(TimeSkip.lodgingPlan(g).kind).toBe('house');
        const gold0 = p.gold, t0 = k.treasury;
        Housing.processDaily(p, w);
        expect(p.gold).toBe(gold0);
        expect(k.treasury).toBeLessThan(t0);
        expect(Housing.sellHouse(p, house.q, house.r, w).success).toBe(false);
        // (a deposed monarch pays for it like anyone)
        p.throne.ruling = null;
        Housing.processDaily(p, w);
        expect(p.gold).toBeLessThan(gold0);
    });

    it('the high priest has the see\'s residence; the guildmaster a house the hall keeps', () => {
        const hp = origin(71, 'high_priest');
        const see = hp.p.scenario.start.seat;
        expect(Housing.getHouseAt(hp.p, see.q, see.r)).toBeTruthy();
        const gm = origin(72, 'guildmaster');
        const st = gm.p.scenario.start;
        const house = Housing.getHouseAt(gm.p, st.q, st.r);
        expect(house).toBeTruthy();
        expect(house.keptBy).toEqual({ guild: st.guild });
        const guild = Guilds.guild(gm.w.getTile(st.q, st.r).settlement, st.guild);
        const gold0 = gm.p.gold, t0 = guild.treasury;
        Housing.processDaily(gm.p, gm.w);
        expect(gm.p.gold).toBe(gold0);
        expect(guild.treasury).toBeLessThan(t0);
        // ...and a house survives a save as it was
        expect(JSON.parse(JSON.stringify(gm.p.houses))).toEqual(gm.p.houses);
    });

    it('a granted home falls back to what the town allows', () => {
        const { w, p } = origin(33, 'wanderer');
        const v = w.getSettlementViews().find(s => s.type === 'village');
        if (!v) return;
        const h = Housing.grantHouse(p, w, v.q, v.r, 'manor');
        expect(h).toBeTruthy();
        expect(Housing.getHouseType(h.typeId).availableIn).toContain('village');
        expect(Housing.grantHouse(p, w, v.q, v.r, 'manor')).toBe(h);
    });
});

describe('a great lord\'s lands on a small map', () => {
    it('are made up to the expected rent from the realm\'s own estates, nothing minted', () => {
        for (const seed of [11, 33, 44]) {
            const g = newGame(seed, { kingdomCount: 10 });
            Estates.derive(g.world, g.world.day);
            const total0 = Object.keys(Estates.state(g.world).estates).length;
            Scenarios.apply(g.player, g.world, { origin: 'great_lord' });
            const st = Estates.state(g.world);
            const mine = Object.values(st.estates).filter(e => e.holder === 'player');
            const E = Scenarios.origin('great_lord').estates;
            const expect$ = mine.reduce((s, e) => s + estRent(g.world, e), 0);
            expect(mine.length).toBeGreaterThan(0);
            expect(mine.length).toBeLessThanOrEqual(E.max);
            expect(expect$ >= E.rentTarget || mine.length === E.max
                || Object.values(st.estates).every(e => e.holder === 'player' || st.towns[e.town].kid !== g.player.scenario.realm
                    || !['noble', 'crown'].includes(Estates.kindOf(e.holder)))).toBe(true);
            expect(mine.length).toBe(g.player.scenario.start.estates);
            expect(Object.keys(st.estates).length).toBe(total0);
            for (const e of mine) expect(st.towns[e.town].kid).toBe(g.player.scenario.realm);
        }
    });
});

describe('the Wait and the letters', () => {
    function waiting(seed = 4242) {
        const g = newGame(seed);
        g.player.needs = { hunger: 100, energy: 100, social: 100, fun: 100, hygiene: 100, comfort: 100 };
        return g;
    }
    const letter = (w, kind, days = 10) => ({
        id: 0, kind, day: w.day, expires: w.day + days, from: { name: 'Lord Test', type: 'lord' }, key: `test:${kind}:${w.day}`,
        vars: {}, data: {}, subject: `A ${kind}`, body: '…', read: false,
    });

    it('an invitation keeps in the inbox while you wait; a call to arms stops the wait', () => {
        const g = waiting();
        const before = TimeSkip.snapshot(g);
        CourtLetters.deliver(g.player, letter(g.world, 'feast_invite'));
        CourtLetters.deliver(g.player, letter(g.world, 'loan_request'));
        expect(TimeSkip.check(g, before)).toBe(null);
        CourtLetters.deliver(g.player, letter(g.world, 'call_to_arms'));
        const stop = TimeSkip.check(g, before);
        expect(stop && stop.reason).toMatch(/wants an answer: A call_to_arms/);
    });

    it('a pressing letter left waiting stops the wait once more as its deadline nears; others never do', () => {
        const g = waiting();
        CourtLetters.deliver(g.player, letter(g.world, 'rival_tribute', 6));
        CourtLetters.deliver(g.player, letter(g.world, 'office_offer', 3));
        const before = TimeSkip.snapshot(g);
        expect(TimeSkip.check(g, before)).toBe(null);
        g.world.day += 4;
        const stop = TimeSkip.check(g, before);
        expect(stop && stop.reason).toMatch(/answer is due in 2 days/);
        const after = TimeSkip.snapshot(g);
        g.world.day += 1;
        expect(TimeSkip.check(g, after)).toBe(null);
        expect(CourtLetters.pressing({ kind: 'coalition_ultimatum' })).toBe(true);
        expect(CourtLetters.pressing({ kind: 'child_news' })).toBe(false);
    });
});

describe('robbed on the road', () => {
    const band = (over = {}) => ({ id: 'u1', type: 'raider', name: 'Raider Band', strength: 15, inventory: {}, ...over });

    it('a band takes what it can carry off, not a share of a fortune, into its own packs', () => {
        const g = newGame(4242);
        const p = g.player;
        p.army = [];
        const cap = RoadEncounters.robCap(p, 15);
        expect(cap).toBe(80 + 12 * 15);
        for (let i = 0; i < 5; i++) {
            p.gold = 20000;
            const u = band();
            const r = RoadEncounters.ambush(p, u, g.world);
            expect(r.kind).toBe('robbed');
            expect(r.goldStolen).toBeGreaterThan(0);
            expect(r.goldStolen).toBeLessThanOrEqual(cap);
            expect(u.inventory.gold).toBe(r.goldStolen);
            expect(p.gold).toBe(20000 - r.goldStolen);
        }
        // a light purse loses its share, as before
        p.gold = 100;
        const r = RoadEncounters.ambush(p, band(), g.world);
        expect(r.goldStolen).toBeLessThanOrEqual(40);
        // and the toll is the cheaper way past
        p.gold = 20000;
        expect(RoadEncounters.tollAmount(p, { hasArmy: false, enemyStrength: 15 })).toBeLessThan(cap);
        p.gold = 100;
        const toll = RoadEncounters.tollAmount(p, { hasArmy: false, enemyStrength: 15 });
        expect(toll).toBeGreaterThan(15);
        expect(toll).toBeLessThanOrEqual(25);
    });

    it('bounty hunters run you down to the cells and leave your purse alone', () => {
        const g = newGame(4242);
        const p = g.player;
        p.army = [];
        p.gold = 5000;
        const k = g.world.kingdoms.find(x => x.isAlive && x.capital);
        const u = band({ type: 'bounty_hunters', bountyHunt: true, kingdomId: k.id, captain: 'Hask' });
        const r = RoadEncounters.ambush(p, u, g.world);
        expect(r.kind).toBe('taken');
        expect(r.goldStolen).toBe(0);
        expect(p.gold).toBe(5000);
        expect(p.jailState).toBeTruthy();
    });

    it('captured after a lost fight, the coin taken goes to the captors, as much as they carry', () => {
        const g = newGame(4242);
        const p = g.player;
        let seed = 1;
        let res = null;
        const purse = { gold: 0 };
        while (seed < 200) {
            Utils.setSeed(seed++);
            p.army = [];
            p.gold = 50000;
            p.indenturedServitude = null;
            purse.gold = 0;
            res = PlayerMilitary._battleSpoils(p, false, 20, { lootPurse: purse }, 'Raiders');
            if (res.captured) break;
        }
        expect(res.captured).toBe(true);
        expect(res.goldConfiscated).toBeGreaterThan(0);
        expect(res.goldConfiscated).toBeLessThanOrEqual(2 * (80 + 12 * 20));
        expect(purse.gold).toBe(res.goldConfiscated);
        expect(p.gold).toBe(50000 - res.goldConfiscated);
    });
});

describe('the rival Houses', () => {
    it('the crown\'s House shows its role in the panels\' view', () => {
        const { p, w } = origin(33, 'great_lord');
        const r = Object.values(p.house.rivals).find(x => x.role);
        expect(r).toBeTruthy();
        expect(r.name).not.toMatch(/,/);
        RivalHouses.ensure && RivalHouses.ensure(p, w, r);
        if (r.head) expect(RivalHouses.view(p, w, r).role).toBe(r.role);
    });

    it('a retinue buys boots, leg harness and gloves after the core four, and wears them', () => {
        const game = newGame(4242);
        const s = game.world.getSettlementViews().find(x => x.type === 'town' || x.type === 'city');
        const live = game.world.getTile(s.q, s.r).settlement;
        SettlementMarket.ensure(live);
        Economy.initSettlement(live);
        for (const id of ['weapons', 'shield', 'helmet', 'gambeson', 'boots', 'padded_chausses', 'leather_gloves']) live.market.stock[id] = 30;
        const r = { kingdomId: 'k1', name: 'House Test', houseKey: 'k1:0', guard: 2, renown: 0, gold: 20000, head: { intrigue: 4, martial: 6, age: 40, traits: [] } };
        // (a household of old: the core four only — and it fights exactly as before the extras)
        const old = RivalHouses.arms(r);
        expect(Object.keys(old.stock).sort()).toEqual(['gambeson', 'helmet', 'shield', 'weapons']);
        const f0 = RivalHouses.armsFactor(r);
        const prot0 = RivalHouses.duelist(r).armour;
        RivalHouses._buyArms(game.world, r, live);
        const kit = RivalHouses.kitView(r);
        expect(kit.feet).toBe('boots');
        expect(kit.legs).toBeTruthy();
        expect(kit.hands).toBe('leather_gloves');
        expect(Arms.KIT_EXTRA_SLOTS.every(sl => kit[sl])).toBe(true);
        expect(RivalHouses.armsFactor(r)).toBeGreaterThan(f0);
        expect(RivalHouses.duelist(r).armour).toBeGreaterThan(prot0);
        expect(RivalHouses.armsLabel(r)).toMatch(/Leather Boots/);
    });
});
