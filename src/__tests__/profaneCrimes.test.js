// Profane crimes (systems/profaneCrimes.js): a rival House's crypt robbed or
// its dead scattered, relics lifted / forged / sold, a witch cried. Seeded.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadData } from './playtest/harness.js';
import { ProfaneCrimes } from '../systems/profaneCrimes.js';
import { House } from '../systems/house.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { Nemesis } from '../systems/nemesis.js';
import { Devotion } from '../systems/devotion.js';
import { Heirlooms } from '../systems/heirlooms.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Utils } from '../core/utils.js';

beforeAll(async () => { await loadData(); }, 120000);

const Y = 120;

function person(id, o = {}) {
    return { id, first: o.first || `P${id}`, last: o.last || 'Reed', gender: o.gender || 'female', born: o.born ?? -40 * Y, died: null, role: o.role || 'villager', parents: o.parents || [], kids: o.kids || [], spouse: o.spouse ?? null, log: [], ...o };
}

function makeWorld() {
    const tiles = new Map();
    const kingdoms = [
        { id: 'k1', name: 'Varr', isAlive: true, military: 500, religion: { faithId: 'solaris', name: 'Sun', piety: 60 }, territory: [{ q: 0, r: 0 }], laws: { foreignLand: 'open' } },
        { id: 'k2', name: 'Osk', isAlive: true, military: 300, religion: { faithId: 'tidemother', name: 'Moon', piety: 50 }, territory: [{ q: 5, r: 0 }], laws: { foreignLand: 'open' } },
    ];
    const world = {
        day: 700, seed: 4242, kingdoms, units: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: id => kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [...tiles.values()].map(t => t.settlement).filter(Boolean),
    };
    const healer = person(1, { first: 'Agnes', job: { id: 'healer' }, purse: 90, kids: [2] });
    const son = person(2, { first: 'Wat', gender: 'male', born: -20 * Y, parents: [1] });
    const lad = person(3, { first: 'Tom', gender: 'male', born: -25 * Y });
    const town = { name: 'Varrow', q: 0, r: 0, type: 'town', kingdom: 'k1', population: 800, economy: { gold: 2000 }, folk: { q: 0, r: 0, people: [healer, son, lad], annals: [] } };
    const seat = { name: 'Oskhold', q: 5, r: 0, type: 'town', kingdom: 'k2', population: 600, economy: { gold: 1500 } };
    tiles.set('0,0', { q: 0, r: 0, settlement: town });
    tiles.set('5,0', { q: 5, r: 0, settlement: seat });
    return { world, town, seat, healer, son, lad };
}

function makePlayer(world) {
    const player = { id: 'p1', name: 'Ada Ashborne', lastName: 'Ashborne', gender: 'female', gold: 1000, renown: 20, karma: 0, charisma: 6, intelligence: 7, reputation: {}, inventory: {}, skills: {}, q: 0, r: 0, properties: [], colonies: [], children: [] };
    House.initialize(player, world);
    player.house.rivals = { k2: { kingdomId: 'k2', name: 'House Osk', feud: 10, lastActedDay: 0 } };
    const rival = player.house.rivals.k2;
    RivalHouses._ensure(world, rival);
    rival.seat = { q: 5, r: 0, name: 'Oskhold' };
    Devotion.adoptFaith(player, world, 'solaris');
    return { player, rival };
}

beforeEach(() => { Utils.setSeed(11); House.resetBrain && House.resetBrain(); });

