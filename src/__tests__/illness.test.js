/**
 * Townsfolk sickness (systems/illness.js, systems/illnessPlayer.js): onset by
 * risk, contagion in the household and at work, care and medicine, death
 * through the townsfolk's path (annals, the churchyard), plague carried town
 * to town, the lazy catch-up the same as living day by day, old saves.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Illness } from '../systems/illness.js';
import { IllnessPlayer } from '../systems/illnessPlayer.js';
import { Graveyards } from '../systems/graveyards.js';

let BASE = null;

beforeAll(() => {
    DataLoader._gamedata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/gamedata.json'), 'utf-8'));
    BASE = JSON.parse(JSON.stringify(DataLoader._gamedata.illness));
});

afterEach(() => { DataLoader._gamedata.illness = JSON.parse(JSON.stringify(BASE)); });

/** Swap in an illness config with these changes (a fresh object: the config cache keys on it). */
function tune(fn) {
    const c = JSON.parse(JSON.stringify(BASE));
    fn(c);
    DataLoader._gamedata.illness = c;
}

function makeWorld(seed = 4242, towns = null) {
    const list = towns || [
        { name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 },
        { name: 'Greymoor', type: 'village', q: 8, r: 9, population: 400, kingdom: 1 },
    ];
    const kingdoms = { 1: { id: 1, name: 'Westmark', wars: [] }, 2: { id: 2, name: 'Eastholm', wars: [] } };
    const world = {
        day: 1, baseYear: 853, generationParams: { seed }, activeEvents: [], kingdoms: Object.values(kingdoms),
        getSettlementViews: () => list, getKingdom: id => kingdoms[id] || null,
        getTile: (q, r) => ({ settlement: list.find(t => t.q === q && t.r === r) || null }),
    };
    for (const t of list) Townsfolk.seed(t, world, { q: t.q, r: t.r });
    return { world, towns: list };
}

function liveUntil(world, to) {
    while (world.day < to) {
        world.day++;
        Townsfolk.processDay(world, null);
        Illness.processDay(world, null);
    }
}

const env0 = { season: 'spring', dearth: false, alms: false, town: 1, hygiene: 1 };

describe('Illness — onset follows risk', () => {
    it('the young, the old, the poor and the hungry are at more risk; the rich at less', () => {
        const day = 1000;
        const p = (age, role) => ({ born: day - age * 120, role, died: null });
        const adult = Illness.risk(p(30, 'villager'), 'fever', env0, 3, day);
        expect(Illness.risk(p(2, 'child'), 'fever', env0, 3, day)).toBeGreaterThan(adult);
        expect(Illness.risk(p(78, 'villager'), 'fever', env0, 3, day)).toBeGreaterThan(adult);
        expect(Illness.risk(p(30, 'beggar'), 'fever', env0, 3, day)).toBeGreaterThan(adult);
        expect(Illness.risk(p(30, 'noble'), 'fever', env0, 3, day)).toBeLessThan(adult);
        expect(Illness.risk(p(30, 'villager'), 'fever', { ...env0, dearth: true }, 3, day)).toBeGreaterThan(adult);
        expect(Illness.risk(p(30, 'villager'), 'fever', env0, 9, day)).toBeGreaterThan(adult);
        // Bad water: the flux follows the town's dirt in full
        const dirty = { ...env0, hygiene: 1.3 };
        expect(Illness.risk(p(30, 'villager'), 'flux', dirty, 3, day) / Illness.risk(p(30, 'villager'), 'flux', env0, 3, day))
            .toBeGreaterThan(Illness.risk(p(30, 'villager'), 'fever', dirty, 3, day) / adult);
    });

    it('colds come in winter and the flux in summer', () => {
        tune(c => { c.travel.perStep = 0; c.illnesses.pox.importPerStep = 0; });
        const { world, towns } = makeWorld(77);
        const seen = { cold: { winter: 0, summer: 0 }, flux: { winter: 0, summer: 0 } };
        const counted = new Set();
        while (world.day < 1 + 6 * 120) {
            world.day++;
            Townsfolk.processDay(world, null);
            Illness.processDay(world, null);
            const season = ['spring', 'summer', 'autumn', 'winter'][Math.floor(((world.day - 1) % 120) / 30)];
            for (const t of towns) {
                for (const p of t.folk.people) {
                    if (!p.ill || counted.has(`${t.name}${p.id}|${p.ill.d}`)) continue;
                    counted.add(`${t.name}${p.id}|${p.ill.d}`);
                    if (seen[p.ill.k] && seen[p.ill.k][season] != null) seen[p.ill.k][season]++;
                }
            }
        }
        expect(seen.cold.winter).toBeGreaterThan(seen.cold.summer);
        expect(seen.flux.summer).toBeGreaterThan(seen.flux.winter);
    });
});

