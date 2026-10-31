// Devotion and hospitality: prayer/meditation by faith and place with
// diminishing returns, vows, omens, alms by recipient, declared pilgrimages
// (the pilgrim pays), the soul pact's storyline, real books, planned feasts —
// on a real generated world from the playtest harness.
import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Devotion } from '../systems/devotion.js';
import { SoulPact } from '../systems/soulPact.js';
import { Books } from '../systems/books.js';
import { Feasts } from '../systems/feasts.js';
import { Religion } from '../systems/religion.js';
import { Traits } from '../systems/traits.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Tavern } from '../player/tavern.js';
import { loadData, newGame } from './playtest/harness.js';

let game;

function townTile(world, pred = () => true) {
    for (const s of world.getSettlementViews()) {
        const t = world.getTile(s.q, s.r);
        if (t && t.settlement && pred(t, s)) return t;
    }
    return null;
}

function holyTile(world) {
    return Devotion.holySites(world).map(h => world.getTile(h.q, h.r))[0] || null;
}

function fresh() {
    game = newGame(4242);
    const p = game.player;
    p.gold = 2000;
    p.karma = 0;
    p.health = 40;
    p.maxHealth = 100;
    return game;
}

beforeAll(async () => {
    await loadData();
    fresh();
});

describe('prayer and meditation', () => {
    it('diminish through the day and cap karma; never touch the shared RNG', () => {
        const { world, player } = fresh();
        const tile = townTile(world);
        Utils.setSeed(99);
        const probe = Utils.random();
        Utils.setSeed(99);
        const gains = [];
        for (let i = 0; i < 6; i++) gains.push(Devotion.devote(player, world, { kind: 'pray', place: 'temple', tile }).karma);
        expect(Utils.random()).toBe(probe); // own stream only
        expect(gains[1]).toBeLessThan(gains[0]);
        const total = gains.reduce((a, b) => a + b, 0);
        expect(total).toBeLessThanOrEqual(Devotion.config().dailyKarmaCap + 1e-9);
        // A new day restores it, but the same temple within days is worth less
        world.day += 1;
        const again = Devotion.devote(player, world, { kind: 'pray', place: 'temple', tile }).karma;
        expect(again).toBeLessThan(gains[0]);
    });

    it('a shrine of your own faith answers better than a foreign one or no creed at all', () => {
        const { world, player } = fresh();
        const tile = townTile(world, t => {
            const k = world.getKingdom(t.settlement.kingdom);
            return k && k.religion && k.religion.faithId;
        });
        const fid = world.getKingdom(tile.settlement.kingdom).religion.faithId;
        const none = Devotion.preview(player, world, { kind: 'pray', place: 'temple', tile }).mult;
        const other = Object.keys(Religion.FAITHS).find(id => id !== fid && !Religion.FAITHS[id].extinct);
        expect(Devotion.adoptFaith(player, world, other).success).toBe(true);
        const foreign = Devotion.preview(player, world, { kind: 'pray', place: 'temple', tile }).mult;
        world.day += 40; // conversion takes time
        const res = Devotion.adoptFaith(player, world, fid);
        expect(res.success).toBe(true);
        expect(res.karma).toBeLessThan(0); // apostasy costs
        const same = Devotion.preview(player, world, { kind: 'pray', place: 'temple', tile }).mult;
        expect(same).toBeGreaterThan(none);
        expect(none).toBeGreaterThan(foreign);
    });

    it('stat gains are small steps under a lifetime cap', () => {
        const { player } = fresh();
        player.faith = 5;
        let total = 0;
        for (let i = 0; i < 40; i++) total += Devotion.raiseStat(player, 'faith', 0.25);
        expect(total).toBeCloseTo(Devotion.config().statCaps.faith);
        expect(player.faith).toBeCloseTo(5 + Devotion.config().statCaps.faith);
    });

    it('an omen points at a real place nearby and reveals it', () => {
        const { world, player } = fresh();
        const cands = Devotion.omenCandidates(player, world, player.q, player.r);
        const o = Devotion.omen(player, world, player.q, player.r);
        if (!cands.length) {
            expect(o.kind).toBe('none');
            return;
        }
        expect(o.q).toBeTypeOf('number');
        const t = world.getTile(o.q, o.r);
        expect(t.explored).toBe(true);
        expect(o.text).toMatch(/hexes to the (north|south|east|west)/);
        expect(Devotion.state(player).omens[0]).toBe(o);
    });
});

