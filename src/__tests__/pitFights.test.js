// Pit fights and blood sports (systems/pitFights.js, world/pitRing.js,
// Laws.bloodSports): bouts fought by the duel engine between real townsfolk,
// the book's odds from their real strength, every coin from a real purse to
// another, the dead dead on the roster, the law driving the pit underground,
// the bear and the dogs and the birds bought, killed and sold.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { PitFights } from '../systems/pitFights.js';
import { Laws } from '../systems/laws.js';
import { Duels } from '../systems/duels.js';
import { Underworld } from '../systems/underworld.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PitRing } from '../world/pitRing.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(9191));

/** A realm with a city (its pit's law the test's to set). */
function makeWorld(law = 'open', type = 'city') {
    const kingdom = { id: 'k1', name: 'Testmark', isAlive: true, treasury: 3000, laws: { bloodSports: law }, territory: [] };
    const s = { name: 'Bigtown', type, population: 6000, kingdom: 'k1', economy: { gold: 20000 }, ordinances: { bloodSports: 'follow' }, q: 0, r: 0 };
    const tiles = { '0,0': { q: 0, r: 0, terrain: { id: 'plains', passable: true }, settlement: s } };
    const world = {
        day: 10, width: 40, generationParams: { seed: 515 }, kingdoms: [kingdom],
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: id => (id === 'k1' ? kingdom : null),
        getSettlementViews: () => [s],
        getAllSettlements: () => [s],
        kingdom, s,
    };
    Townsfolk.seed(s, world, { q: 0, r: 0 });
    SettlementMarket.ensure(s);
    return world;
}

function makePlayer() {
    const p = new Player();
    p.gold = 2000;
    p.inventory = {};
    p.q = 0; p.r = 0;
    p.health = 100; p.maxHealth = 100;
    Underworld.ensure(p);
    return p;
}

/** Every coin in this little world: the town, its people, the crown, the player. */
function coin(world, player = null) {
    const s = world.s;
    const folk = s.folk.people.reduce((t, p) => t + (typeof p.purse === 'number' && !p.away ? p.purse : 0), 0);
    // (the town's gangs, once the watch's raid odds have looked at them: systems/gangs.js)
    const uw = s.underworld || {};
    const gangs = (uw.gangs || []).reduce((t, g) => t + (g && typeof g.purse === 'number' ? g.purse : 0), 0)
        + ['captain', 'magistrate'].reduce((t, k) => t + (uw.watch && uw.watch[k] && typeof uw.watch[k].purse === 'number' ? uw.watch[k].purse : 0), 0);
    return Math.round((s.economy.gold + folk + gangs + world.kingdom.treasury + (player ? player.gold : 0)) * 100) / 100;
}

/** The next fight night from world.day on (sets the day). */
function toFightNight(world) {
    for (let k = 0; k < 10; k++) {
        if (PitRing.nightOf(world.s, world.day).fight) return world.day;
        world.day++;
    }
    throw new Error('no fight night');
}

/** Run `n` fight nights; → every result. */
function nights(world, player, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        toFightNight(world);
        const r = PitFights.runCard(world, world.s, player);
        if (r) out.push(...r.results.map(x => ({ ...x, day: world.day })));
        world.day++;
    }
    return out;
}