describe('Illness — contagion', () => {
    it('passes within the household and among those who work together more than to the town at large', () => {
        // Only the passing on: no one falls sick of their own, a strong fever
        tune(c => {
            for (const d of Object.values(c.illnesses)) { d.spont = 0; d.importPerStep = 0; d.fromHurt = 0; d.afterBirth = 0; }
            c.illnesses.fever.contagion = 0.12;
            c.travel.perStep = 0;
        });
        // The share of each circle of the first case that catches it from them: those under their roof,
        // those at the same work, and the rest of the town
        const met = { household: [0, 0], work: [0, 0], town: [0, 0] };
        for (let seed = 1; seed <= 25; seed++) {
            const { world, towns } = makeWorld(seed, [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }]);
            const folk = towns[0].folk;
            // (a few days lived: the family's households and the jobs are set up, systems/townFamily.js, townJobs.js)
            liveUntil(world, 11);
            const res = Townsfolk.residents(folk);
            const hh = Illness._households(folk, res, 11);
            const sizes = [...hh.size.entries()].sort((a, b) => b[1] - a[1]);
            const big = res.find(p => hh.of.get(p.id) === sizes[0][0]);
            Illness._infect(folk, big, 'fever', 11, () => 0.9, 'own');
            big.ill.on = 11;
            const circle = p => (hh.of.get(p.id) === hh.of.get(big.id) ? 'household' : Illness._workKey(p, 11) === Illness._workKey(big, 11) ? 'work' : 'town');
            const caught = new Set();
            // (first-hand only: caught while the first case could still pass it on)
            while (world.day < big.ill.end) {
                world.day++;
                Townsfolk.processDay(world, null);
                Illness.processDay(world, null);
                for (const p of folk.people) if (p !== big && p.ill && p.ill.k === 'fever') caught.add(p.id);
            }
            for (const p of res) {
                if (p === big) continue;
                const c = met[circle(p)];
                c[1]++;
                if (caught.has(p.id)) c[0]++;
            }
        }
        const rate = k => met[k][0] / Math.max(1, met[k][1]);
        expect(met.household[0]).toBeGreaterThan(0);
        expect(rate('household')).toBeGreaterThan(rate('town'));
        expect(rate('work')).toBeGreaterThan(rate('town'));
    });
});

describe('Illness — care', () => {
    it('family, a healer, herbs and a gift each lower the death chance', () => {
        const c = { k: 'fever', sv: 0.9, fam: false, hl: 1, hb: false };
        const alone = Illness.careMult(c, { role: 'villager' });
        const fam = Illness.careMult({ ...c, fam: true }, { role: 'villager' });
        const doc = Illness.careMult({ ...c, fam: true, hl: 0.65, hb: true }, { role: 'villager' });
        const gift = Illness.careMult({ ...c, fam: true, hl: 0.65, hb: true, gift: 'medicine' }, { role: 'villager' });
        expect(fam).toBeLessThan(alone);
        expect(doc).toBeLessThan(fam);
        expect(gift).toBeLessThan(doc);
        expect(Illness.careMult({ ...c, fam: true }, { role: 'noble' })).toBeLessThan(fam);
    });

    it('the healer goes round: the fee from the family to the healer, herbs out of the market and paid into the town purse', () => {
        const { world, towns } = makeWorld(5);
        const s = towns[0];
        const folk = s.folk;
        s.market = { stock: { herbs: 6 }, trend: {}, short: { food: 0, tools: 0, fuel: 0 } };
        s.economy = { gold: 100 };
        Illness.state(world, s, folk, 1);
        const res = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, 1) >= 18);
        const healer = res[0];
        healer.job = { id: 'healer', rank: 'master', since: 0 };
        healer.purse = 0;
        const sick = res[1];
        sick.purse = 50;
        Illness._infect(folk, sick, 'fever', 1, () => 0.95, 'own');
        sick.ill.on = 1;
        const env = Illness._env(world, s, folk, 2);
        Illness._care(world, s, folk, Townsfolk.residents(folk), 2, env, Illness._households(folk, Townsfolk.residents(folk), 2), () => 0.99);
        expect(sick.ill.v).toBe(1);
        expect(sick.ill.hl).toBeLessThan(1);
        expect(sick.ill.hb).toBe(true);
        expect(healer.purse).toBeGreaterThan(0);
        expect(s.market.stock.herbs).toBeLessThan(6);
        expect(s.economy.gold).toBeGreaterThan(100);
    });

    it('cared-for towns bury fewer of the sick than towns without a healer or herbs', () => {
        const deaths = care => {
            tune(c => {
                for (const d of Object.values(c.illnesses)) { d.spont = 0; d.importPerStep = 0; }
                c.illnesses.fever.contagion = 0;
                c.illnesses.fever.mortality = { infant: 0.5, child: 0.5, adult: 0.5, elder: 0.5, old: 0.5 };
                c.travel.perStep = 0;
                if (!care) { c.care.family = 1; c.care.alone = 1; c.care.visitsPerHealer = 0; c.care.visitsPerPriest = 0; }
            });
            let n = 0;
            for (let seed = 1; seed <= 12; seed++) {
                const { world, towns } = makeWorld(seed, [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }]);
                const folk = towns[0].folk;
                towns[0].market = { stock: { herbs: 50 }, trend: {}, short: { food: 0, tools: 0, fuel: 0 } };
                Illness.state(world, towns[0], folk, 1);
                const res = Townsfolk.residents(folk);
                res[0].job = { id: 'healer', rank: 'master', since: 0 };
                for (const p of res.slice(1, 9)) { Illness._infect(folk, p, 'fever', 1, () => 0.5, 'own'); p.ill.on = 1; p.ill.end = 9; p.purse = 30; }
                liveUntil(world, 12);
                n += (folk.ill.deaths || []).length;
            }
            return n;
        };
        expect(deaths(true)).toBeLessThan(deaths(false));
    });
});