describe('vows', () => {
    function offer(player, world, id) {
        Devotion.state(player).offer = { day: world.day, ids: [id] };
    }

    it('a vow of peace is kept after its days, broken by a fight', () => {
        const { world, player } = fresh();
        offer(player, world, 'peace');
        expect(Devotion.takeVow(player, world, 'peace').success).toBe(true);
        world.day += Devotion.vowDef('peace').days;
        const karma = player.karma;
        const out = Devotion.processDay(world, player);
        expect(out.notices[0].title).toBe('Vow Kept');
        expect(player.karma).toBeGreaterThan(karma);

        offer(player, world, 'peace');
        Devotion.takeVow(player, world, 'peace');
        Traits.recordDeed(player, 'valor', 1);
        const k2 = player.karma;
        expect(Devotion.processDay(world, player).notices[0].title).toBe('Vow Broken');
        expect(player.karma).toBeLessThan(k2);
        expect(Devotion.state(player).stats.vowsBroken).toBe(1);
    });

    it('a vow of alms is kept by giving', () => {
        const { world, player } = fresh();
        const tile = townTile(world);
        offer(player, world, 'alms');
        const v = Devotion.takeVow(player, world, 'alms').vow;
        const r = Devotion.donate(player, world, tile, 'poor', v.gold);
        expect(r.success).toBe(true);
        expect(r.vowNotices.some(n => n.title === 'Vow Kept')).toBe(true);
        expect(Devotion.vows(player, world)).toHaveLength(0);
    });
});

describe('alms by recipient', () => {
    it('the temple raises clergy standing and the realm\'s piety; the poor lift the town; repeat gifts diminish', () => {
        const { world, player } = fresh();
        const tile = townTile(world, t => {
            const k = world.getKingdom(t.settlement.kingdom);
            return k && k.religion && k.religion.faithId;
        });
        const k = world.getKingdom(tile.settlement.kingdom);
        const piety = k.religion.piety;
        const gold = player.gold;
        const a = Devotion.donate(player, world, tile, 'temple', 100);
        expect(a.success).toBe(true);
        expect(player.gold).toBe(gold - 100);
        expect(Devotion.standing(player, k.religion.faithId)).toBeGreaterThan(0);
        expect(k.religion.piety).toBeGreaterThan(piety);
        tile.settlement.happiness = 40;
        const b = Devotion.donate(player, world, tile, 'poor', 100);
        expect(tile.settlement.happiness).toBeGreaterThan(40);
        expect(b.factor).toBeLessThan(a.factor); // the town has had a lot from you
        expect(b.karma).toBeLessThan(a.karma / Devotion.data().donations.temple.karmaPerGold * Devotion.data().donations.poor.karmaPerGold);
    });

    it('a named townsperson in need receives the purse and remembers it', () => {
        const { world, player } = fresh();
        const tile = townTile(world);
        Townsfolk.attach(tile.settlement, world, [
            { id: 1, name: 'Ada', type: 'beggar', age: 50, gender: 'female' },
            { id: 2, name: 'Brom', type: 'merchant', age: 40, gender: 'male' },
        ], { q: tile.q, r: tile.r });
        const needy = Devotion.needyFolk(world, tile);
        expect(needy.length).toBeGreaterThan(0);
        const opt = Devotion.donationOptions(player, world, tile).find(o => o.kind === 'folk');
        const r = Devotion.donate(player, world, tile, opt.id, 30);
        expect(r.success).toBe(true);
        const p = Townsfolk.get(tile.settlement.folk, needy[0].id);
        expect(p.purse).toBeGreaterThanOrEqual(30);
        expect(p.mem.disposition).toBeGreaterThan(50);
    });

    it('guild alms need a membership', () => {
        const { world, player } = fresh();
        const tile = townTile(world, t => t.settlement.guilds && Object.keys(t.settlement.guilds).length);
        if (!tile) return;
        const gid = Object.keys(tile.settlement.guilds)[0];
        expect(Devotion.donate(player, world, tile, `guild:${gid}`, 50).success).toBe(false);
    });
});