describe('the pit', () => {
    it('a city keeps one, run by a townsperson whose purse is the book, drawn from the town', () => {
        const world = makeWorld();
        const before = coin(world);
        const pit = PitFights.ensure(world, world.s);
        expect(pit).toBeTruthy();
        const master = PitFights.masterOf(world, world.s);
        expect(master).toBeTruthy();
        expect(master.purse).toBeGreaterThanOrEqual(100);
        expect(coin(world)).toBeCloseTo(before, 2);
        expect(pit.underground).toBe(false);
        expect(PitRing.standing(world.s)).toBe(true);
        expect(PitRing.stamp(world.s)).toMatch(/pit/);
    });

    it('fight nights come weekly, at the feasts and the fairs', () => {
        const world = makeWorld();
        let n = 0;
        for (let d = 2; d < 30; d++) if (PitRing.nightOf(world.s, d).fight) n++;
        expect(n).toBeGreaterThanOrEqual(7);
        expect(PitRing.nightOf(world.s, 31).why).toBe('feast');
    });

    it('a card is drawn of real townsfolk, the champion in the last bout once there is one', () => {
        const world = makeWorld();
        nights(world, null, 3);
        toFightNight(world);
        const card = PitFights.card(world, world.s);
        const men = card.bouts.filter(b => b.kind === 'men');
        expect(men.length).toBeGreaterThan(0);
        for (const b of men) {
            expect(Townsfolk.get(world.s.folk, b.a)).toBeTruthy();
            expect(Townsfolk.get(world.s.folk, b.b)).toBeTruthy();
        }
        expect(world.s.pit.champion).not.toBe(null);
        expect(card.bouts.some(b => b.title)).toBe(true);
    });
});

describe('bouts from real strength', () => {
    it('a trained, seasoned fighter is the favourite, and wins more often', () => {
        const world = makeWorld();
        PitFights.ensure(world, world.s);
        toFightNight(world);
        PitFights.card(world, world.s);
        const pit = world.s.pit;
        const ids = Object.keys(pit.fighters).map(Number);
        const [a, b] = ids;
        pit.fighters[a].train = 5;
        pit.fighters[a].wins = 10;
        const bout = { i: 0, kind: 'men', mode: 'firstBlood', a, b };
        const book = PitFights.odds(world, world.s, bout);
        expect(book.pA).toBeGreaterThan(0.6);
        expect(book.odds[0]).toBeLessThan(book.odds[1]);
        // The engine itself: the strong man wins most of the bouts he fights
        const pa = Townsfolk.get(world.s.folk, a), pb = Townsfolk.get(world.s.folk, b);
        let won = 0;
        for (let k = 0; k < 40; k++) {
            const r = Duels.autoResolve(PitFights.combatant(world, world.s, pa, pit.fighters[a]), PitFights.combatant(world, world.s, pb, pit.fighters[b]), { mode: 'firstBlood', rng: Utils.seededRandom(k * 977 + 13), playerYieldAt: 0.3 });
            if (r.winner === 'a') won++;
        }
        expect(won).toBeGreaterThan(24);
    });

    it('on the card, night after night, the trained man beats the green one more often than not', () => {
        const world = makeWorld();
        const pit = PitFights.ensure(world, world.s);
        toFightNight(world);
        PitFights.card(world, world.s);
        const [a, b] = Object.keys(pit.fighters).map(Number);
        pit.fighters[a].train = 5;
        pit.fighters[a].wins = 8;
        const pa = Townsfolk.get(world.s.folk, a), pb = Townsfolk.get(world.s.folk, b);
        let won = 0, fought = 0;
        for (let d = 100; d < 140; d++) {
            world.day = d;
            delete pa.hurt; delete pb.hurt;
            pit.card = { day: d, why: 'market', bouts: [{ i: 0, kind: 'men', mode: 'firstBlood', a, b, result: null }], ran: false, raid: null, crowd: 0, gate: 0, results: [] };
            const out = PitFights.runCard(world, world.s, null);
            const r = out.results[0];
            if (!r) continue;
            fought++;
            if (r.winnerPid === a) won++;
        }
        expect(fought).toBe(40);
        expect(won / fought).toBeGreaterThan(0.6);
        expect(pit.fighters[a].wins).toBeGreaterThan(pit.fighters[b].wins);
    });
});