describe('Illness — death', () => {
    it('goes through the townsfolk death path: the annals, the widowed, and the churchyard', () => {
        tune(c => { c.illnesses.fever.mortality = { infant: 9, child: 9, adult: 9, elder: 9, old: 9 }; c.care.min = 1; });
        const { world, towns } = makeWorld(9, [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }]);
        const s = towns[0];
        const folk = s.folk;
        Illness.state(world, s, folk, 1);
        const grown = Townsfolk.residents(folk).filter(x => Townsfolk.age(x, 1) >= 20 && x.spouse == null);
        const p = grown.find(x => x.gender === 'male') || grown[0];
        const sp = grown.find(x => x !== p && x.gender !== p.gender) || grown.find(x => x !== p);
        Townsfolk._wed(folk, p, sp, 1, true);
        Illness._infect(folk, p, 'fever', 1, () => 0.5, 'own');
        p.ill.on = 1; p.ill.end = 3;
        liveUntil(world, 4);
        expect(p.died).toBe(4);
        expect(Illness.def('fever').cause).toContain(p.cause);
        expect(folk.annals.some(e => e.k === 'died' && e.a === p.id)).toBe(true);
        expect(sp.log.some(e => e.k === 'widowed' && e.o === p.id)).toBe(true);
        expect(sp.heart && sp.heart.k).toBe('broken');
        expect(folk.ill.deaths.some(d => d.a === p.id && d.k === 'fever')).toBe(true);
        // The sexton's next round lays them in the churchyard
        Graveyards.processDay(world, null);
        expect(s.graveyard.buried[p.id]).toBeTruthy();
    });
});