describe('pilgrimage', () => {
    it('declared, walked and kept: the pilgrim pays, the holder takes the offering, the vow is kept; a repeat gives less', () => {
        const { world, player } = fresh();
        const tile = holyTile(world);
        expect(tile).toBeTruthy();
        // Start away from the shrine
        player.q = (tile.q + 6) % world.width;
        player.r = tile.r;
        const d = Devotion.declarePilgrimage(player, world, tile.q, tile.r);
        expect(d.success).toBe(true);
        player.q = tile.q;
        player.r = tile.r;
        const holder = tile.holySite.controller ? world.getKingdom(tile.holySite.controller) : null;
        const treasury = holder ? holder.treasury || 0 : 0;
        const gold = player.gold;
        const a = Devotion.completePilgrimage(player, world, tile, 'alms');
        expect(a.success).toBe(true);
        expect(player.gold).toBeLessThanOrEqual(gold - 25);
        if (holder) expect(holder.treasury).toBeGreaterThanOrEqual(treasury + 25);
        expect(a.vowKept).toMatch(/kept/);
        expect(Devotion.completePilgrimage(player, world, tile, 'alms').success).toBe(false); // once a day
        world.day += 1;
        const b = Devotion.completePilgrimage(player, world, tile, 'alms');
        expect(b.karma).toBeLessThan(a.karma);
        expect(b.blessing).toBeNull(); // once a season
    });

    it('an overdue pilgrimage vow is broken', () => {
        const { world, player } = fresh();
        const tile = holyTile(world);
        player.q = (tile.q + 6) % world.width;
        const v = Devotion.declarePilgrimage(player, world, tile.q, tile.r).vow;
        world.day = v.until + 1;
        expect(Devotion.processDay(world, player).notices[0].title).toBe('Vow Broken');
    });
});

describe('the soul pact', () => {
    it('sold for real gold, the debt comes due, a refusal curses (luck), the temple redeems it', () => {
        const { world, player } = fresh();
        const tile = townTile(world);
        player.luck = 5;
        const gold = player.gold;
        const r = SoulPact.sell(player, world, tile);
        expect(r.success).toBe(true);
        expect(player.gold).toBe(gold + r.gold);
        expect(SoulPact.sell(player, world, tile).success).toBe(false);
        expect(SoulPact.prayerMult(player)).toBeLessThan(1);
        world.day = SoulPact.state(player).dueDay;
        const due = SoulPact.processDay(world, player);
        expect(due.notices[0].title).toBe('The Debt Comes Due');
        expect(SoulPact.state(player).state).toBe('due');
        SoulPact.answer(player, world, 'refuse');
        expect(SoulPact.state(player).state).toBe('cursed');
        expect(player.luck).toBe(3);
        expect(SoulPact.prayerMult(player)).toBe(0);
        const k = player.karma;
        SoulPact.processDay(world, player);
        expect(player.karma).toBeLessThan(k); // the curse drains
        const red = SoulPact.redeem(player, world, 'temple', 0.2);
        expect(red.success).toBe(true);
        expect(player.luck).toBe(5);
        expect(SoulPact.isSold(player)).toBe(false);
    });

    it('a dark deed done answers the demand', () => {
        const { world, player } = fresh();
        const tile = townTile(world);
        SoulPact.sell(player, world, tile);
        const st = SoulPact.state(player);
        world.day = st.dueDay;
        SoulPact.processDay(world, player);
        st.demand = { kind: 'cruelty', deed: 'cruelty', amount: 1, base: (player.traits.deeds.cruelty || 0), until: world.day + 5 };
        Traits.recordDeed(player, 'cruelty', 1);
        world.day += 1;
        const out = SoulPact.processDay(world, player);
        expect(out.notices[0].title).toBe('The Stranger Is Satisfied');
        expect(st.state).toBe('sold');
        expect(st.dueDay).toBeGreaterThan(world.day);
    });

    it('the tavern opens the pact and the gambling den instead of one-click coin', () => {
        const { world, player } = fresh();
        const tile = townTile(world);
        expect(Tavern.handleAction('sell_soul', player, tile, world)[0].openSoulPact).toBe(true);
        expect(Tavern.handleAction('play_dice', player, tile, world)[0].openGambling).toBe(true);
        expect(SoulPact.state(player).state).toBe('none');
    });
});