describe('the book: every coin from a purse to a purse', () => {
    it('bets, the gate, the purses, the animals and the crown\'s fifth mint nothing', () => {
        const world = makeWorld('taxed');
        const player = makePlayer();
        PitFights.ensure(world, world.s);
        const before = coin(world, player);
        let bets = 0;
        for (let i = 0; i < 6; i++) {
            toFightNight(world);
            const card = PitFights.card(world, world.s);
            card.bouts.forEach((b, j) => { if (PitFights.bet(player, world, world.s, j, j % 2 ? 'b' : 'a', 10).success) bets++; });
            PitFights.watch(player, world, world.s);
            world.day++;
        }
        expect(bets).toBeGreaterThan(5);
        expect(coin(world, player)).toBeCloseTo(before, 1);
        // the crown took its fifth of the gate
        expect(world.s.pit.stats.tax).toBeGreaterThan(0);
        expect(world.kingdom.treasury).toBeGreaterThan(3000);
        const rec = PitFights.state(player).record;
        expect(rec.betsWon + rec.betsLost + rec.betsVoid).toBe(bets);
    });

    it('a won bet is paid at the book\'s odds out of the master\'s purse', () => {
        const world = makeWorld();
        const player = makePlayer();
        PitFights.ensure(world, world.s);
        toFightNight(world);
        const card = PitFights.card(world, world.s);
        const j = card.bouts.findIndex(b => b.kind === 'men');
        const r1 = PitFights.bet(player, world, world.s, j, 'a', 20);
        const r2 = PitFights.bet(player, world, world.s, j, 'b', 20);
        expect(r1.success && r2.success).toBe(true);
        const gold = player.gold;
        const out = PitFights.watch(player, world, world.s);
        const won = out.bets.find(b => b.won);
        expect(won).toBeTruthy();
        expect(won.paid).toBeCloseTo(20 * won.odds, 1);
        expect(player.gold).toBeCloseTo(gold + won.paid, 1);
    });

    it('a bet left on a night you did not watch is settled when the day turns', () => {
        const world = makeWorld();
        const player = makePlayer();
        PitFights.ensure(world, world.s);
        toFightNight(world);
        const card = PitFights.card(world, world.s);
        const j = card.bouts.findIndex(b => b.kind === 'men');
        expect(PitFights.bet(player, world, world.s, j, 'a', 10).success).toBe(true);
        world.day++;
        const out = PitFights.processDay(world, player);
        expect(card.ran).toBe(true);
        expect(PitFights.state(player).bets.length).toBe(0);
        expect(out.notices.some(n => /The Pit at/.test(n.title))).toBe(true);
    });

    it('a fighter signed is paid his wage to his own purse, and his purses are shared', () => {
        const world = makeWorld();
        const player = makePlayer();
        PitFights.ensure(world, world.s);
        toFightNight(world);
        PitFights.card(world, world.s);
        const best = PitFights.stable(world, world.s)[0];
        const purse = Townsfolk.purse(world.s.folk, best.p, world);
        const res = PitFights.sign(player, world, world.s, best.rec.pid);
        expect(res.success).toBe(true);
        expect(best.p.purse).toBeCloseTo(purse + PitFights.signFee(world, world.s, best.rec), 2);
        expect(PitFights.train(player, world, world.s, best.rec.pid).success).toBe(true);
        expect(world.s.pit.fighters[best.rec.pid].train).toBe(1);
        const before = coin(world, player);
        let share = 0;
        for (let i = 0; i < 8; i++) {
            // (the day's end comes after the day has turned: it fights the night just past)
            toFightNight(world);
            world.day++;
            const out = PitFights.processDay(world, player);
            share += out.notices.filter(n => n.title === 'Your Fighter Won').length;
            expect(world.s.pit.card.ran).toBe(true);
        }
        expect(coin(world, player)).toBeCloseTo(before, 1);
        expect(share + PitFights.state(player).owned.length).toBeGreaterThan(0);
    });
});