describe('Illness — between towns', () => {
    const plagueTowns = () => [
        { name: 'Highmarket', type: 'city', q: 10, r: 10, population: 8000, kingdom: 1 },
        { name: 'Ashford', type: 'town', q: 13, r: 11, population: 2500, kingdom: 1 },
        { name: 'Farcombe', type: 'town', q: 15, r: 9, population: 2500, kingdom: 1 },
    ];
    const run = (quarantine) => {
        let reached = 0;
        for (let seed = 1; seed <= 10; seed++) {
            const { world, towns } = makeWorld(seed, plagueTowns());
            world.kingdoms[0].laws = { pestilence: quarantine ? 'quarantine' : 'open' };
            for (const t of towns) Illness.state(world, t, t.folk, 1);
            world.activeEvents.push({ id: 'plague', kingdomId: 1, q: 10, r: 10, settlementName: 'Highmarket', daysLeft: 40, effects: {} });
            liveUntil(world, 60);
            for (const t of towns.slice(1)) if (t.folk.people.some(p => (p.ill && p.ill.k === 'plague') || (p.imm && p.imm.plague === -1 && Townsfolk.isHere(p) && p.ill == null && p.log.some(e => e.k === 'recovered' && e.x === 'plague')) || (p.cause && /plague|pestilence/.test(p.cause)))) reached++;
            expect(towns[0].folk.ill.hist.concat(Object.keys(towns[0].folk.ill.out).map(k => ({ k }))).some(h => h.k === 'plague')).toBe(true);
        }
        return reached;
    };
    it('the plague event strikes its town and is carried to the towns near it; quarantine holds it back', () => {
        tune(c => { c.plagueEvent.realm = 0; });
        const open = run(false);
        const shut = run(true);
        expect(open).toBeGreaterThan(0);
        expect(shut).toBeLessThan(open);
    });

    it('every realm keeps its gates open by custom; only a set law quarantines', async () => {
        const { Laws } = await import('../systems/laws.js');
        DataLoader._gamedata.laws = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/laws.json'), 'utf-8'));
        const { world, towns } = makeWorld(1);
        for (let id = 1; id <= 40; id++) expect(Laws.custom({ id, name: `Realm ${id}` }, 'pestilence')).toBe('open');
        expect(Illness.quarantined(world, towns[0])).toBe(false);
        world.kingdoms[0].laws = { pestilence: 'quarantine' };
        expect(Illness.quarantined(world, towns[0])).toBe(true);
    });

    it('a town with no roster keeps an abstract sickness that seeds the roster it gets', () => {
        const { world, towns } = makeWorld(3, [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }]);
        const fresh = { name: 'Newby', type: 'village', q: 6, r: 8, population: 300, kingdom: 1, sickness: { k: 'fever', d: 1, until: 30, abs: true, from: 'Ashford' } };
        towns.push(fresh);
        Townsfolk.seed(fresh, world, { q: 6, r: 8 });
        Illness.state(world, fresh, fresh.folk, 2);
        expect(fresh.folk.people.some(p => p.ill && p.ill.k === 'fever' && p.ill.from === 'Ashford')).toBe(true);
    });
});

describe('Illness — off-screen consistency and saves', () => {
    it('is deterministic, draws nothing from the shared RNG, and the lazy catch-up is the same as day by day', () => {
        const one = () => [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }];
        Utils.setSeed(1234);
        const expected = Utils.random();
        Utils.setSeed(1234);
        const a = makeWorld(31, one());
        liveUntil(a.world, 1 + 3 * 120);
        expect(Utils.random()).toBe(expected);
        const b = makeWorld(31, one());
        b.world.day = 1 + 3 * 120;
        Townsfolk.catchUp(b.world, b.towns[0], b.world.day);
        const sig = t => t.folk.people.map(p => [p.id, p.died, p.cause, p.ill ? p.ill.k : null]);
        expect(sig(b.towns[0])).toEqual(sig(a.towns[0]));
        // (and something happened: folk fell sick and got over it)
        expect(a.towns[0].folk.people.some(p => p.imm && Object.keys(p.imm).some(k => k !== 'pox'))).toBe(true);
    });

    it('an old save (no sickness on the roster) loads and lives on; the state survives a save round trip', () => {
        const { world, towns } = makeWorld(8, [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }]);
        const s = towns[0];
        delete s.folk.ill;
        for (const p of s.folk.people) { delete p.ill; delete p.imm; }
        expect(() => liveUntil(world, 200)).not.toThrow();
        expect(s.folk.ill.v).toBe(1);
        const copy = JSON.parse(JSON.stringify(s));
        const w2 = { ...world, getSettlementViews: () => [copy] };
        expect(() => Illness.processDay({ ...w2, day: 202 }, null)).not.toThrow();
        expect(copy.folk.ill.tick).toBeGreaterThanOrEqual(s.folk.ill.tick);
    });

    it('the seasons keep only their share of the dying; the rest is the sickness', () => {
        expect(Illness.baseShare(30)).toBeLessThan(1);
        expect(Illness.handlesPlague()).toBe(true);
        tune(c => { c.enabled = false; });
        expect(Illness.baseShare(30)).toBe(1);
        expect(Illness.handlesPlague()).toBe(false);
    });
});