describe('books', () => {
    it('a book takes several sittings, two a day count, and its reward comes once', () => {
        const { world, player } = fresh();
        const ctx = { shelfKey: 'test', settlementType: 'capital' };
        const book = Books.nextBook(player, ctx);
        expect(book).toBeTruthy();
        const before = JSON.stringify(player.skills);
        let r;
        let finished = null;
        for (let day = 0; day < 10 && !finished; day++) {
            r = Books.read(player, world, ctx);
            if (r.finished) finished = r;
            else if (!r.finished) {
                const r2 = Books.read(player, world, ctx);
                if (r2.finished) finished = r2;
                const r3 = Books.read(player, world, ctx);
                expect(r3.counted).toBe(false); // the third sitting of a day does not count
            }
            world.day += 1;
        }
        expect(finished).toBeTruthy();
        expect(finished.book.id).toBe(book.id);
        expect(Books.state(player).finished).toContain(book.id);
        expect(Books.nextBook(player, ctx).id).not.toBe(book.id);
        if (book.reward.skills) expect(JSON.stringify(player.skills)).not.toBe(before);
    });
});

describe('feasts', () => {
    it('planned with real guests and food; hosts once, then waits for the cooldown', () => {
        const { world, player } = fresh();
        const tile = townTile(world, (t, s) => s.type === 'capital');
        const plan = Feasts.plan(player, world, tile);
        expect(plan.guests.some(g => g.kind === 'lord' && g.local)).toBe(true);
        const menu = plan.menus.find(m => m.can);
        expect(menu).toBeTruthy();
        player.inventory = { bread: 3 };
        const lords = plan.guests.filter(g => g.kind === 'lord' && g.available !== false).map(g => g.id);
        const renown = player.renown || 0;
        const r = Feasts.host(player, world, tile, { guests: lords, menu: 'modest', entertainment: 'minstrels' });
        expect(r.success).toBe(true);
        expect(r.fromStores).toBe(3);
        expect(player.inventory.bread || 0).toBe(0);
        expect(player.renown).toBeGreaterThanOrEqual(renown + 1);
        expect(r.guests.length).toBeGreaterThan(0);
        for (const g of r.guests.filter(x => x.came)) expect(['honoured', 'content', 'slighted', 'insulted']).toContain(g.verdict);
        expect(Feasts.host(player, world, tile, { guests: [], menu: 'modest' }).success).toBe(false); // cooldown
        world.day += Feasts.config().cooldownDays;
        const again = Feasts.host(player, world, tile, { guests: [], menu: 'modest' });
        expect(again.success).toBe(true);
        expect(again.renown).toBeLessThanOrEqual(r.renown); // the town tires of them
    });

    it('a brawl is settled; a lord left off the list is slighted', () => {
        const { world, player } = fresh();
        const tile = townTile(world, (t, s) => s.type === 'capital');
        const st = Feasts.state(player);
        st.pending = { kind: 'brawl', day: world.day, brawler: 'Tor' };
        const prof = Feasts.brawlerProfile(player, world);
        expect(prof.name).toBe('Tor');
        const r = Feasts.settleBrawl(player, world, 'won');
        expect(r.success).toBe(true);
        expect(r.renown).toBeGreaterThan(0);
        expect(Feasts.settleBrawl(player, world, 'won').success).toBe(false);

        const plan = Feasts.plan(player, world, tile);
        const local = plan.guests.find(g => g.kind === 'lord' && g.local);
        const other = plan.guests.find(g => g.kind === 'lord' && !g.local && g.available !== false);
        if (!local || !other) return;
        const res = Feasts.host(player, world, tile, { guests: [other.id], menu: 'modest' });
        const snub = res.guests.find(g => g.id === local.id);
        expect(snub.verdict).toBe('uninvited');
        expect(snub.delta).toBeLessThan(0);
    });
});

describe('saved with the game', () => {
    it('devotion, the pact, books and feasts survive a save', () => {
        const { world, player } = fresh();
        const tile = townTile(world);
        Devotion.devote(player, world, { kind: 'pray', place: 'temple', tile });
        SoulPact.sell(player, world, tile);
        Books.read(player, world, { shelfKey: 'x', settlementType: 'town' });
        const data = SaveLoad.serializePlayer ? SaveLoad.serializePlayer(player) : null;
        if (!data) return;
        const copy = JSON.parse(JSON.stringify(data));
        expect(copy.devotion.stats.prayers).toBe(1);
        expect(copy.soulPact.state).toBe('sold');
        expect(copy.reading.current).toBeTruthy();
    });
});

describe('hex helpers used by omens', () => {
    it('directions are named', () => {
        expect(Devotion._dir(null, 0, 0, 5, 0)).toBe('east');
        expect(Hex.distance(0, 0, 3, 0)).toBe(3);
    });
});