describe('the dead and the hurt', () => {
    it('a man killed in a bout to the death dies on the roster, and the town tells it', () => {
        const world = makeWorld();
        PitFights.ensure(world, world.s);
        const modes = PitFights.config().modes;
        const saved = { fb: modes.firstBlood.weight, sub: modes.submission.weight };
        modes.firstBlood.weight = 0; modes.submission.weight = 0;
        let dead = null;
        try {
            for (let i = 0; i < 10 && !dead; i++) dead = nights(world, null, 1).find(r => r.death) || null;
        } finally {
            modes.firstBlood.weight = saved.fb; modes.submission.weight = saved.sub;
        }
        expect(dead).toBeTruthy();
        const p = Townsfolk.get(world.s.folk, dead.loserPid);
        expect(p.died).not.toBe(null);
        expect(p.cause).toMatch(/pit/);
        expect(world.s.pit.fighters[dead.loserPid]).toBeUndefined();
        expect(world.s.pit.fighters[dead.winnerPid].kills).toBeGreaterThan(0);
        expect(world.s.folk.annals.some(e => e.k === 'townMemory' && /killed .* in the pit/.test(e.x))).toBe(true);
        expect(world.s.pit.deaths.length).toBeGreaterThan(0);
        // the killer knows it of himself (the dialog's AI voice)
        const killer = Townsfolk.get(world.s.folk, dead.winnerPid);
        expect(PitFights.selfLines(world, world.s, killer).join(' ')).toMatch(/killed/);
    });

    it('the loser of a bout is hurt and sits out until he heals', () => {
        const world = makeWorld();
        const res = nights(world, null, 1).find(r => r.kind === 'men' && !r.death);
        expect(res).toBeTruthy();
        const p = Townsfolk.get(world.s.folk, res.loserPid);
        expect(Townsfolk.injury(p, world.day)).toBeTruthy();
        expect(PitFights.canFight(world.s, p, world.day)).toBe(false);
        expect(PitFights.canFight(world.s, p, world.day + 30)).toBe(true);
    });

    it('stepping into the pit to the death and losing, unspared, kills you', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.renown = 0;
        PitFights.ensure(world, world.s);
        toFightNight(world);
        const setup = PitFights.selfBout(player, world, world.s, 'death', Duels.fromPlayer(player));
        expect(setup.success).toBe(true);
        expect(setup.duel.mode).toBe('toDeath');
        const mercy = PitFights.config().self.mercy;
        const was = mercy.base;
        mercy.base = -1;
        let res;
        try {
            res = PitFights.selfSettle(player, world, world.s, { playerWon: false, yielded: null, aLost: 1, aHp: 0 });
        } finally { mercy.base = was; }
        expect(res.died).toBe(true);
        expect(player.health).toBe(0);
        expect(res.cause).toMatch(/pit/);
    });
});