describe('Illness — the player', () => {
    it('can catch it from a town full of the sick', () => {
        const { world, towns } = makeWorld(12, [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }]);
        const s = towns[0];
        Illness.state(world, s, s.folk, 1);
        for (const p of Townsfolk.residents(s.folk)) { Illness._infect(s.folk, p, 'fever', 1, () => 0.5, 'own'); p.ill.on = 1; p.ill.end = 999; }
        const player = { q: 5, r: 7, strength: 5, gold: 0, inventory: {} };
        let caught = null;
        for (let d = 2; d < 400 && !caught; d++) {
            world.day = d;
            const out = IllnessPlayer.processDay(world, player, { contact: { fever: 3 } });
            if (out.caught.length) caught = out.caught[0];
        }
        expect(caught && caught.id).toBe('chill');
    });

    it('medicine for the sick: their care the better, a line in their life; physic and alms move real coin', () => {
        const { world, towns } = makeWorld(13, [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }]);
        const s = towns[0];
        const folk = s.folk;
        Illness.state(world, s, folk, 1);
        world.day = 2;
        const res = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, 2) >= 18);
        const p = res[1];
        Illness._infect(folk, p, 'fever', 1, () => 0.5, 'own');
        p.ill.on = 1; p.ill.end = 20;
        const npc = { _person: p, _folk: folk };
        expect(IllnessPlayer.greetLine(npc, world)).toBeTruthy();
        const player = { gold: 500, karma: 0 };
        const r = IllnessPlayer.giveToSick(npc, 'herbs', world, player);
        expect(r && r.text).toBeTruthy();
        expect(p.ill ? p.ill.gift : 'medicine').toBe('medicine');
        expect(p.log.some(e => e.k === 'nursed')).toBe(true);
        expect(IllnessPlayer.giveToSick(npc, 'iron', world, player)).toBe(null);

        res[0].job = { id: 'healer', rank: 'master', since: 0 };
        const fund = IllnessPlayer.fundPhysician(player, world, s);
        expect(fund.success).toBe(true);
        expect(folk.ill.fund.gold).toBe(fund.cost);
        expect(player.gold).toBe(500 - fund.cost);
        const purses = () => Townsfolk.residents(folk).reduce((t, x) => t + Townsfolk.purse(folk, x, world), 0);
        const before = purses();
        const alms = IllnessPlayer.giveAlms(player, world, s);
        expect(alms.success).toBe(true);
        expect(purses() - before).toBe(alms.cost);
        expect(folk.ill.alms.until).toBeGreaterThan(2);
    });

    it('karma for charity comes for real need, once: not for paying the healer again and again, nor for every gift to one bed', () => {
        const { world, towns } = makeWorld(13, [{ name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 }]);
        const s = towns[0];
        const folk = s.folk;
        Illness.state(world, s, folk, 1);
        world.day = 2;
        const res = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, 2) >= 18);
        res[0].job = { id: 'healer', rank: 'master', since: 0 };
        const F = Illness.config().fund;
        const player = { gold: 5000, karma: 0 };
        // No one sick: the healer is paid, but it is no charity
        for (const p of Townsfolk.residents(folk)) p.ill = null;
        let r = IllnessPlayer.fundPhysician(player, world, s);
        expect(r.success).toBe(true);
        expect(r.karma).toBe(0);
        expect(player.karma).toBe(0);
        // Folk sick: karma, once for the fund's month however often the healer is paid
        const sick = res[1];
        Illness._infect(folk, sick, 'fever', 1, () => 0.5, 'own');
        sick.ill.on = 1; sick.ill.end = 60;
        r = IllnessPlayer.fundPhysician(player, world, s);
        expect(r.karma).toBe(F.karma);
        for (let i = 0; i < 5; i++) expect(IllnessPlayer.fundPhysician(player, world, s).karma).toBe(0);
        expect(player.karma).toBe(F.karma);
        // ...and again once the month is out
        world.day = 2 + F.physicianDays + 1;
        sick.ill.end = world.day + 30;
        expect(IllnessPlayer.fundPhysician(player, world, s).karma).toBe(F.karma);
        // Alms: once a month too
        const k0 = player.karma;
        expect(IllnessPlayer.giveAlms(player, world, s).karma).toBe(F.karma);
        expect(IllnessPlayer.giveAlms(player, world, s).karma).toBe(0);
        expect(player.karma).toBe(k0 + F.karma);
        // Herbs for the sick: karma for the first, not for each heaped on the same sickness
        const k1 = player.karma;
        const npc = { _person: sick, _folk: folk };
        IllnessPlayer.giveToSick(npc, 'herbs', world, player);
        IllnessPlayer.giveToSick(npc, 'herbs', world, player);
        IllnessPlayer.giveToSick(npc, 'bread', world, player);
        expect(player.karma).toBe(k1 + Illness.config().care.giftKarma);
    });
});