describe('ProfaneCrimes — the crypt', () => {
    it('only at the House\'s seat; seen robbing it, the House knows at once and never lets the feud fall', () => {
        const { world } = makeWorld();
        const { player, rival } = makePlayer(world);
        expect(ProfaneCrimes.desecrate(player, world, 'k2', 'rob').success).toBe(false);
        player.q = 5;
        const standing = Devotion.standing(player, 'solaris');
        const res = ProfaneCrimes.desecrate(player, world, 'k2', 'rob', () => 0);
        expect(res.success).toBe(true);
        expect(res.seen).toBe(true);
        expect(player.inventory.grave_goods).toBe(4);
        expect(rival.crypt.goods).toBe(0);
        expect(rival.profaned.known).toBe(true);
        expect(rival.feud).toBeGreaterThanOrEqual(35);
        expect(rival.memory.some(m => m.kind === 'cryptRobbed' && m.w < 0)).toBe(true);
        expect(Devotion.standing(player, 'solaris')).toBeLessThan(standing);
        expect(player.gossip.rumors.some(r => r.type === 'desecration')).toBe(true);
        expect(Nemesis.state(player).grudges.some(g => g.deed.key === 'desecration')).toBe(true);
        expect(player.house.history.some(h => /crypt of House Osk/.test(h.text))).toBe(true);
        // The feud cools elsewhere; the weekly turn puts it back on the floor
        rival.feud = 3;
        ProfaneCrimes._cryptWeek(player, world, () => 0.99, { notices: [] });
        expect(rival.feud).toBe(rival.profaned.floor);
    });

    it('unseen, the bones go in your packs and the House learns it later; a new head swears again; reburial halves the floor', () => {
        const { world } = makeWorld();
        const { player, rival } = makePlayer(world);
        player.q = 5;
        const res = ProfaneCrimes.desecrate(player, world, 'k2', 'scatter', () => 0.99);
        expect(res.seen).toBe(false);
        expect(player.inventory.bones).toBe(6);
        expect(rival.profaned.known).toBe(false);
        const out = { notices: [] };
        ProfaneCrimes._cryptWeek(player, world, () => 0, out);
        expect(rival.profaned.known).toBe(true);
        expect(rival.profaned.floor).toBe(60);
        expect(out.notices[0].title).toBe('They Know');
        // A new head is laid... and the next swears over the bones; goods bought from the House's purse
        const gold = rival.gold;
        const goods = rival.crypt.goods;
        rival.stats.heads += 1;
        Nemesis.state(player).grudges = [];
        const out2 = { notices: [] };
        ProfaneCrimes._cryptWeek(player, world, () => 0.99, out2);
        expect(rival.crypt.goods).toBeGreaterThan(goods);
        expect(rival.gold).toBeLessThan(gold);
        expect(out2.notices.some(n => /Oath/.test(n.title))).toBe(true);
        expect(Nemesis.state(player).grudges.length).toBe(1);
        // Bring the bones back
        const rb = ProfaneCrimes.rebury(player, world, 'k2');
        expect(rb.success).toBe(true);
        expect(rival.profaned.floor).toBe(30);
        expect(player.inventory.bones || 0).toBe(0);
    });
});

describe('ProfaneCrimes — relics', () => {
    it('a relic lifted from one faith\'s temple sells to another\'s for coin out of its realm', () => {
        const { world, town, seat } = makeWorld();
        const { player } = makePlayer(world);
        const r = ProfaneCrimes.stealRelic(player, world, town, () => 0.99);
        expect(r.success).toBe(true);
        expect(r.relic.faithId).toBe('solaris');
        expect(world.getKingdom('k1').religion.piety).toBe(57);
        player.q = 5;
        const before = player.gold;
        const purse = seat.economy.gold;
        const s = ProfaneCrimes.sellRelic(player, world, seat, r.relic.id, () => 0);
        expect(s.success).toBe(true);
        expect(player.gold - before).toBe(s.gold);
        expect(seat.economy.gold).toBeLessThan(purse);
        // a relic of your own faith sold to another god: your clergy, and the talk
        expect(Devotion.standing(player, 'solaris')).toBeLessThan(0);
        expect(player.gossip.rumors.some(x => x.type === 'relic_betrayal')).toBe(true);
        expect(ProfaneCrimes.relics(player)).toHaveLength(0);
    });

    it('seen at the reliquary: fined into the town purse, the relic stays', () => {
        const { world, town } = makeWorld();
        const { player } = makePlayer(world);
        const purse = town.economy.gold;
        const r = ProfaneCrimes.stealRelic(player, world, town, () => 0);
        expect(r.caught).toBe(true);
        expect(player.gold).toBe(920);
        expect(town.economy.gold).toBe(purse + 80);
        expect(ProfaneCrimes.reliquary(world, town).taken).toBe(0);
    });

    it('a fake from charnel bones sells, and when found out the temple takes restitution', () => {
        const { world, seat } = makeWorld();
        const { player } = makePlayer(world);
        player.inventory.bones = 3;
        expect(ProfaneCrimes.forgeRelic(player, world, seat).success).toBe(true);
        expect(player.inventory.bones).toBe(1);
        const fake = ProfaneCrimes.relics(player)[0];
        expect(fake.fake).toBe(true);
        const s = ProfaneCrimes.sellRelic(player, world, seat, fake.id);
        expect(s.success).toBe(true);
        const sale = ProfaneCrimes.state(player).sold[0];
        expect(sale.exposed).toBeUndefined();
        const gold = player.gold;
        const out = { notices: [] };
        ProfaneCrimes._relicDay(player, world, () => 0, out);
        expect(sale.exposed).toBe(world.day);
        expect(player.gold).toBe(gold - Math.round(sale.price * 1.5));
        expect(player.reputation.k2).toBeLessThan(0);
        expect(Devotion.standing(player, 'tidemother')).toBeLessThan(0);
        expect(player.gossip.rumors.some(x => x.type === 'relic_fraud')).toBe(true);
        expect(out.notices[0].title).toMatch(/False Relic/);
        // past the window it is safe
        player.inventory.bones = 2;
        ProfaneCrimes.forgeRelic(player, world, seat);
        ProfaneCrimes.sellRelic(player, world, seat, ProfaneCrimes.relics(player)[0].id);
        world.day += 1000;
        ProfaneCrimes._relicDay(player, world, () => 0, { notices: [] });
        expect(ProfaneCrimes.state(player).sold[1].safe).toBe(world.day);
    });

    it('the House\'s relic heirloom sold goes on a trail to be bought back', () => {
        const { world, seat } = makeWorld();
        const { player } = makePlayer(world);
        const h = Heirlooms.create(player, world, { kind: 'relic', name: 'the Relic of Ashborne' });
        player.q = 5;
        expect(ProfaneCrimes.houseRelics(player)).toHaveLength(1);
        const s = ProfaneCrimes.sellRelic(player, world, seat, h.id, () => 0.99);
        expect(s.success).toBe(true);
        expect(h.status).toBe('sold');
        expect(h.trail.place).toBe('Oskhold');
    });
});