describe('the law', () => {
    it('a ban drives the pit underground: no ring on the street, a door fee, and the watch raids', () => {
        const world = makeWorld('banned');
        const player = makePlayer();
        const pit = PitFights.ensure(world, world.s);
        expect(Laws.bloodSports(world, world.s).legal).toBe(false);
        expect(pit.underground).toBe(true);
        expect(pit.front).toBeTruthy();
        expect(PitRing.standing(world.s)).toBe(false);
        expect(PitRing.stamp(world.s)).toBe('');
        const L = PitFights.config().law;
        const was = L.raidBase;
        L.raidBase = 1;
        let out;
        try {
            toFightNight(world);
            const card = PitFights.card(world, world.s);
            const j = card.bouts.findIndex(b => b.kind === 'men');
            const before = coin(world, player);
            expect(PitFights.bet(player, world, world.s, j, 'a', 10).success).toBe(true);
            out = PitFights.watch(player, world, world.s);
            expect(coin(world, player)).toBeCloseTo(before, 1);
        } finally { L.raidBase = was; }
        expect(out.raid).toBeTruthy();
        expect(out.raid.jailed).toBeGreaterThan(0);
        expect(out.raid.player.fine).toBeGreaterThan(0);
        expect(out.bets[0].raided).toBe(true);
        expect(Underworld.getHeat(player, 'k1')).toBeGreaterThan(0);
        const jailed = world.s.folk.people.filter(p => p.jailedUntil > world.day);
        expect(jailed.length).toBe(out.raid.jailed);
    });

    it('a town may forbid its own pit where the realm allows it; lifting a ban brings the ring back', () => {
        const world = makeWorld('open');
        world.s.ordinances.bloodSports = 'banned';
        expect(Laws.bloodSports(world, world.s).forbiddenBy).toBe('town');
        expect(PitFights.ensure(world, world.s).underground).toBe(true);
        world.s.ordinances.bloodSports = 'follow';
        expect(PitFights.ensure(world, world.s).underground).toBe(false);
        expect(PitRing.standing(world.s)).toBe(true);
    });

    it('a crown whose pits keep killing bans them', () => {
        const world = makeWorld('open');
        const pit = PitFights.ensure(world, world.s);
        world.day = 70;
        for (let i = 0; i < 6; i++) pit.deaths.push({ d: 65, pid: 900 + i, name: 'X', by: 'Y' });
        PitFights._crowns(world, null, []);
        expect(Laws.value(world, 'k1', 'bloodSports')).toBe('banned');
        expect(world.kingdom.laws.history.slice(-1)[0].by).toBe('crown');
    });
});

describe('the animals', () => {
    it('the bear and the dogs are bought from the town, killed, and the dead bear sold back', () => {
        const world = makeWorld();
        const pit = PitFights.ensure(world, world.s);
        pit.bearBaiting = true;
        const B = PitFights.config().bear;
        const saved = { maul: B.maul, every: B.everyDays };
        B.maul = 0.6; B.everyDays = 0;
        const master = PitFights.masterOf(world, world.s);
        master.purse = 2000;
        world.s.economy.gold -= 1880;
        const before = coin(world);
        const peltsBefore = SettlementMarket.stock(world.s, 'pelts');
        let bought = 0, bearDied = false, dogsDead = 0;
        try {
            for (let i = 0; i < 40 && !bearDied; i++) {
                toFightNight(world);
                const card = PitFights.card(world, world.s);
                if (!card.bouts.some(b => b.kind === 'bear')) { world.day++; continue; }
                const hadBear = !!pit.bear;
                const out = PitFights.runCard(world, world.s, null);
                const r = out.results.find(x => x.kind === 'bear');
                if (!hadBear && r) bought++;
                if (r) { dogsDead += r.dogsDead; if (r.bearDied) bearDied = true; }
                world.day++;
            }
        } finally { B.maul = saved.maul; B.everyDays = saved.every; }
        expect(bought).toBeGreaterThan(0);
        expect(dogsDead).toBeGreaterThan(0);
        expect(pit.stats.dogs).toBe(dogsDead);
        expect(coin(world)).toBeCloseTo(before, 1);
        if (bearDied) {
            expect(pit.stats.bears).toBeGreaterThan(0);
            expect(SettlementMarket.stock(world.s, 'pelts')).toBeGreaterThanOrEqual(peltsBefore);
        }
    });

    it('birds are bought for the cockpit and die in it; the player may enter one of their own', () => {
        const world = makeWorld();
        const player = makePlayer();
        PitFights.ensure(world, world.s);
        toFightNight(world);
        const before = coin(world, player);
        const res = PitFights.buyCock(player, world, world.s);
        expect(res.success).toBe(true);
        const card = PitFights.card(world, world.s);
        const b = card.bouts.find(x => x.kind === 'cocks');
        PitFights.odds(world, world.s, b);
        expect(b.a).toBe(res.cock.id);
        PitFights.watch(player, world, world.s);
        expect(b.result).toBeTruthy();
        expect(coin(world, player)).toBeCloseTo(before, 1);
        nights(world, null, 4);
        expect(world.s.pit.stats.cocks).toBeGreaterThan(0);
    });
});