describe('ProfaneCrimes — the witch', () => {
    it('only a healer or an old woman can be cried a witch', () => {
        const { world, town, healer, lad } = makeWorld();
        expect(ProfaneCrimes.accusable(world, town.folk, healer).ok).toBe(true);
        expect(ProfaneCrimes.accusable(world, town.folk, lad).ok).toBe(false);
        const crone = person(9, { born: world.day - 60 * Y });
        town.folk.people.push(crone);
        expect(ProfaneCrimes.accusable(world, town.folk, crone).ok).toBe(true);
    });

    it('condemned: she dies, her purse and land are seized, her kin remember it as blood', () => {
        const { world, town, healer, son } = makeWorld();
        const { player } = makePlayer(world);
        const gold = player.gold;
        const purse = town.economy.gold;
        const res = ProfaneCrimes.accuseWitch(player, world, town, town.folk, healer, 'trial', {}, () => 0);
        expect(res.outcome).toBe('condemned');
        expect(healer.died).toBe(world.day);
        expect(healer.cause).toMatch(/witch/);
        expect(player.gold - gold).toBe(30);
        expect(town.economy.gold).toBe(purse + 60);
        expect(res.lot).toBeTruthy();
        expect(player.lotHoldings.some(h => h.id === res.lot && h.seized === 'Agnes Reed')).toBe(true);
        expect(town.lotBook.lots[res.lot].holder).toBe('player');
        expect(son.nm.some(e => e.k === 'witch_burned' && e.vn === 'Agnes Reed')).toBe(true);
        expect(town.folk.nm.some(e => e.k === 'witch_burned')).toBe(true);
        expect(player.house.history.some(h => /witch/.test(h.text))).toBe(true);
        // her son is a candidate avenger (Nemesis' folk grudges read the blood memory)
        expect(Nemesis._folkGrudges(player, world).some(c => c.name === 'Wat Reed')).toBe(true);
    });

    it('acquitted: she lives and you are the false accuser', () => {
        const { world, town, healer, son } = makeWorld();
        const { player } = makePlayer(world);
        const res = ProfaneCrimes.accuseWitch(player, world, town, town.folk, healer, 'trial', {}, () => 0.99);
        expect(res.outcome).toBe('acquitted');
        expect(healer.died).toBeNull();
        expect(son.nm.some(e => e.k === 'witch_accused')).toBe(true);
        expect(player.gossip.rumors.some(r => r.type === 'false_witch')).toBe(true);
        expect(player.lotHoldings || []).toHaveLength(0);
    });

    it('a mob kills for certain but gives no land; a bribe buys the priest', () => {
        const { world, town, healer } = makeWorld();
        const { player } = makePlayer(world);
        expect(ProfaneCrimes.trialChance(player, world, town, town.folk, healer, { bribe: true }))
            .toBeGreaterThan(ProfaneCrimes.trialChance(player, world, town, town.folk, healer));
        const res = ProfaneCrimes.accuseWitch(player, world, town, town.folk, healer, 'mob', {}, () => 0.99);
        expect(res.outcome).toBe('mob');
        expect(healer.died).toBe(world.day);
        expect(res.lot).toBeNull();
        expect(res.coin).toBe(45);
    });

    it('player.profane is saved with the player', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('profane');
    });
});
